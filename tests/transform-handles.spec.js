import {test,expect} from '@playwright/test';
import {transformedBodies} from '../web/body-transform.js';
import {Quaternion,Vector3} from '../web/vendor/three.module.js';
const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))));
test('world rotation and uniform scaling share a pivot without mutating inputs',()=>{
 const p={version:1,objects:[{id:'a',position:[0,0,0],rotation:[0,0,30],scale:2},{id:'b',position:[20,0,0]}]},before=structuredClone(p);
 const q=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/2),r=transformedBodies(p,['a','b'],[10,0,0],q.toArray(),2);
 r.objects[0].position.forEach((v,i)=>expect(v).toBeCloseTo([10,-20,0][i],6));expect(r.objects[0].rotation[2]).toBeCloseTo(120,6);expect(r.objects[0].scale).toBe(4);expect(r.objects[1].scale).toBe(2);expect(p).toEqual(before);
 expect(()=>transformedBodies(p,['a'],[0,0,0],q.toArray(),-1)).toThrow();
});
test.describe('3D transform tools',()=>{
 test.beforeEach(async({page})=>{await page.goto('/');await ready(page);});
 test('numeric group rotation and scale keep shared center and undo together',async({page})=>{
  await page.locator('[data-action="duplicate-body"]').click();await expect(page.locator('#body-count')).toHaveText('2');await page.locator('#body-list [data-multi-body]').first().check();
  await page.locator('[data-tool="rotate"]').click();await page.locator('[data-action="apply-transform"]').click();await expect(page.locator('#toast')).toContainText('Auswahl gedreht');
  let objects=(await saved(page)).project.objects;expect(objects[0].rotation[2]).toBeCloseTo(90,6);objects[0].position.forEach((v,i)=>expect(v).toBeCloseTo([2.5,-2.5,0][i],6));
  await page.locator('[data-tool="scale"]').click();await page.locator('[data-action="apply-transform"]').click();await expect(page.locator('#toast')).toContainText('Auswahl skaliert');objects=(await saved(page)).project.objects;expect(objects[0].scale).toBe(2);expect(objects[0].position[2]).toBeCloseTo(-6,6);
  await page.locator('#undo').click();await expect.poll(async()=>(await saved(page)).project.objects[0].scale).toBe(1);
 });
 test('center scale grip changes actual CAD size and Escape cancels a second drag',async({page},info)=>{
  await page.locator('[data-view="top"]').click();await page.locator('[data-tool="scale"]').click();
  const r=await page.locator('#viewport canvas').boundingBox(),cx=r.x+r.width/2,cy=r.y+r.height/2;const before=await saved(page);
  // The central XYZ handle is at the selection pivot. Begin slightly off center
  // so the geometric scale ratio is well-defined.
  await page.mouse.move(cx+3,cy+3);await page.mouse.down();await page.mouse.move(cx+18,cy+18,{steps:5});await page.mouse.up();
  await expect.poll(async()=>(await saved(page)).revision).toBe(before.revision+1);expect((await saved(page)).project.objects[0].scale).toBeGreaterThan(1);
  await page.screenshot({path:info.outputPath('scale-handles.png')});const after=await saved(page);
  await page.mouse.move(cx+3,cy+3);await page.mouse.down();await page.mouse.move(cx+10,cy+10,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();expect(await saved(page)).toEqual(after);
 });
 test('rotation ring commits a world rotation',async({page},info)=>{
  await page.locator('[data-view="top"]').click();await page.locator('[data-tool="rotate"]').click();const before=await saved(page);
  const r=await page.locator('#viewport canvas').boundingBox(),cx=r.x+r.width/2,cy=r.y+r.height/2,radius=r.height*.9/8;
  await page.mouse.move(cx+radius/Math.sqrt(2),cy-radius/Math.sqrt(2));await page.mouse.down();await page.mouse.move(cx+radius,cy,{steps:8});await page.mouse.up();
  await expect.poll(async()=>(await saved(page)).revision).toBe(before.revision+1);expect(Math.abs((await saved(page)).project.objects[0].rotation[2])).toBeGreaterThan(10);await page.screenshot({path:info.outputPath('rotation-handles.png')});
 });
});
