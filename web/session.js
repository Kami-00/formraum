export function setupSession(api){
 const $=s=>document.querySelector(s);
 let socket=null,connected=false;
 const log=message=>{const p=document.createElement('p');p.textContent=new Date().toLocaleTimeString('de-DE')+' · '+message;$('#session-log').prepend(p);while($('#session-log').children.length>20)$('#session-log').lastChild.remove();};
 function status(message,active=false){
  connected=active;$('#session-status').textContent=message;$('#session-button').textContent=active?'KI verbunden':'KI verbinden';$('#session-button').classList.toggle('connected',active);
  $('#session-connect').disabled=active;$('#session-disconnect').disabled=!socket;
 }
 function disconnect(){const old=socket;socket=null;old?.close();status('Nicht verbunden');}
 $('#session-button').onclick=()=>$('#session-dialog').showModal();
 $('#session-disconnect').onclick=()=>{disconnect();log('Verbindung getrennt');};
 $('#session-connect').onclick=()=>{
  const port=Number($('#session-port').value),token=$('#session-token').value.trim();
  if(!Number.isInteger(port)||port<1024||port>65535||!/^[a-f0-9]{64}$/.test(token)){status('Bitte gültigen Port und Verbindungscode eingeben.');return;}
  disconnect();
  const ws=new WebSocket(`ws://127.0.0.1:${port}/session`);socket=ws;status('Verbinde mit lokalem MCP-Client …');
  const timer=setTimeout(()=>{if(socket===ws&&!connected){disconnect();status('Verbindung nicht möglich. MCP-Client starten und lokalen Netzwerkzugriff im Browser erlauben.');}},10000);
  ws.onopen=()=>ws.send(JSON.stringify({type:'hello',token}));
  ws.onclose=()=>{clearTimeout(timer);if(socket!==ws)return;const wasConnected=connected;socket=null;status(wasConnected?'Verbindung beendet. Zum Verbinden den aktuellen Sitzungscode verwenden.':'Keine Verbindung. MCP-Client starten, Code prüfen und lokalen Netzwerkzugriff im Browser erlauben.');};
  ws.onerror=()=>{if(socket===ws)status('Lokale Brücke nicht erreichbar. MCP-Client starten; gegebenenfalls lokalen Netzwerkzugriff erlauben.');};
  ws.onmessage=async({data})=>{
   if(socket!==ws)return;
   let message;try{message=JSON.parse(data);}catch{return;}
   if(message.type==='ready'){clearTimeout(timer);status('Verbunden · dieser Tab ist freigegeben',true);$('#session-token').value='';log('Lokaler MCP-Client verbunden');return;}
   if(message.type!=='request'||!connected)return;
   try{
    let result;
    if(message.method==='list')result={projects:api.list()};
    else if(message.method==='get')result=api.state();
    else if(message.method==='view')result={image:api.view()};
    else{result=await api.action(message.method,message.args);log(`KI: ${({apply:'Modell geändert',open:'Projekt geöffnet',create:'Projekt erstellt',undo:'Schritt rückgängig'})[message.method]||message.method}`);}
    if(socket===ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({id:message.id,result}));
   }catch(error){log('Anfrage abgewiesen: '+error.message);if(socket===ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({id:message.id,error:error.message}));}
  };
 };
 // A connection link only pre-fills the dialog; the user still explicitly connects.
 if(location.hash.startsWith('#mcp=')){
  const params=new URLSearchParams(location.hash.slice(1));$('#session-token').value=params.get('mcp')||'';$('#session-port').value=params.get('port')||'8788';
  history.replaceState(null,'',location.pathname+location.search);$('#session-dialog').showModal();
 }
}
