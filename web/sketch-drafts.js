import {defaultSweepPath,loftDefaults} from './profile-operations.js';
import {validateVertices} from './profile-geometry.js';
export const DRAFT_PREFIX='formraum.sketch-draft.';
const copy=value=>structuredClone(value);
const fail=()=>{throw new Error('Der Skizzenentwurf ist ungültig. Die Sicherung bleibt unverändert erhalten.');};
const number=(v,min=-10000)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=10000;
const vector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(x=>number(x));
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(v);
const bodyId=v=>typeof v==='string'&&v.length>0&&v.length<=128;
function validBase(base){return base&&id(base.projectId)&&Number.isSafeInteger(base.revision)&&base.revision>=1&&base.project?.version===1&&Array.isArray(base.project.objects)&&base.project.objects.length<=30&&base.project.objects.every(o=>o&&typeof o==='object'&&bodyId(o.id)&&typeof o.kind==='string')&&new Set(base.project.objects.map(o=>o.id)).size===base.project.objects.length;}
export function validateDraft(value){
 if(!value||value.version!==1||typeof value.standalone!=='boolean'||!Array.isArray(value.profiles)||value.profiles.length<1||value.profiles.length>12||!Number.isInteger(value.activeContour)||value.activeContour<0||value.activeContour>=value.profiles.length||!number(value.depth,.01)||!number(value.snap,0)||typeof value.throughAll!=='boolean')fail();
 if(!value.standalone&&(!bodyId(value.bodyId)||!value.face||!Number.isInteger(value.face.id)||value.face.id<1||!value.face.reference||typeof value.face.reference!=='object'||Array.isArray(value.face.reference)))fail();
 for(const p of value.profiles){
  if(!p||!['rectangle','circle','ellipse','polygon','polyline','slot'].includes(p.kind)||!vector(p.center,2)||!number(p.width,.01)||!number(p.height,.01)||!number(p.radius,.01)||!number(p.angle)||!Number.isInteger(p.sides)||p.sides<3||p.sides>64||typeof p.hasDrawn!=='boolean'||!['solid','hole'].includes(p.role)||!['outline','center'].includes(p.distanceReference))fail();
  if(p.kind==='polyline'){try{validateVertices(p.vertices,{closed:false});if(typeof p.closed!=='boolean')fail();}catch{fail();}}
  for(const key of ['locks','invalid','constraints'])if(!p[key]||typeof p[key]!=='object'||Array.isArray(p[key]))fail();
  if(Object.values(p.locks).some(v=>typeof v!=='boolean')||Object.values(p.invalid).some(v=>typeof v!=='boolean'))fail();
  if(Object.keys(p.locks).some(k=>!['width','height','radius'].includes(k))||Object.keys(p.invalid).some(k=>!['width','height','radius','diameter','depth','snap','angle','sides','center-u','center-v','distance-u','distance-v','position','revolveAngle','axisOffset','vertices','topScale','topAngle','topU','topV','sweepPath'].includes(k)))fail();
  for(const [axis,c] of Object.entries(p.constraints))if(!['u','v'].includes(axis)||!c||!['min','max','center'].includes(c.mode)||(c.mode!=='center'&&!number(c.distance,0)))fail();
 }
 const operation=value.operation??'extrude',revolveAngle=value.revolveAngle??360,axisOffset=value.axisOffset??0;
 if(!['extrude','revolve','loft','sweep'].includes(operation)||!number(revolveAngle,.01)||revolveAngle>360||!number(axisOffset))fail();
 const loft={...loftDefaults,...value.loft},sweepPath=value.sweepPath??defaultSweepPath();
 if(!number(loft.topScale,.01)||loft.topScale>100||!['topAngle','topU','topV'].every(k=>number(loft[k]))||!Array.isArray(sweepPath)||sweepPath.length<2||sweepPath.length>32||sweepPath.some(p=>!p||!number(p.x)||!number(p.y)))fail();
 const keys=['kind','center','width','height','radius','angle','sides','hasDrawn','locks','invalid','constraints','distanceReference','role','vertices','closed'];
 return {version:1,...(value.operation!=null?{operation,revolveAngle,axisOffset,...(value.loft?{loft}:{}),...(value.sweepPath?{sweepPath:copy(sweepPath)}:{})}:{}),standalone:value.standalone,bodyId:value.standalone?null:value.bodyId,face:copy(value.face),profiles:value.profiles.map(p=>({...Object.fromEntries(keys.map(k=>[k,copy(p[k])])),constraints:Object.fromEntries(Object.entries(p.constraints).map(([axis,c])=>[axis,{mode:c.mode,...(c.mode==='center'?{}:{distance:c.distance})}]))})),activeContour:value.activeContour,depth:value.depth,snap:value.snap,throughAll:value.throughAll};
}
export function sameReference(a,b){
 if(typeof a==='number'||typeof b==='number')return typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-5;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>sameReference(v,b[i]));
 if(a&&b&&typeof a==='object'&&typeof b==='object')return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&sameReference(a[k],b[k]));
 return a===b;
}
export class SketchDraftStore{
 constructor(storage=localStorage,session=sessionStorage){
  this.storage=storage;this.session=session;
  // sessionStorage may be copied to another tab. Ownership must be per page instance.
  this.owner=crypto.randomUUID();
 }
 list(){
  const records=[];
  for(let i=0;i<this.storage.length;i++){
   const key=this.storage.key(i);if(!key?.startsWith(DRAFT_PREFIX))continue;
   try{const r=JSON.parse(this.storage.getItem(key));if(r.version!==1||key!==DRAFT_PREFIX+r.id||!id(r.id)||!id(r.owner)||!validBase(r)||typeof r.updatedAt!=='string'||!Number.isFinite(Date.parse(r.updatedAt)))continue;validateDraft(r.draft);records.push(r);}catch{/* Retain unreadable records; never replace them during recovery. */}
  }
  return records.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
 }
 save(base,draft,id=null){
  if(!validBase(base))fail();
  const current=id?this.list().find(r=>r.id===id):null;
  // Separate keys prevent one tab's unfinished sketch from replacing another's.
  const record={version:1,id:current?.owner===this.owner?id:crypto.randomUUID(),owner:this.owner,projectId:base.projectId,revision:base.revision,project:copy(base.project),draft:validateDraft(draft),updatedAt:new Date().toISOString()};
  try{this.storage.setItem(DRAFT_PREFIX+record.id,JSON.stringify(record));}
  catch{throw new Error('Skizzenentwurf konnte nicht im Browser gesichert werden. Bitte mit Speichern als Datei sichern.');}
  try{this.session.setItem('formraum.last-draft.'+base.projectId,record.id);}catch{}
  return record;
 }
 remove(id){if(this.list().some(r=>r.id===id&&r.owner===this.owner))this.storage.removeItem(DRAFT_PREFIX+id);try{this.session.setItem('formraum.dismissed-draft.'+id,'1');}catch{}}
 preferred(projectId,revision){
  const records=this.list().filter(r=>{try{if(this.session.getItem('formraum.dismissed-draft.'+r.id))return false;}catch{}return r.projectId===projectId&&r.revision===revision;});
  let last;try{last=this.session.getItem('formraum.last-draft.'+projectId);}catch{}
  return records.find(r=>r.owner===this.owner)||records.find(r=>r.id===last)||(records.length===1?records[0]:null);
 }
}
