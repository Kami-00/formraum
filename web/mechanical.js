import {draw,makeCylinder,makeHelix,genericSweep,makePolygon,makeSolid,measureVolume} from 'replicad';
import {ConvexHull} from './vendor/ConvexHull.js';
import {Vector3} from './vendor/three.core.js';
export function gear(p){
 const {module:m,teeth:z,height,bore}=p;
 if(!Number.isInteger(z)||z<18||z>80||m<.2||m>5||bore<0)throw Error('Zahnrad: 18–80 ganze Zähne, Modul 0,2–5 und Bohrung ≥ 0.');
 const alpha=20*Math.PI/180,r=m*z/2,rb=r*Math.cos(alpha),root=r-1.25*m,tip=r+m,low=Math.max(root,rb);
 if(bore/2>=root-.2)throw Error('Bohrung zu groß für den Zahnfuß.');
 const inv=a=>Math.tan(a)-a,half=radius=>Math.PI/(2*z)+inv(alpha)-inv(Math.acos(rb/Math.max(rb,radius)));
 const points=[],point=(radius,a)=>points.push([radius*Math.cos(a),radius*Math.sin(a)]);
 for(let i=0;i<z;i++){
  const a=i*2*Math.PI/z;
  if(root<low)point(root,a-half(low));
  for(let j=0;j<=6;j++){const rr=low+(tip-low)*j/6;point(rr,a-half(rr));}
  for(let j=1;j<=3;j++)point(tip,a-half(tip)+2*half(tip)*j/3);
  for(let j=5;j>=0;j--){const rr=low+(tip-low)*j/6;point(rr,a+half(rr));}
  if(root<low)point(root,a+half(low));
 }
 const pen=draw(points[0]);points.slice(1).forEach(v=>pen.lineTo(v));let result=pen.close().sketchOnPlane('XY').extrude(height);
 if(bore){const hole=makeCylinder(bore/2,height);try{const next=result.cut(hole);result.delete();result=next;}finally{hole.delete();}}
 return result;
}
export function thread(p){
 const {diameter:d,pitch,height}=p,r=d/2,depth=.55*pitch,root=r-depth;
 if(pitch<.2||root<=pitch||height/pitch>24||height<pitch)throw Error('Gewinde: mindestens eine, maximal 24 Windungen; Durchmesser muss größer als 3,1 × Steigung sein.');
 // Slightly overlapping single turns avoid OC classification failures on long helical faces.
 const spine=makeHelix(pitch,pitch*1.001,root);
 const sk=draw([root-.2*pitch,-.4*pitch]).lineTo([r,-.08*pitch]).lineTo([r,.08*pitch]).lineTo([root-.2*pitch,.4*pitch]).close().sketchOnPlane('XZ');
 let tooth,core,trim;
 try{
  tooth=genericSweep(sk.wire,spine,{frenet:true,forceProfileSpineOthogonality:true});
  core=makeCylinder(root,height+4*pitch).translateZ(-2*pitch);
  for(let turn=-1;turn<=Math.ceil(height/pitch);turn++){
   const segment=tooth.clone().translateZ(turn*pitch);let next;
   try{next=core.fuse(segment);}finally{segment.delete();}
   core.delete();core=next;
  }
  trim=makeCylinder(r+.1,height);const result=core.intersect(trim),volume=measureVolume(result);
  if(volume<=Math.PI*root*root*height*1.001||volume>=Math.PI*r*r*height*.999){result.delete();throw Error('Gewinde konnte mit diesen Maßen nicht zuverlässig erzeugt werden.');}
  return result;
 }finally{sk.delete();spine.delete();tooth?.delete();core?.delete();trim?.delete();}
}
export function convexHull(parts){
 const points=new Map();
 for(const part of parts){const mesh=part.mesh({tolerance:.2,angularTolerance:.3});for(let i=0;i<mesh.vertices.length;i+=3){const p=mesh.vertices.slice(i,i+3);points.set(p.map(v=>Math.round(v*1e6)).join(','),new Vector3(...p));}}
 if(points.size>6000)throw Error('Hull ist auf 6000 Stützpunkte begrenzt. Bitte einfachere Körper wählen.');
 const hull=new ConvexHull().setFromPoints([...points.values()]);if(hull.faces.length>2500)throw Error('Hull ist zu komplex.');
 const faces=[];try{for(const f of hull.faces){let e=f.edge;const p=[];do{p.push(e.head().point.toArray());e=e.next;}while(e!==f.edge);faces.push(makePolygon(p));}return makeSolid(faces);}finally{faces.forEach(f=>f.delete());}
}
