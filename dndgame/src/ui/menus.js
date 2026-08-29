// ui/menus.js — every screen the player opens from the pause menu: the character
// sheet, the shared pack, the spellbook, the journal, the regional map, the
// settings, the bestiary and the five save journals.
//
// House rules for this file:
//   * ALL drawing goes through ui/kit.js UI.* — never ctx.fillText, never ctx.font.
//   * Every screen is fully navigable from the keyboard/gamepad AND clickable.
//   * Nothing here may throw because a catalogue another agent is still writing is
//     missing: optional catalogues are read through safe() and soft dynamic imports.
//   * 400x240 logical pixels. Draw on integers. Never let text leave its panel.

import { UI } from './kit.js';
import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { Save } from '../core/save.js';
import { Game } from '../engine.js';
import { FX } from '../render/fx.js';
import {
  VIEW_W, VIEW_H, clamp, signed, ordinal, titleCase, playtimeText, plural,
  dateText, EQUIP_SLOTS, SLOT_NAMES, RARITY, PARTY_MAX, crText,
} from '../constants.js';
import { bus, EV, toast } from '../core/events.js';
import { rollExpr, avgExpr } from '../core/dice.js';
import { drawSprite, hasSprite, spriteFrames } from '../render/sprites.js';
import { ABILITIES, ABILITY_NAMES, ABILITY_ABBR, SKILLS, SKILL_IDS } from '../rules/abilities.js';
import {
  abilityScore, abilityMod, profBonus, skillMod, saveMod, acOf, maxHpOf, speedOf,
  initiativeMod, passivePerception, allFeatures, mechOf, weaponsOf, equip, unequip,
  makeItemInstance, itemDef, equipped, cloneChar, recalc, heal, addTempHp, addEffect,
  isDown, isDead, hitDiceTotal, serializeChar, deserializeChar, masteryInfo,
} from '../rules/character.js';
import {
  spellDC, spellAtk, preparedMax, knownSpells, canPrepare, isPreparedCaster,
  alwaysPreparedSpells, isConcentrating, casterLevel,
} from '../rules/spellcasting.js';
import {
  CONDITIONS, activeConditions, conditionText, removeCondition, exhaustionLevel,
} from '../rules/conditions.js';
import { className, subclassName, xpToNext, xpProgress } from '../rules/progression.js';
import { fieldCastable, fieldCast, fieldTargeting } from '../rules/fieldcast.js';
import { Party } from '../world/party.js';
import {
  saveState, loadState, stateSummary, advanceTime, timeInfo, REP_RANKS, repRank,
} from '../state.js';
import {
  SPELLS, SCHOOLS, rangeText, componentText, spellDamageDice, spellHealDice,
} from '../data/spells.js';
import { resolveItem, rarityColor, weaponLine, armorLine, slotFor, isMagic } from '../data/items.js';
import { MONSTERS, MONSTER_IDS, statLine, xpOf } from '../data/monsters.js';

// ===========================================================================
// 0. SAFETY & SHORTHANDS
// ===========================================================================

const C = UI.COLORS;

function safe(fn, fb) {
  try { const v = fn(); return v === undefined || v === null ? fb : v; } catch (e) { return fb; }
}
function sfx(name) { safe(() => Audio.sfx(name), false); }
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const S = () => Game.state || null;
const R = (n) => Math.round(n) | 0;

/** Modules other agents are still writing. A missing one must never throw. */
const LATE = {};
function softImport(path, key) {
  if (LATE[key] !== undefined && LATE[key] !== null) return Promise.resolve(LATE[key] || null);
  return import(/* @vite-ignore */ path)
    .then((m) => { LATE[key] = m || false; return m || null; })
    .catch(() => { LATE[key] = false; return null; });
}
// Kick the optional catalogues off at load; every reader falls back gracefully.
safe(() => softImport('../data/quests.js', 'quests'));
safe(() => softImport('../data/npcs.js', 'npcs'));
safe(() => softImport('../data/tables.js', 'tables'));
safe(() => softImport('../world/maps.js', 'maps'));
safe(() => softImport('../data/species.js', 'species'));

const QUESTS = () => (LATE.quests && LATE.quests.QUESTS) || {};
const NPCS = () => (LATE.npcs && LATE.npcs.NPCS) || {};
const TABLES = () => LATE.tables || {};
const SPECIES = () => (LATE.species && LATE.species.SPECIES) || {};

// --- text helpers ----------------------------------------------------------

function txt(ctx, x, y, s, opts) { return UI.text(ctx, R(x), R(y), s, opts || {}); }
function txtR(ctx, x, y, s, opts) { return UI.text(ctx, R(x), R(y), s, { ...(opts || {}), align: 'right' }); }
function txtC(ctx, x, y, s, opts) { return UI.text(ctx, R(x), R(y), s, { ...(opts || {}), align: 'center' }); }

/** A dim label on the left, a bright value hard against the right edge. */
function kv(ctx, x, y, w, label, value, opts = {}) {
  const v = String(value);
  const vw = UI.measure(v, opts.size || 'sm');
  txt(ctx, x, y, label, {
    size: 'sm', color: opts.labelColor || C.inkDim, shadow: true,
    maxWidth: Math.max(8, w - vw - 4),
  });
  txtR(ctx, x + w, y, v, { size: opts.size || 'sm', color: opts.color || C.ink, shadow: true });
}

/** A small gold caption with a rule running out to the right of it. */
function sectionHead(ctx, x, y, w, label, color) {
  txt(ctx, x, y, label, { size: 'sm', color: color || C.goldDim, shadow: true });
  const lw = UI.measure(label, 'sm');
  if (w - lw - 5 > 6) UI.divider(ctx, x + lw + 4, y + 3, w - lw - 5, { color: 'rgba(92,74,42,0.85)' });
  return y + 9;
}

// --- key prompts -----------------------------------------------------------

const KEY_LABEL = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Enter: 'ENT', NumpadEnter: 'ENT', Space: 'SPC', Escape: 'ESC', Backspace: 'BSP',
  ShiftLeft: 'SHF', ShiftRight: 'SHF', Tab: 'TAB', Backquote: 'TIL',
  ControlLeft: 'CTL', ControlRight: 'CTL', AltLeft: 'ALT', AltRight: 'ALT',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';',
  BracketLeft: '[', BracketRight: ']',
};
function codeLabel(code) {
  if (!code) return '—';
  if (KEY_LABEL[code]) return KEY_LABEL[code];
  const s = String(code);
  if (s.indexOf('Key') === 0) return s.slice(3);
  if (s.indexOf('Digit') === 0) return s.slice(5);
  if (s.indexOf('Numpad') === 0) return `N${s.slice(6)}`;
  if (/^F\d{1,2}$/.test(s)) return s;
  return s.slice(0, 4).toUpperCase();
}
function keyFor(action) {
  const list = safe(() => Input.bindings[action], null) || [];
  return codeLabel(list[0]);
}

// One vertical rhythm for every screen: content ends at 210, the transient
// status line sits on 212, and the key strip owns everything from 220 down.
const CONTENT_BOTTOM = 210;
const MSG_Y = 212;
const HINT_Y = 224;

/** The dark strip of [KEY] Label prompts along the bottom of every screen. */
function hintBar(ctx, y, hints) {
  ctx.save();
  ctx.fillStyle = 'rgba(8,10,18,0.88)';
  ctx.fillRect(0, R(y) - 4, VIEW_W, VIEW_H - R(y) + 4);
  ctx.fillStyle = 'rgba(92,74,42,0.85)';
  ctx.fillRect(0, R(y) - 4, VIEW_W, 1);
  ctx.restore();
  let x = 4;
  for (const h of hints) {
    if (!h) continue;
    if (x > VIEW_W - 24) break;
    const w = safe(() => UI.keyHint(ctx, x, R(y), h[0], h[1]), 0) || 0;
    x += w + 7;
  }
}

// --- pointer ---------------------------------------------------------------

function hit(m, x, y, w, h) {
  return !!m && m.over !== false && m.x >= x && m.x < x + w && m.y >= y && m.y < y + h;
}
/** True once, and swallows the click so two widgets never both fire on it. */
function clicked(m, x, y, w, h) {
  if (hit(m, x, y, w, h) && m.clicked) { m.clicked = false; return true; }
  return false;
}
function wheelOver(m, x, y, w, h) {
  if (!hit(m, x, y, w, h)) return 0;
  const v = num(m.wheel, 0);
  if (!v) return 0;
  m.wheel = 0;
  return v > 0 ? 1 : -1;
}

// --- navigation ------------------------------------------------------------

function navV(cur, len, opts = {}) {
  if (len <= 0) return 0;
  let i = clamp(num(cur, 0) | 0, 0, len - 1);
  const wrap = opts.wrap !== false;
  if (Input.repeatConsume('up')) { i = wrap ? (i - 1 + len) % len : Math.max(0, i - 1); sfx('cursor'); }
  if (Input.repeatConsume('down')) { i = wrap ? (i + 1) % len : Math.min(len - 1, i + 1); sfx('cursor'); }
  return i;
}
function navH(cur, len, opts = {}) {
  if (len <= 0) return 0;
  let i = clamp(num(cur, 0) | 0, 0, len - 1);
  const wrap = opts.wrap !== false;
  if (Input.repeatConsume('left')) { i = wrap ? (i - 1 + len) % len : Math.max(0, i - 1); sfx('cursor'); }
  if (Input.repeatConsume('right')) { i = wrap ? (i + 1) % len : Math.min(len - 1, i + 1); sfx('cursor'); }
  return i;
}
/** prev/next (Q and R by default) — used everywhere to page tabs or sections. */
function navPage(cur, len) {
  if (len <= 0) return 0;
  let i = clamp(num(cur, 0) | 0, 0, len - 1);
  if (Input.consume('prev')) { i = (i - 1 + len) % len; sfx('cursor'); }
  if (Input.consume('next')) { i = (i + 1) % len; sfx('cursor'); }
  return i;
}
/** Which tabN action fired this frame, or -1. */
function tabPressed(max = 5) {
  for (let i = 1; i <= max; i++) if (Input.consume(`tab${i}`)) return i - 1;
  return -1;
}
/** Run + up/down scrolls a text pane without disturbing the list cursor. */
function scrollPane(cur, max, m, rect) {
  let v = clamp(num(cur, 0), 0, Math.max(0, max));
  if (Input.down('run')) {
    if (Input.repeatConsume('up')) v = Math.max(0, v - 1);
    if (Input.repeatConsume('down')) v = Math.min(Math.max(0, max), v + 1);
  }
  if (rect) {
    const w = wheelOver(m, rect.x, rect.y, rect.w, rect.h);
    if (w) v = clamp(v + w * 2, 0, Math.max(0, max));
  }
  return v;
}
/** True when the list cursor should move (i.e. Run is not stealing up/down). */
const listNavActive = () => !Input.down('run');

// --- character helpers -----------------------------------------------------

function hpColor(ch) {
  const max = maxHpOf(ch);
  const p = max > 0 ? num(ch && ch.hp, 0) / max : 0;
  if (p <= 0) return C.disabled;
  if (p < 0.25) return C.red;
  if (p < 0.6) return C.warn;
  return C.hp;
}
function classText(ch) {
  const cl = arr(ch && ch.classes);
  if (!cl.length) return 'Adventurer';
  return cl.map((c) => `${safe(() => className(c.id), null) || titleCase(String(c.id || ''))} ${c.level || 1}`).join('/');
}
function subclassText(ch) {
  const c = arr(ch && ch.classes)[0];
  if (!c || !c.subclassId) return '';
  return safe(() => subclassName(c.subclassId), null) || titleCase(String(c.subclassId).replace(/-/g, ' '));
}
function speciesText(ch) {
  if (!ch) return '—';
  const sp = SPECIES()[ch.speciesId] || null;
  const base = (sp && sp.name) || titleCase(String(ch.speciesId || 'folk').replace(/-/g, ' '));
  if (!ch.lineageId) return base;
  const lin = sp && arr(sp.lineages).find((l) => l && l.id === ch.lineageId);
  return `${base} · ${(lin && lin.name) || titleCase(String(ch.lineageId).replace(/-/g, ' '))}`;
}

function itemIcon(d) {
  if (!d) return 'bag';
  if (d.icon) return d.icon;
  switch (d.kind) {
    case 'weapon': return 'sword';
    case 'armor': return 'armor';
    case 'shield': return 'shield';
    case 'potion': return 'potion';
    case 'scroll': return 'scroll';
    case 'wand': return 'wand';
    case 'ring': return 'ring';
    case 'amulet': return 'amulet';
    case 'cloak': return 'cloak';
    case 'boots': return 'boots';
    case 'gloves': return 'armor';
    case 'helm': return 'helm';
    case 'gem': return 'gem';
    case 'ammo': return 'bow';
    case 'tool': return 'hammer';
    case 'food': return 'flask';
    case 'quest': return 'quest';
    case 'material': return 'rune';
    default: return 'bag';
  }
}
function itemColor(id, d) {
  return safe(() => rarityColor(id), null) || (RARITY[(d && d.rarity) || 'common'] || {}).color || C.ink;
}
function itemName(id, d) {
  return (d && d.name) || titleCase(String(id || '').replace(/-/g, ' '));
}
function rarityName(d) {
  return (RARITY[(d && d.rarity) || 'common'] || {}).name || 'Common';
}
const goldText = (n) => `${Math.round(num(n, 0))} gp`;

/** Carrying capacity for the whole company: Strength x 15 per member. */
function partyCapacity() {
  let cap = 0;
  for (const m of Party.members) {
    const str = num(safe(() => abilityScore(m, 'str'), 10), 10);
    const mult = num(safe(() => mechOf(m).carryMult, 1), 1) || 1;
    cap += str * 15 * mult;
  }
  return Math.max(30, Math.round(cap));
}
function packWeight() {
  let w = 0;
  for (const e of arr(Party.inventory)) {
    const d = safe(() => resolveItem(e.id), null);
    w += num(d && d.weight, 0) * num(e.qty, 1);
  }
  return Math.round(w * 10) / 10;
}

/** Portrait + name + HP, the cell every roster row and member tab is built from. */
function drawMemberCell(ctx, ch, x, y, w, h, opts = {}) {
  const sel = !!opts.selected;
  const ps = Math.min(h - 4, 22);
  safe(() => UI.portrait(ctx, ch, x + 2, y + 2, ps, { shadow: 0.25 }));
  const tx = x + ps + 6;
  const tw = Math.max(10, w - (ps + 10));
  const down = safe(() => isDown(ch), false);
  txt(ctx, tx, y + 3, ch && ch.name ? ch.name : 'Empty', {
    size: sel ? 'md' : 'sm', color: down ? C.bad : (sel ? C.goldBright : C.ink),
    shadow: true, maxWidth: tw,
  });
  if (h >= 22) {
    const hp = Math.max(0, num(ch && ch.hp, 0));
    const max = Math.max(1, maxHpOf(ch));
    UI.bar(ctx, tx, y + 13, Math.min(tw, 62), 4, hp / max, { color: hpColor(ch) });
    txt(ctx, tx, y + 19, `${hp}/${max}`, { size: 'sm', color: C.inkDim, shadow: true, maxWidth: tw });
    if (tw > 74) {
      txtR(ctx, x + w - 3, y + 19, `Lv ${num(ch && ch.level, 1)}`, { size: 'sm', color: C.goldDim, shadow: true });
    }
  }
}

// ===========================================================================
// 1. BASE SCENE — prompts, transient messages, floaters
// ===========================================================================

class MenuScene {
  constructor(id) {
    this.id = id;
    this.opaque = true;
    this.pausesBelow = true;
    this.uiLayer = true;      // weather and day/night grading stop below this
    this.t = 0;
    this.prompt = null;       // { title, body, options, index, onPick, rects }
    this.msg = '';
    this.msgT = 0;
    this.msgBad = false;
    this.floats = [];         // local floaters, in screen pixels
    this._closing = false;
  }

  enter() { safe(() => Input.flush()); this._closing = false; }
  exit() {}

  /** Advance timers. Returns true when a modal prompt swallowed this frame. */
  tick(dt) {
    this.t += num(dt, 0);
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg = ''; }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      this.floats[i].t += dt;
      if (this.floats[i].t > 1.1) this.floats.splice(i, 1);
    }
    if (this.prompt) { this._updatePrompt(); return true; }
    return false;
  }

  say(text, bad = false, life = 3.2) {
    this.msg = String(text == null ? '' : text);
    this.msgBad = !!bad;
    this.msgT = life;
    if (bad) sfx('error');
  }

  float(x, y, text, color) {
    this.floats.push({ x: R(x), y: R(y), text: String(text), color: color || C.hpHeal, t: 0 });
  }

  /** options: strings, or { label, value, disabled, color }. */
  ask(title, body, options, onPick) {
    this.prompt = {
      title: title || '',
      body: body || '',
      options: arr(options).map((o) => (typeof o === 'string' ? { label: o, value: o } : o)).filter(Boolean),
      index: 0,
      onPick: typeof onPick === 'function' ? onPick : null,
      rects: [],
    };
    sfx('open');
  }

  _updatePrompt() {
    const p = this.prompt;
    p.index = navV(p.index, p.options.length);
    const m = Input.mouse;
    for (let i = 0; i < (p.rects || []).length; i++) {
      const r = p.rects[i];
      if (hit(m, r.x, r.y, r.w, r.h)) {
        if (p.index !== i) { p.index = i; sfx('cursor'); }
        if (clicked(m, r.x, r.y, r.w, r.h)) { this._pick(); return; }
      }
    }
    if (Input.consume('confirm')) { this._pick(); return; }
    if (Input.consume('cancel')) {
      sfx('back');
      const cb = p.onPick;
      this.prompt = null;
      if (cb) cb(null, -1);
    }
  }

  _pick() {
    const p = this.prompt;
    const o = p.options[p.index];
    if (!o || o.disabled) { sfx('error'); return; }
    sfx('select');
    const cb = p.onPick;
    this.prompt = null;
    if (cb) cb(o.value !== undefined ? o.value : o.label, p.index);
  }

  drawPrompt(ctx) {
    const p = this.prompt;
    if (!p) return;
    UI.scrim(ctx, 0.52);
    const lines = p.body ? UI.wrapLines(p.body, 208, 'sm') : [];
    const h = 16 + lines.length * 9 + p.options.length * 14 + 8;
    const w = 240;
    const x = R((VIEW_W - w) / 2);
    const y = clamp(R((VIEW_H - h) / 2), 12, Math.max(12, VIEW_H - h - 6));
    UI.window(ctx, x, y, w, h, p.title, { style: 'window' });
    let ty = y + 7;
    for (const l of lines) { txt(ctx, x + 12, ty, l, { size: 'sm', color: C.ink, shadow: true }); ty += 9; }
    ty += 4;
    p.rects = [];
    p.options.forEach((o, i) => {
      const bw = w - 40, bx = x + 20, by = ty + i * 14;
      UI.button(ctx, bx, by, bw, 12, o.label, {
        selected: i === p.index, disabled: !!o.disabled, t: this.t, color: o.color || null,
      });
      p.rects.push({ x: bx, y: by, w: bw, h: 12 });
    });
  }

  drawMessage(ctx, x, y, w) {
    if (!this.msg) return;
    txt(ctx, x, y, this.msg, {
      size: 'sm', color: this.msgBad ? C.bad : C.goldBright, shadow: true,
      maxWidth: w, alpha: clamp(this.msgT / 0.5, 0, 1),
    });
  }

  /**
   * For screens with no spare row (the spellbook's slot pips, the map's legend):
   * the status line rides the right-hand end of the key strip. Call it AFTER
   * hintBar so it draws on top of the strip.
   */
  drawStatusRight(ctx) {
    if (!this.msg) return;
    txtR(ctx, VIEW_W - 6, HINT_Y + 2, this.msg, {
      size: 'sm', color: this.msgBad ? C.bad : C.goldBright, shadow: true,
      maxWidth: 186, alpha: clamp(this.msgT / 0.5, 0, 1),
    });
  }

  drawFloats(ctx) {
    for (const f of this.floats) {
      const p = f.t / 1.1;
      txtC(ctx, f.x, f.y - p * 16, f.text, { size: 'md', color: f.color, outline: true, alpha: 1 - p * p });
    }
  }

  close(result) {
    if (this._closing) return;
    this._closing = true;
    sfx('back');
    if (Game.top === this) Game.pop(result);
  }
}

// ===========================================================================
// 2. PAUSE MENU
// ===========================================================================

const PAUSE_ITEMS = [
  { id: 'party', label: 'Party', icon: 'helm', key: 1, desc: 'Character sheets: ability scores, features, gear, conditions and every attack each companion can make.' },
  { id: 'inventory', label: 'Inventory', icon: 'bag', key: 2, desc: 'The company pack. Use, equip, hand over or drop what you are hauling around the Sword Coast.' },
  { id: 'spells', label: 'Spells', icon: 'book', key: 3, desc: 'Prepare spells against your class cap, spend slots, and read exactly what each one does.' },
  { id: 'journal', label: 'Journal', icon: 'scroll', key: 4, desc: 'Quests, faction contracts, standing with the five factions, and the Realms lore you have gathered.' },
  { id: 'map', label: 'Map', icon: 'map', key: 5, desc: 'The ground you have walked, the roads out of it, and the way back to a town you have found.' },
  { id: 'camp', label: 'Camp', icon: 'flame', key: 0, desc: 'Take a short rest and spend Hit Dice, or a long rest to recover everything — if the ground is safe enough.' },
  { id: 'bestiary', label: 'Bestiary', icon: 'skull', key: 0, desc: 'Stat blocks for every creature the company has put down, with kill counts.' },
  { id: 'save', label: 'Save', icon: 'quest', key: 0, desc: 'Write the tale so far into one of five journals.' },
  { id: 'settings', label: 'Settings', icon: 'anvil', key: 0, desc: 'Volume, text and battle speed, difficulty, accessibility and the keys you press.' },
  { id: 'quit', label: 'Quit to Title', icon: 'key', key: 0, desc: 'Return to the title screen. Anything you have not written into a journal is lost.' },
];

/** Biomes where you cannot safely sleep for eight hours. */
const NO_LONG_REST = ['dungeon', 'cave', 'crypt', 'mine', 'underdark'];

function currentMap() {
  const stack = arr(Game.scenes);
  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i];
    if (!s) continue;
    const m = s.map || s.tilemap || (s.world && s.world.map) || null;
    if (m && (m.w || m.width)) return m;
  }
  return safe(() => Game.map, null) || null;
}

function restInfo() {
  const map = currentMap();
  const st = S();
  const biome = (map && map.biome) || (st && st.biome) || 'road';
  const indoor = !!(map && map.indoor);
  const town = !!(map && (map.kind === 'town' || map.kind === 'inn')) || biome === 'city';
  const hostile = NO_LONG_REST.indexOf(biome) >= 0 && !map?.cleared;
  return {
    place: (map && map.name) || (st && st.mapId) || 'the road',
    canShort: true,
    canLong: !hostile,
    safe: indoor || town,
    reason: hostile
      ? 'Not down here. Find the surface, or clear the level first.'
      : (indoor || town ? '' : 'Camping in the open invites company.'),
  };
}

export class PauseMenuScene extends MenuScene {
  constructor(opts = {}) {
    super('pause');
    this.opaque = false;          // the overworld keeps drawing beneath us
    this.pausesBelow = true;
    this.opts = opts || {};
    this.index = 0;
    this.rest = null;             // { spend:{uid:n}, index } while allocating Hit Dice
    this.rects = [];
  }

  enter(prev) {
    super.enter(prev);
    this.rest = null;
  }

  update(dt) {
    if (this.tick(dt)) return;
    if (this.rest) { this._updateRest(); return; }

    const n = PAUSE_ITEMS.length;
    if (listNavActive()) this.index = navV(this.index, n);

    // Number keys and the dedicated action keys jump straight in.
    const tp = tabPressed(5);
    if (tp >= 0) { this.index = tp; this._activate(PAUSE_ITEMS[tp].id); return; }
    if (Input.consume('party')) { this._activate('party'); return; }
    if (Input.consume('inventory')) { this._activate('inventory'); return; }
    if (Input.consume('journal')) { this._activate('journal'); return; }
    if (Input.consume('map')) { this._activate('map'); return; }

    const m = Input.mouse;
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      if (hit(m, r.x, r.y, r.w, r.h)) {
        if (this.index !== i) { this.index = i; sfx('cursor'); }
        if (clicked(m, r.x, r.y, r.w, r.h)) { this._activate(PAUSE_ITEMS[i].id); return; }
      }
    }

    if (Input.consume('confirm')) { this._activate(PAUSE_ITEMS[this.index].id); return; }
    if (Input.consume('cancel') || Input.consume('menu')) this.close();
  }

  // --- actions ------------------------------------------------------------

  _activate(id) {
    sfx('select');
    switch (id) {
      case 'party': Game.push(new PartyScene()); break;
      case 'inventory': Game.push(new InventoryScene()); break;
      case 'spells': Game.push(new SpellbookScene()); break;
      case 'journal': Game.push(new JournalScene()); break;
      case 'map': Game.push(new MapScene()); break;
      case 'bestiary': Game.push(new BestiaryScene()); break;
      case 'save': Game.push(new SaveMenuScene('save')); break;
      case 'settings': Game.push(new OptionsScene()); break;
      case 'camp': this._camp(); break;
      case 'quit': this._quit(); break;
      default: break;
    }
  }

  _camp() {
    const info = restInfo();
    const body = info.reason || `You are at ${info.place}. It will serve.`;
    this.ask('Make Camp', body, [
      { label: 'Short Rest — one hour', value: 'short' },
      { label: 'Long Rest — eight hours', value: 'long', disabled: !info.canLong },
      { label: 'Never mind', value: null },
    ], (v) => {
      if (v === 'short') this._openShortRest();
      else if (v === 'long') this._confirmLongRest(info);
    });
  }

  _openShortRest() {
    const spend = {};
    for (const m of Party.members) spend[m.uid] = 0;
    this.rest = { spend, index: 0 };
    sfx('open');
  }

  _updateRest() {
    const members = Party.members;
    const rows = members.length + 1;                 // + the "Rest" button
    this.rest.index = navV(this.rest.index, rows);
    const i = this.rest.index;
    if (i < members.length) {
      const ch = members[i];
      const hd = safe(() => hitDiceTotal(ch), null) || { max: 0, used: 0 };
      const free = Math.max(0, num(hd.max, 0) - num(hd.used, 0));
      let v = num(this.rest.spend[ch.uid], 0);
      if (Input.repeatConsume('left') && v > 0) { v--; sfx('cursor'); }
      if (Input.repeatConsume('right') && v < free) { v++; sfx('cursor'); }
      this.rest.spend[ch.uid] = v;
    }
    if (Input.consume('confirm')) {
      if (i >= members.length) this._applyShortRest();
      else sfx('cursor');
      return;
    }
    if (Input.consume('cancel')) { sfx('back'); this.rest = null; }
  }

  _applyShortRest() {
    const st = S();
    const spend = this.rest.spend;
    this.rest = null;
    const logs = safe(() => Party.shortRest(spend), []) || [];
    if (st) safe(() => advanceTime(st, 60));
    sfx('heal');
    safe(() => toast('You take an hour. Wounds close, a little.'));
    this.say(logs.length ? String(logs[logs.length - 1]) : 'The company catches its breath.');
  }

  _confirmLongRest(info) {
    this.ask('Long Rest', `Sleep eight hours at ${info.place}? Hit points, slots and most conditions return.`, [
      { label: 'Sleep', value: 'yes' },
      { label: 'Not yet', value: null },
    ], (v) => {
      if (v !== 'yes') return;
      const st = S();
      safe(() => Party.longRest());
      if (st) { safe(() => advanceTime(st, 480)); st.stats.longRests = num(st.stats.longRests, 0) + 1; }
      sfx('levelup');
      safe(() => toast('Dawn. Everyone is on their feet again.'));
      this.say('The company wakes rested.');
    });
  }

  _quit() {
    this.ask('Quit to Title', 'Any progress since your last save is lost.', [
      { label: 'Quit', value: 'yes', color: C.bad },
      { label: 'Stay', value: null },
    ], (v) => {
      if (v !== 'yes') return;
      softImport('./title.js', 'title').then((mod) => {
        safe(() => Audio.music(null));
        if (mod && mod.TitleScene) {
          Game.transition('fade', () => { Game.replace(new mod.TitleScene()); safe(() => Audio.music('title')); });
        } else {
          this.say('The title screen is not available.', true);
        }
      });
    });
  }

  // --- drawing ------------------------------------------------------------

  draw(ctx) {
    UI.scrim(ctx, 0.62);
    this._drawStrip(ctx);

    const LX = 6, LY = 34, LW = 150, LH = CONTENT_BOTTOM - LY;
    UI.panel(ctx, LX, LY, LW, LH, { style: 'window' });
    this.rects = [];
    const rowH = 16;
    for (let i = 0; i < PAUSE_ITEMS.length; i++) {
      const it = PAUSE_ITEMS[i];
      const ry = LY + 5 + i * rowH;
      const sel = i === this.index;
      this.rects.push({ x: LX + 4, y: ry, w: LW - 8, h: rowH - 2 });
      if (sel) UI.highlight(ctx, LX + 4, ry, LW - 8, rowH - 2, { alpha: 0.22 });
      UI.icon(ctx, it.icon, LX + 8, ry + 3, 9, sel ? C.goldBright : C.inkDim);
      txt(ctx, LX + 21, ry + 4, it.label, {
        size: sel ? 'md' : 'sm', color: sel ? C.goldBright : C.ink, shadow: true, maxWidth: LW - 46,
      });
      if (it.key) txtR(ctx, LX + LW - 8, ry + 4, String(it.key), { size: 'sm', color: C.goldDim, shadow: true });
      if (sel) UI.cursor(ctx, LX + 1, ry + 4, this.t);
    }
    const st = S();
    if (st) {
      const ti = safe(() => timeInfo(st), null) || {};
      txtC(ctx, LX + LW / 2, LY + LH - 10, `${prettyMapName(st.mapId)} · ${ti.clock || ''}`, {
        size: 'sm', color: C.inkDim, shadow: true, maxWidth: LW - 10,
      });
    }

    this._drawInfo(ctx, 160, 34, 234, CONTENT_BOTTOM - 34);
    this.drawMessage(ctx, 6, MSG_Y, VIEW_W - 12);
    hintBar(ctx, HINT_Y, [
      [keyFor('confirm'), 'Open'], [keyFor('cancel'), 'Close'],
      ['1-5', 'Jump'], [`${keyFor('up')}${keyFor('down')}`, 'Move'],
    ]);
    if (this.rest) this._drawRest(ctx);
    this.drawPrompt(ctx);
    this.drawFloats(ctx);
  }

  /** The party strip and purse along the top. */
  _drawStrip(ctx) {
    UI.panel(ctx, 2, 2, VIEW_W - 4, 28, { style: 'dark' });
    const members = Party.members;
    const cw = 84;
    for (let i = 0; i < PARTY_MAX; i++) {
      const x = 5 + i * cw;
      const ch = members[i] || null;
      if (!ch) {
        txt(ctx, x + 6, 13, '—', { size: 'sm', color: C.disabled, shadow: true });
        continue;
      }
      drawMemberCell(ctx, ch, x, 3, cw - 3, 26, { selected: false });
    }
    const bx = 5 + PARTY_MAX * cw;
    UI.icon(ctx, 'coin', bx, 5, 8, C.gold);
    txt(ctx, bx + 10, 6, String(Math.round(num(Party.gold, 0))), { size: 'sm', color: C.gold, shadow: true, maxWidth: 40 });
    const st = S();
    if (st) {
      const ti = safe(() => timeInfo(st), null) || {};
      txt(ctx, bx, 15, ti.clock || '', { size: 'sm', color: C.ink, shadow: true, maxWidth: 48 });
      txt(ctx, bx, 23, `Lv ${safe(() => Party.levelAvg(), 1)}`, { size: 'sm', color: C.inkDim, shadow: true, maxWidth: 48 });
    }
  }

  /** The right-hand pane: what the highlighted entry does, plus a campaign digest. */
  _drawInfo(ctx, x, y, w, h) {
    UI.panel(ctx, x, y, w, h, { style: 'window' });
    const it = PAUSE_ITEMS[this.index];
    const ix = x + 7, iw = w - 14;
    txt(ctx, ix, y + 6, it.label, { size: 'md', color: C.gold, shadow: true, maxWidth: iw });
    UI.textWrapped(ctx, ix, y + 18, iw, it.desc, { size: 'sm', color: C.ink, maxLines: 3 });

    let ty = sectionHead(ctx, ix, y + 50, iw, 'THE CAMPAIGN');
    const st = S();
    if (!st) {
      txt(ctx, ix, ty, 'No campaign is running.', { size: 'sm', color: C.inkDim, shadow: true, maxWidth: iw });
      return;
    }
    const ti = safe(() => timeInfo(st), null) || {};
    const colW = Math.floor((iw - 8) / 2);
    const left = [
      ['Location', prettyMapName(st.mapId)],
      ['Date', ti.date || dateText(num(st.day, 1))],
      ['Time', `${ti.clock || ''} ${titleCase(ti.phase || '')}`],
      ['Weather', titleCase(String(st.weather || 'clear'))],
      ['Playtime', playtimeText(num(st.playtime, 0))],
    ];
    const right = [
      ['Party', `${Party.members.length} · Lv ${safe(() => Party.levelAvg(), 1)}`],
      ['Purse', goldText(Party.gold)],
      ['Foes slain', String(num(st.stats && st.stats.kills, 0))],
      ['Quests done', String(num(st.stats && st.stats.questsDone, 0))],
      ['Difficulty', titleCase(String(safe(() => Save.settings.difficulty, 'normal') || 'normal'))],
    ];
    for (let i = 0; i < left.length; i++) {
      kv(ctx, ix, ty + i * 10, colW, left[i][0], left[i][1]);
      kv(ctx, ix + colW + 8, ty + i * 10, colW, right[i][0], right[i][1]);
    }
    ty += left.length * 10 + 3;

    ty = sectionHead(ctx, ix, ty, iw, 'TRACKED');
    const q = trackedQuest(st);
    if (!q) {
      txt(ctx, ix, ty, 'Nothing tracked. Open the journal to pick a task.', {
        size: 'sm', color: C.inkDim, shadow: true, maxWidth: iw,
      });
    } else {
      txt(ctx, ix, ty, q.title || q.id, { size: 'sm', color: C.goldBright, shadow: true, maxWidth: iw });
      const step = arr(q.steps).find((s) => !s.done) || arr(q.steps)[0] || null;
      if (step) {
        txt(ctx, ix, ty + 9, stepText(step), { size: 'sm', color: C.ink, shadow: true, maxWidth: iw - 30 });
        txtR(ctx, ix + iw, ty + 9, `${num(step.progress, 0)}/${num(step.count, 1)}`, {
          size: 'sm', color: step.done ? C.good : C.inkDim, shadow: true,
        });
      }
    }
  }

  /** The Hit Dice allocation window for a short rest. */
  _drawRest(ctx) {
    UI.scrim(ctx, 0.5);
    const members = Party.members;
    const h = 34 + members.length * 20 + 16;
    const w = 246;
    const x = R((VIEW_W - w) / 2), y = clamp(R((VIEW_H - h) / 2), 10, VIEW_H - h - 6);
    UI.window(ctx, x, y, w, h, 'Short Rest', { style: 'window' });
    txt(ctx, x + 8, y + 6, 'Spend Hit Dice to heal. One hour passes.', {
      size: 'sm', color: C.inkDim, shadow: true, maxWidth: w - 16,
    });
    members.forEach((ch, i) => {
      const ry = y + 18 + i * 20;
      const sel = this.rest.index === i;
      if (sel) UI.highlight(ctx, x + 5, ry, w - 10, 18, { alpha: 0.2 });
      txt(ctx, x + 9, ry + 2, ch.name, { size: sel ? 'md' : 'sm', color: sel ? C.goldBright : C.ink, shadow: true, maxWidth: 84 });
      const hp = Math.max(0, num(ch.hp, 0)), max = Math.max(1, maxHpOf(ch));
      UI.bar(ctx, x + 9, ry + 11, 84, 4, hp / max, { color: hpColor(ch), label: `${hp}/${max}`, size: 'sm' });
      const hd = safe(() => hitDiceTotal(ch), null) || { max: 0, used: 0 };
      const free = Math.max(0, num(hd.max, 0) - num(hd.used, 0));
      const spend = num(this.rest.spend[ch.uid], 0);
      txtR(ctx, x + w - 62, ry + 5, `${free - spend}/${num(hd.max, 0)} HD`, { size: 'sm', color: C.inkDim, shadow: true });
      txt(ctx, x + w - 54, ry + 5, '◀', { size: 'sm', color: spend > 0 ? C.gold : C.disabled });
      txtC(ctx, x + w - 34, ry + 5, String(spend), { size: 'md', color: spend ? C.goldBright : C.inkDim, shadow: true });
      txt(ctx, x + w - 20, ry + 5, '▶', { size: 'sm', color: spend < free ? C.gold : C.disabled });
      if (sel) UI.cursor(ctx, x + 1, ry + 5, this.t);
    });
    const by = y + 18 + members.length * 20 + 2;
    UI.button(ctx, x + 60, by, w - 120, 13, 'Take the rest', {
      selected: this.rest.index >= members.length, t: this.t,
    });
  }
}

function prettyMapName(id) {
  if (!id) return 'The Sword Coast';
  const maps = (LATE.maps && (LATE.maps.MAP_DEFS || LATE.maps.MAPS)) || null;
  const d = maps && maps[id];
  if (d && d.name) return d.name;
  return titleCase(String(id).replace(/-/g, ' '));
}

function trackedQuest(st) {
  if (!st || !st.quests) return null;
  const id = st.quests.tracked;
  const active = arr(st.quests.active);
  return (id && active.find((q) => q.id === id)) || active[0] || null;
}

function stepText(step) {
  if (!step) return '';
  if (step.text) return step.text;
  const target = titleCase(String(step.target || '').replace(/-/g, ' '));
  switch (step.kind) {
    case 'kill': return `Slay ${target || 'the enemy'}`;
    case 'collect': return `Recover ${target}`;
    case 'reach': return `Travel to ${target}`;
    case 'talk': return `Speak with ${target}`;
    case 'deliver': return `Deliver to ${target}`;
    case 'clear': return `Clear ${target}`;
    case 'escort': return `Escort ${target}`;
    default: return target || titleCase(String(step.kind || 'Objective'));
  }
}

// ===========================================================================
// 3. PARTY — the full character sheet
// ===========================================================================

const SHEET_TABS = [
  { id: 'stats', label: 'Stats', icon: 'd20' },
  { id: 'features', label: 'Feats', icon: 'star' },
  { id: 'gear', label: 'Gear', icon: 'armor' },
  { id: 'effects', label: 'Effects', icon: 'flame' },
  { id: 'attacks', label: 'Attacks', icon: 'sword' },
  { id: 'roster', label: 'Roster', icon: 'quest' },
];

const CONTENT_Y = 46;
const CONTENT_H = CONTENT_BOTTOM - CONTENT_Y;   // 46 .. 210

/**
 * Equip `inst` onto `ch` and push whatever the swap knocked loose back into the
 * shared pack. rules/character.js returns displaced gear to the character's own
 * inventory, which would quietly hide it from the Inventory screen; the company
 * keeps one bag, so it goes back in the bag.
 * `fromPack` means the instance is not in ch.inventory yet.
 */
function equipInstance(ch, inst, slot, { fromPack = false } = {}) {
  if (!ch || !inst) return false;
  ch.inventory = arr(ch.inventory);
  if (fromPack) ch.inventory.push(inst);
  const before = new Set(ch.inventory.map((e) => e && e.uid));
  const ok = safe(() => equip(ch, inst, slot), false);
  if (!ok) {
    if (fromPack) ch.inventory = ch.inventory.filter((e) => e !== inst);
    return false;
  }
  const displaced = ch.inventory.filter((e) => e && !before.has(e.uid));
  if (displaced.length) {
    ch.inventory = ch.inventory.filter((e) => displaced.indexOf(e) < 0);
    for (const d of displaced) safe(() => Party.addItem(d.id, num(d.qty, 1)));
  }
  safe(() => recalc(ch));
  return true;
}

/** A throwaway clone with `inst` in `slot`, recalculated — the source of the deltas. */
function previewEquip(ch, inst, slot) {
  const c = safe(() => cloneChar(ch), null);
  if (!c) return null;
  if (inst) {
    const copy = { ...inst, uid: `${inst.uid || 'x'}-p` };
    c.inventory = arr(c.inventory).concat([copy]);
    if (!safe(() => equip(c, copy, slot), false)) return null;
  } else if (!safe(() => unequip(c, slot), null)) {
    return null;
  }
  safe(() => recalc(c));
  return c;
}

/** Average damage of the best attack a character has, for the equip comparison. */
function bestDamage(ch) {
  const list = safe(() => weaponsOf(ch), []) || [];
  let best = 0;
  for (const w of list) {
    if (!w || !w.damage) continue;
    const dice = w.damage.dice || w.damage.die || '';
    const avg = num(safe(() => avgExpr(dice), 0), 0) + num(w.damage.mod, 0);
    if (avg > best) best = avg;
  }
  return Math.round(best * 10) / 10;
}

function deltaChip(ctx, x, y, label, before, after) {
  const d = Math.round((after - before) * 10) / 10;
  const col = d > 0 ? C.good : d < 0 ? C.bad : C.inkDim;
  const text = `${label} ${d === 0 ? '—' : signed(d)}`;
  return safe(() => UI.chip(ctx, x, y, text, { color: col }), 0) || 0;
}

export class PartyScene extends MenuScene {
  constructor(opts = {}) {
    super('party');
    this.opts = opts || {};
    this.member = clamp(num(opts.member, 0), 0, Math.max(0, Party.members.length - 1));
    this.section = Math.max(0, SHEET_TABS.findIndex((s) => s.id === opts.section));
    if (this.section < 0) this.section = 0;

    this.cursor = [0, 0, 0, 0, 0, 0];   // per-section list cursor
    this.top = [0, 0, 0, 0, 0, 0];      // per-section list scroll
    this.scroll = 0;                    // detail-pane text scroll
    this.pack = null;                   // { slot, list, index, top } equip overlay
    this.grab = -1;                     // marching-order drag index
    this.col = 0;                       // roster column: 0 active, 1 reserve
    this.tabRects = [];
    this.rowRects = [];
  }

  get ch() { return Party.members[this.member] || Party.members[0] || null; }
  get sectionId() { return SHEET_TABS[this.section].id; }

  update(dt) {
    if (this.tick(dt)) return;
    const ch = this.ch;
    if (!ch) { if (Input.consume('cancel') || Input.consume('party')) this.close(); return; }

    if (this.pack) { this._updatePack(ch); return; }

    // Section paging is global; number keys jump straight to a section.
    const before = this.section;
    this.section = navPage(this.section, SHEET_TABS.length);
    const tp = tabPressed(5);
    if (tp >= 0 && tp < SHEET_TABS.length) this.section = tp;
    if (this.section !== before) { this.scroll = 0; this.grab = -1; }

    // Member switching with left/right, except in Roster where the columns need them.
    if (this.sectionId !== 'roster' && !this.pack) {
      const m0 = this.member;
      this.member = navH(this.member, Math.max(1, Party.members.length));
      if (this.member !== m0) { this.scroll = 0; this.cursor = [0, 0, 0, 0, 0, 0]; this.top = [0, 0, 0, 0, 0, 0]; }
    }

    // Member tabs are clickable.
    const m = Input.mouse;
    for (let i = 0; i < this.tabRects.length; i++) {
      const r = this.tabRects[i];
      if (clicked(m, r.x, r.y, r.w, r.h)) {
        if (r.kind === 'member') { this.member = r.i; this.scroll = 0; }
        else { this.section = r.i; this.scroll = 0; }
        sfx('cursor');
        return;
      }
    }

    switch (this.sectionId) {
      case 'stats': this._updateStats(ch); break;
      case 'features': this._updateList(ch, this._featureList(ch).length); break;
      case 'gear': this._updateGear(ch); break;
      case 'effects': this._updateList(ch, this._effectList(ch).length); break;
      case 'attacks': this._updateList(ch, this._attackList(ch).length); break;
      case 'roster': this._updateRoster(); break;
      default: break;
    }

    if (Input.consume('cancel') || Input.consume('party')) this.close();
  }

  // --- per-section input --------------------------------------------------

  _updateStats() {
    this.scroll = 0;
    const m = Input.mouse;
    if (wheelOver(m, 0, CONTENT_Y, VIEW_W, CONTENT_H)) sfx('cursor');
  }

  _updateList(ch, len) {
    const s = this.section;
    if (listNavActive()) {
      const before = this.cursor[s];
      this.cursor[s] = navV(this.cursor[s], len);
      if (this.cursor[s] !== before) this.scroll = 0;
    }
    this.scroll = scrollPane(this.scroll, this._maxScroll, Input.mouse, this._paneRect);
    const m = Input.mouse;
    for (const r of this.rowRects) {
      if (clicked(m, r.x, r.y, r.w, r.h)) { this.cursor[s] = r.i; this.scroll = 0; sfx('cursor'); }
    }
  }

  _updateGear(ch) {
    const s = this.section;
    const len = EQUIP_SLOTS.length;
    if (listNavActive()) this.cursor[s] = navV(this.cursor[s], len);
    this.scroll = scrollPane(this.scroll, this._maxScroll, Input.mouse, this._paneRect);
    const m = Input.mouse;
    for (const r of this.rowRects) {
      if (hit(m, r.x, r.y, r.w, r.h)) {
        if (this.cursor[s] !== r.i) { this.cursor[s] = r.i; sfx('cursor'); }
        if (clicked(m, r.x, r.y, r.w, r.h)) { this._openPack(ch); return; }
      }
    }
    if (Input.consume('confirm')) { this._openPack(ch); return; }
    if (Input.consume('interact')) this._unequipSlot(ch);
  }

  _updateRoster() {
    const active = Party.members;
    const reserve = arr(Party.reserve);
    const s = this.section;
    if (Input.repeatConsume('left') && this.col === 1) { this.col = 0; sfx('cursor'); }
    if (Input.repeatConsume('right') && this.col === 0 && reserve.length) { this.col = 1; sfx('cursor'); }
    const len = this.col === 0 ? active.length : reserve.length;

    if (this.grab >= 0) {
      // Dragging a companion up and down the marching line.
      if (Input.repeatConsume('up') && this.grab > 0) {
        safe(() => Party.swap(this.grab, this.grab - 1)); this.grab--; this.cursor[s] = this.grab; sfx('cursor');
      }
      if (Input.repeatConsume('down') && this.grab < active.length - 1) {
        safe(() => Party.swap(this.grab, this.grab + 1)); this.grab++; this.cursor[s] = this.grab; sfx('cursor');
      }
      if (Input.consume('confirm') || Input.consume('cancel')) { this.grab = -1; sfx('select'); }
      return;
    }

    if (listNavActive()) this.cursor[s] = navV(this.cursor[s], Math.max(1, len));
    const m = Input.mouse;
    for (const r of this.rowRects) {
      if (hit(m, r.x, r.y, r.w, r.h)) {
        if (this.col !== r.col || this.cursor[s] !== r.i) { this.col = r.col; this.cursor[s] = r.i; sfx('cursor'); }
        if (clicked(m, r.x, r.y, r.w, r.h)) { this._rosterMenu(); return; }
      }
    }
    if (Input.consume('interact')) { this._toggleAuto(); return; }
    if (Input.consume('confirm')) this._rosterMenu();
  }

  _toggleAuto() {
    const list = this.col === 0 ? Party.members : arr(Party.reserve);
    const ch = list[this.cursor[this.section]];
    if (!ch) { sfx('error'); return; }
    if (Party.members[0] && ch.uid === Party.members[0].uid) {
      this.say('You always give your own character their orders.', true);
      return;
    }
    Party.autoBattle[ch.uid] = !Party.autoBattle[ch.uid];
    sfx('select');
    this.say(`${ch.name} will ${Party.autoBattle[ch.uid] ? 'act on their own' : 'wait for your orders'} in battle.`);
  }

  _rosterMenu() {
    const s = this.section;
    const active = Party.members;
    const reserve = arr(Party.reserve);
    const i = this.cursor[s];
    if (this.col === 0) {
      const ch = active[i];
      if (!ch) { sfx('error'); return; }
      const isLeader = i === 0;
      const auto = !!Party.autoBattle[ch.uid];
      this.ask(ch.name, `Marching position ${i + 1} of ${active.length}.`, [
        { label: 'Move in the line', value: 'move', disabled: active.length < 2 },
        { label: auto ? 'Take manual control' : 'Let the AI fight them', value: 'auto', disabled: isLeader },
        { label: 'Send to the bench', value: 'bench', disabled: isLeader || active.length < 2 },
        { label: 'Back', value: null },
      ], (v) => {
        if (v === 'move') { this.grab = i; sfx('select'); }
        else if (v === 'auto') this._toggleAuto();
        else if (v === 'bench') {
          if (safe(() => Party.bench(ch.uid), false)) {
            sfx('select');
            this.cursor[s] = clamp(i, 0, Math.max(0, Party.members.length - 1));
            this.member = clamp(this.member, 0, Math.max(0, Party.members.length - 1));
            this.say(`${ch.name} waits at the inn.`);
          } else this.say('There is no room on the bench.', true);
        }
      });
    } else {
      const ch = reserve[i];
      if (!ch) { sfx('error'); return; }
      this.ask(ch.name, 'Bring them back into the marching line?', [
        { label: 'Bring them along', value: 'activate', disabled: active.length >= PARTY_MAX },
        { label: 'Back', value: null },
      ], (v) => {
        if (v !== 'activate') return;
        if (safe(() => Party.activate(ch.uid), false)) {
          sfx('select');
          this.say(`${ch.name} shoulders their pack.`);
          if (!arr(Party.reserve).length) this.col = 0;
          this.cursor[s] = 0;
        } else this.say('The party is already four strong.', true);
      });
    }
  }

  // --- equipment ----------------------------------------------------------

  _slotAt(i) { return EQUIP_SLOTS[clamp(i, 0, EQUIP_SLOTS.length - 1)]; }

  /** offHand shows a shield when one is strapped on. */
  _instFor(ch, slot) {
    let inst = safe(() => equipped(ch, slot), null);
    if (!inst && slot === 'offHand') inst = safe(() => equipped(ch, 'shield'), null);
    return inst;
  }

  _openPack(ch) {
    const slot = this._slotAt(this.cursor[this.section]);
    const list = [];
    for (const e of arr(ch.inventory)) {
      const d = safe(() => itemDef(e), null) || safe(() => resolveItem(e.id), null);
      if (!d) continue;
      if (!slotAccepts(slot, d)) continue;
      list.push({ src: 'own', entry: e, id: e.id, def: d });
    }
    for (const e of arr(Party.inventory)) {
      const d = safe(() => resolveItem(e.id), null);
      if (!d) continue;
      if (!slotAccepts(slot, d)) continue;
      list.push({ src: 'pack', entry: e, id: e.id, def: d, qty: num(e.qty, 1) });
    }
    if (!list.length) { this.say(`Nothing in the pack fits the ${SLOT_NAMES[slot] || slot} slot.`, true); return; }
    if (this._instFor(ch, slot)) list.unshift({ src: 'none', id: null, def: null });
    this.pack = { slot, list, index: 0, top: 0 };
    sfx('open');
  }

  _updatePack(ch) {
    const p = this.pack;
    p.index = navV(p.index, p.list.length);
    const m = Input.mouse;
    for (const r of arr(p.rects)) {
      if (hit(m, r.x, r.y, r.w, r.h)) {
        if (p.index !== r.i) { p.index = r.i; sfx('cursor'); }
        if (clicked(m, r.x, r.y, r.w, r.h)) { this._commitPack(ch); return; }
      }
    }
    if (Input.consume('confirm')) { this._commitPack(ch); return; }
    if (Input.consume('cancel')) { sfx('back'); this.pack = null; }
  }

  _commitPack(ch) {
    const p = this.pack;
    const pick = p.list[p.index];
    const slot = p.slot;
    this.pack = null;
    if (!pick) return;
    if (pick.src === 'none') { this._unequipSlot(ch); return; }

    if (pick.src === 'own') {
      if (equipInstance(ch, pick.entry, slot)) {
        sfx('item');
        this.say(`${ch.name} equips ${itemName(pick.id, pick.def)}.`);
      } else this.say('That will not go on.', true);
      return;
    }
    // From the shared pack: mint an instance, equip it, then take it out of the bag.
    const inst = safe(() => makeItemInstance(pick.id), null) || { uid: `t${this.t}`, id: pick.id, qty: 1 };
    if (equipInstance(ch, inst, slot, { fromPack: true })) {
      safe(() => Party.removeByUid(pick.entry.uid, 1));
      sfx('item');
      this.say(`${ch.name} equips ${itemName(pick.id, pick.def)}.`);
    } else {
      this.say('That will not go on.', true);
    }
  }

  _unequipSlot(ch) {
    const slot = this._slotAt(this.cursor[this.section]);
    const inst = this._instFor(ch, slot);
    if (!inst) { sfx('error'); return; }
    const real = safe(() => equipped(ch, slot), null) ? slot : 'shield';
    const out = safe(() => unequip(ch, real), null);
    if (!out) { this.say('It will not come off.', true); return; }
    // Push it back into the shared pack so everyone can reach it.
    safe(() => {
      ch.inventory = arr(ch.inventory).filter((e) => e !== out && e.uid !== out.uid);
      Party.addItem(out.id, num(out.qty, 1));
      recalc(ch);
    });
    sfx('close');
    this.say(`${itemName(out.id, safe(() => resolveItem(out.id), null))} goes back in the pack.`);
  }

  // --- content builders ---------------------------------------------------

  _featureList(ch) {
    const list = safe(() => allFeatures(ch), []) || [];
    return list.filter(Boolean).sort((a, b) => (a.level || 1) - (b.level || 1) || String(a.name).localeCompare(String(b.name)));
  }

  _effectList(ch) {
    const out = [];
    for (const c of safe(() => activeConditions(ch), []) || []) {
      const def = CONDITIONS[String(c.id).toLowerCase()] || null;
      out.push({
        kind: 'condition', id: c.id, level: num(c.level, 0),
        name: (def && def.name) || titleCase(String(c.id)) + (c.level ? ` ${c.level}` : ''),
        color: (def && def.color) || C.bad,
        icon: (def && def.icon) || 'skull',
        dur: c.dur, source: c.source || '',
        desc: safe(() => conditionText(c.id, c.level || 0), '') || (def && def.desc) || '',
      });
    }
    for (const e of arr(ch && ch.effects)) {
      out.push({
        kind: 'effect', id: e.id, name: e.name || e.id, color: e.concentration ? C.purple : C.good,
        icon: e.concentration ? 'mana' : 'star',
        dur: e.dur, source: e.source || '', conc: !!e.concentration,
        desc: e.desc || mechSummary(e.mech) || 'An ongoing magical effect.',
      });
    }
    return out;
  }

  _attackList(ch) {
    const out = [];
    for (const w of safe(() => weaponsOf(ch), []) || []) {
      if (!w) continue;
      const d = w.damage || {};
      const dice = d.dice || d.die || '—';
      const mod = num(d.mod, 0);
      out.push({
        kind: 'weapon',
        name: w.name || 'Attack',
        hit: signed(num(w.attackBonus, 0)),
        line: `${dice}${mod ? signed(mod) : ''} ${d.type || ''}`.trim(),
        range: w.ranged ? rangeLabel(w.range) : `reach ${num(w.range, 5) || 5} ft.`,
        cost: w.cost || 'action',
        props: arr(w.props),
        mastery: w.mastery || null,
        enabled: w.enabled !== false,
        reason: w.reason || '',
        item: w.item || null,
        bonusDice: arr(d.bonusDice),
      });
    }
    // Attack and save spells the character can actually cast right now.
    const known = spellIdsFor(ch);
    const atk = num(safe(() => spellAtk(ch), 0), 0);
    const dc = num(safe(() => spellDC(ch), 0), 0);
    for (const id of known) {
      const sp = SPELLS[id];
      if (!sp) continue;
      if (!sp.attack && !(sp.save && sp.damage)) continue;
      const dice = safe(() => spellDamageDice(sp, sp.level, num(ch.level, 1)), null) || (sp.damage && sp.damage.dice) || '';
      out.push({
        kind: 'spell',
        name: sp.name,
        hit: sp.attack ? signed(atk) : `DC ${dc}`,
        line: dice ? `${dice} ${(sp.damage && sp.damage.type) || ''}`.trim() : (sp.heal ? `heals ${sp.heal.dice}` : '—'),
        range: rangeText(sp),
        cost: sp.castTime || 'action',
        props: [sp.attack ? `${sp.attack} spell attack` : `${ABILITY_NAMES[sp.save.ability] || sp.save.ability} save`],
        spell: sp,
        enabled: true,
        reason: '',
      });
    }
    return out;
  }

  // --- drawing ------------------------------------------------------------

  draw(ctx) {
    ctx.fillStyle = C.bgDeep;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.tabRects = [];
    this.rowRects = [];

    const ch = this.ch;
    this._drawMemberTabs(ctx);
    const tabs = SHEET_TABS.map((s) => ({ label: s.label, icon: s.icon }));
    UI.tabs(ctx, 2, 32, VIEW_W - 4, tabs, this.section, {});
    const tw = Math.floor((VIEW_W - 4) / SHEET_TABS.length);
    for (let i = 0; i < SHEET_TABS.length; i++) {
      this.tabRects.push({ x: 2 + i * tw, y: 32, w: tw, h: 13, i, kind: 'section' });
    }

    if (!ch) {
      UI.panel(ctx, 8, CONTENT_Y, VIEW_W - 16, CONTENT_H, { style: 'window' });
      txtC(ctx, VIEW_W / 2, CONTENT_Y + 70, 'There is no one in the company.', { size: 'md', color: C.inkDim });
      hintBar(ctx, HINT_Y, [[keyFor('cancel'), 'Back']]);
      return;
    }

    switch (this.sectionId) {
      case 'stats': this._drawStats(ctx, ch); break;
      case 'features': this._drawFeatures(ctx, ch); break;
      case 'gear': this._drawGear(ctx, ch); break;
      case 'effects': this._drawEffects(ctx, ch); break;
      case 'attacks': this._drawAttacks(ctx, ch); break;
      case 'roster': this._drawRoster(ctx); break;
      default: break;
    }

    this.drawMessage(ctx, 6, MSG_Y, VIEW_W - 12);
    hintBar(ctx, HINT_Y, this._hints());
    if (this.pack) this._drawPack(ctx, ch);
    this.drawPrompt(ctx);
    this.drawFloats(ctx);
  }

  _hints() {
    const base = [[keyFor('cancel'), 'Back'], [`${keyFor('prev')}/${keyFor('next')}`, 'Page']];
    switch (this.sectionId) {
      case 'gear': return base.concat([[keyFor('confirm'), 'Equip'], [keyFor('interact'), 'Remove'], [`${keyFor('left')}${keyFor('right')}`, 'Member']]);
      case 'roster': return base.concat([[keyFor('confirm'), 'Options'], [keyFor('interact'), 'Auto AI'], [`${keyFor('left')}${keyFor('right')}`, 'Column']]);
      case 'features':
      case 'effects':
      case 'attacks': return base.concat([[keyFor('run'), 'Scroll'], [`${keyFor('left')}${keyFor('right')}`, 'Member']]);
      default: return base.concat([[`${keyFor('left')}${keyFor('right')}`, 'Member'], ['1-5', 'Section']]);
    }
  }

  _drawMemberTabs(ctx) {
    const members = Party.members;
    const n = Math.max(1, members.length);
    const w = Math.floor((VIEW_W - 4) / n);
    for (let i = 0; i < n; i++) {
      const x = 2 + i * w;
      const cw = i === n - 1 ? VIEW_W - 2 - x : w;
      const sel = i === this.member;
      UI.panel(ctx, x, 2, cw - 1, 28, { style: sel ? 'gold' : 'dark', shadow: sel ? 0.4 : 0.15 });
      const ch = members[i];
      if (!ch) continue;
      safe(() => UI.portrait(ctx, ch, x + 3, 4, 24, { shadow: 0.2 }));
      const tx = x + 30, tw = cw - 34;
      txt(ctx, tx, 5, ch.name, {
        size: 'md', color: sel ? '#2a1c07' : C.ink, shadow: sel ? 'rgba(255,230,170,0.3)' : true, maxWidth: tw,
      });
      txt(ctx, tx, 14, `Lv ${num(ch.level, 1)} ${classText(ch)}`, {
        size: 'sm', color: sel ? '#4a3410' : C.inkDim, shadow: !sel, maxWidth: tw,
      });
      const hp = Math.max(0, num(ch.hp, 0)), max = Math.max(1, maxHpOf(ch));
      UI.bar(ctx, tx, 22, Math.min(tw, 70), 5, hp / max, {
        color: hpColor(ch), label: `${hp}/${max}`, size: 'sm', labelAlign: 'center',
      });
      this.tabRects.push({ x, y: 2, w: cw, h: 28, i, kind: 'member' });
    }
  }

  // --- STATS --------------------------------------------------------------

  _drawStats(ctx, ch) {
    const y = CONTENT_Y;
    // Left column: abilities and the combat block.
    const LX = 3, LW = 130;
    UI.panel(ctx, LX, y, LW, CONTENT_H, { style: 'window' });
    const ix = LX + 6, iw = LW - 12;
    let ty = sectionHead(ctx, ix, y + 5, iw, 'ABILITIES');
    txtR(ctx, ix + 62, ty, 'SCR', { size: 'sm', color: C.disabled });
    txtR(ctx, ix + 90, ty, 'MOD', { size: 'sm', color: C.disabled });
    txtR(ctx, ix + iw, ty, 'SAVE', { size: 'sm', color: C.disabled });
    ty += 8;
    for (let i = 0; i < ABILITIES.length; i++) {
      const ab = ABILITIES[i];
      const ry = ty + i * 10;
      const score = num(safe(() => abilityScore(ch, ab), 10), 10);
      const md = num(safe(() => abilityMod(ch, ab), 0), 0);
      const sv = num(safe(() => saveMod(ch, ab), 0), 0);
      const prof = arr(ch.saveProfs).indexOf(ab) >= 0;
      txt(ctx, ix, ry, ABILITY_ABBR[ab], { size: 'md', color: C.gold, shadow: true });
      txtR(ctx, ix + 62, ry, String(score), { size: 'sm', color: C.ink, shadow: true });
      txtR(ctx, ix + 90, ry, signed(md), { size: 'sm', color: md >= 0 ? C.ink : C.bad, shadow: true });
      txtR(ctx, ix + iw, ry, `${signed(sv)}${prof ? '●' : ''}`, {
        size: 'sm', color: prof ? C.goldBright : C.inkDim, shadow: true,
      });
    }
    ty += ABILITIES.length * 10 + 2;

    ty = sectionHead(ctx, ix, ty, iw, 'IN COMBAT');
    const hd = safe(() => hitDiceTotal(ch), null) || { max: 0, used: 0 };
    const senses = (ch.senses && num(ch.senses.darkvision, 0)) || 0;
    const rows = [
      ['Armour Class', String(acOf(ch))],
      ['Hit Points', `${Math.max(0, num(ch.hp, 0))} / ${maxHpOf(ch)}${num(ch.tempHp, 0) ? ` +${ch.tempHp}` : ''}`],
      ['Hit Dice', `${Math.max(0, num(hd.max, 0) - num(hd.used, 0))} / ${num(hd.max, 0)}`],
      ['Speed', `${speedOf(ch)} ft.`],
      ['Initiative', signed(initiativeMod(ch))],
      ['Proficiency', signed(num(safe(() => profBonus(ch), 2), 2))],
      ['Passive Perc.', String(num(safe(() => passivePerception(ch), 10), 10))],
      ['Darkvision', senses ? `${senses} ft.` : '—'],
    ];
    rows.forEach((r, i) => kv(ctx, ix, ty + i * 10, iw, r[0], r[1], { color: i === 0 ? C.goldBright : C.ink }));

    // Middle column: who they are and what they are trained in.
    const MX = 136, MW = 118;
    UI.panel(ctx, MX, y, MW, CONTENT_H, { style: 'window' });
    const mx = MX + 6, mw = MW - 12;
    let my = sectionHead(ctx, mx, y + 5, mw, 'ORIGIN');
    const lines = [
      speciesText(ch),
      classText(ch),
      subclassText(ch) || '—',
      titleCase(String(ch.backgroundId || 'wanderer').replace(/-/g, ' ')),
    ];
    for (const l of lines) { txt(ctx, mx, my, l, { size: 'sm', color: C.ink, shadow: true, maxWidth: mw }); my += 9; }

    const prog = safe(() => xpProgress(ch), null);
    const toNext = num(safe(() => xpToNext(ch), 0), 0);
    UI.bar(ctx, mx, my + 1, mw, 5, clampPct(prog), { color: C.xp });
    txt(ctx, mx, my + 8, `XP ${num(ch.xp, 0)}${toNext > 0 ? ` · ${toNext} to go` : ''}`, {
      size: 'sm', color: C.inkDim, shadow: true, maxWidth: mw,
    });
    my += 19;

    my = sectionHead(ctx, mx, my, mw, 'TRAINED IN');
    const profs = ch.profs || {};
    const pr = [
      ['Armour', arr(profs.armor).map(titleCase).join(', ') || '—'],
      ['Weapons', arr(profs.weapon).map(titleCase).join(', ') || '—'],
      ['Tools', arr(profs.tool).map((t) => titleCase(String(t).replace(/-/g, ' '))).join(', ') || '—'],
      ['Languages', arr(profs.language).map(titleCase).join(', ') || 'Common'],
    ];
    for (const [label, val] of pr) {
      txt(ctx, mx, my, label, { size: 'sm', color: C.goldDim, shadow: true, maxWidth: mw });
      const r = UI.textWrapped(ctx, mx, my + 8, mw, val, { size: 'sm', color: C.ink, maxLines: 2 });
      my += 8 + r.height + 2;
      if (my > y + CONTENT_H - 40) break;
    }

    if (my < y + CONTENT_H - 22) {
      my = sectionHead(ctx, mx, my, mw, 'DEFENCES');
      let cx = mx;
      const chips = []
        .concat(arr(ch.resist).map((r) => [r, C.blue]))
        .concat(arr(ch.immune).map((r) => [r, C.good]))
        .concat(arr(ch.vuln).map((r) => [r, C.bad]));
      if (!chips.length) txt(ctx, mx, my, 'Nothing special.', { size: 'sm', color: C.inkDim, shadow: true });
      for (const [label, col] of chips.slice(0, 6)) {
        const w = safe(() => UI.chip(ctx, cx, my, titleCase(String(label)), { color: col }), 0) || 0;
        cx += w + 2;
        if (cx > mx + mw - 24) { cx = mx; my += 10; }
      }
    }

    // Right column: all eighteen skills.
    const RX = 257, RW = VIEW_W - RX - 3;
    UI.panel(ctx, RX, y, RW, CONTENT_H, { style: 'window' });
    const rx = RX + 6, rw = RW - 12;
    let ry = sectionHead(ctx, rx, y + 5, rw, 'SKILLS');
    for (let i = 0; i < SKILL_IDS.length; i++) {
      const id = SKILL_IDS[i];
      const def = SKILLS[id];
      const info = safe(() => skillMod(ch, id), null) || { mod: 0, prof: 'none' };
      const yy = ry + i * 8;
      const mark = info.prof === 'expert' ? '★' : info.prof === 'prof' ? '●' : '○';
      const col = info.prof === 'expert' ? C.goldBright : info.prof === 'prof' ? C.gold : C.disabled;
      txt(ctx, rx, yy, mark, { size: 'sm', color: col, shadow: true });
      txt(ctx, rx + 8, yy, def.name, {
        size: 'sm', color: info.prof === 'none' ? C.inkDim : C.ink, shadow: true, maxWidth: rw - 44,
      });
      txtR(ctx, rx + rw - 16, yy, signed(num(info.mod, 0)), { size: 'sm', color: C.ink, shadow: true });
      txtR(ctx, rx + rw, yy, ABILITY_ABBR[def.ability], { size: 'sm', color: C.disabled, shadow: true });
    }
  }

  // --- FEATURES -----------------------------------------------------------

  _drawFeatures(ctx, ch) {
    const list = this._featureList(ch);
    const LX = 3, LW = 168;
    UI.panel(ctx, LX, CONTENT_Y, LW, CONTENT_H, { style: 'window' });
    const rowH = 11, rows = 14;
    const sel = clamp(this.cursor[this.section], 0, Math.max(0, list.length - 1));
    let top = this.top[this.section];
    if (sel < top) top = sel;
    if (sel > top + rows - 1) top = sel - rows + 1;
    top = clamp(top, 0, Math.max(0, list.length - rows));
    this.top[this.section] = top;

    if (!list.length) {
      txtC(ctx, LX + LW / 2, CONTENT_Y + 70, 'No features yet.', { size: 'sm', color: C.inkDim });
    }
    UI.pushClip(ctx, LX + 2, CONTENT_Y + 3, LW - 4, rowH * rows + 2);
    for (let i = 0; i < rows && top + i < list.length; i++) {
      const idx = top + i;
      const f = list[idx];
      const ry = CONTENT_Y + 5 + i * rowH;
      const on = idx === sel;
      if (on) UI.highlight(ctx, LX + 3, ry - 1, LW - 8, rowH, { alpha: 0.2 });
      txt(ctx, LX + 10, ry, f.name, {
        size: on ? 'md' : 'sm', color: on ? C.goldBright : C.ink, shadow: true, maxWidth: LW - 42,
      });
      txtR(ctx, LX + LW - 6, ry, sourceTag(f.source), { size: 'sm', color: C.disabled, shadow: true });
      if (on) UI.cursor(ctx, LX + 3, ry, this.t);
      this.rowRects.push({ x: LX + 3, y: ry - 1, w: LW - 8, h: rowH, i: idx });
    }
    UI.popClip(ctx);
    if (list.length > rows) scrollHint(ctx, LX + LW - 4, CONTENT_Y + 4, rowH * rows, top, rows, list.length);

    const DX = 175, DW = VIEW_W - DX - 3;
    UI.panel(ctx, DX, CONTENT_Y, DW, CONTENT_H, { style: 'window' });
    const f = list[sel];
    this._paneRect = { x: DX, y: CONTENT_Y, w: DW, h: CONTENT_H };
    if (!f) return;
    const dx = DX + 7, dw = DW - 14;
    txt(ctx, dx, CONTENT_Y + 5, f.name, { size: 'md', color: C.gold, shadow: true, maxWidth: dw });
    let cx = dx;
    cx += (safe(() => UI.chip(ctx, cx, CONTENT_Y + 16, sourceLabel(f.source), { color: C.blue }), 0) || 0) + 3;
    if (f.level) cx += (safe(() => UI.chip(ctx, cx, CONTENT_Y + 16, `Level ${f.level}`, { color: C.goldDim }), 0) || 0) + 3;
    if (f.uses && f.uses.max) safe(() => UI.chip(ctx, cx, CONTENT_Y + 16, `${f.uses.max} / ${f.uses.recharge || 'long'} rest`, { color: C.green }));

    const body = [f.desc || 'No further rules text.', mechSummary(f.mech)].filter(Boolean).join('\n\n');
    this._drawScrollBody(ctx, dx, CONTENT_Y + 29, dw, CONTENT_H - 34, body);
  }

  // --- GEAR ---------------------------------------------------------------

  _drawGear(ctx, ch) {
    const LX = 3, LW = 190;
    UI.panel(ctx, LX, CONTENT_Y, LW, CONTENT_H, { style: 'window' });
    const ix = LX + 6, iw = LW - 12;
    let ty = sectionHead(ctx, ix, CONTENT_Y + 5, iw, 'EQUIPPED');
    const sel = clamp(this.cursor[this.section], 0, EQUIP_SLOTS.length - 1);
    const rowH = 13;
    for (let i = 0; i < EQUIP_SLOTS.length; i++) {
      const slot = EQUIP_SLOTS[i];
      const ry = ty + i * rowH;
      const on = i === sel;
      if (on) UI.highlight(ctx, ix - 3, ry - 1, iw + 6, rowH - 1, { alpha: 0.2 });
      txt(ctx, ix + 5, ry + 1, SLOT_NAMES[slot] || titleCase(slot), {
        size: 'sm', color: on ? C.goldBright : C.inkDim, shadow: true, maxWidth: 46,
      });
      const inst = this._instFor(ch, slot);
      const d = inst ? (safe(() => itemDef(inst), null) || safe(() => resolveItem(inst.id), null)) : null;
      if (d) {
        UI.icon(ctx, itemIcon(d), ix + 54, ry, 9, null);
        txt(ctx, ix + 66, ry + 1, d.name, {
          size: 'sm', color: itemColor(inst.id, d), shadow: true, maxWidth: iw - 72,
        });
        const stat = d.kind === 'weapon' ? safe(() => weaponLine(d), '') : safe(() => armorLine(d), '');
        if (stat) txtR(ctx, ix + iw, ry + 1, stat, { size: 'sm', color: C.disabled, shadow: true, maxWidth: 60 });
      } else {
        txt(ctx, ix + 54, ry + 1, '— empty —', { size: 'sm', color: C.disabled, shadow: true });
      }
      if (on) UI.cursor(ctx, ix - 3, ry + 1, this.t);
      this.rowRects.push({ x: ix - 3, y: ry - 1, w: iw + 6, h: rowH, i });
    }

    const DX = 197, DW = VIEW_W - DX - 3;
    UI.panel(ctx, DX, CONTENT_Y, DW, CONTENT_H, { style: 'window' });
    this._paneRect = { x: DX, y: CONTENT_Y, w: DW, h: CONTENT_H };
    const slot = EQUIP_SLOTS[sel];
    const inst = this._instFor(ch, slot);
    const d = inst ? (safe(() => itemDef(inst), null) || safe(() => resolveItem(inst.id), null)) : null;
    const dx = DX + 7, dw = DW - 14;
    txt(ctx, dx, CONTENT_Y + 5, SLOT_NAMES[slot] || titleCase(slot), { size: 'sm', color: C.goldDim, shadow: true });
    if (!d) {
      txt(ctx, dx, CONTENT_Y + 17, 'Nothing equipped here.', { size: 'md', color: C.inkDim, shadow: true, maxWidth: dw });
      txt(ctx, dx, CONTENT_Y + 30, `Press ${keyFor('confirm')} to fit something from the pack.`, {
        size: 'sm', color: C.disabled, shadow: true, maxWidth: dw,
      });
      return;
    }
    txt(ctx, dx, CONTENT_Y + 16, d.name, { size: 'md', color: itemColor(inst.id, d), shadow: true, maxWidth: dw });
    txt(ctx, dx, CONTENT_Y + 27, `${titleCase(String(d.kind || ''))} · ${rarityName(d)} · ${num(d.weight, 0)} lb`, {
      size: 'sm', color: C.inkDim, shadow: true, maxWidth: dw,
    });
    const stat = d.kind === 'weapon' ? safe(() => weaponLine(d), '') : safe(() => armorLine(d), '');
    if (stat) txt(ctx, dx, CONTENT_Y + 36, stat, { size: 'sm', color: C.goldBright, shadow: true, maxWidth: dw });
    if (d.mastery) {
      const mi = safe(() => masteryInfo(d.mastery), null);
      if (mi && mi.name) txt(ctx, dx, CONTENT_Y + 45, `Mastery: ${mi.name} — ${mi.desc || ''}`, {
        size: 'sm', color: C.purple, shadow: true, maxWidth: dw,
      });
    }
    const body = [d.desc || '', mechSummary(d.mech)].filter(Boolean).join('\n\n');
    this._drawScrollBody(ctx, dx, CONTENT_Y + 56, dw, CONTENT_H - 62, body);
  }

  /** The equip chooser, drawn over the detail pane with live AC/damage deltas. */
  _drawPack(ctx, ch) {
    const p = this.pack;
    UI.scrim(ctx, 0.45);
    const w = 250, rows = Math.min(8, p.list.length);
    const h = 34 + rows * 12 + 26;
    const x = R((VIEW_W - w) / 2), y = clamp(R((VIEW_H - h) / 2), 8, VIEW_H - h - 6);
    UI.window(ctx, x, y, w, h, SLOT_NAMES[p.slot] || titleCase(p.slot), { style: 'window' });

    let top = num(p.top, 0);
    if (p.index < top) top = p.index;
    if (p.index > top + rows - 1) top = p.index - rows + 1;
    p.top = clamp(top, 0, Math.max(0, p.list.length - rows));
    p.rects = [];

    for (let i = 0; i < rows && p.top + i < p.list.length; i++) {
      const idx = p.top + i;
      const e = p.list[idx];
      const ry = y + 8 + i * 12;
      const on = idx === p.index;
      if (on) UI.highlight(ctx, x + 5, ry - 1, w - 10, 12, { alpha: 0.22 });
      if (e.src === 'none') {
        txt(ctx, x + 14, ry + 1, 'Take it off', { size: on ? 'md' : 'sm', color: on ? C.goldBright : C.inkDim, shadow: true });
      } else {
        UI.icon(ctx, itemIcon(e.def), x + 12, ry, 9, null);
        txt(ctx, x + 24, ry + 1, itemName(e.id, e.def), {
          size: on ? 'md' : 'sm', color: itemColor(e.id, e.def), shadow: true, maxWidth: w - 96,
        });
        const tag = e.src === 'pack' ? `pack${e.qty > 1 ? ` x${e.qty}` : ''}` : 'carried';
        txtR(ctx, x + w - 8, ry + 1, tag, { size: 'sm', color: C.disabled, shadow: true });
      }
      if (on) UI.cursor(ctx, x + 5, ry + 1, this.t);
      p.rects.push({ x: x + 5, y: ry - 1, w: w - 10, h: 12, i: idx });
    }

    // The deltas: computed by really equipping it onto a clone and recalculating.
    // Cached per (member, slot, choice) so we clone once, not once per frame.
    const pick = p.list[p.index];
    const dy = y + 10 + rows * 12;
    UI.divider(ctx, x + 8, dy, w - 16);
    const key = `${ch.uid}|${p.slot}|${p.index}|${arr(ch.inventory).length}`;
    if (!this._preview || this._preview.key !== key) {
      this._preview = {
        key,
        ch: pick ? previewEquip(ch, pick.src === 'none' ? null : instFor(pick), p.slot) : null,
      };
    }
    const after = this._preview.ch;
    if (!after) {
      txt(ctx, x + 10, dy + 5, 'No change to show.', { size: 'sm', color: C.disabled, shadow: true });
    } else {
      let cx = x + 10;
      cx += deltaChip(ctx, cx, dy + 4, 'AC', acOf(ch), acOf(after)) + 3;
      cx += deltaChip(ctx, cx, dy + 4, 'HP', maxHpOf(ch), maxHpOf(after)) + 3;
      cx += deltaChip(ctx, cx, dy + 4, 'DMG', bestDamage(ch), bestDamage(after)) + 3;
      cx += deltaChip(ctx, cx, dy + 4, 'SPD', speedOf(ch), speedOf(after)) + 3;
      deltaChip(ctx, cx, dy + 4, 'INI', initiativeMod(ch), initiativeMod(after));
    }
    txtC(ctx, x + w / 2, dy + 15, `${keyFor('confirm')} fit  ·  ${keyFor('cancel')} back`, {
      size: 'sm', color: C.disabled, shadow: true,
    });
  }

  // --- EFFECTS ------------------------------------------------------------

  _drawEffects(ctx, ch) {
    const list = this._effectList(ch);
    const LX = 3, LW = 168;
    UI.panel(ctx, LX, CONTENT_Y, LW, CONTENT_H, { style: 'window' });
    const ix = LX + 6, iw = LW - 12;
    const conc = safe(() => isConcentrating(ch), false);
    const concName = conc && ch.concentration ? (SPELLS[ch.concentration.spellId] || {}).name : null;
    txt(ctx, ix, CONTENT_Y + 5, conc ? `Concentrating: ${concName || 'a spell'}` : 'Not concentrating', {
      size: 'sm', color: conc ? C.purple : C.disabled, shadow: true, maxWidth: iw,
    });
    const ex = num(safe(() => exhaustionLevel(ch), 0), 0);
    if (ex > 0) txt(ctx, ix, CONTENT_Y + 14, `Exhaustion ${ex} — ${ex * 2} penalty to d20 tests`, {
      size: 'sm', color: C.bad, shadow: true, maxWidth: iw,
    });

    let ty = sectionHead(ctx, ix, CONTENT_Y + 24, iw, 'ACTIVE');
    const sel = clamp(this.cursor[this.section], 0, Math.max(0, list.length - 1));
    const rowH = 12, rows = 11;
    let top = this.top[this.section];
    if (sel < top) top = sel;
    if (sel > top + rows - 1) top = sel - rows + 1;
    this.top[this.section] = top = clamp(top, 0, Math.max(0, list.length - rows));

    if (!list.length) txt(ctx, ix, ty + 4, 'Hale and clear-headed.', { size: 'sm', color: C.inkDim, shadow: true });
    for (let i = 0; i < rows && top + i < list.length; i++) {
      const idx = top + i;
      const e = list[idx];
      const ry = ty + i * rowH;
      const on = idx === sel;
      if (on) UI.highlight(ctx, ix - 3, ry - 1, iw + 6, rowH, { alpha: 0.2 });
      UI.icon(ctx, e.icon, ix + 6, ry, 9, e.color);
      txt(ctx, ix + 18, ry + 1, e.name, {
        size: on ? 'md' : 'sm', color: on ? C.goldBright : e.color, shadow: true, maxWidth: iw - 52,
      });
      txtR(ctx, ix + iw, ry + 1, durText(e.dur), { size: 'sm', color: C.disabled, shadow: true });
      if (on) UI.cursor(ctx, ix - 3, ry + 1, this.t);
      this.rowRects.push({ x: ix - 3, y: ry - 1, w: iw + 6, h: rowH, i: idx });
    }

    const DX = 175, DW = VIEW_W - DX - 3;
    UI.panel(ctx, DX, CONTENT_Y, DW, CONTENT_H, { style: 'window' });
    this._paneRect = { x: DX, y: CONTENT_Y, w: DW, h: CONTENT_H };
    const e = list[sel];
    const dx = DX + 7, dw = DW - 14;
    if (!e) {
      txtC(ctx, DX + DW / 2, CONTENT_Y + 76, 'Nothing to explain.', { size: 'sm', color: C.disabled });
      return;
    }
    txt(ctx, dx, CONTENT_Y + 5, e.name, { size: 'md', color: e.color, shadow: true, maxWidth: dw });
    let cx = dx;
    cx += (safe(() => UI.chip(ctx, cx, CONTENT_Y + 16, e.kind === 'condition' ? 'Condition' : 'Effect', { color: C.blue }), 0) || 0) + 3;
    cx += (safe(() => UI.chip(ctx, cx, CONTENT_Y + 16, durText(e.dur, true), { color: C.goldDim }), 0) || 0) + 3;
    if (e.conc) cx += (safe(() => UI.chip(ctx, cx, CONTENT_Y + 16, 'Concentration', { color: C.purple }), 0) || 0) + 3;
    if (e.source) safe(() => UI.chip(ctx, cx, CONTENT_Y + 16, `from ${String(e.source).slice(0, 14)}`, { color: C.inkDim }));
    this._drawScrollBody(ctx, dx, CONTENT_Y + 29, dw, CONTENT_H - 34, e.desc || '');
  }

  // --- ATTACKS ------------------------------------------------------------

  _drawAttacks(ctx, ch) {
    const list = this._attackList(ch);
    const LX = 3, LW = 214;
    UI.panel(ctx, LX, CONTENT_Y, LW, CONTENT_H, { style: 'window' });
    const ix = LX + 6, iw = LW - 12;
    let ty = sectionHead(ctx, ix, CONTENT_Y + 5, iw, 'ATTACK OPTIONS');
    txtR(ctx, ix + 128, ty, 'HIT', { size: 'sm', color: C.disabled });
    txtR(ctx, ix + iw, ty, 'DAMAGE', { size: 'sm', color: C.disabled });
    ty += 8;

    const sel = clamp(this.cursor[this.section], 0, Math.max(0, list.length - 1));
    const rowH = 12, rows = 11;
    let top = this.top[this.section];
    if (sel < top) top = sel;
    if (sel > top + rows - 1) top = sel - rows + 1;
    this.top[this.section] = top = clamp(top, 0, Math.max(0, list.length - rows));

    if (!list.length) txt(ctx, ix, ty + 4, 'Nothing but bare fists.', { size: 'sm', color: C.inkDim, shadow: true });
    for (let i = 0; i < rows && top + i < list.length; i++) {
      const idx = top + i;
      const a = list[idx];
      const ry = ty + i * rowH;
      const on = idx === sel;
      if (on) UI.highlight(ctx, ix - 3, ry - 1, iw + 6, rowH, { alpha: 0.2 });
      UI.icon(ctx, a.kind === 'spell' ? 'mana' : 'sword', ix + 5, ry, 9, a.enabled ? null : C.disabled);
      txt(ctx, ix + 17, ry + 1, a.name, {
        size: on ? 'md' : 'sm', color: a.enabled ? (on ? C.goldBright : C.ink) : C.disabled, shadow: true, maxWidth: 104,
      });
      txtR(ctx, ix + 128, ry + 1, a.hit, { size: 'sm', color: a.enabled ? C.gold : C.disabled, shadow: true });
      txtR(ctx, ix + iw, ry + 1, a.line, { size: 'sm', color: a.enabled ? C.ink : C.disabled, shadow: true, maxWidth: 74 });
      if (on) UI.cursor(ctx, ix - 3, ry + 1, this.t);
      this.rowRects.push({ x: ix - 3, y: ry - 1, w: iw + 6, h: rowH, i: idx });
    }

    const DX = 221, DW = VIEW_W - DX - 3;
    UI.panel(ctx, DX, CONTENT_Y, DW, CONTENT_H, { style: 'window' });
    this._paneRect = { x: DX, y: CONTENT_Y, w: DW, h: CONTENT_H };
    const a = list[sel];
    const dx = DX + 7, dw = DW - 14;
    if (!a) return;
    txt(ctx, dx, CONTENT_Y + 5, a.name, { size: 'md', color: C.gold, shadow: true, maxWidth: dw });
    const rows2 = [
      ['To hit', a.hit],
      ['Damage', a.line],
      ['Range', a.range],
      ['Costs', titleCase(String(a.cost))],
    ];
    rows2.forEach((r, i) => kv(ctx, dx, CONTENT_Y + 17 + i * 10, dw, r[0], r[1]));
    let by = CONTENT_Y + 60;
    if (a.mastery) {
      const mi = safe(() => masteryInfo(a.mastery), null);
      txt(ctx, dx, by, `Mastery: ${(mi && mi.name) || titleCase(a.mastery)}`, { size: 'sm', color: C.purple, shadow: true, maxWidth: dw });
      by += 9;
      if (mi && mi.desc) { const r = UI.textWrapped(ctx, dx, by, dw, mi.desc, { size: 'sm', color: C.ink, maxLines: 3 }); by += r.height + 2; }
    }
    if (arr(a.props).length) {
      let cx = dx;
      for (const p of arr(a.props).slice(0, 5)) {
        const w = safe(() => UI.chip(ctx, cx, by, titleCase(String(p)), { color: C.blue }), 0) || 0;
        cx += w + 2;
        if (cx > dx + dw - 26) { cx = dx; by += 10; }
      }
      by += 12;
    }
    if (!a.enabled && a.reason) txt(ctx, dx, by, a.reason, { size: 'sm', color: C.bad, shadow: true, maxWidth: dw });
    else if (a.spell) this._drawScrollBody(ctx, dx, by, dw, CONTENT_Y + CONTENT_H - by - 4, a.spell.desc || '');
    else if (a.item && a.item.desc) this._drawScrollBody(ctx, dx, by, dw, CONTENT_Y + CONTENT_H - by - 4, a.item.desc);
  }

  // --- ROSTER -------------------------------------------------------------

  _drawRoster(ctx) {
    const active = Party.members;
    const reserve = arr(Party.reserve);
    const LX = 3, LW = 194;
    UI.panel(ctx, LX, CONTENT_Y, LW, CONTENT_H, { style: 'window' });
    let ty = sectionHead(ctx, LX + 6, CONTENT_Y + 5, LW - 12, 'MARCHING ORDER', this.col === 0 ? C.gold : C.goldDim);
    active.forEach((ch, i) => {
      const ry = ty + i * 30;
      const on = this.col === 0 && this.cursor[this.section] === i;
      const grabbed = this.grab === i;
      if (on) UI.highlight(ctx, LX + 4, ry - 1, LW - 8, 28, { alpha: grabbed ? 0.34 : 0.2 });
      txt(ctx, LX + 7, ry + 9, String(i + 1), { size: 'md', color: grabbed ? C.goldBright : C.goldDim, shadow: true });
      drawMemberCell(ctx, ch, LX + 14, ry, LW - 22, 28, { selected: on });
      if (Party.autoBattle[ch.uid]) safe(() => UI.chip(ctx, LX + LW - 26, ry + 1, 'AI', { color: C.cyan }));
      if (grabbed) txtR(ctx, LX + LW - 6, ry + 18, '↕ moving', { size: 'sm', color: C.goldBright, shadow: true });
      if (on) UI.cursor(ctx, LX + 4, ry + 9, this.t);
      this.rowRects.push({ x: LX + 4, y: ry - 1, w: LW - 8, h: 28, i, col: 0 });
    });
    txtC(ctx, LX + LW / 2, CONTENT_Y + CONTENT_H - 12, 'First in line leads the way.', {
      size: 'sm', color: C.disabled, maxWidth: LW - 10,
    });

    const RX = 201, RW = VIEW_W - RX - 3;
    UI.panel(ctx, RX, CONTENT_Y, RW, CONTENT_H, { style: 'window' });
    ty = sectionHead(ctx, RX + 6, CONTENT_Y + 5, RW - 12, 'AT THE STONEHILL INN', this.col === 1 ? C.gold : C.goldDim);
    if (!reserve.length) {
      txt(ctx, RX + 8, ty + 4, 'No one is waiting on the bench.', { size: 'sm', color: C.inkDim, shadow: true, maxWidth: RW - 16 });
    }
    reserve.slice(0, 5).forEach((ch, i) => {
      const ry = ty + i * 30;
      const on = this.col === 1 && this.cursor[this.section] === i;
      if (on) UI.highlight(ctx, RX + 4, ry - 1, RW - 8, 28, { alpha: 0.2 });
      drawMemberCell(ctx, ch, RX + 6, ry, RW - 14, 28, { selected: on });
      if (Party.autoBattle[ch.uid]) safe(() => UI.chip(ctx, RX + RW - 26, ry + 1, 'AI', { color: C.cyan }));
      if (on) UI.cursor(ctx, RX + 4, ry + 9, this.t);
      this.rowRects.push({ x: RX + 4, y: ry - 1, w: RW - 8, h: 28, i, col: 1 });
    });
  }

  // --- shared scrolling text body ----------------------------------------

  _drawScrollBody(ctx, x, y, w, h, body) {
    const lines = UI.wrapLines(String(body || ''), w, 'sm');
    const lineH = 9;
    const visible = Math.max(1, Math.floor(h / lineH));
    this._maxScroll = Math.max(0, lines.length - visible);
    const off = clamp(R(this.scroll), 0, this._maxScroll);
    UI.pushClip(ctx, x - 2, y - 2, w + 4, h + 3);
    for (let i = 0; i < visible && off + i < lines.length; i++) {
      txt(ctx, x, y + i * lineH, lines[off + i], { size: 'sm', color: C.ink, shadow: true });
    }
    UI.popClip(ctx);
    if (this._maxScroll > 0) {
      if (off > 0) txtR(ctx, x + w, y - 8, '▲', { size: 'sm', color: C.goldDim });
      if (off < this._maxScroll) txtR(ctx, x + w, y + h - 2, '▼', { size: 'sm', color: C.goldDim });
    }
  }
}

// --- party-sheet helpers ---------------------------------------------------

function instFor(pick) {
  if (!pick || pick.src === 'none') return null;
  if (pick.src === 'own') return pick.entry;
  return safe(() => makeItemInstance(pick.id), null) || { uid: 'preview', id: pick.id, qty: 1 };
}

function slotAccepts(slot, d) {
  if (!d) return false;
  const natural = safe(() => slotFor(d.id), null);
  if (slot === 'mainHand') return d.kind === 'weapon';
  if (slot === 'offHand') return d.kind === 'shield' || (d.kind === 'weapon' && arr(d.props).indexOf('light') >= 0) || d.offHandOk;
  if (slot === 'armor') return d.kind === 'armor';
  if (slot === 'ammo') return d.kind === 'ammo';
  if (slot === 'ring1' || slot === 'ring2') return d.kind === 'ring' || natural === 'ring';
  return natural === slot || d.kind === slot;
}

function rangeLabel(range) {
  if (Array.isArray(range)) return `${range[0]}/${range[1]} ft.`;
  return `${num(range, 5) || 5} ft.`;
}

function durText(dur, long) {
  if (dur == null) return long ? 'Until removed' : '—';
  if (!Number.isFinite(Number(dur))) return String(dur);
  const n = Math.max(0, Math.round(Number(dur)));
  return long ? `${n} round${n === 1 ? '' : 's'} left` : `${n}r`;
}

function sourceTag(src) {
  const s = String(src || '');
  if (s.indexOf('species') === 0 || s.indexOf('lineage') === 0) return 'race';
  if (s.indexOf('subclass') === 0) return 'sub';
  if (s.indexOf('class') === 0) return 'class';
  if (s.indexOf('feat') === 0) return 'feat';
  if (s.indexOf('background') === 0) return 'bg';
  if (s.indexOf('style') === 0) return 'style';
  return 'misc';
}
function sourceLabel(src) {
  const s = String(src || '');
  const i = s.indexOf(':');
  const kind = i < 0 ? s : s.slice(0, i);
  const id = i < 0 ? '' : s.slice(i + 1);
  const nice = { species: 'Species', lineage: 'Lineage', subclass: 'Subclass', class: 'Class', feat: 'Feat', background: 'Background', style: 'Fighting Style' }[kind] || titleCase(kind || 'Feature');
  return id ? `${nice}: ${titleCase(id.replace(/-/g, ' '))}` : nice;
}

/** Turn a `mech` block into readable bullet lines for the sheet. */
function mechSummary(mech) {
  if (!mech || typeof mech !== 'object') return '';
  const out = [];
  const push = (s) => { if (s) out.push(`· ${s}`); };
  if (mech.asi) {
    const bits = Object.keys(mech.asi).map((k) => `${ABILITY_ABBR[k] || titleCase(k)} ${signed(mech.asi[k])}`);
    if (bits.length) push(bits.join(', '));
  }
  if (mech.speedBonus) push(`Speed ${signed(mech.speedBonus)} ft.`);
  if (mech.darkvision) push(`Darkvision ${mech.darkvision} ft.`);
  if (arr(mech.resist).length) push(`Resistance to ${arr(mech.resist).join(', ')}`);
  if (arr(mech.immune).length) push(`Immune to ${arr(mech.immune).join(', ')}`);
  if (arr(mech.condImmune).length) push(`Cannot be ${arr(mech.condImmune).join(', ')}`);
  if (arr(mech.advSaveVs).length) push(`Advantage on saves vs ${arr(mech.advSaveVs).join(', ')}`);
  if (arr(mech.skillProf).length) push(`Proficiency: ${arr(mech.skillProf).map((s) => (SKILLS[s] || {}).name || titleCase(s)).join(', ')}`);
  if (arr(mech.skillExpertise).length) push(`Expertise: ${arr(mech.skillExpertise).map((s) => (SKILLS[s] || {}).name || titleCase(s)).join(', ')}`);
  if (mech.extraAttack) push(`Extra Attack x${mech.extraAttack}`);
  if (mech.critRange) push(`Critical on ${mech.critRange}-20`);
  if (mech.maxHpBonus) push(`Maximum hit points ${signed(mech.maxHpBonus)}`);
  if (mech.hpPerLevel) push(`${signed(mech.hpPerLevel)} hit point per level`);
  if (mech.initiativeBonus) push(`Initiative ${signed(mech.initiativeBonus)}`);
  if (mech.acFormula) push(`AC ${mech.acFormula.base}${mech.acFormula.addDex ? ' + Dex' : ''}`);
  if (mech.unarmedDie) push(`Unarmed strike ${mech.unarmedDie}`);
  if (mech.resource) push(`${mech.resource.name || titleCase(mech.resource.id || '')}: ${mech.resource.max} per ${mech.resource.recharge || 'long'} rest`);
  return out.join('\n');
}

/** progression.xpProgress returns a plain 0..1 number; tolerate an object too. */
function clampPct(prog) {
  if (prog == null) return 0;
  if (Number.isFinite(prog)) return clamp(Number(prog), 0, 1);
  if (Number.isFinite(prog.pct)) return clamp(prog.pct, 0, 1);
  const into = num(prog.into, 0), span = num(prog.span, 0);
  return span > 0 ? clamp(into / span, 0, 1) : 0;
}

function scrollHint(ctx, x, y, h, top, rows, total) {
  const th = Math.max(6, Math.round((rows / total) * h));
  const maxTop = Math.max(1, total - rows);
  const ty = y + Math.round(((h - th) * top) / maxTop);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(R(x), R(y), 3, R(h));
  ctx.fillStyle = C.goldDim;
  ctx.fillRect(R(x), R(ty), 3, th);
  ctx.restore();
}

/** Every spell id the character has access to, prepared or not. */
function spellIdsFor(ch) {
  const out = [];
  const seen = Object.create(null);
  const add = (id) => { if (id && !seen[id] && SPELLS[id]) { seen[id] = 1; out.push(id); } };
  for (const id of arr(ch && ch.spells && ch.spells.cantrips)) add(id);
  for (const id of safe(() => knownSpells(ch), []) || []) add(id);
  for (const id of arr(ch && ch.spells && ch.spells.known)) add(id);
  for (const id of arr(ch && ch.spells && ch.spells.prepared)) add(id);
  for (const id of safe(() => alwaysPreparedSpells(ch), []) || []) add(id);
  return out;
}

// ===========================================================================
// 4. INVENTORY — the shared pack
// ===========================================================================

const INV_TABS = [
  { id: 'all', label: 'All', icon: 'bag' },
  { id: 'weapons', label: 'Arms', icon: 'sword' },
  { id: 'armour', label: 'Armor', icon: 'armor' },
  { id: 'consum', label: 'Use', icon: 'potion' },
  { id: 'magic', label: 'Magic', icon: 'wand' },
  { id: 'quest', label: 'Quest', icon: 'quest' },
  { id: 'misc', label: 'Misc', icon: 'gem' },
];
const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'value', label: 'Value' },
  { id: 'weight', label: 'Weight' },
  { id: 'rarity', label: 'Rarity' },
];
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact'];

function inTab(tabId, d, id) {
  if (!d) return tabId === 'misc';
  switch (tabId) {
    case 'all': return true;
    case 'weapons': return d.kind === 'weapon' || d.kind === 'ammo';
    case 'armour': return d.kind === 'armor' || d.kind === 'shield';
    case 'consum': return d.kind === 'potion' || d.kind === 'scroll' || d.kind === 'food' || !!d.use;
    case 'magic': return safe(() => isMagic(id), false) || !!d.magic || (d.rarity && d.rarity !== 'common');
    case 'quest': return d.kind === 'quest';
    case 'misc': return ['weapon', 'ammo', 'armor', 'shield', 'potion', 'scroll', 'food', 'quest'].indexOf(d.kind) < 0;
    default: return true;
  }
}

/** Who, if anyone, is wearing this exact instance. */
function equippedBy(uid) {
  for (const m of Party.all()) {
    const eq = m.equipment || {};
    for (const k of Object.keys(eq)) {
      const inst = eq[k];
      if (inst && inst.uid === uid) return m;
    }
  }
  return null;
}

export class InventoryScene extends MenuScene {
  constructor(opts = {}) {
    super('inventory');
    this.opts = opts || {};
    this.tab = 0;
    this.sort = 0;
    this.index = 0;
    this.rowTop = 0;     // first visible grid row
    this.scroll = 0;     // detail-pane scroll
    this.cells = [];
    this.tabRects = [];
    this.rows = [];
  }

  get cols() { return 8; }
  get visRows() { return 6; }

  _build() {
    const tabId = INV_TABS[this.tab].id;
    const out = [];
    for (const e of arr(Party.inventory)) {
      const d = safe(() => resolveItem(e.id), null);
      if (!inTab(tabId, d, e.id)) continue;
      out.push({ entry: e, id: e.id, def: d, qty: num(e.qty, 1) });
    }
    const s = SORTS[this.sort].id;
    out.sort((a, b) => {
      const A = a.def || {}, B = b.def || {};
      if (s === 'value') return num(B.cost, 0) - num(A.cost, 0) || String(itemName(a.id, A)).localeCompare(itemName(b.id, B));
      if (s === 'weight') return num(B.weight, 0) - num(A.weight, 0) || String(itemName(a.id, A)).localeCompare(itemName(b.id, B));
      if (s === 'rarity') {
        const ra = RARITY_ORDER.indexOf(A.rarity || 'common'), rb = RARITY_ORDER.indexOf(B.rarity || 'common');
        return rb - ra || String(itemName(a.id, A)).localeCompare(itemName(b.id, B));
      }
      return String(itemName(a.id, A)).localeCompare(itemName(b.id, B));
    });
    this.rows = out;
    return out;
  }

  update(dt) {
    if (this.tick(dt)) return;
    const list = this._build();
    const n = list.length;

    const before = this.tab;
    this.tab = navPage(this.tab, INV_TABS.length);
    const tp = tabPressed(5);
    if (tp >= 0) this.tab = tp;
    if (this.tab !== before) { this.index = 0; this.rowTop = 0; this.scroll = 0; }

    const m = Input.mouse;
    for (const r of this.tabRects) {
      if (clicked(m, r.x, r.y, r.w, r.h)) { this.tab = r.i; this.index = 0; this.rowTop = 0; sfx('cursor'); return; }
    }

    if (Input.consume('interact')) {
      this.sort = (this.sort + 1) % SORTS.length;
      sfx('cursor');
      this.say(`Sorted by ${SORTS[this.sort].label.toLowerCase()}.`, false, 1.6);
      return;
    }

    if (n > 0) {
      if (listNavActive()) {
        const cols = this.cols;
        let i = clamp(this.index, 0, n - 1);
        if (Input.repeatConsume('left')) { i = (i - 1 + n) % n; sfx('cursor'); }
        if (Input.repeatConsume('right')) { i = (i + 1) % n; sfx('cursor'); }
        if (Input.repeatConsume('up')) { i = i - cols < 0 ? i : i - cols; sfx('cursor'); }
        if (Input.repeatConsume('down')) { i = i + cols >= n ? i : i + cols; sfx('cursor'); }
        if (i !== this.index) this.scroll = 0;
        this.index = i;
        const row = Math.floor(this.index / cols);
        if (row < this.rowTop) this.rowTop = row;
        if (row > this.rowTop + this.visRows - 1) this.rowTop = row - this.visRows + 1;
      }
      this.scroll = scrollPane(this.scroll, this._maxScroll || 0, m, this._paneRect);

      for (const c of this.cells) {
        if (hit(m, c.x, c.y, c.w, c.h)) {
          if (this.index !== c.i) { this.index = c.i; this.scroll = 0; sfx('cursor'); }
          if (clicked(m, c.x, c.y, c.w, c.h)) { this._itemMenu(); return; }
        }
      }
      const gw = wheelOver(m, 2, 34, 212, 160);
      if (gw) {
        this.rowTop = clamp(this.rowTop + gw, 0, Math.max(0, Math.ceil(n / this.cols) - this.visRows));
      }
      if (Input.consume('confirm')) { this._itemMenu(); return; }
    }

    if (Input.consume('cancel') || Input.consume('inventory')) this.close();
  }

  // --- actions ------------------------------------------------------------

  _sel() { return this.rows[clamp(this.index, 0, Math.max(0, this.rows.length - 1))] || null; }

  _itemMenu() {
    const it = this._sel();
    if (!it) { sfx('error'); return; }
    const d = it.def;
    const usable = !!(d && d.use);
    const slot = d ? safe(() => slotFor(it.id), null) : null;
    this.ask(itemName(it.id, d), `${titleCase(String((d && d.kind) || 'item'))} · ${rarityName(d)} · worth ${goldText((d && d.cost) || 0)}`, [
      { label: 'Use', value: 'use', disabled: !usable },
      { label: 'Equip', value: 'equip', disabled: !slot },
      { label: 'Give to…', value: 'give', disabled: Party.members.length < 2 },
      { label: 'Drop', value: 'drop', disabled: d && d.kind === 'quest', color: C.bad },
      { label: 'Back', value: null },
    ], (v) => {
      if (v === 'use') this._chooseTarget(it, 'use');
      else if (v === 'equip') this._chooseTarget(it, 'equip');
      else if (v === 'give') this._chooseTarget(it, 'give');
      else if (v === 'drop') this._confirmDrop(it);
    });
  }

  _chooseTarget(it, mode) {
    const members = Party.members;
    if (members.length === 1 && mode !== 'give') { this._apply(it, mode, members[0]); return; }
    const opts = members.map((m, i) => ({
      label: `${m.name} — ${Math.max(0, num(m.hp, 0))}/${maxHpOf(m)} hp`,
      value: i,
      disabled: mode === 'use' && isDead(m),
    }));
    opts.push({ label: 'Back', value: null });
    const title = mode === 'use' ? 'Use on whom?' : mode === 'equip' ? 'Equip on whom?' : 'Hand it to whom?';
    this.ask(title, itemName(it.id, it.def), opts, (v) => {
      if (v == null) return;
      this._apply(it, mode, members[v]);
    });
  }

  _apply(it, mode, ch) {
    if (!ch) return;
    if (mode === 'use') this._use(it, ch);
    else if (mode === 'equip') this._equip(it, ch);
    else if (mode === 'give') this._give(it, ch);
  }

  _equip(it, ch) {
    const slot = safe(() => slotFor(it.id), null);
    if (!slot) { this.say('That cannot be worn or wielded.', true); return; }
    const inst = safe(() => makeItemInstance(it.id), null) || { uid: `t${this.t}`, id: it.id, qty: 1 };
    if (equipInstance(ch, inst, slot, { fromPack: true })) {
      safe(() => Party.removeByUid(it.entry.uid, 1));
      sfx('item');
      this.say(`${ch.name} equips ${itemName(it.id, it.def)}.`);
      this.index = clamp(this.index, 0, Math.max(0, this._build().length - 1));
    } else {
      this.say('It will not go on.', true);
    }
  }

  _give(it, ch) {
    const qty = 1;
    safe(() => {
      const inst = makeItemInstance(it.id, { qty });
      ch.inventory = arr(ch.inventory);
      ch.inventory.push(inst);
    });
    safe(() => Party.removeByUid(it.entry.uid, qty));
    sfx('item');
    this.say(`${ch.name} takes the ${itemName(it.id, it.def).toLowerCase()}.`);
    this.index = clamp(this.index, 0, Math.max(0, this._build().length - 1));
  }

  _confirmDrop(it) {
    this.ask('Drop it?', `${itemName(it.id, it.def)} will be left behind for good.`, [
      { label: 'Drop it', value: 'yes', color: C.bad },
      { label: 'Keep it', value: null },
    ], (v) => {
      if (v !== 'yes') return;
      safe(() => Party.removeByUid(it.entry.uid, 1));
      sfx('back');
      this.say(`${itemName(it.id, it.def)} left behind.`);
      this.index = clamp(this.index, 0, Math.max(0, this._build().length - 1));
    });
  }

  /**
   * Consumables used outside a fight resolve here and now: the dice are rolled,
   * hit points move, and a floater pops over the pane so you see what happened.
   */
  _use(it, ch) {
    const d = it.def;
    const use = d && d.use;
    if (!use) { this.say('Nothing happens.', true); return; }
    const fx = { x: 305, y: 120 };
    let ok = false;
    let text = '';

    switch (use.kind) {
      case 'heal': {
        if (isDead(ch)) { this.say(`${ch.name} is beyond a potion.`, true); return; }
        const r = safe(() => rollExpr(use.dice || '2d4+2'), null) || { total: 5 };
        const got = num(safe(() => heal(ch, r.total), r.total), r.total);
        this.float(fx.x, fx.y, `+${got}`, C.hpHeal);
        sfx('heal');
        text = `${ch.name} drinks the ${itemName(it.id, d).toLowerCase()} and recovers ${got} hit points.`;
        ok = true;
        break;
      }
      case 'temphp': {
        const r = safe(() => rollExpr(use.dice || '1d4'), null) || { total: 4 };
        safe(() => addTempHp(ch, r.total));
        this.float(fx.x, fx.y, `+${r.total} temp`, C.temp);
        sfx('buff');
        text = `${ch.name} gains ${r.total} temporary hit points.`;
        ok = true;
        break;
      }
      case 'cure': {
        const list = arr(use.conditions);
        let n = 0;
        for (const cid of list) if (safe(() => removeCondition(ch, cid), false)) n++;
        if (!n) { this.say(`${ch.name} has nothing that would cure.`, true); return; }
        this.float(fx.x, fx.y, 'cured', C.good);
        sfx('heal');
        text = `${ch.name} is no longer ${list.map((c) => String(c)).join(' or ')}.`;
        ok = true;
        break;
      }
      case 'buff': {
        safe(() => addEffect(ch, {
          id: `item-${it.id}`, name: itemName(it.id, d), dur: num(use.rounds, 10),
          mech: use.mech || null, source: it.id,
        }));
        this.float(fx.x, fx.y, 'buff', C.gold);
        sfx('buff');
        text = `${itemName(it.id, d)} takes hold of ${ch.name}.`;
        ok = true;
        break;
      }
      case 'spell': {
        const sp = SPELLS[use.spellId];
        if (sp && sp.heal) {
          const dice = safe(() => spellHealDice(sp, num(use.level, sp.level)), sp.heal.dice) || sp.heal.dice;
          const r = safe(() => rollExpr(dice), null) || { total: 5 };
          const got = num(safe(() => heal(ch, r.total), r.total), r.total);
          this.float(fx.x, fx.y, `+${got}`, C.hpHeal);
          sfx('spell');
          text = `${sp.name} knits ${ch.name}'s wounds — ${got} hit points.`;
          ok = true;
        } else {
          this.say('Save that one for a fight.', true);
          return;
        }
        break;
      }
      default: {
        // Rations and the like: a nibble, and a little of the road walked off.
        const got = num(safe(() => heal(ch, 1), 1), 1);
        this.float(fx.x, fx.y, `+${got}`, C.hpHeal);
        sfx('item');
        text = `${ch.name} makes a meal of it.`;
        ok = true;
      }
    }

    if (!ok) return;
    if (num(d.charges, 0) > 0 && it.entry.charges != null) {
      it.entry.charges = Math.max(0, num(it.entry.charges, 0) - 1);
      if (it.entry.charges <= 0) safe(() => Party.removeByUid(it.entry.uid, 1));
    } else if (d.kind === 'potion' || d.kind === 'scroll' || d.kind === 'food' || use.consumed !== false) {
      safe(() => Party.removeByUid(it.entry.uid, 1));
    }
    safe(() => bus.emit(EV.LOG, { text, kind: 'item' }));
    this.say(text);
    this.index = clamp(this.index, 0, Math.max(0, this._build().length - 1));
  }

  // --- drawing ------------------------------------------------------------

  draw(ctx) {
    ctx.fillStyle = C.bgDeep;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.cells = [];
    this.tabRects = [];
    const list = this.rows.length ? this.rows : this._build();

    // Header: weight and purse.
    UI.panel(ctx, 2, 2, VIEW_W - 4, 15, { style: 'dark' });
    txt(ctx, 8, 5, 'THE COMPANY PACK', { size: 'md', color: C.gold, shadow: true });
    const w = packWeight(), cap = partyCapacity();
    const over = w > cap;
    UI.bar(ctx, 128, 5, 96, 7, cap > 0 ? w / cap : 0, {
      color: over ? C.bad : (w > cap * 0.8 ? C.warn : C.green),
      label: `${w} / ${cap} lb`, size: 'sm',
    });
    if (over) txt(ctx, 228, 6, 'OVERLOADED', { size: 'sm', color: C.bad, shadow: true });
    UI.icon(ctx, 'coin', VIEW_W - 78, 4, 9, C.gold);
    txtR(ctx, VIEW_W - 8, 6, goldText(Party.gold), { size: 'md', color: C.gold, shadow: true });

    // Filter tabs.
    UI.tabs(ctx, 2, 19, VIEW_W - 4, INV_TABS.map((t) => ({ label: t.label, icon: t.icon })), this.tab, {});
    const tw = Math.floor((VIEW_W - 4) / INV_TABS.length);
    for (let i = 0; i < INV_TABS.length; i++) this.tabRects.push({ x: 2 + i * tw, y: 19, w: tw, h: 13, i });

    // Grid.
    const GX = 3, GY = 36, cell = 24, gap = 2;
    UI.panel(ctx, GX - 1, GY - 4, this.cols * (cell + gap) + 4, this.visRows * (cell + gap) + 6, { style: 'inset' });
    const totalRows = Math.max(1, Math.ceil(list.length / this.cols));
    this.rowTop = clamp(this.rowTop, 0, Math.max(0, totalRows - this.visRows));
    for (let r = 0; r < this.visRows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = (this.rowTop + r) * this.cols + c;
        const cx = GX + c * (cell + gap), cy = GY + r * (cell + gap);
        UI.panel(ctx, cx, cy, cell, cell, { style: 'inset', shadow: 0 });
        const it = list[idx];
        if (!it) continue;
        this.cells.push({ x: cx, y: cy, w: cell, h: cell, i: idx });
        const col = itemColor(it.id, it.def);
        UI.icon(ctx, itemIcon(it.def), cx + 7, cy + 6, 11, null);
        if (it.def && it.def.rarity && it.def.rarity !== 'common') {
          ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1;
          ctx.strokeRect(cx + 0.5, cy + 0.5, cell - 1, cell - 1);
          ctx.restore();
        }
        if (it.qty > 1) txtR(ctx, cx + cell - 2, cy + cell - 8, String(it.qty), { size: 'sm', color: C.ink, shadow: true });
        if (equippedBy(it.entry.uid)) txt(ctx, cx + 2, cy + 1, 'E', { size: 'sm', color: C.cyan, shadow: true });
        if (idx === this.index) UI.frameSel(ctx, cx - 1, cy - 1, cell + 2, cell + 2, this.t);
      }
    }
    if (totalRows > this.visRows) {
      scrollHint(ctx, GX + this.cols * (cell + gap) - 1, GY, this.visRows * (cell + gap) - gap, this.rowTop, this.visRows, totalRows);
    }

    // Sort line under the grid.
    const sy = GY + this.visRows * (cell + gap) + 4;
    txt(ctx, GX + 2, sy, `Sort: ${SORTS[this.sort].label}`, { size: 'sm', color: C.goldDim, shadow: true });
    txtR(ctx, GX + this.cols * (cell + gap) - 2, sy, `${list.length} of ${arr(Party.inventory).length} items`, {
      size: 'sm', color: C.inkDim, shadow: true,
    });

    // Detail pane.
    const DX = 214, DW = VIEW_W - DX - 3, DY = 34, DH = CONTENT_BOTTOM - 34;
    UI.panel(ctx, DX, DY, DW, DH, { style: 'window' });
    this._paneRect = { x: DX, y: DY, w: DW, h: DH };
    this._drawDetail(ctx, list[this.index] || null, DX + 7, DY + 5, DW - 14, DH - 10);

    this.drawMessage(ctx, 6, MSG_Y, VIEW_W - 12);
    hintBar(ctx, HINT_Y, [
      [keyFor('cancel'), 'Back'], [keyFor('confirm'), 'Use/Equip'],
      [keyFor('interact'), 'Sort'], [`${keyFor('prev')}/${keyFor('next')}`, 'Filter'], [keyFor('run'), 'Scroll'],
    ]);
    this.drawPrompt(ctx);
    this.drawFloats(ctx);
  }

  _drawDetail(ctx, it, x, y, w, h) {
    if (!it) {
      txtC(ctx, x + w / 2, y + h / 2 - 4, 'The pack is empty here.', { size: 'sm', color: C.disabled });
      return;
    }
    const d = it.def;
    const col = itemColor(it.id, d);
    const nameLines = UI.wrapLines(itemName(it.id, d), w, 'md');
    let ty = y;
    for (const l of nameLines.slice(0, 2)) { txt(ctx, x, ty, l, { size: 'md', color: col, shadow: true }); ty += 11; }
    txt(ctx, x, ty, `${titleCase(String((d && d.kind) || 'item'))} · ${rarityName(d)}`, {
      size: 'sm', color: C.inkDim, shadow: true, maxWidth: w,
    });
    ty += 10;
    kv(ctx, x, ty, w, 'Weight', `${num(d && d.weight, 0)} lb${it.qty > 1 ? ` (x${it.qty})` : ''}`);
    kv(ctx, x, ty + 9, w, 'Value', goldText(num(d && d.cost, 0)));
    ty += 20;

    const stat = d && d.kind === 'weapon' ? safe(() => weaponLine(d), '') : safe(() => armorLine(d), '');
    if (stat) { txt(ctx, x, ty, stat, { size: 'sm', color: C.goldBright, shadow: true, maxWidth: w }); ty += 10; }

    const holder = equippedBy(it.entry.uid);
    if (holder) { txt(ctx, x, ty, `Worn by ${holder.name}`, { size: 'sm', color: C.cyan, shadow: true, maxWidth: w }); ty += 10; }

    if (d && d.use) {
      const u = d.use;
      const line = u.kind === 'heal' ? `Restores ${u.dice} hit points.`
        : u.kind === 'cure' ? `Cures: ${arr(u.conditions).join(', ')}.`
          : u.kind === 'temphp' ? `Grants ${u.dice} temporary hit points.`
            : u.kind === 'spell' ? `Casts ${(SPELLS[u.spellId] || {}).name || u.spellId}.`
              : 'Consumed on use.';
      txt(ctx, x, ty, line, { size: 'sm', color: C.green, shadow: true, maxWidth: w });
      ty += 10;
    }

    UI.divider(ctx, x, ty, w);
    ty += 4;
    const body = [(d && d.desc) || 'A plain thing of no great story.', mechSummary(d && d.mech)].filter(Boolean).join('\n\n');
    const lines = UI.wrapLines(body, w, 'sm');
    const avail = Math.max(1, Math.floor((y + h - ty) / 9));
    this._maxScroll = Math.max(0, lines.length - avail);
    const off = clamp(R(this.scroll), 0, this._maxScroll);
    UI.pushClip(ctx, x - 2, ty - 1, w + 4, y + h - ty + 1);
    for (let i = 0; i < avail && off + i < lines.length; i++) {
      txt(ctx, x, ty + i * 9, lines[off + i], { size: 'sm', color: C.ink, shadow: true });
    }
    UI.popClip(ctx);
    if (this._maxScroll > 0) {
      if (off > 0) txtR(ctx, x + w, ty - 8, '▲', { size: 'sm', color: C.goldDim });
      if (off < this._maxScroll) txtR(ctx, x + w, y + h - 7, '▼', { size: 'sm', color: C.goldDim });
    }
  }
}

// ===========================================================================
// 5. SPELLBOOK
// ===========================================================================

const SPELL_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'prepared', label: 'Prepared' },
  { id: 'damage', label: 'Damage' },
  { id: 'heal', label: 'Healing' },
  { id: 'utility', label: 'Utility' },
  { id: 'concentration', label: 'Concentration' },
  { id: 'ritual', label: 'Ritual' },
];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function isCaster(ch) {
  if (!ch || !ch.spells) return false;
  if (arr(ch.spells.cantrips).length || arr(ch.spells.known).length || arr(ch.spells.prepared).length) return true;
  const slots = ch.spells.slots || {};
  for (const k of Object.keys(slots)) if (num(slots[k] && slots[k].max, 0) > 0) return true;
  return num(ch.spells.pact && ch.spells.pact.max, 0) > 0;
}

export class SpellbookScene extends MenuScene {
  constructor(opts = {}) {
    super('spellbook');
    this.opts = opts || {};
    this.casters = Party.members.filter(isCaster);
    this.caster = clamp(num(opts.member, 0), 0, Math.max(0, this.casters.length - 1));
    this.filter = 0;
    this.index = 0;
    this.top = 0;
    this.scroll = 0;
    this.alpha = null;        // { index } while the A-Z jump strip is open
    this.rows = [];
    this.rowRects = [];
    this.tabRects = [];
  }

  get ch() { return this.casters[this.caster] || null; }

  enter(prev) {
    super.enter(prev);
    this.casters = Party.members.filter(isCaster);
    this.caster = clamp(this.caster, 0, Math.max(0, this.casters.length - 1));
  }

  /** Rows are the spell list grouped by level, with headers folded in. */
  _build() {
    const ch = this.ch;
    const out = [];
    if (!ch) { this.rows = out; return out; }
    const ids = spellIdsFor(ch);
    const prepared = arr(ch.spells && ch.spells.prepared);
    const always = safe(() => alwaysPreparedSpells(ch), []) || [];
    const f = SPELL_FILTERS[this.filter].id;

    const keep = (sp, id) => {
      if (f === 'all') return true;
      if (f === 'prepared') return sp.level === 0 || prepared.indexOf(id) >= 0 || always.indexOf(id) >= 0;
      if (f === 'concentration') return !!sp.concentration;
      if (f === 'ritual') return !!sp.ritual;
      if (f === 'damage') return !!sp.damage || arr(sp.tags).indexOf('damage') >= 0;
      if (f === 'heal') return !!sp.heal || arr(sp.tags).indexOf('heal') >= 0;
      if (f === 'utility') return !sp.damage && !sp.heal;
      return true;
    };

    for (let lv = 0; lv <= 9; lv++) {
      const group = ids.filter((id) => SPELLS[id] && SPELLS[id].level === lv && keep(SPELLS[id], id));
      if (!group.length) continue;
      group.sort((a, b) => String(SPELLS[a].name).localeCompare(SPELLS[b].name));
      const slots = ch.spells && ch.spells.slots && ch.spells.slots[lv];
      const label = lv === 0 ? 'Cantrips'
        : `${ordinal(lv)} Level${slots && slots.max ? `  ${Math.max(0, num(slots.max, 0) - num(slots.used, 0))}/${slots.max}` : ''}`;
      out.push({ head: true, label, level: lv });
      for (const id of group) {
        out.push({
          head: false, id, level: lv, spell: SPELLS[id],
          prepared: prepared.indexOf(id) >= 0 || always.indexOf(id) >= 0 || lv === 0,
          locked: always.indexOf(id) >= 0 || lv === 0,
        });
      }
    }
    this.rows = out;
    if (this.index >= out.length) this.index = Math.max(0, out.length - 1);
    if (out[this.index] && out[this.index].head) this.index = Math.min(out.length - 1, this.index + 1);
    return out;
  }

  update(dt) {
    if (this.tick(dt)) return;
    if (!this.casters.length) {
      if (Input.consume('cancel') || Input.consume('confirm')) this.close();
      return;
    }
    const rows = this._build();

    if (this.alpha) { this._updateAlpha(rows); return; }

    const c0 = this.caster;
    this.caster = navH(this.caster, this.casters.length);
    const tp = tabPressed(5);
    if (tp >= 0 && tp < this.casters.length) this.caster = tp;
    if (this.caster !== c0) { this.index = 0; this.top = 0; this.scroll = 0; return; }

    const f0 = this.filter;
    this.filter = navPage(this.filter, SPELL_FILTERS.length);
    if (this.filter !== f0) { this.index = 0; this.top = 0; this.scroll = 0; return; }

    if (listNavActive()) {
      const n = rows.length;
      if (n) {
        let i = this.index;
        if (Input.repeatConsume('up')) { i = this._step(i, -1); sfx('cursor'); }
        if (Input.repeatConsume('down')) { i = this._step(i, 1); sfx('cursor'); }
        if (i !== this.index) { this.index = i; this.scroll = 0; }
      }
    }
    this.scroll = scrollPane(this.scroll, this._maxScroll || 0, Input.mouse, this._paneRect);

    const m = Input.mouse;
    for (const r of this.tabRects) {
      if (clicked(m, r.x, r.y, r.w, r.h)) { this.caster = r.i; this.index = 0; this.top = 0; sfx('cursor'); return; }
    }
    for (const r of this.rowRects) {
      if (hit(m, r.x, r.y, r.w, r.h)) {
        if (this.index !== r.i) { this.index = r.i; this.scroll = 0; sfx('cursor'); }
        if (clicked(m, r.x, r.y, r.w, r.h)) { this._togglePrepare(); return; }
      }
    }

    if (Input.consume('interact')) { this._togglePrepare(); return; }
    if (Input.consume('confirm')) { this._castHere(); return; }
    if (Input.consume('cancel')) this.close();
  }

  // -------------------------------------------------------------------------
  // CASTING, STANDING HERE
  // -------------------------------------------------------------------------
  //
  // Mage Armor lasts eight hours. Light lasts one. Longstrider, Aid, Goodberry,
  // Knock — none of them are combat spells, and until now the only place a spell
  // could be cast was the battle screen, which made half the book decoration.
  // rules/fieldcast.js does the work; this only asks who it lands on.

  _castHere() {
    const ch = this.ch;
    const row = this.rows[this.index];
    if (!ch || !row || row.head) { sfx('error'); return; }

    const gate = safe(() => fieldCastable(ch, row.id), { ok: false, why: 'It will not come.' });
    if (!gate.ok) { sfx('error'); this.say(gate.why || 'Not here.', true, 2.6); return; }

    if (fieldTargeting(row.spell) === 'ally' && Party.members.length > 1) {
      const options = Party.members.map((m, i) => ({
        label: `${m.name}  ${m.hp}/${num(m.maxHp, m.hp)}`, value: i,
      }));
      this.ask(row.spell.name, 'On whom?', options, (v) => {
        if (v == null) return;
        this._doCast(ch, row, Party.members[v] || ch);
      });
      return;
    }
    this._doCast(ch, row, ch);
  }

  _doCast(ch, row, target) {
    const res = safe(() => fieldCast(ch, row.id, {
      target,
      party: Party,
      state: Game.state,
      world: this._worldHooks(),
    }), null);
    if (!res || !res.ok) { sfx('error'); this.say((res && res.text) || 'Nothing happens.', true, 2.6); return; }

    if (res.minutes) safe(() => advanceTime(Game.state, res.minutes));
    if (Game.state) Game.state.stats.spellsCast = num(Game.state.stats.spellsCast, 0) + 1;
    safe(() => bus.emit(EV.SPELL_CAST, { ch, spellId: row.id, field: true }));
    sfx('spell');
    // The status line shares a row with the key hints, so keep it to one clause.
    this.say(res.lines[0], false, 3.4);
    // …and float the cost over the slot pips, which is where the eye goes to
    // check what it just cost.
    this.float(40, 196, res.ritual ? 'ritual' : res.slot ? `-1 slot ${res.slot}` : 'cantrip',
      res.ritual ? C.cyan : C.gold);
  }

  /**
   * What the spellbook can reach out and touch. The overworld beneath us owns
   * the map, so ask it; when the spellbook was opened from somewhere else (a
   * rest, the title screen) the hooks are simply absent and fieldcast falls
   * back to prose.
   */
  _worldHooks() {
    const ow = safe(() => Game.scenes.find((sc) => sc && sc.id === 'overworld'), null);
    if (!ow || typeof ow.spellHooks !== 'function') return {};
    return safe(() => ow.spellHooks(), {}) || {};
  }

  /** Move the cursor past group headers. */
  _step(i, dir) {
    const n = this.rows.length;
    if (!n) return 0;
    let j = i;
    for (let k = 0; k < n; k++) {
      j = (j + dir + n) % n;
      if (!this.rows[j].head) return j;
    }
    return i;
  }

  _updateAlpha(rows) {
    const a = this.alpha;
    a.index = navH(a.index, ALPHABET.length);
    if (Input.repeatConsume('up')) { a.index = (a.index - 13 + 26) % 26; sfx('cursor'); }
    if (Input.repeatConsume('down')) { a.index = (a.index + 13) % 26; sfx('cursor'); }
    if (Input.consume('confirm')) {
      const letter = ALPHABET[a.index];
      const at = rows.findIndex((r) => !r.head && String(r.spell.name).toUpperCase().charAt(0) === letter);
      this.alpha = null;
      if (at >= 0) { this.index = at; this.scroll = 0; sfx('select'); }
      else this.say(`No spell in this book begins with ${letter}.`, true);
      return;
    }
    if (Input.consume('cancel') || Input.consume('interact')) { this.alpha = null; sfx('back'); }
  }

  _togglePrepare() {
    const ch = this.ch;
    const row = this.rows[this.index];
    if (!ch || !row || row.head) { sfx('error'); return; }
    const cls = arr(ch.classes)[0] || {};
    const prepared = safe(() => isPreparedCaster(cls.id, cls.subclassId), true);
    if (row.level === 0) { this.say('Cantrips are always ready.', true, 2); return; }
    if (!prepared) { this.say(`${ch.name} knows their spells by heart — nothing to prepare.`, true, 2.4); return; }
    if (row.locked) { this.say('That one is always prepared.', true, 2); return; }

    ch.spells.prepared = arr(ch.spells.prepared);
    const at = ch.spells.prepared.indexOf(row.id);
    if (at >= 0) {
      ch.spells.prepared.splice(at, 1);
      sfx('close');
      this.say(`${row.spell.name} set aside.`);
      return;
    }
    const cap = num(safe(() => preparedMax(ch), 0), 0);
    const always = (safe(() => alwaysPreparedSpells(ch), []) || []).length;
    const used = ch.spells.prepared.length;
    if (cap > 0 && used >= cap) { this.say(`${ch.name} can only hold ${cap} spells in mind.`, true); return; }
    if (!safe(() => canPrepare(ch, row.id), true)) { this.say('That spell is not on their list.', true); return; }
    ch.spells.prepared.push(row.id);
    void always;
    sfx('spell');
    this.say(`${row.spell.name} prepared.`);
  }

  // --- drawing ------------------------------------------------------------

  draw(ctx) {
    ctx.fillStyle = C.bgDeep;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.rowRects = [];
    this.tabRects = [];

    if (!this.casters.length) {
      UI.panel(ctx, 40, 80, VIEW_W - 80, 80, { style: 'window' });
      txtC(ctx, VIEW_W / 2, 100, 'No one here works the Weave.', { size: 'md', color: C.gold });
      txtC(ctx, VIEW_W / 2, 116, 'Recruit a cleric at the Shrine of Luck,', { size: 'sm', color: C.inkDim });
      txtC(ctx, VIEW_W / 2, 126, 'or a sellsword wizard at the Sleeping Giant.', { size: 'sm', color: C.inkDim });
      hintBar(ctx, HINT_Y, [[keyFor('cancel'), 'Back']]);
      return;
    }

    const ch = this.ch;
    const rows = this.rows.length ? this.rows : this._build();
    this._drawHeader(ctx, ch);

    // Filter strip.
    UI.panel(ctx, 2, 28, VIEW_W - 4, 12, { style: 'dark' });
    txt(ctx, 8, 30, '◀', { size: 'sm', color: C.gold });
    txt(ctx, 16, 30, `Filter: ${SPELL_FILTERS[this.filter].label}`, { size: 'sm', color: C.goldBright, shadow: true, maxWidth: 120 });
    txt(ctx, 140, 30, '▶', { size: 'sm', color: C.gold });
    const conc = safe(() => isConcentrating(ch), false);
    txtR(ctx, VIEW_W - 8, 30, conc ? `Concentrating on ${(SPELLS[(ch.concentration || {}).spellId] || {}).name || 'a spell'}` : 'Not concentrating', {
      size: 'sm', color: conc ? C.purple : C.disabled, shadow: true, maxWidth: 200,
    });

    // Spell list.
    const LX = 3, LY = 42, LW = 176, LH = 162;
    UI.panel(ctx, LX, LY, LW, LH, { style: 'window' });
    const rowH = 11, visible = 14;
    if (this.index < this.top) this.top = this.index;
    if (this.index > this.top + visible - 1) this.top = this.index - visible + 1;
    this.top = clamp(this.top, 0, Math.max(0, rows.length - visible));
    UI.pushClip(ctx, LX + 2, LY + 3, LW - 4, rowH * visible + 2);
    for (let i = 0; i < visible && this.top + i < rows.length; i++) {
      const idx = this.top + i;
      const r = rows[idx];
      const ry = LY + 5 + i * rowH;
      if (r.head) {
        txt(ctx, LX + 6, ry + 1, r.label, { size: 'sm', color: C.goldDim, shadow: true, maxWidth: LW - 14 });
        UI.divider(ctx, LX + 6 + UI.measure(r.label, 'sm') + 4, ry + 4, Math.max(4, LW - 20 - UI.measure(r.label, 'sm')));
        continue;
      }
      const on = idx === this.index;
      if (on) UI.highlight(ctx, LX + 3, ry - 1, LW - 8, rowH, { alpha: 0.2 });
      const sp = r.spell;
      const school = (SCHOOLS[sp.school] || {}).color || C.ink;
      txt(ctx, LX + 8, ry, r.prepared ? '♦' : '○', { size: 'sm', color: r.prepared ? (r.locked ? C.cyan : C.goldBright) : C.disabled, shadow: true });
      txt(ctx, LX + 17, ry, sp.name, {
        size: on ? 'md' : 'sm', color: on ? C.goldBright : (r.prepared ? C.ink : C.inkDim), shadow: true, maxWidth: LW - 46,
      });
      let mx = LX + LW - 8;
      if (sp.ritual) { txtR(ctx, mx, ry, 'R', { size: 'sm', color: C.blue, shadow: true }); mx -= 7; }
      if (sp.concentration) { txtR(ctx, mx, ry, 'C', { size: 'sm', color: C.purple, shadow: true }); mx -= 7; }
      ctx.fillStyle = school;
      ctx.fillRect(R(mx - 3), R(ry + 2), 3, 3);
      if (on) UI.cursor(ctx, LX + 2, ry, this.t);
      this.rowRects.push({ x: LX + 3, y: ry - 1, w: LW - 8, h: rowH, i: idx });
    }
    UI.popClip(ctx);
    if (rows.length > visible) scrollHint(ctx, LX + LW - 4, LY + 4, rowH * visible, this.top, visible, rows.length);

    // Detail.
    const DX = 183, DW = VIEW_W - DX - 3;
    UI.panel(ctx, DX, LY, DW, LH, { style: 'window' });
    this._paneRect = { x: DX, y: LY, w: DW, h: LH };
    this._drawSpell(ctx, ch, (rows[this.index] || {}).spell || null, DX + 7, LY + 5, DW - 14, LH - 10);

    this._drawSlots(ctx, ch, 2, 206);
    hintBar(ctx, HINT_Y, [
      [keyFor('cancel'), 'Back'], [keyFor('confirm'), 'Cast'],
      [keyFor('interact'), 'Prepare'], [`${keyFor('prev')}/${keyFor('next')}`, 'Filter'],
    ]);
    this.drawStatusRight(ctx);
    if (this.alpha) this._drawAlpha(ctx);
    this.drawPrompt(ctx);
    this.drawFloats(ctx);
  }

  _drawHeader(ctx, ch) {
    UI.panel(ctx, 2, 2, VIEW_W - 4, 24, { style: 'dark' });
    const n = this.casters.length;
    const cw = Math.min(76, Math.floor(268 / Math.max(1, n)));
    for (let i = 0; i < n; i++) {
      const x = 4 + i * (cw + 2);
      const on = i === this.caster;
      UI.panel(ctx, x, 4, cw, 20, { style: on ? 'gold' : 'plain', shadow: on ? 0.35 : 0.1 });
      const m = this.casters[i];
      safe(() => UI.portrait(ctx, m, x + 2, 6, 16, { shadow: 0.15 }));
      txt(ctx, x + 21, 7, m.name, {
        size: on ? 'md' : 'sm', color: on ? '#2a1c07' : C.ink, shadow: !on, maxWidth: cw - 25,
      });
      txt(ctx, x + 21, 16, `Lv ${num(safe(() => casterLevel(m), m.level), m.level || 1)} caster`, {
        size: 'sm', color: on ? '#4a3410' : C.inkDim, shadow: !on, maxWidth: cw - 25,
      });
      this.tabRects.push({ x, y: 4, w: cw, h: 20, i });
    }
    const bx = VIEW_W - 122;
    const cls = arr(ch.classes)[0] || {};
    const prepMode = safe(() => isPreparedCaster(cls.id, cls.subclassId), true);
    const cap = num(safe(() => preparedMax(ch), 0), 0);
    const used = arr(ch.spells && ch.spells.prepared).length;
    kv(ctx, bx, 5, 114, 'Spell save DC', String(num(safe(() => spellDC(ch), 8), 8)), { color: C.goldBright });
    kv(ctx, bx, 14, 114, 'Spell attack', signed(num(safe(() => spellAtk(ch), 0), 0)), { color: C.goldBright });
    txtR(ctx, VIEW_W - 8, 23, prepMode ? `${used}/${cap} prepared` : 'Spells known', {
      size: 'sm', color: prepMode && cap && used >= cap ? C.warn : C.inkDim, shadow: true,
    });
  }

  _drawSpell(ctx, ch, sp, x, y, w, h) {
    if (!sp) {
      txtC(ctx, x + w / 2, y + h / 2 - 4, 'Choose a spell.', { size: 'sm', color: C.disabled });
      return;
    }
    const school = (SCHOOLS[sp.school] || {});
    txt(ctx, x, y, sp.name, { size: 'md', color: school.color || C.gold, shadow: true, maxWidth: w });
    txt(ctx, x, y + 11, sp.level === 0 ? `${school.name || sp.school} cantrip` : `${ordinal(sp.level)}-level ${school.name || sp.school}`, {
      size: 'sm', color: C.inkDim, shadow: true, maxWidth: w,
    });

    const colW = Math.floor((w - 6) / 2);
    const rows = [
      ['Casting Time', titleCase(String(sp.castTime || 'action'))],
      ['Range', safe(() => rangeText(sp), String(sp.range))],
      ['Components', safe(() => componentText(sp), '—')],
      ['Duration', titleCase(String(sp.duration || 'instant'))],
    ];
    rows.forEach((r, i) => {
      const cx = x + (i % 2) * (colW + 6);
      const cy = y + 22 + Math.floor(i / 2) * 10;
      kv(ctx, cx, cy, colW, r[0], r[1]);
    });

    let ty = y + 44;
    let cx = x;
    if (sp.concentration) cx += (safe(() => UI.chip(ctx, cx, ty, 'Concentration', { color: C.purple }), 0) || 0) + 3;
    if (sp.ritual) cx += (safe(() => UI.chip(ctx, cx, ty, 'Ritual', { color: C.blue }), 0) || 0) + 3;
    if (sp.attack) cx += (safe(() => UI.chip(ctx, cx, ty, `${titleCase(sp.attack)} attack ${signed(num(safe(() => spellAtk(ch), 0), 0))}`, { color: C.gold }), 0) || 0) + 3;
    if (sp.save) cx += (safe(() => UI.chip(ctx, cx, ty, `${ABILITY_ABBR[sp.save.ability] || sp.save.ability} save DC ${num(safe(() => spellDC(ch), 8), 8)}`, { color: C.warn }), 0) || 0) + 3;
    ty += 12;

    const lvl = num(ch.level, 1);
    if (sp.damage) {
      const dice = safe(() => spellDamageDice(sp, sp.level, lvl), sp.damage.dice) || sp.damage.dice;
      txt(ctx, x, ty, `Damage: ${dice} ${sp.damage.type || ''}`, { size: 'sm', color: C.red, shadow: true, maxWidth: w });
      ty += 9;
    }
    if (sp.heal) {
      const dice = safe(() => spellHealDice(sp, sp.level), sp.heal.dice) || sp.heal.dice;
      txt(ctx, x, ty, `Healing: ${dice}${sp.heal.mod === 'spell' ? ' + spellcasting modifier' : ''}`, {
        size: 'sm', color: C.hpHeal, shadow: true, maxWidth: w,
      });
      ty += 9;
    }

    const upcast = upcastText(sp);
    const body = [sp.desc || '', upcast].filter(Boolean).join('\n\n');
    const lines = UI.wrapLines(body, w, 'sm');
    const avail = Math.max(1, Math.floor((y + h - ty - 2) / 9));
    this._maxScroll = Math.max(0, lines.length - avail);
    const off = clamp(R(this.scroll), 0, this._maxScroll);
    UI.pushClip(ctx, x - 2, ty - 1, w + 4, y + h - ty + 1);
    for (let i = 0; i < avail && off + i < lines.length; i++) {
      const l = lines[off + i];
      txt(ctx, x, ty + i * 9, l, {
        size: 'sm', color: l.indexOf('At Higher Levels') === 0 ? C.goldDim : C.ink, shadow: true,
      });
    }
    UI.popClip(ctx);
    if (this._maxScroll > 0) {
      if (off > 0) txtR(ctx, x + w, ty - 8, '▲', { size: 'sm', color: C.goldDim });
      if (off < this._maxScroll) txtR(ctx, x + w, y + h - 7, '▼', { size: 'sm', color: C.goldDim });
    }
  }

  /** One pip row per spell level, plus the warlock's pact slots on their own line. */
  _drawSlots(ctx, ch, x, y) {
    UI.panel(ctx, x, y, VIEW_W - x * 2, 14, { style: 'dark' });
    txt(ctx, x + 5, y + 4, 'SLOTS', { size: 'sm', color: C.goldDim, shadow: true });
    let cx = x + 34;
    const slots = (ch.spells && ch.spells.slots) || {};
    let any = false;
    for (let lv = 1; lv <= 9; lv++) {
      const s = slots[lv];
      if (!s || !num(s.max, 0)) continue;
      any = true;
      const left = Math.max(0, num(s.max, 0) - num(s.used, 0));
      txt(ctx, cx, y + 4, String(lv), { size: 'sm', color: C.goldDim, shadow: true });
      const w = safe(() => UI.pips(ctx, cx + 7, y + 4, num(s.max, 0), left, { size: 4, gap: 1, color: SLOT_TINT[lv - 1] }), 0) || 0;
      cx += 9 + w + 7;
      if (cx > VIEW_W - 90) break;
    }
    const pact = ch.spells && ch.spells.pact;
    if (pact && num(pact.max, 0)) {
      const left = Math.max(0, num(pact.max, 0) - num(pact.used, 0));
      txtR(ctx, VIEW_W - 62, y + 4, `Pact ${ordinal(num(pact.level, 1))}`, { size: 'sm', color: C.purple, shadow: true });
      safe(() => UI.pips(ctx, VIEW_W - 58, y + 4, num(pact.max, 0), left, { size: 4, gap: 1, color: C.purple }));
      any = true;
    }
    if (!any) txt(ctx, x + 34, y + 4, 'No spell slots — cantrips only.', { size: 'sm', color: C.disabled, shadow: true });
  }

  _drawAlpha(ctx) {
    UI.scrim(ctx, 0.5);
    const w = 300, h = 54;
    const x = R((VIEW_W - w) / 2), y = R((VIEW_H - h) / 2);
    UI.window(ctx, x, y, w, h, 'Jump to letter', { style: 'window' });
    for (let i = 0; i < ALPHABET.length; i++) {
      const col = i % 13, row = Math.floor(i / 13);
      const cx = x + 8 + col * 22, cy = y + 6 + row * 16;
      const on = i === this.alpha.index;
      if (on) UI.highlight(ctx, cx - 2, cy - 2, 18, 14, { alpha: 0.3 });
      txtC(ctx, cx + 7, cy, ALPHABET[i], { size: on ? 'md' : 'sm', color: on ? C.goldBright : C.inkDim, shadow: true });
    }
    txtC(ctx, x + w / 2, y + h - 10, `${keyFor('confirm')} jump  ·  ${keyFor('cancel')} back`, { size: 'sm', color: C.disabled });
  }
}

const SLOT_TINT = ['#6aa8e8', '#5f9ee0', '#7a94e0', '#9088e0', '#a87ce0', '#c078d8', '#d478c8', '#e07ab0', '#e88a90'];

function upcastText(sp) {
  if (!sp || sp.level === 0) {
    if (sp && sp.damage && sp.damage.scale) {
      const marks = arr(sp.damage.scale.cantripLevels).length ? arr(sp.damage.scale.cantripLevels) : [5, 11, 17];
      return `At Higher Levels: the damage die count rises at levels ${marks.join(', ')}.`;
    }
    return '';
  }
  const bits = [];
  if (sp.damage && sp.damage.scale && sp.damage.scale.perSlot) bits.push(`${sp.damage.scale.perSlot} more damage per slot level above ${ordinal(sp.level)}`);
  if (sp.heal && sp.heal.scale && sp.heal.scale.perSlot) bits.push(`${sp.heal.scale.perSlot} more healing per slot level above ${ordinal(sp.level)}`);
  if (sp.target && num(sp.target.perSlot, 0)) bits.push(`${sp.target.perSlot} extra target per slot level`);
  return bits.length ? `At Higher Levels: ${bits.join('; ')}.` : '';
}

// ===========================================================================
// 6. JOURNAL — quests, contracts, lore, factions
// ===========================================================================

const JOURNAL_TABS = [
  { id: 'active', label: 'Active', icon: 'quest' },
  { id: 'done', label: 'Done', icon: 'check' },
  { id: 'contracts', label: 'Contracts', icon: 'scroll' },
  { id: 'lore', label: 'Lore', icon: 'book' },
  { id: 'factions', label: 'Factions', icon: 'crown' },
];

/** Canonical faction ladders from the Sword Coast sourcebooks. */
const FACTIONS = [
  {
    id: 'harpers', name: 'The Harpers', color: '#6aa8e8',
    ranks: ['Watcher', 'Harpshadow', 'Brightcandle', 'Wise Owl'],
    blurb: 'Secretive do-gooders who trade in lore and quiet intervention. Sister Garaele speaks for them in Phandalin.',
  },
  {
    id: 'gauntlet', name: 'Order of the Gauntlet', color: '#f0d264',
    ranks: ['Chevall', 'Marshal', 'Whitehawk', 'Vindicator'],
    blurb: 'Militant righteousness — Torm, Tyr and Helm. Daran Edermath keeps their orchard and their contracts.',
  },
  {
    id: 'emerald-enclave', name: 'Emerald Enclave', color: '#6fc36a',
    ranks: ['Springwarden', 'Summerstrider', 'Autumnreaver', 'Winterstalker'],
    blurb: 'Keepers of the wilderness balance. Reidoth of Thundertree and the Alderleaf farmstead pass their word along.',
  },
  {
    id: 'lords-alliance', name: "Lords' Alliance", color: '#b9c1cf',
    ranks: ['Cloak', 'Redknife', 'Stingblade', 'Warduke'],
    blurb: 'The coalition of Waterdeep, Neverwinter and Silverymoon. Sildar Hallwinter carries their commission.',
  },
  {
    id: 'zhentarim', name: 'The Zhentarim', color: '#b07ae0',
    ranks: ['Fang', 'Wolf', 'Viper', 'Ardragon'],
    blurb: 'The Black Network. Profit first, questions never. Halia Thornton runs their business out of the Miner’s Exchange.',
  },
];

function factionRank(fid, value) {
  const f = FACTIONS.find((x) => x.id === fid);
  const v = num(value, 0);
  let tier = 0;
  for (let i = 0; i < REP_RANKS.length; i++) if (v >= num(REP_RANKS[i].at, 0)) tier = i;
  if (!f || tier <= 0) return safe(() => repRank(v), 'Unknown') || 'Unknown';
  const names = f.ranks;
  return names[Math.min(tier - 1, names.length - 1)] + (tier > names.length ? ' (Exalted)' : '');
}
function nextRepAt(value) {
  const v = num(value, 0);
  for (const r of REP_RANKS) if (v < num(r.at, 0)) return num(r.at, 0);
  return num(REP_RANKS[REP_RANKS.length - 1].at, 150);
}

function questDef(q) {
  if (!q) return null;
  return q.def || QUESTS()[q.id] || null;
}
function giverName(q) {
  const d = questDef(q);
  const id = (q && q.giver) || (d && d.giver) || '';
  if (!id) return 'Unknown';
  const npc = NPCS()[id];
  return (npc && npc.name) || titleCase(String(id).replace(/-/g, ' '));
}
function questFaction(q) {
  const d = questDef(q);
  return (q && q.faction) || (d && d.faction) || null;
}

export class JournalScene extends MenuScene {
  constructor(opts = {}) {
    super('journal');
    this.opts = opts || {};
    this.tab = Math.max(0, JOURNAL_TABS.findIndex((t) => t.id === opts.tab));
    if (this.tab < 0) this.tab = 0;
    this.index = [0, 0, 0, 0, 0];
    this.top = [0, 0, 0, 0, 0];
    this.scroll = 0;
    this.entries = [];
    this.rowRects = [];
    this.tabRects = [];
  }

  _build() {
    const st = S();
    const id = JOURNAL_TABS[this.tab].id;
    const out = [];
    if (!st) { this.entries = out; return out; }

    if (id === 'active' || id === 'contracts') {
      for (const q of arr(st.quests && st.quests.active)) {
        const fac = questFaction(q);
        if (id === 'contracts' && !fac) continue;
        if (id === 'active' && fac && q.generated) continue;   // contracts live on their own tab
        out.push({ kind: 'quest', q, id: q.id, label: q.title || titleCase(String(q.id).replace(/-/g, ' ')) });
      }
    } else if (id === 'done') {
      for (const qid of arr(st.quests && st.quests.done)) {
        const d = QUESTS()[qid] || null;
        out.push({ kind: 'quest', q: { id: qid, title: (d && d.title) || titleCase(String(qid).replace(/-/g, ' ')), steps: [], done: true }, id: qid, label: (d && d.title) || titleCase(String(qid).replace(/-/g, ' ')) });
      }
      for (const qid of arr(st.quests && st.quests.failed)) {
        const d = QUESTS()[qid] || null;
        out.push({ kind: 'quest', failed: true, q: { id: qid, title: (d && d.title) || titleCase(String(qid).replace(/-/g, ' ')), steps: [] }, id: qid, label: (d && d.title) || titleCase(String(qid).replace(/-/g, ' ')) });
      }
    } else if (id === 'lore') {
      const T = TABLES();
      for (const e of arr(st.lore)) {
        if (typeof e === 'string') {
          const book = (T.BOOK_TEXTS && T.BOOK_TEXTS[e]) || null;
          out.push({
            kind: 'lore', id: e, label: (book && book.title) || titleCase(String(e).replace(/-/g, ' ')),
            body: (book && (book.text || book.body)) || 'You remember reading this somewhere on the road.',
            tag: 'Read',
          });
        } else if (e && typeof e === 'object') {
          out.push({ kind: 'lore', id: e.id || e.title, label: e.title || titleCase(String(e.id || 'note')), body: e.text || e.body || '', tag: titleCase(String(e.kind || 'Note')) });
        }
      }
      for (const r of arr(st.rumors)) {
        const text = typeof r === 'string' ? r : (r && (r.text || r.body)) || '';
        if (!text) continue;
        out.push({ kind: 'lore', id: `rumour-${out.length}`, label: 'A rumour in the taproom', body: text, tag: 'Heard' });
      }
      const best = (st.bestiary && Object.keys(st.bestiary)) || [];
      for (const mid of best) {
        const m = MONSTERS[mid];
        if (!m) continue;
        out.push({
          kind: 'lore', id: `beast-${mid}`, label: m.name,
          body: `${safe(() => statLine(m), '')}\n\n${m.desc || 'You have fought one of these and lived to write it down.'}\n\nSlain: ${num(st.bestiary[mid], 0)}.`,
          tag: 'Bestiary',
        });
      }
      if (!out.length) out.push({ kind: 'empty', label: 'Nothing written yet', body: 'Read a book, listen in a taproom, or kill something memorable.' });
    } else if (id === 'factions') {
      for (const f of FACTIONS) {
        out.push({ kind: 'faction', id: f.id, f, label: f.name, value: num(st.reputation && st.reputation[f.id], 0) });
      }
    }
    this.entries = out;
    return out;
  }

  update(dt) {
    if (this.tick(dt)) return;
    const list = this._build();

    const before = this.tab;
    this.tab = navPage(this.tab, JOURNAL_TABS.length);
    const tp = tabPressed(5);
    if (tp >= 0) this.tab = tp;
    if (this.tab !== before) { this.scroll = 0; return; }

    const m = Input.mouse;
    for (const r of this.tabRects) {
      if (clicked(m, r.x, r.y, r.w, r.h)) { this.tab = r.i; this.scroll = 0; sfx('cursor'); return; }
    }

    if (listNavActive()) {
      const b = this.index[this.tab];
      this.index[this.tab] = navV(this.index[this.tab], list.length);
      if (this.index[this.tab] !== b) this.scroll = 0;
    }
    this.scroll = scrollPane(this.scroll, this._maxScroll || 0, m, this._paneRect);

    for (const r of this.rowRects) {
      if (hit(m, r.x, r.y, r.w, r.h)) {
        if (this.index[this.tab] !== r.i) { this.index[this.tab] = r.i; this.scroll = 0; sfx('cursor'); }
        if (clicked(m, r.x, r.y, r.w, r.h)) { this._toggleTrack(); return; }
      }
    }

    if (Input.consume('confirm') || Input.consume('interact')) { this._toggleTrack(); return; }
    if (Input.consume('cancel') || Input.consume('journal')) this.close();
  }

  _sel() { return this.entries[clamp(this.index[this.tab], 0, Math.max(0, this.entries.length - 1))] || null; }

  _toggleTrack() {
    const e = this._sel();
    const st = S();
    if (!st || !e || e.kind !== 'quest' || e.q.done || e.failed) { sfx('error'); return; }
    if (st.quests.tracked === e.q.id) { st.quests.tracked = null; sfx('back'); this.say('No longer tracked.'); }
    else { st.quests.tracked = e.q.id; sfx('quest'); this.say(`Tracking "${e.q.title || e.q.id}".`); }
  }

  // --- drawing ------------------------------------------------------------

  draw(ctx) {
    ctx.fillStyle = C.bgDeep;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.rowRects = [];
    this.tabRects = [];
    const list = this.entries.length ? this.entries : this._build();
    const st = S();

    UI.panel(ctx, 2, 2, VIEW_W - 4, 13, { style: 'dark' });
    txt(ctx, 8, 4, 'JOURNAL', { size: 'md', color: C.gold, shadow: true });
    if (st) {
      const q = trackedQuest(st);
      txtR(ctx, VIEW_W - 8, 5, q ? `Tracking: ${q.title || q.id}` : 'Nothing tracked', {
        size: 'sm', color: q ? C.goldBright : C.disabled, shadow: true, maxWidth: 250,
      });
    }

    UI.tabs(ctx, 2, 17, VIEW_W - 4, JOURNAL_TABS.map((t) => ({ label: t.label, icon: t.icon })), this.tab, {});
    const tw = Math.floor((VIEW_W - 4) / JOURNAL_TABS.length);
    for (let i = 0; i < JOURNAL_TABS.length; i++) this.tabRects.push({ x: 2 + i * tw, y: 17, w: tw, h: 13, i });

    const LX = 3, LY = 33, LW = 158, LH = CONTENT_BOTTOM - 33;
    UI.panel(ctx, LX, LY, LW, LH, { style: 'window' });
    const rowH = 12, rows = 14;
    const sel = clamp(this.index[this.tab], 0, Math.max(0, list.length - 1));
    let top = this.top[this.tab];
    if (sel < top) top = sel;
    if (sel > top + rows - 1) top = sel - rows + 1;
    this.top[this.tab] = top = clamp(top, 0, Math.max(0, list.length - rows));

    if (!list.length) {
      txtC(ctx, LX + LW / 2, LY + 80, 'Nothing here.', { size: 'sm', color: C.disabled });
    }
    UI.pushClip(ctx, LX + 2, LY + 3, LW - 4, rowH * rows + 2);
    for (let i = 0; i < rows && top + i < list.length; i++) {
      const idx = top + i;
      const e = list[idx];
      const ry = LY + 5 + i * rowH;
      const on = idx === sel;
      if (on) UI.highlight(ctx, LX + 3, ry - 1, LW - 8, rowH, { alpha: 0.2 });
      let col = on ? C.goldBright : C.ink;
      let mark = '';
      if (e.kind === 'quest') {
        const tracked = st && st.quests && st.quests.tracked === e.q.id;
        if (e.failed) { col = C.bad; mark = '✗'; }
        else if (e.q.done) { col = C.good; mark = '✓'; }
        else if (tracked) mark = '★';
      } else if (e.kind === 'faction') {
        col = on ? C.goldBright : (e.f.color || C.ink);
      }
      if (mark) txt(ctx, LX + 7, ry, mark, { size: 'sm', color: col, shadow: true });
      txt(ctx, LX + 16, ry, e.label, { size: on ? 'md' : 'sm', color: col, shadow: true, maxWidth: LW - 24 });
      if (e.kind === 'lore' && e.tag) txtR(ctx, LX + LW - 6, ry, e.tag, { size: 'sm', color: C.disabled, shadow: true });
      if (e.kind === 'faction') txtR(ctx, LX + LW - 6, ry, String(num(e.value, 0)), { size: 'sm', color: C.goldDim, shadow: true });
      if (on) UI.cursor(ctx, LX + 2, ry, this.t);
      this.rowRects.push({ x: LX + 3, y: ry - 1, w: LW - 8, h: rowH, i: idx });
    }
    UI.popClip(ctx);
    if (list.length > rows) scrollHint(ctx, LX + LW - 4, LY + 4, rowH * rows, top, rows, list.length);

    const DX = 165, DW = VIEW_W - DX - 3;
    UI.panel(ctx, DX, LY, DW, LH, { style: 'window' });
    this._paneRect = { x: DX, y: LY, w: DW, h: LH };
    const e = list[sel] || null;
    if (!e) { /* nothing */ }
    else if (e.kind === 'quest') this._drawQuest(ctx, e, DX + 7, LY + 5, DW - 14, LH - 10);
    else if (e.kind === 'faction') this._drawFaction(ctx, e, DX + 7, LY + 5, DW - 14, LH - 10);
    else this._drawLore(ctx, e, DX + 7, LY + 5, DW - 14, LH - 10);

    this.drawMessage(ctx, 6, MSG_Y, VIEW_W - 12);
    hintBar(ctx, HINT_Y, [
      [keyFor('cancel'), 'Back'], [keyFor('confirm'), 'Track'],
      [`${keyFor('prev')}/${keyFor('next')}`, 'Tab'], ['1-5', 'Jump'], [keyFor('run'), 'Scroll'],
    ]);
    this.drawPrompt(ctx);
  }

  _drawQuest(ctx, e, x, y, w, h) {
    const st = S();
    const q = e.q;
    const d = questDef(q);
    txt(ctx, x, y, q.title || titleCase(String(q.id).replace(/-/g, ' ')), {
      size: 'md', color: e.failed ? C.bad : (q.done ? C.good : C.gold), shadow: true, maxWidth: w,
    });
    txt(ctx, x, y + 11, `Given by ${giverName(q)}`, { size: 'sm', color: C.inkDim, shadow: true, maxWidth: w });
    let cx = x, cy = y + 21;
    const fac = questFaction(q);
    if (fac) {
      const f = FACTIONS.find((z) => z.id === fac);
      cx += (safe(() => UI.chip(ctx, cx, cy, (f && f.name) || titleCase(fac), { color: (f && f.color) || C.blue }), 0) || 0) + 3;
    }
    if (d && d.type) cx += (safe(() => UI.chip(ctx, cx, cy, titleCase(d.type), { color: C.goldDim }), 0) || 0) + 3;
    if (d && d.minLevel) cx += (safe(() => UI.chip(ctx, cx, cy, `Lv ${d.minLevel}+`, { color: C.warn }), 0) || 0) + 3;
    if (st && st.quests && st.quests.tracked === q.id) safe(() => UI.chip(ctx, cx, cy, 'Tracked', { color: C.goldBright }));
    cy += 13;

    const desc = (d && d.desc) || q.desc || '';
    if (desc) {
      const r = UI.textWrapped(ctx, x, cy, w, desc, { size: 'sm', color: C.ink, maxLines: 4 });
      cy += r.height + 4;
    }

    cy = sectionHead(ctx, x, cy, w, 'OBJECTIVES');
    const steps = arr(q.steps);
    if (!steps.length) {
      txt(ctx, x, cy, e.failed ? 'Abandoned.' : q.done ? 'All done.' : 'No steps recorded.', {
        size: 'sm', color: C.inkDim, shadow: true, maxWidth: w,
      });
      cy += 10;
    }
    for (const s of steps.slice(0, 6)) {
      const done = !!s.done;
      txt(ctx, x, cy, done ? '✓' : '○', { size: 'sm', color: done ? C.good : C.disabled, shadow: true });
      txt(ctx, x + 9, cy, stepText(s), {
        size: 'sm', color: done ? C.inkDim : C.ink, shadow: true, maxWidth: w - 44,
      });
      const count = num(s.count, 1);
      if (count > 1) {
        txtR(ctx, x + w, cy, `${num(s.progress, 0)}/${count}`, { size: 'sm', color: done ? C.good : C.goldDim, shadow: true });
      }
      cy += 10;
    }

    cy += 2;
    cy = sectionHead(ctx, x, cy, w, 'REWARD');
    const rw = (d && d.rewards) || q.rewards || null;
    if (!rw) {
      txt(ctx, x, cy, 'Whatever you can carry out.', { size: 'sm', color: C.inkDim, shadow: true, maxWidth: w });
    } else {
      const bits = [];
      if (num(rw.xp, 0)) bits.push(`${rw.xp} XP`);
      if (num(rw.gold, 0)) bits.push(goldText(rw.gold));
      for (const i of arr(rw.items)) {
        const iid = Array.isArray(i) ? i[0] : (i && i.id) || i;
        bits.push(itemName(iid, safe(() => resolveItem(iid), null)));
      }
      if (num(rw.reputation, 0) && fac) bits.push(`${signed(rw.reputation)} standing`);
      const r = UI.textWrapped(ctx, x, cy, w, bits.join(' · ') || 'Coin and goodwill.', { size: 'sm', color: C.gold, maxLines: 2 });
      cy += r.height;
    }
    if (q.startedDay) {
      txt(ctx, x, y + h - 9, `Taken on ${dateText(num(q.startedDay, 1))}`, { size: 'sm', color: C.disabled, shadow: true, maxWidth: w });
    }
    this._maxScroll = 0;
  }

  _drawLore(ctx, e, x, y, w, h) {
    txt(ctx, x, y, e.label, { size: 'md', color: C.gold, shadow: true, maxWidth: w });
    if (e.tag) safe(() => UI.chip(ctx, x, y + 12, e.tag, { color: C.blue }));
    const ty = y + 26;
    const lines = UI.wrapLines(String(e.body || ''), w, 'sm');
    const avail = Math.max(1, Math.floor((y + h - ty) / 9));
    this._maxScroll = Math.max(0, lines.length - avail);
    const off = clamp(R(this.scroll), 0, this._maxScroll);
    UI.pushClip(ctx, x - 2, ty - 1, w + 4, y + h - ty + 1);
    for (let i = 0; i < avail && off + i < lines.length; i++) {
      txt(ctx, x, ty + i * 9, lines[off + i], { size: 'sm', color: C.ink, shadow: true });
    }
    UI.popClip(ctx);
    if (this._maxScroll > 0) {
      if (off > 0) txtR(ctx, x + w, ty - 8, '▲', { size: 'sm', color: C.goldDim });
      if (off < this._maxScroll) txtR(ctx, x + w, y + h - 7, '▼', { size: 'sm', color: C.goldDim });
    }
  }

  _drawFaction(ctx, e, x, y, w, h) {
    const f = e.f;
    const v = num(e.value, 0);
    txt(ctx, x, y, f.name, { size: 'md', color: f.color, shadow: true, maxWidth: w });
    const rank = factionRank(f.id, v);
    txt(ctx, x, y + 12, `Standing: ${rank}`, { size: 'sm', color: C.goldBright, shadow: true, maxWidth: w });
    const next = nextRepAt(v);
    UI.bar(ctx, x, y + 23, w, 7, next > 0 ? clamp(v / next, 0, 1) : 1, {
      color: f.color, label: `${v} / ${next}`, size: 'sm',
    });
    let ty = y + 36;
    const r = UI.textWrapped(ctx, x, ty, w, f.blurb, { size: 'sm', color: C.ink, maxLines: 4 });
    ty += r.height + 6;

    ty = sectionHead(ctx, x, ty, w, 'RANKS');
    f.ranks.forEach((name, i) => {
      const at = num(REP_RANKS[i + 1] && REP_RANKS[i + 1].at, (i + 1) * 25);
      const held = v >= at;
      txt(ctx, x, ty + i * 10, held ? '✓' : '○', { size: 'sm', color: held ? C.good : C.disabled, shadow: true });
      txt(ctx, x + 9, ty + i * 10, name, { size: 'sm', color: held ? C.ink : C.inkDim, shadow: true, maxWidth: w - 40 });
      txtR(ctx, x + w, ty + i * 10, String(at), { size: 'sm', color: C.disabled, shadow: true });
    });
    ty += f.ranks.length * 10 + 4;
    const st = S();
    const contracts = st ? arr(st.quests && st.quests.active).filter((q) => questFaction(q) === f.id).length : 0;
    txt(ctx, x, ty, contracts ? `${contracts} contract${contracts === 1 ? '' : 's'} in hand.` : 'No contracts in hand.', {
      size: 'sm', color: contracts ? C.goldBright : C.disabled, shadow: true, maxWidth: w,
    });
    this._maxScroll = 0;
  }
}

// ===========================================================================
// 7. MAP
// ===========================================================================

/**
 * Named Sword Coast sites, positioned in normalised map space. If world/maps.js
 * ships real coordinates we use those instead; this table is only the fallback so
 * the screen is never blank.
 */
const SWORD_COAST_SITES = [
  { id: 'neverwinter', name: 'Neverwinter', nx: 0.15, ny: 0.24, level: 10, town: true },
  { id: 'neverwinter-wood', name: 'Neverwinter Wood', nx: 0.30, ny: 0.20, level: 3 },
  { id: 'thundertree', name: 'Thundertree', nx: 0.35, ny: 0.29, level: 4 },
  { id: 'icespire-peak', name: 'Icespire Peak', nx: 0.44, ny: 0.09, level: 8 },
  { id: 'cragmaw-castle', name: 'Cragmaw Castle', nx: 0.52, ny: 0.17, level: 6 },
  { id: 'old-owl-well', name: 'Old Owl Well', nx: 0.72, ny: 0.24, level: 5 },
  { id: 'conyberry-ruins', name: 'Conyberry', nx: 0.78, ny: 0.33, level: 4 },
  { id: 'wyvern-tor', name: 'Wyvern Tor', nx: 0.66, ny: 0.33, level: 5 },
  { id: 'cragmaw-hideout', name: 'Cragmaw Hideout', nx: 0.44, ny: 0.39, level: 2 },
  { id: 'triboar-trail', name: 'Triboar Trail', nx: 0.62, ny: 0.43, level: 2 },
  { id: 'phandalin', name: 'Phandalin', nx: 0.52, ny: 0.50, level: 1, town: true },
  { id: 'wave-echo-cave', name: 'Wave Echo Cave', nx: 0.62, ny: 0.59, level: 7 },
  { id: 'leilon', name: 'Leilon', nx: 0.23, ny: 0.55, level: 6, town: true },
  { id: 'kryptgarden-forest', name: 'Kryptgarden Forest', nx: 0.80, ny: 0.62, level: 9 },
  { id: 'mere-of-dead-men', name: 'Mere of Dead Men', nx: 0.19, ny: 0.71, level: 8 },
  { id: 'waterdeep', name: 'Waterdeep', nx: 0.40, ny: 0.90, level: 12, town: true },
  { id: 'undermountain', name: 'Undermountain', nx: 0.46, ny: 0.96, level: 14 },
];

/** Sites from world/maps.js if it exposes any, otherwise the fallback table. */
function worldSites() {
  const m = LATE.maps;
  const raw = m && (m.WORLD_SITES || m.WORLD_LOCATIONS || m.WORLD_NODES);
  if (raw) {
    const list = Array.isArray(raw) ? raw : Object.keys(raw).map((k) => ({ id: k, ...(raw[k] || {}) }));
    const usable = list.filter((s) => s && s.name && (Number.isFinite(s.x) || Number.isFinite(s.nx)));
    if (usable.length) return usable;
  }
  return SWORD_COAST_SITES;
}

const TF_SOLID = 1, TF_WATER = 2, TF_DOOR = 8;

function tileColor(map, x, y) {
  let flags = 0, solid = false;
  try { flags = map.flagAt ? map.flagAt(x, y) | 0 : 0; } catch (e) { flags = 0; }
  try { solid = map.solid ? !!map.solid(x, y) : !!(flags & TF_SOLID); } catch (e) { solid = !!(flags & TF_SOLID); }
  if (flags & TF_WATER) return '#2c5a8a';
  if (flags & TF_DOOR) return '#c08a3a';
  if (solid) return '#4a4a58';
  const biome = String((map && map.biome) || 'plains');
  if (biome === 'cave' || biome === 'dungeon' || biome === 'mine' || biome === 'crypt') return '#3a3630';
  if (biome === 'city') return '#5a5040';
  if (biome === 'marsh') return '#3a4a38';
  if (biome === 'tundra') return '#8f9fae';
  if (biome === 'ash-waste') return '#54504c';
  if (biome === 'mountain' || biome === 'hills') return '#5a5244';
  return '#2f4030';
}

export class MapScene extends MenuScene {
  constructor(opts = {}) {
    super('map');
    this.opts = opts || {};
    this.map = currentMap();
    this.cam = { x: 0, y: 0 };
    this.site = 0;
    this.sites = [];
    this.siteRects = [];
    this._centred = false;
  }

  get isWorld() {
    const st = S();
    const id = String((st && st.mapId) || '');
    if (this.map && (this.map.kind === 'world' || this.map.world)) return true;
    return /world|overworld|sword-coast|region/.test(id);
  }

  enter(prev) {
    super.enter(prev);
    this.map = currentMap();
    this._centred = false;
    if (this.isWorld) this.sites = this._visibleSites();
  }

  _visibleSites() {
    const st = S();
    const all = worldSites();
    return all.map((s) => {
      const known = !st || !!(st.visited && st.visited[s.id]) || s.id === (st && st.mapId);
      return { ...s, known };
    });
  }

  update(dt) {
    if (this.tick(dt)) return;
    const st = S();

    if (this.isWorld && this.sites.length) {
      const before = this.site;
      this.site = navV(this.site, this.sites.length);
      if (this.site !== before) return;
      const m = Input.mouse;
      for (const r of this.siteRects) {
        if (hit(m, r.x - 4, r.y - 4, 9, 9)) {
          if (this.site !== r.i) { this.site = r.i; sfx('cursor'); }
          if (clicked(m, r.x - 4, r.y - 4, 9, 9)) { this._fastTravel(); return; }
        }
      }
      if (Input.consume('confirm')) { this._fastTravel(); return; }
    } else {
      // Panning the local map.
      const d = Input.dir();
      if (d.x || d.y) { this.cam.x += d.x * 40 * dt; this.cam.y += d.y * 40 * dt; }
      if (Input.consume('interact')) { this._centred = false; sfx('cursor'); }
    }

    void st;
    if (Input.consume('cancel') || Input.consume('map')) this.close();
  }

  _fastTravel() {
    const site = this.sites[this.site];
    const st = S();
    if (!site) { sfx('error'); return; }
    if (!site.known) { this.say(`${site.name} is only a rumour so far.`, true); return; }
    if (st && st.mapId === site.id) { this.say('You are already there.', true); return; }
    if (!site.town) { this.say(`${site.name} is no place to walk into unannounced — travel there on foot.`, true, 3.6); return; }
    const hours = this._travelHours(site);
    this.ask(`Travel to ${site.name}?`, `About ${hours} hours on the road. Suggested party level ${site.level}.`, [
      { label: 'Set out', value: 'go' },
      { label: 'Stay put', value: null },
    ], (v) => {
      if (v !== 'go') return;
      if (st) safe(() => advanceTime(st, hours * 60));
      softImport('../world/overworld.js', 'overworld').then((ow) => {
        const go = ow && ow.travelTo;
        if (go) {
          Game.transition('fade', () => {
            // Only pass tile coordinates when the site actually carries them;
            // otherwise let the destination map use its own spawn point.
            safe(() => (Number.isFinite(site.tx) && Number.isFinite(site.ty)
              ? go(site.id, site.tx, site.ty, 'down')
              : go(site.id)));
            if (Game.top === this) Game.pop();
          });
        } else if (st) {
          st.mapId = site.id;
          st.lastTown = site.town ? site.id : st.lastTown;
          safe(() => toast(`The road takes you to ${site.name}.`));
          this.close();
        } else this.say('There is no road from here.', true);
      });
    });
  }

  _travelHours(site) {
    const st = S();
    const from = this.sites.find((s) => s.id === (st && st.mapId)) || null;
    if (!from) return 8;
    const dx = num(site.nx, 0.5) - num(from.nx, 0.5);
    const dy = num(site.ny, 0.5) - num(from.ny, 0.5);
    return clamp(Math.round(Math.hypot(dx, dy) * 60), 2, 72);
  }

  // --- drawing ------------------------------------------------------------

  draw(ctx) {
    ctx.fillStyle = C.bgDeep;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const st = S();
    this.siteRects = [];

    UI.panel(ctx, 2, 2, VIEW_W - 4, 13, { style: 'dark' });
    const map = this.map;
    const region = (map && map.name) || prettyMapName(st && st.mapId);
    txt(ctx, 8, 4, region.toUpperCase(), { size: 'md', color: C.gold, shadow: true, maxWidth: 220 });
    if (st) {
      const ti = safe(() => timeInfo(st), null) || {};
      txtR(ctx, VIEW_W - 8, 5, `${ti.date || ''} · ${ti.clock || ''}`, { size: 'sm', color: C.inkDim, shadow: true, maxWidth: 160 });
    }

    const AX = 3, AY = 18, AW = VIEW_W - 6, AH = 185;
    UI.panel(ctx, AX, AY, AW, AH, { style: 'inset' });
    const in_ = { x: AX + 3, y: AY + 3, w: AW - 6, h: AH - 6 };

    if (!map) {
      txtC(ctx, VIEW_W / 2, AY + 80, 'No survey of this place exists.', { size: 'md', color: C.inkDim });
      txtC(ctx, VIEW_W / 2, AY + 94, 'Walk it, and the map will fill itself in.', { size: 'sm', color: C.disabled });
    } else {
      this._drawTiles(ctx, map, in_);
      if (this.isWorld) this._drawSites(ctx, in_);
    }

    this._drawLegend(ctx, 3, 205);
    hintBar(ctx, HINT_Y, this.isWorld
      ? [[keyFor('cancel'), 'Back'], [`${keyFor('up')}${keyFor('down')}`, 'Site'], [keyFor('confirm'), 'Travel']]
      : [[keyFor('cancel'), 'Back'], ['ARROWS', 'Pan'], [keyFor('interact'), 'Centre']]);
    this.drawStatusRight(ctx);
    this.drawPrompt(ctx);
  }

  _drawTiles(ctx, map, in_) {
    const st = S() || {};
    const mw = num(map.w || map.width, 0), mh = num(map.h || map.height, 0);
    if (!mw || !mh) {
      txtC(ctx, in_.x + in_.w / 2, in_.y + in_.h / 2 - 4, 'This map has no shape yet.', { size: 'sm', color: C.disabled });
      return;
    }
    let scale = Math.floor(Math.min(in_.w / mw, in_.h / mh));
    const panning = scale < 1;
    if (scale < 1) scale = 1;
    scale = Math.min(scale, 6);

    const viewW = Math.min(in_.w, mw * scale);
    const viewH = Math.min(in_.h, mh * scale);
    const ox = R(in_.x + (in_.w - viewW) / 2);
    const oy = R(in_.y + (in_.h - viewH) / 2);

    if (!this._centred) {
      this.cam.x = clamp(num(st.x, mw / 2) - viewW / (2 * scale), 0, Math.max(0, mw - viewW / scale));
      this.cam.y = clamp(num(st.y, mh / 2) - viewH / (2 * scale), 0, Math.max(0, mh - viewH / scale));
      this._centred = true;
    }
    if (panning) {
      this.cam.x = clamp(this.cam.x, 0, Math.max(0, mw - viewW / scale));
      this.cam.y = clamp(this.cam.y, 0, Math.max(0, mh - viewH / scale));
    } else { this.cam.x = 0; this.cam.y = 0; }

    // Explored tiles only.
    let disc = null;
    const raw = st.discovered && st.discovered[st.mapId];
    if (raw) disc = raw instanceof Set ? raw : (Array.isArray(raw) ? new Set(raw) : null);

    UI.pushClip(ctx, ox, oy, viewW, viewH);
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(ox, oy, viewW, viewH);
    const cols = Math.ceil(viewW / scale), rowsN = Math.ceil(viewH / scale);
    const bx = Math.floor(this.cam.x), by = Math.floor(this.cam.y);
    for (let ry = 0; ry < rowsN; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        const tx = bx + rx, ty = by + ry;
        if (tx < 0 || ty < 0 || tx >= mw || ty >= mh) continue;
        if (disc && !disc.has(`${tx},${ty}`)) continue;
        ctx.fillStyle = tileColor(map, tx, ty);
        ctx.fillRect(ox + rx * scale, oy + ry * scale, scale, scale);
      }
    }

    const plot = (tx, ty) => ({ x: ox + (tx - bx) * scale + Math.floor(scale / 2), y: oy + (ty - by) * scale + Math.floor(scale / 2) });

    // Warps and doors.
    for (const tg of arr(map.triggers)) {
      if (!tg) continue;
      const k = String(tg.kind || '');
      if (k !== 'warp' && k !== 'door' && k !== 'inn' && k !== 'shop' && k !== 'chest') continue;
      if (disc && !disc.has(`${tg.x},${tg.y}`)) continue;
      const p = plot(num(tg.x, 0), num(tg.y, 0));
      ctx.fillStyle = k === 'warp' ? '#7fe08a' : k === 'chest' ? '#e0b040' : '#e0c060';
      ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
    }
    // Living things.
    for (const e of arr(map.entities)) {
      if (!e || e.hidden) continue;
      if (disc && !disc.has(`${Math.round(num(e.x, 0))},${Math.round(num(e.y, 0))}`)) continue;
      const p = plot(Math.round(num(e.x, 0)), Math.round(num(e.y, 0)));
      const k = String(e.kind || '');
      if (k === 'monster') ctx.fillStyle = '#e05a4a';
      else if (k === 'npc') ctx.fillStyle = '#7fd0f0';
      else if (k === 'chest') ctx.fillStyle = '#e0b040';
      else continue;
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    // The party.
    const p = plot(Math.round(num(st.x, 0)), Math.round(num(st.y, 0)));
    const pulse = 0.55 + 0.45 * Math.sin(this.t * 5);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#fff2c0';
    ctx.fillRect(p.x - 2, p.y - 2, 5, 5);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.gold;
    ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
    UI.popClip(ctx);

    if (panning) {
      txtR(ctx, in_.x + in_.w - 2, in_.y + in_.h - 8, `${mw}x${mh} — arrows to pan`, { size: 'sm', color: C.disabled, shadow: true });
    }
  }

  _drawSites(ctx, in_) {
    this.sites = this.sites.length ? this.sites : this._visibleSites();
    const st = S() || {};
    this.sites.forEach((s, i) => {
      const px = R(in_.x + clamp(num(s.nx, 0.5), 0, 1) * (in_.w - 8)) + 4;
      const py = R(in_.y + clamp(num(s.ny, 0.5), 0, 1) * (in_.h - 8)) + 4;
      this.siteRects.push({ x: px, y: py, i });
      const on = i === this.site;
      const here = st.mapId === s.id;
      const col = !s.known ? C.disabled : here ? C.goldBright : s.town ? C.gold : C.blue;
      ctx.fillStyle = '#0a0708';
      ctx.fillRect(px - 3, py - 3, 6, 6);
      ctx.fillStyle = col;
      ctx.fillRect(px - 2, py - 2, 4, 4);
      if (s.known) {
        const label = `${s.name}`;
        const lw = UI.measure(label, 'sm');
        const lx = clamp(px + 5, in_.x, in_.x + in_.w - lw - 2);
        txt(ctx, lx, py - 3, label, { size: on ? 'md' : 'sm', color: on ? C.goldBright : C.ink, outline: true });
        if (on) txt(ctx, lx, py + 6, `Suggested Lv ${s.level}`, { size: 'sm', color: C.warn, outline: true });
      } else if (on) {
        txt(ctx, px + 5, py - 3, '???', { size: 'sm', color: C.disabled, outline: true });
      }
      if (on) UI.frameSel(ctx, px - 5, py - 5, 10, 10, this.t);
    });
  }

  _drawLegend(ctx, x, y) {
    UI.panel(ctx, x, y, VIEW_W - x * 2, 14, { style: 'dark' });
    const items = this.isWorld
      ? [['Town', C.gold], ['Site', C.blue], ['Unknown', C.disabled], ['You', '#fff2c0']]
      : [['You', '#fff2c0'], ['Warp', '#7fe08a'], ['Door', '#e0c060'], ['Friend', '#7fd0f0'], ['Foe', '#e05a4a'], ['Water', '#2c5a8a'], ['Wall', '#4a4a58']];
    let cx = x + 6;
    for (const [label, col] of items) {
      ctx.fillStyle = col;
      ctx.fillRect(R(cx), R(y + 5), 4, 4);
      txt(ctx, cx + 7, y + 4, label, { size: 'sm', color: C.inkDim, shadow: true });
      cx += 9 + UI.measure(label, 'sm') + 8;
      if (cx > VIEW_W - 30) break;
    }
  }
}

// ===========================================================================
// 8. OPTIONS
// ===========================================================================

const OPT_GROUPS = [
  { id: 'audio', label: 'Audio', icon: 'mana' },
  { id: 'display', label: 'Display', icon: 'eye' },
  { id: 'combat', label: 'Combat', icon: 'sword' },
  { id: 'controls', label: 'Controls', icon: 'anvil' },
];

const SETTING_DESC = {
  volMaster: 'Overall loudness of everything the game plays.',
  volMusic: 'The chiptune score: town themes, field marches, battle music.',
  volSfx: 'Blips, blades, spells and the clatter of dice.',
  muted: 'Silence the game entirely without losing your volume levels.',
  textSpeed: 'How fast dialogue types itself out. Instant prints the whole line at once.',
  scale: 'How many screen pixels each game pixel takes. Auto fits the window.',
  showGrid: 'Draw the five-foot grid over the battlefield.',
  showDamageNumbers: 'Float damage and healing numbers over creatures as they are hit.',
  showRolls: 'Pop the big d20 up for attack rolls and saving throws.',
  screenShake: 'Shake the screen on critical hits and heavy blows.',
  reducedMotion: 'Cut particles, shake and flashes back to a minimum.',
  colorblind: 'Shift the palette for protanopia, deuteranopia or tritanopia.',
  autoEndTurn: 'End a turn automatically once nothing useful is left to do.',
  battleSpeed: 'Multiplier on battle animations. Higher is faster.',
  difficulty: 'Enemy numbers and damage. Story is forgiving; Deadly is not.',
};

const ACTION_LABELS = {
  up: 'Move Up', down: 'Move Down', left: 'Move Left', right: 'Move Right',
  confirm: 'Confirm', cancel: 'Cancel / Back', menu: 'Pause Menu', run: 'Run / Scroll',
  interact: 'Interact', map: 'Map', journal: 'Journal', party: 'Party Sheet',
  inventory: 'Inventory', next: 'Next Page', prev: 'Previous Page',
  tab1: 'Shortcut 1', tab2: 'Shortcut 2', tab3: 'Shortcut 3', tab4: 'Shortcut 4', tab5: 'Shortcut 5',
};

export class OptionsScene extends MenuScene {
  constructor(opts = {}) {
    super('options');
    this.opts = opts || {};
    this.group = 0;
    this.index = [0, 0, 0, 0];
    this.top = [0, 0, 0, 0];
    this.rebind = null;      // { action } while listening for a key
    this.rows = [];
    this.rowRects = [];
    this.tabRects = [];
  }

  _build() {
    const gid = OPT_GROUPS[this.group].id;
    const spec = safe(() => Save.SETTING_SPEC, null) || {};
    const out = [];
    if (gid === 'controls') {
      for (const a of arr(safe(() => Input.ACTIONS, []))) {
        if (a === 'debug') continue;
        out.push({ kind: 'bind', action: a, label: ACTION_LABELS[a] || titleCase(a) });
      }
    } else {
      for (const key of Object.keys(spec)) {
        const s = spec[key];
        if (!s || s.group !== gid || s.kind === 'custom') continue;
        out.push({ kind: s.kind, key, label: s.name || titleCase(key), spec: s });
      }
    }
    out.push({ kind: 'reset', label: gid === 'controls' ? 'Restore Default Keys' : 'Reset to Defaults' });
    this.rows = out;
    return out;
  }

  update(dt) {
    if (this.tick(dt)) return;
    if (this.rebind) {
      // Input.beginRebind swallows the next key; ESC there fires the callback with null.
      if (!Input.rebinding) this.rebind = null;
      return;
    }
    const rows = this._build();

    const g0 = this.group;
    this.group = navPage(this.group, OPT_GROUPS.length);
    const tp = tabPressed(4);
    if (tp >= 0) this.group = tp;
    if (this.group !== g0) return;

    const m = Input.mouse;
    for (const r of this.tabRects) {
      if (clicked(m, r.x, r.y, r.w, r.h)) { this.group = r.i; sfx('cursor'); return; }
    }

    this.index[this.group] = navV(this.index[this.group], rows.length);
    const row = rows[this.index[this.group]];

    for (const r of this.rowRects) {
      if (hit(m, r.x, r.y, r.w, r.h)) {
        if (this.index[this.group] !== r.i) { this.index[this.group] = r.i; sfx('cursor'); }
        if (clicked(m, r.x, r.y, r.w, r.h)) { this._activate(rows[r.i]); return; }
      }
    }

    if (row && (row.kind === 'range' || row.kind === 'enum' || row.kind === 'bool')) {
      if (Input.repeatConsume('left')) this._cycle(row, -1);
      if (Input.repeatConsume('right')) this._cycle(row, 1);
    }
    if (Input.consume('confirm')) { this._activate(row); return; }
    if (Input.consume('cancel')) this.close();
  }

  _activate(row) {
    if (!row) return;
    if (row.kind === 'bool') { this._cycle(row, 1); return; }
    if (row.kind === 'enum' || row.kind === 'range') { this._cycle(row, 1); return; }
    if (row.kind === 'bind') { this._beginRebind(row.action); return; }
    if (row.kind === 'reset') this._reset();
  }

  _cycle(row, dir) {
    safe(() => Save.cycleSetting(row.key, dir));
    sfx('cursor');
    this._apply();
  }

  _apply() {
    const v = safe(() => Save.volumes(), null);
    if (v) safe(() => Audio.setVolume(v.master, v.music, v.sfx));
    safe(() => { Audio.muted = !!Save.settings.muted; });
    safe(() => { FX.reducedMotion = !!Save.settings.reducedMotion; });
    safe(() => bus.emit('settings:changed', Save.settings));
  }

  _beginRebind(action) {
    this.rebind = { action };
    sfx('open');
    safe(() => Input.beginRebind(action, (code) => {
      this.rebind = null;
      if (!code) { this.say('Rebinding cancelled.'); return; }
      // Put the new key first but keep the old ones as spares.
      const prev = arr(safe(() => Input.bindings[action], []));
      const list = [code].concat(prev.filter((c) => c !== code)).slice(0, 3);
      safe(() => Input.bind(action, list));
      safe(() => Save.setSetting('bindings', Input.exportBindings()));
      sfx('select');
      this.say(`${ACTION_LABELS[action] || action} is now ${codeLabel(code)}.`);
    }));
  }

  _reset() {
    const controls = OPT_GROUPS[this.group].id === 'controls';
    this.ask(controls ? 'Restore default keys?' : 'Reset settings?',
      controls ? 'Every action goes back to its original key.' : 'Volume, speed, difficulty and accessibility go back to the defaults.',
      [{ label: 'Reset', value: 'yes', color: C.bad }, { label: 'Cancel', value: null }],
      (v) => {
        if (v !== 'yes') return;
        if (controls) {
          safe(() => Input.resetBindings());
          safe(() => Save.setSetting('bindings', Input.exportBindings()));
          this.say('Keys restored.');
        } else {
          safe(() => Save.resetSettings());
          safe(() => Input.resetBindings());
          this._apply();
          this.say('Settings restored.');
        }
        sfx('select');
      });
  }

  // --- drawing ------------------------------------------------------------

  draw(ctx) {
    ctx.fillStyle = C.bgDeep;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.rowRects = [];
    this.tabRects = [];
    const rows = this.rows.length ? this.rows : this._build();

    UI.panel(ctx, 2, 2, VIEW_W - 4, 13, { style: 'dark' });
    txt(ctx, 8, 4, 'SETTINGS', { size: 'md', color: C.gold, shadow: true });
    txtR(ctx, VIEW_W - 8, 5, safe(() => Save.available, true) ? 'Saved to this browser' : 'Storage unavailable — changes are temporary', {
      size: 'sm', color: safe(() => Save.available, true) ? C.disabled : C.warn, shadow: true, maxWidth: 250,
    });

    UI.tabs(ctx, 2, 17, VIEW_W - 4, OPT_GROUPS.map((g) => ({ label: g.label, icon: g.icon })), this.group, {});
    const tw = Math.floor((VIEW_W - 4) / OPT_GROUPS.length);
    for (let i = 0; i < OPT_GROUPS.length; i++) this.tabRects.push({ x: 2 + i * tw, y: 17, w: tw, h: 13, i });

    const LX = 3, LY = 33, LW = 236, LH = CONTENT_BOTTOM - 33;
    UI.panel(ctx, LX, LY, LW, LH, { style: 'window' });
    const rowH = 14, visible = 12;
    const sel = clamp(this.index[this.group], 0, Math.max(0, rows.length - 1));
    let top = this.top[this.group];
    if (sel < top) top = sel;
    if (sel > top + visible - 1) top = sel - visible + 1;
    this.top[this.group] = top = clamp(top, 0, Math.max(0, rows.length - visible));

    UI.pushClip(ctx, LX + 2, LY + 3, LW - 4, rowH * visible + 2);
    for (let i = 0; i < visible && top + i < rows.length; i++) {
      const idx = top + i;
      const r = rows[idx];
      const ry = LY + 5 + i * rowH;
      const on = idx === sel;
      if (on) UI.highlight(ctx, LX + 3, ry - 1, LW - 8, rowH - 1, { alpha: 0.2 });
      const lc = r.kind === 'reset' ? C.warn : (on ? C.goldBright : C.ink);
      txt(ctx, LX + 11, ry + 2, r.label, { size: on ? 'md' : 'sm', color: lc, shadow: true, maxWidth: 118 });
      this._drawValue(ctx, r, LX + 134, ry + 2, LW - 142, on);
      if (on) UI.cursor(ctx, LX + 3, ry + 2, this.t);
      this.rowRects.push({ x: LX + 3, y: ry - 1, w: LW - 8, h: rowH - 1, i: idx });
    }
    UI.popClip(ctx);
    if (rows.length > visible) scrollHint(ctx, LX + LW - 4, LY + 4, rowH * visible, top, visible, rows.length);

    const DX = 243, DW = VIEW_W - DX - 3;
    UI.panel(ctx, DX, LY, DW, LH, { style: 'window' });
    this._drawDetail(ctx, rows[sel], DX + 7, LY + 5, DW - 14, LH - 10);

    this.drawMessage(ctx, 6, MSG_Y, VIEW_W - 12);
    hintBar(ctx, HINT_Y, [
      [keyFor('cancel'), 'Back'], [`${keyFor('left')}${keyFor('right')}`, 'Change'],
      [keyFor('confirm'), 'Set'], [`${keyFor('prev')}/${keyFor('next')}`, 'Group'],
    ]);
    if (this.rebind) this._drawRebind(ctx);
    this.drawPrompt(ctx);
  }

  _drawValue(ctx, r, x, y, w, on) {
    const settings = safe(() => Save.settings, null) || {};
    if (r.kind === 'reset') {
      txtR(ctx, x + w, y, '↩', { size: 'md', color: C.warn, shadow: true });
      return;
    }
    if (r.kind === 'bind') {
      const list = arr(safe(() => Input.bindings[r.action], []));
      const label = list.length ? list.slice(0, 2).map(codeLabel).join(' / ') : 'unbound';
      txtR(ctx, x + w, y, label, { size: 'sm', color: list.length ? C.goldBright : C.bad, shadow: true, maxWidth: w });
      return;
    }
    const v = settings[r.key];
    if (r.kind === 'bool') {
      txtR(ctx, x + w, y, v ? 'ON' : 'OFF', { size: 'md', color: v ? C.good : C.disabled, shadow: true });
      return;
    }
    if (r.kind === 'range') {
      const pct = clamp((num(v, 0) - num(r.spec.min, 0)) / Math.max(0.001, num(r.spec.max, 1) - num(r.spec.min, 0)), 0, 1);
      UI.bar(ctx, x, y + 1, w - 30, 6, pct, { color: on ? C.gold : C.goldDim });
      txtR(ctx, x + w, y, `${Math.round(pct * 100)}%`, { size: 'sm', color: C.ink, shadow: true });
      return;
    }
    // enum
    const label = titleCase(String(v));
    txt(ctx, x, y, '◀', { size: 'sm', color: on ? C.gold : C.disabled });
    txtC(ctx, x + w / 2, y, label, { size: on ? 'md' : 'sm', color: on ? C.goldBright : C.ink, shadow: true, maxWidth: w - 20 });
    txtR(ctx, x + w, y, '▶', { size: 'sm', color: on ? C.gold : C.disabled });
  }

  _drawDetail(ctx, r, x, y, w, h) {
    if (!r) return;
    txt(ctx, x, y, r.label, { size: 'md', color: C.gold, shadow: true, maxWidth: w });
    let ty = y + 14;
    const desc = r.kind === 'bind'
      ? 'Press Confirm, then press the key you want. Escape aborts. The old key stays as a spare.'
      : r.kind === 'reset'
        ? 'Put everything on this page back the way it shipped.'
        : (SETTING_DESC[r.key] || 'Adjust this option.');
    const res = UI.textWrapped(ctx, x, ty, w, desc, { size: 'sm', color: C.ink, maxLines: 6 });
    ty += res.height + 8;

    if (r.kind === 'enum') {
      ty = sectionHead(ctx, x, ty, w, 'CHOICES');
      const v = safe(() => Save.settings[r.key], null);
      for (const o of arr(r.spec.options)) {
        const on = o === v;
        txt(ctx, x, ty, on ? '●' : '○', { size: 'sm', color: on ? C.goldBright : C.disabled, shadow: true });
        txt(ctx, x + 9, ty, titleCase(String(o)), { size: 'sm', color: on ? C.ink : C.inkDim, shadow: true, maxWidth: w - 12 });
        ty += 9;
        if (ty > y + h - 10) break;
      }
    } else if (r.kind === 'bind') {
      ty = sectionHead(ctx, x, ty, w, 'BOUND KEYS');
      const list = arr(safe(() => Input.bindings[r.action], []));
      if (!list.length) txt(ctx, x, ty, 'Nothing bound.', { size: 'sm', color: C.bad, shadow: true });
      list.forEach((code, i) => {
        safe(() => UI.keyHint(ctx, x, ty + i * 13, codeLabel(code), i === 0 ? 'primary' : 'spare'));
      });
    }
  }

  _drawRebind(ctx) {
    UI.scrim(ctx, 0.6);
    const w = 220, h = 54;
    const x = R((VIEW_W - w) / 2), y = R((VIEW_H - h) / 2);
    UI.window(ctx, x, y, w, h, 'Press a key', { style: 'gold' });
    txtC(ctx, x + w / 2, y + 12, ACTION_LABELS[this.rebind.action] || this.rebind.action, {
      size: 'md', color: C.goldBright, shadow: true, maxWidth: w - 16,
    });
    txtC(ctx, x + w / 2, y + 28, 'Escape to keep the old one.', { size: 'sm', color: C.inkDim, shadow: true });
  }
}

// ===========================================================================
// 9. BESTIARY
// ===========================================================================

const BEST_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'known', label: 'Recorded' },
  { id: 'beast', label: 'Beasts' },
  { id: 'humanoid', label: 'Humanoids' },
  { id: 'undead', label: 'Undead' },
  { id: 'dragon', label: 'Dragons' },
  { id: 'fiend', label: 'Fiends' },
];

function monsterFrame(name) {
  const fs = arr(safe(() => spriteFrames(name), []));
  if (fs.indexOf('down-0') >= 0) return 'down-0';
  if (fs.indexOf('idle') >= 0) return 'idle';
  return fs[0] || 'idle';
}

function actionLine(a) {
  if (!a) return '';
  if (a.kind === 'multiattack') return a.desc || 'Makes several attacks.';
  if (a.kind === 'attack') {
    const reach = Array.isArray(a.range) ? `range ${a.range[0]}/${a.range[1]} ft.` : `reach ${num(a.reach, 5)} ft.`;
    const avg = a.dice ? Math.floor(num(safe(() => avgExpr(a.dice), 0), 0)) : 0;
    const dmg = a.dice ? ` Hit: ${avg} (${a.dice}) ${a.dtype || ''} damage.` : '';
    return `${signed(num(a.atkBonus, 0))} to hit, ${reach}.${dmg}`;
  }
  if (a.kind === 'save' && a.save) {
    const avg = a.dice ? Math.floor(num(safe(() => avgExpr(a.dice), 0), 0)) : 0;
    const dmg = a.dice ? ` ${avg} (${a.dice}) ${a.dtype || ''} damage` : '';
    const half = a.save.onSuccess === 'half' ? ', half on a success' : '';
    return `DC ${num(a.save.dc, 10)} ${ABILITY_NAMES[a.save.ability] || a.save.ability} save —${dmg}${half}.`;
  }
  if (a.kind === 'heal') return `Restores ${a.dice || 'hit points'}.`;
  return a.desc || '';
}

/** Turn a stat block into a flat list of drawable lines so it can scroll cleanly. */
function statBlockLines(m, kills, w) {
  const L = [];
  const push = (kind, text, color) => L.push({ kind, text, color });
  const wrap = (text, color, kind) => {
    for (const l of UI.wrapLines(String(text || ''), w, 'sm')) push(kind || 'body', l, color);
  };

  push('rule', '');
  const hpAvg = m.hpDice ? Math.max(1, Math.floor(num(safe(() => avgExpr(m.hpDice), 0), 0))) : num(m.hp, 1);
  push('kv', `Armour Class|${num(m.ac, 10)}`);
  push('kv', `Hit Points|${hpAvg}${m.hpDice ? ` (${m.hpDice})` : ''}`);
  const spd = [`${num(m.speed, 30)} ft.`];
  if (num(m.fly, 0)) spd.push(`fly ${m.fly} ft.`);
  if (num(m.swim, 0)) spd.push(`swim ${m.swim} ft.`);
  if (num(m.climb, 0)) spd.push(`climb ${m.climb} ft.`);
  if (num(m.burrow, 0)) spd.push(`burrow ${m.burrow} ft.`);
  push('kv', `Speed|${spd.join(', ')}`);
  push('rule', '');

  const ab = m.abilities || {};
  push('abilities', ABILITIES.map((a) => `${ABILITY_ABBR[a]} ${num(ab[a], 10)} (${signed(Math.floor((num(ab[a], 10) - 10) / 2))})`).join('  '));
  push('rule', '');

  if (arr(m.saveProf).length) push('kv', `Saves|${arr(m.saveProf).map((s) => ABILITY_ABBR[s] || s).join(', ')}`);
  const sk = m.skills || {};
  const skKeys = Object.keys(sk);
  if (skKeys.length) push('kv', `Skills|${skKeys.map((k) => `${(SKILLS[k] || {}).name || titleCase(k)} ${signed(num(sk[k], 0))}`).join(', ')}`);
  const sen = m.senses || {};
  const senBits = Object.keys(sen).map((k) => `${titleCase(k)} ${sen[k]} ft.`);
  senBits.push(`Passive Perception ${num(m.passivePerception, 10)}`);
  push('kv', `Senses|${senBits.join(', ')}`);
  if (arr(m.resist).length) push('kv', `Resistances|${arr(m.resist).join(', ')}`);
  if (arr(m.immune).length) push('kv', `Immunities|${arr(m.immune).join(', ')}`);
  if (arr(m.vuln).length) push('kv', `Vulnerable|${arr(m.vuln).join(', ')}`);
  if (arr(m.condImmune).length) push('kv', `Cond. Immune|${arr(m.condImmune).join(', ')}`);
  push('kv', `Challenge|${crText(num(m.cr, 0))} (${num(safe(() => xpOf(m.id), m.xp), num(m.xp, 0))} XP)`);
  push('kv', `Slain by you|${num(kills, 0)}`);

  if (arr(m.traits).length) {
    push('rule', '');
    push('head', 'TRAITS');
    for (const t of arr(m.traits)) {
      push('name', t.name || 'Trait');
      wrap(t.desc || '');
    }
  }
  if (arr(m.actions).length) {
    push('rule', '');
    push('head', 'ACTIONS');
    for (const a of arr(m.actions)) {
      push('name', a.name || 'Action');
      wrap(actionLine(a));
    }
  }
  if (arr(m.bonusActions).length) {
    push('rule', '');
    push('head', 'BONUS ACTIONS');
    for (const a of arr(m.bonusActions)) { push('name', a.name || 'Bonus Action'); wrap(actionLine(a)); }
  }
  if (arr(m.reactions).length) {
    push('rule', '');
    push('head', 'REACTIONS');
    for (const a of arr(m.reactions)) { push('name', a.name || 'Reaction'); wrap(actionLine(a)); }
  }
  if (m.legendary && arr(m.legendary.actions).length) {
    push('rule', '');
    push('head', `LEGENDARY ACTIONS (${num(m.legendary.count, 3)})`);
    for (const a of arr(m.legendary.actions)) { push('name', a.name || 'Legendary Action'); wrap(actionLine(a)); }
  }
  if (m.desc) { push('rule', ''); wrap(m.desc, C.inkDim); }
  if (arr(m.biomes).length) { push('rule', ''); push('kv', `Found in|${arr(m.biomes).map((b) => titleCase(String(b).replace(/-/g, ' '))).join(', ')}`); }
  return L;
}

export class BestiaryScene extends MenuScene {
  constructor(opts = {}) {
    super('bestiary');
    this.opts = opts || {};
    this.filter = 0;
    this.index = 0;
    this.top = 0;
    this.scroll = 0;
    this.sortByCR = true;
    this.list = [];
    this.rowRects = [];
  }

  _build() {
    const st = S();
    const kills = (st && st.bestiary) || {};
    const f = BEST_FILTERS[this.filter].id;
    const ids = arr(MONSTER_IDS).filter((id) => {
      const m = MONSTERS[id];
      if (!m) return false;
      if (f === 'known') return num(kills[id], 0) > 0;
      if (f === 'all') return true;
      return m.type === f;
    });
    ids.sort((a, b) => {
      const A = MONSTERS[a], B = MONSTERS[b];
      if (this.sortByCR) return num(A.cr, 0) - num(B.cr, 0) || String(A.name).localeCompare(B.name);
      return String(A.name).localeCompare(B.name);
    });
    this.list = ids.map((id) => ({ id, m: MONSTERS[id], kills: num(kills[id], 0) }));
    if (this.index >= this.list.length) this.index = Math.max(0, this.list.length - 1);
    return this.list;
  }

  update(dt) {
    if (this.tick(dt)) return;
    const list = this._build();

    const f0 = this.filter;
    this.filter = navPage(this.filter, BEST_FILTERS.length);
    const tp = tabPressed(5);
    if (tp >= 0) this.filter = tp;
    if (this.filter !== f0) { this.index = 0; this.top = 0; this.scroll = 0; return; }

    if (Input.consume('interact')) {
      this.sortByCR = !this.sortByCR;
      sfx('cursor');
      this.say(this.sortByCR ? 'Sorted by Challenge Rating.' : 'Sorted by name.', false, 1.6);
      return;
    }

    if (listNavActive()) {
      const b = this.index;
      this.index = navV(this.index, list.length);
      if (this.index !== b) this.scroll = 0;
    }
    this.scroll = scrollPane(this.scroll, this._maxScroll || 0, Input.mouse, this._paneRect);

    const m = Input.mouse;
    for (const r of this.rowRects) {
      if (hit(m, r.x, r.y, r.w, r.h)) {
        if (this.index !== r.i) { this.index = r.i; this.scroll = 0; sfx('cursor'); }
      }
    }
    if (Input.consume('cancel')) this.close();
  }

  draw(ctx) {
    ctx.fillStyle = C.bgDeep;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.rowRects = [];
    const list = this.list.length ? this.list : this._build();
    const st = S();
    const known = list.filter((e) => e.kills > 0).length;

    UI.panel(ctx, 2, 2, VIEW_W - 4, 13, { style: 'dark' });
    txt(ctx, 8, 4, 'BESTIARY', { size: 'md', color: C.gold, shadow: true });
    txt(ctx, 74, 5, `${known} of ${list.length} recorded`, { size: 'sm', color: C.inkDim, shadow: true, maxWidth: 110 });
    txtR(ctx, VIEW_W - 8, 5, `◀ ${BEST_FILTERS[this.filter].label} ▶   ·   ${this.sortByCR ? 'by CR' : 'by name'}`, {
      size: 'sm', color: C.goldDim, shadow: true, maxWidth: 200,
    });

    const LX = 3, LY = 18, LW = 148, LH = CONTENT_BOTTOM - 18;
    UI.panel(ctx, LX, LY, LW, LH, { style: 'window' });
    const rowH = 11, visible = 17;
    if (this.index < this.top) this.top = this.index;
    if (this.index > this.top + visible - 1) this.top = this.index - visible + 1;
    this.top = clamp(this.top, 0, Math.max(0, list.length - visible));

    UI.pushClip(ctx, LX + 2, LY + 3, LW - 4, rowH * visible + 2);
    for (let i = 0; i < visible && this.top + i < list.length; i++) {
      const idx = this.top + i;
      const e = list[idx];
      const ry = LY + 5 + i * rowH;
      const on = idx === this.index;
      const seen = e.kills > 0;
      if (on) UI.highlight(ctx, LX + 3, ry - 1, LW - 8, rowH, { alpha: 0.2 });
      UI.icon(ctx, seen ? 'skull' : 'lock', LX + 8, ry, 8, seen ? null : C.disabled);
      txt(ctx, LX + 19, ry, seen ? e.m.name : '???', {
        size: on ? 'md' : 'sm', color: seen ? (on ? C.goldBright : C.ink) : C.disabled, shadow: true, maxWidth: LW - 52,
      });
      txtR(ctx, LX + LW - 6, ry, seen ? `×${e.kills}` : crText(num(e.m.cr, 0)), {
        size: 'sm', color: seen ? C.goldDim : C.disabled, shadow: true,
      });
      if (on) UI.cursor(ctx, LX + 2, ry, this.t);
      this.rowRects.push({ x: LX + 3, y: ry - 1, w: LW - 8, h: rowH, i: idx });
    }
    UI.popClip(ctx);
    if (list.length > visible) scrollHint(ctx, LX + LW - 4, LY + 4, rowH * visible, this.top, visible, list.length);

    const DX = 155, DW = VIEW_W - DX - 3;
    UI.panel(ctx, DX, LY, DW, LH, { style: 'window' });
    this._paneRect = { x: DX, y: LY, w: DW, h: LH };
    this._drawBlock(ctx, list[this.index] || null, DX + 7, LY + 5, DW - 14, LH - 10, st);

    this.drawMessage(ctx, 6, MSG_Y, VIEW_W - 12);
    hintBar(ctx, HINT_Y, [
      [keyFor('cancel'), 'Back'], [`${keyFor('prev')}/${keyFor('next')}`, 'Filter'],
      [keyFor('run'), 'Scroll'], [keyFor('interact'), 'Sort'], ['1-5', 'Jump'],
    ]);
    this.drawPrompt(ctx);
  }

  _drawBlock(ctx, e, x, y, w, h, st) {
    if (!e) { txtC(ctx, x + w / 2, y + h / 2, 'Nothing here.', { size: 'sm', color: C.disabled }); return; }
    const m = e.m;
    const seen = e.kills > 0;

    // Sprite plate, top-right.
    const px = x + w - 40, py = y + 2;
    UI.panel(ctx, px, py, 38, 40, { style: 'inset', shadow: 0.2 });
    const spriteName = m.sprite || m.id;
    if (safe(() => hasSprite(spriteName), false)) {
      const frame = monsterFrame(spriteName);
      if (seen) {
        safe(() => drawSprite(ctx, spriteName, frame, px + 19, py + 37, { scale: 1, shadow: 0.25, tint: m.tint || null, tintAmt: m.tint ? 0.4 : 0 }));
      } else {
        safe(() => drawSprite(ctx, spriteName, frame, px + 19, py + 37, { scale: 1, tint: '#101018', tintAmt: 1, alpha: 0.9 }));
      }
    } else {
      UI.icon(ctx, 'skull', px + 14, py + 14, 12, seen ? null : C.disabled);
    }

    txt(ctx, x, y, seen ? m.name : '???', { size: 'md', color: seen ? C.gold : C.disabled, shadow: true, maxWidth: w - 44 });
    txt(ctx, x, y + 11, seen ? safe(() => statLine(m), '') : 'Unrecorded', {
      size: 'sm', color: C.inkDim, shadow: true, maxWidth: w - 44,
    });

    if (!seen) {
      this._maxScroll = 0;
      UI.textWrapped(ctx, x, y + 30, w - 44, 'You have never put one of these in the ground. Kill one, and Oghma willing, the notes will write themselves.', {
        size: 'sm', color: C.disabled, maxLines: 4,
      });
      return;
    }

    const lines = statBlockLines(m, e.kills, w - 4);
    const bodyY = y + 22;
    const avail = Math.max(1, Math.floor((y + h - bodyY) / 9));
    this._maxScroll = Math.max(0, lines.length - avail);
    const off = clamp(R(this.scroll), 0, this._maxScroll);
    UI.pushClip(ctx, x - 2, bodyY - 1, w + 4, y + h - bodyY + 1);
    for (let i = 0; i < avail && off + i < lines.length; i++) {
      const l = lines[off + i];
      const ly = bodyY + i * 9;
      // Keep the first rows clear of the sprite plate.
      const lw = ly < y + 44 ? w - 44 : w;
      if (l.kind === 'rule') { UI.divider(ctx, x, ly + 3, lw); continue; }
      if (l.kind === 'head') { txt(ctx, x, ly, l.text, { size: 'sm', color: C.goldDim, shadow: true, maxWidth: lw }); continue; }
      if (l.kind === 'name') { txt(ctx, x, ly, l.text, { size: 'md', color: C.goldBright, shadow: true, maxWidth: lw }); continue; }
      if (l.kind === 'abilities') { txt(ctx, x, ly, l.text, { size: 'sm', color: C.ink, shadow: true, maxWidth: lw }); continue; }
      if (l.kind === 'kv') {
        const bits = String(l.text).split('|');
        kv(ctx, x, ly, lw, bits[0], bits[1] || '');
        continue;
      }
      txt(ctx, x, ly, l.text, { size: 'sm', color: l.color || C.ink, shadow: true, maxWidth: lw });
    }
    UI.popClip(ctx);
    if (this._maxScroll > 0) {
      if (off > 0) txtR(ctx, x + w, bodyY - 8, '▲', { size: 'sm', color: C.goldDim });
      if (off < this._maxScroll) txtR(ctx, x + w, y + h - 7, '▼', { size: 'sm', color: C.goldDim });
    }
    void st;
  }
}

// ===========================================================================
// 10. SAVE / LOAD
// ===========================================================================

export class SaveMenuScene extends MenuScene {
  /** @param {'save'|'load'} mode */
  constructor(mode = 'save', opts = {}) {
    super('savemenu');
    this.mode = mode === 'load' ? 'load' : 'save';
    this.opts = opts || {};
    this.index = 0;
    this.slots = [];
    this.rowRects = [];
    this._party = Object.create(null);   // slot -> Character[] for the portraits
    this._busy = false;
  }

  enter(prev) {
    super.enter(prev);
    this.slots = arr(safe(() => Save.list(), [])) || [];
    if (!this.slots.length) {
      this.slots = [0, 1, 2, 3, 4].map((slot) => ({ slot, label: slot === 0 ? 'Autosave' : `Slot ${slot}`, empty: true }));
    }
    this.index = clamp(this.index, 0, this.slots.length - 1);
  }

  /** Deserialise the highlighted slot's party, lazily, so we can show real busts. */
  _partyFor(slot) {
    if (this._party[slot] !== undefined) return this._party[slot];
    this._party[slot] = null;
    const data = safe(() => Save.read(slot), null);
    const raw = data && data.party && arr(data.party.members);
    if (!raw || !raw.length) return null;
    const out = [];
    for (const m of raw.slice(0, 4)) {
      const ch = safe(() => deserializeChar(m), null);
      if (ch) out.push(ch);
    }
    this._party[slot] = out.length ? out : null;
    return this._party[slot];
  }

  update(dt) {
    if (this.tick(dt)) return;
    if (this._busy) return;
    const n = this.slots.length;
    this.index = navV(this.index, n);

    const m = Input.mouse;
    for (const r of this.rowRects) {
      if (hit(m, r.x, r.y, r.w, r.h)) {
        if (this.index !== r.i) { this.index = r.i; sfx('cursor'); }
        if (clicked(m, r.x, r.y, r.w, r.h)) { this._choose(); return; }
      }
    }
    if (Input.consume('interact')) { this._delete(); return; }
    if (Input.consume('confirm')) { this._choose(); return; }
    if (Input.consume('cancel')) this.close();
  }

  _slot() { return this.slots[clamp(this.index, 0, this.slots.length - 1)] || null; }

  _choose() {
    const s = this._slot();
    if (!s) { sfx('error'); return; }
    if (this.mode === 'load') {
      if (s.empty) { this.say('That journal is blank.', true); return; }
      if (s.corrupt) { this.say('That journal is water-damaged beyond reading.', true); return; }
      this.ask('Read this journal?', `${s.name || 'Adventurer'} — ${s.mapName || ''}. Anything unsaved is lost.`, [
        { label: 'Load it', value: 'yes' },
        { label: 'Back', value: null },
      ], (v) => { if (v === 'yes') this._load(s.slot); });
      return;
    }
    if (s.slot === 0) { this.say('The autosave writes itself. Choose another slot.', true); return; }
    if (!s.empty) {
      this.ask('Overwrite?', `Slot ${s.slot} holds ${s.name || 'a campaign'} at level ${num(s.level, 1)}.`, [
        { label: 'Write over it', value: 'yes', color: C.warn },
        { label: 'Back', value: null },
      ], (v) => { if (v === 'yes') this._write(s.slot); });
      return;
    }
    this._write(s.slot);
  }

  _delete() {
    const s = this._slot();
    if (!s || s.empty) { sfx('error'); return; }
    this.ask('Burn this journal?', `${s.name || 'This campaign'} will be gone for good.`, [
      { label: 'Burn it', value: 'yes', color: C.bad },
      { label: 'Keep it', value: null },
    ], (v) => {
      if (v !== 'yes') return;
      safe(() => Save.erase(s.slot));
      delete this._party[s.slot];
      this.slots = arr(safe(() => Save.list(), this.slots)) || this.slots;
      sfx('back');
      this.say('Burned.');
    });
  }

  _write(slot) {
    const st = S();
    if (!st) { this.say('There is no campaign to record.', true); return; }
    const payload = safe(() => saveState(st, serializeChar), null);
    if (!payload) { this.say('The quill snapped — nothing was written.', true); return; }
    safe(() => { payload.meta = stateSummary(st); });
    const res = safe(() => Save.write(slot, payload), null);
    if (!res || res.ok === false) {
      this.say((res && res.reason === 'quota') ? 'No room left in this browser.' : 'That journal will not take ink.', true);
      return;
    }
    delete this._party[slot];
    this.slots = arr(safe(() => Save.list(), this.slots)) || this.slots;
    sfx('quest');
    safe(() => toast('Journal updated.'));
    this.say('Written down.');
  }

  _load(slot) {
    const data = safe(() => Save.read(slot), null);
    if (!data) { this.say('That journal cannot be read.', true); return; }
    this._busy = true;
    softImport('../world/overworld.js', 'overworld').then((ow) => {
      let st = null;
      try { st = loadState(data, deserializeChar); } catch (err) {
        console.error('[menus] load failed', err);
        this._busy = false;
        this.say('That journal is damaged.', true);
        return;
      }
      Game.state = st;
      for (const m of safe(() => Party.all(), []) || []) safe(() => recalc(m));
      if (!ow || !ow.OverworldScene) {
        this._busy = false;
        this.say('The Sword Coast is not yet mapped.', true);
        return;
      }
      safe(() => Audio.music(null));
      Game.transition('fade', () => {
        Game.replace(new ow.OverworldScene(st.mapId, { x: st.x, y: st.y, dir: st.dir }));
      });
    });
  }

  // --- drawing ------------------------------------------------------------

  draw(ctx) {
    ctx.fillStyle = C.bgDeep;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.rowRects = [];

    UI.panel(ctx, 2, 2, VIEW_W - 4, 14, { style: 'dark' });
    txt(ctx, 8, 4, this.mode === 'load' ? 'READ A JOURNAL' : 'WRITE THE JOURNAL', { size: 'md', color: C.gold, shadow: true });
    txtR(ctx, VIEW_W - 8, 5, safe(() => Save.available, true) ? '' : 'Storage is off — saves will not survive.', {
      size: 'sm', color: C.warn, shadow: true, maxWidth: 220,
    });

    const CARD_H = 36, CARD_W = VIEW_W - 16;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const y = 20 + i * (CARD_H + 2);
      const on = i === this.index;
      this.rowRects.push({ x: 8, y, w: CARD_W, h: CARD_H, i });
      UI.panel(ctx, 8, y, CARD_W, CARD_H, {
        style: s.corrupt ? 'danger' : (s.empty ? 'plain' : 'window'),
        shadow: on ? 0.45 : 0.2,
      });
      txt(ctx, 14, y + 4, s.label || `Slot ${s.slot}`, {
        size: 'sm', color: s.slot === 0 ? C.cyan : C.goldDim, shadow: true, maxWidth: 60,
      });

      if (s.empty) {
        txt(ctx, 14, y + 16, '— empty —', { size: 'md', color: C.disabled, shadow: true });
        if (on) UI.frameSel(ctx, 7, y - 1, CARD_W + 2, CARD_H + 2, this.t);
        continue;
      }
      if (s.corrupt) {
        txt(ctx, 14, y + 16, 'Corrupt save', { size: 'md', color: C.bad, shadow: true });
        if (on) UI.frameSel(ctx, 7, y - 1, CARD_W + 2, CARD_H + 2, this.t);
        continue;
      }

      // Portraits — deserialised only for the highlighted card, name chips otherwise.
      const px = 76;
      const party = on ? this._partyFor(s.slot) : null;
      if (party && party.length) {
        party.slice(0, 4).forEach((ch, k) => safe(() => UI.portrait(ctx, ch, px + k * 22, y + 4, 20, { shadow: 0.2 })));
      } else {
        arr(s.partyNames).slice(0, 4).forEach((nm, k) => {
          UI.panel(ctx, px + k * 22, y + 4, 20, 20, { style: 'inset', shadow: 0 });
          txtC(ctx, px + k * 22 + 10, y + 10, String(nm || '?').charAt(0).toUpperCase(), { size: 'md', color: C.inkDim });
        });
      }

      const tx = px + 94;
      txt(ctx, tx, y + 4, `${s.name || 'Adventurer'}`, { size: 'md', color: C.goldBright, shadow: true, maxWidth: 118 });
      txt(ctx, tx, y + 15, `Level ${num(s.level, 1)} · ${plural(num(s.partySize, 0), 'companion')}`, {
        size: 'sm', color: C.ink, shadow: true, maxWidth: 118,
      });
      txt(ctx, tx, y + 25, `${s.mapName || 'The Sword Coast'}${num(s.gold, 0) ? ` · ${goldText(s.gold)}` : ''}`, {
        size: 'sm', color: C.inkDim, shadow: true, maxWidth: 118,
      });

      const rx = VIEW_W - 14;
      txtR(ctx, rx, y + 4, s.playtimeText || playtimeText(num(s.playtime, 0)), { size: 'sm', color: C.gold, shadow: true });
      txtR(ctx, rx, y + 14, dateText(num(s.day, 1)), { size: 'sm', color: C.inkDim, shadow: true, maxWidth: 120 });
      txtR(ctx, rx, y + 24, s.ago ? `saved ${s.ago}` : (s.savedAtText || ''), { size: 'sm', color: C.disabled, shadow: true, maxWidth: 120 });
      if (on) UI.frameSel(ctx, 7, y - 1, CARD_W + 2, CARD_H + 2, this.t);
    }

    this.drawMessage(ctx, 8, MSG_Y, VIEW_W - 16);
    hintBar(ctx, HINT_Y, [
      [keyFor('cancel'), 'Back'],
      [keyFor('confirm'), this.mode === 'load' ? 'Load' : 'Save'],
      [keyFor('interact'), 'Delete'],
    ]);
    this.drawPrompt(ctx);
  }
}

// ===========================================================================
// 11. EXPORT
// ===========================================================================

export default {
  PauseMenuScene, PartyScene, InventoryScene, SpellbookScene, JournalScene,
  MapScene, OptionsScene, BestiaryScene, SaveMenuScene,
};
