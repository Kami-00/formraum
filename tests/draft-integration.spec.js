import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createBridge} from '../mcp/bridge.js';

const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))));
async function sketch(page){
 await page.goto('/');await ready(page);await page.locator('[data-view="top"]').click();
 const r=await page.locator('#viewport canvas').boundingBox();await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
 await page.locator('[data-tool="sketch"]').click();await page.locator('[data-sketch="width"]').fill('8');await page.locator('[data-sketch="height"]').fill('6');await page.locator('[data-sketch="depth"]').fill('4');
}
async function draftCount(page){return page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('formraum.sketch-draft.')).length);}

test('an unfinished face sketch survives reload and is still editable and applicable',async({page})=>{
 await sketch(page);await expect.poll(()=>draftCount(page)).toBe(1);const before=await saved(page);
 await page.reload();await ready(page);await expect(page.locator('[data-sketch="width"]')).toHaveValue('8');await expect(page.locator('[data-sketch="height"]')).toHaveValue('6');await expect(page.locator('[data-sketch="depth"]')).toHaveValue('4');
 expect((await saved(page)).revision).toBe(before.revision);expect((await saved(page)).project.objects[0].features).toHaveLength(0);
 await page.locator('[data-sketch="width"]').fill('9');await page.locator('[data-action="extrude"]').click();await expect(page.locator('#feature-list [data-feature="0"]')).toContainText('Aufbauen');
 const current=await saved(page);expect(current.project.objects[0].features[0].sketch.width).toBe(9);
 await page.reload();await ready(page);await expect(page.locator('[data-sketch="width"]')).toHaveCount(0);expect((await saved(page)).project.objects[0].features).toHaveLength(1);
});

test('project file contains all unfinished contours and opens them without prematurely adding geometry',async({page})=>{
 await sketch(page);await page.locator('[data-action="add-contour"]').click();await page.locator('[data-sketch="radius"]').fill('2');await page.locator('[data-sketch="center-u"]').fill('12');
 const downloadEvent=page.waitForEvent('download');await page.locator('#save-project').click();const file=await downloadEvent,bytes=await readFile(await file.path()),data=JSON.parse(bytes.toString('utf8'));
 expect(data.objects[0].features).toHaveLength(0);expect(data.sketchDraft.profiles).toHaveLength(2);expect(data.sketchDraft.profiles[1].radius).toBe(2);expect(data.sketchDraft.activeContour).toBe(1);
 await page.locator('#project-file').setInputFiles({name:'Entwurf.formraum.json',mimeType:'application/json',buffer:bytes});
 await expect(page.locator('[data-sketch="radius"]')).toHaveValue('2');await expect(page.locator('[data-sketch="center-u"]')).toHaveValue('12');await expect(page.locator('[data-contour]')).toHaveCount(2);
 await page.locator('[data-action="pocket"]').click();await expect(page.locator('#feature-list [data-feature="0"]')).toContainText('Ausschneiden');
});

test('draft storage failure keeps file saving available and leaves the saved model intact',async({page})=>{
 await page.goto('/');await ready(page);const original=await saved(page);
 await page.evaluate(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('formraum.sketch-draft.'))throw new DOMException('full','QuotaExceededError');return write.call(this,k,v);};});
 await page.locator('#plane-sketch').click();await page.locator('[data-sketch="width"]').fill('17');
 await expect(page.locator('#autosave-status')).toContainText('ungesichert');expect(await saved(page)).toEqual(original);
 await page.locator('#add-cylinder').click();await expect(page.locator('[data-sketch="width"]')).toHaveValue('17');expect(await saved(page)).toEqual(original);
 await page.keyboard.press('Escape');await expect(page.locator('[data-sketch="width"]')).toHaveValue('17');
 const download=page.waitForEvent('download');await page.locator('#save-project').click();const data=JSON.parse(await readFile(await(await download).path(),'utf8'));
 expect(data.sketchDraft.profiles[0].width).toBe(17);expect(await saved(page)).toEqual(original);
});

test('removing the last drawn contour does not resurrect it on reload',async({page})=>{
 await page.goto('/');await ready(page);await page.locator('#plane-sketch').click();await page.locator('[data-action="add-contour"]').click();await page.locator('[data-sketch="radius"]').fill('2');await expect.poll(()=>draftCount(page)).toBe(1);
 await page.locator('[data-action="remove-contour"]').click();await expect.poll(()=>draftCount(page)).toBe(0);
 await page.reload();await ready(page);await expect(page.locator('[data-sketch="width"]')).toHaveCount(0);
});

test('model mutations cannot invalidate an active face sketch',async({page})=>{
 await sketch(page);await page.locator('[data-action="extrude"]').click();await expect(page.locator('#feature-list [data-feature="0"]')).toContainText('Aufbauen');
 await page.locator('[data-view="top"]').click();const r=await page.locator('#viewport canvas').boundingBox();await page.mouse.click(r.x+r.width/2,r.y+r.height/2);await page.locator('[data-tool="sketch"]').click();await page.locator('[data-sketch="width"]').fill('4');
 const before=await saved(page);await page.locator('[data-remove-feature="0"]').click();await expect(page.locator('#toast')).toContainText('Skizze zuerst');expect(await saved(page)).toEqual(before);await expect(page.locator('[data-sketch="width"]')).toHaveValue('4');
 const download=page.waitForEvent('download');await page.locator('#save-project').click();const bytes=await readFile(await(await download).path());
 await page.locator('#project-file').setInputFiles({name:'Konsistenter-Entwurf.formraum.json',mimeType:'application/json',buffer:bytes});await expect(page.locator('[data-sketch="width"]')).toHaveValue('4');expect((await saved(page)).project.objects[0].features).toHaveLength(1);
});

test('an outdated draft restores its original model as a separate project',async({page})=>{
 await sketch(page);await expect.poll(()=>draftCount(page)).toBe(1);const original=await saved(page);
 // A different model revision exists, as after a commit in another tab.
 await page.evaluate(()=>{const k='formraum.project.library.'+localStorage.getItem('formraum.active-project'),r=JSON.parse(localStorage.getItem(k));r.project.objects[0].params.width=65;r.revision++;localStorage.setItem(k,JSON.stringify(r));});
 await page.reload();await ready(page);await expect(page.locator('[data-field="width"]')).toHaveValue('65');await expect(page.locator('[data-sketch="width"]')).toHaveCount(0);
 await page.locator('#projects-button').click();await page.locator('[data-restore-draft]').first().click();await expect(page.locator('[data-sketch="width"]')).toHaveValue('8');
 const recovered=await saved(page);expect(recovered.id).not.toBe(original.id);expect(recovered.project.objects[0].params.width).toBe(40);
 expect(await page.evaluate(id=>JSON.parse(localStorage.getItem('formraum.project.library.'+id)).project.objects[0].params.width,original.id)).toBe(65);
});

test('damaged raw project bytes can be downloaded from the recovery section',async({page})=>{
 await page.goto('/');await ready(page);await page.evaluate(()=>localStorage.setItem('formraum.project.library.broken','{broken bytes'));
 await page.locator('#projects-button').click();
 await expect(page.locator('.project-recovery')).toContainText('Beschädigte Sicherungen');
 const download=page.waitForEvent('download');await page.locator('[data-backup-damaged]').click();expect(await readFile(await(await download).path(),'utf8')).toBe('{broken bytes');
 expect(await page.evaluate(()=>localStorage.getItem('formraum.project.library.broken'))).toBe('{broken bytes');
});

test('MCP cannot overwrite uncommitted dimensions after the field loses focus',async({page})=>{
 const bridge=await createBridge({port:0});
 try{
  const info=bridge.connection();await page.goto('/');await ready(page);await page.locator('#session-button').click();await page.locator('#session-port').fill(String(info.port));await page.locator('#session-token').fill(info.code);await page.locator('#session-connect').click();await expect(page.locator('#session-status')).toContainText('Verbunden');await page.locator('[aria-label="KI-Verbindung schließen"]').click();
  const first=await bridge.request('get');const project=structuredClone(first.project);project.objects[0].params.width=56;
  await page.locator('[data-field="width"]').fill('47');await page.locator('#fit-view').click();
  await expect(bridge.request('apply',{projectId:first.projectId,revision:first.revision,project})).rejects.toThrow('nicht übernommen');await expect(page.locator('[data-field="width"]')).toHaveValue('47');expect((await bridge.request('get')).revision).toBe(first.revision);
  await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');const committed=await bridge.request('get');
  await bridge.request('apply',{projectId:committed.projectId,revision:committed.revision,project});await expect(page.locator('[data-field="width"]')).toHaveValue('56');
 }finally{await bridge.close();}
});
