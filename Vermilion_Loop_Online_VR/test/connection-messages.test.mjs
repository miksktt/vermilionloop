import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSimulation} from '../simulation.mjs';

test('room startup progress, server errors and connection close reasons reach the player',()=>{
 const sim=createSimulation(),sockets=[];
 class FakeSocket{
  static OPEN=1;static CLOSING=2;
  constructor(url){this.url=String(url);this.readyState=0;this.sent=[];sockets.push(this);}
  send(s){this.sent.push(JSON.parse(s));}
  close(code=1000,reason=''){this.readyState=3;this.onclose?.({code,reason});}
 }
 const scope=sim.eval('globalThis');scope.WebSocket=FakeSocket;scope.URL=URL;
 scope.location={origin:'https://game.example',protocol:'https:',href:'https://game.example/'};
 const client=fs.readFileSync(new URL('../public/client.js',import.meta.url),'utf8').replace(/initialiseOnline\(\);\s*$/,'');
 sim.eval(client);sim.eval("started=false;document.querySelector('#server-url').value='';connect({type:'create',level:'forest',mode:'survey'});");
 const first=sockets[0];first.readyState=1;first.onopen();
 assert.equal(first.url,'wss://game.example/ws');assert.equal(first.sent[0].type,'create');
 first.onmessage({data:JSON.stringify({type:'creating',message:'Preparing the shared world…'})});
 assert.match(sim.eval('ui.inputWarning.textContent'),/Preparing/);assert.equal(sim.eval('ui.enter.disabled'),true);
 first.close(1006,'');assert.match(sim.eval('ui.inputWarning.textContent'),/preparing the room/);assert.match(sim.eval('ui.inputWarning.textContent'),/1006/);
 assert.doesNotMatch(sim.eval('ui.inputWarning.textContent'),/asleep|awake/);
 sim.eval("connect({type:'create',level:'forest',mode:'survey'});");
 const second=sockets[1];second.readyState=1;second.onopen();
 second.onmessage({data:JSON.stringify({type:'error',message:'This server is full.'})});
 assert.equal(sim.eval('ui.inputWarning.textContent'),'This server is full.');assert.equal(sim.eval('ui.enter.disabled'),false);
});
