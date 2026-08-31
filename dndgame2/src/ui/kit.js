// ui/kit.js — shared UI kit: hand-authored 5x7 bitmap font, panels, bars, icons, widgets.
// EVERY other UI module draws through this file so the whole game looks like one product.
//
// Design notes for the font grid (5 wide x 7 tall, '#' = lit pixel):
//   row 0..5  : cap height (uppercase, digits and ascenders live here)
//   row 5     : the BASELINE — every glyph's feet rest on it
//   row 6     : the DESCENDER row, used by g j p q y , ; and a few symbols
//   lowercase : x-height occupies rows 2..5, so caps read ~1.5x the x-height
// Keeping one baseline for every glyph is what makes tiny text look typeset
// instead of hand-placed.
//
// Rendering strategy: a glyph atlas is baked ONCE per (scale, colour) pair into an
// offscreen canvas, then every character is a single drawImage. Never fillRect per
// pixel per frame — a full screen of text is ~600 glyphs and that would melt.

import { drawSprite, hasSprite, shadeHex } from '../render/sprites.js';
import { hashStr } from '../core/rng.js';
import { VIEW_W, VIEW_H } from '../constants.js';

// ---------------------------------------------------------------------------
// 0. TINY HELPERS
// ---------------------------------------------------------------------------

const R = Math.round;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * shadeHex() only understands '#rgb'/'#rrggbb'. Callers hand us rgba() strings
 * and gradients all the time, so pass anything else straight through instead of
 * silently turning it black.
 */
function shade(color, amt) {
  return (typeof color === 'string' && color.charCodeAt(0) === 35) ? shadeHex(color, amt) : color;
}

/** Create an offscreen canvas (OffscreenCanvas where available, else a DOM one). */
function makeCanvas(w, h) {
  w = Math.max(1, w | 0); h = Math.max(1, h | 0);
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  /* eslint-disable-next-line no-undef */
  return new OffscreenCanvas(w, h);
}

/** A crisp 1px-per-side rectangle outline built from fillRects (no half-pixel stroke). */
function rectStroke(ctx, x, y, w, h, color, t = 1) {
  if (w <= 0 || h <= 0 || !color) return;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, t);                 // top
  ctx.fillRect(x, y + h - t, w, t);         // bottom
  ctx.fillRect(x, y + t, t, h - t * 2);     // left
  ctx.fillRect(x + w - t, y + t, t, h - t * 2); // right
}

/** Vertical two-stop gradient fill, clipped to integer pixels. */
function vgrad(ctx, x, y, w, h, top, bot) {
  if (w <= 0 || h <= 0) return;
  if (!bot || bot === top) { ctx.fillStyle = top; ctx.fillRect(x, y, w, h); return; }
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** Bounded LRU-ish cache: cheap Map with an eviction cap. */
function boundedCache(limit) {
  const m = new Map();
  return {
    get(k) {
      const v = m.get(k);
      if (v !== undefined) { m.delete(k); m.set(k, v); }  // touch = most recent
      return v;
    },
    set(k, v) {
      if (m.size >= limit) { const first = m.keys().next().value; m.delete(first); }
      m.set(k, v);
      return v;
    },
    clear() { m.clear(); },
    get size() { return m.size; },
  };
}

// ---------------------------------------------------------------------------
// 1. THE FONT
// ---------------------------------------------------------------------------

export const GLYPH_W = 5;
export const GLYPH_H = 7;
export const LINE_GAP = 2;   // blank rows between baselines, in glyph pixels

/** 5x7 bitmap font. char -> 7 rows of 5 chars ('#' on, '.' off). */
export const FONT = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],

  // --- uppercase: 6 rows tall (0..5), baseline row 5 -----------------------
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '.....'],
  B: ['####.', '#...#', '####.', '#...#', '#...#', '####.', '.....'],
  C: ['.###.', '#...#', '#....', '#....', '#...#', '.###.', '.....'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '####.', '.....'],
  E: ['#####', '#....', '####.', '#....', '#....', '#####', '.....'],
  F: ['#####', '#....', '####.', '#....', '#....', '#....', '.....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '.###.', '.....'],
  H: ['#...#', '#...#', '#####', '#...#', '#...#', '#...#', '.....'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '.###.', '.....'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '.##..', '.....'],
  K: ['#...#', '#..#.', '##...', '#.#..', '#..#.', '#...#', '.....'],
  L: ['#....', '#....', '#....', '#....', '#....', '#####', '.....'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '.....'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '.....'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '.###.', '.....'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '.....'],
  Q: ['.###.', '#...#', '#...#', '#.#.#', '#..#.', '.##.#', '.....'],
  R: ['####.', '#...#', '#...#', '####.', '#..#.', '#...#', '.....'],
  S: ['.####', '#....', '.###.', '....#', '....#', '####.', '.....'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '.....'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '.###.', '.....'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..', '.....'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#', '.....'],
  X: ['#...#', '.#.#.', '..#..', '..#..', '.#.#.', '#...#', '.....'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '.....'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#####', '.....'],

  // --- lowercase: x-height rows 2..5, ascenders from row 0, descenders row 6
  a: ['.....', '.....', '.###.', '#...#', '#...#', '.####', '.....'],
  b: ['#....', '#....', '####.', '#...#', '#...#', '####.', '.....'],
  c: ['.....', '.....', '.###.', '#....', '#....', '.###.', '.....'],
  d: ['....#', '....#', '.####', '#...#', '#...#', '.####', '.....'],
  e: ['.....', '.....', '.###.', '#####', '#....', '.###.', '.....'],
  f: ['..##.', '.#...', '####.', '.#...', '.#...', '.#...', '.....'],
  g: ['.....', '.....', '.###.', '#...#', '#...#', '.####', '.##..'],
  h: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '.....'],
  i: ['..#..', '.....', '..#..', '..#..', '..#..', '..#..', '.....'],
  j: ['...#.', '.....', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  k: ['#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '.....'],
  l: ['.##..', '..#..', '..#..', '..#..', '..#..', '.###.', '.....'],
  m: ['.....', '.....', '#####', '#.#.#', '#.#.#', '#.#.#', '.....'],
  n: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '.....'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '.###.', '.....'],
  p: ['.....', '.....', '####.', '#...#', '#...#', '####.', '#....'],
  q: ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#'],
  r: ['.....', '.....', '#.##.', '##...', '#....', '#....', '.....'],
  s: ['.....', '.....', '.###.', '##...', '...##', '.###.', '.....'],
  t: ['.#...', '.#...', '###..', '.#...', '.#...', '..##.', '.....'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '.####', '.....'],
  v: ['.....', '.....', '#...#', '#...#', '.#.#.', '..#..', '.....'],
  w: ['.....', '.....', '#...#', '#.#.#', '#.#.#', '.#.#.', '.....'],
  x: ['.....', '.....', '#...#', '.#.#.', '.#.#.', '#...#', '.....'],
  y: ['.....', '.....', '#...#', '#...#', '.#.#.', '..#..', '.#...'],
  z: ['.....', '.....', '#####', '...#.', '.#...', '#####', '.....'],

  // --- digits: 6 rows, matching cap height ---------------------------------
  0: ['.###.', '#..##', '#.#.#', '##..#', '#...#', '.###.', '.....'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '.###.', '.....'],
  2: ['.###.', '#...#', '...#.', '..#..', '.#...', '#####', '.....'],
  3: ['####.', '....#', '.###.', '....#', '#...#', '.###.', '.....'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '.....'],
  5: ['#####', '#....', '####.', '....#', '#...#', '.###.', '.....'],
  6: ['.###.', '#....', '####.', '#...#', '#...#', '.###.', '.....'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.....'],
  8: ['.###.', '#...#', '.###.', '#...#', '#...#', '.###.', '.....'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '.###.', '.....'],

  // --- punctuation ---------------------------------------------------------
  '.': ['.....', '.....', '.....', '.....', '.....', '..#..', '.....'],
  ',': ['.....', '.....', '.....', '.....', '.....', '..#..', '.#...'],
  ':': ['.....', '.....', '.....', '..#..', '.....', '..#..', '.....'],
  ';': ['.....', '.....', '.....', '..#..', '.....', '..#..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '.....', '..#..', '.....'],
  '?': ['.###.', '#...#', '...#.', '..#..', '.....', '..#..', '.....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '+': ['.....', '.....', '..#..', '#####', '..#..', '.....', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '.....'],
  '\\': ['#....', '#....', '.#...', '..#..', '...#.', '....#', '.....'],
  '(': ['..#..', '.#...', '#....', '#....', '.#...', '..#..', '.....'],
  ')': ['..#..', '...#.', '....#', '....#', '...#.', '..#..', '.....'],
  '[': ['.###.', '.#...', '.#...', '.#...', '.#...', '.###.', '.....'],
  ']': ['.###.', '...#.', '...#.', '...#.', '...#.', '.###.', '.....'],
  '{': ['..##.', '..#..', '..#..', '.#...', '..#..', '..##.', '.....'],
  '}': ['.##..', '..#..', '..#..', '...#.', '..#..', '.##..', '.....'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#.##', '#..##', '.....'],
  '&': ['.##..', '#..#.', '.##..', '#.#.#', '#..#.', '.##.#', '.....'],
  '*': ['.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..', '.....'],
  '#': ['.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.....', '.....'],
  '<': ['.....', '...#.', '..#..', '.#...', '..#..', '...#.', '.....'],
  '>': ['.....', '.#...', '..#..', '...#.', '..#..', '.#...', '.....'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.##.', '.####', '.....'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '^': ['..#..', '.#.#.', '#...#', '.....', '.....', '.....', '.....'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '|': ['..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '.....'],
  '~': ['.....', '.....', '.....', '.##.#', '#.##.', '.....', '.....'],
  '`': ['.#...', '..#..', '.....', '.....', '.....', '.....', '.....'],
};

// --- pictogram / icon glyphs, usable inline in any string --------------------
// Keyed by \u escapes rather than literal characters so the table survives any
// encoding mishap between disk, server and browser.
const ICON_GLYPHS = {
  '°': ['.##..', '#..#.', '.##..', '.....', '.....', '.....', '.....'], // ° degree
  '×': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'], // × times
  '–': ['.....', '.....', '.....', '####.', '.....', '.....', '.....'], // – en dash
  '—': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'], // — em dash
  '‘': ['..#..', '.#...', '.....', '.....', '.....', '.....', '.....'], // ‘
  '’': ['..#..', '...#.', '.....', '.....', '.....', '.....', '.....'], // ’
  '“': ['.#.#.', '#.#..', '.....', '.....', '.....', '.....', '.....'], // “
  '”': ['.#.#.', '..#.#', '.....', '.....', '.....', '.....', '.....'], // ”
  '…': ['.....', '.....', '.....', '.....', '.....', '#.#.#', '.....'], // … ellipsis
  '·': ['.....', '.....', '.....', '..#..', '.....', '.....', '.....'], // · middot
  '♥': ['.....', '##.##', '#####', '#####', '.###.', '..#..', '.....'], // ♥ heart
  '♦': ['.....', '..#..', '.###.', '#####', '.###.', '..#..', '.....'], // ♦ diamond
  '★': ['.....', '..#..', '#####', '.###.', '.#.#.', '#...#', '.....'], // ★ star
  '✓': ['.....', '....#', '...#.', '..#..', '#.#..', '.#...', '.....'], // ✓ check
  '✗': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'], // ✗ cross
  '●': ['.....', '.....', '.###.', '.###.', '.###.', '.....', '.....'], // ● dot
  '○': ['.....', '.....', '.###.', '.#.#.', '.###.', '.....', '.....'], // ○ ring
  '↑': ['..#..', '.###.', '#.#.#', '..#..', '..#..', '..#..', '.....'], // ↑
  '↓': ['..#..', '..#..', '..#..', '#.#.#', '.###.', '..#..', '.....'], // ↓
  '←': ['.....', '..#..', '.#...', '#####', '.#...', '..#..', '.....'], // ←
  '→': ['.....', '..#..', '...#.', '#####', '...#.', '..#..', '.....'], // →
  '⚔': ['..#..', '..#..', '..#..', '#####', '..#..', '..#..', '.....'], // ⚔ sword
  '⛨': ['#####', '#...#', '#.#.#', '#...#', '.#.#.', '..#..', '.....'], // ⛨ shield
  '☲': ['..#..', '..##.', '.##..', '.###.', '#####', '.###.', '.....'], // ☲ flame
  '☠': ['.###.', '#####', '#.#.#', '#####', '.###.', '.#.#.', '.....'], // ☠ skull
  '▲': ['.....', '.....', '..#..', '.###.', '#####', '.....', '.....'], // ▲ up chevron
  '▼': ['.....', '.....', '#####', '.###.', '..#..', '.....', '.....'], // ▼ down chevron
  '◀': ['.....', '...#.', '..##.', '.###.', '..##.', '...#.', '.....'], // ◀
  '▶': ['.....', '.#...', '.##..', '.###.', '.##..', '.#...', '.....'], // ▶
  '⚖': ['..#..', '#####', '#.#.#', '#.#.#', '.###.', '.###.', '.....'], // ⚖ scales
  '✡': ['.....', '..#..', '#####', '.###.', '#####', '..#..', '.....'], // ✡ holy
};
Object.assign(FONT, ICON_GLYPHS);

/** Convenience: the sentinel characters, so callers can write UI.G.heart inline. */
export const G = Object.freeze({
  heart: '♥', diamond: '♦', star: '★', check: '✓', cross: '✗',
  dot: '●', ring: '○', up: '↑', down: '↓', left: '←', right: '→',
  sword: '⚔', shield: '⛨', flame: '☲', skull: '☠', times: '×',
  ellipsis: '…', degree: '°', chevUp: '▲', chevDown: '▼',
  chevLeft: '◀', chevRight: '▶', scales: '⚖', holy: '✡', dash: '—',
});

// Unknown characters fall back to a hollow box so missing glyphs are visible in dev
// rather than silently swallowing text.
const TOFU = ['.....', '.###.', '.#.#.', '.#.#.', '.###.', '.....', '.....'];

// Glyph index: stable order so an atlas built once can be addressed by lookup.
const GLYPH_KEYS = Object.keys(FONT);
const GLYPH_SLOT = new Map();
GLYPH_KEYS.forEach((ch, i) => GLYPH_SLOT.set(ch, i));
const ATLAS_COLS = 16;
const ATLAS_ROWS = Math.ceil((GLYPH_KEYS.length + 1) / ATLAS_COLS); // +1 for tofu

// ---------------------------------------------------------------------------
// 2. GLYPH ATLAS — one baked canvas per (scale, colour)
// ---------------------------------------------------------------------------

const atlasCache = boundedCache(48);

function buildAtlas(scale, color) {
  const gw = GLYPH_W * scale;
  const gh = GLYPH_H * scale;
  const cv = makeCanvas(ATLAS_COLS * gw, ATLAS_ROWS * gh);
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.fillStyle = color;
  // Bake every glyph exactly once. This is the ONLY place we fillRect per pixel.
  const all = GLYPH_KEYS.concat([null]);
  for (let i = 0; i < all.length; i++) {
    const rows = all[i] === null ? TOFU : FONT[all[i]];
    const ox = (i % ATLAS_COLS) * gw;
    const oy = ((i / ATLAS_COLS) | 0) * gh;
    for (let ry = 0; ry < GLYPH_H; ry++) {
      const row = rows[ry] || '.....';
      let run = -1;
      // Collapse horizontal runs of lit pixels into one fillRect — fewer calls.
      for (let rx = 0; rx <= GLYPH_W; rx++) {
        const on = rx < GLYPH_W && row.charCodeAt(rx) === 35; /* '#' */
        if (on && run < 0) run = rx;
        else if (!on && run >= 0) {
          c.fillRect(ox + run * scale, oy + ry * scale, (rx - run) * scale, scale);
          run = -1;
        }
      }
    }
  }
  return { cv, gw, gh, tofu: all.length - 1 };
}

function atlasFor(scale, color) {
  const key = `${scale}|${color}`;
  let a = atlasCache.get(key);
  if (!a) a = atlasCache.set(key, buildAtlas(scale, color));
  return a;
}

/** Drop every cached atlas/icon (call after a palette change). */
export function clearUICache() { atlasCache.clear(); iconCache.clear(); }

// ---------------------------------------------------------------------------
// 3. TEXT METRICS + DRAWING
// ---------------------------------------------------------------------------

/**
 * Resolve a size token to pixel metrics.
 *   sm = scale 1            md = scale 1 + faux bold (double-draw 1px right)
 *   lg = scale 2            xl = scale 3            xxl = scale 4
 * A raw number is treated as an explicit integer scale.
 */
function metrics(size, letterSpacing) {
  let scale = 1;
  let bold = false;
  if (typeof size === 'number' && isFinite(size)) scale = Math.max(1, size | 0);
  else {
    switch (size) {
      case 'md': bold = true; break;
      case 'lg': scale = 2; break;
      case 'xl': scale = 3; break;
      case 'xxl': scale = 4; break;
      case 'lgb': scale = 2; bold = true; break;
      default: break; // 'sm' and anything unknown
    }
  }
  const sp = letterSpacing == null ? 1 : letterSpacing;
  const boldPx = bold ? 1 : 0;
  return {
    scale, bold, sp, boldPx,
    adv: (GLYPH_W + sp) * scale + boldPx,
    gap: sp * scale,
    lineH: (GLYPH_H + LINE_GAP) * scale,
    w: GLYPH_W * scale,
    h: GLYPH_H * scale,
    capH: 6 * scale,
  };
}

/** Width in px of a SINGLE line (no '\n' handling). */
function lineWidth(line, m) {
  const n = line.length;
  if (n <= 0) return 0;
  return n * m.adv - m.gap;
}

/** Blit one line of glyphs from the atlas. Returns the advance width. */
function drawRun(ctx, str, x, y, m, color, alpha) {
  const a = atlasFor(m.scale, color);
  const prevAlpha = ctx.globalAlpha;
  const prevSmooth = ctx.imageSmoothingEnabled;
  if (alpha != null && alpha < 1) ctx.globalAlpha = prevAlpha * alpha;
  ctx.imageSmoothingEnabled = false;
  let px = R(x);
  const py = R(y);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch !== ' ') {
      const slot = GLYPH_SLOT.has(ch) ? GLYPH_SLOT.get(ch) : a.tofu;
      const sx = (slot % ATLAS_COLS) * a.gw;
      const sy = ((slot / ATLAS_COLS) | 0) * a.gh;
      ctx.drawImage(a.cv, sx, sy, a.gw, a.gh, px, py, a.gw, a.gh);
      if (m.bold) ctx.drawImage(a.cv, sx, sy, a.gw, a.gh, px + 1, py, a.gw, a.gh);
    }
    px += m.adv;
  }
  ctx.globalAlpha = prevAlpha;
  ctx.imageSmoothingEnabled = prevSmooth;
  return px - R(x) - m.gap;
}

/**
 * Low-level public glyph blitter (spec-mandated signature).
 * 1px letter spacing (scaled), supports '\n'.
 */
export function drawGlyphs(ctx, str, x, y, scale = 1, color = '#ffffff') {
  const m = metrics(typeof scale === 'number' ? scale : 1, 1);
  const s = String(str == null ? '' : str);
  if (s.indexOf('\n') < 0) return drawRun(ctx, s, x, y, m, color, 1);
  let ly = y;
  let widest = 0;
  for (const line of s.split('\n')) {
    widest = Math.max(widest, drawRun(ctx, line, x, ly, m, color, 1));
    ly += m.lineH;
  }
  return widest;
}

/** Measure a (possibly multi-line) string. */
export function measureGlyphs(str, size = 'sm', letterSpacing) {
  const m = metrics(size, letterSpacing);
  const s = String(str == null ? '' : str);
  if (s.indexOf('\n') < 0) return lineWidth(s, m);
  let widest = 0;
  for (const line of s.split('\n')) widest = Math.max(widest, lineWidth(line, m));
  return widest;
}

/** Greedy word wrap to `w` pixels. Long single words are hard-broken. */
export function wrapLines(str, w, size = 'sm', letterSpacing) {
  const m = metrics(size, letterSpacing);
  const out = [];
  const maxW = Math.max(m.adv, w | 0);
  for (const para of String(str == null ? '' : str).split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const test = line ? `${line} ${word}` : word;
      if (lineWidth(test, m) <= maxW) { line = test; continue; }
      if (line) { out.push(line); line = ''; }
      // Word alone is too wide: chop it into pieces that fit.
      let chunk = word;
      while (lineWidth(chunk, m) > maxW && chunk.length > 1) {
        let cut = chunk.length;
        while (cut > 1 && lineWidth(chunk.slice(0, cut), m) > maxW) cut--;
        out.push(chunk.slice(0, cut));
        chunk = chunk.slice(cut);
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

/**
 * Truncate a string with an ellipsis so it fits `w` px.
 *
 * The old loop stopped at `s.length > 1`, so it ALWAYS emitted at least two
 * glyphs — 11px at sm, 13px at md — no matter how narrow the slot was. Every
 * caller with a `Math.max(8, …)` width floor therefore overflowed its column
 * by 3px without any visible sign. A slot too narrow for one glyph plus the
 * ellipsis now gets the ellipsis alone, and one too narrow even for that gets
 * nothing: the column ALWAYS wins, and a starved column reads as starved.
 */
export function fitText(str, w, size = 'sm') {
  let s = String(str == null ? '' : str);
  if (measureGlyphs(s, size) <= w) return s;
  const ell = '…';
  if (measureGlyphs(ell, size) > w) return '';
  while (s.length > 1 && measureGlyphs(s + ell, size) > w) s = s.slice(0, -1);
  return measureGlyphs(s + ell, size) > w ? ell : s + ell;
}

/**
 * UI.splitRow — divide a row between a left label and a right value.
 *
 * This is the arithmetic that four separate `kv()` copies each got wrong in a
 * different way: measure both halves, hand each a percentage, and let the two
 * percentages add up past 100 so a long value prints straight through its own
 * label (or, right-aligned with no `maxWidth`, straight out of the panel).
 *
 * The contract here: label + value + gap NEVER exceed `w`. When both fit, both
 * get their natural width. When they do not, the value is capped at
 * `valueMax` (default two thirds) and the label keeps the rest, but the label
 * is never squeezed below `labelMin` — a label cut to "Al…" tells the player
 * nothing, so the value is the half that yields.
 *
 * Returns { labelW, valueW, gap, fits }. Feed labelW/valueW to `maxWidth`.
 */
function splitRow(w, label, value, opts = {}) {
  const size = opts.size || 'sm';
  const valueSize = opts.valueSize || size;
  const gap = opts.gap == null ? 4 : opts.gap;
  const total = Math.max(0, Math.round(w));
  const lNeed = Math.ceil(measureGlyphs(label == null ? '' : label, size));
  const vNeed = Math.ceil(measureGlyphs(value == null ? '' : value, valueSize));
  if (vNeed <= 0) return { labelW: total, valueW: 0, gap: 0, fits: lNeed <= total };
  if (lNeed <= 0) return { labelW: 0, valueW: Math.min(vNeed, total), gap: 0, fits: vNeed <= total };
  const avail = Math.max(0, total - gap);
  if (lNeed + vNeed <= avail) return { labelW: lNeed, valueW: vNeed, gap, fits: true };
  const valueMax = Math.round(avail * (opts.valueMax == null ? 0.66 : opts.valueMax));
  const labelMax = Math.round(avail * (opts.labelMax == null ? 0.62 : opts.labelMax));
  const labelFloor = Math.round(avail * (opts.labelFloor == null ? 0.4 : opts.labelFloor));
  let labelW;
  let valueW;
  if (lNeed <= labelMax) {
    // The label fits inside its share: it gets exactly what it needs, and the
    // value takes the rest. This is what saves "Alignment" and "Location".
    labelW = lNeed;
    valueW = avail - labelW;
  } else {
    // The label is going to be cut whatever we do, so stop starving the value
    // for it: the value takes what it needs up to its cap, and the label keeps
    // the remainder — never less than `labelFloor`, so it cannot collapse to
    // two glyphs and a full stop.
    valueW = Math.min(vNeed, valueMax);
    labelW = avail - valueW;
    if (labelW < labelFloor) { labelW = Math.min(labelFloor, avail); valueW = Math.max(0, avail - labelW); }
  }
  return { labelW: Math.max(0, labelW), valueW: Math.max(0, valueW), gap, fits: false };
}

/**
 * UI.kvRow — "Speed        30 ft." drawn correctly: a dim label hard against
 * the left edge, a bright value hard against the right, and a guarantee that
 * neither ever crosses the other or leaves [x, x+w].
 *
 * opts: { size, valueSize, color, labelColor, gap, valueMax, labelMax, align }
 * Returns the split it used.
 */
function kvRow(ctx, x, y, w, label, value, opts = {}) {
  const size = opts.size || 'sm';
  const valueSize = opts.valueSize || size;
  const v = value == null ? '' : String(value);
  const k = label == null ? '' : String(label);
  const s = splitRow(w, k, v, { size, valueSize, gap: opts.gap, valueMax: opts.valueMax, labelMax: opts.labelMax, labelMin: opts.labelMin });
  if (k && s.labelW > 0) {
    text(ctx, R(x), R(y), k, {
      size, color: opts.labelColor || COLORS.inkDim, shadow: opts.shadow == null ? true : opts.shadow,
      maxWidth: s.labelW,
    });
  }
  if (v && s.valueW > 0) {
    text(ctx, R(x + w), R(y), v, {
      size: valueSize, color: opts.color || COLORS.ink, align: 'right',
      shadow: opts.shadow == null ? true : opts.shadow, maxWidth: s.valueW,
    });
  }
  return s;
}

// ---------------------------------------------------------------------------
// 4. PALETTE
// ---------------------------------------------------------------------------

const COLORS = {
  // ink
  ink: '#efe6d0',
  inkDim: '#9a917f',
  dim: '#9a917f',          // legacy alias — several modules already read `dim`
  inkBright: '#fffaf0',
  white: '#f6efe0',
  black: '#0a0708',

  // metals & accents
  gold: '#e3b34a',
  goldDim: '#a37a26',
  goldBright: '#f7dc92',
  bronze: '#8a6a28',
  silver: '#b9c1cf',

  // hues
  red: '#d4553f',
  green: '#6fc36a',
  blue: '#6aa8e8',
  purple: '#b07ae0',
  cyan: '#63d6d0',
  orange: '#e8863a',
  yellow: '#f0d264',
  pink: '#e08ab0',
  brown: '#8a5a30',

  // surfaces
  bg: '#0b0d16',
  bgDeep: '#05060c',
  panel: '#181b28',
  panelLite: '#242838',
  border: '#5c4a2a',
  borderLite: '#8a6a34',
  shadow: 'rgba(0,0,0,0.45)',

  // gameplay meters
  hp: '#c8452f',
  hpDark: '#6d1f16',
  hpHeal: '#5fc86a',
  mp: '#4a7ad0',
  mpDark: '#223d75',
  xp: '#e3b34a',
  xpDark: '#7a5c22',
  temp: '#7fd0e8',

  // semantics
  good: '#6fc36a',
  bad: '#d4553f',
  warn: '#e8b23a',
  info: '#6aa8e8',
  party: '#6ac0f0',
  foe: '#e0604a',
  neutral: '#c0b49a',
  disabled: '#5a5548',
};

/** Damage-type colours — used by floaters, spell VFX, resistance chips, tooltips. */
const DAMAGE_COLORS = {
  slashing: '#d8d2c2',
  piercing: '#c8cddb',
  bludgeoning: '#b09a7a',
  fire: '#f07a2a',
  cold: '#8fd8ee',
  lightning: '#ffe066',
  thunder: '#b8a0e8',
  acid: '#8ed24a',
  poison: '#6fbf4a',
  necrotic: '#7a5f9e',
  radiant: '#ffe9a8',
  psychic: '#e070c0',
  force: '#c3a2ff',
  healing: '#5fc86a',
  none: '#c0b49a',
};
COLORS.DAMAGE_COLORS = DAMAGE_COLORS;

/** Rarity colours, matching the item tiers in data/items.js. */
const RARITY_COLORS = {
  common: '#cfc7b4',
  uncommon: '#6fc36a',
  rare: '#6aa8e8',
  'very-rare': '#b07ae0',
  legendary: '#e8a33a',
  artifact: '#e0604a',
};
COLORS.RARITY_COLORS = RARITY_COLORS;

// ---------------------------------------------------------------------------
// 5. CLIP STACK
// ---------------------------------------------------------------------------

const clipStack = [];

function pushClip(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(R(x), R(y), Math.max(0, R(w)), Math.max(0, R(h)));
  ctx.clip();
  clipStack.push(ctx);
  return { x: R(x), y: R(y), w: R(w), h: R(h) };
}

function popClip(ctx) {
  const c = clipStack.pop() || ctx;
  if (c) c.restore();
}

// ---------------------------------------------------------------------------
// 6. TEXT API
// ---------------------------------------------------------------------------

/**
 * UI.text — the workhorse.
 * opts: { color, size, align:'left'|'center'|'right', shadow, outline, alpha,
 *         maxWidth, wrap, letterSpacing, lineHeight, valign:'top'|'middle'|'baseline' }
 * Returns { w, h, lines }.
 */
function text(ctx, x, y, str, opts = {}) {
  const s = String(str == null ? '' : str);
  if (!s) return { w: 0, h: 0, lines: 0 };
  const color = opts.color || COLORS.ink;
  const m = metrics(opts.size, opts.letterSpacing);
  const lineH = opts.lineHeight != null ? opts.lineHeight : m.lineH;

  let lines;
  if (opts.wrap && opts.maxWidth) lines = wrapLines(s, opts.maxWidth, opts.size, opts.letterSpacing);
  else lines = s.indexOf('\n') >= 0 ? s.split('\n') : [s];

  // Non-wrapping overflow is clipped rather than spilling over neighbouring widgets.
  let clipped = false;
  if (!opts.wrap && opts.maxWidth) {
    let widest = 0;
    for (const l of lines) widest = Math.max(widest, lineWidth(l, m));
    if (widest > opts.maxWidth) {
      if (opts.ellipsis !== false && lines.length === 1) {
        lines = [fitText(lines[0], opts.maxWidth, opts.size)];
      } else {
        pushClip(ctx, x - (opts.align === 'right' ? opts.maxWidth : opts.align === 'center' ? opts.maxWidth / 2 : 0),
          y - 2, opts.maxWidth, lines.length * lineH + 4);
        clipped = true;
      }
    }
  }

  const shadowCol = opts.shadow === true ? 'rgba(0,0,0,0.72)'
    : (typeof opts.shadow === 'string' ? opts.shadow : null);
  const outlineCol = opts.outline === true ? '#0a0708'
    : (typeof opts.outline === 'string' ? opts.outline : null);

  let ly = R(y);
  if (opts.valign === 'middle') ly = R(y - (lines.length * lineH - m.scale * LINE_GAP) / 2);
  else if (opts.valign === 'baseline') ly = R(y - m.capH);

  let widest = 0;
  for (const line of lines) {
    const lw = lineWidth(line, m);
    widest = Math.max(widest, lw);
    let lx = x;
    if (opts.align === 'center') lx = x - lw / 2;
    else if (opts.align === 'right') lx = x - lw;
    lx = R(lx);

    if (outlineCol) {
      // 4-way outline keeps small text readable on busy overworld tiles.
      const o = m.scale;
      drawRun(ctx, line, lx - o, ly, m, outlineCol, opts.alpha);
      drawRun(ctx, line, lx + o, ly, m, outlineCol, opts.alpha);
      drawRun(ctx, line, lx, ly - o, m, outlineCol, opts.alpha);
      drawRun(ctx, line, lx, ly + o, m, outlineCol, opts.alpha);
      if (opts.outlineFull) {
        drawRun(ctx, line, lx - o, ly - o, m, outlineCol, opts.alpha);
        drawRun(ctx, line, lx + o, ly - o, m, outlineCol, opts.alpha);
        drawRun(ctx, line, lx - o, ly + o, m, outlineCol, opts.alpha);
        drawRun(ctx, line, lx + o, ly + o, m, outlineCol, opts.alpha);
      }
    } else if (shadowCol !== null || opts.shadow === undefined) {
      // Default: a single 1px drop shadow. That one pixel is what makes the
      // whole UI look like a Game Boy Advance game instead of a web page.
      drawRun(ctx, line, lx + m.scale, ly + m.scale, m, shadowCol || 'rgba(0,0,0,0.72)', opts.alpha);
    }

    drawRun(ctx, line, lx, ly, m, color, opts.alpha);
    ly += lineH;
  }

  if (clipped) popClip(ctx);
  return { w: widest, h: lines.length * lineH, lines: lines.length };
}

/** Shorthand: always-shadowed text. */
function shadowText(ctx, x, y, str, opts = {}) {
  return text(ctx, x, y, str, { shadow: true, ...opts });
}

/** Wrap `str` into `w` px and draw it. Returns { lines, height }. */
function textWrapped(ctx, x, y, w, str, opts = {}) {
  const lines = wrapLines(str, w, opts.size, opts.letterSpacing);
  const m = metrics(opts.size, opts.letterSpacing);
  const lineH = opts.lineHeight != null ? opts.lineHeight : m.lineH;
  const max = opts.maxLines || 0;
  const shown = max > 0 && lines.length > max ? lines.slice(0, max) : lines;
  if (max > 0 && lines.length > max && shown.length) {
    shown[shown.length - 1] = fitText(`${shown[shown.length - 1]}…`, w, opts.size);
  }
  let ly = R(y);
  for (const line of shown) {
    let lx = x;
    if (opts.align === 'center') lx = x + (w - lineWidth(line, m)) / 2;
    else if (opts.align === 'right') lx = x + w - lineWidth(line, m);
    text(ctx, R(lx), ly, line, { ...opts, wrap: false, maxWidth: 0, align: 'left' });
    ly += lineH;
  }
  return { lines: shown.length, height: shown.length * lineH, total: lines.length, lineH };
}

// ---------------------------------------------------------------------------
// 7. PANELS (procedural 9-slice windows)
// ---------------------------------------------------------------------------

// rings run outermost -> inward, one pixel each. `fill` is a [top, bottom] gradient.
const PANEL_STYLES = {
  // The default adventuring window: dark parchment-brown with a gold/bronze
  // double rule, a hairline inner highlight and four corner studs.
  window: {
    rings: ['#0d0907', '#c9992f', '#5a4318'],
    fill: ['#2e241b', '#191310'],
    hi: 'rgba(255,231,178,0.13)',
    lo: 'rgba(0,0,0,0.30)',
    studs: '#f0cf7a',
    studDark: '#7a5c22',
    shadow: 0.38,
    ink: COLORS.ink,
  },
  dark: {
    rings: ['#05060a', '#2b2f40'],
    fill: ['#13161f', '#090b12'],
    hi: 'rgba(150,175,220,0.10)',
    lo: 'rgba(0,0,0,0.35)',
    studs: null,
    shadow: 0.42,
    ink: COLORS.ink,
  },
  // A struck brass nameplate: a genuine gold FILL, meant to carry dark ink.
  // Every call site (title bars, speaker tabs, key hints, banners) draws near-black
  // text on it, so the fill has to be light or the text vanishes.
  gold: {
    rings: ['#120c05', '#8a6a28'],
    fill: ['#f4d98d', '#c9992f'],
    hi: 'rgba(255,251,230,0.55)',
    lo: 'rgba(80,52,8,0.32)',
    studs: '#6b5220',
    studDark: '#2a1c07',
    shadow: 0.40,
    ink: '#2a1c07',          // dark ink: this panel is a light plate
  },
  plain: {
    rings: ['#151824'],
    fill: ['#212433', '#171a25'],
    hi: 'rgba(255,255,255,0.06)',
    lo: null,
    studs: null,
    shadow: 0.22,
    ink: COLORS.ink,
  },
  // Recessed slot: light on the bottom/right, dark on the top/left.
  inset: {
    rings: ['#0a0c12'],
    fill: ['#0e1017', '#171b26'],
    hi: null,
    lo: null,
    studs: null,
    shadow: 0,
    inset: true,
    ink: COLORS.inkDim,
  },
  parchment: {
    rings: ['#3a2712', '#8a6a34', '#c8ab6e'],
    fill: ['#ecdcb2', '#c9b585'],
    hi: 'rgba(255,255,255,0.35)',
    lo: 'rgba(90,60,25,0.22)',
    studs: '#8a6a34',
    studDark: '#5a4318',
    shadow: 0.36,
    ink: '#3a2712',
  },
  danger: {
    rings: ['#140506', '#c0472f', '#5a1c14'],
    fill: ['#3b1a16', '#20100e'],
    hi: 'rgba(255,160,130,0.14)',
    lo: 'rgba(0,0,0,0.32)',
    studs: '#e88a68',
    studDark: '#8a2c1e',
    shadow: 0.44,
    ink: '#f0c0b0',
  },
  magic: {
    rings: ['#080614', '#9a6ae0', '#3d2470'],
    fill: ['#251b40', '#130d22'],
    hi: 'rgba(200,170,255,0.18)',
    lo: 'rgba(0,0,0,0.34)',
    studs: '#cfaaff',
    studDark: '#5a3a9a',
    shadow: 0.44,
    ink: '#dcccff',
    glow: 'rgba(150,110,230,0.18)',
  },
};

/**
 * The ink each panel style can actually carry, by role.
 *
 * `PANEL_STYLES.gold` is a genuine LIGHT brass fill (#f4d98d -> #c9992f). Half
 * a dozen call sites drew `goldBright` / `ink` / `dim` on it, which is 1.03:1
 * to 1.20:1 — literally invisible. Nothing enforced the declared `ink`, so
 * this table gives every style a title/body/dim/accent set that is guaranteed
 * legible on its own fill, and `inkFor()` is the one place to ask.
 *
 * Contrast against the darker of each fill's two stops is >= 4.5:1 throughout.
 */
const PANEL_INK = {
  window: { title: COLORS.gold, body: COLORS.ink, dim: COLORS.inkDim, accent: COLORS.goldBright },
  dark: { title: COLORS.gold, body: COLORS.ink, dim: COLORS.inkDim, accent: COLORS.goldBright },
  plain: { title: COLORS.gold, body: COLORS.ink, dim: COLORS.inkDim, accent: COLORS.goldBright },
  inset: { title: COLORS.goldDim, body: COLORS.ink, dim: COLORS.inkDim, accent: COLORS.gold },
  // Light plates: near-black ink, a warm brown for the quiet half.
  gold: { title: '#2a1c07', body: '#2a1c07', dim: '#5a4318', accent: '#7a2010' },
  parchment: { title: '#3a2712', body: '#241708', dim: '#5a4318', accent: '#7a2010' },
  danger: { title: '#ffb9a4', body: '#f0c0b0', dim: '#c08878', accent: '#ffd0a0' },
  magic: { title: '#cfaaff', body: '#dcccff', dim: '#a494c8', accent: '#f0d264' },
};

/**
 * UI.inkFor — the legible ink for `style` in `role`
 * ('body' | 'dim' | 'title' | 'accent'). Call sites that hard-code a colour on
 * a panel they did not choose are how light-on-light happens; ask instead.
 */
function inkFor(style, role = 'body') {
  const key = typeof style === 'string' ? style : '';
  const set = PANEL_INK[key] || PANEL_INK.window;
  return set[role] || set.body;
}

/**
 * Generic border/fill engine. `panel` is a thin wrapper over this, but other
 * widgets (buttons, bars, tooltips) reuse it directly.
 */
function nineSlice(ctx, x, y, w, h, opts = {}) {
  x = R(x); y = R(y); w = R(w); h = R(h);
  if (w <= 0 || h <= 0) return { x, y, w, h, ix: x, iy: y, iw: 0, ih: 0 };
  const st = typeof opts.style === 'string'
    ? (PANEL_STYLES[opts.style] || PANEL_STYLES.window)
    : (opts.style || PANEL_STYLES.window);
  const alpha = opts.alpha == null ? 1 : opts.alpha;
  const prev = ctx.globalAlpha;
  if (alpha < 1) ctx.globalAlpha = prev * alpha;

  // 1. soft drop shadow, offset down-right — cheap "floating window" cue
  const sh = opts.shadow != null ? opts.shadow : st.shadow;
  if (sh) {
    ctx.fillStyle = `rgba(0,0,0,${sh * 0.5})`;
    ctx.fillRect(x + 1, y + 2, w, h);
    ctx.fillStyle = `rgba(0,0,0,${sh})`;
    ctx.fillRect(x + 2, y + 3, w - 2, h - 2);
  }
  // 2. magical bloom behind the frame
  if (st.glow) {
    ctx.fillStyle = st.glow;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  }

  // 3. concentric 1px rings
  const rings = opts.rings || st.rings || [];
  let inset = 0;
  for (let i = 0; i < rings.length; i++) {
    if (w - inset * 2 <= 2 || h - inset * 2 <= 2) break;
    rectStroke(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, rings[i], 1);
    inset++;
  }

  // 4. interior fill
  const ix = x + inset, iy = y + inset;
  const iw = Math.max(0, w - inset * 2), ih = Math.max(0, h - inset * 2);
  const fill = opts.fill || st.fill;
  if (fill && iw > 0 && ih > 0) vgrad(ctx, ix, iy, iw, ih, fill[0], fill[1] || fill[0]);

  // 5. bevel — highlight on the lit edges, shade on the far ones.
  if (iw > 2 && ih > 2) {
    if (st.inset) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(ix, iy, iw, 1);
      ctx.fillRect(ix, iy, 1, ih);
      ctx.fillStyle = 'rgba(255,240,210,0.10)';
      ctx.fillRect(ix, iy + ih - 1, iw, 1);
      ctx.fillRect(ix + iw - 1, iy, 1, ih);
    } else {
      if (st.hi) {
        ctx.fillStyle = st.hi;
        ctx.fillRect(ix, iy, iw, 1);
        ctx.fillRect(ix, iy, 1, ih - 1);
      }
      if (st.lo) {
        ctx.fillStyle = st.lo;
        ctx.fillRect(ix, iy + ih - 1, iw, 1);
        ctx.fillRect(ix + iw - 1, iy + 1, 1, ih - 1);
      }
    }
  }

  // 6. corner studs — 2x2 rivets that sell the "metal-bound frame" read
  const studs = opts.studs === false ? null : (opts.studs || st.studs);
  if (studs && w >= 12 && h >= 12) {
    const dk = opts.studDark || st.studDark || 'rgba(0,0,0,0.5)';
    const cs = [[x + 2, y + 2], [x + w - 4, y + 2], [x + 2, y + h - 4], [x + w - 4, y + h - 4]];
    for (const [sx, sy] of cs) {
      ctx.fillStyle = dk; ctx.fillRect(sx, sy, 2, 2);
      ctx.fillStyle = studs; ctx.fillRect(sx, sy, 1, 1);
    }
  }

  ctx.globalAlpha = prev;
  return { x, y, w, h, ix, iy, iw, ih, pad: inset, ink: st.ink || COLORS.ink };
}

function panel(ctx, x, y, w, h, opts = {}) {
  return nineSlice(ctx, x, y, w, h, opts);
}

/** Panel + a gold title bar, the most common composite in the game. */
function window_(ctx, x, y, w, h, title, opts = {}) {
  const p = panel(ctx, x, y, w, h, opts);
  if (title) {
    const tw = measureGlyphs(title, 'md');
    const bx = R(x + (w - tw) / 2) - 5;
    nineSlice(ctx, bx, y - 5, tw + 10, 12, { style: 'gold', shadow: 0.3, studs: false });
    text(ctx, R(x + w / 2), y - 2, title, { size: 'md', color: '#2a1c07', align: 'center', shadow: 'rgba(255,225,160,0.35)' });
  }
  return p;
}

// ---------------------------------------------------------------------------
// 8. BARS & GAUGES
// ---------------------------------------------------------------------------

const pct = (v, max) => (max > 0 ? clamp01(v / max) : 0);

/**
 * UI.bar — HP / MP / XP meters.
 * opts: { color, bg, border, segments, ghost (0..1 trailing damage), label,
 *         labelColor, labelAlign:'left'|'center'|'right', alpha, glow, size }
 * The ghost is the classic JRPG "damage trail": the old value drains toward the
 * new one so the player sees how much was just lost.
 */
function bar(ctx, x, y, w, h, p, opts = {}) {
  x = R(x); y = R(y); w = R(w); h = R(h);
  if (w <= 2 || h <= 0) return;
  p = clamp01(p);
  const col = opts.color || COLORS.hp;
  const bg = opts.bg || '#150f10';
  const border = opts.border === false ? null : (opts.border || '#0a0708');
  const alpha = opts.alpha == null ? 1 : opts.alpha;
  const prev = ctx.globalAlpha;
  if (alpha < 1) ctx.globalAlpha = prev * alpha;

  // frame + trough
  if (border) { rectStroke(ctx, x, y, w, h, border, 1); }
  const ix = border ? x + 1 : x, iy = border ? y + 1 : y;
  const iw = border ? w - 2 : w, ih = border ? h - 2 : h;
  vgrad(ctx, ix, iy, iw, ih, shade(bg, 0.12), bg);

  // trailing "ghost" of the value we just lost
  if (opts.ghost != null && opts.ghost > p) {
    const gw = Math.round(iw * clamp01(opts.ghost));
    const fw0 = Math.round(iw * p);
    ctx.fillStyle = opts.ghostColor || 'rgba(240,190,120,0.55)';
    ctx.fillRect(ix + fw0, iy, Math.max(1, gw - fw0), ih);
  }

  // the fill itself: lighter at the top so it reads as a lit tube
  const fw = Math.round(iw * p);
  if (fw > 0) {
    vgrad(ctx, ix, iy, fw, ih, shade(col, 0.34), shade(col, -0.24));
    if (ih >= 3) {
      ctx.fillStyle = shade(col, 0.58);
      ctx.fillRect(ix, iy, fw, 1);                        // top highlight
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(ix, iy + ih - 1, fw, 1);               // bottom shade
    }
    if (opts.glow && fw > 1) {
      ctx.fillStyle = shade(col, 0.7);
      ctx.fillRect(ix + fw - 1, iy, 1, ih);               // leading edge spark
    }
  }

  // segment ticks (e.g. one notch per 10 HP, or per spell slot)
  if (opts.segments && opts.segments > 1 && iw > opts.segments * 2) {
    ctx.fillStyle = opts.tickColor || 'rgba(0,0,0,0.55)';
    for (let i = 1; i < opts.segments; i++) {
      const tx = ix + Math.round((iw * i) / opts.segments);
      ctx.fillRect(tx, iy, 1, ih);
    }
  }

  if (opts.label != null && opts.label !== '') {
    const size = opts.size || 'sm';
    const lc = opts.labelColor || COLORS.ink;
    const align = opts.labelAlign || 'center';
    const ly = y + Math.round((h - metrics(size).capH) / 2) - 1;
    const lx = align === 'left' ? x + 3 : align === 'right' ? x + w - 3 : x + w / 2;
    // The label sits ON the meter, so half of it lands on the bright fill and
    // half on the dark trough: pale ink over a green/gold fill is ~1.3:1 and
    // a 1px drop shadow does not save it. A full keyline does, and it costs
    // nothing on the dark half. `labelOutline: false` opts back out.
    const keyline = opts.labelOutline === false ? null : (opts.labelOutline || '#0a0708');
    text(ctx, lx, ly, String(opts.label), keyline
      ? { size, color: lc, align, outline: keyline }
      : { size, color: lc, align, shadow: true });
  }
  ctx.globalAlpha = prev;
}

/**
 * UI.gauge — a circular meter (concentration, rage rounds, breath recharge).
 * Drawn as discrete pixels around the ring so it stays crisp at 1x.
 */
function gauge(ctx, cx, cy, r, p, opts = {}) {
  cx = R(cx); cy = R(cy); r = Math.max(2, R(r));
  p = clamp01(p);
  const col = opts.color || COLORS.gold;
  const bg = opts.bg || 'rgba(0,0,0,0.55)';
  const thick = Math.max(1, opts.thickness || 2);
  const start = opts.start != null ? opts.start : -Math.PI / 2;   // 12 o'clock
  const steps = Math.max(24, Math.round(2 * Math.PI * r));
  const prev = ctx.globalAlpha;
  if (opts.alpha != null) ctx.globalAlpha = prev * opts.alpha;
  for (let i = 0; i < steps; i++) {
    const f = i / steps;
    const a = start + f * Math.PI * 2;
    const on = f <= p;
    ctx.fillStyle = on ? col : bg;
    for (let t = 0; t < thick; t++) {
      const rr = r - t;
      ctx.fillRect(R(cx + Math.cos(a) * rr), R(cy + Math.sin(a) * rr), 1, 1);
    }
  }
  if (opts.label != null) {
    text(ctx, cx, cy - 3, String(opts.label), { size: opts.size || 'sm', color: opts.labelColor || COLORS.ink, align: 'center', shadow: true });
  }
  ctx.globalAlpha = prev;
}

/** A row of small pips — HP hearts, hit dice, death saves, ammo. */
function pips(ctx, x, y, count, filled, opts = {}) {
  const size = opts.size || 5;
  const gap = opts.gap == null ? 2 : opts.gap;
  const on = opts.color || COLORS.hp;
  const off = opts.bg || 'rgba(255,255,255,0.14)';
  for (let i = 0; i < count; i++) {
    const px = R(x + i * (size + gap));
    if (opts.icon) icon(ctx, opts.icon, px, R(y), size + 3, i < filled ? on : off);
    else {
      ctx.fillStyle = '#0a0708';
      ctx.fillRect(px - 1, R(y) - 1, size + 2, size + 2);
      ctx.fillStyle = i < filled ? on : off;
      ctx.fillRect(px, R(y), size, size);
      if (i < filled) { ctx.fillStyle = shade(on, 0.45); ctx.fillRect(px, R(y), size, 1); }
    }
  }
  return count * (size + gap) - gap;
}

// ---------------------------------------------------------------------------
// 9. CURSORS & SELECTION
// ---------------------------------------------------------------------------

/** Bobbing gold arrow that marks the active menu row. */
function cursor(ctx, x, y, t = 0) {
  // The arrow is 5x7 and points right; it bobs +/-1px on a ~1Hz sine so the eye
  // is always pulled to the active row without any flashing.
  const bob = Math.round(Math.sin(t * 6) * 1.5);
  const px = R(x) + bob;
  const py = R(y);
  // widths of each scanline of the triangle, top -> bottom
  const rows = [1, 2, 3, 4, 3, 2, 1];
  // 1px black keyline first, so the arrow reads over any tile or portrait
  ctx.fillStyle = '#0a0708';
  for (let i = 0; i < rows.length; i++) {
    ctx.fillRect(px - 1, py + i - 1, rows[i] + 2, 3);
  }
  for (let i = 0; i < rows.length; i++) {
    ctx.fillStyle = i < 3 ? COLORS.goldBright : (i === 3 ? COLORS.gold : COLORS.goldDim);
    ctx.fillRect(px, py + i, rows[i], 1);
  }
}

/**
 * Animated selection outline: marching gold dashes plus pulsing corner brackets.
 * Used everywhere a grid cell / portrait / card is highlighted.
 */
function frameSel(ctx, x, y, w, h, t = 0, opts = {}) {
  x = R(x); y = R(y); w = R(w); h = R(h);
  if (w <= 2 || h <= 2) return;
  const col = opts.color || COLORS.gold;
  const bright = opts.bright || COLORS.goldBright;
  const period = opts.period || 8;             // dash cycle length in px
  const offset = Math.floor((t * (opts.speed || 14)) % period);

  // marching ants around the perimeter
  ctx.fillStyle = col;
  for (let i = 0; i < w; i++) {
    if ((i + offset) % period < period / 2) {
      ctx.fillRect(x + i, y, 1, 1);
      ctx.fillRect(x + w - 1 - i, y + h - 1, 1, 1);
    }
  }
  for (let i = 0; i < h; i++) {
    if ((i + offset) % period < period / 2) {
      ctx.fillRect(x + w - 1, y + i, 1, 1);
      ctx.fillRect(x, y + h - 1 - i, 1, 1);
    }
  }

  // corner brackets pulse in and out by one pixel
  const puls = Math.sin(t * 5) > 0 ? 1 : 0;
  const L = Math.min(4, Math.floor(Math.min(w, h) / 3));
  ctx.fillStyle = bright;
  const cs = [[x - puls, y - puls, 1, 1], [x + w - 1 + puls, y - puls, -1, 1],
    [x - puls, y + h - 1 + puls, 1, -1], [x + w - 1 + puls, y + h - 1 + puls, -1, -1]];
  for (const [cx, cy, sx, sy] of cs) {
    for (let i = 0; i < L; i++) {
      ctx.fillRect(cx + sx * i, cy, 1, 1);
      ctx.fillRect(cx, cy + sy * i, 1, 1);
    }
  }
}

/** Static highlight wash behind a selected row. */
function highlight(ctx, x, y, w, h, opts = {}) {
  const col = opts.color || COLORS.gold;
  const a = opts.alpha == null ? 0.16 : opts.alpha;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * a;
  vgrad(ctx, R(x), R(y), R(w), R(h), shade(col, 0.3), shade(col, -0.35));
  ctx.globalAlpha = prev;
  ctx.fillStyle = col;
  ctx.fillRect(R(x), R(y), 1, R(h));
}

// ---------------------------------------------------------------------------
// 10. PIXEL ICONS
// ---------------------------------------------------------------------------
// Each icon is an 8x8 grid. Palette chars:
//   .  transparent      K outline/black    W white/bone-light   N bone  n bone-dark
//   M base colour (the `color` argument)   L base light   D base dark
//   S steel  s steel-dark   G gold  g gold-dark   B wood  b wood-dark
//   R red    r red-dark     E green e green-dark  U blue  u blue-dark
//   P purple p purple-dark  C cyan  Y yellow      H skin  X near-black

const ICON_FIXED = {
  K: '#140f0c', W: '#f6efe0', N: '#e8e0c8', n: '#a89a78',
  S: '#b9c1cf', s: '#79839a', G: '#e3b34a', g: '#a37a26',
  B: '#8a5a30', b: '#5a3a1e', R: '#c8452f', r: '#8a2c1e',
  E: '#5fae52', e: '#2f7a3c', U: '#4a7ad0', u: '#2b4c96',
  P: '#a76ad8', p: '#6b3f9e', C: '#63d6d0', Y: '#f0d264',
  H: '#e0a878', X: '#1a1414',
};

/** name -> { base, g:[8 rows of 8] } */
const ICONS = {
  // --- weapons ---------------------------------------------------------------
  sword: { base: '#c9d2e0', g: ['....S...', '...SSs..', '...SSs..', '...SSs..', '.GGGGGG.', '...Bb...', '...Bb...', '...GG...'] },
  axe: { base: '#c9d2e0', g: ['.SSSB...', 'SSSSB...', 'SSSSB...', '.SSSB...', '....B...', '....B...', '....b...', '....b...'] },
  bow: { base: '#8a5a30', g: ['....B...', '....NBb.', '....N.B.', '....N.B.', '....N.B.', '....NBb.', '....B...', '........'] },
  dagger: { base: '#c9d2e0', g: ['....S...', '...SSs..', '...SSs..', '..GGGGG.', '....Bb..', '....Bb..', '...GGG..', '........'] },
  staff: { base: '#63d6d0', g: ['...CC...', '..CWWC..', '...CC...', '....B...', '....B...', '....B...', '....B...', '....b...'] },
  mace: { base: '#c9d2e0', g: ['...s.s..', '..sSSSs.', '..SSSSS.', '...sSs..', '....B...', '....B...', '....B...', '...GGG..'] },
  spear: { base: '#c9d2e0', g: ['....S...', '...SSS..', '...SSS..', '....S...', '....B...', '....B...', '....B...', '....b...'] },
  // --- protection ------------------------------------------------------------
  shield: { base: '#c9d2e0', g: ['.SSSSSS.', '.SGGGGS.', '.SGWWGS.', '.SGWWGS.', '.sSGGSs.', '..sSSs..', '...ss...', '........'] },
  helm: { base: '#c9d2e0', g: ['..SSSS..', '.SSSSSS.', 'SSSSSSSS', 'SKKSSKKS', 'SSSSSSSS', 'SsSSSSsS', '.ss..ss.', '........'] },
  armor: { base: '#c9d2e0', g: ['.SS..SS.', 'SSSSSSSS', 'SSSSSSSS', 'SSsSSsSS', '.SSSSSS.', '.SSSSSS.', '..S..S..', '........'] },
  boots: { base: '#8a5a30', g: ['........', '.BB..BB.', '.BB..BB.', '.BB..BB.', '.BB..BB.', '.BBB.BBB', 'bbbb.bbb', '........'] },
  cloak: { base: '#7a3050', g: ['..MMMM..', '.MMMMMM.', 'MMDMMDMM', 'MMMMMMMM', 'MMMMMMMM', '.MMMMMM.', '.M.MM.M.', '........'] },
  // --- trinkets --------------------------------------------------------------
  ring: { base: '#e3b34a', g: ['...CC...', '..GCCG..', '.G....G.', '.G....G.', '.G....G.', '..G..G..', '...GG...', '........'] },
  amulet: { base: '#e3b34a', g: ['.n....n.', '..n..n..', '...GG...', '..GCCG..', '.GCWWCG.', '.GCCCCG.', '..GGGG..', '........'] },
  gem: { base: '#63d6d0', g: ['........', '..MMMM..', '.MWWMMM.', 'MMMMMMMM', '.MMMMMM.', '..MMMM..', '...MM...', '........'] },
  coin: { base: '#e3b34a', g: ['..gggg..', '.gGGGGg.', 'gGGWWGGg', 'gGWGGWGg', 'gGGWWGGg', '.gGGGGg.', '..gggg..', '........'] },
  crown: { base: '#e3b34a', g: ['........', 'G..GG..G', 'GG.GG.GG', 'GGGGGGGG', 'GGCGGCGG', 'GGGGGGGG', 'gggggggg', '........'] },
  // --- consumables & tools ---------------------------------------------------
  potion: { base: '#c8452f', g: ['...bb...', '...KK...', '...MM...', '..KMMK..', '.KMMMMK.', '.KMLLMK.', '.KMMMMK.', '..KKKK..'] },
  flask: { base: '#5fae52', g: ['...bb...', '...SS...', '...SS...', '..SSSS..', '.SMMMMS.', 'SMMMMMMS', 'SMMMMMMS', '.SSSSSS.'] },
  scroll: { base: '#e8e0c8', g: ['.nnnnnn.', 'nNNNNNNn', 'nNbbbbNn', 'nNNNNNNn', 'nNbbbbNn', 'nNNNNNNn', 'nNbbbNNn', '.nnnnnn.'] },
  book: { base: '#8a2c1e', g: ['.RRRRRR.', 'RRNNNNRR', 'RRNGGNRR', 'RRNNNNRR', 'RRNGGNRR', 'RRNNNNRR', '.rrrrrr.', '........'] },
  wand: { base: '#63d6d0', g: ['.....W..', '....WCW.', '.....W..', '....B...', '...B....', '..B.....', '.b......', 'b.......'] },
  key: { base: '#e3b34a', g: ['..GGG...', '.G.g.G..', '.G...G..', '..GGG...', '...G....', '...GG...', '...G....', '...GGG..'] },
  chest: { base: '#8a5a30', g: ['.bbbbbb.', 'bBBBBBBb', 'bBGGGGBb', '.bbbbbb.', 'bBBGGBBb', 'bBBGGBBb', 'bBBBBBBb', '.bbbbbb.'] },
  bag: { base: '#8a5a30', g: ['..b..b..', '..bbbb..', '.BBBBBB.', 'BBBBBBBB', 'BBBGGBBB', 'BBBGGBBB', 'BBBBBBBB', '.BBBBBB.'] },
  candle: { base: '#f07a2a', g: ['....M...', '...MMM..', '...MM...', '....K...', '..NNNN..', '..NNNN..', '..NNNN..', '.nnnnnn.'] },
  anvil: { base: '#c9d2e0', g: ['........', '.SSSSSS.', 'SSSSSSSS', '.sSSSSs.', '..SSSS..', '..sSSs..', '.SSSSSS.', '.ssssss.'] },
  hammer: { base: '#c9d2e0', g: ['.SSSSSS.', 'SSSSSSSS', 'SSsSSsSS', '...BB...', '...BB...', '...BB...', '...BB...', '...bb...'] },
  map: { base: '#e8e0c8', g: ['.NNnNNn.', 'NNNnNNnN', 'NNNnNNnN', 'NRNnNNnN', 'NNRnNNnN', 'NNNnNNnN', 'NNNnNNnN', '.NNnNNn.'] },
  hourglass: { base: '#e3b34a', g: ['GGGGGGGG', '.YYYYYY.', '..YYYY..', '...YY...', '...YY...', '..Y..Y..', '.Y....Y.', 'GGGGGGGG'] },
  dice: { base: '#f6efe0', g: ['.WWWWWW.', 'WWWWWWWW', 'WWKWWKWW', 'WWWWWWWW', 'WWWWWWWW', 'WWKWWKWW', 'WWWWWWWW', '.WWWWWW.'] },
  d20: { base: '#c3a2ff', g: ['...MM...', '..MLLM..', '.MLLLLM.', 'MLLLLLLM', 'MDLLLLDM', '.DMMMMD.', '..DMMD..', '...DD...'] },
  lock: { base: '#e3b34a', g: ['..SSSS..', '.SS..SS.', '.SS..SS.', 'GGGGGGGG', 'GGGKKGGG', 'GGGKKGGG', 'GGGGGGGG', '........'] },
  quest: { base: '#e3b34a', g: ['..GGGG..', '.GGGGGG.', 'GGGKKGGG', 'GGGKKGGG', 'GGGKKGGG', 'GGGGGGGG', 'GGGKKGGG', '.GGGGGG.'] },
  eye: { base: '#c9d2e0', g: ['........', '..MMMM..', '.MWWWWM.', 'MWUKKUWM', 'MWUKKUWM', '.MWWWWM.', '..MMMM..', '........'] },
  // --- vitals ----------------------------------------------------------------
  heart: { base: COLORS.hp, g: ['.MM..MM.', 'MLMMMMMM', 'MLMMMMMM', 'MMMMMMMM', '.MMMMMM.', '..MMMM..', '...MM...', '........'] },
  mana: { base: COLORS.mp, g: ['...MM...', '...MM...', '..MMMM..', '.MMMMMM.', 'MMMMMMMM', 'MMLMMMMM', '.MMMMMM.', '..MMMM..'] },
  star: { base: COLORS.gold, g: ['...MM...', '...MM...', 'MMMMMMMM', '.MMMMMM.', '..MMMM..', '.MMMMMM.', '.MM..MM.', '........'] },
  skull: { base: '#e8e0c8', g: ['..NNNN..', '.NNNNNN.', 'NKKNNKKN', 'NKKNNKKN', 'NNNKNNNN', '.NNNNNN.', '..NNNN..', '..N.N.N.'] },
  // --- damage schools --------------------------------------------------------
  flame: { base: DAMAGE_COLORS.fire, g: ['....M...', '...MM...', '..MMM...', '..MMMM..', '.MMLMMM.', 'MMLLLMMM', 'MMLLLMMM', '.MMMMMM.'] },
  frost: { base: DAMAGE_COLORS.cold, g: ['...M....', 'M..M..M.', '.M.M.M..', '..MMM...', 'MMMMMMMM', '..MMM...', '.M.M.M..', 'M..M..M.'] },
  bolt: { base: DAMAGE_COLORS.lightning, g: ['....MMM.', '...MMM..', '..MMM...', '.MMMMMM.', '...MMM..', '..MMM...', '.MMM....', '.MM.....'] },
  thunder: { base: DAMAGE_COLORS.thunder, g: ['..MMMM..', '.MMMMMM.', 'MMMMMMMM', '.MMMMMM.', '...LL...', '..LL....', '...LL...', '..L.....'] },
  acid: { base: DAMAGE_COLORS.acid, g: ['....M...', '...MMM..', '..MMMMM.', '.MMLMMMM', '.MMMMMMM', '..MMMMM.', 'M.......', 'MM....M.'] },
  poison: { base: DAMAGE_COLORS.poison, g: ['...MM...', '..MMMM..', '.MMMMMM.', 'MMKMMKMM', 'MMMMMMMM', '.MKMMKM.', '..MMMM..', '...MM...'] },
  psychic: { base: DAMAGE_COLORS.psychic, g: ['..MMMM..', '.MLMMLM.', 'MMMLMMMM', 'MLMMMLMM', 'MMMLMMMM', '.MMLMMM.', '..MMMM..', '........'] },
  force: { base: DAMAGE_COLORS.force, g: ['..MMMM..', '.M....M.', 'M......M', 'M......M', 'M......M', 'M......M', '.M....M.', '..MMMM..'] },
  radiant: { base: DAMAGE_COLORS.radiant, g: ['...M....', 'M..M..M.', '.M.M.M..', '..LLL...', 'MMLLLMM.', '..LLL...', '.M.M.M..', 'M..M..M.'] },
  necrotic: { base: DAMAGE_COLORS.necrotic, g: ['..MMMM..', '.MMMMMM.', 'MMKMMMMM', 'MMMKMMMM', 'MMMMKMMM', '.MMMKMM.', '..MMMM..', '..M..M..'] },
  holy: { base: '#ffe9a8', g: ['...MM...', '...MM...', '.M.MM.M.', 'MMMMMMMM', '.M.MM.M.', '...MM...', '...MM...', '........'] },
  shadow: { base: '#5a4a7a', g: ['..MMMM..', '.MMMMMM.', 'MMWMMWMM', 'MMMMMMMM', 'MMMMMMMM', '.MMMMMM.', '..M.M.M.', '........'] },
  leaf: { base: '#5fae52', g: ['......MM', '....MMMM', '..MMMMMM', '.MMLMMM.', 'MMLMMM..', 'MMLMM...', '.MLM....', '..M.....'] },
  wind: { base: '#b8d0e0', g: ['........', '.MMMMM..', '.....MM.', '...MMM..', 'MMMMMMM.', '......M.', '.MMMMM..', '........'] },
  rune: { base: '#c3a2ff', g: ['..MMMM..', '.M....M.', 'M..MM..M', 'M.MMMM.M', 'M.MMMM.M', 'M..MM..M', '.M....M.', '..MMMM..'] },
  // --- markers & verbs -------------------------------------------------------
  check: { base: COLORS.good, g: ['.......M', '......MM', '.....MM.', 'M...MM..', 'MM.MM...', '.MMM....', '..M.....', '........'] },
  cross: { base: COLORS.bad, g: ['M......M', 'MM....MM', '.MM..MM.', '..MMMM..', '..MMMM..', '.MM..MM.', 'MM....MM', 'M......M'] },
  plus: { base: COLORS.good, g: ['........', '...MM...', '...MM...', '.MMMMMM.', '.MMMMMM.', '...MM...', '...MM...', '........'] },
  minus: { base: COLORS.bad, g: ['........', '........', '........', '.MMMMMM.', '.MMMMMM.', '........', '........', '........'] },
  'arrow-up': { base: COLORS.good, g: ['...MM...', '..MMMM..', '.MMMMMM.', 'MMMMMMMM', '...MM...', '...MM...', '...MM...', '........'] },
  'arrow-down': { base: COLORS.bad, g: ['...MM...', '...MM...', '...MM...', 'MMMMMMMM', '.MMMMMM.', '..MMMM..', '...MM...', '........'] },
  target: { base: COLORS.bad, g: ['...MM...', '.MMMMMM.', '.MM..MM.', 'MM.RR.MM', 'MM.RR.MM', '.MM..MM.', '.MMMMMM.', '...MM...'] },
  foot: { base: '#e0a878', g: ['.M.M.M..', '..MMM...', '.MMMMM..', '.MMMMM..', '..MMM...', '..MMM...', '.MMMM...', '..MM....'] },
  run: { base: '#6ac0f0', g: ['.....MM.', '.....MM.', '..M.MM..', '.MMMMM..', 'M.MM.M..', '..MM....', '.MM.MM..', 'MM...MM.'] },
  dash: { base: '#6ac0f0', g: ['M...M...', '.M...M..', '..M...M.', '...M...M', '..M...M.', '.M...M..', 'M...M...', '........'] },
  dodge: { base: '#6ac0f0', g: ['....MM..', '..MM..M.', '.M.....M', 'M.......', '.M......', '..MM....', '....MM..', '.....MM.'] },
};

const iconCache = boundedCache(320);

/** Build the per-icon palette; `M/L/D` derive from the requested base colour. */
function iconPalette(base) {
  return {
    ...ICON_FIXED,
    M: base,
    L: shade(base, 0.34),
    D: shade(base, -0.34),
  };
}

function buildIcon(name, size, color) {
  const def = ICONS[name];
  if (!def) return null;
  const pal = iconPalette(color || def.base || COLORS.ink);
  const cv = makeCanvas(size, size);
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  // Distribute the 8 source pixels across `size` device pixels without gaps:
  // each column/row gets floor((i+1)*s) - floor(i*s) pixels, so 12px works too.
  const edge = [];
  for (let i = 0; i <= 8; i++) edge.push(Math.round((i * size) / 8));
  for (let ry = 0; ry < 8; ry++) {
    const row = def.g[ry] || '........';
    for (let rx = 0; rx < 8; rx++) {
      const ch = row[rx];
      if (!ch || ch === '.' || ch === ' ') continue;
      const col = pal[ch];
      if (!col) continue;
      c.fillStyle = col;
      c.fillRect(edge[rx], edge[ry], Math.max(1, edge[rx + 1] - edge[rx]), Math.max(1, edge[ry + 1] - edge[ry]));
    }
  }
  return cv;
}

/**
 * UI.icon — draw a procedural pixel icon, cached per name|size|color.
 * Unknown names draw a small neutral rune so a typo never blanks the UI.
 */
function icon(ctx, name, x, y, size = 8, color = null) {
  size = Math.max(4, R(size));
  const key = `${name}|${size}|${color || ''}`;
  let cv = iconCache.get(key);
  if (cv === undefined) {
    cv = iconCache.set(key, buildIcon(name, size, color) || buildIcon('rune', size, color || COLORS.inkDim));
  }
  if (!cv) return false;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cv, R(x), R(y));
  ctx.imageSmoothingEnabled = prev;
  return true;
}

/** Every registered icon id — useful for editors and debug screens. */
const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/** Damage type -> icon id, so combat logs can decorate themselves. */
const DAMAGE_ICONS = Object.freeze({
  slashing: 'sword', piercing: 'spear', bludgeoning: 'hammer',
  fire: 'flame', cold: 'frost', lightning: 'bolt', thunder: 'thunder',
  acid: 'acid', poison: 'poison', necrotic: 'necrotic', radiant: 'radiant',
  psychic: 'psychic', force: 'force', healing: 'plus',
});

// ---------------------------------------------------------------------------
// 11. WIDGETS
// ---------------------------------------------------------------------------

/**
 * UI.button — a framed, label-centred control.
 * opts: { selected, disabled, icon, hint, t, style, color, align }
 */
function button(ctx, x, y, w, h, label, opts = {}) {
  x = R(x); y = R(y); w = R(w); h = R(h);
  const sel = !!opts.selected;
  const dis = !!opts.disabled;
  const style = opts.style || (dis ? 'plain' : sel ? 'gold' : 'window');
  const p = nineSlice(ctx, x, y, w, h, { style, alpha: dis ? 0.62 : 1, shadow: sel ? 0.5 : 0.3 });

  let ink = opts.color || (sel ? '#2a1c07' : COLORS.ink);
  if (dis) ink = COLORS.disabled;
  if (sel && style !== 'gold') ink = COLORS.goldBright;

  const m = metrics('md');
  const ty = y + Math.round((h - m.capH) / 2) - 1;
  let tx = x + Math.round(w / 2);
  let align = opts.align || 'center';

  let ix = x + 4;
  if (opts.icon) {
    const isz = Math.min(10, h - 4);
    icon(ctx, opts.icon, ix, y + Math.round((h - isz) / 2), isz, dis ? COLORS.disabled : null);
    ix += isz + 3;
    if (align === 'center') { align = 'left'; tx = ix; }
  }

  // Same rule as `list()`: a right-aligned hint with no `maxWidth` walks off
  // the left edge of its own button. It keeps at most 40% of the face.
  const face = w - (ix - x) - 4;
  let hintW = 0;
  if (opts.hint) {
    const hw = Math.min(measureGlyphs(opts.hint, 'sm'), Math.round(face * 0.4));
    hintW = hw + 4;
    text(ctx, x + w - 4, ty + 1, opts.hint, {
      size: 'sm', color: dis ? COLORS.disabled : COLORS.inkDim, align: 'right', shadow: true, maxWidth: hw,
    });
  }

  const avail = face - hintW;
  // A centred label centres on the WHOLE face, so with a hint on the right it
  // still ran under the hint even though `avail` had been reduced for it.
  // Recentre on the space the hint leaves.
  if (align === 'center' && hintW > 0) tx -= Math.round(hintW / 2);
  text(ctx, tx, ty, String(label == null ? '' : label), {
    size: 'md', color: ink, align, shadow: sel ? 'rgba(255,230,170,0.30)' : true, maxWidth: Math.max(0, avail),
  });

  if (sel && !dis) frameSel(ctx, x - 1, y - 1, w + 2, h + 2, opts.t || 0);
  if (dis) {
    // hatch the face so "disabled" reads without relying on colour alone
    ctx.fillStyle = 'rgba(10,7,8,0.28)';
    for (let i = 0; i < h; i += 2) ctx.fillRect(p.ix, p.iy + i, p.iw, 1);
  }
  return { x, y, w, h };
}

/** A small keycap + label, e.g. [Z] Confirm. Returns the total width drawn. */
function keyHint(ctx, x, y, key, label, opts = {}) {
  key = String(key == null ? '' : key).toUpperCase();
  const kw = Math.max(9, measureGlyphs(key, 'sm') + 6);
  const kh = opts.h || 11;
  const dim = opts.disabled ? 0.5 : 1;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * dim;

  nineSlice(ctx, x, y, kw, kh, { style: 'gold', shadow: 0.28, studs: false });
  text(ctx, R(x + kw / 2), y + 2, key, { size: 'sm', color: '#2a1c07', align: 'center', shadow: false });

  let w = kw;
  if (label) {
    text(ctx, x + kw + 3, y + 2, String(label), { size: 'sm', color: opts.color || COLORS.inkDim, shadow: true });
    w += 3 + measureGlyphs(label, 'sm');
  }
  ctx.globalAlpha = prev;
  return w;
}

/** Horizontal rule with a gold fade and an optional centred caption. */
function divider(ctx, x, y, w, opts = {}) {
  x = R(x); y = R(y); w = R(w);
  const col = opts.color || COLORS.border;
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.15, col);
  g.addColorStop(0.85, col);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = 'rgba(255,235,190,0.10)';
  ctx.fillRect(x, y + 1, w, 1);
  if (opts.label) {
    const lw = measureGlyphs(opts.label, opts.size || 'sm') + 8;
    const lx = R(x + (w - lw) / 2);
    ctx.fillStyle = opts.bg || COLORS.panel;
    ctx.fillRect(lx, y - 3, lw, 8);
    text(ctx, R(x + w / 2), y - 3, opts.label, {
      size: opts.size || 'sm', color: opts.labelColor || COLORS.goldDim, align: 'center', shadow: true,
    });
  }
  return y + 2;
}

/**
 * UI.list — scrolling menu list with a window and scrollbar.
 * items: string | { label, icon, value, color, hint, disabled, sub }
 * opts:  { rows, rowH, top, size, t, cursor, scrollbar, empty, render, width }
 * Returns { top, rows, rowH, h } — persist `top` on the caller for smooth scroll.
 */
function list(ctx, x, y, w, items, index, opts = {}) {
  x = R(x); y = R(y); w = R(w);
  items = items || [];
  const rowH = opts.rowH || 12;
  const rows = Math.max(1, opts.rows || 6);
  const t = opts.t || 0;
  const n = items.length;

  // keep the cursor inside the window
  let top = opts.top | 0;
  if (index >= 0) {
    if (index < top) top = index;
    if (index > top + rows - 1) top = index - rows + 1;
  }
  top = clamp(top, 0, Math.max(0, n - rows));

  const h = rows * rowH;
  const showBar = opts.scrollbar !== false && n > rows;
  const barW = showBar ? 4 : 0;
  const rowW = w - barW - (showBar ? 2 : 0);

  if (opts.style) nineSlice(ctx, x - 2, y - 2, w + 4, h + 4, { style: opts.style });

  if (!n) {
    text(ctx, R(x + w / 2), y + Math.round(h / 2) - 3, opts.empty || '(nothing here)', {
      size: 'sm', color: COLORS.disabled, align: 'center', shadow: true,
    });
    return { top, rows, rowH, h };
  }

  pushClip(ctx, x - 1, y - 1, w + 2, h + 2);
  for (let i = 0; i < rows && top + i < n; i++) {
    const ix = top + i;
    const raw = items[ix];
    const it = typeof raw === 'string' ? { label: raw } : (raw || {});
    const ry = y + i * rowH;
    const sel = ix === index;
    const dis = !!it.disabled;

    if (sel) highlight(ctx, x, ry, rowW, rowH - 1, { alpha: dis ? 0.10 : 0.20 });
    if (opts.stripe && (ix & 1)) { ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(x, ry, rowW, rowH - 1); }

    if (typeof opts.render === 'function') {
      opts.render(ctx, it, ix, x, ry, rowW, rowH, sel);
    } else {
      let lx = x + (opts.cursor === false ? 3 : 9);
      if (it.icon) { icon(ctx, it.icon, lx, ry + Math.round((rowH - 9) / 2), 8, dis ? COLORS.disabled : it.iconColor || null); lx += 11; }
      // The row is split label-first: a refusal reason like
      // "✗ Kingdom of Many-Arrows 2" is 155px, and drawing it right-aligned
      // with no `maxWidth` used to leave the choice itself 20 characters of a
      // 294px row. The hint keeps at most 40% and is clamped to it.
      const avail = rowW - (lx - x) - 2;
      let hintW = 0;
      if (it.hint != null && it.hint !== '') {
        const hs = String(it.hint);
        const hw = Math.min(measureGlyphs(hs, 'sm'), Math.round(avail * 0.4));
        hintW = hw + 5;
        text(ctx, x + rowW - 3, ry + Math.round((rowH - 6) / 2), hs, {
          size: 'sm', color: dis ? COLORS.disabled : (it.hintColor || COLORS.inkDim), align: 'right', shadow: true,
          maxWidth: hw,
        });
      }
      const col = dis ? COLORS.disabled : (it.color || (sel ? COLORS.goldBright : COLORS.ink));
      text(ctx, lx, ry + Math.round((rowH - 6) / 2), String(it.label == null ? raw : it.label), {
        size: sel ? 'md' : 'sm', color: col, shadow: true, maxWidth: avail - hintW,
      });
    }
    if (sel && opts.cursor !== false && !dis) cursor(ctx, x + 1, ry + Math.round((rowH - 7) / 2), t);
  }
  popClip(ctx);

  if (showBar) {
    const bx = x + w - barW;
    // trough
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx, y, barW, h);
    rectStroke(ctx, bx, y, barW, h, 'rgba(0,0,0,0.8)', 1);
    // thumb: proportional, minimum 6px so it never vanishes on long lists
    const th = Math.max(6, Math.round((rows / n) * h));
    const maxTop = Math.max(1, n - rows);
    const ty = y + Math.round(((h - th) * top) / maxTop);
    vgrad(ctx, bx + 1, ty, barW - 2, th, COLORS.gold, COLORS.goldDim);
    ctx.fillStyle = COLORS.goldBright;
    ctx.fillRect(bx + 1, ty, barW - 2, 1);
    // more-below / more-above chevrons
    if (top > 0) text(ctx, bx + barW / 2, y - 6, '▲', { size: 'sm', color: COLORS.goldDim, align: 'center' });
    if (top + rows < n) text(ctx, bx + barW / 2, y + h + 1, '▼', { size: 'sm', color: COLORS.goldDim, align: 'center' });
  }

  return { top, rows, rowH, h };
}

/**
 * UI.tabs — a horizontal tab strip. tabs: string[] | {label, icon}[]
 * Returns the y of the content area's top edge.
 */
function tabs(ctx, x, y, w, tabList, index, opts = {}) {
  x = R(x); y = R(y); w = R(w);
  const n = Math.max(1, (tabList || []).length);
  const h = opts.h || 13;
  const tw = Math.floor(w / n);
  for (let i = 0; i < n; i++) {
    const raw = tabList[i];
    const it = typeof raw === 'string' ? { label: raw } : (raw || {});
    const tx = x + i * tw;
    const cw = i === n - 1 ? w - tw * (n - 1) : tw;
    const on = i === index;
    nineSlice(ctx, tx, on ? y - 1 : y + 1, cw, on ? h + 1 : h - 1, {
      style: on ? 'gold' : 'dark', shadow: on ? 0.35 : 0.15, studs: false,
    });
    let lx = tx + Math.round(cw / 2);
    let align = 'center';
    if (it.icon) {
      icon(ctx, it.icon, tx + 3, y + 2, 8, on ? '#3a2a08' : null);
      lx = tx + 13; align = 'left';
    }
    text(ctx, lx, y + (on ? 2 : 4), String(it.label == null ? raw : it.label), {
      size: on ? 'md' : 'sm', color: on ? '#2a1c07' : (it.disabled ? COLORS.disabled : COLORS.inkDim),
      align, shadow: on ? 'rgba(255,230,170,0.3)' : true, maxWidth: cw - (it.icon ? 16 : 6),
    });
    if (it.badge) {
      ctx.fillStyle = COLORS.bad;
      ctx.fillRect(tx + cw - 5, y + 1, 3, 3);
    }
  }
  // baseline that the active tab "sits on"
  ctx.fillStyle = COLORS.goldDim;
  ctx.fillRect(x, y + h, w, 1);
  return y + h + 1;
}

/**
 * UI.grid — slot grid for inventory / equipment / spell slots.
 * Returns the array of cell rects so callers can hit-test and draw contents.
 */
function grid(ctx, x, y, cols, rows, cell, opts = {}) {
  x = R(x); y = R(y);
  const gap = opts.gap == null ? 2 : opts.gap;
  const cw = opts.cellW || cell;
  const ch = opts.cellH || cell;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const cx = x + c * (cw + gap);
      const cy = y + r * (ch + gap);
      const rect = { x: cx, y: cy, w: cw, h: ch, i, col: c, row: r };
      out.push(rect);
      const it = opts.items ? opts.items[i] : null;
      nineSlice(ctx, cx, cy, cw, ch, { style: opts.style || 'inset', shadow: 0 });
      if (typeof opts.drawCell === 'function') opts.drawCell(ctx, i, rect, it);
      else if (it) {
        if (it.icon) icon(ctx, it.icon, cx + Math.round((cw - 10) / 2), cy + Math.round((ch - 10) / 2), 10, it.tint || null);
        if (it.qty > 1) {
          text(ctx, cx + cw - 2, cy + ch - 8, String(it.qty), { size: 'sm', color: COLORS.ink, align: 'right', shadow: true });
        }
      }
      if (i === opts.index) frameSel(ctx, cx - 1, cy - 1, cw + 2, ch + 2, opts.t || 0);
    }
  }
  return out;
}

/**
 * UI.tooltip — an auto-sized dark panel, clamped inside the logical viewport.
 * opts: { title, w, size, color, icon, footer, anchor:'above'|'below'|'auto' }
 */
function tooltip(ctx, x, y, body, opts = {}) {
  const maxW = opts.w || 132;
  const size = opts.size || 'sm';
  const lines = wrapLines(String(body == null ? '' : body), maxW - 10, size);
  const m = metrics(size);
  const titleH = opts.title ? 10 : 0;
  const footH = opts.footer ? 9 : 0;
  let widest = 0;
  for (const l of lines) widest = Math.max(widest, measureGlyphs(l, size));
  if (opts.title) widest = Math.max(widest, measureGlyphs(opts.title, 'md') + (opts.icon ? 11 : 0));
  if (opts.footer) widest = Math.max(widest, measureGlyphs(opts.footer, 'sm'));
  const w = Math.min(maxW, widest + 10);
  const h = 8 + titleH + lines.length * m.lineH + footH;

  // clamp so the tip never leaves the 400x240 logical screen
  let px = clamp(R(x), 2, VIEW_W - w - 2);
  let py = R(y);
  if (opts.anchor === 'above' || (opts.anchor !== 'below' && py + h > VIEW_H - 2)) py = R(y) - h - 4;
  py = clamp(py, 2, VIEW_H - h - 2);

  const p = nineSlice(ctx, px, py, w, h, { style: opts.style || 'dark', shadow: 0.5 });
  let ty = py + 4;
  if (opts.title) {
    let tx = px + 5;
    if (opts.icon) { icon(ctx, opts.icon, tx, ty - 1, 8, opts.iconColor || null); tx += 11; }
    text(ctx, tx, ty, opts.title, { size: 'md', color: opts.titleColor || COLORS.gold, shadow: true, maxWidth: w - (tx - px) - 4 });
    ty += 10;
  }
  for (const l of lines) {
    text(ctx, px + 5, ty, l, { size, color: opts.color || COLORS.ink, shadow: true });
    ty += m.lineH;
  }
  if (opts.footer) {
    text(ctx, px + 5, ty, opts.footer, { size: 'sm', color: opts.footerColor || COLORS.inkDim, shadow: true });
  }
  return { x: px, y: py, w, h, inner: p };
}

/** A tiny coloured chip with a label — resistances, tags, damage types. */
function chip(ctx, x, y, label, opts = {}) {
  const size = opts.size || 'sm';
  const pad = opts.icon ? 12 : 3;
  const w = measureGlyphs(label, size) + pad + 3;
  const h = opts.h || 9;
  const col = opts.color || COLORS.inkDim;
  ctx.fillStyle = opts.bg || 'rgba(0,0,0,0.55)';
  ctx.fillRect(R(x), R(y), w, h);
  rectStroke(ctx, R(x), R(y), w, h, shade(col, -0.4), 1);
  if (opts.icon) icon(ctx, opts.icon, R(x) + 1, R(y) + Math.round((h - 8) / 2), 8, col);
  text(ctx, R(x) + pad, R(y) + Math.round((h - 6) / 2), label, { size, color: col, shadow: false });
  return w;
}

// ---------------------------------------------------------------------------
// 12. PORTRAITS
// ---------------------------------------------------------------------------

/**
 * UI.portrait — a framed bust for a Character.
 * Uses the character's sprite family if one is registered, otherwise paints a
 * procedural bust straight from ch.colorway. Never throws on a missing sprite.
 */
function portrait(ctx, ch, x, y, size = 32, opts = {}) {
  x = R(x); y = R(y); size = R(size);
  const style = opts.style || (ch && ch.side === 'foe' ? 'danger' : 'window');
  const f = nineSlice(ctx, x, y, size, size, { style, shadow: opts.shadow != null ? opts.shadow : 0.35 });
  const ix = f.ix + 1, iy = f.iy + 1;
  const iw = Math.max(1, f.iw - 2), ih = Math.max(1, f.ih - 2);

  // backdrop wash keyed to the character's main colour
  const cw = (ch && ch.colorway) || null;
  const back = (cw && cw.MAIN) ? shade(cw.MAIN, -0.62) : '#12141d';
  vgrad(ctx, ix, iy, iw, ih, shade(back, 0.18), shade(back, -0.25));

  pushClip(ctx, ix, iy, iw, ih);
  let drew = false;
  const fam = ch && (ch.sprite || ch.spriteName);
  if (fam) {
    try {
      if (hasSprite(fam)) {
        // Sprites are 16x24 with the head in rows ~1..13; blow that band up to
        // fill the frame and clip the rest away.
        const s = Math.max(1, Math.round(ih / 13));
        const dx = ix + Math.round((iw - 16 * s) / 2);
        const dy = iy - Math.round(1 * s);
        drew = drawSprite(ctx, fam, opts.frame || 'down-0', dx, dy, {
          anchor: 'topleft', scale: s, colorway: cw || undefined,
          tint: opts.tint, tintAmt: opts.tintAmt,
        });
      }
    } catch (e) { drew = false; }   // a broken sprite must never kill the frame
  }
  if (!drew) fallbackBust(ctx, ch, ix, iy, iw, ih, cw);

  // downed / dead overlays
  if (ch && (ch.hp != null) && ch.hp <= 0) {
    ctx.fillStyle = 'rgba(120,10,10,0.34)';
    ctx.fillRect(ix, iy, iw, ih);
    icon(ctx, 'skull', ix + Math.round((iw - 10) / 2), iy + Math.round((ih - 10) / 2), 10, '#e8dcc0');
  } else if (opts.dim) {
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(ix, iy, iw, ih);
  }
  popClip(ctx);

  if (opts.selected) frameSel(ctx, x - 1, y - 1, size + 2, size + 2, opts.t || 0);
  if (opts.label) {
    text(ctx, x + size / 2, y + size + 1, String(opts.label), {
      size: 'sm', color: COLORS.ink, align: 'center', shadow: true, maxWidth: size + 8,
    });
  }
  return { x, y, w: size, h: size, ix, iy, iw, ih };
}

/** Procedural bust: shoulders, neck, head, hair, eyes — all from the colorway. */
function fallbackBust(ctx, ch, ix, iy, iw, ih, cw) {
  const skin = (cw && cw.SKIN) || '#e0a878';
  const skinD = (cw && cw.SKIN_D) || shade(skin, -0.26);
  const hair = (cw && cw.HAIR) || '#3a2416';
  const hairD = (cw && cw.HAIR_D) || shade(hair, -0.32);
  const main = (cw && cw.MAIN) || '#7a3030';
  const mainD = (cw && cw.MAIN_D) || shade(main, -0.30);
  const eye = (cw && cw.EYE) || '#37527a';
  const outline = (cw && cw.OUTLINE) || '#170f0c';

  const u = Math.max(1, Math.floor(ih / 16));          // one "sprite pixel"
  const cx = ix + Math.round(iw / 2);
  const headW = u * 8, headH = u * 8;
  const hx = cx - Math.round(headW / 2);
  const hy = iy + u * 2;

  // shoulders / torso
  const shW = u * 14, shH = ih - (hy - iy) - headH;
  if (shH > 0) {
    ctx.fillStyle = outline;
    ctx.fillRect(cx - Math.round(shW / 2) - u, hy + headH, shW + u * 2, shH);
    vgrad(ctx, cx - Math.round(shW / 2), hy + headH, shW, shH, main, mainD);
    ctx.fillStyle = (cw && cw.TRIM) || '#e3b34a';
    ctx.fillRect(cx - u, hy + headH, u * 2, shH);       // collar seam
  }
  // neck
  ctx.fillStyle = skinD;
  ctx.fillRect(cx - u, hy + headH - u, u * 2, u * 2);
  // head
  ctx.fillStyle = outline;
  ctx.fillRect(hx - u, hy - u, headW + u * 2, headH + u * 2);
  vgrad(ctx, hx, hy, headW, headH, skin, skinD);
  // hair cap + sideburns
  ctx.fillStyle = hair;
  ctx.fillRect(hx, hy, headW, u * 2);
  ctx.fillRect(hx - u, hy, u, u * 4);
  ctx.fillRect(hx + headW, hy, u, u * 4);
  ctx.fillStyle = hairD;
  ctx.fillRect(hx, hy + u * 2, headW, u);
  // eyes
  ctx.fillStyle = eye;
  ctx.fillRect(hx + u, hy + u * 4, u, u);
  ctx.fillRect(hx + headW - u * 2, hy + u * 4, u, u);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(hx, hy + headH - u, headW, u);           // chin shade

  if (!ch) {
    // unknown character: stamp a question mark over the silhouette
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(ix, iy, iw, ih);
    text(ctx, ix + iw / 2, iy + Math.round(ih / 2) - 4, '?', { size: 'lg', color: COLORS.inkDim, align: 'center' });
  }
}

// ---------------------------------------------------------------------------
// 13. THE d20 POPUP
// ---------------------------------------------------------------------------

const TUMBLE_TIME = 0.35;    // seconds of spinning before the face locks
const POP_TIME = 0.12;       // squash-and-stretch after the lock
const STAMP_DELAY = 0.18;    // pause before HIT / MISS slams down

/** The die body: a flat-topped icosahedron silhouette, 15x15 at scale 1. */
function drawD20Body(ctx, cx, cy, s, faceCol, edgeCol, darkCol) {
  // Every vertex is rounded to a whole pixel and strokes sit on .5 boundaries,
  // so the die stays as crisp as the rest of the UI.
  const half = R(7 * s);
  const sh = R(half * 0.45);   // shoulder height of the hexagonal silhouette
  const ft = R(half * 0.72);   // top vertex of the lit face triangle
  const fb = R(half * 0.50);   // bottom edge of the lit face triangle
  const P = (px, py) => ctx.lineTo(R(px), R(py));

  ctx.fillStyle = darkCol;
  ctx.beginPath();
  ctx.moveTo(cx, cy - half);
  P(cx + half, cy - sh); P(cx + half, cy + sh); P(cx, cy + half);
  P(cx - half, cy + sh); P(cx - half, cy - sh);
  ctx.closePath();
  ctx.fill();

  // inner triangle — the numbered face pointing up at the reader
  ctx.fillStyle = faceCol;
  ctx.beginPath();
  ctx.moveTo(cx, cy - ft);
  P(cx + ft, cy + fb); P(cx - ft, cy + fb);
  ctx.closePath();
  ctx.fill();

  // three facet seams radiating from the face's corners to the silhouette
  ctx.strokeStyle = edgeCol;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + 0.5, cy - half); ctx.lineTo(cx + 0.5, cy - ft);
  ctx.moveTo(cx - half + 0.5, cy - sh + 0.5); ctx.lineTo(cx - ft + 0.5, cy + fb + 0.5);
  ctx.moveTo(cx + half - 0.5, cy - sh + 0.5); ctx.lineTo(cx + ft - 0.5, cy + fb + 0.5);
  ctx.stroke();
}

/**
 * UI.diceRoll — the big animated d20 popup shown on every attack roll.
 *
 * `result` accepts a core/dice.js d20() object, optionally decorated by
 * rules/actions.js: { natural, total, mod, crit, fumble, adv, dis, ac, dc, hit,
 *                     label, damage }
 * `t` is seconds since the roll began.
 *
 * Phase 1 (t < 0.35s) the die tumbles through pseudo-random faces; then it locks
 * to `natural` with a pop. A natural 20 glows gold and throws sparks; a natural 1
 * turns red and cracks. The readout is the full arithmetic — "d20 17 +5 = 22 vs
 * AC 15" — because seeing the maths is half the fun of D&D.
 */
function diceRoll(ctx, x, y, result, t = 0) {
  if (!result) return;
  const nat = result.natural != null ? result.natural
    : (Array.isArray(result.rolls) ? result.rolls[0] : result.total) || 1;
  const mod = result.mod || 0;
  const total = result.total != null ? result.total : nat + mod;
  const target = result.ac != null ? result.ac : (result.dc != null ? result.dc : null);
  const targetLabel = result.ac != null ? 'AC' : 'DC';

  const tumbling = t < TUMBLE_TIME;
  // Deterministic tumble faces: hash the frame index so replays look identical.
  const step = Math.floor(t * 26);
  const face = tumbling ? (hashStr(`d20:${nat}:${step}`) % 20) + 1 : nat;

  const crit = !tumbling && (result.crit || nat === 20);
  const fumble = !tumbling && (result.fumble || nat === 1);

  // pop scale: overshoot on lock, settle back to 1
  const since = t - TUMBLE_TIME;
  let s = 1;
  if (tumbling) s = 1 + Math.sin(t * 40) * 0.05;
  else if (since < POP_TIME) s = 1 + (1 - since / POP_TIME) * 0.35;

  const jitter = tumbling ? [(hashStr(`jx${step}`) % 5) - 2, (hashStr(`jy${step}`) % 5) - 2] : [0, 0];
  const cx = R(x) + jitter[0];
  const cy = R(y) + jitter[1];
  const scale = 2 * s;   // the die is authored at ~15px, drawn around 30px

  ctx.save();

  // --- glow / aura ---------------------------------------------------------
  if (crit) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 12);
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26 + pulse * 6);
    g.addColorStop(0, 'rgba(255,220,120,0.55)');
    g.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 34, cy - 34, 68, 68);
  } else if (fumble) {
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 24);
    g.addColorStop(0, 'rgba(210,50,40,0.50)');
    g.addColorStop(1, 'rgba(160,20,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 30, cy - 30, 60, 60);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(cx - 20, cy - 20, 40, 40);
  }

  // --- die body ------------------------------------------------------------
  const faceCol = crit ? '#f3d789' : fumble ? '#b8352a' : '#e2dbca';
  const edgeCol = crit ? '#8a6410' : fumble ? '#4a0f0b' : '#6d6656';
  const darkCol = crit ? '#c99a2c' : fumble ? '#7a1a14' : '#a9a08c';
  drawD20Body(ctx, cx, cy, scale, faceCol, edgeCol, darkCol);

  // number on the face
  const numCol = crit ? '#3a2607' : fumble ? '#ffe0d8' : '#221d16';
  text(ctx, cx, cy - 6, String(face), { size: 'lg', color: numCol, align: 'center', shadow: false });

  // advantage / disadvantage marker under the die
  if (result.adv || result.dis) {
    const advCol = result.adv ? COLORS.good : COLORS.bad;
    const advTxt = result.adv ? 'ADV' : 'DIS';
    text(ctx, cx, cy + 12, advTxt, { size: 'sm', color: advCol, align: 'center', shadow: true });
  }

  // --- nat 20 sparks / nat 1 cracks ---------------------------------------
  if (crit) {
    const k = Math.min(1, since / 0.4);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + t * 2;
      const r0 = 14 + k * 12;
      const r1 = r0 + 4 + Math.sin(t * 20 + i) * 2;
      ctx.strokeStyle = i % 2 ? '#fff0b8' : COLORS.gold;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(R(cx + Math.cos(a) * r0), R(cy + Math.sin(a) * r0));
      ctx.lineTo(R(cx + Math.cos(a) * r1), R(cy + Math.sin(a) * r1));
      ctx.stroke();
    }
  } else if (fumble) {
    ctx.strokeStyle = '#2a0806';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 6); ctx.lineTo(cx - 2, cy + 1); ctx.lineTo(cx + 3, cy - 3); ctx.lineTo(cx + 9, cy + 6);
    ctx.moveTo(cx - 2, cy + 1); ctx.lineTo(cx - 5, cy + 8);
    ctx.stroke();
  }

  // --- the arithmetic readout ---------------------------------------------
  if (!tumbling) {
    const parts = [`d20 ${nat}`];
    if (mod) parts.push(`${mod >= 0 ? '+' : '−'}${Math.abs(mod)}`);
    let line = `${parts.join(' ')} = ${total}`;
    if (target != null) line += `  vs ${targetLabel} ${target}`;
    const lw = measureGlyphs(line, 'sm');
    const by = cy + 20;
    nineSlice(ctx, R(cx - lw / 2) - 5, by - 2, lw + 10, 11, { style: 'dark', shadow: 0.4, studs: false });
    text(ctx, cx, by + 1, line, { size: 'sm', color: crit ? COLORS.goldBright : fumble ? '#f0a898' : COLORS.ink, align: 'center', shadow: true });

    // --- HIT / MISS / CRITICAL stamp ---------------------------------------
    if (since > STAMP_DELAY) {
      const st = since - STAMP_DELAY;
      const ss = st < 0.14 ? 3 - (st / 0.14) * 2 : 1;      // slams down from 3x
      let word = null; let wc = COLORS.ink;
      if (result.label) { word = String(result.label).toUpperCase(); wc = result.labelColor || COLORS.gold; }
      else if (crit) { word = 'CRITICAL'; wc = COLORS.goldBright; }
      else if (fumble) { word = 'FUMBLE'; wc = '#ff7a60'; }
      else if (result.hit === true) { word = 'HIT'; wc = COLORS.good; }
      else if (result.hit === false) { word = 'MISS'; wc = COLORS.inkDim; }
      if (word) {
        const sc = Math.max(1, Math.round(ss * 2));
        const m = metrics(sc, 1);
        const ww = word.length * m.adv - m.gap;
        const sy = cy - 26;
        drawRun(ctx, word, R(cx - ww / 2) + 1, sy + 1, m, 'rgba(0,0,0,0.75)', 1);
        drawRun(ctx, word, R(cx - ww / 2), sy, m, wc, 1);
      }
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// 14. MISC OVERLAYS
// ---------------------------------------------------------------------------

/** Full-screen dim, for modal scenes stacked over the overworld. */
function scrim(ctx, alpha = 0.55, color = '#05060c') {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.globalAlpha = prev;
}

/** A framed message box across the bottom of the screen (dialogue, prompts). */
function messageBox(ctx, str, opts = {}) {
  const h = opts.h || 58;
  const x = opts.x != null ? opts.x : 6;
  const y = opts.y != null ? opts.y : VIEW_H - h - 6;
  const w = opts.w != null ? opts.w : VIEW_W - 12;
  const p = panel(ctx, x, y, w, h, { style: opts.style || 'window' });
  if (opts.speaker) {
    const sw = measureGlyphs(opts.speaker, 'md') + 10;
    nineSlice(ctx, x + 5, y - 5, sw, 12, { style: 'gold', shadow: 0.3, studs: false });
    text(ctx, x + 10, y - 2, opts.speaker, { size: 'md', color: '#2a1c07', shadow: false });
  }
  if (str) textWrapped(ctx, p.ix + 5, p.iy + 5, p.iw - 10, str, { size: opts.size || 'sm', color: p.ink });
  return p;
}

/** A blinking "press to continue" caret in the corner of a message box. */
function advanceCaret(ctx, x, y, t) {
  if (Math.sin(t * 8) < 0) return;
  const bob = Math.round(Math.sin(t * 8) * 1);
  text(ctx, R(x), R(y) + bob, '▼', { size: 'sm', color: COLORS.gold, shadow: true });
}

// ---------------------------------------------------------------------------
// 15. EXPORT
// ---------------------------------------------------------------------------

export const UI = {
  // font / text
  FONT,
  GLYPH_W,
  GLYPH_H,
  G,
  drawGlyphs,
  text,
  shadowText,
  textWrapped,
  measure: measureGlyphs,
  wrapLines,
  fit: fitText,
  lineHeight: (size) => metrics(size).lineH,
  metrics,

  // two-column rows: allocate the width, then draw it
  splitRow,
  kvRow,
  inkFor,

  // surfaces
  panel,
  window: window_,
  nineSlice,
  divider,
  scrim,
  messageBox,
  advanceCaret,

  // meters
  bar,
  gauge,
  pips,
  pct,

  // selection
  cursor,
  frameSel,
  highlight,

  // widgets
  icon,
  iconNames: ICON_NAMES,
  button,
  list,
  tabs,
  grid,
  tooltip,
  chip,
  keyHint,

  // characters
  portrait,
  diceRoll,

  // plumbing
  pushClip,
  popClip,
  rectStroke,
  vgrad,
  clearCache: clearUICache,

  // palette
  COLORS,
  DAMAGE_COLORS,
  RARITY_COLORS,
  DAMAGE_ICONS,
  PANEL_STYLES,
  PANEL_INK,
  shade,
  shadeHex,
};

export { COLORS, DAMAGE_COLORS, RARITY_COLORS, DAMAGE_ICONS, ICON_NAMES, PANEL_STYLES, PANEL_INK };
export default UI;
