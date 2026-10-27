import {patternTransforms} from './model-geometry.js';
import {bindMeasures} from './model-parameters.js';
import {Matrix4,Vector3,Quaternion,Euler} from './vendor/three.module.js';
import {evaluateExpression,resolveVariables} from './expressions.js';

const fail=message=>{throw new Error(message);};
const radians=Math.PI/180;
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(id);
const axes={x:new Vector3(1,0,0),y:new Vector3(0,1,0),z:new Vector3(0,0,1)};
// Numeric paths only: names, IDs, STEP data and geometric references stay literal.
export function bindParameters(body,values,depth=0){
 if(depth>8)fail('Körper zu tief verschachtelt.');
 const copy=bindMeasures(body,values);
 if(copy.expressions!=null){
  if(typeof copy.expressions!=='object'||Array.isArray(copy.expressions)||Object.keys(copy.expressions).length>64)fail('Ungültige Maßformeln.');
  for(const [key,expression] of Object.entries(copy.expressions)){
   if(!Object.hasOwn(copy.params??{},key)||typeof copy.params[key]!=='number')fail(`Unbekanntes Formelmaß: ${key}`);
   copy.params[key]=evaluateExpression(expression,name=>values[name]);
  }
 }
 if(copy.source)copy.source=bindParameters(copy.source,values,depth+1);
 if(copy.operands)copy.operands=copy.operands.map(o=>bindParameters(o,values,depth+1));
 return copy;
}
export function expandGenerators(input){
 const project=structuredClone(input),values=resolveVariables(project.variables??{}),generators=project.generators??[];
 if(!Array.isArray(generators)||generators.length>16)fail('Maximal 16 Generatoren möglich.');
 for(const body of project.objects)if(body.generated&&!generators.some(g=>g.id===body.generated.generatorId))fail('Generatorkörper ohne zugehörigen Generator. Quelle wiederherstellen oder Körper ausdrücklich ablösen.');
 const ids=new Set(),old=new Map(project.objects.map(o=>[o.id,o]));
 project.objects=project.objects.filter(o=>!o.generated).map(o=>bindParameters(o,values));
 const evaluate=value=>evaluateExpression(value,name=>values[name]);
 const vector=(value,label)=>{if(!Array.isArray(value)||value.length!==3)fail(`${label}: drei Werte erwartet.`);return value.map(evaluate);};
 function matrix(node){
  const position=vector(node.position??[0,0,0],'Position'),rotation=vector(node.rotation??[0,0,0],'Drehung'),scale=evaluate(node.scale??1);
  if(scale<.001||scale>1000)fail('Skalierung zwischen 0,001 und 1000 wählen.');
  return new Matrix4().compose(new Vector3(...position),new Quaternion().setFromEuler(new Euler(...rotation.map(x=>x*radians),'ZYX')),new Vector3(scale,scale,scale));
 }
 let visits=0;
 for(const generator of generators){
  if(!validId(generator.id)||ids.has(generator.id))fail('Generator-Kennungen müssen eindeutig sein.');ids.add(generator.id);
  if(!Array.isArray(generator.nodes)||!generator.nodes.length||generator.nodes.length>64)fail('Ein Generator benötigt 1 bis 64 Elemente.');
  const nodes=new Map();for(const node of generator.nodes){if(!validId(node.id)||nodes.has(node.id))fail('Element-Kennungen müssen eindeutig sein.');nodes.set(node.id,node);}
  // Validate every ancestry chain, including cycles with no root.
  for(const node of nodes.values()){
   const seen=new Set();let ancestor=node;
   while(ancestor){if(seen.has(ancestor.id)||seen.size>=8)fail('Children: Zyklus oder mehr als acht Hierarchieebenen.');seen.add(ancestor.id);if(!ancestor.parentId)break;ancestor=nodes.get(ancestor.parentId);if(!ancestor)fail('Elternelement fehlt.');}
  }
  function emit(node,parent,path){
   if(++visits>512)fail('Generator enthält zu viele verschachtelte Wiederholungen.');
   const pattern=node.pattern??{mode:'none'},mode=pattern.mode??'none';
   if(!['none','linear','circular','path'].includes(mode))fail('Unbekanntes Generatormuster.');
   const count=mode==='none'?1:evaluate(pattern.count??2);
   if(!Number.isInteger(count)||count<1||count>30)fail('Musteranzahl muss ganzzahlig zwischen 1 und 30 sein.');
   const base=matrix(node);let step,angle,axis,center;const pathTransforms=mode==='path'?patternTransforms({mode,count,points:pattern.points?.map(p=>vector(p,'Pfadpunkt'))}):null;
   if(mode==='linear'){step=vector(pattern.step??[20,0,0],'Musterabstand');if(count>1&&step.every(n=>n===0))fail('Musterabstand darf nicht null sein.');}
   if(mode==='circular'){
    axis=axes[pattern.axis??'z'];if(!axis)fail('Musterachse X, Y oder Z wählen.');
    angle=evaluate(pattern.angle??360);if(Math.abs(angle)>360||Math.abs(angle)<.001)fail('Musterwinkel zwischen −360° und 360°, ungleich null wählen.');
    center=new Vector3(...vector(pattern.center??[0,0,0],'Musterzentrum'));
   }
   for(let index=0;index<count;index++){
    const repeat=new Matrix4();
    if(mode==='path')repeat.makeTranslation(...pathTransforms[index].translation);
    if(mode==='linear')repeat.makeTranslation(...step.map(v=>v*index));
    if(mode==='circular'){
     const a=angle*radians*index/(count===1?1:Math.abs(angle)===360?count:count-1);
     repeat.makeTranslation(center.x,center.y,center.z).multiply(new Matrix4().makeRotationAxis(axis,a)).multiply(new Matrix4().makeTranslation(-center.x,-center.y,-center.z));
    }
    // Repeats act in the parent's coordinate system; children inherit the full transform.
    const world=parent.clone().multiply(repeat).multiply(base),instancePath=[...path,`${node.id}:${index}`];
    if(node.body){
     if(project.objects.length>=30)fail('Maximal 30 erzeugte und freie Körper zusammen möglich.');
     const body=bindParameters(node.body,values),position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
     world.clone().multiply(matrix(body)).decompose(position,rotation,scale);
     const euler=new Euler().setFromQuaternion(rotation,'ZYX');
     // Compact deterministic path, stable when the count grows. IDs need not encode node UUIDs.
     const id=`gen_${generator.id}_${instancePath.map(part=>{const [nodeId,i]=part.split(':');return `${generator.nodes.findIndex(n=>n.id===nodeId)}-${i}`;}).join('_')}`;
     const previous=old.get(id);
     const instanceLabel=instancePath.map(part=>Number(part.split(':')[1])+1).join('.');
     Object.assign(body,{id,name:`${generator.name||'Generator'} · ${node.name||body.name||'Körper'} ${instanceLabel}`,position:position.toArray(),rotation:[euler.x/radians,euler.y/radians,euler.z/radians],scale:scale.x,locked:true,generated:{generatorId:generator.id,nodeId:node.id}});
     if(previous?.generated?.nodeId===node.id)body.visible=previous.visible;
     delete body.expressions;project.objects.push(body);
    }
    for(const child of nodes.values())if(child.parentId===node.id)emit(child,world,instancePath);
   }
  }
  for(const node of nodes.values())if(!node.parentId)emit(node,new Matrix4(),[]);
 }
 return project;
}
