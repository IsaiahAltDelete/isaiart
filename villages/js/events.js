// Hard times. Droughts, crop blight, fever, earthquakes, raiders, restless spirits,
// offended fair folk, fires and the odd dragon. Nobody dies: every event shows up in
// the village, has something the player can do about it, and passes on its own.
//
//  - One roll a day at dawn (from day 4 and village level 3). At most one event at a
//    time, besides fires. Settings → Hard times: Off / Gentle / Normal.
//  - Fires: lightning in a storm, or the dragon. Nearby villagers form a bucket chain
//    (faster with a well close by, and in the rain). A building that burns down is
//    damaged: it stops working until it is repaired from its panel.
// Sim-side logic is installed by installEvents(sim); eventsInit/eventsFrame/eventsBar
// at the bottom draw the banner, and main.js draws the flames, wisps and the dragon.
import { stageOf, lvlOf, defOf, isDecor, DAY } from './sim.js';
import { CENTERS, toWorld, inMap, idx } from './world.js';
import { svg, addIcons } from './icons.js';

addIcons({
  fire: '<path d="M16 3c2 5 8 8 8 15a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 5 3 5-1-5 0-9 1-12z" fill="#ff8a1e" stroke="#9a3a12" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 15c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 1 1 2 2 2 0-2 0-4 0-6z" fill="#ffd34a"/>',
  dragon: '<path d="M4 20c5-1 7-5 9-9 2 3 5 4 8 3l7-7-2 9c2 1 3 3 2 5-4-1-7 0-9 2-3-2-8-2-15-3z" fill="#c0392b" stroke="#5b1a12" stroke-width="1.6" stroke-linejoin="round"/><circle cx="22" cy="12" r="1.3" fill="#ffd34a"/>',
  ghost: '<path d="M8 28V14a8 8 0 0 1 16 0v14l-3-2-2 2-3-2-3 2-2-2z" fill="#dfeaff" stroke="#5a6a9a" stroke-width="1.6" stroke-linejoin="round"/><circle cx="13" cy="14" r="1.6" fill="#3a4a7a"/><circle cx="19" cy="14" r="1.6" fill="#3a4a7a"/>',
  quake: '<path d="M3 20h5l3-8 4 14 4-18 3 12h7" fill="none" stroke="#9a5a2b" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  sick: '<circle cx="16" cy="16" r="12" fill="#cfeec0" stroke="#4f8a3a" stroke-width="1.6"/><path d="M11 13h.01M21 13h.01" stroke="#2a4a1a" stroke-width="2.6" stroke-linecap="round"/><path d="M11 21c3-2 7-2 10 0" fill="none" stroke="#2a4a1a" stroke-width="1.8" stroke-linecap="round"/>',
});

const ALL = [0, 1, 2, 3];
export const EVENTS = {
  drought: { name: 'Drought', icon: 'sun', lvl: 3, seasons: [0, 1], days: 2, w: 3,
    help: 'Crops and berries grow slowly. Rain ends it early; wizards in Nature mode keep nearby fields growing.' },
  blight: { name: 'Crop blight', icon: 'leaf', lvl: 4, seasons: [1, 2], days: 1, w: 2,
    help: 'Some fields withered: replant them. Orchards bear half until it passes.' },
  fever: { name: 'Fever', icon: 'sick', lvl: 3, seasons: ALL, days: 1.5, w: 2,
    help: 'Sick villagers work slowly. Clerics at a Chapel or Temple cure them, and so does a warm bath.' },
  quake: { name: 'Earthquake', icon: 'quake', lvl: 5, seasons: ALL, days: 0.1, w: 1,
    help: 'The ground shook and a building was damaged. Repair it from its panel.' },
  raiders: { name: 'Raiders', icon: 'shield', lvl: 5, seasons: ALL, days: 1, w: 2,
    help: 'Scouts saw a goblin war band: it strikes tonight. Watchtowers, guards and palisades hold it off.' },
  spirits: { name: 'Restless spirits', icon: 'ghost', lvl: 4, seasons: [2, 3], days: 2, w: 2,
    help: 'Wisps drift through the village after dark and everyone is uneasy. Clerics can lay them to rest.' },
  fae: { name: 'The fair folk are offended', icon: 'blossom', lvl: 3, seasons: [0, 1], days: 1, w: 1.5, offering: 5,
    help: 'Tools keep going missing, so work is slower. Leave an offering of honey or cheese to make amends.' },
  dragon: { name: 'Dragon attack', icon: 'dragon', lvl: 8, seasons: ALL, days: 0.35, w: 1,
    help: 'A dragon is circling! Guards and wizards fight back. Put out the fires it starts.' },
};
const MODES = { off: 0, gentle: 0.18, normal: 0.35 };
const roll2d8 = r => 2 + ((r() * 8) | 0) + ((r() * 8) | 0);
const first = v => v.name.split(' ')[0];
const FIGHTERS = 6;

export function installEvents(sim) {
  const s = sim.s;
  // a village that has never had hard times gets today off: the first roll is tomorrow's dawn
  const E = s.events || (s.events = { list: [], rolled: sim.dayNum(), last: {}, mode: 'normal', nextId: 1 });
  E.list ||= []; E.last ||= {}; E.mode ||= 'normal'; E.nextId ||= 1;
  Object.assign(sim, EV);

  // drought and blight change how the season treats crops, berries and orchards
  const season = sim.season.bind(sim);
  sim.season = () => {
    const se = season();
    if (!E.list.length && !(E.blessUntil > s.time)) return se;
    const o = { ...se };
    if (sim.eventOn('drought')) { o.crops *= 0.35; o.berries *= 0.4; }
    if (sim.eventOn('blight')) o.orchard *= 0.5;
    if (E.blessUntil > s.time) o.crops *= 1.3;
    return o;
  };
  // fever, the fair folk, and damaged buildings slow work
  const workRate = sim.workRate.bind(sim);
  sim.workRate = (v, b) => {
    let k = workRate(v, b);
    if (v.sick > s.time) k *= 0.55;
    if (sim.eventOn('fae', v.home)) k *= 0.85;
    return k;
  };
  const think = sim.think.bind(sim);
  sim.think = v => {
    if (v.fireB != null) {
      const b = sim.bById.get(v.fireB);
      if (b?.fire && stageOf(v) !== 'child' && !v.quest && !(v.jail > s.time)) return sim.taskFire(v, b);
      v.fireB = null;
    }
    const w = v.work != null ? sim.bById.get(v.work) : null;
    if (w?.damaged && !w.up && !v.carry) return sim.setTask(v, 'Waiting for repairs', [{ act: 5, anim: 'rest' }]);
    return think(v);
  };
  // a damaged building is repaired before it can be upgraded
  const canUpgrade = sim.canUpgrade.bind(sim);
  sim.canUpgrade = b => b.damaged ? { ok: false, why: 'Repair it first' } : canUpgrade(b);
  const finishUpgrade = sim.finishUpgrade.bind(sim);
  sim.finishUpgrade = b => {
    if (!b.up?.repair) return finishUpgrade(b);
    b.up = null; b.damaged = false;
    sim.emit('building', b); sim.emit('upgraded', b); sim.emit('sfx', 'done');
    sim.story('repair', `The ${defOf(b.type).name} is repaired and back in business.`, [], 'hammer');
    if (defOf(b.type).workers) sim.assign(b, null);
  };
  // clerics cure the sick and calm restless spirits; a warm bath cures a fever
  const classPlace = sim.taskClassPlace;
  if (classPlace) sim.taskClassPlace = (v, b) => {
    classPlace(v, b);
    const act = v.task?.steps.find(st => st.act); if (!act || !['chapel', 'temple'].includes(b.type)) return;
    const done = act.done;
    act.done = () => { done?.(); if (sim.bById.has(b.id) && v.work === b.id) sim.clericRound(v, b); };
  };
  const outing = sim.taskOuting?.bind(sim);
  if (outing) sim.taskOuting = (v, b) => {
    outing(v, b);
    const act = v.task?.steps.find(st => st.act); if (!act || b.type !== 'bathhouse') return;
    const done = act.done;
    act.done = () => { done?.(); if (v.sick > s.time) { v.sick = 0; sim.emit('float', v.x, v.z, 'Better!', 'heart'); } };
  };
  const second = sim.second.bind(sim);
  sim.second = () => { second(); sim.eventsSecond(); };
}

const EV = {
  eventOn(type, sid = null) { return this.s.events.list.some(e => e.type === type && (!sid || !e.sid || e.sid === sid)); },
  activeEvents() { return this.s.events.list; },
  // ── the daily roll ──
  rollEvent() {
    const s = this.s, E = s.events, day = this.dayNum();
    if (day < 4 || s.level < 3 || E.list.length || this.rng() > (MODES[E.mode] ?? 0.35)) return null;
    const si = this.seasonIdx();
    const pool = Object.entries(EVENTS).filter(([k, d]) => s.level >= d.lvl && d.seasons.includes(si) && !(E.last[k] > day - (k === 'dragon' ? 8 : 3)));
    if (!pool.length) return null;
    let t = this.rng() * pool.reduce((a, [, d]) => a + d.w, 0), pick = pool[0][0];
    for (const [k, d] of pool) { t -= d.w; if (t <= 0) { pick = k; break; } }
    const sids = Object.keys(s.unlocked);
    return this.startEvent(pick, sids[(this.rng() * sids.length) | 0]);
  },
  startEvent(type, sid = 'meadow') {
    const s = this.s, E = s.events, d = EVENTS[type]; if (!d) return null;
    const e = { id: E.nextId++, type, sid, start: s.time, until: s.time + d.days * DAY, data: {} };
    E.last[type] = this.dayNum();
    const where = this.sname(sid);
    let msg = `${d.name} in ${where}!`;
    if (type === 'blight') {
      const farms = s.buildings.filter(b => b.type === 'farm' && b.built && b.sid === sid && b.data?.stage !== 'empty').slice(0, 2);
      for (const f of farms) { f.data.stage = 'empty'; f.data.grow = 0; this.emit('farm', f); }
      msg = `Blight! ${farms.length ? `${farms.length} field${farms.length > 1 ? 's' : ''} in ${where} withered.` : `Orchards in ${where} are sickly.`}`;
    }
    if (type === 'fever') {
      const folk = s.villagers.filter(v => v.home === sid && !v.quest);
      const n = Math.max(2, Math.round(folk.length * 0.25));
      for (const v of [...folk].sort(() => this.rng() - 0.5).slice(0, n)) v.sick = e.until;
      msg = `A fever is going around ${where}: ${n} villagers are sick.`;
    }
    if (type === 'quake') {
      const hit = s.buildings.filter(b => b.built && b.sid === sid && !isDecor(b.type) && b.type !== 'campfire' && !b.damaged).sort(() => this.rng() - 0.5).slice(0, 1 + (this.rng() < 0.4 ? 1 : 0));
      for (const b of hit) this.damage(b);
      this.emit('quake');
      msg = `An earthquake shook ${where}!${hit.length ? ` The ${hit.map(b => defOf(b.type).name).join(' and ')} ${hit.length > 1 ? 'need' : 'needs'} repairs.` : ''}`;
    }
    if (type === 'raiders') msg = `Scouts saw a goblin war band near ${where}. They will strike tonight!`;
    if (type === 'spirits') { e.data.haunt = 1; msg = `Restless spirits haunt ${where}. Something stirs after dark…`; }
    if (type === 'fae') msg = `The fair folk are offended! Tools keep vanishing in ${where}.`;
    if (type === 'drought') msg = `A drought has settled over ${where}. The fields are parched.`;
    if (type === 'dragon') {
      e.until = s.time + 80;
      e.data = { hp: 100 + s.level * 10, max: 100 + s.level * 10, next: 6, loot: 0, swoop: null };
      msg = `A dragon is circling ${where}! Guards to the towers!`;
      this.emit('sfx', 'howl');
    }
    s.events.list.push(e);
    this.log(msg); this.story('hard', msg, [], d.icon);
    this.emit('toast', msg, d.icon);
    this.emit('event', e, true);
    return e;
  },
  endEvent(e, msg) {
    const s = this.s;
    s.events.list = s.events.list.filter(o => o !== e);
    if (e.type === 'fever') for (const v of s.villagers) if (v.sick && v.home === e.sid) v.sick = 0;
    if (msg) { this.log(msg); this.story('hard', msg, [], EVENTS[e.type].icon); }
    this.emit('event', e, false);
  },
  eventLeft(e) { return Math.max(0, e.until - this.s.time); },

  // ── damage and repairs ──
  damage(b) {
    if (!b || b.damaged || !b.built || isDecor(b.type) || b.type === 'campfire') return false;
    b.damaged = true; if (b.up && !b.up.repair) b.up = null;
    for (const id of b.workers) { const v = this.vById.get(id); if (v) this.dropTask(v); }
    this.emit('building', b); this.emit('damaged', b);
    return true;
  },
  repairCost(b) {
    const out = {};
    for (const [k, n] of Object.entries(defOf(b.type).cost || {})) if (k !== 'gems') out[k] = Math.max(1, Math.ceil(n * 0.4));
    if (!Object.keys(out).length) out.wood = 10;
    return out;
  },
  repair(b) {
    if (!b?.damaged || b.up || !this.canAfford(this.repairCost(b))) return false;
    this.pay(this.repairCost(b));
    b.up = { progress: 0, repair: true };
    this.emit('building', b); this.emit('sfx', 'place');
    return true;
  },

  // ── fire ──
  ignite(b, why = 'Lightning') {
    if (!b?.built || b.fire || b.damaged || isDecor(b.type) || b.type === 'campfire') return false;
    b.fire = { heat: 0.3, t: 0 };
    const msg = `${why} set the ${defOf(b.type).name} in ${this.sname(b.sid)} on fire!`;
    this.log(msg); this.story('hard', msg, [], 'fire');
    this.emit('toast', `Fire! The ${defOf(b.type).name} is burning — villagers are grabbing buckets!`, 'fire');
    this.emit('fire', b);
    return true;
  },
  taskFire(v, b) {
    const c = this.bCenter(b), a = (v.id * 2.399) % (Math.PI * 2), r = Math.max(c.w || 2, c.d || 2) / 2 + 0.7;
    this.setTask(v, 'Fighting the fire', [
      { walk: this.goalBuilding(b) }, { to: [c.x + Math.cos(a) * r, c.z + Math.sin(a) * r] }, { face: [c.x, c.z] },
      { act: 3, anim: 'work', done: () => { if (b.fire) this.repeat(v); else v.fireB = null; } },
    ]);
  },
  fireSecond() {
    const s = this.s, wet = s.weather?.rain ? 1.4 : 1;
    for (const b of s.buildings) {
      if (!b.fire) continue;
      if (!this.bById.has(b.id)) continue;
      const c = this.bCenter(b);
      // a bucket chain: the nearest grown-ups drop what they're doing
      const crew = s.villagers.filter(v => v.fireB === b.id);
      if (crew.length < FIGHTERS) {
        const free = s.villagers.filter(v => v.fireB == null && v.home === b.sid && stageOf(v) !== 'child' && !v.quest && !(v.jail > s.time) && !(v.ko > 0) && !v.sneak)
          .sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z)).slice(0, FIGHTERS - crew.length);
        for (const v of free) { v.fireB = b.id; v.asleep = null; v.indoors = false; this.dropTask(v); }
      }
      const at = crew.filter(v => Math.hypot(v.x - c.x, v.z - c.z) < 3.5 && v.act).length;
      const well = s.buildings.some(o => o.built && ['well', 'fountain'].includes(o.type) && Math.hypot(this.bCenter(o).x - c.x, this.bCenter(o).z - c.z) < 10);
      b.fire.t++;
      // it spreads by itself; each villager passing buckets beats it back (a well close by and rain help a lot)
      b.fire.heat += 0.03 - at * 0.0055 * (well ? 1.4 : 1) * (wet > 1 ? 1.4 : 1);
      if (b.fire.heat <= 0) {
        b.fire = null;
        for (const v of crew) v.fireB = null;
        const msg = `The bucket chain put out the fire at the ${defOf(b.type).name}${at ? `: ${crew.slice(0, 3).map(first).join(', ')}${crew.length > 3 ? ' and friends' : ''} saved it` : ''}!`;
        this.log(msg); this.story('hard', msg, crew.slice(0, 3), 'heart');
        this.emit('fire', b);
      } else if (b.fire.heat >= 1) {
        b.fire = null;
        for (const v of crew) v.fireB = null;
        this.damage(b);
        const msg = `The ${defOf(b.type).name} burned before the fire could be stopped. It needs repairs.`;
        this.log(msg); this.story('hard', msg, [], 'fire');
        this.emit('toast', msg, 'fire');
        this.emit('fire', b);
      }
    }
  },

  // ── the cleric's round: cure a fever, soothe the spirits ──
  clericRound(v, b) {
    const s = this.s, c = this.bCenter(b);
    const sick = s.villagers.filter(o => o.sick > s.time && o.home === b.sid).sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z))[0];
    if (sick) { sick.sick = 0; this.emit('float', sick.x, sick.z, 'Cured', 'heart'); }
    const sp = s.events.list.find(e => e.type === 'spirits' && e.sid === b.sid);
    if (sp) { sp.data.haunt -= b.type === 'temple' ? 0.34 : 0.2; if (sp.data.haunt <= 0) this.endEvent(sp, `${v.name} laid the restless spirits of ${this.sname(b.sid)} to rest.`); }
  },
  // the fair folk accept honey or cheese
  makeOffering(e) {
    const d = EVENTS.fae, good = ['honey', 'cheese'].find(k => (this.s.res[k] || 0) >= d.offering);
    if (!e || e.type !== 'fae' || !good) return false;
    this.pay({ [good]: d.offering });
    this.s.events.blessUntil = this.s.time + DAY;
    this.endEvent(e, `The fair folk accepted an offering of ${good}. The fields are blessed for a day!`);
    this.emit('toast', 'The fair folk are pleased: the fields are blessed!', 'blossom');
    return true;
  },
  // ── the dragon ──
  dragonSecond(e) {
    const s = this.s, d = e.data, c = CENTERS[e.sid];
    // the village fights back: guards with bows, wizards with fire bolts, the Archmage with something bigger
    const folk = s.villagers.filter(v => v.home === e.sid && !v.quest && !(v.ko > 0) && !v.asleep);
    let dmg = 0;
    for (const v of folk) {
      if (v.job === 'guard' && this.rng() < 0.3) dmg += 2 + (this.rng() * 3 | 0);
      if (v.job === 'wizard' && this.rng() < 0.25) dmg += v.title === 'Archmage' ? 9 : 5;
      if (v.job === 'constable' && this.rng() < 0.12) dmg += 2;
      if (v.cls === 'paladin' && this.rng() < 0.3) dmg += d.smote?.[v.id] ? 6 : ((d.smote ||= {})[v.id] = 1, 6 + roll2d8(this.rng));
      if ((v.cls === 'ranger' || v.cls === 'fighter') && v.job !== 'guard' && this.rng() < 0.2) dmg += 3;
    }
    if (dmg) { d.hp -= dmg; d.hitAt = s.time; }
    if (d.hp <= 0) {
      const gems = 8 + Math.floor(s.level / 2);
      s.res.gems += gems; this.track('gems', gems); this.emit('res');
      this.endEvent(e, `The village drove the dragon away! It dropped ${gems} gems from its hoard as it fled.`);
      this.emit('toast', `Driven off! The dragon fled and dropped ${gems} gems!`, 'trophy');
      return;
    }
    if (--d.next > 0) return;
    d.next = 8 + (this.rng() * 4 | 0);
    const targets = s.buildings.filter(b => b.built && b.sid === e.sid && !isDecor(b.type) && b.type !== 'campfire' && !b.fire && !b.damaged);
    const b = targets[(this.rng() * targets.length) | 0];
    if (!b) return;
    d.swoop = { bid: b.id, at: s.time };
    this.emit('dragonSwoop', b, e);
    if (this.rng() < 0.55) this.ignite(b, 'The dragon');
    else {
      const coins = Math.min(250, Math.floor(s.res.coins * 0.05));
      if (coins > 0) { s.res.coins -= coins; this.track('coins', -coins); d.loot += coins; this.emit('res'); const bc = this.bCenter(b); this.emit('float', bc.x, bc.z, `-${coins}`, 'coin'); }
    }
  },

  eventsSecond() {
    const s = this.s, E = s.events, day = this.dayNum(), f = this.dayFrac();
    if (f >= 0.25 && E.rolled !== day) { E.rolled = day; if (E.mode !== 'off') this.rollEvent(); }
    // storms throw lightning
    if (s.weather?.storm && E.mode !== 'off' && this.rng() < (E.mode === 'gentle' ? 1 / 900 : 1 / 450)) {
      const sids = Object.keys(s.unlocked), sid = sids[(this.rng() * sids.length) | 0];
      const tall = s.buildings.filter(b => b.built && b.sid === sid && !isDecor(b.type) && b.type !== 'campfire' && !b.fire && !b.damaged);
      if (tall.length) this.ignite(tall[(this.rng() * tall.length) | 0]);
    }
    this.fireSecond();
    // famine: not rolled, it follows from empty stores (a drought or blight makes it likely)
    if ((this.famT = (this.famT || 0) + 1) % 10 === 0 && s.villagers.length) {
      const hungry = s.villagers.filter(v => v.hungry).length / s.villagers.length;
      if (!E.famine && hungry > 0.4) {
        E.famine = true;
        const msg = 'Famine! The food stores are empty and many villagers are going hungry. Forage, farm and fish, or buy food from the merchant.';
        this.log(msg); this.story('hard', msg, [], 'apple'); this.emit('toast', 'Famine! Villagers are going hungry.', 'apple');
      } else if (E.famine && hungry < 0.1) { E.famine = false; const msg = 'The famine is over: there is food on every table again.'; this.log(msg); this.story('hard', msg, [], 'apple'); }
    }
    for (const e of [...E.list]) {
      if (e.type === 'drought' && s.weather?.rain) { this.endEvent(e, `Rain broke the drought over ${this.sname(e.sid)}.`); continue; }
      if (e.type === 'raiders' && !e.data.struck && this.isNight()) {
        e.data.struck = true;
        const c = CENTERS[e.sid], n = 4 + Math.min(4, Math.floor(s.level / 3));
        for (let tries = 0; tries < 30; tries++) {
          const a = this.rng() * Math.PI * 2, r = this.settlementRadius(e.sid) + 10;
          const tx = Math.round(c.x + Math.cos(a) * r), tz = Math.round(c.z + Math.sin(a) * r);
          if (!inMap(tx, tz) || !this.world.passable(idx(tx, tz))) continue;
          for (let k = 0; k < n; k++) this.spawnBeast('goblin', e.sid, toWorld(tx) + (k % 3 - 1) * 0.7, toWorld(tz) + Math.floor(k / 3) * 0.7);
          this.emit('toast', `The goblin war band is here! ${n} raiders are charging ${this.sname(e.sid)}!`, 'shield');
          this.emit('sfx', 'howl');
          break;
        }
      }
      if (e.type === 'raiders' && e.data.struck && !this.isNight() && !s.beasts.some(b => b.sid === e.sid && b.state !== 'flee')) { this.endEvent(e, `The goblin raid on ${this.sname(e.sid)} is over.`); continue; }
      if (e.type === 'spirits' && this.isNight()) s.happiness = Math.max(0, s.happiness - 0.3);
      if (e.type === 'dragon') { this.dragonSecond(e); if (!s.events.list.includes(e)) continue; }
      if (s.time >= e.until) {
        const end = { drought: 'The drought is over.', blight: 'The blight has passed.', fever: 'The fever has run its course.', spirits: 'The spirits drifted away on their own.',
          fae: 'The fair folk have lost interest. Tools are turning up again.', raiders: 'The raiders never came.', quake: '' }[e.type];
        if (e.type === 'dragon') { this.endEvent(e, `The dragon flew off${e.data.loot ? ` with ${e.data.loot} coins from the treasury` : ''}.`); continue; }
        this.endEvent(e, end ? `${this.sname(e.sid)}: ${end}` : '');
      }
    }
  },
};

// ── UI: the banner under the resource bar, the settings row, the panel bits ──
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function eventsInit(ui) {
  const bar = document.createElement('div'); bar.id = 'eventbar'; bar.className = 'hidden';
  document.body.appendChild(bar);
  bar.addEventListener('click', e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const sim = ui.sim, ev = sim.s.events.list.find(o => o.id === +a.dataset.id);
    if (a.dataset.act === 'ev-offer') { if (!sim.makeOffering(ev)) ui.toast('You need 5 honey or 5 cheese for the offering.', 'blossom'); }
    if (a.dataset.act === 'ev-go') { const b = sim.bById.get(+a.dataset.bid); if (b) ui.g.select({ kind: 'b', b }, true); else if (ev) ui.g.flyToSettlement?.(ev.sid); }
  });
  const st = document.createElement('style');
  st.textContent = `#eventbar{position:fixed;left:50%;top:calc(92px + var(--sat));transform:translateX(-50%);z-index:5;display:flex;flex-direction:column;gap:5px;max-width:min(560px,calc(100vw - 24px))}
#eventbar .evrow{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 7px;border-radius:13px;background:#fff6e6;border:2.5px solid #c9813a;box-shadow:var(--shadow);font-size:12.5px;color:var(--ink);animation:chipIn var(--t2) var(--ease)}
#eventbar .evrow.fire{border-color:#d9604f;background:#fff0e8}#eventbar .evrow.dragon{border-color:#a8322a;background:#ffe9e0}#eventbar .evrow.spirits{border-color:#6a7ab0;background:#eef2ff}
#eventbar .evrow b{white-space:nowrap}#eventbar .evrow span{flex:1;min-width:0;color:var(--ink2);line-height:1.3}#eventbar .evrow .btn{flex:none}
#eventbar .evbar{width:70px;height:7px;border-radius:4px;background:#eadcb6;overflow:hidden;flex:none}#eventbar .evbar i{display:block;height:100%;background:#d9604f}
@media(max-width:760px){#eventbar{top:calc(96px + var(--sat))}#eventbar .evrow span{display:none}}
body.placing #eventbar{display:none}
body:has(#eventbar:not(.hidden)) #toasts{top:calc(96px + var(--evh, 40px) + var(--sat))}`;
  document.head.appendChild(st);
}
const left = (sim, e) => { const t = sim.eventLeft(e); return t >= DAY * 0.6 ? `${(t / DAY).toFixed(1)} days left` : `${Math.ceil(t / 60)} min left`; };
export function eventsFrame(ui) {
  const sim = ui.sim, s = sim.s, bar = document.getElementById('eventbar'); if (!bar) return;
  const rows = [];
  if (s.events.famine) rows.push(`<div class="evrow fire">${svg('apple', 22)}<b>Famine</b><span>Many villagers are hungry. Gather food: foragers, farms, fishing, the merchant.</span></div>`);
  for (const b of s.buildings) if (b.fire) rows.push(`<div class="evrow fire">${svg('fire', 22)}<b>Fire at the ${esc(defOf(b.type).name)}</b><span>${s.villagers.filter(v => v.fireB === b.id).length} villagers on the bucket chain</span><div class="evbar"><i style="width:${Math.round(b.fire.heat * 100)}%"></i></div><button class="btn sm" data-act="ev-go" data-bid="${b.id}">Show</button></div>`);
  for (const e of s.events.list) {
    const d = EVENTS[e.type];
    if (e.type === 'dragon') { rows.push(`<div class="evrow dragon">${svg('dragon', 22)}<b>Dragon attack!</b><span>Guards and wizards are fighting back</span><div class="evbar"><i style="width:${Math.round(Math.max(0, e.data.hp) / e.data.max * 100)}%"></i></div><button class="btn sm" data-act="ev-go" data-id="${e.id}">Show</button></div>`); continue; }
    rows.push(`<div class="evrow ${e.type}" data-tip="${esc(d.name)}|${esc(d.help)}">${svg(d.icon, 22)}<b>${esc(d.name)}</b><span>${esc(d.help.split('. ')[0])}. ${left(sim, e)}</span>${e.type === 'fae' ? `<button class="btn gold sm" data-act="ev-offer" data-id="${e.id}" ${(s.res.honey || 0) >= 5 || (s.res.cheese || 0) >= 5 ? '' : 'disabled data-tip="No honey or cheese|You need 5 honey or 5 cheese in store."'}>Offer 5 honey or cheese</button>` : ''}</div>`);
  }
  const html = rows.slice(0, 3).join('');
  if (bar.dataset.h !== html) { bar.dataset.h = html; bar.innerHTML = html; }
  bar.classList.toggle('hidden', !rows.length);
  // popups slide down below the banners
  if (rows.length) document.documentElement.style.setProperty('--evh', bar.offsetHeight + 6 + 'px');
}
// a damaged building's panel: what happened, and the repair button
export function eventsBuildingHtml(ui, b) {
  const sim = ui.sim;
  if (b.fire) return `<div class="ip-sec"><div class="statusline bad"><span class="dot"></span><span>On fire! ${sim.s.villagers.filter(v => v.fireB === b.id).length} villagers are passing buckets.</span></div><div class="pbar"><i style="width:${Math.round(b.fire.heat * 100)}%;background:#d9604f"></i></div></div>`;
  if (!b.damaged) return '';
  const cost = sim.repairCost(b), ok = sim.canAfford(cost);
  return `<div class="ip-sec"><div class="cap">${svg('hammer', 14)} Damaged${b.up?.repair ? `<span class="r">Repairing ${Math.floor(b.up.progress * 100)}%</span>` : ''}</div><div class="desc">It no longer works until it is repaired.</div>
    ${b.up?.repair ? `<div class="pbar"><i style="width:${b.up.progress * 100}%"></i></div>` : `<button class="btn gold sm" style="width:100%" data-act="ev-repair" ${ok ? '' : 'disabled'}>${svg('hammer', 14)} Repair · ${Object.entries(cost).map(([k, n]) => `${n} ${k}`).join(', ')}</button>`}</div>`;
}
export function eventsSettingsHtml(ui) {
  const m = ui.sim.s.events.mode;
  return `<section class="town-section"><h3>Hard times</h3><p>Droughts, fevers, fires, raiders, restless spirits and the odd dragon. Nobody dies, but they keep you on your toes.</p><div class="autorow">${[['off', 'Off'], ['gentle', 'Gentle'], ['normal', 'Normal']].map(([k, t]) => `<button class="tog ${m === k ? 'on' : ''}" data-act="ev-mode" data-k="${k}">${t}</button>`).join('')}</div></section>`;
}
export function eventsClick(ui, act, a, b) {
  if (!act.startsWith('ev-')) return false;
  const sim = ui.sim;
  if (act === 'ev-mode') sim.s.events.mode = a.dataset.k;
  if (act === 'ev-repair' && b && !sim.repair(b)) ui.toast('Not enough materials to repair it yet.', 'hammer');
  return true;
}
