import {test,expect} from '@playwright/test';
import {draggedProfileBounds} from '../web/sketch-drag.js';

const rotate=([x,y],angle)=>{const a=angle*Math.PI/180;return [x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];};
const corner=(profile,x,y,angle)=>{const offset=rotate([x*profile.width/2,y*profile.height/2],angle);return offset.map((v,i)=>profile.center[i]+v);};
const closePoint=(actual,expected)=>actual.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],8));

test('rotated rectangle corners and ellipse bounding corners follow the drag in every direction',()=>{
 for(const angle of [0,30,90,-45])for(const x of [-1,1])for(const y of [-1,1]){
  const start=[3,-4],delta=rotate([x*10,y*20],angle),end=start.map((v,i)=>v+delta[i]);
  const result=draggedProfileBounds(start,end,{angle,width:7,height:6});
  expect(result.width).toBeCloseTo(10,8);expect(result.height).toBeCloseTo(20,8);
  closePoint(corner(result,-x,-y,angle),start);closePoint(corner(result,x,y,angle),end);
 }
 const quarterTurn=draggedProfileBounds([0,0],[10,20],{angle:90});
 expect(quarterTurn.width).toBeCloseTo(20,8);expect(quarterTurn.height).toBeCloseTo(10,8);closePoint(quarterTurn.center,[5,10]);
});

test('rotated locked dimensions retain the initial corner and both drag directions',()=>{
 for(const locks of [{width:true},{height:true},{width:true,height:true}])for(const x of [-1,1])for(const y of [-1,1]){
  const angle=30,start=[-7,8],delta=rotate([x*20,y*30],angle),end=start.map((v,i)=>v+delta[i]);
  const result=draggedProfileBounds(start,end,{angle,width:8,height:6,locks});
  expect(result.width).toBeCloseTo(locks.width?8:20,8);expect(result.height).toBeCloseTo(locks.height?6:30,8);
  closePoint(corner(result,-x,-y,angle),start);
 }
});

test('square suggestions respect locks and keep the rotated starting corner fixed',()=>{
 const angle=30,start=[3,-4],delta=rotate([-10,10.2],angle),end=start.map((v,i)=>v+delta[i]);
 const square=draggedProfileBounds(start,end,{angle},.3);
 expect(square.equalSides).toBe(true);expect(square.height).toBeCloseTo(square.width,8);closePoint(corner(square,1,-1,angle),start);
 const free=draggedProfileBounds(start,end,{angle});expect(free.equalSides).toBe(false);expect(free.height).toBeCloseTo(10.2,8);
 const lockedHeight=draggedProfileBounds(start,end,{angle,width:10,height:10.2,locks:{height:true}},.3);expect(lockedHeight.equalSides).toBe(false);expect(lockedHeight.height).toBe(10.2);
 const lockedWidth=draggedProfileBounds(start,end,{angle,width:10.1,locks:{width:true}},.3);expect(lockedWidth.equalSides).toBe(true);expect(lockedWidth.width).toBe(10.1);expect(lockedWidth.height).toBe(10.1);closePoint(corner(lockedWidth,1,-1,angle),start);
});

test.describe('tool keyboard and rotated pointer gestures',()=>{
 test.beforeEach(async({page})=>{await page.goto('/');await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});});
 const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))).project);

 for(const tool of ['fillet','chamfer'])test(`Enter applies ${tool} with its numeric value`,async({page})=>{
  await page.locator('[data-view="top"]').click();await page.locator(`[data-tool="${tool}"]`).click();
  const rect=await page.locator('#viewport canvas').boundingBox(),pixelsPerMm=Math.min(rect.width,rect.height)/(Math.hypot(40,30,12)*1.25);
  await page.mouse.click(rect.x+rect.width/2-20*pixelsPerMm,rect.y+rect.height/2);
  await expect(page.locator('.edge-count strong')).toHaveText('1');
  await page.locator('[data-field="edge-size"]').fill('1.25');await page.locator('[data-field="edge-size"]').press('Enter');
  await expect(page.locator('#feature-list [data-feature="0"]')).toContainText(tool==='fillet'?'Rundung':'Fase');
  const feature=(await saved(page)).objects[0].features[0];expect(feature.type).toBe(tool);expect(feature[tool==='fillet'?'radius':'distance']).toBe(1.25);
  await expect(page.locator('#toast')).not.toHaveClass(/error/);
 });

 test('Enter applies the wall thickness in the selected face panel',async({page})=>{
  await page.locator('[data-view="top"]').click();const rect=await page.locator('#viewport canvas').boundingBox();await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
  await page.locator('[data-field="shell-thickness"]').fill('2');await page.locator('[data-field="shell-thickness"]').press('Enter');
  await expect(page.locator('#feature-list [data-feature="0"]')).toContainText('Wandung');expect((await saved(page)).objects[0].features[0]).toMatchObject({type:'shell',thickness:2});
 });

 for(const [kind,direction] of [['rectangle',1],['ellipse',-1]])test(`pointer draws a rotated ${kind} in its local axes and retains entered dimensions`,async({page})=>{
  await page.locator('#plane-sketch').click();await page.locator(`[data-sketch-kind="${kind}"]`).click();await page.locator('[data-sketch="angle"]').fill('90');await page.locator('[data-sketch="snap"]').fill('0');
  const rect=await page.locator('#viewport canvas').boundingBox(),start={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  const draw=async(origin=start)=>{await page.keyboard.down('Alt');await page.mouse.move(origin.x,origin.y);await page.mouse.down();await page.mouse.move(origin.x+direction*80,origin.y-direction*160);await page.mouse.up();await page.keyboard.up('Alt');};
  await draw();const width=Number(await page.locator('[data-sketch="width"]').inputValue()),height=Number(await page.locator('[data-sketch="height"]').inputValue());
  expect(width).toBeCloseTo(height*2,2);
  expect(Number(await page.locator('[data-sketch="center-u"]').inputValue())).toBeCloseTo(direction*height/2,2);expect(Number(await page.locator('[data-sketch="center-v"]').inputValue())).toBeCloseTo(direction*width/2,2);
  await page.locator('[data-sketch="width"]').fill('8');await page.locator('[data-sketch="height"]').fill('6');
  // Start away from the previous contour's floating dimension inputs.
  await draw({x:start.x-170,y:start.y-170});const millimetersPerPixel=Math.hypot(40,30,12)*1.2/Math.min(rect.width,rect.height),anchor=[-170*millimetersPerPixel,170*millimetersPerPixel];
  await expect(page.locator('[data-sketch="width"]')).toHaveValue('8');await expect(page.locator('[data-sketch="height"]')).toHaveValue('6');
  // Pointer coordinates have pixel precision; exact corner math is covered above.
  expect(Math.abs(Number(await page.locator('[data-sketch="center-u"]').inputValue())-anchor[0]-direction*3)).toBeLessThan(.15);expect(Math.abs(Number(await page.locator('[data-sketch="center-v"]').inputValue())-anchor[1]-direction*4)).toBeLessThan(.15);
 });
});
