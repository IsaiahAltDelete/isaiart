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
  TILE, VIEW_W, VIEW_H, DIR_VEC, dirFrom, SPRITE_W,
  WALK_TIME, RUN_TIME, PARTY_MAX, clamp, timeOfDay, titleCase,
} from '../constants.js';
import { Game } from '../engine.js';
import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { Save } from '../core/save.js';
import { CHEATS } from '../core/cheatflags.js';
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
import { drawTile, tileGroup, tileKey as tileKeyOf, tileLayer, tileFlags, tileHash, isAnimated, T } from '../render/tiles.js';
// THE TWO CONTRACTED EXPORTS, IMPORTED THE ONLY WAY THAT CANNOT BREAK THE GAME.
// `tileSubgroup` (a finer material key than `group`) and `isleTileFor` (the
// soft-edged lone-patch tile for a material) belong to render/tiles.js and may
// not have landed yet. A NAMED import of an export that does not exist is a
// LINK-TIME failure — the module graph refuses to instantiate and the whole game
// goes white — so they arrive through the namespace object, where a missing name
// is simply `undefined`, and are resolved once in initFringe() behind a fallback
// that is always safe. This file therefore works identically whether the other
// half of the contract is on disk or not; it only does more when it is.
import * as TILESET from '../render/tiles.js';
import { hasSprite, spriteSize } from '../render/sprites.js';
import { UI } from '../ui/kit.js';
import { HUD } from '../ui/hud.js';
import { Hotbar, SLOT_COUNT } from '../ui/hotbar.js';
import { TileMap, TF, isStepTrigger } from './tilemap.js';
import { Entity, EntityList, ChestEntity, makeEntity, spawnFromTriggers } from './entity.js';
import { Party } from './party.js';
import { buildBattleMap } from './battlemap.js';
import { rollEncounter, makeMonster, ambushContest } from '../rules/scaling.js';
import {
  expireFieldBuffs, fieldBuffsToRounds, fieldCastable, fieldCast, fieldTargeting, minutesFor,
  fieldNeedsChoice,
} from '../rules/fieldcast.js';
// rules/fieldworld.js owns every world verb a spell (or a lockpick) reaches for.
// The overworld only supplies the scene; the module does the rest.
import {
  fieldHooks, expireMarkers, movementOpts, encounterFactor,
  hasLight, perceptionPenalty,
  tryPickLock, noticeTrap, revealTrap, tryDisarm, springTrap, lockDC,
  castLight as castLightField, detect as detectField,
  unlockNearest, lockNearest, locate, revealRadius, revealAll,
  omen, readMind, charmFacing, wardArea, makeSanctuary,
  reachChest, identifyAll, identifyOne, fieldMech, terrainEncounterFactor,
} from '../rules/fieldworld.js';
import {
  advanceTime, tickWeather, isChestLooted, markChestLooted, progressQuests, failQuest,
} from '../state.js';
import { spawnableOnMap, getNPC } from '../data/npcs.js';
import { getMonster } from '../data/monsters.js';
import {
  canAttack as crimeCanAttack, statBlockFor, witnessesNear, guardsAmong,
  reportAssault, reportDeath, isSlain, watchOwed, clearWatch, watchPatrol,
  bountyIn, isOutlawIn,
} from '../rules/crime.js';
import { resolveItem } from '../data/items.js';
import { getSpell } from '../data/spells.js';
import {
  heal as healMember, isDead as isDeadMember, skillMod,
} from '../rules/character.js';
import { conditionMech } from '../rules/conditions.js';
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

// --- clearing out a region -------------------------------------------------
// Four fights won in one stretch of wilderness and the road goes quiet: the
// ambush rate drops to a quarter for three days, then the wilds fill back in.
/** Wilderness victories in one map before it counts as thinned out. */
const CLEARED_AT = 4;
/** In-game days a cleared region stays quiet. */
const CLEARED_DAYS = 3;
/** What the encounter rate is multiplied by while a region is cleared. */
const CLEARED_RATE = 0.25;

// --- visible wandering packs -----------------------------------------------
/** How many packs a wilderness map is seeded with. */
const ROAMERS_MIN = 2, ROAMERS_MAX = 5;
/** No pack spawns closer to the arrival tile than this, in tiles. */
const ROAMER_CLEAR = 12;
/** A defeated pack comes back after this many in-game days. */
const ROAMER_RESPAWN_DAYS = 3;

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
    cls: 'npc', npcId: n.id, name: n.name, title: n.title || '', sprite: n.sprite, colorway: n.colorway,
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

/**
 * How hard the sun is throwing shadows, 0..1, without allocating anything —
 * `dayTint` builds an object and the draw loop must not.
 *
 * This is the one knob that stops the depth passes double-darkening at night.
 * The day/night grade in `_drawGrade` is a full-screen multiply laid over the
 * finished world, so a contact shadow painted at midday strength would be
 * crushed twice: once by its own black, once by the blue of midnight. Scaling
 * every shadow by the sun means noon gets a crisp shadow, dusk a long soft one
 * and midnight only the ambient occlusion that a wall owes you regardless of
 * where the sun is.
 */
function sunStrength(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m >= 450 && m <= 1000) return 1;                       // full day
  if (m > 1000 && m < 1150) return clamp(1 - (m - 1000) / 150, 0, 1);   // into dusk
  if (m > 300 && m < 450) return clamp((m - 300) / 150, 0, 1);          // out of dawn
  return 0;                                                  // night: ambient only
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
// 4a. DEPTH — CONTACT SHADOWS, WALL-BASE OCCLUSION, ROOF OVERHANGS
// ---------------------------------------------------------------------------
//
// A flat tileset seen from above has no way to say "this is a thing standing on
// the ground" versus "this is a thing painted on the ground". Three cheap passes
// fix that, and all three obey the same rule: they are painted onto the GROUND,
// under everything they are supposed to be under, and never onto the thing that
// casts them.
//
//   1. contact shadows — a soft two-tone ellipse under the feet of every actor,
//      painted in one sweep BEFORE any sprite so no shadow ever lands on a
//      neighbour's face.
//   2. wall-base occlusion — a graded ramp on the walkable side of every
//      wall/water boundary, deepest where it touches, plus a dab in every
//      concave corner. Replaces the old 3px slab + hairline, which read as an
//      outline rather than as light failing to reach a crevice.
//   3. roof overhangs — an over-layer tile (thatch, canopy) drops a short band
//      onto whatever is directly south of it, so a house has an eave and a wall
//      face rather than a roof pasted on grass.
//
// Everything derived from the map is cached on the map and invalidated in
// bindMap; the per-frame work is a bounded scan of the visible window into
// pre-allocated scratch arrays and a run of fillRects grouped by alpha.

/** Alpha ramps, from the pixel that touches the wall outwards. */
const AO_N = [0.30, 0.20, 0.12, 0.06];   // wall to the north: deepest, light comes from above
const AO_X = [0.26, 0.15, 0.07];         // wall east or west
const AO_S = [0.20, 0.11, 0.05];         // wall to the south: the shallow side
const AO_STEPS = 4;                      // max of the three above
const AO_CORNER = 0.13;                  // extra dab where two blocked sides meet
const AO_DIAG = 0.15;                    // a blocked diagonal with both sides open

/** The band an over-layer tile drops onto the tile below it. */
const OVERHANG_N = [0.44, 0.34, 0.24, 0.15, 0.07];   // rows down from the eave
const OVERHANG_W = [0.26, 0.16, 0.08];               // columns in from the west side
const OVERHANG_STEPS = 5;

/** Contact shadow: half-width as a fraction of sprite width, then the two tones. */
const SHADOW_SPREAD = 0.38;
const SHADOW_CORE = 0.28;
const SHADOW_PENUMBRA = 0.14;

/** Mask bits. Sides first so `b & 15` is still "which sides are blocked". */
const M_N = 1, M_E = 2, M_S = 4, M_W = 8;
const M_NE = 16, M_SE = 32, M_SW = 64, M_NW = 128;

/** Passed to EntityList.draw so sprites skip their own built-in shadow. */
const NO_SPRITE_SHADOW = Object.freeze({ shadow: false });

// ---------------------------------------------------------------------------
// 4b. THE VERGE — ground autotiling at draw time
// ---------------------------------------------------------------------------
//
// A road painted as flat DIRT_PATH squares changes its grass/path boundary only
// where two tiles meet, so a road on a diagonal is a staircase: measured, 13 of
// 13 edge changes landed exactly on a 16px tile border. render/tiles.js has
// carried the cure for a while — DIRT_PATH_N…NW and DIRT_N…NW, each an irregular
// dithered verge — and `autotileEdges()` already resolves the family by name.
// Nothing ever called it, so all sixteen tiles had zero placements.
//
// This resolves them HERE, in the draw path, rather than baking variants into
// world/maps.js: the hand-authored maps and the procedurally generated ones both
// get a verge with no map edits, and no tile id is renumbered.
//
// THREE RULES, all learned from watching it go wrong:
//
//   1. ONLY FRINGE A DIFFERENT FAMILY, AND ONLY A CARDINAL ONE. autotileEdges
//      falls back to an inner corner when a tile has no differing side but one
//      differing DIAGONAL — which puts two full verges on a tile sitting in the
//      middle of the road. Phandalin has 57 such tiles and the Triboar Trail 13;
//      obeying that fallback erodes a three-wide road into disconnected brown
//      squares. A tile whose four cardinal neighbours are all the same family
//      keeps the solid core tile, so the road core never thins.
//   2. ONLY FRINGE WHAT THE VERGE IS PAINTED IN. The verge is turf, so it is
//      only drawn where the neighbour is grass. A dirt planter in a flagstone
//      plaza — Neverwinter has 49 of them — must not sprout a lawn. Stated as a
//      standing rule rather than a fact about today's tileset: two PAVED
//      families never verge into one another, whatever else the invader set
//      grows to hold, because a cobble/flagstone join is a change of masonry,
//      not a change of terrain.
//   3. NEVER LET A FOREIGN MATERIAL EAT AN ISLAND. A tile with no same-family
//      cardinal neighbour at all gets all four sides verged, and four verges eat
//      16px inward from every edge: the Triboar Trail's 9 lone trail tiles kept
//      41.97% of their soil and Conyberry's 64 kept 62.18%, so an authored
//      single-tile marker dissolved into a smudge and Conyberry's largest road
//      component fell from 57.05% to 32.55%. Authored map data gets the benefit
//      of the doubt — one tile on its own is a thing the author drew.
//      See ISLANDS below for the two things that changed about this rule.
//
// WHAT "A DIFFERENT FAMILY" MEANS, AND WHY IT HAD TO GET FINER. Rule 1 asked
// `group`, and `group` is coarse on purpose: GRAVEL, DIRT, DIRT_PATH, MUD and
// FARMLAND all answer 'dirt' so that a path beside bare soil grows no grass
// verge between them. The cost, measured over the 17 maps, was 1,623 joins that
// autotileEdges reported as no edge at all and this pass therefore never looked
// at — 809 of them involving GRAVEL, whose join with the rest of the dirt family
// measured a mean |dL*| of 9.22 across the seam against 3.64 inside a tile: a
// grid-visibility ratio of 2.54, HARDER than the worst boundary in the original
// audit. On the Triboar Trail they are dark rectangles scattered through the
// road; at the Wave Echo cave mouth they are a chequerboard of tan and grey
// squares sitting a few pixels from a grass boundary that now looks excellent.
//
// So the "is this a different material?" question is now asked of
// tileSubgroup() — 'gravel' / 'dirt' / 'path' / 'mud' / 'farmland' — and only
// falls back to tileGroup() when render/tiles.js does not export one. Rule 2 is
// unchanged in effect and is still judged so that a cobble/flagstone join stays
// unverged however finely the key splits 'road': PAVED is consulted with BOTH
// the coarse group and the fine key, so a new 'cobble' subgroup cannot sneak a
// verge past a rule that was only ever written down as 'road'.
//
// WHO INVADES WHOM, WITHIN ONE GROUP. Grass invading soil is one-directional
// because the verge is painted in turf; a soil/soil join has no such asymmetry
// handed to it, and if BOTH tiles invade each other the two independent tongues
// interleave and the boundary turns to mush instead of wandering. SOFT_RANK
// therefore fixes a total order inside a group and only the higher rank invades:
// mud > dirt > path > gravel > farmland. It is ordered so the thing that reads
// as a PATCH is the thing that gets the soft edge — gravel scattered through a
// road, a ploughed field's headland — which is exactly the defect being fixed.
//
// ISLANDS, twice amended:
//   3a. Rule 3 protects a tile from being eroded by a DIFFERENT COARSE MATERIAL.
//       Erosion by the same coarse group — dirt lapping into gravel — neither
//       turns a marker into a smudge (it is still soil) nor breaks road
//       connectivity (the invader is road too), so it is allowed on an island.
//       Without this, 857 of the 1,623 joins would still be refused, because
//       more than half the dirt-family joins have an island on one side; the
//       chequerboard IS the islands.
//   3b. A lone patch with nothing but grass around it gets a TILE, not a nibble.
//       125 SNOW_GRASS squares in Neverwinter Wood, and 57 DIRT + 16 GRAVEL on
//       the trails, are hard-edged 16px squares because rule 3 rightly refuses
//       to nibble four sides off them. isleTileFor() answers with a purpose-drawn
//       patch — soft on all four sides INSIDE its own 16x16 — and where it does,
//       that tile is drawn instead. Where it does not, the square stays, because
//       a wrong patch is worse than a hard edge. It is only used where every
//       cardinal neighbour is turf, since that is the ground the patch is drawn
//       sitting on; anything else would paint grass where the map says soil.
//
// WHICH FAMILIES. Nothing here is a list of names. Every GROUND family that owns
// all eight members under the names autotileEdges resolves (`BASE_N` … `BASE_NW`)
// is registered on first use, so the whole cost of giving GRAVEL a verge is
// adding GRAVEL_N…GRAVEL_NW to render/tiles.js — this file does not change.
// Deco/solid families are skipped: CAVE_WALL and CLIFF carry a full eight-member
// set too, and they are masonry, not turf.
//
// THE WATERLINE, and this was measured rather than assumed. SHORE_N…NW is a
// beach: a full tile of PAL.sand with a 2-8px strip of water along the named
// edge. Wiring water into this same pass gave the right GEOMETRY and the wrong
// VALUE — the mean |dL*| across the Neverwinter quay went 5.42 -> 34.15 and
// Neverwinter Wood's 7.92 -> 27.76, because sand sits at L* 80 against cobble at
// 48 and grass at 47. Worse, the shore leaves only ~6px of water on a 16px tile,
// so Neverwinter Wood's one-and-two-tile-wide river broke into disconnected
// pools inside yellow rectangles. No map in the game puts water beside SAND.
//
// So the waterline is wired to a BANK TONE KEYED TO THE GROUND THE WATER MEETS
// (SHORE_BANK below): grass bank against turf, stone quay against paving. The
// raw sand SHORE_* is offered to `sand` and to nothing else, which is why the
// shore stays switched off on every map in the game until render/tiles.js grows
// a keyed set. A wrong bank is worse than no bank — that is the whole lesson of
// the version that was backed out.
//
// A family has at most eight members, so a tile needing three or four verges is
// drawn again with the extra members clipped to the half or quadrant they own.
// That is a few dozen tiles per map, all resolved once at map load.
//
// Everything is cached per map in a Uint16Array built on first draw and dropped
// in bindMap with the other derived masks. One 16-bit word per tile:
//
//   bits 0-3    the cardinal mask the MEMBER SET draws (the hand-painted verge)
//   bits 4-7    which member set: 0 = the tile's own family, 1-14 = a named base
//               in FRINGE_BASES (the waterline's bank), 15 = SYN_SLOT, meaning
//               there is no member set and bits 0-3 are the synthetic mask
//   bits 8-11   sides invaded SYNTHETICALLY ON TOP of whatever bits 0-3 drew.
//               This is the one genuinely new field: a DIRT_PATH tile can carry
//               a hand-painted grass verge on its north side AND a composited
//               tongue of dirt on its east, which the old single-nibble byte had
//               no way to say. Zero on every tile that behaved before.
//   bit 12      FR_ISLE: draw isleTileFor() instead of any of the above.
//
// A word of zero still means "nothing to do", which is most of the map. The draw
// loop reads that word and walks a pre-built plan: no allocation, no autotile
// query, no string built per frame.

/** Cardinal bits, in the order autotileEdges packs them. */
const FR_SIDES = ['N', 'E', 'S', 'W'];
const FR_DX = [0, 1, 0, -1];
const FR_DY = [-1, 0, 1, 0];

/** The half of a tile a given side owns, as [x, y, w, h] inside the 16px tile. */
const FR_BAND = { N: [0, 0, 16, 8], E: [8, 0, 8, 16], S: [0, 8, 16, 8], W: [0, 0, 8, 16] };
/** Quadrants, for the one case that needs all four verges at once. */
const FR_QUAD = { NW: [0, 0, 8, 8], NE: [8, 0, 8, 8], SE: [8, 8, 8, 8], SW: [0, 8, 8, 8] };

/** A verge is painted in grass, so grass is the only thing that may cross a
 *  GROUP boundary to invade. Everything else stays inside its own group. */
const VERGE_INVADER = new Set(['grass']);

/**
 * Built surface. Rule 2: two of these never verge into one another.
 *
 * Held as both the COARSE groups and the fine keys a subgroup split is likely to
 * produce, and tested against both, so that the day tileSubgroup() starts
 * answering 'cobble' and 'flagstone' instead of 'road' a masonry join does not
 * quietly become eligible for a verge. Missing a name here is a visible bug —
 * a lawn growing along a flagstone seam — so the list is deliberately generous.
 */
const PAVED = new Set([
  'road', 'floor',
  'cobble', 'flagstone', 'stone-floor', 'wood-floor', 'mosaic',
  'dungeon-floor', 'bone-floor', 'cave-floor', 'bridge', 'plank',
]);
/** Rule 2's predicate, asked with the fine key AND the coarse group. */
function isPaved(sub, grp) { return PAVED.has(grp) || PAVED.has(sub); }

/**
 * WHO INVADES WHOM INSIDE ONE COARSE GROUP. Higher rank paints into lower.
 *
 * Two tiles of the same group differ only in surface — gravel scattered over a
 * dirt road, a ploughed headland beside a track — so neither is "the terrain the
 * other one interrupts" the way grass is. Something has to break the tie, and it
 * has to break it ONE WAY: a synthetic verge composites the neighbour's real
 * pixels over a ragged tongue, so if both sides did it to each other the two
 * independent tongues would interleave into 4px of scrambled material instead of
 * a boundary that wanders.
 *
 * The order puts the material that reads as a PATCH at the bottom, so the patch
 * is the thing that gets the soft edge: gravel loses its 90-degree corners
 * against both the dirt and the path it is scattered through, and a furrowed
 * field softens where a track runs past it.
 *
 * A subgroup with no entry here never soft-verges, which is the safety property
 * that matters most: if tileSubgroup() splits a family this file has never heard
 * of — 'clover' out of grass, say — the split changes nothing, rather than
 * quietly starting to verge every meadow in the game.
 */
const SOFT_RANK = { mud: 60, dirt: 52, path: 46, gravel: 40, farmland: 36 };

/**
 * The ground an _ISLE patch is drawn sitting on. isleTileFor() hands back one
 * tile per material, so the tile has to assume a surround, and the surround it
 * assumes is turf — every island the audit named is a patch in grass. Used only
 * where EVERY cardinal neighbour matches, because the alternative is painting
 * grass on a tile the map says is soil, and a wrong patch is worse than a hard
 * edge (the same lesson as the sand shore that was backed out).
 */
const ISLE_SURROUND = new Set(['grass']);

/** id -> the soft-edged lone-patch tile for it, or 0. Filled in initFringe. */
const ISLE_OF = [];

/** Mask bit 12: this cell draws its island patch tile and nothing else. */
const FR_ISLE = 1 << 12;

/** The eight suffixes a complete family carries. */
const FR_SUFFIX = ['N', 'E', 'S', 'W', 'NE', 'SE', 'SW', 'NW'];

/**
 * tileSubgroup() once render/tiles.js exports it, tileGroup() until then. Both
 * are pure id -> string, so every call site reads the same either way and the
 * only difference is how finely the game can tell two materials apart. Resolved
 * once, in initFringe(), rather than at module scope: nothing here runs before
 * the first map is drawn, and a late-arriving export is then still picked up.
 */
let subOf = tileGroup;

/** isleTileFor() when it exists. Null means "no island patches available". */
let isleOfId = null;

/**
 * Same material? Mirrors autotileEdges()'s own test exactly — identical id, or a
 * shared non-empty key — so that with subOf === tileGroup this pass sees the
 * same edges it saw before the finer key existed, VOID's null group included.
 */
function sameMaterial(a, b) {
  if (a === b) return true;
  const sa = subOf(a);
  return !!(sa && sa === subOf(b));
}

/**
 * Ground ids owning a full eight-member verge set: 1 for a family that names its
 * own members, 2 for water, whose member set is chosen per tile from the bank it
 * meets. Filled on first use.
 */
const FRINGE_KIND = [];

/**
 * Member-set names other than "the tile's own family key", indexed by the high
 * nibble of a mask byte. Slot 0 is unused so a zero byte still means "no verge".
 */
const FRINGE_BASES = [null];

/**
 * The bank the waterline is drawn in, keyed by the GROUP the water meets, most
 * specific first. Nothing here has to exist; the first entry whose eight members
 * are actually defined wins, and water is not registered at all when none does.
 */
const SHORE_BANK = {
  grass: ['SHORE_GRASS', 'SHORE_TURF', 'SHORE_BANK', 'SHORE'],
  snow: ['SHORE_SNOW', 'SHORE_GRASS', 'SHORE_BANK', 'SHORE'],
  dirt: ['SHORE_DIRT', 'SHORE_SILT', 'SHORE_MUD', 'SHORE_BANK', 'SHORE'],
  sand: ['SHORE_SAND', 'SHORE'],
  road: ['QUAY', 'SHORE_QUAY', 'SHORE_STONE'],
  floor: ['QUAY', 'SHORE_QUAY', 'SHORE_STONE'],
};

/**
 * THE ONE NAME THAT PROVES NOTHING, AND THE GATE THAT FIXES THAT.
 *
 * The waterline rework in render/tiles.js keeps the name SHORE_* for the soft
 * bank — so the mere existence of SHORE_N…NW says nothing about which art is
 * behind it, and the old art is the sand beach whose L* 80 took the Neverwinter
 * waterline from 5.42 to 34.15. A generic name is therefore accepted ONLY once
 * the masonry set exists, because that set is new: it has no old meaning to be
 * confused with, and it only appears when the waterline has actually been
 * regraded. Until then water is never registered and the waterline draws exactly
 * as it did before this file was touched. A wrong bank is worse than no bank.
 */
const SHORE_GENERIC = 'SHORE';
const SHORE_MASONRY = ['QUAY', 'SHORE_QUAY', 'SHORE_STONE'];

/** group -> index into FRINGE_BASES, or 0 when that bank has no art. */
const SHORE_SLOT = Object.create(null);

let fringeReady = false;

/** True when every one of a family's eight members is defined. */
function familyComplete(base) {
  for (let i = 0; i < FR_SUFFIX.length; i++) if (T[`${base}_${FR_SUFFIX[i]}`] == null) return false;
  return true;
}

/** True for DIRT_PATH_NE and friends: a member of a set, not a family of its own. */
function isFamilyMember(key) {
  const m = /^(.+)_(N|E|S|W|NE|SE|SW|NW)$/.exec(key);
  return !!m && familyComplete(m[1]);
}

/** Reserve (or reuse) a high-nibble slot for a named member set. */
function fringeSlot(base) {
  let i = FRINGE_BASES.indexOf(base);
  // 15 belongs to the synthetic verge (section 4c), so named sets get 1-14.
  if (i < 0) { if (FRINGE_BASES.length >= SYN_SLOT) return 0; i = FRINGE_BASES.push(base) - 1; }
  return i;
}

function initFringe() {
  if (fringeReady) return;
  fringeReady = true;
  // THE CONTRACT, RESOLVED ONCE. Both names are optional and both have a safe
  // answer when they are absent: the coarse group, and no island patches. A
  // thrown getter or a non-function under the right name is treated as absent
  // rather than allowed to take the ground layer down.
  try { if (typeof TILESET.tileSubgroup === 'function') subOf = TILESET.tileSubgroup; } catch { /* keep tileGroup */ }
  try { if (typeof TILESET.isleTileFor === 'function') isleOfId = TILESET.isleTileFor; } catch { /* keep null */ }
  // Discovered, never listed. A family qualifies when it is a walkable GROUND
  // tile and all eight of its members exist under the names autotileEdges
  // resolves, so DIRT and DIRT_PATH register today and GRAVEL, COBBLE,
  // SNOW_GRASS, MUD or FARMLAND register the moment their art lands.
  // The same sweep marks everything else that meets turf as kind 3: no member
  // set of its own, so section 4c builds the verge out of the neighbour.
  for (const key of Object.keys(T)) {
    const id = T[key];
    if (id == null || FRINGE_KIND[id]) continue;
    if (tileLayer(id) !== 'ground' || (tileFlags(id) & TF.SOLID)) continue;
    if (familyComplete(key)) FRINGE_KIND[id] = 1;
    // A synthetic verge is composited once and then blitted, so an animated
    // tile would freeze on the frame it was built. CROP_WHEAT sways; it keeps
    // its hard edge rather than stopping in the wind.
    else if (!isFamilyMember(key) && !isAnimated(id) && SYN_GROUPS.has(tileGroup(id))) FRINGE_KIND[id] = 3;
  }
  // The waterline, keyed to the bank it meets. See SHORE_GENERIC above for why
  // the reworked-shore gate is the arrival of the MASONRY set and not the
  // presence of SHORE_*, which has carried a sand beach for as long as it has
  // existed.
  const regraded = SHORE_MASONRY.some(familyComplete);
  let banks = 0;
  for (const grp of Object.keys(SHORE_BANK)) {
    const base = SHORE_BANK[grp].find((b) => (b !== SHORE_GENERIC || regraded) && familyComplete(b));
    if (!base) continue;
    const slot = fringeSlot(base);
    if (!slot) continue;
    SHORE_SLOT[grp] = slot;
    banks++;
  }
  // Open water only: SHORE_* are already members of a set and RIVER_BEND is a
  // hand-drawn corner that carries its own bank.
  if (banks) {
    for (const key of ['WATER', 'WATER_DEEP', 'SWAMP_WATER']) {
      const id = T[key];
      if (id != null && !FRINGE_KIND[id]) FRINGE_KIND[id] = 2;
    }
  }
  // The island patches, resolved per id so the draw loop never calls out. A
  // lookup that answers 0, an unknown id, or something that is not ground gets
  // no entry, which puts that tile straight back on today's behaviour. Deliber-
  // ately NOT gated on FRINGE_KIND: COBBLE has neither a member set nor a group
  // this pass composites, so its 4 lone squares are only reachable this way.
  if (isleOfId) {
    for (const key of Object.keys(T)) {
      const id = T[key];
      if (id == null || tileLayer(id) !== 'ground' || (tileFlags(id) & TF.SOLID)) continue;
      let isle = 0;
      try { isle = isleOfId(id) | 0; } catch { isle = 0; }
      if (!isle || isle === id) continue;
      if (tileKeyOf(isle) === 'VOID' || tileLayer(isle) !== 'ground') continue;
      if (isAnimated(isle)) continue;         // a patch that stops in the wind
      ISLE_OF[id] = isle;
    }
  }
}

/**
 * Rule 2 and the within-group order, as one predicate: may a tile of `theirs`
 * paint a verge into a tile of `mine`? `mineGrp` / `theirGrp` are the coarse
 * groups, which rule 2 still needs — masonry is a property of the group, not of
 * however finely the key happens to split it today.
 */
function vergeAccepts(mine, theirs, mineGrp, theirGrp) {
  if (!theirs || theirs === mine) return false;
  if (isPaved(mine, mineGrp) && isPaved(theirs, theirGrp)) return false;
  // Turf. The only invader that crosses a group boundary, exactly as before.
  if (VERGE_INVADER.has(theirs)) return true;
  // Two surfaces of one material. Same group, both ranked, higher rank wins —
  // and SYN_GROUPS because this verge is composited, so it may only be asked for
  // on ground the compositor is allowed to touch.
  if (!mineGrp || mineGrp !== theirGrp || !SYN_GROUPS.has(mineGrp)) return false;
  const a = SOFT_RANK[mine], b = SOFT_RANK[theirs];
  return a !== undefined && b !== undefined && b > a;
}

/** True when `theirs` invading `mine` is a change of surface, not of terrain. */
function sameFamilyVerge(mine, theirs, mineGrp, theirGrp) {
  return !!mineGrp && mineGrp === theirGrp && !VERGE_INVADER.has(theirs);
}

// ---------------------------------------------------------------------------
// 4c. THE SYNTHETIC VERGE — the same idea for a family with no member set
// ---------------------------------------------------------------------------
//
// Only DIRT and DIRT_PATH have hand-painted verge members, which left 815 ground
// tiles across the 17 maps meeting grass at a ruler-straight tile edge: GRAVEL
// 424, SNOW_GRASS 160, COBBLE 34, MUD 33, FARMLAND 14, and the crops. The snow
// patches in Neverwinter Wood are the loudest — stark white 16x16 squares on
// green, more obviously tile-shaped than anything else outdoors.
//
// The verge those families need is not a new SURFACE, it is the neighbour's turf
// reaching in over the boundary. That does not need art: draw the tile, then
// draw the GRASS TILE THAT IS ACTUALLY NEXT DOOR clipped to a ragged tongue
// along the shared edge. The invading pixels are the real neighbouring tile, so
// the colour is right by construction and stays right if the grass is ever
// regraded, and the boundary now wanders 1-7px instead of sitting on the 16px
// line.
//
// The tongue profile is the same wander render/tiles.js uses in verge(): a depth
// that steps by a pixel now and then, clamped to 1-7, plus tufts one and two
// pixels further in that break the line into stipple rather than ending it in a
// crease. Eight profiles per side are built once as Path2D and picked by
// tileHash(wx, wy) — a pure function of world position, so a tile's verge is
// identical in every frame and between runs, and nothing shimmers.
//
// This is strictly a FALLBACK. A family that owns real members (FRINGE_KIND 1)
// never reaches it, so hand-painted art always wins and adding GRAVEL_N…NW to
// render/tiles.js retires the synthetic version for gravel automatically.
//
// Water is deliberately excluded. A river 1-2 tiles wide cannot afford to lose
// 1-7px of channel to each bank — that is how the backed-out shore broke
// Neverwinter Wood into disconnected pools. The waterline stays with SHORE_BANK.
//
// AND IT IS COMPOSITED ONCE, NOT PER FRAME. Clipping to a ragged path is not a
// rect clip, so Skia takes the slow route through a mask layer: measured live in
// Chrome on the Wave Echo cave mouth (240 synthetic tiles, ~40 in view) it cost
// 57.7 -> 41.3 fps. So each verged cell is drawn once into its own 16x16 canvas
// and afterwards blitted like any other tile — exactly what render/tiles.js does
// with its own rasters. The cache hangs on the map beside _fringeMask and is
// dropped in bindMap; a cell is only built when it is first actually drawn, so
// the far side of a big map costs nothing until you walk there.

/** Groups that plausibly take a turf verge. Floors, bridges and water do not. */
const SYN_GROUPS = new Set(['dirt', 'road', 'snow', 'sand', 'crop']);

/**
 * Reserved high nibble meaning "no member set — build the verge from the
 * neighbour". Rule 3 still applies here: an island gets no verge at all. A
 * shallower one was tried and measured — even a 1-3px nibble on all four sides
 * of a 16px tile leaves 58.85% of it, which is inside the 42-62% band the audit
 * flagged as the defect in the first place. A lone snow patch that should not
 * read as a square wants a tile of its own in render/tiles.js, not a clip path.
 */
const SYN_SLOT = 15;

const SYN_BUCKETS = 8;
/** [side * SYN_BUCKETS + bucket] -> Path2D. Built once, never per frame. */
const SYN_PATHS = [];
let synReady = false;

/** Small deterministic LCG. Never Math.random: a verge may not change per frame. */
function synRng(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * One rect of the tongue, in tile-local pixels. `along` runs down the shared
 * edge, `from` is the distance already eaten inwards and `depth` how much more.
 */
function synRect(p, side, along, from, depth) {
  if (side === 0) p.rect(along, from, 1, depth);                 // N
  else if (side === 1) p.rect(16 - from - depth, along, depth, 1); // E
  else if (side === 2) p.rect(along, 16 - from - depth, 1, depth); // S
  else p.rect(from, along, depth, 1);                            // W
}

function initSynPaths() {
  if (synReady) return;
  synReady = true;
  if (typeof Path2D === 'undefined') return;   // no Path2D: the fallback stays off
  for (let side = 0; side < 4; side++) {
    for (let b = 0; b < SYN_BUCKETS; b++) {
      const p = new Path2D();
      const r = synRng(side * 131 + b * 17 + 7);
      let d = 3 + Math.floor(r() * 3);
      for (let a = 0; a < 16; a++) {
        if (r() < 0.38) d += r() < 0.5 ? 1 : -1;
        d = Math.max(1, Math.min(7, d));
        synRect(p, side, a, 0, d);                       // the solid tongue
        if (r() < 0.34) synRect(p, side, a, d, 1);       // a tuft one deeper
        if (r() < 0.14) synRect(p, side, a, d + 1, 1);   // and one further still
      }
      SYN_PATHS[side * SYN_BUCKETS + b] = p;
    }
  }
}

/** Ceiling on composited cells per map. ~1KB each; no map comes near it. */
const SYN_CACHE_CAP = 1024;

/** One step of a plan: a family member, optionally clipped to part of the tile. */
function fringeStep(base, sides, clip) {
  const t = T[`${base}_${sides}`];
  return t == null ? null : { id: t, clip: clip || null };
}

/**
 * Turn a cardinal mask into the list of draws that fringes every differing side.
 *
 * One side, or two adjacent, is a single family member. Two opposite sides or
 * three split the tile down the middle: the first draw carries the verges of one
 * half, the second is clipped to the other half and carries the rest. Four sides
 * — an island of dirt in a field — draws the four corner members, each clipped
 * to the quadrant whose two edges it owns, so no verge is overpainted. Every
 * member paints the same road surface from the same recipe, so a split leaves no
 * seam: only the verges differ.
 */
function buildFringePlan(base, card) {
  const on = [];
  for (let i = 0; i < 4; i++) if (card & (1 << i)) on.push(FR_SIDES[i]);
  const has = (s) => on.indexOf(s) >= 0;
  const steps = [];
  const push = (sides, clip) => { const s = fringeStep(base, sides, clip); if (s) steps.push(s); };

  if (on.length === 1) push(on[0]);
  else if (on.length === 2) {
    if (has('N') && has('S')) { push('N'); push('S', FR_BAND.S); }
    else if (has('E') && has('W')) { push('W'); push('E', FR_BAND.E); }
    else push((has('N') ? 'N' : 'S') + (has('E') ? 'E' : 'W'));   // NE SE SW NW
  } else if (on.length === 3) {
    // The odd side out pairs with each end of the opposite pair; the second
    // pairing is clipped to the half of the tile its end of the pair faces.
    const odd = has('N') && has('S') ? (has('E') ? 'E' : 'W') : (has('N') ? 'N' : 'S');
    const [a, b] = (odd === 'E' || odd === 'W') ? ['N', 'S'] : ['E', 'W'];
    push(odd === 'N' || odd === 'S' ? odd + a : a + odd);
    push(odd === 'N' || odd === 'S' ? odd + b : b + odd, FR_BAND[b]);
  } else if (on.length === 4) {
    push('NW', FR_QUAD.NW); push('NE', FR_QUAD.NE);
    push('SE', FR_QUAD.SE); push('SW', FR_QUAD.SW);
  }
  return steps.length ? steps : null;
}

/**
 * plan[memberSetName][card], built once per (set, mask) and then only ever read.
 * Keyed by the member-set NAME rather than the tile id, so water drawing from
 * SHORE_GRASS and water drawing from SHORE_STONE share nothing and neither
 * rebuilds. A plain object: the draw loop only ever does a property read.
 */
const FRINGE_PLANS = Object.create(null);
function fringePlan(base, card) {
  let byCard = FRINGE_PLANS[base];
  if (!byCard) {
    byCard = FRINGE_PLANS[base] = new Array(16).fill(null);
    for (let c = 1; c < 16; c++) byCard[c] = buildFringePlan(base, c);
  }
  return byCard[card];
}

/** rgba('0,0,0') strings, built once — the draw loop never makes a string. */
const INK = [];
function ink(a) {
  const k = Math.round(clamp(a, 0, 1) * 200);
  let s = INK[k];
  if (!s) { s = INK[k] = `rgba(6,5,10,${(k / 200).toFixed(3)})`; }
  return s;
}

/**
 * Half-widths of a filled pixel ellipse, one entry per row, memoised by size.
 * Rows run from -ry to ry-1 relative to the centre, so a 2-high shadow is two
 * rows and not three-and-a-half.
 */
const ELLIPSES = new Map();
function ellipseRows(rx, ry) {
  const key = rx * 64 + ry;
  let rows = ELLIPSES.get(key);
  if (rows) return rows;
  rows = new Int16Array(ry * 2);
  for (let i = 0; i < ry * 2; i++) {
    const dy = i - ry + 0.5;
    const k = 1 - (dy * dy) / (ry * ry);
    rows[i] = k <= 0 ? 0 : Math.max(1, Math.round(rx * Math.sqrt(k)));
  }
  ELLIPSES.set(key, rows);
  return rows;
}

/** One filled pixel ellipse as horizontal runs. Caller owns fillStyle. */
function fillEllipse(ctx, cx, cy, rx, ry) {
  const rows = ellipseRows(rx, ry);
  for (let i = 0; i < rows.length; i++) {
    const hw = rows[i];
    if (hw > 0) ctx.fillRect(cx - hw, cy - ry + i, hw * 2, 1);
  }
}

/**
 * How wide a footprint an entity has, in pixels, memoised per sprite family.
 * `spriteSize` allocates, so it is called once per sprite name in the whole run
 * and never again.
 */
const FOOT_W = new Map();
function footWidth(e) {
  const ch = e.char;
  const name = (ch && ch.sprite) || e.sprite || null;
  let w;
  if (name) {
    w = FOOT_W.get(name);
    if (w === undefined) {
      w = hasSprite(name) ? spriteSize(name).w : (ch ? SPRITE_W : 0);
      FOOT_W.set(name, w);
    }
  } else if (ch) {
    w = SPRITE_W;                    // a layered actor composites to 16 wide
  } else {
    w = TILE - 3;                    // a chest, a barrel: drawn from tile art
  }
  return w || SPRITE_W;
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
    this.spellMarkers = [];       // fieldworld.addMarker: Locate Object's pins
    this.hotbar = new Hotbar();   // the bottom strip: every verb, visible, clickable
    this._slots = [];             // quick-slot model, rebuilt a couple of times a second
    this._slotT = 0;
    this._restOff = null;

    // Depth passes. `_sun` is refreshed once per frame in draw(); the scratch
    // buffers below are grown on first use and then reused forever, so the
    // per-tile and per-entity loops never allocate.
    this._sun = 1;                // cast-shadow strength, refreshed each frame
    this._ao = 1;                 // ambient-occlusion strength, ditto
    this._mx = null; this._my = null; this._mb = null;   // visible masked tiles
    this._sx = null; this._sy = null; this._sr = null;   // contact shadow centres
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

    // loadMapById put the written cast on the map; this puts the wilds on it.
    // Here rather than there because it needs the party's level and the clock,
    // and because a cached map must not be re-seeded (the guard is on the map).
    safe(() => this._spawnRoamers(map));

    this._syncPartySprites();
    this._attachParty(map, x, y, dir);

    this.heldDir = null;
    this.turnT = 0;
    this._wasMoving = false;
    this.popup = null;
    this.encounterGrace = Math.max(this.encounterGrace, 1.2);
    this._resetEncounterCounter();

    // A bearing to a chest in Cragmaw Hideout means nothing on the Triboar
    // Trail: spell markers belong to the map they were cast on.
    this.spellMarkers = [];
    this.hud.markers = this.spellMarkers;

    this.hud.setMap(map);
    this._applyWeather(true);
    this._snapCamera();
    map._edgeMask = null;   // rebuilt lazily by _drawEdges for the new place
    map._overMask = null;   // ditto, for what the roofs of this place overhang
    map._tallMask = null;   // and which of its masses are tall enough to cast
    map._overAny = false;
    map._fringeMask = null; // and the road verges of the new place's ground
    map._synTiles = null;   // and the tiles those verges were composited into
    map._synBuilt = 0;
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
      // Locate Object's minimap pin runs on the same clock as everything else
      // the Weave holds up. fieldworld keeps the array; we just sweep it.
      const before = arrOf(this.spellMarkers).length;
      safe(() => expireMarkers(this, st));
      const after = arrOf(this.spellMarkers).length;
      if (after < before) toast('The sending fades.');
      this.hud.markers = this.spellMarkers || null;
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

    // Testing noclip: glide through walls, water and locks. Reuses the ordinary
    // post-step bookkeeping so the party still trails correctly behind you.
    if (CHEATS.noclip) {
      if (!map.inBounds(tx, ty)) return false;
      const fx = this.player.x, fy = this.player.y;
      const t = this.running ? RUN_TIME : WALK_TIME;
      this.player.setTile(tx, ty, dir);
      Party.pushTrail(fx, fy, dir);
      Party.pushTrail(tx, ty, dir);
      this._advanceFollowers(t);
      // setTile arrives instantly, so the tween never transitions moving->still and
      // _settleStep would skip the tile entirely: no warp, no encounter, no step
      // count. Tell it a landing just happened so noclip still triggers the world.
      this._wasMoving = true;
      return true;
    }

    // A locked door blocks before the collision check, so you get told why.
    if (this._blockedByLock(tx, ty)) return false;

    // Magic changes where you can walk. Water Walk and a swim speed open the
    // river, Fly opens everything, Spider Climb takes the cliff. The collision
    // code reads these straight off the entity (Entity.moveOpts), so the whole
    // wiring is: refresh them from the leader's buffs before the step.
    const mv = this._applyMoveMech();

    const fromX = this.player.x, fromY = this.player.y;
    const time = this._stepTime(tx, ty);
    const moved = this.player.step(dir, map, { time, run: this.running });

    if (!moved) {
      // Spider Climb walks the ledge face the wrong way up; the tilemap only
      // exempts fliers, so the wall-walker's step is committed here instead.
      if (mv.wallWalk && this._ledgeWalk(dir, time)) return this._afterStep(fromX, fromY, dir, time);
      // Fly clears a single blocked tile — a fallen pine, a garden wall.
      if (mv.flying && this._hopOver(dir, time)) return this._afterStep(fromX, fromY, dir, time);
      // Walking into a wall: a dull thud, throttled so holding the key isn't a drum.
      if (this._bumpSfxT <= 0) {
        this._bumpSfxT = 0.35;
        safe(() => Audio.sfx('footstep-stone', { vol: 0.5, pitch: -9 }));
      }
      return false;
    }

    return this._afterStep(fromX, fromY, dir, time);
  }

  /** The bookkeeping every committed step owes, however it was committed. */
  _afterStep(fromX, fromY, dir, time) {
    // Two trail entries per step is what makes Party.trailFor() line the party up
    // nose-to-tail instead of leaving gaps: push the tile left, then the tile entered.
    Party.pushTrail(fromX, fromY, dir);
    Party.pushTrail(this.player.x, this.player.y, dir);
    this._advanceFollowers(this.player.stepTime || time);

    const [sfx, opts] = footstepFor(this.map, this.player.x, this.player.y);
    safe(() => Audio.sfx(sfx, opts));
    if (this.player.hopping) safe(() => Audio.sfx('shove', { vol: 0.4 }));
    return true;
  }

  /**
   * Copy the leader's merged movement mech onto the walking sprite. Entity's
   * own `moveOpts()` feeds TileMap.canStep, so `flying` and `swimming` are all
   * the collision test needs; `ignoreDifficult` and `wallWalk` are read here.
   */
  _applyMoveMech() {
    const mv = safe(() => movementOpts(Party), null)
      || { flying: false, swimming: false, climb: 0, ignoreDifficult: false };
    const full = safe(() => fieldMech(Party.leader), null) || {};
    this.player.flying = !!mv.flying;
    this.player.swimming = !!mv.swimming;
    this.player.climb = mv.climb | 0;
    this._moveMech = {
      flying: !!mv.flying,
      swimming: !!mv.swimming,
      climb: mv.climb | 0,
      ignoreDifficult: !!mv.ignoreDifficult,
      wallWalk: !!full.wallWalk || !!mv.flying,
    };
    return this._moveMech;
  }

  /**
   * A ledge refused because you were coming at it from below. Spider Climb
   * says otherwise: commit the single step, no drop, no arc.
   */
  _ledgeWalk(dir, time) {
    const map = this.map, p = this.player;
    const v = DIR_VEC[dir];
    if (!v) return false;
    const tx = p.x + v.x, ty = p.y + v.y;
    if (!map.inBounds(tx, ty)) return false;
    if (!safe(() => map.ledgeAt(tx, ty), null)) return false;
    if (map.solidAt(tx, ty, p.moveOpts())) return false;
    if (safe(() => map.entityBlocks(tx, ty, p), false)) return false;
    return this._commitStep(dir, tx, ty, time, 0);
  }

  /** Fly: clear ONE blocked tile and land on the far side of it. */
  _hopOver(dir, time) {
    const map = this.map, p = this.player;
    const v = DIR_VEC[dir];
    if (!v) return false;
    const tx = p.x + v.x * 2, ty = p.y + v.y * 2;
    if (!map.inBounds(tx, ty)) return false;
    if (map.solidAt(tx, ty, p.moveOpts())) return false;
    if (safe(() => map.entityBlocks(tx, ty, p), false)) return false;
    return this._commitStep(dir, tx, ty, time * 1.5, 10);
  }

  /**
   * Move the leader onto a tile Entity.step() would not take it to, using the
   * same tween the ledge hop uses so it looks like one motion, not a teleport.
   */
  _commitStep(dir, tx, ty, time, arcHeight) {
    const p = this.player;
    if (p.moving) return false;
    const ox = p.x, oy = p.y;
    p.bumpT = 0;              // Entity.step already squished it; this step took
    p.dir = dir;
    p.fromX = ox; p.fromY = oy;
    p.x = tx | 0; p.y = ty | 0;
    p.moving = true;
    p.moveT = 0;
    p.stepTime = time;
    p.hopping = arcHeight > 0 ? { h: arcHeight } : null;
    if (p.list) safe(() => p.list.moved(p, ox, oy));
    safe(() => p.onStepStart && p.onStepStart({ x: p.x, y: p.y }, this.map));
    return true;
  }

  /** Difficult terrain drags; running is quick; a ledge hop is handled by Entity. */
  _stepTime(tx, ty) {
    let time = this.running ? RUN_TIME : WALK_TIME;
    const f = this.map.flagAt(tx, ty);
    const mech = this._moveMech || {};
    // Freedom of Movement and Water Walk both ignore difficult terrain, and a
    // flier never touches it at all.
    const easy = mech.ignoreDifficult || mech.flying;
    if ((f & TF.SLOW) && !easy) time *= SLOW_FACTOR;
    // Wading. Water Walk skims it; a swim speed still means swimming.
    if (f & TF.WATER) {
      if (mech.flying) time *= 1;
      else if (mech.ignoreDifficult) time *= 1;
      else time *= SLOW_FACTOR;
    }
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

    // No key: the picks get a go before the door is simply "locked fast". The
    // trigger's own data IS the lock (fieldworld reads dc / arcaneLocked /
    // _pickedDay off whatever object it is handed), so one attempt a day is
    // recorded on the trigger and survives walking away and coming back.
    if (this._bumpSfxT <= 0) {
      this._bumpSfxT = 0.6;
      d.dc = d.dc || lockDC(d);
      const pick = this._pickLock(d);
      if (pick.ok) {
        d.locked = false;
        safe(() => Audio.sfx('door'));
        return false;
      }
      if (!pick.tried) {
        safe(() => Audio.sfx('error'));
        this._say(d.lockedText || (keyId ? 'It is locked. Something opens this.' : `It is locked fast. ${pick.text || ''}`.trim()));
      }
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

  /**
   * How much the player's "Random Ambushes" setting scales the map's own rate.
   * `off` disables grass ambushes entirely — the wilds are then populated by
   * visible wandering foes you can see coming and walk around instead.
   */
  _encounterScale() {
    if (CHEATS.noEncounters) return 0;
    const mode = safe(() => Save.settings.wildEncounters, 'off');
    let scale;
    switch (mode) {
      case 'off': return 0;
      case 'rare': scale = 0.22; break;
      case 'frequent': scale = 1.0; break;
      case 'normal': default: scale = 0.5; break;
    }
    // Magic laid over the land itself: Guards and Wards shuts a place to
    // wandering things entirely, Move Earth smooths the road, Mirage Arcane
    // hides the party's line of travel. Returns 0..1, and 1 when none is up.
    return scale * this._partyStealthFactor() * this._clearedFactor()
      * safe(() => terrainEncounterFactor(state(), this.map && this.map.id), 1);
  }

  /**
   * How much the party's own magic thins the wilds. Pass Without Trace leaves
   * nothing to follow; an invisible leader is not seen at all. fieldworld's
   * encounterFactor also folds in mounts and travel-speed buffs, so take
   * whichever of the two is kinder to the player.
   */
  _partyStealthFactor() {
    let f = safe(() => encounterFactor(Party), 1);
    if (!Number.isFinite(f) || f <= 0) f = 1;
    if (!Party.members.length) return f;
    // mech.noTracks is what data/spells_low.js puts on Pass Without Trace;
    // Invisibility is a CONDITION, so it is read through conditionMech.
    for (const m of Party.members) {
      if (!m) continue;
      if (arrOf(m.effects).some((e) => e && e.mech && e.mech.noTracks)) f = Math.min(f, 0.25);
      if (safe(() => conditionMech(m).invisible, false)) f = Math.min(f, 0.5);
    }
    return clamp(f, 0.1, 1);
  }

  /** A region the party has thinned out is quieter — see _markCleared(). */
  _clearedFactor() {
    const st = state();
    if (!st || !this.map) return 1;
    const rec = st.cleared && st.cleared[this.map.id];
    if (!rec || (rec.count | 0) < CLEARED_AT) return 1;
    if ((st.day || 0) - (rec.day || 0) >= CLEARED_DAYS) {
      // The wilds have filled back in; start the tally again.
      delete st.cleared[this.map.id];
      return 1;
    }
    return CLEARED_RATE;
  }

  /**
   * Count one wilderness victory against this map. The fourth quiets the road
   * for CLEARED_DAYS days; the toast is the only notice the player gets, so it
   * fires exactly once, on the fight that tipped it over.
   */
  _markCleared() {
    const st = state();
    const map = this.map;
    if (!st || !map || map.indoor || map.safe || isTownMap(map, map.id)) return;
    if (!map.encounterRate && !map.encounterTable) return;   // nothing lived here anyway
    st.cleared = st.cleared || {};
    const rec = st.cleared[map.id] || { count: 0, day: st.day || 0 };
    if ((st.day || 0) - (rec.day || 0) >= CLEARED_DAYS) rec.count = 0;
    rec.count = (rec.count | 0) + 1;
    rec.day = st.day || 0;
    st.cleared[map.id] = rec;
    if (rec.count === CLEARED_AT) {
      toast('The road is quiet.');
      this._resetEncounterCounter();
    }
  }

  // --- the situation a fight starts in -------------------------------------

  /** Which of the six parts of the day it is; buildBattleMap grades on this. */
  _phase() {
    const st = state();
    return st ? timeOfDay(st.time) : 'morning';
  }

  /** True after dusk and before dawn — what rollEncounter calls `night`. */
  _isNight() {
    return this._phase() === 'night';
  }

  /**
   * The weather as the RULES name it. `_weatherKind` holds the FX particle name
   * ('none' for clear), which is not the same vocabulary, so read the source.
   */
  _weatherNow() {
    const st = state();
    if (!this.map || this.map.indoor) return 'clear';
    return String(this.map.weather || (st && st.weather) || 'clear');
  }

  /** The best passive Perception in the walking party. */
  _partyPassive() {
    let best = 10;
    for (const m of Party.members) {
      if (!m || m.hp <= 0) continue;
      best = Math.max(best, safe(() => skillMod(m, 'perception').passive, 10) || 10);
    }
    return best;
  }

  /**
   * Who saw whom first. Monster Stealth (plus the biome, the dark and the fog)
   * against the party's best passive Perception; five clear either way decides
   * it. `true` surprises the party, `'party'` surprises the foes.
   */
  _ambushFor(monsters, opts = {}) {
    const res = safe(() => ambushContest({
      monsters,
      passive: this._partyPassive(),
      biome: opts.biome || (this.map && this.map.biome) || 'plains',
      night: !!opts.night,
      weather: opts.weather || 'clear',
      rng: makeRNG(`${opts.seed || 'amb'}:ambush`),
    }), null);
    return res ? res.ambush : false;
  }

  _resetEncounterCounter(rate) {
    const scale = this._encounterScale();
    if (scale <= 0) { this.stepsToEncounter = Infinity; return; }
    const base = clamp(rate != null ? rate : (this.map ? this.map.encounterRate : 0.06), 0.004, 0.9);
    const r = clamp(base * scale, 0.002, 0.9);
    // Even at 'frequent' this is a good deal calmer than it used to be.
    this.stepsToEncounter = Math.max(18, Math.round(rng.float(0.9, 2.6) / r));
  }

  /** Count down on encounter tiles; at zero, the tall grass rustles. */
  _tickEncounter(x, y) {
    if (this.encounterGrace > 0) return false;
    if (this._encounterScale() <= 0) return false;      // ambushes switched off
    const map = this.map;
    const info = safe(() => map.encounterAt(x, y), null);
    if (!info || !info.rate) return false;

    if (!Number.isFinite(this.stepsToEncounter)) this._resetEncounterCounter(info.rate);
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

    // The map names its own table (Cragmaw scouts on the Triboar Trail, ghouls in
    // the Fields of the Dead); the clock and the sky decide who is out in it.
    const table = info.table || (this.map && this.map.encounterTable) || null;
    const night = this._isNight();
    const weather = this._weatherNow();

    const roll = safe(() => rollEncounter({
      biome, level, size: Math.max(1, Party.members.length), seed, depth,
      difficulty: info.difficulty || undefined,
      table, night, weather,
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

    // Being jumped from behind is not a coin toss any more: the pack's Stealth
    // against the party's passive Perception, and the party can win it.
    const ambush = this._ambushFor(roll.monsters, { biome, night, weather, seed });
    return this._pushBattle(roll.monsters, {
      seed, biome, depth, ambush, boss: !!roll.boss,
      difficulty: roll.difficulty, table, night, weather, roll,
    });
  }

  // --- visible wandering packs ---------------------------------------------

  /**
   * Seed a wilderness map with packs you can SEE — the half of the encounter
   * design the grass ambush is not. Each entity stands for a whole rolled
   * encounter (its `monsters` list is what you actually fight), and brings one
   * to three pack-mates who converge when the leader spots you.
   *
   * Runs once per map per session; a pack you beat records the day it fell and
   * is back on the road three days later.
   */
  _spawnRoamers(map) {
    if (!map || map._roamersSeeded) return 0;
    map._roamersSeeded = true;

    if (safe(() => Save.settings.roamingMonsters, true) === false) return 0;
    if (CHEATS.noCombat || CHEATS.noEncounters) return 0;
    if (map.indoor || map.safe || isTownMap(map, map.id)) return 0;
    if (!map.encounterRate && !map.encounterTable) return 0;   // nothing lives here
    if (typeof map.addEntity !== 'function') return 0;

    const st = state();
    const level = Party.levelAvg();
    const depth = (st && st.depth && st.depth[map.id]) || 0;
    const biome = map.biome || 'plains';
    const night = this._isNight();
    const weather = this._weatherNow();
    const r = makeRNG(`${worldSeed()}:${map.id}:roamers`);
    const away = map.spawn || { x: map.w >> 1, y: map.h >> 1 };
    const packs = r.int(ROAMERS_MIN, ROAMERS_MAX);
    let made = 0;

    for (let i = 0; i < packs; i++) {
      const roll = safe(() => rollEncounter({
        biome, level, size: Math.max(1, Party.members.length), depth,
        seed: `${worldSeed()}:${map.id}:roamer:${i}`,
        table: map.encounterTable || null, night, weather,
      }), null);
      const pack = roll && Array.isArray(roll.monsters) ? roll.monsters.filter((m) => m && m.id) : [];
      if (!pack.length) continue;

      const spot = this._roamerSpot(map, r, away);
      if (!spot) continue;

      const lead = pack.find((m) => m.boss) || pack[0];
      const packId = `${map.id}:pack:${i}`;
      const leader = this._makeRoamer(map, lead.id, spot, {
        // The WHOLE pack rides on the leader, so _doTriggerBattle fights the
        // encounter that was rolled instead of inventing copies of one id.
        monsters: pack.map((m) => ({ id: m.id, count: Math.max(1, m.count | 0 || 1) })),
        groupId: roll.groupId || null,
        level, count: Math.max(1, lead.count | 0 || 1),
        boss: !!roll.boss, packId,
        roll: { groupId: roll.groupId || null, name: roll.name || null, difficulty: roll.difficulty || null },
        defeatedKey: `${map.id}:roamer:${i}`,
        respawnDays: ROAMER_RESPAWN_DAYS,
        ambush: roll.ambush === true,
      });
      if (!leader) continue;
      made++;

      // Satellites: the rest of the pack, milling about nearby. They hand any
      // fight back to the leader (MonsterEntity.interact), so the pack is
      // fought once, whole, and falls together.
      const mates = r.int(1, 3);
      for (let s = 0; s < mates; s++) {
        const id = r.pick(pack).id;
        const nx = spot.x + r.int(-2, 2), ny = spot.y + r.int(-2, 2);
        if (!map.inBounds(nx, ny) || map.solidAt(nx, ny)) continue;
        if (map.entities.some((e) => e && e.x === nx && e.y === ny && e.solid)) continue;
        this._makeRoamer(map, id, { x: nx, y: ny }, {
          level, packId, satellite: true, aggro: true,
          defeatedKey: `${map.id}:roamer:${i}:${s}`,
          respawnDays: ROAMER_RESPAWN_DAYS,
        });
      }
    }
    return made;
  }

  /** One MonsterEntity, dressed from its stat block, added to the map. */
  _makeRoamer(map, monsterId, spot, opts = {}) {
    const block = safe(() => getMonster(monsterId), null);
    const e = safe(() => makeEntity({
      cls: 'monster',
      x: spot.x, y: spot.y, home: { x: spot.x, y: spot.y },
      monsterId,
      name: (block && block.name) || titleCase(String(monsterId).replace(/-/g, ' ')),
      sprite: (block && block.sprite) || monsterId,
      size: block && block.size === 'large' ? 2 : 1,
      sight: opts.satellite ? 5 : 7,
      leash: 14,
      wander: 3,
      ...opts,
    }), null);
    if (!e) return null;
    safe(() => map.addEntity(e));
    return e;
  }

  /**
   * Somewhere to put a pack: walkable, at least ROAMER_CLEAR tiles from where
   * the party arrives, and off the road if the map offers anywhere else — the
   * road is the safe way through, and it should read that way.
   */
  _roamerSpot(map, r, away) {
    let offRoadless = null;
    for (let i = 0; i < 40; i++) {
      const s = safe(() => map.randomWalkable(r, {
        avoidTriggers: true, away, awayDist: ROAMER_CLEAR,
      }), null);
      if (!s) continue;
      if (map.flagAt(s.x, s.y) & TF.DAMAGE) continue;
      if (!offRoadless) offRoadless = s;
      if (safe(() => tileGroup(map.at('ground', s.x, s.y)), null) === 'road') continue;
      return s;
    }
    return offRoadless;
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
    // Peaceful mode: every route into a fight comes through here — random
    // ambushes, roaming monsters and scripted encounters alike — so one check
    // covers all of them. The foes simply decline.
    if (CHEATS.noCombat) {
      toast('They size you up, and decide against it.');
      this.encounterGrace = ENCOUNTER_GRACE;
      return false;
    }

    const combat = LATE.combat, cui = LATE.combatui;
    if (!combat || typeof combat.buildEncounter !== 'function' || !cui || !cui.BattleScene) {
      toast('They think better of it and slink away.');
      this.encounterGrace = ENCOUNTER_GRACE;
      return false;
    }

    const st = state();
    const night = opts.night != null ? !!opts.night : this._isNight();
    const weather = opts.weather || this._weatherNow();
    const foes = enemies.reduce((n, e) => n + Math.max(1, (e && e.count) | 0 || 1), 0);

    // The arena is a copy of the ground you were standing on, lit by the same
    // sky. sourceMap/sourceX/sourceY are what make the fight happen HERE.
    const arena = safe(() => buildBattleMap({
      biome: opts.biome || this.map.biome || 'plains',
      seed: opts.seed, indoor: this.map.indoor, ambush: opts.ambush || false,
      boss: !!opts.boss, depth: opts.depth || 0,
      sourceMap: this.map, sourceX: this.player.x, sourceY: this.player.y,
      night, phase: this._phase(), weather,
      dark: this.map.dark || 0,
      party: Party.members.slice(0, PARTY_MAX),
      foes,
    }), null);

    const enc = safe(() => combat.buildEncounter({
      party: Party,
      enemies,
      map: arena,
      seed: opts.seed,
      biome: opts.biome || this.map.biome,
      // 'party' means the FOES are the ones caught out; combat.js reads it.
      ambush: opts.ambush || false,
      boss: !!opts.boss,
      depth: opts.depth || 0,
      difficulty: opts.difficulty,
      night, weather,
      bag: Party.inventory,
      onLog: (entry) => { if (entry && entry.text) bus.emit(EV.LOG, { text: entry.text, kind: entry.kind }); },
    }), null);

    if (!enc) {
      toast('The fight never comes.');
      this.encounterGrace = ENCOUNTER_GRACE;
      return false;
    }

    // stats.battles is counted centrally in main.js on EV.COMBAT_START, so every
    // route into a fight — here, a dialogue script, the rest screen, the cheat
    // menu — is counted exactly once. Counting it again here would double it.
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
    const fled = !!(res && (res.fled || res.state === 'fled'));
    const defeat = !!(res && (res.defeat || res.state === 'defeat'));

    if (source && source.defeat) {
      if (victory) safe(() => source.defeat());
      else safe(() => source.scatter && source.scatter(10));
    }
    if (victory) {
      this._markCleared();
      safe(() => advanceTime(state(), 10));
      autosave();
    }

    // Running away has to actually put ground between you and them, or the very
    // next step walks straight back into the same pack.
    if (fled) {
      this._retreat();
      this.encounterGrace = Math.max(this.encounterGrace, 14);
    }

    // Losing costs a tithe of the purse — the price of being carried off the
    // field. No warp: whatever the defeat flow already does about where you
    // wake up is the defeat flow's business.
    if (defeat) {
      const tithe = Math.floor((Party.gold || 0) * 0.1);
      if (tithe > 0) {
        safe(() => Party.spendGold(tithe));
        const st2 = state();
        if (st2 && st2.stats) st2.stats.goldSpent = (st2.stats.goldSpent || 0) + tithe;
        toast(`Someone went through your purse: ${tithe} gp lighter.`);
      } else {
        toast('They leave you where you fell. There was nothing worth taking.');
      }
    }
    Input.flush();
  }

  /**
   * Fall back three or four tiles the way you came. Party.trail is the leader's
   * own footprints (two entries per step), so walking back down it always lands
   * somewhere that was walkable a moment ago; failing that, head for the spawn.
   */
  _retreat(tiles = 0) {
    const map = this.map;
    if (!map) return false;
    const want = tiles || rng.int(3, 4);
    let spot = null;

    const trail = arrOf(Party.trail);
    for (let i = want * 2; i < trail.length; i++) {
      const t = trail[i];
      if (!t || !map.inBounds(t.x, t.y)) continue;
      if (map.solidAt(t.x, t.y, this.player.moveOpts())) continue;
      if (Math.max(Math.abs(t.x - this.player.x), Math.abs(t.y - this.player.y)) < 2) continue;
      spot = t;
      break;
    }
    if (!spot && map.spawn) spot = safe(() => map.nearestWalkable(map.spawn.x, map.spawn.y, 8), null);
    if (!spot) return false;

    this.player.setTile(spot.x, spot.y, spot.dir || this.player.dir);
    Party.resetTrail(spot.x, spot.y, this.player.dir);
    this._updateFollowers();
    this._snapCamera();
    const st = state();
    if (st) { st.x = spot.x; st.y = spot.y; st.dir = this.player.dir; }
    if (this.entities) this.entities.player = { x: spot.x, y: spot.y };
    // Anything that was chasing loses the scent for a while.
    for (const e of arrOf(this.entities && this.entities.list)) {
      if (e && e.kind === 'monster' && typeof e.scatter === 'function') safe(() => e.scatter(12));
    }
    toast('You break off and fall back.');
    return true;
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
        // A quick slot is for the spell you fire without thinking. Teleport
        // and Creation have to ask you something first, so from a hotbar key
        // they can only say "open the spellbook" — which is not a quick slot,
        // it is a wasted one.
        if (safe(() => fieldNeedsChoice(id), false)) continue;
        const sp = safe(() => getSpell(id), null) || {};
        // Nor is Revivify a quick slot while everyone is on their feet.
        if (arrOf(sp.effects).some((e) => String((e && e.tag) || '').toLowerCase() === 'raise-dead')
          && !Party.all().some((p) => p && isDeadMember(p))) continue;
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

  /**
   * The bundle, assembled by rules/fieldworld.js and then re-dressed here.
   *
   * fieldworld.fieldHooks(scene, party, state) already implements every verb
   * against this scene — the locked chest, the fog of war, the person you are
   * facing. What it cannot do is make a noise or throw a ring of light, so the
   * five names fieldcast.js has always called are wrapped below to add the
   * presentation, and the rest are passed straight through.
   *
   * NOTHING here may rename an existing hook: rules/fieldcast.js calls
   * `light`, `unlock`, `detect`, `reach` and `identify` by those names.
   */
  spellHooks() {
    const base = safe(() => fieldHooks(this, Party, state()), null) || {};
    const hooks = {
      ...base,

      // --- the five fieldcast.js has always called ---------------------------
      light: (radius, spellId, minutes, mech) => this._spellLight(radius, spellId, minutes, mech),
      unlock: (range) => this._spellUnlock(range),
      detect: (what, range) => this._spellDetect(what, range),
      reach: (limitLb) => this._spellReach(limitLb),
      identify: (all) => this._spellIdentify(all),

      // --- the verbs fieldworld added, with their own presentation ----------
      locate: (what, minutes) => this._spellLocate(what, minutes),
      reveal: (r, all) => this._spellReveal(r, all),
      omen: (opts) => this._spellOmen(opts),
      charm: (opts) => this._spellCharm(opts),
      lock: (dcBonus) => this._spellLock(dcBonus),
      ward: (minutes) => this._spellWard(minutes),
      sanctuary: (minutes, name) => this._spellSanctuary(minutes, name),
      findTraps: (range) => this._spellFindTraps(range),
      disarm: (entity) => this._disarmTrap(entity || this._facingChest()),
      pickLock: (entity) => this._pickLock(entity || this._facingChest()),
    };
    // readMind is the camelCase name fieldworld uses; the spell tag is
    // hyphenated, so answer to both rather than making the caller guess.
    hooks.readMind = (mode) => this._spellReadMind(mode);
    hooks['read-mind'] = hooks.readMind;
    hooks.alarm = hooks.ward;
    return hooks;
  }

  /** Light / Dancing Lights / Daylight: a pool that follows the party. */
  _spellLight(radius, spellId, minutes, mech) {
    const st = state();
    // fieldcast currently calls light(radius, id, minutes) with no mech, so
    // Daylight's `dispelsDarkness` would never arrive. Read it off the spell.
    const m = mech || safe(() => {
      const sp = getSpell(spellId);
      const eff = sp && (sp.effects || []).find((e) => e && e.tag === 'light');
      return (eff && eff.mech) || null;
    }, null);
    const res = safe(() => castLightField(this, st, radius, spellId, minutes, m || {}), null);
    if (!res) return { ok: false };
    safe(() => FX.ring(this.player.px, this.player.py - 8, 14, res.sunlight ? '#fff3c4' : '#ffe9a6', 0.5));
    if (res.sunlight) toast('True sunlight. The dark gives ground.');
    return res;
  }

  /** Knock: the nearest locked thing within sixty feet gives up. */
  _spellUnlock(range) {
    const res = safe(() => unlockNearest(this, state(), range || 12), null)
      || { ok: false, text: 'Nothing within reach is locked.' };
    if (res.ok) {
      safe(() => Audio.sfx('open'));
      const t = res.target;
      if (t && Number.isFinite(t.x)) {
        safe(() => FX.ring(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2, 18, '#ffd24a', 0.5));
      }
    }
    return res;
  }

  /** Arcane Lock: the chest or door you are touching seals itself. */
  _spellLock(dcBonus) {
    const res = safe(() => lockNearest(this, dcBonus != null ? dcBonus : 10), null)
      || { ok: false, text: 'There is nothing here to lock.' };
    if (res.ok) safe(() => FX.ring(this.player.px, this.player.py - 8, 16, '#6aa8e8', 0.5));
    return res;
  }

  /** Detect Magic / Detect Evil and Good: what is within thirty feet. */
  _spellDetect(what, range) {
    const res = safe(() => detectField(this, what || 'magic', range || 6), null) || { count: 0 };
    if (res.count) safe(() => FX.ring(this.player.px, this.player.py - 8, 40, '#b07af0', 0.7));
    return res;
  }

  /** Locate Object / Locate Creature: a bearing plus a minimap marker. */
  _spellLocate(what, minutes) {
    const res = safe(() => locate(this, state(), what || 'object', minutes != null ? minutes : 10), null)
      || { ok: false, text: 'Nothing of the kind answers.' };
    if (res.ok) {
      safe(() => Audio.sfx('spell'));
      if (res.text) toast(res.text);
    }
    return res;
  }

  /** Clairvoyance / Find the Path / Commune with Nature: lift the fog. */
  _spellReveal(r, all) {
    const st = state();
    const n = all
      ? safe(() => revealAll(this, st), 0)
      : safe(() => revealRadius(this, st, this.player.x, this.player.y, r || 8), 0);
    if (n > 0) {
      this._syncDiscovered();
      safe(() => FX.ring(this.player.px, this.player.py - 8, 52, '#7fd0f0', 0.8));
      toast(all ? 'The whole land lies open to you.' : 'The land around you unfolds.');
    }
    return { ok: n > 0, count: n, text: n ? `${n} new tiles come clear.` : 'You already know this ground.' };
  }

  /** Augury / Divination / Commune: a truthful hint about the next step. */
  _spellOmen(opts) {
    const res = safe(() => omen(state(), { level: Party.levelAvg(), ...(opts || {}) }), null)
      || { ok: false, text: 'The omen is silent.' };
    if (res.text) this._say(res.text, 'The Omen');
    return res;
  }

  /** Detect Thoughts / Speak with Dead: what they are not saying. */
  _spellReadMind(mode) {
    const res = safe(() => readMind(this, state(), mode || 'read-mind'), null)
      || { ok: false, text: 'No mind answers.' };
    if (res.ok) { safe(() => Audio.sfx('spell')); toast(res.text); }
    return res;
  }

  /** Charm Person / Suggestion / Calm Emotions on whoever you are facing. */
  _spellCharm(opts) {
    const res = safe(() => charmFacing(this, state(), opts || {}), null)
      || { ok: false, text: 'No one is in front of you.' };
    if (res.ok) {
      safe(() => Audio.sfx(res.resisted ? 'error' : 'buff'));
      safe(() => FX.ring(this.player.px, this.player.py - 8, 20, '#e07ac0', 0.5));
      toast(res.text);
    }
    return res;
  }

  /** Alarm / Glyph of Warding: nothing crosses the camp unheard. */
  _spellWard(minutes) {
    const res = safe(() => wardArea(this, state(), minutes != null ? minutes : 480), null)
      || { ok: false, text: 'The ward will not take.' };
    if (res.ok) { safe(() => FX.ring(this.player.px, this.player.py - 8, 60, '#e3b34a', 0.9)); toast(res.text); }
    return res;
  }

  /** Rope Trick / Meld into Stone: somewhere nothing can reach you. */
  _spellSanctuary(minutes, name) {
    const res = safe(() => makeSanctuary(this, state(), minutes != null ? minutes : 480, name), null)
      || { ok: false, text: 'It will not hold.' };
    if (res.ok) toast(res.text);
    return res;
  }

  /** Find Traps: every trap within range stops being a surprise. */
  _spellFindTraps(range) {
    let n = 0;
    for (const e of arrOf(this.entities && this.entities.list)) {
      if (!e || e.removed || !e.trapped || e.trapDisarmed) continue;
      const d = Math.max(Math.abs(e.x - this.player.x), Math.abs(e.y - this.player.y));
      if (d > (range || 24)) continue;
      if (safe(() => revealTrap(e), false)) n++;
    }
    if (n) {
      safe(() => FX.ring(this.player.px, this.player.py - 8, 44, '#d4553f', 0.7));
      toast(n === 1 ? 'A trap shows itself, plain as a drawn line.' : `${n} traps show themselves.`);
    }
    return { ok: n > 0, count: n, text: n ? `${n} trap${n === 1 ? '' : 's'} revealed.` : 'Nothing here is trapped.' };
  }

  /** Mage Hand: fetch the contents of an unlocked chest from thirty feet. */
  _spellReach(limitLb) {
    // fieldcast passes the spell's carry limit in POUNDS; the range is thirty
    // feet either way, so the argument is noted and the reach is fixed.
    const res = safe(() => reachChest(this, 6), null) || { ok: false };
    if (res.ok && res.payload) this._dispatch(res.payload);
    return { ok: !!res.ok, text: res.text, carried: Number(limitLb) || 10 };
  }

  /** Identify: name the mysteries in the pack. */
  _spellIdentify(all) {
    const n = all ? safe(() => identifyAll(Party), 0) : (safe(() => identifyOne(Party), null) ? 1 : 0);
    if (!n) return { ok: false, text: 'Nothing in the pack is a mystery.' };
    safe(() => Audio.sfx('item'));
    return { ok: true, count: n, text: n === 1 ? 'It gives up its name.' : `${n} things give up their names.` };
  }

  // --- locks and traps, the mundane way ------------------------------------

  /** The chest (or door) the leader is standing in front of, if any. */
  _facingChest() {
    if (!this.entities) return null;
    const f = this.player.frontTile();
    const e = safe(() => this.entities.interactableAt(f.x, f.y), null);
    if (e && (e.kind === 'chest' || e.kind === 'door')) return e;
    return null;
  }

  /**
   * Thieves' tools against the lock's DC — the alternative Knock is supposed
   * to be an alternative TO. One attempt per lock per day; a bad slip jams it.
   */
  _pickLock(entity) {
    if (!entity) return { ok: false, tried: false, text: 'Nothing here is locked.' };
    const res = safe(() => tryPickLock(Party, entity, state()), null)
      || { ok: false, tried: false, text: 'The lock does not give.' };
    // No tools, no hands, already jammed: nothing was ATTEMPTED, so the caller
    // says why rather than the HUD announcing a roll that never happened.
    if (!res.tried) return res;
    if (res.text) toast(res.text);
    safe(() => Audio.sfx(res.ok ? 'open' : 'error'));
    if (res.ok && Number.isFinite(entity.x)) {
      safe(() => FX.ring(entity.x * TILE + TILE / 2, entity.y * TILE + TILE / 2, 14, '#e3b34a', 0.4));
    }
    return res;
  }

  /** Ease the needle out — or set it off in your own hand. */
  _disarmTrap(entity) {
    if (!entity || !entity.trapped) return { ok: false, tried: false, text: 'There is no trap here.' };
    const res = safe(() => tryDisarm(Party, entity, state()), null)
      || { ok: false, tried: false, text: 'You cannot find the catch.' };
    if (res.text) toast(res.text);
    if (res.sprung) this._trapWentOff(entity, res.sprung);
    else safe(() => Audio.sfx(res.ok ? 'open' : 'error'));
    return res;
  }

  /**
   * Passive Perception against the trap's DC before the lid comes up — with
   * five off the score when the party is groping about in the dark, which is
   * what disadvantage on a passive check comes to.
   */
  _spotTrap(entity) {
    if (!entity || !entity.trapped || entity.trapKnown || entity.trapDisarmed) return false;
    const pen = safe(() => perceptionPenalty(this, null, Party), { dis: false }) || {};
    if (!pen.dis) return safe(() => noticeTrap(Party, entity), false);
    let best = 0;
    for (const m of Party.members) {
      if (!m || m.hp <= 0) continue;
      best = Math.max(best, (safe(() => skillMod(m, 'perception').passive, 10) || 10) - 5);
    }
    if (best >= Math.max(10, entity.trapped.dc || 13)) return safe(() => revealTrap(entity), false);
    return false;
  }

  /** The bang, the blood and the shake. */
  _trapWentOff(entity, sprung) {
    if (!sprung) return;
    toast(`It goes off — ${sprung.text}`);
    safe(() => Audio.sfx('hit'));
    safe(() => FX.shake(0.2, 0.25));
    safe(() => FX.burst(entity.x * TILE + TILE / 2, entity.y * TILE + TILE / 2, '#d4553f', 12, {
      shape: 'spark', speed: 70, life: 0.5,
    }));
    if (sprung.dealt && sprung.victim) {
      safe(() => FX.floater(entity.x * TILE + TILE / 2, entity.y * TILE, `-${sprung.dealt}`, '#d4553f'));
    }
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
    // Too late to disarm anything — but a live trap still goes off as it comes
    // up, which is what a trap on a chest is for.
    if (d.opened) {
      this._resolveTrap(chest, { canHold: false });
      return this._grantChest(d);
    }

    // A locked chest wants a key — or a steady hand and a set of picks.
    if (d.locked && !(chest && chest.opened)) {
      const keyId = d.keyId || null;
      if (keyId && Party.hasItem(keyId)) {
        const item = safe(() => resolveItem(keyId), null);
        toast(`${(item && item.name) || 'A key'} fits the lock.`);
        if (chest) chest.locked = false;
      } else {
        // Knock is meant to be an ALTERNATIVE to this, not a shortcut past
        // nothing. lockDC/tryPickLock finally give the authored `dc` a job.
        const pick = this._pickLock(chest || d);
        if (!pick.ok) {
          safe(() => Audio.sfx('error'));
          if (!pick.tried) this._say(`The lid will not lift. It is locked. ${pick.text || ''}`.trim());
          return true;      // a tried-and-failed pick already toasted the roll
        }
        if (chest) chest.locked = false;
      }
      const opened = chest ? this._openChestBody(chest) : null;
      return opened !== null ? opened : this._grantChest(d);
    }

    if (chest && !chest.opened) {
      const done = this._openChestBody(chest);
      if (done !== null) return done;
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

  /**
   * The trap between the party and the loot.
   *
   * entity.js has always authored `trapped: { dc, damage, type }` on chests and
   * nothing ever read it. Now: passive Perception spots it (badly, in the
   * dark), thieves' tools take it out, and a live one goes off on whoever
   * reached for the lid.
   *
   * @param {object} opts  canHold — may this refuse to open the chest at all?
   * @returns {boolean} true when the lid should stay down for now.
   */
  _resolveTrap(chest, { canHold = true } = {}) {
    if (!chest || !chest.trapped || chest.trapDisarmed || chest.trapSprung) return false;

    // First look: did anyone notice before the lid moved?
    if (this._spotTrap(chest)) {
      safe(() => Audio.sfx('cursor'));
      safe(() => FX.ring(chest.x * TILE + TILE / 2, chest.y * TILE + TILE / 2, 12, '#d4553f', 0.4));
      toast(`A ${chest.trapped.type || 'needle'} in the lock plate. Someone saw it in time.`);
    }

    // An unseen trap simply happens.
    if (!chest.trapKnown) {
      this._trapWentOff(chest, safe(() => springTrap(Party, chest, state()), null));
      return false;
    }

    const dis = this._disarmTrap(chest);
    if (dis.ok || dis.sprung) return false;          // dealt with, one way or the other
    if (dis.tried && canHold) {
      // A clean failure: the catch held. Back off and try again.
      this._say('The catch will not give. The lid stays down.');
      return true;
    }
    // Nobody has the tools or the hands for it. Prise it up and take what comes.
    this._trapWentOff(chest, safe(() => springTrap(Party, chest, state()), null));
    return false;
  }

  /**
   * Lift the lid.
   * @returns {boolean|null} null when the caller should carry on itself.
   */
  _openChestBody(chest) {
    if (!chest || chest.opened) return null;
    if (this._resolveTrap(chest, { canHold: true })) return true;
    const res = safe(() => chest.open(), null);
    return this._grantChest(res ? res.data : { entity: chest, chest });
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
        // Wake at 07:00, always by moving the clock FORWARD. Assigning
        // st.time = 420 outright ran the day backwards (21:40 became 15:08 once
        // the eight hours landed) and never rolled st.day, so "Days survived"
        // and every day-gated event stood still through any number of nights.
        if (st && (st.time < 360 || st.time > 660)) {
          safe(() => advanceTime(st, (((420 - st.time) % 1440) + 1440) % 1440));
        }
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
        // Same ordering rule as dialogue.js _heal: the clock moves before
        // EV.REST goes out, so the morning is claimed from the right hour.
        safe(() => advanceTime(state(), hours * 60));
        safe(() => Party.longRest());
        safe(() => Party.healAll());
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
    // A roamer carries the encounter it was rolled from (`monsters`); that is
    // the pack the player has been looking at, so it is the pack they fight.
    for (const e of (d.monsters || d.enemies || [])) {
      if (!e) continue;
      if (typeof e === 'string') enemies.push({ id: e, count: 1 });
      else enemies.push({ id: e.id || e.monsterId, count: e.count || 1, level: e.level, elite: e.elite, boss: e.boss });
    }
    // Only a bare `monsterId` (a scripted tile, a satellite with no leader
    // left) has to guess at a count.
    if (!enemies.length && d.monsterId) {
      enemies.push({
        id: d.monsterId,
        count: Math.max(1, d.count || rng.int(1, 3)),
        level: d.level || null, elite: !!d.elite, boss: !!d.boss,
      });
    }

    const seed = d.seed != null ? String(d.seed)
      : `${worldSeed()}:${this.map.id}:${this.player.x},${this.player.y}:trig`;
    const biome = d.biome || this.map.biome;
    const night = this._isNight();
    const weather = this._weatherNow();

    if (!enemies.length) {
      const roll = safe(() => rollEncounter({
        biome, level: d.level || Party.levelAvg(),
        size: Math.max(1, Party.members.length), seed, depth: d.depth || 0,
        difficulty: d.boss ? 'deadly' : undefined,
        table: d.table || (this.map && this.map.encounterTable) || null,
        night, weather,
      }), null);
      if (roll && roll.monsters) enemies.push(...roll.monsters);
    }
    if (!enemies.length) return false;

    // A scripted fight keeps whatever surprise the script authored; a pack that
    // walked into you settles it the same way the tall grass does.
    const ambush = d.ambush != null && d.ambush !== false
      ? d.ambush
      : (d.roamer ? this._ambushFor(enemies, { biome, night, weather, seed }) : false);

    return this._pushBattle(enemies, {
      seed, biome, depth: d.depth || 0,
      ambush, boss: !!d.boss, source: d.entity || null,
      difficulty: (d.roll && d.roll.difficulty) || undefined,
      night, weather,
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

    // How hard the sun casts right now. Every depth pass is scaled by it so the
    // world does not double-darken once _drawGrade multiplies midnight over it.
    this._updateLight();

    this._drawLayer(ctx, 'ground', cam);
    // Light failing to reach the foot of every wall, drawn between the floor and
    // the scenery so the walkable ground reads as a carved-out shape rather than
    // a flat texture.
    this._drawEdges(ctx, cam);
    // The shadow a building throws across the street. Drawn on the ground and
    // under the scenery, because that is where it lands — on the pavement.
    this._drawSunShadows(ctx, cam);
    this._drawLayer(ctx, 'deco', cam);
    // The eave: what the roofs and canopies overhead drop onto the wall face and
    // the ground below them. After deco, so it lands on the wall it belongs to.
    this._drawOverhangs(ctx, cam);
    // Ways out of this place, under the party so you can stand on one.
    this._drawExits(ctx, cam);

    // Every contact shadow in one sweep BEFORE any sprite, so a villager's
    // shadow can never darken the face of the villager standing in front.
    const shadowed = safe(() => this._drawEntityShadows(ctx, cam), false);

    // Entities and the party in one feet-Y sort, so villagers pass in front of and
    // behind you correctly.
    if (this.entities) {
      safe(() => this.entities.draw(ctx, cam, {
        viewW: VIEW_W, viewH: VIEW_H, pad: 48,
        drawOpts: shadowed ? NO_SPRITE_SHADOW : undefined,
      }));
    }
    // The "there is something here" glint, over the sprites but under the
    // grade, so the dark can take it away again.
    this._drawSparkles(ctx, cam);
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
    // Which visible ground tiles owe a verge or a waterline. One byte per tile,
    // resolved once per map; null on the deco and over layers, and on any map
    // whose ground carries no autotiled family at all. Called as a method rather
    // than through safe(): a `() => …` here would be one closure allocated on
    // every layer of every frame, which is 180 a second for nothing.
    const fringe = layer === 'ground' ? this._fringeMaskSafe() : null;

    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= map.h) continue;
      const row = y * map.w;
      const py = y * TILE - cam.y;
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= map.w) continue;
        const id = plane[row + x];
        if (!id) continue;
        const px = x * TILE - cam.x;
        const cell = fringe ? fringe[row + x] : 0;
        if (cell) this._drawFringed(ctx, id, cell, px, py, x, y, t);
        else drawTile(ctx, id, px, py, x, y, t);
      }
    }
  }

  /**
   * One ground tile that borders a different material. `cell` is the mask word
   * laid out at the end of section 4b. Four shapes, cheapest first:
   *
   *   FR_ISLE       one blit of the purpose-drawn island patch.
   *   syn === 0     one blit of the member carrying the hand-painted verge —
   *                 byte for byte what this method did before it learned the
   *                 other two cases, and still what the overwhelming majority
   *                 of verged tiles take.
   *   SYN_SLOT      one blit of the 16x16 composited for this cell.
   *   otherwise     ditto, but the composite starts from the member art rather
   *                 than the flat tile.
   *
   * Only the three- and four-sided member cases clip, and there are a few dozen
   * of those on the largest map.
   */
  _drawFringed(ctx, id, cell, px, py, wx, wy, t) {
    if (cell & FR_ISLE) { drawTile(ctx, ISLE_OF[id] || id, px, py, wx, wy, t); return; }
    const slot = (cell >> 4) & 15;
    if (slot === SYN_SLOT || (cell >> 8) & 15) { this._drawSynthVerge(ctx, id, cell, px, py, wx, wy, t); return; }
    const plan = fringePlan(slot ? FRINGE_BASES[slot] : tileKeyOf(id), cell & 15);
    if (!plan) { drawTile(ctx, id, px, py, wx, wy, t); return; }
    this._drawFringePlan(ctx, plan, px, py, wx, wy, t);
  }

  /** A member-set plan, drawn with its origin at (ox, oy). */
  _drawFringePlan(ctx, plan, ox, oy, wx, wy, t) {
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i], clip = step.clip;
      if (!clip) { drawTile(ctx, step.id, ox, oy, wx, wy, t); continue; }
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox + clip[0], oy + clip[1], clip[2], clip[3]);
      ctx.clip();
      drawTile(ctx, step.id, ox, oy, wx, wy, t);
      ctx.restore();
    }
  }

  /**
   * Section 4c: a tile whose verge is built out of the neighbour rather than out
   * of member art, drawn from the 16x16 that was composited for this cell the
   * first time it came into view. That is one blit, exactly like any other tile.
   * The live path below it only runs where there is no canvas to composite into
   * — the headless renderer, or a map past the cache ceiling — and is
   * pixel-identical, which is asserted in the harness.
   */
  _drawSynthVerge(ctx, id, cell, px, py, wx, wy, t) {
    const cv = this._synCell(id, cell, wx, wy, t);
    if (cv) { ctx.drawImage(cv, px | 0, py | 0); return; }
    // No canvas to composite into (or the map is over the cap): paint it live.
    ctx.save();
    ctx.translate(px | 0, py | 0);
    this._paintSynthVerge(ctx, id, cell, wx, wy, t);
    ctx.restore();
  }

  /** The tile and its verges, drawn at 0,0 into whatever ctx is handed over. */
  _paintSynthVerge(ctx, id, cell, wx, wy, t) {
    const slot = (cell >> 4) & 15;
    const syn = slot === SYN_SLOT ? (cell & 15) : ((cell >> 8) & 15);
    // The ground this cell starts from: the flat tile, or — when the family owns
    // member art and some of its sides meet turf — that art, so a path can carry
    // a painted grass verge on one side and a composited soil verge on another.
    const base = slot === SYN_SLOT ? 0 : (cell & 15);
    const plan = base ? fringePlan(slot ? FRINGE_BASES[slot] : tileKeyOf(id), base) : null;
    if (plan) this._drawFringePlan(ctx, plan, 0, 0, wx, wy, t);
    else drawTile(ctx, id, 0, 0, wx, wy, t);
    const map = this.map;
    const bucket = tileHash(wx, wy, 91) & (SYN_BUCKETS - 1);
    for (let s = 0; s < 4; s++) {
      if (!(syn & (1 << s))) continue;
      const path = SYN_PATHS[s * SYN_BUCKETS + ((bucket + s) & (SYN_BUCKETS - 1))];
      if (!path) continue;
      const nx = wx + FR_DX[s], ny = wy + FR_DY[s];
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
      const nid = map.ground[ny * map.w + nx];
      if (!nid) continue;
      ctx.save();
      ctx.clip(path);
      // The neighbour keeps its OWN world position, so it picks the same grass
      // variant it is drawn with next door and the turf reads as continuous.
      drawTile(ctx, nid, 0, 0, nx, ny, t);
      ctx.restore();
    }
  }

  /**
   * The composited 16x16 for one verged cell, built the first time that cell is
   * drawn and kept on the map until bindMap drops it. `null` is remembered too,
   * so a headless or over-cap map does not retry every frame.
   */
  _synCell(id, cell, wx, wy, t) {
    const map = this.map;
    const i = wy * map.w + wx;
    let store = map._synTiles;
    if (!store) store = map._synTiles = [];
    const hit = store[i];
    if (hit !== undefined) return hit;
    let cv = null;
    if (typeof document !== 'undefined' && (map._synBuilt || 0) < SYN_CACHE_CAP) {
      const c = document.createElement('canvas');
      c.width = TILE; c.height = TILE;
      const cx = c.getContext && c.getContext('2d');
      if (cx) {
        cx.imageSmoothingEnabled = false;
        this._paintSynthVerge(cx, id, cell, wx, wy, t);
        cv = c;
        map._synBuilt = (map._synBuilt || 0) + 1;
      }
    }
    store[i] = cv;
    return cv;
  }

  /** _fringeMask() without the per-frame `() => …`. See _drawLayer. */
  _fringeMaskSafe() {
    try { return this._fringeMask(); } catch (e) { console.warn('[overworld]', e); return null; }
  }

  /**
   * One 16-bit word per ground tile, laid out at the end of section 4b: the
   * member-set sides, which member set, the sides invaded synthetically on top,
   * and the island-patch bit. Zero everywhere else, which is most of the map —
   * a solid road core, a field of grass, a flagstone floor.
   *
   * The raw "is my neighbour a different material?" answer is taken from
   * sameMaterial(), which asks tileSubgroup() where render/tiles.js exports one
   * and tileGroup() where it does not. That is the whole of the dirt-family fix:
   * autotileEdges() cannot see the 1,623 GRAVEL/DIRT/PATH/MUD/FARMLAND joins
   * because they all answer 'dirt', and a pass that is never told about an edge
   * cannot soften it. Everything else it reports is unchanged, and with no finer
   * key exported this loop sees exactly the edges autotileEdges() saw.
   *
   * That raw answer is then narrowed by the rules at the top of section 4b:
   * cardinal sides only, so a differing diagonal cannot verge a tile whose four
   * neighbours are all road; only against a material the verge is actually
   * painted in, with two paved surfaces never verging into each other; and no
   * FOREIGN material may eat an island, because four turf verges leave 42-62% of
   * one standing — an island either gets its purpose-drawn patch tile or stays
   * the solid square the author painted.
   *
   * Built once per map and hung on the map, like _edgeMask and _overMask.
   */
  _fringeMask() {
    const map = this.map;
    const cached = map._fringeMask;
    if (cached === false) return null;                                // scanned: nothing to verge
    if (cached && cached.length === map.w * map.h) return cached;
    map._synTiles = null; map._synBuilt = 0;   // the mask is being rebuilt; so is anything composited from it
    initFringe();
    const w = map.w, h = map.h, ground = map.ground;
    let any = false;
    const mask = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const id = ground[i];
        const kind = FRINGE_KIND[id];
        const isle = ISLE_OF[id] || 0;
        // A tile with neither a verge kind nor a patch tile is not our business.
        // COBBLE reaches this loop on the second test alone.
        if (!kind && !isle) continue;
        const grp = tileGroup(id), sub = subOf(id);
        // Walk the four sides once: collect the sides that may be verged, split
        // by whether the invader is a foreign material or another surface of the
        // same one, count the neighbours of this tile's own material, note how
        // many of them are the turf an island patch is drawn on, and — for water
        // — pick the bank the shore is drawn in from the first land it meets.
        let hard = 0, soft = 0, kin = 0, kinGrp = 0, nbrs = 0, turf = 0, slot = 0;
        for (let s = 0; s < 4; s++) {
          const nx = x + FR_DX[s], ny = y + FR_DY[s];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;  // off-map is not a neighbour
          nbrs++;
          const nid = ground[ny * w + nx];
          const ng = tileGroup(nid);
          // TWO COUNTS OF KIN, AND THE DIFFERENCE MATTERS. `kin` is the finest
          // one — same surface exactly — and decides whether this is the lone
          // patch an _ISLE tile was drawn for. `kinGrp` is the coarse one rule 3
          // has always used, and decides whether a FOREIGN material is allowed to
          // eat into the tile. Splitting the dirt group without splitting this
          // too costs 144 tiles their grass verge: a gravel square beside a dirt
          // road has no kin at the fine key, so rule 3 would suddenly refuse the
          // turf boundary it has been softening correctly all along.
          if (nid === id || (grp && grp === ng)) kinGrp++;
          if (sameMaterial(id, nid)) { kin++; continue; }
          const nsub = subOf(nid);
          if (ISLE_SURROUND.has(nsub)) turf++;
          if (kind === 2) {
            const bank = SHORE_SLOT[ng];                          // water: keyed to the bank
            if (!bank) continue;
            if (!slot) slot = bank;
            else if (slot !== bank) continue;                     // two banks: verge the first only
            hard |= 1 << s;
            continue;
          }
          if (!kind || !vergeAccepts(sub, nsub, grp, ng)) continue;
          if (sameFamilyVerge(sub, nsub, grp, ng)) soft |= 1 << s;
          else hard |= 1 << s;
        }
        // RULE 3, and its two amendments. An island is a thing the author drew
        // on its own, and four verges eat 16px inward from every edge.
        //
        // 3b: a lone patch — judged on the FINE key, and with nothing but turf
        // around it — gets the tile that was drawn for exactly this, soft on all
        // four sides inside its own 16x16 instead of nibbled from outside.
        if (nbrs && !kin && isle && turf === nbrs) { mask[i] = FR_ISLE; any = true; continue; }
        // 3/3a: with no neighbour of its own COARSE material, no foreign one may
        // eat it. Another surface of the same material still may — soil lapping
        // into gravel leaves soil, so nothing dissolves into a smudge and no road
        // loses a link, and that is where the chequerboard actually lives.
        if (nbrs && !kinGrp) hard = 0;
        if (!hard && !soft) continue;
        // A family with no member set of its own composites every side it owns;
        // one that has member art keeps it for the turf sides and composites
        // only the same-material ones, which is the case the old single-nibble
        // byte could not express: DIRT_PATH_N is a path with GRASS painted along
        // its north edge, so it is exactly the wrong tile to draw at a join with
        // dirt, and the two have to be able to coexist on one tile.
        let card = 0, syn = 0;
        if (kind === 3) syn = hard | soft;
        else { card = hard; syn = soft; }
        // Anything composited needs Path2D and a neighbour that will hold still:
        // the cell is drawn once and blitted thereafter, so an animated invader
        // would freeze on the frame it was built. CROP_WHEAT sways.
        if (syn) {
          initSynPaths();
          let still = SYN_PATHS.length > 0;
          for (let s = 0; s < 4 && still; s++) {
            if (!(syn & (1 << s))) continue;
            if (isAnimated(ground[(y + FR_DY[s]) * w + x + FR_DX[s]])) still = false;
          }
          if (!still) syn = 0;
        }
        if (kind === 3) {
          if (!syn) continue;
          mask[i] = syn | (SYN_SLOT << 4);
        } else {
          if (card && !fringePlan(slot ? FRINGE_BASES[slot] : tileKeyOf(id), card)) card = 0;
          if (!card && !syn) continue;
          mask[i] = card | (slot << 4) | (syn << 8);
        }
        any = true;
      }
    }
    // `false` records "this map has no verges" so a cave or an inn never pays
    // for the scan twice, and the draw loop skips the lookup entirely.
    map._fringeMask = any ? mask : false;
    return any ? mask : null;
  }

  // =========================================================================
  // 6.4a WHERE YOU MAY WALK, AND WHERE YOU MAY LEAVE
  // =========================================================================
  //
  // A tile-painted town is a beautiful thing and a confusing one: grass, path and
  // the two-pixel strip of grass that is actually a garden wall all read the same
  // from above. These passes fix that without repainting a single tileset.
  //
  //   _drawEdges — ambient occlusion. Every boundary between somewhere you can
  //     stand and somewhere you cannot gets a graded ramp on the walkable side,
  //     deepest in the pixel that actually touches the wall, plus a dab in each
  //     concave corner. Light failing to reach a crevice, not an outline.
  //   _drawOverhangs — an over-layer roof or canopy drops a short band onto the
  //     tile below it, so a building has an eave and a lit wall face.
  //   _drawEntityShadows — a contact shadow under everything that stands on the
  //     ground, painted before any sprite.
  //   _drawExits — every warp out of this map gets an animated chevron pointing
  //     the way out, plus the name of the place it leads to once you are close.
  //
  // The occlusion and the exit markers are switchable in Options (Path Edges /
  // Exit Markers) for anyone who prefers the plain tileset.

  /**
   * Refresh the two strengths the depth passes are scaled by. Called once per
   * frame from draw(); allocates nothing.
   *
   * `_sun` drives the CAST shadows — a body's contact shadow, a roof's eave.
   * Those are the sun's doing, so they fade towards a floor after dark and the
   * night grade is not asked to darken them a second time.
   *
   * `_ao` drives the ambient occlusion at wall bases, which is not the sun's
   * doing at all: the strip of ground jammed against a wall sees less of the sky
   * whatever the hour, and the option that turns it on ("Path Edges") exists so
   * you can read where you may walk. It stays nearly constant so that legibility
   * does not evaporate at midnight.
   */
  _updateLight() {
    const map = this.map;
    let sun = 1;
    if (map) {
      if (this._darkNow() > 0) sun = 0;              // a cave: torchlight, no sun
      else if (map.indoor) sun = 0.35;               // window light, soft and flat
      else {
        const st = state();
        sun = (map.dayNight === false || !st) ? 1 : sunStrength(st.time);
      }
    }
    this._sun = 0.30 + 0.70 * sun;
    this._ao = 0.78 + 0.22 * sun;
  }

  /**
   * Bitmask per tile: which NEIGHBOURS of this walkable tile are blocked.
   * Sides in the low nibble (N E S W), diagonals in the high (NE SE SW NW), so
   * `b & 15` is still "which sides". Built once per map — a 60x50 town is 3000
   * cheap lookups — and it never changes while you are standing in it.
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
        if (blocked(x, y - 1)) b |= M_N;
        if (blocked(x + 1, y)) b |= M_E;
        if (blocked(x, y + 1)) b |= M_S;
        if (blocked(x - 1, y)) b |= M_W;
        if (blocked(x + 1, y - 1)) b |= M_NE;
        if (blocked(x + 1, y + 1)) b |= M_SE;
        if (blocked(x - 1, y + 1)) b |= M_SW;
        if (blocked(x - 1, y - 1)) b |= M_NW;
        mask[y * w + x] = b;
      }
    }
    map._edgeMask = mask;
    return mask;
  }

  /**
   * Which tiles receive a cast band from an over-layer tile above or beside them.
   * M_N: a roof/canopy directly north drops onto our top edge.
   * M_W: one directly west drops onto our left edge (the sun sits up and left).
   * M_NW: only the diagonal, so just the corner pixel.
   * A tile that is itself under a roof receives nothing — it is already in shade.
   */
  _overMask() {
    const map = this.map;
    if (map._overMask && map._overMask.length === map.w * map.h) return map._overMask;
    const w = map.w, h = map.h;
    const over = map.over;
    const mask = new Uint8Array(w * h);
    map._overAny = false;
    if (!over) { map._overMask = mask; return mask; }

    // An over tile only casts if it is opaque: thatch and canopy are SOLID,
    // cobwebs and stalactites are not and must not paint a band on the floor.
    const solidOver = new Uint8Array(1024);        // 0 unknown, 1 no, 2 yes
    const casts = (i) => {
      const id = over[i];
      if (!id) return 0;
      if (id >= solidOver.length) return (tileFlags(id) & TF.SOLID) !== 0 ? 1 : 0;
      const s = solidOver[id];
      if (s) return s - 1;
      const v = (tileFlags(id) & TF.SOLID) !== 0 ? 1 : 0;
      solidOver[id] = v + 1;
      return v;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (casts(i)) continue;                       // already in shade
        let b = 0;
        if (y > 0 && casts(i - w)) b |= M_N;
        if (x > 0 && casts(i - 1)) b |= M_W;
        if (x > 0 && y > 0 && casts(i - w - 1)) b |= M_NW;
        mask[i] = b;
        if (b) map._overAny = true;
      }
    }
    map._overMask = mask;
    return mask;
  }

  /**
   * Collect the on-screen tiles carrying a non-zero mask into scratch arrays, so
   * the alpha-grouped passes below iterate over ~100 edges instead of ~460 tiles
   * four times over. The buffers are grown once and reused for the life of the
   * scene: the draw loop allocates nothing.
   */
  _gatherMask(mask, cam) {
    const map = this.map;
    const x0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
    const y0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
    const x1 = Math.min(map.w - 1, x0 + Math.ceil(VIEW_W / TILE) + 2);
    const y1 = Math.min(map.h - 1, y0 + Math.ceil(VIEW_H / TILE) + 2);

    const cap = Math.max(64, (x1 - x0 + 1) * (y1 - y0 + 1));
    if (!this._mx || this._mx.length < cap) {
      this._mx = new Int16Array(cap);
      this._my = new Int16Array(cap);
      this._mb = new Uint8Array(cap);
    }
    const mx = this._mx, my = this._my, mb = this._mb;
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      const row = y * map.w;
      const py = y * TILE - cam.y;
      for (let x = x0; x <= x1; x++) {
        const b = mask[row + x];
        if (!b) continue;
        mx[n] = x * TILE - cam.x;
        my[n] = py;
        mb[n] = b;
        n++;
      }
    }
    return n;
  }

  /**
   * Ambient occlusion at the foot of every wall, hedge, cliff and waterline.
   *
   * Three ramps rather than one slab: north deepest (the sun is overhead and a
   * little to the left, so the strip under a north wall never sees it), east and
   * west a shade less, south shallowest because that lip is the top of the wall
   * face and does catch light. Then a dab in every concave corner and on every
   * blocked diagonal, which is the part that actually makes it read as a corner
   * rather than as two lines that happen to meet.
   */
  _drawEdges(ctx, cam) {
    if (Save && Save.settings && Save.settings.showEdges === false) return;
    const mask = safe(() => this._edgeMask(), null);
    if (!mask) return;
    const n = this._gatherMask(mask, cam);
    if (!n) return;

    const mx = this._mx, my = this._my, mb = this._mb;
    const k = this._ao;                    // occlusion, not sunlight: barely dims
    ctx.save();

    // One pass per (step, side-group) so a whole ramp level shares one fillStyle.
    for (let s = 0; s < AO_STEPS; s++) {
      const an = AO_N[s] || 0, ax = AO_X[s] || 0, as = AO_S[s] || 0;
      if (an > 0) {
        ctx.fillStyle = ink(an * k);
        for (let i = 0; i < n; i++) if (mb[i] & M_N) ctx.fillRect(mx[i], my[i] + s, TILE, 1);
      }
      if (ax > 0) {
        ctx.fillStyle = ink(ax * k);
        for (let i = 0; i < n; i++) {
          const b = mb[i];
          if (b & M_W) ctx.fillRect(mx[i] + s, my[i], 1, TILE);
          if (b & M_E) ctx.fillRect(mx[i] + TILE - 1 - s, my[i], 1, TILE);
        }
      }
      if (as > 0) {
        ctx.fillStyle = ink(as * k);
        for (let i = 0; i < n; i++) if (mb[i] & M_S) ctx.fillRect(mx[i], my[i] + TILE - 1 - s, TILE, 1);
      }
    }

    // Concave corners: two blocked sides meeting means twice as little light.
    ctx.fillStyle = ink(AO_CORNER * k);
    for (let i = 0; i < n; i++) {
      const b = mb[i], px = mx[i], py = my[i];
      if ((b & (M_N | M_W)) === (M_N | M_W)) ctx.fillRect(px, py, 3, 3);
      if ((b & (M_N | M_E)) === (M_N | M_E)) ctx.fillRect(px + TILE - 3, py, 3, 3);
      if ((b & (M_S | M_W)) === (M_S | M_W)) ctx.fillRect(px, py + TILE - 3, 3, 3);
      if ((b & (M_S | M_E)) === (M_S | M_E)) ctx.fillRect(px + TILE - 3, py + TILE - 3, 3, 3);
    }

    // An outside corner — the diagonal is blocked but both sides are open — is a
    // single pinched pixel of shade, which is what stops a jetty or a doorway
    // reveal from looking like it was cut out with scissors.
    ctx.fillStyle = ink(AO_DIAG * k);
    for (let i = 0; i < n; i++) {
      const b = mb[i], px = mx[i], py = my[i];
      if ((b & M_NW) && !(b & (M_N | M_W))) ctx.fillRect(px, py, 2, 2);
      if ((b & M_NE) && !(b & (M_N | M_E))) ctx.fillRect(px + TILE - 2, py, 2, 2);
      if ((b & M_SW) && !(b & (M_S | M_W))) ctx.fillRect(px, py + TILE - 2, 2, 2);
      if ((b & M_SE) && !(b & (M_S | M_E))) ctx.fillRect(px + TILE - 2, py + TILE - 2, 2, 2);
    }
    ctx.restore();
  }

  /**
   * The eave. A thatched roof sits on the `over` plane, above the actors; the
   * wall face and the street below it sit on `deco` and `ground`. Without a cast
   * band between them the roof looks pasted onto the grass. One five-row ramp
   * along the top of whatever is directly south of a roof tile, and a three-column
   * one down its left, is enough to give the whole town a third dimension.
   */
  /**
   * A tall mask: which tiles are a BUILDING rather than a barrel.
   *
   * A cast shadow is only worth drawing for something with height. A crate is
   * solid and already has its own contact shadow; a house is a storey and a
   * half and should darken the street beside it. The test is the roof: town
   * builders paint roof tiles on the `over` plane, so a solid over-tile means
   * "there is a building here". Walls with a roofed neighbour count too, which
   * picks up the base course and the wall face under an eave, and a run of
   * three or more solid tiles counts as a curtain wall or a cliff.
   *
   * Built once per map and cached on it — a 60x50 town is 3000 lookups and it
   * never changes while you stand in it.
   */
  _tallMask() {
    const map = this.map;
    if (!map) return null;
    if (map._tallMask && map._tallMask.length === map.w * map.h) return map._tallMask;
    const w = map.w, h = map.h;
    const mask = new Uint8Array(w * h);
    map._tallAny = false;
    const over = map.over;

    const roofAt = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h || !over) return false;
      const id = over[y * w + x];
      return !!id && (tileFlags(id) & TF.SOLID) !== 0;
    };
    const solidAt = (x, y) => (x >= 0 && y >= 0 && x < w && y < h)
      && (map.flagAt(x, y) & TF.SOLID) !== 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!solidAt(x, y)) continue;
        let tall = roofAt(x, y);
        // A wall directly under or beside a roof is part of that building.
        if (!tall && (roofAt(x, y - 1) || roofAt(x, y + 1) || roofAt(x - 1, y) || roofAt(x + 1, y))) tall = true;
        // A long unroofed run is masonry: a town wall, a cliff face, a tower.
        if (!tall) {
          let run = 1;
          for (let i = 1; i < 3 && solidAt(x - i, y); i++) run++;
          for (let i = 1; i < 3 && solidAt(x + i, y); i++) run++;
          let col = 1;
          for (let i = 1; i < 3 && solidAt(x, y - i); i++) col++;
          for (let i = 1; i < 3 && solidAt(x, y + i); i++) col++;
          if (run >= 3 && col >= 2) tall = true;
        }
        if (tall) { mask[y * w + x] = 1; map._tallAny = true; }
      }
    }
    map._tallMask = mask;
    return mask;
  }

  /**
   * The sun's own shadow: a building's silhouette, thrown across the ground.
   *
   * This is the pass that stops a stone house on a flagstone street reading as
   * a slightly different flagstone. Ambient occlusion (_drawEdges) draws a thin
   * dark lip where ground meets wall, which says "edge"; it does not say
   * "height". A shadow lying four pixels off the wall and running away from the
   * light does, and it is the only cue in a top-down view that reliably
   * separates a tall thing from a painted one.
   *
   * Every tile in the game is lit from the upper left — highlights on the top
   * and left of a barrel, shade down its right — so the shadow must fall to the
   * lower right or it will fight the tileset.
   *
   * Method: build the silhouette of every tall tile in an offscreen buffer,
   * offset it, then punch the un-offset silhouette back out with
   * `destination-out` so a building never shadows itself. Two passes at
   * different offsets give a near edge and a softer far one.
   */
  _drawSunShadows(ctx, cam) {
    if (Save && Save.settings && Save.settings.showEdges === false) return;
    const map = this.map;
    if (!map || map.indoor) return;
    if (this._darkNow() > 0) return;                    // underground: no sun to cast
    const k = this._sun;
    if (k <= 0.34) return;                              // night; the grade does the work
    const mask = safe(() => this._tallMask(), null);
    if (!mask || !map._tallAny) return;
    if (typeof document === 'undefined') return;

    // Shadows lengthen morning and evening and shorten towards noon. The
    // DIRECTION never moves — the tile art has a fixed light — but the length
    // carries the hour, which is most of what the eye reads as time of day.
    const st = state();
    const noon = st && map.dayNight !== false ? 1 - Math.abs(((st.time / 1440) * 2) - 1) : 0.6;
    // A house here is a storey and a half, so its shadow is about a tile long.
    // Shorter than that and a grey wall on a grey street still has nothing to
    // separate it from the pavement, which is the whole reason for this pass.
    const len = 5 + Math.round((1 - noon) * 5);         // 5px at noon, 10 at dawn

    if (!this._shadowBuf) {
      this._shadowBuf = document.createElement('canvas');
      this._shadowBuf.width = VIEW_W; this._shadowBuf.height = VIEW_H;
    }
    const buf = this._shadowBuf;
    const g = buf.getContext('2d');
    g.clearRect(0, 0, VIEW_W, VIEW_H);

    // Which tall tiles are on screen.
    const x0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
    const y0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
    const x1 = Math.min(map.w - 1, x0 + Math.ceil(VIEW_W / TILE) + 2);
    const y1 = Math.min(map.h - 1, y0 + Math.ceil(VIEW_H / TILE) + 2);

    // Pass 1: the silhouette, twice, offset near and far.
    g.globalCompositeOperation = 'source-over';
    for (const [off, a] of [[len, 0.34], [len * 2, 0.17]]) {
      g.fillStyle = `rgba(14,12,26,${(a * k).toFixed(3)})`;
      for (let y = y0; y <= y1; y++) {
        const row = y * map.w;
        const py = y * TILE - cam.y + off;
        for (let x = x0; x <= x1; x++) {
          if (!mask[row + x]) continue;
          g.fillRect(x * TILE - cam.x + off, py, TILE, TILE);
        }
      }
    }
    // Pass 2: cut the buildings back out. A house does not shadow itself, and
    // without this the whole mass goes muddy and the roofs lose their colour.
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    for (let y = y0; y <= y1; y++) {
      const row = y * map.w;
      const py = y * TILE - cam.y;
      for (let x = x0; x <= x1; x++) {
        if (!mask[row + x]) continue;
        g.fillRect(x * TILE - cam.x, py, TILE, TILE);
      }
    }
    g.globalCompositeOperation = 'source-over';
    ctx.drawImage(buf, 0, 0);
  }

  _drawOverhangs(ctx, cam) {
    const mask = safe(() => this._overMask(), null);
    if (!mask || !this.map._overAny) return;      // a map with no roofs costs nothing
    const n = this._gatherMask(mask, cam);
    if (!n) return;

    const mx = this._mx, my = this._my, mb = this._mb;
    const k = this._sun;
    ctx.save();
    for (let s = 0; s < OVERHANG_STEPS; s++) {
      const an = OVERHANG_N[s] || 0, aw = OVERHANG_W[s] || 0;
      if (an > 0) {
        ctx.fillStyle = ink(an * k);
        for (let i = 0; i < n; i++) if (mb[i] & M_N) ctx.fillRect(mx[i], my[i] + s, TILE, 1);
      }
      if (aw > 0) {
        ctx.fillStyle = ink(aw * k);
        for (let i = 0; i < n; i++) if (mb[i] & M_W) ctx.fillRect(mx[i] + s, my[i], 1, TILE);
      }
    }
    // Only the corner of the roof clips us: a small wedge, nothing more.
    ctx.fillStyle = ink(OVERHANG_N[1] * k);
    for (let i = 0; i < n; i++) {
      const b = mb[i];
      if ((b & M_NW) && !(b & (M_N | M_W))) ctx.fillRect(mx[i], my[i], 4, 3);
    }
    ctx.restore();
  }

  /**
   * A contact shadow under everything that stands on the ground: the party, the
   * townsfolk, the goblins in the grass, the barrels and the chests.
   *
   * Painted in one sweep before ANY sprite goes down, which is the whole point —
   * `drawSprite` would otherwise lay each shadow immediately before its own
   * sprite, so the villager drawn second would have the first one's shadow
   * across her boots. Two nested ellipses at the feet anchor (px, py), not the
   * sprite centre, sized from the sprite's own width so an ogre casts an ogre's
   * shadow. Returns true if it ran, which is what tells the entity pass to skip
   * its built-in shadows.
   */
  _drawEntityShadows(ctx, cam) {
    const list = this.entities && this.entities.list;
    if (!list || !list.length) return false;
    const map = this.map;
    const camX = cam.x, camY = cam.y;
    const k = this._sun;

    if (!this._sx || this._sx.length < list.length) {
      const cap = Math.max(64, list.length + 16);
      this._sx = new Int16Array(cap);
      this._sy = new Int16Array(cap);
      this._sr = new Uint8Array(cap);
    }
    const sx = this._sx, sy = this._sy, sr = this._sr;
    let n = 0;

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.removed || e.hidden || e.shadow === false) continue;
      if (e.alpha != null && e.alpha < 0.85) continue;      // fading in or out
      const px = e.px - camX, py = e.py - camY;
      if (px < -24 || py < -24 || px > VIEW_W + 24 || py > VIEW_H + 24) continue;
      // Nothing standing in the water leaves a shadow on it.
      if (map && (map.flagAt(e.x, e.y) & TF.WATER)) continue;
      const rx = clamp(Math.round(footWidth(e) * (e.scale || 1) * SHADOW_SPREAD), 3, 16);
      sx[n] = Math.round(px);
      // Centred ON the feet anchor, not the sprite centre: the top half falls
      // under the boots where nobody sees it, the bottom half is the shadow.
      sy[n] = Math.round(py);
      sr[n] = rx;
      n++;
      if (n >= sx.length) break;
    }
    // Nothing to paint still counts as "this pass owns the shadows" — otherwise
    // the entity pass would put back the very shadows we deliberately skipped.
    if (!n) return true;

    ctx.save();
    // The penumbra first, then the core, both under every sprite in the scene.
    ctx.fillStyle = ink(SHADOW_PENUMBRA * k);
    for (let i = 0; i < n; i++) {
      const rx = sr[i] + 2;
      fillEllipse(ctx, sx[i], sy[i], rx, Math.max(3, Math.round(sr[i] * 0.40) + 1));
    }
    ctx.fillStyle = ink(SHADOW_CORE * k);
    for (let i = 0; i < n; i++) {
      fillEllipse(ctx, sx[i], sy[i], sr[i], Math.max(2, Math.round(sr[i] * 0.40)));
    }
    ctx.restore();
    return true;
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
    // Daylight is true sunlight: fieldworld marks the cast `sunlight` and the
    // cave stops being a cave for as long as it burns.
    const dark = this._darkNow();

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

    const night = tint ? clamp((tint.a - 0.07) / 0.42, 0, 1) : (map.indoor || dark ? 0.85 : 0);
    if (night > 0.04) this._drawLights(ctx, cam, night);
  }

  /**
   * How dark this place is RIGHT NOW. `map.dark` is what the map was authored
   * as; a sunlight effect overrides it outright, and any light at all softens
   * the worst of it. Everything that cares about the dark reads this, so the
   * gradient and the rules never disagree about whether you can see.
   */
  _darkNow() {
    const map = this.map;
    if (!map) return 0;
    const dark = map.dark || 0;
    if (dark <= 0) return 0;
    if (this.spellLight && this.spellLight.sunlight) return 0;
    return dark;
  }

  /** Can the party see well enough to notice things? */
  _canSeeHere() {
    if (this._darkNow() <= 0.3) return true;
    return safe(() => hasLight(this, Party), true);
  }

  /**
   * The glint on an unopened chest. It is a PERCEPTION cue, so it is the first
   * thing the dark takes away: no torch, no lantern, no Light, no sparkle —
   * you can still walk into the chest, you just will not be shown it.
   * A chest picked out by Detect Magic keeps its glow regardless.
   */
  _drawSparkles(ctx, cam) {
    if (!this.entities) return;
    const seeing = this._canSeeHere();
    const px = this.player.x, py = this.player.y;
    ctx.save();
    for (const e of arrOf(this.entities.list)) {
      if (!e || e.removed || e.hidden || e.kind !== 'chest' || e.opened) continue;
      const d = Math.max(Math.abs(e.x - px), Math.abs(e.y - py));
      if (d > 9) continue;
      if (!seeing && !e.detected) continue;
      const sx = Math.round(e.x * TILE + TILE / 2 - cam.x);
      const sy = Math.round(e.y * TILE + 3 - cam.y);
      if (sx < -8 || sy < -8 || sx > VIEW_W + 8 || sy > VIEW_H + 8) continue;
      const phase = (this.t * 2.2) + (e.x * 0.7 + e.y * 1.3);
      const a = 0.25 + 0.55 * Math.max(0, Math.sin(phase));
      ctx.globalAlpha = clamp(a * (e.detected ? 1 : 0.8), 0, 1);
      ctx.fillStyle = e.detected ? '#b07af0' : '#ffe9a6';
      ctx.fillRect(sx, sy - 1, 1, 3);
      ctx.fillRect(sx - 1, sy, 3, 1);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
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
