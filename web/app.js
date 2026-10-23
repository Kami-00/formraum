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
const STORAGE='formraum.project.v1';
const makeDefault = () => ({version:1,name:'Mein Bauteil',objects:[{id:uid(),name:'Quader 01',kind:'box',params:{width:40,depth:30,height:12},position:[0,0,0],features:[],color:'#67aba9'}]});
let project=makeDefault(), models=[], selectedId=project.objects[0].id, selectedFace=null, selectedEdges=new Set(), selectedFeature=-1;
let tool='select', sketch=null, busy=false, undoStack=[], redoStack=[], hoverEdge=null, drag=null, requestVersion=0, toastTimer, edgeSize=1;
let savedCamera=null, lastPointer=null;

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
const measureLabel=document.createElement('div');measureLabel.className='sketch-measure';measureLabel.hidden=true;viewport.appendChild(measureLabel);

function resize(){
 const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;
 renderer.setSize(w,h);const aspect=w/h;camera.left=-viewHeight*aspect/2;camera.right=viewHeight*aspect/2;camera.top=viewHeight/2;camera.bottom=-viewHeight/2;camera.updateProjectionMatrix();
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
  if(model.id!==selectedId)material.color.lerp(new THREE.Color('#aebac5'),.25);
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
 if(sketch){const model=models.find(m=>m.id===selectedId);const size=vec(model.bounds.max).sub(vec(model.bounds.min)).length();const aspect=viewport.clientWidth/viewport.clientHeight;viewHeight=Math.max(size*1.15/Math.min(aspect,1),35);camera.zoom=1;resize();return;}
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
function selectObject(id,face=null){
 selectedId=id;selectedFace=face;selectedFeature=-1;selectedEdges.clear();hoverEdge=null;
 renderBodies();renderPanels();
}
function currentSpec(){return project.objects.find(o=>o.id===selectedId);}
function currentModel(){return models.find(o=>o.id===selectedId);}
function toast(message,error=false){clearTimeout(toastTimer);const t=$('#toast');t.textContent=message;t.classList.toggle('error',error);t.hidden=false;toastTimer=setTimeout(()=>t.hidden=true,error?8500:3500);}
function setBusy(value){busy=value;document.body.classList.toggle('busy',value);$('#busy-badge').hidden=!value;updateUndo();}
function setStatus(message,ok=true){$('#status').textContent=message;$('#connection-dot').classList.toggle('off',!ok);}
function persist(){
 try{localStorage.setItem(STORAGE,JSON.stringify(project));$('#autosave-status').textContent='Auf diesem Gerät gespeichert';}
 catch{$('#autosave-status').textContent='Zum Sichern bitte Projektdatei speichern';}
}
function updateUndo(){$('#undo').disabled=busy||!undoStack.length;$('#redo').disabled=busy||!redoStack.length;}
async function commit(next,{record=true,fit=false,message=''}={}){
 if(busy)return false;
 setBusy(true);const n=++requestVersion;
 try{
  const result=await calculate('model',{project:next});if(n!==requestVersion)return false;
  if(record){undoStack.push(clone(project));if(undoStack.length>60)undoStack.shift();redoStack=[];}
  project=clone(result.project);models=result.objects;
  if(!project.objects.some(o=>o.id===selectedId))selectedId=project.objects[0]?.id||null;
  selectedFace=null;selectedEdges.clear();hoverEdge=null;selectedFeature=-1;
  renderBodies();renderPanels();persist();setStatus(`${models.length} ${models.length===1?'Körper':'Körper'} · Geometrie bereit`);
  if(fit)fitView();if(message)toast(message);return true;
 }catch(error){toast(error.message,true);setStatus('Änderung verworfen · letzter gültiger Stand erhalten',true);return false;}
 finally{setBusy(false);}
}

function field(label,key,value,unit='mm',extra=''){
 return `<label class="field"><span>${esc(label)}</span><div class="input-unit"><input type="number" data-field="${esc(key)}" value="${Number(value??0)}" step="0.1" ${extra} aria-label="${esc(label)}">${unit?`<em>${esc(unit)}</em>`:''}</div></label>`;
}
function featureName(f){return ({extrude:'Aufbauen',pocket:'Ausschneiden',fillet:'Rundung',chamfer:'Fase'})[f.type]||f.type;}
function featureIcon(f){return ({extrude:'extrude',pocket:'cut',fillet:'fillet',chamfer:'chamfer'})[f.type]||'sketch';}
function featureDetail(f){return f.type==='fillet'?`R ${fmt(f.radius)}`:f.type==='chamfer'?`${fmt(f.distance)} mm`:`${fmt(f.depth)} mm`;}
function renderPanels(){
 $('#project-name').value=project.name||'Unbenanntes Bauteil';$('#body-count').textContent=project.objects.length;
 $('#body-list').innerHTML=project.objects.length?project.objects.map(o=>`<div class="body-row ${o.id===selectedId?'active':''} ${o.visible===false?'invisible':''}" data-body="${esc(o.id)}" role="button" tabindex="0" aria-label="${esc(o.name)}" title="${esc(o.name)}"><span class="body-icon">${icon(o.kind==='cylinder'?'cylinder':'box')}</span><span class="body-label">${esc(o.name)}</span><button class="icon-button" data-visibility="${esc(o.id)}" title="Sichtbarkeit" aria-label="${o.visible===false?'Einblenden':'Ausblenden'}">${icon('eye')}</button></div>`).join(''):'<p class="tip" style="padding:5px 9px">Füge einen Quader oder Zylinder hinzu.</p>';
 const spec=currentSpec();
 $('#feature-list').innerHTML=spec?`<div class="feature-row ${selectedFeature===-1?'current':''}" data-feature="-1" role="button" tabindex="0" aria-label="Grundkörper" title="Grundkörper">${icon(spec.kind==='cylinder'?'cylinder':'box')}<span>${spec.kind==='imported'?'STEP-Import':'Grundkörper'}</span></div>`+(spec.features||[]).map((f,i)=>`<div class="feature-row ${i===selectedFeature?'current':''}" data-feature="${i}" role="button" tabindex="0" aria-label="${esc(featureName(f)+' '+featureDetail(f))}" title="${esc(featureName(f)+' '+featureDetail(f))}">${icon(featureIcon(f))}<span>${featureName(f)} <small>${esc(featureDetail(f))}</small></span><button class="remove-feature" data-remove-feature="${i}" title="Diesen und folgende Schritte entfernen" aria-label="Diesen und folgende Schritte entfernen">×</button></div>`).join(''):'';
 renderInspector();
 const faceText=selectedFace?` · Fläche ${selectedFace.id}`:'';
 $('#selection-status').textContent=spec?`${spec.name}${faceText}`:'Keine Auswahl';
 updateToolButtons();updateUndo();
}
function renderInspector(){
 const root=$('#inspector'),spec=currentSpec(),model=currentModel();
 if(sketch){renderSketchInspector();return;}
 if(tool==='fillet'||tool==='chamfer'){
  const rounded=tool==='fillet';
  root.innerHTML=`<div class="inspector-heading">${rounded?'KANTEN ABRUNDEN':'KANTEN ANFASEN'}${icon(rounded?'fillet':'chamfer')}</div><div class="inspector-content"><p class="tool-description">Klicke die gewünschten Kanten direkt am Bauteil an.</p><div class="edge-count"><strong>${selectedEdges.size}</strong> ${selectedEdges.size===1?'Kante ausgewählt':'Kanten ausgewählt'}</div><div class="chip-list">${[...selectedEdges].map(e=>`<button data-remove-edge="${e}">Kante ${e} ×</button>`).join('')}</div>${field(rounded?'Radius':'Fasenmaß','edge-size',edgeSize)}<button class="primary" data-action="apply-edge" ${!selectedEdges.size||!spec?'disabled':''}>${icon('check')}${rounded?'Rundung':'Fase'} anwenden</button><button class="subtle-button" data-action="cancel-tool">Abbrechen</button><p class="tip">Noch einmal auf eine ausgewählte Kante klicken, um sie abzuwählen. Bei zu großen Maßen bleibt dein Bauteil unverändert.</p></div>`;
  return;
 }
 if(!spec||!model){root.innerHTML=`<div class="inspector-heading">EIGENSCHAFTEN</div><div class="inspector-empty">${icon('select')}<strong>Dein Bauteil im Blick.</strong><p>Wähle einen Körper oder eine Fläche im 3D-Bereich aus.</p></div>`;return;}
 if(selectedFeature>=0&&spec.features?.[selectedFeature]){renderFeatureInspector(spec.features[selectedFeature]);return;}
 const bounds=vec(model.bounds.max).sub(vec(model.bounds.min));
 const faceCard=selectedFace?`<div class="face-card"><div class="face-title">${icon('sketch')}Fläche ${selectedFace.id} ausgewählt</div><p>${selectedFace.planar?'Ebene Fläche · '+fmt(selectedFace.area)+' mm²':'Gekrümmte Fläche · '+fmt(selectedFace.area)+' mm²'}</p><button class="primary" data-action="start-sketch" ${selectedFace.planar?'':'disabled'}>${icon('sketch')}Skizze auf Fläche</button>${!selectedFace.planar?'<p>Wähle zum Zeichnen eine ebene Fläche.</p>':''}</div>`:'';
 root.innerHTML=`<div class="inspector-heading">EIGENSCHAFTEN<button class="icon-button" data-action="delete-body" title="Körper löschen" aria-label="Körper löschen">${icon('trash')}</button></div><div class="inspector-content"><div class="object-type">${icon(spec.kind==='cylinder'?'cylinder':'box')}${({box:'Quader',cylinder:'Zylinder',imported:'STEP-Körper'})[spec.kind]}</div><input class="name-field" data-field="body-name" aria-label="Körpername" value="${esc(spec.name)}">${faceCard}<div class="section-title">AUSSENMASSE<span>mm</span></div><div class="bounds-display">${fmt(bounds.x)} <i>×</i> ${fmt(bounds.y)} <i>×</i> ${fmt(bounds.z)}</div>${spec.kind==='imported'?'<p class="tip">Die Grundform des Imports bleibt erhalten. Skizzen und Kantenbearbeitungen kannst du ergänzen.</p>':`<div class="section-title">MASSE DES GRUNDKÖRPERS</div>${spec.kind==='box'?`${field('Breite · X','width',spec.params.width)}${field('Tiefe · Y','depth',spec.params.depth)}`:field('Radius','radius',spec.params.radius)}${field('Höhe · Z','height',spec.params.height)}`}<div class="section-title">POSITION</div><div class="fields-3">${field('X','position-x',spec.position?.[0]||0)}${field('Y','position-y',spec.position?.[1]||0)}${field('Z','position-z',spec.position?.[2]||0)}</div><button class="primary" data-action="apply-dimensions">${icon('check')}Maße übernehmen</button><div class="volume"><span>Volumen</span><span>${fmt(model.volume)} mm³</span></div>${!selectedFace?'<hr class="divider"><p class="muted">Klicke auf eine Fläche, um dort eine Skizze anzulegen.</p>':''}</div>`;
}
function renderFeatureInspector(feature){
 const isSketch=feature.type==='extrude'||feature.type==='pocket';
 $('#inspector').innerHTML=`<div class="inspector-heading">BEARBEITUNG ${selectedFeature+1}${icon(featureIcon(feature))}</div><div class="inspector-content"><h3>${esc(featureName(feature))}</h3>${isSketch?`${field('Höhe / Tiefe','feature-depth',feature.depth)}<div class="section-title">SKIZZE · ${feature.sketch.kind==='circle'?'KREIS':'RECHTECK'}</div>${feature.sketch.kind==='circle'?field('Radius','feature-radius',feature.sketch.radius):`${field('Breite','feature-width',feature.sketch.width)}${field('Höhe','feature-height',feature.sketch.height)}`}<div class="fields-2">${field('Mitte U','feature-u',feature.sketch.center[0])}${field('Mitte V','feature-v',feature.sketch.center[1])}</div>`:field(feature.type==='fillet'?'Radius':'Fasenmaß','feature-size',feature.radius??feature.distance)}<button class="primary" data-action="apply-feature">${icon('check')}Änderung übernehmen</button><button class="subtle-button" data-action="show-body">Zurück zum Körper</button><p class="tip">Die folgenden Modellschritte werden mit deinen neuen Maßen erneut berechnet.</p></div>`;
}
function inputNumber(key){const el=$(`[data-field="${key}"]`);const n=Number(el?.value);if(!el||!el.value||!Number.isFinite(n))throw new Error('Bitte gültige Zahlen eintragen.');return n;}
async function applyDimensions(){
 try{
  const next=clone(project),spec=next.objects.find(o=>o.id===selectedId);
  spec.name=$('[data-field="body-name"]').value.trim()||'Körper';
  if(spec.kind!=='imported')for(const key of spec.kind==='box'?['width','depth','height']:['radius','height'])spec.params[key]=inputNumber(key);
  spec.position=['x','y','z'].map(d=>inputNumber('position-'+d));
  await commit(next,{message:'Maße übernommen'});
 }catch(e){toast(e.message,true);}
}
async function applyFeature(){
 try{
  const next=clone(project),f=next.objects.find(o=>o.id===selectedId).features[selectedFeature];
  if(f.type==='extrude'||f.type==='pocket'){
   f.depth=inputNumber('feature-depth');f.sketch.center=[inputNumber('feature-u'),inputNumber('feature-v')];
   if(f.sketch.kind==='circle')f.sketch.radius=inputNumber('feature-radius');else{f.sketch.width=inputNumber('feature-width');f.sketch.height=inputNumber('feature-height');}
  }else if(f.type==='fillet')f.radius=inputNumber('feature-size');else f.distance=inputNumber('feature-size');
  await commit(next,{message:'Bearbeitung geändert'});
 }catch(e){toast(e.message,true);}
}
async function applyEdge(){
 if(!selectedEdges.size||!currentSpec())return;
 try{const next=clone(project),spec=next.objects.find(o=>o.id===selectedId);const feature={type:tool,edges:[...selectedEdges],references:[...selectedEdges].map(id=>currentModel().edges.find(e=>e.id===id)?.reference)};feature[tool==='fillet'?'radius':'distance']=inputNumber('edge-size');spec.features.push(feature);if(await commit(next,{message:tool==='fillet'?'Kanten abgerundet':'Kanten angefast'}))setTool('select');}catch(e){toast(e.message,true);}
}
function updateToolButtons(){
 $$('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);});
 $('#mode-pill').textContent=sketch?(sketch.kind==='rectangle'?'Rechteck aufziehen oder Maße eingeben':'Kreis aufziehen oder Radius eingeben'):tool==='fillet'?'Kanten für die Rundung auswählen':tool==='chamfer'?'Kanten für die Fase auswählen':tool==='move'?'Körper auf der XY-Ebene verschieben':'Körper oder Fläche auswählen';
 renderer.domElement.style.cursor=sketch?'crosshair':tool==='move'?'move':tool==='fillet'||tool==='chamfer'?'crosshair':'default';
}
function setTool(next){
 if(busy)return;
 if(next==='sketch'){startSketch();return;}
 if(sketch)cancelSketch();tool=next;selectedEdges.clear();hoverEdge=null;selectedFeature=-1;renderSelection();renderInspector();updateToolButtons();
}
function startSketch(){
 if(busy||sketch)return;
 if(!selectedFace?.planar){toast('Klicke zuerst eine ebene Fläche am Bauteil an.');return;}
 const face=clone(selectedFace);sketch={face,kind:'rectangle',center:[0,0],width:10,height:10,radius:5,depth:10,snap:1,hasDrawn:false};tool='sketch';
 savedCamera={position:camera.position.clone(),up:camera.up.clone(),target:controls.target.clone(),height:viewHeight,zoom:camera.zoom};
 const origin=vec(face.origin),normal=vec(face.normal);camera.position.copy(origin).addScaledVector(normal,200);camera.up.copy(vec(face.v));camera.lookAt(origin);controls.target.copy(origin);controls.enableRotate=false;controls.mouseButtons.RIGHT=THREE.MOUSE.PAN;
 const aspect=viewport.clientWidth/viewport.clientHeight;viewHeight=Math.max(vec(currentModel().bounds.max).sub(vec(currentModel().bounds.min)).length()*1.2/Math.min(aspect,1),40);camera.zoom=1;resize();controls.update();
 grid.visible=false;axes.visible=false;$('#navigation-hint').textContent='Links ziehen: zeichnen · Rechts ziehen: verschieben · Esc: Skizze beenden';
 $('#welcome').hidden=true;renderSelection();renderSketchInspector();updateToolButtons();drawSketch();
}
function cancelSketch(){
 if(!sketch)return;
 sketch=null;tool='select';disposeGroup(sketchRoot);measureLabel.hidden=true;
 controls.enableRotate=true;controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;grid.visible=true;axes.visible=true;
 if(savedCamera){camera.position.copy(savedCamera.position);camera.up.copy(savedCamera.up);controls.target.copy(savedCamera.target);viewHeight=savedCamera.height;camera.zoom=savedCamera.zoom;resize();camera.lookAt(controls.target);savedCamera=null;}
 controls.update();$('#navigation-hint').innerHTML='Rechts ziehen: drehen <b>·</b> Mausrad: zoomen <b>·</b> Mitte: verschieben';
 renderSelection();renderPanels();updateToolButtons();
}
function renderSketchInspector(){
 if(!sketch)return;
 const s=sketch;
 $('#inspector').innerHTML=`<div class="inspector-heading">SKIZZE AUF FLÄCHE ${s.face.id}${icon('sketch')}</div><div class="inspector-content"><p class="tool-description">Zeichne direkt auf die ausgewählte Fläche.</p><div class="sketch-types"><button data-sketch-kind="rectangle" class="${s.kind==='rectangle'?'active':''}">${icon('rect')}Rechteck</button><button data-sketch-kind="circle" class="${s.kind==='circle'?'active':''}">${icon('circle')}Kreis</button></div><div class="sketch-status ${s.hasDrawn?'ready':''}" id="sketch-status">${s.hasDrawn?'Kontur bereit · Maße anpassbar':'Mit gedrückter linker Maustaste aufziehen'}</div>${s.kind==='rectangle'?`<div class="fields-2">${skField('Breite','width',s.width)}${skField('Höhe','height',s.height)}</div>`:skField('Radius','radius',s.radius)}<div class="section-title">MITTELPUNKT AUF DER FLÄCHE</div><div class="fields-2">${skField('U','center-u',s.center[0])}${skField('V','center-v',s.center[1])}</div><hr class="divider">${skField('Höhe / Tiefe','depth',s.depth)}<div class="action-duo"><button class="primary" data-action="extrude" ${s.hasDrawn?'':'disabled'}>${icon('extrude')}Aufbauen</button><button class="subtle-button" data-action="pocket" ${s.hasDrawn?'':'disabled'}>${icon('cut')}Ausschneiden</button></div><button class="subtle-button" data-action="cancel-sketch">Skizze verwerfen</button><label class="grid-field">Fangraster · mm<input type="number" data-sketch="snap" min="0" step="0.5" value="${s.snap}" aria-label="Fangraster"></label><p class="tip">U und V beziehen sich auf die Mitte der ausgewählten Fläche. Fangraster 0 schaltet das Einrasten aus.</p></div>`;
}
function skField(label,key,value){return field(label,'sk-'+key,value).replace(`data-field="sk-${key}"`,`data-sketch="${key}"`);}
function syncSketchInputs(){
 if(!sketch)return;
 const values={...sketch,'center-u':sketch.center[0],'center-v':sketch.center[1]};
 $$('[data-sketch]').forEach(el=>{if(document.activeElement!==el)el.value=Math.round(values[el.dataset.sketch]*1000)/1000;});
 const status=$('#sketch-status');if(status){status.classList.toggle('ready',sketch.hasDrawn);status.textContent=sketch.hasDrawn?'Kontur bereit · Maße anpassbar':'Mit gedrückter linker Maustaste aufziehen';}
 $$('[data-action="extrude"],[data-action="pocket"]').forEach(b=>b.disabled=!sketch.hasDrawn||busy);
}
function toSketchWorld(u,v,lift=.06){return vec(sketch.face.origin).addScaledVector(vec(sketch.face.u),u).addScaledVector(vec(sketch.face.v),v).addScaledVector(vec(sketch.face.normal),lift);}
function drawSketch(){
 disposeGroup(sketchRoot);measureLabel.hidden=true;if(!sketch)return;
 const s=sketch,origin=vec(s.face.origin),u=vec(s.face.u),v=vec(s.face.v),normal=vec(s.face.normal);
 const model=currentModel();const size=Math.max(vec(model.bounds.max).sub(vec(model.bounds.min)).length(),40);const gridStep=s.snap>0?Math.max(s.snap,1):5;
 const gridPoints=[];const extent=Math.min(Math.ceil(size/gridStep),100)*gridStep;
 for(let t=-extent;t<=extent;t+=gridStep){gridPoints.push(toSketchWorld(t,-extent,.025),toSketchWorld(t,extent,.025),toSketchWorld(-extent,t,.025),toSketchWorld(extent,t,.025));}
 const g=new THREE.BufferGeometry().setFromPoints(gridPoints);sketchRoot.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0x79aba3,transparent:true,opacity:.13,depthTest:false})));
 if(!s.hasDrawn)return;
 let points=[];const [cu,cv]=s.center;
 if(s.kind==='rectangle')points=[[-s.width/2,-s.height/2],[s.width/2,-s.height/2],[s.width/2,s.height/2],[-s.width/2,s.height/2]].map(([x,y])=>toSketchWorld(cu+x,cv+y));
 else for(let i=0;i<96;i++){const a=i*Math.PI*2/96;points.push(toSketchWorld(cu+Math.cos(a)*s.radius,cv+Math.sin(a)*s.radius));}
 const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x008c7b,depthTest:false}));line.renderOrder=20;sketchRoot.add(line);
 const center=toSketchWorld(cu,cv),fillPositions=[];
 for(let i=0;i<points.length;i++)fillPositions.push(...center.toArray(),...points[i].toArray(),...points[(i+1)%points.length].toArray());
 const fillGeom=new THREE.BufferGeometry();fillGeom.setAttribute('position',new THREE.Float32BufferAttribute(fillPositions,3));const fill=new THREE.Mesh(fillGeom,new THREE.MeshBasicMaterial({color:0x1cb79e,transparent:true,opacity:.16,depthTest:false,side:THREE.DoubleSide,depthWrite:false}));fill.renderOrder=19;sketchRoot.add(fill);
 measureLabel.hidden=false;measureLabel.textContent=s.kind==='rectangle'?`${fmt(s.width)} × ${fmt(s.height)} mm`:`R ${fmt(s.radius)} mm`;
 const labelPoint=toSketchWorld(cu,cv-(s.kind==='rectangle'?s.height/2:s.radius));labelPoint.project(camera);measureLabel.style.left=`${(labelPoint.x+1)/2*viewport.clientWidth}px`;measureLabel.style.top=`${(1-labelPoint.y)/2*viewport.clientHeight+13}px`;
}
function pointerRay(event){const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster.ray;}
function sketchPoint(event,snap=true){
 if(!sketch)return null;const ray=pointerRay(event);const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(vec(sketch.face.normal),vec(sketch.face.origin));const hit=new THREE.Vector3();if(!ray.intersectPlane(plane,hit))return null;
 const diff=hit.sub(vec(sketch.face.origin));let u=diff.dot(vec(sketch.face.u)),v=diff.dot(vec(sketch.face.v));
 if(snap&&sketch.snap>0){u=Math.round(u/sketch.snap)*sketch.snap;v=Math.round(v/sketch.snap)*sketch.snap;}return [u,v];
}
function pickBody(event){pointerRay(event);return raycaster.intersectObjects(bodyMeshes,false)[0]||null;}
function pickEdge(event){
 pointerRay(event);raycaster.params.Line.threshold=viewHeight/camera.zoom/viewport.clientHeight*6;
 const bodyHit=raycaster.intersectObjects(bodyMeshes,false)[0];
 return raycaster.intersectObjects(edgeLines,false).find(hit=>!bodyHit||hit.distance<bodyHit.distance+raycaster.params.Line.threshold*2)||null;
}
async function applySketch(type){
 if(!sketch?.hasDrawn||busy)return;
 const s=clone(sketch),next=clone(project),spec=next.objects.find(o=>o.id===selectedId);
 const profile={kind:s.kind,center:s.center};if(s.kind==='rectangle'){profile.width=s.width;profile.height=s.height;}else profile.radius=s.radius;
 spec.features.push({type,face:s.face.id,reference:s.face.reference,sketch:profile,depth:s.depth});
 // A failed operation keeps the editable sketch and all prior geometry.
 const ok=await commit(next,{message:type==='extrude'?'Skizze aufgebaut':'Tasche ausgeschnitten'});
 if(ok){cancelSketch();selectedFace=null;renderSelection();renderPanels();}
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
  if(sketch.kind==='rectangle'){sketch.center=[(a+c)/2,(b+d)/2];sketch.width=Math.max(Math.abs(c-a),.01);sketch.height=Math.max(Math.abs(d-b),.01);}
  else{sketch.center=[a,b];sketch.radius=Math.max(Math.hypot(c-a,d-b),.01);}
  sketch.hasDrawn=sketch.kind==='rectangle'?sketch.width>.05&&sketch.height>.05:sketch.radius>.05;syncSketchInputs();drawSketch();return;
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
  if(id!==selectedId){selectedId=id;selectedEdges.clear();renderBodies();}
  selectedEdges.has(edge)?selectedEdges.delete(edge):selectedEdges.add(edge);selectedFace=null;renderSelection();renderPanels();return;
 }
 const hit=pickBody(event);
 if(hit){const model=hit.object.userData.model;const faceId=model.mesh.faceIds[hit.faceIndex];const face=model.faces.find(f=>f.id===faceId);selectObject(model.id,face?clone(face):null);}
 else selectObject(null);
});
renderer.domElement.addEventListener('dblclick',event=>{if(!sketch&&tool==='select'&&selectedFace?.planar)startSketch();});
renderer.domElement.addEventListener('pointercancel',()=>{drag=null;groups.get(selectedId)?.position.set(0,0,0);});
controls.addEventListener('change',()=>{if(sketch?.hasDrawn)drawSketch();});

async function addBody(kind){
 if(busy)return;if(sketch)cancelSketch();setTool('select');
 const next=clone(project);const bounds=projectBounds();const x=next.objects.length?bounds.max.x+23:0;
 const count=next.objects.filter(o=>o.kind===kind).length+1;
 const obj={id:uid(),name:`${kind==='box'?'Quader':'Zylinder'} ${String(count).padStart(2,'0')}`,kind,params:kind==='box'?{width:30,depth:25,height:15}:{radius:12,height:25},position:[x,0,0],features:[],color:kind==='box'?'#67aba9':'#b1a3c9'};
 next.objects.push(obj);const previous=selectedId;selectedId=obj.id;if(!await commit(next,{fit:true,message:'Körper hinzugefügt'}))selectedId=previous;
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),20000);}
function safeName(){return (project.name||'Bauteil').replace(/[^\p{L}\p{N} _-]/gu,'').trim().slice(0,70)||'Bauteil';}
function saveProject(){project.name=$('#project-name').value.trim()||'Mein Bauteil';persist();download(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),safeName()+'.formraum.json');toast('Projektdatei gespeichert');}
async function exportModel(kind){
 if(busy)return;setBusy(true);$('#export-menu').hidden=true;
 try{const blob=await calculate(kind==='step'?'export_step':'export_stl',{project});download(blob,safeName()+'.'+kind);toast(`${kind.toUpperCase()} exportiert`);}catch(e){toast(e.message,true);}finally{setBusy(false);}
}
async function openFile(file){
 if(!file||busy)return;
 if(file.size>25*1024*1024){toast('Bitte eine Datei bis 25 MB auswählen.',true);return;}
 if(sketch)cancelSketch();tool='select';
 try{
  if(/\.(stp|step)$/i.test(file.name)){
   if(busy)return;setBusy(true);
   const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
   const result=await calculate('import_step',{base64,filename:file.name});
   setBusy(false);result.project.name=file.name.replace(/\.(step|stp)$/i,'');selectedId=result.project.objects[0]?.id;await commit(result.project,{fit:true,message:'STEP-Datei geöffnet'});
  }else{const data=JSON.parse(await file.text());if(!Array.isArray(data.objects))throw new Error('Diese Datei ist kein Formraum-Projekt.');await commit(data,{fit:true,message:'Projekt geöffnet'});}
 }catch(e){setBusy(false);toast(e.message||'Datei konnte nicht geöffnet werden.',true);}
}
async function undo(){
 if(busy||!undoStack.length)return;if(sketch)cancelSketch();
 const target=undoStack[undoStack.length-1],previous=clone(project);if(await commit(target,{record:false})){undoStack.pop();redoStack.push(previous);updateUndo();}
}
async function redo(){
 if(busy||!redoStack.length)return;if(sketch)cancelSketch();
 const target=redoStack[redoStack.length-1],previous=clone(project);if(await commit(target,{record:false})){redoStack.pop();undoStack.push(previous);updateUndo();}
}

document.addEventListener('click',async event=>{
 const button=event.target.closest('button');
 if(button?.disabled)return;
 if(button?.dataset.tool){setTool(button.dataset.tool);return;}
 if(button?.dataset.view){setView(button.dataset.view);return;}
 if(button?.dataset.export){exportModel(button.dataset.export);return;}
 if(button?.dataset.visibility){
  const id=button.dataset.visibility,spec=project.objects.find(o=>o.id===id);spec.visible=spec.visible===false;renderBodies();renderPanels();persist();return;
 }
 const row=event.target.closest('[data-body]');if(row){if(sketch)cancelSketch();setTool('select');selectObject(row.dataset.body);return;}
 if(button?.dataset.removeFeature!==undefined){
  const next=clone(project),features=next.objects.find(o=>o.id===selectedId).features;const count=features.length-Number(button.dataset.removeFeature);features.splice(Number(button.dataset.removeFeature));await commit(next,{message:count>1?'Bearbeitung und nachfolgende Schritte entfernt · Strg Z zum Wiederherstellen':'Bearbeitung entfernt'});return;
 }
 const featureRow=event.target.closest('[data-feature]');if(featureRow){if(sketch)cancelSketch();tool='select';selectedFeature=Number(featureRow.dataset.feature);selectedFace=null;selectedEdges.clear();renderSelection();renderPanels();return;}
 if(button?.dataset.removeEdge){selectedEdges.delete(Number(button.dataset.removeEdge));renderSelection();renderInspector();return;}
 if(button?.dataset.sketchKind&&sketch){sketch.kind=button.dataset.sketchKind;renderSketchInspector();drawSketch();updateToolButtons();return;}
 switch(button?.dataset.action){
  case 'apply-dimensions':applyDimensions();break;
  case 'start-sketch':startSketch();break;
  case 'apply-edge':applyEdge();break;
  case 'cancel-tool':setTool('select');break;
  case 'cancel-sketch':cancelSketch();break;
  case 'extrude':applySketch('extrude');break;
  case 'pocket':applySketch('pocket');break;
  case 'show-body':selectedFeature=-1;renderPanels();break;
  case 'apply-feature':applyFeature();break;
  case 'delete-body':{if(!currentSpec()||busy)return;const next=clone(project);next.objects=next.objects.filter(o=>o.id!==selectedId);await commit(next,{message:'Körper gelöscht · Strg Z zum Wiederherstellen'});break;}
 }
 if(!event.target.closest('.export-wrap'))$('#export-menu').hidden=true;
});
$('#inspector').addEventListener('input',event=>{
 if(event.target.dataset.field==='edge-size'){const n=Number(event.target.value);if(Number.isFinite(n)&&n>0)edgeSize=n;}
 if(!sketch||!event.target.dataset.sketch)return;
 const key=event.target.dataset.sketch,n=Number(event.target.value);if(!Number.isFinite(n)||event.target.value==='')return;
 if(key==='center-u')sketch.center[0]=n;else if(key==='center-v')sketch.center[1]=n;else sketch[key]=n;
 if(key!=='snap'&&key!=='depth')sketch.hasDrawn=true;
 syncSketchInputs();drawSketch();
});
$('#inspector').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('input')&&!sketch){event.preventDefault();selectedFeature>=0?applyFeature():applyDimensions();}});
$('#add-box').onclick=()=>addBody('box');$('#add-cylinder').onclick=()=>addBody('cylinder');
$('#undo').onclick=undo;$('#redo').onclick=redo;$('#fit-view').onclick=()=>fitView();
$('#save-project').onclick=saveProject;$('#open-project').onclick=()=>$('#project-file').click();
$('#project-file').accept='.json,.formraum,.step,.stp';
$('#project-file').onchange=event=>{openFile(event.target.files[0]);event.target.value='';};
$('#export-menu-button').onclick=()=>$('#export-menu').hidden=!$('#export-menu').hidden;
$('#project-name').onchange=event=>{project.name=event.target.value.trim()||'Mein Bauteil';persist();};
$('#new-project').onclick=async()=>{if(busy)return;if(sketch)cancelSketch();tool='select';selectedId=null;await commit({version:1,name:'Neues Bauteil',objects:[]},{fit:true,message:'Leeres Projekt angelegt · Strg Z zum Wiederherstellen'});};
$('#dismiss-welcome').onclick=()=>{$('#welcome').hidden=true;try{localStorage.setItem('formraum.welcome','dismissed');}catch{}};
try{if(localStorage.getItem('formraum.welcome'))$('#welcome').hidden=true;}catch{}
$('#help').onclick=()=>$('#help-dialog').showModal();$$('.close-dialog').forEach(b=>b.onclick=()=>$('#help-dialog').close());
$('#help-dialog').addEventListener('click',event=>{if(event.target===$('#help-dialog'))$('#help-dialog').close();});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){if(sketch)cancelSketch();else setTool('select');$('#export-menu').hidden=true;return;}
 const editing=event.target.matches('input,textarea,select');
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();saveProject();return;}
 if(editing||$('#help-dialog').open)return;
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();return;}
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();return;}
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
  let initial=project;
  try{const saved=JSON.parse(localStorage.getItem(STORAGE));if(saved?.version===1&&Array.isArray(saved.objects)){initial=saved;selectedId=saved.objects[0]?.id;}}catch{}
  const ok=await commit(initial,{record:false,fit:true});
  if(!ok&&initial!==project){toast('Gespeichertes Projekt konnte nicht geladen werden. Neues Bauteil geöffnet.',true);project=makeDefault();selectedId=project.objects[0].id;await commit(project,{record:false,fit:true});}
 }catch(error){setBusy(false);setStatus('CAD-Kern konnte nicht geladen werden · Seite neu laden',false);toast(error.message,true);}
}
init();

// Offline caching is only enabled for the built application, never in development.
if(import.meta.env.PROD&&'serviceWorker' in navigator){
 navigator.serviceWorker.register(new URL('./sw.js',window.location.href)).then(async()=>{
  await navigator.serviceWorker.ready;
  const badge=$('.local-badge');if(badge)badge.title='Vollständig geladen · auch offline verfügbar';
 }).catch(()=>{const badge=$('.local-badge');if(badge)badge.title='Offline-Speicherung nicht verfügbar; die Anwendung funktioniert online.';});
}
