/* ===========================================================================
   Task Manager (Windows 11 24H2 design) and the shared process model.

   Win.Processes lists what is "running": one process per open app, the shell
   tabs inside Terminal, startup apps and a fixed set of Windows background
   and system processes. tasklist/taskkill in the terminal read the same list.
   Usage figures drift around per-process baselines while Task Manager is
   open; they are not measurements of the host machine.
   =========================================================================== */

(function (Win) {
  'use strict';

  Win.DefaultState.taskmgr = {
    startPage: 'processes',
    speed: 'normal',          // 'high' | 'normal' | 'low' | 'paused'
    navOpen: true,
    onTop: false,
    minimizeOnUse: false,
    fullName: false,
    extraStartup: { security: true, realtek: true },
  };

  const P = Win.PERSONA;
  const LOADED = Date.now();
  const rand = (a, b) => a + Math.random() * (b - a);
  const hash = value => [...String(value)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  /* -------------------------------------------------------------- fixtures */

  const APP_EXE = {
    edge: ['msedge.exe', 1.4, 460], terminal: ['WindowsTerminal.exe', 0.3, 72], explorer: ['explorer.exe', 0.4, 118], notepad: ['Notepad.exe', 0.1, 41],
    calculator: ['CalculatorApp.exe', 0, 34], clock: ['Time.exe', 0.1, 31], settings: ['SystemSettings.exe', 0.2, 76], taskmgr: ['Taskmgr.exe', 1.1, 52],
    photos: ['Photos.exe', 0.3, 146], paint: ['mspaint.exe', 0.2, 92], store: ['WinStore.App.exe', 0.2, 124], snip: ['SnippingTool.exe', 0.1, 58],
    winver: ['winver.exe', 0, 6], mail: ['olk.exe', 0.4, 210], weather: ['Microsoft.Msn.Weather.exe', 0.1, 64], copilot: ['ms-copilot.exe', 0.3, 160],
    controlpanel: ['control.exe', 0, 22], run: ['rundll32.exe', 0, 8],
  };

  const STARTUP_PROC = {
    onedrive: ['Microsoft OneDrive', 'OneDrive.exe', 0.1, 64, 'Microsoft Corporation'],
    teams: ['Microsoft Teams', 'ms-teams.exe', 0.3, 188, 'Microsoft Corporation'],
    spotify: ['Spotify', 'Spotify.exe', 0.2, 142, 'Spotify AB'],
    hpsmart: ['HP Smart', 'HPSmart.exe', 0, 28, 'HP Inc.'],
    zoom: ['Zoom Workplace', 'Zoom.exe', 0.2, 96, 'Zoom Communications, Inc.'],
    steam: ['Steam', 'steam.exe', 0.1, 74, 'Valve Corporation'],
  };

  /* [display name, image, group, cpu, memMB, pid, user, critical, description, services] */
  const SYSTEM = [
    ['System', 'System', 'windows', 0.2, 0.1, 4, 'SYSTEM', true, 'NT Kernel & System'],
    ['System interrupts', 'Interrupts', 'windows', 0.3, 0, -1, 'SYSTEM', true, 'Deferred procedure calls and interrupt service routines'],
    ['Registry', 'Registry', 'windows', 0, 22.4, 152, 'SYSTEM', true, 'NT Kernel & System'],
    ['Memory Compression', 'Memory Compression', 'windows', 0, 512, 3140, 'SYSTEM', true, 'Memory Compression'],
    ['Windows Session Manager', 'smss.exe', 'windows', 0, 0.3, 612, 'SYSTEM', true, 'Windows Session Manager'],
    ['Client Server Runtime Process', 'csrss.exe', 'windows', 0, 1.1, 932, 'SYSTEM', true, 'Client Server Runtime Process'],
    ['Client Server Runtime Process', 'csrss.exe', 'windows', 0.1, 1.6, 1028, 'SYSTEM', true, 'Client Server Runtime Process'],
    ['Windows Start-Up Application', 'wininit.exe', 'windows', 0, 0.9, 1020, 'SYSTEM', true, 'Windows Start-Up Application'],
    ['Services and Controller app', 'services.exe', 'windows', 0, 4.6, 1132, 'SYSTEM', true, 'Services and Controller app'],
    ['Local Security Authority Process (3)', 'lsass.exe', 'windows', 0, 7.8, 1152, 'SYSTEM', true, 'Local Security Authority Process', 'KeyIso, SamSs, VaultSvc'],
    ['Windows Logon Application', 'winlogon.exe', 'windows', 0, 2.2, 1236, 'SYSTEM', true, 'Windows Logon Application'],
    ['Desktop Window Manager', 'dwm.exe', 'windows', 1.2, 96.4, 1408, 'DWM-1', true, 'Desktop Window Manager'],
    ['Service Host: DCOM Server Process Launcher (6)', 'svchost.exe', 'windows', 0, 12.3, 1296, 'SYSTEM', true, 'Host Process for Windows Services', 'BrokerInfrastructure, DcomLaunch, PlugPlay, Power, SystemEventsBroker'],
    ['Service Host: Remote Procedure Call (2)', 'svchost.exe', 'windows', 0, 8.8, 1380, 'NETWORK SERVICE', true, 'Host Process for Windows Services', 'RpcEptMapper, RpcSs'],
    ['Service Host: WLAN AutoConfig', 'svchost.exe', 'windows', 0, 3.1, 2864, 'SYSTEM', false, 'Host Process for Windows Services', 'WlanSvc'],
    ['Service Host: DNS Client', 'svchost.exe', 'windows', 0, 2.4, 2216, 'NETWORK SERVICE', false, 'Host Process for Windows Services', 'Dnscache'],
    ['Service Host: DHCP Client', 'svchost.exe', 'windows', 0, 1.9, 1988, 'LOCAL SERVICE', false, 'Host Process for Windows Services', 'Dhcp'],
    ['Service Host: Network List Service', 'svchost.exe', 'windows', 0, 3.6, 2440, 'LOCAL SERVICE', false, 'Host Process for Windows Services', 'netprofm'],
    ['Service Host: Windows Event Log', 'svchost.exe', 'windows', 0, 6.2, 1708, 'LOCAL SERVICE', false, 'Host Process for Windows Services', 'EventLog'],
    ['Service Host: Windows Audio', 'svchost.exe', 'windows', 0.1, 6.9, 2624, 'LOCAL SERVICE', false, 'Host Process for Windows Services', 'Audiosrv'],
    ['Service Host: Windows Update', 'svchost.exe', 'windows', 0, 9.4, 7344, 'SYSTEM', false, 'Host Process for Windows Services', 'wuauserv'],
    ['Spooler SubSystem App', 'spoolsv.exe', 'windows', 0, 5.2, 3488, 'SYSTEM', false, 'Spooler SubSystem App', 'Spooler'],
    ['Antimalware Service Executable', 'MsMpEng.exe', 'background', 0.4, 214, 4012, 'SYSTEM', true, 'Antimalware Service Executable', 'WinDefend'],
    ['Shell Infrastructure Host', 'sihost.exe', 'windows', 0, 22.7, 5120, P.user, false, 'Shell Infrastructure Host'],
    ['Runtime Broker', 'RuntimeBroker.exe', 'background', 0, 9.7, 6732, P.user, false, 'Runtime Broker'],
    ['Runtime Broker', 'RuntimeBroker.exe', 'background', 0, 4.4, 9016, P.user, false, 'Runtime Broker'],
    ['Search', 'SearchHost.exe', 'background', 0, 88.1, 7408, P.user, false, 'Search application'],
    ['Start', 'StartMenuExperienceHost.exe', 'background', 0, 46.3, 7520, P.user, false, 'Windows Start Experience Host'],
    ['Widgets', 'Widgets.exe', 'background', 0, 31.2, 10984, P.user, false, 'Widgets'],
    ['Microsoft Edge WebView2', 'msedgewebview2.exe', 'background', 0.1, 58.6, 11236, P.user, false, 'Microsoft Edge WebView2'],
    ['Phone Link', 'PhoneExperienceHost.exe', 'background', 0, 42.5, 12044, P.user, false, 'Microsoft Phone Link'],
    ['Windows Security notification icon', 'SecurityHealthSystray.exe', 'background', 0, 1.4, 9876, P.user, false, 'Windows Security notification icon'],
    ['Realtek Audio Universal Service', 'RtkAudUService64.exe', 'background', 0, 2.6, 4380, 'SYSTEM', false, 'Realtek HD Audio Universal Service'],
    ['Microsoft Windows Search Indexer', 'SearchIndexer.exe', 'background', 0.1, 24.9, 5992, 'SYSTEM', false, 'Microsoft Windows Search Indexer', 'WSearch'],
    ['COM Surrogate', 'dllhost.exe', 'background', 0, 3.3, 8840, P.user, false, 'COM Surrogate'],
    ['CTF Loader', 'ctfmon.exe', 'background', 0, 6.1, 6212, P.user, false, 'CTF Loader'],
    ['Microsoft Text Input Application', 'TextInputHost.exe', 'background', 0, 18.4, 10120, P.user, false, 'Microsoft Text Input Application'],
    ['Windows Shell Experience Host', 'ShellExperienceHost.exe', 'background', 0, 27.8, 9332, P.user, false, 'Windows Shell Experience Host'],
    ['Application Frame Host', 'ApplicationFrameHost.exe', 'background', 0, 11.6, 8172, P.user, false, 'Application Frame Host'],
    ['Intel(R) Graphics Command Center Service', 'igfxCUIService.exe', 'background', 0, 2.1, 3876, 'SYSTEM', false, 'Intel(R) Graphics Command Center Service'],
    ['Windows Defender SmartScreen', 'smartscreen.exe', 'background', 0, 12.9, 11920, P.user, false, 'Windows Defender SmartScreen'],
  ];

  /* Real artwork for processes that are not emulator apps (see assets/icons/sources.json).
     Keyed by lower-case image name; images without an icon resource use Task
     Manager's own generic process icon, as real Task Manager does. */
  const PROC_ICON = {
    'ms-teams.exe': 'teams.png', 'spotify.exe': 'spotify.png', 'hpsmart.exe': 'hpsmart.png', 'zoom.exe': 'zoom.png',
    'steam.exe': 'steam.png', 'widgets.exe': 'widgets.svg', 'phoneexperiencehost.exe': 'phonelink.png',
    'securityhealthsystray.exe': 'security.png', 'msmpeng.exe': 'security.png', 'rtkauduservice64.exe': 'realtek.png',
    'msedgewebview2.exe': 'webview2.png', 'spoolsv.exe': 'spooler.png', 'searchindexer.exe': 'searchindexer.png',
    'searchhost.exe': 'search.png', 'igfxcuiservice.exe': 'intelgcc.png',
    'svchost.exe': 'servicehost.png',
  };
  /** Startup-app ids that have their own artwork file (others use Win.appIcon). */
  const STARTUP_ICON = { teams: 'teams.png', spotify: 'spotify.png', hpsmart: 'hpsmart.png', zoom: 'zoom.png', steam: 'steam.png', vlc: 'vlc.png', security: 'security.png', realtek: 'realtek.png' };
  const procImg = file => `<img class="tm-img" src="assets/icons/${file}" width="16" height="16" alt="" draggable="false">`;

  const killed = new Set();
  const efficiency = new Set();
  const live = new Map();     // pid -> { cpu, mem, disk, net, cpuTime }
  const appPids = new Map();  // appId -> pid
  let startupSnapshot = null;

  const pidFor = key => {
    if (!appPids.has(key)) appPids.set(key, 4 * (1500 + (hash(`${key}${LOADED}`) % 6000)));
    return appPids.get(key);
  };

  function sampleOne(pid, base) {
    const prev = live.get(pid) || { cpu: base.cpu, mem: base.mem, disk: 0, net: 0, cpuTime: rand(0.2, 40) };
    const eff = efficiency.has(pid) ? 0.25 : 1;
    const spike = Math.random() < 0.04 ? rand(2, 9) : 0;
    const cpu = base.cpu <= 0 && !spike ? (Math.random() < 0.05 ? 0.1 : 0) : Math.max(0, (base.cpu * rand(0.3, 1.7) + spike * (base.cpu > 0.5 ? 1 : 0.3)) * eff);
    const mem = Math.max(0.1, prev.mem + (base.mem * rand(0.985, 1.015) - prev.mem) * 0.3);
    const disk = Math.random() < (base.disk || 0.05) ? rand(0.1, 1.4) : 0;
    const net = base.netty && Win.Network.online() ? (Math.random() < 0.3 ? rand(0.1, 2.4) : 0) : 0;
    const next = { cpu: Math.round(cpu * 10) / 10, mem, disk: Math.round(disk * 10) / 10, net: Math.round(net * 10) / 10, cpuTime: prev.cpuTime + cpu / 100 };
    live.set(pid, next);
    return next;
  }

  function usage(pid, base) {
    return live.get(pid) || { cpu: base.cpu, mem: base.mem, disk: 0, net: 0, cpuTime: (pid % 97) / 7 };
  }

  /** Every process currently running, newest data first. */
  function list() {
    if (!startupSnapshot && Win.state) {
      startupSnapshot = (Win.state.apps || []).filter(a => a.startup && STARTUP_PROC[a.id]).map(a => a.id);
    }
    const out = [];
    const byApp = new Map();
    Win.wm.windows.forEach(w => {
      if (!byApp.has(w.app.id)) byApp.set(w.app.id, []);
      byApp.get(w.app.id).push(w);
    });
    for (const [appId, wins] of byApp) {
      const [image, cpu, mem] = APP_EXE[appId] || [`${appId}.exe`, 0.1, 40];
      const pid = pidFor(appId);
      const base = { cpu: cpu * (1 + (wins.length - 1) * 0.4), mem: mem * (1 + (wins.length - 1) * 0.35), netty: appId === 'edge' || appId === 'store', disk: 0.08 };
      const u = usage(pid, base);
      out.push({ kind: 'app', group: 'app', pid, image, name: wins[0].app.name, app: appId, wins, base, ...u, memKB: Math.round(u.mem * 1024),
        user: P.user, session: 'Console', publisher: 'Microsoft Corporation', description: wins[0].app.name, critical: false });
    }
    if (!byApp.has('explorer')) {
      const pid = pidFor('explorer');
      const base = { cpu: 0.3, mem: 96, disk: 0.05 };
      const u = usage(pid, base);
      out.push({ kind: 'explorer', group: 'windows', pid, image: 'explorer.exe', name: 'Windows Explorer', app: 'explorer', wins: [], base, ...u, memKB: Math.round(u.mem * 1024),
        user: P.user, session: 'Console', description: 'Windows Explorer', critical: false });
    }
    (Win.Terminal?.processes?.() || []).forEach(sh => {
      const base = { cpu: 0, mem: sh.image === 'cmd.exe' ? 4.2 : 61.5 };
      const u = usage(sh.pid, base);
      out.push({ kind: 'shell', group: 'child', parentApp: 'terminal', pid: sh.pid, image: sh.image, name: sh.title, base, ...u, memKB: Math.round(u.mem * 1024),
        user: P.user, session: 'Console', description: sh.image === 'cmd.exe' ? 'Windows Command Processor' : 'Windows PowerShell', close: sh.close, critical: false });
    });
    (startupSnapshot || []).forEach(id => {
      const [name, image, cpu, mem, publisher] = STARTUP_PROC[id];
      const pid = pidFor(`startup-${id}`);
      if (killed.has(pid)) return;
      const base = { cpu, mem, netty: id === 'teams' || id === 'onedrive' || id === 'spotify', disk: 0.04 };
      const u = usage(pid, base);
      out.push({ kind: 'bg', group: 'background', pid, image, name, base, ...u, memKB: Math.round(u.mem * 1024), user: P.user, session: 'Console', publisher, description: name, critical: false });
    });
    SYSTEM.forEach(([name, image, group, cpu, mem, pid, user, critical, description, services]) => {
      if (killed.has(pid)) return;
      const base = { cpu, mem, disk: image === 'MsMpEng.exe' || image === 'SearchIndexer.exe' ? 0.12 : 0.01, netty: image === 'MsMpEng.exe' };
      const u = usage(pid, base);
      out.push({ kind: 'sys', group, pid, image, name, base, ...u, memKB: Math.round(u.mem * 1024), user, session: user === P.user || user === 'DWM-1' ? 'Console' : 'Services',
        publisher: /Realtek/.test(name) ? 'Realtek Semiconductor' : /Intel/.test(name) ? 'Intel Corporation' : 'Microsoft Corporation', description, critical, services });
    });
    out.forEach(p => { p.efficiency = efficiency.has(p.pid); });
    return out;
  }

  function sample() {
    const procs = list();
    procs.forEach(p => sampleOne(p.pid, p.base));
    return list();
  }

  function restartExplorer() {
    if (Win.Shell?.restartExplorer) { Win.Shell.restartExplorer(); return; }
    Win.wm.byApp('explorer').forEach(w => Win.wm.close(w, { force: true }));
    Win.closeMenu?.();
    Win.Flyout?.close?.();
    const parts = ['#taskbar', '#desktop-icons'].map(sel => Win.$(sel)).filter(Boolean);
    parts.forEach(el => { el.style.visibility = 'hidden'; });
    setTimeout(() => parts.forEach(el => { el.style.visibility = ''; }), 1600);
  }

  /** End a process. Returns 'ok', 'gui' (windows asked to close) or 'denied'. */
  function kill(p, { force = true } = {}) {
    if (!p) return 'notfound';
    if (p.critical || p.pid === 0) return 'denied';
    if (p.image === 'explorer.exe') { restartExplorer(); return 'ok'; }
    if (p.kind === 'app') { p.wins.slice().forEach(w => Win.wm.close(w, { force })); return force ? 'ok' : 'gui'; }
    if (p.kind === 'shell') { p.close?.(); return 'ok'; }
    if (p.image === 'Taskmgr.exe') { Win.wm.byApp('taskmgr').forEach(w => Win.wm.close(w, { force: true })); return 'ok'; }
    killed.add(p.pid);
    Win.emit('processes');
    return 'ok';
  }

  Win.Processes = {
    list: () => [{ kind: 'sys', group: 'windows', pid: 0, image: 'System Idle Process', name: 'System Idle Process', memKB: 8, session: 'Services', user: 'SYSTEM', critical: true, cpu: 0, mem: 0, disk: 0, net: 0, base: { cpu: 0, mem: 0 } }, ...list()],
    sample,
    kill,
    restartExplorer,
    setEfficiency(pid, on) { if (on) efficiency.add(pid); else efficiency.delete(pid); },
  };

  /* -------------------------------------------------------------- services */

  const SERVICES = [
    ['Appinfo', 'Application Information', 'Running', 'netsvcs'], ['AudioEndpointBuilder', 'Windows Audio Endpoint Builder', 'Running', 'LocalSystemNetworkRestricted'],
    ['Audiosrv', 'Windows Audio', 'Running', 'LocalServiceNetworkRestricted'], ['BFE', 'Base Filtering Engine', 'Running', 'LocalServiceNoNetworkFirewall'],
    ['BITS', 'Background Intelligent Transfer Service', 'Stopped', 'netsvcs'], ['BthAvctpSvc', 'AVCTP service', 'Running', 'LocalService'],
    ['bthserv', 'Bluetooth Support Service', 'Running', 'LocalService'], ['CryptSvc', 'Cryptographic Services', 'Running', 'NetworkService'],
    ['DcomLaunch', 'DCOM Server Process Launcher', 'Running', 'DcomLaunch'], ['Dhcp', 'DHCP Client', 'Running', 'LocalServiceNetworkRestricted'],
    ['DiagTrack', 'Connected User Experiences and Telemetry', 'Running', 'utcsvc'], ['Dnscache', 'DNS Client', 'Running', 'NetworkService'],
    ['DPS', 'Diagnostic Policy Service', 'Running', 'LocalServiceNoNetwork'], ['EventLog', 'Windows Event Log', 'Running', 'LocalServiceNetworkRestricted'],
    ['FontCache', 'Windows Font Cache Service', 'Running', 'LocalService'], ['iphlpsvc', 'IP Helper', 'Running', 'NetSvcs'],
    ['LanmanWorkstation', 'Workstation', 'Running', 'NetworkService'], ['lfsvc', 'Geolocation Service', 'Running', 'netsvcs'],
    ['mpssvc', 'Windows Defender Firewall', 'Running', 'LocalServiceNoNetworkFirewall'], ['NcaSvc', 'Network Connectivity Assistant', 'Stopped', 'NetSvcs'],
    ['netprofm', 'Network List Service', 'Running', 'LocalService'], ['NlaSvc', 'Network Location Awareness', 'Running', 'NetworkService'],
    ['nsi', 'Network Store Interface Service', 'Running', 'LocalService'], ['PlugPlay', 'Plug and Play', 'Running', 'DcomLaunch'],
    ['Power', 'Power', 'Running', 'DcomLaunch'], ['ProfSvc', 'User Profile Service', 'Running', 'netsvcs'],
    ['RpcEptMapper', 'RPC Endpoint Mapper', 'Running', 'RPCSS'], ['RpcSs', 'Remote Procedure Call (RPC)', 'Running', 'rpcss'],
    ['SamSs', 'Security Accounts Manager', 'Running', ''], ['Schedule', 'Task Scheduler', 'Running', 'netsvcs'],
    ['SecurityHealthService', 'Windows Security Service', 'Running', ''], ['Spooler', 'Print Spooler', 'Running', ''],
    ['SysMain', 'SysMain', 'Running', 'LocalSystemNetworkRestricted'], ['Themes', 'Themes', 'Running', 'netsvcs'],
    ['TrkWks', 'Distributed Link Tracking Client', 'Running', 'LocalSystemNetworkRestricted'], ['UsoSvc', 'Update Orchestrator Service', 'Running', 'netsvcs'],
    ['W32Time', 'Windows Time', 'Stopped', 'LocalService'], ['WinDefend', 'Microsoft Defender Antivirus Service', 'Running', ''],
    ['WinHttpAutoProxySvc', 'WinHTTP Web Proxy Auto-Discovery Service', 'Running', 'LocalServiceNetworkRestricted'], ['Winmgmt', 'Windows Management Instrumentation', 'Running', 'netsvcs'],
    ['WlanSvc', 'WLAN AutoConfig', 'Running', 'LocalSystemNetworkRestricted'], ['WSearch', 'Windows Search', 'Running', ''],
    ['wuauserv', 'Windows Update', 'Running', 'netsvcs'], ['XboxGipSvc', 'Xbox Accessory Management Service', 'Stopped', 'netsvcs'],
  ].map(([name, description, status, group]) => ({ name, description, status, group, pid: status === 'Running' ? 1200 + (hash(name) % 9000) : null }));

  /* ------------------------------------------------------------- formatting */

  const pct = v => `${v < 0.05 ? 0 : v >= 10 ? Math.round(v) : v.toFixed(1)}%`;
  const mb = v => `${v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${v.toFixed(1)} MB`}`;
  const mbs = v => `${v ? v.toFixed(1) : 0} MB/s`;
  const mbps = v => `${v ? v.toFixed(1) : 0} Mbps`;
  const heat = (v, max) => (v <= 0 ? 0.12 : Math.min(1, 0.22 + (v / max) * 0.78));
  const uptime = () => {
    const s = Math.floor((Date.now() - (Win.bootedAt || LOADED)) / 1000) + 3 * 3600 + 1234;
    const d = Math.floor(s / 86400);
    const two = n => String(n).padStart(2, '0');
    return `${d}:${two(Math.floor(s / 3600) % 24)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
  };

  const svg = (path, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const NAV = [
    ['processes', 'Processes', svg('<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>')],
    ['performance', 'Performance', svg('<path d="M2.5 2.5v15h15"/><path d="M5 13l3.5-4.5 3 2.5 5-6"/>')],
    ['history', 'App history', svg('<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7"/><path d="M3 3v3.5h3.5M10 6.5V10l2.5 1.8"/>')],
    ['startup', 'Startup apps', svg('<path d="M3.5 14.5a6.5 6.5 0 1 1 13 0"/><path d="M10 14.5l3-4.2"/><circle cx="10" cy="14.5" r="1" fill="currentColor"/>')],
    ['users', 'Users', svg('<circle cx="7.5" cy="7" r="2.8"/><path d="M2.5 16.5c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5"/><circle cx="14" cy="7.5" r="2.2"/><path d="M13.5 12c2 0 3.5 1.2 4 3.6"/>')],
    ['details', 'Details', svg('<path d="M7 5h10M7 10h10M7 15h10"/><circle cx="3.6" cy="5" r=".8" fill="currentColor"/><circle cx="3.6" cy="10" r=".8" fill="currentColor"/><circle cx="3.6" cy="15" r=".8" fill="currentColor"/>')],
    ['services', 'Services', svg('<path d="M7 3.5h3v1.6a1.5 1.5 0 0 0 3 0V3.5h3.5V7h-1.6a1.5 1.5 0 0 0 0 3h1.6v6.5H13v-1.6a1.5 1.5 0 0 0-3 0v1.6H3.5V13h1.6a1.5 1.5 0 0 0 0-3H3.5V3.5z"/>')],
  ];
  const LEAF = svg('<path d="M4 16c0-7 4.5-11 12-12-.5 7.5-4.5 12-11 12"/><path d="M4 16l6-6"/>', 14);

  const COLORS = { cpu: '#1191e8', mem: '#a14cd6', disk: '#4da60c', wifi: '#c0710e', gpu: '#1f8fa8' };

  /* --------------------------------------------------------------- window */

  function create(win, args = {}) {
    const S = () => Win.state.taskmgr;
    const st = win.state;
    st.page = args.page || S().startPage || 'processes';
    st.sort = { key: null, dir: -1 };
    st.selected = null;
    st.expanded = new Set();
    st.query = '';
    st.perf = 'cpu';
    st.hist = { cpu: [], mem: [], disk: [], send: [], recv: [], gpu: [] };
    st.last = null;
    st.services = SERVICES;

    win.el.classList.add('tm-win');
    win.titleContent.innerHTML = `<span class="tm-title">${Win.appIcon('taskmgr', 16)}<span>Task Manager</span></span>
      <label class="tm-search" data-nodrag>${Win.glyph('search', 14)}<input type="search" placeholder="Type a name, publisher, or PID to search" aria-label="Search"></label>`;
    win.body.innerHTML = `<div class="tm ${S().navOpen ? 'nav-open' : ''}">
      <nav class="tm-nav" aria-label="Task Manager pages">
        <button class="tm-ham" aria-label="Open navigation" title="Open navigation">${svg('<path d="M3 5.5h14M3 10h14M3 14.5h14"/>')}</button>
        ${NAV.map(([id, label, icon]) => `<button class="tm-nav-btn" data-page="${id}" title="${label}" aria-label="${label}">${icon}<span>${label}</span></button>`).join('')}
        <span class="tm-nav-fill"></span>
        <button class="tm-nav-btn" data-page="settings" title="Settings" aria-label="Settings">${Win.glyph('gear', 16)}<span>Settings</span></button>
      </nav>
      <main class="tm-main">
        <header class="tm-head"><h1></h1><div class="tm-actions"></div></header>
        <div class="tm-content" tabindex="0"></div>
      </main></div>`;
    const root = win.body.querySelector('.tm');
    const content = root.querySelector('.tm-content');
    const head = root.querySelector('.tm-head');
    const search = win.titleContent.querySelector('input');

    const matches = (...fields) => !st.query || fields.some(f => String(f ?? '').toLowerCase().includes(st.query));

    /* ---------------------------------------------------------- actions */

    const selectedProc = () => {
      const procs = st.last || list();
      if (!st.selected) return null;
      if (st.selected.startsWith('pid:')) return procs.find(p => String(p.pid) === st.selected.slice(4)) || null;
      if (st.selected.startsWith('win:')) return null;
      return null;
    };

    const endTask = async () => {
      if (st.page === 'services') return;
      const p = selectedProc();
      if (!p) return;
      if (p.image === 'explorer.exe') { restartExplorer(); return; }
      if (p.critical) {
        await Win.dialog({ owner: win, title: 'Task Manager', body: `<p>Unable to terminate process</p><p class="muted">The operation could not be completed.</p><p class="muted">Access is denied.</p>` });
        return;
      }
      if (p.group === 'windows') {
        const ok = await Win.confirm('Task Manager', `Do you want to end the system process '${p.name}'?\n\nEnding this process will make the operating system unusable or shut down, causing you to lose unsaved data. Are you sure you want to continue?`, { ok: 'Shut down', cancel: 'Cancel', owner: win });
        if (!ok) return;
      }
      kill(p, { force: true });
      st.selected = null;
      refresh(true);
    };

    const toggleEfficiency = async () => {
      const p = selectedProc();
      if (!p || p.group === 'windows' || p.critical) return;
      if (!p.efficiency) {
        const ok = await Win.dialog({
          owner: win, title: 'Turn on Efficiency mode?',
          body: '<p>Efficiency mode will lower process priority and improve power efficiency. It may cause instability for some processes.</p>',
          buttons: [{ label: 'Turn on Efficiency mode', value: true, primary: true }, { label: 'Cancel', value: false }],
        });
        if (!ok) return;
      }
      Win.Processes.setEfficiency(p.pid, !p.efficiency);
      refresh(true);
    };

    const runTask = () => {
      Win.dialog({
        owner: win, title: 'Create new task', width: 440,
        body: `<p class="muted">Type the name of a program, folder, document, or Internet resource, and Windows will open it for you.</p>
          <label class="field"><span>Open:</span><input class="input" data-run spellcheck="false" autocomplete="off"></label>
          <label class="check"><input type="checkbox" data-admin> Create this task with administrative privileges.</label>`,
        buttons: [
          { label: 'OK', primary: true, value: box => true,
            validate: box => {
              const value = box.querySelector('[data-run]').value.trim();
              if (!value) return 'Type the name of a program, folder, document, or Internet resource.';
              const admin = box.querySelector('[data-admin]').checked;
              const problem = Win.Terminal?.start ? Win.Terminal.start(value, { admin }) : (Win.wm.open(value) ? '' : `Windows cannot find '${value}'.`);
              return problem || '';
            } },
          { label: 'Cancel', value: false },
        ],
      });
    };

    const actionsFor = page => {
      const p = selectedProc();
      const endLabel = p?.image === 'explorer.exe' ? 'Restart' : 'End task';
      const canEnd = !!p && p.kind !== 'child';
      const run = `<button class="tm-act" data-act="run">${svg('<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M10 7.5v5M7.5 10h5"/>')}<span>Run new task</span></button>`;
      if (page === 'processes' || page === 'details' || page === 'users') {
        return `${run}<span class="tm-sep"></span>
          <button class="tm-act" data-act="end" ${canEnd ? '' : 'disabled'}>${svg('<circle cx="10" cy="10" r="7"/><path d="M5 15L15 5"/>')}<span>${endLabel}</span></button>
          ${page === 'processes' ? `<button class="tm-act" data-act="eff" ${p && p.group !== 'windows' && !p.critical ? '' : 'disabled'}>${LEAF}<span>Efficiency mode</span></button>` : ''}`;
      }
      if (page === 'startup') {
        const row = startupRows().find(r => r.key === st.selected);
        return `${run}<span class="tm-sep"></span><button class="tm-act" data-act="enable" ${row && !row.enabled ? '' : 'disabled'}>${svg('<circle cx="10" cy="10" r="7"/><path d="M7 10l2 2 4-4"/>')}<span>Enable</span></button>
          <button class="tm-act" data-act="disable" ${row && row.enabled ? '' : 'disabled'}>${svg('<circle cx="10" cy="10" r="7"/><path d="M5 15L15 5"/>')}<span>Disable</span></button>`;
      }
      if (page === 'services') {
        const svc = st.services.find(x => x.name === st.selected);
        return `${run}<span class="tm-sep"></span><button class="tm-act" data-act="svc-start" ${svc && svc.status === 'Stopped' ? '' : 'disabled'}>${Win.glyph('play', 16)}<span>Start</span></button>
          <button class="tm-act" data-act="svc-stop" ${svc && svc.status === 'Running' ? '' : 'disabled'}>${Win.glyph('stop', 16)}<span>Stop</span></button>
          <button class="tm-act" data-act="svc-restart" ${svc && svc.status === 'Running' ? '' : 'disabled'}>${Win.glyph('refresh', 16)}<span>Restart</span></button>`;
      }
      if (page === 'history') return `${run}<span class="tm-sep"></span><button class="tm-act" data-act="clearhist">${Win.glyph('trash', 16)}<span>Delete usage history</span></button>`;
      return run;
    };

    const TITLES = { processes: 'Processes', performance: 'Performance', history: 'App history', startup: 'Startup apps', users: 'Users', details: 'Details', services: 'Services', settings: 'Settings' };

    const renderHead = () => {
      head.querySelector('h1').textContent = TITLES[st.page];
      head.querySelector('.tm-actions').innerHTML = actionsFor(st.page);
      root.querySelectorAll('.tm-nav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.page === st.page);
        b.setAttribute('aria-current', b.dataset.page === st.page ? 'page' : 'false');
      });
    };

    /* -------------------------------------------------------- processes */

    const sortList = (rows, key) => {
      if (!st.sort.key) return rows;
      const k = st.sort.key;
      return rows.slice().sort((a, b) => {
        const va = k === 'name' ? a.name.toLowerCase() : k === 'pid' ? a.pid : k === 'memory' ? a.mem : a[k] ?? 0;
        const vb = k === 'name' ? b.name.toLowerCase() : k === 'pid' ? b.pid : k === 'memory' ? b.mem : b[k] ?? 0;
        return (va > vb ? 1 : va < vb ? -1 : 0) * st.sort.dir * (k === 'name' ? -1 : 1);
      });
    };

    const totals = procs => {
      const cpu = Math.min(100, procs.reduce((s, p) => s + (p.cpu || 0), 0) + 1.5);
      const mem = Math.min(99, ((procs.reduce((s, p) => s + (p.mem || 0), 0) + 7600) / 32385) * 100);
      const disk = Math.min(100, procs.reduce((s, p) => s + (p.disk || 0), 0) * 2);
      const net = Win.Network.online() ? Math.min(100, procs.reduce((s, p) => s + (p.net || 0), 0) / 12) : 0;
      return { cpu, mem, disk, net };
    };

    const sortHead = (key, label, extra = '') => {
      const on = st.sort.key === key;
      return `<th data-sort="${key}" class="${on ? 'sorted' : ''} ${key !== 'name' && key !== 'status' ? 'num' : ''}" aria-sort="${on ? (st.sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${extra}<span>${label}</span>${on ? `<i class="tm-caret">${Win.glyph(st.sort.dir > 0 ? 'chevup' : 'chevdown', 10)}</i>` : ''}</th>`;
    };

    const procCells = p => `
      <td class="num heat" style="--h:${heat(p.cpu, 25)}">${pct(p.cpu)}</td>
      <td class="num heat" style="--h:${heat(p.mem, 1200)}">${mb(p.mem)}</td>
      <td class="num heat" style="--h:${heat(p.disk, 4)}">${mbs(p.disk)}</td>
      <td class="num heat" style="--h:${heat(p.net, 4)}">${mbps(p.net)}</td>`;

    const procRow = (p, icon, opts = {}) => {
      const key = `pid:${p.pid}`;
      const expandable = opts.children?.length;
      const open = st.expanded.has(key);
      return `<tr class="tm-row ${st.selected === key ? 'sel' : ''}" data-key="${key}" aria-selected="${st.selected === key}" ${expandable ? `aria-expanded="${open}"` : ''}>
        <td class="name"><span class="tm-exp">${expandable ? `<button class="tm-chev" data-exp="${key}" aria-label="${open ? 'Collapse' : 'Expand'}" tabindex="-1">${Win.glyph(open ? 'chevdown' : 'chevright', 10)}</button>` : ''}</span>
          <span class="tm-ico">${icon}</span><span class="tm-name">${Win.esc(p.name)}${expandable ? ` (${opts.children.length})` : ''}</span></td>
        <td class="status">${p.efficiency ? `<span class="tm-leaf" title="Efficiency mode">${LEAF}</span>` : ''}</td>
        ${procCells(p)}</tr>
        ${expandable && open ? opts.children.map(c => `<tr class="tm-row child" data-key="${c.key}"><td class="name"><span class="tm-exp"></span><span class="tm-ico">${c.icon}</span><span class="tm-name">${Win.esc(c.name)}</span></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('') : ''}`;
    };

    const iconFor = p => {
      if (p.kind === 'app' || p.kind === 'explorer') return Win.appIcon(Win.apps.get(p.app)?.icon || 'generic', 16);
      const file = PROC_ICON[String(p.image).toLowerCase()];
      if (file) return procImg(file);
      if (/OneDrive/i.test(p.image)) return Win.appIcon('onedrive', 16);
      if (/StartMenu|explorer/i.test(p.image)) return Win.appIcon('windows', 16);
      if (p.kind === 'shell') return Win.appIcon(p.image === 'cmd.exe' ? 'cmd' : 'powershell', 16);
      return procImg('process.png');
    };

    const renderProcesses = procs => {
      const t = totals(procs);
      const visible = procs.filter(p => p.group !== 'child' && p.pid !== 0 && matches(p.name, p.image, p.pid, p.publisher));
      const apps = sortList(visible.filter(p => p.group === 'app'));
      const bg = sortList(visible.filter(p => p.group === 'background'));
      const sys = sortList(visible.filter(p => p.group === 'windows'));
      const shells = procs.filter(p => p.group === 'child');
      const children = p => {
        if (p.kind !== 'app') return [];
        if (p.app === 'terminal') return shells.map(sh => ({ key: `pid:${sh.pid}`, name: sh.name, icon: Win.appIcon(sh.image === 'cmd.exe' ? 'cmd' : 'powershell', 16) }));
        return p.wins.map(w => ({ key: `win:${w.id}`, name: w.title || w.app.name, icon: Win.appIcon(w.app.icon, 16) }));
      };
      const group = (label, rows) => (rows.length ? `<tr class="tm-group"><td colspan="6">${label} (${rows.length})</td></tr>${rows.map(p => procRow(p, iconFor(p), { children: children(p) })).join('')}` : '');
      return `<table class="tm-table" role="grid" aria-label="Processes">
        <thead><tr>${sortHead('name', 'Name')}${sortHead('status', 'Status')}
          ${sortHead('cpu', 'CPU', `<b>${Math.round(t.cpu)}%</b>`)}${sortHead('memory', 'Memory', `<b>${Math.round(t.mem)}%</b>`)}
          ${sortHead('disk', 'Disk', `<b>${Math.round(t.disk)}%</b>`)}${sortHead('net', 'Network', `<b>${Math.round(t.net)}%</b>`)}</tr></thead>
        <tbody>${group('Apps', apps)}${group('Background processes', bg)}${group('Windows processes', sys)}</tbody></table>`;
    };

    /* ------------------------------------------------------ performance */

    const graph = (series, color, { max = 100, dashed = null } = {}) => {
      const pts = arr => {
        const data = arr.slice(-60);
        const pad = 60 - data.length;
        return data.map((v, i) => `${((pad + i) / 59) * 600},${300 - Math.min(1, v / max) * 300}`).join(' ');
      };
      const area = arr => (arr.length ? `M${pts(arr).split(' ')[0].split(',')[0]},300 L${pts(arr).replace(/ /g, ' L')} L600,300 Z` : '');
      return `<svg class="tm-graph" viewBox="0 0 600 300" preserveAspectRatio="none" style="--c:${color}" aria-hidden="true">
        ${Array.from({ length: 9 }, (_, i) => `<line x1="0" x2="600" y1="${(i + 1) * 30}" y2="${(i + 1) * 30}"/>`).join('')}
        ${Array.from({ length: 19 }, (_, i) => `<line y1="0" y2="300" x1="${(i + 1) * 30}" x2="${(i + 1) * 30}"/>`).join('')}
        ${series.length ? `<path class="fill" d="${area(series)}"/><polyline class="line" points="${pts(series)}"/>` : ''}
        ${dashed?.length ? `<polyline class="line dash" points="${pts(dashed)}"/>` : ''}
      </svg>`;
    };

    const spark = (series, color, max = 100) => {
      const data = series.slice(-30);
      const pts = data.map((v, i) => `${((30 - data.length + i) / 29) * 60},${30 - Math.min(1, v / max) * 30}`).join(' ');
      return `<svg class="tm-spark" viewBox="0 0 60 30" preserveAspectRatio="none" style="--c:${color}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
    };

    const perfData = procs => {
      const t = totals(procs);
      const net = Win.Network.current();
      const online = Win.Network.online();
      const busy = procs.filter(p => p.kind === 'app').length;
      const recv = net ? (online ? rand(4, 40) + (Win.wm.byApp('edge').length ? rand(0, 900) * (Math.random() < 0.25 ? 1 : 0.05) : 0) : rand(0, 2)) : 0;
      const send = net ? (online ? rand(0, 16) : rand(0, 1)) : 0;
      return {
        cpu: t.cpu, mem: t.mem, disk: Math.min(100, t.disk + (Math.random() < 0.1 ? rand(1, 12) : 0)),
        gpu: Math.min(100, 1 + busy * 0.8 + rand(0, 3) + (Win.wm.byApp('edge').length ? rand(0, 4) : 0)),
        recv, send, procs: procs.length + 96, threads: 2840 + procs.length * 31 + Math.round(rand(0, 40)), handles: 112400 + procs.length * 620 + Math.round(rand(0, 900)),
        speed: (t.cpu > 20 ? rand(3.6, 4.8) : rand(1.6, 3.2)).toFixed(2),
      };
    };

    const kbps = v => (v >= 1000 ? `${(v / 1000).toFixed(1)} Mbps` : `${Math.round(v)} Kbps`);

    const renderPerformance = () => {
      const h = st.hist;
      const d = st.perfNow || perfData(st.last || list());
      const net = Win.Network.current();
      const c = Win.Network.config();
      const memUsed = (d.mem / 100) * 31.6;
      const items = [
        ['cpu', 'CPU', `${Math.round(d.cpu)}%  ${d.speed} GHz`, spark(h.cpu, COLORS.cpu)],
        ['mem', 'Memory', `${memUsed.toFixed(1)}/31.6 GB (${Math.round(d.mem)}%)`, spark(h.mem, COLORS.mem)],
        ['disk', 'Disk 0 (C:)', `SSD (NVMe)\n${Math.round(d.disk)}%`, spark(h.disk, COLORS.disk)],
        ['wifi', 'Wi-Fi', net ? `Wi-Fi\nS: ${kbps(d.send)} R: ${kbps(d.recv)}` : 'Not connected', spark(h.recv, COLORS.wifi, Math.max(100, ...h.recv.slice(-30)))],
        ['gpu', 'GPU 0', `Intel(R) Arc(TM) 140V GPU (16GB)\n${Math.round(d.gpu)}%`, spark(h.gpu, COLORS.gpu)],
      ];
      const list = `<div class="tm-perf-list" role="listbox" aria-label="Devices">${items.map(([id, title, sub, sp]) => `<button class="tm-perf-item ${st.perf === id ? 'active' : ''}" data-perf="${id}" role="option" aria-selected="${st.perf === id}">${sp}<span><b>${title}</b><small>${Win.esc(sub).replace(/\n/g, '<br>')}</small></span></button>`).join('')}</div>`;
      const stat = (label, value, big = true) => `<div class="tm-stat ${big ? 'big' : ''}"><small>${label}</small><span>${value}</span></div>`;
      const kv = rows => `<dl class="tm-kv">${rows.map(([k, v]) => `<dt>${k}:</dt><dd>${v}</dd>`).join('')}</dl>`;
      let detail = '';
      if (st.perf === 'cpu') {
        detail = `<header><h2>CPU</h2><span>Intel(R) Core(TM) Ultra 7 268V</span></header>
          <div class="tm-graph-cap"><span>% Utilization over 60 seconds</span><span>100%</span></div>${graph(h.cpu, COLORS.cpu)}<div class="tm-graph-cap"><span>60 seconds</span><span>0</span></div>
          <div class="tm-stats"><div class="tm-stat-grid">${stat('Utilization', `${Math.round(d.cpu)}%`)}${stat('Speed', `${d.speed} GHz`)}${stat('Processes', d.procs)}${stat('Threads', d.threads)}${stat('Handles', d.handles.toLocaleString('en-US'))}${stat('Up time', uptime())}</div>
          ${kv([['Base speed', '2.20 GHz'], ['Sockets', '1'], ['Cores', '8'], ['Logical processors', '8'], ['Virtualization', 'Enabled'], ['L1 cache', '1.1 MB'], ['L2 cache', '14.0 MB'], ['L3 cache', '12.0 MB']])}</div>`;
      } else if (st.perf === 'mem') {
        detail = `<header><h2>Memory</h2><span>32.0 GB</span></header>
          <div class="tm-graph-cap"><span>Memory usage</span><span>31.6 GB</span></div>${graph(h.mem, COLORS.mem)}<div class="tm-graph-cap"><span>60 seconds</span><span>0</span></div>
          <div class="tm-graph-cap"><span>Memory composition</span></div><div class="tm-compose" style="--c:${COLORS.mem}"><i style="width:${d.mem}%"></i><i class="mod" style="width:2%"></i><i class="stand" style="width:${Math.max(0, 70 - d.mem)}%"></i></div>
          <div class="tm-stats"><div class="tm-stat-grid">${stat('In use (Compressed)', `${memUsed.toFixed(1)} GB (412 MB)`)}${stat('Available', `${(31.6 - memUsed).toFixed(1)} GB`)}${stat('Committed', `${(memUsed + 3.1).toFixed(1)}/36.4 GB`)}${stat('Cached', `${(14.2 - memUsed / 4).toFixed(1)} GB`)}${stat('Paged pool', '612 MB')}${stat('Non-paged pool', '488 MB')}</div>
          ${kv([['Speed', '8533 MT/s'], ['Slots used', 'N/A'], ['Form factor', 'Row of chips'], ['Hardware reserved', '412 MB']])}</div>`;
      } else if (st.perf === 'disk') {
        detail = `<header><h2>Disk 0 (C:)</h2><span>NVMe PC SSD 512GB</span></header>
          <div class="tm-graph-cap"><span>Active time</span><span>100%</span></div>${graph(h.disk, COLORS.disk)}<div class="tm-graph-cap"><span>60 seconds</span><span>0</span></div>
          <div class="tm-stats"><div class="tm-stat-grid">${stat('Active time', `${Math.round(d.disk)}%`)}${stat('Average response time', `${(0.1 + d.disk / 20).toFixed(1)} ms`)}${stat('Read speed', `${Math.round(d.disk * 18)} KB/s`)}${stat('Write speed', `${Math.round(d.disk * 31)} KB/s`)}</div>
          ${kv([['Capacity', '477 GB'], ['Formatted', '477 GB'], ['System disk', 'Yes'], ['Page file', 'Yes'], ['Type', 'SSD (NVMe)']])}</div>`;
      } else if (st.perf === 'wifi') {
        const max = Math.max(100, ...h.recv.slice(-60), ...h.send.slice(-60));
        const sig = net ? [0, 1, 2, 3, 4].map(i => `<i class="${i < net.signal ? 'on' : ''}"></i>`).join('') : '';
        detail = `<header><h2>Wi-Fi</h2><span>${Win.esc(Win.Network.ADAPTER.description)}</span></header>
          <div class="tm-graph-cap"><span>Throughput</span><span>${kbps(max)}</span></div>${graph(h.recv, COLORS.wifi, { max, dashed: h.send })}<div class="tm-graph-cap"><span>60 seconds</span><span>0</span></div>
          <div class="tm-stats"><div class="tm-stat-grid">${net ? `${stat('<i class="tm-line-key dash"></i>Send', kbps(d.send))}${stat('<i class="tm-line-key"></i>Receive', kbps(d.recv))}` : stat('Status', 'Not connected')}</div>
          ${kv(net ? [['Adapter name', 'Wi-Fi'], ['SSID', Win.esc(net.ssid)], ['Connection type', Win.esc(net.protocol.match(/\((.*)\)/)?.[1] || '802.11ax')], ['IPv4 address', c?.ip || ''], ['IPv6 address', (c?.ipv6 || '').replace(/%\d+$/, '')], ['Signal strength', `<span class="tm-bars">${sig}</span>`]]
            : [['Adapter name', 'Wi-Fi'], ['Connection type', 'Not connected']])}</div>`;
      } else {
        detail = `<header><h2>GPU</h2><span>Intel(R) Arc(TM) 140V GPU (16GB)</span></header>
          <div class="tm-graph-cap"><span>3D</span><span>100%</span></div>${graph(h.gpu, COLORS.gpu)}<div class="tm-graph-cap"><span>60 seconds</span><span>0</span></div>
          <div class="tm-stats"><div class="tm-stat-grid">${stat('Utilization', `${Math.round(d.gpu)}%`)}${stat('Shared GPU memory', `${(0.6 + d.gpu / 40).toFixed(1)}/15.8 GB`)}${stat('GPU Memory', `${(0.6 + d.gpu / 40).toFixed(1)}/15.8 GB`)}</div>
          ${kv([['Driver version', '32.0.101.6979'], ['Driver date', '8/12/2026'], ['DirectX version', '12 (FL 12.2)'], ['Physical location', 'PCI bus 0, device 2, function 0']])}</div>`;
      }
      return `<div class="tm-perf">${list}<section class="tm-perf-detail" style="--c:${COLORS[st.perf]}">${detail}</section></div>`;
    };

    /* ---------------------------------------------------- other pages */

    const simpleTable = (cols, rows, label) => `<table class="tm-table flat" role="grid" aria-label="${label}"><thead><tr>${cols.map(([k, l, num]) => sortHead(k, l).replace('class="', `class="${num ? 'num ' : ''}`)).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;

    const renderHistory = () => {
      const since = new Date(LOADED - 29 * 86400000).toLocaleDateString('en-US');
      const apps = Win.apps.all().filter(a => !a.hidden && !a.launch).slice(0, 18);
      const rows = apps.filter(a => matches(a.name)).map(a => {
        const h = hash(a.id);
        const cpu = `${Math.floor(h % 3)}:${String((h >> 3) % 60).padStart(2, '0')}:${String((h >> 5) % 60).padStart(2, '0')}`;
        const netv = a.id === 'edge' ? 2140.6 : (h % 400) / 10;
        return `<tr class="tm-row" data-key="h:${a.id}"><td class="name"><span class="tm-ico">${Win.appIcon(a.icon, 16)}</span><span class="tm-name">${Win.esc(a.name)}</span></td>
          <td class="num heat" style="--h:${heat(h % 100, 100)}">${cpu}</td><td class="num heat" style="--h:${heat(netv, 400)}">${netv.toFixed(1)} MB</td><td class="num heat" style="--h:0.12">0 MB</td><td class="num heat" style="--h:0.12">0 MB</td></tr>`;
      });
      return `<p class="tm-note">Resource usage since ${since} for current user account.</p>${simpleTable([['name', 'Name'], ['cpu', 'CPU time', 1], ['net', 'Network', 1], ['metered', 'Metered network', 1], ['tile', 'Tile updates', 1]], rows, 'App history')}`;
    };

    const IMPACT = { teams: 'High', onedrive: 'High', spotify: 'Medium', hpsmart: 'Low', zoom: 'Medium', steam: 'High', vlc: 'Low' };
    const startupRows = () => {
      const rows = (Win.state.apps || []).filter(a => 'startup' in a).map(a => ({ key: `s:${a.id}`, name: a.name, publisher: a.publisher, enabled: !!a.startup, impact: a.startup ? IMPACT[a.id] || 'Low' : 'None', icon: a.id, app: a }));
      const extra = S().extraStartup || {};
      rows.push({ key: 's:security', name: 'Windows Security notification icon', publisher: 'Microsoft Corporation', enabled: extra.security !== false, impact: extra.security !== false ? 'Low' : 'None', extra: 'security' });
      rows.push({ key: 's:realtek', name: 'Realtek HD Audio Universal Service', publisher: 'Realtek Semiconductor', enabled: extra.realtek !== false, impact: extra.realtek !== false ? 'Low' : 'None', extra: 'realtek' });
      return rows;
    };

    const setStartup = (key, on) => {
      const row = startupRows().find(r => r.key === key);
      if (!row) return;
      if (row.app) row.app.startup = on;
      else S().extraStartup = { ...(S().extraStartup || {}), [row.extra]: on };
      Win.save('apps');
      refresh(true);
    };

    const startupIcon = r => {
      const id = r.app ? r.app.id : r.extra;
      if (STARTUP_ICON[id]) return procImg(STARTUP_ICON[id]);
      if (r.app && Win.appIcons?.[id]) return Win.appIcon(id, 16);
      return `<span class="tm-letter" style="--hue:${hash(r.name) % 360}">${Win.esc(r.name[0])}</span>`;
    };

    const renderStartup = () => {
      let rows = startupRows().filter(r => matches(r.name, r.publisher));
      if (st.sort.key) rows = rows.slice().sort((a, b) => String(a[st.sort.key] ?? a.name).localeCompare(String(b[st.sort.key] ?? b.name)) * st.sort.dir);
      const html = rows.map(r => `<tr class="tm-row ${st.selected === r.key ? 'sel' : ''}" data-key="${r.key}" aria-selected="${st.selected === r.key}">
        <td class="name"><span class="tm-ico">${startupIcon(r)}</span><span class="tm-name">${Win.esc(r.name)}</span></td>
        <td>${Win.esc(r.publisher)}</td><td>${r.enabled ? 'Enabled' : 'Disabled'}</td><td>${r.impact}</td></tr>`);
      return `<p class="tm-note right">Last BIOS time: <b>4.6 seconds</b></p>${simpleTable([['name', 'Name'], ['publisher', 'Publisher'], ['enabled', 'Status'], ['impact', 'Startup impact']], html, 'Startup apps')}`;
    };

    const renderUsers = procs => {
      const mine = procs.filter(p => p.user === P.user && p.group !== 'child');
      const sum = k => mine.reduce((s, p) => s + (p[k] || 0), 0);
      const key = 'user:isaiah';
      const open = st.expanded.has(key);
      const agg = { cpu: Math.min(100, sum('cpu')), mem: sum('mem'), disk: sum('disk'), net: sum('net') };
      const kids = open ? mine.filter(p => p.group === 'app' || p.group === 'background').map(p => `<tr class="tm-row child ${st.selected === `pid:${p.pid}` ? 'sel' : ''}" data-key="pid:${p.pid}"><td class="name"><span class="tm-exp"></span><span class="tm-ico">${iconFor(p)}</span><span class="tm-name">${Win.esc(p.name)}</span></td><td></td>${procCells(p)}</tr>`).join('') : '';
      return `<table class="tm-table" role="grid" aria-label="Users"><thead><tr>${sortHead('name', 'User')}${sortHead('status', 'Status')}${sortHead('cpu', 'CPU')}${sortHead('memory', 'Memory')}${sortHead('disk', 'Disk')}${sortHead('net', 'Network')}</tr></thead>
        <tbody><tr class="tm-row ${st.selected === key ? 'sel' : ''}" data-key="${key}" aria-expanded="${open}"><td class="name"><span class="tm-exp"><button class="tm-chev" data-exp="${key}" aria-label="${open ? 'Collapse' : 'Expand'}" tabindex="-1">${Win.glyph(open ? 'chevdown' : 'chevright', 10)}</button></span>
          <span class="tm-ico"><span class="tm-avatar">${Win.esc(P.initials)}</span></span><span class="tm-name">${Win.esc(S().fullName ? `${P.name} (${P.email})` : P.name)} (${mine.length})</span></td><td></td>${procCells(agg)}</tr>${kids}</tbody></table>`;
    };

    const renderDetails = procs => {
      let rows = procs.filter(p => matches(p.image, p.pid, p.description, p.user));
      rows = st.sort.key ? sortList(rows) : rows.slice().sort((a, b) => a.image.localeCompare(b.image, 'en', { sensitivity: 'base' }));
      const html = rows.map(p => `<tr class="tm-row ${st.selected === `pid:${p.pid}` ? 'sel' : ''}" data-key="pid:${p.pid}" aria-selected="${st.selected === `pid:${p.pid}`}">
        <td class="name"><span class="tm-ico">${iconFor(p)}</span><span class="tm-name">${Win.esc(p.image)}</span></td><td class="num">${p.pid}</td><td>${p.efficiency ? 'Efficiency mode' : 'Running'}</td>
        <td>${Win.esc(p.user)}</td><td class="num">${String(Math.round(p.cpu || 0)).padStart(2, '0')}</td><td class="num">${(p.memKB || 0).toLocaleString('en-US')} K</td><td>x64</td><td>${Win.esc(p.description || '')}</td></tr>`);
      return simpleTable([['name', 'Name'], ['pid', 'PID', 1], ['status', 'Status'], ['user', 'User name'], ['cpu', 'CPU', 1], ['memory', 'Memory (active private working set)', 1], ['arch', 'Architecture'], ['desc', 'Description']], html, 'Details');
    };

    const renderServices = () => {
      let rows = st.services.filter(x => matches(x.name, x.description, x.pid, x.group));
      if (st.sort.key) rows = rows.slice().sort((a, b) => String(a[st.sort.key === 'desc' ? 'description' : st.sort.key] ?? '').localeCompare(String(b[st.sort.key === 'desc' ? 'description' : st.sort.key] ?? '')) * st.sort.dir);
      const html = rows.map(x => `<tr class="tm-row ${st.selected === x.name ? 'sel' : ''}" data-key="${x.name}" aria-selected="${st.selected === x.name}">
        <td class="name"><span class="tm-ico">${procImg('servicehost.png')}</span><span class="tm-name">${Win.esc(x.name)}</span></td><td class="num">${x.pid ?? ''}</td><td>${Win.esc(x.description)}</td><td>${x.status}</td><td>${Win.esc(x.group)}</td></tr>`);
      return simpleTable([['name', 'Name'], ['pid', 'PID', 1], ['desc', 'Description'], ['status', 'Status'], ['group', 'Group']], html, 'Services');
    };

    const renderSettings = () => {
      const s = S();
      const row = (title, desc, control) => `<div class="card-row"><span class="row-text"><span class="row-title">${title}</span>${desc ? `<span class="row-desc">${desc}</span>` : ''}</span><span class="row-end">${control}</span></div>`;
      return `<div class="tm-settings">
        <h3>General</h3>
        ${row('Default start page', 'Choose which page opens when Task Manager starts.', Win.select(NAV.map(([id, label]) => [id, label]), s.startPage, 'data-set="startPage"'))}
        ${row('Real time update speed', 'Choose how often data updates.', Win.select([['high', 'High'], ['normal', 'Normal'], ['low', 'Low'], ['paused', 'Paused']], s.speed, 'data-set="speed"'))}
        <h3>Window management</h3>
        ${row('Always on top', '', Win.toggle(s.onTop, 'data-set="onTop"', 'Always on top'))}
        ${row('Minimize on use', '', Win.toggle(s.minimizeOnUse, 'data-set="minimizeOnUse"', 'Minimize on use'))}
        <h3>Other options</h3>
        ${row('Show full account name', '', Win.toggle(s.fullName, 'data-set="fullName"', 'Show full account name'))}
        <div class="tm-about"><b>Task Manager</b><span class="muted">Version 10.0.26300.7019</span></div></div>`;
    };

    /* ------------------------------------------------------- rendering */

    const refresh = (force = false) => {
      if (win.closed) return;
      const procs = st.last || list();
      renderHead();
      const scroll = content.scrollTop;
      const p = st.page;
      if (p === 'processes') content.innerHTML = renderProcesses(procs);
      else if (p === 'performance') content.innerHTML = renderPerformance();
      else if (p === 'history') { if (force || !content.querySelector('table')) content.innerHTML = renderHistory(); }
      else if (p === 'startup') content.innerHTML = renderStartup();
      else if (p === 'users') content.innerHTML = renderUsers(procs);
      else if (p === 'details') content.innerHTML = renderDetails(procs);
      else if (p === 'services') content.innerHTML = renderServices();
      else if (p === 'settings') { if (force || !content.querySelector('.tm-settings')) content.innerHTML = renderSettings(); }
      content.scrollTop = scroll;
    };

    const tick = () => {
      if (win.closed || win.minimized || document.hidden) return;
      st.last = sample();
      const d = perfData(st.last);
      st.perfNow = d;
      const push = (k, v) => { st.hist[k].push(v); if (st.hist[k].length > 60) st.hist[k].shift(); };
      push('cpu', d.cpu); push('mem', d.mem); push('disk', d.disk); push('gpu', d.gpu); push('recv', d.recv); push('send', d.send);
      if (!['history', 'settings'].includes(st.page)) refresh();
    };

    let timer = null;
    const schedule = () => {
      clearInterval(timer);
      const ms = { high: 500, normal: 1000, low: 4000 }[S().speed];
      if (ms) timer = setInterval(tick, ms);
    };
    schedule();
    win.cleanup(() => clearInterval(timer));
    win.listen('windows', () => { st.last = list(); if (st.page !== 'performance' && st.page !== 'settings' && st.page !== 'history') refresh(); });
    win.listen('processes', () => { st.last = list(); refresh(); });
    win.listen('apps', () => { if (st.page === 'startup') refresh(true); });

    const go = page => {
      st.page = page;
      st.selected = null;
      st.sort = { key: null, dir: -1 };
      content.scrollTop = 0;
      refresh(true);
    };

    /* --------------------------------------------------------- events */

    root.querySelector('.tm-nav').addEventListener('click', e => {
      if (e.target.closest('.tm-ham')) {
        S().navOpen = !S().navOpen;
        root.classList.toggle('nav-open', S().navOpen);
        Win.save('taskmgr');
        return;
      }
      const b = e.target.closest('[data-page]');
      if (b) go(b.dataset.page);
    });

    head.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'run') runTask();
      if (act === 'end') endTask();
      if (act === 'eff') toggleEfficiency();
      if (act === 'enable') setStartup(st.selected, true);
      if (act === 'disable') setStartup(st.selected, false);
      if (act === 'clearhist') { refresh(true); Win.toast({ app: 'Task Manager', icon: 'taskmgr', title: 'Usage history deleted', transient: true }); }
      if (act.startsWith('svc-')) serviceAction(act.slice(4));
    });

    const serviceAction = verb => {
      const svc = st.services.find(x => x.name === st.selected);
      if (!svc) return;
      if (verb === 'stop') { svc.status = 'Stopped'; svc.pid = null; }
      if (verb === 'start' || verb === 'restart') { svc.status = 'Running'; svc.pid = 1200 + Math.floor(Math.random() * 9000); }
      refresh(true);
    };

    content.addEventListener('click', e => {
      const sortBtn = e.target.closest('th[data-sort]');
      if (sortBtn) {
        const k = sortBtn.dataset.sort;
        st.sort = st.sort.key === k ? { key: k, dir: -st.sort.dir } : { key: k, dir: k === 'name' ? -1 : -1 };
        refresh(true);
        return;
      }
      const exp = e.target.closest('[data-exp]');
      if (exp) {
        const k = exp.dataset.exp;
        if (st.expanded.has(k)) st.expanded.delete(k); else st.expanded.add(k);
        refresh(true);
        return;
      }
      const perf = e.target.closest('[data-perf]');
      if (perf) { st.perf = perf.dataset.perf; refresh(true); return; }
      const row = e.target.closest('tr[data-key]');
      if (row) {
        st.selected = row.dataset.key;
        if (row.dataset.key.startsWith('win:')) {
          const w = Win.wm.windows.find(x => `win:${x.id}` === row.dataset.key);
          void w;
        }
        refresh(true);
      }
    });

    content.addEventListener('dblclick', e => {
      const row = e.target.closest('tr[data-key]');
      if (!row) return;
      const k = row.dataset.key;
      if (k.startsWith('win:')) {
        const w = Win.wm.windows.find(x => `win:${x.id}` === k);
        if (w) { Win.wm.focus(w); if (S().minimizeOnUse) Win.wm.minimize(win); }
        return;
      }
      if (row.hasAttribute('aria-expanded')) {
        if (st.expanded.has(k)) st.expanded.delete(k); else st.expanded.add(k);
        refresh(true);
      }
    });

    content.addEventListener('contextmenu', e => {
      const row = e.target.closest('tr[data-key]');
      if (!row) return;
      e.preventDefault();
      st.selected = row.dataset.key;
      refresh(true);
      const k = row.dataset.key;
      if (st.page === 'services') {
        const svc = st.services.find(x => x.name === k);
        Win.menu(e.clientX, e.clientY, [
          { label: 'Start', disabled: svc.status === 'Running', action: () => serviceAction('start') },
          { label: 'Stop', disabled: svc.status !== 'Running', action: () => serviceAction('stop') },
          { label: 'Restart', disabled: svc.status !== 'Running', action: () => serviceAction('restart') },
          { divider: true },
          { label: 'Search online', glyph: 'search', action: () => Win.wm.open('edge', { url: `${svc.description} service` }) },
          { label: 'Go to details', disabled: !svc.pid, action: () => go('details') },
        ]);
        return;
      }
      if (st.page === 'startup') {
        const r = startupRows().find(x => x.key === k);
        Win.menu(e.clientX, e.clientY, [
          { label: r.enabled ? 'Disable' : 'Enable', action: () => setStartup(k, !r.enabled) },
          { label: 'Search online', glyph: 'search', action: () => Win.wm.open('edge', { url: r.name }) },
          { label: 'Properties', glyph: 'info', action: () => Win.alert(r.name, `Publisher: ${r.publisher}\nStartup impact: ${r.impact}`, win) },
        ]);
        return;
      }
      if (k.startsWith('win:')) {
        const w = Win.wm.windows.find(x => `win:${x.id}` === k);
        if (!w) return;
        Win.menu(e.clientX, e.clientY, [
          { label: 'Switch to', action: () => Win.wm.focus(w) },
          { label: 'Bring to front', action: () => Win.wm.focus(w) },
          { label: 'Minimize', glyph: 'minimize', action: () => Win.wm.minimize(w) },
          { label: 'Maximize', glyph: 'maximize', action: () => Win.wm.maximize(w) },
          { divider: true },
          { label: 'End task', action: () => Win.wm.close(w, { force: true }) },
        ]);
        return;
      }
      const p = selectedProc();
      if (!p) return;
      Win.menu(e.clientX, e.clientY, [
        p.kind === 'app' ? { label: st.expanded.has(k) ? 'Collapse' : 'Expand', action: () => { if (st.expanded.has(k)) st.expanded.delete(k); else st.expanded.add(k); refresh(true); } } : null,
        p.kind === 'app' ? { label: 'Switch to', action: () => Win.wm.focus(p.wins[0]) } : null,
        { label: p.image === 'explorer.exe' ? 'Restart' : 'End task', disabled: p.kind === 'child', action: endTask },
        { label: 'Efficiency mode', checked: p.efficiency, disabled: p.group === 'windows' || p.critical, action: toggleEfficiency },
        { divider: true },
        { label: 'Open file location', glyph: 'folder', action: () => Win.wm.open('explorer', { path: /msedge/i.test(p.image) ? 'c-edge' : 'c-system32' }) },
        { label: 'Search online', glyph: 'search', action: () => Win.wm.open('edge', { url: p.image }) },
        { label: 'Properties', glyph: 'info', action: () => Win.alert(`${p.image} Properties`, `${p.description || p.name}\nPID: ${p.pid}\nUser: ${p.user}`, win) },
        st.page === 'processes' ? { label: 'Go to details', action: () => { go('details'); st.selected = `pid:${p.pid}`; refresh(true); } } : null,
      ]);
    });

    content.addEventListener('keydown', e => {
      const rows = [...content.querySelectorAll('tr[data-key]')];
      if (!rows.length) return;
      const i = rows.findIndex(r => r.dataset.key === st.selected);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = rows[Win.clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1)];
        st.selected = next.dataset.key;
        refresh(true);
        content.querySelector(`tr[data-key="${CSS.escape(st.selected)}"]`)?.scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Delete' && st.page !== 'services' && st.page !== 'startup') endTask();
      if ((e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') && st.selected) {
        const row = rows[i];
        if (row?.hasAttribute('aria-expanded')) {
          const open = st.expanded.has(st.selected);
          if ((e.key === 'ArrowLeft' && open) || (e.key === 'ArrowRight' && !open) || e.key === 'Enter') {
            if (open) st.expanded.delete(st.selected); else st.expanded.add(st.selected);
            refresh(true);
          }
        }
      }
    });

    content.addEventListener('change', e => {
      const key = e.target.dataset.set;
      if (!key) return;
      S()[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      Win.save('taskmgr');
      if (key === 'speed') schedule();
      if (key === 'onTop') win.el.classList.toggle('tm-ontop', !!S().onTop);
    });

    search.addEventListener('input', Win.debounce(() => { st.query = search.value.trim().toLowerCase(); refresh(true); }, 120));
    search.addEventListener('keydown', e => { if (e.key === 'Escape') { search.value = ''; st.query = ''; refresh(true); } });

    win.el.addEventListener('keydown', e => {
      if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (e.ctrlKey && e.key.toLowerCase() === 'e')) { e.preventDefault(); search.focus(); search.select(); }
      if (e.key === 'F5') { e.preventDefault(); tick(); }
    });

    win.api = { go };
    st.last = sample();
    tick();
    refresh(true);
  }

  Win.apps.register({
    id: 'taskmgr', name: 'Task Manager', icon: 'taskmgr', single: true, customTitle: true,
    width: 960, height: 640, minWidth: 520, minHeight: 360, category: 'System', keywords: ['processes', 'performance', 'end task', 'startup'],
    create,
    reopen(win, args) { if (args?.page) win.api?.go(args.page); },
  });
})(window.Win);
