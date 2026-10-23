import http from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';

export async function createBridge({port=8788,origins=['https://kami-00.github.io','http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:4173','http://localhost:4173']}={}){
 const token=randomBytes(32).toString('hex'),pending=new Map();let active=null;
 const server=http.createServer((req,res)=>{res.writeHead(404).end();});
 const wss=new WebSocketServer({noServer:true,maxPayload:40*1024*1024});
 server.on('upgrade',(req,socket,head)=>{
  if(req.headers.host!==`127.0.0.1:${server.address().port}`||req.url!=='/session'||!origins.includes(req.headers.origin)){
   socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
  }
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
 });
 const rejectPending=()=>{for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(new Error('Browser-Verbindung getrennt. Eine laufende Änderung könnte bereits ausgeführt sein. Vor einem erneuten Versuch den Projektstand lesen.'));}pending.clear();};
 wss.on('connection',ws=>{
  let authorized=false;const timer=setTimeout(()=>ws.close(1008,'Pairing timeout'),5000);
  ws.on('error',()=>{});
  ws.on('message',data=>{
   let message;try{message=JSON.parse(data.toString());}catch{ws.close(1008,'Invalid message');return;}
   if(!authorized){
    if(message?.type!=='hello'||typeof message.token!=='string'||!/^[a-f0-9]{64}$/.test(message.token)||!timingSafeEqual(Buffer.from(message.token),Buffer.from(token))||active){ws.close(1008,'Pairing rejected');return;}
    clearTimeout(timer);authorized=true;active=ws;ws.send(JSON.stringify({type:'ready'}));return;
   }
   const request=pending.get(message?.id);if(!request)return;
   clearTimeout(request.timer);pending.delete(message.id);
   message.error?request.reject(new Error(String(message.error))):request.resolve(message.result);
  });
  ws.on('close',()=>{clearTimeout(timer);if(active===ws){active=null;rejectPending();}});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {
  connection(){const port=server.address().port;return {connected:active?.readyState===WebSocket.OPEN,port,code:token,url:`https://kami-00.github.io/formraum/#mcp=${token}&port=${port}`,instructions:'Open the URL in the same browser/profile as your projects, then explicitly click Diesen Tab verbinden. Keep that tab open. Only one tab may connect at once.'};},
  request(method,args={}){
   if(active?.readyState!==WebSocket.OPEN)return Promise.reject(new Error('Kein Browser verbunden. formraum_connection aufrufen und den Tab koppeln.'));
   // Refuse parallel operations rather than applying queued edits to a newer state.
   if(pending.size)return Promise.reject(new Error('Eine Browser-Anfrage läuft bereits. Bitte deren Ergebnis abwarten.'));
   const id=randomUUID();return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Browser antwortet nicht. Ausführung ungewiss; erst Projektstand lesen, nicht blind wiederholen.'));},125000);
    pending.set(id,{resolve,reject,timer});active.send(JSON.stringify({type:'request',id,method,args}));
   });
  },
  async close(){rejectPending();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));},
 };
}
