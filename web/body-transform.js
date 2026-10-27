import {Vector3,Quaternion,Euler} from './vendor/three.module.js';
export function transformedBodies(project,ids,center,rotation,scale){
 if(!Number.isFinite(scale)||scale<=0||scale>1000)throw new Error('Skalierung muss größer als 0 und höchstens 1000 sein.');
 const next=structuredClone(project),pivot=new Vector3(...center),q=new Quaternion(...rotation);
 for(const body of next.objects.filter(o=>ids.includes(o.id))){
  if(body.locked)throw new Error('Die Auswahl enthält gesperrte Körper.');
  body.position=new Vector3(...(body.position??[0,0,0])).sub(pivot).multiplyScalar(scale).applyQuaternion(q).add(pivot).toArray();
  const before=new Quaternion().setFromEuler(new Euler(...(body.rotation??[0,0,0]).map(n=>n*Math.PI/180),'ZYX'));
  const euler=new Euler().setFromQuaternion(q.clone().multiply(before),'ZYX');body.rotation=[euler.x,euler.y,euler.z].map(n=>n*180/Math.PI);
  body.scale=(body.scale??1)*scale;
 }
 return next;
}
