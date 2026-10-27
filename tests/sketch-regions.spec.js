import {test,expect} from '@playwright/test';
import {findRegions,inRegion,regionAxis,assertAxisOutside} from '../web/sketch-regions.js';
import {pasteBodies,assertUnlockedChanges} from '../web/body-editing.js';
const line=(id,a,b)=>({id,kind:'line',a,b}),circle=(id,center,radius)=>({id,kind:'circle',center,radius});
const rectangle=(x,y,w,h)=>[line('a',[x,y],[x+w,y]),line('b',[x+w,y],[x+w,y+h]),line('c',[x+w,y+h],[x,y+h]),line('d',[x,y+h],[x,y])];
const project=(entities,selected,extra={})=>({version:1,name:'Freie Skizze',sketches:[{id:'sketch',name:'Querschnitt',entities}],objects:[{id:'body',name:'Rotation',kind:'region',sketchId:'sketch',regions:selected??findRegions(entities).map(r=>r.id),params:{revolveAngle:360,axisOffset:0},axis:'v',position:[0,0,0],features:[],...extra}]});
const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))));
const cad=(page,operation,payload)=>page.evaluate(async({operation,payload})=>{try{const r=await(await import('/cad-client.js')).calculate(operation,payload);return r instanceof Blob?{size:r.size}:r;}catch(e){return {error:e.message};}},{operation,payload});
const clickPoint=async(page,p)=>{const position=await page.locator('#region-canvas').evaluate((svg,p)=>{const q=new DOMPoint(p[0],-p[1]).matrixTransform(svg.getScreenCTM());return {x:q.x,y:q.y};},p);await page.mouse.click(position.x,position.y);};
const selectArea=async(page,p)=>{await page.locator('[data-rs-mode="select"]').click();await clickPoint(page,p);};

test('arrangement splits intersections, removes open branches and duplicate/overlapping lines',()=>{
 const entities=[...rectangle(0,0,10,10),line('diagonal',[0,0],[10,10]),line('tail',[10,10],[15,12]),line('duplicate',[0,0],[5,0])],r=findRegions(entities);
 expect(r).toHaveLength(2);expect(r.map(r=>r.area)).toEqual([50,50]);expect(r.filter(r=>inRegion([8,2],r))).toHaveLength(1);
 expect(findRegions([line('a',[0,0],[10,10]),line('b',[10,10],[20,0])])).toEqual([]);
});
test('nested and intersecting circles retain exact arcs, areas and holes',()=>{
 const r=findRegions([...rectangle(0,0,20,20),circle('inner',[10,10],5),circle('island',[10,10],2)]);
 expect(r).toHaveLength(3);expect(r.reduce((s,r)=>s+r.area,0)).toBeCloseTo(400,8);expect(r[0].holes).toHaveLength(1);expect(r.filter(r=>inRegion([10,10],r))).toHaveLength(1);
 const circles=findRegions([circle('a',[0,0],5),circle('b',[5,0],5)]),lens=50*Math.acos(.5)-.5*5*Math.sqrt(75);
 expect(circles).toHaveLength(3);expect(circles.map(r=>r.area)).toEqual(expect.arrayContaining([expect.closeTo(lens,7),expect.closeTo(25*Math.PI-lens,7)]));
 const split=findRegions([circle('a',[10,0],5),line('b',[5,0],[15,0])]);expect(split).toHaveLength(2);split.forEach(r=>expect(r.area).toBeCloseTo(12.5*Math.PI,7));
});
test('axis tests include circular extrema and arbitrary drawn lines',()=>{
 const r=findRegions([circle('c',[4,0],5)])[0];expect(()=>assertAxisOutside(r,regionAxis({axis:'v'},[]))).toThrow(/durchschneiden/);
 expect(()=>assertAxisOutside(r,regionAxis({axis:'v',params:{axisOffset:-1}},[]))).not.toThrow();
 expect(()=>regionAxis({axis:'line',axisEntityId:'missing'},[])).toThrow();
});
test('source sketches follow clipboard copies across projects without overwriting collisions or bypassing locks',()=>{
 const source=project(rectangle(5,0,10,20)),target={version:1,objects:[],sketches:[{id:'sketch',name:'Different',entities:[]}]};let id=0;
 const pasted=pasteBodies(target,source.objects,5,()=>`copy-${++id}`,source.sketches);expect(pasted.project.sketches).toHaveLength(2);expect(pasted.project.objects[0].sketchId).not.toBe('sketch');expect(pasted.project.sketches[0].entities).toEqual([]);
 source.objects[0].locked=true;const changed=structuredClone(source);changed.sketches[0].entities[0].a[0]=6;expect(()=>assertUnlockedChanges(source,changed)).toThrow(/gesperrt/);
});
test.describe('free region sketches in the browser',()=>{
 test.beforeEach(async({page})=>{await page.goto('/');await ready(page);await page.locator('#dismiss-welcome').click();});
 test('kernel revolves a rectangle, a circular ring, partial rotation, nested holes and connected selected areas',async({page})=>{
  const rect=rectangle(5,0,10,20),p=project(rect),r=await cad(page,'model',{project:p});expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(Math.PI*(15**2-5**2)*20,5);
  const torus=await cad(page,'model',{project:project([circle('c',[15,0],3)])});expect(torus.error).toBeUndefined();expect(torus.objects[0].volume).toBeCloseTo(2*Math.PI**2*15*9,5);
  p.objects[0].params.revolveAngle=90;expect((await cad(page,'model',{project:p})).objects[0].volume).toBeCloseTo(Math.PI*1000,5);
  const hole=[...rectangle(5,0,20,20),circle('hole',[15,10],3)],regions=findRegions(hole),outer=regions.find(r=>r.holes.length);
  const cut=await cad(page,'model',{project:project(hole,[outer.id])});expect(cut.error).toBeUndefined();expect(cut.objects[0].volume).toBeCloseTo(Math.PI*(625-25)*20-2*Math.PI**2*15*9,5);
  const full=await cad(page,'model',{project:project(hole)});expect(full.error).toBeUndefined();expect(full.objects[0].volume).toBeCloseTo(Math.PI*12000,5);
  const lensEntities=[circle('one',[15,0],5),circle('two',[20,0],5)],lens=findRegions(lensEntities).find(r=>inRegion([17.5,0],r));
  const lensBody=await cad(page,'model',{project:project(lensEntities,[lens.id])});expect(lensBody.error).toBeUndefined();expect(lensBody.objects[0].volume).toBeCloseTo(2*Math.PI*17.5*lens.area,4);
  expect((await cad(page,'export_step',{project:project(hole,[outer.id])})).size).toBeGreaterThan(1000);
 });
 test('native semicircle and oblique axis remain exact; crossing, stale and disconnected selections fail',async({page})=>{
  const e=[circle('c',[10,0],5),line('diameter',[5,0],[15,0])],top=findRegions(e).find(r=>inRegion([10,2],r));
  const p=project(e,[top.id],{axis:'line',axisEntityId:'diameter'}),sphere=await cad(page,'model',{project:p});expect(sphere.error).toBeUndefined();expect(sphere.objects[0].volume).toBeCloseTo(4/3*Math.PI*125,5);
  const diagonal=rectangle(5,0,10,5).map(e=>({...e,a:[e.a[0]-e.a[1],e.a[0]+e.a[1]],b:[e.b[0]-e.b[1],e.b[0]+e.b[1]]}));diagonal.push(line('axis',[0,0],[-5,5]));
  const oblique=await cad(page,'model',{project:project(diagonal,undefined,{axis:'line',axisEntityId:'axis'})});expect(oblique.error).toBeUndefined();expect(oblique.objects[0].volume).toBeCloseTo(Math.PI*200*5*2**1.5,5);
  expect((await cad(page,'model',{project:project([circle('c',[0,0],5)])})).error).toContain('durchschneiden');
  expect((await cad(page,'model',{project:project(rectangle(5,0,5,5),['missing'])})).error).toContain('erneut auswählen');
  expect((await cad(page,'model',{project:project([circle('a',[10,0],2),circle('b',[20,0],2)])})).error).toContain('zusammenhängender');
 });
 test('point clicks and a circle yield selectable faces, exact 3D preview, stored source, edit and undo',async({page},info)=>{
  await page.locator('#new-region-sketch').click();for(const p of [[5,0],[25,0],[25,20],[5,20],[5,0]])await clickPoint(page,p);
  await page.locator('[data-rs-mode="circle"]').click();await clickPoint(page,[15,10]);await clickPoint(page,[18,10]);
  await expect(page.locator('#region-summary')).toContainText('2 geschlossene Flächen');await selectArea(page,[7,10]);await expect(page.locator('#region-summary')).toContainText('1 ausgewählt');
  await page.screenshot({path:info.outputPath('selected-regions.png')});const before=await saved(page);
  await page.locator('[data-rs-action="preview"]').click();await expect(page.locator('#region-result')).toContainText('Gültiger Rotationskörper');expect(await saved(page)).toEqual(before);
  await expect.poll(async()=>Number(await page.locator('#region-result').getAttribute('data-volume'))).toBeCloseTo(Math.PI*12000-2*Math.PI**2*15*9,4);await page.screenshot({path:info.outputPath('revolved-region.png')});
  await page.locator('[data-rs-action="rotate"]').click();await expect(page.locator('#region-dialog')).not.toBeVisible();await expect(page.locator('#body-count')).toHaveText('2');
  const p=(await saved(page)).project;expect(p.sketches[0].entities).toHaveLength(5);expect(p.objects[1].kind).toBe('region');
  await page.reload();await ready(page);await page.locator('#region-sketch-list button').click();await selectArea(page,[15,10]);await expect(page.locator('#region-summary')).toContainText('2 ausgewählt');
  await page.locator('[data-rs-action="rotate"]').click();await expect(page.locator('#region-dialog')).not.toBeVisible();expect((await saved(page)).project.objects[1].regions).toHaveLength(2);
  await page.locator('#undo').click();await expect.poll(async()=>(await saved(page)).project.objects[1].regions.length).toBe(1);
 });
 test('open sketches save without geometry; draft survives reload; line axis can be chosen in UI',async({page})=>{
  await page.locator('#new-region-sketch').click();await clickPoint(page,[5,0]);await clickPoint(page,[15,0]);await page.keyboard.press('Escape');await expect(page.locator('#region-dialog')).toBeVisible();
  await page.reload();await ready(page);await page.locator('#new-region-sketch').click();await expect(page.locator('#region-summary')).toContainText('1 Elemente');
  await page.locator('[data-rs-action="save"]').click();await expect(page.locator('#region-dialog')).not.toBeVisible();await expect(page.locator('#body-count')).toHaveText('1');
  await page.locator('#region-sketch-list button').click();await page.locator('[data-rs-mode="circle"]').click();await clickPoint(page,[10,0]);await clickPoint(page,[15,0]);await selectArea(page,[10,2]);
  await page.locator('[data-rs-axis]').selectOption('line');await page.locator('[data-rs-action="rotate"]').click();await expect(page.locator('#region-dialog')).not.toBeVisible();await expect(page.locator('#body-count')).toHaveText('2');
 });
 test('point dragging keeps connected endpoints together; undo and invalid rotation keep the project intact',async({page})=>{
  await page.locator('#new-region-sketch').click();for(const p of [[5,0],[15,0],[15,10],[5,10],[5,0]])await clickPoint(page,p);await page.locator('[data-rs-mode="edit"]').click();
  const p=await page.locator('#region-canvas').evaluate(svg=>{const a=new DOMPoint(15,0).matrixTransform(svg.getScreenCTM()),b=new DOMPoint(20,-2).matrixTransform(svg.getScreenCTM());return {a:{x:a.x,y:a.y},b:{x:b.x,y:b.y}};});
  await page.mouse.move(p.a.x,p.a.y);await page.mouse.down();await page.mouse.move(p.b.x,p.b.y,{steps:5});await page.mouse.up();await expect(page.locator('#region-summary')).toContainText('1 geschlossene Flächen');
  await page.locator('[data-rs-action="undo"]').click();await selectArea(page,[10,5]);const before=await saved(page);
  await page.locator('[data-rs-field="offset"]').fill('10');await page.locator('[data-rs-action="rotate"]').click();await expect(page.locator('#region-result')).toContainText('durchschneiden');expect(await saved(page)).toEqual(before);
  await page.locator('[data-rs-field="offset"]').fill('0');await page.locator('[data-rs-action="rotate"]').click();await expect(page.locator('#region-dialog')).not.toBeVisible();expect((await saved(page)).project.sketches[0].entities).toHaveLength(4);
 });
 test('an older unsaved draft is offered explicitly after another project change',async({page})=>{
  await page.locator('#new-region-sketch').click();await clickPoint(page,[5,0]);await clickPoint(page,[15,0]);await page.locator('[data-rs-action="close"]').click();
  await page.locator('[data-field="width"]').fill('42');await page.locator('[data-action="apply-dimensions"]').click();await expect.poll(async()=>(await saved(page)).project.objects[0].params.width).toBe(42);
  await page.locator('#new-region-sketch').click();await expect(page.locator('.region-recovery')).toBeVisible();await page.locator('[data-rs-action="restore-draft"]').click();await expect(page.locator('#region-summary')).toContainText('1 Elemente');
  await page.locator('[data-rs-action="save"]').click();await expect(page.locator('#region-dialog')).not.toBeVisible();expect((await saved(page)).project.objects[0].params.width).toBe(42);expect((await saved(page)).project.sketches[0].entities).toHaveLength(1);
 });
});
