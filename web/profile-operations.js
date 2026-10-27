export const defaultSweepPath=()=>[{id:'start',x:0,y:0},{id:'rise',x:0,y:25},{id:'end',x:25,y:25}];
export const loftDefaults={topScale:.5,topAngle:0,topU:0,topV:0};
export function validateSweepPath(points){
 if(!Array.isArray(points)||points.length<2||points.length>32)throw new Error('Sweep benötigt 2 bis 32 Pfadpunkte.');
 if(points.some(p=>!p||![p.x,p.y].every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=10000)))throw new Error('Ungültige Sweep-Pfadkoordinate.');
 if(points[0].x!==0||points[0].y!==0||points[1].x!==0||points[1].y<=0)throw new Error('Sweep-Pfad bei U=0, Höhe=0 beginnen und zuerst senkrecht nach oben führen.');
 for(let i=1;i<points.length;i++)if(Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y)<.01)throw new Error('Sweep-Punkte müssen mindestens 0,01 mm auseinanderliegen.');
 return points;
}
