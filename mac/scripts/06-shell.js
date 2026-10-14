/* ===========================================================================
   Desktop shell: appearance sync, menu bar, menus, Dock, Control Center,
   Notification Center, desktop items, widgets, Launchpad and context menus.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, appIcon } = Mac;

  /* ------------------------------------------------------ appearance sync */

  /** Push every persisted preference into the DOM. Cheap enough to call often. */
  Mac.sync = () => {
    const s = Mac.state.settings;
    const root = Mac.$('#simulator');
    if (!root) return;

    const dark = s.appearance === 'dark' ||
      (s.appearance === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.classList.toggle('reduce-motion', s.reduceMotion);
    root.classList.toggle('high-contrast', s.increaseContrast);
    root.classList.toggle('opaque-materials', s.reduceTransparency);

    const [accent, rgb] = Mac.ACCENTS[s.accent] || Mac.ACCENTS.blue;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-rgb', rgb);
    root.style.setProperty('--text-scale', s.textScale);
    root.style.setProperty('--dock-size', `${s.dockSize}px`);

    // Dark appearance swaps to the dark companion wallpaper when asked to.
    let wallpaper = s.wallpaper;
    if (dark && s.wallpaperDarkAuto && wallpaper === 'tahoe-light') wallpaper = 'tahoe-dark';
    // Resolve to an absolute URL: browsers resolve relative URLs inside a
    // custom property against the stylesheet that consumes it, not the
    // document, which would look for the asset under styles/.
    const wallpaperUrl = new URL(`assets/wallpapers/${wallpaper}.svg`, document.baseURI).href;
    root.style.setProperty('--wallpaper', `url("${wallpaperUrl}")`);

    Mac.$('#brightness-veil').style.opacity = String((100 - s.brightness) / 210);
    Mac.$('#warmth-veil').style.opacity = s.nightShift ? '0.14' : '0';

    const menuBar = Mac.$('#menu-bar');
    menuBar.classList.toggle('tinted', s.menuBarTinted);
    if (!Mac.session.fullscreenWindow) menuBar.classList.toggle('autohidden', s.autoHideMenuBar);

    const dockWrap = Mac.$('#dock-wrap');
    dockWrap.classList.toggle('hidden-dock', s.dockAutoHide);
    dockWrap.classList.remove('left', 'right');
    if (s.dockPosition !== 'bottom') dockWrap.classList.add(s.dockPosition);
    Mac.$('#dock').classList.toggle('dock-magnify', s.dockMagnification);

    Mac.Shell.renderMenuBar();
    Mac.Shell.renderDock();
    Mac.Shell.renderDesktop();

    /* Scenario goals are re-checked here because sync already runs after
       every state change — so progress keeps itself up to date without each
       scenario having to know which settings the trainee is going to touch. */
    Mac.Scenarios?.evaluate();
    Mac.Scenarios?.renderProgress();
  };

  /* ------------------------------------------------------------------ menus */

  /** Menu definitions. Apps contribute extra entries through `app.menus`. */
  const Menus = Mac.Menus = {
    build(appId) {
      const app = Mac.apps[appId] || Mac.apps.finder;
      const win = Mac.wm.active();
      const windows = Mac.wm.forApp(appId);
      const custom = app.menus ? app.menus(win) : {};

      const base = {
        [app.title]: [
          { label: `About ${app.title}`, command: 'about-app' },
          'sep',
          { label: 'Settings…', command: 'app-settings', shortcut: '⌘,' },
          'sep',
          { label: `Hide ${app.title}`, command: 'hide-app', shortcut: '⌘H' },
          { label: 'Hide Others', command: 'hide-others', shortcut: '⌥⌘H' },
          'sep',
          { label: `Quit ${app.title}`, command: 'quit-app', shortcut: '⌘Q', disabled: appId === 'finder' },
        ],
        File: [
          { label: 'New Window', command: 'new-window', shortcut: '⌘N' },
          { label: 'Open…', command: 'open-item', shortcut: '⌘O' },
          'sep',
          { label: 'Close Window', command: 'close-window', shortcut: '⌘W', disabled: !win },
          { label: 'Print…', command: 'print', shortcut: '⌘P' },
        ],
        Edit: [
          { label: 'Undo', command: 'edit-undo', shortcut: '⌘Z' },
          { label: 'Redo', command: 'edit-redo', shortcut: '⇧⌘Z' },
          'sep',
          { label: 'Cut', command: 'edit-cut', shortcut: '⌘X' },
          { label: 'Copy', command: 'edit-copy', shortcut: '⌘C' },
          { label: 'Paste', command: 'edit-paste', shortcut: '⌘V' },
          { label: 'Select All', command: 'edit-select-all', shortcut: '⌘A' },
        ],
        View: [
          { label: 'Show Sidebar', command: 'toggle-sidebar', shortcut: '⌃⌘S' },
          'sep',
          { label: win?.fullscreen ? 'Exit Full Screen' : 'Enter Full Screen', command: 'toggle-fullscreen', shortcut: '⌃⌘F', disabled: !win },
        ],
        Window: [
          { label: 'Minimise', command: 'minimize-window', shortcut: '⌘M', disabled: !win },
          { label: win?.zoomed ? 'Unzoom' : 'Zoom', command: 'zoom-window', disabled: !win },
          'sep',
          { label: 'Move Window to Left Side of Screen', command: 'tile', arg: 'left', disabled: !win },
          { label: 'Move Window to Right Side of Screen', command: 'tile', arg: 'right', disabled: !win },
          { label: 'Fill Screen', command: 'tile', arg: 'fill', disabled: !win },
          { label: 'Tile in Quarters', command: 'tile-quarters', disabled: Mac.wm.onSpace().length < 2 },
          'sep',
          { label: 'Cycle Through Windows', command: 'cycle-windows', shortcut: '⌘`', disabled: windows.length < 2 },
          { label: 'Bring All to Front', command: 'bring-all-front' },
          { label: 'Minimise All', command: 'minimize-all' },
        ],
        Help: [
          { label: `${app.title} Help`, command: 'app-help' },
          { label: 'Keyboard Shortcuts', command: 'keyboard-shortcuts' },
        ],
      };

      // Merge: app entries are appended to the matching base menu, or added
      // as a brand new menu placed before Window.
      const merged = {};
      const order = [app.title, 'File', 'Edit', 'View'];
      Object.keys(custom).forEach(name => { if (!order.includes(name)) order.push(name); });
      order.push('Window', 'Help');

      order.forEach(name => {
        const items = [].concat(base[name] || [], custom[name] ? ['sep', ...custom[name]] : []);
        if (items.length) merged[name] = items;
      });

      // Window menu lists every open window on this space.
      const openWindows = Mac.wm.onSpace();
      if (openWindows.length) {
        merged.Window.push('sep');
        openWindows.forEach(candidate => {
          const owner = Mac.apps[candidate.appId];
          merged.Window.push({
            label: owner.titleFor ? owner.titleFor(candidate) : owner.title,
            command: 'focus-window',
            arg: candidate.id,
            checked: candidate.id === Mac.session.activeWindow,
          });
        });
      }
      return merged;
    },

    appleMenu() {
      return [
        { label: 'About This Mac', command: 'about-mac' },
        'sep',
        { label: 'System Settings…', command: 'open-settings' },
        { label: 'App Store…', command: 'open-app', arg: 'appstore' },
        'sep',
        { label: 'Recent Items', command: 'recent-items' },
        'sep',
        
        { label: 'Force Quit…', command: 'force-quit-dialog', shortcut: '⌥⌘⎋' },
        'sep',
        { label: 'Sleep', command: 'power', arg: 'sleep' },
        { label: 'Restart…', command: 'power', arg: 'restart' },
        { label: 'Shut Down…', command: 'power', arg: 'shutdown' },
        'sep',
        { label: 'Lock Screen', command: 'power', arg: 'lock', shortcut: '⌃⌘Q' },
        { label: `Log Out ${Mac.state.account.name.split(' ')[0]}…`, command: 'power', arg: 'logout', shortcut: '⇧⌘Q' },

      ];
    },

    markup(items) {
      return `<div class="menu-list" role="menu">${items.map(item => {
        if (item === 'sep') return '<hr>';
        if (item.caption) return `<div class="menu-caption">${esc(item.caption)}</div>`;
        return `<button role="menuitem" data-command="${esc(item.command)}"
          ${item.arg !== undefined ? `data-arg="${esc(item.arg)}"` : ''} ${item.disabled ? 'disabled' : ''}>
          <span class="check">${item.checked ? '✓' : ''}</span>
          <span>${esc(item.label)}</span>
          ${item.shortcut ? `<span class="shortcut">${esc(item.shortcut)}</span>` : ''}</button>`;
      }).join('')}</div>`;
    },
  };

  /* ------------------------------------------------------------------ shell */

  const Shell = Mac.Shell = {
    renderMenuBar() {
      const appId = Mac.session.activeApp || 'finder';
      const menus = Menus.build(appId);
      const names = Object.keys(menus);

      /* aria-haspopup and aria-expanded, so the button announces that it
         opens a menu and whether that menu is open — the role="menubar" on
         the container is only half the contract. */
      Mac.$('#menu-left').innerHTML =
        `<button class="menu-item apple-menu" data-surface="apple" aria-label="Apple menu"
          aria-haspopup="menu" aria-expanded="false">${Mac.appleMark()}</button>` +
        names.map((name, index) => `<button class="menu-item ${index === 0 ? 'app-name' : 'menu-hideable'}"
          data-surface="menu" data-menu-name="${esc(name)}"
          aria-haspopup="menu" aria-expanded="false">${esc(name)}</button>`).join('');

      const s = Mac.state.settings;
      const wifi = Mac.state.wifi;
      const battery = Mac.state.battery;
      const unread = Mac.state.notifications.length;

      const items = [];
      if (Mac.state.music.playing) {
        items.push(`<button class="status-item status-hideable" data-surface="now-playing" aria-label="Now playing">${glyph('play', { size: 14 })}</button>`);
      }
      if (s.bluetooth && s.showBluetoothMenu) {
        items.push(`<button class="status-item status-hideable" data-surface="bluetooth" aria-label="Bluetooth">${glyph('bluetooth')}</button>`);
      }
      if (s.showWifiMenu) {
        const connected = wifi.enabled && wifi.current;
        items.push(`<button class="status-item" data-surface="wifi"
          aria-label="${connected ? `Wi-Fi connected to ${esc(wifi.current)}` : 'Wi-Fi off'}">${glyph(connected ? 'wifi' : 'wifi-off')}</button>`);
      }
      items.push(`<button class="status-item status-hideable" data-surface="battery" aria-label="Battery ${battery.percent}%">
        ${s.showBatteryPercent ? `<span>${battery.percent}%</span>` : ''}
        <span class="battery-glyph"><span class="battery-shell"><span class="battery-fill ${battery.charging ? 'charging' : ''}${battery.percent <= 20 ? ' low' : ''}"
          style="width:${battery.percent}%"></span></span></span></button>`);
      items.push(`<button class="status-item" data-command="spotlight" aria-label="Spotlight Search">${glyph('spotlight')}</button>`);
      items.push(`<button class="status-item" data-surface="control-center" aria-label="Control Center">${glyph('control-center')}</button>`);
      items.push(`<button class="status-item status-clock" data-surface="notification-center"
        aria-label="Notification Center${unread ? `, ${unread} items` : ''}"><span id="menu-clock"></span></button>`);

      Mac.$('#menu-right').innerHTML = items.join('');
      this.updateClock();
    },

    updateClock() {
      const now = new Date();
      const s = Mac.state.settings;
      const clock = Mac.$('#menu-clock');
      if (clock) {
        clock.textContent = now.toLocaleString(undefined, {
          weekday: 'short', day: 'numeric', month: 'short',
          hour: 'numeric', minute: '2-digit', hour12: !s.time24,
        });
      }
      const time = Mac.formatTime(now);
      const date = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      const set = (id, value) => { const node = Mac.$(id); if (node) node.textContent = value; };
      set('#lock-time', time);
      set('#lock-date', date);
      Mac.$$('.lock-status-clock').forEach(node => { node.textContent = time; });
    },

    /* ---------------------------------------------------------------- dock */

    renderDock() {
      const dock = Mac.$('#dock');
      if (!dock) return;
      const s = Mac.state.settings;
      const installed = Mac.state.dockApps.filter(id => Mac.apps[id] && Mac.state.installedApps.includes(id));
      const running = [...new Set([...Mac.wm.windows.values()].map(win => win.appId))];
      const extras = running.filter(id => !installed.includes(id) && id !== 'trash');
      const minimized = [...Mac.wm.windows.values()].filter(win => win.minimized);

      const badgeFor = id => {
        if (id === 'mail') {
          const count = Mac.state.mail.messages.filter(message => message.mailbox === 'Inbox' && message.unread).length;
          return count || 0;
        }
        if (id === 'outlook') {
          return Mac.state.outlook.messages.filter(message => message.folder === 'Inbox' && message.unread).length;
        }
        if (id === 'appstore') return Mac.state.appUpdates.length;
        if (id === 'messages') return 0;
        return 0;
      };

      const item = (id, { alwaysShow = false } = {}) => {
        const app = Mac.apps[id];
        if (!app) return '';
        const badge = badgeFor(id);
        const isRunning = Mac.wm.forApp(id).length > 0;
        return `<button class="dock-item ${isRunning ? 'running' : ''} ${alwaysShow ? 'always-dock' : ''}"
          data-open-app="${id}" data-dock-app="${id}" aria-label="${esc(app.title)}">
          ${appIcon(app.icon)}
          ${badge ? `<span class="dock-badge">${badge > 99 ? '99+' : badge}</span>` : ''}
          <span class="dock-tooltip">${esc(app.title)}</span></button>`;
      };

      const trashApp = Mac.apps.trash;
      const trashCount = Mac.FS ? Mac.FS.children('trash').length : 0;

      dock.innerHTML =
        installed.map(id => item(id, { alwaysShow: ['finder', 'launchpad', 'safari'].includes(id) })).join('') +
        (extras.length ? '<span class="dock-sep" aria-hidden="true"></span>' + extras.map(id => item(id)).join('') : '') +
        (minimized.length ? '<span class="dock-sep" aria-hidden="true"></span>' + minimized.map(win => {
          const app = Mac.apps[win.appId];
          return `<button class="dock-item minimized-window" data-restore-win="${win.id}"
            aria-label="Restore ${esc(app.title)}">${appIcon(app.icon)}
            <span class="dock-tooltip">${esc(app.titleFor ? app.titleFor(win) : app.title)}</span></button>`;
        }).join('') : '') +
        '<span class="dock-sep" aria-hidden="true"></span>' +
        `<button class="dock-item always-dock" data-open-app="trash" data-dock-app="trash" aria-label="Trash">
          ${appIcon(trashCount ? 'trash-full' : 'trash')}
          <span class="dock-tooltip">Trash${trashCount ? ` — ${Mac.plural(trashCount, 'item')}` : ''}</span></button>`;

      Mac.$('#dock').classList.toggle('dock-magnify', s.dockMagnification);
    },

    /* ------------------------------------------------------------- desktop */

    renderDesktop() {
      const items = Mac.$('#desktop-items');
      if (items && Mac.FS) {
        items.innerHTML = Mac.state.desktopItems.map(id => {
          const node = Mac.FS.node(id);
          if (!node) return '';
          return `<button class="desktop-item" data-open-desktop="${id}">
            ${appIcon(Mac.FS.iconFor(node))}<span>${esc(node.name)}</span></button>`;
        }).join('');
      }
      this.renderWidgets();
    },

    renderWidgets() {
      const host = Mac.$('#desktop-widgets');
      if (!host) return;
      const battery = Mac.state.battery;
      const wifi = Mac.state.wifi;
      const events = Mac.state.calendar.events.filter(event => event.offset === 0).slice(0, 3);

      host.innerHTML =
        `<button class="widget" data-open-app="calendar">
          <h4>${new Date().toLocaleDateString(undefined, { weekday: 'long' })}</h4>
          <div class="widget-big">${new Date().getDate()}</div>
          ${events.length ? `<div class="widget-list" style="margin-top:8px">${events.map(event =>
            `<span><i style="color:${Mac.state.calendar.calendars.find(c => c.id === event.calendar)?.color || '#fff'}"></i>${esc(event.time)} ${esc(event.title)}</span>`).join('')}</div>`
            : '<p>No events today</p>'}
        </button>
        <button class="widget" data-open-app="activity-monitor">
          <h4>System</h4>
          <div class="widget-list">
            <span><i></i>Wi-Fi — ${wifi.enabled ? esc(wifi.current || 'Not connected') : 'Off'}</span>
            <span><i></i>Battery — ${battery.percent}%${battery.charging ? ' charging' : ''}</span>
            <span><i></i>Updates — ${Mac.state.appUpdates.length || 'none'}</span>
          </div>
        </button>`;
    },

    /* ----------------------------------------------------------- launchpad */

    launchpad: { page: 0, query: '' },

    openLaunchpad() {
      if (Mac.$('#launchpad')) { this.closeLaunchpad(); return; }
      Mac.Surfaces.close();
      this.launchpad = { page: 0, query: '' };
      const element = document.createElement('div');
      element.id = 'launchpad';
      Mac.$('#overlay-layer').appendChild(element);
      this.renderLaunchpad();
      setTimeout(() => Mac.$('#launchpad-input')?.focus(), 40);
    },

    closeLaunchpad() {
      const element = Mac.$('#launchpad');
      if (!element) return;
      element.classList.add('closing');
      setTimeout(() => element.remove(), 180);
    },

    renderLaunchpad() {
      const element = Mac.$('#launchpad');
      if (!element) return;
      const query = this.launchpad.query.trim().toLowerCase();
      const apps = Mac.appList()
        .filter(app => app.id !== 'launchpad' && app.id !== 'trash')
        .filter(app => !query || app.title.toLowerCase().includes(query) || app.category.toLowerCase().includes(query));

      const perPage = 28;
      const pages = Math.max(1, Math.ceil(apps.length / perPage));
      this.launchpad.page = Mac.clamp(this.launchpad.page, 0, pages - 1);

      element.innerHTML =
        `<div class="launchpad-search">${glyph('search')}
          <input id="launchpad-input" placeholder="Search" value="${esc(this.launchpad.query)}" aria-label="Search apps" autocomplete="off">
        </div>
        <div class="launchpad-pages">
          ${Array.from({ length: pages }, (_, page) => `<div class="launchpad-page" style="transform:translateX(${(page - this.launchpad.page) * 100}%);margin-left:${page ? '-100%' : '0'}">
            ${apps.slice(page * perPage, (page + 1) * perPage).map(app =>
              `<button class="launchpad-app" data-launch-app="${app.id}">${appIcon(app.icon)}<span>${esc(app.title)}</span></button>`).join('')}
          </div>`).join('')}
        </div>
        ${pages > 1 ? `<div class="launchpad-dots">${Array.from({ length: pages }, (_, page) =>
          `<button class="${page === this.launchpad.page ? 'on' : ''}" data-launchpad-page="${page}" aria-label="Page ${page + 1}"></button>`).join('')}</div>` : ''}
        ${apps.length ? '' : `<div class="empty" style="color:rgba(255,255,255,.8)"><div><h2 style="color:#fff">No apps found</h2><p style="color:rgba(255,255,255,.7)">Try a different search.</p></div></div>`}`;
    },
  };

  /* ------------------------------------------------------ floating surfaces */

  const Surfaces = Mac.Surfaces = {
    current: null,

    close() {
      Mac.$('#surface-layer').innerHTML = '';
      Mac.$$('[data-surface].open').forEach(node => {
        node.classList.remove('open');
        node.setAttribute('aria-expanded', 'false');
      });
      this.current = null;
      Mac.session.surface = null;
      /* Focus goes back to the button that opened the menu. Without this it
         is left on a node that has just been removed, which drops it to
         <body> and loses the keyboard user's place in the menu bar. */
      if (this.anchor && this.anchor.isConnected) this.anchor.focus();
      this.anchor = null;
    },

    /** Toggle a named popover, anchored to the element that triggered it. */
    show(name, anchor, extra = {}) {
      const key = name + (extra.menuName || '');
      if (this.current === key) { this.close(); return; }
      this.close();
      this.current = key;
      Mac.session.surface = name;
      this.anchor = anchor || null;
      anchor?.classList.add('open');
      anchor?.setAttribute('aria-expanded', 'true');

      const layer = Mac.$('#surface-layer');
      const element = document.createElement('div');
      element.className = 'popover';

      switch (name) {
        case 'apple':
          element.classList.add('anchored-left');
          element.style.left = '6px';
          element.innerHTML = Menus.markup(Menus.appleMenu());
          break;
        case 'menu': {
          element.classList.add('anchored-left');
          const menus = Menus.build(Mac.session.activeApp || 'finder');
          const items = menus[extra.menuName] || [];
          const left = Math.min(anchor?.offsetLeft ?? 40, innerWidth - 250);
          element.style.left = `${Math.max(4, left)}px`;
          element.innerHTML = Menus.markup(items);
          break;
        }
        case 'wifi':
          element.classList.add('anchored-right');
          element.style.right = '96px';
          element.innerHTML = Mac.Network.menu();
          break;
        case 'bluetooth':
          element.classList.add('anchored-right');
          element.style.right = '132px';
          element.innerHTML = this.bluetoothMenu();
          break;
        case 'battery':
          element.classList.add('anchored-right');
          element.style.right = '150px';
          element.innerHTML = this.batteryMenu();
          break;
        case 'control-center':
          element.classList.add('anchored-right', 'control-center');
          element.style.right = '62px';
          element.innerHTML = this.controlCenter();
          break;
        case 'notification-center':
          element.classList.add('anchored-right', 'notification-center');
          element.innerHTML = this.notificationCenter();
          break;
        case 'now-playing':
          element.classList.add('anchored-right');
          element.style.right = '190px';
          element.innerHTML = Mac.Media.nowPlayingPopover();
          break;
        default:
          element.innerHTML = '';
      }

      layer.appendChild(element);
      /* Opening a menu moves focus into it. The menubar/menu roles promise a
         screen-reader user that the arrow keys work; keyboard() below makes
         that true, and this is what gives it something to start from. */
      element.querySelector('button:not(:disabled), [tabindex="0"]')?.focus();
    },

    /**
     * Arrow-key navigation inside an open menu.
     *
     * The menu bar declares role="menubar" and role="menuitem", which tells
     * assistive technology to use the arrow keys — and nothing implemented
     * them, so the promise was false and the menus were reachable only by
     * Tab, one item at a time, through every menu on screen. Declaring the
     * roles without this is worse than not declaring them at all.
     *
     * @returns {boolean} true when the key was consumed
     */
    keyboard(event) {
      const layer = Mac.$('#surface-layer');
      const popover = layer.querySelector('.popover');
      if (!popover) return false;

      const items = [...popover.querySelectorAll('button:not(:disabled)')];
      if (!items.length) return false;
      const index = items.indexOf(document.activeElement);

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = index < 0 ? (step > 0 ? 0 : items.length - 1)
          : (index + step + items.length) % items.length;
        items[next].focus();
        return true;
      }
      if (event.key === 'Home') { items[0].focus(); return true; }
      if (event.key === 'End') { items[items.length - 1].focus(); return true; }

      /* Left and right walk the menu bar itself, the way a real menu does —
         open a menu, then slide along the row without closing anything. */
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const bar = [...Mac.$$('#menu-left .menu-item')];
        const at = bar.indexOf(this.anchor);
        if (at < 0) return false;
        const target = bar[(at + (event.key === 'ArrowRight' ? 1 : -1) + bar.length) % bar.length];
        target.click();
        target.focus();
        return true;
      }
      return false;
    },

    /** Rebuild the visible popover in place (after a toggle inside it). */
    refresh() {
      if (!this.current) return;
      const name = Mac.session.surface;
      const element = Mac.$('#surface-layer .popover');
      if (!element) return;
      if (name === 'control-center') element.innerHTML = this.controlCenter();
      else if (name === 'wifi') element.innerHTML = Mac.Network.menu();
      else if (name === 'bluetooth') element.innerHTML = this.bluetoothMenu();
      else if (name === 'notification-center') element.innerHTML = this.notificationCenter();
      else if (name === 'battery') element.innerHTML = this.batteryMenu();
    },

    controlCenter() {
      const s = Mac.state.settings;
      const wifi = Mac.state.wifi;
      const card = (config) => `<button class="cc-card ${config.wide ? 'wide' : ''} ${config.on ? 'on' : ''}"
        ${config.toggle ? `data-toggle-path="${config.toggle}" data-after="surface-refresh"` : ''}
        ${config.command ? `data-command="${config.command}"` : ''} ${config.arg ? `data-arg="${config.arg}"` : ''}>
        <span class="cc-head"><span class="cc-dot">${glyph(config.icon)}</span>
        <span><strong>${esc(config.title)}</strong><small>${esc(config.detail)}</small></span></span></button>`;

      return `<div class="cc-grid">
        ${card({ icon: wifi.enabled ? 'wifi' : 'wifi-off', title: 'Wi-Fi', detail: wifi.enabled ? (wifi.current || 'On') : 'Off', on: wifi.enabled, command: 'wifi-toggle' })}
        ${card({ icon: 'bluetooth', title: 'Bluetooth', detail: s.bluetooth ? 'On' : 'Off', on: s.bluetooth, toggle: 'settings.bluetooth' })}
        ${card({ icon: 'moon', title: 'Focus', detail: s.focus ? s.focusMode : 'Off', on: s.focus, toggle: 'settings.focus' })}
        ${card({ icon: 'airdrop', title: 'AirDrop', detail: s.airdropVisibility, on: true, command: 'open-setting', arg: 'General' })}
        ${card({ icon: 'bolt', title: 'Low Power', detail: s.lowPowerMode ? 'On' : 'Off', on: s.lowPowerMode, toggle: 'settings.lowPowerMode' })}
        ${card({ icon: 'display', title: 'Screen Mirroring', detail: 'Not connected', on: false, command: 'open-setting', arg: 'Displays' })}
        <div class="cc-card wide"><strong>Display</strong>
          <div class="cc-slider">${glyph('sun')}<input class="range" type="range" min="12" max="100" value="${s.brightness}"
            style="--fill-pct:${s.brightness}%" data-range-path="settings.brightness" aria-label="Brightness"></div></div>
        <div class="cc-card wide"><strong>Sound</strong>
          <div class="cc-slider">${glyph(s.muted ? 'volume-off' : 'volume')}<input class="range" type="range" min="0" max="100"
            value="${s.muted ? 0 : s.volume}" style="--fill-pct:${s.muted ? 0 : s.volume}%" data-range-path="settings.volume" aria-label="Volume"></div></div>
        ${card({ icon: 'moon', title: 'Night Shift', detail: s.nightShift ? 'On' : 'Off', on: s.nightShift, toggle: 'settings.nightShift' })}
        ${card({ icon: 'apps', title: 'Stage Manager', detail: s.stageManager ? 'On' : 'Off', on: s.stageManager, toggle: 'settings.stageManager' })}
      </div>
      <div class="menu-list" style="margin-top:8px"><button data-command="open-settings">Control Centre Settings…</button></div>`;
    },

    bluetoothMenu() {
      const s = Mac.state.settings;
      return `<h3>Bluetooth</h3>
        <div class="row"><div class="row-text"><strong>Bluetooth</strong><p>${s.bluetooth ? 'On' : 'Off'}</p></div>
          <button class="switch ${s.bluetooth ? 'on' : ''}" data-toggle-path="settings.bluetooth" data-after="surface-refresh" aria-label="Bluetooth"></button></div>
        ${s.bluetooth ? `<div class="menu-list">${Mac.state.bluetoothDevices.map(device =>
          `<button data-command="bluetooth-toggle" data-arg="${device.id}"><span class="check">${device.connected ? '✓' : ''}</span>
            <span>${esc(device.name)}</span><span class="shortcut">${device.battery != null ? `${device.battery}%` : ''}</span></button>`).join('')}
          <hr><button data-command="open-setting" data-arg="Bluetooth">Bluetooth Settings…</button></div>` : ''}`;
    },

    batteryMenu() {
      const battery = Mac.state.battery;
      return `<h3>Battery</h3>
        <div class="row"><div class="row-text"><strong>${battery.percent}%</strong>
          <p>${battery.charging ? 'Power Adapter — charging' : `Battery — ${battery.timeRemaining} remaining`}</p></div></div>
        <div class="row"><div class="row-text"><strong>Energy use</strong><p>No apps using significant energy</p></div></div>
        <div class="menu-list"><button data-command="toggle-charging">${battery.charging ? 'Disconnect Power Adapter' : 'Connect Power Adapter'}</button>
          <button data-toggle-path="settings.lowPowerMode" data-after="surface-refresh"><span class="check">${Mac.state.settings.lowPowerMode ? '✓' : ''}</span><span>Low Power Mode</span></button>
          <hr><button data-command="open-setting" data-arg="Battery">Battery Settings…</button></div>`;
    },

    notificationCenter() {
      const list = Mac.state.notifications;
      return `<div class="popover-title">Notification Centre</div>
        ${list.length ? list.map(item => `<article class="notification">
          <div class="notification-head">${appIcon(Mac.apps[item.app]?.icon || 'settings')}
            <strong>${esc(Mac.appTitle(item.app))}</strong><time>${esc(Mac.timeAgo(item.at))}</time>
            <button class="icon-btn" style="width:20px;height:20px" data-command="dismiss-notification" data-arg="${item.id}" aria-label="Remove">${glyph('close', { size: 11 })}</button></div>
          <strong style="display:block;font-size:12px;margin-bottom:2px">${esc(item.title)}</strong>
          <p>${esc(item.body)}</p>
          <div class="notification-actions"><button class="btn" data-command="open-app" data-arg="${esc(item.app)}">Open</button></div>
        </article>`).join('') + '<div style="padding:4px"><button class="btn wide" data-command="clear-notifications">Clear All</button></div>'
        : `<div class="empty" style="min-height:150px"><div><div class="empty-art">${glyph('bell', { size: 44 })}</div><h2>No notifications</h2></div></div>`}`;
    },

    /* -------------------------------------------------------- context menus */

    contextMenu(x, y, items) {
      this.close();
      this.current = 'context';
      Mac.session.surface = 'context';
      const layer = Mac.$('#surface-layer');
      const element = document.createElement('div');
      element.className = 'popover context-menu';
      element.innerHTML = Menus.markup(items);
      element.style.left = `${Math.min(x, innerWidth - 230)}px`;
      element.style.top = `${Math.min(y, innerHeight - 40 - items.length * 26)}px`;
      layer.appendChild(element);
    },
  };

  /* Re-render chrome whenever windows or notifications change. */
  Mac.on('windows', () => { Shell.renderDock(); Shell.renderMenuBar(); Mac.MissionControl.refresh(); });
  Mac.on('focus', () => Shell.renderMenuBar());
  Mac.on('notifications', () => { if (Mac.session.surface === 'notification-center') Surfaces.refresh(); });
}(window.Mac));
