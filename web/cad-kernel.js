import {cutSurfaceTexture} from './surface-texture.js';
import {gripLayout} from './grip.js';
import {assemble} from './assembly.js';
import {solveSketch} from './sketch-solver.js';
import {sketchPlane,patternTransforms} from './model-geometry.js';
import {findRegions,validateEntities,regionAxis,assertAxisOutside,edgePoint} from './sketch-regions.js';
import {expandGenerators} from './generators.js';
import {
  makeBox, makeCylinder, makeSphere, makeFace, draw, drawRectangle, drawCircle, drawEllipse, drawPolysides, cast, Plane, EdgeFinder, FaceFinder,
  measureVolume, measureShapeVolumeProperties, measureArea, measureShapeLinearProperties, measureDistanceBetween,
  importSTEP, exportSTEP, makeCompound, genericSweep,
} from 'replicad';
import {positionedCenter} from './sketch-position.js';
import {gear,thread,convexHull} from './mechanical.js';
import {validateSweepPath,loftDefaults} from './profile-operations.js';
import {validateVertices} from './profile-geometry.js';
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
function outerCenter(face){
  const wire=face.clone().outerWire();let filled;
  try{filled=makeFace(wire);return takeVector(filled.center);}
  finally{filled?.delete();wire.delete();}
}
function frame(face,legacy=false){
  if(face.geomType!=='PLANE')fail('Eine Skizze ist nur auf einer ebenen Fläche möglich.');
  // Inner wires must not move a sketch's coordinate origin when a prior hole changes.
  const normal=unit(takeVector(face.normalAt())),origin=legacy?takeVector(face.center):outerCenter(face);
  const axis=Math.abs(normal[0])<.9?[1,0,0]:[0,1,0];
  const u=unit(add(axis,mul(normal,-dot(axis,normal))));
  return {origin,normal,u,v:unit(cross(normal,u))};
}
// Accept actual rectangular outer wires only, never a bounding box of a curved face.
function rectangleBounds(face,f){
 const wire=face.clone().outerWire(),edges=wire.edges;
 try{
  if(edges.length!==4||edges.some(e=>e.geomType!=='LINE'))return null;
  const segments=edges.map(e=>[takeVector(e.startPoint),takeVector(e.endPoint)].map(p=>{const d=add(p,mul(f.origin,-1));return [dot(d,f.u),dot(d,f.v)];}));
  const points=segments.flat(),min=[0,1].map(i=>Math.min(...points.map(p=>p[i]))),max=[0,1].map(i=>Math.max(...points.map(p=>p[i])));
  const tolerance=Math.max(max[0]-min[0],max[1]-min[1],1)*1e-7;
  if(max.some((v,i)=>v-min[i]<tolerance))return null;
  const near=(a,b)=>Math.abs(a-b)<tolerance;
  const sides=new Set();
  for(const [a,b] of segments){
   if(near(a[0],b[0])&&(near(a[0],min[0])||near(a[0],max[0]))&&near(Math.min(a[1],b[1]),min[1])&&near(Math.max(a[1],b[1]),max[1]))sides.add(near(a[0],min[0])?'left':'right');
   else if(near(a[1],b[1])&&(near(a[1],min[1])||near(a[1],max[1]))&&near(Math.min(a[0],b[0]),min[0])&&near(Math.max(a[0],b[0]),max[0]))sides.add(near(a[1],min[1])?'bottom':'top');
   else return null;
  }
  return sides.size===4?{min,max}:null;
 }finally{edges.forEach(e=>e.delete());wire.delete();}
}
const geometryNames={PLANE:'Plane',CYLINDER:'Cylinder',CONE:'Cone',SPHERE:'Sphere',TORUS:'Toroid',LINE:'Line',CIRCLE:'Circle',ELLIPSE:'Ellipse',BSPLINE_CURVE:'BSplineCurve',BSPLINE_SURFACE:'BSplineSurface'};
function reference(entity,bb,kind,legacy=false){
  const normalized=p=>p.map((v,i)=>(v-bb.min[i])/Math.max(bb.max[i]-bb.min[i],EPS));
  let center;
  if(kind==='face')center=takeVector(entity.center);
  else{const props=measureShapeLinearProperties(entity);try{center=props.centerOfMass;}finally{props.delete();}}
  const result={version:1,kind,center:normalized(center)};
  const type=entity.geomType;
  if(kind==='face'){
    result.surface=geometryNames[type]||type;
    if(type==='PLANE'){
      const f=frame(entity,legacy);result.normal=f.normal;
      if(!legacy){
        result.version=2;result.center=normalized(f.origin);
        const wire=entity.clone().outerWire(),edges=wire.edges;
        try{
          // Keep the actual outer geometry, rather than only its bounding box or
          // centroid. Order and direction of native edges can change on rebuild.
          result.outerWire=edges.map(edge=>{
            const curve=edge.curve;
            try{return {curve:geometryNames[curve.curveType]||curve.curveType,points:[0,.25,.5,.75,1].map(t=>normalized(takeVector(curve.pointAt(t))))};}
            finally{curve.delete();}
          });
        }finally{edges.forEach(edge=>edge.delete());wire.delete();}
      }
    }
  }
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
  if(a.version===2&&b.version===2&&a.kind==='face'&&b.kind==='face'){
    const {outerWire:first,...firstFace}=a,{outerWire:second,...secondFace}=b;
    if(!matches(firstFace,secondFace)||!Array.isArray(first)||!Array.isArray(second)||first.length!==second.length)return false;
    const remaining=[...second];
    for(const edge of first){
      const index=remaining.findIndex(other=>matches(edge,other)||matches(edge,{...other,points:[...other.points].reverse()}));
      if(index<0)return false;
      remaining.splice(index,1);
    }
    return true;
  }
  // OC versions can reverse an edge while preserving the same geometric anchor.
  return b.kind==='edge'&&matches(a,{...b,start:b.end,end:b.start});
}
function resolve(entities,index,expected,bb,kind){
  if(!Number.isInteger(index)||index<1||index>entities.length) {
    if(!expected)fail(`${kind==='face'?'Fläche':'Kante'}: ungültiger Index.`);
  }
  if(expected){
    const legacy=kind==='face'&&expected.version===1;
    const candidates=entities.map((e,i)=>({entity:e,index:i+1,reference:reference(e,bb,kind,legacy)})).filter(c=>referenceMatches(expected,c.reference));
    if(candidates.length!==1)fail(`${kind==='face'?'Bezugsfläche':'Bezugskante'} hat sich verändert oder ist nicht eindeutig. Bitte Bearbeitung neu auf der gewünschten Fläche oder Kante anlegen.`);
    const selected=candidates[0];
    return legacy?{...selected,legacy:true,reference:reference(selected.entity,bb,kind)}:selected;
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
 if(kind==='polyline'){
  if(sk.closed!==true)fail('Den Linienzug zuerst schließen.');
  const vertices=validateVertices(sk.vertices),pen=draw([vertices[0].x,vertices[0].y]);
  for(const v of vertices.slice(1))pen.lineTo([v.x,v.y]);
  return pen.close();
 }
 if(kind==='slot'){
  const w=number(sk.width,'Langlochbreite',.01),h=number(sk.height,'Langlochhöhe',.01),r=Math.min(w,h)/2,d=Math.abs(w-h)/2;
  if(d<1e-7)return drawCircle(r);
  const result=draw([-d,-r]).lineTo([d,-r]).threePointsArcTo([d,r],[d+r,0]).lineTo([-d,r]).threePointsArcTo([-d,-r],[-d-r,0]).close();
  return w>=h?result:result.rotate(90);
 }
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
  function sketchTool(profiles,makePrism){
    if(!Array.isArray(profiles)||!profiles.length||profiles.length>12)fail('Eine Skizze benötigt 1 bis 12 Konturen.');
    const solids=[],holes=[];let result,normal;
    try{
      for(const profile of profiles){
        object(profile,'Kontur');if(profile.role!=null&&!['solid','hole'].includes(profile.role))fail('Unbekannte Konturrolle.');
        (profile.role==='hole'?holes:solids).push(makePrism(profile));
      }
      if(!solids.length)fail('Mindestens eine normale Kontur ist erforderlich. Für Bohrungen normale Kreise zeichnen und Ausschneiden wählen.');
      result=solids[0].clone();
      for(const solid of solids.slice(1)){const next=result.fuse(solid);result.delete();result=next;}
      normal=result.clone();
      for(const hole of holes){
        // Validate against the original normal contours: another hole may have
        // already removed this region, which is a valid redundant cutout.
        const overlap=normal.intersect(hole);
        try{if(measureVolume(overlap)<=EPS)fail('Eine Aussparung muss eine normale Kontur überlappen.');}
        finally{overlap.delete();}
        const next=result.cut(hole);result.delete();result=next;
      }
      if(measureVolume(result)<=EPS)fail('Die Aussparungen entfernen die gesamte Skizze.');
      const ready=result;result=null;return ready;
    }finally{normal?.delete();result?.delete();solids.forEach(p=>p.delete());holes.forEach(p=>p.delete());}
  }
  function regionTool(spec,budget,override){
    const source=budget.sketches?.get(spec.sketchId);if(!source)fail('Die freie Quellskizze fehlt.');
    if(!Array.isArray(spec.regions)||!spec.regions.length||spec.regions.length>32||new Set(spec.regions).size!==spec.regions.length)fail('1 bis 32 unterschiedliche Flächen auswählen.');
    const regions=findRegions(source.entities),f=sketchPlane(override??source.plane),plane=new Plane(f.origin,f.u,f.normal),params=spec.params??{},operation=spec.operation??'revolve';let shape;
    const axis=regionAxis(spec,source.entities),angle=number(params.revolveAngle??360,'Rotationswinkel',.01);if(angle>360)fail('Rotationswinkel höchstens 360°.');
    const origin=add(f.origin,add(mul(f.u,axis.origin[0]),mul(f.v,axis.origin[1]))),direction=add(mul(f.u,axis.direction[0]),mul(f.v,axis.direction[1]));
    const loopSolid=loop=>{const pen=draw(loop[0].a);for(const edge of loop)if(edge.kind==='line')pen.lineTo(edge.b);else pen.threePointsArcTo(edge.b,edgePoint(edge,.5));const sketch=pen.close().sketchOnPlane(plane);try{if(operation==='revolve')return sketch.revolve(direction,{origin,angle});if(operation!=='extrude')fail('Unbekannte Flächenoperation.');const height=number(params.height??10,'Aufbauhöhe');if(Math.abs(height)<.01)fail('Aufbauhöhe mindestens 0,01 mm.');return sketch.extrude(height);}finally{sketch.delete();}};
    try{for(const [i,id] of spec.regions.entries()){
      const region=regions.find(r=>r.id===id)||regions.find(r=>r.topologyId===spec.regionKeys?.[i]);if(!region)fail('Eine ausgewählte Skizzenfläche hat sich geändert. Freie Skizze öffnen und die Flächen erneut auswählen.');
      if(operation==='revolve')assertAxisOutside(region,axis);let solid;
      try{solid=loopSolid(region.outer);for(const hole of region.holes){const cut=loopSolid(hole);try{const next=solid.cut(cut);solid.delete();solid=next;}finally{cut.delete();}}const next=shape?shape.fuse(solid):solid.clone();shape?.delete();shape=next;}finally{solid?.delete();}
    }const ready=shape;shape=null;return ready;}finally{shape?.delete();plane.delete();}
  }
  function applyPatternTool(shape,tool,operation,pattern){
    let result=shape.clone();try{for(const transform of patternTransforms(pattern)){let copy=tool.clone();try{if(transform.angle)copy=copy.rotate(transform.angle,transform.center,transform.axis);copy=copy.translate(transform.translation);const next=operation==='cut'?result.cut(copy):result.fuse(copy);result.delete();result=next;}finally{copy.delete();}}validate(result);if(Math.abs(measureVolume(result)-measureVolume(shape))<EPS)fail('Bearbeitung berührt den Körper nicht oder ändert kein Volumen.');const ready=result;result=null;return ready;}finally{result?.delete();}
  }
  async function buildObject(spec,depth=0,keepLocal=false,budget={count:0}){
    if(++budget.count>150)fail('Maximal 150 Ausgangskörper einschließlich Kombinationen möglich.');
    if(depth>8)fail('Maximal acht verschachtelte Kombinationen möglich.');
    object(spec,'Körper');if(spec.locked!=null&&typeof spec.locked!=='boolean')fail('Körpersperre muss ein Wahrheitswert sein.');if(spec.density!=null&&number(spec.density,'Materialdichte',0)>30)fail('Materialdichte maximal 30 g/cm³.');const params=object(spec.params??{},'Maße');let shape,local;
    const p=key=>number(params[key]??SHAPES[spec.kind]?.params[key],key,key==='topRadius'?0:.005);
    try{
      if(spec.kind==='gear'||spec.kind==='thread'){const values=Object.fromEntries(Object.entries(SHAPES[spec.kind].params).map(([key,value])=>[key,number(params[key]??value,key,key==='bore'?0:.005)]));shape=spec.kind==='gear'?gear(values):thread(values);}
      else if(spec.kind==='box'||spec.kind==null){const w=number(params.width??30,'Breite',.01),d=number(params.depth??20,'Tiefe',.01),h=number(params.height??10,'Höhe',.01);shape=makeBox([-w/2,-d/2,0],[w/2,d/2,h]);}
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
      else if(spec.kind==='region')shape=regionTool(spec,budget);
      else if(spec.kind==='profile'){
        const plane=spec.plane??'XY';if(!['XY','XZ','YZ'].includes(plane))fail('Unbekannte Skizzenebene.');
        const multiple=spec.contours!=null;if(multiple&&!Array.isArray(spec.contours))fail('Konturliste erwartet.');
        shape=sketchTool([object(spec.profile,'Skizze'),...(spec.contours??[])],profile=>{
          const center=multiple?vector(profile.center??[0,0],'Konturmittelpunkt',2):[0,0];
          const drawing=profileDrawing(profile).rotate(number(profile.angle??0,'Skizzenwinkel')).translate(center);
          const operation=spec.operation??'extrude';
          if(operation==='extrude')return drawing.sketchOnPlane(plane).extrude(number(params.height??10,'Höhe',.01));
          if(operation==='loft'){
            const height=number(params.height??10,'Loft-Höhe',.01),endScale=number(params.topScale??loftDefaults.topScale,'Endmaß-Faktor',.01),angle=number(params.topAngle??0,'Endwinkel'),offset=[number(params.topU??0,'Endversatz U'),number(params.topV??0,'Endversatz V')];
            if(endScale>100)fail('Endmaß-Faktor maximal 100.');
            const first=drawing.sketchOnPlane(plane),last=drawing.clone().scale(endScale,[0,0]).rotate(angle).translate(offset).sketchOnPlane(plane,height);
            try{return first.loftWith(last,{ruled:true});}finally{first.delete();last.delete();}
          }
          if(operation==='sweep'){
            if(plane!=='XY')fail('Sweep benötigt eine XY-Skizze.');
            const points=validateSweepPath(spec.sweepPath),pen=draw([0,0]);
            for(const p of points.slice(1))pen.lineTo([p.x,p.y]);
            const path=pen.done().sketchOnPlane('XZ'),section=drawing.sketchOnPlane('XY'),pathWire=path.wires(),sectionWire=section.wires();
            try{return genericSweep(sectionWire,pathWire,{transitionMode:'right'});}
            finally{pathWire.delete();sectionWire.delete();path.delete();section.delete();}
          }
          if(operation!=='revolve')fail('Unbekannte Skizzenoperation.');
          const angle=number(params.revolveAngle??360,'Rotationswinkel',.01),offset=number(params.axisOffset??0,'Achsenposition');
          if(angle>360)fail('Der Rotationswinkel darf höchstens 360° betragen.');
          const axis={XY:[0,1,0],XZ:[0,0,1],YZ:[0,0,1]}[plane],origin={XY:[offset,0,0],XZ:[offset,0,0],YZ:[0,offset,0]}[plane];
          return drawing.sketchOnPlane(plane).revolve(axis,{origin,angle});
        });
      }
      else if(spec.kind==='boolean'){
        if(!['union','cut','intersect','hull'].includes(spec.operation)||!Array.isArray(spec.operands)||spec.operands.length<2||spec.operands.length>30)fail('Eine Kombination benötigt 2 bis 30 Ausgangskörper.');
        const parts=[];
        try{
          for(const operand of spec.operands)parts.push(await buildObject(operand,depth+1,false,budget));
          if(spec.operation==='hull')shape=convexHull(parts);
          else{shape=parts[0].clone();
          for(const other of parts.slice(1)){
            const before=measureVolume(shape),next=spec.operation==='union'?shape.fuse(other):spec.operation==='cut'?shape.cut(other):shape.intersect(other);
            shape.delete();shape=next;validate(shape);
            if(spec.operation==='cut'&&Math.abs(measureVolume(shape)-before)<EPS)fail('Die Körper überlappen sich nicht oder ändern das Volumen nicht.');
          }
        }}finally{parts.forEach(part=>part.delete());}
      }
      else if(spec.kind==='mirror'){
        const axis={x:[1,0,0],y:[0,1,0],z:[0,0,1]}[spec.axis];if(!Array.isArray(axis))fail('Spiegelachse X, Y oder Z erwartet.');
        const offset=number(spec.offset??0,'Spiegelebene'),source=await buildObject(object(spec.source,'Spiegelquelle'),depth+1,false,budget);
        try{shape=source.mirror(axis,mul(axis,offset));}finally{source.delete();}
      }
      else if(spec.kind==='imported')shape=await importSTEP(decodeSTEP(spec.sourceBase64));
      else fail('Unbekannter Grundkörper.');
      validate(shape);
      const features=spec.features??[];
      if(!Array.isArray(features)||features.length>50)fail('Maximal 50 Bearbeitungen pro Körper möglich.');
      spec.features=features;
      if(spec.rollback!=null&&(!Number.isInteger(spec.rollback)||spec.rollback<0||spec.rollback>features.length))fail('Ungültige Position im Modellverlauf.');
      for(const [i,feature] of features.entries()){
        object(feature,'Bearbeitung');if(feature.pattern&&!['extrude','pocket','region'].includes(feature.type))fail('Muster unterstützen Aufbau, Ausschneiden und freie Skizzenbearbeitungen.');
        if(feature.suppressed!=null&&typeof feature.suppressed!=='boolean')fail('Unterdrücken muss ein Wahrheitswert sein.');
        if(i>=(spec.rollback??features.length))break;
        if(feature.suppressed)continue;
        let next,prism;const entities=[];
        try{
          object(feature,'Bearbeitung');const bb=bounds(shape);
          if(feature.type==='region'){
            let supportFrame;
            if(feature.reference||feature.face!=null){const faces=shape.faces;entities.push(...faces);const support=resolve(faces,feature.face,feature.reference,bb,'face');feature.face=support.index;feature.reference=support.reference;supportFrame=frame(support.entity);}
            const toolSpec=feature.combine==='cut'&&feature.operation==='extrude'&&supportFrame?{...feature,params:{...feature.params,height:-(feature.params?.height??10)}}:feature;prism=regionTool(toolSpec,budget,supportFrame);next=applyPatternTool(shape,prism,feature.combine??'add',feature.pattern);
          }else if(feature.type==='extrude'||feature.type==='pocket'){
            const faces=shape.faces;entities.push(...faces);
            const support=resolve(faces,feature.face,feature.reference,bb,'face');
            feature.face=support.index;feature.reference=support.reference;
            if(feature.contours!=null&&!Array.isArray(feature.contours))fail('Konturliste erwartet.');
            if(feature.throughAll!=null&&typeof feature.throughAll!=='boolean')fail('Durch alles muss ein Wahrheitswert sein.');
            const depth=feature.type==='pocket'&&feature.throughAll?Math.hypot(...bb.max.map((v,i)=>v-bb.min[i]))+1:number(feature.depth??5,'Tiefe',.01);
            const f=frame(support.entity),rect=rectangleBounds(support.entity,f);feature.supportRectangle=!!rect;
            const legacyOrigin=support.legacy?frame(support.entity,true).origin:null;
            prism=sketchTool([object(feature.sketch,'Skizze'),...(feature.contours??[])],sk=>{
              sk.center=vector(sk.center??[0,0],'Skizzenmittelpunkt',2);
              if(legacyOrigin){const offset=add(legacyOrigin,mul(f.origin,-1));sk.center=sk.center.map((v,i)=>v+dot(offset,i===0?f.u:f.v));}
              const center=sk.constraints?positionedCenter(sk,rect):(sk.center??[0,0]);
              sk.center=vector(center,'Skizzenmittelpunkt',2);
              const origin=add(f.origin,add(mul(f.u,center[0]),mul(f.v,center[1]))),plane=new Plane(origin,f.u,f.normal);
              try{return profileDrawing(sk).rotate(number(sk.angle??0,'Skizzenwinkel')).sketchOnPlane(plane).extrude(depth*(feature.type==='pocket'?-1:1));}
              finally{plane.delete();}
            });
            const before=measureVolume(shape);
            next=applyPatternTool(shape,prism,feature.type==='extrude'?'add':'cut',feature.pattern);
            validate(next);
            if(Math.abs(measureVolume(next)-before)<EPS)fail('Skizze berührt den Körper nicht oder ändert kein Volumen.');
          }else if(feature.type==='surfaceTexture'){
            if(!Array.isArray(feature.targets)||!feature.targets.length||feature.targets.length>8)fail('Eine bis acht Flächen für die Oberflächenstruktur wählen.');
            const faces=shape.faces;entities.push(...faces);
            const selected=feature.targets.map(target=>resolve(faces,target.face,target.reference,bb,'face'));
            if(new Set(selected.map(s=>s.index)).size!==selected.length)fail('Flächen dürfen nicht doppelt ausgewählt sein.');
            feature.targets=selected.map(s=>({face:s.index,reference:s.reference}));
            next=shape.clone();
            for(const selectedFace of selected){const textured=cutSurfaceTexture(next,selectedFace.entity,object(feature.params,'Strukturmaße'),oc,budget);next.delete();next=textured;validate(next);}
          }else if(feature.type==='grip'){
            const layout=gripLayout(object(feature.params,'Griffmulden'),bb),cutters=[];
            try{for(const center of layout.centers)cutters.push(makeCylinder(layout.radius,layout.height,center));prism=makeCompound(cutters);}finally{cutters.forEach(cutter=>cutter.delete());}
            next=shape.cut(prism);validate(next);
            if(measureVolume(shape)-measureVolume(next)<EPS)fail('Die Griffmulden berühren den Körper nicht. Umfangsradius prüfen.');
          }else if(feature.type==='shell'){
            const thickness=number(feature.thickness,'Wandstärke',.01),faces=shape.faces;entities.push(...faces);
            if(feature.closed!=null&&typeof feature.closed!=='boolean')fail('Geschlossen muss ein Wahrheitswert sein.');
            const selected=feature.closed?null:resolve(faces,feature.face,feature.reference,bb,'face');if(selected){feature.face=selected.index;feature.reference=selected.reference;}
            const finder=new FaceFinder().inList(selected?[selected.entity]:[]);let inner;
            try{inner=shape.shell({filter:finder,thickness});if(feature.closed)next=shape.cut(inner);else{next=inner;inner=null;}}finally{finder.delete();inner?.delete();}
            validate(next);if(measureVolume(next)>=measureVolume(shape)-EPS)fail('Wandung konnte nicht nach innen erzeugt werden.');
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
    const project=assemble(expandGenerators(input)),models=[],ids=new Set(),budget={count:0,sketches:new Map()};project.version=1;
    if(project.sketches!=null&&(!Array.isArray(project.sketches)||project.sketches.length>32))fail('Maximal 32 freie Skizzen pro Projekt.');
    for(const sketch of project.sketches??[]){
      if(typeof sketch?.id!=='string'||!sketch.id||sketch.id.length>80||budget.sketches.has(sketch.id))fail('Skizzen-Kennungen müssen eindeutig sein.');
      const solved=solveSketch(sketch,project.variables??{});Object.assign(sketch,solved.sketch);sketchPlane(sketch.plane);budget.sketches.set(sketch.id,sketch);
    }
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
    const worldFrame=face=>{const f=frame(face),rect=rectangleBounds(face,f);return {sketchBounds:rect?{min:mul(rect.min,scale),max:mul(rect.max,scale)}:null,origin:add(rotatePoint(mul(f.origin,scale),rotation),position),normal:rotatePoint(f.normal,rotation),u:rotatePoint(f.u,rotation),v:rotatePoint(f.v,rotation)};};
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
      const physical=measureShapeVolumeProperties(shape);let centerOfMass;try{centerOfMass=physical.centerOfMass;}finally{physical.delete();}
      return {centerOfMass,id:spec.id,name:String(spec.name??spec.id).slice(0,200),mesh,faces:faceData,edges:edgeData,bounds:bb,volume:measureVolume(shape),valid:true};
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
    if(operation==='section'){
      const index=['x','y','z'].indexOf(payload.axis),offset=number(payload.offset,'Schnittposition');
      if(index<0||typeof payload.flip!=='boolean')fail('Ungültige Schnittebene.');
      const {models}=await buildProject(payload.project),objects=[];
      try{
        for(const {spec,shape} of models){
          if(spec.visible===false)continue;
          const bb=bounds(shape),min=bb.min.map(v=>v-1),max=bb.max.map(v=>v+1);
          if(payload.flip)min[index]=Math.max(min[index],offset);else max[index]=Math.min(max[index],offset);
          if(max[index]-min[index]<EPS)continue;
          const cutter=makeBox(min,max);let cut;
          try{cut=shape.intersect(cutter);if(measureVolume(cut)>EPS)objects.push(shapeJSON({id:spec.id,name:spec.name},cut));}
          finally{cut?.delete();cutter.delete();}
        }
        return {objects};
      }finally{models.forEach(m=>dispose(m.shape));}
    }
    if(operation==='measure'){
      if(typeof payload.first!=='string'||typeof payload.second!=='string'||payload.first===payload.second)fail('Zwei unterschiedliche Körper zum Messen wählen.');
      const {models}=await buildProject(payload.project);
      try{
        const first=models.find(m=>m.spec.id===payload.first),second=models.find(m=>m.spec.id===payload.second);
        if(!first||!second)fail('Ein Messkörper fehlt im Projekt.');
        const distance=measureDistanceBetween(first.shape,second.shape);
        if(!Number.isFinite(distance)||distance<0)fail('Abstand konnte nicht berechnet werden.');
        const overlap=first.shape.intersect(second.shape);let intersectionVolume;try{intersectionVolume=Math.max(0,measureVolume(overlap));}finally{overlap.delete();}
        return {distance,intersectionVolume,unit:'mm'};
      }finally{models.forEach(m=>dispose(m.shape));}
    }
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
