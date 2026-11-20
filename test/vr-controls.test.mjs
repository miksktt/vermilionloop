import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSimulation} from '../simulation.mjs';

test('VR routes actions by handedness even when the controller order is reversed',()=>{
 const sim=createSimulation();
 const client=fs.readFileSync(new URL('../public/client.js',import.meta.url),'utf8').replace(/initialiseOnline\(\);\s*$/,'');
 sim.eval(client);
 sim.eval(`
  net.solo=true;net.running=true;net.index=0;
  const testControllers=[new THREE.Group(),new THREE.Group()],testGrips=[new THREE.Group(),new THREE.Group()];
  const testSources=[{handedness:'right',gamepad:{axes:[0,0,0,0],buttons:Array.from({length:6},()=>({pressed:false}))}},
    {handedness:'left',gamepad:{axes:[0,0,0,0],buttons:Array.from({length:6},()=>({pressed:false}))}}];
  renderer={xr:{getController:i=>testControllers[i],getControllerGrip:i=>testGrips[i],getSession:()=>({inputSources:testSources})}};
  setupXRScene();
  testControllers.forEach((c,i)=>c.dispatchEvent({type:'connected',data:testSources[i]}));
  let testYaw=null;for(let i=0;i<16;i++){players[0].buildYaw=i*Math.PI/8;if(findBuildCandidate(0).valid){testYaw=players[0].buildYaw;break;}}
  testControllers[1].rotation.y=testYaw;
  testControllers[1].dispatchEvent({type:'selectstart'});
 `);
 assert.equal(sim.snapshot().blocks.length,1,'left trigger builds');
 assert.equal(sim.snapshot().shots.length,0,'left trigger does not throw');
 sim.eval(`testControllers[0].position.copy(players[0].position);testControllers[0].dispatchEvent({type:'selectstart'});`);
 assert.equal(sim.eval('throwCharges[0].active'),true,'right trigger begins charging');
 sim.eval(`simulationTime+=.8;testControllers[0].dispatchEvent({type:'selectend'});`);
 assert.equal(sim.eval('throwCharges[0].active'),false);
 assert.equal(sim.snapshot().shots.length,1,'right trigger release throws');
 assert.equal(sim.snapshot().shots[0].mega,true,'holding the trigger charges the cube');
 assert.equal(sim.snapshot().blocks.length,1,'right trigger does not build');
 sim.eval(`testSources[1].gamepad.axes[3]=-1;testSources[0].gamepad.buttons[4].pressed=true;`);
 const command=sim.eval('xrCommand()');assert.equal(command.forward,1);assert.equal(command.jumpPressed,true);
 // Exercise the real browser snapshot reader for seat two, including fresh
 // visual records and replay of an input that the server hasn't acknowledged.
 const snapshot=sim.snapshot(),before=snapshot.players[1].position;
 sim.eval(`net.solo=false;net.running=true;net.index=1;net.pending=[{seq:2,forward:1,side:0,yaw:0,pitch:0}];temporaryBlocks.length=0;thrownCubes.length=0;`);
 sim.eval(`applySnapshot(${JSON.stringify(snapshot)},1,true)`);
 assert.equal(sim.eval('temporaryBlocks.length'),1);
 assert.equal(sim.eval('thrownCubes.length'),1);
 assert.ok(sim.snapshot().players[1].position[2]<before[2]-.1,'seat two predicts only its own unacknowledged movement');
});
