// world/overworld.js — the walking-around game: the scene you spend most of Sword
// Coast Chronicles inside. Grid-locked GBA-style movement, a party that snakes along
// behind you, townsfolk to talk to, doors to push open, chests to prise up, ledges to
// hop down, and goblins in the tall grass off the Triboar Trail.
//
// The rules of the road, in one place:
//   * The leader owns a tile. Movement commits to the destination immediately and
//     tweens the sprite across it (see Entity.step), so occupancy is never ambiguous.
//   * A direction tapped for less than TURN_DELAY turns you in place. Held, you walk.
//     The next input is buffered so a held key never stutters between tiles.
//   * Followers retrace Party.trail. Two trail entries are pushed per step (the tile
//     left and the tile entered), which makes Party.trailFor(i) — trail[i*2-1] — land
//     exactly one tile behind the member in front.
//   * Everything the player can touch answers with the same little payload shape:
//     { kind:'dialogue'|'shop'|'sign'|'chest'|'warp'|'battle'|'inn'|'rest', data }.
//     entity.js already speaks it; map triggers are translated into it here.
//
// Optional modules (maps.js, the battle UI, the menus) are pulled in softly: if one
// has not been written yet the overworld degrades — a fallback meadow, a toast — but
// it never throws and never strands the player.

import {
  TILE, VIEW_W, VIEW_H, DIR_VEC, dirFrom,
  WALK_TIME, RUN_TIME, PARTY_MAX, clamp, timeOfDay, titleCase,
} from '../constants.js';
import { Game } from '../engine.js';
import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { Save } from '../core/save.js';
import { trackForBiome } from '../core/music.js';

/**
 * Which loop belongs to a map right now. A map may name its own track; otherwise
 * the biome decides, and open country swaps to the night theme after dark.
 */
function mapTrack(map, st) {
  if (!map) return 'field';
  const night = !map.indoor && !map.safe && st && (st.time < 300 || st.time >= 1200);
  if (map.music) {
    // Only the generic outdoor loop yields to nightfall; a named theme stands.
    if (night && map.music === 'field') return 'night';
    return map.music;
  }
  return trackForBiome(map.biome, { night, indoor: map.indoor });
}
import { bus, EV, toast } from '../core/events.js';
import { rng, makeRNG } from '../core/rng.js';
import { FX } from '../render/fx.js';
import { drawTile, tileGroup, tileKey as tileKeyOf, T } from '../render/tiles.js';
import { UI } from '../ui/kit.js';
import { HUD } from '../ui/hud.js';
import { Hotbar, SLOT_COUNT } from '../ui/hotbar.js';
import { TileMap, TF, isStepTrigger } from './tilemap.js';
import { Entity, EntityList, ChestEntity, makeEntity, spawnFromTriggers } from './entity.js';
import { Party } from './party.js';
import { buildBattleMap } from './battlemap.js';
import { rollEncounter, makeMonster } from '../rules/scaling.js';
import {
  expireFieldBuffs, fieldBuffsToRounds, fieldCastable, fieldCast, fieldTargeting, minutesFor,
} from '../rules/fieldcast.js';
import {
  advanceTime, tickWeather, isChestLooted, markChestLooted, progressQuests, failQuest,
} from '../state.js';
import { spawnableOnMap, getNPC } from '../data/npcs.js';
import {
  canAttack as crimeCanAttack, statBlockFor, witnessesNear, guardsAmong,
  reportAssault, reportDeath, isSlain, watchOwed, clearWatch, watchPatrol,
  bountyIn, isOutlawIn,
} from '../rules/crime.js';
import { resolveItem } from '../data/items.js';
import { getSpell } from '../data/spells.js';
import { heal as healMember, isDead as isDeadMember } from '../rules/character.js';
import { rollExpr } from '../core/dice.js';

// ---------------------------------------------------------------------------
// 0. TUNING
// ---------------------------------------------------------------------------

/** Hold a new direction this long before you actually walk; shorter is a turn. */
const TURN_DELAY = 0.085;
/** Difficult terrain (TF.SLOW) multiplies the step time. */
const SLOW_FACTOR = 1.75;
/** Seconds of peace after a fight before the wilds may ambush you again. */
const ENCOUNTER_GRACE = 7;
/** How far a step reveals the minimap. */
const REVEAL_R = 7;
/** Camera catch-up per second (1 - e^-k dt is applied below). */
const CAM_LERP = 11;
/** Town ids that are always safe to autosave in, even if maps.js says nothing. */
const CANON_TOWNS = new Set(['phandalin', 'leilon', 'neverwinter', 'waterdeep', 'triboar']);

// ---------------------------------------------------------------------------
// 1. SOFT MODULE LOADING
// ---------------------------------------------------------------------------
//
// Nothing below is allowed to be fatal. maps.js in particular is authored by a
// sibling module; until it lands the overworld builds its own meadow so the game
// is still walkable.

const LATE = {
  maps: null, mapgen: null, dialogue: null, shop: null, menus: null,
  combat: null, combatui: null, loot: null, main: null,
};

function pull(key, path) {
  return import(path)
    .then((m) => { LATE[key] = m; return m; })
    .catch((e) => { console.warn(`[overworld] optional module ${path} unavailable`, e && e.message); return null; });
}

/** maps.js is special: travelTo waits on it exactly once, then never again. */
let mapsSettled = false;
const mapsReady = pull('maps', './maps.js').then((m) => { mapsSettled = true; return m; });

pull('mapgen', './mapgen.js');
pull('dialogue', '../ui/dialogue.js');
pull('shop', '../ui/shop.js');
pull('menus', '../ui/menus.js');
pull('combat', '../rules/combat.js');
pull('combatui', '../ui/combatui.js');
pull('loot', '../data/items_magic.js');

/** Run a thing that touches an optional module; never let it kill the frame. */
function safe(fn, fallback = null) {
  try { return fn(); } catch (e) { console.warn('[overworld]', e); return fallback; }
}

const state = () => Game.state || null;
const arrOf = (v) => (Array.isArray(v) ? v : []);
const flagsOf = () => (Game.state && Game.state.flags) || {};

// ---------------------------------------------------------------------------
// 2. MAP CACHE
// ---------------------------------------------------------------------------

/** mapId -> TileMap. Keeps chests open and NPCs where you left them this session. */
const mapCache = new Map();

/** Drop everything (new campaign, or a load from the title screen). */
export function clearMapCache() { mapCache.clear(); cacheStamp = null; }

/**
 * The cache holds live maps — chests you opened, NPCs mid-stroll. That is exactly
 * right inside one campaign and exactly wrong across two, so every trip checks
 * whose campaign it belongs to and empties the cache when the answer changes.
 */
let cacheStamp = null;
function checkCampaign() {
  const st = state();
  const stamp = st ? `${st.seed}|${st.createdAt}` : null;
  if (stamp === cacheStamp) return;
  mapCache.clear();
  cacheStamp = stamp;
}

function worldSeed() {
  const st = state();
  return st ? (st.worldSeed || st.seed || 'sword-coast') : 'sword-coast';
}

/**
 * Copy a map's fog of war into the save state — but only when it actually grew.
 * Rebuilding the array is O(tiles seen), so the guard keeps a fully-explored
 * region map from stuttering the frame every time a menu opens.
 */
function syncDiscovered(map) {
  const st = state();
  if (!st || !map || !map.discovered) return;
  if (map._discSynced === map.discovered.size) return;
  map._discSynced = map.discovered.size;
  st.discovered = st.discovered || {};
  st.discovered[map.id] = Array.from(map.discovered);
}

/**
 * The last-resort map: a small walkable meadow with a pond, a stand of oaks and a
 * signpost, built deterministically from the id. Only ever seen if maps.js is
 * missing — but seeing this beats seeing a black screen.
 */
function buildFallbackMap(id, opts = {}) {
  const r = makeRNG(`fallback:${id}:${worldSeed()}`);
  const indoor = /inn|shop|hall|house|manor|coster|exchange|shrine|provisions|giant/.test(id);
  const w = indoor ? 20 : 40;
  const h = indoor ? 15 : 34;
  const map = new TileMap({
    id, w, h,
    name: titleCase(String(id).replace(/-/g, ' ')),
    biome: indoor ? 'city' : 'plains',
    indoor,
    music: indoor ? 'town' : 'field',
    encounterRate: indoor ? 0 : 0.05,
    ground: indoor ? (T.WOOD_FLOOR || T.STONE_FLOOR || 1) : (T.GRASS || 1),
  });

  if (indoor) {
    map.border('deco', T.WATTLE_WALL || T.STONE_WALL || 0, { addFlags: TF.SOLID });
    map.spawn = { x: w >> 1, y: h - 3 };
  } else {
    // A dirt track down the middle, tall grass either side, a pond, some oaks.
    for (let y = 0; y < h; y++) map.set('ground', w >> 1, y, T.DIRT_PATH || T.DIRT || 1, true);
    for (let i = 0; i < (w * h) / 9; i++) {
      const x = r.int(1, w - 2), y = r.int(1, h - 2);
      if (Math.abs(x - (w >> 1)) < 2) continue;
      map.set('ground', x, y, T.GRASS_TALL || T.GRASS || 1, true);
    }
    const px = r.int(4, w - 8), py = r.int(4, h - 8);
    for (let y = py; y < py + 4; y++) {
      for (let x = px; x < px + 5; x++) {
        if (Math.hypot(x - (px + 2), y - (py + 1.5)) > 2.4) continue;
        map.set('ground', x, y, T.WATER || 0, true);
      }
    }
    for (let i = 0; i < 26; i++) {
      const x = r.int(1, w - 2), y = r.int(1, h - 2);
      if (Math.abs(x - (w >> 1)) < 3) continue;
      if (map.flagAt(x, y) & (TF.SOLID | TF.WATER)) continue;
      map.set('deco', x, y, r.chance(0.5) ? (T.TREE_OAK || 0) : (T.BUSH || 0), true);
    }
    map.border('deco', T.TREE_PINE || T.TREE_OAK || 0, { addFlags: TF.SOLID });
    map.spawn = { x: w >> 1, y: h - 4 };
    map.addTrigger({
      x: (w >> 1) + 1, y: h - 5, kind: 'sign',
      data: { title: 'Waymarker', text: 'The Triboar Trail runs east. Phandalin lies south of it.' },
    });
    safe(() => map.recomputeFlags());
  }
  map.meta = { ...(map.meta || {}), fallback: true };
  return map;
}

/** Ask maps.js for a map; fall back to mapgen, then to the meadow above. */
function buildMap(id, opts = {}) {
  const seed = `${worldSeed()}:${id}:${opts.depth || 0}`;
  let map = null;

  if (LATE.maps && typeof LATE.maps.loadMap === 'function') {
    map = safe(() => LATE.maps.loadMap(id, { seed, ...opts }), null);
  }

  // A procedural floor of an endless dungeon, when maps.js has no opinion.
  if (!map && opts.depth != null && LATE.mapgen && typeof LATE.mapgen.generateDungeon === 'function') {
    map = safe(() => LATE.mapgen.generateDungeon({
      seed, depth: opts.depth, theme: opts.theme || 'dungeon',
      biome: opts.biome || 'dungeon', size: 'medium',
    }), null);
  }

  if (!map) map = buildFallbackMap(id, opts);
  if (!map.id) map.id = id;
  return map;
}

/** Load (or recall) a map, fully wired: triggers indexed, entities live, cast in place. */
function loadMapById(id, opts = {}) {
  const key = opts.depth != null ? `${id}@${opts.depth}` : id;
  if (mapCache.has(key) && !opts.fresh) return mapCache.get(key);

  const map = buildMap(id, opts);
  if (!map) return null;
  map.mapId = key;

  // mapgen pushes triggers straight onto the array, so the tile index may be cold.
  safe(() => map.reindexTriggers());

  // One EntityList per map; it adopts map.entities so the HUD minimap keeps working.
  if (!map.entityList) safe(() => new EntityList(map));
  safe(() => spawnFromTriggers(map, (npcId) => npcSpawnDef(npcId)));
  populateCast(map, id);
  hydrateTriggerEntities(map, key);

  mapCache.set(key, map);
  return map;
}

/** The NPCS entry, flattened into the shape NPCEntity wants. */
function npcSpawnDef(npcId) {
  const n = safe(() => getNPC(npcId), null);
  if (!n) return null;
  return {
    cls: 'npc', npcId: n.id, name: n.name, sprite: n.sprite, colorway: n.colorway,
    dialogueId: n.dialogue || n.id, shopId: n.shop || null, questIds: n.quests || [],
    faction: n.faction || null, role: n.role || 'flavor', greeting: n.greeting || null,
    tag: n.tag || null, essential: !!n.essential, noCombat: !!n.noCombat, npc: n,
    dir: n.dir || 'down', wander: n.wander != null ? n.wander : 1,
    solid: n.solid !== false, schedule: n.schedule || null, patrol: n.patrol || null,
  };
}

/**
 * Put the written cast on the map. data/npcs.js is authoritative about who lives
 * where; if maps.js already placed someone we leave them alone, so this is safe to
 * run whichever module got there first.
 */
function populateCast(map, mapId) {
  const cast = safe(() => spawnableOnMap(mapId, (f) => !!flagsOf()[f]), []) || [];
  if (!cast.length) return 0;
  const present = new Set();
  for (const e of map.entities) if (e && e.npcId) present.add(e.npcId);

  let placed = 0;
  for (const n of cast) {
    if (present.has(n.id)) continue;
    // Someone you killed does not open the shop again tomorrow.
    if (safe(() => isSlain(state(), n.id), false)) continue;
    const def = npcSpawnDef(n.id);
    if (!def) continue;
    let x = n.x | 0, y = n.y | 0;
    if (!map.inBounds(x, y) || map.solidAt(x, y)) {
      const spot = map.nearestWalkable(x, y, 8) || map.spawn;
      x = spot.x; y = spot.y;
    }
    const e = safe(() => makeEntity({ ...def, x, y, home: { x, y } }), null);
    if (!e) continue;
    safe(() => map.addEntity(e));
    placed++;
  }
  return placed;
}

/**
 * Turn the map's authored triggers into real entities where an entity does the job
 * better — chests especially, which need to remember they were opened.
 */
function hydrateTriggerEntities(map, mapId) {
  const have = new Set();
  for (const e of map.entities) if (e) have.add(`${e.kind}:${e.x},${e.y}`);

  for (const t of map.triggers) {
    if (!t || t.kind !== 'chest') continue;
    if (have.has(`chest:${t.x},${t.y}`)) continue;
    const d = t.data || {};
    const e = safe(() => new ChestEntity({
      x: t.x, y: t.y, mapId,
      loot: d.loot || d.items || [],
      gold: d.gold || 0,
      lootTable: d.table || d.lootTable || null,
      locked: !!d.locked, keyId: d.keyId || null, dc: d.dc || 0,
      trapped: d.trapped || null,
      data: { ...d },
    }), null);
    if (e) safe(() => map.addEntity(e));
  }
}

// ---------------------------------------------------------------------------
// 3. TRAVEL
// ---------------------------------------------------------------------------

/** The live OverworldScene, so travel and dialogue can find it. */
let activeScene = null;

function findScene() {
  if (activeScene) return activeScene;
  for (let i = Game.scenes.length - 1; i >= 0; i--) {
    const s = Game.scenes[i];
    if (s instanceof OverworldScene) return s;
  }
  return null;
}

function resolveSpawn(map, x, y) {
  let tx = Number.isFinite(x) ? x | 0 : null;
  let ty = Number.isFinite(y) ? y | 0 : null;
  if (tx == null || ty == null || !map.inBounds(tx, ty)) {
    tx = map.spawn ? map.spawn.x : map.w >> 1;
    ty = map.spawn ? map.spawn.y : map.h >> 1;
  }
  if (map.solidAt(tx, ty)) {
    const near = map.nearestWalkable(tx, ty, 10);
    if (near) { tx = near.x; ty = near.y; }
  }
  return { x: tx, y: ty };
}

function isTownMap(map, id) {
  if (!map) return false;
  if (map.kind === 'town' || map.town || (map.meta && map.meta.town)) return true;
  if (CANON_TOWNS.has(id)) return true;
  return false;
}

/**
 * Move the party to another map.
 *
 * Loads it (via maps.js when that module exists), stands the party on the spot,
 * resets the follow trail, updates the campaign state, starts the map's music,
 * emits MAP_ENTER and lights up the minimap around the arrival point.
 *
 * Safe to call before maps.js has finished loading — the trip is queued and runs
 * the moment it settles.
 */
export function travelTo(mapId, x, y, dir) {
  if (!mapsSettled) {
    mapsReady.then(() => _travel(mapId, x, y, dir, {}));
    return null;
  }
  return _travel(mapId, x, y, dir, {});
}

function _travel(mapId, x, y, dir, opts = {}) {
  checkCampaign();
  const st = state();
  const id = mapId || (st && st.mapId) || 'phandalin';
  const map = loadMapById(id, opts);
  if (!map) { toast('That road goes nowhere yet.'); return null; }

  const spot = resolveSpawn(map, x, y);
  const facing = dir || (st && st.dir) || 'down';
  const scene = findScene();

  // --- fog of war: remember what we had already seen here --------------------
  if (st && !map._discLoaded) {
    st.discovered = st.discovered || {};
    map._discLoaded = true;
    safe(() => map.loadDiscovered(st.discovered[id] || []));
  }
  safe(() => map.revealAround(spot.x, spot.y, REVEAL_R));
  syncDiscovered(map);

  // --- campaign state -------------------------------------------------------
  if (st) {
    if (st.mapId && st.mapId !== id) bus.emit(EV.MAP_EXIT, { mapId: st.mapId });
    st.mapId = id;
    st.x = spot.x; st.y = spot.y; st.dir = facing;
    st.visited = st.visited || {};
    st.visited[id] = true;
    if (opts.depth != null) {
      st.depth = st.depth || {};
      st.depth[opts.theme || id] = opts.depth;
      st.stats.deepestFloor = Math.max(st.stats.deepestFloor || 0, opts.depth);
    }
    if (isTownMap(map, id)) {
      st.lastTown = id;
      st.lastSafe = { mapId: id, x: spot.x, y: spot.y };
    } else if (map.safe || map.indoor) {
      st.lastSafe = { mapId: id, x: spot.x, y: spot.y };
    }
  }

  // --- the party ------------------------------------------------------------
  Party.resetTrail(spot.x, spot.y, facing);
  if (scene) scene.bindMap(map, spot.x, spot.y, facing);

  Game.map = map;
  safe(() => Audio.music(mapTrack(map, Game.state)));
  bus.emit(EV.MAP_ENTER, { mapId: id, map, x: spot.x, y: spot.y, dir: facing });
  bus.emit(EV.WARP, { mapId: id, x: spot.x, y: spot.y });

  if (isTownMap(map, id)) autosave();
  return map;
}

/** Autosave through main.js, which owns the save slots. Never blocks. */
function autosave() {
  const run = (m) => { if (m && typeof m.autosave === 'function') safe(() => m.autosave()); };
  if (LATE.main) { run(LATE.main); return; }
  import('../main.js').then((m) => { LATE.main = m; run(m); }).catch(() => { /* standalone test page */ });
}

// ---------------------------------------------------------------------------
// 4. DAY / NIGHT AND LIGHT
// ---------------------------------------------------------------------------

/** Colour-grade keyframes across the 1440-minute day. `a` is multiply strength. */
const TINT_KEYS = [
  { t: 0, c: [0.36, 0.42, 0.74], a: 0.60 },   // deep night, moonlit blue
  { t: 285, c: [0.42, 0.44, 0.74], a: 0.55 },
  { t: 360, c: [0.98, 0.72, 0.52], a: 0.36 }, // dawn, warm gold on the mud
  { t: 450, c: [1.00, 0.93, 0.82], a: 0.12 },
  { t: 720, c: [1.00, 1.00, 1.00], a: 0.00 }, // noon, no grade at all
  { t: 1000, c: [1.00, 0.92, 0.76], a: 0.10 },
  { t: 1090, c: [1.00, 0.60, 0.33], a: 0.36 }, // dusk, long orange light
  { t: 1210, c: [0.48, 0.44, 0.76], a: 0.50 },
  { t: 1440, c: [0.36, 0.42, 0.74], a: 0.60 },
];

function dayTint(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  let a = TINT_KEYS[0], b = TINT_KEYS[TINT_KEYS.length - 1];
  for (let i = 0; i < TINT_KEYS.length - 1; i++) {
    if (m >= TINT_KEYS[i].t && m <= TINT_KEYS[i + 1].t) { a = TINT_KEYS[i]; b = TINT_KEYS[i + 1]; break; }
  }
  const span = Math.max(1, b.t - a.t);
  const k = clamp((m - a.t) / span, 0, 1);
  return {
    r: Math.round(255 * (a.c[0] + (b.c[0] - a.c[0]) * k)),
    g: Math.round(255 * (a.c[1] + (b.c[1] - a.c[1]) * k)),
    b: Math.round(255 * (a.c[2] + (b.c[2] - a.c[2]) * k)),
    a: a.a + (b.a - a.a) * k,
  };
}

/** Tiles that throw light, and how much. */
const GLOW_TILES = {
  TORCH: { r: 30, c: [255, 176, 80], flick: 1 },
  BRAZIER: { r: 34, c: [255, 150, 60], flick: 1 },
  CANDLE: { r: 16, c: [255, 216, 140], flick: 0.6 },
  CHANDELIER: { r: 32, c: [255, 206, 130], flick: 0.4 },
  HEARTH: { r: 34, c: [255, 140, 60], flick: 1 },
  FORGE: { r: 32, c: [255, 106, 44], flick: 1 },
  COOKING_POT: { r: 20, c: [255, 150, 70], flick: 0.8 },
  LAVA: { r: 24, c: [255, 90, 44], flick: 0.7 },
  CRYSTAL: { r: 22, c: [128, 216, 255], flick: 0.25 },
  PORTAL: { r: 28, c: [176, 122, 224], flick: 0.5 },
  WINDOW_LIT: { r: 22, c: [255, 214, 138], flick: 0.2 },
  WINDOW: { r: 18, c: [255, 206, 130], flick: 0.15, nightOnly: true },
  SHRINE: { r: 22, c: [255, 232, 168], flick: 0.2 },
};

/** Scan a map once for light sources; the result rides on the map. */
function glowsFor(map) {
  if (map._glows) return map._glows;
  const byId = new Map();
  for (const [name, def] of Object.entries(GLOW_TILES)) {
    const id = T[name];
    if (id != null) byId.set(id, def);
  }
  const out = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const i = y * map.w + x;
      const def = byId.get(map.deco[i]) || byId.get(map.over[i]) || byId.get(map.ground[i]);
      if (!def) continue;
      out.push({ x, y, def, phase: ((x * 7 + y * 13) % 32) / 32 });
    }
  }
  map._glows = out;
  return out;
}

// ---------------------------------------------------------------------------
// 4b. SCRIPT MARKERS
// ---------------------------------------------------------------------------

/**
 * mapgen drops bare `script` triggers into procedural floors — a seam in a wall, a
 * barred vault, Halaster amusing himself. They carry a `kind` and no dialogue tree,
 * so give each one a line rather than handing the player a stranger's small talk.
 */
const SCRIPT_LINES = {
  'secret-door': 'A seam runs down the stonework, too straight to be a crack. Something opens here.',
  'locked-door': 'The door is barred from the far side. Iron, and recently oiled.',
  'halaster-taunt': 'A voice comes up out of the rock, delighted and entirely mad. "Deeper," says Halaster Blackcloak. "Do go deeper."',
  default: 'Nothing here but old stone and older air.',
};

// ---------------------------------------------------------------------------
// 5. FOOTSTEPS
// ---------------------------------------------------------------------------

const STONE_KEYS = new Set([
  'COBBLE', 'FLAGSTONE', 'STONE_FLOOR', 'STONE_FLOOR_CRACKED', 'DUNGEON_FLOOR',
  'MOSAIC', 'CAVE_FLOOR', 'CAVE_FLOOR_RUBBLE', 'BONE_FLOOR', 'BRIDGE_STONE',
  'GRAVEL', 'RUBBLE', 'ICE',
]);
const WOOD_KEYS = new Set(['WOOD_FLOOR', 'WOOD_FLOOR_H', 'BRIDGE_WOOD']);
const SOFT_KEYS = new Set(['SAND', 'SNOW', 'SNOW_GRASS', 'ASH_GROUND', 'ASH_DRIFT']);
const WET_KEYS = new Set(['MUD', 'SWAMP_WATER', 'WATER', 'FARMLAND']);

/** A footfall that sounds like the ground it lands on. */
function footstepFor(map, x, y) {
  const id = map.at('ground', x, y);
  const key = safe(() => tileKeyOf(id), 'GRASS') || 'GRASS';
  const group = safe(() => tileGroup(id), null);
  if (WOOD_KEYS.has(key)) return ['footstep-stone', { vol: 0.85, pitch: 5 }];
  if (STONE_KEYS.has(key) || group === 'road') return ['footstep-stone', { vol: 1, pitch: 0 }];
  if (WET_KEYS.has(key)) return ['footstep-grass', { vol: 1.25, pitch: -7 }];
  if (SOFT_KEYS.has(key)) return ['footstep-grass', { vol: 0.7, pitch: -3 }];
  return ['footstep-grass', { vol: 1, pitch: 0 }];
}

// ---------------------------------------------------------------------------
// 6. THE SCENE
// ---------------------------------------------------------------------------

export class OverworldScene {
  /**
   * @param {string}  mapId  where to start; omit to use Game.state.mapId
   * @param {object}  spawn  { x, y, dir }
   */
  constructor(mapId = null, spawn = null) {
    this.id = 'overworld';
    this.opaque = true;
    this.pausesBelow = true;

    this.t = 0;
    this.map = null;
    this.entities = null;
    this.hud = new HUD();

    this._startMapId = mapId || null;
    this._startSpawn = spawn || null;
    this._entered = false;

    // Camera: float target, integer draw offset.
    this.cam = { x: 0, y: 0 };
    this.camDraw = { x: 0, y: 0 };

    // The walking party. The leader is solid so townsfolk step around you; the
    // followers are not, so you can turn around and walk back through your own line.
    this.player = new Entity({ kind: 'party', solid: true, moveTime: WALK_TIME, shadow: true });
    this.followers = [];
    this._syncPartySprites();

    // Movement bookkeeping.
    this.heldDir = null;
    this.turnT = 0;
    this.running = false;
    this._wasMoving = false;
    this._bumpSfxT = 0;

    // Encounters.
    this.stepsToEncounter = 12;
    this.encounterGrace = 2;
    this.pendingBattleFrom = null;

    // Presentation.
    this.popup = null;      // { title, lines, t, life }
    this.banner = null;     // { text, sub, t }
    this._weatherKind = null;
    this.spellLight = null;       // Light / Dancing Lights, cast from the spellbook
    this.hotbar = new Hotbar();   // the bottom strip: every verb, visible, clickable
    this._slots = [];             // quick-slot model, rebuilt a couple of times a second
    this._slotT = 0;
    this._restOff = null;
  }

  // =========================================================================
  // 6.1 LIFECYCLE
  // =========================================================================

  enter(prev) {
    activeScene = this;
    Input.flush();
    this._syncPartySprites();

    if (!this._entered) {
      this._entered = true;
      const st = state();
      const id = this._startMapId || (st && st.mapId) || 'phandalin';
      const sp = this._startSpawn || (st ? { x: st.x, y: st.y, dir: st.dir } : null);
      travelTo(id, sp ? sp.x : undefined, sp ? sp.y : undefined, sp ? sp.dir : 'down');
      return;
    }

    // Coming back from a menu, a shop or a fight.
    if (this.map) {
      safe(() => Audio.music(mapTrack(this.map, Game.state)));
      this._applyWeather(true);
      this.hud.setMap(this.map);
    }
  }

  exit(next) {
    if (this.map) this._syncDiscovered();
  }

  /** Called by travelTo once the destination map is built. */
  bindMap(map, x, y, dir) {
    if (!map) return;
    const old = this.map;
    if (old && old !== map) {
      this._detachParty(old);
      this._syncDiscovered(old);
    }

    this.map = map;
    this.entities = map.entityList || safe(() => new EntityList(map)) || null;

    this._syncPartySprites();
    this._attachParty(map, x, y, dir);

    this.heldDir = null;
    this.turnT = 0;
    this._wasMoving = false;
    this.popup = null;
    this.encounterGrace = Math.max(this.encounterGrace, 1.2);
    this._resetEncounterCounter();

    this.hud.setMap(map);
    this._applyWeather(true);
    this._snapCamera();
    map._edgeMask = null;   // rebuilt lazily by _drawEdges for the new place
    this._exitNames = null; // destination names belong to the map we just left
    this._exitLabel = null;

    const name = map.name || titleCase(String(map.id || '').replace(/-/g, ' '));
    this.banner = { text: name, sub: map.indoor ? null : this._regionSub(map), t: 0 };
    map._glows = null;     // rescan lights for the new map
  }

  _regionSub(map) {
    const st = state();
    if (!st) return null;
    const phase = timeOfDay(st.time);
    return phase === 'night' ? 'Night' : phase === 'dawn' ? 'Dawn' : phase === 'dusk' ? 'Dusk' : null;
  }

  // --- party sprites --------------------------------------------------------

  /** Keep the walking sprites pointed at the current roster. */
  _syncPartySprites() {
    const members = Party.members || [];
    this.player.char = members[0] || null;
    this.player.name = members[0] ? members[0].name : 'Adventurer';

    const want = Math.min(PARTY_MAX - 1, Math.max(0, members.length - 1));
    while (this.followers.length > want) {
      const f = this.followers.pop();
      if (f && f.list) safe(() => f.list.remove(f));
      else if (f && f.map) safe(() => f.map.removeEntity(f));
    }
    while (this.followers.length < want) {
      const i = this.followers.length;
      const f = new Entity({
        kind: 'party', solid: false, moveTime: WALK_TIME, shadow: true,
        zBias: -0.05 * (i + 1),     // ties go to the leader, so they walk on top
      });
      this.followers.push(f);
      if (this.map && this.entities) {
        f.setTile(this.player.x, this.player.y, this.player.dir);
        safe(() => this.entities.add(f));
      }
    }
    for (let i = 0; i < this.followers.length; i++) {
      this.followers[i].char = members[i + 1] || null;
      this.followers[i].name = members[i + 1] ? members[i + 1].name : '';
    }
  }

  _attachParty(map, x, y, dir) {
    const list = this.entities;
    this.player.map = map;
    this.player.setTile(x, y, dir);
    if (list) safe(() => list.add(this.player));
    for (const f of this.followers) {
      f.map = map;
      f.setTile(x, y, dir);
      if (list) safe(() => list.add(f));
    }
    if (list) list.player = { x, y };
  }

  _detachParty(map) {
    const list = map && map.entityList;
    if (!list) return;
    for (const e of [this.player, ...this.followers]) {
      const i = list.list.indexOf(e);
      if (i >= 0) list.list.splice(i, 1);
      safe(() => list.unindex(e));
      e.removed = false;      // they live on; they just moved house
      e.list = null;
    }
  }

  // =========================================================================
  // 6.2 UPDATE
  // =========================================================================

  update(dt) {
    this.t += dt;
    this.hud.update(dt);
    if (!this.map) return;

    // A recruit joined at the inn, or someone was benched: re-cast the walking line.
    if (this.player.char !== (Party.members[0] || null)
      || this.followers.length !== Math.min(PARTY_MAX - 1, Math.max(0, Party.members.length - 1))) {
      this._syncPartySprites();
    }

    this._updateTimers(dt);
    this._updateEntities(dt);

    // A finished step is where the world reacts: triggers, encounters, sounds.
    const busy = this._settleStep();

    if (!busy) this._updateInput(dt);

    this._updateFollowers();
    this._updateCamera(dt);
    this._updateWorldClock(dt);
    this._checkRoamers();
    this._checkWatch();
  }

  _updateTimers(dt) {
    if (this.encounterGrace > 0) this.encounterGrace -= dt;
    if (this._bumpSfxT > 0) this._bumpSfxT -= dt;
    if (this.banner) { this.banner.t += dt; if (this.banner.t > 3.2) this.banner = null; }
    if (this.popup) {
      this.popup.t += dt;
      const done = Input.consume('confirm') || Input.consume('cancel') || Input.consume('interact');
      if (done || this.popup.t > (this.popup.life || 4.5)) {
        this.popup = null;
        Input.consumeAll();
      }
    }
  }

  _updateEntities(dt) {
    if (!this.entities) return;
    this.entities.update(dt, {
      player: { x: this.player.x, y: this.player.y },
      dir: this.player.dir,
      phase: state() ? timeOfDay(state().time) : 'morning',
    });
  }

  _updateWorldClock(dt) {
    const st = state();
    if (!st || !this.map) return;
    if (!this.map.indoor) safe(() => tickWeather(st, dt, this.map.biome));
    this._applyWeather(false);

    // Spells cast out of combat run on the world clock, not on rounds — a Mage
    // Armor put up at dawn is gone by dusk whether or not you ever drew a blade.
    // Checked twice a second rather than every frame; the clock moves in minutes.
    this._slotT += dt;
    if (this._slotT >= 0.5) { this._slotT = 0; safe(() => this._rebuildSlots()); }

    this._buffT = (this._buffT || 0) + dt;
    if (this._buffT >= 0.5) {
      this._buffT = 0;
      const lapsed = safe(() => expireFieldBuffs(Party.all(), st), []) || [];
      for (const line of lapsed) toast(line);
      const now = st.day * 1440 + st.time;
      if (this.spellLight && this.spellLight.until != null && now >= this.spellLight.until) {
        this.spellLight = null;
        toast('The light gutters out.');
      }
    }
  }

  // --- input ---------------------------------------------------------------

  _updateInput(dt) {
    if (Game.transitioning || this.popup) return;

    // The hotbar gets first refusal on the pointer, and swallows the click so
    // it never also lands on the world underneath.
    const m = safe(() => Input.mouse, null);
    if (m && m.over) {
      if (this.hotbar.contains(m.x, m.y)) {
        this.hotbar.hover(m.x, m.y);
        if (m.clicked) { m.clicked = false; this.hotbar.click(m.x, m.y); return; }
      }
    }

    // Menus first: they swallow the press so nothing below reacts to it too.
    if (Input.consume('menu')) { this._openMenu('pause'); return; }
    if (Input.consume('party')) { this._openMenu('party'); return; }
    if (Input.consume('journal')) { this._openMenu('journal'); return; }
    if (Input.consume('map')) { this._openMenu('map'); return; }
    if (Input.consume('inventory')) { this._openMenu('inventory'); return; }

    // 1..4 fire the quick slots. They were unbound in the overworld.
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (!safe(() => Input.consume('tab' + (i + 1)), false)) continue;
      const s = this._slots[i];
      if (s && s.fn) safe(() => s.fn());
      else { safe(() => Audio.sfx('error')); this.hotbar.say('Nothing in that slot yet.'); }
      return;
    }

    if (Input.consume('interact') || Input.consume('confirm')) {
      if (safe(() => Input.down('run'), false) && this._attackFacing()) return;
      if (this._interact()) return;
    }

    this.running = Input.down('run');
    this._updateWalk(dt);
  }

  /**
   * Grid walking. A direction newly pressed only turns you until it has been held
   * for TURN_DELAY; after that — or immediately, if you were already facing that
   * way — you walk. The held direction is re-read every frame, so a step chains
   * straight into the next one with no gap.
   */
  _updateWalk(dt) {
    const want = Input.dirName();

    if (!want) { this.heldDir = null; this.turnT = 0; return; }

    if (want !== this.heldDir) {
      this.heldDir = want;
      // Turning to face a new way costs a beat; continuing the way you look does not.
      this.turnT = want === this.player.dir ? 0 : TURN_DELAY;
      this.player.dir = want;
      const st = state();
      if (st) st.dir = want;
    } else if (this.turnT > 0) {
      this.turnT -= dt;
    }

    if (this.player.moving || this.turnT > 0) return;
    this._tryStep(want);
  }

  /** Commit one tile of movement, honouring locks, terrain and ledges. */
  _tryStep(dir) {
    const map = this.map;
    const v = DIR_VEC[dir];
    if (!v) return false;
    const tx = this.player.x + v.x, ty = this.player.y + v.y;

    // A locked door blocks before the collision check, so you get told why.
    if (this._blockedByLock(tx, ty)) return false;

    const fromX = this.player.x, fromY = this.player.y;
    const time = this._stepTime(tx, ty);
    const moved = this.player.step(dir, map, { time, run: this.running });

    if (!moved) {
      // Walking into a wall: a dull thud, throttled so holding the key isn't a drum.
      if (this._bumpSfxT <= 0) {
        this._bumpSfxT = 0.35;
        safe(() => Audio.sfx('footstep-stone', { vol: 0.5, pitch: -9 }));
      }
      return false;
    }

    // Two trail entries per step is what makes Party.trailFor() line the party up
    // nose-to-tail instead of leaving gaps: push the tile left, then the tile entered.
    Party.pushTrail(fromX, fromY, dir);
    Party.pushTrail(this.player.x, this.player.y, dir);
    this._advanceFollowers(this.player.stepTime || time);

    const [sfx, opts] = footstepFor(map, this.player.x, this.player.y);
    safe(() => Audio.sfx(sfx, opts));
    if (this.player.hopping) safe(() => Audio.sfx('shove', { vol: 0.4 }));
    return true;
  }

  /** Difficult terrain drags; running is quick; a ledge hop is handled by Entity. */
  _stepTime(tx, ty) {
    let time = this.running ? RUN_TIME : WALK_TIME;
    const f = this.map.flagAt(tx, ty);
    if (f & TF.SLOW) time *= SLOW_FACTOR;
    if (f & TF.WATER) time *= SLOW_FACTOR;   // wading, if anything ever lets you
    return time;
  }

  /** True if a locked door or gate stands in the way (and says so). */
  _blockedByLock(x, y) {
    const map = this.map;
    const t = map.triggerAt(x, y, { flags: flagsOf() });
    if (!t) return false;
    const d = t.data || {};
    const locked = d.locked || t.kind === 'locked-door' || d.kind === 'locked-door';
    if (!locked) return false;
    const keyId = d.keyId || null;
    if (keyId && Party.hasItem(keyId)) {
      const item = safe(() => resolveItem(keyId), null);
      d.locked = false;
      safe(() => Audio.sfx('door'));
      toast(`${(item && item.name) || 'The key'} turns in the lock.`);
      return false;
    }
    if (this._bumpSfxT <= 0) {
      this._bumpSfxT = 0.6;
      safe(() => Audio.sfx('error'));
      this._say(d.lockedText || (keyId ? 'It is locked. Something opens this.' : 'It is locked fast.'));
    }
    this.player.bump();
    return true;
  }

  // --- the moment a step lands ---------------------------------------------

  /**
   * Detect the frame the leader arrives on a new tile and run everything the world
   * owes it. Returns true if something took over (a scene was pushed, a fight
   * started) and input should sit this frame out.
   */
  _settleStep() {
    const moving = this.player.moving;
    const landed = this._wasMoving && !moving;
    this._wasMoving = moving;
    if (!landed) return !!(this.popup || Game.transitioning);

    const map = this.map;
    const x = this.player.x, y = this.player.y;
    const st = state();

    if (st) {
      st.x = x; st.y = y; st.dir = this.player.dir;
      st.stats.steps = (st.stats.steps || 0) + 1;
    }
    if (this.entities) this.entities.player = { x, y };

    safe(() => map.revealAround(x, y, map.indoor ? 5 : REVEAL_R));
    bus.emit(EV.STEP, { x, y, mapId: map.id, dir: this.player.dir });

    if ((st ? st.stats.steps : 0) % 24 === 0) this._syncDiscovered();

    // Hazard tiles hurt, quietly, once per step.
    if (map.flagAt(x, y) & TF.DAMAGE) this._hazardDamage(x, y);

    // 1. anything you can walk onto: warp pads, unlocked doors.
    if (this._runStepTriggers(x, y)) return true;

    // 2. the wilds.
    if (this._tickEncounter(x, y)) return true;

    return !!(this.popup || Game.transitioning);
  }

  _hazardDamage(x, y) {
    const dmg = Math.max(1, Math.round(Party.levelAvg() / 2));
    for (const m of Party.members) {
      if (!m || m.hp <= 0) continue;
      m.hp = Math.max(0, m.hp - dmg);
    }
    safe(() => FX.floater(x * TILE + TILE / 2, y * TILE, `-${dmg}`, FX.COLORS.fire || '#f07a2a'));
    safe(() => Audio.sfx('fire', { vol: 0.5 }));
    safe(() => FX.shake(0.15, 0.2));

    // Never let the lava soft-lock the campaign: drag the survivors home on one hp.
    if (Party.wiped()) {
      const st = state();
      const safeSpot = (st && st.lastSafe) || { mapId: (st && st.lastTown) || 'phandalin' };
      for (const m of Party.members) if (m) m.hp = Math.max(1, m.hp);
      toast('Dragged from the burn, barely breathing.');
      Game.transition('fade', () => _travel(safeSpot.mapId, safeSpot.x, safeSpot.y, 'down', {}));
    }
  }

  /** Warps, scripted spots and battle tiles fire by standing on them. */
  _runStepTriggers(x, y) {
    const list = this.entities;
    if (list) {
      const e = safe(() => list.touchableAt(x, y), null);
      if (e) {
        const payload = safe(() => e.onTouch({ x, y, dir: this.player.dir, player: this.player }), null);
        if (payload && this._dispatch(payload)) return true;
      }
    }

    const t = this.map.triggerAt(x, y, { flags: flagsOf() });
    if (!t || !isStepTrigger(t.kind)) return false;
    if (t.once && t.done) return false;

    const payload = this._payloadForTrigger(t, x, y);
    if (!payload) return false;
    if (t.once) t.done = true;
    return this._dispatch(payload);
  }

  // --- encounters ----------------------------------------------------------

  _resetEncounterCounter(rate) {
    const r = clamp(rate != null ? rate : (this.map ? this.map.encounterRate : 0.06), 0.004, 0.9);
    this.stepsToEncounter = Math.max(4, Math.round(rng.float(0.55, 1.8) / r));
  }

  /** Count down on encounter tiles; at zero, the tall grass rustles. */
  _tickEncounter(x, y) {
    if (this.encounterGrace > 0) return false;
    const map = this.map;
    const info = safe(() => map.encounterAt(x, y), null);
    if (!info || !info.rate) return false;

    this.stepsToEncounter--;
    if (this.stepsToEncounter > 0) return false;

    this._resetEncounterCounter(info.rate);
    return this._startWildEncounter(info, x, y);
  }

  _startWildEncounter(info, x, y) {
    const st = state();
    const seed = `${worldSeed()}:${this.map.id}:${x},${y}:${(st && st.stats.battles) || 0}`;
    const biome = info.biome || this.map.biome || 'plains';
    const level = info.level || Party.levelAvg();
    const depth = (st && st.depth && st.depth[this.map.id]) || 0;

    const roll = safe(() => rollEncounter({
      biome, level, size: Math.max(1, Party.members.length), seed, depth,
      difficulty: info.difficulty || undefined,
    }), null);
    if (!roll || !roll.monsters || !roll.monsters.length) return false;

    // The grass rustles on the tile first — the fight only arrives at the midpoint
    // of the transition, so this reads as the cause rather than the aftermath.
    const px = x * TILE + TILE / 2, py = y * TILE + TILE - 4;
    safe(() => FX.burst(px, py, this.map.indoor ? '#9a9aa4' : '#8fd07a', 12, {
      shape: 'leaf', speed: 34, life: 0.7, spread: Math.PI,
    }));
    safe(() => FX.ring(px, py, 10, '#cfe8a8', 0.35));
    safe(() => Audio.sfx('encounter'));

    // Being jumped from behind: an ambush ring instead of two ranks.
    const ambush = rng.chance(0.12);
    return this._pushBattle(roll.monsters, {
      seed, biome, depth, ambush, boss: !!roll.boss,
      difficulty: roll.difficulty, table: info.table,
    });
  }

  /** Visible monsters that walked into the party. */
  _checkRoamers() {
    if (!this.entities || Game.transitioning || this.popup) return;
    const m = safe(() => this.entities.pendingBattle(), null);
    if (!m) return;
    const payload = safe(() => m.takeBattle(), null);
    if (payload) this._dispatch(payload);
  }

  _pushBattle(enemies, opts = {}) {
    const combat = LATE.combat, cui = LATE.combatui;
    if (!combat || typeof combat.buildEncounter !== 'function' || !cui || !cui.BattleScene) {
      toast('They think better of it and slink away.');
      this.encounterGrace = ENCOUNTER_GRACE;
      return false;
    }

    const st = state();
    const arena = safe(() => buildBattleMap({
      biome: opts.biome || this.map.biome || 'plains',
      seed: opts.seed, indoor: this.map.indoor, ambush: !!opts.ambush,
      boss: !!opts.boss, depth: opts.depth || 0,
      sourceMap: this.map, sourceX: this.player.x, sourceY: this.player.y,
    }), null);

    const enc = safe(() => combat.buildEncounter({
      party: Party,
      enemies,
      map: arena,
      seed: opts.seed,
      biome: opts.biome || this.map.biome,
      ambush: !!opts.ambush,
      boss: !!opts.boss,
      depth: opts.depth || 0,
      difficulty: opts.difficulty,
      bag: Party.inventory,
      onLog: (entry) => { if (entry && entry.text) bus.emit(EV.LOG, { text: entry.text, kind: entry.kind }); },
    }), null);

    if (!enc) {
      toast('The fight never comes.');
      this.encounterGrace = ENCOUNTER_GRACE;
      return false;
    }

    if (st) st.stats.battles = (st.stats.battles || 0) + 1;
    for (const m of Party.all()) safe(() => fieldBuffsToRounds(m, st));
    const source = opts.source || null;
    const prevMusic = mapTrack(this.map, Game.state);

    Game.transition('battle', () => {
      // Dragons and the very largest things get their own theme.
      const huge = safe(() => (enc.units || []).some((u) => u.side !== 'party'
        && (u.type === 'dragon' || (u.cr || 0) >= 10)), false);
      safe(() => Audio.music(huge ? 'dragon' : opts.boss ? 'boss' : 'battle'));
      safe(() => Game.push(new cui.BattleScene(enc, {
        fromMapId: this.map.id,
        onEnd: (res) => this._onBattleEnd(res, source, prevMusic),
      })));
    });
    return true;
  }

  _onBattleEnd(res, source, prevMusic) {
    this.encounterGrace = ENCOUNTER_GRACE;
    this._resetEncounterCounter();
    safe(() => Audio.music(prevMusic || (this.map && this.map.music) || 'field'));

    const victory = !!(res && res.victory);
    if (source && source.defeat) {
      if (victory) safe(() => source.defeat());
      else safe(() => source.scatter && source.scatter(10));
    }
    if (victory) {
      safe(() => advanceTime(state(), 10));
      autosave();
    }
    Input.flush();
  }

  // --- followers -----------------------------------------------------------

  /**
   * Walk each follower onto the trail entry two behind the member in front. Called
   * the instant the leader commits, so the whole line tweens together.
   */
  _advanceFollowers(time) {
    for (let i = 0; i < this.followers.length; i++) {
      const f = this.followers[i];
      if (!f.char) continue;
      const target = Party.trailFor(i + 1);
      if (!target) continue;
      const dx = target.x - f.x, dy = target.y - f.y;
      if (!dx && !dy) { if (target.dir) f.dir = target.dir; continue; }
      const dist = Math.abs(dx) + Math.abs(dy);
      const dir = dirFrom(dx, dy);
      if (dist === 1 && !f.moving) {
        f.step(dir, this.map, { force: true, time });
      } else if (dist === 1) {
        this._moveTo(f, target.x, target.y, dir, time, 0);      // flat catch-up slide
      } else if (dist === 2) {
        this._moveTo(f, target.x, target.y, dir, time * 1.5, 8); // follow the ledge hop
      } else {
        f.setTile(target.x, target.y, target.dir || dir);
      }
    }
  }

  /**
   * A forced move of any length, ignoring collision — the party line retraces ground
   * the leader has already proved walkable. `arc` above zero vaults (ledge hops).
   */
  _moveTo(ent, tx, ty, dir, time, arc = 0) {
    const ox = ent.x, oy = ent.y;
    ent.fromX = ent.x; ent.fromY = ent.y;
    ent.x = tx | 0; ent.y = ty | 0;
    if (dir) ent.dir = dir;
    ent.moving = true;
    ent.moveT = 0;
    ent.stepTime = Math.max(0.05, time || WALK_TIME);
    ent.hopping = arc > 0 ? { h: arc } : null;
    if (ent.list) safe(() => ent.list.moved(ent, ox, oy));
  }

  /** Idle correction: if the line drifted (a warp, a roster change), close the gap. */
  _updateFollowers() {
    for (let i = 0; i < this.followers.length; i++) {
      const f = this.followers[i];
      if (!f.char || f.moving) continue;
      const target = Party.trailFor(i + 1);
      if (!target) continue;
      const dist = Math.abs(target.x - f.x) + Math.abs(target.y - f.y);
      if (dist > 2) f.setTile(target.x, target.y, target.dir || f.dir);
    }
  }

  // --- camera --------------------------------------------------------------

  _cameraTarget() {
    const map = this.map;
    const worldW = map.w * TILE, worldH = map.h * TILE;
    let tx = this.player.px - VIEW_W / 2;
    let ty = (this.player.py - TILE / 2) - VIEW_H / 2;   // aim at the chest, not the feet
    // A map narrower than the screen centres instead of clamping to a corner.
    tx = worldW <= VIEW_W ? (worldW - VIEW_W) / 2 : clamp(tx, 0, worldW - VIEW_W);
    ty = worldH <= VIEW_H ? (worldH - VIEW_H) / 2 : clamp(ty, 0, worldH - VIEW_H);
    return { x: tx, y: ty };
  }

  _updateCamera(dt) {
    const target = this._cameraTarget();
    const k = 1 - Math.exp(-CAM_LERP * Math.max(0, dt));
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    // Snap out the last sub-pixel so a stationary camera never shimmers.
    if (Math.abs(target.x - this.cam.x) < 0.12) this.cam.x = target.x;
    if (Math.abs(target.y - this.cam.y) < 0.12) this.cam.y = target.y;
  }

  _snapCamera() {
    const target = this._cameraTarget();
    this.cam.x = target.x; this.cam.y = target.y;
    this.camDraw.x = Math.round(target.x); this.camDraw.y = Math.round(target.y);
  }

  // --- weather -------------------------------------------------------------

  _applyWeather(force) {
    const st = state();
    const kind = (!this.map || this.map.indoor) ? 'none'
      : (this.map.weather || (st && st.weather) || 'clear');
    const mapped = { clear: 'none', rain: 'rain', snow: 'snow', fog: 'fog', ash: 'ash', leaves: 'leaves' }[kind] || 'none';
    if (!force && mapped === this._weatherKind) return;
    this._weatherKind = mapped;
    safe(() => FX.weather(mapped, mapped === 'fog' ? 0.4 : 0.6));
  }

  _syncDiscovered(mapArg) { syncDiscovered(mapArg || this.map); }

  // =========================================================================
  // 6.3 INTERACTION
  // =========================================================================

  /** Press A: look at the tile you are facing, then the one under your boots. */
  _interact() {
    if (!this.map || this.player.moving) return false;
    const front = this.player.frontTile();
    const ctx = { x: this.player.x, y: this.player.y, dir: this.player.dir, player: this.player };

    if (this.entities) {
      const e = safe(() => this.entities.interactableAt(front.x, front.y), null)
        || safe(() => this.entities.interactableAt(this.player.x, this.player.y), null);
      if (e) {
        const payload = safe(() => e.interact(ctx), null);
        if (payload) { this._dispatch(payload); return true; }
      }
    }

    for (const p of [front, { x: this.player.x, y: this.player.y }]) {
      const t = this.map.triggerAt(p.x, p.y, { flags: flagsOf() });
      if (!t || isStepTrigger(t.kind)) continue;
      if (t.facing && t.facing !== this.player.dir) continue;
      if (t.once && t.done) continue;
      const payload = this._payloadForTrigger(t, p.x, p.y);
      if (!payload) continue;
      if (t.once) t.done = true;
      this._dispatch(payload);
      return true;
    }
    return false;
  }

  // =========================================================================
  // 6.2a THE HOTBAR
  // =========================================================================
  //
  // Every verb the overworld has, on screen, with the key that does it. Before
  // this, talking was E, attacking was an unadvertised Shift+E, and casting
  // Mage Armor meant opening the pause menu and walking a cursor through the
  // spellbook — all real, none of it discoverable.

  /** What the two contextual buttons on the left say right now. */
  _hotbarModel() {
    const front = this.player.frontTile();
    const e = this.entities
      ? safe(() => this.entities.interactableAt(front.x, front.y), null) : null;
    const t = e ? null : (this.map ? this.map.triggerAt(front.x, front.y, { flags: flagsOf() }) : null);
    const usableTrigger = t && !isStepTrigger(t.kind) ? t : null;

    // --- the E verb, named after whatever is in front of you ---------------
    let action = null;
    if (e) {
      const verb = e.kind === 'npc' ? 'Talk'
        : e.kind === 'chest' ? (e.opened ? 'Empty' : 'Open')
          : e.kind === 'door' ? 'Enter'
            : e.kind === 'monster' ? 'Fight'
              : e.kind === 'sign' ? 'Read' : 'Look';
      action = {
        label: verb,
        enabled: !(e.kind === 'chest' && e.opened),
        why: 'Already emptied.',
        tip: `${verb}${e.name ? ' ' + e.name : ''}`,
        fn: () => this._interact(),
      };
    } else if (usableTrigger) {
      const verb = usableTrigger.kind === 'sign' ? 'Read'
        : usableTrigger.kind === 'shop' ? 'Shop'
          : usableTrigger.kind === 'inn' || usableTrigger.kind === 'rest' ? 'Rest'
            : usableTrigger.kind === 'chest' ? 'Open'
              : usableTrigger.kind === 'warp' || usableTrigger.kind === 'door' ? 'Enter' : 'Look';
      action = { label: verb, enabled: true, tip: verb, fn: () => this._interact() };
    } else {
      action = { label: 'Look', enabled: false, why: 'Nothing in front of you.' };
    }

    // --- the Shift+E verb --------------------------------------------------
    let attack = { label: 'Attack', enabled: false, why: 'No one in front of you.' };
    if (e && e.kind === 'npc') {
      const npc = e.npc || safe(() => getNPC(e.npcId), null) || {};
      const gate = safe(() => crimeCanAttack(npc, e), { ok: false, why: 'Not someone you can fight.' });
      attack = gate.ok
        ? {
          label: 'Attack', enabled: true,
          tip: `Draw steel on ${e.name || 'them'} — this has consequences.`,
          fn: () => this.attackNPC(e),
        }
        : { label: 'Attack', enabled: false, why: gate.why };
    } else if (e && e.kind === 'monster') {
      attack = { label: 'Attack', enabled: true, tip: `Attack ${e.name || 'it'}`, fn: () => this._interact() };
    }

    return {
      action,
      attack,
      slots: this._slots,
      menus: [
        { key: 'I', icon: 'bag', label: 'Pack', fn: () => this._openMenu('inventory') },
        { key: 'K', icon: 'wand', label: 'Spells', fn: () => this._openMenu('spells') },
        { key: 'M', icon: 'map', label: 'Map', fn: () => this._openMenu('map') },
        { key: 'ESC', icon: 'book', label: 'Menu', fn: () => this._openMenu('pause') },
      ],
    };
  }

  /**
   * Fill the four quick slots with the most useful things the party can do
   * standing here: healing first, then wards, then the world verbs, then a
   * healing potion if one is in the pack. Rebuilt twice a second rather than
   * every frame — fieldCastable walks the spell list for every caster.
   */
  _rebuildSlots() {
    const out = [];
    const st = state();

    // Heals first, then wards by how long they last, then the world verbs. A
    // one-minute cantrip like Blade Ward is a combat spell wearing a buff's
    // clothes; an eight-hour Mage Armor is the thing you actually want a key for.
    const rank = { heal: 0, buff: 1, world: 2 };
    const found = [];
    for (const m of Party.members) {
      if (!m || !m.spells) continue;
      const ids = new Set([
        ...arrOf(m.spells.prepared), ...arrOf(m.spells.cantrips), ...arrOf(m.spells.known),
      ]);
      for (const id of ids) {
        const gate = safe(() => fieldCastable(m, id), null);
        if (!gate || !gate.ok) continue;
        const sp = safe(() => getSpell(id), null) || {};
        const mins = safe(() => minutesFor(sp.duration), null);
        found.push({
          m, id, role: gate.role,
          rank: rank[gate.role] != null ? rank[gate.role] : 3,
          lasts: mins == null ? Infinity : mins,
        });
      }
    }
    found.sort((a, b) => a.rank - b.rank
      || b.lasts - a.lasts
      || String(a.id).localeCompare(String(b.id)));

    const seen = new Set();
    for (const f of found) {
      if (out.length >= SLOT_COUNT - 1) break;      // keep one for a potion
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const sp = safe(() => getSpell(f.id), null) || { name: f.id };
      out.push({
        kind: 'spell', id: f.id, caster: f.m, name: sp.name || f.id, ready: true, role: f.role,
        tip: `${sp.name} — ${f.m.name}`,
        fn: () => this._castFromHotbar(f.m, f.id, out.length),
      });
    }

    // A healing potion, because it is the thing you reach for most.
    const bag = Array.isArray(Party.inventory) ? Party.inventory : [];
    const potion = bag.find((row) => {
      const it = safe(() => resolveItem(row.id), null);
      return it && it.use && it.use.kind === 'heal';
    });
    if (potion && out.length < SLOT_COUNT) {
      const it = safe(() => resolveItem(potion.id), null) || {};
      out.push({
        kind: 'item', id: potion.id, name: it.name || potion.id, ready: true,
        count: potion.qty || 1, tip: `${it.name || potion.id} — heals the most hurt of you`,
        fn: () => this._drinkFromHotbar(potion.id, out.length),
      });
    }

    void st;
    this._slots = out;
  }

  /** Cast a quick-slot spell, choosing the sensible target for you. */
  _castFromHotbar(caster, spellId, slotIndex) {
    const sp = safe(() => getSpell(spellId), null) || {};
    // A heal goes to whoever needs it most; a self buff to the caster; anything
    // else that touches an ally goes to the party leader.
    let target = caster;
    const aim = safe(() => fieldTargeting(sp), 'self');
    if (aim === 'ally') {
      const hurt = Party.members
        .filter((m) => m && m.hp > 0)
        .sort((a, b) => (a.hp / Math.max(1, a.maxHp)) - (b.hp / Math.max(1, b.maxHp)))[0];
      target = sp.heal ? (hurt || caster) : (Party.members[0] || caster);
    }
    const res = safe(() => fieldCast(caster, spellId, {
      target, party: Party, state: state(), world: this.spellHooks(),
    }), null);
    if (!res || !res.ok) {
      safe(() => Audio.sfx('error'));
      this.hotbar.say((res && res.text) || 'It will not come.');
      return;
    }
    if (res.minutes) safe(() => advanceTime(state(), res.minutes));
    safe(() => bus.emit(EV.SPELL_CAST, { ch: caster, spellId, field: true }));
    safe(() => Audio.sfx('spell'));
    safe(() => FX.ring(this.player.px, this.player.py - 8, 12, '#a9c6ff', 0.4));
    this.hotbar.pulse(slotIndex);
    this.hotbar.say(res.lines[0]);
    this._rebuildSlots();
  }

  /** Drink a quick-slot potion, giving it to whoever is worst off. */
  _drinkFromHotbar(itemId, slotIndex) {
    const hurt = Party.members
      .filter((m) => m && !isDeadMember(m))
      .sort((a, b) => (a.hp / Math.max(1, a.maxHp)) - (b.hp / Math.max(1, b.maxHp)))[0];
    if (!hurt) { this.hotbar.say('No one to drink it.'); return; }
    if (hurt.hp >= hurt.maxHp) {
      safe(() => Audio.sfx('error'));
      this.hotbar.say('Nobody is hurt.');
      return;
    }
    const it = safe(() => resolveItem(itemId), null) || {};
    const dice = (it.use && it.use.dice) || '2d4+2';
    const rolled = safe(() => rollExpr(dice).total, 5) || 5;
    const got = safe(() => healMember(hurt, rolled), 0) || 0;
    if (!got) { this.hotbar.say('Nothing happens.'); return; }
    safe(() => Party.removeItem(itemId, 1));
    safe(() => Audio.sfx('heal'));
    safe(() => FX.floater(this.player.px, this.player.py - 18, `+${got}`, '#7ad07a', { size: 1.2 }));
    this.hotbar.pulse(slotIndex);
    this.hotbar.say(`${hurt.name} drinks the ${(it.name || 'potion').toLowerCase()} — +${got} hp.`);
    this._rebuildSlots();
  }

  // =========================================================================
  // 6.3a DRAWING STEEL ON PEOPLE WHO ARE NOT MONSTERS
  // =========================================================================
  //
  // Shift+E on someone you are facing, or the "Attack" line at the bottom of any
  // conversation. Both land here. The fight is real, the loot is real, and so is
  // the bill: rules/crime.js keeps the ledger and the watch collects.

  /** Shift + interact: swing at whoever you are facing. */
  _attackFacing() {
    if (!this.map || this.player.moving || !this.entities) return false;
    const front = this.player.frontTile();
    const e = safe(() => this.entities.interactableAt(front.x, front.y), null);
    if (!e || e.kind !== 'npc') return false;
    return this.attackNPC(e);
  }

  /**
   * Start a fight with a townsfolk. Returns true if the fight (or the refusal)
   * consumed the frame.
   */
  attackNPC(entity, opts = {}) {
    if (!entity) return false;
    const npc = entity.npc || safe(() => getNPC(entity.npcId), null) || {};
    const allowed = crimeCanAttack(npc, entity);
    if (!allowed.ok) { safe(() => Audio.sfx('error')); this._say(allowed.why); return true; }

    const st = state();
    const witnesses = witnessesNear(this.entities, entity.x, entity.y, 7, entity);
    const guards = guardsAmong(witnesses);
    const joining = guards.slice(0, 3);

    // Build the fight BEFORE booking the crime. Everything below this line is
    // irreversible — a bounty, a lost reputation, a street full of people who
    // saw — and none of it should happen for a swing the game then refuses to
    // stage because a module has not finished loading.
    const level = Math.max(1, Party.levelAvg());
    const enemies = [];
    const push = (id, n) => {
      for (let i = 0; i < n; i++) {
        const mob = safe(() => makeMonster(id, { level }), null);
        if (mob) enemies.push(mob);
      }
    };
    push(statBlockFor(npc, entity), 1);
    if (enemies.length && npc.name) {
      // The person you actually swung at keeps their own name over the health bar.
      enemies[0].name = npc.name;
    }
    for (const g of joining) {
      const gnpc = g.npc || safe(() => getNPC(g.npcId), null) || {};
      push(statBlockFor(gnpc, g), 1);
    }
    if (!enemies.length) { this._say('Nothing comes of it.'); return true; }

    // Everyone who can see it is now in this: the watch wades in, the potters run.
    for (const w of witnesses) {
      w.hostile = true;
      if (joining.indexOf(w) < 0) safe(() => w.flee && w.flee(this.player.x, this.player.y, 14));
    }
    if (st) reportAssault(st, { map: this.map, npc, entity, witnesses: witnesses.length });

    if (witnesses.length) {
      toast(guards.length ? 'The watch has seen you!' : 'Someone saw that.');
    }
    safe(() => Audio.sfx('encounter'));

    const victims = [entity].concat(joining);
    return this._pushBattle(enemies, {
      seed: `${worldSeed()}:crime:${this.map.id}:${entity.npcId}:${(st && st.stats.battles) || 0}`,
      biome: this.map.biome,
      crime: true,
      source: {
        defeat: () => {
          // Won: the bodies stay dead and the bill comes due.
          let found = false;
          for (const v of victims) {
            if (st && v.npcId) {
              const r = reportDeath(st, v.npcId, { map: this.map, witnessed: witnesses.length > 0 });
              found = found || !!(r && r.found);
              this._failQuestsOf(v.npcId);
            }
            safe(() => v.remove());
          }
          const owed = st ? bountyIn(st, this.map) : 0;
          if (found && owed > 0) toast(`Bounty on your head: ${owed} gp.`);
          else if (!found) toast('No one saw. No one is looking.');
        },
        scatter: () => { for (const v of victims) safe(() => v.scatter && v.scatter(10)); },
      },
      ...opts,
    });
  }

  // =========================================================================
  // 6.3b WHAT A SPELL CAN REACH OUT AND TOUCH
  // =========================================================================
  //
  // rules/fieldcast.js decides what a spell DOES; these are the few verbs it
  // cannot do on its own because they need the map. ui/menus.js asks the
  // overworld for this bundle when the spellbook casts, and fieldcast falls
  // back to prose for any hook that is missing (cast from a rest, say).

  spellHooks() {
    return {
      light: (radius, spellId, minutes) => this._spellLight(radius, spellId, minutes),
      unlock: () => this._spellUnlock(),
      detect: (what) => this._spellDetect(what),
      reach: (limitLb) => this._spellReach(limitLb),
      identify: () => this._spellIdentify(),
    };
  }

  /** Light / Dancing Lights / Faerie Fire: a pool that follows the party. */
  _spellLight(radius, spellId, minutes) {
    const st = state();
    const feet = Math.max(5, Number(radius) || 20);
    this.spellLight = {
      radius: feet / 5 * TILE,               // five feet to the tile
      spellId: spellId || 'light',
      until: st && minutes != null ? (st.day * 1440 + st.time) + minutes : null,
    };
    safe(() => FX.ring(this.player.px, this.player.py - 8, 14, '#ffe9a6', 0.5));
    return { ok: true };
  }

  /** Knock: the nearest locked thing within sixty feet gives up. */
  _spellUnlock() {
    if (!this.entities) return { ok: false, text: 'Nothing within reach is locked.' };
    const range = 12;                        // sixty feet, in tiles
    let best = null, bestD = 99;
    for (const e of this.entities.list || []) {
      if (!e || e.removed || !e.locked || e.opened) continue;
      const d = Math.max(Math.abs(e.x - this.player.x), Math.abs(e.y - this.player.y));
      if (d <= range && d < bestD) { best = e; bestD = d; }
    }
    if (!best) return { ok: false, text: 'Nothing within reach is locked.' };
    best.locked = false;
    best.keyId = null;
    safe(() => Audio.sfx('chest'));
    safe(() => FX.ring(best.x * TILE + TILE / 2, best.y * TILE + TILE / 2, 18, '#ffd24a', 0.5));
    // Loud enough to be heard three hundred feet away, as advertised.
    for (const e of this.entities.list || []) {
      if (e && e.kind === 'npc' && Math.max(Math.abs(e.x - best.x), Math.abs(e.y - best.y)) <= 8) {
        safe(() => e.faceToward(best.x, best.y));
      }
    }
    return { ok: true, text: `${best.name || 'A lock'} springs open with a loud metallic knock.` };
  }

  /** Detect Magic: how many enchanted things are within thirty feet. */
  _spellDetect() {
    if (!this.entities) return { count: 0 };
    const range = 6;
    let count = 0;
    for (const e of this.entities.list || []) {
      if (!e || e.removed) continue;
      const d = Math.max(Math.abs(e.x - this.player.x), Math.abs(e.y - this.player.y));
      if (d > range) continue;
      if (e.kind === 'chest' && !e.opened) { count++; e.detected = true; }
    }
    if (count) safe(() => FX.ring(this.player.px, this.player.py - 8, 40, '#b07af0', 0.7));
    return { count };
  }

  /** Mage Hand: fetch the contents of an unlocked chest from thirty feet. */
  _spellReach() {
    if (!this.entities) return { ok: false };
    const range = 6;
    let best = null, bestD = 99;
    for (const e of this.entities.list || []) {
      if (!e || e.removed || e.kind !== 'chest' || e.opened || e.locked) continue;
      const d = Math.max(Math.abs(e.x - this.player.x), Math.abs(e.y - this.player.y));
      if (d <= range && d < bestD) { best = e; bestD = d; }
    }
    if (!best) return { ok: false };
    const payload = safe(() => best.interact({ player: this.player }), null);
    if (payload) this._dispatch(payload);
    return { ok: true, text: 'The spectral hand lifts the lid and brings back what it finds.' };
  }

  /** Identify: name the first unidentified thing in the pack. */
  _spellIdentify() {
    const bag = Array.isArray(Party.inventory) ? Party.inventory : [];
    const row = bag.find((it) => it && it.unidentified);
    if (!row) return { ok: false, text: 'Nothing in the pack is a mystery.' };
    row.unidentified = false;
    const item = safe(() => resolveItem(row.id), null);
    return { ok: true, text: `${(item && item.name) || 'It'} gives up its name.` };
  }

  /**
   * A dead quest-giver cannot be turned in to. Whatever they set you is over —
   * this is the cost the player is really trading away when they draw steel.
   */
  _failQuestsOf(npcId) {
    const st = state();
    if (!st || !npcId) return;
    const doomed = arrOf(st.quests && st.quests.active).slice().filter((q) => {
      const def = q && (q.def || q);
      return def && (def.giver === npcId || def.turnIn === npcId);
    });
    for (const q of doomed) {
      if (safe(() => failQuest(st, q.id), false)) {
        toast(`Failed: ${q.title || q.id}`, { kind: 'quest' });
      }
    }
  }

  /**
   * The watch catching up with you. Called on map entry, once per killing you
   * are owed, and never in the same breath as the crime itself.
   */
  _checkWatch() {
    const st = state();
    if (!st || !this.map || Game.transitioning || this.popup) return false;
    if (this.encounterGrace > 0) return false;
    if (watchOwed(st, this.map) <= 0) return false;

    const level = Math.max(1, Party.levelAvg());
    const enemies = [];
    for (const g of watchPatrol(st, this.map, level)) {
      for (let i = 0; i < (g.count || 1); i++) {
        const mob = safe(() => makeMonster(g.id, { level }), null);
        if (mob) enemies.push(mob);
      }
    }
    if (!enemies.length) return false;

    toast('"That one! Take them!"');
    safe(() => Audio.sfx('encounter'));
    const staged = this._pushBattle(enemies, {
      seed: `${worldSeed()}:watch:${this.map.id}:${(st && st.stats.battles) || 0}`,
      biome: this.map.biome, crime: true,
    });
    // Spend the debt only once the patrol is really on its way. Clearing it
    // first meant a push that failed — or a battle module still loading — wrote
    // the killing off permanently and the watch never came at all.
    if (staged) clearWatch(st, this.map, 1);
    return staged;
  }

  /** Translate a map trigger into the same payload shape entities speak. */
  _payloadForTrigger(t, x, y) {
    const d = t.data || {};
    switch (t.kind) {
      case 'sign':
        return { kind: 'sign', data: { title: d.title || null, text: d.text || d.lines || '…', pages: d.pages || null } };
      case 'shop':
        return { kind: 'shop', data: { shopId: d.shopId || d.shop || d.id, npcId: d.npcId || null } };
      case 'inn':
      case 'rest':
        return { kind: 'inn', data: { cost: d.cost != null ? d.cost : (t.kind === 'inn' ? 5 : 0), name: d.name || null, hours: d.hours } };
      case 'chest':
        return { kind: 'chest', data: { ...d, x, y, trigger: t } };
      case 'warp':
      case 'door':
        return { kind: 'warp', data: { ...d, map: d.map || d.mapId || null, transition: d.transition || 'fade' } };
      case 'battle':
        return { kind: 'battle', data: { ...d } };
      case 'quest':
      case 'script': {
        // Only a real dialogue id opens a tree; anything else speaks a line, so a
        // mapgen script marker never puts a stranger's small talk in a crypt.
        const did = d.dialogueId || d.dialogue || d.tree || null;
        const text = d.text || (did ? null : SCRIPT_LINES[d.kind] || SCRIPT_LINES.default);
        return { kind: 'dialogue', data: { dialogueId: did, npcId: d.npcId || null, text, script: d } };
      }
      default:
        return null;
    }
  }

  /** Act on a payload. Returns true if it took over the frame. */
  _dispatch(payload) {
    if (!payload || !payload.kind) return false;
    const d = payload.data || {};
    switch (payload.kind) {
      case 'dialogue': return this._openDialogue(d);
      case 'shop': return this._openShop(d);
      case 'sign': return this._openSign(d);
      case 'chest': return this._openChest(d);
      case 'inn':
      case 'rest': return this._openInn(d);
      case 'warp': return this._doWarp(d);
      case 'battle': return this._doTriggerBattle(d);
      default: return false;
    }
  }

  // --- dispatch targets -----------------------------------------------------

  _openDialogue(d) {
    const mod = LATE.dialogue;
    if (!mod || !mod.DialogueScene) {
      this._say(d.text || (d.greeting) || 'They have nothing to say just now.');
      return true;
    }
    const npc = d.npc || (d.npcId ? safe(() => getNPC(d.npcId), null) : null);
    if (d.entity && d.entity.pauseAndFace) safe(() => d.entity.pauseAndFace(this.player.x, this.player.y, 3));
    if (d.entity) d.entity.busy = true;

    // A scripted trigger with only literal text does not need a dialogue tree.
    if (!d.dialogueId && d.text) { this._say(d.text); return true; }

    safe(() => Game.push(new mod.DialogueScene(d.dialogueId || d.npcId, npc, {
      shopId: d.shopId || null,
      speaker: d.name || (npc && npc.name) || null,
      entity: d.entity || null,          // so "Draw your weapon" knows who to swing at
      onClose: () => { if (d.entity) d.entity.busy = false; },
    })));
    if (d.npcId) safe(() => progressQuests(state(), 'talk', d.npcId, 1));
    return true;
  }

  _openShop(d) {
    const mod = LATE.shop;
    const shopId = d.shopId || d.shop || d.id;
    if (!mod || !mod.ShopScene || !shopId) { this._say('The counter is shut.'); return true; }
    safe(() => Audio.sfx('open'));
    safe(() => Game.push(new mod.ShopScene(shopId, {
      npc: d.npc || (d.npcId ? safe(() => getNPC(d.npcId), null) : null),
    })));
    return true;
  }

  _openSign(d) {
    const pages = d.pages && d.pages.length ? d.pages : [d.text || '…'];
    const mod = LATE.dialogue;
    if (mod && typeof mod.say === 'function') {
      safe(() => mod.say(pages, { speaker: d.title || null }));
      return true;
    }
    this._say(Array.isArray(pages) ? pages.join(' ') : String(pages), d.title);
    return true;
  }

  /** Chests: open, roll the loot into the pack, and pop a little tally window. */
  _openChest(d) {
    const st = state();
    const chest = d.chest || d.entity || null;

    // ChestEntity.open() already lifted the lid and handed us the contents.
    if (d.opened) return this._grantChest(d);

    // A locked chest wants a key.
    if (d.locked && !(chest && chest.opened)) {
      const keyId = d.keyId || null;
      if (!keyId || !Party.hasItem(keyId)) {
        safe(() => Audio.sfx('error'));
        this._say('The lid will not lift. It is locked.');
        return true;
      }
      const item = safe(() => resolveItem(keyId), null);
      toast(`${(item && item.name) || 'A key'} fits the lock.`);
      if (chest) { chest.locked = false; }
      const opened = chest ? safe(() => chest.open(), null) : null;
      return this._grantChest(opened ? opened.data : d);
    }

    if (chest && !chest.opened) {
      const res = safe(() => chest.open(), null);
      return this._grantChest(res ? res.data : d);
    }
    if (chest && chest.opened && !d.opened) {
      this._say('Empty. Someone got here first — probably you.');
      return true;
    }

    // A bare trigger chest with no entity behind it.
    if (st && isChestLooted(st, this.map.id, d.x, d.y)) {
      this._say('The chest is empty.');
      return true;
    }
    if (st && d.x != null) safe(() => markChestLooted(st, this.map.id, d.x, d.y));
    safe(() => Audio.sfx('chest'));
    return this._grantChest(d);
  }

  _grantChest(d) {
    const lines = [];
    let gold = d.gold || 0;
    const items = [];

    for (const entry of (d.loot || d.items || [])) {
      const id = Array.isArray(entry) ? entry[0] : (entry && entry.id) || entry;
      const qty = Array.isArray(entry) ? (entry[1] || 1) : ((entry && entry.qty) || 1);
      if (id) items.push([id, qty]);
    }

    // A CR-banded table (mapgen's chestPlan) rolls its own contents.
    if (!items.length && (d.lootTable || d.rolls || d.cr != null)) {
      const rolled = this._rollLootTable(d);
      for (const it of rolled.items) items.push(it);
      if (!gold) gold = rolled.gold;
    }

    if (gold > 0) {
      Party.addGold(gold);
      const st = state();
      if (st) st.stats.goldEarned = (st.stats.goldEarned || 0) + gold;
      lines.push(`${gold} gp`);
      safe(() => Audio.sfx('coin'));
    }
    for (const [id, qty] of items) {
      const item = safe(() => resolveItem(id), null);
      if (!item) continue;
      Party.addItem(id, qty);
      lines.push(qty > 1 ? `${item.name} x${qty}` : item.name);
    }

    if (!lines.length) {
      this._say('Nothing but dust and a dead spider.');
      return true;
    }
    safe(() => Audio.sfx('item'));
    safe(() => FX.burst(this.player.px, this.player.py - 8, '#e3b34a', 14, { shape: 'spark', speed: 60 }));
    this.popup = { title: 'You found', lines, t: 0, life: 4.5 };
    return true;
  }

  /** Roll a chest's contents off data/items_magic.js LOOT_TABLES. */
  _rollLootTable(d) {
    const out = { gold: 0, items: [] };
    const mod = LATE.loot;
    const r = makeRNG(`chest:${this.map ? this.map.id : 'map'}:${d.x || 0},${d.y || 0}:${d.seed || 0}`);
    out.gold = d.gold || Math.max(3, Math.round(r.int(6, 24) * (1 + (d.depth || 0) * 0.5)));
    if (!mod || typeof mod.lootTableFor !== 'function') return out;

    const table = (d.lootTable && mod.LOOT_TABLES && mod.LOOT_TABLES[d.lootTable])
      || safe(() => mod.lootTableFor(d.cr != null ? d.cr : Party.levelAvg() * 0.5), null);
    if (!table || !Array.isArray(table.items)) return out;

    const rolls = Math.max(1, Math.min(5, d.rolls || 1));
    const seen = new Map();
    for (let i = 0; i < rolls; i++) {
      const pick = r.pickWeighted(table.items, (e) => Math.max(0.01, e[1] > 1 ? e[1] / 100 : e[1]));
      if (!pick) continue;
      const id = pick[0];
      if (!safe(() => resolveItem(id), null)) continue;
      seen.set(id, (seen.get(id) || 0) + 1);
    }
    for (const [id, qty] of seen) out.items.push([id, qty]);
    return out;
  }

  /**
   * The inn: a bed, a price, and eight hours of the Calendar of Harptos.
   * The prompt is a real dialogue window whose "Rest" branch runs dialogue.js's own
   * `do:{ rest }` action, so the purse, the long rest and the clock all move through
   * the same code the written NPC scripts use.
   */
  _openInn(d) {
    const cost = Math.max(0, d.cost != null ? d.cost : 5);
    const hours = d.hours != null ? d.hours : 8;
    const mod = LATE.dialogue;
    const name = d.name || 'The Innkeeper';

    // Whatever route the rest takes, the campaign is worth writing down afterwards.
    if (this._restOff) { safe(() => this._restOff()); this._restOff = null; }
    const armedAt = this.t;
    this._restOff = bus.once(EV.REST, () => {
      this._restOff = null;
      // Only claim the morning if this really was the room we just paid for.
      if (this.t - armedAt < 30) {
        const st = state();
        if (st && (st.time < 360 || st.time > 660)) st.time = 420;
        this.banner = { text: 'Morning', sub: null, t: 0 };
        safe(() => Audio.music(mapTrack(this.map, Game.state)));
      }
      autosave();
    });

    if (!mod || typeof mod.say !== 'function') {
      // No dialogue module: rest anyway rather than leaving the player stuck.
      if (cost > 0 && !Party.spendGold(cost)) {
        safe(() => Audio.sfx('error'));
        this._say(`You cannot cover ${cost} gp.`);
        return true;
      }
      Game.transition('fade', () => {
        safe(() => Party.longRest());
        safe(() => Party.healAll());
        safe(() => advanceTime(state(), hours * 60));
        safe(() => Audio.sfx('heal'));
        toast('Rested. The party is whole again.');
      }, { dur: 1.0 });
      return true;
    }

    safe(() => mod.say([cost > 0
      ? `A bed and a hot meal, ${cost} gp the night.`
      : 'Rest here a while, and let the road wait.'], {
      speaker: name,
      choices: [
        { text: cost > 0 ? `Take a room (${cost} gp)` : 'Rest', do: { rest: { cost, hours } } },
        { text: 'Not tonight', cancel: true, leave: true },
      ],
    }));
    return true;
  }

  _doWarp(d) {
    if (!d) return false;
    const st = state();
    const kind = d.transition || 'fade';
    const target = d.map || d.mapId || null;

    // A dungeon stair carries a depth instead of a map id.
    const opts = {};
    if (d.depth != null) {
      opts.depth = Math.max(0, d.depth | 0);
      opts.theme = d.theme || null;
      opts.biome = d.biome || (this.map ? this.map.biome : null);
    }

    let id = target;
    if (!id && opts.depth != null) {
      if (d.exit) {
        id = (st && st.lastTown) || 'phandalin';
        delete opts.depth;
      } else {
        const base = String((this.map && this.map.id) || 'undermountain').replace(/@\d+$/, '').replace(/-\d+$/, '');
        id = base;
      }
    }
    if (!id) { this._say('The way is barred.'); return false; }

    safe(() => Audio.sfx(d.sfx || 'door'));
    Game.transition(kind, () => {
      _travel(id, d.x, d.y, d.dir || this.player.dir, opts);
    });
    return true;
  }

  _doTriggerBattle(d) {
    const enemies = [];
    for (const e of (d.monsters || d.enemies || [])) {
      if (!e) continue;
      if (typeof e === 'string') enemies.push({ id: e, count: 1 });
      else enemies.push({ id: e.id || e.monsterId, count: e.count || 1, level: e.level, elite: e.elite, boss: e.boss });
    }
    if (!enemies.length && d.monsterId) {
      enemies.push({
        id: d.monsterId,
        count: Math.max(1, d.count || rng.int(1, 3)),
        level: d.level || null, elite: !!d.elite, boss: !!d.boss,
      });
    }

    const seed = d.seed != null ? String(d.seed)
      : `${worldSeed()}:${this.map.id}:${this.player.x},${this.player.y}:trig`;

    if (!enemies.length) {
      const roll = safe(() => rollEncounter({
        biome: d.biome || this.map.biome, level: d.level || Party.levelAvg(),
        size: Math.max(1, Party.members.length), seed, depth: d.depth || 0,
        difficulty: d.boss ? 'deadly' : undefined,
      }), null);
      if (roll && roll.monsters) enemies.push(...roll.monsters);
    }
    if (!enemies.length) return false;

    return this._pushBattle(enemies, {
      seed, biome: d.biome || this.map.biome, depth: d.depth || 0,
      ambush: !!d.ambush, boss: !!d.boss, source: d.entity || null,
    });
  }

  // --- menus ---------------------------------------------------------------

  _openMenu(which) {
    const mod = LATE.menus;
    if (!mod) { safe(() => Audio.sfx('error')); return; }
    const Scene = {
      pause: mod.PauseMenuScene, party: mod.PartyScene, journal: mod.JournalScene,
      map: mod.MapScene, inventory: mod.InventoryScene, spells: mod.SpellbookScene,
    }[which];
    if (!Scene) { safe(() => Audio.sfx('error')); return; }
    safe(() => Audio.sfx('open'));
    this._syncDiscovered();
    safe(() => Game.push(new Scene()));
  }

  /** A one-line message in the standard window; falls back to a toast. */
  _say(text, title) {
    const mod = LATE.dialogue;
    if (mod && typeof mod.say === 'function') { safe(() => mod.say([text], { speaker: title || null })); return; }
    toast(String(text));
  }

  // =========================================================================
  // 6.4 DRAW
  // =========================================================================

  draw(ctx) {
    ctx.fillStyle = '#07060a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (!this.map) { this._drawLoading(ctx); return; }

    // Round the camera (shake included) once, here, so nothing shimmers.
    const sh = safe(() => FX.shakeOffset(), { x: 0, y: 0 }) || { x: 0, y: 0 };
    this.camDraw.x = Math.round(this.cam.x + sh.x);
    this.camDraw.y = Math.round(this.cam.y + sh.y);
    const cam = this.camDraw;

    this._drawLayer(ctx, 'ground', cam);
    // The lip of every blocked tile, drawn between the floor and the scenery so
    // the walkable ground reads as a carved-out shape rather than a flat texture.
    this._drawEdges(ctx, cam);
    this._drawLayer(ctx, 'deco', cam);
    // Ways out of this place, under the party so you can stand on one.
    this._drawExits(ctx, cam);

    // Entities and the party in one feet-Y sort, so villagers pass in front of and
    // behind you correctly.
    if (this.entities) {
      safe(() => this.entities.draw(ctx, cam, { viewW: VIEW_W, viewH: VIEW_H, pad: 48 }));
    }
    safe(() => FX.draw(ctx, cam.x, cam.y));

    // Canopies, roof edges and archways you walk behind.
    this._drawLayer(ctx, 'over', cam);

    // Grade first, then the hint: the "you can talk to this" chevron has to stay
    // readable at midnight, and the HUD above it likewise.
    this._drawGrade(ctx, cam);
    this._drawInteractHint(ctx, cam);

    this.hud.setPlayerScreen(
      Math.round(this.player.px - cam.x),
      Math.round(this.player.py - cam.y),
      this.player.moving,
    );
  }

  /**
   * The overworld's own interface. engine.js calls this AFTER FX.drawAmbient, so
   * rain, snow and the night grade fall on the world and not on the HUD, the
   * location banner or the loot tally.
   */
  drawUI(ctx) {
    if (!this.map) return;
    this._drawExitLabel(ctx);
    this.hud.draw(ctx);
    this.hotbar.update(Game.dt || 0);
    safe(() => this.hotbar.draw(ctx, this._hotbarModel()));
    this._drawBanner(ctx);
    this._drawPopup(ctx);
  }

  /** Only tiles in view plus a one-tile margin, so big maps cost nothing extra. */
  _drawLayer(ctx, layer, cam) {
    const map = this.map;
    const plane = layer === 'ground' ? map.ground : layer === 'deco' ? map.deco : map.over;
    if (!plane) return;
    const x0 = Math.floor(cam.x / TILE) - 1;
    const y0 = Math.floor(cam.y / TILE) - 1;
    const x1 = x0 + Math.ceil(VIEW_W / TILE) + 2;
    const y1 = y0 + Math.ceil(VIEW_H / TILE) + 2;
    const t = this.t;

    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= map.h) continue;
      const row = y * map.w;
      const py = y * TILE - cam.y;
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= map.w) continue;
        const id = plane[row + x];
        if (!id) continue;
        drawTile(ctx, id, x * TILE - cam.x, py, x, y, t);
      }
    }
  }

  // =========================================================================
  // 6.4a WHERE YOU MAY WALK, AND WHERE YOU MAY LEAVE
  // =========================================================================
  //
  // A tile-painted town is a beautiful thing and a confusing one: grass, path and
  // the two-pixel strip of grass that is actually a garden wall all read the same
  // from above. These two passes fix that without repainting a single tileset.
  //
  //   _drawEdges — every boundary between somewhere you can stand and somewhere
  //     you cannot gets a contact shadow on the walkable side and a hairline on
  //     the blocked side. The effect is a soft trench around the play area, so
  //     the path you are meant to follow is legible at a glance.
  //   _drawExits — every warp out of this map gets an animated chevron pointing
  //     the way out, plus the name of the place it leads to once you are close.
  //
  // Both are switchable in Options (Path Edges / Exit Markers) for anyone who
  // prefers the plain tileset.

  /**
   * Bitmask per tile: which SIDES of this walkable tile touch something blocked.
   * 1 north, 2 east, 4 south, 8 west. Built once per map — a 60x50 town is 3000
   * cheap lookups, and it never changes while you are standing in it.
   */
  _edgeMask() {
    const map = this.map;
    if (map._edgeMask && map._edgeMask.length === map.w * map.h) return map._edgeMask;
    const w = map.w, h = map.h;
    const mask = new Uint8Array(w * h);
    const blocked = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return true;      // off-map counts
      const f = map.flagAt(x, y);
      return (f & TF.SOLID) !== 0 || (f & TF.WATER) !== 0;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (blocked(x, y)) continue;                            // only rim the floor
        let b = 0;
        if (blocked(x, y - 1)) b |= 1;
        if (blocked(x + 1, y)) b |= 2;
        if (blocked(x, y + 1)) b |= 4;
        if (blocked(x - 1, y)) b |= 8;
        mask[y * w + x] = b;
      }
    }
    map._edgeMask = mask;
    return mask;
  }

  _drawEdges(ctx, cam) {
    if (Save && Save.settings && Save.settings.showEdges === false) return;
    const map = this.map;
    const mask = safe(() => this._edgeMask(), null);
    if (!mask) return;

    const x0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
    const y0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
    const x1 = Math.min(map.w - 1, x0 + Math.ceil(VIEW_W / TILE) + 2);
    const y1 = Math.min(map.h - 1, y0 + Math.ceil(VIEW_H / TILE) + 2);

    // Two passes so the whole rim shares one fillStyle each time: the soft
    // contact shadow first, then the crisp 1px line that gives it an edge.
    ctx.save();
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? 'rgba(8,7,12,0.30)' : 'rgba(232,214,168,0.10)';
      const t = pass === 0 ? 3 : 1;                 // shadow depth, then hairline
      for (let y = y0; y <= y1; y++) {
        const row = y * map.w;
        const py = y * TILE - cam.y;
        for (let x = x0; x <= x1; x++) {
          const b = mask[row + x];
          if (!b) continue;
          const px = x * TILE - cam.x;
          if (b & 1) ctx.fillRect(px, py, TILE, t);
          if (b & 4) ctx.fillRect(px, py + TILE - t, TILE, t);
          if (b & 8) ctx.fillRect(px, py, t, TILE);
          if (b & 2) ctx.fillRect(px + TILE - t, py, t, TILE);
        }
      }
    }
    ctx.restore();
  }

  /** Warps out of this map that are currently on screen. */
  _visibleExits(cam) {
    const map = this.map;
    if (!map || !Array.isArray(map.triggers)) return [];
    const out = [];
    for (const tr of map.triggers) {
      if (!tr || (tr.kind !== 'warp' && tr.kind !== 'door')) continue;
      const px = tr.x * TILE - cam.x, py = tr.y * TILE - cam.y;
      if (px < -TILE || py < -TILE || px > VIEW_W || py > VIEW_H) continue;
      out.push({ tr, px, py });
    }
    return out;
  }

  /** The readable name of wherever a warp leads. */
  _exitName(tr) {
    const d = (tr && tr.data) || {};
    const id = d.map || d.mapId || null;
    if (!id) return null;
    if (this._exitNames && this._exitNames[id]) return this._exitNames[id];
    const meta = LATE.maps && typeof LATE.maps.mapMeta === 'function'
      ? safe(() => LATE.maps.mapMeta(id), null) : null;
    const name = (meta && meta.name) || titleCase(String(id).replace(/-/g, ' '));
    if (!this._exitNames) this._exitNames = {};
    this._exitNames[id] = name;
    return name;
  }

  _drawExits(ctx, cam) {
    if (Save && Save.settings && Save.settings.showExits === false) return;
    const list = this._visibleExits(cam);
    if (!list.length) return;

    const t = this.t;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
    let nearest = null, nearestD = 99;

    for (const { tr, px, py } of list) {
      const d = Math.max(Math.abs(tr.x - this.player.x), Math.abs(tr.y - this.player.y));
      if (d < nearestD) { nearestD = d; nearest = { tr, px, py }; }

      // A door in a wall already looks like a door. A gap in a hedge where the
      // road leaves town looks like grass, so that is the one that needs shouting.
      const link = (tr.data && tr.data.kind) || '';
      const isRoad = link === 'road' || link === 'path';
      const dir = this._exitArrowDir(tr);
      const v = DIR_VEC[dir] || DIR_VEC.down;
      const lit = 0.55 + 0.45 * pulse;

      ctx.save();

      // 1. The threshold: a bright bar laid across the way out, like the lintel
      //    of a gate, perpendicular to the direction you leave in.
      const barA = (isRoad ? 0.85 : 0.55) * lit;
      if (v.x) {
        const bx = px + (v.x > 0 ? TILE - 2 : 0);
        ctx.fillStyle = 'rgba(24,16,6,0.60)';
        ctx.fillRect(bx + (v.x > 0 ? -1 : 2), py + 1, 1, TILE - 2);
        ctx.fillStyle = `rgba(255,226,150,${barA.toFixed(3)})`;
        ctx.fillRect(bx, py + 1, 2, TILE - 2);
      } else {
        const by = py + (v.y > 0 ? TILE - 2 : 0);
        ctx.fillStyle = 'rgba(24,16,6,0.60)';
        ctx.fillRect(px + 1, by + (v.y > 0 ? -1 : 2), TILE - 2, 1);
        ctx.fillStyle = `rgba(255,226,150,${barA.toFixed(3)})`;
        ctx.fillRect(px + 1, by, TILE - 2, 2);
      }

      // 2. Gateposts either side of the opening, so a gap in a hedge reads as a
      //    way through rather than a hole someone forgot to paint.
      const postA = (isRoad ? 0.70 : 0.40) * lit;
      ctx.fillStyle = `rgba(255,214,120,${postA.toFixed(3)})`;
      if (v.x) {
        ctx.fillRect(px + 2, py, TILE - 4, 2);
        ctx.fillRect(px + 2, py + TILE - 2, TILE - 4, 2);
      } else {
        ctx.fillRect(px, py + 2, 2, TILE - 4);
        ctx.fillRect(px + TILE - 2, py + 2, 2, TILE - 4);
      }

      // 3. A warm pool on the ground under the threshold.
      ctx.fillStyle = `rgba(240,196,110,${((isRoad ? 0.22 : 0.13) * lit).toFixed(3)})`;
      ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);

      // 4. Chevrons marching the way you would leave. A road gets three, a door
      //    the one — and each is outlined so it survives any tileset under it.
      const n = isRoad ? 3 : 1;
      const cycle = n * 4;
      for (let i = 0; i < n; i++) {
        const march = ((t * 11 + i * 4) % cycle) - cycle / 2;
        const fade = 1 - Math.abs(march) / (cycle / 2 + 1);
        this._drawChevron(ctx,
          px + TILE / 2 + v.x * march, py + TILE / 2 + v.y * march, dir,
          clamp((0.35 + 0.5 * pulse) * fade, 0, 1));
      }
      ctx.restore();
    }

    // Which exit to name is decided here (the geometry is to hand), but the
    // label itself is a readout and goes up with the HUD in drawUI — drawn here
    // it was dimmed by the night grade and walked behind by the party.
    this._exitLabel = (nearest && nearestD <= 5)
      ? { name: this._exitName(nearest.tr), px: nearest.px, py: nearest.py, d: nearestD }
      : null;
  }

  /** The "→ The Triboar Trail" plate. Called from drawUI, above the grading. */
  _drawExitLabel(ctx) {
    const e = this._exitLabel;
    if (!e || !e.name) return;
    const label = '\u2192 ' + e.name;
    const w = safe(() => UI.measure(label, 'sm'), label.length * 4) + 8;
    const lx = clamp(Math.round(e.px + TILE / 2 - w / 2), 2, VIEW_W - w - 2);
    const ly = clamp(e.py - 13, 2, VIEW_H - 14);
    const a = clamp(1.2 - e.d / 5, 0.25, 1);
    ctx.save();
    ctx.globalAlpha = a;
    safe(() => UI.panel(ctx, lx, ly, w, 11, { style: 'dark', shadow: 0.4, studs: false }));
    safe(() => UI.text(ctx, lx + w / 2, ly + 2, label, {
      size: 'sm', color: UI.COLORS.goldBright, align: 'center', shadow: true,
    }));
    ctx.restore();
  }

  /**
   * Which way the chevron points: whatever the warp declares, else away from the
   * middle of the map (an exit on the east edge points east).
   */
  _exitArrowDir(tr) {
    const d = (tr && tr.data) || {};
    if (d.arrow && DIR_VEC[d.arrow]) return d.arrow;
    // For a door in a wall, `dir` is the way you face on arrival, which is also
    // the way you walked to get there. For stairs and wells it means DESCEND,
    // and pointing an arrow south because you are going down a hole is worse
    // than pointing nowhere — so those fall through to the geometry below.
    const vertical = d.kind === 'stairs' || d.kind === 'well' || d.kind === 'ladder';
    if (!vertical && d.dir && DIR_VEC[d.dir]) return d.dir;
    if (tr.facing && DIR_VEC[tr.facing]) return tr.facing;
    const map = this.map;
    const dx = tr.x - map.w / 2, dy = tr.y - map.h / 2;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  /** A little arrowhead with a dark keyline, drawn axis-aligned so it stays crisp. */
  _drawChevron(ctx, cx, cy, dir, alpha) {
    if (alpha <= 0.02) return;
    const v = DIR_VEC[dir] || DIR_VEC.down;
    const x = Math.round(cx), y = Math.round(cy);
    // Outline first (a pixel fatter), then the bright core over it, so the arrow
    // reads on grass, flagstone and mud alike.
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0
        ? `rgba(26,16,6,${(alpha * 0.75).toFixed(3)})`
        : `rgba(255,240,196,${alpha.toFixed(3)})`;
      // The outline runs one pixel ahead of the core and one wider, so the tip
      // — the pixel the keyline exists to protect — is genuinely enclosed.
      const rows = pass === 0 ? 5 : 4;
      for (let i = 0; i < rows; i++) {
        const span = pass === 0 ? i : Math.max(0, i - 1);
        const lead = pass === 0 ? 1 : 0;
        const bx = x - v.x * (i - lead), by = y - v.y * (i - lead);
        if (v.x) ctx.fillRect(bx, by - span, 1, span * 2 + 1);
        else ctx.fillRect(bx - span, by, span * 2 + 1, 1);
      }
    }
  }

  /**
   * Day/night grading, cave darkness, and the warm pools of light that torches and
   * lit windows throw once the sun is down. Drawn over the world and under the HUD,
   * so the interface stays readable at midnight.
   */
  _drawGrade(ctx, cam) {
    const map = this.map;
    const st = state();
    const graded = map.dayNight !== false && !map.indoor && st;
    const tint = graded ? dayTint(st.time) : null;
    const dark = map.dark || 0;

    if (tint && tint.a > 0.005) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = tint.a;
      ctx.fillStyle = `rgb(${tint.r},${tint.g},${tint.b})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }

    // A map-authored ambient wash (crypts, the Redbrand cellar).
    if (map.ambient && map.ambient.color) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = clamp(map.ambient.alpha != null ? map.ambient.alpha : 0.3, 0, 1);
      ctx.fillStyle = map.ambient.color;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }

    if (dark > 0) this._drawDarkness(ctx, cam, dark);

    const night = tint ? clamp((tint.a - 0.07) / 0.42, 0, 1) : (map.indoor || map.dark ? 0.85 : 0);
    if (night > 0.04) this._drawLights(ctx, cam, night);
  }

  _drawDarkness(ctx, cam, amount) {
    const cx = Math.round(this.player.px - cam.x);
    const cy = Math.round(this.player.py - cam.y) - 8;
    // A cast Light spell is the one thing that genuinely pushes a cave back.
    const r = 84 + (this.spellLight ? this.spellLight.radius : 0);
    const g = ctx.createRadialGradient(cx, cy, 8, cx, cy, r);
    g.addColorStop(0, 'rgba(2,3,8,0)');
    g.addColorStop(0.55, `rgba(2,3,8,${(amount * 0.45).toFixed(3)})`);
    g.addColorStop(1, `rgba(2,3,8,${clamp(amount, 0, 0.97).toFixed(3)})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  _drawLights(ctx, cam, night) {
    const glows = safe(() => glowsFor(this.map), []) || [];
    if (!glows.length) return;
    const nightOnly = night > 0.25;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    let drawn = 0;
    for (const gl of glows) {
      if (drawn > 26) break;
      const sx = gl.x * TILE + TILE / 2 - cam.x;
      const sy = gl.y * TILE + TILE / 2 - cam.y;
      const rad = gl.def.r;
      if (sx < -rad || sy < -rad || sx > VIEW_W + rad || sy > VIEW_H + rad) continue;
      if (gl.def.nightOnly && !nightOnly) continue;
      drawn++;
      const flick = gl.def.flick
        ? 1 + Math.sin((this.t * 6.5) + gl.phase * 12) * 0.07 * gl.def.flick
        : 1;
      const a = clamp(0.42 * night * flick, 0, 0.7);
      const c = gl.def.c;
      const g = ctx.createRadialGradient(sx, sy, 1, sx, sy, rad * flick);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`);
      g.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},${(a * 0.35).toFixed(3)})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    }
    ctx.restore();
  }

  /** A small bouncing chevron over whatever pressing A would talk to. */
  _drawInteractHint(ctx, cam) {
    if (this.player.moving || this.popup || !this.entities) return;
    const f = this.player.frontTile();
    const e = safe(() => this.entities.interactableAt(f.x, f.y), null);
    const t = e ? null : this.map.triggerAt(f.x, f.y, { flags: flagsOf() });
    if (!e && (!t || isStepTrigger(t.kind))) return;

    const wx = (e ? e.px : f.x * TILE + TILE / 2) - cam.x;
    const wy = (e ? e.py - (e.char || e.sprite ? 26 : 18) : f.y * TILE - 4) - cam.y;
    const bob = Math.round(Math.sin(this.t * 6) * 1.5);
    const x = Math.round(wx), y = Math.round(wy) + bob;

    // Holding Shift over a person turns the "talk" chevron red: that press
    // starts a fight instead of a conversation, and you should know before you
    // make it. It never appears over someone the game will not let you attack.
    const armed = !!e && e.kind === 'npc'
      && safe(() => Input.down('run'), false)
      && safe(() => crimeCanAttack(e.npc || getNPC(e.npcId) || e, e).ok, false);

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#1a1014';
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y - 4); ctx.lineTo(x, y + 2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = armed ? '#d4553f' : '#e3b34a';
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 4); ctx.lineTo(x + 3, y - 4); ctx.lineTo(x, y + 1);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    if (armed) {
      safe(() => UI.text(ctx, x, y - 15, 'ATTACK', {
        size: 'sm', color: '#e8735c', align: 'center', shadow: true,
      }));
    }
  }

  _drawBanner(ctx) {
    const b = this.banner;
    if (!b) return;
    const fade = b.t < 0.3 ? b.t / 0.3 : b.t > 2.6 ? clamp((3.2 - b.t) / 0.6, 0, 1) : 1;
    if (fade <= 0.01) return;
    const w = Math.max(96, safe(() => UI.measure(b.text, 'md'), 80) + 28);
    const x = Math.round((VIEW_W - w) / 2), y = 18;
    const h = b.sub ? 28 : 20;
    ctx.save();
    ctx.globalAlpha = fade;
    safe(() => UI.panel(ctx, x, y, w, h, { style: 'dark', alpha: 0.9 }));
    safe(() => UI.text(ctx, Math.round(VIEW_W / 2), y + 5, b.text, {
      size: 'md', color: UI.COLORS.gold, align: 'center', shadow: true,
    }));
    if (b.sub) {
      safe(() => UI.text(ctx, Math.round(VIEW_W / 2), y + 16, b.sub, {
        size: 'sm', color: UI.COLORS.dim, align: 'center',
      }));
    }
    ctx.restore();
  }

  _drawPopup(ctx) {
    const p = this.popup;
    if (!p) return;
    const rows = p.lines.length;
    const w = 150, h = 22 + rows * 10;
    const x = Math.round((VIEW_W - w) / 2), y = Math.round((VIEW_H - h) / 2) - 20;
    const pop = clamp(p.t / 0.14, 0, 1);
    ctx.save();
    ctx.globalAlpha = p.t > (p.life || 4.5) - 0.4 ? clamp(((p.life || 4.5) - p.t) / 0.4, 0, 1) : 1;
    safe(() => UI.window(ctx, x, y, w, h, p.title || 'Found', { style: 'window' }));
    for (let i = 0; i < rows; i++) {
      safe(() => UI.text(ctx, x + 10, y + 9 + i * 10, p.lines[i], {
        size: 'sm', color: UI.COLORS.ink, maxWidth: w - 20,
      }));
    }
    if (pop >= 1) {
      safe(() => UI.text(ctx, x + w - 8, y + h - 10, 'A', {
        size: 'sm', color: UI.COLORS.goldDim, align: 'right',
      }));
    }
    ctx.restore();
  }

  _drawLoading(ctx) {
    const dots = '.'.repeat(1 + (Math.floor(this.t * 2) % 3));
    safe(() => UI.text(ctx, VIEW_W / 2, VIEW_H / 2 - 6, `The road unfolds${dots}`, {
      size: 'md', color: UI.COLORS.dim, align: 'center',
    }));
  }
}

export default OverworldScene;
