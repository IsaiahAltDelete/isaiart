/* ===========================================================================
   Event layer.

   One delegated listener per event type feeds a single command router, so every
   interactive surface in the simulator is described declaratively in markup
   (`data-command`, `data-arg`, `data-toggle-path`, …) and handled here.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, UI } = Mac;

  /** The window an element belongs to, falling back to the active window. */
  const winFor = element => {
    const host = element?.closest?.('.window');
    if (host) return Mac.wm.windows.get(host.dataset.win) || null;
    return Mac.wm.active();
  };

  /** The active window of a given app, opening it if needed. */
  const appWin = appId => Mac.wm.forApp(appId)[0] || Mac.wm.open(appId);

  const notImplemented = (label = 'This control') =>
    Mac.Notify.show('System Settings', `${label} is currently unavailable.`, { transient: true });

  /* ------------------------------------------------------------------ router */

  Mac.run = async (command, arg, element) => {
    const win = winFor(element);

    /* One place records what the trainee did, because one place sees
       everything: instrumenting individual handlers would only ever cover
       the ones somebody remembered. Only records while a scenario is
       running, and skips the commands that fire on their own. */
    Mac.Scenarios?.record(command, arg);

    switch (command) {
      /* ------------------------------------------------------------ shell */
      case 'open-app': Mac.Surfaces.close(); Mac.wm.open(arg); break;
      case 'open-settings': Mac.Settings.open('Control Center'); Mac.Surfaces.close(); break;
      case 'open-setting': Mac.Dialog.close(); Mac.Settings.open(arg); Mac.Surfaces.close(); break;
      case 'settings-pane': {
        const target = Mac.wm.forApp('settings')[0];
        if (target) { target.state.pane = arg; target.state.stack = []; target.state.query = ''; Mac.wm.render(target); Mac.wm.focus(target.id); }
        else Mac.Settings.open(arg);
        break;
      }
      case 'settings-sub': if (win?.appId === 'settings') Mac.Settings.push(win, arg); break;
      case 'settings-back': if (win?.appId === 'settings') Mac.Settings.back(win); break;

      case 'spotlight': Mac.Spotlight.open(); break;
      case 'close-spotlight': Mac.Spotlight.close(); break;
      case 'launchpad': Mac.Shell.openLaunchpad(); break;
      case 'mission-control': Mac.MissionControl.open(); break;
      case 'add-space': Mac.wm.addSpace(); Mac.MissionControl.refresh(); break;
      case 'surface-refresh': Mac.Surfaces.refresh(); break;

      /* ------------------------------------------------------------ windows */
      case 'new-window': Mac.wm.open(Mac.session.activeApp, { newWindow: true }); Mac.Surfaces.close(); break;
      case 'close-window': Mac.wm.close(win?.id); break;
      case 'quit-app': Mac.wm.closeApp(Mac.session.activeApp); break;
      case 'hide-app': Mac.wm.forApp(Mac.session.activeApp).forEach(target => Mac.wm.minimize(target.id)); break;
      case 'hide-others':
        Mac.wm.onSpace().filter(target => target.appId !== Mac.session.activeApp)
          .forEach(target => Mac.wm.minimize(target.id));
        break;
      case 'minimize-window': Mac.wm.minimize(win?.id); break;
      case 'minimize-all': Mac.wm.minimizeAll(); break;
      case 'zoom-window': Mac.wm.zoom(win?.id); break;
      case 'toggle-fullscreen': Mac.wm.toggleFullscreen(win?.id); break;
      case 'tile': Mac.wm.tileWindow(win?.id, arg); Mac.Surfaces.close(); break;
      case 'tile-quarters': {
        const layouts = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
        Mac.wm.onSpace().filter(target => !target.minimized).slice(0, 4)
          .forEach((target, index) => Mac.wm.tileWindow(target.id, layouts[index]));
        break;
      }
      case 'cycle-windows': Mac.wm.cycleWindows(); break;
      case 'bring-all-front': Mac.wm.cascade(); break;
      case 'focus-window':
        if (Mac.wm.windows.get(arg)?.minimized) Mac.wm.unminimize(arg);
        else Mac.wm.focus(arg);
        break;
      case 'toggle-sidebar':
        if (win && 'sidebar' in win.state) { win.state.sidebar = !win.state.sidebar; Mac.wm.render(win); }
        else notImplemented('The sidebar toggle');
        break;

      /* -------------------------------------------------------------- power */
      case 'power':
        if (arg === 'exit-recovery') { Mac.Screens.show('login-screen'); break; }
        Mac.Power.request(arg);
        break;
      case 'wake': Mac.Screens.desktop(); break;
      case 'power-on': Mac.Screens.boot('login-screen'); break;
      case 'login-user': Mac.session.loginUser = arg; Mac.Screens.renderLogin(); break;
      case 'recovery': Mac.Power.recovery(arg); break;
      case 'factory-reset': Mac.Dialog.close(); Mac.Power.factoryReset(); break;
      case 'force-quit-dialog': Mac.Power.forceQuitDialog(); break;
      case 'force-quit-app': Mac.wm.closeApp(arg); Mac.Dialog.close(); break;
      case 'setup-next': Mac.Setup.next(); break;
      case 'setup-back': Mac.Setup.back(); break;
      case 'setup-region': Mac.Setup.setRegion(arg); break;
      case 'setup-appearance': Mac.Setup.setAppearance(arg); break;

      /* ------------------------------------------------------------ network */
      case 'wifi-toggle': Mac.Network.toggle(); break;
      case 'wifi-sync': Mac.Network.toggle(Mac.state.wifi.enabled); break;
      case 'wifi-join': Mac.Dialog.close(); Mac.Surfaces.close(); Mac.Network.join(arg); break;
      case 'wifi-hidden': Mac.Network.hiddenNetwork(); break;
      case 'wifi-details': Mac.Network.details(); break;
      case 'wifi-known': case 'known-networks': Mac.Network.knownNetworks(); break;
      case 'wifi-forget': Mac.Network.forget(arg); break;
      case 'renew-dhcp': Mac.Network.renewLease(); break;
      case 'edit-dns': Mac.Network.editDNS(); break;
      case 'clear-proxy': Mac.Network.clearProxy(); break;

      /* ------------------------------------------------------- scenarios */
      case 'scenarios': Mac.Scenarios.panel(); break;
      case 'scenario-start': Mac.Dialog.close(); Mac.Scenarios.start(arg); break;
      case 'scenario-stop': Mac.Scenarios.stop(); break;
      case 'scenario-hint': Mac.Scenarios.hint(); break;
      case 'scenario-transcript': Mac.Scenarios.showTranscript(); break;
      case 'scenario-fault': Mac.Scenarios.inject(arg); break;
      case 'run-diagnostics': Mac.Dialog.close(); Mac.Surfaces.close(); Mac.Network.diagnostics(); break;
      case 'reset-network': Mac.Network.resetNetwork(); break;
      case 'portal-agree': Mac.Network.portalAgree(); break;
      case 'portal-connect': Mac.Network.portalConnect(); break;
      case 'portal-cancel': Mac.Network.portalCancel(); break;
      case 'ethernet-toggle': Mac.Network.toggleEthernet(); break;
      case 'vpn-add': Mac.Network.addVPN(); break;
      case 'vpn-toggle': Mac.Network.toggleVPN(); break;
      case 'vpn-remove': Mac.Network.removeVPN(); break;
      case 'add-printer': Mac.Dialog.close(); Mac.Network.addPrinter(); break;
      case 'remove-printer': Mac.Network.removePrinter(); break;
      case 'printer-queue': Mac.Network.printerQueue(arg); break;
      case 'print': Mac.Network.print(); break;
      case 'bluetooth-toggle': {
        const device = Mac.state.bluetoothDevices.find(candidate => candidate.id === arg);
        if (device) {
          device.connected = !device.connected;
          Mac.save();
          Mac.wm.refreshAll();
          Mac.Surfaces.refresh();
          Mac.Notify.show('Bluetooth', `${device.name} ${device.connected ? 'connected' : 'disconnected'}.`, { transient: true });
        }
        break;
      }

      /* ------------------------------------------------------------- Finder */
      case 'finder-new-folder': Mac.Finder.newFolder(win?.appId === 'finder' ? win : appWin('finder')); break;
      case 'finder-new-file': {
        const target = win?.appId === 'finder' ? win : appWin('finder');
        const node = Mac.FS.createFile(target.state.location, 'untitled.txt');
        target.state.selected = node.id;
        Mac.wm.refresh('finder');
        break;
      }
      case 'finder-info': Mac.Finder.getInfo(win?.appId === 'finder' ? win : appWin('finder')); break;
      case 'finder-rename': Mac.Dialog.close(); Mac.Finder.rename(win?.appId === 'finder' ? win : appWin('finder')); break;
      case 'finder-trash': Mac.Dialog.close(); Mac.Finder.trash(win?.appId === 'finder' ? win : appWin('finder')); break;
      case 'finder-put-back': Mac.Dialog.close(); Mac.Finder.putBack(win?.appId === 'finder' ? win : appWin('finder')); break;
      case 'finder-delete': Mac.Dialog.close(); Mac.Finder.deleteForever(win?.appId === 'finder' ? win : appWin('finder')); break;
      case 'finder-duplicate': Mac.Dialog.close(); Mac.Finder.duplicate(win?.appId === 'finder' ? win : appWin('finder')); break;
      case 'finder-copy': Mac.Dialog.close(); Mac.Finder.copyToClipboard(win?.appId === 'finder' ? win : appWin('finder')); break;
      case 'finder-cut': Mac.Dialog.close(); Mac.Finder.copyToClipboard(win?.appId === 'finder' ? win : appWin('finder'), { cut: true }); break;
      case 'finder-paste': Mac.Dialog.close(); Mac.Finder.paste(win?.appId === 'finder' ? win : appWin('finder')); break;
      case 'finder-move-to': Mac.Dialog.close(); Mac.Finder.transferTo(win?.appId === 'finder' ? win : appWin('finder'), 'move'); break;
      case 'finder-copy-to': Mac.Dialog.close(); Mac.Finder.transferTo(win?.appId === 'finder' ? win : appWin('finder'), 'copy'); break;
      case 'finder-go-folder': Mac.Dialog.close(); Mac.Finder.goToFolder(win?.appId === 'finder' ? win : appWin('finder')); break;
      case 'disk-eject': Mac.Finder.eject(arg); break;
      case 'finder-open': {
        const target = win?.appId === 'finder' ? win : appWin('finder');
        Mac.Dialog.close();
        if (target.state.selected) Mac.Finder.open(target, target.state.selected);
        break;
      }
      case 'finder-back': if (win?.appId === 'finder') Mac.Finder.go(win, -1); break;
      case 'finder-forward': if (win?.appId === 'finder') Mac.Finder.go(win, 1); break;
      case 'finder-go': {
        const target = win?.appId === 'finder' ? win : appWin('finder');
        Mac.Finder.navigate(target, arg);
        break;
      }
      case 'finder-go-downloads': Mac.wm.open('finder', { state: { location: 'dir-downloads' } }); break;
      case 'finder-view': if (win?.appId === 'finder') { win.state.view = arg; Mac.wm.render(win); } break;
      case 'finder-view-options': notImplemented('View options'); break;
      case 'finder-actions': {
        const target = win?.appId === 'finder' ? win : appWin('finder');
        Mac.Dialog.open({
          title: 'Finder Actions',
          icon: 'ellipsis',
          body: UI.group(
            UI.action('Get Info', 'finder-info'),
            UI.action('Rename', 'finder-rename'),
            UI.action('Duplicate', 'finder-duplicate'),
            target.state.location === 'trash'
              ? UI.action('Put Back', 'finder-put-back')
              : UI.action('Move to Trash', 'finder-trash'),
            target.state.location === 'trash' ? UI.action('Empty Trash…', 'empty-trash') : '',
          ),
          buttons: [{ label: 'Done', primary: true }],
        });
        break;
      }
      case 'empty-trash': Mac.Dialog.close(); Mac.Finder.emptyTrash(); break;

      /* ------------------------------------------------------------- Safari */
      case 'browse': {
        Mac.Dialog.close();
        const target = win?.appId === 'safari' ? win : appWin('safari');
        Mac.Browser.navigate(target, arg);
        Mac.wm.focus(target.id);
        break;
      }
      case 'browser-new-tab':
        if (win?.appId === 'safari') { Mac.Browser.newTab(win); Mac.wm.render(win); }
        break;
      case 'browser-close-tab':
        if (win?.appId === 'safari') Mac.Browser.closeTab(win, win.state.activeTab);
        break;
      case 'browser-back': if (win?.appId === 'safari') Mac.Browser.go(win, -1); break;
      case 'browser-forward': if (win?.appId === 'safari') Mac.Browser.go(win, 1); break;
      case 'browser-reload':
        if (win?.appId === 'safari') {
          const tab = Mac.Browser.tab(win);
          if (tab.loading) Mac.Browser.stop(win);
          else Mac.Browser.navigate(win, tab.url.replace(/^(offline|unreachable):/, ''), { replace: true });
        }
        break;
      case 'browser-retry':
        if (win?.appId === 'safari') {
          const tab = Mac.Browser.tab(win);
          Mac.Browser.navigate(win, tab.url.replace(/^(offline|unreachable):/, ''), { replace: true });
        }
        break;
      case 'browser-private':
        Mac.state.browser.private = !Mac.state.browser.private;
        Mac.save();
        Mac.wm.refresh('safari');
        Mac.Notify.show('Safari', Mac.state.browser.private
          ? 'Private Browsing is on — pages are not added to History.'
          : 'Private Browsing is off.', { app: 'safari', transient: true });
        break;
      case 'browser-share': Mac.Dialog.info('Share', 'Choose an app to share this page.', 'share'); break;
      case 'browser-live-toggle':
        Mac.toggle('browser.liveWeb');
        Mac.wm.refresh('safari');
        Mac.Notify.show('Safari', Mac.Web.enabled()
          ? 'Live web access is on. Wikipedia loads for real; other sites load when they allow embedding.'
          : 'The page is unavailable.', { app: 'safari', transient: true });
        break;
      case 'wiki-search': {
        const target = win?.appId === 'safari' ? win : appWin('safari');
        const query = String(arg || '').trim();
        if (!query) break;
        Mac.Browser.navigate(target, `wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`, { searchTerm: query });
        Mac.wm.focus(target.id);
        break;
      }
      case 'open-external': {
        // Real navigation away from the simulator, so confirm first.
        const confirmed = await Mac.Dialog.confirm({
          title: 'Open Link?',
          body: `Open <b>${esc(arg)}</b> in a new tab?`,
          confirmLabel: 'Open',
          icon: 'globe',
        });
        if (confirmed) window.open(arg, '_blank', 'noopener,noreferrer');
        break;
      }
      case 'browser-bookmark':
        if (win?.appId === 'safari') {
          const tab = Mac.Browser.tab(win);
          Mac.state.browser.bookmarks.unshift({ title: tab.title, url: tab.url });
          Mac.save();
          Mac.Notify.show('Safari', `“${tab.title}” was added to bookmarks.`, { app: 'safari', transient: true });
        }
        break;
      case 'browser-download': Mac.Browser.download(arg || 'Practice Pack.pdf', 1240000); break;
      case 'clear-history':
        Mac.state.browser.history = [];
        Mac.save();
        Mac.wm.refresh('safari');
        Mac.Notify.show('Safari', 'History cleared.', { app: 'safari', transient: true });
        break;
      case 'unsafe-details':
        Mac.Dialog.open({
          title: 'Warning details',
          icon: 'warning',
          body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">This website has been reported as deceptive.</p>`,
          buttons: [
            { label: 'Cancel' },
            {
              label: 'Visit This Website',
              danger: true,
              action: () => {
                const target = Mac.wm.forApp('safari')[0];
                if (target) Mac.Browser.navigate(target, 'unsafe.test', { replace: true, bypass: true });
              },
            },
          ],
        });
        break;

      /* --------------------------------------------------------------- Mail */
      case 'mail-action': Mac.Mail.action(arg); break;
      case 'mail-mailbox': Mac.Mail.setMailbox(arg); break;
      case 'mail-settings-accounts': Mac.Mail.settings('Accounts'); break;
      case 'mail-add-account': Mac.Mail.addAccount(); break;
      case 'mail-provider': Mac.Mail.providerForm(arg); break;
      case 'mail-remove-account': Mac.Mail.removeAccount(arg); break;
      case 'mail-test-connection': Mac.Mail.testConnection(arg); break;
      case 'mail-add-rule': Mac.Mail.addRule(); break;
      case 'mail-remove-rule':
        Mac.state.mail.rules = Mac.state.mail.rules.filter(rule => rule.id !== arg);
        Mac.save();
        Mac.Mail.refreshSettings();
        break;
      case 'mail-add-signature': {
        const account = Mac.Mail.activeAccount();
        const signature = { id: Mac.uid('sig'), name: 'New Signature', accountId: account?.id || '', body: '' };
        Mac.state.mail.signatures.push(signature);
        Mac.state.mail.activeSignatureId = signature.id;
        Mac.save();
        Mac.Mail.refreshSettings();
        break;
      }
      case 'mail-remove-signature':
        Mac.state.mail.signatures = Mac.state.mail.signatures.filter(signature => signature.id !== arg);
        Mac.state.mail.activeSignatureId = Mac.state.mail.signatures[0]?.id || null;
        Mac.save();
        Mac.Mail.refreshSettings();
        break;
      case 'mail-unblock':
        Mac.state.mail.blocked = Mac.state.mail.blocked.filter(address => address !== arg);
        Mac.save();
        Mac.Mail.refreshSettings();
        break;
      case 'open-mail-message': {
        Mac.wm.open('mail');
        const message = Mac.state.mail.messages.find(candidate => candidate.id === arg);
        if (message) {
          Mac.state.mail.mailbox = message.mailbox;
          Mac.state.mail.scopeAccountId = null;
          Mac.state.mail.category = 'All';
          Mac.Mail.select(arg);
        }
        break;
      }

      /* ------------------------------------------------------------ Outlook */
      case 'outlook-action': Mac.Outlook.action(arg); break;
      case 'outlook-module':
        Mac.state.outlook.module = arg;
        Mac.state.outlook.search = '';
        Mac.save();
        Mac.wm.refresh('outlook');
        break;
      case 'outlook-settings': Mac.Outlook.settingsSheet(arg || 'General'); break;
      case 'outlook-send': Mac.Outlook.send(); break;
      case 'outlook-signature-insert': Mac.Outlook.insertSignature(); break;
      case 'outlook-set-category': Mac.Outlook.setCategory(arg); break;
      case 'outlook-set-filter': Mac.Outlook.setFilter(arg); break;
      case 'outlook-move': Mac.Outlook.move(arg); break;
      case 'outlook-cal-move': Mac.Outlook.calMove(arg); break;
      case 'outlook-event': Mac.Outlook.showEvent(arg); break;
      case 'outlook-source': Mac.Outlook.source(); break;
      case 'outlook-print':
        Mac.Dialog.info('Print', 'No printer selected.', 'printer');
        break;

      /* ---------------------------------------------------------- App Store */
      case 'store-install': Mac.Store2.install(arg); break;
      case 'store-update': Mac.Store2.install(arg, { update: true }); break;
      case 'store-update-all': Mac.Store2.updateAll(); break;
      case 'store-remove': Mac.Store2.remove(arg); break;
      case 'store-section': {
        const target = win?.appId === 'appstore' ? win : appWin('appstore');
        target.state.section = arg;
        target.state.detail = null;
        target.state.query = '';
        Mac.wm.render(target);
        break;
      }
      case 'check-updates': {
        if (!Mac.Network.online()) {
          Mac.Notify.show('Software Update',
            `Unable to check for updates. ${Mac.Network.summary()}.`, { app: 'appstore' });
          break;
        }
        const parts = [];
        if (Mac.OS.pending()) parts.push(`macOS Golden Gate ${Mac.OS.update().version}`);
        if (Mac.state.appUpdates.length) parts.push(Mac.plural(Mac.state.appUpdates.length, 'app update'));
        Mac.Notify.show('Software Update',
          parts.length ? `Checked for updates — ${parts.join(' and ')} available.`
            : 'Checked for updates — this Mac is up to date.', { app: 'appstore' });
        break;
      }
      case 'os-update': Mac.OS.run(arg); break;

      /* -------------------------------------------------------------- Notes */
      case 'new-note': Mac.Notes.create(); break;
      case 'delete-note': if (win?.appId === 'notes') Mac.Notes.remove(win); break;
      case 'pin-note': if (win?.appId === 'notes') Mac.Notes.pin(win); break;
      case 'open-note': {
        const target = Mac.wm.open('notes');
        if (target) { target.state.selected = arg; target.state.query = ''; Mac.wm.render(target); }
        break;
      }

      /* -------------------------------------------------- other applications */
      case 'textedit-save': {
        const existing = Mac.state.fs.find(node => node.name === 'Support Call Log.txt');
        if (!existing) Mac.FS.createFile('dir-documents', 'Support Call Log.txt', { size: Mac.state.appData.textedit.length });
        else { existing.size = Mac.state.appData.textedit.length; existing.modified = Date.now(); }
        Mac.save();
        Mac.wm.refresh('finder');
        Mac.Notify.show('TextEdit', 'Document saved to Documents.', { app: 'textedit', transient: true });
        break;
      }
      case 'format': notImplemented('Text formatting'); break;
      case 'preview-zoom': {
        const current = Mac.state.appData.previewZoom || 1;
        Mac.state.appData.previewZoom = Mac.clamp(current + (arg === 'in' ? 0.1 : -0.1), 0.6, 1.8);
        Mac.save();
        Mac.wm.refresh('preview');
        break;
      }
      case 'terminal-clear': if (win?.appId === 'terminal') { win.state.output = ''; Mac.wm.render(win); } break;
      case 'console-clear':
        Mac.state.logs = [];
        Mac.save();
        Mac.wm.refresh('console');
        break;
      case 'force-quit-process': if (win?.appId === 'activity-monitor') Mac.Activity.forceQuit(win); break;
      case 'refresh-processes':
        Mac.state.processes = Mac.state.processes.map(process => Object.assign({}, process, {
          cpu: Math.max(0.1, Math.round((process.cpu + (Math.random() - 0.5) * 2) * 10) / 10),
        }));
        Mac.save();
        Mac.wm.refresh('activity-monitor');
        break;
      case 'disk-first-aid': if (win?.appId === 'disk-utility') Mac.DiskUtility.firstAid(win); break;
      case 'disk-mount': Mac.DiskUtility.toggleMount(arg); Mac.wm.refresh('time-machine'); break;
      case 'disk-erase': Mac.DiskUtility.erase(arg); break;
      case 'take-screenshot': {
        const stamp = new Date().toISOString().slice(0, 19).replace('T', ' at ').replace(/:/g, '.');
        const node = Mac.FS.createFile('dir-desktop', `Screenshot ${stamp}.png`, { ext: 'png', size: 486000 });
        Mac.wm.refresh('finder');
        Mac.Shell.renderDesktop();
        Mac.Notify.show('Screenshot', `“${node.name}” was saved to the Desktop.`, { app: 'screenshot' });
        break;
      }
      case 'time-machine-backup': {
        const backup = Mac.state.volumes.find(volume => volume.id === 'vol-backup');
        if (backup?.mounted === false) {
          Mac.Dialog.open({
            title: 'The backup disk is not available',
            icon: 'warning',
            body: '<p style="margin:0;font-size:12.5px;color:var(--text-2)">Time Machine cannot back up because “Time Machine Backup” is not mounted.</p>',
            buttons: [{ label: 'Cancel' }, { label: 'Mount Disk', primary: true, action: () => Mac.run('disk-mount', 'vol-backup') }],
          });
          break;
        }
        Mac.Notify.show('Time Machine', 'Backing up…', { app: 'time-machine' });
        break;
      }
      case 'time-machine-browse':
        Mac.Dialog.info('Time Machine', 'The backup disk is not available.', 'time-machine');
        break;
      case 'keychain-reveal':
        Mac.session.revealKeychain = !Mac.session.revealKeychain;
        Mac.wm.refresh('keychain');
        break;
      case 'export-report': {
        const node = Mac.FS.createFile('dir-desktop', 'System Report.txt', { size: 18400 });
        Mac.wm.refresh('finder');
        Mac.Shell.renderDesktop();
        Mac.Notify.show('System Information', `“${node.name}” was saved to the Desktop.`, { app: 'system-info' });
        break;
      }
      case 'migration-scan':
        Mac.Dialog.info('No sources found',
          'Migration Assistant did not find another Mac, a Time Machine backup or a startup disk on the network.',
          'migration');
        break;
      case 'facetime-call':
        Mac.Notify.show('FaceTime', 'Calling…', { app: 'facetime', transient: true });
        break;
      case 'calendar-month':
        if (win?.appId === 'calendar') {
          win.state.monthOffset = arg === '0' ? 0 : win.state.monthOffset + Number(arg);
          Mac.wm.render(win);
        }
        break;
      case 'calendar-new': {
        const title = await Mac.Dialog.prompt({ title: 'New Event', label: 'Title', confirmLabel: 'Add', icon: 'calendar' });
        if (!title) break;
        Mac.state.calendar.events.push({ id: Mac.uid('c'), calendar: 'cal-work', title, offset: 0, time: '14:00' });
        Mac.save();
        Mac.wm.refresh('calendar');
        Mac.Shell.renderWidgets();
        break;
      }
      case 'reminder-new': {
        const text = await Mac.Dialog.prompt({ title: 'New Reminder', label: 'Reminder', confirmLabel: 'Add', icon: 'reminders' });
        if (!text || win?.appId !== 'reminders') break;
        win.state.items.unshift({ id: Mac.uid('r'), text, done: false, list: 'Support', due: 'Today' });
        Mac.wm.render(win);
        break;
      }
      case 'music-toggle': Mac.Media.toggle(); break;
      case 'music-prev': Mac.Media.skip(-1); break;
      case 'music-next': Mac.Media.skip(1); break;

      /* ------------------------------------------------------ Apple Account */
      case 'account-signin': Mac.Dialog.close(); Mac.Account.signIn(); break;
      case 'account-signout': Mac.Account.signOut(); break;
      case 'account-sub':
        if (win?.appId === 'settings') { win.state.accountSub = arg || null; Mac.wm.render(win); }
        break;
      case 'account-device': Mac.Account.device(arg); break;
      case 'account-two-factor': Mac.Account.toggleTwoFactor(); break;
      case 'account-change-password': case 'change-password': Mac.Account.changePassword(); break;
      case 'account-rename': Mac.Account.rename(); break;
      case 'account-manage-storage': case 'account-upgrade': Mac.Account.upgradeStorage(); break;
      case 'account-set-plan': Mac.Account.setPlan(arg); break;
      case 'account-change-email':
        Mac.Dialog.info('Change your Apple Account address',
          'The new email address must be verified.', 'at');
        break;
      case 'account-cancel-subscription': {
        const confirmed = await Mac.Dialog.confirm({
          title: `Cancel ${arg}?`,
          body: 'The subscription stays active until the end of the current period.',
          confirmLabel: 'Cancel Subscription',
          danger: true,
        });
        if (!confirmed) break;
        Mac.state.account.subscriptions = Mac.state.account.subscriptions.filter(subscription => subscription.name !== arg);
        Mac.save();
        Mac.wm.refresh('settings');
        break;
      }
      case 'account-add-payment':
        Mac.Dialog.info('Add a payment method',
          'Payment information is unavailable. Try again later.', 'storage');
        break;
      case 'account-recovery-contact': case 'account-recovery-key':
        notImplemented('Account recovery');
        break;
      case 'family-setup': Mac.Account.setupFamily(); break;
      case 'family-add': Mac.Account.addFamilyMember(); break;
      case 'family-remove': Mac.Account.removeFamilyMember(arg); break;
      case 'family-stop': Mac.Account.stopFamily(); break;

      /* ------------------------------------------------------- appearance */
      case 'set-appearance': Mac.set('settings.appearance', arg); Mac.wm.refreshAll(); break;
      case 'set-accent': Mac.set('settings.accent', arg); Mac.wm.refreshAll(); break;
      case 'set-wallpaper': Mac.set('settings.wallpaper', arg); Mac.wm.refresh('settings'); break;
      case 'volume-hud':
        Mac.hud(Mac.state.settings.muted ? 'volume-off' : 'volume',
          Mac.state.settings.muted ? 0 : Mac.state.settings.volume,
          Mac.state.settings.muted ? 'Muted' : `Volume ${Mac.state.settings.volume}%`);
        break;
      case 'toggle-charging': {
        const battery = Mac.state.battery;
        battery.charging = !battery.charging;
        Mac.save();
        Mac.sync();
        Mac.Surfaces.refresh();
        Mac.wm.refreshAll();
        break;
      }
      case 'detect-displays':
        Mac.Notify.show('Displays', 'No additional displays were detected.', { app: 'settings', transient: true });
        break;
      case 'rename-mac': {
        const name = await Mac.Dialog.prompt({
          title: 'Rename this Mac',
          label: 'Computer name',
          value: Mac.state.settings.computerName,
          confirmLabel: 'Rename',
          icon: 'system-info',
        });
        if (!name) break;
        Mac.set('settings.computerName', name);
        Mac.wm.refreshAll();
        break;
      }

      /* ---------------------------------------------------- notifications */
      case 'dismiss-notification':
        Mac.state.notifications = Mac.state.notifications.filter(item => item.id !== arg);
        Mac.save();
        Mac.Surfaces.refresh();
        break;
      case 'clear-notifications': Mac.Notify.clear(); Mac.Surfaces.refresh(); break;
      case 'notification-app':
        Mac.Dialog.open({
          title: `${Mac.appTitle(arg)} notifications`,
          icon: { app: Mac.apps[arg]?.icon || 'settings' },
          body: UI.group(
            UI.info('Alert style', 'Banners'),
            UI.info('Show in Notification Centre', 'Yes'),
            UI.info('Badge app icon', Mac.state.settings.notificationBadges ? 'Yes' : 'No'),
            UI.info('Play sound', Mac.state.settings.soundEffects ? 'Yes' : 'No'),
          ),
          buttons: [{ label: 'Done', primary: true }],
        });
        break;

      /* ------------------------------------------------------------- about */
      case 'about-mac':
        Mac.Dialog.open({
          title: 'About This Mac',
          icon: { app: 'system-info' },
          body: `<div style="text-align:center;margin-bottom:14px">
              <strong style="font-size:19px">macOS Golden Gate</strong>
              <p class="muted" style="margin:3px 0 0;font-size:12px">Version ${Mac.OS.version()}</p></div>
            ${UI.group(
              UI.info('MacBook Pro', '14-inch, M4 Pro'),
              UI.info('Chip', 'Apple M4 Pro'),
              UI.info('Memory', '24 GB'),
              UI.info('Serial number', '—'),
              UI.info('Startup disk', 'Macintosh HD'),
            )}
            `,
          buttons: [
            { label: 'System Report…', action: () => Mac.wm.open('system-info') },
            { label: 'Software Update…', action: () => Mac.Settings.open('General', 'Software Update') },
            { label: 'OK', primary: true },
          ],
        });
        break;
      case 'about-app': {
        const app = Mac.apps[Mac.session.activeApp] || Mac.apps.finder;
        Mac.Dialog.open({
          title: app.title,
          icon: { app: app.icon },
          body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">${esc(app.blurb || '')}</p>
            <p class="muted" style="margin:8px 0 0;font-size:11.5px">Version ${esc(app.version)} — ${esc(app.category)}</p>`,
          buttons: [{ label: 'OK', primary: true }],
        });
        break;
      }
      case 'app-settings':
        if (Mac.session.activeApp === 'mail') Mac.Mail.settings();
        else if (Mac.session.activeApp === 'outlook') Mac.Outlook.settingsSheet();
        else if (Mac.session.activeApp === 'safari') Mac.run('browse', 'settings');
        else Mac.Settings.open('General');
        break;
      case 'app-help': case 'simulator-help': {
        const target = appWin('safari');
        Mac.Browser.navigate(target, 'support.apple.local');
        break;
      }
      case 'keyboard-shortcuts':
        Mac.Dialog.open({
          title: 'Keyboard Shortcuts',
          icon: 'keyboard',
          wide: true,
          body: `<table class="shortcut-table">${[
            ['Spotlight Search', '⌘Space'],
            ['Mission Control', 'F3 or ⌃↑'],
            ['Apps in Spotlight', 'F4'],
            ['Switch app', '⌘Tab'],
            ['Cycle windows of an app', '⌘`'],
            ['Minimise window', '⌘M'],
            ['Close window', '⌘W'],
            ['New window', '⌘N'],
            ['Full screen', '⌃⌘F'],
            ['Tile window left / right', '⌃⌥←  /  ⌃⌥→'],
            ['Switch desktop', '⌃←  /  ⌃→'],
            ['Lock screen', '⌃⌘Q'],
            ['Log out', '⇧⌘Q'],
            ['Force Quit', '⌥⌘⎋'],
            ['Screenshot', '⇧⌘3'],
            ['Empty the Trash', '⇧⌘⌫'],
            ['Close a menu, sheet or overlay', 'Esc'],
          ].map(([action, keys]) => `<tr><td>${esc(action)}</td><td>${esc(keys)}</td></tr>`).join('')}</table>`,
          buttons: [{ label: 'Done', primary: true }],
        });
        break;
      case 'recent-items':
        Mac.Surfaces.contextMenu(40, 40, Mac.FS.recents().slice(0, 8).map(node => ({
          label: node.name, command: 'reveal-file', arg: node.id,
        })));
        break;
      case 'reveal-file': {
        const node = Mac.FS.node(arg);
        if (!node) break;
        const target = Mac.wm.open('finder', { state: { location: node.parent === 'trash' ? 'trash' : node.parent } });
        if (target) { target.state.selected = node.id; Mac.wm.render(target); }
        break;
      }
      case 'copy-value':
        navigator.clipboard?.writeText?.(String(arg)).catch(() => {});
        Mac.Notify.show('Spotlight', `Copied “${arg}” to the clipboard.`, { transient: true });
        break;
      case 'reveal-password': {
        const input = document.getElementById(arg);
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
        element?.querySelector('.checkbox')?.classList.toggle('on');
        break;
      }

      /* ------------------------------------------------------ edit commands */
      case 'edit-copy': case 'edit-cut': case 'edit-paste': case 'edit-select-all':
      case 'edit-undo': case 'edit-redo':
        Mac.Notify.show('Edit', `${command.replace('edit-', '').replace('-', ' ')} applies to the focused text field.`, { transient: true });
        break;

      case 'user-edit':
        Mac.Dialog.open({
          title: Mac.state.account.name,
          icon: 'person',
          body: UI.group(
            UI.info('Account type', 'Administrator'),
            UI.info('Short name', Mac.PERSONA.shortName),
            UI.info('Home folder', '/Users/isaiah'),
            UI.action('Change Password…', 'change-password', ``),
          ),
          buttons: [{ label: 'Done', primary: true }],
        });
        break;
      case 'add-user':
        Mac.Dialog.info('Add a user',
          'A new user could not be created. Try again later.',
          'people');
        break;
      case 'privacy-detail':
        Mac.Dialog.open({
          title: arg || 'Privacy',
          icon: 'shield',
          body: UI.group(
            UI.info('Terminal', 'Off'),
            UI.info('Safari', 'Off'),
            UI.info('FaceTime', arg === 'Camera' ? 'On' : 'Off'),
          ),
          buttons: [{ label: 'Done', primary: true }],
        });
        break;
      case 'open-item':
        if (win?.appId === 'finder') Mac.run('finder-open', null, element);
        else Mac.wm.open('finder');
        break;
      case 'generic': case '': notImplemented(); break;
      default:
        if (command) notImplemented(`“${command.replace(/-/g, ' ')}”`);
    }
  };

  /* -------------------------------------------------------------- listeners */

  /** Primary click handler: resolves declarative attributes to behaviour. */
  document.addEventListener('click', event => {
    const target = event.target;

    // Dialog buttons first — they can sit above everything else.
    const dialogButton = target.closest('[data-dialog-button]');
    if (dialogButton) { Mac.Dialog.activate(Number(dialogButton.dataset.dialogButton)); return; }

    const toast = target.closest('[data-dismiss-toast]');
    if (toast) { document.getElementById(toast.dataset.dismissToast)?.remove(); return; }

    // Menu bar / status item popovers.
    const surface = target.closest('[data-surface]');
    if (surface) {
      event.stopPropagation();
      Mac.Surfaces.show(surface.dataset.surface, surface, { menuName: surface.dataset.menuName });
      return;
    }

    // State toggles bound directly to a path.
    const toggle = target.closest('[data-toggle-path]');
    if (toggle) {
      const path = toggle.dataset.togglePath;
      Mac.toggle(path);
      if (path === 'settings.muted') Mac.run('volume-hud');
      const after = toggle.dataset.after;
      if (after === 'surface-refresh') Mac.Surfaces.refresh();
      else if (after === 'known-networks') Mac.Network.knownNetworks();
      Mac.wm.refreshAll();
      if (Mac.Dialog.current) {
        // Re-render the open dialog body when it hosts settings rows.
        toggle.querySelector('.checkbox')?.classList.toggle('on');
        toggle.classList.toggle('on');
      }
      return;
    }

    const command = target.closest('[data-command]');
    if (command) {
      event.preventDefault();
      if (command.closest('[role=menu]')) Mac.Surfaces.close();
      Mac.run(command.dataset.command, command.dataset.arg, command);
      return;
    }

    /* ---------------------------------------------------- window controls */
    const winAction = target.closest('[data-win-action]');
    if (winAction) {
      const host = winAction.closest('.window');
      const id = host?.dataset.win;
      ({
        close: () => Mac.wm.close(id),
        minimize: () => Mac.wm.minimize(id),
        zoom: () => (event.altKey ? Mac.wm.toggleFullscreen(id) : Mac.wm.zoom(id)),
      })[winAction.dataset.winAction]?.();
      return;
    }

    const openApp = target.closest('[data-open-app]');
    if (openApp) {
      Mac.Surfaces.close();
      Mac.wm.open(openApp.dataset.openApp, { newWindow: event.altKey });
      return;
    }

    const restore = target.closest('[data-restore-win]');
    if (restore) { Mac.wm.unminimize(restore.dataset.restoreWin); return; }

    const focusWin = target.closest('[data-focus-win]');
    if (focusWin) {
      Mac.MissionControl.close();
      Mac.run('focus-window', focusWin.dataset.focusWin);
      return;
    }

    const gotoSpace = target.closest('[data-goto-space]');
    if (gotoSpace) {
      if (target.closest('[data-close-space]')) {
        Mac.wm.removeSpace(Number(target.closest('[data-close-space]').dataset.closeSpace));
        Mac.MissionControl.refresh();
        return;
      }
      Mac.wm.gotoSpace(Number(gotoSpace.dataset.gotoSpace));
      Mac.MissionControl.close();
      return;
    }

    const openDesktop = target.closest('[data-open-desktop]');
    if (openDesktop) {
      const node = Mac.FS.node(openDesktop.dataset.openDesktop);
      Mac.wm.open('finder', { state: { location: Mac.FS.isFolder(node) ? node.id : node.parent, selected: node.id } });
      return;
    }

    /* --------------------------------------------------------- Launchpad */
    const launch = target.closest('[data-launch-app]');
    if (launch) {
      Mac.Shell.closeLaunchpad();
      Mac.wm.open(launch.dataset.launchApp);
      return;
    }
    const page = target.closest('[data-launchpad-page]');
    if (page) { Mac.Shell.launchpad.page = Number(page.dataset.launchpadPage); Mac.Shell.renderLaunchpad(); return; }
    if (target.id === 'launchpad') { Mac.Shell.closeLaunchpad(); return; }
    if (target.id === 'mission-control') { Mac.MissionControl.close(); return; }

    /* ------------------------------------------------------------ Finder */
    const finderGo = target.closest('[data-finder-go]');
    if (finderGo) {
      const host = winFor(finderGo);
      if (host?.appId === 'finder') Mac.Finder.navigate(host, finderGo.dataset.finderGo);
      return;
    }
    const finderView = target.closest('[data-finder-view]');
    if (finderView) {
      const host = winFor(finderView);
      if (host) { host.state.view = finderView.dataset.finderView; Mac.wm.render(host); }
      return;
    }
    const finderSort = target.closest('[data-finder-sort]');
    if (finderSort) {
      const host = winFor(finderSort);
      if (host) {
        const key = finderSort.dataset.finderSort;
        host.state.sortDescending = host.state.sort === key ? !host.state.sortDescending : false;
        host.state.sort = key;
        Mac.wm.render(host);
      }
      return;
    }
    const file = target.closest('[data-file]');
    if (file) {
      const host = Mac.wm.windows.get(file.dataset.win) || winFor(file);
      if (host) {
        const id = file.dataset.file;
        // Column view drills in on a single click, like macOS.
        if (host.state.view === 'column' && Mac.FS.isFolder(Mac.FS.node(id))) Mac.Finder.navigate(host, id);
        else Mac.Finder.select(host, id);
      }
      return;
    }

    /* ------------------------------------------------------------ Safari */
    const closeTab = target.closest('[data-close-tab]');
    if (closeTab) {
      event.stopPropagation();
      const host = winFor(closeTab);
      if (host) Mac.Browser.closeTab(host, closeTab.dataset.closeTab);
      return;
    }
    const browserTab = target.closest('[data-browser-tab]');
    if (browserTab) {
      const host = winFor(browserTab);
      if (host) { host.state.activeTab = browserTab.dataset.browserTab; Mac.wm.render(host); }
      return;
    }

    /* -------------------------------------------------------------- mail */
    const mailMessage = target.closest('[data-mail-message]');
    if (mailMessage) { Mac.Mail.select(mailMessage.dataset.mailMessage); return; }
    const mailbox = target.closest('[data-mail-mailbox]');
    if (mailbox) { Mac.Mail.setMailbox(mailbox.dataset.mailMailbox, mailbox.dataset.mailAccount || null); return; }
    const mailCategory = target.closest('[data-mail-category]');
    if (mailCategory) {
      Mac.state.mail.category = mailCategory.dataset.mailCategory;
      Mac.save();
      Mac.wm.refresh('mail');
      return;
    }
    const mailAction = target.closest('[data-mail-action]');
    if (mailAction) { Mac.Mail.action(mailAction.dataset.mailAction); return; }
    const mailPane = target.closest('[data-mail-settings-pane]');
    if (mailPane) { Mac.Mail.settings(mailPane.dataset.mailSettingsPane); return; }
    const mailAccountToggle = target.closest('[data-mail-account-toggle]');
    if (mailAccountToggle) {
      const account = Mac.Mail.account(mailAccountToggle.dataset.mailAccountToggle);
      if (account) { account.enabled = !account.enabled; Mac.save(); Mac.Mail.refreshSettings(); Mac.wm.refresh('mail'); }
      return;
    }
    const mailSignature = target.closest('[data-mail-signature]');
    if (mailSignature) {
      Mac.state.mail.activeSignatureId = mailSignature.dataset.mailSignature;
      Mac.save();
      Mac.Mail.refreshSettings();
      return;
    }
    const mailRule = target.closest('[data-mail-rule-toggle]');
    if (mailRule) {
      const rule = Mac.state.mail.rules.find(candidate => candidate.id === mailRule.dataset.mailRuleToggle);
      if (rule) { rule.enabled = !rule.enabled; Mac.save(); Mac.Mail.refreshSettings(); }
      return;
    }

    /* ----------------------------------------------------------- Outlook */
    const outlookMessage = target.closest('[data-outlook-message]');
    if (outlookMessage) { Mac.Outlook.select(outlookMessage.dataset.outlookMessage); return; }
    const outlookFolder = target.closest('[data-outlook-folder]');
    if (outlookFolder) {
      Mac.state.outlook.folder = outlookFolder.dataset.outlookFolder;
      Mac.state.outlook.folderSection = outlookFolder.dataset.outlookSection || 'fav';
      Mac.state.outlook.selected = null;
      Mac.save();
      Mac.wm.refresh('outlook');
      return;
    }
    const outlookFocus = target.closest('[data-outlook-focus]');
    if (outlookFocus) {
      Mac.state.outlook.focused = outlookFocus.dataset.outlookFocus;
      Mac.save();
      Mac.wm.refresh('outlook');
      return;
    }
    const outlookModule = target.closest('[data-outlook-module]');
    if (outlookModule) { Mac.run('outlook-module', outlookModule.dataset.outlookModule); return; }
    const outlookRibbon = target.closest('[data-outlook-ribbon]');
    if (outlookRibbon) {
      Mac.state.outlook.ribbonTab = outlookRibbon.dataset.outlookRibbon;
      Mac.save();
      Mac.wm.refresh('outlook');
      return;
    }
    const outlookCollapse = target.closest('[data-outlook-collapse]');
    if (outlookCollapse) {
      const key = outlookCollapse.dataset.outlookCollapse;
      const list = Mac.state.outlook.collapsed;
      const index = list.indexOf(key);
      if (index === -1) list.push(key); else list.splice(index, 1);
      Mac.save();
      Mac.wm.refresh('outlook');
      return;
    }
    const outlookCalView = target.closest('[data-outlook-calview]');
    if (outlookCalView) {
      Mac.state.outlook.calView = outlookCalView.dataset.outlookCalview;
      Mac.save();
      Mac.wm.refresh('outlook');
      return;
    }
    const outlookCalendar = target.closest('[data-outlook-calendar]');
    if (outlookCalendar) { Mac.Outlook.toggleCalendar(outlookCalendar.dataset.outlookCalendar); return; }
    const outlookContact = target.closest('[data-outlook-contact]');
    if (outlookContact) {
      Mac.state.outlook.selectedContact = outlookContact.dataset.outlookContact;
      Mac.save();
      Mac.wm.refresh('outlook');
      return;
    }
    const outlookTask = target.closest('[data-outlook-task]');
    if (outlookTask) { Mac.Outlook.toggleTask(outlookTask.dataset.outlookTask); return; }
    const outlookRule = target.closest('[data-outlook-rule]');
    if (outlookRule) { Mac.Outlook.toggleRule(outlookRule.dataset.outlookRule); return; }
    const outlookSettings = target.closest('[data-outlook-settings]');
    if (outlookSettings) { Mac.Outlook.settingsSheet(outlookSettings.dataset.outlookSettings); return; }

    /* --------------------------------------------------------- App Store */
    const storeSection = target.closest('[data-store-section]');
    if (storeSection) { Mac.run('store-section', storeSection.dataset.storeSection, storeSection); return; }
    const storeOpen = target.closest('[data-store-open]');
    if (storeOpen) {
      const host = winFor(storeOpen);
      if (host) { host.state.detail = storeOpen.dataset.storeOpen; Mac.wm.render(host); }
      return;
    }

    /* ---------------------------------------------------------- settings */
    const settingsPane = target.closest('[data-settings-pane]');
    if (settingsPane) { Mac.run('settings-pane', settingsPane.dataset.settingsPane, settingsPane); return; }

    /* ------------------------------------------------------- misc surfaces */
    const activityTab = target.closest('[data-activity-tab]');
    if (activityTab) {
      const host = winFor(activityTab);
      if (host) { host.state.tab = activityTab.dataset.activityTab; Mac.wm.render(host); }
      return;
    }
    const process = target.closest('[data-process]');
    if (process) {
      const host = winFor(process);
      if (host) { host.state.selected = process.dataset.process; Mac.wm.render(host); }
      return;
    }
    const consoleLevel = target.closest('[data-console-level]');
    if (consoleLevel) {
      const host = winFor(consoleLevel);
      if (host) { host.state.level = consoleLevel.dataset.consoleLevel; Mac.wm.render(host); }
      return;
    }
    const diskVolume = target.closest('[data-disk-volume]');
    if (diskVolume) {
      const host = winFor(diskVolume);
      if (host) { host.state.selected = diskVolume.dataset.diskVolume; host.state.report = ''; Mac.wm.render(host); }
      return;
    }
    const sysinfo = target.closest('[data-sysinfo-section]');
    if (sysinfo) {
      const host = winFor(sysinfo);
      if (host) { host.state.section = sysinfo.dataset.sysinfoSection; Mac.wm.render(host); }
      return;
    }
    const calcKey = target.closest('[data-calc-key]');
    if (calcKey) { Mac.Calculator.press(calcKey.dataset.calcKey); return; }
    const note = target.closest('[data-note]');
    if (note) {
      const host = winFor(note);
      if (host) { host.state.selected = note.dataset.note; Mac.wm.render(host); }
      return;
    }
    const thread = target.closest('[data-message-thread]');
    if (thread) {
      Mac.state.messages.selected = thread.dataset.messageThread;
      Mac.save();
      Mac.wm.refresh('messages');
      return;
    }
    const track = target.closest('[data-music-track]');
    if (track) { Mac.Media.play(Number(track.dataset.musicTrack)); return; }
    const reminder = target.closest('[data-reminder-toggle]');
    if (reminder) {
      const host = winFor(reminder);
      const item = host?.state.items?.find(candidate => candidate.id === reminder.dataset.reminderToggle);
      if (item) { item.done = !item.done; Mac.wm.render(host); }
      return;
    }
    const calendarToggle = target.closest('[data-calendar-toggle]');
    if (calendarToggle) {
      const calendar = Mac.state.calendar.calendars.find(candidate => candidate.id === calendarToggle.dataset.calendarToggle);
      if (calendar) { calendar.on = !calendar.on; Mac.save(); Mac.wm.refresh('calendar'); }
      return;
    }
    const contact = target.closest('[data-contact]');
    if (contact) {
      const host = winFor(contact);
      if (host) { host.state.selected = Number(contact.dataset.contact); Mac.wm.render(host); }
      return;
    }
    const webAnchor = target.closest('[data-web-anchor]');
    if (webAnchor) {
      event.preventDefault();
      const host = winFor(webAnchor);
      if (host) Mac.Browser.scrollToAnchor(host, webAnchor.dataset.webAnchor);
      return;
    }

    const spotResult = target.closest('[data-spot-index]');
    if (spotResult) { Mac.Spotlight.index = Number(spotResult.dataset.spotIndex); Mac.Spotlight.activate(); return; }

    /* --------------------------------------------------- focus and dismiss */
    const windowHost = target.closest('.window');
    if (windowHost) {
      const host = Mac.wm.windows.get(windowHost.dataset.win);
      if (host && Mac.session.activeWindow !== host.id) Mac.wm.focus(host.id);
      return;
    }

    if (!target.closest('.popover, .spotlight, #launchpad, #mission-control, .menu-bar, .dock, .toast')) {
      Mac.Surfaces.close();
      if (target.closest('#desktop')) {
        Mac.$$('.desktop-item.selected').forEach(node => node.classList.remove('selected'));
      }
    }
  });

  /* ------------------------------------------------------------ double click */

  document.addEventListener('dblclick', event => {
    const file = event.target.closest('[data-file]');
    if (!file) return;
    const host = Mac.wm.windows.get(file.dataset.win) || winFor(file);
    if (host) Mac.Finder.open(host, file.dataset.file);
  });

  /* ------------------------------------------------------------------ forms */

  document.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target;

    if (form.id === 'login-form' || form.id === 'login-form-password') {
      const guest = (Mac.session.loginUser || 'isaiah') === 'guest';
      Mac.Screens.login(Mac.$('#login-password')?.value || '', { guest });
      return;
    }
    if (form.id === 'unlock-form') {
      Mac.Screens.unlock(Mac.$('#unlock-password').value);
      return;
    }
    if (form.matches('[data-wiki-form]')) {
      const host = winFor(form) || appWin('safari');
      const input = form.querySelector('input');
      Mac.run('wiki-search', input.value, form);
      void host;
      return;
    }
    if (form.matches('[data-address-form]')) {
      const host = winFor(form) || appWin('safari');
      const input = form.querySelector('input');
      Mac.Browser.navigate(host, input.value);
      return;
    }
    if (form.matches('[data-message-form]')) {
      const input = form.querySelector('input');
      Mac.Media && Mac.apps.messages.send(input.value);
      input.value = '';
    }
  });

  /* ------------------------------------------------------------------ input */

  const saveNote = Mac.debounce((win, value) => Mac.Notes.save(win, value), 240);
  const saveText = Mac.debounce(value => { Mac.state.appData.textedit = value; Mac.save(); }, 220);

  /** Re-render a window while preserving the caret position of a live field. */
  const rerenderKeepingCaret = (win, selector) => {
    const active = document.activeElement;
    const position = active?.selectionStart;
    Mac.wm.render(win);
    const next = win.el.querySelector(selector);
    if (next) {
      next.focus();
      if (position != null) next.setSelectionRange(position, position);
    }
  };

  /**
   * The search fields, which were eight near-identical blocks.
   *
   * `apply` writes the query wherever that app keeps it; `app` is set for
   * the two whose query lives in persisted state rather than on the window,
   * so the field can be typed into from a window other than the one that
   * has to re-render.
   */
  const SEARCH_FIELDS = [
    { attr: 'data-settings-search', apply: (win, value) => { win.state.query = value; } },
    { attr: 'data-finder-search', apply: (win, value) => { win.state.query = value; } },
    { attr: 'data-store-search', apply: (win, value) => { win.state.query = value; win.state.detail = null; } },
    { attr: 'data-activity-search', apply: (win, value) => { win.state.query = value; } },
    { attr: 'data-console-search', apply: (win, value) => { win.state.query = value; } },
    { attr: 'data-notes-search', apply: (win, value) => { win.state.query = value; } },
    { attr: 'data-mail-search', app: 'mail', apply: (win, value) => { Mac.state.mail.search = value; Mac.save(); } },
    { attr: 'data-outlook-search', app: 'outlook', apply: (win, value) => { Mac.state.outlook.search = value; Mac.save(); } },
  ];

  /* One shared debounce: only one field can be typed into at a time. */
  const rerenderSearch = Mac.debounce(
    (win, selector) => { if (Mac.wm.windows.has(win.id)) rerenderKeepingCaret(win, selector); },
    130,
  );

  document.addEventListener('input', event => {
    const target = event.target;
    const win = winFor(target);

    if (target.matches('[data-range-path]')) {
      const path = target.dataset.rangePath;
      const value = Number(target.value);
      target.style.setProperty('--fill-pct', `${((value - Number(target.min || 0)) / (Number(target.max || 100) - Number(target.min || 0))) * 100}%`);
      if (path === 'settings.volume') Mac.state.settings.muted = false;
      Mac.set(path, value, { silent: true });
      Mac.sync();
      if (path === 'settings.volume') Mac.hud('volume', value, `Volume ${value}%`);
      if (path === 'settings.brightness') Mac.hud('sun', value, `Brightness ${value}%`);
      if (path === 'settings.keyboardBrightness') Mac.hud('keyboard', value, `Keyboard ${value}%`);
      return;
    }

    const search = SEARCH_FIELDS.find(field => target.matches(`[${field.attr}]`));
    if (search) {
      const host = search.app ? Mac.wm.forApp(search.app)[0] : win;
      if (!host) return;
      search.apply(host, target.value);
      /* Debounced: the field is a real <input> and keeps its own text
         without any help, so only the filtered result waits. Every keystroke
         used to re-render the whole window, which in Mail means rebuilding a
         message list of several hundred rows per character typed. */
      rerenderSearch(host, `[${search.attr}]`);
      return;
    }
    if (target.id === 'launchpad-input') {
      Mac.Shell.launchpad.query = target.value;
      Mac.Shell.launchpad.page = 0;
      Mac.Shell.renderLaunchpad();
      Mac.$('#launchpad-input').focus();
      return;
    }
    if (target.id === 'spotlight-input') { Mac.Spotlight.render(target.value); return; }

    if (target.matches('[data-note-editor]') && win) { saveNote(win, target.value); return; }
    if (target.matches('[data-textedit]')) { saveText(target.value); return; }
    if (target.matches('[data-terminal-input]') && win) { win.state.input = target.value; return; }
    if (target.matches('[data-lock-message]')) { Mac.set('settings.lockMessage', target.value, { silent: true }); return; }
    if (target.matches('[data-outlook-signature]')) { Mac.set('outlook.signature', target.value, { silent: true }); return; }
    if (target.matches('[data-outlook-autoreply]')) { Mac.set('outlook.autoReply.message', target.value, { silent: true }); return; }
    if (target.matches('[data-mail-signature-body]')) {
      const signature = Mac.state.mail.signatures.find(item => item.id === target.dataset.mailSignatureBody);
      if (signature) { signature.body = target.value; Mac.save(); }
      return;
    }
    if (target.matches('[data-mail-field]')) {
      const account = Mac.Mail.account(target.dataset.account);
      if (account) { Mac.setPath(account, target.dataset.mailField, target.value); Mac.save(); }
    }
  });

  document.addEventListener('change', event => {
    const target = event.target;
    if (!target.matches('[data-select-path]')) return;
    const path = target.dataset.selectPath;
    let value = target.value;
    if (value === 'true' || value === 'false') value = value === 'true';
    Mac.set(path, value);
    Mac.wm.refreshAll();
  });

  document.addEventListener('focusin', event => {
    event.target.closest('.search')?.classList.add('focused');
  });
  document.addEventListener('focusout', event => {
    event.target.closest('.search')?.classList.remove('focused');
  });

  /* --------------------------------------------------------------- keyboard */

  document.addEventListener('keydown', event => {
    const cmd = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const inField = event.target.matches('input, textarea, select');

    // Terminal input has its own handling (Enter and history).
    const terminal = event.target.closest('[data-terminal-input]');
    if (terminal) {
      const win = winFor(terminal);
      if (event.key === 'Enter') { Mac.Terminal.run(win, terminal.value); return; }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const history = win.state.history;
        if (!history.length) return;
        win.state.historyIndex = event.key === 'ArrowUp'
          ? Mac.clamp((win.state.historyIndex < 0 ? history.length : win.state.historyIndex) - 1, 0, history.length - 1)
          : Mac.clamp(win.state.historyIndex + 1, 0, history.length);
        terminal.value = history[win.state.historyIndex] || '';
        return;
      }
    }

    // An open menu owns the arrow keys.
    if (Mac.session.surface && Mac.session.surface !== 'spotlight' && Mac.Surfaces.keyboard(event)) {
      event.preventDefault();
      return;
    }

    // Spotlight navigation.
    if (Mac.session.surface === 'spotlight' && !Mac.$('.spotlight-apps')) {
      if (event.key === 'ArrowDown') { event.preventDefault(); Mac.Spotlight.move(1); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); Mac.Spotlight.move(-1); return; }
      if (event.key === 'Enter') { event.preventDefault(); Mac.Spotlight.activate(); return; }
    }

    if (event.key === 'Escape') {
      if (Mac.Dialog.current) { Mac.Dialog.close(); return; }
      if (Mac.$('#launchpad')) { Mac.Shell.closeLaunchpad(); return; }
      if (Mac.$('#mission-control')) { Mac.MissionControl.close(); return; }
      if (Mac.session.surface) { Mac.Surfaces.close(); return; }
      if (Mac.session.fullscreenWindow) { Mac.wm.toggleFullscreen(Mac.session.fullscreenWindow); return; }
      return;
    }

    // Sleep screen wakes on any key.
    if (!Mac.$('#sleep-screen').classList.contains('hidden')) { Mac.Screens.desktop(); return; }

    if (cmd && event.code === 'Space') { event.preventDefault(); Mac.Spotlight.open(); return; }
    if (event.key === 'F3' || (event.ctrlKey && event.key === 'ArrowUp')) { event.preventDefault(); Mac.MissionControl.open(); return; }
    if (event.key === 'F4') { event.preventDefault(); Mac.Shell.openLaunchpad(); return; }

    if (cmd && event.ctrlKey && key === 'q') { event.preventDefault(); Mac.Power.execute('lock'); return; }
    if (cmd && event.shiftKey && key === 'q') { event.preventDefault(); Mac.Power.request('logout'); return; }
    if (cmd && event.altKey && event.key === 'Escape') { event.preventDefault(); Mac.Power.forceQuitDialog(); return; }

    // Desktop-only shortcuts (skip while typing).
    if (Mac.$('#desktop').classList.contains('hidden')) return;

    if (event.ctrlKey && event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      Mac.wm.tileWindow(Mac.session.activeWindow, event.key === 'ArrowLeft' ? 'left' : 'right');
      return;
    }
    if (event.ctrlKey && !event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      Mac.wm.gotoSpace(Mac.session.space + (event.key === 'ArrowLeft' ? -1 : 1));
      return;
    }
    if (cmd && event.shiftKey && event.key === '3') { event.preventDefault(); Mac.run('take-screenshot'); return; }
    if (cmd && event.shiftKey && event.key === 'Backspace') { event.preventDefault(); Mac.Finder.emptyTrash(); return; }

    if (cmd && key === '`') { event.preventDefault(); Mac.wm.cycleWindows(); return; }
    if (cmd && event.key === 'Tab') { event.preventDefault(); Mac.wm.cycleApps(event.shiftKey); return; }
    if (cmd && key === 'm' && !inField) { event.preventDefault(); Mac.wm.minimize(); return; }
    if (cmd && key === 'w' && !inField) { event.preventDefault(); Mac.run('close-window', null, event.target); return; }
    if (cmd && key === 'n' && !inField) { event.preventDefault(); Mac.run('new-window'); return; }
    if (cmd && key === ',' && !inField) { event.preventDefault(); Mac.run('app-settings'); return; }
    if (cmd && event.ctrlKey && key === 'f') { event.preventDefault(); Mac.wm.toggleFullscreen(); return; }

    /* Finder file operations. Guarded on the active window being Finder so
       ⌘C in Mail still copies text, and skipped inside a field for the same
       reason. */
    const finderWin = Mac.wm.windows.get(Mac.session.activeWindow);
    if (finderWin?.appId === 'finder' && !inField) {
      if (cmd && event.shiftKey && key === 'g') { event.preventDefault(); Mac.Finder.goToFolder(finderWin); return; }
      if (cmd && !event.shiftKey && key === 'c') { event.preventDefault(); Mac.Finder.copyToClipboard(finderWin); return; }
      if (cmd && !event.shiftKey && key === 'x') { event.preventDefault(); Mac.Finder.copyToClipboard(finderWin, { cut: true }); return; }
      if (cmd && !event.shiftKey && key === 'v') { event.preventDefault(); Mac.Finder.paste(finderWin); return; }
      if (cmd && !event.shiftKey && key === 'd') { event.preventDefault(); Mac.Finder.duplicate(finderWin); return; }
      if (cmd && !event.shiftKey && key === 'e') { event.preventDefault(); Mac.Finder.eject('vol-backup'); return; }
    }

  });

  /**
   * Keep Tab inside an open dialog.
   *
   * This used to live at the end of the handler above, behind an early
   * return for "the desktop is hidden" — so it did nothing on the login
   * window, the lock screen or the Setup Assistant, which are exactly where
   * a modal is most likely to be the only thing on screen. It also only
   * redirected at the two boundaries, so focus that started outside the
   * dialog (on the desktop behind it) walked the background freely.
   *
   * Registered separately, in the capture phase, so no earlier `return` in
   * the shortcut table can skip it.
   */
  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !Mac.Dialog.current) return;
    const focusable = Mac.$$('#modal-layer button:not(:disabled), #modal-layer input:not([type=hidden]), '
      + '#modal-layer select, #modal-layer textarea, #modal-layer [tabindex="0"]');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const inside = Mac.$('#modal-layer').contains(document.activeElement);
    if (!inside) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }, true);

  /* --------------------------------------------------------- context menus */

  document.addEventListener('contextmenu', event => {
    const dockItem = event.target.closest('[data-dock-app]');
    if (dockItem) {
      event.preventDefault();
      const appId = dockItem.dataset.dockApp;
      const windows = Mac.wm.forApp(appId);
      const items = [];
      if (windows.length) {
        items.push({ caption: 'Windows' });
        windows.forEach(candidate => items.push({
          label: Mac.apps[appId].titleFor ? Mac.apps[appId].titleFor(candidate) : Mac.apps[appId].title,
          command: 'focus-window',
          arg: candidate.id,
        }));
        items.push('sep');
        items.push({ label: 'Show All Windows', command: 'mission-control' });
        items.push({ label: 'Hide', command: 'hide-app' });
        items.push({ label: 'Quit', command: 'force-quit-app', arg: appId });
      } else {
        items.push({ label: 'Open', command: 'open-app', arg: appId });
      }
      if (appId === 'trash') {
        items.length = 0;
        items.push({ label: 'Open', command: 'open-app', arg: 'trash' });
        items.push({ label: 'Empty Trash…', command: 'empty-trash', disabled: !Mac.FS.children('trash').length });
      }
      items.push('sep');
      items.push({ label: 'Options', command: 'open-setting', arg: 'Desktop & Dock' });
      Mac.Surfaces.contextMenu(event.clientX, event.clientY, items);
      return;
    }

    const file = event.target.closest('[data-file]');
    if (file) {
      event.preventDefault();
      const host = Mac.wm.windows.get(file.dataset.win) || winFor(file);
      if (host) { host.state.selected = file.dataset.file; Mac.wm.render(host); }
      Mac.Surfaces.contextMenu(event.clientX, event.clientY, Mac.Finder.contextItems(host, file.dataset.file));
      return;
    }

    const titlebar = event.target.closest('.titlebar');
    if (titlebar) {
      event.preventDefault();
      const host = winFor(titlebar);
      Mac.Surfaces.contextMenu(event.clientX, event.clientY, [
        { label: 'Move Window to Left Side of Screen', command: 'tile', arg: 'left' },
        { label: 'Move Window to Right Side of Screen', command: 'tile', arg: 'right' },
        { label: 'Fill Screen', command: 'tile', arg: 'fill' },
        'sep',
        { label: 'Minimise', command: 'minimize-window' },
        { label: host?.zoomed ? 'Unzoom' : 'Zoom', command: 'zoom-window' },
        { label: 'Enter Full Screen', command: 'toggle-fullscreen' },
        'sep',
        ...Mac.state.spaces.map((space, index) => ({
          label: `Move to ${space.name}`,
          command: 'move-window-space',
          arg: String(index),
          disabled: host?.space === index,
        })),
      ]);
      return;
    }

    if (event.target.closest('#desktop') && !event.target.closest('.window, .dock, .menu-bar, .popover')) {
      event.preventDefault();
      Mac.Surfaces.contextMenu(event.clientX, event.clientY, [
        { label: 'New Folder', command: 'finder-new-folder' },
        { label: 'Get Info', command: 'about-mac' },
        'sep',
        { label: 'Change Wallpaper…', command: 'open-setting', arg: 'Wallpaper' },
        { label: 'Show Mission Control', command: 'mission-control' },
        { label: 'Show Apps', command: 'launchpad' },
        'sep',
        { label: 'Use Stacks', command: 'generic' },
        { label: 'Sort By', command: 'generic' },
      ]);
    }
  });

  // Moving a window between spaces from the titlebar context menu.
  Mac.on('windows', () => {});
  const originalRun = Mac.run;
  Mac.run = async (command, arg, element) => {
    if (command === 'move-window-space') {
      Mac.wm.moveToSpace(winFor(element)?.id || Mac.session.activeWindow, Number(arg));
      return;
    }
    await originalRun(command, arg, element);
  };

  /* -------------------------------------------------------------- viewport */

  window.addEventListener('resize', Mac.debounce(() => {
    Mac.wm.reflow();
    Mac.Shell.renderLaunchpad?.();
  }, 120));

  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (Mac.state.settings.appearance === 'auto') { Mac.sync(); Mac.wm.refreshAll(); }
  });

  // Clicking the desktop wallpaper reveals it, when that preference is on.
  document.addEventListener('pointerdown', event => {
    if (!Mac.state.settings.clickWallpaper) return;
    if (event.target.id !== 'desktop') return;
    Mac.wm.minimizeAll();
  });
}(window.Mac));
