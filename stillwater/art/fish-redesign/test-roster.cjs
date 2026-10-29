const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('work/toon-check.js','utf8'),ctx={};
vm.createContext(ctx);
for(const name of ['fishData','fishBehaviors','memories','runNames']){
 const pattern=new RegExp('const '+name+'=\\[[\\s\\S]*?\\];');
 vm.runInContext(source.match(pattern)[0]+`;globalThis.${name}Value=${name}`,ctx);
 assert.equal(ctx[name+'Value'].length,12,name);
}
for(let zone=0;zone<3;zone++)assert.equal(ctx.fishDataValue.filter(f=>f.zone===zone).length,4);
for(const f of ctx.fishDataValue){assert(f.weight[1]>f.weight[0]&&f.weight[0]>0);assert(f.name&&f.desc&&f.latin)}
for(const b of ctx.fishBehaviorsValue){assert(b.start+b.duration<b.period);assert(b.speed>0&&b.pull>0&&b.surge>0)}
const choose=source.slice(source.indexOf('function chooseFish(){'),source.indexOf('\nfunction ',source.indexOf('function chooseFish(){')+1));
vm.runInContext('let save={total:1,fish:{}},zone=0,currentFish=-1,castAccuracy=.8;'+choose,ctx);
for(let z=0;z<3;z++){
 const seen=new Set();ctx.z=z;
 vm.runInContext('zone=z',ctx);
 for(let i=0;i<1000;i++){vm.runInContext('chooseFish();globalThis.picked=currentFish',ctx);assert.equal(ctx.fishDataValue[ctx.picked].zone,z);seen.add(ctx.picked)}
 assert.equal(seen.size,4);
}
vm.runInContext('zone=0;save.total=0;chooseFish();globalThis.picked=currentFish',ctx);assert.equal(ctx.picked,0);
// Execute the actual loading loop against both old six-fish saves and twelve-fish saves.
const load=source.match(/try\{const s=JSON.parse\(localStorage.getItem\('stillwater-v1'\)\);.*?catch\(e\)\{saveOK=false\}/)[0];
for(const count of [6,12]){
 ctx.saved=JSON.stringify({total:count,sound:false,fish:Object.fromEntries(Array.from({length:count},(_,i)=>[i,{count:1,best:2}]))});
 vm.runInContext("{save={total:0,fish:{}};let saveOK=true;const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));const localStorage={getItem:()=>saved};"+load+";globalThis.loaded=Object.keys(save.fish).length}",ctx);
 assert.equal(ctx.loaded,count);
 // Reset only lexical declarations in a new context for the second save.
}
console.log('PASS: 12 species/behaviors/letters; 4 residents per zone; all discoverable; first-catch onboarding; save migration.');
