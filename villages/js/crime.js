// Cozy petty crime, patrols and timed custody. Never kills a villager.
import { stageOf, defOf } from './sim.js';
import { mod } from './rpg.js';

export function installCrime(sim) {
  Object.assign(sim, CRIME);
  const s = sim.s;
  s.crime ||= { pressure: {}, incidents: [], nextId: 1, fear: 0, caught: 0 };
  s.crime.pressure ||= {}; s.crime.incidents ||= []; s.crime.nextId ||= 1;
  const think = sim.think.bind(sim);
  sim.think = v => {
    if (v.jail > s.time) return sim.taskJail(v);
    return think(v);
  };
  const assign = sim.assign.bind(sim);
  sim.assign = (b, v) => {
    if (v?.jail > s.time || v?.quest || v?.ko > 0 || v?.downed) return false;
    if (!v) v = s.villagers.filter(o => o.job === 'idle' && stageOf(o) === 'adult' && !(o.jail > s.time) && !o.quest && !(o.ko > 0) && !o.downed && sim.canDoJob(o, b.type === 'university' ? 'professor' : defOf(b.type).job))
      .sort((a, c) => (a.home !== b.sid) - (c.home !== b.sid) || sim.jobFit(c, defOf(b.type).job) - sim.jobFit(a, defOf(b.type).job) || a.id - c.id)[0];
    // Passing no candidate down would let the base picker choose a prisoner.
    if (!v) return false;
    return assign(b, v);
  };
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    for (const v of s.villagers) if (v.jail && (v.jail <= s.time || !sim.bById.has(v.jailHouse))) {
      v.jail = 0; v.jailHouse = null; sim.dropTask(v); sim.log(`${v.name} finished their sentence.`);
    }
    s.crime.fear = Math.max(0, (s.crime.fear || 0) - 0.025);
    s.happiness = Math.max(0, s.happiness - s.crime.fear * 0.05);
    if ((sim.crimeT = (sim.crimeT || 0) + 1) % 20 === 0) {
      for (const sid of Object.keys(s.unlocked)) {
        const pressure = s.crime.pressure[sid] = sim.crimePressure(sid);
        if (sim.rng() < pressure / 100 * 0.12) sim.rollCrime(sid);
      }
    }
  };
}

const CRIME = {
  crimePressure(sid) {
    const s = this.s, adults = s.villagers.filter(v => v.home === sid && stageOf(v) !== 'child');
    if (!adults.length) return 0;
    const poor = adults.filter(v => (v.purse || 0) < 4).length / adults.length;
    const idle = adults.filter(v => v.job === 'idle').length / adults.length;
    const guards = adults.filter(v => ['guard', 'constable'].includes(v.job) && !v.quest && !(v.jail > s.time) && !(v.ko > 0)).length;
    const lights = s.buildings.filter(b => b.built && b.sid === sid && ['torch', 'lantern'].includes(b.type)).length;
    return Math.round(Math.max(0, Math.min(100, 8 + poor * 32 + idle * 20 + Math.max(0, 65 - s.happiness) * 0.7
      - guards * 8 - Math.min(15, lights * 3) - this.govEffects().security
      - (this.policyOn('nightWatch') ? 12 : 0) - (this.policyOn('curfew') ? 10 : 0) - (s.gov.justice === 'strict' ? 8 : 0))));
  },
  rollCrime(sid) {
    const s = this.s, f = this.dayFrac();
    const pubs = s.buildings.some(b => b.type === 'pub' && b.built && b.sid === sid && this.venueOpen(b));
    if (!this.isNight() && !(pubs && f >= 0.72 && f < 0.9)) return null;
    const folk = s.villagers.filter(v => v.home === sid && stageOf(v) === 'adult' && !v.quest && !(v.jail > s.time) && !(v.ko > 0) && !v.downed);
    const pool = folk.filter(v => !['guard', 'constable'].includes(v.job) && ((v.purse || 0) < 4 || v.job === 'idle'));
    if (!pool.length) return null;
    const culprit = pool[Math.floor(this.rng() * pool.length)], victims = folk.filter(v => v !== culprit && (v.purse || 0) > 1);
    const kind = !this.isNight() ? 'Pub brawl' : victims.length && this.rng() < 0.5 ? 'Pickpocketing' : 'Night theft';
    let victim = null, coins = 0, good = null, amount = 0;
    if (kind === 'Pickpocketing') {
      victim = victims[Math.floor(this.rng() * victims.length)]; coins = Math.min(3, victim.purse);
      victim.purse -= coins; culprit.purse += coins;
    } else if (kind === 'Night theft') {
      good = this.trade.get(sid, 'food') >= 2 ? 'food' : 'wood'; amount = 2;
      if (!this.trade.consume(sid, good, amount)) return null;
    }
    return this.recordCrime(sid, kind, culprit, { victim: victim?.id, coins, good, amount });
  },
  recordCrime(sid, kind, culprit, details = {}) {
    if (!culprit || culprit.quest || culprit.jail > this.s.time) return null;
    const c = this.s.crime, event = { id: c.nextId++, sid, kind, culprit: culprit.id, time: this.s.time, solved: false, ...details };
    c.incidents.unshift(event); if (c.incidents.length > 30) c.incidents.pop();
    this.s.happiness = Math.max(0, this.s.happiness - 1);
    this.log(`${kind} was reported in ${this.sname(sid)}. Constables are investigating.`);
    return event;
  },
  taskConstable(v, b) {
    const stops = this.s.buildings.filter(o => o.built && o.sid === b.sid
      && ['campfire', 'market', 'park', 'pub', 'bathhouse', 'theatre', 'townhall'].includes(o.type));
    v.patrolStep = (v.patrolStep || 0) + 1;
    const stop = stops.length ? stops[(v.id + v.patrolStep) % stops.length] : b;
    const c = this.bCenter(stop);
    this.setTask(v, 'Patrolling the village', [
      { walk: this.goalBuilding(stop) }, { face: [c.x, c.z] },
      { act: 8, anim: 'sell', done: () => {
        if (!this.bById.has(b.id) || v.work !== b.id) return;
        const e = this.s.crime.incidents.find(e => !e.solved && e.sid === b.sid && this.s.time - e.time < 120 && this.vById.has(e.culprit));
        if (e && this.rng() < Math.min(0.9, 0.3 + Math.max(0, mod(v.abil?.wis)) * 0.06 + (this.policyOn('nightWatch') ? 0.2 : 0))) this.catchCulprit(e, v, b);
        this.repeat(v);
      } },
    ]);
  },
  catchCulprit(e, constable, house) {
    const v = this.vById.get(e.culprit);
    if (!v || v.quest || !house?.built || house.type !== 'watchhouse' || constable.work !== house.id || e.solved || v.jail > this.s.time) return false;
    const strict = this.s.gov.justice === 'strict';
    e.solved = true; e.by = constable.id;
    v.jail = this.s.time + (strict ? 90 : 40); v.jailHouse = house.id; this.dropTask(v);
    const recovered = Math.min(e.coins || 0, v.purse || 0), victim = this.vById.get(e.victim);
    v.purse -= recovered; if (victim) victim.purse = (victim.purse || 0) + recovered;
    else { this.s.res.coins += recovered; this.track('coins', recovered); }
    this.s.crime.caught++; this.s.crime.fear = Math.min(12, this.s.crime.fear + (strict ? 4 : 0.5));
    this.log(`${constable.name} caught ${v.name} after ${e.kind.toLowerCase()}. ${strict ? 'A firm' : 'A short'} sentence at the Watch House.`);
    this.emit('toast', `${v.name.split(' ')[0]} is in custody for ${strict ? 90 : 40} seconds.`, 'shield');
    return true;
  },
  taskJail(v) {
    const b = this.bById.get(v.jailHouse);
    if (!b) { v.jail = 0; return this.taskSleep(v); }
    this.setTask(v, 'In custody at the Watch House', [
      { walk: this.goalBuilding(b) },
      { act: 9999, anim: 'rest', until: () => v.jail <= this.s.time, start: () => { v.indoors = true; v.act.idle = true; }, done: () => { v.indoors = false; } },
    ]);
  },
};
