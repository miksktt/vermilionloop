import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('./public/',import.meta.url));
const sources=['three.min.js','collision-vendor.js','collision-grid.js','core.js','physics.js'].map(f=>fs.readFileSync(root+f,'utf8'));

function fakeElement() {
  const noop=()=>{};
  const context=new Proxy({measureText:s=>({width:String(s).length*14}),createLinearGradient:()=>({addColorStop:noop}),createRadialGradient:()=>({addColorStop:noop})},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
  return {hidden:true,value:'keyboard',textContent:'',innerHTML:'',style:{setProperty:noop},dataset:{},
    classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},setAttribute:noop,append:noop,prepend:noop,
    addEventListener:noop,querySelector:()=>fakeElement(),getContext:()=>context,options:[],width:512,height:128};
}

export function createSimulation(level='forest',mode='survey') {
  const elements=new Map();
  const document={hidden:false,querySelector:s=>{if(!elements.has(s))elements.set(s,fakeElement());return elements.get(s);},
    querySelectorAll:()=>[],getElementById:s=>document.querySelector('#'+s),createElement:()=>fakeElement(),body:fakeElement()};
  const context=vm.createContext({console:{...console,warn:()=>{}},performance,document,navigator:{maxTouchPoints:0,getGamepads:()=>[]},
    window:{innerWidth:1280,innerHeight:800,matchMedia:()=>({matches:false}),setTimeout:()=>0},setTimeout:()=>0,clearTimeout:()=>{},
    __level:level,__mode:mode});
  for(let i=0;i<sources.length;i++)vm.runInContext(sources[i],context,{filename:['three.min.js','collision-vendor.js','collision-grid.js','core.js','physics.js'][i]});
  vm.runInContext(`
    const serverEvents=[];
    showSignal=(text)=>{serverEvents.push({text:String(text).replaceAll('—',' · ')});if(serverEvents.length>12)serverEvents.shift();};
    updateReadouts=()=>{};updateBuildReadouts=()=>{};updatePowerupOverlays=()=>{};updateTagHud=()=>{};
    buildTerrain=()=>{};buildSky=()=>{};buildMotes=()=>{};buildFireflies=()=>{};
    gameIsActive=()=>started;
    currentLevel=__level;currentGameMode=__mode;
    resetPlayersForLevel();buildScene();buildCollisionWorld();started=true;
    updateSurveyors=()=>updateTagGame();
    globalThis.game={
      command(i,c){applyPlayerCommand(i,c,1/60);},
      action(i,a){
        const p=players[i];
        if(a.type==='build'){p.building=true;p.buildYaw=Number.isFinite(a.yaw)?a.yaw:p.yaw;placeBlock(i);}
        if(a.type==='charge-start')beginThrowCharge(i,'online');
        if(a.type==='charge-end'){
          p.throwAim=Array.isArray(a.direction)?a.direction:null;
          p.throwOrigin=Array.isArray(a.origin)?a.origin:null;
          releaseThrowCharge(i);p.throwAim=null;p.throwOrigin=null;
        }
      },
      tick(dt){
        simulationTime+=dt;
        if(vehicleModeActive())updateVehiclePowerups(dt);
        else {updateConstruction();updateTowerRoofEffects(dt);updatePowerups(dt);updateThrownCubes(dt);updateExplosions(dt);updateTagGame();}
        updateNPCSurveyors(dt);
        if(!vehicleModeActive())players.forEach((p,i)=>checkEchoes(p,i));
      },
      snapshot(){
        const fields=(o,names)=>Object.fromEntries(names.split(' ').map(k=>[k,o[k]]));
        const ps=players.map(p=>({...fields(p,'yaw pitch verticalVelocity grounded distance loop walkPhase walkAmount lastGroundHeight appliedScale building isRunning powerTimers hands'),position:p.position.toArray()}));
        return {time:simulationTime,players:ps,taggedPlayer,lastTagTransfer,echoes:[...discoveredEchoes],
          towers:towerStates.map(t=>({...t,activeUntil:Number.isFinite(t.activeUntil)?t.activeUntil:0})),
          blocks:temporaryBlocks.map(b=>fields(b,'id x z bottom top born owner')),
          shots:thrownCubes.map(s=>({...fields(s,'id owner born x y z vx vy vz radius stuck attachedToPlayer tagCharged explosive mega blastBoosted tiny'),scale:s.group.scale.x})),
          powerups:powerups.map(p=>fields(p,'type typeCycle x y z ground born phase')),
          npcs:npcVisuals.map(n=>fields(n,'x y z yaw walkPhase airborne lastSpeech speechUntil')),
          vehicles:vehicleStates.map(v=>({...v,powerTimers:{...v.powerTimers}})),raceWinner,
          vehiclePowerups:vehiclePowerups.map(p=>fields(p,'type x y z born phase')),
          bursts:explosionBursts.map(b=>fields(b,'x y z born owner charged strength')),
          events:serverEvents.splice(0),
          triangleCount:collisionTriangleCount};
      }
    };
  `,context,{filename:'simulation-bootstrap.js'});
  return {command:(i,c)=>context.game.command(i,c),action:(i,a)=>context.game.action(i,a),tick:dt=>context.game.tick(dt),
    snapshot:()=>JSON.parse(JSON.stringify(context.game.snapshot())),eval:code=>vm.runInContext(code,context)};
}
