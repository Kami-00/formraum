import {test,expect} from '@playwright/test';
import {defaultSweepPath} from '../web/profile-operations.js';
const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))));
const project=(operation,params,profile={kind:'circle',radius:2,center:[0,0]})=>({version:1,objects:[{id:'p',kind:'profile',operation,params,profile,contours:[],sweepPath:defaultSweepPath(),features:[],position:[0,0,0]}]});
const cad=(page,p)=>page.evaluate(async project=>{try{return await(await import('/cad-client.js')).calculate('model',{project});}catch(e){return {error:e.message};}},p);
test.beforeEach(async({page})=>{await page.goto('/');await ready(page);});
test('two-section loft matches cone frusta, handles offsets, holes and rejects invalid scales',async({page})=>{
 const p=project('loft',{height:10,topScale:.5});let r=await cad(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(Math.PI*10/3*(4+2+1),4);
 p.objects[0].params.topU=10;p.objects[0].params.topV=5;r=await cad(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(Math.PI*70/3,4);
 p.objects[0].contours=[{kind:'circle',radius:1,center:[0,0],role:'hole'}];r=await cad(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(Math.PI*70/3*.75,4);
 p.objects[0].params.topScale=0;expect((await cad(page,p)).error).toBeDefined();
});
test('sweep follows a planar polyline with exact volume and hollow sections',async({page})=>{
 const p=project('sweep',{});let r=await cad(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(200*Math.PI,4);
 p.objects[0].contours=[{kind:'circle',radius:1,center:[0,0],role:'hole'}];r=await cad(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(150*Math.PI,4);
 p.objects[0].sweepPath[1].x=1;expect((await cad(page,p)).error).toContain('senkrecht');
});
for(const operation of ['loft','sweep'])test(`${operation} live preview, draft restoration and body dimension edits`,async({page},info)=>{
 await page.locator('#plane-sketch').click();await page.locator('[data-sketch-kind="circle"]').click();await page.locator('[data-sketch="radius"]').fill('2');await page.locator('[data-profile-operation]').selectOption(operation);
 if(operation==='loft')await page.locator('[data-sketch="topScale"]').fill('0.75');
 else await page.locator('[data-sweep-point="2"][data-axis="x"]').fill('30');
 const status=page.locator('#sketch-preview-status');await expect(status).toHaveAttribute('data-state','ready',{timeout:60000});const preview=Number(await status.getAttribute('data-volume'));const before=await saved(page);
 await page.waitForTimeout(250);await page.reload();await ready(page);await expect(page.locator('[data-profile-operation]')).toHaveValue(operation);expect(await saved(page)).toEqual(before);
 await expect(status).toHaveAttribute('data-state','ready',{timeout:60000});await expect.poll(async()=>Number(await status.getAttribute('data-volume'))).toBeCloseTo(preview,4);
 await page.locator('#sketch-preview-3d').click();await page.screenshot({path:info.outputPath(operation+'.png')});await page.locator('[data-action="extrude"]').click();await expect(page.locator('#body-count')).toHaveText('2');
 const p=(await saved(page)).project;expect(p.objects.at(-1).operation).toBe(operation);expect((await cad(page,p)).objects.at(-1).volume).toBeCloseTo(preview,4);
 await page.locator('[data-field="profile-radius"]').fill('1');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');expect((await cad(page,(await saved(page)).project)).objects.at(-1).volume).toBeCloseTo(preview/4,4);
});
