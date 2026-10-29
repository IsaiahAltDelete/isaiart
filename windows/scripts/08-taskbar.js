/* ===========================================================================
   Taskbar, flyout manager and tooltips.
   =========================================================================== */

(function (Win) {
  'use strict';

  Win.Battery = { level: 78, charging: false };

  /* ---------------------------------------------------------------- flyouts */

  /**
   * One flyout open at a time. Modules register a flyout with
   * Win.Flyout.register(name, { render(el), onOpen?, onClose?, className }).
   */
  const flyouts = {};
  Win.Flyout = {
    current: null,
    register(name, def) { flyouts[name] = def; },
    isOpen: name => Win.Flyout.current === name,
    open(name, opts = {}) {
      if (Win.Flyout.current === name) return;
      Win.Flyout.close();
      const def = flyouts[name];
      if (!def) return;
      const el = Win.html(`<div class="flyout ${def.className || ''}" data-flyout="${name}" role="dialog" aria-label="${Win.esc(def.label || name)}"></div>`);
      Win.$('#flyouts').appendChild(el);
      Win.Flyout.current = name;
      Win.Flyout.el = el;
      def.render(el, opts);
      el.addEventListener('pointerdown', e => e.stopPropagation());
      requestAnimationFrame(() => el.classList.add('show'));
      def.onOpen?.(el, opts);
      renderTaskbarState();
    },
    close() {
      const name = Win.Flyout.current;
      if (!name) return;
      const el = Win.Flyout.el;
      flyouts[name]?.onClose?.(el);
      Win.Flyout.current = null;
      Win.Flyout.el = null;
      el.classList.remove('show');
      el.classList.add('hide');
      setTimeout(() => el.remove(), 160);
      renderTaskbarState();
    },
    toggle(name, opts) { Win.Flyout.isOpen(name) ? Win.Flyout.close() : Win.Flyout.open(name, opts); },
    /** Re-render the open flyout in place (state changed underneath it). */
    refresh(name) {
      if (Win.Flyout.current !== name || !Win.Flyout.el) return;
      flyouts[name].render(Win.Flyout.el, { refresh: true });
    },
  };

  document.addEventListener('pointerdown', e => {
    if (!Win.Flyout.current) return;
    if (e.target.closest('#taskbar [data-fly]')) return;   // the toggle button handles it
    if (e.target.closest('.ctx, .dlg-smoke')) return;
    Win.Flyout.close();
  });

  /* ---------------------------------------------------------------- tooltip */

  let tipTimer;
  let tipEl;
  const hideTip = () => { clearTimeout(tipTimer); tipEl?.remove(); tipEl = null; };
  document.addEventListener('pointerover', e => {
    const target = e.target.closest('[data-tip]');
    if (!target) return;
    hideTip();
    tipTimer = setTimeout(() => {
      if (!target.isConnected || Win.Flyout.current === target.dataset.fly) return;
      tipEl = Win.html(`<div class="tip t-${document.body.classList.contains('t-dark') ? 'dark' : 'light'}">${Win.esc(typeof target.dataset.tip === 'string' ? target.dataset.tip : '')}</div>`);
      tipEl.className = `tip ${document.body.classList.contains('t-dark') ? 't-dark' : 't-light'}`;
      document.body.appendChild(tipEl);
      const r = target.getBoundingClientRect();
      const inTaskbar = !!target.closest('#taskbar');
      const top = inTaskbar ? r.top - tipEl.offsetHeight - 10 : r.bottom + 8;
      tipEl.style.left = `${Win.clamp(r.left + r.width / 2 - tipEl.offsetWidth / 2, 4, innerWidth - tipEl.offsetWidth - 4)}px`;
      tipEl.style.top = `${Math.max(4, top)}px`;
    }, 650);
  });
  document.addEventListener('pointerout', e => { if (e.target.closest('[data-tip]')) hideTip(); });
  document.addEventListener('pointerdown', hideTip, true);

  /* ---------------------------------------------------------------- taskbar */

  const bar = () => Win.$('#taskbar');

  function weather() {
    return { temp: 68, text: 'Mostly sunny' };
  }

  function appButtons() {
    const pinned = Win.state.taskbar.pinned.filter(id => Win.apps.get(id));
    const running = [...new Set(Win.wm.windows.map(w => w.app.id))].filter(id => !pinned.includes(id));
    return [...pinned, ...running].map(id => {
      const app = Win.apps.get(id);
      const wins = Win.wm.byApp(id);
      const active = wins.includes(Win.wm.focused);
      const label = wins.length ? `${app.name} - ${wins.length} running window${wins.length > 1 ? 's' : ''}` : app.name;
      return `<button class="tb-app ${wins.length ? 'running' : ''} ${active ? 'active' : ''} ${wins.length > 1 ? 'multi' : ''}" data-app="${id}" aria-label="${Win.esc(label)}" data-tip="${Win.esc(wins.length === 1 ? wins[0].title : app.name)}">
        ${Win.appIcon(app.icon, 24)}<i class="tb-ind"></i></button>`;
    }).join('');
  }

  function trayIcons() {
    const s = Win.state.settings;
    const vol = s.muted || s.volume === 0 ? 'mute' : s.volume < 34 ? 'vol1' : s.volume < 67 ? 'vol2' : 'vol3';
    const level = Win.Battery.level;
    const battery = `<span class="tray-battery">${Win.glyph('battery', 18)}<i style="width:${Math.round(level / 100 * 11)}px"></i>${Win.Battery.charging ? Win.glyph('charging', 18, 'chg') : ''}</span>`;
    const net = Win.Network.summary();
    return `<button class="tb-tray-btn" data-fly="quick" aria-label="Quick settings" data-tip="${Win.esc(`${net}\n${s.muted ? 'Muted' : `Speakers: ${s.volume}%`}\nBattery: ${level}% remaining`)}">
      ${Win.glyph(Win.Network.glyph(), 16)}${Win.glyph(vol, 16)}${battery}</button>`;
  }

  function clock() {
    const s = Win.state.settings;
    const now = new Date(Date.now() + (s.clockOffset || 0));
    const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: s.showSeconds ? '2-digit' : undefined, hour12: !s.time24 });
    const count = Win.state.notifications.length;
    return `<button class="tb-clock" data-fly="notify" aria-label="Clock ${Win.esc(time)}, notifications ${count}" data-tip="${Win.esc(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}\n${Win.esc(time)}">
      <span class="tb-time"><b>${Win.esc(time)}</b><span>${Win.esc(Win.formatDate(now))}</span></span>
      ${s.dnd ? `<span class="tb-bell">${Win.glyph('belloff', 16)}</span>` : count ? `<span class="tb-badge">${count > 9 ? '9+' : count}</span>` : ''}
    </button>`;
  }

  function render() {
    const s = Win.state.settings;
    const w = weather();
    const el = bar();
    el.className = Win.cls(s.taskbarAlign === 'left' && 'left', s.autoHide && 'autohide');
    el.innerHTML = `
      ${s.showWidgets ? `<button class="tb-widgets" data-fly="widgets" aria-label="Widgets, ${w.temp}°F ${w.text}" data-tip="Widgets">${Win.appIcon('weather', 24)}<span><b>${w.temp}°F</b><span>${w.text}</span></span></button>` : ''}
      <div class="tb-center">
        <button class="tb-app tb-start" data-fly="start" aria-label="Start" data-tip="Start">${Win.appIcon('windows', 24)}</button>
        ${s.taskbarSearch === 'box' ? `<button class="tb-search" data-fly="search" aria-label="Search">${Win.glyph('search', 16)}<span>Search</span></button>` : ''}
        ${s.taskbarSearch === 'icon' ? `<button class="tb-app" data-fly="search" aria-label="Search" data-tip="Search">${Win.glyph('search', 20)}</button>` : ''}
        ${s.showTaskView ? `<button class="tb-app tb-taskview" data-fly="taskview" aria-label="Task View" data-tip="Task View">${Win.glyph('taskview', 22)}</button>` : ''}
        <div class="tb-apps">${appButtons()}</div>
      </div>
      <div class="tb-right">
        <button class="tb-icon" data-fly="tray" aria-label="Show hidden icons" data-tip="Show hidden icons">${Win.glyph('chevup', 14)}</button>
        <button class="tb-lang" aria-label="Input language English (United States) US keyboard" data-tip="English (United States)\nUS keyboard"><span>ENG</span><span>US</span></button>
        ${trayIcons()}
        <span class="tb-clock-wrap">${clock()}</span>
        <button class="tb-peek" aria-label="Show desktop" data-tip="Show desktop"></button>
      </div>`;
    renderTaskbarState();
  }

  function renderTaskbarState() {
    Win.$$('#taskbar [data-fly]').forEach(b => b.classList.toggle('open', b.dataset.fly === Win.Flyout.current));
  }

  /* Only the app list and clock change often; avoid rebuilding everything. */
  function renderApps() {
    const apps = Win.$('#taskbar .tb-apps');
    if (apps) apps.innerHTML = appButtons(); else render();
  }

  /* Rebuilding the button every second would swallow clicks that straddle a
     tick, so only replace it when its markup actually changes. */
  let lastClock = '';
  function tickClock() {
    const wrap = Win.$('#taskbar .tb-clock-wrap');
    if (!wrap) return;
    const next = clock();
    if (next === lastClock && wrap.firstElementChild) return;
    lastClock = next;
    wrap.innerHTML = next;
    renderTaskbarState();
  }

  /* --------------------------------------------------------------- previews */

  let previewEl = null;
  let previewTimer = null;
  const closePreview = () => { clearTimeout(previewTimer); previewEl?.remove(); previewEl = null; };

  function showPreview(button) {
    const wins = Win.wm.byApp(button.dataset.app);
    if (!wins.length || Win.Flyout.current) return;
    closePreview();
    const app = Win.apps.get(button.dataset.app);
    previewEl = Win.html(`<div class="tb-preview ${document.body.classList.contains('t-dark') ? 't-dark' : 't-light'}" role="list">
      ${wins.map(w => `<div class="tbp-item ${w === Win.wm.focused ? 'active' : ''}" data-win="${w.id}" role="listitem">
        <div class="tbp-head">${Win.appIcon(app.icon, 16)}<span>${Win.esc(w.title)}</span><button class="tbp-x" data-close="${w.id}" aria-label="Close ${Win.esc(w.title)}">${Win.glyph('close', 12)}</button></div>
        <div class="tbp-thumb">${thumb(w)}</div></div>`).join('')}</div>`);
    document.body.appendChild(previewEl);
    const r = button.getBoundingClientRect();
    previewEl.style.left = `${Win.clamp(r.left + r.width / 2 - previewEl.offsetWidth / 2, 6, innerWidth - previewEl.offsetWidth - 6)}px`;
    previewEl.style.bottom = `${innerHeight - r.top + 8}px`;
    previewEl.addEventListener('pointerenter', () => clearTimeout(previewTimer));
    previewEl.addEventListener('pointerleave', () => { previewTimer = setTimeout(closePreview, 250); });
    previewEl.addEventListener('click', e => {
      const close = e.target.closest('[data-close]');
      const win = Win.wm.windows.find(w => w.id === (close?.dataset.close || e.target.closest('[data-win]')?.dataset.win));
      if (!win) return;
      if (close) { Win.wm.close(win); setTimeout(() => (Win.wm.byApp(app.id).length ? showPreview(button) : closePreview()), 180); return; }
      Win.wm.focus(win);
      closePreview();
    });
  }

  /* A scaled-down, inert copy of the window gives a convincing thumbnail. */
  function thumb(win) {
    const r = win.el.getBoundingClientRect();
    const scale = Math.min(200 / Math.max(r.width, 1), 112 / Math.max(r.height, 1));
    return `<div class="tbp-scale" style="width:${r.width}px;height:${r.height}px;transform:scale(${scale})" data-clone="${win.id}"></div>`;
  }

  function fillThumbs() {
    if (!previewEl) return;
    Win.$$('[data-clone]', previewEl).forEach(slot => {
      const win = Win.wm.windows.find(w => w.id === slot.dataset.clone);
      if (!win) return;
      const copy = win.el.cloneNode(true);
      copy.classList.remove('minimized', 'opening');
      copy.removeAttribute('id');
      Object.assign(copy.style, { left: 0, top: 0, position: 'relative', visibility: 'visible', opacity: 1, transform: 'none', zIndex: 0 });
      copy.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
      copy.inert = true;
      slot.parentElement.style.height = `${parseFloat(slot.style.height) * parseFloat(slot.style.transform.match(/[\d.]+/)[0])}px`;
      slot.appendChild(copy);
    });
  }

  /* ----------------------------------------------------------------- events */

  function wire() {
    const el = bar();
    el.addEventListener('click', e => {
      const fly = e.target.closest('[data-fly]');
      if (fly) { closePreview(); Win.Flyout.toggle(fly.dataset.fly); return; }
      const app = e.target.closest('.tb-app[data-app]');
      if (app) { Win.Flyout.close(); closePreview(); Win.wm.activateApp(app.dataset.app); return; }
      if (e.target.closest('.tb-peek')) { Win.Flyout.close(); Win.wm.showDesktop(); return; }
      if (e.target.closest('.tb-lang')) {
        const r = e.target.closest('.tb-lang').getBoundingClientRect();
        Win.menu(r.left - 120, r.top - 120, [
          { label: 'ENG  English (United States)', checked: true, radio: true },
          { label: 'US keyboard', disabled: true },
          { divider: true },
          { label: 'More keyboard settings', glyph: 'keyboard', action: () => Win.wm.open('settings', { page: 'language' }) },
        ]);
      }
    });
    el.addEventListener('pointerover', e => {
      const app = e.target.closest('.tb-app[data-app]');
      if (!app) return;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => { showPreview(app); fillThumbs(); }, previewEl ? 0 : 500);
    });
    el.addEventListener('pointerout', e => {
      if (e.target.closest('.tb-app[data-app]')) { clearTimeout(previewTimer); previewTimer = setTimeout(closePreview, 300); }
    });
    el.addEventListener('pointerdown', () => { closePreview(); }, true);
    el.addEventListener('auxclick', e => {
      const app = e.target.closest('.tb-app[data-app]');
      if (app && e.button === 1) { e.preventDefault(); Win.wm.open(app.dataset.app); }
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      closePreview();
      const app = e.target.closest('.tb-app[data-app]');
      if (app) { jumpList(app, e); return; }
      if (e.target.closest('.tb-start')) { Win.Start?.winX(e.clientX, e.clientY); return; }
      Win.menu(e.clientX, e.clientY - 80, [
        { label: 'Task Manager', glyph: 'taskmgr', action: () => Win.wm.open('taskmgr') },
        { divider: true },
        { label: 'Taskbar settings', glyph: 'gear', action: () => Win.wm.open('settings', { page: 'taskbar' }) },
      ]);
    });
    /* Auto-hide reveal zone. */
    document.addEventListener('pointermove', e => {
      if (!Win.state.settings.autoHide) return;
      const near = e.clientY > innerHeight - 4 || bar().matches(':hover') || !!Win.Flyout.current;
      bar().classList.toggle('reveal', near);
    });
  }

  function jumpList(button, e) {
    const id = button.dataset.app;
    const app = Win.apps.get(id);
    const wins = Win.wm.byApp(id);
    const pinned = Win.state.taskbar.pinned.includes(id);
    const recent = ['notepad', 'explorer', 'photos'].includes(id)
      ? Win.state.recent.map(Win.FS.get).filter(Boolean).filter(n => (id === 'notepad' ? n.content != null : id === 'photos' ? !!n.art || !!n.data : true)).slice(0, 5)
      : [];
    const items = [];
    if (recent.length) {
      items.push({ label: 'Recent', disabled: true });
      recent.forEach(n => items.push({ label: n.name, icon: Win.fileIcon(n, 16), action: () => Win.openFile?.(n.id) }));
      items.push({ divider: true });
    }
    items.push(
      { label: app.name, icon: Win.appIcon(app.icon, 16), action: () => Win.wm.open(id) },
      { label: pinned ? 'Unpin from taskbar' : 'Pin to taskbar', glyph: pinned ? 'unpin' : 'pin', action: () => Win.Taskbar.pin(id, !pinned) },
    );
    if (wins.length) items.push({ label: wins.length > 1 ? 'Close all windows' : 'Close window', glyph: 'close', action: () => wins.forEach(w => Win.wm.close(w)) });
    const menu = Win.menu(e.clientX, 0, items, { className: 'jump' });
    const r = button.getBoundingClientRect();
    menu.style.top = `${r.top - menu.offsetHeight - 8}px`;
    menu.style.left = `${Win.clamp(r.left + r.width / 2 - menu.offsetWidth / 2, 6, innerWidth - menu.offsetWidth - 6)}px`;
  }

  Win.Taskbar = {
    render,
    pin(id, on) {
      const list = Win.state.taskbar.pinned.filter(p => p !== id);
      if (on) list.push(id);
      Win.state.taskbar.pinned = list;
      Win.save();
    },
    init() {
      render();
      wire();
      Win.on('windows', renderApps);
      Win.on('state', render);
      Win.on('theme', render);
      setInterval(tickClock, 1000);
    },
  };
})(window.Win);
