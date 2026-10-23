import {test,expect} from '@playwright/test';
const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
const active=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))));
test('projects are independent, can be renamed, duplicated, deleted and restored',async({page})=>{
 await page.goto('/');await ready(page);
 await page.locator('#project-name').fill('Gehäuse');await page.locator('#project-name').press('Tab');await ready(page);
 const first=(await active(page)).id;
 await page.locator('#new-project').click();await expect(page.locator('#body-count')).toHaveText('0');
 await page.locator('#project-name').fill('Deckel');await page.locator('#project-name').press('Tab');await ready(page);
 await page.locator('#add-cylinder').click();await expect(page.locator('#body-count')).toHaveText('1');
 const second=(await active(page)).id;expect(second).not.toBe(first);
 await page.locator('#projects-button').click();await page.locator(`[data-open-saved="${first}"]`).click();await expect(page.locator('#project-name')).toHaveValue('Gehäuse');await expect(page.locator('#body-list')).toContainText('Quader');await expect(page.locator('#undo')).toBeDisabled();
 await page.locator('#projects-button').click();await page.locator(`[data-duplicate-project="${first}"]`).click();await expect(page.locator('#project-name')).toHaveValue('Gehäuse Kopie');
 await page.locator('#projects-button').click();page.once('dialog',d=>d.accept());await page.locator(`[data-delete-project="${second}"]`).click();await expect(page.locator('.project-card')).toHaveCount(2);
 await page.locator('[aria-label="Projektverwaltung schließen"]').click();await expect(page.locator('#projects-dialog')).not.toBeVisible();
 await page.reload();await ready(page);await expect(page.locator('#project-name')).toHaveValue('Gehäuse Kopie');
});
test('legacy backup migration is preserved and import creates a separate project',async({page})=>{
 await page.goto('/');await ready(page);
 await page.evaluate(()=>{localStorage.clear();localStorage.setItem('formraum.project.v1',JSON.stringify({version:1,name:'Altes Projekt',objects:[]}));});
 await page.reload();await ready(page);await expect(page.locator('#project-name')).toHaveValue('Altes Projekt');
 await page.locator('#project-file').setInputFiles('examples/Beispielbauteil.formraum.json');await expect(page.locator('#project-name')).toHaveValue('Beispielbauteil');
 await page.locator('#projects-button').click();await expect(page.locator('.project-card')).toHaveCount(2);await expect(page.locator('#project-library')).toContainText('Altes Projekt');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.v1')).name)).toBe('Altes Projekt');
});
test('another tab cannot silently overwrite a newer revision',async({page,context})=>{
 await page.goto('/');await ready(page);const other=await context.newPage();await other.goto('/');await ready(other);
 await page.locator('#add-cylinder').click();await expect(page.locator('#body-count')).toHaveText('2');
 await other.locator('#add-box').click();await expect(other.locator('#toast')).toContainText('anderen Tab');
 expect((await active(other)).project.objects).toHaveLength(2);await expect(other.locator('#body-count')).toHaveText('1');
});
test('quota failures do not replace the saved project or the visible model',async({page})=>{
 await page.goto('/');await ready(page);const original=await active(page);
 await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('formraum.project.library.'))throw new DOMException('full','QuotaExceededError');return set.call(this,k,v);};});
 await page.locator('#add-cylinder').click();await expect(page.locator('#toast')).toContainText('Speicher voll');await expect(page.locator('#body-count')).toHaveText('1');expect(await active(page)).toEqual(original);
});
