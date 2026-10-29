const fs=require('fs'),vm=require('vm'),assert=require('assert');
const THREE=require('./three-test.cjs');
const source=fs.readFileSync('work/toon-check.js','utf8');
const take=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const ctx={THREE,assert};
vm.createContext(ctx);
vm.runInContext(
 take('function shapeFrom(points)','const lakePoints=')+
 source.match(/const lakePoints=.*?;/)[0]+
 `const lakeShape=shapeFrom(lakePoints);
 const castShore=lakeShape.getPoints().map(p=>[p.x,-p.y]);
 const dock=new THREE.Group();dock.position.set(-2,.55,-.25);dock.updateWorldMatrix(true,true);
 `+source.match(/const castDockBounds = .*?;/)[0]+`
 const aimOrigin=new THREE.Vector3();`+
 take('function isCastWater(','\nlet castAccuracy='),ctx);
vm.runInContext(`
assert(!isCastWater(0,-.25),'dock must reject');
assert(!isCastWater(-20,0),'land must reject');
assert(!isCastWater(NaN,0),'invalid coordinate must reject');
for(const [x,z] of [[3,2.6],[6.6,-.5],[6.2,4.8]])assert(isCastWater(x,z),'default spot');
let count=0;
for(let x=-5;x<=11;x+=.4)for(let z=-5;z<=8;z+=.4){
 chooseAimOrigin(new THREE.Vector3(x,.46,z));
 for(let i=0;i<=100;i++){
  const sweep=i/50-1;
  assert(isCastWater(aimOrigin.x+sweep*1.3,aimOrigin.z+sweep*.36),'sweep landed on obstruction');
  count++;
 }
}
globalThis.result=count;
`,ctx);
// Verify the actual commit guard, including rejected casts staying in aim state.
vm.runInContext(`
let state='aim',paused=false,castAccuracy=0,castLabel='',castTarget=new THREE.Vector3();
const aimPoint=new THREE.Vector3(0,.46,-.25),aimCenter=new THREE.Vector3(3,.46,2.6);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),toast=()=>{},enter=s=>state=s;
`+take('function commitCast()','function cancelAim()')+`
commitCast();assert.equal(state,'aim');
aimPoint.copy(aimCenter);commitCast();assert.equal(state,'cast');
`,ctx);
console.log(`PASS: ${ctx.result} landing samples; dock/land rejection; all default spots; commit guard.`);
