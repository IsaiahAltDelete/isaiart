/* ===========================================================================
   System Settings.

   Panes are declared in `GROUPS` (which drives the sidebar, search and
   Spotlight) and rendered by a `panes` table. Sub-panes such as About,
   Software Update and Storage push onto a per-window stack so the back button
   behaves like the real app.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, appIcon, UI } = Mac;

  const GROUPS = [
    ['Family'],
    ['Wi-Fi', 'Bluetooth', 'Network', 'VPN'],
    ['Notifications', 'Sound', 'Focus', 'Screen Time'],
    ['General', 'Appearance', 'Menu Bar', 'Siri', 'Spotlight', 'Accessibility'],
    ['Desktop & Dock', 'Displays', 'Wallpaper', 'Screen Saver', 'Battery'],
    ['Lock Screen', 'Privacy & Security', 'Touch ID & Password', 'Users & Groups', 'Internet Accounts'],
    ['Keyboard', 'Trackpad', 'Mouse', 'Printers & Scanners'],
  ];

  const KEYWORDS = {
    'Apple Account': ['apple id', 'icloud', 'sign in', 'sign out', 'payment', 'two factor', 'subscriptions', 'devices'],
    'Family Sharing': ['family', 'children', 'purchase sharing', 'screen time'],
    'Wi-Fi': ['wireless', 'internet', 'network', 'password', 'dns', 'dhcp', 'ip address', 'captive'],
    Bluetooth: ['airpods', 'keyboard', 'mouse', 'pair', 'devices'],
    Network: ['ethernet', 'vpn', 'firewall', 'diagnostics', 'proxy', 'dns', 'tcp/ip'],
    VPN: ['vpn', 'tunnel', 'ikev2', 'remote'],
    Notifications: ['alerts', 'banners', 'badges', 'do not disturb'],
    Sound: ['volume', 'speakers', 'microphone', 'alert', 'output', 'input'],
    Focus: ['do not disturb', 'silence', 'work', 'sleep'],
    'Screen Time': ['usage', 'downtime', 'app limits', 'children'],
    General: ['about', 'software update', 'storage', 'date', 'time', 'language', 'sharing', 'reset', 'factory', 'erase', 'startup disk', 'time machine', 'login items', 'airdrop', 'handoff'],
    Appearance: ['dark mode', 'light', 'accent', 'highlight', 'sidebar'],
    Accessibility: ['voiceover', 'zoom', 'contrast', 'reduce motion', 'text size', 'pointer'],
    'Control Center': ['menu bar', 'modules', 'battery percentage'],
    'Siri & Spotlight': ['siri', 'spotlight', 'search', 'suggestions', 'dictation'],
    'Desktop & Dock': ['dock', 'magnification', 'hot corners', 'stage manager', 'mission control', 'windows', 'tiling'],
    Displays: ['resolution', 'brightness', 'night shift', 'true tone', 'refresh rate', 'mirroring'],
    Wallpaper: ['desktop picture', 'background'],
    'Screen Saver': ['saver', 'idle', 'lock'],
    Battery: ['energy', 'low power', 'charging', 'cycles', 'health'],
    'Lock Screen': ['password', 'login window', 'screen saver', 'require password'],
    'Privacy & Security': ['filevault', 'firewall', 'gatekeeper', 'location', 'analytics', 'lockdown'],
    'Users & Groups': ['accounts', 'guest', 'admin', 'login'],
    'Internet Accounts': ['mail', 'exchange', 'google', 'add account'],
    Keyboard: ['shortcuts', 'brightness', 'repeat', 'input sources'],
    Trackpad: ['tap to click', 'gestures', 'scroll', 'force click'],
    Mouse: ['tracking', 'scroll', 'secondary click'],
    'Printers & Scanners': ['printer', 'scanner', 'add printer', 'queue'],
  };

  const Settings = Mac.Settings = {
    groups: GROUPS,

    paneNames() { return GROUPS.flat(); },

    keywords(name) { return KEYWORDS[name] || []; },

    /* ------------------------------------------------------------ rendering */

    render(win) {
      const query = (win.state.query || '').trim().toLowerCase();
      let groups = GROUPS;

      if (query) {
        const matches = this.paneNames().filter(name =>
          name.toLowerCase().includes(query) || this.keywords(name).some(term => term.includes(query)));
        groups = [matches];
        if (matches.length === 1 && win.state.pane !== matches[0]) {
          win.state.pane = matches[0];
          win.state.stack = [];
        }
      }

      const account = Mac.state.account;

      return `<div class="app-shell settings-shell">
        <aside class="sidebar">
          <div class="search"><span>${glyph('search')}</span>
            <input data-settings-search value="${esc(win.state.query || '')}" placeholder="Search" aria-label="Search settings"></div>
          <button class="account-chip ${account.signedIn ? '' : 'signed-out'}" data-settings-pane="Apple Account">
            ${UI.avatar(account.name, { size: 'small', initials: account.initials })}
            <div><strong>${esc(account.signedIn ? account.name : 'Sign in with your Apple Account')}</strong>
              <small>${esc(account.signedIn ? account.email : 'Set up iCloud, the App Store and more')}</small></div>
          </button>
          ${groups.map((group, index) => `<div class="settings-list ${index && !query ? 'settings-group-gap' : ''}">
            ${group.map(name => `<button class="side-item ${win.state.pane === name ? 'on' : ''}" data-settings-pane="${esc(name)}">
              ${Mac.paneIcon(name)}<span class="side-label">${esc(name)}</span></button>`).join('')}</div>`).join('')}
          ${query && !groups.flat().length ? `<p class="muted" style="padding:12px;font-size:11.5px">No settings match “${esc(win.state.query)}”.</p>` : ''}
        </aside>
        <section class="main-pane"><div class="pane-scroll">${this.body(win)}</div></section>
      </div>`;
    },

    body(win) {
      const sub = win.state.stack[win.state.stack.length - 1];
      if (sub) {
        const renderer = this.subPanes[sub];
        return `<div class="pane-pad">
          <button class="btn" data-command="settings-back" style="margin-bottom:14px">${glyph('back', { size: 13 })} ${esc(win.state.pane)}</button>
          ${renderer ? renderer.call(this, win) : UI.empty(sub, '')}</div>`;
      }
      const renderer = this.panes[win.state.pane];
      return `<div class="pane-pad">${renderer ? renderer.call(this, win) : this.fallback(win.state.pane)}</div>`;
    },

    push(win, sub) {
      win.state.stack.push(sub);
      Mac.wm.render(win);
    },

    back(win) {
      win.state.stack.pop();
      Mac.wm.render(win);
    },

    open(name, sub = null) {
      const win = Mac.wm.open('settings');
      if (!win) return null;
      win.state.pane = name;
      win.state.query = '';
      win.state.stack = sub ? [sub] : [];
      Mac.wm.render(win);
      return win;
    },

    fallback(name) {
      return `${UI.header(name)}${UI.group(
        UI.toggle(`Enable ${name}`, `settings.${name.toLowerCase().replace(/\W/g, '')}`, `Configure ${name.toLowerCase()} for this Mac.`),
      )}`;
    },

    /* ------------------------------------------------------------ main panes */

    panes: {
      'Apple Account'(win) { return Mac.Account.render(win); },

      'Family Sharing'() { return Mac.Account.familyPane(); },

      'Wi-Fi'() {
        const wifi = Mac.state.wifi;
        const others = Mac.NETWORKS.filter(network => network.name !== wifi.current);

        if (!wifi.enabled) {
          return `${UI.header('Wi-Fi', 'Wi-Fi is off')}
            ${UI.group(UI.toggle('Wi-Fi', 'wifi.enabled', 'Turn wireless networking on or off.', { command: 'wifi-sync' }))}
            ${UI.empty('Wi-Fi is turned off', 'Turn on Wi-Fi to see the networks in range and reconnect to the internet.', {
              icon: 'wifi-off',
              action: '<button class="btn primary" data-command="wifi-toggle">Turn On Wi-Fi</button>',
            })}`;
        }

        return `${UI.header('Wi-Fi', wifi.current ? `Connected to ${esc(wifi.current)}` : 'Not connected to a network')}
          ${UI.group(
            UI.toggle('Wi-Fi', 'wifi.enabled', '', { command: 'wifi-sync' }),
            wifi.current ? `<div class="row">${UI.signal(4)}
              <div class="row-text"><strong>${esc(wifi.current)}</strong>
                <p>${wifi.captive ? 'Connected — sign-in required' : 'Connected'}</p></div>
              <div class="row-action"><span class="badge ${wifi.captive ? 'warn' : 'ok'}">${wifi.captive ? 'No Internet' : 'Internet'}</span>
                <button class="btn" data-command="wifi-details">Details…</button></div></div>` : '',
          )}
          <div class="section-title">Other Networks</div>
          <div class="group">${others.map(network => `<div class="network-row">
              ${UI.signal(network.bars)}
              <div class="network-copy"><strong>${esc(network.name)}</strong>
                <small>${esc(network.security)}${network.captive ? ' — sign-in required' : ''}${network.unavailable ? ' — temporarily unavailable' : ''} · ${esc(network.band)}</small></div>
              <button class="btn" data-command="wifi-join" data-arg="${esc(network.name)}">${Mac.state.wifi.saved.includes(network.name) ? 'Connect' : 'Join'}</button>
            </div>`).join('')}
            <div class="network-row"><span class="signal" data-bars="0"><i></i><i></i><i></i><i></i></span>
              <div class="network-copy"><strong>Other…</strong><small>Join a hidden network</small></div>
              <button class="btn" data-command="wifi-hidden">Other…</button></div>
          </div>
          ${UI.group(
            UI.select('Ask to join networks', 'settings.askToJoin', ['Off', 'Notify', 'Ask']),
            UI.action('Known Networks', 'wifi-known', `${Mac.plural(wifi.saved.length, 'network')} saved`),
            UI.action('Network Diagnostics', 'run-diagnostics', 'Test the interface, address, DNS and reachability.'),
          )}`;
      },

      Bluetooth() {
        const on = Mac.state.settings.bluetooth;
        return `${UI.header('Bluetooth', on ? `Discoverable as “${esc(Mac.state.settings.computerName)}”` : 'Bluetooth is off')}
          ${UI.group(UI.toggle('Bluetooth', 'settings.bluetooth'))}
          ${on ? `<div class="section-title">My Devices</div>
            <div class="group">${Mac.state.bluetoothDevices.map(device => `<div class="row">
              ${Mac.paneIcon(device.kind === 'Keyboard' ? 'Keyboard' : device.kind === 'Mouse' ? 'Mouse' : 'Sound', 'size-28')}
              <div class="row-text"><strong>${esc(device.name)}</strong>
                <p>${device.connected ? 'Connected' : 'Not connected'}${device.battery != null ? ` — battery ${device.battery}%` : ''}</p></div>
              <div class="row-action">${device.connected ? '<span class="badge ok">Connected</span>' : ''}
                <button class="btn" data-command="bluetooth-toggle" data-arg="${device.id}">${device.connected ? 'Disconnect' : 'Connect'}</button></div></div>`).join('')}</div>
            ${UI.group(UI.toggle('Show Bluetooth in the menu bar', 'settings.showBluetoothMenu'))}`
            : UI.empty('Bluetooth is off', 'Turn on Bluetooth to connect the Magic Keyboard, Magic Mouse or AirPods.', { icon: 'bluetooth' })}`;
      },

      Network() {
        const wifi = Mac.state.wifi;
        const ethernet = Mac.state.ethernet;
        const vpn = Mac.state.vpn;
        return `${UI.header('Network', 'Every network service on this Mac.')}
          ${UI.group(
            `<button class="row tappable" data-settings-pane="Wi-Fi">${Mac.paneIcon('Wi-Fi', 'size-28')}
              <div class="row-text"><strong>Wi-Fi</strong>
                <p>${wifi.enabled ? (wifi.current ? `${esc(wifi.current)} — ${wifi.captive ? 'sign-in required' : 'connected'}` : 'Not connected') : 'Off'}</p></div>
              <div class="row-action"><span class="badge ${wifi.current && !wifi.captive ? 'ok' : 'bad'}">${wifi.current && !wifi.captive ? 'Connected' : 'Inactive'}</span>
                <span class="chevron">${glyph('chevron', { size: 13 })}</span></div></button>`,
            `<div class="row">${Mac.paneIcon('Network', 'size-28')}
              <div class="row-text"><strong>Ethernet</strong><p>${ethernet.cable ? 'Cable connected' : 'Cable unplugged'}</p></div>
              <div class="row-action"><span class="badge ${ethernet.connected ? 'ok' : ''}">${ethernet.connected ? 'Connected' : 'Not Connected'}</span>
                <button class="btn" data-command="ethernet-toggle">${ethernet.cable ? 'Unplug' : 'Plug In'}</button></div></div>`,
            `<div class="row">${Mac.paneIcon('VPN', 'size-28')}
              <div class="row-text"><strong>VPN</strong><p>${vpn.configured ? esc(vpn.name) : 'No configurations'}</p></div>
              <div class="row-action">${vpn.configured
                ? `<button class="switch ${vpn.connected ? 'on' : ''}" data-command="vpn-toggle" aria-label="VPN"></button>`
                : '<button class="btn" data-command="vpn-add">Add Configuration…</button>'}</div></div>`,
          )}
          <div class="section-title">Services</div>
          ${UI.group(
            UI.toggle('Firewall', 'settings.firewall', 'Block unwanted incoming connections.'),
            UI.toggle('Use a proxy server', 'wifi.proxy', 'A misconfigured proxy is a common cause of “Safari can’t connect”.'),
            UI.action('Network Diagnostics', 'run-diagnostics', 'Run the full five-stage network test.'),
            UI.action('Renew DHCP Lease', 'renew-dhcp', wifi.current ? `Current address ${wifi.ip}` : 'Requires a joined network'),
            UI.action('Details…', 'wifi-details', 'TCP/IP, DNS, and Proxies'),
            UI.action('Reset Network Settings', 'reset-network', 'Forget every saved network and restore defaults.'),
          )}`;
      },

      VPN() {
        const vpn = Mac.state.vpn;
        return `${UI.header('VPN', vpn.configured ? esc(vpn.name) : 'No VPN configurations')}
          ${vpn.configured ? UI.group(
            UI.info('Configuration', vpn.name),
            UI.info('Status', vpn.connected ? 'Connected' : 'Not connected', '',
              `<button class="switch ${vpn.connected ? 'on' : ''}" data-command="vpn-toggle" aria-label="VPN"></button>`),
            UI.info('Server', 'vpn.support.example'),
            UI.info('Type', 'IKEv2'),
            UI.action('Remove Configuration', 'vpn-remove', ''),
          ) : UI.empty('No VPN configurations', 'Add a configuration to practise VPN-related connectivity problems.', {
            icon: 'vpn',
            action: '<button class="btn primary" data-command="vpn-add">Add VPN Configuration…</button>',
          })}`;
      },

      Notifications() {
        const apps = ['mail', 'outlook', 'messages', 'safari', 'appstore', 'calendar', 'time-machine']
          .filter(id => Mac.state.installedApps.includes(id));
        return `${UI.header('Notifications')}
          ${UI.group(
            UI.toggle('Allow notifications', 'settings.notifications'),
            UI.toggle('Show previews', 'settings.notificationPreviews'),
            UI.toggle('Badge app icons', 'settings.notificationBadges'),
          )}
          <div class="section-title">Application Notifications</div>
          <div class="group">${apps.map(id => `<button class="row tappable" data-command="notification-app" data-arg="${id}">
            <span class="store-row-app" style="width:28px;height:28px">${appIcon(Mac.apps[id].icon)}</span>
            <div class="row-text"><strong>${esc(Mac.apps[id].title)}</strong><p>Banners, sounds, badges</p></div>
            <span class="chevron">${glyph('chevron', { size: 13 })}</span></button>`).join('')}</div>
          ${UI.group(UI.action('Clear Notification Centre', 'clear-notifications',
            `${Mac.plural(Mac.state.notifications.length, 'notification')} stored`))}`;
      },

      Sound() {
        const s = Mac.state.settings;
        return `${UI.header('Sound')}
          <div class="section-title">Output</div>
          ${UI.group(
            `<div class="row">${Mac.paneIcon('Sound', 'size-28')}
              <div class="row-text"><strong>MacBook Pro Speakers</strong><p>Built-in</p></div>
              <span class="badge ok">Selected</span></div>`,
            UI.slider('Output volume', 'settings.volume', { description: s.muted ? 'Muted' : '' }),
            UI.toggle('Mute', 'settings.muted', '', { command: 'volume-hud' }),
          )}
          <div class="section-title">Sound Effects</div>
          ${UI.group(
            UI.slider('Alert volume', 'settings.alertVolume'),
            UI.toggle('Play user interface sound effects', 'settings.soundEffects'),
            UI.toggle('Play sound on startup', 'settings.startupChime'),
          )}
          <div class="section-title">Input</div>
          ${UI.group(
            `<div class="row">${Mac.paneIcon('Sound', 'size-28')}
              <div class="row-text"><strong>MacBook Pro Microphone</strong><p>Built-in — input level nominal</p></div>
              <span class="badge ok">Selected</span></div>`,
          )}`;
      },

      Focus() {
        const s = Mac.state.settings;
        return `${UI.header('Focus', 'Silence notifications while you work.')}
          ${UI.group(
            UI.toggle('Focus', 'settings.focus', 'Notifications are held in Notification Centre while Focus is on.'),
            UI.select('Focus mode', 'settings.focusMode', ['Do Not Disturb', 'Work', 'Personal', 'Sleep', 'Driving']),
          )}
          ${UI.group(
            UI.info('Schedule', '09:00 to 17:00, weekdays'),
            UI.info('Allowed notifications', 'Favorites and time-sensitive alerts'),
            UI.action('Share across devices', 'generic', 'Focus turns on for every device signed into this account.'),
          )}
          ${s.focus ? '<p class="section-note">Focus is on — banners are suppressed but still recorded in Notification Centre.</p>' : ''}`;
      },

      'Screen Time'() {
        const usage = [
          ['Mon', 62], ['Tue', 78], ['Wed', 54], ['Thu', 91], ['Fri', 70], ['Sat', 24], ['Sun', 18],
        ];
        const peak = Math.max(...usage.map(([, value]) => value));
        return `${UI.header('Screen Time', 'Usage for this Mac over the last week.')}
          ${UI.group(UI.toggle('App & Website Activity', 'settings.screenTime'))}
          ${Mac.state.settings.screenTime ? `<div class="group"><div class="row block">
              <strong style="font-size:12.5px">Daily average — 62 minutes</strong>
              <div class="usage-chart">${usage.map(([day, value]) => `<div class="usage-bar">
                <i style="height:${(value / peak) * 76}px"></i><span>${day}</span></div>`).join('')}</div></div></div>
            ${UI.group(
              UI.action('App Limits', 'generic', 'Set daily time limits per app.'),
              UI.action('Downtime', 'generic', 'Schedule time away from the screen.'),
              UI.action('Content & Privacy', 'generic', 'Restrict content and purchases.'),
            )}`
            : UI.empty('Screen Time is off', 'Turn on App & Website Activity to record usage on this Mac.', { icon: 'screen-time' })}`;
      },

      General(win) {
        return `${UI.header('General')}
          ${UI.group(
            UI.action('About', 'settings-sub', `${Mac.state.settings.computerName} — macOS ${Mac.OS.version()}`, '', { arg: 'About' }),
            UI.action('Software Update', 'settings-sub', Mac.state.settings.autoUpdates ? 'Automatic updates on' : 'Automatic updates off', 'Up to date', { arg: 'Software Update' }),
            UI.action('Storage', 'settings-sub', '', Mac.bytes(Mac.state.volumes[0].totalBytes - Mac.state.volumes[0].usedBytes) + ' free', { arg: 'Storage' }),
          )}
          ${UI.group(
            UI.action('AirDrop & Handoff', 'settings-sub', '', Mac.state.settings.airdropVisibility, { arg: 'AirDrop & Handoff' }),
            UI.action('Login Items & Extensions', 'settings-sub', '', '3 items', { arg: 'Login Items' }),
            UI.action('Sharing', 'settings-sub', Mac.state.settings.computerName, '', { arg: 'Sharing' }),
            UI.action('Time Machine', 'open-app', 'Back up and restore this Mac', '', { arg: 'time-machine' }),
            UI.action('Startup Disk', 'settings-sub', 'Macintosh HD', '', { arg: 'Startup Disk' }),
          )}
          ${UI.group(
            UI.action('Language & Region', 'settings-sub', '', Mac.state.settings.language, { arg: 'Language & Region' }),
            UI.action('Date & Time', 'settings-sub', '', Mac.state.settings.autoTimezone ? 'Set automatically' : 'Manual', { arg: 'Date & Time' }),
          )}
          ${UI.group(
            UI.action('Transfer or Reset', 'settings-sub', 'Migration Assistant and Erase All Content and Settings', '', { arg: 'Transfer or Reset' }),
          )}`;
      },

      Appearance() {
        const s = Mac.state.settings;
        const modes = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']];
        return `${UI.header('Appearance')}
          <div class="group"><div class="row block">
            <div class="row-text"><strong>Appearance</strong></div>
            <div class="choice-grid" style="margin-top:10px">${modes.map(([id, label]) =>
              `<button class="choice ${s.appearance === id ? 'on' : ''}" data-command="set-appearance" data-arg="${id}">
                <div class="appearance-art ${id}">${glyph(id === 'dark' ? 'moon' : id === 'auto' ? 'appearance' : 'sun', { size: 20 })}</div>
                <strong>${label}</strong></button>`).join('')}</div>
          </div>
          <div class="row"><div class="row-text"><strong>Accent color</strong></div>
            <div class="row-action swatch-row">${Object.entries(Mac.ACCENTS).map(([name, [color]]) =>
              `<button class="swatch ${s.accent === name ? 'on' : ''}" style="background:${color}"
                data-command="set-accent" data-arg="${name}" aria-label="${name} accent"></button>`).join('')}</div></div>
          ${UI.select('Highlight color', 'settings.highlight', ['accent', 'blue', 'purple', 'pink', 'graphite'])}
          </div>
          ${UI.group(
            UI.toggle('Tinted menu bar', 'settings.menuBarTinted', 'Adds a translucent backing behind the menu bar.'),
            UI.toggle('Automatically hide and show the menu bar', 'settings.autoHideMenuBar'),
            UI.slider('Text size', 'settings.textScale', { min: 0.9, max: 1.3, step: 0.05, suffix: '×' }),
          )}`;
      },

      Accessibility() {
        return `${UI.header('Accessibility', 'Customize your Mac to work the way you do.')}
          <div class="section-title">Vision</div>
          ${UI.group(
            UI.toggle('Increase contrast', 'settings.increaseContrast'),
            UI.toggle('Reduce transparency', 'settings.reduceTransparency', 'Replaces the vibrancy materials with solid surfaces.'),
            UI.toggle('Reduce motion', 'settings.reduceMotion', 'Removes window and Dock animation.'),
            UI.slider('Text size', 'settings.textScale', { min: 0.9, max: 1.3, step: 0.05, suffix: '×' }),
          )}
          <div class="section-title">Hearing</div>
          ${UI.group(
            UI.toggle('Play stereo audio as mono', 'settings.monoAudio'),
            UI.toggle('Flash the screen for alerts', 'settings.flashAlerts'),
          )}
          <div class="section-title">Motor</div>
          ${UI.group(
            UI.toggle('Full keyboard access', 'settings.fullKeyboardAccess'),
            UI.toggle('Shake pointer to locate', 'settings.pointerShake'),
            UI.toggle('Sticky keys', 'settings.stickyKeys'),
          )}
          <p class="section-note">Reduce motion and increase contrast also honour your operating system preferences automatically.</p>`;
      },

      'Control Center'() {
        return `${UI.header('Control Center', 'Choose which modules appear in the menu bar.')}
          ${UI.group(
            UI.toggle('Wi-Fi in the menu bar', 'settings.showWifiMenu'),
            UI.toggle('Bluetooth in the menu bar', 'settings.showBluetoothMenu'),
            UI.toggle('Battery percentage', 'settings.showBatteryPercent'),
          )}
          ${UI.group(
            UI.toggle('Show Focus in the menu bar', 'settings.focusInMenuBar'),
            UI.toggle('Show Screen Mirroring in the menu bar', 'settings.mirroringInMenuBar'),
            UI.toggle('Show Now Playing in the menu bar', 'settings.nowPlayingInMenuBar'),
          )}
          ${UI.group(UI.select('Clock format', 'settings.time24', ['false', 'true']))}
          <p class="section-note">The clock format switch takes 24-hour time when set to true.</p>`;
      },

      'Siri & Spotlight'() {
        return `${UI.header('Siri & Spotlight')}
          ${UI.group(
            UI.toggle('Ask Siri', 'settings.siri'),
            UI.toggle('Listen for “Siri”', 'settings.listenForSiri'),
          )}
          ${UI.group(
            UI.toggle('Spotlight suggestions', 'settings.spotlightSuggestions', 'Include apps, settings, files, mail and notes in results.'),
            UI.action('Search Results…', 'generic', 'Choose which categories Spotlight searches.'),
            UI.action('Spotlight Privacy…', 'generic', 'Exclude folders from search.'),
          )}
          <p class="section-note">Press Command-Space at any time to open Spotlight. It searches apps, settings, files, mail, notes and system actions, and evaluates arithmetic and unit conversions.</p>`;
      },

      'Desktop & Dock'() {
        const s = Mac.state.settings;
        return `${UI.header('Desktop & Dock')}
          <div class="section-title">Dock</div>
          ${UI.group(
            UI.slider('Size', 'settings.dockSize', { min: 40, max: 72, suffix: 'px' }),
            UI.select('Position on screen', 'settings.dockPosition', ['bottom', 'left', 'right']),
            UI.toggle('Magnification', 'settings.dockMagnification'),
            UI.toggle('Automatically hide and show the Dock', 'settings.dockAutoHide'),
            UI.toggle('Animate opening applications', 'settings.animateOpening'),
            UI.toggle('Show suggested and recent apps in the Dock', 'settings.dockRecents'),
          )}
          <div class="section-title">Desktop & Stage Manager</div>
          ${UI.group(
            UI.toggle('Click wallpaper to reveal desktop', 'settings.clickWallpaper'),
            UI.toggle('Stage Manager', 'settings.stageManager'),
            UI.toggle('Automatically rearrange Spaces', 'settings.spacesRearrange'),
          )}
          <div class="section-title">Windows</div>
          ${UI.group(
            UI.action('Show Mission Control', 'mission-control', 'See every window and desktop at once (F3).'),
            UI.action('Tile window left', 'tile', 'Drag a window to a screen edge to tile it.', '', { arg: 'left' }),
            UI.action('Tile window right', 'tile', '', '', { arg: 'right' }),
            UI.action('Fill screen', 'tile', '', '', { arg: 'fill' }),
            UI.action('Add a desktop', 'add-space', `${Mac.plural(Mac.state.spaces.length, 'desktop')} in use`),
          )}
          <p class="section-note">Dragging a window to an edge previews the tile; the top edge fills the screen and the corners tile in quarters.</p>`;
      },

      Displays() {
        const s = Mac.state.settings;
        return `${UI.header('Displays', 'Built-in Liquid Retina XDR — 3024 × 1964')}
          ${UI.group(
            `<div class="row">${Mac.paneIcon('Displays', 'size-28')}
              <div class="row-text"><strong>Built-in Display</strong><p>Main display — 120 Hz ProMotion</p></div>
              <span class="badge ok">Active</span></div>`,
            UI.slider('Brightness', 'settings.brightness', { min: 12, max: 100 }),
            UI.toggle('Automatically adjust brightness', 'settings.autoBrightness'),
            UI.toggle('True Tone', 'settings.trueTone'),
            UI.toggle('Night Shift', 'settings.nightShift', 'Warms the display colors.'),
          )}
          ${UI.group(
            UI.select('Resolution', 'settings.displayResolution', ['Larger Text', 'Default for display', 'More Space']),
            UI.select('Refresh rate', 'settings.refreshRate', ['ProMotion', '60 Hz', '48 Hz']),
            UI.action('Detect Displays', 'detect-displays', 'Look for an attached external display.'),
            UI.action('Screen Mirroring', 'generic', 'No AirPlay receivers found.'),
          )}`;
      },

      Wallpaper() {
        const current = Mac.state.settings.wallpaper;
        return `${UI.header('Wallpaper', 'Choose a desktop picture. Dynamic wallpapers follow the appearance setting.')}
          <div class="choice-grid">${Mac.WALLPAPERS.map(wallpaper =>
            `<button class="choice ${current === wallpaper.id ? 'on' : ''}" data-command="set-wallpaper" data-arg="${wallpaper.id}">
              <div class="choice-art" style="background-image:url('assets/wallpapers/${wallpaper.id}.svg')"></div>
              <strong>${esc(wallpaper.name)}</strong>
              <small class="muted" style="font-size:10.5px">${esc(wallpaper.kind)}</small></button>`).join('')}</div>
          ${UI.group(
            UI.toggle('Use the dark variant in Dark Mode', 'settings.wallpaperDarkAuto'),
            UI.toggle('Show on all Spaces', 'settings.wallpaperAllSpaces'),
          )}`;
      },

      'Screen Saver'() {
        return `${UI.header('Screen Saver')}
          ${UI.group(
            UI.select('Screen saver', 'settings.screenSaver', ['Drift', 'Flurry', 'Hello', 'Word of the Day', 'None']),
            UI.select('Start after', 'settings.screenSaverAfter', ['1 minute', '2 minutes', '5 minutes', '10 minutes', '20 minutes', 'Never']),
            UI.action('Show Screen Saver Now', 'power', '', '', { arg: 'sleep' }),
          )}
          ${UI.group(UI.action('Lock Screen settings', 'settings-pane', 'Choose when a password is required.', '', { arg: 'Lock Screen' }))}`;
      },

      Battery() {
        const battery = Mac.state.battery;
        const peak = Math.max(...battery.history);
        return `${UI.header('Battery', `${battery.percent}% — ${battery.charging ? 'charging' : `${battery.timeRemaining} remaining`}`)}
          <div class="group"><div class="row block">
            <div class="row-text"><strong>Last 24 hours</strong></div>
            <div class="usage-chart">${battery.history.map((value, index) => `<div class="usage-bar">
              <i style="height:${(value / peak) * 76}px"></i><span>${index * 3}h</span></div>`).join('')}</div></div></div>
          ${UI.group(
            UI.toggle('Low Power Mode', 'settings.lowPowerMode', 'Reduces background activity and display brightness.'),
            UI.toggle('Slightly dim the display on battery', 'settings.dimOnBattery'),
            UI.toggle('Optimized battery charging', 'settings.optimizedCharging'),
            UI.toggle('Prevent sleeping when the display is off', 'settings.preventSleepDisplayOff'),
          )}
          ${UI.group(
            UI.info('Battery health', battery.health, `Maximum capacity ${battery.capacity}%`,
              `<span class="badge ok">${esc(battery.health)}</span>`),
            UI.info('Cycle count', String(battery.cycles)),
            UI.info('Temperature', battery.temperature),
            UI.info('Power source', battery.charging ? 'Power adapter' : 'Battery', '',
              `<button class="btn" data-command="toggle-charging">${battery.charging ? 'Disconnect' : 'Connect adapter'}</button>`),
          )}`;
      },

      'Lock Screen'() {
        const s = Mac.state.settings;
        const times = ['1 minute', '2 minutes', '5 minutes', '10 minutes', '20 minutes', 'Never'];
        return `${UI.header('Lock Screen', 'Choose when the display sleeps and what appears at login.')}
          ${UI.group(
            UI.select('Turn display off on battery when inactive', 'settings.displayOffBattery', times),
            UI.select('Turn display off on power adapter when inactive', 'settings.displayOffPower', times),
            UI.select('Require password after the display turns off', 'settings.lockAfter',
              ['Immediately', '5 seconds', '1 minute', '5 minutes', '15 minutes', '1 hour']),
          )}
          ${UI.group(
            UI.toggle('Show large clock', 'settings.largeLockClock'),
            UI.toggle('Show password hints', 'settings.passwordHints'),
            UI.toggle('Show a message when locked', 'settings.showLockMessage'),
            `<div class="row"><div class="row-text"><strong>Lock screen message</strong>
              <p>Visible to anyone at the login window.</p></div>
              <div class="row-action"><input class="field" style="width:240px" data-lock-message
                value="${esc(s.lockMessage)}" ${s.showLockMessage ? '' : 'disabled'}></div></div>`,
            UI.select('Login window shows', 'settings.loginWindowShows', ['List of users', 'Name and password']),
            UI.toggle('Show the Sleep, Restart and Shut Down buttons', 'settings.showPowerButtons'),
          )}
          ${UI.group(UI.action('Lock Screen Now', 'power', 'Control-Command-Q', '', { arg: 'lock' }))}`;
      },

      'Privacy & Security'() {
        const s = Mac.state.settings;
        return `${UI.header('Privacy & Security')}
          <div class="section-title">Privacy</div>
          ${UI.group(
            UI.toggle('Location Services', 'settings.locationServices'),
            UI.action('Contacts', 'privacy-detail', '1 app requested access', '', { arg: 'Contacts' }),
            UI.action('Files and Folders', 'privacy-detail', '2 apps requested access', '', { arg: 'Files and Folders' }),
            UI.action('Microphone', 'privacy-detail', 'Safari — off', '', { arg: 'Microphone' }),
            UI.action('Camera', 'privacy-detail', 'FaceTime — on', '', { arg: 'Camera' }),
            UI.action('Full Disk Access', 'privacy-detail', 'Terminal — off', '', { arg: 'Full Disk Access' }),
          )}
          <div class="section-title">Security</div>
          ${UI.group(
            UI.toggle('FileVault', 'settings.fileVault', 'Encrypt the contents of your Mac.'),
            UI.toggle('Firewall', 'settings.firewall'),
            UI.toggle('Install security responses and system files', 'settings.installSecurityResponses'),
            UI.select('Allow applications from', 'settings.gatekeeper',
              ['App Store', 'App Store and identified developers']),
            UI.toggle('Lockdown Mode', 'settings.lockdownMode', 'Extreme protection for targeted accounts.'),
          )}
          <div class="section-title">Analytics</div>
          ${UI.group(
            UI.toggle('Share Mac analytics', 'settings.analytics'),
            UI.action('Analytics Data…', 'generic', 'Review the diagnostic reports on this Mac.'),
          )}
          ${s.lockdownMode ? '<p class="section-note danger-text">Lockdown Mode is on — some features are restricted.</p>' : ''}`;
      },

      'Users & Groups'() {
        return `${UI.header('Users & Groups')}
          ${UI.group(
            `<div class="row">${UI.avatar(Mac.state.account.name, { size: 'small' })}
              <div class="row-text"><strong>${esc(Mac.state.account.name)}</strong><p>Admin — current user</p></div>
              <button class="btn" data-command="user-edit">Edit…</button></div>`,
            `<div class="row">${UI.avatar('Guest User', { size: 'small', initials: 'G' })}
              <div class="row-text"><strong>Guest User</strong><p>${Mac.state.settings.guestUser ? 'Login enabled' : 'Off'}</p></div>
              <button class="switch ${Mac.state.settings.guestUser ? 'on' : ''}" data-toggle-path="settings.guestUser" aria-label="Guest user"></button></div>`,
          )}
          ${UI.group(
            UI.toggle('Automatically log in as this user', 'settings.autoLogin', 'Skips the login window at startup.'),
            UI.action('Add User…', 'add-user', ''),
            UI.action('Change Password…', 'change-password', ``),
            UI.action('Login Options', 'settings-pane', 'Configure the login window.', '', { arg: 'Lock Screen' }),
          )}`;
      },

      'Internet Accounts'() {
        const accounts = Mac.state.mail.accounts;
        return `${UI.header('Internet Accounts', 'Accounts added here appear in Mail, Calendar and Contacts.')}
          ${UI.group(...accounts.map(account => `<button class="row tappable" data-command="mail-settings-accounts">
            <span class="mail-face" style="background:${account.color}">${esc(Mac.initials(account.description))}</span>
            <div class="row-text"><strong>${esc(account.description)}</strong>
              <p>${esc(account.address)} — Mail${account.provider === 'iCloud' ? ', Notes, Calendars' : ', Calendars'}</p></div>
            <div class="row-action"><span class="badge ${account.enabled ? 'ok' : ''}">${account.enabled ? 'Active' : 'Off'}</span>
              <span class="chevron">${glyph('chevron', { size: 13 })}</span></div></button>`))}
          <button class="btn primary" data-command="mail-add-account">Add Account…</button>`;
      },

      Keyboard() {
        return `${UI.header('Keyboard')}
          ${UI.group(
            UI.slider('Keyboard brightness', 'settings.keyboardBrightness'),
            UI.toggle('Adjust keyboard brightness in low light', 'settings.autoKeyboardBrightness'),
            UI.select('Key repeat rate', 'settings.keyRepeat', ['Off', 'Slow', 'Normal', 'Fast']),
          )}
          ${UI.group(
            UI.action('Keyboard Shortcuts…', 'keyboard-shortcuts', ''),
            UI.action('Text Input…', 'generic', 'Input sources and text replacements.'),
            UI.action('Dictation', 'generic', 'Off'),
          )}`;
      },

      Trackpad() {
        return `${UI.header('Trackpad')}
          ${UI.group(
            UI.slider('Tracking speed', 'settings.trackpadSpeed'),
            UI.toggle('Tap to click', 'settings.tapToClick'),
            UI.toggle('Natural scrolling', 'settings.naturalScroll'),
            UI.toggle('Force Click and haptic feedback', 'settings.forceClick'),
          )}
          ${UI.group(
            UI.info('Mission Control', 'Swipe up with three fingers', '', ''),

          )}`;
      },

      Mouse() {
        return `${UI.header('Mouse')}
          ${UI.group(
            UI.slider('Tracking speed', 'settings.mouseSpeed'),
            UI.toggle('Natural scrolling', 'settings.naturalScroll'),
            UI.toggle('Secondary click', 'settings.secondaryClick', 'Right-click or Control-click opens contextual menus.'),
          )}`;
      },

      'Printers & Scanners'() {
        const printers = Mac.state.printers;
        return `${UI.header('Printers & Scanners')}
          ${printers.length ? UI.group(...printers.map(printer =>
            `<div class="row">${Mac.paneIcon('Printers & Scanners', 'size-28')}
              <div class="row-text"><strong>${esc(printer.name)}</strong>
                <p>${esc(printer.status)} — ${Mac.plural(printer.queue, 'job')} in the queue</p></div>
              <div class="row-action"><span class="badge ${printer.status === 'Idle' ? 'ok' : 'warn'}">${esc(printer.status)}</span>
                <button class="btn" data-command="printer-queue" data-arg="${printer.id}">Open Queue…</button></div></div>`))
            : UI.empty('No printers available', 'Add a printer, scanner, or fax to use with this Mac.', {
                icon: 'printer',
                action: '<button class="btn primary" data-command="add-printer">Add Printer, Scanner or Fax…</button>',
              })}
          ${printers.length ? `<div class="row-flex"><button class="btn" data-command="add-printer">Add Printer…</button>
            <button class="btn destructive" data-command="remove-printer">Remove</button></div>` : ''}
          ${UI.group(UI.select('Default printer', 'settings.defaultPrinter', ['Last Printer Used', ...printers.map(printer => printer.name)]))}`;
      },
    },

    /* ------------------------------------------------------------ sub-panes */

    subPanes: {
      About() {
        const s = Mac.state.settings;
        const volume = Mac.state.volumes[0];
        return `${UI.header('About', s.computerName)}
          ${UI.group(
            UI.info('Name', s.computerName, '', `<button class="btn" data-command="rename-mac">Rename…</button>`),
            UI.info('Chip', 'Apple M4 Pro'),
            UI.info('Memory', '24 GB'),
            UI.info('Startup disk', volume.name),
            UI.info('Serial number', '—'),
            UI.info('macOS', `Golden Gate ${Mac.OS.version()}`),
          )}
          ${UI.group(
            UI.action('System Report…', 'open-app', 'The complete hardware and software inventory.', '', { arg: 'system-info' }),
            UI.action('Software Update…', 'settings-sub', '', '', { arg: 'Software Update' }),
            UI.action('Regulatory Certification', 'generic', ''),
          )}
          `;
      },

      'Software Update'() {
        const updates = Mac.state.appUpdates;
        const os = Mac.OS.update();
        const pending = Mac.OS.pending();
        /* The OS row used to be a permanent "Up to date" badge, so the one
           thing this pane exists for could not be done. It now downloads,
           installs and restarts, and the Mac comes back on the new build. */
        const osRow = !pending
          ? `<div class="row"><span style="width:44px;height:44px;display:grid;place-items:center;border-radius:11px;background:var(--fill);color:var(--accent)">${glyph('update', { size: 24 })}</span>
              <div class="row-text"><strong>macOS Golden Gate ${Mac.OS.version()}</strong>
                <p>Your Mac is up to date.</p></div>
              <span class="badge ok">Up to date</span></div>`
          : os.stage === 'downloading' || os.stage === 'installing'
            ? `<div class="row block"><div class="row-text" style="width:100%">
                <strong>${os.stage === 'downloading' ? 'Downloading' : 'Preparing'} macOS Golden Gate ${esc(os.version)}</strong>
                <p>${os.progress}% — ${os.stage === 'downloading' ? Mac.bytes(os.bytes) : 'this Mac will restart to finish installing'}</p>
                <span class="meter" style="margin-top:8px"><i style="width:${os.progress}%;background:var(--accent)"></i></span></div></div>`
            : `<div class="row"><span style="width:44px;height:44px;display:grid;place-items:center;border-radius:11px;background:var(--fill);color:var(--accent)">${glyph('update', { size: 24 })}</span>
                <div class="row-text"><strong>macOS Golden Gate ${esc(os.version)}</strong>
                  <p>${esc(os.notes)} — ${Mac.bytes(os.bytes)}</p></div>
                <div class="row-action"><button class="btn primary" data-command="os-update"
                  data-arg="${os.stage === 'downloaded' ? 'install' : 'download'}">${os.stage === 'downloaded' ? 'Restart Now' : 'Upgrade Now'}</button></div></div>`;

        return `${UI.header('Software Update', pending
          ? 'An update is available for this Mac'
          : updates.length
            ? `${Mac.plural(updates.length, 'app update')} available for this Mac`
            : 'This Mac is up to date')}
          ${UI.group(
            osRow,
            UI.toggle('Automatic updates', 'settings.autoUpdates'),
            UI.toggle('Install security responses and system files', 'settings.installSecurityResponses'),
            UI.action('Check Now', 'check-updates', ''),
          )}
          ${updates.length ? `<div class="section-title">App updates</div>
            <div class="group">${updates.map(update => `<div class="row">
              <span class="store-row-app" style="width:32px;height:32px">${appIcon(Mac.apps[update.id].icon)}</span>
              <div class="row-text"><strong>${esc(Mac.apps[update.id].title)} ${esc(update.version)}</strong><p>${esc(update.notes)}</p></div>
              <div class="row-action"><span class="row-value">${Mac.bytes(update.size)}</span>
                <button class="btn primary" data-command="store-update" data-arg="${update.id}">Update</button></div></div>`).join('')}</div>
            <button class="btn primary" data-command="store-update-all">Update All</button>` : ''}`;
      },

      Storage() {
        const volume = Mac.state.volumes[0];
        return `${UI.header('Storage', `${Mac.bytes(volume.totalBytes - volume.usedBytes)} available of ${Mac.bytes(volume.totalBytes)}`)}
          <div class="group"><div class="row block">
            ${UI.stacked(Mac.state.storageBreakdown, volume.totalBytes)}</div></div>
          ${UI.group(...Mac.state.storageBreakdown.map(entry =>
            UI.info(entry.label, Mac.bytes(entry.bytes), '', `<span class="meter"><i style="width:${(entry.bytes / volume.totalBytes) * 100 * 3}%;background:${entry.color}"></i></span>`)))}
          <div class="section-title">Recommendations</div>
          ${UI.group(
            UI.action('Empty Trash automatically', 'generic', 'Erase items that have been in the Trash for more than 30 days.'),
            UI.action('Review the Trash', 'open-app', `${Mac.plural(Mac.FS.children('trash').length, 'item')} waiting`, '', { arg: 'trash' }),
            UI.action('Review Downloads', 'finder-go-downloads', `${Mac.plural(Mac.FS.children('dir-downloads').length, 'item')}`),
            UI.action('Store in iCloud', 'settings-pane', 'Keep older files in iCloud Drive only.', '', { arg: 'Apple Account' }),
          )}`;
      },

      'AirDrop & Handoff'() {
        return `${UI.header('AirDrop & Handoff')}
          ${UI.group(
            UI.select('AirDrop', 'settings.airdropVisibility', ['Receiving Off', 'Contacts Only', 'Everyone for 10 Minutes']),
            UI.toggle('Allow Handoff between this Mac and your iCloud devices', 'settings.handoff'),
            UI.toggle('AirPlay Receiver', 'settings.airplayReceiver'),
          )}`;
      },

      'Login Items'() {
        return `${UI.header('Login Items & Extensions', 'Items that open automatically when you log in.')}
          ${UI.group(
            UI.info('Microsoft Outlook', 'Application', 'Added by Microsoft AutoUpdate'),
            UI.info('Bench Diagnostics Helper', 'Background item', 'Enabled'),
            UI.info('Time Machine Helper', 'Background item', 'Enabled'),
          )}
          ${UI.group(
            UI.action('Allow in the Background', 'generic', '3 background items are allowed.'),
            UI.action('Extensions', 'generic', 'Finder, Share menu and Quick Look extensions.'),
          )}`;
      },

      Sharing() {
        return `${UI.header('Sharing', Mac.state.settings.computerName)}
          ${UI.group(
            UI.toggle('Screen Sharing', 'settings.screenSharing'),
            UI.toggle('File Sharing', 'settings.fileSharing'),
            UI.toggle('Remote Login', 'settings.remoteLogin', 'Allows SSH access in a real deployment.'),
            UI.toggle('Remote Management', 'settings.remoteManagement'),
          )}
          ${UI.group(UI.info('Local hostname', `${Mac.state.settings.computerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.local`,
            '', `<button class="btn" data-command="rename-mac">Edit…</button>`))}`;
      },

      'Startup Disk'() {
        return `${UI.header('Startup Disk', 'Select the volume to start up from.')}
          ${UI.group(...Mac.state.volumes.map(volume =>
            `<div class="row">${Mac.paneIcon('Startup Disk', 'size-28')}
              <div class="row-text"><strong>${esc(volume.name)}</strong>
                <p>${volume.kind === 'internal' ? `macOS ${Mac.OS.version()}` : 'Backup volume — not bootable'}</p></div>
              ${volume.kind === 'internal' ? '<span class="badge ok">Selected</span>' : ''}</div>`))}
          ${UI.group(UI.action('Restart in Recovery', 'power', 'Boot into the recovery environment.', '', { arg: 'recovery' }))}`;
      },

      'Language & Region'() {
        return `${UI.header('Language & Region')}
          ${UI.group(
            UI.select('Preferred language', 'settings.language',
              ['English (US)', 'English (UK)', 'Español', 'Français', 'Deutsch', '日本語']),
            UI.select('Region', 'settings.region', ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany']),
            UI.select('24-hour time', 'settings.time24', ['false', 'true']),
          )}
          `;
      },

      'Date & Time'() {
        return `${UI.header('Date & Time', new Date().toLocaleString())}
          ${UI.group(
            UI.toggle('Set time and date automatically', 'settings.autoTimezone'),
            UI.info('Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Automatic'),
            UI.info('Source', 'time.apple.example'),
            UI.select('24-hour time', 'settings.time24', ['false', 'true']),
          )}
          `;
      },

      'Transfer or Reset'() {
        return `${UI.header('Transfer or Reset')}
          ${UI.group(
            UI.action('Open Migration Assistant', 'open-app', 'Move data from another Mac, a backup or a PC.', '', { arg: 'migration' }),
          )}
          ${UI.group(
            `<button class="row tappable" data-command="factory-reset">
              <div class="row-text"><strong class="danger-text">Erase All Content and Settings</strong>
                <p>Erase all settings, media, and data.</p></div>
              <span class="chevron">${glyph('chevron', { size: 13 })}</span></button>`,
          )}
          `;
      },
    },
  };

  Mac.registerApp({
    id: 'settings',
    title: 'System Settings',
    icon: 'settings',
    category: 'System',
    blurb: 'Every preference for this Mac, including the Apple Account.',
    size: [860, 680],
    min: [460, 340],
    singleton: true,
    initialState: () => ({ pane: 'Wi-Fi', query: '', stack: [] }),
    titleFor: win => (win.state.stack.length ? win.state.stack[win.state.stack.length - 1] : win.state.pane),
    leading: win => (win.state.stack.length
      ? `<button class="tool-btn" data-command="settings-back" aria-label="Back">${glyph('back')}</button>` : ''),
    menus: () => ({
      View: [
        { label: 'Wi-Fi', command: 'settings-pane', arg: 'Wi-Fi' },
        { label: 'General', command: 'settings-pane', arg: 'General' },
        { label: 'Apple Account', command: 'settings-pane', arg: 'Apple Account' },
        { label: 'Privacy & Security', command: 'settings-pane', arg: 'Privacy & Security' },
      ],
    }),
    render: win => Settings.render(win),
  });
}(window.Mac));
