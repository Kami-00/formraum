// A preview owns its worker. Cancelling it never interrupts the main CAD client.
export function createPreviewClient(){
 let worker=null,pending=null,sequence=0,disposed=false;
 const errorOf=(error,fallback)=>error instanceof Error?error:new Error(typeof error?.message==='string'?error.message:fallback);
 function settle(request,error,result){
  if(!request||pending!==request)return;
  pending=null;clearTimeout(request.timer);
  error?request.reject(error):request.resolve(result);
 }
 function stop(error){
  const target=worker;worker=null;
  if(target){
   target.onmessage=null;target.onerror=null;target.onmessageerror=null;
   try{target.terminate();}catch{/* Settle the request even if termination fails. */}
  }
  settle(pending,error);
 }
 function start(){
  if(worker)return worker;
  const target=new Worker(new URL('./cad-worker.js',import.meta.url),{type:'module'});worker=target;
  target.onmessage=({data})=>{
   if(worker!==target||!pending||data?.id!==pending.id)return;
   settle(pending,data.error?new Error(String(data.error)):null,data.result);
  };
  target.onerror=()=>{if(worker===target)stop(new Error('Der CAD-Kern für die Vorschau konnte nicht geladen werden. Bitte erneut versuchen.'));};
  target.onmessageerror=()=>{if(worker===target)stop(new Error('Die Antwort der Vorschau konnte nicht gelesen werden. Bitte erneut versuchen.'));};
  return target;
 }
 return {
  calculate(project){
   if(disposed)return Promise.reject(new Error('Die Vorschau wurde beendet.'));
   if(pending)return Promise.reject(new Error('Eine Vorschau wird bereits berechnet.'));
   return new Promise((resolve,reject)=>{
    const request={id:++sequence,resolve,reject,timer:null};pending=request;
    try{
     const target=start();
     request.timer=setTimeout(()=>{if(worker===target&&pending===request)stop(new Error('Vorschau nach 120 Sekunden abgebrochen. Bitte mit einfacheren Maßen erneut versuchen.'));},120000);
     target.postMessage({id:request.id,operation:'model',payload:{project}});
    }catch(error){stop(errorOf(error,'Die Vorschau konnte nicht gestartet werden.'));}
   });
  },
  dispose(){
   if(disposed)return;disposed=true;
   stop(new Error('Die Vorschau wurde beendet.'));
  },
 };
}
