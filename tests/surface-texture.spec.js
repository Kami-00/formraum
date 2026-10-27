import {test,expect} from '@playwright/test';
const ready=async page=>{await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});await expect(page.locator('body')).not.toHaveClass(/busy/,{timeout:120000});};
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))).project);
const model=(page,project,op='model')=>page.evaluate(async({project,op})=>{try{const r=await(await import('/cad-client.js')).calculate(op,{project});return r instanceof Blob?{size:r.size}:r;}catch(e){return {error:e.message};}},{project,op});
const box=()=>({version:1,objects:[{id:'box',kind:'box',params:{width:20,depth:16,height:12},features:[]}]});
const texture=(faces,params={})=>({type:'surfaceTexture',targets:faces.map(f=>({face:f.id,reference:f.reference})),params:{mode:'grooves',count:4,radius:.5,depth:.4,angle:0,...params}});
const faceClick=async(page,view,ctrl=false)=>{await page.locator(`[data-view="${view}"]`).click();await page.waitForTimeout(250);const r=await page.locator('#viewport').boundingBox();if(ctrl)await page.keyboard.down('Control');await page.mouse.click(r.x+r.width/2,r.y+r.height/2);if(ctrl)await page.keyboard.up('Control');};
test.beforeEach(async({page})=>{await page.goto('/');await ready(page);await page.locator('#dismiss-welcome').click();});

test('plane texture is bounded to the chosen face and supports several face references',async({page})=>{
 const p=box(),base=await model(page,p),faces=base.objects[0].faces,top=faces.find(f=>f.normal?.[2]>.99),side=faces.find(f=>f.normal?.[0]>.99);
 p.objects[0].features=[texture([top])];const one=await model(page,p);expect(one.error).toBeUndefined();expect(one.objects[0].volume).toBeLessThan(3840);expect(one.objects[0].volume).toBeGreaterThan(3840-20*16*.4);
 expect(one.objects[0].faces.find(f=>f.normal?.[2]<-.99).area).toBeCloseTo(320,5);
 p.objects[0].features=[texture([top,side])];const two=await model(page,p);expect(two.error).toBeUndefined();expect(two.objects[0].volume).toBeLessThan(one.objects[0].volume);
 p.objects[0].features[0].targets.push(p.objects[0].features[0].targets[0]);expect((await model(page,p)).error).toContain('doppelt');
});

test('only the selected cylindrical band of a stepped part is textured, including transforms and STEP',async({page})=>{
 const p={version:1,objects:[{id:'step',kind:'boolean',operation:'union',operands:[{id:'base',kind:'cylinder',params:{radius:14,height:6},features:[]},{id:'boss',kind:'cylinder',params:{radius:10,height:8},position:[0,0,6],features:[]}],features:[]}]};
 const base=await model(page,p),curves=base.objects[0].faces.filter(f=>!f.planar).sort((a,b)=>a.area-b.area);p.objects[0].features=[texture([curves[0]],{count:8})];p.objects[0].rotation=[70,20,30];p.objects[0].position=[10,20,30];
 const r=await model(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].faces.some(f=>!f.planar&&Math.abs(f.area-curves[1].area)<1e-4)).toBe(true);
 expect(r.objects[0].volume).toBeLessThan(base.objects[0].volume);expect((await model(page,p,'export_step')).size).toBeGreaterThan(10000);
});

test('cross knurl creates real grooves on planar, cylindrical and conical faces',async({page})=>{
 test.setTimeout(180000);
 for(const kind of ['box','cylinder','cone']){
  const p=box();Object.assign(p.objects[0],{kind,params:{width:20,depth:16,height:12,radius:10,topRadius:7}});const base=await model(page,p),face=kind==='box'?base.objects[0].faces.find(f=>f.normal?.[2]>.99):base.objects[0].faces.find(f=>!f.planar);
  p.objects[0].features=[texture([face],{mode:'knurl',count:6,angle:45})];const r=await model(page,p);expect(r.error,kind).toBeUndefined();expect(r.objects[0].volume).toBeLessThan(base.objects[0].volume);expect(r.objects[0].valid).toBe(true);
 }
});

test('Ctrl click adds and toggles faces; texture only uses the selected faces and persists through undo',async({page},info)=>{
 await page.locator('#open-grip').click();await expect(page.locator('[data-action="apply-texture"]')).toHaveCount(0);await faceClick(page,'top');await expect(page.locator('.edge-count strong')).toHaveText('1');await faceClick(page,'front',true);await expect(page.locator('.edge-count strong')).toHaveText('2');await faceClick(page,'front',true);await expect(page.locator('.edge-count strong')).toHaveText('1');await faceClick(page,'front',true);await expect(page.locator('.edge-count strong')).toHaveText('2');
 await page.locator('[data-field="texture-count"]').fill('4');await page.locator('[data-field="texture-radius"]').fill('.6');await page.locator('[data-action="apply-texture"]').click();await ready(page);
 let p=await saved(page);expect(p.objects[0].features[0].targets).toHaveLength(2);await page.locator('#feature-list [data-feature="0"]').click();await expect(page.locator('[data-field="texture-count"]')).toHaveValue('4');await page.locator('[data-field="texture-count"]').fill('5');await page.locator('[data-action="apply-feature"]').click();await ready(page);expect((await saved(page)).objects[0].features[0].params.count).toBe(5);await page.locator('#undo').click();await ready(page);expect((await saved(page)).objects[0].features[0].params.count).toBe(4);
 await page.locator('[data-view="iso"]').click();await page.screenshot({path:info.outputPath('selected-face-grooves.png')});await page.reload();await ready(page);expect((await saved(page)).objects[0].features[0].targets).toHaveLength(2);
});

test('knurl button uses the selected surface and failed dimensions do not change the model',async({page},info)=>{
 await faceClick(page,'top');await page.locator('#open-knurl').click();await page.locator('[data-field="texture-count"]').fill('6');await page.locator('[data-action="apply-texture"]').click();await ready(page);const p=await saved(page);expect(p.objects[0].features[0].params.mode).toBe('knurl');expect(p.objects[0].features[0].targets).toHaveLength(1);
 await page.locator('#feature-list [data-feature="0"]').click();await page.locator('[data-field="texture-count"]').fill('48');await page.locator('[data-field="texture-radius"]').fill('10');await page.locator('[data-action="apply-feature"]').click();await expect(page.locator('#toast')).toContainText('zu dicht');expect(await saved(page)).toEqual(p);
 await page.locator('[data-action="show-body"]').click();await page.locator('[data-view="iso"]').click();await page.screenshot({path:info.outputPath('cross-knurl.png')});
});

test('Ctrl selects faces across two bodies and applies both atomically',async({page})=>{
 const p=box();p.objects[0].position=[-25,0,0];p.objects.push({...structuredClone(p.objects[0]),id:'second',position:[25,0,0]});await page.locator('#project-file').setInputFiles({name:'Two.formraum',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await ready(page);
 await page.locator('[data-view="top"]').click();await page.waitForTimeout(250);const r=await page.locator('#viewport').boundingBox(),offset=r.height*25/(Math.sqrt(70*70+16*16+12*12)/2*2.5);
 await page.mouse.click(r.x+r.width/2-offset,r.y+r.height/2);await page.keyboard.down('Control');await page.mouse.click(r.x+r.width/2+offset,r.y+r.height/2);await page.keyboard.up('Control');await expect(page.locator('#selection-status')).toContainText('2 Flächen');
 await page.locator('#open-grip').click();await expect(page.locator('.edge-count strong')).toHaveText('2');await page.locator('[data-field="texture-count"]').fill('2');await page.locator('[data-field="texture-radius"]').fill('.3');await page.locator('[data-action="apply-texture"]').click();await ready(page);expect((await saved(page)).objects.map(o=>o.features[0].targets.length)).toEqual([1,1]);
 await page.locator('#undo').click();await ready(page);expect((await saved(page)).objects.map(o=>o.features.length)).toEqual([0,0]);
});

test('a trimmed annular face keeps its hole and opposite face intact',async({page})=>{
 const p={version:1,objects:[{id:'ring',kind:'tube',params:{radius:10,innerRadius:6,height:8},features:[]}]},base=await model(page,p),face=base.objects[0].faces.find(f=>f.normal?.[2]>.99);p.objects[0].features=[texture([face],{radius:.4,depth:.3})];const r=await model(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].faces.find(f=>f.normal?.[2]<-.99).area).toBeCloseTo(Math.PI*64,4);expect(r.objects[0].valid).toBe(true);
});
