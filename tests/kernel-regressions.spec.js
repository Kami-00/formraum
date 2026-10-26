import {test,expect} from '@playwright/test';

const model=(page,project)=>page.evaluate(async project=>{
  try{return await(await import('/cad-client.js')).calculate('model',{project});}
  catch(error){return {error:error.message};}
},project);
const box=(id='box',width=40,depth=30,height=12)=>({id,kind:'box',params:{width,depth,height},features:[]});
const project=object=>({version:1,name:'Kernel-Regressionen',objects:[object]});
const top=result=>result.objects[0].faces.find(face=>face.normal?.[2]>.99);
const pocket=(face,center,radius=3,depth=12)=>({type:'pocket',face:face.id,reference:face.reference,sketch:{kind:'circle',radius,center},depth});

test.beforeEach(async({page})=>{
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});
});

test('intersection accepts contained and identical solids in either operand order',async({page})=>{
  const large=box('large',20,20,20),small=box('small',10,10,10);
  for(const operands of [[small,large],[large,small],[small,structuredClone(small)]]){
    const result=await model(page,project({id:'intersection',kind:'boolean',operation:'intersect',operands}));
    expect(result.error).toBeUndefined();
    expect(result.objects[0].valid).toBe(true);
    expect(result.objects[0].volume).toBeCloseTo(1000,5);
  }
  for(const operation of ['intersect','cut']){
    const result=await model(page,project({id:'invalid',kind:'boolean',operation,operands:[small,{...large,position:[100,0,0]}]}));
    expect(result.error).toBeTruthy();
  }
});

test('nested, duplicated and overlapping sketch holes are order independent',async({page})=>{
  const outer={id:'plate',kind:'profile',params:{height:5},profile:{kind:'rectangle',width:20,height:20},contours:[]};
  const large={kind:'circle',radius:3,center:[0,0],role:'hole'},small={...large,radius:1};
  for(const contours of [[large,small],[small,large],[large,large]]){
    const result=await model(page,project({...outer,contours}));
    expect(result.error).toBeUndefined();
    expect(result.objects[0].volume).toBeCloseTo((400-9*Math.PI)*5,5);
  }
  const left={kind:'rectangle',width:6,height:4,center:[-1,0],role:'hole'},right={...left,center:[1,0]};
  for(const contours of [[left,right],[right,left]]){
    const result=await model(page,project({...outer,contours}));
    expect(result.error).toBeUndefined();
    expect(result.objects[0].volume).toBeCloseTo((400-8*4)*5,5);
  }
  // A prior oversized hole must not make an entirely external hole acceptable.
  const invalid=await model(page,project({...outer,contours:[{...large,radius:8,center:[8,0]},{...small,center:[14,0]}]}));
  expect(invalid.error).toContain('normale Kontur überlappen');
  expect((await model(page,project({...outer,contours:[{...large,radius:20}]}))).error).toContain('gesamte Skizze');
});

test('earlier hole dimensions do not move or invalidate later planar sketches',async({page})=>{
  let p=project(box()),result=await model(page,p),face=top(result);
  expect(face.reference.version).toBe(2);
  expect(face.reference.outerWire).toHaveLength(4);
  p.objects[0].features.push(pocket(face,[-10,0]));
  result=await model(page,p);expect(result.error).toBeUndefined();
  p=result.project;p.objects[0].features.push(pocket(top(result),[10,0]));
  result=await model(page,p);expect(result.error).toBeUndefined();
  p=result.project;p.objects[0].features[0].sketch.radius=4;
  result=await model(page,p);expect(result.error).toBeUndefined();
  expect(result.objects[0].volume).toBeCloseTo(14400-(16+9)*Math.PI*12,4);
  expect(result.project.objects[0].features[1].sketch.center).toEqual([10,0]);
  const reordered=structuredClone(result.project);
  for(const feature of reordered.objects[0].features){feature.reference.outerWire.reverse();for(const edge of feature.reference.outerWire)edge.points.reverse();}
  expect((await model(page,reordered)).error).toBeUndefined();

  // References remain local; support dimension constraints are reevaluated.
  p=result.project;p.objects[0].params.width=50;
  p.objects[0].rotation=[15,25,35];p.objects[0].scale=2;p.objects[0].position=[5,6,7];
  p.objects[0].features[1].sketch.distanceReference='center';
  p.objects[0].features[1].sketch.constraints={u:{mode:'max',distance:10},v:{mode:'center'}};
  result=await model(page,p);expect(result.error).toBeUndefined();
  expect(result.project.objects[0].features[1].sketch.center).toEqual([15,0]);
  expect(result.objects[0].volume).toBeCloseTo((18000-25*Math.PI*12)*8,4);
});

test('legacy planar references migrate without moving unconstrained or constrained contours',async({page})=>{
  let p=project(box()),result=await model(page,p);
  p.objects[0].features.push(pocket(top(result),[-10,0]));
  result=await model(page,p);expect(result.error).toBeUndefined();p=result.project;
  // Version 1 anchored the face's area centroid, displaced by the first hole.
  const shift=10*Math.PI*9/(1200-Math.PI*9),face=top(result);
  const reference={version:1,kind:'face',center:[(shift+20)/40,.5,1],surface:'Plane',normal:[0,0,1]};
  p.objects[0].features.push({type:'pocket',face:face.id,reference,depth:12,sketch:{kind:'circle',radius:3,center:[10-shift,0]},contours:[{kind:'circle',radius:2,center:[-shift,5],constraints:{v:{mode:'max',distance:8}},distanceReference:'center'}]});
  const original=structuredClone(p);
  result=await model(page,p);expect(result.error).toBeUndefined();
  expect(p).toEqual(original);
  expect(result.project.objects[0].features[1].reference.version).toBe(2);
  expect(result.project.objects[0].features[1].sketch.center[0]).toBeCloseTo(10,6);
  expect(result.project.objects[0].features[1].contours[0].center[0]).toBeCloseTo(0,6);
  expect(result.project.objects[0].features[1].contours[0].center[1]).toBeCloseTo(7,6);
  expect(result.objects[0].volume).toBeCloseTo(14400-(9+9+4)*Math.PI*12,4);
  result.project.objects[0].features[0].sketch.radius=4;
  const edited=await model(page,result.project);expect(edited.error).toBeUndefined();
  expect(edited.objects[0].volume).toBeCloseTo(14400-(16+9+4)*Math.PI*12,4);
});

test('outer-wire anchors reject changed geometry and ambiguous same-plane candidates',async({page})=>{
  let p=project(box()),result=await model(page,p),face=top(result);
  // The plane, normalized center and bounding box still agree. Its outer wire does not.
  p.objects[0]={id:'different',kind:'profile',params:{height:12},profile:{kind:'ellipse',width:40,height:30},features:[pocket(face,[0,0],2)]};
  expect((await model(page,p)).error).toContain('Bezugsfläche');
  p=project(box());p.objects[0].features=[pocket({...face,reference:{...face.reference,normal:[0,0,-1]}},[0,0],2)];
  expect((await model(page,p)).error).toContain('Bezugsfläche');

  // Both small bosses lie inside normalized matching tolerance on a large base.
  // An index preference must never silently choose one of the two candidates.
  p=project(box('ambiguous',10000,10000,12));result=await model(page,p);face=top(result);
  p.objects[0].features=[{type:'extrude',face:face.id,reference:face.reference,depth:1,sketch:{kind:'rectangle',width:.02,height:.02,center:[-.02,0]},contours:[{kind:'rectangle',width:.02,height:.02,center:[.02,0]}]}];
  result=await model(page,p);expect(result.error).toBeUndefined();
  const bosses=result.objects[0].faces.filter(f=>f.normal?.[2]>.99&&f.origin[2]>12.9);
  expect(bosses).toHaveLength(2);
  p=result.project;p.objects[0].features.push(pocket(bosses[0],[0,0],.005,.1));
  expect((await model(page,p)).error).toContain('nicht eindeutig');
});
