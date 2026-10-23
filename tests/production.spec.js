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
  expect(errors).toEqual([]);expect(failures).toEqual([]);expect(requests.every(r=>r.method==='GET'&&r.url.startsWith(url))).toBe(true);
});
