import {Vector3,Quaternion,Euler} from './vendor/three.module.js';

const fail=message=>{throw new Error(message);};
function number(value,label,min=-10000,max=10000){
 if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${label}: gültige Zahl zwischen ${min} und ${max} erwartet.`);
 return value;
}
function vector(value,label){
 if(!Array.isArray(value)||value.length!==3)fail(`${label}: drei Koordinaten erwartet.`);
 return value.map(n=>number(n,label));
}
const axes={x:[1,0,0],y:[0,1,0],z:[0,0,1]};

// Copies are independent editable bodies. Originals are never modified.
export function createBodyPattern(project,ids,options,newId=()=>crypto.randomUUID()){
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail('Mindestens einen Körper auswählen.');
 const sources=ids.map(id=>project.objects.find(o=>o.id===id));
 if(sources.some(o=>!o))fail('Ein ausgewählter Körper fehlt.');
 const {mode}=options;if(!['linear','circular','mirror'].includes(mode))fail('Unbekanntes Kopierwerkzeug.');
 const keepOriginal=options.keepOriginal!==false;
 const count=mode==='mirror'?2:number(options.count,'Anzahl',2,30);
 if(!Number.isInteger(count))fail('Die Anzahl muss ganzzahlig sein.');
 const finalCount=project.objects.length+sources.length*(count-1)-(mode==='mirror'&&!keepOriginal?sources.length:0);
 if(finalCount>30)fail('Maximal 30 Körper pro Projekt möglich. Bitte weniger Kopien wählen.');
 let step,axis,center,angle;
 if(mode==='linear'){
  step=vector(options.step,'Abstand');if(step.every(n=>n===0))fail('Mindestens ein Abstand muss ungleich null sein.');
 }else{
  if(!Object.hasOwn(axes,options.axis))fail('Achse X, Y oder Z wählen.');axis=axes[options.axis];
  if(mode==='circular'){
   center=vector(options.center,'Drehzentrum');angle=number(options.angle,'Gesamtwinkel',-360,360);
   if(Math.abs(angle)<.001)fail('Der Gesamtwinkel darf nicht null sein.');
  }else number(options.offset,'Spiegelebene');
 }
 const copies=[];
 for(let index=1;index<count;index++)for(const source of sources){
  const copy=structuredClone(source);delete copy.generated;copy.id=newId();copy.locked=false;copy.name=(source.name||'Körper')+(mode==='mirror'?' gespiegelt':` Kopie ${index}`);
  if(mode==='linear')copy.position=vector(source.position??[0,0,0],'Position').map((n,i)=>number(n+step[i]*index,'Position der Kopie'));
  if(mode==='circular'){
   const radians=angle*Math.PI/180*index/(Math.abs(angle)===360?count:count-1);
   const rotation=new Quaternion().setFromAxisAngle(new Vector3(...axis),radians),origin=new Vector3(...center);
   copy.position=vector(new Vector3(...vector(source.position??[0,0,0],'Position')).sub(origin).applyQuaternion(rotation).add(origin).toArray(),'Position der Kopie');
   if(options.rotate!==false){
    const original=new Quaternion().setFromEuler(new Euler(...vector(source.rotation??[0,0,0],'Drehung').map(v=>v*Math.PI/180),'ZYX'));
    const euler=new Euler().setFromQuaternion(rotation.multiply(original),'ZYX');copy.rotation=[euler.x,euler.y,euler.z].map(v=>v*180/Math.PI);
   }
  }
  if(mode==='mirror'){
   copies.push({id:keepOriginal?copy.id:source.id,name:copy.name,kind:'mirror',source:structuredClone(source),axis:options.axis,offset:options.offset,params:{},features:[],position:[0,0,0],color:source.color,hole:!!source.hole,visible:source.visible!==false});
  }else copies.push(copy);
 }
 const next=structuredClone(project);
 if(mode==='mirror'&&!keepOriginal)next.objects=next.objects.filter(o=>!ids.includes(o.id));
 next.objects.push(...copies);
 return {project:next,ids:copies.map(o=>o.id)};
}
