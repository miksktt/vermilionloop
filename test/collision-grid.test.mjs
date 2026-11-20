import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../simulation.mjs';

test('spatial collision lookup matches direct triangle checks for spheres and rays',()=>{
 const sim=createSimulation('city','survey');
 const result=sim.eval(`(()=>{
  const r=mulberry32(94391),world=collisionWorld;
  for(let i=0;i<100;i++){
   const triangle=world.triangles[Math.floor(r()*world.triangles.length)];
   const p=triangle.getMidpoint(new THREE.Vector3()).add(new THREE.Vector3(r()-.5,r()-.5,r()-.5));
   const sphere=new THREE.Sphere(p,.15+r()*1.5),candidates=[];world.getSphereTriangles(sphere,candidates);
   const set=new Set(candidates);
   for(const t of world.triangles)if(world.triangleSphereIntersect(sphere,t)&&!set.has(t))return {ok:false,kind:'sphere',i};
  }
  for(let i=0;i<80;i++){
   const ray=new THREE.Ray(new THREE.Vector3(r()*520-260,150,r()*520-260),new THREE.Vector3(i%2?(r()-.5)*.7:0,-1,i%2?(r()-.5)*.7:0).normalize());
   let nearest=Infinity;
   for(const t of world.triangles){const point=ray.intersectTriangle(t.a,t.b,t.c,true,new THREE.Vector3());if(point)nearest=Math.min(nearest,point.distanceTo(ray.origin));}
   const hit=world.rayIntersect(ray);
   if(Number.isFinite(nearest)!==!!hit)return {ok:false,kind:'ray-presence',i};
   if(hit&&Math.abs(hit.distance-nearest)>1e-5)return {ok:false,kind:'ray-distance',i,direct:nearest,grid:hit.distance};
  }
  return {ok:true};
 })()`);
 assert.equal(result.ok,true,JSON.stringify(result));
});
