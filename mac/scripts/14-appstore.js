/* ===========================================================================
   App Store.

   Browse, install and remove apps; apply pending updates with a progress
   simulation; and reach Software Update. Installing an app adds it to
   `installedApps`, which is what Launchpad, Finder and Spotlight read.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, appIcon, UI } = Mac;

  /** The store catalogue. Apps flagged `bundled` cannot be removed. */
  const CATALOGUE = [
    { id: 'safari', price: 'Included', bundled: true, rating: 4.7, ratings: '12.4K', size: 128974848, editorial: 'The browser built for this Mac.', shots: ['Start page', 'Reader', 'Privacy report'] },
    { id: 'mail', price: 'Included', bundled: true, rating: 4.4, ratings: '8.1K', size: 96468992, editorial: 'Mail with categories and Protect Mail Activity.' },
    { id: 'outlook', price: 'Free', rating: 4.2, ratings: '46.8K', size: 604897280, editorial: 'Email, calendar and contacts for work accounts.', shots: ['Focused Inbox', 'Calendar', 'Search'] },
    { id: 'notes', price: 'Included', bundled: true, rating: 4.8, ratings: '22.0K', size: 32505856, editorial: 'Capture a thought, a checklist or a whole runbook.' },
    { id: 'freeform', price: 'Free', rating: 4.5, ratings: '3.2K', size: 214748364, editorial: 'A flexible canvas for whiteboarding an escalation.' },
    { id: 'messages', price: 'Included', bundled: true, rating: 4.3, ratings: '19.7K', size: 48234496, editorial: 'Keep the conversation going across devices.' },
    { id: 'calendar', price: 'Included', bundled: true, rating: 4.5, ratings: '11.2K', size: 41943040, editorial: 'Every calendar in one place.' },
    { id: 'reminders', price: 'Included', bundled: true, rating: 4.6, ratings: '9.4K', size: 28311552, editorial: 'Lists that follow you around.' },
    { id: 'maps', price: 'Included', bundled: true, rating: 4.1, ratings: '15.6K', size: 167772160, editorial: 'Look around before the site visit.' },
    { id: 'photos', price: 'Included', bundled: true, rating: 4.4, ratings: '31.1K', size: 268435456, editorial: 'Your library, organised.' },
    { id: 'music', price: 'Included', bundled: true, rating: 4.2, ratings: '52.3K', size: 184549376, editorial: 'Over a hundred million songs.' },
    { id: 'podcasts', price: 'Free', rating: 4.0, ratings: '7.7K', size: 96468992, editorial: 'Shows for the commute.' },
    { id: 'weather', price: 'Free', rating: 4.3, ratings: '5.1K', size: 62914560, editorial: 'Hourly forecasts and severe-weather alerts.' },
    { id: 'contacts', price: 'Included', bundled: true, rating: 4.2, ratings: '4.9K', size: 20971520, editorial: 'People, groups and directory lookups.' },
    { id: 'facetime', price: 'Included', bundled: true, rating: 4.1, ratings: '18.2K', size: 88080384, editorial: 'Face-to-face without the trip.' },
    { id: 'disk-utility', price: 'Included', bundled: true, rating: 4.6, ratings: '2.1K', size: 25165824, editorial: 'Verify, repair and erase volumes.' },
    { id: 'activity-monitor', price: 'Included', bundled: true, rating: 4.7, ratings: '3.4K', size: 18874368, editorial: 'See what is using the CPU right now.' },
    { id: 'console', price: 'Included', bundled: true, rating: 4.4, ratings: '1.6K', size: 16777216, editorial: 'Read the system log while a fault is live.' },
    { id: 'terminal', price: 'Included', bundled: true, rating: 4.9, ratings: '6.8K', size: 12582912, editorial: 'The command line, right where you need it.' },
    { id: 'screenshot', price: 'Included', bundled: true, rating: 4.5, ratings: '2.8K', size: 10485760, editorial: 'Capture the evidence for the ticket.' },
    { id: 'time-machine', price: 'Included', bundled: true, rating: 4.3, ratings: '5.5K', size: 14680064, editorial: 'Roll a Mac back to yesterday.' },
    { id: 'keychain', price: 'Included', bundled: true, rating: 4.0, ratings: '1.2K', size: 11534336, editorial: 'Passwords, certificates and secure notes.' },
    { id: 'system-info', price: 'Included', bundled: true, rating: 4.2, ratings: '980', size: 9437184, editorial: 'The full hardware and software report.' },
    { id: 'migration', price: 'Included', bundled: true, rating: 3.9, ratings: '740', size: 20971520, editorial: 'Move a customer to their new Mac.' },
  ];

  const SECTIONS = [
    { id: 'Discover', glyph: 'star' },
    { id: 'Create', glyph: 'compose' },
    { id: 'Work', glyph: 'inbox' },
    { id: 'Play', glyph: 'play' },
    { id: 'Develop', glyph: 'terminal' },
    { id: 'Categories', glyph: 'apps' },
    { id: 'Updates', glyph: 'download' },
  ];

  const CATEGORY_FOR = {
    Create: ['Creativity', 'Media'],
    Work: ['Productivity', 'Internet'],
    Play: ['Media', 'Lifestyle'],
    Develop: ['Utilities', 'System'],
  };

  const Store = Mac.Store2 = {
    entry(id) { return CATALOGUE.find(item => item.id === id) || null; },

    installed(id) { return Mac.state.installedApps.includes(id); },

    listFor(section) {
      if (section === 'Updates') return Mac.state.appUpdates.map(update => this.entry(update.id)).filter(Boolean);
      if (section === 'Discover') return CATALOGUE.slice(0, 12);
      const categories = CATEGORY_FOR[section];
      if (!categories) return CATALOGUE;
      return CATALOGUE.filter(item => categories.includes(Mac.apps[item.id]?.category));
    },

    stars(rating) {
      const full = Math.round(rating);
      return `<span class="store-stars">${Array.from({ length: 5 }, (_, index) =>
        glyph('star', { size: 11, fill: index < full })).join('')}</span>
        <span class="muted" style="font-size:10.5px">${rating.toFixed(1)}</span>`;
    },

    /* ------------------------------------------------------------ rendering */

    render(win) {
      return `<div class="app-shell store-shell">
        <aside class="sidebar">
          <div class="search"><span>${glyph('search')}</span>
            <input data-store-search value="${esc(win.state.query)}" placeholder="Search" aria-label="Search the App Store"></div>
          <div class="sidebar-heading">App Store</div>
          ${SECTIONS.map(section => {
            const count = section.id === 'Updates' ? Mac.state.appUpdates.length : 0;
            return `<button class="side-item ${win.state.section === section.id && !win.state.detail ? 'on' : ''}" data-store-section="${section.id}">
              <span class="side-glyph">${glyph(section.glyph, { size: 15 })}</span>
              <span class="side-label">${section.id}</span>
              ${count ? `<span class="side-count">${count}</span>` : ''}</button>`;
          }).join('')}
          <div class="sidebar-heading">Account</div>
          <button class="side-item" data-command="open-setting" data-arg="Apple Account">
            <span class="side-glyph">${glyph('person', { size: 15 })}</span>
            <span class="side-label">${esc(Mac.state.account.signedIn ? Mac.state.account.name : 'Sign In')}</span></button>
        </aside>
        <section class="main-pane"><div class="pane-scroll"><div class="pane-pad">
          ${win.state.detail ? this.detail(win) : win.state.query.trim() ? this.searchResults(win) : this.section(win)}
        </div></div></section>
      </div>`;
    },

    section(win) {
      if (win.state.section === 'Updates') return this.updates();
      if (win.state.section === 'Categories') return this.categories();

      const apps = this.listFor(win.state.section);
      const featured = apps[0];
      return `${featured ? `<div class="store-hero">
          <p class="web-eyebrow">Featured</p>
          <h1>${esc(Mac.apps[featured.id]?.title || '')}</h1>
          <p>${esc(featured.editorial)}</p>
          <div class="row-flex" style="margin-top:14px">
            <button class="btn large" data-store-open="${featured.id}">Learn More</button>
            ${this.actionButton(featured, true)}</div>
        </div>` : ''}
        ${Mac.state.appUpdates.length ? `<div class="group"><button class="row tappable" data-store-section="Updates">
            <span class="update-orb" style="width:40px;height:40px;border-radius:10px;display:grid;place-items:center;background:var(--accent);color:#fff">${glyph('download')}</span>
            <div class="row-text"><strong>${Mac.plural(Mac.state.appUpdates.length, 'update')} available</strong>
              <p>Review and install pending app updates.</p></div>
            <span class="chevron">${glyph('chevron', { size: 13 })}</span></button></div>` : ''}
        <div class="section-title">${esc(win.state.section)} — apps for this Mac</div>
        <div class="store-cards">${apps.map(item => this.card(item)).join('')}</div>`;
    },

    card(item) {
      const app = Mac.apps[item.id];
      if (!app) return '';
      return `<div class="store-card">
        <button data-store-open="${item.id}" style="text-align:left;width:100%">
          ${appIcon(app.icon)}
          <strong>${esc(app.title)}</strong>
          <small>${esc(app.category)}</small>
        </button>
        <p>${esc(item.editorial)}</p>
        <div class="row-flex" style="margin-top:10px;justify-content:space-between">
          ${this.stars(item.rating)}${this.actionButton(item)}</div></div>`;
    },

    actionButton(item, large = false) {
      const installing = Mac.session.installing[item.id];
      if (installing !== undefined) {
        return `<span class="badge info">${installing}%</span>`;
      }
      if (!this.installed(item.id)) {
        return `<button class="btn primary pill ${large ? 'large' : ''}" data-command="store-install" data-arg="${item.id}">Get</button>`;
      }
      const update = Mac.state.appUpdates.find(candidate => candidate.id === item.id);
      if (update) {
        return `<button class="btn primary pill ${large ? 'large' : ''}" data-command="store-update" data-arg="${item.id}">Update</button>`;
      }
      return `<button class="btn pill ${large ? 'large' : ''}" data-command="open-app" data-arg="${item.id}">Open</button>`;
    },

    categories() {
      const groups = {};
      CATALOGUE.forEach(item => {
        const category = Mac.apps[item.id]?.category || 'Utilities';
        (groups[category] = groups[category] || []).push(item);
      });
      return `${UI.header('Categories', 'Find your next favorite app.')}
        ${Object.entries(groups).map(([category, items]) => `<div class="section-title">${esc(category)}</div>
          <div class="group">${items.map(item => {
            const app = Mac.apps[item.id];
            return `<div class="row"><div class="store-row-app">${appIcon(app.icon)}</div>
              <div class="row-text"><strong>${esc(app.title)}</strong><p>${esc(item.editorial)}</p></div>
              <div class="row-action">${this.actionButton(item)}</div></div>`;
          }).join('')}</div>`).join('')}`;
    },

    updates() {
      const updates = Mac.state.appUpdates;
      return `${UI.header('Updates', updates.length
        ? `${Mac.plural(updates.length, 'update')} available`
        : 'All apps are up to date',
        updates.length ? '<button class="btn primary" data-command="store-update-all">Update All</button>' : '')}
        ${UI.group(
          `<div class="row"><span style="width:44px;height:44px;display:grid;place-items:center;border-radius:11px;background:var(--fill);color:var(--accent)">${glyph('update', { size: 24 })}</span>
            <div class="row-text"><strong>macOS Golden Gate ${Mac.OS.version()}</strong>
              <p>${Mac.state.settings.autoUpdates ? 'Automatic updates are on.' : 'Automatic updates are off.'} Build ${Mac.OS.build()}.</p></div>
            <div class="row-action"><span class="badge ok">Up to date</span>
              <button class="btn" data-command="open-setting" data-arg="Software Update">Details</button></div></div>`,
          UI.toggle('Automatic app updates', 'settings.autoUpdates'),
        )}
        ${updates.length ? `<div class="section-title">Pending</div><div class="group">${updates.map(update => {
          const app = Mac.apps[update.id];
          const progress = Mac.session.installing[update.id];
          return `<div class="row"><div class="store-row-app">${appIcon(app.icon)}</div>
            <div class="row-text"><strong>${esc(app.title)} ${esc(update.version)}</strong>
              <p>${esc(update.notes)}</p>
              ${progress !== undefined ? `<div class="progress-track" style="margin-top:6px"><i style="width:${progress}%"></i></div>` : ''}</div>
            <div class="row-action"><span class="row-value">${Mac.bytes(update.size)}</span>
              ${progress !== undefined ? `<span class="badge info">${progress}%</span>`
                : `<button class="btn primary pill" data-command="store-update" data-arg="${update.id}">Update</button>`}</div></div>`;
        }).join('')}</div>`
        : UI.empty('No updates available', 'All your apps are up to date.', { icon: 'check' })}
        <div class="section-title">Recently updated</div>
        ${UI.group(...(Mac.state.storeInstalls.length
          ? Mac.state.storeInstalls.slice(0, 6).map(entry => UI.info(entry.title, new Date(entry.at).toLocaleString(), entry.action))
          : [UI.info('Nothing yet', '', 'Installs and updates you run appear here.')]))}`;
    },

    searchResults(win) {
      const query = win.state.query.trim().toLowerCase();
      const hits = CATALOGUE.filter(item => {
        const app = Mac.apps[item.id];
        return app && (app.title.toLowerCase().includes(query) ||
          app.category.toLowerCase().includes(query) ||
          item.editorial.toLowerCase().includes(query));
      });
      return `${UI.header(`Results for “${win.state.query.trim()}”`, Mac.plural(hits.length, 'app'))}
        ${hits.length ? `<div class="store-cards">${hits.map(item => this.card(item)).join('')}</div>`
          : UI.empty('No results', 'Try a different search term.', { icon: 'search' })}`;
    },

    detail(win) {
      const item = this.entry(win.state.detail);
      const app = Mac.apps[win.state.detail];
      if (!item || !app) return this.section(win);
      const shots = item.shots || ['Overview', 'Details', 'Settings'];
      const update = Mac.state.appUpdates.find(candidate => candidate.id === item.id);

      return `<button class="btn" data-store-section="${win.state.section}" style="margin-bottom:16px">${glyph('back', { size: 13 })} ${esc(win.state.section)}</button>
        <div class="store-detail-head">
          ${appIcon(app.icon)}
          <div style="flex:1;min-width:0">
            <h1 style="margin:0 0 4px;font-size:26px;letter-spacing:-.02em">${esc(app.title)}</h1>
            <p class="muted" style="margin:0 0 10px">${esc(item.editorial)}</p>
            <div class="row-flex">${this.actionButton(item, true)}
              ${this.installed(item.id) && !item.bundled ? `<button class="btn" data-command="store-remove" data-arg="${item.id}">Remove</button>` : ''}
              <span class="badge">${esc(item.price)}</span></div>
          </div>
        </div>
        <div class="group"><div class="row">
          <div class="row-text"><strong>Rating</strong><p>${item.ratings} ratings</p></div>
          <div class="row-action">${this.stars(item.rating)}</div></div>
          ${UI.info('Category', app.category)}
          ${UI.info('Size', Mac.bytes(item.size))}
          ${UI.info('Version', update ? `${update.version} available` : app.version)}
          ${UI.info('Compatibility', 'macOS 26.0 or later')}
          ${UI.info('Age rating', '4+')}
        </div>
        <div class="section-title">Preview</div>
        <div class="store-shots">${shots.map((shot, index) => `<div class="store-shot"
          style="--shot-a:${index % 2 ? '#8f7ff0' : '#6cc7ff'};--shot-b:${index % 2 ? '#4756d6' : '#2f7cd6'}">${esc(shot)}</div>`).join('')}</div>
        <div class="section-title">What’s new</div>
        <div class="group">${UI.info(update ? `Version ${update.version}` : `Version ${app.version}`,
          '', update ? update.notes : 'This release contains performance improvements and bug fixes.')}</div>
        <div class="section-title">Privacy</div>
        ${UI.group(
          UI.info('Data used to track you', 'None'),
          UI.info('Data linked to you', item.id === 'outlook' ? 'Contact info, Identifiers' : 'None'),
          UI.info('Data not linked to you', 'Diagnostics'),
        )}`;
    },

    /* ------------------------------------------------------------- installs */

    async install(id, { update = false } = {}) {
      const item = this.entry(id);
      const app = Mac.apps[id];
      if (!item || !app) return;

      if (!Mac.state.wifi.enabled || !Mac.state.wifi.current || Mac.state.wifi.captive) {
        Mac.Dialog.open({
          title: 'Cannot connect to the App Store',
          icon: 'warning',
          body: '<p style="margin:0;font-size:12.5px;color:var(--text-2)">The App Store needs a working internet connection to download apps. Check the network and try again.</p>',
          buttons: [{ label: 'Cancel' }, { label: 'Open Wi-Fi Settings', primary: true, action: () => Mac.run('open-setting', 'Wi-Fi') }],
        });
        return;
      }

      for (let progress = 0; progress <= 100; progress += 20) {
        Mac.session.installing[id] = progress;
        Mac.wm.refresh('appstore');
        // eslint-disable-next-line no-await-in-loop
        await Mac.wait(180);
      }
      delete Mac.session.installing[id];

      if (!this.installed(id)) Mac.state.installedApps.push(id);
      if (update) Mac.state.appUpdates = Mac.state.appUpdates.filter(candidate => candidate.id !== id);
      Mac.state.storeInstalls.unshift({ id, title: app.title, action: update ? 'Updated' : 'Installed', at: Date.now() });
      Mac.state.storeInstalls = Mac.state.storeInstalls.slice(0, 12);
      Mac.save();
      Mac.wm.refresh('appstore');
      Mac.Shell.renderDock();
      Mac.Notify.show('App Store', `${app.title} was ${update ? 'updated' : 'installed'}.`, { app: 'appstore' });
    },

    async updateAll() {
      const pending = [...Mac.state.appUpdates];
      for (const update of pending) {
        // eslint-disable-next-line no-await-in-loop
        await this.install(update.id, { update: true });
      }
      Mac.Notify.show('App Store', 'All apps are up to date.', { app: 'appstore' });
    },

    async remove(id) {
      const item = this.entry(id);
      const app = Mac.apps[id];
      if (!item || !app) return;
      if (item.bundled) {
        Mac.Dialog.info('This app cannot be removed', `${app.title} is part of macOS and stays installed.`, 'info');
        return;
      }
      const confirmed = await Mac.Dialog.confirm({
        title: `Move “${app.title}” to the Trash?`,
        body: 'The app is removed from Launchpad and the Dock. You can reinstall it from the App Store at any time.',
        confirmLabel: 'Move to Trash',
        danger: true,
      });
      if (!confirmed) return;

      Mac.wm.closeApp(id);
      Mac.state.installedApps = Mac.state.installedApps.filter(candidate => candidate !== id);
      Mac.state.dockApps = Mac.state.dockApps.filter(candidate => candidate !== id);
      Mac.state.appUpdates = Mac.state.appUpdates.filter(candidate => candidate.id !== id);
      Mac.state.storeInstalls.unshift({ id, title: app.title, action: 'Removed', at: Date.now() });
      Mac.save();
      Mac.wm.refresh('appstore');
      Mac.Shell.renderDock();
      Mac.Notify.show('App Store', `${app.title} was removed.`, { app: 'appstore' });
    },
  };

  Mac.registerApp({
    id: 'appstore',
    title: 'App Store',
    icon: 'appstore',
    category: 'Internet',
    blurb: 'Install, update and remove the apps on this Mac.',
    size: [1000, 660],
    min: [480, 340],
    singleton: true,
    initialState: () => ({ section: 'Discover', detail: null, query: '' }),
    titleFor: win => (win.state.detail ? Mac.apps[win.state.detail]?.title || 'App Store' : `App Store — ${win.state.section}`),
    menus: () => ({
      Store: [
        { label: 'Discover', command: 'store-section', arg: 'Discover' },
        { label: 'Updates', command: 'store-section', arg: 'Updates' },
        'sep',
        { label: 'Update All', command: 'store-update-all', disabled: !Mac.state.appUpdates.length },
        { label: 'Software Update…', command: 'open-setting', arg: 'Software Update' },
      ],
    }),
    render: win => Store.render(win),
  });
}(window.Mac));
