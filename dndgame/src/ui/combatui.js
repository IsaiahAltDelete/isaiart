// ui/combatui.js — BattleScene: the tactical D&D 5.5e battle interface.
//
// The rules live in rules/combat.js, which is headless and synchronous. This scene
// is the *theatre*: it asks the Encounter what is legal, tells it what the player
// chose, and then REPLAYS the structured results it gets back as an animation —
// dice tumbling, blades swinging, numbers floating, corpses fading.
//
// Layout (400x240 logical pixels):
//   y   0.. 25   initiative ribbon — round chip + turn order portraits with HP pips
//   y  26.. 36   boss health bar (boss fights only)
//   y  26..239   the battlefield, 16px tiles at 2x zoom, camera panning to the actor
//   y  82..209   floating action menu (left) and the detail/maths panel (right)
//   y 214..239   the last two lines of the combat log, always visible
//
// Everything is drawn through ui/kit.js UI.*; nothing here touches ctx.font.
//
// A NOTE ON REACTIONS. rules/combat.js offers reactions through a synchronous
// callback in the middle of resolving an attack — JavaScript cannot pause there to
// wait for a keypress. So the scene keeps a per-encounter *stance* for each kind of
// reaction ('ask' | 'yes' | 'no'). An armed stance answers instantly; an 'ask'
// falls through to the engine's own sensible default AND queues the timed yes/no
// prompt, whose answer arms the stance for the rest of the fight. Companions the
// player has handed to the AI never prompt at all.

import { UI } from './kit.js';
import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { Save } from '../core/save.js';
import { Game } from '../engine.js';
import { FX } from '../render/fx.js';
import { bus, EV } from '../core/events.js';
import { avgExpr } from '../core/dice.js';
import { hashStr } from '../core/rng.js';
import {
  TILE, VIEW_W, VIEW_H, SIZES, clamp, lerp, signed, titleCase, ordinal,
} from '../constants.js';

import { drawActor } from '../render/actor.js';
import * as Tiles from '../render/tiles.js';

import {
  acOf, maxHpOf, isDead, saveMod, speedOf,
} from '../rules/character.js';
import { conditionBadges, conditionName } from '../rules/conditions.js';
import {
  computeAdvantage, hasCover, distanceFt, TILE_FLAGS,
} from '../rules/actions.js';
import { takeTurn } from '../rules/ai.js';
import { getSpell, spellDamageDice } from '../data/spells.js';
import { itemName } from '../data/items.js';
import * as MonsterData from '../data/monsters.js';
import { Party } from '../world/party.js';
import { GameOverScene } from './title.js';

// ===========================================================================
// 0. LAYOUT & TUNING
// ===========================================================================

const R = Math.round;

/** The battlefield viewport. Menus float over it rather than shrinking it. */
const FIELD = { x: 0, y: 26, w: VIEW_W, h: VIEW_H - 26 };

const RIBBON = { x: 0, y: 0, w: VIEW_W, h: 26 };
const MENU = { x: 3, y: 96, w: 122, h: 114 };
const BUDGET = { x: 3, y: 82, w: 122, h: 12 };
const DETAIL = { x: 129, y: 150, w: 268, h: 60 };
const LOGTAIL = { x: 0, y: 214, w: VIEW_W, h: 26 };
const DICE = { x: 200, y: 80 };

const MENU_ROWS = 8;
const MENU_ROW_H = 12;

/** Movement speed of a walking sprite, in world pixels per second. */
const WALK_PX = 52;

/** How long the scene lingers between the steps of an enemy's plan. */
const PLAN_PAUSE = 0.34;

/** The d20 popup holds this long after landing so the maths can be read. */
const DICE_HOLD = 1.05;
const DMG_HOLD = 0.85;

const SIDE_COLOR = { party: '#6ac0f0', foe: '#e0604a' };

/** Log line kind -> ink colour. */
const LOG_COLORS = {
  round: UI.COLORS.gold, turn: UI.COLORS.goldBright, crit: UI.COLORS.goldBright,
  hit: UI.COLORS.ink, miss: UI.COLORS.inkDim, damage: '#e88a70', save: '#8fd8ee',
  heal: UI.COLORS.good, buff: UI.COLORS.good, debuff: UI.COLORS.purple, info: UI.COLORS.inkDim,
};

/** Fallback floor colours per biome, used when render/tiles.js has not registered. */
const BIOME_FLOOR = {
  plains: ['#3f6b3a', '#487a41', '#39602f'], road: ['#7a6a4a', '#6b5c3f', '#84745a'],
  forest: ['#2f5e30', '#376a36', '#28522a'], 'pine-forest': ['#2a5440', '#316049', '#244a39'],
  hills: ['#5a6b3a', '#647541', '#4e5e32'], mountain: ['#6a6a72', '#767680', '#5c5c64'],
  marsh: ['#4a5230', '#545c38', '#3f4629'], coast: ['#a89870', '#b8a880', '#9a8a64'],
  ruins: ['#6a6458', '#767062', '#5c5750'], cave: ['#413a38', '#4a4340', '#38322f'],
  dungeon: ['#4a4650', '#545059', '#403c46'], crypt: ['#3f3a44', '#48434d', '#36323b'],
  mine: ['#4a4038', '#544940', '#403830'], 'ash-waste': ['#4a4442', '#544e4b', '#403a39'],
  tundra: ['#b8c4cc', '#c6d0d8', '#a8b4bd'], underdark: ['#33303f', '#3b3849', '#2b2836'],
  city: ['#6e6a62', '#78746c', '#625e57'],
};

// ===========================================================================
// 1. SMALL HELPERS
// ===========================================================================

function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (e) { return fallback; }
}

const key = (x, y) => `${x},${y}`;
const posOf = (u) => (u && u.pos ? u.pos : { x: 0, y: 0 });

/** Feet at the bottom of the tile, centred horizontally — world pixels. */
function feetOf(u) {
  const p = posOf(u);
  return { x: p.x * TILE + TILE / 2, y: (p.y + 1) * TILE };
}

function sizeScale(u) {
  const s = SIZES[String(u?.size || 'medium').toLowerCase()];
  return s ? Math.min(2.2, s.scale) : 1;
}

function hpPct(u) {
  const max = safe(() => maxHpOf(u), u?.maxHp || 1) || 1;
  return clamp((u?.hp || 0) / max, 0, 1);
}

function sfx(name, opts) { safe(() => Audio.sfx(name, opts)); }

/** "1d8 [6] +3 = 9 slashing" — the whole point of playing D&D. */
function componentLine(c) {
  if (!c) return '';
  const rolls = Array.isArray(c.rolls) && c.rolls.length ? ` [${c.rolls.join(',')}]` : '';
  const dice = c.dice && c.dice !== '0' ? `${c.dice}${rolls}` : '';
  const mod = c.mod ? `${c.mod > 0 ? ' +' : ' '}${c.mod}` : '';
  const head = dice ? `${dice}${mod}` : `${c.mod || c.total}`;
  return `${head} = ${c.total} ${c.type || ''}`.trim();
}

/** Up to three readable damage lines from an AttackResult / SaveResult breakdown. */
function damageLines(breakdown) {
  const out = [];
  for (const c of breakdown || []) {
    if (!c || c.kind !== 'damage') continue;
    const label = c.label && !/attack roll/i.test(c.label) ? c.label : '';
    const line = componentLine(c);
    if (!line) continue;
    out.push(label && out.length ? `${label}: ${line}` : line);
    if (out.length >= 3) break;
  }
  return out;
}

/** Chance (0..1) that `atk + d20` beats `ac`, folding in advantage. */
function hitChance(atk, ac, adv, dis) {
  let p = clamp((21 - (ac - atk)) / 20, 0.05, 0.95);
  if (adv && !dis) p = 1 - (1 - p) * (1 - p);
  else if (dis && !adv) p *= p;
  return p;
}

/** Average of a dice expression plus a flat modifier; never throws on junk. */
function avgOf(dice, mod) {
  const base = dice ? safe(() => avgExpr(String(dice)), 0) || 0 : 0;
  return Math.max(0, Math.round(base + (mod || 0)));
}

function costTag(cost) {
  return cost === 'bonus' ? 'B' : cost === 'reaction' ? 'R' : cost === 'free' ? '-' : 'A';
}

// ===========================================================================
// 2. THE SCENE
// ===========================================================================

export class BattleScene {
  /**
   * @param {import('../rules/combat.js').Encounter} encounter  a built Encounter
   * @param {object} opts  { onEnd(result), music, fromMapId }
   */
  constructor(encounter, opts = {}) {
    this.id = 'battle';
    this.opaque = true;
    this.pausesBelow = true;

    this.enc = encounter || null;
    this.opts = opts || {};
    this.t = 0;

    // --- presentation ------------------------------------------------------
    this.zoom = 2;
    this.cam = { x: 0, y: 0 };
    this.camTo = { x: 0, y: 0 };
    this.ui = new Map();              // uid -> render state { x, y, dir, phase, ... }
    this.ribbonScroll = 0;

    // --- interaction -------------------------------------------------------
    this.phase = 'intro';             // intro|menu|move|target|anim|enemy|over
    this.menuPath = [];               // [] at the root, [groupId] inside a submenu
    this.menuIndex = 0;
    this.menuTop = 0;
    this.subIndex = 0;
    this.subTop = 0;
    this.options = [];                // cached availableActions(current)
    this.menuDirty = true;
    this.cursor = { x: 0, y: 0 };
    this.pending = null;              // the option being targeted
    this.slotLevel = null;            // chosen slot level while targeting a spell
    this.targetIndex = 0;
    this.targets = { units: [], tiles: [] };
    this.reach = new Map();           // reachableTiles for the current unit
    this.provoke = new Set();         // reachable tiles whose path provokes an OA
    this.threat = new Set();          // every tile some hostile can reach you on
    this.areaCells = [];
    this.areaVictims = [];

    // --- overlays ----------------------------------------------------------
    this.showLog = false;
    this.logScroll = 0;
    this.inspect = null;              // unit being inspected
    this.inspectPinned = false;
    this.inspectHover = false;
    this.banner = null;               // { text, sub, color, t, dur }
    this.dice = null;                 // { roll, t, dur }
    this.rollLines = null;            // { lines, color, t, dur }
    this.prompt = null;               // reaction prompt
    this.results = null;              // victory / defeat panel state
    this.hint = '';

    // --- sequencing --------------------------------------------------------
    this.beats = [];
    this.ff = false;                  // fast-forward held
    this.speed = 1;
    this.autoEnd = true;

    // --- reactions ---------------------------------------------------------
    this.stance = new Map();          // offer.kind -> 'ask' | 'yes' | 'no'
    this._promptedKinds = new Set();

    // --- enemy plan playback ------------------------------------------------
    this._enemyPlans = null;
    this._planIndex = 0;

    // --- boss --------------------------------------------------------------
    this.boss = null;
    this.bossPhase = 0;
  }

  // =========================================================================
  // 2.1 LIFECYCLE
  // =========================================================================

  enter(prev) {
    const enc = this.enc;
    this.t = 0;
    this.autoEnd = Save?.settings?.autoEndTurn !== false;
    FX.clear();

    if (!enc) { this._bail('There is no one here to fight.'); return; }

    // Hand the engine our reaction desk before anything can be rolled.
    enc._onReaction = (reactor, offer) => this._reactionAnswer(reactor, offer);

    if (enc.state === 'setup') safe(() => enc.start());

    // Render state for everyone on the field.
    for (const u of enc.units || []) this._uiOf(u, true);

    this.boss = this._findBoss();
    this.bossPhase = this.boss ? this._phaseOf(this.boss) : 0;

    const focus = enc.current || (enc.units || [])[0];
    if (focus) {
      const f = feetOf(focus);
      this.cam.x = f.x; this.cam.y = f.y - TILE / 2;
      this.camTo.x = this.cam.x; this.camTo.y = this.cam.y;
      this.cursor = { ...posOf(focus) };
    }

    safe(() => Audio.music(enc.boss ? 'boss' : 'battle'));
    sfx('encounter');

    // Opening beats: the boss card, then "roll for initiative", then turn one.
    this.phase = 'anim';
    if (this.boss) {
      const def = this._monsterDef(this.boss);
      this.beats.push({
        k: 'banner', dur: 2.2, color: UI.COLORS.red,
        text: this.boss.name || 'A terrible foe',
        sub: def?.intro || def?.quote || def?.desc || 'The field goes quiet.',
        big: true, sfx: 'roar',
      });
    }
    this.beats.push({
      k: 'banner', dur: 1.0, color: UI.COLORS.gold,
      text: enc.ambush ? 'Ambush!' : 'Roll for Initiative',
      sub: enc.ambush ? 'They were waiting for you.' : `Round ${enc.round || 1}`,
      sfx: 'dice',
    });
    this.beats.push({ k: 'fn', fn: () => this._openTurn() });
  }

  exit() {
    FX.clear();
    if (this.enc) this.enc._onReaction = null;
  }

  /** Something is badly wrong with the encounter — leave without breaking the game. */
  _bail(why) {
    safe(() => bus.emit(EV.TOAST, { text: why }));
    this.phase = 'over';
    this.beats.length = 0;
    if (Game.top === this) Game.pop();
  }

  // =========================================================================
  // 2.2 RENDER STATE PER UNIT
  // =========================================================================

  _uiOf(u, create = false) {
    if (!u || !u.uid) return null;
    let s = this.ui.get(u.uid);
    if (!s && (create || u.uid)) {
      const f = feetOf(u);
      s = {
        x: f.x, y: f.y, dir: u.side === 'foe' ? 'left' : 'right',
        phase: 0, moving: false, wp: [], alpha: 1, flash: 0,
        hp: u.hp || 0, bob: 0, deathDone: false, spawn: this.t,
      };
      this.ui.set(u.uid, s);
    }
    return s;
  }

  _updateUnits(dt) {
    const enc = this.enc;
    if (!enc) return;
    for (const u of enc.units || []) {
      const s = this._uiOf(u, true);
      if (!s) continue;

      // Walk toward the next waypoint, or snap-chase the logical tile.
      const target = s.wp.length ? s.wp[0] : feetOf(u);
      const dx = target.x - s.x, dy = target.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.5) {
        const step = Math.min(d, WALK_PX * dt);
        s.x += (dx / d) * step;
        s.y += (dy / d) * step;
        s.moving = true;
        s.phase += dt * 8;
        if (Math.abs(dx) > Math.abs(dy)) s.dir = dx > 0 ? 'right' : 'left';
        else if (Math.abs(dy) > 0.6) s.dir = dy > 0 ? 'down' : 'up';
      } else {
        s.x = target.x; s.y = target.y;
        if (s.wp.length) { s.wp.shift(); safe(() => Audio.sfx('step', { vol: 0.5 })); }
        else s.moving = false;
      }

      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 3.2);

      // Death: one burst, then fade the sprite out of the world.
      if (isDead(u)) {
        if (!s.deathDone) {
          s.deathDone = true;
          const p = this._fxAt(u);
          FX.burst(p.x, p.y - 8 * this.zoom, u.side === 'foe' ? '#8a2c1e' : '#5a4a7a', 14, { shape: 'smoke', speed: 40, life: 0.7 });
          sfx('death');
        }
        s.alpha = Math.max(0, s.alpha - dt * 1.4);
      } else if (s.alpha < 1) {
        s.alpha = Math.min(1, s.alpha + dt * 2);
      }
    }
  }

  // =========================================================================
  // 2.3 CAMERA
  // =========================================================================

  /** The screen point the camera parks its focus on. */
  _focusPoint() {
    const menuUp = this.phase === 'menu' || this.phase === 'target' || this.phase === 'move';
    return menuUp
      ? { x: FIELD.x + FIELD.w * 0.60, y: FIELD.y + FIELD.h * 0.34 }
      : { x: FIELD.x + FIELD.w * 0.5, y: FIELD.y + FIELD.h * 0.46 };
  }

  _focusOn(wx, wy, snap = false) {
    this.camTo.x = wx; this.camTo.y = wy;
    if (snap) { this.cam.x = wx; this.cam.y = wy; }
  }

  _focusUnit(u, snap = false) {
    if (!u) return;
    const s = this._uiOf(u, true) || feetOf(u);
    this._focusOn(s.x, s.y - TILE / 2, snap);
  }

  _updateCam(dt) {
    const k = Math.min(1, dt * 6.5);
    this.cam.x = lerp(this.cam.x, this.camTo.x, k);
    this.cam.y = lerp(this.cam.y, this.camTo.y, k);
    this._clampCam();
  }

  _clampCam() {
    const enc = this.enc;
    const worldW = (enc?.w || 22) * TILE;
    const worldH = (enc?.h || 15) * TILE;
    const f = this._focusPoint();
    const minX = (f.x - FIELD.x) / this.zoom;
    const maxX = worldW - (FIELD.x + FIELD.w - f.x) / this.zoom;
    const minY = (f.y - FIELD.y) / this.zoom;
    const maxY = worldH - (FIELD.y + FIELD.h - f.y) / this.zoom;
    this.cam.x = minX <= maxX ? clamp(this.cam.x, minX, maxX) : (minX + maxX) / 2;
    this.cam.y = minY <= maxY ? clamp(this.cam.y, minY, maxY) : (minY + maxY) / 2;
  }

  /**
   * Where world pixel (0,0) lands on screen, rounded to a whole device pixel.
   * Rounding here rather than per-sprite keeps the terrain, the grid and the
   * sprites locked to the same pixel lattice — no shimmer while the camera pans.
   */
  _origin() {
    const f = this._focusPoint();
    return { x: R(f.x - this.cam.x * this.zoom), y: R(f.y - this.cam.y * this.zoom) };
  }

  /** World pixels -> screen pixels. */
  _sx(wx) { return wx * this.zoom + this._origin().x; }
  _sy(wy) { return wy * this.zoom + this._origin().y; }

  /** Top-left of a tile in screen pixels. */
  _tileScreen(tx, ty) {
    const o = this._origin();
    return { x: R(tx * TILE * this.zoom + o.x), y: R(ty * TILE * this.zoom + o.y) };
  }

  /** Screen pixels -> tile coords (mouse picking). */
  _screenToTile(px, py) {
    const o = this._origin();
    const wx = (px - o.x) / this.zoom;
    const wy = (py - o.y) / this.zoom;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
  }

  /**
   * A unit's anchor for FX, in "zoomed world space": FX draws at 1x pixel size, so
   * effects stay crisp and correctly sized while still following the camera.
   */
  _fxAt(u, dy = -10) {
    const s = this._uiOf(u, true) || feetOf(u);
    return { x: (s.x) * this.zoom, y: (s.y + dy) * this.zoom };
  }

  _fxTile(tx, ty) {
    return { x: (tx * TILE + TILE / 2) * this.zoom, y: (ty * TILE + TILE / 2) * this.zoom };
  }

  // =========================================================================
  // 2.4 UPDATE
  // =========================================================================

  update(dt) {
    this.t += dt;
    const enc = this.enc;
    if (!enc) return;

    // Fast forward: hold Run to skip the pauses between steps.
    this.ff = Input.down('run');
    const setting = Number(Save?.settings?.battleSpeed) || 1;
    this.speed = clamp(setting * (this.ff ? 3.2 : 1), 0.25, 6);
    FX.speed = this.speed;

    const sdt = dt * this.speed;

    this._updateUnits(sdt);
    this._updateCam(dt);
    this._updateOverlayTimers(sdt);
    this._checkBossPhase();

    // Global toggles work in almost every phase.
    this._globalKeys();

    if (this.prompt) { this._updatePrompt(sdt); return; }
    if (this.showLog) { this._updateLog(); return; }
    if (this.results) { this._updateResults(); return; }

    if (this.beats.length) { this._updateBeats(sdt); return; }

    switch (this.phase) {
      case 'menu': this._updateMenu(dt); break;
      case 'move': this._updateMove(dt); break;
      case 'target': this._updateTarget(dt); break;
      case 'enemy': this._runEnemyTurn(); break;
      case 'anim':
        // The queue drained without a beat naming the next phase — recover.
        this.phase = this._isPlayerControlled(enc.current) ? 'menu' : 'enemy';
        this.menuDirty = true;
        break;
      default: break;
    }
  }

  _updateOverlayTimers(dt) {
    if (this.banner) { this.banner.t += dt; if (this.banner.t >= this.banner.dur) this.banner = null; }
    if (this.dice) { this.dice.t += dt; if (this.dice.t >= this.dice.dur) this.dice = null; }
    if (this.rollLines) { this.rollLines.t += dt; if (this.rollLines.t >= this.rollLines.dur) this.rollLines = null; }
  }

  _globalKeys() {
    if (Input.pressed('journal')) {
      this.showLog = !this.showLog;
      this.logScroll = 0;
      sfx(this.showLog ? 'open' : 'close');
      Input.consume('journal');
    }
    if (Input.pressed('map')) {
      this.zoom = this.zoom === 2 ? 1 : 2;
      FX.clear();
      this._clampCam();
      sfx('cursor');
      Input.consume('map');
    }
    if (Input.pressed('party') && !this.results) {
      this.inspectPinned = !this.inspectPinned;
      if (!this.inspectPinned) this.inspect = null;
      else this.inspect = this.inspect || this.enc?.current || null;
      sfx('cursor');
      Input.consume('party');
    }
  }

  // =========================================================================
  // 2.5 TURN FLOW
  // =========================================================================

  /** Open whatever turn the encounter says is current. */
  _openTurn() {
    const enc = this.enc;
    if (!enc) return;
    if (this._checkOver()) return;

    if (enc.state !== 'active') { this._checkOver(); return; }

    // beginTurn() rolls death saves internally, so watch the log to make those
    // dice as visible as every other d20 in the fight.
    const logMark = (enc.log || []).length;
    const res = safe(() => enc.beginTurn(), null);
    this._pushDeathSaveBeats((enc.log || []).slice(logMark));
    if (this._checkOver()) return;

    const unit = enc.current;
    if (!unit) { this._checkOver(); return; }

    // beginTurn may have auto-skipped a stunned or dying creature.
    if (res && res.downed) { this.beats.push({ k: 'fn', fn: () => this._openTurn() }); return; }

    this.menuDirty = true;
    this.pending = null;
    this.slotLevel = null;
    this.menuPath = [];
    this.menuIndex = 0;
    this.menuTop = 0;
    this.hint = '';
    this._scanIndex = -1;         // Q/R field scan starts from the acting unit
    this.cursor = { ...posOf(unit) };
    this._focusUnit(unit);
    this._recomputeReach(unit);

    const mine = this._isPlayerControlled(unit);
    this.beats.push({
      k: 'banner', dur: mine ? 0.7 : 0.5,
      color: unit.side === 'foe' ? UI.COLORS.red : UI.COLORS.blue,
      text: unit.name || 'A combatant',
      sub: `Round ${enc.round} · ${mine ? 'your move' : 'acting'}`,
    });
    this.beats.push({
      k: 'fn',
      fn: () => {
        if (this._checkOver()) return;
        if (mine) { this.phase = 'menu'; this.menuDirty = true; }
        else { this.phase = 'enemy'; this._enemyPlans = null; }
      },
    });
    this.phase = 'anim';
  }

  /**
   * Turn a "makes a death saving throw: d20 [13] = 13 vs DC 10 — success" log line
   * back into an animated d20. The engine rolls these inside beginTurn(), so
   * reading them out of the log is the only way to put them on screen.
   */
  _pushDeathSaveBeats(lines) {
    const showRolls = Save?.settings?.showRolls !== false;
    for (const l of lines || []) {
      const text = l && l.text ? String(l.text) : '';
      if (!/death saving throw/i.test(text)) continue;
      const m = text.match(/d20\s*\[([\d/]+)\][^=]*=\s*(-?\d+)/);
      if (!m) continue;
      const faces = m[1].split('/').map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n));
      const total = parseInt(m[2], 10);
      const ok = /success|natural 20|stabilis/i.test(text);
      const nat20 = /natural 20/i.test(text);
      const nat1 = /natural 1\b/i.test(text);
      const natural = nat20 ? 20 : nat1 ? 1 : (faces.length ? Math.max(...faces) : total);
      this.beats.push({
        k: 'dice', silent: !showRolls, dur: DICE_HOLD,
        roll: {
          natural, total, mod: total - natural, rolls: faces.length ? faces : [natural],
          crit: nat20, fumble: nat1, adv: faces.length > 1, dis: false,
          dc: 10, hit: ok,
          label: nat20 ? 'REVIVED' : ok ? 'SAVED' : 'FAILED',
          labelColor: nat20 ? UI.COLORS.goldBright : ok ? UI.COLORS.good : UI.COLORS.bad,
        },
      });
      this.beats.push({
        k: 'banner', dur: 0.7,
        color: ok ? UI.COLORS.good : UI.COLORS.red,
        text: 'Death Saving Throw',
        sub: UI.fit(text.replace(/^.*?: /, ''), 240, 'sm'),
      });
    }
  }

  _isPlayerControlled(u) {
    if (!u) return false;
    if (u.side !== 'party') return false;
    if (u.kind === 'monster') return false;                     // a summon runs itself
    if (Party.autoBattle && Party.autoBattle[u.uid]) return false;
    return true;
  }

  _endTurn() {
    const enc = this.enc;
    if (!enc) return;
    this.pending = null;
    this.areaCells = [];
    safe(() => enc.endTurn());
    if (this._checkOver()) return;
    this.beats.push({ k: 'fn', fn: () => this._openTurn() });
    this.phase = 'anim';
  }

  /** Did the fight just finish? Sets up the results panel if so. */
  _checkOver() {
    const enc = this.enc;
    if (!enc) return true;
    if (this.results) return true;
    if (!safe(() => enc.isOver(), false)) return false;

    this.beats.length = 0;
    this.phase = 'over';
    const r = safe(() => enc.result(), null) || { state: enc.state };
    if (r.victory) this._openVictory(r);
    else this._openDefeat(r);
    return true;
  }

  // =========================================================================
  // 2.6 THE ACTION MENU
  // =========================================================================

  _refreshOptions() {
    const enc = this.enc;
    const unit = enc?.current;
    this.options = unit ? (safe(() => enc.availableActions(unit), []) || []) : [];
    this.menuDirty = false;
  }

  /** Group the engine's flat option list into the screen's short root menu. */
  _rootMenu() {
    const enc = this.enc;
    const unit = enc?.current;
    if (!unit) return [];
    if (this.menuDirty) this._refreshOptions();
    const all = this.options;
    const budget = this._budget();

    const pick = (fn) => all.filter(fn);
    const byId = (id) => all.find((o) => o.id === id);

    const group = (id, name, icon, list, emptyReason) => {
      const enabled = list.some((o) => o.enabled);
      const reason = enabled ? '' : (list.length ? (list.find((o) => o.reason)?.reason || 'Unavailable') : emptyReason);
      return {
        id: `@${id}`, name, icon, group: true, sub: list,
        enabled: enabled && list.length > 0,
        reason: list.length ? reason : emptyReason,
        desc: list.length ? `${list.length} option${list.length === 1 ? '' : 's'}.` : emptyReason,
      };
    };

    const rows = [];

    const attacks = pick((o) => o.kind === 'attack');
    if (attacks.length) rows.push(group('attack', 'Attack', 'sword', attacks, 'Nothing to attack with.'));

    const spells = pick((o) => o.kind === 'spell' || String(o.id).startsWith('spell:'));
    if (spells.length) rows.push(group('cast', 'Cast a Spell', 'staff', spells, 'You know no spells.'));

    const specials = pick((o) => String(o.id).startsWith('special:'));
    if (specials.length) rows.push(group('class', 'Class Action', 'star', specials, 'No class features ready.'));

    const items = pick((o) => o.kind === 'item');
    if (items.length) rows.push(group('item', 'Use an Item', 'potion', items, 'The pack is empty.'));

    // Move is not an engine option — it is the scene's own targeting mode.
    rows.push({
      id: '@move', name: 'Move', icon: 'foot', move: true,
      enabled: (budget.movement || 0) > 0 && this.reach.size > 0,
      reason: (budget.movement || 0) > 0 ? 'Nowhere to go.' : 'No movement left.',
      desc: `Walk up to ${budget.movement || 0} ft. Leaving a foe's reach provokes an Opportunity Attack.`,
    });

    for (const id of ['dash', 'dodge', 'disengage', 'hide', 'help', 'shove', 'grapple', 'search', 'ready']) {
      const o = byId(id);
      if (o) rows.push(o);
    }

    // Retreat is the scene's own verb; the engine resolves it as a group check.
    rows.push({
      id: '@flee', name: 'Retreat', icon: 'run', flee: true, enabled: (budget.action || 0) > 0,
      reason: 'No action left.',
      desc: 'A group Dexterity contest against the enemy. Fail and you lose your action.',
    });

    rows.push({
      id: '@reactions', name: 'Reactions', icon: 'shield', stance: true, enabled: true,
      desc: 'Set how this character answers reaction prompts for the rest of the fight.',
    });

    const end = byId('end');
    rows.push(end || { id: 'end', name: 'End Turn', icon: 'hourglass', enabled: true, desc: 'Finish your turn.' });
    return rows;
  }

  _currentRows() {
    if (!this.menuPath.length) return this._rootMenu();
    const root = this._rootMenu();
    const g = root.find((r) => r.id === this.menuPath[0]);
    if (g && g.sub) return g.sub;
    if (this.menuPath[0] === '@reactions') return this._stanceRows();
    return root;
  }

  _stanceRows() {
    const kinds = [
      ['opportunity-attack', 'Opportunity Attack', 'Strike a foe that leaves your reach.'],
      ['shield', 'Shield', 'Cast Shield for +5 AC against the triggering attack.'],
      ['defensive', 'Defensive Reactions', 'Parry, Deflect Attacks, Uncanny Dodge and the like.'],
      ['other', 'Everything Else', 'Any other reaction the rules offer you.'],
    ];
    return kinds.map(([id, name, desc]) => {
      const st = this.stance.get(id) || 'ask';
      return {
        id: `@stance:${id}`, name: `${name}: ${titleCase(st)}`, icon: 'shield',
        enabled: true, stanceKind: id,
        desc: `${desc}  Currently: ${st === 'ask' ? 'ask me the first time' : st === 'yes' ? 'always use it' : 'never use it'}.`,
      };
    });
  }

  _budget() {
    const enc = this.enc;
    return (enc && enc.budget) || { action: 0, bonus: 0, reaction: 0, movement: 0, moveMax: 0 };
  }

  _updateMenu(dt) {
    const enc = this.enc;
    const unit = enc?.current;
    if (!unit) { this._checkOver(); return; }
    if (this.menuDirty) this._refreshOptions();

    const rows = this._currentRows();
    if (!rows.length) { this._endTurn(); return; }
    const inSub = this.menuPath.length > 0;
    let idx = inSub ? this.subIndex : this.menuIndex;
    idx = clamp(idx, 0, rows.length - 1);

    // --- keyboard ---------------------------------------------------------
    let moved = 0;
    if (Input.repeat('up', 0.3, 0.08)) moved = -1;
    else if (Input.repeat('down', 0.3, 0.08)) moved = 1;
    if (moved) {
      idx = (idx + moved + rows.length) % rows.length;
      this.hint = '';
      sfx('cursor');
    }

    // Left/right pages through a long submenu.
    if (inSub && rows.length > MENU_ROWS) {
      if (Input.pressed('right')) { idx = Math.min(rows.length - 1, idx + MENU_ROWS); sfx('cursor'); }
      if (Input.pressed('left')) { idx = Math.max(0, idx - MENU_ROWS); sfx('cursor'); }
    }

    // --- mouse ------------------------------------------------------------
    const m = Input.mouse;
    const listY = MENU.y + 14;
    const top = inSub ? this.subTop : this.menuTop;
    if (m.over && m.x >= MENU.x && m.x <= MENU.x + MENU.w && m.y >= listY && m.y < listY + MENU_ROWS * MENU_ROW_H) {
      const hovered = top + Math.floor((m.y - listY) / MENU_ROW_H);
      if (hovered >= 0 && hovered < rows.length) {
        if (hovered !== idx) { idx = hovered; sfx('cursor'); }
        if (m.clicked) { this._chooseRow(rows[idx]); return; }
      }
    } else if (this._mouseOnField()) {
      // Hovering the field inspects whoever is standing there; a click pins the card.
      const t = this._screenToTile(m.x, m.y);
      const u = this._unitAtTile(t.x, t.y);
      this.inspectHover = !!u;
      if (u && !this.inspectPinned) this.inspect = u;
      if (m.clicked) {
        if (u) { this.inspect = u; this.inspectPinned = true; sfx('select'); }
        else { this.inspectPinned = false; this.inspect = null; }
      }
    } else if (!this.inspectPinned) {
      this.inspectHover = false;
    }

    if (inSub) this.subIndex = idx; else this.menuIndex = idx;

    // --- scan the field ---------------------------------------------------
    // The camera follows whoever is acting, and a 400px window at 2x zoom shows
    // about twelve tiles. Q and R walk the enemies so you can actually go and
    // look at what you are about to be told is out of range.
    if (Input.consume('next')) { this._scanFoes(1); return; }
    if (Input.consume('prev')) { this._scanFoes(-1); return; }

    // --- shortcuts --------------------------------------------------------
    if (!inSub) {
      const jump = (gid) => {
        const r = this._rootMenu().findIndex((x) => x.id === gid);
        if (r >= 0) { this.menuIndex = r; this._chooseRow(this._rootMenu()[r]); return true; }
        return false;
      };
      if (Input.consume('tab1')) { jump('@attack'); return; }
      if (Input.consume('tab2')) { jump('@cast'); return; }
      if (Input.consume('tab3')) { jump('@item'); return; }
      if (Input.consume('tab4')) { jump('@move'); return; }
      if (Input.consume('tab5')) { this._endTurn(); return; }
      if (Input.consume('interact')) {
        // Hand this character to the AI for the rest of the fight.
        Party.autoBattle = Party.autoBattle || {};
        Party.autoBattle[unit.uid] = true;
        safe(() => bus.emit(EV.TOAST, { text: `${unit.name} will fight on instinct.` }));
        sfx('select');
        this.phase = 'enemy';
        this._enemyPlans = null;
        return;
      }
    }

    if (Input.consume('confirm')) { this._chooseRow(rows[idx]); return; }
    if (Input.consume('cancel')) {
      if (inSub) { this.menuPath = []; this.subIndex = 0; this.subTop = 0; sfx('back'); }
      else { this.inspect = null; this.inspectPinned = false; sfx('back'); }
    }
  }

  /**
   * Step the camera to the next living enemy (or back to the acting unit), pin
   * their stat card, and say how far off they are. `dir` walks the list.
   */
  _scanFoes(dir) {
    const enc = this.enc;
    const cur = enc?.current;
    const foes = (enc?.units || []).filter((u) => u && !isDead(u) && u.side !== (cur?.side || 'party'));
    if (!foes.length) { sfx('error'); this.hint = 'Nothing left to look at.'; return; }

    // Nearest first, so the first press lands on whoever matters most.
    if (cur) foes.sort((a, b) => safe(() => distanceFt(cur, a), 0) - safe(() => distanceFt(cur, b), 0));

    const at = this._scanIndex == null ? -1 : this._scanIndex;
    let next = at + dir;
    if (next >= foes.length || next < -1) next = next >= foes.length ? -1 : foes.length - 1;
    this._scanIndex = next;

    if (next < 0) {
      // Back to the acting unit — always one press away, never a hunt.
      this.inspect = null;
      this.inspectPinned = false;
      if (cur) this._lookAt(cur);
      this.hint = '';
      sfx('cursor');
      return;
    }

    const u = foes[next];
    this.inspect = u;
    this.inspectPinned = true;
    this._lookAt(u);
    const ft = cur ? safe(() => distanceFt(cur, u), 0) : 0;
    this.hint = `${u.name} — ${ft}ft away, ${Math.max(0, u.hp)}/${safe(() => maxHpOf(u), u.maxHp || 1)} hp.`;
    sfx('cursor');
  }

  /** Pan the camera onto a unit without changing whose turn it is. */
  _lookAt(u) {
    if (!u) return;
    const f = feetOf(u);
    this.camTo.x = f.x;
    this.camTo.y = f.y - TILE / 2;
    this.cursor = { ...posOf(u) };
  }

  _chooseRow(row) {
    if (!row) return;
    this._scanIndex = -1;
    const enc = this.enc;
    const unit = enc?.current;
    if (!unit) return;

    if (!row.enabled) { sfx('error'); this.hint = row.reason || 'Not available.'; return; }

    if (row.stance) { this.menuPath = ['@reactions']; this.subIndex = 0; this.subTop = 0; sfx('select'); return; }
    if (row.stanceKind) {
      const cur = this.stance.get(row.stanceKind) || 'ask';
      const next = cur === 'ask' ? 'yes' : cur === 'yes' ? 'no' : 'ask';
      this.stance.set(row.stanceKind, next);
      sfx('select');
      return;
    }
    if (row.group) {
      if (row.sub.length === 1 && row.sub[0].enabled) { this._beginOption(row.sub[0]); return; }
      this.menuPath = [row.id];
      this.subIndex = Math.max(0, row.sub.findIndex((o) => o.enabled));
      this.subTop = 0;
      sfx('select');
      return;
    }
    if (row.move) { this._beginMove(); return; }
    if (row.flee) { this._doFlee(); return; }
    if (row.id === 'end') { sfx('select'); this._endTurn(); return; }

    this._beginOption(row);
  }

  // =========================================================================
  // 2.7 MOVEMENT
  // =========================================================================

  _recomputeReach(unit) {
    const enc = this.enc;
    this.reach = new Map();
    this.provoke = new Set();
    this.threat = new Set();
    if (!enc || !unit) return;
    this.reach = safe(() => enc.reachableTiles(unit), new Map()) || new Map();

    // Which squares are threatened by which hostile — a move provokes when the path
    // steps OUT of a square a hostile threatens (2024 PHB Opportunity Attacks).
    const threats = [];
    for (const f of enc.units || []) {
      if (!f || f === unit || isDead(f) || f.hp <= 0) continue;
      if (f.side === unit.side) continue;
      if (f._reactionUsed) continue;
      const set = new Set();
      for (const t of safe(() => enc.threatTiles(f), []) || []) set.add(key(t.x, t.y));
      // The union is what the player actually needs to see: the squares where
      // something can reach you. It was already being computed and thrown away.
      for (const k of set) this.threat.add(k);
      if (set.size) threats.push({ set, at: key(posOf(f).x, posOf(f).y) });
    }
    if (!threats.length) return;

    const start = posOf(unit);
    for (const [k, node] of this.reach) {
      const path = [{ x: start.x, y: start.y }, ...(node.path || [])];
      let bad = false;
      for (let i = 0; i < path.length - 1 && !bad; i++) {
        const a = key(path[i].x, path[i].y), b = key(path[i + 1].x, path[i + 1].y);
        for (const th of threats) {
          if (th.set.has(a) && !th.set.has(b) && b !== th.at) { bad = true; break; }
        }
      }
      if (bad) this.provoke.add(k);
    }
  }

  _beginMove() {
    const unit = this.enc?.current;
    if (!unit) return;
    this._recomputeReach(unit);
    if (!this.reach.size) { sfx('error'); this.hint = 'There is nowhere to go.'; return; }
    this.phase = 'move';
    this.hint = '';
    this.cursor = { ...posOf(unit) };
    sfx('select');
  }

  _updateMove(dt) {
    const enc = this.enc;
    const unit = enc?.current;
    if (!unit) return;

    const before = key(this.cursor.x, this.cursor.y);
    this._moveCursor();
    if (key(this.cursor.x, this.cursor.y) !== before) {
      sfx('cursor');
      this._focusOn(this.cursor.x * TILE + TILE / 2, this.cursor.y * TILE + TILE / 2);
    }

    const m = Input.mouse;
    const onField = this._mouseOnField();
    if (onField && m.moved) {
      const t = this._screenToTile(m.x, m.y);
      if (this.reach.has(key(t.x, t.y))) this.cursor = { x: t.x, y: t.y };
    }

    const node = this.reach.get(key(this.cursor.x, this.cursor.y));
    this.hint = node
      ? `${node.cost} ft${this.provoke.has(key(this.cursor.x, this.cursor.y)) ? ' — provokes!' : ''}`
      : 'Out of reach.';

    if (Input.consume('confirm') || (m.clicked && onField)) {
      if (!node) { sfx('error'); return; }
      this._commitMove(unit, node);
      return;
    }
    if (Input.consume('cancel')) { this.phase = 'menu'; this.hint = ''; sfx('back'); }
  }

  _commitMove(unit, node) {
    const enc = this.enc;
    const s = this._uiOf(unit, true);
    const path = (node.path || []).slice();
    sfx('select');

    const res = safe(() => enc.moveUnit(unit, path), null) || { steps: [], provoked: [] };

    // Walk the sprite across the squares the engine actually let it cross.
    if (s) {
      s.wp = (res.steps || []).map((p) => ({ x: p.x * TILE + TILE / 2, y: (p.y + 1) * TILE }));
      if (!s.wp.length) s.wp = [];
    }

    this.phase = 'anim';
    this.beats.push({ k: 'walk', unit });
    this.beats.push({ k: 'camera', unit, dur: 0.1 });

    // Opportunity attacks that landed while it ran.
    for (const p of res.provoked || []) {
      const atk = enc.byUid ? enc.byUid(p.attacker) : null;
      this.beats.push({ k: 'banner', dur: 0.55, color: UI.COLORS.warn, text: 'Opportunity Attack', sub: atk?.name || '' });
      this._pushAttackBeats(atk, unit, p.result, null);
    }

    this.beats.push({
      k: 'fn',
      fn: () => {
        if (this._checkOver()) return;
        this.menuDirty = true;
        this._recomputeReach(unit);
        this.cursor = { ...posOf(unit) };
        this._focusUnit(unit);
        this.phase = this._isPlayerControlled(unit) ? 'menu' : 'enemy';
      },
    });
  }

  _moveCursor() {
    const enc = this.enc;
    let dx = 0, dy = 0;
    if (Input.repeat('left', 0.26, 0.07)) dx = -1;
    if (Input.repeat('right', 0.26, 0.07)) dx = 1;
    if (Input.repeat('up', 0.26, 0.07)) dy = -1;
    if (Input.repeat('down', 0.26, 0.07)) dy = 1;
    if (!dx && !dy) return;
    const nx = clamp(this.cursor.x + dx, 0, (enc?.w || 22) - 1);
    const ny = clamp(this.cursor.y + dy, 0, (enc?.h || 15) - 1);
    this.cursor = { x: nx, y: ny };
  }

  // =========================================================================
  // 2.8 TARGETING
  // =========================================================================

  _beginOption(option) {
    const enc = this.enc;
    const unit = enc?.current;
    if (!unit || !option) return;
    if (!option.enabled) { sfx('error'); this.hint = option.reason || 'Not available.'; return; }

    const t = option.targeting || { kind: 'self' };
    const kind = String(t.kind || 'self').toLowerCase();
    this.pending = option;
    this.slotLevel = Array.isArray(option.levels) && option.levels.length
      ? option.levels[0]
      : (option.level != null ? option.level : null);

    if (kind === 'self') { this._commitOption(null); return; }

    this.targets = safe(() => enc.targetsFor(unit, option), { units: [], tiles: [] }) || { units: [], tiles: [] };
    const areaMode = !!t.shape || kind === 'point' || kind === 'area';

    if (areaMode) {
      const first = this.targets.units[0];
      this.cursor = first ? { ...posOf(first) } : { ...posOf(unit) };
    } else {
      if (!this.targets.units.length) {
        this.pending = null;
        sfx('error');
        this.hint = 'No legal target in range.';
        return;
      }
      this.targetIndex = 0;
      this.cursor = { ...posOf(this.targets.units[0]) };
    }
    this.phase = 'target';
    this._recomputeArea();
    sfx('select');
  }

  _isAreaOption(option) {
    const t = option?.targeting || {};
    const kind = String(t.kind || '').toLowerCase();
    return !!t.shape || kind === 'point' || kind === 'area';
  }

  _recomputeArea() {
    const enc = this.enc;
    const unit = enc?.current;
    const o = this.pending;
    this.areaCells = [];
    this.areaVictims = [];
    if (!enc || !unit || !o || !this._isAreaOption(o)) return;
    const cells = safe(() => enc.areaPreview(unit, o, { x: this.cursor.x, y: this.cursor.y }), []) || [];
    this.areaCells = cells;
    const set = new Set(cells.map((c) => key(c.x, c.y)));
    for (const u of enc.units || []) {
      if (!u || isDead(u)) continue;
      const p = posOf(u);
      if (set.has(key(p.x, p.y))) this.areaVictims.push(u);
    }
  }

  _updateTarget(dt) {
    const enc = this.enc;
    const unit = enc?.current;
    const o = this.pending;
    if (!enc || !unit || !o) { this.phase = 'menu'; return; }

    const area = this._isAreaOption(o);
    const m = Input.mouse;
    const onField = this._mouseOnField();

    if (area) {
      const before = key(this.cursor.x, this.cursor.y);
      this._moveCursor();
      if (onField && m.moved) {
        const t = this._screenToTile(m.x, m.y);
        this.cursor = { x: clamp(t.x, 0, enc.w - 1), y: clamp(t.y, 0, enc.h - 1) };
      }
      if (key(this.cursor.x, this.cursor.y) !== before) {
        sfx('cursor');
        this._recomputeArea();
        this._focusOn(this.cursor.x * TILE + TILE / 2, this.cursor.y * TILE + TILE / 2);
      }
    } else {
      const list = this.targets.units;
      let moved = 0;
      if (Input.repeat('right', 0.28, 0.1) || Input.repeat('down', 0.28, 0.1) || Input.pressed('next')) moved = 1;
      if (Input.repeat('left', 0.28, 0.1) || Input.repeat('up', 0.28, 0.1) || Input.pressed('prev')) moved = -1;
      if (moved && list.length) {
        this.targetIndex = (this.targetIndex + moved + list.length) % list.length;
        sfx('cursor');
      }
      if (onField && m.moved) {
        const t = this._screenToTile(m.x, m.y);
        const i = list.findIndex((u) => posOf(u).x === t.x && posOf(u).y === t.y);
        if (i >= 0 && i !== this.targetIndex) { this.targetIndex = i; sfx('cursor'); }
      }
      const tgt = list[this.targetIndex];
      if (tgt) {
        this.cursor = { ...posOf(tgt) };
        this.inspect = tgt;
        this._focusOn((this.cursor.x * TILE + posOf(unit).x * TILE) / 2 + TILE / 2,
          (this.cursor.y * TILE + posOf(unit).y * TILE) / 2 + TILE / 2);
      }
    }

    // Slot upcasting, when the engine offered more than one level.
    if (Array.isArray(o.levels) && o.levels.length > 1) {
      if (Input.pressed('tab5')) {
        const i = o.levels.indexOf(this.slotLevel);
        this.slotLevel = o.levels[(i + 1) % o.levels.length];
        sfx('cursor');
      }
    }

    if (Input.consume('confirm') || (m.clicked && onField)) { this._confirmTarget(); return; }
    if (Input.consume('cancel')) {
      this.pending = null;
      this.areaCells = [];
      this.phase = 'menu';
      sfx('back');
    }
  }

  _confirmTarget() {
    const o = this.pending;
    if (!o) return;
    if (this._isAreaOption(o)) {
      this._commitOption({ x: this.cursor.x, y: this.cursor.y });
    } else {
      const tgt = this.targets.units[this.targetIndex];
      if (!tgt) { sfx('error'); return; }
      this._commitOption({ unit: tgt });
    }
  }

  /** Send the choice to the engine and turn the results into animation. */
  _commitOption(target) {
    const enc = this.enc;
    const unit = enc?.current;
    const o = this.pending;
    if (!enc || !unit || !o) return;

    let id = o.id;
    if (this.slotLevel != null && String(id).startsWith('spell:') && o.level > 0) id = `${id}@${this.slotLevel}`;

    this.pending = null;
    this.areaCells = [];
    this.phase = 'anim';

    const spell = o.spellId ? getSpell(o.spellId) : null;
    const res = safe(() => enc.perform(unit, id, target), null) || { ok: false, results: [] };

    if (!res.ok && !(res.results || []).length) {
      sfx('error');
      this.hint = res.error ? `Cannot: ${String(res.error).replace(/-/g, ' ')}.` : 'Nothing happens.';
      this.phase = this._isPlayerControlled(unit) ? 'menu' : 'enemy';
      this.menuDirty = true;
      return;
    }

    this._pushResultBeats(unit, res.results || [], { spell, option: o });
    this.beats.push({
      k: 'fn',
      fn: () => {
        if (this._checkOver()) return;
        this.menuDirty = true;
        this._recomputeReach(unit);
        if (enc.current !== unit) { this.beats.push({ k: 'fn', fn: () => this._openTurn() }); return; }
        // Auto end the turn once the budget is spent, if the player asked for it.
        const b = this._budget();
        if (this.autoEnd && this._isPlayerControlled(unit)
          && (b.action || 0) <= 0 && (b.bonus || 0) <= 0 && (b.movement || 0) <= 0 && (b.attacksLeft || 0) <= 0) {
          this._endTurn();
          return;
        }
        this.phase = this._isPlayerControlled(unit) ? 'menu' : 'enemy';
      },
    });
  }

  _doFlee() {
    const enc = this.enc;
    const unit = enc?.current;
    if (!enc || !unit) return;
    sfx('select');
    const res = safe(() => enc.fleeCheck(unit), null) || { success: false };
    this.phase = 'anim';
    this.beats.push({
      k: 'banner', dur: 1.0,
      color: res.success ? UI.COLORS.good : UI.COLORS.bad,
      text: res.success ? 'You break away!' : 'They cut you off!',
      sub: `${(res.mine || 0).toFixed(1)} vs ${(res.theirs || 0).toFixed(1)} Dexterity`,
    });
    this.beats.push({
      k: 'fn',
      fn: () => {
        if (this._checkOver()) return;
        this.menuDirty = true;
        this.phase = 'menu';
      },
    });
  }

  // =========================================================================
  // 2.9 ENEMY TURNS
  // =========================================================================

  _runEnemyTurn() {
    const enc = this.enc;
    const unit = enc?.current;
    if (!enc || !unit) { this._checkOver(); return; }

    if (!this._enemyPlans) {
      this._enemyPlans = safe(() => takeTurn(enc, unit), null) || [{ kind: 'end' }];
      this._planIndex = 0;
      this._focusUnit(unit);
    }

    const plan = this._enemyPlans[this._planIndex++];
    if (!plan) { this._enemyPlans = null; this._endTurn(); return; }

    if (plan.kind === 'end') { this._enemyPlans = null; this._endTurn(); return; }

    this.phase = 'anim';

    if (plan.kind === 'move') {
      const s = this._uiOf(unit, true);
      const res = safe(() => enc.moveUnit(unit, plan.path || []), null) || { steps: [], provoked: [] };
      if (s) s.wp = (res.steps || []).map((p) => ({ x: p.x * TILE + TILE / 2, y: (p.y + 1) * TILE }));
      this.beats.push({ k: 'camera', unit, dur: 0.12 });
      this.beats.push({ k: 'walk', unit });
      for (const p of res.provoked || []) {
        const atk = enc.byUid ? enc.byUid(p.attacker) : null;
        this.beats.push({ k: 'banner', dur: 0.5, color: UI.COLORS.warn, text: 'Opportunity Attack', sub: atk?.name || '' });
        this._pushAttackBeats(atk, unit, p.result, null);
      }
    } else if (plan.kind === 'action') {
      const optId = String(plan.optionId || '');
      const spellId = optId.startsWith('spell:') ? optId.slice(6).split('@')[0] : null;
      const spell = spellId ? getSpell(spellId) : null;
      const res = safe(() => enc.perform(unit, plan.optionId, plan.target), null) || { results: [] };
      this.beats.push({ k: 'camera', unit, dur: 0.12 });
      this._pushResultBeats(unit, res.results || [], { spell, option: null });
    }

    this.beats.push({ k: 'wait', dur: PLAN_PAUSE });
    this.beats.push({
      k: 'fn',
      fn: () => {
        if (this._checkOver()) return;
        this.phase = 'enemy';
      },
    });
  }

  // =========================================================================
  // 2.10 REACTIONS
  // =========================================================================

  /**
   * The engine's synchronous reaction desk. Returns true/false to decide, or
   * undefined to let rules/combat.js's own default AI answer.
   */
  _reactionAnswer(reactor, offer) {
    if (!reactor || !offer) return undefined;
    if (!this._isPlayerControlled(reactor)) return undefined;   // companions on auto, monsters

    const kind = this._stanceKey(offer);
    const st = this.stance.get(kind) || 'ask';
    if (st === 'yes') { this._noteReaction(reactor, offer, true); return true; }
    if (st === 'no') { this._noteReaction(reactor, offer, false); return false; }

    // Not decided yet: take the engine's sensible default this once, and ask the
    // player so every later offer of this kind obeys them.
    this._queuePrompt(reactor, offer, kind);
    return undefined;
  }

  _stanceKey(offer) {
    const k = String(offer.kind || 'other').toLowerCase();
    if (k.includes('opportunity')) return 'opportunity-attack';
    if (k.includes('shield')) return 'shield';
    if (/parry|deflect|uncanny|riposte|absorb|cutting/.test(k)) return 'defensive';
    return 'other';
  }

  _noteReaction(reactor, offer, used) {
    this.beats.push({
      k: 'banner', dur: 0.5, color: used ? UI.COLORS.good : UI.COLORS.inkDim,
      text: used ? (offer.name || 'Reaction') : 'Reaction held',
      sub: reactor.name || '',
    });
  }

  _queuePrompt(reactor, offer, kind) {
    // Only one prompt per kind per fight; it arms the stance from then on.
    if (this._promptedKinds && this._promptedKinds.has(kind)) return;
    this._promptedKinds = this._promptedKinds || new Set();
    this._promptedKinds.add(kind);
    this.beats.push({
      k: 'prompt',
      make: () => ({
        reactor, offer, kind,
        title: offer.name || 'Reaction',
        body: offer.desc || 'Spend your Reaction when this happens?',
        yes: 'Always', no: 'Never',
        t: 0, dur: 6, index: 0,
      }),
    });
  }

  _updatePrompt(dt) {
    const p = this.prompt;
    if (!p) return;
    p.t += dt;

    if (Input.pressed('left') || Input.pressed('right')) { p.index = p.index ? 0 : 1; sfx('cursor'); }
    const m = Input.mouse;
    const bw = 60, by = 128;
    if (m.over && m.y >= by && m.y <= by + 14) {
      if (m.x >= 118 && m.x <= 118 + bw) p.index = 0;
      else if (m.x >= 222 && m.x <= 222 + bw) p.index = 1;
    }

    let answer = null;
    if (Input.consume('confirm') || (m.clicked && m.y >= by && m.y <= by + 14)) answer = p.index === 0;
    else if (Input.consume('cancel')) answer = false;
    else if (p.t >= p.dur) answer = true;   // timing out keeps the safe, useful default

    if (answer !== null) {
      this.stance.set(p.kind, answer ? 'yes' : 'no');
      safe(() => bus.emit(EV.TOAST, {
        text: `${p.title}: ${answer ? 'always' : 'never'} from now on.`,
      }));
      sfx(answer ? 'select' : 'back');
      this.prompt = null;
    }
  }

  // =========================================================================
  // 2.11 THE BEAT SEQUENCER
  // ---------------------------------------------------------------------
  // Every animation is a queue of small beats. A beat starts once, runs until
  // it says it is finished, then the next one begins. Beats may splice more
  // beats in behind themselves, which is how one AI plan becomes a dozen dice.
  // =========================================================================

  _updateBeats(dt) {
    let guard = 0;
    while (this.beats.length && guard++ < 64) {
      const b = this.beats[0];
      if (!b._started) {
        b._started = true;
        b.t = 0;
        this._startBeat(b);
        if (this.beats[0] !== b) continue;     // the beat replaced itself
      }
      b.t += dt;
      if (this._beatDone(b)) { this.beats.shift(); continue; }
      break;
    }
  }

  _startBeat(b) {
    switch (b.k) {
      case 'fn': {
        // The callback may clear or re-queue the whole list, so remove this beat
        // by identity rather than trusting it to still be at the front.
        safe(() => b.fn && b.fn());
        const i = this.beats.indexOf(b);
        if (i >= 0) this.beats.splice(i, 1);
        break;
      }
      case 'banner':
        this.banner = { text: b.text, sub: b.sub, color: b.color, big: !!b.big, t: 0, dur: b.dur };
        if (b.sfx) sfx(b.sfx);
        break;
      case 'dice':
        if (b.silent) { b.dur = 0.06; break; }
        this.dice = { roll: b.roll, t: 0, dur: b.dur };
        sfx('dice');
        break;
      case 'rollline':
        this.rollLines = { lines: b.lines, color: b.color, t: 0, dur: b.dur };
        // Keep the die on screen while its damage is spelled out beneath it.
        if (this.dice) this.dice.dur = this.dice.t + b.dur;
        break;
      case 'camera':
        if (b.unit) this._focusUnit(b.unit);
        else if (b.point) this._focusOn(b.point.x * TILE + TILE / 2, b.point.y * TILE + TILE / 2);
        break;
      case 'walk':
        break;
      case 'fx':
        safe(() => b.fn && b.fn());
        break;
      case 'prompt':
        this.prompt = safe(() => b.make(), null);
        if (this.prompt) sfx('open');
        break;
      default:
        break;
    }
  }

  _beatDone(b) {
    switch (b.k) {
      case 'walk': {
        const s = this._uiOf(b.unit);
        return !s || (!s.moving && !s.wp.length);
      }
      case 'prompt':
        return this.prompt == null;
      case 'fx':
        return b.t >= (b.dur || 0) && (b.waitFX === false || !FX.busy());
      default:
        return b.t >= (b.dur || 0);
    }
  }

  _wait(dur) { this.beats.push({ k: 'wait', dur }); }

  // =========================================================================
  // 2.12 RESULTS -> BEATS
  // =========================================================================

  _pushResultBeats(actor, results, env = {}) {
    const enc = this.enc;
    const spell = env.spell || null;
    if (spell) {
      this.beats.push({
        k: 'banner', dur: 0.6, color: UI.COLORS.purple,
        text: spell.name || 'A spell', sub: this._spellSub(spell, env.option),
        sfx: 'spell',
      });
    }

    for (const r of results || []) {
      if (!r) continue;
      const target = r.target ? (enc.byUid ? enc.byUid(r.target) : null) : null;
      switch (r.kind) {
        case 'attack': {
          const atk = r.attacker && enc.byUid ? enc.byUid(r.attacker) : actor;
          this._pushAttackBeats(atk, target, r.result, spell);
          break;
        }
        case 'save':
          this._pushSaveBeats(actor, target, r.result, spell);
          break;
        case 'area':
          this._pushAreaBeats(actor, r, spell);
          break;
        case 'damage':
          this._pushDamageFloater(target, r.amount, r.type || 'force');
          break;
        case 'heal':
          this._pushHealBeats(target, r.amount);
          break;
        case 'temphp':
          this._pushSimple(target, `+${r.amount} temp`, UI.COLORS.temp, 'buff');
          break;
        // applyEffect() results are spread into the row, so their own `kind` wins.
        case 'buff':
          this._pushSimple(target || actor, titleCase(String(r.id || 'blessed').replace(/-/g, ' ')), UI.COLORS.good, 'buff');
          break;
        case 'shield':
          this._pushSimple(target || actor, `+${r.ac || 5} AC`, UI.COLORS.silver, 'buff');
          break;
        case 'push':
          this._pushSimple(target, `pushed ${r.distance || 0} ft`, UI.COLORS.warn, 'shove');
          break;
        case 'cure':
          this._pushSimple(target, 'cured', UI.COLORS.good, 'heal');
          break;
        case 'dash':
          this._pushSimple(actor, 'Dash', UI.COLORS.blue, 'buff');
          break;
        case 'dodge':
          this._pushSimple(actor, 'Dodge', UI.COLORS.blue, 'buff');
          break;
        case 'disengage':
          this._pushSimple(actor, 'Disengage', UI.COLORS.blue, 'buff');
          break;
        case 'hide':
          this._pushSimple(actor, r.success ? 'Hidden' : 'Seen', r.success ? UI.COLORS.good : UI.COLORS.bad, r.success ? 'buff' : 'miss');
          break;
        case 'help':
          this._pushSimple(target || actor, 'Helped', UI.COLORS.good, 'buff');
          break;
        case 'shove':
        case 'grapple':
          this._pushSimple(target, r.result?.success ? titleCase(r.kind) : 'Resisted',
            r.result?.success ? UI.COLORS.good : UI.COLORS.inkDim, 'shove');
          break;
        case 'effect':
          if (target) this._pushSimple(target, conditionName(r.id || r.kindId || '') || 'Affected', UI.COLORS.purple, 'debuff');
          break;
        case 'resource':
          this._pushSimple(actor, titleCase(String(r.id || '').replace(/-/g, ' ')), UI.COLORS.gold, 'buff');
          break;
        case 'teleport':
          this.beats.push({
            k: 'fx', dur: 0.3, fn: () => {
              const s = this._uiOf(actor, true);
              if (s) { const f = feetOf(actor); s.x = f.x; s.y = f.y; s.wp = []; }
              const p = this._fxAt(actor);
              FX.burst(p.x, p.y, UI.COLORS.purple, 14, { shape: 'spark', speed: 90, life: 0.4 });
            },
          });
          break;
        default:
          break;
      }
    }
  }

  _spellSub(spell, option) {
    const bits = [];
    if (spell.level === 0) bits.push('Cantrip');
    else bits.push(`${ordinal(this.slotLevel || spell.level)} level`);
    if (spell.school) bits.push(titleCase(spell.school));
    if (spell.concentration) bits.push('Concentration');
    return bits.join(' · ');
  }

  // --- attacks -------------------------------------------------------------

  _pushAttackBeats(attacker, target, res, spell) {
    if (!res || !attacker || !target) return;
    const roll = res.roll;
    const crit = !!res.crit;
    const fumble = !!res.fumble;
    const hit = !!res.hit;
    const showRolls = Save?.settings?.showRolls !== false;

    // 1. face the target
    this.beats.push({
      k: 'fn',
      fn: () => {
        const s = this._uiOf(attacker, true);
        const tp = posOf(target), ap = posOf(attacker);
        if (s) s.dir = Math.abs(tp.x - ap.x) >= Math.abs(tp.y - ap.y)
          ? (tp.x >= ap.x ? 'right' : 'left') : (tp.y >= ap.y ? 'down' : 'up');
      },
    });

    // 2. the d20
    if (roll) {
      this.beats.push({
        k: 'dice', silent: !showRolls,
        dur: (crit || fumble ? DICE_HOLD + 0.35 : DICE_HOLD),
        roll: {
          ...roll,
          ac: res.ac,
          hit,
          crit,
          fumble,
          label: crit ? 'CRITICAL' : fumble ? 'FUMBLE' : hit ? 'HIT' : 'MISS',
          labelColor: crit ? UI.COLORS.goldBright : fumble ? '#ff7a60' : hit ? UI.COLORS.good : UI.COLORS.inkDim,
        },
      });
    }

    // 3. impact
    const ranged = this._isRangedAttack(attacker, target, spell);
    this.beats.push({
      k: 'fx', dur: ranged ? 0.34 : 0.24,
      fn: () => {
        const a = this._fxAt(attacker);
        const p = this._fxAt(target);
        if (crit) { FX.flash('#fff0b8', 0.12, 0.5); FX.shake(0.75, 0.4); sfx('hitcrit'); }
        if (ranged) {
          const style = spell?.vfx || {};
          FX.projectile(a.x, a.y, p.x, p.y, {
            color: style.color || (spell ? UI.COLORS.purple : '#cfc7b4'),
            shape: spell ? 'bolt' : 'arrow',
            speed: 320, arc: spell ? 0 : 14, trail: true,
            onHit: () => { if (hit) this._impact(target, crit, spell); },
          });
          sfx(spell ? 'spell' : 'arrow');
        } else {
          const s = this._uiOf(attacker);
          FX.slash(p.x, p.y, s?.dir || 'right', spell?.vfx?.color || '#ffffff');
          sfx(hit ? (crit ? 'hitcrit' : 'hit') : 'miss');
          if (hit) this._impact(target, crit, spell);
        }
        if (!hit) FX.floater(p.x, p.y - 4, 'MISS', UI.COLORS.inkDim, { size: 'sm' });
      },
    });

    // 4. the damage arithmetic, spelled out
    if (hit && (res.damage || res.applied?.dealt)) {
      const lines = damageLines(res.breakdown);
      const dealt = res.applied?.dealt ?? res.damage ?? 0;
      const resisted = res.applied?.resisted || 0;
      if (resisted) lines.push(`${resisted} resisted`);
      if (showRolls && lines.length) {
        this.beats.push({ k: 'rollline', dur: DMG_HOLD, lines, color: crit ? UI.COLORS.goldBright : '#e88a70' });
      }
      this.beats.push({
        k: 'fx', dur: 0.18,
        fn: () => {
          const p = this._fxAt(target);
          if (Save?.settings?.showDamageNumbers !== false) {
            FX.floater(p.x, p.y - 6, crit ? `${dealt}!` : String(dealt),
              crit ? UI.COLORS.goldBright : '#ff8a70', { crit, size: crit ? 2 : 1.2 });
          }
        },
      });
    }

    // 5. riders: mastery, sneak attack, conditions
    for (const e of res.effects || []) {
      if (!e) continue;
      if (e.kind === 'mastery' && e.id) {
        this.beats.push({
          k: 'fx', dur: 0.12,
          fn: () => {
            const p = this._fxAt(target, -18);
            FX.floater(p.x, p.y, titleCase(e.id), UI.COLORS.warn, { size: 'sm' });
          },
        });
      }
      if (e.kind === 'mastery' && e.id === 'cleave' && e.result) {
        const second = e.target && this.enc.byUid ? this.enc.byUid(e.target) : null;
        this._pushAttackBeats(attacker, second, e.result, null);
      }
    }

    this.beats.push({ k: 'wait', dur: 0.12 });
  }

  _isRangedAttack(attacker, target, spell) {
    if (spell) return spell.attack === 'ranged' || (spell.range !== 'touch' && spell.range !== 'self');
    return safe(() => distanceFt(attacker, target), 5) > 5;
  }

  /** Flash the target, shake it, and throw the right sparks for the damage type. */
  _impact(target, crit, spell) {
    const s = this._uiOf(target, true);
    if (s) s.flash = 1;
    const p = this._fxAt(target);
    const col = spell?.vfx?.color || '#e0604a';
    FX.burst(p.x, p.y, col, crit ? 16 : 8, { shape: 'blood', speed: crit ? 120 : 80, life: 0.35, gravity: 90 });
    if (!crit) FX.shake(0.22, 0.2);
  }

  // --- saves ---------------------------------------------------------------

  _pushSaveBeats(source, target, res, spell) {
    if (!res || !target) return;
    const showRolls = Save?.settings?.showRolls !== false;
    const ok = !!res.success;

    if (res.roll) {
      this.beats.push({
        k: 'dice', silent: !showRolls, dur: DICE_HOLD * 0.85,
        roll: {
          ...res.roll,
          dc: res.dc,
          hit: ok,
          label: ok ? 'SAVED' : 'FAILED',
          labelColor: ok ? UI.COLORS.good : UI.COLORS.bad,
          saveOf: target.name,
          ability: res.ability,
        },
      });
    }

    const dealt = res.applied?.dealt ?? res.damage ?? 0;
    if (dealt > 0) {
      const lines = damageLines(res.breakdown);
      if (ok) lines.push(res.evasion ? 'Evasion — no damage' : 'half on a success');
      if (showRolls && lines.length) {
        this.beats.push({ k: 'rollline', dur: DMG_HOLD * 0.8, lines, color: '#e88a70' });
      }
      this.beats.push({
        k: 'fx', dur: 0.16,
        fn: () => {
          const p = this._fxAt(target);
          const s = this._uiOf(target, true);
          if (s) s.flash = 1;
          if (Save?.settings?.showDamageNumbers !== false) FX.floater(p.x, p.y - 6, String(dealt), '#ff8a70', { size: 1.2 });
          FX.burst(p.x, p.y, spell?.vfx?.color || '#e0604a', 8, { shape: 'ember', speed: 70, life: 0.32 });
        },
      });
    } else if (ok) {
      this.beats.push({
        k: 'fx', dur: 0.14,
        fn: () => {
          const p = this._fxAt(target);
          FX.floater(p.x, p.y - 6, 'SAVED', UI.COLORS.good, { size: 'sm' });
        },
      });
    }

    for (const e of res.effects || []) {
      if (!e || !e.id) continue;
      this.beats.push({
        k: 'fx', dur: 0.1,
        fn: () => {
          const p = this._fxAt(target, -18);
          FX.floater(p.x, p.y, conditionName(e.id) || titleCase(String(e.id)), UI.COLORS.purple, { size: 'sm' });
        },
      });
    }
  }

  // --- areas ---------------------------------------------------------------

  _pushAreaBeats(actor, r, spell) {
    const cells = r.tiles || [];
    const style = spell?.vfx?.style || 'burst';
    const color = spell?.vfx?.color || UI.COLORS.orange;
    const aim = r.aim || (cells.length ? cells[Math.floor(cells.length / 2)] : posOf(actor));

    this.beats.push({
      k: 'fx', dur: style === 'rain' ? 0.7 : 0.45,
      fn: () => {
        const c = this._fxTile(aim.x, aim.y);
        const from = this._fxAt(actor);
        const radius = Math.max(16, Math.sqrt(Math.max(1, cells.length)) * TILE * this.zoom * 0.5);
        switch (style) {
          case 'bolt':
            FX.projectile(from.x, from.y, c.x, c.y, { color, shape: 'bolt', speed: 340 });
            break;
          case 'beam':
            FX.beam(from.x, from.y, c.x, c.y, color, 0.32, { width: 4 });
            break;
          case 'chain':
            FX.chain([from, c], color, 0.4);
            break;
          case 'nova':
            FX.nova(c.x, c.y, color, { radius, count: 22 });
            break;
          case 'rain':
            FX.rain(c.x, c.y, radius, color, { count: 14, dur: 0.7 });
            break;
          case 'aura':
            FX.ring(c.x, c.y, radius, color, 0.5);
            FX.burst(c.x, c.y, color, 12, { shape: 'spark', speed: 40, life: 0.6 });
            break;
          case 'wave':
            FX.ring(c.x, c.y, radius, color, 0.4);
            FX.burst(c.x, c.y, color, 16, { shape: 'smoke', speed: 90, life: 0.5 });
            break;
          case 'slash':
            FX.slash(c.x, c.y, 'right', color, { len: radius });
            break;
          default:
            FX.nova(c.x, c.y, color, { radius, count: 16 });
            break;
        }
        FX.shake(0.3, 0.28);
        sfx(style === 'bolt' || style === 'beam' ? 'spell' : 'fire');
      },
    });
  }

  // --- small feedback ------------------------------------------------------

  _pushHealBeats(target, amount) {
    if (!target || !amount) return;
    this.beats.push({
      k: 'fx', dur: 0.35,
      fn: () => {
        const p = this._fxAt(target);
        FX.burst(p.x, p.y, UI.COLORS.hpHeal, 12, { shape: 'spark', speed: 26, life: 0.7, gravity: -34 });
        FX.floater(p.x, p.y - 6, `+${amount}`, UI.COLORS.hpHeal, { size: 1.2 });
        sfx('heal');
      },
    });
  }

  _pushDamageFloater(target, amount, type) {
    if (!target || !amount) return;
    this.beats.push({
      k: 'fx', dur: 0.2,
      fn: () => {
        const p = this._fxAt(target);
        const s = this._uiOf(target, true);
        if (s) s.flash = 1;
        FX.floater(p.x, p.y - 6, String(amount), UI.DAMAGE_COLORS?.[type] || '#ff8a70', { size: 1.2 });
      },
    });
  }

  _pushSimple(unit, text, color, sound) {
    if (!unit) return;
    this.beats.push({
      k: 'fx', dur: 0.24,
      fn: () => {
        const p = this._fxAt(unit, -18);
        FX.floater(p.x, p.y, text, color, { size: 'sm' });
        if (sound) sfx(sound);
      },
    });
  }

  // =========================================================================
  // 2.13 BOSS PHASES
  // =========================================================================

  /** The creature the boss bar belongs to: a flagged boss, else the biggest foe. */
  _findBoss() {
    const enc = this.enc;
    if (!enc) return null;
    const foes = (enc.units || []).filter((u) => u && u.side === 'foe');
    for (const u of foes) {
      const def = this._monsterDef(u);
      if (u.boss || u.isBoss || def?.boss || (u.legendary && u.legendary.actions)) return u;
    }
    if (!enc.boss) return null;
    let best = null;
    for (const u of foes) if (!best || (u.maxHp || 0) > (best.maxHp || 0)) best = u;
    return best;
  }

  _monsterDef(u) {
    const id = u?.monsterId || u?.id;
    if (!id) return null;
    return safe(() => (MonsterData.MONSTERS || {})[id], null) || null;
  }

  _phaseOf(u) {
    const p = hpPct(u);
    return p > 0.75 ? 0 : p > 0.5 ? 1 : p > 0.25 ? 2 : 3;
  }

  _checkBossPhase() {
    if (!this.boss || isDead(this.boss)) return;
    const now = this._phaseOf(this.boss);
    if (now <= this.bossPhase) return;
    this.bossPhase = now;
    const names = ['', 'Wounded', 'Bloodied', 'Cornered'];
    const lines = [
      '',
      'It shrugs off the wound and presses in.',
      'Blood runs freely — it fights like something with nothing left to lose.',
      'Whatever restraint it had is gone.',
    ];
    this.beats.unshift({
      k: 'banner', dur: 1.1, color: UI.COLORS.red, sfx: 'roar',
      text: `${this.boss.name} — ${names[now]}`, sub: lines[now],
    });
    FX.shake(0.5, 0.5);
  }

  // =========================================================================
  // 2.14 VICTORY & DEFEAT
  // =========================================================================

  _openVictory(result) {
    const enc = this.enc;
    const rw = enc.rewards || safe(() => enc.awardXp(), null) || { xp: 0, share: 0, gold: 0, loot: [], leveled: [] };

    // The engine hands out XP; the purse and the pack are the scene's business.
    if (rw.gold > 0) safe(() => Party.addGold(rw.gold));
    for (const id of rw.loot || rw.items || []) safe(() => Party.addItem(id, 1));

    const members = (enc.units || []).filter((u) => u && u.side === 'party' && u.kind !== 'monster');
    this.results = {
      kind: 'victory',
      xp: rw.xp || 0,
      share: rw.share || 0,
      gold: rw.gold || 0,
      loot: (rw.loot || rw.items || []).slice(),
      leveled: rw.leveled || [],
      members,
      rounds: result?.rounds || enc.round || 1,
      t: 0, index: 0,
    };
    safe(() => Audio.music(null));
    safe(() => (Audio.fanfare ? Audio.fanfare('victory') : Audio.music('victory')));
    sfx('victory');
    FX.flash('#fff4d0', 0.35, 0.5);
  }

  _openDefeat(result) {
    this.results = { kind: 'defeat', t: 0, index: 0, rounds: result?.rounds || this.enc?.round || 1 };
    safe(() => Audio.music(null));
    sfx('defeat');
  }

  _updateResults() {
    const r = this.results;
    if (!r) return;
    r.t += Game.dt || 0.016;
    if (r.t < 0.6) return;

    const m = Input.mouse;
    if (Input.consume('confirm') || Input.consume('cancel') || (m.clicked && m.over)) {
      if (r.kind === 'victory') this._leaveVictory();
      else this._leaveDefeat();
    }
  }

  _leaveVictory() {
    sfx('select');
    const leveled = this.results?.leveled || [];
    const enc = this.enc;
    const chars = leveled
      .map((l) => (enc?.byUid ? enc.byUid(l.uid) : null) || Party.find(l.uid))
      .filter(Boolean);

    const finish = () => {
      if (this.opts.onEnd) safe(() => this.opts.onEnd(safe(() => enc.result(), null)));
      if (Game.top === this) Game.pop();
    };

    if (chars.length) {
      // ui/levelup.js is written by a sibling module; never let a missing file
      // strand the player inside a finished battle.
      import('./levelup.js')
        .then((mod) => {
          const Scene = mod.LevelUpScene || mod.default;
          finish();
          if (Scene) Game.push(new Scene(chars));
        })
        .catch(() => finish());
      return;
    }
    finish();
  }

  _leaveDefeat() {
    sfx('select');
    const enc = this.enc;
    const killer = (enc?.units || []).find((u) => u && u.side === 'foe' && !isDead(u));
    const reason = killer
      ? `Slain by ${killer.name} after ${enc.round} round${enc.round === 1 ? '' : 's'}.`
      : 'The company was overwhelmed.';
    if (Game.top === this) Game.pop();
    safe(() => Game.push(new GameOverScene(reason)));
  }

  // =========================================================================
  // 2.15 THE LOG PANEL
  // =========================================================================

  _updateLog() {
    const lines = this.enc?.log || [];
    const rows = 13;
    const max = Math.max(0, lines.length - rows);
    if (Input.repeat('up', 0.25, 0.05)) this.logScroll = Math.min(max, this.logScroll + 1);
    if (Input.repeat('down', 0.25, 0.05)) this.logScroll = Math.max(0, this.logScroll - 1);
    const w = Input.mouse.wheel;
    if (w) this.logScroll = clamp(this.logScroll + (w > 0 ? 2 : -2), 0, max);
    if (Input.consume('cancel') || Input.consume('confirm')) { this.showLog = false; sfx('close'); }
  }

  /** Is the pointer over open battlefield, rather than a floating panel? */
  _mouseOnField() {
    const m = Input.mouse;
    if (!m.over || m.y <= FIELD.y) return false;
    const inRect = (r) => m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h;
    const menuUp = this.phase === 'menu' || this.phase === 'move' || this.phase === 'target';
    if (menuUp && (inRect(MENU) || inRect(BUDGET) || inRect(DETAIL))) return false;
    if (inRect(LOGTAIL)) return false;
    return true;
  }

  _unitAtTile(x, y) {
    for (const u of this.enc?.units || []) {
      if (!u || isDead(u)) continue;
      const p = posOf(u);
      if (p.x === x && p.y === y) return u;
    }
    return null;
  }

  // =========================================================================
  // 3. DRAWING
  // =========================================================================

  draw(ctx) {
    const enc = this.enc;
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (!enc) return;

    this._drawField(ctx);
  }

  /**
   * The battle interface. Drawn after FX.drawAmbient so a downpour on the field
   * never streaks across the initiative ribbon or the action menu.
   */
  drawUI(ctx) {
    const enc = this.enc;
    if (!enc) return;
    this._drawRibbon(ctx);
    if (this.boss && !isDead(this.boss)) this._drawBossBar(ctx);

    const menuUp = this.phase === 'menu' || this.phase === 'target' || this.phase === 'move';
    if (menuUp) {
      this._drawBudget(ctx);
      // While you are choosing a SQUARE, the list of actions is noise sitting on
      // top of the thing you are reading. The budget strip and the detail panel
      // stay; the 122x114 menu gets out of the way.
      if (this.phase !== 'move') this._drawMenu(ctx);
      this._drawDetail(ctx);
    }

    if (this.inspect && !this.dice && !this.banner
      && (this.inspectPinned || this.inspectHover || this.phase === 'target')) {
      this._drawStatCard(ctx);
    }

    this._drawLogTail(ctx);
    if (this.rollLines) this._drawRollLines(ctx);
    if (this.dice) UI.diceRoll(ctx, DICE.x, DICE.y, this.dice.roll, this.dice.t);
    if (this.banner) this._drawBanner(ctx);
    if (this.showLog) this._drawLogPanel(ctx);
    if (this.prompt) this._drawPrompt(ctx);
    if (this.results) this._drawResults(ctx);
    if (!this.results && !this.showLog) this._drawHints(ctx);
    if (this.ff) UI.text(ctx, VIEW_W - 4, RIBBON.h + 2, '>> FAST', { size: 'sm', color: UI.COLORS.gold, align: 'right', shadow: true });
  }

  // --- the battlefield -----------------------------------------------------

  _drawField(ctx) {
    const sh = (Save?.settings?.screenShake === false || !FX.shakeOffset)
      ? { x: 0, y: 0 } : FX.shakeOffset();

    UI.pushClip(ctx, FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    ctx.save();
    ctx.translate(R(sh.x), R(sh.y));

    // Which tiles are on screen?
    const o = this._origin();
    const left = Math.floor((FIELD.x - o.x) / this.zoom / TILE) - 1;
    const top = Math.floor((FIELD.y - o.y) / this.zoom / TILE) - 1;
    const cols = Math.ceil(FIELD.w / (TILE * this.zoom)) + 3;
    const rows = Math.ceil(FIELD.h / (TILE * this.zoom)) + 3;

    // 1. terrain, authored at 1x and blown up by the canvas transform, so every
    //    source pixel becomes an exact 2x2 block instead of a resampled smear.
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(o.x, o.y);
    ctx.scale(this.zoom, this.zoom);
    this._drawTerrain(ctx, left, top, cols, rows);
    ctx.restore();

    // 2. tactical overlays (screen space, so the lines stay 1px crisp)
    this._drawGrid(ctx, left, top, cols, rows);
    this._drawTacticalOverlays(ctx);

    // 3. combatants, painters-algorithm by their feet
    this._drawUnits(ctx);
    // …and a marker at the edge for everyone the camera has left behind.
    this._drawOffscreen(ctx);

    // 4. effects — spawned in zoomed-world space so they follow the camera while
    //    still drawing at 1x pixel size (crisp sparks, readable damage numbers)
    ctx.save();
    FX.draw(ctx, -o.x, -o.y);
    ctx.restore();

    ctx.restore();
    UI.popClip(ctx);
  }

  _drawTerrain(ctx, left, top, cols, rows) {
    const enc = this.enc;
    const map = enc.map;
    const hasTiles = map && typeof map.at === 'function' && typeof Tiles.drawTile === 'function';
    const palette = BIOME_FLOOR[enc.biome] || BIOME_FLOOR.plains;

    for (let j = 0; j < rows; j++) {
      const ty = top + j;
      for (let i = 0; i < cols; i++) {
        const tx = left + i;
        const px = tx * TILE, py = ty * TILE;
        const inside = tx >= 0 && ty >= 0 && tx < enc.w && ty < enc.h;

        if (!inside) {
          ctx.fillStyle = '#06070d';
          ctx.fillRect(px, py, TILE, TILE);
          continue;
        }

        if (hasTiles) {
          safe(() => {
            Tiles.drawTile(ctx, map.at('ground', tx, ty), px, py, tx, ty);
            const d = map.at('deco', tx, ty);
            if (d) Tiles.drawTile(ctx, d, px, py, tx, ty);
          });
        } else {
          // No tile registry yet: a readable, seeded checker so the arena still reads.
          const n = hashStr(`t${tx}:${ty}`) % palette.length;
          ctx.fillStyle = palette[n];
          ctx.fillRect(px, py, TILE, TILE);
          if ((hashStr(`d${tx}:${ty}`) & 7) === 0) {
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.fillRect(px + 3, py + 5, 6, 4);
          }
          const flags = safe(() => map?.flagAt(tx, ty), 0) || 0;
          if (flags & TILE_FLAGS.SOLID) {
            ctx.fillStyle = '#2b2620';
            ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
            ctx.fillStyle = '#4a4238';
            ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 6);
          }
        }
      }
    }
  }

  _drawGrid(ctx, left, top, cols, rows) {
    if (Save?.settings?.showGrid === false) return;
    const enc = this.enc;
    ctx.fillStyle = 'rgba(240,235,215,0.10)';
    for (let i = 0; i <= cols; i++) {
      const tx = left + i;
      if (tx < 0 || tx > enc.w) continue;
      const x = R(this._sx(tx * TILE));
      if (x < FIELD.x - 1 || x > FIELD.x + FIELD.w) continue;
      ctx.fillRect(x, FIELD.y, 1, FIELD.h);
    }
    for (let j = 0; j <= rows; j++) {
      const ty = top + j;
      if (ty < 0 || ty > enc.h) continue;
      const y = R(this._sy(ty * TILE));
      if (y < FIELD.y - 1 || y > FIELD.y + FIELD.h) continue;
      ctx.fillRect(FIELD.x, y, FIELD.w, 1);
    }
  }

  /** Fill one grid square in screen space. */
  _fillTile(ctx, tx, ty, color, inset = 0) {
    const s = this._tileScreen(tx, ty);
    const w = R(TILE * this.zoom) - inset * 2;
    if (s.x + w < FIELD.x || s.x > FIELD.x + FIELD.w || s.y + w < FIELD.y || s.y > FIELD.y + FIELD.h) return;
    ctx.fillStyle = color;
    ctx.fillRect(s.x + inset, s.y + inset, w, w);
  }

  _strokeTile(ctx, tx, ty, color, t = 1) {
    const s = this._tileScreen(tx, ty);
    const w = R(TILE * this.zoom);
    UI.rectStroke(ctx, s.x, s.y, w, w, color, t);
  }

  _drawTacticalOverlays(ctx) {
    const enc = this.enc;
    const unit = enc.current;

    // --- movement range ----------------------------------------------------
    if (this.phase === 'move' && unit) {
      for (const [k, node] of this.reach) {
        const provokes = this.provoke.has(k);
        this._fillTile(ctx, node.x, node.y, provokes ? 'rgba(200,60,45,0.26)' : 'rgba(70,140,230,0.24)');
        if (node.difficult) {
          // Difficult terrain: a hatch so it reads without a second colour.
          const s = this._tileScreen(node.x, node.y);
          const w = R(TILE * this.zoom);
          ctx.fillStyle = 'rgba(230,200,120,0.22)';
          for (let i = 0; i < w; i += 4) ctx.fillRect(s.x + i, s.y, 1, w);
        }
        // A square inside something's reach gets a red keyline. Fill answers
        // "can I get there"; the keyline answers "will I be in melee when I
        // arrive" — the question that actually decides where you stand.
        if (this.threat.has(k)) {
          const s = this._tileScreen(node.x, node.y);
          const w = R(TILE * this.zoom);
          ctx.fillStyle = 'rgba(232,110,90,0.75)';
          for (let i = 0; i < w; i += 3) {
            ctx.fillRect(s.x + i, s.y, 2, 1);
            ctx.fillRect(s.x + i, s.y + w - 1, 2, 1);
            ctx.fillRect(s.x, s.y + i, 1, 2);
            ctx.fillRect(s.x + w - 1, s.y + i, 1, 2);
          }
        }
      }
      this._drawPath(ctx, unit);
    }

    // --- targeting ---------------------------------------------------------
    if (this.phase === 'target' && this.pending) {
      const area = this._isAreaOption(this.pending);
      if (area) {
        for (const c of this.areaCells) this._fillTile(ctx, c.x, c.y, 'rgba(230,150,60,0.30)');
        for (const c of this.areaCells) this._strokeTile(ctx, c.x, c.y, 'rgba(255,200,110,0.35)');
        for (const v of this.areaVictims) {
          const p = posOf(v);
          this._strokeTile(ctx, p.x, p.y, v.side === 'party' ? UI.COLORS.blue : UI.COLORS.gold, 1);
        }
      } else {
        const valid = new Set(this.targets.units.map((u) => u.uid));
        for (const u of enc.units || []) {
          if (!u || isDead(u)) continue;
          const p = posOf(u);
          if (valid.has(u.uid)) {
            const chosen = this.targets.units[this.targetIndex] === u;
            const s = this._tileScreen(p.x, p.y);
            const w = R(TILE * this.zoom);
            if (chosen) UI.frameSel(ctx, s.x, s.y, w, w, this.t);
            else UI.rectStroke(ctx, s.x, s.y, w, w, UI.COLORS.goldDim, 1);
          } else if (u !== unit) {
            this._fillTile(ctx, p.x, p.y, 'rgba(6,7,13,0.42)');
          }
        }
      }
    }

    // --- the acting creature -----------------------------------------------
    if (unit && (this.phase === 'menu' || this.phase === 'move' || this.phase === 'target')) {
      const p = posOf(unit);
      const s = this._tileScreen(p.x, p.y);
      const w = R(TILE * this.zoom);
      UI.rectStroke(ctx, s.x, s.y, w, w, unit.side === 'foe' ? UI.COLORS.red : UI.COLORS.blue, 1);
    }

    // --- the cursor --------------------------------------------------------
    if (this.phase === 'move' || this.phase === 'target') {
      const s = this._tileScreen(this.cursor.x, this.cursor.y);
      const w = R(TILE * this.zoom);
      UI.frameSel(ctx, s.x, s.y, w, w, this.t, { color: UI.COLORS.goldBright });
    }
  }

  _drawPath(ctx, unit) {
    const node = this.reach.get(key(this.cursor.x, this.cursor.y));
    if (!node) return;
    const start = posOf(unit);
    const pts = [{ x: start.x, y: start.y }, ...(node.path || [])];
    const half = (TILE * this.zoom) / 2;
    const provokes = this.provoke.has(key(this.cursor.x, this.cursor.y));
    const col = provokes ? '#ff8a72' : '#a8d4ff';

    // Dotted line: a dot every third pixel along each leg.
    for (let i = 0; i < pts.length - 1; i++) {
      const a = this._tileScreen(pts[i].x, pts[i].y);
      const b = this._tileScreen(pts[i + 1].x, pts[i + 1].y);
      const ax = a.x + half, ay = a.y + half, bx = b.x + half, by = b.y + half;
      const d = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.round(d / 3));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = R(ax + (bx - ax) * t), py = R(ay + (by - ay) * t);
        if (((s + Math.floor(this.t * 8)) % 2) !== 0) continue;
        ctx.fillStyle = '#0a0708';
        ctx.fillRect(px - 1, py - 1, 3, 3);
        ctx.fillStyle = col;
        ctx.fillRect(px, py, 1, 1);
      }
    }

    // Foot count at the destination.
    const end = this._tileScreen(this.cursor.x, this.cursor.y);
    const label = `${node.cost} ft`;
    const lw = UI.measure(label, 'sm') + 6;
    const lx = clamp(end.x + half - lw / 2, FIELD.x + 2, FIELD.x + FIELD.w - lw - 2);
    const ly = clamp(end.y - 11, FIELD.y + 2, FIELD.y + FIELD.h - 12);
    UI.panel(ctx, lx, ly, lw, 10, { style: 'dark', shadow: 0.4, studs: false });
    UI.text(ctx, lx + lw / 2, ly + 2, label, { size: 'sm', color: provokes ? '#ff9a86' : UI.COLORS.ink, align: 'center' });
  }

  _drawUnits(ctx) {
    const enc = this.enc;
    const list = (enc.units || []).filter((u) => u && this.ui.get(u.uid));
    list.sort((a, b) => (this._uiOf(a).y - this._uiOf(b).y) || (a.uid < b.uid ? -1 : 1));

    for (const u of list) {
      const s = this._uiOf(u);
      if (!s || s.alpha <= 0.02) continue;
      const x = R(this._sx(s.x));
      const y = R(this._sy(s.y));
      if (x < FIELD.x - 40 || x > FIELD.x + FIELD.w + 40) continue;
      if (y < FIELD.y - 60 || y > FIELD.y + FIELD.h + 40) continue;

      const down = u.hp <= 0 && !isDead(u);
      // Whole-number scales only: a fractional one resamples the sprite to mush.
      const scale = Math.max(1, Math.round(this.zoom * sizeScale(u)));
      const tint = s.flash > 0.02 ? '#ff5a4a' : null;

      safe(() => drawActor(ctx, u, x, y, {
        dir: s.dir,
        phase: Math.floor(s.phase),
        moving: s.moving,
        scale,
        alpha: s.alpha * (down ? 0.75 : 1),
        tint,
        tintAmt: s.flash * 0.75,
        shadow: true,
        downed: down,
      }));

      if (!isDead(u)) this._drawUnitTag(ctx, u, x, y, scale);
    }
  }

  /**
   * Combatants the camera cannot show you.
   *
   * The camera pans to whoever is acting, and a wide arena at 2x zoom fits about
   * twelve tiles across. So it is entirely possible — it happened — to open
   * Attack, be told "no legal target in range", and have nothing on screen to
   * explain it: the enemy was thirty feet off the left edge and the game never
   * said so. A pinned arrow with a distance is the whole fix.
   */
  _drawOffscreen(ctx) {
    const enc = this.enc;
    if (!enc || !Array.isArray(enc.units)) return;
    const pad = 9;
    const L = FIELD.x + pad, R2 = FIELD.x + FIELD.w - pad;
    const T = FIELD.y + pad, B = FIELD.y + FIELD.h - pad;
    const cx = (L + R2) / 2, cy = (T + B) / 2;
    const cur = enc.current || null;

    for (const u of enc.units) {
      if (!u || isDead(u)) continue;
      const st = this.ui.get(u.uid);
      if (!st || st.alpha <= 0.05) continue;
      const sx = this._sx(st.x), sy = this._sy(st.y);
      // On screen (with a margin for the sprite's own height)? Nothing to do.
      if (sx >= FIELD.x - 8 && sx <= FIELD.x + FIELD.w + 8
        && sy >= FIELD.y - 4 && sy <= FIELD.y + FIELD.h + 24) continue;

      // Where the line from the middle of the field to the unit leaves the field.
      const dx = sx - cx, dy = sy - cy;
      const tx = dx === 0 ? Infinity : Math.max((L - cx) / dx, (R2 - cx) / dx);
      const ty = dy === 0 ? Infinity : Math.max((T - cy) / dy, (B - cy) / dy);
      const k = Math.min(tx, ty);
      if (!Number.isFinite(k)) continue;
      const ex = R(cx + dx * k), ey = R(cy + dy * k);

      const foe = u.side !== 'party';
      const col = foe ? SIDE_COLOR.foe : SIDE_COLOR.party;
      const pulse = 0.65 + 0.35 * Math.sin(this.t * 4 + (hashStr(u.uid) % 100) / 16);

      // A chevron pointing outward, dark-keyed so it reads over any terrain.
      const ang = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#0a0708';
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(4, 0); ctx.lineTo(-3, -3.5); ctx.lineTo(-3, 3.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();

      // How far, in feet, from whoever is acting — the number the player needs
      // to know whether it is worth walking over there at all.
      if (cur && cur !== u) {
        const ft = safe(() => distanceFt(cur, u), 0) || 0;
        const label = `${ft}ft`;
        const lw = UI.measure(label, 'sm') + 4;
        const lx = clamp(ex - lw / 2, FIELD.x + 1, FIELD.x + FIELD.w - lw - 1);
        const ly = clamp(ey + (dy > 0 ? -12 : 7), FIELD.y + 1, FIELD.y + FIELD.h - 9);
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgba(6,7,13,0.8)';
        ctx.fillRect(R(lx) - 1, R(ly) - 1, R(lw) + 2, 9);
        UI.text(ctx, R(lx) + lw / 2, R(ly), label, { size: 'sm', color: col, align: 'center' });
        ctx.restore();
      }
    }
  }

  /** The floating HP sliver, conditions and marker above a combatant. */
  _drawUnitTag(ctx, u, x, y, scale) {
    const h = 22 * scale;
    const bw = 20;
    const bx = R(x - bw / 2);
    const by = R(y - h - 7);
    if (by < FIELD.y) return;

    const p = hpPct(u);
    const col = u.side === 'party' ? UI.COLORS.hp : '#c05040';
    UI.bar(ctx, bx, by, bw, 3, p, { color: col, bg: '#1a0d0c', border: '#0a0708' });
    if (u.tempHp > 0) {
      ctx.fillStyle = UI.COLORS.temp;
      ctx.fillRect(bx + 1, by + 1, Math.max(1, Math.round((bw - 2) * clamp(u.tempHp / Math.max(1, maxHpOf(u)), 0, 1))), 1);
    }

    if (u.hp <= 0 && !isDead(u)) {
      UI.icon(ctx, 'skull', bx + bw / 2 - 4, by - 9, 8, UI.COLORS.inkDim);
      const ds = u.deathSaves || { success: 0, fail: 0 };
      UI.pips(ctx, bx - 2, by - 5, 3, ds.success, { size: 2, gap: 1, color: UI.COLORS.good });
      UI.pips(ctx, bx + bw - 8, by - 5, 3, ds.fail, { size: 2, gap: 1, color: UI.COLORS.bad });
      return;
    }

    // Condition dots — colour only, so a stack of five still fits over a sprite.
    const badges = safe(() => conditionBadges(u), []) || [];
    if (badges.length) {
      let cx = bx;
      for (let i = 0; i < Math.min(6, badges.length); i++) {
        ctx.fillStyle = '#0a0708';
        ctx.fillRect(cx, by - 4, 3, 3);
        ctx.fillStyle = badges[i].color || UI.COLORS.purple;
        ctx.fillRect(cx, by - 4, 2, 2);
        cx += 4;
      }
    }
    if (u.concentration) {
      UI.icon(ctx, 'rune', bx + bw + 1, by - 3, 7, UI.COLORS.purple);
    }
    if (this.enc.currentUid === u.uid) {
      const bob = Math.round(Math.sin(this.t * 5) * 1.5);
      UI.text(ctx, x, by - 13 + bob, UI.G.chevDown, { size: 'sm', color: UI.COLORS.gold, align: 'center', shadow: true });
    }
  }

  // --- initiative ribbon ---------------------------------------------------

  _drawRibbon(ctx) {
    const enc = this.enc;
    UI.panel(ctx, RIBBON.x - 2, RIBBON.y - 3, RIBBON.w + 4, RIBBON.h + 3, { style: 'dark', shadow: 0.5, studs: false });

    // round chip
    UI.panel(ctx, 2, 2, 30, 21, { style: 'gold', shadow: 0.3, studs: false });
    UI.text(ctx, 17, 3, 'ROUND', { size: 'sm', color: '#3a2607', align: 'center' });
    UI.text(ctx, 17, 11, String(enc.round || 1), { size: 'md', color: '#2a1c07', align: 'center' });

    const x0 = 35, x1 = VIEW_W - 3;
    const avail = x1 - x0;
    const cell = 22;
    const order = enc.order || [];
    const total = order.length * cell;
    const curIdx = Math.max(0, order.indexOf(enc.currentUid));

    // Scroll so the active portrait stays near the left third of the rail.
    let want = 0;
    if (total > avail) want = clamp(curIdx * cell - avail * 0.32, 0, total - avail);
    this.ribbonScroll = lerp(this.ribbonScroll, want, 0.15);

    UI.pushClip(ctx, x0, 0, avail, RIBBON.h);
    for (let i = 0; i < order.length; i++) {
      const u = enc.byUid ? enc.byUid(order[i]) : null;
      if (!u) continue;
      const cur = order[i] === enc.currentUid;
      const px = R(x0 + i * cell - this.ribbonScroll);
      if (px > x1 + cell || px < x0 - cell) continue;

      const size = cur ? 20 : 16;
      const py = cur ? 1 : 4;
      const dead = isDead(u);
      const down = !dead && u.hp <= 0;

      safe(() => UI.portrait(ctx, u, px, py, size, {
        style: u.side === 'party' ? 'window' : 'danger',
        dim: dead || down,
        selected: cur,
        t: this.t,
      }));

      // HP pips beneath: five fifths of the creature's health.
      const filled = dead ? 0 : Math.ceil(hpPct(u) * 5);
      const pw = 5 * 3 + 4 * 1;
      UI.pips(ctx, px + Math.round((size - pw) / 2), py + size + 1, 5, filled, {
        size: 3, gap: 1,
        color: u.side === 'party' ? UI.COLORS.hpHeal : UI.COLORS.hp,
        bg: 'rgba(255,255,255,0.13)',
      });

      if (dead) UI.icon(ctx, 'skull', px + size / 2 - 4, py + size / 2 - 4, 8, '#e8dcc0');

      // Initiative number in the corner.
      const init = enc.initiative?.[u.uid]?.total;
      if (init != null && cur) {
        UI.text(ctx, px + size / 2, py + size + 6, String(init), { size: 'sm', color: UI.COLORS.gold, align: 'center', shadow: true });
      }
    }
    UI.popClip(ctx);

    if (total > avail) {
      if (this.ribbonScroll > 1) UI.text(ctx, x0 - 1, 9, UI.G.chevLeft, { size: 'sm', color: UI.COLORS.goldDim });
      if (this.ribbonScroll < total - avail - 1) UI.text(ctx, x1 - 3, 9, UI.G.chevRight, { size: 'sm', color: UI.COLORS.goldDim });
    }
  }

  _drawBossBar(ctx) {
    const b = this.boss;
    const y = RIBBON.h + 1;
    UI.panel(ctx, 2, y, VIEW_W - 4, 12, { style: 'dark', shadow: 0.4, studs: false });
    const name = UI.fit(b.name || 'Boss', 120, 'sm');
    UI.text(ctx, 6, y + 3, name, { size: 'sm', color: UI.COLORS.gold, shadow: true });
    const bx = 6 + UI.measure(name, 'sm') + 5;
    const bw = VIEW_W - 10 - (bx - 2);
    UI.bar(ctx, bx, y + 3, bw, 6, hpPct(b), {
      color: UI.COLORS.hp, bg: '#1a0d0c', segments: 4,
      label: `${Math.max(0, b.hp)}/${maxHpOf(b)}`, size: 'sm',
    });
  }

  // --- action menu ---------------------------------------------------------

  _drawBudget(ctx) {
    const b = this._budget();
    const unit = this.enc?.current;
    UI.panel(ctx, BUDGET.x, BUDGET.y, BUDGET.w, BUDGET.h, { style: 'dark', shadow: 0.35, studs: false });

    let x = BUDGET.x + 3;
    const dot = (label, on, color) => {
      ctx.fillStyle = '#0a0708';
      ctx.fillRect(x - 1, BUDGET.y + 2, 9, 8);
      ctx.fillStyle = on ? color : 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, BUDGET.y + 3, 7, 6);
      UI.text(ctx, x + 3, BUDGET.y + 3, label, { size: 'sm', color: on ? '#12100c' : UI.COLORS.disabled, align: 'center', shadow: false });
      x += 11;
    };
    dot('A', (b.action || 0) > 0, UI.COLORS.gold);
    dot('B', (b.bonus || 0) > 0, UI.COLORS.green);
    dot('R', (b.reaction || 0) > 0 && !unit?._reactionUsed, UI.COLORS.blue);

    const mv = `${b.movement || 0}/${b.moveMax || 0} ft`;
    UI.icon(ctx, 'foot', x, BUDGET.y + 2, 8, UI.COLORS.inkDim);
    UI.text(ctx, x + 10, BUDGET.y + 3, mv, { size: 'sm', color: UI.COLORS.ink, shadow: true });

    if ((b.attacksLeft || 0) > 0) {
      UI.text(ctx, BUDGET.x + BUDGET.w - 3, BUDGET.y + 3, `x${b.attacksLeft}`, { size: 'sm', color: UI.COLORS.gold, align: 'right', shadow: true });
    }
  }

  _drawMenu(ctx) {
    const enc = this.enc;
    const unit = enc.current;
    if (!unit) return;
    const rows = this._currentRows();
    const inSub = this.menuPath.length > 0;
    const idx = clamp(inSub ? this.subIndex : this.menuIndex, 0, Math.max(0, rows.length - 1));

    UI.panel(ctx, MENU.x, MENU.y, MENU.w, MENU.h, { style: 'window', shadow: 0.5 });

    const title = inSub
      ? (this._rootMenu().find((r) => r.id === this.menuPath[0])?.name || 'Actions')
      : UI.fit(unit.name || 'Actions', MENU.w - 10, 'md');
    UI.text(ctx, MENU.x + 4, MENU.y + 3, title, { size: 'md', color: UI.COLORS.gold, shadow: true, maxWidth: MENU.w - 24 });
    if (rows.length > MENU_ROWS) {
      UI.text(ctx, MENU.x + MENU.w - 4, MENU.y + 3, `${idx + 1}/${rows.length}`, { size: 'sm', color: UI.COLORS.inkDim, align: 'right' });
    }

    // scroll window
    let top = inSub ? this.subTop : this.menuTop;
    if (idx < top) top = idx;
    if (idx > top + MENU_ROWS - 1) top = idx - MENU_ROWS + 1;
    top = clamp(top, 0, Math.max(0, rows.length - MENU_ROWS));
    if (inSub) this.subTop = top; else this.menuTop = top;

    const listY = MENU.y + 14;
    for (let i = 0; i < MENU_ROWS; i++) {
      const r = rows[top + i];
      if (!r) break;
      const ry = listY + i * MENU_ROW_H;
      const sel = (top + i) === idx;
      if (sel) UI.highlight(ctx, MENU.x + 2, ry - 1, MENU.w - 4, MENU_ROW_H);

      const ink = !r.enabled ? UI.COLORS.disabled : sel ? UI.COLORS.goldBright : UI.COLORS.ink;
      UI.icon(ctx, r.icon || 'dot', MENU.x + 5, ry + 1, 8, r.enabled ? null : UI.COLORS.disabled);

      const tag = r.group ? UI.G.chevRight : (r.cost ? costTag(r.cost) : '');
      const tagW = tag ? UI.measure(tag, 'sm') + 3 : 0;
      UI.text(ctx, MENU.x + 16, ry + 2, r.name || r.id, {
        size: 'sm', color: ink, shadow: true, maxWidth: MENU.w - 22 - tagW,
      });
      if (tag) {
        UI.text(ctx, MENU.x + MENU.w - 5, ry + 2, tag, {
          size: 'sm', align: 'right',
          color: !r.enabled ? UI.COLORS.disabled : tag === 'B' ? UI.COLORS.green : tag === 'R' ? UI.COLORS.blue : UI.COLORS.goldDim,
        });
      }
      if (sel) UI.cursor(ctx, MENU.x - 4, ry + 2, this.t);
    }

    if (rows.length > MENU_ROWS) {
      const trackH = MENU_ROWS * MENU_ROW_H;
      const kh = Math.max(6, Math.round(trackH * MENU_ROWS / rows.length));
      const ky = listY + Math.round((trackH - kh) * (top / Math.max(1, rows.length - MENU_ROWS)));
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(MENU.x + MENU.w - 3, listY, 2, trackH);
      ctx.fillStyle = UI.COLORS.goldDim;
      ctx.fillRect(MENU.x + MENU.w - 3, ky, 2, kh);
    }
  }

  /** The right-hand panel: what the highlighted thing does, and the maths. */
  _drawDetail(ctx) {
    const enc = this.enc;
    const unit = enc.current;
    const rows = this._currentRows();
    const inSub = this.menuPath.length > 0;
    const idx = clamp(inSub ? this.subIndex : this.menuIndex, 0, Math.max(0, rows.length - 1));
    const row = this.phase === 'target' ? this.pending : rows[idx];
    if (!row) return;

    UI.panel(ctx, DETAIL.x, DETAIL.y, DETAIL.w, DETAIL.h, { style: 'dark', shadow: 0.45, studs: false });
    const ix = DETAIL.x + 5;
    let y = DETAIL.y + 4;
    const w = DETAIL.w - 10;

    const head = row.name || row.id;
    UI.text(ctx, ix, y, UI.fit(head, w - 60, 'md'), { size: 'md', color: row.enabled ? UI.COLORS.gold : UI.COLORS.disabled, shadow: true });

    // Cost / range / slot on the right of the header.
    const bits = [];
    if (row.cost) bits.push(row.cost === 'action' ? 'Action' : row.cost === 'bonus' ? 'Bonus' : row.cost === 'reaction' ? 'Reaction' : 'Free');
    const rng = row.targeting?.range;
    if (rng != null && !row.group) {
      const far = Array.isArray(rng) ? rng[1] : rng;
      if (far) bits.push(`${far} ft`);
    }
    if (row.concentration) bits.push('Conc.');
    if (bits.length) UI.text(ctx, DETAIL.x + DETAIL.w - 5, y + 1, bits.join(' · '), { size: 'sm', color: UI.COLORS.inkDim, align: 'right' });
    y += 10;

    if (!row.enabled && row.reason) {
      UI.text(ctx, ix, y, UI.fit(`Cannot: ${row.reason}`, w, 'sm'), { size: 'sm', color: UI.COLORS.bad, shadow: true });
      y += 8;
    }

    const desc = row.desc || '';
    if (desc) {
      const lines = UI.wrapLines(desc, w, 'sm').slice(0, 2);
      for (const l of lines) { UI.text(ctx, ix, y, l, { size: 'sm', color: UI.COLORS.ink, shadow: true }); y += 8; }
    }

    // --- live maths for the highlighted target ------------------------------
    if (this.phase === 'target' && this.pending) this._drawTargetMath(ctx, unit, ix, DETAIL.y + DETAIL.h - 20, w);
    else if (Array.isArray(row.levels) && row.levels.length > 1) {
      UI.text(ctx, ix, DETAIL.y + DETAIL.h - 11, `Slots: ${row.levels.join(', ')}`, { size: 'sm', color: UI.COLORS.mp, shadow: true });
    }
  }

  _drawTargetMath(ctx, unit, x, y, w) {
    const o = this.pending;
    if (!o || !unit) return;
    const area = this._isAreaOption(o);

    if (area) {
      // Who is caught, and what each of them has to beat.
      const dc = o.dc || o.saveDC || null;
      const spell = o.spellId ? getSpell(o.spellId) : null;
      const ab = spell?.save?.ability || o.targeting?.saveAbility || 'dex';
      let line = `${this.areaVictims.length} caught`;
      if (dc) line += ` · DC ${dc} ${String(ab).toUpperCase()}`;
      if (Array.isArray(o.levels) && o.levels.length > 1) line += ` · slot ${this.slotLevel}`;
      UI.text(ctx, x, y, line, { size: 'sm', color: UI.COLORS.gold, shadow: true });

      let cx = x;
      const cy = y + 9;
      for (const v of this.areaVictims.slice(0, 4)) {
        const sm = safe(() => saveMod(v, ab), 0) || 0;
        const label = `${UI.fit(v.name || '?', 44, 'sm')} ${signed(sm)}`;
        const cw = UI.chip(ctx, cx, cy, label, {
          color: v.side === 'party' ? UI.COLORS.blue : UI.COLORS.red,
        });
        cx += cw + 3;
        if (cx > x + w - 40) break;
      }
      return;
    }

    const tgt = this.targets.units[this.targetIndex];
    if (!tgt) return;

    const isAttack = o.kind === 'attack' || o.spellAttack != null || (o.spellId && getSpell(o.spellId)?.attack);
    const spell = o.spellId ? getSpell(o.spellId) : null;
    const dist = safe(() => distanceFt(unit, tgt), 0);

    if (isAttack) {
      const cover = safe(() => hasCover(this.enc, unit, tgt), 0) || 0;
      const ac = (safe(() => acOf(tgt), 10) || 10) + cover;
      const atk = o.attackBonus != null ? o.attackBonus : (o.spellAttack || 0);
      const ad = safe(() => computeAdvantage(this.enc, unit, tgt, { ranged: !!o.ranged, spell }), { adv: false, dis: false });
      const p = hitChance(atk, ac, ad.adv, ad.dis);

      let dmg = 0;
      if (o.damage) dmg = avgOf(o.damage.dice, o.damage.mod);
      else if (spell) {
        const dice = safe(() => spellDamageDice(spell, this.slotLevel ?? spell.level, unit.level || 1), spell.damage?.dice);
        dmg = avgOf(dice, 0);
      }

      const line = `${signed(atk)} vs AC ${ac}${cover ? ` (+${cover} cover)` : ''} · ${Math.round(p * 100)}% · ~${dmg} dmg`;
      UI.text(ctx, x, y, UI.fit(line, w, 'sm'), {
        size: 'sm', color: ad.dis && !ad.adv ? UI.COLORS.bad : ad.adv ? UI.COLORS.good : UI.COLORS.ink, shadow: true,
      });
      const tail = [];
      if (ad.adv) tail.push('ADVANTAGE');
      if (ad.dis) tail.push('DISADVANTAGE');
      tail.push(`${dist} ft`);
      if (Array.isArray(o.levels) && o.levels.length > 1) tail.push(`slot ${this.slotLevel}`);
      UI.text(ctx, x, y + 9, UI.fit(tail.join(' · '), w, 'sm'), { size: 'sm', color: UI.COLORS.inkDim, shadow: true });
      return;
    }

    // Non-attack: show the save, or just the range and the target's health.
    const dc = o.dc || null;
    const ab = spell?.save?.ability || 'dex';
    const hpTxt = `${Math.max(0, tgt.hp)}/${safe(() => maxHpOf(tgt), tgt.maxHp || 1)} HP · AC ${safe(() => acOf(tgt), 10)}`;
    UI.text(ctx, x, y, UI.fit(`${tgt.name}: ${hpTxt}`, w, 'sm'), { size: 'sm', color: UI.COLORS.ink, shadow: true });
    const tail = [];
    if (dc && spell?.save) tail.push(`DC ${dc} ${String(ab).toUpperCase()} (${signed(safe(() => saveMod(tgt, ab), 0) || 0)})`);
    tail.push(`${dist} ft`);
    if (Array.isArray(o.levels) && o.levels.length > 1) tail.push(`slot ${this.slotLevel}`);
    UI.text(ctx, x, y + 9, UI.fit(tail.join(' · '), w, 'sm'), { size: 'sm', color: UI.COLORS.inkDim, shadow: true });
  }

  // --- inspect card --------------------------------------------------------

  _drawStatCard(ctx) {
    const u = this.inspect;
    if (!u) return;
    const W = 116, H = 108;
    const X = VIEW_W - W - 3;
    const Y = RIBBON.h + (this.boss ? 15 : 4);
    UI.panel(ctx, X, Y, W, H, { style: 'dark', shadow: 0.5 });

    safe(() => UI.portrait(ctx, u, X + 4, Y + 4, 26, { style: u.side === 'party' ? 'window' : 'danger' }));
    UI.text(ctx, X + 33, Y + 5, UI.fit(u.name || '?', W - 38, 'md'), { size: 'md', color: SIDE_COLOR[u.side] || UI.COLORS.ink, shadow: true });

    const def = this._monsterDef(u);
    const known = !def || !u.monsterId || !!(Game.state?.bestiary?.[u.monsterId]);
    const sub = def
      ? `${titleCase(u.size || 'medium')} ${def.type || 'creature'}${def.cr != null ? ` · CR ${def.cr}` : ''}`
      : `Level ${u.level || 1} ${titleCase((u.classes?.[0]?.id) || 'adventurer')}`;
    UI.text(ctx, X + 33, Y + 14, UI.fit(sub, W - 38, 'sm'), { size: 'sm', color: UI.COLORS.inkDim, shadow: true });

    const ac = safe(() => acOf(u), 10);
    UI.icon(ctx, 'shield', X + 33, Y + 22, 8, UI.COLORS.silver);
    UI.text(ctx, X + 43, Y + 23, `AC ${ac}`, { size: 'sm', color: UI.COLORS.ink, shadow: true });
    const spd = safe(() => speedOf(u), 30);
    UI.icon(ctx, 'foot', X + 70, Y + 22, 8, UI.COLORS.inkDim);
    UI.text(ctx, X + 80, Y + 23, `${spd} ft`, { size: 'sm', color: UI.COLORS.ink, shadow: true });

    let y = Y + 34;
    const max = safe(() => maxHpOf(u), u.maxHp || 1) || 1;
    UI.bar(ctx, X + 4, y, W - 8, 7, hpPct(u), {
      color: UI.COLORS.hp, bg: '#1a0d0c',
      label: known ? `${Math.max(0, u.hp)} / ${max}` : `${Math.round(hpPct(u) * 100)}%`,
      size: 'sm',
    });
    y += 11;

    // Conditions
    const badges = safe(() => conditionBadges(u), []) || [];
    if (badges.length) {
      let cx = X + 4;
      let cy = y;
      for (const b of badges.slice(0, 6)) {
        const cw = UI.chip(ctx, cx, cy, UI.fit(b.name, 46, 'sm'), { color: b.color || UI.COLORS.purple });
        cx += cw + 2;
        if (cx > X + W - 22) { cx = X + 4; cy += 10; if (cy > y + 10) break; }
      }
      y = cy + 11;
    }

    // Resistances / immunities
    const res = [...(u.resist || [])].slice(0, 4);
    const imm = [...(u.immune || [])].slice(0, 3);
    if (res.length) {
      UI.text(ctx, X + 4, y, `Resist: ${UI.fit(res.join(', '), W - 34, 'sm')}`, { size: 'sm', color: UI.COLORS.blue, shadow: true });
      y += 8;
    }
    if (imm.length) {
      UI.text(ctx, X + 4, y, `Immune: ${UI.fit(imm.join(', '), W - 34, 'sm')}`, { size: 'sm', color: UI.COLORS.purple, shadow: true });
      y += 8;
    }

    // Known traits — the full stat block only once the bestiary has an entry.
    if (y < Y + H - 10) {
      if (known && def) {
        const traits = (def.traits || []).slice(0, 2).map((t) => t.name).join(', ');
        const acts = (def.actions || []).slice(0, 3).map((a) => a.name).join(', ');
        if (traits) { UI.text(ctx, X + 4, y, UI.fit(`Traits: ${traits}`, W - 8, 'sm'), { size: 'sm', color: UI.COLORS.gold, shadow: true }); y += 8; }
        if (acts && y < Y + H - 9) UI.text(ctx, X + 4, y, UI.fit(`Actions: ${acts}`, W - 8, 'sm'), { size: 'sm', color: UI.COLORS.inkDim, shadow: true });
      } else if (def) {
        UI.text(ctx, X + 4, y, 'Slay one to learn its ways.', { size: 'sm', color: UI.COLORS.inkDim, shadow: true });
      }
    }
  }

  // --- log -----------------------------------------------------------------

  _drawLogTail(ctx) {
    const lines = (this.enc?.log || []).slice(-2);
    if (!lines.length) return;
    ctx.fillStyle = 'rgba(5,6,12,0.80)';
    ctx.fillRect(LOGTAIL.x, LOGTAIL.y, LOGTAIL.w, LOGTAIL.h);
    ctx.fillStyle = 'rgba(140,110,50,0.55)';
    ctx.fillRect(LOGTAIL.x, LOGTAIL.y, LOGTAIL.w, 1);

    // Truncated well short of the right edge: the key hints live over there.
    let y = LOGTAIL.y + 4;
    for (const l of lines) {
      UI.text(ctx, 5, y, UI.fit(l.text || '', VIEW_W - 150, 'sm'), {
        size: 'sm', color: LOG_COLORS[l.kind] || UI.COLORS.ink, shadow: true,
      });
      y += 9;
    }
  }

  _drawLogPanel(ctx) {
    UI.scrim(ctx, 0.7);
    const X = 10, Y = 18, W = VIEW_W - 20, H = VIEW_H - 36;
    UI.window(ctx, X, Y, W, H, 'Battle Log', { style: 'window', shadow: 0.6 });

    const lines = this.enc?.log || [];
    const rows = Math.floor((H - 20) / 9);
    const start = Math.max(0, lines.length - rows - this.logScroll);
    let y = Y + 10;
    UI.pushClip(ctx, X + 3, Y + 8, W - 6, H - 16);
    for (let i = start; i < Math.min(lines.length, start + rows); i++) {
      const l = lines[i];
      UI.text(ctx, X + 6, y, UI.fit(l.text || '', W - 14, 'sm'), {
        size: 'sm', color: LOG_COLORS[l.kind] || UI.COLORS.ink, shadow: true,
      });
      y += 9;
    }
    UI.popClip(ctx);
    UI.text(ctx, X + W / 2, Y + H - 9, 'Up/Down to scroll  ·  X to close', { size: 'sm', color: UI.COLORS.inkDim, align: 'center' });
  }

  // --- transient overlays --------------------------------------------------

  _drawBanner(ctx) {
    const b = this.banner;
    if (!b) return;
    const p = b.t / b.dur;
    // slide in, hold, slide out
    const a = p < 0.15 ? p / 0.15 : p > 0.85 ? (1 - p) / 0.15 : 1;
    const size = b.big ? 'xl' : 'lg';
    const w = Math.max(UI.measure(b.text || '', size), UI.measure(b.sub || '', 'sm')) + 24;
    const h = b.sub ? 30 : 20;
    const x = R((VIEW_W - w) / 2);
    const y = b.big ? 74 : 46;

    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    UI.panel(ctx, x, y, w, h, { style: 'dark', shadow: 0.55, studs: false });
    ctx.fillStyle = b.color || UI.COLORS.gold;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    UI.text(ctx, VIEW_W / 2, y + 4, b.text || '', { size, color: b.color || UI.COLORS.gold, align: 'center', shadow: true });
    if (b.sub) UI.text(ctx, VIEW_W / 2, y + h - 10, UI.fit(b.sub, w - 12, 'sm'), { size: 'sm', color: UI.COLORS.ink, align: 'center', shadow: true });
    ctx.restore();
  }

  /** The damage arithmetic, under the die: "1d8 [6] +3 = 9 slashing". */
  _drawRollLines(ctx) {
    const r = this.rollLines;
    if (!r || !r.lines.length) return;
    let w = 0;
    for (const l of r.lines) w = Math.max(w, UI.measure(l, 'sm'));
    w += 12;
    const h = 6 + r.lines.length * 9;
    const x = R(DICE.x - w / 2);
    const y = DICE.y + 34;
    const a = clamp(Math.min(r.t / 0.12, (r.dur - r.t) / 0.18), 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    UI.panel(ctx, clamp(x, 2, VIEW_W - w - 2), y, w, h, { style: 'dark', shadow: 0.5, studs: false });
    let ly = y + 3;
    for (const l of r.lines) {
      UI.text(ctx, clamp(x, 2, VIEW_W - w - 2) + w / 2, ly, l, { size: 'sm', color: r.color || UI.COLORS.ink, align: 'center', shadow: true });
      ly += 9;
    }
    ctx.restore();
  }

  _drawPrompt(ctx) {
    const p = this.prompt;
    if (!p) return;
    UI.scrim(ctx, 0.45);
    const W = 220, H = 62, X = R((VIEW_W - W) / 2), Y = 92;
    UI.window(ctx, X, Y, W, H, 'Reaction', { style: 'gold', shadow: 0.6 });
    UI.text(ctx, X + 6, Y + 8, UI.fit(`${p.reactor?.name || 'You'} — ${p.title}`, W - 12, 'md'), { size: 'md', color: UI.COLORS.goldBright, shadow: true });
    const lines = UI.wrapLines(p.body || '', W - 12, 'sm').slice(0, 2);
    let y = Y + 19;
    for (const l of lines) { UI.text(ctx, X + 6, y, l, { size: 'sm', color: UI.COLORS.ink, shadow: true }); y += 8; }

    const bw = 60, by = 128;
    UI.button(ctx, 118, by, bw, 14, p.yes, { selected: p.index === 0, t: this.t });
    UI.button(ctx, 222, by, bw, 14, p.no, { selected: p.index === 1, t: this.t });

    // the timer bar drains; running out keeps the useful default
    const left = clamp(1 - p.t / p.dur, 0, 1);
    UI.bar(ctx, X + 6, Y + H - 8, W - 12, 4, left, { color: left > 0.35 ? UI.COLORS.gold : UI.COLORS.red, bg: '#120f0c' });
  }

  // --- results -------------------------------------------------------------

  _drawResults(ctx) {
    const r = this.results;
    UI.scrim(ctx, 0.72);
    if (r.kind === 'defeat') {
      const W = 240, H = 78, X = R((VIEW_W - W) / 2), Y = 74;
      UI.window(ctx, X, Y, W, H, 'Defeat', { style: 'dark', shadow: 0.6 });
      UI.text(ctx, VIEW_W / 2, Y + 14, 'The company falls.', { size: 'lg', color: UI.COLORS.red, align: 'center', shadow: true });
      UI.text(ctx, VIEW_W / 2, Y + 32, `The fight lasted ${r.rounds} round${r.rounds === 1 ? '' : 's'}.`, { size: 'sm', color: UI.COLORS.inkDim, align: 'center' });
      UI.text(ctx, VIEW_W / 2, Y + 46, 'Tymora turns her face away.', { size: 'sm', color: UI.COLORS.inkDim, align: 'center' });
      UI.text(ctx, VIEW_W / 2, Y + H - 11, 'Press Confirm', { size: 'sm', color: UI.COLORS.gold, align: 'center', shadow: true });
      return;
    }

    const W = 268, H = 152, X = R((VIEW_W - W) / 2), Y = 40;
    UI.window(ctx, X, Y, W, H, 'Victory', { style: 'gold', shadow: 0.6 });

    UI.text(ctx, X + 8, Y + 8, `The field is yours after ${r.rounds} round${r.rounds === 1 ? '' : 's'}.`,
      { size: 'sm', color: UI.COLORS.ink, shadow: true });

    UI.divider(ctx, X + 6, Y + 20, W - 12, { label: 'Experience' });

    let y = Y + 26;
    for (const m of r.members.slice(0, 4)) {
      const lv = r.leveled.find((l) => l.uid === m.uid);
      const dead = isDead(m);
      UI.text(ctx, X + 10, y, UI.fit(m.name || '?', 96, 'sm'), {
        size: 'sm', color: dead ? UI.COLORS.disabled : UI.COLORS.ink, shadow: true,
      });
      UI.text(ctx, X + 120, y, dead ? '—' : `+${r.share} xp`, { size: 'sm', color: dead ? UI.COLORS.disabled : UI.COLORS.xp, shadow: true });
      if (lv) {
        UI.text(ctx, X + 170, y, `LEVEL ${lv.level}!`, {
          size: 'sm', color: Math.floor(this.t * 5) % 2 ? UI.COLORS.goldBright : UI.COLORS.gold, shadow: true,
        });
      } else if (!dead) {
        UI.text(ctx, X + 170, y, `${Math.max(0, m.hp)}/${safe(() => maxHpOf(m), m.maxHp || 1)} HP`, { size: 'sm', color: UI.COLORS.inkDim });
      }
      y += 10;
    }

    y += 2;
    UI.divider(ctx, X + 6, y, W - 12, { label: 'Spoils' });
    y += 7;

    UI.icon(ctx, 'coin', X + 10, y, 8, null);
    UI.text(ctx, X + 21, y + 1, `${r.gold} gp`, { size: 'sm', color: UI.COLORS.gold, shadow: true });
    UI.text(ctx, X + 70, y + 1, `${r.xp} xp total`, { size: 'sm', color: UI.COLORS.xp, shadow: true });
    y += 11;

    if (r.loot.length) {
      let cx = X + 10;
      for (const id of r.loot.slice(0, 6)) {
        const name = safe(() => itemName(id), null) || titleCase(String(id).replace(/-/g, ' '));
        const cw = UI.chip(ctx, cx, y, UI.fit(name, 70, 'sm'), { color: UI.COLORS.green, icon: 'bag' });
        cx += cw + 3;
        if (cx > X + W - 30) break;
      }
      y += 12;
    } else {
      UI.text(ctx, X + 10, y, 'Nothing worth carrying.', { size: 'sm', color: UI.COLORS.inkDim });
      y += 11;
    }

    UI.text(ctx, VIEW_W / 2, Y + H - 12, 'Press Confirm to march on', {
      size: 'sm', color: UI.COLORS.goldBright, align: 'center', shadow: true,
    });
  }

  // --- key hints -----------------------------------------------------------

  /** Two key hints, right-aligned inside the log strip so nothing overlaps. */
  /** A three-swatch key for the movement overlay, tucked under the budget strip. */
  _drawMoveLegend(ctx) {
    const items = [
      ['rgba(90,160,240,0.9)', 'reach'],
      ['rgba(200,60,45,0.9)', 'provokes'],
      ['rgba(232,110,90,0.95)', 'in melee'],
    ];
    let w = 6;
    for (const [, label] of items) w += 7 + UI.measure(label, 'sm') + 7;
    const x = MENU.x - 2, y = BUDGET.y - 13;
    UI.panel(ctx, x, y, w, 11, { style: 'dark', shadow: 0.45, studs: false });
    let cx = x + 4;
    for (const [col, label] of items) {
      ctx.fillStyle = '#0a0708';
      ctx.fillRect(cx - 1, y + 2, 6, 6);
      ctx.fillStyle = col;
      ctx.fillRect(cx, y + 3, 4, 4);
      cx += 7;
      UI.text(ctx, cx, y + 2, label, { size: 'sm', color: UI.COLORS.inkDim, shadow: true });
      cx += UI.measure(label, 'sm') + 7;
    }
  }

  _drawHints(ctx) {
    if (this.results || this.prompt) return;
    const y = LOGTAIL.y + 8;
    let x = VIEW_W - 4;
    const hint = (k, label) => {
      const w = Math.max(9, UI.measure(k, 'sm') + 6) + 3 + UI.measure(label, 'sm');
      x -= w;
      UI.keyHint(ctx, x, y, k, label, { h: 11 });
      x -= 6;
    };

    if (this.phase === 'move') { hint('X', 'Back'); hint('Z', 'Go'); }
    // The move overlay speaks in three colours; say what they mean rather than
    // making the player infer it from one bad opportunity attack.
    if (this.phase === 'move') this._drawMoveLegend(ctx);
    else if (this.phase === 'target') {
      hint('X', 'Back');
      if (Array.isArray(this.pending?.levels) && this.pending.levels.length > 1) hint('5', 'Slot');
      else hint('Z', 'Cast');
    } else if (this.phase === 'menu') { hint('J', 'Log'); hint('Q/R', 'Scan'); hint('Z', 'Pick'); }
    else { hint('J', 'Log'); hint('Sh', 'Fast'); }

    // The "why not" line sits above the budget strip. It used to be bare text
    // laid straight over the battlefield, which at 5px tall on grass was close
    // to unreadable; it gets its own plate now.
    if (this.hint && (this.phase === 'menu' || this.phase === 'target')) {
      const label = UI.fit(this.hint, 250, 'sm');
      const w = UI.measure(label, 'sm') + 8;
      const hx = MENU.x - 2, hy = BUDGET.y - 13;
      UI.panel(ctx, hx, hy, w, 11, { style: 'dark', shadow: 0.45, studs: false });
      UI.text(ctx, hx + 4, hy + 2, label, { size: 'sm', color: UI.COLORS.warn, shadow: true });
    }
  }
}

export default BattleScene;
