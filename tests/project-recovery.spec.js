import {test,expect} from '@playwright/test';
import {ProjectStore,PROJECT_PREFIX} from '../web/project-store.js';

const ACTIVE='formraum.active-project',LEGACY='formraum.project.v1';
const project=name=>({version:1,name,objects:[]});
const entry=(id,name,extra={})=>({id,revision:1,updatedAt:'2026-10-26T12:00:00.000Z',project:project(name),...extra});
function memory(values={}){
 const data=new Map(Object.entries(values));
 return {get length(){return data.size;},key:index=>[...data.keys()][index]??null,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};
}
function storeFor(values={}){const storage=memory(values),store=new ProjectStore(storage);store.locked=async fn=>fn();return {store,storage};}
const ready=page=>expect(page.locator('#status')).toContainText('Geometrie bereit',{timeout:60000});

test('damaged records cannot hide healthy projects and retain their exact bytes',()=>{
 const invalid={
  json:'{ "broken": ',empty:'',null:'null',array:'[]',
  revision:JSON.stringify(entry('revision','Bad',{revision:-1})),
  date:JSON.stringify(entry('date','Bad',{updatedAt:7})),
  invalidDate:JSON.stringify(entry('invalidDate','Bad',{updatedAt:'not a date'})),
  name:JSON.stringify(entry('name','Bad',{project:{...project('Bad'),name:{value:'Bad'}}})),
  shape:JSON.stringify(entry('shape','Bad',{project:{version:1,objects:[null]}})),
  wrongId:JSON.stringify(entry('another-id','Bad')),
  'bad/id':JSON.stringify(entry('bad/id','Bad')),
 };
 const values=Object.fromEntries(Object.entries(invalid).map(([id,raw])=>[PROJECT_PREFIX+id,raw]));
 values[PROJECT_PREFIX+'healthy']=JSON.stringify(entry('healthy','Gesund'));
 const {store,storage}=storeFor(values);
 expect(store.list()).toEqual([{id:'healthy',name:'Gesund',revision:1,updatedAt:'2026-10-26T12:00:00.000Z',bodies:0}]);
 expect(store.damaged()).toHaveLength(Object.keys(invalid).length);
 for(const [id,raw] of Object.entries(invalid)){
  expect(storage.getItem(PROJECT_PREFIX+id)).toBe(raw);
  expect(store.damaged().find(d=>d.key===PROJECT_PREFIX+id)).toMatchObject({id,raw,reason:expect.any(String)});
 }
 expect(store.read('healthy').project.name).toBe('Gesund');
 expect(()=>store.read('json')).toThrow('nicht überschrieben');
});

test('healthy project sorting uses valid instants and corrupted active project is skipped',async()=>{
 const {store,storage}=storeFor({
  [PROJECT_PREFIX+'old']:JSON.stringify(entry('old','Alt',{updatedAt:'2026-10-26T13:00:00+02:00'})),
  [PROJECT_PREFIX+'new']:JSON.stringify(entry('new','Neu',{updatedAt:'2026-10-26T12:30:00Z'})),
  [PROJECT_PREFIX+'bad']:'{', [ACTIVE]:'bad',
 });
 expect(store.list().map(e=>e.id)).toEqual(['new','old']);
 expect((await store.initial(project('Default'))).id).toBe('new');
 expect(storage.getItem(PROJECT_PREFIX+'bad')).toBe('{');
});

test('only damaged entries create a separate default, and invalid legacy backup remains recoverable',async()=>{
 const values={[PROJECT_PREFIX+'bad']:'{  bad bytes', [LEGACY]:'[ invalid legacy', [ACTIVE]:'bad'};
 const {store,storage}=storeFor(values),result=await store.initial(project('Sicherer Neustart'));
 expect(result.id).not.toBe('bad');expect(result.project.name).toBe('Sicherer Neustart');
 expect(store.list()).toHaveLength(1);expect(store.damaged()).toHaveLength(2);
 for(const [key,raw] of Object.entries(values))if(key!==ACTIVE)expect(storage.getItem(key)).toBe(raw);
 expect(store.damaged().find(d=>d.key===LEGACY)).toMatchObject({id:null,raw:values[LEGACY],reason:expect.stringContaining('Alte Browser-Sicherung')});
 expect((await store.initial(project('Anderer Standard'))).id).toBe(result.id);
 expect(store.list()).toHaveLength(1);
});

test('valid legacy migration survives a damaged library and saving refuses to overwrite corruption',async()=>{
 const raw=' { "version":1, "name":"Alt", "objects":[] } ',bad='{broken';
 const {store,storage}=storeFor({[LEGACY]:raw,[PROJECT_PREFIX+'bad']:bad});
 const migrated=await store.initial(project('Default'));
 expect(migrated.project.name).toBe('Alt');expect(storage.getItem(LEGACY)).toBe(raw);
 await expect(store.save('bad',project('Replacement'),0)).rejects.toThrow('nicht überschrieben');
 expect(storage.getItem(PROJECT_PREFIX+'bad')).toBe(bad);expect(store.damaged()).toHaveLength(1);
});

test('browser starts with a healthy project beside broken active storage',async({page})=>{
 const bad=' {this is deliberately broken';
 await page.addInitScript(({entry,key,active,bad})=>{
  localStorage.clear();localStorage.setItem(key+'healthy',JSON.stringify(entry));localStorage.setItem(key+'broken',bad);localStorage.setItem(active,'broken');
 },{entry:entry('healthy','Gesundes Projekt'),key:PROJECT_PREFIX,active:ACTIVE,bad});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await ready(page);
 await expect(page.locator('#project-name')).toHaveValue('Gesundes Projekt');
 await page.locator('#projects-button').click();await expect(page.locator('#project-library')).toContainText('Gesundes Projekt');
 expect(await page.evaluate(key=>localStorage.getItem(key),PROJECT_PREFIX+'broken')).toBe(bad);
 expect(await page.evaluate(async()=>new (await import('/project-store.js')).ProjectStore().damaged())).toHaveLength(1);
 expect(errors).toEqual([]);
});

test('browser starts from default when all library and legacy records are damaged',async({page})=>{
 const damaged={[PROJECT_PREFIX+'broken']:'bad project',[LEGACY]:'{"version":1,"objects":false}'};
 await page.addInitScript(values=>{localStorage.clear();for(const [key,raw] of Object.entries(values))localStorage.setItem(key,raw);},damaged);
 await page.goto('/');await ready(page);await expect(page.locator('#project-name')).toHaveValue('Mein Bauteil');
 const state=await page.evaluate(async()=>{
  const {ProjectStore}=await import('/project-store.js'),store=new ProjectStore();
  return {entries:store.list(),damaged:store.damaged()};
 });
 expect(state.entries).toHaveLength(1);expect(state.damaged).toHaveLength(2);
 for(const {key,raw} of state.damaged)expect(raw).toBe(damaged[key]);
});
