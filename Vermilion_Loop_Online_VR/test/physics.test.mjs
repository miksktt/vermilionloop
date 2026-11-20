import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../simulation.mjs';

let forest;
test('shared terrain and solid geometry',async t=>{
  forest=createSimulation('forest','survey');
  await t.test('two players spawn on the ground',()=>{
    assert.equal(forest.snapshot().players.length,2);
    assert.ok(forest.snapshot().triangleCount>10000);
    assert.equal(forest.eval('players.every(p=>Math.abs(p.position.y-playerEyeHeight(p)-heightAt(p.position.x,p.position.z))<1e-6)'),true);
  });
  await t.test('walk, sprint and jump remain above terrain',()=>{
    for(let i=0;i<120;i++){forest.command(0,{forward:1,side:.2,sprint:true,yaw:0,pitch:0,jumpPressed:i===25});forest.tick(1/60);assert.ok(forest.eval('players[0].position.y-playerEyeHeight(players[0])>=heightAt(players[0].position.x,players[0].position.z)-.003'));}
    assert.ok(forest.snapshot().players[0].distance>20);
  });
  await t.test('solid tower walls stop a sprinting player',()=>{
    forest.eval(`players[0].position.set(67,towerBaseY(0)+playerEyeHeight(players[0])+3,-99);players[0].yaw=0;players[0].verticalVelocity=0;players[0].grounded=true;`);
    for(let i=0;i<100;i++){forest.command(0,{forward:1,side:0,sprint:true,yaw:0,pitch:0});forest.tick(1/60);}
    assert.ok(forest.snapshot().players[0].position[2]>-108,'must not cross the tower shaft');
  });
  await t.test('temporary blocks can be climbed and expire',()=>{
    forest.eval(`players[0].position.set(-4,heightAt(-4,28)+EYE_HEIGHT,28);players[0].appliedScale=1;players[0].grounded=true;players[0].verticalVelocity=0;players[0].lastPlacedAt=-Infinity;`);
    const yaw=forest.eval(`(()=>{for(let i=0;i<16;i++){players[0].buildYaw=i*Math.PI/8;if(findBuildCandidate(0).valid)return players[0].buildYaw;}return null;})()`);
    assert.notEqual(yaw,null,'at least one build direction is clear');
    forest.action(0,{type:'build',yaw});
    assert.equal(forest.snapshot().blocks.length,1);
    const b=forest.snapshot().blocks[0];
    const walkYaw=Math.atan2(- (b.x+4),-(b.z-28));
    let climbed=false;
    for(let i=0;i<30;i++){forest.command(0,{forward:1,side:0,yaw:walkYaw,pitch:0});forest.tick(1/60);if(forest.eval('players[0].position.y-playerEyeHeight(players[0])')>=b.top-.03)climbed=true;}
    assert.ok(climbed,'walking onto a step raises the player');
    forest.eval(`players[0].position.set(${b.x},${b.top+3.5},${b.z});players[0].verticalVelocity=0;players[0].grounded=true;`);
    forest.command(0,{forward:0,side:0});assert.ok(Math.abs(forest.snapshot().players[0].position[1]-b.top-3.5)<.03);
    forest.eval('simulationTime+=31;updateConstruction();');
    assert.equal(forest.snapshot().blocks.length,0);
    const before=forest.snapshot().players[0].position[1];forest.command(0,{forward:0,side:0});assert.ok(forest.snapshot().players[0].position[1]<before);
  });
  await t.test('charged cubes collide with temporary blocks using their actual radius',()=>{
    assert.equal(forest.eval(`temporaryBlocks.push({id:999,x:0,z:0,bottom:20,top:21.2,born:simulationTime});projectileHitsWorld({x:2.5,y:20.6,z:0,radius:.7})`),true);
    forest.eval('temporaryBlocks.pop()');
  });
  await t.test('loop wrapping preserves finite positions',()=>{
    forest.eval('players[0].position.set(259.98,heightAt(259.98,0)+3.5,0);players[0].verticalVelocity=0;players[0].grounded=true;');
    forest.command(0,{forward:0,side:1,yaw:0,pitch:0});
    const p=forest.snapshot().players[0];assert.ok(p.position[0]<-259);assert.ok(p.position.every(Number.isFinite));
  });
  await t.test('a boosted charged cube cannot tunnel through a thin step',()=>{
    forest.eval(`players[0].position.set(0,49.6,5);players[0].yaw=0;players[0].pitch=0;players[0].lastThrowAt=-Infinity;players[0].powerTimers.blast=simulationTime+10;
      temporaryBlocks.push({id:998,x:0,z:0,bottom:49,top:50.2,born:simulationTime});
      throwGlitterCube(0,.8);updateThrownCubes(.15);temporaryBlocks.pop();`);
    const bursts=forest.snapshot().bursts;assert.ok(bursts.length>0,'the wall triggers an impact explosion');
    assert.ok(bursts.some(b=>b.z>=1.5&&b.z<4.8),'the impact occurs on the near side of the wall');
  });
});

for(const level of ['city','skyline','mountains'])test(`${level}: terrain, roofs and world seam`,()=>{
  const sim=createSimulation(level,'survey');
  assert.ok(sim.eval('Math.abs(heightAt(-260,17)-heightAt(260,17))<1e-9'));
  assert.ok(sim.eval('Math.abs(heightAt(17,-260)-heightAt(17,260))<1e-9'));
  // Compare the collision sampler with an independently triangulated grid raycast.
  assert.ok(sim.eval(`(()=>{
    const size=WORLD_SIZE/TERRAIN_SEGMENTS;
    for(let i=0;i<20;i++){
      const x=-200+i*17.3,z=-180+i*11.2,ix=Math.floor((x+260)/size),iz=Math.floor((z+260)/size),x0=ix*size-260,z0=iz*size-260;
      const a=new THREE.Vector3(x0,analyticHeightAt(x0,z0),z0),b=new THREE.Vector3(x0,analyticHeightAt(x0,z0+size),z0+size),c=new THREE.Vector3(x0+size,analyticHeightAt(x0+size,z0+size),z0+size),d=new THREE.Vector3(x0+size,analyticHeightAt(x0+size,z0),z0);
      const ray=new THREE.Ray(new THREE.Vector3(x,400,z),new THREE.Vector3(0,-1,0)),out=new THREE.Vector3();
      const hit=ray.intersectTriangle(a,b,d,false,out)||ray.intersectTriangle(b,c,d,false,out);
      if(!hit||Math.abs(out.y-heightAt(x,z))>1e-6)return false;
    }
    return true;
  })()`));
  const platform=sim.eval('JSON.stringify(levelPlatforms[0]&&{x:levelPlatforms[0].x,z:levelPlatforms[0].z,top:levelPlatforms[0].top})');
  if(platform){const p=JSON.parse(platform);sim.eval(`players[0].position.set(${p.x},${p.top+8},${p.z});players[0].verticalVelocity=-6;players[0].grounded=false;`);for(let i=0;i<120;i++){sim.command(0,{forward:0,side:0});sim.tick(1/60);}assert.ok(sim.snapshot().players[0].position[1]>=p.top+3.45);}
  if(level==='city'){
    assert.ok(sim.eval("!!bodyCollision(-34,1.8,heightAt(-28,0)+2,.62,4.3)"),'gateway pillar surfaces are solid');
    assert.equal(sim.eval("!!bodyCollision(-28,0,heightAt(-28,0)+.1,.62,4.3)"),false,'the doorway stays open');
    assert.ok(sim.eval("Number.isFinite(supportHeight(-28,0,heightAt(-28,0)+20,30))"),'lintel supports a landing');
    assert.ok(sim.eval(`(()=>{const p=players[0];p.appliedScale=1/3;p.position.set(-28,heightAt(-28,0)+8+EYE_HEIGHT/3,0);p.powerTimers.shrink=0;syncPlayerScale(p);return p.appliedScale===1/3;})()`),'growth is deferred when the larger body would intersect the lintel');
  }
});

test('racing and free-flight ships collide with solid structures',()=>{
  const sim=createSimulation('city','race');
  assert.ok(sim.eval('raceCheckpoints.length>=16'));
  assert.equal(sim.snapshot().vehiclePowerups.length,6);
  assert.ok(sim.eval('raceCheckpoints.every(c=>c.y>=supportHeight(c.x,c.z,400,800)+12.9)'),'race gates stay clear of solid rooftops');
  sim.eval(`players[0].position.set(-34,heightAt(-28,0)+6,10);vehicleStates[0].speed=180;moveShipWithCollision(players[0],vehicleStates[0],0,0,-20);`);
  const p=sim.snapshot().players[0];assert.ok(p.position[2]>0,'a boosted ship cannot tunnel through a gateway pillar');
  assert.ok(sim.snapshot().vehicles[0].speed<180);
});
