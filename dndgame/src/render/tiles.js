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
// 1. PALETTE — warm, earthy, GBA-era.
//
//    GRADE NOTES (2026 art pass). Two rules govern this table now:
//
//    a) BETWEEN families, separate by VALUE, not only by hue. Every ground
//       family used to sit at L* 45-48, so a material change was a pure hue
//       swap at constant lightness — which the eye reads as a flat sticker
//       boundary, never as two surfaces. `dirt` and `leaf` were pulled down so
//       grass / dirt / path / leaf stepped through L* 47 / 43 / 53 / 39.
//
//       The 2026-08 pass narrowed that: DIRT and DIRT_PATH are the SAME family
//       (trodden earth vs. loose earth), so a 9.6 L* gap between them was not
//       separation, it was a cliff. They now sit at 45 / 49.6 — a ~4.6 step —
//       and are told apart by hue and texture instead. Rule (a) still governs
//       DIFFERENT families; it never asked two states of one material to jump.
//
//    b) WITHIN a ground family, COMPRESS. The D->H ramps used to span 27-35 L*,
//       so a handful of speckle pixels shouted louder than the whole tile. Each
//       family gained a mid tone (`grassM`, `dirtM`, `pathM`, `stoneM`) so a
//       mark can be 2-5 L* off the base instead of 9-18, and the outer H tones
//       were pulled in. Props and walls still use the wide ramps — it is only
//       the ground that had to quieten down.
//
//    The `XD` entries are new: an occlusion value one step below each family's
//    D, used for prop keylines, wall base bands and roof eaves so an object
//    reads as SITTING ON the ground rather than as a decal printed on it.
// ---------------------------------------------------------------------------

export const PAL = {
  void: '#0a0a0c', voidL: '#141419',

  grass: '#4a7c3f', grassD: '#3f6a36', grassL: '#5a8f4c', grassH: '#6aa356',
  grassM: '#527f43', grassS: '#456f3a', grassXD: '#2f5228',
  grassDry: '#7f8f47', tallD: '#3d6b34', tall: '#4e8442', tallL: '#63a052',
  clover: '#6aa85c',

  // DIRT -> DIRT_PATH used to be a 9.6 dL* VALUE CLIFF between two tiles of the
  // same material (mean L* 42.8 vs 52.1) with no interlock and no hue change —
  // the one cue a road/soil boundary had was raw lightness, so Phandalin's 164
  // dirt|path joins read as a brown checkerboard. Both families were walked
  // toward each other (dirt +2.2, path -2.6) to a ~4.5 dL* step, and the
  // difference they lost in value was put back as HUE and TEXTURE: `dirt` gained
  // 6% chroma (fresh, damp earth), `path` lost 10% (dust-greyed and trodden),
  // and DIRT_PATH now carries a compacted centre, embedded grit and cart scuffs
  // that plain DIRT does not.
  dirt: '#856542', dirtD: '#705639', dirtL: '#997b50', dirtM: '#8e6e49',
  path: '#887055', pathD: '#6e5b44', pathL: '#9d876a', pathM: '#81684e',
  pathW: '#937b5f', pathXD: '#594836', pebble: '#8f8577',
  mud: '#5f4a33', mudD: '#463626', mudL: '#7a6144',
  sand: '#d8c58c', sandD: '#c4ae76', sandL: '#e6d5a4', sandM: '#cebb83',

  stone: '#6d6a63', stoneD: '#4e4c47', stoneL: '#8b8880', stoneH: '#a5a29a',
  stoneM: '#7c7972', stoneG: '#5d5a54', stoneXD: '#2a2724',
  cobble: '#7a7167', cobbleD: '#5b534a', cobbleL: '#8e8478', cobbleH: '#9c9184',
  // A rock lying on cave floor measured ΔE76 4.18 and 1.06:1 contrast — the two
  // were, to the eye, the same surface, and the floor's own -12 L* speckle came
  // in 2-3px slabs that read as loose pebbles and finished the job. The family
  // dropped 1.6 L* to make room under the (now pale granite) rock props, and
  // `caveS` is the new SHALLOW damp tone the floor textures with instead of
  // flinging `caveD` around.
  cave: '#564d44', caveD: '#39322b', caveL: '#766b5e', caveH: '#908576',
  caveM: '#63594e', caveS: '#4d453d', caveWD: '#2c2721', caveW: '#453d34', caveWL: '#615749',
  dgn: '#4a4753', dgnD: '#302e39', dgnL: '#63606e', dgnH: '#7d7a89',
  dgnM: '#565361', dgnWD: '#25242c', dgnW: '#3a3844',
  gravel: '#7a736a',

  // ROCK against GRAVEL measured dE76 4.18 at 1.14:1 — a grey lump on grey
  // chippings, separated by neither value nor hue. Both ends move, and neither
  // move touches `stone*` or `cobble*`, which walls and streets depend on.
  //
  // GRAVEL becomes SCREE: broken hill-stone, same value as before (mean L*
  // ~38, so its relationship to grass and dirt is unchanged for the fringe
  // work) but warm — b* 11-17 against the old 6 — because a road aggregate is
  // crushed local rock, not kerbstone.
  scree: '#5c5140', screeM: '#7d7159', screeL: '#8f8468', screeD: '#443a2c',
  // ROCK becomes GRANITE: COOL — b* -4 to -6 — which is what a granite boulder
  // actually is next to warm soil, and which puts ~20 b* between the rock and
  // the scree.
  //
  // 2026-08b: that hue swing was doing ALL the work. A rock on gravel measured
  // dE76 11.78 of which only 2.52 was dL* — so a value-blind reader (and anyone
  // looking at the game through the fog/night tints, which compress chroma far
  // harder than value) saw a grey lump on grey chippings again. The whole ramp
  // moves up ~8 L*, which is what a lit granite erratic actually is against
  // crushed local rock, and the keyline `graniteXD` deliberately does NOT move:
  // the prop now separates by being LIGHTER than every ground it sits on and by
  // carrying its own dark rim where the light cannot reach.
  granite: '#94969f', graniteL: '#b5b8c2', graniteH: '#d2d5df',
  graniteD: '#6b6d76', graniteM: '#a2a5ae', graniteXD: '#2f3036',

  wood: '#7a5333', woodD: '#5a3c24', woodL: '#9a6b43', woodH: '#b58554',
  bark: '#6b4a2f', barkD: '#4a3220', barkL: '#8a6240', barkXD: '#31200f',
  thatch: '#b8934f', thatchD: '#8d6f3a', thatchL: '#d2ae68',
  thatchM: '#a68345', thatchXD: '#6f5729',
  shingle: '#7b4a3c', shingleD: '#59342a', shingleL: '#9a6250', shingleXD: '#3f231b',
  tileRoof: '#a55c3a', tileRoofD: '#7c412a', tileRoofL: '#c47a53', tileRoofXD: '#5a2c1b',
  plaster: '#d6c9a6', plasterD: '#b3a683', plasterXD: '#8a7d5e',

  brick: '#8a4f3c', brickD: '#67382a', brickL: '#a4674f',

  water: '#3a6ea5', waterD: '#2b5480', waterL: '#5b93c9', foam: '#a9d8ee',
  deep: '#23406b', deepD: '#182f52', deepL: '#33578a',

  // THE WATERLINE. SHORE_* used to be a whole tile of `sand` (L* 79.9) with a
  // 2-8px water strip cut out of it — a beach. No map in this game puts water
  // beside sand: Neverwinter's waterline meets a cobble quay (L* 48.2) and the
  // Neverwinter Wood river runs through grass (L* 47.3), so the sand read as a
  // yellow rectangle laid over both and took the mean |dL*| across the
  // waterline from 5.4 to 34.2. That is why wiring the shore family up was
  // (correctly) backed out.
  //
  // A river bank and a harbour wall are not beaches, they are WET MARGINS:
  // silt, soaked earth and green-black stone that sit a few L* BELOW whatever
  // ground they meet and INSIDE the water's own value range (water 45.3,
  // waterD 34.8, deep 27.0). `silt` 41.6 is 5.7 under grass and 6.6 under
  // cobble — a bank, visible, but not a different planet. `shallow` is the
  // water thinned over that silt, so the transition is ground -> damp -> wet
  // -> shallow -> water across four pixels instead of one hard cut.
  silt: '#6b6150', siltM: '#57503c', siltD: '#4e4738', siltXD: '#3a352a',
  shallow: '#4c6a80', shallowD: '#3f5f79',
  // The same margin where the water meets masonry: a soaked, algae-darkened
  // kerb instead of mud. QUAY_* uses these; SHORE_* uses the silt above.
  quayL: '#6f665a', quay: '#585045', quayD: '#3d3830',
  swamp: '#4a6040', swampD: '#35482d', swampL: '#5f7a4f', scum: '#7d9a4c',
  ice: '#a9d6e8', iceD: '#7fb4cc', iceL: '#d8f1fb',
  snow: '#e9f0f5', snowD: '#c6d3de', snowS: '#adbccb',

  lavaCrust: '#5e2a17', lavaCrustD: '#3d1a0e', lava: '#e2531f', lavaHot: '#ff9a2a',
  lavaWhite: '#ffe07a',
  ash: '#57524e', ashD: '#3c3835', ashL: '#736d67', ashH: '#8e877f',

  metal: '#a9b1bf', metalD: '#767e8c', metalL: '#d5dae3',
  iron: '#5f6570', ironD: '#41464e', ironXD: '#22262c',
  gold: '#e3b34a', goldD: '#a97f27', goldL: '#f5d987',
  silver: '#c9d1da',

  bone: '#ded7c0', boneD: '#ab9f83', boneL: '#f2ecd8',
  cloth: '#c8b58a', clothD: '#a2926c',
  red: '#a8342f', redD: '#7a211e', redL: '#c9564a',
  blue: '#37527a', blueD: '#263a58', blueL: '#5273a4',
  green: '#3f7a3a', purple: '#8a5ec2', purpleD: '#5b3c86',

  // Foliage sat at ΔL* 1.3 / ΔE 3.8 from grass — an oak canopy was, to the eye,
  // the same colour as the field it stood in. Dropped a full value step.
  leaf: '#33682f', leafD: '#22461f', leafL: '#4f9645', leafH: '#6ab35b',
  leafXD: '#173312',
  pine: '#2f5f45', pineD: '#204431', pineL: '#3f7d59', pineH: '#559970',
  pineXD: '#13291d',
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

/**
 * A rect clipped to this tile's own 16x16 box. Marks may be given coordinates
 * that hang off the edge (-1, or 15 with width 3) and the clip leaves whatever
 * fragment lands inside.
 *
 * That used to be described here as "what a natural surface looks like where it
 * runs under the next tile". It is not, and section 2a below has the
 * measurement: the next tile is a different variant and paints something else
 * entirely, so a clipped mark is a shape that stops dead at the border. Hanging
 * a mark off the edge is now only ever done in PAIRS — the same mark drawn at
 * both -k and 16-k, from the family-fixed generator, so the two fragments are
 * the two halves of one mark and the neighbour really does carry the other one.
 */
function mark(c, col, x, y, mx, my, w, h) {
  const ax = Math.max(0, mx), ay = Math.max(0, my);
  const bx = Math.min(16, mx + w), by = Math.min(16, my + h);
  if (bx <= ax || by <= ay) return;
  R(c, col, x + ax, y + ay, bx - ax, by - ay);
}

// ---------------------------------------------------------------------------
// 2a. THE 16px SEAM — why the old edgeBreak() was not enough, and what
//     replaced it (`seam` + `inX`/`inY` + `dashesI`/`bladesI`)
//
// MEASUREMENT. "Grid visibility" = the mean |dL*| between the two pixels either
// side of a 16px tile border, divided by the mean |dL*| between two adjacent
// pixels INSIDE a tile, both measured across a field of ONE family so no
// material change is involved. 1.0 means the border is statistically
// indistinguishable from the tile interior. A 14x14 field measured:
//
//     GRASS 2.25   SAND 2.78   MUD 2.63   DIRT 1.83   SNOW 1.75
//     COBBLE 1.54  DIRT_PATH 1.51   CAVE_FLOOR 1.89   SNOW_GRASS 2.20
//     FLAGSTONE 0.44   STONE_FLOOR 0.47   <- the two that were already fixed
//
// and after the work below, on the same fields:
//
//     GRASS 0.49   SAND 0.62   MUD 0.07   DIRT 0.22   SNOW 0.38
//     COBBLE 0.96  DIRT_PATH 0.15   CAVE_FLOOR 0.32   SNOW_GRASS 0.10
//     GRAVEL 0.86  FARMLAND 0.13    WATER 0.08        DUNGEON_FLOOR 0.97
//
// Two more numbers matter alongside the ratio, because a ratio can be bought
// by making the border DEAD rather than by making it match — a 1px smooth
// picture-frame every 16 pixels is the same defect wearing different clothes.
// So the ring is also held to the interior's MEAN (within ~1 L*) and to its
// texture ENERGY (ring SD / interior SD, held to 0.6-1.2). Every tone pool and
// mark count in `SEAM_TONE` was picked against those two, not by eye.
//
// THE CAUSE. edgeBreak() scattered marks ONTO rows 0/15 and columns 0/15 using
// the tile's own VARIANT rng. Two things went wrong at once:
//
//   1. it made the border ring the BUSIEST part of the tile. Two marks per edge,
//      2-4px each, is ~35% extra ink on a 16px line that already carried the
//      base speckle. Per-column L* SD for grass ran 5.23 on column 15 against
//      ~2.4 in the middle of the tile;
//   2. a mark clipped at the top edge of a tile has NO MATCHING HALF on the tile
//      above, because the tile above is a different variant and ran a different
//      rng. So the two sides of every seam were independent samples of a noisy
//      distribution, where two pixels inside a tile are correlated. Independent
//      samples differ more. edgeBreak changed the seam's COLOUR; it made the
//      seam's STATISTICS worse.
//
// Deleting edgeBreak alone took GRASS 2.25 -> 1.03 and DIRT 1.83 -> 0.91, which
// is the whole size of the effect. What is left after that is SHAPE: a clod, a
// damp patch or a cobble that gets sliced in half by the tile box still ends in
// mid-air at the seam.
//
// THE FIX, in two halves.
//
//   INBOARD. Every mark bigger than one pixel is now placed so it cannot touch
//   the outer ring (`inX`/`inY` below, and the `dashesI`/`bladesI` scatterers).
//   Nothing large is ever clipped by the tile box, so nothing ends in mid-air.
//   1px speckle is still scattered over the whole tile — a single pixel has no
//   shape to truncate, and its statistics are the same on the border as inside,
//   which is exactly what the metric is asking for.
//
//   WRAPPED. `seam()` then puts the mid-size texture back on the ring, but
//   drawn from a FAMILY-FIXED rng instead of the variant rng, and drawn TWICE:
//   once hanging over the right edge and once hanging over the left edge of the
//   same tile, 16px apart. Every tile in the family therefore paints the two
//   halves of the same mark, so whatever variants the position hash deals out,
//   tile A's right-hand fragment and tile B's left-hand fragment ARE one mark
//   that genuinely straddles the seam. This is the shared-edge idea in the only
//   form available to a raster cached by (id, variant, frame): the seam's
//   content is a pure function of the family, which both neighbours know.
// ---------------------------------------------------------------------------

/**
 * The family-fixed generator. `sr(seed)` is seeded from the tile's variant, so
 * two neighbours never agree; `fr(salt)` is seeded from a per-family constant,
 * so every tile of one family draws its border ring identically and the ring
 * lines up across every seam in the map.
 */
function fr(salt) { return sr((0x5EA3B4 ^ Math.imul(salt | 0, 0x9E3779B1)) >>> 0); }

/** A top-left x for a `w`-wide mark that cannot touch column 0 or column 15. */
function inX(r, w) { return 1 + Math.floor(r() * Math.max(1, 15 - w)); }
/** A top-left y for an `h`-tall mark that cannot touch row 0 or row 15. */
function inY(r, h) { return 1 + Math.floor(r() * Math.max(1, 15 - h)); }

/** `dashes`, kept clear of the tile's outer ring. Same rng draw count. */
function dashesI(c, col, x, y, n, r, len = 2) {
  for (let i = 0; i < n; i++) R(c, col, x + 1 + Math.floor(r() * (15 - len)), y + 1 + Math.floor(r() * 14), len, 1);
}
/** `blades`, kept clear of the tile's outer ring. Same rng draw count. */
function bladesI(c, col, x, y, n, r, len = 2) {
  for (let i = 0; i < n; i++) R(c, col, x + 1 + Math.floor(r() * 14), y + 1 + Math.floor(r() * (15 - len)), 1, len);
}

/**
 * SEAM WEAVE — the wrapping border band described above.
 *
 *   salt   a per-family constant. Two families must not share one, or their
 *          rings would be the same pattern; every family in this file uses its
 *          own entry in `SEAM` below.
 *   tones  the colours to draw from, listed with repeats to weight them. Match
 *          them to the family's own interior texture: the point of the ring is
 *          that it is INDISTINGUISHABLE from the tile's middle, so a family that
 *          mottles in ±3 L* patches wants patch-sized runs here too, and one
 *          that only speckles wants short ones.
 *   n      how many marks. Each is drawn twice (both sides of one seam).
 *   run    the longest a mark may run ALONG the seam.
 *   span   the deepest a mark may reach ACROSS the seam (total, both tiles).
 *
 * A mark never runs off the END of its edge, so no mark needs the agreement of
 * a diagonal neighbour and the four corners stay consistent.
 */
function seam(c, x, y, salt, tones, n = 8, run = 4, span = 4) {
  const r = fr(salt);
  const tn = tones.length;
  for (let i = 0; i < n; i++) {
    const col = tones[Math.floor(r() * tn)];
    const w = 2 + Math.floor(r() * (span - 1));      // total depth across the seam
    const k = 1 + Math.floor(r() * (w - 1));         // how much of it is on THIS tile
    const h = 1 + Math.floor(r() * run);             // length along the seam
    const t = Math.floor(r() * (17 - h));
    if (i & 1) {                                     // a vertical seam (left|right)
      mark(c, col, x, y, 16 - k, t, w, h);
      mark(c, col, x, y, -k, t, w, h);
    } else {                                         // a horizontal seam (top|bottom)
      mark(c, col, x, y, t, 16 - k, h, w);
      mark(c, col, x, y, t, -k, h, w);
    }
  }
}

/** Per-family seam salts. Never reuse one: two families sharing a salt share a ring. */
const SEAM = {
  grass: 11, dirt: 12, path: 13, cave: 14, sand: 15, mud: 16, snow: 17,
  snowGrass: 18, tall: 19, gravel: 20, rut: 21, cobble: 23, bank: 24, water: 25,
};

/**
 * The tone pool each family's ring draws from. Weighted by repetition, and
 * deliberately built from that family's OWN mid tones — the ring has to be the
 * same material as the tile it edges, not a decorative border.
 */
const SEAM_TONE = {
  grass: [PAL.grassS, PAL.grassS, PAL.grassM, PAL.grass, PAL.grassS, PAL.grassM],
  dirt: [PAL.dirtM, PAL.dirtD, PAL.dirtM, PAL.dirt, PAL.dirtD, PAL.dirtM],
  path: [PAL.pathM, PAL.pathW, PAL.path, PAL.pathM, PAL.path, PAL.pathM],
  cave: [PAL.caveS, PAL.caveS, PAL.caveM, PAL.caveS, PAL.caveS, PAL.caveS],
  sand: [PAL.sandM, PAL.sandD, PAL.sandM, PAL.sandL, PAL.sandM, PAL.sandD],
  mud: [PAL.mud, PAL.mudD, PAL.mudL, PAL.mudD, PAL.mudL, PAL.mud],
  snow: [PAL.snowD, PAL.snow, PAL.snow, PAL.snowD, PAL.snow, PAL.snow],
  tall: [PAL.tall, PAL.tallD, PAL.tall, PAL.tallL, PAL.tallD, PAL.tall],
  water: [PAL.waterD, PAL.water, PAL.water, PAL.water, PAL.waterL, PAL.water],
};

/**
 * Pre-built shadow inks, indexed by alpha in hundredths. Built once at module
 * load: a `draw` runs on a cache miss, but building an rgba() string per band
 * per prop is pointless garbage, so don't.
 */
const SHADE = [];
for (let i = 0; i <= 64; i++) SHADE.push(`rgba(16,11,8,${(i / 100).toFixed(2)})`);
const shade = (a) => SHADE[a < 0 ? 0 : (a > 0.64 ? 64 : Math.round(a * 100))];

/**
 * FOOTPRINT SHADOW — the one every deco prop should use.
 *
 * An audit found 29 of the 66 deco props darkening FEWER THAN FOUR ground
 * pixels, i.e. casting nothing at all, which is why they read as stickers
 * printed on the floor rather than objects standing on it. Two causes, both
 * fixed here:
 *
 *   1. a shadow exactly as wide as its object is entirely hidden BEHIND that
 *      object. This one deliberately spills 1-2px proud on both sides and
 *      further down-right, because the light in this tileset comes from the
 *      upper-left and a real cast shadow is bigger than its contact patch;
 *   2. a shadow whose core row was the prop's own last row had nowhere to land.
 *      The core here is the row BELOW the foot.
 *
 *   bx, bw  the prop's footprint on its lowest painted row
 *   by      that lowest painted row
 *   str     scales the whole thing — a boulder throws more than a mushroom
 */
function foot(c, x, y, bx, bw, by, str = 1) {
  const put = (row, ax, aw, al) => {
    const x0 = Math.max(0, ax | 0), x1 = Math.min(16, (ax + aw) | 0);
    if (row < 0 || row > 15 || x1 <= x0) return;
    c.fillStyle = shade(al * str);
    c.fillRect(x + x0, y + row, x1 - x0, 1);
  };
  put(by - 1, bx - 1, bw + 3, 0.15);
  put(by, bx - 2, bw + 5, 0.30);
  put(by + 1, bx - 1, bw + 5, 0.46);
  put(by + 2, bx + 1, bw + 3, 0.28);
  put(by + 3, bx + 3, bw, 0.13);
}

/**
 * `foot` rotated a quarter turn: the shadow a TILE-TALL prop throws sideways.
 * A fence post run or a ladder fills its tile top to bottom, so there is no
 * ground left underneath to darken — but the light is in the upper-left, so the
 * shadow falls on the ground down the prop's RIGHT-hand side. `bx` is the first
 * free column to the right of the prop.
 */
function footRight(c, x, y, bx, by, bh, str = 1) {
  const put = (col, ay, ah, al) => {
    const y0 = Math.max(0, ay | 0), y1 = Math.min(16, (ay + ah) | 0);
    if (col < 0 || col > 15 || y1 <= y0) return;
    c.fillStyle = shade(al * str);
    c.fillRect(x + col, y + y0, 1, y1 - y0);
  };
  put(bx - 1, by, bh, 0.30);
  put(bx, by - 1, bh + 2, 0.46);
  put(bx + 1, by, bh + 2, 0.28);
  put(bx + 2, by + 1, bh, 0.13);
}

/**
 * The centred form of `foot`, kept for every caller that already had one.
 *
 *   w   footprint width (the widest row)
 *   yy  the row the CORE sits on — put it directly under the prop's lowest row
 */
function contact(c, x, y, w = 10, yy = 14, dx = 1) {
  const wc = Math.max(2, w | 0);
  foot(c, x, y, ((16 - wc) >> 1) + dx, wc, yy - 1);
}

/**
 * The same shadow, addressed by the prop's own footprint rather than by a magic
 * row number: `bottom` is the last row the prop paints, so the core lands on the
 * very next row and the prop is never left hovering.
 */
function shadowUnder(c, x, y, w, bottom, dx = 1) { contact(c, x, y, w, Math.min(15, bottom + 1), dx); }

/**
 * KEYLINE. A 1px dilation of a blob row list, painted BEFORE the body so the
 * prop keeps a dark rim against whatever ground it lands on. Measured: a rock
 * on cave floor had 92% of its silhouette under 12 Y of contrast — invisible.
 * With a keyline it cannot fall below the keyline's own step, on any ground.
 */
function outline(c, col, x, y, rows) {
  for (let i = 0; i < rows.length; i++) {
    const q = rows[i];
    R(c, col, x + q[1] - 1, y + q[0], q[2] + 2, 1);
    R(c, col, x + q[1], y + q[0] - 1, q[2], 1);
    R(c, col, x + q[1], y + q[0] + 1, q[2], 1);
  }
}
/** Keyline for a rectangular prop: a filled box one pixel proud on every side. */
function outlineBox(c, col, x, y, bx, by, w, h) { R(c, col, x + bx - 1, y + by - 1, w + 2, h + 2); }

// --- shared terrain bases --------------------------------------------------

/**
 * Grass. The old version put 7 two-pixel `grassD` dashes (-9 L*) and 3 two-pixel
 * `grassH` blades (+18 L*) on a four-colour tile: countable chunky dots, 10% of
 * the tile at ±18 L* amplitude. Now six tones, mostly 1px, mostly within ±5 L*,
 * plus a seam breaker. Interior busyness drops from ~4.4 Y to ~2.5 Y.
 */
function grassBase(c, x, y, r, base = PAL.grass) {
  R(c, base, x, y, 16, 16);
  // A soft sward patch — one small, low-amplitude wash, kept inboard. Deliberately
  // small: the per-tile mean L* of a field of ONE grass tile has to stay flat
  // (SD ~0.1) or a lawn turns into a chequerboard of slightly different greens.
  // The 0.47-0.49 SD the value pass wants out of a MIXED grass field comes from
  // the four tile types sitting at different means, not from within-type noise.
  { const pw = 3 + Math.floor(r() * 4), ph = 3 + Math.floor(r() * 4); mark(c, PAL.grassS, x, y, inX(r, pw), inY(r, ph), pw, ph); }
  speck(c, PAL.grassS, x, y, 10, r);
  dashesI(c, PAL.grassD, x, y, 4, r, 2);
  speck(c, PAL.grassM, x, y, 9, r);
  speck(c, PAL.grassL, x, y, 5, r);
  bladesI(c, PAL.grassH, x, y, 2, r, 2);
  seam(c, x, y, SEAM.grass, SEAM_TONE.grass, 8, 3, 3);
}

/**
 * Loose earth. DIRT and DIRT_PATH now sit only ~4.6 L* apart, so the thing that
 * has to tell them apart is SURFACE, not value: bare dirt is CLODDY — broken
 * lumps with a lit crown and a shadowed underside — where a path is compacted
 * and smooth. The clods straddle the tile border (`mark` clips them) so the
 * lumpiness carries across the seam instead of restarting every 16px.
 */
function dirtBase(c, x, y, r, base = PAL.dirt) {
  R(c, base, x, y, 16, 16);
  speck(c, PAL.dirtD, x, y, 9, r);
  dashes(c, PAL.dirtD, x, y, 3, r, 2);
  speck(c, PAL.dirtM, x, y, 8, r);
  // Broken clods: a 2-4px lump, lit on top-left, dark on the row beneath. These
  // used to be placed at -1..15 so they hung off the tile — which meant every
  // clod at a border was a lump sliced in half with no other half anywhere. The
  // clod (crown + shadow row) is three rows tall, so it is placed to finish
  // inside the tile; the ring gets its clods from `seam` instead.
  for (let i = 0; i < 4; i++) {
    const w = 2 + Math.floor(r() * 3);
    const cx = inX(r, w), cy = inY(r, 3);
    mark(c, PAL.dirtM, x, y, cx, cy, w, 2);
    mark(c, PAL.dirtL, x, y, cx, cy, w - 1, 1);
    mark(c, PAL.dirtD, x, y, cx + 1, cy + 2, w - 1, 1);
  }
  speck(c, PAL.dirtL, x, y, 4, r);
  seam(c, x, y, SEAM.dirt, SEAM_TONE.dirt, 11, 3, 3);
}

/**
 * Flagstone slabs. The mortar gutter used to sit on row 15 / col 15 and the lit
 * slab-top on row 0 / col 0, so where two tiles met a dark mortar line abutted a
 * light slab-top: the tile seam was the single highest-contrast line on the
 * whole floor (measured 4.6x the interior contrast). The gutter is inboard now
 * — rows 6 and 13, cols 6 and 13 — and the highlight follows it, so nothing
 * lands on the tile border at all.
 */
function stoneSlabs(c, x, y, base, dark, light) {
  R(c, base, x, y, 16, 16);
  H(c, dark, x, y + 6, 16); H(c, dark, x, y + 13, 16);
  V(c, dark, x + 6, y, 16); V(c, dark, x + 13, y, 16);
  H(c, light, x, y + 7, 6); H(c, light, x + 7, y + 7, 6);
  H(c, light, x, y + 14, 6); H(c, light, x + 7, y + 14, 6);
  V(c, light, x + 7, y, 6); V(c, light, x + 14, y, 6);
}

/**
 * Cave floor. The old recipe flung five 3x2 slabs of `caveD` — a -12 L* step —
 * into every tile, which is 30 pixels of hard dark in countable lumps: they
 * read as loose pebbles, and a real ROCK prop lying among them had nothing to
 * distinguish it (measured ΔE76 4.18 against the floor, 1.06:1 contrast).
 *
 * Now the large-scale variation is DAMP PATCHES in `caveS`, a -3.5 L* tone,
 * drawn wide and allowed to run off the tile edge; only single pixels are ever
 * as dark as `caveD`. Same amount of information, none of it in blobs.
 */
function caveBase(c, x, y, r) {
  R(c, PAL.cave, x, y, 16, 16);
  // The damp patches used to be placed at -5..14 and allowed to run off the
  // tile, which put a hard -3.5 L* edge on the tile border wherever one was
  // sliced. They stay inboard now; `seam` supplies the ring's own damp mottle,
  // wrapped, so the patch scale is present on the border as well without any
  // patch ever ending in mid-air at a seam.
  for (let i = 0; i < 3; i++) {
    const w = 5 + Math.floor(r() * 6), h = 3 + Math.floor(r() * 4);
    mark(c, PAL.caveS, x, y, inX(r, w), inY(r, h), w, h);
  }
  speck(c, PAL.caveS, x, y, 9, r);
  speck(c, PAL.caveM, x, y, 9, r);
  speck(c, PAL.caveD, x, y, 5, r);          // grit — 1px, never a slab
  speck(c, PAL.caveL, x, y, 3, r);
  seam(c, x, y, SEAM.cave, SEAM_TONE.cave, 13, 4, 3);
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
// 2b. THE LONE PATCH — what a tile with no neighbours of its own kind must be
//
// The verge machinery in world/overworld.js refuses, correctly, to fringe a
// tile that has NO cardinal neighbour of its own material: eating 1-7px off all
// four sides of a 16px tile leaves 42-62% of it, which is a smaller square, not
// a softer one. That rule left the single worst-looking ground in the game
// standing: 125 SNOW_GRASS tiles scattered through Neverwinter Wood's forest as
// hard white 16px squares with four straight sides and 90-degree corners, plus
// 62 DIRT, 57 DIRT_PATH, 16 GRAVEL and 11 COBBLE doing the same elsewhere.
// (Measured in situ by walking every map's ground plane; see tools/px/maps.mjs.)
//
// A lone tile of a material is not an edge case of a field — it is a DIFFERENT
// THING, a patch, and it wants to be drawn as one: the surrounding family's
// ground painted right across the tile, with an irregular blob of the patch
// material sitting on top of it, well clear of the tile border. Then:
//
//   * the tile's outer ring is 100% the SURROUNDING family, drawn from that
//     family's own recipe — including its family-fixed `seam` weave — so the
//     patch tile joins the field around it exactly as one of its own would.
//     There is no 16px boundary to see because there is no material change at
//     the border at all;
//   * the material boundary is now the blob's, which is round, irregular and
//     two pixels of stipple wide instead of a ruler line;
//   * and 125 of them are not 125 copies. The outline is a per-angle random
//     walk taken from the tile's variant hash, so the SHAPE varies, not just
//     the position — which is the difference between scattered patches and a
//     stamp moved around.
//
// WHICH surround each patch is painted on is not guessable at draw time (the
// raster is cached by (id, variant, frame) and cannot look at a neighbour), so
// it is measured instead: `isleTileFor` documents, per material, the ground its
// islands actually sit in across the 17 maps.
// ---------------------------------------------------------------------------

/** Per-angle radii, and a double-buffer for the smoothing pass. */
const ISLE_R = new Float64Array(16);
const ISLE_T = new Float64Array(16);
/** 0 = surround, 1 = the stippled fringe, 2 = solid patch. One byte per pixel. */
const ISLE_MASK = new Uint8Array(256);
/** Salt for the per-pixel stipple, set by isleMask and read by isleFill. */
let ISLE_SALT = 0;

/**
 * Build ISLE_MASK. `rad` is the mean radius and `wob` how far the outline may
 * wander from it; the walk is smoothed twice so the blob is lumpy rather than
 * spiky, and rotated by a per-variant angle so the lumps do not all sit in the
 * same place. The geometry is bounded so the blob can never reach columns 0 or
 * 15 — that is what keeps the tile's border ring pure surround.
 */
function isleMask(r, rad = 5.0, wob = 1.0) {
  // THREE independent things vary, not one. A patch that only wobbles its
  // outline is still recognisably the same patch every time: the eye reads
  // overall SIZE and ELONGATION long before it reads a two-pixel lobe. So the
  // mean radius scales, the blob is squashed along an axis that rotates with
  // it, and only then does the per-angle walk go on top.
  const cx = 8 + (r() * 1.8 - 0.9), cy = 8 + (r() * 1.8 - 0.9);
  const sc = 0.74 + r() * 0.42;
  const ecc = (r() * 2 - 1) * 0.26;
  for (let i = 0; i < 16; i++) ISLE_R[i] = rad * sc * (1 + ecc * Math.cos(i * 0.7853981634)) + (r() * 2 - 1) * wob;
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < 16; i++) ISLE_T[i] = (ISLE_R[(i + 15) & 15] + ISLE_R[i] * 2 + ISLE_R[(i + 1) & 15]) * 0.25;
    for (let i = 0; i < 16; i++) ISLE_R[i] = ISLE_T[i];
  }
  // THE ONE HARD BOUND: no painted pixel may land on row/column 0 or 15, so the
  // tile's border ring stays 100% surround and joins the field around it with
  // no material change at all. `lim` is the largest radius that satisfies that
  // FROM THIS CENTRE (the outermost stipple sits 0.7 beyond the outline, and a
  // pixel's centre is at +0.5), and it is enforced by SCALING the whole outline
  // rather than clipping it — an oversized blob comes back as a smaller blob of
  // the same shape, never as one with a flat side.
  const lim = Math.min(13.79 - cx, cx - 1.21, 13.79 - cy, cy - 1.21);
  let mx = 0;
  for (let i = 0; i < 16; i++) if (ISLE_R[i] > mx) mx = ISLE_R[i];
  if (mx > lim) { const k = lim / mx; for (let i = 0; i < 16; i++) ISLE_R[i] *= k; }
  const rot = r() * 6.2831853;
  ISLE_SALT = 1 + Math.floor(r() * 60000);
  ISLE_MASK.fill(0);
  for (let py = 1; py <= 14; py++) {
    for (let px = 1; px <= 14; px++) {
      const dx = px + 0.5 - cx, dy = py + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 7.2) continue;
      let a = (Math.atan2(dy, dx) + rot) * 2.5464790894703255;   // 16 / 2pi
      a -= Math.floor(a / 16) * 16;
      const i0 = Math.floor(a) & 15, t = a - Math.floor(a);
      const rr = ISLE_R[i0] * (1 - t) + ISLE_R[(i0 + 1) & 15] * t;
      const k = d - rr;                                          // <0 inside
      if (k > 0.7) continue;
      if (k < -1.3) { ISLE_MASK[py * 16 + px] = 2; continue; }
      // The stipple ramp: a two-pixel dissolve instead of an edge, exactly the
      // dither `verge()` uses where a road meets turf. The outermost band is
      // kept thin on purpose — a scatter of lone patch pixels two pixels out
      // reads as sparkle against a dark surround, not as a soft edge.
      const keep = k < -0.6 ? 0.80 : (k < 0.15 ? 0.45 : 0.15);
      if ((tileHash(px, py, ISLE_SALT) & 1023) < keep * 1024) ISLE_MASK[py * 16 + px] = 1;
    }
  }
}

/**
 * Paint the mask. `core` is the tone pool for the solid middle and `edge` the
 * pool for the stipple, both weighted by repetition like SEAM_TONE. The pixel's
 * tone is a hash of its own coordinates, so the patch carries its material's
 * speckle without a second scatter pass.
 */
function isleFill(c, x, y, core, edge) {
  const nc = core.length, ne = edge.length;
  for (let py = 1; py <= 14; py++) {
    for (let px = 1; px <= 14; px++) {
      const m = ISLE_MASK[py * 16 + px];
      if (!m) continue;
      const h = tileHash(px, py, ISLE_SALT + 77) >>> 8;
      P(c, m === 2 ? core[h % nc] : edge[h % ne], x + px, y + py);
    }
  }
}

/**
 * The patch's own form. The light in this tileset is upper-left, so the patch's
 * BOTTOM edge takes the shaded tone and its TOP edge the lit one — two pixels
 * of work that turn a stain into something lying on the ground.
 *
 * Only the top and bottom, deliberately. Ringing the whole silhouette (which is
 * what the first version did) puts a dark outline all the way round a blob that
 * is only nine or ten pixels across, and the patch stops reading as its own
 * material and starts reading as a dark spot.
 */
function isleRim(c, x, y, dark, light) {
  for (let py = 1; py <= 14; py++) {
    for (let px = 1; px <= 14; px++) {
      if (ISLE_MASK[py * 16 + px] !== 2) continue;
      const below = py > 14 ? 0 : ISLE_MASK[(py + 1) * 16 + px];
      const above = py < 1 ? 0 : ISLE_MASK[(py - 1) * 16 + px];
      if (dark && below !== 2) P(c, dark, x + px, y + py);
      else if (light && above !== 2) P(c, light, x + px, y + py);
    }
  }
}

/** A mark clipped to the SOLID part of the patch: texture that cannot leak out. */
function isleMark(c, col, x, y, mx, my, w, h) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const ax = mx + i, ay = my + j;
      if (ax < 1 || ax > 14 || ay < 1 || ay > 14) continue;
      if (ISLE_MASK[ay * 16 + ax] !== 2) continue;
      P(c, col, x + ax, y + ay);
    }
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
    // `edgeVariant` tiles do not pick their variant from their own position:
    // the index IS the four shared-border codes (see edgeVariantAt), so two
    // neighbours agree about the border they have in common. Such a tile must
    // declare `variants: 16`.
    edgeVariant: !!opts.edgeVariant,
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
    bladesI(c, PAL.grassL, x, y, 4, r, 3);
    speck(c, PAL.grassH, x, y, 3, r);
    dashesI(c, PAL.grassS, x, y, 3, r, 3);
  });

  // Was `grassBase(..., PAL.grassL)` — a WHOLE value step up on the base, which
  // is why a mixed grass field read as a patchwork quilt of bright 16px squares
  // (ΔL* +7.4, ΔE 7.9 from GRASS). `grassM` is a 1.5 L* step: variation, not a
  // different material.
  def('GRASS_3', 'Grass', 0, { group: 'grass', biomes: ['plains', 'hills'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v); grassBase(c, x, y, r, PAL.grassM);
    dashesI(c, PAL.grass, x, y, 4, r, 3);
    speck(c, PAL.grassL, x, y, 6, r);
  });

  // `speck(PAL.dirtL, ...)` scattered ORANGE on green — rust confetti, ΔE ~40.
  // Dry grass should be dry grass.
  def('GRASS_4', 'Dry Grass', 0, { group: 'grass', biomes: ['plains', 'road', 'coast'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v); grassBase(c, x, y, r);
    dashesI(c, PAL.grassDry, x, y, 4, r, 2);
    speck(c, PAL.grassDry, x, y, 6, r);
    speck(c, PAL.grassS, x, y, 12, r);
  });

  // The encounter tile: darker ground, blades that break the top edge.
  def('GRASS_TALL', 'Tall Grass', ENCOUNTER | SLOW, { group: 'grass', biomes: ['plains', 'forest', 'marsh'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.tallD, x, y, 16, 16);
      dashesI(c, PAL.tall, x, y, 8, r, 3);
      for (let i = 0; i < 12; i++) {
        const hgt = 4 + Math.floor(r() * 3);
        const bx = x + 1 + Math.floor(r() * 14), by = y + 1 + Math.floor(r() * (14 - hgt));
        R(c, PAL.tall, bx, by, 1, hgt);
        P(c, PAL.tallL, bx, by);
      }
      for (let i = 0; i < 4; i++) {
        const bx = x + 1 + Math.floor(r() * 14);
        R(c, PAL.tallL, bx, y + 1 + Math.floor(r() * 3), 1, 6);
      }
      seam(c, x, y, SEAM.tall, SEAM_TONE.tall, 8, 4, 3);
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
    (c, x, y, v) => { const r = sr(v); dirtBase(c, x, y, r); for (let i = 0; i < 3; i++) R(c, PAL.dirtD, x + inX(r, 2), y + inY(r, 2), 2, 2); });

  /**
   * THE ROAD. Three faults, all fixed here.
   *  1. `H(pathD, y+0)` and `H(pathD, y+15)` painted a -25 Y line on the two
   *     rows that touch when tiles stack: a 2px dark band every 16 pixels, i.e.
   *     the "blocky road" the whole art pass exists to kill. Gone.
   *  2. It had no form. A worn track is lighter and smoother where feet fall
   *     and darker and coarser where it is compacted at the sides, so the tile
   *     now carries a soft `pathW` wear patch and `pathD` shoulders that are
   *     placed by the hash, not by the tile grid.
   *  3. The embedded stones were `stoneL`/`stoneD` — COOL GREY chips on a warm
   *     path, which read as blue-grey litter. They are `pebble` now.
   *  4. (2026-08) It out-valued plain DIRT by 9.6 L*, so a road crossing bare
   *     earth was a brown checkerboard. `path` dropped 2.6 L* and lost 10% of
   *     its chroma; everything the tile gave up in raw value came back as
   *     SURFACE, which is what actually distinguishes a road from the soil it
   *     is cut into: a broad COMPACTED PAN of smooth wear that straddles the
   *     tile border, a scatter of embedded GRIT sitting proud of it, and short
   *     CART SCUFFS — a rut fragment with a lit lip and a dark trough. None of
   *     it is aligned to the 16px grid: every mark is placed by the variant
   *     hash and allowed to be clipped by the tile box, so the surface carries
   *     across seams.
   */
  def('DIRT_PATH', 'Path', 0, { group: 'dirt', biomes: ['road', 'plains', 'city'], variants: 6 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.path, x, y, 16, 16);
    // THE COMPACTED PAN — two broad, soft, overlapping slabs of smoothed wear.
    // These used to be started off-tile so the pan "never had a visible 16px
    // boundary"; what that actually did was end the pan in a straight line
    // wherever the tile box sliced it, which is the boundary it was trying to
    // avoid. The pan is inboard now and `seam` carries the same tone onto the
    // ring, wrapped, so it does cross the border — for real this time.
    for (let i = 0; i < 2; i++) {
      const pw = 8 + Math.floor(r() * 7), ph = 6 + Math.floor(r() * 6);
      mark(c, PAL.pathW, x, y, inX(r, pw), inY(r, ph), pw, ph);
    }
    // worn, smoother patches — irregular, small, never aligned to the tile
    for (let i = 0; i < 5; i++) {
      const pw = 3 + Math.floor(r() * 4), ph = 2 + Math.floor(r() * 2);
      mark(c, i < 3 ? PAL.pathW : PAL.pathM, x, y, inX(r, pw), inY(r, ph), pw, ph);
    }
    speck(c, PAL.pathL, x, y, 7, r);
    // compacted grit: mostly a 2 L* step, a few 4 L* steps
    speck(c, PAL.pathM, x, y, 12, r);
    dashesI(c, PAL.pathD, x, y, 5, r, 2);
    speck(c, PAL.pathD, x, y, 6, r);
    // CART SCUFFS — a worn groove, not a drawn line. Most of the run is
    // `pathM` (a 3 L* step, barely a mark); only a short bite goes to `pathD`,
    // and a `pathW` lip catches the light on the upper-left side. Count,
    // ORIENTATION, length and position all come from the variant hash, so a
    // stretch of road never builds a corduroy of parallel dashes — which is
    // what a fixed pair of horizontal ruts did when this was first tried.
    const scuffs = 1 + (r() < 0.4 ? 1 : 0);
    for (let i = 0; i < scuffs; i++) {
      const horiz = r() < 0.6, len = 5 + Math.floor(r() * 7);
      // inboard: a rut that stops dead on a tile border is the tile border
      const u = 1 + Math.floor(r() * (15 - len)), w0 = 2 + Math.floor(r() * 12);
      const put = (col, du, dw, l) => {
        if (horiz) mark(c, col, x, y, u + du, w0 + dw, l, 1);
        else mark(c, col, x, y, w0 + dw, u + du, 1, l);
      };
      put(PAL.pathW, 1, -1, len - 2);
      put(PAL.pathM, 0, 0, len);
      put(PAL.pathD, 2 + Math.floor(r() * 4), 0, 2 + Math.floor(r() * 3));
    }
    // stones trodden into the surface, lit from the upper-left
    for (let i = 0; i < 4; i++) {
      const px = x + inX(r, 2), py = y + inY(r, 2);
      R(c, PAL.pebble, px, py, 2, 1); P(c, PAL.pathXD, px + 1, py + 1);
    }
    seam(c, x, y, SEAM.path, SEAM_TONE.path, 15, 3, 3);
  });

  /**
   * COBBLE. Was 63% non-base coverage across an 86 Y range — every single cobble
   * got a full-width `stoneH` cap, which is why a street read as a loud grey
   * checkerboard. Fixed by giving it a warm `cobble` family of its own (dungeon
   * stone is cool, a town street should relate to the dirt around it) and a
   * highlight on only a third of the stones.
   *
   * What was still wrong: the course phase and the stone jitter came from the
   * VARIANT rng and the pitch was 5px, which divides neither 16 nor anything
   * else useful. So every stone that met a tile border was sliced at a random
   * place and met a completely different lattice on the other side — the two
   * columns either side of a seam measured 1.5x the contrast of the paving
   * itself, and the courses visibly restarted every 16px.
   *
   * The lattice is 16-PERIODIC now: four courses of 3px stones, and four stones
   * per course whose widths and mortar joints sum to exactly 16 columns, so the
   * paving simply carries on into the next tile. The top course sits at y = -1
   * and is drawn again at y = 15, which puts the horizontal border INSIDE a
   * stone rather than on the loudest pair in the cycle (a mortar row abutting a
   * lit stone top measured 14.3 dL* against a 6.4 interior mean). Two courses
   * are offset so a STONE lies across the vertical border and two so a JOINT
   * does — the same mix an interior column sees. Each stone also gets a 1px
   * vertical jitter, which stops the mortar bands being ruler-straight and, at
   * the top course, leaves some of row 15 as joint and some as stone so the
   * border ring is made of the same stuff as the tile middle.
   *
   * Anything that crosses a seam — the whole top course, and the one stone per
   * course that straddles the vertical border — takes its tone, its highlight
   * and its jitter from `fr`, the family-fixed generator, so both tiles paint it
   * identically. The ten stones wholly inside the tile still vary per variant,
   * which is what keeps a street from being one stamp repeated.
   */
  const COBBLE_COURSE = [
    { y: -3, x: -1, w: [3, 4, 3, 2] },   // drawn again at y+16: straddles the horizontal seam
    { y: 3, x: 0, w: [4, 3, 2, 3] },     // a joint lies across the vertical seam
    { y: 7, x: -2, w: [3, 3, 4, 2] },    // a stone does
    { y: 11, x: 1, w: [2, 4, 3, 3] },    // a joint does
  ];
  /**
   * The paving itself, factored out so PATH_ISLE (a pothole of bare earth in a
   * city street) can lay down the SAME lattice from the SAME family-fixed
   * generator and slot into a run of cobbles with no seam of its own.
   */
  const cobbleBase = (c, x, y, r) => {
    const f = fr(SEAM.cobble);
    R(c, PAL.cobbleD, x, y, 16, 16);                 // the mortar bed
    for (let j = 0; j < 4; j++) {
      const co = COBBLE_COURSE[j];
      let sx = co.x;
      for (let k = 0; k < 4; k++) {
        const w = co.w[k];
        const wrapX = sx < 0 ? 16 : (sx + w > 16 ? -16 : 0);
        const g = (wrapX || j === 0) ? f : r;        // does this stone cross a seam?
        // The top course rides a 0-3px jitter rather than 0-1: that is what puts
        // mortar on SOME of row 15 and some of row 0 instead of a solid band of
        // stone tops on both, which is the only way the border ring can carry
        // the same 75% stone / 25% joint mix the rest of the tile does.
        const q = g(), lit = g() < 0.34, qj = g();
        const jit = j === 0 ? Math.floor(qj * 4) : (qj < 0.45 ? 1 : 0);
        const tone = q < 0.28 ? PAL.cobbleL : (q < 0.5 ? PAL.gravel : PAL.cobble);
        for (let a = 0; a < 2; a++) {
          if (a === 1 && wrapX === 0) break;
          const px = sx + (a ? wrapX : 0);
          for (let b = 0; b < 2; b++) {
            if (b === 1 && j !== 0) break;
            const py = co.y + jit + (b ? 16 : 0);
            mark(c, tone, x, y, px, py, w, 3);
            if (lit) mark(c, PAL.cobbleH, x, y, px, py, 2, 1);
            mark(c, PAL.cobbleD, x, y, px + w - 1, py + 2, 1, 1);
          }
        }
        sx += w + 1;
      }
    }
    // grit and damp in the joints — 1px only, so it has no shape to slice
    speck(c, PAL.pebble, x, y, 5, r);
    speck(c, PAL.cobbleD, x, y, 6, r);
  };
  def('COBBLE', 'Cobblestone', 0, { group: 'road', biomes: ['city', 'road', 'ruins'], variants: 4 },
    (c, x, y, v) => { cobbleBase(c, x, y, sr(v)); });

  def('FLAGSTONE', 'Flagstone', 0, { group: 'road', biomes: ['city', 'ruins', 'dungeon'], variants: 3 },
    (c, x, y, v) => { const r = sr(v); stoneSlabs(c, x, y, PAL.stone, PAL.stoneG, PAL.stoneL); speck(c, PAL.stoneM, x, y, 4, r); });

  // Was TV static: 22 pebbles, each with a `stoneH` pixel on a `stoneD` base —
  // an 86 Y internal range at busyness 13. Fewer, quieter, warmer pebbles.
  def('GRAVEL', 'Gravel', SLOW, { group: 'dirt', biomes: ['mountain', 'hills', 'mine', 'coast'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.scree, x, y, 16, 16);
    // one chip: a 2x1 stone, sometimes a lit crown, and the pixel of shade it
    // casts into the joint below-right
    const chip = (px, py, pale, crown) => {
      mark(c, pale ? PAL.screeL : PAL.screeM, x, y, px, py, 2, 1);
      if (crown) mark(c, PAL.pebble, x, y, px, py, 1, 1);
      mark(c, PAL.screeD, x, y, px + 1, py + 1, 1, 1);
    };
    for (let i = 0; i < 14; i++) chip(inX(r, 2), inY(r, 2), r() < 0.35, r() < 0.4);
    // The chips on the border are the SAME chips the neighbour draws: taken from
    // the family-fixed generator and painted twice, 16px apart, so each one is
    // half on either tile. Their coverage has to match the interior's or the
    // ring becomes a lattice in its own right — with a generic `seam` band here
    // the ring measured 4.35 L* brighter than the middle of the tile.
    const f = fr(SEAM.gravel);
    for (let i = 0; i < 6; i++) {
      const t = Math.floor(f() * 15), pale = f() < 0.2, crown = f() < 0.3;
      if (i & 1) { chip(15, t, pale, crown); chip(-1, t, pale, crown); }
      else { chip(t, 15, pale, crown); chip(t, -1, pale, crown); }
    }
  });

  def('SAND', 'Sand', 0, { group: 'sand', biomes: ['coast', 'ruins'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.sand, x, y, 16, 16);
    for (let i = 0; i < 4; i++) {
      const lw = 7 + Math.floor(r() * 6);
      mark(c, PAL.sandM, x, y, inX(r, lw), inY(r, 1), lw, 1);
    }
    for (let i = 0; i < 2; i++) { const lw = 6 + Math.floor(r() * 5); mark(c, PAL.sandD, x, y, inX(r, lw), inY(r, 1), lw, 1); }
    speck(c, PAL.sandL, x, y, 6, r);
    seam(c, x, y, SEAM.sand, SEAM_TONE.sand, 6, 2, 3);
  });

  def('MUD', 'Mud', SLOW, { group: 'dirt', biomes: ['marsh', 'road', 'plains'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.mud, x, y, 16, 16);
    for (let i = 0; i < 5; i++) mark(c, PAL.mudD, x, y, inX(r, 4), inY(r, 3), 4, 3);
    speck(c, PAL.mudL, x, y, 5, r);
    P(c, PAL.waterL, x + 4 + Math.floor(r() * 8), y + 4 + Math.floor(r() * 8));
    seam(c, x, y, SEAM.mud, SEAM_TONE.mud, 11, 3, 3);
  });

  // --- 4.4 farmland --------------------------------------------------------
  // `i*4` put a full-width `dirtL` line on row 0, so every tile boundary got a
  // bright hairline. Offset by 1 and the furrows never touch a tile edge.
  //
  // The furrow cycle is 4 rows, which divides 16 exactly, so the furrows do run
  // on across a horizontal seam — but the PHASE decided which of the four row
  // pairs the seam landed on, and it landed on the trough's dark shoulder, the
  // highest-contrast pair in the cycle (5.7 dL* against an interior mean of
  // 4.2). Swapping the two tones puts the seam on the crest's shoulder instead:
  // same furrows, and the border pair is now the QUIETEST pair in the cycle
  // rather than the loudest.
  def('FARMLAND', 'Furrows', 0, { group: 'dirt', biomes: ['plains'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.dirt, x, y, 16, 16);
    for (let i = 0; i < 4; i++) { H(c, PAL.dirtD, x, y + i * 4 + 1, 16); H(c, PAL.dirtM, x, y + i * 4 + 2, 16); }
    speck(c, PAL.dirtD, x, y, 6, r);
    speck(c, PAL.dirtL, x, y, 4, r);
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
  /**
   * OPEN WATER. Two faults, both of them 16px-grid faults.
   *
   *  1. the swell shadows started at column 0-5 and ran 5-9px, so the LEFT edge
   *     of every water tile carried a dark bar and the right edge never did.
   *     They are inboard now, and the swell that crosses a seam comes from
   *     `seam`, which draws it on both sides of the tile — one wave, not two
   *     halves that do not meet;
   *  2. two variants, with the crest line and both foam flecks at positions
   *     fixed in tile space, is a stamp. A lake was a visible chequer of the
   *     same two tiles. Four variants now, and the crest, its second run and
   *     the loose fleck are all placed from the variant hash.
   */
  //  3. (2026-08b) FOUR variants is not enough. The ring is family-fixed by
  //     design — it has to be, or the seam steps — so the only thing that can
  //     break the 16px rhythm is the interior, and four interiors repeat often
  //     enough that a lake read as a stamp at 1x. Eight now.
  //  4. …and the crest was still being CLIPPED by the tile box. `c1` ran to
  //     column 12 with a width of 4, so the brightest mark on the tile (waterL,
  //     +9 L*) could end dead on column 15 with nothing on the other side —
  //     which is the exact defect section 2a exists to kill, and it is what
  //     made the water's border contrast jump the moment the variant count
  //     rose. Both crest runs are inboard now, like every other mark wider
  //     than a pixel; the ring's own wave still comes from `seam`, wrapped.
  def('WATER', 'Water', WATER | SLOW, { group: 'water', biomes: ['coast', 'plains', 'marsh'], variants: 8, animFrames: 4, fps: 3 },
    (c, x, y, v, w, f) => {
      const r = sr(v);
      R(c, PAL.water, x, y, 16, 16);
      for (let i = 0; i < 6; i++) { const lw = 5 + Math.floor(r() * 5); mark(c, PAL.waterD, x, y, inX(r, lw), inY(r, 1), lw, 1); }
      seam(c, x, y, SEAM.water, SEAM_TONE.water, 10, 3, 3);
      // the crest line drifts down the tile and wraps; where it starts, how long
      // it is and where its echo sits are all per-variant
      const cl = 4 + Math.floor(r() * 4), c0 = inX(r, cl + 1);
      const c1 = inX(r, 5), phase = Math.floor(r() * 16);
      const gx = 1 + Math.floor(r() * 13), gy = 1 + Math.floor(r() * 13);
      // …and it drifts through rows 1-13 rather than 0-15, for the same reason:
      // the crest is the brightest mark on the tile, and on row 0 or row 15 it
      // was a 4-7px bar of +9 L* ending dead at a seam with nothing on the
      // other side of it.
      const cy = y + 1 + ((f * 4 + phase) % 13);
      mark(c, PAL.waterL, x, y, c0, cy - y, cl, 1);
      mark(c, PAL.waterL, x, y, c1, cy - y + 1, 4, 1);
      mark(c, PAL.foam, x, y, c0 + 1, cy - y, 3, 1);
      P(c, PAL.foam, x + ((f * 5 + gx) % 15), y + ((f * 7 + gy) % 15));
    });

  def('WATER_DEEP', 'Deep Water', WATER | SOLID, { group: 'water', biomes: ['coast'], variants: 2, animFrames: 4, fps: 2 },
    (c, x, y, v, w, f) => {
      const r = sr(v);
      R(c, PAL.deep, x, y, 16, 16);
      for (let i = 0; i < 6; i++) H(c, PAL.deepD, x + Math.floor(r() * 8), y + Math.floor(r() * 15), 4 + Math.floor(r() * 6));
      const cy = y + ((f * 4 + 6) % 16);
      H(c, PAL.deepL, x + 3, cy, 7); P(c, PAL.waterL, x + 4, cy);
    });

  /**
   * ============================ THE WATERLINE ============================
   *
   * Eight shore cases. READ THIS BEFORE WIRING THEM UP.
   *
   * WHAT THE SUFFIX MEANS. A shore tile IS A WATER TILE. `autotileEdges(map, x,
   * y, T.WATER)` sets a bit for each side whose neighbour is NOT water, and the
   * suffix names those sides — so SHORE_N is water with LAND TO THE NORTH, and
   * the bank belongs on the tile's TOP edge with open water below it. The old
   * draw had this exactly backwards (it painted the water strip on the named
   * side and filled the rest with sand), which is one reason nothing ever
   * placed one: SHORE_* has 0 uses in map data and 0 at draw time.
   *
   * WHY THE PREVIOUS ATTEMPT WAS BACKED OUT, CORRECTLY. The tile used to be a
   * whole 16x16 of `sand` (L* 79.9) with a 2-8px strip of water cut into it. No
   * map in this game puts water next to sand: Neverwinter's waterline meets a
   * cobble quay at L* 48.2 and the Neverwinter Wood river runs through grass at
   * L* 47.3. Wiring it up therefore laid a bright yellow rectangle over both,
   * taking the mean |dL*| across the waterline from 5.42 to 34.15 in
   * Neverwinter and 7.92 to 27.76 in the Wood; and because the sand covered
   * 10 of the tile's 16 pixels, the Wood's 1-2 tile wide river broke into
   * disconnected blue pools sitting inside yellow squares.
   *
   * WHAT IT IS NOW. The tile is WATER, all the way across, and only a 2-6px
   * margin along each named side is bank. That margin is a WET one — `silt`
   * (41.6), `siltM` (34.2), `siltD` (30.4) — sitting a few L* BELOW whatever
   * ground it meets and inside the water's own value range, so a river through
   * grass gets a dark damp bank instead of a beach, and a river that is one
   * tile wide still has 10-12 pixels of water down the middle of it.
   *
   * WHY THE LINE DOES NOT STEP AT A TILE BORDER. The margin's depth is
   *     base + A1 sin(pi i/15) + A2 sin(2 pi i/15) + jag[i]
   * Both sines are zero at i = 0 and i = 15, so the only thing that decides the
   * depth at the two pixels a neighbour can see is `jag`, which comes from the
   * FAMILY-fixed generator, plus a 0/1 lift taken from the SHARED-EDGE VARIANT
   * (see `edgeVariantAt`): tile A's right-hand end and tile B's left-hand end
   * hash the SAME border coordinate, so they compute the same depth without
   * either tile ever looking at the other. The line is continuous across every
   * seam and still moves from seam to seam.
   *
   * Every r() call happens before anything reads `f`, so the coastline is
   * identical in all four wave frames and cannot shimmer.
   *
   * The variant is the four edge codes, so `v` is NOT a free parameter here —
   * `sr(v)` still gives a stable per-tile speckle, it just happens to be shared
   * by tiles whose four borders hash alike.
   */
  /**
   * ONE PROFILE PER SHARED-EDGE VARIANT, not one per family.
   *
   * The first version of this built a SINGLE 16-entry jag and gave the two sine
   * terms an amplitude of 1, whose `Math.round` is zero everywhere except the
   * middle third. The result measured exactly what that predicts: the quay's
   * edge depth autocorrelated 0.49 at lag 16 and 0.48 at lag 32, per-tile depth
   * SD was 0.00 at pixels 1 and 14 across all 36 shore tiles, and because the
   * foam index was `(i * 16 + d)` with d identical, even the foam pixels were
   * the same 36 times. One scallop, stamped.
   *
   * There are sixteen of everything now, indexed by the tile's shared-edge
   * variant — the one piece of per-position information a tile cached by
   * (id, variant, frame) is allowed to have. Continuity is untouched because
   * every term still VANISHES at i = 0 and i = 15:
   *
   *   * each jag profile is zero at both ends by construction;
   *   * the wander is a sine SERIES, sin(k*pi*i/15) for k = 1, 2, 3, which is
   *     zero at both ends for every integer k — so a per-variant amplitude on
   *     each harmonic buys three independent degrees of shape freedom without
   *     moving the two pixels the neighbour can see. Rounding the SUM rather
   *     than each term is what lets an amplitude below 1 still change the line;
   *   * the foam and grit indices carry the variant in the middle of the run,
   *     but at i = 0 and i = 15 they are drawn from the SHARED border bit, which
   *     both neighbours hash identically.
   */
  const BANK_JAG = [], BANK_AMP = [];
  for (let vi = 0; vi < 16; vi++) {
    const f = fr(SEAM.bank + vi * 37);
    const row = new Int8Array(16);
    // ends stay 0: they belong to the shared edge, not to this tile's variant
    for (let i = 1; i < 15; i++) row[i] = f() < 0.34 ? 1 : 0;
    BANK_JAG.push(row);
    BANK_AMP.push([(f() * 2 - 1), (f() * 2 - 1) * 0.7, (f() * 2 - 1) * 0.5]);
  }
  const BANK_RIP = []; { const f = fr(SEAM.bank + 1); for (let i = 0; i < 256; i++) BANK_RIP.push(f() < 0.24); }

  /**
   * One bank margin along one side.
   *   vi     the tile's 4-bit shared-edge variant (see edgeVariantAt)
   *   horiz  true for the N/S sides (the margin runs left-to-right)
   *   far    true for the S/E sides (the margin hugs row/col 15)
   *   tone   [outer damp, wet, lip, shallow, grit] — silt for a natural bank,
   *          the quay tones for a built one
   *   base   how deep the margin is at its shallowest
   *   amp    how far it is allowed to wander
   */
  function bank(c, x, y, vi, horiz, far, tone, base, amp) {
    // The two ends: one bit each from the borders this side actually touches.
    const e0 = (vi >> (horiz ? 0 : 2)) & 1, e1 = (vi >> (horiz ? 1 : 3)) & 1;
    // …and everything between them from this tile's own variant.
    const jag = BANK_JAG[vi], am = BANK_AMP[vi];
    const a1 = am[0] * amp, a2 = am[1] * amp, a3 = am[2] * amp;
    for (let i = 0; i < 16; i++) {
      const end = i === 0 ? e0 : (i === 15 ? e1 : 0);
      let d = base + end + jag[i]
        + Math.round(a1 * Math.sin(Math.PI * i / 15)
          + a2 * Math.sin(2 * Math.PI * i / 15)
          + a3 * Math.sin(3 * Math.PI * i / 15));
      if (d < 2) d = 2; if (d > 7) d = 7;
      for (let k = 0; k < d + 2; k++) {
        // k counts INWARD from the land: damp, wet, the dark lip at the
        // waterline, then two rows of silty shallow before open water
        const col = k < d - 2 ? tone[0] : (k === d - 2 ? tone[1] : (k === d - 1 ? tone[2] : tone[3]));
        const px = horiz ? i : (far ? 15 - k : k), py = horiz ? (far ? 15 - k : k) : i;
        mark(c, col, x, y, px, py, 1, 1);
      }
      // A foam fleck where the water laps, and grit in the damp. Both indices
      // carry the variant so 36 shore tiles are not 36 identical sets of
      // flecks — except on the two end columns, which the neighbour also
      // paints and which therefore key off the shared border bit instead.
      const es = i === 0 ? e0 : e1;
      const fs = (i === 0 || i === 15) ? es * 83 + 41 : vi * 53 + i * 16;
      const gs = (i === 0 || i === 15) ? es * 61 + 19 : vi * 29 + i * 7;
      if (BANK_RIP[(fs + d) & 255]) {
        const fx = horiz ? i : (far ? 15 - d : d), fy = horiz ? (far ? 15 - d : d) : i;
        mark(c, PAL.foam, x, y, fx, fy, 1, 1);
      }
      if (BANK_RIP[(gs + 3) & 255] && d > 2) {
        const gx = horiz ? i : (far ? 15 : 0), gy = horiz ? (far ? 15 : 0) : i;
        mark(c, tone[4], x, y, gx, gy, 1, 1);
      }
    }
  }

  const SILT_BANK = [PAL.silt, PAL.siltM, PAL.siltD, PAL.shallowD, PAL.siltM];
  const QUAY_BANK = [PAL.quay, PAL.quayD, PAL.deepD, PAL.shallowD, PAL.quayL];

  const shoreFamily = (prefix, label, tone, base, amp) => {
    const one = (key, sides) => def(key, label, WATER | SLOW,
      { group: 'water', biomes: ['coast', 'plains'], variants: 16, edgeVariant: true, animFrames: 4, fps: 3 },
      (c, x, y, v, vi, f) => {
        // Seeded from the VARIANT, not from the tile id: a water tile that needs
        // banks on three sides is drawn as two members clipped to two halves of
        // the tile, and if SHORE_N and SHORE_S speckled their open water
        // differently the clip line would itself be a seam. Every member of every
        // shore family paints the same water for the same edge variant.
        const r = fr(0x51 + vi);
        R(c, PAL.water, x, y, 16, 16);
        for (let i = 0; i < 5; i++) { const lw = 4 + Math.floor(r() * 5); mark(c, PAL.waterD, x, y, inX(r, lw), inY(r, 1), lw, 1); }
        // The drifting crest goes on BEFORE the banks, so a wave never rides up
        // over the silt on a tile whose margin runs deep. Its geometry used to
        // be four literals — the same two dashes at the same two tile
        // coordinates on all 36 shore tiles, which is a stamp however the
        // frames animate it. Everything but the frame offset now comes from the
        // variant, and every r() call still happens before `f` is read, so the
        // waterline cannot shimmer between wave frames.
        const cy0 = 3 + Math.floor(r() * 6), cw = 4 + Math.floor(r() * 3);
        const cx0 = 2 + Math.floor(r() * 7), cx1 = 1 + Math.floor(r() * 8), cgap = 2 + Math.floor(r() * 3);
        const cy = cy0 + ((f * 3) % 7);
        mark(c, PAL.waterL, x, y, cx0, cy, cw, 1);
        mark(c, PAL.waterL, x, y, cx1, cy + cgap, cw - 1, 1);
        if (sides.includes('N')) bank(c, x, y, vi, true, false, tone, base, amp);
        if (sides.includes('S')) bank(c, x, y, vi, true, true, tone, base, amp);
        if (sides.includes('W')) bank(c, x, y, vi, false, false, tone, base, amp);
        if (sides.includes('E')) bank(c, x, y, vi, false, true, tone, base, amp);
      });
    one(`${prefix}_N`, ['N']); one(`${prefix}_E`, ['E']); one(`${prefix}_S`, ['S']); one(`${prefix}_W`, ['W']);
    one(`${prefix}_NE`, ['N', 'E']); one(`${prefix}_SE`, ['S', 'E']);
    one(`${prefix}_SW`, ['S', 'W']); one(`${prefix}_NW`, ['N', 'W']);
  };
  // SHORE_* — the natural bank. Silt and soaked earth: use it wherever the
  // water meets grass, dirt, mud, sand, gravel or farmland.
  shoreFamily('SHORE', 'Shore', SILT_BANK, 4, 2);

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

  /**
   * ICE. Three variants, and both glints written as literal tile coordinates —
   * `H(iceL, x+2, y+3, 6)` and `H(iceL, x+8, y+10, 5)` — which is a stamp by
   * construction: every third tile of a frozen lake was pixel-identical and the
   * two bright dashes recurred on the same rows forever (per-column mean L*
   * autocorrelated 0.38 at lag 16, and by eye it was worse than that number).
   * Six variants now, and the cracks, the glints and the frost are all placed
   * by the hash; the cracks are kept inboard so one never ends dead on a tile
   * border, and `seam` supplies the ring's own frost, wrapped, so the border
   * carries ice rather than a clean line.
   */
  def('ICE', 'Ice', SLOW, { group: 'ice', biomes: ['tundra', 'mountain'], variants: 6 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.ice, x, y, 16, 16);
    for (let i = 0; i < 3; i++) {
      let cx = 1 + Math.floor(r() * 13), cy = 1 + Math.floor(r() * 7);
      const len = 4 + Math.floor(r() * 6);
      for (let s = 0; s < len; s++) { mark(c, PAL.iceD, x, y, cx, cy, 1, 1); cx += r() < 0.5 ? 1 : 0; cy += 1; if (cy > 14) break; }
    }
    for (let i = 0; i < 3; i++) { const lw = 4 + Math.floor(r() * 4); mark(c, PAL.iceL, x, y, inX(r, lw), inY(r, 1), lw, 1); }
    speck(c, PAL.iceL, x, y, 5, r);
    speck(c, PAL.iceD, x, y, 3, r);
    // No `seam` here, deliberately. Ice's border ring already measured QUIETER
    // than its interior (grid-visibility 0.24), so the ring needs nothing — and
    // a family-fixed ring is by construction identical on every tile, which on a
    // surface this flat is itself a 16px rhythm: adding one took the per-column
    // autocorrelation at lag 16 from 0.38 to 0.80. Variants and hashed placement
    // are the whole fix here.
  });

  def('SNOW', 'Snow', SLOW, { group: 'snow', biomes: ['tundra', 'mountain'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.snow, x, y, 16, 16);
    speck(c, PAL.snowD, x, y, 10, r);
    for (let i = 0; i < 3; i++) mark(c, PAL.snowS, x, y, inX(r, 5), inY(r, 1), 5, 1);
    seam(c, x, y, SEAM.snow, SEAM_TONE.snow, 5, 4, 3);
  });

  /**
   * SNOWY GRASS. Every blade used to be drawn as `16 - (by - y)` tall — i.e.
   * from wherever it started down to the tile's LAST ROW and no further. So the
   * bottom row of every tile was a picket of dark grass and the top row of the
   * tile below was clean snow: a 15.9 mean |dL*| line, by a distance the worst
   * horizontal seam in the tileset (interior 7.2, ratio 2.20). The blades are
   * inboard now, and `seam` grows a family-fixed set that really does cross the
   * border, half on each tile.
   */
  def('SNOW_GRASS', 'Snowy Grass', 0, { group: 'snow', biomes: ['tundra', 'pine-forest'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.snow, x, y, 16, 16);
    speck(c, PAL.snowD, x, y, 6, r);
    for (let i = 0; i < 8; i++) {
      const bh = 2 + Math.floor(r() * 4);
      const bx = x + 1 + Math.floor(r() * 14), by = y + 1 + Math.floor(r() * (14 - bh));
      R(c, PAL.grassD, bx, by, 1, bh); P(c, PAL.grass, bx, by);
    }
    // the tufts that cross the seam: one 1px column, family-fixed, drawn on
    // both sides of the tile so the blade continues onto the neighbour
    const f = fr(SEAM.snowGrass);
    for (let i = 0; i < 5; i++) {
      const t = 1 + Math.floor(f() * 13), bh = 2 + Math.floor(f() * 3), k = 1 + Math.floor(f() * (bh - 1));
      if (i & 1) { mark(c, PAL.grassD, x, y, 16 - k, t, bh, 1); mark(c, PAL.grassD, x, y, -k, t, bh, 1); }
      else { mark(c, PAL.grassD, x, y, t, 16 - k, 1, bh); mark(c, PAL.grassD, x, y, t, -k, 1, bh); }
    }
    seam(c, x, y, SEAM.snow, SEAM_TONE.snow, 4, 3, 3);
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
    const pad = [[0, 3, 5], [1, 1, 9], [2, 0, 11], [3, 0, 11], [4, 1, 9], [5, 3, 5]];
    foot(c, x + ox, y + oy, 0, 11, 5, 0.8);          // the pad darkens the water it floats on
    outline(c, PAL.leafXD, x + ox, y + oy, pad);
    blob(c, PAL.leaf, x + ox, y + oy, pad);
    blob(c, PAL.leafD, x + ox, y + oy, [[3, 5, 6], [4, 5, 5], [5, 5, 3]]);
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
    (c, x, y, v) => { const r = sr(v); stoneSlabs(c, x, y, PAL.stone, PAL.stoneG, PAL.stoneL); speck(c, PAL.stoneM, x, y, 3, r); });

  def('STONE_FLOOR_CRACKED', 'Cracked Floor', 0, { group: 'floor', biomes: ['dungeon', 'ruins', 'crypt'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v); stoneSlabs(c, x, y, PAL.stone, PAL.stoneG, PAL.stoneL);
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

  // Course rows offset by 1 so neither the dark mortar nor the lit brick-top
  // lands on a tile border (they used to abut across every seam). The HEAD
  // joints had the same fault in the other axis: `off + i*8` put a dark vertical
  // joint on column 0 of every other course and none on column 15, so the
  // vertical seam was dark|light where an interior joint is light|dark|light.
  // `+2` walks them to columns 2/10 and 6/14, clear of the border.
  def('DUNGEON_FLOOR', 'Dungeon Brick', 0, { group: 'floor', biomes: ['dungeon', 'crypt', 'underdark'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.dgn, x, y, 16, 16);
      // The course cycle is 4 rows — base, lit brick top, base, dark bed — so
      // whichever phase the tile border lands on is the phase it lands on
      // everywhere. It used to land on (dark bed | base), the loudest pair in
      // the cycle. Starting the run at row -1 puts the LIT top on row 15 and
      // base on row 0, the quietest pair, and `mark` clips the two courses that
      // now hang off the ends.
      for (let row = -1; row < 4; row++) {
        const oy = row * 4 + 3, off = (row % 2) ? 4 : 0;
        mark(c, PAL.dgnD, x, y, 0, oy + 2, 16, 1);
        for (let i = -1; i < 3; i++) mark(c, PAL.dgnD, x, y, off + i * 8 + 7, oy, 1, 2);
        mark(c, PAL.dgnM, x, y, 0, oy, 16, 1);
      }
      speck(c, PAL.dgnL, x, y, 5, r);
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
  //
  // LIGHT DIRECTION. Nothing in the tileset had one: `leftMinusRight` measured
  // within ±1 Y for every wall, every roof and both rock props, and CLIFF was
  // lit backwards. Every wall family below now commits to light from the UPPER
  // LEFT — lit top cap, lit left column, shaded right column — and finishes
  // with a 2px `*XD` occlusion band on rows 14-15 so the wall visibly SITS ON
  // the floor instead of being printed on it.

  /** Shared wall finish: upper-left light, lower-right shade, base occlusion. */
  const wallShade = (c, x, y, light, dark, occl, capTop = 0) => {
    V(c, light, x, y + capTop, 16 - capTop - 2);
    V(c, dark, x + 15, y + capTop, 16 - capTop - 2);
    R(c, occl, x, y + 14, 16, 2);
  };

  def('STONE_WALL', 'Stone Wall', SOLID, { layer: 'deco', group: 'wall', biomes: ['city', 'ruins', 'dungeon'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      // top cap (the bit you see from above) then the face below it
      R(c, PAL.stoneL, x, y, 16, 4); H(c, PAL.stoneH, x, y, 16); H(c, PAL.stoneD, x, y + 4, 16);
      // The FACE is a step off STONE_FLOOR so a wall never sits at exactly the
      // same value as the floor in front of it; the lit cap on top and the 3px
      // occlusion band at the foot supply the height.
      R(c, PAL.stoneM, x, y + 5, 16, 11);
      for (let row = 0; row < 3; row++) {
        const oy = y + 5 + row * 4, off = (row % 2) ? 3 : 0;
        H(c, PAL.stoneD, x, oy + 3, 16);
        for (let i = -1; i < 4; i++) { const bx = x + off + i * 6; if (bx > x && bx < x + 16) V(c, PAL.stoneD, bx, oy, 3); }
        H(c, row === 0 ? PAL.stoneL : PAL.stone, x, oy, 16);
      }
      speck(c, PAL.stoneD, x, y + 5, 4, r, 16, 9);
      wallShade(c, x, y, PAL.stoneL, PAL.stoneD, PAL.stoneXD, 4);
      R(c, PAL.stoneXD, x, y + 13, 16, 3);
      P(c, PAL.stoneH, x, y);
    });

  def('STONE_WALL_TOP', 'Wall Top', SOLID, { layer: 'deco', group: 'wall', biomes: ['city', 'ruins'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.stoneL, x, y, 16, 16);
      for (let row = 0; row < 4; row++) { H(c, PAL.stoneD, x, y + row * 4 + 3, 16); V(c, PAL.stoneD, x + ((row % 2) ? 5 : 11), y + row * 4, 3); }
      speck(c, PAL.stoneH, x, y, 6, r);
      H(c, PAL.stoneH, x, y, 16); V(c, PAL.stoneH, x, y, 16);
      V(c, PAL.stoneD, x + 15, y, 16); H(c, PAL.stoneD, x, y + 15, 16);
    });

  def('BRICK_WALL', 'Brick Wall', SOLID, { layer: 'deco', group: 'wall', biomes: ['city', 'dungeon'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.brick, x, y, 16, 16);
      for (let row = 0; row < 5; row++) {
        const oy = y + row * 3, off = (row % 2) ? 4 : 0;
        H(c, PAL.brickD, x, oy + 2, 16);
        for (let i = -1; i < 3; i++) { const bx = x + off + i * 8; if (bx > x && bx < x + 16) V(c, PAL.brickD, bx, oy, 2); }
        if (oy < y + 14) H(c, PAL.brickL, x, oy, 16);
      }
      speck(c, PAL.brickD, x, y + 2, 5, r, 16, 12);
      R(c, PAL.brickL, x, y, 16, 2); H(c, '#c07e63', x, y, 16);       // lit cap
      wallShade(c, x, y, PAL.brickL, PAL.brickD, '#42221a', 2);
    });

  // Phandalin's houses: fieldstone footing, lime plaster, dark timber framing.
  def('WATTLE_WALL', 'Timber Wall', SOLID, { layer: 'deco', group: 'wall', biomes: ['city'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.plaster, x, y, 16, 16);
      speck(c, PAL.plasterD, x, y, 8, r);
      H(c, PAL.plasterXD, x, y + 12, 16);      // the plaster grimes where it meets the sill
      R(c, PAL.woodD, x, y, 16, 2);            // head beam
      R(c, PAL.woodD, x, y + 13, 16, 3);       // sill
      R(c, PAL.woodD, x, y, 2, 16); R(c, PAL.woodD, x + 14, y, 2, 16);  // posts
      // diagonal brace
      for (let i = 0; i < 11; i++) { P(c, PAL.wood, x + 2 + i, y + 12 - i); P(c, PAL.woodD, x + 3 + i, y + 12 - i); }
      H(c, PAL.woodL, x, y, 16); V(c, PAL.woodL, x, y, 16);
      V(c, PAL.barkD, x + 15, y, 16);
      R(c, PAL.barkXD, x, y + 15, 16, 1);
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
      H(c, PAL.woodH, x, y, 16);
      V(c, PAL.woodL, x, y, 14); V(c, PAL.woodD, x + 15, y, 14);
      R(c, PAL.barkXD, x, y + 14, 16, 2);
    });

  // Was a byte-for-byte clone of DUNGEON_FLOOR plus three moss pixels — ΔE 1.0
  // between a floor you walk on and a wall you cannot. Own darker base, a lit
  // 2px top cap, a lit left edge, a shaded right edge and a base occlusion band.
  def('DUNGEON_WALL', 'Dungeon Wall', SOLID, { layer: 'deco', group: 'wall', biomes: ['dungeon', 'crypt', 'underdark'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.dgnW, x, y, 16, 16);
      for (let row = 0; row < 4; row++) {
        const oy = y + row * 4 + 2, off = (row % 2) ? 4 : 0;
        if (oy + 2 < y + 14) H(c, PAL.dgnWD, x, oy + 2, 16);
        for (let i = -1; i < 3; i++) { const bx = x + off + i * 8; if (bx > x && bx < x + 16 && oy + 2 < y + 14) V(c, PAL.dgnWD, bx, oy, 2); }
        if (oy < y + 14) H(c, PAL.dgn, x, oy, 16);
      }
      for (let i = 0; i < 3; i++) P(c, PAL.moss, x + Math.floor(r() * 16), y + 2 + Math.floor(r() * 12));
      R(c, PAL.dgnL, x, y, 16, 2); H(c, PAL.dgnH, x, y, 16);          // lit cap
      V(c, PAL.dgnL, x, y + 2, 12);                                    // lit left face
      V(c, PAL.dgnWD, x + 15, y + 2, 12);                              // shaded right face
      R(c, '#1b1a20', x, y + 14, 16, 2);                               // sits on the floor
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

  // The old `contact()` here was painted over immediately by the base plinth, so
  // it never rendered. A pillar fills the tile top to bottom, so it gets a
  // keyline and an occlusion row instead of a cast shadow.
  def('PILLAR', 'Pillar', SOLID, { layer: 'deco', group: 'wall', biomes: ['dungeon', 'ruins', 'city', 'crypt'], variants: 1 },
    (c, x, y) => {
      outlineBox(c, PAL.stoneXD, x, y, 2, 0, 12, 16);
      R(c, PAL.stoneL, x + 2, y, 12, 3); H(c, PAL.stoneH, x + 2, y, 12); H(c, PAL.stoneD, x + 2, y + 3, 12);
      R(c, PAL.stone, x + 4, y + 3, 8, 10);
      V(c, PAL.stoneL, x + 4, y + 3, 10); V(c, PAL.stoneH, x + 5, y + 3, 10);
      V(c, PAL.stoneD, x + 9, y + 3, 10); V(c, PAL.stoneXD, x + 11, y + 3, 10);
      R(c, PAL.stoneL, x + 2, y + 12, 12, 3); H(c, PAL.stoneH, x + 2, y + 12, 12);
      R(c, PAL.stoneXD, x + 1, y + 15, 14, 1);
    });

  def('TIMBER_SUPPORT', 'Mine Support', SOLID, { layer: 'deco', group: 'wall', biomes: ['mine', 'cave'], variants: 1 },
    (c, x, y) => {
      R(c, PAL.wood, x, y, 16, 3); H(c, PAL.woodL, x, y, 16); H(c, PAL.woodD, x, y + 2, 16);
      R(c, PAL.wood, x, y + 3, 3, 13); V(c, PAL.woodL, x, y + 3, 13); V(c, PAL.woodD, x + 2, y + 3, 13);
      R(c, PAL.wood, x + 13, y + 3, 3, 13); V(c, PAL.woodL, x + 13, y + 3, 13); V(c, PAL.woodD, x + 15, y + 3, 13);
      P(c, PAL.ink, x + 1, y + 6); P(c, PAL.ink, x + 14, y + 9);
    });

  /**
   * CAVE WALL. It used to be the same 3x2-blob noise as CAVE_FLOOR painted on
   * `caveD` instead of `cave` — ΔE 5.0 from the floor, which is at the just-
   * noticeable difference for two large adjacent patches. In a cave you
   * genuinely could not tell floor from wall. The wall now has its own family
   * (`caveWD` base, a full step below the floor's darkest speckle), a lit
   * upper-left, a shaded lower-right, and a 2px occlusion band along the south
   * face so it reads as an extruded mass rather than a texture swap.
   * `lit` names the sides that face open floor.
   */
  const caveWall = (key, label, lit) => def(key, label, SOLID, { layer: 'deco', group: 'cave-wall', biomes: ['cave', 'mine', 'underdark'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.caveWD, x, y, 16, 16);
      for (let i = 0; i < 9; i++) {
        const px = x + Math.floor(r() * 12), py = y + Math.floor(r() * 12), w = 3 + Math.floor(r() * 3), h = 2 + Math.floor(r() * 3);
        R(c, PAL.caveW, px, py, w, h); H(c, PAL.caveWL, px, py, w);
      }
      speck(c, PAL.caveM, x, y, 4, r);
      // Height cues go on the `lit` cases only. A CAVE_WALL with no lit side is
      // the INTERIOR of a rock mass — ringing it would just put the 16px grid
      // back, which is the thing this pass exists to remove.
      if (lit.includes('N')) { H(c, PAL.caveH, x, y, 16); H(c, PAL.caveL, x, y + 1, 16); }
      if (lit.includes('S')) { H(c, PAL.caveW, x, y + 13, 16); R(c, '#1d1913', x, y + 14, 16, 2); }
      if (lit.includes('W')) { V(c, PAL.caveL, x, y, 16); V(c, PAL.caveW, x + 1, y, 16); }
      if (lit.includes('E')) { V(c, PAL.caveWD, x + 14, y, 16); V(c, '#1d1913', x + 15, y, 16); }
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
  // The profile used to be INVERTED — dark at the top, light at the bottom
  // (topMinusBot -30) — so a cliff read as a hole rather than as a mass. Lit
  // crown, strata that darken downward, occlusion at the foot.
  const cliff = (key, label, lit) => def(key, label, SOLID, { layer: 'deco', group: 'cliff', biomes: ['mountain', 'hills', 'coast'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.stone, x, y, 16, 16);
      for (let i = 0; i < 16; i += 1) {
        const h0 = 3 + Math.floor(r() * 3);
        R(c, PAL.stoneM, x + i, y + h0, 1, 16 - h0);
      }
      for (let i = 0; i < 5; i++) { const ly = y + 5 + Math.floor(r() * 10); H(c, PAL.stoneD, x + Math.floor(r() * 6), ly, 6 + Math.floor(r() * 5)); }
      for (let i = 0; i < 4; i++) { const ly = y + 4 + Math.floor(r() * 8); H(c, PAL.stoneL, x + Math.floor(r() * 8), ly, 4); }
      R(c, PAL.stoneD, x, y + 12, 16, 2);              // the face falls into shadow
      R(c, PAL.stoneXD, x, y + 14, 16, 2);             // and meets the ground
      R(c, PAL.stoneL, x, y, 16, 2); H(c, PAL.stoneH, x, y, 16);   // lit crown
      V(c, PAL.stoneL, x, y + 2, 12); V(c, PAL.stoneD, x + 15, y + 2, 12);
      if (lit.includes('N')) { H(c, PAL.stoneH, x, y, 16); H(c, PAL.stoneL, x, y + 1, 16); H(c, PAL.stoneM, x, y + 2, 16); }
      if (lit.includes('S')) { H(c, PAL.stoneD, x, y + 13, 16); R(c, '#26241f', x, y + 14, 16, 2); }
      if (lit.includes('W')) { V(c, PAL.stoneH, x, y, 16); V(c, PAL.stoneL, x + 1, y, 14); }
      if (lit.includes('E')) { V(c, PAL.stoneD, x + 14, y, 16); V(c, '#26241f', x + 15, y, 16); }
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
  //
  // A roof is the largest flat area on any building in Phandalin, and THATCH_M
  // measured topMinusBot = -2.1: a perfectly uniform gold slab with no pitch,
  // no light direction and no overhang. Every roof family now ramps from a lit
  // ridge to a dark eave and ends in a 2px `*XD` overhang shadow, which is the
  // single cue that turns a flat sticker into a thing standing on the ground.

  /**
   * One course of thatch: a ridge-to-eave value ramp, straw strokes that follow
   * the pitch, and a hard 2px `thatchXD` overhang at the bottom. Stacked, the
   * ramp reads as successive courses of straw; alone, it reads as a pitched
   * surface. Either way it is no longer the uniform gold slab that measured
   * topMinusBot = -2.1.
   */
  const thatchRow = (c, x, y, r, x0, w) => {
    R(c, PAL.thatchL, x + x0, y, w, 2);
    R(c, PAL.thatch, x + x0, y + 2, w, 5);
    R(c, PAL.thatchM, x + x0, y + 7, w, 4);
    R(c, PAL.thatchD, x + x0, y + 11, w, 3);
    R(c, PAL.thatchXD, x + x0, y + 14, w, 2);      // the eave overhangs and casts
    // straw strokes, always running down the pitch, darker the lower they start
    for (let i = 0; i < 12; i++) {
      const px = x + x0 + Math.floor(r() * Math.max(1, w));
      const py = Math.floor(r() * 13);
      V(c, py < 5 ? PAL.thatch : (py < 9 ? PAL.thatchM : PAL.thatchD), px, y + py, 2 + Math.floor(r() * 2));
    }
    for (let i = 0; i < 5; i++) { const px = x + x0 + Math.floor(r() * Math.max(1, w)); V(c, PAL.thatchL, px, y + Math.floor(r() * 8), 2); }
    H(c, PAL.thatchXD, x + x0, y + 13, w);          // the shadow line the eave throws
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
    for (let i = 0; i < 16; i++) P(c, PAL.thatchXD, x + 13, y + i);
    V(c, PAL.ink, x + 14, y, 16);
  });
  // The capping bundle along the ridge line: a dark roll of straw with a lit
  // crown, then the pitch falling away below it.
  def('THATCH_RIDGE', 'Roof Ridge', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v); thatchRow(c, x, y, r, 0, 16);
    R(c, PAL.thatchD, x, y + 1, 16, 4);
    H(c, PAL.thatchL, x, y + 1, 16); H(c, PAL.thatch, x, y + 2, 16);
    H(c, PAL.ink, x, y, 16);
    for (let i = 0; i < 7; i++) V(c, PAL.thatchXD, x + Math.floor(r() * 16), y + 3, 2);
    H(c, PAL.thatchXD, x, y + 5, 16);              // the ridge roll casts down the pitch
  });

  def('SHINGLE_ROOF', 'Shingle Roof', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.shingle, x, y, 16, 16);
    for (let row = 0; row < 4; row++) {
      const oy = y + row * 4, off = (row % 2) ? 2 : 0;
      H(c, PAL.shingleD, x, oy + 3, 16);
      H(c, row < 2 ? PAL.shingleL : PAL.shingle, x, oy, 16);
      for (let i = -1; i < 4; i++) { const bx = x + off + i * 4; if (bx > x && bx < x + 16) V(c, PAL.shingleD, bx, oy, 4); }
    }
    speck(c, PAL.shingleD, x, y, 5, r);
    H(c, '#b1735e', x, y, 16);                       // lit ridge course
    R(c, PAL.shingleXD, x, y + 14, 16, 2);           // eave overhang
  });

  def('TILE_ROOF', 'Tile Roof', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 2 }, (c, x, y) => {
    R(c, PAL.tileRoofD, x, y, 16, 16);
    for (let i = 0; i < 4; i++) {
      const px = x + i * 4;
      R(c, PAL.tileRoof, px, y, 3, 16);
      V(c, PAL.tileRoofL, px, y, 16);
    }
    for (let i = 0; i < 4; i++) H(c, PAL.tileRoofD, x, y + i * 4 + 3, 16);
    H(c, '#d38f66', x, y, 16);                       // lit ridge course
    R(c, PAL.tileRoofXD, x, y + 14, 16, 2);          // eave overhang
  });

  def('ROOF_PEAK', 'Roof Peak', SOLID, { layer: 'over', group: 'roof', biomes: ['city'], variants: 1 }, (c, x, y) => {
    blob(c, PAL.thatchD, x, y, [[1, 7, 2], [2, 6, 4], [3, 5, 6], [4, 4, 8], [5, 3, 10], [6, 2, 12], [7, 1, 14], [8, 0, 16], [9, 0, 16], [10, 0, 16], [11, 0, 16], [12, 0, 16], [13, 0, 16], [14, 0, 16], [15, 0, 16]]);
    blob(c, PAL.thatch, x, y, [[3, 6, 4], [4, 5, 6], [5, 4, 8], [6, 3, 10], [7, 2, 12], [8, 1, 14], [9, 1, 14], [10, 0, 16], [11, 0, 16], [12, 0, 16], [13, 0, 16]]);
    H(c, PAL.thatchL, x + 1, y + 9, 14); H(c, PAL.thatchL, x + 0, y + 12, 16);
    H(c, PAL.thatchM, x, y + 11, 16); H(c, PAL.thatchD, x, y + 13, 16);
    R(c, PAL.thatchXD, x, y + 14, 16, 2);          // eave overhang
    blob(c, PAL.thatchL, x, y, [[3, 6, 3], [4, 5, 4], [5, 4, 4], [6, 3, 4], [7, 2, 4]]);  // lit upper-left slope
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
    contact(c, x, y, 7, 15);
    outlineBox(c, PAL.barkXD, x, y, 7, 8, 2, 8);
    outlineBox(c, PAL.barkXD, x, y, 2, 2, 12, 7);
    R(c, PAL.woodD, x + 7, y + 8, 2, 8);
    R(c, PAL.wood, x + 2, y + 2, 12, 7);
    O(c, PAL.woodD, x + 2, y + 2, 12, 7); H(c, PAL.woodL, x + 3, y + 3, 10);
    V(c, PAL.woodL, x + 3, y + 3, 5); V(c, PAL.woodD, x + 12, y + 3, 5);
    H(c, PAL.ink, x + 4, y + 5, 8); H(c, PAL.ink, x + 4, y + 7, 6);
  });

  // --- 4.11 fences & gates -------------------------------------------------
  def('FENCE_H', 'Fence', SOLID, { layer: 'deco', group: 'fence', biomes: ['plains', 'city'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 14, 15);
    R(c, PAL.barkXD, x, y + 5, 16, 4); R(c, PAL.barkXD, x, y + 9, 16, 4);
    R(c, PAL.barkXD, x + 1, y + 2, 4, 13); R(c, PAL.barkXD, x + 11, y + 2, 4, 13);
    H(c, PAL.woodL, x, y + 6, 16); H(c, PAL.wood, x, y + 7, 16);
    H(c, PAL.woodL, x, y + 10, 16); H(c, PAL.wood, x, y + 11, 16);
    R(c, PAL.woodL, x + 2, y + 3, 2, 11); R(c, PAL.woodL, x + 12, y + 3, 2, 11);
    V(c, PAL.woodD, x + 3, y + 3, 11); V(c, PAL.woodD, x + 13, y + 3, 11);
  });
  def('FENCE_V', 'Fence', SOLID, { layer: 'deco', group: 'fence', biomes: ['plains', 'city'], variants: 1 }, (c, x, y) => {
    footRight(c, x, y, 14, 0, 16, 0.95);             // a N-S fence throws east, not down
    R(c, PAL.barkXD, x + 5, y, 4, 16); R(c, PAL.barkXD, x + 9, y, 4, 16);
    R(c, PAL.barkXD, x + 3, y + 1, 12, 4); R(c, PAL.barkXD, x + 3, y + 11, 12, 4);
    V(c, PAL.wood, x + 6, y, 16); V(c, PAL.woodD, x + 7, y, 16);
    V(c, PAL.wood, x + 10, y, 16); V(c, PAL.woodD, x + 11, y, 16);
    R(c, PAL.woodL, x + 4, y + 2, 10, 2); R(c, PAL.woodL, x + 4, y + 12, 10, 2);
    H(c, PAL.woodD, x + 4, y + 4, 10); H(c, PAL.woodD, x + 4, y + 14, 10);
  });
  def('FENCE_CORNER', 'Fence Corner', SOLID, { layer: 'deco', group: 'fence', biomes: ['plains', 'city'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 10, 15);
    R(c, PAL.barkXD, x + 4, y + 1, 5, 15); R(c, PAL.barkXD, x + 6, y + 5, 10, 4); R(c, PAL.barkXD, x + 6, y + 9, 10, 4);
    R(c, PAL.woodL, x + 5, y + 2, 3, 13); V(c, PAL.woodD, x + 7, y + 2, 13);
    H(c, PAL.wood, x + 7, y + 6, 9); H(c, PAL.woodD, x + 7, y + 7, 9);
    H(c, PAL.wood, x + 7, y + 10, 9); H(c, PAL.woodD, x + 7, y + 11, 9);
    V(c, PAL.wood, x + 6, y + 7, 9); V(c, PAL.woodD, x + 5, y + 7, 9);
  });
  def('STONE_FENCE', 'Stone Wall', SOLID, { layer: 'deco', group: 'fence', biomes: ['plains', 'city', 'hills'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    // The wall used to run to row 15, so it had no ground of its own to stand
    // on. Its foot is row 13 now and rows 14-15 carry the cast shadow.
    foot(c, x, y, 0, 16, 13, 1.15);
    R(c, PAL.stoneXD, x, y + 4, 16, 10);
    R(c, PAL.stone, x, y + 5, 16, 9);
    H(c, PAL.stoneH, x, y + 5, 16); H(c, PAL.stoneL, x, y + 6, 16);
    H(c, PAL.stoneD, x, y + 12, 16); H(c, PAL.stoneXD, x, y + 13, 16);
    for (let i = 0; i < 5; i++) V(c, PAL.stoneD, x + 1 + Math.floor(r() * 14), y + 7, 5);
    speck(c, PAL.stoneL, x, y + 7, 5, r, 16, 5);
  });
  def('GATE', 'Gate', DOOR | TRIGGER, { layer: 'deco', group: 'fence', biomes: ['plains', 'city'], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 14, 15);
    R(c, PAL.barkXD, x, y + 1, 3, 15); R(c, PAL.barkXD, x + 13, y + 1, 3, 15);
    R(c, PAL.barkXD, x + 1, y + 4, 14, 3); R(c, PAL.barkXD, x + 1, y + 9, 14, 3);
    R(c, PAL.woodL, x, y + 2, 2, 13); R(c, PAL.woodL, x + 14, y + 2, 2, 13);
    H(c, PAL.wood, x + 2, y + 5, 12); H(c, PAL.wood, x + 2, y + 10, 12);
    for (let i = 0; i < 10; i++) P(c, PAL.woodD, x + 3 + i, y + 10 - i); // brace
    P(c, PAL.metal, x + 7, y + 7); P(c, PAL.metal, x + 8, y + 7);
  });

  // --- 4.12 town props -----------------------------------------------------
  def('WELL', 'Well', SOLID | TRIGGER, { layer: 'deco', group: 'prop', biomes: ['city'], variants: 1 }, (c, x, y) => {
    // The rim reached row 15, which left the shadow nowhere to go: it is a row
    // shorter now and row 15 is the ground the well stands on.
    foot(c, x, y, 1, 14, 14, 1.15);
    outlineBox(c, PAL.stoneXD, x, y, 1, 8, 14, 6);
    outlineBox(c, PAL.barkXD, x, y, 2, 0, 12, 9);
    R(c, PAL.stone, x + 1, y + 8, 14, 6);
    O(c, PAL.stoneD, x + 1, y + 8, 14, 6); H(c, PAL.stoneH, x + 2, y + 8, 12);
    R(c, '#1c2a38', x + 4, y + 9, 8, 4); R(c, PAL.water, x + 5, y + 11, 6, 2); H(c, PAL.waterL, x + 6, y + 11, 3);
    R(c, PAL.wood, x + 2, y + 1, 2, 8); R(c, PAL.wood, x + 12, y + 1, 2, 8);
    R(c, PAL.woodD, x + 1, y, 14, 2); H(c, PAL.woodL, x + 1, y, 14);
    V(c, PAL.cloth, x + 8, y + 2, 5); R(c, PAL.wood, x + 7, y + 6, 3, 2);
  });

  const BARREL_ROWS = [[3, 4, 8], [4, 3, 10], [5, 3, 10], [6, 3, 10], [7, 3, 10], [8, 3, 10], [9, 3, 10], [10, 3, 10], [11, 3, 10], [12, 3, 10], [13, 4, 8]];
  def('BARREL', 'Barrel', SOLID, { layer: 'deco', group: 'prop', biomes: ['city', 'dungeon', 'mine'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    shadowUnder(c, x, y, 10, 13);
    outline(c, PAL.barkXD, x, y, BARREL_ROWS);
    blob(c, PAL.wood, x, y, BARREL_ROWS);
    H(c, PAL.iron, x + 3, y + 5, 10); H(c, PAL.iron, x + 3, y + 11, 10);
    V(c, PAL.woodL, x + 4, y + 4, 9); V(c, PAL.woodD, x + 11, y + 4, 9);
    R(c, PAL.woodL, x + 4, y + 3, 8, 1); H(c, PAL.woodD, x + 4, y + 4, 8);
    V(c, PAL.barkD, x + 12, y + 4, 9);                       // shaded lower-right stave
    if (r() < 0.5) P(c, PAL.woodD, x + 7, y + 8);
  });

  def('CRATE', 'Crate', SOLID, { layer: 'deco', group: 'prop', biomes: ['city', 'dungeon', 'mine'], variants: 2 }, (c, x, y) => {
    shadowUnder(c, x, y, 12, 13);
    outlineBox(c, PAL.barkXD, x, y, 2, 3, 12, 11);
    R(c, PAL.wood, x + 2, y + 3, 12, 11);
    O(c, PAL.woodD, x + 2, y + 3, 12, 11);
    H(c, PAL.woodL, x + 3, y + 4, 10); V(c, PAL.woodL, x + 3, y + 4, 9);
    for (let i = 0; i < 9; i++) { P(c, PAL.woodD, x + 3 + i, y + 4 + i); P(c, PAL.woodD, x + 12 - i, y + 4 + i); }
    R(c, PAL.woodD, x + 2, y + 8, 12, 1);
    V(c, PAL.barkD, x + 12, y + 4, 9);
  });

  def('SACK', 'Sack', SOLID, { layer: 'deco', group: 'prop', biomes: ['city', 'mine'], variants: 2 }, (c, x, y) => {
    shadowUnder(c, x, y, 10, 13);
    outline(c, PAL.barkXD, x, y, [[4, 6, 4], [5, 5, 6], [6, 4, 8], [7, 3, 10], [8, 3, 10], [9, 3, 10], [10, 3, 10], [11, 3, 10], [12, 4, 8], [13, 4, 8]]);
    blob(c, PAL.cloth, x, y, [[4, 6, 4], [5, 5, 6], [6, 4, 8], [7, 3, 10], [8, 3, 10], [9, 3, 10], [10, 3, 10], [11, 3, 10], [12, 4, 8], [13, 4, 8]]);
    blob(c, PAL.clothD, x, y, [[11, 3, 10], [12, 4, 8], [13, 4, 8]]);
    R(c, PAL.woodD, x + 6, y + 4, 4, 1);
    H(c, '#8b7b56', x + 5, y + 6, 6);
    V(c, '#e0d4b0', x + 5, y + 8, 4);
  });

  def('CART', 'Handcart', SOLID, { layer: 'deco', group: 'prop', biomes: ['city', 'road'], variants: 1 }, (c, x, y) => {
    shadowUnder(c, x, y, 14, 13);
    outlineBox(c, PAL.barkXD, x, y, 1, 4, 14, 6);
    R(c, PAL.wood, x + 1, y + 4, 14, 6);
    H(c, PAL.woodL, x + 1, y + 4, 14); H(c, PAL.woodD, x + 1, y + 9, 14);
    for (let i = 0; i < 4; i++) V(c, PAL.woodD, x + 3 + i * 3, y + 5, 4);
    // two wheels
    for (const wx of [x + 3, x + 11]) {
      const wheel = [[0, 1, 4], [1, 0, 6], [2, 0, 6], [3, 0, 6], [4, 1, 4]];
      outline(c, PAL.barkXD, wx - 2, y + 9, wheel);
      blob(c, PAL.barkD, wx - 2, y + 9, wheel);
      P(c, PAL.metal, wx + 0, y + 11); P(c, PAL.metal, wx + 1, y + 11);
    }
    R(c, PAL.woodL, x + 13, y + 2, 3, 2);
  });

  const ANVIL_ROWS = [[4, 2, 12], [5, 2, 12], [6, 4, 8], [7, 5, 6], [8, 4, 8], [9, 3, 10], [10, 3, 10]];
  def('ANVIL', 'Anvil', SOLID, { layer: 'deco', group: 'prop', biomes: ['city'], variants: 1 }, (c, x, y) => {
    shadowUnder(c, x, y, 11, 14);
    outlineBox(c, PAL.barkXD, x, y, 4, 11, 8, 4);
    R(c, PAL.bark, x + 4, y + 11, 8, 4); H(c, PAL.barkL, x + 4, y + 11, 8);
    outline(c, PAL.ironXD, x, y, ANVIL_ROWS);
    blob(c, PAL.iron, x, y, ANVIL_ROWS);
    H(c, PAL.metal, x + 2, y + 4, 12);
    P(c, PAL.metalL, x + 3, y + 4); P(c, PAL.metalL, x + 12, y + 4);
    H(c, PAL.ironD, x + 3, y + 10, 10); V(c, PAL.ironD, x + 12, y + 9, 2);
  });

  def('FORGE', 'Forge', SOLID, { layer: 'deco', group: 'prop', biomes: ['city'], variants: 1, animFrames: 3, fps: 6 },
    (c, x, y, v, w, f) => {
      foot(c, x, y, 0, 16, 13, 1.15);                // the forge stands on rows 14-15
      R(c, PAL.stone, x, y + 2, 16, 12);
      O(c, PAL.stoneD, x, y + 2, 16, 12); H(c, PAL.stoneH, x, y + 2, 16);
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
    foot(c, x, y, 1, 14, 14, 1.0);                  // footboard at row 14, floor at 15
    R(c, PAL.woodD, x + 1, y, 14, 15);
    R(c, PAL.cloth, x + 2, y + 1, 12, 5);           // pillow end
    R(c, PAL.blue, x + 2, y + 6, 12, 8);            // blanket
    H(c, PAL.blueL, x + 2, y + 6, 12); H(c, PAL.blueD, x + 2, y + 13, 12);
    H(c, '#e2d8bc', x + 3, y + 2, 10);
    R(c, PAL.wood, x + 1, y, 14, 1); R(c, PAL.wood, x + 1, y + 14, 14, 1);
    for (let i = 0; i < 3; i++) V(c, PAL.blueD, x + 5 + i * 3, y + 7, 6);
  });

  def('BOOKSHELF', 'Bookshelf', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city', 'dungeon'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      foot(c, x, y, 0, 16, 14, 1.1);                 // the carcass ends at 14; 15 is floor
      R(c, PAL.woodD, x, y, 16, 15);
      const cols = ['#8c3a34', '#3a5a8c', '#6a8c3a', '#8c7a3a', '#5f3a8c', '#8c5a3a'];
      for (let shelf = 0; shelf < 3; shelf++) {
        const sy = y + shelf * 5;                   // lips at 4/9/14, floor stays at 15
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
      O(c, PAL.woodL, x, y, 16, 15);
    });

  def('SHELF_GOODS', 'Shelves', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    foot(c, x, y, 0, 16, 14, 1.1);
    R(c, PAL.woodD, x, y, 16, 15);
    for (let shelf = 0; shelf < 3; shelf++) {
      const sy = y + shelf * 5;                     // lips at 4/9/14, floor stays at 15
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
    O(c, PAL.woodL, x, y, 16, 15);
  });

  def('COUNTER', 'Counter', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city'], variants: 1 }, (c, x, y) => {
    foot(c, x, y, 0, 16, 14, 1.1);
    R(c, PAL.woodL, x, y + 3, 16, 3); H(c, PAL.woodH, x, y + 3, 16);
    R(c, PAL.wood, x, y + 6, 16, 9);
    for (let i = 0; i < 4; i++) V(c, PAL.woodD, x + 3 + i * 4, y + 6, 9);
    H(c, PAL.woodD, x, y + 14, 16);
  });

  def('BAR', 'Bar', SOLID, { layer: 'deco', group: 'furniture', biomes: ['city'], variants: 1 }, (c, x, y) => {
    foot(c, x, y, 0, 16, 14, 1.1);
    R(c, PAL.woodH, x, y + 2, 16, 3); H(c, '#d09a62', x, y + 2, 16); H(c, PAL.woodD, x, y + 4, 16);
    R(c, PAL.woodD, x, y + 5, 16, 10);
    for (let i = 0; i < 3; i++) { R(c, PAL.wood, x + 1 + i * 5, y + 6, 4, 8); H(c, PAL.woodL, x + 1 + i * 5, y + 6, 4); }
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
      foot(c, x, y, 0, 16, 14, 1.1);                 // the surround stops at 14
      R(c, PAL.stone, x, y, 16, 15);
      for (let row = 0; row < 3; row++) { H(c, PAL.stoneD, x, y + row * 4 + 3, 16); V(c, PAL.stoneD, x + ((row % 2) ? 5 : 11), y + row * 4, 3); }
      R(c, '#140e0a', x + 3, y + 5, 10, 10);
      const h = [6, 8, 7][f % 3];
      blob(c, PAL.ember, x, y, [[14, 4, 8], [13, 4, 8], [12, 5, 6]]);
      R(c, PAL.fireD, x + 5, y + 15 - h, 6, h - 1);
      R(c, PAL.fire, x + 6, y + 17 - h, 4, h - 3);
      P(c, PAL.fireHot, x + 7 + (f % 2), y + 16 - h);
      R(c, PAL.wood, x + 4, y + 13, 8, 1);
    });

  def('CANDLE', 'Candle', 0, { layer: 'deco', group: 'prop', biomes: ['city', 'dungeon', 'crypt'], variants: 1, animFrames: 2, fps: 4 },
    (c, x, y, v, w, f) => {
      foot(c, x, y, 6, 4, 14, 0.75);
      R(c, PAL.gold, x + 6, y + 13, 4, 2); H(c, PAL.goldL, x + 6, y + 13, 4);
      R(c, '#e8e0c4', x + 7, y + 7, 2, 6); V(c, '#fff8e0', x + 7, y + 7, 6);
      P(c, PAL.ink, x + 7, y + 6);
      P(c, PAL.fire, x + 7, y + 5 - (f % 2)); P(c, PAL.fireHot, x + 7, y + 4 - (f % 2));
    });

  def('TORCH', 'Torch Sconce', 0, { layer: 'deco', group: 'prop', biomes: ['dungeon', 'cave', 'city', 'mine'], variants: 1, animFrames: 4, fps: 8 },
    (c, x, y, v, w, f) => {
      // A sconce hangs on a wall, so its shadow falls on the wall behind it and
      // to the lower-right — same light, same rule, different surface.
      foot(c, x, y, 7, 4, 13, 0.7);
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
    // The plinth used to run off the bottom of its own tile; it stops at 14 now
    // so the shrine has a floor to cast onto.
    foot(c, x, y, 0, 16, 14, 1.15);
    blob(c, PAL.stone, x, y, [[1, 5, 6], [2, 3, 10], [3, 2, 12], [4, 1, 14], [5, 1, 14], [6, 1, 14], [7, 1, 14], [8, 1, 14], [9, 1, 14], [10, 1, 14], [11, 1, 14], [12, 1, 14], [13, 1, 14], [14, 0, 16]]);
    R(c, '#221b16', x + 4, y + 5, 8, 9);
    blob(c, PAL.stoneH, x, y, [[1, 5, 6], [2, 3, 4], [4, 1, 2]]);
    R(c, PAL.gold, x + 6, y + 7, 4, 4); O(c, PAL.goldD, x + 6, y + 7, 4, 4); P(c, PAL.goldL, x + 7, y + 8);
    R(c, PAL.stoneD, x + 4, y + 13, 8, 1);
  });

  def('FOUNTAIN', 'Fountain', SOLID, { layer: 'deco', group: 'prop', biomes: ['city'], variants: 1, animFrames: 2, fps: 3 },
    (c, x, y, v, w, f) => {
      foot(c, x, y, 0, 16, 14, 1.15);
      R(c, PAL.stoneL, x, y + 3, 16, 12);
      O(c, PAL.stoneD, x, y + 3, 16, 12); H(c, PAL.stoneH, x, y + 3, 16);
      R(c, PAL.water, x + 2, y + 5, 12, 8);
      H(c, PAL.waterL, x + 3 + f, y + 7, 5); H(c, PAL.waterL, x + 8 - f, y + 10, 4);
      R(c, PAL.stone, x + 6, y + 4, 4, 6); H(c, PAL.stoneH, x + 6, y + 4, 4);
      V(c, PAL.foam, x + 7, y + 1 + f, 3); V(c, PAL.foam, x + 9, y + 2 - f, 3);
      P(c, PAL.foam, x + 5, y + 6); P(c, PAL.foam, x + 11, y + 8);
      H(c, PAL.stoneD, x, y + 14, 16);
    });

  // The `R(grassD, x+1, y+13, 14, 3)` mound used to be painted straight over the
  // contact shadow, so the stone had none — and on grass the mound itself was
  // invisible (63% of the rim under threshold). Shadow first, keyline, then a
  // few tufts that do not swallow either.
  def('GRAVESTONE', 'Gravestone', SOLID, { layer: 'deco', group: 'prop', biomes: ['crypt', 'ruins', 'plains'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      const rows = [[3, 5, 6], [4, 4, 8], [5, 4, 8], [6, 4, 8], [7, 4, 8], [8, 4, 8], [9, 4, 8], [10, 4, 8], [11, 4, 8], [12, 3, 10], [13, 3, 10]];
      shadowUnder(c, x, y, 12, 13);
      outline(c, PAL.stoneXD, x, y, rows);
      blob(c, PAL.stone, x, y, rows);
      blob(c, PAL.stoneL, x, y, [[3, 5, 5], [4, 4, 4], [5, 4, 3], [6, 4, 2], [7, 4, 2], [8, 4, 2], [9, 4, 2], [10, 4, 2], [11, 4, 2]]);
      blob(c, PAL.stoneH, x, y, [[3, 5, 4], [4, 4, 2]]);
      blob(c, PAL.stoneD, x, y, [[9, 10, 2], [10, 10, 2], [11, 10, 2], [12, 11, 2], [13, 11, 2]]);
      H(c, PAL.stoneD, x + 5, y + 6, 6); H(c, PAL.stoneD, x + 5, y + 8, 4);
      for (let i = 0; i < 5; i++) { const gx = x + 1 + Math.floor(r() * 14); V(c, PAL.grassD, gx, y + 12 + Math.floor(r() * 2), 3); }
      for (let i = 0; i < 3; i++) P(c, PAL.moss, x + 3 + Math.floor(r() * 10), y + 6 + Math.floor(r() * 7));
    });

  def('TOMB', 'Tomb', SOLID | TRIGGER, { layer: 'deco', group: 'prop', biomes: ['crypt', 'dungeon'], variants: 1 }, (c, x, y) => {
    foot(c, x, y, 0, 16, 14, 1.15);
    R(c, PAL.stoneD, x, y + 2, 16, 13);
    R(c, PAL.stone, x + 1, y + 3, 14, 11);
    R(c, PAL.stoneL, x, y + 1, 16, 3); H(c, PAL.stoneH, x, y + 1, 16); H(c, PAL.stoneD, x, y + 4, 16);
    for (let i = 0; i < 3; i++) H(c, PAL.stoneD, x + 2, y + 7 + i * 3, 12);
    R(c, PAL.dgnD, x + 6, y + 8, 4, 5); H(c, PAL.stoneH, x + 6, y + 8, 4);
  });

  def('SARCOPHAGUS', 'Sarcophagus', SOLID | TRIGGER, { layer: 'deco', group: 'prop', biomes: ['crypt', 'dungeon', 'ruins'], variants: 1 }, (c, x, y) => {
    foot(c, x, y, 3, 10, 14, 1.1);
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
    const ribs = [];
    for (let i = 0; i < 4; i++) ribs.push([x + 1 + Math.floor(r() * 10), y + 4 + Math.floor(r() * 10)]);
    const sx = x + 4 + Math.floor(r() * 5), sy = y + 8 + Math.floor(r() * 4);
    // each bone throws its own little shadow, so the pile has depth instead of
    // being a bone-coloured decal
    for (const [bx, by] of ribs) foot(c, x, y, bx - x - 1, 7, by - y + 1, 0.5);
    foot(c, x, y, sx - x - 1, 7, sy - y + 3, 0.6);
    for (const [bx, by] of ribs) R(c, '#3a3226', bx - 1, by, 7, 3);      // shadow + keyline
    R(c, '#3a3226', sx - 1, sy, 7, 5);
    for (const [bx, by] of ribs) {
      R(c, PAL.bone, bx, by, 5, 1); P(c, PAL.boneL, bx, by); P(c, PAL.boneD, bx + 4, by);
      P(c, PAL.bone, bx, by - 1); P(c, PAL.bone, bx + 4, by + 1);
    }
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
        contact(c, mx - 6, my, 5, h + 2);                  // they had no shadow at all
        R(c, '#2b2419', mx, my + 1, 4, h + 2);             // keyline
        R(c, '#d8cfae', mx + 1, my + 2, 2, h);
        // the cap's own dark tone measured only 10 Y from cave-floor speckle,
        // so the RIM is near-black and `capD` only shades the cap's flanks
        outline(c, '#2b2419', mx, my, [[0, 1, 3], [1, 0, 5], [2, 1, 3]]);
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
      // Stalagmites are painted in the cave palette on a cave floor, so they
      // measured 21% of their rim under threshold. A `caveWD` keyline plus a
      // committed upper-left light fixes both at once — but the keyline goes on
      // the SHADED side only. Ringing a thin cone in near-black dragged the
      // whole prop's mean down to ΔE76 1.8 from the floor; on the lit side the
      // `caveH` edge does the separating.
      const cone = (sx, top) => {
        const h = 16 - top;
        for (let i = 0; i < h; i++) {
          const ww = 1 + Math.floor(i * 5 / h);
          R(c, PAL.caveWD, sx - (ww >> 1), y + top + i, ww + 1, 1);
        }
        for (let i = 0; i < h; i++) {
          const ww = 1 + Math.floor(i * 5 / h);
          R(c, PAL.caveL, sx - (ww >> 1), y + top + i, ww, 1);
          P(c, PAL.caveH, sx - (ww >> 1), y + top + i);
          if (ww >= 4) P(c, PAL.caveM, sx + ww - (ww >> 1) - 1, y + top + i);
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

  // Had no contact shadow at all, and every chip carried a `stoneH` cap, so a
  // pile of rubble was a scatter of bright specks with no mass.
  def('RUBBLE', 'Rubble', SLOW, { layer: 'deco', group: 'prop', biomes: ['cave', 'ruins', 'dungeon', 'mine'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      const chips = [];
      for (let i = 0; i < 11; i++) chips.push([x + Math.floor(r() * 13), y + 3 + Math.floor(r() * 11), 2 + Math.floor(r() * 2)]);
      for (const [px, py, w] of chips) foot(c, x, y, px - x, w, py - y + 1, 0.55);
      // occlusion under and to the RIGHT of each chip — a full box of `stoneXD`
      // around every 2-row chip made the pile average darker than cave floor
      for (const [px, py, w] of chips) R(c, PAL.stoneXD, px, py + 1, w + 1, 2);
      for (const [px, py, w] of chips) {
        R(c, PAL.stone, px, py, w, 2);
        H(c, PAL.stoneL, px, py, w); P(c, PAL.stoneD, px + w - 1, py + 1);
      }
    });

  /**
   * BOULDER. Measured topMinusBot 0.0 and leftMinusRight +1.8 — a flat grey
   * blob with no form whatsoever, ΔE 5.6 from the cave floor it sits on with
   * 90% of its silhouette below the contrast threshold. It got a keyline, a lit
   * cap and a real shadow — and still measured ΔE76 5.9 / 1.19:1 in a cave,
   * because a black rim around a `stoneD` body averages out to cave floor.
   *
   * Same correction as ROCK: the mass is `stone`, the rim is confined to the
   * bottom and right where the upper-left light cannot reach, and the lit face
   * separates itself from the ground by being lighter than it.
   */
  def('BOULDER', 'Boulder', SOLID, { layer: 'deco', group: 'prop', biomes: ['plains', 'hills', 'mountain', 'cave', 'coast'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      const body = [[2, 5, 7], [3, 3, 11], [4, 2, 12], [5, 1, 14], [6, 1, 14], [7, 0, 16], [8, 0, 16], [9, 0, 16], [10, 0, 16], [11, 1, 14], [12, 1, 14], [13, 2, 12], [14, 4, 8]];
      foot(c, x, y, 2, 12, 14, 1.2);
      for (const q of body) {                         // rim: bottom + right only
        R(c, PAL.stoneXD, x + q[1] + q[2], y + q[0], 1, 1);
        // ...but never onto row 15: that is the boulder's own cast shadow, and
        // painting the rim over it left only 4 darkened ground pixels
        if (q[0] < 14) R(c, PAL.stoneXD, x + q[1], y + q[0] + 1, q[2] + 1, 1);
      }
      blob(c, PAL.stone, x, y, body);
      // The lit rim reaches the SILHOUETTE on the upper-left, so the boulder is
      // separated from pale ground by a light edge and from dark ground by the
      // `stoneXD` rim on the other side. With `stone` on that edge instead, 44%
      // of the outline measured under 6 dL* against grass.
      blob(c, PAL.stoneL, x, y, [[2, 5, 7], [3, 3, 11], [4, 2, 12], [5, 1, 12], [6, 1, 11], [7, 0, 11], [8, 0, 9], [9, 0, 7], [10, 1, 5]]);
      // lit cap, upper-left
      blob(c, PAL.stoneH, x, y, [[3, 5, 5], [4, 4, 5], [5, 3, 4], [6, 3, 3]]);
      // shaded crescent, lower-right
      blob(c, PAL.stoneD, x, y, [[9, 11, 4], [10, 10, 6], [11, 9, 6], [12, 7, 7], [13, 6, 8]]);
      // the underside is in the boulder's own shadow — and it is the edge that
      // has to separate from cave floor, which `stoneD` alone does not
      blob(c, PAL.stoneXD, x, y, [[14, 4, 8]]);
      speck(c, PAL.stoneM, x, y + 6, 4, r, 12, 6, 2, 0);
    });

  /**
   * ROCK. The one the user actually complained about, twice.
   *
   * Round one fixed the floating shadow (`contact` was called with a fixed row
   * while the body was offset by `oy = 4 + r()*4`) and gave the silhouette a
   * `stoneXD` keyline. That was not enough: a full black rim around a `stoneD`
   * body averages DARKER than cave floor, so the whole prop measured ΔE76 4.18
   * / 1.06:1 against the ground and read only as an outline drawing.
   *
   * Round two changes what the rock IS. It is pale granite now — the body fills
   * in `stoneL`, not `stoneD`, so it has value MASS against the (slightly
   * darkened) cave floor rather than only an edge. The heavy keyline survives
   * only where the light does not reach, on the bottom and the right; the lit
   * upper-left edge is separated from the ground by its own brightness, which
   * is how a lit object actually reads. On grass the value gap is smaller, but
   * grey-on-green is carrying a huge hue difference there anyway.
   */
  def('ROCK', 'Rock', 0, { layer: 'deco', group: 'prop', biomes: ['plains', 'hills', 'mountain', 'cave', 'coast'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      const ox = Math.floor(r() * 4), oy = 4 + Math.floor(r() * 4);
      const body = [[0, 2, 4], [1, 1, 6], [2, 0, 8], [3, 0, 8], [4, 1, 6]];
      foot(c, x + ox, y + oy, 0, 8, 4, 0.95);
      // ROUND THREE: it is GRANITE, not kerbstone. Rounds one and two fixed the
      // floating shadow and gave the prop value mass, which took it from dE76
      // 4.18 to 8.29 against cave floor — but against GRAVEL, which is grey
      // chippings at almost the same value, it was still 4.18 at 1.14:1. The
      // ground moved (gravel is warm scree now) and so does the rock: the
      // `granite` ramp holds the same values as `stone` to within 2 L* and
      // swings b* from +4 to -5, so the separation is carried by hue where
      // value cannot carry it.
      for (const q of body) {
        R(c, PAL.graniteXD, x + ox + q[1] + q[2], y + oy + q[0], 1, 1);
        R(c, PAL.graniteXD, x + ox + q[1], y + oy + q[0] + 1, q[2] + 1, 1);
      }
      blob(c, PAL.granite, x + ox, y + oy, body);
      blob(c, PAL.graniteL, x + ox, y + oy, [[0, 2, 4], [1, 1, 5], [2, 0, 6], [3, 0, 4]]);
      blob(c, PAL.graniteH, x + ox, y + oy, [[0, 3, 2], [1, 2, 3], [2, 1, 2]]);
      // the shaded lower-right face
      blob(c, PAL.graniteD, x + ox, y + oy, [[2, 6, 2], [3, 5, 3], [4, 3, 4]]);
      P(c, PAL.graniteM, x + ox + 1, y + oy + 4);
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
    shadowUnder(c, x, y, 13, 13);
    outlineBox(c, PAL.barkXD, x, y, 2, 4, 12, 10);   // `barkD` alone was 1 Y from cave floor
    R(c, PAL.wood, x + 2, y + 8, 12, 6);
    blob(c, PAL.wood, x, y, [[4, 3, 10], [5, 2, 12], [6, 2, 12], [7, 2, 12]]);
    H(c, PAL.woodL, x + 3, y + 4, 10); V(c, PAL.woodL, x + 3, y + 5, 8);
    V(c, PAL.woodD, x + 12, y + 5, 8);
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
    foot(c, x, y, 4, 8, 14, 0.9);
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
      foot(c, x, y, 3, 10, 14, 1.0);                 // the arch stands on row 15
      blob(c, PAL.stoneD, x, y, [[0, 4, 8], [1, 2, 12], [2, 1, 14], [3, 0, 16], [4, 0, 16], [5, 0, 16], [6, 0, 16], [7, 0, 16], [8, 0, 16], [9, 0, 16], [10, 0, 16], [11, 0, 16], [12, 1, 14], [13, 1, 14], [14, 3, 10]]);
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
    footRight(c, x, y, 14, 0, 16, 0.85);             // leans on a wall, throws east
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
    // mortar was `stoneD` on a `stoneL` base — a 35 L* range inside one floor
    // tile, the loudest surface in the set. `stoneM` halves it.
    stoneSlabs(c, x, y, PAL.stoneL, PAL.stoneM, PAL.stoneH);
    R(c, PAL.stone, x, y, 16, 2); R(c, PAL.stone, x, y + 14, 16, 2);
    H(c, PAL.stoneL, x, y, 16); H(c, PAL.stoneD, x, y + 15, 16);
    speck(c, PAL.stoneM, x, y + 3, 5, r, 16, 10);
  });

  // --- 4.17 trees & foliage ------------------------------------------------
  const OAK_ROWS = [[0, 5, 6], [1, 3, 10], [2, 2, 12], [3, 1, 14], [4, 1, 14], [5, 0, 16], [6, 0, 16], [7, 0, 16], [8, 1, 14], [9, 1, 14], [10, 2, 12], [11, 4, 8]];
  def('TREE_OAK', 'Oak', SOLID, { layer: 'deco', group: 'tree', biomes: ['forest', 'plains', 'hills'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 13, 14);                  // pools either side of the trunk
      R(c, PAL.barkD, x + 5, y + 10, 6, 6);      // trunk keyline
      R(c, PAL.bark, x + 6, y + 10, 4, 6); V(c, PAL.barkL, x + 6, y + 10, 6); V(c, PAL.barkD, x + 9, y + 10, 6);
      outline(c, PAL.leafXD, x, y, OAK_ROWS);
      blob(c, PAL.leafD, x, y, OAK_ROWS);
      blob(c, PAL.leaf, x, y, OAK_ROWS.map((q) => [q[0], q[1] + 1, Math.max(1, q[2] - 2)]));
      // canopy lit from the upper-left, shaded to the lower-right
      blob(c, PAL.leafL, x, y, [[1, 4, 6], [2, 3, 7], [3, 2, 7], [4, 2, 6], [5, 1, 6], [6, 1, 4]]);
      blob(c, PAL.leafD, x, y, [[8, 9, 6], [9, 8, 7], [10, 7, 7], [11, 6, 6]]);
      speck(c, PAL.leafH, x + 2, y + 1, 5, r, 10, 6);
      speck(c, PAL.leafD, x + 3, y + 6, 5, r, 11, 5);
    });

  def('TREE_PINE', 'Pine', SOLID, { layer: 'deco', group: 'tree', biomes: ['pine-forest', 'mountain', 'tundra'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 11, 14);
      R(c, PAL.barkXD, x + 6, y + 12, 5, 4);
      R(c, PAL.barkD, x + 7, y + 12, 3, 4);
      const rows = [[0, 7, 2], [1, 6, 4], [2, 6, 4], [3, 5, 6], [4, 4, 8], [5, 6, 4], [6, 5, 6], [7, 4, 8], [8, 3, 10], [9, 5, 6], [10, 4, 8], [11, 3, 10], [12, 2, 12]];
      outline(c, PAL.pineXD, x, y, rows);
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
    const bottom = rows.reduce((m, q) => Math.max(m, q[0]), 0);
    if (bottom < 14) shadowUnder(c, x, y, 12, bottom);   // the BL/BR halves had none
    outline(c, PAL.leafXD, x, y, rows);
    blob(c, PAL.leafD, x, y, rows);
    blob(c, PAL.leaf, x, y, rows.map((q) => [q[0], q[1] + 1, Math.max(1, q[2] - 2)]));
    speck(c, PAL.leafH, x, y, 7, r, 14, Math.min(12, bottom));
    speck(c, PAL.leafD, x, y, 6, r, 16, bottom + 1);
    if (trunkSide === 'L') { R(c, PAL.barkD, x + 13, y + 8, 3, 8); R(c, PAL.bark, x + 14, y + 8, 2, 8); V(c, PAL.barkL, x + 14, y + 8, 8); }
    if (trunkSide === 'R') { R(c, PAL.barkD, x, y + 8, 3, 8); R(c, PAL.bark, x, y + 8, 2, 8); V(c, PAL.barkD, x + 1, y + 8, 8); }
  };
  def('OAK_TL', 'Oak', SOLID, { layer: 'over', group: 'tree', biomes: ['forest'], variants: 2 }, canopy(oakTL, null));
  def('OAK_TR', 'Oak', SOLID, { layer: 'over', group: 'tree', biomes: ['forest'], variants: 2 }, canopy(mirror(oakTL), null));
  def('OAK_BL', 'Oak', SOLID, { layer: 'deco', group: 'tree', biomes: ['forest'], variants: 2 }, canopy(oakBL, 'L'));
  def('OAK_BR', 'Oak', SOLID, { layer: 'deco', group: 'tree', biomes: ['forest'], variants: 2 }, canopy(mirror(oakBL), 'R'));

  const pineTL = [[0, 15, 1], [1, 15, 1], [2, 14, 2], [3, 13, 3], [4, 12, 4], [5, 14, 2], [6, 13, 3], [7, 12, 4], [8, 11, 5], [9, 10, 6], [10, 12, 4], [11, 11, 5], [12, 10, 6], [13, 9, 7], [14, 8, 8], [15, 7, 9]];
  const pineBL = [[0, 8, 8], [1, 7, 9], [2, 6, 10], [3, 8, 8], [4, 7, 9], [5, 6, 10], [6, 5, 11], [7, 4, 12], [8, 3, 13], [9, 2, 14], [10, 5, 11], [11, 4, 12], [12, 3, 13]];
  const conifer = (rows, trunkSide) => (c, x, y, v) => {
    const r = sr(v);
    const bottom = rows.reduce((m, q) => Math.max(m, q[0]), 0);
    if (bottom < 14) shadowUnder(c, x, y, 12, bottom);
    outline(c, PAL.pineXD, x, y, rows);
    blob(c, PAL.pineD, x, y, rows);
    blob(c, PAL.pine, x, y, rows.map((q) => [q[0], q[1] + 1, Math.max(1, q[2] - 1)]));
    speck(c, PAL.pineL, x, y, 6, r, 16, bottom + 1);
    if (trunkSide === 'L') { R(c, PAL.barkXD, x + 13, y + 13, 3, 3); R(c, PAL.barkD, x + 14, y + 13, 2, 3); }
    if (trunkSide === 'R') { R(c, PAL.barkXD, x, y + 13, 3, 3); R(c, PAL.barkD, x, y + 13, 2, 3); }
  };
  def('PINE_TL', 'Pine', SOLID, { layer: 'over', group: 'tree', biomes: ['pine-forest'], variants: 2 }, conifer(pineTL, null));
  def('PINE_TR', 'Pine', SOLID, { layer: 'over', group: 'tree', biomes: ['pine-forest'], variants: 2 }, conifer(mirror(pineTL), null));
  def('PINE_BL', 'Pine', SOLID, { layer: 'deco', group: 'tree', biomes: ['pine-forest'], variants: 2 }, conifer(pineBL, 'L'));
  def('PINE_BR', 'Pine', SOLID, { layer: 'deco', group: 'tree', biomes: ['pine-forest'], variants: 2 }, conifer(mirror(pineBL), 'R'));

  def('DEAD_TREE', 'Dead Tree', SOLID, { layer: 'deco', group: 'tree', biomes: ['marsh', 'ash-waste', 'ruins', 'tundra'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      contact(c, x, y, 9, 15);
      R(c, PAL.barkXD, x + 6, y + 4, 5, 12);                // trunk keyline
      R(c, PAL.barkD, x + 7, y + 5, 3, 11);
      V(c, '#7a6248', x + 7, y + 5, 11);
      // branches — a 1px shadow on the lower-right of each limb keeps the twigs
      // thin (a full dilation turned them into 3px clubs) while still reading
      // against any ground, since the light is committed to the upper-left
      const branch = (bx, by, dx, len, up) => {
        for (let i = 0; i < len; i++) { const py = by - (up ? i : Math.floor(i / 2)); R(c, PAL.barkXD, bx + dx * i, py, 2, 2); }
        for (let i = 0; i < len; i++) { P(c, PAL.barkD, bx + dx * i, by - (up ? i : Math.floor(i / 2))); if (i % 2 === 0) P(c, '#7a6248', bx + dx * i, by - (up ? i : Math.floor(i / 2)) - 1); }
      };
      branch(x + 7, y + 7, -1, 5, true);
      branch(x + 9, y + 5, 1, 5, true);
      branch(x + 7, y + 11, -1, 4, false);
      if (r() < 0.6) branch(x + 9, y + 10, 1, 3, true);
      P(c, PAL.barkD, x + 2, y + 1); P(c, PAL.barkD, x + 13, y);
    });

  def('STUMP', 'Stump', SOLID, { layer: 'deco', group: 'prop', biomes: ['forest', 'pine-forest', 'plains'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      const rows = [[5, 4, 8], [6, 3, 10], [7, 3, 10], [8, 3, 10], [9, 3, 10], [10, 3, 10], [11, 3, 10], [12, 3, 10], [13, 4, 8]];
      shadowUnder(c, x, y, 11, 13);
      outline(c, PAL.barkXD, x, y, rows);
      blob(c, PAL.bark, x, y, [[6, 4, 8], [7, 3, 10], [8, 3, 10], [9, 3, 10], [10, 3, 10], [11, 3, 10], [12, 3, 10], [13, 4, 8]]);
      blob(c, PAL.woodL, x, y, [[5, 4, 8], [6, 3, 10], [7, 3, 10]]);
      V(c, PAL.barkD, x + 12, y + 8, 5);
      O(c, PAL.barkD, x + 3, y + 5, 10, 4);
      P(c, PAL.woodD, x + 7, y + 6); P(c, PAL.woodD, x + 8, y + 7);
      V(c, PAL.barkD, x + 5, y + 8, 6); V(c, PAL.barkD, x + 10, y + 9, 5);
      if (r() < 0.5) { P(c, PAL.moss, x + 3, y + 10); P(c, PAL.moss, x + 12, y + 11); }
    });

  // BUSH measured ΔE 3.7 against the grass it stood in (body colour) — it read
  // as a hollow ring, because only the `leafD` rim survived. Darker leaf family
  // plus a `leafXD` keyline plus a real shadow, and it becomes a solid mass.
  const BUSH_ROWS = [[4, 5, 6], [5, 3, 10], [6, 2, 12], [7, 1, 14], [8, 1, 14], [9, 1, 14], [10, 2, 12], [11, 3, 10], [12, 4, 8], [13, 5, 6]];
  def('BUSH', 'Bush', SOLID, { layer: 'deco', group: 'plant', biomes: ['forest', 'plains', 'hills'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      shadowUnder(c, x, y, 11, 13);
      outline(c, PAL.leafXD, x, y, BUSH_ROWS);
      blob(c, PAL.leafD, x, y, BUSH_ROWS);
      blob(c, PAL.leaf, x, y, BUSH_ROWS.map((q) => [q[0], q[1] + 1, Math.max(1, q[2] - 2)]));
      blob(c, PAL.leafL, x, y, [[5, 4, 5], [6, 3, 6], [7, 2, 6], [8, 2, 5]]);
      speck(c, PAL.leafH, x + 2, y + 4, 5, r, 10, 5);
      speck(c, PAL.leafD, x + 4, y + 9, 5, r, 10, 4);
    });

  def('BERRY_BUSH', 'Berry Bush', SOLID | TRIGGER, { layer: 'deco', group: 'plant', biomes: ['forest', 'plains'], variants: 3 },
    (c, x, y, v) => {
      const r = sr(v);
      shadowUnder(c, x, y, 11, 13);
      outline(c, PAL.leafXD, x, y, BUSH_ROWS);
      blob(c, PAL.leafD, x, y, BUSH_ROWS);
      blob(c, PAL.leaf, x, y, BUSH_ROWS.map((q) => [q[0], q[1] + 1, Math.max(1, q[2] - 2)]));
      blob(c, PAL.leafL, x, y, [[5, 4, 5], [6, 3, 6], [7, 2, 5]]);
      for (let i = 0; i < 6; i++) {
        const bx = x + 3 + Math.floor(r() * 10), by = y + 5 + Math.floor(r() * 8);
        P(c, '#7d1c2a', bx, by + 1); P(c, '#a8283a', bx, by); P(c, '#d8586a', bx, by - 1);
      }
      speck(c, PAL.leafH, x + 2, y + 4, 4, r, 10, 5);
    });

  // Was the single worst prop in the set: ΔE 3.8 from grass with 52% of its rim
  // invisible, and no contact shadow anywhere. A hedge is a wall of leaves, so
  // it gets what a wall gets — lit crown, shaded face, occlusion at the foot.
  def('HEDGE', 'Hedge', SOLID, { layer: 'deco', group: 'plant', biomes: ['city', 'plains'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    foot(c, x, y, 0, 16, 13, 1.2);                   // the hedge foot is row 13
    R(c, PAL.leafXD, x, y + 1, 16, 13);
    R(c, PAL.leafD, x, y + 2, 15, 12);
    for (let i = 0; i < 15; i++) R(c, PAL.leaf, x + i, y + 3 + (i % 2), 1, 10);
    speck(c, PAL.leafH, x, y + 3, 9, r, 15, 8);
    speck(c, PAL.leafD, x, y + 7, 8, r, 15, 6);
    H(c, PAL.leafL, x, y + 2, 15); H(c, PAL.leafH, x, y + 2, 10);   // clipped crown
    V(c, PAL.leafL, x, y + 3, 10);
    R(c, PAL.leafXD, x, y + 13, 16, 1);                              // sits on the ground
  });

  def('REEDS', 'Reeds', SLOW, { layer: 'deco', group: 'plant', biomes: ['marsh', 'coast'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    foot(c, x, y, 1, 14, 14, 0.6);                   // the mat of shade at the waterline
    for (let i = 0; i < 10; i++) {
      const bx = x + Math.floor(r() * 16), top = y + 2 + Math.floor(r() * 7);
      R(c, PAL.swampL, bx, top, 1, 15 - (top - y));
      P(c, '#86a86a', bx, top);
      if (r() < 0.4) P(c, PAL.grassDry, bx, top + 1);
    }
  });

  def('CATTAILS', 'Cattails', SLOW, { layer: 'deco', group: 'plant', biomes: ['marsh', 'coast'], variants: 3 }, (c, x, y, v) => {
    const r = sr(v);
    foot(c, x, y, 1, 14, 14, 0.6);
    for (let i = 0; i < 6; i++) {
      const bx = x + 1 + Math.floor(r() * 14), top = y + 3 + Math.floor(r() * 5);
      R(c, PAL.swampL, bx, top, 1, 15 - (top - y));
      R(c, '#6b4a2f', bx, top - 3, 1, 3); P(c, '#8a6240', bx, top - 3);
      if (r() < 0.6) { for (let k = 0; k < 4; k++) P(c, PAL.swampD, bx + 1 + k, top + 2 + k); }
    }
  });

  def('CACTUS', 'Cactus', SOLID | DAMAGE, { layer: 'deco', group: 'plant', biomes: ['coast', 'ruins'], variants: 2 }, (c, x, y) => {
    contact(c, x, y, 8, 15);
    const rim = '#152a1c';
    R(c, rim, x + 5, y + 2, 6, 14);                       // keyline hugs the trunk
    R(c, rim, x + 1, y + 4, 5, 6); R(c, rim, x + 9, y + 5, 6, 7);
    R(c, rim, x + 11, y + 5, 4, 7);
    R(c, '#3f7a55', x + 6, y + 3, 4, 13);
    V(c, '#5aa070', x + 6, y + 3, 13); V(c, '#2c5a3d', x + 9, y + 3, 13);
    R(c, '#3f7a55', x + 2, y + 7, 4, 2); R(c, '#3f7a55', x + 2, y + 5, 2, 4);
    R(c, '#3f7a55', x + 10, y + 9, 4, 2); R(c, '#3f7a55', x + 12, y + 6, 2, 5);
    V(c, '#5aa070', x + 2, y + 5, 4); V(c, '#2c5a3d', x + 13, y + 6, 5);
    for (let i = 0; i < 5; i++) { P(c, '#d8e0b0', x + 7, y + 4 + i * 2); P(c, '#d8e0b0', x + 3, y + 6); P(c, '#d8e0b0', x + 12, y + 8); }
    H(c, '#5aa070', x + 6, y + 3, 4);
  });

  def('DRIFTWOOD', 'Driftwood', 0, { layer: 'deco', group: 'prop', biomes: ['coast', 'marsh'], variants: 2 }, (c, x, y, v) => {
    const r = sr(v);
    const oy = 8 + Math.floor(r() * 3);
    shadowUnder(c, x, y, 13, oy + 2);
    R(c, '#26211a', x, y + oy - 1, 16, 5);                // keyline
    R(c, '#a89a86', x + 1, y + oy, 14, 3);
    H(c, '#c8bda8', x + 1, y + oy, 14); H(c, '#7d7364', x + 1, y + oy + 2, 14);
    for (let i = 0; i < 5; i++) P(c, '#7d7364', x + 2 + Math.floor(r() * 12), y + oy + 1);
    P(c, '#a89a86', x + 3, y + oy - 1); P(c, '#a89a86', x + 11, y + oy - 2); P(c, '#a89a86', x + 12, y + oy - 1);
  });

  // Register a light-void backdrop id last so map editors have a "clear" tile.
  def('BLACK', 'Darkness', SOLID, { layer: 'over', biomes: [] }, (c, x, y) => { R(c, '#000000', x, y, 16, 16); });

  // =========================================================================
  // 4.18 ADDITIONS (2026 art pass)
  //
  // Ids are handed out sequentially and hand-authored maps in world/maps.js
  // store raw ids, so everything new goes HERE, after BLACK. Never insert into
  // the middle of the list.
  // =========================================================================

  /**
   * ROAD FRINGE. The single loudest boundary in the game was a road meeting
   * grass: measured "hardness" 8.9 (the seam was nine times more contrasty than
   * anything inside either tile), because a straight blocky cut is the only
   * thing two flat fills can make.
   *
   * These are named DIRT_PATH_N … DIRT_PATH_NW, which is exactly the family
   * naming `autotileEdges()` already resolves (`BASE_${suffix}`) — so a caller
   * that does
   *
   *     const e = autotileEdges(map, x, y, T.DIRT_PATH);
   *     drawTile(ctx, e.tile, px, py, x, y, t);
   *
   * gets an irregular, dithered, grass-invaded verge with no change to the
   * autotiler at all. They stay in the `dirt` group so a path next to plain
   * DIRT is treated as the same material and grows no edge there.
   *
   * `sides` names the edges that face the OTHER material. Each one gets a
   * ragged band: a 3px dither ramp of grass over the path, a scatter of tufts
   * that break the line, and a `pathXD` scuff where wheels have cut the verge.
   */
  /**
   * One verge. `side` is the edge that faces the turf; the depth WANDERS — a
   * running value that steps by a pixel now and then — rather than being random
   * per column, which gives lobes of grass pushing into the bare ground instead
   * of a stippled ruler line. `soil`/`soilD` are the ground being invaded.
   */
  const verge = (c, x, y, r, side, soil, soilD) => {
    // `at(col, d, t)` maps (depth into the tile, distance along the edge)
    const at = (col, d, t, len = 1) => {
      if (side === 'N') mark(c, col, x, y, t, d, len, 1);
      else if (side === 'S') mark(c, col, x, y, t, 15 - d, len, 1);
      else if (side === 'W') mark(c, col, x, y, d, t, 1, len);
      else mark(c, col, x, y, 15 - d, t, 1, len);
    };
    let d0 = 3 + Math.floor(r() * 3);
    for (let t = 0; t < 16; t++) {
      if (r() < 0.38) d0 += (r() < 0.5 ? 1 : -1);
      d0 = Math.max(1, Math.min(7, d0));
      for (let d = 0; d < d0; d++) {
        // turf, textured like the GRASS tile it has to blend into
        const q = r();
        if (d < d0 - 2) at(q < 0.16 ? PAL.grassD : (q < 0.34 ? PAL.grassM : PAL.grass), d, t);
        else if (d === d0 - 2) at(q < 0.55 ? PAL.grassD : soil, d, t);          // 50% dither
        else at(q < 0.3 ? PAL.grassD : soil, d, t);                             // 30% dither
      }
      if (r() < 0.20) at(PAL.grassD, d0 + Math.floor(r() * 2), t);              // a tuft reaching in
      if (r() < 0.12) at(soilD, d0, t);                                         // a scuff
      if (r() < 0.10) at(soil, Math.max(0, d0 - 3), t);                         // bare earth at the kerb
    }
  };

  const pathEdge = (key, sides) => def(key, 'Path', 0, { group: 'dirt', biomes: ['road', 'plains', 'city'], variants: 4 },
    (c, x, y, v) => {
      const r = sr(v);
      // the road surface itself, same recipe as DIRT_PATH
      R(c, PAL.path, x, y, 16, 16);
      for (let i = 0; i < 2; i++) mark(c, PAL.pathW, x, y, Math.floor(r() * 10) - 1, Math.floor(r() * 12) - 1, 5 + Math.floor(r() * 4), 3 + Math.floor(r() * 2));
      speck(c, PAL.pathL, x, y, 5, r);
      speck(c, PAL.pathM, x, y, 9, r);
      speck(c, PAL.pathD, x, y, 5, r);
      for (let i = 0; i < 2; i++) { const px = x + Math.floor(r() * 14), py = y + 1 + Math.floor(r() * 13); R(c, PAL.pebble, px, py, 2, 1); P(c, PAL.pathXD, px + 1, py + 1); }
      for (const s of sides) verge(c, x, y, r, s, PAL.pathD, PAL.pathXD);
      // corners where two verges meet get an extra bite of turf
      if (sides.length > 1) {
        const cx = sides.includes('W') ? 0 : 13, cy = sides.includes('N') ? 0 : 13;
        for (let i = 0; i < 5; i++) mark(c, r() < 0.6 ? PAL.grass : PAL.grassD, x, y, cx + Math.floor(r() * 4), cy + Math.floor(r() * 4), 1 + Math.floor(r() * 2), 1);
      }
    });
  pathEdge('DIRT_PATH_N', ['N']);
  pathEdge('DIRT_PATH_E', ['E']);
  pathEdge('DIRT_PATH_S', ['S']);
  pathEdge('DIRT_PATH_W', ['W']);
  pathEdge('DIRT_PATH_NE', ['N', 'E']);
  pathEdge('DIRT_PATH_SE', ['S', 'E']);
  pathEdge('DIRT_PATH_SW', ['S', 'W']);
  pathEdge('DIRT_PATH_NW', ['N', 'W']);

  /**
   * The same verge for bare DIRT, which measured the second-hardest boundary in
   * the set (ΔE 37.5 at ΔL* 1.2 — maximum hue change, zero value change, which
   * is the definition of a cut-out sticker edge). Named DIRT_N … DIRT_NW so
   * `autotileEdges(map, x, y, T.DIRT)` resolves them with no autotiler change.
   */
  const dirtEdge = (key, sides) => def(key, 'Dirt', 0, { group: 'dirt', biomes: ['plains', 'road', 'ruins'], variants: 4 },
    (c, x, y, v) => {
      const r = sr(v);
      dirtBase(c, x, y, r);
      for (let i = 0; i < 3; i++) R(c, PAL.dirtD, x + Math.floor(r() * 14), y + Math.floor(r() * 15), 2, 2);
      for (const s of sides) verge(c, x, y, r, s, PAL.dirtD, PAL.mudD);
      if (sides.length > 1) {
        const cx = sides.includes('W') ? 0 : 13, cy = sides.includes('N') ? 0 : 13;
        for (let i = 0; i < 5; i++) mark(c, r() < 0.6 ? PAL.grass : PAL.grassD, x, y, cx + Math.floor(r() * 4), cy + Math.floor(r() * 4), 1 + Math.floor(r() * 2), 1);
      }
    });
  dirtEdge('DIRT_N', ['N']);
  dirtEdge('DIRT_E', ['E']);
  dirtEdge('DIRT_S', ['S']);
  dirtEdge('DIRT_W', ['W']);
  dirtEdge('DIRT_NE', ['N', 'E']);
  dirtEdge('DIRT_SE', ['S', 'E']);
  dirtEdge('DIRT_SW', ['S', 'W']);
  dirtEdge('DIRT_NW', ['N', 'W']);

  /** A worn wheel-rutted road centre, for long straight stretches of highway. */
  def('DIRT_PATH_RUT', 'Rutted Road', 0, { group: 'dirt', biomes: ['road', 'plains'], variants: 4 }, (c, x, y, v) => {
    const r = sr(v);
    R(c, PAL.path, x, y, 16, 16);
    for (let i = 0; i < 2; i++) mark(c, PAL.pathW, x, y, inX(r, 6), inY(r, 4), 6, 4);
    // Two wheel ruts running E-W. The bow is a half-sine that is ZERO at both
    // tile edges, so consecutive tiles join up seamlessly however the hash
    // shuffles them — a rut that jumps at every seam is just tile-grid banding
    // wearing a different hat.
    for (const base of [4, 10]) {
      const bow = Math.floor(r() * 3) - 1;
      for (let cx0 = 0; cx0 < 16; cx0++) {
        const ry = base + Math.round(bow * Math.sin(Math.PI * cx0 / 15));
        mark(c, PAL.pathD, x, y, cx0, ry, 1, 1);
        if (r() < 0.45) mark(c, PAL.pathXD, x, y, cx0, ry + 1, 1, 1);
        if (r() < 0.35) mark(c, PAL.pathL, x, y, cx0, ry - 1, 1, 1);
      }
    }
    speck(c, PAL.pathM, x, y, 8, r);
    for (let i = 0; i < 2; i++) { const px = x + inX(r, 2), py = y + inY(r, 2); R(c, PAL.pebble, px, py, 2, 1); P(c, PAL.pathXD, px + 1, py + 1); }
    seam(c, x, y, SEAM.rut, SEAM_TONE.path, 8, 3, 3);
  });

  /**
   * A standalone prop shadow, for anything the game drops on the ground that
   * does not paint its own (spawned pickups, editor placements). Deco layer,
   * no flags, drawn under whatever sits on it.
   */
  def('PROP_SHADOW', 'Shadow', 0, { layer: 'deco', group: 'prop', biomes: [], variants: 1 }, (c, x, y) => {
    contact(c, x, y, 12, 12, 0);
  });

  /**
   * ROOF_SHADOW / WALL_TOP_* — the pieces a building needs to stop reading as a
   * sticker. ROOF_SHADOW is the strip of ground a roof overhangs (put it on the
   * row below the eave); WALL_TOP_LIT and WALL_TOP_SHADE are the crown of a
   * wall seen from above with a committed upper-left light.
   */
  def('ROOF_SHADOW', 'Eave Shadow', 0, { layer: 'deco', group: 'roof', biomes: ['city'], variants: 1 }, (c, x, y) => {
    c.fillStyle = 'rgba(14,10,8,0.42)'; c.fillRect(x, y, 16, 3);
    c.fillStyle = 'rgba(14,10,8,0.24)'; c.fillRect(x, y + 3, 16, 2);
    c.fillStyle = 'rgba(14,10,8,0.10)'; c.fillRect(x, y + 5, 16, 1);
  });

  def('WALL_TOP_LIT', 'Wall Crown', SOLID, { layer: 'deco', group: 'wall', biomes: ['city', 'ruins', 'dungeon'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.stoneL, x, y, 16, 16);
      for (let row = 0; row < 4; row++) { H(c, PAL.stoneD, x, y + row * 4 + 3, 16); V(c, PAL.stoneD, x + ((row % 2) ? 5 : 11), y + row * 4, 3); }
      speck(c, PAL.stoneH, x, y, 5, r);
      R(c, PAL.stoneH, x, y, 16, 2); V(c, PAL.stoneH, x, y, 16);
      V(c, PAL.stoneD, x + 15, y, 16); R(c, PAL.stoneXD, x, y + 14, 16, 2);
    });

  def('WALL_TOP_SHADE', 'Wall Crown', SOLID, { layer: 'deco', group: 'wall', biomes: ['city', 'ruins', 'dungeon'], variants: 2 },
    (c, x, y, v) => {
      const r = sr(v);
      R(c, PAL.stone, x, y, 16, 16);
      for (let row = 0; row < 4; row++) { H(c, PAL.stoneD, x, y + row * 4 + 3, 16); V(c, PAL.stoneD, x + ((row % 2) ? 5 : 11), y + row * 4, 3); }
      speck(c, PAL.stoneD, x, y, 5, r);
      H(c, PAL.stoneM, x, y, 16); V(c, PAL.stoneM, x, y, 16);
      V(c, PAL.stoneXD, x + 15, y, 16); R(c, PAL.stoneXD, x, y + 14, 16, 2);
    });

  // -------------------------------------------------------------------------
  // APPEND-ONLY ZONE. `def` hands out ids in call order and every authored map
  // stores raw ids, so nothing may be inserted above this line — only added
  // below it.
  // -------------------------------------------------------------------------

  /**
   * QUAY_N .. QUAY_NW — the waterline where it meets MASONRY.
   *
   * Identical geometry to SHORE_* (same suffix meaning: the named sides are the
   * ones the water does NOT continue into), same shared-edge joins, but the
   * margin is a soaked, algae-darkened kerb instead of silt, and it barely
   * wanders: a harbour wall is built, so it should be straight, where a river
   * bank should not. Use these where the water meets COBBLE, FLAGSTONE, STONE
   * or a building; use SHORE_* everywhere else.
   */
  shoreFamily('QUAY', 'Quayside', QUAY_BANK, 5, 1.4);

  // -------------------------------------------------------------------------
  // 4.20 LONE PATCHES — the _ISLE set. See section 2b for what these are and
  // why a four-sided nibble was not the answer.
  //
  // Each one paints the ground its islands ACTUALLY sit in — counted over the
  // ground plane of all 17 maps, not guessed — and then a blob of its own
  // material on top. The counts and surrounds are quoted per tile below.
  // -------------------------------------------------------------------------

  /**
   * Tone pools for the patch bodies. Core = the solid middle, E = the stipple
   * ramp. The two are kept CLOSE: the edge pool is the same material a shade
   * thinner, not a dark outline. A patch is only nine or ten pixels across, so
   * a fringe drawn two value steps down does not read as an edge — it reads as
   * the whole patch being darker than the material it is supposed to be.
   */
  const IT = {
    snow: [PAL.snow, PAL.snow, PAL.snow, PAL.snowD, PAL.snow, PAL.snowD],
    snowE: [PAL.snow, PAL.snow, PAL.snowD, PAL.snow, PAL.snowD, PAL.snowS],
    dirt: [PAL.dirt, PAL.dirtM, PAL.dirt, PAL.dirtD, PAL.dirtM, PAL.dirt],
    dirtE: [PAL.dirt, PAL.dirtM, PAL.dirt, PAL.dirtD, PAL.dirt, PAL.dirtM],
    // weighted toward the mid tones: the GRAVEL tile is `scree` under fourteen
    // paler chips, so a pool of raw `scree` would make the patch a full value
    // step darker than the material it is meant to be
    scree: [PAL.screeM, PAL.scree, PAL.screeM, PAL.screeL, PAL.scree, PAL.screeM],
    screeE: [PAL.screeM, PAL.scree, PAL.screeM, PAL.screeD, PAL.scree, PAL.screeM],
    cobble: [PAL.cobble, PAL.cobbleD, PAL.cobble, PAL.cobbleL, PAL.cobbleD, PAL.cobble],
    cobbleE: [PAL.cobbleD, PAL.cobble, PAL.cobbleD, PAL.cobbleD, PAL.cobble, PAL.cobbleD],
    path: [PAL.path, PAL.pathM, PAL.path, PAL.pathW, PAL.pathM, PAL.path],
    pathE: [PAL.path, PAL.pathM, PAL.path, PAL.pathD, PAL.pathM, PAL.path],
  };
  /** A patch coordinate: inboard, so a mark cannot escape the blob's own box. */
  const ip = (r) => 2 + Math.floor(r() * 12);

  /**
   * SNOW_GRASS_ISLE — 125 tiles in Neverwinter Wood, the worst ground in the
   * game before this. 470 of their 491 cardinal neighbours are GRASS, GRASS_2,
   * GRASS_3, GRASS_TALL or CLOVER (the rest are 11 WATER, 6 DIRT_PATH, 2
   * BRIDGE_WOOD, 1 DIRT), so the surround is grass, unambiguously.
   */
  def('SNOW_GRASS_ISLE', 'Snow Patch', 0, { group: 'snow', biomes: [], variants: 16 }, (c, x, y, v) => {
    const r = sr(v);
    grassBase(c, x, y, r);
    isleMask(r, 5.1, 1.0);
    isleFill(c, x, y, IT.snow, IT.snowE);
    isleRim(c, x, y, PAL.snowS, PAL.snow);
    // blades still standing out of a shallow drift, and wind-packed ripples
    for (let i = 0; i < 6; i++) isleMark(c, PAL.grassD, x, y, ip(r), ip(r), 1, 1 + Math.floor(r() * 2));
    for (let i = 0; i < 3; i++) isleMark(c, PAL.snowD, x, y, ip(r), ip(r), 2 + Math.floor(r() * 2), 1);
  });

  /**
   * DIRT_ISLE — 62 tiles: 9 on the Triboar Trail (the "tan rectangles in
   * grass") and 52 in Conyberry. 156 of Conyberry's 192 neighbours are grass of
   * some kind and 28 are COBBLE; Triboar's 36 are all grass. Surround: grass.
   */
  def('DIRT_ISLE', 'Bare Patch', 0, { group: 'dirt', biomes: [], variants: 16 }, (c, x, y, v) => {
    const r = sr(v);
    grassBase(c, x, y, r);
    isleMask(r, 5.0, 1.1);
    isleFill(c, x, y, IT.dirt, IT.dirtE);
    isleRim(c, x, y, PAL.dirtD, PAL.dirtL);
    // a clod or two, the same crown-and-shadow the DIRT tile is made of
    for (let i = 0; i < 3; i++) {
      const w = 2 + Math.floor(r() * 2), cx = ip(r), cy = ip(r);
      isleMark(c, PAL.dirtM, x, y, cx, cy, w, 1);
      isleMark(c, PAL.dirtL, x, y, cx, cy, w - 1, 1);
      isleMark(c, PAL.dirtD, x, y, cx + 1, cy + 1, w, 1);
    }
    for (let i = 0; i < 3; i++) isleMark(c, PAL.grassD, x, y, ip(r), ip(r), 1, 1);  // turf hanging on
  });

  /**
   * GRAVEL_ISLE — 16 tiles: 12 in Conyberry, 4 at the mouth of Wave Echo Cave.
   * Every one of their 55 neighbours is grass. A scree spill, then: chippings
   * that have spread into the turf, not a grey square.
   */
  def('GRAVEL_ISLE', 'Scree Patch', SLOW, { group: 'dirt', biomes: [], variants: 16 }, (c, x, y, v) => {
    const r = sr(v);
    grassBase(c, x, y, r);
    isleMask(r, 4.9, 1.1);
    isleFill(c, x, y, IT.scree, IT.screeE);
    isleRim(c, x, y, PAL.screeD, PAL.screeL);
    // chips: a 2x1 stone with a lit crown and the pixel of shade it casts
    for (let i = 0; i < 6; i++) {
      const px = ip(r), py = ip(r);
      isleMark(c, r() < 0.35 ? PAL.screeL : PAL.screeM, x, y, px, py, 2, 1);
      if (r() < 0.4) isleMark(c, PAL.pebble, x, y, px, py, 1, 1);
      isleMark(c, PAL.screeD, x, y, px + 1, py + 1, 1, 1);
    }
  });

  /**
   * COBBLE_ISLE — 11 tiles, 10 of them in the Conyberry ruins. 27 of their 43
   * neighbours are DIRT (7 RUBBLE, 3 DIRT_PATH, 2 GRAVEL, 4 grass), so the
   * surround is bare earth: a surviving scrap of the old street, swallowed by
   * the ground around it.
   */
  def('COBBLE_ISLE', 'Broken Paving', 0, { group: 'road', biomes: [], variants: 16 }, (c, x, y, v) => {
    const r = sr(v);
    dirtBase(c, x, y, r);
    isleMask(r, 5.0, 1.0);
    isleFill(c, x, y, IT.cobbleE, IT.cobbleE);          // the mortar bed first
    // three or four whole stones still seated in it
    for (let i = 0; i < 4; i++) {
      const w = 2 + Math.floor(r() * 2), px = ip(r), py = ip(r);
      isleMark(c, r() < 0.3 ? PAL.cobbleL : PAL.cobble, x, y, px, py, w, 2);
      if (r() < 0.4) isleMark(c, PAL.cobbleH, x, y, px, py, w - 1, 1);
      isleMark(c, PAL.cobbleD, x, y, px + w - 1, py + 2, 1, 1);
    }
    isleRim(c, x, y, PAL.cobbleD, null);
    for (let i = 0; i < 3; i++) isleMark(c, PAL.dirtD, x, y, ip(r), ip(r), 1, 1);   // soil in the joints
  });

  /**
   * PATH_ISLE — 57 tiles, every one of them in Neverwinter, and every one of
   * their 220 neighbours paved: 118 COBBLE, 98 FLAGSTONE, 3 MOSAIC, 1 WATER.
   * So the surround is the street, and the patch is what a lone DIRT_PATH tile
   * in a paved ward has to be: a pothole where the paving has gone and the
   * earth under it is showing.
   *
   * The backing is COBBLE and not FLAGSTONE because cobble's lattice is
   * 16-PERIODIC and its seam-crossing stones come from the family-fixed
   * generator, so this tile continues the paving of an adjoining cobble exactly;
   * against a flagstone neighbour it is a cobble-beside-flagstone join, which
   * this map already has hundreds of (they share the `road` group and are mixed
   * freely) and which is 1.3 dL* — against the 5.6 dL* of the bare path square
   * it replaces.
   */
  def('PATH_ISLE', 'Worn Paving', 0, { group: 'dirt', biomes: [], variants: 16 }, (c, x, y, v) => {
    const r = sr(v);
    cobbleBase(c, x, y, r);
    isleMask(r, 4.8, 1.1);
    isleFill(c, x, y, IT.path, IT.pathE);
    isleRim(c, x, y, PAL.pathD, PAL.pathW);
    for (let i = 0; i < 3; i++) {                       // stones knocked loose into it
      const px = ip(r), py = ip(r);
      isleMark(c, PAL.pebble, x, y, px, py, 2, 1);
      isleMark(c, PAL.pathXD, x, y, px + 1, py + 1, 1, 1);
    }
  });
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

/**
 * THE SHARED-EDGE VARIANT. A coastline has to leave one tile at exactly the
 * height it enters the next or it steps at every 16px border — which is what
 * the audit measured on the two maps that have water (22.25% and 28.08% of the
 * waterline's edge changes landing on a tile border, against a 6.25% floor).
 * A tile cannot look at its neighbour: its raster is cached by
 * (id, variant, frame) precisely so it is drawn once and blitted thereafter.
 *
 * So the tile hashes THE BORDER instead of itself. Its left border is the
 * coordinate (wx, wy) and its right border is (wx+1, wy) — and the tile to its
 * right calls its own left border (wx+1, wy), the same coordinate, and gets the
 * same bit. Four bits, one per side, packed into the variant index: any two
 * neighbours are then guaranteed to agree about the edge they share, with no
 * neighbour lookup at draw time and no extra rasters beyond the 16 the tile
 * declares. Bit 0 = left, 1 = right, 2 = top, 3 = bottom.
 */
const EDGE_SALT = 0x5b0e77;
export function edgeVariantAt(wx, wy) {
  return (tileHash(wx, wy, EDGE_SALT) & 1)
    | ((tileHash(wx + 1, wy, EDGE_SALT) & 1) << 1)
    | ((tileHash(wx, wy, EDGE_SALT + 1) & 1) << 2)
    | ((tileHash(wx, wy + 1, EDGE_SALT + 1) & 1) << 3);
}

/** Which variant of `id` sits at (wx, wy)? */
export function variantAt(id, wx, wy) {
  const d = TILES[id];
  if (!d || d.variants <= 1) return 0;
  if (d.edgeVariant) return edgeVariantAt(wx, wy) % d.variants;
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
    // 4th arg: the speckle seed. 5th: the RESOLVED VARIANT INDEX — a shore tile
    // needs the four shared-border bits back out of it, and a hashed seed has
    // thrown them away by then.
    try { d.draw(cx, 0, 0, seed, variant, frame); }
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
  const variant = d.variants > 1 ? (d.edgeVariant ? (edgeVariantAt(wx, wy) % d.variants) : (tileHash(wx, wy, id) % d.variants)) : 0;
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

/**
 * THE FINER MATERIAL KEY.
 *
 * `group` is what the AUTOTILER needs: it answers "does an edge have to be
 * drawn here", and for that GRAVEL, DIRT, DIRT_PATH, MUD and FARMLAND being one
 * `dirt` family is right — a road cut into bare earth should not grow a
 * coastline where it meets the soil it is cut into.
 *
 * It is the wrong question for the FRINGE. Measured in situ, the five members of
 * the `dirt` group meet each other 1,623 times across the maps, autotileEdges()
 * reports no edge at any of them, and so every one of those joins is a
 * ruler-straight 16px cut between two visibly different surfaces. GRAVEL against
 * DIRT alone is 809 of them at a grid-visibility ratio of 3.03 — harder than the
 * 2.69 that was the worst number in the whole original audit — carrying up to
 * 16.2 dE76 and 12.7 dL*. On the Triboar Trail that is dark rectangles scattered
 * through the road; at the mouth of Wave Echo Cave it is a chequerboard of tan
 * and grey squares sitting a few pixels from a grass boundary that now looks
 * excellent, which makes it read WORSE than it did before the boundary was
 * fixed.
 *
 * So: one key per visually distinct MATERIAL, which is what the verge has to
 * decide on. Everything with no finer distinction falls through to its group, so
 * the call is always safe and a caller can use it everywhere `group` was used.
 *
 *   gravel | dirt | path | mud | farmland      (were all 'dirt')
 *   snow | snow-grass                          (were both 'snow')
 *   cobble | flagstone                         (were both 'road')
 *   …and every other group, unchanged.
 *
 * Counted over the ground plane of every map, that splits exactly 1,623 joins
 * inside the `dirt` group (path 696, gravel 665, gravel|path 140, mud|path 62,
 * dirt|mud 41, farmland|path 15, gravel|mud 4) and 1,601 inside `road`.
 *
 * Grass is deliberately NOT split. GRASS/_2/_3/_4, the flowers, CLOVER and
 * GRASS_TALL are one sward at one value; splitting them would ask the fringe to
 * verge several thousand joins that read as texture variation, not as a material
 * change, which is a different (and unasked-for) piece of work.
 *
 * TWO THINGS A CALLER SWAPPING `tileGroup` FOR THIS MUST CARRY OVER.
 *
 *   1. Any rule that says "two BUILT surfaces never verge into one another" was
 *      written against the group names `road` and `floor`. `cobble` and
 *      `flagstone` are not in that set, so such a rule silently switches itself
 *      off — and 1,601 cobble|flagstone joins, which are 1.3 dL* apart and were
 *      never a defect, would start growing verges. Add both names to it.
 *   2. "Has no cardinal neighbour of my own kind" is a DIFFERENT question asked
 *      of the two keys, and the two answers mean different things. See
 *      `isleTileFor` — that distinction is load-bearing.
 */
const SUBGROUP_OF = {
  GRAVEL: 'gravel', GRAVEL_ISLE: 'gravel',
  DIRT: 'dirt', DIRT_ISLE: 'dirt',
  DIRT_PATH: 'path', DIRT_PATH_RUT: 'path', PATH_ISLE: 'path',
  MUD: 'mud',
  FARMLAND: 'farmland',
  SNOW_GRASS: 'snow-grass', SNOW_GRASS_ISLE: 'snow-grass',
  COBBLE: 'cobble', COBBLE_ISLE: 'cobble',
  FLAGSTONE: 'flagstone',
};
/** id -> resolved subgroup. Memoised: the fringe mask asks this per tile per map. */
const SUBGROUP = [];
/** Strip the eight autotile suffixes: DIRT_PATH_NW is still `path`. */
const FAMILY_SUFFIX = /_(N|E|S|W|NE|SE|SW|NW)$/;

export function tileSubgroup(id) {
  const d = TILES[id];
  if (!d) return null;
  const memo = SUBGROUP[id];
  if (memo !== undefined) return memo;
  const key = SUBGROUP_OF[d.key] || SUBGROUP_OF[d.key.replace(FAMILY_SUFFIX, '')];
  return (SUBGROUP[id] = key || d.group);
}

/**
 * THE PATCH TILE FOR A LONE ONE OF THESE, or 0 when there is no art for it.
 *
 * See section 2b. A tile with no cardinal neighbour of its own material cannot
 * be verged — four verges eat 42-62% of it — so it is drawn as a PATCH instead:
 * the surrounding family's ground straight across the tile with a soft,
 * hash-varied blob of this material sitting on it, clear of the border.
 *
 * The surround is baked into the art, because a raster cached by
 * (id, variant, frame) cannot look at a neighbour. It is not guessed: the ground
 * plane of every map was walked and the actual neighbours of every island
 * counted (tools/px/maps.mjs). Islands, and the ground they sit in:
 *
 *   SNOW_GRASS  125  Neverwinter Wood     96% grass          -> grass surround
 *   DIRT         62  Conyberry, Triboar   85% grass          -> grass surround
 *   DIRT_PATH    57  Neverwinter         100% paved          -> cobble surround
 *   GRAVEL       16  Conyberry, Wave Echo 100% grass         -> grass surround
 *   COBBLE       11  Conyberry             63% dirt          -> dirt surround
 *
 * A material whose islands are split across two unrelated surrounds gets no
 * entry here rather than a wrong one: 0 means "leave it as it is", which is what
 * this function returns for everything not listed.
 *
 * ============ WHICH "ISLAND" TEST, AND WHY IT MATTERS A LOT ============
 *
 * Those five counts are tiles with no cardinal neighbour of the same GROUP. Ask
 * the same question of `tileSubgroup` and the answer is 263 / 95 / 125 / 144 /
 * 57 — because a DIRT tile whose four neighbours are GRAVEL and DIRT_PATH has no
 * neighbour of its own SUBGROUP either. Those ~330 extra tiles are not islands
 * in any sense that matters here: they are in the middle of a road, and they are
 * precisely the 1,623 joins `tileSubgroup` exists to get VERGED. Painting a
 * patch there would put a disc of grass in the middle of the Triboar Trail.
 *
 *   A subgroup mismatch against a group NEIGHBOUR is a join -> verge it.
 *   No group neighbour at all is an island                  -> patch it.
 *
 * So the one-argument call is only safe on a tile with no same-GROUP cardinal
 * neighbour. If your island test is the subgroup one, pass a neighbour as
 * `under` (a tile id, or a subgroup string) and this returns 0 whenever that
 * neighbour is not the ground the patch is actually painted on — which is the
 * safe answer, because 0 means "do what you did before".
 */
/** key -> [patch tile, …the surround subgroups its art is painted to sit in]. */
const ISLE_OF = {
  SNOW_GRASS: ['SNOW_GRASS_ISLE', 'grass'],
  DIRT: ['DIRT_ISLE', 'grass'],
  GRAVEL: ['GRAVEL_ISLE', 'grass'],
  // dirt and path are the same brown earth 4.5 L* apart; gravel (-8 L*) is not
  COBBLE: ['COBBLE_ISLE', 'dirt', 'path'],
  // the two pavings are 1.3 L* apart and are already mixed freely on every
  // street in the game, so a cobble-backed patch is at home in both
  DIRT_PATH: ['PATH_ISLE', 'cobble', 'flagstone'],
};
const ISLE_ID = [];

export function isleTileFor(id, under) {
  const d = TILES[id];
  if (!d) return 0;
  let e = ISLE_ID[id];
  if (e === undefined) {
    const spec = ISLE_OF[d.key] || ISLE_OF[d.key.replace(FAMILY_SUFFIX, '')];
    e = ISLE_ID[id] = (spec && T[spec[0]] != null) ? [T[spec[0]]].concat(spec.slice(1)) : 0;
  }
  if (!e) return 0;
  if (under === undefined || under === null) return e[0];
  // 'grass' covers GRASS/_2/_3/_4, the flowers, CLOVER and GRASS_TALL, which is
  // what the grass-backed patches are drawn to sit in.
  const g = typeof under === 'number' ? tileSubgroup(under) : under;
  for (let i = 1; i < e.length; i++) if (e[i] === g) return e[0];
  return 0;
}
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
      // the road fringe: an autotiled road touches all eight of these at once,
      // so warming only DIRT_PATH would still stutter on the first road tile
      'DIRT_PATH_N', 'DIRT_PATH_E', 'DIRT_PATH_S', 'DIRT_PATH_W',
      'DIRT_PATH_NE', 'DIRT_PATH_SE', 'DIRT_PATH_SW', 'DIRT_PATH_NW', 'DIRT_PATH_RUT',
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
