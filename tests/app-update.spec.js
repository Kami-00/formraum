import {test,expect} from '@playwright/test';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
let server,url,release=1;
test.beforeAll(async()=>{
 const root=path.resolve('dist');
 server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!pathname.startsWith('/formraum/'))return res.writeHead(404).end();
  const file=path.resolve(root,pathname.slice('/formraum/'.length)||'index.html');
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{
   let data=await readFile(file);
   if(file.endsWith('sw.js'))data=Buffer.from(data.toString().replace('const CACHE=PREFIX+',`const CACHE=PREFIX+'release-${release}-'+`));
   if(file.endsWith('index.html'))data=Buffer.from(data.toString().replace('<html ',`<html data-release="${release}" `));
   res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(data);
  }catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}/formraum/`;
});
test.afterAll(async()=>{await new Promise(resolve=>server.close(resolve));});
test.beforeEach(()=>{release=1;});
async function ready(page){
 await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
}
const check=page=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
test('a new cached build turns the notice red and a click reloads it without losing the project',async({page})=>{
 await page.goto(url);await ready(page);await expect(page.locator('#update-app')).toBeHidden();
 await page.locator('#project-file').setInputFiles('examples/Beispielbauteil.formraum.json');await expect(page.locator('#project-name')).toHaveValue('Beispielbauteil');
 release=2;await check(page);
 const button=page.locator('#update-app');await expect(button).toBeVisible({timeout:60000});await expect(button).toHaveCSS('background-color','rgb(185, 28, 28)');await expect(page.locator('html')).toHaveAttribute('data-release','1');
 await page.locator('[data-field="position-x"]').fill('15');await button.click();await expect(page.locator('#toast')).toContainText('Eingaben bleiben erhalten');await expect(page.locator('html')).toHaveAttribute('data-release','1');await expect(page.locator('[data-field="position-x"]')).toHaveValue('15');
 await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');
 await button.click();await expect(page.locator('html')).toHaveAttribute('data-release','2',{timeout:60000});await ready(page);await expect(button).toBeHidden();await expect(page.locator('#project-name')).toHaveValue('Beispielbauteil');await expect(page.locator('[data-field="position-x"]')).toHaveValue('15');
});
test('periodic checks, a preexisting waiting worker and activation by another tab are handled',async({page,context})=>{
 await page.clock.install();await page.goto(url);await ready(page);
 release=2;await page.clock.fastForward(60001);await expect(page.locator('#update-app')).toBeVisible({timeout:60000});
 const other=await context.newPage();await other.goto(url);await ready(other);await expect(other.locator('#update-app')).toBeVisible();await expect(other.locator('html')).toHaveAttribute('data-release','1');
 await page.locator('#update-app').click();await expect(page.locator('html')).toHaveAttribute('data-release','2',{timeout:60000});
 await expect(other.locator('html')).toHaveAttribute('data-release','1');await other.locator('#update-app').click();await expect(other.locator('html')).toHaveAttribute('data-release','2');await ready(other);await expect(other.locator('#update-app')).toBeHidden();
});
