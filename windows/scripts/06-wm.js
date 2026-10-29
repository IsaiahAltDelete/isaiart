/* ===========================================================================
   App registry and window manager.

   Apps register a definition; the window manager owns frames, focus order,
   minimise/maximise, Snap (edge drag, Snap Layouts, Win+Arrow) and resizing.
   Each app renders into `win.body` and manages its own DOM from there.

   Win.apps.register({
     id, name, icon,                 // icon: key from Win.appIcons
     width, height, minWidth, minHeight,
     single,                         // one window only; open() focuses it
     hidden,                         // not listed in Start > All
     category, keywords,
     customTitle,                    // app draws into win.titleContent (tabs)
     create(win, args),              // build UI into win.body
     reopen(win, args),              // single apps: handle a new open() call
     beforeClose(win),               // return false (or a Promise of false) to cancel
     fixed,                          // dialog-style frame: close button only, no resize
     launch(args),                   // open something else instead of a window
   })
   =========================================================================== */

(function (Win) {
  'use strict';

  const registry = new Map();

  Win.apps = {
    register(def) { registry.set(def.id, { width: 900, height: 600, minWidth: 360, minHeight: 240, category: 'Other', ...def }); },
    get: id => registry.get(id) || null,
    all: () => [...registry.values()],
    listed: () => [...registry.values()].filter(a => !a.hidden).sort((a, b) => a.name.localeCompare(b.name)),
  };

  const TASKBAR = 48;
  const area = () => ({ x: 0, y: 0, w: innerWidth, h: innerHeight - (Win.state.settings.autoHide ? 2 : TASKBAR) });

  let zTop = 10;
  let cascade = 0;

  const wm = Win.wm = {
    windows: [],
    focused: null,

    byApp: appId => wm.windows.filter(w => w.app.id === appId),

    open(appId, args = {}) {
      const app = Win.apps.get(appId);
      if (!app) { Win.toast({ app: 'Windows', glyph: 'warning', title: 'App not found', body: `Windows can't find '${appId}'.`, transient: true }); return null; }
      if (app.launch) { app.launch(args); return null; }
      if (app.single) {
        const existing = wm.byApp(appId)[0];
        if (existing) {
          app.reopen?.(existing, args);
          wm.restore(existing);
          wm.focus(existing);
          return existing;
        }
      }
      const win = createWindow(app, args);
      wm.windows.push(win);
      try { app.create(win, args); } catch (error) { console.error(error); }
      if (args.maximized) wm.maximize(win);
      wm.focus(win);
      win.el.classList.add('opening');
      setTimeout(() => win.el.classList.remove('opening'), 220);
      Win.emit('windows');
      return win;
    },

    async close(win, { force = false } = {}) {
      if (!win || win.closed) return;
      if (!force && win.app.beforeClose) {
        const ok = await win.app.beforeClose(win);
        if (ok === false) return;
      }
      win.closed = true;
      win.cleanups.forEach(fn => { try { fn(); } catch { /* ignore */ } });
      win.el.classList.add('closing');
      setTimeout(() => win.el.remove(), 150);
      wm.windows = wm.windows.filter(w => w !== win);
      if (wm.focused === win) {
        wm.focused = null;
        const next = wm.topmost();
        if (next) wm.focus(next);
      }
      Win.emit('windows');
    },

    topmost: () => wm.windows.filter(w => !w.minimized).sort((a, b) => b.z - a.z)[0] || null,

    focus(win, { fromPointer = false } = {}) {
      if (!win || win.closed) return;
      if (win.minimized) wm.restore(win);
      win.z = ++zTop;
      win.el.style.zIndex = win.z;
      wm.windows.forEach(w => w.el.classList.toggle('active', w === win));
      const changed = wm.focused !== win;
      wm.focused = win;
      if (changed) Win.emit('windows');
      /* A click places focus itself; moving it here would steal it. */
      if (!fromPointer && !win.el.contains(document.activeElement)) {
        const target = win.body.querySelector('[autofocus]') || win.el;
        requestAnimationFrame(() => target.focus({ preventScroll: true }));
      }
    },

    blurAll() {
      wm.focused = null;
      wm.windows.forEach(w => w.el.classList.remove('active'));
      Win.emit('windows');
    },

    minimize(win) {
      if (!win) return;
      win.minimized = true;
      win.el.classList.add('minimized');
      if (wm.focused === win) {
        wm.focused = null;
        wm.windows.forEach(w => w.el.classList.remove('active'));
        const next = wm.topmost();
        if (next) wm.focus(next);
      }
      Win.emit('windows');
    },

    restore(win) {
      if (!win?.minimized) return;
      win.minimized = false;
      win.el.classList.remove('minimized');
      Win.emit('windows');
    },

    toggleMaximize: win => (win.mode === 'max' ? wm.unsnap(win) : wm.maximize(win)),

    maximize(win) {
      if (!win.mode) win.saved = { ...win.rect };
      win.mode = 'max';
      apply(win, area());
      syncMaxButton(win);
    },

    /** Snap to a zone: left, right, tl, tr, bl, br, or thirds l3/c3/r3. */
    snap(win, zone) {
      if (!Win.state.settings.snap && zone !== 'max') return;
      if (zone === 'max') { wm.maximize(win); return; }
      const a = area();
      const halfW = Math.round(a.w / 2);
      const halfH = Math.round(a.h / 2);
      const third = Math.round(a.w / 3);
      const zones = {
        left: { x: 0, y: 0, w: halfW, h: a.h },
        right: { x: halfW, y: 0, w: a.w - halfW, h: a.h },
        tl: { x: 0, y: 0, w: halfW, h: halfH },
        tr: { x: halfW, y: 0, w: a.w - halfW, h: halfH },
        bl: { x: 0, y: halfH, w: halfW, h: a.h - halfH },
        br: { x: halfW, y: halfH, w: a.w - halfW, h: a.h - halfH },
        l3: { x: 0, y: 0, w: third, h: a.h },
        c3: { x: third, y: 0, w: third, h: a.h },
        r3: { x: third * 2, y: 0, w: a.w - third * 2, h: a.h },
        l23: { x: 0, y: 0, w: third * 2, h: a.h },
      };
      if (!zones[zone]) return;
      if (!win.mode) win.saved = { ...win.rect };
      win.mode = zone;
      apply(win, zones[zone]);
      syncMaxButton(win);
    },

    unsnap(win) {
      if (!win.mode) return;
      win.mode = null;
      apply(win, win.saved || win.rect);
      syncMaxButton(win);
    },

    /** Re-fit maximised and snapped windows after a viewport or taskbar change. */
    relayout() {
      wm.windows.forEach(win => {
        if (win.mode === 'max') apply(win, area());
        else if (win.mode) wm.snap(win, win.mode);
        else {
          const a = area();
          win.rect.x = Win.clamp(win.rect.x, -win.rect.w + 120, a.w - 120);
          win.rect.y = Win.clamp(win.rect.y, 0, a.h - 40);
          apply(win, win.rect);
        }
      });
    },

    showDesktop() {
      const visible = wm.windows.filter(w => !w.minimized);
      if (visible.length) {
        wm.peekRestore = visible;
        visible.forEach(w => wm.minimize(w));
      } else if (wm.peekRestore) {
        wm.peekRestore.forEach(w => !w.closed && wm.restore(w));
        const top = wm.peekRestore.filter(w => !w.closed).sort((a, b) => b.z - a.z)[0];
        wm.peekRestore = null;
        if (top) wm.focus(top);
      }
    },

    /** Taskbar click: open, focus, or minimise depending on state. */
    activateApp(appId) {
      const wins = wm.byApp(appId);
      if (!wins.length) return wm.open(appId);
      if (wins.length === 1) {
        const w = wins[0];
        if (wm.focused === w && !w.minimized) wm.minimize(w); else wm.focus(w);
        return w;
      }
      const ordered = wins.slice().sort((a, b) => b.z - a.z);
      const next = wm.focused && wins.includes(wm.focused) ? ordered[ordered.length - 1] : ordered[0];
      wm.focus(next);
      return next;
    },
  };

  /* ---------------------------------------------------------------- frames */

  function createWindow(app, args) {
    const a = area();
    const w = Math.min(args.width || app.width, a.w - 40);
    const h = Math.min(args.height || app.height, a.h - 40);
    const step = (cascade++ % 8) * 28;
    const rect = {
      x: Math.round(args.x ?? Math.max(10, (a.w - w) / 2 - 90 + step)),
      y: Math.round(args.y ?? Math.max(10, (a.h - h) / 2 - 70 + step)),
      w, h,
    };
    const el = Win.html(`<section class="win ${app.fixed ? 'fixed' : ''}" tabindex="-1" role="dialog" aria-label="${Win.esc(app.name)}" data-app="${app.id}">
      <header class="win-titlebar ${app.customTitle ? 'custom' : ''}">
        <div class="win-title-content">
          ${app.customTitle ? '' : `<span class="win-ico">${Win.appIcon(app.icon, 16)}</span><span class="win-title">${Win.esc(app.name)}</span>`}
        </div>
        <div class="win-controls" data-nodrag>
          <button class="wc-min" aria-label="Minimize" title="Minimize">${Win.glyph('minimize', 16)}</button>
          <button class="wc-max" aria-label="Maximize" title="Maximize">${Win.glyph('maximize', 14)}</button>
          <button class="wc-close" aria-label="Close" title="Close">${Win.glyph('close', 16)}</button>
        </div>
      </header>
      <div class="win-body"></div>
      ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(d => `<i class="rz rz-${d}" data-dir="${d}"></i>`).join('')}
    </section>`);
    Win.$('#windows').appendChild(el);

    const win = {
      id: Win.uid('w'),
      app, args, el, rect, z: ++zTop,
      body: el.querySelector('.win-body'),
      titlebar: el.querySelector('.win-titlebar'),
      titleContent: el.querySelector('.win-title-content'),
      state: {},
      title: app.name,
      cleanups: [],
      mode: null,
      minimized: false,
      setTitle(text) {
        win.title = text;
        const t = el.querySelector('.win-title');
        if (t) t.textContent = text;
        el.setAttribute('aria-label', text);
        Win.emit('windows');
      },
      close: opts => wm.close(win, opts),
      focus: () => wm.focus(win),
      minimize: () => wm.minimize(win),
      /** Subscribe to a Win event for this window's lifetime. */
      listen(topic, fn) { win.cleanups.push(Win.on(topic, fn)); },
      cleanup(fn) { win.cleanups.push(fn); },
    };
    el.style.zIndex = win.z;
    apply(win, rect);

    el.addEventListener('pointerdown', () => wm.focus(win, { fromPointer: true }), true);
    el.querySelector('.wc-min').addEventListener('click', e => { e.stopPropagation(); wm.minimize(win); });
    el.querySelector('.wc-max').addEventListener('click', e => { e.stopPropagation(); wm.toggleMaximize(win); });
    el.querySelector('.wc-close').addEventListener('click', e => { e.stopPropagation(); wm.close(win); });
    wireSnapFlyout(win);
    wireDrag(win);
    wireResize(win);
    win.titlebar.addEventListener('dblclick', e => {
      if (e.target.closest('[data-nodrag], button, input') || app.fixed) return;
      wm.toggleMaximize(win);
    });
    win.titlebar.addEventListener('contextmenu', e => {
      if (e.target.closest('[data-nodrag], input')) return;
      e.preventDefault();
      Win.menu(e.clientX, e.clientY, [
        { label: 'Restore', glyph: 'restore', disabled: !win.mode, action: () => wm.unsnap(win) },
        { label: 'Minimize', glyph: 'minimize', action: () => wm.minimize(win) },
        { label: 'Maximize', glyph: 'maximize', disabled: win.mode === 'max', action: () => wm.maximize(win) },
        { divider: true },
        { label: 'Close', glyph: 'close', shortcut: 'Alt+F4', action: () => wm.close(win) },
      ]);
    });
    return win;
  }

  function apply(win, r) {
    if (!win.mode) win.rect = { x: r.x, y: r.y, w: r.w, h: r.h };
    Object.assign(win.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    win.el.classList.toggle('maximized', win.mode === 'max');
    win.el.classList.toggle('snapped', !!win.mode && win.mode !== 'max');
    win.el.dispatchEvent(new CustomEvent('win-resize'));
  }

  function syncMaxButton(win) {
    const b = win.el.querySelector('.wc-max');
    const max = win.mode === 'max';
    b.innerHTML = Win.glyph(max ? 'restore' : 'maximize', 14);
    b.setAttribute('aria-label', max ? 'Restore' : 'Maximize');
    b.title = max ? 'Restore Down' : 'Maximize';
  }

  /* -------------------------------------------------------------- dragging */

  const preview = () => Win.$('#snap-preview');

  function zoneAt(x, y) {
    const a = area();
    const edge = 6;
    if (y <= edge) return 'max';
    if (x <= edge) return y < a.h * 0.25 ? 'tl' : y > a.h * 0.75 ? 'bl' : 'left';
    if (x >= a.w - edge) return y < a.h * 0.25 ? 'tr' : y > a.h * 0.75 ? 'br' : 'right';
    return null;
  }

  function showPreview(zone) {
    const p = preview();
    if (!zone || !Win.state.settings.snap) { p.classList.remove('show'); return; }
    const a = area();
    const hw = a.w / 2;
    const hh = a.h / 2;
    const map = {
      max: [0, 0, a.w, a.h], left: [0, 0, hw, a.h], right: [hw, 0, hw, a.h],
      tl: [0, 0, hw, hh], tr: [hw, 0, hw, hh], bl: [0, hh, hw, hh], br: [hw, hh, hw, hh],
    };
    const [x, y, w, h] = map[zone];
    Object.assign(p.style, { left: `${x + 6}px`, top: `${y + 6}px`, width: `${w - 12}px`, height: `${h - 12}px` });
    p.classList.add('show');
  }

  function wireDrag(win) {
    win.titlebar.addEventListener('pointerdown', start => {
      if (start.button !== 0 || start.target.closest('[data-nodrag], button, input, select, a, [contenteditable]')) return;
      const el = win.el;
      let origin = { ...win.rect };
      let moved = false;
      let zone = null;
      const sx = start.clientX;
      const sy = start.clientY;
      win.titlebar.setPointerCapture(start.pointerId);
      const move = e => {
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        if (!moved) {
          moved = true;
          document.body.classList.add('dragging');
          if (win.mode) {
            /* Pull the restored frame out under the pointer at the same ratio. */
            const ratio = (sx - parseFloat(el.style.left)) / parseFloat(el.style.width);
            const restored = win.saved || win.rect;
            win.mode = null;
            origin = { x: sx - restored.w * ratio, y: 0, w: restored.w, h: restored.h };
            apply(win, origin);
            syncMaxButton(win);
          }
        }
        const a = area();
        apply(win, { x: origin.x + dx, y: Win.clamp(origin.y + dy, 0, a.h - 32), w: origin.w, h: origin.h });
        zone = win.app.fixed ? null : zoneAt(e.clientX, e.clientY);
        showPreview(zone);
      };
      const up = () => {
        win.titlebar.removeEventListener('pointermove', move);
        win.titlebar.removeEventListener('pointerup', up);
        win.titlebar.removeEventListener('pointercancel', up);
        document.body.classList.remove('dragging');
        preview().classList.remove('show');
        if (moved && zone && Win.state.settings.snap && !win.app.fixed) {
          win.saved = { ...win.rect, x: origin.x, y: origin.y };
          wm.snap(win, zone);
        }
      };
      win.titlebar.addEventListener('pointermove', move);
      win.titlebar.addEventListener('pointerup', up);
      win.titlebar.addEventListener('pointercancel', up);
    });
  }

  function wireResize(win) {
    win.el.querySelectorAll('.rz').forEach(handle => {
      handle.addEventListener('pointerdown', start => {
        if (win.mode === 'max') return;
        start.preventDefault();
        start.stopPropagation();
        wm.focus(win);
        const dir = handle.dataset.dir;
        if (win.mode) { win.mode = null; syncMaxButton(win); }
        const origin = { ...win.rect, ...{ x: parseFloat(win.el.style.left), y: parseFloat(win.el.style.top), w: parseFloat(win.el.style.width), h: parseFloat(win.el.style.height) } };
        const { minWidth, minHeight } = win.app;
        handle.setPointerCapture(start.pointerId);
        document.body.classList.add('dragging');
        const move = e => {
          const dx = e.clientX - start.clientX;
          const dy = e.clientY - start.clientY;
          const r = { ...origin };
          if (dir.includes('e')) r.w = Math.max(minWidth, origin.w + dx);
          if (dir.includes('s')) r.h = Math.max(minHeight, origin.h + dy);
          if (dir.includes('w')) { r.w = Math.max(minWidth, origin.w - dx); r.x = origin.x + origin.w - r.w; }
          if (dir.includes('n')) { r.h = Math.max(minHeight, origin.h - dy); r.y = Math.max(0, origin.y + origin.h - r.h); }
          apply(win, r);
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          document.body.classList.remove('dragging');
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
      });
    });
  }

  /* ---------------------------------------------------------- Snap layouts */

  function wireSnapFlyout(win) {
    const button = win.el.querySelector('.wc-max');
    let timer;
    let fly = null;
    const hide = () => { clearTimeout(timer); timer = setTimeout(() => { fly?.remove(); fly = null; }, 260); };
    button.addEventListener('pointerenter', () => {
      clearTimeout(timer);
      if (!Win.state.settings.snap || fly) return;
      timer = setTimeout(() => {
        fly = Win.html(`<div class="snap-fly" role="menu" aria-label="Snap layouts">
          ${[
            [['left', 'w50'], ['right', 'w50']],
            [['l23', 'w66'], ['r3', 'w33']],
            [['l3', 'w33'], ['c3', 'w33'], ['r3', 'w33']],
            [['left', 'w50'], [['tr', 'br'], 'w50 col']],
            [['tl', 'br'], 'quad'],
          ].map(layout => `<div class="snap-layout">${renderLayout(layout)}</div>`).join('')}
        </div>`);
        fly.addEventListener('pointerenter', () => clearTimeout(timer));
        fly.addEventListener('pointerleave', hide);
        fly.addEventListener('pointerdown', e => e.stopPropagation());
        fly.addEventListener('click', e => {
          const zone = e.target.closest('[data-zone]')?.dataset.zone;
          if (zone) { wm.snap(win, zone); fly.remove(); fly = null; }
        });
        Win.$('#overlay-layer').appendChild(fly);
        const r = button.getBoundingClientRect();
        fly.style.left = `${Math.min(innerWidth - fly.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - fly.offsetWidth / 2))}px`;
        fly.style.top = `${r.bottom + 4}px`;
      }, 420);
    });
    button.addEventListener('pointerleave', hide);
    button.addEventListener('click', () => { fly?.remove(); fly = null; });
  }

  function renderLayout(layout) {
    if (layout[1] === 'quad') return ['tl', 'tr', 'bl', 'br'].map(z => `<button class="cell q" data-zone="${z}" aria-label="Snap ${z}"></button>`).join('');
    return layout.map(([zone, size]) => Array.isArray(zone)
      ? `<div class="cell-col ${size}">${zone.map(z => `<button class="cell" data-zone="${z}" aria-label="Snap ${z}"></button>`).join('')}</div>`
      : `<button class="cell ${size}" data-zone="${zone}" aria-label="Snap ${zone}"></button>`).join('');
  }

  addEventListener('resize', Win.debounce(() => wm.relayout(), 80));
})(window.Win);
