// Exact axis-aligned extents of the rotated profile, relative to its center.
export function profileExtents(s){
 const a=(s.angle??0)*Math.PI/180,c=Math.cos(a),t=Math.sin(a);
 if(s.kind==='circle')return {min:[-s.radius,-s.radius],max:[s.radius,s.radius]};
 if(s.kind==='ellipse'){
  const x=Math.hypot(s.width/2*c,s.height/2*t),y=Math.hypot(s.width/2*t,s.height/2*c);
  return {min:[-x,-y],max:[x,y]};
 }
 let points;
 if(s.kind==='rectangle')points=[[-s.width/2,-s.height/2],[s.width/2,-s.height/2],[s.width/2,s.height/2],[-s.width/2,s.height/2]];
 else if(s.kind==='polygon'&&Number.isInteger(s.sides)&&s.sides>=3&&s.sides<=64)points=Array.from({length:s.sides},(_,i)=>{const a=Math.PI/2+2*Math.PI*i/s.sides;return [Math.cos(a)*s.radius,Math.sin(a)*s.radius];});
 else throw new Error('Unbekannte oder ungültige Skizzenkontur.');
 const rotated=points.map(([x,y])=>[x*c-y*t,x*t+y*c]);
 return {min:[0,1].map(i=>Math.min(...rotated.map(p=>p[i]))),max:[0,1].map(i=>Math.max(...rotated.map(p=>p[i])))};
}
export function positionedCenter(s,bounds){
 const center=[...(s.center??[0,0])],extents=profileExtents(s);
 if(s.distanceReference!=null&&!['outline','center'].includes(s.distanceReference))throw new Error('Unbekannter Maßbezug.');
 if([...extents.min,...extents.max].some(v=>!Number.isFinite(v)))throw new Error('Ungültige Skizzenmaße.');
 const constraints=s.constraints??{};
 if(!constraints||typeof constraints!=='object'||Array.isArray(constraints)||Object.keys(constraints).some(k=>!['u','v'].includes(k)))throw new Error('Ungültige Positionsbezüge.');
 for(const [i,axis] of ['u','v'].entries()){
  const constraint=constraints[axis];if(constraint==null)continue;
  if(!['min','max','center'].includes(constraint.mode))throw new Error('Unbekannter Positionsbezug.');
  if(constraint.mode==='center'){center[i]=bounds?(bounds.min[i]+bounds.max[i]-extents.min[i]-extents.max[i])/2:0;continue;}
  if(!bounds)throw new Error('Kantenabstände benötigen eine rechteckige, zu U/V ausgerichtete Außenkontur der Bezugsfläche.');
  const d=constraint.distance;
  if(typeof d!=='number'||!Number.isFinite(d)||d<0||d>10000)throw new Error('Kantenabstand: gültige Zahl zwischen 0 und 10000 mm erwartet.');
  center[i]=constraint.mode==='min'?bounds.min[i]+d-(s.distanceReference==='center'?0:extents.min[i]):bounds.max[i]-d-(s.distanceReference==='center'?0:extents.max[i]);
 }
 return center;
}
