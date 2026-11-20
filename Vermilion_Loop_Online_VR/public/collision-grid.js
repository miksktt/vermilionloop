/* Spatial broad phase over the original solid triangles. Narrow-phase maths is unchanged. */
(function(){
 class CollisionGrid extends CollisionOctree {
  constructor(cellSize=8){super();this.cellSize=cellSize;this.cells=new Map();}
  key(x,y,z){return `${x},${y},${z}`;}
  build(){
   this.calcBox();const size=this.cellSize;
   for(const triangle of this.triangles){
    const {a,b,c}=triangle;
    const minX=Math.floor(Math.min(a.x,b.x,c.x)/size),maxX=Math.floor(Math.max(a.x,b.x,c.x)/size);
    const minY=Math.floor(Math.min(a.y,b.y,c.y)/size),maxY=Math.floor(Math.max(a.y,b.y,c.y)/size);
    const minZ=Math.floor(Math.min(a.z,b.z,c.z)/size),maxZ=Math.floor(Math.max(a.z,b.z,c.z)/size);
    for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++)for(let z=minZ;z<=maxZ;z++){
     const key=this.key(x,y,z);let cell=this.cells.get(key);if(!cell){cell=[];this.cells.set(key,cell);}cell.push(triangle);
    }
   }
   return this;
  }
  collect(minX,minY,minZ,maxX,maxY,maxZ,out){
   const size=this.cellSize,seen=new Set(out);
   for(let x=Math.floor(minX/size);x<=Math.floor(maxX/size);x++)for(let y=Math.floor(minY/size);y<=Math.floor(maxY/size);y++)for(let z=Math.floor(minZ/size);z<=Math.floor(maxZ/size);z++){
    const cell=this.cells.get(this.key(x,y,z));if(!cell)continue;
    for(const triangle of cell)if(!seen.has(triangle)){seen.add(triangle);out.push(triangle);}
   }
   return out;
  }
  getCapsuleTriangles(capsule,out){
   const a=capsule.start,b=capsule.end,r=capsule.radius;
   return this.collect(Math.min(a.x,b.x)-r,Math.min(a.y,b.y)-r,Math.min(a.z,b.z)-r,Math.max(a.x,b.x)+r,Math.max(a.y,b.y)+r,Math.max(a.z,b.z)+r,out);
  }
  getSphereTriangles(sphere,out){const p=sphere.center,r=sphere.radius;return this.collect(p.x-r,p.y-r,p.z-r,p.x+r,p.y+r,p.z+r,out);}
  getRayTriangles(ray,out){
   let near=0,far=Infinity;
   for(const axis of ['x','y','z']){
    const o=ray.origin[axis],d=ray.direction[axis],lo=this.box.min[axis],hi=this.box.max[axis];
    if(Math.abs(d)<1e-12){if(o<lo||o>hi)return out;continue;}
    let a=(lo-o)/d,b=(hi-o)/d;if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(far<near)return out;
   }
   if(!Number.isFinite(far)||far<0)return out;
   const size=this.cellSize,p=ray.at(near+1e-7,new THREE.Vector3());
   const cell={x:Math.floor(p.x/size),y:Math.floor(p.y/size),z:Math.floor(p.z/size)},step={},next={},delta={};
   for(const axis of ['x','y','z']){
    const d=ray.direction[axis];step[axis]=Math.sign(d);delta[axis]=d?size/Math.abs(d):Infinity;
    next[axis]=d?(((cell[axis]+(d>0?1:0))*size)-ray.origin[axis])/d:Infinity;
   }
   const seen=new Set(out);let distance=near;
   for(let i=0;i<2048&&distance<=far+1e-6;i++){
    const triangles=this.cells.get(this.key(cell.x,cell.y,cell.z));
    if(triangles)for(const t of triangles)if(!seen.has(t)){seen.add(t);out.push(t);}
    const axis=next.x<=next.y&&next.x<=next.z?'x':next.y<=next.z?'y':'z';
    distance=next[axis];cell[axis]+=step[axis];next[axis]+=delta[axis];
   }
   return out;
  }
 }
 globalThis.CollisionGrid=CollisionGrid;
})();
