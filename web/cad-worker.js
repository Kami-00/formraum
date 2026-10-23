import initOpenCascade from 'replicad-opencascadejs';
import wasmURL from 'replicad-opencascadejs/wasm?url';
import {setOC} from 'replicad';
import {createKernel} from './cad-kernel.js';
let kernel;
async function handle({id,operation,payload}){
  try{
    if(!kernel){const oc=await initOpenCascade({locateFile:()=>wasmURL});setOC(oc);kernel=createKernel(oc);}
    const result=await kernel(operation,payload);self.postMessage({id,result});
  }catch(error){self.postMessage({id,error:typeof error?.message==='string'?error.message:'Die CAD-Berechnung ist fehlgeschlagen. Bitte Maße und Geometrie prüfen.'});}
}
// STEP parsing is asynchronous. Serialize requests to protect the WASM filesystem.
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(()=>handle(data));};
