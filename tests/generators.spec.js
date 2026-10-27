import {test,expect} from '@playwright/test';
import {evaluateExpression,resolveVariables} from '../web/expressions.js';
import {expandGenerators} from '../web/generators.js';

const box={kind:'box',name:'Block',params:{width:4,depth:6,height:8},features:[]};
const example=()=>({version:1,name:'Generator',variables:{breite:4,abstand:'breite + 6',anzahl:3},objects:[],generators:[{id:'g',name:'Gruppe',nodes:[{id:'root',name:'Elternteil',position:[10,20,0],rotation:[0,0,90],scale:2},{id:'child',name:'Block',parentId:'root',position:[5,0,0],body:{...structuredClone(box),expressions:{width:'breite'}},pattern:{mode:'linear',count:'anzahl',step:['abstand',0,0]}}]}]});
const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))));
const cad=(page,operation,payload)=>page.evaluate(async({operation,payload})=>{try{const result=await(await import('/cad-client.js')).calculate(operation,payload);return result instanceof Blob?{size:result.size}:result;}catch(e){return {error:e.message};}},{operation,payload});
const open=page=>page.locator('#open-generator').click();
const apply=page=>page.locator('[data-gen-action="apply"]').click();
const load=async(page,p)=>{await page.locator('#project-file').setInputFiles({name:'generator.formraum.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await expect.poll(async()=>(await saved(page)).project.name).toBe(p.name);};

test('safe formulas resolve dependencies, precedence, functions, and explicit errors',()=>{
 const values=resolveVariables({distance:'width*2',width:'sqrt(81)',angle:'sin(30)',power:'-2^2 + 2^3^2'});
 expect(values.distance).toBe(18);expect(values.angle).toBeCloseTo(.5);expect(values.power).toBe(508);
 expect(evaluateExpression('max(3, min(5,8))+pi')).toBeCloseTo(5+Math.PI);
 for(const formula of ['window.alert(1)','1/0','sqrt(-1)','Math.PI','2;3','a[0]','2 +','sin(1,2)','constructor(1)','2**3'])expect(()=>evaluateExpression(formula)).toThrow();
 expect(()=>resolveVariables({a:'b',b:'a'})).toThrow(/Zyklisch/);
 expect(()=>resolveVariables({a:'missing'})).toThrow(/Unbekannte Variable/);
 expect(()=>resolveVariables({sin:4})).toThrow(/reserviert/);
});

test('hierarchical patterns inherit local translation, rotation and scale and stay associative',()=>{
 const p=example(),result=expandGenerators(p);
 expect(p.objects).toEqual([]);expect(result.objects).toHaveLength(3);
 result.objects.forEach((o,i)=>{expect(o.position[0]).toBeCloseTo(10);expect(o.position[1]).toBeCloseTo(30+20*i);expect(o.rotation[2]).toBeCloseTo(90);expect(o.scale).toBeCloseTo(2);expect(o.params.width).toBe(4);expect(o.locked).toBe(true);});
 result.variables.breite=8;result.variables.anzahl=4;const next=expandGenerators(result);
 expect(next.objects).toHaveLength(4);expect(next.objects[0].id).toBe(result.objects[0].id);expect(next.objects[1].position[1]).toBeCloseTo(58);expect(next.objects[0].params.width).toBe(8);
 expect(next.generators[0].nodes[1].body.expressions.width).toBe('breite');
});

test('circular patterns repeat full subtrees around the chosen center with no full-circle duplicate',()=>{
 const p=example(),root=p.generators[0].nodes[0],child=p.generators[0].nodes[1];
 Object.assign(root,{position:[0,0,0],rotation:[0,0,0],scale:1,pattern:{mode:'circular',count:4,axis:'z',angle:360,center:[0,0,0]}});delete child.pattern;child.position=[10,0,0];
 p.generators[0].nodes.push({id:'grandchild',name:'Kind',parentId:'child',position:[0,3,0],body:structuredClone(box)});
 const result=expandGenerators(p);expect(result.objects).toHaveLength(8);
 expect(new Set(result.objects.map(o=>o.name)).size).toBe(8);
 const positions=result.objects.map(o=>o.position.map(v=>Math.round(v)||0));
 expect(positions).toEqual([[10,0,0],[10,3,0],[0,10,0],[-3,10,0],[-10,0,0],[-10,-3,0],[0,-10,0],[3,-10,0]]);
 root.pattern.angle=180;root.pattern.count=3;const half=expandGenerators(p);expect(half.objects[4].position[0]).toBeCloseTo(-10);
});

test('invalid hierarchy, formulas and expansion budgets fail before geometry work',()=>{
 const invalid=change=>{const p=example();change(p);expect(()=>expandGenerators(p)).toThrow();};
 invalid(p=>p.generators[0].nodes[0].parentId='child');
 invalid(p=>p.generators[0].nodes[1].parentId='missing');
 invalid(p=>p.variables.anzahl=3.2);
 invalid(p=>p.variables.anzahl=31);
 invalid(p=>p.generators[0].nodes[0].pattern={mode:'linear',count:20,step:[0,1,0]});
 invalid(p=>p.generators[0].nodes[1].body.expressions.width='unknown');
 invalid(p=>p.generators[0].nodes[1].pattern.step=[0,0,0]);
});

test.describe('generator browser integration',()=>{
 test.beforeEach(async({page})=>{await page.goto('/');await ready(page);await page.locator('#dismiss-welcome').click();});
 test('variable UI binds primitive dimensions, persists formulas, undo and invalid atomic updates',async({page})=>{
  await open(page);await page.locator('[data-gen-action="add-variable"]').click();await page.locator('[data-variable-name]').fill('breite');await page.locator('[data-variable-value]').fill('24');await apply(page);await expect(page.locator('#generator-dialog')).not.toBeVisible();
  await page.locator('[data-field="width"]').fill('breite / 2');await page.locator('[data-action="apply-dimensions"]').click();await expect.poll(async()=>(await saved(page)).project.objects[0].params.width).toBe(12);
  expect((await saved(page)).project.objects[0].expressions.width).toBe('breite / 2');
  await open(page);await page.locator('[data-variable-value]').fill('40');await apply(page);await expect.poll(async()=>(await saved(page)).project.objects[0].params.width).toBe(20);
  await page.reload();await ready(page);await expect(page.locator('[data-field="width"]')).toHaveValue('breite / 2');
  const before=await saved(page);await open(page);await page.locator('[data-variable-value]').fill('-10');await apply(page);await expect(page.locator('#generator-status')).toContainText('nicht übernommen');expect(await saved(page)).toEqual(before);
  await page.locator('[data-gen-action="close"]').click();await page.locator('[data-field="width"]').fill('18');await page.locator('[data-action="apply-dimensions"]').click();await expect.poll(async()=>(await saved(page)).project.objects[0].params.width).toBe(18);
  expect((await saved(page)).project.objects[0].expressions.width).toBeUndefined();await page.locator('#undo').click();await expect.poll(async()=>(await saved(page)).project.objects[0].expressions.width).toBe('breite / 2');
 });
 test('selection becomes a group; child inputs and parent pattern regenerate, export, detach, undo',async({page},info)=>{
  await open(page);await page.locator('[data-gen-action="from-selection"]').click();
  await page.locator('[data-gen-field="rotation.2"]').fill('90');await page.locator('[data-gen-pattern]').selectOption('linear');await page.locator('[data-gen-field="count"]').fill('2');await page.locator('[data-gen-field="step.0"]').fill('60');
  await page.locator('[data-gen-node]').nth(1).click();await page.locator('[data-gen-field="position.0"]').fill('10');await page.locator('[data-gen-param="width"]').fill('12');await page.screenshot({path:info.outputPath('generator-editor.png')});
  await apply(page);await expect(page.locator('#body-count')).toHaveText('2');let p=(await saved(page)).project;
  expect(p.generators).toHaveLength(1);expect(p.objects.every(o=>o.generated&&o.locked)).toBe(true);expect(p.objects[0].position[1]).toBeCloseTo(10);expect(p.objects[1].position[0]).toBeCloseTo(60);
  await expect(page.locator('[data-open-generator]')).toBeVisible();await page.screenshot({path:info.outputPath('generator-model.png')});
  expect((await cad(page,'export_step',{project:p})).size).toBeGreaterThan(1000);expect((await cad(page,'export_stl',{project:p})).size).toBeGreaterThan(1000);
  await open(page);await page.locator('[data-gen-action="detach"]').click();await apply(page);await expect.poll(async()=>(await saved(page)).project.generators.length).toBe(0);
  expect((await saved(page)).project.objects.every(o=>!o.generated&&!o.locked)).toBe(true);
  await page.locator('#undo').click();await expect.poll(async()=>(await saved(page)).project.generators.length).toBe(1);
 });
 test('example circle keeps child formulas and changes count without stale copies',async({page})=>{
  await open(page);await page.locator('[data-gen-action="example"]').click();await apply(page);await expect(page.locator('#body-count')).toHaveText('7');
  await open(page);await page.locator('[data-variable-value]').first().fill('3');await apply(page);await expect(page.locator('#body-count')).toHaveText('4');
  const p=(await saved(page)).project;expect(p.objects.filter(o=>o.generated)).toHaveLength(3);
  const model=await cad(page,'model',{project:p});expect(model.error).toBeUndefined();expect(model.objects.filter(o=>o.id.startsWith('gen_')).map(o=>o.volume)).toEqual(expect.arrayContaining([expect.closeTo(Math.PI*9*8,5)]));
  await page.reload();await ready(page);expect((await saved(page)).project.generators).toEqual(p.generators);
 });
 test('kernel preserves generator source and binds ordinary bodies inside booleans',async({page})=>{
  const p=example(),r=await cad(page,'model',{project:p});expect(r.error).toBeUndefined();expect(r.objects).toHaveLength(3);expect(r.objects[0].volume).toBeCloseTo(4*6*8*8,5);expect(r.project.generators).toEqual(p.generators);
  const cache=structuredClone(r.project);cache.objects[0].params.width=999;const rebuilt=await cad(page,'model',{project:cache});expect(rebuilt.project.objects[0].params.width).toBe(4);
  const bp={version:1,variables:{width:10},objects:[{id:'boolean',kind:'boolean',operation:'union',params:{},features:[],operands:[{...box,expressions:{width:'width'}},{...box,position:[5,0,0]}]}]};
  const br=await cad(page,'model',{project:bp});expect(br.error).toBeUndefined();expect(br.project.objects[0].operands[0].expressions.width).toBe('width');
 });
 test('locked bound body rejects a variable-induced geometry change',async({page})=>{
  await load(page,{version:1,name:'Locked formulas',variables:{width:10},objects:[{...box,id:'b',locked:true,expressions:{width:'width'}}]});
  const before=await saved(page);await open(page);await page.locator('[data-variable-value]').fill('20');await apply(page);await expect(page.locator('#generator-status')).toContainText('nicht übernommen');expect(await saved(page)).toEqual(before);
 });
 test('new child bodies can be reparented, ancestor cycles are excluded, deleting a generator keeps free bodies',async({page})=>{
  await open(page);await page.locator('[data-gen-action="new"]').click();await page.locator('[data-gen-field="position.0"]').fill('20');await page.locator('[data-gen-field="rotation.2"]').fill('90');
  const root=await page.locator('[data-gen-node]').first().getAttribute('data-gen-node');
  await page.locator('[data-gen-shape]').selectOption('box');await page.locator('[data-gen-action="add-body"]').click();await page.locator('[data-gen-field="position.0"]').fill('10');
  await page.locator('[data-gen-parent]').selectOption('');await apply(page);await expect(page.locator('#body-count')).toHaveText('2');
  let body=(await saved(page)).project.objects.find(o=>o.generated);expect(body.position).toEqual([10,0,0]);
  await open(page);await page.locator('[data-gen-node]').nth(1).click();await page.locator('[data-gen-parent]').selectOption(root);await page.locator('[data-gen-node]').first().click();
  await expect(page.locator('[data-gen-parent] option')).toHaveCount(1);await apply(page);await expect(page.locator('#generator-dialog')).not.toBeVisible();
  body=(await saved(page)).project.objects.find(o=>o.generated);expect(body.position[0]).toBeCloseTo(20);expect(body.position[1]).toBeCloseTo(10);
  await open(page);await page.locator('[data-gen-action="delete-generator"]').click();await apply(page);await expect(page.locator('#body-count')).toHaveText('1');expect((await saved(page)).project.objects[0].generated).toBeUndefined();
  await page.locator('#undo').click();await expect(page.locator('#body-count')).toHaveText('2');
 });
 test('opening a generator cannot discard uncommitted body dimensions',async({page})=>{
  await page.locator('[data-field="width"]').fill('47');await open(page);await expect(page.locator('#generator-dialog')).not.toBeVisible();await expect(page.locator('[data-field="width"]')).toHaveValue('47');
  await page.locator('[data-action="apply-dimensions"]').click();await expect.poll(async()=>(await saved(page)).project.objects[0].params.width).toBe(47);await open(page);await expect(page.locator('#generator-dialog')).toBeVisible();
 });
});
