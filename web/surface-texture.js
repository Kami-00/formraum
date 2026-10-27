import {cast,makeCompound,makeLine,makeBSplineApproximation,assembleWire,drawCircle,Plane,genericSweep,measureVolume} from 'replicad';
const take=v=>{try{return v.toTuple();}finally{v.delete();}},sub=(a,b)=>a.map((v,i)=>v-b[i]),norm=v=>{const l=Math.hypot(...v);if(l<1e-9)throw Error('Die Fläche hat eine singuläre Richtung. Bitte eine andere Fläche wählen.');return v.map(x=>x/l);};
const distance=(a,b)=>Math.hypot(...sub(a,b));
const point=(face,u,v)=>take(face.pointOnSurface(u,v));
function metric(face,axis){let total=0,previous=point(face,axis? .5:0,axis?0:.5);for(let i=1;i<=32;i++){const p=point(face,axis?.5:i/32,axis?i/32:.5);total+=distance(previous,p);previous=p;}return total;}
function segment(a,b,c,w,h,pad){
 const corners=[[-pad,-pad],[w+pad,-pad],[w+pad,h+pad],[-pad,h+pad]],hits=[];
 for(let i=0;i<4;i++){const p=corners[i],q=corners[(i+1)%4],v=a*(q[0]-p[0])+b*(q[1]-p[1]);if(Math.abs(v)<1e-9)continue;const t=(c-a*p[0]-b*p[1])/v;if(t>=0&&t<=1){const hit=p.map((x,j)=>x+t*(q[j]-x));if(!hits.some(p=>distance(p,hit)<1e-8))hits.push(hit);}}
 return hits.length===2?hits:null;
}
export function textureParameters(p){
 const read=(key,fallback,min,max)=>{const n=p[key]??fallback;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw Error(`Oberflächenstruktur: ${key} muss zwischen ${min} und ${max} liegen.`);return n;};
 const mode=p.mode??'grooves';if(!['grooves','knurl'].includes(mode))throw Error('Unbekannte Oberflächenstruktur.');
 const count=read('count',12,2,48);if(!Number.isInteger(count))throw Error('Die Anzahl muss ganzzahlig sein.');
 const radius=read('radius',mode==='knurl'?.5:1,.05,100),depth=read('depth',radius,.01,radius),angle=read('angle',mode==='knurl'?45:0,-80,80);
 if(mode==='knurl'&&Math.abs(angle)<10)throw Error('Kreuzrändel: Winkel zwischen 10° und 80° wählen.');
 return {mode,count,radius,depth,angle};
}
// Sampled surface-following paths; tools are clipped to a native thickened,
// trimmed face (including holes), never to the bounding box of the whole body.
export function cutSurfaceTexture(shape,face,params,oc,budget){
 const p=textureParameters(params),w=metric(face,0),h=metric(face,1);
 if(Math.min(w,h)<.05||!Number.isFinite(w+h))throw Error('Diese Fläche ist zu klein oder singulär für eine Oberflächenstruktur.');
 const periodic=distance(point(face,0,.5),point(face,1,.5))<1e-5;
 let mask,result=shape.clone();
 const builder=new oc.BRepOffsetAPI_MakeThickSolid();
 try{
  builder.MakeThickSolidBySimple(face.wrapped,-p.depth-1e-4);mask=cast(builder.Shape());
  const check=new oc.BRepCheck_Analyzer(mask.wrapped,true,false,false);try{if(!check.IsValid())throw Error('Die Tiefe ist für diese Fläche zu groß.');}finally{check.delete();}
  for(const angle of p.mode==='knurl'?[Math.abs(p.angle),-Math.abs(p.angle)]:[p.angle]){
   const theta=angle*Math.PI/180,a=Math.cos(theta),b=-Math.sin(theta),range=[0,a*w,b*h,a*w+b*h],lo=Math.min(...range),hi=Math.max(...range);
   const pitch=periodic?Math.abs(a*w)/p.count:(hi-lo)/(p.count+1);
   if(pitch<=2*p.radius+1e-4)throw Error('Die Nuten liegen zu dicht. Anzahl oder Nutradius verkleinern.');
   const pad=Math.max(.005,Math.min(p.radius,.1)),start=periodic?Math.floor(lo/pitch)*pitch+pitch/2:lo+pitch,cutters=[];
   let compound,clipped;
   try{
    for(let c=start;c<hi-1e-6;c+=pitch){
     const ends=segment(a,b,c,w,h,pad);if(!ends)continue;
     budget.textureCuts=(budget.textureCuts??0)+1;if(budget.textureCuts>256)throw Error('Maximal 256 Strukturnuten pro Modellberechnung. Anzahl oder Flächenauswahl verkleinern.');
     const length=distance(...ends),steps=face.geomType==='PLANE'?1:Math.max(12,Math.min(96,Math.ceil(length/Math.max(.5,p.radius))));
     const points=Array.from({length:steps+1},(_,i)=>{const xy=ends[0].map((v,j)=>v+(ends[1][j]-v)*i/steps),q=point(face,xy[0]/w,xy[1]/h),normal=norm(take(face.normalAt(q)));return q.map((x,j)=>x+normal[j]*(p.radius-p.depth));});
     let edge,spine,plane,profile;
     try{
      edge=steps===1?makeLine(points[0],points.at(-1)):makeBSplineApproximation(points,{tolerance:.005,degMax:6});spine=assembleWire([edge]);
      plane=new Plane(points[0],null,norm(sub(points[1],points[0])));profile=drawCircle(p.radius).sketchOnPlane(plane);
      cutters.push(genericSweep(profile.wire,spine,{frenet:false}));
     }finally{edge?.delete();spine?.delete();profile?.delete();plane?.delete();}
    }
    if(!cutters.length)continue;
    if(p.mode==='knurl'&&!['PLANE','CYLINDRE'].includes(face.geomType)){
     for(const cutter of cutters){let portion;try{portion=mask.intersect(cutter);if(measureVolume(portion)>1e-7){const next=result.cut(portion);result.delete();result=next;}}finally{portion?.delete();}}
    }else{
     compound=makeCompound(cutters);clipped=mask.intersect(compound);
     if(measureVolume(clipped)>1e-7){const next=result.cut(clipped);result.delete();result=next;}
    }
   }finally{compound?.delete();clipped?.delete();cutters.forEach(c=>c.delete());}
  }
  if(measureVolume(shape)-measureVolume(result)<1e-7)throw Error('Auf der gewählten Fläche entstehen keine Nuten. Anzahl, Radius oder Richtung ändern.');
  const output=result;result=null;return output;
 }finally{builder.delete();mask?.delete();result?.delete();}
}
