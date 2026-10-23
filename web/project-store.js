export const PROJECT_PREFIX='formraum.project.library.';
const ACTIVE='formraum.active-project',LEGACY='formraum.project.v1';
const copy=value=>structuredClone(value);
const checkId=id=>{if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw new Error('Ungültige Projektkennung.');return id;};
export class ProjectStore{
  constructor(storage=localStorage){this.storage=storage;}
  read(id){
    const raw=this.storage.getItem(PROJECT_PREFIX+checkId(id));if(!raw)return null;
    const entry=JSON.parse(raw);
    if(entry.id!==id||!Number.isInteger(entry.revision)||!Array.isArray(entry.project?.objects))throw new Error('Gespeichertes Projekt ist beschädigt. Die Daten wurden nicht überschrieben.');
    return entry;
  }
  list(){
    const entries=[];
    for(let i=0;i<this.storage.length;i++){
      const key=this.storage.key(i);if(!key.startsWith(PROJECT_PREFIX))continue;
      const entry=this.read(key.slice(PROJECT_PREFIX.length));
      entries.push({id:entry.id,name:entry.project.name||'Unbenannt',revision:entry.revision,updatedAt:entry.updatedAt,bodies:entry.project.objects.length});
    }
    return entries.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
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
      const project=legacy?JSON.parse(legacy):defaultProject;
      if(project?.version!==1||!Array.isArray(project.objects))throw new Error('Die alte Browser-Sicherung konnte nicht gelesen werden. Sie bleibt unverändert erhalten.');
      const entry={id:crypto.randomUUID(),revision:1,updatedAt:new Date().toISOString(),project};
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
