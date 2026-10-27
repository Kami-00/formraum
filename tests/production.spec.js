import {test,expect} from '@playwright/test';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
let server,url;
test.beforeAll(async()=>{
  const root=path.resolve('dist');
  server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(!pathname.startsWith('/formraum/')){res.writeHead(404).end();return;}
    const file=path.resolve(root,pathname.slice('/formraum/'.length)||'index.html');
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    try{
      const data=await readFile(file);
      const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[path.extname(file)]||'text/plain';
      res.writeHead(200,{'Content-Type':type});res.end(data);
    }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}/formraum/`;
});
test.afterAll(async()=>{await new Promise(resolve=>server.close(resolve));});
test('built app works on a static subpath and offline, including CAD export',async({page,context})=>{
  const failures=[],requests=[],errors=[];
  page.on('response',r=>{if(r.status()>=400)failures.push(r.url());});
  page.on('request',r=>requests.push({url:r.url(),method:r.method()}));page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  await page.locator('#project-file').setInputFiles('examples/Beispielbauteil.formraum.json');await expect(page.locator('#project-name')).toHaveValue('Beispielbauteil');
  await page.screenshot({path:'test-results/browser-cad.png',fullPage:true});
  await context.setOffline(true);await page.reload();await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
  await expect(page.locator('#project-name')).toHaveValue('Beispielbauteil');
  await page.getByRole('button',{name:'Zylinder',exact:true}).click();await expect(page.locator('#body-count')).toHaveText('2');
  await page.locator('#export-menu-button').click();const download=page.waitForEvent('download');await page.locator('[data-export="step"]').click();expect((await download).suggestedFilename()).toBe('Beispielbauteil.step');
  // The separate preview worker must also load from a subpath while offline.
  await page.locator('#plane-sketch').click();await page.locator('[data-sketch="width"]').fill('10');
  await expect(page.locator('#sketch-preview-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await expect.poll(async()=>Number(await page.locator('#sketch-preview-status').getAttribute('data-volume'))).toBeCloseTo(1000,4);
  await page.locator('[data-action="cancel-sketch"]').click();await expect(page.locator('#body-count')).toHaveText('2');
  // Generator calculations and detaching must work offline too.
  await page.locator('#open-generator').click();await page.locator('[data-gen-action="example"]').click();await page.locator('[data-gen-action="apply"]').click();await expect(page.locator('#body-count')).toHaveText('8');
  await page.locator('#open-generator').click();await page.locator('[data-gen-action="detach"]').click();await page.locator('[data-gen-action="apply"]').click();await expect(page.locator('#generator-dialog')).not.toBeVisible();
  // Exact free-sketch regions and their dedicated preview also run entirely offline.
  const entities=[{id:'a',kind:'line',a:[5,0],b:[15,0]},{id:'b',kind:'line',a:[15,0],b:[15,10]},{id:'c',kind:'line',a:[15,10],b:[5,10]},{id:'d',kind:'line',a:[5,10],b:[5,0]}];
  const {findRegions}=await import('../web/sketch-regions.js');
  const free={version:1,name:'Offline Rotation',sketches:[{id:'s',name:'Profil',entities}],objects:[{id:'r',kind:'region',sketchId:'s',regions:findRegions(entities).map(r=>r.id),params:{revolveAngle:360,axisOffset:0},features:[]}]};
  await page.locator('#project-file').setInputFiles({name:'offline.formraum.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(free))});await expect(page.locator('#project-name')).toHaveValue('Offline Rotation');
  await page.locator('#region-sketch-list button').click();await page.locator('[data-rs-action="preview"]').click();await expect(page.locator('#region-result')).toContainText('Gültiger Rotationskörper');await page.locator('[data-rs-action="close"]').click();
  await page.locator('#open-assembly').click();await page.locator('[data-eng="new-joint"]').click();await page.locator('#eng-value').fill('8');await page.locator('[data-eng="apply"]').click();await expect(page.locator('#engineering-dialog')).not.toBeVisible();
  await page.locator('#open-bindings').click();await expect(page.locator('#eng-measure')).toBeVisible();await page.locator('[data-eng="close"]').last().click();
  expect(errors).toEqual([]);expect(failures).toEqual([]);expect(requests.every(r=>r.method==='GET'&&r.url.startsWith(url))).toBe(true);
});
