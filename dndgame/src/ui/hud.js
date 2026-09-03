// ui/hud.js — the overworld heads-up display. Not a Scene: OverworldScene owns an
// instance and calls hud.update(dt) / hud.draw(ctx) itself, so the HUD keeps
// running while menus are stacked above and can fade out from underneath them.
//
// Layout on the 400x240 logical screen:
//   top-left      party strip (bust, name, HP + damage ghost, slot pips, conditions)
//   top-centre    toast queue (item gains, level ups, quest completions)
//   top-right     purse, Calendar of Harptos clock/date, weather
//   bottom-left   tracked quest and its current objective
//   bottom-right  round minimap of the explored tiles
//   bottom strip  the last line from the message log
//
// Everything textual goes through ui/kit.js. The little 5x5 marks (coin, skull,
// condition badges, weather) are hand-plotted pixels — the kit has no glyph for
// them and they must stay legible at 1x.

import { Game } from '../engine.js';
import { UI } from './kit.js';
import { bus, EV } from '../core/events.js';
import { Party } from '../world/party.js';
import { drawActorBust } from '../render/actor.js';
import {
  VIEW_W, VIEW_H, clamp, approach, titleCase, clockText, dateText, timeOfDay,
} from '../constants.js';

// ---------------------------------------------------------------------------
// kit shims — the kit is authoritative; these only stop a missing helper from
// killing the frame, and never fall back to ctx.fillText.
// ---------------------------------------------------------------------------

const K = {
  ink: '#efe6d0', dim: '#9a917f', gold: '#e3b34a', red: '#d4553f', green: '#6fc36a',
  blue: '#6aa8e8', purple: '#b07ae0', bg: '#0b0d16', panel: '#181b28', border: '#5c4a2a',
  hp: '#c8452f', mp: '#4a7ad0', xp: '#e3b34a',
};
const C = (k) => (UI && UI.COLORS && UI.COLORS[k]) || K[k] || '#ffffff';

function txt(ctx, x, y, s, o) {
  try { UI.text(ctx, Math.round(x), Math.round(y), String(s), o || {}); } catch (e) { /* kit not ready */ }
}
function tw(s, size) {
  try { if (UI && UI.measure) return UI.measure(String(s), size) || 0; } catch (e) { /* below */ }
  return String(s).length * 4;
}
function txtR(ctx, rx, y, s, o) { txt(ctx, rx - tw(s, (o || {}).size), y, s, o); }
function txtC(ctx, cx, y, s, o) { txt(ctx, cx - tw(s, (o || {}).size) / 2, y, s, o); }
function panel(ctx, x, y, w, h, o) {
  try { UI.panel(ctx, Math.round(x), Math.round(y), Math.round(w), Math.round(h), o || {}); return; } catch (e) { /* below */ }
  ctx.fillStyle = 'rgba(10,12,20,0.86)';
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  ctx.strokeStyle = C('border'); ctx.lineWidth = 1;
  ctx.strokeRect((x | 0) + 0.5, (y | 0) + 0.5, (w | 0) - 1, (h | 0) - 1);
}
function bar(ctx, x, y, w, h, pct, o) {
  try { if (UI && UI.bar) { UI.bar(ctx, x | 0, y | 0, w | 0, h | 0, clamp(pct, 0, 1), o || {}); return; } } catch (e) { /* below */ }
  ctx.fillStyle = (o && o.bg) || '#000';
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  ctx.fillStyle = (o && o.color) || C('hp');
  ctx.fillRect((x | 0) + 1, (y | 0) + 1, Math.max(0, Math.round((w - 2) * clamp(pct, 0, 1))), (h | 0) - 2);
}
/** Kit icon when one exists, otherwise the supplied pixel fallback. */
function icon(ctx, name, x, y, size, color, fallback) {
  if (UI && typeof UI.icon === 'function') {
    try { UI.icon(ctx, name, Math.round(x), Math.round(y), size, color); return; } catch (e) { /* below */ }
  }
  if (fallback) fallback(ctx, Math.round(x), Math.round(y), size, color);
}
function fit(s, w, size) {
  try { if (UI && UI.fit) return UI.fit(String(s == null ? '' : s), w, size); } catch (e) { /* below */ }
  let str = String(s == null ? '' : s);
  if (tw(str, size) <= w) return str;
  while (str.length > 1 && tw(str + '…', size) > w) str = str.slice(0, -1);
  return str + '…';
}
/**
 * A person's name in `w` pixels. The party strip is 104px wide and
 * "Sildar Hallwinter" is 101px on its own, so the full name loses every fight
 * with the HP readout beside it. An ellipsis in a name reads as a bug —
 * "Sildar Hall…" looks like the string was cut by mistake — so a name that will
 * not fit falls back to its FIRST WORD, which is what everyone at the table
 * calls that character anyway. Only a single unfittable word gets an ellipsis.
 */
function shortName(name, w, size) {
  const s = String(name == null || name === '' ? 'Unnamed' : name);
  if (tw(s, size) <= w) return s;
  const first = s.split(/[\s,]+/)[0];
  if (first && first !== s && tw(first, size) <= w) return first;
  return fit(s, w, size);
}

async function softImport(path) {
  try { return await import(path); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// 5x5 pixel marks. Small enough to read at 1x, distinct enough to tell apart.
// ---------------------------------------------------------------------------

const MARKS = {
  eye: ['.XXX.', 'X...X', 'X.X.X', 'X...X', '.XXX.'],
  heart: ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
  drop: ['..X..', '..X..', '.XXX.', 'XXXXX', '.XXX.'],
  chain: ['XX...', 'X.X..', '.XXX.', '..X.X', '...XX'],
  zzz: ['XXXX.', '...X.', '..X..', '.X...', 'XXXX.'],
  flame: ['..X..', '.XX..', '.XXX.', 'XXXXX', '.XXX.'],
  snow: ['X.X.X', '.XXX.', 'XXXXX', '.XXX.', 'X.X.X'],
  down: ['..X..', '..X..', 'XXXXX', '.XXX.', '..X..'],
  star: ['..X..', '.XXX.', 'XXXXX', '.X.X.', 'X...X'],
  bang: ['..X..', '..X..', '..X..', '.....', '..X..'],
  skull: ['.XXX.', 'X.X.X', 'XXXXX', '.X.X.', '.XXX.'],
  fist: ['.XXX.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
  stone: ['.XXX.', 'XXXXX', 'XXXXX', 'XXXXX', '.XXX.'],
  coin: ['.XXX.', 'X.X.X', 'X.X.X', 'X.X.X', '.XXX.'],
  scroll: ['XXXXX', 'X...X', 'XXXXX', 'X...X', 'XXXXX'],
  person: ['..X..', '.XXX.', '..X..', '.XXX.', 'X...X'],
  sword: ['....X', '...XX', '..XX.', 'XXX..', 'XX...'],
  sun: ['X.X.X', '.XXX.', 'XXXXX', '.XXX.', 'X.X.X'],
  cloud: ['.....', '.XXX.', 'XXXXX', 'XXXXX', '.....'],
  rain: ['.XXX.', 'XXXXX', '.....', 'X.X.X', 'X.X.X'],
  fog: ['.....', 'XXXXX', '.....', 'XXXXX', '.....'],
  ash: ['X...X', '..X..', 'X...X', '..X..', 'X...X'],
  moon: ['.XXX.', 'XX...', 'XX...', 'XX...', '.XXX.'],
};

/** Plot a 5x5 mark with its top-left at (x, y). */
function mark(ctx, name, x, y, color) {
  const rows = MARKS[name];
  if (!rows) return;
  ctx.fillStyle = color;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) if (row[c] === 'X') ctx.fillRect((x | 0) + c, (y | 0) + r, 1, 1);
  }
}

// ---------------------------------------------------------------------------
// Conditions. rules/conditions.js is authored concurrently, so the HUD carries
// its own badge table and upgrades to the real catalogue as soon as it loads.
// ---------------------------------------------------------------------------

const COND_BADGE = {
  blinded: { mark: 'eye', color: '#6a6a80', abbr: 'BL' },
  charmed: { mark: 'heart', color: '#e07ab0', abbr: 'CH' },
  deafened: { mark: 'zzz', color: '#7a7a8a', abbr: 'DF' },
  frightened: { mark: 'bang', color: '#b07ae0', abbr: 'FR' },
  grappled: { mark: 'chain', color: '#8a7550', abbr: 'GR' },
  incapacitated: { mark: 'zzz', color: '#c0c0c0', abbr: 'IN' },
  invisible: { mark: 'eye', color: '#6aa8e8', abbr: 'IV' },
  paralyzed: { mark: 'fist', color: '#e3d24a', abbr: 'PA' },
  petrified: { mark: 'stone', color: '#8a8a8a', abbr: 'PE' },
  poisoned: { mark: 'drop', color: '#6fc36a', abbr: 'PO' },
  prone: { mark: 'down', color: '#a08a6a', abbr: 'PR' },
  restrained: { mark: 'chain', color: '#c88a3a', abbr: 'RE' },
  stunned: { mark: 'star', color: '#e3b34a', abbr: 'ST' },
  unconscious: { mark: 'zzz', color: '#5a5a6a', abbr: 'UN' },
  exhaustion: { mark: 'bang', color: '#a04a3a', abbr: 'EX' },
  burning: { mark: 'flame', color: '#ff6a2a', abbr: 'BU' },
  frozen: { mark: 'snow', color: '#8ad8e8', abbr: 'FZ' },
  blessed: { mark: 'star', color: '#e3d24a', abbr: 'BS' },
  bane: { mark: 'bang', color: '#8a4a8a', abbr: 'BA' },
  marked: { mark: 'bang', color: '#d4553f', abbr: 'MK' },
  concentrating: { mark: 'eye', color: '#7aa8e8', abbr: 'CO' },
  raging: { mark: 'flame', color: '#d4553f', abbr: 'RG' },
  hidden: { mark: 'eye', color: '#7a7a92', abbr: 'HD' },
};
let CONDITIONS_CAT = null;
softImport('../rules/conditions.js').then((m) => { if (m && m.CONDITIONS) CONDITIONS_CAT = m.CONDITIONS; });

function badgeFor(id) {
  const base = COND_BADGE[id] || { mark: 'bang', color: '#b0a890', abbr: String(id || '?').slice(0, 2).toUpperCase() };
  const cat = CONDITIONS_CAT && CONDITIONS_CAT[id];
  return cat && cat.color ? { ...base, color: cat.color } : base;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

// row 21, not 20: each member is three 7px lines (name, bar, slots/AC) and at 20
// the third line's drop shadow landed on the next member's name.
const PARTY = { x: 3, y: 3, w: 128, row: 21, pad: 3 };
const TR = { w: 116, h: 27, x: VIEW_W - 3 - 116, y: 3 };
// The bottom strip belongs to ui/hotbar.js (BAR sits at VIEW_H - 15), so the
// quest tracker and the log ribbon stack above it rather than under it.
// 168px left "The Lost Mine of Phandelver" (161px) 15px short of its own title
// and cut every objective mid-word. Nothing lives between x=3 and the minimap's
// left edge at x=340 on this row, so the panel takes the space it needs.
const QUEST = { x: 3, w: 200, h: 32, y: VIEW_H - 66 };
const MAP = { cx: VIEW_W - 33, cy: VIEW_H - 33, r: 27, px: 2 };
const RIBBON = { x: 3, w: 334, h: 12, y: VIEW_H - 29 };

const TOAST_MAX = 4;
const TOAST_LIFE = 3.0;
const TOAST_SLIDE = 0.22;
// The free band between the party strip (ends x=131) and the purse (starts
// x=281) is 146px. A 148px toast could not fit it and clipped one or the other.
const TOAST_W = 144;
const LOG_LIFE = 4.0;

// Tile flag bits, mirrored from world/tilemap.js so the HUD never has to import
// a module that may not exist yet.
const TF_SOLID = 1, TF_WATER = 2, TF_DOOR = 8;

// Spell-slot pip colours, 1st through 9th.
const SLOT_COLORS = [
  '#6aa8e8', '#5f9ee0', '#7a94e0', '#9088e0', '#a87ce0',
  '#c078d8', '#d478c8', '#e07ab0', '#e88a90',
];

// ===========================================================================
// HUD
// ===========================================================================

export class HUD {
  constructor(opts = {}) {
    this.opts = opts || {};
    this.t = 0;
    this.visible = true;
    this.alpha = 1;              // current global fade
    this.hidden = false;         // hard hide (dialogue / cutscene)

    this.map = null;             // current TileMap
    this.entities = null;        // optional entity list override
    this.player = null;          // { sx, sy, moving } in screen pixels
    // Spell markers, shared by reference with the overworld scene:
    // rules/fieldworld.js addMarker/expireMarkers own the array, the HUD only
    // draws it. [{ x, y, label, until, color }]
    this.markers = null;

    this.toasts = [];
    this.logLine = null;
    this.ghosts = Object.create(null);   // uid -> { v, hold }
    this.flash = Object.create(null);    // uid -> seconds remaining
    this._walkT = 0;             // seconds since the last step event
    this._dlgGrace = 0;
    this._dialogue = false;
    this._disc = null;           // Set of discovered "x,y" keys
    this._discKey = '';          // cache signature for the above

    this._off = [];
    this._wire();
  }

  // --- wiring -------------------------------------------------------------

  _wire() {
    const on = (evt, fn) => { this._off.push(bus.on(evt, fn)); };

    on(EV.TOAST, (p) => {
      if (!p) return;
      this.toast(p.text || String(p), { color: p.color, mark: p.icon || p.mark, kind: p.kind });
    });

    on(EV.ITEM_GAIN, (p) => {
      if (!p || !p.id) return;
      const it = safeItem(p.id);
      const name = (it && it.name) || titleCase(String(p.id).replace(/-/g, ' '));
      const qty = p.qty && p.qty > 1 ? ` ×${p.qty}` : '';
      this.toast(`${name}${qty}`, { color: (it && it.tint) || C('ink'), mark: 'sword', kind: 'item' });
    });

    on(EV.GOLD_CHANGE, (p) => {
      if (!p || !p.delta) return;
      const d = Math.round(p.delta);
      this.toast(`${d > 0 ? '+' : '−'}${Math.abs(d)} gp`, { color: C('gold'), mark: 'coin', kind: 'gold' });
    });

    on(EV.LEVEL_UP, (p) => {
      const ch = (p && (p.ch || p.character || p.unit)) || null;
      const name = (ch && ch.name) || (p && p.name) || 'Someone';
      const lvl = (ch && ch.level) || (p && p.level) || '';
      this.toast(lvl ? `${name} reached level ${lvl}` : `${name} levelled up`, { color: C('xp'), mark: 'star', kind: 'level' });
    });

    on(EV.QUEST_DONE, (p) => {
      const title = (p && p.quest && p.quest.title) || (p && p.title) || 'a task';
      this.toast(`Quest complete: ${title}`, { color: C('green'), mark: 'scroll', kind: 'quest' });
    });

    on(EV.QUEST_START, (p) => {
      const title = (p && p.quest && p.quest.title) || (p && p.title) || null;
      if (title) this.toast(`New quest: ${title}`, { color: C('gold'), mark: 'scroll', kind: 'quest' });
    });

    on(EV.MEMBER_JOIN, (p) => {
      const ch = p && p.ch;
      if (!ch) return;
      this.toast(`${ch.name || 'A companion'} joined the party`, { color: C('blue'), mark: 'person', kind: 'party' });
    });

    on(EV.LOG, (p) => {
      const text = (p && (p.text || p.msg)) || (typeof p === 'string' ? p : '');
      if (!text) return;
      this.logLine = { text: String(text), kind: (p && p.kind) || '', t: 0 };
    });

    on(EV.STEP, () => { this._walkT = 0; });

    on(EV.MAP_ENTER, (p) => {
      const m = (p && (p.map || p.tilemap)) || null;
      if (m) this.setMap(m);
      this._disc = null; this._discKey = '';
    });

    on(EV.DIALOGUE_OPEN, (p) => {
      if (p && p.open === false) { this._dlgGrace = 0; this._dialogue = false; }
      else { this._dialogue = true; this._dlgGrace = 0.3; }
    });

    // Flash the bar of whoever just got hit, whatever the payload calls them.
    on(EV.DAMAGE, (p) => {
      const u = p && (p.target || p.unit || p.ch || p.victim);
      if (u && u.uid) this.flashHP(u.uid);
    });
    on(EV.DOWNED, (p) => {
      const u = p && (p.target || p.unit || p.ch);
      if (u && u.uid) this.flashHP(u.uid);
    });
  }

  /** Drop every bus subscription. Call when the overworld is torn down. */
  destroy() {
    for (const off of this._off) { try { off(); } catch (e) { /* ignore */ } }
    this._off = [];
  }

  // --- public API ---------------------------------------------------------

  /** Show or hide the whole HUD (it fades rather than popping). */
  setVisible(v) { this.visible = !!v; return this.visible; }

  /** Pulse a party member's HP bar — call it when they take a hit. */
  flashHP(uid) { if (uid) this.flash[uid] = 0.55; }

  /** The TileMap the minimap should draw. */
  setMap(map) { this.map = map || null; this._disc = null; this._discKey = ''; return this.map; }

  /** Entities to plot on the minimap; defaults to `map.entities`. */
  setEntities(list) { this.entities = Array.isArray(list) ? list : null; }

  /**
   * Where the player sprite currently is on screen, so the HUD knows when to get
   * out of their way. The overworld calls this every frame; if it never does, the
   * HUD assumes the player is mid-screen and simply never auto-fades.
   */
  setPlayerScreen(sx, sy, moving) {
    this.player = { sx, sy, moving: !!moving };
    if (moving) this._walkT = 0;
  }

  /** Queue a toast. opts: { color, mark, kind, life } */
  toast(text, opts = {}) {
    if (!text) return null;
    const t = {
      text: String(text), color: opts.color || C('ink'), mark: opts.mark || null,
      kind: opts.kind || '', life: opts.life || TOAST_LIFE, t: 0, y: 0, slot: 0,
    };
    this.toasts.push(t);
    while (this.toasts.length > TOAST_MAX) this.toasts.shift();
    return t;
  }

  clearToasts() { this.toasts.length = 0; }

  // --- update -------------------------------------------------------------

  update(dt) {
    const d = clamp(dt || 0, 0, 0.1);
    this.t += d;
    this._walkT += d;
    if (this._dlgGrace > 0) this._dlgGrace -= d;

    // Toasts: advance, retire, and settle into their stack slots.
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const tt = this.toasts[i];
      tt.t += d;
      if (tt.t >= tt.life) this.toasts.splice(i, 1);
    }
    for (let i = 0; i < this.toasts.length; i++) {
      const tt = this.toasts[i];
      const target = i * 15;
      tt.slot = tt.slot === 0 && tt.t < 0.02 ? target : approach(tt.slot, target, d * 120);
    }

    // Log ribbon.
    if (this.logLine) {
      this.logLine.t += d;
      if (this.logLine.t > LOG_LIFE) this.logLine = null;
    }

    // Damage ghosts and hit flashes.
    for (const m of Party.members || []) {
      if (!m || !m.uid) continue;
      const pct = clamp((m.hp || 0) / Math.max(1, m.maxHp || 1), 0, 1);
      let g = this.ghosts[m.uid];
      if (!g) { g = this.ghosts[m.uid] = { v: pct, hold: 0 }; }
      if (pct > g.v) g.v = pct;                       // healing snaps the ghost up
      else if (pct < g.v - 0.0005) {
        if (g.hold <= 0 && g.v - pct > 0.001 && g.last !== pct) { g.hold = 0.35; g.last = pct; }
        if (g.hold > 0) g.hold -= d;
        else g.v = Math.max(pct, g.v - d * 0.55);
      } else g.v = pct;
      if (this.flash[m.uid] > 0) { this.flash[m.uid] -= d; if (this.flash[m.uid] <= 0) delete this.flash[m.uid]; }
    }

    this._syncDialogue();

    // Global fade: gone during dialogue, ghosted while the player walks beneath it.
    let target = 1;
    if (!this.visible || this.hidden) target = 0;
    else if (this._dialogue) target = 0;
    else if (this._isWalking() && this._playerUnderHud()) target = 0.25;
    this.alpha = approach(this.alpha, target, d * 4.5);
  }

  _isWalking() {
    if (this.player && this.player.moving) return true;
    return this._walkT < 0.32;      // EV.STEP fired recently
  }

  /** True when the player sprite sits inside one of the HUD's panels. */
  _playerUnderHud() {
    const p = this.player;
    if (!p) return false;
    const x = p.sx, y = p.sy;
    const inRect = (r, w, h) => x >= r.x - 6 && x <= r.x + w + 6 && y >= r.y - 10 && y <= r.y + h + 6;
    const partyH = PARTY.pad * 2 + Math.max(1, (Party.members || []).length) * PARTY.row;
    if (inRect(PARTY, PARTY.w, partyH)) return true;
    if (inRect(TR, TR.w, TR.h)) return true;
    if (this._trackedQuest() && inRect(QUEST, QUEST.w, QUEST.h)) return true;
    if (this.logLine && inRect(RIBBON, RIBBON.w, RIBBON.h)) return true;
    const dx = x - MAP.cx, dy = y - MAP.cy;
    if (dx * dx + dy * dy < (MAP.r + 8) * (MAP.r + 8)) return true;
    return false;
  }

  _syncDialogue() {
    if (this._dlgGrace > 0) return;
    let found = false;
    try {
      for (const s of (Game.scenes || [])) {
        const n = (s && (s.id || (s.constructor && s.constructor.name))) || '';
        if (/dialog/i.test(String(n))) { found = true; break; }
      }
    } catch (e) { /* ignore */ }
    this._dialogue = found;
  }

  // --- draw ---------------------------------------------------------------

  draw(ctx) {
    if (this.alpha <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = clamp(this.alpha, 0, 1);
    this._drawParty(ctx);
    this._drawPurseClock(ctx);
    this._drawQuest(ctx);
    this._drawMinimap(ctx);
    this._drawLog(ctx);
    ctx.restore();
    // Toasts stay legible even when the rest of the HUD has ghosted away.
    ctx.save();
    ctx.globalAlpha = clamp(Math.max(this.alpha, this._dialogue || !this.visible ? 0 : 0.9), 0, 1);
    this._drawToasts(ctx);
    ctx.restore();
  }

  // --- party strip --------------------------------------------------------

  _drawParty(ctx) {
    const members = (Party.members || []).slice(0, 4);
    if (!members.length) return;
    const h = PARTY.pad * 2 + members.length * PARTY.row;
    panel(ctx, PARTY.x, PARTY.y, PARTY.w, h, { style: 'dark' });

    const x0 = PARTY.x + 21;                 // content column, right of the bust
    const cw = PARTY.w - 24;                 // content width

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const ry = PARTY.y + PARTY.pad + i * PARTY.row;
      const dead = !!m.dead;
      const down = !dead && (m.hp || 0) <= 0;
      const grey = dead || down;

      // --- bust ---
      ctx.save();
      if (grey) ctx.globalAlpha = ctx.globalAlpha * 0.55;
      try { drawActorBust(ctx, m, PARTY.x + 3, ry, 16); } catch (e) { /* sprites may not be defined yet */ }
      ctx.restore();
      if (grey) {
        ctx.fillStyle = 'rgba(12,14,22,0.45)';
        ctx.fillRect(PARTY.x + 3, ry, 16, 16);
        mark(ctx, 'skull', PARTY.x + 8, ry + 5, dead ? '#8a3a30' : '#c8bfa8');
      }
      // The leader gets a gold tick so the marching order is obvious.
      ctx.fillStyle = i === 0 ? C('gold') : 'rgba(92,74,42,0.55)';
      ctx.fillRect(PARTY.x + 1, ry, 1, 16);

      // --- line 1: name + hp readout ---
      // The name used to get a flat `cw - 30`, which is right for "41/58" and
      // wrong for "185/185" (41px) and stingy for "DEAD" (23px). Measure the
      // readout, then split the row: a long name keeps every pixel the number
      // is not using, and the number is never printed through it.
      const nameCol = grey ? 'rgba(154,145,127,0.6)' : C('ink');
      const readout = dead ? 'DEAD' : down ? 'DOWN' : `${Math.max(0, m.hp | 0)}/${m.maxHp | 0}`;
      const readCol = dead ? '#8a3a30' : down ? C('red') : hpColor(m);
      const readW = Math.min(tw(readout, 'sm'), Math.round(cw * 0.45));
      const nameW = cw - 4 - readW;
      txt(ctx, x0, ry, shortName(m.name, nameW, 'sm'), { size: 'sm', color: nameCol, maxWidth: nameW });
      txt(ctx, x0 + cw, ry, readout, { size: 'sm', color: readCol, align: 'right', maxWidth: readW });

      // --- line 2: hp bar with a lagging damage ghost, or death saves ---
      const by = ry + 9;
      if (down) this._drawDeathSaves(ctx, x0, by, m);
      else this._drawHpBar(ctx, x0, by, 56, 5, m, dead);

      // --- line 2 right: condition badges ---
      this._drawConditions(ctx, x0 + 59, by - 1, cw - 59, m);

      // --- line 3: caster pips, or the AC of anyone who does not cast ---
      const py = ry + 15;
      if (!this._drawSlotPips(ctx, x0, py, cw, m, grey)) {
        const ac = m.ac != null ? m.ac : null;
        if (ac != null) {
          txt(ctx, x0, py - 1, 'AC', { size: 'sm', color: 'rgba(154,145,127,0.55)' });
          txt(ctx, x0 + 13, py - 1, String(ac), { size: 'sm', color: grey ? 'rgba(154,145,127,0.5)' : C('dim') });
        }
        if (m.tempHp > 0) txtR(ctx, x0 + cw, py - 1, `+${m.tempHp} tmp`, { size: 'sm', color: C('blue') });
      }
    }
  }

  _drawHpBar(ctx, x, y, w, h, m, dead) {
    const max = Math.max(1, m.maxHp || 1);
    const pct = clamp((m.hp || 0) / max, 0, 1);
    const g = this.ghosts[m.uid];
    const ghost = g ? clamp(g.v, 0, 1) : pct;

    // backing
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x, y, w, h);
    // The ghost: what the bar used to be, draining a beat behind the real value.
    // Drawn at the same origin/width scale the fill uses, or the trailing edge
    // sits a pixel off from the bar it is trailing.
    if (ghost > pct) {
      ctx.fillStyle = 'rgba(232,110,80,0.55)';
      ctx.fillRect(x, y, Math.round(w * ghost), h);
    }
    bar(ctx, x, y, w, h, pct, { color: dead ? '#4a3a3a' : hpColor(m), bg: 'transparent', border: false });

    // temp HP rides on top as a blue cap
    if (m.tempHp > 0) {
      const tw2 = Math.round(w * clamp(m.tempHp / max, 0, 1));
      ctx.fillStyle = 'rgba(106,168,232,0.8)';
      ctx.fillRect(Math.max(x, x + Math.round(w * pct) - tw2), y, Math.max(1, tw2), 2);
    }
    // hit flash
    const f = this.flash[m.uid];
    if (f > 0) {
      ctx.globalAlpha = ctx.globalAlpha * clamp(f / 0.55, 0, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.globalAlpha = clamp(this.alpha, 0, 1);
    }
    // A low-HP pulse: the bar breathes below a quarter health.
    if (pct > 0 && pct <= 0.25 && !dead) {
      ctx.globalAlpha = ctx.globalAlpha * (0.25 + 0.25 * Math.sin(this.t * 7));
      ctx.fillStyle = '#ff6a4a';
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = clamp(this.alpha, 0, 1);
    }
  }

  _drawDeathSaves(ctx, x, y, m) {
    const ds = m.deathSaves || { success: 0, fail: 0 };
    const label = 'SAVES';
    txt(ctx, x, y - 1, label, { size: 'sm', color: 'rgba(154,145,127,0.6)' });
    // 'SAVES' is 29px; the pips started at +24 and covered its final S.
    let px = x + tw(label, 'sm') + 4;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < (ds.success | 0) ? C('green') : 'rgba(40,46,40,0.9)';
      ctx.fillRect(px, y, 4, 4); px += 5;
    }
    px += 3;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < (ds.fail | 0) ? C('red') : 'rgba(46,36,36,0.9)';
      ctx.fillRect(px, y, 4, 4); px += 5;
    }
  }

  _drawConditions(ctx, x, y, w, m) {
    const list = Array.isArray(m.conditions) ? m.conditions : [];
    const seen = new Set();
    const ids = [];
    for (const c of list) {
      const id = typeof c === 'string' ? c : (c && c.id);
      if (!id || seen.has(id)) continue;
      seen.add(id); ids.push(id);
    }
    if (m.concentration && !seen.has('concentrating')) ids.unshift('concentrating');
    if (!ids.length) return;
    const per = 8;
    const maxN = Math.max(1, Math.floor(w / per));
    let px = x + w - Math.min(ids.length, maxN) * per;
    for (let i = 0; i < ids.length && i < maxN; i++) {
      const b = badgeFor(ids[i]);
      ctx.fillStyle = 'rgba(8,10,16,0.85)';
      ctx.fillRect(px, y, 7, 7);
      mark(ctx, b.mark, px + 1, y + 1, b.color);
      px += per;
    }
  }

  /** Slot pips for casters. Returns false when this character casts nothing. */
  _drawSlotPips(ctx, x, y, w, m, grey) {
    const sp = m.spells;
    if (!sp) return false;
    const groups = [];
    const slots = sp.slots || {};
    for (let lvl = 1; lvl <= 9; lvl++) {
      const s = slots[lvl];
      const max = s && (s.max | 0);
      if (max > 0) groups.push({ lvl, max, used: (s.used | 0), color: SLOT_COLORS[lvl - 1] });
    }
    if (sp.pact && (sp.pact.max | 0) > 0) {
      groups.push({ lvl: sp.pact.level || 1, max: sp.pact.max | 0, used: sp.pact.used | 0, color: C('purple'), pact: true });
    }
    if (!groups.length) return false;

    // Shrink the pips rather than overflow the strip.
    let total = 0;
    for (const g of groups) total += g.max;
    let pw = 3, gap = 1, sep = 2;
    let need = total * (pw + gap) + (groups.length - 1) * sep;
    if (need > w) { pw = 2; need = total * (pw + gap) + (groups.length - 1) * sep; }
    if (need > w) { gap = 0; need = total * pw + (groups.length - 1) * sep; }

    let px = x;
    for (const g of groups) {
      for (let i = 0; i < g.max; i++) {
        const spent = i < g.used;
        ctx.fillStyle = spent ? 'rgba(30,34,48,0.9)' : g.color;
        if (grey) ctx.globalAlpha = clamp(this.alpha, 0, 1) * 0.5;
        ctx.fillRect(px, y, pw, 3);
        if (spent) { ctx.fillStyle = 'rgba(90,96,120,0.6)'; ctx.fillRect(px, y + 1, pw, 1); }
        if (grey) ctx.globalAlpha = clamp(this.alpha, 0, 1);
        px += pw + gap;
        if (px > x + w - pw) return true;   // out of room; the rest are implied
      }
      px += sep;
    }
    return true;
  }

  // --- purse, clock, weather ---------------------------------------------

  _drawPurseClock(ctx) {
    const st = Game.state || {};
    panel(ctx, TR.x, TR.y, TR.w, TR.h, { style: 'dark' });

    // Purse
    icon(ctx, 'coin', TR.x + 5, TR.y + 4, 7, C('gold'), (c, x, y, s, col) => mark(c, 'coin', x, y, col));
    txt(ctx, TR.x + 15, TR.y + 4, `${Party.gold | 0}`, { size: 'sm', color: C('gold') });
    txt(ctx, TR.x + 15 + tw(String(Party.gold | 0), 'sm') + 3, TR.y + 4, 'gp', { size: 'sm', color: 'rgba(224,179,82,0.6)' });

    // Weather badge, top-right of the panel
    const weather = st.weather || 'clear';
    const night = timeOfDay(st.time || 0) === 'night';
    drawWeatherBadge(ctx, TR.x + TR.w - 13, TR.y + 3, weather, night);

    // Clock and Calendar of Harptos date
    const clock = clockText(st.time == null ? 480 : st.time);
    txt(ctx, TR.x + 5, TR.y + 15, clock, { size: 'sm', color: night ? '#8fa8d8' : C('ink') });
    // "12 Mirtul, 1496 DR" rarely fits beside the clock, and an ellipsis mid-month
    // reads as a bug. Drop the year first, then let fit() do the rest.
    const avail = TR.w - 14 - tw(clock, 'sm');
    const full = dateText(st.day || 1);
    const short = full.replace(/,.*$/, '');
    const date = tw(full, 'sm') <= avail ? full : short;
    txtR(ctx, TR.x + TR.w - 5, TR.y + 15, fit(date, avail, 'sm'), { size: 'sm', color: C('dim') });
  }

  // --- tracked quest ------------------------------------------------------

  _trackedQuest() {
    const st = Game.state;
    if (!st || !st.quests) return null;
    const active = st.quests.active || [];
    if (!active.length) return null;
    return active.find((q) => q && q.id === st.quests.tracked) || active[0] || null;
  }

  _drawQuest(ctx) {
    const q = this._trackedQuest();
    if (!q) return;
    const steps = Array.isArray(q.steps) ? q.steps : [];
    const step = steps.find((s) => s && !s.done) || steps[steps.length - 1] || null;

    panel(ctx, QUEST.x, QUEST.y, QUEST.w, QUEST.h, { style: 'dark' });
    icon(ctx, 'quest', QUEST.x + 5, QUEST.y + 4, 7, C('gold'), (c, x, y, s, col) => mark(c, 'scroll', x, y, col));
    txt(ctx, QUEST.x + 15, QUEST.y + 4, fit(q.title || 'Untitled Task', QUEST.w - 22, 'sm'),
      { size: 'sm', color: C('gold') });

    if (!step) {
      // Every other string in this panel is wrapped in fit(); this one was
      // missed, and 'Return to the one who sent you.' is 185px in a 168px
      // panel — 25px of it printed onto the map.
      // 185px of text; QUEST.x+8 to the panel's inner right edge is 186.
      txt(ctx, QUEST.x + 8, QUEST.y + 15, fit('Return to the one who sent you.', QUEST.w - 14, 'sm'),
        { size: 'sm', color: C('green') });
      return;
    }

    const count = Math.max(1, step.count || 1);
    const prog = clamp(step.progress || 0, 0, count);
    const counter = count > 1 ? `${prog}/${count}` : (step.done ? 'done' : '');
    const counterW = counter ? tw(counter, 'sm') + 4 : 0;

    txt(ctx, QUEST.x + 8, QUEST.y + 15, fit(objectiveText(step), QUEST.w - 16 - counterW, 'sm'),
      { size: 'sm', color: step.done ? C('green') : C('ink') });
    if (counter) txtR(ctx, QUEST.x + QUEST.w - 6, QUEST.y + 15, counter, { size: 'sm', color: step.done ? C('green') : C('dim') });

    // A hair-thin progress rule across the whole quest, not just this step.
    const doneSteps = steps.filter((s) => s && s.done).length;
    const overall = steps.length ? (doneSteps + (count > 1 ? prog / count : 0)) / steps.length : 0;
    bar(ctx, QUEST.x + 8, QUEST.y + 25, QUEST.w - 16, 3, clamp(overall, 0, 1),
      { color: C('gold'), bg: 'rgba(0,0,0,0.6)', border: false });
  }

  // --- minimap ------------------------------------------------------------

  _discovered() {
    const st = Game.state;
    if (!st || !st.discovered) return null;
    const raw = st.discovered[st.mapId];
    if (!raw) return null;
    if (raw instanceof Set) return raw;
    if (!Array.isArray(raw)) return null;
    const key = `${st.mapId}:${raw.length}`;
    if (this._discKey !== key) { this._disc = new Set(raw); this._discKey = key; }
    return this._disc;
  }

  _drawMinimap(ctx) {
    const map = this.map;
    const st = Game.state || {};
    const cx = MAP.cx, cy = MAP.cy, r = MAP.r, px = MAP.px;

    // Dial: dark glass with a gold rim.
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,10,18,0.86)';
    ctx.fill();
    ctx.clip();

    if (map) {
      const pxT = Math.round(st.x || 0), pyT = Math.round(st.y || 0);
      const disc = this._discovered();
      const span = Math.ceil(r / px) + 1;
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          const tx = pxT + dx, ty = pyT + dy;
          const sx = cx + dx * px, sy = cy + dy * px;
          if ((sx - cx) * (sx - cx) + (sy - cy) * (sy - cy) > r * r) continue;
          let inB = true;
          try { inB = map.inBounds ? map.inBounds(tx, ty) : true; } catch (e) { inB = true; }
          if (!inB) continue;
          if (disc && !disc.has(`${tx},${ty}`)) continue;   // unexplored stays dark
          let flags = 0, solid = false;
          try { flags = map.flagAt ? map.flagAt(tx, ty) | 0 : 0; } catch (e) { flags = 0; }
          try { solid = map.solid ? !!map.solid(tx, ty) : !!(flags & TF_SOLID); } catch (e) { solid = !!(flags & TF_SOLID); }
          let col;
          if (flags & TF_WATER) col = '#2c5a8a';
          else if (flags & TF_DOOR) col = '#c08a3a';
          else if (solid) col = '#4a4a58';
          else col = '#2f4030';
          ctx.fillStyle = col;
          ctx.fillRect(Math.round(sx), Math.round(sy), px, px);
        }
      }

      // Warps, doors and other travel markers.
      const trigs = Array.isArray(map.triggers) ? map.triggers : [];
      for (const tg of trigs) {
        if (!tg) continue;
        const kind = tg.kind || '';
        if (kind !== 'warp' && kind !== 'door' && kind !== 'inn' && kind !== 'shop') continue;
        const sx = cx + ((tg.x || 0) - Math.round(st.x || 0)) * px;
        const sy = cy + ((tg.y || 0) - Math.round(st.y || 0)) * px;
        if ((sx - cx) * (sx - cx) + (sy - cy) * (sy - cy) > r * r) continue;
        ctx.fillStyle = kind === 'warp' ? '#7fe08a' : '#e0c060';
        ctx.beginPath();
        ctx.moveTo(sx + 1, sy - 2); ctx.lineTo(sx + 4, sy + 1);
        ctx.lineTo(sx + 1, sy + 4); ctx.lineTo(sx - 2, sy + 1);
        ctx.closePath(); ctx.fill();
      }

      // NPCs and roaming monsters.
      const ents = this.entities || (Array.isArray(map.entities) ? map.entities : []);
      for (const e of ents) {
        if (!e || e.hidden) continue;
        const sx = cx + ((e.x || 0) - Math.round(st.x || 0)) * px;
        const sy = cy + ((e.y || 0) - Math.round(st.y || 0)) * px;
        if ((sx - cx) * (sx - cx) + (sy - cy) * (sy - cy) > r * r) continue;
        const kind = e.kind || '';
        if (kind === 'monster') ctx.fillStyle = '#e05a4a';
        else if (kind === 'npc') ctx.fillStyle = '#7fd0f0';
        else if (kind === 'chest') ctx.fillStyle = '#e0b040';
        else continue;
        ctx.fillRect(Math.round(sx), Math.round(sy), 2, 2);
      }
    } else {
      // No map bound yet — say so rather than showing an empty dial.
      txtC(ctx, cx, cy - 3, 'no map', { size: 'sm', color: 'rgba(154,145,127,0.45)' });
    }

    // Locate Object's pin, and anything else the Weave is pointing at.
    if (map) this._drawMarkerPips(ctx, cx, cy, r, px);

    // The party, always dead centre, pulsing.
    const pulse = 0.6 + 0.4 * Math.sin(this.t * 4);
    ctx.globalAlpha = clamp(this.alpha, 0, 1) * pulse;
    ctx.fillStyle = '#fff2c0';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
    ctx.globalAlpha = clamp(this.alpha, 0, 1);
    ctx.fillStyle = C('gold');
    ctx.fillRect(cx - 1, cy - 1, 2, 2);

    ctx.restore();

    // Rim and compass tick.
    ctx.strokeStyle = 'rgba(92,74,42,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(224,179,82,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = C('gold');
    ctx.fillRect(cx - 1, cy - r - 1, 2, 3);
    txtC(ctx, cx, cy - r - 10, 'N', { size: 'sm', color: 'rgba(224,179,82,0.75)' });

    this._drawMarkerLabel(ctx, cx, cy, r);
  }

  /** The live spell markers, nearest first, as an array — never null. */
  _markers() {
    const m = this.markers;
    return Array.isArray(m) ? m.filter((k) => k && Number.isFinite(k.x) && Number.isFinite(k.y)) : [];
  }

  /**
   * A pulsing pip per spell marker, drawn inside the dial's clip. A marker
   * beyond the rim is pinned TO the rim on its true bearing — Locate Object
   * says "north-east, four hundred feet" and the dial should agree, rather
   * than dropping the pin because the chest is off the edge of the glass.
   */
  _drawMarkerPips(ctx, cx, cy, r, px) {
    const list = this._markers();
    if (!list.length) return;
    const st = Game.state || {};
    const ox = Math.round(st.x || 0), oy = Math.round(st.y || 0);
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(this.t * 3));

    for (const m of list) {
      let sx = (m.x - ox) * px, sy = (m.y - oy) * px;
      const d = Math.hypot(sx, sy);
      let edge = false;
      if (d > r - 3) { const k = (r - 3) / (d || 1); sx *= k; sy *= k; edge = true; }
      const x = Math.round(cx + sx), y = Math.round(cy + sy);
      const col = m.color || '#b07af0';

      ctx.globalAlpha = clamp(this.alpha, 0, 1) * pulse;
      ctx.fillStyle = col;
      if (edge) {
        // On the rim it is a wedge pointing outward, not a dot you could
        // mistake for something standing there.
        ctx.fillRect(x - 1, y - 1, 3, 3);
      } else {
        ctx.fillRect(x, y - 2, 1, 5);
        ctx.fillRect(x - 2, y, 5, 1);
      }
      ctx.globalAlpha = clamp(this.alpha, 0, 1) * pulse * 0.4;
      ctx.fillRect(x - 3, y - 3, 7, 7);
    }
    ctx.globalAlpha = clamp(this.alpha, 0, 1);
  }

  /** What the nearest pin is, spelled out above the dial. */
  _drawMarkerLabel(ctx, cx, cy, r) {
    const list = this._markers();
    if (!list.length) return;
    const st = Game.state || {};
    const ox = Math.round(st.x || 0), oy = Math.round(st.y || 0);
    const near = list.slice().sort((a, b) => (
      Math.max(Math.abs(a.x - ox), Math.abs(a.y - oy)) - Math.max(Math.abs(b.x - ox), Math.abs(b.y - oy))
    ))[0];
    if (!near || !near.label) return;

    const feet = Math.max(Math.abs(near.x - ox), Math.abs(near.y - oy)) * 5;
    const line = `${near.label} ${feet}ft`;
    const w = Math.min(112, tw(line, 'sm') + 12);
    const x = VIEW_W - 3 - w, y = cy - r - 21;
    ctx.save();
    ctx.globalAlpha = clamp(this.alpha, 0, 1) * 0.92;
    panel(ctx, x, y, w, 11, { style: 'dark' });
    ctx.fillStyle = near.color || '#b07af0';
    ctx.fillRect(x + 4, y + 4, 3, 3);
    txt(ctx, x + 10, y + 2, fit(line, w - 14, 'sm'), { size: 'sm', color: C('ink') });
    ctx.restore();
  }

  // --- message log ribbon -------------------------------------------------

  _drawLog(ctx) {
    const l = this.logLine;
    if (!l) return;
    const fade = l.t > LOG_LIFE - 0.7 ? clamp((LOG_LIFE - l.t) / 0.7, 0, 1) : 1;
    ctx.save();
    ctx.globalAlpha = clamp(this.alpha, 0, 1) * fade;
    panel(ctx, RIBBON.x, RIBBON.y, RIBBON.w, RIBBON.h, { style: 'dark' });
    ctx.fillStyle = logColor(l.kind);
    ctx.fillRect(RIBBON.x + 2, RIBBON.y + 2, 2, RIBBON.h - 4);
    txt(ctx, RIBBON.x + 8, RIBBON.y + 3, fit(l.text, RIBBON.w - 14, 'sm'), { size: 'sm', color: C('ink') });
    ctx.restore();
  }

  // --- toasts -------------------------------------------------------------

  _drawToasts(ctx) {
    for (let i = 0; i < this.toasts.length; i++) {
      const t = this.toasts[i];
      const inT = clamp(t.t / TOAST_SLIDE, 0, 1);
      const outT = t.t > t.life - 0.55 ? clamp((t.life - t.t) / 0.55, 0, 1) : 1;
      const ease = 1 - (1 - inT) * (1 - inT);          // ease-out on the slide in
      const w = Math.min(TOAST_W, Math.max(56, tw(t.text, 'sm') + (t.mark ? 20 : 12)));
      // Centred on the SCREEN, a full-width toast reached x=126 and clipped the
      // party panel's right border. Centre it on the free band between the
      // party strip and the purse instead.
      const bandL = PARTY.x + PARTY.w + 2, bandR = TR.x - 2;
      const x = Math.round(clamp((bandL + bandR) / 2 - w / 2, bandL, Math.max(bandL, bandR - w)));
      const y = Math.round(5 + t.slot - (1 - ease) * 14);

      ctx.save();
      ctx.globalAlpha = ctx.globalAlpha * ease * outT;
      panel(ctx, x, y, w, 13, { style: 'window' });
      // An undefined colour leaves fillStyle at whatever the last widget set,
      // so a plain toast used to take its accent stripe from the minimap.
      const accent = t.color || C('gold');
      ctx.fillStyle = accent;
      ctx.fillRect(x + 1, y + 1, 2, 11);
      let tx = x + 6;
      if (t.mark) { mark(ctx, t.mark, tx, y + 4, accent); tx += 8; }
      txt(ctx, tx, y + 3, fit(t.text, w - (tx - x) - 5, 'sm'), { size: 'sm', color: C('ink'), shadow: true });
      ctx.restore();
    }
  }
}

// ===========================================================================
// helpers
// ===========================================================================

/**
 * HP bar colour by remaining fraction. Deliberately NOT UI.COLORS.hp — that
 * token is the game's arterial red, and a bar that is red at full health is
 * indistinguishable from one that is red at 10%. The whole point of the strip
 * is that a glance tells you who is in trouble, so the ramp runs
 * green -> amber -> red as the pool drains.
 */
function hpColor(m) {
  const pct = clamp((m.hp || 0) / Math.max(1, m.maxHp || 1), 0, 1);
  if (pct <= 0) return '#5a3a38';
  if (pct <= 0.25) return '#e04a34';
  if (pct <= 0.5) return '#e0a03a';
  return '#4fbf5a';
}

function logColor(kind) {
  switch (kind) {
    case 'damage': case 'crit': return '#d4553f';
    case 'heal': return '#6fc36a';
    case 'quest': return '#e3b34a';
    case 'loot': case 'item': return '#6aa8e8';
    case 'warn': case 'fail': return '#c08a3a';
    default: return 'rgba(92,74,42,0.9)';
  }
}

/**
 * The item catalogue is only ever used to put a pretty name on a pickup toast,
 * so it is pulled in lazily: a half-authored data/ barrel must never be the
 * reason the overworld HUD fails to load. Until it lands, toasts fall back to
 * the title-cased item id.
 */
let ITEM_LOOKUP = null;
softImport('../data/items.js').then((m) => {
  if (m && typeof m.resolveItem === 'function') ITEM_LOOKUP = m.resolveItem;
});

function safeItem(id) {
  if (!ITEM_LOOKUP) return null;
  try { return ITEM_LOOKUP(id); } catch (e) { return null; }
}

const PRETTY = (s) => titleCase(String(s || '').replace(/-/g, ' '));

/** Turn a quest step into one short line of plain English. */
function objectiveText(step) {
  if (!step) return 'Objective';
  if (step.text) return String(step.text);
  if (step.desc) return String(step.desc);
  const t = step.target ? PRETTY(step.target) : '';
  switch (step.kind) {
    case 'kill': return t ? `Defeat ${t}` : 'Defeat your quarry';
    case 'boss': return t ? `Slay ${t}` : 'Slay the beast';
    case 'fetch': case 'collect': return t ? `Recover ${t}` : 'Recover the goods';
    case 'deliver': return t ? `Deliver ${t}` : 'Make the delivery';
    case 'talk': return t ? `Speak with ${t}` : 'Find someone to talk to';
    case 'escort': return t ? `Escort ${t}` : 'See them home safely';
    case 'reach': case 'goto': case 'travel': return t ? `Travel to ${t}` : 'Travel on';
    case 'clear': return t ? `Clear ${t}` : 'Clear the lair';
    case 'explore': return t ? `Explore ${t}` : 'Explore';
    case 'flag': case 'event': return t || 'Follow the trail';
    default: return t ? `${PRETTY(step.kind || 'Objective')}: ${t}` : PRETTY(step.kind || 'Objective');
  }
}

/** A 9x9 weather badge: sun or moon by default, with the current sky over it. */
function drawWeatherBadge(ctx, x, y, weather, night) {
  ctx.fillStyle = 'rgba(8,10,16,0.75)';
  ctx.fillRect(x, y, 9, 9);
  const base = night ? 'moon' : 'sun';
  const baseCol = night ? '#c8d0f0' : '#e8c25a';
  switch (weather) {
    case 'rain':
      mark(ctx, 'rain', x + 2, y + 2, '#6aa8e8');
      break;
    case 'snow':
      mark(ctx, 'snow', x + 2, y + 2, '#d8ecff');
      break;
    case 'fog':
      mark(ctx, 'fog', x + 2, y + 2, '#9aa0b0');
      break;
    case 'ash':
      mark(ctx, 'ash', x + 2, y + 2, '#a89888');
      break;
    case 'storm':
      mark(ctx, 'cloud', x + 2, y + 1, '#6a7086');
      mark(ctx, 'bang', x + 2, y + 3, '#e8d24a');
      break;
    default:
      mark(ctx, base, x + 2, y + 2, baseCol);
  }
}

export default HUD;
