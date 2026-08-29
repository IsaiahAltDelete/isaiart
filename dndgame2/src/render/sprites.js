// render/sprites.js — the procedural pixel-sprite engine.
//
// Sprites are authored as arrays of equal-length strings; each character is a
// palette key, '.' and ' ' are transparent. A palette value that is an
// UPPERCASE_TOKEN is resolved per-character from a "colorway", which is how one
// 16x24 adventurer sprite becomes a thousand different-looking heroes.
//
// Everything is rasterised once into an offscreen canvas and memoised, so the
// per-frame cost is a single drawImage.

import { hashStr } from '../core/rng.js';

const sprites = new Map();     // name -> { w, h, frames, palette, anims }
const cache = new Map();       // cacheKey -> HTMLCanvasElement
const CACHE_LIMIT = 1400;

// --- colour helpers -------------------------------------------------------

/** '#rgb' or '#rrggbb' -> {r,g,b} */
export function hexToRgb(hex) {
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. amt is -1..1. */
export function shadeHex(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  if (amt >= 0) return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  const k = 1 + amt;
  return rgbToHex(r * k, g * k, b * k);
}

/** Blend two hex colours. t=0 -> a, t=1 -> b. */
export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

/** Rotate a colour toward a hue while keeping its luminance — used for tints. */
export function tintHex(hex, tint, amt) {
  return mixHex(hex, tint, amt);
}

/** Perceived brightness 0..1, for picking readable outline colours. */
export function luma(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// --- colorways ------------------------------------------------------------

/** The full token set a sprite palette may reference. */
export const COLOR_TOKENS = [
  'SKIN', 'SKIN_D', 'SKIN_L', 'HAIR', 'HAIR_D', 'HAIR_L', 'EYE',
  'MAIN', 'MAIN_D', 'MAIN_L', 'ALT', 'ALT_D', 'ALT_L',
  'METAL', 'METAL_D', 'METAL_L', 'TRIM', 'TRIM_D',
  'LEATHER', 'LEATHER_D', 'CLOTH', 'CLOTH_D', 'ACCENT', 'ACCENT_D',
  'OUTLINE', 'SHADOW', 'HORN', 'HORN_D', 'WHITE', 'BLACK',
];

const COLORWAY_DEFAULTS = {
  skin: '#e0a878', hair: '#3a2416', eye: '#37527a',
  main: '#7a3030', alt: '#2f4f7f', metal: '#aab2c0',
  leather: '#6b4a2a', cloth: '#c8b58a', accent: '#e3b34a',
  horn: '#8c8377', outline: '#170f0c',
};

/**
 * Build a token map from a small, human-friendly appearance object.
 * Derived shades keep everything harmonious without the author picking 20 colours.
 */
export function makeColorway(seedObj = {}) {
  const c = { ...COLORWAY_DEFAULTS, ...seedObj };
  return {
    SKIN: c.skin, SKIN_D: shadeHex(c.skin, -0.26), SKIN_L: shadeHex(c.skin, 0.20),
    HAIR: c.hair, HAIR_D: shadeHex(c.hair, -0.32), HAIR_L: shadeHex(c.hair, 0.24),
    EYE: c.eye,
    MAIN: c.main, MAIN_D: shadeHex(c.main, -0.30), MAIN_L: shadeHex(c.main, 0.22),
    ALT: c.alt, ALT_D: shadeHex(c.alt, -0.30), ALT_L: shadeHex(c.alt, 0.22),
    METAL: c.metal, METAL_D: shadeHex(c.metal, -0.34), METAL_L: shadeHex(c.metal, 0.30),
    TRIM: c.accent, TRIM_D: shadeHex(c.accent, -0.30),
    LEATHER: c.leather, LEATHER_D: shadeHex(c.leather, -0.30),
    CLOTH: c.cloth, CLOTH_D: shadeHex(c.cloth, -0.28),
    ACCENT: c.accent, ACCENT_D: shadeHex(c.accent, -0.30),
    HORN: c.horn, HORN_D: shadeHex(c.horn, -0.30),
    OUTLINE: c.outline, SHADOW: 'rgba(0,0,0,0.35)',
    WHITE: '#f4ece0', BLACK: '#120c0a',
  };
}

/** A stable short signature for a colorway, used as part of the cache key. */
function colorwayKey(cw) {
  if (!cw) return '0';
  if (cw.__key) return cw.__key;
  let s = '';
  for (const t of COLOR_TOKENS) if (cw[t]) s += cw[t];
  const k = hashStr(s).toString(36);
  try { Object.defineProperty(cw, '__key', { value: k, enumerable: false }); } catch { /* frozen */ }
  return k;
}

// --- definition -----------------------------------------------------------

/**
 * Register a sprite.
 *   defineSprite('villager', {
 *     w:16, h:24,
 *     palette: { K:'OUTLINE', s:'SKIN', d:'SKIN_D', h:'HAIR', a:'MAIN', b:'ALT' },
 *     frames: { 'down-0':[ '....KKKK....', ... ], ... },
 *     anims: { walkDown:{ frames:['down-0','down-1','down-0','down-2'], fps:8 } }
 *   })
 * Rows shorter than `w` are padded with transparency, so authoring is forgiving.
 */
export function defineSprite(name, def) {
  const frames = {};
  for (const [fname, rows] of Object.entries(def.frames || {})) {
    frames[fname] = normalizeRows(rows, def.w, def.h);
  }
  sprites.set(name, {
    name,
    w: def.w, h: def.h,
    palette: def.palette || {},
    frames,
    anims: def.anims || {},
    anchor: def.anchor || { x: Math.floor(def.w / 2), y: def.h },  // feet-centre
    outline: def.outline !== false,
  });
  return name;
}

function normalizeRows(rows, w, h) {
  const out = [];
  for (let y = 0; y < h; y++) {
    let r = rows[y] != null ? String(rows[y]) : '';
    if (r.length < w) r = r + '.'.repeat(w - r.length);
    else if (r.length > w) r = r.slice(0, w);
    out.push(r);
  }
  return out;
}

/** Alias one sprite name to another (e.g. 'wolf-dire' -> 'wolf'). */
export function aliasSprite(alias, target) {
  const t = sprites.get(target);
  if (t) sprites.set(alias, { ...t, name: alias });
  return alias;
}

/** Register many at once. */
export function defineSprites(map) { for (const [n, d] of Object.entries(map)) defineSprite(n, d); }

export function hasSprite(name) { return sprites.has(name); }
export function spriteDef(name) { return sprites.get(name) || null; }
export function spriteFrames(name) { const d = sprites.get(name); return d ? Object.keys(d.frames) : []; }
export function spriteSize(name) { const d = sprites.get(name); return d ? { w: d.w, h: d.h } : { w: 16, h: 16 }; }
export function allSpriteNames() { return Array.from(sprites.keys()); }

// --- rasterisation --------------------------------------------------------

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return c;
}

/** Resolve a palette entry: hex passes through, TOKEN looks up the colorway. */
function resolveColor(v, cw) {
  if (!v) return null;
  if (v[0] === '#' || v.startsWith('rgb')) return v;
  if (cw && cw[v]) return cw[v];
  return DEFAULT_COLORWAY[v] || null;
}

const DEFAULT_COLORWAY = makeColorway();

/**
 * Get (and cache) a rendered frame.
 * Returns an HTMLCanvasElement of exactly (w x h) logical pixels.
 */
export function getSprite(name, frame, colorway = null) {
  const def = sprites.get(name);
  if (!def) return null;
  const rows = def.frames[frame] || def.frames[Object.keys(def.frames)[0]];
  if (!rows) return null;

  const ck = `${name}|${frame}|${colorwayKey(colorway)}`;
  let c = cache.get(ck);
  if (c) return c;

  c = makeCanvas(def.w, def.h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(def.w, def.h);
  const data = img.data;

  // Pre-resolve the palette to RGBA once per frame render.
  const lut = {};
  for (const [ch, val] of Object.entries(def.palette)) {
    const hex = resolveColor(val, colorway);
    if (!hex) continue;
    if (hex.startsWith('rgba')) {
      const m = hex.match(/rgba?\(([^)]+)\)/);
      const p = m[1].split(',').map((s) => parseFloat(s));
      lut[ch] = [p[0] | 0, p[1] | 0, p[2] | 0, Math.round((p[3] ?? 1) * 255)];
    } else {
      const { r, g, b } = hexToRgb(hex);
      lut[ch] = [r, g, b, 255];
    }
  }

  for (let y = 0; y < def.h; y++) {
    const row = rows[y];
    for (let x = 0; x < def.w; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ' || ch === undefined) continue;
      const col = lut[ch];
      if (!col) continue;
      const i = (y * def.w + x) * 4;
      data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; data[i + 3] = col[3];
    }
  }
  ctx.putImageData(img, 0, 0);

  if (cache.size > CACHE_LIMIT) {
    // Cheap eviction: drop the oldest quarter.
    const keys = Array.from(cache.keys()).slice(0, Math.floor(CACHE_LIMIT / 4));
    for (const k of keys) cache.delete(k);
  }
  cache.set(ck, c);
  return c;
}

// --- tinting --------------------------------------------------------------

const tintCache = new Map();

/** A copy of a sprite frame washed toward `tint` (hit flashes, poison, petrify). */
function getTinted(src, tint, amt, ck) {
  const key = `${ck}|t${tint}|${amt.toFixed(2)}`;
  let c = tintCache.get(key);
  if (c) return c;
  c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = amt;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (tintCache.size > 400) tintCache.clear();
  tintCache.set(key, c);
  return c;
}

/** A pure silhouette of a frame — used for spell targeting glows and stealth. */
export function getSilhouette(name, frame, color = '#ffffff', colorway = null) {
  const src = getSprite(name, frame, colorway);
  if (!src) return null;
  return getTinted(src, color, 1, `${name}|${frame}|${colorwayKey(colorway)}|sil`);
}

// --- drawing --------------------------------------------------------------

/**
 * Draw a sprite frame with its FEET at (x, y) — i.e. (x,y) is the bottom-centre
 * anchor, which is what tile-walking wants.
 * opts: { flip, scale=1, alpha=1, tint, tintAmt=0.6, shadow, anchor:'feet'|'topleft',
 *         rotate, bob, outline }
 */
export function drawSprite(ctx, name, frame, x, y, opts = {}) {
  const def = sprites.get(name);
  if (!def) return false;
  const cw = opts.colorway || null;
  let img = getSprite(name, frame, cw);
  if (!img) return false;

  const scale = opts.scale || 1;
  const w = def.w * scale, h = def.h * scale;
  const anchorFeet = opts.anchor !== 'topleft';
  let dx = anchorFeet ? Math.round(x - w / 2) : Math.round(x);
  let dy = anchorFeet ? Math.round(y - h) : Math.round(y);
  if (opts.bob) dy += Math.round(opts.bob);

  ctx.save();
  if (opts.alpha != null && opts.alpha < 1) ctx.globalAlpha = opts.alpha;

  if (opts.shadow) {
    const sw = w * 0.62, sh = Math.max(2, h * 0.10);
    ctx.globalAlpha = (opts.alpha ?? 1) * (opts.shadow === true ? 0.32 : opts.shadow);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(Math.round(x), Math.round(anchorFeet ? y - 1 : y + h - 1), sw / 2, sh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = opts.alpha ?? 1;
  }

  if (opts.tint && (opts.tintAmt ?? 0.6) > 0) {
    img = getTinted(img, opts.tint, opts.tintAmt ?? 0.6, `${name}|${frame}|${colorwayKey(cw)}`);
  }

  if (opts.rotate) {
    ctx.translate(dx + w / 2, dy + h / 2);
    ctx.rotate(opts.rotate);
    ctx.translate(-w / 2, -h / 2);
    dx = 0; dy = 0;
  }

  if (opts.flip) {
    ctx.translate(dx + w, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, def.w, def.h, 0, 0, w, h);
  } else {
    ctx.drawImage(img, 0, 0, def.w, def.h, dx, dy, w, h);
  }
  ctx.restore();
  return true;
}

/** Draw with the top-left at (x,y) — for menus, portraits, item icons. */
export function drawSpriteAt(ctx, name, frame, x, y, opts = {}) {
  return drawSprite(ctx, name, frame, x, y, { ...opts, anchor: 'topleft' });
}

// --- layered actors -------------------------------------------------------

/**
 * Compose several sprite layers into one cached canvas.
 * This is how a character is built: body -> head/hair -> outfit -> armour ->
 * cloak -> weapon, each recoloured from the same colorway.
 *
 *   layers: [{ name, frame, colorway?, dx?, dy?, flip?, alpha? }]
 *   sig:    a stable string identifying this exact combination (appearance +
 *           equipment + frame). Composition happens once per unique sig.
 */
export function composeSprite(sig, w, h, layers) {
  const ck = `~c|${sig}`;
  let c = cache.get(ck);
  if (c) return c;

  c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (const L of layers) {
    if (!L || !L.name) continue;
    const def = sprites.get(L.name);
    if (!def) continue;
    const img = getSprite(L.name, L.frame, L.colorway || null);
    if (!img) continue;
    ctx.save();
    if (L.alpha != null) ctx.globalAlpha = L.alpha;
    // Layers are bottom-anchored to the composite so a 16x16 hat lines up with
    // a 16x24 body when it declares dy.
    const dx = (L.dx || 0) + Math.floor((w - def.w) / 2);
    const dy = (L.dy || 0) + (h - def.h);
    if (L.flip) {
      ctx.translate(dx + def.w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
    } else {
      ctx.drawImage(img, dx, dy);
    }
    ctx.restore();
  }
  if (cache.size > CACHE_LIMIT) {
    const keys = Array.from(cache.keys()).slice(0, Math.floor(CACHE_LIMIT / 4));
    for (const k of keys) cache.delete(k);
  }
  cache.set(ck, c);
  return c;
}

/** Draw a composed canvas with feet at (x,y). */
export function drawComposed(ctx, canvas, x, y, opts = {}) {
  if (!canvas) return;
  const scale = opts.scale || 1;
  const w = canvas.width * scale, h = canvas.height * scale;
  let img = canvas;
  const dx = Math.round(x - w / 2);
  const dy = Math.round(y - h) + Math.round(opts.bob || 0);

  ctx.save();
  if (opts.alpha != null && opts.alpha < 1) ctx.globalAlpha = opts.alpha;
  if (opts.shadow) {
    ctx.globalAlpha = (opts.alpha ?? 1) * (opts.shadow === true ? 0.32 : opts.shadow);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(Math.round(x), Math.round(y - 1), w * 0.31, Math.max(2, h * 0.05), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = opts.alpha ?? 1;
  }
  if (opts.tint && (opts.tintAmt ?? 0.6) > 0) img = getTinted(canvas, opts.tint, opts.tintAmt ?? 0.6, `~comp${canvas.width}x${canvas.height}|${opts.sig || ''}`);
  if (opts.flip) {
    ctx.translate(dx + w, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height, 0, 0, w, h);
  } else {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height, dx, dy, w, h);
  }
  ctx.restore();
}

// --- animation ------------------------------------------------------------

/**
 * Pick the frame name for an animation at time t.
 * anim: { frames:[names], fps, loop=true }
 */
export function animFrame(name, animId, t) {
  const def = sprites.get(name);
  if (!def) return null;
  const a = def.anims[animId];
  if (!a) return animId;                       // treat as a literal frame name
  const n = a.frames.length;
  const i = Math.floor(t * (a.fps || 8));
  return a.frames[a.loop === false ? Math.min(i, n - 1) : ((i % n) + n) % n];
}

/** The standard 4-direction walk cycle frame: 'down-0'..'down-3'. */
export function walkFrame(dir, phase) {
  const seq = [0, 1, 0, 2];
  return `${dir}-${seq[phase & 3]}`;
}

export function clearSpriteCache() { cache.clear(); tintCache.clear(); }

/** Debug helper: how much sprite memory we're holding. */
export function spriteStats() {
  return { defs: sprites.size, cached: cache.size, tinted: tintCache.size };
}
