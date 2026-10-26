// Rectangle and ellipse drags use opposite corners in the profile's own axes.
// Keeping the starting corner fixed also makes locked dimensions predictable.
export function draggedProfileBounds(start,end,profile,equalTolerance=null){
 const angle=(profile.angle??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 const du=end[0]-start[0],dv=end[1]-start[1];
 const x=du*c+dv*s,y=-du*s+dv*c,locks=profile.locks??{};
 const width=locks.width?profile.width:Math.max(Math.abs(x),.01);
 let height=locks.height?profile.height:Math.max(Math.abs(y),.01);
 const equalSides=equalTolerance!=null&&!locks.height&&Math.abs(height-width)<=equalTolerance;
 if(equalSides)height=width;
 const halfX=(Math.sign(x)||1)*width/2,halfY=(Math.sign(y)||1)*height/2;
 return {width,height,center:[start[0]+halfX*c-halfY*s,start[1]+halfX*s+halfY*c],equalSides};
}
