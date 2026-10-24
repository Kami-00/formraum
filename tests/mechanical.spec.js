import {test,expect} from '@playwright/test';
const call=(page,objects)=>page.evaluate(async objects=>{try{return await(await import('/cad-client.js')).calculate('model',{project:{version:1,objects}});}catch(e){return {error:e.message};}},objects);
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});});
test('mechanical solids and shell',async({page})=>{
 for(const kind of ['gear','thread']){const r=await call(page,[{id:'a',kind}]);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeGreaterThan(0);}
 const body={id:'a',kind:'box',params:{width:40,depth:30,height:12}};let r=await call(page,[body]);const top=r.objects[0].faces.find(f=>f.normal?.[2]>.99);
 body.features=[{type:'shell',face:top.id,reference:top.reference,thickness:2}];r=await call(page,[body]);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(14400-36*26*10,3);
 body.features[0].closed=true;r=await call(page,[body]);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(14400-36*26*8,3);
 body.features[0].thickness=30;expect((await call(page,[body])).error).toBeTruthy();
});
test('hull bridges separated boxes',async({page})=>{
 const r=await call(page,[{id:'h',kind:'boolean',operation:'hull',operands:[0,30].map(x=>({id:String(x),kind:'box',params:{width:10,depth:10,height:10},position:[x,0,0]}))}]);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(4000,3);
});
test('wall thickness is editable, persistent and reversible in the UI',async({page})=>{
 await page.locator('[data-view="top"]').click();const rect=await page.locator('#viewport canvas').boundingBox();await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
 await page.locator('[data-field="shell-thickness"]').fill('2');await page.locator('[data-action="apply-shell"]').click();await expect(page.locator('#toast')).toContainText('ausgehöhlt');
 await page.locator('#feature-list [data-feature="0"]').click();await expect(page.locator('[data-field="feature-size"]')).toHaveValue('2');await page.locator('[data-field="feature-size"]').fill('3');await page.locator('[data-action="apply-feature"]').click();await expect(page.locator('#toast')).toContainText('Bearbeitung geändert');
 await page.locator('#undo').click();await expect(page.locator('#feature-list')).toContainText('2 mm Wand');await page.locator('#redo').click();await expect(page.locator('#feature-list')).toContainText('3 mm Wand');
 await page.reload();await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});await page.locator('#feature-list [data-feature="0"]').click();await expect(page.locator('[data-field="feature-size"]')).toHaveValue('3');
 await page.locator('[data-field="feature-size"]').fill('100');await page.locator('[data-action="apply-feature"]').click();await expect(page.locator('#toast')).toHaveClass(/error/);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))).project);expect(saved.objects[0].features[0].thickness).toBe(3);
});
test('thread cuts an internal thread and survives STEP roundtrip',async({page})=>{
 const body={id:'nut',kind:'boolean',operation:'cut',operands:[{id:'blank',kind:'cylinder',params:{radius:9,height:8}},{id:'thread',kind:'thread',params:{diameter:10,pitch:1.5,height:10},position:[0,0,-1]}]};
 const result=await call(page,[body]);expect(result.error).toBeUndefined();expect(result.objects[0].volume).toBeGreaterThan(Math.PI*(81-25)*8);expect(result.objects[0].volume).toBeLessThan(Math.PI*(81-16)*8);
 const roundtrip=await page.evaluate(async objects=>{const {calculate}=await import('/cad-client.js');const blob=await calculate('export_step',{project:{version:1,objects}});const base64=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(blob);});return calculate('import_step',{base64});},[body]);expect(roundtrip.objects[0].volume).toBeCloseTo(result.objects[0].volume,2);
});
test('suggestions catch centers and edges within the visual tolerance only',async({page})=>{
 const r=await page.evaluate(async()=>{const {suggestPoint,suggestSize}=await import('/sketch-suggestions.js');return {center:suggestPoint([5.2,8.1],{profiles:[{hasDrawn:true,center:[5,8]}],tolerance:.3}),edge:suggestPoint([-9.9,7],{bounds:{min:[-10,-10],max:[10,10]},tolerance:.2}),free:suggestPoint([3,4],{tolerance:.2}),radius:suggestSize(5.2,[5,8],.3)};});
 expect(r.center.point).toEqual([5,8]);expect(r.center.guides).toHaveLength(2);expect(r.edge.point).toEqual([-10,7]);expect(r.free.guides).toHaveLength(0);expect(r.radius).toBe(5);
});

test('mechanical parameter changes keep solid cores and reject invalid inputs',async({page})=>{
 for(const params of [{diameter:8,pitch:1,height:6},{diameter:12,pitch:2,height:13}]){const r=await call(page,[{id:'t',kind:'thread',params}]);expect(r.error,JSON.stringify(params)).toBeUndefined();expect(r.objects[0].volume).toBeGreaterThan(Math.PI*(params.diameter/2-.55*params.pitch)**2*params.height);expect(r.objects[0].bounds.min[2]).toBeCloseTo(0,3);expect(r.objects[0].bounds.max[2]).toBeCloseTo(params.height,3);}
 const large=await call(page,[{id:'g',kind:'gear',params:{teeth:60}}]);expect(large.error).toBeUndefined();
 for(const [kind,params] of [['gear',{teeth:17}],['gear',{bore:100}],['thread',{pitch:0}],['thread',{height:100}]])expect((await call(page,[{id:'bad',kind,params}])).error).toBeTruthy();
});
