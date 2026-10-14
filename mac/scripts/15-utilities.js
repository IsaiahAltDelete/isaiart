/* ===========================================================================
   Utilities and productivity apps: Terminal, Activity Monitor, Disk Utility,
   Console, Calculator, Notes, TextEdit, Preview, Screenshot, Time Machine,
   Keychain Access, System Information, Migration Assistant and Freeform.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, appIcon, UI } = Mac;

  /* ---------------------------------------------------------------- Terminal */

  const Terminal = Mac.Terminal = {
    banner() {
      return `Last login: ${new Date().toLocaleString()} on ttys000\n` +
        ''; 
    },

    run(win, input) {
      const command = input.trim();
      const wifi = Mac.state.wifi;
      const out = text => { win.state.output += `${text}\n`; };

      win.state.output += `${Mac.PERSONA.shortName}@mac ~ % ${command}\n`;
      if (command) win.state.history.push(command);

      const [name, ...args] = command.split(/\s+/);

      switch (name) {
        case '': break;
        case 'help':
          out('Commands:');
          out('  help  clear  date  whoami  hostname  uname  sw_vers  uptime');
          out('  ifconfig  ipconfig  ping  networksetup  dig  netstat  arp');
          out('  df  du  ls  pwd  cat  top  ps  system_profiler');
          out('  softwareupdate  diskutil  pmset  log  open  say  defaults');
          break;
        case 'clear': win.state.output = ''; break;
        case 'date': out(new Date().toString()); break;
        case 'whoami': out(Mac.PERSONA.shortName); break;
        case 'hostname': out(Mac.state.settings.computerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')); break;
        case 'uname':
          out(args.includes('-a')
            ? `Darwin ${Mac.state.settings.computerName} 27.0.1.0 Darwin Kernel Version 27.0.1.0: SIMULATED; root:xnu-12000~1/RELEASE_ARM64_T6041 arm64`
            : 'Darwin');
          break;
        case 'sw_vers':
          out('ProductName:\t\tmacOS');
          out(`ProductVersion:\t\t${Mac.OS.version()}`);
          out(`BuildVersion:\t\t${Mac.OS.build()}`);
          break;
        case 'uptime': out(`${Mac.formatTime()}  up 3 days, 14:22, 2 users, load averages: 1.42 1.28 1.11`); break;
        case 'pwd': out(`/Users/${Mac.PERSONA.shortName}`); break;
        case 'ls':
          out(Mac.FS.children('dir-home').map(node => node.name).join('\t') || '');
          break;
        case 'cat': {
          const target = args.join(' ');
          const node = Mac.state.fs.find(entry => entry.name.toLowerCase() === target.toLowerCase());
          if (!node) out(`cat: ${target}: No such file or directory`);
          else if (node.ext === 'txt') out(Mac.state.appData.textedit);
          else out(`cat: ${node.name}: binary file`);
          break;
        }
        case 'ifconfig':
          if (!wifi.enabled) { out('en0: flags=8802<BROADCAST,SIMPLEX,MULTICAST> mtu 1500'); out('\tstatus: inactive'); break; }
          out('en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500');
          out(`\tinet ${wifi.current ? wifi.ip : '0.0.0.0'} netmask ${wifi.subnet} broadcast 192.168.1.255`);
          out(`\tstatus: ${wifi.current ? 'active' : 'inactive'}`);
          out('lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384');
          out('\tinet 127.0.0.1 netmask 0xff000000');
          break;
        case 'ipconfig':
          out(wifi.current ? wifi.ip : 'ipconfig: no such interface state');
          break;
        case 'ping': {
          const host = args.find(arg => !arg.startsWith('-')) || 'network.test';
          if (!wifi.enabled || !wifi.current) { out(`ping: cannot resolve ${host}: Network is unreachable`); break; }
          if (wifi.captive) { out(`ping: sendto: Host is down (captive portal sign-in required)`); break; }
          if (!wifi.dns.length) { out(`ping: cannot resolve ${host}: Unknown host`); break; }
          out(`PING ${host} (203.0.113.10): 56 data bytes`);
          for (let i = 0; i < 3; i += 1) out(`64 bytes from 203.0.113.10: icmp_seq=${i} ttl=54 time=${(17 + Math.random() * 6).toFixed(1)} ms`);
          out(`--- ${host} ping statistics ---`);
          out('3 packets transmitted, 3 packets received, 0.0% packet loss');
          break;
        }
        case 'dig':
          if (!wifi.dns.length) { out(';; connection timed out; no servers could be reached'); break; }
          out(`; <<>> DiG 9.10.6 <<>> ${args.join(' ') || 'network.test'}`);
          out(`;; ANSWER SECTION:`);
          out(`${args[0] || 'network.test'}.\t300\tIN\tA\t203.0.113.10`);
          out(`;; SERVER: ${wifi.dns[0]}#53(${wifi.dns[0]})`);
          break;
        case 'networksetup':
          if (args[0] === '-getinfo' || !args.length) {
            out(`Wi-Fi network: ${wifi.current || 'not associated'}`);
            out(`IP address: ${wifi.current ? wifi.ip : 'none'}`);
            out(`Router: ${wifi.current ? wifi.router : 'none'}`);
          } else if (args[0] === '-listallhardwareports') {
            out('Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: 9c:fc:01:SIM:00');
          } else out(`Current Wi-Fi Network: ${wifi.current || 'You are not associated with an AirPort network.'}`);
          break;
        case 'netstat':
          out('Active Internet connections');
          out('Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)');
          out(`tcp4       0      0  ${wifi.current ? wifi.ip : '0.0.0.0'}.49232   203.0.113.10.443       ESTABLISHED`);
          break;
        case 'arp':
          out(`? (${wifi.router}) at 9c:fc:01:sim:01 on en0 ifscope [ethernet]`);
          break;
        case 'df': {
          const volume = Mac.state.volumes[0];
          out('Filesystem      Size   Used  Avail Capacity  Mounted on');
          out(`/dev/disk3s1s1  ${Mac.bytes(volume.totalBytes)}  ${Mac.bytes(volume.usedBytes)}  ${Mac.bytes(volume.totalBytes - volume.usedBytes)}  ` +
            `${Math.round((volume.usedBytes / volume.totalBytes) * 100)}%     /`);
          break;
        }
        case 'du':
          Mac.state.storageBreakdown.forEach(entry => out(`${Mac.bytes(entry.bytes).padEnd(10)}${entry.label}`));
          break;
        case 'ps': case 'top':
          out('  PID  %CPU  RSS      COMMAND');
          Mac.state.processes.slice(0, 8).forEach((process, index) =>
            out(`${String(180 + index * 37).padStart(5)}  ${String(process.cpu).padStart(4)}  ${String(process.memory).padStart(6)}M  ${process.name}`));
          break;
        case 'system_profiler':
          out('Hardware:\n    Model Name: MacBook Pro');
          out('    Chip: Apple M4 Pro\n    Total Number of Cores: 12\n    Memory: 24 GB');
          out(`    Serial Number: SIMULATED\n    macOS: ${Mac.OS.version()}`);
          break;
        case 'softwareupdate':
          out('Software Update Tool');
          out(Mac.state.appUpdates.length
            ? `Found the following updates:\n${Mac.state.appUpdates.map(update => `   * ${Mac.apps[update.id].title}-${update.version}`).join('\n')}`
            : 'No new software available.');
          break;
        case 'diskutil':
          if (args[0] === 'list') {
            Mac.state.volumes.forEach((volume, index) => {
              out(`/dev/disk${index} (${volume.kind}, physical):`);
              out(`   0:      GUID_partition_scheme                        ${Mac.bytes(volume.totalBytes)}   disk${index}`);
              out(`   1:                  Apple_APFS ${volume.name.padEnd(24)}${Mac.bytes(volume.totalBytes)}   disk${index}s1`);
            });
          } else if (args[0] === 'verifyVolume' || args[0] === 'repairVolume') {
            out('Started file system verification on disk3s1s1 Macintosh HD');
            out('Checking the container superblock\nChecking the object map\nThe volume appears to be OK');
            out('Finished file system verification');
          } else out('Usage: diskutil list | verifyVolume <device> | repairVolume <device>');
          break;
        case 'pmset':
          out(`Currently in use:`);
          out(` lowpowermode         ${Mac.state.settings.lowPowerMode ? 1 : 0}`);
          out(` displaysleep         ${parseInt(Mac.state.settings.displayOffBattery, 10) || 10}`);
          out(` disksleep            10`);
          break;
        case 'log':
          Mac.state.logs.slice(0, 6).forEach(entry =>
            out(`${new Date(entry.at).toLocaleTimeString()} ${entry.level.padEnd(6)} ${entry.process}: ${entry.message}`));
          break;
        case 'open': {
          const target = args.join(' ').replace(/^-a\s+/, '').replace(/["']/g, '');
          const app = Object.values(Mac.apps).find(candidate =>
            candidate.title.toLowerCase() === target.toLowerCase() || candidate.id === target.toLowerCase());
          if (app) { out(`Opening ${app.title}…`); Mac.wm.open(app.id); }
          else out(`Unable to find application named '${target}'`);
          break;
        }
        case 'say': out(`${args.join(' ')}`); break;
        case 'defaults':
          out(args[0] === 'read'
            ? `{\n    AppleInterfaceStyle = ${Mac.state.settings.appearance === 'dark' ? 'Dark' : 'Light'};\n    AppleShowAllExtensions = 1;\n}`
            : 'Command line interface to a user\'s defaults. ');
          break;
        case 'sudo':
          out('sudo: operation not permitted');
          break;
        case 'rm': case 'mkfs': case 'dd':
          out(`${name}: permission denied.`);
          break;
        default:
          out(`zsh: command not found: ${name}`);

      }

      win.state.input = '';
      Mac.wm.render(win);
    },
  };

  Mac.registerApp({
    id: 'terminal',
    title: 'Terminal',
    icon: 'terminal',
    category: 'Utilities',
    blurb: 'Run commands and inspect your Mac.',
    size: [760, 470],
    min: [380, 240],
    initialState: () => ({ output: Terminal.banner(), history: [], historyIndex: -1, input: '' }),
    titleFor: () => 'alex — -zsh',
    menus: () => ({
      Shell: [
        { label: 'New Window', command: 'new-window', shortcut: '⌘N' },
        { label: 'Clear Buffer', command: 'terminal-clear', shortcut: '⌘K' },
      ],
    }),
    render: win => `<div class="terminal" data-terminal-view>
      <div class="terminal-out">${esc(win.state.output)}</div>
      <div class="terminal-line"><span class="terminal-prompt">${Mac.PERSONA.shortName}@mac ~ %</span>
        <input class="terminal-in" data-terminal-input value="${esc(win.state.input)}" autocomplete="off"
          spellcheck="false" aria-label="Terminal command"></div></div>`,
    mount(win) {
      const view = win.el.querySelector('[data-terminal-view]');
      if (view) view.scrollTop = view.scrollHeight;
      if (Mac.session.activeWindow === win.id) win.el.querySelector('[data-terminal-input]')?.focus();
    },
  });

  /* -------------------------------------------------------- Activity Monitor */

  const Activity = Mac.Activity = {
    TABS: ['CPU', 'Memory', 'Energy', 'Disk', 'Network'],

    render(win) {
      const tab = win.state.tab;
      return `<div style="display:flex;flex-direction:column;height:100%">
        <div class="tabs-bar">${this.TABS.map(name =>
          `<button class="tab-pill ${tab === name ? 'on' : ''}" data-activity-tab="${name}">${name}</button>`).join('')}
          <span class="spacer"></span>
          <div class="search" style="width:150px"><span>${glyph('search')}</span>
            <input data-activity-search value="${esc(win.state.query)}" placeholder="Search" aria-label="Filter processes"></div>
        </div>
        <div class="pane-scroll">${this.tab(win, tab)}</div>
      </div>`;
    },

    processes(win) {
      const query = win.state.query.trim().toLowerCase();
      return Mac.state.processes
        .filter(process => !query || process.name.toLowerCase().includes(query))
        .sort((a, b) => b.cpu - a.cpu);
    },

    tab(win, tab) {
      const processes = this.processes(win);
      const spark = values => `<div class="sparkline">${values.map(value =>
        `<i style="height:${Mac.clamp(value, 3, 100)}%"></i>`).join('')}</div>`;
      const series = seed => Array.from({ length: 24 }, (_, index) =>
        30 + 24 * Math.sin((index + seed) / 3) + (index % 5) * 4);

      if (tab === 'CPU') {
        const total = processes.reduce((sum, process) => sum + process.cpu, 0);
        return `<div class="gauge-row">
            <div class="gauge"><small>System</small><strong>${(total * 0.4).toFixed(1)}%</strong>${spark(series(1))}</div>
            <div class="gauge"><small>User</small><strong>${(total * 0.6).toFixed(1)}%</strong>${spark(series(4))}</div>
            <div class="gauge"><small>Idle</small><strong>${Math.max(0, 100 - total).toFixed(1)}%</strong>${spark(series(9))}</div>
            <div class="gauge"><small>Threads</small><strong>${processes.reduce((sum, process) => sum + process.threads, 0)}</strong></div>
          </div>
          <table class="data-table"><thead><tr><th>Process Name</th><th>% CPU</th><th>Threads</th><th>Kind</th><th>CPU load</th></tr></thead>
          <tbody>${processes.map(process => `<tr data-process="${esc(process.name)}"
            class="${win.state.selected === process.name ? 'selected' : ''}">
            <td>${esc(process.name)}</td><td>${process.cpu.toFixed(1)}</td><td>${process.threads}</td>
            <td>${process.kind === 'system' ? 'System' : 'Application'}</td>
            <td><span class="meter"><i style="width:${Mac.clamp(process.cpu * 6, 2, 100)}%"></i></span></td></tr>`).join('')}</tbody></table>`;
      }

      if (tab === 'Memory') {
        const used = processes.reduce((sum, process) => sum + process.memory, 0);
        const total = 24576;
        return `<div class="gauge-row">
            <div class="gauge"><small>Physical Memory</small><strong>24 GB</strong></div>
            <div class="gauge"><small>Memory Used</small><strong>${(used / 1024).toFixed(1)} GB</strong>${spark(series(2))}</div>
            <div class="gauge"><small>Cached Files</small><strong>4.2 GB</strong></div>
            <div class="gauge"><small>Swap Used</small><strong>0 bytes</strong></div>
          </div>
          <div style="padding:0 12px 12px"><div class="section-title">Memory pressure</div>
            <div class="meter wide"><i style="width:${Math.round((used / total) * 100)}%" class="${used / total > 0.8 ? 'bad' : ''}"></i></div></div>
          <table class="data-table"><thead><tr><th>Process Name</th><th>Memory</th><th>Compressed</th><th>Threads</th></tr></thead>
          <tbody>${processes.map(process => `<tr data-process="${esc(process.name)}"
            class="${win.state.selected === process.name ? 'selected' : ''}">
            <td>${esc(process.name)}</td><td>${process.memory} MB</td>
            <td>${Math.round(process.memory * 0.12)} MB</td><td>${process.threads}</td></tr>`).join('')}</tbody></table>`;
      }

      if (tab === 'Energy') {
        return `<div class="gauge-row">
            <div class="gauge"><small>Battery</small><strong>${Mac.state.battery.percent}%</strong></div>
            <div class="gauge"><small>Remaining</small><strong>${esc(Mac.state.battery.timeRemaining)}</strong></div>
            <div class="gauge"><small>Cycles</small><strong>${Mac.state.battery.cycles}</strong></div>
            <div class="gauge"><small>Condition</small><strong style="font-size:15px">${esc(Mac.state.battery.health)}</strong></div>
          </div>
          <table class="data-table"><thead><tr><th>App Name</th><th>Energy Impact</th><th>Avg Energy</th><th>Preventing Sleep</th></tr></thead>
          <tbody>${processes.filter(process => process.kind === 'app').map(process => `<tr data-process="${esc(process.name)}"
            class="${win.state.selected === process.name ? 'selected' : ''}">
            <td>${esc(process.name)}</td><td>${esc(process.energy)}</td>
            <td>${(process.cpu * 1.4).toFixed(1)}</td><td>No</td></tr>`).join('')}</tbody></table>`;
      }

      if (tab === 'Disk') {
        const volume = Mac.state.volumes[0];
        return `<div class="gauge-row">
            <div class="gauge"><small>Reads in</small><strong>1.24 M</strong>${spark(series(6))}</div>
            <div class="gauge"><small>Writes out</small><strong>842 K</strong>${spark(series(11))}</div>
            <div class="gauge"><small>Data read</small><strong>18.4 GB</strong></div>
            <div class="gauge"><small>Data written</small><strong>9.7 GB</strong></div>
          </div>
          <div style="padding:0 12px 14px">
            <div class="section-title">${esc(volume.name)}</div>
            ${UI.stacked(Mac.state.storageBreakdown, volume.totalBytes)}
          </div>`;
      }

      const wifi = Mac.state.wifi;
      return `<div class="gauge-row">
          <div class="gauge"><small>Packets in</small><strong>${wifi.current ? '482 K' : '0'}</strong>${spark(series(3))}</div>
          <div class="gauge"><small>Packets out</small><strong>${wifi.current ? '311 K' : '0'}</strong>${spark(series(8))}</div>
          <div class="gauge"><small>Data received</small><strong>${wifi.current ? '1.42 GB' : '0 bytes'}</strong></div>
          <div class="gauge"><small>Data sent</small><strong>${wifi.current ? '318 MB' : '0 bytes'}</strong></div>
        </div>
        <div style="padding:0 12px">${UI.group(
          UI.info('Interface', 'en0 (Wi-Fi)'),
          UI.info('Status', wifi.enabled ? (wifi.current ? 'Active' : 'Not associated') : 'Off',
            '', `<span class="badge ${wifi.current ? 'ok' : 'bad'}">${wifi.current ? 'Up' : 'Down'}</span>`),
          UI.info('IP address', wifi.current ? wifi.ip : '--'),
          UI.info('DNS', wifi.dns.join(', ') || 'None'),
        )}</div>`;
    },

    async forceQuit(win) {
      const name = win.state.selected;
      if (!name) {
        Mac.Notify.show('Activity Monitor', 'Select a process first.', { app: 'activity-monitor', transient: true });
        return;
      }
      if (['WindowServer', 'kernel_task'].includes(name)) {
        Mac.Dialog.info('This process cannot be quit', `${name} is a protected system process.`, 'shield');
        return;
      }
      const confirmed = await Mac.Dialog.confirm({
        title: `Are you sure you want to quit “${name}”?`,
        body: 'Quitting a process may cause unsaved work to be lost.',
        confirmLabel: 'Force Quit',
        danger: true,
      });
      if (!confirmed) return;
      const app = Object.values(Mac.apps).find(candidate => candidate.title === name);
      if (app) Mac.wm.closeApp(app.id);
      Mac.state.processes = Mac.state.processes.filter(process => process.name !== name);
      win.state.selected = null;
      Mac.save();
      Mac.wm.refresh('activity-monitor');
      Mac.Notify.show('Activity Monitor', `${name} was quit.`, { app: 'activity-monitor' });
    },
  };

  Mac.registerApp({
    id: 'activity-monitor',
    title: 'Activity Monitor',
    icon: 'activity-monitor',
    category: 'Utilities',
    blurb: 'CPU, memory, energy, disk and network load for every process.',
    size: [860, 560],
    min: [420, 300],
    singleton: true,
    initialState: () => ({ tab: 'CPU', query: '', selected: null }),
    titleFor: win => `Activity Monitor — ${win.state.tab}`,
    toolbar: () => `<button class="tool-btn" data-command="force-quit-process" aria-label="Quit process">${glyph('close')}</button>
      <button class="tool-btn" data-command="refresh-processes" aria-label="Refresh">${glyph('refresh')}</button>`,
    render: win => Activity.render(win),
  });

  /* ------------------------------------------------------------ Disk Utility */

  const DiskUtility = Mac.DiskUtility = {
    render(win) {
      const volume = Mac.state.volumes.find(candidate => candidate.id === win.state.selected) || Mac.state.volumes[0];
      const free = volume.totalBytes - volume.usedBytes;

      return `<div class="app-shell">
        <aside class="sidebar">
          <div class="sidebar-heading">Internal</div>
          ${Mac.state.volumes.filter(candidate => candidate.kind === 'internal').map(candidate =>
            `<button class="side-item ${candidate.id === volume.id ? 'on' : ''}" data-disk-volume="${candidate.id}">
              <span class="side-glyph">${glyph('disk', { size: 15 })}</span>
              <span class="side-label">${esc(candidate.name)}</span></button>`).join('')}
          <div class="sidebar-heading">External</div>
          ${Mac.state.volumes.filter(candidate => candidate.kind === 'external').map(candidate =>
            `<button class="side-item ${candidate.id === volume.id ? 'on' : ''}" data-disk-volume="${candidate.id}">
              <span class="side-glyph">${glyph('disk', { size: 15 })}</span>
              <span class="side-label">${esc(candidate.name)}</span>
              ${candidate.mounted === false ? '<span class="side-count">⏏</span>' : ''}</button>`).join('')}
        </aside>
        <section class="main-pane"><div class="pane-scroll"><div class="pane-pad">
          ${UI.header(volume.name, `${Mac.bytes(free)} free of ${Mac.bytes(volume.totalBytes)}`,
            `<button class="btn" data-command="disk-first-aid">First Aid</button>
             <button class="btn" data-command="disk-mount" data-arg="${volume.id}">${volume.mounted === false ? 'Mount' : 'Unmount'}</button>
             <button class="btn destructive" data-command="disk-erase" data-arg="${volume.id}">Erase</button>`)}
          <div class="disk-map">${Mac.state.storageBreakdown.map(entry =>
            `<i style="width:${(entry.bytes / volume.totalBytes) * 100}%;background:${entry.color}"></i>`).join('')}
            <i style="flex:1;background:var(--fill)"></i></div>
          <div class="legend">${Mac.state.storageBreakdown.map(entry =>
            `<span><i style="background:${entry.color}"></i>${esc(entry.label)} — ${Mac.bytes(entry.bytes)}</span>`).join('')}
            <span><i style="background:var(--fill)"></i>Free — ${Mac.bytes(free)}</span></div>
          <div class="section-title">Volume information</div>
          ${UI.group(
            UI.info('Mount point', volume.mounted === false ? 'Not mounted' : '/'),
            UI.info('Type', 'APFS Volume'),
            UI.info('Capacity', Mac.bytes(volume.totalBytes)),
            UI.info('Available', Mac.bytes(free)),
            UI.info('Used', Mac.bytes(volume.usedBytes)),
            UI.info('Encrypted', volume.encrypted ? 'Yes (FileVault)' : 'No'),
            UI.info('SMART status', volume.smart, '', `<span class="badge ok">${esc(volume.smart)}</span>`),
          )}
          ${win.state.report ? `<div class="section-title">First Aid report</div>
            <div class="group"><div class="row block"><pre class="mono" style="margin:0;font-size:11px;white-space:pre-wrap">${esc(win.state.report)}</pre></div></div>` : ''}
        </div></div></section>
      </div>`;
    },

    async firstAid(win) {
      const volume = Mac.state.volumes.find(candidate => candidate.id === win.state.selected) || Mac.state.volumes[0];
      const lines = [
        `Running First Aid on “${volume.name}”`,
        'Checking the container superblock…',
        'Checking the object map…',
        'Checking the snapshot metadata tree…',
        'Verifying allocated space…',
      ];
      win.state.report = '';
      for (const line of lines) {
        win.state.report += `${line}\n`;
        Mac.wm.render(win);
        // eslint-disable-next-line no-await-in-loop
        await Mac.wait(420);
      }
      win.state.report += 'The volume appears to be OK.\nFirst Aid process is complete.\n';
      Mac.wm.render(win);
      Mac.Notify.show('Disk Utility', `First Aid finished — ${volume.name} appears to be OK.`, { app: 'disk-utility' });
    },

    toggleMount(id) {
      const volume = Mac.state.volumes.find(candidate => candidate.id === id);
      if (!volume) return;
      if (volume.kind === 'internal') {
        Mac.Dialog.info('The startup volume cannot be unmounted', 'Restart in Recovery to work on Macintosh HD.', 'warning');
        return;
      }
      /* Through Finder, which also has to move any window left sitting
         inside the volume — a Finder window pointed at an unmounted disk
         renders an empty list that reads as data loss. */
      if (volume.mounted === false) Mac.Finder.mount(id);
      else Mac.Finder.eject(id);
      Mac.wm.refresh('disk-utility');
    },

    async erase(id) {
      const volume = Mac.state.volumes.find(candidate => candidate.id === id);
      if (!volume) return;
      if (volume.kind === 'internal') {
        Mac.Dialog.open({
          title: 'Erase the startup volume?',
          icon: 'warning',
          body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">Macintosh HD is the startup volume, so it can only be
            erased from Recovery. Use Erase All Content and Settings instead — it walks through the same flow safely.</p>`,
          buttons: [
            { label: 'Cancel' },
            { label: 'Restart in Recovery', action: () => Mac.run('power', 'recovery') },
            { label: 'Erase All Content and Settings…', primary: true, action: () => Mac.Power.factoryReset() },
          ],
        });
        return;
      }
      const confirmed = await Mac.Dialog.confirm({
        title: `Erase “${volume.name}”?`,
        body: 'Erasing this volume permanently removes all of its data.',
        confirmLabel: 'Erase',
        danger: true,
      });
      if (!confirmed) return;
      volume.usedBytes = 0;
      Mac.save();
      Mac.wm.refresh('disk-utility');
      Mac.Notify.show('Disk Utility', `${volume.name} was erased.`, { app: 'disk-utility' });
    },
  };

  Mac.registerApp({
    id: 'disk-utility',
    title: 'Disk Utility',
    icon: 'disk-utility',
    category: 'Utilities',
    blurb: 'Inspect, verify, repair and erase volumes.',
    size: [860, 560],
    min: [440, 320],
    singleton: true,
    initialState: () => ({ selected: 'vol-hd', report: '' }),
    toolbar: () => `<button class="tool-btn" data-command="disk-first-aid" aria-label="First Aid">${glyph('shield')}</button>`,
    render: win => DiskUtility.render(win),
  });

  /* ----------------------------------------------------------------- Console */

  Mac.registerApp({
    id: 'console',
    title: 'Console',
    icon: 'console',
    category: 'Utilities',
    blurb: 'View log messages.',
    size: [880, 520],
    min: [420, 280],
    singleton: true,
    initialState: () => ({ query: '', level: 'All' }),
    toolbar: win => `<div class="segmented">${['All', 'Errors', 'Faults'].map(level =>
      `<button class="${win.state.level === level ? 'on' : ''}" data-console-level="${level}">${level}</button>`).join('')}</div>
      <div class="search" style="width:160px"><span>${glyph('search')}</span>
        <input data-console-search value="${esc(win.state.query)}" placeholder="Search" aria-label="Filter log"></div>
      <button class="tool-btn" data-command="console-clear" aria-label="Clear">${glyph('trash')}</button>`,
    render(win) {
      const query = win.state.query.trim().toLowerCase();
      const rows = Mac.state.logs.filter(entry => {
        if (win.state.level === 'Errors' && !['error', 'fault'].includes(entry.level)) return false;
        if (win.state.level === 'Faults' && entry.level !== 'fault') return false;
        return !query || `${entry.process} ${entry.message}`.toLowerCase().includes(query);
      });
      return `<div class="console-shell">
        <div class="console-rows">${rows.length ? rows.map(entry => `<div class="console-row">
          <time>${new Date(entry.at).toLocaleTimeString(undefined, { hour12: false })}</time>
          <span class="lvl ${entry.level}">${entry.level.toUpperCase()}</span>
          <span class="msg"><b>${esc(entry.process)}</b>: ${esc(entry.message)}</span></div>`).join('')
          : UI.empty('No matching messages', 'Adjust the filter or clear the search field.', { icon: 'console' })}</div>
        <div class="finder-status"><span>${Mac.plural(rows.length, 'message')}</span>
          <span>${Mac.state.logs.filter(entry => entry.level === 'error' || entry.level === 'fault').length} errors and faults</span></div>
      </div>`;
    },
  });

  /* -------------------------------------------------------------- Calculator */

  const Calculator = Mac.Calculator = {
    KEYS: [['AC', 'fn'], ['+/−', 'fn'], ['%', 'fn'], ['÷', 'op'],
      ['7', ''], ['8', ''], ['9', ''], ['×', 'op'],
      ['4', ''], ['5', ''], ['6', ''], ['−', 'op'],
      ['1', ''], ['2', ''], ['3', ''], ['+', 'op'],
      ['0', 'wide'], ['.', ''], ['=', 'op']],

    press(key) {
      const data = Mac.state.appData;
      let value = data.calculator || '0';

      if (key === 'AC') { value = '0'; data.calculatorTape = ''; }
      else if (key === '⌫') value = value.length > 1 ? value.slice(0, -1) : '0';
      else if (key === '+/−') value = value.startsWith('-') ? value.slice(1) : `-${value}`;
      else if (key === '%') {
        const number = parseFloat(value);
        value = Number.isFinite(number) ? String(number / 100) : 'Error';
      } else if (key === '=') {
        try {
          const expression = value.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
          if (!/^[-+*/.() \d]+$/.test(expression)) throw new Error('bad input');
          // eslint-disable-next-line no-new-func
          const result = Function(`"use strict";return (${expression})`)();
          data.calculatorTape = `${value} =`;
          value = Number.isFinite(result) ? String(Math.round(result * 1e10) / 1e10) : 'Error';
        } catch (error) { value = 'Error'; }
      } else if (value === '0' || value === 'Error') {
        value = /[\d.]/.test(key) ? (key === '.' ? '0.' : key) : value;
      } else {
        value += key;
      }

      data.calculator = value;
      Mac.save();
      Mac.wm.refresh('calculator');
    },
  };

  Mac.registerApp({
    id: 'calculator',
    title: 'Calculator',
    icon: 'calculator',
    category: 'Utilities',
    blurb: 'Basic arithmetic with a running tape.',
    size: [300, 440],
    min: [260, 380],
    singleton: true,
    render: () => `<div class="calculator">
      <div>
        <div class="calc-tape">${esc(Mac.state.appData.calculatorTape || '')}</div>
        <div class="calc-display">${esc(Mac.state.appData.calculator || '0')}</div>
      </div>
      <div class="calc-keys">${Calculator.KEYS.map(([key, kind]) =>
        `<button class="calc-key ${kind}" data-calc-key="${esc(key)}">${esc(key)}</button>`).join('')}</div></div>`,
  });

  /* ------------------------------------------------------------------- Notes */

  const Notes = Mac.Notes = {
    render(win) {
      const query = (win.state.query || '').trim().toLowerCase();
      const notes = Mac.state.notes
        .filter(note => !query || `${note.title} ${note.body}`.toLowerCase().includes(query))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);
      const selected = notes.find(note => note.id === win.state.selected) || notes[0];
      if (selected) win.state.selected = selected.id;

      return `<div class="app-shell">
        <aside class="sidebar notes-list">
          <div class="search"><span>${glyph('search')}</span>
            <input data-notes-search value="${esc(win.state.query || '')}" placeholder="Search" aria-label="Search notes"></div>
          ${notes.map(note => `<button class="note-item ${note.id === win.state.selected ? 'on' : ''}" data-note="${note.id}">
            <strong>${note.pinned ? '📌 ' : ''}${esc(note.title || 'New Note')}</strong>
            <p>${esc(new Date(note.updated).toLocaleDateString())} — ${esc(note.body.split('\n')[1] || 'No additional text')}</p></button>`).join('')}
          ${notes.length ? '' : '<p class="muted" style="padding:10px;font-size:11px">No notes match this search.</p>'}
        </aside>
        <section class="main-pane">${selected
          ? `<textarea class="note-editor" data-note-editor placeholder="Start typing…" aria-label="Note text">${esc(selected.body)}</textarea>`
          : UI.empty('No notes', 'Create a note to get started.', {
              icon: 'notes',
              action: '<button class="btn primary" data-command="new-note">New Note</button>',
            })}</section>
      </div>`;
    },

    save(win, value) {
      const note = Mac.state.notes.find(candidate => candidate.id === win.state.selected);
      if (!note) return;
      note.body = value;
      note.title = value.trim().split('\n')[0].slice(0, 48) || 'New Note';
      note.updated = Date.now();
      Mac.save();
    },

    create() {
      const note = { id: Mac.uid('note'), title: 'New Note', body: '', folder: 'Notes', pinned: false, updated: Date.now() };
      Mac.state.notes.unshift(note);
      Mac.save();
      const win = Mac.wm.open('notes');
      if (win) {
        win.state.selected = note.id;
        win.state.query = '';
        Mac.wm.render(win);
        setTimeout(() => win.el.querySelector('[data-note-editor]')?.focus(), 30);
      }
    },

    async remove(win) {
      const note = Mac.state.notes.find(candidate => candidate.id === win.state.selected);
      if (!note) return;
      const confirmed = await Mac.Dialog.confirm({
        title: `Delete “${note.title}”?`,
        body: 'This note will be deleted.',
        confirmLabel: 'Delete',
        danger: true,
        icon: 'trash',
      });
      if (!confirmed) return;
      Mac.state.notes = Mac.state.notes.filter(candidate => candidate.id !== note.id);
      win.state.selected = Mac.state.notes[0]?.id || null;
      Mac.save();
      Mac.wm.refresh('notes');
    },

    pin(win) {
      const note = Mac.state.notes.find(candidate => candidate.id === win.state.selected);
      if (!note) return;
      note.pinned = !note.pinned;
      Mac.save();
      Mac.wm.refresh('notes');
    },
  };

  Mac.registerApp({
    id: 'notes',
    title: 'Notes',
    icon: 'notes',
    category: 'Productivity',
    blurb: 'Runbooks, call notes and checklists.',
    size: [820, 540],
    min: [400, 280],
    initialState: () => ({ selected: null, query: '' }),
    toolbar: () => `<button class="tool-btn" data-command="new-note" aria-label="New note">${glyph('compose')}</button>
      <button class="tool-btn" data-command="pin-note" aria-label="Pin note">${glyph('bookmark')}</button>
      <button class="tool-btn" data-command="delete-note" aria-label="Delete note">${glyph('trash')}</button>`,
    menus: () => ({ File: [{ label: 'New Note', command: 'new-note', shortcut: '⌘N' }, { label: 'Delete Note', command: 'delete-note' }] }),
    render: win => Notes.render(win),
  });

  /* ---------------------------------------------------------------- TextEdit */

  Mac.registerApp({
    id: 'textedit',
    title: 'TextEdit',
    icon: 'textedit',
    category: 'Productivity',
    blurb: 'A plain document for call logs and reports.',
    size: [700, 560],
    min: [340, 260],
    titleFor: win => (win.state.fileId ? Mac.FS.node(win.state.fileId)?.name || 'Untitled' : 'Support Call Log.txt'),
    toolbar: () => `<button class="tool-btn" data-command="textedit-save">Save</button>
      <button class="tool-btn" data-command="print" aria-label="Print">${glyph('printer')}</button>`,
    render(win) {
      const node = win.state.fileId ? Mac.FS.node(win.state.fileId) : null;
      const body = node && node.ext !== 'txt' && node.ext !== 'rtf' && node.ext !== 'csv'
        ? `TextEdit cannot display “${node.name}”.\n\nThis file kind is not text. Open it in Preview instead.`
        : Mac.state.appData.textedit;
      return `<div style="display:flex;flex-direction:column;height:100%">
        <div class="format-bar">
          <button class="tool-btn" data-command="format" data-arg="bold"><b>B</b></button>
          <button class="tool-btn" data-command="format" data-arg="italic"><i>I</i></button>
          <button class="tool-btn" data-command="format" data-arg="underline"><u>U</u></button>
          <select class="field" data-command="format" style="width:70px"><option>12</option><option selected>14</option><option>18</option><option>24</option></select>
          <span class="muted" style="font-size:11px">${Mac.state.appData.textedit.length} characters</span>
        </div>
        <textarea class="text-area" data-textedit aria-label="Document text">${esc(body)}</textarea></div>`;
    },
  });

  /* ----------------------------------------------------------------- Preview */

  Mac.registerApp({
    id: 'preview',
    title: 'Preview',
    icon: 'preview',
    category: 'Productivity',
    blurb: 'View documents and images.',
    size: [680, 640],
    min: [340, 300],
    titleFor(win) {
      const node = win.state.fileId ? Mac.FS.node(win.state.fileId) : null;
      return node ? node.name : 'Preview';
    },
    toolbar: () => `<button class="tool-btn" data-command="preview-zoom" data-arg="out" aria-label="Zoom out">${glyph('minus')}</button>
      <button class="tool-btn" data-command="preview-zoom" data-arg="in" aria-label="Zoom in">${glyph('plus')}</button>
      <button class="tool-btn" data-command="print" aria-label="Print">${glyph('printer')}</button>`,
    render(win) {
      const node = win.state.fileId ? Mac.FS.node(win.state.fileId) : null;
      const zoom = Mac.state.appData.previewZoom || 1;
      if (!node) return '';
      const documentText = node.content || ({'f-guide':'Project Overview\n\nIdeas, milestones, and documents for the current project.','f-runbook':'Meeting Notes\n\nAgenda\nProject updates and upcoming milestones.','f-checklist':'Document\n\nNotes and reference material.'})[node.id] || node.name.replace(/\.[a-z0-9]+$/i,'');

      if (node && ['png', 'jpeg', 'jpg'].includes(node.ext)) {
        return `<div class="preview-stage"><div style="display:grid;place-items:center;min-height:100%">
          <div style="width:min(520px,86%);aspect-ratio:3/2;border-radius:8px;background:linear-gradient(140deg,#8fd0ff,#5a54d6);
            box-shadow:0 12px 40px rgba(0,0,0,.3);display:grid;place-items:center;color:#fff;transform:scale(${zoom})">
            <div style="text-align:center"><strong style="font-size:15px">${esc(node.name)}</strong>
            <p style="margin:6px 0 0;font-size:12px;opacity:.85">${Mac.bytes(node.size)}</p></div></div>
        </div></div>`;
      }

      return `<div class="preview-stage"><article class="preview-doc" data-preview-doc style="transform:scale(${zoom})">
        ${documentText.split('\n\n').map((text,i) => i === 0 ? `<h1>${esc(text)}</h1>` : `<p>${esc(text).replace(/\n/g,'<br>')}</p>`).join('')}
        <p style="margin-top:420px;color:#777;font-size:11px">1</p>
      </article></div>`;
    },
  });

  /* ------------------------------------------------- Screenshot / Time Machine */

  Mac.registerApp({
    id: 'screenshot',
    title: 'Screenshot',
    icon: 'screenshot',
    category: 'Utilities',
    blurb: 'Capture the screen, a window or a selection.',
    size: [520, 380],
    min: [340, 300],
    singleton: true,
    scrolls: true,
    render: () => `<div class="pane-pad">
      ${UI.header('Screenshot', 'Captures are written to the Desktop as PNG files.')}
      ${UI.group(
        UI.action('Capture Entire Screen', 'take-screenshot', 'Saves a full-screen PNG to the Desktop.', '', { arg: 'screen' }),
        UI.action('Capture Selected Window', 'take-screenshot', 'Captures the frontmost window.', '', { arg: 'window' }),
        UI.action('Capture Selected Portion', 'take-screenshot', 'Captures a region of the screen.', '', { arg: 'selection' }),
      )}
      ${UI.group(
        UI.select('Save to', 'settings.screenshotLocation', ['Desktop', 'Documents', 'Downloads', 'Clipboard']),
        UI.info('Shortcut', '⇧⌘3 / ⇧⌘4', ''),
      )}
      
    </div>`,
  });

  Mac.registerApp({
    id: 'time-machine',
    title: 'Time Machine',
    icon: 'time-machine',
    category: 'Utilities',
    blurb: 'Back up and restore this Mac.',
    size: [760, 520],
    min: [400, 300],
    singleton: true,
    scrolls: true,
    render() {
      const backup = Mac.state.volumes.find(volume => volume.id === 'vol-backup');
      const available = backup?.mounted !== false;
      return `<div class="pane-pad">
        ${UI.header('Time Machine', available ? 'Backing up to Time Machine Backup' : 'The backup disk is not available')}
        ${UI.group(
          UI.info('Backup disk', backup.name, '', `<span class="badge ${available ? 'ok' : 'bad'}">${available ? 'Connected' : 'Not connected'}</span>`),
          UI.info('Latest backup', available ? 'Today at 09:14' : 'Yesterday at 22:30'),
          UI.info('Oldest backup', '14 June 2026'),
          UI.info('Next backup', available ? 'In about 40 minutes' : 'When the disk is available'),
        )}
        ${UI.group(
          UI.action('Back Up Now', 'time-machine-backup', available ? 'Start a backup immediately.' : 'Connect the backup disk first.'),
          UI.action('Enter Time Machine', 'time-machine-browse', 'Browse and restore earlier versions of a file.'),
          UI.action(available ? 'Unmount Backup Disk' : 'Mount Backup Disk', 'disk-mount', '', '', { arg: 'vol-backup' }),
        )}
        ${!available ? `<div class="group"><div class="row"><div class="row-text">
          <strong class="danger-text">Backups are paused</strong>
          <p>Time Machine cannot back up because the disk “Time Machine Backup” is not mounted. </p></div></div></div>` : ''}
      </div>`;
    },
  });

  /* ----------------------------------------------- Keychain / System Info */

  Mac.registerApp({
    id: 'keychain',
    title: 'Passwords',
    icon: 'keychain',
    category: 'Utilities',
    blurb: 'Saved Wi-Fi and website passwords.',
    size: [760, 520],
    min: [400, 300],
    singleton: true,
    scrolls: true,
    render() {
      const wifi = Mac.state.wifi;
      const rows = wifi.saved.map(name => {
        const network = Mac.NETWORKS.find(candidate => candidate.name === name);
        return { name, kind: 'AirPort network password', secret: network?.password || '••••••••' };
      }).concat([
        { name: 'example.com', kind: 'Web form password', secret: 'support' },
        { name: 'support.example', kind: 'Web form password', secret: 'benchpass' },
      ]);
      return `<div class="pane-pad">
        ${UI.header('Passwords', '')}
        ${UI.group(...rows.map(row => UI.info(row.name, Mac.session.revealKeychain ? row.secret : '••••••••', row.kind)))}
        <div class="row-flex">
          <button class="btn" data-command="keychain-reveal">${Mac.session.revealKeychain ? 'Hide Passwords' : 'Show Passwords'}</button>
          <button class="btn" data-command="open-setting" data-arg="Wi-Fi">Manage Wi-Fi Networks</button></div>
        
      </div>`;
    },
  });

  Mac.registerApp({
    id: 'system-info',
    title: 'System Information',
    icon: 'system-info',
    category: 'Utilities',
    blurb: 'The full hardware and software report.',
    size: [860, 580],
    min: [420, 320],
    singleton: true,
    initialState: () => ({ section: 'Hardware' }),
    render(win) {
      const sections = ['Hardware', 'Network', 'Software', 'Storage', 'Power', 'Graphics'];
      const content = {
        Hardware: [['Model Name', 'MacBook Pro'], ['Model Identifier', 'Mac16,7'], ['Chip', 'Apple M4 Pro'],
          ['Total Number of Cores', '12 (8 performance and 4 efficiency)'], ['Memory', '24 GB'],
          ['System Firmware Version', '11881.61.3'], ['Serial Number', 'SIMULATED'], ['Hardware UUID', 'SIM-0000-0000-0000']],
        Network: [['Interface', 'en0'], ['Type', 'AirPort'], ['Hardware', 'Wi-Fi'],
          ['Status', Mac.state.wifi.current ? 'Connected' : 'Not connected'],
          ['Network', Mac.state.wifi.current || '--'], ['IPv4 Address', Mac.state.wifi.current ? Mac.state.wifi.ip : '--'],
          ['Router', Mac.state.wifi.current ? Mac.state.wifi.router : '--'], ['DNS', Mac.state.wifi.dns.join(', ') || 'None']],
        Software: [['System Version', `macOS ${Mac.OS.version()}`], ['Kernel Version', 'Darwin 27.0.1.0'],
          ['Boot Volume', 'Macintosh HD'], ['Boot Mode', Mac.session.safeMode ? 'Safe' : 'Normal'],
          ['Computer Name', Mac.state.settings.computerName], ['User Name', `${Mac.state.account.name} (alex)`],
          ['Secure Virtual Memory', 'Enabled'], ['FileVault', Mac.state.settings.fileVault ? 'Enabled' : 'Disabled']],
        Storage: Mac.state.volumes.map(volume => [volume.name,
          `${Mac.bytes(volume.totalBytes - volume.usedBytes)} free of ${Mac.bytes(volume.totalBytes)}`]),
        Power: [['Battery Charge', `${Mac.state.battery.percent}%`], ['Condition', Mac.state.battery.health],
          ['Cycle Count', String(Mac.state.battery.cycles)], ['Maximum Capacity', `${Mac.state.battery.capacity}%`],
          ['Temperature', Mac.state.battery.temperature], ['Power Source', Mac.state.battery.charging ? 'AC Power' : 'Battery'],
          ['Low Power Mode', Mac.state.settings.lowPowerMode ? 'On' : 'Off']],
        Graphics: [['Chipset Model', 'Apple M4 Pro'], ['Type', 'Built-In'], ['Total Number of Cores', '16'],
          ['Display', 'Built-in Liquid Retina XDR'], ['Resolution', '3024 x 1964 @ 120 Hz'],
          ['Framebuffer Depth', '30-Bit Colour']],
      }[win.state.section] || [];

      return `<div class="app-shell">
        <aside class="sidebar">${sections.map(section =>
          `<button class="side-item ${win.state.section === section ? 'on' : ''}" data-sysinfo-section="${section}">
            <span class="side-glyph">${glyph('info', { size: 15 })}</span>
            <span class="side-label">${section}</span></button>`).join('')}</aside>
        <section class="main-pane"><div class="pane-scroll"><div class="pane-pad">
          ${UI.header(win.state.section, `${Mac.state.settings.computerName} — macOS ${Mac.OS.version()}`)}
          ${UI.group(...content.map(([label, value]) => UI.info(label, value)))}
          <button class="btn" data-command="export-report">Save Report to Desktop</button>
        </div></div></section></div>`;
    },
  });

  /* -------------------------------------------------------- Migration / Freeform */

  Mac.registerApp({
    id: 'migration',
    title: 'Migration Assistant',
    icon: 'migration',
    category: 'Utilities',
    blurb: 'Move data from another Mac, a backup or a PC.',
    size: [620, 480],
    min: [380, 300],
    singleton: true,
    scrolls: true,
    render: () => `<div class="pane-pad">
      ${UI.header('Migration Assistant', 'Transfer information to this Mac.')}
      ${UI.group(
        UI.action('From a Mac, Time Machine backup or startup disk', 'migration-scan', 'Look for nearby sources.'),
        UI.action('From a Windows PC', 'migration-scan', 'Requires the Windows Migration Assistant.'),
        UI.action('To another Mac', 'migration-scan', 'Make this Mac the source.'),
      )}
      <p class="section-note">This assistant reports what a real scan would find. No data is moved.</p>
    </div>`,
  });

  Mac.registerApp({
    id: 'freeform',
    title: 'Freeform',
    icon: 'freeform',
    category: 'Creativity',
    blurb: 'A canvas for sketching out an escalation.',
    size: [800, 560],
    min: [360, 260],
    render: () => `<div class="pane-pad">
      ${UI.header('Freeform', 'Boards are shared with everyone in the escalation.')}
      <div class="tile-grid">
        ${['Wi-Fi decision tree', 'Captive portal flow', 'Escalation 4821', 'Bench layout'].map(name =>
          `<button class="tile"><div style="height:88px;border-radius:8px;background:linear-gradient(140deg,#8fd0ff,#6c5ce7);margin-bottom:8px"></div>
            <strong>${esc(name)}</strong><small>Edited ${Math.ceil(Math.random() * 9)} days ago</small></button>`).join('')}
      </div>
      
    </div>`,
  });
}(window.Mac));
