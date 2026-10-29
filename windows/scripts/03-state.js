/* ===========================================================================
   Default state and the virtual file system.

   This is the whole simulated PC as data. App modules may add their own
   top-level keys to Win.DefaultState before boot; the saved document is merged
   over the defaults, so new keys appear without discarding a user's files.
   Bump `schema` only when an existing shape changes incompatibly.
   =========================================================================== */

(function (Win) {
  'use strict';

  const DAY = 86400000;
  const now = Date.now();
  const P = Win.PERSONA;

  const text = (...lines) => lines.join('\r\n');

  const fs = [
    { id: 'c', name: 'Local Disk', kind: 'drive', parent: 'pc', letter: 'C', icon: 'windrive', capacity: 512e9 - 35e9, system: true },
    { id: 'c-users', name: 'Users', kind: 'folder', parent: 'c', system: true },
    { id: 'c-windows', name: 'Windows', kind: 'folder', parent: 'c', system: true },
    { id: 'c-system32', name: 'System32', kind: 'folder', parent: 'c-windows', system: true },
    { id: 'c-drivers', name: 'drivers', kind: 'folder', parent: 'c-system32', system: true },
    { id: 'c-etc', name: 'etc', kind: 'folder', parent: 'c-drivers', system: true },
    { id: 'f-hosts', name: 'hosts', kind: 'file', ext: '', parent: 'c-etc', system: true, modified: now - 200 * DAY,
      content: text('# Copyright (c) 1993-2009 Microsoft Corp.', '#', '# This is a sample HOSTS file used by Microsoft TCP/IP for Windows.', '#',
        '# localhost name resolution is handled within DNS itself.', '#\t127.0.0.1       localhost', '#\t::1             localhost', '') },
    { id: 'c-pf', name: 'Program Files', kind: 'folder', parent: 'c', system: true },
    { id: 'c-pf86', name: 'Program Files (x86)', kind: 'folder', parent: 'c', system: true },
    { id: 'c-edge', name: 'Microsoft', kind: 'folder', parent: 'c-pf86', system: true },
    { id: 'c-pd', name: 'ProgramData', kind: 'folder', parent: 'c', system: true, hidden: true },
    { id: 'c-public', name: 'Public', kind: 'folder', parent: 'c-users' },
    { id: 'home', name: P.user, kind: 'folder', parent: 'c-users' },
    { id: 'desktop', name: 'Desktop', kind: 'folder', parent: 'home', known: 'desktop' },
    { id: 'documents', name: 'Documents', kind: 'folder', parent: 'home', known: 'documents' },
    { id: 'downloads', name: 'Downloads', kind: 'folder', parent: 'home', known: 'downloads' },
    { id: 'pictures', name: 'Pictures', kind: 'folder', parent: 'home', known: 'pictures' },
    { id: 'music', name: 'Music', kind: 'folder', parent: 'home', known: 'music' },
    { id: 'videos', name: 'Videos', kind: 'folder', parent: 'home', known: 'videos' },
    { id: 'appdata', name: 'AppData', kind: 'folder', parent: 'home', hidden: true },
    { id: 'onedrive', name: 'OneDrive', kind: 'folder', parent: 'home', icon: 'onedrive' },
    { id: 'screenshots', name: 'Screenshots', kind: 'folder', parent: 'pictures' },
    { id: 'camera-roll', name: 'Camera Roll', kind: 'folder', parent: 'pictures' },
    { id: 'doc-projects', name: 'Projects', kind: 'folder', parent: 'documents' },
    { id: 'doc-receipts', name: 'Receipts', kind: 'folder', parent: 'documents' },

    { id: 'f-todo', name: 'To-do.txt', kind: 'file', ext: 'txt', parent: 'desktop', modified: now - 3 * 3600e3,
      content: text('Tuesday', '- Renew car registration', '- Order printer ink (HP 67)', '- Call the dentist back', '- Back up the Projects folder', '') },
    { id: 'f-wifi', name: 'Wi-Fi password.txt', kind: 'file', ext: 'txt', parent: 'desktop', modified: now - 9 * DAY,
      content: text('Home network: Sablewave Home', 'Password: sablewave', '', 'Guest network: Sablewave Guest (no password)', '') },
    { id: 'f-budget', name: 'Budget 2026.xlsx', kind: 'file', ext: 'xlsx', parent: 'documents', size: 48230, modified: now - 4 * DAY },
    { id: 'f-resume', name: 'Resume - Isaiah Souf.docx', kind: 'file', ext: 'docx', parent: 'documents', size: 61440, modified: now - 21 * DAY },
    { id: 'f-notes', name: 'Meeting notes.txt', kind: 'file', ext: 'txt', parent: 'documents', modified: now - 2 * DAY,
      content: text('Kickoff — Thursday', '', 'Attendees: Isaiah, Priya, Marcus', '', '* Launch moved to the 14th', '* Marcus owns the vendor contract', '* Next sync: Monday 10:00', '') },
    { id: 'f-plan', name: 'Garden plan.txt', kind: 'file', ext: 'txt', parent: 'doc-projects', modified: now - 30 * DAY,
      content: text('Raised bed A: tomatoes, basil', 'Raised bed B: peppers, onions', 'Border: marigolds', '') },
    { id: 'f-site', name: 'Website ideas.txt', kind: 'file', ext: 'txt', parent: 'doc-projects', modified: now - 12 * DAY,
      content: text('Portfolio site', '- gallery page', '- contact form', '- dark mode', '') },
    { id: 'f-receipt1', name: 'Laptop receipt.pdf', kind: 'file', ext: 'pdf', parent: 'doc-receipts', size: 182400, modified: now - 140 * DAY },
    { id: 'f-receipt2', name: 'Phone bill September.pdf', kind: 'file', ext: 'pdf', parent: 'doc-receipts', size: 96300, modified: now - 35 * DAY },
    { id: 'f-setup', name: 'PrinterSetup.exe', kind: 'file', ext: 'exe', parent: 'downloads', size: 38_400_000, modified: now - 6 * DAY },
    { id: 'f-zip', name: 'Photos from Sam.zip', kind: 'file', ext: 'zip', parent: 'downloads', size: 84_200_000, modified: now - 10 * DAY },
    { id: 'f-manual', name: 'Router manual.pdf', kind: 'file', ext: 'pdf', parent: 'downloads', size: 2_380_000, modified: now - 50 * DAY },
    { id: 'f-pic1', name: 'Lake sunset.jpg', kind: 'file', ext: 'jpg', parent: 'pictures', art: 'sunset', size: 3_420_000, modified: now - 40 * DAY },
    { id: 'f-pic2', name: 'Mountain trail.jpg', kind: 'file', ext: 'jpg', parent: 'pictures', art: 'mountain', size: 4_100_000, modified: now - 60 * DAY },
    { id: 'f-pic3', name: 'City at night.jpg', kind: 'file', ext: 'jpg', parent: 'camera-roll', art: 'city', size: 2_880_000, modified: now - 8 * DAY },
    { id: 'f-pic4', name: 'Beach day.jpg', kind: 'file', ext: 'jpg', parent: 'camera-roll', art: 'beach', size: 3_050_000, modified: now - 15 * DAY },
    { id: 'f-shot1', name: 'Screenshot 2026-10-21 141502.png', kind: 'file', ext: 'png', parent: 'screenshots', art: 'screenshot', size: 640_000, modified: now - 7 * DAY },
    { id: 'f-song', name: 'Morning playlist.mp3', kind: 'file', ext: 'mp3', parent: 'music', size: 7_340_000, modified: now - 90 * DAY },
    { id: 'f-video', name: 'Birthday clip.mp4', kind: 'file', ext: 'mp4', parent: 'videos', size: 112_000_000, modified: now - 70 * DAY },
    { id: 'f-od', name: 'Shared trip itinerary.txt', kind: 'file', ext: 'txt', parent: 'onedrive', modified: now - 5 * DAY,
      content: text('Day 1 — Fly out 8:15 AM', 'Day 2 — Hike, dinner at 7', 'Day 3 — Museum, fly home', '') },
    { id: 'f-old', name: 'Old notes.txt', kind: 'file', ext: 'txt', parent: 'bin', trashedFrom: 'documents', deletedAt: now - 3 * DAY, modified: now - 100 * DAY,
      content: 'These notes were deleted.\r\n' },

    { id: 'e', name: 'USB Drive', kind: 'drive', parent: 'pc', letter: 'E', icon: 'usb', capacity: 32e9, removable: true },
    { id: 'e-backup', name: 'Backup', kind: 'folder', parent: 'e' },
    { id: 'f-usb1', name: 'Tax documents 2025.pdf', kind: 'file', ext: 'pdf', parent: 'e-backup', size: 1_840_000, modified: now - 200 * DAY },
  ];

  Win.DefaultState = {
    schema: 1,
    session: { signedIn: true, locked: false },
    settings: {
      theme: 'light',           // 'light' | 'dark'
      appTheme: 'light',
      accent: '#0067c0',
      accentAuto: false,
      accentOnStart: false,
      accentOnTitle: false,
      transparency: true,
      wallpaper: 'bloom-light',
      wallpaperFit: 'Fill',
      solidColor: '#0063b1',
      lockWallpaper: 'lock',
      lockStatus: true,
      taskbarAlign: 'center',
      taskbarSearch: 'box',     // 'hidden' | 'icon' | 'box'
      showTaskView: true,
      showWidgets: true,
      autoHide: false,
      showBadges: true,
      showSeconds: false,
      time24: false,
      startLayout: 'default',   // 'default' | 'more-pins' | 'more-recs'
      startRecent: true,
      startRecommended: true,
      startTips: true,
      desktopIcons: true,
      iconSize: 'medium',
      brightness: 80,
      autoBrightness: false,
      nightLight: false,
      nightStrength: 48,
      scale: 100,
      resolution: '1920 × 1080',
      orientation: 'Landscape',
      refresh: 60,
      hdr: false,
      volume: 62,
      muted: false,
      output: 'Speakers (Realtek(R) Audio)',
      input: 'Microphone Array (Intel® Smart Sound)',
      micLevel: 70,
      systemSounds: true,
      bluetooth: true,
      batterySaver: false,
      batterySaverAuto: 20,
      powerMode: 'Balanced',
      screenOff: '5 minutes',
      sleepAfter: '15 minutes',
      notifications: true,
      dnd: false,
      location: true,
      camera: true,
      microphone: true,
      diagnostics: 'Required only',
      adId: false,
      findMyDevice: true,
      defender: { realtime: true, cloud: true, tamper: true, firewall: true, lastScan: now - DAY, threats: 0 },
      timezone: '(UTC-05:00) Eastern Time (US & Canada)',
      autoTime: true,
      autoZone: true,
      language: 'English (United States)',
      region: 'United States',
      keyboard: 'US',
      textSize: 100,
      animations: true,
      alwaysScroll: true,
      colorFilters: false,
      contrast: 'None',
      narrator: false,
      magnifier: false,
      stickyKeys: false,
      mouseSpeed: 10,
      primaryButton: 'Left',
      touchpad: true,
      tapToClick: true,
      gameMode: true,
      clipboardHistory: false,
      snap: true,
      endTask: false,
      developerMode: false,
      fileExtensions: false,
      hiddenFiles: false,
    },
    network: {
      airplane: false,
      wifi: true,
      connected: 'Sablewave Home',
      known: [
        { ssid: 'Sablewave Home', password: 'sablewave', auto: true, metered: false, randomMac: 'Off', profile: 'Private',
          ipMode: 'dhcp', ip: '', mask: '255.255.255.0', gateway: '', dnsMode: 'auto', dns: [], dnsEncryption: 'Unencrypted only' },
        { ssid: 'Riverside Library', password: '', auto: false, metered: false, randomMac: 'On', profile: 'Public',
          ipMode: 'dhcp', ip: '', mask: '255.255.255.0', gateway: '', dnsMode: 'auto', dns: [], dnsEncryption: 'Unencrypted only' },
      ],
      proxy: { autoDetect: true, useScript: false, script: '', manual: false, address: '', port: '', bypass: '', local: false },
      vpns: [{ name: 'Work VPN', server: 'vpn.support.example', type: 'Automatic', connected: false }],
      hotspot: false,
      adapterEnabled: { wifi: true, bluetoothPan: true },
      mobileDataNotice: false,
    },
    account: {
      name: P.name,
      email: P.email,
      microsoft: true,
      pin: Win.PIN,
      face: false,
      fingerprint: false,
      dynamicLock: false,
      requireSignIn: 'When PC wakes up from sleep',
      others: [{ name: 'Sam Souf', email: 'sam.souf@outlook.example', type: 'Family member' }],
    },
    taskbar: { pinned: ['explorer', 'edge', 'store', 'terminal', 'settings'] },
    start: { pinned: ['edge', 'explorer', 'settings', 'store', 'photos', 'notepad', 'calculator', 'clock', 'paint', 'terminal', 'taskmgr', 'snip', 'controlpanel', 'mail', 'weather', 'copilot'] },
    desktop: { positions: {}, sort: 'name' },
    recent: ['f-notes', 'f-todo', 'f-budget', 'f-pic3'],
    notifications: [
      { id: 'n1', app: 'Windows Security', icon: 'shield', title: 'Virus & threat protection', body: 'Quick scan finished. No current threats.', time: now - 26 * 3600e3 },
      { id: 'n2', app: 'OneDrive', icon: 'cloud', title: 'Your files are up to date', body: 'Shared trip itinerary.txt was synced.', time: now - 5 * 3600e3 },
    ],
    update: {
      lastChecked: now - 18 * 3600e3,
      status: 'available',      // 'uptodate' | 'available' | 'downloading' | 'ready' | 'restart'
      pausedUntil: 0,
      getLatest: false,
      activeHours: { start: 8, end: 17, auto: true },
      pending: [
        { id: 'KB5071482', title: '2026-10 Cumulative Update for Windows 11 Version 26H2 for x64-based Systems (KB5071482)', size: 812e6 },
        { id: 'KB2267602', title: 'Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.441.212.0)', size: 46e6 },
      ],
      history: [
        { id: 'KB5066835', title: '2026-09 Cumulative Update for Windows 11 Version 26H2 (KB5066835)', date: now - 34 * DAY, kind: 'Quality' },
        { id: 'KB5065789', title: 'Windows 11, version 26H2 Feature Update', date: now - 22 * DAY, kind: 'Feature' },
        { id: 'KB890830', title: 'Windows Malicious Software Removal Tool x64 - v5.137 (KB890830)', date: now - 34 * DAY, kind: 'Other' },
        { id: 'DRV-RT', title: 'Realtek Semiconductor Corp. - Extension - 11.0.6000.1145', date: now - 60 * DAY, kind: 'Driver' },
      ],
    },
    apps: [
      { id: 'edge', name: 'Microsoft Edge', publisher: 'Microsoft Corporation', size: 512e6, version: '141.0.3537.71', date: now - 3 * DAY, system: true },
      { id: 'onedrive', name: 'Microsoft OneDrive', publisher: 'Microsoft Corporation', size: 312e6, version: '25.194.1005.0001', date: now - 9 * DAY, startup: true },
      { id: 'teams', name: 'Microsoft Teams', publisher: 'Microsoft Corporation', size: 401e6, version: '25290.205.3925.8110', date: now - 30 * DAY, startup: true },
      { id: 'spotify', name: 'Spotify', publisher: 'Spotify AB', size: 288e6, version: '1.2.74.477', date: now - 45 * DAY, startup: true },
      { id: 'zoom', name: 'Zoom Workplace', publisher: 'Zoom Communications, Inc.', size: 254e6, version: '6.6.2', date: now - 70 * DAY, startup: false },
      { id: 'vlc', name: 'VLC media player', publisher: 'VideoLAN', size: 170e6, version: '3.0.21', date: now - 120 * DAY, startup: false },
      { id: 'hpsmart', name: 'HP Smart', publisher: 'HP Inc.', size: 96e6, version: '151.4.1253.0', date: now - 6 * DAY, startup: true },
      { id: 'steam', name: 'Steam', publisher: 'Valve Corporation', size: 1.2e9, version: '2.10.91.91', date: now - 200 * DAY, startup: false },
      { id: 'office', name: 'Microsoft 365 (Office)', publisher: 'Microsoft Corporation', size: 3.1e9, version: '16.0.19231.20156', date: now - 14 * DAY, system: false },
      { id: 'realtek', name: 'Realtek Audio Console', publisher: 'Realtek Semiconductor Corp', size: 22e6, version: '1.52.338.0', date: now - 300 * DAY },
    ],
    devices: [
      { id: 'mouse', name: 'Arc Mouse', kind: 'mouse', paired: true, connected: true, battery: 71 },
      { id: 'buds', name: 'Galaxy Buds2 Pro', kind: 'headphones', paired: true, connected: false },
      { id: 'printer', name: 'HP OfficeJet Pro 8025e', kind: 'printer', paired: true, connected: true, network: true },
      { id: 'phone', name: "Isaiah's Phone", kind: 'phone', paired: true, connected: false },
    ],
    clipboard: null,
    fs,
  };

  /* ------------------------------------------------------------ file system */

  const KNOWN = { desktop: 'desktop', documents: 'documents', downloads: 'downloads', pictures: 'pictures', music: 'music', videos: 'videos', home: 'home', onedrive: 'onedrive' };

  const nodes = () => Win.state.fs;

  Win.FS = {
    KNOWN,

    /** Virtual roots that are not real nodes. */
    roots: { pc: 'This PC', bin: 'Recycle Bin', home: 'Home', gallery: 'Gallery', network: 'Network' },

    get: id => nodes().find(n => n.id === id) || null,

    children(parent, { hidden = Win.state.settings.hiddenFiles } = {}) {
      return nodes().filter(n => n.parent === parent && (hidden || !n.hidden) && (n.kind !== 'drive' || !n.ejected));
    },

    /** Display name with optional extension per "File name extensions". */
    display(node) {
      if (!node) return '';
      if (node.kind === 'drive') return `${node.name} (${node.letter}:)`;
      if (node.kind !== 'file' || Win.state.settings.fileExtensions || !node.ext) return node.name;
      return node.name.replace(new RegExp(`\\.${node.ext}$`, 'i'), '');
    },

    /** Windows path, e.g. C:\Users\isaiah\Desktop. */
    path(id) {
      if (Win.FS.roots[id] && !Win.FS.get(id)) return Win.FS.roots[id];
      const parts = [];
      let node = Win.FS.get(id);
      while (node) {
        if (node.kind === 'drive') { parts.unshift(`${node.letter}:`); break; }
        parts.unshift(node.name);
        node = Win.FS.get(node.parent);
      }
      return parts.length === 1 ? `${parts[0]}\\` : parts.join('\\');
    },

    /** Resolve a Windows-style path (absolute or relative to cwd) to an id. */
    resolve(input, cwd = 'home') {
      let value = String(input || '').trim().replace(/^"|"$/g, '').replace(/\//g, '\\');
      if (!value) return cwd;
      value = value.replace(/%userprofile%/i, `C:\\Users\\${Win.PERSONA.user}`).replace(/^~/, `C:\\Users\\${Win.PERSONA.user}`);
      let current;
      let rest;
      const drive = value.match(/^([a-z]):\\?(.*)$/i);
      if (drive) {
        current = nodes().find(n => n.kind === 'drive' && n.letter.toLowerCase() === drive[1].toLowerCase() && !n.ejected)?.id;
        if (!current) return null;
        rest = drive[2];
      } else if (value.startsWith('\\')) {
        let root = Win.FS.get(cwd);
        while (root && root.kind !== 'drive') root = Win.FS.get(root.parent);
        current = root?.id || 'c';
        rest = value.slice(1);
      } else {
        current = cwd;
        rest = value;
      }
      for (const part of rest.split('\\').filter(Boolean)) {
        if (part === '.') continue;
        if (part === '..') {
          const node = Win.FS.get(current);
          if (node && node.kind !== 'drive') current = node.parent;
          continue;
        }
        const next = nodes().find(n => n.parent === current && n.name.toLowerCase() === part.toLowerCase());
        if (!next) return null;
        current = next.id;
      }
      return current;
    },

    isFolder: node => !!node && (node.kind === 'folder' || node.kind === 'drive'),

    /** "New folder (2)" style uniqueness, matching Explorer. */
    uniqueName(parent, name) {
      const taken = new Set(nodes().filter(n => n.parent === parent).map(n => n.name.toLowerCase()));
      if (!taken.has(name.toLowerCase())) return name;
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      for (let i = 2; ; i += 1) {
        const candidate = `${stem} (${i})${ext}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
      }
    },

    validName(name) {
      if (!name || !name.trim()) return 'A file name can\'t be empty.';
      if (/[\\/:*?"<>|]/.test(name)) return 'A file name can\'t contain any of the following characters: \\ / : * ? " < > |';
      if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name.trim())) return 'The specified device name is invalid.';
      return '';
    },

    create(parent, name, kind = 'file', props = {}) {
      const finalName = Win.FS.uniqueName(parent, name);
      const ext = kind === 'file' && finalName.includes('.') ? finalName.split('.').pop().toLowerCase() : '';
      const node = { id: Win.uid(kind === 'folder' ? 'd' : 'f'), name: finalName, kind, parent, ext, modified: Date.now(), created: Date.now(), ...props };
      if (kind === 'file' && node.content == null && ['txt', 'log', 'md', 'ini', 'bat', 'ps1', 'csv', ''].includes(ext) && !node.art) node.content = '';
      nodes().push(node);
      Win.save('fs');
      return node;
    },

    write(id, content) {
      const node = Win.FS.get(id);
      if (!node) return;
      node.content = content;
      node.modified = Date.now();
      Win.save('fs');
    },

    rename(id, name) {
      const node = Win.FS.get(id);
      if (!node) return 'The file no longer exists.';
      const problem = Win.FS.validName(name);
      if (problem) return problem;
      const clash = nodes().find(n => n.parent === node.parent && n.id !== id && n.name.toLowerCase() === name.toLowerCase());
      if (clash) return `There is already a file with the same name in this location.`;
      node.name = name;
      if (node.kind === 'file') node.ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
      node.modified = Date.now();
      Win.save('fs');
      return '';
    },

    descendants(id) {
      const out = [];
      const walk = parent => nodes().filter(n => n.parent === parent).forEach(n => { out.push(n); walk(n.id); });
      walk(id);
      return out;
    },

    contains(ancestor, id) {
      let node = Win.FS.get(id);
      while (node) { if (node.parent === ancestor) return true; node = Win.FS.get(node.parent); }
      return false;
    },

    size(id) {
      const node = Win.FS.get(id);
      if (!node) return 0;
      if (node.kind === 'file') return node.size ?? new Blob([node.content || '']).size;
      return Win.FS.descendants(id).filter(n => n.kind === 'file').reduce((sum, n) => sum + (n.size ?? new Blob([n.content || '']).size), 0);
    },

    /** Move to the Recycle Bin; removable drives delete permanently, as on Windows. */
    remove(id) {
      const node = Win.FS.get(id);
      if (!node || node.system || node.kind === 'drive') return false;
      if (Win.FS.onRemovable(id)) return Win.FS.purge(id);
      node.trashedFrom = node.parent;
      node.parent = 'bin';
      node.deletedAt = Date.now();
      Win.save('fs');
      return true;
    },

    restore(id) {
      const node = Win.FS.get(id);
      if (!node || node.parent !== 'bin') return;
      const target = Win.FS.get(node.trashedFrom) ? node.trashedFrom : 'desktop';
      node.name = Win.FS.uniqueName(target, node.name);
      node.parent = target;
      delete node.trashedFrom;
      delete node.deletedAt;
      Win.save('fs');
    },

    purge(id) {
      const gone = new Set([id, ...Win.FS.descendants(id).map(n => n.id)]);
      Win.state.fs = nodes().filter(n => !gone.has(n.id));
      Win.state.recent = Win.state.recent.filter(r => !gone.has(r));
      Win.save('fs');
      return true;
    },

    emptyBin() {
      Win.FS.children('bin', { hidden: true }).forEach(n => Win.FS.purge(n.id));
    },

    move(id, parent) {
      const node = Win.FS.get(id);
      if (!node || node.system || id === parent || Win.FS.contains(id, parent)) return false;
      if (node.parent === parent) return true;
      node.name = Win.FS.uniqueName(parent, node.name);
      node.parent = parent;
      node.modified = Date.now();
      Win.save('fs');
      return true;
    },

    copy(id, parent) {
      const node = Win.FS.get(id);
      if (!node || Win.FS.contains(id, parent) || id === parent) return null;
      const dupe = { ...Win.clone(node), id: Win.uid('f'), parent, name: Win.FS.uniqueName(parent, node.parent === parent ? copyName(node.name) : node.name), modified: Date.now() };
      delete dupe.system;
      nodes().push(dupe);
      for (const child of Win.FS.children(id, { hidden: true })) Win.FS.copy(child.id, dupe.id);
      Win.save('fs');
      return dupe;
    },

    onRemovable(id) {
      let node = Win.FS.get(id);
      while (node && node.kind !== 'drive') node = Win.FS.get(node.parent);
      return !!node?.removable;
    },

    driveOf(id) {
      let node = Win.FS.get(id);
      while (node && node.kind !== 'drive') node = Win.FS.get(node.parent);
      return node;
    },

    used(driveId) {
      const base = driveId === 'c' ? 286e9 : 6.2e9;
      return base + Win.FS.size(driveId);
    },

    touch(id) {
      Win.state.recent = [id, ...Win.state.recent.filter(r => r !== id)].slice(0, 12);
      Win.save('fs');
    },

    typeName(node) {
      if (!node) return '';
      if (node.kind === 'folder') return 'File folder';
      if (node.kind === 'drive') return node.removable ? 'Removable Disk' : 'Local Disk';
      const names = {
        txt: 'Text Document', pdf: 'Microsoft Edge PDF Document', docx: 'Microsoft Word Document', xlsx: 'Microsoft Excel Worksheet',
        jpg: 'JPG File', jpeg: 'JPEG File', png: 'PNG File', mp3: 'MP3 File', mp4: 'MP4 File', zip: 'Compressed (zipped) Folder',
        exe: 'Application', csv: 'Microsoft Excel Comma Separated Values File', bat: 'Windows Batch File', ps1: 'Windows PowerShell Script',
      };
      return names[node.ext] || (node.ext ? `${node.ext.toUpperCase()} File` : 'File');
    },
  };

  function copyName(name) {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} - Copy${name.slice(dot)}` : `${name} - Copy`;
  }
})(window.Win);
