/* ===========================================================================
   Power, session and recovery.

   Boot, login window, lock screen, sleep, shut down, Safe Mode, macOS
   Recovery, Erase All Content and Settings, and the Setup Assistant that runs
   after an erase. This is the full lifecycle a support agent walks a customer
   through.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, UI } = Mac;

  const SCREENS = ['boot-screen', 'login-screen', 'lock-screen', 'sleep-screen',
    'power-off-screen', 'recovery-screen', 'setup-screen'];

  /* -------------------------------------------------------- software update */

  const OS_UPDATE = {
    version: '27.0.1', build: 'SIMULATED-BUILD', bytes: 7194841088,
    notes: 'Resolves a Platform SSO Lock Screen issue; simulated installation of the current release',
  };

  /**
   * The macOS update, from "available" to a Mac running the new build.
   *
   * Software Update used to show a permanent "Up to date" badge with no
   * update behind it, so the single thing that pane exists for — running an
   * update — could not be practised. It lives next to Power because the
   * install genuinely restarts the machine, and a version string that
   * changes without a restart is the clearest possible tell that nothing
   * actually happened.
   */
  const OS = Mac.OS = {
    update() { return Object.assign({}, OS_UPDATE, Mac.state.osUpdate); },
    version() { return Mac.state.osVersion || Mac.OS_VERSION; },
    build() { return Mac.state.osBuild || Mac.OS_BUILD; },
    pending() { return this.version() !== OS_UPDATE.version; },

    /** Blockers the real installer checks before it will start. */
    blocker() {
      if (!Mac.Network.online()) return ['Unable to check for updates', Mac.Network.summary()];
      const volume = Mac.state.volumes[0];
      if (volume.totalBytes - volume.usedBytes < OS_UPDATE.bytes)
        return ['Not enough disk space',
          `This update needs ${Mac.bytes(OS_UPDATE.bytes)} and only ${Mac.bytes(volume.totalBytes - volume.usedBytes)} is available. Empty the Trash or remove some files first.`];
      if (Mac.state.battery && Mac.state.battery.percent < 20 && !Mac.state.battery.charging)
        return ['Connect to power', 'Plug in your Mac, or charge it above 20%, before installing an update.'];
      return null;
    },

    run(step) {
      const state = Mac.state.osUpdate;
      if (step === 'install' || state.stage === 'downloaded') return this.install();
      const blocker = this.blocker();
      if (blocker) return Mac.Dialog.info(blocker[0], blocker[1], 'warning');
      state.stage = 'downloading';
      state.progress = 0;
      Mac.save();
      Mac.wm.refreshAll();
      this.tick(() => {
        state.stage = 'downloaded';
        state.progress = 0;
        Mac.save();
        Mac.wm.refreshAll();
        Mac.Notify.show('Software Update',
          `macOS Golden Gate ${OS_UPDATE.version} has been downloaded and is ready to install.`, { app: 'settings' });
      });
    },

    install() {
      Mac.Dialog.open({
        title: `Install macOS Golden Gate ${OS_UPDATE.version}?`,
        icon: 'update',
        body: '<p style="margin:0;font-size:12.5px;color:var(--text-2)">Your Mac will restart to finish installing. Open applications will be closed.</p>',
        buttons: [
          { label: 'Later' },
          {
            label: 'Restart',
            primary: true,
            action: () => {
              const state = Mac.state.osUpdate;
              state.stage = 'installing';
              state.progress = 0;
              Mac.save();
              Mac.wm.refreshAll();
              this.tick(() => {
                Mac.state.osVersion = OS_UPDATE.version;
                Mac.state.osBuild = OS_UPDATE.build;
                Mac.state.osUpdate = { stage: 'installed', progress: 100 };
                Mac.save();
                Mac.Power.execute('restart');
                Mac.Notify.show('Software Update',
                  `This Mac is now running macOS Golden Gate ${OS_UPDATE.version}.`, { app: 'settings' });
              });
            },
          },
        ],
      });
    },

    /* One interval, held on the module rather than in a closure, so a second
       click cannot start a second one racing the first. */
    tick(done) {
      clearInterval(this._timer);
      this._timer = setInterval(() => {
        const state = Mac.state.osUpdate;
        state.progress = Math.min(100, state.progress + (state.stage === 'downloading' ? 8 : 14));
        Mac.wm.refreshAll();
        if (state.progress >= 100) {
          clearInterval(this._timer);
          this._timer = null;
          done();
        }
      }, 300);
    },

    /* A transfer interrupted by a reload cannot resume — its interval is
       gone — so it rewinds to something the user can act on instead of
       sitting at a percentage that will never move. */
    recover() {
      const state = Mac.state.osUpdate;
      if (!state) return;
      if (state.stage === 'downloading') { state.stage = 'available'; state.progress = 0; }
      if (state.stage === 'installing') { state.stage = 'downloaded'; state.progress = 0; }
    },
  };

  const Screens = Mac.Screens = {
    show(id) {
      SCREENS.forEach(name => Mac.$(`#${name}`).classList.toggle('hidden', name !== id));
      Mac.$('#desktop').classList.toggle('hidden', Boolean(id));
      Mac.Surfaces.close();
      Mac.Dialog.close();
      Mac.Shell.closeLaunchpad?.();
      Mac.MissionControl.close();
      if (id === 'login-screen') this.renderLogin();
      if (id === 'lock-screen') this.renderLock();
      if (id === 'recovery-screen') Mac.Power.renderRecovery();
      if (id === 'setup-screen') Mac.Setup.render();
    },

    desktop() {
      SCREENS.forEach(name => Mac.$(`#${name}`).classList.add('hidden'));
      Mac.$('#desktop').classList.remove('hidden');
      setTimeout(() => Mac.wm.reflow(), 60);
    },

    /** Animated startup sequence. */
    boot(next = 'login-screen', { note = '' } = {}) {
      this.show('boot-screen');
      const bar = Mac.$('#boot-progress');
      const label = Mac.$('#boot-note');
      Mac.$('#boot-mark').innerHTML = Mac.appleMark();
      Mac.$('#off-mark').innerHTML = Mac.appleMark();
      if (label) label.textContent = note;
      if (bar) {
        bar.style.width = '0';
        requestAnimationFrame(() => { bar.style.width = '100%'; });
      }
      clearTimeout(this.bootTimer);
      this.bootTimer = setTimeout(() => this.show(next), 1650);
    },

    statusBar() {
      const battery = Mac.state.battery;
      const wifi = Mac.state.wifi;
      return `${glyph(wifi.enabled && wifi.current ? 'wifi' : 'wifi-off')}
        <span>${battery.percent}%</span>
        <span class="lock-status-clock">${Mac.formatTime()}</span>`;
    },

    powerActions(list) {
      const labels = { sleep: ['Sleep', 'moon'], restart: ['Restart', 'restart'], shutdown: ['Shut Down', 'power'] };
      return list.map(key => `<span class="screen-action">
        <button data-command="power" data-arg="${key}" aria-label="${labels[key][0]}">${glyph(labels[key][1])}</button>
        <span>${labels[key][0]}</span></span>`).join('');
    },

    renderLogin() {
      const s = Mac.state.settings;
      const account = Mac.state.account;
      Mac.$('#login-status').innerHTML = this.statusBar();
      Mac.$('#login-actions').innerHTML = s.showPowerButtons ? this.powerActions(['sleep', 'restart', 'shutdown']) : '';

      const users = s.guestUser
        ? [{ name: account.name, initials: account.initials, id: 'isaiah' }, { name: 'Guest User', initials: 'G', id: 'guest' }]
        : [{ name: account.name, initials: account.initials, id: 'isaiah' }];

      if (s.loginWindowShows === 'Name and password') {
        Mac.$('#login-body').innerHTML = `<div class="auth-card centered">
          ${UI.avatar(account.name, { initials: account.initials })}
          <h1>Log in to ${esc(s.computerName)}</h1>
          <form class="auth-form" id="login-form" style="width:250px;margin-bottom:8px">
            <input id="login-user" value="isaiah" aria-label="User name" autocomplete="off"></form>
          <form class="auth-form" id="login-form-password">
            <input id="login-password" type="password" placeholder="Password" aria-label="Password" autocomplete="off">
            <button type="submit" aria-label="Log in">${glyph('forward', { size: 13 })}</button></form>
          <div class="auth-error" id="login-error" role="alert"></div>
          ${s.passwordHints ? `<p class="auth-hint">Hint: the lab password is “${esc(Mac.LOGIN_PASSWORD)}”</p>` : ''}</div>`;
        return;
      }

      Mac.$('#login-body').innerHTML = `<div style="display:grid;gap:26px;justify-items:center">
        <div class="user-list">${users.map(user => `<button class="user-choice ${user.id === (Mac.session.loginUser || 'isaiah') ? 'on' : ''}"
          data-command="login-user" data-arg="${user.id}">
          ${UI.avatar(user.name, { initials: user.initials })}<span>${esc(user.name)}</span></button>`).join('')}</div>
        <div class="auth-card centered">
          ${(Mac.session.loginUser || 'isaiah') === 'guest'
            ? '<form class="auth-form" id="login-form"><input value="No password required" disabled aria-label="Guest"><button type="submit" aria-label="Log in">→</button></form>'
            : `<form class="auth-form" id="login-form">
                <input id="login-password" type="password" placeholder="Enter Password" aria-label="Password" autocomplete="off">
                <button type="submit" aria-label="Log in">${glyph('forward', { size: 13 })}</button></form>`}
          <div class="auth-error" id="login-error" role="alert"></div>
          </div></div>`;
    },

    renderLock() {
      const s = Mac.state.settings;
      const account = Mac.state.account;
      Mac.$('#lock-status').innerHTML = this.statusBar();
      Mac.$('#lock-actions').innerHTML = s.showPowerButtons ? this.powerActions(['restart', 'shutdown']) : '';
      Mac.$('#lock-time').classList.toggle('hidden', !s.largeLockClock);
      Mac.$('#lock-auth').innerHTML = `${UI.avatar(account.name, { initials: account.initials })}
        <h1>${esc(account.name)}</h1>
        <form class="auth-form" id="unlock-form">
          <input id="unlock-password" type="password" placeholder="Enter Password" aria-label="Password" autocomplete="off">
          <button type="submit" aria-label="Unlock">${glyph('forward', { size: 13 })}</button></form>
        <div class="auth-error" id="unlock-error" role="alert"></div>
        
        ${s.showLockMessage ? `<p class="lock-message">${esc(s.lockMessage)}</p>` : ''}`;
      Mac.Shell.updateClock();
      setTimeout(() => Mac.$('#unlock-password')?.focus(), 60);
    },

    login(password, { guest = false } = {}) {
      const error = Mac.$('#login-error');
      if (!guest && password !== Mac.LOGIN_PASSWORD) {
        if (error) error.textContent = 'Incorrect password. The lab password is “support”.';
        const input = Mac.$('#login-password');
        input?.select();
        return false;
      }
      if (error) error.textContent = '';
      Mac.state.stats.logins += 1;
      Mac.state.stats.lastBoot = Date.now();
      Mac.save();
      this.desktop();
      Mac.sync();

      if (!Mac.wm.windows.size) Mac.wm.open('finder', { state: { location: 'recents' } });
      if (Mac.session.safeMode) {
        Mac.Notify.show('Safe Boot', 'This Mac started in Safe Mode. Third-party extensions and some visual effects are disabled.', { app: 'settings' });
      }
      if (guest) {
        Mac.Notify.show('Guest User', 'You are logged in as Guest. Files created in this session are removed at log out.', { app: 'settings' });
      }
      return true;
    },

    unlock(password) {
      const error = Mac.$('#unlock-error');
      if (password !== Mac.LOGIN_PASSWORD) {
        if (error) error.textContent = 'Incorrect password.';
        Mac.$('#unlock-password')?.select();
        return false;
      }
      if (error) error.textContent = '';
      this.desktop();
      return true;
    },
  };

  /* ---------------------------------------------------------------- power */

  const Power = Mac.Power = {
    /** Confirm destructive/session-ending actions before running them. */
    request(type) {
      const prompts = {
        restart: ['Are you sure you want to restart your computer now?',
          'Open apps will close and the startup sequence will run again.', 'Restart'],
        shutdown: ['Are you sure you want to shut down your computer now?',
          'You can power it on again from the powered-off screen.', 'Shut Down'],
        logout: [`Are you sure you want to log out now?`,
          'Open apps will close. Saved files and settings remain.', 'Log Out'],
        recovery: ['Restart in macOS Recovery?',
          'The Mac restarts into the recovery environment, where Disk Utility and the Erase Assistant are available.', 'Restart'],
        safe: ['Restart in Safe Mode?',
          'Safe Mode loads a minimal system: third-party extensions and some visual effects are disabled.', 'Restart'],
      }[type];

      if (!prompts) { this.execute(type); return; }

      Mac.Dialog.open({
        title: prompts[0],
        icon: type === 'shutdown' ? 'power' : 'restart',
        body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">${esc(prompts[1])}</p>`,
        buttons: [
          { label: 'Cancel' },
          { label: prompts[2], primary: type !== 'shutdown', danger: type === 'shutdown', action: () => this.execute(type) },
        ],
      });
    },

    execute(type) {
      Mac.Surfaces.close();

      if (type === 'lock') { Screens.show('lock-screen'); return; }
      if (type === 'sleep') { Screens.show('sleep-screen'); return; }

      if (type === 'logout') {
        this.closeEverything();
        Mac.session.loginUser = 'isaiah';
        Screens.show('login-screen');
        return;
      }
      if (type === 'shutdown') {
        this.closeEverything();
        Screens.show('power-off-screen');
        return;
      }
      if (type === 'recovery') {
        this.closeEverything();
        Mac.session.safeMode = false;
        Screens.boot('recovery-screen', { note: 'Loading startup options…' });
        return;
      }
      if (type === 'safe') {
        this.closeEverything();
        Mac.session.safeMode = true;
        Screens.boot('login-screen', { note: 'Safe Boot' });
        return;
      }
      if (type === 'restart') {
        this.closeEverything();
        Mac.session.safeMode = false;
        Screens.boot('login-screen');
      }
    },

    closeEverything() {
      [...Mac.wm.windows.keys()].forEach(id => Mac.wm.close(id));
      Mac.wm.windows.clear();
      Mac.wm.order = [];
      Mac.session.fullscreenWindow = null;
      Mac.$('#menu-bar').classList.remove('autohidden');
      Mac.$('#window-layer').innerHTML = '';
      Mac.Shell.renderDock();
    },

    forceQuitDialog() {
      const running = [...new Set([...Mac.wm.windows.values()].map(win => win.appId))];
      Mac.Dialog.open({
        title: 'Force Quit Applications',
        icon: 'close',
        body: running.length
          ? `<p style="margin:0 0 10px;font-size:12.5px;color:var(--text-2)">
              Select an application and click Force Quit. You will lose unsaved changes.</p>
            ${UI.group(...running.map(id => `<button class="row tappable" data-command="force-quit-app" data-arg="${id}">
              <span class="store-row-app" style="width:26px;height:26px">${Mac.appIcon(Mac.apps[id].icon)}</span>
              <div class="row-text"><strong>${esc(Mac.apps[id].title)}</strong>
                <p>${Mac.plural(Mac.wm.forApp(id).length, 'window')}</p></div>
              <span class="badge">Running</span></button>`))}`
          : UI.empty('No applications are running', 'Open an app from the Dock or Launchpad first.', { icon: 'apps' }),
        buttons: [
          { label: 'Done', primary: true },
          { label: 'Relaunch Finder', action: () => { Mac.wm.closeApp('finder'); Mac.wm.open('finder'); } },
        ],
      });
    },

    /* -------------------------------------------------------------- recovery */

    recoveryState: { detail: null, running: false },

    renderRecovery() {
      const tiles = [
        ['restore', 'Restore from Time Machine', 'Restore your files from a Time Machine backup.', 'time-machine'],
        ['reinstall', 'Reinstall macOS Golden Gate', 'Check the installer and network before reinstalling.', 'update'],
        ['safari', 'Safari', 'Open offline recovery guidance.', 'globe'],
        ['disk', 'Disk Utility', 'Verify and repair the virtual startup volume.', 'disk'],
        ['erase', 'Erase Assistant', 'Erase all content and settings.', 'warning'],
        ['startup', 'Startup Security', 'Review the secure boot policy.', 'shield'],
      ];

      Mac.$('#recovery-body').innerHTML = `
        <div class="apple-mark">${Mac.appleMark()}</div>
        <h1>macOS Recovery</h1>
        <p>Choose a utility to restore this Mac.</p>
        <div class="panel-grid">${tiles.map(([id, title, text, icon]) =>
          `<button class="panel-tile ${this.recoveryState.detail === id ? 'on' : ''}" data-command="recovery" data-arg="${id}">
            <strong>${glyph(icon)}${esc(title)}</strong><span>${esc(text)}</span></button>`).join('')}</div>
        <div id="recovery-detail">${this.recoveryDetail()}</div>
        <div class="panel-foot">
          
          <div class="row-flex">
            <button class="btn" data-command="power" data-arg="exit-recovery">Exit Recovery</button>
            <button class="btn primary" data-command="power" data-arg="restart">Restart</button></div></div>`;
    },

    recoveryDetail() {
      const detail = this.recoveryState.detail;
      if (!detail) return '';
      const online = Mac.Network.online();

      const bodies = {
        restore: UI.group(
          UI.info('Backup disks found', Mac.state.volumes.some(volume => volume.id === 'vol-backup' && volume.mounted !== false)
            ? '1 — Time Machine Backup' : 'None'),
          UI.info('Latest snapshot', 'Today at 09:14'),
          UI.action('Continue', 'recovery', 'Choose a snapshot to restore from.', '', { arg: 'restore-run' }),
        ),
        'restore-run': UI.group(UI.info('Restore complete',
          'The backup disk is not available.', '')),
        reinstall: UI.group(
          UI.info('Installer', online ? 'Ready to download' : 'Unavailable — no network',
            online ? 'macOS Golden Gate 27.0.1 (12.7 GB)' : 'Connect to a network before reinstalling.',
            `<span class="badge ${online ? 'ok' : 'bad'}">${online ? 'Reachable' : 'Offline'}</span>`),
          UI.info('Destination', 'Macintosh HD'),
          online ? UI.action('Continue', 'recovery', 'Verify the installer package.', '', { arg: 'reinstall-run' })
            : UI.action('Open Wi-Fi Settings', 'open-setting', 'Join a network first.', '', { arg: 'Wi-Fi' }),
        ),
        'reinstall-run': UI.group(UI.info('Installer verified',
          'No changes made', 'macOS could not be reinstalled. Try again later.')),
        safari: UI.group(
          UI.info('Recovery help', 'Offline article',
            'Use Disk Utility for First Aid, or the Erase Assistant to return this Mac to factory settings.'),
          UI.action('Open Startup Key Combinations', 'recovery', '', '', { arg: 'keys' }),
        ),
        keys: `<table class="shortcut-table">
          <tr><td>Recovery</td><td>Hold the power button</td></tr>
          <tr><td>Safe Mode</td><td>Hold Shift</td></tr>
          <tr><td>Startup Manager</td><td>Hold Option</td></tr>
          <tr><td>Reset NVRAM</td><td>Option-Command-P-R</td></tr></table>`,
        disk: UI.group(
          UI.info('Macintosh HD', `${Mac.bytes(Mac.state.volumes[0].totalBytes)} APFS`,
            `${Mac.bytes(Mac.state.volumes[0].totalBytes - Mac.state.volumes[0].usedBytes)} available`),
          UI.info('SMART status', 'Verified', '', '<span class="badge ok">Verified</span>'),
          UI.action('Run First Aid', 'recovery', 'Verify and repair the volume.', '', { arg: 'first-aid' }),
        ),
        'first-aid': `<div class="group"><div class="row block">
          <pre class="mono" style="margin:0;font-size:11px;white-space:pre-wrap">${esc(this.recoveryState.report || 'Running First Aid…')}</pre></div></div>`,
        erase: UI.group(
          `<div class="row"><div class="row-text"><strong class="danger-text">Erase Assistant</strong>
            <p>Erase all content and settings on this Mac.</p></div>
            <button class="btn destructive" data-command="factory-reset">Continue…</button></div>`,
        ),
        startup: UI.group(
          UI.info('Security policy', 'Full Security', 'Only signed operating systems may start up.'),
          UI.info('FileVault', Mac.state.settings.fileVault ? 'On' : 'Off'),
          UI.info('Secure Boot', 'Enabled'),
        ),
      };

      return `<div style="margin-top:6px">${bodies[detail] || ''}</div>`;
    },

    async recovery(action) {
      if (action === 'first-aid') {
        this.recoveryState.detail = 'first-aid';
        this.recoveryState.report = '';
        const lines = ['Running First Aid on “Macintosh HD”', 'Checking the container superblock…',
          'Checking the object map…', 'Verifying allocated space…', 'The volume appears to be OK.',
          'Operation successful.'];
        for (const line of lines) {
          this.recoveryState.report += `${line}\n`;
          this.renderRecovery();
          // eslint-disable-next-line no-await-in-loop
          await Mac.wait(380);
        }
        return;
      }
      this.recoveryState.detail = action;
      this.renderRecovery();
    },

    /* -------------------------------------------------------- factory reset */

    factoryReset() {
      Mac.Dialog.open({
        title: 'Erase all content and settings?',
        icon: 'warning',
        body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">This erases all content and settings on this Mac.
            </p>
          <ul class="dialog-list">
            <li>Settings, appearance and Dock preferences</li>
            <li>Saved Wi-Fi networks, DNS and VPN configuration</li>
            <li>Files, folders and the Trash</li>
            <li>Notes, Mail and Outlook messages</li>
            <li>Browser history, bookmarks and downloads</li>
            <li>The Apple Account sign-in state</li>
          </ul>
          <p style="margin:10px 0 0;font-size:12.5px;color:var(--text-2)">
            All data on this Mac will be erased.</p>`,
        buttons: [
          { label: 'Cancel' },
          { label: 'Continue', danger: true, action: () => this.factoryConfirm() },
        ],
      });
    },

    factoryConfirm() {
      Mac.Dialog.open({
        title: 'Confirm erase',
        icon: 'warning',
        body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">
            Enter the administrator password to continue.</p>
          <div class="dialog-field"><label for="erase-password">Administrator password</label>
            <input id="erase-password" type="password" autocomplete="off"></div>

          <p class="field-error" id="erase-error"></p>`,
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Erase This Mac',
            danger: true,
            close: false,
            action: () => {
              const password = document.getElementById('erase-password').value;

              const error = document.getElementById('erase-error');
              if (password !== Mac.LOGIN_PASSWORD) { error.textContent = 'Incorrect administrator password.'; return; }

              Mac.Dialog.close();
              this.performReset();
            },
          },
        ],
        onMount: () => setTimeout(() => document.getElementById('erase-password')?.focus(), 30),
      });
    },

    /** Wipe stored state and run Setup Assistant. */
    async performReset({ silent = false } = {}) {
      const resets = (Mac.state.stats?.resets || 0) + 1;
      this.closeEverything();
      Screens.show('boot-screen');
      const bar = Mac.$('#boot-progress');
      const note = Mac.$('#boot-note');
      if (note) note.textContent = 'Erasing all content and settings…';
      if (bar) { bar.style.width = '0'; requestAnimationFrame(() => { bar.style.width = '100%'; }); }

      Mac.Store.clear();
      Mac.state = Mac.clone(Mac.DefaultState);
      Mac.state.stats.resets = resets;
      Mac.state.notifications = [];
      Mac.save();

      Mac.session.networkAttempt += 1;
      Mac.session.space = 0;
      Mac.session.safeMode = false;
      Mac.session.activeApp = 'finder';
      Mac.session.activeWindow = null;
      Mac.session.installing = {};
      Mac.sync();

      await Mac.wait(silent ? 200 : 1900);
      Mac.Setup.start();
    },
  };

  /* --------------------------------------------------------- Setup Assistant */

  const Setup = Mac.Setup = {
    step: 0,
    choices: {},

    STEPS: [
      { id: 'welcome', title: 'Welcome', subtitle: 'Choose your country or region.' },
      { id: 'language', title: 'Select Your Region', subtitle: 'This helps set the language, time zone and formats.' },
      { id: 'network', title: 'Connect to Wi-Fi', subtitle: 'A network connection is needed to sign in to an Apple Account.' },
      { id: 'account', title: 'Sign In with Your Apple Account', subtitle: 'iCloud, the App Store and Find My use this account.' },
      { id: 'appearance', title: 'Choose Your Look', subtitle: 'You can change this later in System Settings.' },
      { id: 'finish', title: 'Setting Up Your Mac', subtitle: 'This takes just a moment.' },
    ],

    start() {
      this.step = 0;
      this.choices = { region: 'United States', appearance: 'light', signIn: true };
      Screens.show('setup-screen');
    },

    next() {
      const current = this.STEPS[this.step];

      if (current.id === 'network' && !Mac.state.wifi.current) {
        Mac.Dialog.open({
          title: 'Continue without a network?',
          icon: 'wifi-off',
          body: '<p style="margin:0;font-size:12.5px;color:var(--text-2)">You can set up this Mac without Wi-Fi, but you will not be able to sign in to an Apple Account until you connect.</p>',
          buttons: [
            { label: 'Back' },
            { label: 'Continue', primary: true, action: () => { this.choices.signIn = false; this.step += 2; this.render(); } },
          ],
        });
        return;
      }

      if (this.step >= this.STEPS.length - 1) { this.complete(); return; }
      this.step += 1;
      this.render();
      if (this.STEPS[this.step].id === 'finish') setTimeout(() => this.complete(), 2200);
    },

    back() {
      if (this.step === 0) return;
      this.step -= 1;
      this.render();
    },

    render() {
      const step = this.STEPS[this.step];
      Mac.$('#setup-body').innerHTML = `
        <div class="apple-mark">${Mac.appleMark()}</div>
        <h1>${esc(step.title)}</h1>
        <p>${esc(step.subtitle)}</p>
        <div style="margin:20px 0">${this.stepBody(step.id)}</div>
        <div class="panel-foot">
          <div class="panel-steps">${this.STEPS.map((_, index) =>
            `<i class="${index <= this.step ? 'on' : ''}"></i>`).join('')}</div>
          <div class="row-flex">
            ${this.step && step.id !== 'finish' ? '<button class="btn" data-command="setup-back">Back</button>' : ''}
            ${step.id === 'finish' ? '' : `<button class="btn primary" data-command="setup-next">${step.id === 'appearance' ? 'Continue' : 'Continue'}</button>`}
          </div></div>`;
    },

    stepBody(id) {
      if (id === 'welcome') {
        return UI.group(
          UI.info('Model', 'MacBook Pro 14-inch, M4 Pro'),
          UI.info('macOS', `Golden Gate ${OS.version()}`),
          UI.info('Storage', `${Mac.bytes(Mac.state.volumes[0].totalBytes)} — erased`),
        ) + '<p class="section-note">Everything from the previous session has been removed. The lab password is “support”.</p>';
      }

      if (id === 'language') {
        const regions = ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'Japan'];
        return `<div class="panel-grid">${regions.map(region =>
          `<button class="panel-tile ${this.choices.region === region ? 'on' : ''}" data-command="setup-region" data-arg="${esc(region)}">
            <strong>${glyph('globe')}${esc(region)}</strong>
            <span>${region === 'United States' ? 'English (US) — 12-hour clock' : 'Sets language, formats and time zone'}</span></button>`).join('')}</div>`;
      }

      if (id === 'network') {
        const wifi = Mac.state.wifi;
        return `${UI.group(
          UI.info('Wi-Fi', wifi.enabled ? (wifi.current || 'Not connected') : 'Off', '',
            `<span class="badge ${wifi.current ? 'ok' : 'bad'}">${wifi.current ? 'Connected' : 'Not connected'}</span>`),
        )}
        <div class="group">${Mac.NETWORKS.filter(network => !network.unavailable).map(network => {
          // The joined network is shown with a tick rather than being tappable,
          // so Continue is never blocked by the Wi-Fi details sheet.
          const joined = network.name === wifi.current;
          const row = `${UI.signal(network.bars)}
            <div class="row-text"><strong>${esc(network.name)}</strong><small class="muted">${esc(network.security)}</small></div>
            ${joined ? '<span class="badge ok">Joined</span>' : `<span class="chevron">${glyph('chevron', { size: 13 })}</span>`}`;
          return joined
            ? `<div class="row">${row}</div>`
            : `<button class="row tappable" data-command="wifi-join" data-arg="${esc(network.name)}">${row}</button>`;
        }).join('')}</div>
        `;
      }

      if (id === 'account') {
        return `${UI.group(
          `<div class="row"><div class="row-text"><strong>Apple Account</strong>
            <p>${Mac.state.account.signedIn ? esc(Mac.state.account.email) : 'Not signed in'}</p></div>
            <button class="btn primary" data-command="account-signin">${Mac.state.account.signedIn ? 'Change…' : 'Sign In…'}</button></div>`,
          UI.info('Skip for now', 'You can sign in later', 'iCloud, the App Store and Find My stay off until you do.'),
        )}`;
      }

      if (id === 'appearance') {
        const modes = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']];
        return `<div class="panel-grid" style="grid-template-columns:repeat(3,1fr)">${modes.map(([mode, label]) =>
          `<button class="panel-tile ${this.choices.appearance === mode ? 'on' : ''}" data-command="setup-appearance" data-arg="${mode}">
            <div class="appearance-art ${mode}" style="margin-bottom:8px">${glyph(mode === 'dark' ? 'moon' : mode === 'auto' ? 'appearance' : 'sun', { size: 20 })}</div>
            <strong>${label}</strong></button>`).join('')}</div>`;
      }

      return `<div class="phase-list">
        ${['Preparing your Mac', 'Configuring accounts', 'Setting up the Dock', 'Almost done'].map((line, index) =>
          `<div class="phase ${index < 3 ? 'done' : 'active'}"><i>${index < 3 ? '✓' : ''}</i><span>${esc(line)}</span></div>`).join('')}</div>`;
    },

    setRegion(region) {
      this.choices.region = region;
      Mac.state.settings.region = region;
      Mac.state.settings.language = region === 'United States' ? 'English (US)'
        : region === 'United Kingdom' ? 'English (UK)' : Mac.state.settings.language;
      Mac.save();
      this.render();
    },

    setAppearance(mode) {
      this.choices.appearance = mode;
      Mac.state.settings.appearance = mode;
      Mac.save();
      Mac.sync();
      this.render();
    },

    complete() {
      Mac.save();
      Mac.sync();
      Screens.desktop();
      Mac.wm.open('finder', { state: { location: 'recents' } });
      Mac.Notify.show('Welcome', 'Setup is complete. This Mac has been restored to its factory state.', { app: 'settings' });
      Mac.Notify.show('Tip', 'Press Command-Space for Spotlight, F3 for Mission Control, or drag a window to a screen edge to tile it.', { app: 'settings' });
    },
  };
}(window.Mac));
