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
const RIVER = [[62, -6], [59, 14], [52, 30], [46, 44], [38, 58], [28, 68]];
const LAKE = { x: 24, z: 70, r: 11 };
const ENTRY = { x: 95, z: 58 };       // where newcomers walk in from

function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  const cx = ax + dx * t, cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

export class World {
  constructor(seed) {
    this.seed = seed;
    const rng = this.rng = mulberry32(seed);
    const S = N * N;
    this.type = new Uint8Array(S);
    this.hv = new Float32Array((N + 1) * (N + 1));
    this.tree = new Int32Array(S).fill(-1);
    this.rock = new Int32Array(S).fill(-1);
    this.bush = new Int32Array(S).fill(-1);
    this.occ = new Int32Array(S).fill(-1);
    this.block = new Uint8Array(S);      // 1 = a building villagers can't walk through
    this.relaxed = false;                // last-resort pathing squeezes past buildings
    this.wear = new Float32Array(S);
    this.road = new Uint8Array(S);
    this.bridge = new Uint8Array(S);
    this.bridges = [];
    this.trees = []; this.rocks = []; this.bushes = [];
    this.entry = ENTRY;

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
      for (const c of Object.values(CENTERS)) {
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
      for (const c of Object.values(CENTERS)) {
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
    for (const z of [c.z, c.z - 3, c.z + 3, c.z - 6]) {
      let x1 = -1, x0 = -1;
      for (let x = c.x; x > 2; x--) {
        const w = this.type[idx(x, z)] === T_WATER && this.type[idx(x, z + 1)] === T_WATER;
        if (w && x1 < 0) x1 = x;
        if (!w && x1 >= 0) { x0 = x + 1; break; }
      }
      if (x1 < 0 || x0 < 0 || x1 - x0 > 5) continue;
      for (let x = x0; x <= x1; x++) for (const dz of [0, 1]) { this.bridge[idx(x, z + dz)] = 1; this.wear[idx(x, z + dz)] = 1; }
      this.bridges.push({ x0, x1, z });
      this.carveRoad(c, { x: x1 + 1, z });
      this.carveRoad({ x: x0 - 1, z }, { x: Math.max(2, x0 - 9), z: z - 2 });
      return;
    }
  }

  carveRoad(a, b) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 2);
    const nx = -(b.z - a.z), nz = b.x - a.x, nl = Math.hypot(nx, nz) || 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const off = Math.sin(t * Math.PI * 2.2 + this.seed) * 3 * Math.sin(t * Math.PI);
      const x = Math.round(a.x + (b.x - a.x) * t + nx / nl * off);
      const z = Math.round(a.z + (b.z - a.z) * t + nz / nl * off);
      for (const [dx, dz] of [[0, 0], [1, 0]]) {
        const tx = x + dx, tz = z + dz;
        if (!inMap(tx, tz)) continue;
        const i = idx(tx, tz);
        if (this.type[i] === T_WATER) continue;
        this.road[i] = 1; this.wear[i] = 1;
        if (this.tree[i] >= 0) { this.trees[this.tree[i]].alive = false; this.tree[i] = -1; }
      }
    }
  }

  addTree(x, z, rng, growth = 1) {
    const i = idx(x, z);
    const pineBias = z < 40 || Math.hypot(x - CENTERS.stone.x, z - CENTERS.stone.z) < 22 ? 0.72 : 0.42;
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
    return (this.type[i] !== T_WATER || this.bridge[i] === 1) && (this.relaxed || !this.block[i]) && this.rock[i] < 0;
  }
  stepCost(i) {
    let c = 1;
    if (this.tree[i] >= 0) c += 1.6;
    if (this.bush[i] >= 0) c += 0.6;
    c -= Math.min(this.wear[i], 1) * 0.45;
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
