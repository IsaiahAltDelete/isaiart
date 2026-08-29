// world/battlemap.js — builds the small tactical arena a fight happens on.
//
// When an encounter triggers, we don't fight on the whole overworld map: we cut a
// battlefield that *looks* like where you were standing (a forest clearing on the
// Triboar Trail, a flagstone chamber in Undermountain) and lay out deployment
// zones. Cover, difficult terrain and elevation all come from real tiles so the
// tactical rules in rules/actions.js have something to read.

import { TileMap, TF } from './tilemap.js';
import { T, TILES } from '../render/tiles.js';
import { makeRNG } from '../core/rng.js';

export const ARENA_W = 22;
export const ARENA_H = 15;

/** Tile palettes per biome: [floor variants], [scatter cover], [difficult terrain], [blocking]. */
const PALETTES = {
  plains: { floor: ['GRASS', 'GRASS_2', 'CLOVER'], cover: ['ROCK', 'BUSH'], rough: ['GRASS_TALL'], block: ['BOULDER'], edge: 'GRASS_TALL' },
  road: { floor: ['DIRT_PATH', 'DIRT', 'GRASS'], cover: ['ROCK', 'CART', 'BARREL'], rough: ['MUD'], block: ['BOULDER'], edge: 'GRASS' },
  forest: { floor: ['GRASS', 'GRASS_2', 'DIRT'], cover: ['BUSH', 'STUMP', 'ROCK'], rough: ['GRASS_TALL', 'DIRT'], block: ['TREE_OAK', 'BOULDER'], edge: 'TREE_OAK' },
  'pine-forest': { floor: ['GRASS', 'DIRT', 'SNOW_GRASS'], cover: ['BUSH', 'STUMP'], rough: ['GRASS_TALL'], block: ['TREE_PINE'], edge: 'TREE_PINE' },
  hills: { floor: ['GRASS', 'DIRT', 'GRAVEL'], cover: ['ROCK', 'BOULDER'], rough: ['GRAVEL'], block: ['CLIFF'], edge: 'ROCK' },
  mountain: { floor: ['GRAVEL', 'STONE_FLOOR', 'DIRT'], cover: ['ROCK', 'BOULDER'], rough: ['GRAVEL'], block: ['CLIFF', 'BOULDER'], edge: 'CLIFF' },
  marsh: { floor: ['MUD', 'SWAMP_WATER', 'DIRT'], cover: ['REEDS', 'DEAD_TREE'], rough: ['MUD', 'SWAMP_WATER'], block: ['DEAD_TREE'], edge: 'REEDS' },
  coast: { floor: ['SAND', 'GRASS', 'GRAVEL'], cover: ['ROCK', 'DRIFTWOOD'], rough: ['SAND'], block: ['BOULDER'], edge: 'WATER' },
  ruins: { floor: ['FLAGSTONE', 'DIRT', 'GRAVEL'], cover: ['RUINED_WALL', 'PILLAR', 'RUBBLE'], rough: ['GRAVEL'], block: ['RUINED_WALL', 'PILLAR'], edge: 'RUINED_WALL' },
  cave: { floor: ['CAVE_FLOOR', 'CAVE_FLOOR_RUBBLE'], cover: ['STALAGMITE', 'ROCK'], rough: ['CAVE_FLOOR_RUBBLE'], block: ['CAVE_WALL', 'STALAGMITE'], edge: 'CAVE_WALL' },
  dungeon: { floor: ['DUNGEON_FLOOR', 'STONE_FLOOR', 'STONE_FLOOR_CRACKED'], cover: ['PILLAR', 'RUBBLE', 'CRATE'], rough: ['STONE_FLOOR_CRACKED'], block: ['DUNGEON_WALL', 'PILLAR'], edge: 'DUNGEON_WALL' },
  crypt: { floor: ['STONE_FLOOR', 'BONE_FLOOR'], cover: ['SARCOPHAGUS', 'PILLAR', 'BONES'], rough: ['BONE_FLOOR'], block: ['TOMB', 'PILLAR'], edge: 'DUNGEON_WALL' },
  mine: { floor: ['CAVE_FLOOR', 'GRAVEL'], cover: ['CRATE', 'ORE_IRON', 'ROCK'], rough: ['CAVE_FLOOR_RUBBLE'], block: ['CAVE_WALL', 'TIMBER_SUPPORT'], edge: 'CAVE_WALL' },
  'ash-waste': { floor: ['ASH_GROUND', 'ASH_DRIFT'], cover: ['DEAD_TREE', 'ROCK'], rough: ['ASH_DRIFT'], block: ['DEAD_TREE', 'BOULDER'], edge: 'DEAD_TREE' },
  tundra: { floor: ['SNOW', 'ICE', 'SNOW_GRASS'], cover: ['ROCK', 'DEAD_TREE'], rough: ['SNOW'], block: ['BOULDER'], edge: 'DEAD_TREE' },
  underdark: { floor: ['CAVE_FLOOR', 'DUNGEON_FLOOR'], cover: ['CRYSTAL', 'STALAGMITE'], rough: ['CAVE_FLOOR_RUBBLE'], block: ['CAVE_WALL', 'CRYSTAL'], edge: 'CAVE_WALL' },
  city: { floor: ['COBBLE', 'FLAGSTONE'], cover: ['BARREL', 'CRATE', 'CART'], rough: [], block: ['STONE_WALL'], edge: 'STONE_WALL' },
};

/** Resolve a palette entry name to a real tile id, falling back gracefully. */
function tid(name, fallback = 'GRASS') {
  return T[name] != null ? T[name] : (T[fallback] != null ? T[fallback] : 1);
}

/**
 * Ground-layer tiles must be fully opaque 16x16 fills. A 'deco' tile (a bush, a
 * pile of rubble) is drawn with transparency, so writing one to the ground layer
 * punches a black hole in the field. Resolve to the tile only if it really is a
 * ground tile, otherwise fall back.
 */
function groundTid(name, fallbackName) {
  const id = T[name];
  const def = id != null ? TILES[id] : null;
  const layer = def?.layer || 'ground';
  if (id != null && layer === 'ground') return id;
  return tid(fallbackName, 'GRASS');
}

function paletteFor(biome) {
  return PALETTES[biome] || PALETTES.plains;
}

/**
 * Build a battlefield.
 *  opts: { biome, seed, indoor, ambush, boss, depth, sourceMap, sourceX, sourceY }
 * Returns a TileMap with `deploy` zones attached:
 *   map.deploy = { party:[{x,y}], foe:[{x,y}] }
 */
export function buildBattleMap(opts = {}) {
  const biome = opts.biome || 'plains';
  const r = makeRNG(opts.seed != null ? opts.seed : `battle-${Date.now()}`);
  const pal = paletteFor(biome);
  const indoor = opts.indoor ?? ['cave', 'dungeon', 'crypt', 'mine', 'underdark'].includes(biome);

  const map = new TileMap({
    w: ARENA_W, h: ARENA_H,
    name: 'Battlefield', biome, indoor,
    music: opts.boss ? 'boss' : 'battle',
  });

  // --- floor ---------------------------------------------------------------
  for (let y = 0; y < ARENA_H; y++) {
    for (let x = 0; x < ARENA_W; x++) {
      map.set('ground', x, y, groundTid(r.pick(pal.floor), pal.floor[0]));
    }
  }

  // --- border --------------------------------------------------------------
  // A ring of scenery frames the arena and stops anyone walking off the edge.
  const edge = tid(pal.edge, pal.block[0]);
  for (let x = 0; x < ARENA_W; x++) {
    map.set('deco', x, 0, edge); map.setFlag(x, 0, TF.SOLID);
    map.set('deco', x, ARENA_H - 1, edge); map.setFlag(x, ARENA_H - 1, TF.SOLID);
  }
  for (let y = 0; y < ARENA_H; y++) {
    map.set('deco', 0, y, edge); map.setFlag(0, y, TF.SOLID);
    map.set('deco', ARENA_W - 1, y, edge); map.setFlag(ARENA_W - 1, y, TF.SOLID);
  }

  // --- interior features ---------------------------------------------------
  // Keep the two deployment strips (columns 2–5 and 16–19) mostly clear so the
  // opening turn is never a wall of scenery.
  const clearBand = (x) => (x >= 2 && x <= 5) || (x >= ARENA_W - 6 && x <= ARENA_W - 3);

  const blockers = Math.round(r.int(4, 9) * (indoor ? 1.15 : 1));
  for (let i = 0; i < blockers; i++) {
    const x = r.int(2, ARENA_W - 3), y = r.int(2, ARENA_H - 3);
    if (clearBand(x) && r.chance(0.75)) continue;
    if (map.flagAt(x, y) & TF.SOLID) continue;
    map.set('deco', x, y, tid(r.pick(pal.block)));
    map.setFlag(x, y, TF.SOLID);
    // Clusters read better than lone pixels — sometimes grow one neighbour.
    if (r.chance(0.45)) {
      const nx = x + r.pick([-1, 1]), ny = y + r.pick([-1, 0, 1]);
      if (map.inBounds(nx, ny) && !(map.flagAt(nx, ny) & TF.SOLID) && !clearBand(nx)) {
        map.set('deco', nx, ny, tid(r.pick(pal.block)));
        map.setFlag(nx, ny, TF.SOLID);
      }
    }
  }

  // Half-cover scatter: doesn't block movement, grants +2 AC via hasCover().
  const covers = r.int(5, 11);
  for (let i = 0; i < covers && pal.cover.length; i++) {
    const x = r.int(2, ARENA_W - 3), y = r.int(2, ARENA_H - 3);
    if (map.flagAt(x, y) & TF.SOLID) continue;
    map.set('deco', x, y, tid(r.pick(pal.cover)));
    map.setFlag(x, y, TF.LEDGE);     // LEDGE bit is reused as the "half cover" marker
  }

  // Difficult terrain patches.
  if (pal.rough.length) {
    const patches = r.int(1, 3);
    for (let p = 0; p < patches; p++) {
      const cx = r.int(3, ARENA_W - 4), cy = r.int(3, ARENA_H - 4), rad = r.int(1, 2);
      for (let y = cy - rad; y <= cy + rad; y++) {
        for (let x = cx - rad; x <= cx + rad; x++) {
          if (!map.inBounds(x, y) || (map.flagAt(x, y) & TF.SOLID)) continue;
          if (Math.hypot(x - cx, y - cy) > rad + 0.35) continue;
          map.set('ground', x, y, groundTid(r.pick(pal.rough), pal.floor[0]));
          map.setFlag(x, y, TF.SLOW);
        }
      }
    }
  }

  // A water feature outdoors, occasionally — it splits the field interestingly.
  if (!indoor && r.chance(0.22) && T.WATER != null) {
    const vertical = r.chance(0.5);
    const at = vertical ? r.int(8, ARENA_W - 9) : r.int(5, ARENA_H - 6);
    const len = vertical ? ARENA_H : ARENA_W;
    const gap = r.int(2, len - 4);
    for (let i = 1; i < len - 1; i++) {
      if (i >= gap && i <= gap + 2) continue;          // a ford to cross at
      const x = vertical ? at : i, y = vertical ? i : at;
      if (map.flagAt(x, y) & TF.SOLID) continue;
      map.set('ground', x, y, T.WATER);
      map.clearFlag(x, y, TF.SLOW);
      map.setFlag(x, y, TF.WATER | TF.SLOW);
    }
  }

  // --- deployment ----------------------------------------------------------
  map.deploy = layoutDeployment(map, r, opts);
  map.spawn = map.deploy.party[0] || { x: 3, y: 7 };
  map.arena = true;
  return map;
}

/**
 * Choose standing spots. Normally the party forms up on the left and the foes on
 * the right; on an ambush the enemies surround the party instead.
 */
function layoutDeployment(map, r, opts) {
  const party = [];
  const foe = [];
  const free = (x, y) => map.inBounds(x, y) && !(map.flagAt(x, y) & (TF.SOLID | TF.WATER))
    && !party.some((p) => p.x === x && p.y === y) && !foe.some((p) => p.x === x && p.y === y);

  const midY = Math.floor(ARENA_H / 2);

  if (opts.ambush) {
    // Party bunched in the middle, enemies ringed around them.
    const cx = Math.floor(ARENA_W / 2), cy = midY;
    const offs = [[0, 0], [-1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, 0], [1, 1]];
    for (const [dx, dy] of offs) {
      if (party.length >= 4) break;
      if (free(cx + dx, cy + dy)) party.push({ x: cx + dx, y: cy + dy });
    }
    for (let ring = 3; ring <= 6 && foe.length < 10; ring++) {
      for (let a = 0; a < 12 && foe.length < 10; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(ang) * ring);
        const y = Math.round(cy + Math.sin(ang) * ring * 0.7);
        if (free(x, y)) foe.push({ x, y });
      }
    }
  } else {
    // Two staggered ranks facing off, so front-liners are naturally in front.
    const cols = [3, 2, 4, 3];
    const rows = [midY, midY - 1, midY + 1, midY - 2, midY + 2, midY - 3, midY + 3];
    for (let i = 0; i < 4; i++) {
      const cx = cols[i % cols.length];
      for (const ry of rows) {
        if (party.length > i) break;
        if (free(cx, ry)) { party.push({ x: cx, y: ry }); break; }
      }
    }
    const fcols = [ARENA_W - 4, ARENA_W - 3, ARENA_W - 5, ARENA_W - 4, ARENA_W - 6];
    for (let i = 0; i < 10; i++) {
      const cx = fcols[i % fcols.length];
      for (const ry of r.shuffle(rows)) {
        if (foe.length > i) break;
        if (free(cx, ry)) { foe.push({ x: cx, y: ry }); break; }
      }
    }
  }

  // Backstops in case a cluttered map starved the loops.
  while (party.length < 4) {
    const x = r.int(2, 5), y = r.int(2, ARENA_H - 3);
    if (free(x, y)) party.push({ x, y }); else break;
  }
  while (foe.length < 8) {
    const x = r.int(ARENA_W - 6, ARENA_W - 3), y = r.int(2, ARENA_H - 3);
    if (free(x, y)) foe.push({ x, y }); else break;
  }
  return { party, foe };
}

/**
 * Pick the biome for a fight from where it started, so an ambush on the road
 * fights on a road, and a fight in Wave Echo Cave fights in a mine.
 */
export function biomeForBattle(map, x, y) {
  if (!map) return 'plains';
  if (map.biome) return map.biome;
  return map.indoor ? 'dungeon' : 'plains';
}
