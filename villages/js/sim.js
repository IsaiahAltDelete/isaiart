// Game rules and simulation: economy, villager brains, construction,
// population, quests, levels, saving. No DOM or Three.js in here — the
// view layer listens to events emitted from this class.
import { World, N, idx, tileX, tileZ, toWorld, toTile, inMap, CENTERS, T_WATER } from './world.js';
import { BUILDINGS, DECOR, GOODS, SELLABLE, QUESTS, SETTLEMENTS, ACHIEVEMENTS, MERCHANT_OFFERS, xpForLevel,
  FIRST_NAMES, LAST_NAMES, SHIRTS, SKINS, HAIRS, JOBS } from './data.js';
import { mulberry32, pick } from './rng.js';

export const defOf = type => BUILDINGS[type] || DECOR[type];
export const isDecor = type => !!DECOR[type];
export const lvlOf = b => b.lvl || 1;
export const MAX_LVL = 3;
export function workersOf(b) { const d = defOf(b.type); return d.workers ? d.workers + lvlOf(b) - 1 : 0; }
export function housingOf(b) { const d = defOf(b.type); return d.housing ? d.housing + (lvlOf(b) - 1) * 2 : 0; }
export function storageOf(b) { const d = defOf(b.type); return d.storage ? d.storage + (lvlOf(b) - 1) * 300 : 0; }
export function footprint(type, rot) { const [w, d] = defOf(type).size; return rot % 2 ? [d, w] : [w, d]; }

const DAY = 240;                     // sim seconds per in-game day
const MEAL = 80;                     // seconds between meals per villager
const CONVERT = {                    // staffed converters: inputs -> outputs, seconds
  sawyer: { in: { wood: 2 }, out: { planks: 1 }, t: 5, anim: 'saw', keep: { wood: 40 } },
  miller: { in: { grain: 3 }, out: { flour: 2 }, t: 6, anim: 'work' },
  baker:  { in: { flour: 2 }, out: { food: 8 }, t: 7, anim: 'work', stat: 'bread' },
  mason:  { in: { stone: 3 }, out: { bricks: 1 }, t: 6, anim: 'hammer', keep: { stone: 40 } },
};
export const RANGE = { woodcutter: 20, forager: 16, miner: 20, forester: 9.5 };

export class Sim {
  constructor(save) {
    this.handlers = {};
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    const seed = save?.seed ?? ((Math.random() * 1e9) | 0);
    this.world = new World(seed);
    this.origTrees = this.world.trees.length;
    this.bById = new Map(); this.vById = new Map();
    this.stumps = [];
    this.wearTimer = 0; this.secTimer = 0;
    this.flow = {}; this.flowHist = []; this.flowT = 0;
    if (save) this.load(save); else this.newGame(seed);
  }
  on(name, fn) { this.handlers[name] = fn; }
  emit(name, ...a) { this.handlers[name]?.(...a); }

  // ── setup ──
  newGame(seed) {
    this.s = {
      v: 1, seed, time: DAY * 0.3, speed: 1, nextId: 1,
      res: { coins: 150, wood: 120, planks: 0, stone: 30, bricks: 0, grain: 0, flour: 0, food: 60, gems: 15 },
      xp: 0, level: 1, happiness: 70,
      buildings: [], villagers: [], unlocked: {},
      quests: { claimed: [] }, stats: { built: {}, produced: {}, earned: 0, decor: 0 },
      sell: Object.fromEntries(SELLABLE.map(k => [k, k === 'food' || k === 'grain'])),
      log: [], popTimer: 0, tutorial: 0, weather: { rain: false, t: 150 },
    };
    this.unlock('meadow', true);
    const c = CENTERS.meadow;
    this.addBuilding('cottage', c.x + 2, c.z - 4, 0, true);
    for (let i = 0; i < 4; i++) this.spawnVillager('meadow', toWorld(c.x) + (i - 1.5) * 0.8, toWorld(c.z) + 2);
    this.log('Welcome to Meadowbrook! Build a Lumber Hut to get started.');
  }

  unlock(sid, free = false) {
    const def = SETTLEMENTS.find(s => s.id === sid);
    if (!free) {
      if (this.s.unlocked[sid]) return false;
      if (this.s.level < def.unlock.lvl || !this.canAfford(def.unlock.cost)) return false;
      this.pay(def.unlock.cost);
    }
    this.s.unlocked[sid] = true;
    const c = CENTERS[sid];
    this.addBuilding('campfire', c.x - 1, c.z - 1, 0, true);
    if (!free) {
      for (let i = 0; i < 2; i++) this.spawnVillager(sid, toWorld(c.x) + i, toWorld(c.z) + 2);
      this.log(`${def.name} has been settled! Two settlers moved in.`);
      this.emit('toast', `${def.name} settled!`, 'map');
      this.addXp(60);
    }
    this.emit('settlements');
    return true;
  }

  // ── resources ──
  cap() {
    let c = 0;
    for (const b of this.s.buildings) if (b.built) c += storageOf(b);
    return c;
  }
  canAfford(cost) { return Object.entries(cost || {}).every(([k, v]) => (this.s.res[k] || 0) >= v); }
  pay(cost) { for (const [k, v] of Object.entries(cost || {})) { this.s.res[k] -= v; this.track(k, -v); } this.emit('res'); }
  track(res, n) { this.flow[res] = (this.flow[res] || 0) + n; }
  // net change per minute over the last ~60 seconds
  rate(res) {
    if (!this.flowHist.length) return 0;
    let sum = 0; for (const h of this.flowHist) sum += h[res] || 0;
    return sum * 60 / (this.flowHist.length * 10);
  }
  add(res, n, track = true) {
    const r = this.s.res;
    let added = n;
    if (GOODS[res].capped) added = Math.max(0, Math.min(n, this.cap() - r[res]));
    r[res] += added;
    this.track(res, added);
    if (track && added > 0) this.s.stats.produced[res] = (this.s.stats.produced[res] || 0) + added;
    this.emit('res');
    return added;
  }

  addXp(n) {
    const s = this.s;
    s.xp += n;
    while (s.xp >= xpForLevel(s.level)) {
      s.xp -= xpForLevel(s.level); s.level++;
      const gems = 5 + s.level * 2;
      s.res.gems += gems;
      const unlocked = [...Object.entries(BUILDINGS), ...Object.entries(DECOR)].filter(([, d]) => d.lvl === s.level).map(([, d]) => d.name);
      this.emit('levelup', s.level, unlocked, gems);
      this.log(`Reached level ${s.level}!${unlocked.length ? ' Unlocked: ' + unlocked.join(', ') + '.' : ''}`);
    }
    this.emit('xp');
  }

  log(msg) {
    this.s.log.unshift({ t: this.s.time, msg });
    if (this.s.log.length > 40) this.s.log.pop();
    this.emit('log');
  }

  // ── settlements & territory ──
  settlementRadius(sid) {
    const c = CENTERS[sid];
    const n = this.s.buildings.filter(b => b.sid === sid && b.built && !isDecor(b.type)).length;
    return c.r + 4 + Math.min(8, Math.floor(n / 2));
  }
  settlementAt(tx, tz) {
    let best = null, bd = 1e9;
    for (const sid of Object.keys(this.s.unlocked)) {
      const c = CENTERS[sid], d = Math.hypot(tx + 0.5 - c.x, tz + 0.5 - c.z);
      if (d <= this.settlementRadius(sid) && d < bd) { bd = d; best = sid; }
    }
    return best;
  }

  // ── placement ──
  checkPlace(type, tx, tz, rot, ignoreId = -1) {
    const W = this.world, def = defOf(type);
    const [w, d] = footprint(type, rot);
    let sid = null;
    for (let z = tz; z < tz + d; z++) for (let x = tx; x < tx + w; x++) {
      if (!inMap(x, z)) return { ok: false, why: 'Out of bounds' };
      const i = idx(x, z);
      if (W.type[i] === T_WATER) return { ok: false, why: 'Can\'t build on water' };
      if (W.occ[i] >= 0 && W.occ[i] !== ignoreId) return { ok: false, why: 'Something is already here' };
      if (isDecor(type) && W.rock[i] >= 0) return { ok: false, why: 'A boulder is in the way' };
      const s = this.settlementAt(x, z);
      if (!s) return { ok: false, why: 'Outside your settlements' };
      sid = sid ?? s;
    }
    if (!isDecor(type) || type === 'well' || type === 'statue') {
      for (const o of this.s.buildings) {
        if (isDecor(o.type) || o.id === ignoreId) continue;
        const [ex, ez] = this.entryTile(o);
        if (ex >= tx && ex < tx + w && ez >= tz && ez < tz + d) return { ok: false, why: `That would block the ${defOf(o.type).name}'s door` };
      }
    }
    if (!isDecor(type)) {
      const [ex, ez] = this.entryTile({ type, tx, tz, rot });
      const ei = idx(ex, ez);
      if (!inMap(ex, ez) || (W.type[ei] === T_WATER && !W.bridge[ei]) || (W.block[ei] && W.occ[ei] !== ignoreId) || W.rock[ei] >= 0) return { ok: false, why: 'The door needs open ground in front' };
    }
    if (ignoreId < 0) {
      if (def.lvl && this.s.level < def.lvl) return { ok: false, why: `Needs level ${def.lvl}` };
      if (!this.canAfford(def.cost)) return { ok: false, why: 'Not enough resources' };
    }
    if (def.needsWater) {
      const f = this.facingTiles(tx, tz, rot, w, d);
      const wet = f.filter(([x, z]) => inMap(x, z) && W.type[idx(x, z)] === T_WATER).length;
      if (wet < 2) return { ok: false, why: 'Must face the water' };
    }
    return { ok: true, sid };
  }
  // tiles 1–2 steps in front of a footprint
  facingTiles(tx, tz, rot, w, d) {
    const out = [];
    for (let k = 1; k <= 2; k++) {
      if (rot === 0) for (let x = tx; x < tx + w; x++) out.push([x, tz + d - 1 + k]);
      if (rot === 2) for (let x = tx; x < tx + w; x++) out.push([x, tz - k]);
      if (rot === 1) for (let z = tz; z < tz + d; z++) out.push([tx + w - 1 + k, z]);
      if (rot === 3) for (let z = tz; z < tz + d; z++) out.push([tx - k, z]);
    }
    return out;
  }
  bestDockRot(tx, tz) {
    let best = 0, bw = -1;
    for (let r = 0; r < 4; r++) {
      const [w, d] = footprint('dock', r);
      const wet = this.facingTiles(tx, tz, r, w, d).filter(([x, z]) => inMap(x, z) && this.world.type[idx(x, z)] === T_WATER).length;
      if (wet > bw) { bw = wet; best = r; }
    }
    return best;
  }

  place(type, tx, tz, rot) {
    const chk = this.checkPlace(type, tx, tz, rot);
    if (!chk.ok) return chk;
    const def = defOf(type);
    this.pay(def.cost);
    const decor = isDecor(type);
    const b = this.addBuilding(type, tx, tz, rot, decor);
    if (decor) { this.s.stats.decor++; this.addXp(5); }
    this.emit('sfx', 'place');
    return { ok: true, b };
  }

  addBuilding(type, tx, tz, rot, built) {
    const W = this.world;
    const [w, d] = footprint(type, rot);
    const b = { id: this.s.nextId++, type, tx, tz, rot, built, progress: 0, workers: [], data: {}, clear: [] };
    b.sid = this.settlementAt(tx, tz) || (type === 'campfire' ? this.closestCenter(tx, tz) : null);
    for (let z = tz; z < tz + d; z++) for (let x = tx; x < tx + w; x++) {
      const i = idx(x, z);
      W.occ[i] = b.id; if (!W.road[i]) W.wear[i] = 0;
      if (!isDecor(type)) W.block[i] = 1;
      if (W.tree[i] >= 0) { if (built) this.fellTree(W.tree[i], false); else b.clear.push(['t', W.tree[i]]); }
      if (W.rock[i] >= 0) { if (built) this.breakRock(W.rock[i]); else b.clear.push(['r', W.rock[i]]); }
      if (W.bush[i] >= 0) { if (built) this.clearBush(W.bush[i]); else b.clear.push(['b', W.bush[i]]); }
      this.emit('tile', i);
    }
    if (type === 'farm') b.data = { stage: 'empty', grow: 0, work: 0 };
    this.s.buildings.push(b); this.bById.set(b.id, b);
    this.emit('building', b);
    return b;
  }
  closestCenter(tx, tz) {
    let best = 'meadow', bd = 1e9;
    for (const [sid, c] of Object.entries(CENTERS)) { const d = Math.hypot(tx - c.x, tz - c.z); if (d < bd) { bd = d; best = sid; } }
    return best;
  }

  // ── upgrades ──
  upgradeCost(b) {
    const L = lvlOf(b), base = b.type === 'campfire' ? { coins: 150, wood: 80 } : defOf(b.type).cost || {};
    const mult = L === 1 ? 1.5 : 3, out = {};
    for (const [k, v] of Object.entries(base)) if (k !== 'gems') out[k] = Math.ceil(v * mult / 5) * 5;
    if (L === 1) out.planks = (out.planks || 0) + 20; else out.bricks = (out.bricks || 0) + 20;
    return out;
  }
  upgradeLevelReq(b) { return lvlOf(b) === 1 ? 3 : 6; }
  canUpgrade(b) {
    if (!b.built || b.up || isDecor(b.type) || lvlOf(b) >= MAX_LVL) return { ok: false, why: lvlOf(b) >= MAX_LVL ? 'Fully upgraded' : '' };
    if (this.s.level < this.upgradeLevelReq(b)) return { ok: false, why: `Needs level ${this.upgradeLevelReq(b)}` };
    if (!this.canAfford(this.upgradeCost(b))) return { ok: false, why: 'Not enough resources' };
    return { ok: true };
  }
  upgrade(b) {
    if (!this.canUpgrade(b).ok) return false;
    this.pay(this.upgradeCost(b));
    b.up = { progress: 0 };
    this.emit('building', b); this.emit('sfx', 'place');
    return true;
  }
  upgradeEffect(b) {
    const d = defOf(b.type), out = [];
    if (d.workers) out.push('+1 worker slot');
    if (d.housing || b.type === 'campfire') out.push('+2 beds');
    if (d.storage) out.push('+300 storage');
    if (d.workers) out.push('+15% work speed');
    return out.join(', ');
  }
  finishUpgrade(b) {
    b.lvl = lvlOf(b) + 1; b.up = null;
    this.s.stats.upgrades = (this.s.stats.upgrades || 0) + 1;
    this.addXp(25 * b.lvl);
    this.emit('building', b); this.emit('upgraded', b);
    this.emit('toast', `${defOf(b.type).name} upgraded to level ${b.lvl}!`, 'star');
    this.emit('sfx', 'done');
    if (defOf(b.type).workers) this.assign(b, null);
  }
  isSite(b) { return !b.built || !!b.up; }

  finishBuilding(b) {
    b.built = true; b.progress = 1;
    const def = defOf(b.type);
    this.s.stats.built[b.type] = (this.s.stats.built[b.type] || 0) + 1;
    this.addXp(15 + Math.round(Object.values(def.cost || {}).reduce((a, v) => a + v, 0) / 6));
    this.emit('building', b);
    this.emit('toast', `${def.name} complete!`, 'hammer');
    this.emit('sfx', 'done');
    this.log(`${def.name} finished in ${SETTLEMENTS.find(s => s.id === b.sid)?.name ?? 'the wilds'}.`);
    // auto-staff one worker if anyone is free
    if (def.workers) this.assign(b, null);
  }

  demolish(b) {
    if (b.type === 'campfire') return;
    const def = defOf(b.type), W = this.world;
    for (const vid of [...b.workers]) this.unassign(this.vById.get(vid));
    for (const [k, v] of Object.entries(def.cost || {})) this.s.res[k] += Math.floor(v * (b.built ? 0.5 : 1));
    const [w, d] = footprint(b.type, b.rot);
    for (let z = b.tz; z < b.tz + d; z++) for (let x = b.tx; x < b.tx + w; x++) { W.occ[idx(x, z)] = -1; W.block[idx(x, z)] = 0; this.emit('tile', idx(x, z)); }
    this.s.buildings = this.s.buildings.filter(o => o !== b); this.bById.delete(b.id);
    if (isDecor(b.type)) this.s.stats.decor = Math.max(0, this.s.stats.decor - 1);
    for (const v of this.s.villagers) if (v.task?.bid === b.id) this.dropTask(v);
    this.emit('removed', b); this.emit('res');
  }

  // pick a building up and set it down somewhere else, for free
  move(b, tx, tz, rot) {
    if (b.type === 'campfire') return { ok: false, why: 'The campfire stays put' };
    const chk = this.checkPlace(b.type, tx, tz, rot, b.id);
    if (!chk.ok) return chk;
    const W = this.world;
    let [w, d] = footprint(b.type, b.rot);
    for (let z = b.tz; z < b.tz + d; z++) for (let x = b.tx; x < b.tx + w; x++) { const i = idx(x, z); W.occ[i] = -1; W.block[i] = 0; this.emit('tile', i); }
    b.tx = tx; b.tz = tz; b.rot = rot; b.sid = chk.sid; b.clear = [];
    [w, d] = footprint(b.type, rot);
    for (let z = tz; z < tz + d; z++) for (let x = tx; x < tx + w; x++) {
      const i = idx(x, z);
      W.occ[i] = b.id; if (!isDecor(b.type)) W.block[i] = 1; if (!W.road[i]) W.wear[i] = 0;
      if (W.tree[i] >= 0) { if (b.built) { this.fellTree(W.tree[i], false); this.add('wood', 3); } else b.clear.push(['t', W.tree[i]]); }
      if (W.rock[i] >= 0) { if (b.built) this.breakRock(W.rock[i]); else b.clear.push(['r', W.rock[i]]); }
      if (W.bush[i] >= 0) { if (b.built) this.clearBush(W.bush[i]); else b.clear.push(['b', W.bush[i]]); }
      this.emit('tile', i);
    }
    delete b._field;
    for (const v of this.s.villagers) if (v.work === b.id || v.task?.bid === b.id) this.dropTask(v);
    this.emit('moved', b);
    this.emit('sfx', 'place');
    return { ok: true };
  }

  // geometry helpers
  bCenter(b) { const [w, d] = footprint(b.type, b.rot); return { x: toWorld(b.tx) + (w - 1) / 2, z: toWorld(b.tz) + (d - 1) / 2, w, d }; }
  local(b, lx, lz) {
    const c = this.bCenter(b), th = b.rot * Math.PI / 2;
    return { x: c.x + lx * Math.cos(th) + lz * Math.sin(th), z: c.z - lx * Math.sin(th) + lz * Math.cos(th) };
  }
  entryTile(b) {
    const [w, d] = footprint(b.type, b.rot);
    const r = b.type === 'dock' ? (b.rot + 2) % 4 : b.rot;
    if (r === 0) return [b.tx + (w >> 1), b.tz + d];
    if (r === 1) return [b.tx + w, b.tz + (d >> 1)];
    if (r === 2) return [b.tx + (w >> 1), b.tz - 1];
    return [b.tx - 1, b.tz + (d >> 1)];
  }

  // ── villagers ──
  spawnVillager(sid, x, z) {
    const r = this.rng;
    const v = {
      id: this.s.nextId++, name: `${pick(r, FIRST_NAMES)} ${pick(r, LAST_NAMES)}`,
      shirt: pick(r, SHIRTS), skin: pick(r, SKINS), hair: pick(r, HAIRS), hat: r() < 0.35, hatColor: pick(r, [0xc9a050, 0x8a5a33, 0x3f7a39, 0xd9534f]),
      x, z, home: sid, job: 'idle', work: null, carry: null, hunger: r() * MEAL * 0.6, hungry: false,
      task: null, act: null, face: 0,
    };
    this.s.villagers.push(v); this.vById.set(v.id, v);
    this.emit('villager', v);
    return v;
  }

  assign(b, v) {
    const def = defOf(b.type);
    if (!def.workers || b.workers.length >= workersOf(b) || !b.built) return false;
    if (!v) {
      const c = this.bCenter(b);
      const idle = this.s.villagers.filter(o => o.job === 'idle');
      if (!idle.length) return false;
      idle.sort((a, o) => (a.home !== b.sid) - (o.home !== b.sid) || Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(o.x - c.x, o.z - c.z));
      v = idle[0];
    }
    this.unassign(v);
    v.job = def.job; v.work = b.id; b.workers.push(v.id);
    this.dropTask(v);
    this.emit('villagerJob', v); this.emit('building', b);
    return true;
  }
  // fill empty job slots with idle villagers; food jobs first when food is short
  autoAssign() {
    const s = this.s, foodJobs = ['forager', 'fisher', 'farmer', 'baker'];
    const short = s.res.food < s.villagers.length * 4;
    const open = s.buildings.filter(b => b.built && !b.up && workersOf(b) > b.workers.length);
    open.sort((a, b) => short ? foodJobs.includes(defOf(b.type).job) - foodJobs.includes(defOf(a.type).job) : a.workers.length - b.workers.length);
    let n = 0;
    for (const b of open) while (b.workers.length < workersOf(b) && s.villagers.some(v => v.job === 'idle')) { if (!this.assign(b, null)) break; n++; }
    return n;
  }
  unassign(v) {
    if (!v || !v.work) { if (v) v.job = 'idle'; return; }
    const b = this.bById.get(v.work);
    if (b) { b.workers = b.workers.filter(id => id !== v.id); this.emit('building', b); }
    v.work = null; v.job = 'idle';
    this.dropTask(v);
    this.emit('villagerJob', v);
  }

  dropTask(v) {
    const t = v.task;
    if (t?.claim) { const [k, i] = t.claim; const o = k === 't' ? this.world.trees[i] : k === 'r' ? this.world.rocks[i] : this.world.bushes[i]; if (o && o.claimed === v.id) o.claimed = -1; }
    v.task = null; v.act = null; v.path = null;
  }

  // Tasks are a list of steps run in order. Steps:
  //   {walk: goal}  — A* to a goal {tx,tz, near:building|null, adj:bool}
  //   {to: [x,z]}   — walk directly (short hops)
  //   {act: secs, anim, done: fn}  — work in place, then call done
  //   {fn}          — run immediately
  setTask(v, label, steps, extra = {}) {
    this.dropTask(v);
    v.task = { label, steps, i: 0, ...extra };
  }

  think(v) {
    const job = v.job;
    if (v.carry) return this.taskDeliver(v);
    const b = v.work ? this.bById.get(v.work) : null;
    if (job === 'idle') return this.thinkIdle(v);
    if (!b) { this.unassign(v); return; }
    // nobody idle but a site is waiting? up to two workers pitch in for a bit
    const site = this.siteNeedingHelp(v);
    if (site) return this.taskBuild(v, site, true);
    if (job === 'woodcutter') return this.taskGather(v, b, 't');
    if (job === 'miner') return this.taskGather(v, b, 'r');
    if (job === 'forager') return this.taskGather(v, b, 'b');
    if (job === 'farmer') return this.taskFarm(v, b);
    if (job === 'fisher') return this.taskFish(v, b);
    if (job === 'merchant') return this.taskSell(v, b);
    if (job === 'forester') return this.taskPlant(v, b);
    if (CONVERT[job]) return this.taskConvert(v, b, CONVERT[job]);
  }

  goalBuilding(b) { const [ex, ez] = this.entryTile(b); return { tx: ex, tz: ez, near: b }; }
  spot(b, k) {
    const { d } = this.bCenter(b);
    if (b.type === 'dock') return this.local(b, 0.45, 1.9 - k * 0.65);
    if (b.type === 'farm') return this.local(b, -0.8 + k * 1.1, -0.25 + (k % 2) * 0.5);
    const off = b.workers.length > 1 ? (k ? 0.35 : -0.35) : 0;
    return this.local(b, off, d / 2 + 0.28);
  }

  siteNeedingHelp(v) {
    const s = this.s;
    if (!s.buildings.some(b => this.isSite(b))) return null;
    if (s.villagers.some(o => o.job === 'idle')) return null;
    if (s.villagers.filter(o => o.task?.volunteer).length >= 2) return null;
    let best = null, bd = 1e9;
    for (const b of s.buildings) {
      if (!this.isSite(b)) continue;
      const d = this.distTo(v, b);
      if (d < bd) { bd = d; best = b; }
    }
    return bd < 40 ? best : null;
  }

  thinkIdle(v) {
    // 1) help build the nearest construction site
    const sites = this.s.buildings.filter(b => this.isSite(b));
    if (sites.length) {
      sites.sort((a, o) => this.distTo(v, a) - this.distTo(v, o) + ((a.sid !== v.home) - (o.sid !== v.home)) * 12);
      return this.taskBuild(v, sites[0]);
    }
    // 2) chop trees the player marked for clearing
    const ti = this.nearestTarget(v.x, v.z, 't', 60, true);
    if (ti >= 0) return this.taskChopMarked(v, ti);
    // 3) potter about near the campfire
    const c = CENTERS[v.home] || CENTERS.meadow;
    let tx = c.x, tz = c.z + 2;
    for (let k = 0; k < 8; k++) {
      const a = this.rng() * Math.PI * 2, r = 1.8 + this.rng() * 3.5;
      tx = Math.round(c.x + Math.cos(a) * r); tz = Math.round(c.z + Math.sin(a) * r);
      if (inMap(tx, tz) && this.world.passable(idx(tx, tz))) break;
    }
    this.setTask(v, 'Relaxing', [
      { walk: { tx, tz } },
      { act: 3 + this.rng() * 5, anim: 'rest' },
    ]);
  }
  distTo(v, b) { const c = this.bCenter(b); return Math.hypot(v.x - c.x, v.z - c.z); }

  taskBuild(v, b, volunteer = false) {
    const W = this.world;
    // clear obstacles first
    while (b.clear.length) {
      const [k, i] = b.clear[0];
      const o = k === 't' ? W.trees[i] : k === 'r' ? W.rocks[i] : W.bushes[i];
      if (!o.alive) { b.clear.shift(); continue; }
      if (o.claimed >= 0 && o.claimed !== v.id) break;
      o.claimed = v.id;
      const anim = k === 't' ? 'chop' : k === 'r' ? 'mine' : 'gather';
      return this.setTask(v, 'Clearing site', [
        { walk: { tx: o.tx, tz: o.tz, adj: true } },
        { face: [o.x, o.z] },
        { act: k === 'r' ? 4 : 2.5, anim, done: () => {
          if (k === 't') { this.fellTree(i, true); this.floatGain(o.x, o.z, 'wood', this.add('wood', 3)); }
          else if (k === 'r') { this.breakRock(i); this.floatGain(o.x, o.z, 'stone', this.add('stone', 8)); }
          else { this.clearBush(i); this.floatGain(o.x, o.z, 'food', this.add('food', 2)); }
          b.clear = b.clear.filter(([kk, ii]) => !(kk === k && ii === i));
        } },
      ], { claim: [k, i], bid: b.id, volunteer });
    }
    const n = this.s.villagers.filter(o => o.task?.bid === b.id).length;
    const p = this.local(b, ((n % 3) - 1) * 0.6, this.bCenter(b).d / 2 + 0.35);
    this.setTask(v, 'Building', [
      { walk: this.goalBuilding(b) },
      { to: [p.x, p.z] },
      { face: [this.bCenter(b).x, this.bCenter(b).z] },
      { act: 2, anim: 'hammer', done: () => {
        if (!this.isSite(b) || !this.bById.has(b.id) || b.clear.length) return;
        const def = defOf(b.type), time = (def.time || 16) * (b.up ? 0.6 + lvlOf(b) * 0.5 : 1);
        const prog = b.up || b;
        prog.progress = Math.min(1, prog.progress + 2 * this.workRate(v) / time);
        this.emit('progress', b);
        if (prog.progress >= 1) { if (b.up) this.finishUpgrade(b); else this.finishBuilding(b); }
        else if (!volunteer || (v.task.reps = (v.task.reps || 0) + 1) < 6) this.repeat(v);
      } },
    ], { bid: b.id, volunteer });
  }
  // let a villager keep working the same task without a fresh plan
  repeat(v) { if (v.task) v.task.again = true; }

  taskChopMarked(v, ti) {
    const t = this.world.trees[ti];
    t.claimed = v.id;
    this.setTask(v, 'Clearing trees', [
      { walk: { tx: t.tx, tz: t.tz, adj: true } },
      { face: [t.x, t.z] },
      { act: 4, anim: 'chop', done: () => { this.fellTree(ti, true); v.carry = { res: 'wood', n: 4 }; } },
    ], { claim: ['t', ti] });
  }

  nearestTarget(x, z, kind, range, markedOnly = false) {
    const W = this.world;
    const list = kind === 't' ? W.trees : kind === 'r' ? W.rocks : W.bushes;
    let best = -1, bd = range;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o.alive || o.claimed >= 0 || o.skipUntil > this.s.time) continue;
      if (kind === 't') {
        if (o.growth < 1) continue;
        if (markedOnly && !o.marked) continue;
        if (W.occ[idx(o.tx, o.tz)] >= 0) continue;   // builders handle those
      }
      if (kind === 'b' && !o.ripe) continue;
      let d = Math.hypot(o.x - x, o.z - z);
      if (kind === 't' && o.marked) d -= 6;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // walking-cost field around a workplace, cached for a little while
  field(b, range) {
    const f = b._field;
    if (f && f.until > this.s.time && f.range === range) return f.dist;
    const W = this.world, [w, d] = footprint(b.type, b.rot), starts = [];
    for (let z = b.tz - 1; z <= b.tz + d; z++) for (let x = b.tx - 1; x <= b.tx + w; x++)
      if (inMap(x, z) && W.passable(idx(x, z))) starts.push(idx(x, z));
    const dist = W.walkField(starts, range * 2.4);
    Object.defineProperty(b, '_field', { value: { dist, until: this.s.time + 25, range }, writable: true, configurable: true, enumerable: false });
    return dist;
  }
  nearestByWalk(b, kind, range, markedOnly = false) {
    const W = this.world, dist = this.field(b, range);
    const list = kind === 't' ? W.trees : kind === 'r' ? W.rocks : W.bushes;
    let best = -1, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o.alive || o.claimed >= 0 || o.skipUntil > this.s.time) continue;
      if (kind === 't' && (o.growth < 1 || (markedOnly && !o.marked) || W.occ[idx(o.tx, o.tz)] >= 0)) continue;
      if (kind === 'b' && !o.ripe) continue;
      let d = dist[idx(o.tx, o.tz)];
      if (d === Infinity) continue;
      if (kind === 't' && o.marked) d -= 8;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  taskGather(v, b, kind) {
    const job = { t: 'woodcutter', r: 'miner', b: 'forager' }[kind];
    let i = -1;
    if (kind === 't') i = this.nearestByWalk(b, 't', 40, true);   // marked trees first
    if (i < 0) i = this.nearestByWalk(b, kind, RANGE[job]);
    if (i < 0) {
      b.status = kind === 't' ? 'No trees within reach' : kind === 'r' ? 'No boulders nearby' : 'Waiting for berries';
      return this.setTask(v, 'Waiting', [{ walk: this.goalBuilding(b) }, { act: 5, anim: 'rest' }]);
    }
    b.status = null;
    const W = this.world, o = (kind === 't' ? W.trees : kind === 'r' ? W.rocks : W.bushes)[i];
    o.claimed = v.id;
    const label = { t: 'Chopping wood', r: 'Mining stone', b: 'Picking berries' }[kind];
    this.setTask(v, label, [
      { walk: { tx: o.tx, tz: o.tz, adj: true } },
      { face: [o.x, o.z] },
      { act: kind === 'b' ? 3.5 : 5, anim: kind === 't' ? 'chop' : kind === 'r' ? 'mine' : 'gather', done: () => {
        if (!o.alive) return;
        if (kind === 't') { this.fellTree(i, true); v.carry = { res: 'wood', n: 6 }; }
        else if (kind === 'r') {
          o.hp -= 7; v.carry = { res: 'stone', n: 7 };
          if (o.hp <= 0) this.breakRock(i); else this.emit('rock', i);
          o.claimed = -1;
        } else { o.ripe = false; o.regrow = 55 + this.rng() * 20; o.claimed = -1; this.emit('bush', i); v.carry = { res: 'food', n: 5 }; }
      } },
    ], { claim: [kind, i] });
  }

  taskDeliver(v) {
    const b = v.work ? this.bById.get(v.work) : null;
    const target = b || this.s.buildings.find(o => o.type === 'campfire' && o.sid === v.home) || this.s.buildings.find(o => o.type === 'campfire');
    this.setTask(v, 'Carrying ' + GOODS[v.carry.res].name.toLowerCase(), [
      { walk: this.goalBuilding(target) },
      { fn: () => {
        const { res, n } = v.carry; v.carry = null;
        const got = this.add(res, Math.round(n * (this.s.happiness > 80 ? 1.2 : 1)));
        this.floatGain(v.x, v.z, res, got);
        if (got > 0) this.addXp(1);
      } },
    ]);
  }

  floatGain(x, z, res, n) { this.emit('float', x, z, n > 0 ? `+${n}` : 'Full!', GOODS[res].icon); }

  taskFarm(v, b) {
    const k = b.workers.indexOf(v.id), d = b.data, p = this.spot(b, k);
    const go = [{ walk: this.goalBuilding(b) }, { to: [p.x, p.z] }];
    if (d.stage === 'empty') {
      return this.setTask(v, 'Sowing wheat', [...go, { act: 3, anim: 'hoe', done: () => {
        d.work += 3 * this.workRate(v);
        if (d.work >= 8) { d.stage = 'growing'; d.grow = 0; d.work = 0; this.emit('farm', b); }
        else this.repeat(v);
      } }]);
    }
    if (d.stage === 'growing') {
      return this.setTask(v, 'Tending crops', [...go, { act: 4, anim: 'hoe', done: () => { d.grow = Math.min(1, d.grow + 0.03); this.emit('farm', b); } }]);
    }
    return this.setTask(v, 'Harvesting', [...go, { act: 3, anim: 'gather', done: () => {
      if (d.stage !== 'ripe') return;
      d.work += 3 * this.workRate(v);
      if (d.work >= 6) { d.stage = 'empty'; d.work = 0; d.grow = 0; this.emit('farm', b); v.carry = { res: 'grain', n: 20 }; }
      else this.repeat(v);
    } }]);
  }

  taskFish(v, b) {
    const k = b.workers.indexOf(v.id), p = this.spot(b, k), via = this.local(b, 0.75, -1.25);
    const tip = this.local(b, 0.45, 4);
    this.setTask(v, 'Fishing', [
      { walk: this.goalBuilding(b) }, { to: [via.x, via.z] }, { to: [p.x, p.z], onDock: true }, { face: [tip.x, tip.z] },
      { act: 9, anim: 'fish', done: () => {
        const got = this.add('food', 4 + (this.rng() < 0.2 ? 3 : 0));
        this.floatGain(v.x, v.z, 'food', got); if (got) this.addXp(1);
        this.repeat(v);
      } },
    ]);
  }

  taskConvert(v, b, cv) {
    const k = b.workers.indexOf(v.id), p = this.spot(b, k), c = this.bCenter(b);
    const res = this.s.res;
    this.setTask(v, 'Working', [
      { walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] },
      { act: cv.t, anim: cv.anim, start: () => {
        if (!this.canAfford(cv.in)) {
          b.status = 'Needs ' + Object.keys(cv.in).map(r => GOODS[r].name.toLowerCase()).join(', ');
          v.act.anim = 'rest'; v.act.idle = true; return;
        }
        const short = Object.entries(cv.keep || {}).find(([r, n]) => res[r] - (cv.in[r] || 0) < n && this.s.buildings.some(o => this.isSite(o)));
        if (short) { b.status = `Saving ${GOODS[short[0]].name.toLowerCase()} for builders`; v.act.anim = 'rest'; v.act.idle = true; return; }
        const outRes = Object.keys(cv.out)[0];
        if (res[outRes] >= this.cap() && GOODS[outRes].capped) { b.status = 'Storage full'; v.act.anim = 'rest'; v.act.idle = true; return; }
        b.status = null; this.pay(cv.in);
      }, done: act => {
        if (!act.idle) {
          for (const [r, n] of Object.entries(cv.out)) {
            const got = this.add(r, n); this.floatGain(c.x, c.z, r, got);
            if (cv.stat) this.s.stats.produced[cv.stat] = (this.s.stats.produced[cv.stat] || 0) + got;
          }
          this.addXp(1);
        }
        this.repeat(v);
      } },
    ]);
  }

  taskSell(v, b) {
    const p = this.spot(b, 0), c = this.bCenter(b), r = this.s.res;
    this.setTask(v, 'Trading', [
      { walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] },
      { act: 5, anim: 'sell', done: () => {
        let best = null, bestQ = 0;
        for (const g of SELLABLE) {
          if (!this.s.sell[g]) continue;
          const spare = r[g] - GOODS[g].reserve;
          if (spare > bestQ) { bestQ = spare; best = g; }
        }
        if (best) {
          const n = Math.min(8, Math.floor(bestQ));
          const coins = n * GOODS[best].price;
          r[best] -= n; r.coins += coins; this.s.stats.earned += coins;
          this.track(best, -n); this.track('coins', coins);
          this.emit('float', c.x, c.z, `+${coins}`, 'coin'); this.emit('res'); this.emit('sfx', 'coin');
          b.status = null;
        } else b.status = 'Nothing to sell';
        this.repeat(v);
      } },
    ]);
  }

  taskPlant(v, b) {
    const W = this.world, c = this.bCenter(b);
    for (let tries = 0; tries < 30; tries++) {
      const a = this.rng() * Math.PI * 2, r = 2.5 + this.rng() * RANGE.forester;
      const tx = toTile(c.x + Math.cos(a) * r), tz = toTile(c.z + Math.sin(a) * r);
      if (!inMap(tx, tz)) continue;
      const i = idx(tx, tz);
      if (W.type[i] !== 0 || W.tree[i] >= 0 || W.rock[i] >= 0 || W.bush[i] >= 0 || W.occ[i] >= 0 || W.wear[i] > 0.15) continue;
      // keep the village cores open
      if (Object.keys(this.s.unlocked).some(sid => Math.hypot(tx - CENTERS[sid].x, tz - CENTERS[sid].z) < CENTERS[sid].r + 1.5)) continue;
      if (this.s.buildings.some(o => { const oc = this.bCenter(o); return o !== b && Math.hypot(oc.x - toWorld(tx), oc.z - toWorld(tz)) < 2.2; })) continue;
      return this.setTask(v, 'Planting saplings', [
        { walk: { tx, tz, adj: true } }, { face: [toWorld(tx), toWorld(tz)] },
        { act: 3, anim: 'plant', done: () => {
          if (W.tree[i] >= 0 || W.occ[i] >= 0) return;
          const t = W.addTree(tx, tz, this.rng, 0.12);
          this.emit('treeNew', W.trees.length - 1);
          this.s.stats.produced.sapling = (this.s.stats.produced.sapling || 0) + 1;
        } },
      ]);
    }
    this.setTask(v, 'Resting', [{ walk: this.goalBuilding(b) }, { act: 5, anim: 'rest' }]);
  }

  // ── world edits ──
  fellTree(ti, stump) {
    const t = this.world.trees[ti];
    if (!t.alive) return;
    this.world.removeTree(ti);
    this.emit('tree', ti);
    if (stump) { this.emit('felled', ti); this.emit('stump', t.x, t.z); }
    this.emit('tile', idx(t.tx, t.tz));
  }
  breakRock(ri) { this.world.removeRock(ri); this.emit('rock', ri); }
  clearBush(bi) { this.world.removeBush(bi); this.emit('bush', bi); }
  // stone paths: 1 stone a tile, refunded when lifted
  pave(i, on) {
    const W = this.world, s = this.s;
    if (on) {
      if (W.paved[i] || W.type[i] === T_WATER || W.block[i] || W.rock[i] >= 0) return false;
      if (!this.settlementAt(tileX(i), tileZ(i))) return false;
      if (s.res.stone < 1) return 'stone';
      s.res.stone -= 1; this.track('stone', -1);
      W.paved[i] = 1; s.stats.paved = (s.stats.paved || 0) + 1;
      if (W.tree[i] >= 0) this.fellTree(W.tree[i], false);
      if (W.bush[i] >= 0) this.clearBush(W.bush[i]);
    } else {
      if (!W.paved[i]) return false;
      W.paved[i] = 0; s.res.stone += 1;
    }
    this.emit('tile', i); this.emit('res');
    return true;
  }
  markTree(ti, on) { const t = this.world.trees[ti]; if (!t.alive) return; t.marked = on; this.emit('tree', ti); }

  workRate(v) {
    const b = v.work ? this.bById.get(v.work) : null;
    return (0.7 + this.s.happiness / 100 * 0.6) * (v.hungry ? 0.6 : 1) * (b ? 1 + (lvlOf(b) - 1) * 0.15 : 1);
  }

  // ── per-frame update ──
  tick(dt) {
    const s = this.s;
    s.time += dt;
    this.secTimer += dt;
    if (this.secTimer >= 1) { this.secTimer -= 1; this.second(); }

    for (const v of s.villagers) this.stepVillager(v, dt);
    this.merchantMove(dt);

    // farms grow on their own once sown
    for (const b of s.buildings) {
      if (b.type === 'farm' && b.built && b.data.stage === 'growing') {
        const before = b.data.grow;
        b.data.grow = Math.min(1, b.data.grow + dt / 50 * (s.weather?.rain ? 1.6 : 1));
        if (b.data.grow >= 1) { b.data.stage = 'ripe'; this.emit('farm', b); }
        else if (((before * 20) | 0) !== ((b.data.grow * 20) | 0)) this.emit('farm', b);
      }
    }
  }

  second() {
    const s = this.s, W = this.world;
    // meals
    let hungry = 0;
    for (const v of s.villagers) {
      v.hunger += 1;
      if (v.hunger >= MEAL) {
        if (s.res.food >= 1) { s.res.food -= 1; this.track('food', -1); v.hunger = 0; v.hungry = false; }
        else { v.hungry = true; v.hunger = MEAL; }
      }
      if (v.hungry) hungry++;
    }
    // happiness drifts toward a target
    const pop = s.villagers.length, housing = this.housing();
    let joy = 0;
    for (const b of s.buildings) if (isDecor(b.type)) joy += DECOR[b.type].joy;
    let target = 55 + Math.min(30, joy * 1.5) + (s.res.food > pop * 3 ? 10 : 0) - (hungry ? 15 + 30 * hungry / pop : 0) - (pop > housing ? 15 : 0);
    target = Math.max(0, Math.min(100, target));
    s.happiness += (target - s.happiness) * 0.05;
    this.merchantTick();
    s.stats.bestHappy = Math.max(s.stats.bestHappy || 0, s.happiness);
    // weather: the occasional rain shower
    const wx = s.weather || (s.weather = { rain: false, t: 60 });
    if ((wx.t -= 1) <= 0) {
      if (wx.rain) { wx.rain = false; wx.t = 180 + this.rng() * 260; wx.rainbow = 30; this.emit('weather', false); }
      else if (this.rng() < 0.5) { wx.rain = true; wx.t = 45 + this.rng() * 60; s.stats.rains = (s.stats.rains || 0) + 1; this.emit('weather', true); this.log('A gentle rain falls. Crops grow faster.'); }
      else wx.t = 90 + this.rng() * 120;
    }
    if (wx.rainbow > 0) wx.rainbow -= 1;
    // production flow history (10-second buckets)
    if (++this.flowT >= 10) { this.flowT = 0; this.flowHist.push(this.flow); this.flow = {}; if (this.flowHist.length > 6) this.flowHist.shift(); }
    // newcomers
    s.popTimer += 1;
    if (pop < housing && s.res.food >= 5 && s.happiness >= 35 && s.popTimer >= 22) {
      s.popTimer = 0;
      const sid = this.homeWithRoom();
      const e = W.entry;
      const v = this.spawnVillager(sid, toWorld(e.x), toWorld(e.z));
      this.log(`${v.name} moved to ${SETTLEMENTS.find(o => o.id === sid).name}.`);
      this.emit('toast', `${v.name.split(' ')[0]} joined the village!`, 'person');
    }
    // berries regrow
    for (let i = 0; i < W.bushes.length; i++) {
      const b = W.bushes[i];
      if (b.alive && !b.ripe && (b.regrow -= 1) <= 0) { b.ripe = true; this.emit('bush', i); }
    }
    // saplings grow
    if ((s.time | 0) % 3 === 0) for (let i = this.origTrees; i < W.trees.length; i++) {
      const t = W.trees[i];
      if (t.alive && t.growth < 1) { t.growth = Math.min(1, t.growth + 3 / 140); this.emit('tree', i); }
    }
    // footpaths slowly fade back to grass
    if ((s.time | 0) % 10 === 0) for (let i = 0; i < W.wear.length; i++) {
      if (W.road[i] || W.wear[i] <= 0) continue;
      const q = (W.wear[i] * 10) | 0;
      W.wear[i] = Math.max(0, W.wear[i] - 0.012);
      if (((W.wear[i] * 10) | 0) !== q) this.emit('tile', i);
    }
    this.emit('second');
  }

  housing() { let h = 0; for (const b of this.s.buildings) if (b.built) h += housingOf(b); return h; }
  housingIn(sid) { let h = 0; for (const b of this.s.buildings) if (b.built && b.sid === sid) h += housingOf(b); return h; }
  homeWithRoom() {
    let best = 'meadow', room = -1e9;
    for (const sid of Object.keys(this.s.unlocked)) {
      const r = this.housingIn(sid) - this.s.villagers.filter(v => v.home === sid).length;
      if (r > room) { room = r; best = sid; }
    }
    return best;
  }

  stepVillager(v, dt) {
    if (!v.task) { v.thinkCd = (v.thinkCd || 0) - dt; if (v.thinkCd > 0) return; this.think(v); if (!v.task) { v.thinkCd = 1.5; return; } }
    const t = v.task, st = t.steps[t.i];
    if (!st) { v.task = null; return; }
    const W = this.world;
    if (st.walk) {
      if (!v.path) {
        // escape a blocked tile first (e.g. a building was placed on us)
        let s = idx(toTile(v.x), toTile(v.z));
        const g = st.walk;
        const goal = g.near ? this.adjGoal(g.near) : g.adj ? (i => Math.max(Math.abs(tileX(i) - g.tx), Math.abs(tileZ(i) - g.tz)) <= 1 && W.passable(i)) : (i => tileX(i) === g.tx && tileZ(i) === g.tz);
        let pre = null;
        if (!W.passable(s) && !goal(s)) {
          const e = this.nearestPassable(s);
          if (e >= 0) { pre = s; s = e; }
        }
        let path = W.findPath(s, g.tx, g.tz, goal);
        if (!path && !t.claim) { W.relaxed = true; path = W.findPath(s, g.tx, g.tz, goal); W.relaxed = false; }
        if (!path) {
          if (t.claim) { const o = this.claimObj(t.claim); if (o) o.skipUntil = this.s.time + 240; }
          this.dropTask(v); v.thinkCd = 2; return;
        }
        if (pre !== null) path.unshift(pre);
        v.path = path; v.pathI = 1;
      }
      if (v.pathI >= v.path.length) { v.path = null; t.i++; return; }
      const ti = v.path[v.pathI];
      const arrived = this.moveToward(v, toWorld(tileX(ti)), toWorld(tileZ(ti)), dt, ti);
      if (arrived) v.pathI++;
      return;
    }
    if (st.to) { if (this.moveToward(v, st.to[0], st.to[1], dt, -1)) t.i++; return; }
    if (st.face) { v.face = Math.atan2(st.face[0] - v.x, st.face[1] - v.z); t.i++; return; }
    if (st.fn) { st.fn(); t.i++; if (t.i >= t.steps.length) v.task = null; return; }
    if (st.act) {
      if (!v.act) { v.act = { t: 0, dur: st.act, anim: st.anim }; st.start?.(); }
      v.act.t += dt * (v.act.idle ? 1 : this.workRate(v));
      if (v.act.t >= v.act.dur) {
        const act = v.act;
        v.act = null; t.again = false;
        st.done?.(act);
        if (v.task !== t || t.again) return;          // replaced, dropped or repeating
        t.i++;
        if (t.i >= t.steps.length) { v.task = null; if (t.claim) this.releaseClaim(v, t.claim); }
      }
    }
  }
  nearestPassable(s) {
    const W = this.world, sx = tileX(s), sz = tileZ(s);
    for (let r = 1; r <= 5; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !inMap(sx + dx, sz + dz)) continue;
      const i = idx(sx + dx, sz + dz);
      if (W.passable(i)) return i;
    }
    return -1;
  }
  claimObj([k, i]) { return k === 't' ? this.world.trees[i] : k === 'r' ? this.world.rocks[i] : this.world.bushes[i]; }
  releaseClaim(v, [k, i]) {
    const o = k === 't' ? this.world.trees[i] : k === 'r' ? this.world.rocks[i] : this.world.bushes[i];
    if (o && o.claimed === v.id) o.claimed = -1;
  }
  adjGoal(b) {
    const [w, d] = footprint(b.type, b.rot), W = this.world;
    return i => {
      const x = tileX(i), z = tileZ(i);
      return x >= b.tx - 1 && x <= b.tx + w && z >= b.tz - 1 && z <= b.tz + d && W.passable(i);
    };
  }

  moveToward(v, x, z, dt, ti) {
    const W = this.world;
    const dx = x - v.x, dz = z - v.z, dist = Math.hypot(dx, dz);
    const cur = idx(toTile(v.x), toTile(v.z));
    const speed = 1.7 * (W.paved[cur] ? 1.5 : 1 + Math.min(W.wear[cur] || 0, 1) * 0.35) * (v.hungry ? 0.7 : 1) * (0.85 + this.s.happiness / 100 * 0.3);
    const step = speed * dt;
    v.face = Math.atan2(dx, dz);
    v.moving = true;
    if (dist <= step) {
      v.x = x; v.z = z;
      if (ti >= 0) this.wearTile(ti);
      return true;
    }
    v.x += dx / dist * step; v.z += dz / dist * step;
    return false;
  }
  wearTile(i) {
    const W = this.world;
    if (W.road[i] || W.occ[i] >= 0 || W.type[i] === T_WATER) return;
    const q = (W.wear[i] * 10) | 0;
    W.wear[i] = Math.min(1.4, W.wear[i] + 0.035);
    if (((W.wear[i] * 10) | 0) !== q) this.emit('tile', i);
  }

  // ── quests ──
  questProgress(q) {
    const st = this.s.stats;
    switch (q.kind) {
      case 'build': return st.built[q.key] || 0;
      case 'job': return this.s.villagers.filter(v => v.job === q.key).length;
      case 'produce': return st.produced[q.key] || 0;
      case 'pop': return this.s.villagers.length;
      case 'earn': return st.earned;
      case 'decor': return st.decor;
      case 'unlock': return this.s.unlocked[q.key] ? 1 : 0;
    }
    return 0;
  }
  activeQuests() {
    return QUESTS.filter(q => !this.s.quests.claimed.includes(q.id)).slice(0, 3)
      .map(q => ({ q, p: Math.min(q.n, this.questProgress(q)), done: this.questProgress(q) >= q.n }));
  }
  claim(qid) {
    const q = QUESTS.find(o => o.id === qid);
    if (!q || this.s.quests.claimed.includes(qid) || this.questProgress(q) < q.n) return false;
    this.s.quests.claimed.push(qid);
    const r = q.reward;
    if (r.gems) this.s.res.gems += r.gems;
    if (r.coins) this.s.res.coins += r.coins;
    if (r.xp) this.addXp(r.xp);
    this.emit('res'); this.emit('sfx', 'coin');
    this.log(`Quest complete: ${q.title}.`);
    return true;
  }

  // ── achievements ──
  achStat(stat) {
    const s = this.s, st = s.stats;
    switch (stat) {
      case 'buildings': return Object.values(st.built).reduce((a, b) => a + b, 0);
      case 'saplings': return st.produced.sapling || 0;
      case 'bread': return st.produced.bread || 0;
      case 'pop': return s.villagers.length;
      case 'happy': return Math.round(st.bestHappy || s.happiness);
      case 'settled': return Object.keys(s.unlocked).length;
      case 'day': return Math.floor(s.time / DAY) + 1;
      default: return st[stat] || 0;
    }
  }
  achievements() {
    const got = this.s.achieved || (this.s.achieved = []);
    return ACHIEVEMENTS.map(a => ({ a, p: Math.min(a.n, this.achStat(a.stat)), done: this.achStat(a.stat) >= a.n, claimed: got.includes(a.id) }));
  }
  claimAch(id) {
    const a = ACHIEVEMENTS.find(o => o.id === id), got = this.s.achieved || (this.s.achieved = []);
    if (!a || got.includes(id) || this.achStat(a.stat) < a.n) return false;
    got.push(id); this.s.res.gems += a.gems;
    this.log(`Achievement: ${a.name}!`); this.emit('res'); this.emit('sfx', 'level');
    return true;
  }

  // ── travelling merchant ──
  merchantTick() {
    const s = this.s, m = s.merchant || (s.merchant = { state: 'away', t: 200 });
    m.t -= 1;
    if (m.state === 'away' && m.t <= 0 && s.level >= 2) {
      const pool = [...MERCHANT_OFFERS], offers = [];
      while (offers.length < 3) offers.push({ ...pool.splice(Math.floor(this.rng() * pool.length), 1)[0], bought: false });
      const e = this.world.entry, c = CENTERS.meadow;
      Object.assign(m, { state: 'arriving', t: 120, offers, x: toWorld(e.x), z: toWorld(e.z), path: null, i: 1 });
      const goal = this.world.findPath(idx(e.x, e.z), c.x + 5, c.z + 3, i => Math.hypot(tileX(i) - (c.x + 5), tileZ(i) - (c.z + 3)) < 2.5 && this.world.passable(i));
      m.path = goal || [idx(e.x, e.z)];
      this.emit('merchant', 'arriving');
    } else if (m.state === 'here' && m.t <= 0) {
      m.state = 'leaving'; m.path.reverse(); m.i = 1; this.emit('merchant', 'leaving');
    }
  }
  merchantMove(dt) {
    const m = this.s.merchant;
    if (!m || (m.state !== 'arriving' && m.state !== 'leaving')) return;
    if (m.i >= m.path.length) {
      if (m.state === 'arriving') { m.state = 'here'; m.t = 120; this.emit('merchant', 'here'); this.emit('toast', 'A travelling merchant has arrived!', 'shop'); this.log('A travelling merchant set up shop by the campfire.'); }
      else { m.state = 'away'; m.t = 360 + this.rng() * 240; this.emit('merchant', 'away'); }
      return;
    }
    const ti = m.path[m.i], tx = toWorld(tileX(ti)), tz = toWorld(tileZ(ti));
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz), step = dt * 2.2;
    m.face = Math.atan2(dx, dz);
    if (d <= step) { m.x = tx; m.z = tz; m.i++; } else { m.x += dx / d * step; m.z += dz / d * step; }
  }
  merchantDeal(k) {
    const m = this.s.merchant, o = m?.offers?.[k];
    if (!o || o.bought || m.state !== 'here' || !this.canAfford(o.give)) return false;
    this.pay(o.give);
    for (const [r, n] of Object.entries(o.get)) { if (GOODS[r].capped) this.add(r, n, false); else this.s.res[r] += n; }
    o.bought = true; this.s.stats.deals = (this.s.stats.deals || 0) + 1;
    this.emit('res'); this.emit('sfx', 'coin');
    return true;
  }

  // ── save / load ──
  serialize() {
    const W = this.world;
    const alive = new Uint8Array(Math.ceil(this.origTrees / 8));
    for (let i = 0; i < this.origTrees; i++) if (W.trees[i].alive) alive[i >> 3] |= 1 << (i & 7);
    const planted = [];
    for (let i = this.origTrees; i < W.trees.length; i++) { const t = W.trees[i]; if (t.alive) planted.push([t.tx, t.tz, +t.growth.toFixed(3)]); }
    const wear = new Uint8Array(W.wear.length);
    for (let i = 0; i < wear.length; i++) wear[i] = Math.min(255, Math.round(W.wear[i] * 180));
    const marked = []; W.trees.forEach((t, i) => { if (t.alive && t.marked && i < this.origTrees) marked.push(i); });
    const villagers = this.s.villagers.map(v => ({ ...v, task: null, act: null, path: null, moving: false }));
    return {
      ...this.s, villagers,
      world: {
        alive: b64(alive), planted, marked, wear: b64(wear),
        paved: [...W.paved.keys()].filter(i => W.paved[i]),
        rocks: W.rocks.map(r => r.alive ? r.hp : 0),
        bushes: W.bushes.map(b => b.alive ? (b.ripe ? -1 : Math.round(b.regrow)) : -2),
      },
    };
  }
  load(save) {
    const W = this.world;
    const { world, ...s } = save;
    this.s = s;
    const alive = unb64(world.alive);
    for (let i = 0; i < this.origTrees; i++) if (!(alive[i >> 3] & (1 << (i & 7)))) W.removeTree(i);
    for (const i of world.marked || []) if (W.trees[i]) W.trees[i].marked = true;
    for (const [tx, tz, g] of world.planted) W.addTree(tx, tz, this.rng, g);
    const wear = unb64(world.wear);
    for (let i = 0; i < wear.length; i++) W.wear[i] = W.road[i] ? 1 : wear[i] / 180;
    for (const i of world.paved || []) W.paved[i] = 1;
    world.rocks.forEach((hp, i) => { if (hp <= 0) W.removeRock(i); else W.rocks[i].hp = hp; });
    world.bushes.forEach((v, i) => { const b = W.bushes[i]; if (v === -2) W.removeBush(i); else if (v >= 0) { b.ripe = false; b.regrow = v; } });
    for (const b of s.buildings) {
      this.bById.set(b.id, b);
      const [w, d] = footprint(b.type, b.rot);
      for (let z = b.tz; z < b.tz + d; z++) for (let x = b.tx; x < b.tx + w; x++) { W.occ[idx(x, z)] = b.id; if (!isDecor(b.type)) W.block[idx(x, z)] = 1; }
    }
    for (const v of s.villagers) { this.vById.set(v.id, v); v.task = null; v.act = null; }
    if (s.tutorial === undefined || s.buildings.length > 4) s.tutorial = 99;
  }
}

function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(str) { const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

export { DAY };
