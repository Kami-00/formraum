import {findRegions,inRegion,edgePoint} from './sketch-regions.js';
import {createPreviewClient} from './preview-client.js';
import * as THREE from './vendor/three.module.js';
import {OrbitControls} from './vendor/OrbitControls.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=structuredClone,uid=()=>crypto.randomUUID(),distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const field=(label,key,value)=>`<label class="field"><span>${label}</span><input type="number" step="any" data-rs-field="${key}" value="${value}" aria-label="${label}"></label>`;
const pathLoop=loop=>`M ${loop[0].a.join(' ')} `+loop.map(e=>e.kind==='line'?`L ${e.b.join(' ')}`:`A ${e.radius} ${e.radius} 0 ${Math.abs(e.sweep)>Math.PI?1:0} ${e.sweep>0?1:0} ${e.b.join(' ')}`).join(' ')+' Z';
export function setupRegionEditor({getProject,getProjectId,canOpen,commit,getError,toast,onApplied}){
 const dialog=document.createElement('dialog');dialog.id='region-dialog';dialog.className='region-dialog';document.body.appendChild(dialog);
 let state,baseline,body,mode='line',pending=null,hover=null,drag=null,regions=[],error='',selectedEntity=null,history=[],future=[],working=false,view={x:15,y:10,width:100},preview=null,draftKey,staleDraft=null;
 const $=s=>dialog.querySelector(s),num=key=>{const input=$(`[data-rs-field="${key}"]`),n=Number(input.value);if(!input.value||!Number.isFinite(n))throw new Error('Bitte gültige Zahlen eingeben.');return n;};
 const snapshot=()=>clone(state);
 function setWorking(value){working=value;dialog.querySelectorAll('input,select,button').forEach(el=>el.disabled=value);if(!value)summary();}
 function settings(){const grid=num('grid'),angle=num('angle'),offset=num('offset');if(grid<0||grid>10000||angle<=0||angle>360||Math.abs(offset)>10000)throw new Error('Raster 0–10000, Winkel > 0 bis 360°, Achsenposition ±10000 mm.');return {grid,angle,offset,axis:$('[data-rs-axis]').value,axisEntityId:$('[data-rs-axis-line]').value};}
 function persist(){if(staleDraft)return;try{sessionStorage.setItem(draftKey,JSON.stringify({state,baseline}));}catch{error='Entwurf konnte nicht im Tab gesichert werden. Bitte „Skizze speichern“ verwenden.';}}
 function record(){history.push(snapshot());if(history.length>60)history.shift();future=[];}
 function stopPreview(){if(preview){preview.client.dispose();preview.controls?.dispose();preview.renderer?.dispose();preview.scene?.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});preview=null;if($('#region-result')){$('#region-result').textContent='Vorschau beendet · Änderungen mit 3D-Vorschau erneut prüfen.';delete $('#region-result').dataset.volume;}}if($('#region-preview')){$('#region-preview').hidden=true;$('#region-canvas').hidden=false;}}
 function recompute(clear=false){
  stopPreview();error='';try{regions=findRegions(state.entities);if(clear)state.selected=[];else state.selected=state.selected.filter(id=>regions.some(r=>r.id===id));}catch(e){regions=[];error=e.message;}
  persist();draw();summary();
 }
 function summary(){
  if(!$('#region-summary'))return;
  $('#region-summary').textContent=`${state.entities.length} Elemente · ${regions.length} geschlossene Flächen · ${state.selected.length} ausgewählt`;
  $('#region-message').textContent=error||({line:'Startpunkt anklicken, dann weitere Punkte. Esc beendet die Linienkette.',circle:'Mittelpunkt anklicken, dann den Radius festlegen.',select:'Geschlossene Flächen anklicken. Ein weiterer Klick wählt sie ab.',edit:'Element anklicken oder Endpunkte ziehen. Maße rechts bearbeiten.'})[mode];
  $('#region-message').classList.toggle('error',!!error);
  dialog.querySelectorAll('[data-rs-mode]').forEach(b=>b.classList.toggle('active',b.dataset.rsMode===mode));
  $('[data-rs-action="undo"]').disabled=working||!history.length;$('[data-rs-action="redo"]').disabled=working||!future.length;
 }
 function draw(){
  const svg=$('#region-canvas');if(!svg)return;const rect=svg.getBoundingClientRect(),height=view.width*(rect.height||600)/(rect.width||800),left=view.x-view.width/2,bottom=view.y-height/2;
  svg.setAttribute('viewBox',`${left} ${-bottom-height} ${view.width} ${height}`);
  const pixel=view.width/(rect.width||800),grid=state.grid>0?state.grid:5,spacing=grid<view.width/100?grid*Math.ceil(view.width/100/grid):grid;
  const axisEntity=state.entities.find(e=>e.id===state.axisEntityId&&e.kind==='line');
  let axis=state.axis==='u'?[[left,state.offset],[left+view.width,state.offset]]:[[state.offset,bottom],[state.offset,bottom+height]];
  if(state.axis==='line'&&axisEntity){const d=[axisEntity.b[0]-axisEntity.a[0],axisEntity.b[1]-axisEntity.a[1]],length=Math.hypot(...d),extent=view.width*3;axis=[axisEntity.a.map((v,i)=>v-d[i]/length*extent),axisEntity.a.map((v,i)=>v+d[i]/length*extent)];}
  svg.innerHTML=`<defs><pattern id="rs-grid" width="${spacing}" height="${spacing}" patternUnits="userSpaceOnUse"><path d="M ${spacing} 0 L 0 0 0 ${spacing}" fill="none" stroke="#dce6eb" stroke-width="${pixel*.6}"/></pattern></defs><rect x="${left}" y="${-bottom-height}" width="${view.width}" height="${height}" fill="url(#rs-grid)"/><g transform="scale(1,-1)">
   <line x1="${left}" y1="0" x2="${left+view.width}" y2="0" stroke="#c98478" stroke-width="${pixel}"/><line x1="0" y1="${bottom}" x2="0" y2="${bottom+height}" stroke="#7e99bd" stroke-width="${pixel}"/>
   ${regions.map((r,i)=>`<path data-rs-region="${r.id}" aria-label="Fläche ${i+1}" d="${[r.outer,...r.holes].map(pathLoop).join(' ')}" fill-rule="evenodd" fill="${state.selected.includes(r.id)?'#42b6a5':'#dbe6ee'}" fill-opacity="${state.selected.includes(r.id)?.65:.55}"/>`).join('')}
   <line x1="${axis[0][0]}" y1="${axis[0][1]}" x2="${axis[1][0]}" y2="${axis[1][1]}" stroke="#cf8a2e" stroke-width="${pixel*2}" stroke-dasharray="${pixel*8} ${pixel*4}" pointer-events="none"/>
   ${state.entities.map(e=>e.kind==='line'?`<line data-rs-entity="${esc(e.id)}" x1="${e.a[0]}" y1="${e.a[1]}" x2="${e.b[0]}" y2="${e.b[1]}"/>`:`<circle data-rs-entity="${esc(e.id)}" cx="${e.center[0]}" cy="${e.center[1]}" r="${e.radius}"/>`).map(s=>s.replace('/>',` fill="none" stroke="#365b6a" stroke-width="${pixel*1.7}"/>`)).join('')}
   ${mode==='edit'?state.entities.flatMap(e=>e.kind==='line'?[[e,'a',e.a],[e,'b',e.b]]:[[e,'center',e.center],[e,'radius',[e.center[0]+e.radius,e.center[1]]]]).map(([e,key,p])=>`<circle data-rs-handle="${key}" data-rs-owner="${esc(e.id)}" cx="${p[0]}" cy="${p[1]}" r="${pixel*4}" fill="white" stroke="#087f74" stroke-width="${pixel*1.5}"/>`).join(''):''}
   ${pending&&hover?(mode==='circle'?`<circle cx="${pending[0]}" cy="${pending[1]}" r="${distance(pending,hover)}"`:`<line x1="${pending[0]}" y1="${pending[1]}" x2="${hover[0]}" y2="${hover[1]}"`)+` fill="none" stroke="#0d857d" stroke-width="${pixel*1.5}" stroke-dasharray="${pixel*5} ${pixel*3}"/>`:''}
   ${hover?`<circle cx="${hover[0]}" cy="${hover[1]}" r="${pixel*3}" fill="#0d857d" pointer-events="none"/>`:''}</g>`;
 }
 function pointer(event,snap=true){
  const svg=$('#region-canvas'),p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());let result=[p.x,-p.y];
  if(!snap||event.altKey)return result;const tolerance=view.width/svg.getBoundingClientRect().width*8;
  const points=state.entities.flatMap(e=>e.kind==='line'?[e.a,e.b]:[e.center,[e.center[0]+e.radius,e.center[1]],[e.center[0]-e.radius,e.center[1]],[e.center[0],e.center[1]+e.radius],[e.center[0],e.center[1]-e.radius]]).concat(regions.flatMap(r=>r.outer.map(e=>e.a)));
  if(pending)points.push(pending);const near=points.filter(p=>distance(p,result)<tolerance).sort((a,b)=>distance(a,result)-distance(b,result))[0];if(near)return [...near];
  // Snap to existing curves as well as endpoints, so a new line can close a region on a circle.
  const projections=state.entities.map(e=>{if(e.kind==='circle'){const angle=Math.atan2(result[1]-e.center[1],result[0]-e.center[0]);return [e.center[0]+e.radius*Math.cos(angle),e.center[1]+e.radius*Math.sin(angle)];}const d=[e.b[0]-e.a[0],e.b[1]-e.a[1]],t=Math.max(0,Math.min(1,((result[0]-e.a[0])*d[0]+(result[1]-e.a[1])*d[1])/(d[0]**2+d[1]**2)));return e.a.map((v,i)=>v+t*d[i]);}).filter(p=>distance(p,result)<tolerance).sort((a,b)=>distance(a,result)-distance(b,result));
  if(projections[0])return projections[0];return state.grid>0?result.map(n=>Math.round(n/state.grid)*state.grid):result;
 }
 function entityPanel(){
  const e=state.entities.find(e=>e.id===selectedEntity),root=$('#region-element');
  root.innerHTML=`<label class="field"><span>Element bearbeiten</span><select data-rs-element><option value="">Element wählen</option>${state.entities.map((e,i)=>`<option value="${esc(e.id)}" ${e.id===selectedEntity?'selected':''}>${e.kind==='line'?'Linie':'Kreis'} ${i+1}</option>`).join('')}</select></label>${!e?'':`${e.kind==='line'?['a','b'].map((key,i)=>`<h4>${i?'Endpunkt':'Startpunkt'}</h4><div class="fields-2">${field('U',key+'0',e[key][0])}${field('V',key+'1',e[key][1])}</div>`).join(''):`<div class="fields-2">${field('Mitte U','c0',e.center[0])}${field('Mitte V','c1',e.center[1])}</div>${field('Radius','radius',e.radius)}`}<button class="subtle-button" data-rs-action="edit-element">Maße übernehmen</button><button class="subtle-button" data-rs-action="delete-element">Element löschen</button>`}`;
 }
 function axisOptions(){const select=$('[data-rs-axis-line]');select.innerHTML=state.entities.filter(e=>e.kind==='line').map((e,i)=>`<option value="${esc(e.id)}" ${e.id===state.axisEntityId?'selected':''}>Linie ${i+1}</option>`).join('');select.hidden=state.axis!=='line';}
 function render(){
  dialog.innerHTML=`<header><div><span class="eyebrow">FREIE SKIZZE · U / V IN MM</span><h2>Zeichnen, Flächen wählen, rotieren</h2></div><button class="icon-button" data-rs-action="close" aria-label="Freie Skizze schließen">×</button></header><div class="region-layout"><section class="region-drawing"><nav>${[['line','Linien'],['circle','Kreise'],['select','Flächen wählen'],['edit','Punkte bearbeiten']].map(([key,label])=>`<button data-rs-mode="${key}">${label}</button>`).join('')}<button data-rs-action="end-line">Linie beenden · Esc</button><button data-rs-action="undo" aria-label="Skizzenschritt rückgängig">↶</button><button data-rs-action="redo" aria-label="Skizzenschritt wiederholen">↷</button><button data-rs-action="fit">Einpassen</button></nav><div class="region-stage"><svg id="region-canvas" aria-label="Freie Linien und Kreise zeichnen"></svg><div id="region-preview" hidden></div></div><p class="tip">Mausrad: zoomen · rechts ziehen: verschieben · Endpunkte und Konturen fangen · Alt: ohne Fanghilfen</p></section><aside><label class="field"><span>Skizzenname</span><input id="region-name" value="${esc(state.name)}"></label><p id="region-summary"></p><p id="region-message" role="status"></p><div class="fields-2">${field('Fangraster','grid',state.grid)}${field('Rotationswinkel °','angle',state.angle)}</div><label class="field"><span>Drehachse</span><select data-rs-axis><option value="v" ${state.axis==='v'?'selected':''}>Vertikal · V</option><option value="u" ${state.axis==='u'?'selected':''}>Horizontal · U</option><option value="line" ${state.axis==='line'?'selected':''}>Gezeichnete Linie</option></select><select data-rs-axis-line aria-label="Linie als Drehachse"></select></label>${field('Achsenposition','offset',state.offset)}<p class="tip">Orange gestrichelt: Drehachse. Die gewählten Flächen müssen auf einer Seite liegen. Mehrere Flächen werden zu einem zusammenhängenden Körper vereinigt.</p><button class="subtle-button" data-rs-action="clear-selection">Flächenauswahl aufheben</button><div id="region-element"></div></aside></div><footer><span id="region-result" role="status">Entwurf bleibt in diesem Tab erhalten. „Skizze speichern“ sichert ihn im Projekt.</span><button class="subtle-button" data-rs-action="save">Skizze speichern</button><button class="subtle-button" data-rs-action="preview">3D-Vorschau</button><button class="primary" data-rs-action="rotate">Rotieren</button></footer>`;
  if(staleDraft)$('#region-message').insertAdjacentHTML('beforebegin','<div class="region-recovery"><p>Ein älterer Entwurf ist erhalten. Welche Skizze möchtest du bearbeiten?</p><button class="subtle-button" data-rs-action="restore-draft">Älteren Entwurf laden</button><button class="subtle-button" data-rs-action="discard-draft">Aktuellen Projektstand verwenden</button></div>');
  entityPanel();axisOptions();requestAnimationFrame(draw);summary();
 }
 function fit(){const points=state.entities.flatMap(e=>e.kind==='line'?[e.a,e.b]:[[e.center[0]-e.radius,e.center[1]-e.radius],[e.center[0]+e.radius,e.center[1]+e.radius]]);if(!points.length){view={x:15,y:10,width:100};}else{const min=[0,1].map(i=>Math.min(...points.map(p=>p[i]))),max=[0,1].map(i=>Math.max(...points.map(p=>p[i]))),r=$('#region-canvas').getBoundingClientRect();view={x:(min[0]+max[0])/2,y:(min[1]+max[1])/2,width:Math.max(max[0]-min[0],(max[1]-min[1])*r.width/r.height,10)*1.4};}draw();}
 function candidate(rotate){
  Object.assign(state,settings());
  if(error)throw new Error(error);if(rotate&&!state.selected.length)throw new Error('Zuerst „Flächen wählen“ und mindestens einen geschlossenen Bereich anklicken.');
  const next=clone(getProject()),source={id:state.id,name:state.name,entities:clone(state.entities)};next.sketches??=[];
  const i=next.sketches.findIndex(s=>s.id===source.id);if(i<0)next.sketches.push(source);else next.sketches[i]=source;
  let target;
  if(rotate){target=body?clone(body):{id:uid(),name:'Rotation · '+state.name,kind:'region',features:[],position:[0,0,0],color:'#67aba9'};Object.assign(target,{sketchId:state.id,regions:[...state.selected],axis:state.axis,axisEntityId:state.axisEntityId,params:{revolveAngle:state.angle,axisOffset:state.offset}});const index=next.objects.findIndex(o=>o.id===target.id);if(index<0)next.objects.push(target);else next.objects[index]=target;}
  return {next,target};
 }
 async function showPreview(){
  if(preview){stopPreview();return;}
  const {next,target}=candidate(true),ctx={client:createPreviewClient()};preview=ctx;setWorking(true);$('#region-result').textContent='Rotationskörper wird geprüft …';
  try{
   const result=await ctx.client.calculate({...next,generators:[],objects:[target]}),model=result.objects[0];if(preview!==ctx)return;
   const host=$('#region-preview');host.hidden=false;$('#region-canvas').hidden=true;
   const scene=new THREE.Scene();scene.background=new THREE.Color('#eff4f6');ctx.scene=scene;
   const meshGeometry=new THREE.BufferGeometry();meshGeometry.setAttribute('position',new THREE.Float32BufferAttribute(model.mesh.vertices.flat(),3));meshGeometry.setIndex(model.mesh.triangles.flat());meshGeometry.computeVertexNormals();scene.add(new THREE.Mesh(meshGeometry,new THREE.MeshStandardMaterial({color:'#67aba9',roughness:.5,side:THREE.DoubleSide})));
   for(const edge of model.edges)scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(edge.points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:'#365b6a'})));
   scene.add(new THREE.HemisphereLight(0xffffff,0xa9bac7,2));const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(60,-80,100);scene.add(light);
   const size=new THREE.Vector3(...model.bounds.max).sub(new THREE.Vector3(...model.bounds.min)).length(),center=new THREE.Vector3(...model.bounds.min).add(new THREE.Vector3(...model.bounds.max)).multiplyScalar(.5),aspect=host.clientWidth/host.clientHeight,h=Math.max(size*1.2/Math.min(1,aspect),10);
   const camera=new THREE.OrthographicCamera(-h*aspect/2,h*aspect/2,h/2,-h/2,.1,Math.max(5000,size*10));camera.up.set(0,0,1);camera.position.copy(center).add(new THREE.Vector3(1,-1,1).normalize().multiplyScalar(Math.max(size*3,100)));camera.lookAt(center);
   const renderer=new THREE.WebGLRenderer({antialias:true});ctx.renderer=renderer;renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(host.clientWidth,host.clientHeight);host.replaceChildren(renderer.domElement);
   const controls=new OrbitControls(camera,renderer.domElement);ctx.controls=controls;controls.target.copy(center);controls.addEventListener('change',()=>renderer.render(scene,camera));controls.update();renderer.render(scene,camera);
   $('#region-result').textContent=`Gültiger Rotationskörper · ${model.volume.toFixed(2)} mm³ · noch nicht übernommen`;$('#region-result').dataset.volume=String(model.volume);
  }catch(e){stopPreview();$('#region-result').textContent=e.message;}finally{setWorking(false);}
 }
 dialog.addEventListener('pointerdown',event=>{
  if(working||staleDraft||!event.target.closest('#region-canvas'))return;
  const p=pointer(event,mode!=='select');
  if(event.button===1||event.button===2){drag={type:'pan',start:[event.clientX,event.clientY],view:{...view}};event.target.closest('svg').setPointerCapture(event.pointerId);return;}
  if(event.button!==0)return;
  if(mode==='edit'){
   const handle=event.target.dataset.rsHandle;if(handle){record();const id=event.target.dataset.rsOwner,e=state.entities.find(e=>e.id===id);drag={type:'point',id,handle,origin:handle==='radius'?null:[...e[handle]],before:clone(state.entities)};selectedEntity=id;$('#region-canvas').setPointerCapture(event.pointerId);return;}
   const near=state.entities.map(e=>({e,d:e.kind==='circle'?Math.abs(distance(p,e.center)-e.radius):(()=>{const a=e.a,b=e.b,t=Math.max(0,Math.min(1,((p[0]-a[0])*(b[0]-a[0])+(p[1]-a[1])*(b[1]-a[1]))/distance(a,b)**2));return distance(p,[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);})()})).sort((a,b)=>a.d-b.d)[0];if(near&&near.d<view.width/$('#region-canvas').clientWidth*10){selectedEntity=near.e.id;entityPanel();}return;
  }
  if(mode==='select'){const region=regions.find(r=>inRegion(p,r));if(region){record();state.selected=state.selected.includes(region.id)?state.selected.filter(id=>id!==region.id):[...state.selected,region.id];stopPreview();persist();draw();summary();}return;}
  if(!pending){pending=p;hover=p;draw();return;}
  if(distance(pending,p)<.001)return;
  record();const start=[...pending],e=mode==='circle'?{id:uid(),kind:'circle',center:start,radius:distance(start,p)}:{id:uid(),kind:'line',a:start,b:p};
  const closes=state.entities.some(e=>e.kind==='line'&&(distance(e.a,p)<1e-7||distance(e.b,p)<1e-7));state.entities.push(e);selectedEntity=e.id;pending=mode==='circle'||closes?null:p;recompute(true);entityPanel();axisOptions();
 });
 dialog.addEventListener('pointermove',event=>{
  if(working||staleDraft||!event.target.closest('#region-canvas'))return;
  if(drag?.type==='pan'){const factor=view.width/$('#region-canvas').clientWidth;view.x=drag.view.x-(event.clientX-drag.start[0])*factor;view.y=drag.view.y+(event.clientY-drag.start[1])*factor;draw();return;}
  if(drag?.type==='point'){
   // Avoid snapping a dragged point back onto its own old position.
   const p=pointer(event,false).map(n=>!event.altKey&&state.grid>0?Math.round(n/state.grid)*state.grid:n);state.entities=clone(drag.before);const e=state.entities.find(e=>e.id===drag.id);
   if(drag.handle==='radius')e.radius=Math.max(.005,distance(p,e.center));else{for(const other of state.entities)for(const key of other.kind==='line'?['a','b']:['center'])if(distance(other[key],drag.origin)<1e-7)other[key]=[...p];}
   recompute(true);return;
  }
  hover=pointer(event);draw();
 });
 dialog.addEventListener('pointerup',()=>{if(drag?.type==='point')entityPanel();drag=null;});
 dialog.addEventListener('pointercancel',()=>{if(drag?.type==='point'){state.entities=drag.before;history.pop();recompute(true);}drag=null;});
 dialog.addEventListener('contextmenu',event=>event.preventDefault());
 dialog.addEventListener('wheel',event=>{if(!event.target.closest('#region-canvas')||working)return;event.preventDefault();const p=pointer(event,false),factor=event.deltaY>0?1.15:1/1.15,newWidth=Math.min(20000,Math.max(.05,view.width*factor)),ratio=newWidth/view.width;view.x=p[0]+(view.x-p[0])*ratio;view.y=p[1]+(view.y-p[1])*ratio;view.width=newWidth;draw();},{passive:false});
 dialog.addEventListener('change',event=>{
  if(working||staleDraft)return;
  try{
   if(event.target.matches('[data-rs-element]')){selectedEntity=event.target.value;entityPanel();return;}
   if(event.target.matches('#region-name')){state.name=event.target.value.trim()||'Freie Skizze';persist();return;}
   if(event.target.matches('[data-rs-axis],[data-rs-axis-line],[data-rs-field="grid"],[data-rs-field="angle"],[data-rs-field="offset"]')){
    const values=settings();record();Object.assign(state,values);axisOptions();recompute();
   }
  }catch(e){error=e.message;summary();}
 });
 dialog.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||working)return;
  try{
   if(staleDraft){
    if(button.dataset.rsAction==='restore-draft'){state=clone(staleDraft.state);staleDraft=null;render();recompute();fit();return;}
    if(button.dataset.rsAction==='discard-draft'){staleDraft=null;render();recompute();return;}
    if(button.dataset.rsAction!=='close')return;
   }
   if(button.dataset.rsMode){mode=button.dataset.rsMode;pending=null;stopPreview();draw();summary();return;}
   const action=button.dataset.rsAction;
   if(action==='close'){persist();stopPreview();dialog.close();return;}
   if(action==='end-line'){pending=null;draw();return;}
   if(action==='fit'){fit();return;}
   if(action==='undo'||action==='redo'){const source=action==='undo'?history:future,target=action==='undo'?future:history;if(source.length){target.push(snapshot());state=source.pop();pending=null;render();recompute();}return;}
   if(action==='clear-selection'){record();state.selected=[];recompute();return;}
   if(action==='delete-element'){record();state.entities=state.entities.filter(e=>e.id!==selectedEntity);selectedEntity=null;recompute(true);entityPanel();axisOptions();return;}
   if(action==='edit-element'){
    const e=state.entities.find(e=>e.id===selectedEntity);if(!e)return;const next=clone(e);
    if(e.kind==='line'){next.a=[num('a0'),num('a1')];next.b=[num('b0'),num('b1')];}else{next.center=[num('c0'),num('c1')];next.radius=num('radius');}
    const entities=state.entities.map(o=>o.id===e.id?next:o);findRegions(entities);record();state.entities=entities;recompute(true);return;
   }
   if(action==='preview'){await showPreview();return;}
   if(action==='save'||action==='rotate'){
    if(JSON.stringify(getProject())!==baseline)throw new Error('Das Projekt wurde inzwischen geändert. Entwurf bleibt im Tab erhalten; Editor erneut öffnen.');
    const {next,target}=candidate(action==='rotate');setWorking(true);$('#region-result').textContent='Geometrie wird geprüft und gespeichert …';
    try{if(await commit(next,{fit:action==='rotate',message:action==='rotate'?'Ausgewählte Skizzenflächen rotiert':'Freie Skizze gespeichert'})){sessionStorage.removeItem(draftKey);stopPreview();dialog.close();if(target)onApplied?.(target.id);}else $('#region-result').textContent=getError();}finally{setWorking(false);}
   }
  }catch(e){$('#region-result').textContent=e.message;}
 });
 dialog.addEventListener('keydown',event=>{
  event.stopPropagation();if(working){if(event.key==='Escape')event.preventDefault();return;}
  if(event.key==='Escape'&&pending){event.preventDefault();pending=null;draw();}
  if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())&&!event.target.matches('input,select')){event.preventDefault();$(`[data-rs-action="${event.key.toLowerCase()==='y'||event.shiftKey?'redo':'undo'}"]`).click();}
 });
 dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();else{persist();stopPreview();}});
 new ResizeObserver(()=>{if(dialog.open&&!preview)draw();}).observe(dialog);
 return function open(sketchId,bodyId){
  if(!canOpen()){toast('Zuerst die laufende Bearbeitung übernehmen oder beenden.',true);return;}
  const project=getProject(),source=project.sketches?.find(s=>s.id===sketchId);body=bodyId?project.objects.find(o=>o.id===bodyId):project.objects.find(o=>o.kind==='region'&&o.sketchId===sketchId&&!o.generated);
  if(body?.locked){toast('Den Rotationskörper zuerst entsperren.',true);return;}
  baseline=JSON.stringify(project);state={id:source?.id??uid(),name:source?.name??'Freie Skizze',entities:clone(source?.entities??[]),selected:clone(body?.regions??[]),axis:body?.axis??'v',axisEntityId:body?.axisEntityId??'',offset:body?.params?.axisOffset??0,angle:body?.params?.revolveAngle??360,grid:1};
  draftKey=`formraum.region-draft.${getProjectId()}.${sketchId??'new'}`;
  staleDraft=null;try{const draft=JSON.parse(sessionStorage.getItem(draftKey));if(draft?.state){if(draft.baseline===baseline)state=draft.state;else staleDraft=draft;}}catch{}
  mode=source?'select':'line';pending=null;hover=null;drag=null;history=[];future=[];selectedEntity=null;error='';view={x:15,y:10,width:100};render();dialog.showModal();recompute();if(state.entities.length)fit();
 };
}
