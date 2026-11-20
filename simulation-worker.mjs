import {parentPort,workerData} from 'node:worker_threads';
import {createSimulation} from './simulation.mjs';

const progress=message=>parentPort.postMessage({type:'progress',message});
if(workerData.startupDelay)await new Promise(resolve=>setTimeout(resolve,workerData.startupDelay));
let simulation,ticks=0;
try{
  progress('Preparing the shared world…');
  simulation=createSimulation(workerData.level,workerData.mode);
  parentPort.postMessage({type:'ready',snapshot:simulation.snapshot()});
}catch(error){
  parentPort.postMessage({type:'failed',message:`Could not prepare the world: ${error.message}`});
  parentPort.close();
}
if(simulation)parentPort.on('message',message=>{
  try{
    if(message.type==='command')simulation.command(message.index,message.command);
    if(message.type==='action')simulation.action(message.index,message.action);
    if(message.type==='tick'){
      simulation.tick(message.dt);
      if(++ticks%3===0)parentPort.postMessage({type:'snapshot',snapshot:simulation.snapshot()});
    }
  }catch(error){
    parentPort.postMessage({type:'failed',message:`The room simulation stopped: ${error.message}`});
    parentPort.close();
  }
});
