/* ===========================================================================
   Start menu, Search and the Quick Link (Win+X) menu.

   The Start layout follows the 26H2 scrolling Start: search, Pinned,
   Recommended, then All apps by category or as a list.
   =========================================================================== */

(function (Win) {
  'use strict';

  const CATEGORY_ORDER = ['Productivity', 'Creativity', 'Utilities & tools', 'Entertainment', 'Social', 'System', 'Other'];

  /* Common Settings pages the shell search can jump to. */
  const SETTINGS = [
    ['Display settings', 'display', 'display'], ['Night light', 'display', 'moon'], ['Sound settings', 'sound', 'sound'],
    ['Notifications', 'notifications', 'bell'], ['Power & battery', 'power', 'battery'], ['Storage', 'storage', 'storage'],
    ['About your PC', 'about', 'about'], ['Rename this PC', 'about', 'pc'], ['Bluetooth & devices', 'bluetooth', 'bluetooth'],
    ['Printers & scanners', 'printers', 'printer'], ['Mouse settings', 'mouse', 'mouse'], ['Wi-Fi settings', 'wifi', 'wifi4'],
    ['Network & internet', 'network', 'network'], ['Change Wi-Fi network properties', 'wifi-manage', 'wifi4'], ['Proxy settings', 'proxy', 'proxy'],
    ['VPN settings', 'vpn', 'vpn'], ['Airplane mode', 'airplane', 'airplane'], ['Mobile hotspot', 'hotspot', 'hotspot'],
    ['Advanced network settings', 'advanced-network', 'advanced'], ['Network reset', 'advanced-network', 'restart'],
    ['Change the background', 'background', 'picture'], ['Colors', 'colors', 'palette'], ['Dark mode', 'colors', 'moon'],
    ['Themes', 'themes', 'palette'], ['Lock screen settings', 'lock-screen', 'lock'], ['Start settings', 'start', 'apps'],
    ['Taskbar settings', 'taskbar', 'taskview'], ['Installed apps', 'installed-apps', 'apps'], ['Add or remove programs', 'installed-apps', 'apps'],
    ['Default apps', 'default-apps', 'apps'], ['Startup apps', 'startup', 'apps'], ['Your info', 'your-info', 'person'],
    ['Sign-in options', 'sign-in', 'key'], ['Change your PIN', 'sign-in', 'key'], ['Other users', 'other-users', 'family'],
    ['Date & time', 'date-time', 'clock'], ['Time zone', 'date-time', 'clock'], ['Language & region', 'language', 'language'],
    ['Game Mode', 'gaming', 'game'], ['Accessibility', 'accessibility', 'access'], ['Text size', 'accessibility', 'text'],
    ['Privacy & security', 'privacy', 'privacy'], ['Windows Security', 'security', 'shield'], ['Location privacy', 'privacy', 'location'],
    ['Camera privacy', 'privacy', 'camera'], ['Microphone privacy', 'privacy', 'mic'], ['Check for updates', 'update', 'update'],
    ['Windows Update', 'update', 'update'], ['Update history', 'update-history', 'history'], ['Snap windows', 'multitasking', 'snap'],
    ['Show file extensions', 'system', 'file'], ['Show hidden files', 'system', 'file'],
  ];

  const S = () => Win.state;
  const timeAgo = t => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 2) return 'Yesterday';
    if (d < 7) return `${d} days ago`;
    return new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  };

  /* ------------------------------------------------------------ Start menu */

  let expanded = false;
  let allView = 'category';
  let openCategory = null;

  function renderStart(el) {
    const s = S().settings;
    const pins = S().start.pinned.filter(id => Win.apps.get(id));
    const cols = s.startLayout === 'more-pins' ? 8 : 6;
    const rows = s.startLayout === 'more-recs' ? 2 : s.startLayout === 'more-pins' ? 4 : 3;
    const shown = expanded ? pins : pins.slice(0, cols * rows);
    const recs = s.startRecommended ? recommended().slice(0, s.startLayout === 'more-recs' ? 8 : s.startLayout === 'more-pins' ? 2 : 4) : [];
    el.innerHTML = `
      <div class="sm-scroll">
        <label class="sm-search">${Win.glyph('search', 16)}<input type="search" placeholder="Search for apps, settings, and documents" aria-label="Search" autocomplete="off" spellcheck="false"></label>
        <section class="sm-sec">
          <header><h2>Pinned</h2>${pins.length > cols * rows ? `<button class="btn sm sm-more" data-act="expand">${expanded ? 'Show less' : 'Show all'}${Win.glyph(expanded ? 'chevup' : 'chevdown', 12)}</button>` : ''}</header>
          <div class="sm-grid" style="--cols:${cols}">${shown.map(id => tile(id)).join('')}</div>
        </section>
        ${s.startRecommended ? `<section class="sm-sec">
          <header><h2>Recommended</h2></header>
          ${recs.length ? `<div class="sm-recs">${recs.map(r => `<button class="sm-rec" data-file="${r.id}" data-tip="${Win.esc(Win.FS.path(r.id))}">${Win.fileIcon(r, 32)}<span><b>${Win.esc(r.name)}</b><span>${Win.esc(timeAgo(r.modified || Date.now()))}</span></span></button>`).join('')}</div>`
            : '<p class="sm-empty">The more you use your device, the more we\'ll show your new apps and recent files here.</p>'}
        </section>` : ''}
        <section class="sm-sec">
          <header><h2>All</h2><button class="btn sm" data-act="view" aria-label="Change view">View: ${allView === 'category' ? 'Category' : allView === 'grid' ? 'Grid' : 'List'}${Win.glyph('chevdown', 12)}</button></header>
          ${allView === 'category' ? categoryView() : allView === 'grid' ? `<div class="sm-grid" style="--cols:${cols}">${Win.apps.listed().map(a => tile(a.id)).join('')}</div>` : listView()}
        </section>
      </div>
      <footer class="sm-foot">
        <button class="sm-user" data-act="user">${avatar(32)}<span>${Win.esc(S().account.name)}</span></button>
        <div class="sm-foot-r">
          <button class="icon-btn" data-open="settings" aria-label="Settings" data-tip="Settings">${Win.glyph('gear', 16)}</button>
          <button class="icon-btn" data-open="explorer" aria-label="File Explorer" data-tip="File Explorer">${Win.glyph('folder', 16)}</button>
          <button class="icon-btn" data-act="power" aria-label="Power" data-tip="Power">${Win.glyph('power', 16)}</button>
        </div>
      </footer>`;
  }

  function tile(id) {
    const app = Win.apps.get(id);
    if (!app) return '';
    return `<button class="sm-tile" data-open="${id}" draggable="false">${Win.appIcon(app.icon, 32)}<span>${Win.esc(app.name)}</span></button>`;
  }

  function categoryView() {
    const groups = {};
    Win.apps.listed().forEach(a => (groups[a.category] ||= []).push(a));
    const names = Object.keys(groups).sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
    if (openCategory && groups[openCategory]) {
      return `<div class="sm-catopen"><button class="btn sm subtle" data-act="cat-back">${Win.glyph('back', 14)} ${Win.esc(openCategory)}</button>
        <div class="sm-grid" style="--cols:6">${groups[openCategory].map(a => tile(a.id)).join('')}</div></div>`;
    }
    return `<div class="sm-cats">${names.map(name => {
      const apps = groups[name];
      const big = apps.length <= 4 ? apps : apps.slice(0, 3);
      const rest = apps.length > 4 ? apps.slice(3, 7) : [];
      return `<div class="sm-cat"><div class="sm-cat-box">
          ${big.map(a => `<button class="sm-cat-app" data-open="${a.id}" aria-label="${Win.esc(a.name)}" data-tip="${Win.esc(a.name)}">${Win.appIcon(a.icon, 32)}</button>`).join('')}
          ${rest.length ? `<button class="sm-cat-mini" data-cat="${Win.esc(name)}" aria-label="More ${Win.esc(name)} apps">${rest.map(a => Win.appIcon(a.icon, 16)).join('')}</button>` : ''}
        </div><span>${Win.esc(name)}</span></div>`;
    }).join('')}</div>`;
  }

  function listView() {
    let letter = '';
    return `<div class="sm-list">${Win.apps.listed().map(a => {
      const first = /[a-z]/i.test(a.name[0]) ? a.name[0].toUpperCase() : '#';
      const head = first !== letter ? `<div class="sm-letter">${(letter = first)}</div>` : '';
      return `${head}<button class="sm-li" data-open="${a.id}">${Win.appIcon(a.icon, 24)}<span>${Win.esc(a.name)}</span></button>`;
    }).join('')}</div>`;
  }

  function recommended() {
    return S().recent.map(Win.FS.get).filter(n => n && n.parent !== 'bin');
  }

  const avatar = (size = 32) => `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px">${Win.esc(Win.PERSONA.initials)}</span>`;
  Win.avatar = avatar;

  function wireStart(el) {
    el.addEventListener('click', e => {
      const open = e.target.closest('[data-open]');
      if (open) { Win.Flyout.close(); Win.wm.open(open.dataset.open); return; }
      const file = e.target.closest('[data-file]');
      if (file) { Win.Flyout.close(); Win.openFile?.(file.dataset.file); return; }
      const cat = e.target.closest('[data-cat]');
      if (cat) { openCategory = cat.dataset.cat; renderStart(el); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'expand') { expanded = !expanded; renderStart(el); }
      if (act === 'cat-back') { openCategory = null; renderStart(el); }
      if (act === 'view') {
        const r = e.target.closest('[data-act]').getBoundingClientRect();
        Win.menu(r.left, r.bottom + 4, [['category', 'Category'], ['grid', 'Grid'], ['list', 'List']].map(([v, l]) => ({
          label: l, checked: allView === v, radio: true, action: () => { allView = v; openCategory = null; renderStart(el); },
        })));
      }
      if (act === 'power') powerMenu(e.target.closest('[data-act]'));
      if (act === 'user') userMenu(e.target.closest('[data-act]'));
    });
    el.addEventListener('contextmenu', e => {
      const target = e.target.closest('[data-open]');
      e.preventDefault();
      if (!target) return;
      appMenu(target.dataset.open, e.clientX, e.clientY);
    });
    el.addEventListener('input', e => {
      if (!e.target.matches('.sm-search input') || !e.target.value) return;
      const q = e.target.value;
      Win.Flyout.open('search', { query: q });
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') Win.Flyout.close();
    });
  }

  function appMenu(id, x, y) {
    const app = Win.apps.get(id);
    const inStart = S().start.pinned.includes(id);
    const inBar = S().taskbar.pinned.includes(id);
    const installed = S().apps.find(a => a.id === id);
    Win.menu(x, y, [
      { label: 'Open', glyph: 'open', action: () => { Win.Flyout.close(); Win.wm.open(id); } },
      { divider: true },
      inStart ? { label: 'Unpin from Start', glyph: 'unpin', action: () => pinStart(id, false) } : { label: 'Pin to Start', glyph: 'pin', action: () => pinStart(id, true) },
      inStart && S().start.pinned[0] !== id ? { label: 'Move to front', glyph: 'up', action: () => { S().start.pinned = [id, ...S().start.pinned.filter(p => p !== id)]; Win.save(); Win.Flyout.refresh('start'); } } : null,
      { label: inBar ? 'Unpin from taskbar' : 'Pin to taskbar', glyph: inBar ? 'unpin' : 'pin', action: () => Win.Taskbar.pin(id, !inBar) },
      { divider: true },
      { label: 'App settings', glyph: 'gear', action: () => { Win.Flyout.close(); Win.wm.open('settings', { page: 'installed-apps' }); } },
      { label: 'Uninstall', glyph: 'trash', disabled: !installed || installed.system || ['settings', 'explorer', 'edge', 'store'].includes(id), action: () => {} },
    ].filter(Boolean));
    void app;
  }

  function pinStart(id, on) {
    S().start.pinned = on ? [...S().start.pinned.filter(p => p !== id), id] : S().start.pinned.filter(p => p !== id);
    Win.save();
    Win.Flyout.refresh('start');
  }

  function powerMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const pendingRestart = S().update.status === 'restart';
    const menu = Win.menu(r.left, r.top, [
      { label: 'Lock', glyph: 'lock', action: () => Win.Session.lock() },
      { label: 'Sleep', glyph: 'sleep', action: () => Win.Session.sleep() },
      { label: pendingRestart ? 'Update and shut down' : 'Shut down', glyph: 'power', action: () => Win.Session.shutdown() },
      { label: pendingRestart ? 'Update and restart' : 'Restart', glyph: 'restart', action: () => Win.Session.restart() },
    ]);
    menu.style.top = `${r.top - menu.offsetHeight - 6}px`;
    menu.style.left = `${Math.min(r.left - menu.offsetWidth / 2, innerWidth - menu.offsetWidth - 8)}px`;
  }

  function userMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const menu = Win.menu(r.left, r.top, [
      { label: 'Change account settings', glyph: 'person', action: () => { Win.Flyout.close(); Win.wm.open('settings', { page: 'your-info' }); } },
      { label: 'Lock', glyph: 'lock', action: () => Win.Session.lock() },
      { label: 'Sign out', glyph: 'signout', action: () => Win.Session.signOut() },
    ]);
    menu.style.top = `${r.top - menu.offsetHeight - 6}px`;
  }

  Win.Flyout.register('start', {
    label: 'Start',
    className: 'fly-start',
    render(el, opts) {
      if (!opts.refresh) { expanded = false; openCategory = null; }
      const scroll = el.querySelector('.sm-scroll')?.scrollTop || 0;
      renderStart(el);
      if (opts.refresh) el.querySelector('.sm-scroll').scrollTop = scroll;
      if (!el.dataset.wired) { wireStart(el); el.dataset.wired = '1'; }
    },
    onOpen(el) { setTimeout(() => el.querySelector('.sm-search input')?.focus(), 60); },
  });

  /* ---------------------------------------------------------------- search */

  let filter = 'All';
  let selected = 0;
  let results = [];

  function search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const score = (text, keys = '') => {
      const t = text.toLowerCase();
      if (t === q) return 100;
      if (t.startsWith(q)) return 80;
      if (t.split(/\s+/).some(w => w.startsWith(q))) return 60;
      if (t.includes(q)) return 40;
      if (keys.toLowerCase().includes(q)) return 30;
      return 0;
    };
    const out = [];
    Win.apps.listed().forEach(a => { const s = score(a.name, a.keywords || ''); if (s) out.push({ type: 'App', score: s + 10, label: a.name, id: a.id, icon: Win.appIcon(a.icon, 32), big: Win.appIcon(a.icon, 64) }); });
    SETTINGS.forEach(([label, page, glyph]) => { const s = score(label); if (s) out.push({ type: 'Settings', score: s, label, page, icon: `<span class="sr-glyph">${Win.glyph(glyph, 20)}</span>`, big: `<span class="sr-glyph big">${Win.glyph(glyph, 40)}</span>` }); });
    Win.state.fs.forEach(n => {
      if (n.hidden || n.system || n.parent === 'bin' || n.kind === 'drive') return;
      const s = score(n.name);
      if (s) out.push({ type: n.kind === 'folder' ? 'Folders' : /^(jpe?g|png|gif|bmp|webp)$/.test(n.ext) ? 'Photos' : 'Documents', score: s - 5, label: n.name, file: n.id, icon: Win.fileIcon(n, 32), big: Win.fileIcon(n, 64) });
    });
    out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    out.push({ type: 'Web', score: 0, label: query.trim(), web: true, icon: `<span class="sr-glyph">${Win.glyph('search', 18)}</span>`, big: `<span class="sr-glyph big">${Win.glyph('globe', 40)}</span>` });
    return out;
  }

  /* Search home's quick searches: [label, glyph, app, settings page]. */
  const QUICK = [
    ['Today’s weather', 'sun', 'weather'],
    ['Check for updates', 'refresh', 'settings', 'update'],
    ['Wi-Fi settings', 'wifi4', 'settings', 'wifi'],
    ['Troubleshoot network', 'network', 'settings', 'network'],
    ['Installed apps', 'apps', 'settings', 'installed-apps'],
  ];

  function renderSearch(el, query) {
    const q = query ?? el.querySelector('.sr-input input')?.value ?? '';
    const all = search(q);
    results = filter === 'All' ? all : all.filter(r => r.type === filter.replace(/s$/, '') || r.type === filter || (filter === 'Apps' && r.type === 'App'));
    selected = Math.min(selected, Math.max(0, results.length - 1));
    const groups = {};
    results.slice(1).forEach(r => (groups[r.type === 'App' ? 'Apps' : r.type] ||= []).push(r));
    const best = results[0];
    const recentApps = ['edge', 'explorer', 'settings', 'notepad', 'terminal', 'calculator'].filter(id => Win.apps.get(id));
    el.innerHTML = `
      <label class="sr-input">${Win.glyph('search', 16)}<input type="search" value="${Win.esc(q)}" placeholder="Type here to search" aria-label="Search" autocomplete="off" spellcheck="false"></label>
      <div class="sr-pills">${['All', 'Apps', 'Documents', 'Web', 'Settings', 'Folders', 'Photos'].map(p => `<button class="sr-pill ${p === filter ? 'on' : ''}" data-filter="${p}">${p}</button>`).join('')}</div>
      ${!q ? `<div class="sr-home">
          <section class="sr-recent"><h3>Recent</h3>${recommended().slice(0, 8).map(n => `<button class="sr-row" data-file="${n.id}">${Win.fileIcon(n, 20)}<span>${Win.esc(n.name)}</span><small>${Win.esc(Win.FS.path(n.parent))}</small></button>`).join('')}</section>
          <div class="sr-side">
            <section><h3>Top apps</h3><div class="sr-top">${recentApps.map(id => { const a = Win.apps.get(id); return `<button class="sm-tile" data-open="${id}">${Win.appIcon(a.icon, 32)}<span>${Win.esc(a.name)}</span></button>`; }).join('')}</div></section>
            <section><h3>Quick searches</h3>${QUICK.map(([label, glyph, app, page]) => `<button class="sr-row" data-open="${app}"${page ? ` data-page="${page}"` : ''}><span class="sr-glyph">${Win.glyph(glyph, 16)}</span><span>${Win.esc(label)}</span></button>`).join('')}</section>
          </div>
        </div>`
        : `<div class="sr-body">
          <div class="sr-list" role="listbox" aria-label="Search results">
            ${best ? `<h3>Best match</h3>${row(best, 0)}` : ''}
            ${Object.entries(groups).map(([name, items]) => `<h3>${Win.esc(name === 'Web' ? 'Search the web' : name)}</h3>${items.slice(0, 5).map(r => row(r, results.indexOf(r))).join('')}`).join('')}
          </div>
          <div class="sr-preview">${preview(results[selected])}</div>
        </div>`}`;
  }

  function row(r, i) {
    return `<button class="sr-row ${i === selected ? 'sel' : ''}" data-i="${i}" role="option" aria-selected="${i === selected}">${r.icon}<span>${r.web ? `${Win.esc(r.label)} <small>- See more search results</small>` : Win.esc(r.label)}</span>${r.type !== 'App' && !r.web ? `<small>${Win.esc(r.type === 'Settings' ? 'System settings' : r.file ? Win.FS.path(Win.FS.get(r.file).parent) : '')}</small>` : ''}</button>`;
  }

  function preview(r) {
    if (!r) return '';
    const kind = r.type === 'App' ? 'App' : r.type === 'Settings' ? 'System settings' : r.web ? 'Search the web' : Win.FS.typeName(Win.FS.get(r.file));
    const actions = r.type === 'App'
      ? [['open', 'Open', 'open'], ['pin', S().start.pinned.includes(r.id) ? 'Unpin from Start' : 'Pin to Start', 'pin'], ['bar', S().taskbar.pinned.includes(r.id) ? 'Unpin from taskbar' : 'Pin to taskbar', 'pin']]
      : r.file ? [['open', 'Open', 'open'], ['loc', 'Open file location', 'folder'], ['path', 'Copy path', 'copy']]
        : r.web ? [['open', 'Open results in browser', 'open']] : [['open', 'Open', 'open']];
    return `<div class="sp-head">${r.big}<b>${Win.esc(r.label)}</b><span>${Win.esc(kind)}</span></div>
      <div class="sp-actions">${actions.map(([act, label, glyph]) => `<button class="sp-act" data-pact="${act}">${Win.glyph(glyph, 16)}<span>${Win.esc(label)}</span></button>`).join('')}</div>`;
  }

  function activate(r, how = 'open') {
    if (!r) return;
    if (how === 'pin') { pinStart(r.id, !S().start.pinned.includes(r.id)); renderSearch(Win.Flyout.el); return; }
    if (how === 'bar') { Win.Taskbar.pin(r.id, !S().taskbar.pinned.includes(r.id)); renderSearch(Win.Flyout.el); return; }
    if (how === 'path') { S().clipboard = { text: Win.FS.path(r.file) }; Win.Flyout.close(); return; }
    Win.Flyout.close();
    if (how === 'loc') { Win.wm.open('explorer', { path: Win.FS.get(r.file).parent, select: r.file }); return; }
    if (r.type === 'App') Win.wm.open(r.id);
    else if (r.page) Win.wm.open('settings', { page: r.page });
    else if (r.file) Win.openFile?.(r.file);
    else if (r.web) Win.wm.open('edge', { url: r.label });
  }

  Win.Flyout.register('search', {
    label: 'Search',
    className: 'fly-search',
    render(el, opts = {}) {
      if (!opts.refresh) { filter = 'All'; selected = 0; }
      renderSearch(el, opts.query);
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('input', e => {
        if (!e.target.matches('.sr-input input')) return;
        selected = 0;
        const value = e.target.value;
        const pos = e.target.selectionStart;
        renderSearch(el, value);
        const input = el.querySelector('.sr-input input');
        input.focus();
        input.setSelectionRange(pos, pos);
      });
      el.addEventListener('click', e => {
        const pill = e.target.closest('[data-filter]');
        if (pill) { filter = pill.dataset.filter; selected = 0; renderSearch(el); el.querySelector('.sr-input input').focus(); return; }
        const open = e.target.closest('[data-open]');
        if (open) { Win.Flyout.close(); Win.wm.open(open.dataset.open, open.dataset.page ? { page: open.dataset.page } : {}); return; }
        const file = e.target.closest('[data-file]');
        if (file) { Win.Flyout.close(); Win.openFile?.(file.dataset.file); return; }
        const rowEl = e.target.closest('[data-i]');
        if (rowEl) { activate(results[Number(rowEl.dataset.i)]); return; }
        const pact = e.target.closest('[data-pact]');
        if (pact) activate(results[selected], pact.dataset.pact);
      });
      el.addEventListener('pointerover', e => {
        const rowEl = e.target.closest('[data-i]');
        if (!rowEl || Number(rowEl.dataset.i) === selected) return;
        selected = Number(rowEl.dataset.i);
        el.querySelectorAll('.sr-row').forEach(b => b.classList.toggle('sel', b === rowEl));
        el.querySelector('.sr-preview').innerHTML = preview(results[selected]);
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Escape') { Win.Flyout.close(); return; }
        if (!e.target.matches('.sr-input input')) return;
        if (e.key === 'Enter') { e.preventDefault(); activate(results[selected]); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const order = [...el.querySelectorAll('[data-i]')].map(b => Number(b.dataset.i));
          const at = order.indexOf(selected);
          selected = order[Win.clamp(at + (e.key === 'ArrowDown' ? 1 : -1), 0, order.length - 1)] ?? 0;
          const value = e.target.value;
          renderSearch(el, value);
          const input = el.querySelector('.sr-input input');
          input.focus();
          input.setSelectionRange(value.length, value.length);
        }
      });
    },
    onOpen(el) {
      setTimeout(() => {
        const input = el.querySelector('.sr-input input');
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      }, 40);
    },
  });

  /* -------------------------------------------------------- Quick Link menu */

  Win.Start = {
    SETTINGS,
    winX(x, y) {
      Win.Flyout.close();
      const settings = page => () => Win.wm.open('settings', { page });
      const menu = Win.menu(x, y, [
        { label: 'Installed apps', action: settings('installed-apps') },
        { label: 'Power Options', action: settings('power') },
        { label: 'System', action: settings('about') },
        { label: 'Network Connections', action: settings('network') },
        { label: 'Disk Management', action: settings('storage') },
        { label: 'Terminal', action: () => Win.wm.open('terminal') },
        { label: 'Terminal (Admin)', action: () => Win.UAC?.('Terminal', () => Win.wm.open('terminal', { admin: true })) },
        { divider: true },
        { label: 'Task Manager', action: () => Win.wm.open('taskmgr') },
        { label: 'Settings', action: () => Win.wm.open('settings') },
        { label: 'File Explorer', action: () => Win.wm.open('explorer') },
        { label: 'Search', action: () => Win.Flyout.open('search') },
        { label: 'Run', action: () => Win.wm.open('run') },
        { divider: true },
        { label: 'Shut down or sign out', submenu: [
          { label: 'Sign out', action: () => Win.Session.signOut() },
          { label: 'Sleep', action: () => Win.Session.sleep() },
          { label: 'Shut down', action: () => Win.Session.shutdown() },
          { label: 'Restart', action: () => Win.Session.restart() },
        ] },
        { label: 'Desktop', action: () => Win.wm.showDesktop() },
      ], { className: 'winx' });
      menu.style.top = `${innerHeight - 48 - menu.offsetHeight - 4}px`;
    },
  };
})(window.Win);
