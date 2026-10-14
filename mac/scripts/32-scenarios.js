/* ===========================================================================
   Scenarios.

   Everything else here simulates a Mac. This is the part that makes it a
   training tool: a named fault to walk into, a goal the simulator can check
   for itself, and a record of what the trainee actually did.

   The three pieces matter together. Without a checkable goal, "fix the Wi-Fi"
   ends whenever the trainee decides it has, and two people can finish the same
   exercise having done completely different things. Without the action log,
   nobody can tell afterwards whether they diagnosed it or found the fix by
   clicking everything on the screen — and those are not the same skill.

   A scenario is data, deliberately:

     { id, title, brief, setup(), checks: [{ id, label, done() }], hints[] }

   `setup` puts the Mac into the broken state. Each `done()` reads live state
   and returns a boolean, and they are re-evaluated from Mac.save — every fix
   a trainee applies ends in a save — so progress updates itself without any
   scenario needing to know which settings the trainee is going to touch.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph } = Mac;

  const SCENARIOS = [
    {
      id: 'no-internet',
      title: 'Wi-Fi connected, no internet',
      brief: 'The customer says the Wi-Fi icon is full but nothing loads. '
        + 'Find out why, fix it, and confirm the fix from a page that actually loads.',
      hints: [
        'Full bars mean the Mac reached the router. It does not mean the router reached anything else.',
        'System Settings › Network shows a one-line summary of what is actually wrong.',
        'Network Diagnostics walks the same five stages you would walk by hand.',
      ],
      setup() {
        Mac.state.wifi.enabled = true;
        Mac.state.wifi.current = 'Sablewave Home';
        Mac.state.wifi.captive = false;
        Mac.state.wifi.proxy = false;
        Mac.state.wifi.dns = ['203.0.113.53']; // unreachable documentation address
      },
      checks: [
        { id: 'diagnosed', label: 'Opened the network diagnostics or the DNS editor',
          done: () => Mac.state.wifi.lastDiagnostic !== null || Mac.Scenarios.saw('edit-dns') },
        { id: 'dns', label: 'DNS servers configured',
          done: () => Mac.Network.online() },
        { id: 'verified', label: 'Confirmed with a page that loads',
          done: () => Mac.state.browser.history.some(entry => entry.url === 'network.test') },
      ],
    },
    {
      id: 'captive-portal',
      title: 'Coffee shop Wi-Fi will not connect',
      brief: 'The Mac has joined the cafe network but every page redirects. '
        + 'Get the customer online and prove it.',
      hints: [
        'A portal network is joined and still not routed. Safari will say so if you let it.',
        'The sign-in page is at portal.local, and the Wi-Fi menu links to it.',
      ],
      setup() {
        const network = Mac.NETWORKS.find(candidate => candidate.captive);
        Mac.state.wifi.enabled = true;
        Mac.state.wifi.current = network ? network.name : 'Cafe Welcome';
        Mac.state.wifi.captive = true;
        Mac.state.wifi.dns = ['1.1.1.1'];
        Mac.state.wifi.proxy = false;
      },
      checks: [
        { id: 'portal', label: 'Opened the sign-in page', done: () => Mac.Scenarios.saw('portal-agree') },
        { id: 'through', label: 'Completed the portal', done: () => !Mac.state.wifi.captive },
        { id: 'verified', label: 'Confirmed with a page that loads',
          done: () => Mac.state.browser.history.some(entry => entry.url === 'network.test') },
      ],
    },
    {
      id: 'proxy',
      title: 'Safari cannot connect, Mail is fine',
      brief: 'One customer reports that nothing loads in Safari. Work out what is different '
        + 'about this Mac and put it right.',
      hints: [
        'Ask what else is broken. When the answer is "everything", the fault is below the app.',
        'Settings › Network lists what has been configured for the active service.',
      ],
      setup() {
        Mac.state.wifi.enabled = true;
        Mac.state.wifi.current = 'Sablewave Home';
        Mac.state.wifi.captive = false;
        Mac.state.wifi.dns = ['1.1.1.1', '8.8.8.8'];
        Mac.state.wifi.proxy = true;          // the fault
      },
      checks: [
        { id: 'found', label: 'Reached the Network settings pane',
          done: () => Mac.Scenarios.saw('open-setting:Network') || Mac.Scenarios.saw('clear-proxy') },
        { id: 'cleared', label: 'Proxy turned off', done: () => !Mac.state.wifi.proxy },
        { id: 'verified', label: 'Confirmed with a page that loads',
          done: () => Mac.state.browser.history.some(entry => entry.url === 'support.apple.local') },
      ],
    },
    {
      id: 'full-disk',
      title: 'The Mac says the disk is nearly full',
      brief: 'Free up space and show the customer where it went.',
      hints: [
        'The Trash still counts against the disk until it is emptied.',
        'Settings › General › Storage breaks the usage down by category.',
      ],
      setup() {
        ['f-notes', 'f-report', 'f-checklist', 'f-photo1', 'f-clip'].forEach(id => Mac.FS.trash(id));
        Mac.state.volumes[0].usedBytes = Math.round(Mac.state.volumes[0].totalBytes * 0.96);
      },
      checks: [
        { id: 'looked', label: 'Opened Storage', done: () => Mac.Scenarios.saw('open-setting:Storage') },
        { id: 'emptied', label: 'Trash emptied', done: () => Mac.FS.children('trash').length === 0 },
      ],
    },
    {
      id: 'signed-out',
      title: 'Signed out of their Apple Account',
      brief: 'The customer has been signed out and cannot get back in. Sign them in again.',
      hints: [
        'The lab password is “support”, and two-factor is switched on for this account.',
        'Sign-in needs a working connection — check that first if it refuses.',
      ],
      setup() {
        Mac.state.account.signedIn = false;
      },
      checks: [
        { id: 'signed-in', label: 'Signed back in', done: () => Mac.state.account.signedIn },
      ],
    },
  ];

  /**
   * Individual faults, for demonstrating one thing rather than running a
   * whole exercise.
   *
   * The iPhone has a control drawer down the side of the screen for this.
   * The Mac deliberately does not copy that: a permanent side rail fights
   * the desktop metaphor the rest of this is built on, and the Mac fills
   * the window. Same capability, reached from the same place as the
   * scenarios, and each one is a single named state change so it can be
   * undone as easily as it is applied.
   */
  const FAULTS = [
    { id: 'offline', label: 'Turn Wi-Fi off', apply: () => Mac.Network.toggle(false) },
    { id: 'online', label: 'Restore the connection', apply: () => {
      Mac.state.wifi = Mac.clone(Mac.DefaultState.wifi);
      Mac.Network.toggle(true);
    } },
    { id: 'captive', label: 'Join a portal network', apply: () => {
      Mac.state.wifi.current = (Mac.NETWORKS.find(n => n.captive) || {}).name || 'Cafe Welcome';
      Mac.state.wifi.captive = true;
    } },
    { id: 'no-dns', label: 'Use an unreachable DNS server', apply: () => { Mac.state.wifi.dns = ['203.0.113.53']; } },
    { id: 'proxy', label: 'Configure a dead proxy', apply: () => { Mac.state.wifi.proxy = true; } },
    { id: 'low-battery', label: 'Drop the battery to 8%', apply: () => {
      Mac.state.battery.percent = 8;
      Mac.state.battery.charging = false;
    } },
    { id: 'sign-out', label: 'Sign out of the Apple Account', apply: () => { Mac.state.account.signedIn = false; } },
    { id: 'updates', label: 'Queue app and OS updates', apply: () => {
      Mac.state.appUpdates = Mac.clone(Mac.DefaultState.appUpdates);
      Mac.state.osVersion = '27.0';
      Mac.state.osUpdate = { stage: 'available', progress: 0 };
    } },
    { id: 'fill-bin', label: 'Fill the Trash', apply: () => {
      ['f-notes', 'f-report', 'f-checklist'].forEach(id => Mac.FS.trash(id));
    } },
  ];

  const Scenarios = Mac.Scenarios = {
    all: SCENARIOS,
    faults: FAULTS,

    /** Apply one fault and say what happened, so the change is never silent. */
    inject(id) {
      const fault = FAULTS.find(candidate => candidate.id === id);
      if (!fault) return;
      fault.apply();
      Mac.save();
      Mac.sync();
      Mac.wm.refreshAll();
      Mac.Shell.renderDock();
      Mac.Notify.show('Simulator', `${fault.label}.`, { app: 'settings', transient: true, duration: 2600 });
    },

    find(id) { return SCENARIOS.find(scenario => scenario.id === id) || null; },

    state() {
      if (!Mac.state.scenario) Mac.state.scenario = { id: null, startedAt: 0, log: [], done: [] };
      return Mac.state.scenario;
    },

    active() { return this.find(this.state().id); },

    /* ------------------------------------------------------------ the log */

    /**
     * Record something the trainee did.
     *
     * Called from Mac.run for every command, so the log is a record of the
     * actual session rather than of the few places someone remembered to
     * instrument. Commands that fire constantly on their own — clock ticks,
     * window focus, re-renders — are excluded, or the log becomes noise and
     * stops being readable, which defeats the point.
     */
    IGNORED: new Set(['focus-window', 'close-window', 'minimize-window', 'zoom-window',
      'mission-control', 'launchpad', 'toggle-sidebar', 'generic', 'app-settings']),

    record(command, arg) {
      const running = this.state();
      if (!running.id) return;
      if (this.IGNORED.has(command)) return;
      const key = arg ? `${command}:${arg}` : command;
      const last = running.log[running.log.length - 1];
      // Collapse a repeat rather than filling the log with the same click.
      if (last && last.key === key) { last.count += 1; return; }
      running.log.push({ key, at: Date.now(), count: 1 });
      if (running.log.length > 400) running.log.shift();
    },

    /** Whether a command was used at any point in this run. */
    saw(key) {
      return this.state().log.some(entry => entry.key === key || entry.key.startsWith(`${key}:`));
    },

    /* ---------------------------------------------------------- lifecycle */

    start(id) {
      const scenario = this.find(id);
      if (!scenario) return;
      Mac.state.scenario = { id, startedAt: Date.now(), log: [], done: [] };
      /* From a known-good baseline, so a scenario started on top of another
         one's mess is still the scenario it claims to be. */
      Mac.state.wifi = Mac.clone(Mac.DefaultState.wifi);
      Mac.state.browser.history = [];
      scenario.setup();
      Mac.save();
      Mac.sync();
      Mac.wm.refreshAll();
      Mac.Notify.show('Scenario', `${scenario.title} — started.`, { app: 'settings' });
      this.panel();
    },

    stop() {
      Mac.state.scenario = { id: null, startedAt: 0, log: [], done: [] };
      Mac.save();
      this.renderProgress();
      Mac.Shell.renderDesktop();
    },

    /**
     * Re-evaluate the goals.
     *
     * Driven from Mac.save rather than only from Mac.sync: sync runs when
     * appearance-affecting settings change, but plenty of fixes — editing
     * the DNS list, emptying the Trash, signing back in — only save. Hooking
     * the save means no scenario has to know which of the two its fix will
     * happen to call.
     *
     * `busy` guards the recursion, since latching a goal saves.
     */
    busy: false,

    evaluate() {
      const scenario = this.active();
      if (!scenario || this.busy) return;
      const running = this.state();
      let changed = false;
      scenario.checks.forEach(check => {
        let passed = false;
        try { passed = Boolean(check.done()); } catch (error) { passed = false; }
        const already = running.done.includes(check.id);
        // Goals latch: undoing a step later does not un-teach it.
        if (passed && !already) { running.done.push(check.id); changed = true; }
      });
      if (!changed) return;
      this.busy = true;
      Mac.save();
      this.busy = false;
      this.renderProgress();
      if (running.done.length === scenario.checks.length) this.complete(scenario);
    },

    complete(scenario) {
      const running = this.state();
      const seconds = Math.round((Date.now() - running.startedAt) / 1000);
      const steps = running.log.reduce((total, entry) => total + entry.count, 0);
      Mac.Dialog.open({
        title: 'Scenario complete',
        icon: 'check',
        body: `<p style="margin:0 0 10px;font-size:12.5px;color:var(--text-2)">
            <strong>${esc(scenario.title)}</strong> — every goal met in
            ${Math.floor(seconds / 60)}m ${seconds % 60}s across ${steps} action${steps === 1 ? '' : 's'}.</p>
          ${this.transcript()}`,
        wide: true,
        buttons: [
          { label: 'Run it again', action: () => this.start(scenario.id) },
          { label: 'Done', primary: true, action: () => this.stop() },
        ],
      });
    },

    /** What the trainee actually did, in order. */
    transcript() {
      const running = this.state();
      if (!running.log.length) return '<p class="muted" style="font-size:12px">No actions recorded.</p>';
      return `<div class="group" style="max-height:220px;overflow:auto">${running.log.map(entry => {
        const at = new Date(entry.at).toLocaleTimeString();
        return `<div class="row"><div class="row-text"><strong>${esc(entry.key)}</strong>
          <p>${esc(at)}${entry.count > 1 ? ` · ${entry.count}×` : ''}</p></div></div>`;
      }).join('')}</div>`;
    },

    /* ------------------------------------------------------------- the UI */

    /** The picker, opened from the Apple menu or from Spotlight. */
    panel() {
      const running = this.state();
      Mac.Dialog.open({
        title: 'Training scenarios',
        icon: 'training',
        wide: true,
        body: `<p style="margin:0 0 12px;font-size:12.5px;color:var(--text-2)">
            Each one breaks something specific and checks the fix for itself. The steps you take are
            recorded so the run can be talked through afterwards.</p>
          <div class="group">${SCENARIOS.map(scenario => `<div class="row">
            <div class="row-text"><strong>${esc(scenario.title)}</strong><p>${esc(scenario.brief)}</p></div>
            <div class="row-action"><button class="btn ${scenario.id === running.id ? '' : 'primary'}"
              data-command="scenario-start" data-arg="${esc(scenario.id)}">
              ${scenario.id === running.id ? 'Restart' : 'Start'}</button></div></div>`).join('')}</div>
          <div class="section-title">Individual faults</div>
          <p style="margin:0 0 8px;font-size:12px;color:var(--text-2)">
            For demonstrating one thing rather than running a whole exercise. Each is a single named
            change, so it can be undone as easily as it is applied.</p>
          <div class="fault-grid">${FAULTS.map(fault =>
            `<button class="btn" data-command="scenario-fault" data-arg="${esc(fault.id)}">${esc(fault.label)}</button>`).join('')}</div>`,
        buttons: running.id
          ? [{ label: 'Stop the current scenario', danger: true, action: () => this.stop() },
             { label: 'Close', primary: true }]
          : [{ label: 'Close', primary: true }],
      });
    },

    /** The progress card that sits on the desktop while a scenario runs. */
    render() {
      const scenario = this.active();
      if (!scenario) return '';
      const running = this.state();
      return `<section class="scenario-card" aria-label="Scenario progress">
        <header>
          <strong>${esc(scenario.title)}</strong>
          <button class="tool-btn" data-command="scenario-stop" aria-label="Stop scenario">${glyph('close', { size: 12 })}</button>
        </header>
        <p>${esc(scenario.brief)}</p>
        <ul class="scenario-checks">${scenario.checks.map(check => {
          const done = running.done.includes(check.id);
          return `<li class="${done ? 'done' : ''}">
            <span class="scenario-mark">${done ? glyph('check', { size: 11 }) : ''}</span>
            <span>${esc(check.label)}</span></li>`;
        }).join('')}</ul>
        <footer>
          <button class="btn" data-command="scenario-hint">Hint</button>
          <button class="btn" data-command="scenario-transcript">What have I done?</button>
        </footer>
      </section>`;
    },

    renderProgress() {
      const host = Mac.$('#scenario-layer');
      if (host) host.innerHTML = this.render();
    },

    hint() {
      const scenario = this.active();
      if (!scenario) return;
      const running = this.state();
      /* One hint per goal already met, so the help gets more specific as the
         trainee gets further rather than giving the answer away at step one. */
      const index = Math.min(running.done.length, scenario.hints.length - 1);
      Mac.Notify.show('Hint', scenario.hints[index], { app: 'settings', duration: 9000 });
    },

    showTranscript() {
      Mac.Dialog.open({
        title: 'What you have done so far',
        icon: 'clock',
        wide: true,
        body: this.transcript(),
        buttons: [{ label: 'Close', primary: true }],
      });
    },
  };
}(window.Mac));
