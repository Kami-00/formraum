import {assertUnlockedChanges} from '../web/body-editing.js';
import {assignMeasureFormula,bindMeasures,measureBindings,unbindMeasure} from '../web/model-parameters.js';
import {test,expect} from '@playwright/test';
import {solveSketch} from '../web/sketch-solver.js';
import {arcThrough,trimEntity,offsetEntity} from '../web/sketch-operations.js';
import {findRegions,inRegion} from '../web/sketch-regions.js';
import {assemble,jointRest} from '../web/assembly.js';
import {planePreset,patternTransforms} from '../web/model-geometry.js';
import {expandGenerators} from '../web/generators.js';
const line=(id,a,b)=>({id,kind:'line',a,b}),circle=(id,center,radius)=>({id,kind:'circle',center,radius});
const rectangle=()=>[line('a',[0,0],[10,0]),line('b',[10,0],[10,5]),line('c',[10,5],[0,5]),line('d',[0,5],[0,0])];
const box=(id,position=[0,0,0])=>({id,name:id,kind:'box',params:{width:30,depth:20,height:10},position,features:[]});
const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('formraum.project.library.'+localStorage.getItem('formraum.active-project'))));
const cad=(page,project,op='model')=>page.evaluate(async({project,op})=>{try{const r=await(await import('/cad-client.js')).calculate(op,{project});return r instanceof Blob?{size:r.size}:r;}catch(e){return {error:e.message};}},{project,op});
const clickPoint=async(page,p)=>{const pos=await page.locator('#region-canvas').evaluate((svg,p)=>{const q=new DOMPoint(p[0],-p[1]).matrixTransform(svg.getScreenCTM());return{x:q.x,y:q.y};},p);await page.mouse.click(pos.x,pos.y);};
const loadProject=async(page,p)=>{await page.locator('#project-file').setInputFiles({name:'Test.formraum.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await ready(page);};

test('constraint solver preserves a closed rectangle, resolves variable dimensions and detects conflicts',()=>{
 const entities=rectangle(),constraints=[...['a','b','c','d'].map((a,i)=>({type:'coincident',a,pa:'b',b:['b','c','d','a'][i],pb:'a'})),{type:'fixed',a:'a',pa:'a',target:[0,0]},{type:'horizontal',a:'a'},{type:'horizontal',a:'c'},{type:'vertical',a:'b'},{type:'vertical',a:'d'},{type:'length',a:'a',value:'width'},{type:'length',a:'b',value:'width / 2'}];
 const r=solveSketch({entities,constraints},{width:24});expect(r.dof).toBe(0);expect(r.sketch.entities[0].b[0]).toBeCloseTo(24,5);expect(findRegions(r.sketch.entities)[0].area).toBeCloseTo(288,4);
 expect(()=>solveSketch({entities,constraints:[...constraints,{type:'length',a:'a',value:13}]},{width:24})).toThrow(/Widersprüchliche/);expect(entities[0].b).toEqual([10,0]);
});
test('tangent, parallel, perpendicular, equal, midpoint, symmetry, angles and fixed formula coordinates',()=>{
 const entities=[{...line('axis',[-10,0],[10,0]),bindings:{'a.0':-10,'a.1':0,'b.0':10,'b.1':0}},{...circle('c',[0,6],3),bindings:{'center.0':0,radius:3}}];const r=solveSketch({entities,constraints:[{type:'tangent',a:'axis',b:'c'}]});expect(r.sketch.entities[1].center[1]).toBeCloseTo(3,5);expect(r.dof).toBe(0);
 for(const [type,a,b]of [['parallel',line('a',[0,0],[10,0]),line('b',[0,1],[10,2])],['perpendicular',line('a',[0,0],[10,0]),line('b',[0,0],[1,10])],['equal',circle('a',[0,0],3),circle('b',[10,0],5)]])expect(solveSketch({entities:[a,b],constraints:[{type,a:'a',b:'b'}]}).dof).toBeGreaterThan(0);
 const mid=solveSketch({entities:[line('l',[0,0],[10,0]),circle('c',[4,2],1)],constraints:[{type:'midpoint',a:'c',pa:'center',b:'l'},{type:'angle',a:'l',value:0}]});expect(mid.sketch.entities[1].center[1]).toBeCloseTo(mid.sketch.entities[0].a[1],5);
 const symmetric=solveSketch({entities:[...entities.slice(0,1),circle('p',[-2,3],1),circle('q',[2,-2],1)],constraints:[{type:'symmetric',a:'p',pa:'center',b:'q',pb:'center',axis:'axis'}]});expect(symmetric.sketch.entities[1].center[0]).toBeCloseTo(symmetric.sketch.entities[2].center[0],5);
});
test('exact arc arrangement, trimming and offsets retain analytic regions',()=>{
 const arc=arcThrough([5,0],[0,5],[-5,0],'arc'),diameter=line('d',[-5,0],[5,0]);expect(findRegions([arc,diameter])[0].area).toBeCloseTo(Math.PI*25/2,8);
 expect(findRegions([arc,diameter,line('outside',[-8,-2],[8,-2])])).toHaveLength(1);
 let n=0;const trimmed=trimEntity({entities:[circle('c',[0,0],5),diameter]},'c',[0,5],()=>`id${++n}`);expect(trimmed.entities[0].kind).toBe('arc');expect(findRegions(trimmed.entities)[0].area).toBeCloseTo(Math.PI*25/2,8);
 const out=offsetEntity({entities:rectangle()},'a',2,()=>`offset${++n}`),regions=findRegions(out.entities);expect(regions.reduce((s,r)=>s+r.area,0)).toBeCloseTo(126,7);
 expect(()=>trimEntity({entities:[arc,diameter],constraints:[{type:'horizontal',a:'d'}]},'d',[0,0])).toThrow(/Beziehungen/);
});
test('plane frames and path patterns use exact coordinate transformations',()=>{
 const p=planePreset('XY',[1,2,3],[90,0,0]);expect(p.normal[1]).toBeCloseTo(-1,8);expect(p.v[2]).toBeCloseTo(1,8);
 const t=patternTransforms({mode:'path',count:5,points:[[0,0,0],[10,0,0],[10,10,0]]});expect(t.map(t=>t.translation)).toEqual([[0,0,0],[5,0,0],[10,0,0],[10,5,0],[10,10,0]]);
 const generator={id:'g',nodes:[{id:'n',body:box('b'),pattern:{mode:'path',count:3,points:[[0,0,0],[10,0,0],[10,10,0]]}}]};expect(expandGenerators({objects:[],generators:[generator]}).objects.map(o=>o.position)).toEqual([[0,0,0],[10,0,0],[10,10,0]]);
});
test('feature formula bindings follow reordered history and can be released',()=>{
 const body={params:{height:10},expressions:{height:'oldHeight'},features:[{type:'pocket',depth:2},{type:'fillet',radius:1}]};assignMeasureFormula(body,'features.0.depth','depth',{depth:5});assignMeasureFormula(body,'params.height','height',{height:12});expect(body.expressions.height).toBeUndefined();expect(measureBindings(body)['features.0.depth']).toBe('depth');body.features.reverse();const resolved=bindMeasures(body,{depth:7,height:15});expect(resolved.features[1].depth).toBe(7);expect(resolved.features[0].radius).toBe(1);expect(measureBindings(resolved)['features.1.depth']).toBe('depth');unbindMeasure(resolved,'features.1.depth');expect(measureBindings(resolved)['features.1.depth']).toBeUndefined();
});
test('joint hierarchy inherits parent movement, enforces limits and rejects cycles',()=>{
 const root=box('root'),child=box('child',[0,0,20]),grand=box('grand',[0,0,30]);const j={id:'j',childId:'child',parentId:'root',type:'slider',axis:[0,0,1],min:0,max:50,value:'hub',rest:jointRest(root,child)},k={id:'k',childId:'grand',parentId:'child',type:'fixed',rest:jointRest(child,grand)},p={objects:[root,child,grand],variables:{hub:12},assembly:{joints:[j,k]}};
 let r=assemble(p);const moved=structuredClone(r);moved.objects[1].position[2]+=5;expect(()=>assertUnlockedChanges(r,moved)).toThrow(/Baugruppenverbindung/);expect(()=>assertUnlockedChanges(r,moved,{resolved:true})).not.toThrow();expect(r.objects[1].position[2]).toBeCloseTo(32);expect(r.objects[2].position[2]).toBeCloseTo(42);expect(assemble(r).objects[2].position[2]).toBeCloseTo(42);
 p.objects[0].rotation=[90,0,0];r=assemble(p);expect(r.objects[2].position[1]).toBeCloseTo(-42,6);p.variables.hub=51;expect(()=>assemble(p)).toThrow(/Hubgrenzen/);p.variables.hub=0;j.parentId='grand';expect(()=>assemble(p)).toThrow(/Zyklische/);
});

test.describe('engineering CAD and browser workflows',()=>{
 test.beforeEach(async({page})=>{await page.goto('/');await ready(page);await page.locator('#dismiss-welcome').click();});
 test('sketch variables preserve selected topology, custom planes and exact arc solids',async({page})=>{
  const entities=[{...circle('c',[15,0],3),bindings:{radius:'r'}}],region=findRegions(entities)[0],p={version:1,name:'Variable ring',variables:{r:3},sketches:[{id:'s',entities}],objects:[{id:'b',kind:'region',sketchId:'s',regions:[region.id],regionKeys:[region.topologyId],params:{revolveAngle:360,axisOffset:0},features:[]}]};
  p.variables.r=4;let result=await cad(page,p);expect(result.error).toBeUndefined();expect(result.objects[0].volume).toBeCloseTo(2*Math.PI**2*15*16,4);
  p.objects[0].operation='extrude';p.objects[0].params.height=10;p.sketches[0].plane=planePreset('XY',[0,0,20],[90,0,0]);result=await cad(page,p);expect(result.error).toBeUndefined();expect(result.objects[0].volume).toBeCloseTo(Math.PI*16*10,5);expect(result.objects[0].bounds.min[1]).toBeCloseTo(-10,5);
  p.sketches[0].entities=[arcThrough([5,0],[0,5],[-5,0],'arc'),line('diameter',[-5,0],[5,0])];const regions=findRegions(p.sketches[0].entities);p.objects[0].regions=regions.map(r=>r.id);delete p.objects[0].regionKeys;result=await cad(page,p);expect(result.error).toBeUndefined();expect(result.objects[0].volume).toBeCloseTo(Math.PI*25*5,5);
 });
 test('face-based region cuts, feature patterns and variable bindings regenerate and export',async({page})=>{
  const p={version:1,name:'Plate',variables:{depth:5},objects:[box('plate')],sketches:[{id:'s',entities:[circle('hole',[-10,0],2)]}]},base=await cad(page,p),top=base.objects[0].faces.find(f=>f.planar&&f.normal[2]>.9),r=findRegions(p.sketches[0].entities)[0];
  p.objects[0].features=[{type:'region',sketchId:'s',regions:[r.id],regionKeys:[r.topologyId],operation:'extrude',combine:'cut',face:top.id,reference:top.reference,params:{height:5},bindings:{'params.height':'depth'},pattern:{mode:'linear',count:3,step:[10,0,0]}}];
  let result=await cad(page,p);expect(result.error).toBeUndefined();expect(result.objects[0].volume).toBeCloseTo(6000-3*Math.PI*4*5,4);p.variables.depth=10;result=await cad(page,p);expect(result.error).toBeUndefined();expect(result.objects[0].volume).toBeCloseTo(6000-3*Math.PI*4*10,4);expect((await cad(page,p,'export_step')).size).toBeGreaterThan(1000);
  p.objects[0].features[0].pattern={mode:'path',count:3,points:[[0,0,0],[10,0,0],[20,0,0]]};expect((await cad(page,p)).objects[0].volume).toBeCloseTo(result.objects[0].volume,4);
 });
 test('assembly poses reach native CAD geometry and STEP export',async({page})=>{
  const root=box('root'),child=box('child',[0,0,20]),p={version:1,name:'Assembly',objects:[root,child],assembly:{joints:[{id:'j',parentId:'root',childId:'child',type:'slider',axis:[0,0,1],min:0,max:30,value:15,rest:jointRest(root,child)}]}};const result=await cad(page,p);expect(result.error).toBeUndefined();expect(result.objects[1].bounds.min[2]).toBeCloseTo(35,6);expect((await cad(page,p,'export_step')).size).toBeGreaterThan(1000);
 });
 test('UI draws an arc, closes its region and extrudes on a chosen plane',async({page},info)=>{
  await page.locator('#new-region-sketch').click();await page.locator('[data-rs-mode="arc"]').click();for(const p of [[5,0],[0,5],[-5,0]])await clickPoint(page,p);await page.locator('[data-rs-mode="line"]').click();await clickPoint(page,[-5,0]);await clickPoint(page,[5,0]);await page.keyboard.press('Escape');await page.locator('[data-rs-mode="select"]').click();await clickPoint(page,[0,2]);
  await page.locator('#rs-operation').selectOption('extrude');await page.locator('#rs-extras summary').filter({hasText:'Arbeitsebene'}).click();await page.locator('#rs-plane').selectOption('XY');await page.locator('[data-rs-field="origin2"]').fill('20');await page.locator('[data-rs-action="plane-apply"]').click();await page.locator('[data-rs-action="rotate"]').click();await expect(page.locator('#region-dialog')).not.toBeVisible();const result=await saved(page);expect(result.project.objects.at(-1).operation).toBe('extrude');expect(result.project.sketches[0].entities[0].kind).toBe('arc');await page.screenshot({path:info.outputPath('arc-extrusion.png')});
 });
 test('UI adds a dimension constraint and rejects conflicting dimensions without saving',async({page})=>{
  await page.locator('#new-region-sketch').click();await clickPoint(page,[5,0]);await clickPoint(page,[15,1]);await page.keyboard.press('Escape');await page.locator('#rs-extras summary').filter({hasText:'Beziehungen'}).click();await page.locator('#rs-constraint-type').selectOption('horizontal');await page.locator('[data-rs-action="constraint-add"]').click();await page.locator('#rs-constraint-type').selectOption('length');await page.locator('[data-rs-field="constraint-value"]').fill('20');await page.locator('[data-rs-action="constraint-add"]').click();await page.locator('#rs-constraint-type').selectOption('length');await page.locator('[data-rs-field="constraint-value"]').fill('30');await page.locator('[data-rs-action="constraint-add"]').click();await expect(page.locator('#region-result')).toContainText('Widersprüchliche');await page.locator('[data-rs-action="save"]').click();await expect(page.locator('#region-dialog')).not.toBeVisible();const sk=(await saved(page)).project.sketches[0];expect(sk.constraints).toHaveLength(2);expect(Math.hypot(sk.entities[0].b[0]-sk.entities[0].a[0],sk.entities[0].b[1]-sk.entities[0].a[1])).toBeCloseTo(20,5);
 });
 test('UI creates a free sketch on a face, cuts and repeats it, then preserves its pattern while editing',async({page},info)=>{
  await page.locator('[data-view="top"]').click();const viewport=await page.locator('#viewport canvas').boundingBox();await page.mouse.click(viewport.x+viewport.width/2,viewport.y+viewport.height/2);await page.locator('[data-action="free-face-sketch"]').click();
  await page.locator('[data-rs-mode="circle"]').click();await clickPoint(page,[-10,0]);await clickPoint(page,[-8,0]);await page.locator('[data-rs-mode="select"]').click();await clickPoint(page,[-10,0]);await page.locator('#rs-combine').selectOption('cut');await page.locator('[data-rs-field="height"]').fill('5');await page.screenshot({path:info.outputPath('face-sketch.png')});await page.locator('[data-rs-action="rotate"]').click();await expect(page.locator('#region-dialog')).not.toBeVisible();
  await page.locator('#open-feature-pattern').click();await page.locator('#eng-pattern-mode').selectOption('linear');await page.locator('#eng-count').fill('3');await page.locator('#eng-step0').fill('10');await page.locator('[data-eng="apply"]').click();await expect(page.locator('#engineering-dialog')).not.toBeVisible();let p=(await saved(page)).project;expect(p.objects[0].features[0].pattern.count).toBe(3);expect((await cad(page,p)).objects[0].volume).toBeCloseTo(40*30*12-3*Math.PI*4*5,4);
  await page.locator('#region-sketch-list button').click();await page.locator('[data-rs-field="height"]').fill('6');await page.locator('[data-rs-action="rotate"]').click();await expect(page.locator('#region-dialog')).not.toBeVisible();p=(await saved(page)).project;expect(p.objects[0].features).toHaveLength(1);expect(p.objects[0].features[0].pattern.count).toBe(3);expect((await cad(page,p)).objects[0].volume).toBeCloseTo(40*30*12-3*Math.PI*4*6,4);
 });
 test('a saved feature sketch reopens its own target when it is not the first body',async({page})=>{
  const first=box('first',[-60,0,0]),second=box('second'),entities=[circle('c',[0,0],2)],region=findRegions(entities)[0];second.features=[{type:'region',sketchId:'s',regions:[region.id],regionKeys:[region.topologyId],operation:'extrude',combine:'add',params:{height:5}}];const p={version:1,name:'Own target',objects:[first,second],sketches:[{id:'s',name:'Boss',entities,plane:planePreset('XY',[0,0,10])}]};await loadProject(page,p);await expect(page.locator('#project-name')).toHaveValue('Own target');await page.locator('#region-sketch-list button').click();await expect(page.locator('#rs-target')).toHaveValue('second');await page.locator('[data-rs-field="height"]').fill('7');await page.locator('[data-rs-action="rotate"]').click();await expect(page.locator('#region-dialog')).not.toBeVisible();const result=(await saved(page)).project;expect(result.objects[0].features).toHaveLength(0);expect(result.objects[1].features).toHaveLength(1);expect(result.objects[1].features[0].params.height).toBe(7);
 });
 test('UI bindings, feature patterns and assembly preview persist only on apply',async({page},info)=>{
  const root=box('root'),child=box('child',[0,0,20]);await loadProject(page,{version:1,name:'Assembly test',variables:{height:15},objects:[root,child]});await page.locator('#open-bindings').click();await page.locator('#eng-body').selectOption('root');await page.locator('#eng-measure').selectOption('params.height');await page.locator('#eng-expression').fill('height');await page.locator('[data-eng="apply"]').click();await expect(page.locator('#engineering-dialog')).not.toBeVisible();expect((await saved(page)).project.objects[0].params.height).toBe(15);
  await page.locator('#open-assembly').click();await page.locator('[data-eng="new-joint"]').click();await page.locator('#eng-child').selectOption('child');await page.locator('#eng-parent').selectOption('root');const before=await saved(page);await page.locator('#eng-value').fill('12');await page.locator('#eng-value').dispatchEvent('change');expect(await saved(page)).toEqual(before);await page.locator('[data-eng="animate"]').click();await page.waitForTimeout(150);await page.locator('[data-eng="animate"]').click();await page.locator('#eng-value').fill('12');await page.locator('#eng-value').dispatchEvent('change');await page.screenshot({path:info.outputPath('assembly-preview.png')});await page.locator('[data-eng="apply"]').click();await expect(page.locator('#engineering-dialog')).not.toBeVisible();expect((await saved(page)).project.objects[1].position[2]).toBeCloseTo(32,5);await page.reload();await ready(page);expect((await saved(page)).project.assembly.joints).toHaveLength(1);
 });
});
