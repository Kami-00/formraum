import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const box=()=>({version:1,name:'Test',objects:[{id:'box',name:'Quader',kind:'box',params:{width:40,depth:30,height:12},position:[0,0,0],features:[]}]});
const call=(page,operation,payload)=>page.evaluate(async({operation,payload})=>{
  try{return await (await import('/cad-client.js')).calculate(operation,payload);}
  catch(error){return {error:error.message};}
},{operation,payload});
const model=(page,project)=>call(page,'model',{project});
const top=m=>m.faces.find(f=>f.planar&&f.normal[2]>.99);
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});});

test('primitives, mesh picking metadata and translation',async({page})=>{
  const p=box();p.objects.push({id:'c',kind:'cylinder',params:{radius:5,height:20},position:[50,0,3]});
  const r=await model(page,p);expect(r.error).toBeUndefined();
  expect(r.objects[0].volume).toBeCloseTo(14400,5);expect(r.objects[1].volume).toBeCloseTo(500*Math.PI,5);
  expect(r.objects[0].faces).toHaveLength(6);expect(r.objects[0].edges).toHaveLength(12);
  expect(r.objects[0].mesh.faceIds).toHaveLength(r.objects[0].mesh.triangles.length);
  for(const m of r.objects){for(const e of m.edges)expect(e.points.length).toBeGreaterThan(1);for(const id of m.mesh.faceIds)expect(m.faces.some(f=>f.id===id)).toBe(true);}
  expect(r.objects[1].bounds.min[0]).toBeCloseTo(45,5);
});

test('extrude, pocket, changed reference rejection and atomic rollback',async({page})=>{
  let r=await model(page,box());let p=r.project;let face=top(r.objects[0]);
  p.objects[0].features.push({type:'extrude',face:face.id,reference:face.reference,sketch:{kind:'rectangle',width:10,height:10,center:[0,0]},depth:8});
  r=await model(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(15200,4);
  p=r.project;face=top({...r.objects[0],faces:r.objects[0].faces.filter(f=>f.origin?.[2]>19)});
  p.objects[0].features.push({type:'pocket',face:face.id,reference:face.reference,sketch:{kind:'circle',radius:3,center:[0,0]},depth:6});
  r=await model(page,p);expect(r.error).toBeUndefined();expect(r.objects[0].volume).toBeCloseTo(15200-Math.PI*9*6,4);
  const stable=structuredClone(r.project),bad=structuredClone(stable);bad.objects[0].features[1].reference.center=[99,99,99];
  expect((await model(page,bad)).error).toContain('Bezugsfläche');
  expect((await model(page,stable)).objects[0].volume).toBeCloseTo(r.objects[0].volume,6);
  bad.objects[0].features=[{type:'extrude',face:6,sketch:{kind:'rectangle',width:5,height:5,center:[500,500]},depth:5}];
  expect((await model(page,bad)).error).toBeTruthy();
});

test('fillet, chamfer, legacy project and STEP/STL round trip',async({page})=>{
  const example=JSON.parse(await readFile('examples/Beispielbauteil.formraum.json','utf8'));
  const r=await model(page,example);expect(r.error).toBeUndefined();expect(r.objects[0].valid).toBe(true);
  for(const type of ['fillet','chamfer']){
    const p=box();p.objects[0].features=[{type,edges:[1],radius:1,distance:1}];
    const result=await model(page,p);expect(result.error).toBeUndefined();expect(result.objects[0].volume).toBeLessThan(14400);
  }
  const roundtrip=await page.evaluate(async project=>{
    const {calculate}=await import('/cad-client.js');
    const step=await calculate('export_step',{project});
    const bytes=new Uint8Array(await step.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const imported=await calculate('import_step',{base64:btoa(text),filename:'Test.step'});
    const stl=await calculate('export_stl',{project});const buffer=await stl.arrayBuffer();const view=new DataView(buffer);
    return {volume:imported.objects[0].volume,step:text.slice(0,20),stlSize:buffer.byteLength,triangles:view.getUint32(80,true)};
  },r.project);
  expect(roundtrip.volume).toBeCloseTo(r.objects[0].volume,3);expect(roundtrip.step).toContain('ISO-10303-21');
  expect(roundtrip.triangles).toBeGreaterThan(12);expect(roundtrip.stlSize).toBe(84+50*roundtrip.triangles);
});

test('invalid inputs and empty exports are rejected',async({page})=>{
  for(const input of [{version:2,objects:[]},{version:1,objects:[...box().objects,...box().objects]}, {version:1,objects:[{id:'bad',kind:'box',params:{width:-1}}]}])expect((await model(page,input)).error).toBeTruthy();
  expect((await call(page,'import_step',{base64:btoa('not step')})).error).toBeTruthy();
  expect((await call(page,'export_step',{project:{version:1,objects:[]}})).error).toContain('keine Körper');
});

test('UI saves, opens, undoes and restores without backend requests',async({page})=>{
  const requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.getByRole('button',{name:'Zylinder',exact:true}).click();await expect(page.locator('#body-count')).toHaveText('2');
  await page.getByRole('button',{name:'Rückgängig',exact:true}).click();await expect(page.locator('#body-count')).toHaveText('1');
  await page.getByRole('button',{name:'Wiederholen',exact:true}).click();await expect(page.locator('#body-count')).toHaveText('2');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Speichern',exact:true}).click();expect((await download).suggestedFilename()).toMatch(/\.formraum.json$/);
  await page.reload();await expect(page.locator('#body-count')).toHaveText('2');await expect(page.locator('#status')).toContainText('Geometrie bereit');
  await page.locator('#project-file').setInputFiles('examples/Beispielbauteil.formraum.json');await expect(page.locator('#project-name')).toHaveValue('Beispielbauteil');
  await expect(page.locator('#feature-list [data-feature]:not([data-feature="-1"])')).toHaveCount(4);
  expect(requests.some(r=>r.method==='POST'||r.url.includes('/api/'))).toBe(false);
});

test('select a face in the viewport, sketch, extrude and preserve the model on invalid dimensions',async({page})=>{
  await page.locator('[data-view="top"]').click();
  const rect=await page.locator('#viewport canvas').boundingBox();
  await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
  await expect(page.locator('#selection-status')).toContainText('Fläche');
  await page.locator('[data-tool="sketch"]').click();
  await page.locator('[data-sketch="width"]').fill('10');await page.locator('[data-sketch="height"]').fill('10');await page.locator('[data-sketch="depth"]').fill('8');
  await page.locator('[data-action="extrude"]').click();await expect(page.locator('#feature-list [data-feature="0"]')).toContainText('Aufbauen');
  const original=await page.evaluate(()=>localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project')));
  await page.locator('[data-field="width"]').fill('-2');await page.locator('[data-action="apply-dimensions"]').click();
  await expect(page.locator('#toast')).toContainText('Breite');
  expect(await page.evaluate(()=>localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project')))).toBe(original);
});

test('FreeCAD STEP fixture and a multi-solid STEP assembly import',async({page})=>{
  const encoded=(await readFile('examples/Beispielbauteil.step')).toString('base64');
  const imported=await call(page,'import_step',{base64:encoded,filename:'Beispielbauteil.step'});
  expect(imported.error).toBeUndefined();expect(imported.objects).toHaveLength(1);expect(imported.objects[0].volume).toBeGreaterThan(18000);
  const p=box();p.objects.push({id:'c',kind:'cylinder',params:{radius:5,height:10},position:[50,0,0],features:[{type:'chamfer',edges:[1],distance:1}]});
  const r=await model(page,p);expect(r.error).toBeUndefined();
  const volumes=await page.evaluate(async project=>{
    const {calculate}=await import('/cad-client.js');const step=await calculate('export_step',{project});
    const reader=new FileReader();const base64=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(step);});
    const result=await calculate('import_step',{base64,filename:'assembly.step'});return result.objects.map(o=>o.volume).sort((a,b)=>a-b);
  },r.project);
  const expected=r.objects.map(o=>o.volume).sort((a,b)=>a-b);expect(volumes).toHaveLength(2);volumes.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],4));
});
