import {defineConfig} from 'vite';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

// Include the WASM binary in the offline cache, with an atomic cache per build.
function offline(){
  let outDir;
  return {name:'formraum-offline',apply:'build',
    configResolved(config){outDir=path.resolve(config.root,config.build.outDir);},
    async closeBundle(){
      async function walk(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);result.push(...(entry.isDirectory()?await walk(file):[file]));}return result;}
      const files=(await walk(outDir)).filter(file=>!file.endsWith('/sw.js')).sort();
      const hash=createHash('sha256');for(const file of files)hash.update(await readFile(file));
      const version=`formraum-${hash.digest('hex').slice(0,16)}`;
      const assets=files.map(file=>'./'+path.relative(outDir,file).split(path.sep).join('/'));
      await writeFile(path.join(outDir,'sw.js'),`
const PREFIX='formraum:'+self.registration.scope+':';
const CACHE=PREFIX+${JSON.stringify(version)};
const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',event=>event.waitUntil((async()=>{
  try{const cache=await caches.open(CACHE);await cache.addAll(ASSETS);}
  catch(error){await caches.delete(CACHE);throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!event.request.url.startsWith(self.registration.scope))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const request=event.request.mode==='navigate'?new URL('index.html',self.registration.scope).href:event.request;
    return await cache.match(request)||fetch(event.request);
  })());
});
`);
    },
  };
}
export default defineConfig({root:'web',base:'./',plugins:[offline()],build:{outDir:'../dist',emptyOutDir:true},worker:{format:'es'}});
