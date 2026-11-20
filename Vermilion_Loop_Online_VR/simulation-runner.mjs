import {EventEmitter} from 'node:events';
import {Worker} from 'node:worker_threads';

// World construction and physics never block HTTP, heartbeats or other rooms.
export class SimulationRunner extends EventEmitter {
  constructor(level,mode,{startupTimeout=180000,startupDelay=0}={}){
    super();
    this.closed=false;this.failed=false;this.isReady=false;this.latest=null;this.events=[];
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
    this.worker=new Worker(new URL('./simulation-worker.mjs',import.meta.url),{
      workerData:{level,mode,startupDelay},resourceLimits:{maxOldGenerationSizeMb:160,maxYoungGenerationSizeMb:24}
    });
    this.timer=setTimeout(()=>this.fail(new Error('Room preparation timed out. Please try again.')),startupTimeout);
    this.timer.unref();
    this.worker.on('message',message=>{
      if(this.closed)return;
      if(message.type==='progress'){this.emit('progress',message.message);return;}
      if(message.type==='failed'){this.fail(new Error(message.message));return;}
      if(message.type==='ready'||message.type==='snapshot'){
        const snapshot=message.snapshot;this.events.push(...(snapshot.events||[]));
        this.latest={...snapshot,events:[]};
        if(message.type==='ready'){this.isReady=true;clearTimeout(this.timer);this.resolveReady(this);}
      }
    });
    this.worker.on('error',error=>this.fail(error));
    this.worker.on('exit',code=>{if(!this.closed&&!this.failed)this.fail(new Error(`Room worker stopped (${code}).`));});
  }
  fail(error){
    if(this.closed||this.failed)return;
    this.failed=true;clearTimeout(this.timer);this.rejectReady(error);this.emit('failure',error);
    this.worker.terminate().catch(()=>{});
  }
  command(index,command){if(this.isReady&&!this.closed&&!this.failed)this.worker.postMessage({type:'command',index,command});}
  action(index,action){if(this.isReady&&!this.closed&&!this.failed)this.worker.postMessage({type:'action',index,action});}
  tick(dt){if(this.isReady&&!this.closed&&!this.failed)this.worker.postMessage({type:'tick',dt});}
  snapshot(){if(!this.latest)throw new Error('The room is still being prepared.');return {...this.latest,events:this.events.splice(0)};}
  close(){
    if(this.closed)return;
    this.closed=true;clearTimeout(this.timer);
    if(!this.isReady&&!this.failed)this.rejectReady(new Error('Room preparation was cancelled.'));
    this.worker.terminate().catch(()=>{});
  }
}
