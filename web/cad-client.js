// The UI sends data to a local Web Worker; no model data leaves the browser.
let worker, sequence=0;
const pending=new Map();
function stop(message){
  worker?.terminate();worker=null;
  for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(new Error(message));}
  pending.clear();
}
function start(){
  if(worker)return;
  worker=new Worker(new URL('./cad-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    const request=pending.get(data.id);if(!request)return;
    clearTimeout(request.timer);pending.delete(data.id);
    data.error?request.reject(new Error(data.error)):request.resolve(data.result);
  };
  worker.onerror=()=>stop('Der Browser-CAD-Kern konnte nicht geladen werden. Bitte die Seite neu laden.');
  worker.onmessageerror=()=>stop('Antwort des CAD-Kerns konnte nicht gelesen werden. Bitte erneut versuchen.');
}
export function calculate(operation,payload={}){
  start();const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>stop('Berechnung nach 120 Sekunden abgebrochen. Der letzte gültige Stand bleibt erhalten; bitte mit einfacheren Maßen erneut versuchen.'),120000);
    pending.set(id,{resolve,reject,timer});worker.postMessage({id,operation,payload});
  });
}
