import {planePreset} from './model-geometry.js';
import {evaluateExpression,resolveVariables} from './expressions.js';
import {validateEntities} from './sketch-regions.js';
const fail=m=>{throw new Error(m);},clone=structuredClone;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export const constraintNames={coincident:'Zusammenfallend',horizontal:'Horizontal',vertical:'Vertikal',parallel:'Parallel',perpendicular:'Rechtwinklig',tangent:'Tangential',equal:'Gleich',midpoint:'Mittelpunkt',symmetric:'Symmetrisch',length:'Länge',distance:'Abstand',radius:'Radius',angle:'Winkel',fixed:'Punkt fixieren'};
export function entityPaths(e){return e.kind==='line'?['a.0','a.1','b.0','b.1']:['center.0','center.1','radius',...(e.kind==='arc'?['start','sweep']:[])];}
export function readPath(o,path){return path.split('.').reduce((v,k)=>v?.[k],o);}
export function writePath(o,path,value){const keys=path.split('.'),last=keys.pop();let at=o;for(const k of keys){if(['__proto__','constructor','prototype'].includes(k)||at?.[k]==null)fail('Ungültiger Maßpfad.');at=at[k];}if(['__proto__','constructor','prototype'].includes(last)||typeof at[last]!=='number')fail('Maßpfad muss auf eine Zahl zeigen.');at[last]=value;}
function rank(matrix){if(!matrix.length)return 0;const a=matrix.map(r=>[...r]);let row=0;for(let col=0;col<a[0].length&&row<a.length;col++){let pivot=row;for(let i=row+1;i<a.length;i++)if(Math.abs(a[i][col])>Math.abs(a[pivot][col]))pivot=i;if(Math.abs(a[pivot][col])<1e-6)continue;[a[row],a[pivot]]=[a[pivot],a[row]];const d=a[row][col];for(let j=col;j<a[0].length;j++)a[row][j]/=d;for(let i=row+1;i<a.length;i++){const f=a[i][col];for(let j=col;j<a[0].length;j++)a[i][j]-=f*a[row][j];}row++;}return row;}
function linear(a,b){a=a.map((r,i)=>[...r,b[i]]);const n=b.length;for(let k=0;k<n;k++){let p=k;for(let i=k+1;i<n;i++)if(Math.abs(a[i][k])>Math.abs(a[p][k]))p=i;if(Math.abs(a[p][k])<1e-16)return null;[a[p],a[k]]=[a[k],a[p]];for(let i=k+1;i<n;i++){const f=a[i][k]/a[k][k];for(let j=k;j<=n;j++)a[i][j]-=f*a[k][j];}}const x=Array(n).fill(0);for(let i=n-1;i>=0;i--)x[i]=(a[i][n]-a[i].slice(i+1,n).reduce((s,v,j)=>s+v*x[i+j+1],0))/a[i][i];return x;}
export function solveSketch(input,variables={},extra=[]){
 const sketch=clone(input),values=resolveVariables(variables),constraints=[...(sketch.constraints??[]),...extra];
 if(!Array.isArray(sketch.constraints??[])||constraints.length>128)fail('Maximal 128 Skizzenbeziehungen.');
 if(sketch.planeSettings){const p=sketch.planeSettings;sketch.plane=planePreset(p.name,(p.origin??[0,0,0]).map(v=>evaluateExpression(v,n=>values[n])),(p.rotation??[0,0,0]).map(v=>evaluateExpression(v,n=>values[n])));}
 const entities=sketch.entities,byId=new Map(entities.map(e=>[e.id,e])),pins=[];
 for(const e of entities)for(const [path,expression] of Object.entries(e.bindings??{})){if(!entityPaths(e).includes(path))fail('Unbekanntes Skizzenmaß.');const value=evaluateExpression(expression,n=>values[n]);writePath(e,path,value);pins.push({e,path,value});}
 const involved=new Set(pins.map(p=>p.e.id));for(const c of constraints){if(!constraintNames[c.type])fail('Unbekannte Skizzenbeziehung.');for(const id of [c.a,c.b,c.axis].filter(Boolean)){if(!byId.has(id))fail('Eine Skizzenbeziehung verweist auf ein gelöschtes Element.');involved.add(id);}}
 const paths=entities.filter(e=>involved.has(e.id)).flatMap(e=>entityPaths(e).map(path=>({e,path})));if(paths.length>256)fail('Maximal 256 Koordinaten im Skizzensolver. Skizze aufteilen.');
 const total=entities.reduce((s,e)=>s+entityPaths(e).length,0),get=()=>paths.map(p=>readPath(p.e,p.path)),put=x=>paths.forEach((p,i)=>writePath(p.e,p.path,x[i]));
 const point=(e,key)=>{if(!e)fail('Bezugselement fehlt.');if(e.kind==='arc'&&['a','b'].includes(key)){const t=e.start+(key==='b'?e.sweep:0);return [e.center[0]+e.radius*Math.cos(t),e.center[1]+e.radius*Math.sin(t)];}const p=e[key??(e.kind==='line'?'a':'center')];if(!Array.isArray(p))fail('Ungültiger Bezugspunkt.');return p;};
 const line=e=>{if(e?.kind!=='line')fail('Diese Beziehung benötigt eine Linie.');const d=[e.b[0]-e.a[0],e.b[1]-e.a[1]],l=Math.hypot(...d);return {d,l,u:d.map(v=>v/Math.max(l,1e-12))};};
 const radius=e=>{if(!e||e.kind==='line')fail('Diese Beziehung benötigt einen Kreis oder Bogen.');return e.radius;};
 function residual(){const r=[];for(const c of constraints){const a=byId.get(c.a),b=byId.get(c.b),val=()=>evaluateExpression(c.value,n=>values[n]);
  if(c.type==='horizontal')r.push(line(a).d[1]);
  else if(c.type==='vertical')r.push(line(a).d[0]);
  else if(c.type==='length')r.push(line(a).l-val());
  else if(c.type==='radius')r.push(radius(a)-val());
  else if(c.type==='angle'){const v=val()*Math.PI/180,d=line(a).d;r.push((Math.atan2(d[1],d[0])-v+3*Math.PI)%(2*Math.PI)-Math.PI);}
  else if(c.type==='parallel'||c.type==='perpendicular'){const u=line(a).u,v=line(b).u;r.push(c.type==='parallel'?u[0]*v[1]-u[1]*v[0]:u[0]*v[0]+u[1]*v[1]);}
  else if(c.type==='equal')r.push(a.kind==='line'&&b?.kind==='line'?line(a).l-line(b).l:radius(a)-radius(b));
  else if(c.type==='tangent'){
   if(a.kind==='line'||b?.kind==='line'){const l=a.kind==='line'?a:b,round=a.kind==='line'?b:a,u=line(l).u;r.push(Math.abs((round.center[0]-l.a[0])*u[1]-(round.center[1]-l.a[1])*u[0])-radius(round));}
   else r.push(distance(a.center,b.center)-(c.internal?Math.abs(radius(a)-radius(b)):radius(a)+radius(b)));
  }else if(c.type==='midpoint'){const p=point(a,c.pa);line(b);r.push(p[0]-(b.a[0]+b.b[0])/2,p[1]-(b.a[1]+b.b[1])/2);}
  else{const p=point(a,c.pa);
   if(c.type==='fixed'){if(!Array.isArray(c.target)||c.target.length!==2||c.target.some(n=>!Number.isFinite(n)))fail('Fixpunkt benötigt zwei Koordinaten.');r.push(p[0]-c.target[0],p[1]-c.target[1]);}
   else{const q=point(b,c.pb);if(c.type==='coincident')r.push(p[0]-q[0],p[1]-q[1]);else if(c.type==='distance')r.push(distance(p,q)-val());else if(c.type==='symmetric'){const axis=byId.get(c.axis),u=line(axis).u,m=[(p[0]+q[0])/2-axis.a[0],(p[1]+q[1])/2-axis.a[1]];r.push(m[0]*u[1]-m[1]*u[0],(p[0]-q[0])*u[0]+(p[1]-q[1])*u[1]);}}
  }
 }for(const p of pins)r.push(readPath(p.e,p.path)-p.value);if(r.some(n=>!Number.isFinite(n)))fail('Skizzenbeziehung ist nicht berechenbar.');return r;}
 const jacobian=(x,r)=>{const j=r.map(()=>Array(x.length).fill(0));for(let k=0;k<x.length;k++){const h=1e-6*Math.max(1,Math.abs(x[k])),next=[...x];next[k]+=h;put(next);const rr=residual();for(let i=0;i<r.length;i++)j[i][k]=(rr[i]-r[i])/h;}put(x);return j;};
 let x=get(),r=residual(),lambda=1e-4;const norm=r=>r.reduce((s,n)=>s+n*n,0);
 for(let iter=0;iter<80&&r.some(n=>Math.abs(n)>1e-7);iter++){const j=jacobian(x,r),n=x.length,a=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0);for(let i=0;i<r.length;i++)for(let k=0;k<n;k++){b[k]-=j[i][k]*r[i];for(let l=0;l<n;l++)a[k][l]+=j[i][k]*j[i][l];}for(let k=0;k<n;k++)a[k][k]+=lambda;const delta=linear(a,b);if(!delta)break;const candidate=x.map((v,i)=>v+delta[i]);put(candidate);const rr=residual();if(norm(rr)<norm(r)){x=candidate;r=rr;lambda=Math.max(1e-10,lambda/4);}else{put(x);lambda*=10;}}
 if(r.some(v=>Math.abs(v)>1e-5))fail('Widersprüchliche Skizzenbeziehungen oder keine Lösung nahe der aktuellen Kontur. Letzten gültigen Stand beibehalten.');
 validateEntities(entities);const constrainedRank=rank(jacobian(x,r));return {sketch,dof:total-constrainedRank,redundant:r.length-constrainedRank};
}
