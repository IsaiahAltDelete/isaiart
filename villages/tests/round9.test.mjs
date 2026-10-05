import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Sim, stageOf, footprint } from '../js/sim.js';
import { CENTERS, toWorld } from '../js/world.js';
import { maxHp, classOf } from '../js/rpg.js';
import { facingViewer } from '../js/placement.js';
import { currentRegion, boardRegion, regionSummary, jobCandidates, boardClick, buildingsBoardHtml, jobsBoardHtml, worldRegionsHtml } from '../js/boards.js';
import { townBuildingHtml } from '../js/townui.js';
const fresh = () => {const sim=new Sim(null,{seed:'round-nine-tests'});sim.s.level=9;return sim;};
function build(sim,type,sid='meadow') {
  const c=CENTERS[sid];
  for(let r=2;r<20;r++)for(let z=c.z-r;z<=c.z+r;z++)for(let x=c.x-r;x<=c.x+r;x++) {
    const check=sim.checkPlace(type,x,z,0,-2);
    if(check.ok&&check.sid===sid)return sim.addBuilding(type,x,z,0,true);
  }
  throw Error('No room for '+type);
}
const adult = sim => {const v=sim.s.villagers.find(v=>stageOf(v)==='adult'&&v.job==='idle');v.tier=2;return v;};
const lesson = (sim,v,b) => {sim.taskClassPlace(v,b);v.task.steps.find(s=>s.act).done();};
const uiFor = sim => ({sim,g:{view:{rig:{tx:toWorld(CENTERS.meadow.x),tz:toWorld(CENTERS.meadow.z)}},thumbs:{}},bStatus:()=>({text:'Built'}),drawModal(){},toast(){}});
function stock(sim,n=1000) {for(const k of sim.trade.PHYS){sim.s.stock.meadow[k]=n;sim.s.res[k]=n;sim.ledger.tot[k]=n;}sim.s.res.coins=n;}

test('placement snaps front doors to the viewer in all quadrants and wrapped angles',()=>{
  for(let n=-12;n<=12;n++)assert.equal(facingViewer(n*Math.PI/2),((n%4)+4)%4);
  assert.equal(facingViewer(Math.PI/4-.001),0);assert.equal(facingViewer(Math.PI/4+.001),1);
  assert.equal(facingViewer(-Math.PI/4-.001),3);
});
test('faith jobs require schooling and train commoners without changing experienced classes',()=>{
  const sim=fresh(),b=build(sim,'chapel'),v=adult(sim);v.tier=0;
  assert.equal(sim.assign(b,v),false);assert.equal(classOf(v),'commoner');
  v.tier=1;assert.equal(sim.assign(b,v),true);assert.equal(classOf(v),'cleric');
  sim.unassign(v);v.cls='wizard';assert.equal(sim.assign(b,v),true);assert.equal(classOf(v),'wizard');
});
test('class workplaces train the matching careers and save their staff',()=>{
  for(const [type,cls] of [['trainingyard','fighter'],['rangerlodge','ranger'],['rogueguild','rogue'],['temple','cleric']]){
    const sim=fresh(),b=build(sim,type),v=adult(sim);assert.equal(sim.assign(b,v),true);assert.equal(classOf(v),cls);
    const loaded=new Sim(sim.serialize());assert.equal(loaded.vById.get(v.id).work,b.id);assert.equal(classOf(loaded.vById.get(v.id)),cls);
  }
});
test('sanctuary care heals a local patient, clamps health and records persistent sessions',()=>{
  const sim=fresh(),b=build(sim,'chapel'),v=adult(sim);sim.assign(b,v);const c=sim.bCenter(b);
  const p=sim.spawnVillager('meadow',c.x,c.z,{age:20}),away=sim.spawnVillager('meadow',c.x,c.z,{age:20});
  p.hp=maxHp(p)-1;away.hp=1;away.quest={};lesson(sim,v,b);
  assert.equal(p.hp,maxHp(p));assert.equal(away.hp,1);assert.equal(b.data.sessions,1);assert.equal(b.data.careUntil,sim.s.time+30);
  const loaded=new Sim(sim.serialize());assert.equal(loaded.bById.get(b.id).data.sessions,1);
  assert.match(townBuildingHtml({sim:loaded},loaded.bById.get(b.id)),/Completed sessions/);
});
test('training helps nearby adult adventurers and excludes children and unavailable pupils',()=>{
  const sim=fresh(),b=build(sim,'trainingyard'),v=adult(sim);sim.assign(b,v);const c=sim.bCenter(b);
  const p=sim.spawnVillager('meadow',c.x,c.z,{age:20}),child=sim.spawnVillager('meadow',c.x,c.z,{age:5}),away=sim.spawnVillager('meadow',c.x,c.z,{age:20});
  for(const o of [p,child,away]){o.cls='fighter';o.xp=0;}away.ko=10;v.xp=0;lesson(sim,v,b);
  assert.equal(v.xp,1.5);assert.equal(p.xp,.5);assert.equal(child.xp,0);assert.equal(away.xp,0);
});
test('removed workplaces and unavailable staff cannot complete lessons',()=>{
  for(const flag of ['jail','quest','ko','downed','removed']){
    const sim=fresh(),b=build(sim,'trainingyard'),v=adult(sim);sim.assign(b,v);v.xp=0;
    sim.taskClassPlace(v,b);const done=v.task.steps.find(s=>s.act).done;
    if(flag==='removed')sim.bById.delete(b.id);else v[flag]=flag==='jail'?sim.s.time+60:flag==='quest'?{}:10;
    done();assert.equal(v.xp,0);assert.equal(b.data.sessions||0,0);
  }
});
test('recent rogue practice reduces only local crime pressure and expires',()=>{
  const sim=fresh(),b=build(sim,'rogueguild'),v=adult(sim);sim.assign(b,v);
  const before=sim.crimePressure('meadow');lesson(sim,v,b);
  assert.equal(sim.crimePressure('meadow'),Math.max(0,before-4));assert.equal(sim.crimePressure('pine'),0);
  sim.s.time=b.data.careUntil;assert.equal(sim.crimePressure('meadow'),before);
});
test('class buildings use the existing neighbour synergy and work speed rules',()=>{
  for(const[type,neighbour,bonus]of [['chapel','park',.10],['trainingyard','guild',.15],['rangerlodge','forester',.15],['rogueguild','watchhouse',.10]]){
    const sim=fresh(),b=build(sim,type),v=adult(sim);sim.assign(b,v);const before=sim.workRate(v),other=build(sim,neighbour);
    sim.s.time+=1;assert.ok(sim.synergy(b).list.some(r=>r.from===neighbour),`${type} missing ${neighbour}`);assert.ok(Math.abs(sim.workRate(v)/before-(1+bonus))<1e-8);
    other.built=false;sim.s.time+=1;assert.equal(sim.workRate(v),before);
  }
});
test('job candidates are qualified idle local adults, ordered by fit',()=>{
  const sim=fresh(),b=build(sim,'chapel');
  for(const v of sim.s.villagers)v.tier=0;
  const make=()=>{const c=sim.bCenter(b),v=sim.spawnVillager('meadow',c.x,c.z,{age:20});v.tier=1;return v;};
  const weak=make(),strong=make();weak.abil.wis=weak.abil.cha=3;strong.abil.wis=strong.abil.cha=18;
  const jail=make(),ko=make(),quest=make(),child=make(),remote=make(),down=make(),busy=make();
  jail.jail=sim.s.time+50;ko.ko=10;quest.quest={};child.age=5;remote.home='pine';down.downed=true;busy.job='builder';
  assert.deepEqual(jobCandidates(sim,b).map(v=>v.id),[strong.id,weak.id]);
});
test('stale job selection fails safely, then a valid candidate fills the vacancy',()=>{
  const sim=fresh(),b=build(sim,'rangerlodge'),v=adult(sim),ui=uiFor(sim);ui.jobPicks={[b.id]:v.id};
  let warning='';ui.toast=t=>warning=t;v.quest={};boardClick(ui,'board-hire',{dataset:{bid:String(b.id)}});
  assert.equal(b.workers.length,0);assert.match(warning,/no longer available/);
  v.quest=null;boardClick(ui,'board-hire',{dataset:{bid:String(b.id)}});assert.deepEqual(b.workers,[v.id]);
});
test('region scope follows the camera and explicit all-region or settlement selections',()=>{
  const sim=fresh();sim.unlock('pine',true);const ui=uiFor(sim);
  assert.equal(currentRegion(ui),'meadow');ui.g.view.rig.tx=toWorld(CENTERS.pine.x);ui.g.view.rig.tz=toWorld(CENTERS.pine.z);
  assert.equal(currentRegion(ui),'pine');assert.equal(boardRegion(ui),'pine');ui.boardSid='all';assert.equal(boardRegion(ui),null);
  ui.boardSid='meadow';assert.equal(boardRegion(ui),'meadow');ui.boardSid='missing';assert.equal(boardRegion(ui),'pine');
});
test('boards expose upgrade costs, blockers, construction and regional vacancies',()=>{
  const sim=fresh(),b=build(sim,'chapel'),ui=uiFor(sim);stock(sim);
  let html=buildingsBoardHtml(ui);assert.match(html,/Upgrade to level 2/);assert.match(html,/Planks 20/);assert.match(html,/\+1 worker slot/);
  const before=regionSummary(sim,'meadow').upgrades;boardClick(ui,'board-upgrade',{dataset:{bid:String(b.id)}});
  assert.ok(b.up);assert.equal(regionSummary(sim,'meadow').upgrades,before-1);assert.match(buildingsBoardHtml(ui),/0% complete/);
  sim.s.res.coins=0;html=buildingsBoardHtml(ui);assert.match(html,/Not enough resources/);assert.match(html,/class="missing"/);
  assert.match(jobsBoardHtml(ui),/Requires Schooled education/);
  assert.match(worldRegionsHtml(ui,()=>''),/board-open-region/);
  assert.match(sim.upgradeEffect({type:'tradepost'}),/\+1 cart/);
  assert.match(sim.upgradeEffect({type:'university'}),/\+2 student places/);
  assert.match(sim.upgradeEffect({type:'townhall'}),/no additional gameplay bonus/);
});
test('all five exported models have valid binary mesh ranges and node hierarchy',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../models/models.json',import.meta.url))),bin=fs.readFileSync(new URL('../models/models.bin',import.meta.url));
  assert.equal(Object.keys(data.models).length,92);
  for(const type of ['chapel','temple','trainingyard','rangerlodge','rogueguild']){
    const nodes=data.models[type]?.nodes;assert.ok(nodes?.length>=2,type);assert.ok(nodes.some(n=>n.meshes?.length>=10));assert.deepEqual(footprint(type,0),footprint(type,1));
    for(let i=0;i<nodes.length;i++) {const n=nodes[i];assert.ok(n.parent<i);for(const m of n.meshes||[]){assert.ok(m.nv>0&&m.ni>0);assert.ok(m.pos>=0&&m.pos+m.nv*6<=bin.length);assert.ok(m.idx>=0&&m.idx+m.ni*2<=bin.length);}}
  }
});
