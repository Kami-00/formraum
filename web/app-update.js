// Activate a fully cached build only after an explicit click. Other tabs keep
// their work and get the same notice when another tab activates the update.
export async function setupAppUpdates({button,canReload,onBlocked,onError}){
 const serviceWorker=navigator.serviceWorker;
 let controller=serviceWorker.controller,available=false,activating=false,checking=false,timer;
 const offer=()=>{available=true;button.hidden=false;button.disabled=false;button.textContent='Neue Version verfügbar · Jetzt neu laden';};
 serviceWorker.addEventListener('controllerchange',()=>{
  const previous=controller;controller=serviceWorker.controller;
  if(activating){clearTimeout(timer);location.reload();}
  else if(previous)offer();
 });
 const registration=await serviceWorker.register(new URL('./sw.js',location.href),{updateViaCache:'none'});
 const inspect=()=>{if(registration.waiting&&serviceWorker.controller)offer();};
 const watch=()=>{const worker=registration.installing;if(worker)worker.addEventListener('statechange',inspect);inspect();};
 registration.addEventListener('updatefound',watch);watch();
 button.addEventListener('click',()=>{
  if(!available||activating)return;
  if(!canReload()){onBlocked();return;}
  // A different tab may already have activated the waiting worker.
  if(!registration.waiting){location.reload();return;}
  activating=true;button.disabled=true;button.textContent='Neue Version wird geladen …';
  timer=setTimeout(()=>{activating=false;offer();onError();},30000);
  registration.waiting.postMessage('ACTIVATE_UPDATE');
 });
 const check=async()=>{
  if(checking||document.visibilityState==='hidden'||!navigator.onLine)return;
  checking=true;
  try{await registration.update();inspect();}catch{/* Offline or temporary deployment failure: retain the current build. */}
  finally{checking=false;}
 };
 window.addEventListener('focus',check);
 window.addEventListener('online',check);
 document.addEventListener('visibilitychange',check);
 setInterval(check,60000);
 await serviceWorker.ready;
 return registration;
}
