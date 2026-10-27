// Axial round grooves around the local Z axis; all values are in body coordinates.
export function gripLayout(params,bounds){
 const read=(key,fallback,min,max)=>{const value=params[key]??fallback;if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`Griffmulden: ${key} muss zwischen ${min} und ${max} liegen.`);return value;};
 const count=read('count',16,3,64);if(!Number.isInteger(count))throw new Error('Griffmulden: Die Anzahl muss ganzzahlig sein.');
 const radius=read('radius',1.2,.05,1000),depth=read('depth',radius,.01,radius),angle=read('angle',0,-360,360);
 const outerRadius=read('outerRadius',0,0,10000)||Math.min(bounds.max[0]-bounds.min[0],bounds.max[1]-bounds.min[1])/2;
 if(depth>=outerRadius)throw new Error('Griffmulden: Die Tiefe muss kleiner als der Körperradius sein.');
 const orbit=outerRadius+radius-depth;
 if(orbit*Math.sin(Math.PI/count)<=radius+1e-5)throw new Error('Die Griffmulden überlappen sich. Anzahl oder Muldenradius verkleinern.');
 const center=[0,1].map(i=>(bounds.min[i]+bounds.max[i])/2),height=bounds.max[2]-bounds.min[2]+2;
 return {radius,height,centers:Array.from({length:count},(_,i)=>{const a=(angle+360*i/count)*Math.PI/180;return [center[0]+orbit*Math.cos(a),center[1]+orbit*Math.sin(a),bounds.min[2]-1];})};
}
