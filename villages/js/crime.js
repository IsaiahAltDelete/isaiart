// Crime: rare, visible and a little silly. Never hurts anyone.
//
// Once a night each settlement may have a bit of trouble. The chance grows with
// struggling homes and a glum village, and shrinks with guards, lanterns, a
// safe government and the Night watch policy; a happy, prosperous village is
// peaceful. The culprit pulls on a mask, sneaks to the store with a sack and
// heads home. Any guard or constable who comes within sight can catch them on
// the way: the loot goes back, and with a Watch House in the settlement they
// spend the next morning in the stocks out front (v.jail = until when).
import { stageOf, defOf, DAY } from './sim.js';

const SIGHT = 7;            // world units
const first = v => v.name.split(' ')[0];

export function installCrime(sim) {
  Object.assign(sim, CRIME);
  const s = sim.s;
  // saves from the pressure/custody version: release everyone, keep only a short log
  if (!s.crime?.v2) {
    for (const v of s.villagers) { v.jail = 0; v.jailHouse = null; v.sneak = null; }
    s.crime = { v2: 1, nights: {}, log: [], caught: 0, thefts: 0 };
  }
  const think = sim.think.bind(sim);
  sim.think = v => {
    if (v.jail > s.time) return sim.taskStocks(v);
    // a storm, or daybreak before they reached the store, calls it off
    if (v.sneak && !v.sneak.home && (sim.stormy() || !sim.isNight())) v.sneak = null;
    if (v.sneak) return sim.taskSneak(v);
    return think(v);
  };
  const assign = sim.assign.bind(sim);
  sim.assign = (b, v) => {
    if (v?.jail > s.time || v?.sneak || v?.quest || v?.ko > 0 || v?.downed) return false;
    // when the game picks, it skips anyone in the stocks, away or hurt
    if (!v) v = s.villagers.filter(o => o.job === 'idle' && stageOf(o) === 'adult' && !(o.jail > s.time) && !o.sneak && !o.quest && !(o.ko > 0) && !o.downed
        && sim.canDoJob(o, b.type === 'university' ? 'professor' : defOf(b.type).job))
      .sort((a, c) => (a.home !== b.sid) - (c.home !== b.sid) || sim.jobFit(c, defOf(b.type).job) - sim.jobFit(a, defOf(b.type).job) || a.id - c.id)[0];
    return v ? assign(b, v) : false;
  };
  // constables keep the night watch, like guards on the towers
  const sleepy = sim.sleepy.bind(sim);
  sim.sleepy = v => (v.job === 'constable' && sim.isNight() ? false : sleepy(v));
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    for (const v of s.villagers) if (v.jail && (v.jail <= s.time || !sim.bById.has(v.jailHouse))) {
      v.jail = 0; v.jailHouse = null; sim.dropTask(v);
    }
    // a roll for each settlement, once each night
    if (sim.isNight() && !sim.stormy()) {
      const night = sim.dayFrac() < 0.5 ? sim.dayNum() - 1 : sim.dayNum();
      for (const sid of Object.keys(s.unlocked)) {
        if (s.crime.nights[sid] === night) continue;
        s.crime.nights[sid] = night;
        if (sim.rng() < sim.crimeChance(sid)) sim.startCrime(sid);
      }
    }
    for (const v of s.villagers) if (v.sneak) sim.watchFor(v);
  };
}

const CRIME = {
  // how likely trouble is tonight in a settlement (0..0.4)
  crimeChance(sid) {
    const s = this.s, homes = this.lodgings().filter(b => b.sid === sid && !b.prosEmpty);
    const struggling = homes.length ? homes.filter(b => (b.pros || 0) === 0).length / homes.length : 0;
    const watchers = s.villagers.filter(v => v.home === sid && ['guard', 'constable'].includes(v.job)).length;
    const lights = s.buildings.filter(b => b.built && b.sid === sid && ['torch', 'lantern'].includes(b.type)).length;
    const p = 0.03 + struggling * 0.3 + Math.max(0, 55 - s.happiness) * 0.006
      - watchers * 0.02 - Math.min(0.06, lights * 0.01) - this.govEffects().safety * 0.02 - (this.policyOn('nightWatch') ? 0.06 : 0);
    return Math.max(0, Math.min(0.4, p));
  },
  // a word for the Town panel
  safetyOf(sid) { const p = this.crimeChance(sid); return p < 0.04 ? 'Peaceful' : p < 0.12 ? 'Mostly quiet' : 'Troubled'; },
  startCrime(sid) {
    const s = this.s;
    const store = s.buildings.filter(b => b.built && b.sid === sid && ['storehouse', 'campfire', 'market'].includes(b.type))[0];
    if (!store) return null;
    const ok = v => v.home === sid && stageOf(v) === 'adult' && !['guard', 'constable'].includes(v.job) && s.gov?.leader !== v.id
      && !v.quest && !(v.ko > 0) && !v.downed && !(v.jail > s.time);
    const pool = s.villagers.filter(ok), poor = pool.filter(v => (this.homeOf(v)?.pros ?? 0) === 0 || v.job === 'idle');
    const list = poor.length ? poor : pool;
    if (!list.length) return null;
    const v = list[Math.floor(this.rng() * list.length)];
    this.dropTask(v); v.asleep = false; v.indoors = false;
    v.sneak = { store: store.id, loot: null };
    return v;
  },
  taskSneak(v) {
    const st = this.bById.get(v.sneak.store);
    if (!st) { v.sneak = null; return this.taskSleep(v); }
    const home = this.bedFor(v).b || st, c = this.bCenter(st);
    const goHome = [{ walk: this.goalBuilding(home) }, { act: 0.2, done: () => this.escaped(v) }];
    if (v.sneak.home) return this.setTask(v, 'Sneaking home', goHome);   // interrupted on the way back
    this.setTask(v, 'Sneaking about', [
      { walk: this.goalBuilding(st) }, { face: [c.x, c.z] },
      { act: 3, anim: 'work', done: () => {
        if (!v.sneak) return;
        const coins = Math.min(Math.floor(this.s.res.coins), 10 + Math.floor(this.s.villagers.length / 3));
        if (coins > 0) { this.s.res.coins -= coins; this.track('coins', -coins); this.emit('res'); }
        v.sneak.loot = coins; v.sneak.home = true;
      } },
      ...goHome,
    ]);
  },
  // guards and constables nearby spot a sneaking villager
  watchFor(v) {
    if (!v.sneak?.home) return;
    const s = this.s;
    const seen = s.villagers.find(o => o !== v && ['guard', 'constable'].includes(o.job) && !o.asleep && !(o.ko > 0) && !o.quest
      && Math.hypot(o.x - v.x, o.z - v.z) < SIGHT * (this.policyOn('nightWatch') ? 1.6 : 1));
    if (seen && this.rng() < 0.35) this.caught(v, seen);
  },
  caught(v, by) {
    const s = this.s, loot = v.sneak?.loot || 0;
    if (loot) { s.res.coins += loot; this.track('coins', loot); this.emit('res'); }
    v.sneak = null; this.dropTask(v);
    const house = s.buildings.find(b => b.type === 'watchhouse' && b.built && b.sid === v.home);
    const morning = (Math.floor(s.time / DAY) + (this.dayFrac() > 0.5 ? 1 : 0)) * DAY + DAY * 0.42;
    if (house) { v.jail = Math.max(s.time + 30, morning); v.jailHouse = house.id; }
    s.crime.caught++;
    const msg = `${by.name} caught ${v.name} sneaking off with ${loot} coins.${house ? ' A morning in the stocks!' : ' The coins went back.'}`;
    this.crimeLog(msg); this.log(msg);
    this.emit('toast', `Caught! ${first(by)} nabbed ${first(v)}${house ? ' — off to the stocks' : ''}`, 'shield');
    this.emit('float', v.x, v.z, 'Caught!', 'shield');
  },
  escaped(v) {
    const loot = v.sneak?.loot || 0;
    v.sneak = null;
    if (!loot) return;
    this.s.crime.thefts++;
    const msg = `Someone made off with ${loot} coins in the night.`;
    this.crimeLog(msg); this.log(msg);
    this.emit('toast', `${loot} coins went missing overnight!`, 'coin');
  },
  crimeLog(msg) { const L = this.s.crime.log; L.unshift({ msg, t: this.s.time }); if (L.length > 8) L.pop(); },
  // the stocks in front of the Watch House
  taskStocks(v) {
    const b = this.bById.get(v.jailHouse);
    if (!b) { v.jail = 0; return this.taskSleep(v); }
    const p = this.local(b, 0.45, 0.5), out = this.local(b, 0.45, 4);   // head through the stocks' boards (watchhouse model)
    this.setTask(v, 'In the stocks', [
      { walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [out.x, out.z] },
      { act: 9999, anim: 'rest', until: () => !(v.jail > this.s.time), start: () => { v.act.idle = true; } },
    ]);
  },
  // constables walk between the village's public places, with a lantern after dark
  taskConstable(v, b) {
    const stops = this.s.buildings.filter(o => o.built && o.sid === b.sid
      && ['campfire', 'market', 'storehouse', 'park', 'pub', 'bathhouse', 'theatre', 'townhall'].includes(o.type));
    v.patrolStep = (v.patrolStep || 0) + 1;
    const stop = stops.length ? stops[(v.id + v.patrolStep) % stops.length] : b;
    const c = this.bCenter(stop);
    this.setTask(v, this.isNight() ? 'On night patrol' : 'Keeping the peace', [
      { walk: this.goalBuilding(stop) }, { face: [c.x, c.z] },
      { act: 6, anim: 'rest', done: () => { if (this.bById.has(b.id) && v.work === b.id) this.repeat(v); } },
    ]);
  },
};
