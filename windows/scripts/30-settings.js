/* ===========================================================================
   Settings.

   The Windows 11 Settings app: left navigation with search, breadcrumb page
   header and WinUI setting cards. Pages are plain functions that return
   markup from Win.state; one delegated listener per window turns data
   attributes into state changes:

     data-set="path"      toggle / combo / slider bound to a state path
                          ("volume" -> settings.volume, "network.hotspot")
     data-go="page"       navigate (optional data-args JSON)
     data-act="name"      run ACTIONS[name](el, ctx, event)
     data-exp="id"        expander header

   Pages re-render whenever shared state changes, keeping scroll and focus.
   Win.Settings.open(page, extra) deep-links from anywhere in the shell.
   =========================================================================== */

(function (Win) {
  'use strict';

  const DAY = 86400000;
  const E = Win.esc;
  const g = (name, size = 16, cls = '') => Win.glyph(name, size, cls);
  const S = () => Win.state.settings;
  const N = () => Win.state.network;
  const A = () => Win.state.account;
  const U = () => Win.state.update;

  /* Keys this module adds; merged under any saved document at boot. */
  Object.assign(Win.DefaultState.settings, {
    deviceName: '',
    colorMode: '',
    lastWallpaper: '',
    recentAccents: [],
    storageSense: false,
    storageFreed: 0,
    tempBytes: 4.62e9,
    colorFilter: 'Grayscale',
    magnifierZoom: 200,
    lockOnSignin: true,
    lockSpotlight: false,
    printerManage: true,
    enhancePrecision: true,
    scrollLines: 3,
    wheelDirection: 'Down motion scrolls down',
    altTab: 'Open windows and 5 most recent tabs',
    shake: false,
    snapAssist: true,
    snapLayouts: true,
    mouseKeys: false,
    filterKeys: false,
    toggleKeys: false,
    onScreenKeyboard: false,
    monoAudio: false,
    captions: false,
    notifySound: true,
    notifyLock: true,
    appNotify: {},
    appPerms: {},
    focusMinutes: 30,
    focusUntil: 0,
    focusDnd: true,
    clockInTray: true,
    lastTimeSync: Date.now() - 2 * 3600e3,
    regionalFormat: 'English (United States)',
    gameBar: true,
    captures: false,
    dynamicLighting: true,
    storeHistory: true,
    tailored: false,
    speech: false,
    inking: true,
    activityHistory: false,
    safeSearch: 'Moderate',
    deskIcons: { computer: false, user: false, network: false, recycle: true, control: false },
    nearbySharing: 'Off',
    remoteDesktop: false,
    defaults: { browser: 'Microsoft Edge', photos: 'Photos', music: 'Media Player', video: 'Media Player', text: 'Notepad', pdf: 'Microsoft Edge', mail: 'Outlook' },
  });
  Object.assign(Win.DefaultState.network, {
    randomMac: false,
    hotspotName: `${Win.PERSONA.computer} 4821`,
    hotspotPass: 'Hx2b+7461q',
    hotspotBand: 'Any available',
    hotspotOver: 'Wi-Fi',
    hotspotSaver: true,
    vpnMetered: true,
    vpnRoaming: true,
    meteredLimit: '',
  });
  Object.assign(Win.DefaultState.update, { scheduled: 0, otherProducts: false, meteredDownload: false, notifyRestart: false, upToDate: false });
  Object.assign(Win.DefaultState.account, { autoRestartApps: false, showDetails: true, helloOnly: true });

  /* Settings > Storage reports space freed here; keep Explorer's figures in step. */
  const baseUsed = Win.FS.used;
  Win.FS.used = id => baseUsed(id) - (id === 'c' ? (Win.state?.settings?.storageFreed || 0) : 0);

  const deviceName = () => S().deviceName || Win.PERSONA.computer;

  /* ------------------------------------------------------------ state paths */

  const ROOTS = new Set(['settings', 'network', 'account', 'update', 'taskbar', 'start']);
  const THEME_KEYS = new Set(['theme', 'appTheme', 'accent', 'accentAuto', 'transparency', 'wallpaper', 'wallpaperFit', 'solidColor',
    'animations', 'lockWallpaper', 'accentOnStart', 'accentOnTitle', 'textSize', 'brightness', 'nightLight', 'nightStrength', 'contrast', 'colorFilters']);

  const parts = path => { const p = String(path).split('.'); if (!ROOTS.has(p[0])) p.unshift('settings'); return p; };
  const getPath = path => parts(path).reduce((o, k) => (o == null ? o : o[k]), Win.state);
  function setPath(path, value) {
    const p = parts(path);
    const last = p.pop();
    const obj = p.reduce((o, k) => (o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {})), Win.state);
    obj[last] = value;
    return topicFor([...p, last]);
  }
  function topicFor(p) {
    if (p[0] === 'settings' && p.length === 2 && THEME_KEYS.has(p[1])) return 'theme';
    if (p[0] === 'network') return 'network';
    return 'state';
  }

  /* ------------------------------------------------------- markup helpers */

  let collecting = null;          // search indexer; rows report themselves
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const note = (id, title, keywords, go) => { if (collecting && title) collecting.rows.push({ page: collecting.page, row: id, title, kw: keywords || '', go }); };
  const attrJSON = v => E(JSON.stringify(v));

  const chev = '<span class="st-chev" aria-hidden="true">' + Win.glyph('chevright', 16) + '</span>';

  /** One settings card. */
  function row(o) {
    const id = o.id || slug(o.title);
    if (o.idx !== false) note(id, o.title, o.keywords, o.go);
    const ico = o.iconHtml ? `<span class="row-ico">${o.iconHtml}</span>` : o.icon ? `<span class="row-ico">${g(o.icon, 20)}</span>` : '';
    const desc = o.desc ? `<span class="row-desc">${o.descHtml ? o.desc : E(o.desc)}</span>` : '';
    const text = `<span class="row-text"><span class="row-title">${o.titleHtml || E(o.title)}</span>${desc}</span>`;
    const args = o.args ? ` data-args="${attrJSON(o.args)}"` : '';
    const cls = Win.cls('card-row st-row', o.cls, o.disabled && 'disabled');
    const extra = o.attrs || '';
    if (o.go && !o.end) return `<button class="${cls}" data-go="${o.go}"${args} data-row="${E(id)}" ${o.disabled ? 'disabled' : ''} ${extra}>${ico}${text}<span class="row-end">${o.endText ? `<span class="st-endtext">${E(o.endText)}</span>` : ''}${chev}</span></button>`;
    if (o.go) return `<div class="${cls} clickable" data-go="${o.go}"${args} data-row="${E(id)}" ${extra}>${ico}${text}<span class="row-end">${o.end}<button class="icon-btn st-chevbtn" data-go="${o.go}"${args} aria-label="${E(o.title)}">${Win.glyph('chevright', 16)}</button></span></div>`;
    if (o.act && !o.end) return `<button class="${cls}" data-act="${o.act}" ${o.dataId != null ? `data-id="${E(o.dataId)}"` : ''} data-row="${E(id)}" ${o.disabled ? 'disabled' : ''} ${extra}>${ico}${text}<span class="row-end">${o.endText ? `<span class="st-endtext">${E(o.endText)}</span>` : ''}${o.external ? g('open', 16) : chev}</span></button>`;
    return `<div class="${cls}" data-row="${E(id)}" ${extra}>${ico}${text}${o.end ? `<span class="row-end">${o.end}</span>` : ''}</div>${o.after || ''}`;
  }

  /** Expander card: header row plus nested rows. Open state lives on ctx. */
  function exp(ctx, o) {
    const id = o.id || slug(o.title);
    if (o.idx !== false) note(id, o.title, o.keywords);
    const open = ctx.open.has(id) || (!!o.open && !ctx.closed.has(id));
    const ico = o.iconHtml ? `<span class="row-ico">${o.iconHtml}</span>` : o.icon ? `<span class="row-ico">${g(o.icon, 20)}</span>` : '';
    const desc = o.desc ? `<span class="row-desc">${o.descHtml ? o.desc : E(o.desc)}</span>` : '';
    return `<div class="st-exp ${open ? 'open' : ''}" data-row="${E(id)}">
      <div class="card-row st-row st-exp-head" data-exp="${E(id)}">${ico}<span class="row-text"><span class="row-title">${E(o.title)}</span>${desc}</span>
        <span class="row-end">${o.end || ''}<button class="icon-btn st-exp-btn" data-exp="${E(id)}" aria-expanded="${open}" aria-label="${E(o.title)}">${Win.glyph('chevdown', 16)}</button></span></div>
      <div class="st-exp-body">${o.body}</div></div>`;
  }

  /** Row nested inside an expander. */
  function sub(o) {
    const id = o.id || slug(o.title || '');
    if (o.title && o.idx !== false) note(id, o.title, o.keywords);
    if (o.html) return `<div class="st-sub ${o.cls || ''}" data-row="${E(id)}">${o.html}</div>`;
    return `<div class="st-sub ${o.cls || ''}" data-row="${E(id)}"><span class="row-text"><span class="row-title">${E(o.title)}</span>${o.desc ? `<span class="row-desc">${o.descHtml ? o.desc : E(o.desc)}</span>` : ''}</span>${o.end ? `<span class="row-end">${o.end}</span>` : ''}</div>`;
  }

  const sec = title => `<h2 class="st-sec">${E(title)}</h2>`;
  const tgl = (path, label, attrs = '') => Win.toggle(!!getPath(path), `data-set="${path}" ${attrs}`, label);
  const sel = (path, options, label, attrs = '') => Win.select(options, getPath(path), `data-set="${path}" aria-label="${E(label)}" ${attrs}`);
  const nsel = (path, options, label, attrs = '') => sel(path, options, label, `data-type="num" ${attrs}`);
  const range = (path, min, max, label, attrs = '') => `<input type="range" min="${min}" max="${max}" value="${E(getPath(path))}" data-set="${path}" data-live aria-label="${E(label)}" ${attrs}>`;
  const check = (path, label, attrs = '') => `<label class="check st-check"><input type="checkbox" data-set="${path}" ${getPath(path) ? 'checked' : ''} ${attrs}><span>${E(label)}</span></label>`;
  const btn = (label, act, attrs = '', cls = '') => `<button class="btn ${cls}" data-act="${act}" ${attrs}>${E(label)}</button>`;
  const link = (label, act, attrs = '') => `<button class="link st-link" data-act="${act}" ${attrs}>${E(label)}</button>`;
  const golink = (label, page, args) => `<button class="link st-link" data-go="${page}" ${args ? `data-args="${attrJSON(args)}"` : ''}>${E(label)}</button>`;
  const info = (kind, title, body = '', end = '') => `<div class="infobar st-info ${kind}" role="status">${g(kind === 'error' ? 'error' : kind === 'warning' ? 'warning' : kind === 'success' ? 'check' : 'info', 16)}<div class="st-info-text">${title ? `<strong>${E(title)}</strong> ` : ''}${body}</div>${end}</div>`;
  const related = rows => `${sec('Related settings')}${rows.join('')}`;
  const ext = (title, desc = '') => row({ title, desc, act: 'noop-ext', external: true, idx: false });
  const props = (pairs, copyAct = '') => `<div class="st-props">${pairs.filter(Boolean).map(([k, v]) => `<div class="st-prop"><span class="st-pk">${E(k)}:</span><span class="st-pv">${E(v)}</span></div>`).join('')}${copyAct ? `<div class="st-props-end">${btn('Copy', copyAct)}</div>` : ''}</div>`;
  const fmtDate = t => new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const fmtShort = t => new Date(t).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  const GB = b => `${(b / 1e9).toFixed(b >= 100e9 ? 0 : 1)} GB`;
  const hash = v => [...String(v)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  /** Read every [name] control in a dialog into a plain object. */
  function readForm(box) {
    const out = {};
    for (const el of box.querySelectorAll('[name]')) {
      const name = el.name || el.getAttribute?.('name');
      if (!name) continue;
      if (el.type === 'radio') { if (el.checked) out[name] = el.value; continue; }
      out[name] = el.type === 'checkbox' ? !!el.checked : String(el.value ?? '');
    }
    return out;
  }
  const field = (label, name, value = '', attrs = '') => `<label class="field"><span>${E(label)}</span><input class="input" name="${name}" value="${E(value)}" spellcheck="false" autocomplete="off" ${attrs}></label>`;
  const fieldSel = (label, name, options, value, attrs = '') => `<label class="field"><span>${E(label)}</span>${Win.select(options, value, `name="${name}" ${attrs}`)}</label>`;
  const fieldTgl = (label, name, on) => `<div class="st-dtgl"><span>${E(label)}</span>${Win.toggle(on, `name="${name}"`, label)}</div>`;
  const fieldCheck = (label, name, on) => `<label class="check st-dcheck"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span>${E(label)}</span></label>`;

  /** Enable a dialog's primary button only while `check(form)` returns ''. */
  function liveValidate(box, check) {
    const primary = box.querySelector('.dlg-actions .btn.accent');
    const run = () => { const problem = check(readForm(box)); if (primary) primary.disabled = !!problem; };
    box.addEventListener('input', run);
    box.addEventListener('change', run);
    run();
  }
  const showWhen = (box, name, map) => {
    const sync = () => {
      const f = readForm(box);
      for (const [selector, test] of Object.entries(map)) box.querySelectorAll(selector).forEach(el => el.classList.toggle('hidden', !test(f)));
    };
    box.addEventListener('change', sync);
    box.addEventListener('input', sync);
    sync();
  };

  /* ---------------------------------------------------------------- pages */

  const P = {};
  const page = (id, def) => { P[id] = { id, ...def }; };
  const live = new Set();          // open Settings contexts

  const NAV = [
    ['home', 'Home', 'home'], ['system', 'System', 'system'], ['bluetooth', 'Bluetooth & devices', 'bluetooth'],
    ['network', 'Network & internet', 'wifi4'], ['personalization', 'Personalization', 'brush'], ['apps', 'Apps', 'apps'],
    ['accounts', 'Accounts', 'person'], ['time', 'Time & language', 'language'], ['gaming', 'Gaming', 'game'],
    ['accessibility', 'Accessibility', 'access'], ['privacy', 'Privacy & security', 'shield'], ['update', 'Windows Update', 'update'],
  ];

  const titleOf = (id, args = {}) => { const d = P[id]; if (!d) return ''; return typeof d.title === 'function' ? d.title(args) : d.title; };
  const chain = id => { const out = []; let d = P[id]; while (d) { out.unshift(d.id); d = d.parent ? P[d.parent] : null; } return out; };
  const rootOf = id => chain(id)[0] || 'home';
  const iconOf = id => P[id]?.icon || NAV.find(n => n[0] === rootOf(id))?.[2] || 'gear';

  function crumbs(ctx) {
    const ids = chain(ctx.page);
    return ids.map((id, i) => {
      const last = i === ids.length - 1;
      const t = E(titleOf(id, last ? ctx.args : {}));
      return last ? `<span class="st-crumb cur" aria-current="page">${t}</span>`
        : `<button class="st-crumb" data-go="${id}">${t}</button><span class="st-crumb-sep" aria-hidden="true">${Win.glyph('chevright', 16)}</span>`;
    }).join('');
  }

  function makeCtx(win, pageId = 'home', args = {}) {
    return {
      win, page: pageId, args, uid: `st${Math.random().toString(36).slice(2, 8)}`, history: [], open: new Set(), closed: new Set(), timers: [],
      wf: { sel: '', stage: 'idle', error: '', auto: true, key: '' },
      appQuery: '', appSort: 'name', appFilter: 'all', drafts: {}, vpnBusy: '', vpnError: {}, flash: '',
    };
  }

  /** Markup for one page (header + body). Used by the window and by tests. */
  function renderPage(ctx) {
    const def = P[ctx.page] || P.home;
    return `<h1 class="st-title" tabindex="-1">${crumbs(ctx)}</h1><div class="st-body">${def.render(ctx)}</div>`;
  }

  Object.assign(Win.DefaultState.settings, {
    dndAuto: { times: false, duplicate: true, game: true, fullscreen: true, update: true },
    focusTimer: true, focusBadges: true, focusFlash: true,
    screenOffAC: '10 minutes', sleepAC: '30 minutes', saverBright: true, lidAction: 'Sleep', powerButton: 'Sleep',
    rememberWindows: true, minimizeOnDisconnect: true, snapHover: true, snapDragTop: true, snapNoEdge: true,
    desktopsTaskbar: 'On the desktop I\'m using only', fullPath: false, emptyDrives: false, psPolicy: false,
    clipSync: false, suggestedActions: true, troubleshooter: 'Ask me before running',
  });

  /* ------------------------------------------------------------ shared art */

  function wpCss(id) {
    try { return Win.Wallpapers?.css?.(id, 'Fill') || ''; } catch { return ''; }
  }
  const deskCss = () => wpCss(S().wallpaper) || 'linear-gradient(135deg, var(--accent-light), var(--accent-dark))';

  /** Mini desktop used by Home, System and Personalization previews. */
  const miniDesktop = (cls = '') => `<div class="st-mini ${cls}" aria-hidden="true" style="background:${E(deskCss())}">
    <div class="st-mini-win ${S().appTheme === 'dark' ? 'dk' : ''}"><i></i><i></i><i></i></div>
    <div class="st-mini-bar ${S().theme === 'dark' ? 'dk' : ''} ${S().taskbarAlign === 'left' ? 'left' : ''}"><b></b><b></b><b></b><b></b></div></div>`;

  function deviceHero(ctx, tiles = '') {
    note('rename-this-pc', 'Rename this PC', 'computer name hostname');
    return `<div class="st-hero" data-row="device">
      <div class="st-laptop" aria-hidden="true"><div class="st-laptop-screen">${miniDesktop('flat')}</div><div class="st-laptop-base"></div></div>
      <div class="st-hero-text"><div class="st-hero-name">${E(deviceName())}</div><div class="st-hero-sub">${E(Win.PERSONA.model)}</div>
        <button class="link st-link" data-act="rename-pc">Rename</button></div>
      ${tiles ? `<div class="st-hero-tiles">${tiles}</div>` : ''}</div>`;
  }

  const tile = (icon, title, desc, go, args) => `<button class="st-tile" data-go="${go}" ${args ? `data-args="${attrJSON(args)}"` : ''}>${g(icon, 20, 'st-tile-ico')}<span><span class="st-tile-title">${E(title)}</span><span class="st-tile-desc">${E(desc)}</span></span></button>`;

  function netTile() {
    const r = Win.Network.reason();
    const cur = Win.Network.current();
    if (!cur) return tile(r === 'airplane' ? 'airplane' : 'wifioff', 'Not connected', r === 'airplane' ? 'Airplane mode is on' : 'Wi-Fi', 'network');
    return tile(Win.Network.glyph(), cur.ssid, r ? 'No internet' : 'Connected, secured', 'network');
  }
  function updTile() {
    const u = U();
    const t = u.status === 'restart' ? 'Restart required' : u.status === 'uptodate' ? 'You\'re up to date' : 'Attention required';
    return tile('update', 'Windows Update', u.status === 'uptodate' ? `Last checked: ${relTime(u.lastChecked)}` : t, 'update');
  }
  function relTime(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }

  /* ------------------------------------------------------------------ Home */

  const devGlyph = kind => ({ mouse: 'mouse', headphones: 'headphones', printer: 'printer', phone: 'phone', keyboard: 'keyboard', speaker: 'speaker' }[kind] || 'bluetooth');

  page('home', {
    title: 'Home', icon: 'home', keywords: 'start overview',
    render(ctx) {
      const bt = Win.state.devices.filter(d => !d.network && d.kind !== 'printer');
      const recent = [['display', 'Display', 'display'], ['taskbar', 'Taskbar', 'taskview'], ['sound', 'Sound', 'sound'], ['mouse', 'Mouse', 'mouse']];
      return `${deviceHero(ctx, netTile() + updTile())}
      <div class="st-hgrid">
        <section class="st-hcard"><h3>Recommended settings</h3><p class="st-hdesc">Recent and commonly used settings</p>
          ${recent.map(([id, t, ic]) => `<button class="st-hrow" data-go="${id}">${g(ic, 16)}<span>${E(t)}</span>${chev}</button>`).join('')}</section>
        <section class="st-hcard"><h3>Cloud storage</h3><p class="st-hdesc">OneDrive</p>
          <div class="st-cloud"><div class="st-cloud-ico">${Win.appIcon('onedrive', 32)}</div><div><strong>2.94 GB</strong> used of 5 GB (59%)
          <div class="progress st-bar"><i style="width:59%"></i></div></div></div>
          <p class="st-hdesc">Your files are backed up and protected.</p><button class="btn" data-act="noop-ext">View details</button></section>
        <section class="st-hcard"><h3>Bluetooth devices</h3><p class="st-hdesc">Manage, add, and remove devices</p>
          <div class="st-hrow static">${g('bluetooth', 16)}<span>Bluetooth</span>${tgl('bluetooth', 'Bluetooth')}</div>
          ${bt.slice(0, 3).map(d => `<div class="st-hrow static">${g(devGlyph(d.kind), 16)}<span>${E(d.name)}<small>${d.connected ? 'Connected' : 'Paired'}${d.battery ? ` · ${d.battery}%` : ''}</small></span></div>`).join('')}
          <button class="link st-link" data-go="bluetooth">View all devices</button></section>
        <section class="st-hcard"><h3>Personalize your device</h3><p class="st-hdesc">Select a theme to apply</p>
          ${themeStrip()}
          <div class="st-hrow static">${g('moon', 16)}<span>Color mode</span>${Win.select([['light', 'Light'], ['dark', 'Dark']], S().theme, 'data-act="color-mode" aria-label="Color mode"')}</div>
          <button class="link st-link" data-go="personalization">Browse more backgrounds, colors, and themes</button></section>
      </div>`;
    },
  });

  /* ---------------------------------------------------------------- System */

  page('system', {
    title: 'System', icon: 'system',
    render(ctx) {
      const items = [
        ['display', 'display', 'Display', 'Monitors, brightness, night light, display profile'],
        ['sound', 'sound', 'Sound', 'Volume levels, output, input, sound devices'],
        ['notifications', 'bell', 'Notifications', 'Alerts from apps and system, do not disturb'],
        ['focus', 'focus', 'Focus', 'Reduce distractions'],
        ['power', 'power', 'Power & battery', 'Sleep, battery usage, energy saver'],
        ['storage', 'storage', 'Storage', 'Storage space, drives, configuration rules'],
        ['nearby', 'share', 'Nearby sharing', 'Discoverability, received files location'],
        ['multitasking', 'snap', 'Multitasking', 'Snap windows, desktops, task switching'],
        ['developers', 'terminal', 'For developers', 'These settings are intended for development use only'],
        ['activation', 'check', 'Activation', 'Activation state, subscriptions, product key'],
        ['troubleshoot', 'question', 'Troubleshoot', 'Recommended troubleshooters, preferences, history'],
        ['recovery', 'restart', 'Recovery', 'Reset, advanced startup, go back'],
        ['projecting', 'project', 'Projecting to this PC', 'Permissions, pairing PIN, discoverability'],
        ['remote-desktop', 'cast', 'Remote Desktop', 'Remote Desktop users, connection permissions'],
        ['clipboard', 'paste', 'Clipboard', 'Cut and copy history, sync, clear'],
        ['optional-features', 'apps', 'Optional features', 'Extra functionality for your device'],
        ['about', 'about', 'About', 'Device specifications, rename PC, Windows specifications'],
      ];
      return deviceHero(ctx, tile('cloud', 'OneDrive', 'Backing up files', 'accounts') + updTile())
        + items.map(([go, icon, title, desc]) => row({ go, icon, title, desc })).join('');
    },
  });

  /* --------------------------------------------------------------- Display */

  const RESOLUTIONS = ['1920 × 1080', '1680 × 1050', '1600 × 900', '1440 × 900', '1366 × 768', '1280 × 1024', '1280 × 720', '1024 × 768'];
  const TIMEOUTS = ['1 minute', '2 minutes', '3 minutes', '5 minutes', '10 minutes', '15 minutes', '20 minutes', '25 minutes', '30 minutes', '45 minutes', '1 hour', '2 hours', '3 hours', '4 hours', '5 hours', 'Never'];

  page('display', {
    title: 'Display', parent: 'system', icon: 'display', keywords: 'monitor screen brightness resolution scale',
    render(ctx) {
      const s = S();
      return `<div class="st-monitor" data-row="identify"><div class="st-monitor-box"><span>1</span></div><div class="st-monitor-act">${btn('Identify', 'identify')}</div></div>
      ${sec('Brightness & color')}
      ${exp(ctx, { id: 'brightness', icon: 'brightness', title: 'Brightness', desc: 'Adjust the brightness of the built-in display', keywords: 'dim screen',
        end: `<span class="st-range">${range('brightness', 0, 100, 'Brightness')}</span>`,
        body: sub({ html: check('autoBrightness', 'Change brightness automatically when lighting changes') }) + sub({ html: check('contentBrightness', 'Help improve battery by optimizing the content shown and brightness') }) })}
      ${row({ go: 'nightlight', icon: 'moon', title: 'Night light', desc: 'Use warmer colors to help block blue light', keywords: 'blue light warm', end: tgl('nightLight', 'Night light') })}
      ${row({ icon: 'sun', title: 'HDR', id: 'hdr', desc: 'Use HDR for brighter and more vibrant pictures and videos', keywords: 'high dynamic range', end: tgl('hdr', 'Use HDR') })}
      ${sec('Scale & layout')}
      ${row({ icon: 'zoomin', title: 'Scale', desc: 'Change the size of text, apps, and other items', keywords: 'dpi zoom size',
        end: Win.select([100, 125, 150, 175].map(v => [v, `${v}%${v === 125 ? ' (Recommended)' : ''}`]), s.scale, 'data-set="scale" data-type="num" aria-label="Scale"') })}
      ${row({ icon: 'view', title: 'Display resolution', desc: 'Adjust the resolution to fit your connected display', keywords: 'pixels',
        end: Win.select(RESOLUTIONS.map(r => [r, r === RESOLUTIONS[0] ? `${r} (Recommended)` : r]), s.resolution, 'data-act="display-keep" data-key="resolution" aria-label="Display resolution"') })}
      ${row({ icon: 'rotate', title: 'Display orientation', keywords: 'rotate portrait landscape',
        end: Win.select(['Landscape', 'Portrait', 'Landscape (flipped)', 'Portrait (flipped)'], s.orientation, 'data-act="display-keep" data-key="orientation" aria-label="Display orientation"') })}
      ${exp(ctx, { id: 'multiple-displays', icon: 'project', title: 'Multiple displays', desc: 'Choose the presentation mode for your displays', keywords: 'second monitor extend duplicate detect',
        body: sub({ html: check('rememberWindows', 'Remember window locations based on monitor connection') })
          + sub({ html: check('minimizeOnDisconnect', 'Minimize windows when a monitor is disconnected') })
          + sub({ title: 'Detect other display', desc: ctx.flash === 'detect' ? 'We didn\'t find another display.' : '', end: btn('Detect', 'detect-display') })
          + sub({ title: 'Connect to a wireless display', end: btn('Connect', 'cast') }) })}
      ${related([
        row({ go: 'advanced-display', icon: 'display', title: 'Advanced display', desc: 'Display information, refresh rate' }),
        row({ go: 'graphics', icon: 'shapes', title: 'Graphics', keywords: 'gpu' }),
      ])}`;
    },
    after(root) { Win.paintRanges(root); },
  });

  page('nightlight', {
    title: 'Night light', parent: 'display', icon: 'moon',
    render() {
      const on = S().nightLight;
      return `${row({ title: 'Turn on now', idx: false, end: `<button class="btn" data-act="night-now">${on ? 'Turn off now' : 'Turn on now'}</button>` })}
      ${row({ title: 'Strength', keywords: 'warmth', end: `<span class="st-range">${range('nightStrength', 0, 100, 'Night light strength')}</span>` })}
      ${row({ title: 'Schedule night light', desc: on ? 'Night light is on until 7:00 AM' : 'Night light will turn on at 9:00 PM', end: tgl('nightSchedule', 'Schedule night light') })}`;
    },
    after(root) { Win.paintRanges(root); },
  });

  page('advanced-display', {
    title: 'Advanced display', parent: 'display', icon: 'display',
    render() {
      const s = S();
      return `${sec('Display information')}
      <div class="card st-card">${props([['Internal display', 'Display 1: Connected to Intel(R) Arc(TM) 140V GPU'], ['Desktop mode', s.resolution], ['Active signal mode', s.resolution], ['Refresh rate (Hz)', `${s.refresh}.000 Hz`], ['Bit depth', '8-bit'], ['Color format', 'RGB'], ['Color space', s.hdr ? 'High dynamic range (HDR)' : 'Standard dynamic range (SDR)']])}</div>
      ${row({ icon: 'refresh', title: 'Choose a refresh rate', desc: 'A higher rate gives smoother motion, but also uses more power', keywords: 'hz',
        end: Win.select([[60, '60 Hz'], [120, '120 Hz']], s.refresh, 'data-act="display-keep" data-key="refresh" data-type="num" aria-label="Refresh rate"') })}
      ${row({ title: 'Dynamic refresh rate', desc: 'Windows automatically adjusts the refresh rate up to the selected rate to save power', end: tgl('dynamicRefresh', 'Dynamic refresh rate') })}`;
    },
  });

  page('graphics', {
    title: 'Graphics', parent: 'display', icon: 'shapes',
    render() {
      return `${row({ go: 'graphics', title: 'Change default graphics settings', idx: false })}
      ${sec('Custom options for apps')}
      ${row({ title: 'Add an app', end: Win.select(['Desktop app', 'Microsoft Store app'], 'Desktop app', 'aria-label="App type"') + btn('Browse', 'noop-ext') })}
      ${['Microsoft Edge', 'Photos', 'Media Player'].map(n => row({ title: n, desc: 'Let Windows decide (Power saving)', idx: false })).join('')}`;
    },
  });

  /* ----------------------------------------------------------------- Sound */

  function outputs() {
    const list = ['Speakers (Realtek(R) Audio)'];
    Win.state.devices.filter(d => d.kind === 'headphones' && d.connected).forEach(d => list.push(`Headphones (${d.name})`));
    if (!list.includes(S().output)) list.push(S().output);
    return list;
  }

  page('sound', {
    title: 'Sound', parent: 'system', icon: 'sound', keywords: 'volume audio speakers microphone',
    render(ctx) {
      const s = S();
      const volGlyph = s.muted ? 'mute' : s.volume === 0 ? 'vol0' : s.volume < 34 ? 'vol1' : s.volume < 67 ? 'vol2' : 'vol3';
      return `${sec('Output')}
      ${row({ icon: 'speaker', title: 'Choose where to play sound', desc: 'Apps might have their own settings', keywords: 'output device speakers headphones', end: sel('output', outputs(), 'Output device') })}
      ${row({ icon: 'sound', title: 'Volume', keywords: 'loudness mute', end: `<button class="icon-btn" data-act="mute" aria-label="${s.muted ? 'Unmute' : 'Mute'}" aria-pressed="${s.muted}">${g(volGlyph, 20)}</button><span class="st-range">${range('volume', 0, 100, 'Volume')}</span><span class="st-val" data-out="volume">${s.volume}</span>` })}
      ${row({ icon: 'plus', title: 'Pair a new output device', end: btn('Add device', 'add-device') })}
      ${row({ icon: 'headphones', title: 'Mono audio', desc: 'Combine left and right audio channels into one', end: tgl('monoAudio', 'Mono audio') })}
      ${sec('Input')}
      ${row({ icon: 'mic', title: 'Choose a device for speaking or recording', desc: 'Apps might have their own settings', keywords: 'microphone input', end: sel('input', ['Microphone Array (Intel® Smart Sound)', 'Headset Microphone (Galaxy Buds2 Pro)'], 'Input device') })}
      ${row({ icon: 'mic', title: 'Input volume', keywords: 'microphone level', end: `<span class="st-range">${range('micLevel', 0, 100, 'Input volume')}</span><span class="st-val" data-out="micLevel">${s.micLevel}</span>` })}
      ${sec('Advanced')}
      ${row({ icon: 'question', title: 'Troubleshoot common sound problems', end: btn('Output devices', 'troubleshoot', 'data-id="audio"') + btn('Input devices', 'troubleshoot', 'data-id="mic"') })}
      ${row({ go: 'sound-devices', icon: 'speaker', title: 'All sound devices', desc: 'Turn devices on or off, troubleshoot, other options' })}
      ${row({ go: 'volume-mixer', icon: 'sound', title: 'Volume mixer', desc: 'App volume mix, app input & output devices' })}
      ${row({ icon: 'sound', title: 'System sounds', desc: 'Play sounds for system events', end: tgl('systemSounds', 'System sounds') })}`;
    },
    after(root) { Win.paintRanges(root); },
  });

  page('sound-devices', {
    title: 'All sound devices', parent: 'sound', icon: 'speaker',
    render() {
      return `${sec('Output devices')}${outputs().map(o => row({ icon: o.startsWith('Head') ? 'headphones' : 'speaker', title: o, desc: o === S().output ? 'Default device' : '', idx: false })).join('')}
      ${sec('Input devices')}${row({ icon: 'mic', title: 'Microphone Array (Intel® Smart Sound)', desc: 'Default device', idx: false })}`;
    },
  });

  page('volume-mixer', {
    title: 'Volume mixer', parent: 'sound', icon: 'sound',
    render() {
      return `${sec('System')}${row({ icon: 'sound', title: 'Volume', idx: false, end: `<span class="st-range">${range('volume', 0, 100, 'Master volume')}</span><span class="st-val" data-out="volume">${S().volume}</span>` })}
      ${sec('Apps')}${['System sounds', 'Microsoft Edge'].map(n => row({ icon: 'sound', title: n, idx: false, end: `<span class="st-range"><input type="range" min="0" max="100" value="100" aria-label="${E(n)} volume"></span>` })).join('')}
      ${row({ title: 'Reset sound devices and volumes for all apps to the recommended defaults', idx: false, end: btn('Reset', 'noop-ext') })}`;
    },
    after(root) { Win.paintRanges(root); },
  });

  /* --------------------------------------------------------- Notifications */

  const NOTIFY_APPS = [['edge', 'Microsoft Edge'], ['store', 'Microsoft Store'], ['onedrive', 'OneDrive'], ['outlook', 'Outlook'], ['phonelink', 'Phone Link'], ['settings', 'Settings'], ['security', 'Windows Security'], ['teams', 'Microsoft Teams'], ['spotify', 'Spotify']];

  page('notifications', {
    title: 'Notifications', parent: 'system', icon: 'bell', keywords: 'alerts toast banners',
    render(ctx) {
      const s = S();
      return `${exp(ctx, { id: 'notifications-toggle', icon: 'bell', title: 'Notifications', desc: 'Get notifications from apps and other senders', keywords: 'alerts', end: tgl('notifications', 'Notifications'),
        body: sub({ html: check('notifySound', 'Allow notifications to play sounds') }) + sub({ html: check('notifyLock', 'Show notifications on the lock screen') }) })}
      ${row({ icon: 'belloff', title: 'Do not disturb', desc: 'Notifications will be sent directly to notification center', keywords: 'dnd quiet hours focus assist', end: tgl('dnd', 'Do not disturb') })}
      ${exp(ctx, { id: 'dnd-auto', icon: 'clock', title: 'Turn on do not disturb automatically', keywords: 'quiet hours schedule',
        body: [['times', 'During these times'], ['duplicate', 'When duplicating your display'], ['game', 'When playing a game'], ['fullscreen', 'When using an app in full-screen mode'], ['update', 'For the first hour after a Windows feature update']].map(([k, l]) => sub({ html: check(`dndAuto.${k}`, l) })).join('') })}
      ${row({ go: 'notifications', icon: 'star', title: 'Set priority notifications', idx: false })}
      ${sec('Notifications from apps and other senders')}
      ${NOTIFY_APPS.map(([k, n]) => row({ iconHtml: Win.appIcon(Win.appIcons[k] ? k : 'generic', 24), title: n, desc: s.notifications ? 'Banners, Sounds' : 'Off', idx: false, end: Win.toggle(s.notifications && s.appNotify[k] !== false, `data-set="appNotify.${k}" ${s.notifications ? '' : 'disabled'}`, n) })).join('')}
      ${sec('Additional settings')}
      <div class="card st-card st-checks">${check('tipsWelcome', 'Show the Windows welcome experience after updates and when signed in to show what\'s new and suggested')}${check('startTips', 'Get tips and suggestions when using Windows')}</div>`;
    },
  });

  /* ----------------------------------------------------------------- Focus */

  let focusTimer = null;
  function focusTick() {
    const s = S();
    if (!s.focusUntil) { clearInterval(focusTimer); focusTimer = null; return; }
    if (Date.now() >= s.focusUntil) { endFocus(true); return; }
    live.forEach(ctx => ctx.page === 'focus' && ctx.root && ctx.root.querySelectorAll('[data-focus-left]').forEach(el => { el.textContent = focusLeft(); }));
  }
  const focusLeft = () => { const ms = Math.max(0, S().focusUntil - Date.now()); const m = Math.floor(ms / 60000); const sec2 = Math.floor(ms / 1000) % 60; return `${m}:${String(sec2).padStart(2, '0')}`; };
  function startFocus() {
    const s = S();
    s.focusUntil = Date.now() + s.focusMinutes * 60000;
    if (s.focusDnd) { s.focusPrevDnd = s.dnd; s.dnd = true; }
    Win.save('state');
    if (!focusTimer) focusTimer = setInterval(focusTick, 1000);
  }
  function endFocus(finished) {
    const s = S();
    s.focusUntil = 0;
    if (s.focusDnd && s.focusPrevDnd !== undefined) { s.dnd = !!s.focusPrevDnd; delete s.focusPrevDnd; }
    clearInterval(focusTimer); focusTimer = null;
    Win.save('state');
    if (finished) Win.toast({ app: 'Clock', glyph: 'focus', title: 'Focus session complete', body: 'Nice work! Take a break.' });
  }

  page('focus', {
    title: 'Focus', parent: 'system', icon: 'focus', keywords: 'focus session concentrate timer',
    render(ctx) {
      const s = S();
      const active = s.focusUntil > Date.now();
      const hero = active
        ? `<div class="card st-card st-focus" data-row="focus-session"><div class="st-focus-time" data-focus-left>${focusLeft()}</div><p class="muted">Focus session in progress</p>${btn('Stop focus session', 'focus-stop')}</div>`
        : `<div class="card st-card st-focus" data-row="focus-session"><div class="st-stepper"><button class="icon-btn" data-act="focus-step" data-id="-5" aria-label="Decrease duration">${g('minimize', 16)}</button><span><strong>${s.focusMinutes}</strong> mins</span><button class="icon-btn" data-act="focus-step" data-id="5" aria-label="Increase duration">${g('plus', 16)}</button></div>${btn('Start focus session', 'focus-start', '', 'accent')}</div>`;
      note('focus-session', 'Focus session', 'start timer');
      return `${hero}
      ${exp(ctx, { id: 'focus-opts', icon: 'focus', title: 'Focus', desc: 'Changes the following settings when a focus session starts', open: true,
        body: sub({ html: check('focusTimer', 'Show the timer in the Clock app') }) + sub({ html: check('focusBadges', 'Hide badges on taskbar apps') }) + sub({ html: check('focusFlash', 'Hide flashing on taskbar apps') }) + sub({ html: check('focusDnd', 'Turn on do not disturb') }) })}
      ${related([row({ go: 'notifications', icon: 'bell', title: 'Notifications', desc: 'Do not disturb, priority notifications' })])}`;
    },
    after() { if (S().focusUntil && !focusTimer) focusTimer = setInterval(focusTick, 1000); },
  });

  /* --------------------------------------------------------- Power & battery */

  const batteryLevel = () => Win.Battery?.level ?? 78;

  page('power', {
    title: 'Power & battery', parent: 'system', icon: 'power', keywords: 'battery sleep energy saver power mode',
    render(ctx) {
      const lvl = batteryLevel();
      const charging = !!Win.Battery?.charging;
      const mins = Math.round(lvl * 3.6 * (S().batterySaver ? 1.25 : 1));
      const bars = Array.from({ length: 24 }, (_, i) => 30 + ((hash(`b${i}`) % 60)));
      return `<div class="card st-card st-battery" data-row="battery-level"><div class="st-batt-ico" aria-hidden="true"><i style="width:${lvl}%"></i></div>
        <div><div class="st-batt-pct">${lvl}%</div><div class="muted">${charging ? 'Charging' : `Estimated time remaining: ${Math.floor(mins / 60)} hours ${mins % 60} minutes`}</div></div>
        <div class="st-batt-chart" aria-hidden="true">${bars.map(b => `<i style="height:${b}%"></i>`).join('')}</div></div>
      ${sec('Power')}
      ${exp(ctx, { id: 'screen-sleep', icon: 'sleep', title: 'Screen, sleep, & hibernate timeouts', keywords: 'turn off screen sleep after',
        body: sub({ title: 'Turn my screen off after (on battery power)', id: 'screen-off', keywords: 'display timeout', end: sel('screenOff', TIMEOUTS, 'On battery power, turn off my screen after') })
          + sub({ title: 'Turn my screen off after (plugged in)', id: 'screen-off-ac', end: sel('screenOffAC', TIMEOUTS, 'When plugged in, turn off my screen after') })
          + sub({ title: 'Make my device sleep after (on battery power)', id: 'sleep-after', keywords: 'sleep timeout', end: sel('sleepAfter', TIMEOUTS, 'On battery power, put my device to sleep after') })
          + sub({ title: 'Make my device sleep after (plugged in)', id: 'sleep-ac', end: sel('sleepAC', TIMEOUTS, 'When plugged in, put my device to sleep after') }) })}
      ${row({ icon: 'advanced', title: 'Power Mode', desc: 'Optimize your device based on power use and performance', keywords: 'performance efficiency',
        end: sel('powerMode', [['Best Power Efficiency', 'Best power efficiency'], ['Balanced', 'Balanced'], ['Best Performance', 'Best performance']], 'Power mode') })}
      ${sec('Battery')}
      ${exp(ctx, { id: 'energy-saver', icon: 'saver', title: 'Energy saver', desc: 'Extend battery life and reduce energy use by limiting some background activities and Windows features', keywords: 'battery saver',
        end: tgl('batterySaver', 'Energy saver'),
        body: sub({ title: 'Turn energy saver on automatically', end: Win.select([[0, 'Never'], [10, '10%'], [20, '20%'], [30, '30%'], [40, '40%'], [50, '50%'], [100, 'Always']], S().batterySaverAuto, 'data-set="batterySaverAuto" data-type="num" aria-label="Turn energy saver on automatically"') })
          + sub({ html: check('saverBright', 'Lower screen brightness when using energy saver') }) })}
      ${exp(ctx, { id: 'lid-power', icon: 'power', title: 'Lid & power button controls', keywords: 'close lid',
        body: sub({ title: 'Closing the lid will make my PC', end: sel('lidAction', ['Do nothing', 'Sleep', 'Hibernate', 'Shut down'], 'Lid action') })
          + sub({ title: 'Pressing the power button will make my PC', end: sel('powerButton', ['Do nothing', 'Sleep', 'Hibernate', 'Shut down', 'Turn off the display'], 'Power button action') }) })}
      ${row({ go: 'power', icon: 'data', title: 'Battery usage', idx: false })}`;
    },
  });

  /* --------------------------------------------------------------- Storage */

  function storageModel() {
    const drive = Win.FS.get('c');
    const cap = drive?.capacity || 477e9;
    const used = Win.FS.used('c');
    const size = id => (Win.FS.get(id) ? Win.FS.size(id) : 0);
    const bin = Win.FS.children('bin', { hidden: true }).reduce((sum, n) => sum + Win.FS.size(n.id), 0);
    const cats = [
      ['System & reserved', 41.8e9, 'windows'],
      ['Apps & features', Win.state.apps.reduce((sum, a) => sum + (a.size || 0), 0), 'apps'],
      ['Temporary files', S().tempBytes || 0, 'trash'],
      ['Documents', size('documents'), 'document'],
      ['Pictures', size('pictures'), 'picture'],
      ['Videos', size('videos'), 'video'],
      ['Music', size('music'), 'music'],
      ['Desktop', size('desktop'), 'pc'],
      ['Recycle Bin', bin, 'trash'],
    ];
    const known = cats.reduce((sum, c) => sum + c[1], 0);
    cats.splice(3, 0, ['Other', Math.max(0, used - known), 'folder']);
    return { cap, used, free: cap - used, cats };
  }

  page('storage', {
    title: 'Storage', parent: 'system', icon: 'storage', keywords: 'disk space drive full',
    render(ctx) {
      const m = storageModel();
      const shown = ctx.drafts.storageMore ? m.cats : m.cats.slice(0, 4);
      const pct = m.used / m.cap * 100;
      return `<div class="card st-card st-storage" data-row="local-disk"><div class="st-storage-head"><strong>Local Disk (C:) - ${GB(m.cap)}</strong><span class="muted">${GB(m.used)} used</span></div>
        <div class="st-storebar ${pct > 90 ? 'full' : ''}"><i style="width:${pct.toFixed(1)}%"></i></div><div class="st-storage-free muted">${GB(m.free)} free</div>
        ${shown.map(([name, bytes, icon]) => `<div class="st-cat">${g(icon, 16)}<span class="st-cat-name">${E(name)}</span><span class="st-cat-bar"><i style="width:${Math.min(100, bytes / m.used * 100 * 2.2).toFixed(1)}%"></i></span><span class="st-cat-size">${E(Win.bytes(bytes))}</span></div>`).join('')}
        <button class="link st-link" data-act="storage-more">${ctx.drafts.storageMore ? 'Show fewer categories' : 'Show more categories'}</button></div>
      ${sec('Storage management')}
      ${row({ go: 'storage-sense', icon: 'storage', title: 'Storage Sense', desc: 'Automatically free up space, delete temporary files, and manage locally available cloud content', keywords: 'cleanup automatic', end: tgl('storageSense', 'Storage Sense') })}
      ${row({ go: 'cleanup', icon: 'trash', title: 'Cleanup recommendations', desc: 'Over 1.0 GB of storage is available', keywords: 'free up space temporary recycle bin' })}
      ${exp(ctx, { id: 'adv-storage', icon: 'advanced', title: 'Advanced storage settings', desc: 'Backup options, Storage Spaces, other disks and volumes',
        body: sub({ title: 'Storage used on other drives', desc: `USB Drive (E:) - ${GB(Win.FS.used('e'))} used of ${GB(Win.FS.get('e')?.capacity || 32e9)}` })
          + sub({ title: 'Where new content is saved', end: btn('Change', 'noop-ext') }) + sub({ title: 'Disks & volumes' }) + sub({ title: 'Backup options' }) + sub({ title: 'Drive optimization' }) })}`;
    },
  });

  const TEMP_PARTS = [['Windows Update Cleanup', 0.42], ['Delivery Optimization Files', 0.21], ['Temporary files', 0.2], ['Temporary Internet Files', 0.1], ['Thumbnails', 0.04], ['DirectX Shader Cache', 0.03]];

  page('cleanup', {
    title: 'Cleanup recommendations', parent: 'storage', icon: 'trash',
    render(ctx) {
      const temp = S().tempBytes || 0;
      const bin = Win.FS.children('bin', { hidden: true });
      const binBytes = bin.reduce((sum, n) => sum + Win.FS.size(n.id), 0);
      const large = Win.state.fs.filter(n => n.kind === 'file' && n.parent !== 'bin' && (n.size || 0) > 30e6 && !Win.FS.onRemovable(n.id));
      return `${exp(ctx, { id: 'temp-files', icon: 'trash', title: 'Temporary files', desc: temp ? `${Win.bytes(temp)} can be cleaned up` : 'No temporary files to clean up', open: true,
        body: (temp ? TEMP_PARTS.map(([n, f]) => sub({ html: `<span class="row-text"><span class="row-title">${E(n)}</span></span><span class="st-endtext">${E(Win.bytes(temp * f))}</span>`, idx: false })).join('') : '')
          + sub({ html: `<span class="row-text"></span>${btn(temp ? `Clean up ${Win.bytes(temp)}` : 'Clean up', 'clean-temp', temp ? '' : 'disabled', 'accent')}`, idx: false }) })}
      ${exp(ctx, { id: 'large-files', icon: 'file', title: 'Large or unused files', desc: large.length ? `${Win.bytes(large.reduce((s2, n) => s2 + n.size, 0))} in ${large.length} files` : 'None',
        body: large.map(n => sub({ idx: false, html: `<label class="check st-check"><input type="checkbox" data-act="large-pick" data-id="${E(n.id)}" ${ctx.drafts.large?.has(n.id) ? 'checked' : ''}><span>${E(n.name)}<small class="muted"> ${E(Win.FS.path(n.parent))}</small></span></label><span class="st-endtext">${E(Win.bytes(n.size))}</span>` })).join('')
          + sub({ idx: false, html: `<span class="row-text"></span>${btn('Clean up', 'clean-large', ctx.drafts.large?.size ? '' : 'disabled', 'accent')}` }) })}
      ${exp(ctx, { id: 'cleanup-bin', icon: 'trash', title: 'Recycle Bin', keywords: 'empty recycle bin', desc: binBytes ? `${Win.bytes(binBytes)} in ${bin.length} item${bin.length === 1 ? '' : 's'}` : 'Empty',
        body: sub({ idx: false, html: `<span class="row-text"><span class="row-desc">Files in the Recycle Bin are permanently deleted when you clean up.</span></span>${btn('Clean up', 'empty-bin', bin.length ? '' : 'disabled', 'accent')}` }) })}
      ${row({ icon: 'apps', title: 'Unused apps', desc: 'None', idx: false })}`;
    },
  });

  page('storage-sense', {
    title: 'Storage Sense', parent: 'storage', icon: 'storage',
    render(ctx) {
      return `${row({ title: 'Cleanup of temporary files', desc: 'Keep Windows running smoothly by automatically cleaning up temporary system and app files', end: '<label class="check"><input type="checkbox" checked disabled aria-label="Cleanup of temporary files"></label>' })}
      ${exp(ctx, { id: 'auto-cleanup', title: 'Automatic User content cleanup', open: true, end: tgl('storageSense', 'Automatic User content cleanup'),
        body: sub({ title: 'Run Storage Sense', end: sel('senseRun', ['Every day', 'Every week', 'Every month', 'During low free disk space (default)'], 'Run Storage Sense', 'data-default') })
          + sub({ title: 'Delete files in my recycle bin if they have been there for over', end: sel('senseBin', ['Never', '1 day', '14 days', '30 days (default)', '60 days'], 'Recycle bin age') })
          + sub({ title: 'Delete files in my Downloads folder if they haven\'t been opened for more than', end: sel('senseDownloads', ['Never (default)', '1 day', '14 days', '30 days', '60 days'], 'Downloads age') }) })}
      ${row({ title: 'Run Storage Sense now', end: btn('Run Storage Sense now', 'sense-now') })}`;
    },
  });
  Object.assign(Win.DefaultState.settings, { senseRun: 'During low free disk space (default)', senseBin: '30 days (default)', senseDownloads: 'Never (default)', tipsWelcome: true, contentBrightness: true, nightSchedule: false, dynamicRefresh: true });

  /* ----------------------------------------------------------- Multitasking */

  page('multitasking', {
    title: 'Multitasking', parent: 'system', icon: 'snap', keywords: 'snap alt tab desktops',
    render(ctx) {
      return `${exp(ctx, { id: 'snap-windows', icon: 'snap', title: 'Snap windows', keywords: 'snap layouts window arrange', end: tgl('snap', 'Snap windows'),
        body: [['snapAssist', 'When I snap a window, suggest what I can snap next to it'], ['snapLayouts', 'Show snap layouts when I hover over a window\'s maximize button'],
          ['snapDragTop', 'Show snap layouts when I drag a window to the top of my screen'], ['snapHover', 'Show my snapped windows when I hover over taskbar apps, in Task View, and when I press Alt+Tab'],
          ['snapNoEdge', 'When I drag a window, let me snap it without dragging all the way to the screen edge']].map(([k, l]) => sub({ html: check(k, l, S().snap ? '' : 'disabled') })).join('') })}
      ${exp(ctx, { id: 'desktops', icon: 'taskview', title: 'Desktops', keywords: 'virtual desktops',
        body: sub({ title: 'On the taskbar, show all the open windows', end: sel('desktopsTaskbar', ['On the desktop I\'m using only', 'On all desktops'], 'Desktops taskbar') }) })}
      ${row({ icon: 'tab', title: 'Show tabs from apps when snapping or pressing Alt+Tab', keywords: 'alt tab', end: sel('altTab', ['Open windows and 20 most recent tabs', 'Open windows and 5 most recent tabs', 'Open windows and 3 most recent tabs', 'Don\'t show tabs'], 'Alt+Tab tabs') })}
      ${row({ icon: 'restore', title: 'Title bar window shake', desc: 'When I grab a window\'s title bar and shake it, minimize all other windows', end: tgl('shake', 'Title bar window shake') })}`;
    },
  });

  /* ---------------------------------------------------------- For developers */

  page('developers', {
    title: 'For developers', parent: 'system', icon: 'terminal', keywords: 'advanced developer mode file explorer extensions hidden',
    render(ctx) {
      return `${row({ icon: 'terminal', title: 'Developer Mode', desc: 'Install apps from any source, including loose files', end: tgl('developerMode', 'Developer Mode') })}
      ${row({ icon: 'taskmgr', title: 'End task', desc: 'Enable end task in taskbar by right click', end: tgl('endTask', 'End task') })}
      ${exp(ctx, { id: 'file-explorer', icon: 'folder', title: 'File Explorer', desc: 'These settings change File Explorer to be more developer friendly', open: true, keywords: 'extensions hidden files',
        body: sub({ title: 'Show file extensions', id: 'file-extensions', keywords: 'file name extensions', end: tgl('fileExtensions', 'Show file extensions') })
          + sub({ title: 'Show hidden and system files', id: 'hidden-files', keywords: 'hidden items', end: tgl('hiddenFiles', 'Show hidden and system files') })
          + sub({ title: 'Show full path in title bar', end: tgl('fullPath', 'Show full path in title bar') })
          + sub({ title: 'Show empty drives', end: tgl('emptyDrives', 'Show empty drives') }) })}
      ${exp(ctx, { id: 'powershell', icon: 'terminal', title: 'PowerShell', desc: 'Turn on these settings to execute PowerShell scripts',
        body: sub({ title: 'Change execution policy to allow local PowerShell scripts to run without signing. Require signing for remote scripts.', end: tgl('psPolicy', 'PowerShell execution policy') }) })}
      ${row({ go: 'remote-desktop', icon: 'cast', title: 'Remote Desktop', desc: 'Enable Remote Desktop and ensure machine availability' })}
      ${row({ icon: 'terminal', title: 'Terminal', desc: 'Choose the default terminal app to host command-line apps', end: Win.select(['Let Windows decide', 'Windows Terminal', 'Windows Console Host'], 'Windows Terminal', 'aria-label="Default terminal"') })}`;
    },
  });

  /* ---------------------------------------------- Activation, troubleshoot … */

  page('activation', {
    title: 'Activation', parent: 'system', icon: 'check', keywords: 'product key license edition',
    render(ctx) {
      return `<div class="card st-card st-edition" data-row="edition">${Win.appIcon('windows', 40)}<div><strong>${E(Win.OS.name)}</strong></div></div>
      ${exp(ctx, { id: 'activation-state', icon: 'check', title: 'Activation state', end: '<span class="st-good">Active</span>', open: true,
        body: sub({ html: '<span class="row-text"><span class="row-desc">Windows is activated with a digital license linked to your Microsoft account</span></span>', idx: false }) })}
      ${exp(ctx, { id: 'upgrade-edition', icon: 'windows', title: 'Upgrade your edition of Windows', keywords: 'pro edition change product key',
        body: sub({ title: 'Upgrade in the Microsoft Store app', end: btn('Open Store', 'open-app', 'data-id="store"') })
          + sub({ title: 'Change product key', end: btn('Change', 'product-key') }) })}`;
    },
  });

  page('troubleshoot', {
    title: 'Troubleshoot', parent: 'system', icon: 'question', keywords: 'fix problems troubleshooter',
    render() {
      return `${row({ icon: 'question', title: 'Recommended troubleshooter preferences', end: sel('troubleshooter', ['Run automatically, don\'t notify me', 'Run automatically, then notify me', 'Ask me before running', 'Don\'t run any'], 'Recommended troubleshooter preferences') })}
      ${row({ go: 'troubleshoot', icon: 'history', title: 'Recommended troubleshooter history', idx: false })}
      ${row({ go: 'troubleshoot-other', icon: 'question', title: 'Other troubleshooters', keywords: 'network audio printer' })}`;
    },
  });

  const TROUBLESHOOTERS = [['network', 'wifi4', 'Network and Internet'], ['audio', 'sound', 'Audio'], ['printer', 'printer', 'Printer'], ['update', 'update', 'Windows Update'], ['bluetooth', 'bluetooth', 'Bluetooth'], ['camera', 'camera', 'Camera'], ['mic', 'mic', 'Recording Audio'], ['power', 'power', 'Power']];

  page('troubleshoot-other', {
    title: 'Other troubleshooters', parent: 'troubleshoot', icon: 'question',
    render() {
      return `${sec('Most frequent')}${TROUBLESHOOTERS.slice(0, 4).map(([id, icon, t]) => row({ icon, title: t, keywords: 'troubleshooter fix', end: btn('Run', 'troubleshoot', `data-id="${id}"`) })).join('')}
      ${sec('Other')}${TROUBLESHOOTERS.slice(4).map(([id, icon, t]) => row({ icon, title: t, idx: false, end: btn('Run', 'troubleshoot', `data-id="${id}"`) })).join('')}`;
    },
  });

  page('recovery', {
    title: 'Recovery', parent: 'system', icon: 'restart', keywords: 'reset this pc advanced startup',
    render() {
      return `${info('', '', 'If you\'re having problems with your PC or want to reset it, these recovery options might help.')}
      ${row({ go: 'troubleshoot', icon: 'question', title: 'Fix problems without resetting your PC', desc: 'Resetting can take a while—first, try resolving issues by running a troubleshooter' })}
      ${sec('Recovery options')}
      ${row({ icon: 'restart', title: 'Reset this PC', desc: 'Choose to keep or remove your personal files, then reinstall Windows', end: btn('Reset PC', 'reset-pc') })}
      ${row({ icon: 'history', title: 'Go back', desc: 'This option is no longer available on this PC', end: btn('Go back', 'noop', 'disabled') })}
      ${row({ icon: 'power', title: 'Advanced startup', desc: 'Restart your device to change startup settings, including starting from a disc or USB drive', end: btn('Restart now', 'advanced-startup') })}`;
    },
  });

  page('projecting', {
    title: 'Projecting to this PC', parent: 'system', icon: 'project',
    render() {
      return `${row({ title: 'Some Windows and Android devices can project to this PC when you say it\'s OK', end: sel('projectMode', ['Always off (Recommended)', 'Available everywhere', 'Available everywhere on secure networks'], 'Projecting availability') })}
      ${row({ title: 'Ask to project to this PC', end: sel('projectAsk', ['First time only', 'Every time a connection is requested'], 'Ask to project') })}
      ${row({ title: 'Require PIN for pairing', end: sel('projectPin', ['Never', 'First time', 'Always'], 'Require PIN') })}
      ${row({ title: 'PC name', desc: deviceName(), idx: false })}`;
    },
  });
  Object.assign(Win.DefaultState.settings, { projectMode: 'Always off (Recommended)', projectAsk: 'First time only', projectPin: 'Never' });

  page('remote-desktop', {
    title: 'Remote Desktop', parent: 'system', icon: 'cast', keywords: 'rdp remote access',
    render(ctx) {
      return `${exp(ctx, { id: 'rdp', icon: 'cast', title: 'Remote Desktop', desc: 'Connect to and use this PC from another device using the Remote Desktop app', end: Win.toggle(S().remoteDesktop, 'data-act="rdp"', 'Remote Desktop'),
        body: sub({ html: check('rdpNla', 'Require devices to use Network Level Authentication to connect (Recommended)') }) + sub({ title: 'Remote Desktop port', desc: '3389' }) })}
      ${row({ title: 'PC name', desc: deviceName(), end: btn('Copy', 'copy-text', `data-id="${E(deviceName())}"`), idx: false })}
      ${row({ icon: 'family', title: 'Remote Desktop users', desc: 'Select who can remotely access this PC', idx: false })}
      ${S().remoteDesktop || Win.OS.name.includes('Home') ? info('warning', '', `${E(Win.OS.name)} doesn't support hosting Remote Desktop connections. You can still use Remote Desktop to connect to other PCs.`) : ''}`;
    },
  });
  Object.assign(Win.DefaultState.settings, { rdpNla: true });

  page('clipboard', {
    title: 'Clipboard', parent: 'system', icon: 'paste', keywords: 'copy paste history win+v',
    render(ctx) {
      return `${row({ icon: 'history', title: 'Clipboard history', desc: 'Save multiple items to the clipboard to use later. Press the Windows logo key + V to view your clipboard history and paste from it.', end: tgl('clipboardHistory', 'Clipboard history') })}
      ${row({ icon: 'sparkle', title: 'Suggested actions', desc: 'Show suggestions for actions I can take with copied text', end: tgl('suggestedActions', 'Suggested actions') })}
      ${row({ icon: 'cloud', title: 'Clipboard history across your devices', desc: 'Sync clipboard content with your Microsoft account', end: tgl('clipSync', 'Clipboard history across your devices') })}
      ${row({ icon: 'trash', title: 'Clear clipboard data', desc: 'Clear everything (except pinned items) on this device and with Microsoft', end: `${ctx.flash === 'clip' ? g('check', 16, 'st-good') : ''}${btn('Clear', 'clear-clipboard')}` })}`;
    },
  });

  page('nearby', {
    title: 'Nearby sharing', parent: 'system', icon: 'share', keywords: 'share files nearby',
    render() {
      const v = S().nearbySharing;
      return `<div class="card st-card st-radios" data-row="nearby-mode" role="radiogroup" aria-label="Nearby sharing">
        ${['Off', 'My devices only', 'Everyone nearby'].map(o => `<label class="check"><input type="radio" name="st-nearby" data-set="nearbySharing" value="${E(o)}" ${v === o ? 'checked' : ''}><span>${E(o)}</span></label>`).join('')}</div>
      ${row({ icon: 'folder', title: 'Save files I receive to', desc: `C:\\Users\\${Win.PERSONA.user}\\Downloads`, end: btn('Change', 'noop-ext') })}
      ${row({ icon: 'pc', title: 'Rename your device to be more easily recognized by other devices', desc: deviceName(), end: btn('Rename', 'rename-pc'), idx: false })}`;
    },
  });

  page('optional-features', {
    title: 'Optional features', parent: 'system', icon: 'apps',
    render() {
      const list = [['Extended Theme Content', '5.21 MB'], ['Facial Recognition (Windows Hello)', '8.62 MB'], ['Notepad (system)', '700 KB'], ['OpenSSH Client', '10.1 MB'], ['Print Management', '1.04 MB'], ['Windows Media Player Legacy', '1.43 MB'], ['WMIC', '1.12 MB']];
      return `${row({ icon: 'plus', title: 'Add an optional feature', end: btn('View features', 'noop-ext', '', 'accent') })}
      ${row({ icon: 'history', title: 'See optional features history', idx: false })}
      ${sec('Added features')}${list.map(([n, sz]) => row({ title: n, idx: false, end: `<span class="st-endtext">${sz}</span>` })).join('')}`;
    },
  });

  /* ----------------------------------------------------------------- About */

  const SPECS = () => [
    ['Device name', deviceName()],
    ['Processor', 'Intel(R) Core(TM) Ultra 7 268V (2.20 GHz)'],
    ['Installed RAM', '32.0 GB (31.6 GB usable)'],
    ['Device ID', '8F3C2A71-5B4E-4D9A-A1C6-2E7B90F4D6C3'],
    ['Product ID', '00342-21004-58613-AAOEM'],
    ['System type', '64-bit operating system, x64-based processor'],
    ['Pen and touch', 'Pen and touch support with 10 touch points'],
  ];
  const installedOn = () => (Win.state.update.history.find(h => h.kind === 'Feature')?.date) || Date.now() - 22 * DAY;
  const WINSPECS = () => [
    ['Edition', Win.OS.name],
    ['Version', Win.OS.version],
    ['Installed on', fmtShort(installedOn())],
    ['OS build', Win.OS.build],
    ['Experience', 'Windows Feature Experience Pack 1000.26100.250.0'],
  ];

  page('about', {
    title: 'About', parent: 'system', icon: 'about', keywords: 'pc name specs version build processor ram',
    render(ctx) {
      return `${deviceHero(ctx)}
      ${exp(ctx, { id: 'device-specs', icon: 'pc', title: 'Device specifications', keywords: 'processor ram cpu memory system type', open: true, end: btn('Copy', 'copy-specs', 'data-id="device"'),
        body: sub({ html: props(SPECS()), idx: false }) + sub({ html: `<span class="st-rel">Related links</span>${link('Domain or workgroup', 'noop-ext')}${link('System protection', 'noop-ext')}${link('Advanced system settings', 'noop-ext')}`, idx: false }) })}
      ${exp(ctx, { id: 'windows-specs', icon: 'windows', title: 'Windows specifications', keywords: 'edition version build', open: true, end: btn('Copy', 'copy-specs', 'data-id="windows"'),
        body: sub({ html: props(WINSPECS()), idx: false }) + sub({ html: `${link('Microsoft Services Agreement', 'noop-ext')}${link('Microsoft Software License Terms', 'noop-ext')}`, idx: false }) })}
      ${related([
        row({ go: 'activation', icon: 'key', title: 'Product key and activation', desc: 'Change product key or upgrade your edition of Windows' }),
        row({ go: 'remote-desktop', icon: 'cast', title: 'Remote desktop', desc: 'Control this device from another device' }),
        row({ act: 'open-app', dataId: 'devmgmt', icon: 'devices', title: 'Device Manager', desc: 'Printer and other drivers, hardware properties', external: true }),
        row({ act: 'noop-ext', icon: 'lock', title: 'BitLocker', desc: 'Device encryption to help protect your data', external: true }),
      ])}`;
    },
  });

  function renamePC(name) {
    const v = String(name ?? '').trim();
    if (!v) return 'Enter a name for your PC.';
    if (v.length > 15) return 'Your PC name can be up to 15 characters long.';
    if (/[^A-Za-z0-9-]/.test(v)) return 'Your PC name can\'t contain spaces or any of these characters: ` ~ ! @ # $ % ^ & * ( ) = + _ [ ] { } \\ | ; : . \' " , < > / ?';
    if (/^\d+$/.test(v)) return 'Your PC name can\'t be only numbers.';
    S().deviceName = v === Win.PERSONA.computer ? '' : v;
    Win.save('state');
    return '';
  }

  /* ===================================================== Network & internet */

  Object.assign(Win.DefaultState.settings, {
    sharing: { privDiscovery: true, privFile: true, pubDiscovery: false, pubFile: false, publicFolder: false, passwordProtected: true },
  });

  const NETX = Win.Network;
  const secured = net => net && net.security !== 'Open';
  const usage = ssid => `${(4 + (hash(ssid) % 140) / 10).toFixed(1)} GB, last 30 days`;
  const linkSpeed = net => (/6E|6 \(/.test(net.protocol) ? '1201/1201' : /Wi-Fi 5/.test(net.protocol) ? '866/866' : '144/144');
  const encrypted = p => /^On/.test(p?.dnsEncryption || '');
  const DOH = ['Off', 'On (automatic template)', 'On (manual template)'];
  const DOH_KNOWN = new Set(['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9', '149.112.112.112', '2606:4700:4700::1111', '2606:4700:4700::1001', '2001:4860:4860::8888', '2001:4860:4860::8844', '2620:fe::fe']);

  function connectionLine(net) {
    if (!net) return '';
    const r = NETX.reason();
    const kind = secured(net) ? 'secured' : 'open';
    return r ? `No internet, ${kind}` : `Connected, ${kind}`;
  }

  page('network', {
    title: 'Network & internet', icon: 'wifi4', keywords: 'internet connection online offline status',
    render(ctx) {
      const n = N();
      const cur = NETX.current();
      const r = NETX.reason();
      const p = cur && NETX.profile(cur.ssid);
      const hero = cur
        ? `<div class="card st-card st-nethero" data-row="network-status"><div class="st-nethero-main">${g(NETX.glyph(), 40, 'st-nethero-ico')}
            <div><div class="st-nethero-name">Wi-Fi (${E(cur.ssid)})</div><div class="muted ${r ? 'st-warn' : ''}">${E(connectionLine(cur))}</div></div></div>
            <div class="st-nethero-act">
              <button class="st-tile" data-go="wifi-props" data-args="${attrJSON({ ssid: cur.ssid })}">${g('info', 20, 'st-tile-ico')}<span><span class="st-tile-title">Properties</span><span class="st-tile-desc">${E(p?.profile || 'Public')} network<br>${E(cur.band)}</span></span></button>
              <button class="st-tile" data-go="data-usage">${g('data', 20, 'st-tile-ico')}<span><span class="st-tile-title">Data usage</span><span class="st-tile-desc">${E(usage(cur.ssid))}</span></span></button>
            </div></div>`
        : `<div class="card st-card st-nethero" data-row="network-status"><div class="st-nethero-main">${g(r === 'airplane' ? 'airplane' : 'wifioff', 40, 'st-nethero-ico')}
            <div><div class="st-nethero-name">Not connected</div><div class="muted">${E({ airplane: 'Airplane mode is on', 'wifi-off': 'Wi-Fi is turned off', 'adapter-disabled': 'The Wi-Fi adapter is disabled' }[r] || 'You aren\'t connected to any networks')}</div></div></div>
            <div class="st-nethero-act">${r === 'disconnected' ? golink('Show available networks', 'wifi') : ''}</div></div>`;
      note('network-status', 'Network status', 'connected internet access');
      const wifiOn = n.wifi && !n.airplane;
      return `${hero}
      ${n.adapterEnabled.wifi ? row({ go: 'wifi', iconHtml: g(NETX.radioOn() ? 'wifi4' : 'wifioff', 20), title: 'Wi-Fi', desc: 'Connect, manage known networks, metered network', keywords: 'wireless wlan',
        end: Win.toggle(wifiOn, `data-act="wifi-toggle" ${n.airplane ? 'disabled' : ''}`, 'Wi-Fi') }) : ''}
      ${row({ go: 'vpn', icon: 'vpn', title: 'VPN', desc: 'Add, connect, manage', keywords: 'virtual private network' })}
      ${row({ go: 'hotspot', icon: 'hotspot', title: 'Mobile hotspot', desc: 'Share your internet connection', keywords: 'tethering', end: Win.toggle(n.hotspot, `data-act="hotspot" ${!n.hotspot && !NETX.online() ? 'disabled' : ''}`, 'Mobile hotspot') })}
      ${row({ go: 'airplane', icon: 'airplane', title: 'Airplane mode', desc: 'Stop all wireless communication', keywords: 'flight mode', end: Win.toggle(n.airplane, 'data-act="airplane"', 'Airplane mode') })}
      ${row({ go: 'proxy', icon: 'proxy', title: 'Proxy', desc: 'Proxy server for Wi-Fi and Ethernet connections', keywords: 'proxy server pac' })}
      ${row({ go: 'dialup', icon: 'phone', title: 'Dial-up', desc: 'Set up a dial-up internet connection' })}
      ${row({ go: 'advanced-network', icon: 'advanced', title: 'Advanced network settings', desc: 'View all network adapters, network reset', keywords: 'adapter reset' })}`;
    },
  });

  /* ---------------------------------------------------------------- Wi-Fi */

  function netItem(ctx, net) {
    const connected = N().connected === net.ssid && !!NETX.current();
    const open = ctx.wf.sel === net.ssid;
    const status = connected ? connectionLine(net) : secured(net) ? 'Secured' : 'Open';
    let body = '';
    if (open) {
      const err = ctx.wf.error ? `<p class="st-err" role="alert">${E(ctx.wf.error)}</p>` : '';
      if (connected) {
        body = `<div class="st-net-body">${golink('Properties', 'wifi-props', { ssid: net.ssid })}<span class="st-grow"></span>${btn('Disconnect', 'net-disconnect')}</div>`;
      } else if (ctx.wf.stage === 'busy') {
        body = `<div class="st-net-body"><div class="ring st-ring-sm" aria-hidden="true"></div><span class="muted">${NETX.profile(net.ssid) || !secured(net) ? 'Connecting' : 'Verifying and connecting'}</span></div>`;
      } else if (ctx.wf.stage === 'key') {
        body = `<div class="st-net-body col"><label class="st-keylabel" for="st-key-${ctx.uid}">Enter the network security key</label>
          <div class="st-keyrow"><input class="input" id="st-key-${ctx.uid}" type="password" data-act="net-key" data-enter="net-connect" data-id="${E(net.ssid)}" value="${E(ctx.wf.key)}" autocomplete="off" spellcheck="false">
          <button class="icon-btn" data-act="reveal" aria-label="Show characters">${g('eye', 16)}</button></div>${err}
          <div class="st-net-btns">${btn('Next', 'net-connect', `data-id="${E(net.ssid)}"`, 'accent')}${btn('Cancel', 'net-cancel')}</div></div>`;
      } else {
        body = `<div class="st-net-body col">${!secured(net) ? '<p class="st-note">Other people might be able to see info you send over this network</p>' : ''}${err}
          <div class="st-net-btns"><label class="check"><input type="checkbox" data-act="net-auto" ${ctx.wf.auto ? 'checked' : ''}><span>Connect automatically</span></label><span class="st-grow"></span>${btn('Connect', 'net-connect', `data-id="${E(net.ssid)}"`, 'accent')}</div></div>`;
      }
    }
    return `<div class="st-net ${open ? 'sel' : ''} ${connected ? 'on' : ''}" data-row="net-${E(slug(net.ssid))}">
      <button class="st-net-head" data-act="net-pick" data-id="${E(net.ssid)}" aria-expanded="${open}">${g(`wifi${net.signal}`, 20)}${secured(net) ? `<span class="st-net-lock">${g('lock2', 10)}</span>` : ''}
        <span class="row-text"><span class="row-title">${E(net.ssid)}</span><span class="row-desc">${E(status)}</span></span></button>${body}</div>`;
  }

  page('wifi', {
    title: 'Wi-Fi', parent: 'network', icon: 'wifi4', keywords: 'wireless wlan networks connect',
    render(ctx) {
      const n = N();
      const radio = NETX.radioOn();
      const cur = NETX.current();
      if (!n.adapterEnabled.wifi) {
        return info('warning', 'Wi-Fi adapter is disabled.', 'Turn it back on in Advanced network settings to see available networks.', golink('Advanced network settings', 'advanced-network'));
      }
      const nets = NETX.scan();
      const list = radio
        ? nets.map(net => netItem(ctx, net)).join('') + `<div class="st-sub st-net-foot">${btn('Refresh', 'net-refresh', '', 'subtle')}</div>`
        : sub({ idx: false, html: `<span class="row-desc">${n.airplane ? 'Airplane mode is on. Turn it off to see available networks.' : 'Turn on Wi-Fi to see available networks.'}</span>` });
      return `${row({ iconHtml: g(radio ? 'wifi4' : 'wifioff', 20), title: 'Wi-Fi', id: 'wifi-toggle', keywords: 'turn on off wireless', end: Win.toggle(n.wifi && !n.airplane, `data-act="wifi-toggle" ${n.airplane ? 'disabled' : ''}`, 'Wi-Fi') })}
      ${exp(ctx, { id: 'available-networks', icon: 'list', title: 'Show available networks', keywords: 'scan connect ssid', open: true, body: list })}
      ${cur ? row({ go: 'wifi-props', args: { ssid: cur.ssid }, icon: 'info', title: `${cur.ssid} properties`, id: 'current-props', keywords: 'ip address dns properties', desc: connectionLine(cur) }) : ''}
      ${row({ go: 'wifi-manage', icon: 'list', title: 'Manage known networks', desc: 'Add, remove, and edit networks', keywords: 'forget saved profiles' })}
      ${row({ go: 'wifi-hardware', icon: 'devices', title: 'Hardware properties', desc: 'View and manage Wi-Fi adapter properties', keywords: 'mac address driver adapter' })}
      ${row({ icon: 'privacy', title: 'Random hardware addresses', desc: 'Help protect your privacy by making it harder for people to track your device location when you connect to different Wi-Fi networks', keywords: 'mac randomization', end: tgl('network.randomMac', 'Random hardware addresses') })}`;
    },
  });

  page('wifi-manage', {
    title: 'Manage known networks', parent: 'wifi', icon: 'list', keywords: 'forget network saved wifi profiles',
    render(ctx) {
      const q = (ctx.drafts.knownQ || '').toLowerCase();
      const list = N().known.filter(k => k.ssid.toLowerCase().includes(q));
      if (ctx.drafts.knownSort === 'name') list.sort((a, b) => a.ssid.localeCompare(b.ssid));
      return `${row({ icon: 'plus', title: 'Add a new network', end: btn('Add network', 'add-network'), keywords: 'hidden network manual' })}
      <div class="st-toolbar"><input class="input st-filter" type="search" placeholder="Search" aria-label="Search known networks" data-act="known-q" value="${E(ctx.drafts.knownQ || '')}">
        <label class="st-inline">Sort by: ${Win.select([['pref', 'Preference'], ['name', 'Name']], ctx.drafts.knownSort || 'pref', 'data-act="known-sort" aria-label="Sort known networks"')}</label></div>
      ${list.length ? list.map(k => row({ go: 'wifi-props', args: { ssid: k.ssid }, icon: 'wifi4', title: k.ssid, idx: false, desc: N().connected === k.ssid ? 'Connected' : '',
        end: btn('Forget', 'forget', `data-id="${E(k.ssid)}"`) })).join('') : `<p class="muted st-empty">No known networks</p>`}`;
    },
  });

  const propsSsid = ctx => ctx.args.ssid || N().connected || N().known[0]?.ssid || '';

  function connectionProps(ssid) {
    const net = NETX.current();
    if (!net || net.ssid !== ssid) return null;
    const c = NETX.config();
    const p = NETX.profile(ssid);
    const v4 = c.dns.filter(NETX.validIPv4);
    const v6 = c.dns.filter(d => !NETX.validIPv4(d));
    const tag = encrypted(p) ? '(Encrypted)' : '(Unencrypted)';
    return [
      ['SSID', net.ssid],
      ['Protocol', net.protocol],
      ['Security type', net.security],
      ['Manufacturer', 'Intel Corporation'],
      ['Description', NETX.ADAPTER.description],
      ['Driver version', NETX.ADAPTER.driver],
      ['Network band', net.band],
      ['Network channel', String(net.channel)],
      ['Link speed (Receive/Transmit)', `${linkSpeed(net)} (Mbps)`],
      ['IPv6 address', ''],
      ['Link-local IPv6 address', c.ipv6],
      ['IPv6 DNS servers', v6.length ? v6.map(d => `${d} ${tag}`).join('\n') : ''],
      ['IPv4 address', c.ip],
      ['IPv4 DNS servers', v4.map(d => `${d} ${tag}`).join('\n')],
      ['Primary DNS suffix', c.suffix || ''],
      ['Physical address (MAC)', NETX.mac(ssid)],
    ].filter(([k, v]) => v || k === 'IPv4 DNS servers');
  }

  page('wifi-props', {
    title: args => args?.ssid || N()?.connected || 'Wi-Fi properties', parent: 'wifi', icon: 'wifi4',
    keywords: 'properties ip address dns server static manual dhcp mac metered public private',
    render(ctx) {
      const ssid = propsSsid(ctx);
      const p = NETX.profile(ssid);
      if (!p) return `${info('', '', 'This network isn\'t saved on this PC.')}${row({ go: 'wifi-manage', icon: 'list', title: 'Manage known networks', idx: false })}`;
      const cp = connectionProps(ssid);
      const net = NETX.lookup(ssid);
      const ipLines = p.ipMode === 'manual' ? `<span class="st-kv">IPv4 address: ${E(p.ip)}</span><span class="st-kv">IPv4 mask: ${E(p.mask)}</span>${p.gateway ? `<span class="st-kv">IPv4 gateway: ${E(p.gateway)}</span>` : ''}` : '';
      const dnsLines = p.dnsMode === 'manual' ? p.dns.map((d, i) => `<span class="st-kv">${NETX.validIPv4(d) ? 'IPv4' : 'IPv6'} DNS servers: ${E(d)} ${i === 0 && encrypted(p) ? '(Encrypted)' : '(Unencrypted)'}</span>`).join('') : '';
      const prof = p.profile === 'Private' ? 'Private' : 'Public';
      const sid = E(ssid);
      return `${row({ title: 'Connect automatically when in range', id: 'auto-connect', end: `<input type="checkbox" data-act="prof" data-key="auto" data-id="${sid}" ${p.auto ? 'checked' : ''} aria-label="Connect automatically when in range">` })}
      ${sec('Network profile type')}
      <div class="card st-card st-radios" role="radiogroup" aria-label="Network profile type" data-row="network-profile-type">
        <label class="st-radio"><input type="radio" name="st-prof-${ctx.uid}" value="Public" data-act="prof" data-key="profile" data-id="${sid}" ${prof === 'Public' ? 'checked' : ''}><span><strong>Public network (Recommended)</strong><small>Your device is not discoverable on the network. Use this in most cases—when connected to a network at home, work, or in a public place.</small></span></label>
        <label class="st-radio"><input type="radio" name="st-prof-${ctx.uid}" value="Private" data-act="prof" data-key="profile" data-id="${sid}" ${prof === 'Private' ? 'checked' : ''}><span><strong>Private network</strong><small>Your device is discoverable on the network. Select this if you need file sharing or use apps that communicate over this network. You should know and trust the people and devices on the network.</small></span></label>
        ${golink('Configure firewall and security settings', 'security')}</div>
      ${note('network-profile-type', 'Network profile type', 'public private discoverable') || ''}
      ${row({ title: 'Metered connection', desc: 'Some apps might work differently to reduce data usage when you\'re connected to this network', keywords: 'data limit',
        end: Win.toggle(!!p.metered, `data-act="prof" data-key="metered" data-id="${sid}"`, 'Metered connection') })}
      ${row({ title: 'Set a data limit to help control data usage on this network', go: 'data-usage', idx: false })}
      ${row({ title: 'Random hardware addresses', desc: 'Help protect your privacy by making it harder for people to track your device location when you connect to this network. The setting takes effect the next time you connect to this network.', keywords: 'mac randomization',
        id: 'random-mac-net', end: Win.select(['Off', 'On', 'Change daily'], p.randomMac, `data-act="prof" data-key="randomMac" data-id="${sid}" aria-label="Random hardware addresses"`) })}
      ${row({ title: 'IP assignment:', id: 'ip-assignment', keywords: 'static ip manual dhcp address subnet gateway', descHtml: true,
        desc: `<span class="st-kv">${p.ipMode === 'manual' ? 'Manual' : 'Automatic (DHCP)'}</span>${ipLines}`, end: btn('Edit', 'edit-ip', `data-id="${sid}"`) })}
      ${row({ title: 'DNS server assignment:', id: 'dns-assignment', keywords: 'dns server resolver doh encrypted', descHtml: true,
        desc: `<span class="st-kv">${p.dnsMode === 'manual' ? 'Manual' : 'Automatic (DHCP)'}</span>${dnsLines}`, end: btn('Edit', 'edit-dns', `data-id="${sid}"`) })}
      ${cp ? `<div class="card st-card" data-row="connection-properties">${props(cp, 'copy-props')}</div>` : ''}
      ${net && secured(net) ? row({ icon: 'key', title: 'View Wi-Fi security key', id: 'security-key', keywords: 'password', end: btn('View', 'view-key', `data-id="${sid}"`) }) : ''}`;
    },
  });

  page('wifi-hardware', {
    title: 'Hardware properties', parent: 'wifi', icon: 'devices', keywords: 'adapter driver mac',
    render() {
      const cur = NETX.current();
      const hw = [['Manufacturer', 'Intel Corporation'], ['Description', NETX.ADAPTER.description], ['Driver version', NETX.ADAPTER.driver], ['Physical address (MAC)', NETX.ADAPTER.mac]];
      return `<div class="card st-card" data-row="adapter-props">${props(cur ? connectionProps(cur.ssid) : hw, 'copy-props')}</div>
      ${row({ go: 'advanced-network', icon: 'advanced', title: 'Advanced network settings', idx: false })}`;
    },
  });

  /* -------------------------------------------- IP and DNS edit dialogs */

  const contiguousMask = mask => {
    if (!NETX.validIPv4(mask)) return false;
    const bits = mask.split('.').map(n => Number(n).toString(2).padStart(8, '0')).join('');
    return /^1+0*$/.test(bits) && bits !== '1'.repeat(32);
  };

  /** Returns '' when the IP form is complete and valid. */
  function checkIP(f) {
    if (f.mode !== 'manual') return '';
    if (f.v4 === false && f.v6 !== true) return 'Turn on IPv4 or IPv6.';
    if (f.v4 === false) return '';
    if (!NETX.validIPv4(f.ip)) return 'Enter a valid IP address.';
    if (!contiguousMask((f.mask || '').trim())) return 'Enter a valid subnet mask.';
    if ((f.gateway || '').trim() && !NETX.validIPv4(f.gateway)) return 'Enter a valid gateway.';
    if ((f.dns1 || '').trim() && !NETX.validIPv4(f.dns1)) return 'Enter a valid preferred DNS address.';
    if ((f.dns2 || '').trim() && !NETX.validIPv4(f.dns2)) return 'Enter a valid alternate DNS address.';
    return '';
  }

  function applyIP(ssid, f) {
    const problem = checkIP(f);
    if (problem) return problem;
    if (f.mode !== 'manual') return NETX.saveIP(ssid, { ipMode: 'dhcp' });
    const patch = { ipMode: 'manual', ip: f.ip.trim(), mask: f.mask.trim(), gateway: (f.gateway || '').trim() };
    const dns = [f.dns1, f.dns2].map(v => (v || '').trim()).filter(Boolean);
    if (dns.length) Object.assign(patch, { dnsMode: 'manual', dns, dnsEncryption: f.doh1 || 'Off' });
    return NETX.saveIP(ssid, patch);
  }

  function editIP(ssid, owner) {
    const p = NETX.profile(ssid);
    if (!p) return Promise.resolve(null);
    const c = N().connected === ssid ? NETX.config() : null;
    const manual = p.ipMode === 'manual';
    const v = { ip: manual ? p.ip : '', mask: manual ? p.mask : '', gateway: manual ? p.gateway : '', dns1: p.dnsMode === 'manual' ? (p.dns[0] || '') : '', dns2: p.dnsMode === 'manual' ? (p.dns[1] || '') : '' };
    const body = `${fieldSel('Edit IP settings', 'mode', [['dhcp', 'Automatic (DHCP)'], ['manual', 'Manual']], manual ? 'manual' : 'dhcp')}
      <div class="st-man">${fieldTgl('IPv4', 'v4', true)}
        <div class="st-v4">${field('IP address', 'ip', v.ip, `placeholder="${E(c ? c.ip : '')}"`)}${field('Subnet mask', 'mask', v.mask || '255.255.255.0')}${field('Gateway', 'gateway', v.gateway)}
        ${field('Preferred DNS', 'dns1', v.dns1)}${fieldSel('DNS over HTTPS', 'doh1', DOH, encrypted(p) ? p.dnsEncryption : 'Off')}${field('Alternate DNS', 'dns2', v.dns2)}</div>
        ${fieldTgl('IPv6', 'v6', false)}</div>`;
    return Win.dialog({
      title: `Edit IP settings`, owner, body, width: 480,
      buttons: [{ label: 'Save', primary: true, value: true, validate: box => applyIP(ssid, readForm(box)) }, { label: 'Cancel', value: null }],
      onRender(box) {
        showWhen(box, 'mode', { '.st-man': f => f.mode === 'manual', '.st-v4': f => f.v4 !== false });
        liveValidate(box, checkIP);
      },
    });
  }

  function checkDNS(f) {
    if (f.mode !== 'manual') return '';
    const v4 = [f.dns1, f.dns2].map(x => (x || '').trim());
    const v6 = [f.dns6a, f.dns6b].map(x => (x || '').trim());
    if (f.v4 === false && f.v6 !== true) return 'Turn on IPv4 or IPv6.';
    if (f.v4 !== false) {
      if (!v4[0]) return 'Enter a preferred DNS server.';
      const bad = v4.find(d => d && !NETX.validIPv4(d));
      if (bad) return `"${bad}" isn't a valid IPv4 address.`;
      if (f.doh1 === 'On (automatic template)' && !DOH_KNOWN.has(v4[0])) return 'There\'s no DNS over HTTPS template for this server. Choose On (manual template) and enter a template.';
      if (f.doh1 === 'On (manual template)' && !/^https:\/\/[^\s/]+\/\S*$/i.test((f.tpl1 || '').trim())) return 'Enter a valid DNS over HTTPS template, such as https://dns.example/dns-query';
    }
    if (f.v6 === true) {
      if (!v6[0]) return 'Enter a preferred IPv6 DNS server.';
      const bad = v6.find(d => d && !NETX.validIPv6(d));
      if (bad) return `"${bad}" isn't a valid IPv6 address.`;
    }
    return '';
  }

  function applyDNS(ssid, f) {
    const problem = checkDNS(f);
    if (problem) return problem;
    if (f.mode !== 'manual') return NETX.saveIP(ssid, { dnsMode: 'auto', dns: [], dnsEncryption: 'Unencrypted only' });
    const dns = [];
    if (f.v4 !== false) dns.push(...[f.dns1, f.dns2].map(x => (x || '').trim()).filter(Boolean));
    if (f.v6 === true) dns.push(...[f.dns6a, f.dns6b].map(x => (x || '').trim()).filter(Boolean));
    return NETX.saveIP(ssid, { dnsMode: 'manual', dns, dnsEncryption: f.v4 !== false ? (f.doh1 || 'Off') : 'Off', dohTemplate: (f.tpl1 || '').trim(), dohFallback: !!f.fb1 });
  }

  function editDNS(ssid, owner) {
    const p = NETX.profile(ssid);
    if (!p) return Promise.resolve(null);
    const manual = p.dnsMode === 'manual';
    const d4 = manual ? p.dns.filter(NETX.validIPv4) : [];
    const d6 = manual ? p.dns.filter(d => !NETX.validIPv4(d)) : [];
    const body = `${fieldSel('Edit DNS settings', 'mode', [['auto', 'Automatic (DHCP)'], ['manual', 'Manual']], manual ? 'manual' : 'auto')}
      <div class="st-man">${fieldTgl('IPv4', 'v4', !manual || d4.length > 0 || !d6.length)}
        <div class="st-v4">${field('Preferred DNS', 'dns1', d4[0] || '')}${fieldSel('DNS over HTTPS', 'doh1', DOH, encrypted(p) ? p.dnsEncryption : 'Off')}
          <div class="st-tpl">${field('DNS over HTTPS template', 'tpl1', p.dohTemplate || '')}${fieldCheck('Fallback to plaintext', 'fb1', !!p.dohFallback)}</div>
          ${field('Alternate DNS', 'dns2', d4[1] || '')}</div>
        ${fieldTgl('IPv6', 'v6', d6.length > 0)}
        <div class="st-v6">${field('Preferred DNS', 'dns6a', d6[0] || '')}${field('Alternate DNS', 'dns6b', d6[1] || '')}</div></div>`;
    return Win.dialog({
      title: 'Edit DNS settings', owner, body, width: 480,
      buttons: [{ label: 'Save', primary: true, value: true, validate: box => applyDNS(ssid, readForm(box)) }, { label: 'Cancel', value: null }],
      onRender(box) {
        showWhen(box, 'mode', { '.st-man': f => f.mode === 'manual', '.st-v4': f => f.v4 !== false, '.st-v6': f => f.v6 === true, '.st-tpl': f => f.doh1 === 'On (manual template)' });
        liveValidate(box, checkDNS);
      },
    });
  }

  /* ----------------------------------------------------------------- Proxy */

  page('proxy', {
    title: 'Proxy', parent: 'network', icon: 'proxy', keywords: 'proxy server pac script lan',
    render() {
      const p = N().proxy;
      return `${sec('Automatic proxy setup')}
      ${row({ title: 'Automatically detect settings', keywords: 'wpad auto detect', end: tgl('network.proxy.autoDetect', 'Automatically detect settings') })}
      ${row({ title: 'Use setup script', id: 'setup-script', keywords: 'pac file script address', desc: p.useScript ? p.script : '', end: `<span class="st-endtext">${p.useScript ? 'On' : 'Off'}</span>${btn('Set up', 'proxy-script')}` })}
      ${sec('Manual proxy setup')}
      ${row({ title: 'Use a proxy server', id: 'manual-proxy', keywords: 'proxy address port bypass', desc: p.manual ? `${p.address}${p.port ? `:${p.port}` : ''}` : '', end: `<span class="st-endtext">${p.manual ? 'On' : 'Off'}</span>${btn(p.manual ? 'Edit' : 'Set up', 'proxy-manual')}` })}`;
    },
  });

  function checkProxyScript(f) {
    if (!f.on) return '';
    const v = (f.script || '').trim();
    if (!v) return 'Enter a script address.';
    if (!/^(https?|file):\/\/\S+$/i.test(v)) return 'Enter a valid script address, such as http://proxy.example/proxy.pac';
    return '';
  }
  function applyProxyScript(f) {
    const problem = checkProxyScript(f);
    if (problem) return problem;
    Object.assign(N().proxy, { useScript: !!f.on, script: (f.script || '').trim() });
    Win.save('network');
    return '';
  }
  function checkProxyManual(f) {
    if (!f.on) return '';
    if (!(f.address || '').trim()) return 'Enter a proxy IP address.';
    if (/\s/.test(f.address.trim())) return 'The proxy address can\'t contain spaces.';
    const port = Number(f.port);
    if (!/^\d+$/.test(String(f.port || '').trim()) || port < 1 || port > 65535) return 'Enter a valid port number between 1 and 65535.';
    return '';
  }
  function applyProxyManual(f) {
    const problem = checkProxyManual(f);
    if (problem) return problem;
    Object.assign(N().proxy, { manual: !!f.on, address: (f.address || '').trim(), port: String(f.port || '').trim(), bypass: (f.bypass || '').trim(), local: !!f.local });
    Win.save('network');
    return '';
  }

  const proxyScriptDialog = owner => {
    const p = N().proxy;
    return Win.dialog({
      title: 'Edit setup script', owner, width: 480,
      body: `${fieldTgl('Use setup script', 'on', p.useScript)}${field('Script address', 'script', p.script, 'placeholder="http://"')}`,
      buttons: [{ label: 'Save', primary: true, value: true, validate: box => applyProxyScript(readForm(box)) }, { label: 'Cancel', value: null }],
      onRender: box => liveValidate(box, checkProxyScript),
    });
  };
  const proxyManualDialog = owner => {
    const p = N().proxy;
    return Win.dialog({
      title: 'Edit proxy server', owner, width: 520,
      body: `${fieldTgl('Use a proxy server', 'on', p.manual)}
        <div class="st-row2">${field('Proxy IP address', 'address', p.address)}${field('Port', 'port', p.port, 'inputmode="numeric"')}</div>
        <label class="field"><span>Use the proxy server except for addresses that start with the following entries. Use semicolons (;) to separate entries.</span><textarea class="input" name="bypass" rows="3" spellcheck="false">${E(p.bypass)}</textarea></label>
        ${fieldCheck('Don\'t use the proxy server for local (intranet) addresses', 'local', p.local)}`,
      buttons: [{ label: 'Save', primary: true, value: true, validate: box => applyProxyManual(readForm(box)) }, { label: 'Cancel', value: null }],
      onRender: box => liveValidate(box, checkProxyManual),
    });
  };

  /* ------------------------------------------------------------------- VPN */

  page('vpn', {
    title: 'VPN', parent: 'network', icon: 'vpn', keywords: 'virtual private network connect add',
    render(ctx) {
      const vpns = N().vpns;
      return `${row({ icon: 'vpn', title: 'VPN connections', id: 'vpn-connections', end: btn('Add VPN', 'add-vpn', '', 'accent') })}
      ${vpns.map((v, i) => {
        const busy = ctx.vpnBusy === v.name;
        const err = ctx.vpnError[v.name];
        return exp(ctx, { id: `vpn-${slug(v.name)}`, icon: 'vpn', title: v.name, idx: false, desc: busy ? 'Connecting…' : v.connected ? 'Connected' : '',
          end: busy ? '<div class="ring st-ring-sm" aria-hidden="true"></div>' : btn(v.connected ? 'Disconnect' : 'Connect', 'vpn-connect', `data-id="${i}"`),
          body: (err ? sub({ idx: false, html: `<p class="st-err" role="alert">${E(err)}</p>` }) : '')
            + sub({ idx: false, title: 'Server name or address', desc: v.server })
            + sub({ idx: false, title: 'VPN type', desc: v.type })
            + sub({ idx: false, html: `<span class="row-text"><span class="row-title">Remove this VPN connection</span></span>${btn('Remove', 'vpn-remove', `data-id="${i}"`)}` }) });
      }).join('')}
      ${sec('Advanced settings for all VPN connections')}
      ${row({ title: 'Allow VPN over metered networks', end: tgl('network.vpnMetered', 'Allow VPN over metered networks') })}
      ${row({ title: 'Allow VPN while roaming', end: tgl('network.vpnRoaming', 'Allow VPN while roaming') })}`;
    },
  });

  async function vpnConnect(ctx, i) {
    const v = N().vpns[i];
    if (!v || ctx.vpnBusy) return;
    if (v.connected) { v.connected = false; Win.save('network'); return; }
    ctx.vpnBusy = v.name;
    ctx.vpnError[v.name] = '';
    ctx.open.add(`vpn-${slug(v.name)}`);
    repaint(ctx);
    await Win.wait(1400);
    ctx.vpnBusy = '';
    const r = NETX.reason();
    const metered = NETX.profile(N().connected)?.metered && !N().vpnMetered;
    let error = '';
    if (['airplane', 'wifi-off', 'adapter-disabled', 'disconnected'].includes(r)) error = 'Can\'t connect. Check your network connection and try again.';
    else if (metered) error = 'VPN is turned off because you\'re on a metered network. To connect, allow VPN over metered networks.';
    else if (r === 'no-dns' || !NETX.resolve(v.server).ok) error = 'The remote connection was not made because the name of the remote access server did not resolve.';
    else if (r) error = 'The network connection between your computer and the VPN server could not be established because the remote server is not responding.';
    else if (!/^vpn\.support\.example$/i.test(v.server.trim())) error = 'The remote connection was not made because the attempted VPN tunnels failed. The VPN server might be unreachable.';
    if (error) { ctx.vpnError[v.name] = error; repaint(ctx); return; }
    N().vpns.forEach(x => { x.connected = false; });
    v.connected = true;
    Win.save('network');
  }

  function addVpnDialog(owner) {
    const check2 = f => {
      if (!(f.name || '').trim()) return 'Enter a connection name.';
      if (N().vpns.some(v => v.name.toLowerCase() === f.name.trim().toLowerCase())) return 'A VPN connection with this name already exists.';
      if (!(f.server || '').trim()) return 'Enter a server name or address.';
      return '';
    };
    return Win.dialog({
      title: 'Add a VPN connection', owner, width: 480,
      body: `${fieldSel('VPN provider', 'provider', ['Windows (built-in)'], 'Windows (built-in)')}${field('Connection name', 'name')}${field('Server name or address', 'server')}
        ${fieldSel('VPN type', 'type', ['Automatic', 'Point to Point Tunneling Protocol (PPTP)', 'L2TP/IPsec with certificate', 'L2TP/IPsec with pre-shared key', 'Secure Socket Tunneling Protocol (SSTP)', 'IKEv2'], 'Automatic')}
        ${fieldSel('Type of sign-in info', 'signin', ['User name and password', 'Smart card', 'One-time password', 'Certificate'], 'User name and password')}
        ${field('User name (optional)', 'user')}${field('Password (optional)', 'pass', '', 'type="password"')}${fieldCheck('Remember my sign-in info', 'remember', true)}`,
      buttons: [{ label: 'Save', primary: true, value: box => readForm(box), validate: box => check2(readForm(box)) }, { label: 'Cancel', value: null }],
      onRender: box => liveValidate(box, check2),
    }).then(f => {
      if (!f) return;
      N().vpns.push({ name: f.name.trim(), server: f.server.trim(), type: f.type, signIn: f.signin, user: (f.user || '').trim(), connected: false });
      Win.save('network');
    });
  }

  /* ------------------------------------------------------------- Hotspot */

  page('hotspot', {
    title: 'Mobile hotspot', parent: 'network', icon: 'hotspot', keywords: 'tethering share internet connection',
    render(ctx) {
      const n = N();
      const can = NETX.online();
      return `${row({ icon: 'hotspot', title: 'Mobile hotspot', id: 'hotspot-toggle', desc: !can && !n.hotspot ? 'We can\'t set up mobile hotspot because your PC doesn\'t have an Ethernet, Wi-Fi, or cellular data connection.' : '',
        end: Win.toggle(n.hotspot, `data-act="hotspot" ${!can && !n.hotspot ? 'disabled' : ''}`, 'Mobile hotspot') })}
      ${row({ title: 'Share my internet connection from', end: Win.select(['Wi-Fi'], 'Wi-Fi', 'aria-label="Share my internet connection from"') })}
      ${row({ title: 'Share over', end: sel('network.hotspotOver', ['Wi-Fi', 'Bluetooth'], 'Share over') })}
      ${exp(ctx, { id: 'hotspot-props', title: 'Properties', keywords: 'hotspot name password band', open: true, end: btn('Edit', 'hotspot-edit'),
        body: sub({ idx: false, html: props([['Name', n.hotspotName], ['Password', n.hotspotPass], ['Band', n.hotspotBand], ['Devices connected', `0 of 8`]]) }) })}
      ${row({ title: 'Power saving', desc: 'When no devices are connected, automatically turn off mobile hotspot', end: tgl('network.hotspotSaver', 'Power saving') })}`;
    },
  });

  function hotspotDialog(owner) {
    const n = N();
    const check2 = f => {
      if (!(f.name || '').trim()) return 'Enter a network name.';
      if ((f.name || '').length > 32) return 'The network name can be up to 32 characters.';
      if ((f.pass || '').length < 8 || f.pass.length > 63) return 'The password must be between 8 and 63 characters.';
      return '';
    };
    return Win.dialog({
      title: 'Edit network info', owner,
      body: `${field('Network name', 'name', n.hotspotName)}${field('Network password (at least 8 characters)', 'pass', n.hotspotPass)}${fieldSel('Network band', 'band', ['2.4 GHz', '5 GHz', 'Any available'], n.hotspotBand)}`,
      buttons: [{ label: 'Save', primary: true, value: box => readForm(box), validate: box => check2(readForm(box)) }, { label: 'Cancel', value: null }],
      onRender: box => liveValidate(box, check2),
    }).then(f => { if (f) { Object.assign(n, { hotspotName: f.name.trim(), hotspotPass: f.pass, hotspotBand: f.band }); Win.save('network'); } });
  }

  /* -------------------------------------------------------------- Airplane */

  page('airplane', {
    title: 'Airplane mode', parent: 'network', icon: 'airplane', keywords: 'flight mode wireless off',
    render() {
      const n = N();
      return `${row({ icon: 'airplane', title: 'Airplane mode', id: 'airplane-toggle', desc: 'Stop all wireless communication', end: Win.toggle(n.airplane, 'data-act="airplane"', 'Airplane mode') })}
      ${sec('Wireless devices')}
      ${row({ icon: 'wifi4', title: 'Wi-Fi', id: 'airplane-wifi', idx: false, end: Win.toggle(n.wifi && !n.airplane, `data-act="wifi-toggle" ${n.airplane ? 'disabled' : ''}`, 'Wi-Fi') })}
      ${row({ icon: 'bluetooth', title: 'Bluetooth', id: 'airplane-bt', idx: false, end: tgl('bluetooth', 'Bluetooth') })}
      ${row({ title: 'Airplane mode will remember if you turn Bluetooth or Wi-Fi on so it will stay on next time you\'re in airplane mode', idx: false, cls: 'st-plain' })}`;
    },
  });

  page('dialup', {
    title: 'Dial-up', parent: 'network', icon: 'phone',
    render() {
      return `${row({ icon: 'plus', title: 'Set up a new connection', act: 'noop-ext', external: true })}${related([row({ act: 'noop-ext', external: true, title: 'Network and Sharing Center', idx: false })])}`;
    },
  });

  /* ---------------------------------------------- Advanced network settings */

  page('advanced-network', {
    title: 'Advanced network settings', parent: 'network', icon: 'advanced', keywords: 'adapters reset disable enable',
    render(ctx) {
      const n = N();
      const cur = NETX.current();
      const wifiState = !n.adapterEnabled.wifi ? 'Disabled' : cur ? 'Connected' : 'Not connected';
      const bt = n.adapterEnabled.bluetoothPan;
      return `${sec('Network adapters')}
      ${exp(ctx, { id: 'adapter-wifi', iconHtml: g(n.adapterEnabled.wifi ? 'wifi4' : 'wifioff', 20), title: 'Wi-Fi', desc: NETX.ADAPTER.description, keywords: 'disable enable adapter',
        end: `<span class="st-endtext">${wifiState}</span>`,
        body: sub({ idx: false, title: n.adapterEnabled.wifi ? 'Disable this adapter' : 'Enable this adapter', end: btn(n.adapterEnabled.wifi ? 'Disable' : 'Enable', 'adapter', 'data-id="wifi"') })
          + sub({ idx: false, html: `<span class="row-text"><span class="row-title">View additional properties</span></span>${golink('View', 'wifi-hardware')}` })
          + sub({ idx: false, title: 'More adapter options', end: btn('Edit', 'noop-ext') }) })}
      ${exp(ctx, { id: 'adapter-bt', icon: 'bluetooth', title: 'Bluetooth Network Connection', desc: 'Bluetooth Device (Personal Area Network)', idx: false, end: `<span class="st-endtext">${bt ? 'Not connected' : 'Disabled'}</span>`,
        body: sub({ idx: false, title: bt ? 'Disable this adapter' : 'Enable this adapter', end: btn(bt ? 'Disable' : 'Enable', 'adapter', 'data-id="bt"') }) })}
      ${sec('More settings')}
      ${row({ go: 'sharing', icon: 'share', title: 'Advanced sharing settings', desc: 'Change network discovery and sharing settings', keywords: 'network discovery file sharing' })}
      ${row({ go: 'data-usage', icon: 'data', title: 'Data usage', desc: 'View data usage and set limits' })}
      ${row({ go: 'wifi-hardware', icon: 'devices', title: 'Hardware and connection properties', desc: 'View network properties and configuration' })}
      ${row({ go: 'network-reset', icon: 'restart', title: 'Network reset', desc: 'Reset all network adapters to factory settings', keywords: 'reset network winsock' })}
      ${related([row({ act: 'noop-ext', external: true, icon: 'advanced', title: 'More network adapter options', idx: false }), row({ go: 'security', icon: 'shield', title: 'Windows Firewall', idx: false })])}`;
    },
  });

  page('network-reset', {
    title: 'Network reset', parent: 'advanced-network', icon: 'restart', keywords: 'reset network adapters',
    render() {
      return `<div class="card st-card st-prose" data-row="network-reset-info"><p>This will remove then reinstall all your network adapters, and set other networking components back to their original settings.</p>
        <p>You might need to reinstall other networking software afterwards, such as VPN client software or virtual switches.</p></div>
      ${row({ icon: 'restart', title: 'Network reset', id: 'network-reset-now', end: btn('Reset now', 'network-reset', '', 'accent') })}`;
    },
  });

  function doNetworkReset() {
    const d = Win.clone(Win.DefaultState.network);
    const n = N();
    n.known = d.known.filter(k => k.ssid === 'Sablewave Home');
    Object.assign(n, { proxy: d.proxy, airplane: false, wifi: true, hotspot: false, randomMac: false, connected: '' });
    n.vpns.forEach(v => { v.connected = false; });
    n.adapterEnabled.bluetoothPan = true;
    NETX.setAdapter(false);
    setTimeout(() => {
      NETX.setAdapter(true);
      Win.toast({ app: 'Settings', glyph: 'restart', title: 'Network reset complete', body: 'Your network adapters were reinstalled and networking components were set back to their original settings.' });
    }, 1600);
  }

  page('sharing', {
    title: 'Advanced sharing settings', parent: 'advanced-network', icon: 'share',
    render(ctx) {
      const cur = NETX.current();
      const curProf = cur ? NETX.profile(cur.ssid)?.profile : '';
      const block = (title, prefix, current) => exp(ctx, { id: `share-${prefix}`, title, desc: current ? 'Current profile' : '', open: current, idx: false,
        body: sub({ title: 'Network discovery', desc: 'Your PC can find and be found by other devices on the network', end: tgl(`sharing.${prefix}Discovery`, 'Network discovery') })
          + sub({ title: 'File and printer sharing', desc: 'Allow others on the network to access shared files and printers on this device', end: tgl(`sharing.${prefix}File`, 'File and printer sharing') }) });
      return `${block('Private networks', 'priv', curProf === 'Private')}${block('Public networks', 'pub', curProf === 'Public')}
      ${exp(ctx, { id: 'share-all', title: 'All networks', idx: false,
        body: sub({ title: 'Public folder sharing', end: tgl('sharing.publicFolder', 'Public folder sharing') }) + sub({ title: 'Password protected sharing', end: tgl('sharing.passwordProtected', 'Password protected sharing') }) })}`;
    },
  });

  page('data-usage', {
    title: 'Data usage', parent: 'advanced-network', icon: 'data', keywords: 'data limit metered usage',
    render() {
      const cur = NETX.current();
      const apps = [['Microsoft Edge', 6.21], ['OneDrive', 3.08], ['Microsoft Teams', 1.94], ['Spotify', 0.88], ['Windows Update', 0.41], ['Microsoft Store', 0.12]];
      return `${row({ title: 'Wi-Fi', desc: cur ? cur.ssid : 'Not connected', idx: false, end: Win.select(['Wi-Fi'], 'Wi-Fi', 'aria-label="Adapter"') })}
      ${row({ title: 'Data limit', desc: N().meteredLimit ? `Monthly limit: ${N().meteredLimit} GB` : 'No limit set', end: btn(N().meteredLimit ? 'Remove limit' : 'Enter limit', 'data-limit') })}
      ${sec('Usage statistics')}
      <div class="card st-card st-usage" data-row="usage-total"><strong>${E(cur ? usage(cur.ssid) : '0 GB, last 30 days')}</strong></div>
      ${apps.map(([n2, gb]) => row({ title: n2, idx: false, end: `<span class="st-endtext">${gb.toFixed(2)} GB</span>` })).join('')}
      ${row({ title: 'Reset usage stats', idx: false, end: btn('Reset', 'noop-ext') })}`;
    },
  });

  /* ==================================================== Bluetooth & devices */

  Object.assign(Win.DefaultState.settings, { meteredDrivers: false, autoplay: true, usbNotify: true, swapThreeFinger: 'Switch apps and show desktop', touchpadSpeed: 5, scrollDirection: 'Down motion scrolls up', penHandwriting: true });

  const devStatus = d => (d.connecting ? 'Connecting…' : d.connected ? (d.kind === 'headphones' ? 'Connected voice, music' : 'Connected') : 'Paired');
  const btDevices = () => Win.state.devices.filter(d => !d.network && d.kind !== 'printer');

  page('bluetooth', {
    title: 'Bluetooth & devices', icon: 'bluetooth', keywords: 'pair device mouse keyboard headphones',
    render(ctx) {
      const on = S().bluetooth;
      const devs = btDevices();
      return `<div class="st-devgrid" data-row="device-cards">
        ${devs.map(d => `<div class="st-dev card">${g(devGlyph(d.kind), 28, 'st-dev-ico')}<div class="st-dev-text"><strong>${E(d.name)}</strong><span>${E(on ? devStatus(d) : 'Not connected')}</span>${d.battery && d.connected ? `<span class="st-dev-batt">${g('battery', 14)} ${d.battery}%</span>` : ''}</div>
          <button class="icon-btn st-dev-more" data-act="dev-menu" data-id="${E(d.id)}" aria-label="More options for ${E(d.name)}">${g('more', 16)}</button></div>`).join('')}
        <button class="st-dev st-dev-add card" data-act="add-device">${g('plus', 24)}<span>Add device</span></button></div>
      ${row({ icon: 'bluetooth', title: 'Bluetooth', id: 'bluetooth-toggle', desc: on ? `Discoverable as "${deviceName()}"` : '', keywords: 'turn on off', end: Win.toggle(on, 'data-act="bt-toggle"', 'Bluetooth') })}
      ${row({ go: 'devices', icon: 'devices', title: 'Devices', desc: 'Mouse, keyboard, pen, audio, displays and docks, other devices' })}
      ${row({ go: 'printers', icon: 'printer', title: 'Printers & scanners', desc: 'Preferences, troubleshoot', keywords: 'print scanner' })}
      ${row({ act: 'open-app', dataId: 'phonelink', icon: 'phone', title: 'Mobile devices', desc: 'Instantly access your mobile devices from your PC', external: true })}
      ${row({ go: 'cameras', icon: 'camera', title: 'Cameras', desc: 'Connected cameras, default image settings' })}
      ${row({ go: 'mouse', icon: 'mouse', title: 'Mouse', desc: 'Buttons, mouse pointer speed, scrolling' })}
      ${row({ go: 'touchpad', icon: 'touchpad', iconHtml: g('rename', 20), title: 'Touchpad', desc: 'Taps, gestures, scrolling, zooming' })}
      ${row({ go: 'pen', icon: 'edit', title: 'Pen & Windows Ink', desc: 'Right-handed or left-handed, pen button shortcuts, handwriting' })}
      ${row({ icon: 'play', title: 'AutoPlay', desc: 'Defaults for removable drives and memory cards', end: tgl('autoplay', 'Use AutoPlay for all media and devices') })}
      ${row({ icon: 'usb', title: 'USB', desc: 'Notifications, USB battery saver', end: tgl('usbNotify', 'USB notifications') })}`;
    },
  });

  page('devices', {
    title: 'Devices', parent: 'bluetooth', icon: 'devices',
    render(ctx) {
      const groups = [['Input', ['mouse', 'keyboard']], ['Audio', ['headphones', 'speaker']], ['Other devices', null]];
      const used = new Set();
      return `${row({ icon: 'plus', title: 'Add a device', idx: false, end: btn('Add device', 'add-device', '', 'accent') })}
      ${groups.map(([title, kinds]) => {
        const list = btDevices().filter(d => (kinds ? kinds.includes(d.kind) : !used.has(d.id)));
        list.forEach(d => used.add(d.id));
        if (!list.length) return '';
        return sec(title) + list.map(d => exp(ctx, { id: `dev-${d.id}`, idx: false, icon: devGlyph(d.kind), title: d.name, desc: S().bluetooth ? devStatus(d) : 'Not connected',
          end: S().bluetooth ? btn(d.connected ? 'Disconnect' : 'Connect', 'dev-connect', `data-id="${E(d.id)}" ${d.connecting ? 'disabled' : ''}`) : '',
          body: sub({ idx: false, html: `<span class="row-text"><span class="row-title">Remove device</span></span>${btn('Remove', 'dev-remove', `data-id="${E(d.id)}"`)}` }) })).join('');
      }).join('')}
      ${sec('Device settings')}
      ${row({ title: 'Download drivers and device software over metered connections', desc: 'Data charges may apply', end: tgl('meteredDrivers', 'Download over metered connections') })}`;
    },
  });

  page('printers', {
    title: 'Printers & scanners', parent: 'bluetooth', icon: 'printer', keywords: 'print queue default printer',
    render(ctx) {
      const printers = Win.state.devices.filter(d => d.kind === 'printer');
      const builtIn = ['Microsoft Print to PDF', 'OneNote (Desktop)'];
      const scan = ctx.drafts.printerScan;
      const found = { id: 'fabrikam-lj', name: 'Fabrikam LaserJet M210', kind: 'printer', paired: true, connected: true, network: true };
      return `${exp(ctx, { id: 'add-printer', icon: 'plus', title: 'Add a printer or scanner', open: !!scan, end: btn(scan === 'scanning' ? 'Refresh' : 'Add device', 'printer-scan', scan === 'scanning' ? 'disabled' : ''),
        body: scan === 'scanning' ? sub({ idx: false, html: '<div class="ring st-ring-sm" aria-hidden="true"></div><span class="muted">Searching for printers and scanners</span>' })
          : scan === 'done' ? (printers.some(p => p.id === found.id) ? sub({ idx: false, html: '<span class="muted">No new printers or scanners found.</span>' })
            : sub({ idx: false, html: `${g('printer', 20)}<span class="row-text"><span class="row-title">${E(found.name)}</span><span class="row-desc">Network printer</span></span>${btn('Add device', 'printer-add')}` }))
          : sub({ idx: false, html: '<span class="muted">Select Add device to look for printers and scanners.</span>' }) })}
      ${printers.map(p => exp(ctx, { id: `printer-${p.id}`, idx: false, icon: 'printer', title: p.name, desc: !S().printerManage && p === printers[0] ? 'Default' : p.connected ? 'Idle' : 'Offline',
        body: sub({ idx: false, title: 'Open print queue', end: btn('Open', 'noop-ext') }) + sub({ idx: false, title: 'Printing preferences', end: btn('Open', 'noop-ext') })
          + sub({ idx: false, html: `<span class="row-text"><span class="row-title">Remove this printer</span></span>${btn('Remove', 'dev-remove', `data-id="${E(p.id)}"`)}` }) })).join('')}
      ${builtIn.map(n => row({ icon: 'printer', title: n, idx: false })).join('')}
      ${sec('Printer preferences')}
      ${row({ title: 'Let Windows manage my default printer', desc: 'When this is on, Windows will set your default printer to be the one you used most recently at your current location', keywords: 'default printer', end: tgl('printerManage', 'Let Windows manage my default printer') })}
      ${row({ title: 'Download drivers and device software over metered connections', idx: false, end: tgl('meteredDrivers', 'Download drivers over metered connections') })}
      ${related([row({ act: 'troubleshoot', dataId: 'printer', icon: 'question', title: 'Run the troubleshooter', idx: false })])}`;
    },
  });

  page('cameras', {
    title: 'Cameras', parent: 'bluetooth', icon: 'camera',
    render() {
      return `${sec('Connected cameras')}${row({ icon: 'camera', title: 'Integrated Camera', desc: 'Front', idx: false })}
      ${row({ icon: 'plus', title: 'Add a network camera', idx: false, end: btn('Search for cameras', 'noop-ext') })}`;
    },
  });

  page('mouse', {
    title: 'Mouse', parent: 'bluetooth', icon: 'mouse', keywords: 'pointer speed buttons scroll wheel',
    render(ctx) {
      return `${row({ icon: 'mouse', title: 'Primary mouse button', keywords: 'left handed right', end: sel('primaryButton', ['Left', 'Right'], 'Primary mouse button') })}
      ${row({ icon: 'mouse', title: 'Mouse pointer speed', keywords: 'sensitivity', end: `<span class="st-range">${range('mouseSpeed', 1, 20, 'Mouse pointer speed')}</span>` })}
      ${row({ icon: 'mouse', title: 'Enhance pointer precision', end: tgl('enhancePrecision', 'Enhance pointer precision') })}
      ${row({ icon: 'access', title: 'Mouse pointer', desc: 'Pointer size and color', go: 'accessibility', idx: false })}
      ${sec('Scrolling')}
      ${row({ title: 'Roll the mouse wheel to scroll', end: Win.select(['Multiple lines at a time', 'One screen at a time'], 'Multiple lines at a time', 'aria-label="Roll the mouse wheel to scroll"') })}
      ${row({ title: 'Lines to scroll at a time', end: `<span class="st-range">${range('scrollLines', 1, 100, 'Lines to scroll at a time')}</span><span class="st-val" data-out="scrollLines">${S().scrollLines}</span>` })}
      ${row({ title: 'Scroll inactive windows when hovering over them', end: tgl('alwaysScroll', 'Scroll inactive windows when hovering over them') })}
      ${row({ title: 'Mouse wheel scroll direction', end: sel('wheelDirection', ['Down motion scrolls down', 'Down motion scrolls up'], 'Scroll direction') })}`;
    },
    after(root) { Win.paintRanges(root); },
  });

  page('touchpad', {
    title: 'Touchpad', parent: 'bluetooth', icon: 'rename', keywords: 'trackpad gestures tap',
    render(ctx) {
      return `${exp(ctx, { id: 'touchpad-toggle', iconHtml: g('rename', 20), title: 'Touchpad', end: tgl('touchpad', 'Touchpad'), open: true,
        body: sub({ html: check('touchpadKeep', 'Leave touchpad on when a mouse is connected') }) + sub({ title: 'Cursor speed', end: `<span class="st-range">${range('touchpadSpeed', 1, 10, 'Cursor speed')}</span>` }) })}
      ${sec('Gestures & interactions')}
      ${exp(ctx, { id: 'taps', title: 'Taps', keywords: 'tap to click',
        body: sub({ html: check('tapToClick', 'Tap with a single finger to single-click') }) + sub({ html: check('tapTwo', 'Tap with two fingers to right-click') }) + sub({ html: check('tapDrag', 'Tap twice and drag to multi-select') }) })}
      ${exp(ctx, { id: 'scroll-zoom', title: 'Scroll & zoom',
        body: sub({ html: check('twoFingerScroll', 'Drag two fingers to scroll') }) + sub({ title: 'Scrolling direction', end: sel('scrollDirection', ['Down motion scrolls up', 'Down motion scrolls down'], 'Scrolling direction') }) + sub({ html: check('pinchZoom', 'Pinch to zoom') }) })}
      ${exp(ctx, { id: 'three-finger', title: 'Three-finger gestures',
        body: sub({ title: 'Swipes', end: sel('swapThreeFinger', ['Nothing', 'Switch apps and show desktop', 'Switch desktops and show desktop', 'Change audio and volume'], 'Three-finger swipes') }) })}`;
    },
    after(root) { Win.paintRanges(root); },
  });
  Object.assign(Win.DefaultState.settings, { touchpadKeep: true, tapTwo: true, tapDrag: true, twoFingerScroll: true, pinchZoom: true });

  page('pen', {
    title: 'Pen & Windows Ink', parent: 'bluetooth', icon: 'edit',
    render() {
      return `${row({ title: 'Choose which hand you write with', end: Win.select(['Right hand', 'Left hand'], 'Right hand', 'aria-label="Handedness"') })}
      ${row({ title: 'Use your handwriting to enter text', end: tgl('penHandwriting', 'Use your handwriting to enter text') })}`;
    },
  });

  /* ======================================================== Personalization */

  const ACCENTS = ['#FFB900', '#FF8C00', '#F7630C', '#CA5010', '#DA3B01', '#EF6950', '#D13438', '#FF4343', '#E74856', '#E81123', '#EA005E', '#C30052',
    '#E3008C', '#BF0077', '#C239B3', '#9A0089', '#0078D4', '#0063B1', '#8E8CD8', '#6B69D6', '#8764B8', '#744DA9', '#B146C2', '#881798',
    '#0099BC', '#2D7D9A', '#00B7C3', '#038387', '#00B294', '#018574', '#00CC6A', '#10893E', '#7A7574', '#5D5A58', '#68768A', '#515C6B',
    '#567C73', '#486860', '#498205', '#107C10', '#767676', '#4C4A48', '#69797E', '#4A5459', '#647C64', '#525E54', '#847545', '#7E735F'];

  const wallpapers = () => { try { return Win.Wallpapers?.list?.() || []; } catch { return []; } };

  function themePresets() {
    const have = new Set(wallpapers().map(w => w.id));
    return [
      { id: 'windows-light', name: 'Windows (light)', wallpaper: 'bloom-light', theme: 'light', accent: '#0067c0' },
      { id: 'windows-dark', name: 'Windows (dark)', wallpaper: 'bloom-dark', theme: 'dark', accent: '#0067c0' },
      { id: 'ribbon', name: 'Ribbon', wallpaper: 'ribbon', theme: 'dark', accent: '#B146C2' },
      { id: 'dune', name: 'Dune', wallpaper: 'dune', theme: 'light', accent: '#CA5010' },
      { id: 'lagoon', name: 'Lagoon', wallpaper: 'lagoon', theme: 'light', accent: '#038387' },
      { id: 'aurora', name: 'Aurora', wallpaper: 'aurora', theme: 'dark', accent: '#00B294' },
    ].filter(t => !have.size || have.has(t.wallpaper));
  }
  const currentPreset = () => {
    const s = S();
    return themePresets().find(t => t.wallpaper === s.wallpaper && t.theme === s.theme && (s.appTheme || s.theme) === t.theme && !s.accentAuto && t.accent.toLowerCase() === String(s.accent).toLowerCase());
  };
  function themeStrip() {
    const cur = currentPreset();
    return `<div class="st-themes" role="list">${themePresets().map(t => `<button class="st-theme ${cur?.id === t.id ? 'on' : ''}" role="listitem" data-act="apply-theme" data-id="${t.id}" aria-label="${E(t.name)}" aria-pressed="${cur?.id === t.id}" title="${E(t.name)}" style="background:${E(wpCss(t.wallpaper) || t.accent)}">
      <span class="st-theme-win ${t.theme === 'dark' ? 'dk' : ''}"><i style="background:${t.accent}"></i></span></button>`).join('')}</div>`;
  }

  function applyPreset(id) {
    const t = themePresets().find(x => x.id === id);
    if (!t) return;
    Object.assign(S(), { wallpaper: t.wallpaper, theme: t.theme, appTheme: t.theme, accent: t.accent, accentAuto: false, colorMode: '' });
    Win.save('theme');
  }

  const wallGrid = (current, act) => `<div class="st-walls" role="list">${wallpapers().map(w => `<button class="st-wall ${current === w.id ? 'on' : ''}" role="listitem" data-act="${act}" data-id="${E(w.id)}" aria-label="${E(w.name)}" aria-pressed="${current === w.id}" title="${E(w.name)}" style="background:${E(wpCss(w.id))}"></button>`).join('')}</div>`;

  page('personalization', {
    title: 'Personalization', icon: 'brush', keywords: 'customize appearance',
    render(ctx) {
      return `<div class="card st-card st-perso" data-row="theme-preview">${miniDesktop('big')}<div class="st-perso-side"><strong>Select a theme to apply</strong>${themeStrip()}</div></div>
      ${row({ go: 'background', icon: 'picture', title: 'Background', desc: 'Background image, color, slideshow', keywords: 'wallpaper desktop picture' })}
      ${row({ go: 'colors', icon: 'palette', title: 'Colors', desc: 'Accent color, transparency effects, color theme', keywords: 'dark mode light mode accent' })}
      ${row({ go: 'themes', icon: 'brush', title: 'Themes', desc: 'Install, create, manage' })}
      ${row({ go: 'dynamic-lighting', icon: 'sparkle', title: 'Dynamic Lighting', desc: 'Connected devices, effects, app settings' })}
      ${row({ go: 'lock-screen', icon: 'lock', title: 'Lock screen', desc: 'Lock screen images, apps, animations' })}
      ${row({ go: 'text-input', icon: 'keyboard', title: 'Text input', desc: 'Touch keyboard, voice typing, emoji and more, input method editor' })}
      ${row({ go: 'start', icon: 'windows', title: 'Start', desc: 'Recent apps and items, folders' })}
      ${row({ go: 'taskbar', icon: 'taskview', title: 'Taskbar', desc: 'Taskbar behaviors, system pins' })}
      ${row({ go: 'fonts', icon: 'text', title: 'Fonts', desc: 'Install, manage' })}
      ${row({ go: 'device-usage', icon: 'devices', title: 'Device usage', desc: 'Select all the ways you plan to use your device to get personalized tips, ads, and recommendations within Microsoft experiences' })}`;
    },
  });

  page('background', {
    title: 'Background', parent: 'personalization', icon: 'picture', keywords: 'wallpaper desktop picture solid color fit',
    render(ctx) {
      const s = S();
      const solid = s.wallpaper === 'solid';
      const body = solid
        ? `${row({ title: 'Choose your background color', id: 'background-color', keywords: 'solid color', cls: 'st-col', after: `<div class="card st-card"><div class="st-swatches">${ACCENTS.map(c => `<button class="st-swatch ${String(s.solidColor).toLowerCase() === c.toLowerCase() ? 'on' : ''}" data-act="solid" data-id="${c}" style="background:${c}" aria-label="Color ${c}" aria-pressed="${String(s.solidColor).toLowerCase() === c.toLowerCase()}"></button>`).join('')}</div></div>` })}
          ${row({ title: 'Custom colors', end: `<label class="btn st-colorbtn">View colors<input type="color" data-act="solid-custom" value="${E(s.solidColor)}" aria-label="Custom background color"></label>` })}`
        : `${row({ title: 'Recent images', id: 'recent-images', keywords: 'wallpaper picture', cls: 'st-col', after: `<div class="card st-card">${wallGrid(s.wallpaper, 'wallpaper')}</div>` })}
          ${row({ title: 'Choose a photo', keywords: 'browse photos picture', end: btn('Browse photos', 'browse-photos') })}
          ${row({ title: 'Choose a fit for your desktop image', id: 'wallpaper-fit', keywords: 'fill fit stretch tile center span', end: sel('wallpaperFit', ['Fill', 'Fit', 'Stretch', 'Tile', 'Center', 'Span'], 'Choose a fit for your desktop image') })}`;
      return `<div class="st-bigpreview">${miniDesktop('big')}</div>
      ${row({ icon: 'picture', title: 'Personalize your background', desc: 'A picture background applies to your current desktop. Solid color or slideshow backgrounds apply to all your desktops.', keywords: 'wallpaper type',
        end: Win.select([['picture', 'Picture'], ['solid', 'Solid color']], solid ? 'solid' : 'picture', 'data-act="bg-mode" aria-label="Personalize your background"') })}
      ${body}
      ${related([row({ go: 'contrast-themes', icon: 'eye', title: 'Contrast themes', desc: 'Color themes for low vision, light sensitivity', idx: false })])}`;
    },
  });

  page('colors', {
    title: 'Colors', parent: 'personalization', icon: 'palette', keywords: 'dark mode light mode accent color transparency',
    render(ctx) {
      const s = S();
      const custom = s.colorMode === 'custom' || s.theme !== (s.appTheme || s.theme);
      const mode = custom ? 'custom' : s.theme;
      const recent = [...new Set([String(s.accent).toUpperCase(), ...(s.recentAccents || [])])].slice(0, 5);
      const sw = c => `<button class="st-swatch ${!s.accentAuto && String(s.accent).toLowerCase() === c.toLowerCase() ? 'on' : ''}" data-act="accent" data-id="${c}" style="background:${c}" aria-label="Accent color ${c}" aria-pressed="${!s.accentAuto && String(s.accent).toLowerCase() === c.toLowerCase()}"></button>`;
      return `<div class="st-bigpreview">${miniDesktop('big')}</div>
      ${row({ icon: 'palette', title: 'Choose your mode', desc: 'Change the colors that appear in Windows and your apps', keywords: 'dark mode light mode theme',
        end: Win.select([['light', 'Light'], ['dark', 'Dark'], ['custom', 'Custom']], mode, 'data-act="color-mode" aria-label="Choose your mode"') })}
      ${custom ? row({ icon: 'windows', title: 'Choose your default Windows mode', keywords: 'taskbar start dark', end: sel('theme', [['light', 'Light'], ['dark', 'Dark']], 'Choose your default Windows mode') })
        + row({ icon: 'apps', title: 'Choose your default app mode', keywords: 'apps dark', end: sel('appTheme', [['light', 'Light'], ['dark', 'Dark']], 'Choose your default app mode') }) : ''}
      ${row({ icon: 'sparkle', title: 'Transparency effects', desc: 'Windows and surfaces appear translucent', keywords: 'acrylic mica blur', end: tgl('transparency', 'Transparency effects') })}
      ${exp(ctx, { id: 'accent-color', icon: 'palette', title: 'Accent color', open: true, keywords: 'highlight color',
        end: Win.select([['manual', 'Manual'], ['auto', 'Automatic']], s.accentAuto ? 'auto' : 'manual', 'data-act="accent-auto" aria-label="Accent color mode"'),
        body: sub({ idx: false, html: `<div class="st-col-block"><span class="row-title">Recent colors</span><div class="st-swatches">${recent.map(sw).join('')}</div></div>` })
          + sub({ idx: false, html: `<div class="st-col-block"><span class="row-title">Windows colors</span><div class="st-swatches">${ACCENTS.map(sw).join('')}</div></div>` })
          + sub({ title: 'Custom colors', end: `<label class="btn st-colorbtn">View colors<input type="color" data-act="accent-custom" value="${E(s.accent)}" aria-label="Custom accent color"></label>` }) })}
      ${row({ icon: 'windows', title: 'Show accent color on Start and taskbar', end: tgl('accentOnStart', 'Show accent color on Start and taskbar') })}
      ${row({ icon: 'restore', title: 'Show accent color on title bars and window borders', end: tgl('accentOnTitle', 'Show accent color on title bars and window borders') })}
      ${related([row({ go: 'contrast-themes', icon: 'eye', title: 'Contrast themes', desc: 'Color themes for low vision, light sensitivity', idx: false })])}`;
    },
  });

  page('themes', {
    title: 'Themes', parent: 'personalization', icon: 'brush', keywords: 'theme desktop icons',
    render(ctx) {
      const cur = currentPreset();
      return `<div class="card st-card st-perso" data-row="current-theme">${miniDesktop('big')}<div class="st-perso-side"><strong>Current theme: ${E(cur ? cur.name : 'Custom')}</strong>
        <div class="st-chips"><button class="st-chip" data-go="background">${g('picture', 16)} Background</button><button class="st-chip" data-go="colors">${g('palette', 16)} Color</button><button class="st-chip" data-go="sound">${g('sound', 16)} Sounds: Windows Default</button><button class="st-chip" data-go="mouse">${g('mouse', 16)} Mouse cursor: Windows Default</button></div></div></div>
      ${note('current-theme', 'Current theme', 'theme') || ''}
      ${exp(ctx, { id: 'change-theme', title: 'Change theme', desc: 'Select a theme to apply', open: true, keywords: 'apply theme',
        body: sub({ idx: false, html: `<div class="st-themes big">${themePresets().map(t => `<button class="st-theme ${cur?.id === t.id ? 'on' : ''}" data-act="apply-theme" data-id="${t.id}" aria-pressed="${cur?.id === t.id}" style="background:${E(wpCss(t.wallpaper) || t.accent)}"><span class="st-theme-win ${t.theme === 'dark' ? 'dk' : ''}"><i style="background:${t.accent}"></i></span><span class="st-theme-name">${E(t.name)}</span></button>`).join('')}</div>` })
          + sub({ idx: false, title: 'Get more themes from Microsoft Store', end: btn('Browse themes', 'open-app', 'data-id="store"') }) })}
      ${related([
        row({ act: 'desktop-icons', icon: 'pc', title: 'Desktop icon settings', keywords: 'show desktop icons this pc recycle bin', external: true }),
        row({ go: 'contrast-themes', icon: 'eye', title: 'Contrast themes', desc: 'Color themes for low vision, light sensitivity', idx: false }),
      ])}`;
    },
  });

  function desktopIconsDialog(owner) {
    const d = S().deskIcons || {};
    return Win.dialog({
      title: 'Desktop Icon Settings', owner, width: 440,
      body: `<p class="muted">Desktop icons</p><div class="st-dgrid">
        ${fieldCheck('Show desktop icons', 'show', S().desktopIcons)}${fieldCheck('Computer', 'computer', d.computer)}${fieldCheck('Recycle Bin', 'recycle', d.recycle !== false)}
        ${fieldCheck('User\'s Files', 'user', d.user)}${fieldCheck('Control Panel', 'control', d.control)}${fieldCheck('Network', 'network', d.network)}</div>
        ${fieldCheck('Allow themes to change desktop icons', 'themesChange', true)}`,
      buttons: [{ label: 'OK', primary: true, value: box => readForm(box) }, { label: 'Cancel', value: null }],
    }).then(f => {
      if (!f) return;
      S().desktopIcons = !!f.show;
      S().deskIcons = { computer: !!f.computer, recycle: !!f.recycle, user: !!f.user, control: !!f.control, network: !!f.network };
      Win.save('state');
    });
  }

  function browsePhotos(owner) {
    const pics = Win.state.fs.filter(n => n.kind === 'file' && /^(jpe?g|png|bmp|webp)$/i.test(n.ext || '') && n.parent !== 'bin');
    return Win.dialog({
      title: 'Choose a photo', owner, width: 560,
      body: pics.length ? `<div class="st-walls dlg">${pics.map(n => `<button class="st-wall" data-pick="${E(n.id)}" aria-label="${E(n.name)}" title="${E(n.name)}" style="background:${E(wpCss(`file:${n.id}`))}"></button>`).join('')}</div>` : '<p>No pictures found in your Pictures folder.</p>',
      buttons: [{ label: 'Cancel', value: null }],
      onRender(box, { close }) { box.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) close(b.dataset.pick); }); },
    }).then(id => { if (id) { S().wallpaper = `file:${id}`; Win.save('theme'); } });
  }

  page('lock-screen', {
    title: 'Lock screen', parent: 'personalization', icon: 'lock', keywords: 'lock screen picture spotlight status',
    render(ctx) {
      const s = S();
      const t = new Date();
      return `<div class="st-bigpreview"><div class="st-mini big st-lockprev" aria-hidden="true" style="background:${E(wpCss(s.lockWallpaper) || 'var(--accent)')}"><span class="st-lock-time">${E(t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: !s.time24 }).replace(/\s?[AP]M$/, ''))}</span><span class="st-lock-date">${E(t.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))}</span></div></div>
      ${row({ icon: 'picture', title: 'Personalize your lock screen', keywords: 'lock wallpaper spotlight',
        end: Win.select([['picture', 'Picture'], ['spotlight', 'Windows spotlight']], s.lockSpotlight ? 'spotlight' : 'picture', 'data-act="lock-mode" aria-label="Personalize your lock screen"') })}
      ${s.lockSpotlight ? '' : `<div class="card st-card" data-row="lock-images">${wallGrid(s.lockWallpaper, 'lock-wallpaper')}</div>`}
      ${row({ icon: 'apps', title: 'Lock screen status', desc: 'Choose an app to show detailed status on the lock screen', keywords: 'weather widgets',
        end: Win.select([['true', 'Weather and more'], ['false', 'None']], String(!!s.lockStatus), 'data-set="lockStatus" data-type="bool" aria-label="Lock screen status"') })}
      ${row({ icon: 'person', title: 'Show the lock screen background picture on the sign-in screen', end: tgl('lockOnSignin', 'Show the lock screen background picture on the sign-in screen') })}
      ${related([row({ go: 'power', icon: 'power', title: 'Screen timeout', idx: false }), row({ act: 'noop-ext', external: true, icon: 'display', title: 'Screen saver', idx: false })])}`;
    },
  });

  page('start', {
    title: 'Start', parent: 'personalization', icon: 'windows', keywords: 'start menu layout recommended pins',
    render(ctx) {
      const s = S();
      const layouts = [['more-pins', 'More pins'], ['default', 'Default'], ['more-recs', 'More recommendations']];
      return `<div class="card st-card st-layouts" role="radiogroup" aria-label="Layout" data-row="start-layout">${layouts.map(([id, l]) => `<label class="st-layout ${s.startLayout === id ? 'on' : ''}"><span class="st-layout-pic ${id}" aria-hidden="true"><i></i><i></i></span><span class="check"><input type="radio" name="st-layout-${ctx.uid}" value="${id}" data-set="startLayout" ${s.startLayout === id ? 'checked' : ''}><span>${E(l)}</span></span></label>`).join('')}</div>
      ${note('start-layout', 'Start layout', 'more pins more recommendations') || ''}
      ${row({ title: 'Show recently added apps', end: tgl('startRecent', 'Show recently added apps') })}
      ${row({ title: 'Show most used apps', end: tgl('startMostUsed', 'Show most used apps') })}
      ${row({ title: 'Show recommended files in Start, recent files in File Explorer, and items in Jump Lists', id: 'start-recommended', keywords: 'recommended section recent files', end: tgl('startRecommended', 'Show recommended files in Start, recent files in File Explorer, and items in Jump Lists') })}
      ${row({ title: 'Show recommendations for tips, shortcuts, new apps, and more', end: tgl('startTips', 'Show recommendations for tips, shortcuts, new apps, and more') })}
      ${row({ title: 'Show account-related notifications', end: tgl('startAccount', 'Show account-related notifications') })}
      ${row({ go: 'start-folders', title: 'Folders', desc: 'These folders appear on Start next to the Power button' })}`;
    },
  });
  Object.assign(Win.DefaultState.settings, { startMostUsed: true, startAccount: true, startFolders: { settings: true, explorer: true, documents: false, downloads: false, music: false, pictures: false, videos: false, network: false, personal: false } });

  page('start-folders', {
    title: 'Folders', parent: 'start', icon: 'folder',
    render() {
      return [['settings', 'Settings', 'gear'], ['explorer', 'File Explorer', 'folder'], ['documents', 'Documents', 'document'], ['downloads', 'Downloads', 'download'], ['music', 'Music', 'music'], ['pictures', 'Pictures', 'picture'], ['videos', 'Videos', 'video'], ['network', 'Network', 'network'], ['personal', 'Personal folder', 'person']]
        .map(([k, l, ic]) => row({ icon: ic, title: l, idx: false, end: tgl(`startFolders.${k}`, l) })).join('');
    },
  });

  page('taskbar', {
    title: 'Taskbar', parent: 'personalization', icon: 'taskview', keywords: 'taskbar alignment search widgets task view auto hide',
    render(ctx) {
      return `${exp(ctx, { id: 'taskbar-items', title: 'Taskbar items', desc: 'Show or hide buttons that appear on the taskbar', open: true,
        body: sub({ title: 'Search', id: 'taskbar-search', keywords: 'search box icon', end: sel('taskbarSearch', [['hidden', 'Hide'], ['icon', 'Search icon only'], ['box', 'Search box']], 'Search') })
          + sub({ title: 'Task view', id: 'task-view', end: tgl('showTaskView', 'Task view') })
          + sub({ title: 'Widgets', id: 'widgets', keywords: 'weather news', end: tgl('showWidgets', 'Widgets') }) })}
      ${exp(ctx, { id: 'tray-icons', title: 'System tray icons', desc: 'Show or hide system tray icons',
        body: sub({ title: 'Emoji and more', end: sel('trayEmoji', ['Never', 'While typing', 'Always'], 'Emoji and more') }) + sub({ title: 'Pen menu', end: tgl('trayPen', 'Pen menu') }) + sub({ title: 'Touch keyboard', end: sel('trayKeyboard', ['Never', 'Always', 'When no keyboard attached'], 'Touch keyboard') }) + sub({ title: 'Virtual touchpad', end: tgl('trayTouchpad', 'Virtual touchpad') }) })}
      ${exp(ctx, { id: 'other-tray', title: 'Other system tray icons', desc: 'Show or hide additional system tray icons',
        body: sub({ title: 'Hidden icon menu', end: tgl('trayHiddenMenu', 'Hidden icon menu') }) + ['Windows Security notification icon', 'OneDrive', 'Microsoft Teams', 'HP Smart'].map(n => sub({ title: n, idx: false, end: Win.toggle(true, `aria-label="${E(n)}"`, n) })).join('') })}
      ${exp(ctx, { id: 'taskbar-behaviors', title: 'Taskbar behaviors', desc: 'Taskbar alignment, badging, automatically hide, and multiple displays', keywords: 'alignment left center auto hide', open: !!ctx.open.has('taskbar-behaviors'),
        body: sub({ title: 'Taskbar alignment', id: 'taskbar-alignment', keywords: 'left center', end: sel('taskbarAlign', [['center', 'Center'], ['left', 'Left']], 'Taskbar alignment') })
          + sub({ html: check('autoHide', 'Automatically hide the taskbar'), id: 'auto-hide', title: 'Automatically hide the taskbar' })
          + sub({ html: check('showBadges', 'Show badges on taskbar apps') })
          + sub({ html: check('showFlashing', 'Show flashing on taskbar apps') })
          + sub({ html: check('allDisplays', 'Show my taskbar on all displays') })
          + sub({ html: check('shareWindow', 'Share any window from my taskbar') })
          + sub({ html: check('farCorner', 'Select the far corner of the taskbar to show the desktop') })
          + sub({ html: check('showSeconds', 'Show seconds in system tray clock (uses more power)'), id: 'show-seconds', title: 'Show seconds in system tray clock' }) })}`;
    },
  });
  Object.assign(Win.DefaultState.settings, { trayEmoji: 'Never', trayPen: false, trayKeyboard: 'When no keyboard attached', trayTouchpad: false, trayHiddenMenu: true, showFlashing: true, allDisplays: false, shareWindow: true, farCorner: true });

  page('dynamic-lighting', {
    title: 'Dynamic Lighting', parent: 'personalization', icon: 'sparkle',
    render() {
      return `${row({ title: 'Use Dynamic Lighting on my devices', desc: 'Control your devices with compatible apps', end: tgl('dynamicLighting', 'Use Dynamic Lighting on my devices') })}
      ${info('', '', 'No compatible devices were found.')}`;
    },
  });

  page('text-input', {
    title: 'Text input', parent: 'personalization', icon: 'keyboard',
    render() {
      return `${row({ title: 'Touch keyboard', desc: 'Keyboard size, theme', go: 'text-input', idx: false })}${row({ title: 'Voice typing', desc: 'Microphone, launcher', idx: false })}${row({ title: 'Emoji and more', desc: 'Emoji, GIFs, kaomoji, symbols', idx: false })}`;
    },
  });

  page('fonts', {
    title: 'Fonts', parent: 'personalization', icon: 'text',
    render() {
      const fonts = ['Arial', 'Bahnschrift', 'Calibri', 'Cambria', 'Cascadia Code', 'Consolas', 'Georgia', 'Segoe UI', 'Segoe UI Variable', 'Times New Roman', 'Verdana'];
      return `${row({ title: 'Add fonts', desc: 'Drag and drop to install', idx: false, cls: 'st-drop' })}
      ${sec('Available fonts')}<div class="st-fonts">${fonts.map(f => `<div class="card st-font"><span style="font-family:'${E(f)}'">The quick brown fox jumps over the lazy dog.</span><strong>${E(f)}</strong></div>`).join('')}</div>`;
    },
  });

  page('device-usage', {
    title: 'Device usage', parent: 'personalization', icon: 'devices',
    render() {
      return [['usageGaming', 'Gaming'], ['usageFamily', 'Family'], ['usageCreativity', 'Creativity'], ['usageSchool', 'School'], ['usageEntertainment', 'Entertainment'], ['usageBusiness', 'Business'], ['usageDevelopment', 'Development']]
        .map(([k, l]) => row({ title: l, idx: false, end: tgl(k, l) })).join('');
    },
  });

  /* ================================================================== Apps */

  page('apps', {
    title: 'Apps', icon: 'apps', keywords: 'programs software',
    render() {
      return `${row({ go: 'installed-apps', icon: 'list', title: 'Installed apps', desc: 'Uninstall and manage apps on your PC', keywords: 'uninstall programs add remove' })}
      ${row({ go: 'advanced-apps', icon: 'advanced', title: 'Advanced app settings', desc: 'Choose where to get apps, app archiving, uninstall updates' })}
      ${row({ go: 'default-apps', icon: 'check', title: 'Default apps', desc: 'Defaults for file and link types, other defaults', keywords: 'browser file association' })}
      ${row({ go: 'offline-maps', icon: 'location', title: 'Offline maps', desc: 'Downloads, storage location, map updates' })}
      ${row({ go: 'optional-features', icon: 'apps', title: 'Optional features', desc: 'Extra functionality for your device', idx: false })}
      ${row({ go: 'apps-websites', icon: 'globe', title: 'Apps for websites', desc: 'Websites that can open in an app instead of a browser' })}
      ${row({ go: 'video-playback', icon: 'video', title: 'Video playback', desc: 'Video adjustments, HDR streaming, battery options' })}
      ${row({ go: 'startup', icon: 'power', title: 'Startup', desc: 'Apps that start automatically when you sign in', keywords: 'startup programs' })}`;
    },
  });

  const appIconFor = a => (Win.appIcons[a.id] ? Win.appIcon(a.id, 24) : `<span class="st-appglyph" aria-hidden="true">${E(a.name[0])}</span>`);

  page('installed-apps', {
    title: 'Installed apps', parent: 'apps', icon: 'list', keywords: 'uninstall programs add remove',
    render(ctx) {
      const q = ctx.appQuery.toLowerCase();
      let list = Win.state.apps.filter(a => a.name.toLowerCase().includes(q));
      const sorters = { name: (a, b) => a.name.localeCompare(b.name), 'name-desc': (a, b) => b.name.localeCompare(a.name), size: (a, b) => b.size - a.size, 'size-asc': (a, b) => a.size - b.size, date: (a, b) => b.date - a.date };
      list = list.sort(sorters[ctx.appSort] || sorters.name);
      const total = Win.state.apps.reduce((s, a) => s + (a.size || 0), 0);
      return `<div class="st-toolbar" data-row="app-search"><input class="input st-filter" type="search" placeholder="Search apps" aria-label="Search apps" data-act="app-q" value="${E(ctx.appQuery)}">
        <label class="st-inline">Sort by: ${Win.select([['name', 'Name (A to Z)'], ['name-desc', 'Name (Z to A)'], ['size', 'Size (large to small)'], ['size-asc', 'Size (small to large)'], ['date', 'Install date']], ctx.appSort, 'data-act="app-sort" aria-label="Sort by"')}</label></div>
      <p class="st-count muted" data-row="app-count">${list.length} apps found · ${E(Win.bytes(total))}</p>
      ${list.map(a => row({ idx: false, iconHtml: appIconFor(a), title: a.name, id: `app-${a.id}`, desc: `${a.version} | ${a.publisher} | ${fmtShort(a.date)}`,
        end: `<span class="st-endtext">${E(Win.bytes(a.size))}</span><button class="icon-btn" data-act="app-menu" data-id="${E(a.id)}" aria-label="More options for ${E(a.name)}">${g('more', 16)}</button>` })).join('')}`;
    },
  });

  async function uninstallApp(ctx, id) {
    const a = Win.state.apps.find(x => x.id === id);
    if (!a) return;
    const ok = await Win.confirm('Uninstall', `This app and its related info will be uninstalled.`, { ok: 'Uninstall', cancel: 'Cancel', owner: ctx.win });
    if (!ok) return;
    Win.state.apps = Win.state.apps.filter(x => x.id !== id);
    S().storageFreed = (S().storageFreed || 0) + (a.size || 0);
    for (const key of ['taskbar', 'start']) Win.state[key].pinned = Win.state[key].pinned.filter(p => p !== id);
    Win.save('state');
  }

  page('startup', {
    title: 'Startup', parent: 'apps', icon: 'power', keywords: 'startup apps sign in boot',
    render() {
      const list = Win.state.apps.filter(a => a.startup !== undefined).sort((a, b) => a.name.localeCompare(b.name));
      const impact = a => (!a.startup ? 'No impact' : a.size > 350e6 ? 'High impact' : a.size > 150e6 ? 'Medium impact' : 'Low impact');
      return `${row({ title: 'Apps can be configured to start when you log in. In most cases, they\'ll start minimized or might only start a background task.', idx: false, cls: 'st-plain' })}
      <div class="st-toolbar"><label class="st-inline">Sort by: ${Win.select(['Name', 'Status', 'Startup impact'], 'Name', 'aria-label="Sort by"')}</label></div>
      ${list.map(a => row({ idx: false, iconHtml: appIconFor(a), title: a.name, desc: impact(a), id: `startup-${a.id}`, end: Win.toggle(!!a.startup, `data-act="startup" data-id="${E(a.id)}"`, a.name) })).join('')}`;
    },
  });

  const DEFAULTS = [['browser', 'Web browser', ['Microsoft Edge']], ['mail', 'Email', ['Outlook', 'Mail']], ['photos', 'Photo viewer', ['Photos', 'Paint']], ['music', 'Music player', ['Media Player', 'VLC media player', 'Spotify']],
    ['video', 'Video player', ['Media Player', 'VLC media player']], ['text', 'Text files (.txt)', ['Notepad']], ['pdf', 'PDF files (.pdf)', ['Microsoft Edge']]];

  page('default-apps', {
    title: 'Default apps', parent: 'apps', icon: 'check', keywords: 'browser file type association',
    render(ctx) {
      const q = (ctx.drafts.defQ || '').toLowerCase();
      const apps = ['Calculator', 'Clock', 'Media Player', 'Microsoft Edge', 'Notepad', 'Outlook', 'Paint', 'Photos', 'Snipping Tool', 'Spotify', 'Terminal', 'VLC media player'].filter(a => a.toLowerCase().includes(q));
      return `${row({ title: 'Set a default for a file type or link type', idx: false, end: `<input class="input" type="search" placeholder="Enter a file type or link type" aria-label="Enter a file type or link type">` })}
      ${sec('Defaults')}${DEFAULTS.map(([k, l, opts]) => row({ title: l, idx: false, end: Win.select(opts.includes(S().defaults[k]) ? opts : [S().defaults[k], ...opts], S().defaults[k], `data-set="defaults.${k}" aria-label="${E(l)}"`) })).join('')}
      ${sec('Set defaults for applications')}
      <div class="st-toolbar"><input class="input st-filter" type="search" placeholder="Search apps" aria-label="Search apps" data-act="def-q" value="${E(ctx.drafts.defQ || '')}"></div>
      ${apps.map(a => row({ title: a, idx: false, act: 'noop', iconHtml: `<span class="st-appglyph" aria-hidden="true">${E(a[0])}</span>` })).join('')}
      ${related([row({ act: 'noop-ext', external: true, title: 'Choose defaults by file type', idx: false }), row({ act: 'noop-ext', external: true, title: 'Choose defaults by link type', idx: false })])}`;
    },
  });

  page('advanced-apps', {
    title: 'Advanced app settings', parent: 'apps', icon: 'advanced',
    render() {
      return `${row({ title: 'Choose where to get apps', desc: 'Installing apps only from Microsoft Store helps protect your device', end: sel('appSource', ['Anywhere', 'Anywhere, but let me know if there\'s a comparable app in the Microsoft Store', 'Anywhere, but warn me before installing an app that\'s not from the Microsoft Store', 'The Microsoft Store only (recommended)'], 'Choose where to get apps') })}
      ${row({ title: 'Share across devices', end: sel('shareDevices', ['Off', 'My devices only', 'Everyone nearby'], 'Share across devices') })}
      ${row({ title: 'App archiving', desc: 'Automatically archive apps you don\'t use often', end: tgl('appArchive', 'App archiving') })}`;
    },
  });
  Object.assign(Win.DefaultState.settings, { appSource: 'Anywhere', shareDevices: 'My devices only', appArchive: true, mapsMetered: false });

  page('offline-maps', { title: 'Offline maps', parent: 'apps', icon: 'location', render: () => `${row({ title: 'Maps', desc: 'No maps downloaded', end: btn('Download maps', 'noop-ext'), idx: false })}${row({ title: 'Metered connections', desc: 'Download maps over metered connections', end: tgl('mapsMetered', 'Metered connections') })}` });
  page('apps-websites', { title: 'Apps for websites', parent: 'apps', icon: 'globe', render: () => ['Microsoft 365', 'Outlook', 'Teams'].map(n => row({ title: n, idx: false, end: Win.toggle(true, `aria-label="${E(n)}"`, n) })).join('') });
  page('video-playback', { title: 'Video playback', parent: 'apps', icon: 'video', render: () => `${row({ title: 'Process video automatically to enhance it', end: tgl('videoEnhance', 'Process video automatically to enhance it') })}${row({ title: 'Battery options', end: Win.select(['Optimize for video quality', 'Optimize for battery life'], 'Optimize for battery life', 'aria-label="Battery options"') })}` });

  /* ============================================================== Accounts */

  page('accounts', {
    title: 'Accounts', icon: 'person', keywords: 'user microsoft account',
    render() {
      const a = A();
      return `<div class="card st-card st-acct" data-row="account-hero"><span class="st-avatar big" aria-hidden="true">${E(Win.PERSONA.initials)}</span><div><div class="st-hero-name">${E(a.name)}</div><div class="muted">${E(a.email)}</div><div class="muted">${a.microsoft ? 'Microsoft account' : 'Local account'} · Administrator</div></div></div>
      ${sec('Account settings')}
      ${row({ go: 'your-info', icon: 'person', title: 'Your info', desc: 'Profile photo' })}
      ${row({ go: 'sign-in', icon: 'key', title: 'Sign-in options', desc: 'Windows Hello, security key, password, dynamic lock', keywords: 'pin password face fingerprint' })}
      ${row({ go: 'email-accounts', icon: 'mail', title: 'Email & accounts', desc: 'Accounts used by email, calendar, and contacts' })}
      ${row({ go: 'family', icon: 'family', title: 'Family', desc: 'Manage your family group, edit account types and device permissions' })}
      ${row({ go: 'backup', icon: 'cloud', title: 'Windows Backup', desc: 'Back up your files, apps, preferences to restore them across devices' })}
      ${row({ go: 'other-users', icon: 'family', title: 'Other users', desc: 'Device access, work or school users, kiosk assigned access' })}
      ${row({ go: 'work-school', icon: 'document', title: 'Access work or school', desc: 'Organization resources like email, apps, and network' })}`;
    },
  });

  page('your-info', {
    title: 'Your info', parent: 'accounts', icon: 'person', keywords: 'profile picture account name',
    render() {
      const a = A();
      return `<div class="st-me" data-row="profile"><span class="st-avatar huge" aria-hidden="true">${E(Win.PERSONA.initials)}</span><strong class="st-hero-name">${E(a.name)}</strong><span class="muted">${E(a.email)}</span><span class="muted">Administrator</span></div>
      ${sec('Adjust your photo')}
      ${row({ icon: 'camera', title: 'Take a photo', end: btn('Open Camera', 'noop-ext') })}
      ${row({ icon: 'picture', title: 'Choose a file', end: btn('Browse files', 'noop-ext') })}
      ${sec('Account settings')}
      ${row({ icon: 'person', title: a.microsoft ? 'Microsoft account' : 'Local account', desc: a.microsoft ? 'Windows is better when your settings and files automatically sync' : 'Sign in with a Microsoft account to sync your settings',
        end: link(a.microsoft ? 'Sign in with a local account instead' : 'Sign in with a Microsoft account instead', 'account-type') })}
      ${related([row({ act: 'noop-ext', external: true, icon: 'person', title: 'Accounts', desc: 'Manage my accounts', idx: false })])}`;
    },
  });

  function changePin(current, next, confirm2, letters = false) {
    const a = A();
    if (String(current ?? '') !== String(a.pin)) return 'The PIN is incorrect. Try again.';
    const v = String(next ?? '');
    if (v.length < 4) return 'Your PIN must be at least 4 characters long.';
    if (v.length > 127) return 'Your PIN can be up to 127 characters long.';
    if (!letters && !/^\d+$/.test(v)) return 'Your PIN can only contain numbers.';
    if (v !== String(confirm2 ?? '')) return 'The PINs don\'t match.';
    a.pin = v;
    Win.save('state');
    return '';
  }

  function pinDialog(owner) {
    return Win.dialog({
      title: 'Change your PIN', owner, icon: g('key', 20),
      body: `<p class="muted">${E(A().email)}</p>${field('PIN', 'cur', '', 'type="password" inputmode="numeric" autocomplete="off"')}${field('New PIN', 'next', '', 'type="password" inputmode="numeric" autocomplete="off"')}${field('Confirm PIN', 'confirm', '', 'type="password" inputmode="numeric" autocomplete="off"')}${fieldCheck('Include letters and symbols', 'letters', false)}`,
      buttons: [{ label: 'OK', primary: true, value: true, validate: box => { const f = readForm(box); return changePin(f.cur, f.next, f.confirm, f.letters); } }, { label: 'Cancel', value: null }],
    });
  }

  page('sign-in', {
    title: 'Sign-in options', parent: 'accounts', icon: 'key', keywords: 'pin password windows hello face fingerprint dynamic lock',
    render(ctx) {
      const a = A();
      const unavailable = sub({ idx: false, html: `<span class="row-text"><span class="row-desc">This option is currently unavailable</span></span>` });
      return `${sec('Ways to sign in')}
      ${exp(ctx, { id: 'face', icon: 'face', title: 'Facial recognition (Windows Hello)', desc: 'This option is currently unavailable', keywords: 'face camera', body: unavailable })}
      ${exp(ctx, { id: 'fingerprint', icon: 'fingerprint', title: 'Fingerprint recognition (Windows Hello)', desc: 'This option is currently unavailable', keywords: 'fingerprint reader', body: unavailable })}
      ${exp(ctx, { id: 'pin', icon: 'keyboard', title: 'PIN (Windows Hello)', desc: 'Sign in with a PIN (Recommended)', keywords: 'change pin', open: true,
        body: sub({ title: 'Change PIN', id: 'change-pin', keywords: 'pin', end: btn('Change PIN', 'change-pin') })
          + sub({ title: 'Remove this sign-in option', idx: false, desc: 'To remove this sign-in option, first turn off the setting below.', end: btn('Remove', 'noop', 'disabled') })
          + sub({ idx: false, html: link('I forgot my PIN', 'forgot-pin') }) })}
      ${exp(ctx, { id: 'security-key', icon: 'usb', title: 'Security key', desc: 'Sign in with a physical security key', body: sub({ title: 'Security key', idx: false, end: btn('Manage', 'noop-ext') }) })}
      ${exp(ctx, { id: 'password', icon: 'key', title: 'Password', desc: 'Sign in with your account\'s password', body: sub({ idx: false, html: '<span class="row-text"><span class="row-desc">You\'re all set up to sign in with your Microsoft account password.</span></span>' }) })}
      ${exp(ctx, { id: 'picture-password', icon: 'picture', title: 'Picture password', desc: 'Swipe and tap your favorite photo to unlock your device', body: unavailable })}
      ${sec('Additional settings')}
      ${row({ title: 'For improved security, only allow Windows Hello sign-in for Microsoft accounts on this device (Recommended)', end: tgl('account.helloOnly', 'Only allow Windows Hello sign-in') })}
      ${row({ title: 'If you\'ve been away, when should Windows require you to sign in again?', id: 'require-sign-in', keywords: 'sleep wake lock', end: sel('account.requireSignIn', ['Every Time', 'When PC wakes up from sleep', 'Never'], 'Require sign-in') })}
      ${exp(ctx, { id: 'dynamic-lock', icon: 'lock', title: 'Dynamic lock', desc: 'Automatically lock your device when you\'re away', keywords: 'bluetooth phone lock',
        body: sub({ html: check('account.dynamicLock', 'Allow Windows to automatically lock your device when you\'re away') })
          + (A().dynamicLock ? sub({ idx: false, html: `<span class="row-text"><span class="row-desc">${btDevices().some(d => d.kind === 'phone') ? 'Dynamic lock is working with your phone named Isaiah\'s Phone.' : 'Pair your phone with this PC over Bluetooth to use dynamic lock.'}</span></span>` }) : '') })}
      ${row({ title: 'Automatically save my restartable apps and restart them when I sign back in', end: tgl('account.autoRestartApps', 'Automatically save my restartable apps') })}
      ${row({ title: 'Show account details such as my email address on the sign-in screen', end: tgl('account.showDetails', 'Show account details on the sign-in screen') })}`;
    },
  });

  page('other-users', {
    title: 'Other users', parent: 'accounts', icon: 'family', keywords: 'add user remove account',
    render(ctx) {
      const others = A().others;
      return `${row({ icon: 'person', title: 'Add other user', id: 'add-user', end: btn('Add account', 'add-user', '', 'accent') })}
      ${others.map((o, i) => exp(ctx, { id: `user-${slug(o.email || o.name)}`, idx: false, iconHtml: `<span class="st-avatar sm" aria-hidden="true">${E(o.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2))}</span>`, title: o.name, desc: `${o.email || 'Local account'}${o.type ? ` · ${o.type}` : ''}`,
        body: sub({ idx: false, title: 'Account options', end: btn('Change account type', 'user-type', `data-id="${i}"`) }) + sub({ idx: false, title: 'Account and data', end: btn('Remove', 'user-remove', `data-id="${i}"`) }) })).join('')}
      ${sec('Set up a kiosk')}${row({ icon: 'apps', title: 'Kiosk', desc: 'Turn this device into a kiosk to use as a digital sign, interactive display, or other things', end: btn('Get started', 'noop-ext') })}`;
    },
  });

  function addUserDialog(owner) {
    const check2 = f => {
      if (!(f.name || '').trim()) return 'Enter a name.';
      const email = (f.email || '').trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
      if (A().others.some(o => (email && o.email === email) || o.name.toLowerCase() === f.name.trim().toLowerCase())) return 'This account is already on this PC.';
      return '';
    };
    return Win.dialog({
      title: 'Microsoft account', owner,
      body: `<p>How will this person sign in?</p>${field('Name', 'name')}${field('Email or phone (leave blank for a local account)', 'email', '', 'type="email"')}${fieldSel('Account type', 'type', ['Standard User', 'Administrator', 'Family member'], 'Standard User')}`,
      buttons: [{ label: 'Next', primary: true, value: box => readForm(box), validate: box => check2(readForm(box)) }, { label: 'Cancel', value: null }],
      onRender: box => liveValidate(box, check2),
    }).then(f => {
      if (!f) return;
      A().others.push({ name: f.name.trim(), email: (f.email || '').trim(), type: f.type });
      Win.save('state');
    });
  }

  page('email-accounts', { title: 'Email & accounts', parent: 'accounts', icon: 'mail', render: () => `${sec('Accounts used by email, calendar, and contacts')}${row({ icon: 'mail', title: A().email, desc: 'Microsoft account', idx: false, end: btn('Manage', 'noop-ext') })}${row({ icon: 'plus', title: 'Add an account', idx: false, end: btn('Add account', 'noop-ext') })}` });
  page('family', { title: 'Family', parent: 'accounts', icon: 'family', render: () => `${A().others.filter(o => o.type === 'Family member').map(o => row({ icon: 'person', title: o.name, desc: o.email, idx: false })).join('')}${row({ icon: 'plus', title: 'Add someone', idx: false, end: btn('Add someone', 'add-user') })}` });
  page('backup', { title: 'Windows Backup', parent: 'accounts', icon: 'cloud', render: () => `${row({ icon: 'folder', title: 'OneDrive folder syncing', desc: 'Syncing', end: btn('Manage sync settings', 'noop-ext'), idx: false })}${row({ icon: 'apps', title: 'Remember my apps', end: tgl('backupApps', 'Remember my apps') })}${row({ icon: 'gear', title: 'Remember my preferences', end: tgl('backupPrefs', 'Remember my preferences') })}` });
  page('work-school', { title: 'Access work or school', parent: 'accounts', icon: 'document', render: () => row({ title: 'Add a work or school account', idx: false, end: btn('Connect', 'noop-ext') }) });
  Object.assign(Win.DefaultState.settings, { backupApps: true, backupPrefs: true, videoEnhance: true });

  /* ======================================================= Time & language */

  const ZONES = ['(UTC-10:00) Hawaii', '(UTC-09:00) Alaska', '(UTC-08:00) Pacific Time (US & Canada)', '(UTC-07:00) Mountain Time (US & Canada)', '(UTC-06:00) Central Time (US & Canada)',
    '(UTC-05:00) Eastern Time (US & Canada)', '(UTC-04:00) Atlantic Time (Canada)', '(UTC) Coordinated Universal Time', '(UTC+00:00) Dublin, Edinburgh, Lisbon, London',
    '(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna', '(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi', '(UTC+08:00) Beijing, Chongqing, Hong Kong, Urumqi', '(UTC+09:00) Osaka, Sapporo, Tokyo', '(UTC+10:00) Canberra, Melbourne, Sydney'];
  const LANGS = ['English (United States)', 'English (United Kingdom)', 'Español (España)', 'Français (France)', 'Deutsch (Deutschland)', 'Italiano (Italia)', 'Português (Brasil)', '日本語'];
  const REGIONS = ['United States', 'United Kingdom', 'Canada', 'Australia', 'Ireland', 'Spain', 'France', 'Germany', 'Mexico', 'Brazil', 'Japan', 'India'];

  page('time', {
    title: 'Time & language', icon: 'language', keywords: 'clock date region',
    render() {
      const now = new Date();
      return `<div class="card st-card st-clockhero" data-row="clock"><div class="st-bigclock" data-clock="time">${E(Win.formatTime(now))}</div><div class="muted" data-clock="date">${E(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</div><div class="muted">${E(S().timezone)}</div></div>
      ${row({ go: 'date-time', icon: 'clock', title: 'Date & time', desc: 'Time zones, automatic clock settings, calendar display' })}
      ${row({ go: 'language', icon: 'language', title: 'Language & region', desc: 'Windows and some apps format dates and time based on your region' })}
      ${row({ go: 'typing', icon: 'keyboard', title: 'Typing', desc: 'Touch keyboard, text suggestions, preferences' })}
      ${row({ go: 'speech', icon: 'mic', title: 'Speech', desc: 'Speech language, speech recognition microphone setup, voices' })}`;
    },
    after: startClock,
  });

  function startClock(root, ctx) {
    const tick = () => {
      const now = new Date();
      root.querySelectorAll('[data-clock="time"]').forEach(el => { el.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: !S().time24 }); });
      root.querySelectorAll('[data-clock="date"]').forEach(el => { el.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); });
    };
    tick();
    ctx.timers.push(setInterval(tick, 1000));
  }

  page('date-time', {
    title: 'Date & time', parent: 'time', icon: 'clock', keywords: 'time zone clock sync 24-hour format',
    render() {
      const s = S();
      const now = new Date();
      return `<div class="card st-card st-clockhero" data-row="current-time"><div class="st-bigclock" data-clock="time">${E(Win.formatTime(now))}</div><div class="muted" data-clock="date"></div></div>
      ${row({ icon: 'clock', title: 'Set time automatically', keywords: 'automatic time', end: tgl('autoTime', 'Set time automatically') })}
      ${row({ icon: 'world', title: 'Set time zone automatically', keywords: 'automatic time zone', end: tgl('autoZone', 'Set time zone automatically') })}
      ${row({ icon: 'calendar', title: 'Set the date and time manually', end: btn('Change', 'set-time', s.autoTime ? 'disabled' : '') })}
      ${row({ icon: 'world', title: 'Time zone', keywords: 'utc eastern pacific', end: Win.select(ZONES, s.timezone, `data-set="timezone" aria-label="Time zone" ${s.autoZone ? 'disabled' : ''}`) })}
      ${row({ icon: 'clock', title: 'Adjust for daylight saving time automatically', end: tgl('dst', 'Adjust for daylight saving time automatically') })}
      ${row({ icon: 'clock', title: 'Time format', id: 'time-format', keywords: '24-hour 12-hour clock military', end: Win.select([['false', '12-hour (1:45 PM)'], ['true', '24-hour (13:45)']], String(!!s.time24), 'data-set="time24" data-type="bool" aria-label="Time format"') })}
      ${row({ icon: 'calendar', title: 'Show additional calendars in the taskbar', end: Win.select(['Don\'t show additional calendars', 'Simplified Chinese (Lunar)', 'Traditional Chinese (Lunar)'], 'Don\'t show additional calendars', 'aria-label="Additional calendars"') })}
      ${row({ icon: 'clock', title: 'Show time and date in the System tray', end: tgl('clockInTray', 'Show time and date in the System tray') })}
      ${row({ icon: 'clock', title: 'Show seconds in system tray clock (uses more power)', id: 'tray-seconds', end: tgl('showSeconds', 'Show seconds in system tray clock') })}
      ${sec('Additional settings')}
      ${row({ icon: 'refresh', title: 'Sync now', id: 'sync-time', keywords: 'time server ntp', desc: `Last successful time synchronization: ${Win.formatDateTime(s.lastTimeSync)}\nTime server: time.windows.com`, end: btn('Sync now', 'sync-time') })}`;
    },
    after: startClock,
  });
  Object.assign(Win.DefaultState.settings, { dst: true });

  page('language', {
    title: 'Language & region', parent: 'time', icon: 'language', keywords: 'display language region format keyboard',
    render(ctx) {
      const s = S();
      return `${sec('Language')}
      ${row({ icon: 'language', title: 'Windows display language', desc: 'Windows features like Settings and File Explorer will appear in this language', end: sel('language', LANGS, 'Windows display language') })}
      ${exp(ctx, { id: 'preferred-languages', icon: 'language', title: 'Preferred languages', desc: 'Microsoft Store apps will appear in the first supported language in this list', end: btn('Add a language', 'noop-ext', '', 'accent'),
        body: sub({ idx: false, title: s.language, desc: 'language pack, text-to-speech, speech recognition, handwriting, basic typing' }) })}
      ${sec('Region')}
      ${row({ icon: 'world', title: 'Country or region', desc: 'Windows and apps might use your country or region to give you local content', end: sel('region', REGIONS, 'Country or region') })}
      ${exp(ctx, { id: 'regional-format', icon: 'calendar', title: 'Regional format', desc: 'Windows and some apps format dates and times based on your regional format', end: sel('regionalFormat', LANGS, 'Regional format'),
        body: props([['Calendar', 'Gregorian Calendar'], ['First day of week', 'Sunday'], ['Short date', '10/28/2026'], ['Long date', 'Wednesday, October 28, 2026'], ['Short time', s.time24 ? '13:40' : '1:40 PM'], ['Long time', s.time24 ? '13:40:45' : '1:40:45 PM']])
          + sub({ title: 'Time format', idx: false, end: Win.select([['false', '12-hour'], ['true', '24-hour']], String(!!s.time24), 'data-set="time24" data-type="bool" aria-label="Time format"') }) })}
      ${related([row({ go: 'typing', icon: 'keyboard', title: 'Typing', desc: 'Spell check, autocorrect, text suggestions', idx: false }), row({ act: 'noop-ext', external: true, icon: 'language', title: 'Administrative language settings', idx: false })])}`;
    },
  });

  page('typing', {
    title: 'Typing', parent: 'time', icon: 'keyboard',
    render() {
      return `${row({ title: 'Touch keyboard', go: 'text-input', idx: false })}
      ${row({ title: 'Show text suggestions when typing on the physical keyboard', end: tgl('textSuggest', 'Show text suggestions') })}
      ${row({ title: 'Autocorrect misspelled words', end: tgl('autocorrect', 'Autocorrect misspelled words') })}
      ${row({ title: 'Highlight misspelled words', end: tgl('highlightMisspelled', 'Highlight misspelled words') })}`;
    },
  });
  Object.assign(Win.DefaultState.settings, { textSuggest: false, autocorrect: true, highlightMisspelled: true });

  page('speech', {
    title: 'Speech', parent: 'time', icon: 'mic',
    render() {
      return `${row({ title: 'Speech language', end: Win.select(LANGS.slice(0, 2), 'English (United States)', 'aria-label="Speech language"') })}
      ${row({ title: 'Microphone', desc: 'Get set up for speech recognition', end: btn('Get started', 'noop-ext') })}
      ${row({ title: 'Voices', desc: 'Microsoft David, Microsoft Zira', idx: false })}`;
    },
  });

  /* ================================================================ Gaming */

  page('gaming', {
    title: 'Gaming', icon: 'game', keywords: 'game mode game bar xbox',
    render(ctx) {
      return `${exp(ctx, { id: 'game-bar', icon: 'game', title: 'Game Bar', desc: 'Controller and keyboard shortcuts', keywords: 'xbox game bar win+g',
        body: sub({ title: 'Allow your controller to open Game Bar', end: tgl('gameBar', 'Allow your controller to open Game Bar') }) + sub({ title: 'Open Xbox Game Bar using this button on a controller', idx: false, desc: 'Windows logo key + G' }) })}
      ${exp(ctx, { id: 'captures', icon: 'video', title: 'Captures', desc: 'Save location, recording preferences', keywords: 'screen recording',
        body: sub({ title: 'Captures location', desc: `C:\\Users\\${Win.PERSONA.user}\\Videos\\Captures`, end: btn('Open folder', 'noop-ext') }) + sub({ title: 'Record what happened', end: tgl('captures', 'Record what happened') }) })}
      ${row({ icon: 'game', title: 'Game Mode', id: 'game-mode', desc: 'Optimize your PC for play by turning things off in the background', keywords: 'performance', end: tgl('gameMode', 'Game Mode') })}
      ${related([row({ go: 'graphics', icon: 'shapes', title: 'Graphics', idx: false })])}`;
    },
  });

  /* ========================================================= Accessibility */

  page('accessibility', {
    title: 'Accessibility', icon: 'access', keywords: 'ease of access vision hearing',
    render() {
      const s = S();
      return `${sec('Vision')}
      ${row({ go: 'text-size', icon: 'text', title: 'Text size', desc: 'Text size throughout Windows and apps', keywords: 'bigger font larger' })}
      ${row({ go: 'visual-effects', icon: 'sparkle', title: 'Visual effects', desc: 'Scroll bars, transparency, animations, notification timeout', keywords: 'animation effects scrollbar' })}
      ${row({ go: 'mouse', icon: 'mouse', title: 'Mouse pointer and touch', desc: 'Mouse pointer color, size', idx: false })}
      ${row({ go: 'magnifier', icon: 'zoomin', title: 'Magnifier', desc: 'Magnifier view, zoom level, smoothing', keywords: 'zoom', end: tgl('magnifier', 'Magnifier') })}
      ${row({ go: 'color-filters', icon: 'filter', title: 'Color filters', desc: 'Colorblindness filters, grayscale, inverted', keywords: 'colorblind grayscale', end: tgl('colorFilters', 'Color filters') })}
      ${row({ go: 'contrast-themes', icon: 'eye', title: 'Contrast themes', desc: 'Color themes for low vision, light sensitivity', keywords: 'high contrast' })}
      ${row({ go: 'narrator', icon: 'sound', title: 'Narrator', desc: 'Voice, verbosity, keyboard, braille', keywords: 'screen reader', end: tgl('narrator', 'Narrator') })}
      ${sec('Hearing')}
      ${row({ icon: 'sound', title: 'Mono audio', desc: 'Combine left and right audio channels into one', idx: false, end: tgl('monoAudio', 'Mono audio') })}
      ${row({ icon: 'text', title: 'Live captions', desc: 'Generate captions for spoken audio', keywords: 'subtitles', end: tgl('captions', 'Live captions') })}
      ${sec('Interaction')}
      ${row({ go: 'a11y-keyboard', icon: 'keyboard', title: 'Keyboard', desc: 'Sticky, Filter, and Toggle keys, on-screen keyboard', keywords: 'sticky keys filter keys' })}
      ${row({ go: 'mouse', icon: 'mouse', title: 'Mouse', desc: 'Mouse keys, speed, acceleration', idx: false })}`;
    },
  });

  page('text-size', {
    title: 'Text size', parent: 'accessibility', icon: 'text', keywords: 'font size larger bigger',
    render(ctx) {
      const v = ctx.drafts.textSize ?? S().textSize;
      return `<div class="card st-card st-textprev" data-row="text-preview"><p style="font-size:${(14 * v / 100).toFixed(1)}px">Drag the slider until the text here is easy to read, then click Apply</p></div>
      ${row({ icon: 'text', title: 'Text size', id: 'text-size-slider', keywords: 'font scale', end: `<span class="st-range wide"><input type="range" min="100" max="225" value="${v}" data-act="text-draft" aria-label="Text size"></span><span class="st-val" data-text-val>${v}%</span>${btn('Apply', 'text-apply', v === S().textSize ? 'disabled' : '', 'accent')}` })}`;
    },
    after(root) { Win.paintRanges(root); },
  });

  page('visual-effects', {
    title: 'Visual effects', parent: 'accessibility', icon: 'sparkle',
    render() {
      return `${row({ title: 'Always show scrollbars', keywords: 'scroll bar', end: tgl('alwaysScrollbars', 'Always show scrollbars') })}
      ${row({ title: 'Transparency effects', idx: false, end: tgl('transparency', 'Transparency effects') })}
      ${row({ title: 'Animation effects', keywords: 'motion reduce animations', end: tgl('animations', 'Animation effects') })}
      ${row({ title: 'Dismiss notifications after this amount of time', end: sel('notifyTimeout', ['5 seconds', '7 seconds', '15 seconds', '30 seconds', '1 minute', '5 minutes'], 'Dismiss notifications after') })}`;
    },
  });
  Object.assign(Win.DefaultState.settings, { alwaysScrollbars: false, notifyTimeout: '5 seconds' });

  page('magnifier', {
    title: 'Magnifier', parent: 'accessibility', icon: 'zoomin',
    render() {
      return `${row({ title: 'Magnifier', desc: 'Windows logo key + Plus (+)', end: tgl('magnifier', 'Magnifier') })}
      ${row({ title: 'Zoom level', end: `<span class="st-endtext">${S().magnifierZoom}%</span><button class="btn" data-act="mag-zoom" data-id="-100" aria-label="Zoom out">−</button><button class="btn" data-act="mag-zoom" data-id="100" aria-label="Zoom in">+</button>` })}
      ${row({ title: 'View', end: Win.select(['Full screen', 'Docked', 'Lens'], 'Full screen', 'aria-label="Magnifier view"') })}`;
    },
  });

  page('color-filters', {
    title: 'Color filters', parent: 'accessibility', icon: 'filter', keywords: 'grayscale inverted colorblind',
    render() {
      const s = S();
      return `<div class="card st-card st-filterprev ${s.colorFilters ? `f-${slug(s.colorFilter)}` : ''}" data-row="filter-preview" aria-hidden="true">${['#e81123', '#ff8c00', '#ffb900', '#107c10', '#0078d4', '#881798'].map(c => `<i style="background:${c}"></i>`).join('')}</div>
      ${row({ title: 'Color filters', id: 'color-filters-toggle', end: tgl('colorFilters', 'Color filters') })}
      <div class="card st-card st-radios" role="radiogroup" aria-label="Color filter">${['Red-green (green weak, deuteranopia)', 'Red-green (red weak, protanopia)', 'Blue-yellow (tritanopia)', 'Grayscale', 'Grayscale inverted', 'Inverted'].map(o => `<label class="check"><input type="radio" name="st-cf" value="${E(o)}" data-set="colorFilter" ${s.colorFilter === o ? 'checked' : ''} ${s.colorFilters ? '' : 'disabled'}><span>${E(o)}</span></label>`).join('')}</div>
      ${row({ title: 'Keyboard shortcut for color filters', desc: 'Windows logo key + Ctrl + C', end: tgl('colorFilterKey', 'Keyboard shortcut for color filters') })}`;
    },
  });
  Object.assign(Win.DefaultState.settings, { colorFilterKey: false });

  const CONTRAST = ['None', 'Aquatic', 'Desert', 'Dusk', 'Night sky'];
  page('contrast-themes', {
    title: 'Contrast themes', parent: 'accessibility', icon: 'eye', keywords: 'high contrast aquatic desert dusk night sky',
    render(ctx) {
      const v = ctx.drafts.contrast ?? S().contrast;
      const pal = { None: ['#ffffff', '#1a1a1a', '#0067c0'], Aquatic: ['#202020', '#ffffff', '#8ee3f0'], Desert: ['#fffaef', '#3d3d3d', '#1c5e75'], Dusk: ['#2d3236', '#b6f6f0', '#a1bfde'], 'Night sky': ['#000000', '#ffffff', '#d6b4fd'] }[v];
      return `<div class="card st-card st-contrastprev" data-row="contrast-preview" style="background:${pal[0]};color:${pal[1]}"><strong>Text</strong> <span style="color:${pal[2]};text-decoration:underline">Hyperlinks</span> <span style="opacity:.6">Inactive text</span></div>
      ${row({ title: 'Contrast themes', id: 'contrast-select', keywords: 'high contrast', end: `${Win.select(CONTRAST, v, 'data-act="contrast-draft" aria-label="Contrast themes"')}${btn('Apply', 'contrast-apply', v === S().contrast ? 'disabled' : '', 'accent')}` })}
      ${row({ title: 'Press left Alt + left Shift + Print Screen to turn contrast themes on and off', idx: false, cls: 'st-plain' })}`;
    },
  });

  page('narrator', {
    title: 'Narrator', parent: 'accessibility', icon: 'sound', keywords: 'screen reader',
    render() {
      return `${row({ title: 'Narrator', desc: 'Windows logo key + Ctrl + Enter', end: tgl('narrator', 'Narrator') })}
      ${row({ title: 'Voice', end: Win.select(['Microsoft Aria (Natural) - English (United States)', 'Microsoft David - English (United States)'], 'Microsoft Aria (Natural) - English (United States)', 'aria-label="Voice"') })}`;
    },
  });

  page('a11y-keyboard', {
    title: 'Keyboard', parent: 'accessibility', icon: 'keyboard', keywords: 'sticky keys filter keys toggle keys on-screen keyboard',
    render() {
      return `${row({ title: 'Sticky keys', id: 'sticky-keys', desc: 'Press one key at a time for keyboard shortcuts', end: tgl('stickyKeys', 'Sticky keys') })}
      ${row({ title: 'Filter keys', desc: 'Ignore brief or repeated keystrokes, change keyboard repeat rates', end: tgl('filterKeys', 'Filter keys') })}
      ${row({ title: 'Toggle keys', desc: 'Play a sound whenever you press Caps lock, Num lock, or Scroll lock', end: tgl('toggleKeys', 'Toggle keys') })}
      ${row({ title: 'On-screen keyboard', desc: 'Press the Windows logo key + Ctrl + O to turn the on-screen keyboard on or off', end: tgl('onScreenKeyboard', 'On-screen keyboard') })}
      ${row({ title: 'Mouse keys', desc: 'Use the numeric keypad to move the mouse pointer', idx: false, end: tgl('mouseKeys', 'Mouse keys') })}`;
    },
  });

  /* ==================================================== Privacy & security */

  Object.assign(Win.DefaultState.settings, {
    deviceEncryption: true, permMaster: { contacts: true, calendar: true, documents: true, pictures: true, radios: true },
    appPermsAll: { location: true, camera: true, microphone: true, contacts: true, calendar: true, documents: true, pictures: true, radios: true },
    appPermsDesktop: { location: true, camera: true, microphone: true },
    localContent: true, trackLaunches: true, suggestedContent: true, feedbackFreq: 'Automatically (Recommended)',
  });
  Object.assign(Win.DefaultState.settings.appPerms, {
    location: { weather: true, maps: true, edge: true, camera: false, photos: false },
    camera: { camera: true, teams: true, edge: true, zoom: true, phonelink: false },
    microphone: { recorder: true, teams: true, edge: true, zoom: true, camera: true },
    contacts: { mail: true, people: true }, calendar: { mail: true, teams: true },
    documents: { office: true, edge: false }, pictures: { photos: true, edge: false }, radios: { phonelink: true },
  });

  const PERMS = {
    location: { title: 'Location', icon: 'location', master: 'location', label: 'Location services', apps: [['weather', 'Weather'], ['maps', 'Maps'], ['edge', 'Microsoft Edge'], ['camera', 'Camera'], ['photos', 'Photos']], desc: 'When location services is turned off, the location of this device can\'t be shared with apps and services.' },
    camera: { title: 'Camera', icon: 'camera', master: 'camera', label: 'Camera access', apps: [['camera', 'Camera'], ['teams', 'Microsoft Teams'], ['edge', 'Microsoft Edge'], ['zoom', 'Zoom Workplace'], ['phonelink', 'Phone Link']], desc: 'Anyone using this device can choose if their apps have camera access when this is on.' },
    microphone: { title: 'Microphone', icon: 'mic', master: 'microphone', label: 'Microphone access', apps: [['recorder', 'Sound Recorder'], ['teams', 'Microsoft Teams'], ['edge', 'Microsoft Edge'], ['zoom', 'Zoom Workplace'], ['camera', 'Camera']], desc: 'Anyone using this device can choose if their apps have microphone access when this is on.' },
    contacts: { title: 'Contacts', icon: 'person', master: 'permMaster.contacts', label: 'Contacts access', apps: [['mail', 'Mail and Calendar'], ['people', 'People']] },
    calendar: { title: 'Calendar', icon: 'calendar', master: 'permMaster.calendar', label: 'Calendar access', apps: [['mail', 'Mail and Calendar'], ['teams', 'Microsoft Teams']] },
    documents: { title: 'Documents', icon: 'document', master: 'permMaster.documents', label: 'Documents library access', apps: [['office', 'Microsoft 365 (Office)'], ['edge', 'Microsoft Edge']] },
    pictures: { title: 'Pictures', icon: 'picture', master: 'permMaster.pictures', label: 'Pictures library access', apps: [['photos', 'Photos'], ['edge', 'Microsoft Edge']] },
    radios: { title: 'Radios', icon: 'bluetooth', master: 'permMaster.radios', label: 'Radio control access', apps: [['phonelink', 'Phone Link']] },
  };

  page('privacy', {
    title: 'Privacy & security', icon: 'shield', keywords: 'permissions privacy security',
    render() {
      const d = S().defender;
      return `${sec('Security')}
      ${row({ go: 'security', icon: 'shield', title: 'Windows Security', desc: 'Antivirus, browser, firewall, and network protection for your device', keywords: 'defender antivirus virus', endText: d.realtime && d.firewall ? '' : 'Actions needed' })}
      ${row({ go: 'find-device', icon: 'location', title: 'Find my device', desc: 'Track your device if you think you\'ve lost it', keywords: 'lost stolen' })}
      ${row({ go: 'device-encryption', icon: 'lock', title: 'Device encryption', desc: 'Help protect your data with encryption', keywords: 'bitlocker' })}
      ${row({ go: 'developers', icon: 'terminal', title: 'For developers', desc: 'These settings are intended for development use only', idx: false })}
      ${sec('Windows permissions')}
      ${row({ go: 'privacy-general', icon: 'lock', title: 'General', desc: 'Advertising ID, local content, app launches, settings suggestion, productivity tools', keywords: 'advertising id' })}
      ${row({ go: 'privacy-speech', icon: 'mic', title: 'Speech', desc: 'Online speech recognition for dictation and other voice-based interactions' })}
      ${row({ go: 'privacy-inking', icon: 'edit', title: 'Inking & typing personalization', desc: 'Personal dictionary, words in your dictionary' })}
      ${row({ go: 'diagnostics', icon: 'data', title: 'Diagnostics & feedback', desc: 'Diagnostic data, inking and typing data, tailored experiences, feedback frequency', keywords: 'telemetry' })}
      ${row({ go: 'activity-history', icon: 'history', title: 'Activity history', desc: 'Options for getting more from your activity history across devices and accounts' })}
      ${row({ go: 'search-permissions', icon: 'search', title: 'Search permissions', desc: 'SafeSearch, cloud content search, search history', keywords: 'safesearch' })}
      ${sec('App permissions')}
      ${Object.entries(PERMS).map(([id, p]) => row({ go: `privacy-${id}`, icon: p.icon, title: p.title, desc: getPath(p.master) === false ? 'Off' : 'On', keywords: `${id} permission privacy` })).join('')}`;
    },
  });

  Object.entries(PERMS).forEach(([id, p]) => page(`privacy-${id}`, {
    title: p.title, parent: 'privacy', icon: p.icon, keywords: `${id} privacy permission apps access`,
    render(ctx) {
      const master = getPath(p.master) !== false;
      const all = master && S().appPermsAll[id] !== false;
      const perms = S().appPerms[id] || {};
      return `${row({ icon: p.icon, title: p.label, id: `${id}-access`, desc: p.desc || '', end: Win.toggle(master, `data-set="${p.master}"`, p.label) })}
      ${row({ title: `Let apps access your ${p.title.toLowerCase()}`, id: `${id}-apps`, desc: 'Choose which apps can access this', end: Win.toggle(all, `data-set="appPermsAll.${id}" ${master ? '' : 'disabled'}`, `Let apps access your ${p.title.toLowerCase()}`) })}
      ${p.apps.map(([k, n]) => row({ idx: false, cls: 'st-indent', iconHtml: Win.appIcons[k] ? Win.appIcon(k, 24) : `<span class="st-appglyph" aria-hidden="true">${E(n[0])}</span>`, title: n,
        desc: all && perms[k] ? (id === 'location' || id === 'camera' || id === 'microphone' ? `Last accessed ${fmtShort(Date.now() - (hash(k + id) % 9) * DAY)}` : '') : '',
        end: Win.toggle(all && !!perms[k], `data-set="appPerms.${id}.${k}" ${all ? '' : 'disabled'}`, n) })).join('')}
      ${S().appPermsDesktop[id] !== undefined ? row({ title: `Let desktop apps access your ${p.title.toLowerCase()}`, desc: 'Desktop apps that have previously accessed your device are listed here', end: Win.toggle(master && S().appPermsDesktop[id], `data-set="appPermsDesktop.${id}" ${master ? '' : 'disabled'}`, `Let desktop apps access your ${p.title.toLowerCase()}`) }) : ''}
      ${id === 'location' ? row({ title: 'Default location', desc: 'Windows, apps, and services can use this when we can\'t detect a more exact location on this PC', end: btn('Set default', 'noop-ext') }) + row({ title: 'Location history', desc: 'Clear the history of where this device has been', end: btn('Clear', 'noop') }) : ''}`;
    },
  }));

  page('security', {
    title: 'Windows Security', parent: 'privacy', icon: 'shield', keywords: 'defender antivirus virus scan firewall real-time protection',
    render(ctx) {
      const d = S().defender;
      const cur = NETX.current();
      const active = cur ? (NETX.profile(cur.ssid)?.profile || 'Public') : '';
      const areas = [
        ['shield', 'Virus & threat protection', d.realtime ? 'No actions needed.' : 'Actions needed.', !d.realtime],
        ['person', 'Account protection', 'No actions needed.', false],
        ['network', 'Firewall & network protection', d.firewall ? 'No actions needed.' : 'Actions needed.', !d.firewall],
        ['apps', 'App & browser control', 'No actions needed.', false],
        ['pc', 'Device security', 'View status and manage hardware security features', false],
        ['heart', 'Device performance & health', 'Reports on the health of your device.', false],
        ['family', 'Family options', 'Manage how your family uses their devices.', false],
      ];
      const scanning = SCAN.running;
      const last = d.lastScan ? `Last scan: ${Win.formatDateTime(d.lastScan)} (quick scan)` : 'No scans have been run yet.';
      return `<div class="card st-card st-prose" data-row="security-intro"><p>Windows Security is your home to view and manage the security and health of your device.</p>${btn('Open Windows Security', 'noop-ext')}</div>
      ${sec('Protection areas')}
      ${areas.map(([icon, t, s2, warn]) => row({ iconHtml: `<span class="st-secico ${warn ? 'warn' : 'ok'}">${g(icon, 20)}</span>`, title: t, desc: s2, idx: false, cls: warn ? 'st-attn' : '' })).join('')}
      ${exp(ctx, { id: 'virus-protection', icon: 'shield', title: 'Virus & threat protection', desc: d.realtime ? 'No current threats.' : 'Real-time protection is off', keywords: 'quick scan antivirus', open: true,
        body: sub({ idx: false, html: `<div class="st-scan"><strong>Current threats</strong><span class="muted">No current threats.</span><span class="muted">${E(last)}</span><span class="muted">${d.threats || 0} threats found.</span><span class="muted">${E((d.lastFiles || 41872).toLocaleString('en-US'))} files scanned.</span>
            ${scanning ? `<div class="st-scanprog"><span data-scan-text>Quick scan running… ${SCAN.pct}%</span><div class="progress"><i data-scan-bar style="width:${SCAN.pct}%"></i></div><span class="muted" data-scan-files>${SCAN.files.toLocaleString('en-US')} files scanned</span></div>` : ''}
            <div>${btn('Quick scan', 'quick-scan', scanning ? 'disabled' : '', 'accent')}</div></div>`, title: 'Quick scan' })
          + (d.realtime ? '' : sub({ idx: false, html: info('warning', '', 'Real-time protection is off, leaving your device vulnerable.', btn('Turn on', 'defender-on')) }))
          + sub({ title: 'Real-time protection', id: 'realtime', desc: 'Locates and stops malware from installing or running on your device.', end: Win.toggle(d.realtime, 'data-act="defender" data-id="realtime"', 'Real-time protection') })
          + sub({ title: 'Cloud-delivered protection', desc: 'Provides increased and faster protection with access to the latest protection data in the cloud.', end: Win.toggle(d.cloud, 'data-act="defender" data-id="cloud"', 'Cloud-delivered protection') })
          + sub({ title: 'Tamper Protection', desc: 'Prevents others from tampering with important security features.', end: Win.toggle(d.tamper, 'data-act="defender" data-id="tamper"', 'Tamper Protection') }) })}
      ${exp(ctx, { id: 'firewall', icon: 'network', title: 'Firewall & network protection', desc: d.firewall ? 'Firewall is on.' : 'Firewall is off', keywords: 'defender firewall',
        body: ['Domain', 'Private', 'Public'].map(n => sub({ idx: false, title: `${n} network${active === n ? ' (active)' : ''}`, desc: d.firewall ? 'Firewall is on.' : 'Firewall is off. Your device may be vulnerable.' })).join('')
          + sub({ title: 'Microsoft Defender Firewall', id: 'defender-firewall', end: Win.toggle(d.firewall, 'data-act="defender" data-id="firewall"', 'Microsoft Defender Firewall') }) })}`;
    },
  });

  const SCAN = { running: false, pct: 0, files: 0, timer: null };
  function quickScan() {
    if (SCAN.running) return;
    Object.assign(SCAN, { running: true, pct: 0, files: 0 });
    repaintAll('security');
    SCAN.timer = setInterval(() => {
      SCAN.pct = Math.min(100, SCAN.pct + 3 + Math.floor(Math.random() * 4));
      SCAN.files += 900 + Math.floor(Math.random() * 700);
      live.forEach(ctx => {
        if (!ctx.root) return;
        ctx.root.querySelectorAll('[data-scan-text]').forEach(el => { el.textContent = `Quick scan running… ${SCAN.pct}%`; });
        ctx.root.querySelectorAll('[data-scan-bar]').forEach(el => { el.style.width = `${SCAN.pct}%`; });
        ctx.root.querySelectorAll('[data-scan-files]').forEach(el => { el.textContent = `${SCAN.files.toLocaleString('en-US')} files scanned`; });
      });
      if (SCAN.pct < 100) return;
      clearInterval(SCAN.timer);
      SCAN.running = false;
      Object.assign(S().defender, { lastScan: Date.now(), threats: 0, lastFiles: SCAN.files });
      Win.save('state');
      Win.toast({ app: 'Windows Security', glyph: 'shield', title: 'Virus & threat protection', body: 'Quick scan finished. No current threats.' });
    }, 220);
  }

  page('find-device', { title: 'Find my device', parent: 'privacy', icon: 'location', render: () => `${row({ icon: 'location', title: 'Find my device', desc: 'Find my device is ' + (S().findMyDevice ? 'on' : 'off'), end: tgl('findMyDevice', 'Find my device') })}${S().location ? '' : info('warning', '', 'Location settings for this device are turned off. Find my device won\'t work until you turn them on.', golink('Location settings', 'privacy-location'))}` });
  page('device-encryption', { title: 'Device encryption', parent: 'privacy', icon: 'lock', render: () => `${row({ icon: 'lock', title: 'Device encryption', desc: 'Helps protect your data from unauthorized access in case your device is lost or stolen', end: tgl('deviceEncryption', 'Device encryption') })}${related([row({ act: 'noop-ext', external: true, title: 'BitLocker drive encryption', idx: false })])}` });
  page('privacy-general', {
    title: 'General', parent: 'privacy', icon: 'lock', keywords: 'advertising id',
    render: () => `${row({ title: 'Let apps show me personalized ads by using my advertising ID', id: 'advertising-id', end: tgl('adId', 'Advertising ID') })}
      ${row({ title: 'Let websites show me locally relevant content by accessing my language list', end: tgl('localContent', 'Locally relevant content') })}
      ${row({ title: 'Let Windows improve Start and search results by tracking app launches', end: tgl('trackLaunches', 'Track app launches') })}
      ${row({ title: 'Show me suggested content in the Settings app', end: tgl('suggestedContent', 'Show me suggested content in the Settings app') })}`,
  });
  page('privacy-speech', { title: 'Speech', parent: 'privacy', icon: 'mic', render: () => row({ title: 'Online speech recognition', desc: 'Use your voice for apps using Microsoft\'s online speech recognition technology', end: tgl('speech', 'Online speech recognition') }) });
  page('privacy-inking', { title: 'Inking & typing personalization', parent: 'privacy', icon: 'edit', render: () => row({ title: 'Custom inking and typing dictionary', desc: 'Uses your typing history and handwriting patterns to create a local user dictionary for you', end: tgl('inking', 'Custom inking and typing dictionary') }) });
  page('diagnostics', {
    title: 'Diagnostics & feedback', parent: 'privacy', icon: 'data', keywords: 'diagnostic data telemetry feedback',
    render: () => `${row({ title: 'Diagnostic data', desc: 'Help improve Windows and keep it secure and up to date', end: sel('diagnostics', ['Required only', 'Optional diagnostic data'], 'Diagnostic data') })}
      ${row({ title: 'Tailored experiences', desc: 'Let Microsoft use your diagnostic data to improve your product experiences with personalized tips, ads, and recommendations', end: tgl('tailored', 'Tailored experiences') })}
      ${row({ title: 'Feedback frequency', desc: 'Windows should ask for my feedback', end: sel('feedbackFreq', ['Automatically (Recommended)', 'Always', 'Once a day', 'Once a week', 'Never'], 'Feedback frequency') })}`,
  });
  page('activity-history', { title: 'Activity history', parent: 'privacy', icon: 'history', render: () => `${row({ title: 'Store my activity history on this device', end: tgl('storeHistory', 'Store my activity history on this device') })}${row({ title: 'Clear activity history for this account', end: btn('Clear history', 'noop') })}` });
  page('search-permissions', { title: 'Search permissions', parent: 'privacy', icon: 'search', keywords: 'safesearch', render: () => `${row({ title: 'SafeSearch', desc: 'Web results in Windows Search', end: sel('safeSearch', ['Strict', 'Moderate', 'Off'], 'SafeSearch') })}${row({ title: 'Search history on this device', end: tgl('searchHistory', 'Search history on this device') })}` });
  Object.assign(Win.DefaultState.settings, { searchHistory: true });

  /* ======================================================== Windows Update */

  const UPD = { checking: false, running: false, timer: null, progress: {} };
  const isDefinition = p => /Security Intelligence/i.test(p.title);
  const histKind = p => (isDefinition(p) ? 'Definition' : /Driver|Extension/i.test(p.title) ? 'Driver' : /Feature Update/i.test(p.title) ? 'Feature' : /Malicious/i.test(p.title) ? 'Other' : 'Quality');

  function updStatusText(p) {
    const pr = UPD.progress[p.id];
    const u = U();
    if (pr) {
      if (pr.phase === 'downloading') return `Downloading - ${pr.pct}%`;
      if (pr.phase === 'installing') return `Installing - ${pr.pct}%`;
      if (pr.phase === 'restart') return 'Pending restart';
      if (pr.phase === 'done') return 'Completed';
      return 'Pending download';
    }
    if (u.status === 'restart') return 'Pending restart';
    return u.status === 'downloading' ? 'Pending download' : 'Pending install';
  }

  function heroFor(u) {
    const paused = u.pausedUntil > Date.now();
    if (UPD.checking) return { icon: 'refresh', title: 'Checking for updates...', desc: '', spin: true, actions: '' };
    if (paused) return { icon: 'pause', title: 'Updates paused', desc: `Your device won't be up to date while updates are paused. Updates will resume on ${fmtDate(u.pausedUntil)}.`, warn: true, actions: btn('Resume updates', 'upd-resume', '', 'accent') };
    if (u.status === 'restart') return { icon: 'restart', title: 'Restart required', desc: u.scheduled ? `A restart is scheduled for ${Win.formatDateTime(u.scheduled)}.` : 'Your device will restart outside of active hours.', warn: true, actions: `${btn('Restart now', 'upd-restart', '', 'accent')}${btn('Schedule the restart', 'upd-schedule')}` };
    if (u.status === 'downloading') return { icon: 'update', title: 'Updates available', desc: `Last checked: ${relDay(u.lastChecked)}`, actions: btn('Download & install all', 'noop', 'disabled', 'accent') };
    if (u.status === 'available' && u.pending.length) return { icon: 'update', title: 'Updates available', desc: `Last checked: ${relDay(u.lastChecked)}`, warn: true, actions: btn('Download & install all', 'upd-install', '', 'accent') };
    return { icon: 'check', title: 'You\'re up to date', desc: `Last checked: ${relDay(u.lastChecked)}`, ok: true, actions: btn('Check for updates', 'upd-check', '', 'accent') };
  }
  const relDay = t => {
    const d = new Date(t);
    const today = new Date();
    const yest = new Date(Date.now() - DAY);
    const time = Win.formatTime(d);
    if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
    if (d.toDateString() === yest.toDateString()) return `Yesterday, ${time}`;
    return `${fmtShort(t)}, ${time}`;
  };

  page('update', {
    title: 'Windows Update', icon: 'update', keywords: 'updates check install patch restart',
    render(ctx) {
      const u = U();
      const h = heroFor(u);
      const showList = u.pending.length && ['available', 'downloading', 'restart'].includes(u.status) && !UPD.checking;
      const paused = u.pausedUntil > Date.now();
      note('check-for-updates', 'Check for updates', 'update now');
      return `<div class="st-uphero" data-row="update-status"><span class="st-upico ${h.ok ? 'ok' : h.warn ? 'warn' : ''} ${h.spin ? 'spin' : ''}" aria-hidden="true">${g(h.icon, 32)}</span>
        <div class="st-uptext"><div class="st-hero-name">${E(h.title)}</div>${h.desc ? `<div class="muted">${E(h.desc)}</div>` : ''}</div><div class="st-upact">${h.actions}</div></div>
      ${showList ? `<div class="card st-card st-uplist" data-row="pending-updates">${u.pending.map(p => {
        const pr = UPD.progress[p.id];
        const bar = pr && (pr.phase === 'downloading' || pr.phase === 'installing');
        return `<div class="st-upitem" data-upd="${E(p.id)}"><span class="row-text"><span class="row-title">${E(p.title)}</span>${bar ? `<div class="progress"><i data-upd-bar style="width:${pr.pct}%"></i></div>` : ''}</span><span class="st-endtext" data-upd-text>${E(updStatusText(p))}</span></div>`;
      }).join('')}</div>` : ''}
      ${row({ icon: 'update', title: 'Get the latest updates as soon as they\'re available', desc: 'Be among the first to get the latest non-security updates, fixes, and improvements as they roll out.', end: tgl('update.getLatest', 'Get the latest updates as soon as they\'re available') })}
      ${sec('More options')}
      ${row({ icon: 'pause', title: 'Pause updates', keywords: 'stop updates delay', desc: paused ? `Paused until ${fmtDate(u.pausedUntil)}` : '',
        end: Win.select([['', paused ? 'Extend pause' : 'Pause for 1 week'], ...[1, 2, 3, 4, 5].map(w => [w, `Pause for ${w} week${w > 1 ? 's' : ''}`])], '', 'data-act="upd-pause" aria-label="Pause updates"') })}
      ${row({ go: 'update-history', icon: 'history', title: 'Update history', keywords: 'installed updates' })}
      ${row({ go: 'update-advanced', icon: 'gear', title: 'Advanced options', desc: 'Delivery optimization, optional updates, active hours, other update settings', keywords: 'active hours' })}
      ${row({ go: 'insider', icon: 'heart', title: 'Windows Insider Program', desc: 'Get preview builds of Windows to share feedback on new features and updates' })}`;
    },
    after() { if (U().status === 'downloading' && !UPD.running) installAll(); },
  });

  function checkUpdates() {
    if (UPD.checking) return;
    UPD.checking = true;
    repaintAll('update');
    setTimeout(() => {
      const u = U();
      UPD.checking = false;
      const prev = u.lastChecked;
      u.lastChecked = Date.now();
      if (!NETX.online()) {
        Win.save('state');
        Win.toast({ app: 'Windows Update', glyph: 'update', title: 'We couldn\'t connect to the update service', body: 'We\'ll try again later, or you can check now. If it still doesn\'t work, make sure you\'re connected to the internet.', transient: true });
        return;
      }
      if (u.status === 'uptodate' && !u.pending.length && Date.now() - prev > 6 * 3600e3) {
        const v = 213 + Math.floor((Date.now() / DAY) % 40);
        u.pending.push({ id: `KB2267602-${v}`, title: `Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.441.${v}.0)`, size: 44e6 });
      }
      if (u.status !== 'restart') u.status = u.pending.length ? 'available' : 'uptodate';
      Win.save('state');
    }, 2400);
  }

  function installAll() {
    const u = U();
    if (UPD.running || !u.pending.length) return;
    if (!NETX.online()) {
      Win.toast({ app: 'Windows Update', glyph: 'update', title: 'There were problems downloading some updates', body: 'Check your internet connection, then try again.', transient: true });
      u.status = 'available';
      Win.save('state');
      return;
    }
    UPD.running = true;
    UPD.progress = Object.fromEntries(u.pending.map(p => [p.id, { phase: 'pending', pct: 0 }]));
    u.status = 'downloading';
    Win.save('state');
    let i = 0;
    UPD.timer = setInterval(() => {
      const list = U().pending;
      const p = list[i];
      if (!p) { clearInterval(UPD.timer); finishInstall(); return; }
      const pr = UPD.progress[p.id] || (UPD.progress[p.id] = { phase: 'pending', pct: 0 });
      if (pr.phase === 'pending') { pr.phase = 'downloading'; pr.pct = 0; repaintAll('update'); return; }
      pr.pct = Math.min(100, pr.pct + 6 + Math.floor(Math.random() * 9));
      if (pr.pct >= 100) {
        if (pr.phase === 'downloading') { pr.phase = 'installing'; pr.pct = 0; } else { pr.phase = isDefinition(p) ? 'done' : 'restart'; i += 1; }
        repaintAll('update');
        return;
      }
      live.forEach(ctx => ctx.root?.querySelectorAll('[data-upd]').forEach(el => {
        if (el.dataset.upd !== p.id) return;
        const t = el.querySelector('[data-upd-text]');
        const b = el.querySelector('[data-upd-bar]');
        if (t) t.textContent = updStatusText(p);
        if (b) b.style.width = `${pr.pct}%`;
      }));
    }, 160);
  }

  function finishInstall() {
    const u = U();
    UPD.running = false;
    const done = u.pending.filter(p => UPD.progress[p.id]?.phase === 'done');
    done.forEach(p => u.history.unshift({ id: p.id, title: p.title, date: Date.now(), kind: histKind(p) }));
    u.pending = u.pending.filter(p => !done.includes(p));
    u.status = u.pending.length ? 'restart' : 'uptodate';
    u.lastChecked = Date.now();
    Win.save('state');
    if (u.status === 'restart') Win.toast({ app: 'Windows Update', glyph: 'restart', title: 'Restart required', body: 'Your device needs to restart to finish installing updates. Select Restart now or schedule a time.', action: () => Win.Settings.open('update') });
  }

  /** Fallback when the shell's session module isn't loaded. */
  function installOnRestart() {
    const u = U();
    u.pending.forEach(p => u.history.unshift({ id: p.id, title: p.title, date: Date.now(), kind: histKind(p) }));
    Object.assign(u, { pending: [], status: 'uptodate', lastChecked: Date.now(), scheduled: 0 });
    UPD.progress = {};
    Win.save('state');
  }

  page('update-history', {
    title: 'Update history', parent: 'update', icon: 'history', keywords: 'installed updates kb',
    render(ctx) {
      const groups = [['Quality', 'Quality updates'], ['Driver', 'Driver updates'], ['Definition', 'Definition updates'], ['Other', 'Other updates'], ['Feature', 'Feature updates']];
      return `${groups.map(([k, t]) => {
        const list = U().history.filter(h => (h.kind || 'Quality') === k);
        return exp(ctx, { id: `hist-${k}`, title: `${t} (${list.length})`, idx: false, open: k === 'Quality',
          body: list.length ? list.map(h => sub({ idx: false, html: `<span class="row-text"><span class="row-title">${E(h.title)}</span><span class="row-desc">Successfully installed on ${E(fmtShort(h.date))}</span></span>${link('Learn more', 'noop-ext')}` })).join('')
            : sub({ idx: false, html: '<span class="row-desc">No updates</span>' }) });
      }).join('')}
      ${related([row({ go: 'uninstall-updates', icon: 'trash', title: 'Uninstall updates', keywords: 'remove update' }), row({ go: 'recovery', icon: 'restart', title: 'Recovery', desc: 'If you\'re having problems with your PC, reset it or go back to a previous version of Windows', idx: false })])}`;
    },
  });

  page('uninstall-updates', {
    title: 'Uninstall updates', parent: 'update-history', icon: 'trash',
    render() {
      const list = U().history.filter(h => (h.kind || 'Quality') === 'Quality');
      return list.map(h => row({ idx: false, title: h.title, desc: `Microsoft Windows · Installed on ${fmtShort(h.date)}`, end: btn('Uninstall', 'upd-uninstall', `data-id="${E(h.id)}"`) })).join('') || '<p class="muted st-empty">There are no updates that can be uninstalled.</p>';
    },
  });

  const HOURS = Array.from({ length: 24 }, (_, h) => [h, new Date(2026, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: !Win.state?.settings?.time24 })]);

  page('update-advanced', {
    title: 'Advanced options', parent: 'update', icon: 'gear', keywords: 'active hours metered optional updates delivery optimization',
    render(ctx) {
      const u = U();
      const ah = u.activeHours;
      const fmtH = h => HOURS[h]?.[1] || '';
      return `${row({ title: 'Receive updates for other Microsoft products', desc: 'Get Microsoft Office and other updates together with Windows updates', end: tgl('update.otherProducts', 'Receive updates for other Microsoft products') })}
      ${row({ title: 'Get me up to date', desc: 'Restart as soon as possible (even during active hours) to finish updating', end: tgl('update.upToDate', 'Get me up to date') })}
      ${row({ title: 'Download updates over metered connections', desc: 'Data charges may apply', end: tgl('update.meteredDownload', 'Download updates over metered connections') })}
      ${row({ title: 'Notify me when a restart is required to finish updating', desc: 'Show a notification when your device requires a restart to finish updating', end: tgl('update.notifyRestart', 'Notify me when a restart is required') })}
      ${exp(ctx, { id: 'active-hours', icon: 'clock', title: 'Active hours', desc: `We won't restart your device during these hours. Currently ${fmtH(ah.start)} to ${fmtH(ah.end)}`, keywords: 'restart schedule',
        end: Win.select([['auto', 'Automatically'], ['manual', 'Manually']], ah.auto ? 'auto' : 'manual', 'data-act="active-mode" aria-label="Adjust active hours"'),
        body: ah.auto ? sub({ idx: false, html: '<span class="row-desc">Windows adjusts active hours automatically based on your device activity.</span>' })
          : sub({ title: 'Start time', idx: false, end: Win.select(HOURS, ah.start, 'data-set="update.activeHours.start" data-type="num" aria-label="Start time"') })
            + sub({ title: 'End time', idx: false, end: Win.select(HOURS, ah.end, 'data-set="update.activeHours.end" data-type="num" aria-label="End time"') }) })}
      ${sec('Additional options')}
      ${row({ go: 'optional-updates', icon: 'plus', title: 'Optional updates', desc: 'Feature, quality, and driver updates' })}
      ${row({ go: 'delivery-optimization', icon: 'data', title: 'Delivery Optimization', desc: 'Bandwidth limits for updates, downloads from other devices' })}
      ${row({ go: 'recovery', icon: 'restart', title: 'Recovery', desc: 'Reset, advanced startup, go back', idx: false })}
      ${row({ go: 'update-advanced', icon: 'apps', title: 'Restart apps', desc: 'Automatically save my restartable apps when I sign out and restart them after I sign in', end: tgl('account.autoRestartApps', 'Restart apps'), idx: false })}`;
    },
  });

  page('optional-updates', { title: 'Optional updates', parent: 'update-advanced', icon: 'plus', render: () => `${info('', '', 'No optional updates available right now.')}` });
  page('delivery-optimization', { title: 'Delivery Optimization', parent: 'update-advanced', icon: 'data', render: () => `${row({ title: 'Allow downloads from other devices', end: tgl('deliveryOpt', 'Allow downloads from other devices') })}${row({ title: 'Download from', idx: false, end: Win.select(['Devices on my local network', 'Devices on my local network, and devices on the internet'], 'Devices on my local network', 'aria-label="Download from"') })}` });
  page('insider', { title: 'Windows Insider Program', parent: 'update', icon: 'heart', render: () => row({ title: 'Join the Windows Insider Program', desc: 'Get preview builds of Windows to share feedback on new features and updates', end: btn('Get started', 'noop-ext', '', 'accent') }) });
  Object.assign(Win.DefaultState.settings, { deliveryOpt: true });

  /* ============================================================ behaviours */

  const uac = name => (Win.UAC ? Win.UAC(name) : Promise.resolve(true));
  const save = (topic = 'state') => Win.save(topic);

  function copyText(text, button) {
    try { navigator.clipboard?.writeText?.(text)?.catch?.(() => {}); } catch { /* no clipboard */ }
    if (button) {
      const old = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { if (button.isConnected) button.textContent = old; }, 1400);
    }
  }

  function setBluetooth(on) {
    const s = S();
    s.bluetooth = !!on;
    btDevices().forEach(d => {
      if (!on) { d.resume = d.connected; d.connected = false; } else if (d.resume) { d.connected = true; delete d.resume; }
      if (d.kind === 'headphones') syncOutput(d);
    });
    save();
  }

  function syncOutput(d) {
    const label = `Headphones (${d.name})`;
    if (d.connected) S().output = label;
    else if (S().output === label) S().output = 'Speakers (Realtek(R) Audio)';
  }

  function setAccent(c) {
    const s = S();
    const prev = String(s.accent).toUpperCase();
    s.recentAccents = [prev, ...(s.recentAccents || []).filter(x => x !== prev && x !== c.toUpperCase())].slice(0, 5);
    s.accent = c;
    s.accentAuto = false;
    save('theme');
  }

  async function keepDisplay(ctx, el) {
    const key = el.dataset.key;
    const value = el.dataset.type === 'num' ? Number(el.value) : el.value;
    const prev = S()[key];
    if (prev === value) return;
    S()[key] = value;
    save();
    const timer = { id: 0 };
    const keep = await Win.dialog({
      title: 'Keep these display settings?', owner: ctx.win,
      body: '<p>Reverting to previous display settings in <span data-count>15</span> seconds.</p>',
      buttons: [{ label: 'Keep changes', value: true, primary: true }, { label: 'Revert', value: false }],
      onRender(box, { close }) {
        let n = 15;
        timer.id = setInterval(() => {
          n -= 1;
          const c = box.querySelector('[data-count]');
          if (c) c.textContent = String(n);
          if (n <= 0) close(false);
        }, 1000);
      },
    });
    clearInterval(timer.id);
    if (keep !== true) { S()[key] = prev; save(); }
  }

  /* ------------------------------------------------------- troubleshooter */

  function diagnose(ctx, kind) {
    const go2 = (page, args) => () => go(ctx, page, args || {});
    const s = S();
    if (kind === 'network') {
      const r = NETX.webReason();
      const ssid = N().connected;
      const props2 = { label: 'Open network properties', run: go2('wifi-props', { ssid }) };
      return {
        airplane: { title: 'Airplane mode is on', body: 'Wireless communication is turned off while airplane mode is on.', fix: { label: 'Turn off airplane mode', run: () => NETX.setAirplane(false) } },
        'adapter-disabled': { title: 'The Wi-Fi adapter is disabled', body: 'Windows can\'t connect to a network because the wireless adapter is turned off.', fix: { label: 'Enable the adapter', run: () => NETX.setAdapter(true) } },
        'wifi-off': { title: 'Wi-Fi is turned off', body: 'Turn on Wi-Fi to connect to a wireless network.', fix: { label: 'Turn on Wi-Fi', run: () => NETX.setWifi(true) } },
        disconnected: { title: 'You aren\'t connected to a network', body: 'Select a network from the list of available networks to connect.', fix: { label: 'Show available networks', run: go2('wifi') } },
        apipa: { title: '"Wi-Fi" doesn\'t have a valid IP configuration', body: 'This PC is using a self-assigned address (169.254.x.x), so it can\'t talk to the router. Check the IP settings for this network.', fix: props2 },
        'no-gateway': { title: 'The default gateway is not available', body: 'The IP settings for this network don\'t match the router. Check the IP address, subnet mask, and gateway.', fix: props2 },
        'no-internet': { title: 'This network doesn\'t have internet access', body: `You're connected to "${ssid}", but it doesn't provide an internet connection. Try connecting to a different network.`, fix: { label: 'Show available networks', run: go2('wifi') } },
        'no-dns': { title: 'The DNS server isn\'t responding', body: 'Your computer appears to be correctly configured, but the device or resource (DNS server) is not responding.', fix: props2 },
        proxy: { title: 'Windows couldn\'t connect to the proxy server', body: 'Web pages can\'t load because the proxy server isn\'t responding. Check the proxy settings.', fix: { label: 'Open proxy settings', run: go2('proxy') } },
        '': { ok: true, title: 'It looks like you\'re connected to the internet', body: 'No problems were detected with your network connection.' },
      }[r];
    }
    if (kind === 'audio') {
      if (s.muted) return { title: 'Your audio is muted', body: 'Sound is turned off for the default output device.', fix: { label: 'Unmute', run: () => { s.muted = false; save(); } } };
      if (!s.volume) return { title: 'The volume is set to 0', body: 'Turn the volume up to hear sound.', fix: { label: 'Set volume to 50%', run: () => { s.volume = 50; save(); } } };
      return { ok: true, title: 'Audio is working', body: `${s.output} is the default output device and the volume is ${s.volume}%.` };
    }
    if (kind === 'mic') return s.microphone ? { ok: true, title: 'Your microphone is ready', body: `${s.input} is the default input device.` } : { title: 'Microphone access is turned off', body: 'Apps can\'t use the microphone until access is allowed.', fix: { label: 'Open microphone settings', run: go2('privacy-microphone') } };
    if (kind === 'camera') return s.camera ? { ok: true, title: 'Your camera is ready', body: 'Integrated Camera is available to apps that have access.' } : { title: 'Camera access is turned off', body: 'Apps can\'t use the camera until access is allowed.', fix: { label: 'Open camera settings', run: go2('privacy-camera') } };
    if (kind === 'bluetooth') return s.bluetooth ? { ok: true, title: 'Bluetooth is working', body: 'No problems were detected.' } : { title: 'Bluetooth is turned off', body: 'Turn on Bluetooth to use wireless devices.', fix: { label: 'Turn on Bluetooth', run: () => setBluetooth(true) } };
    if (kind === 'update') {
      if (U().pausedUntil > Date.now()) return { title: 'Updates are paused', body: 'Your device won\'t get updates until you resume them.', fix: { label: 'Resume updates', run: () => { U().pausedUntil = 0; save(); } } };
      if (!NETX.online()) return { title: 'Windows Update can\'t connect', body: 'Check your internet connection, then try again.', fix: { label: 'Run the network troubleshooter', run: () => troubleshoot(ctx, 'network') } };
      return { ok: true, title: 'Windows Update is working', body: 'No problems were detected.' };
    }
    if (kind === 'printer') {
      const p = Win.state.devices.find(d => d.kind === 'printer');
      if (!p) return { title: 'No printers were found', body: 'Add a printer in Printers & scanners.', fix: { label: 'Open Printers & scanners', run: go2('printers') } };
      return NETX.online() || !p.network ? { ok: true, title: 'Your printer is ready', body: `${p.name} is online.` } : { title: 'The printer is offline', body: `${p.name} is a network printer, and this PC isn't connected to the network.`, fix: { label: 'Run the network troubleshooter', run: () => troubleshoot(ctx, 'network') } };
    }
    return { ok: true, title: 'No problems were detected', body: 'The troubleshooter didn\'t find anything that needs to change.' };
  }

  function troubleshoot(ctx, kind) {
    return Win.dialog({
      title: 'Get Help', owner: ctx.win, width: 520,
      body: '<div class="st-ts"><div class="ring" aria-hidden="true"></div><p>Detecting problems…</p></div>',
      buttons: [{ label: 'Close', value: null }],
      onRender(box, { close }) {
        setTimeout(() => {
          const host = box.querySelector('.st-ts');
          if (!host) return;
          const res = diagnose(ctx, kind);
          host.innerHTML = `${g(res.ok ? 'check' : 'warning', 24, res.ok ? 'st-good' : 'st-warn')}<div><strong>${E(res.title)}</strong><p>${E(res.body)}</p>${res.fix ? `<button class="btn accent" data-fix>${E(res.fix.label)}</button>` : ''}<p class="muted st-ts-q">Did this solve your problem?</p></div>`;
          host.querySelector('[data-fix]')?.addEventListener('click', () => { close(null); res.fix.run(); });
        }, 1700);
      },
    });
  }

  /* --------------------------------------------------------- Add a device */

  function addDeviceDialog(ctx) {
    const FOUND = {
      bt: [{ name: 'Contoso Wireless Keyboard', kind: 'keyboard', battery: 92 }, { name: 'Fabrikam Speaker Mini', kind: 'speaker' }],
      display: [{ name: 'Living Room TV', kind: 'display' }],
      other: [{ name: 'Fabrikam Media Server', kind: 'media' }],
    };
    return Win.dialog({
      title: 'Add a device', owner: ctx.win, width: 520,
      body: '<div class="st-add"></div>',
      buttons: [{ label: 'Cancel', value: null }],
      onRender(box) {
        const host = box.querySelector('.st-add');
        const cancel = box.querySelector('.dlg-actions .btn');
        const pick = () => {
          host.innerHTML = `<p>Choose the kind of device you want to add.</p>
            <button class="st-addopt" data-kind="bt">${g('bluetooth', 24)}<span><strong>Bluetooth</strong><small>Mice, keyboards, pens, or audio and other kinds of Bluetooth devices</small></span></button>
            <button class="st-addopt" data-kind="display">${g('project', 24)}<span><strong>Wireless display or dock</strong><small>Wireless monitors, TVs, or PCs that use Miracast, or wireless docks</small></span></button>
            <button class="st-addopt" data-kind="other">${g('devices', 24)}<span><strong>Everything else</strong><small>Xbox controllers with Wireless Adapter, DLNA, and more</small></span></button>`;
        };
        const scan = kind => {
          if (kind === 'bt' && !S().bluetooth) {
            host.innerHTML = `<p>Make sure Bluetooth is turned on.</p><button class="btn accent" data-bt-on>Turn on Bluetooth</button>`;
            host.querySelector('[data-bt-on]').addEventListener('click', () => { setBluetooth(true); scan('bt'); });
            return;
          }
          host.innerHTML = `<p>Make sure your device is turned on and discoverable. Select a device below to connect.</p><div class="st-addlist"><div class="st-addscan"><div class="ring st-ring-sm" aria-hidden="true"></div><span class="muted">Searching for devices</span></div></div>`;
          setTimeout(() => {
            const list = host.querySelector('.st-addlist');
            if (!list) return;
            const known = new Set(Win.state.devices.map(d => d.name));
            const items = FOUND[kind].filter(d => !known.has(d.name));
            list.innerHTML = items.length ? items.map((d, i) => `<button class="st-addopt" data-found="${i}">${g(devGlyph(d.kind), 24)}<span><strong>${E(d.name)}</strong><small>${kind === 'bt' ? 'Bluetooth' : kind === 'display' ? 'Wireless display' : 'Network device'}</small></span></button>`).join('')
              : '<p class="muted">No new devices were found.</p>';
            list.querySelectorAll('[data-found]').forEach(b => b.addEventListener('click', () => pair(kind, items[Number(b.dataset.found)])));
          }, 2200);
        };
        const pair = (kind, d) => {
          host.innerHTML = `<div class="st-addscan"><div class="ring st-ring-sm" aria-hidden="true"></div><span>Connecting to ${E(d.name)}</span></div>`;
          setTimeout(() => {
            if (!host.isConnected) return;
            Win.state.devices.push({ id: Win.uid('dev'), name: d.name, kind: d.kind, paired: true, connected: true, battery: d.battery, network: kind === 'other' || undefined });
            save();
            host.innerHTML = `<div class="st-addscan">${g('check', 24, 'st-good')}<strong>Your device is ready to go!</strong></div><p class="muted">${E(d.name)}</p>`;
            if (cancel) cancel.textContent = 'Done';
          }, 1300);
        };
        host.addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (b) scan(b.dataset.kind); });
        pick();
      },
    });
  }

  /* ------------------------------------------------------- other dialogs */

  function renameDialog(ctx) {
    return Win.dialog({
      title: 'Rename your PC', owner: ctx.win,
      body: `<p>You can use a combination of letters, hyphens, and numbers.</p><p class="muted">Current PC name: ${E(deviceName())}</p>${field('Rename your PC', 'name', '', 'maxlength="15"')}`,
      buttons: [{ label: 'Next', primary: true, value: true, validate: box => renamePC(readForm(box).name) }, { label: 'Cancel', value: null }],
    }).then(ok => {
      if (!ok) return;
      Win.dialog({ title: 'Restart your device to apply this change', owner: ctx.win, body: `<p>Your PC will be renamed ${E(deviceName())} after it restarts.</p>`, buttons: [{ label: 'Restart now', value: true, primary: true }, { label: 'Restart later', value: false }] })
        .then(now => { if (now) Win.Session?.restart?.(); });
    });
  }

  function addNetworkDialog(ctx) {
    const check2 = f => {
      const name = (f.ssid || '').trim();
      if (!name) return 'Enter a network name.';
      if (name.length > 32) return 'The network name can be up to 32 characters.';
      if (NETX.profile(name)) return 'This network is already saved on this PC.';
      if (f.security !== 'Open' && (f.key || '').length < 8) return 'The security key must be at least 8 characters.';
      return '';
    };
    return Win.dialog({
      title: 'Add a new network', owner: ctx.win, width: 480,
      body: `${field('Network name', 'ssid')}${fieldSel('Security type', 'security', ['Open', 'WPA2-Personal AES', 'WPA3-Personal AES'], 'WPA2-Personal AES')}<div class="st-key">${field('Security key', 'key', '', 'type="password"')}</div>
        ${fieldCheck('Connect automatically', 'auto', true)}${fieldCheck('Connect even if this network is not broadcasting', 'hidden', false)}`,
      buttons: [{ label: 'Save', primary: true, value: box => readForm(box), validate: box => check2(readForm(box)) }, { label: 'Cancel', value: null }],
      onRender(box) { showWhen(box, 'security', { '.st-key': f => f.security !== 'Open' }); liveValidate(box, check2); },
    }).then(f => {
      if (!f) return;
      const ssid = f.ssid.trim();
      N().known.push({ ssid, password: f.security === 'Open' ? '' : f.key, auto: !!f.auto, metered: false, randomMac: N().randomMac ? 'On' : 'Off', profile: 'Public',
        ipMode: 'dhcp', ip: '', mask: '255.255.255.0', gateway: '', dnsMode: 'auto', dns: [], dnsEncryption: 'Unencrypted only' });
      save('network');
      if (f.auto && !N().connected && NETX.lookup(ssid) && NETX.radioOn()) NETX.connect(ssid);
    });
  }

  function appMenu(ctx, el) {
    const a = Win.state.apps.find(x => x.id === el.dataset.id);
    if (!a) return;
    const r = el.getBoundingClientRect();
    Win.menu(r.left - 140, r.bottom + 2, [
      { label: 'Advanced options', disabled: !a.system && a.id !== 'office', action: () => Win.alert(a.name, `Version ${a.version}\n${a.publisher}`, ctx.win) },
      { label: 'Modify', disabled: a.id !== 'office', action: () => repairDialog(ctx, a) },
      { label: 'Move', disabled: true },
      { label: 'Uninstall', disabled: !!a.system, action: () => uninstallApp(ctx, a.id) },
    ]);
  }

  function repairDialog(ctx, a) {
    return Win.dialog({
      title: `How would you like to repair your Office programs?`, owner: ctx.win,
      body: `<label class="st-radio"><input type="radio" name="kind" value="quick" checked><span><strong>Quick Repair</strong><small>Fixes most issues quickly, without an internet connection.</small></span></label>
        <label class="st-radio"><input type="radio" name="kind" value="online"><span><strong>Online Repair</strong><small>Fixes all issues but takes a little longer. Requires an internet connection.</small></span></label>`,
      buttons: [{ label: 'Repair', primary: true, value: box => readForm(box).kind, validate: box => (readForm(box).kind === 'online' && !NETX.online() ? 'Online Repair needs an internet connection.' : '') }, { label: 'Cancel', value: null }],
    }).then(kind => { if (kind) setTimeout(() => Win.toast({ app: a.name, glyph: 'check', title: 'Done repairing', body: 'Your Office programs were repaired.' }), 2500); });
  }

  function devMenu(ctx, el) {
    const d = Win.state.devices.find(x => x.id === el.dataset.id);
    if (!d) return;
    const r = el.getBoundingClientRect();
    Win.menu(r.left - 160, r.bottom + 2, [
      { label: d.connected ? 'Disconnect' : 'Connect', disabled: !S().bluetooth, action: () => devConnect(d.id) },
      { label: 'Remove device', action: () => devRemove(ctx, d.id) },
    ]);
  }

  function devConnect(id) {
    const d = Win.state.devices.find(x => x.id === id);
    if (!d || d.connecting) return;
    if (d.connected) { d.connected = false; if (d.kind === 'headphones') syncOutput(d); save(); return; }
    d.connecting = true;
    save();
    setTimeout(() => {
      delete d.connecting;
      d.connected = !!S().bluetooth;
      if (d.kind === 'headphones') syncOutput(d);
      save();
    }, 1200);
  }

  async function devRemove(ctx, id) {
    const d = Win.state.devices.find(x => x.id === id);
    if (!d) return;
    if (!(await Win.confirm('Remove device', 'Are you sure you want to remove this device?', { ok: 'Yes', cancel: 'No', owner: ctx.win }))) return;
    if (d.kind === 'headphones') { d.connected = false; syncOutput(d); }
    Win.state.devices = Win.state.devices.filter(x => x.id !== id);
    save();
  }

  function resetPC(ctx) {
    return Win.dialog({
      title: 'Choose an option', owner: ctx.win, width: 520,
      body: `<button class="st-addopt" data-opt="keep"><span><strong>Keep my files</strong><small>Removes apps and settings, but keeps your personal files.</small></span></button>
        <button class="st-addopt" data-opt="all"><span><strong>Remove everything</strong><small>Removes all of your personal files, apps, and settings.</small></span></button>`,
      buttons: [{ label: 'Cancel', value: null }],
      onRender(box, { close }) { box.addEventListener('click', e => { const b = e.target.closest('[data-opt]'); if (b) close(b.dataset.opt); }); },
    }).then(async opt => {
      if (!opt) return;
      const ok = await Win.confirm('Ready to reset this PC', opt === 'keep' ? 'Resetting will remove all apps and programs that didn\'t come with this PC and change settings back to their defaults. Your personal files will be kept.' : 'Resetting will remove all personal files and user accounts, all apps and programs, and any changes made to settings.', { ok: 'Reset', cancel: 'Cancel', owner: ctx.win });
      if (!ok) return;
      const keep = opt === 'keep' ? { fs: Win.state.fs, recent: Win.state.recent, account: Win.state.account } : {};
      Win.state = Object.assign(Win.clone(Win.DefaultState), keep);
      Win.Store.save();
      setTimeout(() => location.reload(), 300);
    });
  }

  function scheduleRestart(ctx) {
    const opts = Array.from({ length: 12 }, (_, i) => { const t = new Date(); t.setHours(t.getHours() + i + 1, 0, 0, 0); return [t.getTime(), Win.formatDateTime(t.getTime())]; });
    return Win.dialog({
      title: 'Schedule the restart', owner: ctx.win,
      body: fieldSel('Pick a time', 'when', opts, opts[0][0]),
      buttons: [{ label: 'Schedule', primary: true, value: box => Number(readForm(box).when) }, { label: 'Cancel', value: null }],
    }).then(t => { if (t) { U().scheduled = t; save(); } });
  }

  const INPUT_ACTS = new Set(['app-q', 'known-q', 'def-q', 'net-key', 'text-draft']);

  const ACTIONS = {
    noop() {},
    'noop-ext'() {},
    'open-app': el => { if (Win.apps.get(el.dataset.id)) Win.wm.open(el.dataset.id); },
    'rename-pc': (el, ctx) => renameDialog(ctx),
    identify() {
      const host = Win.$('#overlay-layer') || document.body;
      const tag = Win.html('<div class="st-identify" aria-hidden="true">1</div>');
      host.appendChild(tag);
      setTimeout(() => tag.remove(), 2600);
    },
    'detect-display'(el, ctx) { ctx.flash = 'detect'; repaint(ctx); setTimeout(() => { ctx.flash = ''; }, 4000); },
    cast() { Win.Flyout?.open?.('cast'); },
    'display-keep': (el, ctx) => keepDisplay(ctx, el),
    'night-now'() { S().nightLight = !S().nightLight; save('theme'); },
    mute() { S().muted = !S().muted; save(); },
    'add-device': (el, ctx) => addDeviceDialog(ctx),
    troubleshoot: (el, ctx) => troubleshoot(ctx, el.dataset.id),
    'focus-step'(el) { S().focusMinutes = Win.clamp(S().focusMinutes + Number(el.dataset.id), 5, 240); save(); },
    'focus-start': () => startFocus(),
    'focus-stop': () => endFocus(false),
    'storage-more'(el, ctx) { ctx.drafts.storageMore = !ctx.drafts.storageMore; repaint(ctx); },
    'clean-temp'() { S().storageFreed = (S().storageFreed || 0) + (S().tempBytes || 0); S().tempBytes = 0; save(); },
    'large-pick'(el, ctx) { const set = ctx.drafts.large || (ctx.drafts.large = new Set()); if (el.checked) set.add(el.dataset.id); else set.delete(el.dataset.id); repaint(ctx); },
    async 'clean-large'(el, ctx) {
      const ids = [...(ctx.drafts.large || [])];
      if (!ids.length || !(await Win.confirm('Delete files', `Are you sure you want to delete ${ids.length} file${ids.length === 1 ? '' : 's'}?`, { owner: ctx.win }))) return;
      ids.forEach(id => Win.FS.remove(id));
      ctx.drafts.large = new Set();
      repaint(ctx);
    },
    async 'empty-bin'(el, ctx) {
      const n = Win.FS.children('bin', { hidden: true }).length;
      if (!n || !(await Win.confirm('Delete Multiple Items', `Are you sure you want to permanently delete ${n === 1 ? 'this item' : `these ${n} items`}?`, { owner: ctx.win }))) return;
      Win.FS.emptyBin();
    },
    'sense-now'() {
      const freed = S().tempBytes || 0;
      ACTIONS['clean-temp']();
      Win.toast({ app: 'Storage Sense', glyph: 'storage', title: 'Storage Sense', body: freed ? `We freed up ${Win.bytes(freed)} of space.` : 'There was nothing to clean up.' });
    },
    'product-key': (el, ctx) => Win.prompt('Enter a product key', 'Product key', '', {
      owner: ctx.win, ok: 'Next',
      validate: v => (!/^[A-Z0-9]{5}(-[A-Z0-9]{5}){4}$/i.test(v.trim()) ? 'Enter a 25-character product key, like XXXXX-XXXXX-XXXXX-XXXXX-XXXXX.' : 'This product key didn\'t work. Please check it and try again, or try a different key. (0xC004F050)'),
    }),
    'reset-pc': (el, ctx) => resetPC(ctx),
    async 'advanced-startup'(el, ctx) { if (await Win.confirm('We\'ll restart your device, so save your work', 'Your device will restart into the Windows Recovery Environment.', { ok: 'Restart now', cancel: 'Cancel', owner: ctx.win })) Win.Session?.restart?.(); },
    async rdp(el, ctx) {
      if (el.checked && !(await Win.confirm('Enable Remote Desktop?', 'You and any users you choose will be able to connect to this PC.', { ok: 'Confirm', cancel: 'Cancel', owner: ctx.win }))) { el.checked = false; repaint(ctx); return; }
      S().remoteDesktop = el.checked;
      save();
    },
    'copy-text': el => copyText(el.dataset.id, el),
    'clear-clipboard'(el, ctx) { Win.state.clipboard = null; ctx.flash = 'clip'; save(); setTimeout(() => { ctx.flash = ''; }, 3000); },
    'copy-specs': el => copyText((el.dataset.id === 'device' ? SPECS() : WINSPECS()).map(([k, v]) => `${k}\t${v}`).join('\r\n'), el),
    'copy-props'(el) {
      const box = el.closest('.st-props');
      const text = box ? [...box.querySelectorAll('.st-prop')].map(p => `${p.querySelector('.st-pk').textContent}\t${p.querySelector('.st-pv').textContent}`).join('\r\n') : '';
      copyText(text, el);
    },

    /* network */
    'wifi-toggle': el => NETX.setWifi(el.checked),
    airplane: el => NETX.setAirplane(el.checked),
    hotspot(el) { N().hotspot = el.checked && NETX.online(); save('network'); },
    'net-pick'(el, ctx) {
      const id = el.dataset.id;
      ctx.wf = ctx.wf.sel === id && ctx.wf.stage !== 'busy' ? { sel: '', stage: 'idle', error: '', auto: true, key: '' } : { sel: id, stage: 'idle', error: '', auto: NETX.profile(id)?.auto ?? true, key: '' };
      repaint(ctx);
    },
    'net-connect': (el, ctx) => connectNet(ctx, el.dataset.id),
    'net-cancel'(el, ctx) { ctx.wf = { sel: ctx.wf.sel, stage: 'idle', error: '', auto: ctx.wf.auto, key: '' }; repaint(ctx); },
    'net-key'(el, ctx) { ctx.wf.key = el.value; },
    'net-auto'(el, ctx) { ctx.wf.auto = el.checked; },
    'net-disconnect'(el, ctx) { ctx.wf.sel = ''; NETX.disconnect(); },
    'net-refresh': (el, ctx) => repaint(ctx),
    reveal(el) { const input = el.parentElement.querySelector('input'); if (input) { input.type = input.type === 'password' ? 'text' : 'password'; el.setAttribute('aria-pressed', String(input.type === 'text')); } },
    'known-q'(el, ctx) { ctx.drafts.knownQ = el.value; repaint(ctx); },
    'known-sort'(el, ctx) { ctx.drafts.knownSort = el.value; repaint(ctx); },
    forget: el => NETX.forget(el.dataset.id),
    'add-network': (el, ctx) => addNetworkDialog(ctx),
    prof(el) {
      const p = NETX.profile(el.dataset.id);
      if (!p) return;
      const key = el.dataset.key;
      if (el.type === 'radio' && !el.checked) return;
      p[key] = el.type === 'checkbox' ? el.checked : el.value;
      save('network');
    },
    'edit-ip': (el, ctx) => editIP(el.dataset.id, ctx.win),
    'edit-dns': (el, ctx) => editDNS(el.dataset.id, ctx.win),
    'view-key'(el, ctx) {
      const p = NETX.profile(el.dataset.id);
      if (p) Win.dialog({ title: 'View Wi-Fi security key', owner: ctx.win, body: `<p>Network: ${E(p.ssid)}</p><div class="st-keybox">${E(p.password || '(none)')}</div>`, buttons: [{ label: 'Close', value: true, primary: true }] });
    },
    'proxy-script': (el, ctx) => proxyScriptDialog(ctx.win),
    'proxy-manual': (el, ctx) => proxyManualDialog(ctx.win),
    'add-vpn': (el, ctx) => addVpnDialog(ctx.win),
    'vpn-connect': (el, ctx) => vpnConnect(ctx, Number(el.dataset.id)),
    async 'vpn-remove'(el, ctx) {
      const v = N().vpns[Number(el.dataset.id)];
      if (v && await Win.confirm('Remove VPN connection', `If you remove this VPN connection, you'll need to add it again to reconnect.`, { ok: 'Remove', cancel: 'Cancel', owner: ctx.win })) { N().vpns = N().vpns.filter(x => x !== v); save('network'); }
    },
    'hotspot-edit': (el, ctx) => hotspotDialog(ctx.win),
    async adapter(el) {
      const n = N();
      if (el.dataset.id === 'wifi') {
        if (n.adapterEnabled.wifi && !(await uac('Network Connections'))) return;
        NETX.setAdapter(!n.adapterEnabled.wifi);
      } else {
        n.adapterEnabled.bluetoothPan = !n.adapterEnabled.bluetoothPan;
        save('network');
      }
    },
    async 'network-reset'(el, ctx) {
      if (await Win.confirm('Network reset', 'Are you sure you want to reset your network settings?', { ok: 'Yes', cancel: 'No', owner: ctx.win })) doNetworkReset();
    },
    'data-limit'(el, ctx) {
      if (N().meteredLimit) { N().meteredLimit = ''; save('network'); return; }
      Win.prompt('Set data limit', 'Data limit (GB)', '', { owner: ctx.win, ok: 'Save', validate: v => (/^\d+(\.\d+)?$/.test(v.trim()) && Number(v) > 0 ? '' : 'Enter a number greater than 0.') })
        .then(v => { if (v) { N().meteredLimit = v.trim(); save('network'); } });
    },

    /* devices */
    'bt-toggle': el => setBluetooth(el.checked),
    'dev-menu': (el, ctx) => devMenu(ctx, el),
    'dev-connect': el => devConnect(el.dataset.id),
    'dev-remove': (el, ctx) => devRemove(ctx, el.dataset.id),
    'printer-scan'(el, ctx) {
      ctx.drafts.printerScan = 'scanning';
      ctx.open.add('add-printer');
      repaint(ctx);
      setTimeout(() => { if (ctx.drafts.printerScan === 'scanning') { ctx.drafts.printerScan = 'done'; repaint(ctx); } }, 2000);
    },
    'printer-add'(el, ctx) {
      Win.state.devices.push({ id: 'fabrikam-lj', name: 'Fabrikam LaserJet M210', kind: 'printer', paired: true, connected: true, network: true });
      ctx.drafts.printerScan = '';
      save();
    },

    /* personalization */
    'apply-theme': el => applyPreset(el.dataset.id),
    wallpaper(el) { S().wallpaper = el.dataset.id; S().lastWallpaper = el.dataset.id; save('theme'); },
    'bg-mode'(el) {
      const s = S();
      if (el.value === 'solid') { if (s.wallpaper !== 'solid') s.lastWallpaper = s.wallpaper; s.wallpaper = 'solid'; } else s.wallpaper = s.lastWallpaper || wallpapers()[0]?.id || 'glow-light';
      save('theme');
    },
    solid(el) { S().solidColor = el.dataset.id; S().wallpaper = 'solid'; save('theme'); },
    'solid-custom'(el) { S().solidColor = el.value; S().wallpaper = 'solid'; save('theme'); },
    'browse-photos': (el, ctx) => browsePhotos(ctx.win),
    'color-mode'(el) {
      const s = S();
      if (el.value === 'custom') s.colorMode = 'custom';
      else Object.assign(s, { theme: el.value, appTheme: el.value, colorMode: '' });
      save('theme');
    },
    accent: el => setAccent(el.dataset.id),
    'accent-custom': el => setAccent(el.value),
    'accent-auto'(el) { S().accentAuto = el.value === 'auto'; save('theme'); },
    'desktop-icons': (el, ctx) => desktopIconsDialog(ctx.win),
    'lock-mode'(el) { S().lockSpotlight = el.value === 'spotlight'; save(); },
    'lock-wallpaper'(el) { S().lockWallpaper = el.dataset.id; save('theme'); },

    /* apps */
    'app-q'(el, ctx) { ctx.appQuery = el.value; repaint(ctx); },
    'app-sort'(el, ctx) { ctx.appSort = el.value; repaint(ctx); },
    'app-menu': (el, ctx) => appMenu(ctx, el),
    startup(el) { const a = Win.state.apps.find(x => x.id === el.dataset.id); if (a) { a.startup = el.checked; save(); } },
    'def-q'(el, ctx) { ctx.drafts.defQ = el.value; repaint(ctx); },

    /* accounts */
    async 'account-type'(el, ctx) {
      const a = A();
      const ok = await Win.confirm(a.microsoft ? 'Switch to a local account' : 'Switch to a Microsoft account', a.microsoft ? 'Are you sure you want to switch to a local account? Windows Hello and some apps work best with a Microsoft account.' : `Sign in with ${a.email} to sync your settings across devices.`, { ok: 'Next', cancel: 'Cancel', owner: ctx.win });
      if (ok) { a.microsoft = !a.microsoft; save(); }
    },
    'change-pin': (el, ctx) => pinDialog(ctx.win),
    'forgot-pin'(el, ctx) {
      Win.dialog({
        title: 'Set up a PIN', owner: ctx.win, body: `${field('New PIN', 'next', '', 'type="password" inputmode="numeric"')}${field('Confirm PIN', 'confirm', '', 'type="password" inputmode="numeric"')}`,
        buttons: [{ label: 'OK', primary: true, value: true, validate: box => { const f = readForm(box); return changePin(A().pin, f.next, f.confirm); } }, { label: 'Cancel', value: null }],
      });
    },
    'add-user': (el, ctx) => addUserDialog(ctx.win),
    'user-type'(el, ctx) {
      const o = A().others[Number(el.dataset.id)];
      if (!o) return;
      Win.dialog({ title: 'Change account type', owner: ctx.win, body: `<p>${E(o.name)}</p>${fieldSel('Account type', 'type', ['Standard User', 'Administrator', 'Family member'], o.type || 'Standard User')}`, buttons: [{ label: 'OK', primary: true, value: box => readForm(box).type }, { label: 'Cancel', value: null }] })
        .then(t => { if (t) { o.type = t; save(); } });
    },
    async 'user-remove'(el, ctx) {
      const o = A().others[Number(el.dataset.id)];
      if (o && await Win.confirm('Delete account and data?', `Deleting ${o.name}'s account will remove their data from this PC, including items on their desktop, downloads, documents, photos, music, and other files.`, { ok: 'Delete account and data', cancel: 'Cancel', owner: ctx.win })) {
        A().others = A().others.filter(x => x !== o);
        save();
      }
    },

    /* time */
    'set-time'(el, ctx) {
      const now = new Date(Date.now() + (S().clockOffset || 0));
      const pad = n => String(n).padStart(2, '0');
      Win.dialog({
        title: 'Change date and time', owner: ctx.win,
        body: `<label class="field"><span>Date</span><input class="input" type="date" name="date" value="${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}"></label><label class="field"><span>Time</span><input class="input" type="time" name="time" value="${pad(now.getHours())}:${pad(now.getMinutes())}"></label>`,
        buttons: [{ label: 'Change', primary: true, value: box => readForm(box) }, { label: 'Cancel', value: null }],
      }).then(f => {
        if (!f || !f.date || !f.time) return;
        const t = new Date(`${f.date}T${f.time}`).getTime();
        if (Number.isFinite(t)) { S().clockOffset = t - Date.now(); save(); }
      });
    },
    'sync-time'(el) {
      if (!NETX.online()) { el.textContent = 'Sync failed'; setTimeout(() => { if (el.isConnected) el.textContent = 'Sync now'; }, 2000); return; }
      Object.assign(S(), { lastTimeSync: Date.now(), clockOffset: 0 });
      save();
    },

    /* accessibility */
    'text-draft'(el, ctx) {
      const v = Number(el.value);
      ctx.drafts.textSize = v;
      const scope = ctx.pageEl || el.closest('.st-body');
      const p = scope?.querySelector('.st-textprev p');
      if (p) p.style.fontSize = `${(14 * v / 100).toFixed(1)}px`;
      const out = scope?.querySelector('[data-text-val]');
      if (out) out.textContent = `${v}%`;
      const apply = scope?.querySelector('[data-act="text-apply"]');
      if (apply) apply.disabled = v === S().textSize;
    },
    'text-apply'(el, ctx) { if (ctx.drafts.textSize != null) { S().textSize = ctx.drafts.textSize; delete ctx.drafts.textSize; save('theme'); } },
    'contrast-draft'(el, ctx) { ctx.drafts.contrast = el.value; repaint(ctx); },
    'contrast-apply'(el, ctx) { if (ctx.drafts.contrast != null) { S().contrast = ctx.drafts.contrast; delete ctx.drafts.contrast; save('theme'); } },
    'mag-zoom'(el) { S().magnifierZoom = Win.clamp(S().magnifierZoom + Number(el.dataset.id), 100, 1600); save(); },

    /* security */
    async defender(el, ctx) {
      const key = el.dataset.id;
      const on = el.checked;
      if (!on && !(await uac('Windows Security'))) { repaint(ctx); return; }
      S().defender[key] = on;
      save();
    },
    'defender-on'() { S().defender.realtime = true; save(); },
    'quick-scan': () => quickScan(),

    /* update */
    'upd-check': () => checkUpdates(),
    'upd-install': () => installAll(),
    'upd-restart'() { if (Win.Session?.restart) Win.Session.restart(); else installOnRestart(); },
    'upd-schedule': (el, ctx) => scheduleRestart(ctx),
    'upd-resume'() { U().pausedUntil = 0; save(); },
    'upd-pause'(el) {
      const weeks = Number(el.value);
      if (!weeks) return;
      const base = Math.max(Date.now(), U().pausedUntil || 0);
      U().pausedUntil = Math.min(base + weeks * 7 * DAY, Date.now() + 35 * DAY);
      save();
    },
    async 'upd-uninstall'(el, ctx) {
      const h = U().history.find(x => x.id === el.dataset.id);
      if (h && await Win.confirm('Uninstall', `${h.title} will be uninstalled. Your device will need to restart.`, { ok: 'Uninstall', cancel: 'Cancel', owner: ctx.win })) {
        U().history = U().history.filter(x => x !== h);
        save();
      }
    },
    'active-mode'(el) { U().activeHours.auto = el.value === 'auto'; save(); },
  };

  async function connectNet(ctx, ssid) {
    const net = NETX.lookup(ssid);
    if (!net) return;
    const known = NETX.profile(ssid);
    if (secured(net) && !known && ctx.wf.stage !== 'key') {
      ctx.wf = { ...ctx.wf, sel: ssid, stage: 'key', error: '', key: '' };
      repaint(ctx);
      ctx.root?.querySelector(`#st-key-${ctx.uid}`)?.focus();
      return;
    }
    if (ctx.wf.stage === 'key' && !ctx.wf.key) { ctx.wf.error = 'Enter the network security key.'; repaint(ctx); return; }
    const key = ctx.wf.key;
    ctx.wf = { ...ctx.wf, sel: ssid, stage: 'busy', error: '' };
    repaint(ctx);
    const res = await NETX.connect(ssid, key, { auto: ctx.wf.auto });
    if (ctx.wf.sel !== ssid) return;
    if (res.ok) ctx.wf = { sel: ssid, stage: 'idle', error: '', auto: true, key: '' };
    else ctx.wf = { ...ctx.wf, stage: secured(net) && !NETX.profile(ssid) ? 'key' : 'idle', error: res.error, key: '' };
    repaint(ctx);
    if (ctx.wf.stage === 'key') ctx.root?.querySelector(`#st-key-${ctx.uid}`)?.focus();
  }

  /* ================================================================ search */

  let INDEX = null;
  let indexed = 0;
  function buildIndex() {
    if (INDEX && Date.now() - indexed < 20000) return INDEX;
    const out = [];
    const seen = new Set();
    const add = item => { const k = `${item.page}|${item.title.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); out.push(item); } };
    for (const def of Object.values(P)) add({ page: def.id, title: titleOf(def.id), kw: def.keywords || '', icon: iconOf(def.id) });
    for (const def of Object.values(P)) {
      collecting = { page: def.id, rows: [] };
      try { def.render(makeCtx(null, def.id, {})); } catch { /* skip pages that need live data */ }
      const rows = collecting.rows;
      collecting = null;
      rows.forEach(r => {
        if (r.go && P[r.go] && titleOf(r.go).toLowerCase() === r.title.toLowerCase()) return;
        add({ page: r.go || def.id, row: r.go ? '' : r.row, title: r.title.replace(/:$/, ''), kw: r.kw, icon: iconOf(def.id), from: def.id });
      });
    }
    INDEX = out;
    indexed = Date.now();
    return out;
  }

  function searchSettings(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    return buildIndex().map(item => {
      const t = item.title.toLowerCase();
      const hay = `${t} ${item.kw} ${titleOf(item.from || item.page).toLowerCase()}`;
      if (!words.every(w => hay.includes(w))) return null;
      const score = (t === q ? 100 : 0) + (t.startsWith(q) ? 50 : 0) + (t.includes(q) ? 20 : 0) + (words.every(w => t.includes(w)) ? 10 : 0) + (item.row ? 0 : 5) - t.length / 100;
      return { ...item, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);
  }

  const crumbText = id => chain(id).map(c => titleOf(c)).join(' > ');

  /* ================================================================ window */

  function focusKey(el) {
    if (!el || !el.dataset) return '';
    const d = el.dataset;
    const base = d.set ? `set:${d.set}` : d.act ? `act:${d.act}` : d.go ? `go:${d.go}` : d.exp ? `exp:${d.exp}` : el.id ? `id:${el.id}` : '';
    if (!base) return '';
    return `${base}|${d.id || ''}|${d.key || ''}|${el.type === 'radio' ? el.value : ''}|${el.tagName}`;
  }

  function repaint(ctx, opts = {}) {
    if (!ctx.pageEl) return;
    const def = P[ctx.page] || P.home;
    ctx.timers.forEach(clearInterval);
    ctx.timers = [];
    const scroller = ctx.scroller;
    const top = opts.reset ? 0 : scroller.scrollTop;
    const active = document.activeElement;
    const key = !opts.reset && ctx.pageEl.contains(active) ? focusKey(active) : '';
    const caret = key && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    ctx.pageEl.innerHTML = renderPage(ctx);
    try { def.after?.(ctx.pageEl, ctx); } catch (error) { console.error(error); }
    Win.paintRanges(ctx.pageEl);
    scroller.scrollTop = top;
    paintChrome(ctx);
    if (key) {
      const next = Win.$$('[data-set],[data-act],[data-go],[data-exp],[id]', ctx.pageEl).find(el => focusKey(el) === key);
      if (next) {
        next.focus({ preventScroll: true });
        if (caret != null) try { next.setSelectionRange(caret, caret); } catch { /* not a text field */ }
      }
    }
  }

  function repaintAll(pageId) { live.forEach(ctx => { if (!pageId || ctx.page === pageId) repaint(ctx); }); }

  function paintChrome(ctx) {
    const root = rootOf(ctx.page);
    ctx.root.querySelectorAll('.st-navitem').forEach(b => {
      const on = b.dataset.go === root;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (ctx.back) ctx.back.disabled = !ctx.history.length;
  }

  function go(ctx, id, args = {}, { push = true, highlight = '' } = {}) {
    if (!P[id]) id = 'home';
    args = args || {};
    const same = ctx.page === id && JSON.stringify(ctx.args || {}) === JSON.stringify(args);
    if (push && !same) ctx.history.push({ page: ctx.page, args: ctx.args });
    if (ctx.history.length > 50) ctx.history.shift();
    if (!same) {
      ctx.open.clear();
      ctx.closed.clear();
      ctx.drafts = {};
      ctx.wf = { sel: '', stage: 'idle', error: '', auto: true, key: '' };
      if (id !== 'installed-apps') ctx.appQuery = '';
    }
    ctx.page = id;
    ctx.args = args;
    if (!ctx.pageEl) return;
    const hadFocus = ctx.pageEl.contains(document.activeElement);
    repaint(ctx, { reset: true });
    ctx.root.classList.remove('nav-open');
    if (hadFocus || !ctx.root.contains(document.activeElement)) ctx.pageEl.querySelector('.st-title')?.focus({ preventScroll: true });
    if (highlight) flashRow(ctx, highlight);
  }

  function flashRow(ctx, rowId) {
    const el = Win.$$('[data-row]', ctx.pageEl).find(x => x.dataset.row === rowId);
    if (!el) return;
    let host = el.parentElement?.closest('.st-exp');
    while (host) {
      host.classList.add('open');
      ctx.open.add(host.dataset.row);
      host.querySelector('.st-exp-btn')?.setAttribute('aria-expanded', 'true');
      host = host.parentElement?.closest('.st-exp');
    }
    el.scrollIntoView?.({ block: 'center' });
    el.classList.add('st-flash');
    setTimeout(() => el.classList.remove('st-flash'), 1800);
  }

  function toggleExpander(ctx, id) {
    const box = Win.$$('.st-exp', ctx.pageEl).find(x => x.dataset.row === id);
    if (!box) return;
    const open = !box.classList.contains('open');
    box.classList.toggle('open', open);
    box.querySelector('.st-exp-btn')?.setAttribute('aria-expanded', String(open));
    if (open) { ctx.open.add(id); ctx.closed.delete(id); } else { ctx.open.delete(id); ctx.closed.add(id); }
  }

  function applySet(ctx, el, liveInput = false) {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'radio') { if (!el.checked) return; v = el.value; }
    else if (el.type === 'range' || el.dataset.type === 'num') v = Number(el.value);
    else if (el.dataset.type === 'bool') v = el.value === 'true';
    else v = el.value;
    const path = el.dataset.set;
    if (path === 'bluetooth') { setBluetooth(v); return; }
    const topic = setPath(path, v);
    if (path === 'volume' && S().muted && v > 0) S().muted = false;
    if (path === 'theme' || path === 'appTheme') S().colorMode = 'custom';
    if (liveInput) {
      ctx.root?.querySelectorAll('[data-out]').forEach(o => { if (o.dataset.out === path) o.textContent = String(v); });
      ctx.mute = true;
      try { Win.save(topic); } finally { ctx.mute = false; }
    } else {
      Win.save(topic);
    }
  }

  function wire(ctx) {
    const root = ctx.root;

    root.addEventListener('click', e => {
      const t = e.target;
      if (!ctx.pageEl.contains(t) && !t.closest('.st-nav')) return;
      const cands = [t.closest('[data-act]'), t.closest('[data-go]'), t.closest('[data-exp]')].filter(c => c && root.contains(c));
      if (!cands.length) return;
      const pick = cands.reduce((a, b) => (a.contains(b) ? b : a));
      const ctl = t.closest('input, select, textarea, label');
      if (ctl && pick.contains(ctl) && ctl !== pick) return;
      if (pick.matches('input, select, textarea, label')) return;
      if (pick.dataset.act) { e.preventDefault(); ACTIONS[pick.dataset.act]?.(pick, ctx, e); return; }
      if (pick.dataset.go) {
        let args = {};
        try { args = pick.dataset.args ? JSON.parse(pick.dataset.args) : {}; } catch { args = {}; }
        go(ctx, pick.dataset.go, args);
        return;
      }
      if (pick.dataset.exp) toggleExpander(ctx, pick.dataset.exp);
    });

    root.addEventListener('change', e => {
      const el = e.target;
      if (!ctx.pageEl.contains(el)) return;
      if (el.dataset.act) { if (!INPUT_ACTS.has(el.dataset.act) || el.type === 'range') ACTIONS[el.dataset.act]?.(el, ctx, e); return; }
      if (el.dataset.set !== undefined) applySet(ctx, el);
    });

    root.addEventListener('input', e => {
      const el = e.target;
      if (!ctx.pageEl.contains(el)) return;
      if (el.dataset.act && INPUT_ACTS.has(el.dataset.act)) { ACTIONS[el.dataset.act](el, ctx, e); return; }
      if (el.type === 'range' && el.dataset.set !== undefined && el.dataset.live !== undefined) applySet(ctx, el, true);
    });

    root.addEventListener('keydown', e => {
      const el = e.target;
      if (e.key === 'Enter' && el.dataset?.enter) { e.preventDefault(); ACTIONS[el.dataset.enter]?.(el, ctx, e); return; }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(ctx); return; }
      if (el.classList?.contains('st-navitem') && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const items = Win.$$('.st-navitem', root);
        const i = items.indexOf(el);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
      if (e.key === 'Escape' && root.classList.contains('nav-open')) root.classList.remove('nav-open');
    });

    root.querySelector('.st-scrim').addEventListener('click', () => root.classList.remove('nav-open'));
    wireSearch(ctx);
  }

  function wireSearch(ctx) {
    const input = ctx.root.querySelector('.st-q');
    const list = ctx.root.querySelector('.st-results');
    let results = [];
    const close = () => { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); };
    const show = () => {
      results = searchSettings(input.value);
      if (!input.value.trim()) { close(); return; }
      list.innerHTML = results.length
        ? results.map((r, i) => `<button class="st-hit" role="option" id="${ctx.uid}-hit-${i}" data-hit="${i}">${g(r.icon, 16)}<span><span class="st-hit-title">${E(r.title)}</span><span class="st-hit-path">${E(crumbText(r.from || r.page))}</span></span></button>`).join('')
        : '<div class="st-nohit">No results found</div>';
      list.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
    };
    const choose = i => {
      const r = results[i];
      if (!r) return;
      close();
      go(ctx, r.page, {}, { highlight: r.row || '' });
    };
    input.addEventListener('input', show);
    input.addEventListener('focus', () => { if (input.value.trim()) show(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.classList.contains('hidden')) show(); list.querySelector('.st-hit')?.focus(); }
      if (e.key === 'Enter') { e.preventDefault(); if (!results.length) show(); choose(0); }
      if (e.key === 'Escape' && !list.classList.contains('hidden')) { e.preventDefault(); e.stopPropagation(); close(); }
    });
    list.addEventListener('keydown', e => {
      const hits = Win.$$('.st-hit', list);
      const i = hits.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); hits[Math.min(hits.length - 1, i + 1)]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) input.focus(); else hits[i - 1].focus(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); input.focus(); }
    });
    list.addEventListener('click', e => { const b = e.target.closest('[data-hit]'); if (b) choose(Number(b.dataset.hit)); });
    list.addEventListener('mousedown', e => e.preventDefault());
    input.addEventListener('blur', () => setTimeout(() => { if (!list.contains(document.activeElement)) close(); }, 120));
  }

  function back(ctx) {
    const prev = ctx.history.pop();
    if (prev) go(ctx, prev.page, prev.args, { push: false });
    paintChrome(ctx);
  }

  function shell(ctx) {
    const a = A();
    return `<div class="st" data-uid="${ctx.uid}">
      <aside class="st-nav" aria-label="Settings">
        <button class="st-user" data-go="your-info"><span class="st-avatar" aria-hidden="true">${E(Win.PERSONA.initials)}</span><span class="st-user-text"><strong>${E(a.name)}</strong><span>${E(a.email)}</span></span></button>
        <div class="st-search" role="search">
          <input class="input st-q" type="search" placeholder="Find a setting" aria-label="Find a setting" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="${ctx.uid}-results" aria-autocomplete="list">
          <span class="st-q-ico" aria-hidden="true">${g('search', 16)}</span>
          <div class="st-results hidden" id="${ctx.uid}-results" role="listbox" aria-label="Search results"></div>
        </div>
        <nav class="st-navlist" aria-label="Settings categories">${NAV.map(([id, label, icon]) => `<button class="st-navitem" data-go="${id}"><span class="st-ni st-ni-${id}" aria-hidden="true">${g(icon, 18)}</span><span>${E(label)}</span></button>`).join('')}</nav>
      </aside>
      <main class="st-main"><div class="st-scroll"><div class="st-page" aria-live="off"></div></div></main>
      <div class="st-scrim" aria-hidden="true"></div>
    </div>`;
  }

  function create(win, args = {}) {
    const ctx = makeCtx(win, P[args.page] ? args.page : 'home', pageArgs(args));
    win.state.settings = ctx;
    win.body.classList.add('st-body-host');
    win.body.innerHTML = shell(ctx);
    ctx.root = win.body.querySelector('.st');
    ctx.pageEl = ctx.root.querySelector('.st-page');
    ctx.scroller = ctx.root.querySelector('.st-scroll');
    live.add(ctx);

    /* Back and hamburger live in the title bar, as in Windows. */
    const tc = win.titleContent;
    if (tc) {
      const tools = Win.html(`<span class="st-tb" data-nodrag><button class="st-tb-btn st-back" aria-label="Back" title="Back" disabled>${g('back', 16)}</button><button class="st-tb-btn st-ham" aria-label="Navigation" title="Navigation" aria-expanded="false">${g('list', 16)}</button></span>`);
      tc.insertBefore(tools, tc.firstChild);
      ctx.back = tools.querySelector('.st-back');
      ctx.back.addEventListener('click', () => back(ctx));
      tools.querySelector('.st-ham').addEventListener('click', e => {
        const open = ctx.root.classList.toggle('nav-open');
        e.currentTarget.setAttribute('aria-expanded', String(open));
      });
    }

    wire(ctx);
    const fit = () => ctx.root.classList.toggle('narrow', (win.body.clientWidth || win.rect.w) < 700);
    win.el.addEventListener('win-resize', fit);
    fit();

    let queued = false;
    win.listen('state', () => {
      if (ctx.mute || queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; if (!win.closed) repaint(ctx); });
    });
    win.cleanup(() => { live.delete(ctx); ctx.timers.forEach(clearInterval); });
    repaint(ctx, { reset: true });
    if (args.highlight) flashRow(ctx, args.highlight);
  }

  const pageArgs = args => { const { page, maximized, x, y, width, height, ...rest } = args || {}; return rest; };

  Win.apps.register({
    id: 'settings', name: 'Settings', icon: 'settings', single: true,
    width: 1000, height: 680, minWidth: 500, minHeight: 400,
    category: 'System', keywords: 'control panel preferences options',
    create,
    reopen(win, args = {}) {
      const ctx = win.state.settings;
      if (ctx && args.page) go(ctx, args.page, pageArgs(args), { highlight: args.highlight || '' });
    },
  });

  Win.Settings = {
    open: (pageId = 'home', extra = {}) => Win.wm.open('settings', { page: pageId, ...extra }),
    pages: () => Object.keys(P),
    title: (pageId, args) => titleOf(pageId, args),
    render: (pageId, args = {}) => renderPage(makeCtx(null, pageId, args)),
    search: searchSettings,
    _: { readForm, checkIP, applyIP, editIP, checkDNS, applyDNS, editDNS, changePin, pinDialog, renamePC, applyProxyManual, applyProxyScript, doNetworkReset, storageModel, diagnose, ACTIONS, P },
  };
})(window.Win);
