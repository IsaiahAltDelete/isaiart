// Pearl Isle: a small island in the lake, a dock on each shore and a ferry
// that shuttles villagers (and trade carts) across. Sim-side only: no DOM or
// Three.js, so the headless bot can run it.
//
// The island is derived from the seed after the rest of the map is generated,
// with its own random stream, so the base map (and every tree index an old save
// refers to) stays exactly as it was. It is only added where the lake has room.
import { N, idx, tileX, tileZ, toWorld, toTile, inMap, CENTERS, T_WATER, T_SAND, T_GRASS } from './world.js';
import { SETTLEMENTS, BUILDINGS, DECOR } from './data.js';
import { mulberry32, fbm } from './rng.js';

const LAKE = { x: 24, z: 70 };
const SHALLOWS = { x: 34, z: 80 };
const ISLE_DEF = SETTLEMENTS.find(s => s.id === 'isle');
export const FERRY_DOCK = 5, FERRY_SPEED = 1.6;     // seconds moored at each side, tiles a second under sail

// Add the island to a freshly generated World (before trees are counted).
export function applyIsland(W) {
  const lake = W.lake || LAKE;
  const fits = (cx, cz, R) => {
    const M = R + 3.6;
    for (let z = Math.floor(cz - M - 1); z <= cz + M + 1; z++) for (let x = Math.floor(cx - M - 1); x <= cx + M + 1; x++) {
      if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > M) continue;
      if (!inMap(x, z) || W.type[idx(x, z)] !== T_WATER || W.bridge[idx(x, z)]) return false;
    }
    return true;
  };
  let spot = null;
  search: for (const R of [3.3, 2.9, 2.5]) for (let r = 0; r <= 3; r++) for (let k = 0; k < Math.max(1, r * 8); k++) {
    const a = k / Math.max(1, r * 8) * Math.PI * 2, cx = lake.x + 0.5 + Math.cos(a) * r, cz = lake.z + 0.5 + Math.sin(a) * r;
    if (fits(cx, cz, R)) { spot = { cx, cz, R }; break search; }
  }
  if (!spot) {
    // no room in this seed's lake: the isle is simply not on the map
    const k = SETTLEMENTS.findIndex(s => s.id === 'isle'); if (k >= 0) SETTLEMENTS.splice(k, 1);
    return null;
  }
  const { cx, cz, R } = spot, seed = W.seed, rng = mulberry32(seed + 4040);
  if (ISLE_DEF && !SETTLEMENTS.some(s => s.id === 'isle')) SETTLEMENTS.push(ISLE_DEF);
  W.baseTrees = W.trees.length;
  const land = [];
  for (let z = Math.floor(cz - R - 2); z <= cz + R + 2; z++) for (let x = Math.floor(cx - R - 2); x <= cx + R + 2; x++) {
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) + (fbm(x * 0.4, z * 0.4, seed + 41) - 0.5) * 0.9;
    if (d < R) { const i = idx(x, z); W.type[i] = d > R - 1.15 ? T_SAND : T_GRASS; land.push(i); }
  }
  // corner heights: a low grassy hump, sloping into the water at the beach
  const V = N + 1;
  for (let z = Math.floor(cz - R - 3); z <= cz + R + 3; z++) for (let x = Math.floor(cx - R - 3); x <= cx + R + 3; x++) {
    if (x < 0 || z < 0 || x > N || z > N) continue;
    let wet = 0;
    for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const tx = x + dx, tz = z + dz; if (inMap(tx, tz) && W.type[idx(tx, tz)] === T_WATER) wet++; }
    const dc = Math.hypot(x - cx, z - cz);
    W.hv[z * V + x] = wet ? (wet >= 3 ? -0.75 : -0.35) : 0.06 + Math.max(0, 1 - dc / (R + 0.5)) * 0.32;
  }
  // a few trees and berry bushes round the edge, the middle left open to settle
  for (const i of land) {
    const x = tileX(i), z = tileZ(i), d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    if (W.type[i] !== T_GRASS || d < 1.9) continue;
    const r = rng();
    if (r < 0.45) W.addTree(x, z, rng); else if (r < 0.58) W.addBush(x, z, rng);
  }
  // landings: the island beach and the mainland shore facing the Shallows
  const dir = Math.atan2(SHALLOWS.z - cz, SHALLOWS.x - cx), ux = Math.cos(dir), uz = Math.sin(dir);
  let isleLand = -1, mainLand = -1, water0 = null, water1 = null;
  for (let t = 0; t < 30; t += 0.25) {
    const x = Math.floor(cx + ux * t), z = Math.floor(cz + uz * t);
    if (!inMap(x, z)) break;
    const i = idx(x, z), wet = W.type[i] === T_WATER;
    if (!wet && mainLand < 0 && water0 === null) isleLand = i;
    if (wet && water0 === null) water0 = [x, z];
    if (wet) water1 = [x, z];
    if (!wet && water0 !== null) { mainLand = i; break; }
  }
  if (isleLand < 0 || mainLand < 0) return null;
  for (const i of [isleLand, mainLand]) clearTile(W, i);
  // the boat moors one tile out from each landing
  const moor = (land, toward) => {
    const lx = tileX(land), lz = tileZ(land);
    let best = null, bd = 1e9;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = lx + dx, z = lz + dz; if (!inMap(x, z) || W.type[idx(x, z)] !== T_WATER) continue;
      const d = Math.hypot(x - toward[0], z - toward[1]); if (d < bd) { bd = d; best = [x, z]; }
    }
    return best;
  };
  const m0 = moor(mainLand, [cx, cz]), m1 = moor(isleLand, [tileX(mainLand), tileZ(mainLand)]);
  if (!m0 || !m1) return null;
  CENTERS.isle = { x: Math.round(cx - 0.5), z: Math.round(cz - 0.5), r: R - 3.5 };
  W.island = {
    cx, cz, R, land: new Set(land),
    // side 0 = mainland, side 1 = isle
    landing: [mainLand, isleLand],
    moor: [[toWorld(m0[0]), toWorld(m0[1])], [toWorld(m1[0]), toWorld(m1[1])]],
  };
  W.massDirty = true;
  return W.island;
}

function clearTile(W, i) {
  if (W.tree[i] >= 0) W.removeTree(W.tree[i]);
  if (W.rock[i] >= 0) W.removeRock(W.rock[i]);
  if (W.bush[i] >= 0) W.removeBush(W.bush[i]);
}

// connected land masses (8-way, bridges count as land): 1 = mainland, 2+ = islands
export function massOf(W, i) {
  if (!W.mass || W.massDirty) {
    W.massDirty = false;
    const m = W.mass = new Uint8Array(N * N);
    let id = 0;
    const fill = start => {
      id++; const q = [start]; m[start] = id;
      while (q.length) {
        const c = q.pop(), x = tileX(c), z = tileZ(c);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, nz = z + dz; if (!inMap(nx, nz)) continue;
          const j = idx(nx, nz);
          if (m[j] || (W.type[j] === T_WATER && !W.bridge[j])) continue;
          m[j] = id; q.push(j);
        }
      }
    };
    const e = W.entry; fill(idx(e.x, e.z));      // the mainland first, so it is always 1
    for (let j = 0; j < N * N; j++) if (!m[j] && (W.type[j] !== T_WATER || W.bridge[j])) fill(j);
  }
  return W.mass[i];
}

// ── the ferry ──
export function ferryOn(sim) { return !!(sim.world.island && sim.s.unlocked?.isle); }
export function ferryState(sim) {
  const s = sim.s;
  return s.ferry || (s.ferry = { side: 0, state: 'dock', t: FERRY_DOCK });
}
export function crossTime(W) { const [a, b] = W.island.moor; return Math.hypot(a[0] - b[0], a[1] - b[1]) / FERRY_SPEED; }
// where the boat is now: {x, z, face, at} (at = side it's moored at, or -1 under sail)
export function ferryPos(sim) {
  const W = sim.world, f = ferryState(sim), [a, b] = W.island.moor;
  if (f.state === 'dock') { const p = f.side ? b : a, o = f.side ? a : b; return { x: p[0], z: p[1], face: Math.atan2(o[0] - p[0], o[1] - p[1]), at: f.side }; }
  const from = f.side ? a : b, to = f.side ? b : a, T = crossTime(W);
  let k = 1 - f.t / T; k = Math.max(0, Math.min(1, k)); const e = k * k * (3 - 2 * k);
  return { x: from[0] + (to[0] - from[0]) * e, z: from[1] + (to[1] - from[1]) * e, face: Math.atan2(to[0] - from[0], to[1] - from[1]), at: -1 };
}
export function stepFerry(sim, dt) {
  if (!ferryOn(sim)) return;
  const f = ferryState(sim);
  f.t -= dt;
  if (f.t > 0) return;
  if (f.state === 'dock') { f.state = 'sail'; f.side = 1 - f.side; f.t = crossTime(sim.world); }
  else { f.state = 'dock'; f.t = FERRY_DOCK; sim.emit('ferry', f.side); }
}

// Is the step a → b a hop across the water (only the ferry joins them)?
export function isHop(a, b) { return Math.max(Math.abs(tileX(a) - tileX(b)), Math.abs(tileZ(a) - tileZ(b))) > 1; }
// Entities riding the ferry: villagers and carts. `ent.ferry` = { state: 'wait' | 'ride', from, to, dest, seat }
export function boardIfHop(sim, ent, a, b) {
  const W = sim.world;
  if (!W.island || !isHop(a, b)) return false;
  const from = W.island.landing.indexOf(a), to = W.island.landing.indexOf(b);
  if (from < 0 || to < 0) return false;
  ent.ferry = { state: 'wait', from, to, dest: b, seat: (Math.random() * 6) | 0 };
  return true;
}
// move a waiting / riding entity; returns true once it has landed on the far side
export function rideFerry(sim, ent, dt) {
  const fr = ent.ferry, f = ferryState(sim), p = ferryPos(sim);
  if (fr.state === 'wait') {
    if (f.state === 'dock' && f.side === fr.from && f.t > 0.6) fr.state = 'ride';
    return false;
  }
  const a = fr.seat * 1.05, r = 0.28;
  ent.x = p.x + Math.cos(a) * r * 0.6; ent.z = p.z + Math.sin(a) * r;
  if (ent.face !== undefined) ent.face = p.face;
  if (f.state === 'dock' && f.side === fr.to) {
    ent.x = toWorld(tileX(fr.dest)); ent.z = toWorld(tileZ(fr.dest));
    ent.ferry = null;
    return true;
  }
  return false;
}

// Wire the island into a Sim: ferry-aware paths, the boat's timetable, villagers boarding.
export function installIsland(sim) {
  const W = sim.world;
  if (!W.island) return;
  const I = W.island;
  // paths between the isle and the mainland go landing → ferry → landing
  const find = W.findPath.bind(W);
  W.findPath = (s, gx, gz, goal, maxIter) => {
    if (W.beastMode || !ferryOn(sim) || !inMap(gx, gz)) return find(s, gx, gz, goal, maxIter);
    let mg = massOf(W, idx(gx, gz));
    if (!mg) for (let dz = -1; dz <= 1 && !mg; dz++) for (let dx = -1; dx <= 1 && !mg; dx++) if (inMap(gx + dx, gz + dz)) mg = massOf(W, idx(gx + dx, gz + dz));
    const ms = massOf(W, s), mi = massOf(W, I.landing[1]), mm = massOf(W, I.landing[0]);
    const cross = ms && mg && ms !== mg && ((ms === mi && mg === mm) || (ms === mm && mg === mi));
    if (!cross) return find(s, gx, gz, goal, maxIter);
    const A = I.landing[ms === mi ? 1 : 0], B = I.landing[ms === mi ? 0 : 1];
    const p1 = s === A ? [A] : find(s, tileX(A), tileZ(A), i => i === A, maxIter);
    if (!p1) return null;
    const p2 = find(B, gx, gz, goal, maxIter);
    if (!p2) return null;
    return p1.concat(p2);
  };
  // the landings must stay open
  const check = sim.checkPlace.bind(sim);
  sim.checkPlace = (type, tx, tz, rot, ignoreId = -1) => {
    const r = check(type, tx, tz, rot, ignoreId);
    if (!r.ok) return r;
    const sz = (BUILDINGS[type] || DECOR[type])?.size || [1, 1], [w, d] = rot % 2 ? [sz[1], sz[0]] : sz;
    for (const L of I.landing) { const x = tileX(L), z = tileZ(L); if (x >= tx - 1 && x <= tx + w && z >= tz - 1 && z <= tz + d) return { ok: false, why: 'The ferry landing needs to stay clear' }; }
    return r;
  };
  // the isle's territory stays on the island
  const radius = sim.settlementRadius.bind(sim);
  sim.settlementRadius = sid => sid === 'isle' ? Math.min(radius(sid), I.R + 1.2) : radius(sid);
  // villagers board when their path reaches a landing
  const step = sim.stepVillager.bind(sim);
  sim.stepVillager = (v, dt) => {
    if (v.ferry) {
      const dest = v.ferry.dest;
      if (rideFerry(sim, v, dt)) {
        sim.s.stats.ferried = (sim.s.stats.ferried || 0) + 1;
        if (v.path) { const k = v.path.indexOf(dest); if (k >= 0) v.pathI = k + 1; }
      } else if (!v.path && v.ferry?.state === 'wait') v.ferry = null;
      v.moving = v.ferry?.state === 'ride' ? false : v.moving;
      return;
    }
    step(v, dt);
    if (v.path && v.pathI > 0 && v.pathI < v.path.length) boardIfHop(sim, v, v.path[v.pathI - 1], v.path[v.pathI]);
  };
  const tick = sim.tick.bind(sim);
  sim.tick = dt => { tick(dt); stepFerry(sim, dt); };
}
export { toTile };
