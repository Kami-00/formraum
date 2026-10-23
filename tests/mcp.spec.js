import {test,expect} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createBridge} from '../mcp/bridge.js';
import WebSocket from 'ws';
const call=async(client,name,args={})=>{const response=await client.callTool({name,arguments:args});return {response,...(response.content[0]?.type==='text'?JSON.parse(response.content[0].text):{})};};
test('real MCP stdio client pairs, models, protects revisions, undoes and disconnects',async({page})=>{
 const transport=new StdioClientTransport({command:process.execPath,args:['mcp/server.js'],env:{...process.env,FORMRAUM_PORT:'18788'},stderr:'pipe'});
 const client=new Client({name:'formraum-test',version:'1.0.0'});
 try{
  await client.connect(transport);expect((await client.listTools()).tools).toHaveLength(8);
  expect((await call(client,'formraum_get_project')).response.isError).toBe(true);
  const conn=await call(client,'formraum_connection');await page.goto('/');await expect(page.locator('#status')).toContainText('Geometrie bereit');
  await page.locator('#session-button').click();await page.locator('#session-port').fill(String(conn.port));await page.locator('#session-token').fill(conn.code);await page.locator('#session-connect').click();await expect(page.locator('#session-status')).toContainText('Verbunden');
  await page.locator('[aria-label="KI-Verbindung schließen"]').click();
  const first=await call(client,'formraum_get_project');const guard={projectId:first.projectId,revision:first.revision};
  const project=structuredClone(first.project);project.objects[0].params.width=55;
  const changed=await call(client,'formraum_apply_project',{...guard,project});expect(changed.response.isError).not.toBe(true);expect(changed.geometry[0].volume).toBeCloseTo(55*30*12,4);
  await expect(page.locator('[data-field="width"]')).toHaveValue('55');
  expect((await call(client,'formraum_apply_project',{...guard,project})).response.isError).toBe(true);
  const bad=structuredClone(project);bad.objects[0].params.width=-4;
  expect((await call(client,'formraum_apply_project',{projectId:changed.projectId,revision:changed.revision,project:bad})).response.isError).toBe(true);
  expect((await call(client,'formraum_get_project')).revision).toBe(changed.revision);
  const undone=await call(client,'formraum_undo',{projectId:changed.projectId,revision:changed.revision});expect(undone.project.objects[0].params.width).toBe(40);
  const view=await client.callTool({name:'formraum_get_view',arguments:{}});expect(view.content[0].type).toBe('image');expect(view.content[0].data.length).toBeGreaterThan(1000);
  const created=await call(client,'formraum_create_project',{projectId:undone.projectId,revision:undone.revision,name:'KI Projekt'});expect(created.projectId).not.toBe(first.projectId);
  expect((await call(client,'formraum_list_projects')).projects).toHaveLength(2);
  const opened=await call(client,'formraum_open_project',{projectId:created.projectId,revision:created.revision,targetId:first.projectId});expect(opened.projectId).toBe(first.projectId);
  await page.locator('#session-button').click();await page.locator('#session-disconnect').click();await expect(page.locator('#session-status')).toHaveText('Nicht verbunden');
  await expect.poll(async()=>(await call(client,'formraum_connection')).connected).toBe(false);
  expect((await call(client,'formraum_get_project')).response.isError).toBe(true);
 }finally{await client.close();}
});
test('bridge rejects foreign origins, bad codes and a second paired tab',async()=>{
 const bridge=await createBridge({port:0});const info=bridge.connection(),url=`ws://127.0.0.1:${info.port}/session`;
 async function connect(origin,token){return new Promise(resolve=>{
  const ws=new WebSocket(url,{origin});ws.on('error',()=>resolve({ok:false,ws}));ws.on('close',()=>resolve({ok:false,ws}));ws.on('open',()=>ws.send(JSON.stringify({type:'hello',token})));ws.on('message',data=>resolve({ok:JSON.parse(data).type==='ready',ws}));
 });}
 try{
  expect((await connect('https://evil.example',info.code)).ok).toBe(false);
  expect((await connect('https://kami-00.github.io','é'.repeat(64))).ok).toBe(false);
  const first=await connect('https://kami-00.github.io',info.code);expect(first.ok).toBe(true);
  expect((await connect('https://kami-00.github.io',info.code)).ok).toBe(false);first.ws.close();
 }finally{await bridge.close();}
});

test('HTTPS-hosted production app can pair with the loopback bridge',async({page,context})=>{
 await context.grantPermissions(['local-network-access'],{origin:'https://kami-00.github.io'});
 const {readFile}=await import('node:fs/promises');const path=await import('node:path');
 const bridge=await createBridge({port:0});const info=bridge.connection();
 try{
  await page.route('https://kami-00.github.io/formraum/**',async route=>{
   const relative=new URL(route.request().url()).pathname.slice('/formraum/'.length)||'index.html';
   const file=path.resolve('dist',relative),type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[path.extname(file)]||'text/plain';
   await route.fulfill({body:await readFile(file),contentType:type});
  });
  await page.goto(`https://kami-00.github.io/formraum/#mcp=${info.code}&port=${info.port}`);
  await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
  expect(page.url()).not.toContain(info.code);expect(bridge.connection().connected).toBe(false);
  await page.locator('#session-connect').click();await expect(page.locator('#session-status')).toContainText('Verbunden',{timeout:15000});
  expect((await bridge.request('get')).project.objects).toHaveLength(1);
 }finally{await bridge.close();}
});
