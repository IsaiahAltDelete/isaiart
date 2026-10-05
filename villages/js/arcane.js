// Tower specializations share normal staffing, education, local stock and cooldown rules.
import {SPELLS} from './data.js';
import {casterNeeds,studyCost} from './rpg.js';
import {careerReady} from './careers.js';
export const TOWER_MODES={
 research:{name:'Research',icon:'book',color:0xa87ada,desc:'Study spell lore and wizard levels. A focused ritual adds research toward the next eligible spell.'},
 ward:{name:'Warding',icon:'shield',color:0x76b9e9,desc:'Maintain local wards. Recent work lowers this region’s crime pressure by 8. Costs 1 local stone per session.'},
 nature:{name:'Nature',icon:'leaf',color:0x76b95c,desc:'Walk out to tend growing fields within 10 tiles. Each session advances up to three fields by 10%, using 1 local food.'},
 artifice:{name:'Artifice',icon:'hammer',color:0xe6ad51,desc:'Turn 2 local wood into 1 plank, or 2 stone into 1 brick. Choose the recipe below; production respects local storage.'},
};
export const towerMode=b=>TOWER_MODES[b.data?.discipline]?b.data.discipline:'research';
export function installArcane(sim){
  const name=sim.homeName.bind(sim);sim.homeName=(b,...args)=>b.type==='wizard'?`${TOWER_MODES[towerMode(b)].name} Tower`:name(b,...args);
  sim.setTowerMode=(b,mode)=>{if(b?.type!=='wizard'||!b.built||!TOWER_MODES[mode])return false;(b.data||={}).discipline=mode;for(const id of b.workers){const v=sim.vById.get(id);if(v)sim.dropTask(v);}b.status=null;sim.emit('building',b);return true;};
  sim.towerFields=b=>{const c=sim.bCenter(b);return sim.s.buildings.filter(o=>o.type==='farm'&&o.sid===b.sid&&o.built&&o.data.stage==='growing'&&Math.hypot(sim.bCenter(o).x-c.x,sim.bCenter(o).z-c.z)<=10);};
  sim.towerCost=b=>towerMode(b)==='ward'?{stone:1}:towerMode(b)==='nature'?{food:1}:towerMode(b)==='artifice'?{[b.data.recipe==='bricks'?'stone':'wood']:2}:{};
  sim.towerWorkCheck=b=>{
    if(!b||!sim.bById.has(b.id)||!b.built||b.up)return {ok:false,why:'Tower is unavailable or upgrading'};
    const mode=towerMode(b),cost=sim.towerCost(b);
    if(mode==='nature'&&!sim.towerFields(b).length)return {ok:false,why:'No nearby growing fields'};
    if(mode==='artifice'&&sim.trade.room(b.sid,b.data.recipe==='bricks'?'bricks':'planks')<1)return {ok:false,why:'Local output storage is full'};
    for(const[k,n]of Object.entries(cost))if(sim.trade.get(b.sid,k)<n)return {ok:false,why:`Needs ${n} local ${k}`};
    return {ok:true};
  };
  sim.towerEffect=(b,v,focused=false)=>{
    const chk=sim.towerWorkCheck(b);if(!chk.ok){b.status=chk.why;return false;}
    if(!v||v.work!==b.id||!careerReady(sim,v)||v.asleep)return false;
    for(const[k,n]of Object.entries(sim.towerCost(b)))if(!sim.trade.consume(b.sid,k,n))return false;
    const mode=towerMode(b),d=b.data;
    if(mode==='ward')d.wardUntil=sim.s.time+(focused?90:45);
    if(mode==='nature')for(const o of sim.towerFields(b).slice(0,3)){o.data.grow=Math.min(1,o.data.grow+(focused?.25:.10));if(o.data.grow>=1)o.data.stage='ripe';sim.emit('farm',o);}
    if(mode==='artifice')sim.trade.deposit(b.sid,d.recipe==='bricks'?'bricks':'planks',1);
    if(mode==='research'){
      const m=sim.s.magic,next=SPELLS.find(sp=>!m.known.includes(sp.id)&&sim.casterLevel()>=casterNeeds(sp));
      if(next){m.study+=8;if(m.study>=studyCost(next)){m.study-=studyCost(next);m.known.push(next.id);sim.log(`Focused research discovered ${next.name}.`);}}
      sim.rpg().know+=1;
    }
    sim.rpgGainXp(v,focused?3:2);d.sessions=(d.sessions||0)+1;b.status=null;return true;
  };
  sim.towerRitualCheck=b=>{
    if(!b||b.type!=='wizard'||!b.built)return {ok:false,why:'Complete the tower first'};
    if(b.data.ritualUntil>sim.s.time)return {ok:false,why:`Ready in ${Math.ceil(b.data.ritualUntil-sim.s.time)} seconds`};
    if(!b.workers.some(id=>{const v=sim.vById.get(id);return v&&v.work===b.id&&careerReady(sim,v)&&!v.asleep;}))return {ok:false,why:'Needs an available awake wizard'};
    if(sim.s.res.coins<10)return {ok:false,why:'Needs 10 treasury coins'};
    return sim.towerWorkCheck(b);
  };
  sim.performTowerRitual=b=>{if(!sim.towerRitualCheck(b).ok)return false;const v=b.workers.map(id=>sim.vById.get(id)).find(v=>v&&careerReady(sim,v)&&!v.asleep);if(!sim.towerEffect(b,v,true))return false;sim.s.res.coins-=10;sim.track('coins',-10);b.data.ritualUntil=sim.s.time+90;sim.emit('res');sim.emit('building',b);return true;};
  const study=sim.taskStudy.bind(sim);
  sim.taskStudy=(v,b)=>{
    const mode=towerMode(b);if(mode==='research'){study(v,b);const act=v.task.steps.find(s=>s.act),done=act.done;act.done=()=>{if(!sim.bById.has(b.id)||b.up||v.work!==b.id||!careerReady(sim,v)||v.asleep||towerMode(b)!==mode)return;done();b.data.sessions=(b.data.sessions||0)+1;};return;}
    const c=sim.bCenter(b),field=mode==='nature'&&sim.towerFields(b)[0],target=field||b,p=field?sim.spot(field,0):sim.spot(b,v.id%3);
    sim.setTask(v,`${TOWER_MODES[mode].name} practice`,[{walk:sim.goalBuilding(target)},{to:[p.x,p.z]},{face:[c.x,c.z]},{act:16,anim:'cast',done:()=>{
      if(!sim.bById.has(b.id)||v.work!==b.id||!careerReady(sim,v)||towerMode(b)!==mode)return;
      sim.towerEffect(b,v);sim.repeat(v);
    }}]);
  };
  const pressure=sim.crimePressure.bind(sim);sim.crimePressure=sid=>Math.max(0,pressure(sid)-(sim.s.buildings.some(b=>b.type==='wizard'&&b.sid===sid&&b.built&&towerMode(b)==='ward'&&b.data.wardUntil>sim.s.time)?8:0));
}
