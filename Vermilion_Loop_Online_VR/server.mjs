import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {createSimulation} from './simulation.mjs';

const root=fileURLToPath(new URL('./public/',import.meta.url));
const portArgument=process.argv.indexOf('--port');
const PORT=Number(portArgument>=0?process.argv[portArgument+1]:process.env.PORT||3000),MAX_ROOMS=Number(process.env.MAX_ROOMS||4);
const rooms=new Map(),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const allowedOrigins=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
const send=(ws,msg)=>{if(ws?.readyState===WebSocket.OPEN && ws.bufferedAmount<500000)ws.send(JSON.stringify(msg));};
const fail=(ws,message)=>send(ws,{type:'error',message});
const num=(v,lo,hi,fallback=0)=>typeof v==='number'&&Number.isFinite(v)?Math.min(hi,Math.max(lo,v)):fallback;

const server=http.createServer((req,res)=>{
  const headers={'X-Content-Type-Options':'nosniff','Permissions-Policy':'xr-spatial-tracking=(self), microphone=()',
    'Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' blob:; frame-ancestors 'none'"};
  let url;
  try{url=decodeURIComponent(new URL(req.url,'http://local').pathname);}catch{res.writeHead(400);return res.end('Bad request');}
  if(url==='/health'){res.writeHead(200,{...headers,'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size}));}
  if(url==='/favicon.ico'){res.writeHead(204,headers);return res.end();}
  const filename=path.resolve(root,'.'+(url==='/'?'/index.html':url));
  if(!filename.startsWith(root)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404,headers);return res.end('Not found');}
  res.writeHead(200,{...headers,'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-cache'});
  fs.createReadStream(filename).pipe(res);
});
const wss=new WebSocketServer({server,path:'/ws',maxPayload:32768,perMessageDeflate:false});

function roomStatus(room){return room.seats.map(s=>s?{connected:!!s.ws,ready:s.ready,device:s.device}:null);}
function broadcastStatus(room){for(const s of room.seats)send(s?.ws,{type:'status',seats:roomStatus(room)});}
function makeSeat(ws){return {ws,token:randomBytes(24).toString('hex'),ready:false,device:'desktop',queue:[],actions:[],ack:0,lastSeq:0,disconnectedAt:0};}
function welcome(ws,room,index){
  ws.room=room;ws.seat=index;
  const seat=room.seats[index];seat.ws=ws;seat.ready=false;seat.queue=[];seat.actions=[];seat.lastSeq=0;seat.ack=0;seat.disconnectedAt=0;
  send(ws,{type:'welcome',room:room.code,index,token:seat.token,level:room.level,mode:room.mode,seats:roomStatus(room),snapshot:room.sim.snapshot()});
  broadcastStatus(room);
}
function validToken(a,b){return typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function sanitizeCommand(c){return {seq:Math.floor(num(c.seq,1,1e10)),forward:num(c.forward,-1,1),side:num(c.side,-1,1),sprint:!!c.sprint,
  jumpPressed:!!c.jumpPressed,yaw:num(c.yaw,-1e6,1e6),pitch:num(c.pitch,-1.45,1.45),roomDX:num(c.roomDX,-0.4,0.4),roomDZ:num(c.roomDZ,-0.4,0.4),
  hands:Array.isArray(c.hands)?c.hands.slice(0,2).filter(h=>h&&Array.isArray(h.offset)&&h.offset.length===3&&h.offset.every(Number.isFinite)&&Array.isArray(h.rotation)&&h.rotation.length===4&&h.rotation.every(Number.isFinite)).map(h=>({offset:h.offset.map(v=>num(v,-24,24)),rotation:h.rotation.map(v=>num(v,-1,1))})):[]};}
function sanitizeAction(a,room,seat){
  if(!a||!['build','charge-start','charge-end'].includes(a.type))return null;
  const out={type:a.type};if(a.type==='build')out.yaw=num(a.yaw,-1e6,1e6);
  if(a.type==='charge-end'){
    if(Array.isArray(a.direction)&&a.direction.length===3&&a.direction.every(Number.isFinite)){
      const l=Math.hypot(...a.direction);if(l>0.01)out.direction=a.direction.map(v=>v/l);
    }
    if(Array.isArray(a.origin)&&a.origin.length===3&&a.origin.every(Number.isFinite))out.origin=a.origin.map(v=>num(v,-10000,10000));
  }
  return out;
}

wss.on('connection',(ws,req)=>{
  // Browser connections must originate from this service. Native clients may omit Origin.
  if(req.headers.origin&&!allowedOrigins.includes(req.headers.origin)){
    try{const host=req.headers['x-forwarded-host']||req.headers.host;if(new URL(req.headers.origin).host!==host){ws.close(1008,'Origin rejected');return;}}
    catch{ws.close(1008,'Origin rejected');return;}
  }
  ws.alive=true;ws.rateAt=Date.now();ws.rate=0;ws.on('pong',()=>ws.alive=true);
  ws.on('message',data=>{
    if(Date.now()-ws.rateAt>1000){ws.rateAt=Date.now();ws.rate=0;}
    if(++ws.rate>100){ws.close(1008,'Too many messages');return;}
    let msg;try{msg=JSON.parse(data);}catch{return fail(ws,'Invalid message.');}
    if(!msg||typeof msg!=='object')return;
    if(msg.type==='ping')return send(ws,{type:'pong',at:msg.at});
    if(msg.type==='create'){
      if(ws.room)return fail(ws,'Leave the current room first.');
      if(rooms.size>=MAX_ROOMS)return fail(ws,'This server is full. Try again when a room closes.');
      const level=['forest','city','skyline','mountains'].includes(msg.level)?msg.level:'forest';
      const mode=['survey','race','freefly'].includes(msg.mode)?msg.mode:'survey';
      let code;do{code=randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(rooms.has(code));
      try{
        const room={code,level,mode,seats:[makeSeat(ws),null],sim:createSimulation(level,mode),createdAt:Date.now(),tick:0};
        rooms.set(code,room);welcome(ws,room,0);
      }catch(e){console.error('Room creation failed:',e);fail(ws,'The world could not start. Check the server log.');}
      return;
    }
    if(msg.type==='join'){
      if(ws.room)return fail(ws,'Leave the current room first.');
      const room=rooms.get(String(msg.room||'').toUpperCase().trim());
      if(!room)return fail(ws,'That room was not found. Check the six-character code.');
      if(msg.token){
        const index=room.seats.findIndex(s=>s&&validToken(msg.token,s.token));
        if(index>=0){
          if(room.seats[index].ws && room.seats[index].ws!==ws){room.seats[index].ws.room=null;room.seats[index].ws.close(1000,'Session resumed elsewhere');}
          welcome(ws,room,index);return;
        }
      }
      if(room.seats[1])return fail(ws,'This room already has two players.');
      room.seats[1]=makeSeat(ws);welcome(ws,room,1);return;
    }
    const room=ws.room,seat=room?.seats[ws.seat];
    if(!seat||seat.ws!==ws)return;
    if(msg.type==='ready'){seat.ready=true;seat.device=msg.device==='vr'?'vr':'desktop';broadcastStatus(room);return;}
    if(msg.type==='leave'){
      for(const s of room.seats){if(s?.ws){if(s.ws!==ws)send(s.ws,{type:'ended',message:'Your friend left the room. Return to the menu to start a new game.'});s.ws.room=null;}}
      rooms.delete(room.code);return;
    }
    if(msg.type==='input'&&Array.isArray(msg.commands)){
      for(const raw of msg.commands.slice(0,8)){
        const command=sanitizeCommand(raw||{});if(command.seq<=seat.lastSeq)continue;
        seat.lastSeq=command.seq;seat.queue.push(command);
      }
      if(seat.queue.length>100){seat.queue=seat.queue.slice(-8);}
    }
    if(msg.type==='action'){
      const a=sanitizeAction(msg.action,room,seat);
      if(a&&seat.actions.length<8)seat.actions.push(a);
    }
  });
  ws.on('error',()=>{});
  ws.on('close',()=>{const room=ws.room,seat=room?.seats[ws.seat];if(seat?.ws===ws){seat.ws=null;seat.ready=false;seat.queue=[];seat.actions=[];seat.disconnectedAt=Date.now();broadcastStatus(room);}});
});

let last=performance.now(),accumulator=0;
const timer=setInterval(()=>{
  const now=performance.now();accumulator+=Math.min((now-last)/1000,0.1);last=now;
  let cycles=0;
  while(accumulator>=1/60&&cycles++<6){
    accumulator-=1/60;
    for(const room of rooms.values()){
      const running=room.seats.length===2&&room.seats.every(s=>s?.ws&&s.ready);
      if(running){
        for(let i=0;i<2;i++){
          const s=room.seats[i],c=s.queue.shift();
          if(c){room.sim.command(i,c);s.ack=c.seq;}
          else room.sim.command(i,{forward:0,side:0});
          for(const a of s.actions.splice(0))room.sim.action(i,a);
        }
        room.sim.tick(1/60);
      }
      if(++room.tick%3===0){
        const snapshot=room.sim.snapshot();
        for(const s of room.seats)if(s)send(s.ws,{type:'snapshot',running,seats:roomStatus(room),ack:s.ack,snapshot});
      }
    }
  }
},8);

const maintenance=setInterval(()=>{
  for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}
  for(const [code,room] of rooms){
    const disconnected=room.seats.filter(Boolean).some(s=>!s.ws&&Date.now()-s.disconnectedAt>90000);
    const empty=room.seats.every(s=>!s?.ws);
    if(disconnected||empty){for(const s of room.seats){send(s?.ws,{type:'ended',message:'The room closed after a player left. Create a new room to play again.'});if(s?.ws)s.ws.room=null;}rooms.delete(code);}
  }
},15000);

server.listen(PORT,'0.0.0.0',()=>console.log(`Vermilion Loop online at http://localhost:${PORT}`));
function stop(){clearInterval(timer);clearInterval(maintenance);for(const ws of wss.clients)ws.close(1012,'Server restarting');wss.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
