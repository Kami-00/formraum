import {
  makeBox, makeCylinder, makeSphere, draw, drawRectangle, drawCircle, drawEllipse, drawPolysides, cast, Plane, EdgeFinder,
  measureVolume, measureArea, measureShapeLinearProperties,
  importSTEP, exportSTEP, makeCompound,
} from 'replicad';
import {SHAPES} from './shapes.js';

const EPS=1e-7, MAX_FILE=25*1024*1024;
const fail=message=>{throw new Error(message);};
const object=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(`${label}: Objekt erwartet.`);return v;};
function number(v,label,min=-10000){
  if(typeof v!=='number'||!Number.isFinite(v)||v<min||Math.abs(v)>10000)fail(`${label}: gültige Zahl zwischen ${min} und 10000 erwartet.`);
  return v;
}
function vector(v,label,size=3){if(!Array.isArray(v)||v.length!==size)fail(`${label}: ${size} Koordinaten erwartet.`);return v.map(n=>number(n,label));}
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const unit=a=>mul(a,1/Math.hypot(...a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const takeVector=v=>{try{return v.toTuple();}finally{v.delete();}};
function bounds(shape){const bb=shape.boundingBox;try{const [min,max]=bb.bounds;return {min,max};}finally{bb.delete();}}
function frame(face){
  if(face.geomType!=='PLANE')fail('Eine Skizze ist nur auf einer ebenen Fläche möglich.');
  const normal=unit(takeVector(face.normalAt())),origin=takeVector(face.center);
  const axis=Math.abs(normal[0])<.9?[1,0,0]:[0,1,0];
  const u=unit(add(axis,mul(normal,-dot(axis,normal))));
  return {origin,normal,u,v:unit(cross(normal,u))};
}
const geometryNames={PLANE:'Plane',CYLINDER:'Cylinder',CONE:'Cone',SPHERE:'Sphere',TORUS:'Toroid',LINE:'Line',CIRCLE:'Circle',ELLIPSE:'Ellipse',BSPLINE_CURVE:'BSplineCurve',BSPLINE_SURFACE:'BSplineSurface'};
function reference(entity,bb,kind){
  const normalized=p=>p.map((v,i)=>(v-bb.min[i])/Math.max(bb.max[i]-bb.min[i],EPS));
  let center;
  if(kind==='face')center=takeVector(entity.center);
  else{const props=measureShapeLinearProperties(entity);try{center=props.centerOfMass;}finally{props.delete();}}
  const result={version:1,kind,center:normalized(center)};
  const type=entity.geomType;
  if(kind==='face'){result.surface=geometryNames[type]||type;if(type==='PLANE')result.normal=frame(entity).normal;}
  else{result.curve=geometryNames[type]||type;result.start=normalized(takeVector(entity.startPoint));result.end=normalized(takeVector(entity.endPoint));}
  return result;
}
function matches(a,b){
  if(typeof b==='number')return typeof a==='number'&&Number.isFinite(a)&&Math.abs(a-b)<=1e-5;
  if(Array.isArray(b))return Array.isArray(a)&&a.length===b.length&&b.every((v,i)=>matches(a[i],v));
  if(b&&typeof b==='object')return a&&typeof a==='object'&&Object.keys(a).length===Object.keys(b).length&&Object.keys(b).every(k=>matches(a[k],b[k]));
  return a===b;
}
function referenceMatches(a,b){
  if(matches(a,b))return true;
  // OC versions can reverse an edge while preserving the same geometric anchor.
  return b.kind==='edge'&&matches(a,{...b,start:b.end,end:b.start});
}
function resolve(entities,index,expected,bb,kind){
  if(!Number.isInteger(index)||index<1||index>entities.length) {
    if(!expected)fail(`${kind==='face'?'Fläche':'Kante'}: ungültiger Index.`);
  }
  if(expected){
    const candidates=entities.map((e,i)=>({entity:e,index:i+1,reference:reference(e,bb,kind)})).filter(c=>referenceMatches(expected,c.reference));
    if(candidates.length!==1)fail(`${kind==='face'?'Bezugsfläche':'Bezugskante'} hat sich verändert oder ist nicht eindeutig. Bitte Bearbeitung neu auf der gewünschten Fläche oder Kante anlegen.`);
    return candidates[0];
  }
  return {entity:entities[index-1],index,reference:reference(entities[index-1],bb,kind)};
}
function decodeSTEP(encoded){
  if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX_FILE/3)*4)fail('Eine STEP-Datei bis 25 MB erwartet.');
  let raw;try{raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));}catch{fail('STEP-Quelldaten sind ungültig.');}
  if(raw.length>MAX_FILE||!new TextDecoder().decode(raw.slice(0,256)).trimStart().startsWith('ISO-10303-21'))fail('Datei ist keine STEP-Datei (maximal 25 MB).');
  return new Blob([raw]);
}
async function encodeBlob(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer());let text='';
  for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(text);
}

function rotatePoint(point,rotation){
 let [x,y,z]=point;
 for(const [axis,degrees] of rotation.entries()){
  const c=Math.cos(degrees*Math.PI/180),s=Math.sin(degrees*Math.PI/180);
  if(axis===0)[y,z]=[y*c-z*s,y*s+z*c];
  if(axis===1)[x,z]=[x*c+z*s,-x*s+z*c];
  if(axis===2)[x,y]=[x*c-y*s,x*s+y*c];
 }
 return [x,y,z];
}
function dispose(shape){shape?._local?.delete();shape?.delete();}
function profileDrawing(sk){
 const kind=sk.kind;
 if(kind==='rectangle')return drawRectangle(number(sk.width??10,'Skizzenbreite',.01),number(sk.height??10,'Skizzenhöhe',.01));
 if(kind==='ellipse')return drawEllipse(number(sk.width??10,'Skizzenbreite',.01)/2,number(sk.height??10,'Skizzenhöhe',.01)/2);
 if(kind==='circle')return drawCircle(number(sk.radius??5,'Skizzenradius',.005));
 if(kind==='polygon'){
  const sides=number(sk.sides??6,'Seitenzahl',3);if(!Number.isInteger(sides)||sides>64)fail('Ein Vieleck braucht 3 bis 64 ganze Seiten.');
  return drawPolysides(number(sk.radius??5,'Skizzenradius',.005),sides);
 }
 fail('Unbekannte Skizzenform.');
}
export function createKernel(oc){
  function validate(shape){
    if(shape.isNull)fail('Keine gültige CAD-Geometrie erzeugt.');
    const check=new oc.BRepCheck_Analyzer(shape.wrapped,true,false,false);
    const solids=shape.solids;
    try{if(!check.IsValid()||solids.length!==1||measureVolume(shape)<=EPS)fail('Ein zusammenhängender, gültiger Volumenkörper ist erforderlich.');}
    finally{check.delete();solids.forEach(s=>s.delete());}
    return shape;
  }
  async function buildObject(spec,depth=0,keepLocal=false,budget={count:0}){
    if(++budget.count>150)fail('Maximal 150 Ausgangskörper einschließlich Kombinationen möglich.');
    if(depth>8)fail('Maximal acht verschachtelte Kombinationen möglich.');
    object(spec,'Körper');const params=object(spec.params??{},'Maße');let shape,local;
    const p=key=>number(params[key]??SHAPES[spec.kind]?.params[key],key,key==='topRadius'?0:.005);
    try{
      if(spec.kind==='box'||spec.kind==null){const w=number(params.width??30,'Breite',.01),d=number(params.depth??20,'Tiefe',.01),h=number(params.height??10,'Höhe',.01);shape=makeBox([-w/2,-d/2,0],[w/2,d/2,h]);}
      else if(spec.kind==='cylinder')shape=makeCylinder(number(params.radius??10,'Radius',.005),number(params.height??10,'Höhe',.01));
      else if(spec.kind==='sphere')shape=makeSphere(p('radius')).translateZ(p('radius'));
      else if(spec.kind==='cone'){
        const r=p('radius'),top=p('topRadius'),h=p('height');
        const pen=draw([0,0]).lineTo([r,0]).lineTo([top,h]);if(top>0)pen.lineTo([0,h]);
        shape=pen.close().sketchOnPlane('XZ').revolve('Z');
      }
      else if(spec.kind==='tube'){
        const r=p('radius'),inner=p('innerRadius'),h=p('height');if(inner>=r)fail('Der Innenradius muss kleiner als der Außenradius sein.');
        const outside=makeCylinder(r,h),inside=makeCylinder(inner,h);
        try{shape=outside.cut(inside);}finally{outside.delete();inside.delete();}
      }
      else if(spec.kind==='torus'){
        const r=p('radius'),tube=p('tubeRadius');if(tube>=r)fail('Der Ringradius muss größer als der Querschnittsradius sein.');
        const maker=new oc.BRepPrimAPI_MakeTorus(r,tube);try{shape=cast(maker.Shape()).translateZ(tube);}finally{maker.delete();}
      }
      else if(spec.kind==='wedge')shape=draw([-p('width')/2,0]).lineTo([p('width')/2,0]).lineTo([-p('width')/2,p('height')]).close().sketchOnPlane('XZ').extrude(p('depth')).translateY(p('depth')/2);
      else if(spec.kind==='pyramid')shape=drawRectangle(p('width'),p('depth')).sketchOnPlane('XY').loftWith([],{endPoint:[0,0,p('height')],ruled:true});
      else if(spec.kind==='prism')shape=profileDrawing({kind:'polygon',radius:p('radius'),sides:p('sides')}).sketchOnPlane('XY').extrude(p('height'));
      else if(spec.kind==='capsule'){
        const r=p('radius'),h=p('height');if(h<2*r)fail('Die Kapselhöhe muss mindestens dem Durchmesser entsprechen.');
        if(Math.abs(h-2*r)<EPS)shape=makeSphere(r).translateZ(r);
        else{
          const a=makeSphere(r).translateZ(r),b=makeSphere(r).translateZ(h-r),c=makeCylinder(r,h-2*r).translateZ(r);let first;
          try{first=c.fuse(a);shape=first.fuse(b);}finally{first?.delete();a.delete();b.delete();c.delete();}
        }
      }
      else if(spec.kind==='profile'){
        const plane=spec.plane??'XY';if(!['XY','XZ','YZ'].includes(plane))fail('Unbekannte Skizzenebene.');
        shape=profileDrawing(object(spec.profile,'Skizze')).rotate(number(spec.profile.angle??0,'Skizzenwinkel')).sketchOnPlane(plane).extrude(number(params.height??10,'Höhe',.01));
      }
      else if(spec.kind==='boolean'){
        if(!['union','cut','intersect'].includes(spec.operation)||!Array.isArray(spec.operands)||spec.operands.length<2||spec.operands.length>30)fail('Eine Kombination benötigt 2 bis 30 Ausgangskörper.');
        const parts=[];
        try{
          for(const operand of spec.operands)parts.push(await buildObject(operand,depth+1,false,budget));
          shape=parts[0].clone();
          for(const other of parts.slice(1)){
            const before=measureVolume(shape),next=spec.operation==='union'?shape.fuse(other):spec.operation==='cut'?shape.cut(other):shape.intersect(other);
            shape.delete();shape=next;validate(shape);
            if(spec.operation!=='union'&&Math.abs(measureVolume(shape)-before)<EPS)fail('Die Körper überlappen sich nicht oder ändern das Volumen nicht.');
          }
        }finally{parts.forEach(part=>part.delete());}
      }
      else if(spec.kind==='imported')shape=await importSTEP(decodeSTEP(spec.sourceBase64));
      else fail('Unbekannter Grundkörper.');
      validate(shape);
      const features=spec.features??[];
      if(!Array.isArray(features)||features.length>50)fail('Maximal 50 Bearbeitungen pro Körper möglich.');
      spec.features=features;
      for(const [i,feature] of features.entries()){
        let next,prism;const entities=[];
        try{
          object(feature,'Bearbeitung');const bb=bounds(shape);
          if(feature.type==='extrude'||feature.type==='pocket'){
            const faces=shape.faces;entities.push(...faces);
            const support=resolve(faces,feature.face,feature.reference,bb,'face');
            feature.face=support.index;feature.reference=support.reference;
            const f=frame(support.entity),sk=object(feature.sketch,'Skizze'),center=vector(sk.center??[0,0],'Skizzenmittelpunkt',2);
            const origin=add(f.origin,add(mul(f.u,center[0]),mul(f.v,center[1])));
            const plane=new Plane(origin,f.u,f.normal);
            try{
              const drawing=profileDrawing(sk).rotate(number(sk.angle??0,'Skizzenwinkel'));
              prism=drawing.sketchOnPlane(plane).extrude(number(feature.depth??5,'Tiefe',.01)*(feature.type==='pocket'?-1:1));
            }finally{plane.delete();}
            const before=measureVolume(shape);
            next=feature.type==='extrude'?shape.fuse(prism):shape.cut(prism);
            validate(next);
            if(Math.abs(measureVolume(next)-before)<EPS)fail('Skizze berührt den Körper nicht oder ändert kein Volumen.');
          }else if(feature.type==='fillet'||feature.type==='chamfer'){
            const ids=feature.edges;
            if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail('Mindestens eine Kante auswählen; keine doppelten Kanten.');
            if(feature.references!=null&&(!Array.isArray(feature.references)||feature.references.length!==ids.length))fail('Für jede Kante ist ein Geometriebezug erforderlich.');
            const edges=shape.edges;entities.push(...edges);
            const selected=ids.map((id,n)=>resolve(edges,id,feature.references?.[n],bb,'edge'));
            if(new Set(selected.map(e=>e.index)).size!==selected.length)fail('Kanten dürfen nicht doppelt ausgewählt sein.');
            feature.edges=selected.map(e=>e.index);feature.references=selected.map(e=>e.reference);
            const finder=new EdgeFinder().inList(selected.map(e=>e.entity));
            try{next=feature.type==='fillet'?shape.fillet(number(feature.radius??1,'Rundungsradius',.005),()=>finder):shape.chamfer(number(feature.distance??1,'Fasenbreite',.005),()=>finder);}
            finally{finder.delete();}
            validate(next);
          }else fail('Unbekannte Bearbeitung.');
          shape.delete();shape=next;next=null;
        }catch(error){fail(`Bearbeitung ${i+1}: ${error?.message||'Mit diesen Maßen konnte keine gültige Geometrie erstellt werden.'}`);}
        finally{next?.delete();prism?.delete();entities.forEach(e=>e.delete());}
      }
      if(keepLocal)local=shape.clone();
      const scale=number(spec.scale??1,'Skalierung',.001);if(scale>1000)fail('Skalierung maximal 1000.');
      if(scale!==1)shape=shape.scale(scale);
      const rotation=vector(spec.rotation??[0,0,0],'Drehung');
      for(const [i,angle] of rotation.entries())if(angle)shape=shape.rotate(angle,[0,0,0],[[1,0,0],[0,1,0],[0,0,1]][i]);
      shape=shape.translate(vector(spec.position??[0,0,0],'Position'));
      if(local)shape._local=local;
      return shape;
    }catch(error){local?.delete();shape?.delete();throw error;}
  }
  async function buildProject(input){
    object(input,'Projekt');if((input.version??1)!==1)fail('Ungültiges Projektformat (Version 1 erwartet).');
    if(!Array.isArray(input.objects)||input.objects.length>30)fail('Maximal 30 Körper pro Projekt möglich.');
    const project=structuredClone(input),models=[],ids=new Set(),budget={count:0};project.version=1;
    try{
      for(const spec of project.objects){
        if(typeof spec?.id!=='string'||!spec.id||spec.id.length>128||ids.has(spec.id))fail('Körper-Kennungen müssen gültig und eindeutig sein.');
        ids.add(spec.id);models.push({spec,shape:await buildObject(spec,0,true,budget)});
      }
      return {project,models};
    }catch(error){models.forEach(m=>dispose(m.shape));throw error;}
  }
  function shapeJSON(spec,shape){
    const bb=bounds(shape),faces=shape.faces,edges=shape.edges;
    const local=shape._local||shape,localBB=bounds(local),localFaces=local.faces,localEdges=local.edges;
    const rotation=spec.rotation??[0,0,0],position=spec.position??[0,0,0],scale=spec.scale??1;
    const worldFrame=face=>{const f=frame(face);return {origin:add(rotatePoint(mul(f.origin,scale),rotation),position),normal:rotatePoint(f.normal,rotation),u:rotatePoint(f.u,rotation),v:rotatePoint(f.v,rotation)};};
    try{
      const mesh={vertices:[],triangles:[],faceIds:[]};
      const faceData=faces.map((face,i)=>{
        const tess=face.mesh({tolerance:.12,angularTolerance:.15}),offset=mesh.vertices.length;
        for(let j=0;j<tess.vertices.length;j+=3)mesh.vertices.push(tess.vertices.slice(j,j+3));
        for(let j=0;j<tess.triangles.length;j+=3){mesh.triangles.push(tess.triangles.slice(j,j+3).map(v=>v+offset));mesh.faceIds.push(i+1);}
        const planar=face.geomType==='PLANE';
        return {id:i+1,planar,area:measureArea(face),reference:reference(localFaces[i],localBB,'face'),...(planar?worldFrame(localFaces[i]):{})};
      });
      const edgeData=edges.map((edge,i)=>{
        // Edge meshing returns consecutive line segments. Convert to a polyline.
        const {lines}=edge.meshEdges({tolerance:.08,angularTolerance:.15}),points=[];
        for(let j=0;j<lines.length;j+=6){if(j===0)points.push(lines.slice(j,j+3));points.push(lines.slice(j+3,j+6));}
        return {id:i+1,points,length:edge.length,reference:reference(localEdges[i],localBB,'edge')};
      });
      return {id:spec.id,name:String(spec.name??spec.id).slice(0,200),mesh,faces:faceData,edges:edgeData,bounds:bb,volume:measureVolume(shape),valid:true};
    }finally{faces.forEach(f=>f.delete());edges.forEach(e=>e.delete());localFaces.forEach(f=>f.delete());localEdges.forEach(e=>e.delete());}
  }
  async function modelResponse(input){
    const {project,models}=await buildProject(input);
    try{return {project,objects:models.map(({spec,shape})=>shapeJSON(spec,shape))};}
    finally{models.forEach(m=>dispose(m.shape));}
  }
  return async(operation,payload)=>{
    if(operation==='ready')return {ok:true};
    if(operation==='model')return modelResponse(payload.project);
    if(operation==='import_step'){
      const shape=await importSTEP(decodeSTEP(payload.base64));let solids=[];
      try{
        solids=shape.solids;if(!solids.length||solids.length>30)fail('Die STEP-Datei muss 1 bis 30 gültige Volumenkörper enthalten.');
        const objects=[];
        for(const [i,solid] of solids.entries()){
          validate(solid);
          objects.push({id:crypto.randomUUID(),name:`${String(payload.filename??'Import.step').replace(/\.(stp|step)$/i,'')} ${i+1}`,kind:'imported',params:{},position:[0,0,0],features:[],sourceBase64:await encodeBlob(solid.blobSTEP())});
        }
        return modelResponse({version:1,objects});
      }finally{solids.forEach(s=>s.delete());shape.delete();}
    }
    if(operation==='export_step'||operation==='export_stl'){
      const {models}=await buildProject(payload.project);let compound;
      try{
        const printable=models.filter(m=>!m.spec.hole);
        if(!printable.length)fail('Das Projekt enthält keine Körper zum Exportieren.');
        if(operation==='export_step')return exportSTEP(printable.map(({spec,shape})=>({shape,name:String(spec.name??spec.id),color:spec.color})),{unit:'MM',modelUnit:'MM'});
        compound=makeCompound(printable.map(m=>m.shape));return compound.blobSTL({tolerance:.12,angularTolerance:.15,binary:true});
      }finally{compound?.delete();models.forEach(m=>dispose(m.shape));}
    }
    fail('Unbekannte CAD-Anfrage.');
  };
}
