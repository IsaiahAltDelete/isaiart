// render/tiles.js — the procedural tileset. Every tile in Phandalin, the Triboar
// Trail, Wave Echo Cave and Undermountain is painted here with fillRect calls into
// a cached 16x16 offscreen canvas, then blitted. No image files, ever.
//
// HOW IT WORKS
//   Each tile definition owns a `draw(ctx, x, y, wx, wy, t)` function. When you call
//   `drawTile(ctx, id, px, py, wx, wy, t)` we:
//     1. hash the world coords (wx, wy) into a small VARIANT index 0..variants-1,
//        so a field of grass has organic variation but never shimmers (the variant
//        is a pure function of position — no RNG, no time);
//     2. pick an animation FRAME from `t` for water / lava / fire / crops;
//     3. rasterise (id, variant, frame) once into an offscreen canvas and cache it;
//     4. drawImage the cache at integer pixel coordinates.
//
//   Inside a `draw` the 4th argument (`wx`) arrives as a *variation seed* derived
//   from the tile id and the resolved variant — feed it to `sr()` for deterministic
//   speckle. Drawing must never depend on raw world coords or the cache would need
//   one canvas per tile on the map.
//
// LAYERS
//   layer:'ground' tiles are fully opaque 16x16 (floors, terrain).
//   layer:'deco'   tiles are transparent props/walls drawn over the ground layer.
//   layer:'over'   tiles draw above the actors (roofs, treetops, cobwebs, ceilings).

// Flag bits — these mirror `TF` in world/tilemap.js exactly. Declared locally so
// this module has no import cycle with the world layer (tilemap.js imports nothing
// from here, but mapgen/battlemap import both).
export const TF = {
  SOLID: 1, WATER: 2, ENCOUNTER: 4, DOOR: 8,
  TRIGGER: 16, LEDGE: 32, SLOW: 64, DAMAGE: 128,
};
const { SOLID, WATER, ENCOUNTER, DOOR, TRIGGER, LEDGE, SLOW, DAMAGE } = TF;

// ---------------------------------------------------------------------------
// 1. PALETTE — warm, earthy, GBA-era. Adjacent terrain types are kept at least
//    one value-step apart so the map reads at 1x without any outline pass.
// ---------------------------------------------------------------------------

export const PAL = {
  void: '#0a0a0c', voidL: '#141419',

  grass: '#4a7c3f', grassD: '#3a6432', grassL: '#5d9450', grassH: '#71ae5d',
  grassDry: '#7f8f47', tallD: '#3d6b34', tall: '#4e8442', tallL: '#63a052',
  clover: '#6aa85c',

  dirt: '#8a6a45', dirtD: '#6b5034', dirtL: '#a08157',
  path: '#9c8362', pathD: '#7c6748', pathL: '#b39b78',
  mud: '#5f4a33', mudD: '#463626', mudL: '#7a6144',
  sand: '#d8c58c', sandD: '#bda76c', sandL: '#ecdcac',

  stone: '#6d6a63', stoneD: '#4e4c47', stoneL: '#8b8880', stoneH: '#a5a29a',
  cave: '#5a5148', caveD: '#3d362e', caveL: '#7a6f62', caveH: '#94897a',
  dgn: '#4a4753', dgnD: '#302e39', dgnL: '#63606e', dgnH: '#7d7a89',
  gravel: '#7a736a',

  wood: '#7a5333', woodD: '#5a3c24', woodL: '#9a6b43', woodH: '#b58554',
  bark: '#6b4a2f', barkD: '#4a3220', barkL: '#8a6240',
  thatch: '#b8934f', thatchD: '#8d6f3a', thatchL: '#d2ae68',
  shingle: '#7b4a3c', shingleD: '#59342a', shingleL: '#9a6250',
  tileRoof: '#a55c3a', tileRoofD: '#7c412a', tileRoofL: '#c47a53',
  plaster: '#d6c9a6', plasterD: '#b3a683',

  brick: '#8a4f3c', brickD: '#67382a', brickL: '#a4674f',

  water: '#3a6ea5', waterD: '#2b5480', waterL: '#5b93c9', foam: '#a9d8ee',
  deep: '#23406b', deepD: '#182f52', deepL: '#33578a',
  swamp: '#4a6040', swampD: '#35482d', swampL: '#5f7a4f', scum: '#7d9a4c',
  ice: '#a9d6e8', iceD: '#7fb4cc', iceL: '#d8f1fb',
  snow: '#e9f0f5', snowD: '#c6d3de', snowS: '#adbccb',

  lavaCrust: '#5e2a17', lavaCrustD: '#3d1a0e', lava: '#e2531f', lavaHot: '#ff9a2a',
  lavaWhite: '#ffe07a',
  ash: '#57524e', ashD: '#3c3835', ashL: '#736d67', ashH: '#8e877f',

  metal: '#a9b1bf', metalD: '#767e8c', metalL: '#d5dae3',
  iron: '#5f6570', ironD: '#41464e',
  gold: '#e3b34a', goldD: '#a97f27', goldL: '#f5d987',
  silver: '#c9d1da',

  bone: '#ded7c0', boneD: '#ab9f83', boneL: '#f2ecd8',
  cloth: '#c8b58a', clothD: '#a2926c',
  red: '#a8342f', redD: '#7a211e', redL: '#c9564a',
  blue: '#37527a', blueD: '#263a58', blueL: '#5273a4',
  green: '#3f7a3a', purple: '#8a5ec2', purpleD: '#5b3c86',

  leaf: '#3f7a3a', leafD: '#2c5a29', leafL: '#57a04c', leafH: '#74bd63',
  pine: '#2f5f45', pineD: '#204431', pineL: '#3f7d59', pineH: '#559970',
  moss: '#5c7a3a', mossD: '#42582a',

  fire: '#ff9a2a', fireHot: '#ffe07a', fireD: '#e2531f', ember: '#c03a12',
  crystal: '#79cfe6', crystalD: '#4a9cb8', crystalL: '#c8f2ff',
  glow: '#9ce8ff',
  ink: '#241b14', shadow: 'rgba(0,0,0,0.28)',
};

// ---------------------------------------------------------------------------
// 2. DRAWING PRIMITIVES
// ---------------------------------------------------------------------------

/** Filled rect at integer pixels. */
function R(c, col, x, y, w, h) { c.fillStyle = col; c.fillRect(x | 0, y | 0, w | 0, h | 0); }
/** Single pixel. */
function P(c, col, x, y) { c.fillStyle = col; c.fillRect(x | 0, y | 0, 1, 1); }
/** Horizontal / vertical 1px runs. */
function H(c, col, x, y, w) { R(c, col, x, y, w, 1); }
function V(c, col, x, y, h) { R(c, col, x, y, 1, h); }
/** 1px rectangle outline. */
function O(c, col, x, y, w, h) { H(c, col, x, y, w); H(c, col, x, y + h - 1, w); V(c, col, x, y, h); V(c, col, x + w - 1, y, h); }

/** Paint an organic shape from [dy, dx, width] rows. */
function blob(c, col, x, y, rows) { for (let i = 0; i < rows.length; i++) { const q = rows[i]; R(c, col, x + q[1], y + q[0], q[2], 1); } }
/** Mirror a blob row list horizontally inside a `w`-wide box. */
function mirror(rows, w = 16) { return rows.map((q) => [q[0], w - q[1] - q[2], q[2]]); }

/**
 * A tiny deterministic generator (mulberry32) used for speckle inside a draw.
 * Seeded from the variation seed so the same variant always paints identically.
 */
function sr(seed) {
  let a = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scatter n 1x1 pixels of `col` inside a box. */
function speck(c, col, x, y, n, r, w = 16, h = 16, ox = 0, oy = 0) {
  for (let i = 0; i < n; i++) P(c, col, x + ox + Math.floor(r() * w), y + oy + Math.floor(r() * h));
}
/** Scatter n short horizontal dashes. */
function dashes(c, col, x, y, n, r, len = 2, w = 15, h = 16) {
  for (let i = 0; i < n; i++) R(c, col, x + Math.floor(r() * (w - len + 1)), y + Math.floor(r() * h), len, 1);
}
/** Scatter n short vertical blades. */
function blades(c, col, x, y, n, r, len = 2) {
  for (let i = 0; i < n; i++) R(c, col, x + Math.floor(r() * 16), y + Math.floor(r() * (16 - len)), 1, len);
}

/** A soft contact shadow under a prop. */
function contact(c, x, y, w = 10, yy = 14) {
  c.fillStyle = 'rgba(20,14,10,0.22)';
  c.fillRect(x + ((16 - w) >> 1), y + yy, w, 2);
}

// --- shared terrain bases --------------------------------------------------

function grassBase(c, x, y, r, base = PAL.grass) {
  R(c, base, x, y, 16, 16);
  dashes(c, PAL.grassD, x, y, 7, r, 2);
  speck(c, PAL.grassL, x, y, 6, r);
  blades(c, PAL.grassH, x, y, 3, r, 2);
}

function dirtBase(c, x, y, r, base = PAL.dirt) {
  R(c, base, x, y, 16, 16);
  dashes(c, PAL.dirtD, x, y, 8, r, 2);
  speck(c, PAL.dirtL, x, y, 7, r);
}

function stoneSlabs(c, x, y, base, dark, light) {
  R(c, base, x, y, 16, 16);
  // 2x2 slabs of 7x7 with a mortar gutter.
  H(c, dark, x, y + 7, 16); H(c, dark, x, y + 15, 16);
  V(c, dark, x + 7, y, 16); V(c, dark, x + 15, y, 16);
  H(c, light, x, y, 7); H(c, light, x + 8, y, 7);
  H(c, light, x, y + 8, 7); H(c, light, x + 8, y + 8, 7);
}

function caveBase(c, x, y, r) {
  R(c, PAL.cave, x, y, 16, 16);
  for (let i = 0; i < 6; i++) R(c, PAL.caveD, x + Math.floor(r() * 13), y + Math.floor(r() * 14), 3, 2);
  speck(c, PAL.caveL, x, y, 9, r);
}

function plankRun(c, x, y, vertical, base, dark, light) {
  R(c, base, x, y, 16, 16);
  for (let i = 0; i < 4; i++) {
    const o = i * 4;
    if (vertical) { V(c, dark, x + o + 3, y, 16); V(c, light, x + o, y, 16); }
    else { H(c, dark, x, y + o + 3, 16); H(c, light, x, y + o, 16); }
  }
}

// ---------------------------------------------------------------------------
// 3. REGISTRY
// ---------------------------------------------------------------------------

/** id -> definition. */
export const TILES = {};
/** NAME -> id. */
export const T = {};
/** NAME -> definition (handy for tools/editors). */
export const TILES_BY_NAME = {};

let nextId = 0;
let built = false;

/**
 * Register one tile.
 *   key   UPPER_SNAKE constant name exposed on `T`
 *   name  human label shown in the map editor / debug overlay
 *   flags TF bit field
 *   opts  { layer, group, biomes, variants, animFrames, fps }
 *   draw  (ctx, x, y, seed, seed2, frame)
 */
function def(key, name, flags, opts, draw) {
  const id = nextId++;
  const d = {
    id, key, name,
    flags: flags | 0,
    layer: opts.layer || 'ground',
    group: opts.group || null,
    biomes: opts.biomes || [],
    variants: Math.max(1, opts.variants || 1),
    animFrames: Math.max(1, opts.animFrames || 1),
    fps: opts.fps || 4,
    draw,
  };
  TILES[id] = d;
  T[key] = id;
  TILES_BY_NAME[key] = d;
  return id;
}

// ---------------------------------------------------------------------------
// 4. TILE DEFINITIONS
// ---------------------------------------------------------------------------

function buildTiles() {
  if (built) return;
  built = true;

  // --- 4.1 void ------------------------------------------------------------
  def('VOID', 'Void', SOLID, { layer: 'ground', biomes: [] }, (c, x, y) => {
    R(c, PAL.void, x, y, 16, 16);
    R(c, PAL.voidL, x, y, 8, 8); R(c, PAL.voidL, x + 8, y + 8, 8, 8);
  });

  // --- 4.2 grass & meadow --------------------------------------------------
  def('GRASS', 'Grass', 0, { group: 'grass', biomes: ['plains', 'forest', 'road', 'hills'], variants: 4 },
    (c, x, y, v) => { grassBase(c, x, y, sr(v)); });

  def('GRASS_2', 'Grass', 0, { group: 'grass', biomes: ['plains', 'forest'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v); grassBase(c, x, y, r);
    blades(c, PAL.grassH, x, y, 5, r, 3);
    dashes(c, PAL.grassD, x, y, 3, r, 3);
  });

  def('GRASS_3', 'Grass', 0, { group: 'grass', biomes: ['plains', 'hills'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v); grassBase(c, x, y, r, PAL.grassL);
    dashes(c, PAL.grass, x, y, 9, r, 3);
    speck(c, PAL.grassH, x, y, 5, r);
  });

  def('GRASS_4', 'Dry Grass', 0, { group: 'grass', biomes: ['plains', 'road', 'coast'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v); grassBase(c, x, y, r);
    dashes(c, PAL.grassDry, x, y, 6, r, 2);
    speck(c, PAL.dirtL, x, y, 4, r);
  });

  // The encounter tile: darker ground, blades that break the top edge.
  def('GRASS_TALL', 'Tall Grass', ENCOUNTER | SLOW, { group: 'grass', biomes: ['plains', 'forest', 'marsh'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.tallD, x, y, 16, 16);
      dashes(c, PAL.tall, x, y, 8, r, 3);
      for (let i = 0; i < 12; i++) {
        const bx = x + Math.floor(r() * 16), by = y + 2 + Math.floor(r() * 9), hgt = 4 + Math.floor(r() * 3);
        R(c, PAL.tall, bx, by, 1, hgt);
        P(c, PAL.tallL, bx, by);
      }
      for (let i = 0; i < 4; i++) {
        const bx = x + 1 + Math.floor(r() * 14);
        R(c, PAL.tallL, bx, y + Math.floor(r() * 3), 1, 6);
      }
      H(c, PAL.tallD, x, y + 15, 16);
    });

  const flower = (key, label, petal, petalD, core) => def(key, label, 0, { group: 'grass', biomes: ['plains', 'forest'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v); grassBase(c, x, y, r);
      for (let i = 0; i < 4; i++) {
        const fx = x + 2 + Math.floor(r() * 12), fy = y + 3 + Math.floor(r() * 10);
        V(c, PAL.grassD, fx, fy + 2, 2);
        P(c, petalD, fx - 1, fy + 1); P(c, petal, fx, fy + 1); P(c, petal, fx + 1, fy + 1);
        P(c, petal, fx, fy); P(c, core, fx, fy + 1);
      }
    });
  flower('FLOWERS_RED', 'Wildflowers', '#d24a44', '#a02f2b', '#f2d67a');
  flower('FLOWERS_YELLOW', 'Wildflowers', '#e8c451', '#b6913a', '#fff0b8');
  flower('FLOWERS_BLUE', 'Wildflowers', '#6d8fd6', '#43629f', '#e6eeff');

  def('CLOVER', 'Clover', 0, { group: 'grass', biomes: ['plains', 'forest'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v); grassBase(c, x, y, r);
    for (let i = 0; i < 6; i++) {
      const fx = x + 1 + Math.floor(r() * 13), fy = y + 1 + Math.floor(r() * 13);
      P(c, PAL.clover, fx, fy); P(c, PAL.clover, fx + 1, fy); P(c, PAL.clover, fx, fy + 1);
      P(c, PAL.grassH, fx + 1, fy + 1);
    }
  });

  // --- 4.3 bare ground -----------------------------------------------------
  def('DIRT', 'Dirt', 0, { group: 'dirt', biomes: ['plains', 'road', 'cave', 'ruins'], variants: 4 },
    (c, x, y, v) => { const r = sr(v); dirtBase(c, x, y, r); for (let i = 0; i < 3; i++) R(c, PAL.dirtD, x + Math.floor(r() * 14), y + Math.floor(r() * 15), 2, 2); });

  def('DIRT_PATH', 'Path', 0, { group: 'dirt', biomes: ['road', 'plains', 'city'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.path, x, y, 16, 16);
    H(c, PAL.pathD, x, y, 16); H(c, PAL.pathD, x, y + 15, 16);
    dashes(c, PAL.pathL, x, y + 3, 6, r, 3, 15, 10);
    speck(c, PAL.pathD, x, y, 8, r);
    for (let i = 0; i < 3; i++) { const px = x + Math.floor(r() * 14), py = y + 2 + Math.floor(r() * 12); R(c, PAL.stoneL, px, py, 2, 1); P(c, PAL.stoneD, px, py + 1); }
  });

  def('COBBLE', 'Cobblestone', 0, { group: 'road', biomes: ['city', 'road', 'ruins'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.stoneD, x, y, 16, 16);
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) ? -2 : 0;
      for (let col = -1; col < 4; col++) {
        const sx = x + col * 5 + off + 1, sy = y + row * 4;
        if (sx > x + 15 || sx + 4 < x) continue;
        const tone = r() < 0.3 ? PAL.stoneL : (r() < 0.5 ? PAL.gravel : PAL.stone);
        const w = Math.min(4, x + 16 - sx), w2 = Math.max(0, w);
        if (w2 <= 0) continue;
        R(c, tone, Math.max(x, sx), sy, Math.min(w2, 4), 3);
        H(c, PAL.stoneH, Math.max(x, sx), sy, Math.min(w2, 4) - 1);
      }
    }
  });

  def('FLAGSTONE', 'Flagstone', 0, { group: 'road', biomes: ['city', 'ruins', 'dungeon'], variants: 3 },
    (c, x, y, v) => { const r = sr(v); stoneSlabs(c, x, y, PAL.stone, PAL.stoneD, PAL.stoneL); speck(c, PAL.stoneH, x, y, 4, r); });

  def('GRAVEL', 'Gravel', SLOW, { group: 'dirt', biomes: ['mountain', 'hills', 'mine', 'coast'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.stoneD, x, y, 16, 16);
    for (let i = 0; i < 22; i++) {
      const px = x + Math.floor(r() * 15), py = y + Math.floor(r() * 15);
      R(c, r() < 0.4 ? PAL.stoneL : PAL.gravel, px, py, 2, 1);
      P(c, PAL.stoneH, px, py);
    }
  });

  def('SAND', 'Sand', 0, { group: 'sand', biomes: ['coast', 'ruins'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.sand, x, y, 16, 16);
    for (let i = 0; i < 4; i++) {
      const ly = y + 2 + i * 4 + Math.floor(r() * 2);
      H(c, PAL.sandD, x + Math.floor(r() * 4), ly, 6 + Math.floor(r() * 5));
    }
    speck(c, PAL.sandL, x, y, 6, r);
  });

  def('MUD', 'Mud', SLOW, { group: 'dirt', biomes: ['marsh', 'road', 'plains'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.mud, x, y, 16, 16);
    for (let i = 0; i < 5; i++) R(c, PAL.mudD, x + Math.floor(r() * 12), y + Math.floor(r() * 13), 4, 3);
    speck(c, PAL.mudL, x, y, 5, r);
    P(c, PAL.waterL, x + 4 + Math.floor(r() * 8), y + 4 + Math.floor(r() * 8));
  });

  // --- 4.4 farmland --------------------------------------------------------
  def('FARMLAND', 'Furrows', 0, { group: 'dirt', biomes: ['plains'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.dirt, x, y, 16, 16);
    for (let i = 0; i < 4; i++) { H(c, PAL.dirtL, x, y + i * 4, 16); H(c, PAL.dirtD, x, y + i * 4 + 2, 16); }
    speck(c, PAL.dirtD, x, y, 6, r);
  });

  def('CROP_WHEAT', 'Wheat', SLOW, { group: 'crop', biomes: ['plains'], variants: 2, animFrames: 3, fps: 2 }, (c, x, y, v, w, f) => {
    const r = sr(v);
    R(c, PAL.dirt, x, y, 16, 16);
    for (let i = 0; i < 4; i++) H(c, PAL.dirtD, x, y + i * 4 + 2, 16);
    const sway = [0, 1, 0, -1][f % 4] || 0;
    for (let i = 0; i < 6; i++) {
      const sx = x + 1 + Math.floor(r() * 14), sy = y + 3 + Math.floor(r() * 5);
      R(c, PAL.grassDry, sx, sy, 1, 16 - (sy - y) - 1);
      const hx = sx + sway;
      R(c, '#d9c26a', hx, sy - 2, 2, 3); P(c, '#f0e0a4', hx, sy - 2);
    }
  });

  def('CROP_CABBAGE', 'Cabbages', SLOW, { group: 'crop', biomes: ['plains'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.dirt, x, y, 16, 16);
    for (let i = 0; i < 4; i++) H(c, PAL.dirtD, x, y + i * 4 + 2, 16);
    for (let i = 0; i < 4; i++) {
      const cx = x + 1 + Math.floor(r() * 11), cy = y + 1 + Math.floor(r() * 11);
      blob(c, PAL.leaf, cx, cy, [[0, 1, 2], [1, 0, 4], [2, 0, 4], [3, 1, 2]]);
      P(c, PAL.leafH, cx + 1, cy + 1); P(c, PAL.leafD, cx + 2, cy + 2);
    }
  });

  // --- 4.5 water -----------------------------------------------------------
  def('WATER', 'Water', WATER | SLOW, { group: 'water', biomes: ['coast', 'plains', 'marsh'], variants: 2, animFrames: 4, fps: 3 },
    (c, x, y, v, w, f) => {
      const r = sr(v);
      R(c, PAL.water, x, y, 16, 16);
      for (let i = 0; i < 5; i++) H(c, PAL.waterD, x + Math.floor(r() * 6), y + Math.floor(r() * 15), 5 + Math.floor(r() * 5));
      // the crest line drifts down the tile and wraps
      const cy = y + ((f * 4 + 2) % 16);
      H(c, PAL.waterL, x + 1, cy, 6); H(c, PAL.waterL, x + 9, cy + 1, 5);
      H(c, PAL.foam, x + 2, cy, 3); P(c, PAL.foam, x + 10, cy + 1);
      P(c, PAL.foam, x + ((f * 5 + 3) % 15), y + ((f * 7 + 9) % 15));
    });

  def('WATER_DEEP', 'Deep Water', WATER | SOLID, { group: 'water', biomes: ['coast'], variants: 2, animFrames: 4, fps: 2 },
    (c, x, y, v, w, f) => {
      const r = sr(v);
      R(c, PAL.deep, x, y, 16, 16);
      for (let i = 0; i < 6; i++) H(c, PAL.deepD, x + Math.floor(r() * 8), y + Math.floor(r() * 15), 4 + Math.floor(r() * 6));
      const cy = y + ((f * 4 + 6) % 16);
      H(c, PAL.deepL, x + 3, cy, 7); P(c, PAL.waterL, x + 4, cy);
    });

  // Eight shore cases. `sides` lists the edges the WATER lies on.
  const shore = (key, label, sides) => def(key, label, WATER | SLOW, { group: 'water', biomes: ['coast', 'plains'], variants: 2, animFrames: 4, fps: 3 },
    (c, x, y, v, w, f) => {
      const r = sr(v);
      R(c, PAL.sand, x, y, 16, 16);
      speck(c, PAL.sandD, x, y, 8, r);
      const band = 6, wob = (f % 2);
      const paint = (px, py, pw, ph) => {
        R(c, PAL.water, px, py, pw, ph);
        for (let i = 0; i < 3; i++) H(c, PAL.waterD, px + Math.floor(r() * 4), py + Math.floor(r() * Math.max(1, ph)), 4);
      };
      if (sides.includes('N')) { paint(x, y, 16, band - wob); H(c, PAL.foam, x, y + band - wob, 16); H(c, PAL.sandD, x, y + band - wob + 1, 16); }
      if (sides.includes('S')) { paint(x, y + 16 - band + wob, 16, band - wob); H(c, PAL.foam, x, y + 16 - band + wob - 1, 16); H(c, PAL.sandD, x, y + 16 - band + wob - 2, 16); }
      if (sides.includes('W')) { paint(x, y, band - wob, 16); V(c, PAL.foam, x + band - wob, y, 16); V(c, PAL.sandD, x + band - wob + 1, y, 16); }
      if (sides.includes('E')) { paint(x + 16 - band + wob, y, band - wob, 16); V(c, PAL.foam, x + 16 - band + wob - 1, y, 16); V(c, PAL.sandD, x + 16 - band + wob - 2, y, 16); }
    });
  shore('SHORE_N', 'Shore', ['N']);
  shore('SHORE_E', 'Shore', ['E']);
  shore('SHORE_S', 'Shore', ['S']);
  shore('SHORE_W', 'Shore', ['W']);
  shore('SHORE_NE', 'Shore', ['N', 'E']);
  shore('SHORE_SE', 'Shore', ['S', 'E']);
  shore('SHORE_SW', 'Shore', ['S', 'W']);
  shore('SHORE_NW', 'Shore', ['N', 'W']);

  def('RIVER_BEND', 'River Bend', WATER | SLOW, { group: 'water', biomes: ['plains', 'forest'], variants: 1, animFrames: 4, fps: 3 },
    (c, x, y, v, w, f) => {
      const r = sr(v);
      R(c, PAL.water, x, y, 16, 16);
      // a bank sweeping through the lower-left corner
      blob(c, PAL.sand, x, y, [[9, 0, 3], [10, 0, 5], [11, 0, 7], [12, 0, 9], [13, 0, 11], [14, 0, 13], [15, 0, 16]]);
      blob(c, PAL.foam, x, y, [[9, 3, 1], [10, 5, 1], [11, 7, 1], [12, 9, 1], [13, 11, 1], [14, 13, 1]]);
      for (let i = 0; i < 4; i++) H(c, PAL.waterD, x + Math.floor(r() * 8), y + Math.floor(r() * 9), 5);
      H(c, PAL.waterL, x + 4, y + ((f * 3 + 1) % 8), 7);
    });

  def('ICE', 'Ice', SLOW, { group: 'ice', biomes: ['tundra', 'mountain'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.ice, x, y, 16, 16);
    for (let i = 0; i < 3; i++) {
      let cx = x + Math.floor(r() * 14), cy = y + Math.floor(r() * 6);
      for (let s = 0; s < 6; s++) { P(c, PAL.iceD, cx, cy); cx += r() < 0.5 ? 1 : 0; cy += 1; if (cy > y + 15) break; }
    }
    H(c, PAL.iceL, x + 2, y + 3, 6); H(c, PAL.iceL, x + 8, y + 10, 5);
  });

  def('SNOW', 'Snow', SLOW, { group: 'snow', biomes: ['tundra', 'mountain'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.snow, x, y, 16, 16);
    speck(c, PAL.snowD, x, y, 10, r);
    for (let i = 0; i < 3; i++) H(c, PAL.snowS, x + Math.floor(r() * 8), y + Math.floor(r() * 15), 5);
    H(c, PAL.snowD, x, y + 15, 16);
  });

  def('SNOW_GRASS', 'Snowy Grass', 0, { group: 'snow', biomes: ['tundra', 'pine-forest'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.snow, x, y, 16, 16);
    speck(c, PAL.snowD, x, y, 6, r);
    for (let i = 0; i < 8; i++) { const bx = x + Math.floor(r() * 16), by = y + 8 + Math.floor(r() * 6); R(c, PAL.grassD, bx, by, 1, 16 - (by - y)); P(c, PAL.grass, bx, by); }
    H(c, PAL.grassD, x, y + 15, 16);
  });

  def('SWAMP_WATER', 'Bog Water', WATER | SLOW | ENCOUNTER, { group: 'water', biomes: ['marsh'], variants: 2, animFrames: 2, fps: 1.5 },
    (c, x, y, v, w, f) => {
      const r = sr(v);
      R(c, PAL.swamp, x, y, 16, 16);
      for (let i = 0; i < 7; i++) R(c, PAL.swampD, x + Math.floor(r() * 12), y + Math.floor(r() * 14), 4, 2);
      for (let i = 0; i < 6; i++) P(c, PAL.scum, x + ((Math.floor(r() * 16) + f) % 16), y + Math.floor(r() * 16));
      H(c, PAL.swampL, x + 2 + f, y + 5, 5); H(c, PAL.swampL, x + 8 - f, y + 11, 4);
    });

  def('LILY_PAD', 'Lily Pad', 0, { layer: 'deco', group: 'plant', biomes: ['marsh'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    const ox = Math.floor(r() * 4), oy = Math.floor(r() * 4);
    blob(c, PAL.leaf, x + ox, y + oy, [[0, 3, 5], [1, 1, 9], [2, 0, 11], [3, 0, 11], [4, 1, 9], [5, 3, 5]]);
    H(c, PAL.leafL, x + ox + 3, y + oy + 1, 4);
    V(c, PAL.swampD, x + ox + 5, y + oy + 2, 3);
    if (r() < 0.5) { P(c, '#e8a8c8', x + ox + 8, y + oy + 2); P(c, '#f4d0e0', x + ox + 8, y + oy + 1); }
  });

  // --- 4.6 volcanic --------------------------------------------------------
  def('LAVA', 'Lava', SOLID | DAMAGE, { group: 'lava', biomes: ['ash-waste', 'underdark', 'cave'], variants: 2, animFrames: 4, fps: 4 },
    (c, x, y, v, w, f) => {
      const r = sr(v);
      R(c, PAL.lavaCrust, x, y, 16, 16);
      speck(c, PAL.lavaCrustD, x, y, 10, r);
      // glowing cracks that pulse through 4 frames
      for (let i = 0; i < 4; i++) {
        let cx = x + Math.floor(r() * 14), cy = y + Math.floor(r() * 14);
        const len = 4 + ((f + i) % 3);
        for (let s = 0; s < len; s++) {
          P(c, s === 0 ? PAL.lavaWhite : (s < 2 ? PAL.lavaHot : PAL.lava), cx, cy);
          cx += (r() < 0.55 ? 1 : 0); cy += (r() < 0.5 ? 1 : 0);
          if (cx > x + 15 || cy > y + 15) break;
        }
      }
      P(c, PAL.lavaWhite, x + ((f * 5 + 2) % 15), y + ((f * 3 + 6) % 15));
    });

  def('ASH_GROUND', 'Ash', 0, { group: 'ash', biomes: ['ash-waste'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.ash, x, y, 16, 16);
    speck(c, PAL.ashD, x, y, 12, r);
    speck(c, PAL.ashL, x, y, 7, r);
  });

  def('ASH_DRIFT', 'Ash Drift', SLOW, { group: 'ash', biomes: ['ash-waste'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.ash, x, y, 16, 16);
    for (let i = 0; i < 3; i++) {
      const dx = x + Math.floor(r() * 6), dy = y + 2 + Math.floor(r() * 10);
      blob(c, PAL.ashL, dx, dy, [[0, 2, 5], [1, 0, 9], [2, 0, 10]]);
      H(c, PAL.ashH, dx + 3, dy, 3);
    }
    speck(c, PAL.ashD, x, y, 8, r);
  });

  // --- 4.7 built floors ----------------------------------------------------
  def('STONE_FLOOR', 'Stone Floor', 0, { group: 'floor', biomes: ['dungeon', 'ruins', 'city', 'crypt'], variants: 3 },
    (c, x, y, v) => { const r = sr(v); stoneSlabs(c, x, y, PAL.stone, PAL.stoneD, PAL.stoneL); speck(c, PAL.stoneH, x, y, 3, r); });

  def('STONE_FLOOR_CRACKED', 'Cracked Floor', 0, { group: 'floor', biomes: ['dungeon', 'ruins', 'crypt'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v); stoneSlabs(c, x, y, PAL.stone, PAL.stoneD, PAL.stoneL);
      for (let i = 0; i < 2; i++) {
        let cx = x + 2 + Math.floor(r() * 11), cy = y + 1 + Math.floor(r() * 5);
        for (let s = 0; s < 8; s++) { P(c, PAL.stoneD, cx, cy); cx += r() < 0.5 ? 1 : (r() < 0.5 ? -1 : 0); cy++; if (cy > y + 15 || cx < x || cx > x + 15) break; }
      }
      speck(c, PAL.stoneD, x, y, 5, r);
    });

  def('CAVE_FLOOR', 'Cave Floor', 0, { group: 'floor', biomes: ['cave', 'mine', 'underdark'], variants: 4 },
    (c, x, y, v) => { caveBase(c, x, y, sr(v)); });

  def('CAVE_FLOOR_RUBBLE', 'Rubbled Floor', SLOW, { group: 'floor', biomes: ['cave', 'mine', 'underdark'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v); caveBase(c, x, y, r);
      for (let i = 0; i < 9; i++) { const px = x + Math.floor(r() * 14), py = y + Math.floor(r() * 15); R(c, PAL.stone, px, py, 2, 1); P(c, PAL.stoneL, px, py); }
    });

  def('WOOD_FLOOR', 'Wood Floor', 0, { group: 'floor', biomes: ['city'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v); plankRun(c, x, y, true, PAL.wood, PAL.woodD, PAL.woodL);
    dashes(c, PAL.woodD, x, y, 5, r, 2);
    P(c, PAL.ink, x + 1, y + 3); P(c, PAL.ink, x + 9, y + 11);
  });

  def('WOOD_FLOOR_H', 'Wood Floor', 0, { group: 'floor', biomes: ['city'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v); plankRun(c, x, y, false, PAL.wood, PAL.woodD, PAL.woodL);
    dashes(c, PAL.woodD, x, y, 5, r, 3);
    P(c, PAL.ink, x + 3, y + 1); P(c, PAL.ink, x + 12, y + 9);
  });

  const carpet = (key, label, base, dark, light) => def(key, label, 0, { group: 'floor', biomes: ['city', 'dungeon'], variants: 2 },
    (c, x, y) => {
      R(c, base, x, y, 16, 16);
      O(c, PAL.gold, x, y, 16, 16); O(c, dark, x + 1, y + 1, 14, 14);
      R(c, light, x + 7, y + 5, 2, 2); R(c, light, x + 3, y + 9, 2, 2); R(c, light, x + 11, y + 9, 2, 2);
      P(c, PAL.goldL, x + 7, y + 5); P(c, PAL.goldL, x + 3, y + 9); P(c, PAL.goldL, x + 11, y + 9);
    });
  carpet('CARPET_RED', 'Red Carpet', PAL.red, PAL.redD, PAL.redL);
  carpet('CARPET_BLUE', 'Blue Carpet', PAL.blue, PAL.blueD, PAL.blueL);

  def('MOSAIC', 'Mosaic', 0, { group: 'floor', biomes: ['city', 'ruins', 'dungeon'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.stoneL, x, y, 16, 16);
    O(c, PAL.stoneD, x, y, 16, 16);
    blob(c, PAL.blue, x, y, [[3, 7, 2], [4, 6, 4], [5, 5, 6], [6, 4, 8], [7, 3, 10], [8, 4, 8], [9, 5, 6], [10, 6, 4], [11, 7, 2]]);
    blob(c, PAL.gold, x, y, [[5, 7, 2], [6, 6, 4], [7, 5, 6], [8, 6, 4], [9, 7, 2]]);
    P(c, PAL.goldL, x + 7, y + 7);
    if (r() < 0.5) { P(c, PAL.redD, x + 1, y + 1); P(c, PAL.redD, x + 14, y + 14); }
  });

  def('DUNGEON_FLOOR', 'Dungeon Brick', 0, { group: 'floor', biomes: ['dungeon', 'crypt', 'underdark'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.dgn, x, y, 16, 16);
      for (let row = 0; row < 4; row++) {
        const oy = y + row * 4, off = (row % 2) ? 4 : 0;
        H(c, PAL.dgnD, x, oy + 3, 16);
        for (let i = -1; i < 3; i++) { const bx = x + off + i * 8; if (bx >= x && bx < x + 16) V(c, PAL.dgnD, bx, oy, 3); }
        H(c, PAL.dgnL, x, oy, 16);
      }
      speck(c, PAL.dgnH, x, y, 4, r);
    });

  def('BONE_FLOOR', 'Bone-strewn Floor', SLOW, { group: 'floor', biomes: ['crypt', 'dungeon', 'cave'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.dgn, x, y, 16, 16);
      for (let row = 0; row < 4; row++) H(c, PAL.dgnD, x, y + row * 4 + 3, 16);
      for (let i = 0; i < 3; i++) {
        const bx = x + Math.floor(r() * 11), by = y + Math.floor(r() * 14);
        R(c, PAL.bone, bx, by, 4, 1); P(c, PAL.boneL, bx, by); P(c, PAL.boneD, bx + 3, by + 1);
      }
      // a small skull
      const sx = x + 2 + Math.floor(r() * 9), sy = y + 3 + Math.floor(r() * 8);
      R(c, PAL.bone, sx, sy, 4, 3); P(c, PAL.ink, sx + 1, sy + 1); P(c, PAL.ink, sx + 2, sy + 1);
    });

  // --- 4.8 walls -----------------------------------------------------------
  def('STONE_WALL', 'Stone Wall', SOLID, { layer: 'deco', group: 'wall', biomes: ['city', 'ruins', 'dungeon'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      // top cap (the bit you see from above) then the face below it
      R(c, PAL.stoneL, x, y, 16, 4); H(c, PAL.stoneH, x, y, 16); H(c, PAL.stoneD, x, y + 4, 16);
      R(c, PAL.stone, x, y + 5, 16, 11);
      for (let row = 0; row < 3; row++) {
        const oy = y + 5 + row * 4, off = (row % 2) ? 3 : 0;
        H(c, PAL.stoneD, x, oy + 3, 16);
        for (let i = -1; i < 4; i++) { const bx = x + off + i * 6; if (bx > x && bx < x + 16) V(c, PAL.stoneD, bx, oy, 3); }
        H(c, PAL.stoneH, x, oy, 16);
      }
      speck(c, PAL.stoneD, x, y + 5, 4, r, 16, 11);
    });

  def('STONE_WALL_TOP', 'Wall Top', SOLID, { layer: 'deco', group: 'wall', biomes: ['city', 'ruins'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.stoneL, x, y, 16, 16);
      for (let row = 0; row < 4; row++) { H(c, PAL.stoneD, x, y + row * 4 + 3, 16); V(c, PAL.stoneD, x + ((row % 2) ? 5 : 11), y + row * 4, 3); }
      speck(c, PAL.stoneH, x, y, 6, r);
    });

  def('BRICK_WALL', 'Brick Wall', SOLID, { layer: 'deco', group: 'wall', biomes: ['city', 'dungeon'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.brick, x, y, 16, 16);
      for (let row = 0; row < 5; row++) {
        const oy = y + row * 3, off = (row % 2) ? 4 : 0;
        H(c, PAL.brickD, x, oy + 2, 16);
        for (let i = -1; i < 3; i++) { const bx = x + off + i * 8; if (bx > x && bx < x + 16) V(c, PAL.brickD, bx, oy, 2); }
        H(c, PAL.brickL, x, oy, 16);
      }
      speck(c, PAL.brickD, x, y, 5, r);
    });

  // Phandalin's houses: fieldstone footing, lime plaster, dark timber framing.
  def('WATTLE_WALL', 'Timber Wall', SOLID, { layer: 'deco', group: 'wall', biomes: ['city'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.plaster, x, y, 16, 16);
      speck(c, PAL.plasterD, x, y, 8, r);
      R(c, PAL.woodD, x, y, 16, 2);           // head beam
      R(c, PAL.woodD, x, y + 14, 16, 2);      // sill
      R(c, PAL.woodD, x, y, 2, 16); R(c, PAL.woodD, x + 14, y, 2, 16);  // posts
      // diagonal brace
      for (let i = 0; i < 11; i++) { P(c, PAL.wood, x + 2 + i, y + 13 - i); P(c, PAL.woodD, x + 3 + i, y + 13 - i); }
      H(c, PAL.woodL, x, y, 16); V(c, PAL.woodL, x, y, 16);
      R(c, PAL.stoneD, x, y + 15, 16, 1);
    });

  def('LOG_WALL', 'Log Wall', SOLID, { layer: 'deco', group: 'wall', biomes: ['city', 'forest'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      for (let i = 0; i < 4; i++) {
        const oy = y + i * 4;
        R(c, PAL.wood, x, oy, 16, 4);
        H(c, PAL.woodL, x, oy, 16);
        H(c, PAL.woodD, x, oy + 3, 16);
        R(c, PAL.barkD, x, oy + 1, 2, 2); R(c, PAL.barkD, x + 14, oy + 1, 2, 2);
      }
      dashes(c, PAL.woodD, x, y, 4, r, 3);
    });

  def('DUNGEON_WALL', 'Dungeon Wall', SOLID, { layer: 'deco', group: 'wall', biomes: ['dungeon', 'crypt', 'underdark'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.dgn, x, y, 16, 16);
      for (let row = 0; row < 4; row++) {
        const oy = y + row * 4, off = (row % 2) ? 4 : 0;
        H(c, PAL.dgnD, x, oy + 3, 16);
        for (let i = -1; i < 3; i++) { const bx = x + off + i * 8; if (bx > x && bx < x + 16) V(c, PAL.dgnD, bx, oy, 3); }
        H(c, PAL.dgnL, x, oy, 16);
      }
      for (let i = 0; i < 3; i++) P(c, PAL.moss, x + Math.floor(r() * 16), y + Math.floor(r() * 16));
      H(c, PAL.dgnH, x, y, 16);
    });

  def('RUINED_WALL', 'Ruined Wall', SOLID, { layer: 'deco', group: 'wall', biomes: ['ruins', 'plains', 'forest'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      const top = 3 + Math.floor(r() * 4);
      // jagged broken crest
      for (let i = 0; i < 16; i++) { const h0 = top + (r() < 0.4 ? 1 : 0); R(c, PAL.stone, x + i, y + h0, 1, 16 - h0); P(c, PAL.stoneH, x + i, y + h0); }
      for (let row = 0; row < 3; row++) { const oy = y + top + 3 + row * 4; if (oy < y + 16) H(c, PAL.stoneD, x, oy, 16); }
      V(c, PAL.stoneD, x + 5, y + top + 1, 14); V(c, PAL.stoneD, x + 11, y + top + 4, 11);
      for (let i = 0; i < 4; i++) P(c, PAL.moss, x + Math.floor(r() * 16), y + top + Math.floor(r() * (16 - top)));
      speck(c, PAL.stoneD, x, y + top, 4, r, 16, 16 - top);
    });

  def('PALISADE', 'Palisade', SOLID, { layer: 'deco', group: 'wall', biomes: ['plains', 'forest', 'city'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      for (let i = 0; i < 4; i++) {
        const px = x + i * 4, top = y + 1 + Math.floor(r() * 2);
        R(c, PAL.bark, px, top + 2, 4, 16 - (top - y) - 2);
        // sharpened point
        P(c, PAL.barkL, px + 1, top); P(c, PAL.barkL, px + 2, top);
        R(c, PAL.bark, px + 1, top + 1, 2, 1);
        V(c, PAL.barkL, px, top + 2, 14); V(c, PAL.barkD, px + 3, top + 2, 14);
      }
      H(c, PAL.woodD, x, y + 9, 16);
    });

  def('PILLAR', 'Pillar', SOLID, { layer: 'deco', group: 'wall', biomes: ['dungeon', 'ruins', 'city', 'crypt'], variants: 1 },
    (c, x, y) => {
      contact(c, x, y, 12, 14);
      R(c, PAL.stoneL, x + 2, y, 12, 3); H(c, PAL.stoneH, x + 2, y, 12); H(c, PAL.stoneD, x + 2, y + 3, 12);
      R(c, PAL.stone, x + 4, y + 3, 8, 10);
      V(c, PAL.stoneH, x + 5, y + 3, 10); V(c, PAL.stoneD, x + 8, y + 3, 10); V(c, PAL.stoneD, x + 11, y + 3, 10);
      R(c, PAL.stoneL, x + 2, y + 13, 12, 3); H(c, PAL.stoneH, x + 2, y + 13, 12); H(c, PAL.stoneD, x + 2, y + 15, 12);
    });

  def('TIMBER_SUPPORT', 'Mine Support', SOLID, { layer: 'deco', group: 'wall', biomes: ['mine', 'cave'], variants: 1 },
    (c, x, y) => {
      R(c, PAL.wood, x, y, 16, 3); H(c, PAL.woodL, x, y, 16); H(c, PAL.woodD, x, y + 2, 16);
      R(c, PAL.wood, x, y + 3, 3, 13); V(c, PAL.woodL, x, y + 3, 13); V(c, PAL.woodD, x + 2, y + 3, 13);
      R(c, PAL.wood, x + 13, y + 3, 3, 13); V(c, PAL.woodL, x + 13, y + 3, 13); V(c, PAL.woodD, x + 15, y + 3, 13);
      P(c, PAL.ink, x + 1, y + 6); P(c, PAL.ink, x + 14, y + 9);
    });

  // Cave wall + its eight autotile cases. `lit` names the side the light rim sits on.
  const caveWall = (key, label, lit) => def(key, label, SOLID, { layer: 'deco', group: 'cave-wall', biomes: ['cave', 'mine', 'underdark'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.caveD, x, y, 16, 16);
      for (let i = 0; i < 9; i++) {
        const px = x + Math.floor(r() * 12), py = y + Math.floor(r() * 12), w = 3 + Math.floor(r() * 3), h = 2 + Math.floor(r() * 3);
        R(c, PAL.cave, px, py, w, h); H(c, PAL.caveL, px, py, w);
      }
      speck(c, PAL.caveH, x, y, 5, r);
      if (lit.includes('N')) { H(c, PAL.caveH, x, y, 16); H(c, PAL.caveL, x, y + 1, 16); }
      if (lit.includes('S')) { H(c, PAL.caveL, x, y + 14, 16); H(c, '#241f19', x, y + 15, 16); }
      if (lit.includes('W')) { V(c, PAL.caveH, x, y, 16); V(c, PAL.caveL, x + 1, y, 16); }
      if (lit.includes('E')) { V(c, PAL.caveL, x + 14, y, 16); V(c, '#241f19', x + 15, y, 16); }
    });
  caveWall('CAVE_WALL', 'Cave Wall', '');
  caveWall('CAVE_WALL_N', 'Cave Wall', 'N');
  caveWall('CAVE_WALL_E', 'Cave Wall', 'E');
  caveWall('CAVE_WALL_S', 'Cave Wall', 'S');
  caveWall('CAVE_WALL_W', 'Cave Wall', 'W');
  caveWall('CAVE_WALL_NE', 'Cave Wall', 'NE');
  caveWall('CAVE_WALL_SE', 'Cave Wall', 'SE');
  caveWall('CAVE_WALL_SW', 'Cave Wall', 'SW');
  caveWall('CAVE_WALL_NW', 'Cave Wall', 'NW');

  // Cliffs / mountains: a rock face with strata, plus the eight edge cases.
  const cliff = (key, label, lit) => def(key, label, SOLID, { layer: 'deco', group: 'cliff', biomes: ['mountain', 'hills', 'coast'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.stoneD, x, y, 16, 16);
      for (let i = 0; i < 16; i += 1) {
        const h0 = 3 + Math.floor(r() * 3);
        R(c, PAL.stone, x + i, y + h0, 1, 16 - h0);
      }
      for (let i = 0; i < 5; i++) { const ly = y + 4 + Math.floor(r() * 11); H(c, PAL.stoneD, x + Math.floor(r() * 6), ly, 6 + Math.floor(r() * 5)); }
      for (let i = 0; i < 4; i++) { const ly = y + 5 + Math.floor(r() * 10); H(c, PAL.stoneL, x + Math.floor(r() * 8), ly, 4); }
      if (lit.includes('N')) { H(c, PAL.stoneH, x, y, 16); H(c, PAL.stoneL, x, y + 1, 16); H(c, PAL.stoneD, x, y + 2, 16); }
      if (lit.includes('S')) { H(c, PAL.stoneD, x, y + 14, 16); H(c, '#2f2d29', x, y + 15, 16); }
      if (lit.includes('W')) { V(c, PAL.stoneH, x, y, 16); V(c, PAL.stoneL, x + 1, y, 16); }
      if (lit.includes('E')) { V(c, PAL.stoneD, x + 14, y, 16); V(c, '#2f2d29', x + 15, y, 16); }
    });
  cliff('CLIFF', 'Cliff', '');
  cliff('CLIFF_N', 'Cliff', 'N');
  cliff('CLIFF_E', 'Cliff', 'E');
  cliff('CLIFF_S', 'Cliff', 'S');
  cliff('CLIFF_W', 'Cliff', 'W');
  cliff('CLIFF_NE', 'Cliff', 'NE');
  cliff('CLIFF_SE', 'Cliff', 'SE');
  cliff('CLIFF_SW', 'Cliff', 'SW');
  cliff('CLIFF_NW', 'Cliff', 'NW');

  def('CLIFF_TOP', 'Clifftop', 0, { group: 'cliff-top', biomes: ['mountain', 'hills'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.stoneL, x, y, 16, 16);
    for (let i = 0; i < 7; i++) { const px = x + Math.floor(r() * 12), py = y + Math.floor(r() * 13); R(c, PAL.stone, px, py, 4, 3); H(c, PAL.stoneH, px, py, 4); }
    speck(c, PAL.stoneD, x, y, 8, r);
  });

  def('MOUNTAIN', 'Mountain', SOLID, { layer: 'deco', group: 'cliff', biomes: ['mountain'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    blob(c, PAL.stoneD, x, y, [[2, 7, 2], [3, 6, 4], [4, 5, 6], [5, 4, 8], [6, 3, 10], [7, 2, 12], [8, 1, 14], [9, 1, 14], [10, 0, 16], [11, 0, 16], [12, 0, 16], [13, 0, 16], [14, 0, 16], [15, 0, 16]]);
    blob(c, PAL.stone, x, y, [[3, 7, 2], [4, 6, 3], [5, 5, 4], [6, 4, 6], [7, 3, 8], [8, 2, 10], [9, 2, 11], [10, 1, 13], [11, 1, 13], [12, 1, 14], [13, 0, 15], [14, 0, 15]]);
    blob(c, '#f0f4f8', x, y, [[2, 7, 2], [3, 6, 3], [4, 6, 2], [5, 5, 2]]);
    for (let i = 0; i < 5; i++) { const ly = y + 8 + Math.floor(r() * 7); H(c, PAL.stoneD, x + 1 + Math.floor(r() * 6), ly, 5); }
    for (let i = 0; i < 3; i++) H(c, PAL.stoneH, x + 3 + Math.floor(r() * 6), y + 7 + Math.floor(r() * 6), 3);
  });

  // --- 4.9 roofs -----------------------------------------------------------
  const thatchRow = (c, x, y, r, x0, w) => {
    R(c, PAL.thatch, x + x0, y, w, 16);
    for (let i = 0; i < 4; i++) { const ly = y + i * 4 + 2; H(c, PAL.thatchD, x + x0, ly, w); H(c, PAL.thatchL, x + x0, ly - 1, w); }
    for (let i = 0; i < 10; i++) { const px = x + x0 + Math.floor(r() * Math.max(1, w)); V(c, PAL.thatchD, px, y + Math.floor(r() * 14), 2); }
  };
  def('THATCH_L', 'Thatch Roof', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v); thatchRow(c, x, y, r, 2, 14);
    for (let i = 0; i < 16; i++) P(c, PAL.thatchD, x + 2, y + i);
    blob(c, PAL.thatchL, x, y, [[0, 2, 3], [1, 2, 2]]);
    V(c, PAL.ink, x + 1, y, 16);
  });
  def('THATCH_M', 'Thatch Roof', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v); thatchRow(c, x, y, r, 0, 16);
  });
  def('THATCH_R', 'Thatch Roof', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v); thatchRow(c, x, y, r, 0, 14);
    for (let i = 0; i < 16; i++) P(c, PAL.thatchD, x + 13, y + i);
    V(c, PAL.ink, x + 14, y, 16);
  });
  def('THATCH_RIDGE', 'Roof Ridge', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v); thatchRow(c, x, y, r, 0, 16);
    R(c, PAL.thatchD, x, y, 16, 5); H(c, PAL.thatchL, x, y + 1, 16); H(c, PAL.ink, x, y, 16);
    for (let i = 0; i < 6; i++) V(c, '#6f5729', x + Math.floor(r() * 16), y + 1, 4);
  });

  def('SHINGLE_ROOF', 'Shingle Roof', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.shingle, x, y, 16, 16);
    for (let row = 0; row < 4; row++) {
      const oy = y + row * 4, off = (row % 2) ? 2 : 0;
      H(c, PAL.shingleD, x, oy + 3, 16);
      H(c, PAL.shingleL, x, oy, 16);
      for (let i = -1; i < 4; i++) { const bx = x + off + i * 4; if (bx > x && bx < x + 16) V(c, PAL.shingleD, bx, oy, 4); }
    }
    speck(c, PAL.shingleD, x, y, 5, r);
  });

  def('TILE_ROOF', 'Tile Roof', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 2 }, (c, x, y) => {
    R(c, PAL.tileRoofD, x, y, 16, 16);
    for (let i = 0; i < 4; i++) {
      const px = x + i * 4;
      R(c, PAL.tileRoof, px, y, 3, 16);
      V(c, PAL.tileRoofL, px, y, 16);
    }
    for (let i = 0; i < 4; i++) H(c, PAL.tileRoofD, x, y + i * 4 + 3, 16);
  });

  def('ROOF_PEAK', 'Roof Peak', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 1 }, (c, x, y) => {
    blob(c, PAL.thatchD, x, y, [[1, 7, 2], [2, 6, 4], [3, 5, 6], [4, 4, 8], [5, 3, 10], [6, 2, 12], [7, 1, 14], [8, 0, 16], [9, 0, 16], [10, 0, 16], [11, 0, 16], [12, 0, 16], [13, 0, 16], [14, 0, 16], [15, 0, 16]]);
    blob(c, PAL.thatch, x, y, [[3, 6, 4], [4, 5, 6], [5, 4, 8], [6, 3, 10], [7, 2, 12], [8, 1, 14], [9, 1, 14], [10, 0, 16], [11, 0, 16], [12, 0, 16], [13, 0, 16]]);
    H(c, PAL.thatchL, x + 1, y + 9, 14); H(c, PAL.thatchL, x + 0, y + 13, 16);
    H(c, PAL.thatchD, x, y + 11, 16); H(c, PAL.thatchD, x, y + 15, 16);
  });

  def('CHIMNEY', 'Chimney', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 1, animFrames: 3, fps: 1.5 },
    (c, x, y, v, w, f) => {
      R(c, PAL.brick, x + 4, y + 3, 8, 13);
      for (let row = 0; row < 4; row++) { const oy = y + 4 + row * 3; H(c, PAL.brickD, x + 4, oy, 8); V(c, PAL.brickD, x + ((row % 2) ? 7 : 9), oy - 2, 2); }
      R(c, PAL.stoneL, x + 3, y + 2, 10, 2); H(c, PAL.stoneH, x + 3, y + 2, 10);
      R(c, PAL.ink, x + 6, y + 3, 4, 1);
      // smoke
      const s = f % 3;
      P(c, '#9a948e', x + 7 + s, y + 1); P(c, '#b6b0a8', x + 8 - s, y);
    });

  // --- 4.10 doors, windows, signs ------------------------------------------
  def('DOOR_CLOSED', 'Door', SOLID | DOOR | TRIGGER, { layer: 'deco', group: 'door', biomes: ['city', 'dungeon'], variants: 1 }, (c, x, y) => {
    R(c, PAL.stoneD, x, y, 16, 16);
    R(c, PAL.wood, x + 2, y + 1, 12, 15);
    for (let i = 0; i < 3; i++) V(c, PAL.woodD, x + 5 + i * 3, y + 1, 15);
    H(c, PAL.woodL, x + 2, y + 1, 12);
    R(c, PAL.iron, x + 2, y + 3, 12, 1); R(c, PAL.iron, x + 2, y + 12, 12, 1);
    P(c, PAL.gold, x + 11, y + 8); P(c, PAL.goldD, x + 11, y + 9);
    O(c, PAL.ink, x + 1, y, 14, 16);
  });

  def('DOOR_OPEN', 'Open Door', DOOR | TRIGGER, { layer: 'deco', group: 'door', biomes: ['city', 'dungeon'], variants: 1 }, (c, x, y) => {
    R(c, PAL.stoneD, x, y, 16, 16);
    R(c, '#181410', x + 3, y + 1, 11, 15);           // the dark interior beyond
    R(c, PAL.wood, x + 1, y + 1, 3, 15);             // the leaf swung aside
    V(c, PAL.woodL, x + 1, y + 1, 15); V(c, PAL.woodD, x + 3, y + 1, 15);
    O(c, PAL.ink, x + 1, y, 14, 16);
  });

  def('IRON_DOOR', 'Iron Door', SOLID | DOOR | TRIGGER, { layer: 'deco', group: 'door', biomes: ['dungeon', 'crypt', 'mine'], variants: 1 }, (c, x, y) => {
    R(c, PAL.dgnD, x, y, 16, 16);
    R(c, PAL.iron, x + 2, y + 1, 12, 15);
    H(c, PAL.metal, x + 2, y + 1, 12); H(c, PAL.metalD, x + 2, y + 15, 12);
    R(c, PAL.metalD, x + 2, y + 4, 12, 1); R(c, PAL.metalD, x + 2, y + 11, 12, 1);
    for (let i = 0; i < 4; i++) { P(c, PAL.metalL, x + 3 + i * 3, y + 3); P(c, PAL.metalL, x + 3 + i * 3, y + 13); }
    R(c, PAL.ink, x + 6, y + 7, 4, 2); H(c, PAL.metalL, x + 6, y + 7, 4);
    O(c, PAL.ink, x + 1, y, 14, 16);
  });

  def('WINDOW', 'Window', SOLID, { layer: 'deco', group: 'wall', biomes: ['city'], variants: 1 }, (c, x, y) => {
    R(c, PAL.plaster, x, y, 16, 16);
    R(c, PAL.woodD, x + 2, y + 3, 12, 10);
    R(c, '#2b3a46', x + 3, y + 4, 10, 8);
    V(c, PAL.woodD, x + 7, y + 4, 8); H(c, PAL.woodD, x + 3, y + 7, 10);
    H(c, '#48606e', x + 3, y + 4, 4);
    R(c, PAL.wood, x + 1, y + 13, 14, 2); H(c, PAL.woodL, x + 1, y + 13, 14);
  });

  def('WINDOW_LIT', 'Lit Window', SOLID, { layer: 'deco', group: 'wall', biomes: ['city'], variants: 1 }, (c, x, y) => {
    R(c, PAL.plaster, x, y, 16, 16);
    R(c, PAL.woodD, x + 2, y + 3, 12, 10);
    R(c, '#f2c86a', x + 3, y + 4, 10, 8);
    R(c, '#ffe9a8', x + 4, y + 5, 4, 3);
    V(c, PAL.woodD, x + 7, y + 4, 8); H(c, PAL.woodD, x + 3, y + 7, 10);
    R(c, PAL.wood, x + 1, y + 13, 14, 2); H(c, PAL.woodL, x + 1, y + 13, 14);
  });

  def('SHUTTER', 'Shutters', SOLID, { layer: 'deco', group: 'wall', biomes: ['city'], variants: 1 }, (c, x, y) => {
    R(c, PAL.plaster, x, y, 16, 16);
    R(c, PAL.woodD, x + 1, y + 3, 14, 10);
    R(c, PAL.wood, x + 2, y + 4, 6, 8); R(c, PAL.wood, x + 8, y + 4, 6, 8);
    for (let i = 0; i < 4; i++) { H(c, PAL.woodD, x + 2, y + 5 + i * 2, 6); H(c, PAL.woodD, x + 8, y + 5 + i * 2, 6); }
    V(c, PAL.ink, x + 8, y + 4, 8);
    R(c, PAL.wood, x + 1, y + 13, 14, 2);
  });

  def('SIGN', 'Signpost', SOLID | TRIGGER, { layer: 'deco', group: 'prop', biomes: ['city', 'road'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 6, 14);
    R(c, PAL.woodD, x + 7, y + 8, 2, 8);
    R(c, PAL.wood, x + 2, y + 2, 12, 7);
    O(c, PAL.woodD, x + 2, y + 2, 12, 7); H(c, PAL.woodL, x + 3, y + 3, 10);
    H(c, PAL.ink, x + 4, y + 5, 8); H(c, PAL.ink, x + 4, y + 7, 6);
  });

  // --- 4.11 fences & gates -------------------------------------------------
  def('FENCE_H', 'Fence', SOLID, { layer: 'deco', group: 'fence', biomes: ['plains', 'city'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 14, 14);
    H(c, PAL.wood, x, y + 6, 16); H(c, PAL.woodD, x, y + 7, 16);
    H(c, PAL.wood, x, y + 10, 16); H(c, PAL.woodD, x, y + 11, 16);
    R(c, PAL.woodL, x + 2, y + 3, 2, 11); R(c, PAL.woodL, x + 12, y + 3, 2, 11);
    V(c, PAL.woodD, x + 3, y + 3, 11); V(c, PAL.woodD, x + 13, y + 3, 11);
  });
  def('FENCE_V', 'Fence', SOLID, { layer: 'deco', group: 'fence', biomes: ['plains', 'city'], variants: 1 }, (c, x, y) => {
    V(c, PAL.wood, x + 6, y, 16); V(c, PAL.woodD, x + 7, y, 16);
    V(c, PAL.wood, x + 10, y, 16); V(c, PAL.woodD, x + 11, y, 16);
    R(c, PAL.woodL, x + 4, y + 2, 10, 2); R(c, PAL.woodL, x + 4, y + 12, 10, 2);
    H(c, PAL.woodD, x + 4, y + 4, 10); H(c, PAL.woodD, x + 4, y + 14, 10);
  });
  def('FENCE_CORNER', 'Fence Corner', SOLID, { layer: 'deco', group: 'fence', biomes: ['plains', 'city'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 10, 14);
    R(c, PAL.woodL, x + 5, y + 2, 3, 13); V(c, PAL.woodD, x + 7, y + 2, 13);
    H(c, PAL.wood, x + 7, y + 6, 9); H(c, PAL.woodD, x + 7, y + 7, 9);
    H(c, PAL.wood, x + 7, y + 10, 9); H(c, PAL.woodD, x + 7, y + 11, 9);
    V(c, PAL.wood, x + 6, y + 7, 9); V(c, PAL.woodD, x + 5, y + 7, 9);
  });
  def('STONE_FENCE', 'Stone Wall', SOLID, { layer: 'deco', group: 'fence', biomes: ['plains', 'city', 'hills'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    contact(c, x, y, 16, 14);
    R(c, PAL.stone, x, y + 5, 16, 9);
    H(c, PAL.stoneH, x, y + 5, 16); H(c, PAL.stoneD, x, y + 13, 16);
    for (let i = 0; i < 5; i++) V(c, PAL.stoneD, x + 1 + Math.floor(r() * 14), y + 6, 7);
    speck(c, PAL.stoneL, x, y + 6, 5, r, 16, 7);
  });
  def('GATE', 'Gate', DOOR | TRIGGER, { layer: 'deco', group: 'fence', biomes: ['plains', 'city'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 14, 14);
    R(c, PAL.woodL, x, y + 2, 2, 13); R(c, PAL.woodL, x + 14, y + 2, 2, 13);
    H(c, PAL.wood, x + 2, y + 5, 12); H(c, PAL.wood, x + 2, y + 10, 12);
    for (let i = 0; i < 10; i++) P(c, PAL.woodD, x + 3 + i, y + 10 - i); // brace
    P(c, PAL.metal, x + 7, y + 7); P(c, PAL.metal, x + 8, y + 7);
  });

  // --- 4.12 town props -----------------------------------------------------
  def('WELL', 'Well', SOLID | TRIGGER, { layer: 'deco', group: 'prop', biomes: ['city'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 14, 14);
    R(c, PAL.stone, x + 1, y + 8, 14, 7);
    O(c, PAL.stoneD, x + 1, y + 8, 14, 7); H(c, PAL.stoneH, x + 2, y + 8, 12);
    R(c, '#1c2a38', x + 4, y + 9, 8, 4); R(c, PAL.water, x + 5, y + 11, 6, 2); H(c, PAL.waterL, x + 6, y + 11, 3);
    R(c, PAL.wood, x + 2, y + 1, 2, 8); R(c, PAL.wood, x + 12, y + 1, 2, 8);
    R(c, PAL.woodD, x + 1, y, 14, 2); H(c, PAL.woodL, x + 1, y, 14);
    V(c, PAL.cloth, x + 8, y + 2, 5); R(c, PAL.wood, x + 7, y + 6, 3, 2);
  });

  def('BARREL', 'Barrel', SOLID, { layer: 'deco', group: 'prop', biomes: ['city', 'dungeon', 'mine'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    contact(c, x, y, 10, 14);
    blob(c, PAL.wood, x, y, [[3, 4, 8], [4, 3, 10], [5, 3, 10], [6, 3, 10], [7, 3, 10], [8, 3, 10], [9, 3, 10], [10, 3, 10], [11, 3, 10], [12, 3, 10], [13, 4, 8]]);
    H(c, PAL.iron, x + 3, y + 5, 10); H(c, PAL.iron, x + 3, y + 11, 10);
    V(c, PAL.woodL, x + 4, y + 4, 9); V(c, PAL.woodD, x + 11, y + 4, 9);
    R(c, PAL.woodL, x + 4, y + 3, 8, 1); H(c, PAL.woodD, x + 4, y + 4, 8);
    if (r() < 0.5) P(c, PAL.woodD, x + 7, y + 8);
  });

  def('CRATE', 'Crate', SOLID, { layer: 'deco', group: 'prop', biomes: ['city', 'dungeon', 'mine'], variants: 2 }, (c, x, y) => {
    contact(c, x, y, 12, 14);
    R(c, PAL.wood, x + 2, y + 3, 12, 11);
    O(c, PAL.woodD, x + 2, y + 3, 12, 11);
    H(c, PAL.woodL, x + 3, y + 4, 10);
    for (let i = 0; i < 9; i++) { P(c, PAL.woodD, x + 3 + i, y + 4 + i); P(c, PAL.woodD, x + 12 - i, y + 4 + i); }
    R(c, PAL.woodD, x + 2, y + 8, 12, 1);
  });

  def('SACK', 'Sack', SOLID, { layer: 'deco', group: 'prop', biomes: ['city', 'mine'], variants: 2 }, (c, x, y) => {
    contact(c, x, y, 10, 14);
    blob(c, PAL.cloth, x, y, [[4, 6, 4], [5, 5, 6], [6, 4, 8], [7, 3, 10], [8, 3, 10], [9, 3, 10], [10, 3, 10], [11, 3, 10], [12, 4, 8], [13, 4, 8]]);
    blob(c, PAL.clothD, x, y, [[11, 3, 10], [12, 4, 8], [13, 4, 8]]);
    R(c, PAL.woodD, x + 6, y + 4, 4, 1);
    H(c, '#8b7b56', x + 5, y + 6, 6);
    V(c, '#e0d4b0', x + 5, y + 8, 4);
  });

  def('CART', 'Handcart', SOLID, { layer: 'deco', group: 'prop', biomes: ['city', 'road'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 14, 14);
    R(c, PAL.wood, x + 1, y + 4, 14, 6);
    H(c, PAL.woodL, x + 1, y + 4, 14); H(c, PAL.woodD, x + 1, y + 9, 14);
    for (let i = 0; i < 4; i++) V(c, PAL.woodD, x + 3 + i * 3, y + 5, 4);
    // two wheels
    for (const wx of [x + 3, x + 11]) {
      blob(c, PAL.barkD, wx - 2, y + 9, [[0, 1, 4], [1, 0, 6], [2, 0, 6], [3, 0, 6], [4, 1, 4]]);
      P(c, PAL.metal, wx + 0, y + 11); P(c, PAL.metal, wx + 1, y + 11);
    }
    R(c, PAL.woodL, x + 13, y + 2, 3, 2);
  });

  def('ANVIL', 'Anvil', SOLID, { layer: 'deco', group: 'prop', biomes: ['city'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 12, 14);
    R(c, PAL.bark, x + 4, y + 11, 8, 4); H(c, PAL.barkL, x + 4, y + 11, 8);
    blob(c, PAL.iron, x, y, [[4, 2, 12], [5, 2, 12], [6, 4, 8], [7, 5, 6], [8, 4, 8], [9, 3, 10], [10, 3, 10]]);
    H(c, PAL.metal, x + 2, y + 4, 12);
    P(c, PAL.metalL, x + 3, y + 4); P(c, PAL.metalL, x + 12, y + 4);
    H(c, PAL.ironD, x + 3, y + 10, 10);
  });

  def('FORGE', 'Forge', SOLID, { layer: 'deco', group: 'prop', biomes: ['city'], variants: 1, animFrames: 3, fps: 6 },
    (c, x, y, v, w, f) => {
      R(c, PAL.stone, x, y + 2, 16, 14);
      O(c, PAL.stoneD, x, y + 2, 16, 14); H(c, PAL.stoneH, x, y + 2, 16);
      for (let i = 0; i < 3; i++) H(c, PAL.stoneD, x, y + 6 + i * 3, 16);
      R(c, '#1a1210', x + 4, y + 7, 8, 6);
      const h = [4, 5, 3][f % 3];
      R(c, PAL.ember, x + 4, y + 13 - h, 8, h);
      R(c, PAL.fireD, x + 5, y + 13 - h + 1, 6, h - 1);
      R(c, PAL.fire, x + 6, y + 12 - (f % 3), 4, 2);
      P(c, PAL.fireHot, x + 7 + (f % 2), y + 11 - (f % 2));
      R(c, PAL.iron, x + 1, y, 4, 3);
    });

  def('GRINDSTONE', 'Grindstone', SOLID, { layer: 'deco', group: 'prop', biomes: ['city'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 12, 14);
    R(c, PAL.wood, x + 2, y + 9, 12, 2); R(c, PAL.wood, x + 3, y + 11, 2, 4); R(c, PAL.wood, x + 11, y + 11, 2, 4);
    blob(c, PAL.stone, x, y, [[2, 5, 6], [3, 4, 8], [4, 3, 10], [5, 3, 10], [6, 3, 10], [7, 3, 10], [8, 4, 8], [9, 5, 6]]);
    O(c, PAL.stoneD, x + 3, y + 3, 10, 7);
    P(c, PAL.iron, x + 7, y + 5); P(c, PAL.iron, x + 8, y + 5); P(c, PAL.iron, x + 7, y + 6); P(c, PAL.iron, x + 8, y + 6);
    H(c, PAL.stoneH, x + 5, y + 3, 5);
  });

  // --- 4.13 furniture ------------------------------------------------------
  def('TABLE', 'Table', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city', 'dungeon'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 14, 14);
    R(c, PAL.wood, x + 1, y + 3, 14, 8);
    H(c, PAL.woodL, x + 1, y + 3, 14); H(c, PAL.woodD, x + 1, y + 10, 14);
    for (let i = 0; i < 3; i++) H(c, PAL.woodD, x + 1, y + 5 + i * 2, 14);
    R(c, PAL.woodD, x + 2, y + 11, 2, 4); R(c, PAL.woodD, x + 12, y + 11, 2, 4);
  });

  def('CHAIR', 'Chair', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 10, 14);
    R(c, PAL.wood, x + 4, y + 2, 8, 6); V(c, PAL.woodD, x + 7, y + 2, 6); H(c, PAL.woodL, x + 4, y + 2, 8);
    R(c, PAL.woodL, x + 3, y + 8, 10, 3); H(c, PAL.woodD, x + 3, y + 10, 10);
    R(c, PAL.woodD, x + 3, y + 11, 2, 4); R(c, PAL.woodD, x + 11, y + 11, 2, 4);
  });

  def('BENCH', 'Bench', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 16, 14);
    R(c, PAL.wood, x, y + 6, 16, 4);
    H(c, PAL.woodL, x, y + 6, 16); H(c, PAL.woodD, x, y + 9, 16);
    R(c, PAL.woodD, x + 1, y + 10, 2, 5); R(c, PAL.woodD, x + 13, y + 10, 2, 5);
  });

  def('BED', 'Bed', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city'], variants: 1 }, (c, x, y) => {
    R(c, PAL.woodD, x + 1, y, 14, 16);
    R(c, PAL.cloth, x + 2, y + 1, 12, 5);           // pillow end
    R(c, PAL.blue, x + 2, y + 6, 12, 9);            // blanket
    H(c, PAL.blueL, x + 2, y + 6, 12); H(c, PAL.blueD, x + 2, y + 14, 12);
    H(c, '#e2d8bc', x + 3, y + 2, 10);
    R(c, PAL.wood, x + 1, y, 14, 1); R(c, PAL.wood, x + 1, y + 15, 14, 1);
    for (let i = 0; i < 3; i++) V(c, PAL.blueD, x + 5 + i * 3, y + 7, 7);
  });

  def('BOOKSHELF', 'Bookshelf', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city', 'dungeon'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.woodD, x, y, 16, 16);
      const cols = ['#8c3a34', '#3a5a8c', '#6a8c3a', '#8c7a3a', '#5f3a8c', '#8c5a3a'];
      for (let shelf = 0; shelf < 3; shelf++) {
        const sy = y + 1 + shelf * 5;
        R(c, '#3a2718', x + 1, sy, 14, 4);
        let bx = x + 1;
        while (bx < x + 14) {
          const bw = 1 + Math.floor(r() * 2), bh = 3 + (r() < 0.4 ? 0 : 1);
          R(c, cols[Math.floor(r() * cols.length)], bx, sy + 4 - bh, bw, bh);
          P(c, PAL.gold, bx, sy + 4 - bh);
          bx += bw + (r() < 0.25 ? 1 : 0);
        }
        H(c, PAL.wood, x + 1, sy + 4, 14);
      }
      O(c, PAL.woodL, x, y, 16, 16);
    });

  def('SHELF_GOODS', 'Shelves', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.woodD, x, y, 16, 16);
    for (let shelf = 0; shelf < 3; shelf++) {
      const sy = y + 1 + shelf * 5;
      R(c, '#3a2718', x + 1, sy, 14, 4);
      for (let i = 0; i < 4; i++) {
        const gx = x + 1 + i * 3 + Math.floor(r() * 2);
        const kind = Math.floor(r() * 3);
        if (kind === 0) { R(c, PAL.cloth, gx, sy + 1, 2, 3); P(c, PAL.clothD, gx, sy + 1); }
        else if (kind === 1) { R(c, '#6a8c9a', gx, sy + 1, 2, 3); P(c, '#b8dce8', gx, sy + 1); }
        else { R(c, PAL.gold, gx, sy + 2, 2, 2); P(c, PAL.goldL, gx, sy + 2); }
      }
      H(c, PAL.wood, x + 1, sy + 4, 14);
    }
    O(c, PAL.woodL, x, y, 16, 16);
  });

  def('COUNTER', 'Counter', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city'], variants: 1 }, (c, x, y) => {
    R(c, PAL.woodL, x, y + 3, 16, 3); H(c, PAL.woodH, x, y + 3, 16);
    R(c, PAL.wood, x, y + 6, 16, 10);
    for (let i = 0; i < 4; i++) V(c, PAL.woodD, x + 3 + i * 4, y + 6, 10);
    H(c, PAL.woodD, x, y + 15, 16);
  });

  def('BAR', 'Bar', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city'], variants: 1 }, (c, x, y) => {
    R(c, PAL.woodH, x, y + 2, 16, 3); H(c, '#d09a62', x, y + 2, 16); H(c, PAL.woodD, x, y + 4, 16);
    R(c, PAL.woodD, x, y + 5, 16, 11);
    for (let i = 0; i < 3; i++) { R(c, PAL.wood, x + 1 + i * 5, y + 6, 4, 9); H(c, PAL.woodL, x + 1 + i * 5, y + 6, 4); }
    R(c, '#6a8c5a', x + 2, y, 2, 2); R(c, '#8c6a3a', x + 11, y, 2, 2);
  });

  def('COOKING_POT', 'Cook Pot', SOLID, { layer: 'deco', group: 'prop', biomes: ['city', 'cave'], variants: 1, animFrames: 3, fps: 3 },
    (c, x, y, v, w, f) => {
      contact(c, x, y, 12, 14);
      // tripod
      for (let i = 0; i < 6; i++) { P(c, PAL.iron, x + 2 + i, y + 14 - i); P(c, PAL.iron, x + 13 - i, y + 14 - i); }
      blob(c, PAL.ironD, x, y, [[5, 4, 8], [6, 3, 10], [7, 3, 10], [8, 3, 10], [9, 3, 10], [10, 4, 8], [11, 5, 6]]);
      H(c, PAL.iron, x + 3, y + 6, 10);
      R(c, '#6a5a2a', x + 5, y + 6, 6, 1);
      const s = f % 3;
      P(c, '#a89a6a', x + 6 + s, y + 4); P(c, '#c8bc8a', x + 9 - s, y + 3);
      R(c, PAL.ember, x + 5, y + 13, 6, 1); P(c, PAL.fire, x + 7, y + 13);
    });

  def('HEARTH', 'Hearth', SOLID, { layer: 'deco', group: 'prop', biomes: ['city', 'dungeon'], variants: 1, animFrames: 3, fps: 6 },
    (c, x, y, v, w, f) => {
      R(c, PAL.stone, x, y, 16, 16);
      for (let row = 0; row < 4; row++) { H(c, PAL.stoneD, x, y + row * 4 + 3, 16); V(c, PAL.stoneD, x + ((row % 2) ? 5 : 11), y + row * 4, 3); }
      R(c, '#140e0a', x + 3, y + 5, 10, 11);
      const h = [6, 8, 7][f % 3];
      blob(c, PAL.ember, x, y, [[15, 4, 8], [14, 4, 8], [13, 5, 6]]);
      R(c, PAL.fireD, x + 5, y + 16 - h, 6, h - 1);
      R(c, PAL.fire, x + 6, y + 18 - h, 4, h - 3);
      P(c, PAL.fireHot, x + 7 + (f % 2), y + 17 - h);
      R(c, PAL.wood, x + 4, y + 14, 8, 1);
    });

  def('CANDLE', 'Candle', 0, { layer: 'deco', group: 'prop', biomes: ['city', 'dungeon', 'crypt'], variants: 1, animFrames: 2, fps: 4 },
    (c, x, y, v, w, f) => {
      R(c, PAL.gold, x + 6, y + 13, 4, 2); H(c, PAL.goldL, x + 6, y + 13, 4);
      R(c, '#e8e0c4', x + 7, y + 7, 2, 6); V(c, '#fff8e0', x + 7, y + 7, 6);
      P(c, PAL.ink, x + 7, y + 6);
      P(c, PAL.fire, x + 7, y + 5 - (f % 2)); P(c, PAL.fireHot, x + 7, y + 4 - (f % 2));
    });

  def('TORCH', 'Torch Sconce', 0, { layer: 'deco', group: 'prop', biomes: ['dungeon', 'cave', 'city', 'mine'], variants: 1, animFrames: 4, fps: 8 },
    (c, x, y, v, w, f) => {
      R(c, PAL.iron, x + 6, y + 8, 4, 2); R(c, PAL.ironD, x + 5, y + 10, 6, 2);
      R(c, PAL.bark, x + 7, y + 10, 2, 5);
      const sh = [0, 1, 0, -1][f & 3];
      blob(c, PAL.fireD, x, y, [[7, 5, 6], [6, 5, 6], [5, 6, 4], [4, 6, 4]]);
      blob(c, PAL.fire, x, y, [[7, 6, 4], [6, 6, 4], [5, 7, 2], [4, 7, 2]]);
      P(c, PAL.fireHot, x + 7 + sh, y + 4); P(c, PAL.fireHot, x + 7, y + 3 + (f & 1));
      P(c, PAL.ember, x + 5 + sh, y + 2);
    });

  def('BRAZIER', 'Brazier', SOLID, { layer: 'deco', group: 'prop', biomes: ['dungeon', 'crypt', 'city'], variants: 1, animFrames: 3, fps: 6 },
    (c, x, y, v, w, f) => {
      contact(c, x, y, 10, 14);
      R(c, PAL.ironD, x + 6, y + 11, 4, 4); R(c, PAL.iron, x + 4, y + 14, 8, 2);
      blob(c, PAL.iron, x, y, [[7, 3, 10], [8, 3, 10], [9, 4, 8], [10, 5, 6]]);
      H(c, PAL.metal, x + 3, y + 7, 10);
      const h = [4, 6, 5][f % 3];
      blob(c, PAL.fireD, x, y, [[6, 4, 8], [5, 5, 6], [4, 5, 6]]);
      R(c, PAL.fire, x + 6, y + 7 - h + 2, 4, h - 1);
      P(c, PAL.fireHot, x + 7 + (f % 2), y + 8 - h);
      P(c, PAL.ember, x + 5, y + 2 + (f % 2));
    });

  def('CHANDELIER', 'Chandelier', 0, { layer: 'over', group: 'prop', biomes: ['city', 'dungeon'], variants: 1, animFrames: 2, fps: 3 },
    (c, x, y, v, w, f) => {
      V(c, PAL.ironD, x + 8, y, 5);
      blob(c, PAL.iron, x, y, [[5, 3, 10], [6, 2, 12], [7, 2, 12]]);
      H(c, PAL.metal, x + 2, y + 5, 12);
      for (const cx of [x + 3, x + 7, x + 11]) {
        R(c, '#e8e0c4', cx, y + 2, 2, 3);
        P(c, PAL.fire, cx, y + 1 - (f % 2)); P(c, PAL.fireHot, cx, y - (f % 2));
      }
    });

  // --- 4.14 sacred & funerary ---------------------------------------------
  def('ALTAR', 'Altar', SOLID | TRIGGER, { layer: 'deco', group: 'prop', biomes: ['city', 'dungeon', 'crypt'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 14, 14);
    R(c, PAL.stoneL, x + 1, y + 4, 14, 3); H(c, PAL.stoneH, x + 1, y + 4, 14);
    R(c, PAL.stone, x + 3, y + 7, 10, 8); H(c, PAL.stoneD, x + 3, y + 14, 10);
    R(c, PAL.cloth, x + 2, y + 6, 12, 3); H(c, '#e2d8bc', x + 2, y + 6, 12);
    R(c, PAL.gold, x + 6, y + 1, 4, 4); P(c, PAL.goldL, x + 7, y + 2);   // Tymora's coin
    O(c, PAL.goldD, x + 6, y + 1, 4, 4);
    R(c, '#e8e0c4', x + 2, y + 2, 1, 4); P(c, PAL.fire, x + 2, y + 1);
    R(c, '#e8e0c4', x + 13, y + 2, 1, 4); P(c, PAL.fire, x + 13, y + 1);
  });

  def('STATUE', 'Statue of Tymora', SOLID, { layer: 'deco', group: 'prop', biomes: ['city', 'ruins', 'dungeon'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 14, 14);
    R(c, PAL.stoneL, x + 2, y + 13, 12, 3); H(c, PAL.stoneH, x + 2, y + 13, 12);
    // robed figure
    blob(c, PAL.stone, x, y, [[2, 6, 4], [3, 6, 4], [4, 5, 6], [5, 5, 6], [6, 4, 8], [7, 4, 8], [8, 4, 8], [9, 3, 10], [10, 3, 10], [11, 3, 10], [12, 2, 12]]);
    blob(c, PAL.stoneL, x, y, [[2, 6, 3], [3, 6, 2], [4, 5, 3], [6, 4, 3], [8, 4, 2], [10, 3, 3]]);
    H(c, PAL.stoneD, x + 4, y + 6, 8);
    P(c, PAL.stoneD, x + 6, y + 3); P(c, PAL.stoneD, x + 9, y + 3);
    R(c, PAL.gold, x + 11, y + 5, 2, 2); P(c, PAL.goldL, x + 11, y + 5);  // the tossed coin
    for (let i = 0; i < 4; i++) V(c, PAL.stoneD, x + 4 + i * 2, y + 9, 4);
  });

  def('SHRINE', 'Shrine', SOLID | TRIGGER, { layer: 'deco', group: 'prop', biomes: ['city', 'road', 'forest'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 14, 14);
    blob(c, PAL.stone, x, y, [[1, 5, 6], [2, 3, 10], [3, 2, 12], [4, 1, 14], [5, 1, 14], [6, 1, 14], [7, 1, 14], [8, 1, 14], [9, 1, 14], [10, 1, 14], [11, 1, 14], [12, 1, 14], [13, 1, 14], [14, 0, 16], [15, 0, 16]]);
    R(c, '#221b16', x + 4, y + 5, 8, 9);
    blob(c, PAL.stoneH, x, y, [[1, 5, 6], [2, 3, 4], [4, 1, 2]]);
    R(c, PAL.gold, x + 6, y + 7, 4, 4); O(c, PAL.goldD, x + 6, y + 7, 4, 4); P(c, PAL.goldL, x + 7, y + 8);
    R(c, PAL.stoneD, x + 4, y + 13, 8, 1);
  });

  def('FOUNTAIN', 'Fountain', SOLID, { layer: 'deco', group: 'prop', biomes: ['city'], variants: 1, animFrames: 2, fps: 3 },
    (c, x, y, v, w, f) => {
      R(c, PAL.stoneL, x, y + 3, 16, 12);
      O(c, PAL.stoneD, x, y + 3, 16, 12); H(c, PAL.stoneH, x, y + 3, 16);
      R(c, PAL.water, x + 2, y + 5, 12, 8);
      H(c, PAL.waterL, x + 3 + f, y + 7, 5); H(c, PAL.waterL, x + 8 - f, y + 10, 4);
      R(c, PAL.stone, x + 6, y + 4, 4, 6); H(c, PAL.stoneH, x + 6, y + 4, 4);
      V(c, PAL.foam, x + 7, y + 1 + f, 3); V(c, PAL.foam, x + 9, y + 2 - f, 3);
      P(c, PAL.foam, x + 5, y + 6); P(c, PAL.foam, x + 11, y + 8);
      H(c, PAL.stoneD, x, y + 14, 16);
    });

  def('GRAVESTONE', 'Gravestone', SOLID, { layer: 'deco', group: 'prop', biomes: ['crypt', 'ruins', 'plains'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 12, 14);
      blob(c, PAL.stone, x, y, [[3, 5, 6], [4, 4, 8], [5, 4, 8], [6, 4, 8], [7, 4, 8], [8, 4, 8], [9, 4, 8], [10, 4, 8], [11, 4, 8], [12, 3, 10], [13, 3, 10]]);
      blob(c, PAL.stoneH, x, y, [[3, 5, 5], [4, 4, 2], [5, 4, 1]]);
      H(c, PAL.stoneD, x + 5, y + 6, 6); H(c, PAL.stoneD, x + 5, y + 8, 4);
      R(c, PAL.grassD, x + 1, y + 13, 14, 3);
      for (let i = 0; i < 4; i++) P(c, PAL.moss, x + Math.floor(r() * 16), y + 12 + Math.floor(r() * 4));
    });

  def('TOMB', 'Tomb', SOLID | TRIGGER, { layer: 'deco', group: 'prop', biomes: ['crypt', 'dungeon'], variants: 1 }, (c, x, y) => {
    R(c, PAL.stoneD, x, y + 2, 16, 14);
    R(c, PAL.stone, x + 1, y + 3, 14, 12);
    R(c, PAL.stoneL, x, y + 1, 16, 3); H(c, PAL.stoneH, x, y + 1, 16); H(c, PAL.stoneD, x, y + 4, 16);
    for (let i = 0; i < 3; i++) H(c, PAL.stoneD, x + 2, y + 7 + i * 3, 12);
    R(c, PAL.dgnD, x + 6, y + 8, 4, 5); H(c, PAL.stoneH, x + 6, y + 8, 4);
  });

  def('SARCOPHAGUS', 'Sarcophagus', SOLID | TRIGGER, { layer: 'deco', group: 'prop', biomes: ['crypt', 'dungeon', 'ruins'], variants: 1 }, (c, x, y) => {
    blob(c, PAL.stoneD, x, y, [[1, 3, 10], [2, 2, 12], [3, 2, 12], [4, 2, 12], [5, 2, 12], [6, 2, 12], [7, 2, 12], [8, 2, 12], [9, 2, 12], [10, 2, 12], [11, 2, 12], [12, 2, 12], [13, 2, 12], [14, 3, 10]]);
    blob(c, PAL.stone, x, y, [[2, 3, 10], [3, 3, 10], [4, 3, 10], [5, 3, 10], [6, 3, 10], [7, 3, 10], [8, 3, 10], [9, 3, 10], [10, 3, 10], [11, 3, 10], [12, 3, 10], [13, 3, 10]]);
    // carved face and crossed arms
    blob(c, PAL.stoneL, x, y, [[3, 6, 4], [4, 5, 6], [5, 5, 6]]);
    P(c, PAL.stoneD, x + 6, y + 4); P(c, PAL.stoneD, x + 9, y + 4);
    H(c, PAL.stoneD, x + 4, y + 7, 8); H(c, PAL.stoneD, x + 4, y + 9, 8);
    for (let i = 0; i < 3; i++) H(c, PAL.stoneH, x + 4, y + 11 + i, 8 - i * 2);
    R(c, PAL.gold, x + 7, y + 7, 2, 2);
  });

  def('BONES', 'Bones', 0, { layer: 'deco', group: 'prop', biomes: ['crypt', 'cave', 'dungeon'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    for (let i = 0; i < 4; i++) {
      const bx = x + 1 + Math.floor(r() * 10), by = y + 4 + Math.floor(r() * 10);
      R(c, PAL.bone, bx, by, 5, 1); P(c, PAL.boneL, bx, by); P(c, PAL.boneD, bx + 4, by);
      P(c, PAL.bone, bx, by - 1); P(c, PAL.bone, bx + 4, by + 1);
    }
    const sx = x + 4 + Math.floor(r() * 5), sy = y + 8 + Math.floor(r() * 4);
    blob(c, PAL.bone, sx, sy, [[0, 1, 3], [1, 0, 5], [2, 0, 5], [3, 1, 3]]);
    P(c, PAL.ink, sx + 1, sy + 1); P(c, PAL.ink, sx + 3, sy + 1);
  });

  def('SKULL_PILE', 'Skull Pile', SOLID, { layer: 'deco', group: 'prop', biomes: ['crypt', 'cave', 'dungeon'], variants: 2 }, (c, x, y) => {
    contact(c, x, y, 14, 14);
    const skull = (sx, sy) => {
      blob(c, PAL.bone, sx, sy, [[0, 1, 4], [1, 0, 6], [2, 0, 6], [3, 0, 6], [4, 1, 4], [5, 1, 4]]);
      P(c, PAL.ink, sx + 1, sy + 2); P(c, PAL.ink, sx + 4, sy + 2);
      H(c, PAL.boneD, sx + 2, sy + 4, 2); H(c, PAL.boneL, sx + 1, sy, 3);
    };
    skull(x + 1, y + 9); skull(x + 9, y + 9); skull(x + 5, y + 3);
    R(c, PAL.bone, x + 0, y + 15, 16, 1);
  });

  def('COBWEB', 'Cobweb', 0, { layer: 'over', group: 'prop', biomes: ['cave', 'dungeon', 'crypt', 'ruins'], variants: 4 },
    (c, x, y, v) => {
      const r = sr(v);
      const corner = Math.floor(r() * 4);
      const fx = (corner === 1 || corner === 3) ? 15 : 0, sgn = (corner === 1 || corner === 3) ? -1 : 1;
      const fy = (corner >= 2) ? 15 : 0, sgy = (corner >= 2) ? -1 : 1;
      const web = 'rgba(226,222,210,0.72)';
      for (let i = 0; i <= 9; i++) { P(c, web, fx + sgn * i, fy + sgy * (9 - i)); }
      for (let i = 0; i <= 6; i++) { P(c, web, fx + sgn * i, fy + sgy * (6 - i)); }
      for (let i = 0; i <= 9; i++) { P(c, web, fx + sgn * i, fy); P(c, web, fx, fy + sgy * i); }
      for (let i = 1; i <= 8; i++) P(c, web, fx + sgn * i, fy + sgy * i);
    });

  // --- 4.15 cave dressing --------------------------------------------------
  const shroom = (key, label, cap, capD, glow) => def(key, label, 0, { layer: 'deco', group: 'plant', biomes: ['cave', 'forest', 'underdark', 'marsh'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      for (let i = 0; i < 3; i++) {
        const mx = x + 1 + Math.floor(r() * 11), my = y + 5 + Math.floor(r() * 7), h = 2 + Math.floor(r() * 2);
        R(c, '#d8cfae', mx + 1, my + 2, 2, h);
        blob(c, cap, mx, my, [[0, 1, 3], [1, 0, 5], [2, 1, 3]]);
        P(c, capD, mx, my + 1); P(c, capD, mx + 4, my + 1);
        P(c, '#f4ecd8', mx + 1, my);
        if (glow) { P(c, glow, mx + 2, my + 1); }
      }
    });
  shroom('MUSHROOM_RED', 'Red Mushrooms', '#c4453b', '#8f2c25', null);
  shroom('MUSHROOM_BROWN', 'Brown Mushrooms', '#9c7b52', '#725638', null);
  shroom('MUSHROOM_GLOW', 'Glowcap Mushrooms', '#6f8fd0', '#43619c', '#c8ecff');

  def('CRYSTAL', 'Crystal Cluster', SOLID, { layer: 'deco', group: 'prop', biomes: ['cave', 'underdark', 'mine'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 12, 14);
      const shard = (sx, sy, h, w0) => {
        for (let i = 0; i < h; i++) {
          const ww = Math.min(w0, 1 + Math.floor(i * w0 / Math.max(1, h - 1)));
          R(c, PAL.crystalD, sx - (ww >> 1), sy + i, ww, 1);
        }
        for (let i = 1; i < h; i++) P(c, PAL.crystal, sx, sy + i);
        P(c, PAL.crystalL, sx, sy + 1);
      };
      shard(x + 5, y + 4 + Math.floor(r() * 2), 11, 5);
      shard(x + 10, y + 7, 8, 4);
      shard(x + 2, y + 9, 6, 3);
      P(c, PAL.glow, x + 5, y + 6); P(c, PAL.glow, x + 10, y + 9);
    });

  def('STALAGMITE', 'Stalagmite', SOLID, { layer: 'deco', group: 'prop', biomes: ['cave', 'underdark', 'mine'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 12, 14);
      const cone = (sx, top) => {
        const h = 16 - top;
        for (let i = 0; i < h; i++) {
          const ww = 1 + Math.floor(i * 5 / h);
          R(c, PAL.caveL, sx - (ww >> 1), y + top + i, ww, 1);
          P(c, PAL.caveH, sx - (ww >> 1), y + top + i);
          P(c, PAL.caveD, sx + ww - (ww >> 1) - 1, y + top + i);
        }
      };
      cone(x + 5, 3 + Math.floor(r() * 3));
      cone(x + 11, 7 + Math.floor(r() * 3));
    });

  def('STALACTITE', 'Stalactite', 0, { layer: 'over', group: 'prop', biomes: ['cave', 'underdark', 'mine'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      const cone = (sx, len) => {
        for (let i = 0; i < len; i++) {
          const ww = Math.max(1, 5 - Math.floor(i * 5 / len));
          R(c, PAL.caveD, sx - (ww >> 1), y + i, ww, 1);
          P(c, PAL.cave, sx - (ww >> 1), y + i);
        }
      };
      cone(x + 3, 5 + Math.floor(r() * 4));
      cone(x + 9, 3 + Math.floor(r() * 5));
      cone(x + 14, 4 + Math.floor(r() * 3));
      H(c, PAL.caveD, x, y, 16);
    });

  def('RUBBLE', 'Rubble', SLOW, { layer: 'deco', group: 'prop', biomes: ['cave', 'ruins', 'dungeon', 'mine'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      for (let i = 0; i < 11; i++) {
        const px = x + Math.floor(r() * 13), py = y + 3 + Math.floor(r() * 11), w = 2 + Math.floor(r() * 2);
        R(c, PAL.stone, px, py, w, 2);
        H(c, PAL.stoneH, px, py, w); P(c, PAL.stoneD, px + w - 1, py + 1);
      }
    });

  def('BOULDER', 'Boulder', SOLID, { layer: 'deco', group: 'prop', biomes: ['plains', 'hills', 'mountain', 'cave', 'coast'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 14, 14);
      blob(c, PAL.stoneD, x, y, [[2, 5, 7], [3, 3, 11], [4, 2, 12], [5, 1, 14], [6, 1, 14], [7, 0, 16], [8, 0, 16], [9, 0, 16], [10, 0, 16], [11, 1, 14], [12, 1, 14], [13, 2, 12], [14, 4, 8]]);
      blob(c, PAL.stone, x, y, [[3, 4, 9], [4, 3, 11], [5, 2, 12], [6, 2, 12], [7, 1, 14], [8, 1, 14], [9, 1, 13], [10, 2, 11], [11, 2, 11], [12, 3, 9]]);
      blob(c, PAL.stoneL, x, y, [[3, 5, 5], [4, 4, 5], [5, 3, 4], [6, 3, 3]]);
      speck(c, PAL.stoneD, x, y + 6, 5, r, 14, 8, 1, 0);
      H(c, PAL.stoneH, x + 5, y + 3, 4);
    });

  def('ROCK', 'Rock', 0, { layer: 'deco', group: 'prop', biomes: ['plains', 'hills', 'mountain', 'cave', 'coast'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      const ox = Math.floor(r() * 4), oy = 4 + Math.floor(r() * 4);
      contact(c, x, y, 8, 13);
      blob(c, PAL.stoneD, x + ox, y + oy, [[0, 2, 4], [1, 1, 6], [2, 0, 8], [3, 0, 8], [4, 1, 6]]);
      blob(c, PAL.stone, x + ox, y + oy, [[1, 2, 4], [2, 1, 6], [3, 1, 5]]);
      H(c, PAL.stoneH, x + ox + 2, y + oy + 1, 3);
    });

  const ore = (key, label, gem, gemL) => def(key, label, SOLID, { layer: 'deco', group: 'cave-wall', biomes: ['mine', 'cave', 'underdark'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.caveD, x, y, 16, 16);
      for (let i = 0; i < 8; i++) { const px = x + Math.floor(r() * 12), py = y + Math.floor(r() * 12); R(c, PAL.cave, px, py, 4, 3); H(c, PAL.caveL, px, py, 4); }
      for (let i = 0; i < 5; i++) {
        const px = x + 1 + Math.floor(r() * 13), py = y + 1 + Math.floor(r() * 13);
        R(c, gem, px, py, 2, 2); P(c, gemL, px, py);
      }
    });
  ore('ORE_IRON', 'Iron Vein', '#8d8378', '#c3bdb2');
  ore('ORE_SILVER', 'Silver Vein', '#a8b4c0', '#e8f0f8');
  ore('ORE_GEM', 'Gem Vein', '#8a4fb0', '#e0b4ff');

  // --- 4.16 dungeon furniture ---------------------------------------------
  def('CHEST_CLOSED', 'Chest', SOLID | TRIGGER, { layer: 'deco', group: 'prop', biomes: ['dungeon', 'cave', 'city', 'crypt'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 13, 14);
    R(c, PAL.wood, x + 2, y + 8, 12, 6);
    blob(c, PAL.wood, x, y, [[4, 3, 10], [5, 2, 12], [6, 2, 12], [7, 2, 12]]);
    H(c, PAL.woodL, x + 3, y + 4, 10);
    O(c, PAL.barkD, x + 2, y + 4, 12, 10);
    R(c, PAL.gold, x + 2, y + 7, 12, 2); H(c, PAL.goldL, x + 2, y + 7, 12);
    R(c, PAL.gold, x + 7, y + 8, 2, 3); P(c, PAL.ink, x + 7, y + 9);
    V(c, PAL.goldD, x + 4, y + 4, 10); V(c, PAL.goldD, x + 11, y + 4, 10);
  });

  def('CHEST_OPEN', 'Open Chest', SOLID, { layer: 'deco', group: 'prop', biomes: ['dungeon', 'cave', 'city', 'crypt'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 13, 14);
    blob(c, PAL.wood, x, y, [[1, 3, 10], [2, 2, 12], [3, 2, 12]]);   // lid thrown back
    H(c, PAL.woodL, x + 3, y + 1, 10);
    R(c, PAL.wood, x + 2, y + 7, 12, 7);
    R(c, '#241a12', x + 3, y + 6, 10, 4);
    O(c, PAL.barkD, x + 2, y + 6, 12, 8);
    R(c, PAL.gold, x + 2, y + 10, 12, 1);
    P(c, PAL.goldL, x + 5, y + 8); P(c, PAL.gold, x + 7, y + 8); P(c, PAL.goldL, x + 9, y + 7);
  });

  def('LEVER', 'Lever', SOLID | TRIGGER, { layer: 'deco', group: 'prop', biomes: ['dungeon', 'mine'], variants: 1 }, (c, x, y) => {
    R(c, PAL.stoneD, x + 4, y + 11, 8, 4); H(c, PAL.stoneL, x + 4, y + 11, 8);
    for (let i = 0; i < 7; i++) P(c, PAL.iron, x + 7 + Math.floor(i / 2), y + 11 - i);
    R(c, PAL.red, x + 9, y + 3, 2, 3); P(c, PAL.redL, x + 9, y + 3);
    P(c, PAL.metalL, x + 7, y + 10);
  });

  def('PRESSURE_PLATE', 'Pressure Plate', TRIGGER, { group: 'floor', biomes: ['dungeon', 'ruins'], variants: 1 }, (c, x, y) => {
    stoneSlabs(c, x, y, PAL.stone, PAL.stoneD, PAL.stoneL);
    R(c, PAL.stoneD, x + 2, y + 2, 12, 12);
    R(c, PAL.stoneL, x + 3, y + 3, 10, 10);
    O(c, PAL.stoneH, x + 3, y + 3, 10, 10);
    P(c, PAL.stoneD, x + 7, y + 7); P(c, PAL.stoneD, x + 8, y + 8);
  });

  def('PORTAL', 'Portal', TRIGGER, { layer: 'deco', group: 'prop', biomes: ['dungeon', 'underdark', 'ruins'], variants: 1, animFrames: 4, fps: 6 },
    (c, x, y, v, w, f) => {
      blob(c, PAL.stoneD, x, y, [[0, 4, 8], [1, 2, 12], [2, 1, 14], [3, 0, 16], [4, 0, 16], [5, 0, 16], [6, 0, 16], [7, 0, 16], [8, 0, 16], [9, 0, 16], [10, 0, 16], [11, 0, 16], [12, 1, 14], [13, 1, 14], [14, 2, 12], [15, 3, 10]]);
      blob(c, PAL.purpleD, x, y, [[1, 5, 6], [2, 3, 10], [3, 2, 12], [4, 2, 12], [5, 1, 14], [6, 1, 14], [7, 1, 14], [8, 1, 14], [9, 1, 14], [10, 2, 12], [11, 2, 12], [12, 3, 10], [13, 4, 8], [14, 5, 6]]);
      // swirling arms
      for (let a = 0; a < 3; a++) {
        for (let i = 0; i < 7; i++) {
          const ang = (f / 4 + a / 3) * Math.PI * 2 + i * 0.42;
          const rad = 1.2 + i * 0.85;
          const px = x + 8 + Math.round(Math.cos(ang) * rad), py = y + 8 + Math.round(Math.sin(ang) * rad * 0.95);
          P(c, i < 3 ? '#e8d0ff' : PAL.purple, px, py);
        }
      }
      P(c, '#ffffff', x + 8, y + 8);
    });

  def('STAIRS_UP', 'Stairs Up', TRIGGER, { group: 'floor', biomes: ['dungeon', 'cave', 'city'], variants: 1 }, (c, x, y) => {
    R(c, PAL.stoneD, x, y, 16, 16);
    for (let i = 0; i < 4; i++) {
      const sy = y + 12 - i * 4, inset = i;
      R(c, PAL.stoneL, x + inset, sy, 16 - inset * 2, 3);
      H(c, PAL.stoneH, x + inset, sy, 16 - inset * 2);
      H(c, PAL.stoneD, x + inset, sy + 3, 16 - inset * 2);
    }
    P(c, PAL.stoneH, x + 7, y + 1); P(c, PAL.stoneH, x + 8, y + 1);
  });

  def('STAIRS_DOWN', 'Stairs Down', TRIGGER, { group: 'floor', biomes: ['dungeon', 'cave', 'city'], variants: 1 }, (c, x, y) => {
    R(c, PAL.stoneL, x, y, 16, 16);
    for (let i = 0; i < 4; i++) {
      const sy = y + i * 4, inset = i;
      R(c, PAL.stone, x + inset, sy, 16 - inset * 2, 3);
      H(c, PAL.stoneH, x + inset, sy, 16 - inset * 2);
      H(c, PAL.stoneD, x + inset, sy + 3, 16 - inset * 2);
    }
    R(c, '#14100c', x + 4, y + 12, 8, 4);
  });

  def('LADDER', 'Ladder', TRIGGER, { layer: 'deco', group: 'prop', biomes: ['dungeon', 'cave', 'mine', 'city'], variants: 1 }, (c, x, y) => {
    R(c, PAL.wood, x + 3, y, 2, 16); R(c, PAL.wood, x + 11, y, 2, 16);
    V(c, PAL.woodL, x + 3, y, 16); V(c, PAL.woodL, x + 11, y, 16);
    for (let i = 0; i < 4; i++) { H(c, PAL.woodL, x + 5, y + 2 + i * 4, 6); H(c, PAL.woodD, x + 5, y + 3 + i * 4, 6); }
  });

  def('PIT', 'Pit', SOLID | LEDGE, { group: 'floor', biomes: ['dungeon', 'cave'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.stoneD, x, y, 16, 16);
    R(c, '#0e0b09', x + 1, y + 1, 14, 14);
    H(c, PAL.stoneL, x + 1, y + 1, 14); H(c, PAL.stone, x + 1, y + 2, 14);
    for (let i = 0; i < 5; i++) P(c, '#241c16', x + 2 + Math.floor(r() * 12), y + 4 + Math.floor(r() * 10));
    H(c, PAL.stoneD, x + 1, y + 14, 14);
  });

  def('SPIKE_TRAP', 'Spike Trap', TRIGGER | DAMAGE, { group: 'floor', biomes: ['dungeon', 'crypt'], variants: 1 }, (c, x, y) => {
    R(c, PAL.stoneD, x, y, 16, 16);
    R(c, '#120d0a', x + 1, y + 1, 14, 14);
    for (let i = 0; i < 4; i++) {
      const sx = x + 2 + i * 4;
      for (let h = 0; h < 7; h++) { const ww = Math.max(1, 3 - Math.floor(h / 3)); R(c, PAL.metal, sx, y + 12 - h, ww, 1); }
      V(c, PAL.metalL, sx, y + 6, 6);
      P(c, PAL.red, sx, y + 5);
    }
    O(c, PAL.stoneL, x, y, 16, 16);
  });

  def('BRIDGE_WOOD', 'Wooden Bridge', 0, { group: 'floor', biomes: ['forest', 'plains', 'marsh'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.wood, x, y, 16, 16);
    for (let i = 0; i < 5; i++) { H(c, PAL.woodD, x, y + i * 3 + 2, 16); H(c, PAL.woodL, x, y + i * 3, 16); }
    R(c, PAL.barkD, x, y, 2, 16); R(c, PAL.barkD, x + 14, y, 2, 16);
    V(c, PAL.barkL, x, y, 16); V(c, PAL.barkL, x + 14, y, 16);
    dashes(c, PAL.woodD, x + 3, y, 4, r, 2, 10);
  });

  def('BRIDGE_STONE', 'Stone Bridge', 0, { group: 'floor', biomes: ['road', 'city', 'mountain'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    stoneSlabs(c, x, y, PAL.stoneL, PAL.stoneD, PAL.stoneH);
    R(c, PAL.stone, x, y, 16, 2); R(c, PAL.stone, x, y + 14, 16, 2);
    H(c, PAL.stoneH, x, y, 16); H(c, PAL.stoneD, x, y + 15, 16);
    speck(c, PAL.stoneD, x, y + 3, 5, r, 16, 10);
  });

  // --- 4.17 trees & foliage ------------------------------------------------
  const OAK_ROWS = [[0, 5, 6], [1, 3, 10], [2, 2, 12], [3, 1, 14], [4, 1, 14], [5, 0, 16], [6, 0, 16], [7, 0, 16], [8, 1, 14], [9, 1, 14], [10, 2, 12], [11, 4, 8]];
  def('TREE_OAK', 'Oak', SOLID, { layer: 'deco', group: 'tree', biomes: ['forest', 'plains', 'hills'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 10, 14);
      R(c, PAL.bark, x + 6, y + 10, 4, 6); V(c, PAL.barkL, x + 6, y + 10, 6); V(c, PAL.barkD, x + 9, y + 10, 6);
      blob(c, PAL.leafD, x, y, OAK_ROWS);
      blob(c, PAL.leaf, x, y, OAK_ROWS.map((q) => [q[0], q[1] + 1, Math.max(1, q[2] - 2)]));
      blob(c, PAL.leafL, x, y, [[1, 5, 5], [2, 4, 6], [3, 3, 6], [4, 3, 5], [5, 2, 5]]);
      speck(c, PAL.leafH, x + 2, y + 1, 5, r, 12, 8);
      speck(c, PAL.leafD, x + 2, y + 6, 5, r, 12, 6);
    });

  def('TREE_PINE', 'Pine', SOLID, { layer: 'deco', group: 'tree', biomes: ['pine-forest', 'mountain', 'tundra'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 8, 14);
      R(c, PAL.barkD, x + 7, y + 12, 3, 4);
      const rows = [[0, 7, 2], [1, 6, 4], [2, 6, 4], [3, 5, 6], [4, 4, 8], [5, 6, 4], [6, 5, 6], [7, 4, 8], [8, 3, 10], [9, 5, 6], [10, 4, 8], [11, 3, 10], [12, 2, 12]];
      blob(c, PAL.pineD, x, y, rows);
      blob(c, PAL.pine, x, y, rows.map((q) => [q[0], q[1], Math.max(1, q[2] - 1)]));
      blob(c, PAL.pineL, x, y, [[1, 7, 1], [3, 6, 2], [4, 5, 2], [6, 6, 2], [7, 5, 2], [8, 4, 2], [10, 5, 2], [11, 4, 2]]);
      speck(c, PAL.pineD, x + 3, y + 6, 5, r, 10, 7);
    });

  // 2x2 oak — TL/TR/BL/BR assemble into one big canopy.
  const oakTL = [[0, 10, 6], [1, 8, 8], [2, 6, 10], [3, 5, 11], [4, 4, 12], [5, 3, 13], [6, 2, 14], [7, 2, 14], [8, 1, 15], [9, 1, 15], [10, 0, 16], [11, 0, 16], [12, 0, 16], [13, 0, 16], [14, 0, 16], [15, 0, 16]];
  const oakBL = [[0, 0, 16], [1, 0, 16], [2, 0, 16], [3, 0, 16], [4, 0, 16], [5, 0, 16], [6, 1, 15], [7, 3, 13], [8, 6, 10], [9, 10, 6]];
  const canopy = (rows, trunkSide) => (c, x, y, v) => {
    const r = sr(v);
    blob(c, PAL.leafD, x, y, rows);
    blob(c, PAL.leaf, x, y, rows.map((q) => [q[0], q[1] + 1, Math.max(1, q[2] - 2)]));
    speck(c, PAL.leafH, x, y, 7, r, 16, 12);
    speck(c, PAL.leafD, x, y, 6, r);
    if (trunkSide === 'L') { R(c, PAL.bark, x + 14, y + 8, 2, 8); V(c, PAL.barkL, x + 14, y + 8, 8); }
    if (trunkSide === 'R') { R(c, PAL.bark, x, y + 8, 2, 8); V(c, PAL.barkD, x + 1, y + 8, 8); }
  };
  def('OAK_TL', 'Oak', SOLID, { layer: 'over', group: 'tree', biomes: ['forest'], variants: 2 }, canopy(oakTL, null));
  def('OAK_TR', 'Oak', SOLID, { layer: 'over', group: 'tree', biomes: ['forest'], variants: 2 }, canopy(mirror(oakTL), null));
  def('OAK_BL', 'Oak', SOLID, { layer: 'deco', group: 'tree', biomes: ['forest'], variants: 2 }, canopy(oakBL, 'L'));
  def('OAK_BR', 'Oak', SOLID, { layer: 'deco', group: 'tree', biomes: ['forest'], variants: 2 }, canopy(mirror(oakBL), 'R'));

  const pineTL = [[0, 15, 1], [1, 15, 1], [2, 14, 2], [3, 13, 3], [4, 12, 4], [5, 14, 2], [6, 13, 3], [7, 12, 4], [8, 11, 5], [9, 10, 6], [10, 12, 4], [11, 11, 5], [12, 10, 6], [13, 9, 7], [14, 8, 8], [15, 7, 9]];
  const pineBL = [[0, 8, 8], [1, 7, 9], [2, 6, 10], [3, 8, 8], [4, 7, 9], [5, 6, 10], [6, 5, 11], [7, 4, 12], [8, 3, 13], [9, 2, 14], [10, 5, 11], [11, 4, 12], [12, 3, 13]];
  const conifer = (rows, trunkSide) => (c, x, y, v) => {
    const r = sr(v);
    blob(c, PAL.pineD, x, y, rows);
    blob(c, PAL.pine, x, y, rows.map((q) => [q[0], q[1] + 1, Math.max(1, q[2] - 1)]));
    speck(c, PAL.pineL, x, y, 6, r);
    if (trunkSide === 'L') { R(c, PAL.barkD, x + 14, y + 13, 2, 3); }
    if (trunkSide === 'R') { R(c, PAL.barkD, x, y + 13, 2, 3); }
  };
  def('PINE_TL', 'Pine', SOLID, { layer: 'over', group: 'tree', biomes: ['pine-forest'], variants: 2 }, conifer(pineTL, null));
  def('PINE_TR', 'Pine', SOLID, { layer: 'over', group: 'tree', biomes: ['pine-forest'], variants: 2 }, conifer(mirror(pineTL), null));
  def('PINE_BL', 'Pine', SOLID, { layer: 'deco', group: 'tree', biomes: ['pine-forest'], variants: 2 }, conifer(pineBL, 'L'));
  def('PINE_BR', 'Pine', SOLID, { layer: 'deco', group: 'tree', biomes: ['pine-forest'], variants: 2 }, conifer(mirror(pineBL), 'R'));

  def('DEAD_TREE', 'Dead Tree', SOLID, { layer: 'deco', group: 'tree', biomes: ['marsh', 'ash-waste', 'ruins', 'tundra'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 8, 14);
      R(c, PAL.barkD, x + 7, y + 5, 3, 11);
      V(c, '#7a6248', x + 7, y + 5, 11);
      // branches
      const branch = (bx, by, dx, len, up) => { for (let i = 0; i < len; i++) { P(c, PAL.barkD, bx + dx * i, by - (up ? i : Math.floor(i / 2))); if (i % 2 === 0) P(c, '#7a6248', bx + dx * i, by - (up ? i : Math.floor(i / 2)) - 1); } };
      branch(x + 7, y + 7, -1, 5, true);
      branch(x + 9, y + 5, 1, 5, true);
      branch(x + 7, y + 11, -1, 4, false);
      if (r() < 0.6) branch(x + 9, y + 10, 1, 3, true);
      P(c, PAL.barkD, x + 2, y + 1); P(c, PAL.barkD, x + 13, y);
    });

  def('STUMP', 'Stump', SOLID, { layer: 'deco', group: 'prop', biomes: ['forest', 'pine-forest', 'plains'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 12, 14);
      blob(c, PAL.bark, x, y, [[6, 4, 8], [7, 3, 10], [8, 3, 10], [9, 3, 10], [10, 3, 10], [11, 3, 10], [12, 3, 10], [13, 4, 8]]);
      blob(c, PAL.woodL, x, y, [[5, 4, 8], [6, 3, 10], [7, 3, 10]]);
      O(c, PAL.barkD, x + 3, y + 5, 10, 4);
      P(c, PAL.woodD, x + 7, y + 6); P(c, PAL.woodD, x + 8, y + 7);
      V(c, PAL.barkD, x + 5, y + 8, 6); V(c, PAL.barkD, x + 10, y + 9, 5);
      if (r() < 0.5) { P(c, PAL.moss, x + 3, y + 10); P(c, PAL.moss, x + 12, y + 11); }
    });

  def('BUSH', 'Bush', SOLID, { layer: 'deco', group: 'plant', biomes: ['forest', 'plains', 'hills'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 12, 14);
      const rows = [[4, 5, 6], [5, 3, 10], [6, 2, 12], [7, 1, 14], [8, 1, 14], [9, 1, 14], [10, 2, 12], [11, 3, 10], [12, 4, 8], [13, 5, 6]];
      blob(c, PAL.leafD, x, y, rows);
      blob(c, PAL.leaf, x, y, rows.map((q) => [q[0], q[1] + 1, Math.max(1, q[2] - 2)]));
      speck(c, PAL.leafH, x + 2, y + 4, 6, r, 12, 7);
      speck(c, PAL.leafD, x + 2, y + 8, 4, r, 12, 5);
    });

  def('BERRY_BUSH', 'Berry Bush', SOLID | TRIGGER, { layer: 'deco', group: 'plant', biomes: ['forest', 'plains'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 12, 14);
      const rows = [[4, 5, 6], [5, 3, 10], [6, 2, 12], [7, 1, 14], [8, 1, 14], [9, 1, 14], [10, 2, 12], [11, 3, 10], [12, 4, 8], [13, 5, 6]];
      blob(c, PAL.leafD, x, y, rows);
      blob(c, PAL.leaf, x, y, rows.map((q) => [q[0], q[1] + 1, Math.max(1, q[2] - 2)]));
      for (let i = 0; i < 6; i++) {
        const bx = x + 3 + Math.floor(r() * 10), by = y + 5 + Math.floor(r() * 8);
        P(c, '#a8283a', bx, by); P(c, '#d8586a', bx, by - 1);
      }
      speck(c, PAL.leafH, x + 2, y + 4, 4, r, 12, 6);
    });

  def('HEDGE', 'Hedge', SOLID, { layer: 'deco', group: 'plant', biomes: ['city', 'plains'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.leafD, x, y + 1, 16, 15);
    for (let i = 0; i < 16; i++) R(c, PAL.leaf, x + i, y + 2 + (i % 2), 1, 13);
    speck(c, PAL.leafH, x, y + 2, 12, r, 16, 11);
    speck(c, PAL.leafD, x, y + 6, 8, r, 16, 9);
    H(c, PAL.leafH, x, y + 2, 16);
  });

  def('REEDS', 'Reeds', SLOW, { layer: 'deco', group: 'plant', biomes: ['marsh', 'coast'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    for (let i = 0; i < 10; i++) {
      const bx = x + Math.floor(r() * 16), top = y + 2 + Math.floor(r() * 7);
      R(c, PAL.swampL, bx, top, 1, 16 - (top - y));
      P(c, '#86a86a', bx, top);
      if (r() < 0.4) P(c, PAL.grassDry, bx, top + 1);
    }
  });

  def('CATTAILS', 'Cattails', SLOW, { layer: 'deco', group: 'plant', biomes: ['marsh', 'coast'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    for (let i = 0; i < 6; i++) {
      const bx = x + 1 + Math.floor(r() * 14), top = y + 3 + Math.floor(r() * 5);
      R(c, PAL.swampL, bx, top, 1, 16 - (top - y));
      R(c, '#6b4a2f', bx, top - 3, 1, 3); P(c, '#8a6240', bx, top - 3);
      if (r() < 0.6) { for (let k = 0; k < 4; k++) P(c, PAL.swampD, bx + 1 + k, top + 2 + k); }
    }
  });

  def('CACTUS', 'Cactus', SOLID | DAMAGE, { layer: 'deco', group: 'plant', biomes: ['coast', 'ruins'], variants: 2 }, (c, x, y) => {
    contact(c, x, y, 10, 14);
    R(c, '#3f7a55', x + 6, y + 3, 4, 13);
    V(c, '#5aa070', x + 6, y + 3, 13); V(c, '#2c5a3d', x + 9, y + 3, 13);
    R(c, '#3f7a55', x + 2, y + 7, 4, 2); R(c, '#3f7a55', x + 2, y + 5, 2, 4);
    R(c, '#3f7a55', x + 10, y + 9, 4, 2); R(c, '#3f7a55', x + 12, y + 6, 2, 5);
    for (let i = 0; i < 5; i++) { P(c, '#d8e0b0', x + 7, y + 4 + i * 2); P(c, '#d8e0b0', x + 3, y + 6); P(c, '#d8e0b0', x + 12, y + 8); }
    H(c, '#5aa070', x + 6, y + 3, 4);
  });

  def('DRIFTWOOD', 'Driftwood', 0, { layer: 'deco', group: 'prop', biomes: ['coast', 'marsh'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    contact(c, x, y, 14, 14);
    const oy = 8 + Math.floor(r() * 3);
    R(c, '#a89a86', x + 1, y + oy, 14, 3);
    H(c, '#c8bda8', x + 1, y + oy, 14); H(c, '#7d7364', x + 1, y + oy + 2, 14);
    for (let i = 0; i < 5; i++) P(c, '#7d7364', x + 2 + Math.floor(r() * 12), y + oy + 1);
    P(c, '#a89a86', x + 3, y + oy - 1); P(c, '#a89a86', x + 11, y + oy - 2); P(c, '#a89a86', x + 12, y + oy - 1);
  });

  // Register a light-void backdrop id last so map editors have a "clear" tile.
  def('BLACK', 'Darkness', SOLID, { layer: 'over', biomes: [] }, (c, x, y) => { R(c, '#000000', x, y, 16, 16); });
}

buildTiles();

// ---------------------------------------------------------------------------
// 5. RASTER CACHE + BLIT
// ---------------------------------------------------------------------------

const cache = new Map();      // "id|variant|frame" -> canvas
const CACHE_LIMIT = 2400;

function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  if (cx) cx.imageSmoothingEnabled = false;
  return cv;
}

/**
 * Deterministic 2D hash — the source of per-tile variation. Pure function of
 * position, so a patch of grass looks the same every frame and every session.
 */
export function tileHash(wx, wy, salt = 0) {
  let h = Math.imul((wx | 0) + 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul((wy | 0) + 0xc2b2ae35, 0x27d4eb2f);
  h ^= Math.imul((salt | 0) + 0x165667b1, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2545f491); h ^= h >>> 13;
  return h >>> 0;
}

/** Which variant of `id` sits at (wx, wy)? */
export function variantAt(id, wx, wy) {
  const d = TILES[id];
  if (!d || d.variants <= 1) return 0;
  return tileHash(wx, wy, id) % d.variants;
}

/** Turn (id, variant) into the seed a draw function speckles from. */
function seedFor(id, variant) {
  return (Math.imul(id + 1, 0x9e3779b9) ^ Math.imul(variant + 1, 0x85ebca6b)) >>> 0;
}

/** Rasterise one (id, variant, frame) into a cached 16x16 canvas. */
function raster(id, variant, frame) {
  const key = `${id}|${variant}|${frame}`;
  let cv = cache.get(key);
  if (cv !== undefined) return cv;

  const d = TILES[id];
  cv = makeCanvas(16, 16);
  if (cv && d) {
    const cx = cv.getContext('2d');
    const seed = seedFor(id, variant);
    try { d.draw(cx, 0, 0, seed, seed, frame); }
    catch (e) { console.error(`[tiles] ${d.key} failed to draw`, e); cx.fillStyle = '#ff00ff'; cx.fillRect(0, 0, 16, 16); }
  }
  if (cache.size > CACHE_LIMIT) {
    const kill = Array.from(cache.keys()).slice(0, CACHE_LIMIT >> 2);
    for (const k of kill) cache.delete(k);
  }
  cache.set(key, cv);
  return cv;
}

/** Drop every cached canvas (call after a palette/debug change). */
export function clearTileCache() { cache.clear(); }

/**
 * Blit tile `id` at pixel (px, py). `wx, wy` are the tile's world coordinates and
 * only feed the variation hash; `t` is seconds (Game.time) and drives animation.
 */
export function drawTile(ctx, id, px, py, wx = 0, wy = 0, t = 0) {
  const d = TILES[id];
  if (!d || id === 0) return;
  const variant = d.variants > 1 ? (tileHash(wx, wy, id) % d.variants) : 0;
  const frame = d.animFrames > 1 ? (Math.floor(t * d.fps) % d.animFrames) : 0;
  const cv = raster(id, variant, frame);
  if (cv) ctx.drawImage(cv, px | 0, py | 0);
}

/** Draw a tile without the world-position hash — for UI previews and pickers. */
export function drawTilePreview(ctx, id, px, py, t = 0, variant = 0) {
  const d = TILES[id];
  if (!d) return;
  const frame = d.animFrames > 1 ? (Math.floor(t * d.fps) % d.animFrames) : 0;
  const cv = raster(id, variant % d.variants, frame);
  if (cv) ctx.drawImage(cv, px | 0, py | 0);
}

// ---------------------------------------------------------------------------
// 6. QUERIES
// ---------------------------------------------------------------------------

export function tileDef(id) { return TILES[id] || TILES[0]; }
export function tileFlags(id) { const d = TILES[id]; return d ? d.flags : TF.SOLID; }
export function tileName(id) { const d = TILES[id]; return d ? d.name : 'Void'; }
export function tileKey(id) { const d = TILES[id]; return d ? d.key : 'VOID'; }
export function tileLayer(id) { const d = TILES[id]; return d ? d.layer : 'ground'; }
export function tileGroup(id) { const d = TILES[id]; return d ? d.group : null; }
export function isSolid(id) { return (tileFlags(id) & TF.SOLID) !== 0; }
export function isWater(id) { return (tileFlags(id) & TF.WATER) !== 0; }
export function isEncounter(id) { return (tileFlags(id) & TF.ENCOUNTER) !== 0; }
export function isAnimated(id) { const d = TILES[id]; return !!d && d.animFrames > 1; }
export function tileCount() { return nextId; }
export function allTileIds() { return Object.keys(TILES).map(Number); }

/** Every tile tagged with a biome, for procedural decorators. */
export function tilesByBiome(biome) {
  const out = [];
  for (const id of Object.keys(TILES)) { const d = TILES[id]; if (d.biomes.includes(biome)) out.push(d.id); }
  return out;
}

/** Resolve 'GRASS' | 12 | undefined to a real id, with a fallback. */
export function tileId(nameOrId, fallback = 0) {
  if (typeof nameOrId === 'number') return TILES[nameOrId] ? nameOrId : fallback;
  if (typeof nameOrId === 'string' && T[nameOrId] != null) return T[nameOrId];
  return fallback;
}

// ---------------------------------------------------------------------------
// 7. AUTOTILING
// ---------------------------------------------------------------------------

// Cardinal edge mask -> family suffix. Bits: N=1 E=2 S=4 W=8, set where the
// neighbour is a DIFFERENT material (i.e. where an edge must be drawn).
const CARD_SUFFIX = {
  0: null, 1: 'N', 2: 'E', 3: 'NE', 4: 'S', 5: 'N', 6: 'SE', 7: 'E',
  8: 'W', 9: 'NW', 10: 'E', 11: 'N', 12: 'SW', 13: 'W', 14: 'S', 15: 'N',
};
const DIAG_SUFFIX = { NE: 'NE', SE: 'SE', SW: 'SW', NW: 'NW' };

/** Read the ground layer of any TileMap-ish object without hard-coupling to it. */
function readTile(map, x, y) {
  if (!map) return -1;
  try {
    if (map.inBounds && !map.inBounds(x, y)) return -1;
    if (typeof map.at === 'function') return map.at('ground', x, y);
    if (map.ground && map.w) return map.ground[y * map.w + x];
    if (typeof map.get === 'function') return map.get(x, y);
  } catch { /* out of bounds or an unfamiliar map shape */ }
  return -1;
}

/**
 * Work out which edges of the tile at (x, y) border a *different* material, and
 * suggest the family member to draw.
 *
 *   const e = autotileEdges(map, x, y, T.WATER);
 *   drawTile(ctx, e.tile, px, py, x, y, t);
 *
 * Off-map neighbours count as the same material, so coastlines don't ring the
 * whole map. Neighbours sharing the tile's `group` (WATER vs WATER_DEEP,
 * CAVE_WALL vs ORE_IRON) also count as the same material.
 *
 * Returns { mask, card, n,e,s,w,ne,se,sw,nw, suffix, tile }.
 */
export function autotileEdges(map, x, y, id) {
  const d = TILES[id];
  const grp = d ? d.group : null;
  const same = (dx, dy) => {
    const v = readTile(map, x + dx, y + dy);
    if (v === -1 || v == null) return true;         // off-map / unknown = no edge
    if (v === id) return true;
    const o = TILES[v];
    return !!(grp && o && o.group === grp);
  };
  const n = !same(0, -1), e = !same(1, 0), s = !same(0, 1), w = !same(-1, 0);
  const ne = !same(1, -1), se = !same(1, 1), sw = !same(-1, 1), nw = !same(-1, -1);

  const card = (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (w ? 8 : 0);
  const mask = card | (ne ? 16 : 0) | (se ? 32 : 0) | (sw ? 64 : 0) | (nw ? 128 : 0);

  let suffix = CARD_SUFFIX[card];
  if (!suffix) {
    // No cardinal edge: a lone diagonal neighbour becomes an inner corner.
    if (ne) suffix = DIAG_SUFFIX.NE;
    else if (se) suffix = DIAG_SUFFIX.SE;
    else if (sw) suffix = DIAG_SUFFIX.SW;
    else if (nw) suffix = DIAG_SUFFIX.NW;
  }

  let tile = id;
  if (suffix && d) {
    // Families are named BASE_N, BASE_NE… ; shores live under SHORE_*.
    const base = d.key.replace(/_(N|E|S|W|NE|SE|SW|NW)$/, '');
    const cand = T[`${base}_${suffix}`];
    if (cand != null) tile = cand;
    else if (d.group === 'water') { const sh = T[`SHORE_${suffix}`]; if (sh != null) tile = sh; }
  }
  return { mask, card, n, e, s, w, ne, se, sw, nw, suffix: suffix || null, tile };
}

/** Convenience: the shore tile that should sit at a water edge. */
export function shoreFor(map, x, y) { return autotileEdges(map, x, y, T.WATER).tile; }

// ---------------------------------------------------------------------------
// 8. REGISTRATION / WARM-UP
// ---------------------------------------------------------------------------

let warmed = false;

/**
 * Called once during boot (main.js). Definitions already exist at import time —
 * this pre-renders the tiles the first screen is certain to need so the opening
 * frames don't stutter, and returns a small report for the loading bar.
 */
export function registerTiles() {
  buildTiles();
  if (!warmed && typeof document !== 'undefined') {
    warmed = true;
    const warm = [
      'GRASS', 'GRASS_2', 'GRASS_3', 'GRASS_4', 'GRASS_TALL', 'DIRT', 'DIRT_PATH',
      'COBBLE', 'FLAGSTONE', 'WATER', 'STONE_WALL', 'WATTLE_WALL', 'WOOD_FLOOR',
      'THATCH_M', 'THATCH_L', 'THATCH_R', 'DOOR_CLOSED', 'TREE_OAK', 'TREE_PINE',
      'BUSH', 'ROCK', 'FENCE_H', 'CAVE_FLOOR', 'CAVE_WALL', 'DUNGEON_FLOOR', 'DUNGEON_WALL',
    ];
    for (const k of warm) {
      const id = T[k]; if (id == null) continue;
      const d = TILES[id];
      for (let v = 0; v < d.variants; v++) for (let f = 0; f < d.animFrames; f++) raster(id, v, f);
    }
  }
  return { tiles: nextId, cached: cache.size };
}

export default TILES;
