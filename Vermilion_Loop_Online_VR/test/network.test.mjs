import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';
const PORT=37129;
function client(){
 const ws=new WebSocket(`ws://127.0.0.1:${PORT}/ws`),messages=[];
 ws.on('message',d=>messages.push(JSON.parse(d)));
 return {ws,send:m=>ws.send(JSON.stringify(m)),async next(type,condition=()=>true){const start=Date.now();while(Date.now()-start<30000){const i=messages.findIndex(m=>m.type===type&&condition(m));if(i>=0)return messages.splice(i,1)[0];await new Promise(r=>setTimeout(r,20));}throw new Error('Timed out waiting for '+type);}};
}
test('real two-client online room, shared actions and reconnection',{timeout:60000},async t=>{
 const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(PORT)},stdio:['ignore','pipe','pipe']});
 let errors='';server.stderr.on('data',d=>errors+=d);
 const sockets=[];
 t.after(()=>{for(const s of sockets)s.close();server.kill('SIGTERM');});
 await once(server.stdout,'data');
 const a=client();sockets.push(a.ws);await once(a.ws,'open');a.send({type:'create',level:'forest',mode:'survey'});
 const first=await a.next('welcome');assert.match(first.room,/^[A-F0-9]{6}$/);assert.equal(first.index,0);
 a.send({type:'ready',device:'vr'});
 const b=client();sockets.push(b.ws);await once(b.ws,'open');b.send({type:'join',room:first.room});
 const second=await b.next('welcome');assert.equal(second.index,1);b.send({type:'ready',device:'desktop'});
 const runningA=await a.next('snapshot',m=>m.running),runningB=await b.next('snapshot',m=>m.running);
 assert.equal(runningA.seats[0].device,'vr');assert.equal(runningB.seats[1].device,'desktop');
 assert.deepEqual(runningA.snapshot.players,runningB.snapshot.players);
 const original=runningA.snapshot.players[0].position;
 a.send({type:'input',commands:Array.from({length:8},(_,i)=>({seq:i+1,forward:1,side:0,yaw:0,pitch:0,hands:[{offset:[1,-1,-.5],rotation:[0,0,0,1]}]}))});
 const moved=await a.next('snapshot',m=>m.ack>=8);assert.ok(moved.snapshot.players[0].position[2]<original[2]-.5);
 assert.deepEqual(moved.snapshot.players[0].hands[0].offset,[1,-1,-.5]);
 const shared=await b.next('snapshot',m=>m.snapshot.time>=moved.snapshot.time);assert.ok(shared.snapshot.players[0].position[2]<original[2]-.5);
 // A charged throw is created centrally and is visible to both clients.
 a.send({type:'action',action:{type:'charge-start'}});
 await new Promise(r=>setTimeout(r,100));a.send({type:'action',action:{type:'charge-end'}});
 const shotA=await a.next('snapshot',m=>m.snapshot.shots.length>0),shotB=await b.next('snapshot',m=>m.snapshot.shots.length>0);
 assert.equal(shotA.snapshot.shots[0].id,shotB.snapshot.shots[0].id);
 const full=client();sockets.push(full.ws);await once(full.ws,'open');full.send({type:'join',room:first.room});assert.match((await full.next('error')).message,/two players/);full.ws.close();
 b.ws.close();await once(b.ws,'close');
 const paused=await a.next('snapshot',m=>!m.running&&m.seats[1]&&!m.seats[1].connected);assert.equal(paused.running,false);
 const rejoined=client();sockets.push(rejoined.ws);await once(rejoined.ws,'open');rejoined.send({type:'join',room:first.room,token:second.token});
 const restored=await rejoined.next('welcome');assert.equal(restored.index,1);assert.deepEqual(restored.snapshot.echoes,paused.snapshot.echoes);
 rejoined.send({type:'ready',device:'vr'});await rejoined.next('snapshot',m=>m.running);
 const health=await fetch(`http://127.0.0.1:${PORT}/health`).then(r=>r.json());assert.equal(health.ok,true);
 assert.equal(errors,'');
 a.send({type:'leave'});assert.match((await rejoined.next('ended')).message,/left the room/);
});
