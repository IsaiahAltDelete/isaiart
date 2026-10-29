const fs=require('fs'),vm=require('vm'),assert=require('assert'),THREE=require('./three-test.cjs');
const source=fs.readFileSync('work/toon-check.js','utf8'),ctx={THREE,fishData:Array.from({length:12},(_,i)=>({name:'Fish '+i})),reduced:false};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('work/fish-redesign.js','utf8'),ctx);
vm.runInContext(source.slice(source.indexOf('function animateFish('),source.indexOf('\n',source.indexOf('function animateFish('))),ctx);
for(let id=0;id<12;id++){
 const fish=vm.runInContext(`makeFish(${id})`,ctx);ctx.testFish=fish;
 let vertices=0;
 fish.traverse(m=>{if(!m.isMesh)return;const p=m.geometry.attributes.position;
  for(const x of p.array)assert(Number.isFinite(x));
  if(m.geometry.index)for(const ix of m.geometry.index.array)assert(ix<p.count);
  vertices+=p.count;
 });
 for(let t=0;t<20;t+=.05){ctx.time=t;vm.runInContext('animateFish(testFish,time)',ctx);fish.updateMatrixWorld(true);fish.traverse(m=>m.matrixWorld.elements.forEach(x=>assert(Number.isFinite(x))))}
 const box=new THREE.Box3().setFromObject(fish),size=box.getSize(new THREE.Vector3());assert(size.x>1&&size.z>2&&size.length()<8);
 console.log(`Fish ${id}: ${vertices} vertices; finite geometry/indices, bounds and 400 animation samples passed.`);
}
