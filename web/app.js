import {suggestPoint,suggestSize} from './sketch-suggestions.js';
import {draggedProfileBounds} from './sketch-drag.js';
import {profileExtents,positionedCenter} from './sketch-position.js';
import {SHAPES,shapeName,sketchName,isRadial} from './shapes.js';
import {ProjectStore,PROJECT_PREFIX} from './project-store.js';
import {SketchDraftStore,validateDraft,sameReference} from './sketch-drafts.js';
import {setupSession} from './session.js';
import {calculate} from './cad-client.js';
import * as THREE from './vendor/three.module.js';
import {OrbitControls} from './vendor/OrbitControls.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const fmt = (n,d=2) => new Intl.NumberFormat('de-DE',{maximumFractionDigits:d}).format(n);
const vec = a => new THREE.Vector3(...a);
const uid = () => crypto.randomUUID();
const library=new ProjectStore();
const drafts=new SketchDraftStore();
let draftBase=null,draftId=null,draftSourceId=null,draftTimer,lastDraftSignature='',draftPersisted=true,inspectorDirty=false;
let activeProjectId=null,projectRevision=0,lastCommitError='',sessionReady=false;
const makeDefault = () => ({version:1,name:'Mein Bauteil',objects:[{id:uid(),name:'Quader 01',kind:'box',params:{width:40,depth:30,height:12},position:[0,0,0],features:[],color:'#67aba9'}]});
let project=makeDefault(), models=[], selectedId=project.objects[0].id, selectedFace=null, selectedEdges=new Set(), selectedFeature=-1;
let tool='select', sketch=null, busy=false, undoStack=[], redoStack=[], hoverEdge=null, drag=null, requestVersion=0, toastTimer, edgeSize=1;
let savedCamera=null, lastPointer=null, selectedContour=0;
let selectedBodies=new Set([selectedId]);

const viewport=$('#viewport');
const scene=new THREE.Scene();scene.background=new THREE.Color('#f0f4f6');
const camera=new THREE.OrthographicCamera(-60,60,60,-60,.1,3000);camera.up.set(0,0,1);
camera.position.set(110,-140,115);camera.lookAt(0,0,8);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(viewport.clientWidth,viewport.clientHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor('#f0f4f6');viewport.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label','Interaktives 3D-Modell');
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,8);
controls.mouseButtons={LEFT:null,MIDDLE:THREE.MOUSE.PAN,RIGHT:THREE.MOUSE.ROTATE};controls.enableDamping=true;controls.dampingFactor=.14;controls.zoomSpeed=1.0;controls.minZoom=.025;controls.maxZoom=300;
scene.add(new THREE.HemisphereLight(0xffffff,0xbacbd4,2.1));
const keyLight=new THREE.DirectionalLight(0xffffff,2.5);keyLight.position.set(50,-80,130);scene.add(keyLight);
const fillLight=new THREE.DirectionalLight(0xdce9ff,1.1);fillLight.position.set(-100,40,60);scene.add(fillLight);
const grid=new THREE.GridHelper(400,80,0xc1d0d6,0xdce4e8);grid.rotation.x=Math.PI/2;grid.position.z=-.06;grid.material.transparent=true;grid.material.opacity=.65;scene.add(grid);
const axes=new THREE.Group();
for(const [dir,color] of [[[35,0,0],0xc98076],[[0,35,0],0x83a17c],[[0,0,25],0x789fc3]]){
 const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,.03),vec(dir)]);
 axes.add(new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity:.5})));
}scene.add(axes);
const bodyRoot=new THREE.Group(), overlayRoot=new THREE.Group(), sketchRoot=new THREE.Group();scene.add(bodyRoot,overlayRoot,sketchRoot);
let bodyMeshes=[], edgeLines=[], groups=new Map(), viewHeight=90;
const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();
const dimensionLayer=document.createElement('div');dimensionLayer.className='dimension-layer';viewport.appendChild(dimensionLayer);
const dimensionInputs=new Map();
for(const [key,caption] of [['width','B'],['height','H'],['diameter','Ø'],['radius','R'],['distance-u','↔'],['distance-v','↕']]){
 const label=document.createElement('label');label.className='sketch-dimension';label.hidden=true;label.innerHTML=`<span>${caption}</span><input type="number" min="0.01" step="any" aria-label="Skizzenmaß ${key}"><span>mm</span>`;
 const input=label.querySelector('input');if(key.startsWith('distance-'))input.min='0';input.oninput=()=>setSketchDimension(key,input.value,input);input.onkeydown=e=>{if(e.key==='Enter')input.blur();};dimensionLayer.appendChild(label);dimensionInputs.set(key,{label,input});
}
const measureLabel=document.createElement('div');measureLabel.className='sketch-measure';measureLabel.hidden=true;viewport.appendChild(measureLabel);

function resize(){
 const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;
 renderer.setSize(w,h);const aspect=w/h;camera.left=-viewHeight*aspect/2;camera.right=viewHeight*aspect/2;camera.top=viewHeight/2;camera.bottom=-viewHeight/2;camera.updateProjectionMatrix();if(sketch)drawSketch();
}
new ResizeObserver(resize).observe(viewport);
function disposeGroup(group){
 for(const object of [...group.children]){object.traverse(c=>{c.geometry?.dispose();if(Array.isArray(c.material))c.material.forEach(m=>m.dispose());else c.material?.dispose();});group.remove(object);}
}
function renderBodies(){
 disposeGroup(bodyRoot);bodyMeshes=[];edgeLines=[];groups=new Map();
 for(const model of models){
  const spec=project.objects.find(x=>x.id===model.id);if(!spec||spec.visible===false)continue;
  const group=new THREE.Group();groups.set(model.id,group);bodyRoot.add(group);
  const positions=model.mesh.vertices.flat(),indices=model.mesh.triangles.flat();
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({color:spec.color||'#91aeb7',roughness:.52,metalness:.06,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  if(spec.hole){material.transparent=true;material.opacity=.3;material.depthWrite=false;}
  if(!selectedBodies.has(model.id))material.color.lerp(new THREE.Color('#aebac5'),.25);
  const mesh=new THREE.Mesh(geometry,material);mesh.userData={body:model.id,model};group.add(mesh);bodyMeshes.push(mesh);
  for(const edge of model.edges){
   if(edge.points.length<2)continue;
   const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge.points.map(vec)),new THREE.LineBasicMaterial({color:model.id===selectedId?0x355d65:0x6b808b,transparent:true,opacity:.7}));
   line.userData={body:model.id,edge:edge.id};group.add(line);edgeLines.push(line);
  }
 }
 renderSelection();
}
function renderSelection(){
 disposeGroup(overlayRoot);
 if(selectedFace&&tool!=='fillet'&&tool!=='chamfer'){
  const model=models.find(m=>m.id===selectedId);
  if(model){
   const triangles=model.mesh.triangles.filter((t,i)=>model.mesh.faceIds[i]===selectedFace.id);
   const flat=triangles.flatMap(t=>t.flatMap(i=>model.mesh.vertices[i]));
   const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(flat,3));geom.computeVertexNormals();
   const mat=new THREE.MeshBasicMaterial({color:tool==='sketch'?0x24b5a0:0xe8c46d,transparent:true,opacity:tool==='sketch'?.13:.32,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
   overlayRoot.add(new THREE.Mesh(geom,mat));
  }
 }
 if(tool==='fillet'||tool==='chamfer'){
  const model=models.find(m=>m.id===selectedId);
  for(const edge of model?.edges||[]){
   const isSelected=selectedEdges.has(edge.id),isHover=hoverEdge?.body===selectedId&&hoverEdge?.id===edge.id;
   if(!isSelected&&!isHover)continue;
   const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge.points.map(vec)),new THREE.LineBasicMaterial({color:isSelected?0x00bc9f:0xe2a446,depthTest:false,transparent:true,opacity:1}));line.renderOrder=10;overlayRoot.add(line);
  }
 }
}
function projectBounds(){
 const bounds=new THREE.Box3();
 for(const m of models){if(project.objects.find(x=>x.id===m.id)?.visible===false)continue;bounds.expandByPoint(vec(m.bounds.min));bounds.expandByPoint(vec(m.bounds.max));}
 if(bounds.isEmpty())bounds.set(new THREE.Vector3(-20,-20,0),new THREE.Vector3(20,20,20));return bounds;
}
function fitView(direction=null){
 if(sketch){const model=models.find(m=>m.id===selectedId);const size=model?vec(model.bounds.max).sub(vec(model.bounds.min)).length():60;const aspect=viewport.clientWidth/viewport.clientHeight;viewHeight=Math.max(size*1.15/Math.min(aspect,1),35);camera.zoom=1;resize();return;}
 const bounds=projectBounds(),center=bounds.getCenter(new THREE.Vector3()),radius=bounds.getSize(new THREE.Vector3()).length()/2;
 const dir=direction?vec(direction):camera.position.clone().sub(controls.target).normalize();
 camera.up.set(0,0,1);camera.position.copy(center).addScaledVector(dir.normalize(),Math.max(radius*5,200));controls.target.copy(center);
 const aspect=viewport.clientWidth/viewport.clientHeight;viewHeight=Math.max(radius*2.5/Math.min(aspect,1),25);camera.zoom=1;resize();camera.lookAt(center);controls.update();
}
function setView(view){
 if(sketch){toast('Beende zuerst die Skizze, um die Ansicht zu wechseln.');return;}
 const dirs={iso:[1,-1,1],top:[0,-.0001,1],front:[0,-1,.0001],right:[1,0,.0001]};fitView(dirs[view]||dirs.iso);
 $$('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));
}
function selectObject(id,face=null,additive=false){
 if(additive&&id){selectedBodies.has(id)?selectedBodies.delete(id):selectedBodies.add(id);if(!selectedBodies.has(selectedId))selectedId=[...selectedBodies][0]||null;}
 else{selectedId=id;selectedBodies=new Set(id?[id]:[]);}
 selectedFace=selectedBodies.size===1&&selectedId===id?face:null;selectedFeature=-1;selectedEdges.clear();hoverEdge=null;
 renderBodies();renderPanels();
}
function currentSpec(){return project.objects.find(o=>o.id===selectedId);}
function currentModel(){return models.find(o=>o.id===selectedId);}
function toast(message,error=false){clearTimeout(toastTimer);const t=$('#toast');t.textContent=message;t.classList.toggle('error',error);t.hidden=false;toastTimer=setTimeout(()=>t.hidden=true,error?8500:3500);}
function setBusy(value){busy=value;document.body.classList.toggle('busy',value);$('#busy-badge').hidden=!value;updateUndo();if(sketch)syncSketchInputs();}
function setStatus(message,ok=true){$('#status').textContent=message;$('#connection-dot').classList.toggle('off',!ok);}
function updateUndo(){$('#undo').disabled=busy||!undoStack.length;$('#redo').disabled=busy||!redoStack.length;}
async function commit(next,{record=true,fit=false,message='',entry=null,create=false,fromSketch=false}={}){
 if(busy){lastCommitError='Eine Berechnung läuft bereits.';return false;}
 if(sketch&&!fromSketch){lastCommitError='Bitte die Skizze zuerst aufbauen, ausschneiden oder beenden.';toast(lastCommitError,true);return false;}
 setBusy(true);const n=++requestVersion;lastCommitError='';
 try{
  const result=await calculate('model',{project:next});if(n!==requestVersion)return false;
  const saved=entry||await library.save(create?uid():activeProjectId,result.project,create?0:projectRevision);
  if(entry||create){undoStack=[];redoStack=[];}
  else if(record){undoStack.push(clone(project));if(undoStack.length>60)undoStack.shift();redoStack=[];}
  activeProjectId=saved.id;projectRevision=saved.revision;library.activate(saved.id);
  project=clone(result.project);models=result.objects;
  if(!project.objects.some(o=>o.id===selectedId))selectedId=project.objects[0]?.id||null;
  selectedFace=null;selectedEdges.clear();hoverEdge=null;selectedFeature=-1;selectedContour=0;selectedBodies=new Set(selectedId?[selectedId]:[]);
  inspectorDirty=false;renderBodies();renderPanels();renderProjectList();$('#autosave-status').textContent='Projekt im Browser gespeichert';
  setStatus(`${models.length} Körper · Geometrie bereit`);
  if(fit)fitView();if(message)toast(message);return true;
 }catch(error){lastCommitError=error.message;toast(error.message,true);setStatus('Änderung verworfen · letzter gültiger Stand erhalten',true);return false;}
 finally{setBusy(false);}
}
function renderProjectList(){
 const root=$('#project-library');if(!root)return;
 try{
  root.innerHTML=library.list().map(e=>`<div class="project-card ${e.id===activeProjectId?'current':''}"><button data-open-saved="${esc(e.id)}"><strong>${esc(e.name)}</strong><span>${e.bodies} Körper · ${esc(new Date(e.updatedAt).toLocaleString('de-DE'))}${e.id===activeProjectId?' · Aktiv':''}</span></button><button class="icon-button" data-duplicate-project="${esc(e.id)}" title="Projekt duplizieren" aria-label="${esc(e.name)} duplizieren">＋</button>${e.id!==activeProjectId?`<button class="icon-button" data-delete-project="${esc(e.id)}" title="Projekt löschen" aria-label="${esc(e.name)} löschen">×</button>`:''}</div>`).join('');
  const damaged=library.damaged(),savedDrafts=drafts.list();
  if(damaged.length)root.insertAdjacentHTML('beforeend',`<section class="project-recovery" aria-label="Beschädigte Sicherungen"><h3>Beschädigte Sicherungen</h3><p>Diese Einträge bleiben unverändert erhalten. Gesunde Projekte kannst du weiter öffnen.</p>${damaged.map((e,i)=>`<div class="recovery-card"><span>${esc(e.id||'Alte Sicherung')} · ${esc(e.reason)}</span><button class="subtle-button" data-backup-damaged="${i}">Rohdaten sichern</button></div>`).join('')}</section>`);
  if(savedDrafts.length)root.insertAdjacentHTML('beforeend',`<section class="project-recovery" aria-label="Skizzenentwürfe"><h3>Skizzenentwürfe</h3><p>Bei einem inzwischen geänderten Modell wird der Entwurf mit seinem ursprünglichen Modell als neues Projekt geöffnet.</p>${savedDrafts.map(d=>`<div class="recovery-card"><span>${esc(d.project.name||'Unbenannt')} · ${esc(new Date(d.updatedAt).toLocaleString('de-DE'))}</span><button class="subtle-button" data-restore-draft="${esc(d.id)}">Entwurf öffnen</button></div>`).join('')}</section>`);
 }
 catch(error){root.textContent=error.message;}
}
async function openSaved(id){
 if(busy)return false;
 try{const entry=library.read(id);if(!entry)throw new Error('Projekt nicht gefunden.');
  if(sketch&&!cancelSketch())return false;tool='select';
  const ok=await commit(entry.project,{entry,record:false,fit:true,message:'Projekt geöffnet'});
  if(ok){$('#projects-dialog').close();restorePreferredDraft();}return ok;
 }catch(error){lastCommitError=error.message;toast(error.message,true);return false;}
}
async function newProject(data={version:1,name:'Neues Bauteil',objects:[]}){
 if(busy)return false;if(sketch&&!cancelSketch())return false;tool='select';
 const ok=await commit(data,{create:true,record:false,fit:true,message:'Projekt angelegt'});
 if(ok)$('#projects-dialog').close();return ok;
}
window.addEventListener('storage',event=>{
 if(event.key?.startsWith(PROJECT_PREFIX)){renderProjectList();if(event.key===PROJECT_PREFIX+activeProjectId)$('#autosave-status').textContent='In anderem Tab geändert · über Projekte neu öffnen';}
});

function field(label,key,value,unit='mm',extra=''){
 return `<label class="field"><span>${esc(label)}</span><div class="input-unit"><input type="number" data-field="${esc(key)}" value="${Number(value??0)}" step="0.1" ${extra} aria-label="${esc(label)}">${unit?`<em>${esc(unit)}</em>`:''}</div></label>`;
}
function featureName(f){return ({extrude:'Aufbauen',pocket:'Ausschneiden',fillet:'Rundung',chamfer:'Fase',shell:'Wandung'})[f.type]||f.type;}
function featureIcon(f){return ({extrude:'extrude',pocket:'cut',fillet:'fillet',chamfer:'chamfer'})[f.type]||'sketch';}
function featureDetail(f){const scale=currentSpec()?.scale??1;return f.type==='shell'?`${fmt(f.thickness*scale)} mm Wand`:f.type==='fillet'?`R ${fmt(f.radius*scale)}`:f.type==='chamfer'?`${fmt(f.distance*scale)} mm`:`${fmt(f.depth*scale)} mm`;}
function renderPanels(){
 $('#project-name').value=project.name||'Unbenanntes Bauteil';$('#body-count').textContent=project.objects.length;
 $('#body-list').innerHTML=project.objects.length?project.objects.map(o=>`<div class="body-row ${selectedBodies.has(o.id)?'active':''} ${o.visible===false?'invisible':''}" data-body="${esc(o.id)}" role="button" tabindex="0" aria-label="${esc(o.name)}" title="${esc(o.name)}"><input type="checkbox" data-multi-body="${esc(o.id)}" aria-label="${esc(o.name)} zur Auswahl hinzufügen" ${selectedBodies.has(o.id)?'checked':''}><span class="body-icon">${icon(o.kind==='cylinder'?'cylinder':'box')}</span><span class="body-label">${esc(o.name)}${o.hole?' · Bohrung':''}</span><button class="icon-button" data-visibility="${esc(o.id)}" title="Sichtbarkeit" aria-label="${o.visible===false?'Einblenden':'Ausblenden'}">${icon('eye')}</button></div>`).join(''):'<p class="tip" style="padding:5px 9px">Füge eine Form hinzu oder beginne mit einer Skizze.</p>';
 const spec=currentSpec();
 $('#feature-list').innerHTML=spec?`<div class="feature-row ${selectedFeature===-1?'current':''}" data-feature="-1" role="button" tabindex="0" aria-label="Grundkörper" title="Grundkörper">${icon(spec.kind==='cylinder'?'cylinder':'box')}<span>${spec.kind==='imported'?'STEP-Import':'Grundkörper'}</span></div>`+(spec.features||[]).map((f,i)=>`<div class="feature-row ${i===selectedFeature?'current':''}" data-feature="${i}" role="button" tabindex="0" aria-label="${esc(featureName(f)+' '+featureDetail(f))}" title="${esc(featureName(f)+' '+featureDetail(f))}">${icon(featureIcon(f))}<span>${featureName(f)} <small>${esc(featureDetail(f))}</small></span><button class="remove-feature" data-remove-feature="${i}" title="Diesen und folgende Schritte entfernen" aria-label="Diesen und folgende Schritte entfernen">×</button></div>`).join(''):'';
 renderInspector();
 const faceText=selectedFace?` · Fläche ${selectedFace.id}`:'';
 $('#selection-status').textContent=selectedBodies.size>1?`${selectedBodies.size} Körper ausgewählt · Basis: ${spec?.name||''}`:spec?`${spec.name}${faceText}`:'Keine Auswahl';
 updateToolButtons();updateUndo();
}
function renderInspector(){
 inspectorDirty=false;
 const root=$('#inspector'),spec=currentSpec(),model=currentModel();
 if(sketch){renderSketchInspector();return;}
 if(selectedBodies.size>1){renderMultiInspector();return;}
 if(tool==='fillet'||tool==='chamfer'){
  const rounded=tool==='fillet';
  root.innerHTML=`<div class="inspector-heading">${rounded?'KANTEN ABRUNDEN':'KANTEN ANFASEN'}${icon(rounded?'fillet':'chamfer')}</div><div class="inspector-content"><p class="tool-description">Klicke die gewünschten Kanten direkt am Bauteil an.</p><div class="edge-count"><strong>${selectedEdges.size}</strong> ${selectedEdges.size===1?'Kante ausgewählt':'Kanten ausgewählt'}</div><div class="chip-list">${[...selectedEdges].map(e=>`<button data-remove-edge="${e}">Kante ${e} ×</button>`).join('')}</div>${field(rounded?'Radius':'Fasenmaß','edge-size',edgeSize)}<button class="primary" data-action="apply-edge" ${!selectedEdges.size||!spec?'disabled':''}>${icon('check')}${rounded?'Rundung':'Fase'} anwenden</button><button class="subtle-button" data-action="cancel-tool">Abbrechen</button><p class="tip">Noch einmal auf eine ausgewählte Kante klicken, um sie abzuwählen. Bei zu großen Maßen bleibt dein Bauteil unverändert.</p></div>`;
  return;
 }
 if(!spec||!model){root.innerHTML=`<div class="inspector-heading">EIGENSCHAFTEN</div><div class="inspector-empty">${icon('select')}<strong>Dein Bauteil im Blick.</strong><p>Wähle einen Körper oder eine Fläche im 3D-Bereich aus.</p></div>`;return;}
 if(selectedFeature>=0&&spec.features?.[selectedFeature]){renderFeatureInspector(spec.features[selectedFeature]);return;}
 const bounds=vec(model.bounds.max).sub(vec(model.bounds.min));
 const faceCard=selectedFace?`<div class="face-card"><div class="face-title">${icon('sketch')}Fläche ${selectedFace.id} ausgewählt</div><p>${selectedFace.planar?'Ebene Fläche · '+fmt(selectedFace.area)+' mm²':'Gekrümmte Fläche · '+fmt(selectedFace.area)+' mm²'}</p><button class="primary" data-action="start-sketch" ${selectedFace.planar?'':'disabled'}>${icon('sketch')}Skizze auf Fläche</button>${field('Wandstärke','shell-thickness',2)}<label class="locked-dimension"><input type="checkbox" id="shell-closed"> Geschlossen aushöhlen</label><button class="subtle-button" data-action="apply-shell">Wandung anwenden</button><p class="tip">Wandung nach innen. Die ausgewählte Fläche wird zur Öffnung, außer bei geschlossenem Aushöhlen.</p>${!selectedFace.planar?'<p>Wähle zum Zeichnen eine ebene Fläche.</p>':''}</div>`:'';
 root.innerHTML=`<div class="inspector-heading">EIGENSCHAFTEN<button class="icon-button" data-action="delete-body" title="Körper löschen" aria-label="Körper löschen">${icon('trash')}</button></div><div class="inspector-content"><div class="object-type">${icon(spec.kind==='cylinder'?'cylinder':'box')}${esc(shapeName(spec.kind))}</div><input class="name-field" data-field="body-name" aria-label="Körpername" value="${esc(spec.name)}">${faceCard}<div class="section-title">AUSSENMASSE<span>mm</span></div><div class="bounds-display">${fmt(bounds.x)} <i>×</i> ${fmt(bounds.y)} <i>×</i> ${fmt(bounds.z)}</div>${bodyParameterFields(spec)}${['gear','thread'].includes(spec.kind)?'<p class="tip">'+(spec.kind==='gear'?'Geradverzahnung mit angenäherter Evolvente, 20° Druckwinkel; kein Normprofil.':'Echtes Rechtsgewinde mit vereinfachtem Profil; kein normgeprüftes ISO-Gewinde. Als Bohrung gruppiert entsteht ein Innengewinde.')+'</p>':''}<div class="body-role"><button data-body-role="solid" class="${!spec.hole?'active':''}">Körper</button><button data-body-role="hole" class="${spec.hole?'active':''}">Bohrung</button></div><div class="section-title">POSITION</div><div class="fields-3">${field('X','position-x',spec.position?.[0]||0)}${field('Y','position-y',spec.position?.[1]||0)}${field('Z','position-z',spec.position?.[2]||0)}</div><div class="section-title">DREHUNG<span>° · X → Y → Z</span></div><div class="fields-3">${field('X','rotation-x',spec.rotation?.[0]||0,'°')}${field('Y','rotation-y',spec.rotation?.[1]||0,'°')}${field('Z','rotation-z',spec.rotation?.[2]||0,'°')}</div>${field('Skalierung · gleichmäßig','scale',spec.scale??1,'×')}<button class="primary" data-action="apply-dimensions">${icon('check')}Maße übernehmen</button><div class="body-actions"><button class="subtle-button" data-action="duplicate-body">Duplizieren</button><button class="subtle-button" data-action="ground-body">Auf Boden</button></div>${spec.kind==='boolean'?`<button class="subtle-button" data-action="ungroup" ${spec.features?.length?'disabled':''}>Kombination auflösen</button><p class="tip">Ausgangsformen bleiben bearbeitbar. Auflösen ist vor zusätzlichen Modellschritten möglich.</p>`:''}<div class="volume"><span>Volumen</span><span>${fmt(model.volume)} mm³</span></div>${!selectedFace?'<hr class="divider"><p class="muted">Klicke auf eine Fläche, um dort eine Skizze anzulegen.</p>':''}</div>`;
}
function renderFeatureInspector(feature){
 const isSketch=feature.type==='extrude'||feature.type==='pocket',scale=currentSpec().scale??1;
 const profiles=isSketch?[feature.sketch,...(feature.contours??[])]:[],profile=profiles[Math.min(selectedContour,profiles.length-1)];
 $('#inspector').innerHTML=`<div class="inspector-heading">BEARBEITUNG ${selectedFeature+1}${icon(featureIcon(feature))}</div><div class="inspector-content"><h3>${esc(featureName(feature))}</h3>${isSketch?`${field('Höhe / Tiefe · alle Konturen','feature-depth',feature.depth*scale)}${feature.type==='pocket'?`<label class="locked-dimension"><input type="checkbox" data-feature-through-all ${feature.throughAll?'checked':''}> Durch alles ausschneiden</label>`:''}${profileSelector(profiles)}<div class="section-title">SKIZZE · ${sketchName(profile.kind).toUpperCase()}</div>${isRadial(profile.kind)?field('Radius','feature-radius',profile.radius*scale):`${field('Breite','feature-width',profile.width*scale)}${field('Höhe','feature-height',profile.height*scale)}`}${profile.kind==='polygon'?field('Seiten','feature-sides',profile.sides,''):''}${field('Winkel','feature-angle',profile.angle??0,'°')}${placementFields(profile.constraints,feature.supportRectangle??true,'feature',scale,profile.distanceReference)}<div class="fields-2">${field('Mitte U','feature-u',profile.center[0]*scale)}${field('Mitte V','feature-v',profile.center[1]*scale)}</div>`:field(feature.type==='shell'?'Wandstärke':feature.type==='fillet'?'Radius':'Fasenmaß','feature-size',(feature.thickness??feature.radius??feature.distance)*scale)}<button class="primary" data-action="apply-feature">${icon('check')}Änderung übernehmen</button><button class="subtle-button" data-action="show-body">Zurück zum Körper</button><p class="tip">Die folgenden Modellschritte werden mit deinen neuen Maßen erneut berechnet.</p></div>`;
 syncPlacementControls();
}
function inputNumber(key){const el=$(`[data-field="${key}"]`);const n=Number(el?.value);if(!el||!el.value||!Number.isFinite(n))throw new Error('Bitte gültige Zahlen eintragen.');return n;}
async function applyDimensions(){
 try{
  const next=clone(project),spec=next.objects.find(o=>o.id===selectedId);
  spec.name=$('[data-field="body-name"]').value.trim()||'Körper';
  for(const [key] of SHAPES[spec.kind]?.fields||[])spec.params[key]=inputNumber(key);
  if(spec.kind==='profile'){
   spec.params.height=inputNumber('height');const profile=[spec.profile,...(spec.contours??[])][selectedContour];profile.role=$('[data-field="profile-role"]').value;
   if(spec.contours)profile.center=[inputNumber('profile-u'),inputNumber('profile-v')];
   for(const key of isRadial(profile.kind)?['radius']:['width','height'])profile[key]=inputNumber('profile-'+key);
   if(profile.kind==='polygon')profile.sides=inputNumber('profile-sides');profile.angle=inputNumber('profile-angle');
  }
  if(spec.kind==='boolean')for(const [i,operand] of spec.operands.entries()){
   for(const [key] of SHAPES[operand.kind]?.fields||[])operand.params[key]=inputNumber('operand-'+i+'-'+key);
   operand.position=['x','y','z'].map(axis=>inputNumber('operand-'+i+'-'+axis));
  }
  spec.rotation=['x','y','z'].map(d=>inputNumber('rotation-'+d));spec.scale=inputNumber('scale');
  spec.position=['x','y','z'].map(d=>inputNumber('position-'+d));
  await commit(next,{message:'Maße übernommen'});
 }catch(e){toast(e.message,true);}
}
async function applyFeature(){
 try{
  const next=clone(project),f=next.objects.find(o=>o.id===selectedId).features[selectedFeature],scale=currentSpec().scale??1;
  if(f.type==='extrude'||f.type==='pocket'){
   const profile=[f.sketch,...(f.contours??[])][selectedContour];
   profile.role=$('[data-field="profile-role"]').value;
   profile.angle=inputNumber('feature-angle');if(profile.kind==='polygon')profile.sides=inputNumber('feature-sides');
   profile.constraints=readPlacement('feature',scale);profile.distanceReference=$('[data-distance-reference]').value;
   f.throughAll=f.type==='pocket'&&!!$('[data-feature-through-all]')?.checked;f.depth=inputNumber('feature-depth')/scale;profile.center=[inputNumber('feature-u')/scale,inputNumber('feature-v')/scale];
   if(isRadial(profile.kind))profile.radius=inputNumber('feature-radius')/scale;else{profile.width=inputNumber('feature-width')/scale;profile.height=inputNumber('feature-height')/scale;}
  }else if(f.type==='shell')f.thickness=inputNumber('feature-size')/scale;else if(f.type==='fillet')f.radius=inputNumber('feature-size')/scale;else f.distance=inputNumber('feature-size')/scale;
  await commit(next,{message:'Bearbeitung geändert'});
 }catch(e){toast(e.message,true);}
}
async function applyShell(){
 if(busy||!selectedFace||!currentSpec())return;
 try{const next=clone(project),spec=next.objects.find(o=>o.id===selectedId);spec.features.push({type:'shell',closed:$('#shell-closed').checked,face:selectedFace.id,reference:selectedFace.reference,thickness:inputNumber('shell-thickness')/(spec.scale??1)});if(await commit(next,{message:'Körper ausgehöhlt · Wandstärke im Verlauf änderbar'})){selectedFace=null;renderPanels();renderSelection();}}catch(e){toast(e.message,true);}
}
async function applyEdge(){
 if(!selectedEdges.size||!currentSpec())return;
 try{const next=clone(project),spec=next.objects.find(o=>o.id===selectedId);const feature={type:tool,edges:[...selectedEdges],references:[...selectedEdges].map(id=>currentModel().edges.find(e=>e.id===id)?.reference)};feature[tool==='fillet'?'radius':'distance']=inputNumber('edge-size')/(spec.scale??1);spec.features.push(feature);if(await commit(next,{message:tool==='fillet'?'Kanten abgerundet':'Kanten angefast'}))setTool('select');}catch(e){toast(e.message,true);}
}
function updateToolButtons(){
 $$('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);});
 $('#mode-pill').textContent=sketch?(sketchName(sketch.kind)+' aufziehen oder Maße eingeben'):tool==='fillet'?'Kanten für die Rundung auswählen':tool==='chamfer'?'Kanten für die Fase auswählen':tool==='move'?'Körper auf der XY-Ebene verschieben':'Körper oder Fläche auswählen';
 renderer.domElement.style.cursor=sketch?'crosshair':tool==='move'?'move':tool==='fillet'||tool==='chamfer'?'crosshair':'default';
}
function setTool(next){
 if(busy)return;
 if(next==='sketch'){startSketch();return;}
 if(sketch&&!cancelSketch())return;tool=next;selectedEdges.clear();hoverEdge=null;selectedFeature=-1;renderSelection();renderInspector();updateToolButtons();
}
function startSketch(){
 if(busy||sketch)return;
 if(!selectedFace?.planar){toast('Klicke zuerst eine ebene Fläche am Bauteil an.');return;}
 beginSketch(clone(selectedFace),false);
}
function startPlaneSketch(){
 if(busy||sketch)return;
 beginSketch({id:0,origin:[0,0,0],normal:[0,0,1],u:[1,0,0],v:[0,1,0]},true);
}
function beginSketch(face,standalone){
 draftBase={projectId:activeProjectId,revision:projectRevision,project:clone(project)};draftId=null;draftSourceId=null;lastDraftSignature='';draftPersisted=true;
 sketch={face,standalone,kind:'rectangle',center:[0,0],width:10,height:10,radius:5,sides:6,angle:0,depth:10,snap:1,hasDrawn:false,locks:{},invalid:{},constraints:{},distanceReference:'outline',role:'solid',throughAll:false,profiles:[],activeContour:0};tool='sketch';sketch.profiles=[captureContour()];
 savedCamera={position:camera.position.clone(),up:camera.up.clone(),target:controls.target.clone(),height:viewHeight,zoom:camera.zoom};
 const origin=vec(face.origin),normal=vec(face.normal);camera.position.copy(origin).addScaledVector(normal,200);camera.up.copy(vec(face.v));camera.lookAt(origin);controls.target.copy(origin);controls.enableRotate=false;controls.mouseButtons.RIGHT=THREE.MOUSE.PAN;
 const aspect=viewport.clientWidth/viewport.clientHeight;viewHeight=Math.max((currentModel()?vec(currentModel().bounds.max).sub(vec(currentModel().bounds.min)).length():60)*1.2/Math.min(aspect,1),40);camera.zoom=1;resize();controls.update();
 grid.visible=false;axes.visible=false;$('#navigation-hint').textContent='Links ziehen: zeichnen · Rechts ziehen: verschieben · Esc: Skizze beenden';
 $('#welcome').hidden=true;renderSelection();renderSketchInspector();updateToolButtons();drawSketch();
}
function cancelSketch({discard=false}={}){
 if(!sketch)return true;
 clearTimeout(draftTimer);
 if(discard){try{if(draftId)drafts.remove(draftId);if(draftSourceId)drafts.remove(draftSourceId);}catch(error){toast('Alte Entwurfssicherung konnte nicht entfernt werden. Sie bleibt zur Wiederherstellung erhalten.',true);}}
 else if(!persistSketchDraft())return false;
 draftBase=null;draftId=null;draftSourceId=null;lastDraftSignature='';draftPersisted=true;
 sketch=null;for(const {label} of dimensionInputs.values())label.hidden=true;tool='select';disposeGroup(sketchRoot);measureLabel.hidden=true;
 controls.enableRotate=true;controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;grid.visible=true;axes.visible=true;
 if(savedCamera){camera.position.copy(savedCamera.position);camera.up.copy(savedCamera.up);controls.target.copy(savedCamera.target);viewHeight=savedCamera.height;camera.zoom=savedCamera.zoom;resize();camera.lookAt(controls.target);savedCamera=null;}
 controls.update();$('#navigation-hint').innerHTML='Rechts ziehen: drehen <b>·</b> Mausrad: zoomen <b>·</b> Mitte: verschieben';
 renderSelection();renderPanels();updateToolButtons();return true;
}
function captureSketchDraft(){
 saveContour();return validateDraft({version:1,standalone:sketch.standalone,bodyId:sketch.standalone?null:selectedId,face:clone(sketch.face),profiles:clone(sketch.profiles),activeContour:sketch.activeContour,depth:sketch.depth,snap:sketch.snap,throughAll:sketch.throughAll});
}
function persistSketchDraft(){
 clearTimeout(draftTimer);if(!sketch||!draftBase)return true;
 try{
  const data=captureSketchDraft(),signature=JSON.stringify(data);
  if(signature===lastDraftSignature&&draftPersisted)return true;
  if(!data.profiles.some(p=>p.hasDrawn)){
   if(draftId)drafts.remove(draftId);if(draftSourceId)drafts.remove(draftSourceId);
   draftId=null;draftSourceId=null;lastDraftSignature=signature;draftPersisted=true;return true;
  }
  const saved=drafts.save(draftBase,data,draftId);draftId=saved.id;lastDraftSignature=signature;draftPersisted=true;
  $('#autosave-status').textContent='Modell und Skizzenentwurf im Browser gesichert';return true;
 }catch(error){draftPersisted=false;$('#autosave-status').textContent='Skizzenentwurf ungesichert · als Datei speichern';toast(error.message,true);return false;}
}
function queueSketchDraft(){
 if(!sketch||!draftBase)return;clearTimeout(draftTimer);draftPersisted=false;draftTimer=setTimeout(persistSketchDraft,150);
}
function restoreSketchDraft(record){
 const data=validateDraft(record.draft);if(sketch&&!cancelSketch())throw new Error('Bitte den aktuellen Entwurf zuerst als Datei sichern oder ausdrücklich verwerfen.');
 let face={id:0,origin:[0,0,0],normal:[0,0,1],u:[1,0,0],v:[0,1,0]};
 if(!data.standalone){
  const model=models.find(m=>m.id===data.bodyId),faces=model?.faces.filter(f=>f.planar&&sameReference(f.reference,data.face.reference))||[];
  if(faces.length!==1)throw new Error('Die Bezugsfläche des Entwurfs ist nicht eindeutig. Die Sicherung bleibt erhalten.');
  face=clone(faces[0]);selectObject(data.bodyId,face);
 }
 beginSketch(face,data.standalone);
 sketch.profiles=clone(data.profiles);sketch.activeContour=data.activeContour;
 Object.assign(sketch,clone(sketch.profiles[data.activeContour]),{depth:data.depth,snap:data.snap,throughAll:data.throughAll});
 draftSourceId=record.id||null;draftId=record.owner===drafts.owner?record.id:null;
 renderSketchInspector();drawSketch();updateToolButtons();persistSketchDraft();toast('Skizzenentwurf wiederhergestellt');
}
function restorePreferredDraft(){
 const saved=drafts.preferred(activeProjectId,projectRevision);if(!saved)return;
 try{restoreSketchDraft(saved);}catch(error){toast(error.message,true);}
}
async function openSketchDraft(id){
 if(busy)return;const saved=drafts.list().find(d=>d.id===id);if(!saved)return;
 try{
  const exists=library.list().some(e=>e.id===saved.projectId),entry=exists?library.read(saved.projectId):null;
  let ok;if(entry?.revision===saved.revision){if(sketch&&!cancelSketch())return;tool='select';ok=await commit(entry.project,{entry,record:false,fit:true});}
  else ok=await newProject(saved.project);
  if(ok){restoreSketchDraft(saved);$('#projects-dialog').close();}
 }catch(error){toast(error.message,true);}
}
window.addEventListener('beforeunload',event=>{
 const saved=persistSketchDraft();if(inspectorDirty||!saved){event.preventDefault();event.returnValue='';}
});
function renderSketchInspector(){
 if(!sketch)return;const s=sketch;
 const dimension=(label,key,value)=>`${skField(label,key,value)}<label class="locked-dimension"><input type="checkbox" data-lock="${key}" ${s.locks[key]?'checked':''}> Maß festhalten</label>`;
 $('#inspector').innerHTML=`<div class="inspector-heading">${s.standalone?'SKIZZE · XY-EBENE':'SKIZZE AUF FLÄCHE '+s.face.id}${icon('sketch')}</div><div class="inspector-content">${contourList()}<p class="tool-description">Kontur zeichnen oder Maße direkt eingeben.</p><div class="sketch-types">${['rectangle','circle','ellipse','polygon'].map(kind=>`<button data-sketch-kind="${kind}" class="${s.kind===kind?'active':''}">${sketchName(kind)}</button>`).join('')}</div><div class="sketch-status" id="sketch-status"></div>${isRadial(s.kind)?dimension('Radius','radius',s.radius):`<div class="fields-2"><div>${dimension('Breite','width',s.width)}</div><div>${dimension('Höhe','height',s.height)}</div></div>`}${s.kind==='circle'?skField('Durchmesser','diameter',s.radius*2):''}${s.kind==='polygon'?skField('Seiten','sides',s.sides,''):''}${skField('Winkel','angle',s.angle,'°')}${placementFields(s.constraints,!!s.face.sketchBounds,'sketch',1,s.distanceReference)}<div class="section-title">MITTELPUNKT</div><div class="fields-2">${skField('U','center-u',s.center[0])}${skField('V','center-v',s.center[1])}</div><hr class="divider">${skField('Höhe / Tiefe','depth',s.depth)}${s.standalone?'':`<label class="locked-dimension"><input type="checkbox" data-through-all ${s.throughAll?'checked':''}> Ausschneiden: Durch alles</label>`}<div class="action-duo"><button class="primary" data-action="extrude">${icon('extrude')}Aufbauen</button>${s.standalone?'':`<button class="subtle-button" data-action="pocket">${icon('cut')}Ausschneiden</button>`}</div><button class="subtle-button" data-action="cancel-sketch">Skizze verwerfen</button>${skField('Fangraster','snap',s.snap)}<p class="tip">Eingegebene Konturmaße bleiben beim Zeichnen fest. Fangraster 0 schaltet das Einrasten aus.</p></div>`;
 syncSketchInputs();
}
function skField(label,key,value,unit='mm'){return field(label,'sk-'+key,value,unit).replace(`data-field="sk-${key}"`,`data-sketch="${key}"`);}
function setSketchDimension(key,raw,input){
 if(!sketch||busy)return;const n=Number(raw),positive=['width','height','radius','diameter','depth'].includes(key);
 const valid=raw!==''&&Number.isFinite(n)&&Math.abs(n)<=10000&&(!positive||n>=.01)&&(!key.startsWith('distance-')||n>=0)&&(key!=='snap'||n>=0)&&(key!=='sides'||Number.isInteger(n)&&n>=3&&n<=64);
 sketch.invalid[key]=!valid;input?.setCustomValidity(valid?'':'Bitte ein gültiges Maß eingeben.');
 if(valid){
  if(key==='depth'||key==='snap')for(const p of sketch.profiles)p.invalid[key]=false;
  if(key==='radius'||key==='diameter'){sketch.invalid.radius=false;sketch.invalid.diameter=false;}
  if(key.startsWith('distance-')){const axis=key.at(-1);if(sketch.constraints[axis])sketch.constraints[axis].distance=n;}
  else if(key==='center-u'){sketch.center[0]=n;delete sketch.constraints.u;}else if(key==='center-v'){sketch.center[1]=n;delete sketch.constraints.v;}else if(key==='diameter')sketch.radius=n/2;else sketch[key]=n;
  if(['width','height','radius','diameter'].includes(key))sketch.locks[key==='diameter'?'radius':key]=true;
  if(key!=='snap'&&key!=='depth')sketch.hasDrawn=true;
 }
 syncSketchInputs();drawSketch();
}
function syncSketchInputs(){
 if(!sketch)return;applySketchPosition();saveContour();const values={...sketch,'distance-u':sketch.constraints.u?.distance??0,'distance-v':sketch.constraints.v?.distance??0,diameter:sketch.radius*2,'center-u':sketch.center[0],'center-v':sketch.center[1]},invalid=sketch.profiles.some(p=>Object.values(p.invalid).some(Boolean));
 $$('[data-sketch]').forEach(el=>{if(document.activeElement!==el&&!sketch.invalid[el.dataset.sketch])el.value=Math.round(values[el.dataset.sketch]*1000)/1000;});
 $$('[data-lock]').forEach(el=>el.checked=!!sketch.locks[el.dataset.lock]);
 for(const axis of ['u','v']){const el=$(`[data-sketch="center-${axis}"]`);if(el)el.disabled=!!sketch.constraints[axis];}
 syncPlacementControls();
 const status=$('#sketch-status');if(status){status.classList.toggle('ready',sketch.hasDrawn&&!invalid);status.textContent=invalid?'Bitte ungültige Maße korrigieren':sketch.hasDrawn?'Kontur bereit · Maße anpassbar':'Mit gedrückter linker Maustaste aufziehen';}
 $$('[data-action="extrude"],[data-action="pocket"]').forEach(b=>b.disabled=!sketch.profiles.some(p=>p.hasDrawn)||invalid||busy);
}
function toSketchWorld(u,v,lift=.06){return vec(sketch.face.origin).addScaledVector(vec(sketch.face.u),u).addScaledVector(vec(sketch.face.v),v).addScaledVector(vec(sketch.face.normal),lift);}
function drawSketch(){
 disposeGroup(sketchRoot);measureLabel.hidden=true;for(const {label} of dimensionInputs.values())label.hidden=true;if(!sketch)return;
 queueSketchDraft();
 const s=sketch,origin=vec(s.face.origin),u=vec(s.face.u),v=vec(s.face.v),normal=vec(s.face.normal);
 const model=currentModel();const size=Math.max(model?vec(model.bounds.max).sub(vec(model.bounds.min)).length():60,40);const gridStep=s.snap>0?Math.max(s.snap,1):5;
 const gridPoints=[];const extent=Math.min(Math.ceil(size/gridStep),100)*gridStep;
 for(let t=-extent;t<=extent;t+=gridStep){gridPoints.push(toSketchWorld(t,-extent,.025),toSketchWorld(t,extent,.025),toSketchWorld(-extent,t,.025),toSketchWorld(extent,t,.025));}
 for(const guide of s.guides||[]){const pts=guide.axis===0?[toSketchWorld(guide.value,-extent),toSketchWorld(guide.value,extent)]:[toSketchWorld(-extent,guide.value),toSketchWorld(extent,guide.value)];const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:0xf0a442,dashSize:1,gapSize:.6,depthTest:false}));line.computeLineDistances();sketchRoot.add(line);}
 const g=new THREE.BufferGeometry().setFromPoints(gridPoints);sketchRoot.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0x79aba3,transparent:true,opacity:.13,depthTest:false})));
 for(const [i,profile] of s.profiles.entries())if(i!==s.activeContour&&profile.hasDrawn){
  const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(contourPoints(profile)),new THREE.LineBasicMaterial({color:profile.role==='hole'?0xd78835:0x579aab,depthTest:false}));line.renderOrder=21;sketchRoot.add(line);
 }
 if(!s.hasDrawn)return;
 let points=[];const [cu,cv]=s.center,angle=s.angle*Math.PI/180;
 const point=(x,y)=>toSketchWorld(cu+x*Math.cos(angle)-y*Math.sin(angle),cv+x*Math.sin(angle)+y*Math.cos(angle));
 if(s.kind==='rectangle')points=[[-s.width/2,-s.height/2],[s.width/2,-s.height/2],[s.width/2,s.height/2],[-s.width/2,s.height/2]].map(([x,y])=>point(x,y));
 else {const count=s.kind==='polygon'?s.sides:96;for(let i=0;i<count;i++){const a=i*Math.PI*2/count+(s.kind==='polygon'?Math.PI/2:0);points.push(point(Math.cos(a)*(s.kind==='ellipse'?s.width/2:s.radius),Math.sin(a)*(s.kind==='ellipse'?s.height/2:s.radius)));}}
 const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:s.role==='hole'?0xd78835:0x008c7b,depthTest:false}));line.renderOrder=20;sketchRoot.add(line);
 const center=toSketchWorld(cu,cv),fillPositions=[];
 for(let i=0;i<points.length;i++)fillPositions.push(...center.toArray(),...points[i].toArray(),...points[(i+1)%points.length].toArray());
 const fillGeom=new THREE.BufferGeometry();fillGeom.setAttribute('position',new THREE.Float32BufferAttribute(fillPositions,3));const fill=new THREE.Mesh(fillGeom,new THREE.MeshBasicMaterial({color:0x1cb79e,transparent:true,opacity:.16,depthTest:false,side:THREE.DoubleSide,depthWrite:false}));fill.renderOrder=19;sketchRoot.add(fill);
 const offset=viewHeight/camera.zoom/viewport.clientHeight*32;
 if(isRadial(s.kind))sketchDimension(point(s.kind==='circle'?-s.radius:0,0),point(s.radius,0),s.kind==='circle'?'diameter':'radius',s.kind==='circle'?s.radius*2:s.radius);
 else {sketchDimension(point(-s.width/2,-s.height/2-offset),point(s.width/2,-s.height/2-offset),'width',s.width);sketchDimension(point(s.width/2+offset,-s.height/2),point(s.width/2+offset,s.height/2),'height',s.height);}
 drawPlacementDimensions();

}
function pointerRay(event){const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);camera.updateMatrixWorld();raycaster.setFromCamera(pointer,camera);return raycaster.ray;}
function sketchPoint(event,snap=true){
 if(!sketch)return null;const ray=pointerRay(event);const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(vec(sketch.face.normal),vec(sketch.face.origin));const hit=new THREE.Vector3();if(!ray.intersectPlane(plane,hit))return null;
 const diff=hit.sub(vec(sketch.face.origin));let u=diff.dot(vec(sketch.face.u)),v=diff.dot(vec(sketch.face.v));
 sketch.guides=[];sketch.suggestion='';
 if(snap&&!event.altKey){
  const tolerance=viewHeight/camera.zoom/viewport.clientHeight*7;
  const proposal=suggestPoint([u,v],{profiles:sketch.profiles.filter((_,i)=>i!==sketch.activeContour),bounds:sketch.face.sketchBounds,tolerance});
  [u,v]=proposal.point;sketch.guides=proposal.guides;
  if(sketch.snap>0){if(!proposal.guides.some(g=>g.axis===0))u=Math.round(u/sketch.snap)*sketch.snap;if(!proposal.guides.some(g=>g.axis===1))v=Math.round(v/sketch.snap)*sketch.snap;}
  sketch.suggestion=proposal.guides.map(g=>g.label+' · '+(g.axis===0?'vertikal':'horizontal')).join(' / ');
 }
 return [u,v];
}
function pickBody(event){pointerRay(event);return raycaster.intersectObjects(bodyMeshes,false)[0]||null;}
function pickEdge(event){
 pointerRay(event);raycaster.params.Line.threshold=viewHeight/camera.zoom/viewport.clientHeight*6;
 const bodyHit=raycaster.intersectObjects(bodyMeshes,false)[0];
 return raycaster.intersectObjects(edgeLines,false).find(hit=>!bodyHit||hit.distance<bodyHit.distance+raycaster.params.Line.threshold*2)||null;
}
async function applySketch(type){
 if(!sketch||busy)return;saveContour();
 if(!sketch.profiles.some(p=>p.hasDrawn)||sketch.profiles.some(p=>Object.values(p.invalid).some(Boolean)))return;
 const s=clone(sketch),next=clone(project),spec=next.objects.find(o=>o.id===selectedId),scale=s.standalone?1:(spec.scale??1);
 const profiles=s.profiles.filter(p=>p.hasDrawn).map(p=>{
  const profile={kind:p.kind,center:p.center.map(v=>v/scale),angle:p.angle,role:p.role,distanceReference:p.distanceReference};
  if(!s.standalone)profile.constraints=Object.fromEntries(Object.entries(p.constraints).map(([axis,c])=>[axis,{...c,...(c.mode==='center'?{}:{distance:c.distance/scale})}]));
  if(!isRadial(p.kind)){profile.width=p.width/scale;profile.height=p.height/scale;}else {profile.radius=p.radius/scale;if(p.kind==='polygon')profile.sides=p.sides;}
  return profile;
 });
 const [profile,...contours]=profiles;
 if(s.standalone)next.objects.push({id:uid(),name:sketchName(profile.kind),kind:'profile',profile,contours,plane:'XY',params:{height:s.depth},position:[0,0,0],features:[],color:'#67aba9'});
 else spec.features.push({type,face:s.face.id,reference:s.face.reference,sketch:profile,contours,depth:s.depth/scale,...(type==='pocket'?{throughAll:s.throughAll}:{})});
 // A failed operation keeps the editable sketch and all prior geometry.
 const ok=await commit(next,{fromSketch:true,message:type==='extrude'?'Skizze aufgebaut':'Tasche ausgeschnitten'});
 if(ok){cancelSketch({discard:true});selectedFace=null;if(s.standalone)selectObject(next.objects.at(-1).id);renderSelection();renderPanels();renderProjectList();}
 else{sketch=s;tool='sketch';selectedFace=s.face;renderSketchInspector();renderSelection();drawSketch();updateToolButtons();}
}

renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('pointerdown',event=>{
 if(event.button!==0||busy)return;
 lastPointer={x:event.clientX,y:event.clientY};
 if(sketch){const point=sketchPoint(event);if(point){drag={kind:'sketch',start:point};renderer.domElement.setPointerCapture(event.pointerId);}return;}
 if(tool==='move'){
  const hit=pickBody(event);if(!hit)return;selectObject(hit.object.userData.body);
  const spec=currentSpec(),plane=new THREE.Plane(new THREE.Vector3(0,0,1),-(spec.position?.[2]||0)),start=new THREE.Vector3();pointerRay(event).intersectPlane(plane,start);
  drag={kind:'move',plane,start,position:clone(spec.position||[0,0,0]),delta:new THREE.Vector3()};renderer.domElement.setPointerCapture(event.pointerId);
 }
});
renderer.domElement.addEventListener('pointermove',event=>{
 if(busy)return;
 if(drag?.kind==='sketch'&&sketch){
  const point=sketchPoint(event);if(!point)return;
  const [a,b]=drag.start,[c,d]=point;
  if(!isRadial(sketch.kind)){const bounds=draggedProfileBounds(drag.start,point,sketch,event.altKey?null:viewHeight/camera.zoom/viewport.clientHeight*7);sketch.width=bounds.width;sketch.height=bounds.height;sketch.center=bounds.center;if(bounds.equalSides)sketch.suggestion=sketch.kind==='ellipse'?'Kreis · gleiche Achsen':'Quadrat · gleiche Seiten';}
  else{sketch.center=[a,b];if(!sketch.locks.radius)sketch.radius=Math.max(Math.hypot(c-a,d-b),.01);}
  if(!event.altKey){
   const tolerance=viewHeight/camera.zoom/viewport.clientHeight*7,others=sketch.profiles.filter((p,i)=>i!==sketch.activeContour&&p.hasDrawn);
   if(isRadial(sketch.kind)&&!sketch.locks.radius){const radius=suggestSize(sketch.radius,others.filter(p=>isRadial(p.kind)).map(p=>p.radius),tolerance);if(radius!=null){sketch.radius=radius;sketch.suggestion='Gleicher Radius · '+fmt(radius)+' mm';}}
  }
  $('#mode-pill').textContent=sketch.suggestion?sketch.suggestion+' · Alt: frei':'Kontur aufziehen · Alt: ohne Fanghilfen';
  sketch.hasDrawn=!isRadial(sketch.kind)?sketch.width>.05&&sketch.height>.05:sketch.radius>.05;syncSketchInputs();drawSketch();return;
 }
 if(drag?.kind==='move'){
  const hit=new THREE.Vector3();if(!pointerRay(event).intersectPlane(drag.plane,hit))return;const delta=hit.sub(drag.start);delta.x=Math.round(delta.x);delta.y=Math.round(delta.y);delta.z=0;drag.delta.copy(delta);groups.get(selectedId)?.position.copy(delta);return;
 }
 if(tool==='fillet'||tool==='chamfer'){
  const hit=pickEdge(event),next=hit?{body:hit.object.userData.body,id:hit.object.userData.edge}:null;
  if(next?.id!==hoverEdge?.id||next?.body!==hoverEdge?.body){hoverEdge=next;renderSelection();}
 }
});
renderer.domElement.addEventListener('pointerup',async event=>{
 if(event.button!==0)return;
 const moved=lastPointer?Math.hypot(event.clientX-lastPointer.x,event.clientY-lastPointer.y):0;
 if(drag?.kind==='sketch'){drag=null;syncSketchInputs();return;}
 if(drag?.kind==='move'){
  const movement=drag;drag=null;if(movement.delta.length()>.05){const next=clone(project);next.objects.find(o=>o.id===selectedId).position=movement.position.map((p,i)=>p+movement.delta.getComponent(i));if(!await commit(next,{message:'Körper verschoben'}))groups.get(selectedId)?.position.set(0,0,0);}return;
 }
 if(busy||sketch||moved>5)return;
 if(tool==='fillet'||tool==='chamfer'){
  const hit=pickEdge(event);if(!hit)return;const id=hit.object.userData.body,edge=hit.object.userData.edge;
  if(id!==selectedId){selectedId=id;selectedBodies=new Set([id]);selectedEdges.clear();renderBodies();}
  selectedEdges.has(edge)?selectedEdges.delete(edge):selectedEdges.add(edge);selectedFace=null;renderSelection();renderPanels();return;
 }
 const hit=pickBody(event);
 if(hit){const model=hit.object.userData.model;const faceId=model.mesh.faceIds[hit.faceIndex];const face=model.faces.find(f=>f.id===faceId);selectObject(model.id,face?clone(face):null,event.shiftKey);}
 else selectObject(null);
});
renderer.domElement.addEventListener('dblclick',event=>{if(!sketch&&tool==='select'&&selectedFace?.planar)startSketch();});
renderer.domElement.addEventListener('pointercancel',()=>{drag=null;groups.get(selectedId)?.position.set(0,0,0);});
controls.addEventListener('change',()=>{if(sketch?.hasDrawn)drawSketch();});

async function addBody(kind){
 if(busy||!SHAPES[kind])return;if(sketch&&!cancelSketch())return;setTool('select');
 const next=clone(project),bounds=projectBounds(),definition=SHAPES[kind];
 const x=next.objects.length?bounds.max.x+25:0,count=next.objects.filter(o=>o.kind===kind).length+1;
 const obj={id:uid(),name:`${definition.name} ${String(count).padStart(2,'0')}`,kind,params:clone(definition.params),position:[x,0,0],features:[],color:definition.color};
 next.objects.push(obj);const previous=selectedId;selectedId=obj.id;if(!await commit(next,{fit:true,message:'Körper hinzugefügt'}))selectedId=previous;
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),20000);}
function safeName(){return (project.name||'Bauteil').replace(/[^\p{L}\p{N} _-]/gu,'').trim().slice(0,70)||'Bauteil';}
function saveProject(){
 const data=clone(project);if(sketch){saveContour();data.sketchDraft=captureSketchDraft();persistSketchDraft();}
 download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),safeName()+'.formraum.json');toast(sketch?'Projekt mit Skizzenentwurf gespeichert':'Projektdatei gespeichert');
}
async function exportModel(kind){
 if(busy)return;setBusy(true);$('#export-menu').hidden=true;
 try{const blob=await calculate(kind==='step'?'export_step':'export_stl',{project});download(blob,safeName()+'.'+kind);toast(`${kind.toUpperCase()} exportiert`);}catch(e){toast(e.message,true);}finally{setBusy(false);}
}
async function openFile(file){
 if(!file||busy)return;
 if(file.size>25*1024*1024){toast('Bitte eine Datei bis 25 MB auswählen.',true);return;}
 if(sketch&&!cancelSketch())return;tool='select';
 try{
  if(/\.(stp|step)$/i.test(file.name)){
   if(busy)return;setBusy(true);
   const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
   const result=await calculate('import_step',{base64,filename:file.name});
   setBusy(false);result.project.name=file.name.replace(/\.(step|stp)$/i,'');await newProject(result.project);
  }else{
   const data=JSON.parse(await file.text());if(!Array.isArray(data.objects))throw new Error('Diese Datei ist kein Formraum-Projekt.');
   const savedDraft=data.sketchDraft?validateDraft(data.sketchDraft):null;delete data.sketchDraft;
   if(await newProject(data)&&savedDraft)restoreSketchDraft({draft:savedDraft});
  }
 }catch(e){setBusy(false);toast(e.message||'Datei konnte nicht geöffnet werden.',true);}
}
async function undo(){
 if(busy||!undoStack.length)return;if(sketch&&!cancelSketch())return;
 const target=undoStack[undoStack.length-1],previous=clone(project);if(await commit(target,{record:false})){undoStack.pop();redoStack.push(previous);updateUndo();}
}
async function redo(){
 if(busy||!redoStack.length)return;if(sketch&&!cancelSketch())return;
 const target=redoStack[redoStack.length-1],previous=clone(project);if(await commit(target,{record:false})){redoStack.pop();undoStack.push(previous);updateUndo();}
}

document.addEventListener('click',async event=>{
 const button=event.target.closest('button');
 if(button?.disabled)return;
 if(button?.dataset.backupDamaged!==undefined){const e=library.damaged()[Number(button.dataset.backupDamaged)];if(e)download(new Blob([e.raw],{type:'application/json'}),'Formraum-beschaedigte-Sicherung.json');return;}
 if(button?.dataset.restoreDraft){await openSketchDraft(button.dataset.restoreDraft);return;}
 if(button?.dataset.openSaved){await openSaved(button.dataset.openSaved);return;}
 if(button?.dataset.duplicateProject){const entry=library.read(button.dataset.duplicateProject);if(entry){entry.project.name=(entry.project.name||'Projekt')+' Kopie';await newProject(entry.project);}return;}
 if(button?.dataset.deleteProject){const entry=library.read(button.dataset.deleteProject);if(entry&&entry.id!==activeProjectId&&confirm(`Projekt „${entry.project.name}“ aus dem Browser löschen?`)){try{await library.remove(entry.id,entry.revision);renderProjectList();}catch(e){toast(e.message,true);}}return;}
 if(button?.dataset.tool){setTool(button.dataset.tool);return;}
 if(button?.dataset.view){setView(button.dataset.view);return;}
 if(button?.dataset.export){exportModel(button.dataset.export);return;}
 if(button?.dataset.visibility){
  const next=clone(project),spec=next.objects.find(o=>o.id===button.dataset.visibility);spec.visible=spec.visible===false;await commit(next);return;
 }
 if(event.target.dataset.multiBody){if(sketch&&!cancelSketch())return;selectObject(event.target.dataset.multiBody,null,true);return;}
 if(button?.dataset.addShape){addBody(button.dataset.addShape);return;}
 if(button?.dataset.combine){combineSelected(button.dataset.combine);return;}
 if(button?.dataset.align){alignSelected(button.dataset.align);return;}
 if(button?.dataset.bodyRole){const next=clone(project);next.objects.find(o=>o.id===selectedId).hole=button.dataset.bodyRole==='hole';await commit(next);return;}
 const row=event.target.closest('[data-body]');if(row){if(sketch&&!cancelSketch())return;setTool('select');selectObject(row.dataset.body,null,event.shiftKey);return;}
 if(button?.dataset.removeFeature!==undefined){
  const next=clone(project),features=next.objects.find(o=>o.id===selectedId).features;const count=features.length-Number(button.dataset.removeFeature);features.splice(Number(button.dataset.removeFeature));await commit(next,{message:count>1?'Bearbeitung und nachfolgende Schritte entfernt · Strg Z zum Wiederherstellen':'Bearbeitung entfernt'});return;
 }
 const featureRow=event.target.closest('[data-feature]');if(featureRow){if(sketch&&!cancelSketch())return;tool='select';selectedFeature=Number(featureRow.dataset.feature);selectedContour=0;selectedFace=null;selectedEdges.clear();renderSelection();renderPanels();return;}
 if(button?.dataset.removeEdge){selectedEdges.delete(Number(button.dataset.removeEdge));renderSelection();renderInspector();return;}
 if(button?.dataset.contour!==undefined&&sketch){switchContour(Number(button.dataset.contour));return;}
 if(button?.dataset.contourRole&&sketch){sketch.role=button.dataset.contourRole;saveContour();renderSketchInspector();drawSketch();return;}
 if(button?.dataset.sketchKind&&sketch){sketch.kind=button.dataset.sketchKind;sketch.invalid={};applySketchPosition();renderSketchInspector();drawSketch();updateToolButtons();return;}
 switch(button?.dataset.action){
  case 'add-contour':addContour(false);break;
  case 'duplicate-contour':addContour(true);break;
  case 'remove-contour':removeContour();break;
  case 'center-sketch':if(sketch){sketch.constraints={u:{mode:'center'},v:{mode:'center'}};sketch.invalid={};sketch.hasDrawn=true;renderSketchInspector();drawSketch();}break;
  case 'release-position':if(sketch){sketch.constraints={};sketch.invalid['distance-u']=false;sketch.invalid['distance-v']=false;renderSketchInspector();drawSketch();}break;
  case 'apply-dimensions':applyDimensions();break;
  case 'duplicate-body':duplicateSelected();break;
  case 'ground-body':groundSelected();break;
  case 'ungroup':ungroupSelected();break;
  case 'start-sketch':startSketch();break;
  case 'apply-shell':applyShell();break;
  case 'apply-edge':applyEdge();break;
  case 'cancel-tool':setTool('select');break;
  case 'cancel-sketch':cancelSketch({discard:true});renderProjectList();break;
  case 'extrude':applySketch('extrude');break;
  case 'pocket':applySketch('pocket');break;
  case 'show-body':selectedFeature=-1;renderPanels();break;
  case 'apply-feature':applyFeature();break;
  case 'delete-body':{if(!currentSpec()||busy)return;const next=clone(project);next.objects=next.objects.filter(o=>o.id!==selectedId);await commit(next,{message:'Körper gelöscht · Strg Z zum Wiederherstellen'});break;}
 }
 if(!event.target.closest('.export-wrap'))$('#export-menu').hidden=true;
});
$('#inspector').addEventListener('input',event=>{
 if(!sketch&&!event.target.matches('[data-profile-select]'))inspectorDirty=true;
 if(event.target.dataset.field==='edge-size'){const n=Number(event.target.value);if(Number.isFinite(n)&&n>0)edgeSize=n;}
 if(event.target.hasAttribute('data-through-all')&&sketch){sketch.throughAll=event.target.checked;queueSketchDraft();return;}
 if(event.target.hasAttribute('data-distance-reference')){if(sketch){sketch.distanceReference=event.target.value;syncSketchInputs();drawSketch();}return;}
 if(event.target.matches('[data-profile-select]')){selectedContour=Number(event.target.value);renderInspector();return;}
 if(event.target.dataset.placement){
  if(sketch){const axis=event.target.dataset.placement,mode=event.target.value;if(mode==='free')delete sketch.constraints[axis];else sketch.constraints[axis]={mode,...(mode==='center'?{}:{distance:0})};sketch.invalid['distance-'+axis]=false;sketch.hasDrawn=true;syncSketchInputs();drawSketch();}
  else syncPlacementControls();return;
 }
 if(!sketch)return;
 if(event.target.dataset.lock){sketch.locks[event.target.dataset.lock]=event.target.checked;queueSketchDraft();return;}
 if(event.target.dataset.sketch)setSketchDimension(event.target.dataset.sketch,event.target.value,event.target);
});
$('#inspector').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('input')&&!sketch&&!busy){event.preventDefault();if(event.target.dataset.field==='edge-size')applyEdge();else if(event.target.dataset.field==='shell-thickness')applyShell();else selectedFeature>=0?applyFeature():applyDimensions();}});
$('#add-box').onclick=()=>addBody('box');$('#add-cylinder').onclick=()=>addBody('cylinder');
$('#shape-library').innerHTML=Object.entries(SHAPES).filter(([kind])=>!['box','cylinder'].includes(kind)).map(([kind,s])=>`<button data-add-shape="${kind}" title="${s.name}" aria-label="${s.name}"><img src="./shapes/${kind}.png" alt="" width="128" height="96" draggable="false">${s.name}</button>`).join('');
$('#plane-sketch').onclick=()=>startPlaneSketch();
$('#undo').onclick=undo;$('#redo').onclick=redo;$('#fit-view').onclick=()=>fitView();
$('#save-project').onclick=saveProject;$('#open-project').onclick=()=>$('#project-file').click();
$('#project-file').accept='.json,.formraum,.step,.stp';
$('#project-file').onchange=event=>{openFile(event.target.files[0]);event.target.value='';};
$('#export-menu-button').onclick=()=>$('#export-menu').hidden=!$('#export-menu').hidden;
$('#project-name').onchange=async event=>{const next=clone(project);next.name=event.target.value.trim()||'Mein Bauteil';if(!await commit(next))$('#project-name').value=project.name;};
$('#new-project').onclick=()=>newProject();
$('#project-library-new').onclick=()=>newProject();
$('#projects-button').onclick=()=>{renderProjectList();$('#projects-dialog').showModal();};
$$('[data-close-dialog]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
$('#dismiss-welcome').onclick=()=>{$('#welcome').hidden=true;try{localStorage.setItem('formraum.welcome','dismissed');}catch{}};
try{if(localStorage.getItem('formraum.welcome'))$('#welcome').hidden=true;}catch{}
$('#help').onclick=()=>$('#help-dialog').showModal();$$('#help-dialog .close-dialog').forEach(b=>b.onclick=()=>$('#help-dialog').close());
$('#help-dialog').addEventListener('click',event=>{if(event.target===$('#help-dialog'))$('#help-dialog').close();});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){if(sketch)cancelSketch();else setTool('select');$('#export-menu').hidden=true;return;}
 const editing=event.target.matches('input,textarea,select');
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();saveProject();return;}
 if(editing||document.querySelector('dialog[open]'))return;
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();return;}
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();return;}
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'){event.preventDefault();duplicateSelected();return;}
 if(event.key.toLowerCase()==='f')fitView();
 if(event.key.toLowerCase()==='v')setTool('select');
 if(event.key.toLowerCase()==='m')setTool('move');
 if(event.key.toLowerCase()==='s')startSketch();
 if(event.key==='Delete'&&currentSpec()){$('[data-action="delete-body"]')?.click();}
});

renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
async function init(){
 renderPanels();resize();setBusy(true);setStatus('CAD-Kern wird im Browser geladen …');
 try{
  await calculate('ready');setBusy(false);
  const entry=await library.initial(project);
  if(!await commit(entry.project,{entry,record:false,fit:true}))throw new Error(lastCommitError);
  sessionReady=true;
  if(library.damaged().length)toast('Beschädigte Sicherung gefunden. Über Projekte kannst du ihre Rohdaten sichern.',true);
  restorePreferredDraft();

 }catch(error){setBusy(false);setStatus('Start fehlgeschlagen · gespeicherte Projekte bleiben erhalten',false);toast(error.message,true);}
}
init();

// Offline caching is only enabled for the built application, never in development.
if(import.meta.env.PROD&&'serviceWorker' in navigator){
 navigator.serviceWorker.register(new URL('./sw.js',window.location.href)).then(async registration=>{
  const updateButton=$('#update-app');
  const offerUpdate=()=>{if(registration.waiting)updateButton.hidden=false;};
  offerUpdate();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',offerUpdate));
  updateButton.onclick=()=>{
   if(busy||sketch){toast('Bitte die laufende Bearbeitung zuerst beenden.');return;}
   navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});
   registration.waiting?.postMessage('ACTIVATE_UPDATE');
  };
  await navigator.serviceWorker.ready;
  const badge=$('.local-badge');if(badge)badge.title='Vollständig geladen · auch offline verfügbar';
 }).catch(()=>{const badge=$('.local-badge');if(badge)badge.title='Offline-Speicherung nicht verfügbar; die Anwendung funktioniert online.';});
}

function sessionState(){
 return {projectId:activeProjectId,revision:projectRevision,project:clone(project),selection:{bodyId:selectedId,bodyIds:[...selectedBodies],face:selectedFace,edges:[...selectedEdges]},geometry:models.map(({mesh,...model})=>model)};
}
setupSession({
 list:()=>library.list(),
 state:()=>{if(!sessionReady)throw new Error('Anwendung noch nicht bereit.');return sessionState();},
 async action(method,args){
  if(!sessionReady||busy||sketch||drag||inspectorDirty||document.activeElement?.matches('#inspector input, #inspector select, #project-name'))throw new Error('Browser ist beschäftigt oder Eingaben sind noch nicht übernommen. Bitte den aktuellen Schritt zuerst übernehmen oder abbrechen.');
  if(args.projectId!==activeProjectId||args.revision!==projectRevision)throw new Error('Projekt oder Revision hat sich geändert. Erst formraum_get_project erneut lesen.');
  const stored=library.read(activeProjectId);
  if(!stored||stored.revision!==projectRevision)throw new Error('Projekt wurde in einem anderen Tab geändert. Bitte zuerst im Browser neu öffnen.');
  let ok;
  if(method==='apply')ok=await commit(args.project,{fit:true,message:'KI-Änderung übernommen · Strg Z zum Rückgängigmachen'});
  else if(method==='open')ok=await openSaved(args.targetId);
  else if(method==='create')ok=await newProject({version:1,name:args.name,objects:[]});
  else if(method==='undo'){
   if(!undoStack.length)throw new Error('Kein Schritt zum Rückgängigmachen vorhanden.');
   const previousRevision=projectRevision;await undo();ok=projectRevision!==previousRevision;
  }else throw new Error('Unbekannte Aktion.');
  if(!ok)throw new Error(lastCommitError||'Aktion konnte nicht ausgeführt werden.');
  return sessionState();
 },
 view(){renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png').split(',')[1];},
});

function bodyParameterFields(spec){
 if(SHAPES[spec.kind])return '<div class="section-title">MASSE DES GRUNDKÖRPERS</div>'+SHAPES[spec.kind].fields.map(([key,label])=>field(label,key,spec.params[key]??SHAPES[spec.kind].params[key],['sides','teeth'].includes(key)?'':'mm')).join('');
 if(spec.kind==='boolean')return `<div class="section-title">AUSGANGSFORMEN · ${esc(({union:'Vereint',cut:'Ausgeschnitten',intersect:'Schnittmenge',hull:'Konvexe Hülle'})[spec.operation])}</div>`+spec.operands.map((o,i)=>`<details class="operand-editor"><summary>${esc(o.name||shapeName(o.kind))}</summary>${(SHAPES[o.kind]?.fields||[]).map(([key,label])=>field(label,'operand-'+i+'-'+key,o.params?.[key]??SHAPES[o.kind].params[key],['sides','teeth'].includes(key)?'':'mm')).join('')}<div class="fields-3">${['x','y','z'].map((axis,n)=>field(axis.toUpperCase(),'operand-'+i+'-'+axis,o.position?.[n]||0)).join('')}</div></details>`).join('');
 if(spec.kind==='profile'){const profiles=[spec.profile,...(spec.contours??[])],s=profiles[Math.min(selectedContour,profiles.length-1)];return `${profileSelector(profiles)}${spec.contours?field('Mitte U','profile-u',s.center?.[0]??0)+field('Mitte V','profile-v',s.center?.[1]??0):''}<div class="section-title">SKIZZE · ${esc(sketchName(s.kind))}</div>${isRadial(s.kind)?field('Radius','profile-radius',s.radius):field('Breite','profile-width',s.width)+field('Höhe','profile-height',s.height)}${s.kind==='polygon'?field('Seiten','profile-sides',s.sides,''):''}${field('Winkel','profile-angle',s.angle||0,'°')}${field('Aufbauhöhe','height',spec.params.height)}`;}
 return '<p class="tip">Die Grundform des Imports bleibt erhalten. Skizzen und Kantenbearbeitungen kannst du ergänzen.</p>';
}
function selectedSpecs(){return [currentSpec(),...project.objects.filter(o=>o.id!==selectedId&&selectedBodies.has(o.id))].filter(Boolean);}
function renderMultiInspector(){
 $('#inspector').innerHTML=`<div class="inspector-heading">${selectedBodies.size} KÖRPER AUSGEWÄHLT</div><div class="inspector-content"><h3>Zusammen bauen</h3><p class="muted">Basis: <strong>${esc(currentSpec()?.name)}</strong>. Ausrichten bezieht sich auf diesen zuerst ausgewählten Körper.</p><button class="primary" data-combine="auto">Gruppieren · Bohrungen abziehen</button><div class="body-actions"><button class="subtle-button" data-combine="union">Vereinen</button><button class="subtle-button" data-combine="cut">Von Basis abziehen</button></div><button class="subtle-button" data-combine="intersect">Schnittmenge</button><button class="subtle-button" data-combine="hull">Hull · konvexe Hülle</button><p class="tip">Hull verbindet auch getrennte Körper. Rundungen werden durch Facetten angenähert.</p><p class="tip">Die Ausgangsformen bleiben gespeichert. Das Ergebnis muss ein zusammenhängender Körper sein.</p><div class="section-title">AN DER BASIS AUSRICHTEN</div>${['x','y','z'].map(axis=>`<div class="alignment-row"><strong>${axis.toUpperCase()}</strong>${[['min','Anfang'],['center','Mitte'],['max','Ende']].map(([mode,label])=>`<button data-align="${axis}:${mode}">${label}</button>`).join('')}</div>`).join('')}<div class="body-actions"><button class="subtle-button" data-action="duplicate-body">Duplizieren</button><button class="subtle-button" data-action="ground-body">Auf Boden</button></div></div>`;
}
async function combineSelected(mode){
 if(busy||sketch)return;const sources=selectedSpecs();if(sources.length<2)return;
 let operation=mode,operands=clone(sources);
 if(mode==='auto'){
  const solids=operands.filter(o=>!o.hole),holes=operands.filter(o=>o.hole);
  if(!solids.length){toast('Mindestens einen festen Körper auswählen.',true);return;}
  if(holes.length){operation='cut';operands=[solids.length===1?solids[0]:{id:uid(),name:'Feste Körper',kind:'boolean',operation:'union',operands:solids,params:{},features:[],position:[0,0,0]},...holes];}
  else operation='union';
 }
 const next=clone(project),spec={id:uid(),name:({union:'Vereinigung',cut:'Ausschnitt',intersect:'Schnittmenge',hull:'Konvexe Hülle'})[operation],kind:'boolean',operation,operands,params:{},features:[],position:[0,0,0],color:currentSpec()?.color||'#67aba9'};
 next.objects=next.objects.filter(o=>!selectedBodies.has(o.id));next.objects.push(spec);const previous=selectedId;selectedId=spec.id;
 if(!await commit(next,{fit:true,message:'Körper kombiniert · Ausgangsformen bleiben bearbeitbar'}))selectedId=previous;
}
async function duplicateSelected(){
 if(busy||sketch||!selectedId)return;
 const next=clone(project),copies=selectedSpecs().map(o=>({...clone(o),id:uid(),name:o.name+' Kopie',position:(o.position||[0,0,0]).map((v,i)=>v+(i===0?5:0))}));
 next.objects.push(...copies);const previous=selectedId;selectedId=copies[0].id;if(!await commit(next,{fit:true,message:'Auswahl dupliziert'}))selectedId=previous;
}
async function groundSelected(){
 if(busy||sketch)return;const next=clone(project);
 for(const obj of next.objects.filter(o=>selectedBodies.has(o.id))){obj.position??=[0,0,0];obj.position[2]-=models.find(m=>m.id===obj.id).bounds.min[2];}
 await commit(next,{message:'Auf die Grundebene gesetzt'});
}
async function alignSelected(value){
 if(busy||sketch||selectedBodies.size<2)return;const [axis,mode]=value.split(':'),index='xyz'.indexOf(axis),base=currentModel();
 const coordinate=m=>mode==='center'?(m.bounds.min[index]+m.bounds.max[index])/2:m.bounds[mode][index];
 const next=clone(project);for(const obj of next.objects.filter(o=>selectedBodies.has(o.id)&&o.id!==selectedId)){obj.position??=[0,0,0];obj.position[index]+=coordinate(base)-coordinate(models.find(m=>m.id===obj.id));}
 const ids=[...selectedBodies];if(await commit(next,{message:'Auswahl ausgerichtet'})){selectedBodies=new Set(ids);renderBodies();renderPanels();}
}
async function ungroupSelected(){
 const spec=currentSpec();if(busy||spec?.kind!=='boolean'||spec.features?.length)return;
 const next=clone(project),scale=spec.scale??1,toEuler=angles=>new THREE.Euler(...angles.map(v=>v*Math.PI/180),'ZYX');
 const parentQ=new THREE.Quaternion().setFromEuler(toEuler(spec.rotation??[0,0,0]));
 const children=spec.operands.map(source=>{
  const obj=clone(source),position=vec(obj.position??[0,0,0]).multiplyScalar(scale).applyQuaternion(parentQ).add(vec(spec.position??[0,0,0]));
  const rotation=new THREE.Euler().setFromQuaternion(parentQ.clone().multiply(new THREE.Quaternion().setFromEuler(toEuler(obj.rotation??[0,0,0]))),'ZYX');
  return {...obj,id:uid(),position:position.toArray(),rotation:[rotation.x,rotation.y,rotation.z].map(v=>v*180/Math.PI),scale:(obj.scale??1)*scale};
 });
 next.objects=next.objects.filter(o=>o.id!==spec.id);next.objects.push(...children);await commit(next,{fit:true,message:'Ausgangsformen wiederhergestellt'});
}

function sketchDimension(a,b,key,value){
 const {label,input}=dimensionInputs.get(key),middle=a.clone().add(b).multiplyScalar(.5);
 const direction=b.clone().sub(a).normalize(),tick=direction.clone().cross(vec(sketch.face.normal)).multiplyScalar(viewHeight/camera.zoom/viewport.clientHeight*5);
 const geom=new THREE.BufferGeometry().setFromPoints([a,b,a.clone().sub(tick),a.clone().add(tick),b.clone().sub(tick),b.clone().add(tick)]);
 const lines=new THREE.LineSegments(geom,new THREE.LineBasicMaterial({color:0x276c89,depthTest:false}));lines.renderOrder=30;sketchRoot.add(lines);
 middle.project(camera);label.hidden=false;label.style.left=`${Math.max(50,Math.min(viewport.clientWidth-50,(middle.x+1)/2*viewport.clientWidth))}px`;label.style.top=`${Math.max(30,Math.min(viewport.clientHeight-30,(1-middle.y)/2*viewport.clientHeight))}px`;
 if(document.activeElement!==input&&!sketch.invalid[key]){input.value=Number(value.toFixed(3));input.setCustomValidity('');}
}

function placementFields(constraints={},hasEdges,context,scale=1,distanceReference='outline'){
 return `<div class="section-title">POSITION FESTLEGEN</div><p class="tip">${hasEdges?'Abstand von der Außenkante der Fläche zum gewählten Maßbezug. Links/rechts und unten/oben beziehen sich auf die Skizzenansicht.':'Zentrieren ist verfügbar. Kantenabstände benötigen eine rechteckige Außenkontur, deren Kanten entlang U/V liegen.'}</p><label class="field"><span>Abstand bis</span><select data-distance-reference aria-label="Abstand bis"><option value="outline" ${distanceReference==='outline'?'selected':''}>Konturrand</option><option value="center" ${distanceReference==='center'?'selected':''}>Mittelpunkt</option></select></label>${['u','v'].map((axis,i)=>{
  const c=constraints?.[axis],options=[['free','Frei verschieben'],['center','Zentriert'],...(hasEdges?[["min",i?'Untere Kante':'Linke Kante'],['max',i?'Obere Kante':'Rechte Kante']]:[])];
  return `<div class="placement-row"><label class="field"><span>${i?'Vertikal':'Horizontal'}</span><select data-placement="${axis}" data-context="${context}" aria-label="${i?'Vertikaler':'Horizontaler'} Bezug">${options.map(([value,label])=>`<option value="${value}" ${value===(c?.mode??'free')?'selected':''}>${label}</option>`).join('')}</select></label>${context==='sketch'?skField(i?'Abstand vertikal':'Abstand horizontal','distance-'+axis,(c?.distance??0)*scale):field(i?'Abstand vertikal':'Abstand horizontal','feature-distance-'+axis,(c?.distance??0)*scale)}</div>`;
 }).join('')}${context==='sketch'?'<div class="body-actions"><button class="subtle-button" data-action="center-sketch">Auf Fläche zentrieren</button><button class="subtle-button" data-action="release-position">Position freigeben</button></div>':''}`;
}
function syncPlacementControls(){
 for(const select of $$('[data-placement]')){
  const axis=select.dataset.placement,context=select.dataset.context;
  if(sketch&&context==='sketch')select.value=sketch.constraints[axis]?.mode??'free';
  const input=context==='sketch'?$(`[data-sketch="distance-${axis}"]`):$(`[data-field="feature-distance-${axis}"]`);
  if(input)input.disabled=!['min','max'].includes(select.value);
  const center=context==='sketch'?$(`[data-sketch="center-${axis}"]`):$(`[data-field="feature-${axis}"]`);
  if(center)center.disabled=select.value!=='free';
 }
}
function readPlacement(context,scale){
 const constraints={};
 for(const axis of ['u','v']){const mode=$(`[data-placement="${axis}"][data-context="${context}"]`).value;if(mode!=='free')constraints[axis]={mode,...(mode==='center'?{}:{distance:inputNumber(context+'-distance-'+axis)/scale})};}
 return constraints;
}
function applySketchPosition(){
 try{sketch.center=positionedCenter(sketch,sketch.face.sketchBounds);sketch.invalid.position=false;}
 catch{sketch.invalid.position=true;}
}
function drawPlacementDimensions(){
 const s=sketch,b=s.face.sketchBounds;if(!b)return;
 const e=profileExtents(s);
 for(const [i,axis] of ['u','v'].entries()){
  const c=s.constraints[axis];if(!c||c.mode==='center')continue;
  const edge=b[c.mode][i],contour=s.center[i]+(s.distanceReference==='center'?0:e[c.mode][i]),other=1-i;
  const a=[...s.center],z=[...s.center];a[i]=edge;z[i]=contour;
  const originalA=[...a],originalZ=[...z],offset=viewHeight/camera.zoom/viewport.clientHeight*38;
  a[other]=z[other]=s.center[other]+(i===0?e.max[other]+offset:e.min[other]-offset);
  const extensions=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([toSketchWorld(...originalA),toSketchWorld(...a),toSketchWorld(...originalZ),toSketchWorld(...z)]),new THREE.LineBasicMaterial({color:0x789ba8,depthTest:false,transparent:true,opacity:.6}));extensions.renderOrder=29;sketchRoot.add(extensions);
  sketchDimension(toSketchWorld(...a),toSketchWorld(...z),'distance-'+axis,c.distance);
  const start=[0,0],end=[0,0];start[i]=end[i]=edge;start[other]=b.min[other];end[other]=b.max[other];
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([toSketchWorld(...start),toSketchWorld(...end)]),new THREE.LineBasicMaterial({color:0xe69b3a,depthTest:false,transparent:true}));line.renderOrder=35;sketchRoot.add(line);
 }
}

const contourKeys=['kind','center','width','height','radius','sides','angle','hasDrawn','locks','invalid','constraints','distanceReference','role'];
function captureContour(){return Object.fromEntries(contourKeys.map(key=>[key,clone(sketch[key])]));}
function saveContour(){sketch.profiles[sketch.activeContour]=captureContour();}
function switchContour(index){
 if(!sketch||busy)return;saveContour();sketch.activeContour=index;Object.assign(sketch,clone(sketch.profiles[index]));renderSketchInspector();drawSketch();updateToolButtons();
}
function addContour(duplicate){
 if(!sketch||busy)return;saveContour();if(sketch.profiles.length>=12){toast('Maximal zwölf Konturen pro Skizze.');return;}
 const profile=duplicate?captureContour():{kind:'circle',center:[0,0],width:10,height:10,radius:3,sides:6,angle:0,hasDrawn:false,locks:{},invalid:{},constraints:{},distanceReference:'outline',role:'solid'};
 if(duplicate){profile.center[0]+=10;profile.constraints={};profile.invalid={};}
 sketch.profiles.push(profile);switchContour(sketch.profiles.length-1);
}
function removeContour(){
 if(!sketch||busy||sketch.profiles.length<2)return;sketch.profiles.splice(sketch.activeContour,1);sketch.activeContour=Math.min(sketch.activeContour,sketch.profiles.length-1);Object.assign(sketch,clone(sketch.profiles[sketch.activeContour]));renderSketchInspector();drawSketch();
}
function contourList(){
 return `<div class="section-title">KONTUREN · ${sketch.profiles.length}/12</div><div class="contour-list">${sketch.profiles.map((p,i)=>`<button data-contour="${i}" class="${i===sketch.activeContour?'active':''}">${i+1}. ${sketchName(i===sketch.activeContour?sketch.kind:p.kind)}${(i===sketch.activeContour?sketch.role:p.role)==='hole'?' · Aussparung':''}${Object.values(p.invalid).some(Boolean)?' · Maß prüfen':''}</button>`).join('')}</div><div class="body-actions"><button class="subtle-button" data-action="add-contour">+ Kontur</button><button class="subtle-button" data-action="duplicate-contour">Kopieren</button><button class="subtle-button" data-action="remove-contour" ${sketch.profiles.length<2?'disabled':''}>Entfernen</button></div><div class="body-role"><button data-contour-role="solid" class="${sketch.role!=='hole'?'active':''}">Normale Kontur</button><button data-contour-role="hole" class="${sketch.role==='hole'?'active':''}">Aussparung</button></div><details class="sketch-help"><summary>Bohrungen und Aussparungen</summary><p class="tip">Bohrungen: normale Kreise zeichnen, dann Ausschneiden. Aussparungen innerhalb normaler Konturen bleiben beim Aufbauen frei. Die Tiefe gilt für alle Konturen.</p></details>`;
}
function contourPoints(p){
 const a=p.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),point=(x,y)=>toSketchWorld(p.center[0]+x*c-y*s,p.center[1]+x*s+y*c);
 if(p.kind==='rectangle')return [[-p.width/2,-p.height/2],[p.width/2,-p.height/2],[p.width/2,p.height/2],[-p.width/2,p.height/2]].map(([x,y])=>point(x,y));
 const count=p.kind==='polygon'?p.sides:96;return Array.from({length:count},(_,i)=>{const a=2*Math.PI*i/count+(p.kind==='polygon'?Math.PI/2:0);return point(Math.cos(a)*(p.kind==='ellipse'?p.width/2:p.radius),Math.sin(a)*(p.kind==='ellipse'?p.height/2:p.radius));});
}
function profileSelector(profiles){
 const index=Math.min(selectedContour,profiles.length-1);selectedContour=index;
 return `<label class="field"><span>Kontur bearbeiten</span><select data-profile-select aria-label="Kontur bearbeiten">${profiles.map((p,i)=>`<option value="${i}" ${i===index?'selected':''}>${i+1}. ${sketchName(p.kind)}${p.role==='hole'?' · Aussparung':''}</option>`).join('')}</select></label><label class="field"><span>Konturrolle</span><select data-field="profile-role" aria-label="Konturrolle"><option value="solid" ${profiles[index].role!=='hole'?'selected':''}>Normale Kontur</option><option value="hole" ${profiles[index].role==='hole'?'selected':''}>Aussparung</option></select></label>`;
}
