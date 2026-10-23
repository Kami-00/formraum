import {test,expect} from '@playwright/test';
const model=(page,project)=>page.evaluate(async project=>{try{return await(await import('/cad-client.js')).calculate('model',{project});}catch(e){return {error:e.message};}},project);
const base=()=>({version:1,name:'Maße',objects:[{id:'base',kind:'box',params:{width:40,depth:30,height:12},position:[0,0,0],features:[]}]});
const top=r=>r.objects[0].faces.find(f=>f.normal?.[2]>.99);
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))).project);
const start=async page=>{await page.locator('[data-view="top"]').click();const r=await page.locator('#viewport canvas').boundingBox();await page.mouse.click(r.x+r.width/2,r.y+r.height/2);await page.locator('[data-tool="sketch"]').click();};
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});});

test('edge distances are recomputed when profile and support dimensions change',async({page})=>{
 let p=base(),r=await model(page,p),face=top(r);expect(face.sketchBounds.min).toEqual([-20,-15]);
 p.objects[0].features=[{type:'extrude',face:face.id,reference:face.reference,depth:5,sketch:{kind:'rectangle',width:10,height:10,center:[0,0],constraints:{u:{mode:'min',distance:5},v:{mode:'min',distance:5}}}}];
 r=await model(page,p);expect(r.error).toBeUndefined();expect(r.project.objects[0].features[0].sketch.center).toEqual([-10,-5]);
 p=r.project;p.objects[0].features[0].sketch.width=14;p.objects[0].params.width=50;r=await model(page,p);expect(r.error).toBeUndefined();expect(r.project.objects[0].features[0].sketch.center).toEqual([-13,-5]);
 p=r.project;p.objects[0].rotation=[20,35,40];p.objects[0].scale=2;r=await model(page,p);expect(r.error).toBeUndefined();expect(r.project.objects[0].features[0].sketch.center).toEqual([-13,-5]);
});

test('rotated outlines, center references and unsupported curved boundaries',async({page})=>{
 const p=base(),face=top(await model(page,p));p.objects[0].features=[{type:'pocket',face:face.id,reference:face.reference,depth:2,sketch:{kind:'rectangle',width:8,height:6,angle:30,center:[0,0],constraints:{u:{mode:'min',distance:3},v:{mode:'center'}}}}];
 let r=await model(page,p);expect(r.error).toBeUndefined();expect(r.project.objects[0].features[0].sketch.center[0]).toBeCloseTo(-20+3+4*Math.cos(Math.PI/6)+3*Math.sin(Math.PI/6),6);
 p.objects[0].features[0].sketch={kind:'circle',radius:3,distanceReference:'center',constraints:{u:{mode:'min',distance:8},v:{mode:'max',distance:7}}};r=await model(page,p);expect(r.error).toBeUndefined();expect(r.project.objects[0].features[0].sketch.center).toEqual([-12,8]);
 const cylinder={version:1,objects:[{id:'c',kind:'cylinder',params:{radius:15,height:10},features:[]}]};r=await model(page,cylinder);const f=top(r);expect(f.sketchBounds).toBeNull();cylinder.objects[0].features=[{type:'pocket',face:f.id,sketch:{kind:'circle',radius:2,constraints:{u:{mode:'min',distance:3}}},depth:2}];expect((await model(page,cylinder)).error).toContain('rechteckige');
});

test('multiple holes and nested cutouts have exact volumes and reject invalid roles',async({page})=>{
 const p=base(),face=top(await model(page,p));p.objects[0].features=[{type:'pocket',face:face.id,reference:face.reference,depth:12,sketch:{kind:'circle',radius:3,center:[-10,0]},contours:[{kind:'circle',radius:3,center:[10,0]}]}];
 let r=await model(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(14400-2*Math.PI*9*12,4);
 const plate={version:1,objects:[{id:'plate',kind:'profile',params:{height:5},profile:{kind:'rectangle',width:30,height:20,center:[4,5]},contours:[{kind:'circle',radius:3,center:[4,5],role:'hole'}]}]};r=await model(page,plate);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo((600-Math.PI*9)*5,4);expect(r.objects[0].bounds.min[0]).toBeCloseTo(-11,5);
 plate.objects[0].contours[0].center=[100,0];expect((await model(page,plate)).error).toContain('überlappen');
 p.objects[0].features[0].sketch.role='hole';p.objects[0].features[0].contours[0].role='hole';expect((await model(page,p)).error).toContain('normale Kontur');
});

test('UI anchors, direct distance dimensions and feature edits persist',async({page})=>{
 await start(page);await page.locator('[data-sketch="width"]').fill('10');await page.locator('[data-sketch="height"]').fill('10');await page.getByRole('combobox',{name:'Horizontaler Bezug',exact:true}).selectOption('min');await page.locator('[data-sketch="distance-u"]').fill('5');await page.getByRole('combobox',{name:'Vertikaler Bezug',exact:true}).selectOption('min');await page.locator('[data-sketch="distance-v"]').fill('5');
 await expect(page.locator('[data-sketch="center-u"]')).toHaveValue('-10');await expect(page.locator('[data-sketch="center-u"]')).toBeDisabled();await page.locator('[data-sketch="width"]').fill('14');await expect(page.locator('[data-sketch="center-u"]')).toHaveValue('-8');
 await page.getByRole('spinbutton',{name:'Skizzenmaß distance-u',exact:true}).fill('6');await expect(page.locator('[data-sketch="center-u"]')).toHaveValue('-7');await page.locator('[data-sketch="distance-v"]').fill('-1');await expect(page.locator('[data-action="extrude"]')).toBeDisabled();await page.locator('[data-sketch="distance-v"]').fill('5');await page.locator('[data-action="extrude"]').click();await expect(page.locator('#feature-list [data-feature="0"]')).toBeVisible();
 await page.locator('#feature-list [data-feature="0"]').click();await expect(page.locator('[data-field="feature-distance-u"]')).toHaveValue('6');await page.locator('[data-field="feature-width"]').fill('12');await page.locator('[data-action="apply-feature"]').click();await expect(page.locator('#toast')).toContainText('Bearbeitung geändert');expect((await saved(page)).objects[0].features[0].sketch.center).toEqual([-8,-5]);
 await page.reload();await expect(page.locator('#status')).toContainText('Geometrie bereit');expect((await saved(page)).objects[0].features[0].sketch.constraints.u.distance).toBe(6);
});

test('UI draws two dimensioned holes in one operation and edits second contour',async({page})=>{
 await start(page);await page.locator('[data-sketch-kind="circle"]').click();await page.locator('[data-sketch="diameter"]').fill('6');await page.getByRole('combobox',{name:'Abstand bis',exact:true}).selectOption('center');await page.getByRole('combobox',{name:'Horizontaler Bezug',exact:true}).selectOption('min');await page.locator('[data-sketch="distance-u"]').fill('10');
 await page.locator('[data-action="duplicate-contour"]').click();await expect(page.locator('[data-contour]')).toHaveCount(2);await page.getByRole('combobox',{name:'Horizontaler Bezug',exact:true}).selectOption('max');await page.locator('[data-sketch="distance-u"]').fill('10');await page.locator('[data-sketch="depth"]').fill('12');await page.locator('[data-action="pocket"]').click();await expect(page.locator('#feature-list [data-feature="0"]')).toBeVisible();
 let p=await saved(page);expect(p.objects[0].features[0].contours).toHaveLength(1);expect(p.objects[0].features[0].contours[0].center).toEqual([10,0]);expect((await model(page,p)).objects[0].volume).toBeCloseTo(14400-2*Math.PI*9*12,4);
 await page.locator('#feature-list [data-feature="0"]').click();await page.getByRole('combobox',{name:'Kontur bearbeiten',exact:true}).selectOption('1');await page.locator('[data-field="feature-radius"]').fill('4');await page.locator('[data-action="apply-feature"]').click();await expect(page.locator('#toast')).toContainText('Bearbeitung geändert');p=await saved(page);expect(p.objects[0].features[0].sketch.radius).toBe(3);expect(p.objects[0].features[0].contours[0].radius).toBe(4);expect(p.objects[0].features[0].contours[0].center[0]).toBe(10);
});

test('UI creates a plate with an inner cutout and retains its editable contours',async({page})=>{
 await page.locator('#plane-sketch').click();await page.locator('[data-sketch="width"]').fill('30');await page.locator('[data-sketch="height"]').fill('20');await page.locator('[data-action="add-contour"]').click();await page.locator('[data-sketch="radius"]').fill('3');await page.locator('[data-contour-role="hole"]').click();await page.locator('[data-sketch="depth"]').fill('5');await page.locator('[data-action="extrude"]').click();await expect(page.locator('#body-count')).toHaveText('2');
 await page.getByRole('combobox',{name:'Kontur bearbeiten',exact:true}).selectOption('1');await expect(page.locator('[data-field="profile-radius"]')).toHaveValue('3');await page.locator('[data-field="profile-radius"]').fill('4');await page.locator('[data-action="apply-dimensions"]').click();await expect(page.locator('#toast')).toContainText('Maße übernommen');const p=await saved(page);expect(p.objects[1].contours[0].radius).toBe(4);expect((await model(page,p)).objects[1].volume).toBeCloseTo((600-Math.PI*16)*5,4);
});

test('through-all holes follow changes in body thickness and UI stores the option',async({page})=>{
 await start(page);await page.locator('[data-sketch-kind="circle"]').click();await page.locator('[data-sketch="radius"]').fill('3');await page.locator('[data-sketch="depth"]').fill('1');await page.locator('[data-through-all]').check();await page.locator('[data-action="pocket"]').click();await expect(page.locator('#feature-list [data-feature="0"]')).toBeVisible();
 let p=await saved(page);expect(p.objects[0].features[0].throughAll).toBe(true);expect((await model(page,p)).objects[0].volume).toBeCloseTo(14400-Math.PI*9*12,4);
 p.objects[0].params.height=30;const r=await model(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(36000-Math.PI*9*30,4);
 await page.locator('#feature-list [data-feature="0"]').click();await expect(page.locator('[data-feature-through-all]')).toBeChecked();
});

test('centering, releasing and removing contours keep sketch state consistent',async({page})=>{
 await start(page);await page.locator('[data-sketch="width"]').fill('10');await page.locator('[data-sketch="center-u"]').fill('5');await page.locator('[data-action="center-sketch"]').click();await expect(page.locator('[data-sketch="center-u"]')).toHaveValue('0');await expect(page.locator('[data-sketch="center-u"]')).toBeDisabled();await page.locator('[data-action="release-position"]').click();await expect(page.locator('[data-sketch="center-u"]')).toBeEnabled();
 await page.locator('[data-action="add-contour"]').click();await page.locator('[data-sketch="radius"]').fill('-1');await page.locator('[data-contour="0"]').click();await expect(page.locator('[data-action="extrude"]')).toBeDisabled();await page.locator('[data-contour="1"]').click();await page.locator('[data-action="remove-contour"]').click();await expect(page.locator('[data-contour]')).toHaveCount(1);await expect(page.locator('[data-action="extrude"]')).toBeEnabled();
});
