/* ===========================================================================
   Application registry and window manager.

   Every app is registered with a render function that receives its own window
   object, so two Finder windows can browse different folders and two Safari
   windows keep separate tab sets. The manager handles focus, minimise, zoom,
   full screen, edge-snap tiling, spaces and Mission Control.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, clamp } = Mac;

  /* --------------------------------------------------------------- registry */

  Mac.apps = {};
  /** Registration order drives Launchpad and the Applications folder. */
  Mac.appOrder = [];

  Mac.registerApp = definition => {
    Mac.apps[definition.id] = Object.assign({
      icon: definition.id,
      category: 'Utilities',
      size: [820, 560],
      min: [320, 220],
      singleton: false,
      /* The shipped constant, not Mac.OS.version(): registerApp runs while
         the app scripts load, before 31-power.js defines Mac.OS — and an
         app's bundled version would not change with the OS anyway. */
      version: Mac.OS_VERSION,
      hidden: false,
    }, definition);
    Mac.appOrder.push(definition.id);
    return Mac.apps[definition.id];
  };

  Mac.appList = () => {
    const rank = id => {
      const index = Mac.LAUNCH_ORDER.indexOf(id);
      return index === -1 ? Mac.LAUNCH_ORDER.length + Mac.appOrder.indexOf(id) : index;
    };
    return Mac.appOrder
      .map(id => Mac.apps[id])
      .filter(app => app && !app.hidden && Mac.state.installedApps.includes(app.id))
      .sort((a, b) => rank(a.id) - rank(b.id));
  };

  /* -------------------------------------------------------- window manager */

  const WM = Mac.wm = {
    windows: new Map(),
    /** Stacking order, oldest first. Used by Cmd-` and Mission Control. */
    order: [],

    active() { return this.windows.get(Mac.session.activeWindow) || null; },

    activeApp() { return this.active()?.appId || null; },

    /** All windows belonging to an app id. */
    forApp(appId) { return [...this.windows.values()].filter(win => win.appId === appId); },

    onSpace(space = Mac.session.space) {
      return [...this.windows.values()].filter(win => win.space === space);
    },

    /**
     * Open (or focus) an app window.
     * @param {string} appId
     * @param {object} options  {state, newWindow, focus}
     */
    open(appId, options = {}) {
      const app = Mac.apps[appId];
      if (!app) return null;
      if (app.launch) return app.launch(options);

      if (!Mac.state.installedApps.includes(appId)) {
        Mac.Notify.show('Not installed', `${app.title} is not installed on this Mac.`, { app: 'appstore' });
        return null;
      }

      const existing = this.forApp(appId);
      if (existing.length && (app.singleton || !options.newWindow)) {
        const win = existing.find(candidate => candidate.space === Mac.session.space) || existing[0];
        if (options.state) Object.assign(win.state, options.state);
        if (win.space !== Mac.session.space) this.gotoSpace(win.space);
        if (win.minimized) this.unminimize(win.id);
        this.render(win);
        this.focus(win.id);
        return win;
      }

      const win = this.create(app, options);
      if (Mac.state.settings.animateOpening) this.bounceDock(appId);
      return win;
    },

    create(app, options = {}) {
      const id = Mac.uid('win');
      const [width, height] = app.size;
      const count = this.windows.size;
      const layer = Mac.$('#window-layer');

      const maxWidth = Math.max(320, innerWidth - 24);
      const maxHeight = Math.max(240, innerHeight - 96);
      const w = Math.min(width, maxWidth);
      const h = Math.min(height, maxHeight);
      const left = clamp(70 + (count % 6) * 26, 8, Math.max(8, innerWidth - w - 8));
      const top = clamp(44 + (count % 6) * 22, Number(getComputedStyle(document.documentElement).getPropertyValue('--menu-h').replace('px', '')) || 25, Math.max(30, innerHeight - h - 70));

      const win = {
        id,
        appId: app.id,
        state: Object.assign({}, app.initialState ? app.initialState() : {}, options.state || {}),
        space: Mac.session.space,
        minimized: false,
        zoomed: false,
        fullscreen: false,
        tile: null,
        frame: { left, top, width: w, height: h },
        el: document.createElement('section'),
      };

      win.el.className = 'window';
      win.el.id = id;
      win.el.dataset.app = app.id;
      win.el.dataset.win = id;
      win.el.setAttribute('role', 'dialog');
      win.el.setAttribute('aria-label', app.title);
      win.el.style.cssText = `left:${left}px;top:${top}px;width:${w}px;height:${h}px;z-index:${++Mac.session.zIndex}`;
      win.el.innerHTML =
        `<header class="titlebar ${app.compactTitlebar ? 'compact' : ''}">
          <div class="traffic">
            <button class="tl-close" data-win-action="close" aria-label="Close"></button>
            <button class="tl-min" data-win-action="minimize" aria-label="Minimize"></button>
            <button class="tl-zoom" data-win-action="zoom" aria-label="Zoom"></button>
          </div>
          <div class="titlebar-lead"></div>
          <div class="titlebar-title"></div>
          <div class="titlebar-tools"></div>
        </header>
        <div class="window-body ${app.scrolls ? 'scrolls' : ''}"></div>
        <span class="resize-handle rh-n" data-resize="n"></span>
        <span class="resize-handle rh-s" data-resize="s"></span>
        <span class="resize-handle rh-w" data-resize="w"></span>
        <span class="resize-handle rh-e" data-resize="e"></span>
        <span class="resize-handle rh-nw" data-resize="nw"></span>
        <span class="resize-handle rh-ne" data-resize="ne"></span>
        <span class="resize-handle rh-sw" data-resize="sw"></span>
        <span class="resize-handle rh-se" data-resize="se"></span>`;

      layer.appendChild(win.el);
      this.windows.set(id, win);
      this.order.push(id);
      this.bindPointer(win);
      this.render(win);
      this.focus(id);
      Mac.emit('windows');
      return win;
    },

    /** Re-render one window's body, title and toolbar. */
    render(win) {
      if (typeof win === 'string') win = this.windows.get(win);
      if (!win) return;
      const app = Mac.apps[win.appId];
      if (!app) return;

      const body = win.el.querySelector('.window-body');
      const scrollTop = body.scrollTop;
      body.innerHTML = app.render(win) || '';
      body.scrollTop = win.state.__keepScroll === false ? 0 : scrollTop;

      win.el.querySelector('.titlebar-title').textContent = app.titleFor ? app.titleFor(win) : app.title;
      win.el.querySelector('.titlebar-tools').innerHTML = app.toolbar ? (app.toolbar(win) || '') : '';
      win.el.querySelector('.titlebar-lead').innerHTML = app.leading ? (app.leading(win) || '') : '';
      app.mount?.(win);
    },

    /** Re-render every window of an app (after shared state changed). */
    refresh(appId) {
      this.forApp(appId).forEach(win => this.render(win));
    },

    /** Re-render every open window — used after theme/appearance changes. */
    refreshAll() {
      this.windows.forEach(win => this.render(win));
    },

    focus(id) {
      const win = this.windows.get(id);
      if (!win) return;
      Mac.session.activeWindow = id;
      Mac.session.activeApp = win.appId;
      win.el.style.zIndex = ++Mac.session.zIndex;
      this.windows.forEach((other, key) => other.el.classList.toggle('inactive', key !== id));
      this.order = this.order.filter(key => key !== id).concat(id);
      Mac.emit('focus', win);
      Mac.emit('windows');
    },

    /** Focus whichever window is topmost on the current space. */
    focusTopmost() {
      const candidate = [...this.order].reverse()
        .map(id => this.windows.get(id))
        .find(win => win && !win.minimized && win.space === Mac.session.space);
      if (candidate) this.focus(candidate.id);
      else {
        Mac.session.activeApp = 'finder';
        Mac.session.activeWindow = null;
        Mac.emit('focus', null);
        Mac.emit('windows');
      }
    },

    close(id) {
      const win = this.windows.get(id || Mac.session.activeWindow);
      if (!win) return;
      Mac.apps[win.appId]?.onClose?.(win);
      win.el.remove();
      this.windows.delete(win.id);
      this.order = this.order.filter(key => key !== win.id);
      if (Mac.session.fullscreenWindow === win.id) Mac.session.fullscreenWindow = null;
      this.focusTopmost();
    },

    closeApp(appId) {
      this.forApp(appId).forEach(win => this.close(win.id));
    },

    minimize(id) {
      const win = this.windows.get(id || Mac.session.activeWindow);
      if (!win) return;
      win.minimized = true;
      win.el.classList.add('minimized');
      if (win.fullscreen) this.setFullscreen(win, false);
      this.focusTopmost();
    },

    unminimize(id) {
      const win = this.windows.get(id);
      if (!win) return;
      win.minimized = false;
      win.el.classList.remove('minimized');
      if (win.space !== Mac.session.space) this.gotoSpace(win.space);
      this.focus(win.id);
    },

    minimizeAll() {
      this.onSpace().forEach(win => { if (!win.minimized) this.minimize(win.id); });
    },

    /** The green button: maximise to the working area and back. */
    zoom(id) {
      const win = this.windows.get(id || Mac.session.activeWindow);
      if (!win) return;
      if (win.tile) { this.untile(win); return; }
      if (win.zoomed) {
        win.zoomed = false;
        win.el.classList.remove('zoomed');
        this.applyFrame(win, win.restore || win.frame);
      } else {
        win.restore = this.currentFrame(win);
        win.zoomed = true;
        win.el.classList.add('zoomed');
      }
      Mac.emit('windows');
    },

    toggleFullscreen(id) {
      const win = this.windows.get(id || Mac.session.activeWindow);
      if (!win) return;
      this.setFullscreen(win, !win.fullscreen);
    },

    setFullscreen(win, on) {
      if (on) {
        win.restore = this.currentFrame(win);
        win.fullscreen = true;
        win.el.classList.add('fullscreen');
        Mac.session.fullscreenWindow = win.id;
        Mac.$('#menu-bar').classList.add('autohidden');
        this.focus(win.id);
      } else {
        win.fullscreen = false;
        win.el.classList.remove('fullscreen');
        Mac.session.fullscreenWindow = null;
        Mac.$('#menu-bar').classList.remove('autohidden');
        this.applyFrame(win, win.restore || win.frame);
      }
      Mac.emit('windows');
    },

    /* ---------------------------------------------------------- tiling */

    /** Available layouts, matching macOS window tiling. */
    TILES: {
      left: () => ({ left: 0, top: 0, width: 0.5, height: 1 }),
      right: () => ({ left: 0.5, top: 0, width: 0.5, height: 1 }),
      top: () => ({ left: 0, top: 0, width: 1, height: 0.5 }),
      bottom: () => ({ left: 0, top: 0.5, width: 1, height: 0.5 }),
      'top-left': () => ({ left: 0, top: 0, width: 0.5, height: 0.5 }),
      'top-right': () => ({ left: 0.5, top: 0, width: 0.5, height: 0.5 }),
      'bottom-left': () => ({ left: 0, top: 0.5, width: 0.5, height: 0.5 }),
      'bottom-right': () => ({ left: 0.5, top: 0.5, width: 0.5, height: 0.5 }),
      'left-third': () => ({ left: 0, top: 0, width: 1 / 3, height: 1 }),
      'center-third': () => ({ left: 1 / 3, top: 0, width: 1 / 3, height: 1 }),
      'right-third': () => ({ left: 2 / 3, top: 0, width: 1 / 3, height: 1 }),
      fill: () => ({ left: 0, top: 0, width: 1, height: 1 }),
    },

    workArea() {
      const menu = document.querySelector('.menu-bar')?.offsetHeight || 25;
      const dockSpace = Mac.state.settings.dockAutoHide ? 10 : 78;
      const position = Mac.state.settings.dockPosition;
      const side = position === 'left' ? (Mac.state.settings.dockAutoHide ? 10 : 78) : 0;
      const sideRight = position === 'right' ? (Mac.state.settings.dockAutoHide ? 10 : 78) : 0;
      return {
        left: side,
        top: menu,
        width: (Mac.$('#simulator')?.clientWidth || innerWidth) - side - sideRight,
        height: innerHeight - menu - (position === 'bottom' ? dockSpace : 6),
      };
    },

    tileWindow(id, layout) {
      const win = this.windows.get(id || Mac.session.activeWindow);
      const shape = this.TILES[layout];
      if (!win || !shape) return;
      if (!win.tile) win.restore = this.currentFrame(win);
      const area = this.workArea();
      const box = shape();
      const gap = 6;
      win.tile = layout;
      win.zoomed = false;
      win.el.classList.remove('zoomed');
      win.el.classList.add('tiled');
      this.applyFrame(win, {
        left: Math.round(area.left + box.left * area.width + gap / 2),
        top: Math.round(area.top + box.top * area.height + gap / 2),
        width: Math.round(box.width * area.width - gap),
        height: Math.round(box.height * area.height - gap),
      });
      Mac.emit('windows');
    },

    untile(win) {
      win.tile = null;
      win.el.classList.remove('tiled');
      this.applyFrame(win, win.restore || win.frame);
      Mac.emit('windows');
    },

    currentFrame(win) {
      return {
        left: win.el.offsetLeft,
        top: win.el.offsetTop,
        width: win.el.offsetWidth,
        height: win.el.offsetHeight,
      };
    },

    applyFrame(win, frame) {
      win.frame = Object.assign({}, frame);
      win.el.style.left = `${frame.left}px`;
      win.el.style.top = `${frame.top}px`;
      win.el.style.width = `${frame.width}px`;
      win.el.style.height = `${frame.height}px`;
    },

    /** Tidy the desktop: cascade every window on this space. */
    cascade() {
      const area = this.workArea();
      this.onSpace().filter(win => !win.minimized).forEach((win, index) => {
        win.zoomed = false;
        win.tile = null;
        win.el.classList.remove('zoomed', 'tiled');
        this.applyFrame(win, {
          left: clamp(area.left + 24 + index * 28, 8, area.left + area.width - 340),
          top: clamp(area.top + 12 + index * 26, area.top, area.top + area.height - 220),
          width: Math.min(880, area.width - 48),
          height: Math.min(580, area.height - 48),
        });
        this.focus(win.id);
      });
    },

    /** Keep windows inside the viewport after a resize. */
    reflow() {
      const area = this.workArea();
      this.windows.forEach(win => {
        if (win.fullscreen || win.zoomed) return;
        if (win.tile) { this.tileWindow(win.id, win.tile); return; }
        const width = Math.min(win.el.offsetWidth, Math.max(300, area.width - 16));
        const height = Math.min(win.el.offsetHeight, Math.max(200, area.height - 16));
        this.applyFrame(win, {
          left: clamp(win.el.offsetLeft, 4, Math.max(4, area.left + area.width - width - 4)),
          top: clamp(win.el.offsetTop, area.top, Math.max(area.top, area.top + area.height - 60)),
          width,
          height,
        });
      });
    },

    /* ------------------------------------------------------------ spaces */

    gotoSpace(index) {
      const spaces = Mac.state.spaces;
      if (index < 0 || index >= spaces.length) return;
      Mac.session.space = index;
      this.windows.forEach(win => {
        win.el.classList.toggle('hidden', win.space !== index);
      });
      this.focusTopmost();
      Mac.emit('windows');
    },

    addSpace() {
      Mac.state.spaces.push({ id: Mac.uid('space'), name: `Desktop ${Mac.state.spaces.length + 1}` });
      Mac.save();
      Mac.emit('windows');
      Mac.emit('spaces');
    },

    removeSpace(index) {
      if (Mac.state.spaces.length <= 1) return;
      Mac.state.spaces.splice(index, 1);
      this.windows.forEach(win => {
        if (win.space === index) win.space = 0;
        else if (win.space > index) win.space -= 1;
      });
      Mac.state.spaces.forEach((space, position) => { space.name = `Desktop ${position + 1}`; });
      Mac.save();
      this.gotoSpace(Math.max(0, Math.min(Mac.session.space, Mac.state.spaces.length - 1)));
      Mac.emit('spaces');
    },

    moveToSpace(id, index) {
      const win = this.windows.get(id);
      if (!win || index < 0 || index >= Mac.state.spaces.length) return;
      win.space = index;
      win.el.classList.toggle('hidden', index !== Mac.session.space);
      this.focusTopmost();
      Mac.emit('windows');
    },

    /* ------------------------------------------------- keyboard switching */

    /** Cmd-` cycles windows of the active app; Cmd-Tab cycles apps. */
    cycleWindows() {
      const windows = this.forApp(Mac.session.activeApp).filter(win => win.space === Mac.session.space);
      if (windows.length < 2) return;
      const index = windows.findIndex(win => win.id === Mac.session.activeWindow);
      const next = windows[(index + 1) % windows.length];
      if (next.minimized) this.unminimize(next.id);
      else this.focus(next.id);
    },

    cycleApps(reverse = false) {
      const apps = [...new Set([...this.order].reverse()
        .map(id => this.windows.get(id))
        .filter(win => win && win.space === Mac.session.space)
        .map(win => win.appId))];
      if (apps.length < 2) return;
      const index = apps.indexOf(Mac.session.activeApp);
      const next = apps[(index + (reverse ? -1 : 1) + apps.length) % apps.length];
      const target = this.forApp(next).find(win => win.space === Mac.session.space);
      if (!target) return;
      if (target.minimized) this.unminimize(target.id);
      else this.focus(target.id);
    },

    bounceDock(appId) {
      const item = Mac.$(`.dock-item[data-open-app="${appId}"]`);
      if (!item || Mac.state.settings.reduceMotion) return;
      item.classList.add('bouncing');
      setTimeout(() => item.classList.remove('bouncing'), 1200);
    },

    /* ------------------------------------------------- drag and resize */

    bindPointer(win) {
      const titlebar = win.el.querySelector('.titlebar');
      const snap = Mac.$('#snap-preview');

      titlebar.addEventListener('pointerdown', event => {
        if (event.target.closest('button, input, select, .search, a')) return;
        this.focus(win.id);
        if (win.fullscreen) return;

        // Dragging a zoomed or tiled window releases it at the pointer.
        if (win.zoomed || win.tile) {
          const ratio = (event.clientX - win.el.offsetLeft) / win.el.offsetWidth;
          const restore = win.restore || { width: 820, height: 560 };
          win.zoomed = false;
          win.tile = null;
          win.el.classList.remove('zoomed', 'tiled');
          this.applyFrame(win, {
            left: Math.round(event.clientX - restore.width * ratio),
            top: Math.max(this.workArea().top, event.clientY - 22),
            width: restore.width,
            height: restore.height,
          });
        }

        const area = this.workArea();
        const startX = event.clientX;
        const startY = event.clientY;
        const originLeft = win.el.offsetLeft;
        const originTop = win.el.offsetTop;
        let layout = null;

        win.el.classList.add('dragging');
        titlebar.setPointerCapture(event.pointerId);

        const move = pointer => {
          const left = clamp(originLeft + pointer.clientX - startX, -win.el.offsetWidth + 90, innerWidth - 90);
          const top = clamp(originTop + pointer.clientY - startY, area.top - 4, innerHeight - 40);
          win.el.style.left = `${left}px`;
          win.el.style.top = `${top}px`;

          layout = this.snapZone(pointer.clientX, pointer.clientY, area);
          if (layout) {
            const box = this.TILES[layout]();
            snap.classList.remove('hidden');
            snap.style.left = `${area.left + box.left * area.width + 3}px`;
            snap.style.top = `${area.top + box.top * area.height + 3}px`;
            snap.style.width = `${box.width * area.width - 6}px`;
            snap.style.height = `${box.height * area.height - 6}px`;
          } else {
            snap.classList.add('hidden');
          }
        };

        const up = () => {
          titlebar.removeEventListener('pointermove', move);
          titlebar.removeEventListener('pointerup', up);
          titlebar.removeEventListener('pointercancel', up);
          win.el.classList.remove('dragging');
          snap.classList.add('hidden');
          if (layout) this.tileWindow(win.id, layout);
          else win.frame = this.currentFrame(win);
        };

        titlebar.addEventListener('pointermove', move);
        titlebar.addEventListener('pointerup', up);
        titlebar.addEventListener('pointercancel', up);
      });

      titlebar.addEventListener('dblclick', event => {
        if (event.target.closest('button, input, select, .search')) return;
        this.zoom(win.id);
      });

      win.el.querySelectorAll('[data-resize]').forEach(handle => {
        handle.addEventListener('pointerdown', event => {
          event.stopPropagation();
          this.focus(win.id);
          if (win.fullscreen || win.zoomed) return;
          const dir = handle.dataset.resize;
          const app = Mac.apps[win.appId];
          const [minW, minH] = app.min;
          const start = { x: event.clientX, y: event.clientY, ...this.currentFrame(win) };
          win.el.classList.add('resizing');
          handle.setPointerCapture(event.pointerId);

          const move = pointer => {
            const dx = pointer.clientX - start.x;
            const dy = pointer.clientY - start.y;
            const frame = { ...start };
            if (dir.includes('e')) frame.width = Math.max(minW, start.width + dx);
            if (dir.includes('s')) frame.height = Math.max(minH, start.height + dy);
            if (dir.includes('w')) {
              frame.width = Math.max(minW, start.width - dx);
              frame.left = start.left + (start.width - frame.width);
            }
            if (dir.includes('n')) {
              frame.height = Math.max(minH, start.height - dy);
              frame.top = start.top + (start.height - frame.height);
            }
            delete frame.x; delete frame.y;
            this.applyFrame(win, frame);
          };

          const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            win.el.classList.remove('resizing');
            win.tile = null;
            win.el.classList.remove('tiled');
            Mac.apps[win.appId]?.onResize?.(win);
          };

          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', up);
        });
      });
    },

    /** Which tile layout, if any, the pointer is currently hovering. */
    snapZone(x, y, area) {
      const edge = 28;
      const corner = 90;
      const nearLeft = x <= area.left + edge;
      const nearRight = x >= area.left + area.width - edge;
      const nearTop = y <= area.top + edge;
      const nearBottom = y >= area.top + area.height - edge;

      if (nearTop && x < area.left + corner) return 'top-left';
      if (nearTop && x > area.left + area.width - corner) return 'top-right';
      if (nearBottom && x < area.left + corner) return 'bottom-left';
      if (nearBottom && x > area.left + area.width - corner) return 'bottom-right';
      if (nearTop) return 'fill';
      if (nearLeft) return 'left';
      if (nearRight) return 'right';
      if (nearBottom) return 'bottom';
      return null;
    },
  };

  /* ------------------------------------------------------- Mission Control */

  Mac.MissionControl = {
    open() {
      if (Mac.$('#mission-control')) { this.close(); return; }
      Mac.Surfaces?.close();
      const layer = Mac.$('#overlay-layer');
      const element = document.createElement('div');
      element.id = 'mission-control';
      element.innerHTML = this.render();
      layer.appendChild(element);
    },

    close() {
      Mac.$('#mission-control')?.remove();
    },

    refresh() {
      const element = Mac.$('#mission-control');
      if (element) element.innerHTML = this.render();
    },

    render() {
      const spaces = Mac.state.spaces;
      const windows = WM.onSpace().filter(win => !win.minimized);
      const minimized = WM.onSpace().filter(win => win.minimized);

      return `<div class="spaces-bar">
          ${spaces.map((space, index) => `<button class="space-thumb ${index === Mac.session.space ? 'on' : ''}" data-goto-space="${index}">
            ${spaces.length > 1 ? `<span class="space-close" data-close-space="${index}" role="button" aria-label="Close ${esc(space.name)}">×</span>` : ''}
            <span>${esc(space.name)}</span></button>`).join('')}
          <button class="space-add" data-command="add-space" aria-label="Add desktop">+</button>
        </div>
        ${windows.length || minimized.length ? `<div class="exposé-grid">
          ${windows.concat(minimized).map(win => {
            const app = Mac.apps[win.appId];
            return `<div class="exposé-card">
              <button class="exposé-preview" data-focus-win="${win.id}">
                <span class="exposé-bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>
                <span class="exposé-body">${esc(app.titleFor ? app.titleFor(win) : app.title)}${win.minimized ? ' · minimised' : ''}</span>
              </button>
              <div class="exposé-label">${Mac.appIcon(app.icon)}<span>${esc(app.title)}</span></div>
            </div>`;
          }).join('')}
        </div>` : `<div class="empty" style="color:rgba(255,255,255,.8)"><div>
            <div class="empty-art">${glyph('window', { size: 52 })}</div>
            <h2 style="color:#fff">No open windows</h2>
            <p style="color:rgba(255,255,255,.7)">Open an app from the Dock or Launchpad, then press F3 to see every window at once.</p>
          </div></div>`}`;
    },
  };
}(window.Mac));
