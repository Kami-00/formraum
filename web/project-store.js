export const PROJECT_PREFIX='formraum.project.library.';
const ACTIVE='formraum.active-project',LEGACY='formraum.project.v1';
const copy=value=>structuredClone(value);
const checkId=id=>{if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw new Error('Ungültige Projektkennung.');return id;};
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function checkProject(project){
  if(!record(project)||project.version!==1||!Array.isArray(project.objects)||project.objects.length>30)throw new Error('Ungültiges Projektformat (Version 1 mit höchstens 30 Körpern erwartet).');
  if(project.name!=null&&typeof project.name!=='string')throw new Error('Der Projektname ist ungültig.');
  const ids=new Set();
  for(const body of project.objects){
    if(!record(body)||typeof body.id!=='string'||!body.id||body.id.length>128||ids.has(body.id))throw new Error('Körper-Kennungen müssen gültig und eindeutig sein.');
    ids.add(body.id);
    if(body.name!=null&&typeof body.name!=='string'||body.kind!=null&&typeof body.kind!=='string'||body.params!=null&&!record(body.params)||body.features!=null&&(!Array.isArray(body.features)||body.features.some(feature=>!record(feature))))throw new Error('Ein gespeicherter Körper hat ein ungültiges Datenformat.');
  }
  return project;
}
function parseEntry(raw,id){
  checkId(id);
  const entry=JSON.parse(raw);
  if(!record(entry)||entry.id!==id)throw new Error('Die Projektkennung stimmt nicht mit dem Speichereintrag überein.');
  if(!Number.isSafeInteger(entry.revision)||entry.revision<1)throw new Error('Der gespeicherte Versionsstand ist ungültig.');
  if(typeof entry.updatedAt!=='string'||!Number.isFinite(Date.parse(entry.updatedAt)))throw new Error('Das gespeicherte Änderungsdatum ist ungültig.');
  checkProject(entry.project);return entry;
}
function damageReason(error){return error instanceof SyntaxError?'Der Speichereintrag enthält ungültiges JSON.':error.message;}
export class ProjectStore{
  constructor(storage=localStorage){this.storage=storage;}
  read(id){
    const raw=this.storage.getItem(PROJECT_PREFIX+checkId(id));if(raw===null)return null;
    try{return parseEntry(raw,id);}
    catch(error){throw new Error(`Gespeichertes Projekt ist beschädigt: ${damageReason(error)} Die Daten wurden nicht überschrieben.`);}
  }
  scan(){
    const entries=[],damaged=[];
    for(let i=0;i<this.storage.length;i++){
      const key=this.storage.key(i);if(!key?.startsWith(PROJECT_PREFIX))continue;
      const id=key.slice(PROJECT_PREFIX.length),raw=this.storage.getItem(key);if(raw===null)continue;
      try{entries.push(parseEntry(raw,id));}
      catch(error){damaged.push({key,id,reason:damageReason(error),raw});}
    }
    return {entries,damaged};
  }
  damaged(){
    const result=this.scan().damaged,raw=this.storage.getItem(LEGACY);
    if(raw!==null){try{checkProject(JSON.parse(raw));}catch(error){result.push({key:LEGACY,id:null,reason:`Alte Browser-Sicherung: ${damageReason(error)}`,raw});}}
    return result;
  }
  list(){
    return this.scan().entries.map(entry=>({id:entry.id,name:entry.project.name||'Unbenannt',revision:entry.revision,updatedAt:entry.updatedAt,bodies:entry.project.objects.length})).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||a.id.localeCompare(b.id));
  }
  async locked(fn){
    if(!navigator.locks)throw new Error('Dieser Browser unterstützt keine sicheren Projektsperren. Bitte einen aktuellen Browser über HTTPS verwenden.');
    return navigator.locks.request('formraum-project-library',fn);
  }
  async save(id,project,expectedRevision){
    return this.locked(()=>{
      const current=this.read(id);
      if((current?.revision??0)!==expectedRevision)throw new Error('Das Projekt wurde in einem anderen Tab geändert. Über Projekte neu öffnen; deine Änderung wurde nicht überschrieben.');
      const entry={id,revision:expectedRevision+1,updatedAt:new Date().toISOString(),project:copy(project)};
      try{this.storage.setItem(PROJECT_PREFIX+id,JSON.stringify(entry));}
      catch{throw new Error('Browser-Speicher voll oder gesperrt. Projekt als Datei sichern und Speicher freigeben. Änderung nicht übernommen.');}
      this.activate(id);return entry;
    });
  }
  activate(id){try{this.storage.setItem(ACTIVE,checkId(id));}catch{/* The model record is already safely written. */}}
  async initial(defaultProject){
    return this.locked(()=>{
      const entries=this.list();
      if(entries.length){const active=this.storage.getItem(ACTIVE);return this.read(entries.some(e=>e.id===active)?active:entries[0].id);}
      const legacy=this.storage.getItem(LEGACY);
      let project=copy(checkProject(defaultProject));
      if(legacy!==null){try{project=checkProject(JSON.parse(legacy));}catch{/* Keep the original bytes and expose the problem through damaged(). */}}
      let id;do{id=crypto.randomUUID();}while(this.storage.getItem(PROJECT_PREFIX+id)!==null);
      const entry={id,revision:1,updatedAt:new Date().toISOString(),project};
      this.storage.setItem(PROJECT_PREFIX+entry.id,JSON.stringify(entry));this.activate(entry.id);
      // Keep the original backup untouched for recovery after migration.
      return entry;
    });
  }
  async remove(id,expectedRevision){return this.locked(()=>{
    const entry=this.read(id);if(!entry||entry.revision!==expectedRevision)throw new Error('Projekt inzwischen geändert. Liste neu öffnen.');
    this.storage.removeItem(PROJECT_PREFIX+checkId(id));
  });}
}
