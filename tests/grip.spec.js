import {test,expect} from '@playwright/test';
const ready=async page=>{await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});await expect(page.locator('body')).not.toHaveClass(/busy/,{timeout:60000});};
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))).project);
const project=(params={})=>({version:1,name:'Griffknopf',objects:[{id:'knob',name:'Griffknopf',kind:'cylinder',params:{radius:12,height:15},position:[0,0,0],features:[{type:'grip',params:{count:16,radius:1.2,depth:1.2,...params}}]}]});
const model=(page,project)=>page.evaluate(async project=>{try{return await(await import('/cad-client.js')).calculate('model',{project});}catch(e){return {error:e.message};}},project);
const lens=(R,r,d)=>r*r*Math.acos((d*d+r*r-R*R)/(2*d*r))+R*R*Math.acos((d*d+R*R-r*r)/(2*d*R))-.5*Math.sqrt((-d+r+R)*(d+r-R)*(d-r+R)*(d+r+R));
test.beforeEach(async({page})=>{await page.goto('/');await ready(page);});

test('round grip cuts have exact cylindrical volume, transform with the body and export to STEP',async({page})=>{
 const p=project(),expected=(Math.PI*144-16*lens(12,1.2,12))*15;
 const base=await model(page,p);expect(base.error).toBeUndefined();expect(base.objects[0].valid).toBe(true);expect(base.objects[0].volume).toBeCloseTo(expected,4);
 p.objects[0].rotation=[90,0,20];p.objects[0].position=[30,-10,5];p.objects[0].scale=2;
 const changed=await model(page,p);expect(changed.error).toBeUndefined();expect(changed.objects[0].volume).toBeCloseTo(expected*8,3);
 const exported=await page.evaluate(async project=>{const {calculate}=await import('/cad-client.js');return (await calculate('export_step',{project})).size;},p);expect(exported).toBeGreaterThan(10000);
 const shallow=await model(page,project({depth:.5,angle:15}));expect(shallow.error).toBeUndefined();expect(shallow.objects[0].volume).toBeCloseTo((Math.PI*144-16*lens(12,1.2,12.7))*15,4);
});

test('invalid or disconnected grip cuts fail and suppression restores the cylinder',async({page})=>{
 for(const params of [{count:3.5},{count:65},{count:64,radius:3,depth:3},{depth:2},{depth:0},{outerRadius:100}])expect((await model(page,project(params))).error).toBeTruthy();
 const p=project();p.objects[0].features[0].suppressed=true;
 expect((await model(page,p)).objects[0].volume).toBeCloseTo(Math.PI*144*15,5);
 const tube=project({radius:2,depth:2});tube.objects[0].kind='tube';tube.objects[0].params.innerRadius=11;expect((await model(page,tube)).error).toBeTruthy();
});

test('legacy whole-body grip features still open and remain editable',async({page})=>{
 await page.locator('#project-file').setInputFiles({name:'Legacy.formraum',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project()))});await ready(page);
 await page.locator('#feature-list [data-feature="0"]').click();await expect(page.locator('[data-field="grip-count"]')).toHaveValue('16');
 await page.locator('[data-field="grip-count"]').fill('12');await page.locator('[data-action="apply-feature"]').click();await ready(page);expect((await saved(page)).objects[0].features[0].params.count).toBe(12);
 await page.locator('#undo').click();await ready(page);expect((await saved(page)).objects[0].features[0].params.count).toBe(16);
});
