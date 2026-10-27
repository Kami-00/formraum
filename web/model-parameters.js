import {evaluateExpression} from './expressions.js';
import {readPath,writePath} from './sketch-solver.js';
const roots=['params','profile','contours','features','sweepPath','position','rotation','scale','offset','density','depth','radius','thickness','distance','pattern'];
const excluded=new Set(['reference','references','face','edges','supportRectangle','id','sketchId','regions','regionKeys','rollback','targetId','sourceFeature']);
export function numericMeasures(body){const result=[];function walk(value,path){if(typeof value==='number'&&Number.isFinite(value))result.push({path,value});else if(value&&typeof value==='object')for(const [key,next]of Object.entries(value))if(!excluded.has(key)&&key!=='bindings'&&key!=='expressions')walk(next,path+'.'+key);}for(const key of roots)if(body[key]!=null)walk(body[key],key);return result;}
export function bindMeasures(body,values){
 const copy=structuredClone(body);if(Object.keys(copy.bindings??{}).length>256)throw new Error('Maximal 256 Maßformeln je Körper.');
 // Store feature formulas on the feature so history reordering cannot retarget them.
 for(const [path,expression]of Object.entries(copy.bindings??{})){const match=/^features\.(\d+)\.(.+)$/.exec(path);if(match){const f=copy.features?.[Number(match[1])];if(!f)throw new Error('Formelbezug fehlt: '+path);f.bindings??={};f.bindings[match[2]]=expression;delete copy.bindings[path];}}
 const allowed=new Set(numericMeasures(copy).map(p=>p.path));for(const [path,expression] of Object.entries(copy.bindings??{})){if(!allowed.has(path))throw new Error('Formelbezug fehlt: '+path);writePath(copy,path,evaluateExpression(expression,n=>values[n]));}
 if(copy.features)copy.features=copy.features.map(f=>bindMeasures(f,values));return copy;
}
export function measureBindings(body){return {...Object.fromEntries(Object.entries(body.expressions??{}).map(([key,value])=>['params.'+key,value])),...body.bindings,...Object.fromEntries((body.features??[]).flatMap((f,i)=>Object.entries(measureBindings(f)).map(([key,value])=>['features.'+i+'.'+key,value])))};}
export function unbindMeasure(body,path){if(body.bindings)delete body.bindings[path];if(path.startsWith('params.')&&body.expressions)delete body.expressions[path.slice(7)];const match=/^features\.(\d+)\.(.+)$/.exec(path);if(match&&body.features?.[Number(match[1])])unbindMeasure(body.features[Number(match[1])],match[2]);}

// Explicit numeric edits release the corresponding formula; other bindings survive.
export function releaseChangedMeasures(before,after){for(const [path]of Object.entries(after.bindings??{})){if(readPath(before,path)!==readPath(after,path))delete after.bindings[path];}for(let i=0;i<(after.features??[]).length;i++)if(before.features?.[i])releaseChangedMeasures(before.features[i],after.features[i]);}
export function assignMeasureFormula(body,path,raw,values){const allowed=new Set(numericMeasures(body).map(m=>m.path));if(!allowed.has(path))throw new Error('Unbekannter Maßpfad.');writePath(body,path,evaluateExpression(raw,n=>values[n]));unbindMeasure(body,path);const match=/^features\.(\d+)\.(.+)$/.exec(path);if(match){assignMeasureFormula(body.features[Number(match[1])],match[2],raw,values);return;}body.bindings??={};if(!Number.isFinite(Number(raw)))body.bindings[path]=raw;}
