/* ===========================================================================
   Network: the Wi-Fi menu, join flow, details sheet, DHCP/DNS tools, the
   five-stage diagnostics run, captive portals, Ethernet, VPN and printers.

   This is the heart of the troubleshooting scenarios, so every failure mode is
   reachable: wrong password, unavailable network, portal sign-in, missing DNS,
   no address, proxy misconfiguration and a full network reset.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, UI } = Mac;

  const Network = Mac.Network = {
    wifi() { return Mac.state.wifi; },

    network(name) { return Mac.NETWORKS.find(candidate => candidate.name === name) || null; },

    /**
     * Why the Mac cannot reach the internet, or null when it can.
     *
     * This is the only place that decides. Safari, Mail, Outlook, the App
     * Store, Apple Account sign-in and the network test page all used to
     * carry their own copy of the check, and the copies had drifted: they
     * tested Wi-Fi, a current network and the captive portal, and stopped
     * there. So clearing the DNS servers or setting a bad proxy — two of the
     * faults this simulator goes out of its way to make reachable, with a
     * whole "Edit DNS" flow behind them — left Network Settings correctly
     * reporting "Connected — DNS not responding" while every app that actually uses the
     * network carried on as if nothing were wrong. The most instructive
     * faults in the simulator were the two that did nothing.
     *
     * Callers get the reason rather than a bare boolean so each can fail the
     * way the real thing fails: a DNS fault is a name that will not resolve,
     * a proxy fault is a connection that is refused, and neither looks like
     * being off Wi-Fi.
     *
     * @returns {'wifi-off'|'no-network'|'captive'|'no-dns'|'proxy'|null}
     */
    offlineReason() {
      const wifi = this.wifi();
      if (!wifi.enabled) return 'wifi-off';
      if (!wifi.current) return 'no-network';
      if (wifi.captive) return 'captive';
      if (wifi.dns.some(ip => ip === '203.0.113.53')) return 'no-dns';
      if (wifi.proxy) return 'proxy';
      return null;
    },

    online() {
      return this.offlineReason() === null;
    },

    /** Human summary used by menus, panes and the widget. */
    summary() {
      const wifi = this.wifi();
      return {
        'wifi-off': 'Off',
        'no-network': 'Not connected',
        captive: 'Connected — sign-in required',
        'no-dns': 'Connected — DNS not responding',
        proxy: 'Connected — proxy configured',
      }[this.offlineReason()] || `Connected to ${wifi.current}`;
    },

    /* -------------------------------------------------------------- menu bar */

    menu() {
      const wifi = this.wifi();
      const known = Mac.NETWORKS.filter(candidate => wifi.saved.includes(candidate.name) && candidate.name !== wifi.current);
      const others = Mac.NETWORKS.filter(candidate => !wifi.saved.includes(candidate.name) && candidate.name !== wifi.current);

      const item = network => `<button data-command="wifi-join" data-arg="${esc(network.name)}">
        <span class="check"></span><span>${esc(network.name)}</span>
        <span class="shortcut">${network.security === 'Open' ? '' : glyph('lock', { size: 11 })}${UI.signal(network.bars)}</span></button>`;

      return `<h3>Wi-Fi</h3>
        <div class="row"><div class="row-text"><strong>Wi-Fi</strong><p>${esc(this.summary())}</p></div>
          <button class="switch ${wifi.enabled ? 'on' : ''}" data-command="wifi-toggle" aria-label="Wi-Fi"></button></div>
        ${wifi.enabled ? `<div class="menu-list">
          ${wifi.current ? `<div class="menu-caption">Current network</div>
            <button data-command="wifi-details"><span class="check">✓</span><span>${esc(wifi.current)}</span>
              <span class="shortcut">${UI.signal(4)}</span></button>` : ''}
          ${known.length ? `<div class="menu-caption">Known networks</div>${known.map(item).join('')}` : ''}
          ${others.length ? `<div class="menu-caption">Other networks</div>${others.map(item).join('')}` : ''}
          <hr>
          <button data-command="wifi-hidden">Other Network…</button>
          <button data-command="run-diagnostics">Network Diagnostics…</button>
          <button data-command="open-setting" data-arg="Wi-Fi">Wi-Fi Settings…</button>
        </div>` : `<div class="menu-list"><button data-command="wifi-toggle">Turn Wi-Fi On</button></div>`}`;
    },

    /* ---------------------------------------------------------------- toggle */

    toggle(value) {
      const wifi = this.wifi();
      const next = value === undefined ? !wifi.enabled : Boolean(value);
      Mac.session.networkAttempt += 1;
      wifi.enabled = next;

      if (!next) {
        wifi.current = null;
        wifi.status = 'off';
        wifi.captive = false;
      } else {
        wifi.status = 'disconnected';
        // Rejoin the strongest saved network automatically, as macOS does.
        const auto = Mac.NETWORKS.filter(candidate =>
          wifi.saved.includes(candidate.name) && wifi.autoJoin[candidate.name] !== false && !candidate.unavailable).sort((a,b)=>b.bars-a.bars)[0];
        if (auto) {
          this.connect(auto, auto.password, { silent: true });
        }
      }

      Mac.save();
      Mac.sync();
      Mac.wm.refreshAll();
      Mac.Surfaces.refresh();
      Mac.Notify.show('Wi-Fi', next ? 'Wi-Fi is on.' : 'Wi-Fi is off. Apps that need the internet will report an error.',
        { app: 'settings', transient: true });
    },

    /** Decide what happens when a network is chosen. */
    join(name) {
      const network = this.network(name);
      if (!network) return;
      const wifi = this.wifi();

      if (!wifi.enabled) { this.toggle(true); return; }

      if (network.unavailable) {
        Mac.Dialog.open({
          title: `The Wi-Fi network “${network.name}” could not be joined`,
          icon: 'warning',
          body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">
            The network is temporarily unavailable. Move closer to the access point, wait a moment, or choose another network.</p>`,
          buttons: [
            { label: 'Cancel' },
            { label: 'Run Diagnostics', primary: true, action: () => this.diagnostics() },
          ],
        });
        return;
      }

      if (network.name === wifi.current) { this.details(); return; }

      const needsPassword = network.security !== 'Open' && !wifi.saved.includes(network.name);
      if (!needsPassword) { this.connect(network, network.password); return; }

      Mac.Dialog.open({
        title: `The Wi-Fi network “${network.name}” requires a password`,
        icon: 'wifi',
        body: `<div class="dialog-field"><label for="wifi-password">Password</label>
            <input id="wifi-password" type="password" autocomplete="off">
            <p class="field-error" id="wifi-password-error"></p></div>
          <button class="check-line" data-command="reveal-password" data-arg="wifi-password">
            <span class="checkbox" aria-hidden="true">✓</span><span>Show password</span></button>
          <button class="check-line" data-toggle-path="wifi.autoJoin.${esc(network.name)}">
            <span class="checkbox ${wifi.autoJoin[network.name] !== false ? 'on' : ''}" aria-hidden="true">✓</span>
            <span>Remember this network</span></button>`,
        buttons: [
          { label: 'Cancel', action: () => { Mac.session.networkAttempt += 1; } },
          {
            label: 'Join',
            primary: true,
            close: false,
            action: () => {
              const input = document.getElementById('wifi-password');
              if (!input.value) {
                document.getElementById('wifi-password-error').textContent = 'Enter the network password.';
                input.focus();
                return;
              }
              this.connect(network, input.value);
            },
          },
        ],
        onMount: () => setTimeout(() => document.getElementById('wifi-password')?.focus(), 30),
      });
    },

    /** The staged join sequence, with a real failure path for a bad password. */
    async connect(network, password = '', { silent = false } = {}) {
      const attempt = ++Mac.session.networkAttempt;
      const wifi = this.wifi();
      const phases = ['Joining the network', 'Authenticating', 'Obtaining an IP address',
        'Checking the internet connection', 'Connected'];

      if (!silent) {
        Mac.Dialog.open({
          title: 'Connecting to Wi-Fi…',
          icon: 'wifi',
          body: `<p style="margin:0 0 4px;font-size:12.5px;color:var(--text-2)">Joining <strong>${esc(network.name)}</strong></p>
            <div class="phase-list">${phases.map((phase, index) =>
              `<div class="phase" id="phase-${index}"><i>${index + 1}</i><span>${esc(phase)}</span></div>`).join('')}</div>
            <p class="field-error" id="connect-error"></p>`,
          buttons: [{ label: 'Cancel', action: () => { Mac.session.networkAttempt += 1; } }],
        });
      }

      wifi.status = 'joining';
      Mac.sync();

      for (let index = 0; index < phases.length; index += 1) {
        if (attempt !== Mac.session.networkAttempt || !wifi.enabled) return;
        Mac.$$('.phase').forEach((node, position) => {
          node.classList.toggle('done', position < index);
          node.classList.toggle('active', position === index);
        });

        if (index === 1 && network.security !== 'Open' && password !== network.password) {
          // eslint-disable-next-line no-await-in-loop
          await Mac.wait(420);
          const phase = document.getElementById(`phase-${index}`);
          phase?.classList.remove('active');
          phase?.classList.add('failed');
          const error = document.getElementById('connect-error');
          if (error) error.textContent = 'The Wi-Fi password is incorrect. Check for capital letters and try again.';
          wifi.status = 'disconnected';
          Mac.Dialog.setActions([
            { label: 'Cancel' },
            { label: 'Try Again', primary: true, action: () => this.join(network.name) },
          ]);
          return;
        }

        // eslint-disable-next-line no-await-in-loop
        await Mac.wait(index === phases.length - 1 ? 220 : 460);
      }

      if (attempt !== Mac.session.networkAttempt) return;

      wifi.current = network.name;
      wifi.status = 'connected';
      wifi.captive = Boolean(network.captive);
      wifi.ip = network.captive ? '10.44.0.87' : '192.168.1.42';
      wifi.router = network.captive ? '10.44.0.1' : '192.168.1.1';
      if (!wifi.saved.includes(network.name)) wifi.saved.push(network.name);
      if (wifi.autoJoin[network.name] === undefined) wifi.autoJoin[network.name] = true;
      Mac.save();

      if (!silent) Mac.Dialog.close();
      Mac.sync();
      Mac.wm.refreshAll();
      Mac.Notify.show('Wi-Fi', network.captive
        ? `Joined ${network.name}. Sign in to use the internet.`
        : `Connected to ${network.name}.`, { app: 'settings', transient: true });

      if (network.captive) {
        Mac.session.portalAgreed = false;
        const win = Mac.wm.open('safari');
        if (win) Mac.Browser.navigate(win, 'portal.local', { replace: true });
      }
      this.log('info', 'airportd', `Wi-Fi association complete: ${network.name} (channel ${network.channel})`);
    },

    hiddenNetwork() {
      Mac.Dialog.open({
        title: 'Find and join a Wi-Fi network',
        icon: 'wifi',
        body: `<div class="dialog-field"><label for="hidden-name">Network name</label><input id="hidden-name" autocomplete="off"></div>
          <div class="dialog-field"><label for="hidden-security">Security</label>
            <select id="hidden-security"><option>WPA2/WPA3 Personal</option><option>WPA2 Enterprise</option><option>None</option></select></div>
          <div class="dialog-field"><label for="hidden-password">Password</label><input id="hidden-password" type="password" autocomplete="off"></div>
          <p class="field-error" id="hidden-error"></p>`,
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Join',
            primary: true,
            close: false,
            action: () => {
              const name = document.getElementById('hidden-name').value.trim();
              const security = document.getElementById('hidden-security').value;
              const password = document.getElementById('hidden-password').value;
              const error = document.getElementById('hidden-error');
              if (!name) { error.textContent = 'Enter the network name.'; return; }
              if (Mac.NETWORKS.some(candidate => candidate.name.toLowerCase() === name.toLowerCase())) {
                error.textContent = 'That network is already visible in the list.';
                return;
              }
              if (security !== 'None' && password.length < 8) {
                error.textContent = 'The password must be at least 8 characters.';
                return;
              }
              const custom = {
                name,
                security: security === 'None' ? 'Open' : security,
                password,
                bars: 2,
                band: '2.4 GHz',
                channel: 6,
                custom: true,
              };
              Mac.NETWORKS.push(custom);
              this.connect(custom, password);
            },
          },
        ],
      });
    },

    details() {
      const wifi = this.wifi();
      if (!wifi.current) {
        Mac.Notify.show('Wi-Fi', 'Join a network to see its details.', { app: 'settings', transient: true });
        return;
      }
      const network = this.network(wifi.current);

      Mac.Dialog.open({
        title: wifi.current,
        icon: 'wifi',
        wide: false,
        body: UI.group(
          UI.info('Status', wifi.captive ? 'Connected — sign-in required' : 'Connected', '',
            `<span class="badge ${wifi.captive ? 'warn' : 'ok'}">${wifi.captive ? 'No Internet' : 'Internet'}</span>`),
          UI.info('Security', network?.security || 'WPA2 Personal'),
          UI.info('Band / channel', `${network?.band || '5 GHz'} — channel ${network?.channel || 44}`),
          UI.info('Signal', `${(network?.bars || 4) * 25}%`),
        ) + UI.group(
          UI.info('IP address', wifi.ip),
          UI.info('Subnet mask', wifi.subnet),
          UI.info('Router', wifi.router),
          UI.info('DNS servers', wifi.dns.join(', ') || 'None configured'),
          UI.info('Configure IPv4', wifi.dhcp ? 'Using DHCP' : 'Manually'),
        ) + UI.group(
          UI.toggle('Automatically join this network', `wifi.autoJoin.${wifi.current}`),
          UI.action('Renew DHCP Lease', 'renew-dhcp', 'Request a fresh address from the router.'),
          UI.action('DNS Servers…', 'edit-dns', wifi.dns.join(', ') || 'None'),
          UI.action('Run Diagnostics', 'run-diagnostics', ''),
        ),
        buttons: [
          { label: 'Forget This Network…', danger: true, close: false, action: () => this.forget(wifi.current) },
          { label: 'Done', primary: true },
        ],
      });
    },

    async forget(name) {
      const confirmed = await Mac.Dialog.confirm({
        title: `Forget the network “${name}”?`,
        body: 'This Mac will stop joining it automatically, and you will need the password to reconnect.',
        confirmLabel: 'Forget',
        danger: true,
      });
      if (!confirmed) return;

      const wifi = this.wifi();
      wifi.saved = wifi.saved.filter(candidate => candidate !== name);
      delete wifi.autoJoin[name];
      if (wifi.current === name) {
        wifi.current = null;
        wifi.status = 'disconnected';
        wifi.captive = false;
      }
      Mac.save();
      Mac.sync();
      Mac.wm.refreshAll();
      Mac.Notify.show('Wi-Fi', `${name} was forgotten.`, { app: 'settings', transient: true });
    },

    knownNetworks() {
      const wifi = this.wifi();
      Mac.Dialog.open({
        title: 'Known Networks',
        icon: 'wifi',
        body: wifi.saved.length
          ? UI.group(...wifi.saved.map(name => `<div class="row">
              <div class="row-text"><strong>${esc(name)}</strong>
                <p>Auto-join ${wifi.autoJoin[name] !== false ? 'on' : 'off'}${name === wifi.current ? ' — connected' : ''}</p></div>
              <div class="row-action">
                <button class="switch ${wifi.autoJoin[name] !== false ? 'on' : ''}" data-toggle-path="wifi.autoJoin.${esc(name)}"
                  data-after="known-networks" aria-label="Auto-join ${esc(name)}"></button>
                <button class="btn destructive" data-command="wifi-forget" data-arg="${esc(name)}">Forget</button></div></div>`))
          : UI.empty('No known networks', 'Networks you join are remembered here.', { icon: 'wifi' }),
        buttons: [{ label: 'Done', primary: true }],
      });
    },

    renewLease() {
      const wifi = this.wifi();
      if (!wifi.current) {
        Mac.Dialog.info('No network joined', 'Join a Wi-Fi network before renewing the DHCP lease.', 'warning');
        return;
      }
      Mac.Dialog.open({
        title: 'Renew DHCP lease?',
        icon: 'refresh',
        body: '<p style="margin:0;font-size:12.5px;color:var(--text-2)">The Mac releases its current address and requests a new one from the router. Existing connections may briefly drop.</p>',
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Renew',
            primary: true,
            action: async () => {
              Mac.Notify.show('Network', 'Renewing DHCP lease…', { app: 'settings', transient: true, duration: 1200 });
              await Mac.wait(800);
              const suffix = 30 + Math.floor(Math.random() * 60);
              wifi.ip = `192.168.1.${suffix}`;
              wifi.dhcp = true;
              Mac.save();
              Mac.wm.refreshAll();
              this.log('debug', 'configd', `DHCP lease acquired ${wifi.ip} / ${wifi.subnet}`);
              Mac.Notify.show('Network', `DHCP lease renewed — the address is now ${wifi.ip}.`, { app: 'settings' });
            },
          },
        ],
      });
    },

    /* Offered straight from Safari's proxy error page, so the fix is one
       click from the symptom rather than four panes away. */
    clearProxy() {
      const wifi = this.wifi();
      if (!wifi.proxy) {
        Mac.Dialog.info('No proxy configured', 'This network is not using a proxy server.', 'info');
        return;
      }
      wifi.proxy = false;
      Mac.save();
      Mac.wm.refreshAll();
      this.log('notice', 'configd', 'Proxy configuration cleared for the active service');
      Mac.Notify.show('Network', 'Proxy turned off. Reload the page to try again.', { app: 'settings' });
    },

    editDNS() {
      const wifi = this.wifi();
      Mac.Dialog.open({
        title: 'DNS Servers',
        icon: 'network',
        body: `<p style="margin:0 0 4px;font-size:12.5px;color:var(--text-2)">
            Enter one or more IPv4 addresses, separated by commas. </p>
          <div class="dialog-field"><label for="dns-field">DNS servers</label>
            <input id="dns-field" value="${esc(wifi.dns.join(', '))}" spellcheck="false" autocomplete="off">
            <p class="field-error" id="dns-error"></p></div>`,
        buttons: [
          { label: 'Cancel' },
          {
            label: 'OK',
            primary: true,
            close: false,
            action: () => {
              const raw = document.getElementById('dns-field').value;
              const values = raw.split(',').map(value => value.trim()).filter(Boolean);
              const valid = values.every(value =>
                /^(\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(part => Number(part) <= 255));
              if (!valid) {
                document.getElementById('dns-error').textContent = 'Enter valid IPv4 addresses separated by commas.';
                return;
              }
              wifi.dns = values;
              Mac.save();
              Mac.Dialog.close();
              Mac.wm.refreshAll();
              Mac.Notify.show('Network', values.length
                ? `DNS servers set to ${values.join(', ')}.`
                : 'DNS servers cleared — name resolution will now fail.', { app: 'settings' });
            },
          },
        ],
      });
    },

    /** Five-stage diagnostics with a real verdict based on the current state. */
    async diagnostics() {
      const wifi = this.wifi();
      const tests = ['Wi-Fi hardware', 'Network association', 'IP address assignment',
        'DNS resolution', 'Internet reachability'];
      const marker = ++Mac.session.networkAttempt;

      Mac.Dialog.open({
        title: 'Network Diagnostics',
        icon: 'activity',
        body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">Testing the network configuration on this Mac.</p>
          <div class="phase-list">${tests.map((test, index) =>
            `<div class="phase" id="diag-${index}"><i>${index + 1}</i><span>${esc(test)}</span></div>`).join('')}</div>
          <p id="diag-summary" style="margin:0;font-size:12.5px"></p>`,
        buttons: [{ label: 'Stop', action: () => { Mac.session.networkAttempt += 1; } }],
      });

      const verdicts = [
        wifi.enabled,
        wifi.enabled && Boolean(wifi.current),
        wifi.enabled && Boolean(wifi.current) && Boolean(wifi.ip),
        !wifi.dns.some(ip => ip === '203.0.113.53'),
        this.online(),
      ];

      for (let index = 0; index < tests.length; index += 1) {
        if (marker !== Mac.session.networkAttempt) return;
        const node = document.getElementById(`diag-${index}`);
        node?.classList.add('active');
        // eslint-disable-next-line no-await-in-loop
        await Mac.wait(420);
        node?.classList.remove('active');
        node?.classList.add(verdicts[index] ? 'done' : 'failed');
        if (!verdicts[index]) break;
      }

      if (marker !== Mac.session.networkAttempt) return;

      const failedAt = verdicts.findIndex(value => !value);
      wifi.lastDiagnostic = { at: Date.now(), ok: failedAt === -1, failedAt };
      Mac.save();

      const summary = document.getElementById('diag-summary');
      const advice = [
        'Wi-Fi is turned off. Turn it on from Control Centre or the Wi-Fi menu.',
        'This Mac is not associated with a network. Choose one from the Wi-Fi menu.',
        'No IP address was assigned. Renew the DHCP lease.',
        'The configured DNS server is unreachable. Check DNS in Wi-Fi Details.',
        wifi.captive ? 'The network requires a sign-in. Complete the captive portal page in Safari.'
          : wifi.proxy ? 'A proxy server is configured and unreachable. Turn the proxy off in Network settings.'
          : 'The network is reachable but the internet is not responding.',
      ];

      if (summary) {
        summary.innerHTML = failedAt === -1
          ? '<strong class="ok-text">No problems found.</strong> The connection is working normally.'
          : `<strong class="danger-text">A problem was found at “${esc(tests[failedAt])}”.</strong> ${esc(advice[failedAt])}`;
      }

      const actions = [{ label: 'Done', primary: failedAt === -1 }];
      if (failedAt === 0) actions.push({ label: 'Turn On Wi-Fi', primary: true, action: () => this.toggle(true) });
      else if (failedAt === 1) actions.push({ label: 'Open Wi-Fi Settings', primary: true, action: () => Mac.Settings.open('Wi-Fi') });
      else if (failedAt === 2) actions.push({ label: 'Renew Lease', primary: true, action: () => this.renewLease() });
      else if (failedAt === 3) actions.push({ label: 'Edit DNS', primary: true, action: () => this.editDNS() });
      else if (failedAt === 4 && wifi.captive) actions.push({ label: 'Open Sign-In Page', primary: true, action: () => {
        const win = Mac.wm.open('safari');
        if (win) Mac.Browser.navigate(win, 'portal.local', { replace: true });
      } });
      else if (failedAt === 4) actions.push({ label: 'Open Network Settings', primary: true, action: () => Mac.Settings.open('Network') });
      Mac.Dialog.setActions(actions);

      this.log(failedAt === -1 ? 'info' : 'error', 'networkQuality',
        failedAt === -1 ? 'Diagnostics passed: all five checks succeeded' : `Diagnostics failed at stage ${failedAt + 1}`);
    },

    /* -------------------------------------------------------- captive portal */

    portalAgree() {
      Mac.session.portalAgreed = !Mac.session.portalAgreed;
      const line = document.getElementById('portal-agree-line');
      line?.querySelector('.checkbox')?.classList.toggle('on', Mac.session.portalAgreed);
    },

    portalConnect() {
      if (!Mac.session.portalAgreed) {
        const error = document.getElementById('portal-error');
        if (error) error.textContent = 'Accept the policy to continue.';
        return;
      }
      const wifi = this.wifi();
      wifi.captive = false;
      Mac.save();
      Mac.sync();
      Mac.Notify.show('Wi-Fi', 'Sign-in complete — the internet is now available.', { app: 'safari' });
      const win = Mac.wm.forApp('safari')[0];
      if (win) Mac.Browser.navigate(win, 'network.test', { replace: true });
      Mac.wm.refreshAll();
    },

    portalCancel() {
      const wifi = this.wifi();
      wifi.current = null;
      wifi.captive = false;
      wifi.status = 'disconnected';
      Mac.save();
      Mac.sync();
      Mac.Notify.show('Wi-Fi', 'Sign-in cancelled — the network was disconnected.', { app: 'safari' });
      const win = Mac.wm.forApp('safari')[0];
      if (win) Mac.Browser.navigate(win, 'start', { replace: true });
      Mac.wm.refreshAll();
    },

    /* ------------------------------------------------------ ethernet and VPN */

    toggleEthernet() {
      const ethernet = Mac.state.ethernet;
      ethernet.cable = !ethernet.cable;
      ethernet.connected = ethernet.cable;
      Mac.save();
      Mac.wm.refreshAll();
      Mac.Notify.show('Network', ethernet.cable
        ? 'Ethernet cable connected — a wired address was assigned.'
        : 'Ethernet cable unplugged.', { app: 'settings', transient: true });
    },

    addVPN() {
      Mac.Dialog.open({
        title: 'Add VPN Configuration',
        icon: 'vpn',
        body: `<div class="dialog-field"><label for="vpn-name">Display name</label><input id="vpn-name" value="Support VPN"></div>
          <div class="dialog-field"><label for="vpn-server">Server address</label><input id="vpn-server" value="vpn.support.example"></div>
          <div class="dialog-field"><label for="vpn-type">VPN type</label>
            <select id="vpn-type"><option>IKEv2</option><option>L2TP over IPSec</option><option>Cisco IPSec</option></select></div>
          <p class="field-error" id="vpn-error"></p>
          <p class="muted" style="font-size:11px;margin:4px 0 0"></p>`,
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Create',
            primary: true,
            close: false,
            action: () => {
              const name = document.getElementById('vpn-name').value.trim();
              if (!name) { document.getElementById('vpn-error').textContent = 'Enter a display name.'; return; }
              Mac.state.vpn = { configured: true, connected: false, name };
              Mac.save();
              Mac.Dialog.close();
              Mac.wm.refreshAll();
              Mac.Notify.show('Network', `${name} was added.`, { app: 'settings', transient: true });
            },
          },
        ],
      });
    },

    toggleVPN() {
      const vpn = Mac.state.vpn;
      if (!vpn.configured) { this.addVPN(); return; }
      if (!this.online() && !vpn.connected) {
        Mac.Dialog.info('VPN cannot connect', 'A working internet connection is required before the VPN tunnel can be established.', 'warning');
        return;
      }
      vpn.connected = !vpn.connected;
      Mac.save();
      Mac.wm.refreshAll();
      Mac.Notify.show('VPN', vpn.connected ? `${vpn.name} connected.` : `${vpn.name} disconnected.`, { app: 'settings', transient: true });
    },

    removeVPN() {
      Mac.state.vpn = { configured: false, connected: false, name: '' };
      Mac.save();
      Mac.wm.refreshAll();
    },

    async resetNetwork() {
      const confirmed = await Mac.Dialog.confirm({
        title: 'Reset network settings?',
        body: 'All saved network settings will be removed.',
        confirmLabel: 'Reset',
        danger: true,
      });
      if (!confirmed) return;

      Object.assign(Mac.state.wifi, {
        enabled: true, current: null, status: 'disconnected', captive: false,
        saved: [], autoJoin: {}, dns: ['1.1.1.1', '8.8.8.8'], ip: '0.0.0.0',
        router: '', dhcp: true, lastDiagnostic: null, proxy: false,
      });
      Mac.state.vpn = { configured: false, connected: false, name: '' };
      Mac.state.ethernet = { connected: false, cable: false };
      Mac.save();
      Mac.sync();
      Mac.wm.refreshAll();
      Mac.Notify.show('Network', 'Network settings were reset. Rejoin a Wi-Fi network to continue.', { app: 'settings' });
    },

    /* -------------------------------------------------------------- printers */

    addPrinter() {
      const online = this.online();
      if (!Mac.state.settings.printerOnline) {
        Mac.Dialog.open({
          title: 'No printers were found',
          icon: 'printer',
          body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">
              macOS searched the local subnet${online ? '' : ' — but this Mac is offline, so discovery could not run'}.
              No printers are available.</p>`,
          buttons: [
            { label: 'Cancel' },
            {
              label: 'Search Again',
              primary: true,
              action: () => this.addPrinter(),
            },
          ],
        });
        return;
      }

      if (!online) {
        Mac.Dialog.info('Printer discovery failed', 'Bonjour discovery needs a working network connection.', 'warning');
        return;
      }

      Mac.state.printers = [{ id: 'printer-bench', name: 'Bench Laser 400', status: 'Idle', queue: 0, driver: 'Generic PostScript' }];
      Mac.save();
      Mac.wm.refreshAll();
      Mac.Notify.show('Printers & Scanners', 'Bench Laser 400 was added.', { app: 'settings' });
    },

    removePrinter() {
      Mac.state.printers = [];
      Mac.state.settings.printerOnline = false;
      Mac.save();
      Mac.wm.refreshAll();
    },

    printerQueue(id) {
      const printer = Mac.state.printers.find(candidate => candidate.id === id);
      if (!printer) return;
      Mac.Dialog.open({
        title: printer.name,
        icon: 'printer',
        body: printer.queue
          ? UI.group(...Array.from({ length: printer.queue }, (_, index) =>
              UI.info(`Document ${index + 1}`, 'Printing…', 'Submitted by alex')))
          : UI.empty('No jobs in the queue', 'Print from Preview or TextEdit to add a job.', { icon: 'printer' }),
        buttons: [
          { label: 'Done', primary: true },
          { label: 'Pause Printer', action: () => { printer.status = printer.status === 'Paused' ? 'Idle' : 'Paused'; Mac.save(); Mac.wm.refreshAll(); } },
        ],
      });
    },

    print() {
      const printer = Mac.state.printers[0];
      if (!printer) {
        Mac.Dialog.open({
          title: 'No printer is selected',
          icon: 'printer',
          body: '<p style="margin:0;font-size:12.5px;color:var(--text-2)">Add a printer before printing.</p>',
          buttons: [{ label: 'Cancel' }, { label: 'Add Printer…', primary: true, action: () => this.addPrinter() }],
        });
        return;
      }
      printer.queue += 1;
      Mac.save();
      Mac.Notify.show('Printers & Scanners', `1 document sent to ${printer.name}.`, { app: 'settings', transient: true });
      setTimeout(() => {
        printer.queue = Math.max(0, printer.queue - 1);
        Mac.save();
        Mac.wm.refreshAll();
      }, 2600);
    },

    /** Append an entry to the simulated unified log. */
    log(level, process, message) {
      Mac.state.logs.unshift({ at: Date.now(), level, process, message });
      Mac.state.logs = Mac.state.logs.slice(0, 200);
      Mac.save();
      Mac.wm.refresh('console');
    },
  };
}(window.Mac));
