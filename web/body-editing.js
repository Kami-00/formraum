// A body lock protects modelling data, while visibility and unlocking remain available.
export function assertUnlockedChanges(before,after,{resolved=false}={}){
 const geometry=(body,project)=>{const {visible,locked,...data}=body;const ids=new Set();const visit=o=>{if(o.sketchId)ids.add(o.sketchId);if(o.source)visit(o.source);for(const child of o.operands??[])visit(child);};visit(body);return JSON.stringify([data,[...ids].map(id=>project.sketches?.find(s=>s.id===id))]);};
 for(const old of before.objects.filter(o=>o.locked)){
  if(old.generated){
   if(resolved||!(after.generators??[]).some(g=>g.id===old.generated.generatorId))continue;
   const next=after.objects.find(o=>o.id===old.id);
   if(!next||geometry(old,before)!==geometry(next,before)||!next.locked)throw new Error('Generatorkörper im Generator-Editor bearbeiten oder zuerst in freie Körper umwandeln.');
   continue;
  }
  const next=after.objects.find(o=>o.id===old.id);
  if(!next||geometry(old,before)!==geometry(next,after))throw new Error(`„${old.name||old.id}“ ist gesperrt. Den Körper zuerst entsperren.`);
 }
}
export function referencedSketches(project,bodies){
 const ids=new Set();const visit=o=>{if(o.sketchId)ids.add(o.sketchId);if(o.source)visit(o.source);for(const child of o.operands??[])visit(child);};bodies.forEach(visit);
 return structuredClone((project.sketches??[]).filter(s=>ids.has(s.id)));
}
export function pasteBodies(project,bodies,offset=5,newId=()=>crypto.randomUUID(),sourceSketches=[]){
 if(!Array.isArray(bodies)||!bodies.length)throw new Error('Die Formraum-Zwischenablage ist leer.');
 if(project.objects.length+bodies.length>30)throw new Error('Maximal 30 Körper pro Projekt möglich.');
 const copies=structuredClone(bodies).map(o=>({...o,id:newId(),name:(o.name||'Körper')+' Kopie',locked:false,visible:true,position:(o.position??[0,0,0]).map((v,i)=>v+(i===0?offset:0))}));
 copies.forEach(o=>delete o.generated);
 const next={...structuredClone(project),objects:[...structuredClone(project.objects),...copies]},remap=new Map();
 if(sourceSketches.length){next.sketches??=[];for(const source of referencedSketches({sketches:sourceSketches},copies)){const existing=next.sketches.find(s=>s.id===source.id);if(existing&&JSON.stringify(existing)===JSON.stringify(source))continue;const previous=source.id;if(existing){source.id=newId();remap.set(previous,source.id);}next.sketches.push(source);}}
 const update=o=>{if(remap.has(o.sketchId))o.sketchId=remap.get(o.sketchId);if(o.source)update(o.source);for(const child of o.operands??[])update(child);};copies.forEach(update);
 return {project:next,ids:copies.map(o=>o.id)};
}
