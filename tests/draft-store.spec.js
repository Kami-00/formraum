import {test,expect} from '@playwright/test';
import {DRAFT_PREFIX,SketchDraftStore,sameReference,validateDraft} from '../web/sketch-drafts.js';

function memory(values={}){
 const data=new Map(Object.entries(values));
 return {get length(){return data.size;},key:index=>[...data.keys()][index]??null,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};
}
const base=()=>({projectId:'project-one',revision:3,project:{version:1,name:'Entwurf',objects:[]}});
const profile=()=>({kind:'rectangle',center:[2,3],width:10,height:8,radius:5,angle:25,sides:6,hasDrawn:true,locks:{width:true},invalid:{},constraints:{u:{mode:'min',distance:4}},distanceReference:'outline',role:'solid'});
const draft=()=>({version:1,standalone:true,bodyId:null,face:{id:0,origin:[0,0,0],normal:[0,0,1],u:[1,0,0],v:[0,1,0]},profiles:[profile()],activeContour:0,depth:8,snap:1,throughAll:false});
const storeFor=(storage=memory(),session=memory())=>new SketchDraftStore(storage,session);

test('sketch draft save retains independent base and contour snapshots',()=>{
 const storage=memory(),store=storeFor(storage),inputBase=base(),inputDraft=draft();
 const saved=store.save(inputBase,inputDraft);
 expect(saved.project).toEqual(inputBase.project);expect(saved.draft).toEqual(inputDraft);
 inputBase.project.name='After save';inputDraft.profiles[0].center[0]=99;
 expect(store.list()[0].project.name).toBe('Entwurf');expect(store.list()[0].draft.profiles[0].center).toEqual([2,3]);
 const edited=draft();edited.profiles[0].width=18;
 const next=store.save(base(),edited,saved.id);
 expect(next.id).toBe(saved.id);expect(store.list()).toHaveLength(1);expect(store.preferred('project-one',3).draft.profiles[0].width).toBe(18);
 expect(store.preferred('project-one',4)).toBeNull();
});

test('separate tabs never overwrite or remove each other drafts, including copied session storage',()=>{
 const storage=memory(),firstSession=memory(),first=storeFor(storage,firstSession),original=first.save(base(),draft());
 // Opening a tab with an opener or duplicating one copies sessionStorage.
 const copiedSession=memory({'formraum.draft-owner':firstSession.getItem('formraum.draft-owner')}),second=storeFor(storage,copiedSession);
 const changed=draft();changed.profiles[0].width=31;
 const fork=second.save(base(),changed,original.id);
 expect(fork.id).not.toBe(original.id);expect(fork.owner).not.toBe(original.owner);
 expect(storage.getItem(DRAFT_PREFIX+original.id)).toBe(JSON.stringify(original));
 second.remove(original.id);expect(storage.getItem(DRAFT_PREFIX+original.id)).toBe(JSON.stringify(original));
 first.remove(fork.id);expect(storage.getItem(DRAFT_PREFIX+fork.id)).toBe(JSON.stringify(fork));
 expect(first.preferred('project-one',3).id).toBe(original.id);expect(second.preferred('project-one',3).id).toBe(fork.id);
});

test('recovery never guesses among several foreign drafts at the same revision',()=>{
 const storage=memory(),one=storeFor(storage),two=storeFor(storage),observer=storeFor(storage);
 const first=one.save(base(),draft());expect(observer.preferred('project-one',3).id).toBe(first.id);
 two.save(base(),draft());expect(observer.preferred('project-one',3)).toBeNull();
});

test('quota errors keep the prior draft byte-for-byte and report a file-saving fallback',()=>{
 const storage=memory(),store=storeFor(storage),saved=store.save(base(),draft()),before=storage.getItem(DRAFT_PREFIX+saved.id);
 storage.setItem=()=>{throw new DOMException('full','QuotaExceededError');};
 const edited=draft();edited.profiles[0].width=99;
 expect(()=>store.save(base(),edited,saved.id)).toThrow('als Datei');
 expect(storage.getItem(DRAFT_PREFIX+saved.id)).toBe(before);expect(store.list()[0].draft.profiles[0].width).toBe(10);
});

test('invalid draft data and base records fail before replacing any previous snapshot',()=>{
 const storage=memory(),store=storeFor(storage),saved=store.save(base(),draft()),before=storage.getItem(DRAFT_PREFIX+saved.id);
 const badDrafts=[null,{...draft(),activeContour:7},{...draft(),depth:0},{...draft(),profiles:[{...profile(),center:[NaN,0]}]},{...draft(),profiles:[{...profile(),constraints:{u:{mode:'min',distance:-1}}}]}];
 for(const invalid of badDrafts)expect(()=>store.save(base(),invalid,saved.id)).toThrow();
 const badBases=[null,{...base(),projectId:''},{...base(),projectId:3},{...base(),revision:-1},{...base(),revision:1.5},{...base(),project:{version:1,objects:false}},{...base(),project:{version:1,objects:[null]}}];
 for(const invalid of badBases){expect(()=>store.save(invalid,draft(),saved.id)).toThrow();expect(storage.getItem(DRAFT_PREFIX+saved.id)).toBe(before);}
});

test('damaged raw drafts remain untouched while healthy records stay available',()=>{
 const storage=memory(),store=storeFor(storage),good=store.save(base(),draft());
 const invalid={
  json:'{ this is broken',
  revision:JSON.stringify({...good,id:'revision',revision:-1}),
  date:JSON.stringify({...good,id:'date',updatedAt:7}),
  shape:JSON.stringify({...good,id:'shape',project:{version:1,objects:[null]}}),
  profile:JSON.stringify({...good,id:'profile',draft:{...draft(),profiles:[]}}),
 };
 for(const [id,raw] of Object.entries(invalid))storage.setItem(DRAFT_PREFIX+id,raw);
 expect(store.list().map(r=>r.id)).toEqual([good.id]);
 for(const [id,raw] of Object.entries(invalid))expect(storage.getItem(DRAFT_PREFIX+id)).toBe(raw);
});

test('draft validation clones data and reference matching tolerates only small finite differences',()=>{
 const input=draft(),checked=validateDraft(input);checked.profiles[0].center[0]=8;expect(input.profiles[0].center[0]).toBe(2);
 const ref={version:1,kind:'face',surface:'Plane',normal:[0,0,1],center:[.5,.5,1]};
 expect(sameReference(ref,{...ref,center:[.500001,.5,1]})).toBe(true);
 expect(sameReference(ref,{...ref,center:[.51,.5,1]})).toBe(false);
 expect(sameReference(ref,{...ref,normal:[0,1,0]})).toBe(false);
 expect(sameReference(ref,{...ref,extra:true})).toBe(false);
 expect(sameReference(NaN,NaN)).toBe(false);expect(sameReference(Infinity,Infinity)).toBe(false);
});

test('draft body IDs follow the CAD contract and hidden blocking fields are rejected',()=>{
 for(const bodyId of ['Körper 1','part:one','x'.repeat(128)]){
  const b=base();b.project.objects=[{id:bodyId,kind:'box'}];const d={...draft(),standalone:false,bodyId,face:{id:1,reference:{version:1,kind:'face'}}};
  expect(storeFor().save(b,d).draft.bodyId).toBe(bodyId);
 }
 for(const field of ['locks','invalid']){const d=draft();d.profiles[0][field].invisible=true;expect(()=>validateDraft(d)).toThrow();}
 const d=draft();d.profiles[0].constraints.u.extra='ignored';d.profiles[0].face={id:99};expect(validateDraft(d).profiles[0].face).toBeUndefined();expect(validateDraft(d).profiles[0].constraints.u).toEqual({mode:'min',distance:4});
});
