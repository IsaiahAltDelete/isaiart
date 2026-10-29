/* ===========================================================================
   Smaller system apps: Run, About Windows, Control Panel (with Network
   Connections, classic adapter dialogs and the network troubleshooter),
   Microsoft Store, Outlook, Weather, Copilot and Snipping Tool.
   =========================================================================== */

(function (Win) {
  'use strict';

  const esc = Win.esc;

  /* ------------------------------------------------------- command routing */

  const MS_SETTINGS = {
    '': 'home', 'network-wifi': 'wifi', 'network-status': 'network', network: 'network', 'network-proxy': 'proxy', 'network-vpn': 'vpn',
    'network-airplanemode': 'airplane', 'network-mobilehotspot': 'hotspot', 'network-advancedsettings': 'advanced-network',
    'network-wifisettings': 'wifi-manage', display: 'display', sound: 'sound', notifications: 'notifications', powersleep: 'power',
    storagesense: 'storage', about: 'about', bluetooth: 'bluetooth', printers: 'printers', mousetouchpad: 'mouse',
    personalization: 'personalization', 'personalization-background': 'background', colors: 'colors', themes: 'themes',
    lockscreen: 'lock-screen', 'personalization-start': 'start', taskbar: 'taskbar', appsfeatures: 'installed-apps',
    defaultapps: 'default-apps', startupapps: 'startup', yourinfo: 'your-info', signinoptions: 'sign-in', otherusers: 'other-users',
    dateandtime: 'date-time', regionlanguage: 'language', 'gaming-gamemode': 'gaming', easeofaccess: 'accessibility',
    privacy: 'privacy', windowsdefender: 'security', windowsupdate: 'update', 'windowsupdate-history': 'update-history',
    multitasking: 'multitasking', developers: 'system',
  };

  /** Open a ms-settings: URI. Returns false if it isn't one. */
  Win.msSettings = uri => {
    const m = String(uri).trim().match(/^ms-settings:(.*)$/i);
    if (!m) return false;
    Win.wm.open('settings', { page: MS_SETTINGS[m[1].toLowerCase()] || 'home' });
    return true;
  };

  const RUN = {
    notepad: () => Win.wm.open('notepad'), 'notepad.exe': () => Win.wm.open('notepad'),
    calc: () => Win.wm.open('calculator'), 'calc.exe': () => Win.wm.open('calculator'),
    cmd: () => Win.wm.open('cmd'), 'cmd.exe': () => Win.wm.open('cmd'),
    powershell: () => Win.wm.open('powershell'), 'powershell.exe': () => Win.wm.open('powershell'),
    wt: () => Win.wm.open('terminal'), 'wt.exe': () => Win.wm.open('terminal'),
    explorer: () => Win.wm.open('explorer'), 'explorer.exe': () => Win.wm.open('explorer'),
    control: () => Win.wm.open('controlpanel'), 'control panel': () => Win.wm.open('controlpanel'),
    'ncpa.cpl': () => Win.wm.open('controlpanel', { view: 'connections' }),
    'appwiz.cpl': () => Win.wm.open('settings', { page: 'installed-apps' }),
    'sysdm.cpl': () => Win.wm.open('settings', { page: 'about' }),
    'inetcpl.cpl': () => Win.wm.open('settings', { page: 'proxy' }),
    'mmsys.cpl': () => Win.wm.open('settings', { page: 'sound' }),
    'desk.cpl': () => Win.wm.open('settings', { page: 'display' }),
    'timedate.cpl': () => Win.wm.open('settings', { page: 'date-time' }),
    'firewall.cpl': () => Win.wm.open('settings', { page: 'security' }),
    msedge: () => Win.wm.open('edge'), 'msedge.exe': () => Win.wm.open('edge'),
    mspaint: () => Win.wm.open('paint'), 'mspaint.exe': () => Win.wm.open('paint'),
    taskmgr: () => Win.wm.open('taskmgr'), 'taskmgr.exe': () => Win.wm.open('taskmgr'),
    winver: () => Win.wm.open('winver'), 'winver.exe': () => Win.wm.open('winver'),
    snippingtool: () => Win.wm.open('snip'), outlook: () => Win.wm.open('mail'),
    'ms-photos:': () => Win.wm.open('photos'), 'ms-clock:': () => Win.wm.open('clock'),
    'shell:recyclebinfolder': () => Win.wm.open('explorer', { path: 'bin' }),
    'shell:downloads': () => Win.wm.open('explorer', { path: 'downloads' }),
    'shell:desktop': () => Win.wm.open('explorer', { path: 'desktop' }),
    'shell:mycomputerfolder': () => Win.wm.open('explorer', { path: 'pc' }),
  };

  /**
   * Shared launcher for Run, Search and Task Manager's "Run new task".
   * Resolves true if something opened, false (after an error dialog) if not.
   */
  Win.runCommand = async (input, { admin = false } = {}) => {
    const text = String(input || '').trim();
    if (!text) return false;
    const key = text.toLowerCase();
    if (Win.msSettings(text)) return true;
    const [cmd, ...rest] = text.split(/\s+/);
    if (RUN[key]) { admin ? Win.UAC(text, RUN[key]) : RUN[key](); return true; }
    if (RUN[cmd.toLowerCase()] && rest.length) {
      if (/^notepad(\.exe)?$/i.test(cmd)) {
        const id = Win.FS.resolve(rest.join(' '), 'home');
        Win.wm.open('notepad', id ? { fileId: id } : {});
        return true;
      }
      if (/^explorer(\.exe)?$/i.test(cmd)) {
        const id = Win.FS.resolve(rest.join(' '), 'home');
        Win.wm.open('explorer', { path: id || 'home' });
        return true;
      }
      RUN[cmd.toLowerCase()]();
      return true;
    }
    if (/^(https?:\/\/|www\.)/i.test(text)) { Win.wm.open('edge', { url: text }); return true; }
    const id = Win.FS.resolve(text, 'home');
    if (id && /^([a-z]:|\\|%|~)/i.test(text)) { Win.openFile ? Win.openFile(id) : Win.wm.open('explorer', { path: id }); return true; }
    const app = Win.apps.all().find(a => a.name.toLowerCase() === key || a.id === key);
    if (app) { Win.wm.open(app.id); return true; }
    await Win.dialog({
      title: text,
      icon: `<span style="color:var(--critical)">${Win.glyph('error', 24)}</span>`,
      body: `<p>Windows cannot find '${esc(text)}'. Make sure you typed the name correctly, and then try again.</p>`,
    });
    return false;
  };

  /* ------------------------------------------------------------------ Run */

  Win.apps.register({
    id: 'run', name: 'Run', icon: 'windows', hidden: true, single: true, fixed: true, width: 420, height: 230, minWidth: 420, minHeight: 230,
    create(win) {
      win.el.style.left = '12px';
      win.el.style.top = `${innerHeight - 48 - 242}px`;
      win.rect.x = 12;
      win.rect.y = innerHeight - 48 - 242;
      const history = Win.state.runHistory || [];
      win.body.innerHTML = `<div class="run">
        <div class="run-top">${Win.appIcon('windows', 32)}<p>Type the name of a program, folder, document, or Internet resource, and Windows will open it for you.</p></div>
        <label class="run-field"><span>Open:</span><input class="input" list="run-history" value="${esc(history[0] || '')}" autofocus spellcheck="false" aria-label="Open"><datalist id="run-history">${history.map(h => `<option value="${esc(h)}">`).join('')}</datalist></label>
        <label class="check run-admin"><input type="checkbox" data-admin> Create this task with administrative privileges.</label>
        <div class="run-actions"><button class="btn accent" data-run="ok">OK</button><button class="btn" data-run="cancel">Cancel</button><button class="btn" data-run="browse">Browse…</button></div>
      </div>`;
      const input = win.body.querySelector('input');
      setTimeout(() => { input.focus(); input.select(); }, 30);
      const go = async () => {
        const value = input.value.trim();
        if (!value) return;
        Win.state.runHistory = [value, ...history.filter(h => h !== value)].slice(0, 12);
        Win.save();
        win.close();
        await Win.runCommand(value, { admin: win.body.querySelector('[data-admin]').checked });
      };
      win.body.addEventListener('click', async e => {
        const act = e.target.closest('[data-run]')?.dataset.run;
        if (act === 'ok') go();
        if (act === 'cancel') win.close();
        if (act === 'browse' && Win.pickFile) {
          const pick = await Win.pickFile({ mode: 'open', title: 'Browse' });
          if (pick?.id) { input.value = Win.FS.path(pick.id); input.focus(); }
        }
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } if (e.key === 'Escape') win.close(); });
    },
  });

  /* --------------------------------------------------------------- winver */

  Win.apps.register({
    id: 'winver', name: 'About Windows', icon: 'windows', hidden: true, single: true, fixed: true, width: 480, height: 440,
    create(win) {
      win.body.innerHTML = `<div class="winver app-surface">
        <div class="winver-logo">${Win.appIcon('windows', 56)}<span>Windows 11</span></div>
        <hr>
        <p>Microsoft Windows<br>Version ${esc(Win.OS.version)} (OS Build ${esc(Win.OS.build)})<br>© Microsoft Corporation. All rights reserved.</p>
        <p>The Windows 11 Home operating system and its user interface are protected by trademark and other pending or existing intellectual property rights in the United States and other countries/regions.</p>
        <p>This product is licensed under the <button class="link" data-terms>Microsoft Software License Terms</button> to:<br>&nbsp;&nbsp;&nbsp;&nbsp;${esc(Win.state.account.name)}</p>
        <div class="winver-ok"><button class="btn accent" autofocus>OK</button></div></div>`;
      win.body.querySelector('.winver-ok button').addEventListener('click', () => win.close());
      win.body.querySelector('[data-terms]').addEventListener('click', () => Win.wm.open('edge', { url: 'support.example/license' }));
    },
  });

  /* -------------------------------------------------------- Control Panel */

  const CP = [
    ['System and Security', 'system-security', 'Review your computer\'s status', 'Back up your files with File History', 'security'],
    ['Network and Internet', 'network-internet', 'View network status and tasks', null, 'sharing'],
    ['Hardware and Sound', 'hardware-sound', 'View devices and printers', 'Add a device', 'bluetooth'],
    ['Programs', 'programs', 'Uninstall a program', null, 'installed-apps'],
    ['User Accounts', 'user-accounts', 'Change account type', null, 'your-info'],
    ['Appearance and Personalization', 'appearance', null, null, 'personalization'],
    ['Clock and Region', 'clock-region', 'Change date, time, or number formats', null, 'date-time'],
    ['Ease of Access', 'ease-of-access', 'Let Windows suggest settings', 'Optimize visual display', 'accessibility'],
  ];

  /* Real Control Panel artwork (assets/icons/cpl, provenance in assets/icons/sources.json):
     category icons from imageres.dll.mun, adapter layers from netshell.dll.mun and signal
     icons from netcenter.dll.mun, each the resource's 256px PNG frame. */
  const cplImg = (name, size, cls = '') => `<img class="${cls}" src="assets/icons/cpl/${name}.png" width="${size}" height="${size}" alt="" draggable="false">`;
  /** Network Connections composes each adapter icon from a base plus overlays, as netshell does. */
  const adapterIcon = (base, ...overlays) => `<span class="cp-ad-ico" aria-hidden="true">${[base, ...overlays].map(n => cplImg(n, 48)).join('')}</span>`;

  const CP_VIEWS = { home: ['Control Panel'], sharing: ['Control Panel', 'Network and Internet', 'Network and Sharing Center'], connections: ['Control Panel', 'Network and Internet', 'Network Connections'] };
  /* No separate category pages exist here, so the "Network and Internet" crumb opens Control Panel Home. */
  const CRUMB_VIEW = { 'Control Panel': 'home', 'Network and Internet': 'home', 'Network and Sharing Center': 'sharing', 'Network Connections': 'connections' };

  function cpRender(win) {
    const view = win.state.view;
    const crumbs = CP_VIEWS[view];
    win.setTitle(crumbs[crumbs.length - 1]);
    const net = Win.Network.current();
    const reason = Win.Network.reason();
    const adapterOn = Win.state.network.adapterEnabled.wifi;
    let content = '';
    if (view === 'home') {
      content = `<div class="cp-home"><h1>Adjust your computer's settings</h1><span class="cp-viewby">View by: <button class="link">Category ▾</button></span>
        <div class="cp-grid">${CP.map(([title, icon, a, b, target], i) => `<div class="cp-cat"><span class="cp-ico" aria-hidden="true">${cplImg(icon, 48)}</span><div>
          <button class="cp-title" data-cp="${i}">${esc(title)}</button>${a ? `<button class="cp-sub" data-cp="${i}">${esc(a)}</button>` : ''}${b ? `<button class="cp-sub" data-cp="${i}">${esc(b)}</button>` : ''}
          ${target === 'sharing' ? '<button class="cp-sub" data-view="connections">Change adapter settings</button>' : ''}</div></div>`).join('')}</div></div>`;
    } else if (view === 'sharing') {
      content = `<div class="cp-split"><aside><button class="cp-side" data-view="home">Control Panel Home</button><button class="cp-side" data-view="connections">Change adapter settings</button><button class="cp-side" data-settings="advanced-network">Change advanced sharing settings</button></aside>
        <section><h1>View your basic network information and set up connections</h1>
          <h2>View your active networks</h2>
          ${net ? `<div class="cp-active"><div><b>${esc(net.ssid)}</b><span>${esc(Win.Network.profile(net.ssid)?.profile || 'Private')} network</span></div>
            <dl><dt>Access type:</dt><dd>${reason ? 'No network access' : 'Internet'}</dd><dt>Connections:</dt><dd><button class="link" data-status>${cplImg(`signal-${Math.min(4, Math.max(1, net.signal))}`, 16)} Wi-Fi (${esc(net.ssid)})</button></dd></dl></div>`
            : '<p class="muted">You are currently not connected to any networks.</p>'}
          <h2>Change your networking settings</h2>
          <button class="cp-task" data-settings="wifi"><b>Set up a new connection or network</b><span>Set up a broadband, dial-up, or VPN connection; or set up a router or access point.</span></button>
          <button class="cp-task" data-diagnose><b>Troubleshoot problems</b><span>Diagnose and repair network problems, or get troubleshooting information.</span></button>
        </section></div>`;
    } else {
      content = `<div class="cp-conn-bar"><button class="tb-btn" data-adapter="toggle">${adapterOn ? 'Disable this network device' : 'Enable this network device'}</button><button class="tb-btn" data-diagnose>Diagnose this connection</button><button class="tb-btn" data-status ${!adapterOn ? 'disabled' : ''}>View status of this connection</button></div>
        <div class="cp-adapters">
          <button class="cp-adapter ${adapterOn ? '' : 'off'} sel" data-wifi-adapter>${!adapterOn ? adapterIcon('adapter-disabled', 'adapter-wifi-off') : net ? adapterIcon('adapter', 'adapter-wifi') : adapterIcon('adapter', 'adapter-wifi-off', 'adapter-x')}<span><b>Wi-Fi</b><span>${adapterOn ? (net ? esc(net.ssid) : 'Not connected') : 'Disabled'}</span><span>${esc(Win.Network.ADAPTER.description)}</span></span></button>
          <button class="cp-adapter">${adapterIcon('adapter', 'adapter-bluetooth', 'adapter-x')}<span><b>Bluetooth Network Connection</b><span>Not connected</span><span>Bluetooth Device (Personal Area Network)</span></span></button>
        </div>`;
    }
    win.body.innerHTML = `<div class="cp">
      <div class="cp-nav"><button class="icon-btn" data-back aria-label="Back" ${view === 'home' ? 'disabled' : ''}>${Win.glyph('back', 14)}</button><button class="icon-btn" data-up aria-label="Up" ${view === 'home' ? 'disabled' : ''}>${Win.glyph('up', 14)}</button>
        <div class="cp-addr">${Win.appIcon('controlpanel', 16)}<i>${Win.glyph('chevright', 10)}</i>
          <span class="cp-crumbs">${crumbs.map((c, i) => `<button class="cp-crumb" data-view="${CRUMB_VIEW[c] || view}" ${i === crumbs.length - 1 ? 'aria-current="page"' : ''}>${esc(c)}</button>`).join(`<i>${Win.glyph('chevright', 10)}</i>`)}</span>
          <button class="cp-addr-btn" data-addr-drop aria-label="Previous locations" title="Previous locations">${Win.glyph('chevdown', 12)}</button>
          <button class="cp-addr-btn cp-refresh" data-refresh aria-label="Refresh" title="Refresh &quot;${esc(crumbs[crumbs.length - 1])}&quot; (F5)">${Win.glyph('refresh', 14)}</button></div>
        <label class="cp-search">${Win.glyph('search', 14)}<input placeholder="Search Control Panel" aria-label="Search Control Panel"></label></div>
      <div class="cp-body app-surface">${content}</div></div>`;
  }

  Win.apps.register({
    id: 'controlpanel', name: 'Control Panel', icon: 'controlpanel', category: 'System', width: 900, height: 600, keywords: 'ncpa network connections adapter',
    create(win, args) {
      win.state.view = args.view || 'home';
      cpRender(win);
      win.listen('state', () => cpRender(win));
      const refresh = () => { cpRender(win); const body = win.body.querySelector('.cp-body'); body.classList.add('cp-flash'); setTimeout(() => body.classList.remove('cp-flash'), 120); };
      win.body.addEventListener('keydown', e => { if (e.key === 'F5') { e.preventDefault(); refresh(); } });
      win.body.addEventListener('click', e => {
        const t = e.target;
        if (t.closest('[data-refresh]')) { refresh(); return; }
        const drop = t.closest('[data-addr-drop]');
        if (drop) {
          const r = drop.closest('.cp-addr').getBoundingClientRect();
          Win.menu(r.left, r.bottom + 2, Object.entries(CP_VIEWS).map(([v, c]) => ({
            label: c[c.length - 1], action: () => { win.state.view = v; cpRender(win); } })));
          return;
        }
        const view = t.closest('[data-view]')?.dataset.view;
        if (view) { win.state.view = view; cpRender(win); return; }
        if (t.closest('[data-back], [data-up]')) { win.state.view = win.state.view === 'connections' ? 'sharing' : 'home'; cpRender(win); return; }
        const s = t.closest('[data-settings]')?.dataset.settings;
        if (s) { Win.wm.open('settings', { page: s }); return; }
        const cat = t.closest('[data-cp]');
        if (cat) {
          const target = CP[Number(cat.dataset.cp)][4];
          if (target === 'sharing') { win.state.view = 'sharing'; cpRender(win); } else Win.wm.open('settings', { page: target });
          return;
        }
        if (t.closest('[data-adapter]')) { Win.UAC('Network Connections', () => Win.Network.setAdapter(!Win.state.network.adapterEnabled.wifi)); return; }
        if (t.closest('[data-status]')) { adapterStatus(win); return; }
        if (t.closest('[data-diagnose]')) Win.troubleshoot(win);
      });
      win.body.addEventListener('dblclick', e => { if (e.target.closest('[data-wifi-adapter]')) Win.state.network.adapterEnabled.wifi ? adapterStatus(win) : Win.Network.setAdapter(true); });
      win.body.addEventListener('contextmenu', e => {
        if (!e.target.closest('[data-wifi-adapter]')) return;
        e.preventDefault();
        const on = Win.state.network.adapterEnabled.wifi;
        Win.menu(e.clientX, e.clientY, [
          { label: on ? 'Disable' : 'Enable', action: () => Win.UAC('Network Connections', () => Win.Network.setAdapter(!on)) },
          { label: Win.Network.current() ? 'Connect / Disconnect' : 'Connect / Disconnect', disabled: !on, action: () => Win.Flyout.open('quick', { page: 'wifi' }) },
          { label: 'Status', disabled: !on, action: () => adapterStatus(win) },
          { label: 'Diagnose', action: () => Win.troubleshoot(win) },
          { divider: true },
          { label: 'Properties', action: () => adapterProperties(win) },
        ]);
      });
    },
  });

  function adapterStatus(owner) {
    const net = Win.Network.current();
    const reason = Win.Network.reason();
    const c = Win.Network.config();
    Win.dialog({
      owner, title: 'Wi-Fi Status', width: 400,
      body: `<div class="classic"><fieldset><legend>Connection</legend><dl class="cl-dl">
          <dt>IPv4 Connectivity:</dt><dd>${!net ? 'No network access' : reason ? (reason === 'no-dns' || reason === 'no-internet' ? 'No Internet access' : 'No network access') : 'Internet'}</dd>
          <dt>IPv6 Connectivity:</dt><dd>No network access</dd><dt>Media State:</dt><dd>${net ? 'Enabled' : 'Media disconnected'}</dd>
          <dt>SSID:</dt><dd>${esc(net?.ssid || '')}</dd><dt>Duration:</dt><dd>${net ? '03:14:27' : ''}</dd><dt>Speed:</dt><dd>${net ? (net.band === '5 GHz' ? '1.2 Gbps' : '144.4 Mbps') : ''}</dd><dt>Signal Quality:</dt><dd>${net ? '▂▄▆█'.slice(0, net.signal) : ''}</dd></dl>
          <div class="cl-row"><button class="btn" data-details ${!net ? 'disabled' : ''}>Details…</button><button class="btn" data-wprops ${!net ? 'disabled' : ''}>Wireless Properties</button></div></fieldset>
        <fieldset><legend>Activity</legend><div class="cl-act"><span>Sent — ${net ? '48,211,904' : '0'}</span><span>${net ? '612,004,113' : '0'} — Received</span></div>
          <div class="cl-row"><button class="btn" data-props>Properties</button><button class="btn" data-disable>Disable</button><button class="btn" data-diag>Diagnose</button></div></fieldset></div>`,
      buttons: [{ label: 'Close', value: true, primary: true }],
      onRender(box, { close }) {
        box.addEventListener('click', e => {
          if (e.target.closest('[data-details]')) Win.dialog({ owner, title: 'Network Connection Details', width: 460, body: `<table class="cl-table"><tr><th>Property</th><th>Value</th></tr>${[
            ['Connection-specific DNS Suffix', c.suffix], ['Description', Win.Network.ADAPTER.description], ['Physical Address', Win.Network.mac()],
            ['DHCP Enabled', c.dhcp ? 'Yes' : 'No'], ['IPv4 Address', c.ip], ['IPv4 Subnet Mask', c.mask],
            ['Lease Obtained', c.dhcp ? new Date(c.leaseObtained).toLocaleString('en-US') : ''], ['Lease Expires', c.dhcp ? new Date(c.leaseObtained + 864e5).toLocaleString('en-US') : ''],
            ['IPv4 Default Gateway', c.gateway], ['IPv4 DHCP Server', c.dhcpServer], ['IPv4 DNS Servers', c.dns.join('\n')], ['NetBIOS over Tcpip Enabled', 'Yes'], ['Link-local IPv6 Address', c.ipv6],
          ].map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v || '').replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>` });
          if (e.target.closest('[data-props]')) adapterProperties(owner);
          if (e.target.closest('[data-wprops]')) Win.wm.open('settings', { page: 'wifi-props', ssid: net.ssid });
          if (e.target.closest('[data-disable]')) { close(true); Win.UAC('Network Connections', () => Win.Network.setAdapter(false)); }
          if (e.target.closest('[data-diag]')) { close(true); Win.troubleshoot(owner); }
        });
      },
    });
  }

  function adapterProperties(owner) {
    Win.UAC('Network Connections', () => Win.dialog({
      owner, title: 'Wi-Fi Properties', width: 420,
      body: `<div class="classic"><p>Connect using:</p><div class="cl-dev">${Win.glyph('wifi4', 16)} ${esc(Win.Network.ADAPTER.description)}</div>
        <p>This connection uses the following items:</p>
        <div class="cl-list">${['Client for Microsoft Networks', 'File and Printer Sharing for Microsoft Networks', 'QoS Packet Scheduler', 'Internet Protocol Version 4 (TCP/IPv4)', 'Microsoft Network Adapter Multiplexor Protocol', 'Microsoft LLDP Protocol Driver', 'Internet Protocol Version 6 (TCP/IPv6)', 'Link-Layer Topology Discovery Responder']
          .map((item, i) => `<label class="cl-item ${i === 3 ? 'sel' : ''}" data-item="${i}"><input type="checkbox" ${i === 4 ? '' : 'checked'}> ${esc(item)}</label>`).join('')}</div>
        <div class="cl-row"><button class="btn" disabled>Install…</button><button class="btn" disabled>Uninstall</button><button class="btn" data-ipv4>Properties</button></div>
        <fieldset><legend>Description</legend><p class="cl-desc">Transmission Control Protocol/Internet Protocol. The default wide area network protocol that provides communication across diverse interconnected networks.</p></fieldset></div>`,
      buttons: [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }],
      onRender(box) {
        box.addEventListener('click', e => {
          const item = e.target.closest('[data-item]');
          if (item) box.querySelectorAll('.cl-item').forEach(i => i.classList.toggle('sel', i === item));
          if (e.target.closest('[data-ipv4]') && box.querySelector('.cl-item.sel')?.dataset.item === '3') ipv4Dialog(owner);
        });
        box.addEventListener('dblclick', e => { if (e.target.closest('[data-item="3"]')) ipv4Dialog(owner); });
      },
    }));
  }

  /** Classic "Internet Protocol Version 4 (TCP/IPv4) Properties". */
  function ipv4Dialog(owner) {
    const ssid = Win.state.network.connected;
    const p = Win.Network.profile(ssid);
    if (!p) { Win.alert('Wi-Fi Properties', 'Connect to a network to change its IP settings.', owner); return; }
    const ipField = (name, value, disabled) => `<input class="input cl-ip" data-f="${name}" value="${esc(value || '')}" ${disabled ? 'disabled' : ''} spellcheck="false" aria-label="${name}">`;
    Win.dialog({
      owner, title: 'Internet Protocol Version 4 (TCP/IPv4) Properties', width: 440,
      body: `<div class="classic"><p class="cl-desc">You can get IP settings assigned automatically if your network supports this capability. Otherwise, you need to ask your network administrator for the appropriate IP settings.</p>
        <label class="check"><input type="radio" name="ipm" value="dhcp" ${p.ipMode !== 'manual' ? 'checked' : ''}> Obtain an IP address automatically</label>
        <fieldset><legend><label class="check"><input type="radio" name="ipm" value="manual" ${p.ipMode === 'manual' ? 'checked' : ''}> Use the following IP address:</label></legend>
          <div class="cl-grid"><span>IP address:</span>${ipField('ip', p.ip, p.ipMode !== 'manual')}<span>Subnet mask:</span>${ipField('mask', p.mask || '255.255.255.0', p.ipMode !== 'manual')}<span>Default gateway:</span>${ipField('gateway', p.gateway, p.ipMode !== 'manual')}</div></fieldset>
        <label class="check"><input type="radio" name="dnsm" value="auto" ${p.dnsMode !== 'manual' ? 'checked' : ''} ${p.ipMode === 'manual' ? 'disabled' : ''}> Obtain DNS server address automatically</label>
        <fieldset><legend><label class="check"><input type="radio" name="dnsm" value="manual" ${p.dnsMode === 'manual' || p.ipMode === 'manual' ? 'checked' : ''}> Use the following DNS server addresses:</label></legend>
          <div class="cl-grid"><span>Preferred DNS server:</span>${ipField('dns1', p.dns[0], p.dnsMode !== 'manual' && p.ipMode !== 'manual')}<span>Alternate DNS server:</span>${ipField('dns2', p.dns[1], p.dnsMode !== 'manual' && p.ipMode !== 'manual')}</div></fieldset>
        <label class="check"><input type="checkbox" checked> Validate settings upon exit</label></div>`,
      buttons: [
        { label: 'OK', primary: true, value: box => box, validate: box => {
          const v = f => box.querySelector(`[data-f="${f}"]`).value.trim();
          const ipMode = box.querySelector('[name=ipm]:checked').value;
          const dnsMode = ipMode === 'manual' ? 'manual' : box.querySelector('[name=dnsm]:checked').value;
          const problem = Win.Network.saveIP(ssid, { ipMode, ip: v('ip'), mask: v('mask'), gateway: v('gateway'), dnsMode, dns: dnsMode === 'manual' ? [v('dns1'), v('dns2')] : p.dns });
          return problem;
        } },
        { label: 'Cancel', value: null },
      ],
      onRender(box) {
        const sync = () => {
          const manual = box.querySelector('[name=ipm]:checked').value === 'manual';
          ['ip', 'mask', 'gateway'].forEach(f => { box.querySelector(`[data-f="${f}"]`).disabled = !manual; });
          const autoDns = box.querySelector('[name=dnsm][value=auto]');
          autoDns.disabled = manual;
          if (manual) box.querySelector('[name=dnsm][value=manual]').checked = true;
          const dnsManual = box.querySelector('[name=dnsm]:checked').value === 'manual';
          ['dns1', 'dns2'].forEach(f => { box.querySelector(`[data-f="${f}"]`).disabled = !dnsManual; });
        };
        box.addEventListener('change', sync);
      },
    }).then(done => {
      if (done && Win.Network.reason()) setTimeout(() => Win.troubleshoot(owner, { validating: true }), 200);
    });
  }

  /* ------------------------------------------------- network troubleshooter */

  const FIXES = {
    airplane: ['Airplane mode is turned on', 'Turn off Airplane mode', () => Win.Network.setAirplane(false)],
    'wifi-off': ['Wireless capability is turned off', 'Turn on Wi-Fi', () => Win.Network.setWifi(true)],
    'adapter-disabled': ['The Wi-Fi adapter is disabled', 'Enable the Wi-Fi adapter', () => Win.Network.setAdapter(true)],
    disconnected: ['There are no networks connected', 'Connect to a wireless network', () => Win.Flyout.open('quick', { page: 'wifi' })],
    'no-gateway': ['The default gateway is not available', 'Reset the IP configuration to obtain an address automatically', () => Win.Network.saveIP(Win.state.network.connected, { ipMode: 'dhcp' })],
    apipa: ['"Wi-Fi" doesn\'t have a valid IP configuration', 'Reset the IP configuration to obtain an address automatically', () => Win.Network.saveIP(Win.state.network.connected, { ipMode: 'dhcp' })],
    'no-dns': ['Your computer appears to be correctly configured, but the device or resource (DNS server) is not responding', 'Set DNS server assignment to automatic (DHCP)', () => Win.Network.saveIP(Win.state.network.connected, { dnsMode: 'auto' })],
    'no-internet': ['This network has no internet access', 'Connect to a different network', () => Win.Flyout.open('quick', { page: 'wifi' })],
    proxy: ['Windows couldn\'t automatically detect this network\'s proxy settings', 'Turn off the manual proxy server', () => { Win.state.network.proxy.manual = false; Win.state.network.proxy.useScript = false; Win.save('network'); }],
  };

  /** Windows Network Diagnostics: detect the shared reason, offer the repair. */
  Win.troubleshoot = async (owner = null, { validating = false } = {}) => {
    const box = await new Promise(resolve => {
      Win.dialog({
        owner, title: 'Windows Network Diagnostics', width: 480,
        body: '<div class="ts"><div class="ring"></div><p>Detecting problems</p><p class="muted">Identifying the problem…</p></div>',
        buttons: [{ label: 'Cancel', value: null }],
        onRender: (el, ctl) => resolve({ el, ctl }),
      });
    });
    await Win.wait(validating ? 1200 : 2200);
    if (!box.el.isConnected) return;
    const reason = Win.Network.webReason();
    const fix = FIXES[reason];
    const content = box.el.querySelector('.dlg-content');
    const actions = box.el.querySelector('.dlg-actions');
    if (!fix) {
      content.innerHTML = `<div class="ts"><span class="ts-ok">${Win.glyph('check', 28)}</span><p><b>Troubleshooting couldn't identify the problem</b></p><p class="muted">Your connection appears to be working. If you're still having trouble, try restarting your router.</p></div>`;
      actions.innerHTML = '<button class="btn accent" data-close>Close</button>';
    } else {
      content.innerHTML = `<div class="ts left"><p><b>Problems found</b></p><div class="ts-issue">${Win.glyph('warning', 18)}<span>${esc(fix[0])}</span><em>Detected</em></div>
        <p class="muted">Try this repair:</p><button class="cp-task ts-fix" data-fix><b>${esc(fix[1])}</b><span>Windows can try to fix this for you.</span></button></div>`;
      actions.innerHTML = '<button class="btn" data-close>Close</button>';
    }
    actions.addEventListener('click', e => { if (e.target.closest('[data-close]')) box.ctl.close(null); });
    content.querySelector('[data-fix]')?.addEventListener('click', async () => {
      content.innerHTML = '<div class="ts"><div class="ring"></div><p>Resolving problems</p></div>';
      await Win.wait(1500);
      fix[2]();
      await Win.wait(300);
      const fixed = !Win.Network.webReason() || Win.Network.webReason() !== reason;
      content.innerHTML = `<div class="ts"><span class="${fixed ? 'ts-ok' : 'ts-bad'}">${Win.glyph(fixed ? 'check' : 'error', 28)}</span><p><b>${fixed ? 'Troubleshooting has completed' : 'Problem not fixed'}</b></p><p class="muted">${esc(fix[0])}<br>${fixed ? 'Fixed' : 'Not fixed'}</p></div>`;
    });
  };

  /* -------------------------------------------------------- Microsoft Store */

  const STORE = [
    { id: 'spotify', name: 'Spotify - Music and Podcasts', pub: 'Spotify AB', cat: 'Music', rating: 4.6, color: '#1db954', letter: 'S', size: 288e6 },
    { id: 'whatsapp', name: 'WhatsApp', pub: 'WhatsApp Inc.', cat: 'Social', rating: 4.4, color: '#25d366', letter: 'W', size: 190e6 },
    { id: 'netflix', name: 'Netflix', pub: 'Netflix, Inc.', cat: 'Entertainment', rating: 4.3, color: '#e50914', letter: 'N', size: 96e6 },
    { id: 'vscode', name: 'Visual Studio Code', pub: 'Microsoft Corporation', cat: 'Developer tools', rating: 4.7, color: '#007acc', letter: '<>', size: 360e6 },
    { id: 'zoom', name: 'Zoom Workplace', pub: 'Zoom Communications, Inc.', cat: 'Productivity', rating: 4.2, color: '#2d8cff', letter: 'Z', size: 254e6 },
    { id: 'clipchamp', name: 'Microsoft Clipchamp', pub: 'Microsoft Corporation', cat: 'Photo & video', rating: 4.1, color: '#7c3aed', letter: 'C', size: 140e6 },
    { id: 'python', name: 'Python 3.13', pub: 'Python Software Foundation', cat: 'Developer tools', rating: 4.5, color: '#3776ab', letter: 'Py', size: 110e6 },
    { id: 'hpsmart', name: 'HP Smart', pub: 'HP Inc.', cat: 'Utilities & tools', rating: 4.0, color: '#0096d6', letter: 'hp', size: 96e6 },
    { id: 'discord', name: 'Discord', pub: 'Discord Inc.', cat: 'Social', rating: 4.5, color: '#5865f2', letter: 'D', size: 210e6 },
    { id: 'vlc', name: 'VLC', pub: 'VideoLAN', cat: 'Entertainment', rating: 4.4, color: '#f48b00', letter: '▶', size: 170e6 },
  ];

  const storeTile = a => `<span class="store-ico" style="background:${a.color}">${esc(a.letter)}</span>`;

  function storeRender(win) {
    const installed = new Set(Win.state.apps.map(a => a.id));
    const page = win.state.page;
    const online = Win.Network.online();
    const app = STORE.find(a => a.id === win.state.detail);
    let body;
    if (!online) {
      body = `<div class="store-off">${Win.glyph('globeoff', 48)}<h2>No internet connection</h2><p class="muted">Check your connection and try again.</p><button class="btn accent" data-store="retry">Refresh page</button><button class="link" data-store="troubleshoot">Network troubleshooter</button></div>`;
    } else if (app) {
      const state = win.state.installing[app.id];
      body = `<div class="store-detail"><button class="btn subtle" data-store="back">${Win.glyph('back', 14)} Back</button>
        <div class="store-hero">${storeTile(app)}<div><h1>${esc(app.name)}</h1><p class="muted">${esc(app.pub)}</p><p>★ ${app.rating} · ${esc(app.cat)} · Free</p>
          ${installed.has(app.id) ? '<button class="btn" disabled>Installed</button>' : state != null ? `<div class="store-prog"><div class="progress"><i style="width:${state}%"></i></div><span>${state < 100 ? `Downloading… ${state}%` : 'Installing…'}</span></div>` : `<button class="btn accent" data-get="${app.id}">Get</button>`}</div></div>
        <h2>Description</h2><p>${esc(app.name)} for Windows. Download size ${Win.bytes(app.size)}. Requires Windows 10 version 19041.0 or higher.</p></div>`;
    } else if (page === 'library') {
      body = `<div class="store-lib"><h1>Library</h1><div class="store-lib-bar"><span>Updates & downloads</span><button class="btn accent" data-store="updates">${win.state.checking ? 'Checking…' : 'Get updates'}</button></div>
        ${win.state.checked ? '<div class="infobar success">' + Win.glyph('check', 16) + '<span>You\'re up to date. Last checked just now.</span></div>' : ''}
        <div class="store-list">${Win.state.apps.map(a => `<div class="store-row">${storeTile(STORE.find(s => s.id === a.id) || { color: '#5d6475', letter: a.name[0] })}<span><b>${esc(a.name)}</b><small>${esc(a.publisher)}</small></span><small>Modified ${esc(new Date(a.date).toLocaleDateString('en-US'))}</small></div>`).join('')}</div></div>`;
    } else {
      const list = page === 'apps' ? STORE : STORE.slice(0, 8);
      body = `<div class="store-home"><div class="store-banner"><div><small>Featured</small><h1>Make the most of your PC</h1><p>Top apps picked for Windows 11.</p></div></div>
        <h2>Top free apps</h2><div class="store-grid">${list.map(a => `<button class="store-card" data-detail="${a.id}">${storeTile(a)}<b>${esc(a.name)}</b><small>${esc(a.cat)}</small><span>★ ${a.rating} · ${installed.has(a.id) ? 'Installed' : 'Free'}</span></button>`).join('')}</div></div>`;
    }
    win.body.innerHTML = `<div class="store"><nav class="store-nav">${[['home', 'home', 'Home'], ['apps', 'apps', 'Apps'], ['games', 'game', 'Gaming'], ['library', 'collection', 'Library']].map(([id, g, l]) => `<button class="${page === id && !app ? 'on' : ''}" data-page="${id}">${Win.glyph(g, 20)}<span>${l}</span></button>`).join('')}</nav>
      <div class="store-main">${body}</div></div>`;
  }

  Win.apps.register({
    id: 'store', name: 'Microsoft Store', icon: 'store', single: true, category: 'Utilities & tools', width: 1000, height: 660,
    customTitle: true,
    create(win) {
      win.titleContent.innerHTML = `<span class="win-ico" style="padding-left:16px">${Win.appIcon('store', 16)}</span><span class="win-title">Microsoft Store</span><label class="store-search" data-nodrag>${Win.glyph('search', 14)}<input placeholder="Search apps, games, movies, and more" aria-label="Search the Store"></label><span class="avatar" style="width:28px;height:28px;font-size:11px;margin:0 8px 0 auto">${esc(Win.PERSONA.initials)}</span>`;
      Object.assign(win.state, { page: 'home', detail: null, installing: {}, checked: false });
      storeRender(win);
      win.listen('network', () => storeRender(win));
      win.titleContent.querySelector('input').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        const q = e.target.value.toLowerCase();
        const hit = STORE.find(a => a.name.toLowerCase().includes(q));
        win.state.detail = hit?.id || null;
        win.state.page = 'apps';
        storeRender(win);
      });
      win.body.addEventListener('click', async e => {
        const t = e.target;
        const p = t.closest('[data-page]');
        if (p) { win.state.page = p.dataset.page === 'games' ? 'apps' : p.dataset.page; win.state.detail = null; storeRender(win); return; }
        const d = t.closest('[data-detail]');
        if (d) { win.state.detail = d.dataset.detail; storeRender(win); return; }
        const act = t.closest('[data-store]')?.dataset.store;
        if (act === 'back') { win.state.detail = null; storeRender(win); }
        if (act === 'retry') storeRender(win);
        if (act === 'troubleshoot') Win.troubleshoot(win);
        if (act === 'updates') {
          win.state.checking = true; storeRender(win);
          await Win.wait(1800);
          win.state.checking = false; win.state.checked = true; storeRender(win);
        }
        const get = t.closest('[data-get]')?.dataset.get;
        if (get) {
          const app = STORE.find(a => a.id === get);
          for (let pct = 0; pct <= 100; pct += 7 + Math.round(Math.random() * 9)) {
            if (!Win.Network.online()) { delete win.state.installing[get]; storeRender(win); Win.toast({ app: 'Microsoft Store', icon: 'store', title: 'Download failed', body: `${app.name} couldn't download. Check your connection.` }); return; }
            win.state.installing[get] = pct; if (!win.closed) storeRender(win);
            await Win.wait(220);
          }
          win.state.installing[get] = 100; if (!win.closed) storeRender(win);
          await Win.wait(900);
          delete win.state.installing[get];
          if (!Win.state.apps.find(a => a.id === get)) Win.state.apps.push({ id: get, name: app.name, publisher: app.pub, size: app.size, version: '1.0.0', date: Date.now() });
          Win.save();
          if (!win.closed) storeRender(win);
          Win.toast({ app: 'Microsoft Store', icon: 'store', title: `${app.name} is installed`, body: 'Find it in Settings > Apps > Installed apps.' });
        }
      });
    },
  });

  /* --------------------------------------------------------------- Outlook */

  const DAY = 864e5;
  Win.DefaultState.mail = {
    folders: { inbox: 'Inbox', drafts: 'Drafts', sent: 'Sent Items', outbox: 'Outbox', deleted: 'Deleted Items', junk: 'Junk Email' },
    messages: [
      { id: 'm1', folder: 'inbox', from: 'Priya Natarajan', addr: 'priya@support.example', subject: 'Notes from Thursday', time: Date.now() - 2 * 3600e3, unread: true, body: 'Hi Isaiah,\n\nAttached are the notes from Thursday. The launch moved to the 14th, and Marcus owns the vendor contract.\n\nCan you confirm the Monday sync still works for you?\n\nThanks,\nPriya' },
      { id: 'm2', folder: 'inbox', from: 'Sam Souf', addr: 'sam.souf@outlook.example', subject: 'Photos from the lake', time: Date.now() - 6 * 3600e3, unread: true, body: 'Hey! I zipped up the photos from the weekend and sent them over. The sunset ones came out great.\n\n— Sam' },
      { id: 'm3', folder: 'inbox', from: 'Sablewave Internet', addr: 'billing@sablewave.example', subject: 'Your October statement is ready', time: Date.now() - DAY, body: 'Your statement for October is now available. Amount due: $64.99 on November 12.\n\nTip: if your Wi-Fi drops often, restarting your gateway fixes most problems.' },
      { id: 'm4', folder: 'inbox', from: 'Microsoft account team', addr: 'account@accountprotection.example', subject: 'New sign-in to your account', time: Date.now() - 3 * DAY, body: 'We noticed a new sign-in to your Microsoft account.\n\nDevice: ISAIAH-LAPTOP\nLocation: Orlando, FL\n\nIf this was you, you can ignore this message.' },
      { id: 'm5', folder: 'sent', from: 'Isaiah Souf', addr: 'isaiah.souf@outlook.example', to: 'priya@support.example', subject: 'Re: Vendor contract', time: Date.now() - 2 * DAY, body: 'Sounds good — I\'ll loop Marcus in.\n\nIsaiah' },
    ],
  };

  function mailRender(win) {
    const M = Win.state.mail;
    const folder = win.state.folder;
    const list = M.messages.filter(m => m.folder === folder).sort((a, b) => b.time - a.time);
    const sel = M.messages.find(m => m.id === win.state.sel) || null;
    const offline = !Win.Network.online();
    const count = f => M.messages.filter(m => m.folder === f && m.unread).length || (f === 'outbox' ? M.messages.filter(m => m.folder === 'outbox').length : 0);
    win.body.innerHTML = `<div class="mail">
      <aside class="mail-folders"><button class="btn accent mail-new" data-mail="new">${Win.glyph('edit', 14)} New mail</button>
        <div class="mail-acct">${esc(Win.state.account.email)}</div>
        ${Object.entries(M.folders).map(([id, name]) => `<button class="mail-f ${folder === id ? 'on' : ''}" data-folder="${id}"><span>${esc(name)}</span>${count(id) ? `<b>${count(id)}</b>` : ''}</button>`).join('')}</aside>
      <section class="mail-list">${offline ? `<div class="infobar warning">${Win.glyph('warning', 16)}<span>You're offline. Messages will send when you reconnect.</span></div>` : ''}
        <h2>${esc(M.folders[folder])}</h2>
        ${list.length ? list.map(m => `<button class="mail-item ${m.unread ? 'unread' : ''} ${sel?.id === m.id ? 'sel' : ''}" data-msg="${m.id}">
          <span class="avatar" style="width:32px;height:32px;font-size:12px">${esc((folder === 'sent' || folder === 'outbox' ? m.to || '' : m.from).slice(0, 1).toUpperCase())}</span>
          <span class="mail-meta"><b>${esc(folder === 'sent' || folder === 'outbox' ? m.to : m.from)}</b><span>${esc(m.subject)}</span><small>${esc(m.body.split('\n')[0])}</small></span>
          <small class="mail-time">${esc(new Date(m.time).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }))}</small></button>`).join('') : '<p class="mail-empty">Nothing in this folder</p>'}</section>
      <section class="mail-read">${win.state.compose ? composeForm(win.state.compose)
        : sel ? `<div class="mail-tools"><button class="tb-btn" data-mail="reply">${Win.glyph('back', 14)} Reply</button><button class="tb-btn" data-mail="delete">${Win.glyph('trash', 14)} Delete</button></div>
          <h1>${esc(sel.subject)}</h1><div class="mail-from"><span class="avatar" style="width:40px;height:40px;font-size:15px">${esc(sel.from.slice(0, 1))}</span><div><b>${esc(sel.from)}</b> &lt;${esc(sel.addr)}&gt;<br><small>${esc(new Date(sel.time).toLocaleString('en-US'))}${sel.to ? ` · To: ${esc(sel.to)}` : ''}</small></div></div>
          <div class="mail-body">${esc(sel.body).replace(/\n/g, '<br>')}</div>`
        : `<div class="mail-none">${Win.appIcon('mail', 64)}<p>Select an item to read</p></div>`}</section></div>`;
  }

  const composeForm = c => `<form class="mail-compose"><div class="mail-tools"><button class="btn accent" type="submit">${Win.glyph('forward', 14)} Send</button><button class="btn" type="button" data-mail="discard">Discard</button></div>
    <label><span>To</span><input class="input" name="to" value="${esc(c.to || '')}" spellcheck="false"></label>
    <label><span>Subject</span><input class="input" name="subject" value="${esc(c.subject || '')}"></label>
    <textarea class="input" name="body" rows="12" placeholder="Type / to insert files and more">${esc(c.body || '')}</textarea></form>`;

  Win.apps.register({
    id: 'mail', name: 'Outlook', icon: 'mail', single: true, category: 'Productivity', width: 1080, height: 680, keywords: 'email mail outlook',
    create(win) {
      Object.assign(win.state, { folder: 'inbox', sel: null, compose: null });
      mailRender(win);
      win.listen('network', () => {
        if (Win.Network.online()) {
          const queued = Win.state.mail.messages.filter(m => m.folder === 'outbox');
          queued.forEach(m => { m.folder = 'sent'; });
          if (queued.length) { Win.save(); Win.toast({ app: 'Outlook', icon: 'mail', title: `${queued.length} message${queued.length > 1 ? 's' : ''} sent`, body: 'Your Outbox is empty.' }); }
        }
        mailRender(win);
      });
      win.body.addEventListener('click', e => {
        const t = e.target;
        const f = t.closest('[data-folder]');
        if (f) { win.state.folder = f.dataset.folder; win.state.sel = null; win.state.compose = null; mailRender(win); return; }
        const m = t.closest('[data-msg]');
        if (m) {
          const msg = Win.state.mail.messages.find(x => x.id === m.dataset.msg);
          msg.unread = false; win.state.sel = msg.id; win.state.compose = null; Win.save(); mailRender(win); return;
        }
        const act = t.closest('[data-mail]')?.dataset.mail;
        const sel = Win.state.mail.messages.find(x => x.id === win.state.sel);
        if (act === 'new') { win.state.compose = {}; mailRender(win); win.body.querySelector('[name=to]').focus(); }
        if (act === 'discard') { win.state.compose = null; mailRender(win); }
        if (act === 'reply' && sel) { win.state.compose = { to: sel.addr, subject: `RE: ${sel.subject}`, body: `\n\n________________________________\nFrom: ${sel.from}\n\n${sel.body}` }; mailRender(win); }
        if (act === 'delete' && sel) { sel.folder = sel.folder === 'deleted' ? '__gone' : 'deleted'; Win.state.mail.messages = Win.state.mail.messages.filter(x => x.folder !== '__gone'); win.state.sel = null; Win.save(); mailRender(win); }
      });
      win.body.addEventListener('submit', e => {
        e.preventDefault();
        const data = new FormData(e.target);
        const to = String(data.get('to')).trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { Win.alert('Outlook', 'Check the address in the To line.', win); return; }
        const online = Win.Network.online();
        Win.state.mail.messages.push({ id: Win.uid('m'), folder: online ? 'sent' : 'outbox', from: Win.state.account.name, addr: Win.state.account.email, to, subject: String(data.get('subject')) || '(No subject)', body: String(data.get('body')), time: Date.now() });
        win.state.compose = null;
        Win.save();
        mailRender(win);
        if (!online) Win.toast({ app: 'Outlook', icon: 'mail', title: 'Saved to Outbox', body: 'You\'re offline. It will send when you reconnect.', transient: true });
      });
    },
  });

  /* --------------------------------------------------------------- Weather */

  Win.apps.register({
    id: 'weather', name: 'Weather', icon: 'weather', single: true, category: 'Utilities & tools', width: 980, height: 640,
    create(win) {
      const render = () => {
        const days = ['Today', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const hi = [72, 75, 77, 74, 70, 69, 73, 76, 78, 75];
        const icons = ['sun', 'sun', 'cloud', 'cloud', 'sun', 'sun', 'cloud', 'sun', 'sun', 'cloud'];
        const offline = !Win.Network.online();
        win.body.innerHTML = `<div class="wx">${offline ? `<div class="infobar warning">${Win.glyph('warning', 16)}<span>Couldn't refresh. Showing weather from ${esc(Win.formatTime(new Date(Date.now() - 3600e3)))}.</span></div>` : ''}
          <div class="wx-hero"><div><p class="wx-loc">Orlando, Florida ${Win.glyph('location', 14)}</p><div class="wx-now">${Win.appIcon('weather', 88)}<b>68°</b><span>°F</span></div><p class="wx-cond">Mostly sunny</p><p class="muted">Updated as of ${esc(Win.formatTime())} · Feels like 70°</p></div>
            <dl class="wx-stats"><dt>Wind</dt><dd>7 mph</dd><dt>Humidity</dt><dd>54%</dd><dt>Visibility</dt><dd>10 mi</dd><dt>Pressure</dt><dd>30.04 in</dd><dt>UV index</dt><dd>5 Moderate</dd><dt>Dew point</dt><dd>51°</dd></dl></div>
          <h2>10-day forecast</h2><div class="wx-days">${days.map((d, i) => `<div class="wx-day ${i === 0 ? 'on' : ''}"><b>${d}</b>${Win.glyph(icons[i], 28)}<span>${hi[i]}°</span><small>${hi[i] - 14}°</small></div>`).join('')}</div>
          <h2>Hourly</h2><div class="wx-hours">${Array.from({ length: 12 }, (_, i) => { const h = new Date(Date.now() + i * 3600e3); return `<div><small>${esc(h.toLocaleTimeString('en-US', { hour: 'numeric' }))}</small>${Win.glyph(i > 6 ? 'moon' : 'sun', 20)}<b>${68 + Math.round(Math.sin(i / 3) * 4)}°</b></div>`; }).join('')}</div></div>`;
      };
      render();
      win.listen('network', render);
    },
  });

  /* --------------------------------------------------------------- Copilot */

  const ANSWERS = [
    [/wi-?fi|internet|network|offline|connect/i, 'If you can\'t get online, open Quick Settings (Win + A) and check that Wi-Fi is on and connected. Then go to Settings > Network & internet to see the status. If a site won\'t load but others do, check your DNS and proxy settings.', [['Open Network & internet', 'network'], ['Run network troubleshooter', '!troubleshoot']]],
    [/dark|light mode|theme/i, 'To switch to dark mode, go to Settings > Personalization > Colors and set "Choose your mode" to Dark.', [['Open Colors', 'colors']]],
    [/screenshot|snip|capture/i, 'Press Print Screen, or open Snipping Tool and select New. Screenshots are saved to Pictures > Screenshots.', [['Open Snipping Tool', '@snip']]],
    [/update/i, 'Go to Settings > Windows Update and select Check for updates. Some updates need a restart to finish installing.', [['Open Windows Update', 'update']]],
    [/bluetooth|headphone|mouse|pair/i, 'To pair a device, turn on Bluetooth in Quick Settings, then go to Settings > Bluetooth & devices > Add device.', [['Open Bluetooth & devices', 'bluetooth']]],
    [/storage|space|disk|full/i, 'See what\'s using space in Settings > System > Storage. Emptying the Recycle Bin and running cleanup recommendations frees space quickly.', [['Open Storage', 'storage']]],
    [/background|wallpaper/i, 'Change your background in Settings > Personalization > Background. You can also right-click a photo in Photos and choose Set as > Background.', [['Open Background', 'background']]],
    [/pin|password|sign.?in/i, 'Change your PIN in Settings > Accounts > Sign-in options > PIN (Windows Hello) > Change PIN.', [['Open Sign-in options', 'sign-in']]],
    [/printer|print/i, 'Printers are under Settings > Bluetooth & devices > Printers & scanners.', [['Open Printers & scanners', 'printers']]],
  ];

  Win.apps.register({
    id: 'copilot', name: 'Copilot', icon: 'copilot', single: true, category: 'Productivity', width: 760, height: 640,
    create(win) {
      win.state.chat = [];
      const render = () => {
        win.body.innerHTML = `<div class="cop">${win.state.chat.length ? `<div class="cop-log">${win.state.chat.map(m => `<div class="cop-msg ${m.me ? 'me' : ''}">${esc(m.text)}${m.links ? `<div class="cop-links">${m.links.map(([l, p]) => `<button class="btn sm" data-go="${esc(p)}">${esc(l)}</button>`).join('')}</div>` : ''}</div>`).join('')}</div>`
          : `<div class="cop-hello">${Win.appIcon('copilot', 56)}<h1>Hey ${esc(Win.PERSONA.first)}, what's on your mind today?</h1><div class="cop-chips">${['My Wi-Fi isn\'t working', 'Turn on dark mode', 'How do I take a screenshot?', 'Free up storage'].map(q => `<button class="btn" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`}
          <form class="cop-input"><input class="input" placeholder="Message Copilot" aria-label="Message Copilot" autofocus><button class="icon-btn" aria-label="Send">${Win.glyph('forward', 16)}</button></form></div>`;
        const log = win.body.querySelector('.cop-log');
        if (log) log.scrollTop = log.scrollHeight;
        win.body.querySelector('input').focus();
      };
      const ask = text => {
        if (!text.trim()) return;
        win.state.chat.push({ me: true, text });
        if (!Win.Network.online()) win.state.chat.push({ text: 'It looks like you\'re offline. Connect to the internet to keep chatting, or check your connection in Settings.', links: [['Open Network & internet', 'network']] });
        else {
          const hit = ANSWERS.find(([re]) => re.test(text));
          win.state.chat.push(hit ? { text: hit[1], links: hit[2] } : { text: 'I can help with Windows settings and features — try asking about Wi-Fi, updates, storage, Bluetooth, or personalization.' });
        }
        render();
      };
      render();
      win.body.addEventListener('submit', e => { e.preventDefault(); ask(e.target.querySelector('input').value); });
      win.body.addEventListener('click', e => {
        const q = e.target.closest('[data-ask]');
        if (q) ask(q.dataset.ask);
        const go = e.target.closest('[data-go]')?.dataset.go;
        if (!go) return;
        if (go === '!troubleshoot') Win.troubleshoot(win);
        else if (go.startsWith('@')) Win.wm.open(go.slice(1));
        else Win.wm.open('settings', { page: go });
      });
    },
  });

  /* --------------------------------------------------------- Snipping Tool */

  function takeScreenshot() {
    const flash = Win.html('<div class="snip-flash"></div>');
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 400);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const name = `Screenshot ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
    const node = Win.FS.create('screenshots', name, 'file', { art: 'screenshot', size: 480000 + Math.round(Math.random() * 300000) });
    Win.FS.touch(node.id);
    Win.toast({ app: 'Snipping Tool', icon: 'snip', title: 'Screenshot copied to clipboard', body: 'Automatically saved to the Screenshots folder.', action: () => Win.wm.open('photos', { fileId: node.id }) });
    return node;
  }
  Win.screenshot = takeScreenshot;

  Win.apps.register({
    id: 'snip', name: 'Snipping Tool', icon: 'snip', category: 'Utilities & tools', width: 520, height: 200, minHeight: 160, keywords: 'screenshot capture print screen',
    create(win) {
      win.body.innerHTML = `<div class="snip"><div class="app-toolbar"><button class="btn accent" data-snip="new">${Win.glyph('plus', 14)} New</button>
        <span class="sep"></span><button class="tb-btn" aria-pressed="true">${Win.glyph('camera', 16)}</button><button class="tb-btn">${Win.glyph('video', 16)}</button>
        <span class="sep"></span>${Win.select(['Rectangle', 'Window', 'Full screen', 'Freeform'], 'Rectangle', 'aria-label="Snipping mode"')}${Win.select(['No delay', '3 seconds', '5 seconds', '10 seconds'], 'No delay', 'aria-label="Delay" data-delay')}</div>
        <p class="snip-hint">Press <kbd>Print Screen</kbd> or select New to start a snip.</p></div>`;
      win.body.addEventListener('click', async e => {
        if (!e.target.closest('[data-snip="new"]')) return;
        const delay = parseInt(win.body.querySelector('[data-delay]').value, 10) || 0;
        Win.wm.minimize(win);
        await Win.wait(300 + delay * 1000);
        const node = takeScreenshot();
        Win.wm.open('photos', { fileId: node.id });
      });
    },
  });

  document.addEventListener('keyup', e => { if (e.key === 'PrintScreen' && Win.state?.session?.signedIn) takeScreenshot(); });
})(window.Win);
