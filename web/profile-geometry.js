// Shared local contour coordinates for drawing, positioning and CAD validation.
export function profilePoints(p,segments=96){
 if(p.kind==='polyline')return (p.vertices??[]).map(v=>[v.x,v.y]);
 if(p.kind==='rectangle')return [[-p.width/2,-p.height/2],[p.width/2,-p.height/2],[p.width/2,p.height/2],[-p.width/2,p.height/2]];
 if(p.kind==='slot'){
  const horizontal=p.width>=p.height,r=Math.min(p.width,p.height)/2,d=Math.abs(p.width-p.height)/2;
  return Array.from({length:segments},(_,i)=>{const side=i<segments/2?1:-1,a=-Math.PI/2+2*Math.PI*i/segments;const x=side*d+r*Math.cos(a),y=r*Math.sin(a);return horizontal?[x,y]:[-y,x];});
 }
 const count=p.kind==='polygon'?p.sides:segments;
 return Array.from({length:count},(_,i)=>{const a=2*Math.PI*i/count+(p.kind==='polygon'?Math.PI/2:0);return [Math.cos(a)*(p.kind==='ellipse'?p.width/2:p.radius),Math.sin(a)*(p.kind==='ellipse'?p.height/2:p.radius)];});
}
export function validateVertices(vertices,{closed=true}={}){
 if(!Array.isArray(vertices)||vertices.length>(128)||vertices.length<(closed?3:0))throw new Error('Ein Linienzug braucht 3 bis 128 Punkte zum Schließen.');
 const ids=new Set();
 for(const v of vertices){
  if(!v||typeof v.id!=='string'||!v.id||v.id.length>80||ids.has(v.id)||![v.x,v.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000))throw new Error('Ungültiger oder doppelter Skizzenpunkt.');
  ids.add(v.id);
 }
 if(!closed)return vertices;
 const points=vertices.map(v=>[v.x,v.y]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const on=(a,b,c)=>Math.abs(cross(a,b,c))<1e-8&&c.every((v,i)=>v>=Math.min(a[i],b[i])-1e-8&&v<=Math.max(a[i],b[i])+1e-8);
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];
  if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-6)throw new Error('Zwei aufeinanderfolgende Punkte liegen aufeinander.');
  for(let j=i+1;j<points.length;j++){
   if(j===i+1||i===0&&j===points.length-1)continue;
   const c=points[j],d=points[(j+1)%points.length];
   if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))throw new Error('Der Linienzug überschneidet oder berührt sich selbst.');
  }
 }
 const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-a[1]*b[0];},0)/2;
 if(Math.abs(area)<1e-6)throw new Error('Der Linienzug umschließt keine Fläche.');
 return vertices;
}
