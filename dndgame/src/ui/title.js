// ui/title.js — the animated title card (with its Load / Bestiary / Credits
// sub-screens) and the game-over screen. Both are engine Scenes.
//
// Everything textual goes through ui/kit.js (UI.* / drawGlyphs); the night sky,
// the Sword Mountains, the campfire and the embers are hand-drawn Canvas2D shapes.
// Sibling modules that may not exist yet (charcreate, menus, overworld, character)
// are pulled in with a soft dynamic import so a half-built tree still boots.

import { Game } from '../engine.js';
import { UI, drawGlyphs } from './kit.js';
import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { Save, SLOT_COUNT } from '../core/save.js';
import { toast } from '../core/events.js';
import { makeRNG } from '../core/rng.js';
import {
  VIEW_W, VIEW_H, VERSION, clamp, lerp, playtimeText, crText,
} from '../constants.js';
import { newGameState, loadState } from '../state.js';
import { Party } from '../world/party.js';
import { drawActor } from '../render/actor.js';
import { drawSpriteAt, hasSprite, spriteFrames, spriteSize, getSilhouette } from '../render/sprites.js';

// ===========================================================================
// Small kit shims. The kit is authoritative; these only keep a missing helper
// from taking the whole frame down, and never fall back to ctx.fillText.
// ===========================================================================

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
  try { if (UI && UI.measure) return UI.measure(String(s), size) || 0; } catch (e) { /* fall through */ }
  return String(s).length * 4;
}
function txtC(ctx, cx, y, s, o) { txt(ctx, cx - tw(s, (o || {}).size) / 2, y, s, o); }
function txtR(ctx, rx, y, s, o) { txt(ctx, rx - tw(s, (o || {}).size), y, s, o); }
/**
 * The ink a panel style can actually carry, by role
 * ('title' | 'body' | 'dim' | 'accent'). Ask the kit; the literals are only a
 * floor for the case where the kit has not finished loading. The `gold` style
 * is a LIGHT brass fill, so its ink is near-black — hard-coding a bright colour
 * onto it is how a selected row becomes less readable than an idle one.
 */
const PLATE_INK_FALLBACK = {
  gold: { title: '#2a1c07', body: '#2a1c07', dim: '#5a4318', accent: '#7a2010' },
  dark: { title: K.gold, body: K.ink, dim: K.dim, accent: '#f7dc92' },
};
function plateInk(style, role) {
  try { if (UI && UI.inkFor) return UI.inkFor(style, role); } catch (e) { /* below */ }
  const set = PLATE_INK_FALLBACK[style] || PLATE_INK_FALLBACK.dark;
  return set[role] || set.body;
}
function panel(ctx, x, y, w, h, o) {
  try { UI.panel(ctx, Math.round(x), Math.round(y), Math.round(w), Math.round(h), o || {}); return; } catch (e) { /* below */ }
  ctx.fillStyle = 'rgba(10,12,20,0.92)'; ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  ctx.strokeStyle = C('border'); ctx.lineWidth = 1;
  ctx.strokeRect((x | 0) + 0.5, (y | 0) + 0.5, (w | 0) - 1, (h | 0) - 1);
}
function cursor(ctx, x, y, t) {
  try { if (UI && UI.cursor) { UI.cursor(ctx, Math.round(x), Math.round(y), t); return; } } catch (e) { /* below */ }
  const b = Math.round(Math.sin(t * 7) * 1);
  ctx.fillStyle = C('gold');
  ctx.beginPath();
  ctx.moveTo((x | 0) + b, (y | 0)); ctx.lineTo((x | 0) + b + 4, (y | 0) + 3); ctx.lineTo((x | 0) + b, (y | 0) + 6);
  ctx.closePath(); ctx.fill();
}
function wrapped(ctx, x, y, w, s, o) {
  try { if (UI && UI.textWrapped) return UI.textWrapped(ctx, x | 0, y | 0, w | 0, String(s), o || {}); } catch (e) { /* below */ }
  // Fall back to naive word wrapping through UI.text.
  const words = String(s).split(/\s+/);
  const size = (o || {}).size;
  let line = '', ly = y, n = 0;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (tw(test, size) > w && line) { txt(ctx, x, ly, line, o); ly += 9; n++; line = word; } else line = test;
  }
  if (line) { txt(ctx, x, ly, line, o); n++; }
  return n;
}
/** Truncate to fit `w` pixels, appending an ellipsis. */
function fit(s, w, size) {
  let str = String(s == null ? '' : s);
  if (tw(str, size) <= w) return str;
  while (str.length > 1 && tw(str + '…', size) > w) str = str.slice(0, -1);
  return str + '…';
}

/** Big scaled logo text, drawn glyph by glyph so letter tracking is controllable. */
function glyphRun(ctx, str, cx, y, scale, color, tracking = 0) {
  const adv = 6 * scale + tracking;
  const w = Math.max(0, str.length * adv - tracking - scale);
  let x = Math.round(cx - w / 2);
  if (typeof drawGlyphs === 'function') {
    for (const ch of str) { if (ch !== ' ') drawGlyphs(ctx, ch, x, Math.round(y), scale, color); x += adv; }
  } else {
    txtC(ctx, cx, y, str, { color, size: 'lg' });
  }
  return w;
}

/** Optional sibling modules: never let a missing file throw. */
async function softImport(path) {
  try { return await import(path); } catch (e) {
    console.warn('[title] optional module unavailable:', path, e && e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The bestiary catalogue. data/monsters.js is a barrel over monsters_low.js and
// monsters_high.js, which are authored separately — a static import here would
// make a half-finished bestiary the reason the *title screen* fails to load, and
// with it the whole game. So it is pulled in lazily, once, when the player first
// opens the Bestiary, and the screen degrades to "nothing catalogued" until then.
// ---------------------------------------------------------------------------

const BESTIARY = {
  ready: false,
  loading: false,
  MONSTERS: {},
  IDS: [],
  statLine: null,
  xpOf: null,
};

function loadBestiaryCatalogue() {
  if (BESTIARY.ready || BESTIARY.loading) return Promise.resolve(BESTIARY);
  BESTIARY.loading = true;
  return softImport('../data/monsters.js').then((mod) => {
    BESTIARY.loading = false;
    BESTIARY.ready = true;
    if (!mod) return BESTIARY;
    BESTIARY.MONSTERS = mod.MONSTERS || {};
    BESTIARY.IDS = (mod.MONSTER_IDS && mod.MONSTER_IDS.length)
      ? Array.from(mod.MONSTER_IDS)
      : Object.keys(BESTIARY.MONSTERS);
    BESTIARY.statLine = typeof mod.statLine === 'function' ? mod.statLine : null;
    BESTIARY.xpOf = typeof mod.xpOf === 'function' ? mod.xpOf : null;
    return BESTIARY;
  });
}

function sfx(name) { try { Audio.sfx(name); } catch (e) { /* audio may be gated */ } }

/** A frame name that definitely exists for a sprite. */
function firstFrame(name, prefer = 'down-0') {
  if (!hasSprite(name)) return null;
  const frames = spriteFrames(name);
  return frames.includes(prefer) ? prefer : (frames[0] || null);
}

const BIOME_SWATCH = {
  road: '#8a7550', plains: '#6f9a4a', forest: '#3f6b3a', 'pine-forest': '#2c5442',
  hills: '#7a8a4a', mountain: '#6a7080', marsh: '#4a5f45', coast: '#4a7fa8',
  ruins: '#7a6a58', cave: '#4a4438', dungeon: '#454050', crypt: '#3a3040',
  mine: '#6a5a3a', 'ash-waste': '#5a5250', tundra: '#9fb4c4', underdark: '#3a2f4a',
  city: '#9a8a6a',
};

// ===========================================================================
// TITLE SCENE
// ===========================================================================

const MENU_ITEMS = [
  { id: 'new', label: 'New Campaign', hint: 'Roll a hero and ride the Triboar Trail.' },
  { id: 'continue', label: 'Continue', hint: 'Resume your most recent save.' },
  { id: 'load', label: 'Load Game', hint: 'Choose from your saved campaigns.' },
  { id: 'settings', label: 'Settings', hint: 'Sound, text speed, difficulty, controls.' },
  { id: 'bestiary', label: 'Bestiary', hint: 'Creatures your party has put down.' },
  { id: 'credits', label: 'Credits', hint: 'Who built this, and out of what.' },
];

const MENU_X = 24, MENU_Y = 112, MENU_W = 136, ROW_H = 15;

export class TitleScene {
  /**
   * opts: { onNewGame(), onLoad(slot), onContinue(), skipGate:bool }
   * Any hook left out falls back to the built-in flow.
   */
  constructor(opts = {}) {
    this.id = 'title';
    this.opaque = true;
    this.pausesBelow = true;
    this.uiLayer = true;
    this.opts = opts || {};
    this.t = 0;
    this.index = 0;
    this.mode = 'menu';          // 'menu' | 'load' | 'bestiary' | 'credits'
    this.gated = false;          // true once the audio gate has been passed
    this.busy = false;           // a scene push / load is in flight
    this.shimmer = 1.4;
    this.hasSave = false;
    this.creditScroll = 0;
    this.slots = [];
    this.slotIndex = 0;
    this.bestiary = null;        // built lazily
    this.beast = [];
    this.beastIndex = 0;
    this.beastScroll = 0;
    this.stars = null;
    this.hero = null;
  }

  // --- lifecycle ----------------------------------------------------------

  enter() {
    if (!this.stars) this._buildScenery();
    this.slots = safeSlots();
    const newest = safeNewest();
    this.hasSave = newest >= 0;
    if (!this.hasSave && this.index === 1) this.index = 0;
    this.busy = false;
    this.mode = 'menu';
    if (this.gated || Audio.ready) { this.gated = true; try { Audio.music('title'); } catch (e) { /* ignore */ } }
  }

  exit() { this.busy = true; }

  _buildScenery() {
    const r = makeRNG('sword-coast-title');
    // Night sky
    this.stars = [];
    for (let i = 0; i < 110; i++) {
      this.stars.push({
        x: r.int(0, VIEW_W), y: r.int(0, 150),
        b: r.float(0.25, 1), sp: r.float(0.6, 2.4), ph: r.float(0, 6.28),
        big: r.chance(0.08),
      });
    }
    // Selûne's Tears — the seven small stars that trail the Moonmaiden.
    // Set high and to the right so the logo never fights the moon for space.
    this.moon = { x: 350, y: 32, r: 12 };
    this.tears = [];
    for (let i = 0; i < 7; i++) {
      const a = -2.62 + i * 0.10;
      const d = 24 + i * 6.4;
      this.tears.push({
        x: Math.round(this.moon.x + Math.cos(a) * d),
        y: Math.round(this.moon.y + Math.sin(a) * d * 0.8),
        s: i < 3 ? 2 : 1,
      });
    }
    // Drifting cloud banks
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      const puffs = [];
      const n = r.int(3, 6);
      let px = 0;
      for (let p = 0; p < n; p++) {
        puffs.push({ dx: px, dy: r.int(-3, 3), rx: r.int(9, 20), ry: r.int(4, 8) });
        px += r.int(10, 18);
      }
      this.clouds.push({
        x: r.float(-60, VIEW_W + 60), y: r.int(16, 108),
        v: r.float(2.4, 7.5) * (r.chance(0.5) ? 1 : 0.6),
        a: r.float(0.22, 0.5), w: px, puffs,
      });
    }
    // Three ridges of the Sword Mountains
    this.ranges = [
      { peaks: makeRange(r, 150, 30, 58, 6), base: 150, color: '#232a46', snow: '#5a6690' },
      { peaks: makeRange(r, 170, 24, 46, 4), base: 170, color: '#161c31', snow: '#39415f' },
      { peaks: makeRange(r, 190, 14, 30, 3), base: 190, color: '#0c1020', snow: null },
    ];
    // Campfire embers
    this.embers = [];
    for (let i = 0; i < 46; i++) this.embers.push(this._newEmber(r, true));
    this._erng = r;
    // The lone adventurer: a plain layered actor, no equipment, facing the fire.
    this.hero = {
      uid: 'title-hero', name: 'Adventurer', kind: 'pc', size: 'medium',
      classes: [{ id: 'fighter', level: 1 }], equipment: {}, inventory: [],
      appearance: {
        body: 'm', build: 'normal', skin: '#d09a6c', hair: '#3a2416', hairStyle: 'short',
        beard: 'stubble', eye: '#37527a', outfit: '#7a3030', outfitAlt: '#2f4f7f',
        accent: '#e3b34a', metal: '#aab2c0', leather: '#6b4a2a', cloth: '#c8b58a',
        cloakStyle: 'cloak-long', helmStyle: 'helm-none', outfitStyle: 'outfit-leather',
      },
    };
  }

  _newEmber(r, seeded) {
    return {
      x: 296 + r.float(-4, 4),
      y: seeded ? r.float(150, 228) : 226 + r.float(-2, 2),
      vy: r.float(9, 26), vx: r.float(-4, 4),
      life: seeded ? r.float(0.2, 1) : 1,
      fade: r.float(0.22, 0.5),
      s: r.chance(0.18) ? 2 : 1,
      ph: r.float(0, 6.28),
      warm: r.chance(0.5),
    };
  }

  // --- update -------------------------------------------------------------

  update(dt) {
    this.t += dt;
    this.shimmer += dt;

    // Scenery motion runs regardless of which sub-screen is up.
    for (const c of this.clouds) {
      c.x -= c.v * dt;
      if (c.x + c.w < -70) { c.x = VIEW_W + 40; c.y = 16 + ((c.y * 7 + 31) % 92); }
    }
    const r = this._erng;
    for (const e of this.embers) {
      e.y -= e.vy * dt;
      e.x += (e.vx + Math.sin(this.t * 2.1 + e.ph) * 7) * dt;
      e.life -= e.fade * dt;
      if (e.life <= 0 || e.y < 120) Object.assign(e, this._newEmber(r, false));
    }

    if (this.busy) return;

    // --- audio gate: the first press wakes WebAudio and is swallowed --------
    // A click counts too: browsers accept any user gesture, and a player who
    // reaches for the mouse should not be told to press a key instead.
    if (!this.gated) {
      const m = Input.mouse;
      if (Input.anyPressed() || (m && m.clicked)) {
        this.gated = true;
        try { Audio.init(); Audio.music('title'); } catch (e) { /* ignore */ }
        Input.consumeAll();
        if (m) m.clicked = false;
      }
      return;
    }

    if (this.mode === 'menu') this._updateMenu(dt);
    else if (this.mode === 'load') this._updateLoad(dt);
    else if (this.mode === 'bestiary') this._updateBestiary(dt);
    else if (this.mode === 'credits') this._updateCredits(dt);
  }

  _enabled(i) { return !(MENU_ITEMS[i].id === 'continue' && !this.hasSave); }

  _move(delta) {
    const n = MENU_ITEMS.length;
    let i = this.index;
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (this._enabled(i)) break;
    }
    if (i !== this.index) { this.index = i; sfx('cursor'); }
  }

  _updateMenu() {
    if (Input.repeatConsume('up')) this._move(-1);
    if (Input.repeatConsume('down')) this._move(1);

    // Mouse: hover selects, click activates.
    const m = Input.mouse;
    if (m && m.over) {
      for (let i = 0; i < MENU_ITEMS.length; i++) {
        const ry = MENU_Y + 5 + i * ROW_H;
        if (m.x >= MENU_X + 2 && m.x <= MENU_X + MENU_W - 2 && m.y >= ry - 1 && m.y < ry + ROW_H - 2) {
          if (this.index !== i && this._enabled(i)) { this.index = i; sfx('cursor'); }
          if (m.clicked) { m.clicked = false; this._activate(); }
          break;
        }
      }
    }

    if (Input.consume('confirm')) this._activate();
    if (Input.consume('cancel')) sfx('back');
    // Quick keys, because a title screen should never need three presses.
    if (Input.consume('tab1') && this._enabled(0)) { this.index = 0; this._activate(); }
    if (Input.consume('journal')) { this.index = 4; this.mode = 'bestiary'; this._buildBestiary(); sfx('open'); }
  }

  _activate() {
    if (!this._enabled(this.index)) { sfx('error'); return; }
    const id = MENU_ITEMS[this.index].id;
    sfx('select');
    if (id === 'new') this._newGame();
    else if (id === 'continue') this._continue();
    else if (id === 'load') { this.mode = 'load'; this.slots = safeSlots(); this.slotIndex = Math.max(0, safeNewest()); }
    else if (id === 'settings') this._settings();
    else if (id === 'bestiary') { this.mode = 'bestiary'; this._buildBestiary(); }
    else if (id === 'credits') { this.mode = 'credits'; this.creditScroll = 0; }
  }

  // --- menu actions -------------------------------------------------------

  _newGame() {
    if (this.opts.onNewGame) { this.opts.onNewGame(); return; }
    this.busy = true;
    softImport('./charcreate.js').then((mod) => {
      if (mod && mod.CharCreateScene) {
        const scene = new mod.CharCreateScene((ch) => {
          Game.popTo((s) => s === this);
          if (!ch) { this.busy = false; return; }
          this._beginCampaign(ch);
        });
        Game.push(scene);
        Input.consumeAll();
      } else {
        // No creator yet: still let the world open so the overworld is testable.
        this._beginCampaign(null);
      }
    });
  }

  _beginCampaign(ch) {
    this.busy = true;
    const st = newGameState();
    Game.state = st;
    // The kit and the purse are rolled onto the character; the whole game reads
    // the shared party pack. Hand them over or the campaign opens with 0 gp.
    if (ch) { Party.clear(); Party.add(ch); Party.absorbKit(ch); }
    softImport('../world/overworld.js').then((ow) => {
      if (!ow || !ow.OverworldScene) {
        this.busy = false;
        toast('The Sword Coast is not yet mapped.');
        sfx('error');
        return;
      }
      try { Audio.music(null); } catch (e) { /* ignore */ }
      Game.transition('fade', () => {
        Game.replace(new ow.OverworldScene(st.mapId, { x: st.x, y: st.y, dir: st.dir }));
      });
    });
  }

  _continue() {
    const slot = safeNewest();
    if (slot < 0) { sfx('error'); return; }
    this._load(slot);
  }

  _load(slot) {
    if (this.opts.onLoad) { this.opts.onLoad(slot); return; }
    const data = safeRead(slot);
    if (!data) { sfx('error'); toast('That save cannot be read.'); return; }
    this.busy = true;
    Promise.all([softImport('../rules/character.js'), softImport('../world/overworld.js')]).then(([chm, ow]) => {
      const de = (chm && chm.deserializeChar) || ((o) => o);
      let st = null;
      try { st = loadState(data, de); } catch (e) {
        console.error('[title] load failed', e);
        this.busy = false; sfx('error'); toast('That save is damaged.');
        return;
      }
      Game.state = st;
      if (!ow || !ow.OverworldScene) { this.busy = false; toast('The Sword Coast is not yet mapped.'); sfx('error'); return; }
      try { Audio.music(null); } catch (e) { /* ignore */ }
      Game.transition('fade', () => {
        Game.replace(new ow.OverworldScene(st.mapId, { x: st.x, y: st.y, dir: st.dir }));
      });
    });
  }

  _settings() {
    if (this.opts.onSettings) { this.opts.onSettings(); return; }
    this.busy = true;
    softImport('./menus.js').then((mod) => {
      this.busy = false;
      if (mod && mod.OptionsScene) { Game.push(new mod.OptionsScene()); Input.consumeAll(); }
      else { toast('Settings are not available yet.'); sfx('error'); }
    });
  }

  // --- load sub-screen ----------------------------------------------------

  _updateLoad() {
    const n = Math.max(1, this.slots.length);
    if (Input.repeatConsume('up')) { this.slotIndex = (this.slotIndex - 1 + n) % n; sfx('cursor'); }
    if (Input.repeatConsume('down')) { this.slotIndex = (this.slotIndex + 1) % n; sfx('cursor'); }

    const m = Input.mouse;
    if (m && m.over) {
      for (let i = 0; i < n; i++) {
        const cy = 40 + i * 35;
        if (m.x >= 38 && m.x <= 362 && m.y >= cy && m.y < cy + 33) {
          if (this.slotIndex !== i) { this.slotIndex = i; sfx('cursor'); }
          if (m.clicked) { m.clicked = false; this._tryLoadSelected(); }
          break;
        }
      }
    }

    if (Input.consume('confirm')) this._tryLoadSelected();
    if (Input.consume('cancel')) { this.mode = 'menu'; sfx('back'); }
  }

  _tryLoadSelected() {
    const s = this.slots[this.slotIndex];
    if (!s || s.empty || s.corrupt || s.future) { sfx('error'); return; }
    sfx('select');
    this._load(s.slot);
  }

  // --- bestiary sub-screen ------------------------------------------------

  _buildBestiary() {
    // The catalogue may still be in flight; build with whatever is loaded now and
    // rebuild once it lands, so opening the screen is never blocked on an import.
    if (!BESTIARY.ready) {
      loadBestiaryCatalogue().then(() => { if (this.mode === 'bestiary') this._buildBestiary(); });
    }
    this.bestiary = collectBestiary();
    const ids = BESTIARY.IDS.slice();
    this.beast = ids.map((id) => {
      const m = BESTIARY.MONSTERS[id] || {};
      return { id, m, kills: this.bestiary[id] | 0 };
    }).sort((a, b) => (a.m.cr ?? 0) - (b.m.cr ?? 0) || String(a.m.name || a.id).localeCompare(String(b.m.name || b.id)));
    this.beastKnown = this.beast.filter((e) => e.kills > 0).length;
    this.beastIndex = clamp(this.beastIndex, 0, Math.max(0, this.beast.length - 1));
    this.beastScroll = clamp(this.beastScroll, 0, Math.max(0, this.beast.length - BEAST_ROWS));
  }

  _updateBestiary() {
    const n = this.beast.length;
    if (!n) { if (Input.consume('cancel') || Input.consume('confirm')) { this.mode = 'menu'; sfx('back'); } return; }
    let moved = 0;
    if (Input.repeatConsume('up')) moved = -1;
    if (Input.repeatConsume('down')) moved = 1;
    if (Input.repeatConsume('left')) moved = -BEAST_ROWS;
    if (Input.repeatConsume('right')) moved = BEAST_ROWS;
    if (Input.consume('prev')) moved = -BEAST_ROWS;
    if (Input.consume('next')) moved = BEAST_ROWS;
    if (moved) { this.beastIndex = clamp(this.beastIndex + moved, 0, n - 1); sfx('cursor'); }

    const m = Input.mouse;
    if (m && m.over) {
      if (m.wheel) this.beastIndex = clamp(this.beastIndex + (m.wheel > 0 ? 3 : -3), 0, n - 1);
      for (let i = 0; i < BEAST_ROWS; i++) {
        const idx = this.beastScroll + i;
        if (idx >= n) break;
        const ry = 32 + i * 15;
        if (m.x >= 14 && m.x <= 164 && m.y >= ry && m.y < ry + 15) {
          if (this.beastIndex !== idx) { this.beastIndex = idx; sfx('cursor'); }
          break;
        }
      }
    }

    // Keep the cursor inside the visible window.
    if (this.beastIndex < this.beastScroll) this.beastScroll = this.beastIndex;
    if (this.beastIndex >= this.beastScroll + BEAST_ROWS) this.beastScroll = this.beastIndex - BEAST_ROWS + 1;
    this.beastScroll = clamp(this.beastScroll, 0, Math.max(0, n - BEAST_ROWS));

    if (Input.consume('cancel')) { this.mode = 'menu'; sfx('back'); }
  }

  _updateCredits() {
    if (Input.consume('cancel') || Input.consume('confirm')) { this.mode = 'menu'; sfx('back'); }
  }

  // --- draw ---------------------------------------------------------------

  draw(ctx) {
    this._drawSky(ctx);
    this._drawMountains(ctx);
    this._drawForeground(ctx);

    if (this.mode === 'menu') {
      this._drawLogo(ctx);
      this._drawMenu(ctx);
    } else {
      // Sub-screens dim the card behind them so the panels stay readable.
      ctx.fillStyle = 'rgba(4,5,10,0.72)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      if (this.mode === 'load') this._drawLoad(ctx);
      else if (this.mode === 'bestiary') this._drawBestiary(ctx);
      else if (this.mode === 'credits') this._drawCredits(ctx);
    }

    txtR(ctx, VIEW_W - 4, VIEW_H - 9, `v${VERSION}`, { size: 'sm', color: 'rgba(154,145,127,0.55)' });

    if (!this.gated) {
      const a = 0.45 + Math.sin(this.t * 3.2) * 0.35;
      ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
      txtC(ctx, VIEW_W / 2, VIEW_H - 20, 'PRESS ANY KEY', { size: 'sm', color: C('gold'), shadow: true });
      ctx.restore();
    }
  }

  // --- scenery ------------------------------------------------------------

  _drawSky(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 200);
    g.addColorStop(0, '#070917');
    g.addColorStop(0.45, '#121834');
    g.addColorStop(0.78, '#26294a');
    g.addColorStop(1, '#4a3c52');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, 200);

    // Stars
    for (const s of this.stars) {
      const tw2 = 0.55 + 0.45 * Math.sin(this.t * s.sp + s.ph);
      ctx.globalAlpha = clamp(s.b * tw2 * (1 - s.y / 210), 0, 1);
      ctx.fillStyle = s.big ? '#fff6d8' : '#cfd8f0';
      ctx.fillRect(s.x | 0, s.y | 0, s.big ? 2 : 1, s.big ? 2 : 1);
    }
    ctx.globalAlpha = 1;

    // Selûne — the Moonmaiden — with her Tears trailing behind.
    const mo = this.moon;
    const halo = ctx.createRadialGradient(mo.x, mo.y, mo.r * 0.7, mo.x, mo.y, mo.r * 3.4);
    halo.addColorStop(0, 'rgba(226,232,255,0.30)');
    halo.addColorStop(1, 'rgba(226,232,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(mo.x, mo.y, mo.r * 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f2eedb';
    ctx.beginPath(); ctx.arc(mo.x, mo.y, mo.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#dcd6be';
    ctx.beginPath(); ctx.arc(mo.x - 4, mo.y - 3, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mo.x + 4, mo.y + 4, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mo.x + 5, mo.y - 6, 1.8, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < this.tears.length; i++) {
      const t2 = this.tears[i];
      ctx.globalAlpha = clamp(0.55 + 0.4 * Math.sin(this.t * 1.6 + i), 0, 1);
      ctx.fillStyle = '#f0f2ff';
      ctx.fillRect(t2.x | 0, t2.y | 0, t2.s, t2.s);
    }
    ctx.globalAlpha = 1;

    // Cloud banks, silvered on their moonward edge.
    for (const c of this.clouds) {
      ctx.globalAlpha = c.a;
      for (const p of c.puffs) {
        ctx.fillStyle = '#2a3152';
        ctx.beginPath(); ctx.ellipse(c.x + p.dx, c.y + p.dy, p.rx, p.ry, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = c.a * 0.6;
      for (const p of c.puffs) {
        ctx.fillStyle = '#5a628c';
        ctx.beginPath(); ctx.ellipse(c.x + p.dx, c.y + p.dy - p.ry * 0.42, p.rx * 0.82, p.ry * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawMountains(ctx) {
    for (const rg of this.ranges) drawRange(ctx, rg.peaks, rg.base, rg.color, rg.snow);
    // Moonlight catches the crest of the farthest ridge.
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#6a74a0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const far = this.ranges[0];
    ctx.moveTo(-30, far.base);
    for (const p of far.peaks) { ctx.lineTo(p.x - p.halfW, far.base); ctx.lineTo(p.x, far.base - p.h); ctx.lineTo(p.x + p.halfW, far.base); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  _drawForeground(ctx) {
    // Ground the campfire sits on.
    ctx.fillStyle = '#090b12';
    ctx.fillRect(0, 212, VIEW_W, VIEW_H - 212);
    ctx.fillStyle = '#101522';
    ctx.fillRect(0, 212, VIEW_W, 2);

    const fx = 296, fy = 228;
    const flick = 0.82 + Math.sin(this.t * 11.3) * 0.09 + Math.sin(this.t * 5.1) * 0.09;

    // Firelight pooled on the ground.
    const glow = ctx.createRadialGradient(fx, fy - 3, 2, fx, fy - 3, 44 * flick);
    glow.addColorStop(0, 'rgba(255,168,70,0.42)');
    glow.addColorStop(0.5, 'rgba(220,110,40,0.16)');
    glow.addColorStop(1, 'rgba(220,110,40,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(fx, fy - 3, 44 * flick, 0, Math.PI * 2); ctx.fill();

    // The lone adventurer, warming their hands, facing the flames.
    const bob = Math.round(Math.sin(this.t * 1.5) * 0.5);
    let drew = false;
    try {
      drew = drawActor(ctx, this.hero, 320, 232 + bob, { dir: 'left', shadow: true, scale: 1 });
    } catch (e) { drew = false; }
    if (!drew) drawFallbackHero(ctx, 320, 232 + bob);

    // Stacked logs and flame.
    ctx.fillStyle = '#3a2617';
    ctx.fillRect(fx - 9, fy - 3, 18, 3);
    ctx.fillStyle = '#4a3120';
    ctx.fillRect(fx - 7, fy - 6, 5, 4);
    ctx.fillRect(fx + 2, fy - 6, 5, 4);
    ctx.fillStyle = '#1e1710';
    ctx.fillRect(fx - 11, fy, 22, 2);

    const fh = 13 * flick;
    ctx.fillStyle = '#e2521c';
    ctx.beginPath();
    ctx.moveTo(fx - 6, fy - 5); ctx.quadraticCurveTo(fx - 7, fy - 5 - fh * 0.7, fx, fy - 5 - fh);
    ctx.quadraticCurveTo(fx + 7, fy - 5 - fh * 0.7, fx + 6, fy - 5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff9b2c';
    ctx.beginPath();
    ctx.moveTo(fx - 4, fy - 5); ctx.quadraticCurveTo(fx - 4, fy - 5 - fh * 0.55, fx + 1, fy - 5 - fh * 0.78);
    ctx.quadraticCurveTo(fx + 5, fy - 5 - fh * 0.5, fx + 4, fy - 5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe08a';
    ctx.fillRect(fx - 2, fy - 9, 4, 4);

    // Embers rising into the dark.
    for (const e of this.embers) {
      ctx.globalAlpha = clamp(e.life, 0, 1) * 0.9;
      ctx.fillStyle = e.warm ? '#ffb03a' : '#ff6a2a';
      ctx.fillRect(e.x | 0, e.y | 0, e.s, e.s);
    }
    ctx.globalAlpha = 1;
  }

  // --- logo ---------------------------------------------------------------

  _logoPaint(ctx, top, mid, bottom) {
    glyphRun(ctx, 'SWORD COAST', VIEW_W / 2, 44, 4, top, 1);
    glyphRun(ctx, 'CHRONICLES', VIEW_W / 2, 78, 2, mid, 7);
    txtC(ctx, VIEW_W / 2, 94, 'A Tale of the Forgotten Realms — 1496 DR', { size: 'sm', color: bottom });
  }

  _drawLogo(ctx) {
    // Drop shadow, then the gold plate.
    ctx.save();
    ctx.translate(1, 2);
    this._logoPaint(ctx, 'rgba(0,0,0,0.75)', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.7)');
    ctx.restore();
    this._logoPaint(ctx, '#e0b352', '#c8a05a', '#a89a7c');

    // A gold shimmer sweeps the letters every few seconds.
    const PERIOD = 5.2, SWEEP = 1.15;
    const phase = this.shimmer % PERIOD;
    if (phase < SWEEP) {
      const p = phase / SWEEP;
      const sx = lerp(-80, VIEW_W + 80, p);
      const bw = 30, skew = 20, y0 = 36, y1 = 100;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx, y0); ctx.lineTo(sx + bw, y0);
      ctx.lineTo(sx + bw - skew, y1); ctx.lineTo(sx - skew, y1);
      ctx.closePath();
      ctx.clip();
      this._logoPaint(ctx, '#fff6cf', '#ffeeb4', '#e8dcb8');
      ctx.restore();
    }

    // Crossed-sword rule under the title.
    ctx.strokeStyle = 'rgba(224,179,82,0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(96, 103.5); ctx.lineTo(186, 103.5);
    ctx.moveTo(214, 103.5); ctx.lineTo(304, 103.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(224,179,82,0.75)';
    ctx.beginPath();
    ctx.moveTo(200, 100); ctx.lineTo(203, 103.5); ctx.lineTo(200, 107); ctx.lineTo(197, 103.5);
    ctx.closePath(); ctx.fill();
  }

  // --- menu ---------------------------------------------------------------

  _drawMenu(ctx) {
    const h = 10 + MENU_ITEMS.length * ROW_H;
    panel(ctx, MENU_X, MENU_Y, MENU_W, h, { style: 'window' });
    for (let i = 0; i < MENU_ITEMS.length; i++) {
      const it = MENU_ITEMS[i];
      const ry = MENU_Y + 8 + i * ROW_H;
      const on = i === this.index;
      const off = !this._enabled(i);
      if (on) {
        ctx.fillStyle = 'rgba(224,179,82,0.13)';
        ctx.fillRect(MENU_X + 3, ry - 3, MENU_W - 6, ROW_H - 2);
        cursor(ctx, MENU_X + 6, ry - 1, this.t);
      }
      const color = off ? 'rgba(154,145,127,0.45)' : (on ? C('gold') : C('ink'));
      txt(ctx, MENU_X + 17, ry, it.label, { size: 'md', color, shadow: true });
      if (off) txtR(ctx, MENU_X + MENU_W - 6, ry + 1, 'no save', { size: 'sm', color: 'rgba(154,145,127,0.4)' });
      else if (it.id === 'continue') {
        const s = this.slots[safeNewest()];
        if (s && !s.empty) txtR(ctx, MENU_X + MENU_W - 6, ry + 1, fit(s.label, 42, 'sm'), { size: 'sm', color: C('dim') });
      }
    }
    // Hint line for the highlighted entry. Suppressed until the audio gate is
    // passed, because "PRESS ANY KEY" sits on the same baseline.
    const hint = this.gated && MENU_ITEMS[this.index] && MENU_ITEMS[this.index].hint;
    if (hint) txt(ctx, MENU_X, MENU_Y + h + 5, fit(hint, 250, 'sm'), { size: 'sm', color: 'rgba(154,145,127,0.8)', shadow: true });
  }

  // --- load screen --------------------------------------------------------

  _drawLoad(ctx) {
    panel(ctx, 30, 18, 340, 204, { style: 'window' });
    txt(ctx, 40, 25, 'LOAD GAME', { size: 'md', color: C('gold'), shadow: true });
    txtR(ctx, 360, 26, 'Z load    X back', { size: 'sm', color: C('dim') });

    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const cy = 40 + i * 35;
      const on = i === this.slotIndex;
      // `gold` is a genuinely LIGHT brass plate. Every field below used to keep
      // its dark-panel colour when the row was selected — name at 1.12:1, level
      // and purse at 1.04:1, map at 1.04:1, date at 1.20:1 — so HIGHLIGHTING a
      // save made it less readable than the three around it. This is the first
      // screen of every returning session; the ink follows the plate now.
      const style = on ? 'gold' : 'dark';
      panel(ctx, 38, cy, 324, 33, { style });
      // Dark ink on a light plate wants a light shadow, or the drop shadow just
      // thickens every stroke into a smear.
      const sh = on ? 'rgba(255,228,168,0.40)' : true;
      const ink = (role, dark) => (on ? plateInk(style, role) : dark);
      if (on) cursor(ctx, 31, cy + 13, this.t);

      // Biome swatch, so slots read apart at a glance.
      ctx.fillStyle = BIOME_SWATCH[s.biome] || '#4a4438';
      ctx.fillRect(43, cy + 5, 5, 23);

      txt(ctx, 52, cy + 4, s.label, { size: 'sm', color: ink('title', C('dim')), shadow: sh });

      if (s.empty) {
        txt(ctx, 52, cy + 15, '— Empty —', { size: 'md', color: ink('dim', 'rgba(154,145,127,0.55)'), shadow: sh });
        continue;
      }
      if (s.corrupt) {
        txt(ctx, 52, cy + 15, 'Corrupt Save', { size: 'md', color: ink('accent', C('red')), shadow: sh });
        txtR(ctx, 356, cy + 16, 'cannot be read', { size: 'sm', color: ink('dim', C('dim')), shadow: sh });
        continue;
      }
      if (s.future) {
        txt(ctx, 52, cy + 15, s.name || 'Adventurer', { size: 'md', color: ink('body', C('dim')), shadow: sh });
        txtR(ctx, 356, cy + 16, 'newer version', { size: 'sm', color: ink('accent', C('red')), shadow: sh });
        continue;
      }

      // Right column first, so the left column can be told what is left of the row.
      const play = s.playtimeText || playtimeText(s.playtime || 0);
      const purse = `${s.gold || 0} gp`;
      const when = `Day ${s.day || 1}${s.ago ? ` · ${s.ago}` : ''}`;
      const rightW = Math.min(96, Math.max(tw(play, 'sm'), tw(purse, 'sm'), tw(when, 'sm')));
      const leftW = 356 - rightW - 6 - 100;

      const nameW = Math.min(leftW - 34, tw(s.name || 'Adventurer', 'md'));
      txt(ctx, 100, cy + 4, s.name || 'Adventurer', { size: 'md', color: ink('body', C('ink')), shadow: sh, maxWidth: nameW });
      txt(ctx, 100 + nameW + 6, cy + 5, `Lv ${s.level || s.avgLevel || 1}`, { size: 'sm', color: ink('dim', C('gold')), shadow: sh });
      txt(ctx, 356, cy + 5, play, { size: 'sm', color: ink('dim', C('dim')), align: 'right', shadow: sh, maxWidth: rightW });

      const names = (s.partyNames || []).slice(0, 4).join(', ') || 'Alone on the road';
      txt(ctx, 100, cy + 14, names, { size: 'sm', color: ink('dim', 'rgba(154,145,127,0.9)'), shadow: sh, maxWidth: leftW });
      txt(ctx, 356, cy + 14, purse, { size: 'sm', color: ink('dim', C('gold')), align: 'right', shadow: sh, maxWidth: rightW });

      txt(ctx, 100, cy + 23, s.mapName || 'The Sword Coast', { size: 'sm', color: ink('title', C('blue')), shadow: sh, maxWidth: leftW });
      txt(ctx, 356, cy + 23, when, { size: 'sm', color: ink('dim', C('dim')), align: 'right', shadow: sh, maxWidth: rightW });
    }
  }

  // --- bestiary screen ----------------------------------------------------

  _drawBestiary(ctx) {
    panel(ctx, 8, 8, 384, 224, { style: 'window' });
    txt(ctx, 16, 14, 'BESTIARY', { size: 'md', color: C('gold'), shadow: true });
    txtR(ctx, 384, 15, `Recorded ${this.beastKnown || 0} / ${this.beast.length}`, { size: 'sm', color: C('dim') });

    if (!this.beast.length) {
      if (!BESTIARY.ready) {
        txtC(ctx, VIEW_W / 2, 112, 'Opening the bestiary…', { size: 'md', color: C('dim') });
      } else {
        txtC(ctx, VIEW_W / 2, 110, 'No creatures are catalogued yet.', { size: 'md', color: C('dim') });
        txtC(ctx, VIEW_W / 2, 122, 'Kill something on the Triboar Trail and come back.', { size: 'sm', color: C('dim') });
      }
      txt(ctx, 16, 218, 'X  back', { size: 'sm', color: C('dim') });
      return;
    }

    // --- left: the roll of the slain ---
    for (let i = 0; i < BEAST_ROWS; i++) {
      const idx = this.beastScroll + i;
      if (idx >= this.beast.length) break;
      const e = this.beast[idx];
      const ry = 32 + i * 15;
      const on = idx === this.beastIndex;
      if (on) {
        ctx.fillStyle = 'rgba(224,179,82,0.15)';
        ctx.fillRect(14, ry, 150, 14);
        cursor(ctx, 8, ry + 4, this.t);
      }
      const known = e.kills > 0;
      // A 12px thumbnail: real sprite when known, black silhouette otherwise.
      drawMonsterThumb(ctx, e.m, 18, ry + 1, 12, known);
      txt(ctx, 34, ry + 4, known ? fit(e.m.name || e.id, 96, 'sm') : '?????????',
        { size: 'sm', color: known ? (on ? C('gold') : C('ink')) : 'rgba(154,145,127,0.5)' });
      txtR(ctx, 162, ry + 4, known ? `CR ${crText(e.m.cr ?? 0)}` : '—',
        { size: 'sm', color: known ? C('dim') : 'rgba(154,145,127,0.35)' });
    }
    // Scroll rail
    if (this.beast.length > BEAST_ROWS) {
      const railH = BEAST_ROWS * 15;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(166, 32, 2, railH);
      const th = Math.max(6, Math.round(railH * BEAST_ROWS / this.beast.length));
      const ty = 32 + Math.round((railH - th) * (this.beastScroll / Math.max(1, this.beast.length - BEAST_ROWS)));
      ctx.fillStyle = C('gold');
      ctx.fillRect(166, ty, 2, th);
    }

    // --- right: the stat block ---
    const e = this.beast[this.beastIndex];
    const m = e ? e.m : {};
    const known = e && e.kills > 0;
    panel(ctx, 174, 30, 210, 182, { style: 'dark' });

    const cx = 279;
    drawMonsterPortrait(ctx, m, cx, 78, known);

    if (!known) {
      txtC(ctx, cx, 92, '— UNKNOWN —', { size: 'md', color: 'rgba(154,145,127,0.6)' });
      txtC(ctx, cx, 106, 'No member of your party has', { size: 'sm', color: C('dim') });
      txtC(ctx, cx, 116, 'yet laid one of these low.', { size: 'sm', color: C('dim') });
      txtC(ctx, cx, 136, 'Entries unlock on the kill.', { size: 'sm', color: 'rgba(154,145,127,0.5)' });
    } else {
      txtC(ctx, cx, 88, fit(m.name || e.id, 196, 'md'), { size: 'md', color: C('gold'), shadow: true });
      txtC(ctx, cx, 100, fit(safeStatLine(m), 196, 'sm'), { size: 'sm', color: C('dim') });

      const L = 182, R = 288;
      const stat = (x, y, k, v, col) => {
        txt(ctx, x, y, k, { size: 'sm', color: 'rgba(154,145,127,0.75)' });
        txt(ctx, x + 28, y, String(v), { size: 'sm', color: col || C('ink') });
      };
      stat(L, 114, 'AC', m.ac != null ? m.ac : '—');
      stat(R, 114, 'HD', m.hpDice || '—');
      stat(L, 124, 'SPD', `${m.speed != null ? m.speed : 30} ft`);
      stat(R, 124, 'XP', xpSafe(e.id, m));
      stat(L, 134, 'TYPE', fit(m.type || 'humanoid', 62, 'sm'), C('blue'));
      stat(R, 134, 'SLAIN', e.kills, C('red'));

      const biomes = Array.isArray(m.biomes) && m.biomes.length ? m.biomes.join(', ') : 'unknown haunts';
      txt(ctx, L, 146, fit(`Found: ${biomes}`, 194, 'sm'), { size: 'sm', color: 'rgba(154,145,127,0.8)' });
      if (m.faction) txt(ctx, L, 156, fit(`Faction: ${m.faction}`, 194, 'sm'), { size: 'sm', color: C('purple') });

      ctx.fillStyle = 'rgba(92,74,42,0.6)';
      ctx.fillRect(L, 165, 196, 1);
      // maxLines keeps a wordy stat block from spilling out of the panel's foot.
      wrapped(ctx, L, 170, 196, String(m.desc || 'No lore has been written down.'),
        { size: 'sm', color: C('ink'), maxLines: 4 });
    }

    txt(ctx, 16, 218, 'W/S  browse    Q/E  page    X  back', { size: 'sm', color: 'rgba(154,145,127,0.7)' });
  }

  // --- credits ------------------------------------------------------------

  _drawCredits(ctx) {
    panel(ctx, 62, 22, 276, 196, { style: 'window' });
    txtC(ctx, 200, 30, 'SWORD COAST CHRONICLES', { size: 'md', color: C('gold'), shadow: true });
    txtC(ctx, 200, 42, 'A Tale of the Forgotten Realms — 1496 DR', { size: 'sm', color: C('dim') });
    ctx.fillStyle = 'rgba(92,74,42,0.7)';
    ctx.fillRect(74, 52, 252, 1);

    let y = 60;
    for (const [head, lines] of CREDITS) {
      txt(ctx, 76, y, head, { size: 'sm', color: C('gold') });
      y += 10;
      for (const ln of lines) { txt(ctx, 84, y, ln, { size: 'sm', color: C('ink') }); y += 9; }
      y += 3;
    }
    ctx.fillStyle = 'rgba(92,74,42,0.7)';
    ctx.fillRect(74, 196, 252, 1);
    txtC(ctx, 200, 201, 'May Tymora smile on you, and Beshaba look away.', { size: 'sm', color: C('gold') });
    txtC(ctx, 200, 210, 'X  back', { size: 'sm', color: C('dim') });
  }
}

const BEAST_ROWS = 12;

const CREDITS = [
  ['DESIGN & CODE', [
    'One hand-written Canvas2D engine.',
    'No libraries, no build step, no assets.',
  ]],
  ['RULES', [
    "Dungeons & Dragons, 2024 Player's",
    'Handbook — the full 5.5e engine.',
  ]],
  ['SETTING', [
    'The Forgotten Realms: Phandalin, the',
    'Sword Coast, Neverwinter Wood, and',
    'Undermountain beneath Waterdeep.',
  ]],
  ['ART & SOUND', [
    'Every sprite is drawn from text grids',
    'at runtime. Every note is procedural',
    'chiptune, synthesised by WebAudio.',
  ]],
];

// ===========================================================================
// GAME OVER SCENE
// ===========================================================================

const EPITAPHS = [
  'Kelemvor keeps the ledger, and every name upon it was once a life.',
  'The Lord of the Dead judges without malice — and without mercy.',
  'Your souls stand before the Crystal Spire. The Judge is listening.',
  'In the City of the Dead no coin buys a second dawn.',
  'Kelemvor grants the bold no favour, only a fair hearing.',
  'The Faithless wall waits for the forsworn. You are not among them.',
];

const GAMEOVER_ITEMS = [
  { id: 'load', label: 'Load Last Save' },
  { id: 'title', label: 'Return to Title' },
];

// Button geometry for the death screen, shared by the hit test and the draw so
// the two can never drift apart. "Return to Title" is 104px at md, and an 84px
// plate has a 76px face — BOTH choices used to read "… to …".
const GO_BTN = { w: 114, h: 16, gap: 10, y: 212 };
const goBtnX = (i) => Math.round((VIEW_W - GO_BTN.w * 2 - GO_BTN.gap) / 2) + i * (GO_BTN.w + GO_BTN.gap);

export class GameOverScene {
  /**
   * reason: short line explaining the wipe ("Slain by Klarg at Cragmaw Hideout").
   * opts: { onTitle(), onLoad(slot) }
   */
  constructor(reason = '', opts = {}) {
    this.id = 'gameover';
    this.opaque = true;
    this.pausesBelow = true;
    this.uiLayer = true;
    this.reason = String(reason || 'The party was overwhelmed.');
    this.opts = opts || {};
    this.t = 0;
    this.index = 0;
    this.busy = false;
    this.fallen = [];
    this.tally = [];
  }

  enter() {
    this.t = 0;
    this.busy = false;
    const st = (Game && Game.state) || {};
    const stats = st.stats || {};

    // Capture the roll of the dead before anything else clears the party.
    this.fallen = (Party.members || []).map((m) => ({
      name: m.name || 'Unnamed',
      level: m.level || (m.classes || []).reduce((a, c) => a + (c.level || 0), 0) || 1,
      cls: ((m.classes || [])[0] || {}).id || '',
      ch: m,
    }));
    if (!this.fallen.length) this.fallen = [{ name: 'An unnamed wanderer', level: 1, cls: '', ch: null }];

    const startDay = Number.isFinite(st.startDay) ? st.startDay : 121;
    const days = Math.max(1, (st.day || startDay) - startDay + 1);
    let deepest = stats.deepestFloor || 0;
    for (const k in (st.depth || {})) deepest = Math.max(deepest, st.depth[k] | 0);

    this.tally = [
      ['Days survived', days],
      ['Foes slain', stats.kills || 0],
      ['Deepest floor', deepest > 0 ? deepest : '—'],
      ['Battles fought', stats.battles || 0],
      ['Gold earned', `${stats.goldEarned || 0} gp`],
      ['Quests finished', stats.questsDone || 0],
    ];

    // A stable epitaph per campaign, so it does not flicker between frames.
    const seed = `${st.seed || 'sword-coast'}:${st.day || 0}:${stats.kills || 0}`;
    this.epitaph = makeRNG(seed).pick(EPITAPHS);

    this.loadSlot = safeNewest();
    if (this.loadSlot < 0) this.index = 1;

    try { Audio.music(null); Audio.sfx('defeat'); } catch (e) { /* ignore */ }
  }

  _enabled(i) { return !(GAMEOVER_ITEMS[i].id === 'load' && this.loadSlot < 0); }

  update(dt) {
    this.t += dt;
    if (this.busy || this.t < 0.8) return;     // let the screen settle before input

    const n = GAMEOVER_ITEMS.length;
    let moved = 0;
    if (Input.repeatConsume('up')) moved = -1;
    if (Input.repeatConsume('down')) moved = 1;
    if (moved) {
      let i = this.index;
      for (let s = 0; s < n; s++) { i = (i + moved + n) % n; if (this._enabled(i)) break; }
      if (i !== this.index) { this.index = i; sfx('cursor'); }
    }

    const m = Input.mouse;
    if (m && m.over) {
      for (let i = 0; i < n; i++) {
        // Must match the rects drawn in draw() below, or the buttons are click-deaf.
        const bx = goBtnX(i), by = GO_BTN.y;
        if (m.x >= bx && m.x <= bx + GO_BTN.w && m.y >= by && m.y <= by + GO_BTN.h) {
          if (this.index !== i && this._enabled(i)) { this.index = i; sfx('cursor'); }
          if (m.clicked) { m.clicked = false; this._activate(); }
          break;
        }
      }
    }

    if (Input.consume('confirm')) this._activate();
    if (Input.consume('cancel')) { this.index = 1; this._activate(); }
  }

  _activate() {
    if (!this._enabled(this.index)) { sfx('error'); return; }
    sfx('select');
    const id = GAMEOVER_ITEMS[this.index].id;
    if (id === 'title') {
      if (this.opts.onTitle) { this.opts.onTitle(); return; }
      this.busy = true;
      Party.clear();
      Game.state = null;
      Game.transition('fade', () => { Game.replace(new TitleScene()); });
      return;
    }
    // Load Last Save — reuse the title scene's loader so the flow stays in one place.
    if (this.opts.onLoad) { this.opts.onLoad(this.loadSlot); return; }
    this.busy = true;
    const title = new TitleScene();
    title.gated = true;
    Game.transition('fade', () => {
      Game.replace(title);
      title._load(this.loadSlot);
    });
  }

  draw(ctx) {
    const fade = clamp(this.t / 1.1, 0, 1);

    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // A slow blood-dark bloom behind the epitaph.
    const pulse = 0.5 + Math.sin(this.t * 0.7) * 0.12;
    const g = ctx.createRadialGradient(VIEW_W / 2, 96, 8, VIEW_W / 2, 96, 190);
    g.addColorStop(0, `rgba(96,20,18,${0.30 * pulse * fade})`);
    g.addColorStop(1, 'rgba(96,20,18,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.globalAlpha = fade;

    // Kelemvor's scales, rendered as a plain balance above the title.
    drawScales(ctx, VIEW_W / 2, 26, Math.sin(this.t * 0.9) * 1.6);

    ctx.save(); ctx.translate(1, 2);
    glyphRun(ctx, 'YOUR COMPANY', VIEW_W / 2, 44, 3, 'rgba(0,0,0,0.8)', 2);
    glyphRun(ctx, 'HAS FALLEN', VIEW_W / 2, 68, 3, 'rgba(0,0,0,0.8)', 2);
    ctx.restore();
    glyphRun(ctx, 'YOUR COMPANY', VIEW_W / 2, 44, 3, '#9d3a30', 2);
    glyphRun(ctx, 'HAS FALLEN', VIEW_W / 2, 68, 3, '#9d3a30', 2);

    // 340px cut "Cut down by the Bugbear Chief in the ruins of Cragmaw Castle."
    // (359px) two words short of the fact it exists to state.
    txt(ctx, VIEW_W / 2, 92, this.reason, { size: 'sm', color: C('dim'), align: 'center', maxWidth: 384 });

    // --- the roll of the dead ---
    panel(ctx, 20, 106, 180, 92, { style: 'dark' });
    txt(ctx, 27, 112, 'THE FALLEN', { size: 'sm', color: C('gold') });
    let y = 125;
    for (const f of this.fallen.slice(0, 4)) {
      drawSkull(ctx, 28, y, 'rgba(200,190,170,0.75)');
      const lv = `Lv ${f.level}${f.cls ? ' ' + f.cls.slice(0, 3) : ''}`;
      const lvW = Math.min(tw(lv, 'sm'), 60);
      txt(ctx, 40, y, f.name, { size: 'sm', color: C('ink'), maxWidth: 153 - lvW - 4 });
      txt(ctx, 193, y, lv, { size: 'sm', color: C('dim'), align: 'right', maxWidth: lvW });
      y += 12;
    }
    if (this.fallen.length > 4) txt(ctx, 40, y, `and ${this.fallen.length - 4} more`, { size: 'sm', color: C('dim') });

    // --- final tally ---
    panel(ctx, 204, 106, 176, 92, { style: 'dark' });
    txt(ctx, 211, 112, 'FINAL TALLY', { size: 'sm', color: C('gold') });
    let ty = 125;
    for (const [k, v] of this.tally) {
      const val = String(v);
      const vw = Math.min(tw(val, 'sm'), 76);
      txt(ctx, 212, ty, k, { size: 'sm', color: 'rgba(154,145,127,0.85)', maxWidth: 161 - vw - 4 });
      txt(ctx, 373, ty, val, { size: 'sm', color: C('ink'), align: 'right', maxWidth: vw });
      ty += 11;
    }

    // --- epitaph ---
    txtC(ctx, VIEW_W / 2, 200, fit(this.epitaph || EPITAPHS[0], 380, 'sm'),
      { size: 'sm', color: 'rgba(200,160,90,0.85)' });

    // --- choices ---
    for (let i = 0; i < GAMEOVER_ITEMS.length; i++) {
      const it = GAMEOVER_ITEMS[i];
      const bx = goBtnX(i), by = GO_BTN.y;
      const on = i === this.index;
      const off = !this._enabled(i);
      let drewButton = false;
      try {
        if (UI && UI.button) { UI.button(ctx, bx, by, GO_BTN.w, GO_BTN.h, it.label, { selected: on, disabled: off }); drewButton = true; }
      } catch (e) { drewButton = false; }
      if (!drewButton) {
        // Same rule as the load slots: a selected `gold` plate is a LIGHT plate,
        // so C('gold') on it is 1.04:1. Ask the style what ink it carries.
        const st = on ? 'gold' : 'dark';
        panel(ctx, bx, by, GO_BTN.w, GO_BTN.h, { style: st });
        txt(ctx, bx + GO_BTN.w / 2, by + 5, it.label, {
          size: 'sm', align: 'center', maxWidth: GO_BTN.w - 6,
          shadow: on ? 'rgba(255,228,168,0.40)' : true,
          color: off ? 'rgba(154,145,127,0.4)' : plateInk(st, on ? 'title' : 'body'),
        });
      }
      if (on) cursor(ctx, bx - 8, by + 5, this.t);
    }

    ctx.restore();
  }
}

// ===========================================================================
// Drawing helpers
// ===========================================================================

/** A row of overlapping peaks. Union-filled, so overlaps read as one ridge. */
function makeRange(r, baseY, minH, maxH, spacing) {
  const peaks = [];
  let x = -24;
  while (x < VIEW_W + 34) {
    const h = r.int(minH, maxH);
    const halfW = Math.round(h * r.float(0.72, 1.3));
    peaks.push({ x: Math.round(x), h, halfW });
    x += Math.round(halfW * r.float(0.7, 1.25)) + spacing;
  }
  return peaks;
}

function drawRange(ctx, peaks, baseY, color, snowColor) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-34, baseY);
  for (const p of peaks) {
    ctx.lineTo(p.x - p.halfW, baseY);
    ctx.lineTo(p.x, baseY - p.h);
    ctx.lineTo(p.x + p.halfW, baseY);
  }
  ctx.lineTo(VIEW_W + 34, baseY);
  ctx.lineTo(VIEW_W + 34, VIEW_H);
  ctx.lineTo(-34, VIEW_H);
  ctx.closePath();
  ctx.fill();

  if (!snowColor) return;
  ctx.fillStyle = snowColor;
  for (const p of peaks) {
    if (p.h < 30) continue;
    const cw = Math.max(2, Math.round(p.halfW * 0.28));
    ctx.beginPath();
    ctx.moveTo(p.x - cw, baseY - p.h + cw * 1.7);
    ctx.lineTo(p.x, baseY - p.h);
    ctx.lineTo(p.x + cw, baseY - p.h + cw * 1.7);
    ctx.closePath();
    ctx.fill();
  }
}

/** Used when no hero sprite family has been defined yet. */
function drawFallbackHero(ctx, x, y) {
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(x, y - 1, 6, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#1b1d2c';
  ctx.fillRect(x - 5, y - 20, 10, 14);          // cloaked body
  ctx.fillRect(x - 6, y - 16, 12, 8);           // cloak flare
  ctx.fillRect(x - 2, y - 6, 2, 6);
  ctx.fillRect(x + 1, y - 6, 2, 6);
  ctx.fillStyle = '#2a2d40';
  ctx.fillRect(x - 4, y - 26, 8, 7);            // head
  ctx.fillStyle = '#3c3f58';
  ctx.fillRect(x + 4, y - 24, 2, 20);           // staff
}

/** Kelemvor's balance — two pans on a beam, tilting very slowly. */
function drawScales(ctx, cx, cy, tilt) {
  ctx.strokeStyle = 'rgba(200,190,170,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + 0.5, cy - 6); ctx.lineTo(cx + 0.5, cy + 8);
  ctx.moveTo(cx - 15, cy - 3 + tilt); ctx.lineTo(cx + 15, cy - 3 - tilt);
  ctx.moveTo(cx - 14, cy - 3 + tilt); ctx.lineTo(cx - 14, cy + 3 + tilt);
  ctx.moveTo(cx + 14, cy - 3 - tilt); ctx.lineTo(cx + 14, cy + 3 - tilt);
  ctx.stroke();
  ctx.fillStyle = 'rgba(200,190,170,0.5)';
  ctx.fillRect(cx - 18, cy + 3 + tilt, 9, 2);
  ctx.fillRect(cx + 10, cy + 3 - tilt, 9, 2);
  ctx.fillRect(cx - 4, cy + 8, 9, 2);
}

function drawSkull(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y, 6, 5);
  ctx.fillRect(x + 2, y + 5, 4, 2);
  ctx.fillStyle = '#0b0d16';
  ctx.fillRect(x + 2, y + 2, 2, 2);
  ctx.fillRect(x + 5, y + 2, 1, 2);
}

/** A tiny bestiary thumbnail: real sprite when known, black silhouette when not. */
function drawMonsterThumb(ctx, m, x, y, size, known) {
  const name = m && m.sprite;
  const frame = name ? firstFrame(name) : null;
  if (!frame) {
    ctx.fillStyle = known ? 'rgba(154,145,127,0.5)' : 'rgba(0,0,0,0.75)';
    ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
    return;
  }
  const d = spriteSize(name);
  const scale = Math.min(size / Math.max(1, d.w), size / Math.max(1, d.h));
  const dw = Math.max(1, Math.round(d.w * scale)), dh = Math.max(1, Math.round(d.h * scale));
  const dx = Math.round(x + (size - dw) / 2), dy = Math.round(y + (size - dh) / 2);
  if (known) {
    try { drawSpriteAt(ctx, name, frame, dx, dy, { scale }); return; } catch (e) { /* below */ }
  }
  try {
    const sil = getSilhouette(name, frame, '#05070e');
    if (sil) { ctx.imageSmoothingEnabled = false; ctx.drawImage(sil, dx, dy, dw, dh); return; }
  } catch (e) { /* below */ }
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(dx, dy, dw, dh);
}

/** The big portrait in the bestiary detail pane, centred on (cx, baseY). */
function drawMonsterPortrait(ctx, m, cx, baseY, known) {
  const name = m && m.sprite;
  const frame = name ? firstFrame(name) : null;

  // Pedestal shadow so the creature is not floating in the void.
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(cx, baseY + 1, 20, 4, 0, 0, Math.PI * 2); ctx.fill();

  if (!frame) {
    ctx.fillStyle = known ? 'rgba(154,145,127,0.35)' : 'rgba(0,0,0,0.8)';
    ctx.fillRect(cx - 12, baseY - 30, 24, 30);
    return;
  }
  const d = spriteSize(name);
  const scale = clamp(Math.min(46 / Math.max(1, d.w), 46 / Math.max(1, d.h)), 1, 3);
  const dw = Math.round(d.w * scale), dh = Math.round(d.h * scale);
  const dx = Math.round(cx - dw / 2), dy = Math.round(baseY - dh);
  if (known) {
    try { if (drawSpriteAt(ctx, name, frame, dx, dy, { scale })) return; } catch (e) { /* below */ }
  }
  try {
    const sil = getSilhouette(name, frame, '#04060c');
    if (sil) { ctx.imageSmoothingEnabled = false; ctx.drawImage(sil, dx, dy, dw, dh); return; }
  } catch (e) { /* below */ }
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(dx, dy, dw, dh);
}

// ===========================================================================
// Save / catalogue access — every call is wrapped so a broken store never
// takes down the title screen.
// ===========================================================================

function safeSlots() {
  try { const l = Save.list(); return Array.isArray(l) ? l : []; } catch (e) { console.warn('[title] save list failed', e); return []; }
}
function safeNewest() {
  try { const n = Save.newest ? Save.newest() : -1; return Number.isInteger(n) ? n : -1; } catch (e) { return -1; }
}
function safeRead(slot) {
  try { return Save.read(slot); } catch (e) { console.warn('[title] save read failed', e); return null; }
}
function safeStatLine(m) {
  if (BESTIARY.statLine) {
    try { return BESTIARY.statLine(m); } catch (e) { /* fall through to the plain line */ }
  }
  const size = m && m.size ? m.size[0].toUpperCase() + m.size.slice(1) : 'Medium';
  return `${size} ${(m && m.type) || 'creature'} · CR ${crText((m && m.cr) ?? 0)}`;
}
function xpSafe(id, m) {
  if (BESTIARY.xpOf) {
    try { const v = BESTIARY.xpOf(id); if (v) return v; } catch (e) { /* fall through */ }
  }
  return m && m.xp != null ? m.xp : '—';
}

/**
 * The bestiary is a campaign record, so at the title screen it is merged from
 * the live state (if any) and every save on disk. Uses readRaw so that peeking
 * never rewrites the "last slot" marker that Continue depends on.
 */
function collectBestiary() {
  const out = {};
  const merge = (b) => {
    if (!b || typeof b !== 'object') return;
    for (const k in b) { const v = b[k] | 0; if (v > (out[k] | 0)) out[k] = v; }
  };
  try { merge(Game.state && Game.state.bestiary); } catch (e) { /* ignore */ }
  const count = Number.isInteger(SLOT_COUNT) ? SLOT_COUNT : 5;
  for (let s = 0; s < count; s++) {
    try {
      const env = Save.readRaw ? Save.readRaw(s) : null;
      merge(env && env.data && env.data.bestiary);
    } catch (e) { /* a bad slot must not blank the whole roll */ }
  }
  return out;
}

export default TitleScene;
