import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Sim,stageOf,housingOf} from '../js/sim.js';
import {CENTERS} from '../js/world.js';
import {towerMode} from '../js/arcane.js';
import {progressBuildingHtml,progressVillagerHtml,progressClick} from '../js/progressui.js';
import {mortgageCost} from '../js/economy.js';
const fresh=()=>{const sim=new Sim(null,{seed:'round-ten-tests'});sim.s.level=9;return sim;};
function build(sim,type,sid='meadow'){
  const c=CENTERS[sid];for(let r=2;r<21;r++)for(let z=c.z-r;z<=c.z+r;z++)for(let x=c.x-r;x<=c.x+r;x++){
    const chk=sim.checkPlace(type,x,z,0,-2);if(chk.ok&&chk.sid===sid)return sim.addBuilding(type,x,z,0,true);
  }throw Error('No room for '+type);
}
function adult(sim,tier=2){const v=sim.s.villagers.find(v=>stageOf(v)==='adult'&&v.job==='idle');v.tier=tier;v.abil={str:12,dex:12,con:12,int:16,wis:14,cha:14};v.purse=20;v.asleep=false;return v;}
function stock(sim,sid='meadow',n=60){for(const k of sim.trade.PHYS){sim.s.stock[sid]||={};sim.s.stock[sid][k]=n;sim.s.res[k]=Object.keys(sim.s.unlocked).reduce((a,id)=>a+(sim.s.stock[id]?.[k]||0),0);sim.ledger.tot[k]=sim.s.res[k];}sim.s.res.coins=1000;}
function wizard(sim,sid='meadow'){const b=build(sim,'wizard',sid),v=adult(sim);v.home=sid;assert.ok(sim.assign(b,v));return {b,v};}
test('capped scholars free library seats and new learners rotate in',()=>{
  const sim=fresh(),b=build(sim,'library'),v=adult(sim,3);sim.assign(b,v);sim.careerSecond();
  assert.equal(v.job,'idle');assert.equal(v.work,null);assert.ok(v.studyAfter>sim.s.time);
  assert.ok(b.workers.length>0);assert.ok(!b.workers.includes(v.id));assert.ok(b.workers.every(id=>sim.eduTier(sim.vById.get(id))<3));
});
test('graduation seeks a suitable local vacancy even during the return-to-study cooldown',()=>{
  const sim=fresh(),lib=build(sim,'library'),v=adult(sim,3);sim.assign(lib,v);sim.advanceCareer(v,true);
  const job=build(sim,'forge');sim.careerSecond();assert.equal(v.work,job.id);assert.equal(v.job,'smith');
});
test('Honours applicants continue at a staffed university and faculty remain at their posts',()=>{
  const sim=fresh(),uni=build(sim,'university'),teacher=adult(sim);sim.assign(uni,teacher);
  const v=adult(sim);sim.careerSecond();assert.equal(teacher.job,'professor');assert.equal(teacher.work,uni.id);assert.equal(v.job,'student');assert.equal(v.work,uni.id);
});
test('university placement respects tuition, local region and education eligibility',()=>{
  const sim=fresh(),uni=build(sim,'university'),teacher=adult(sim);sim.assign(uni,teacher);while(uni.workers.length<2){const p=adult(sim);sim.assign(uni,p);}
  const v=adult(sim);v.purse=0;assert.equal(sim.advanceCareer(v),false);v.purse=20;v.age=40;assert.equal(sim.advanceCareer(v),false);
  v.age=20;v.home='pine';assert.equal(sim.advanceCareer(v),false);v.home='meadow';assert.equal(sim.advanceCareer(v),true);assert.equal(v.job,'student');
});
test('automatic placement excludes children, custody, quests and incapacitation',()=>{
  for(const flag of ['child','jail','quest','ko','downed']){const sim=fresh();build(sim,'forge');const v=adult(sim);if(flag==='child'){v.age=8;v.stage='child';}else v[flag]=flag==='jail'?sim.s.time+30:flag==='quest'?{}:10;assert.equal(sim.advanceCareer(v),false);}
});
test('unfunded university students free seats, seek wages and preserve study progress',()=>{
  const sim=fresh(),uni=build(sim,'university'),teacher=adult(sim);sim.assign(uni,teacher);sim.assign(uni,adult(sim));
  const v=adult(sim);assert.ok(sim.enrol(v,uni));v.university=90;v.purse=0;const job=build(sim,'forge');
  sim.careerSecond();assert.equal(v.job,'student');sim.s.time+=60;sim.careerSecond();assert.equal(v.work,job.id);assert.equal(v.job,'smith');assert.equal(v.university,90);assert.ok(v.universityAfter>sim.s.time);assert.ok(!sim.universityStudents(uni).includes(v));
  sim.unassign(v);v.purse=20;assert.ok(sim.advanceCareer(v));assert.equal(v.work,job.id);
});
test('funded university students keep seats through ordinary faculty sleep',()=>{
  const sim=fresh(),uni=build(sim,'university'),teacher=adult(sim);sim.assign(uni,teacher);const v=adult(sim);sim.enrol(v,uni);teacher.asleep=true;sim.careerSecond();sim.s.time+=90;sim.careerSecond();assert.equal(v.work,uni.id);assert.equal(v.job,'student');
});
test('global and individual manual controls preserve library assignments and persist',()=>{
  for(const global of [true,false]){const sim=fresh(),b=build(sim,'library'),v=adult(sim,3);sim.assign(b,v);if(global)sim.s.autoCareers=false;else v.autoCareer=false;sim.careerSecond();assert.equal(v.work,b.id);const loaded=new Sim(sim.serialize());assert.equal(global?loaded.s.autoCareers:loaded.vById.get(v.id).autoCareer,false);}
});
test('stale library callbacks cannot grant education after removal or custody',()=>{
  for(const flag of ['removed','jail','work']){const sim=fresh(),b=build(sim,'library'),v=adult(sim,0);sim.assign(b,v);sim.taskLibrary(v,b);const done=v.task.steps.find(s=>s.act).done;if(flag==='removed')sim.bById.delete(b.id);else if(flag==='jail')v.jail=sim.s.time+30;else sim.unassign(v);done();assert.equal(v.study||0,0);}
});
test('a library tier gain transitions to suitable work within the completed lesson',()=>{
  const sim=fresh(),b=build(sim,'library'),job=build(sim,'forge'),v=adult(sim,0);sim.assign(b,v);v.study=59;sim.taskLibrary(v,b);v.task.steps.find(s=>s.act).done();assert.equal(sim.eduTier(v),1);assert.equal(v.work,job.id);
});
test('hostels provide shared beds without claiming ownership or a mortgage',()=>{
  const sim=fresh(),b=build(sim,'hostel');sim.settleHomes();const residents=sim.s.villagers.filter(v=>sim.homeOf(v)?.id===b.id);assert.ok(residents.length>0);assert.ok(residents.length<=housingOf(b));assert.equal(b.owner,undefined);for(const v of residents)assert.equal(sim.ownsHome(v),null);
  sim.renameHome(b,'Wayfarers Rest');const loaded=new Sim(sim.serialize());assert.equal(loaded.homeName(loaded.bById.get(b.id)),'Wayfarers Rest');
});
test('new private homes claim households, move hostel residents and preserve repayments',()=>{
  for(const [type,cost]of [['rowhouse',120],['manor',300]]){const sim=fresh(),hostel=build(sim,'hostel');sim.settleHomes();const b=build(sim,type);sim.settleHomes();const owner=sim.homeOwner(b);assert.ok(owner);assert.equal(sim.ownsHome(owner).id,b.id);assert.equal(sim.homeOf(owner).id,b.id);assert.notEqual(sim.homeOf(owner).id,hostel.id);assert.equal(mortgageCost(b),cost);b.paid=27;const loaded=new Sim(sim.serialize());assert.equal(loaded.bById.get(b.id).paid,27);assert.equal(loaded.homeOwner(loaded.bById.get(b.id)).id,owner.id);}
});
test('tower mode changes cancel existing practice and survive saving',()=>{
  const sim=fresh(),{b,v}=wizard(sim);assert.equal(towerMode(b),'research');sim.taskStudy(v,b);assert.ok(v.task);sim.setTowerMode(b,'ward');assert.equal(v.task,null);assert.equal(towerMode(new Sim(sim.serialize()).bById.get(b.id)),'ward');assert.equal(sim.setTowerMode(b,'bogus'),false);
});
test('wards spend only local stone, affect only their region and expire',()=>{
  const sim=fresh();sim.unlock('pine',true);stock(sim);stock(sim,'pine');const {b,v}=wizard(sim,'pine');sim.setTowerMode(b,'ward');const local=sim.trade.get('pine','stone'),meadow=sim.trade.get('meadow','stone'),pressure=sim.crimePressure('pine'),other=sim.crimePressure('meadow');assert.ok(sim.towerEffect(b,v));assert.equal(sim.trade.get('pine','stone'),local-1);assert.equal(sim.trade.get('meadow','stone'),meadow);assert.equal(sim.crimePressure('pine'),Math.max(0,pressure-8));assert.equal(sim.crimePressure('meadow'),other);sim.s.time=b.data.wardUntil;assert.equal(sim.crimePressure('pine'),pressure);
});
test('artifice deposits output in its own region and respects full storage',()=>{
  const sim=fresh();sim.unlock('pine',true);stock(sim);stock(sim,'pine',10);const {b,v}=wizard(sim,'pine');sim.setTowerMode(b,'artifice');const wood=sim.trade.get('pine','wood'),planks=sim.trade.get('pine','planks'),away=sim.trade.get('meadow','planks'),total=sim.s.res.planks;assert.ok(sim.towerEffect(b,v));assert.equal(sim.trade.get('pine','wood'),wood-2);assert.equal(sim.trade.get('pine','planks'),planks+1);assert.equal(sim.trade.get('meadow','planks'),away);assert.equal(sim.s.res.planks,total+1);assert.equal(sim.ledger.tot.planks,sim.s.res.planks);
  sim.s.stock.pine.planks+=sim.trade.room('pine','planks');sim.s.res.planks=sim.s.stock.pine.planks+sim.s.stock.meadow.planks;sim.ledger.tot.planks=sim.s.res.planks;const before=sim.trade.get('pine','wood');assert.equal(sim.towerEffect(b,v),false);assert.equal(sim.trade.get('pine','wood'),before);
});
test('nature requires growing fields and advances at most three local fields',()=>{
  const sim=fresh();stock(sim);const {b,v}=wizard(sim);sim.setTowerMode(b,'nature');const food=sim.trade.get('meadow','food');assert.equal(sim.towerEffect(b,v),false);assert.equal(sim.trade.get('meadow','food'),food);
  const farms=Array.from({length:4},()=>build(sim,'farm'));for(const f of farms){f.data.stage='growing';f.data.grow=.95;}const inReach=sim.towerFields(b);assert.ok(inReach.length);assert.ok(sim.towerEffect(b,v));assert.equal(sim.trade.get('meadow','food'),food-1);for(const f of inReach.slice(0,3)){assert.equal(f.data.grow,1);assert.equal(f.data.stage,'ripe');}for(const f of inReach.slice(3))assert.equal(f.data.grow,.95);
});
test('focused rituals charge once, enforce cooldown and reject sleeping staff',()=>{
  const sim=fresh();stock(sim);const {b,v}=wizard(sim);sim.setTowerMode(b,'ward');v.asleep=true;assert.equal(sim.performTowerRitual(b),false);v.asleep=false;const coins=sim.s.res.coins,stone=sim.trade.get('meadow','stone');assert.ok(sim.performTowerRitual(b));assert.equal(sim.s.res.coins,coins-10);assert.equal(sim.trade.get('meadow','stone'),stone-1);assert.equal(b.data.wardUntil,sim.s.time+90);assert.equal(sim.performTowerRitual(b),false);assert.equal(sim.s.res.coins,coins-10);sim.s.time=b.data.ritualUntil;assert.ok(sim.performTowerRitual(b));
});
test('stale research and specialized callbacks cannot grant effects',()=>{
  for(const mode of ['research','ward','nature','artifice']){const sim=fresh();stock(sim);const {b,v}=wizard(sim);sim.setTowerMode(b,mode);sim.taskStudy(v,b);const done=v.task.steps.find(s=>s.act).done;sim.bById.delete(b.id);const before=JSON.stringify(sim.s.res),xp=v.xp;done();assert.equal(JSON.stringify(sim.s.res),before);assert.equal(v.xp,xp);assert.equal(b.data.sessions||0,0);}
});
test('tower and education controls show real blockers and escape personal notes',()=>{
  const sim=fresh(),{b,v}=wizard(sim);v.careerNote='<script>alert(1)</script>';assert.match(progressBuildingHtml({sim},b),/Research/);assert.match(progressBuildingHtml({sim},b),/Warding/);assert.match(progressBuildingHtml({sim},b),/Nature/);assert.match(progressBuildingHtml({sim},b),/Artifice/);assert.doesNotMatch(progressVillagerHtml({sim},v),/<script>/);progressClick({sim},'progress-person',{}, {kind:'v',v});assert.equal(v.autoCareer,false);progressClick({sim},'progress-cycle',{},{});assert.equal(sim.s.autoCareers,false);
});
test('all three housing meshes have valid binary ranges and node hierarchy',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../models/models.json',import.meta.url))),bin=fs.readFileSync(new URL('../models/models.bin',import.meta.url));assert.equal(Object.keys(data.models).length,92);for(const type of ['rowhouse','hostel','manor']){const nodes=data.models[type]?.nodes;assert.ok(nodes?.length>=2,type);for(const n of nodes)for(const m of n.meshes||[]){assert.ok(m.pos>=0&&m.pos+m.nv*6<=bin.length);assert.ok(m.idx>=0&&m.idx+m.ni*2<=bin.length);}}
});
