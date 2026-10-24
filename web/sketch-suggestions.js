// Transient drawing aids; these do not create persistent sketch constraints.
export function suggestPoint(point,{profiles=[],bounds=null,tolerance=.5}={}){
 const axes=[[{value:0,label:'Ursprung'}],[{value:0,label:'Ursprung'}]];
 if(bounds)for(let axis=0;axis<2;axis++)axes[axis].push(...[{value:bounds.min[axis],label:'Kante'},{value:bounds.max[axis],label:'Kante'},{value:(bounds.min[axis]+bounds.max[axis])/2,label:'Flächenmitte'}]);
 for(const profile of profiles)if(profile.hasDrawn)for(let axis=0;axis<2;axis++)axes[axis].push({value:profile.center[axis],label:'Konturmitte'});
 const guides=[],result=[...point];
 axes.forEach((candidates,axis)=>{const nearest=candidates.sort((a,b)=>Math.abs(a.value-point[axis])-Math.abs(b.value-point[axis]))[0];if(Math.abs(nearest.value-point[axis])<=tolerance){result[axis]=nearest.value;guides.push({axis,value:nearest.value,label:nearest.label});}});
 return {point:result,guides};
}
export function suggestSize(value,candidates,tolerance){const sorted=candidates.filter(n=>n>0).sort((a,b)=>Math.abs(a-value)-Math.abs(b-value));return sorted.length&&Math.abs(sorted[0]-value)<=tolerance?sorted[0]:null;}
