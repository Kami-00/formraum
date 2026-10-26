import {test,expect} from '@playwright/test';
import {createPreviewClient} from '../web/preview-client.js';

function fakeWorkers(){
 const original=globalThis.Worker,instances=[];
 class FakeWorker{
  constructor(url,options){this.url=url;this.options=options;this.messages=[];this.terminations=0;instances.push(this);}
  postMessage(message){this.messages.push(message);}
  terminate(){this.terminations++;}
  reply(data){this.onmessage?.({data});}
 }
 globalThis.Worker=FakeWorker;
 return {instances,restore:()=>{globalThis.Worker=original;}};
}

test('preview starts lazily, sends model requests and reuses its own worker',async()=>{
 const fake=fakeWorkers(),client=createPreviewClient();
 try{
  expect(fake.instances).toHaveLength(0);
  const project={version:1,objects:[]},first=client.calculate(project),worker=fake.instances[0];
  expect(worker.url.pathname).toMatch(/\/cad-worker\.js$/);expect(worker.options).toEqual({type:'module'});
  expect(worker.messages).toEqual([{id:1,operation:'model',payload:{project}}]);
  const result={project,objects:[]};worker.reply({id:1,result});expect(await first).toEqual(result);
  const second=client.calculate(project);expect(fake.instances).toHaveLength(1);
  worker.reply({id:1,result:'late old response'});worker.reply({id:999,result:'unrelated response'});
  worker.reply({id:2,result});expect(await second).toEqual(result);expect(worker.terminations).toBe(0);
 }finally{client.dispose();fake.restore();}
});

test('preview rejects a second in-flight request without interrupting the first',async()=>{
 const fake=fakeWorkers(),client=createPreviewClient();
 try{
  const first=client.calculate({version:1,objects:[]}),worker=fake.instances[0];
  await expect(client.calculate({version:1,objects:[]})).rejects.toThrow('bereits berechnet');expect(worker.messages).toHaveLength(1);expect(worker.terminations).toBe(0);
  worker.reply({id:1,result:{objects:[]}});expect(await first).toEqual({objects:[]});
 }finally{client.dispose();fake.restore();}
});

test('geometry errors settle only that request and leave the preview worker reusable',async()=>{
 const fake=fakeWorkers(),client=createPreviewClient();
 try{
  const result=client.calculate({}),failure=expect(result).rejects.toThrow('Ungültige Kontur'),worker=fake.instances[0];worker.reply({id:1,error:'Ungültige Kontur'});await failure;
  const second=client.calculate({});worker.reply({id:2,result:{objects:[]}});await second;expect(fake.instances).toHaveLength(1);expect(worker.terminations).toBe(0);
 }finally{client.dispose();fake.restore();}
});

for(const event of ['onerror','onmessageerror'])test(`${event} terminates only the failed preview worker and permits lazy restart`,async()=>{
 const fake=fakeWorkers(),client=createPreviewClient();
 try{
  const first=client.calculate({}),failure=expect(first).rejects.toThrow(event==='onerror'?'geladen':'gelesen'),old=fake.instances[0],lateMessage=old.onmessage;
  old[event]({});await failure;expect(old.terminations).toBe(1);expect(old.onmessage).toBeNull();expect(old.onerror).toBeNull();expect(old.onmessageerror).toBeNull();
  const second=client.calculate({}),next=fake.instances[1];lateMessage({data:{id:2,result:'stale worker'}});next.reply({id:2,result:{objects:[]}});expect(await second).toEqual({objects:[]});
 }finally{client.dispose();fake.restore();}
});

test('a 120 second timeout cleans up once and the next request gets a fresh worker',async()=>{
 const fake=fakeWorkers(),client=createPreviewClient(),nativeSet=globalThis.setTimeout,nativeClear=globalThis.clearTimeout;let callback,cleared=0;
 const token={previewTimer:true};
 globalThis.setTimeout=(fn,ms,...args)=>{if(ms===120000){callback=fn;return token;}return nativeSet(fn,ms,...args);};
 globalThis.clearTimeout=timer=>{if(timer===token){cleared++;return;}return nativeClear(timer);};
 try{
  const first=client.calculate({}),failure=expect(first).rejects.toThrow('120 Sekunden'),old=fake.instances[0];expect(callback).toBeDefined();const oldTimeout=callback;oldTimeout();await failure;
  expect(old.terminations).toBe(1);expect(cleared).toBe(1);
  const second=client.calculate({}),next=fake.instances[1],staleTimeout=callback;oldTimeout();expect(next.terminations).toBe(0);next.reply({id:2,result:{objects:[]}});await second;staleTimeout();
  expect(next.terminations).toBe(0);expect(cleared).toBe(2);
 }finally{client.dispose();globalThis.setTimeout=nativeSet;globalThis.clearTimeout=nativeClear;fake.restore();}
});

test('dispose rejects pending work once, detaches handlers and never starts again',async()=>{
 const fake=fakeWorkers(),client=createPreviewClient();
 try{
  const first=client.calculate({}),failure=expect(first).rejects.toThrow('beendet'),worker=fake.instances[0],lateMessage=worker.onmessage;
  client.dispose();client.dispose();await failure;expect(worker.terminations).toBe(1);expect(worker.onmessage).toBeNull();
  lateMessage({data:{id:1,result:'too late'}});await expect(client.calculate({})).rejects.toThrow('beendet');expect(fake.instances).toHaveLength(1);
 }finally{client.dispose();fake.restore();}
});

test('worker startup and postMessage errors reject cleanly and can be retried',async()=>{
 const fake=fakeWorkers(),client=createPreviewClient(),FakeWorker=globalThis.Worker;
 try{
  globalThis.Worker=class{constructor(){throw new Error('worker unavailable');}};
  await expect(client.calculate({})).rejects.toThrow('worker unavailable');
  globalThis.Worker=class extends FakeWorker{postMessage(){throw new DOMException('not cloneable','DataCloneError');}};
  await expect(client.calculate({})).rejects.toThrow('not cloneable');expect(fake.instances[0].terminations).toBe(1);
  globalThis.Worker=FakeWorker;const third=client.calculate({}),worker=fake.instances[1];worker.reply({id:3,result:{objects:[]}});await third;
 }finally{client.dispose();fake.restore();}
});

test('disposing a preview never touches the independent main CAD worker',async()=>{
 const fake=fakeWorkers(),preview=createPreviewClient();
 try{
  const main=await import(`../web/cad-client.js?preview-isolation=${Date.now()}`),model=main.calculate('model',{project:{version:1,objects:[]}}),mainWorker=fake.instances[0];
  const first=preview.calculate({}),failure=expect(first).rejects.toThrow('beendet'),previewWorker=fake.instances[1];preview.dispose();await failure;
  expect(previewWorker).not.toBe(mainWorker);expect(previewWorker.terminations).toBe(1);expect(mainWorker.terminations).toBe(0);
  mainWorker.reply({id:1,result:{project:{version:1,objects:[]},objects:[]}});expect((await model).objects).toEqual([]);
 }finally{preview.dispose();fake.restore();}
});
