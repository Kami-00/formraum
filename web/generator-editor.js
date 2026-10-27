import {SHAPES,shapeName} from './shapes.js';
import {resolveVariables,variableName} from './expressions.js';
import {expandGenerators} from './generators.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>structuredClone(value),uid=()=>crypto.randomUUID();
const input=(label,key,value)=>`<label class="field"><span>${esc(label)}</span><input type="text" data-gen-field="${key}" value="${esc(value)}" aria-label="${esc(label)}" autocomplete="off" spellcheck="false"></label>`;
const vector=(title,key,values)=>`<h4>${title}</h4><div class="fields-3">${['X','Y','Z'].map((axis,i)=>input(`${title} ${axis}`,`${key}.${i}`,values?.[i]??0)).join('')}</div>`;
const numericOrFormula=value=>value.trim()!==''&&Number.isFinite(Number(value))?Number(value):value.trim();

export function setupGeneratorEditor({getProject,getSelection,commit,canOpen,toast,getError}){
 const dialog=document.createElement('dialog');dialog.id='generator-dialog';dialog.className='generator-dialog';document.body.appendChild(dialog);
 let draft,baseline,activeGenerator=null,activeNode=null,applying=false;
 const generator=()=>draft.generators.find(g=>g.id===activeGenerator),node=()=>generator()?.nodes.find(n=>n.id===activeNode);
 const error=message=>{dialog.querySelector('#generator-status').textContent=message;};
 function readVariables(){
  const variables=Object.create(null);
  for(const row of dialog.querySelectorAll('[data-variable-row]')){
   const name=row.querySelector('[data-variable-name]').value.trim(),expression=row.querySelector('[data-variable-value]').value.trim();
   if(!name&&!expression)continue;variableName(name);if(Object.hasOwn(variables,name))throw new Error(`Variable doppelt: ${name}`);variables[name]=numericOrFormula(expression);
  }
  draft.variables=variables;
 }
 function readNode(){
  const current=node();if(!current)return;
  current.name=dialog.querySelector('[data-gen-field="name"]').value.trim()||'Element';
  current.parentId=dialog.querySelector('[data-gen-parent]').value||null;
  for(const key of ['position','rotation'])current[key]=[0,1,2].map(i=>numericOrFormula(dialog.querySelector(`[data-gen-field="${key}.${i}"]`).value));
  current.scale=numericOrFormula(dialog.querySelector('[data-gen-field="scale"]').value);
  if(current.body){
   current.body.hole=dialog.querySelector('[data-gen-hole]').checked;
   current.body.expressions??={};
   for(const el of dialog.querySelectorAll('[data-gen-param]')){
    const key=el.dataset.genParam,value=numericOrFormula(el.value);
    if(typeof value==='number'){current.body.params[key]=value;delete current.body.expressions[key];}else current.body.expressions[key]=value;
   }
  }
  const mode=dialog.querySelector('[data-gen-pattern]').value,pattern=current.pattern??={mode:'none'};pattern.mode=mode;current.pattern=pattern;
  const count=dialog.querySelector('[data-gen-field="count"]');if(count)pattern.count=numericOrFormula(count.value);
  if(mode==='linear'&&dialog.querySelector('[data-gen-field="step.0"]'))pattern.step=[0,1,2].map(i=>numericOrFormula(dialog.querySelector(`[data-gen-field="step.${i}"]`).value));
  if(mode==='circular'&&dialog.querySelector('[data-gen-axis]')){
   pattern.axis=dialog.querySelector('[data-gen-axis]').value;pattern.angle=numericOrFormula(dialog.querySelector('[data-gen-field="angle"]').value);
   pattern.center=[0,1,2].map(i=>numericOrFormula(dialog.querySelector(`[data-gen-field="center.${i}"]`).value));
  }
 }
 function capture(){readVariables();readNode();}
 function childrenOf(id){const result=new Set([id]);let size;do{size=result.size;for(const n of generator().nodes)if(result.has(n.parentId))result.add(n.id);}while(result.size!==size);return result;}
 function nodeForm(){
  const current=node();if(!current)return '<p class="muted">Lege einen Generator an oder übernimm ausgewählte Körper.</p>';
  const descendants=childrenOf(current.id),pattern=current.pattern??{mode:'none'};
  return `<div class="generator-node-heading"><h3>${current.body?esc(shapeName(current.body.kind)):'Gruppe mit Children'}</h3><button data-gen-action="delete-node" class="subtle-button">Element + Kinder löschen</button></div>
   ${input('Elementname','name',current.name)}<label class="field"><span>Elternelement</span><select data-gen-parent aria-label="Elternelement"><option value="">Keines · Weltkoordinaten</option>${generator().nodes.filter(n=>!descendants.has(n.id)).map(n=>`<option value="${esc(n.id)}" ${n.id===current.parentId?'selected':''}>${esc(n.name)}</option>`).join('')}</select></label>
   <p class="tip">Position und Drehung sind relativ zum Elternteil. Beim Wechsel bleiben diese lokalen Werte erhalten. Muster wiederholen das Element einschließlich aller Kinder.</p>
   ${current.body?`<h4>Maße · mm oder Formel</h4>${Object.entries(current.body.params??{}).filter(([,value])=>typeof value==='number').map(([key,value])=>`<label class="field"><span>${esc(SHAPES[current.body.kind]?.fields.find(f=>f[0]===key)?.[1]??key)}</span><input type="text" data-gen-param="${esc(key)}" aria-label="Generator Maß ${esc(key)}" value="${esc(current.body.expressions?.[key]??value)}" spellcheck="false"></label>`).join('')}<label class="locked-dimension"><input type="checkbox" data-gen-hole ${current.body.hole?'checked':''}> Bohrkörper · vom Export ausschließen</label>${!SHAPES[current.body.kind]?'<p class="tip">Die vorhandene Geometrie und der Modellverlauf bleiben erhalten. Konturen und Modellschritte vor dem Übernehmen bearbeiten.</p>':''}`:''}
   ${vector('Position','position',current.position)}${vector('Drehung °','rotation',current.rotation)}${input('Skalierung','scale',current.scale??1)}
   <h4>Assoziatives Muster</h4><label class="field"><span>Musterart</span><select data-gen-pattern aria-label="Musterart">${[['none','Kein Muster'],['linear','Linear'],['circular','Kreisförmig']].map(([value,label])=>`<option value="${value}" ${value===pattern.mode?'selected':''}>${label}</option>`).join('')}</select></label>
   ${pattern.mode!=='none'?input('Anzahl einschließlich Original','count',pattern.count??2):''}
   ${pattern.mode==='linear'?vector('Schritt','step',pattern.step??[20,0,0]):''}
   ${pattern.mode==='circular'?`<label class="field"><span>Kreisachse</span><select data-gen-axis aria-label="Kreisachse">${['x','y','z'].map(axis=>`<option ${axis===(pattern.axis??'z')?'selected':''}>${axis}</option>`).join('')}</select></label>${input('Gesamtwinkel °','angle',pattern.angle??360)}${vector('Kreiszentrum','center',pattern.center)}`:''}
   <p class="tip">Bei 360° wird der Endpunkt nicht doppelt gesetzt. Das Kreiszentrum liegt im Koordinatensystem des Elternteils.</p>`;
 }
 function tree(){
  const current=generator();if(!current)return '';
  const depth=n=>{let level=0,seen=new Set();while(n?.parentId&&!seen.has(n.id)&&level<8){seen.add(n.id);level++;n=current.nodes.find(p=>p.id===n.parentId);}return level;};
  // Display depth-first even when a child was created before its parent.
  const ordered=[],visited=new Set();const walk=n=>{if(visited.has(n.id))return;visited.add(n.id);ordered.push(n);current.nodes.filter(c=>c.parentId===n.id).forEach(walk);};
  current.nodes.filter(n=>!n.parentId).forEach(walk);current.nodes.forEach(walk);
  return ordered.map(n=>`<button data-gen-node="${esc(n.id)}" class="generator-tree-node ${n.id===activeNode?'active':''}" style="padding-left:${10+depth(n)*14}px"><span>${n.body?'◇':'▾'} ${esc(n.name)}</span><small>${n.pattern?.mode&&n.pattern.mode!=='none'?'Muster':''}</small></button>`).join('');
 }
 function render(){
  dialog.innerHTML=`<header><div><span class="eyebrow">PARAMETRISCH KONSTRUIEREN</span><h2>Variablen & Generatoren</h2></div><button class="icon-button" data-gen-action="close" aria-label="Generator schließen">×</button></header>
   <div class="generator-layout"><section class="generator-library"><h3>Projektvariablen</h3><p class="tip">Beispiel: breite = 20, abstand = breite + 5. Punkt als Dezimalzeichen, Winkel in Grad.</p><div id="generator-variables">${Object.entries(draft.variables??{}).map(([name,value])=>variableRow(name,value)).join('')}</div><button data-gen-action="add-variable" class="subtle-button">+ Variable</button><details><summary>Formeln</summary><p class="tip">+ − * / % ^ und Klammern; pi, e; sin, cos, tan (Grad), abs, sqrt, floor, ceil, round; min(a,b), max(a,b), pow(a,b). Namen: Buchstaben, Ziffern und Unterstriche.</p></details><h3>Generatoren</h3><select data-gen-select aria-label="Generator auswählen"><option value="">Generator wählen</option>${draft.generators.map(g=>`<option value="${esc(g.id)}" ${g.id===activeGenerator?'selected':''}>${esc(g.name)}</option>`).join('')}</select><div class="generator-buttons"><button data-gen-action="new" class="subtle-button">+ Generator</button><button data-gen-action="from-selection" class="subtle-button">Auswahl übernehmen</button><button data-gen-action="example" class="subtle-button">Beispiel: Kreis-Muster</button></div>${generator()?`<label class="field"><span>Generatorname</span><input data-gen-name value="${esc(generator().name)}" aria-label="Generatorname"></label><nav class="generator-tree" aria-label="Eltern und Children">${tree()}</nav><div class="generator-buttons"><button data-gen-action="add-group" class="subtle-button">+ Gruppe</button><select data-gen-shape aria-label="Neue Generatorform">${Object.entries(SHAPES).map(([kind,s])=>`<option value="${kind}">${esc(s.name)}</option>`).join('')}</select><button data-gen-action="add-body" class="subtle-button">+ Körper als Kind</button><button data-gen-action="detach" class="subtle-button">In freie Körper umwandeln</button><button data-gen-action="delete-generator" class="subtle-button">Generator löschen</button></div>`:''}</section><section class="generator-properties">${nodeForm()}</section></div>
   <footer><p id="generator-status" role="status">Änderungen werden erst mit „Berechnen & ansehen“ übernommen. Maximal 30 Körper insgesamt.</p><button class="primary" data-gen-action="apply">Berechnen & ansehen</button></footer>`;
 }
 function variableRow(name='',value=''){return `<div data-variable-row class="generator-variable-row"><input data-variable-name aria-label="Variablenname" placeholder="breite" value="${esc(name)}"><input data-variable-value aria-label="Variablenwert oder Formel" placeholder="20" value="${esc(value)}"><button data-gen-action="remove-variable" class="icon-button" aria-label="Variable entfernen">×</button></div>`;}
 function addGenerator(name='Generator'){
  const root={id:uid(),name:'Elternteil',position:[0,0,0],rotation:[0,0,0],scale:1};
  const g={id:uid(),name,nodes:[root]};draft.generators.push(g);activeGenerator=g.id;activeNode=root.id;return g;
 }
 dialog.addEventListener('input',event=>{if(event.target.matches('[data-gen-name]'))generator().name=event.target.value;});
 dialog.addEventListener('change',event=>{
  try{
   if(event.target.matches('[data-gen-select]')){capture();activeGenerator=event.target.value;activeNode=generator()?.nodes[0]?.id;render();}
   else if(event.target.matches('[data-gen-pattern],[data-gen-parent]')){capture();render();}
  }catch(e){error(e.message);}
 });
 dialog.addEventListener('click',async event=>{
  if(applying)return;
  const button=event.target.closest('button');if(!button)return;
  try{
   const action=button.dataset.genAction;
   if(action==='close'){dialog.close();return;}
   if(action==='remove-variable'){button.closest('[data-variable-row]').remove();return;}
   if(action==='add-variable'){dialog.querySelector('#generator-variables').insertAdjacentHTML('beforeend',variableRow());return;}
   capture();
   if(button.dataset.genNode){activeNode=button.dataset.genNode;render();return;}
   if(action==='new')addGenerator();
   if(action==='from-selection'){
    const selected=getSelection(),sources=draft.objects.filter(o=>selected.includes(o.id));
    if(!sources.length)throw new Error('Zuerst freie Körper im Modell auswählen.');
    if(sources.some(o=>o.locked||o.generated))throw new Error('Nur ungesperrte, freie Körper übernehmen.');
    const g=addGenerator('Auswahl'),root=g.nodes[0];
    for(const body of sources){const source=clone(body);delete source.id;const n={id:uid(),name:body.name,parentId:root.id,position:body.position??[0,0,0],rotation:body.rotation??[0,0,0],scale:body.scale??1,body:{...source,position:[0,0,0],rotation:[0,0,0],scale:1}};g.nodes.push(n);}
    draft.objects=draft.objects.filter(o=>!selected.includes(o.id));
   }
   if(action==='add-group'||action==='add-body'){
    const current=generator();if(!current)throw new Error('Zuerst einen Generator anlegen.');
    const n={id:uid(),name:'Gruppe',parentId:activeNode||null,position:[0,0,0],rotation:[0,0,0],scale:1};
    if(action==='add-body'){const kind=dialog.querySelector('[data-gen-shape]').value,s=SHAPES[kind];n.name=s.name;n.body={kind,name:s.name,params:clone(s.params),features:[],color:s.color};}
    current.nodes.push(n);activeNode=n.id;
   }
   if(action==='delete-node'){
    const deleted=childrenOf(activeNode),remaining=generator().nodes.filter(n=>!deleted.has(n.id));
    if(!remaining.length)throw new Error('Ein Generator braucht mindestens ein Element. Stattdessen den Generator löschen.');
    generator().nodes=remaining;
    activeNode=generator().nodes[0].id;
   }
   if(action==='delete-generator'){
    draft.generators=draft.generators.filter(g=>g.id!==activeGenerator);draft.objects=draft.objects.filter(o=>o.generated?.generatorId!==activeGenerator);activeGenerator=draft.generators[0]?.id;activeNode=generator()?.nodes[0]?.id;
   }
   if(action==='detach'){
    // Evaluate the edited generator, not stale cached copies; the CAD commit still validates every body.
    const expanded=expandGenerators(draft);
    const bodies=expanded.objects.filter(o=>o.generated?.generatorId===activeGenerator).map(o=>{delete o.generated;o.locked=false;return o;});
    draft.objects=draft.objects.filter(o=>o.generated?.generatorId!==activeGenerator).concat(bodies);draft.generators=draft.generators.filter(g=>g.id!==activeGenerator);activeGenerator=draft.generators[0]?.id;activeNode=generator()?.nodes[0]?.id;
   }
   if(action==='example'){
    let suffix=1;while(Object.hasOwn(draft.variables,`anzahl${suffix}`)||Object.hasOwn(draft.variables,`radius${suffix}`)||Object.hasOwn(draft.variables,`durchmesser${suffix}`))suffix++;
    Object.assign(draft.variables,{[`anzahl${suffix}`]:6,[`radius${suffix}`]:30,[`durchmesser${suffix}`]:6});
    const g=addGenerator('Kreisgenerator'),root=g.nodes[0];root.pattern={mode:'circular',count:`anzahl${suffix}`,axis:'z',angle:360,center:[0,0,0]};
    g.nodes.push({id:uid(),name:'Zylinder',parentId:root.id,position:[`radius${suffix}`,0,0],body:{kind:'cylinder',params:{radius:3,height:8},expressions:{radius:`durchmesser${suffix} / 2`},features:[],color:'#b1a3c9'}});
    activeNode=g.nodes[1].id;
   }
   if(action==='apply'){
    resolveVariables(draft.variables);
    if(JSON.stringify(getProject())!==baseline)throw new Error('Das Projekt wurde inzwischen geändert. Editor schließen und erneut öffnen.');
    applying=true;dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);error('Generatoren werden berechnet …');
    try{if(await commit(draft,{message:'Variablen und Generatoren übernommen',fit:true})){dialog.close();}else error(`Änderung nicht übernommen: ${getError?.()||'Ungültige Geometrie.'}`);}finally{applying=false;dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}
    return;
   }
   render();
  }catch(e){error(e.message);}
 });
 dialog.addEventListener('cancel',event=>{if(applying)event.preventDefault();});
 return function open(generatorId){
  if(!canOpen()){toast('Zuerst die laufende Bearbeitung beenden.',true);return;}
  baseline=JSON.stringify(getProject());draft=clone(getProject());draft.variables??={};draft.generators??=[];
  activeGenerator=generatorId||draft.generators[0]?.id;activeNode=generator()?.nodes[0]?.id;render();dialog.showModal();
 };
}
