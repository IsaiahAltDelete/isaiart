// Roads: player-painted dirt roads, cobbled upgrades and wooden bridges.
// Sim-side only (no DOM / Three.js).
//
// Tiles carry three layers that already existed in the world: `road` (1 = the
// roads carved by world generation, 2 = laid by the player), `paved` (cobbles)
// and `bridge` (1 = the old west bridge, 2 = player bridge segments). A dirt
// road is free; cobbling costs 1 stone a tile; a bridge segment costs 3 planks.
// Villagers walk 35% faster on dirt roads and 50% faster on cobbles, and trade
// carts strongly prefer roads when they plan a route.
import { N, idx, tileX, tileZ, inMap, T_WATER } from './world.js';

export const PLAYER = 2;
export const BRIDGE_PLANKS = 3, COBBLE_STONE = 1, MAX_SPAN = 3;   // bridge tiles at most 3 from a bank

const isRoad = (W, i) => W.road[i] || W.paved[i] || W.bridge[i];
const wet = (W, i) => W.type[i] === T_WATER;

// distance (in tiles) from each water tile to the nearest bank
function shoreDist(W) {
  if (W.shoreD) return W.shoreD;
  const d = W.shoreD = new Uint8Array(N * N).fill(255), q = [];
  for (let i = 0; i < N * N; i++) if (!wet(W, i)) { d[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const c = q[h], x = tileX(c), z = tileZ(c);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz; if (!inMap(nx, nz)) continue;
      const j = idx(nx, nz); if (d[j] <= d[c] + 1) continue;
      d[j] = d[c] + 1; q.push(j);
    }
  }
  return d;
}

// trees and bushes on neighbouring tiles whose canopy would sit on the road / bridge
function clearAround(sim, i, r) {
  const W = sim.world, x = tileX(i), z = tileZ(i), cx = x - N / 2 + 0.5, cz = z - N / 2 + 0.5;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, nz = z + dz; if (!inMap(nx, nz)) continue;
    const j = idx(nx, nz);
    const t = W.tree[j] >= 0 ? W.trees[W.tree[j]] : null, b = W.bush[j] >= 0 ? W.bushes[W.bush[j]] : null;
    if (t && Math.hypot(t.x - cx, t.z - cz) < r + 0.25) { sim.fellTree(W.tree[j], false); sim.add('wood', 2, false); }
    if (b && Math.hypot(b.x - cx, b.z - cz) < r) sim.clearBush(W.bush[j]);
    sim.emit('tile', j);
  }
}

// a road may be laid inside a settlement, or anywhere next to an existing road
function connected(sim, i) {
  const W = sim.world, x = tileX(i), z = tileZ(i);
  if (sim.settlementAt(x, z)) return true;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dz) && inMap(x + dx, z + dz) && isRoad(W, idx(x + dx, z + dz))) return true;
  }
  return false;
}

// why a road can't go here (or '' if it can)
export function roadBlock(sim, i) {
  const W = sim.world;
  if (W.rock[i] >= 0) return 'A boulder is in the way';
  if (W.occ[i] >= 0 && W.block[i]) return 'A building is in the way';
  if (!connected(sim, i)) return 'Roads must join a road or a settlement';
  if (wet(W, i) && shoreDist(W)[i] > MAX_SPAN) return 'Too far from the bank for a bridge';
  return '';
}

// lay (on) or lift (off) a dirt road / bridge. Returns true, false, or a reason string.
export function paintRoad(sim, i, on) {
  const W = sim.world, s = sim.s, st = s.stats;
  if (on) {
    if (isRoad(W, i)) return false;
    const why = roadBlock(sim, i); if (why) return why;
    if (wet(W, i)) {
      if ((s.res.planks || 0) < BRIDGE_PLANKS) return 'planks';
      s.res.planks -= BRIDGE_PLANKS; sim.track('planks', -BRIDGE_PLANKS);
      W.bridge[i] = PLAYER; W.wear[i] = 1; W.massDirty = true;
      st.bridges = (st.bridges || 0) + 1;
      clearAround(sim, i, 1.25);
      sim.emit('bridge', i);
    } else {
      W.road[i] = PLAYER; W.wear[i] = 1;
      if (W.tree[i] >= 0) { sim.fellTree(W.tree[i], false); sim.add('wood', 2, false); }
      if (W.bush[i] >= 0) sim.clearBush(W.bush[i]);
      clearAround(sim, i, 0.62);
    }
    st.roads = (st.roads || 0) + 1;
  } else {
    if (W.bridge[i] === PLAYER) {
      W.bridge[i] = 0; W.wear[i] = 0; W.massDirty = true; s.res.planks += BRIDGE_PLANKS; sim.track('planks', BRIDGE_PLANKS);
      sim.emit('bridge', i);
    } else if (W.road[i] === PLAYER && !W.paved[i]) { W.road[i] = 0; W.wear[i] = 0.55; }
    else return false;
  }
  sim.emit('tile', i); sim.emit('res');
  return true;
}

// cobble (on) or lift cobbles (off). Cobbles make a road; lifting them leaves the dirt road.
export function paintCobble(sim, i, on) {
  const W = sim.world, s = sim.s;
  if (on) {
    if (W.paved[i] || wet(W, i)) return false;
    if (W.block[i] || W.rock[i] >= 0) return false;
    if (!W.road[i]) { const why = roadBlock(sim, i); if (why) return why; }
    if ((s.res.stone || 0) < COBBLE_STONE) return 'stone';
    s.res.stone -= COBBLE_STONE; sim.track('stone', -COBBLE_STONE);
    W.paved[i] = 1; if (!W.road[i]) { W.road[i] = PLAYER; s.stats.roads = (s.stats.roads || 0) + 1; }
    W.wear[i] = 1;
    s.stats.paved = (s.stats.paved || 0) + 1;
    if (W.tree[i] >= 0) sim.fellTree(W.tree[i], false);
    if (W.bush[i] >= 0) sim.clearBush(W.bush[i]);
  } else {
    if (!W.paved[i]) return false;
    W.paved[i] = 0; s.res.stone += COBBLE_STONE; sim.track('stone', COBBLE_STONE);
  }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inMap(tileX(i) + dx, tileZ(i) + dz)) sim.emit('tile', idx(tileX(i) + dx, tileZ(i) + dz));
  sim.emit('tile', i); sim.emit('res');
  return true;
}

// planning costs for carts: roads are cheap, open country slow, forest very slow
export function cartCost(W) {
  return (i, c) => W.paved[i] ? 0.35 : (W.road[i] || W.bridge[i]) ? 0.45 : c * 3.2;
}

// how many tiles of road / cobble / bridge the player has laid (for the UI)
export function roadCounts(W) {
  let road = 0, cob = 0, br = 0;
  for (let i = 0; i < N * N; i++) { if (W.road[i] === PLAYER && !W.paved[i]) road++; if (W.paved[i]) cob++; if (W.bridge[i] === PLAYER) br++; }
  return { road, cob, br };
}

// saving: player roads and bridges ride along in the world block
export function installRoads(sim, save) {
  const W = sim.world;
  for (const i of save?.world?.proads || []) { if (!wet(W, i)) { W.road[i] = PLAYER; W.wear[i] = 1; } }
  for (const i of save?.world?.pbridges || []) { if (wet(W, i)) { W.bridge[i] = PLAYER; W.wear[i] = 1; } }
  W.massDirty = true;
  const ser = sim.serialize.bind(sim);
  sim.serialize = () => {
    const out = ser();
    out.world.proads = []; out.world.pbridges = []; out.world.ntrees = sim.origTrees;
    for (let i = 0; i < N * N; i++) { if (W.road[i] === PLAYER) out.world.proads.push(i); if (W.bridge[i] === PLAYER) out.world.pbridges.push(i); }
    return out;
  };
}
