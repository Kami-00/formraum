import {test,expect} from '@playwright/test';

const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))));
async function state(page){
 return {saved:await saved(page),bodies:await page.locator('#body-count').textContent(),undoDisabled:await page.locator('#undo').isDisabled(),redoDisabled:await page.locator('#redo').isDisabled()};
}
async function startFace(page){
 await page.locator('[data-view="top"]').click();
 const canvas=await page.locator('#viewport canvas').boundingBox();
 await page.mouse.click(canvas.x+canvas.width/2,canvas.y+canvas.height/2);
 await page.locator('[data-tool="sketch"]').click();
 await setRectangle(page,8);
}
async function setRectangle(page,depth){
 await page.locator('[data-sketch="width"]').fill('10');
 await page.locator('[data-sketch="height"]').fill('10');
 await page.locator('[data-sketch="depth"]').fill(String(depth));
}
async function previewVolume(page,volume){
 const status=page.locator('#sketch-preview-status');
 await expect(status).toHaveAttribute('data-state','ready',{timeout:60000});
 await expect.poll(async()=>Number(await status.getAttribute('data-volume')),{timeout:60000}).toBeCloseTo(volume,4);
}
async function persistedVolume(page){
 return page.evaluate(async()=>{
  const project=JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))).project;
  const result=await (await import('/cad-client.js')).calculate('model',{project});
  return result.objects.reduce((sum,body)=>sum+body.volume,0);
 });
}

test('face sketch previews exact additive and subtractive geometry without committing it',async({page})=>{
 await page.goto('/');await ready(page);const before=await state(page);
 await startFace(page);await expect(page.locator('#sketch-preview-enabled')).toBeChecked();
 await previewVolume(page,15200);expect(await state(page)).toEqual(before);
 await page.locator('[data-preview-mode="pocket"]').click();await previewVolume(page,13600);
 expect(await state(page)).toEqual(before);
 await expect(page.locator('#feature-list [data-feature="0"]')).toHaveCount(0);
 await expect(page.locator('[data-sketch="depth"]')).toHaveValue('8');
});

test('the latest depth wins even when an earlier CAD result arrives late',async({page})=>{
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;
  window.__previewDelay={held:false,delivered:false};
  window.Worker=class extends NativeWorker{
   constructor(...args){
    super(...args);const held=new Set();
    this.addEventListener('message',event=>{
     const objects=event.data?.result?.objects;
     if(!held.has(event.data?.id)&&objects?.some(body=>Math.abs(body.volume-14600)<1e-5)){
      held.add(event.data.id);event.stopImmediatePropagation();window.__previewDelay.held=true;
      setTimeout(()=>{this.dispatchEvent(new MessageEvent('message',{data:event.data}));window.__previewDelay.delivered=true;},700);
     }
    });
   }
  };
 });
 await page.goto('/');await ready(page);const before=await state(page);await startFace(page);await previewVolume(page,15200);
 await page.locator('[data-sketch="depth"]').fill('2');await page.waitForFunction(()=>window.__previewDelay.held);
 await page.locator('[data-sketch="depth"]').fill('4');await page.locator('[data-sketch="depth"]').fill('7');await page.locator('[data-sketch="depth"]').fill('8');
 await page.waitForFunction(()=>window.__previewDelay.delivered);await previewVolume(page,15200);
 await expect(page.locator('[data-sketch="depth"]')).toHaveValue('8');expect(await state(page)).toEqual(before);
});

test('an invalid separated extrusion reports an error and preserves the saved model',async({page})=>{
 await page.goto('/');await ready(page);const before=await state(page);await startFace(page);await previewVolume(page,15200);
 await page.locator('[data-sketch="center-u"]').fill('100');
 await expect(page.locator('#sketch-preview-status')).toHaveAttribute('data-state','error',{timeout:60000});
 expect(await state(page)).toEqual(before);await expect(page.locator('[data-sketch="center-u"]')).toHaveValue('100');
 await page.locator('[data-sketch="center-u"]').fill('0');await previewVolume(page,15200);expect(await state(page)).toEqual(before);
});

test('disabling and cancelling a preview leaves revisions, history and bodies unchanged',async({page})=>{
 await page.goto('/');await ready(page);const before=await state(page);await startFace(page);await previewVolume(page,15200);
 await page.locator('#sketch-preview-enabled').uncheck();
 await expect(page.locator('#sketch-preview-status')).toHaveAttribute('data-state','disabled');
 await page.locator('[data-sketch="depth"]').fill('6');
 await expect(page.locator('#sketch-preview-status')).toHaveAttribute('data-state','disabled');expect(await state(page)).toEqual(before);
 await page.locator('#sketch-preview-enabled').check();await previewVolume(page,15000);
 await page.locator('[data-action="cancel-sketch"]').click();
 await expect(page.locator('#sketch-preview-status')).toHaveCount(0);expect(await state(page)).toEqual(before);
 expect(await persistedVolume(page)).toBeCloseTo(14400,4);
});

for(const [mode,volume] of [['extrude',15200],['pocket',13600]])test(`only applying ${mode} commits its preview, exactly once`,async({page})=>{
 await page.goto('/');await ready(page);const before=await state(page);await startFace(page);
 await page.locator(`[data-preview-mode="${mode}"]`).click();await previewVolume(page,volume);expect(await state(page)).toEqual(before);
 await page.locator(`[data-action="${mode}"]`).click();await expect(page.locator('#feature-list [data-feature="0"]')).toBeVisible();await ready(page);
 const after=await saved(page);expect(after.revision).toBe(before.saved.revision+1);expect(after.project.objects).toHaveLength(1);
 expect(after.project.objects[0].features).toHaveLength(1);expect(after.project.objects[0].features[0]).toMatchObject({type:mode,depth:8});
 expect(await persistedVolume(page)).toBeCloseTo(volume,4);await expect(page.locator('#undo')).toBeEnabled();
 await page.locator('#undo').click();await expect(page.locator('#feature-list [data-feature="0"]')).toHaveCount(0);await ready(page);
 expect(await persistedVolume(page)).toBeCloseTo(14400,4);
});

test('standalone sketch previews only its new body and adds it on apply',async({page})=>{
 await page.goto('/');await ready(page);const before=await state(page);
 await page.locator('#plane-sketch').click();await setRectangle(page,8);
 await expect(page.locator('#sketch-preview-enabled')).toBeChecked();await expect(page.locator('[data-preview-mode="pocket"]')).toHaveCount(0);
 await previewVolume(page,800);expect(await state(page)).toEqual(before);await expect(page.locator('#body-count')).toHaveText('1');
 await page.locator('[data-action="extrude"]').click();await expect(page.locator('#body-count')).toHaveText('2');await ready(page);
 const after=await saved(page);expect(after.revision).toBe(before.saved.revision+1);
 expect(after.project.objects[1]).toMatchObject({kind:'profile',params:{height:8},profile:{kind:'rectangle',width:10,height:10}});
 expect(await persistedVolume(page)).toBeCloseTo(15200,4);
});

test('scaled rotated side-face preview matches applied depth in millimetres',async({page})=>{
 await page.goto('/');await ready(page);
 for(const [key,value] of [['scale','2'],['rotation-z','90'],['position-x','7'],['position-z','5']])await page.locator(`[data-field="${key}"]`).fill(value);
 await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');
 const before=await state(page);await page.locator('[data-view="front"]').click();
 const canvas=await page.locator('#viewport canvas').boundingBox();await page.mouse.click(canvas.x+canvas.width/2,canvas.y+canvas.height/2);
 await page.locator('[data-tool="sketch"]').click();await setRectangle(page,8);
 await previewVolume(page,14400*8+800);expect(await state(page)).toEqual(before);
 await page.locator('[data-action="extrude"]').click();await expect(page.locator('#feature-list [data-feature="0"]')).toBeVisible();await ready(page);
 expect(await persistedVolume(page)).toBeCloseTo(14400*8+800,4);
 const feature=(await saved(page)).project.objects[0].features[0];expect(feature.depth).toBe(4);expect(feature.sketch.width).toBe(5);
});

test('multiple contours and through-all pockets preview the same geometry as apply',async({page})=>{
 await page.goto('/');await ready(page);const before=await state(page);await startFace(page);
 await page.locator('[data-action="add-contour"]').click();await page.locator('[data-sketch="radius"]').fill('2');await page.locator('[data-sketch="center-u"]').fill('12');
 await page.locator('[data-preview-mode="pocket"]').click();await page.locator('[data-through-all]').check();
 const volume=14400-(100+4*Math.PI)*12;await previewVolume(page,volume);expect(await state(page)).toEqual(before);
 await page.locator('[data-action="pocket"]').click();await expect(page.locator('#feature-list [data-feature="0"]')).toBeVisible();await ready(page);
 expect(await persistedVolume(page)).toBeCloseTo(volume,4);
});

test('3D view exposes the pocket and returns to the drawing plane without a commit',async({page},testInfo)=>{
 await page.goto('/');await ready(page);const before=await state(page);await startFace(page);
 await page.locator('[data-preview-mode="pocket"]').click();await previewVolume(page,13600);
 await page.locator('#sketch-preview-3d').click();await expect(page.locator('#sketch-preview-3d')).toHaveText('Zur Skizzenansicht');
 await expect(page.locator('#navigation-hint')).toContainText('Rechts ziehen: drehen');
 await page.screenshot({path:testInfo.outputPath('pocket-preview-3d.png')});
 const label=page.locator('.sketch-dimension').filter({has:page.locator('[aria-label="Skizzenmaß width"]')});const originalPosition=await label.getAttribute('style');
 const canvas=await page.locator('#viewport canvas').boundingBox();await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.mouse.down({button:'right'});await page.mouse.move(canvas.x+canvas.width/2+60,canvas.y+canvas.height/2+30,{steps:6});await page.mouse.up({button:'right'});
 await expect.poll(()=>label.getAttribute('style')).not.toBe(originalPosition);
 await page.locator('#sketch-preview-3d').click();await expect(page.locator('#navigation-hint')).toContainText('Rechts ziehen: verschieben');
 await page.locator('[data-sketch="depth"]').fill('6');await previewVolume(page,13800);expect(await state(page)).toEqual(before);
});
