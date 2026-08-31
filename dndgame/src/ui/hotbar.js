// ui/hotbar.js — the bottom bar: what you can do right now, and the key that does it.
//
// The overworld had no visible verbs. Talking was E, attacking was Shift+E,
// and casting Mage Armor meant opening the pause menu, finding Spells, walking
// a cursor to the right row and pressing Z. All of it was real; none of it was
// discoverable, and a player who did not read the source had no way to learn
// that half of it existed.
//
// So: one strip along the bottom, always there, that shows
//
//   [E] Talk   [⇧E] Attack │ ①Mage Armor ②Light ③Potion ④— │ [I][K][M][esc]
//
// Everything on it is clickable AND keyed, and everything greys out with a
// reason rather than simply failing. The two buttons on the left are
// contextual: they name whatever you are standing in front of.
//
// This module owns layout, drawing and hit-testing only. The overworld builds
// the model each frame (it is the thing that knows what you are facing and
// what your party can cast) and hands it in.

import { UI } from './kit.js';
import { VIEW_W, VIEW_H, clamp } from '../constants.js';

function safe(fn, fb) { try { const v = fn(); return v === undefined ? fb : v; } catch (e) { return fb; } }

const C = UI.COLORS;

export const SLOT_COUNT = 4;

// The bar sits under everything else the HUD draws, clear of the minimap.
export const BAR = { x: 3, y: VIEW_H - 15, w: 334, h: 14 };

// At 400 logical pixels there is not room for four NAMED slots as well as two
// named verbs and the screen shortcuts — everything ends up as "Bla…". So the
// verbs, which are the whole point of the bar, get enough width to say what
// they are, and the slots go to icon-and-digit with the name on hover and in
// the line the bar prints after you use one.
const ACT_W = 70;          // the two contextual buttons on the left
const SLOT_W = 22;         // a quick slot: icon + digit
const SLOT_GAP = 1;
const ICON_W = 14;         // the fixed shortcuts on the right

export class Hotbar {
  constructor() {
    this.hot = [];         // { x, y, w, h, fn, tip } — rebuilt every draw
    this.tip = '';         // the line shown above the bar when hovering
    this.tipT = 0;
    this.flash = -1;       // slot index to pulse after it fires
    this.flashT = 0;
    this.hoverIndex = -1;
  }

  update(dt) {
    if (this.tipT > 0) this.tipT -= dt;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash = -1; }
  }

  say(text) { this.tip = String(text || ''); this.tipT = 2.4; }

  /** Pulse a slot that just fired, so a click reads as having done something. */
  pulse(i) { this.flash = i; this.flashT = 0.35; }

  // -------------------------------------------------------------------------
  // INPUT
  // -------------------------------------------------------------------------

  /** Is (mx, my) over the bar at all? Used to swallow world clicks. */
  contains(mx, my) {
    return mx >= BAR.x - 1 && mx <= BAR.x + BAR.w + 1 && my >= BAR.y - 1 && my <= BAR.y + BAR.h + 1;
  }

  /** Run whatever sits under the pointer. Returns true if something did. */
  click(mx, my) {
    for (let i = this.hot.length - 1; i >= 0; i--) {
      const r = this.hot[i];
      if (mx < r.x || mx > r.x + r.w || my < r.y || my > r.y + r.h) continue;
      if (r.fn) { safe(() => r.fn()); return true; }
      if (r.tip) { this.say(r.tip); return true; }
      return true;
    }
    return false;
  }

  /** Hovering names the thing under the pointer without clicking it. */
  hover(mx, my) {
    for (let i = this.hot.length - 1; i >= 0; i--) {
      const r = this.hot[i];
      if (mx < r.x || mx > r.x + r.w || my < r.y || my > r.y + r.h) continue;
      if (r.tip) { this.tip = r.tip; this.tipT = 0.2; }
      return;
    }
  }

  // -------------------------------------------------------------------------
  // DRAW
  // -------------------------------------------------------------------------

  /**
   * model: {
   *   action: { key, label, enabled, why, fn } | null   — the E verb
   *   attack: { key, label, enabled, why, fn } | null   — the Shift+E verb
   *   slots:  [{ name, icon, ready, why, count, fn }]   — quick slots, 1..4
   *   menus:  [{ key, icon, label, fn }]                — the fixed shortcuts
   * }
   */
  draw(ctx, model) {
    this.hot = [];
    const m = model || {};

    UI.panel(ctx, BAR.x, BAR.y, BAR.w, BAR.h, { style: 'dark', shadow: 0.5, studs: false });

    let x = BAR.x + 2;
    x = this._verb(ctx, x, m.action, 'E');
    // No shift glyph in the 5x7 face; the up-chevron reads as one in a keycap.
    x = this._verb(ctx, x, m.attack, UI.G.chevUp + 'E');
    x += 2;
    this._rule(ctx, x); x += 3;

    for (let i = 0; i < SLOT_COUNT; i++) {
      x = this._slot(ctx, x, i, (m.slots || [])[i]);
    }
    x += 2;
    this._rule(ctx, x); x += 3;

    for (const b of (m.menus || [])) x = this._menuBtn(ctx, x, b);

    if (this.tipT > 0 && this.tip) this._tip(ctx);
  }

  _rule(ctx, x) {
    ctx.fillStyle = 'rgba(120,104,72,0.5)';
    ctx.fillRect(Math.round(x), BAR.y + 3, 1, BAR.h - 6);
  }

  /** One of the two contextual verbs on the left. */
  _verb(ctx, x, v, key) {
    const y = BAR.y + 2;
    const w = ACT_W;
    const on = !!(v && v.enabled);
    const label = (v && v.label) || '—';

    UI.panel(ctx, x, y, w, BAR.h - 4, { style: on ? 'window' : 'plain', shadow: 0.2, studs: false });
    const kw = Math.max(9, UI.measure(key, 'sm') + 4);
    ctx.globalAlpha = on ? 1 : 0.45;
    UI.panel(ctx, x + 1, y + 1, kw, BAR.h - 6, { style: 'gold', shadow: 0.2, studs: false });
    UI.text(ctx, x + 1 + kw / 2, y + 2, key, { size: 'sm', color: '#2a1c07', align: 'center' });
    UI.text(ctx, x + kw + 3, y + 2, UI.fit(label, w - kw - 5, 'sm'), {
      size: 'sm', color: on ? C.ink : C.disabled, shadow: true,
    });
    ctx.globalAlpha = 1;

    this.hot.push({
      x, y, w, h: BAR.h - 4,
      fn: v && v.enabled && v.fn ? v.fn : null,
      tip: v ? (v.enabled ? (v.tip || label) : (v.why || 'Not just now.')) : 'Nothing in front of you.',
    });
    return x + w + 2;
  }

  /** A quick slot: an icon, the digit that fires it, and the name on hover. */
  _slot(ctx, x, i, s) {
    const y = BAR.y + 2;
    const w = SLOT_W;
    const h = BAR.h - 4;
    const ready = !!(s && s.ready);
    const lit = this.flash === i && this.flashT > 0;

    UI.panel(ctx, x, y, w, h, {
      style: lit ? 'gold' : s ? 'inset' : 'plain', shadow: 0.2, studs: false,
    });

    if (s) {
      const icon = s.icon || (s.kind === 'item' ? 'potion'
        : s.role === 'heal' ? 'plus'
          : s.role === 'world' ? 'wand' : 'shield');
      const tint = lit ? '#2a1c07'
        : !ready ? C.disabled
          : s.kind === 'item' || s.role === 'heal' ? C.good
            : s.role === 'world' ? C.gold : C.blue;
      safe(() => UI.icon(ctx, icon, x + 3, y + 1, 8, tint));
    }

    // The digit rides the bottom-right corner so it never fights the icon.
    UI.text(ctx, x + w - 5, y + 4, String(i + 1), {
      size: 'sm', color: lit ? '#2a1c07' : ready ? C.gold : C.disabled,
    });

    this.hot.push({
      x, y, w, h,
      fn: ready && s && s.fn ? s.fn : null,
      tip: s ? (ready ? (s.tip || s.name) : (s.why || 'Not available.')) : 'Empty slot.',
    });
    return x + w + SLOT_GAP;
  }

  /** One of the fixed screen shortcuts on the right. */
  _menuBtn(ctx, x, b) {
    const y = BAR.y + 2;
    const w = ICON_W;
    const h = BAR.h - 4;
    UI.panel(ctx, x, y, w, h, { style: 'window', shadow: 0.2, studs: false });
    if (b.icon) safe(() => UI.icon(ctx, b.icon, x + Math.round((w - 8) / 2), y + 1, 8, C.gold));
    else UI.text(ctx, x + w / 2, y + 2, b.key, { size: 'sm', color: C.gold, align: 'center' });
    this.hot.push({ x, y, w, h, fn: b.fn || null, tip: `${b.label}  [${b.key}]` });
    return x + w + 1;
  }

  /** The hover/refusal line, floated just above the bar. */
  _tip(ctx) {
    // 220px is 36 characters; the strip starts at x=5, so a tip can run to 320
    // before it leaves the screen, and "Otiluke's Resilient Sphere" is a name
    // worth showing whole.
    const label = UI.fit(this.tip, 320, 'sm');
    const w = UI.measure(label, 'sm') + 10;
    const x = clamp(Math.round(BAR.x + 2), 2, VIEW_W - w - 2);
    const y = BAR.y - 12;
    ctx.save();
    ctx.globalAlpha = clamp(this.tipT / 0.25, 0, 1);
    UI.panel(ctx, x, y, w, 11, { style: 'dark', shadow: 0.45, studs: false });
    UI.text(ctx, x + 5, y + 2, label, { size: 'sm', color: C.goldBright, shadow: true });
    ctx.restore();
  }
}

export default Hotbar;
