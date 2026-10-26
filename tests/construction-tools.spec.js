import {test,expect} from '@playwright/test';
import {createBodyPattern} from '../web/body-patterns.js';
import {Euler,Quaternion,Vector3} from '../web/vendor/three.module.js';

const box=(id='a',position=[0,0,0])=>({id,name:id,kind:'box',params:{width:20,depth:10,height:10},position,features:[]});
const project=(objects=[box()])=>({version:1,name:'Konstruktion',objects});
const ids=()=>{let n=0;return ()=>`copy-${++n}`;};
const close=(a,b)=>a.forEach((n,i)=>expect(n).toBeCloseTo(b[i],6));
const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))));
const calculate=(page,operation,payload)=>page.evaluate(async({operation,payload})=>{
 try{return await(await import('/cad-client.js')).calculate(operation,payload);}catch(error){return {error:error.message};}
},{operation,payload});

test('linear multi-body copies preserve editable data, relative positions and originals',()=>{
 const p=project([box('a',[1,2,3]),{...box('b',[11,12,13]),hole:true,rotation:[15,30,45],scale:2}]),before=structuredClone(p);
 const result=createBodyPattern(p,['a','b'],{mode:'linear',count:3,step:[-10,4,2]},ids());
 expect(p).toEqual(before);expect(result.ids).toHaveLength(4);expect(result.project.objects).toHaveLength(6);
 expect(result.project.objects[2].position).toEqual([-9,6,5]);expect(result.project.objects[5].position).toEqual([-9,20,17]);
 expect(result.project.objects[3]).toMatchObject({hole:true,rotation:[15,30,45],scale:2});
 result.project.objects[2].params.width=99;expect(p.objects[0].params.width).toBe(20);
});

test('circular copies use world axes, preserve orientation when requested, and include partial endpoints',()=>{
 const source={...box('a',[10,2,3]),rotation:[17,23,41]},p=project([source]);
 const full=createBodyPattern(p,['a'],{mode:'circular',count:4,axis:'z',center:[0,2,3],angle:360},ids()).project.objects;
 close(full[1].position,[0,12,3]);close(full[2].position,[-10,2,3]);close(full[3].position,[0,-8,3]);
 const originalDirection=new Vector3(1,0,0).applyEuler(new Euler(...source.rotation.map(v=>v*Math.PI/180),'ZYX'));
 const expected=originalDirection.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/2));
 close(new Vector3(1,0,0).applyEuler(new Euler(...full[1].rotation.map(v=>v*Math.PI/180),'ZYX')).toArray(),expected.toArray());
 const partial=createBodyPattern(p,['a'],{mode:'circular',count:3,axis:'z',center:[0,2,3],angle:-180,rotate:false},ids()).project.objects;
 close(partial[1].position,[0,-8,3]);close(partial[2].position,[-10,2,3]);expect(partial[2].rotation).toEqual(source.rotation);
});

test('mirror replacement retains identity and snapshot; invalid patterns fail atomically',()=>{
 const p=project(),before=structuredClone(p);
 const result=createBodyPattern(p,['a'],{mode:'mirror',axis:'x',offset:5,keepOriginal:false},ids());
 expect(result.project.objects).toHaveLength(1);expect(result.project.objects[0]).toMatchObject({id:'a',kind:'mirror',source:box(),axis:'x',offset:5});
 for(const options of [{mode:'linear',count:2,step:[0,0,0]},{mode:'linear',count:2.5,step:[1,0,0]},{mode:'linear',count:30,step:[1000,0,0]},{mode:'mirror',axis:'w',offset:0},{mode:'circular',count:3,axis:'z',center:[0,0,0],angle:0}])expect(()=>createBodyPattern(p,['a'],options,ids())).toThrow();
 expect(()=>createBodyPattern(project(Array.from({length:30},(_,i)=>box(String(i)))),['0'],{mode:'linear',count:2,step:[1,0,0]},ids())).toThrow(/30 Körper/);
 expect(p).toEqual(before);
});

test.describe('native geometry and browser tools',()=>{
 test.beforeEach(async({page})=>{await page.goto('/');await ready(page);});
 test('mirror reflects asymmetric transformed CAD solids about offset planes and supports later features',async({page})=>{
  const source={...box(),kind:'wedge',params:{width:20,depth:12,height:10},position:[20,5,3],rotation:[15,25,35],scale:2};
  const original=await calculate(page,'model',{project:project([source])});expect(original.error).toBeUndefined();
  for(const [i,axis] of ['x','y','z'].entries()){
   const p=createBodyPattern(project([source]),['a'],{mode:'mirror',axis,offset:7},ids()).project,result=await calculate(page,'model',{project:p});
   expect(result.error).toBeUndefined();const a=original.objects[0],b=result.objects[1];expect(b.volume).toBeCloseTo(a.volume,5);
   close(b.bounds.min,a.bounds.min.map((n,j)=>i===j?14-a.bounds.max[j]:n));close(b.bounds.max,a.bounds.max.map((n,j)=>i===j?14-a.bounds.min[j]:n));
  }
  let p=createBodyPattern(project([box('a',[15,0,0])]),['a'],{mode:'mirror',axis:'x',offset:0,keepOriginal:false},ids()).project;
  let result=await calculate(page,'model',{project:p});expect(result.error).toBeUndefined();p=result.project;
  const top=result.objects[0].faces.find(f=>f.normal?.[2]>.99);
  p.objects[0].features.push({type:'pocket',face:top.id,reference:top.reference,depth:3,sketch:{kind:'circle',radius:2,center:[0,0]}});
  result=await calculate(page,'model',{project:p});expect(result.error).toBeUndefined();expect(result.objects[0].volume).toBeCloseTo(2000-12*Math.PI,5);
  const exportResult=await calculate(page,'export_step',{project:p});expect(exportResult.error).toBeUndefined();
 });

 test('exact body distance handles gaps, diagonal gaps, overlap and nested bodies',async({page})=>{
  for(const [position,distance] of [[[30,0,0],10],[[30,20,0],Math.sqrt(200)],[[10,0,0],0]]){
   const result=await calculate(page,'measure',{project:project([box('a'),box('b',position)]),first:'a',second:'b'});
   expect(result.error).toBeUndefined();expect(result.distance).toBeCloseTo(distance,5);
  }
  const inside={...box('b',[0,0,2]),scale:.5};
  expect((await calculate(page,'measure',{project:project([box(),inside]),first:'a',second:'b'})).distance).toBeCloseTo(0,5);
  expect((await calculate(page,'measure',{project:project(),first:'a',second:'missing'})).error).toContain('fehlt');
 });

 test('linear copies apply once, keep independent dimensions, persist and undo together',async({page})=>{
  const before=await saved(page);await page.locator('[data-tool="pattern"]').click();
  await page.locator('[data-field="pattern-step-x"]').fill('50');await page.locator('[data-field="pattern-count"]').fill('3');
  await page.locator('[data-action="apply-pattern"]').click();await expect(page.locator('#body-count')).toHaveText('3');await ready(page);
  const after=await saved(page);expect(after.revision).toBe(before.revision+1);expect(after.project.objects.map(o=>o.position[0])).toEqual([0,50,100]);
  await page.locator('#undo').click();await expect(page.locator('#body-count')).toHaveText('1');await page.locator('#redo').click();await expect(page.locator('#body-count')).toHaveText('3');
  await page.reload();await ready(page);expect((await saved(page)).project.objects.map(o=>o.position[0])).toEqual([0,50,100]);
 });

 test('circular UI creates four copies including original with unchanged orientation option',async({page},testInfo)=>{
  await page.locator('[data-field="position-x"]').fill('30');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');
  await page.locator('[data-tool="pattern"]').click();await page.locator('[data-pattern-mode]').selectOption('circular');await page.locator('#pattern-rotate').uncheck();
  await page.screenshot({path:testInfo.outputPath('circular-pattern-panel.png')});
  await page.locator('[data-field="pattern-count"]').press('Enter');await expect(page.locator('#body-count')).toHaveText('4');
  const p=(await saved(page)).project;close(p.objects[1].position,[0,30,0]);close(p.objects[3].position,[0,-30,0]);expect(p.objects[1].rotation).toEqual([0,0,0]);
 });

 test('mirror UI creates editable source dimensions and rejects invalid copy counts',async({page})=>{
  await page.locator('[data-tool="pattern"]').click();const before=await saved(page);
  await page.locator('[data-field="pattern-count"]').fill('31');await page.locator('[data-action="apply-pattern"]').click();await expect(page.locator('#toast')).toHaveClass(/error/);expect(await saved(page)).toEqual(before);
  await page.locator('[data-pattern-mode]').selectOption('mirror');await page.locator('[data-field="pattern-offset"]').fill('25');
  await page.locator('[data-action="apply-pattern"]').click();await expect(page.locator('#body-count')).toHaveText('2');
  await expect(page.locator('[data-field="mirror-offset"]')).toHaveValue('25');await page.locator('[data-field="mirror-source-width"]').fill('20');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');
  const p=(await saved(page)).project;expect(p.objects[0].params.width).toBe(40);expect(p.objects[1].source.params.width).toBe(20);expect(p.objects[1].offset).toBe(25);
 });

 test('measure tool returns an exact gap without changing project revision or undo',async({page},testInfo)=>{
  await page.locator('[data-tool="pattern"]').click();await page.locator('[data-field="pattern-count"]').fill('2');await page.locator('[data-field="pattern-step-x"]').fill('50');await page.locator('[data-action="apply-pattern"]').click();await expect(page.locator('#body-count')).toHaveText('2');
  const before=await saved(page);await page.locator('#body-list [data-multi-body]').first().check();await page.locator('[data-tool="measure"]').click();
  await page.locator('[data-action="measure-distance"]').click();await expect(page.locator('[data-measure-distance]')).toHaveAttribute('data-measure-distance','10');expect(await saved(page)).toEqual(before);
  await page.screenshot({path:testInfo.outputPath('measure-two-bodies.png')});
  await page.locator('#undo').click();await expect(page.locator('#body-count')).toHaveText('1');await expect(page.locator('[data-measure-distance]')).toHaveCount(0);
 });

 test('multi-body dragging preserves spacing and obeys axis and movement grid',async({page})=>{
  await page.locator('[data-tool="pattern"]').click();await page.locator('[data-field="pattern-count"]').fill('2');await page.locator('[data-field="pattern-step-x"]').fill('50');await page.locator('[data-action="apply-pattern"]').click();await expect(page.locator('#body-count')).toHaveText('2');
  await page.locator('#body-list [data-multi-body]').first().check();await page.locator('[data-view="top"]').click();await page.locator('[data-tool="move"]').click();
  await page.locator('[data-move-axis]').selectOption('x');await page.locator('[data-move-snap]').fill('5');const before=await saved(page);
  const rect=await page.locator('#viewport canvas').boundingBox(),px=Math.min(rect.width,rect.height)/(Math.hypot(90,30,12)*1.25),x=rect.x+rect.width/2-25*px,y=rect.y+rect.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+13.2*px,y-7*px,{steps:4});await page.mouse.up();
  await expect(page.locator('#toast')).toContainText('Auswahl verschoben');const after=await saved(page);
  expect(after.revision).toBe(before.revision+1);expect(after.project.objects.map(o=>o.position)).toEqual([[15,0,0],[65,0,0]]);
  await expect(page.locator('#body-list [data-multi-body]:checked')).toHaveCount(2);
 });

 test('front-view dragging in XZ moves in Z with a tenth-millimetre grid',async({page})=>{
  await page.locator('[data-view="front"]').click();await page.locator('[data-tool="move"]').click();await page.locator('[data-move-plane]').selectOption('xz');await page.locator('[data-move-axis]').selectOption('z');await page.locator('[data-move-snap]').fill('0.1');
  const rect=await page.locator('#viewport canvas').boundingBox(),px=Math.min(rect.width,rect.height)/(Math.hypot(40,30,12)*1.25),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+4*px,y-7.3*px,{steps:4});await page.mouse.up();await expect(page.locator('#toast')).toContainText('Auswahl verschoben');
  close((await saved(page)).project.objects[0].position,[0,0,7.3]);
 });

 test('Escape cancels a drag without saving or changing undo history',async({page})=>{
  await page.locator('[data-view="top"]').click();await page.locator('[data-tool="move"]').click();const before=await saved(page);
  const rect=await page.locator('#viewport canvas').boundingBox(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+60,y+30,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();
  expect(await saved(page)).toEqual(before);await expect(page.locator('#undo')).toBeDisabled();await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);
 });
});
