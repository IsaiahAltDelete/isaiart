// world/maps.js — the hand-authored places of the Sword Coast: Phandalin and its
// interiors, the Triboar Trail, Neverwinter Wood, Conyberry, the mouth of Wave
// Echo Cave, the Protector's Enclave, the Trades Ward — plus the warp graph that
// stitches them together and the loader that caches them, re-applies your save
// file over them and populates them with the cast from data/npcs.js.
//
// CONTRACT
//   MAP_DEFS[id]   -> { id, name, kind, biome, w, h, indoor, music, level, build(r, ctx) }
//   loadMap(id, o) -> TileMap        (cached; unknown ids fall through to mapgen)
//   WORLD_NODES    -> [{ from, fromXY, to, toXY, dir }]  — every warp, both ways
//   mapMeta(id)    -> descriptor, invented on the spot for procedural ids
//   clearMapCache(id?)
//
// RULES OBSERVED HERE
//   * Nothing calls Math.random(). Every builder gets an RNG forked from the
//     world seed, so a campaign rebuilds the same Phandalin every session.
//   * Tile ids are resolved through mapgen's `tid()`, which returns the first
//     name that actually exists in render/tiles.js — a renamed decoration
//     degrades to grass instead of throwing.
//   * Planes are painted raw, then `recomputeFlags()` derives walkability from
//     the tile definitions, then triggers OR their own bits in. Doors are the
//     one exception: they are stamped solid by the tileset and then explicitly
//     opened, because you walk *through* a door tile into the building.
//   * Every NPC tile listed in data/npcs.js is reserved before a single prop is
//     placed, and swept clear again afterwards. Nobody gets bricked into a wall.

import { TileMap, TF, setTileFlagResolver } from './tilemap.js';
// Region packs. Each is a self-contained file that exports REGION_MAPS (raw map
// definitions, keyed by id) and REGION_LINKS (rows in the same shape as LINKS
// below). Keeping them out of this file lets whole regions be authored in
// parallel without four agents editing one 2,000-line module.
import { REGION_MAPS as SOUTH_MAPS, REGION_LINKS as SOUTH_LINKS } from './maps_south.js';
import { REGION_MAPS as BG_MAPS, REGION_LINKS as BG_LINKS } from './maps_baldursgate.js';
import { tileFlags } from '../render/tiles.js';
import { makeRNG } from '../core/rng.js';
import { NPCEntity, EntityList } from './entity.js';
import { npcsOnMap, spawnableOnMap } from '../data/npcs.js';
import {
  tid, generateDungeon, generateCave, generateMine, generateCrypt,
  generateRuins, generateForest, generateLair, placeEncounterZones,
} from './mapgen.js';
import { Game } from '../engine.js';

// TileMap needs to know how a tile id maps to flag bits before `stamp()` or
// `recomputeFlags()` mean anything. Idempotent; main.js may have done it already.
setTileFlagResolver(tileFlags);

// ---------------------------------------------------------------------------
// 0. LOW-LEVEL PAINTING
// ---------------------------------------------------------------------------

const KEY = (x, y) => `${x},${y}`;

function gset(map, x, y, id) { if (id != null && map.inBounds(x, y)) map.ground[y * map.w + x] = id | 0; }
function dset(map, x, y, id) { if (id != null && map.inBounds(x, y)) map.deco[y * map.w + x] = id | 0; }
function oset(map, x, y, id) { if (id != null && map.inBounds(x, y)) map.over[y * map.w + x] = id | 0; }

/** Lay a floor tile and sweep whatever was standing on it. */
function floor(map, x, y, id) {
  if (!map.inBounds(x, y)) return;
  const i = y * map.w + x;
  if (id != null) map.ground[i] = id | 0;
  map.deco[i] = 0;
  map.over[i] = 0;
}

function grect(map, x, y, w, h, id) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) gset(map, i, j, id);
}
function drect(map, x, y, w, h, id) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) dset(map, i, j, id);
}
function orect(map, x, y, w, h, id) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) oset(map, i, j, id);
}
function floorRect(map, x, y, w, h, id) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) floor(map, i, j, id);
}
/** Outline only — the walls of a room, the rails of a paddock. */
function dframe(map, x, y, w, h, id) {
  for (let i = x; i < x + w; i++) { dset(map, i, y, id); dset(map, i, y + h - 1, id); }
  for (let j = y; j < y + h; j++) { dset(map, x, j, id); dset(map, x + w - 1, j, id); }
}

/** Resolve a weighted [name, weight] table to real tile ids once, up front. */
function table(rows) {
  const out = [];
  for (const [name, w] of rows) {
    const id = tid(name);
    if (id != null) out.push([id, w]);
  }
  return out;
}
function pickT(r, tbl, fallback = 0) {
  if (!tbl || !tbl.length) return fallback;
  const e = r.pickWeighted(tbl, (x) => x[1]);
  return e ? e[0] : fallback;
}

/**
 * A prop that refuses to stand on somebody's feet. `res` is the reserved-tile
 * set built from data/npcs.js; `keep` protects doors, stairs and warp pads.
 */
function prop(map, x, y, id, res) {
  if (!map.inBounds(x, y) || id == null) return false;
  if (res && res.has(KEY(x, y))) return false;
  map.deco[y * map.w + x] = id | 0;
  return true;
}

/** Scatter deco across a rect at a given density, skipping reserved tiles. */
function scatter(map, r, x, y, w, h, tbl, chance, res) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (!map.inBounds(i, j)) continue;
      if (map.deco[j * map.w + i]) continue;
      if (!r.chance(chance)) continue;
      prop(map, i, j, pickT(r, tbl), res);
    }
  }
}

/** Speckle the ground plane from a weighted table. */
function groundNoise(map, r, x, y, w, h, tbl) {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) gset(map, i, j, pickT(r, tbl));
  }
}

/**
 * Ring the map in something solid so no camera bug or pathing slip can walk the
 * party off the edge. Warp pads always sit one tile inside this ring.
 */
function sealBorder(map, fillId) {
  const id = fillId != null ? fillId : tid('BLACK', 'VOID');
  for (let x = 0; x < map.w; x++) {
    if (!map.deco[x]) dset(map, x, 0, id);
    if (!map.deco[(map.h - 1) * map.w + x]) dset(map, x, map.h - 1, id);
    map.setFlag(x, 0, TF.SOLID);
    map.setFlag(x, map.h - 1, TF.SOLID);
  }
  for (let y = 0; y < map.h; y++) {
    if (!map.deco[y * map.w]) dset(map, 0, y, id);
    if (!map.deco[y * map.w + map.w - 1]) dset(map, map.w - 1, y, id);
    map.setFlag(0, y, TF.SOLID);
    map.setFlag(map.w - 1, y, TF.SOLID);
  }
  return map;
}

/** Turn a stamped-solid door tile into something you can actually walk through. */
function openDoorway(map, x, y) {
  if (!map.inBounds(x, y)) return;
  map.clearFlag(x, y, TF.SOLID | TF.WATER | TF.SLOW | TF.DAMAGE);
  map.setFlag(x, y, TF.DOOR | TF.TRIGGER);
}

/**
 * mapgen pushes plain objects straight onto `map.triggers`, which leaves them
 * without ids, `step` hints or a lookup index. Re-add them through TileMap so
 * the overworld sees the same shape from every source.
 */
function normalizeTriggers(map) {
  try {
    const raw = (map.triggers || []).slice();
    map.clearTriggers();
    for (const t of raw) map.addTrigger(t);
  } catch (e) { try { map.reindexTriggers(); } catch (e2) { /* give up quietly */ } }
  return map;
}

/** Every NPC tile on a map, whether or not they spawn yet. Props avoid these. */
function reservedFor(id) {
  const s = new Set();
  try { for (const n of npcsOnMap(id)) s.add(KEY(n.x, n.y)); } catch (e) { /* catalogue absent */ }
  return s;
}

// ---------------------------------------------------------------------------
// 1. BUILDINGS
// ---------------------------------------------------------------------------
//
// ELEVATION. A house has to be read from the top down as five bands, and if any
// of them is missing the whole thing flattens into a sticker printed on the
// grass — which is exactly what Phandalin used to look like: a rectangle of
// roof with a single row of windows glued to the bottom of it.
//
//     ridge        the crest, capped by THATCH_RIDGE (thatch caps itself; a
//                  shingle or tile roof already paints a lit ridge course)
//     pitch        one or two more courses of roof
//     eave         the last roof course, on the `over` plane. overworld.js
//                  reads that plane in `_drawOverhangs` and drops a five-row
//                  ramp onto whatever is directly south of it, which is what
//                  turns the eave into a visible overhang — so the row below an
//                  eave must be WALL, not more roof, or the shadow lands on the
//                  roof and the building stays flat
//     wall face    one to three storeys of wall, with the windows and the sign
//     base course  a stone footing where the wall meets the ground, with the
//                  door punched through it
//
// and then, on the ground in front, a flagged step at the threshold and a beaten
// approach out to the road. Nothing here paints a shadow tile: `_drawEdges`
// already ramps the foot of every solid edge and `_drawOverhangs` the underside
// of every eave, and a ROOF_SHADOW laid on the same rows composites with them
// into a black bar. The map's job is to give those passes the right geometry.
//
// Only the base-course row is nailed down: the door has to stay on it, because
// WORLD_NODES warps to those exact coordinates and data/npcs.js spawns against
// them. Everything above it is free, so `roofRows` decides how much of a
// building is roof and how much is wall — that one number is what makes the inn
// read as two storeys and Barthen's as a long low shed.
//
// The `over` plane is drawn above the actors but contributes nothing to
// `recomputeFlags` (which reads ground and deco only), so a roof is pure paint
// and can never brick anybody in.

const ROOFS = {
  thatch: { ridge: 'THATCH_RIDGE', l: 'THATCH_L', m: 'THATCH_M', r: 'THATCH_R' },
  // These two used to cap themselves with ROOF_PEAK, which is straw-coloured:
  // it dropped a zigzag thatch fringe along the top of every red roof in town.
  // Both tiles paint their own lit ridge course, so they are their own ridge.
  shingle: { ridge: 'SHINGLE_ROOF', l: 'SHINGLE_ROOF', m: 'SHINGLE_ROOF', r: 'SHINGLE_ROOF' },
  tile: { ridge: 'TILE_ROOF', l: 'TILE_ROOF', m: 'TILE_ROOF', r: 'TILE_ROOF' },
};

/**
 * What a wall stands on. Timber gets a fieldstone footing with its own lit cap,
 * stone gets a flatter, heavier course — either way the bottom row of a facade
 * is a different material from the wall above it, which is what stops a house
 * from looking like it was pushed into the grass up to its knees.
 */
const BASE_COURSE = {
  WATTLE_WALL: 'STONE_WALL', LOG_WALL: 'STONE_WALL', PALISADE: 'STONE_WALL',
  STONE_WALL: 'WALL_TOP_SHADE', BRICK_WALL: 'WALL_TOP_SHADE', RUINED_WALL: 'WALL_TOP_SHADE',
};

/**
 * A real enterable house. The whole footprint is solid; the roof sits on the
 * `over` plane so the party walks behind it and disappears.
 *
 * b: { x, y, w, h, wall, roof:'thatch'|'shingle'|'tile', base,
 *      roofRows, peak:dx, chimney:dx, chimney2:dx, roofPatch:[[dx,dy]], patchTile,
 *      door:dx, windows:[dx], upper:[dx], shutters:[dx], loading:[dx],
 *      sign:dx, lit, course, approach }
 * Returns { door:{x,y}, front:{x,y} }.
 */
function building(map, b, res) {
  const { x, y, w, h } = b;
  const wallKey = b.wall || 'WATTLE_WALL';
  const wall = tid(wallKey, 'STONE_WALL');
  const base = tid(b.base || 'DIRT', 'DIRT');
  const rk = ROOFS[b.roof] || ROOFS.thatch;
  const course = tid(b.course || BASE_COURSE[wallKey] || 'STONE_WALL', wallKey);

  // Solid mass first: ground under it, wall through it.
  grect(map, x, y, w, h, base);
  drect(map, x, y, w, h, wall);
  orect(map, x, y, w, h, 0);

  // How much of the elevation is roof. The default leaves two rows of wall on a
  // five-high house and three on the inn; never so much roof that the wall
  // disappears, and never so little that the ridge lands on the windows.
  const want = b.roofRows != null ? b.roofRows : Math.min(3, h - 3);
  const roofRows = Math.max(1, Math.min(want, h - 2));
  const fy = y + h - 1;                            // base course; the door row
  const wallTop = y + roofRows;                    // the row the eave shadows
  const gy = Math.max(wallTop, fy - 1);            // the ground-floor wall row

  // --- roof ---------------------------------------------------------------
  // Roof goes on `over` *and* on `deco` underneath it. CHIMNEY and ROOF_PEAK
  // only paint part of their tile, and with a wall under them the gaps used to
  // show lime plaster — a chimney with a cream halo round it. Doubling the
  // course underneath means any hole in an over-tile falls through onto more
  // roof. Roof tiles are SOLID, so the footprint is exactly as solid as before.
  for (let j = 0; j < roofRows; j++) {
    for (let i = 0; i < w; i++) {
      let name;
      if (j === 0) name = rk.ridge;
      else if (i === 0) name = rk.l;
      else if (i === w - 1) name = rk.r;
      else name = rk.m;
      const id = tid(name, 'THATCH_M');
      oset(map, x + i, y + j, id);
      dset(map, x + i, y + j, id);
    }
  }
  // A single gable over the door, for a shrine or a porch. One tile only —
  // a whole row of ROOF_PEAK reads as a sawtooth, not as a roof.
  if (b.peak != null) oset(map, x + b.peak, y, tid('ROOF_PEAK', 'THATCH_RIDGE'));
  // Courses somebody patched with whatever was in the yard and never mended.
  for (const [px, py] of b.roofPatch || []) oset(map, x + px, y + py, tid(b.patchTile || 'SHINGLE_ROOF', 'THATCH_RIDGE'));
  if (b.chimney != null) oset(map, x + b.chimney, y, tid('CHIMNEY', 'THATCH_RIDGE'));
  if (b.chimney2 != null) oset(map, x + b.chimney2, y, tid('CHIMNEY', 'THATCH_RIDGE'));

  // Row `wallTop` is deliberately left clear of `over`. That is the signal
  // overworld.js `_drawOverhangs` reads: it ramps the eave's shadow down the
  // first wall row, which is the whole overhang. Paint a ROOF_SHADOW there as
  // well and the two composite into a black bar across every building in town.

  // --- the footing the wall stands on -------------------------------------
  for (let i = 0; i < w; i++) dset(map, x + i, fy, course);
  // A jetty beam between two storeys: the dark course of floor timbers a
  // Sword Coast upper storey is built out on. Without it a three-row facade is
  // just the same braced panel printed three times.
  if (b.band != null) for (let i = 0; i < w; i++) dset(map, x + i, y + b.band, tid(b.bandTile || 'LOG_WALL', wallKey));

  // --- the facade ---------------------------------------------------------
  const win = tid(b.lit ? 'WINDOW_LIT' : 'WINDOW', 'WINDOW');
  for (const dx of b.windows || []) if (dx > 0 && dx < w - 1) dset(map, x + dx, gy, win);
  if (wallTop < gy) for (const dx of b.upper || []) if (dx > 0 && dx < w - 1) dset(map, x + dx, wallTop, win);
  for (const dx of b.shutters || []) if (dx > 0 && dx < w - 1) dset(map, x + dx, gy, tid('SHUTTER', 'WINDOW'));
  // A wagon door in the base course, for a shed you back a cart up to.
  for (const dx of b.loading || []) if (dx >= 0 && dx < w) dset(map, x + dx, fy, tid('SHUTTER', 'DOOR_CLOSED'));
  if (b.sign != null) dset(map, x + b.sign, gy, tid('SIGN', 'WINDOW'));

  let door = null, front = null;
  if (b.door != null) {
    const dx = x + b.door;
    gset(map, dx, fy, tid('WOOD_FLOOR_H', 'DIRT'));
    dset(map, dx, fy, tid('DOOR_CLOSED', 'DOOR_OPEN'));
    door = { x: dx, y: fy };
    front = { x: dx, y: fy + 1 };
  }

  // --- the ground the building sits on ------------------------------------
  // The street row keeps its bare deco on purpose too: `_drawEdges` ramps the
  // foot of every solid edge onto the walkable tile beside it, so the shadow
  // the building throws across the street comes for free and never doubles.
  if (door) {
    // A flagged step at the threshold, trodden earth either side of it, and a
    // beaten approach running out to whatever road is nearest.
    const sy = fy + 1;
    const worn = tid('DIRT_PATH', 'DIRT');
    for (let i = -1; i <= 1; i++) gset(map, door.x + i, sy, worn);
    gset(map, door.x, sy, tid('FLAGSTONE', 'DIRT_PATH'));
    const run = b.approach != null ? b.approach : 2;
    for (let k = 1; k <= run; k++) {
      const py = sy + k;
      if (!map.inBounds(door.x, py) || map.deco[py * map.w + door.x]) break;
      gset(map, door.x, py, worn);
    }
  }

  if (res) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) res.add(KEY(i, j));
  return { door, front };
}

/** A house nobody can enter — shuttered, boarded, still part of the skyline. */
function shell(map, b, res) {
  const out = building(map, { ...b, door: null, windows: [], shutters: b.windows || [] }, res);
  if (b.door != null) dset(map, b.x + b.door, b.y + b.h - 1, tid('SHUTTER', 'WINDOW'));
  return out;
}

/**
 * A four-walled interior room: floor, wall ring, and an exit door punched in the
 * bottom wall. Returns { exit, spawn }.
 *
 * The ring is not one undifferentiated band of wall any more. You are looking
 * *at* the north wall, so it keeps its face; you are looking *down on* the south
 * wall, so it shows the same footing course the outside of the building stands
 * on, and the door is punched through that footing exactly as it is outside. The
 * corners get posts. The shadow the north wall throws onto the boards is not
 * painted here — overworld.js `_drawEdges` ramps the foot of every solid edge
 * already, and a second one laid on top of it just makes a black bar.
 */
function room(map, o) {
  const w = o.w != null ? o.w : map.w;
  const h = o.h != null ? o.h : map.h;
  const x = o.x || 0, y = o.y || 0;
  const fl = tid(o.floor || 'WOOD_FLOOR', 'STONE_FLOOR');
  const wallKey = o.wall || 'WATTLE_WALL';
  const wall = tid(wallKey, 'STONE_WALL');
  const course = tid(o.course || BASE_COURSE[wallKey] || 'STONE_WALL', wallKey);
  const stony = wallKey === 'STONE_WALL' || wallKey === 'BRICK_WALL';
  const post = tid(o.post || (stony ? 'PILLAR' : 'LOG_WALL'), wallKey);

  floorRect(map, x, y, w, h, fl);
  dframe(map, x, y, w, h, wall);
  for (let i = x; i < x + w; i++) dset(map, i, y + h - 1, course);
  for (const [px, py] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) dset(map, px, py, post);

  const ex = o.exit != null ? o.exit : (x + (w >> 1));
  const ey = y + h - 1;
  gset(map, ex, ey, tid('WOOD_FLOOR_H', 'DIRT'));
  dset(map, ex, ey, tid('DOOR_CLOSED', 'DOOR_OPEN'));
  // The threshold: three tiles inside the door, of whatever the floor is not —
  // flags in a boarded room, boards in a flagged one. A stone step on a stone
  // floor is a step nobody can see.
  const step = tid(o.step || (/^WOOD/.test(o.floor || 'WOOD_FLOOR') ? 'FLAGSTONE' : 'WOOD_FLOOR_H'), 'FLAGSTONE');
  for (let i = -1; i <= 1; i++) gset(map, ex + i, ey - 1, step);
  return { exit: { x: ex, y: ey }, spawn: { x: ex, y: ey - 1 } };
}

/** A paddock, orchard or field boundary with one gate. */
function fenceRect(map, x, y, w, h, gate, res) {
  const fh = tid('FENCE_H', 'HEDGE'), fv = tid('FENCE_V', 'HEDGE'), fc = tid('FENCE_CORNER', 'HEDGE');
  for (let i = x; i < x + w; i++) { prop(map, i, y, fh, res); prop(map, i, y + h - 1, fh, res); }
  for (let j = y; j < y + h; j++) { prop(map, x, j, fv, res); prop(map, x + w - 1, j, fv, res); }
  prop(map, x, y, fc, res); prop(map, x + w - 1, y, fc, res);
  prop(map, x, y + h - 1, fc, res); prop(map, x + w - 1, y + h - 1, fc, res);
  if (gate) dset(map, gate.x, gate.y, tid('GATE', 'FENCE_H'));
  return map;
}

/** A two-tile-wide oak, planted on the deco/over planes so you walk behind it. */
function bigOak(map, x, y) {
  dset(map, x, y + 1, tid('OAK_BL', 'TREE_OAK'));
  dset(map, x + 1, y + 1, tid('OAK_BR', 'TREE_OAK'));
  oset(map, x, y, tid('OAK_TL', 'TREE_OAK'));
  oset(map, x + 1, y, tid('OAK_TR', 'TREE_OAK'));
}
function bigPine(map, x, y) {
  dset(map, x, y + 1, tid('PINE_BL', 'TREE_PINE'));
  dset(map, x + 1, y + 1, tid('PINE_BR', 'TREE_PINE'));
  oset(map, x, y, tid('PINE_TL', 'TREE_PINE'));
  oset(map, x + 1, y, tid('PINE_TR', 'TREE_PINE'));
}

// ---------------------------------------------------------------------------
// 2. THE WARP GRAPH
// ---------------------------------------------------------------------------
//
// One row per doorway. Reading it: stepping on `aWarp` in map `a` lands you at
// `bLand` in map `b` facing `toB`; stepping on `bWarp` in `b` lands you at
// `aLand` in `a` facing `toA`. WORLD_NODES below expands each row into the two
// directed edges the overworld actually consumes, and `loadMap` places the warp
// triggers straight from it — so the graph and the maps can never drift apart.

const LINKS = [
  // --- Phandalin's front doors --------------------------------------------
  { a: 'phandalin', aWarp: [17, 26], aLand: [17, 27], b: 'stonehill-inn', bWarp: [10, 15], bLand: [10, 14], toB: 'up', toA: 'down', kind: 'door' },
  { a: 'phandalin', aWarp: [32, 28], aLand: [32, 29], b: 'barthens-provisions', bWarp: [9, 13], bLand: [9, 12], toB: 'up', toA: 'down', kind: 'door' },
  { a: 'phandalin', aWarp: [36, 37], aLand: [36, 38], b: 'lionshield-coster', bWarp: [9, 11], bLand: [9, 10], toB: 'up', toA: 'down', kind: 'door' },
  { a: 'phandalin', aWarp: [10, 27], aLand: [10, 28], b: 'shrine-of-luck', bWarp: [8, 13], bLand: [8, 12], toB: 'up', toA: 'down', kind: 'door' },
  { a: 'phandalin', aWarp: [8, 37], aLand: [8, 38], b: 'miners-exchange', bWarp: [9, 11], bLand: [9, 10], toB: 'up', toA: 'down', kind: 'door' },
  { a: 'phandalin', aWarp: [17, 37], aLand: [17, 38], b: 'townmasters-hall', bWarp: [9, 11], bLand: [9, 10], toB: 'up', toA: 'down', kind: 'door' },
  { a: 'phandalin', aWarp: [50, 37], aLand: [50, 38], b: 'sleeping-giant', bWarp: [9, 13], bLand: [9, 12], toB: 'up', toA: 'down', kind: 'door' },
  { a: 'phandalin', aWarp: [13, 44], aLand: [13, 45], b: 'alderleaf-farm', bWarp: [10, 17], bLand: [10, 16], toB: 'up', toA: 'down', kind: 'door' },
  { a: 'phandalin', aWarp: [48, 23], aLand: [48, 24], b: 'phandalin-manor', bWarp: [13, 25], bLand: [13, 24], toB: 'down', toA: 'down', kind: 'stairs' },

  // --- roads out of town ---------------------------------------------------
  { a: 'phandalin', aWarp: [58, 30], aLand: [57, 30], b: 'triboar-trail', bWarp: [1, 19], bLand: [3, 19], toB: 'right', toA: 'left', kind: 'road' },
  { a: 'phandalin', aWarp: [1, 20], aLand: [2, 20], b: 'neverwinter-wood', bWarp: [58, 44], bLand: [56, 44], toB: 'left', toA: 'right', kind: 'road' },

  // --- the Triboar Trail ---------------------------------------------------
  { a: 'triboar-trail', aWarp: [98, 19], aLand: [96, 19], b: 'conyberry-ruins', bWarp: [1, 16], bLand: [3, 16], toB: 'right', toA: 'left', kind: 'road' },
  { a: 'triboar-trail', aWarp: [70, 1], aLand: [70, 3], b: 'neverwinter-wood', bWarp: [30, 54], bLand: [30, 52], toB: 'up', toA: 'down', kind: 'road' },
  { a: 'triboar-trail', aWarp: [80, 38], aLand: [80, 36], b: 'wave-echo-cave-entrance', bWarp: [14, 1], bLand: [14, 3], toB: 'down', toA: 'up', kind: 'road' },

  // --- the north road ------------------------------------------------------
  { a: 'neverwinter-wood', aWarp: [30, 1], aLand: [30, 3], b: 'neverwinter', bWarp: [34, 34], bLand: [34, 32], toB: 'up', toA: 'down', kind: 'road' },
  { a: 'neverwinter', aWarp: [8, 34], aLand: [8, 32], b: 'waterdeep', bWarp: [21, 1], bLand: [21, 3], toB: 'down', toA: 'up', kind: 'road' },

  // --- the deep places -----------------------------------------------------
  { a: 'wave-echo-cave-entrance', aWarp: [14, 28], aLand: [14, 29], b: 'wave-echo-cave', bWarp: null, bLand: null, toB: 'down', toA: 'up', kind: 'cave' },
  { a: 'waterdeep', aWarp: [20, 13], aLand: [20, 15], b: 'undermountain', bWarp: null, bLand: null, toB: 'down', toA: 'up', kind: 'well', facing: 'up' },
  { a: 'phandalin-manor', aWarp: [13, 3], aLand: [13, 4], b: 'redbrand-hideout', bWarp: null, bLand: null, toB: 'down', toA: 'up', kind: 'stairs' },
];

/**
 * The full warp graph, both directions. Entries whose destination is procedural
 * (`toXY: null`) are placed by the map's own builder, which knows where the
 * generator put the stairs.
 */
/** Every doorway in the game: the Sword Coast North plus each region pack. */
const ALL_LINKS = LINKS.concat(SOUTH_LINKS || [], BG_LINKS || []);

export const WORLD_NODES = Object.freeze(ALL_LINKS.flatMap((l) => {
  const out = [];
  if (l.aWarp) {
    out.push(Object.freeze({
      id: `${l.a}>${l.b}`,
      from: l.a, fromXY: { x: l.aWarp[0], y: l.aWarp[1] },
      to: l.b, toXY: l.bLand ? { x: l.bLand[0], y: l.bLand[1] } : null,
      dir: l.toB, kind: l.kind || 'warp', facing: l.facing || null,
      auto: !!l.bLand,
    }));
  }
  if (l.bWarp) {
    out.push(Object.freeze({
      id: `${l.b}>${l.a}`,
      from: l.b, fromXY: { x: l.bWarp[0], y: l.bWarp[1] },
      to: l.a, toXY: l.aLand ? { x: l.aLand[0], y: l.aLand[1] } : null,
      dir: l.toA, kind: l.kind || 'warp', facing: null,
      auto: !!l.aLand,
    }));
  }
  return out;
}));

/** Every directed warp that leaves `mapId`. */
export function warpsFrom(mapId) { return WORLD_NODES.filter((n) => n.from === mapId); }
/** Every directed warp that arrives in `mapId`. */
export function warpsInto(mapId) { return WORLD_NODES.filter((n) => n.to === mapId); }

/** Where you should stand after travelling `from -> to`, if the graph knows. */
export function arrivalFor(fromId, toId) {
  const n = WORLD_NODES.find((w) => w.from === fromId && w.to === toId && w.toXY);
  return n ? { x: n.toXY.x, y: n.toXY.y, dir: n.dir } : null;
}

/**
 * How wide the mouth of an exit is, in tiles. A door is a door — one tile, you
 * aim for it. But a road leaving town is a road: threading a single square at
 * the end of a sixty-tile map feels like a bug even when it isn't, so roads and
 * cave mouths get a three-tile span you can hit at a walk.
 */
const EXIT_SPAN = { road: 3, cave: 3, well: 1, stairs: 1, door: 1 };

/** Lay every declared warp trigger onto a freshly built map. */
function applyWarpNodes(map, mapId) {
  for (const n of warpsFrom(mapId)) {
    if (!n.auto || !n.toXY) continue;
    const { x, y } = n.fromXY;
    if (!map.inBounds(x, y)) continue;

    const span = EXIT_SPAN[n.kind] || 1;
    const half = (span - 1) / 2;
    // Widen across the road, not along it: a warp on the left/right edge spreads
    // vertically, one on the top/bottom edge spreads horizontally.
    const vertical = n.dir === 'left' || n.dir === 'right';

    for (let o = -half; o <= half; o++) {
      const tx = vertical ? x : x + o;
      const ty = vertical ? y + o : y;
      if (!map.inBounds(tx, ty)) continue;
      // Never carve a mouth through something solid that was placed deliberately;
      // the centre tile is always opened, the shoulders only if they are clear.
      if (o !== 0 && map.solidAt(tx, ty)) continue;
      openDoorway(map, tx, ty);
      map.addTrigger({
        id: o === 0 ? n.id : `${n.id}#${o}`, kind: 'warp', x: tx, y: ty,
        facing: n.facing || null,
        data: { map: n.to, x: n.toXY.x, y: n.toXY.y, dir: n.dir, kind: n.kind },
      });
    }
    map.exits[n.to] = { x, y, dir: n.dir };
  }
  return map;
}

// ---------------------------------------------------------------------------
// 3. PHANDALIN
// ---------------------------------------------------------------------------
//
//   x:  0        10        20        30        40        50      59
//  y 6                                        [ Edermath Orchard ]
//   12   [cottage]                            (apple rows, Daran)
//   17   ------------------ east lane ------------------------------
//   19   ..... north-west road (Neverwinter Wood) .....  [ Tresendar ]
//   20        [ Stonehill Inn ]   [Dendrar]  [cottage]   [   Manor  ]
//   24   [Shrine]        [Barthen's]
//   28        town square + well
//   30   ================ THE TRIBOAR TRAIL (east) ==================
//   33   [Miner's] [Townmaster's]      [Lionshield]      [Sleeping Giant]
//   38   ------------------ south lane ------------------------------
//   41   [ Alderleaf Farm: fences, crops, halfling burrow ]  [cottages]

const TOWN_GRASS = [['GRASS', 9], ['GRASS_2', 5], ['GRASS_3', 3], ['GRASS_4', 3], ['CLOVER', 2]];
const TOWN_ROAD = [['DIRT_PATH', 8], ['DIRT', 3]];

function buildPhandalin(root) {
  const map = new TileMap({
    w: 60, h: 50, id: 'phandalin', name: 'Phandalin', biome: 'city',
    indoor: false, music: 'town', safe: true, encounterRate: 0,
    region: 'phandalin-hills',
  });
  const res = reservedFor('phandalin');
  const rg = root.fork('ground');
  const rd = root.fork('detail');
  const grass = table(TOWN_GRASS);
  const road = table(TOWN_ROAD);

  // --- 1. the hillside -----------------------------------------------------
  groundNoise(map, rg, 0, 0, 60, 50, grass);

  // Rough scrub and boulders around the rim, so the town sits in a bowl.
  scatter(map, rg, 0, 0, 60, 8, table([['TREE_OAK', 6], ['BUSH', 3], ['ROCK', 2], ['GRASS_TALL', 2]]), 0.34, res);
  scatter(map, rg, 0, 44, 60, 6, table([['TREE_OAK', 5], ['BUSH', 4], ['ROCK', 2]]), 0.22, res);
  scatter(map, rg, 0, 8, 4, 40, table([['TREE_OAK', 4], ['BUSH', 4], ['BOULDER', 2], ['ROCK', 2]]), 0.28, res);
  scatter(map, rg, 55, 8, 5, 40, table([['TREE_OAK', 4], ['BUSH', 3], ['BOULDER', 3], ['ROCK', 2]]), 0.3, res);

  // --- 2. the roads --------------------------------------------------------
  // The Triboar Trail runs straight through, east to west.
  for (let y = 29; y <= 31; y++) for (let x = 1; x <= 58; x++) floor(map, x, y, pickT(rg, road));
  // The cross street, north to the inn and south to the farm.
  for (let x = 23; x <= 25; x++) for (let y = 10; y <= 40; y++) floor(map, x, y, pickT(rg, road));
  // The north-west road out to Neverwinter Wood.
  for (let y = 19; y <= 21; y++) for (let x = 1; x <= 25; x++) floor(map, x, y, pickT(rg, road));
  // The east lane past the orchard and up to Tresendar Manor.
  for (let y = 17; y <= 18; y++) for (let x = 25; x <= 53; x++) floor(map, x, y, pickT(rg, road));
  // The south lane behind the shops.
  for (let y = 38; y <= 39; y++) for (let x = 6; x <= 53; x++) floor(map, x, y, pickT(rg, road));
  // Connectors between the trail and the south lane.
  for (const cx of [12, 31, 44]) for (let y = 31; y <= 38; y++) { floor(map, cx, y, pickT(rg, road)); floor(map, cx + 1, y, pickT(rg, road)); }
  // Down to the farm gate.
  for (let y = 39; y <= 41; y++) { floor(map, 16, y, pickT(rg, road)); floor(map, 17, y, pickT(rg, road)); }

  // --- 3. the square -------------------------------------------------------
  const cob = tid('COBBLE', 'FLAGSTONE');
  floorRect(map, 19, 27, 11, 7, cob);
  floorRect(map, 15, 27, 4, 2, tid('DIRT_PATH', 'DIRT'));   // apron in front of the inn
  floorRect(map, 8, 28, 6, 1, tid('DIRT_PATH', 'DIRT'));    // apron in front of the shrine
  prop(map, 27, 28, tid('WELL', 'FOUNTAIN'), res);
  for (const [px, py] of [[26, 27], [28, 27], [26, 29], [28, 29]]) if (rd.chance(0.5)) gset(map, px, py, tid('FLAGSTONE', 'COBBLE'));

  // --- 4. the buildings ----------------------------------------------------
  // Nine buildings and not one of them the same shape. Every footprint, door
  // offset and door row here is load-bearing — LINKS warps to them and
  // data/npcs.js stands people in front of them — so the variation is all in
  // roofRows, materials and what hangs off the front.
  building(map, {
    x: 14, y: 20, w: 8, h: 7, wall: 'WATTLE_WALL', roof: 'thatch', lit: true,
    roofRows: 3, door: 3, windows: [1, 5, 6], upper: [1, 3, 6], sign: 2, band: 4,
    chimney: 6, chimney2: 1, approach: 3,
  }, res);                            // Stonehill Inn — the tall one: two rows
                                      // of lit windows under a deep thatch roof
  building(map, {
    x: 29, y: 24, w: 7, h: 5, wall: 'WATTLE_WALL', roof: 'thatch',
    roofRows: 2, door: 3, windows: [1, 5], sign: 4, chimney: 1,
    loading: [5, 6], approach: 1,
  }, res);                            // Barthen's Provisions — a long low shed
                                      // with a wagon door in the footing
  building(map, {
    x: 33, y: 33, w: 7, h: 5, wall: 'STONE_WALL', roof: 'shingle', base: 'GRAVEL',
    roofRows: 2, door: 3, windows: [1, 5], sign: 2, chimney: 5, approach: 1,
  }, res);                            // Lionshield Coster — stone under shingle
  building(map, {
    x: 8, y: 23, w: 6, h: 5, wall: 'STONE_WALL', roof: 'thatch', base: 'GRAVEL',
    roofRows: 2, door: 2, windows: [1, 4], sign: 3, peak: 2, approach: 1,
  }, res);                            // Shrine of Luck — small stone box, one
                                      // gable peaked over the door
  building(map, {
    x: 5, y: 33, w: 7, h: 5, wall: 'STONE_WALL', roof: 'tile', base: 'GRAVEL',
    roofRows: 2, door: 3, windows: [1, 5], sign: 2, chimney: 1, approach: 1,
  }, res);                            // The Miner's Exchange — a counting-house
  building(map, {
    x: 14, y: 33, w: 8, h: 5, wall: 'WATTLE_WALL', roof: 'shingle',
    roofRows: 2, door: 3, windows: [1, 6], upper: [2, 5], sign: 4, chimney: 6, approach: 1,
  }, res);                            // Townmaster's Hall
  building(map, {
    x: 47, y: 32, w: 7, h: 6, wall: 'LOG_WALL', roof: 'thatch',
    roofRows: 3, door: 3, shutters: [1, 5], sign: 2, chimney: 1, approach: 1,
    roofPatch: [[3, 2], [4, 2]], patchTile: 'TILE_ROOF',
  }, res);                            // The Sleeping Giant — boarded windows and
                                      // a roof patched with somebody else's tiles
  oset(map, 53, 36, tid('COBWEB', 'THATCH_M'));                // and never swept
  shell(map, {
    x: 26, y: 19, w: 6, h: 3, wall: 'WATTLE_WALL', roof: 'thatch', roofRows: 1,
    door: 3, windows: [1, 4],
  }, res);                                                     // the boarded Dendrar home
  // Four cottages: two squat under a big roof, two taller with more wall.
  building(map, { x: 9, y: 12, w: 6, h: 5, wall: 'WATTLE_WALL', roof: 'thatch', roofRows: 2, windows: [1, 4], chimney: 4 }, res);
  building(map, { x: 37, y: 19, w: 6, h: 5, wall: 'WATTLE_WALL', roof: 'shingle', roofRows: 2, windows: [1, 4], chimney: 1 }, res);
  building(map, { x: 39, y: 40, w: 6, h: 5, wall: 'LOG_WALL', roof: 'thatch', roofRows: 3, windows: [1, 4], chimney: 4 }, res);
  building(map, { x: 48, y: 41, w: 6, h: 5, wall: 'WATTLE_WALL', roof: 'tile', roofRows: 3, windows: [1, 4], chimney: 1 }, res);

  // --- 5. Tresendar Manor: a burnt shell on the eastern rise ---------------
  const rubble = table([['RUBBLE', 5], ['ROCK', 3], ['BONES', 1]]);
  floorRect(map, 44, 19, 9, 9, tid('GRAVEL', 'DIRT'));
  floorRect(map, 45, 20, 7, 7, tid('STONE_FLOOR_CRACKED', 'STONE_FLOOR'));
  dframe(map, 44, 19, 9, 9, tid('RUINED_WALL', 'STONE_WALL'));
  floor(map, 48, 19, tid('FLAGSTONE', 'STONE_FLOOR'));         // the broken gate
  floor(map, 48, 18, tid('FLAGSTONE', 'COBBLE'));
  for (const [px, py] of [[45, 21], [51, 22], [46, 26], [50, 26], [45, 25]]) prop(map, px, py, pickT(rd, rubble), res);
  prop(map, 46, 20, tid('PILLAR', 'RUBBLE'), res);
  prop(map, 50, 20, tid('PILLAR', 'RUBBLE'), res);
  prop(map, 44, 28, tid('DEAD_TREE', 'TREE_OAK'), res);
  floor(map, 48, 23, tid('STAIRS_DOWN', 'FLAGSTONE'));         // down into the Redbrand hideout
  for (let y = 24; y <= 26; y++) floor(map, 48, y, tid('STONE_FLOOR', 'FLAGSTONE'));
  scatter(map, rd, 41, 28, 12, 3, table([['ROCK', 4], ['BUSH', 3], ['GRASS_TALL', 3]]), 0.3, res);

  // --- 6. Edermath Orchard -------------------------------------------------
  floorRect(map, 40, 6, 14, 11, tid('GRASS_3', 'GRASS'));
  groundNoise(map, rg, 41, 7, 12, 9, table([['GRASS_3', 6], ['CLOVER', 4], ['GRASS', 3]]));
  for (const ty of [8, 10, 12, 14]) {
    for (let tx = 41; tx <= 51; tx += 2) prop(map, tx, ty, tid('TREE_OAK', 'BUSH'), res);
  }
  fenceRect(map, 40, 6, 14, 11, { x: 46, y: 16 }, res);
  prop(map, 45, 17, tid('SIGN', 'FENCE_H'), res);
  prop(map, 52, 15, tid('BERRY_BUSH', 'BUSH'), res);
  prop(map, 42, 15, tid('CART', 'CRATE'), res);
  prop(map, 41, 16, tid('BARREL', 'CRATE'), res);

  // --- 7. Alderleaf Farm ---------------------------------------------------
  floorRect(map, 10, 42, 15, 5, tid('FARMLAND', 'DIRT'));
  for (let y = 42; y <= 46; y++) for (let x = 18; x <= 24; x++) gset(map, x, y, tid(rd.chance(0.6) ? 'CROP_WHEAT' : 'CROP_CABBAGE', 'FARMLAND'));
  for (let x = 10; x <= 12; x++) gset(map, x, 46, tid('CROP_CABBAGE', 'FARMLAND'));
  // the path in from the gate, and west to the burrow door
  for (let y = 41; y <= 45; y++) floor(map, 16, y, tid('DIRT_PATH', 'DIRT'));
  for (let x = 13; x <= 16; x++) floor(map, x, 45, tid('DIRT_PATH', 'DIRT'));
  // the halfling burrow: a turfed mound with a round door in the south face
  const hedge = tid('HEDGE', 'BUSH');
  for (let x = 11; x <= 15; x++) prop(map, x, 43, hedge, res);
  for (const hx of [11, 12, 14, 15]) prop(map, hx, 44, hedge, res);
  gset(map, 13, 44, tid('WOOD_FLOOR_H', 'DIRT'));
  dset(map, 13, 44, tid('DOOR_CLOSED', 'DOOR_OPEN'));
  prop(map, 11, 42, tid('BUSH', 'HEDGE'), res);
  prop(map, 15, 42, tid('BUSH', 'HEDGE'), res);
  fenceRect(map, 9, 41, 17, 7, { x: 16, y: 41 }, res);
  prop(map, 18, 47, tid('SACK', 'CRATE'), res);
  prop(map, 10, 41, tid('SIGN', 'FENCE_H'), res);
  prop(map, 22, 41, tid('CART', 'CRATE'), res);

  // --- 8. the pig sty, the woodpile, the carts ----------------------------
  // Everything here is placed against a wall or along a frontage. A barrel
  // standing in the middle of a street reads as a barrel that fell off the
  // sprite sheet; the same barrel tucked into the corner where a wall meets the
  // ground reads as a barrel somebody put down.
  floorRect(map, 3, 24, 5, 5, tid('MUD', 'DIRT'));
  fenceRect(map, 3, 24, 5, 5, { x: 5, y: 28 }, res);
  prop(map, 4, 25, tid('SACK', 'CRATE'), res);
  prop(map, 6, 26, tid('BARREL', 'CRATE'), res);

  // Barthen's: the wagon door in the base course, and the cargo it swallows.
  // The stack runs up the west wall and out along the front where a cart backs in.
  for (const [px, py] of [[28, 25], [28, 26], [28, 27], [28, 28], [36, 27]]) prop(map, px, py, tid('CRATE', 'BARREL'), res);
  prop(map, 36, 28, tid('BARREL', 'CRATE'), res);
  prop(map, 37, 27, tid('SACK', 'CRATE'), res);
  prop(map, 34, 29, tid('CRATE', 'BARREL'), res);              // under the wagon door
  prop(map, 35, 29, tid('SACK', 'CRATE'), res);
  prop(map, 29, 29, tid('CART', 'CRATE'), res);

  // The Stonehill Inn's frontage: a bench under the windows, barrels of ale
  // stood against the east end, a handcart parked round the corner.
  prop(map, 15, 27, tid('BENCH', 'CRATE'), res);
  prop(map, 20, 27, tid('BARREL', 'CRATE'), res);
  prop(map, 21, 27, tid('CRATE', 'BARREL'), res);
  prop(map, 22, 27, tid('CART', 'CRATE'), res);
  prop(map, 13, 26, tid('BARREL', 'CRATE'), res);

  // the woodpile stacked along the Sleeping Giant's west wall
  for (const [px, py] of [[46, 33], [46, 34], [46, 35]]) prop(map, px, py, tid('CRATE', 'BARREL'), res);
  prop(map, 45, 35, tid('STUMP', 'ROCK'), res);
  prop(map, 46, 36, tid('BARREL', 'CRATE'), res);
  prop(map, 47, 38, tid('BONES', 'RUBBLE'), res);              // nobody sweeps up here
  prop(map, 53, 38, tid('BARREL', 'CRATE'), res);
  prop(map, 54, 36, tid('RUBBLE', 'ROCK'), res);
  prop(map, 45, 31, tid('DEAD_TREE', 'STUMP'), res);

  // shop frontages: crates by the Coster's door, ore and sacks at the Exchange,
  // benches outside the Townmaster's where petitioners wait
  prop(map, 32, 38, tid('CRATE', 'BARREL'), res);
  prop(map, 40, 38, tid('BARREL', 'CRATE'), res);
  prop(map, 40, 33, tid('CART', 'CRATE'), res);
  prop(map, 4, 38, tid('CRATE', 'BARREL'), res);
  prop(map, 11, 38, tid('SACK', 'CRATE'), res);
  prop(map, 12, 34, tid('GRINDSTONE', 'ROCK'), res);
  prop(map, 12, 36, tid('ORE_IRON', 'ROCK'), res);
  prop(map, 14, 38, tid('BENCH', 'CRATE'), res);
  prop(map, 21, 38, tid('BENCH', 'CRATE'), res);
  prop(map, 22, 33, tid('SIGN', 'BENCH'), res);                // the Townmaster's bounty board
  prop(map, 12, 22, tid('BARREL', 'CRATE'), res);
  prop(map, 12, 28, tid('STATUE', 'SHRINE'), res);             // Tymora's coin outside the shrine
  prop(map, 8, 28, tid('SHRINE', 'STATUE'), res);
  prop(map, 7, 27, tid('BUSH', 'ROCK'), res);
  prop(map, 56, 29, tid('SIGN', 'FENCE_H'), res);              // "PHANDALIN"
  prop(map, 2, 22, tid('SIGN', 'FENCE_H'), res);
  // cottage yards: a woodpile against each gable end
  prop(map, 15, 16, tid('CRATE', 'BARREL'), res);
  prop(map, 43, 19, tid('BARREL', 'CRATE'), res);
  prop(map, 45, 44, tid('CRATE', 'BARREL'), res);
  prop(map, 47, 45, tid('BARREL', 'CRATE'), res);
  // low stone walls, each run butted INTO a building corner rather than left
  // floating in the open: the inn's yard, Barthen's boundary, the tavern's.
  for (const [px, py] of [[22, 24], [22, 25], [22, 26], [28, 24], [27, 24], [26, 24], [45, 32], [46, 32]]) {
    prop(map, px, py, tid('STONE_FENCE', 'FENCE_H'), res);
  }
  // a scattering of flowers and tall grass in the corners nobody mows
  scatter(map, rd, 2, 8, 6, 10, table([['FLOWERS_RED', 3], ['FLOWERS_YELLOW', 3], ['GRASS_TALL', 2]]), 0.22, res);
  scatter(map, rd, 50, 44, 8, 5, table([['FLOWERS_BLUE', 3], ['BUSH', 3], ['ROCK', 2]]), 0.24, res);

  // --- 9. flags, triggers, signs ------------------------------------------
  map.recomputeFlags({ keep: 0 });
  sealBorder(map, tid('TREE_OAK', 'BLACK'));
  openDoorway(map, 13, 44);
  map.spawn = { x: 24, y: 30 };
  map.entry = { x: 24, y: 30 };
  map.level = 1;

  addSign(map, 56, 29, 'PHANDALIN — Founded on the ruins of old Phandalin. Mind the Redbrands.');
  addSign(map, 2, 22, 'NORTH-WEST: Neverwinter Wood. Travellers are advised to go armed.');
  addSign(map, 45, 17, 'EDERMATH ORCHARD — apples, cider, and no trespassing.');
  addSign(map, 10, 41, "ALDERLEAF FARM — Qelline Alderleaf, prop. Mind the hens.");
  addSign(map, 22, 33, 'TOWNMASTER’S NOTICE BOARD — bounties posted by Harbin Wester.');
  addSign(map, 27, 28, 'The town well. Cold, sweet water, and a bucket on a good rope.');
  map.addTrigger({ id: 'phandalin-manor-sign', kind: 'sign', x: 48, y: 18, data: { text: 'Tresendar Manor. Burnt out a century ago; the cellars are still down there.' } });
  map.addTrigger({ id: 'phandalin-inn-rest', kind: 'inn', x: 17, y: 27, data: { shop: 'stonehill-inn', cost: 5, npc: 'toblen-stonehill' } });

  return map;
}

/** A signpost you can read, wherever a SIGN tile already stands. */
function addSign(map, x, y, text, title) {
  map.addTrigger({ id: `sign-${x}-${y}`, kind: 'sign', x, y, data: { text, title: title || null } });
}

// ---------------------------------------------------------------------------
// 4. PHANDALIN INTERIORS
// ---------------------------------------------------------------------------

function interiorMap(o) {
  return new TileMap({
    w: o.w, h: o.h, id: o.id, name: o.name, biome: 'city', indoor: true,
    music: o.music || 'town', safe: true, encounterRate: 0,
    ambient: o.ambient || { color: '#2a1e14', alpha: 0.14 },
    // The same region string the town outside uses. A shop and the street it
    // opens onto share one watch, so rules/crime.js must book a killing in
    // either to the same ledger.
    region: o.region || 'phandalin-hills',
  });
}

function finishInterior(map, r, exit, res) {
  map.recomputeFlags({ keep: 0 });
  sealBorder(map, tid('WATTLE_WALL', 'STONE_WALL'));
  openDoorway(map, exit.x, exit.y);
  map.spawn = { x: exit.x, y: exit.y - 1 };
  map.entry = { ...map.spawn };
  // Nothing may stand where an NPC is supposed to be.
  if (res) for (const k of res) { const [x, y] = k.split(',').map(Number); clearStanding(map, x, y); }
  return map;
}

function clearStanding(map, x, y) {
  if (!map.inBounds(x, y)) return;
  const i = y * map.w + x;
  if (!(map.flags[i] & TF.SOLID)) return;
  map.deco[i] = 0;
  map.flags[i] = (map.flags[i] & ~(TF.SOLID)) | 0;
}

// --- the Stonehill Inn: hearth, bar, tables, stairs. The rest point. --------
function buildStonehillInn(root) {
  const map = interiorMap({ id: 'stonehill-inn', name: 'The Stonehill Inn', w: 20, h: 16, music: 'inn' });
  const res = reservedFor('stonehill-inn');
  const r = root.fork('inn');
  const rm = room(map, { w: 20, h: 16, floor: 'WOOD_FLOOR', wall: 'WATTLE_WALL', exit: 10 });

  // hearth wall, west
  prop(map, 1, 7, tid('HEARTH', 'BRAZIER'), res);
  prop(map, 1, 8, tid('HEARTH', 'BRAZIER'), res);
  prop(map, 1, 10, tid('COOKING_POT', 'BARREL'), res);
  floorRect(map, 2, 6, 3, 5, tid('CARPET_RED', 'WOOD_FLOOR'));

  // the bar, with Toblen's shelves behind it
  for (let x = 7; x <= 11; x++) prop(map, x, 5, tid('BAR', 'COUNTER'), res);
  for (let x = 7; x <= 12; x++) prop(map, x, 1, tid('SHELF_GOODS', 'BOOKSHELF'), res);
  prop(map, 6, 1, tid('BARREL', 'CRATE'), res);
  prop(map, 13, 1, tid('BARREL', 'CRATE'), res);
  prop(map, 6, 5, tid('BARREL', 'CRATE'), res);

  // common-room tables
  const tableAt = (tx, ty) => {
    prop(map, tx, ty, tid('TABLE', 'BENCH'), res);
    prop(map, tx - 1, ty, tid('CHAIR', 'BENCH'), res);
    prop(map, tx + 1, ty, tid('CHAIR', 'BENCH'), res);
    if (r.chance(0.6)) prop(map, tx, ty + 1, tid('CHAIR', 'BENCH'), res);
    prop(map, tx, ty, tid('TABLE', 'BENCH'), res);
  };
  tableAt(4, 12); tableAt(12, 8); tableAt(15, 12); tableAt(8, 9);
  prop(map, 12, 4, tid('CANDLE', 'TORCH'), res);
  prop(map, 3, 3, tid('TABLE', 'BENCH'), res);
  prop(map, 17, 4, tid('BOOKSHELF', 'SHELF_GOODS'), res);

  // the stairs up to the rooms — where a long rest happens
  floor(map, 17, 1, tid('STAIRS_UP', 'WOOD_FLOOR'));
  floor(map, 17, 2, tid('WOOD_FLOOR_H', 'WOOD_FLOOR'));
  prop(map, 18, 3, tid('BED', 'BENCH'), res);

  oset(map, 9, 7, tid('CHANDELIER', 'CANDLE'));
  oset(map, 5, 4, tid('CHANDELIER', 'CANDLE'));

  finishInterior(map, r, rm.exit, res);
  map.addTrigger({ id: 'stonehill-rest', kind: 'rest', x: 17, y: 1, w: 1, h: 2, data: { inn: true, cost: 5, text: 'A straw mattress, a shuttered window and no Redbrands. Rest here?' } });
  map.addTrigger({ id: 'stonehill-shop', kind: 'shop', x: 9, y: 6, data: { shop: 'stonehill-inn', npc: 'toblen-stonehill' } });
  return map;
}

// --- Barthen's Provisions: counter, shelves, sacks --------------------------
function buildBarthens(root) {
  const map = interiorMap({ id: 'barthens-provisions', name: "Barthen's Provisions", w: 18, h: 14, music: 'shop' });
  const res = reservedFor('barthens-provisions');
  const r = root.fork('barthens');
  const rm = room(map, { w: 18, h: 14, floor: 'WOOD_FLOOR_H', wall: 'WATTLE_WALL', exit: 9 });

  for (let x = 6; x <= 11; x++) prop(map, x, 4, tid('COUNTER', 'TABLE'), res);
  for (let x = 2; x <= 15; x++) prop(map, x, 1, tid('SHELF_GOODS', 'BOOKSHELF'), res);
  for (let y = 2; y <= 6; y++) { prop(map, 1, y, tid('SHELF_GOODS', 'BOOKSHELF'), res); prop(map, 16, y, tid('SHELF_GOODS', 'BOOKSHELF'), res); }
  for (const [x, y] of [[3, 8], [4, 8], [3, 9], [13, 8], [14, 8], [13, 9], [14, 10]]) prop(map, x, y, pickT(r, table([['CRATE', 5], ['BARREL', 4], ['SACK', 3]])), res);
  prop(map, 8, 3, tid('CANDLE', 'TORCH'), res);
  prop(map, 2, 11, tid('CART', 'CRATE'), res);
  prop(map, 15, 11, tid('BARREL', 'CRATE'), res);
  oset(map, 9, 6, tid('CHANDELIER', 'CANDLE'));

  finishInterior(map, r, rm.exit, res);
  map.addTrigger({ id: 'barthens-shop', kind: 'shop', x: 8, y: 5, data: { shop: 'barthens-provisions', npc: 'elmar-barthen' } });
  return map;
}

// --- The Lionshield Coster: weapon racks, armour stands ---------------------
function buildLionshield(root) {
  const map = interiorMap({ id: 'lionshield-coster', name: 'The Lionshield Coster', w: 18, h: 12, music: 'shop' });
  const res = reservedFor('lionshield-coster');
  const r = root.fork('lionshield');
  const rm = room(map, { w: 18, h: 12, floor: 'STONE_FLOOR', wall: 'STONE_WALL', exit: 9 });

  for (let x = 6; x <= 11; x++) prop(map, x, 5, tid('COUNTER', 'TABLE'), res);
  for (let x = 2; x <= 15; x++) prop(map, x, 1, tid('SHELF_GOODS', 'BOOKSHELF'), res);   // the weapon racks
  for (let y = 2; y <= 5; y++) prop(map, 1, y, tid('SHELF_GOODS', 'BOOKSHELF'), res);
  for (let y = 2; y <= 5; y++) prop(map, 16, y, tid('SHELF_GOODS', 'BOOKSHELF'), res);
  prop(map, 3, 8, tid('STATUE', 'PILLAR'), res);      // armour stands
  prop(map, 14, 8, tid('STATUE', 'PILLAR'), res);
  prop(map, 2, 9, tid('CRATE', 'BARREL'), res);
  prop(map, 15, 9, tid('CRATE', 'BARREL'), res);
  prop(map, 5, 3, tid('ANVIL', 'GRINDSTONE'), res);
  prop(map, 12, 3, tid('GRINDSTONE', 'ANVIL'), res);
  prop(map, 1, 7, tid('FORGE', 'HEARTH'), res);
  prop(map, 8, 4, tid('CANDLE', 'TORCH'), res);
  oset(map, 9, 6, tid('CHANDELIER', 'CANDLE'));

  finishInterior(map, r, rm.exit, res);
  map.addTrigger({ id: 'lionshield-shop', kind: 'shop', x: 8, y: 7, data: { shop: 'lionshield-coster', npc: 'linene-graywind' } });
  return map;
}

// --- The Shrine of Luck: Tymora's altar, candles ----------------------------
function buildShrineOfLuck(root) {
  const map = interiorMap({
    id: 'shrine-of-luck', name: 'The Shrine of Luck', w: 16, h: 14, music: 'temple',
    ambient: { color: '#3a2c10', alpha: 0.1 },
  });
  const res = reservedFor('shrine-of-luck');
  const r = root.fork('shrine');
  const rm = room(map, { w: 16, h: 14, floor: 'STONE_FLOOR', wall: 'STONE_WALL', exit: 8 });

  floorRect(map, 6, 3, 4, 9, tid('CARPET_BLUE', 'STONE_FLOOR'));
  floorRect(map, 5, 1, 6, 2, tid('MOSAIC', 'FLAGSTONE'));
  prop(map, 7, 2, tid('ALTAR', 'TABLE'), res);
  prop(map, 8, 2, tid('ALTAR', 'TABLE'), res);
  prop(map, 6, 1, tid('STATUE', 'PILLAR'), res);      // Tymora, tossing her coin
  prop(map, 9, 1, tid('STATUE', 'PILLAR'), res);
  for (const [x, y] of [[5, 3], [10, 3], [5, 6], [10, 6], [5, 9], [10, 9]]) prop(map, x, y, tid('CANDLE', 'TORCH'), res);
  for (const [x, y] of [[2, 2], [13, 2], [2, 11], [13, 11]]) prop(map, x, y, tid('PILLAR', 'BRAZIER'), res);
  prop(map, 3, 5, tid('BENCH', 'CHAIR'), res); prop(map, 3, 6, tid('BENCH', 'CHAIR'), res);
  prop(map, 12, 5, tid('BENCH', 'CHAIR'), res); prop(map, 12, 6, tid('BENCH', 'CHAIR'), res);
  prop(map, 2, 8, tid('BOOKSHELF', 'SHELF_GOODS'), res);
  prop(map, 13, 8, tid('BRAZIER', 'CANDLE'), res);
  oset(map, 8, 5, tid('CHANDELIER', 'CANDLE'));

  finishInterior(map, r, rm.exit, res);
  map.addTrigger({ id: 'shrine-altar', kind: 'quest', x: 7, y: 3, w: 2, h: 1, data: { deity: 'tymora', text: 'A silver coin spins on the altar of Tymora and never quite falls.' } });
  map.addTrigger({ id: 'shrine-shop', kind: 'shop', x: 8, y: 4, data: { shop: 'shrine-of-luck', npc: 'sister-garaele' } });
  return map;
}

// --- The Miner's Exchange: counter, ore scales ------------------------------
function buildMinersExchange(root) {
  const map = interiorMap({ id: 'miners-exchange', name: "The Miner's Exchange", w: 18, h: 12, music: 'shop' });
  const res = reservedFor('miners-exchange');
  const r = root.fork('exchange');
  const rm = room(map, { w: 18, h: 12, floor: 'STONE_FLOOR', wall: 'STONE_WALL', exit: 9 });

  for (let x = 6; x <= 12; x++) prop(map, x, 4, tid('COUNTER', 'TABLE'), res);
  prop(map, 5, 4, tid('GRINDSTONE', 'ANVIL'), res);              // the assay scales
  prop(map, 13, 4, tid('ANVIL', 'GRINDSTONE'), res);
  for (let x = 2; x <= 15; x++) prop(map, x, 1, tid('BOOKSHELF', 'SHELF_GOODS'), res);
  for (const [x, y] of [[2, 6], [3, 6], [2, 7], [14, 6], [15, 6], [15, 7]]) prop(map, x, y, tid('CRATE', 'SACK'), res);
  prop(map, 4, 8, tid('ORE_IRON', 'ROCK'), res);
  prop(map, 13, 8, tid('ORE_SILVER', 'ROCK'), res);
  prop(map, 2, 9, tid('ORE_GEM', 'ROCK'), res);
  prop(map, 8, 3, tid('CANDLE', 'TORCH'), res);
  prop(map, 1, 5, tid('TORCH', 'CANDLE'), res);
  prop(map, 16, 5, tid('TORCH', 'CANDLE'), res);

  finishInterior(map, r, rm.exit, res);
  map.addTrigger({ id: 'exchange-shop', kind: 'shop', x: 9, y: 6, data: { shop: 'miners-exchange', npc: 'halia-thornton' } });
  return map;
}

// --- The Townmaster's Hall: desk, notice board, one cell --------------------
function buildTownmastersHall(root) {
  const map = interiorMap({ id: 'townmasters-hall', name: "The Townmaster's Hall", w: 18, h: 12 });
  const res = reservedFor('townmasters-hall');
  const r = root.fork('hall');
  const rm = room(map, { w: 18, h: 12, floor: 'WOOD_FLOOR', wall: 'WATTLE_WALL', exit: 9 });

  floorRect(map, 5, 3, 8, 5, tid('CARPET_RED', 'WOOD_FLOOR'));
  for (let x = 7; x <= 10; x++) prop(map, x, 4, tid('TABLE', 'COUNTER'), res);           // Harbin's desk
  prop(map, 6, 4, tid('CHAIR', 'BENCH'), res);
  prop(map, 11, 4, tid('CHAIR', 'BENCH'), res);
  for (let x = 2; x <= 6; x++) prop(map, x, 1, tid('BOOKSHELF', 'SHELF_GOODS'), res);
  prop(map, 9, 1, tid('SIGN', 'BOOKSHELF'), res);                                        // the notice board
  prop(map, 12, 1, tid('BOOKSHELF', 'SHELF_GOODS'), res);

  // the cell in the corner: iron door, stone floor, straw
  floorRect(map, 13, 6, 4, 5, tid('STONE_FLOOR', 'FLAGSTONE'));
  dframe(map, 13, 6, 4, 5, tid('STONE_WALL', 'BRICK_WALL'));
  dset(map, 14, 6, tid('IRON_DOOR', 'DOOR_CLOSED'));
  prop(map, 15, 9, tid('BED', 'BENCH'), res);
  prop(map, 15, 7, tid('SACK', 'CRATE'), res);

  prop(map, 2, 9, tid('BENCH', 'CHAIR'), res);
  prop(map, 3, 9, tid('BENCH', 'CHAIR'), res);
  prop(map, 1, 5, tid('HEARTH', 'BRAZIER'), res);
  prop(map, 8, 3, tid('CANDLE', 'TORCH'), res);

  finishInterior(map, r, rm.exit, res);
  openDoorway(map, 14, 6);
  addSign(map, 9, 2, 'BOUNTIES POSTED. See the Townmaster. Payment on proof, not on stories.');
  map.addTrigger({ id: 'hall-board', kind: 'quest', x: 9, y: 2, data: { board: 'townmaster', npc: 'harbin-wester' } });
  return map;
}

// --- Alderleaf Farm: a cosy halfling home under the turf --------------------
function buildAlderleafFarm(root) {
  const map = interiorMap({
    id: 'alderleaf-farm', name: 'The Alderleaf Burrow', w: 20, h: 18, music: 'camp',
    ambient: { color: '#3a2410', alpha: 0.12 },
  });
  const res = reservedFor('alderleaf-farm');
  const r = root.fork('alderleaf');
  const rm = room(map, { w: 20, h: 18, floor: 'WOOD_FLOOR', wall: 'LOG_WALL', exit: 10 });

  floorRect(map, 3, 3, 6, 6, tid('CARPET_RED', 'WOOD_FLOOR'));
  floorRect(map, 12, 3, 5, 5, tid('CARPET_BLUE', 'WOOD_FLOOR'));
  prop(map, 1, 4, tid('HEARTH', 'BRAZIER'), res);
  prop(map, 1, 5, tid('HEARTH', 'BRAZIER'), res);
  prop(map, 2, 6, tid('COOKING_POT', 'BARREL'), res);
  for (let x = 5; x <= 8; x++) prop(map, x, 2, tid('SHELF_GOODS', 'BOOKSHELF'), res);
  prop(map, 6, 5, tid('TABLE', 'BENCH'), res);
  prop(map, 5, 5, tid('CHAIR', 'BENCH'), res);
  prop(map, 7, 5, tid('CHAIR', 'BENCH'), res);
  prop(map, 6, 6, tid('CHAIR', 'BENCH'), res);
  prop(map, 14, 4, tid('BED', 'BENCH'), res);
  prop(map, 16, 4, tid('BED', 'BENCH'), res);
  prop(map, 16, 2, tid('BOOKSHELF', 'SHELF_GOODS'), res);
  prop(map, 12, 8, tid('BARREL', 'CRATE'), res);
  prop(map, 3, 12, tid('CRATE', 'BARREL'), res);
  prop(map, 2, 13, tid('SACK', 'CRATE'), res);
  prop(map, 17, 12, tid('SACK', 'CRATE'), res);
  prop(map, 17, 13, tid('BARREL', 'CRATE'), res);
  for (const [x, y] of [[4, 3], [11, 3], [4, 10], [15, 10]]) prop(map, x, y, tid('CANDLE', 'TORCH'), res);
  oset(map, 10, 6, tid('CHANDELIER', 'CANDLE'));

  finishInterior(map, r, rm.exit, res);
  map.addTrigger({ id: 'alderleaf-rest', kind: 'rest', x: 15, y: 4, w: 2, h: 1, data: { text: 'Qelline offers you the spare cot by the hearth.' } });
  return map;
}

// --- The Sleeping Giant: a grimy taproom, Redbrand territory ---------------
function buildSleepingGiant(root) {
  const map = interiorMap({
    id: 'sleeping-giant', name: 'The Sleeping Giant', w: 18, h: 14, music: 'tense',
    ambient: { color: '#1c1410', alpha: 0.22 },
  });
  const res = reservedFor('sleeping-giant');
  const r = root.fork('giant');
  const rm = room(map, { w: 18, h: 14, floor: 'WOOD_FLOOR_H', wall: 'LOG_WALL', exit: 9 });

  for (let x = 5; x <= 9; x++) prop(map, x, 4, tid('BAR', 'COUNTER'), res);
  for (let x = 4; x <= 10; x++) prop(map, x, 1, tid('SHELF_GOODS', 'BOOKSHELF'), res);
  prop(map, 1, 6, tid('HEARTH', 'BRAZIER'), res);
  prop(map, 1, 7, tid('HEARTH', 'BRAZIER'), res);
  prop(map, 3, 2, tid('BARREL', 'CRATE'), res);
  prop(map, 12, 2, tid('BARREL', 'CRATE'), res);
  prop(map, 13, 3, tid('CRATE', 'BARREL'), res);

  const tableAt = (tx, ty) => {
    prop(map, tx, ty, tid('TABLE', 'BENCH'), res);
    prop(map, tx - 1, ty, tid('CHAIR', 'BENCH'), res);
    prop(map, tx + 1, ty, tid('CHAIR', 'BENCH'), res);
  };
  tableAt(4, 8); tableAt(14, 8); tableAt(6, 11); tableAt(12, 6);
  prop(map, 15, 11, tid('BONES', 'SACK'), res);
  prop(map, 2, 11, tid('SACK', 'CRATE'), res);
  prop(map, 16, 5, tid('TORCH', 'CANDLE'), res);
  prop(map, 1, 3, tid('TORCH', 'CANDLE'), res);
  oset(map, 9, 7, tid('COBWEB', 'CHANDELIER'));
  oset(map, 3, 3, tid('COBWEB', 'CHANDELIER'));

  finishInterior(map, r, rm.exit, res);
  map.addTrigger({ id: 'giant-shop', kind: 'shop', x: 7, y: 6, data: { shop: 'sleeping-giant', npc: 'grista' } });
  map.addTrigger({ id: 'giant-recruit', kind: 'script', x: 14, y: 9, data: { kind: 'recruit-board', location: 'sleeping-giant' } });
  return map;
}

// --- Tresendar Manor: a ruined hall and the stair into the hideout ---------
function buildPhandalinManor(root) {
  const map = new TileMap({
    w: 26, h: 26, id: 'phandalin-manor', name: 'Tresendar Manor', biome: 'ruins',
    indoor: true, music: 'tense', encounterRate: 0.04, encounterTable: 'redbrand-patrol',
    ambient: { color: '#0e1018', alpha: 0.34 }, dark: 0.35, region: 'phandalin',
  });
  const res = reservedFor('phandalin-manor');
  const r = root.fork('manor');

  // A roofless hall: cracked flagstones, fallen columns, the sky through the gaps.
  floorRect(map, 0, 0, 26, 26, tid('GRAVEL', 'DIRT'));
  floorRect(map, 1, 1, 24, 24, tid('STONE_FLOOR_CRACKED', 'STONE_FLOOR'));
  dframe(map, 0, 0, 26, 26, tid('RUINED_WALL', 'STONE_WALL'));
  // inner walls: an entrance hall, a great hall, and the stair chamber
  for (let x = 4; x <= 21; x++) dset(map, x, 8, tid('RUINED_WALL', 'STONE_WALL'));
  for (let x = 10; x <= 16; x++) dset(map, x, 8, 0);
  for (let y = 9; y <= 20; y++) { dset(map, 6, y, tid('RUINED_WALL', 'STONE_WALL')); dset(map, 19, y, tid('RUINED_WALL', 'STONE_WALL')); }
  for (let y = 13; y <= 16; y++) { dset(map, 6, y, 0); dset(map, 19, y, 0); }

  // the stair down into the Redbrand hideout, at the back of the entrance hall
  floorRect(map, 11, 1, 5, 7, tid('FLAGSTONE', 'STONE_FLOOR'));
  floor(map, 13, 3, tid('STAIRS_DOWN', 'FLAGSTONE'));
  // the stair back up to the town
  floorRect(map, 12, 21, 3, 4, tid('FLAGSTONE', 'STONE_FLOOR'));
  floor(map, 13, 25, tid('STAIRS_UP', 'FLAGSTONE'));
  for (let y = 4; y <= 24; y++) floor(map, 13, y, tid('FLAGSTONE', 'STONE_FLOOR'));

  const rubble = table([['RUBBLE', 6], ['ROCK', 3], ['BONES', 2], ['BOULDER', 1]]);
  for (const [x, y] of [[8, 3], [18, 4], [3, 12], [22, 12], [9, 19], [17, 19], [4, 22], [21, 22]]) prop(map, x, y, pickT(r, rubble), res);
  for (const [x, y] of [[8, 10], [17, 10], [8, 18], [17, 18]]) prop(map, x, y, tid('PILLAR', 'RUBBLE'), res);
  for (const [x, y] of [[7, 9], [18, 9], [7, 20], [18, 20]]) prop(map, x, y, tid('BRAZIER', 'TORCH'), res);
  prop(map, 10, 14, tid('TABLE', 'CRATE'), res);
  prop(map, 9, 14, tid('CHAIR', 'BENCH'), res);
  prop(map, 16, 14, tid('CRATE', 'BARREL'), res);
  prop(map, 17, 15, tid('BARREL', 'CRATE'), res);
  prop(map, 3, 3, tid('DEAD_TREE', 'RUBBLE'), res);
  scatter(map, r, 1, 1, 24, 24, table([['RUBBLE', 5], ['ROCK', 3], ['BONES', 1]]), 0.05, res);
  oset(map, 5, 5, tid('COBWEB', 'STALACTITE'));
  oset(map, 20, 17, tid('COBWEB', 'STALACTITE'));

  map.recomputeFlags({ keep: 0 });
  sealBorder(map, tid('RUINED_WALL', 'STONE_WALL'));
  for (const k of res) { const [x, y] = k.split(',').map(Number); clearStanding(map, x, y); }
  map.spawn = { x: 13, y: 24 };
  map.entry = { ...map.spawn };
  map.level = 3;
  map.addTrigger({
    id: 'manor-hideout-stair', kind: 'warp', x: 13, y: 3,
    data: { map: 'redbrand-hideout', depth: 1, theme: 'dungeon', dir: 'down', kind: 'stairs' },
  });
  map.addTrigger({ id: 'manor-warning', kind: 'sign', x: 13, y: 20, data: { text: 'Boot prints in the ash, all of them going down.' } });
  return map;
}

// ---------------------------------------------------------------------------
// 5. THE WILDS
// ---------------------------------------------------------------------------

// --- The Triboar Trail ------------------------------------------------------
function buildTriboarTrail(root) {
  const map = new TileMap({
    w: 100, h: 40, id: 'triboar-trail', name: 'The Triboar Trail', biome: 'road',
    indoor: false, music: 'field', encounterRate: 0.055, encounterTable: 'triboar-trail-bandits',
    region: 'triboar-trail',
  });
  const res = reservedFor('triboar-trail');
  const rg = root.fork('ground');
  const rt = root.fork('trees');
  const rd = root.fork('detail');

  groundNoise(map, rg, 0, 0, 100, 40, table([['GRASS', 8], ['GRASS_2', 5], ['GRASS_4', 4], ['GRASS_3', 3]]));

  // roadside woods, thicker the further you get from the ruts
  const wood = table([['TREE_OAK', 7], ['TREE_PINE', 3], ['BUSH', 4], ['STUMP', 1], ['ROCK', 2]]);
  for (let y = 0; y < 40; y++) {
    const dist = Math.min(Math.abs(y - 19), 20);
    const density = dist < 4 ? 0 : Math.min(0.44, (dist - 3) * 0.055);
    for (let x = 0; x < 100; x++) {
      if (!rt.chance(density)) continue;
      prop(map, x, y, pickT(rt, wood), res);
    }
  }
  // tall grass in the verges — where the encounter rolls happen
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 100; x++) {
      if (map.deco[y * map.w + x]) continue;
      const dist = Math.abs(y - 19);
      if (dist < 3 || dist > 12) continue;
      if (rg.chance(0.16)) gset(map, x, y, tid('GRASS_TALL', 'GRASS_2'));
    }
  }

  // --- the road itself -----------------------------------------------------
  const ruts = table([['DIRT_PATH', 8], ['DIRT', 3], ['MUD', 1]]);
  for (let y = 18; y <= 20; y++) for (let x = 1; x <= 98; x++) floor(map, x, y, pickT(rg, ruts));
  // the branch north to Neverwinter Wood
  for (let x = 69; x <= 71; x++) for (let y = 1; y <= 18; y++) floor(map, x, y, pickT(rg, ruts));
  // the branch south into the hills, toward Wave Echo Cave
  for (let x = 79; x <= 81; x++) for (let y = 20; y <= 38; y++) floor(map, x, y, pickT(rg, ruts));

  // --- roadside places -----------------------------------------------------
  const clearing = (cx, cy, cw, ch) => {
    for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) floor(map, x, y, pickT(rg, table([['GRASS_3', 6], ['DIRT', 4], ['CLOVER', 2]])));
  };
  clearing(28, 12, 7, 6);      // Ivor Marsk's wagon camp
  for (let y = 15; y <= 18; y++) floor(map, 30, y, pickT(rg, ruts));
  prop(map, 32, 13, tid('CART', 'CRATE'), res);
  prop(map, 29, 13, tid('CRATE', 'BARREL'), res);
  prop(map, 28, 16, tid('BARREL', 'CRATE'), res);

  clearing(37, 6, 8, 6);       // Taman Helder's shrine to Tempus
  for (let y = 11; y <= 18; y++) floor(map, 40, y, pickT(rg, ruts));
  prop(map, 41, 8, tid('SHRINE', 'STATUE'), res);
  prop(map, 39, 7, tid('BOULDER', 'ROCK'), res);
  addSign(map, 42, 10, 'A traveller’s shrine to Tempus. Coins in the bowl, prayers on the wind.');
  prop(map, 42, 10, tid('SIGN', 'ROCK'), res);

  clearing(59, 9, 9, 8);       // the Lords' Alliance post rider
  for (let y = 15; y <= 18; y++) floor(map, 63, y, pickT(rg, ruts));
  prop(map, 60, 10, tid('CART', 'CRATE'), res);
  prop(map, 66, 14, tid('BARREL', 'CRATE'), res);

  // --- the goblin ambush ---------------------------------------------------
  // Two horses dead in the ruts, the cargo gone, and a trail into the brush.
  const ax = 45;
  floorRect(map, ax - 3, 17, 8, 5, tid('DIRT', 'DIRT_PATH'));
  for (let y = 17; y <= 21; y++) for (let x = ax - 3; x <= ax + 4; x++) if (rd.chance(0.3)) gset(map, x, y, tid('MUD', 'DIRT'));
  prop(map, ax - 1, 17, tid('BONES', 'RUBBLE'), res);          // the first horse
  prop(map, ax + 2, 21, tid('BONES', 'RUBBLE'), res);          // the second
  prop(map, ax, 21, tid('CART', 'CRATE'), res);
  prop(map, ax + 3, 17, tid('CRATE', 'BARREL'), res);
  for (const [x, y] of [[ax - 2, 16], [ax + 1, 16], [ax + 4, 22], [ax - 3, 22]]) prop(map, x, y, tid('BUSH', 'GRASS_TALL'), res);
  // the goblin trail leading off north into the thickets
  for (let y = 16; y >= 8; y--) floor(map, ax + 1, y, tid('DIRT', 'GRASS_4'));
  prop(map, ax + 5, 17, tid('SIGN', 'ROCK'), res);
  addSign(map, ax + 5, 17, 'Two horses lie dead in the road, arrows in their flanks. The cargo is gone; a trail leads north.');

  // --- signposts at the junctions -----------------------------------------
  prop(map, 68, 17, tid('SIGN', 'ROCK'), res);
  prop(map, 78, 21, tid('SIGN', 'ROCK'), res);
  prop(map, 3, 21, tid('SIGN', 'ROCK'), res);
  prop(map, 96, 17, tid('SIGN', 'ROCK'), res);

  map.recomputeFlags({ keep: 0 });
  sealBorder(map, tid('TREE_PINE', 'TREE_OAK'));
  map.spawn = { x: 3, y: 19 };
  map.entry = { ...map.spawn };
  map.level = 2;

  addSign(map, 68, 17, 'NORTH: Neverwinter Wood, and the road to Neverwinter beyond.');
  addSign(map, 78, 21, 'SOUTH: the old mine road. Wave Echo Cave. Nobody has come back up it in fifty years.');
  addSign(map, 3, 21, 'WEST: Phandalin.');
  addSign(map, 96, 17, 'EAST: Conyberry. Sacked. Travel at your own risk.');
  map.addTrigger({
    id: 'trail-ambush', kind: 'battle', x: ax - 2, y: 18, w: 5, h: 3,
    once: true, data: { group: 'cragmaw-ambush', ambush: true, level: 2, flag: 'trail-ambush-done' },
  });
  map.addTrigger({
    id: 'trail-verges', kind: 'encounter-zone', x: 1, y: 5, w: 98, h: 30,
    data: { table: 'triboar-trail-bandits', rate: 0.05, biome: 'road' },
  });
  return map;
}

// --- Neverwinter Wood -------------------------------------------------------
function buildNeverwinterWood(root) {
  const map = new TileMap({
    w: 60, h: 56, id: 'neverwinter-wood', name: 'Neverwinter Wood', biome: 'pine-forest',
    indoor: false, music: 'forest', encounterRate: 0.075, encounterTable: 'neverwinter-wood-wolves',
    ambient: { color: '#12200f', alpha: 0.16 }, weather: 'fog', region: 'neverwinter-wood',
  });
  const res = reservedFor('neverwinter-wood');
  const rg = root.fork('ground');
  const rt = root.fork('trees');
  const rd = root.fork('detail');

  groundNoise(map, rg, 0, 0, 60, 56, table([['GRASS', 6], ['GRASS_2', 6], ['GRASS_TALL', 3], ['CLOVER', 2], ['SNOW_GRASS', 1]]));

  // The wood proper: dense pine, thinning around the clearings.
  const clearings = [{ x: 29, y: 22, r: 6 }, { x: 44, y: 42, r: 5 }, { x: 16, y: 12, r: 4 }, { x: 46, y: 12, r: 4 }];
  const inClearing = (x, y) => clearings.some((c) => Math.hypot(x - c.x, y - c.y) <= c.r);
  const pines = table([['TREE_PINE', 9], ['TREE_OAK', 2], ['BUSH', 3], ['STUMP', 1], ['MUSHROOM_RED', 1], ['MUSHROOM_BROWN', 1]]);
  for (let y = 0; y < 56; y++) {
    for (let x = 0; x < 60; x++) {
      if (inClearing(x, y)) continue;
      if (!rt.chance(0.42)) continue;
      prop(map, x, y, pickT(rt, pines), res);
    }
  }
  // A few full-size two-tile pines where the canopy closes over the path.
  for (const [px, py] of [[10, 30], [48, 26], [22, 44], [36, 8], [6, 46]]) {
    if (map.inBounds(px + 1, py + 1)) bigPine(map, px, py);
  }

  // --- the path north ------------------------------------------------------
  const trackTable = table([['DIRT', 6], ['DIRT_PATH', 5], ['GRAVEL', 2]]);
  const track = (x, y) => { floor(map, x, y, pickT(rg, trackTable)); };
  // south entrance up to the great clearing, then on to the northern eaves
  for (let y = 54; y >= 1; y--) { track(29, y); track(30, y); track(31, y); }
  // the eastward spur back down to Phandalin
  for (let x = 30; x <= 58; x++) { track(x, 43); track(x, 44); track(x, 45); }
  for (let y = 23; y <= 44; y++) { track(30, y); }

  // --- Reidoth's clearing --------------------------------------------------
  for (let y = 17; y <= 27; y++) for (let x = 24; x <= 34; x++) if (Math.hypot(x - 29, y - 22) <= 5.5) floor(map, x, y, pickT(rg, table([['GRASS_3', 6], ['CLOVER', 4], ['FLOWERS_YELLOW', 2]])));
  prop(map, 26, 19, tid('SHRINE', 'STATUE'), res);
  prop(map, 32, 25, tid('STUMP', 'ROCK'), res);
  prop(map, 25, 25, tid('BOULDER', 'ROCK'), res);
  prop(map, 33, 19, tid('BERRY_BUSH', 'BUSH'), res);
  prop(map, 27, 26, tid('COOKING_POT', 'ROCK'), res);
  addSign(map, 32, 21, 'A druid’s camp: a banked fire, a bedroll of moss, and no footprints leading away.');
  prop(map, 32, 21, tid('SIGN', 'ROCK'), res);

  // --- a stream and its bridge --------------------------------------------
  for (let x = 0; x < 60; x++) {
    const wy = 34 + Math.round(Math.sin(x * 0.22) * 2);
    for (let d = 0; d < 2; d++) floor(map, x, wy + d, tid('WATER', 'MUD'));
    if (rd.chance(0.25)) prop(map, x, wy + 2, tid('REEDS', 'BUSH'), res);
  }
  for (let x = 29; x <= 31; x++) for (let y = 32; y <= 38; y++) floor(map, x, y, tid('BRIDGE_WOOD', 'DIRT_PATH'));

  scatter(map, rd, 1, 1, 58, 54, table([['MUSHROOM_RED', 3], ['MUSHROOM_BROWN', 3], ['ROCK', 3], ['BUSH', 2]]), 0.03, res);

  map.recomputeFlags({ keep: 0 });
  sealBorder(map, tid('TREE_PINE', 'TREE_OAK'));
  map.spawn = { x: 30, y: 52 };
  map.entry = { ...map.spawn };
  map.level = 3;
  map.addTrigger({
    id: 'wood-deeps', kind: 'encounter-zone', x: 1, y: 1, w: 58, h: 54,
    data: { table: 'neverwinter-wood-wolves', rate: 0.07, biome: 'pine-forest' },
  });
  return map;
}

// --- Conyberry: a sacked village and Agatha's grove -------------------------
function buildConyberryRuins(root) {
  const map = new TileMap({
    w: 44, h: 36, id: 'conyberry-ruins', name: 'Conyberry', biome: 'ruins',
    indoor: false, music: 'wilds', encounterRate: 0.06, encounterTable: 'conyberry-ruins-haunts',
    ambient: { color: '#1a1622', alpha: 0.12 }, region: 'conyberry',
  });
  const res = reservedFor('conyberry-ruins');
  const rg = root.fork('ground');
  const rd = root.fork('detail');

  groundNoise(map, rg, 0, 0, 44, 36, table([['GRASS_4', 6], ['DIRT', 5], ['GRASS', 4], ['GRAVEL', 2], ['GRASS_TALL', 2]]));

  // the old street, still there under the weeds
  for (let y = 15; y <= 17; y++) for (let x = 1; x <= 42; x++) floor(map, x, y, pickT(rg, table([['COBBLE', 5], ['DIRT', 4], ['RUBBLE', 1]])));
  for (let x = 8; x <= 10; x++) for (let y = 6; y <= 30; y++) floor(map, x, y, pickT(rg, table([['DIRT', 6], ['COBBLE', 3]])));

  // burnt-out houses: ruined rings with the roofs long gone
  const houses = [[2, 6, 6, 5], [12, 5, 7, 6], [24, 6, 6, 5], [2, 23, 6, 5], [13, 24, 6, 5], [30, 24, 7, 6], [34, 10, 6, 5]];
  for (const [hx, hy, hw, hh] of houses) {
    floorRect(map, hx, hy, hw, hh, tid('DIRT', 'GRAVEL'));
    floorRect(map, hx + 1, hy + 1, hw - 2, hh - 2, tid('STONE_FLOOR_CRACKED', 'STONE_FLOOR'));
    dframe(map, hx, hy, hw, hh, tid('RUINED_WALL', 'STONE_WALL'));
    // knock a gap in a wall so each shell is enterable
    dset(map, hx + (hw >> 1), hy + hh - 1, 0);
    for (let i = 0; i < 3; i++) prop(map, hx + rd.int(1, hw - 2), hy + rd.int(1, hh - 2), pickT(rd, table([['RUBBLE', 5], ['BONES', 2], ['CRATE', 2]])), res);
  }
  prop(map, 20, 20, tid('WELL', 'FOUNTAIN'), res);
  prop(map, 6, 18, tid('GRAVESTONE', 'ROCK'), res);
  prop(map, 7, 19, tid('GRAVESTONE', 'ROCK'), res);
  prop(map, 5, 19, tid('GRAVESTONE', 'ROCK'), res);
  prop(map, 3, 14, tid('SIGN', 'ROCK'), res);

  // --- Agatha's grove ------------------------------------------------------
  // A ring of old oaks east of the village; the banshee waits at the centre.
  for (let y = 10; y <= 22; y++) {
    for (let x = 15; x <= 27; x++) {
      const d = Math.hypot(x - 20, y - 16);
      if (d > 5.4 && d < 6.6) prop(map, x, y, tid('TREE_OAK', 'DEAD_TREE'), res);
      else if (d <= 5.4) floor(map, x, y, pickT(rg, table([['GRASS_3', 5], ['CLOVER', 3], ['GRASS_TALL', 2]])));
    }
  }
  // a way in from the street: a gap trodden through the ring of oaks
  for (let y = 17; y <= 24; y++) floor(map, 19, y, tid('DIRT', 'GRASS'));
  prop(map, 20, 13, tid('DEAD_TREE', 'TREE_OAK'), res);
  prop(map, 18, 18, tid('GRAVESTONE', 'ROCK'), res);
  prop(map, 22, 18, tid('GRAVESTONE', 'ROCK'), res);
  prop(map, 20, 19, tid('ALTAR', 'GRAVESTONE'), res);

  scatter(map, rd, 1, 1, 42, 34, table([['DEAD_TREE', 3], ['BUSH', 4], ['ROCK', 3], ['RUBBLE', 2], ['BONES', 1]]), 0.06, res);

  map.recomputeFlags({ keep: 0 });
  sealBorder(map, tid('DEAD_TREE', 'TREE_OAK'));
  map.spawn = { x: 3, y: 16 };
  map.entry = { ...map.spawn };
  map.level = 4;
  addSign(map, 3, 14, 'CONYBERRY. The signpost is scorched. Nothing has been rebuilt.');
  map.addTrigger({ id: 'agatha-grove', kind: 'script', x: 19, y: 20, data: { kind: 'agatha-grove', npc: 'agatha' } });
  map.addTrigger({
    id: 'conyberry-haunts', kind: 'encounter-zone', x: 1, y: 1, w: 42, h: 34,
    data: { table: 'conyberry-ruins-haunts', rate: 0.06, biome: 'ruins' },
  });
  return map;
}

// --- The mouth of Wave Echo Cave -------------------------------------------
function buildWaveEchoEntrance(root) {
  const map = new TileMap({
    w: 30, h: 34, id: 'wave-echo-cave-entrance', name: 'Wave Echo Cave', biome: 'hills',
    indoor: false, music: 'cave', encounterRate: 0.05, encounterTable: 'wave-echo-shafts',
    ambient: { color: '#14161f', alpha: 0.18 }, region: 'phandalin-hills',
  });
  const res = reservedFor('wave-echo-cave-entrance');
  const rg = root.fork('ground');
  const rd = root.fork('detail');

  groundNoise(map, rg, 0, 0, 30, 34, table([['GRAVEL', 6], ['DIRT', 4], ['GRASS_4', 3]]));

  // A rocky bowl: cliffs east and west, the road down the middle, the cave
  // mouth in the southern rock face.
  for (let y = 0; y < 34; y++) {
    const lw = 6 + Math.round(Math.sin(y * 0.31) * 3);
    const rw = 6 + Math.round(Math.cos(y * 0.27) * 3);
    for (let x = 0; x < lw; x++) prop(map, x, y, tid('CLIFF', 'MOUNTAIN'), res);
    for (let x = 30 - rw; x < 30; x++) prop(map, x, y, tid('CLIFF', 'MOUNTAIN'), res);
  }
  for (let y = 1; y <= 25; y++) for (let x = 12; x <= 16; x++) floor(map, x, y, pickT(rg, table([['DIRT_PATH', 6], ['GRAVEL', 4]])));

  // the mine head: timber shoring, spoil heaps, a rusted cart
  floorRect(map, 10, 24, 10, 7, tid('CAVE_FLOOR', 'GRAVEL'));
  for (let x = 9; x <= 20; x++) prop(map, x, 31, tid('CAVE_WALL', 'MOUNTAIN'), res);
  for (let x = 9; x <= 20; x++) prop(map, x, 23, 0, res);
  prop(map, 11, 27, tid('TIMBER_SUPPORT', 'PILLAR'), res);
  prop(map, 17, 27, tid('TIMBER_SUPPORT', 'PILLAR'), res);
  prop(map, 10, 30, tid('ORE_IRON', 'ROCK'), res);
  prop(map, 19, 30, tid('ORE_SILVER', 'ROCK'), res);
  prop(map, 18, 25, tid('CART', 'CRATE'), res);
  prop(map, 11, 25, tid('CRATE', 'BARREL'), res);
  prop(map, 10, 26, tid('BARREL', 'CRATE'), res);
  prop(map, 12, 26, tid('TORCH', 'CANDLE'), res);
  prop(map, 16, 26, tid('TORCH', 'CANDLE'), res);
  for (let x = 13; x <= 15; x++) for (let y = 26; y <= 30; y++) floor(map, x, y, tid('CAVE_FLOOR', 'GRAVEL'));
  floor(map, 14, 28, tid('STAIRS_DOWN', 'CAVE_FLOOR'));
  orect(map, 12, 26, 5, 1, tid('BLACK', 'COBWEB'));      // the lintel of the adit

  // a camp where the road comes down, and the scree in between
  floorRect(map, 11, 18, 7, 5, tid('DIRT', 'GRAVEL'));
  prop(map, 11, 19, tid('CRATE', 'BARREL'), res);
  prop(map, 17, 21, tid('BARREL', 'CRATE'), res);
  prop(map, 12, 22, tid('COOKING_POT', 'ROCK'), res);
  prop(map, 16, 17, tid('SIGN', 'ROCK'), res);
  scatter(map, rd, 6, 1, 18, 32, table([['ROCK', 6], ['BOULDER', 3], ['RUBBLE', 3], ['BUSH', 2], ['DEAD_TREE', 1]]), 0.07, res);

  map.recomputeFlags({ keep: 0 });
  sealBorder(map, tid('MOUNTAIN', 'CLIFF'));
  map.spawn = { x: 14, y: 3 };
  map.entry = { ...map.spawn };
  map.level = 5;
  addSign(map, 16, 17, 'WAVE ECHO CAVE. The Lost Mine of Phandelver. The air coming out of it is cold and tastes of iron.');
  map.addTrigger({
    id: 'wave-echo-mouth', kind: 'warp', x: 14, y: 28,
    data: { map: 'wave-echo-cave', depth: 1, theme: 'mine', dir: 'down', kind: 'cave' },
  });
  return map;
}

// ---------------------------------------------------------------------------
// 6. THE CITIES
// ---------------------------------------------------------------------------

// --- Neverwinter: the Protector's Enclave -----------------------------------
function buildNeverwinter(root) {
  const map = new TileMap({
    w: 48, h: 36, id: 'neverwinter', name: "Neverwinter — Protector's Enclave", biome: 'city',
    indoor: false, music: 'city', safe: true, encounterRate: 0, region: 'neverwinter',
  });
  const res = reservedFor('neverwinter');
  const rg = root.fork('ground');
  const rd = root.fork('detail');

  groundNoise(map, rg, 0, 0, 48, 36, table([['COBBLE', 7], ['FLAGSTONE', 5], ['DIRT_PATH', 1]]));

  // The Enclave is walled: dressed stone on three sides, the Neverwinter River
  // (here, the harbour channel) along the west.
  for (let y = 0; y < 36; y++) for (let x = 0; x <= 3; x++) floor(map, x, y, tid('WATER', 'COBBLE'));
  for (let y = 0; y < 36; y++) prop(map, 4, y, tid('STONE_FENCE', 'STONE_WALL'), res);
  for (let x = 5; x < 48; x++) { prop(map, x, 1, tid('STONE_WALL', 'BRICK_WALL'), res); prop(map, x, 33, tid('STONE_WALL', 'BRICK_WALL'), res); }
  for (let y = 1; y <= 33; y++) prop(map, 46, y, tid('STONE_WALL', 'BRICK_WALL'), res);

  // the two gates in the south wall: the wood road, and the High Road south.
  // Pave first, hang the gate second — `floor()` sweeps the deco plane.
  for (const gx of [34, 8]) {
    for (let y = 23; y <= 34; y++) { floor(map, gx, y, tid('FLAGSTONE', 'COBBLE')); floor(map, gx + 1, y, tid('FLAGSTONE', 'COBBLE')); }
    dset(map, gx, 33, tid('GATE', 'DOOR_OPEN'));
  }

  // avenues
  for (let x = 5; x <= 45; x++) for (let y = 20; y <= 22; y++) floor(map, x, y, tid('FLAGSTONE', 'COBBLE'));
  for (let y = 2; y <= 32; y++) for (let x = 23; x <= 25; x++) floor(map, x, y, tid('FLAGSTONE', 'COBBLE'));

  // the Hall of Justice end of the enclave, north
  const cityHouse = (x, y, w, h, roof) => building(map, {
    x, y, w, h, wall: 'STONE_WALL', roof: roof || 'tile', base: 'FLAGSTONE',
    windows: [1, w - 2], chimney: 1,
  }, res);
  cityHouse(27, 6, 8, 8, 'tile');       // the Hall of Justice
  cityHouse(12, 6, 8, 7, 'shingle');
  cityHouse(6, 14, 7, 5, 'shingle');
  cityHouse(38, 14, 7, 5, 'tile');
  cityHouse(11, 25, 6, 6, 'shingle');
  cityHouse(18, 25, 5, 6, 'tile');
  cityHouse(27, 25, 6, 6, 'shingle');
  cityHouse(38, 25, 7, 6, 'tile');
  floorRect(map, 26, 14, 10, 5, tid('MOSAIC', 'FLAGSTONE'));
  prop(map, 30, 16, tid('STATUE', 'PILLAR'), res);
  prop(map, 31, 16, tid('FOUNTAIN', 'WELL'), res);

  // --- the market ----------------------------------------------------------
  floorRect(map, 6, 20, 16, 3, tid('COBBLE', 'FLAGSTONE'));
  const stall = table([['CART', 5], ['CRATE', 5], ['BARREL', 4], ['SACK', 3], ['SHELF_GOODS', 2]]);
  for (let x = 7; x <= 20; x += 2) { prop(map, x, 19, pickT(rd, stall), res); prop(map, x, 23, pickT(rd, stall), res); }
  prop(map, 12, 24, tid('SIGN', 'CRATE'), res);
  prop(map, 21, 18, tid('BRAZIER', 'TORCH'), res);
  prop(map, 6, 18, tid('BRAZIER', 'TORCH'), res);
  // the docks along the channel
  for (let y = 6; y <= 30; y += 4) prop(map, 5, y, tid('BARREL', 'CRATE'), res);
  scatter(map, rd, 5, 2, 41, 31, table([['HEDGE', 3], ['BENCH', 3], ['TORCH', 2]]), 0.02, res);

  map.recomputeFlags({ keep: 0 });
  sealBorder(map, tid('STONE_WALL', 'BRICK_WALL'));
  for (const gx of [34, 8]) openDoorway(map, gx, 33);
  map.spawn = { x: 34, y: 32 };
  map.entry = { ...map.spawn };
  map.level = 6;
  addSign(map, 12, 24, 'THE PROTECTOR’S ENCLAVE. Lord Neverember’s peace holds inside these walls. Outside is another matter.');
  return map;
}

// --- Waterdeep: a stretch of the Trades Ward and the Yawning Portal ---------
function buildWaterdeep(root) {
  const map = new TileMap({
    w: 44, h: 34, id: 'waterdeep', name: 'Waterdeep — Trades Ward', biome: 'city',
    indoor: false, music: 'city', safe: true, encounterRate: 0, region: 'waterdeep',
  });
  const res = reservedFor('waterdeep');
  const rg = root.fork('ground');
  const rd = root.fork('detail');

  groundNoise(map, rg, 0, 0, 44, 34, table([['COBBLE', 8], ['FLAGSTONE', 4]]));

  // The ward's streets. The Portal is built across the top of the north lane,
  // so the road from the gate jogs east around it before turning south.
  for (let x = 1; x <= 42; x++) for (let y = 20; y <= 22; y++) floor(map, x, y, tid('COBBLE', 'FLAGSTONE'));
  for (let x = 1; x <= 42; x++) for (let y = 29; y <= 30; y++) floor(map, x, y, tid('COBBLE', 'FLAGSTONE'));
  for (let y = 1; y <= 7; y++) for (let x = 20; x <= 22; x++) floor(map, x, y, tid('COBBLE', 'FLAGSTONE'));
  for (let x = 20; x <= 31; x++) for (let y = 6; y <= 7; y++) floor(map, x, y, tid('COBBLE', 'FLAGSTONE'));
  for (let y = 6; y <= 30; y++) for (let x = 29; x <= 31; x++) floor(map, x, y, tid('COBBLE', 'FLAGSTONE'));

  // --- The Yawning Portal --------------------------------------------------
  // The famous taproom is built around the shaft; you can walk in off the
  // street and look straight down into Undermountain.
  floorRect(map, 14, 9, 15, 11, tid('WOOD_FLOOR', 'STONE_FLOOR'));
  dframe(map, 14, 9, 15, 11, tid('STONE_WALL', 'BRICK_WALL'));
  dset(map, 21, 19, tid('DOOR_OPEN', 'DOOR_CLOSED'));
  dset(map, 20, 19, tid('WINDOW_LIT', 'WINDOW'));
  dset(map, 23, 19, tid('SIGN', 'WINDOW'));
  orect(map, 14, 9, 15, 2, tid('TILE_ROOF', 'SHINGLE_ROOF'));
  oset(map, 16, 9, tid('CHIMNEY', 'TILE_ROOF'));
  // the well: the way down
  floorRect(map, 18, 11, 5, 4, tid('FLAGSTONE', 'STONE_FLOOR'));
  prop(map, 20, 12, tid('WELL', 'FOUNTAIN'), res);
  prop(map, 19, 12, tid('WELL', 'FOUNTAIN'), res);
  prop(map, 21, 12, tid('WELL', 'FOUNTAIN'), res);
  // Durnan's bar and the tables
  for (let x = 16; x <= 19; x++) prop(map, x, 16, tid('BAR', 'COUNTER'), res);
  for (let x = 15; x <= 27; x++) prop(map, x, 10, tid('SHELF_GOODS', 'BOOKSHELF'), res);
  for (const [tx, ty] of [[16, 18], [24, 15], [26, 12]]) {
    prop(map, tx, ty, tid('TABLE', 'BENCH'), res);
    prop(map, tx - 1, ty, tid('CHAIR', 'BENCH'), res);
    prop(map, tx + 1, ty, tid('CHAIR', 'BENCH'), res);
  }
  prop(map, 15, 14, tid('HEARTH', 'BRAZIER'), res);
  prop(map, 27, 17, tid('BARREL', 'CRATE'), res);
  oset(map, 21, 15, tid('CHANDELIER', 'CANDLE'));

  // --- the rest of the ward -----------------------------------------------
  const ward = (x, y, w, h, roof) => building(map, {
    x, y, w, h, wall: 'BRICK_WALL', roof: roof || 'tile', base: 'FLAGSTONE',
    windows: [1, w - 2], chimney: w - 2,
  }, res);
  ward(3, 8, 8, 9, 'tile');
  ward(33, 8, 8, 9, 'shingle');
  ward(3, 24, 7, 5, 'tile');
  ward(12, 24, 6, 5, 'shingle');
  ward(33, 24, 8, 5, 'tile');
  ward(3, 2, 7, 4, 'shingle');
  ward(33, 2, 7, 4, 'tile');

  // the bazaar row, east of the crossing
  floorRect(map, 28, 20, 14, 3, tid('COBBLE', 'FLAGSTONE'));
  const stall = table([['CART', 5], ['CRATE', 5], ['SACK', 4], ['BARREL', 3], ['SHELF_GOODS', 2]]);
  for (let x = 33; x <= 41; x += 2) { prop(map, x, 19, pickT(rd, stall), res); prop(map, x, 23, pickT(rd, stall), res); }
  prop(map, 32, 23, tid('SIGN', 'CRATE'), res);
  prop(map, 11, 21, tid('FOUNTAIN', 'WELL'), res);
  prop(map, 8, 19, tid('STATUE', 'PILLAR'), res);
  for (const [x, y] of [[13, 20], [27, 20], [13, 30], [27, 30], [21, 6]]) prop(map, x, y, tid('BRAZIER', 'TORCH'), res);
  scatter(map, rd, 1, 1, 42, 32, table([['BENCH', 3], ['HEDGE', 2], ['BARREL', 2]]), 0.02, res);

  map.recomputeFlags({ keep: 0 });
  sealBorder(map, tid('BRICK_WALL', 'STONE_WALL'));
  openDoorway(map, 21, 19);
  map.spawn = { x: 21, y: 3 };
  map.entry = { ...map.spawn };
  map.level = 8;
  addSign(map, 23, 19, 'THE YAWNING PORTAL — ale, beds, and a one-way trip down the well. Durnan, prop.');
  addSign(map, 32, 23, 'TRADES WARD BAZAAR. Everything has a price in Waterdeep; most of them are negotiable.');
  map.addTrigger({ id: 'yawning-portal-rest', kind: 'inn', x: 17, y: 18, data: { shop: 'yawning-portal', cost: 12, npc: 'durnan' } });
  map.addTrigger({ id: 'yawning-portal-well', kind: 'sign', x: 20, y: 11, data: { text: 'The shaft drops forty feet into blackness. A rope and windlass hang over it. Somewhere far below, water moves.' } });
  // The well itself: the way into Undermountain. Placed here rather than by the
  // warp-graph pass because the depth is decided by the save file, not the map.
  openDoorway(map, 20, 13);
  map.addTrigger({
    id: 'waterdeep>undermountain', kind: 'warp', x: 20, y: 13, facing: 'up',
    data: {
      map: 'undermountain', dir: 'down', kind: 'well', transition: 'fade',
      prompt: 'Climb down into Undermountain?',
    },
  });
  return map;
}

// ---------------------------------------------------------------------------
// 7. UNDERMOUNTAIN — the endless dungeon
// ---------------------------------------------------------------------------

/** Current descent, from the save file. Level 1 is the floor under the well. */
function undermountainDepth(st) {
  const d = st && st.depth ? st.depth.undermountain : null;
  return Math.max(1, (d | 0) || 1);
}

/**
 * Retarget the generic up/down stairs mapgen produced so they point at real map
 * ids: down goes one floor deeper, up climbs back — or, from the first level,
 * all the way out into the Yawning Portal's taproom.
 *
 * mapgen marks which stair is which in `data.dir`. That field means something
 * else to the overworld — it is the direction the party faces on arrival — so
 * the role is copied into `data.stair` first and `data.dir` is then free to
 * carry the facing. Omitting `x`/`y` means "use the destination's own spawn".
 */
function linkDungeonStairs(map, opts) {
  const { id, depth, up, down } = opts;
  for (const t of map.triggers || []) {
    if (t.kind !== 'warp' || !t.data) continue;
    const role = t.data.stair || t.data.dir;
    if (role !== 'up' && role !== 'down') continue;
    t.data.stair = role;
    t.data.kind = 'stairs';
    if (role === 'up') {
      if (depth <= 1) {
        // The way out. Without a surface link this floor is the bottom of a
        // one-way hole, so the stair is left inert rather than pointing nowhere.
        if (up) Object.assign(t.data, { map: up.map, x: up.x, y: up.y, dir: up.dir || 'down', exit: true });
        else Object.assign(t.data, { map: null, exit: true, dir: 'up' });
      } else {
        Object.assign(t.data, { map: `${id}-${depth - 1}`, depth: depth - 1, dir: 'up', exit: false });
        delete t.data.x; delete t.data.y;
      }
    } else {
      Object.assign(t.data, { map: down || `${id}-${depth + 1}`, depth: depth + 1, dir: 'down' });
      delete t.data.x; delete t.data.y;
    }
  }
  return map;
}

function buildUndermountain(root, ctx) {
  const depth = undermountainDepth(ctx.state);
  const map = generateDungeon({
    seed: `${ctx.seed}:undermountain:${depth}`,
    depth,
    theme: 'dungeon',
    biome: 'dungeon',
    size: depth < 3 ? 'medium' : (depth < 9 ? 'large' : 'huge'),
    name: `Undermountain — Level ${depth}`,
  });
  map.id = 'undermountain';
  map.name = `Undermountain — Level ${depth}`;
  map.region = 'undermountain';
  map.depth = depth;
  map.level = 8 + Math.floor(depth / 2);
  map.encounterTable = depth <= 2 ? 'undermountain-first-level'
    : depth <= 6 ? 'undermountain-ooze-pits' : 'undermountain-wards';
  linkDungeonStairs(map, {
    id: 'undermountain', depth,
    up: { map: 'waterdeep', x: 20, y: 15, dir: 'down' },
  });
  normalizeTriggers(map);
  return map;
}

// ---------------------------------------------------------------------------
// 8. THE CATALOGUE
// ---------------------------------------------------------------------------

function def(id, o) {
  return {
    id,
    name: o.name,
    kind: o.kind,                    // 'town'|'interior'|'road'|'wild'|'ruins'|'cave'|'city'|'dungeon'
    biome: o.biome,
    w: o.w, h: o.h,
    indoor: !!o.indoor,
    safe: !!o.safe,
    music: o.music || (o.indoor ? 'town' : 'field'),
    level: o.level || 1,
    region: o.region || null,
    parent: o.parent || null,        // the outdoor map an interior belongs to
    desc: o.desc || '',
    build: o.build,
  };
}

const CORE_MAP_DEFS = ({
  phandalin: def('phandalin', {
    name: 'Phandalin', kind: 'town', biome: 'city', w: 60, h: 50, safe: true, music: 'town',
    level: 1, region: 'phandalin-hills', build: buildPhandalin,
    desc: 'A frontier town in the foothills below the Sword Mountains, rebuilt on old Netherese ruins.',
  }),
  'stonehill-inn': def('stonehill-inn', {
    name: 'The Stonehill Inn', kind: 'interior', biome: 'city', w: 20, h: 16, indoor: true,
    safe: true, music: 'inn', parent: 'phandalin', build: buildStonehillInn,
    desc: 'Toblen Stonehill’s taproom: the warmest room in Phandalin and the loosest tongues.',
  }),
  'barthens-provisions': def('barthens-provisions', {
    name: "Barthen's Provisions", kind: 'interior', biome: 'city', w: 18, h: 14, indoor: true,
    safe: true, music: 'shop', parent: 'phandalin', build: buildBarthens,
    desc: 'The town’s general store — rope, rations, lamp oil and picks.',
  }),
  'lionshield-coster': def('lionshield-coster', {
    name: 'The Lionshield Coster', kind: 'interior', biome: 'city', w: 18, h: 12, indoor: true,
    safe: true, music: 'shop', parent: 'phandalin', build: buildLionshield,
    desc: 'Linene Graywind’s arms and armour, under the lion-shield sign of the Coster.',
  }),
  'shrine-of-luck': def('shrine-of-luck', {
    name: 'The Shrine of Luck', kind: 'interior', biome: 'city', w: 16, h: 14, indoor: true,
    safe: true, music: 'town', parent: 'phandalin', build: buildShrineOfLuck,
    desc: 'Tymora’s shrine, tended by Sister Garaele of the Harpers.',
  }),
  'miners-exchange': def('miners-exchange', {
    name: "The Miner's Exchange", kind: 'interior', biome: 'city', w: 18, h: 12, indoor: true,
    safe: true, music: 'shop', parent: 'phandalin', build: buildMinersExchange,
    desc: 'Halia Thornton weighs ore, registers claims and quietly runs the Black Network.',
  }),
  'townmasters-hall': def('townmasters-hall', {
    name: "The Townmaster's Hall", kind: 'interior', biome: 'city', w: 18, h: 12, indoor: true,
    safe: true, music: 'town', parent: 'phandalin', build: buildTownmastersHall,
    desc: 'Harbin Wester’s desk, the bounty board, and one cell nobody has used in years.',
  }),
  'alderleaf-farm': def('alderleaf-farm', {
    name: 'The Alderleaf Burrow', kind: 'interior', biome: 'city', w: 20, h: 18, indoor: true,
    safe: true, music: 'inn', parent: 'phandalin', build: buildAlderleafFarm,
    desc: 'A halfling home dug into the turf: low ceilings, a hot hearth and too much food.',
  }),
  'sleeping-giant': def('sleeping-giant', {
    name: 'The Sleeping Giant', kind: 'interior', biome: 'city', w: 18, h: 14, indoor: true,
    safe: true, music: 'tense', parent: 'phandalin', build: buildSleepingGiant,
    desc: 'A grimy taproom on the east edge of town, and the Redbrands drink here.',
  }),
  'phandalin-manor': def('phandalin-manor', {
    name: 'Tresendar Manor', kind: 'ruins', biome: 'ruins', w: 26, h: 26, indoor: true,
    music: 'tense', level: 3, parent: 'phandalin', build: buildPhandalinManor,
    desc: 'The burnt shell of the Tresendar family seat. The cellars beneath are not empty.',
  }),

  'triboar-trail': def('triboar-trail', {
    name: 'The Triboar Trail', kind: 'road', biome: 'road', w: 100, h: 40, music: 'field',
    level: 2, region: 'triboar-trail', build: buildTriboarTrail,
    desc: 'The east–west road between the High Road and Triboar, running north of Phandalin.',
  }),
  'neverwinter-wood': def('neverwinter-wood', {
    name: 'Neverwinter Wood', kind: 'wild', biome: 'pine-forest', w: 60, h: 56, music: 'field',
    level: 3, region: 'neverwinter-wood', build: buildNeverwinterWood,
    desc: 'Old pine forest under the shadow of Mount Hotenow, and a druid who does not want company.',
  }),
  'conyberry-ruins': def('conyberry-ruins', {
    name: 'Conyberry', kind: 'ruins', biome: 'ruins', w: 44, h: 36, music: 'tense',
    level: 4, region: 'conyberry', build: buildConyberryRuins,
    desc: 'A village the Uthgardt sacked a generation ago. A banshee keeps the grove east of it.',
  }),
  'wave-echo-cave-entrance': def('wave-echo-cave-entrance', {
    name: 'Wave Echo Cave', kind: 'cave', biome: 'hills', w: 30, h: 34, music: 'dungeon',
    level: 5, region: 'phandalin-hills', build: buildWaveEchoEntrance,
    desc: 'The mine head of the Lost Mine of Phandelver, in a bowl of rock south of the Trail.',
  }),

  neverwinter: def('neverwinter', {
    name: "Neverwinter — Protector's Enclave", kind: 'city', biome: 'city', w: 48, h: 36,
    safe: true, music: 'town', level: 6, region: 'neverwinter', build: buildNeverwinter,
    desc: 'The rebuilt heart of the City of Skilled Hands, walled against everything outside it.',
  }),
  waterdeep: def('waterdeep', {
    name: 'Waterdeep — Trades Ward', kind: 'city', biome: 'city', w: 44, h: 34,
    safe: true, music: 'town', level: 8, region: 'waterdeep', build: buildWaterdeep,
    desc: 'A stretch of the Trades Ward, and the Yawning Portal’s well down into Undermountain.',
  }),
  undermountain: def('undermountain', {
    name: 'Undermountain', kind: 'dungeon', biome: 'dungeon', w: 0, h: 0, indoor: true,
    music: 'undermountain', level: 8, region: 'undermountain', build: buildUndermountain,
    desc: 'Halaster Blackcloak’s endless dungeon beneath Mount Waterdeep. It has no bottom.',
  }),
});

/**
 * Every map in the game: the Sword Coast North core plus each region pack.
 * A pack supplies RAW definitions (the same fields `def` takes); they are run
 * through `def` here so a pack never has to import it.
 */
function packDefs(pack) {
  const out = {};
  for (const [id, o] of Object.entries(pack || {})) out[id] = def(id, o);
  return out;
}

export const MAP_DEFS = Object.freeze({
  ...CORE_MAP_DEFS,
  ...packDefs(SOUTH_MAPS),
  ...packDefs(BG_MAPS),
});


export const MAP_IDS = Object.freeze(Object.keys(MAP_DEFS));

// ---------------------------------------------------------------------------
// 9. PROCEDURAL FALL-THROUGH
// ---------------------------------------------------------------------------

/**
 * Canonical sites we know about but do not hand-build: each gets a generator,
 * a biome and a suggested level so an unwritten id never returns null.
 */
const PROC_SITES = Object.freeze({
  // 'undermountain-7' and friends: the endless descent, named and levelled here
  // so a floor id resolves even when it is loaded straight from a save file.
  undermountain: { gen: 'dungeon', biome: 'dungeon', name: 'Undermountain', level: 8, size: 'large' },
  'cragmaw-hideout': { gen: 'cave', biome: 'cave', name: 'Cragmaw Hideout', level: 2, size: 'small' },
  'cragmaw-castle': { gen: 'dungeon', biome: 'dungeon', name: 'Cragmaw Castle', level: 5, size: 'medium' },
  'redbrand-hideout': { gen: 'dungeon', biome: 'dungeon', name: 'The Redbrand Hideout', level: 3, size: 'medium' },
  'wave-echo-cave': { gen: 'mine', biome: 'mine', name: 'Wave Echo Cave', level: 5, size: 'large' },
  thundertree: { gen: 'ruins', biome: 'ash-waste', name: 'Thundertree', level: 5, size: 'medium' },
  'old-owl-well': { gen: 'crypt', biome: 'crypt', name: 'Old Owl Well', level: 6, size: 'medium' },
  'icespire-peak': { gen: 'lair', biome: 'tundra', name: 'Icespire Peak', level: 12, size: 'large' },
  'wyvern-tor': { gen: 'cave', biome: 'cave', name: 'Wyvern Tor', level: 5, size: 'small' },
  'kryptgarden-forest': { gen: 'forest', biome: 'forest', name: 'Kryptgarden Forest', level: 8, size: 'large' },
  'mere-of-dead-men': { gen: 'forest', biome: 'marsh', name: 'The Mere of Dead Men', level: 7, size: 'large' },
  leilon: { gen: 'ruins', biome: 'ruins', name: 'Leilon', level: 3, size: 'medium' },
  'ardeep-forest': { gen: 'forest', biome: 'forest', name: 'Ardeep Forest', level: 6, size: 'medium' },
});

/** 'undermountain-7' -> { base:'undermountain', depth:7 }. */
function splitDepth(id) {
  const m = /^(.*)-(\d+)$/.exec(String(id || ''));
  if (!m) return { base: String(id || ''), depth: 0 };
  return { base: m[1], depth: parseInt(m[2], 10) || 0 };
}

const GENERATORS = {
  dungeon: generateDungeon, cave: generateCave, mine: generateMine,
  crypt: generateCrypt, ruins: generateRuins, forest: generateForest, lair: generateLair,
};

/** Build whatever `id` most plausibly is, without ever throwing. */
function buildProcedural(id, ctx) {
  const { base, depth } = splitDepth(id);
  const site = PROC_SITES[base] || PROC_SITES[id] || null;
  const gen = GENERATORS[(site && site.gen) || 'dungeon'] || generateDungeon;
  const d = Math.max(1, depth || 1);
  const opts = {
    seed: `${ctx.seed}:${id}`,
    depth: d,
    theme: site && site.gen === 'forest' ? undefined : (site ? site.gen : 'dungeon'),
    biome: site ? site.biome : 'dungeon',
    size: (site && site.size) || 'medium',
    pine: site ? site.biome === 'pine-forest' : false,
    name: site ? (depth ? `${site.name} — Level ${depth}` : site.name) : titleFromId(base),
    level: site ? site.level : Math.max(1, d),
  };
  let map = null;
  try { map = gen(opts); } catch (e) {
    try { map = generateDungeon({ ...opts, theme: 'dungeon', biome: 'dungeon' }); } catch (e2) { map = null; }
  }
  if (!map) {
    // Absolute last resort: a small safe room, so travel never dead-ends.
    map = new TileMap({ w: 15, h: 11, id, name: titleFromId(base), biome: 'dungeon', indoor: true, music: 'dungeon' });
    floorRect(map, 0, 0, 15, 11, tid('STONE_FLOOR', 'DIRT'));
    dframe(map, 0, 0, 15, 11, tid('DUNGEON_WALL', 'STONE_WALL'));
    map.recomputeFlags({ keep: 0 });
    map.spawn = { x: 7, y: 5 };
  }
  map.id = id;
  if (!map.level) map.level = opts.level;
  map.region = base;

  // Endless sites keep descending under their own id; one-shot sites climb out.
  if (base === 'undermountain') {
    linkDungeonStairs(map, { id: 'undermountain', depth: d, up: { map: 'waterdeep', x: 20, y: 15, dir: 'down' } });
  } else if (base === 'wave-echo-cave') {
    linkDungeonStairs(map, { id: base, depth: d, up: d <= 1 ? { map: 'wave-echo-cave-entrance', x: 14, y: 29, dir: 'up' } : null });
  } else if (base === 'redbrand-hideout') {
    linkDungeonStairs(map, { id: base, depth: d, up: d <= 1 ? { map: 'phandalin-manor', x: 13, y: 4, dir: 'down' } : null });
  } else {
    linkDungeonStairs(map, { id: base, depth: d, up: null });
  }
  normalizeTriggers(map);
  return map;
}

function titleFromId(id) {
  return String(id || 'Somewhere').replace(/-/g, ' ').replace(/(^|\s)(\w)/g, (m, a, b) => a + b.toUpperCase());
}

// ---------------------------------------------------------------------------
// 10. METADATA
// ---------------------------------------------------------------------------

/**
 * A descriptor for any map id at all — hand-built, procedural site, or an
 * arbitrary '<site>-<depth>' floor. Never returns null.
 */
export function mapMeta(id) {
  const key = String(id || '');
  const d = MAP_DEFS[key];
  if (d) {
    return {
      id: d.id, name: d.name, kind: d.kind, biome: d.biome, indoor: d.indoor,
      safe: d.safe, music: d.music, level: d.level, region: d.region,
      parent: d.parent, w: d.w, h: d.h, desc: d.desc, procedural: false,
    };
  }
  const { base, depth } = splitDepth(key);
  const site = PROC_SITES[base] || PROC_SITES[key] || null;
  const name = site ? (depth ? `${site.name} — Level ${depth}` : site.name) : titleFromId(base || key);
  return {
    id: key,
    name,
    kind: site ? (site.gen === 'forest' ? 'wild' : site.gen) : 'dungeon',
    biome: site ? site.biome : 'dungeon',
    indoor: !site || site.gen !== 'forest',
    safe: false,
    music: site && site.gen === 'forest' ? 'field' : 'dungeon',
    level: (site ? site.level : 1) + Math.floor(Math.max(0, depth - 1) / 3),
    region: base || key,
    parent: null,
    w: 0, h: 0,
    desc: '',
    procedural: true,
    depth: depth || 0,
  };
}

/** Every hand-built place, for the world map screen and the debug warp menu. */
export function knownMaps() { return MAP_IDS.map((id) => mapMeta(id)); }

/** Is this a place we authored by hand? */
export function isHandBuilt(id) { return !!MAP_DEFS[id]; }

// ---------------------------------------------------------------------------
// 11. LOADING, CACHING AND PERSISTENCE
// ---------------------------------------------------------------------------

const cache = new Map();       // cacheKey -> TileMap

/** Drop one map (or all of them) so the next visit rebuilds from the seed. */
export function clearMapCache(id) {
  if (id == null) { cache.clear(); return 0; }
  let n = 0;
  const prefix = `${id}|`;
  for (const k of Array.from(cache.keys())) {
    if (k === id || k.startsWith(prefix)) { cache.delete(k); n++; }
  }
  return n;
}

function activeState(opts) {
  if (opts && opts.state) return opts.state;
  try { return Game && Game.state ? Game.state : null; } catch (e) { return null; }
}

function worldSeedOf(st, opts) {
  if (opts && opts.seed != null) return opts.seed;
  if (st && st.worldSeed != null) return st.worldSeed;
  if (st && st.seed != null) return st.seed;
  return 'sword-coast';
}

/** Depth matters to the cache key: level 7 of Undermountain is not level 6. */
function cacheKeyFor(id, st, opts) {
  const seed = worldSeedOf(st, opts);
  let depth = opts && opts.depth != null ? opts.depth : 0;
  if (!depth && id === 'undermountain') depth = undermountainDepth(st);
  return `${id}|${seed}|${depth}`;
}

// --- persistence ------------------------------------------------------------

function chestIsLooted(st, mapId, x, y) {
  if (!st || !st.chests) return false;
  return !!st.chests[`${mapId}:${x},${y}`];
}

function flagOn(st, name) {
  if (!st || !name) return false;
  if (st.flags && st.flags[name]) return true;
  return false;
}

/**
 * Fold the save file back over a freshly built map: fog of war, looted chests,
 * defeated uniques, doors you have already unlocked, one-shot scripts already
 * played. Everything here is best-effort — a save from an older build must
 * never stop a map from loading.
 */
function applyPersistentState(map, id, st) {
  if (!st) return map;
  try {
    if (st.discovered && st.discovered[id]) map.loadDiscovered(st.discovered[id]);
  } catch (e) { /* corrupt fog list */ }

  for (const t of map.triggers) {
    try {
      switch (t.kind) {
        case 'chest':
          if (chestIsLooted(st, id, t.x, t.y)) t.done = true;
          break;
        case 'battle': {
          const uid = t.data && (t.data.boss || t.data.unique || t.data.id);
          if (uid && st.defeated && st.defeated[uid]) t.done = true;
          if (t.data && t.data.flag && flagOn(st, t.data.flag)) t.done = true;
          break;
        }
        case 'script':
        case 'quest':
          if (t.data && t.data.flag && flagOn(st, t.data.flag)) t.done = true;
          break;
        default:
          break;
      }
    } catch (e) { /* skip a malformed trigger */ }
  }

  // Doors you have opened or unlocked stay that way.
  const doors = st.doors || null;
  if (doors) {
    for (const key of Object.keys(doors)) {
      if (!key.startsWith(`${id}:`)) continue;
      const part = key.slice(id.length + 1);
      const c = part.indexOf(',');
      const x = parseInt(part.slice(0, c), 10), y = parseInt(part.slice(c + 1), 10);
      if (!map.inBounds(x, y)) continue;
      map.set('deco', x, y, tid('DOOR_OPEN', 'DOOR_CLOSED'));
      openDoorway(map, x, y);
    }
  }

  if (st.visited) st.visited[id] = true;
  return map;
}

// --- entities ---------------------------------------------------------------

/** Nudge a spawn off a wall rather than letting an NPC vanish into stone. */
function safeTile(map, x, y) {
  if (!map.inBounds(x, y)) {
    const c = map.clampPos(x, y);
    x = c.x; y = c.y;
  }
  if (!map.solidAt(x, y)) return { x, y };
  const near = map.nearestWalkable(x, y, 8);
  return near || { x, y };
}

/**
 * Populate the map from data/npcs.js. `hidden`/`requires` gating is handled by
 * npcs.js itself; we just supply the flag lookup.
 */
function spawnNpcs(map, id, st) {
  const flagFn = (name) => flagOn(st, name);
  let list = [];
  try { list = spawnableOnMap(id, flagFn) || []; } catch (e) { list = []; }
  const slain = (st && st.crime && st.crime.slain) || {};
  for (const n of list) {
    // Someone the party killed does not open the shop again tomorrow. This is
    // the authoritative spawn for every hand-built map, so the check has to be
    // here — the overworld's own populateCast only ever sees what this missed.
    if (slain[n.id]) continue;
    try {
      // Never let a decoration bury somebody.
      clearStanding(map, n.x, n.y);
      const at = safeTile(map, n.x, n.y);
      const e = new NPCEntity({
        id: `npc-${n.id}`, npcId: n.id, name: n.name, title: n.title || '',
        x: at.x, y: at.y, dir: n.dir || 'down',
        sprite: n.sprite, colorway: n.colorway,
        solid: n.solid !== false,
        wander: n.wander || 0,
        dialogueId: n.dialogue || null,
        shopId: n.shop || null,
        questIds: n.quests || [],
        faction: n.faction || null,
        role: n.role || 'flavor',
        greeting: n.greeting || null,
        schedule: n.schedule || null,
        // rules/crime.js reads these to decide whether steel may be drawn.
        tag: n.tag || null,
        essential: !!n.essential,
        noCombat: !!n.noCombat,
        npc: n,
        home: { x: at.x, y: at.y },
        data: { tag: n.tag || null, species: n.species || 'human', title: n.title || '' },
      });
      map.addEntity(e);
    } catch (e) { /* a broken cast entry must not break the map */ }
  }
  return map;
}

// --- the loader -------------------------------------------------------------

/**
 * Build (or fetch from cache) the map called `id`.
 *
 *   loadMap('phandalin')
 *   loadMap('undermountain')            // depth comes from state.depth.undermountain
 *   loadMap('undermountain-7')          // an explicit floor
 *   loadMap('cragmaw-hideout')          // procedural, via mapgen
 *
 * opts: { seed, state, depth, force, entities=true, cache=true }
 */
export function loadMap(id, opts = {}) {
  const mapId = String(id || 'phandalin');
  const st = activeState(opts);
  const key = cacheKeyFor(mapId, st, opts);

  if (opts.force) cache.delete(key);
  const hit = opts.cache === false ? null : cache.get(key);
  if (hit) {
    applyPersistentState(hit, mapId, st);
    return hit;
  }

  const seed = worldSeedOf(st, opts);
  const ctx = {
    id: mapId, seed, state: st,
    depth: opts.depth != null ? opts.depth : undefined,
    flags: (st && st.flags) || {},
  };

  let map = null;
  const d = MAP_DEFS[mapId];
  if (d && typeof d.build === 'function') {
    try {
      map = d.build(makeRNG(`${seed}:${mapId}`), ctx);
    } catch (e) {
      // A broken hand-built map should not end the campaign; fall back to a
      // generated stand-in with the right name so travel still works.
      try { console.error(`[maps] ${mapId} failed to build`, e); } catch (e2) { /* no console */ }
      map = null;
    }
  }
  if (!map) map = buildProcedural(mapId, ctx);

  // --- normalise ----------------------------------------------------------
  map.id = mapId;
  if (d) {
    if (d.name) map.name = d.name;
    map.region = map.region || d.region || null;
    if (d.safe) map.safe = true;
    if (!map.level) map.level = d.level;
  }
  if (!map.spawn || map.solidAt(map.spawn.x, map.spawn.y)) {
    const s = safeTile(map, map.spawn ? map.spawn.x : map.w >> 1, map.spawn ? map.spawn.y : map.h >> 1);
    map.spawn = { x: s.x, y: s.y };
  }
  map.entry = map.entry || { ...map.spawn };

  // Declared warps last, so they win over anything a generator painted.
  applyWarpNodes(map, mapId);
  try { map.reindexTriggers(); } catch (e) { /* fresh map */ }

  // Encounter zones for wilds that did not declare any of their own.
  if (!map.indoor && !map.safe && map.encounterTable && !map.triggersOfKind('encounter-zone').length) {
    try { placeEncounterZones(map, makeRNG(`${seed}:${mapId}:zones`), { biome: map.biome }); } catch (e) { /* optional */ }
  }

  // --- populate -----------------------------------------------------------
  if (!map.entityList) new EntityList(map);
  if (opts.entities !== false) spawnNpcs(map, mapId, st);

  applyPersistentState(map, mapId, st);
  if (opts.cache !== false) cache.set(key, map);
  return map;
}

/** Rebuild a map from scratch, discarding the cached copy. */
export function reloadMap(id, opts = {}) { return loadMap(id, { ...opts, force: true }); }

/** What is currently cached — handy for the debug overlay. */
export function cachedMapKeys() { return Array.from(cache.keys()); }

export default MAP_DEFS;
