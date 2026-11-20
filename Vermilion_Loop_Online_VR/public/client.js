/* Online session, desktop input and handed WebXR input. No external CDN assets. */
const net={ws:null,room:'',token:'',index:0,running:false,solo:false,seats:[],seq:0,pending:[],outbox:[],retry:0,connected:false,lastSnapshot:0,ping:0,manualClose:false};
const controls={yaw:0,pitch:0,jump:false,run:false,paused:false,gamepadPrevious:[],roomDX:0,roomDZ:0};
const xrState={rig:null,controllers:[],baseYaw:0,head:new THREE.Vector3(),headPrevious:null,metres: EYE_HEIGHT/1.65,menu:null,menuButtons:[],menuOpen:false,snapReady:true,previous:{},hands:[],hud:null,hudContext:null,hudTexture:null,hudAt:0};
const $=s=>document.querySelector(s);
const originalShowSignal=showSignal;
const originalUpdatePowerups=updatePowerups;
const originalUpdateVehiclePowerups=updateVehiclePowerups;
let localFrame=0,sendFrame=0,lastFrame=0,reconnectTimer=null,networkWatch=null;
let remoteTarget=null,lastSnapshotForEffects=null;

gameIsActive=()=>started && (net.solo || net.running);
showSignal=function(text,duration=3600){originalShowSignal(String(text).replaceAll('—',' · '),duration);};
pauseGame=function(){
  if(!started)return;
  controls.paused=true;clearKeys();
  if(renderer.xr.isPresenting){xrState.menuOpen=true;xrState.menu.visible=true;return;}
  ui.pause.hidden=false;document.exitPointerLock?.();
};
resumeGame=function(){controls.paused=false;ui.pause.hidden=true;xrState.menuOpen=false;if(xrState.menu)xrState.menu.visible=false;if(!renderer.xr.isPresenting)requestPointerLockSafely();};

function clearKeys(){for(const k of Object.keys(keys))keys[k]=false;controls.jump=false;controls.roomDX=0;controls.roomDZ=0;}
function statusText(text){$('#network-status').textContent=text;}
function sendMessage(msg){if(net.ws?.readyState===WebSocket.OPEN)net.ws.send(JSON.stringify(msg));}
function action(a){
  if(!gameIsActive()||controls.paused)return;
  if(net.solo)performSoloAction(a);else sendMessage({type:'action',action:a});
}
function performSoloAction(a){
  const p=players[net.index];
  if(a.type==='build'){p.building=true;p.buildYaw=a.yaw??p.yaw;placeBlock(net.index);}
  if(a.type==='charge-start')beginThrowCharge(net.index,'input');
  if(a.type==='charge-end'){p.throwAim=a.direction||null;p.throwOrigin=a.origin||null;releaseThrowCharge(net.index);p.throwAim=null;p.throwOrigin=null;}
}

function serverAddress(){
  const chosen=$('#server-url').value.trim();
  if(chosen){const u=new URL(chosen);if(!['https:','http:'].includes(u.protocol))throw new Error('Use an HTTPS server address.');return u;}
  if(!['https:','http:'].includes(location.protocol))throw new Error('Open the hosted game website, or enter its HTTPS address above. Solo practice works from this file.');
  return new URL(location.origin);
}

function connect(request){
  ui.inputWarning.textContent='Connecting…';ui.enter.disabled=true;$('#join-room').disabled=true;
  $('#practice').disabled=true;
  net.solo=false;net.manualClose=false;
  clearTimeout(reconnectTimer);
  let attemptError='',stage='connecting';
  let endpoint;
  try{endpoint=serverAddress();endpoint.protocol=endpoint.protocol==='https:'?'wss:':'ws:';endpoint.pathname='/ws';endpoint.search='';endpoint.hash='';}
  catch(e){showConnectionError(e.message);return;}
  const previous=net.ws,ws=new WebSocket(endpoint);net.ws=ws;
  if(previous&&previous.readyState<WebSocket.CLOSING)previous.close(1000,'Connection replaced');
  ws.onopen=()=>{
    if(net.ws!==ws)return;
    net.connected=true;
    if(request.type==='create'){stage='creating';ui.inputWarning.textContent='Connected. Preparing the shared world…';}
    sendMessage(request);
  };
  ws.onmessage=event=>{
    if(net.ws!==ws)return;
    let msg;try{msg=JSON.parse(event.data);}catch{return;}
    if(msg.type==='creating'){stage='creating';ui.inputWarning.textContent=msg.message||'Preparing the shared world…';return;}
    if(msg.type==='welcome'){
      stage='ready';net.retry=0;
      net.room=msg.room;net.token=msg.token;net.index=msg.index;net.seats=msg.seats;
      net.seq=0;net.pending=[];net.outbox=[];
      sessionStorage.setItem('vermilion-session',JSON.stringify({room:net.room,token:net.token}));
      try{
        prepareOnlineWorld(msg.level,msg.mode);
        applySnapshot(msg.snapshot,0,true);enterLocalView();
      }catch(error){
        attemptError=`This device could not load the world: ${error.message}`;showConnectionError(attemptError);net.manualClose=true;ws.close();return;
      }
      sendMessage({type:'ready',device:renderer.xr.isPresenting?'vr':'desktop'});
      ui.enter.disabled=false;$('#join-room').disabled=false;$('#practice').disabled=false;
      showSignal(`ROOM ${net.room} · ${net.index===0?'Share the code with your friend.':'You joined the loop.'}`,6000);
    }
    if(msg.type==='status'){net.seats=msg.seats;updateNetworkStatus();}
    if(msg.type==='snapshot'){
      net.running=msg.running;net.seats=msg.seats;net.lastSnapshot=performance.now();
      applySnapshot(msg.snapshot,msg.ack);updateNetworkStatus();
    }
    if(msg.type==='pong')net.ping=Math.round(performance.now()-msg.at);
    if(msg.type==='error'){attemptError=msg.message;showConnectionError(attemptError);if(!started){net.manualClose=true;ws.close();}}
    if(msg.type==='ended'){net.running=false;showSignal(msg.message,12000);statusText('ROOM CLOSED · USE MENU TO RETURN');}
  };
  ws.onerror=()=>{if(net.ws!==ws)return;if(!started){attemptError=stage==='creating'?'The server disconnected while preparing the room. Check the Render server logs.':'Could not reach the multiplayer connection. Check the hosted address and try again.';showConnectionError(attemptError);}};
  ws.onclose=event=>{
    if(net.ws!==ws)return;
    net.connected=false;net.running=false;clearKeys();updateNetworkStatus();
    if(net.manualClose)return;
    if(net.room&&started){
      const delay=Math.min(12000,1000*2**net.retry++);
      statusText('CONNECTION LOST · RECONNECTING…');
      reconnectTimer=setTimeout(()=>connect({type:'join',room:net.room,token:net.token}),delay);
    }else{
      const reason=event.reason||attemptError||(stage==='creating'?'The server stopped responding while preparing the room. Check its Render logs.':'The multiplayer connection closed before a room was created.');
      showConnectionError(`${reason} (connection ${event.code})`);
    }
  };
}

function showConnectionError(message){ui.inputWarning.textContent=message;ui.enter.disabled=false;$('#join-room').disabled=false;$('#practice').disabled=false;}
function updateNetworkStatus(){
  if(net.solo){statusText('SOLO PRACTICE');return;}
  if(!net.connected){statusText('DISCONNECTED · RECONNECTING…');return;}
  const count=net.seats.filter(s=>s?.connected).length;
  statusText(`ROOM ${net.room} · ${count}/2 PLAYERS${net.running?` · ${net.ping} ms`:count<2?' · WAITING FOR FRIEND':' · LOADING WORLD'}`);
}

function disposeOldWorld(){
  if(!scene)return;
  const geometries=new Set(),materials=new Set(),textures=new Set();
  scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
  geometries.forEach(o=>o.dispose());materials.forEach(o=>o.dispose());textures.forEach(o=>o.dispose());renderer?.renderLists.dispose();
}
function prepareOnlineWorld(level,mode){
  if(renderer.xr.isPresenting)return;
  disposeOldWorld();currentGameMode=mode;rebuildWorldForLevel(level);buildCollisionWorld();setupXRScene();
  net.pending=[];net.outbox=[];net.seq=0;remoteTarget=null;lastSnapshotForEffects=null;
  document.body.classList.toggle('vehicle-mode',vehicleModeActive());
  controls.yaw=players[net.index].yaw;controls.pitch=players[net.index].pitch;
}
function enterLocalView(){
  started=true;controls.paused=false;ui.pause.hidden=true;
  ui.start.hidden=true;ui.start.classList.add('leaving');ui.hud.classList.add('active');ui.hud.setAttribute('aria-hidden','false');
  ui.splitOverlay.classList.add('active');ui.splitOverlay.setAttribute('aria-hidden','false');document.body.dataset.seat=String(net.index);
  inputAssignments[net.index]='keyboard';inputAssignments[1-net.index]='remote';
  audioEngine.start();clearKeys();$('#copy-room').hidden=net.solo;updateNetworkStatus();
  controls.yaw=players[net.index].yaw;controls.pitch=players[net.index].pitch;
  ui.inputWarning.textContent='';
}
async function leaveRoom(){
  if(renderer.xr.isPresenting)await renderer.xr.getSession().end();
  sendMessage({type:'leave'});net.manualClose=true;net.ws?.close();clearTimeout(reconnectTimer);
  net.room='';net.token='';net.running=false;net.solo=false;net.pending=[];net.outbox=[];sessionStorage.removeItem('vermilion-session');
  started=false;controls.paused=false;clearKeys();document.exitPointerLock?.();
  ui.hud.classList.remove('active');ui.splitOverlay.classList.remove('active');ui.pause.hidden=true;ui.start.hidden=false;ui.start.classList.remove('leaving');
  ui.enter.disabled=false;$('#join-room').disabled=false;ui.inputWarning.textContent='';
}

function setPlayerState(p,data){
  const {position,...fields}=data;Object.assign(p,fields);p.powerTimers={...data.powerTimers};p.position.fromArray(position);
}
function makeRemoteBlock(d){
  const colour=d.owner===0?0x995842:0x3a6960;
  const material=new THREE.MeshStandardMaterial({color:colour,roughness:.91,transparent:true});
  const edgeMaterial=new THREE.LineBasicMaterial({color:d.owner===0?0xffba83:0xa0ffdc,transparent:true,opacity:.68});
  const barMaterial=new THREE.MeshBasicMaterial({color:0xcaffde,transparent:true});
  const mesh=new THREE.Mesh(blockGeometry,material),bar=new THREE.Mesh(blockBarGeometry,barMaterial);
  bar.position.set(0,BLOCK_HEIGHT/2+.025,-BLOCK_SIZE*.34);
  const group=new THREE.Group();group.add(mesh,new THREE.LineSegments(blockEdgeGeometry,edgeMaterial),bar);scene.add(group);
  return {...d,group,mesh,material,edgeMaterial,bar,barMaterial};
}
function makeRemoteShot(d){
  const colour=d.mega?0xff7a2d:d.tagCharged?0xffd45d:d.owner===0?0xffa85f:0x65d7bf;
  const material=new THREE.MeshStandardMaterial({color:colour,emissive:colour,emissiveIntensity:2.3,transparent:true,roughness:.5});
  const edgeMaterial=new THREE.LineBasicMaterial({color:0xffeeaf,transparent:true,opacity:.9});
  const mesh=new THREE.Mesh(throwableGeometry,material),glitter=makeGlitterPoints(d.owner),group=new THREE.Group();
  group.add(mesh,new THREE.LineSegments(throwableEdgeGeometry,edgeMaterial),glitter.points);group.scale.setScalar(d.scale||1);scene.add(group);
  return {...d,group,mesh,material,edgeMaterial,glitter:glitter.points,glitterGeometry:glitter.geometry,glitterMaterial:glitter.material};
}

function applySnapshot(s,ack=0,initial=false){
  if(!s?.players)return;
  const oldTime=simulationTime;simulationTime=s.time;
  net.pending=net.pending.filter(c=>c.seq>ack);
  const local=players[net.index];
  setPlayerState(local,s.players[net.index]);
  // Replay only movement inputs that the server has not yet acknowledged.
  if(initial)setPlayerState(players[1-net.index],s.players[1-net.index]);
  remoteTarget=s.players[1-net.index];
  taggedPlayer=s.taggedPlayer;lastTagTransfer=s.lastTagTransfer;raceWinner=s.raceWinner;
  discoveredEchoes.clear();s.echoes.forEach(i=>discoveredEchoes.add(i));
  s.towers.forEach((t,i)=>Object.assign(towerStates[i]||{},t));
  s.vehicles.forEach((v,i)=>Object.assign(vehicleStates[i],v,{powerTimers:{...v.powerTimers}}));
  const ids=new Set(s.blocks.map(d=>d.id));
  for(let i=temporaryBlocks.length-1;i>=0;i--)if(!ids.has(temporaryBlocks[i].id))removeBlockAt(i);
  for(const d of s.blocks){let b=temporaryBlocks.find(x=>x.id===d.id);if(!b){b=makeRemoteBlock(d);temporaryBlocks.push(b);}else Object.assign(b,d);}
  const shots=new Set(s.shots.map(d=>d.id));
  for(let i=thrownCubes.length-1;i>=0;i--)if(!shots.has(thrownCubes[i].id))removeThrownCubeAt(i);
  for(const d of s.shots){let shot=thrownCubes.find(x=>x.id===d.id);if(!shot){shot=makeRemoteShot(d);thrownCubes.push(shot);}else Object.assign(shot,d);}
  s.powerups.forEach((d,i)=>{const p=powerups[i];if(!p)return;const changed=p.type!==d.type||p.x!==d.x||p.z!==d.z;Object.assign(p,d);if(changed){applyPowerupStyle(p,d.type);updatePowerupBeaconGeometry(p);redrawPowerupLabel(p);}});
  s.npcs.forEach((d,i)=>{const n=npcVisuals[i];if(!n)return;const changed=d.lastSpeech&&d.lastSpeech!==n.lastSpeech;Object.assign(n,d);if(changed){setNpcChatter(n,d.lastSpeech);n.speechUntil=d.speechUntil;audioEngine.playNpcChatter(i);}});
  s.vehiclePowerups.forEach((d,i)=>{const p=vehiclePowerups[i];if(!p)return;Object.assign(p,d);const def=VEHICLE_POWER_DEFS.find(t=>t.type===p.type);if(def){p.crystal.material.color.setHex(def.colour);p.crystal.material.emissive.setHex(def.colour);}});
  for(const b of s.bursts||[]){const id=`${b.born}:${b.x}:${b.z}`;if(!explosionBursts.some(x=>x.networkId===id)){spawnExplosion(b.x,b.y,b.z,b.owner,b.charged,b.strength);explosionBursts.at(-1).networkId=id;explosionBursts.at(-1).born=b.born;audioEngine.playExplosion(b.charged);}}
  if(net.running)for(const c of net.pending){simulationTime+=1/60;applyPlayerCommand(net.index,c,1/60);}
  for(const event of s.events||[])showSignal(event.text,3600);
  if(lastSnapshotForEffects){const old=lastSnapshotForEffects.players[net.index];for(const [k,v]of Object.entries(local.powerTimers))if(v>(old.powerTimers[k]||0))audioEngine.playPowerPickup(k);}
  lastSnapshotForEffects=s;
  updateLocalReadouts();
}

function desktopCommand(){
  const c={forward:(keys.KeyW?1:0)-(keys.KeyS?1:0),side:(keys.KeyD?1:0)-(keys.KeyA?1:0),sprint:!!(keys.ShiftLeft||keys.ShiftRight||controls.run),jumpPressed:controls.jump,yaw:controls.yaw,pitch:controls.pitch};
  controls.jump=false;
  const pad=safeGamepads().find(p=>p?.connected);
  if(pad){
    const axes=pad.axes;const prev=controls.gamepadPrevious;
    if(Math.hypot(axes[0]||0,axes[1]||0)>.2){c.forward=-applyStickDeadzone(axes[1]||0);c.side=applyStickDeadzone(axes[0]||0);}
    controls.yaw-=applyStickDeadzone(axes[2]||0)*2.2/60;controls.pitch-=applyStickDeadzone(axes[3]||0)*1.6/60;
    const pressed=pad.buttons.map(b=>b.pressed);
    c.jumpPressed ||= pressed[0]&&!prev[0];c.sprint ||= pressed[4]||pressed[6]||pressed[7];
    if(pressed[2]&&!prev[2])action({type:'build',yaw:controls.yaw});
    if(pressed[5]&&!prev[5])action({type:'charge-start'});
    if(!pressed[5]&&prev[5])action({type:'charge-end'});
    if(pressed[9]&&!prev[9])pauseGame();controls.gamepadPrevious=pressed;
    c.yaw=controls.yaw;c.pitch=controls.pitch;
  }
  return c;
}

function sampleCommand(){
  let c=renderer.xr.isPresenting?xrCommand():desktopCommand();
  if(controls.paused||document.hidden)c={forward:0,side:0,sprint:false,yaw:c.yaw,pitch:c.pitch};
  c.seq=++net.seq;return c;
}

function simulateLocalStep(){
  if(!started)return;
  const c=sampleCommand();
  if(net.solo){
    simulationTime+=1/60;applyPlayerCommand(net.index,c,1/60);
    if(vehicleModeActive()){originalUpdateVehiclePowerups(1/60);}else{
      updateConstruction();updateTowerRoofEffects(1/60);originalUpdatePowerups(1/60);updateThrownCubes(1/60);updateExplosions(1/60);updateTagGame();checkEchoes(players[net.index],net.index);
    }
    updateNPCSurveyors(1/60);
  }else if(net.running&&net.connected){
    simulationTime+=1/60;applyPlayerCommand(net.index,c,1/60);net.pending.push(c);net.outbox.push(c);
    if(net.pending.length>120){net.pending.splice(0,net.pending.length-120);}
    if(net.outbox.length>=2){sendMessage({type:'input',commands:net.outbox.splice(0,8)});}
  }
  if(vehicleModeActive()&&!renderer.xr.isPresenting)controls.yaw=players[net.index].yaw;
}

function updateLocalReadouts(){
  if(!started)return;
  const p=players[net.index],power=vehicleModeActive()?vehiclePowerSummary(vehicleStates[net.index]):activePowerSummary(p);
  ui.player1Label.innerHTML=`<strong>SURVEYOR ${net.index+1}${!vehicleModeActive()&&taggedPlayer===net.index?' · TAGGED':''}</strong><span>${vehicleModeActive()?currentGameMode==='race'?`LAP ${Math.min(vehicleStates[net.index].lap,3)}/3 · ${raceCheckpointStatus(vehicleStates[net.index])}`:'FREE FLIGHT':`LOOP ${p.loop} · ECHOES ${discoveredEchoes.size}/6`}</span>`;
  $('#tag-frame-0').classList.toggle('active',!vehicleModeActive()&&taggedPlayer===net.index);
  const status=$('#build-status-0');
  status.textContent=vehicleModeActive()?`${Math.round(vehicleStates[net.index].speed)} SPEED${power?' · '+power:''}`:
    `${renderer.xr.isPresenting?'LEFT TRIGGER BUILD · RIGHT TRIGGER THROW':'E BUILD · HOLD F CHARGE · SPACE JUMP · SHIFT RUN'}${power?' · '+power:''}`;
  $('#build-toggle-0').textContent=p.building?'BUILD ON':'BUILD OFF';
  const panel=$('#power-overlay-0');panel.innerHTML=power?`<div class="power-card"><div class="power-card-header">${power}</div></div>`:'';
}

function animateOnline(ms,frame){
  const dt=Math.min(.05,(ms-lastFrame)/1000||1/60);lastFrame=ms;
  if(frame&&renderer.xr.isPresenting)readXRFrame(frame);
  localFrame+=dt;
  for(let n=0;localFrame>=1/60&&n<4;n++){localFrame-=1/60;simulateLocalStep();}
  if(!net.solo&&started){
    if(remoteTarget){const p=players[1-net.index],a=1-Math.exp(-dt*18);p.position.x=wrapWorld(p.position.x+wrappedDelta(remoteTarget.position[0],p.position.x)*a);p.position.z=wrapWorld(p.position.z+wrappedDelta(remoteTarget.position[2],p.position.z)*a);p.position.y=THREE.MathUtils.lerp(p.position.y,remoteTarget.position[1],a);const pos=p.position.clone();Object.assign(p,remoteTarget);p.position=pos;}
    for(const shot of thrownCubes){shot.group.rotation.x+=dt*1.7;shot.group.rotation.y+=dt*2;shot.glitter.rotation.y+=dt*3;}
    updateExplosions(dt);
    for(const n of npcVisuals){n.legs[0].rotation.x=Math.sin(n.walkPhase||0)*.32;n.legs[1].rotation.x=-Math.sin(n.walkPhase||0)*.32;n.speech.sprite.visible=n.speechUntil>simulationTime;}
  }
  const time=started?simulationTime:ms/1000;
  // Animate avatars without running the client-side tag game.
  const tagFunction=updateTagGame;updateTagGame=()=>{};updateSurveyors(dt,time);updateTagGame=tagFunction;
  updateWorld(time);
  for(const p of powerups){p.group.rotation.y+=dt*.62;p.group.userData.renderYOffset=Math.sin(time*1.35+p.phase)*.78;}
  for(const p of vehiclePowerups){p.group.rotation.y+=dt*.8;p.ring.rotation.z+=dt*.4;}
  readoutTimer+=dt;if(readoutTimer>.15){updateLocalReadouts();drawXRHud();readoutTimer=0;}
  renderLocalView(time);
}

function renderLocalView(time){
  const p=players[net.index];p.building=!!controls.preview;prepareWorldForPlayer(p,time);prepareSharedObjects(p,net.index);
  if(xrState.remoteHands)xrState.remoteHands.forEach((mesh,i)=>{
    const remote=players[1-net.index],pose=remote.hands?.[i];mesh.visible=!!pose&&currentGameMode==='survey';
    if(pose){mesh.position.set(p.position.x+wrappedDelta(remote.position.x+pose.offset[0],p.position.x),remote.position.y+pose.offset[1],p.position.z+wrappedDelta(remote.position.z+pose.offset[2],p.position.z));mesh.quaternion.fromArray(pose.rotation);mesh.scale.setScalar(playerScale(remote));}
  });
  avatarVisuals[1-net.index].root.visible=currentGameMode==='survey'&&(net.solo||net.seats[1-net.index]?.connected);
  if(currentGameMode==='survey'){
    const c=started&&p.building?findBuildCandidate(net.index):null;buildCandidates[net.index]=c;
    const preview=buildPreviews[net.index];if(preview){preview.group.visible=!!c&&!controls.paused;if(c){preview.group.position.set(p.position.x+wrappedDelta(c.x,p.position.x),c.bottom+BLOCK_HEIGHT/2,p.position.z+wrappedDelta(c.z,p.position.z));preview.edgeMaterial.color.setHex(c.valid?0x8affce:0xff6547);}}
  }
  if(renderer.xr.isPresenting){
    positionXRRig();xrState.menu.visible=xrState.menuOpen;
    if(vehicleModeActive())shipVisuals[net.index].group.visible=false;
    renderer.setScissorTest(false);renderer.render(scene,camera);return;
  }
  xrState.rig.visible=false;
  if(camera.parent)camera.parent.remove(camera);
  if(vehicleModeActive())setVehicleCamera(camera,p,vehicleStates[net.index]);else{camera.position.copy(p.position);camera.rotation.set(p.pitch,p.yaw,0,'YXZ');camera.fov=72;}
  camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setScissorTest(false);renderer.setViewport(0,0,window.innerWidth,window.innerHeight);renderer.render(scene,camera);
}

async function initialiseOnline(){
  try{
    buildRenderer();renderer.shadowMap.enabled=false;renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.35));
    renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor');renderer.xr.setFramebufferScaleFactor(.85);
    resetPlayersForLevel();buildScene();buildCollisionWorld();setupXRScene();bindOnlineEvents();
    worldReady=true;ui.enter.disabled=false;ui.loading.classList.add('ready');
    if(new URL(location.href).searchParams.has('room'))$('#room-code').value=new URL(location.href).searchParams.get('room').slice(0,6);
    updateLevelDescription();updateModeDescription();checkVRSupport();
    renderer.setAnimationLoop(animateOnline);
    setInterval(()=>{if(net.connected)sendMessage({type:'ping',at:performance.now()});},2500);
    networkWatch=setInterval(()=>{if(started&&!net.solo&&net.connected&&net.lastSnapshot&&performance.now()-net.lastSnapshot>3500){net.running=false;statusText('WAITING FOR SERVER…');}},1000);
  }catch(e){console.error(e);ui.loading.querySelector('span:last-child').textContent=`Could not start: ${e.message}`;}
}

function setupXRScene(){
  xrState.rig=new THREE.Group();xrState.rig.name='Tracked player rig';scene.add(xrState.rig);
  xrState.controllers=[];xrState.hands=[];xrState.headPrevious=null;
  xrState.remoteHands=[0,1].map(()=>{const m=new THREE.Mesh(new THREE.BoxGeometry(.22,.22,.38),new THREE.MeshStandardMaterial({color:0xa0ffdd,emissive:0x144636}));m.visible=false;scene.add(m);return m;});
  for(let i=0;i<2;i++){
    const controller=renderer.xr.getController(i);xrState.rig.add(controller);xrState.controllers.push(controller);
    if(!controller.userData.onlineBound){
      controller.addEventListener('connected',e=>controller.userData.source=e.data);
      controller.addEventListener('disconnected',()=>controller.userData.source=null);
      controller.addEventListener('selectstart',()=>{
        if(xrState.menuOpen){activateVRMenu(controller);return;}
        const hand=controller.userData.source?.handedness;
        if(hand==='left'){
          const dir=controllerDirection(controller);const yaw=Math.atan2(-dir.x,-dir.z);
          players[net.index].buildYaw=yaw;controls.preview=true;action({type:'build',yaw});
        }
        if(hand==='right')action({type:'charge-start'});
      });
      controller.addEventListener('selectend',()=>{
        if(controller.userData.source?.handedness!=='right'||xrState.menuOpen)return;
        const d=controllerDirection(controller),origin=new THREE.Vector3();controller.getWorldPosition(origin);
        action({type:'charge-end',direction:d.toArray(),origin:origin.toArray()});
      });
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-3.5)]),new THREE.LineBasicMaterial({color:0x8affce,transparent:true,opacity:.5}));
      controller.add(line);controller.userData.onlineBound=true;
    }
    const grip=renderer.xr.getControllerGrip(i);xrState.rig.add(grip);
    if(!grip.userData.onlineBound){
      const marker=new THREE.Mesh(new THREE.BoxGeometry(.07,.07,.12),new THREE.MeshStandardMaterial({color:0xff9b68,emissive:0x77321c,emissiveIntensity:.8}));
      marker.position.z=-.05;grip.add(marker);grip.userData.onlineBound=true;
    }
    xrState.hands.push(grip);
  }
  makeVRMenu();makeVRHud();
}
function controllerDirection(controller){
  controller.updateWorldMatrix(true,false);
  const q=new THREE.Quaternion();controller.getWorldQuaternion(q);
  return new THREE.Vector3(0,0,-1).applyQuaternion(q).normalize();
}
function makeVRMenu(){
  const menu=new THREE.Group();xrState.menu=menu;xrState.menuButtons=[];menu.position.set(0,0,-1.35);camera.add(menu);menu.visible=false;
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=560;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#061e20';ctx.fillRect(0,0,768,560);ctx.strokeStyle='#8affce';ctx.lineWidth=4;ctx.strokeRect(3,3,762,554);
  ctx.fillStyle='#ffab78';ctx.font='bold 38px Arial';ctx.textAlign='center';ctx.fillText('THE VERMILION LOOP',384,72);
  ctx.fillStyle='#d5f4e0';ctx.font='23px Arial';ctx.fillText('Point either controller and press its trigger',384,115);
  const actions=[['RESUME','resume'],['RECENTRE VIEW','recenter'],['LEAVE ROOM / MAIN MENU','leave']];
  actions.forEach(([label,id],i)=>{
    const y=155+i*112;ctx.fillStyle='#16483f';ctx.fillRect(58,y,652,83);ctx.strokeStyle='#8affce';ctx.lineWidth=2;ctx.strokeRect(58,y,652,83);
    ctx.fillStyle='#fff0cd';ctx.font='bold 27px Arial';ctx.fillText(label,384,y+52);
    const hit=new THREE.Mesh(new THREE.PlaneGeometry(1.19,.15),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
    hit.position.set(0,.51-(y+41.5)/560*1.02,.004);hit.userData.menuAction=id;menu.add(hit);xrState.menuButtons.push(hit);
  });
  const material=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthTest:false});
  const board=new THREE.Mesh(new THREE.PlaneGeometry(1.4,1.02),material);board.renderOrder=100;menu.add(board);
}
function makeVRHud(){
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=320;xrState.hudContext=canvas.getContext('2d');
  xrState.hudTexture=new THREE.CanvasTexture(canvas);
  xrState.hud=new THREE.Mesh(new THREE.PlaneGeometry(.83,.26),new THREE.MeshBasicMaterial({map:xrState.hudTexture,transparent:true,depthTest:false}));
  xrState.hud.position.set(0,-.34,-1.05);xrState.hud.renderOrder=99;xrState.hud.visible=false;camera.add(xrState.hud);
}
function drawXRHud(){
  if(!xrState.hudContext||!started)return;
  const ctx=xrState.hudContext,p=players[net.index];
  ctx.clearRect(0,0,1024,320);ctx.fillStyle='#031b1cee';ctx.fillRect(0,0,1024,320);
  ctx.strokeStyle='#8affce';ctx.lineWidth=4;ctx.strokeRect(2,2,1020,316);
  ctx.fillStyle='#ffb083';ctx.font='bold 36px Arial';ctx.fillText(net.solo?'SOLO PRACTICE':`ROOM ${net.room}  ·  ${net.running?'ONLINE':'WAITING FOR FRIEND'}`,28,52);
  ctx.fillStyle='#e9ffef';ctx.font='29px Arial';
  const line=vehicleModeActive()?`${Math.round(vehicleStates[net.index].speed)} SPEED  ·  ${currentGameMode==='race'?`LAP ${Math.min(3,vehicleStates[net.index].lap)}/3  ${raceCheckpointStatus(vehicleStates[net.index])}`:'FREE FLIGHT'}`:
    `${taggedPlayer===net.index?'YOU HAVE THE TAG GLOW':'OTHER SURVEYOR HAS THE GLOW'}  ·  ECHOES ${discoveredEchoes.size}/6`;
  ctx.fillText(line,28,103);
  ctx.fillStyle='#8affce';ctx.font='27px Arial';ctx.fillText('LEFT TRIGGER BUILD  ·  RIGHT TRIGGER THROW / CHARGE',28,153);
  ctx.fillText('LEFT STICK MOVE  ·  RIGHT STICK TURN  ·  A JUMP  ·  B RUN',28,195);
  ctx.fillStyle='#d8e7d4';ctx.fillText('LEFT Y: MENU  ·  X: BUILD PREVIEW',28,237);
  ctx.fillStyle='#ffcf96';ctx.font='24px Arial';ctx.fillText((vehicleModeActive()?vehiclePowerSummary(vehicleStates[net.index]):activePowerSummary(p)).slice(0,78),28,283);
  xrState.hudTexture.needsUpdate=true;
}
function activateVRMenu(controller){
  const origin=new THREE.Vector3();controller.getWorldPosition(origin);
  const ray=new THREE.Raycaster(origin,controllerDirection(controller));xrState.menu.updateMatrixWorld(true);
  const hit=ray.intersectObjects(xrState.menuButtons,false)[0];if(!hit)return;
  if(hit.object.userData.menuAction==='resume')resumeGame();
  if(hit.object.userData.menuAction==='recenter'){recenterVR();resumeGame();}
  if(hit.object.userData.menuAction==='leave')leaveRoom();
}
function recenterVR(){xrState.headPrevious=null;xrState.previous={};controls.roomDX=0;controls.roomDZ=0;}
async function checkVRSupport(){
  let supported=false;try{supported=!!(navigator.xr&&await navigator.xr.isSessionSupported('immersive-vr'));}catch{}
  const text=supported?'ENTER VR':isSecureContext?'VR HEADSET NOT DETECTED':'VR NEEDS HTTPS';
  $('#vr-button').textContent=text;$('#pause-vr').textContent=text;$('#vr-button').disabled=!supported;$('#pause-vr').disabled=!supported;
}
async function enterVR(){
  if(!started){showConnectionError('Create or join a room, or start solo practice, then enter VR.');return;}
  if(renderer.xr.isPresenting)return;
  try{
    const session=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor']});
    ui.pause.hidden=true;controls.paused=false;xrState.menuOpen=false;clearKeys();
    document.exitPointerLock?.();document.body.classList.add('in-vr');xrState.headPrevious=null;
    xrState.rig.add(camera);camera.position.set(0,0,0);camera.rotation.set(0,0,0);
    await renderer.xr.setSession(session);
    renderer.xr.setFoveation?.(.65);
    if(session.supportedFrameRates?.includes(72))session.updateTargetFrameRate(72).catch(()=>{});
    session.addEventListener('end',()=>{document.body.classList.remove('in-vr');xrState.hud.visible=false;xrState.rig.visible=false;camera.removeFromParent();controls.yaw=players[net.index].yaw;controls.pitch=0;controls.paused=false;ui.pause.hidden=true;xrState.menuOpen=false;sendMessage({type:'ready',device:'desktop'});resizeView();});
    session.addEventListener('visibilitychange',()=>{if(session.visibilityState!=='visible'){clearKeys();controls.paused=true;xrState.menuOpen=true;}});
    sendMessage({type:'ready',device:'vr'});
  }catch(e){document.body.classList.remove('in-vr');showSignal(`VR could not start: ${e.message}`,7000);}
}
function readXRFrame(frame){
  const ref=renderer.xr.getReferenceSpace();if(!ref)return;
  const pose=frame.getViewerPose(ref);if(!pose)return;
  const h=pose.transform.position,q=pose.transform.orientation;
  xrState.head.set(h.x,h.y,h.z);xrState.headQuaternion=new THREE.Quaternion(q.x,q.y,q.z,q.w);
  const e=new THREE.Euler().setFromQuaternion(xrState.headQuaternion,'YXZ');xrState.headYaw=e.y;xrState.headPitch=e.x;
  xrState.currentHands=[];
  const scale=xrState.metres*playerScale(players[net.index]),base=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),xrState.baseYaw);
  for(const source of renderer.xr.getSession()?.inputSources||[]){
    const handPose=frame.getPose(source.gripSpace||source.targetRaySpace,ref);if(!handPose)continue;
    const hp=handPose.transform.position,hq=handPose.transform.orientation;
    const offset=new THREE.Vector3(hp.x-h.x,hp.y,hp.z-h.z).multiplyScalar(scale).applyQuaternion(base);offset.y-=playerEyeHeight(players[net.index]);
    const rotation=base.clone().multiply(new THREE.Quaternion(hq.x,hq.y,hq.z,hq.w));
    xrState.currentHands.push({offset:offset.toArray(),rotation:rotation.toArray()});
  }
  if(!xrState.headPrevious){
    xrState.headPrevious=xrState.head.clone();xrState.metres=EYE_HEIGHT/Math.max(1.05,h.y);xrState.baseYaw=players[net.index].yaw-e.y;
  }else{
    const dx=h.x-xrState.headPrevious.x,dz=h.z-xrState.headPrevious.z,scale=xrState.metres*playerScale(players[net.index]);
    if(Math.hypot(dx,dz)<.5){controls.roomDX+=(dx*Math.cos(xrState.baseYaw)+dz*Math.sin(xrState.baseYaw))*scale;controls.roomDZ+=(-dx*Math.sin(xrState.baseYaw)+dz*Math.cos(xrState.baseYaw))*scale;}
    xrState.headPrevious.copy(xrState.head);
  }
}
function positionXRRig(){
  if(!xrState.headPrevious)return;
  const p=players[net.index],scale=xrState.metres*playerScale(p),h=xrState.head,c=Math.cos(xrState.baseYaw),s=Math.sin(xrState.baseYaw);
  xrState.rig.visible=true;xrState.rig.scale.setScalar(scale);xrState.rig.rotation.y=xrState.baseYaw;
  const feet=vehicleModeActive()?p.position.y+.3-playerEyeHeight(p):p.position.y-playerEyeHeight(p);
  xrState.rig.position.set(p.position.x-(h.x*c+h.z*s)*scale,feet,p.position.z-(-h.x*s+h.z*c)*scale);
  xrState.rig.updateMatrixWorld(true);xrState.hud.visible=!xrState.menuOpen;
}
function xrCommand(){
  let forward=0,side=0,sprint=controls.run,jump=false;
  const session=renderer.xr.getSession();
  for(const source of session?.inputSources||[]){
    const g=source.gamepad;if(!g)continue;
    const buttons=g.buttons.map(b=>b.pressed),prev=xrState.previous[source.handedness]||[];
    const axisX=g.axes.length>=4?g.axes[2]:g.axes[0],axisY=g.axes.length>=4?g.axes[3]:g.axes[1];
    if(source.handedness==='left'){
      forward=-applyStickDeadzone(axisY||0);side=applyStickDeadzone(axisX||0);sprint ||= buttons[3];
      if(buttons[5]&&!prev[5]){if(xrState.menuOpen)resumeGame();else pauseGame();}
      if(buttons[4]&&!prev[4])controls.preview=!controls.preview;
    }
    if(source.handedness==='right'){
      jump=buttons[4]&&!prev[4];if(buttons[5]&&!prev[5])controls.run=!controls.run;
      if(Math.abs(axisX||0)<.25)xrState.snapReady=true;
      if(Math.abs(axisX||0)>.65&&xrState.snapReady){xrState.baseYaw-=Math.sign(axisX)*Math.PI/6;xrState.snapReady=false;}
    }
    xrState.previous[source.handedness]=buttons;
  }
  const c={forward,side,sprint,jumpPressed:jump,yaw:xrState.baseYaw+(xrState.headYaw||0),pitch:xrState.headPitch||0,roomDX:controls.roomDX,roomDZ:controls.roomDZ,hands:xrState.currentHands||[]};
  controls.roomDX=0;controls.roomDZ=0;
  const left=xrState.controllers.find(x=>x.userData.source?.handedness==='left');
  if(left){const d=controllerDirection(left);players[net.index].buildYaw=Math.atan2(-d.x,-d.z);}
  return c;
}
function resizeView(){if(!renderer||renderer.xr.isPresenting)return;renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
function bindOnlineEvents(){
  ui.enter.addEventListener('click',()=>connect({type:'create',level:ui.levelSelect.value,mode:ui.modeSelect.value}));
  $('#join-room').addEventListener('click',()=>{const code=$('#room-code').value.trim().toUpperCase();if(!/^[A-F0-9]{6}$/.test(code)){showConnectionError('Enter the six-character room code.');return;}connect({type:'join',room:code});});
  $('#room-code').addEventListener('keydown',e=>{if(e.key==='Enter')$('#join-room').click();});
  $('#practice').addEventListener('click',()=>{net.solo=true;net.index=0;net.running=true;net.seats=[];prepareOnlineWorld(ui.levelSelect.value,ui.modeSelect.value);enterLocalView();requestPointerLockSafely();showSignal('SOLO PRACTICE · Use the menu to return and create an online room.',5000);});
  ui.menu.addEventListener('click',pauseGame);ui.resume.addEventListener('click',resumeGame);
  $('#leave-room').addEventListener('click',leaveRoom);$('#vr-button').addEventListener('click',enterVR);$('#pause-vr').addEventListener('click',enterVR);
  ui.pauseSound.addEventListener('click',()=>audioEngine.toggle());ui.sound.addEventListener('click',()=>audioEngine.toggle());
  ui.pauseHelp.addEventListener('click',()=>showSignal('WASD move · Mouse look · E build · Hold F throw · Space jump · Shift run. VR: Left trigger builds, right throws. Left Y opens menu.',12000));
  $('#copy-room').addEventListener('click',async()=>{try{const u=serverAddress();u.searchParams.set('room',net.room);await navigator.clipboard.writeText(u.toString());showSignal('Invite link copied.',2500);}catch{showSignal(`Share room code ${net.room}`,5000);}});
  ui.levelSelect.addEventListener('change',updateLevelDescription);ui.modeSelect.addEventListener('change',updateModeDescription);
  $('#build-toggle-0').addEventListener('click',()=>controls.preview=!controls.preview);
  $('#place-block-0').addEventListener('click',()=>action({type:'build',yaw:controls.yaw}));
  $('#throw-cube-0').addEventListener('pointerdown',()=>action({type:'charge-start'}));
  $('#throw-cube-0').addEventListener('pointerup',()=>action({type:'charge-end'}));
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,select,textarea')||!started)return;
    if(['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
    keys[e.code]=true;if(e.repeat)return;
    if(e.code==='Escape'||e.code==='Tab'){if(controls.paused)resumeGame();else pauseGame();return;}
    if(controls.paused)return;
    if(e.code==='Space')controls.jump=true;
    if(e.code==='KeyE'){controls.preview=true;action({type:'build',yaw:controls.yaw});}
    if(e.code==='KeyB')controls.preview=!controls.preview;
    if(e.code==='KeyF')action({type:'charge-start'});
  });
  document.addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='KeyF')action({type:'charge-end'});});
  renderer.domElement.addEventListener('mousedown',e=>{
    if(!started||controls.paused)return;
    if(document.pointerLockElement!==renderer.domElement){requestPointerLockSafely();return;}
    if(e.button===0)action({type:'build',yaw:controls.yaw});if(e.button===2)action({type:'charge-start'});
  });
  document.addEventListener('mouseup',e=>{if(e.button===2)action({type:'charge-end'});});
  renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('mousemove',e=>{if(document.pointerLockElement===renderer.domElement&&!controls.paused&&!renderer.xr.isPresenting){controls.yaw-=e.movementX*.0022;controls.pitch=THREE.MathUtils.clamp(controls.pitch-e.movementY*.002,-1.4,1.4);}});
  document.addEventListener('pointerlockchange',()=>{if(started&&!renderer.xr.isPresenting&&!document.pointerLockElement&&!controls.paused&&performance.now()>suppressLockLossUntil)pauseGame();});
  window.addEventListener('blur',()=>{clearKeys();});document.addEventListener('visibilitychange',()=>{if(document.hidden)clearKeys();});
  window.addEventListener('resize',resizeView);
  window.addEventListener('beforeunload',()=>{net.manualClose=true;net.ws?.close();});
  // The original split-screen help is replaced with the actual online controls.
  $('#help-dialog').innerHTML='<h2>Online controls</h2><p>Desktop: WASD move, mouse look, E or left mouse build, hold F or right mouse to charge and throw, Space jump, Shift run, Esc menu.</p><p>Quest: left trigger builds, right trigger charges and throws, left stick moves, right stick snap turns, A jumps, B toggles running, X toggles build preview, left Y opens the VR menu.</p><button id="online-close-help" type="button">CLOSE</button>';
  $('#online-close-help').addEventListener('click',()=>ui.helpDialog.close());
}

window.vermilionDebug={get room(){return net.room;},get seat(){return net.index;},get running(){return net.running;},get position(){return players[net.index].position.toArray();}};
initialiseOnline();
