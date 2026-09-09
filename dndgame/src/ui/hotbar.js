// ui/hotbar.js — the bottom bar: what you can do right now, and the key that does it.
//
// One contextual E button, four quick slots and four menu shortcuts. Shift
// changes the context to Attack only while facing a creature. Empty ground
// shows a quiet Explore state rather than a second permanent attack button.
// The overworld owns verb selection; this module shares draw and hit geometry.

import { UI } from './kit.js';
import { medievalPanel } from './ornament.js';
import { VIEW_W, VIEW_H, clamp } from '../constants.js';

function safe(fn, fb) { try { const v = fn(); return v === undefined ? fb : v; } catch (e) { return fb; } }

const C = UI.COLORS;

export const SLOT_COUNT = 4;

// The bar sits under everything else the HUD draws, clear of the minimap.
export const BAR = { x: 3, y: VIEW_H - 27, w: 300, h: 24 };

// At 400 logical pixels there is not room for four NAMED slots as well as two
// named verbs and the screen shortcuts — everything ends up as "Bla…". So the
// verbs, which are the whole point of the bar, get enough width to say what
// they are, and the slots go to icon-and-digit with the name on hover and in
// the line the bar prints after you use one.
const ACT_W = 56;          // one contextual action
const SLOT_W = 30;         // a quick slot: icon + digit
const SLOT_GAP = 1;
const ICON_W = 24;         // the fixed shortcuts on the right

export class Hotbar {
  constructor() {
    this.t = 0;
    this.hot = [];         // { x, y, w, h, fn, tip } — rebuilt every draw
    this.tip = '';         // the line shown above the bar when hovering
    this.tipT = 0;
    this.flash = -1;       // slot index to pulse after it fires
    this.flashT = 0;
    this.hoverIndex = -1;
  }

  update(dt) {
    this.t += dt;
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
    this.hoverIndex = -1;
    for (let i = this.hot.length - 1; i >= 0; i--) {
      const r = this.hot[i];
      if (mx < r.x || mx > r.x + r.w || my < r.y || my > r.y + r.h) continue;
      this.hoverIndex = i;
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
   *   slots:  [{ name, icon, ready, why, count, fn, needsChoice }]  — quick slots, 1..4
   *           `needsChoice` marks a spell that has to ask the player something
   *           before it can be cast (Teleport: where? Creation: what?). The bar
   *           has no room to ask, so it says where the question lives instead
   *           of firing a verb that can only refuse. rules/fieldcast.js exports
   *           `fieldNeedsChoice(spellId)` for whoever builds the model.
   *   menus:  [{ key, icon, label, fn }]                — the fixed shortcuts
   * }
   */
  draw(ctx, model) {
    this.hot = [];
    const m = model || {};

    medievalPanel(ctx, BAR.x, BAR.y, BAR.w, BAR.h);

    let x = BAR.x + 2;
    x = this._verb(ctx, x, m.context || m.action, m.aggressive ? UI.G.chevUp + 'E' : 'E');
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

  _plate(ctx, x, w, active, color = C.gold) {
    const y = BAR.y + 2, h = BAR.h - 4;
    const hover = this.hoverIndex === this.hot.length;
    medievalPanel(ctx, x, y, w, h, { active: hover && active, inset: true });
    if (hover) {
      ctx.save(); ctx.globalAlpha = 0.12 + Math.sin(this.t * 5) * 0.03;
      ctx.fillStyle = color; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);ctx.restore();
    }
    return { x, y, w, h };
  }

  _verb(ctx, x, v, key) {
    const on = !!v?.enabled, label = v?.label || 'Explore';
    const color = key === 'E' ? '#d9c28f' : '#c98260';
    const r = this._plate(ctx, x, ACT_W, on, color);
    UI.text(ctx, x + 5, r.y + 3, key, { size: 'sm', color: on ? color : C.disabled });
    safe(() => UI.icon(ctx, key !== 'E' || v?.label === 'Fight' ? 'sword' : v?.label === 'Talk' ? 'scroll' : v?.label === 'Open' ? 'bag' : v?.label === 'Enter' ? 'door' : 'eye', x + r.w - 15, r.y + 2, 9, on ? color : C.disabled));
    UI.text(ctx, x + 5, r.y + 11, UI.fit(label, r.w - 10, 'sm'), { size: 'sm', color: on ? '#e7d5b0' : '#82725c' });
    this.hot.push({ ...r, fn: on ? v.fn : null, tip: v ? (on ? (v.tip || label) : (v.why || 'Not just now.')) : 'Nothing in front of you.' });
    return x + ACT_W + 2;
  }

  _slot(ctx, x, i, s) {
    const ready = !!s?.ready, lit = this.flash === i && this.flashT > 0;
    const color = s?.kind === 'item' || s?.role === 'heal' ? '#88c89b' : s?.role === 'world' ? '#dec17b' : '#8daee0';
    const r = this._plate(ctx, x, SLOT_W, ready, color);
    UI.text(ctx, x + 3, r.y + 2, String(i + 1), { size: 'sm', color: ready ? color : C.disabled });
    if (s) safe(() => UI.icon(ctx, s.icon || (s.kind === 'item' ? 'potion' : s.role === 'heal' ? 'plus' : s.role === 'world' ? 'wand' : 'shield'), x + 13, r.y + 4, 11, ready ? color : C.disabled));
    else { ctx.fillStyle = '#68533b';ctx.fillRect(x + 14, r.y + 10, 7, 1); }
    if (s?.count != null) UI.text(ctx, x + r.w - 4, r.y + 14, String(s.count), { size: 'sm', color: C.ink, align: 'right' });
    if (lit) { ctx.save();ctx.globalAlpha = this.flashT;ctx.fillStyle = color;ctx.fillRect(x + 1, r.y + 1, r.w - 2, r.h - 2);ctx.restore(); }
    this.hot.push({ ...r, fn: ready ? s.fn : null, tip: !s ? 'Empty slot - assign from your spellbook or inventory.' : !ready ? (s.why || 'Not available.') : s.needsChoice ? `${s.name} - open the spellbook to choose` : (s.tip || s.name) });
    return x + SLOT_W + SLOT_GAP;
  }

  _menuBtn(ctx, x, b) {
    const r = this._plate(ctx, x, ICON_W, true, '#b9ac8c');
    if (b.icon) safe(() => UI.icon(ctx, b.icon, x + 7, r.y + 2, 10, C.gold));
    UI.text(ctx, x + r.w / 2, r.y + 11, UI.fit(b.key, r.w - 4, 'sm'), { size: 'sm', color: C.inkDim, align: 'center' });
    this.hot.push({ ...r, fn: b.fn || null, tip: `${b.label}  [${b.key}]` });
    return x + ICON_W + 1;
  }

  /** The hover/refusal line, floated just above the bar. */
  _tip(ctx) {
    // 220px is 36 characters; the strip starts at x=5, so a tip can run to 320
    // before it leaves the screen, and "Otiluke's Resilient Sphere" is a name
    // worth showing whole.
    const label = UI.fit(this.tip, BAR.w - 14, 'sm');
    const w = UI.measure(label, 'sm') + 10;
    const x = clamp(Math.round(BAR.x + 2), 2, VIEW_W - w - 2);
    const y = BAR.y - 12;
    ctx.save();
    ctx.globalAlpha = clamp(this.tipT / 0.25, 0, 1);
    medievalPanel(ctx, x, y, w, 11);
    UI.text(ctx, x + 5, y + 2, label, { size: 'sm', color: C.goldBright, shadow: true });
    ctx.restore();
  }
}

export default Hotbar;
