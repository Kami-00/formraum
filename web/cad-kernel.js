import {
  makeBox, makeCylinder, drawRectangle, drawCircle, Plane, EdgeFinder,
  measureVolume, measureArea, measureShapeLinearProperties,
  importSTEP, exportSTEP, makeCompound,
} from 'replicad';

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

export function createKernel(oc){
  function validate(shape){
    if(shape.isNull)fail('Keine gültige CAD-Geometrie erzeugt.');
    const check=new oc.BRepCheck_Analyzer(shape.wrapped,true,false,false);
    const solids=shape.solids;
    try{if(!check.IsValid()||solids.length!==1||measureVolume(shape)<=EPS)fail('Ein zusammenhängender, gültiger Volumenkörper ist erforderlich.');}
    finally{check.delete();solids.forEach(s=>s.delete());}
    return shape;
  }
  async function buildObject(spec){
    object(spec,'Körper');const params=object(spec.params??{},'Maße');let shape;
    try{
      if(spec.kind==='box'||spec.kind==null){const w=number(params.width??30,'Breite',.01),d=number(params.depth??20,'Tiefe',.01),h=number(params.height??10,'Höhe',.01);shape=makeBox([-w/2,-d/2,0],[w/2,d/2,h]);}
      else if(spec.kind==='cylinder')shape=makeCylinder(number(params.radius??10,'Radius',.005),number(params.height??10,'Höhe',.01));
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
              const drawing=sk.kind==='rectangle'?drawRectangle(number(sk.width??10,'Skizzenbreite',.01),number(sk.height??10,'Skizzenhöhe',.01)):
                sk.kind==='circle'?drawCircle(number(sk.radius??5,'Skizzenradius',.005)):fail('Unbekannte Skizzenform.');
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
      shape=shape.translate(vector(spec.position??[0,0,0],'Position'));
      return shape;
    }catch(error){shape?.delete();throw error;}
  }
  async function buildProject(input){
    object(input,'Projekt');if((input.version??1)!==1)fail('Ungültiges Projektformat (Version 1 erwartet).');
    if(!Array.isArray(input.objects)||input.objects.length>30)fail('Maximal 30 Körper pro Projekt möglich.');
    const project=structuredClone(input),models=[],ids=new Set();project.version=1;
    try{
      for(const spec of project.objects){
        if(typeof spec?.id!=='string'||!spec.id||spec.id.length>128||ids.has(spec.id))fail('Körper-Kennungen müssen gültig und eindeutig sein.');
        ids.add(spec.id);models.push({spec,shape:await buildObject(spec)});
      }
      return {project,models};
    }catch(error){models.forEach(m=>m.shape.delete());throw error;}
  }
  function shapeJSON(spec,shape){
    const bb=bounds(shape),faces=shape.faces,edges=shape.edges;
    try{
      const mesh={vertices:[],triangles:[],faceIds:[]};
      const faceData=faces.map((face,i)=>{
        const tess=face.mesh({tolerance:.12,angularTolerance:.15}),offset=mesh.vertices.length;
        for(let j=0;j<tess.vertices.length;j+=3)mesh.vertices.push(tess.vertices.slice(j,j+3));
        for(let j=0;j<tess.triangles.length;j+=3){mesh.triangles.push(tess.triangles.slice(j,j+3).map(v=>v+offset));mesh.faceIds.push(i+1);}
        const planar=face.geomType==='PLANE';
        return {id:i+1,planar,area:measureArea(face),reference:reference(face,bb,'face'),...(planar?frame(face):{})};
      });
      const edgeData=edges.map((edge,i)=>{
        // Edge meshing returns consecutive line segments. Convert to a polyline.
        const {lines}=edge.meshEdges({tolerance:.08,angularTolerance:.15}),points=[];
        for(let j=0;j<lines.length;j+=6){if(j===0)points.push(lines.slice(j,j+3));points.push(lines.slice(j+3,j+6));}
        return {id:i+1,points,length:edge.length,reference:reference(edge,bb,'edge')};
      });
      return {id:spec.id,name:String(spec.name??spec.id).slice(0,200),mesh,faces:faceData,edges:edgeData,bounds:bb,volume:measureVolume(shape),valid:true};
    }finally{faces.forEach(f=>f.delete());edges.forEach(e=>e.delete());}
  }
  async function modelResponse(input){
    const {project,models}=await buildProject(input);
    try{return {project,objects:models.map(({spec,shape})=>shapeJSON(spec,shape))};}
    finally{models.forEach(m=>m.shape.delete());}
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
        if(!models.length)fail('Das Projekt enthält keine Körper zum Exportieren.');
        if(operation==='export_step')return exportSTEP(models.map(({spec,shape})=>({shape,name:String(spec.name??spec.id),color:spec.color})),{unit:'MM',modelUnit:'MM'});
        compound=makeCompound(models.map(m=>m.shape));return compound.blobSTL({tolerance:.12,angularTolerance:.15,binary:true});
      }finally{compound?.delete();models.forEach(m=>m.shape.delete());}
    }
    fail('Unbekannte CAD-Anfrage.');
  };
}
