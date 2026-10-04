// Game rules and simulation: economy, villager brains, construction,
// population, quests, levels, saving. No DOM or Three.js in here — the
// view layer listens to events emitted from this class.
import { World, N, idx, tileX, tileZ, toWorld, toTile, inMap, CENTERS, T_WATER } from './world.js';
import { BUILDINGS, DECOR, GOODS, SELLABLE, QUESTS, SETTLEMENTS, ACHIEVEMENTS, MERCHANT_OFFERS, SYNERGY, CROPS, SPELLS, BEASTS, xpForLevel,
  SEASONS, SEASON_DAYS, FESTIVALS, RARE,
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
  herder: { in: { grain: 1 }, out: { food: 5 }, t: 8, anim: 'gather', stat: 'eggs' },
  weaver: { in: { wool: 2 }, out: { cloth: 1 }, t: 7, anim: 'work' },
  cheesemaker: { in: { milk: 2 }, out: { cheese: 1 }, t: 7, anim: 'work' },
  brewer: { in: { grain: 2 }, out: { ale: 1 }, t: 8, anim: 'work' },
};
// staffed producers that need no inputs: the worker potters around the pen
const PRODUCE = {
  shepherd:  { out: { wool: 3 },  t: 12, anim: 'hoe',    label: 'Shearing sheep' },
  milker:    { out: { milk: 3 },  t: 10, anim: 'gather', label: 'Milking cows' },
  picker:    { out: { food: 6 },  t: 9,  anim: 'gather', label: 'Picking apples', stat: 'apples' },
  beekeeper: { out: { honey: 2 }, t: 12, anim: 'work',   label: 'Tending the hives' },
};
export const YEAR = 180;             // sim seconds per year of villager age
const ADULT = 14, RETIRE = 66, OLD = 72;
export const stageOf = v => v.age < ADULT ? 'child' : v.age >= RETIRE ? 'elder' : 'adult';
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
    this.bflow = new Map(); this.bflowHist = [];
    if (save) this.load(save); else this.newGame(seed);
  }
  on(name, fn) { this.handlers[name] = fn; }
  emit(name, ...a) { this.handlers[name]?.(...a); }

  // ── setup ──
  newGame(seed) {
    this.s = {
      v: 1, seed, time: DAY * 0.3, speed: 1, nextId: 1,
      res: { ...Object.fromEntries(Object.keys(GOODS).map(k => [k, 0])), coins: 150, wood: 120, stone: 30, food: 60, gems: 15 },
      magic: { mana: 0, known: [], study: 0, cds: {} }, beasts: [],
      xp: 0, level: 1, happiness: 70,
      buildings: [], villagers: [], unlocked: {},
      quests: { claimed: [] }, stats: { built: {}, produced: {}, earned: 0, decor: 0 },
      sell: Object.fromEntries(SELLABLE.map(k => [k, k === 'food' || k === 'grain'])),
      log: [], popTimer: 0, tutorial: 0, weather: { rain: false, t: 150 },
      chests: [], chestTimer: 150, tokens: {}, names: {},
    };
    this.unlock('meadow', true);
    const c = CENTERS.meadow;
    this.carveLane(this.addBuilding('cottage', c.x + 2, c.z - 4, 0, true));
    // a lived-in camp from the first frame
    for (const [t, x, z, r] of [['bench', -3, 1, 1], ['bench', 1, 2, 0], ['hay', -3, -2, 0], ['flowers', 4, -1, 0], ['fence', 4, -5, 0], ['fence', 5, -5, 0], ['sign', -2, 3, 0], ['lantern', 2, 0, 0]])
      if (this.checkPlace(t, c.x + x, c.z + z, r, -2).ok) this.addBuilding(t, c.x + x, c.z + z, r, true);
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
      this.log(`${this.sname(sid)} has been settled! Two settlers moved in.`);
      this.emit('toast', `${this.sname(sid)} settled!`, 'map');
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
  // per-building flow, so a building's panel can show what it really makes and uses
  credit(b, res, n) {
    if (!b || !n) return;
    let f = this.bflow.get(b.id); if (!f) this.bflow.set(b.id, f = {});
    f[res] = (f[res] || 0) + n;
  }
  bRate(b, res) {
    if (!this.bflowHist.length) return 0;
    let sum = 0; for (const h of this.bflowHist) sum += h.get(b.id)?.[res] || 0;
    return sum * 60 / (this.bflowHist.length * 10);
  }
  // ── names ──
  sname(sid) { return this.s.names?.[sid] || SETTLEMENTS.find(o => o.id === sid)?.name || 'the wilds'; }
  cleanName(n) { return String(n || '').replace(/[<>&"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 22); }
  renameSettlement(sid, name) {
    const n = this.cleanName(name); if (!n) return false;
    (this.s.names || (this.s.names = {}))[sid] = n;
    this.emit('settlements'); return true;
  }
  renameVillager(v, name) {
    const n = this.cleanName(name); if (!n || !v) return false;
    v.name = n.includes(' ') ? n : `${n} ${v.name.split(' ').slice(1).join(' ')}`.trim();
    return true;
  }

  // ── the calendar: seasons and festivals ──
  dayNum() { return Math.floor(this.s.time / DAY); }                 // 0-based
  seasonIdx(t = this.s.time) { return Math.floor(Math.floor(t / DAY) / SEASON_DAYS) % 4; }
  season() { return SEASONS[this.seasonIdx()]; }
  seasonDay() { return this.dayNum() % SEASON_DAYS; }                   // 0..2
  // how much snow lies on the ground: settles over the first half-day of winter, melts in early spring
  snowLevel(t = this.s.time) {
    const len = DAY * SEASON_DAYS, into = t % len, si = this.seasonIdx(t);
    if (si === 3) return Math.min(1, into / (DAY * 0.45));
    if (si === 0 && t >= len * 4) return Math.max(0, 1 - into / (DAY * 0.55));   // no melt before the first winter
    return 0;
  }
  festivalToday() { return this.seasonDay() === 1 ? FESTIVALS[this.season().id] : null; }
  festivalActive() { const f = this.dayFrac(); return f >= 0.72 && f < 0.925 && this.festivalToday(); }
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
    if (ignoreId === -1) {   // -2 = free starter props: no cost or level check
      if (def.rare && !(this.s.tokens?.[type] > 0)) return { ok: false, why: 'Found only in gift chests' };
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
    if (def.rare) this.s.tokens[type]--;
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
      if (type === 'palisade') W.wall[i] = 1;
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
    if (L === 1) out.planks = (out.planks || 0) + 20; else { out.bricks = (out.bricks || 0) + 20; out.cloth = 6; }
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
    this.log(`${def.name} finished in ${this.sname(b.sid)}.`);
    // auto-staff one worker if anyone is free
    if (def.workers) this.assign(b, null);
    this.carveLane(b);
  }

  // wear a dirt lane from a building's door to its settlement's campfire
  carveLane(b) {
    if (isDecor(b.type) || b.type === 'campfire') return;
    const W = this.world, fire = this.s.buildings.find(o => o.type === 'campfire' && o.sid === b.sid);
    if (!fire) return;
    const [ex, ez] = this.entryTile(b);
    if (!inMap(ex, ez)) return;
    const goal = this.adjGoal(fire);
    const path = W.findPath(idx(ex, ez), fire.tx, fire.tz, goal, 4000);
    if (!path) return;
    for (const i of path) {
      if (W.occ[i] >= 0 || W.type[i] === T_WATER || W.road[i] || W.paved[i]) continue;
      W.lane[i] = 1; W.wear[i] = Math.max(W.wear[i], 0.85);
      this.emit('tile', i);
    }
  }

  demolish(b) {
    if (b.type === 'campfire') return;
    const def = defOf(b.type), W = this.world;
    for (const vid of [...b.workers]) this.unassign(this.vById.get(vid));
    for (const [k, v] of Object.entries(def.cost || {})) this.s.res[k] += Math.floor(v * (b.built ? 0.5 : 1));
    if (def.rare) this.s.tokens[b.type] = (this.s.tokens[b.type] || 0) + 1;   // treasures go back in your pocket
    const [w, d] = footprint(b.type, b.rot);
    for (let z = b.tz; z < b.tz + d; z++) for (let x = b.tx; x < b.tx + w; x++) { W.occ[idx(x, z)] = -1; W.block[idx(x, z)] = 0; W.wall[idx(x, z)] = 0; this.emit('tile', idx(x, z)); }
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
  spawnVillager(sid, x, z, o = {}) {
    const r = this.rng;
    const v = {
      id: this.s.nextId++, name: `${pick(r, FIRST_NAMES)} ${o.last || pick(r, LAST_NAMES)}`,
      age: o.age ?? 18 + r() * 22, partner: null, parents: o.parents || [], kids: [], edu: 0,
      shirt: pick(r, SHIRTS), skin: pick(r, SKINS), hair: pick(r, HAIRS), hat: r() < 0.35, hatColor: pick(r, [0xc9a050, 0x8a5a33, 0x3f7a39, 0xd9534f]),
      x, z, home: sid, job: 'idle', work: null, carry: null, hunger: r() * MEAL * 0.6, hungry: false,
      task: null, act: null, face: 0,
    };
    if (o.look) Object.assign(v, o.look);
    if (v.age < ADULT) v.job = 'child';
    this.s.villagers.push(v); this.vById.set(v.id, v);
    this.emit('villager', v);
    return v;
  }

  assign(b, v) {
    const def = defOf(b.type);
    if (!def.workers || b.workers.length >= workersOf(b) || !b.built) return false;
    if (!v) {
      const c = this.bCenter(b);
      const idle = this.s.villagers.filter(o => o.job === 'idle' && stageOf(o) === 'adult');
      if (!idle.length) return false;
      idle.sort((a, o) => (a.home !== b.sid) - (o.home !== b.sid) || Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(o.x - c.x, o.z - c.z));
      v = idle[0];
    }
    if (stageOf(v) !== 'adult') return false;
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
    for (const b of open) while (b.workers.length < workersOf(b) && s.villagers.some(v => v.job === 'idle' && stageOf(v) === 'adult')) { if (!this.assign(b, null)) break; n++; }
    return n;
  }
  unassign(v) {
    const rest = v && (stageOf(v) === 'child' ? 'child' : stageOf(v) === 'elder' ? 'retired' : 'idle');
    if (!v || !v.work) { if (v) v.job = rest; return; }
    const b = this.bById.get(v.work);
    if (b) { b.workers = b.workers.filter(id => id !== v.id); this.emit('building', b); }
    v.work = null; v.job = rest;
    this.dropTask(v);
    this.emit('villagerJob', v);
  }

  dropTask(v) {
    const t = v.task;
    if (t?.claim) { const [k, i] = t.claim; const o = k === 't' ? this.world.trees[i] : k === 'r' ? this.world.rocks[i] : this.world.bushes[i]; if (o && o.claimed === v.id) o.claimed = -1; }
    v.task = null; v.act = null; v.path = null;
    v.asleep = null; v.indoors = false; v.dancing = false; v.onTower = false;
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
    if (this.sleepy(v) && job !== 'guard') return this.taskSleep(v);
    if (this.festivalActive() && this.s.buildings.some(o => o.type === 'campfire' && o.sid === v.home)) return this.taskFestival(v);
    if (job === 'child') return this.thinkChild(v);
    if (job === 'retired') return this.thinkRetired(v);
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
    if (PRODUCE[job]) return this.taskProduce(v, b, PRODUCE[job]);
    if (job === 'innkeeper') return this.taskTavern(v, b);
    if (job === 'teacher') return this.taskTeach(v, b);
    if (job === 'guard') return this.taskGuard(v, b);
    if (job === 'wizard') return this.taskStudy(v, b);
  }

  // ── night: everyone but the guards turns in ──
  dayFrac() { return (this.s.time % DAY) / DAY; }
  isNight() { const f = this.dayFrac(); return f >= 0.935 || f < 0.225; }
  sleepy(v) { const f = this.dayFrac(); return v.age < ADULT ? (f >= 0.9 || f < 0.24) : this.isNight(); }
  // beds: houses in the settlement fill up in villager order; the rest sleep by the fire
  bedFor(v) {
    const s = this.s, key = (s.time / 5) | 0;
    if (this._beds?.key !== key) {
      const map = new Map();
      for (const sid of Object.keys(s.unlocked)) {
        const houses = s.buildings.filter(b => b.built && b.sid === sid && (b.type === 'cottage' || b.type === 'tiled')).sort((a, b) => a.id - b.id);
        const slots = []; for (const h of houses) for (let k = 0; k < housingOf(h); k++) slots.push(h);
        const fire = s.buildings.find(b => b.type === 'campfire' && b.sid === sid);
        s.villagers.filter(o => o.home === sid).sort((a, b) => a.id - b.id).forEach((o, i) => map.set(o.id, { b: slots[i] || fire, n: slots[i] ? 0 : i - slots.length }));
      }
      this._beds = { key, map };
    }
    return this._beds.map.get(v.id) || { b: s.buildings.find(o => o.type === 'campfire'), n: 0 };
  }
  taskSleep(v) {
    const { b, n } = this.bedFor(v);
    if (!b) return this.thinkIdle(v);
    const wake = () => !this.sleepy(v);
    if (b.type === 'campfire') {
      const c = this.bCenter(b), a = n * 2.39 + 0.6, r = 1.35 + (n > 5 ? 0.6 : 0);
      const px = c.x + Math.cos(a) * r, pz = c.z + Math.sin(a) * r;
      return this.setTask(v, 'Sleeping by the fire', [{ walk: this.goalBuilding(b) }, { to: [px, pz] }, { face: [c.x, c.z] },
        { act: 9999, anim: 'sleep', until: wake, start: () => { v.asleep = 'fire'; }, done: () => { v.asleep = null; } }]);
    }
    const [ex, ez] = this.entryTile(b), door = this.local(b, 0, this.bCenter(b).d / 2 - 0.2);
    this.setTask(v, 'Asleep at home', [{ walk: { tx: ex, tz: ez } }, { to: [door.x, door.z] },
      { act: 9999, anim: 'sleep', until: wake, start: () => { v.asleep = 'home'; v.indoors = true; }, done: () => { v.asleep = null; v.indoors = false; } }]);
  }

  // festival evening: everyone gathers in rings round their campfire and dances
  taskFestival(v) {
    const s = this.s, fire = s.buildings.find(o => o.type === 'campfire' && o.sid === v.home);
    const folk = s.villagers.filter(o => o.home === v.home).sort((a, b) => a.id - b.id), k = Math.max(0, folk.indexOf(v));
    const inner = Math.min(10, Math.ceil(folk.length / 2)), ring = k < inner ? 0 : 1, n = ring ? folk.length - inner : inner, j = ring ? k - inner : k;
    const c = this.bCenter(fire), W = this.world;
    let px = c.x, pz = c.z + 2;
    // a spot on the ring that isn't inside a building (nudge round, then in or out)
    search: for (const dr of [0, -0.5, 0.6, 1.2]) for (const da of [0, 0.25, -0.25, 0.5, -0.5]) {
      const a = (j + da) / Math.max(1, n) * Math.PI * 2 + ring * 0.3, r = 2.0 + ring * 0.9 + dr;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r, i = idx(toTile(x), toTile(z));
      if (inMap(toTile(x), toTile(z)) && W.passable(i) && !W.block[i]) { px = x; pz = z; break search; }
    }
    const fest = this.festivalToday();
    this.setTask(v, `Celebrating the ${fest?.name ?? 'festival'}`, [{ walk: this.goalBuilding(fire) }, { to: [px, pz] }, { face: [c.x, c.z] },
      { act: 9999, anim: 'dance', until: () => !this.festivalActive() || this.sleepy(v), start: () => { v.dancing = true; }, done: () => { v.dancing = false; } }]);
  }
  // the festival's evening has ended: feast, rewards, a lasting glow
  endFestival(fest) {
    const s = this.s, pop = s.villagers.length;
    const feast = Math.min(s.res.food, pop * 2);
    s.res.food -= feast; this.track('food', -feast);
    const treats = [];
    for (const k of ['ale', 'cheese', 'honey']) { const n = Math.min(s.res[k], Math.ceil(pop / 3)); if (n > 0) { s.res[k] -= n; this.track(k, -n); treats.push(GOODS[k].name.toLowerCase()); } }
    const extra = treats.length;
    s.festJoy = DAY * (1 + extra * 0.25);
    const coins = 20 + pop * 6, gems = 5;
    s.res.coins += coins; s.res.gems += gems;
    s.stats.festivals = (s.stats.festivals || 0) + 1;
    this.addXp(40 + pop * 2);
    this.log(`The ${fest.name} was a joy! Everyone feasted${extra ? ' on ' + treats.join(' and ') : ''}. +${coins} coins, +${gems} gems.`);
    this.emit('toast', `What a ${fest.name}! +${coins} coins · +${gems} gems · everyone is happier`, fest.icon);
    this.emit('festivalEnd', fest, { coins, gems });
    this.emit('res');
  }

  // ── guards and wizards ──
  taskGuard(v, b) {
    const c = this.bCenter(b), night = this.isNight();
    const k = b.workers.indexOf(v.id), a = this.rng() * Math.PI * 2, r = night ? 0.2 : 1.2 + this.rng() * 1.5;
    const p = night ? this.local(b, k ? 0.3 : -0.3, 0.1) : { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
    this.setTask(v, night ? 'On night watch' : 'Keeping watch', [{ walk: this.goalBuilding(b) }, { to: [p.x, p.z], onTower: night }, { act: 6, anim: 'rest', start: () => { v.onTower = night; } , done: () => { v.onTower = false; } }]);
  }
  manaCap() { let c = 0; for (const b of this.s.buildings) if (b.type === 'wizard' && b.built) c += 60 + 40 * (lvlOf(b) - 1); return c; }
  taskStudy(v, b) {
    const p = this.spot(b, b.workers.indexOf(v.id)), c = this.bCenter(b), m = this.s.magic;
    this.setTask(v, 'Studying the arcane', [{ walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] },
      { act: 10, anim: 'cast', done: () => {
        const rate = this.workRate(v);
        m.mana = Math.min(this.manaCap(), m.mana + 3 * rate);
        const next = SPELLS.find(sp => !m.known.includes(sp.id));
        if (next) {
          m.study += 4 * rate;
          if (m.study >= next.study) {
            m.study = 0; m.known.push(next.id);
            this.log(`Your wizards learned a new spell: ${next.name}.`);
            this.emit('toast', `New spell learned: ${next.name}!`, 'staff'); this.emit('sfx', 'level');
          }
        }
        this.emit('float', c.x, c.z, `+${Math.round(3 * rate)}`, 'staff');
        this.repeat(v);
      } }]);
  }
  canCast(id) {
    const m = this.s.magic, sp = SPELLS.find(o => o.id === id);
    if (!sp || !m.known.includes(id)) return { ok: false, why: 'Not learned yet' };
    if ((m.cds[id] || 0) > this.s.time) return { ok: false, why: `Ready in ${Math.ceil(m.cds[id] - this.s.time)}s` };
    if (m.mana < sp.cost) return { ok: false, why: 'Not enough mana' };
    if (id === 'transmute' && this.s.res.stone < 60) return { ok: false, why: 'Needs 60 stone' };
    return { ok: true };
  }
  cast(id) {
    if (!this.canCast(id).ok) return false;
    const s = this.s, m = s.magic, sp = SPELLS.find(o => o.id === id), W = this.world;
    m.mana -= sp.cost; m.cds[id] = s.time + sp.cd;
    s.stats.spells = (s.stats.spells || 0) + 1;
    if (id === 'harvest') for (const b of s.buildings) { if (b.type === 'farm' && b.data.stage === 'growing') { b.data.grow = 1; b.data.stage = 'ripe'; this.emit('farm', b); } }
    if (id === 'rain') { s.weather = { rain: true, t: 70 }; this.emit('weather', true); }
    if (id === 'haste') s.hasteUntil = s.time + 90;
    if (id === 'ward') { s.wardUntil = s.time + DAY * 3; for (const bst of s.beasts) bst.state = 'flee'; }
    if (id === 'bloom') {
      W.bushes.forEach((b, i) => { if (b.alive && !b.ripe) { b.ripe = true; this.emit('bush', i); } });
      let planted = 0;
      for (const sid of Object.keys(s.unlocked)) {
        const c = CENTERS[sid], R = this.settlementRadius(sid);
        for (let k = 0; k < 60 && planted < 18; k++) {
          const a = this.rng() * Math.PI * 2, r = R + 1 + this.rng() * 6;
          const tx = Math.round(c.x + Math.cos(a) * r), tz = Math.round(c.z + Math.sin(a) * r);
          if (!inMap(tx, tz)) continue;
          const i = idx(tx, tz);
          if (W.type[i] !== 0 || W.tree[i] >= 0 || W.occ[i] >= 0 || W.rock[i] >= 0 || W.wear[i] > 0.2 || W.paved[i]) continue;
          W.addTree(tx, tz, this.rng, 0.35); this.emit('treeNew', W.trees.length - 1); planted++;
        }
      }
    }
    if (id === 'transmute') { s.res.stone -= 60; s.res.gems += 4; }
    this.log(`Your wizards cast ${sp.name}!`);
    this.emit('spell', id); this.emit('res');
    return true;
  }

  // ── beasts that prowl at night, and the defences that drive them off ──
  beastNight() {
    const s = this.s, day = Math.floor(s.time / DAY) + 1;
    if (day < 3 || (s.wardUntil || 0) > s.time) return;
    for (const sid of Object.keys(s.unlocked)) {
      if (this.rng() > Math.min(0.8, 0.2 + day * 0.04 + (this.seasonIdx() === 3 ? 0.1 : 0))) continue;
      const kinds = Object.entries(BEASTS).filter(([, b]) => b.lvl <= s.level).map(([k]) => k);
      const kind = kinds[(this.rng() * kinds.length) | 0], n = 1 + ((this.rng() * Math.min(3, 1 + day / 6)) | 0);
      const c = CENTERS[sid];
      for (let tries = 0; tries < 30; tries++) {
        const a = this.rng() * Math.PI * 2, r = this.settlementRadius(sid) + 9 + this.rng() * 5;
        const tx = Math.round(c.x + Math.cos(a) * r), tz = Math.round(c.z + Math.sin(a) * r);
        if (!inMap(tx, tz) || !this.world.passable(idx(tx, tz))) continue;
        for (let k = 0; k < n; k++) this.spawnBeast(kind, sid, toWorld(tx) + (k - n / 2) * 0.6, toWorld(tz) + k * 0.4);
        this.log(`${n > 1 ? `${n} ${BEASTS[kind].name.toLowerCase()}s are` : `A ${BEASTS[kind].name.toLowerCase()} is`} prowling toward ${this.sname(sid)}!`);
        this.emit('toast', `${BEASTS[kind].name}${n > 1 ? 's' : ''} spotted near ${this.sname(sid)}!`, 'alert');
        this.emit('sfx', 'howl');
        break;
      }
    }
  }
  spawnBeast(kind, sid, x, z) {
    const s = this.s, def = BEASTS[kind];
    const targets = s.buildings.filter(b => b.built && b.sid === sid && (def.farm ? b.type === 'farm' : ['storehouse', 'campfire', 'market'].includes(b.type)));
    const fire = s.buildings.find(b => b.type === 'campfire' && b.sid === sid);
    const target = targets.length ? targets[(this.rng() * targets.length) | 0] : fire;
    if (!target) return;
    const bst = { id: s.nextId++, kind, sid, x, z, hp: def.hp, state: 'prowl', target: target.id, path: null, pi: 1, t: 0, face: 0 };
    s.beasts.push(bst);
    this.emit('beast', bst);
  }
  stepBeasts(dt) {
    const s = this.s, W = this.world;
    for (const bst of s.beasts) {
      const def = BEASTS[bst.kind];
      bst.t += dt;
      if (bst.state === 'prowl' && (bst.t > 90 || !this.isNight() && bst.t > 20)) { bst.state = 'flee'; bst.path = null; }
      if (!bst.path) {
        const from = idx(toTile(bst.x), toTile(bst.z));
        let goal, gx, gz;
        if (bst.state === 'flee') {
          const c = CENTERS[bst.sid], a = Math.atan2(bst.z - toWorld(c.z), bst.x - toWorld(c.x));
          gx = Math.max(1, Math.min(N - 2, Math.round(c.x + Math.cos(a) * 34))); gz = Math.max(1, Math.min(N - 2, Math.round(c.z + Math.sin(a) * 34)));
          goal = i => Math.hypot(tileX(i) - gx, tileZ(i) - gz) < 3;
        } else {
          const tb = this.bById.get(bst.target);
          if (!tb) { bst.state = 'flee'; continue; }
          gx = tb.tx; gz = tb.tz; goal = this.adjGoal(tb);
        }
        W.beastMode = true; bst.path = bst.state === 'flee' ? null : W.findPath(from, gx, gz, goal, 6000); W.beastMode = false;
        bst.pi = 1;
        if (bst.state === 'flee') { bst.runTo = [toWorld(gx), toWorld(gz)]; bst.path = []; }
        if (!bst.path) {
          // walls in the way: the beast paces, then gives up
          bst.path = []; if (bst.state === 'prowl' && bst.t > 25) { bst.state = 'flee'; s.stats.fended = (s.stats.fended || 0) + 1; this.emit('beastFled', bst, 'walls'); }
          continue;
        }
      }
      if (bst.state === 'flee' && bst.runTo) {
        // bolt straight for the treeline, then vanish into the forest
        const dx = bst.runTo[0] - bst.x, dz = bst.runTo[1] - bst.z, d = Math.hypot(dx, dz), stp = def.speed * 1.4 * dt;
        bst.face = Math.atan2(dx, dz);
        if (d <= stp || bst.t > 140) bst.gone = true; else { bst.x += dx / d * stp; bst.z += dz / d * stp; }
        continue;
      }
      if (bst.pi >= bst.path.length) {
        if (bst.state === 'flee') { bst.gone = true; continue; }
        this.beastArrives(bst); continue;
      }
      const ti = bst.path[bst.pi], tx = toWorld(tileX(ti)), tz = toWorld(tileZ(ti));
      const dx = tx - bst.x, dz = tz - bst.z, d = Math.hypot(dx, dz), stp = def.speed * dt * (bst.state === 'flee' ? 1.3 : 1);
      bst.face = Math.atan2(dx, dz);
      if (d <= stp) { bst.x = tx; bst.z = tz; bst.pi++; } else { bst.x += dx / d * stp; bst.z += dz / d * stp; }
    }
    s.beasts = s.beasts.filter(b => { if (b.gone) this.emit('beastGone', b); return !b.gone; });
  }
  beastArrives(bst) {
    const s = this.s, def = BEASTS[bst.kind], tb = this.bById.get(bst.target), sname = this.sname(bst.sid);
    if (def.farm && tb?.data) { tb.data.grow = 0; tb.data.stage = 'empty'; this.emit('farm', tb); this.log(`A boar trampled a field in ${sname}.`); this.emit('toast', 'A boar trampled a field!', 'alert'); }
    if (def.steals) {
      const [res, n] = Object.entries(def.steals)[0], took = Math.min(s.res[res], n);
      s.res[res] -= took; this.emit('res');
      this.log(`A ${def.name.toLowerCase()} ${def.verb} ${took} ${GOODS[res].name.toLowerCase()} in ${sname}.`);
      if (tb) this.emit('float', this.bCenter(tb).x, this.bCenter(tb).z, `-${took}`, GOODS[res].icon);
    }
    s.happiness = Math.max(0, s.happiness - 4);
    bst.state = 'flee'; bst.path = null;
  }
  // guards shoot, torches scare: once a second
  defend() {
    const s = this.s;
    if (!s.beasts.length) return;
    const towers = s.buildings.filter(b => b.type === 'watchtower' && b.built);
    const torches = s.buildings.filter(b => b.type === 'torch' || b.type === 'lantern');
    for (const bst of s.beasts) {
      if (bst.state !== 'prowl') continue;
      for (const tw of towers) {
        const c = this.bCenter(tw), guards = tw.workers.map(id => this.vById.get(id)).filter(g => g && !g.carry && Math.hypot(g.x - c.x, g.z - c.z) < 4);
        if (!guards.length || Math.hypot(bst.x - c.x, bst.z - c.z) > 13 + lvlOf(tw) * 2) continue;
        for (const g of guards) { if (this.rng() < 0.75) { bst.hp -= 1; this.emit('arrow', c.x, c.z, bst); } }
      }
      for (const t of torches) { const c = this.bCenter(t); if (Math.hypot(bst.x - c.x, bst.z - c.z) < 3) bst.hp -= 0.4; }
      if (bst.hp <= 0) {
        bst.state = 'flee'; bst.path = null; s.stats.fended = (s.stats.fended || 0) + 1;
        this.addXp(6); this.emit('beastFled', bst, 'guards');
        if (bst.kind === 'goblin') { s.res.coins += 15; this.emit('float', bst.x, bst.z, '+15', 'coin'); }
      }
    }
  }


  // ── gift chests tucked in the woods ──
  spawnChest() {
    const s = this.s, W = this.world, sids = Object.keys(s.unlocked);
    const sid = sids[(this.rng() * sids.length) | 0], c = CENTERS[sid];
    for (let tries = 0; tries < 80; tries++) {
      const a = this.rng() * Math.PI * 2, r = this.settlementRadius(sid) + 1.5 + this.rng() * 6;
      const tx = Math.round(c.x + Math.cos(a) * r), tz = Math.round(c.z + Math.sin(a) * r);
      if (!inMap(tx, tz)) continue;
      const i = idx(tx, tz);
      if (W.type[i] !== 0 || W.tree[i] >= 0 || W.rock[i] >= 0 || W.bush[i] >= 0 || W.occ[i] >= 0 || W.road[i] || W.paved[i]) continue;
      if (s.chests.some(o => Math.hypot(o.tx - tx, o.tz - tz) < 6)) continue;
      let trees = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (inMap(tx + dx, tz + dz) && W.tree[idx(tx + dx, tz + dz)] >= 0) trees++;
      if (trees < 3) continue;
      const ch = { id: s.nextId++, tx, tz, x: toWorld(tx), z: toWorld(tz), sid, rot: this.rng() * 6.28 };
      s.chests.push(ch);
      this.log(`Someone spotted a gift chest in the woods near ${this.sname(sid)}.`);
      this.emit('toast', `A gift chest appeared near ${this.sname(sid)}! Tap it to open.`, 'gift');
      this.emit('chest', ch);
      return ch;
    }
    return null;
  }
  openChest(id) {
    const s = this.s, k = s.chests.findIndex(o => o.id === id);
    if (k < 0) return null;
    const ch = s.chests[k]; s.chests.splice(k, 1);
    const tokens = s.tokens || (s.tokens = {});
    const opened = (s.stats.chests || 0);
    let reward;
    // the first chest always holds a treasure; after that about a third do
    if (opened === 0 || this.rng() < 0.33) {
      const owned = t => (tokens[t] || 0) + s.buildings.filter(b => b.type === t).length;
      const pool = [...RARE].sort((a, b) => owned(a) - owned(b) || this.rng() - 0.5);
      const t = pool[0];
      tokens[t] = (tokens[t] || 0) + 1;
      reward = { kind: 'rare', type: t, name: DECOR[t].name };
    } else {
      const L = 1 + s.level * 0.12, opts = [
        { res: 'coins', n: Math.round((80 + this.rng() * 100) * L) }, { res: 'gems', n: 4 + ((this.rng() * 5) | 0) },
        { res: 'planks', n: Math.round((40 + this.rng() * 30) * L) }, { res: 'food', n: Math.round((80 + this.rng() * 40) * L) },
        { res: 'stone', n: Math.round((60 + this.rng() * 40) * L) }, { res: 'wood', n: Math.round((90 + this.rng() * 60) * L) },
      ];
      const o = opts[(this.rng() * opts.length) | 0];
      if (GOODS[o.res].capped) o.n = this.add(o.res, o.n, false); else { s.res[o.res] += o.n; this.track(o.res, o.n); }
      reward = { kind: 'res', ...o };
    }
    s.stats.chests = opened + 1;
    this.addXp(15);
    this.log(reward.kind === 'rare' ? `A gift chest held a rare treasure: a ${reward.name}!` : `A gift chest held ${reward.n} ${GOODS[reward.res].name.toLowerCase()}.`);
    this.emit('chestOpened', ch, reward); this.emit('res'); this.emit('sfx', 'level');
    return reward;
  }

  // children play near the campfire, or go to school in the daytime
  thinkChild(v) {
    const s = this.s, day = ((s.time % DAY) / DAY);
    const school = s.buildings.find(b => b.type === 'school' && b.built && b.sid === v.home && b.workers.length);
    if (school && day > 0.3 && day < 0.65 && v.age >= 5) {
      const p = this.local(school, (this.rng() - 0.5) * 1.4, this.bCenter(school).d / 2 + 0.6 + this.rng() * 0.5);
      return this.setTask(v, 'At school', [{ walk: this.goalBuilding(school) }, { to: [p.x, p.z] }, { face: [this.bCenter(school).x, this.bCenter(school).z] },
        { act: 8, anim: 'rest', done: () => { v.edu = (v.edu || 0) + 8; } }]);
    }
    const c = CENTERS[v.home] || CENTERS.meadow;
    let tx = c.x, tz = c.z + 2;
    for (let k = 0; k < 8; k++) {
      const a = this.rng() * Math.PI * 2, r = 1.5 + this.rng() * 4;
      tx = Math.round(c.x + Math.cos(a) * r); tz = Math.round(c.z + Math.sin(a) * r);
      if (inMap(tx, tz) && this.world.passable(idx(tx, tz)) && this.world.occ[idx(tx, tz)] < 0) break;
    }
    this.setTask(v, v.age < 3 ? 'Toddling about' : 'Playing', [{ walk: { tx, tz } }, { act: 2 + this.rng() * 4, anim: 'play' }]);
  }
  // retirees sit by the fire, on benches, or at the tavern
  thinkRetired(v) {
    const s = this.s;
    const seats = s.buildings.filter(b => b.built && b.sid === v.home && (b.type === 'bench' || b.type === 'tavern' || b.type === 'campfire' || b.type === 'memorial'));
    const b = seats.length ? seats[(this.rng() * seats.length) | 0] : null;
    if (!b) return this.thinkIdle(v);
    const c = this.bCenter(b);
    this.setTask(v, b.type === 'tavern' ? 'Chatting at the tavern' : 'Resting', [{ walk: { tx: toTile(c.x), tz: toTile(c.z), adj: true } }, { face: [c.x, c.z] }, { act: 8 + this.rng() * 10, anim: 'rest' }]);
  }

  taskProduce(v, b, pr) {
    const c = this.bCenter(b), [w, d] = footprint(b.type, b.rot);
    const inside = w >= 3;   // pens and orchards: wander inside
    const p = inside ? { x: c.x + (this.rng() - 0.5) * (w - 1.2), z: c.z + (this.rng() - 0.5) * (d - 1.2) } : this.spot(b, b.workers.indexOf(v.id));
    this.setTask(v, pr.label, [
      { walk: this.goalBuilding(b) }, { to: [p.x, p.z] },
      { act: pr.t, anim: pr.anim, start: () => {
        const outRes = Object.keys(pr.out)[0];
        if (GOODS[outRes].capped && this.s.res[outRes] >= this.cap()) { b.status = 'Storage full'; v.act.anim = 'rest'; v.act.idle = true; } else b.status = null;
      }, done: act => {
        if (!act.idle) for (const [r, n0] of Object.entries(pr.out)) {
          const n = v.job === 'picker' ? Math.max(1, Math.round(n0 * this.season().orchard)) : n0;
          const got = this.add(r, n); this.floatGain(v.x, v.z, r, got); this.credit(b, r, got);
          if (pr.stat) this.s.stats.produced[pr.stat] = (this.s.stats.produced[pr.stat] || 0) + got;
          if (got) this.addXp(1);
        }
      } },
    ]);
  }

  // the innkeeper serves ale plus cheese or honey; a stocked tavern lifts everyone's mood
  taskTavern(v, b) {
    const p = this.spot(b, 0), c = this.bCenter(b), res = this.s.res;
    this.setTask(v, 'Serving', [
      { walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] },
      { act: 14, anim: 'sell', start: () => {
        const side = res.cheese >= 1 ? 'cheese' : res.honey >= 1 ? 'honey' : null;
        if (res.ale < 1 || !side) { b.status = res.ale < 1 ? 'Needs ale' : 'Needs cheese or honey'; v.act.idle = true; v.act.anim = 'rest'; return; }
        b.status = null; this.pay({ ale: 1, [side]: 1 }); this.credit(b, 'ale', -1); this.credit(b, side, -1);
        this.s.tavernJoy = Math.min(120, (this.s.tavernJoy || 0) + 30 * this.synergy(b).mult);
      }, done: () => this.repeat(v) },
    ]);
  }
  taskTeach(v, b) {
    const p = this.spot(b, 0), c = this.bCenter(b);
    this.setTask(v, 'Teaching', [{ walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] }, { act: 10, anim: 'sell', done: () => this.repeat(v) }]);
  }

  // ── synergy: neighbours that help each other ──
  synergy(b) {
    const now = this.s.time | 0;
    if (b._syn && b._syn.t === now) return b._syn;
    const c = this.bCenter(b), list = [];
    let mult = 1;
    for (const r of SYNERGY) {
      if (r.to !== b.type) continue;
      let n = 0;
      for (const o of this.s.buildings) {
        if (o.type !== r.from || !o.built || o === b) continue;
        const oc = this.bCenter(o);
        if (Math.hypot(oc.x - c.x, oc.z - c.z) <= r.range) n++;
      }
      n = Math.min(n, r.stack || 1);
      if (n) { mult += r.bonus * n; list.push({ ...r, n }); }
    }
    const out = { mult, list, t: now };
    Object.defineProperty(b, '_syn', { value: out, writable: true, configurable: true, enumerable: false });
    return out;
  }
  // what a building would gain or give if placed here (for the placement preview)
  synergyPreview(type, cx, cz) {
    const out = [];
    for (const r of SYNERGY) {
      if (r.to !== type && r.from !== type) continue;
      for (const o of this.s.buildings) {
        if (!o.built || (r.to === type ? o.type !== r.from : o.type !== r.to)) continue;
        const oc = this.bCenter(o);
        if (Math.hypot(oc.x - cx, oc.z - cz) <= r.range) out.push({ rule: r, other: o, gets: r.to === type });
      }
    }
    return out;
  }
  activeSynergies() { let n = 0; for (const b of this.s.buildings) if (b.built) n += this.synergy(b).list.reduce((a, r) => a + r.n, 0); return n; }

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
      if (inMap(tx, tz) && this.world.passable(idx(tx, tz)) && this.world.occ[idx(tx, tz)] < 0) break;
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
  repeat(v) { if (v.task && !this.mustBreak(v)) v.task.again = true; }
  // bedtime and festivals pull workers out of their work loops
  mustBreak(v) { return (this.sleepy(v) && v.job !== 'guard') || (this.festivalActive() && v.job !== 'guard'); }

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
        this.floatGain(v.x, v.z, res, got); if (b) this.credit(b, res, got);
        if (got > 0) this.addXp(1);
      } },
    ]);
  }

  floatGain(x, z, res, n) { this.emit('float', x, z, n > 0 ? `+${n}` : 'Full!', GOODS[res].icon); }

  taskFarm(v, b) {
    const k = b.workers.indexOf(v.id), d = b.data, p = this.spot(b, k);
    const go = [{ walk: this.goalBuilding(b) }, { to: [p.x, p.z] }];
    if (d.stage === 'empty') {
      return this.setTask(v, `Sowing ${CROPS[d.crop || 'wheat'].name.toLowerCase()}`, [...go, { act: 3, anim: 'hoe', done: () => {
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
      if (d.work >= 6) {
        const cr = CROPS[d.crop || 'wheat'];
        d.stage = 'empty'; d.work = 0; d.grow = 0; this.emit('farm', b); v.carry = { res: cr.out, n: cr.n };
        this.s.stats.produced[d.crop || 'wheat'] = (this.s.stats.produced[d.crop || 'wheat'] || 0) + cr.n;
      }
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
        this.floatGain(v.x, v.z, 'food', got); this.credit(b, 'food', got); if (got) this.addXp(1);
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
        for (const [r, n] of Object.entries(cv.in)) this.credit(b, r, -n);
      }, done: act => {
        if (!act.idle) {
          for (const [r, n] of Object.entries(cv.out)) {
            const got = this.add(r, n); this.floatGain(c.x, c.z, r, got); this.credit(b, r, got);
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
          const coins = Math.round(n * GOODS[best].price * this.synergy(b).mult);
          r[best] -= n; r.coins += coins; this.s.stats.earned += coins;
          this.track(best, -n); this.track('coins', coins); this.credit(b, best, -n); this.credit(b, 'coins', coins);
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
    return (0.85 + this.s.happiness / 100 * 0.6) * ((this.s.hasteUntil || 0) > this.s.time ? 1.35 : 1) * (v.hungry ? 0.6 : 1) * (b ? (1 + (lvlOf(b) - 1) * 0.15) * this.synergy(b).mult : 1) * (v.educated ? 1.15 : 1);
  }

  // ── per-frame update ──
  tick(dt) {
    const s = this.s;
    s.time += dt;
    this.secTimer += dt;
    if (this.secTimer >= 1) { this.secTimer -= 1; this.second(); }

    for (const v of s.villagers) this.stepVillager(v, dt);
    this.merchantMove(dt);
    if (s.beasts?.length) this.stepBeasts(dt);

    // farms grow on their own once sown
    for (const b of s.buildings) {
      if (b.type === 'farm' && b.built && b.data.stage === 'growing') {
        const before = b.data.grow;
        const sea = this.season();
        b.data.grow = Math.min(1, b.data.grow + dt / CROPS[b.data.crop || 'wheat'].grow * (s.weather?.rain && sea.id !== 'winter' ? 1.6 : 1) * sea.crops * this.synergy(b).mult);
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
      v.hunger += v.age < ADULT ? 0.5 : 1;
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
    if (s.tavernJoy > 0) s.tavernJoy -= 1;
    if (s.mourn > 0) s.mourn -= 1;
    if (s.festJoy > 0) s.festJoy -= 1;
    let target = 55 + Math.min(30, joy * 1.5) + (s.res.food > pop * 3 ? 10 : 0) - (hungry ? 15 + 30 * hungry / pop : 0) - (pop > housing ? 15 : 0)
      + (s.tavernJoy > 0 ? 12 : 0) + (s.festJoy > 0 ? 15 : 0) - (s.mourn > 0 ? (s.buildings.some(b => b.type === 'memorial') ? 3 : 8) : 0);
    target = Math.max(0, Math.min(100, target));
    s.happiness += (target - s.happiness) * 0.05;
    this.merchantTick();
    s.stats.bestHappy = Math.max(s.stats.bestHappy || 0, s.happiness);
    // weather: the occasional rain shower
    const wx = s.weather || (s.weather = { rain: false, t: 60 });
    if ((wx.t -= 1) <= 0) {
      if (wx.rain) { wx.rain = false; wx.t = 180 + this.rng() * 260; wx.rainbow = this.seasonIdx() === 3 ? 0 : 30; this.emit('weather', false); }
      else if (this.rng() < 0.5) {
        wx.rain = true; wx.t = 45 + this.rng() * 60; this.emit('weather', true);
        if (this.seasonIdx() === 3) this.log('Snow is falling softly.');
        else { s.stats.rains = (s.stats.rains || 0) + 1; this.log('A gentle rain falls. Crops grow faster.'); }
      }
      else wx.t = 90 + this.rng() * 120;
    }
    if (wx.rainbow > 0) wx.rainbow -= 1;
    // production flow history (10-second buckets)
    if (++this.flowT >= 10) {
      this.flowT = 0; this.flowHist.push(this.flow); this.flow = {}; if (this.flowHist.length > 6) this.flowHist.shift();
      this.bflowHist.push(this.bflow); this.bflow = new Map(); if (this.bflowHist.length > 6) this.bflowHist.shift();
    }
    this.calendar();
    this.lifeCycle();
    // night falls: beasts may stir
    const f = this.dayFrac();
    if (f >= 0.94 && !this._nightRolled) { this._nightRolled = true; this.beastNight(); }
    if (f < 0.5) this._nightRolled = false;
    this.defend();
    // newcomers (slower now that families grow on their own)
    s.popTimer += 1;
    if (pop < housing && s.res.food >= 5 && s.happiness >= 35 && s.popTimer >= 34) {
      s.popTimer = 0;
      const sid = this.homeWithRoom();
      const e = W.entry;
      const v = this.spawnVillager(sid, toWorld(e.x), toWorld(e.z), { age: 18 + this.rng() * 26 });
      this.log(`${v.name} moved to ${this.sname(sid)}.`);
      this.emit('toast', `${v.name.split(' ')[0]} joined the village!`, 'person');
    }
    // berries regrow (slowly under the snow)
    const berryK = this.season().berries;
    for (let i = 0; i < W.bushes.length; i++) {
      const b = W.bushes[i];
      if (b.alive && !b.ripe && (b.regrow -= berryK) <= 0) { b.ripe = true; this.emit('bush', i); }
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
      W.wear[i] = Math.max(W.lane[i] ? 0.7 : 0, W.wear[i] - 0.012);
      if (((W.wear[i] * 10) | 0) !== q) this.emit('tile', i);
    }
    this.emit('second');
  }

  // seasons turning, festival announcements and the festival itself, gift chests
  calendar() {
    const s = this.s, si = this.seasonIdx(), f = this.dayFrac();
    if (s.seasonSeen === undefined) s.seasonSeen = si;
    const seen = s.stats.seenSeasons || (s.stats.seenSeasons = []);
    if (!seen.includes(si)) seen.push(si);
    s.stats.seasons = seen.length;
    if (si !== s.seasonSeen) {
      s.seasonSeen = si;
      const sea = SEASONS[si];
      this.log(`${sea.name} has arrived. ${sea.blurb}`);
      this.emit('toast', `${sea.name} has arrived! ${sea.blurb}`, sea.icon);
      if (si === 3) { s.weather = { rain: true, t: 80 }; this.emit('weather', true); }    // the first snowfall
      this.emit('season', sea);
    }
    const fest = this.festivalToday(), key = this.dayNum();
    if (fest && f >= 0.24 && s.festAnnounced !== key) {
      s.festAnnounced = key;
      this.log(`${fest.name} tonight! ${fest.desc}`);
      this.emit('toast', `${fest.name} tonight! Everyone gathers at the campfire at dusk.`, fest.icon);
    }
    const on = !!this.festivalActive();
    if (on && !s.fest) { s.fest = { id: fest.id, day: key }; this.emit('festival', fest); this.emit('sfx', 'level'); }
    if (!on && s.fest) { const done = Object.values(FESTIVALS).find(o => o.id === s.fest.id); s.fest = null; if (done) this.endFestival(done); }
    // a gift chest every day or two, never more than two waiting
    const ch = s.chests || (s.chests = []);
    if ((s.chestTimer = (s.chestTimer ?? 150) - 1) <= 0) {
      s.chestTimer = 220 + this.rng() * 240;
      if (ch.length < 2 && this.dayNum() >= 1) this.spawnChest();
    }
  }

  // ── life: ageing, partners, babies, growing up, retiring, passing away ──
  lifeCycle() {
    const s = this.s, st = s.stats, step = 1 / YEAR;
    for (const v of [...s.villagers]) {
      const before = stageOf(v);
      v.age += step * (v.age < ADULT && s.buildings.some(b => b.type === 'school' && b.built && b.workers.length && b.sid === v.home) ? 1.1 : 1);
      const now = stageOf(v);
      st.oldest = Math.max(st.oldest || 0, Math.floor(v.age));
      if (before !== now) {
        if (now === 'adult') {
          v.job = 'idle'; v.educated = (v.edu || 0) >= 60; this.dropTask(v);
          this.log(`${v.name} is all grown up${v.educated ? ' — and top of the class' : ''}!`);
          this.emit('toast', `${v.name.split(' ')[0]} grew up!`, 'star');
        } else if (now === 'elder') {
          this.unassign(v); v.job = 'retired';
          this.log(`${v.name} retired after a lifetime of work.`);
        }
        this.emit('villagerStage', v);
      }
      // a peaceful passing, more likely each year past OLD
      if (v.age > OLD && this.rng() < (v.age - OLD) / 22 * step * 1.4) this.passAway(v);
    }
    // partners: single adults in the same settlement pair up now and then
    if ((s.time | 0) % 10 === 0) {
      const singles = s.villagers.filter(v => !v.partner && v.age >= 18 && v.age < 56);
      for (const a of singles) {
        if (a.partner) continue;
        const b = singles.find(o => o !== a && !o.partner && o.home === a.home && !this.related(a, o) && Math.abs(o.age - a.age) < 14);
        if (b && this.rng() < 0.25) {
          a.partner = b.id; b.partner = a.id;
          this.log(`${a.name} and ${b.name} became partners.`);
          this.emit('toast', `${a.name.split(' ')[0]} & ${b.name.split(' ')[0]} fell in love!`, 'heart');
        }
      }
    }
    // babies: a couple with room at home, food and good spirits
    for (const a of s.villagers) {
      const b = a.partner && this.vById.get(a.partner);
      if (!b || a.id > b.id) continue;
      const young = Math.min(a.age, b.age);
      if (young < 20 || young > 44 || (a.kids || []).length >= 3) continue;
      const room = this.housingIn(a.home) - s.villagers.filter(o => o.home === a.home).length;
      if (room < 1 || s.res.food < 20 || s.happiness < 45 || this.rng() > 1 / 110) continue;
      const pa = this.vById.get(a.partner), last = a.name.split(' ').slice(1).join(' ');
      const kid = this.spawnVillager(a.home, a.x, a.z, { age: 0, last, parents: [a.id, b.id],
        look: { skin: this.rng() < 0.5 ? a.skin : pa.skin, hair: this.rng() < 0.5 ? a.hair : pa.hair, hat: false } });
      (a.kids || (a.kids = [])).push(kid.id); (b.kids || (b.kids = [])).push(kid.id);
      st.births = (st.births || 0) + 1;
      this.log(`${a.name.split(' ')[0]} and ${b.name.split(' ')[0]} welcomed baby ${kid.name}!`);
      this.emit('toast', `A baby was born — welcome, ${kid.name.split(' ')[0]}!`, 'heart');
      this.emit('birth', kid, a, b);
      this.emit('sfx', 'done');
    }
  }
  related(a, b) {
    if ((a.parents || []).includes(b.id) || (b.parents || []).includes(a.id)) return true;
    return (a.parents || []).some(p => (b.parents || []).includes(p));
  }
  passAway(v) {
    const s = this.s;
    this.unassign(v); this.dropTask(v);
    if (v.partner) { const p = this.vById.get(v.partner); if (p) p.partner = null; }
    s.villagers = s.villagers.filter(o => o !== v); this.vById.delete(v.id);
    s.stats.deaths = (s.stats.deaths || 0) + 1;
    (s.departed || (s.departed = [])).push({ name: v.name, age: Math.floor(v.age), t: s.time });
    if (s.departed.length > 30) s.departed.shift();
    s.mourn = 45;
    const mem = s.buildings.some(b => b.type === 'memorial');
    this.log(`${v.name} passed away peacefully at ${Math.floor(v.age)}${mem ? ' and is remembered in the Memorial Garden' : ''}.`);
    this.emit('toast', `${v.name.split(' ')[0]} passed away peacefully at ${Math.floor(v.age)}`, 'flower');
    this.emit('villagerGone', v);
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
      if (st.until && st.until()) v.act.t = v.act.dur;
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
    const speed = 1.7 * ((this.s.hasteUntil || 0) > this.s.time ? 1.35 : 1) * (v.age < ADULT ? 0.9 : v.age >= RETIRE ? 0.75 : 1) * (W.paved[cur] ? 1.5 : 1 + Math.min(W.wear[cur] || 0, 1) * 0.35) * (v.hungry ? 0.7 : 1) * (0.85 + this.s.happiness / 100 * 0.3);
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
      case 'births': return st.births || 0;
      case 'spells': return st.spells || 0;
      case 'chests': return st.chests || 0;
      case 'festivals': return st.festivals || 0;
      case 'synergy': return this.s.buildings.some(b => b.built && this.synergy(b).list.some(r => r.from === q.key)) ? 1 : 0;
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
      case 'synergies': return this.activeSynergies();
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
        lanes: [...W.lane.keys()].filter(i => W.lane[i]),
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
    for (const i of world.lanes || []) { W.lane[i] = 1; W.wear[i] = Math.max(W.wear[i], 0.7); }
    world.rocks.forEach((hp, i) => { if (hp <= 0) W.removeRock(i); else W.rocks[i].hp = hp; });
    world.bushes.forEach((v, i) => { const b = W.bushes[i]; if (v === -2) W.removeBush(i); else if (v >= 0) { b.ripe = false; b.regrow = v; } });
    for (const b of s.buildings) {
      this.bById.set(b.id, b);
      const [w, d] = footprint(b.type, b.rot);
      for (let z = b.tz; z < b.tz + d; z++) for (let x = b.tx; x < b.tx + w; x++) { W.occ[idx(x, z)] = b.id; if (!isDecor(b.type)) W.block[idx(x, z)] = 1; if (b.type === 'palisade') W.wall[idx(x, z)] = 1; }
    }
    for (const v of s.villagers) {
      this.vById.set(v.id, v); v.task = null; v.act = null;
      if (v.age === undefined) { v.age = 18 + this.rng() * 22; v.partner = null; v.parents = []; v.kids = []; v.edu = 0; }
    }
    for (const k of Object.keys(GOODS)) if (s.res[k] === undefined) s.res[k] = 0;
    s.magic = s.magic || { mana: 0, known: [], study: 0, cds: {} };
    s.chests = s.chests || []; s.tokens = s.tokens || {}; s.names = s.names || {};
    s.fest = null;
    for (const v of s.villagers) v.dancing = false;
    s.beasts = [];
    for (const v of s.villagers) { v.asleep = null; v.indoors = false; v.onTower = false; }
    for (const k of SELLABLE) if (s.sell[k] === undefined) s.sell[k] = false;
    if (!world.lanes) for (const b of s.buildings) if (b.built) this.carveLane(b);
    if (s.tutorial === undefined || s.buildings.length > 4) s.tutorial = 99;
  }
}

function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(str) { const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

export { DAY };
