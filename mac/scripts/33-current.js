/* Current macOS reference surfaces. Research and scope: RESEARCH.md. */
(function (Mac) {
  'use strict';
  const { esc, UI, glyph } = Mac;
  const S = Mac.Settings;
  Object.assign(Mac.DefaultState.settings, { liquidGlass: 35, iconStyle: 'Default', siriMode: 'Siri AI (Beta)', showSpotlightMenu: true, autoHideMenuBarMode: 'Never' });
  Mac.DefaultState.browser.liveWeb = true;
  Mac.Web.enabled = () => true;
  Mac.DefaultState.notifications = Mac.DefaultState.notifications.filter(n => !['n-welcome','n-update'].includes(n.id));
  Mac.DefaultState.appUpdates = Mac.DefaultState.appUpdates.filter(u => u.id !== 'safari');
  const updateNotice = Mac.DefaultState.notifications.find(n => n.id === 'n-update');
  if (updateNotice) { updateNotice.title = 'App update available'; updateNotice.body = 'A Microsoft Outlook update is ready to install.'; }
  Mac.DefaultState.permissions = { Camera: { FaceTime: true, Safari: false }, Microphone: { Safari: false, 'Microsoft Outlook': true }, 'Screen & System Audio Recording': { 'Microsoft Teams': false }, Accessibility: { 'Microsoft Teams': false }, 'Full Disk Access': { Terminal: false }, Contacts: { Mail: true }, 'Files and Folders': { Safari: false, Terminal: false } };
  Mac.DefaultState.loginItems = ['Microsoft Outlook', 'Microsoft Teams'];
  Mac.DefaultState.backgroundItems = { 'Microsoft AutoUpdate': true, 'Microsoft Teams': true };
  Mac.DefaultState.mail.messages = Mac.DefaultState.mail.messages.filter(m => ['mail-3','mail-6'].includes(m.id)).map(m => ({...m,subject:m.id === 'mail-3' ? 'Project updates' : 'This weekend',preview:m.id === 'mail-3' ? 'The current documents are ready.' : 'See you on Saturday.',body:m.id === 'mail-3' ? 'Hi Isaiah,\n\nThe current documents are ready to review.\n\nDana' : 'See you on Saturday.',unread:true}));
  const oldIcon = Mac.paneIcon;
  Mac.paneIcon = (name, size) => oldIcon(({ Siri: 'Siri & Spotlight', Spotlight: 'Siri & Spotlight', 'Menu Bar': 'Control Center', Family: 'Family Sharing', 'Touch ID & Password': 'Lock Screen' })[name] || name, size);
  const oldKeywords = S.keywords;
  S.keywords = name => ({ Siri: ['siri', 'intelligence', 'requests', 'voice'], Spotlight: ['search', 'apps', 'suggestions'], 'Menu Bar': ['control center', 'clock', 'battery percentage'], Family: ['family', 'children'], 'Touch ID & Password': ['fingerprint', 'password'] })[name] || oldKeywords.call(S, name);
  S.panes.Family = S.panes['Family Sharing'];
  S.panes['Menu Bar'] = () => `${UI.header('Menu Bar')}${UI.group(UI.toggle('Show menu bar background', 'settings.menuBarTinted'), UI.select('Automatically hide and show the menu bar', 'settings.autoHideMenuBarMode', ['Always', 'On Desktop Only', 'In Full Screen Only', 'Never']))}<div class="section-title">Menu Bar Controls</div>${UI.group(UI.toggle('Wi-Fi', 'settings.showWifiMenu'), UI.toggle('Bluetooth', 'settings.showBluetoothMenu'), UI.toggle('Spotlight', 'settings.showSpotlightMenu'), UI.toggle('Show percentage', 'settings.showBatteryPercent'), UI.toggle('Use a 24-hour clock', 'settings.time24'))}`;
  S.panes.Siri = () => `${UI.header('Siri')}${UI.group(UI.toggle('Siri', 'settings.siri'), UI.select('Version', 'settings.siriMode', ['Siri AI (Beta)', 'Siri Classic']), UI.action('Requests', 'settings-sub', '', '', { arg: 'Siri Requests' }), UI.info('Language', 'English (United States)'), UI.info('Voice', 'American'))}`;
  S.subPanes['Siri Requests'] = () => `${UI.header('Requests')}${UI.group(UI.toggle('Listen for “Siri” or “Hey Siri”', 'settings.listenForSiri'), UI.toggle('Allow Siri when locked', 'settings.siriWhenLocked'))}`;
  S.panes.Spotlight = () => `${UI.header('Spotlight')}${UI.group(UI.toggle('Show related content', 'settings.spotlightSuggestions'), UI.action('Search Privacy…', 'settings-sub', '', '', { arg: 'Search Privacy' }))}`;
  S.subPanes['Search Privacy'] = () => `${UI.header('Search Privacy')}${UI.empty('No excluded locations', 'No folders have been excluded from Spotlight.', { icon: 'search' })}`;
  S.panes['Touch ID & Password'] = () => `${UI.header('Touch ID & Password')}${UI.group(UI.info('Password', 'A password has been set for this user', '', '<button class="btn" data-command="change-password">Change…</button>'), UI.toggle('Use Touch ID to unlock your Mac', 'settings.touchIdUnlock'))}`;
  const originalAppearance = S.panes.Appearance;
  S.panes.Appearance = () => originalAppearance().replace(UI.toggle('Tinted menu bar', 'settings.menuBarTinted', 'Adds a translucent backing behind the menu bar.'), '').replace(UI.toggle('Automatically hide and show the menu bar', 'settings.autoHideMenuBar'), '') + UI.group(UI.slider('Liquid Glass', 'settings.liquidGlass', { min: 0, max: 100, suffix: '%' }), UI.select('Icon & widget style', 'settings.iconStyle', ['Default', 'Dark', 'Clear', 'Tinted']), UI.select('Show scroll bars', 'settings.scrollBars', ['Automatically', 'When scrolling', 'Always']));
  S.subPanes['Login Items'] = () => `${UI.header('Login Items & Extensions')}<div class="section-title">Open at Login</div><div class="group">${Mac.state.loginItems.length ? Mac.state.loginItems.map((name, i) => `<div class="row">${Mac.appIcon(name.includes('Outlook') ? 'outlook' : 'console')}<div class="row-text"><strong>${esc(name)}</strong><p>Application</p></div><button class="icon-btn" data-command="login-remove" data-arg="${i}" aria-label="Remove ${esc(name)}">${glyph('minus')}</button></div>`).join('') : '<div class="row muted">No items</div>'}<div class="row"><button class="btn" data-command="login-add" aria-label="Add login item">+</button></div></div><div class="section-title">App Background Activity</div>${UI.group(...Object.keys(Mac.state.backgroundItems).map(name => UI.toggle(name, `backgroundItems.${name}`)))}`;
  const privacyCategories = ['Calendars','Contacts','Files & Folders','Full Disk Access','HomeKit','Media & Apple Music','Passkeys Access for Web Browsers','Photos','Reminders','Accessibility','App Management','Automation','Bluetooth','Camera','Developer Tools','Focus','Input Monitoring','Local Network','Microphone','Motion & Fitness','Remote Desktop','Screen & System Audio Recording','Speech Recognition'];
  Mac.DefaultState.permissions['Files & Folders'] = Mac.DefaultState.permissions['Files and Folders'];
  delete Mac.DefaultState.permissions['Files and Folders'];
  privacyCategories.forEach(c => { Mac.DefaultState.permissions[c] ||= {}; });
  const permissionIcon = name => ({Safari:'safari',FaceTime:'facetime',Mail:'mail',Terminal:'terminal','Microsoft Outlook':'outlook','Microsoft Teams':'messages'})[name] || 'settings';
  S.panes['Privacy & Security'] = () => `${UI.header('Privacy & Security')}${UI.group(UI.action('Location Services','settings-sub','','',{arg:'Location Services'}), ...privacyCategories.map(c => UI.action(c,'privacy-detail','','',{arg:c})))}${UI.group(UI.action('Analytics & Improvements','settings-sub','','',{arg:'Analytics & Improvements'}),UI.action('Apple Advertising','settings-sub','','',{arg:'Apple Advertising'}),UI.action('Apple Intelligence Report','settings-sub','','',{arg:'Apple Intelligence Report'}))}<div class="section-title">Security</div>${UI.group(UI.select('Allow applications from','settings.gatekeeper',['App Store','App Store and identified developers']),UI.action('FileVault','settings-sub','',Mac.state.settings.fileVault ? 'On' : 'Off',{arg:'FileVault'}),UI.action('Lockdown Mode','settings-sub','',Mac.state.settings.lockdownMode ? 'On' : 'Off',{arg:'Lockdown Mode'}))}`;
  privacyCategories.forEach(category => {
    const descriptions = {Microphone:'Allow the applications below to access your microphone.',Camera:'Allow the applications below to access your camera.',Accessibility:'Allow the applications below to control your computer.', 'Full Disk Access':'Allow the applications below to access all files on this Mac.', 'Screen & System Audio Recording':'Allow the applications below to record your screen and audio.'};
    S.subPanes[`Permission:${category}`] = () => `${UI.header(category)}<p class="section-note">${descriptions[category] || 'The applications below have requested access.'}</p>${Object.keys(Mac.state.permissions[category]).length ? UI.group(...Object.keys(Mac.state.permissions[category]).map(name => UI.toggle(name, `permissions.${category}.${name}`).replace('<div class="row-text">', `${Mac.appIcon(permissionIcon(name), 'app-icon size-28')}<div class="row-text">`))) : '<div class="group"><div class="row muted">No applications have requested access.</div></div>'}`;
  });
  S.subPanes['Location Services'] = () => `${UI.header('Location Services')}${UI.group(UI.toggle('Location Services','settings.locationServices'))}${UI.group(UI.toggle('Find My','settings.locationFindMy'),UI.toggle('Maps','settings.locationMaps'))}`;
  S.subPanes.FileVault = () => `${UI.header('FileVault')}${UI.group(UI.toggle('FileVault','settings.fileVault','FileVault secures the data on your Mac by encrypting the contents of your startup disk.'))}`;
  S.subPanes['Lockdown Mode'] = () => `${UI.header('Lockdown Mode')}${UI.group(UI.toggle('Lockdown Mode','settings.lockdownMode'))}`;
  S.subPanes['Analytics & Improvements'] = () => `${UI.header('Analytics & Improvements')}${UI.group(UI.toggle('Share Mac Analytics','settings.analytics'),UI.toggle('Improve Siri & Dictation','settings.improveSiri'))}`;
  S.subPanes['Apple Advertising'] = () => `${UI.header('Apple Advertising')}${UI.group(UI.toggle('Personalized Ads','settings.personalizedAds'))}`;
  S.subPanes['Apple Intelligence Report'] = () => `${UI.header('Apple Intelligence Report')}${UI.group(UI.select('Report Duration','settings.intelligenceReport',['Off','15 minutes','7 days']))}`;
  S.subPanes.Firewall = () => `${UI.header('Firewall')}${UI.group(UI.toggle('Firewall', 'settings.firewall'), UI.toggle('Block all incoming connections', 'settings.blockIncoming'))}`;
  S.panes.Network = () => `${UI.header('Network')}${UI.group(`<button class="row tappable" data-settings-pane="Wi-Fi">${Mac.paneIcon('Wi-Fi', 'size-28')}<div class="row-text"><strong>Wi-Fi</strong><p>${Mac.state.wifi.enabled && Mac.state.wifi.current ? 'Connected' : 'Not connected'}</p></div><span class="chevron">${glyph('chevron')}</span></button>`, UI.info('Thunderbolt Bridge', 'Not connected'))}${UI.group(UI.action('Firewall', 'settings-sub', '', Mac.state.settings.firewall ? 'Active' : 'Inactive', { arg: 'Firewall' }))}`;
  S.panes['Wi-Fi'] = () => {
    const w = Mac.state.wifi;
    const row = n => `<div class="row">${glyph('wifi', { size: 20 })}<div class="row-text"><strong>${esc(n.name)}</strong></div><span>${n.security === 'Open' ? '' : glyph('lock', { size: 12 })}</span><button class="btn" data-command="wifi-join" data-arg="${esc(n.name)}">Connect</button></div>`;
    return `${UI.header('Wi-Fi')}${UI.group(UI.toggle('Wi-Fi', 'wifi.enabled', '', { command: 'wifi-sync' }), w.enabled && w.current ? `<div class="row">${glyph('wifi', { size: 22 })}<div class="row-text"><strong>${esc(w.current)}</strong><p>${w.captive ? 'No Internet Connection' : 'Connected'}</p></div><button class="btn" data-command="wifi-details">Details…</button></div>` : '')}${w.enabled ? `<div class="section-title">Known Networks</div>${UI.group(...Mac.NETWORKS.filter(n => w.saved.includes(n.name) && n.name !== w.current).map(row))}<div class="section-title">Other Networks</div>${UI.group(...Mac.NETWORKS.filter(n => !w.saved.includes(n.name)).map(row), UI.action('Other…', 'wifi-hidden'))}${UI.group(UI.select('Ask to join networks', 'settings.askToJoin', ['Off', 'Notify', 'Ask']), UI.action('Advanced…', 'wifi-known'))}` : UI.empty('Wi-Fi is turned off', 'Turn on Wi-Fi to see available networks.', { icon: 'wifi-off' })}`;
  };
  Mac.Shell.renderWidgets = () => { const host = Mac.$('#desktop-widgets'); if (host) host.innerHTML = ''; };
  S.subPanes['Software Update'] = () => {
    const os = Mac.OS.update(); const pending = Mac.OS.pending();
    return `${UI.header('Software Update')}${UI.group(UI.action('Automatic Updates', 'settings-sub', '', Mac.state.settings.autoUpdates ? 'On' : 'Off', {arg:'Automatic Updates'}))}<div class="os-update-status">${Mac.appIcon('settings', 'app-icon')}<strong>${pending ? 'macOS Golden Gate '+esc(os.version) : 'Your Mac is up to date'}</strong><p>macOS Golden Gate ${pending ? esc(os.version) : Mac.OS.version()}</p>${pending ? `<button class="btn primary" data-command="os-update" data-arg="${os.stage === 'downloaded' ? 'install' : 'download'}">${os.stage === 'downloaded' ? 'Restart Now' : os.stage === 'downloading' ? 'Downloading… '+os.progress+'%' : os.stage === 'installing' ? 'Preparing… '+os.progress+'%' : 'Update Now'}</button>` : ''}</div>${UI.group(UI.select('Beta Updates', 'settings.betaUpdates', ['Off']))}`;
  };
  S.subPanes['Automatic Updates'] = () => `${UI.header('Automatic Updates')}${UI.group(UI.toggle('Check for updates', 'settings.autoUpdates'),UI.toggle('Download new updates when available', 'settings.downloadUpdates'),UI.toggle('Install macOS updates', 'settings.installMacUpdates'),UI.toggle('Install Security Responses and system files', 'settings.installSecurityResponses'))}`;
  Mac.DefaultState.browser.favorites = [{title:'Apple',url:'apple.local',color:'#333'},{title:'Apple Support',url:'support.apple.local',color:'#333'},{title:'Wikipedia',url:'wikipedia.org/wiki/Main_Page',color:'#333'}];
  Mac.Browser.startPage = () => `<div class="web-page start-page native-start-page"><section><h2>Favorites</h2><div class="favorites-grid">${Mac.state.browser.favorites.map(f => `<button class="favorite" data-command="browse" data-arg="${esc(f.url)}"><i style="background:${f.color}">${esc(f.title[0])}</i>${esc(f.title)}</button>`).join('')}</div></section><section class="privacy-report"><h2>Privacy Report</h2><div class="web-card">${glyph('shield')}<strong>0</strong><span>Trackers prevented from profiling you</span></div></section></div>`;
  const nativeArticles = Mac.Browser.articles;
  Mac.Browser.articles = function () {
    const articles = nativeArticles.call(this);
    const support = () => `<div class="web-page"><div class="web-wrap"><p class="web-eyebrow">Apple Support</p><h1>Mac User Guide</h1><p>macOS Golden Gate</p><div class="web-card"><h2>Welcome</h2><p>Explore the desktop, work with files, and personalize your Mac.</p></div></div></div>`;
    return {'support.apple.local':support,'apple.local':() => `<div class="web-page"><div class="web-wrap"><p class="web-eyebrow">Apple</p><h1>Mac</h1><div class="web-card"><h2>macOS Golden Gate</h2></div></div></div>`,'network.test':articles['network.test']};
  };
  Mac.Browser.searchPage = q => `<div class="web-page"><div class="web-wrap"><h1>Results for “${esc(q)}”</h1><div class="web-card"><button data-command="browse" data-arg="support.apple.local"><h2>Mac User Guide</h2><p>Apple Support</p></button></div></div></div>`;
  // Apps now opens the Spotlight app browser, replacing the older Launchpad surface.
  Mac.apps.launchpad.title = 'Apps';
  Mac.apps.launchpad.icon = 'apps';
  Mac.Shell.openLaunchpad = () => Mac.Spotlight.openApps();
  Mac.Shell.closeLaunchpad = () => Mac.Spotlight.close();
  Mac.Spotlight.openApps = function (category = 'All Apps', query = '') {
    Mac.Surfaces.close(); Mac.session.surface = 'spotlight';
    this.flat = []; this.index = 0;
    this.appsCategory = category; this.appsQuery = query;
    const categoryOf = a => ['Communication','Productivity'].includes(a.category) ? 'Productivity & Finance' : a.category;
    const apps = Mac.appList().filter(a => !['launchpad','trash'].includes(a.id) && (category === 'All Apps' || categoryOf(a) === category) && a.title.toLowerCase().includes(query.toLowerCase()));
    Mac.$('#surface-layer').innerHTML = `<div class="spotlight-backdrop" data-command="close-spotlight"></div><section class="spotlight spotlight-apps" role="dialog" aria-label="Apps in Spotlight"><div class="spotlight-head">${Mac.appIcon('apps', 'app-icon size-24')}<input id="apps-search" value="${esc(query)}" placeholder="${category === 'All Apps' ? 'Search Apps' : category}" aria-label="Search Apps"><button class="icon-btn apps-more" data-command="apps-more" aria-label="More">${glyph('more')}</button></div>${this.appsMore ? `<div class="apps-options">${['All Apps','Productivity & Finance','Utilities','System'].map(c => `<button class="btn" data-command="apps-category" data-arg="${c}">${c}</button>`).join('')}<button class="btn" data-command="apps-view" data-arg="grid">Grid</button><button class="btn" data-command="apps-view" data-arg="list">List</button></div>` : ''}<div class="apps-grid ${this.appsView === 'list' ? 'list-view' : ''}">${apps.map(a => `<button data-command="apps-launch" data-arg="${a.id}">${Mac.appIcon(a.icon)}<span>${esc(a.title)}</span></button>`).join('') || '<p class="muted">No Results</p>'}</div></section>`;
    const field = Mac.$('#apps-search'); field.focus(); field.setSelectionRange(query.length, query.length);
  };
  const nativeSpotActions = Mac.Spotlight.actions;
  Mac.Spotlight.actions = function () { return nativeSpotActions.call(this).filter(a => a.command !== 'run-diagnostics'); };
  const originalSpotOpen = Mac.Spotlight.open;
  Mac.Spotlight.open = function () {
    originalSpotOpen.call(this);
    const head = Mac.$('.spotlight-head');
    if (head) head.insertAdjacentHTML('beforeend', '<button class="btn" data-command="launchpad" aria-label="Applications">Apps</button>');
  };
  // Preview launches into the file-opening panel until a document is selected.
  const nativeWindowOpen = Mac.wm.open;
  Mac.Preview = {
    folder: 'dir-documents', selected: null,
    choose(folder = 'dir-documents') {
      this.folder = folder; this.selected = null;
      const items = Mac.FS.children(folder).filter(n => n.kind === 'folder' || ['pdf','png','jpg','jpeg'].includes(n.ext));
      const places = [['dir-desktop','Desktop'],['dir-documents','Documents'],['dir-downloads','Downloads'],['dir-pictures','Pictures']];
      Mac.Dialog.open({title:'Open',wide:true,className:'preview-open-panel',body:`<div class="file-open-layout"><nav aria-label="Favorites"><div class="section-title">Favorites</div>${places.map(([id,name]) => `<button class="side-item ${id === folder ? 'on' : ''}" data-command="preview-folder" data-arg="${id}">${glyph(id === 'dir-documents' ? 'document' : 'folder')} ${name}</button>`).join('')}</nav><section><div class="file-open-location">${esc(Mac.FS.node(folder)?.name || 'Documents')}</div><div role="listbox" aria-label="Files">${items.map(n => `<button class="file-open-item" role="option" aria-selected="false" data-command="preview-select" data-arg="${n.id}" data-kind="${n.kind}">${glyph(n.kind === 'folder' ? 'folder' : 'document')}<span>${esc(n.name)}</span><small>${n.kind === 'folder' ? 'Folder' : n.ext.toUpperCase()+' document'}</small></button>`).join('') || '<p class="muted">No items</p>'}</div></section></div>`,buttons:[{label:'Cancel'},{label:'Open',primary:true,close:false,action:() => this.openSelected()}]});
      Mac.$('.preview-open-panel .dialog-actions button:last-child')?.setAttribute('disabled','');
    },
    select(id) {
      const node = Mac.FS.node(id);
      if (!node) return;
      if (node.kind === 'folder') return this.choose(id);
      this.selected = id;
      Mac.$$('.file-open-item').forEach(b => b.setAttribute('aria-selected',String(b.dataset.arg === id)));
      Mac.$('.preview-open-panel .dialog-actions button:last-child')?.removeAttribute('disabled');
    },
    openSelected() { if (!this.selected) return; const id=this.selected; Mac.Dialog.close(); return nativeWindowOpen.call(Mac.wm,'preview',{newWindow:true,state:{fileId:id}}); }
  };
  Mac.wm.open = function (id,options = {}) {
    if (id === 'preview' && !options.state?.fileId && !this.forApp(id).length) { Mac.Preview.choose(); return null; }
    return nativeWindowOpen.call(this,id,options);
  };
  const originalSync = Mac.sync;
  Mac.sync = () => {
    const mode = Mac.state.settings.autoHideMenuBarMode;
    Mac.state.settings.autoHideMenuBar = mode === 'Always' || (mode === 'On Desktop Only' && !Mac.session.fullscreenWindow) || (mode === 'In Full Screen Only' && !!Mac.session.fullscreenWindow);
    originalSync();
    const root = Mac.$('#simulator');
    root.dataset.iconStyle = Mac.state.settings.iconStyle;
    root.style.setProperty('--glass-tint', Mac.state.settings.liquidGlass / 100);
    if (!Mac.state.settings.showSpotlightMenu) Mac.$('[data-command="spotlight"].status-item')?.remove();
  };
  const offlineReason = Mac.Network.offlineReason;
  Mac.Network.offlineReason = function () {
    const reason = offlineReason.call(this);
    if (reason) return reason;
    const w = Mac.state.wifi;
    if (!w.ip || w.ip === '0.0.0.0' || w.ip.startsWith('169.254.')) return 'no-network';
    if (w.httpsProxy || w.socksProxy || w.pacProxy) return 'proxy';
    return null;
  };

  // Native network Details: edits are transactional across tabs.
  const DETAILS = ['Wi-Fi', 'TCP/IP', 'DNS', 'WINS', '802.1X', 'Proxies', 'Hardware'];
  const field = (label, key, value, disabled = false) => `<label class="net-field"><span>${esc(label)}</span><input class="field" data-net-field="${key}" value="${esc(value)}" ${disabled ? 'disabled' : ''}></label>`;
  Mac.Network.details = function (tab = 'Wi-Fi') {
    if (!Mac.state.wifi.current) return Mac.Dialog.info('Not connected', 'Join a Wi-Fi network to see its details.');
    this.draft = Mac.clone(Mac.state.wifi); this.draft.domainRows=String(this.draft.searchDomains||'').split(/[,\s]+/).filter(Boolean); this.detailTab = tab;
    this.renderDetails();
  };
  Mac.Network.editDNS = () => Mac.Network.details('DNS');
  const showScreen = Mac.Screens.show;
  Mac.Screens.show = function (id) { if (id === 'desktop') return this.desktop(); return showScreen.call(this, id); };
  Mac.Network.collectDetails = function () {
    Mac.$$('[data-net-field]').forEach(e => { this.draft[e.dataset.netField] = e.type === 'checkbox' ? e.checked : e.value; });
    const dns = Mac.$$('[data-dns-address]');
    if (this.detailTab === 'DNS'){this.draft.dns = dns.map(e => e.value.trim());this.draft.domainRows=Mac.$$('[data-search-domain]').map(e=>e.value.trim());this.draft.searchDomains=this.draft.domainRows.filter(Boolean).join(', ');}
  };
  Mac.Network.renderDetails = function () {
    const w = this.draft; const tab = this.detailTab;
    let content = '';
    const check = (label, key, on) => `<label class="row net-check"><strong>${esc(label)}</strong><input type="checkbox" data-net-field="${key}" ${on ? 'checked' : ''}></label>`;
    if (tab === 'Wi-Fi') content = `${UI.header(w.current)}${UI.group(UI.info('Status', 'Connected'), check('Automatically join this network', 'joinCurrent', w.autoJoin[w.current] !== false), check('Limit IP address tracking', 'limitTracking', w.limitTracking !== false), `<label class="net-field"><span>Private Wi-Fi address</span><select data-net-field="privateAddress">${['Off', 'Fixed', 'Rotating'].map(v => `<option ${v === (w.privateAddress || 'Fixed') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`)}${UI.group(UI.info('IP address', w.ip), UI.info('Router', w.router))}<button class="btn destructive" data-command="wifi-forget" data-arg="${esc(w.current)}">Forget This Network…</button>`;
    if (tab === 'TCP/IP') content = `${UI.header('TCP/IP')}<label class="net-field"><span>Configure IPv4</span><select data-net-field="dhcp"><option value="true" ${w.dhcp === true || w.dhcp === 'true' ? 'selected' : ''}>Using DHCP</option><option value="false" ${w.dhcp === false || w.dhcp === 'false' ? 'selected' : ''}>Manually</option></select></label>${field('IP address', 'ip', w.ip, w.dhcp === true || w.dhcp === 'true')}${field('Subnet mask', 'subnet', w.subnet, w.dhcp === true || w.dhcp === 'true')}${field('Router', 'router', w.router, w.dhcp === true || w.dhcp === 'true')}${field('DHCP client ID', 'clientId', w.clientId || '')}<button class="btn" data-command="net-renew">Renew DHCP Lease</button><hr>${UI.info('Configure IPv6', 'Automatically')}${UI.info('IPv6 address', 'fe80::42:1')}`;
    if (tab === 'DNS') content = `${UI.header('DNS')}<div class="section-title">DNS Servers</div><div class="dns-list">${w.dns.map((ip, i) => `<div><input class="field" aria-label="DNS server ${i + 1}" data-dns-address="${i}" value="${esc(ip)}"><button class="icon-btn" data-command="net-dns-remove" data-arg="${i}" aria-label="Remove DNS server ${i + 1}">−</button></div>`).join('') || '<p class="muted">Using DNS supplied by DHCP</p>'}</div><button class="btn" data-command="net-dns-add" aria-label="Add DNS server">+</button><div class="section-title">Search Domains</div><div class="dns-list">${(w.domainRows||[]).map((domain,i)=>`<div><input class="field" aria-label="Search domain ${i+1}" data-search-domain="${i}" value="${esc(domain)}"><button class="icon-btn" data-command="net-domain-remove" data-arg="${i}" aria-label="Remove search domain ${i+1}">−</button></div>`).join('')}</div><button class="btn" data-command="net-domain-add" aria-label="Add search domain">+</button>`;
    if (tab === 'Proxies') content = `${UI.header('Proxies')}${UI.group(check('Auto proxy discovery', 'autoProxy', w.autoProxy), check('Automatic proxy configuration', 'pacProxy', w.pacProxy), check('Web proxy (HTTP)', 'proxy', w.proxy), check('Secure web proxy (HTTPS)', 'httpsProxy', w.httpsProxy), check('SOCKS proxy', 'socksProxy', w.socksProxy))}${field('Server', 'proxyServer', w.proxyServer || 'proxy.example')}${field('Port', 'proxyPort', w.proxyPort || '8080')}`;
    if (tab === 'Hardware') content = `${UI.header('Hardware')}${UI.group(UI.info('MAC address', '02:00:00:27:00:01'), UI.info('Configure', 'Automatically'), UI.info('MTU', 'Standard (1500)'))}`;
    if (tab === 'WINS') content = `${UI.header('WINS')}${field('NetBIOS name', 'netbios', w.netbios || 'ISAIAH-MACBOOK')}${field('Workgroup', 'workgroup', w.workgroup || 'WORKGROUP')}`;
    if (tab === '802.1X') content = `${UI.header('802.1X')}${UI.empty('No configuration profiles', 'No 802.1X profiles are installed.', { icon: 'network' })}`;
    Mac.Dialog.open({ title: w.current, wide: true, className: 'network-details', body: `<div class="net-layout"><nav aria-label="Network details sections">${DETAILS.map(t => `<button class="side-item ${tab === t ? 'on' : ''}" data-command="net-tab" data-arg="${t}">${t}</button>`).join('')}</nav><section class="net-content">${content}<p id="net-error" class="field-error" role="alert"></p></section></div>`, buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, close: false, action: () => this.applyDetails() }] });
  };
  Mac.Network.applyDetails = function () {
    this.collectDetails(); const w = this.draft;
    w.dns = w.dns.filter(Boolean);
    const ipv4 = v => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every(n => Number(n) <= 255);
    const address=v=>{if(ipv4(v))return true;if(!v.includes(':'))return false;try{return Boolean(new URL('http://['+v+']/').hostname);}catch{return false;}};
    if (!w.dns.every(address)) { Mac.$('#net-error').textContent = 'Enter valid IPv4 or IPv6 DNS server addresses.'; return; }
    if (![w.ip, w.router, w.subnet].every(ipv4)) { Mac.$('#net-error').textContent = 'Enter valid IPv4 addresses for IP address, router and subnet mask.'; return; }
    delete w.domainRows;
    w.dhcp = w.dhcp === true || w.dhcp === 'true';
    if ('joinCurrent' in w) w.autoJoin[w.current] = w.joinCurrent;
    delete w.joinCurrent;
    Mac.Dialog.close(); Mac.state.wifi = w; Mac.save(); Mac.sync(); Mac.wm.refreshAll();
  };
  // Keep Settings titles meaningful for privacy subpages and update breadcrumbs.
  Mac.apps.settings.titleFor = win => (win.state.stack.at(-1) || win.state.pane).replace('Permission:', '').replace(/^Login Items$/, 'Login Items & Extensions');
  const baseRun = Mac.run;
  Mac.run = async (command, arg, element) => {
    if (command === 'preview-folder') return Mac.Preview.choose(arg);
    if (command === 'preview-select') return Mac.Preview.select(arg);
    if (command.startsWith('net-')) {
      const N = Mac.Network;
      if (command === 'net-tab') { N.collectDetails(); N.detailTab = arg; N.renderDetails(); if (arg === 'DNS') Mac.Scenarios.record('edit-dns'); return; }
      if (command === 'net-dns-add') { N.collectDetails(); N.draft.dns.push(''); N.renderDetails(); Mac.$$('[data-dns-address]').at(-1)?.focus(); return; }
      if (command === 'net-domain-add') { N.collectDetails(); (N.draft.domainRows||=[]).push(''); N.renderDetails(); Mac.$$('[data-search-domain]').at(-1)?.focus(); return; }
      if (command === 'net-domain-remove') { N.collectDetails(); N.draft.domainRows.splice(Number(arg),1); N.renderDetails(); return; }
      if (command === 'net-dns-remove') { N.collectDetails(); N.draft.dns.splice(Number(arg), 1); N.renderDetails(); return; }
      if (command === 'net-renew') { N.collectDetails(); N.draft.dhcp = true; N.draft.ip = '192.168.1.57'; N.renderDetails(); return; }
    }
    if (command === 'edit-dns') { Mac.Scenarios.record('edit-dns'); return Mac.Network.details('DNS'); }
    if (command === 'privacy-detail') { S.open('Privacy & Security', `Permission:${arg}`); Mac.Scenarios.record('privacy-detail', arg); return; }
    if (command === 'login-remove') { Mac.state.loginItems.splice(Number(arg), 1); Mac.save(); Mac.wm.refreshAll(); return; }
    if (command === 'login-add') {
      Mac.Dialog.open({title:'Applications',wide:true,body:`<div class="login-chooser">${Mac.appList().filter(a => !['trash','launchpad','finder'].includes(a.id)).map(a => `<button class="row tappable" data-command="login-choose" data-arg="${a.id}">${Mac.appIcon(a.icon,'app-icon size-28')}<strong>${esc(a.title)}</strong></button>`).join('')}</div>`,buttons:[{label:'Cancel'}]}); return;
    }
    if (command === 'login-choose') { const app = Mac.apps[arg]; if (app && !Mac.state.loginItems.includes(app.title)) Mac.state.loginItems.push(app.title); Mac.Dialog.close(); Mac.save(); Mac.wm.refreshAll(); return; }
    if (command === 'apps-more') { Mac.Spotlight.appsMore = !Mac.Spotlight.appsMore; return Mac.Spotlight.openApps(Mac.Spotlight.appsCategory, Mac.Spotlight.appsQuery); }
    if (command === 'apps-view') { Mac.Spotlight.appsView = arg; Mac.Spotlight.appsMore = false; return Mac.Spotlight.openApps(Mac.Spotlight.appsCategory, Mac.Spotlight.appsQuery); }
    if (command === 'apps-category') { Mac.Spotlight.appsMore = false; return Mac.Spotlight.openApps(arg, Mac.Spotlight.appsQuery); }
    if (command === 'apps-launch') { Mac.Spotlight.close(); return Mac.wm.open(arg); }
    await baseRun(command, arg, element);
  };
  document.addEventListener('input', e => { if (e.target.id === 'apps-search') Mac.Spotlight.openApps(Mac.Spotlight.appsCategory, e.target.value); });
  document.addEventListener('change', e => { if (e.target.matches('[data-net-field="dhcp"]')) { Mac.Network.collectDetails(); Mac.Network.renderDetails(); } });

  // Scenarios start from a complete clean baseline, so faults cannot leak between calls.
  const startScenario = Mac.Scenarios.start;
  Mac.Scenarios.start = function (id) {
    const appearance = Mac.state.settings.appearance;
    Mac.state = Mac.clone(Mac.DefaultState); Mac.state.settings.appearance = appearance;
    [...Mac.wm.windows.keys()].forEach(id => Mac.wm.close(id));
    startScenario.call(this, id); Mac.Dialog.close();
  };
  const disk = Mac.Scenarios.find('full-disk');
  const originalDiskSetup = disk.setup;
  disk.setup = () => { originalDiskSetup(); Mac.state.fs.push({ id: 'f-large-old-backup', name: 'Old Local Backup.zip', parent: 'trash', trashedFrom: 'dir-downloads', kind: 'file', ext: 'zip', size: 32 * 1024 ** 3, modified: Date.now() }); };
  const deleteForever = Mac.FS.deleteForever;
  Mac.FS.deleteForever = function (id) { const size = Mac.FS.sizeOf(Mac.FS.node(id)); deleteForever.call(this, id); Mac.state.volumes[0].usedBytes = Math.max(0, Mac.state.volumes[0].usedBytes - size); Mac.save(); };
  Mac.Scenarios.find('no-internet').hints = ['A Wi-Fi connection proves only that the Mac reached the access point.', 'Choose Wi-Fi › Details… › DNS. The practice fault is an unreachable manual DNS server.', 'Remove the unreachable DNS entry, click OK, and verify a page loads in Safari.'];
  Mac.Scenarios.find('proxy').title = 'Apps cannot connect through a proxy';
  Mac.Scenarios.find('proxy').brief = 'The customer cannot load pages. Check the configured proxy and verify the connection after correcting it.';
  Mac.Scenarios.find('proxy').hints = ['Choose Wi-Fi › Details… › Proxies.', 'Disable the practice Web proxy, click OK, and load support.apple.local in Safari.'];
  Mac.Scenarios.all.push({ id: 'microphone', title: 'The microphone is blocked in Safari', brief: 'The customer cannot use the microphone in a browser call. Find Safari’s microphone permission and enable it.', setup() { Mac.state.permissions.Microphone.Safari = false; }, hints: ['Choose System Settings › Privacy & Security › Microphone.'], checks: [{ id: 'permission', label: 'Safari microphone access enabled', done: () => Mac.state.permissions.Microphone.Safari }] }, { id: 'screen-sharing', title: 'Screen sharing shows a blank screen', brief: 'A customer’s Teams call cannot share their screen. Locate the screen recording permission and enable it.', setup() { Mac.state.permissions['Screen & System Audio Recording']['Microsoft Teams'] = false; }, hints: ['System Settings › Privacy & Security › Screen & System Audio Recording. Ask the customer to quit and reopen Teams after changing access.'], checks: [{ id: 'permission', label: 'Teams screen recording access enabled', done: () => Mac.state.permissions['Screen & System Audio Recording']['Microsoft Teams'] }] }, { id: 'login-items', title: 'An unwanted app opens at sign-in', brief: 'Outlook opens every time the customer signs in. Remove it from Open at Login without disabling other background items.', setup() {}, hints: ['System Settings › General › Login Items & Extensions. Remove Outlook from Open at Login.'], checks: [{ id: 'removed', label: 'Outlook removed from Open at Login', done: () => !Mac.state.loginItems.includes('Microsoft Outlook') }, { id: 'background', label: 'Other background activity preserved', done: () => Mac.state.backgroundItems['Microsoft AutoUpdate'] }] });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === '1' && Mac.session.surface === 'spotlight') { e.preventDefault(); Mac.Spotlight.openApps(); return; }
    if (!Mac.$('.spotlight-apps')) return;
    const buttons = Mac.$$('.apps-grid [data-command="apps-launch"]');
    if (!buttons.length) return;
    if (e.key === 'Enter' && (document.activeElement?.id === 'apps-search' || buttons.includes(document.activeElement))) { e.preventDefault(); (buttons.includes(document.activeElement) ? document.activeElement : buttons[0]).click(); return; }
    if (['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(e.key) && (document.activeElement?.id === 'apps-search' || document.activeElement?.matches('[data-command="apps-launch"]'))) {
      e.preventDefault(); const cols = Mac.Spotlight.appsView === 'list' ? 1 : (innerWidth <= 700 ? 5 : 7);
      const delta = {ArrowRight:1,ArrowLeft:-1,ArrowDown:cols,ArrowUp:-cols}[e.key];
      const index = buttons.indexOf(document.activeElement);
      buttons[Math.max(0, Math.min(buttons.length-1, index < 0 ? 0 : index+delta))].focus();
    }
  });
}(window.Mac));
