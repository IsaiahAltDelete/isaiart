/* ===========================================================================
   Startup.

   Loads persisted state, paints the chrome, starts the clock, then runs the
   boot animation into the login window. Also exposes a small developer console
   API so scenarios can be set up quickly during training.
   =========================================================================== */

(function (Mac) {
  'use strict';

  Mac.state = Mac.Store.load();

  function startClock() {
    Mac.Shell.updateClock();
    setInterval(() => {
      Mac.Shell.updateClock();
      // Slow drift so the battery and process lists feel alive.
      if (Math.random() < 0.02) {
        const battery = Mac.state.battery;
        battery.percent = Mac.clamp(battery.percent + (battery.charging ? 1 : -1), 3, 100);
        Mac.save();
        Mac.Shell.renderMenuBar();
        Mac.Shell.renderWidgets();
      }
    }, 1000);
  }

  function developerApi() {
    window.MacSim = {
      /** Current persisted state (mutating it directly is allowed). */
      get state() { return Mac.state; },
      save: () => Mac.save(),
      open: id => Mac.wm.open(id),
      setting: (path, value) => Mac.set(path, value),
      /** Jump straight to the desktop, skipping the login window. */
      skipLogin: () => { Mac.Screens.desktop(); Mac.wm.open('finder'); },
      /* Scenario helpers for training sessions. */
      scenarios: {
        offline: () => Mac.Network.toggle(false),
        online: () => Mac.Network.toggle(true),
        captivePortal: () => Mac.Network.connect(Mac.NETWORKS.find(n => n.captive), '', { silent: true }),
        breakDNS: () => { Mac.state.wifi.dns = ['203.0.113.53']; Mac.save(); Mac.wm.refreshAll(); },
        fixDNS: () => { Mac.state.wifi.dns = ['1.1.1.1', '8.8.8.8']; Mac.save(); Mac.wm.refreshAll(); },
        lowBattery: () => { Mac.state.battery.percent = 8; Mac.state.battery.charging = false; Mac.save(); Mac.sync(); },
        fullTrash: () => { ['f-notes', 'f-report', 'f-checklist'].forEach(id => Mac.FS.trash(id)); Mac.wm.refreshAll(); Mac.Shell.renderDock(); },
        signOut: () => Mac.Account.signOut(),
        pendingUpdates: () => { Mac.state.appUpdates = Mac.clone(Mac.DefaultState.appUpdates); Mac.save(); Mac.Shell.renderDock(); },
      },
      reset: () => Mac.Power.factoryReset(),
      hardReset: () => Mac.Power.performReset({ silent: true }),
      help: () => console.info(
        'MacSim API\n' +
        '  MacSim.state                current state\n' +
        '  MacSim.open("safari")       open an app\n' +
        '  MacSim.skipLogin()          go straight to the desktop\n' +
        '  MacSim.setting(path, value) change a preference\n' +
        '  MacSim.scenarios.*          offline, captivePortal, breakDNS, lowBattery, fullTrash, signOut…\n' +
        '  MacSim.reset()              Erase All Content and Settings\n' +
        `  Login password: ${Mac.LOGIN_PASSWORD}`),
    };
  }

  function init() {
    Mac.OS.recover();
    Mac.sync();
    Mac.Shell.renderMenuBar();
    Mac.Shell.renderDock();
    Mac.Shell.renderDesktop();
    startClock();
    developerApi();

    if (!Mac.Store.available) {
      // Private browsing or a blocked storage origin: warn once, keep running.
      setTimeout(() => Mac.Notify.show('System Settings',
        'Local storage is unavailable, so changes will not persist between reloads.', { transient: true, duration: 8000 }), 2500);
    }

    Mac.Screens.boot(new URLSearchParams(location.search).has('login') ? 'login-screen' : 'desktop');
    if (Mac.state.settings.autoLogin) {
      setTimeout(() => {
        Mac.Screens.desktop();
        Mac.wm.open('finder', { state: { location: 'recents' } });
      }, 1700);
    }
    Mac.session.booted = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}(window.Mac));
