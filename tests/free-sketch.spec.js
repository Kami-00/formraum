import {test,expect} from '@playwright/test';
import {validateVertices} from '../web/profile-geometry.js';
import {profileExtents} from '../web/sketch-position.js';
const vertices=points=>points.map(([x,y],i)=>({id:'v'+i,x,y}));
const profile=points=>({kind:'polyline',vertices:vertices(points),closed:true,center:[0,0]});
const model=p=>({version:1,objects:[{id:'p',name:'Kontur',kind:'profile',profile:p,contours:[],plane:'XY',params:{height:5},features:[],position:[0,0,0]}]});
const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))));
const cad=(page,project,operation='model')=>page.evaluate(async({project,operation})=>{try{return await(await import('/cad-client.js')).calculate(operation,{project});}catch(e){return {error:e.message};}},{project,operation});

test('free contours reject touching, crossed, degenerate, duplicate and nonnumeric vertices',()=>{
 for(const p of [[[0,0],[10,10],[0,10],[10,0]],[[0,0],[10,0],[5,0]],[[0,0],[10,0],[10,0],[0,10]],[[0,0],[10,0],[10,10],[5,0],[0,10]]])expect(()=>validateVertices(vertices(p))).toThrow();
 expect(()=>validateVertices([{id:'x',x:0,y:0},{id:'x',x:1,y:0},{id:'y',x:0,y:1}])).toThrow();
 const p=profile([[0,0],[10,0],[10,5],[5,5],[5,10],[0,10]]);expect(validateVertices(p.vertices)).toHaveLength(6);
 expect(profileExtents({...p,angle:90}).min[0]).toBeCloseTo(-10);
 expect(profileExtents({kind:'slot',width:20,height:10,angle:90})).toEqual({min:[-5,-10],max:[5,10]});
});

test.describe('CAD contours',()=>{
 test.beforeEach(async({page})=>{await page.goto('/');await ready(page);});
 test('concave line profiles make valid solids, holes and STEP exports',async({page})=>{
  const p=model(profile([[0,0],[10,0],[10,5],[5,5],[5,10],[0,10]]));
  const r=await cad(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(375,5);
  p.objects[0].contours=[{kind:'circle',radius:1,center:[2,2],role:'hole'}];
  expect((await cad(page,p)).objects[0].volume).toBeCloseTo(375-5*Math.PI,5);expect((await cad(page,p,'export_step')).error).toBeUndefined();
  p.objects[0].profile.closed=false;expect((await cad(page,p)).error).toContain('schließen');
 });
 test('horizontal, vertical and circular slots use exact arcs',async({page})=>{
  for(const [width,height,area] of [[20,10,100+25*Math.PI],[10,20,100+25*Math.PI],[10,10,25*Math.PI]]){
   const r=await cad(page,model({kind:'slot',width,height,center:[0,0]}));expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(area*5,5);
  }
 });
 test('full and partial revolutions use offset axes and reject axis crossing',async({page})=>{
  const p=model({kind:'rectangle',width:4,height:10,center:[5,0]});p.objects[0].operation='revolve';p.objects[0].params={revolveAngle:360,axisOffset:1};
  let r=await cad(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(Math.PI*(36-4)*10,5);
  p.objects[0].params.revolveAngle=180;r=await cad(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(Math.PI*160,5);
  p.objects[0].params.revolveAngle=400;expect((await cad(page,p)).error).toContain('360');
  p.objects[0].params={revolveAngle:360,axisOffset:5};expect((await cad(page,p)).error).toBeDefined();
 });
 test('clicking a free contour persists open drafts, closes, previews, edits and undoes',async({page},info)=>{
  await page.locator('#plane-sketch').click();await page.locator('[data-sketch-kind="polyline"]').click();
  const r=await page.locator('#viewport canvas').boundingBox(),cx=r.x+r.width/2,cy=r.y+r.height/2;
  for(const [x,y] of [[-50,40],[60,40],[60,-40],[-50,-40]])await page.mouse.click(cx+x,cy+y);
  await expect(page.locator('[data-vertex-axis="x"]')).toHaveCount(4);await expect(page.locator('[data-action="extrude"]')).toBeDisabled();
  await page.waitForTimeout(250);await page.reload();await ready(page);await expect(page.locator('[data-vertex-axis="x"]')).toHaveCount(4);
  const coords=[[-10,-5],[10,-5],[10,5],[-10,5]];
  for(let i=0;i<4;i++)for(const [axis,n] of [['x',0],['y',1]])await page.locator(`[data-vertex-index="${i}"][data-vertex-axis="${axis}"]`).fill(String(coords[i][n]));
  const before=await saved(page);await page.locator('[data-action="close-polyline"]').click();
  await expect(page.locator('#sketch-preview-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await expect.poll(async()=>Number(await page.locator('#sketch-preview-status').getAttribute('data-volume'))).toBeCloseTo(2000,5);
  expect(await saved(page)).toEqual(before);await page.screenshot({path:info.outputPath('free-contour.png')});
  await page.locator('[data-action="extrude"]').click();await expect(page.locator('#body-count')).toHaveText('2');
  const original=(await saved(page)).project.objects.at(-1);expect(original.profile.vertices[0].id).toBeTruthy();
  await page.locator('[data-vertex-index="1"][data-vertex-axis="x"]').fill('15');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');
  expect((await saved(page)).project.objects.at(-1).profile.vertices[1]).toMatchObject({id:original.profile.vertices[1].id,x:15});
  await page.locator('#undo').click();await expect.poll(async()=>(await saved(page)).project.objects.at(-1).profile).toEqual(original.profile);
 });
 test('rotation preview and dimensions survive reload and switch back to extrusion',async({page})=>{
  await page.locator('#plane-sketch').click();await page.locator('[data-sketch="width"]').fill('4');await page.locator('[data-sketch="height"]').fill('10');await page.locator('[data-sketch="center-u"]').fill('6');
  await page.locator('[data-profile-operation]').selectOption('revolve');await page.locator('[data-sketch="axisOffset"]').fill('2');await page.locator('[data-sketch="revolveAngle"]').fill('180');
  await expect(page.locator('#sketch-preview-status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await expect.poll(async()=>Number(await page.locator('#sketch-preview-status').getAttribute('data-volume'))).toBeCloseTo(160*Math.PI,4);
  await page.waitForTimeout(250);await page.reload();await ready(page);await expect(page.locator('[data-profile-operation]')).toHaveValue('revolve');await expect(page.locator('[data-sketch="revolveAngle"]')).toHaveValue('180');
  await page.locator('[data-action="extrude"]').click();await expect(page.locator('#body-count')).toHaveText('2');
  await page.locator('[data-profile-operation]').selectOption('extrude');await page.locator('[data-field="height"]').fill('3');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');
  const r=await cad(page,(await saved(page)).project);expect(r.objects.at(-1).volume).toBeCloseTo(120,5);
 });
 test('free points on scaled faces use world millimetres and reject crossed edits atomically',async({page})=>{
  await page.locator('[data-field="scale"]').fill('2');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');
  await page.locator('[data-view="top"]').click();const r=await page.locator('#viewport canvas').boundingBox(),cx=r.x+r.width/2,cy=r.y+r.height/2;
  await page.mouse.click(cx,cy);await page.locator('[data-tool="sketch"]').click();await page.locator('[data-sketch-kind="polyline"]').click();
  for(const [x,y] of [[-40,40],[40,40],[40,-40],[-40,-40]])await page.mouse.click(cx+x,cy+y);
  const coords=[[-10,-5],[10,-5],[10,5],[-10,5]];
  for(let i=0;i<4;i++)for(const [axis,n] of [['x',0],['y',1]])await page.locator(`[data-vertex-index="${i}"][data-vertex-axis="${axis}"]`).fill(String(coords[i][n]));
  await page.locator('[data-action="close-polyline"]').click();await page.locator('[data-sketch="depth"]').fill('4');await page.locator('[data-action="extrude"]').click();await expect(page.locator('[data-feature="0"]')).toBeVisible();
  const before=await saved(page);expect(before.project.objects[0].features[0].sketch.vertices[1].x).toBe(5);expect((await cad(page,before.project)).objects[0].volume).toBeCloseTo(116000,4);
  await page.locator('[data-feature="0"]').click();await expect(page.locator('[data-vertex-index="1"][data-vertex-axis="x"]')).toHaveValue('10');
  await page.locator('[data-vertex-index="1"][data-vertex-axis="x"]').fill('-15');await page.locator('[data-action="apply-feature"]').click();await expect(page.locator('#toast')).toHaveClass(/error/);expect(await saved(page)).toEqual(before);
 });
});
