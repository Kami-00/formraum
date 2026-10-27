import {test,expect} from '@playwright/test';
import {assertUnlockedChanges,pasteBodies} from '../web/body-editing.js';
const body={id:'a',name:'Test',kind:'box',params:{width:20,depth:10,height:10},features:[],position:[0,0,0]};
const project=objects=>({version:1,name:'Direkt',objects});
const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))));
const cad=(page,operation,payload)=>page.evaluate(async({operation,payload})=>{try{return await(await import('/cad-client.js')).calculate(operation,payload);}catch(e){return {error:e.message};}},{operation,payload});
test('locks guard all geometry, deletion and metadata edits but allow visibility and unlocking',()=>{
 const before=project([{...body,locked:true}]);
 expect(()=>assertUnlockedChanges(before,project([]))).toThrow(/gesperrt/);
 expect(()=>assertUnlockedChanges(before,project([{...body,locked:false,params:{...body.params,width:99}}]))).toThrow(/gesperrt/);
 expect(()=>assertUnlockedChanges(before,project([{...body,locked:false,visible:false}]))).not.toThrow();
 const result=pasteBodies(before,before.objects);expect(result.project.objects[1]).toMatchObject({locked:false,position:[5,0,0]});expect(result.ids[0]).not.toBe('a');expect(before.objects).toHaveLength(1);
});
test.describe('direct browser editing',()=>{
 test.beforeEach(async({page})=>{await page.goto('/');await ready(page);});
 test('locked bodies reject edits and moves, but copies remain editable and undo unlocks',async({page})=>{
  await page.locator('[data-lock-body]').click();await expect(page.locator('#toast')).toContainText('Körper gesperrt');const before=await saved(page);
  await page.locator('[data-field="width"]').fill('99');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('gesperrt');expect(await saved(page)).toEqual(before);
  await page.locator('[data-action="copy-bodies"]').click();await page.locator('[data-action="paste-bodies"]').click();await expect(page.locator('#body-count')).toHaveText('2');expect((await saved(page)).project.objects[1].locked).toBe(false);
  await page.locator('#undo').click();await expect(page.locator('#body-count')).toHaveText('1');await page.locator('#undo').click();await expect.poll(async()=>(await saved(page)).project.objects[0].locked).toBeUndefined();
 });
 test('cut/paste works across projects and restores both bodies with one undo step',async({page})=>{
  await page.locator('[data-action="cut-bodies"]').click();await expect(page.locator('#body-count')).toHaveText('0');
  await page.locator('[data-action="paste-bodies"]').click();await expect(page.locator('#body-count')).toHaveText('1');
  const pasted=(await saved(page)).project.objects[0];expect(pasted.position).toEqual([5,0,0]);
  await page.locator('#viewport canvas').click({position:{x:30,y:30}});await page.keyboard.press('Control+v');await expect(page.locator('#body-count')).toHaveText('2');
  await page.locator('#undo').click();await expect(page.locator('#body-count')).toHaveText('1');
 });
 test('marquee selects enclosed visible bodies and Escape cancels selection',async({page})=>{
  await page.locator('[data-action="duplicate-body"]').click();await expect(page.locator('#body-count')).toHaveText('2');await page.locator('[data-view="top"]').click();
  const r=await page.locator('#viewport canvas').boundingBox();await page.mouse.move(r.x+10,r.y+10);await page.mouse.down();await page.mouse.move(r.x+r.width-10,r.y+r.height-10,{steps:4});await page.mouse.up();
  await expect(page.locator('#body-list [data-multi-body]:checked')).toHaveCount(2);
  await page.mouse.move(r.x+10,r.y+10);await page.mouse.down();await page.mouse.move(r.x+40,r.y+40);await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.selection-marquee')).toBeHidden();
 });
 test('section UI makes capped halves without revisions or export modifications',async({page},info)=>{
  const before=await saved(page);await page.locator('[data-tool="section"]').click();await page.locator('[data-action="apply-section"]').click();
  await expect(page.locator('#section-status')).toHaveAttribute('data-volume','7200');expect(await saved(page)).toEqual(before);
  await page.screenshot({path:info.outputPath('section.png')});await page.locator('[data-section-axis]').selectOption('z');await page.locator('[data-field="section-offset"]').fill('3');await page.locator('#section-flip').check();await page.locator('[data-action="apply-section"]').click();
  await expect.poll(async()=>Number(await page.locator('#section-status').getAttribute('data-volume'))).toBeCloseTo(10800,4);
  await page.locator('[data-action="cancel-tool"]').click();expect(await saved(page)).toEqual(before);await expect(page.locator('#undo')).toBeDisabled();
 });
 test('CAD section and centroid respect transforms; overlap measures intersection volume',async({page})=>{
  const p=project([{...body,position:[5,6,7],rotation:[0,0,90]}]);const r=await cad(page,'model',{project:p});r.objects[0].centerOfMass.forEach((v,i)=>expect(v).toBeCloseTo([5,6,12][i],6));
  const section=await cad(page,'section',{project:p,axis:'z',offset:12,flip:false});expect(section.error).toBeUndefined();expect(section.objects[0].volume).toBeCloseTo(1000,5);expect(section.objects[0].bounds.max[2]).toBeCloseTo(12,5);
  expect((await cad(page,'section',{project:p,axis:'z',offset:-100,flip:false})).objects).toEqual([]);
  const measure=await cad(page,'measure',{project:project([body,{...body,id:'b',position:[10,0,0]}]),first:'a',second:'b'});expect(measure.intersectionVolume).toBeCloseTo(1000,5);
 });
 test('history suppression and rollback recalculate geometry and reject dependent reorder',async({page})=>{
  let p=project([body]),r=await cad(page,'model',{project:p});const top=r.objects[0].faces.find(f=>f.normal?.[2]>.99);
  p.objects[0].features=[{type:'extrude',face:top.id,reference:top.reference,depth:5,sketch:{kind:'rectangle',width:10,height:8,center:[0,0]}}];
  r=await cad(page,'model',{project:p});const upper=r.objects[0].faces.find(f=>f.normal?.[2]>.99&&f.origin[2]>14);
  p.objects[0].features.push({type:'pocket',face:upper.id,reference:upper.reference,depth:2,sketch:{kind:'circle',radius:2,center:[0,0]}});
  await page.locator('#project-file').setInputFiles({name:'history.formraum.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await expect(page.locator('#feature-list [data-feature="1"]')).toBeVisible();
  await page.locator('[data-feature="1"]').click();await page.locator('[data-action="suppress-feature"]').click();await expect.poll(async()=>(await saved(page)).project.objects[0].features[1].suppressed).toBe(true);
  expect((await cad(page,'model',{project:(await saved(page)).project})).objects[0].volume).toBeCloseTo(2400,5);
  await page.locator('#undo').click();await expect.poll(async()=>(await saved(page)).project.objects[0].features[1].suppressed).toBeUndefined();
  await page.locator('[data-feature="0"]').click();await page.locator('[data-action="rollback-feature"]').click();await expect.poll(async()=>(await saved(page)).project.objects[0].rollback).toBe(1);
  await page.locator('[data-view="top"]').click();const canvas=await page.locator('#viewport canvas').boundingBox();await page.mouse.click(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.locator('[data-tool="sketch"]').click();await expect(page.locator('#toast')).toContainText('Modellschritte wiederherstellen');await expect(page.locator('[data-sketch-kind]')).toHaveCount(0);
  await page.locator('[data-action="resume-history"]').click();await expect.poll(async()=>(await saved(page)).project.objects[0].rollback).toBeUndefined();const before=await saved(page);
  await page.locator('[data-feature="1"]').click();await page.locator('[data-reorder-feature="-1"]').click();await expect(page.locator('#toast')).toHaveClass(/error/);expect(await saved(page)).toEqual(before);
 });
});
