/* ===========================================================================
   Default state.

   This is the whole simulated Mac as data: preferences, the Apple Account, the
   file system, mail for two clients, browser history, installed apps, logs and
   diagnostics. `schema` is bumped whenever the shape changes so old saves are
   discarded instead of half-migrated.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const DAY = 86400000;
  const now = Date.now();

  /* Files are stored flat with a parent pointer, which makes real folder
     navigation, moving to Trash and "Put Back" straightforward. */
  const fs = [
    { id: 'vol-hd', name: 'Macintosh HD', kind: 'volume', parent: null },
    { id: 'dir-apps', name: 'Applications', kind: 'folder', parent: 'vol-hd', system: true },
    { id: 'dir-library', name: 'Library', kind: 'folder', parent: 'vol-hd', system: true },
    { id: 'dir-system', name: 'System', kind: 'folder', parent: 'vol-hd', system: true },
    { id: 'dir-users', name: 'Users', kind: 'folder', parent: 'vol-hd', system: true },
    { id: 'dir-home', name: Mac.PERSONA.shortName, kind: 'folder', parent: 'dir-users', home: true },

    { id: 'dir-desktop', name: 'Desktop', kind: 'folder', parent: 'dir-home' },
    { id: 'dir-documents', name: 'Documents', kind: 'folder', parent: 'dir-home' },
    { id: 'dir-downloads', name: 'Downloads', kind: 'folder', parent: 'dir-home' },
    { id: 'dir-pictures', name: 'Pictures', kind: 'folder', parent: 'dir-home' },
    { id: 'dir-music', name: 'Music', kind: 'folder', parent: 'dir-home' },
    { id: 'dir-movies', name: 'Movies', kind: 'folder', parent: 'dir-home' },
    { id: 'dir-public', name: 'Public', kind: 'folder', parent: 'dir-home' },

    { id: 'dir-training', name: 'Projects', kind: 'folder', parent: 'dir-documents' },
    { id: 'dir-escalations', name: 'Archive', kind: 'folder', parent: 'dir-training' },

    { id: 'f-guide', name: 'Project Overview.pdf', kind: 'file', ext: 'pdf', parent: 'dir-documents', size: 1887436, modified: now - 2 * 3600e3 },
    { id: 'f-runbook', name: 'Meeting Notes.pdf', kind: 'file', ext: 'pdf', parent: 'dir-training', size: 964512, modified: now - DAY },
    { id: 'f-checklist', name: 'Document.pdf', kind: 'file', ext: 'pdf', parent: 'dir-downloads', size: 839680, modified: now - 3 * DAY },
    { id: 'f-notes', name: 'Notes.txt', kind: 'file', ext: 'txt', parent: 'dir-desktop', size: 12288, modified: now - 5400e3 },
    { id: 'f-transcript', name: 'Notes Archive.txt', kind: 'file', ext: 'txt', parent: 'dir-escalations', size: 22300, modified: now - 6 * DAY },
    { id: 'f-report', name: 'Report.txt', kind: 'file', ext: 'txt', parent: 'dir-desktop', size: 4096, modified: now - 26 * 3600e3 },
    { id: 'f-screenshot', name: 'Screenshot 2026-07-14 at 09.41.12.png', kind: 'file', ext: 'png', parent: 'dir-desktop', size: 512000, modified: now - 9 * 3600e3 },
    { id: 'f-photo1', name: 'Team Offsite.jpeg', kind: 'file', ext: 'jpeg', parent: 'dir-pictures', size: 2411724, modified: now - 12 * DAY },
    { id: 'f-song', name: 'Focus Loop.m4a', kind: 'file', ext: 'm4a', parent: 'dir-music', size: 6291456, modified: now - 30 * DAY },
    { id: 'f-clip', name: 'Handoff Demo.mov', kind: 'file', ext: 'mov', parent: 'dir-movies', size: 48234496, modified: now - 20 * DAY },
    { id: 'f-installer', name: 'PrinterDriver.pkg', kind: 'file', ext: 'pkg', parent: 'dir-downloads', size: 15728640, modified: now - 8 * DAY },
    { id: 'f-shared', name: 'Read Me First.txt', kind: 'file', ext: 'txt', parent: 'dir-public', size: 2048, modified: now - 40 * DAY },
    { id: 'f-old', name: 'Old Ticket Export.csv', kind: 'file', ext: 'csv', parent: 'trash', trashedFrom: 'dir-documents', size: 71680, modified: now - 15 * DAY },

    /* The external disk. It is always in the file system; whether Finder
       shows it is decided by `mounted` on the matching entry in `volumes`,
       so plugging it in and ejecting it are one flag rather than two
       parallel models that can disagree. */
    { id: 'vol-backup', name: 'Time Machine Backup', kind: 'volume', parent: null, external: true },
    { id: 'dir-backups', name: 'Backups.backupdb', kind: 'folder', parent: 'vol-backup', system: true },
    { id: 'dir-backup-mac', name: Mac.PERSONA.computer, kind: 'folder', parent: 'dir-backups' },
    { id: 'f-backup-latest', name: 'Latest.backup', kind: 'file', ext: 'backup', parent: 'dir-backup-mac', size: 182536110080, modified: now - 3 * 3600e3 },
    { id: 'dir-backup-archive', name: 'Archive', kind: 'folder', parent: 'vol-backup' },
    { id: 'f-backup-tickets', name: 'Ticket Exports 2025.csv', kind: 'file', ext: 'csv', parent: 'dir-backup-archive', size: 3421184, modified: now - 120 * DAY },
    { id: 'f-backup-photos', name: 'Photo Library Archive.zip', kind: 'file', ext: 'zip', parent: 'dir-backup-archive', size: 24696061952, modified: now - 90 * DAY },
  ];

  Mac.DefaultState = {
    schema: 15,

    /* ------------------------------------------------------------ settings */
    settings: {
      appearance: 'light',
      accent: 'blue',
      highlight: 'accent',
      wallpaper: 'golden-gate',
      wallpaperDarkAuto: true,
      reduceMotion: false,
      reduceTransparency: false,
      increaseContrast: false,
      textScale: 1,
      time24: false,

      dockSize: 56,
      dockMagnification: true,
      dockAutoHide: false,
      dockPosition: 'bottom',
      dockRecents: false,
      animateOpening: true,
      menuBarTinted: false,
      autoHideMenuBar: false,
      clickWallpaper: false,

      brightness: 82,
      trueTone: true,
      nightShift: false,
      autoBrightness: true,
      displayResolution: 'Default for display',
      refreshRate: 'ProMotion',

      volume: 58,
      muted: false,
      alertVolume: 70,
      soundEffects: true,
      startupChime: true,

      bluetooth: true,
      focus: false,
      focusMode: 'Do Not Disturb',
      notifications: true,
      notificationPreviews: true,
      notificationBadges: true,
      screenTime: false,
      siri: true,
      listenForSiri: false,
      spotlightSuggestions: true,

      firewall: true,
      fileVault: true,
      locationServices: true,
      analytics: false,
      autoUpdates: true,
      installSecurityResponses: true,
      gatekeeper: 'App Store and identified developers',
      lockdownMode: false,

      keyboardBrightness: 60,
      autoKeyboardBrightness: true,
      keyRepeat: 'Fast',
      tapToClick: true,
      naturalScroll: true,
      forceClick: true,
      trackpadSpeed: 62,
      mouseSpeed: 55,
      secondaryClick: true,

      lockAfter: 'Immediately',
      displayOffBattery: '10 minutes',
      displayOffPower: '20 minutes',
      screenSaver: 'Drift',
      screenSaverAfter: '10 minutes',
      largeLockClock: true,
      passwordHints: true,
      showLockMessage: false,
      lockMessage: '',
      loginWindowShows: 'List of users',
      showPowerButtons: true,
      guestUser: false,
      autoLogin: false,

      lowPowerMode: false,
      dimOnBattery: true,
      optimizedCharging: true,
      preventSleepDisplayOff: false,

      language: 'English (US)',
      region: 'United States',
      autoTimezone: true,
      computerName: Mac.PERSONA.computer,
      airdropVisibility: 'Contacts Only',
      handoff: true,
      screenSharing: false,
      remoteLogin: false,
      fileSharing: false,
      printerOnline: false,
      askToJoin: 'Ask',
      stageManager: false,
      showWifiMenu: true,
      showBluetoothMenu: true,
      showBatteryPercent: true,
      spacesRearrange: true,
    },

    /* ------------------------------------------------------- Apple Account */
    account: {
      signedIn: true,
      name: Mac.PERSONA.name,
      email: Mac.PERSONA.personal,
      appleId: Mac.PERSONA.personal,
      initials: 'AR',
      twoFactor: true,
      trustedPhone: '+1 (407) •••-••42',
      recoveryContact: 'Not set up',
      recoveryKey: false,
      payment: 'Visa •••• 4412',
      subscriptions: [
        { name: 'iCloud+ 200 GB', price: '$2.99/month', renews: 'Aug 22, 2026' },
        { name: 'Apple Music', price: '$10.99/month', renews: 'Aug 9, 2026' },
      ],
      icloud: {
        plan: '200 GB',
        totalBytes: 214748364800,
        usedBytes: 96636764160,
        breakdown: [
          { label: 'Photos', bytes: 51539607552, color: '#f2a33c' },
          { label: 'Backups', bytes: 25769803776, color: '#2f7cf6' },
          { label: 'Documents', bytes: 12884901888, color: '#6c5ce7' },
          { label: 'Mail', bytes: 6442450944, color: '#0f9d58' },
        ],
        driveOn: true,
        desktopDocuments: true,
        photosOn: true,
        mailOn: true,
        keychainOn: true,
        privateRelay: true,
        hideEmail: true,
        findMyMac: true,
      },
      family: {
        enabled: true,
        organizer: Mac.PERSONA.name,
        members: [
          { name: Mac.PERSONA.name, role: 'Organizer', initials: 'AR' },
          { name: 'Dana Whitfield', role: 'Adult', initials: 'DW' },
          { name: 'Milo Rivera', role: 'Child · 11', initials: 'MR' },
        ],
        purchaseSharing: true,
        locationSharing: true,
        screenTimeForKids: true,
      },
      devices: [
        { name: Mac.PERSONA.computer, kind: 'This Mac', model: 'MacBook Pro 14-inch, M4 Pro', os: 'macOS 27.0.1', icon: 'system-info', trusted: true },
        { name: "Alex's iPhone", kind: 'iPhone 17 Pro', model: 'iPhone 17 Pro', os: 'iOS 27.0.1', icon: 'facetime', trusted: true },
        { name: 'Studio iPad', kind: 'iPad Air', model: 'iPad Air (M3)', os: 'iPadOS 26.5', icon: 'freeform', trusted: true },
        { name: 'Support Watch', kind: 'Apple Watch', model: 'Apple Watch Series 11', os: 'watchOS 26.4', icon: 'time-machine', trusted: true },
      ],
    },

    /* ------------------------------------------------------------- network */
    wifi: {
      enabled: true,
      current: 'Sablewave Home',
      status: 'connected',
      captive: false,
      saved: ['Sablewave Home', 'Support Bench 5G'],
      autoJoin: { 'Sablewave Home': true, 'Support Bench 5G': true },
      dns: ['1.1.1.1', '8.8.8.8'],
      ip: '192.168.1.42',
      router: '192.168.1.1',
      subnet: '255.255.255.0',
      dhcp: true,
      lastDiagnostic: null,
      proxy: false,
    },
    ethernet: { connected: false, cable: false },
    vpn: { configured: false, connected: false, name: '' },
    bluetoothDevices: [
      { id: 'bt-kb', name: 'Magic Keyboard', kind: 'Keyboard', icon: 'keyboard', connected: true, battery: 74 },
      { id: 'bt-mouse', name: 'Magic Mouse', kind: 'Mouse', icon: 'mouse', connected: true, battery: 52 },
      { id: 'bt-buds', name: 'AirPods Pro', kind: 'Headphones', icon: 'volume', connected: false, battery: 91 },
      { id: 'bt-speaker', name: 'Bench Speaker', kind: 'Speaker', icon: 'volume', connected: false, battery: null },
    ],
    printers: [],

    /* --------------------------------------------------------- file system */
    fs,
    volumes: [
      { id: 'vol-hd', name: 'Macintosh HD', totalBytes: 494384795648, usedBytes: 182536110080, kind: 'internal', encrypted: true, smart: 'Verified' },
      { id: 'vol-backup', name: 'Time Machine Backup', totalBytes: 1000204886016, usedBytes: 421000000000, kind: 'external', encrypted: false, smart: 'Verified', mounted: false },
    ],
    storageBreakdown: [
      { label: 'Applications', bytes: 39728447488, color: '#2f7cf6' },
      { label: 'Documents', bytes: 24696061952, color: '#6c5ce7' },
      { label: 'Photos', bytes: 18253611008, color: '#f2a33c' },
      { label: 'macOS', bytes: 21474836480, color: '#8e98a5' },
      { label: 'System Data', bytes: 12884901888, color: '#0aa3c2' },
    ],

    /* ---------------------------------------------------------------- apps */
    installedApps: ['finder', 'launchpad', 'safari', 'mail', 'outlook', 'messages', 'maps',
      'photos', 'facetime', 'calendar', 'contacts', 'reminders', 'notes', 'freeform', 'music',
      'podcasts', 'appstore', 'settings', 'terminal', 'activity-monitor', 'disk-utility',
      'console', 'textedit', 'preview', 'calculator', 'screenshot', 'time-machine',
      'keychain', 'system-info', 'migration', 'weather', 'trash'],
    dockApps: ['finder', 'launchpad', 'safari', 'mail', 'outlook', 'messages', 'calendar',
      'notes', 'appstore', 'settings', 'terminal', 'activity-monitor'],
    appUpdates: [
      { id: 'safari', version: '27.0.1.1', size: 128974848, notes: 'Improves handling of captive network portals and fixes a rendering issue on reader pages.' },
      { id: 'outlook', version: '16.92', size: 604897280, notes: 'Adds Focused Inbox controls and resolves a sync stall on shared mailboxes.' },
    ],
    storeInstalls: [],
    /* The scenario in progress: which one, when it started, what has been
       done, and which goals have been met. Persisted so a reload does not
       lose a half-finished exercise. */
    scenario: { id: null, startedAt: 0, log: [], done: [] },
    /* The pending macOS update. `stage` walks available → downloading →
       downloaded → installing, and installing ends in a restart. */
    osUpdate: { stage: 'installed', progress: 100 },
    osVersion: null,   // null means still on Mac.OS_VERSION
    osBuild: null,

    /* --------------------------------------------------------------- notes */
    notes: [{ id:'note-welcome', title:'Notes', body:'Notes', folder:'Notes', pinned:false, updated:now }],
    appData: {
      textedit: '',
      calculator: '0',
      calculatorTape: '',
      previewZoom: 1,
    },

    /* -------------------------------------------------------------- Safari */
    browser: {
      favorites: [
        { title: 'Apple Support', url: 'support.apple.local', color: '#2f7cf6' },
        { title: 'Network Test', url: 'network.test', color: '#0f9d58' },
        { title: 'Apple', url: 'apple.local', color: '#333333' },
        { title: 'Status Board', url: 'status.local', color: '#ef8b2c' },
        { title: 'Knowledge Base', url: 'kb.local', color: '#0aa3c2' },
        { title: 'Wikipedia', url: 'wikipedia.org/wiki/Main_Page', color: '#3c3c3c' },
        { title: 'Deceptive Demo', url: 'unsafe.test', color: '#e0455f' },
      ],
      bookmarks: [
        { title: 'Wi-Fi troubleshooting', url: 'kb.local/wifi' },
        { title: 'Startup key combinations', url: 'kb.local/startup' },
        { title: 'Reset SMC and NVRAM', url: 'kb.local/nvram' },
        { title: 'Macintosh — Wikipedia', url: 'wikipedia.org/wiki/Macintosh' },
        { title: 'macOS — Wikipedia', url: 'wikipedia.org/wiki/MacOS' },
      ],
      history: [],
      downloads: [],
      readingList: [],
      private: false,
      liveWeb: true,
      searchEngine: 'Google',
      blockPopups: true,
      preventTracking: true,
      warnFraud: true,
    },

    /* ------------------------------------------------------------ Mail app */
    mail: {
      accounts: [
        {
          id: 'acct-icloud', provider: 'iCloud', name: Mac.PERSONA.name,
          address: Mac.PERSONA.personal, description: 'iCloud', enabled: true,
          color: '#2f7cf6', status: 'Online', lastChecked: 'Just now',
          incoming: { host: 'imap.mail.me.example', port: '993', tls: true, auth: 'Password' },
          outgoing: { host: 'smtp.mail.me.example', port: '587', tls: true, auth: 'Password' },
          mailboxes: { drafts: 'Drafts', sent: 'Sent', junk: 'Junk', trash: 'Trash', archive: 'Archive' },
        },
        {
          id: 'acct-work', provider: 'Exchange', name: Mac.PERSONA.name,
          address: Mac.PERSONA.work, description: 'Support Desk', enabled: true,
          color: '#0f9d58', status: 'Online', lastChecked: '2 minutes ago',
          incoming: { host: 'outlook.office365.example', port: '993', tls: true, auth: 'OAuth' },
          outgoing: { host: 'smtp.office365.example', port: '587', tls: true, auth: 'OAuth' },
          mailboxes: { drafts: 'Drafts', sent: 'Sent Items', junk: 'Junk Email', trash: 'Deleted Items', archive: 'Archive' },
        },
      ],
      activeAccountId: 'acct-icloud',
      mailbox: 'Inbox',
      selected: 'mail-1',
      category: 'All',
      search: '',
      settingsPane: 'General',
      general: { checkInterval: 'Automatically', newMessageSound: 'New Messages', dockUnread: 'Inbox only', downloadsFolder: 'Downloads' },
      viewing: { previewLines: '2 Lines', boldUnread: true, smartAddresses: true, newestFirst: true, threading: true },
      composing: { format: 'Rich Text', spelling: 'As I Type', quoteOriginal: true, sendFrom: 'Selected Mailbox Account' },
      junk: { enabled: true, action: 'Move it to the Junk mailbox', exemptContacts: true, trustHeaders: true },
      privacy: { protectActivity: true, hideIP: true, blockRemoteContent: true },
      signatures: [
        { id: 'sig-1', name: 'Default', accountId: 'acct-icloud', body: 'Alex Rivera\nSent from Mail on macOS Golden Gate' },
        { id: 'sig-2', name: 'Support Desk', accountId: 'acct-work', body: 'Alex Rivera\nTier 2 Support · Ext. 4412' },
      ],
      activeSignatureId: 'sig-1',
      rules: [
        { id: 'rule-1', name: 'Flag training mail', enabled: true, condition: 'Sender contains', value: 'learning@', action: 'Flag Message' },
        { id: 'rule-2', name: 'File escalations', enabled: true, condition: 'Subject contains', value: 'ESCALATION', action: 'Move to Archive' },
      ],
      blocked: ['offers@spam.example'],
      messages: [
        { id: 'mail-1', accountId: 'acct-icloud', mailbox: 'Inbox', category: 'Primary', from: 'Apple Support', email: 'support@apple.example', subject: 'Welcome to macOS Golden Gate', preview: 'A few ways to get comfortable with your new Mac.', body: 'Hi Alex,\n\nWelcome to macOS Golden Gate. The redesigned desktop keeps every familiar Mac control while bringing the new Liquid Glass material to the Dock, sidebars and toolbars.\n\nA few things worth trying:\n• Press Command-Space for Spotlight\n• Customise Control Center in System Settings\n• Use window tiling by dragging a window to a screen edge\n\nApple Support', date: now - 3600e3, unread: true, flagged: false },
        { id: 'mail-2', accountId: 'acct-work', mailbox: 'Inbox', category: 'Updates', from: 'Sablewave Learning', email: 'learning@sablewave.example', subject: 'Updated Wi-Fi troubleshooting flow', preview: 'The latest support flow is ready for review.', body: 'Hi Alex,\n\nThe updated Wi-Fi troubleshooting flow is ready. Start by confirming the customer is on the expected SSID, verify whether other devices are affected, then renew the connection before escalating.\n\nThe practice checklist is attached.\n\nSablewave Learning Team', date: now - 5 * 3600e3, unread: true, flagged: true, attachment: 'Document.pdf' },
        { id: 'mail-3', accountId: 'acct-work', mailbox: 'Inbox', category: 'Primary', from: 'Dana Whitfield', email: 'dana@support.example', subject: 'ESCALATION 4821 — captive portal loop', preview: 'Customer cannot get past the cafe sign-in page.', body: 'Alex,\n\nTicket 4821: the customer joins “Cafe Welcome”, gets the sign-in page, accepts the terms and then loses the connection. Can you reproduce it on the bench Mac and confirm whether renewing the lease clears it?\n\nThanks,\nDana', date: now - 8 * 3600e3, unread: false, flagged: false },
        { id: 'mail-4', accountId: 'acct-icloud', mailbox: 'Inbox', category: 'Transactions', from: 'Apple', email: 'no_reply@apple.example', subject: 'Your receipt from Apple', preview: 'iCloud+ 200 GB — $2.99', body: 'Receipt\n\niCloud+ 200 GB monthly plan — $2.99\nBilled to Visa •••• 4412\n\nThis is a simulated receipt.', date: now - DAY, unread: false, flagged: false },
        { id: 'mail-5', accountId: 'acct-work', mailbox: 'Inbox', category: 'Promotions', from: 'Bench Tools', email: 'news@benchtools.example', subject: 'New diagnostics utilities this month', preview: 'Disk, network and battery utilities refreshed.', body: 'This month we refreshed the diagnostics utilities used on the support bench.\n\nSimulated newsletter content.', date: now - 2 * DAY, unread: false, flagged: false },
        { id: 'mail-6', accountId: 'acct-icloud', mailbox: 'Archive', category: 'Primary', from: 'Milo', email: 'milo.rivera@icloud.example', subject: 'Screen time request', preview: 'Can I get 30 more minutes?', body: 'Can I get 30 more minutes on the iPad today?', date: now - 4 * DAY, unread: false, flagged: false },
        { id: 'mail-7', accountId: 'acct-work', mailbox: 'Sent', category: 'Primary', from: Mac.PERSONA.name, email: Mac.PERSONA.work, to: 'dana@support.example', subject: 'Re: ESCALATION 4821 — captive portal loop', preview: 'Reproduced on the bench Mac. Details inside.', body: 'Dana,\n\nReproduced it. Accepting the portal terms clears the “No Internet” state, but abandoning the portal drops the association entirely. Renewing the lease afterwards recovers it.\n\nAlex', date: now - 7 * 3600e3, unread: false, flagged: false },
        { id: 'mail-8', accountId: 'acct-icloud', mailbox: 'Junk', category: 'Primary', from: 'Offers', email: 'offers@spam.example', subject: 'You have won a device', preview: 'Claim your prize now.', body: 'This message is included to demonstrate junk filtering. It is not a real offer.', date: now - 3 * DAY, unread: true, flagged: false },
      ],
    },

    /* --------------------------------------------------------------- Outlook */
    outlook: {
      /* Outlook for Mac is an Exchange client, so the account is described the
         way the real Accounts pane describes it — type, server and mailbox
         quota all show up in support conversations. */
      account: {
        name: Mac.PERSONA.name,
        address: Mac.PERSONA.work,
        org: 'Support Desk',
        initials: 'AR',
        type: 'Microsoft Exchange',
        server: 'outlook.office365.example',
        quota: 50 * 1024 * 1024 * 1024,
        used: 21.4 * 1024 * 1024 * 1024,
      },
      module: 'mail',
      ribbonTab: 'Home',
      folder: 'Inbox',
      focused: 'focused',
      selected: 'ol-1',
      search: '',
      searchScope: 'Current Mailbox',
      collapsed: [],
      filter: 'All',
      calView: 'Week',
      calOffset: 0,
      signature: 'Alex Rivera | Tier 2 Support | Ext. 4412',
      settings: {
        focusedInbox: true, conversationView: true, readReceipts: false, autoArchive: false,
        darkMode: 'Follow system', notifyDesktop: true, sendSoon: '10 seconds',
        simplifiedRibbon: false, readingPane: 'Right', markReadOnSelect: true,
        junkProtection: 'Low', externalWarning: true, weekStart: 'Sunday', workHours: '09:00 – 17:30',
      },
      autoReply: { on: false, message: 'I am out of the office until Monday and will reply when I return.\n\nFor anything urgent please contact the Service Desk on ext. 4400.', external: true, until: '' },
      rules: [
        { id: 'ru-1', name: 'Service Desk to Inbox', when: 'From contains servicedesk@', then: 'Mark as Focused', on: true },
        { id: 'ru-2', name: 'Newsletters to Other', when: 'Subject contains digest', then: 'Move to Other', on: true },
        { id: 'ru-3', name: 'Archive old receipts', when: 'Older than 90 days', then: 'Move to Archive', on: false },
      ],
      tasks: [
        { id: 'td-1', title: 'Call back ticket 4821', due: 'Today', flagged: true, done: false },
        { id: 'td-2', title: 'Attach diagnostics to escalation', due: 'Today', flagged: false, done: false },
        { id: 'td-3', title: 'Update the Wi-Fi runbook', due: 'Tomorrow', flagged: false, done: false },
        { id: 'td-4', title: 'Return the loaner MacBook', due: 'This week', flagged: false, done: true },
      ],
      contacts: [
        { name: 'Dana Whitfield', email: 'dana@support.example', role: 'Tier 3 Support', phone: '+1 (407) 555-0148', office: 'Bench 2' },
        { name: 'Service Desk', email: 'servicedesk@support.example', role: 'Shared mailbox', phone: '+1 (407) 555-0100', office: 'Floor 1' },
        { name: 'Facilities', email: 'facilities@support.example', role: 'Distribution list', phone: '+1 (407) 555-0122', office: 'Building A' },
        { name: 'Grace Hopper', email: 'grace@support.example', role: 'Engineering', phone: '+1 (407) 555-0166', office: 'Floor 3' },
        { name: 'HR', email: 'hr@support.example', role: 'Distribution list', phone: '+1 (407) 555-0190', office: 'Floor 2' },
        { name: 'Marcus Bell', email: 'marcus@support.example', role: 'Tier 1 Support', phone: '+1 (407) 555-0102', office: 'Bench 1' },
        { name: 'Priya Raman', email: 'priya@support.example', role: 'Network Operations', phone: '+1 (407) 555-0173', office: 'Floor 3' },
      ],
      messages: [
        { id: 'ol-1', folder: 'Inbox', focused: true, from: 'IT Service Desk', email: 'servicedesk@support.example', subject: 'Weekly change window — Thursday 22:00', preview: 'Network maintenance affects the bench VLAN.', body: 'Team,\n\nThursday 22:00–23:30 the bench VLAN will be down for switch firmware. Expect DHCP renewals to fail during the window.\n\nIT Service Desk', date: now - 2 * 3600e3, unread: true, flagged: false, category: 'Blue' },
        { id: 'ol-2', folder: 'Inbox', focused: true, from: 'Dana Whitfield', email: 'dana@support.example', subject: 'Tier 2 rota for August', preview: 'Attached is the updated rota.', body: 'Hi Alex,\n\nAttached is the updated Tier 2 rota for August. You are on the late shift on the 12th and 19th.\n\nDana', date: now - 6 * 3600e3, unread: true, flagged: true, attachment: 'August Rota.pdf' },
        { id: 'ol-3', folder: 'Inbox', focused: false, from: 'Bench Tools', email: 'news@benchtools.example', subject: 'Your monthly utilities digest', preview: 'Ten diagnostics tips.', body: 'Simulated newsletter for the Other inbox.', date: now - 26 * 3600e3, unread: false, flagged: false },
        { id: 'ol-4', folder: 'Inbox', focused: false, from: 'Facilities', email: 'facilities@support.example', subject: 'Parking permits renewal', preview: 'Renew before the end of the month.', body: 'Simulated facilities notice.', date: now - 3 * DAY, unread: false, flagged: false },
        { id: 'ol-5', folder: 'Sent Items', focused: true, from: Mac.PERSONA.name, email: Mac.PERSONA.work, to: 'servicedesk@support.example', subject: 'RE: Weekly change window — Thursday 22:00', preview: 'Bench Mac will be offline, acknowledged.', body: 'Acknowledged — I will pause bench testing during the window.\n\nAlex', date: now - 90 * 60e3, unread: false, flagged: false },
        { id: 'ol-6', folder: 'Drafts', focused: true, from: Mac.PERSONA.name, email: Mac.PERSONA.work, to: 'dana@support.example', subject: 'Captive portal findings', preview: 'Draft — findings from ticket 4821.', body: 'Draft in progress.', date: now - 40 * 60e3, unread: false, flagged: false },
        { id: 'ol-7', folder: 'Deleted Items', focused: true, from: 'Old Vendor', email: 'sales@vendor.example', subject: 'Quote expiring', preview: 'Deleted item retained for 30 days.', body: 'Simulated deleted message.', date: now - 9 * DAY, unread: false, flagged: false },
        { id: 'ol-8', folder: 'Archive', focused: true, from: 'HR', email: 'hr@support.example', subject: 'Compliance training complete', preview: 'Certificate attached.', body: 'Your compliance training is recorded as complete.', date: now - 21 * DAY, unread: false, flagged: false, attachment: 'Certificate.pdf' },
      ],
      calendars: [
        { id: 'cal-work', name: 'Calendar', color: '#0f6cbd', on: true },
        { id: 'cal-team', name: 'Tier 2 Support', color: '#8764b8', on: true },
        { id: 'cal-hol', name: 'Holidays', color: '#107c41', on: false },
      ],
      events: [
        { id: 'ev-1', title: 'Tier 2 stand-up', day: 1, start: 9.25, minutes: 15, cal: 'cal-work', where: 'Bench room', busy: 'Busy' },
        { id: 'ev-2', title: 'Bench triage', day: 1, start: 11, minutes: 60, cal: 'cal-work', where: 'Bench 2', busy: 'Busy' },
        { id: 'ev-3', title: '1:1 with Dana', day: 2, start: 10, minutes: 30, cal: 'cal-work', where: 'Teams', busy: 'Busy' },
        { id: 'ev-4', title: 'Escalation review', day: 3, start: 14, minutes: 45, cal: 'cal-team', where: 'Room 4', busy: 'Busy' },
        { id: 'ev-5', title: 'Runbook workshop', day: 3, start: 15.5, minutes: 90, cal: 'cal-team', where: 'Room 4', busy: 'Tentative' },
        { id: 'ev-6', title: 'Change window', day: 4, start: 22, minutes: 90, cal: 'cal-work', where: 'Remote', busy: 'Busy' },
        { id: 'ev-7', title: 'Vendor call — Bench Tools', day: 5, start: 13, minutes: 30, cal: 'cal-work', where: 'Teams', busy: 'Free' },
      ],
    },

    /* -------------------------------------------------- calendar / messages */
    calendar: {
      calendars: [
        { id: 'cal-home', name: 'Home', color: '#0f9d58', on: true },
        { id: 'cal-work', name: 'Support Desk', color: '#2f7cf6', on: true },
        { id: 'cal-family', name: 'Family', color: '#ef8b2c', on: true },
      ],
      events: [
        { id: 'c1', calendar: 'cal-work', title: 'Stand-up', offset: 0, time: '09:15' },
        { id: 'c2', calendar: 'cal-work', title: 'Bench triage', offset: 0, time: '11:00' },
        { id: 'c3', calendar: 'cal-home', title: 'Grocery run', offset: 1, time: '18:30' },
        { id: 'c4', calendar: 'cal-family', title: "Milo's recital", offset: 3, time: '17:00' },
        { id: 'c5', calendar: 'cal-work', title: 'Change window', offset: 4, time: '22:00' },
      ],
    },
    messages: {
      selected: 'thread-dana',
      threads: [
        {
          id: 'thread-dana', name: 'Dana Whitfield', lines: [
            { me: false, text: 'Did the bench Mac reproduce the portal loop?', at: now - 5400e3 },
            { me: true, text: 'Yes — abandoning the portal drops the association.', at: now - 5100e3 },
            { me: false, text: 'Perfect, add it to the runbook.', at: now - 4800e3 },
          ],
        },
        {
          id: 'thread-milo', name: 'Milo', lines: [
            { me: false, text: 'Can I get 30 more minutes?', at: now - 2 * 3600e3 },
            { me: true, text: 'After homework.', at: now - 1.9 * 3600e3 },
          ],
        },
        {
          id: 'thread-desk', name: 'Service Desk', lines: [
            { me: false, text: 'Change window Thursday 22:00.', at: now - 26 * 3600e3 },
          ],
        },
      ],
    },
    music: {
      playing: false,
      trackIndex: 0,
      tracks: [
        { title: 'Focus Loop', artist: 'Bench Sessions', album: 'Support Desk', time: '3:24' },
        { title: 'Quiet Diagnostics', artist: 'Bench Sessions', album: 'Support Desk', time: '4:02' },
        { title: 'Console Warmth', artist: 'Terminal Trio', album: 'Verbose', time: '2:58' },
        { title: 'Packet Drift', artist: 'Terminal Trio', album: 'Verbose', time: '5:11' },
      ],
    },

    /* ---------------------------------------------------------- diagnostics */
    processes: [
      { name: 'WindowServer', cpu: 11.8, memory: 612, threads: 24, kind: 'system', energy: 'High' },
      { name: 'kernel_task', cpu: 4.2, memory: 1240, threads: 182, kind: 'system', energy: 'Low' },
      { name: 'Safari', cpu: 7.4, memory: 928, threads: 31, kind: 'app', energy: 'High' },
      { name: 'Microsoft Outlook', cpu: 3.1, memory: 742, threads: 26, kind: 'app', energy: 'Medium' },
      { name: 'Mail', cpu: 1.6, memory: 318, threads: 14, kind: 'app', energy: 'Low' },
      { name: 'Finder', cpu: 0.9, memory: 216, threads: 11, kind: 'app', energy: 'Low' },
      { name: 'System Settings', cpu: 1.2, memory: 264, threads: 9, kind: 'app', energy: 'Low' },
      { name: 'mds_stores', cpu: 2.8, memory: 184, threads: 8, kind: 'system', energy: 'Medium' },
      { name: 'bluetoothd', cpu: 0.3, memory: 46, threads: 6, kind: 'system', energy: 'Low' },
      { name: 'airportd', cpu: 0.6, memory: 58, threads: 7, kind: 'system', energy: 'Low' },
      { name: 'Terminal', cpu: 0.2, memory: 74, threads: 5, kind: 'app', energy: 'Low' },
      { name: 'Activity Monitor', cpu: 1.4, memory: 118, threads: 7, kind: 'app', energy: 'Low' },
    ],
    logs: [
      { at: now - 30e3, level: 'info', process: 'airportd', message: 'Wi-Fi association complete: Sablewave Home (channel 44, -52 dBm)' },
      { at: now - 90e3, level: 'debug', process: 'configd', message: 'DHCP lease acquired 192.168.1.42 / 255.255.255.0' },
      { at: now - 240e3, level: 'warn', process: 'mDNSResponder', message: 'Slow response from 8.8.8.8 (642 ms)' },
      { at: now - 620e3, level: 'error', process: 'PrinterProxy', message: 'No printers discovered on subnet 192.168.1.0/24' },
      { at: now - 900e3, level: 'info', process: 'powerd', message: 'Display sleep timer set to 10 minutes (battery)' },
      { at: now - 1500e3, level: 'fault', process: 'com.apple.diskarbitrationd', message: 'Volume "Time Machine Backup" not mounted at boot' },
      { at: now - 2400e3, level: 'info', process: 'softwareupdated', message: 'Checked for updates: 2 available' },
      { at: now - 3600e3, level: 'debug', process: 'WindowServer', message: 'Display reconfiguration: 3024x1964 @ 120 Hz' },
    ],
    battery: {
      percent: 82,
      charging: false,
      cycles: 142,
      health: 'Normal',
      capacity: 96,
      temperature: '31 °C',
      timeRemaining: '5:48',
      history: [64, 71, 78, 84, 89, 92, 88, 85, 82],
    },

    /* --------------------------------------------------------- notifications */
    notifications: [
      { id: 'n-welcome', app: 'settings', title: 'Simulator ready', body: 'Every action here is simulated and safe. Nothing touches your real Mac.', at: now - 60e3 },
      { id: 'n-update', app: 'appstore', title: '2 updates available', body: 'Safari 27.0.1.1 and Microsoft Outlook 16.92 are ready to install.', at: now - 900e3 },
      { id: 'n-backup', app: 'time-machine', title: 'Backup skipped', body: 'The backup disk was not available. Connect it to resume backups.', at: now - 5400e3 },
    ],

    /* --------------------------------------------------- windows / desktop */
    spaces: [{ id: 'space-1', name: 'Desktop 1' }],
    desktopItems: [],
    stats: { logins: 0, resets: 0, lastBoot: now },
  };

  /* Wi-Fi networks in range. Not persisted — the airwaves are the same for
     every session, only what you save about them is stored. */
  Mac.NETWORKS = [
    { name: 'Sablewave Home', security: 'WPA3 Personal', password: 'sablewave', bars: 4, band: '5 GHz', channel: 44 },
    { name: 'Support Bench 5G', security: 'WPA2 Personal', password: 'benchpass', bars: 3, band: '5 GHz', channel: 149 },
    { name: 'Neighbor 5G', security: 'WPA2 Personal', password: 'neighbor', bars: 2, band: '5 GHz', channel: 36 },
    { name: 'Orlando Guest', security: 'Open', password: '', bars: 3, band: '2.4 GHz', channel: 6 },
    { name: 'Cafe Welcome', security: 'Open', password: '', bars: 3, band: '2.4 GHz', channel: 11, captive: true },
    { name: 'Printer Setup', security: 'WPA2 Personal', password: 'printer', bars: 1, band: '2.4 GHz', channel: 1, unavailable: true },
  ];

  Mac.ACCENTS = {
    blue: ['#0a7cff', '10,124,255'],
    purple: ['#8a4fdd', '138,79,221'],
    pink: ['#e8459b', '232,69,155'],
    red: ['#e0453a', '224,69,58'],
    orange: ['#f07c1e', '240,124,30'],
    yellow: ['#e8a800', '232,168,0'],
    green: ['#28a745', '40,167,69'],
    graphite: ['#6f747c', '111,116,124'],
  };

  Mac.WALLPAPERS = [
    { id: 'golden-gate', name: 'Golden Gate', kind: 'Light' },
    { id: 'tahoe-light', name: 'Tahoe', kind: 'Dynamic' },
    { id: 'tahoe-dark', name: 'Tahoe Dark', kind: 'Dark' },
    { id: 'sequoia-sunrise', name: 'Sunrise', kind: 'Light' },
    { id: 'alpine', name: 'Alpine', kind: 'Light' },
    { id: 'midnight', name: 'Midnight', kind: 'Dark' },
    { id: 'graphite', name: 'Graphite', kind: 'Light' },
  ];

  /* Presentation order for Launchpad and the Applications folder. Anything not
     listed follows in registration order. */
  Mac.LAUNCH_ORDER = ['finder', 'launchpad', 'safari', 'mail', 'outlook', 'messages', 'calendar',
    'notes', 'reminders', 'contacts', 'freeform', 'appstore', 'settings', 'photos', 'music',
    'podcasts', 'maps', 'facetime', 'weather', 'terminal', 'activity-monitor', 'disk-utility',
    'console', 'textedit', 'preview', 'calculator', 'screenshot', 'time-machine', 'keychain',
    'system-info', 'migration'];

  Mac.LOGIN_PASSWORD = 'support';
}(window.Mac));
