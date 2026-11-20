/* Shared by the browser and the authoritative Node simulation. */
const TERRAIN_SEGMENTS = 96;
let collisionWorld = null;
let collisionTriangleCount = 0;
const liveInput = [{forward:0,side:0}, {forward:0,side:0}];

function heightAt(x, z) {
  const cell = WORLD_SIZE / TERRAIN_SEGMENTS;
  const gx = (wrapWorld(x) + HALF_WORLD) / cell;
  const gz = (wrapWorld(z) + HALF_WORLD) / cell;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const x0 = ix * cell - HALF_WORLD, z0 = iz * cell - HALF_WORLD;
  const a = analyticHeightAt(x0,z0), b = analyticHeightAt(x0,z0+cell);
  const d = analyticHeightAt(x0+cell,z0), c = analyticHeightAt(x0+cell,z0+cell);
  return fx + fz <= 1 ? a+(d-a)*fx+(b-a)*fz : c+(b-c)*(1-fx)+(d-c)*(1-fz);
}

function buildCollisionWorld() {
  collisionWorld = new CollisionGrid();
  collisionTriangleCount = 0;
  // Fixed transforms are shared with rendering. Decorative foliage is non-solid.
  for (const o of animatedStructures) {
    o.position.set(o.userData.baseX,heightAt(o.userData.baseX,o.userData.baseZ)+o.userData.yOffset,o.userData.baseZ);
    o.rotation.set(0,o.userData.baseRotation,0);
  }
  scene.updateMatrixWorld(true);
  const solids = new Set();
  for (const root of [...animatedStructures,...levelPlatforms.map(p=>p.group)])
    root.traverse(o=>{ if(o.isMesh && o.visible) solids.add(o); });
  scene.traverse(o=>{
    if(o.userData.collisionSolid) o.traverse(c=>{if(c.isMesh && c.visible) solids.add(c);});
    if(o.name==='collision-solid') solids.add(o);
  });
  const local = new THREE.Matrix4(), matrix = new THREE.Matrix4();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  function addGeometry(geometry, transform) {
    if(!geometry.boundingSphere)geometry.computeBoundingSphere();
    const sphere=geometry.boundingSphere.clone().applyMatrix4(transform);
    if(Math.abs(sphere.center.x)>HALF_WORLD+14+sphere.radius || Math.abs(sphere.center.z)>HALF_WORLD+14+sphere.radius)return;
    const pos = geometry.attributes.position, indices = geometry.index;
    const length = indices ? indices.count : pos.count;
    for(let i=0;i<length;i+=3) {
      a.fromBufferAttribute(pos,indices?indices.getX(i):i).applyMatrix4(transform);
      b.fromBufferAttribute(pos,indices?indices.getX(i+1):i+1).applyMatrix4(transform);
      c.fromBufferAttribute(pos,indices?indices.getX(i+2):i+2).applyMatrix4(transform);
      // Keep one tile and a margin so swept collisions also work at the loop seam.
      if(Math.min(a.x,b.x,c.x)>HALF_WORLD+14 || Math.max(a.x,b.x,c.x)<-HALF_WORLD-14 ||
         Math.min(a.z,b.z,c.z)>HALF_WORLD+14 || Math.max(a.z,b.z,c.z)<-HALF_WORLD-14) continue;
      collisionWorld.addTriangle(new THREE.Triangle(a.clone(),b.clone(),c.clone()));
      collisionTriangleCount++;
    }
  }
  for(const o of solids) {
    if(o.isInstancedMesh) {
      for(let i=0;i<o.count;i++) {
        o.getMatrixAt(i,local); matrix.multiplyMatrices(o.matrixWorld,local);
        addGeometry(o.geometry,matrix);
      }
    } else {
      for(const ox of TILE_OFFSETS) for(const oz of TILE_OFFSETS) {
        matrix.copy(o.matrixWorld); matrix.elements[12]+=ox;matrix.elements[14]+=oz;
        addGeometry(o.geometry,matrix);
      }
    }
  }
  collisionWorld.build();
  if(currentGameMode==='race'){
    // The original ships could fly through buildings. Keep every gate reachable
    // now that the same solid-world collision rules apply to ships.
    for(const checkpoint of raceCheckpoints){
      const roof=supportHeight(checkpoint.x,checkpoint.z,400,800);
      checkpoint.y=Math.max(checkpoint.y,roof+13);
      for(let tries=0;tries<30&&collisionWorld.sphereIntersect(new THREE.Sphere(new THREE.Vector3(checkpoint.x,checkpoint.y,checkpoint.z),10));tries++)checkpoint.y+=2;
    }
    resetVehicleStarts();
    for(const pickup of vehiclePowerups)setVehiclePickupPosition(pickup,pickup.slot);
  }
}

function capsuleAt(x,z,feet,radius,height) {
  return new CollisionCapsule(new THREE.Vector3(x,feet+radius,z),new THREE.Vector3(x,feet+Math.max(radius,height-radius),z),radius);
}

function blockCollision(x,z,feet,radius,height,block) {
  if(feet>=block.top-0.001 || feet+height<=block.bottom+0.001) return null;
  const dx=wrappedDelta(x,block.x), dz=wrappedDelta(z,block.z);
  const cx=THREE.MathUtils.clamp(dx,-BLOCK_SIZE/2,BLOCK_SIZE/2), cz=THREE.MathUtils.clamp(dz,-BLOCK_SIZE/2,BLOCK_SIZE/2);
  const hx=dx-cx,hz=dz-cz, distance=Math.hypot(hx,hz);
  if(distance>=radius) return null;
  const options=[{normal:new THREE.Vector3(0,1,0),depth:block.top-feet},
    {normal:new THREE.Vector3(0,-1,0),depth:feet+height-block.bottom}];
  if(distance>1e-7) options.push({normal:new THREE.Vector3(hx/distance,0,hz/distance),depth:radius-distance});
  else {
    options.push({normal:new THREE.Vector3(Math.sign(dx)||1,0,0),depth:BLOCK_SIZE/2-Math.abs(dx)+radius});
    options.push({normal:new THREE.Vector3(0,0,Math.sign(dz)||1),depth:BLOCK_SIZE/2-Math.abs(dz)+radius});
  }
  return options.reduce((a,b)=>a.depth<b.depth?a:b);
}

function bodyCollision(x,z,feet,radius,height) {
  const hit=collisionWorld?.capsuleIntersect(capsuleAt(x,z,feet,radius,height));
  if(hit && hit.depth>0.0001) return hit;
  for(const block of temporaryBlocks) {
    const h=blockCollision(x,z,feet,radius,height,block);
    if(h) return h;
  }
  return null;
}

function clearBody(x,z,feet,radius,height) { return !bodyCollision(x,z,feet+0.006,radius,height); }

const previousBuildCandidate = findBuildCandidate;
findBuildCandidate = function(index) {
  const candidate=previousBuildCandidate(index);
  if(!candidate.valid||!collisionWorld)return candidate;
  const center=new THREE.Vector3(candidate.x,(candidate.bottom+candidate.top)/2,candidate.z),triangles=[];
  collisionWorld.getSphereTriangles(new THREE.Sphere(center,3.1),triangles);
  const box=new THREE.Box3(new THREE.Vector3(candidate.x-1.98,candidate.bottom+.025,candidate.z-1.98),new THREE.Vector3(candidate.x+1.98,candidate.top-.025,candidate.z+1.98));
  if(triangles.some(t=>box.intersectsTriangle(t))){candidate.valid=false;candidate.reason='A solid structure is in the way.';}
  return candidate;
};

const requestedScale = p => playerHasPower(p,'grow') ? 3 : playerHasPower(p,'shrink') ? 1/3 : 1;
playerScale = function(p) { if(typeof p==='number') p=players[p]; return p?.appliedScale || 1; };
syncPlayerScale = function(p) {
  const old=p.appliedScale||1, next=requestedScale(p);
  if(Math.abs(old-next)<0.001) return;
  const feet=p.position.y-EYE_HEIGHT*old;
  // Expanding under a roof is deferred until the complete capsule fits.
  if(next>old && !clearBody(p.position.x,p.position.z,feet,PLAYER_RADIUS*next,PLAYER_HEIGHT*next)) return;
  p.appliedScale=next; p.position.y=feet+EYE_HEIGHT*next;
};

inputForPlayer = i => liveInput[i] || {forward:0,side:0};

function solveBody(p,dx,dy,dz) {
  const eye=playerEyeHeight(p), radius=playerRadius(p), height=playerHeight(p);
  p.position.x=wrapWorld(p.position.x+dx);p.position.z=wrapWorld(p.position.z+dz);p.position.y+=dy;
  let onFloor=false, ceiling=false, wall=false;
  for(let i=0;i<6;i++) {
    const hit=bodyCollision(p.position.x,p.position.z,p.position.y-eye,radius,height);
    if(!hit) break;
    p.position.addScaledVector(hit.normal,hit.depth+0.0004);
    onFloor ||= hit.normal.y>0.45; ceiling ||= hit.normal.y<-0.45;wall ||= Math.abs(hit.normal.y)<0.45;
  }
  p.position.x=wrapWorld(p.position.x);p.position.z=wrapWorld(p.position.z);
  const ground=heightAt(p.position.x,p.position.z);
  if(p.position.y-eye<=ground+0.002) {p.position.y=ground+eye;onFloor=true;}
  if(onFloor && p.verticalVelocity<0) p.verticalVelocity=0;
  if(ceiling && p.verticalVelocity>0) p.verticalVelocity=0;
  return {onFloor,ceiling,wall};
}

function moveWalking(p,dx,dz,dt) {
  const eye=playerEyeHeight(p), old=p.position.clone(), feet=old.y-eye;
  const tx=wrapWorld(old.x+dx),tz=wrapWorld(old.z+dz),step=playerStepHeight(p);
  if(p.grounded && p.verticalVelocity<=0) {
    const ground=heightAt(tx,tz);
    if(ground-feet>step) {dx=0;dz=0;}
    const obstruction=bodyCollision(tx,tz,feet+0.005,playerRadius(p),playerHeight(p));
    if(obstruction && Math.abs(obstruction.normal.y)<0.55) {
      // Try a real raised capsule, then sweep down onto the highest support.
      if(clearBody(tx,tz,feet+step,playerRadius(p),playerHeight(p))) {
        let support=supportHeight(tx,tz,feet+step+0.03,step+0.12);
        for(let sample=0;sample<8;sample++){
          const a=sample/8*TAU,r=playerRadius(p)*.95;
          support=Math.max(support,supportHeight(wrapWorld(tx+Math.cos(a)*r),wrapWorld(tz+Math.sin(a)*r),feet+step+.03,step+.12));
        }
        if(Number.isFinite(support) && support>=feet-0.05 && support-feet<=step+0.001 &&
           clearBody(tx,tz,support+0.01,playerRadius(p),playerHeight(p))) {
          p.position.set(tx,support+eye,tz);p.lastGroundHeight=support;return {onFloor:true};
        }
      }
    }
  }
  return solveBody(p,dx,p.verticalVelocity*dt,dz);
}

function supportHeight(x,z,fromY,maxDistance=1000) {
  let y=heightAt(x,z);
  if(y>fromY+0.01) y=-Infinity;
  const ray=new THREE.Ray(new THREE.Vector3(x,fromY,z),new THREE.Vector3(0,-1,0));
  const hit=collisionWorld?.rayIntersect(ray);
  if(hit && hit.distance<=maxDistance) y=Math.max(y,hit.position.y);
  for(const b of temporaryBlocks) if(Math.abs(wrappedDelta(x,b.x))<=BLOCK_SIZE/2 && Math.abs(wrappedDelta(z,b.z))<=BLOCK_SIZE/2 && b.top<=fromY && fromY-b.top<=maxDistance) y=Math.max(y,b.top);
  return fromY-y<=maxDistance ? y : -Infinity;
}

updatePlayer = function(delta,index) {
  if(!gameIsActive()) return;
  const p=players[index],input=inputForPlayer(index,delta);
  syncPlayerScale(p);
  const fly=playerHasPower(p,'fly');
  p.isRunning=!!input.sprint && Math.hypot(input.forward||0,input.side||0)>0.1;
  if(input.jumpPressed || p.jumpRequested) {
    if(fly || p.grounded) {p.verticalVelocity=playerHasPower(p,'jump')?66:fly?10.8:9.2;p.grounded=false;}
  }
  p.jumpRequested=false;
  const f=THREE.MathUtils.clamp(input.forward||0,-1,1),s=THREE.MathUtils.clamp(input.side||0,-1,1),len=Math.max(1,Math.hypot(f,s));
  const speed=(input.sprint?21.5:12.2)*(playerHasPower(p,'speed')?1.75:1);
  const vx=(-Math.sin(p.yaw)*f+Math.cos(p.yaw)*s)*speed/len;
  const vz=(-Math.cos(p.yaw)*f-Math.sin(p.yaw)*s)*speed/len;
  const count=Math.max(1,Math.ceil(delta*Math.max(speed,Math.abs(p.verticalVelocity))/Math.max(0.055,playerRadius(p)*0.35)),Math.ceil(delta*120));
  const dt=delta/count, before=p.position.clone();
  for(let i=0;i<count;i++) {
    const wasGrounded=p.grounded;
    p.verticalVelocity-=(fly?6.4:24)*dt;
    if(fly)p.verticalVelocity=Math.max(p.verticalVelocity,-4.2);
    const hit=moveWalking(p,vx*dt,vz*dt,dt);
    p.grounded=hit.onFloor && p.verticalVelocity<=0;
    if(!p.grounded && wasGrounded && p.verticalVelocity<=0) {
      const feet=p.position.y-playerEyeHeight(p),floor=supportHeight(p.position.x,p.position.z,feet+0.06,0.32);
      if(Number.isFinite(floor)&&clearBody(p.position.x,p.position.z,floor+0.006,playerRadius(p),playerHeight(p))) {
        p.position.y=floor+playerEyeHeight(p);p.grounded=true;p.verticalVelocity=0;
      }
    }
    if(p.grounded)p.lastGroundHeight=p.position.y-playerEyeHeight(p);
  }
  const travelled=Math.hypot(wrappedDelta(p.position.x,before.x),wrappedDelta(p.position.z,before.z));
  p.distance+=travelled;p.walkPhase=(p.walkPhase||0)+travelled*1.65;p.walkAmount=Math.min(1,travelled/Math.max(delta*12.2,0.001));
  if(Math.abs(p.position.x-before.x)>HALF_WORLD||Math.abs(p.position.z-before.z)>HALF_WORLD)p.loop++;
};

function moveShipWithCollision(p,state,dx,dy,dz) {
  // A conservative sphere includes the wings and the nose of the enlarged ships.
  const radius=3.65,steps=Math.max(1,Math.ceil(Math.hypot(dx,dy,dz)/0.28));
  let collided=false;
  for(let n=0;n<steps;n++) {
    p.position.x=wrapWorld(p.position.x+dx/steps);p.position.y+=dy/steps;p.position.z=wrapWorld(p.position.z+dz/steps);
    for(let i=0;i<4;i++) {
      const hit=collisionWorld?.sphereIntersect(new THREE.Sphere(p.position.clone(),radius));
      if(!hit||hit.depth<0.0001)break;
      p.position.addScaledVector(hit.normal,hit.depth+0.001);collided=true;
    }
    let floor=heightAt(p.position.x,p.position.z)+radius;
    for(const ring of [.5,.9])for(let sample=0;sample<8;sample++){
      const a=sample/8*TAU,r=radius*ring;
      floor=Math.max(floor,heightAt(p.position.x+Math.cos(a)*r,p.position.z+Math.sin(a)*r)+Math.sqrt(radius*radius-r*r));
    }
    if(p.position.y<floor) {p.position.y=floor;p.pitch=Math.max(0.02,p.pitch);collided=true;}
  }
  if(collided)state.speed*=0.45;
  p.position.y=Math.min(p.position.y,260);
}

projectileHitsWorld = function(shot) {
  const r=shot.radius||THROW_RADIUS;
  if(shot.y-r<=heightAt(shot.x,shot.z))return true;
  if(collisionWorld?.sphereIntersect(new THREE.Sphere(new THREE.Vector3(shot.x,shot.y,shot.z),r)))return true;
  return temporaryBlocks.some(b=>pointInsideTemporaryBlock(shot.x,shot.y,shot.z,b,r));
};

function safeThrowOrigin(p,origin,dir) {
  const start=p.position.clone();start.y-=0.15*playerScale(p);
  const target=new THREE.Vector3(origin[0],origin[1],origin[2]).addScaledVector(dir,0.45);
  const delta=new THREE.Vector3(wrappedDelta(target.x,start.x),target.y-start.y,wrappedDelta(target.z,start.z));
  const length=delta.length();if(length>6*playerScale(p))delta.multiplyScalar(6*playerScale(p)/length);
  const n=Math.max(1,Math.ceil(delta.length()/0.08)),safe=start.clone();
  for(let i=1;i<=n;i++) {
    const q=start.clone().addScaledVector(delta,i/n);
    if(projectileHitsWorld({x:wrapWorld(q.x),y:q.y,z:wrapWorld(q.z),radius:0.25}))break;
    safe.copy(q);
  }
  safe.x=wrapWorld(safe.x);safe.z=wrapWorld(safe.z);return safe;
}

function applyPlayerCommand(index,command,dt=1/60) {
  const p=players[index];liveInput[index]=command;
  if(Array.isArray(command.hands))p.hands=command.hands;
  if(Number.isFinite(command.yaw))p.yaw=command.yaw;
  if(Number.isFinite(command.pitch))p.pitch=THREE.MathUtils.clamp(command.pitch,-1.45,1.45);
  if(command.roomDX||command.roomDZ) {
    const dx=THREE.MathUtils.clamp(command.roomDX||0,-0.4,0.4),dz=THREE.MathUtils.clamp(command.roomDZ||0,-0.4,0.4);
    solveBody(p,dx,0,dz);
  }
  if(vehicleModeActive())updateVehiclePlayer(dt,index);else updatePlayer(dt,index);
}
