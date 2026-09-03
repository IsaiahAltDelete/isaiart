// engine.js — the game loop, the scene stack, and screen transitions.
//
// Scenes are plain objects (or class instances) with optional hooks:
//   enter(prev)  exit(next)  update(dt)  draw(ctx)  drawOver(ctx)
//   opaque:bool (default true)  pausesBelow:bool (default true)
//   uiLayer:bool (default false) — an interface screen rather than a piece of the
//     world. FX weather/grading stops at the first uiLayer scene, so a blizzard
//     never blows through the inventory.
//   drawUI(ctx) — a world scene's own interface, painted after the weather.
// The stack lets menus, dialogue and battles layer over the overworld without
// any of them knowing about each other.

import { VIEW_W, VIEW_H, MAX_DT, clamp } from './constants.js';
import { Input } from './core/input.js';
import { FX } from './render/fx.js';
// ui/kit.js pulls in render/sprites.js, core/rng.js and constants.js only, so
// this does not close a cycle back onto the engine.
import { UI } from './ui/kit.js';
import { Save } from './core/save.js';
import { bus } from './core/events.js';

/**
 * How deep the canvas state stack is ever allowed to get in one frame.
 * _draw drains this many levels before painting, so a scene that threw
 * mid-clip last frame cannot leave the screen stuck inside its viewport.
 * restore() on an empty stack is a no-op, so over-draining is free.
 */
const MAX_CTX_DEPTH = 32;

export const Game = {
  canvas: null,
  ctx: null,
  scale: 1,
  offX: 0,
  offY: 0,
  scenes: [],
  time: 0,
  dt: 0,
  frame: 0,
  fps: 60,
  paused: false,
  flags: {},
  state: null,          // the GameState (see state.js)
  debug: false,
  _raf: 0,
  _last: 0,
  _fpsAcc: 0,
  _fpsFrames: 0,

  get top() { return this.scenes[this.scenes.length - 1] || null; },

  /** Mount the canvas, size it, and start the loop on `rootScene`. */
  start(rootScene, canvas) {
    this.canvas = canvas || document.getElementById('game');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    this.ctx.imageSmoothingEnabled = false;

    Input.attach(this.canvas);
    window.addEventListener('resize', () => this.resize());
    // Window Scale lives in Settings > Display; re-fit the moment it changes.
    bus.on('settings:changed', () => this.resize());
    this.resize();

    if (rootScene) this.push(rootScene);
    this._last = performance.now();
    this._raf = requestAnimationFrame((t) => this._tick(t));
  },

  /**
   * Fit the logical canvas into the window at an integer scale so pixels stay
   * square and crisp. Falls back to a fractional scale on very small windows.
   */
  resize() {
    const cw = window.innerWidth, chh = window.innerHeight;
    let s = Math.min(cw / VIEW_W, chh / VIEW_H);
    s = s >= 1 ? Math.floor(s) : s;
    if (s <= 0) s = 1;
    // Settings > Display > Window Scale. 'auto' fills the window, which on a
    // 1080p monitor means 4x -- a 5px font printed 20px tall and menus to
    // match. Pinning it to 2 or 3 keeps the UI the size it was designed at and
    // letterboxes the rest. The option has always been in the list; nothing
    // read it, so every window silently ran at maximum.
    let pref = 'auto';
    try { pref = Save.settings.scale; } catch { pref = 'auto'; }
    const pinned = Number(pref);
    if (pref !== 'auto' && Number.isFinite(pinned) && pinned > 0) s = Math.min(pinned, s);
    this.scale = s;
    const w = Math.round(VIEW_W * s), h = Math.round(VIEW_H * s);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.offX = Math.floor((cw - w) / 2);
    this.offY = Math.floor((chh - h) / 2);
    Input.setMouseTransform(s, this.offX, this.offY);
  },

  // --- scene stack --------------------------------------------------------

  push(scene) {
    const prev = this.top;
    if (prev && prev.exit) prev.exit(scene);
    this.scenes.push(scene);
    if (scene.enter) scene.enter(prev);
    Input.flush();
    return scene;
  },

  pop(result) {
    const scene = this.scenes.pop();
    if (scene && scene.exit) scene.exit(this.top);
    const now = this.top;
    if (now && now.enter) now.enter(scene, result);
    if (scene && scene.onClose) scene.onClose(result);
    Input.flush();
    return scene;
  },

  /** Replace the whole stack (used for title -> game and game over). */
  replace(scene) {
    while (this.scenes.length) {
      const s = this.scenes.pop();
      if (s && s.exit) s.exit(scene);
    }
    return this.push(scene);
  },

  /** Pop until `pred(scene)` is true (that scene stays on top). */
  popTo(pred) {
    while (this.scenes.length > 1 && !pred(this.top)) this.pop();
  },

  has(sceneClassOrName) {
    return this.scenes.some((s) => s === sceneClassOrName
      || s.constructor?.name === sceneClassOrName
      || s.id === sceneClassOrName);
  },

  // --- transitions --------------------------------------------------------

  /**
   * Run a screen transition. `fn` fires at the midpoint (fully obscured), which
   * is where you swap maps or push the battle scene.
   *   kind: 'fade' | 'wipe' | 'battle' | 'circle' | 'diamond'
   */
  transition(kind = 'fade', fn = null, { dur = 0.45, color = '#000' } = {}) {
    if (this._trans) { // already transitioning: run immediately
      if (fn) fn();
      return;
    }
    this._trans = { kind, fn, t: 0, dur, color, fired: false };
  },

  get transitioning() { return !!this._trans; },

  // --- loop ---------------------------------------------------------------

  _tick(now) {
    this._raf = requestAnimationFrame((t) => this._tick(t));
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > MAX_DT) dt = MAX_DT;  // a stall must not teleport the player
    if (dt < 0) dt = 0;
    this.dt = dt;
    this.time += dt;
    this.frame++;

    this._fpsAcc += dt; this._fpsFrames++;
    if (this._fpsAcc >= 0.5) { this.fps = Math.round(this._fpsFrames / this._fpsAcc); this._fpsAcc = 0; this._fpsFrames = 0; }

    this._update(dt);
    this._draw();
    Input.update(dt);
  },

  _update(dt) {
    // Transition advances even while scenes are frozen.
    if (this._trans) {
      const tr = this._trans;
      tr.t += dt;
      const half = tr.dur / 2;
      if (!tr.fired && tr.t >= half) { tr.fired = true; if (tr.fn) tr.fn(); }
      if (tr.t >= tr.dur) this._trans = null;
    }

    FX.update(dt);

    // Update the top scene, plus any scene beneath it that opted out of pausing.
    // Snapshot the stack first: a scene's update() may push or pop (a menu
    // opening, a dialogue closing), and indexing a live array mid-walk would
    // read past the end.
    const stack = this.scenes.slice();
    for (let i = stack.length - 1; i >= 0; i--) {
      const s = stack[i];
      const above = stack[i + 1];
      if (!s) continue;
      if (!above) { if (s.update) s.update(dt); }
      else if (s.update && above.pausesBelow === false) s.update(dt);
      // Stop descending once we hit a scene that pauses everything below it.
      if (above && above.pausesBelow !== false) break;
    }
  },

  /** Say a draw failed — once per site, not sixty times a second. */
  _reportDrawFail(key, err) {
    if (!this._drawFails) this._drawFails = new Set();
    if (this._drawFails.has(key)) return;
    this._drawFails.add(key);
    console.error(`[engine] ${key} threw while drawing; the frame recovered.`, err);
  },

  /**
   * Wind the canvas state stack back to nothing and drop UI's clip bookkeeping
   * with it. `restore()` past the bottom of the stack is a defined no-op, so
   * over-draining costs nothing and cannot corrupt a clean context.
   */
  _drainCtx() {
    const ctx = this.ctx;
    for (let i = 0; i < MAX_CTX_DEPTH; i++) ctx.restore();
    UI.resetClips();
  },

  /**
   * Paint one scene hook.
   *
   * A throw inside a draw method used to abort the rest of the frame with the
   * scene's ctx.save() and UI.pushClip() still standing. Every later frame then
   * nested inside the leaked clip — the game shrank into a 400x186 band that no
   * scene change, map change or direct drawUI call could clear, only a reload.
   *
   * So: the engine's own save is balanced by try/finally whatever the scene
   * does, and if the scene threw, everything it left standing is drained and the
   * two levels this frame is holding are rebuilt — so the scenes after this one,
   * the HUD and the toasts still paint on the very frame that failed.
   */
  _paint(scene, hook) {
    const ctx = this.ctx;
    ctx.save();
    try {
      scene[hook](ctx);
    } catch (e) {
      this._reportDrawFail(`${scene.id || scene.constructor?.name || 'scene'}.${hook}`, e);
      this._drainCtx();
      ctx.save();                       // stands in for _draw()'s baseline save
      ctx.imageSmoothingEnabled = false;
      ctx.save();                       // …and for this call's, popped below
    } finally {
      ctx.restore();
    }
  },

  _draw() {
    const ctx = this.ctx;

    // Only pay for the drain when something outside _paint left the context
    // dirty last frame. A clean frame does no extra work at all.
    if (this._ctxDirty) { this._drainCtx(); this._ctxDirty = false; }

    ctx.save();
    try {
      this._drawFrame(ctx);
    } catch (e) {
      this._reportDrawFail('frame', e);
      this._ctxDirty = true;
    } finally {
      ctx.restore();
    }
  },

  _drawFrame(ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Find the deepest scene we must draw: walk down while scenes are see-through.
    // Snapshot for the same reason update() does.
    const stack = this.scenes.slice();
    let start = stack.length - 1;
    while (start > 0 && stack[start] && stack[start].opaque === false) start--;

    // The atmosphere layer (rain, snow, day/night grading, vignette) belongs to the
    // world, so it is painted after the last world scene and BEFORE the first UI
    // scene. Without this the storm outside falls across the open inventory.
    // INVARIANT: a scene with opaque:false must also set uiLayer, or the world
    // beneath it will be graded after it draws rather than before. Every scene
    // that layers over the world today (dialogue) does both.
    let uiStart = stack.length;
    for (let i = start; i < stack.length; i++) {
      if (stack[i] && stack[i].uiLayer) { uiStart = i; break; }
    }

    for (let i = start; i < uiStart; i++) {
      const s = stack[i];
      if (s && s.draw) this._paint(s, 'draw');
    }
    // Nothing of the world is visible under a full-screen menu — do not paint a
    // storm onto the black behind it.
    if (uiStart > start) FX.drawAmbient(ctx);
    // A world scene's own interface (the overworld HUD, the battle ribbon) goes up
    // after the weather for the same reason the menus do.
    for (let i = start; i < uiStart; i++) {
      const s = stack[i];
      if (s && s.drawUI) this._paint(s, 'drawUI');
    }
    for (let i = uiStart; i < stack.length; i++) {
      const s = stack[i];
      if (s && s.draw) this._paint(s, 'draw');
    }

    // Overlays that draw even when covered (HUD toasts).
    const top = stack[stack.length - 1];
    for (const s of stack) {
      if (s && s.drawOver && s !== top) this._paint(s, 'drawOver');
    }

    FX.drawScreen(ctx);
    if (this._trans) this._drawTransition(ctx);
    if (this.debug) this._drawDebug(ctx);
  },

  _drawTransition(ctx) {
    const tr = this._trans;
    const p = clamp(tr.t / tr.dur, 0, 1);
    // 0 -> 1 -> 0 cover curve
    const cover = p < 0.5 ? p * 2 : (1 - p) * 2;
    ctx.save();
    if (tr.kind === 'fade') {
      ctx.globalAlpha = cover;
      ctx.fillStyle = tr.color;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    } else if (tr.kind === 'wipe') {
      ctx.fillStyle = tr.color;
      const w = Math.ceil(VIEW_W * cover);
      ctx.fillRect(p < 0.5 ? 0 : VIEW_W - w, 0, w, VIEW_H);
    } else if (tr.kind === 'circle') {
      ctx.fillStyle = tr.color;
      const r = (1 - cover) * Math.hypot(VIEW_W, VIEW_H) / 2;
      ctx.beginPath();
      ctx.rect(0, 0, VIEW_W, VIEW_H);
      ctx.arc(VIEW_W / 2, VIEW_H / 2, Math.max(0, r), 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    } else if (tr.kind === 'diamond') {
      // Classic JRPG diamond-grid dissolve.
      ctx.fillStyle = tr.color;
      const cell = 16, half = cell / 2;
      const size = cover * cell;
      for (let y = 0; y < VIEW_H + cell; y += cell) {
        for (let x = 0; x < VIEW_W + cell; x += cell) {
          const cx = x + half, cy = y + half;
          ctx.beginPath();
          ctx.moveTo(cx, cy - size); ctx.lineTo(cx + size, cy);
          ctx.lineTo(cx, cy + size); ctx.lineTo(cx - size, cy);
          ctx.fill();
        }
      }
    } else if (tr.kind === 'battle') {
      // Flash then horizontal shutters slamming shut.
      if (p < 0.18) {
        ctx.globalAlpha = 1 - p / 0.18;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = tr.color;
      const bars = 10, bh = VIEW_H / bars;
      for (let i = 0; i < bars; i++) {
        const w = Math.ceil(VIEW_W * clamp(cover * 1.35 - (i % 2) * 0.2, 0, 1));
        ctx.fillRect(i % 2 ? VIEW_W - w : 0, Math.floor(i * bh), w, Math.ceil(bh));
      }
    }
    ctx.restore();
  },

  _drawDebug(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 92, 26);
    ctx.fillStyle = '#7fff7f';
    ctx.font = '8px monospace';
    ctx.fillText(`fps ${this.fps}  s${this.scenes.length}`, 3, 10);
    ctx.fillText(`${this.top?.constructor?.name || this.top?.id || '-'}`.slice(0, 16), 3, 20);
    ctx.restore();
  },
};

/** A minimal scene that just runs a callback once, then pops. Useful for glue. */
export function actionScene(fn) {
  return { opaque: false, enter() { fn(); Game.pop(); } };
}
