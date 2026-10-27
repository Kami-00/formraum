// Planar arrangement of finite lines and exact circles. Tessellation is never used
// to construct CAD geometry: split circular arcs retain center/radius/angles.
const TAU=2*Math.PI,EPS=1e-7;
const fail=message=>{throw new Error(message);};
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1],cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const distance=(a,b)=>Math.hypot(...sub(a,b)),mod=a=>(a%TAU+TAU)%TAU;
const point=(p,label)=>{if(!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>10000))fail(`${label}: zwei gültige Koordinaten bis ±10000 mm erwartet.`);return p;};
export function validateEntities(entities){
 if(!Array.isArray(entities)||entities.length>128)fail('Maximal 128 Linien und Kreise pro freier Skizze.');
 const ids=new Set();
 for(const e of entities){
  if(!e||typeof e.id!=='string'||!e.id||e.id.length>80||ids.has(e.id))fail('Skizzenelemente benötigen eindeutige Kennungen.');ids.add(e.id);
  if(e.kind==='line'){point(e.a,'Linienstart');point(e.b,'Linienende');if(distance(e.a,e.b)<.001)fail('Eine Linie muss mindestens 0,001 mm lang sein.');}
  else if(e.kind==='circle'||e.kind==='arc'){point(e.center,'Kreismittelpunkt');if(typeof e.radius!=='number'||!Number.isFinite(e.radius)||e.radius<.005||e.radius>10000)fail('Kreisradius zwischen 0,005 und 10000 mm eingeben.');}
  else fail('Freie Skizzen unterstützen Linien und Kreise.');
 }
 return entities;
}
export function edgePoint(edge,t){
 if(edge.kind==='line')return edge.a.map((v,i)=>v+(edge.b[i]-v)*t);
 const angle=edge.start+edge.sweep*t;return [edge.center[0]+edge.radius*Math.cos(angle),edge.center[1]+edge.radius*Math.sin(angle)];
}
const reverse=edge=>edge.kind==='line'?{...edge,a:edge.b,b:edge.a}:{...edge,start:edge.start+edge.sweep,sweep:-edge.sweep,a:edge.b,b:edge.a};
const tangent=edge=>edge.kind==='line'?sub(edge.b,edge.a):[-Math.sin(edge.start)*Math.sign(edge.sweep),Math.cos(edge.start)*Math.sign(edge.sweep)];
const edgeArea=e=>e.kind==='line'?cross(e.a,e.b)/2:(e.radius*e.center[0]*(Math.sin(e.start+e.sweep)-Math.sin(e.start))+e.radius*e.center[1]*(Math.cos(e.start)-Math.cos(e.start+e.sweep))+e.radius**2*e.sweep)/2;
function arcFraction(edge,angle){return edge.sweep>0?mod(angle-edge.start)/edge.sweep:mod(edge.start-angle)/-edge.sweep;}
export function inLoop(p,loop){
 let crossings=0;
 for(const e of loop){
  if(e.kind==='line'){
   if((e.a[1]>p[1])!==(e.b[1]>p[1])&&e.a[0]+(p[1]-e.a[1])*(e.b[0]-e.a[0])/(e.b[1]-e.a[1])>p[0])crossings++;
  }else{
   const s=(p[1]-e.center[1])/e.radius;if(Math.abs(s)>=1)continue;
   const angle=Math.asin(s);
   for(const theta of [angle,Math.PI-angle]){
    let t=arcFraction(e,theta);if(Math.abs(t-TAU/Math.abs(e.sweep))<1e-9)t=0;
    const dy=Math.cos(theta)*e.sweep;
    if(e.center[0]+e.radius*Math.cos(theta)<=p[0]||Math.abs(dy)<1e-12)continue;
    if(t>1e-9&&t<1-1e-9||Math.abs(t)<1e-9&&dy>0||Math.abs(t-1)<1e-9&&dy<0)crossings++;
   }
  }
 }
 return crossings%2===1;
}
export const inRegion=(point,region)=>inLoop(point,region.outer)&&!region.holes.some(h=>inLoop(point,h));
function key(text){let a=2166136261,b=0x9e3779b9;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),2246822519);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}

export function findRegions(input){
 const entities=validateEntities(input).filter(e=>!e.construction).map(e=>e.kind==='arc'&&e.sweep<0?{...e,start:e.start+e.sweep,sweep:-e.sweep}:e),cuts=entities.map(e=>e.kind==='line'?[0,1]:e.kind==='arc'?[e.start,e.start+e.sweep,...[1,2,3].map(i=>e.start+e.sweep*i/4)]:[0,Math.PI/2,Math.PI,3*Math.PI/2,TAU]);
 const at=(e,t)=>e.kind==='line'?e.a.map((v,i)=>v+(e.b[i]-v)*t):[e.center[0]+e.radius*Math.cos(t),e.center[1]+e.radius*Math.sin(t)];
 const parameter=(e,p)=>e.kind==='line'?dot(sub(p,e.a),sub(e.b,e.a))/dot(sub(e.b,e.a),sub(e.b,e.a)):(e.kind==='arc'?e.start+mod(Math.atan2(p[1]-e.center[1],p[0]-e.center[0])-e.start):mod(Math.atan2(p[1]-e.center[1],p[0]-e.center[0])));
 const addCut=(i,p)=>{const e=entities[i],t=parameter(e,p);if(e.kind==='circle'||e.kind==='arc'&&t<=e.start+e.sweep+EPS||e.kind==='line'&&t>=-EPS&&t<=1+EPS)cuts[i].push(e.kind==='line'?Math.max(0,Math.min(1,t)):t);};
 for(let i=0;i<entities.length;i++)for(let j=i+1;j<entities.length;j++){
  const a=entities[i],b=entities[j],points=[];
  if(a.kind==='line'&&b.kind==='line'){
   const r=sub(a.b,a.a),s=sub(b.b,b.a),q=sub(b.a,a.a),den=cross(r,s);
   if(Math.abs(den)>EPS){const t=cross(q,s)/den,u=cross(q,r)/den;if(t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS)points.push(at(a,t));}
   else if(Math.abs(cross(q,r))<EPS){for(const p of [a.a,a.b,b.a,b.b]){const t=parameter(a,p),u=parameter(b,p);if(t>=-EPS&&t<=1+EPS&&u>=-EPS&&u<=1+EPS)points.push(p);}}
  }else if(a.kind!=='line'&&b.kind!=='line'){
   const d=distance(a.center,b.center);
   if(d>EPS&&d<=a.radius+b.radius+EPS&&d>=Math.abs(a.radius-b.radius)-EPS){
    const x=(a.radius*a.radius-b.radius*b.radius+d*d)/(2*d),h=Math.sqrt(Math.max(0,a.radius*a.radius-x*x)),v=sub(b.center,a.center).map(n=>n/d),c=a.center.map((n,k)=>n+x*v[k]);
    points.push([c[0]-h*v[1],c[1]+h*v[0]]);if(h>EPS)points.push([c[0]+h*v[1],c[1]-h*v[0]]);
   }
  }else{
   const line=a.kind==='line'?a:b,circle=a.kind!=='line'?a:b,r=sub(line.b,line.a),v=sub(line.a,circle.center),aa=dot(r,r),bb=2*dot(v,r),cc=dot(v,v)-circle.radius**2,discriminant=bb*bb-4*aa*cc;
   if(discriminant>=-EPS){const d=Math.sqrt(Math.max(0,discriminant));for(const t of [(-bb-d)/(2*aa),(-bb+d)/(2*aa)])if(t>=-EPS&&t<=1+EPS)points.push(at(line,t));}
  }
  for(const p of points){if([a,b].some(e=>e.kind==='arc'&&parameter(e,p)>e.start+e.sweep+EPS))continue;addCut(i,p);addCut(j,p);}
 }
 const vertices=[],edges=[],unique=new Set();
 const vertex=p=>{let index=vertices.findIndex(v=>distance(v,p)<EPS);if(index<0){index=vertices.length;vertices.push(p);}return index;};
 for(const [i,e] of entities.entries()){
  const parameters=cuts[i].sort((a,b)=>a-b).filter((t,j,list)=>j===0||t-list[j-1]>1e-10);
  for(let j=1;j<parameters.length;j++){
   const start=parameters[j-1],end=parameters[j],a=at(e,start),b=at(e,end),u=vertex(a),v=vertex(b);if(u===v)continue;
   const part=e.kind==='line'?{kind:'line',a:vertices[u],b:vertices[v]}:{kind:'arc',a:vertices[u],b:vertices[v],center:e.center,radius:e.radius,start,sweep:end-start};
   const middle=edgePoint(part,.5),geometryKey=[Math.min(u,v),Math.max(u,v),...middle.map(n=>Math.round(n/EPS))].join(':');if(unique.has(geometryKey))continue;unique.add(geometryKey);
   edges.push({u,v,part,token:e.id+':'+(j-1)});if(edges.length>2048)fail('Zu viele Schnittpunkte. Die Skizze bitte aufteilen.');
  }
 }
 const adjacency=vertices.map(()=>[]);edges.forEach((e,i)=>{adjacency[e.u].push(i);adjacency[e.v].push(i);});
 // Open branches cannot bound material, even when attached to a closed contour.
 const seen=new Map(),low=new Map(),bridges=new Set();let time=0;
 function visit(u,parent=-1){seen.set(u,++time);low.set(u,time);for(const id of adjacency[u]){if(id===parent)continue;const e=edges[id],v=e.u===u?e.v:e.u;if(!seen.has(v)){visit(v,id);low.set(u,Math.min(low.get(u),low.get(v)));if(low.get(v)>seen.get(u))bridges.add(id);}else low.set(u,Math.min(low.get(u),seen.get(v)));}}
 for(let i=0;i<vertices.length;i++)if(!seen.has(i))visit(i);
 const halves=[],outgoing=vertices.map(()=>[]);
 edges.forEach((e,id)=>{if(bridges.has(id))return;const h=halves.length;halves.push({from:e.u,to:e.v,edge:e.part,token:e.token+'+',twin:h+1},{from:e.v,to:e.u,edge:reverse(e.part),token:e.token+'-',twin:h});outgoing[e.u].push(h);outgoing[e.v].push(h+1);});
 const direction=h=>{const e=halves[h].edge,t=tangent(e);return mod(Math.atan2(t[1],t[0])+(e.kind==='arc'?Math.sign(e.sweep)*1e-8:0));};
 outgoing.forEach(list=>list.sort((a,b)=>direction(a)-direction(b)));
 const used=new Set(),loops=[];
 for(let start=0;start<halves.length;start++){
  if(used.has(start))continue;let cursor=start;const loop=[],tokens=[];
  do{if(used.has(cursor)){if(cursor!==start)fail('Mehrdeutige Skizzenverbindung.');break;}used.add(cursor);const h=halves[cursor];loop.push(h.edge);tokens.push(h.token);const next=outgoing[h.to],index=next.indexOf(h.twin);cursor=next[(index+next.length-1)%next.length];}while(cursor!==start);
  const area=loop.reduce((sum,e)=>sum+edgeArea(e),0);if(area>1e-8)loops.push({edges:loop,area,tokens});
 }
 if(loops.length>128)fail('Maximal 128 geschlossene Bereiche pro Skizze.');
 for(const loop of loops){
  const e=loop.edges[0],p=edgePoint(e,.5),t=e.kind==='line'?sub(e.b,e.a):[-Math.sin(e.start+e.sweep/2)*Math.sign(e.sweep),Math.cos(e.start+e.sweep/2)*Math.sign(e.sweep)],length=Math.hypot(...t);
  loop.probe=[p[0]-t[1]/length*1e-6,p[1]+t[0]/length*1e-6];
  loop.parent=loops.filter(other=>other!==loop&&other.area>loop.area+1e-8&&inLoop(loop.probe,other.edges)).sort((a,b)=>a.area-b.area)[0];
 }
 return loops.map(loop=>{
  const holes=loops.filter(other=>other.parent===loop).map(other=>other.edges);
  const edgeKeys=loop.edges.map(e=>JSON.stringify(e,(_,v)=>typeof v==='number'?Math.round(v*1e8)/1e8:v));
  let first=0;for(let i=1;i<edgeKeys.length;i++)if(edgeKeys[i]<edgeKeys[first])first=i;
  const canonical=[...edgeKeys.slice(first),...edgeKeys.slice(0,first)].join('|');
  const tokenKey=loop.tokens.map((_,i)=>[...loop.tokens.slice(i),...loop.tokens.slice(0,i)].join('|')).sort()[0];
  return {id:'r_'+key(canonical),topologyId:'t_'+key(tokenKey),outer:loop.edges,holes,area:loop.area-holes.reduce((sum,h)=>sum+h.reduce((s,e)=>s+edgeArea(e),0),0)};
 });
}
export function regionAxis(spec,entities){
 const offset=spec.params?.axisOffset??0;if(typeof offset!=='number'||!Number.isFinite(offset)||Math.abs(offset)>10000)fail('Ungültige Achsenposition.');
 if(spec.axis==='line'){const e=entities.find(e=>e.id===spec.axisEntityId&&e.kind==='line');if(!e)fail('Die gewählte Drehachsen-Linie fehlt.');return {origin:e.a,direction:sub(e.b,e.a)};}
 if(spec.axis!=null&&!['u','v'].includes(spec.axis))fail('Drehachse U, V oder eine gezeichnete Linie wählen.');
 return spec.axis==='u'?{origin:[0,offset],direction:[1,0]}:{origin:[offset,0],direction:[0,1]};
}
export function assertAxisOutside(region,axis){
 const length=Math.hypot(...axis.direction),normal=[axis.direction[1]/length,-axis.direction[0]/length],values=[];
 for(const e of region.outer){
  const points=[e.a,e.b];if(e.kind==='arc')for(const angle of [Math.atan2(normal[1],normal[0]),Math.atan2(normal[1],normal[0])+Math.PI]){const t=arcFraction(e,angle);if(t<=1+1e-9)points.push(edgePoint(e,t));}
  points.forEach(p=>values.push(dot(sub(p,axis.origin),normal)));
 }
 if(Math.min(...values)<-EPS&&Math.max(...values)>EPS)fail('Die Drehachse darf eine ausgewählte Fläche nicht durchschneiden. Achse an den Rand oder außerhalb legen.');
}
