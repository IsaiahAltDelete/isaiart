// The tile grid: terrain, water, forest, boulders, berry bushes, roads,
// building occupancy, plus A* pathfinding over it.
import { mulberry32, fbm, hash2 } from './rng.js';

export const N = 96;                 // playable tiles per side
export const HALF = N / 2;
export const T_GRASS = 0, T_WATER = 1, T_SAND = 2;

export const tileX = i => i % N;
export const tileZ = i => (i / N) | 0;
export const idx = (x, z) => z * N + x;
export const inMap = (x, z) => x >= 0 && z >= 0 && x < N && z < N;
export const toWorld = t => t - HALF + 0.5;           // tile coord -> world centre
export const toTile = w => Math.floor(w + HALF);      // world -> tile coord

// Settlement clearings, in tile coords. Order matches data.SETTLEMENTS.
export const CENTERS = {
  meadow:   { x: 56, z: 52, r: 8 },
  pine:     { x: 74, z: 20, r: 6 },
  shallows: { x: 34, z: 80, r: 6 },
  stone:    { x: 80, z: 76, r: 6 },
};
const MAIN_CENTERS = Object.values(CENTERS);
const RIVER = [[62, -6], [59, 14], [52, 30], [46, 44], [38, 58], [28, 68]];
export const LAKE = { x: 24, z: 70, r: 11 };   // the classic map's lake (varied worlds carry their own: world.lake)
const ENTRY = { x: 95, z: 58 };       // where newcomers walk in from

// ── world seeds ──
// Generator versions: 1 = the classic map every older save was built on (the
// seed only nudged the noise), 2 = varied worlds where the seed shapes the river,
// lake, ponds, hills and forest. Saves record theirs as `wgen`.
export const WORLD_GEN = 2;

// Any text → a 32-bit seed. A plain number ("12345", "#12345") is that number,
// so the label shown for an old numeric seed can be typed back in.
export function seedFromText(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^#?\d{1,10}$/.test(s)) { const n = Number(s.replace('#', '')); if (n <= 0xFFFFFFFF) return n >>> 0; }
  let h = 0x811c9dc5;                                   // FNV-1a
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const SEED_ADJ = ['mossy', 'sunny', 'misty', 'amber', 'quiet', 'golden', 'rosy', 'silver', 'dappled', 'hazel', 'velvet', 'sleepy',
  'breezy', 'cosy', 'dewy', 'honey', 'maple', 'merry', 'pebbly', 'starry', 'tawny', 'willow', 'mellow', 'clover'];
const SEED_NOUN = ['otter', 'badger', 'heron', 'fern', 'acorn', 'meadow', 'brook', 'thistle', 'wren', 'hollow', 'lantern', 'pebble',
  'finch', 'hare', 'bramble', 'kettle', 'orchard', 'puddle', 'robin', 'toadstool', 'beaver', 'hedgehog', 'mill', 'dell'];
export function randomSeedText(rand = Math.random) {
  const p = a => a[Math.floor(rand() * a.length)];
  return `${p(SEED_ADJ)}-${p(SEED_NOUN)}-${1 + Math.floor(rand() * 99)}`;
}
// the traits a seed would give a new world (fast: one world build, no island)
export const traitsFor = seed => new World(seed, { gen: WORLD_GEN }).traits;

// the tiles a generated road runs over (shared by carving and by the layout checks)
function roadTiles(a, b, seed, fn) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 2);
  const nx = -(b.z - a.z), nz = b.x - a.x, nl = Math.hypot(nx, nz) || 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const off = Math.sin(t * Math.PI * 2.2 + seed) * 3 * Math.sin(t * Math.PI);
    const x = Math.round(a.x + (b.x - a.x) * t + nx / nl * off);
    const z = Math.round(a.z + (b.z - a.z) * t + nz / nl * off);
    for (const [dx, dz] of [[0, 0], [1, 0]]) {
      const tx = x + dx, tz = z + dz;
      if (inMap(tx, tz)) fn(idx(tx, tz));
    }
  }
}

// ── varied worlds: everything about the layout, rolled from one random stream ──
// `calm` gives the safe fallback layout (no jitter, no extras) used if no roll fits.
function rollWorld(r, calm) {
  const J = (a, b) => a + r() * (b - a);
  const M = (a, b) => calm ? (a + b) / 2 : J(a, b);
  const I = (a, b) => Math.floor(M(a, b + 0.999));
  const S = CENTERS.shallows, P = {};
  // the lake sits just off the Shallows (its shore is nudged to ~9 tiles away after painting)
  const lr = M(9.8, 12.6), asp = calm ? 1 : J(0.8, 1.25), ang = M(208, 248) * Math.PI / 180;
  P.lake = { r: lr, ax: Math.sqrt(asp), az: 1 / Math.sqrt(asp), rot: J(0, Math.PI), wob: calm ? 0.4 : J(0.3, 0.7),
    x: S.x + Math.cos(ang) * (9 + lr), z: S.z + Math.sin(ang) * (9 + lr) };
  // the river: a spring in the northern hills, down past Meadowbrook's west side into the lake
  P.ctrl = [[M(53, 67), M(6, 10)], [M(54, 63), M(15, 20)], [M(46, 55), M(28, 33)], [M(40, 46), M(41, 46)], [M(33, 40), M(54, 60)]];
  P.amp = calm ? 0 : J(0, 3.2) * (r() < 0.25 ? 0.3 : 1);
  P.lambda = J(14, 24); P.phase = J(0, 6.28);
  P.w0 = M(1.1, 1.7); P.wv = M(0.8, 1.3); P.wGrow = M(0, 0.5);
  P.spring = M(1.7, 2.6);
  // a tributary from the western woods joining the river (a fork on the map)
  P.trib = !calm && r() < 0.35 ? { s: [J(8, 26), J(10, 30)], t: J(0.3, 0.42), bend: [J(-5, 5), J(-5, 5)], amp: J(0.5, 1.8), w: J(0.85, 1.2), spring: J(1.3, 1.9) } : null;
  // an oxbow: a crescent of still water left beside an old meander, on the river's west bank
  P.oxbow = !calm && r() < 0.3 ? { t: J(0.16, 0.42), R: J(3, 4.3), th: J(0.8, 1.1), gap: J(0.7, 1.0), off: J(1.5, 2.5) } : null;
  // ponds dotted through the woods, kept clear of clearings, roads and the river
  const roadsTo = [CENTERS.pine, CENTERS.shallows, CENTERS.stone, ENTRY];
  const segD = (px, pz, pts) => { let d = 1e9; for (let k = 0; k < pts.length - 1; k++) d = Math.min(d, distSeg(px, pz, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1])); return d; };
  const riverPts = [...P.ctrl, [P.lake.x, P.lake.z]];
  const roll = r();
  const nPonds = calm ? 0 : roll < 0.2 ? 0 : roll < 0.55 ? 1 : roll < 0.85 ? 2 : 3;
  P.ponds = [];
  for (let tries = 0; P.ponds.length < nPonds && tries < 60; tries++) {
    const p = { x: J(8, 88), z: J(8, 88), r: J(1.6, 3.0) };
    if (MAIN_CENTERS.some(c => Math.hypot(p.x - c.x, p.z - c.z) < c.r + p.r + 7)) continue;
    if (Math.hypot(p.x - ENTRY.x, p.z - ENTRY.z) < p.r + 7 || Math.min(p.x, p.z, N - p.x, N - p.z) < p.r + 5) continue;
    if (roadsTo.some(b => distSeg(p.x, p.z, CENTERS.meadow.x, CENTERS.meadow.z, b.x, b.z) < p.r + 5.5)) continue;
    if (segD(p.x, p.z, riverPts) < p.r + 7.5 || Math.hypot(p.x - P.lake.x, p.z - P.lake.z) < lr * 1.3 + p.r + 4) continue;
    if (P.trib && segD(p.x, p.z, [P.trib.s, P.ctrl[2]]) < p.r + 8) continue;
    if (P.ponds.some(q => Math.hypot(p.x - q.x, p.z - q.z) < p.r + q.r + 5)) continue;
    P.ponds.push(p);
  }
  // terrain
  P.hilly = M(1.2, 2.4);
  const away = (x, z, m) => MAIN_CENTERS.every(c => Math.hypot(x - c.x, z - c.z) > c.r + m);
  P.hills = [];
  for (let k = calm ? 0 : I(2, 5), tries = 0; k > 0 && tries < 40; tries++) {
    const h = { x: J(6, 90), z: J(6, 90), r: J(5, 10), h: J(0.6, 1.8) * (r() < 0.25 ? -0.35 : 1) };   // the odd hollow too
    if (!away(h.x, h.z, h.r * 0.6 + 2)) continue;
    P.hills.push(h); k--;
  }
  P.outcrops = [];
  for (let k = calm ? 1 : I(1, 4), tries = 0; k > 0 && tries < 40; tries++) {
    const o = { x: J(8, 88), z: J(8, 88), r: J(2, 3.4), h: J(0.7, 1.4) };
    if (!away(o.x, o.z, o.r + 6)) continue;
    if (roadsTo.some(b => distSeg(o.x, o.z, CENTERS.meadow.x, CENTERS.meadow.z, b.x, b.z) < o.r + 5)) continue;
    P.outcrops.push(o); k--;
  }
  P.valley = M(0.15, 0.45); P.valleyW = M(5, 9);
  P.stoneR = M(17, 25); P.stoneH = M(2.4, 4.0); P.stoneRock = M(0.14, 0.3);
  // boulder fields around Stonecrest
  P.boulders = [];
  for (let k = calm ? 0 : I(0, 2); k > 0; k--) {
    const a = J(0, 6.28), d = J(10, 16), sc = CENTERS.stone;
    P.boulders.push({ x: sc.x + Math.cos(a) * d, z: sc.z + Math.sin(a) * d, r: J(2.5, 4), dens: J(0.3, 0.5) });
  }
  // forest character
  P.dBase = M(0.12, 0.42); P.dAmp = M(0.75, 1.15); P.fFreq = M(0.05, 0.1);
  P.pineShift = calm ? 0 : J(-0.22, 0.22); P.pineNoise = M(0.2, 0.7);
  P.bush = M(0.022, 0.055); P.rockBase = M(0.006, 0.018); P.gladeBush = M(0.06, 0.14);
  P.glades = [];
  for (let k = calm ? 2 : I(1, 7), tries = 0; k > 0 && tries < 50; tries++) {
    const g = { x: J(6, 90), z: J(6, 90), r: J(2.5, 5.5) };
    if (!away(g.x, g.z, g.r + 3)) continue;
    P.glades.push(g); k--;
  }
  return P;
}

// a smooth line through control points (Catmull-Rom), then swung side to side into meanders
function curve(ctrl, amp, lambda, phase, perSeg = 8) {
  const pts = [], n = ctrl.length;
  for (let k = 0; k < n - 1; k++) {
    const p0 = ctrl[Math.max(0, k - 1)], p1 = ctrl[k], p2 = ctrl[k + 1], p3 = ctrl[Math.min(n - 1, k + 2)];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push([...ctrl[n - 1]]);
  if (!amp) return pts;
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = len[len.length - 1] || 1;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
    const u = len[i] / L, taper = Math.min(1, u * 6, (1 - u) * 5);
    const off = amp * Math.sin(len[i] / lambda * Math.PI * 2 + phase) * Math.max(0, taper);
    return [p[0] - tz / tl * off, p[1] + tx / tl * off];
  });
}
// distance from a point to a polyline, and how far along it (0..1) the nearest point is
function nearestOn(pts, px, pz) {
  let best = 1e9, bt = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
    const d = Math.hypot(px - ax - dx * t, pz - az - dz * t);
    if (d < best) { best = d; bt = k + t; }
  }
  return { d: best, t: bt / (pts.length - 1) };
}
const smooth01 = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// the traits a player sees for a varied world: the most striking few, 2–4 of them
function pickTraits(P, W) {
  const width = P.w0 + P.wv * 0.5 + P.wGrow * 0.5, hills = P.hills.filter(h => h.h > 0).length;
  const c = [
    ['river', 'Winding river', (P.amp - 1.4) / 1.4],
    ['river', 'Broad river', (width - 2.15) / 0.35],
    ['river', 'Slender stream', (1.75 - width) / 0.3],
    ['river', 'Forked river', P.trib ? 1.05 : 0],
    ['water', 'Oxbow lake', P.oxbow ? 0.95 : 0],
    ['water', 'Great lake', (P.lake.r - 11.4) / 1.0],
    ['water', 'Little lake', (10.6 - P.lake.r) / 0.7],
    ['water', ['', 'Hidden pond', 'Twin ponds', 'Scattered ponds'][P.ponds.length] || '', [0, 0.7, 1.0, 1.0][P.ponds.length] || 0],
    ['land', 'Rolling hills', (P.hilly - 1.75) / 0.5 + Math.max(0, hills - 3) * 0.3],
    ['land', 'Rocky outcrops', (P.outcrops.length - 1.5) / 1.4],
    ['land', 'Gentle lowlands', (1.55 - P.hilly) / 0.35 - hills * 0.15],
    ['land', 'Boulder fields', P.boulders.length ? 0.55 + P.boulders.length * 0.2 : (P.stoneRock - 0.25) / 0.05],
    ['wood', 'Old pine woods', (P.pineShift - 0.07) / 0.12],
    ['wood', 'Broadleaf woods', (-P.pineShift - 0.07) / 0.12],
    ['wood', 'Deep forest', (P.dBase - 0.31) / 0.09],
    ['wood', 'Open meadows', Math.max((0.22 - P.dBase) / 0.08, (P.glades.length - 4.5) / 2)],
    ['wood', 'Berry thickets', (P.bush - 0.044) / 0.01],
  ].filter(t => t[1]).sort((a, b) => b[2] - a[2]);
  const out = [], per = {};
  for (const [cat, name, score] of c) {
    if (out.length >= 4 || (score < 0.5 && out.length >= 2) || (per[cat] || 0) >= 2) continue;
    per[cat] = (per[cat] || 0) + 1; out.push(name);
  }
  return out;
}

function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  const cx = ax + dx * t, cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

export class World {
  // opts.gen: generator version (1 = classic, the default for older saves; WORLD_GEN for new games)
  // opts.label: the seed as the player typed it, for display
  constructor(seed, opts = {}) {
    this.seed = seed;
    this.gen = opts.gen >= 2 ? 2 : 1;
    this.seedLabel = opts.label ? String(opts.label) : String(seed);
    const rng = this.rng = mulberry32(seed);
    const S = N * N;
    this.type = new Uint8Array(S);
    this.hv = new Float32Array((N + 1) * (N + 1));
    this.tree = new Int32Array(S).fill(-1);
    this.rock = new Int32Array(S).fill(-1);
    this.bush = new Int32Array(S).fill(-1);
    this.occ = new Int32Array(S).fill(-1);
    this.block = new Uint8Array(S);      // 1 = a building villagers can't walk through
    this.relaxed = false;
    this.wall = new Uint8Array(S);       // palisades: beasts can't pass, villagers can
    this.beastMode = false;                // last-resort pathing squeezes past buildings
    this.wear = new Float32Array(S);
    this.road = new Uint8Array(S);
    this.bridge = new Uint8Array(S);
    this.paved = new Uint8Array(S);
    this.lane = new Uint8Array(S);      // worn lanes between doors and the campfire
    this.bridges = [];
    this.trees = []; this.rocks = []; this.bushes = [];
    this.entry = ENTRY;
    this.lake = LAKE;
    if (this.gen >= 2) { this.genVaried(); return; }
    this.traits = ['Classic valley', 'Winding river'];

    // ── water: meandering river into a lake ──
    const wob = (x, z) => (fbm(x * 0.12, z * 0.12, seed + 5) - 0.5) * 3.2;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const w = wob(x, z);
      let d = 1e9;
      for (let k = 0; k < RIVER.length - 1; k++) {
        const [ax, az] = RIVER[k], [bx, bz] = RIVER[k + 1];
        d = Math.min(d, distSeg(x + w * 0.6, z, ax, az, bx, bz));
      }
      const width = 1.5 + fbm(x * 0.05, z * 0.05, seed + 9) * 1.4;
      const lake = Math.hypot((x - LAKE.x) * 1.0, (z - LAKE.z) * 1.15) + w;
      if (d < width || lake < LAKE.r) this.type[idx(x, z)] = T_WATER;
    }
    // sand on shores
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      if (this.type[i] === T_WATER) continue;
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if (inMap(nx, nz) && this.type[idx(nx, nz)] === T_WATER) { near = true; break; }
      }
      if (near && hash2(x, z, seed + 3) < 0.7) this.type[i] = T_SAND;
    }

    // ── heights at tile corners ──
    const sc = CENTERS.stone;
    for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) {
      let h = (fbm(x * 0.05, z * 0.05, seed + 11) - 0.5) * 1.6;
      const ds = Math.hypot(x - sc.x, z - sc.z);
      h += Math.max(0, 1 - ds / 22) * (fbm(x * 0.15, z * 0.15, seed + 12) * 3.2);
      // gentle rims at the map border so the forest bowls the play area
      const edge = Math.min(x, z, N - x, N - z);
      if (edge < 8) h += (8 - edge) * 0.12;
      // flatten clearings so buildings sit nicely
      for (const c of MAIN_CENTERS) {
        const dc = Math.hypot(x - c.x, z - c.z);
        const f = Math.max(0, Math.min(1, (dc - c.r) / 6));
        h = h * f + 0.1 * (1 - f);
      }
      let wet = 0;
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const tx = x + dx, tz = z + dz;
        if (inMap(tx, tz) && this.type[idx(tx, tz)] === T_WATER) wet++;
      }
      if (wet) h = Math.min(h, wet >= 3 ? -0.75 : -0.35);
      if (x === 0 || z === 0 || x === N || z === N) h = 0.9;
      this.hv[z * (N + 1) + x] = h;
    }

    // ── roads between clearings, and to the east edge ──
    const meadow = CENTERS.meadow;
    this.carveRoad(meadow, CENTERS.pine);
    this.carveRoad(meadow, CENTERS.shallows);
    this.carveRoad(meadow, CENTERS.stone);
    this.carveRoad(meadow, ENTRY);
    this.buildBridge(meadow);

    // ── forest, boulders, bushes ──
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      if (this.type[i] !== T_GRASS || this.road[i]) continue;
      let clear = 1;
      for (const c of MAIN_CENTERS) {
        const dc = Math.hypot(x - c.x, z - c.z);
        clear = Math.min(clear, Math.max(0, Math.min(1, (dc - c.r) / 5)));
      }
      const dens = (0.3 + fbm(x * 0.07, z * 0.07, seed + 21) * 0.95) * clear;
      const ds = Math.hypot(x - sc.x, z - sc.z);
      const rockiness = Math.max(0, 1 - ds / 20) * 0.22 + 0.012;
      const r = rng();
      if (clear > 0.2 && r < rockiness) { this.addRock(x, z, rng); continue; }
      if (r < dens * 0.92) { this.addTree(x, z, rng); continue; }
      if (r < dens * 0.92 + 0.035 && clear > 0.1) this.addBush(x, z, rng);
    }
    // a few boulders and bushes inside the starting clearing ring so the
    // first quarry and forager have something close by
    this.sprinkle(meadow, 9, 16, 9, (x, z) => this.addRock(x, z, rng));
    this.sprinkle(meadow, 6, 11, 6, (x, z) => this.addBush(x, z, rng));
  }

  // ── generator 2: the seed shapes the whole valley ──
  genVaried() {
    const seed = this.seed, S = N * N;
    // roll layouts until one keeps every clearing dry, the roads whole and the bridge crossing
    let P = null;
    for (let a = 0; a < 16 && !P; a++) {
      const Q = rollWorld(mulberry32((seed ^ Math.imul(a + 1, 0x9E3779B1)) >>> 0), false);
      if (this.paintWater(Q)) P = Q;
    }
    if (!P) { P = rollWorld(mulberry32((seed ^ 0x5AFE5AFE) >>> 0), true); this.paintWater(P, true); }
    this.P = P;
    this.lake = { x: Math.round(P.lake.x), z: Math.round(P.lake.z), r: P.lake.r };
    this.ponds = P.ponds.map(p => ({ x: Math.round(p.x), z: Math.round(p.z), r: p.r }));
    this.glades = P.glades.map(g => ({ x: Math.round(g.x), z: Math.round(g.z), r: g.r }));   // open, sunny spots (flower meadows)
    this.traits = pickTraits(P, this);

    // sand on shores
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      if (this.type[i] === T_WATER) continue;
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if (inMap(nx, nz) && this.type[idx(nx, nz)] === T_WATER) { near = true; break; }
      }
      if (near && hash2(x, z, seed + 3) < 0.7) this.type[i] = T_SAND;
    }

    // ── heights: rolling noise, hills and hollows, rocky outcrops, soft valleys along the water ──
    const dw = new Uint8Array(S).fill(255), q = [];
    for (let i = 0; i < S; i++) if (this.type[i] === T_WATER) { dw[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = tileX(c), z = tileZ(c);
      if (dw[c] >= 16) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz; if (!inMap(nx, nz)) continue;
        const j = idx(nx, nz); if (dw[j] <= dw[c] + 1) continue;
        dw[j] = dw[c] + 1; q.push(j);
      }
    }
    const sc = CENTERS.stone, bumps = [...P.hills, ...P.outcrops];
    for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) {
      let h = (fbm(x * 0.05, z * 0.05, seed + 11) - 0.5) * P.hilly;
      const ds = Math.hypot(x - sc.x, z - sc.z);
      h += Math.max(0, 1 - ds / P.stoneR) * (fbm(x * 0.15, z * 0.15, seed + 12) * P.stoneH);
      for (const b of bumps) {
        const d2 = ((x - b.x) ** 2 + (z - b.z) ** 2) / (b.r * b.r);
        if (d2 < 9) h += b.h * Math.exp(-d2);
      }
      h -= P.valley * Math.max(0, 1 - dw[idx(Math.min(x, N - 1), Math.min(z, N - 1))] / P.valleyW);
      const edge = Math.min(x, z, N - x, N - z);
      if (edge < 8) h += (8 - edge) * 0.12;
      for (const c of MAIN_CENTERS) {
        const dc = Math.hypot(x - c.x, z - c.z);
        const f = Math.max(0, Math.min(1, (dc - c.r) / 6));
        h = h * f + 0.1 * (1 - f);
      }
      let wet = 0;
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const tx = x + dx, tz = z + dz;
        if (inMap(tx, tz) && this.type[idx(tx, tz)] === T_WATER) wet++;
      }
      if (wet) h = Math.min(h, wet >= 3 ? -0.75 : -0.35);
      if (x === 0 || z === 0 || x === N || z === N) h = 0.9;
      this.hv[z * (N + 1) + x] = h;
    }

    // ── roads and the west bridge (same rules as the classic map) ──
    const meadow = CENTERS.meadow;
    this.carveRoad(meadow, CENTERS.pine);
    this.carveRoad(meadow, CENTERS.shallows);
    this.carveRoad(meadow, CENTERS.stone);
    this.carveRoad(meadow, ENTRY);
    this.buildBridge(meadow);

    // ── forest, glades, boulders, bushes ──
    const rng = this.rng = mulberry32((seed + 0x7F4A7C15) >>> 0);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      if (this.type[i] !== T_GRASS || this.road[i]) continue;
      let clear = 1;
      for (const c of MAIN_CENTERS) {
        const dc = Math.hypot(x - c.x, z - c.z);
        clear = Math.min(clear, Math.max(0, Math.min(1, (dc - c.r) / 5)));
      }
      let glade = 0;
      for (const g of P.glades) glade = Math.max(glade, smooth01(1 - (Math.hypot(x - g.x, z - g.z) - g.r) / 2.5));
      const dens = (P.dBase + fbm(x * P.fFreq, z * P.fFreq, seed + 21) * P.dAmp) * clear * (1 - glade);
      const ds = Math.hypot(x - sc.x, z - sc.z);
      let rockiness = Math.max(0, 1 - ds / P.stoneR) * P.stoneRock + P.rockBase;
      for (const o of P.outcrops) { const d = Math.hypot(x - o.x, z - o.z); if (d < o.r + 1) rockiness += 0.5 * (1 - d / (o.r + 1)); }
      for (const b of P.boulders) { const d = Math.hypot(x - b.x, z - b.z); if (d < b.r) rockiness += b.dens * (1 - d / b.r); }
      const r = rng();
      if (clear > 0.2 && r < rockiness) { this.addRock(x, z, rng); continue; }
      if (r < dens * 0.92) { this.addTree(x, z, rng); continue; }
      if (r < dens * 0.92 + P.bush + glade * P.gladeBush && clear > 0.1) this.addBush(x, z, rng);
    }
    this.sprinkle(meadow, 9, 16, 9, (x, z) => this.addRock(x, z, rng));
    this.sprinkle(meadow, 6, 11, 6, (x, z) => this.addBush(x, z, rng));
  }

  // Paint the water for a rolled layout and check it. The lake is slid so its shore
  // sits ~9 tiles from the Shallows (fishing distance, outside the dry clearing).
  // Returns true if the layout keeps every rule; `force` paints it regardless.
  paintWater(P, force = false) {
    const seed = this.seed, type = this.type, L = P.lake, sh = CENTERS.shallows;
    const wob = new Float32Array(N * N), wid = new Float32Array(N * N);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      wob[idx(x, z)] = (fbm(x * 0.12, z * 0.12, seed + 5) - 0.5) * 3.2;
      wid[idx(x, z)] = fbm(x * 0.05, z * 0.05, seed + 9);
    }
    let clean = true;
    for (let it = 0; it < 5; it++) {
      // the river runs into the lake's middle, so it follows the lake when the lake moves
      const river = curve([...P.ctrl, [L.x, L.z]], P.amp, P.lambda, P.phase);
      const pools = [{ x: P.ctrl[0][0], z: P.ctrl[0][1], r: P.spring }, ...P.ponds];
      let trib = null, ox = null;
      if (P.trib) {
        const j = river[Math.round(P.trib.t * (river.length - 1))], s = P.trib.s;
        trib = curve([s, [(s[0] + j[0]) / 2 + P.trib.bend[0], (s[1] + j[1]) / 2 + P.trib.bend[1]], j], P.trib.amp, 11, P.phase + 1.3);
        pools.push({ x: s[0], z: s[1], r: P.trib.spring });
      }
      if (P.oxbow) {
        const k = Math.round(P.oxbow.t * (river.length - 1)), a = river[k - 1], b = river[k + 1], p = river[k];
        let nx = -(b[1] - a[1]), nz = b[0] - a[0]; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        if (nx > 0) { nx = -nx; nz = -nz; }                      // always on the west bank, away from Meadowbrook
        const d = P.w0 + P.wv * 0.6 + P.oxbow.R + P.oxbow.off;
        ox = { x: p[0] + nx * d, z: p[1] + nz * d, gx: -nx, gz: -nz };
      }
      const cr = Math.cos(L.rot), sr = Math.sin(L.rot);
      type.fill(T_GRASS);
      clean = true;
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const i = idx(x, z), w = wob[i];
        let wet = false;
        const rv = nearestOn(river, x + w * 0.6, z);
        const width = (P.w0 + wid[i] * P.wv + rv.t * P.wGrow) * (0.55 + 0.45 * Math.min(1, rv.t * 5));
        if (rv.d < width) wet = true;
        if (!wet && trib) { const tv = nearestOn(trib, x + w * 0.5, z); if (tv.d < P.trib.w * (0.6 + 0.4 * tv.t)) wet = true; }
        if (!wet) {
          const dx = x - L.x, dz = z - L.z, u = dx * cr + dz * sr, v = -dx * sr + dz * cr;
          if (Math.hypot(u / L.ax, v / L.az) + w * L.wob < L.r) wet = true;
        }
        if (!wet) for (const p of pools) if (Math.hypot(x - p.x, z - p.z) + w * 0.3 < p.r) { wet = true; break; }
        if (!wet && ox) {
          const dx = x - ox.x, dz = z - ox.z, d = Math.hypot(dx, dz) || 1;
          if (Math.abs(d - P.oxbow.R) + w * 0.15 < P.oxbow.th && (dx * ox.gx + dz * ox.gz) / d < Math.cos(P.oxbow.gap)) wet = true;
        }
        if (!wet) continue;
        if (Math.min(x, z, N - 1 - x, N - 1 - z) < 2) { clean = false; continue; }   // never at the map's edge
        type[i] = T_WATER;
      }
      const m = this.waterDist(sh);
      if (m > sh.r + 2.3 && m < sh.r + 3.7) break;
      // slide the lake toward (or away from) the Shallows to put its shore at ~9 tiles
      const vx = sh.x - L.x, vz = sh.z - L.z, vl = Math.hypot(vx, vz) || 1, step = Math.max(-6, Math.min(6, m - (sh.r + 3)));
      L.x += vx / vl * step; L.z += vz / vl * step;
    }
    return (clean && this.layoutOk(P)) || force;
  }
  // nearest water to a clearing's centre (tile-centre distance)
  waterDist(c) {
    let best = 1e9;
    const R = 24;
    for (let z = Math.max(0, Math.floor(c.z - R)); z < Math.min(N, c.z + R); z++) for (let x = Math.max(0, Math.floor(c.x - R)); x < Math.min(N, c.x + R); x++)
      if (this.type[idx(x, z)] === T_WATER) best = Math.min(best, Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z));
    return best;
  }
  // the hard rules every varied world keeps
  layoutOk(P) {
    const type = this.type, wet = i => type[i] === T_WATER;
    // clearings (radius + 2) and the entry stay dry; the Shallows keeps water within fishing reach
    for (const c of MAIN_CENTERS) if (this.waterDist(c) <= c.r + 2) return false;
    const sh = CENTERS.shallows;
    if (this.waterDist(sh) > sh.r + 4) return false;
    if (this.waterDist(ENTRY) <= 4) return false;
    // generated roads never run into water
    const meadow = CENTERS.meadow;
    let bad = false;
    for (const b of [CENTERS.pine, CENTERS.shallows, CENTERS.stone, ENTRY]) roadTiles(meadow, b, this.seed, i => { if (wet(i)) bad = true; });
    if (bad) return false;
    // the west bridge finds a short crossing, reached by a dry lane
    const br = this.findCrossing(meadow);
    if (!br) return false;
    roadTiles(meadow, { x: br.x1 + 1, z: br.z }, this.seed, i => { if (wet(i)) bad = true; });
    if (bad) return false;
    // Pearl Isle has room in the lake (see island.js)
    const lx = Math.round(P.lake.x) + 0.5, lz = Math.round(P.lake.z) + 0.5, M = 3.3 + 3.6;
    for (let z = Math.floor(lz - M - 1); z <= lz + M + 1; z++) for (let x = Math.floor(lx - M - 1); x <= lx + M + 1; x++)
      if (Math.hypot(x + 0.5 - lx, z + 0.5 - lz) <= M && (!inMap(x, z) || !wet(idx(x, z)))) return false;
    // every clearing and the entry share one stretch of land with Meadowbrook
    const seen = new Uint8Array(N * N), st = [idx(meadow.x, meadow.z)];
    seen[st[0]] = 1;
    while (st.length) {
      const c = st.pop(), x = tileX(c), z = tileZ(c);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz; if (!inMap(nx, nz)) continue;
        const j = idx(nx, nz); if (seen[j] || wet(j)) continue;
        seen[j] = 1; st.push(j);
      }
    }
    for (const c of [CENTERS.pine, CENTERS.shallows, CENTERS.stone, ENTRY]) if (!seen[idx(c.x, c.z)]) return false;
    return true;
  }

  // where trees lean pine (0) vs round (1): pines up north and round Stonecrest
  pineBias(x, z) {
    const base = z < 40 || Math.hypot(x - CENTERS.stone.x, z - CENTERS.stone.z) < 22 ? 0.72 : 0.42;
    if (this.gen < 2) return base;
    const P = this.P;
    let b = base + P.pineShift + (fbm(x * 0.045, z * 0.045, this.seed + 33) - 0.5) * P.pineNoise;
    if (Math.hypot(x - CENTERS.pine.x, z - CENTERS.pine.z) < 16) b = Math.max(b, 0.7);   // Pinehollow stays piney
    return Math.max(0.08, Math.min(0.95, b));
  }

  sprinkle(c, rMin, rMax, count, fn) {
    let tries = 0;
    while (count > 0 && tries++ < 400) {
      const a = this.rng() * Math.PI * 2, d = rMin + this.rng() * (rMax - rMin);
      const x = Math.round(c.x + Math.cos(a) * d), z = Math.round(c.z + Math.sin(a) * d);
      if (!inMap(x, z)) continue;
      const i = idx(x, z);
      if (this.type[i] !== T_GRASS || this.road[i] || this.rock[i] >= 0 || this.bush[i] >= 0) continue;
      if (this.tree[i] >= 0) this.trees[this.tree[i]].alive = false, this.tree[i] = -1;
      fn(x, z); count--;
    }
  }

  // a little wooden bridge carrying a lane west across the river
  buildBridge(c) {
    const b = this.findCrossing(c);
    if (!b) return;
    const { x0, x1, z } = b;
    for (let x = x0; x <= x1; x++) for (const dz of [0, 1]) { this.bridge[idx(x, z + dz)] = 1; this.wear[idx(x, z + dz)] = 1; }
    this.bridges.push({ x0, x1, z });
    this.carveRoad(c, { x: x1 + 1, z });
    this.carveRoad({ x: x0 - 1, z }, { x: Math.max(2, x0 - 9), z: z - 2 });
  }
  // the first short stretch of water due west of a clearing, two rows deep
  findCrossing(c) {
    for (const z of [c.z, c.z - 3, c.z + 3, c.z - 6]) {
      let x1 = -1, x0 = -1;
      for (let x = c.x; x > 2; x--) {
        const w = this.type[idx(x, z)] === T_WATER && this.type[idx(x, z + 1)] === T_WATER;
        if (w && x1 < 0) x1 = x;
        if (!w && x1 >= 0) { x0 = x + 1; break; }
      }
      if (x1 < 0 || x0 < 0 || x1 - x0 > 5) continue;
      return { x0, x1, z };
    }
    return null;
  }

  carveRoad(a, b) {
    roadTiles(a, b, this.seed, i => {
      if (this.type[i] === T_WATER) return;
      this.road[i] = 1; this.wear[i] = 1;
      if (this.tree[i] >= 0) { this.trees[this.tree[i]].alive = false; this.tree[i] = -1; }
    });
  }

  addTree(x, z, rng, growth = 1) {
    const i = idx(x, z);
    const pineBias = this.pineBias(x, z);
    const t = {
      tx: x, tz: z,
      x: toWorld(x) + (rng() - 0.5) * 0.5, z: toWorld(z) + (rng() - 0.5) * 0.5,
      kind: rng() < pineBias ? 0 : 1, s: 0.75 + rng() * 0.55, rot: rng() * 6.28,
      tint: rng(), growth, alive: true, marked: false, claimed: -1,
    };
    this.tree[i] = this.trees.length;
    this.trees.push(t);
    return t;
  }
  addRock(x, z, rng) {
    const i = idx(x, z);
    const r = { tx: x, tz: z, x: toWorld(x) + (rng() - 0.5) * 0.3, z: toWorld(z) + (rng() - 0.5) * 0.3,
      s: 0.55 + rng() * 0.4, rot: rng() * 6.28, hp: 100, alive: true, claimed: -1 };
    this.rock[i] = this.rocks.length; this.rocks.push(r);
  }
  addBush(x, z, rng) {
    const i = idx(x, z);
    const b = { tx: x, tz: z, x: toWorld(x) + (rng() - 0.5) * 0.4, z: toWorld(z) + (rng() - 0.5) * 0.4,
      s: 0.7 + rng() * 0.35, ripe: true, regrow: 0, alive: true, claimed: -1 };
    this.bush[i] = this.bushes.length; this.bushes.push(b);
  }

  removeTree(ti) {
    const t = this.trees[ti];
    t.alive = false; t.marked = false; t.claimed = -1;
    const i = idx(t.tx, t.tz);
    if (this.tree[i] === ti) this.tree[i] = -1;
  }
  removeRock(ri) {
    const r = this.rocks[ri];
    r.alive = false;
    const i = idx(r.tx, r.tz);
    if (this.rock[i] === ri) this.rock[i] = -1;
  }
  removeBush(bi) {
    const b = this.bushes[bi];
    b.alive = false;
    const i = idx(b.tx, b.tz);
    if (this.bush[i] === bi) this.bush[i] = -1;
  }

  // terrain height at a world position (bilinear over the corner grid)
  heightAt(wx, wz) {
    const fx = Math.max(0, Math.min(N - 0.001, wx + HALF));
    const fz = Math.max(0, Math.min(N - 0.001, wz + HALF));
    const x0 = Math.floor(fx), z0 = Math.floor(fz), u = fx - x0, v = fz - z0;
    const W = N + 1, hv = this.hv;
    const a = hv[z0 * W + x0], b = hv[z0 * W + x0 + 1], c = hv[(z0 + 1) * W + x0], d = hv[(z0 + 1) * W + x0 + 1];
    // match the triangle split used by the terrain mesh
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  tileHeight(x, z) {
    const W = N + 1, hv = this.hv;
    return (hv[z * W + x] + hv[z * W + x + 1] + hv[(z + 1) * W + x] + hv[(z + 1) * W + x + 1]) / 4;
  }

  passable(i) {
    return (this.type[i] !== T_WATER || this.bridge[i] === 1) && (this.relaxed || !this.block[i]) && this.rock[i] < 0 && !(this.beastMode && this.wall[i]);
  }
  stepCost(i) {
    let c = 1;
    if (this.tree[i] >= 0) c += 1.6;
    if (this.bush[i] >= 0) c += 0.6;
    c -= Math.min(this.wear[i], 1) * 0.45;
    if (this.paved[i]) c = 0.45;
    else if (this.road[i] || this.bridge[i]) c = Math.min(c, 0.55);   // dirt roads (see roads.js)
    if (this.costHook) c = this.costHook(i, c);                       // e.g. carts that keep to the roads
    if (this.block[i]) c += 6;
    return c;
  }

  // A* from tile index s; goalFn(i) says when we've arrived; (gx, gz) steers.
  findPath(s, gx, gz, goalFn, maxIter = 14000) {
    const S = N * N;
    if (!this._g) {
      this._g = new Float32Array(S); this._from = new Int32Array(S); this._stamp = new Uint32Array(S);
      this._closed = new Uint32Array(S); this._heap = []; this._gen = 0;
    }
    const g = this._g, from = this._from, stamp = this._stamp, closed = this._closed;
    const gen = ++this._gen;
    const heap = this._heap; heap.length = 0;
    const h = i => { const dx = Math.abs(tileX(i) - gx), dz = Math.abs(tileZ(i) - gz);
      return (dx + dz + (1.414 - 2) * Math.min(dx, dz)) * 0.55; };
    const push = (i, f) => {
      heap.push([f, i]); let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let k = 0;
        for (;;) { const l = k * 2 + 1, r = l + 1; let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } }
      return top;
    };
    g[s] = 0; stamp[s] = gen; from[s] = -1; push(s, h(s));
    let iter = 0, best = s, bestH = h(s);
    while (heap.length && iter++ < maxIter) {
      const [, cur] = pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (goalFn(cur)) return this.unwind(cur);
      const hc = h(cur); if (hc < bestH) { bestH = hc; best = cur; }
      const cx = tileX(cur), cz = tileZ(cur);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!inMap(nx, nz)) continue;
        const ni = idx(nx, nz);
        const isGoal = goalFn(ni);
        if (!isGoal && !this.passable(ni)) continue;
        if (dx && dz && (!this.passable(idx(cx + dx, cz)) || !this.passable(idx(cx, cz + dz)))) continue;
        const ng = g[cur] + this.stepCost(ni) * (dx && dz ? 1.414 : 1);
        if (stamp[ni] !== gen || ng < g[ni]) {
          stamp[ni] = gen; g[ni] = ng; from[ni] = cur; push(ni, ng + h(ni));
        }
      }
    }
    return null;
  }
  // Dijkstra flood from a set of start tiles, out to maxCost. Returns a
  // Float32Array of walking cost (Infinity = out of reach).
  walkField(starts, maxCost) {
    const S = N * N, dist = new Float32Array(S).fill(Infinity);
    const heap = [];
    const push = (c, i) => { heap.push([c, i]); let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let k = 0;
        for (;;) { const l = k * 2 + 1, r = l + 1; let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } }
      return top; };
    for (const i of starts) { dist[i] = 0; push(0, i); }
    while (heap.length) {
      const [c, cur] = pop();
      if (c > dist[cur]) continue;
      const cx = tileX(cur), cz = tileZ(cur);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!inMap(nx, nz)) continue;
        const ni = idx(nx, nz);
        const ok = this.passable(ni);
        // blocked tiles (boulders) get a distance so we can target them, but we don't walk through
        const nc = c + (ok ? this.stepCost(ni) : 1) * (dx && dz ? 1.414 : 1);
        if (nc > maxCost || nc >= dist[ni]) continue;
        if (dx && dz && (!this.passable(idx(cx + dx, cz)) || !this.passable(idx(cx, cz + dz)))) continue;
        dist[ni] = nc;
        if (ok) push(nc, ni);
      }
    }
    return dist;
  }

  unwind(i) {
    const out = [];
    while (i >= 0) { out.push(i); i = this._from[i]; }
    return out.reverse();
  }
}
