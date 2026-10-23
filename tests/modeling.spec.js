import {test,expect} from '@playwright/test';
import {SHAPES} from '../web/shapes.js';
const call=(page,project)=>page.evaluate(async project=>{try{return await(await import('/cad-client.js')).calculate('model',{project});}catch(e){return {error:e.message};}},project);
const box=(id='b',x=0)=>({id,kind:'box',name:id,params:{width:20,depth:20,height:20},position:[x,0,0],features:[]});
const project=objects=>({version:1,name:'Modelliertest',objects});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))).project);
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});});

test('ten solid primitives have analytical volumes and reject invalid geometry',async({page})=>{
 const objects=Object.entries(SHAPES).map(([kind,s])=>({id:kind,kind,params:s.params}));
 const result=await call(page,project(objects));expect(result.error).toBeUndefined();
 const expected=[11250,Math.PI*144*25,4/3*Math.PI*12**3,Math.PI*144*25/3,Math.PI*(144-64)*25,2*Math.PI**2*15*16,7500,25*25*25/3,3*Math.sqrt(3)/2*14**2*20,Math.PI*64*14+4/3*Math.PI*8**3];
 result.objects.forEach((m,i)=>{expect(m.valid).toBe(true);expect(m.volume).toBeCloseTo(expected[i],3);expect(m.bounds.min[2]).toBeCloseTo(0,5);});
 for(const [kind,params] of [['sphere',{radius:-1}],['tube',{innerRadius:20}],['torus',{tubeRadius:20}],['capsule',{height:5}],['prism',{sides:3.5}]])expect((await call(page,project([{id:'bad',kind,params}]))).error).toBeTruthy();
});

test('transformed references accept new features in local coordinates',async({page})=>{
 const body={...box(),rotation:[90,0,0],scale:2,position:[5,6,7]};let r=await call(page,project([body]));expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(64000,4);
 const face=r.objects[0].faces.find(f=>f.normal?.[1]<-.99);expect(face.origin[1]).toBeCloseTo(-34,4);
 body.features.push({type:'extrude',face:face.id,reference:face.reference,sketch:{kind:'ellipse',width:8,height:6,angle:20,center:[0,0]},depth:3});
 r=await call(page,project([body]));expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(64000+Math.PI*4*3*3*8,3);
 body.rotation=[10,20,30];r=await call(page,project([body]));expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(64000+Math.PI*4*3*3*8,3);
});

test('boolean operations and hole export preserve solid volumes',async({page})=>{
 for(const [operation,volume] of [['union',12000],['cut',4000],['intersect',4000]]){
 const r=await call(page,project([{id:'result',kind:'boolean',operation,operands:[box(),box('other',10)]}]));expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(volume,4);
 }
 expect((await call(page,project([{id:'result',kind:'boolean',operation:'union',operands:[box(),box('other',50)]}]))).error).toBeTruthy();
 const exported=await page.evaluate(async p=>{const {calculate}=await import('/cad-client.js');const blob=await calculate('export_step',{project:p});const base64=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});return calculate('import_step',{base64});},project([box(),{...box('hole',50),hole:true}]));
 expect(exported.objects).toHaveLength(1);expect(exported.objects[0].volume).toBeCloseTo(8000,3);
});

test('direct sketch dimensions validate, lock while drawing, and create editable profiles',async({page})=>{
 await page.locator('#plane-sketch').click();await page.locator('[data-sketch="width"]').fill('24');await page.locator('[data-sketch="height"]').fill('16');
 const width=page.getByRole('spinbutton',{name:'Skizzenmaß width',exact:true});await expect(width).toBeVisible();await width.fill('-1');await expect(page.locator('[data-action="extrude"]')).toBeDisabled();await width.fill('28');
 await expect(page.locator('[data-sketch="width"]')).toHaveValue('28');await expect(page.locator('[data-lock="width"]')).toBeChecked();
 const rect=await page.locator('#viewport canvas').boundingBox();await page.mouse.move(rect.x+rect.width*.3,rect.y+rect.height*.3);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.45,rect.y+rect.height*.45);await page.mouse.up();
 await expect(width).toHaveValue('28');await expect(page.locator('[data-sketch="height"]')).toHaveValue('16');await page.locator('[data-sketch="depth"]').fill('5');await page.locator('[data-action="extrude"]').click();await expect(page.locator('#body-count')).toHaveText('2');
 const p=await saved(page);expect(p.objects[1].profile.width).toBe(28);expect(p.objects[1].profile.height).toBe(16);
 await expect(page.locator('[data-field="profile-width"]')).toHaveValue('28');await page.locator('[data-field="profile-width"]').fill('32');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');expect((await saved(page)).objects[1].profile.width).toBe(32);
});

test('circle diameter and polygon dimensions build from an empty project',async({page})=>{
 await page.locator('#project-file').setInputFiles({name:'empty.formraum.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project([])))});await expect(page.locator('#body-count')).toHaveText('0');
 await page.locator('#plane-sketch').click();await page.locator('[data-sketch-kind="circle"]').click();await page.locator('[data-sketch="diameter"]').fill('20');await expect(page.getByRole('spinbutton',{name:'Skizzenmaß diameter',exact:true})).toHaveValue('20');await page.locator('[data-action="extrude"]').click();await expect(page.locator('#body-count')).toHaveText('1');expect((await saved(page)).objects[0].profile.radius).toBe(10);
 await page.locator('#plane-sketch').click();await page.locator('[data-sketch-kind="polygon"]').click();await page.locator('[data-sketch="sides"]').fill('5');await page.locator('[data-sketch="radius"]').fill('8');await page.locator('[data-sketch="angle"]').fill('25');await page.locator('[data-action="extrude"]').click();await expect(page.locator('#body-count')).toHaveText('2');expect((await saved(page)).objects[1].profile).toMatchObject({sides:5,radius:8,angle:25});
});

test('duplicate, multiselect, align, group and restore operands',async({page})=>{
 await page.locator('[data-action="duplicate-body"]').click();await expect(page.locator('#body-count')).toHaveText('2');
 await page.locator('[data-multi-body]').first().check();await expect(page.locator('[data-combine="union"]')).toBeVisible();await page.locator('[data-align="z:min"]').click();await expect(page.locator('#toast')).toContainText('ausgerichtet');
 await page.locator('[data-combine="union"]').click();await expect(page.locator('#body-count')).toHaveText('1');expect((await saved(page)).objects[0].kind).toBe('boolean');
 await page.locator('[data-field="rotation-z"]').fill('90');await page.locator('[data-field="scale"]').fill('2');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');await page.locator('[data-action="ungroup"]').click();await expect(page.locator('#body-count')).toHaveText('2');const p=await saved(page);expect(p.objects[0].scale).toBe(2);expect(p.objects[0].rotation[2]).toBeCloseTo(90,4);expect(p.objects.map(o=>o.position[1]).sort((a,b)=>a-b)).toEqual([0,10]);
});

test('scaled body sketch uses world millimeters and feature history remains editable',async({page})=>{
 await page.locator('[data-field="scale"]').fill('2');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');
 await page.locator('[data-view="top"]').click();const rect=await page.locator('#viewport canvas').boundingBox();await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);await page.locator('[data-tool="sketch"]').click();await page.locator('[data-sketch-kind="polygon"]').click();await page.locator('[data-sketch="radius"]').fill('8');await page.locator('[data-sketch="sides"]').fill('5');await page.locator('[data-sketch="depth"]').fill('6');await page.locator('[data-action="extrude"]').click();await expect(page.locator('#feature-list [data-feature="0"]')).toBeVisible();
 let p=await saved(page);expect(p.objects[0].features[0]).toMatchObject({depth:3,sketch:{radius:4,sides:5}});
 await page.locator('#feature-list [data-feature="0"]').click();await expect(page.locator('[data-field="feature-radius"]')).toHaveValue('8');await expect(page.locator('[data-field="feature-depth"]')).toHaveValue('6');await page.locator('[data-field="feature-depth"]').fill('10');await page.locator('[data-field="feature-angle"]').fill('15');await page.locator('[data-action="apply-feature"]').click();await expect(page.locator('#toast')).toContainText('Bearbeitung geändert');p=await saved(page);expect(p.objects[0].features[0]).toMatchObject({depth:5,sketch:{angle:15}});
});

test('hole grouping cuts, rejects a nonoverlapping cut and preserves saved history',async({page})=>{
 await page.locator('#add-cylinder').click();await expect(page.locator('#body-count')).toHaveText('2');await page.locator('[data-field="radius"]').fill('5');await page.locator('[data-field="position-x"]').fill('0');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');await page.locator('[data-body-role="hole"]').click();await expect(page.locator('[data-body-role="hole"]')).toHaveClass('active');await page.locator('[data-multi-body]').first().check();await page.locator('[data-combine="auto"]').click();await expect(page.locator('#body-count')).toHaveText('1');const p=await saved(page);expect(p.objects[0].operation).toBe('cut');const r=await call(page,p);expect(r.objects[0].volume).toBeCloseTo(14400-Math.PI*25*12,3);
 await page.locator('.operand-editor').last().locator('summary').click();await page.locator('[data-field="operand-1-x"]').fill('200');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('überlappen');expect(await saved(page)).toEqual(p);
});
