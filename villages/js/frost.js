// Frostpeak Pass: a snowbound settlement up in the mountains in a far corner of the map, snowy all year.
// Like Pearl Isle it's derived from the map after generation, with no change to the base map's trees,
// so every old save still lines up: the ridges only raise ground heights (rebuilt on every load) and
// the glade is cleared of trees when it's settled. Sim-side only: no DOM or Three.js.
//
// Its specialty: miners break more stone and turn up iron ore. Its dangers: every night the pass
// burns a log a head from its woodpile, and if it runs short everyone shivers (happiness falls and
// they wake up cold); and wolves come down from the peaks in bigger packs than anywhere else.
import { N, idx, inMap, CENTERS, T_WATER, toWorld } from './world.js';
import { SETTLEMENTS } from './data.js';
import { fbm } from './rng.js';

export const FROST_DEF = {
  id: 'frost', name: 'Frostpeak Pass', unlock: { lvl: 10, cost: { coins: 2200, planks: 220, bricks: 90 } },
  blurb: 'A snowbound pass in the mountains. Cold and full of wolves, but rich in iron.', cold: true,
  spec: { job: 'miner', mult: 1.2, name: 'Iron', icon: 'ore', desc: 'Mountain seams: miners here break 20% more stone and dig up iron ore as well.', ore: true },
};
export const FROST_R = 6, SNOW_R = 25;   // the glade, and how far the snow reaches
export const FIREWOOD = 1;               // logs burned a night for each person living at the pass

// the spot furthest from every other settlement with no water near it, well inside the map
export function findFrostSite(W, centers = CENTERS) {
  let best = null;
  const others = Object.entries(centers).filter(([k]) => k !== 'frost').map(([, c]) => c);
  for (let z = 9; z <= N - 10; z += 2) for (let x = 9; x <= N - 10; x += 2) {   // tucked up against the edge, so the mountains beyond it loom over the glade
    const far = Math.min(...others.map(c => Math.hypot(c.x - x, c.z - z)), Math.hypot(95 - x, 58 - z) + 6);
    if (far < 26 || (best && far <= best.far)) continue;
    let dry = true;
    for (let dz = -9; dz <= 9 && dry; dz++) for (let dx = -9; dx <= 9 && dry; dx++) {
      if (dx * dx + dz * dz > 81 || !inMap(x + dx, z + dz)) continue;
      if (W.type[idx(x + dx, z + dz)] === T_WATER || W.bridge?.[idx(x + dx, z + dz)]) dry = false;
    }
    if (dry) best = { x, z, far };
  }
  return best;
}

// how high the mountains stand at a tile corner: a ring of ridges round the glade, open toward home
export function ridgeAt(F, x, z, seed = 0) {
  const d = Math.hypot(x - F.x, z - F.z);
  if (d < F.r + 1.5 || d > F.R) return 0;
  const a = Math.atan2(z - F.z, x - F.x);
  let off = Math.abs(a - F.passA); off = Math.min(off, Math.PI * 2 - off);
  const notch = 0.15 + 0.85 * Math.min(1, Math.max(0, (off - 0.22) / 0.4));   // the pass itself stays low
  const rise = Math.min(1, (d - F.r - 1.5) / 4), fall = Math.min(1, (F.R - d) / 4.5);
  const peaks = 0.55 + 0.9 * fbm(x * 0.18 + 3, z * 0.18 - 7, seed + 97);
  return 1.7 * rise * fall * notch * peaks;
}

// Add the pass to a freshly generated World. Returns the frost record, or null if no corner has room.
export function applyFrost(W) {
  const k = SETTLEMENTS.findIndex(s => s.id === 'frost');
  if (k >= 0) SETTLEMENTS.splice(k, 1);
  delete CENTERS.frost;
  const site = findFrostSite(W);
  if (!site) { W.frost = null; return null; }
  const home = CENTERS.meadow || { x: N / 2, z: N / 2 };
  const F = W.frost = { x: site.x, z: site.z, r: FROST_R, R: Math.min(SNOW_R, Math.max(15, Math.round(site.far) - 9)),   // the snow stops well short of any neighbour
    passA: Math.atan2(home.z - site.z, home.x - site.x), raised: [] };   // raised: [corner, height before]
  CENTERS.frost = { x: site.x, z: site.z, r: FROST_R };
  SETTLEMENTS.push(FROST_DEF);
  // raise the ridges: only on dry ground (corners that touch water keep their banks)
  const V = N + 1;
  for (let z = Math.floor(F.z - F.R - 1); z <= F.z + F.R + 1; z++) for (let x = Math.floor(F.x - F.R - 1); x <= F.x + F.R + 1; x++) {
    if (x < 0 || z < 0 || x > N || z > N) continue;
    let wet = false;
    for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const tx = x + dx, tz = z + dz; if (inMap(tx, tz) && W.type[idx(tx, tz)] === T_WATER) wet = true; }
    const dh = wet ? 0 : ridgeAt(F, x, z, W.seed);
    if (dh) { F.raised.push([z * V + x, W.hv[z * V + x]]); W.hv[z * V + x] += dh; }
  }
  return F;
}

// how snowy the ground is at a world position (1 in the pass, fading out by the snow line)
export function frostAt(F, wx, wz) {
  if (!F) return 0;
  const d = Math.hypot(wx + N / 2 - F.x, wz + N / 2 - F.z);
  return Math.max(0, Math.min(1, (F.R - d) / (F.R * 0.28)));
}

// how many nights the pass's woodpile will keep its people warm
export function woodpileNights(sim) {
  const folk = sim.s.villagers.filter(v => v.home === 'frost').length;
  return { folk, wood: Math.floor(sim.s.stock?.frost?.wood || 0), nights: folk ? Math.floor((sim.s.stock?.frost?.wood || 0) / (folk * FIREWOOD)) : Infinity };
}

export function installFrost(sim) {
  const s = sim.s, F = sim.world.frost;
  if (!F) return;
  const c = CENTERS.frost;
  // settling: clear a glade in the pines first, so the campfire and the first homes have room
  const unlock = sim.unlock.bind(sim);
  sim.unlock = (sid, free = false) => {
    if (sid === 'frost' && !s.unlocked.frost && (free || (s.level >= FROST_DEF.unlock.lvl && sim.canAfford(FROST_DEF.unlock.cost)))) clearGlade(sim, c);
    return unlock(sid, free);
  };
  // nightfall at the pass: the woodpile burns, and the wolves come down
  const night = sim.beastNight.bind(sim);
  sim.beastNight = () => {
    night();
    if (!s.unlocked.frost) return;
    sim.frostNight();
  };
  // dusk: a warning while there's still time to send wood up the pass
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    if (!s.unlocked.frost) return;
    const day = Math.floor(s.time / 240), f = (s.time % 240) / 240;
    if (f >= 0.78 && f < 0.94 && sim._frostWarned !== day) {
      sim._frostWarned = day;
      const w = woodpileNights(sim);
      if (w.folk && w.nights < 1) sim.emit('toast', `${sim.sname('frost')}'s woodpile won't last the night: it needs ${w.folk * FIREWOOD} wood, and has ${w.wood}.`, 'snow');
      else if (w.folk && w.nights < 2) sim.emit('toast', `${sim.sname('frost')} has firewood for one more night.`, 'wood');
    }
  };
  sim.frostNight = () => {
    const folk = s.villagers.filter(v => v.home === 'frost'), need = folk.length * FIREWOOD;
    if (need) {
      const st = (s.stock.frost ||= {}), have = st.wood || 0, burn = Math.min(have, need);
      st.wood = have - burn; s.res.wood = Math.max(0, (s.res.wood || 0) - burn);
      if (burn < need) {
        for (const v of folk) v.cold = s.time + 120;
        // the whole realm frets, in proportion to how many people were out in the cold
        s.happiness = Math.max(0, s.happiness - Math.max(0.5, 3 * folk.length / Math.max(1, s.villagers.length)));
        sim.log(`${sim.sname('frost')} ran out of firewood and shivered through the night. Bring wood up the pass!`, 'snow');
        sim.emit('toast', `${sim.sname('frost')} is out of firewood!`, 'snow');
      }
      sim.emit('res');
    }
    if ((s.wardUntil || 0) > s.time || Math.floor(s.time / 240) < 2 || sim.rng() > 0.45) return;
    const n = 2 + ((sim.rng() * 3) | 0);
    for (let tries = 0; tries < 30; tries++) {
      // down from the peaks behind the pass if there's ground there, otherwise out of the woods on any side
      const a = tries < 12 ? F.passA + Math.PI + (sim.rng() - 0.5) * 2.4 : sim.rng() * Math.PI * 2, r = sim.settlementRadius('frost') + 3 + sim.rng() * 5;
      const tx = Math.round(c.x + Math.cos(a) * r), tz = Math.round(c.z + Math.sin(a) * r);
      if (!inMap(tx, tz) || !sim.world.passable(idx(tx, tz))) continue;
      for (let k = 0; k < n; k++) sim.spawnBeast('wolf', 'frost', toWorld(tx) + (k - n / 2) * 0.6, toWorld(tz) + k * 0.4);
      sim.log(`A pack of ${n} wolves came down from the peaks toward ${sim.sname('frost')}!`, 'alert');
      sim.emit('toast', `Wolves at ${sim.sname('frost')}!`, 'alert');
      sim.emit('sfx', 'howl');
      break;
    }
  };
}

function clearGlade(sim, c) {
  const W = sim.world;
  for (let ti = 0; ti < W.trees.length; ti++) {
    const t = W.trees[ti];
    if (t.alive && Math.hypot(t.tx - c.x, t.tz - c.z) <= c.r + 0.5) sim.fellTree(ti, false);
  }
}
