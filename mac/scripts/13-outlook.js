/* ===========================================================================
   Microsoft Outlook for Mac.

   A second mail client, so support flows that differ between Apple Mail and
   Outlook can be practised side by side. The shape follows the real app rather
   than Mail's:

     - a vertical module rail on the left (Mail, Calendar, People, To Do), not
       a row of tabs
     - a tabbed ribbon (Home / Organise / Tools) with labelled groups
     - Favorites above the account's own folder tree
     - a status bar along the bottom reporting the Exchange connection, item
       counts and mailbox quota — the first place a real user is told to look
     - Settings as a sheet with its own left nav, including Automatic Replies
       and Rules

   Everything is simulated. The account is described as Exchange because that is
   what the support-desk flows assume.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, UI } = Mac;

  /* Favorites first, then the account's tree — the order the real folder pane
     uses. `fav` marks the ones Outlook pins by default. */
  const FOLDERS = [
    { id: 'Inbox', glyph: 'inbox', fav: true },
    { id: 'Drafts', glyph: 'compose', fav: true },
    { id: 'Sent Items', glyph: 'send', fav: true },
    { id: 'Deleted Items', glyph: 'trash', fav: true },
    { id: 'Junk Email', glyph: 'junk' },
    { id: 'Archive', glyph: 'archive' },
    { id: 'Outbox', glyph: 'upload' },
    { id: 'Conversation History', glyph: 'history' },
    { id: 'Notes', glyph: 'document' },
  ];

  /* Outlook's category palette, by name. */
  const CATEGORY_COLOURS = {
    Blue: '#0f6cbd', Green: '#107c41', Orange: '#d83b01',
    Purple: '#8764b8', Red: '#c50f1f', Yellow: '#eaa300',
  };

  const MODULES = [
    { id: 'mail', label: 'Mail', glyph: 'inbox' },
    { id: 'calendar', label: 'Calendar', glyph: 'calendar' },
    { id: 'people', label: 'People', glyph: 'people' },
    { id: 'todo', label: 'To Do', glyph: 'check' },
  ];

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Fractional hour (14.5) to a clock string. */
  const hourLabel = value => {
    const hours = Math.floor(value);
    const minutes = Math.round((value - hours) * 60);
    const suffix = hours < 12 ? 'AM' : 'PM';
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
  };

  const Outlook = Mac.Outlook = {
    data() { return Mac.state.outlook; },

    /* Delegated for the same reason as Mail's — see Mac.Network.offlineReason. */
    online() { return Mac.Network.online(); },

    /* --------------------------------------------------------------- model */

    inFolder(folder) {
      return this.data().messages.filter(message => message.folder === folder);
    },

    visible() {
      const data = this.data();
      let messages = this.inFolder(data.folder);

      if (data.folder === 'Inbox' && data.settings.focusedInbox) {
        messages = messages.filter(message => (data.focused === 'focused' ? message.focused : !message.focused));
      }
      if (data.filter === 'Unread') messages = messages.filter(message => message.unread);
      if (data.filter === 'Flagged') messages = messages.filter(message => message.flagged);
      if (data.filter === 'Has attachment') messages = messages.filter(message => message.attachment);

      const query = data.search.trim().toLowerCase();
      if (query) {
        /* The scope only widens the search — Outlook keeps the folder list in
           place and shows results in it. */
        const pool = data.searchScope === 'Current Folder' ? messages
          : data.messages.filter(message => (data.searchScope === 'All Mailboxes' ? true : message.folder !== 'Deleted Items'));
        messages = pool.filter(message => [message.subject, message.from, message.body, message.to]
          .some(field => String(field || '').toLowerCase().includes(query)));
      }
      return messages.sort((a, b) => b.date - a.date);
    },

    selected() {
      const data = this.data();
      return data.messages.find(message => message.id === data.selected) || null;
    },

    count(folder) {
      /* Drafts and Sent show a total, everything else shows unread — the same
         split the real folder pane makes. */
      if (folder === 'Drafts' || folder === 'Outbox') return this.inFolder(folder).length;
      return this.inFolder(folder).filter(message => message.unread).length;
    },

    /** Sender for Inbox-like folders, recipient for Sent and Drafts. */
    party(message) {
      const outgoing = ['Sent Items', 'Drafts', 'Outbox'].includes(message.folder);
      if (!outgoing) return message.from;
      return message.to ? `To: ${message.to}` : 'To: (no recipient)';
    },

    /* ------------------------------------------------------------ rendering */

    render() {
      const data = this.data();
      return `<div class="outlook">
        <div class="outlook-main">
          ${this.rail()}
          <div class="outlook-workspace">
            ${data.module === 'mail' ? this.ribbon() : ''}
            ${data.module === 'mail' ? this.mailView() : ''}
            ${data.module === 'calendar' ? this.calendarView() : ''}
            ${data.module === 'people' ? this.peopleView() : ''}
            ${data.module === 'todo' ? this.todoView() : ''}
          </div>
        </div>
        ${this.statusBar()}
      </div>`;
    },

    /** The vertical module switcher down the left edge. */
    rail() {
      const data = this.data();
      const unread = this.count('Inbox');
      return `<nav class="outlook-rail" aria-label="Outlook modules">
        ${MODULES.map(module => `<button class="ol-rail-btn ${data.module === module.id ? 'on' : ''}"
          data-outlook-module="${module.id}" aria-label="${esc(module.label)}" aria-current="${data.module === module.id}"
          title="${esc(module.label)}">
          ${glyph(module.glyph, { size: 19 })}
          ${module.id === 'mail' && unread ? `<span class="ol-rail-badge">${unread}</span>` : ''}
          <span>${esc(module.label)}</span></button>`).join('')}
        <span class="spacer"></span>
        <button class="ol-rail-btn" data-command="outlook-settings" aria-label="Outlook Settings" title="Settings">
          ${glyph('gear', { size: 19 })}<span>Settings</span></button>
      </nav>`;
    },

    /* Tabbed ribbon with labelled groups. Outlook's ribbon is the single most
       recognisable thing about it, and a flat strip of buttons was the least
       accurate part of the first version. */
    ribbon() {
      const data = this.data();
      const tabs = ['Home', 'Organise', 'Tools'];
      const message = this.selected();
      const dim = message ? '' : ' dim';

      const button = (icon, label, arg, { primary = false, large = false, on = false, needsMessage = true } = {}) =>
        `<button class="ol-rib-btn ${primary ? 'primary' : ''} ${large ? 'large' : ''} ${on ? 'on' : ''}${needsMessage ? dim : ''}"
          data-command="outlook-action" data-arg="${esc(arg)}" title="${esc(label)}">
          ${glyph(icon, { size: large ? 20 : 16 })}<span>${esc(label)}</span></button>`;

      const group = (name, ...buttons) =>
        `<div class="ol-rib-group"><div class="ol-rib-row">${buttons.join('')}</div>
          <div class="ol-rib-label">${esc(name)}</div></div>`;

      const groups = {
        Home: [
          group('New', button('compose', 'New Mail', 'compose', { primary: true, large: true, needsMessage: false })),
          group('Delete',
            button('trash', 'Delete', 'delete'),
            button('archive', 'Archive', 'archive'),
            button('junk', 'Junk', 'junk')),
          group('Respond',
            button('reply', 'Reply', 'reply'),
            button('reply-all', 'Reply All', 'reply-all'),
            button('forward-mail', 'Forward', 'forward')),
          group('Move',
            button('folder', 'Move', 'move'),
            button('bolt', 'Quick Steps', 'quick-step')),
          group('Tags',
            button('flag', 'Flag', 'flag', { on: Boolean(message && message.flagged) }),
            button('tag', 'Categorise', 'categorise'),
            button('inbox', message && !message.unread ? 'Unread' : 'Read', 'toggle-read')),
          group('Find',
            button('search', 'Search', 'find', { needsMessage: false }),
            button('filter', 'Filter', 'filter-menu', { needsMessage: false })),
        ],
        Organise: [
          group('Inbox',
            button('sort', 'Sort', 'sort', { needsMessage: false }),
            button('grid', 'Conversations', 'toggle-conversation', { on: data.settings.conversationView, needsMessage: false })),
          group('Reading Pane',
            button('columns', 'Right', 'pane-right', { on: data.settings.readingPane === 'Right', needsMessage: false }),
            button('list', 'Bottom', 'pane-bottom', { on: data.settings.readingPane === 'Bottom', needsMessage: false }),
            button('close', 'Off', 'pane-off', { on: data.settings.readingPane === 'Off', needsMessage: false })),
          group('Folder',
            button('archive', 'Empty Folder', 'empty-folder', { needsMessage: false }),
            button('check', 'Mark All Read', 'mark-all-read', { needsMessage: false })),
        ],
        Tools: [
          group('Send/Receive', button('refresh', 'Send/Receive', 'sync', { large: true, primary: true, needsMessage: false })),
          group('Out of Office',
            button('clock', 'Automatic Replies', 'auto-reply', { large: true, on: data.autoReply.on, needsMessage: false })),
          group('Rules', button('list', 'Rules', 'rules', { large: true, needsMessage: false })),
          group('Account',
            button('gear', 'Account Settings', 'account-settings', { needsMessage: false }),
            button('shield', 'Test Connection', 'test', { needsMessage: false }),
            button('disk', 'Repair Mailbox', 'repair', { needsMessage: false })),
          group('Offline',
            button('wifi', Mac.state.wifi.enabled ? 'Work Offline' : 'Work Online', 'work-offline', { needsMessage: false })),
        ],
      };

      return `<div class="outlook-ribbon-shell">
        <div class="ol-rib-tabs" role="tablist">
          ${tabs.map(tab => `<button class="ol-rib-tab ${data.ribbonTab === tab ? 'on' : ''}" role="tab"
            aria-selected="${data.ribbonTab === tab}" data-outlook-ribbon="${tab}">${tab}</button>`).join('')}
          <span class="spacer"></span>
          <button class="ol-rib-tab ghost" data-command="outlook-action" data-arg="toggle-ribbon"
            title="${data.settings.simplifiedRibbon ? 'Show the classic ribbon' : 'Simplify the ribbon'}">
            ${glyph('chevron', { size: 13 })}</button>
        </div>
        <div class="outlook-ribbon ${data.settings.simplifiedRibbon ? 'simple' : ''}">${groups[data.ribbonTab].join('')}</div>
      </div>`;
    },

    /* --------------------------------------------------------------- mail */

    mailView() {
      const data = this.data();
      const messages = this.visible();
      const selected = this.selected();
      const pane = data.settings.readingPane;

      return `<div class="outlook-body ${pane === 'Bottom' ? 'pane-bottom' : ''} ${pane === 'Off' ? 'pane-off' : ''}">
        ${this.folderPane()}
        <div class="mail-list-pane">
          ${this.listHead(messages)}
          <div class="mail-messages">${messages.length ? this.grouped(messages)
            : UI.empty(data.search.trim() ? 'No results' : 'Nothing here',
              data.search.trim() ? `Nothing in ${esc(data.searchScope.toLowerCase())} matches “${esc(data.search.trim())}”.`
                : 'This folder has no items.', { icon: 'inbox' })}</div>
        </div>
        ${pane === 'Off' ? '' : `<div class="mail-reading">${selected ? this.reader(selected)
          : UI.empty('Select an item to read', 'Nothing is selected.', { icon: 'outlook' })}</div>`}
      </div>`;
    },

    folderPane() {
      const data = this.data();
      const collapsed = section => data.collapsed.includes(section);

      const item = (folder, section) => {
        const count = this.count(folder.id);
        const isCount = folder.id === 'Drafts' || folder.id === 'Outbox';
        const on = data.folder === folder.id && (data.folderSection || 'fav') === section;
        return `<button class="side-item ${on ? 'on' : ''}" data-outlook-folder="${esc(folder.id)}"
          data-outlook-section="${section}">
          <span class="side-glyph">${glyph(folder.glyph, { size: 15 })}</span>
          <span class="side-label">${esc(folder.id)}</span>
          ${count ? `<span class="side-count ${isCount ? 'quiet' : ''}">${count}</span>` : ''}</button>`;
      };

      const heading = (label, key) =>
        `<button class="ol-side-head" data-outlook-collapse="${key}" aria-expanded="${!collapsed(key)}">
          <span class="ol-twisty ${collapsed(key) ? '' : 'open'}">${glyph('chevron', { size: 11 })}</span>${esc(label)}</button>`;

      return `<aside class="sidebar outlook-folders">
        <div class="outlook-account-chip">${UI.avatar(data.account.name, { size: 'small', initials: data.account.initials })}
          <div><strong>${esc(data.account.name)}</strong><small>${esc(data.account.address)}</small></div></div>

        ${heading('Favorites', 'fav')}
        ${collapsed('fav') ? '' : FOLDERS.filter(folder => folder.fav).map(folder => item(folder, 'fav')).join('')}

        ${heading(data.account.address, 'account')}
        ${collapsed('account') ? '' : FOLDERS.map(folder => item(folder, 'account')).join('')}

        ${heading('Groups', 'groups')}
        ${collapsed('groups') ? '' : `<button class="side-item" data-command="outlook-action" data-arg="group">
          <span class="side-glyph">${glyph('people', { size: 15 })}</span><span class="side-label">Tier 2 Support</span></button>`}
      </aside>`;
    },

    listHead(messages) {
      const data = this.data();
      const other = data.settings.focusedInbox
        ? this.inFolder('Inbox').filter(message => !message.focused && message.unread).length
        : 0;

      return `<div class="mail-list-head">
        <div class="mail-list-title"><h2>${esc(data.search.trim() ? 'Search Results' : data.folder)}</h2>
          <span>${Mac.plural(messages.length, 'item')}</span></div>
        <div class="search"><span>${glyph('search')}</span>
          <input data-outlook-search value="${esc(data.search)}" placeholder="Search" aria-label="Search Outlook">
          <select class="ol-scope" data-select-path="outlook.searchScope" aria-label="Search scope">
            ${['Current Folder', 'Current Mailbox', 'All Mailboxes'].map(scope =>
              `<option ${scope === data.searchScope ? 'selected' : ''}>${scope}</option>`).join('')}
          </select></div>
        <div class="ol-list-tabs">
          ${data.folder === 'Inbox' && data.settings.focusedInbox ? `
            <button class="ol-pivot ${data.focused === 'focused' ? 'on' : ''}" data-outlook-focus="focused">Focused</button>
            <button class="ol-pivot ${data.focused === 'other' ? 'on' : ''}" data-outlook-focus="other">Other
              ${other ? `<i>${other}</i>` : ''}</button>` : '<span></span>'}
          <span class="spacer"></span>
          <button class="ol-filter" data-command="outlook-action" data-arg="filter-menu">
            ${glyph('filter', { size: 12 })}<span>${esc(data.filter === 'All' ? 'Filter' : data.filter)}</span></button>
        </div>
      </div>`;
    },

    /** Outlook groups the list under relative-date headers. */
    grouped(messages) {
      const midnight = new Date().setHours(0, 0, 0, 0);
      const bucketOf = date => {
        const days = Math.floor((midnight - new Date(date).setHours(0, 0, 0, 0)) / 864e5);
        if (days <= 0) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 7) return 'This Week';
        if (days < 31) return 'This Month';
        return 'Older';
      };

      let current = null;
      return messages.map(message => {
        const bucket = bucketOf(message.date);
        const header = bucket === current ? '' : `<div class="ol-date-head">${bucket}</div>`;
        current = bucket;
        return header + this.row(message);
      }).join('');
    },

    row(message) {
      const data = this.data();
      const date = new Date(message.date);
      const today = date.toDateString() === new Date().toDateString();
      const stamp = today
        ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const color = CATEGORY_COLOURS[message.category];

      return `<button class="mail-row ol-row ${message.unread ? 'unread' : 'read'} ${data.selected === message.id ? 'on' : ''}"
        data-outlook-message="${message.id}">
        <span class="ol-unread-bar" aria-hidden="true"></span>
        <span class="mail-face" style="background:${Mac.tint(message.from)}">${esc(Mac.initials(message.from))}</span>
        <span class="mail-row-copy">
          <span class="mail-row-top"><strong>${esc(this.party(message))}</strong><time>${esc(stamp)}</time></span>
          <span class="mail-subject">${esc(message.subject)}</span>
          <span class="mail-row-bottom">
            <span class="mail-preview">${esc(message.preview)}</span>
            ${message.attachment ? `<span class="ol-clip" aria-label="Has an attachment">${glyph('tag', { size: 12 })}</span>` : ''}
            ${color ? `<span class="ol-cat" style="background:${color}" title="${esc(message.category)} category"></span>` : ''}
            ${message.flagged ? `<span class="mail-flag">${glyph('flag', { size: 11 })}</span>` : ''}
          </span></span></button>`;
    },

    reader(message) {
      const data = this.data();
      const external = data.settings.externalWarning && !String(message.email || '').endsWith('@support.example');
      const recipients = message.to || data.account.address;
      const color = CATEGORY_COLOURS[message.category];

      return `<div class="ol-reader">
        <div class="ol-reader-head">
          <h1>${esc(message.subject)}</h1>
          <div class="ol-reader-actions">
            <button class="tool-btn" data-command="outlook-action" data-arg="reply" aria-label="Reply">${glyph('reply')}</button>
            <button class="tool-btn" data-command="outlook-action" data-arg="reply-all" aria-label="Reply All">${glyph('reply-all')}</button>
            <button class="tool-btn" data-command="outlook-action" data-arg="forward" aria-label="Forward">${glyph('forward-mail')}</button>
            <button class="tool-btn ${message.flagged ? 'on' : ''}" data-command="outlook-action" data-arg="flag" aria-label="Flag">${glyph('flag')}</button>
            <button class="tool-btn" data-command="outlook-action" data-arg="archive" aria-label="Archive">${glyph('archive')}</button>
            <button class="tool-btn" data-command="outlook-action" data-arg="delete" aria-label="Delete">${glyph('trash')}</button>
            <button class="tool-btn" data-command="outlook-action" data-arg="more-actions" aria-label="More">${glyph('ellipsis')}</button>
          </div>
        </div>

        <div class="ol-reader-from">
          <span class="mail-face big" style="background:${Mac.tint(message.from)}">${esc(Mac.initials(message.from))}</span>
          <div class="ol-from-copy">
            <div class="ol-from-line"><strong>${esc(message.from)}</strong>
              <span class="ol-addr">&lt;${esc(message.email)}&gt;</span>
              <time>${new Date(message.date).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</time></div>
            <div class="ol-to-line">To: ${esc(recipients)}${message.cc ? ` &nbsp;Cc: ${esc(message.cc)}` : ''}</div>
          </div>
          ${color ? `<span class="ol-cat-chip" style="--cat:${color}">${esc(message.category)}</span>` : ''}
        </div>

        ${external ? `<div class="ol-banner caution">${glyph('warning', { size: 14 })}
          <span><strong>External sender.</strong> This message came from outside the organisation. Take care with
          links and attachments.</span></div>` : ''}
        ${!this.online() ? `<div class="ol-banner offline">${glyph('wifi', { size: 14 })}
          <span>Outlook is working offline. This is the cached copy from the last sync.</span></div>` : ''}

        <div class="mail-content"><div class="mail-body">${esc(message.body)}</div>
          ${message.attachment ? `<div class="mail-attachment">${Mac.appIcon('document-pdf')}
            <div class="row-text"><strong>${esc(message.attachment)}</strong><p>1 attachment</p></div>
            <button class="btn" data-command="outlook-action" data-arg="save-attachment">Download</button></div>` : ''}
        </div>
      </div>`;
    },

    /* ----------------------------------------------------------- calendar */

    weekStart() {
      const data = this.data();
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - start.getDay() + data.calOffset * 7);
      return start;
    },

    calendarView() {
      const data = this.data();
      const views = ['Day', 'Week', 'Month'];
      const start = this.weekStart();
      const label = data.calView === 'Month'
        ? start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${
          new Date(start.getTime() + 6 * 864e5).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;

      return `<div class="ol-cal">
        <div class="ol-cal-bar">
          <button class="btn primary" data-command="outlook-action" data-arg="new-event">${glyph('plus', { size: 13 })} New Event</button>
          <span class="ribbon-sep"></span>
          <button class="btn" data-command="outlook-cal-move" data-arg="today">Today</button>
          <button class="tool-btn" data-command="outlook-cal-move" data-arg="-1" aria-label="Previous">${glyph('prev')}</button>
          <button class="tool-btn" data-command="outlook-cal-move" data-arg="1" aria-label="Next">${glyph('next')}</button>
          <strong class="ol-cal-label">${esc(label)}</strong>
          <span class="spacer"></span>
          <div class="segmented">${views.map(view =>
            `<button class="${data.calView === view ? 'on' : ''}" data-outlook-calview="${view}">${view}</button>`).join('')}</div>
        </div>
        <div class="ol-cal-body">
          ${this.miniMonth()}
          ${data.calView === 'Month' ? this.monthGrid() : this.timeGrid(data.calView === 'Day')}
        </div>
      </div>`;
    },

    /** The little month calendar and the My Calendars checkboxes. */
    miniMonth() {
      const data = this.data();
      const anchor = this.weekStart();
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const lead = first.getDay();
      const days = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
      const today = new Date();

      const cells = [];
      for (let index = 0; index < lead; index += 1) cells.push('<i></i>');
      for (let day = 1; day <= days; day += 1) {
        const date = new Date(anchor.getFullYear(), anchor.getMonth(), day);
        const isToday = date.toDateString() === today.toDateString();
        const inWeek = date >= anchor && date < new Date(anchor.getTime() + 7 * 864e5);
        cells.push(`<i class="${isToday ? 'today' : ''} ${inWeek ? 'inweek' : ''}">${day}</i>`);
      }

      return `<aside class="sidebar ol-cal-side">
        <div class="ol-mini">
          <div class="ol-mini-head">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
          <div class="ol-mini-grid">
            ${DAY_NAMES.map(name => `<b>${name[0]}</b>`).join('')}
            ${cells.join('')}
          </div>
        </div>
        <div class="sidebar-heading">My Calendars</div>
        ${data.calendars.map(calendar => `<button class="ol-cal-check" data-outlook-calendar="${calendar.id}">
          <span class="checkbox ${calendar.on ? 'on' : ''}" style="--cat:${calendar.color}" aria-hidden="true">✓</span>
          <span>${esc(calendar.name)}</span></button>`).join('')}
      </aside>`;
    },

    activeEvents() {
      const data = this.data();
      const on = data.calendars.filter(calendar => calendar.on).map(calendar => calendar.id);
      return data.events.filter(event => on.includes(event.cal));
    },

    /** Week or day view: an hour gutter with events placed by start time. */
    timeGrid(dayOnly) {
      const data = this.data();
      const start = this.weekStart();
      const today = new Date();
      const first = 7;                     // labelled rows run 07:00 to 23:00
      const last = 23;
      const rowHeight = 34;
      /* One spare row past the last label, so a 22:00 event that runs 90
         minutes still finishes inside the grid instead of being clipped. */
      const rows = last - first + 2;
      const columns = dayOnly ? [today.getDay()] : [0, 1, 2, 3, 4, 5, 6];
      const events = this.activeEvents();
      const colorOf = id => (data.calendars.find(calendar => calendar.id === id) || {}).color || '#0f6cbd';

      const column = index => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        const isToday = date.toDateString() === today.toDateString();
        const placed = events.filter(event => event.day === index).map(event => {
          const top = (Math.max(first, event.start) - first) * rowHeight;
          const height = Math.max(17, (event.minutes / 60) * rowHeight);
          const color = colorOf(event.cal);
          /* A short block has no room for a second line, so the time and place
             fold into the title rather than being clipped mid-word. */
          const short = height < 32;
          const detail = `${hourLabel(event.start)}${event.where ? ` · ${event.where}` : ''}`;
          return `<button class="ol-ev ${short ? 'short' : ''} ${event.busy === 'Tentative' ? 'tentative' : ''} ${event.busy === 'Free' ? 'free' : ''}"
            style="top:${top}px;height:${height}px;--cat:${color}"
            data-command="outlook-event" data-arg="${esc(event.id)}" title="${esc(event.title)} — ${esc(detail)}">
            <b>${esc(event.title)}${short ? ` <em>${esc(hourLabel(event.start))}</em>` : ''}</b>
            ${short ? '' : `<i>${esc(detail)}</i>`}</button>`;
        }).join('');
        return `<div class="ol-col ${isToday ? 'today' : ''}">
          <div class="ol-col-head"><span>${DAY_NAMES[date.getDay()]}</span><strong>${date.getDate()}</strong></div>
          <div class="ol-col-body" style="height:${rows * rowHeight}px">
            ${Array.from({ length: rows }, () => `<div class="ol-hour" style="height:${rowHeight}px"></div>`).join('')}
            ${placed}
          </div></div>`;
      };

      return `<div class="ol-grid-wrap"><div class="ol-grid">
        <div class="ol-gutter">
          <div class="ol-col-head"></div>
          ${Array.from({ length: last - first + 1 }, (_, index) =>
            `<div class="ol-gutter-hour" style="height:${rowHeight}px">${hourLabel(first + index).replace(':00', '')}</div>`).join('')}
        </div>
        ${columns.map(column).join('')}
      </div></div>`;
    },

    monthGrid() {
      const data = this.data();
      const anchor = this.weekStart();
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const gridStart = new Date(first);
      gridStart.setDate(first.getDate() - first.getDay());
      const today = new Date();
      const events = this.activeEvents();
      const colorOf = id => (data.calendars.find(calendar => calendar.id === id) || {}).color || '#0f6cbd';

      return `<div class="ol-grid-wrap"><div class="outlook-cal-grid">
        ${DAY_NAMES.map(name => `<div class="outlook-cal-head">${name}</div>`).join('')}
        ${Array.from({ length: 35 }, (_, index) => {
          const date = new Date(gridStart);
          date.setDate(gridStart.getDate() + index);
          const isToday = date.toDateString() === today.toDateString();
          const outside = date.getMonth() !== first.getMonth();
          /* The seeded week repeats each month, which is enough to read the
             layout without pretending to a real recurring-event engine. */
          const dayEvents = events.filter(event => event.day === date.getDay());
          return `<div class="outlook-cal-cell ${isToday ? 'today' : ''} ${outside ? 'dim' : ''}">
            <strong>${date.getDate()}</strong>
            ${dayEvents.slice(0, 2).map(event =>
              `<div class="outlook-event" style="--cat:${colorOf(event.cal)}" title="${esc(event.title)}">${esc(event.title)}</div>`).join('')}
            ${dayEvents.length > 2 ? `<div class="ol-more">+${dayEvents.length - 2} more</div>` : ''}</div>`;
        }).join('')}
      </div></div>`;
    },

    /* ------------------------------------------------------------- people */

    peopleView() {
      const data = this.data();
      const query = data.search.trim().toLowerCase();
      const contacts = data.contacts
        .filter(contact => !query || `${contact.name} ${contact.email} ${contact.role}`.toLowerCase().includes(query))
        .sort((a, b) => a.name.localeCompare(b.name));
      const selected = contacts.find(contact => contact.email === data.selectedContact) || contacts[0] || null;

      let letter = null;
      const rows = contacts.map(contact => {
        const initial = contact.name[0].toUpperCase();
        const head = initial === letter ? '' : `<div class="ol-date-head">${initial}</div>`;
        letter = initial;
        return `${head}<button class="side-item wide ${selected && selected.email === contact.email ? 'on' : ''}"
          data-outlook-contact="${esc(contact.email)}">
          ${UI.avatar(contact.name, { size: 'small' })}
          <span class="side-label"><strong>${esc(contact.name)}</strong><small>${esc(contact.role)}</small></span></button>`;
      }).join('');

      return `<div class="ol-people">
        <div class="ol-people-list">
          <div class="mail-list-head">
            <div class="mail-list-title"><h2>People</h2><span>${Mac.plural(contacts.length, 'contact')}</span></div>
            <div class="search"><span>${glyph('search')}</span>
              <input data-outlook-search value="${esc(data.search)}" placeholder="Search People" aria-label="Search People"></div>
          </div>
          <div class="mail-messages">${rows || UI.empty('No contacts', 'Nothing matches that search.', { icon: 'people' })}</div>
        </div>
        <div class="ol-people-card">${selected ? `
          <div class="ol-card-head">
            ${UI.avatar(selected.name, { size: 'large' })}
            <h1>${esc(selected.name)}</h1>
            <p>${esc(selected.role)} — ${esc(data.account.org)}</p>
            <div class="ol-card-actions">
              <button class="btn primary" data-command="outlook-action" data-arg="mail-to:${esc(selected.email)}">${glyph('compose', { size: 13 })} Mail</button>
              <button class="btn" data-command="outlook-action" data-arg="schedule:${esc(selected.email)}">${glyph('calendar', { size: 13 })} Schedule</button>
            </div>
          </div>
          ${UI.group(
            UI.info('Email', selected.email),
            UI.info('Work phone', selected.phone),
            UI.info('Office', selected.office),
            UI.info('Directory', 'Exchange address list'),
          )}` : UI.empty('No contact selected', '', { icon: 'people' })}</div>
      </div>`;
    },

    /* -------------------------------------------------------------- to do */

    todoView() {
      const data = this.data();
      const open = data.tasks.filter(task => !task.done);
      const done = data.tasks.filter(task => task.done);

      const row = task => `<button class="ol-task ${task.done ? 'done' : ''}" data-outlook-task="${esc(task.id)}">
        <span class="checkbox ${task.done ? 'on' : ''}" aria-hidden="true">✓</span>
        <span class="row-text"><strong>${esc(task.title)}</strong><p>Due ${esc(task.due)}</p></span>
        ${task.flagged ? `<span class="mail-flag">${glyph('flag', { size: 12 })}</span>` : ''}</button>`;

      return `<div class="pane-scroll"><div class="pane-pad">
        ${UI.header('To Do', 'Flagged mail and tasks land here, the same list Microsoft To Do shows.',
          '<button class="btn primary" data-command="outlook-action" data-arg="new-task">New Task</button>')}
        <div class="section-title">My Day — ${Mac.plural(open.length, 'task')} remaining</div>
        <div class="group">${open.length ? open.map(row).join('')
          : '<div class="row"><div class="row-text"><strong>All clear</strong><p>Nothing left on the list.</p></div></div>'}</div>
        ${done.length ? `<div class="section-title">Completed</div><div class="group">${done.map(row).join('')}</div>` : ''}
      </div></div>`;
    },

    /* ---------------------------------------------------------- status bar */

    /* The bottom status bar is where Outlook reports its connection, and it is
       the first thing a real user is asked to read out during a support call. */
    statusBar() {
      const data = this.data();
      const online = this.online();
      const unread = this.count('Inbox');
      const used = data.account.used / data.account.quota;
      /* The bar reports whatever module you are in, not always a mail count. */
      const items = data.module === 'calendar' ? Mac.plural(this.activeEvents().length, 'event')
        : data.module === 'people' ? Mac.plural(data.contacts.length, 'contact')
          : data.module === 'todo' ? Mac.plural(data.tasks.filter(task => !task.done).length, 'task')
            : Mac.plural(this.visible().length, 'item');

      return `<div class="ol-status">
        <span class="ol-status-conn ${online ? 'ok' : 'bad'}">
          <i></i>${online ? `Connected to: ${esc(data.account.type)}` : 'Working Offline'}</span>
        <span class="ribbon-sep"></span>
        <span>${items}</span>
        ${unread ? `<span>${unread} unread</span>` : ''}
        ${data.autoReply.on ? `<button class="ol-status-oof" data-command="outlook-action" data-arg="auto-reply">
          ${glyph('clock', { size: 11 })} Automatic Replies are on</button>` : ''}
        <span class="spacer"></span>
        <span title="Mailbox quota">${Mac.bytes(data.account.used)} of ${Mac.bytes(data.account.quota)} used</span>
        <span class="ol-quota"><i style="width:${(used * 100).toFixed(1)}%"></i></span>
      </div>`;
    },

    /* ------------------------------------------------------------- actions */

    action(name) {
      const data = this.data();
      const message = this.selected();

      if (name.startsWith('mail-to:')) { this.compose({ to: name.slice(8) }); return; }
      if (name.startsWith('schedule:')) {
        Mac.Dialog.info('Scheduling assistant', `Meeting information for ${esc(name.slice(9))} is unavailable.`, 'calendar');
        return;
      }

      switch (name) {
        case 'compose': this.compose(); return;
        case 'reply': case 'reply-all':
          if (!message) return this.requireSelection();
          this.compose({
            to: message.email,
            cc: name === 'reply-all' ? (message.cc || '') : '',
            subject: `RE: ${message.subject.replace(/^(RE|FW):\s*/i, '')}`,
            quote: message,
          });
          return;
        case 'forward':
          if (!message) return this.requireSelection();
          this.compose({ subject: `FW: ${message.subject.replace(/^(RE|FW):\s*/i, '')}`, quote: message });
          return;
        case 'delete':
          if (!message) return this.requireSelection();
          if (message.folder === 'Deleted Items') data.messages = data.messages.filter(candidate => candidate.id !== message.id);
          else message.folder = 'Deleted Items';
          data.selected = null;
          break;
        case 'archive':
          if (!message) return this.requireSelection();
          message.folder = 'Archive';
          data.selected = null;
          break;
        case 'junk':
          if (!message) return this.requireSelection();
          message.folder = 'Junk Email';
          data.selected = null;
          Mac.Notify.show('Outlook', `${message.email} was moved to Junk Email.`, { app: 'outlook', transient: true });
          break;
        case 'flag':
          if (!message) return this.requireSelection();
          message.flagged = !message.flagged;
          break;
        case 'toggle-read':
          if (!message) return this.requireSelection();
          message.unread = !message.unread;
          break;
        case 'categorise':
          if (!message) return this.requireSelection();
          this.categorise(message);
          return;
        case 'move':
          if (!message) return this.requireSelection();
          this.moveTo(message);
          return;
        case 'quick-step':
          if (!message) return this.requireSelection();
          message.folder = 'Archive';
          message.unread = false;
          data.selected = null;
          Mac.Notify.show('Outlook', 'Quick Step: marked read and archived.', { app: 'outlook', transient: true });
          break;
        case 'save-attachment':
          if (!message || !message.attachment) return this.requireSelection();
          Mac.Browser.download(message.attachment, 421000);
          break;
        case 'more-actions':
          if (!message) return this.requireSelection();
          this.moreActions(message);
          return;

        case 'sync': this.sync(); return;
        case 'find':
          Mac.Notify.show('Outlook', 'Use the search field above the message list.', { app: 'outlook', transient: true });
          return;
        case 'filter-menu': this.filterMenu(); return;
        case 'sort':
          Mac.Notify.show('Outlook', 'This list is sorted by date, newest first.', { app: 'outlook', transient: true });
          return;
        case 'toggle-conversation':
          data.settings.conversationView = !data.settings.conversationView;
          break;
        case 'toggle-ribbon':
          data.settings.simplifiedRibbon = !data.settings.simplifiedRibbon;
          break;
        case 'pane-right': data.settings.readingPane = 'Right'; break;
        case 'pane-bottom': data.settings.readingPane = 'Bottom'; break;
        case 'pane-off': data.settings.readingPane = 'Off'; break;
        case 'mark-all-read':
          this.inFolder(data.folder).forEach(candidate => { candidate.unread = false; });
          break;
        case 'empty-folder': this.emptyFolder(); return;
        case 'rules': this.rulesSheet(); return;
        case 'auto-reply': this.autoReplySheet(); return;
        case 'account-settings': this.settingsSheet('Accounts'); return;
        case 'work-offline': Mac.run('wifi-toggle'); return;

        case 'test':
          Mac.Dialog.info(this.online() ? 'Account settings are correct' : 'Cannot reach the server',
            this.online()
              ? `Log on to ${esc(data.account.server)}: completed.<br>Send test message: completed.<br>Autodiscover: completed.`
              : `Outlook cannot connect to ${esc(data.account.server)} because this Mac is offline.`,
            this.online() ? 'check' : 'warning');
          return;
        case 'repair':
          Mac.Notify.show('Outlook', 'Rebuilding the local cache… this profile will resync when online.', { app: 'outlook' });
          return;
        case 'new-event': this.newEvent(); return;
        case 'new-task': this.newTask(); return;
        case 'group':
          Mac.Dialog.info('Tier 2 Support', 'A Microsoft 365 group with 6 members, a shared mailbox and a shared calendar.', 'people');
          return;
        default: break;
      }

      Mac.save();
      Mac.wm.refresh('outlook');
      Mac.Shell.renderDock();
    },

    requireSelection() {
      Mac.Notify.show('Outlook', 'Select a message first.', { app: 'outlook', transient: true });
    },

    /* ------------------------------------------------------------- sheets */

    filterMenu() {
      const data = this.data();
      const options = ['All', 'Unread', 'Flagged', 'Has attachment'];
      Mac.Dialog.open({
        title: 'Filter',
        icon: 'filter',
        body: `<div class="group">${options.map(option =>
          `<button class="row tappable" data-command="outlook-set-filter" data-arg="${esc(option)}">
            <div class="row-text"><strong>${esc(option)}</strong></div>
            ${data.filter === option ? '<span class="badge info">Current</span>' : ''}</button>`).join('')}</div>`,
        buttons: [{ label: 'Cancel' }],
      });
    },

    setFilter(value) {
      this.data().filter = value;
      Mac.save();
      Mac.Dialog.close();
      Mac.wm.refresh('outlook');
    },

    categorise(message) {
      Mac.Dialog.open({
        title: 'Categorise',
        icon: 'tag',
        body: `<div class="group">${[...Object.keys(CATEGORY_COLOURS), 'None'].map(color =>
          `<button class="row tappable" data-command="outlook-set-category" data-arg="${color}">
            ${color === 'None' ? '' : `<span class="ol-cat" style="background:${CATEGORY_COLOURS[color]};margin-right:8px"></span>`}
            <div class="row-text"><strong>${color}</strong></div>
            ${message.category === color ? '<span class="badge info">Current</span>' : ''}</button>`).join('')}</div>`,
        buttons: [{ label: 'Cancel' }],
      });
    },

    setCategory(color) {
      const message = this.selected();
      if (!message) return;
      message.category = color === 'None' ? null : color;
      Mac.save();
      Mac.Dialog.close();
      Mac.wm.refresh('outlook');
    },

    moveTo(message) {
      Mac.Dialog.open({
        title: 'Move to Folder',
        icon: 'folder',
        body: `<div class="group">${FOLDERS.filter(folder => folder.id !== message.folder).map(folder =>
          `<button class="row tappable" data-command="outlook-move" data-arg="${esc(folder.id)}">
            <div class="row-text"><strong>${esc(folder.id)}</strong></div></button>`).join('')}</div>`,
        buttons: [{ label: 'Cancel' }],
      });
    },

    move(folder) {
      const message = this.selected();
      if (!message) return;
      message.folder = folder;
      this.data().selected = null;
      Mac.save();
      Mac.Dialog.close();
      Mac.wm.refresh('outlook');
      Mac.Notify.show('Outlook', `Moved to ${folder}.`, { app: 'outlook', transient: true });
    },

    moreActions(message) {
      Mac.Dialog.open({
        title: 'More Actions',
        icon: 'ellipsis',
        body: UI.group(
          UI.action(message.unread ? 'Mark as Read' : 'Mark as Unread', 'outlook-action', '', '', { arg: 'toggle-read', chevron: false }),
          UI.action('Move to Folder…', 'outlook-action', '', '', { arg: 'move', chevron: false }),
          UI.action('Categorise…', 'outlook-action', '', '', { arg: 'categorise', chevron: false }),
          UI.action('Print', 'outlook-print', '', '', { chevron: false }),
          UI.action('View Source', 'outlook-source', 'Show the message headers.', '', { chevron: false }),
        ),
        buttons: [{ label: 'Done' }],
      });
    },

    source() {
      const message = this.selected();
      if (!message) return;
      const headers = [
        `Return-Path: <${message.email}>`,
        `Received: from ${this.data().account.server} (127.0.0.1) by SIMULATOR`,
        `Date: ${new Date(message.date).toUTCString()}`,
        `From: ${message.from} <${message.email}>`,
        `To: ${message.to || this.data().account.address}`,
        `Subject: ${message.subject}`,
        'Content-Type: text/plain; charset="utf-8"',
        'X-MS-Exchange-Organization-AuthAs: Internal',
        'X-Simulated: true',
      ].join('\n');
      Mac.Dialog.open({
        title: 'Message Source',
        wide: true,
        body: `<pre class="ol-source">${esc(headers)}\n\n${esc(message.body)}</pre>`,
        buttons: [{ label: 'Done', primary: true }],
      });
    },

    emptyFolder() {
      const data = this.data();
      const folder = data.folder;
      const count = this.inFolder(folder).length;
      if (!count) { Mac.Notify.show('Outlook', `${folder} is already empty.`, { app: 'outlook', transient: true }); return; }
      Mac.Dialog.open({
        title: `Permanently delete everything in ${folder}?`,
        icon: 'warning',
        body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">${Mac.plural(count, 'item')} will be deleted. This cannot be undone.</p>`,
        buttons: [
          { label: 'Cancel' },
          { label: 'Delete All', primary: true, action: () => {
            data.messages = data.messages.filter(message => message.folder !== folder);
            data.selected = null;
            Mac.save();
            Mac.wm.refresh('outlook');
            Mac.Shell.renderDock();
          } },
        ],
      });
    },

    /** Out of Office. A real support flow, and a real cause of confusion. */
    autoReplySheet() {
      const data = this.data();
      Mac.Dialog.open({
        title: 'Automatic Replies',
        wide: true,
        icon: 'clock',
        body: `<p style="margin:0 0 12px;font-size:12.5px;color:var(--text-2)">
            Automatic replies are sent once to each sender while they are turned on.</p>
          ${UI.group(
            UI.toggle('Send automatic replies', 'outlook.autoReply.on'),
            UI.toggle('Also reply to senders outside the organisation', 'outlook.autoReply.external'),
          )}
          <div class="section-title">Reply message</div>
          <div class="dialog-field"><textarea data-outlook-autoreply style="min-height:110px">${esc(data.autoReply.message)}</textarea></div>`,
        buttons: [{ label: 'Done', primary: true, action: () => {
          Mac.wm.refresh('outlook');
          if (data.autoReply.on) Mac.Notify.show('Outlook', 'Automatic Replies are on. The status bar will say so until you turn them off.', { app: 'outlook' });
        } }],
      });
    },

    rulesSheet() {
      const data = this.data();
      Mac.Dialog.open({
        title: 'Rules',
        wide: true,
        icon: 'list',
        body: `<p style="margin:0 0 12px;font-size:12.5px;color:var(--text-2)">
            Rules run on incoming mail in order.</p>
          <div class="group">${data.rules.map(rule => `<div class="row">
            <div class="row-text"><strong>${esc(rule.name)}</strong><p>If ${esc(rule.when)} → ${esc(rule.then)}</p></div>
            <div class="row-action"><button class="switch ${rule.on ? 'on' : ''}" role="switch" aria-checked="${rule.on}"
              aria-label="${esc(rule.name)}" data-outlook-rule="${esc(rule.id)}"></button></div></div>`).join('')}</div>`,
        buttons: [{ label: 'Done', primary: true }],
      });
    },

    toggleRule(id) {
      const rule = this.data().rules.find(candidate => candidate.id === id);
      if (!rule) return;
      rule.on = !rule.on;
      Mac.save();
      this.rulesSheet();
    },

    /* Settings is a sheet with its own left nav in the real app, not a tab
       alongside Mail and Calendar. */
    settingsSheet(section = 'General') {
      const data = this.data();
      const sections = ['General', 'Mail', 'Calendar', 'Accounts'];

      const panes = {
        General: () => `
          ${UI.group(
            UI.select('Appearance', 'outlook.settings.darkMode', ['Follow system', 'Always light', 'Always dark']),
            UI.toggle('Simplified ribbon', 'outlook.settings.simplifiedRibbon', 'Show one compact row instead of labelled groups.'),
            UI.select('Reading pane', 'outlook.settings.readingPane', ['Right', 'Bottom', 'Off']),
          )}
          <div class="section-title">Notifications</div>
          ${UI.group(
            UI.toggle('Show desktop alerts', 'outlook.settings.notifyDesktop'),
            UI.select('Undo send window', 'outlook.settings.sendSoon', ['Off', '5 seconds', '10 seconds', '30 seconds']),
          )}`,
        Mail: () => `
          ${UI.group(
            UI.toggle('Focused Inbox', 'outlook.settings.focusedInbox', 'Sort important mail into Focused and everything else into Other.'),
            UI.toggle('Organise by conversation', 'outlook.settings.conversationView'),
            UI.toggle('Mark as read when selected', 'outlook.settings.markReadOnSelect'),
            UI.toggle('Request read receipts', 'outlook.settings.readReceipts'),
            UI.toggle('Warn about external senders', 'outlook.settings.externalWarning'),
            UI.toggle('Auto-archive old items', 'outlook.settings.autoArchive'),
          )}
          <div class="section-title">Junk Email Protection</div>
          ${UI.group(UI.select('Level', 'outlook.settings.junkProtection', ['Off', 'Low', 'High', 'Exclusive']))}
          <div class="section-title">Automatic Replies</div>
          ${UI.group(UI.action(data.autoReply.on ? 'Automatic Replies are on' : 'Automatic Replies are off',
            'outlook-action', 'Out-of-office message sent once per sender.', '', { arg: 'auto-reply' }))}
          <div class="section-title">Rules</div>
          ${UI.group(UI.action('Manage rules', 'outlook-action',
            `${data.rules.filter(rule => rule.on).length} of ${data.rules.length} enabled.`, '', { arg: 'rules' }))}
          <div class="section-title">Signature</div>
          <div class="dialog-field"><textarea data-outlook-signature style="min-height:76px">${esc(data.signature)}</textarea></div>`,
        Calendar: () => `
          ${UI.group(
            UI.select('Week starts on', 'outlook.settings.weekStart', ['Sunday', 'Monday']),
            UI.info('Working hours', data.settings.workHours),
            UI.select('Default view', 'outlook.calView', ['Day', 'Week', 'Month']),
          )}
          <div class="section-title">My Calendars</div>
          <div class="group">${data.calendars.map(calendar => `<div class="row">
            <div class="row-text"><strong>${esc(calendar.name)}</strong></div>
            <div class="row-action"><span class="ol-cat" style="background:${calendar.color}"></span>
              <button class="switch ${calendar.on ? 'on' : ''}" role="switch" aria-checked="${calendar.on}"
                aria-label="${esc(calendar.name)}" data-outlook-calendar="${esc(calendar.id)}"></button></div></div>`).join('')}</div>`,
        Accounts: () => `
          ${UI.group(
            UI.info('Account', data.account.address, data.account.name),
            UI.info('Type', data.account.type),
            UI.info('Server', data.account.server),
            UI.info('Authentication', 'OAuth 2.0 (modern authentication)'),
            UI.info('Connection', this.online() ? 'Connected' : 'Working offline', '',
              `<span class="badge ${this.online() ? 'ok' : 'bad'}">${this.online() ? 'Online' : 'Offline'}</span>`),
          )}
          <div class="section-title">Mailbox</div>
          ${UI.group(
            UI.info('Quota used', `${Mac.bytes(data.account.used)} of ${Mac.bytes(data.account.quota)}`),
            UI.action('Test Account Settings', 'outlook-action', 'Check the Exchange connection.', '', { arg: 'test' }),
            UI.action('Repair Mailbox', 'outlook-action', 'Rebuild the local cache for this profile.', '', { arg: 'repair' }),
          )}`,
      };

      Mac.Dialog.open({
        title: 'Outlook Settings',
        wide: true,
        className: 'sheet-style',
        body: `<div class="ol-settings">
          <nav class="ol-settings-nav">${sections.map(name =>
            `<button class="${name === section ? 'on' : ''}" data-outlook-settings="${name}">${name}</button>`).join('')}</nav>
          <div class="ol-settings-pane">${panes[section]()}</div>
        </div>`,
        buttons: [{ label: 'Done', primary: true, action: () => Mac.wm.refresh('outlook') }],
      });
    },

    /* --------------------------------------------------------------- sync */

    async sync() {
      if (!this.online()) {
        Mac.Dialog.open({
          title: 'Outlook is working offline',
          icon: 'warning',
          body: '<p style="margin:0;font-size:12.5px;color:var(--text-2)">Send/Receive could not complete because there is no network connection. Outlook will retry automatically.</p>',
          buttons: [{ label: 'OK' }, { label: 'Open Wi-Fi Settings', primary: true, action: () => Mac.run('open-setting', 'Wi-Fi') }],
        });
        return;
      }
      Mac.Notify.show('Outlook', 'Send/Receive in progress…', { app: 'outlook', transient: true, duration: 1400 });
      await Mac.wait(750);

      /* Anything sitting in the Outbox goes out first, which is what makes the
         Outbox meaningful rather than decorative. */
      const data = this.data();
      const queued = this.inFolder('Outbox');
      queued.forEach(message => { message.folder = 'Sent Items'; });

      data.messages.unshift({
        id: Mac.uid('ol'),
        folder: 'Inbox',
        focused: true,
        from: 'Service Desk',
        email: 'servicedesk@support.example',
        to: data.account.address,
        subject: 'Change window completed',
        preview: 'The bench VLAN is back in service.',
        body: 'The switch firmware upgrade completed at 23:10. DHCP renewals are working normally again.\n\nService Desk',
        date: Date.now(),
        unread: true,
        flagged: false,
        category: 'Blue',
      });
      Mac.save();
      Mac.wm.refresh('outlook');
      Mac.Shell.renderDock();
      if (queued.length) Mac.Notify.show('Outlook', `${Mac.plural(queued.length, 'queued message')} sent.`, { app: 'outlook', transient: true });
      Mac.Notify.show('Service Desk', 'Change window completed', { app: 'outlook' });
    },

    async newEvent() {
      const title = await Mac.Dialog.prompt({ title: 'New event', label: 'Title', value: 'Bench triage', confirmLabel: 'Add', icon: 'calendar' });
      if (!title) return;
      this.data().events.push({
        id: Mac.uid('ev'),
        title,
        day: new Date().getDay(),
        start: 15,
        minutes: 30,
        cal: 'cal-work',
        where: '',
        busy: 'Busy',
      });
      Mac.save();
      Mac.wm.refresh('outlook');
      Mac.Notify.show('Outlook', `“${title}” was added to today at 3:00 PM.`, { app: 'outlook', transient: true });
    },

    async newTask() {
      const title = await Mac.Dialog.prompt({ title: 'New task', label: 'Title', value: '', confirmLabel: 'Add', icon: 'check' });
      if (!title) return;
      this.data().tasks.unshift({ id: Mac.uid('td'), title, due: 'Today', flagged: false, done: false });
      Mac.save();
      Mac.wm.refresh('outlook');
    },

    toggleTask(id) {
      const task = this.data().tasks.find(candidate => candidate.id === id);
      if (!task) return;
      task.done = !task.done;
      Mac.save();
      Mac.wm.refresh('outlook');
    },

    toggleCalendar(id) {
      const calendar = this.data().calendars.find(candidate => candidate.id === id);
      if (!calendar) return;
      calendar.on = !calendar.on;
      Mac.save();
      Mac.wm.refresh('outlook');
      /* The same control appears in the Calendar settings pane, so if that is
         what was clicked the sheet is rebuilt in place. */
      if (document.querySelector('.ol-settings')) this.settingsSheet('Calendar');
    },

    showEvent(id) {
      const data = this.data();
      const event = data.events.find(candidate => candidate.id === id);
      if (!event) return;
      const calendar = data.calendars.find(candidate => candidate.id === event.cal);
      Mac.Dialog.open({
        title: event.title,
        icon: 'calendar',
        body: UI.group(
          UI.info('When', `${DAY_NAMES[event.day]} at ${hourLabel(event.start)} — ${event.minutes} minutes`),
          UI.info('Where', event.where || 'No location'),
          UI.info('Calendar', calendar ? calendar.name : 'Calendar'),
          UI.info('Show as', event.busy),
          UI.info('Organiser', data.account.name),
        ),
        buttons: [
          { label: 'Close' },
          { label: 'Delete Event', action: () => {
            data.events = data.events.filter(candidate => candidate.id !== id);
            Mac.save();
            Mac.wm.refresh('outlook');
          } },
        ],
      });
    },

    calMove(arg) {
      const data = this.data();
      if (arg === 'today') data.calOffset = 0;
      else data.calOffset += Number(arg);
      Mac.save();
      Mac.wm.refresh('outlook');
    },

    select(id) {
      const data = this.data();
      data.selected = id;
      const message = data.messages.find(candidate => candidate.id === id);
      if (message && message.unread && data.settings.markReadOnSelect) message.unread = false;
      Mac.save();
      Mac.wm.refresh('outlook');
      Mac.Shell.renderDock();
    },

    /* ------------------------------------------------------------ compose */

    compose({ to = '', cc = '', subject = '', quote = null } = {}) {
      const data = this.data();
      const quoted = quote
        ? `\n\n-----Original Message-----\nFrom: ${quote.from} <${quote.email}>\nSent: ${new Date(quote.date).toLocaleString()}\nTo: ${quote.to || data.account.address}\nSubject: ${quote.subject}\n\n${quote.body}`
        : '';

      Mac.Dialog.open({
        title: subject ? `${subject} — Message` : 'Untitled — Message',
        wide: true,
        className: 'sheet-style',
        body: `<div class="outlook-ribbon compose" style="border-radius:8px;margin-bottom:12px">
            <button class="ol-rib-btn primary" data-command="outlook-send">${glyph('send', { size: 16 })}<span>Send</span></button>
            <span class="ribbon-sep"></span>
            <button class="ol-rib-btn" data-command="outlook-action" data-arg="attach">${glyph('tag', { size: 16 })}<span>Attach</span></button>
            <button class="ol-rib-btn" data-command="outlook-signature-insert">${glyph('compose', { size: 16 })}<span>Signature</span></button>
            <button class="ol-rib-btn" data-command="outlook-action" data-arg="importance">${glyph('warning', { size: 16 })}<span>Importance</span></button>
          </div>
          <div class="mail-compose-grid">
            <label for="ol-to">To</label><input id="ol-to" value="${esc(to)}" autocomplete="off">
            <label for="ol-cc">Cc</label><input id="ol-cc" value="${esc(cc)}" autocomplete="off">
            <label for="ol-subject">Subject</label><input id="ol-subject" value="${esc(subject)}" autocomplete="off">
          </div>
          <div class="dialog-field"><textarea id="ol-body" style="min-height:170px">${esc(`\n\n${data.signature}${quoted}`)}</textarea></div>
          <p class="field-error" id="ol-error"></p>`,
        buttons: [
          { label: 'Discard' },
          { label: 'Save Draft', action: () => this.saveDraft() },
          { label: 'Send', primary: true, close: false, action: () => this.send() },
        ],
        onMount: () => setTimeout(() => document.getElementById(to ? 'ol-body' : 'ol-to')?.focus(), 30),
      });
    },

    readCompose() {
      return {
        to: document.getElementById('ol-to')?.value.trim() || '',
        cc: document.getElementById('ol-cc')?.value.trim() || '',
        subject: document.getElementById('ol-subject')?.value.trim() || '',
        body: document.getElementById('ol-body')?.value || '',
      };
    },

    insertSignature() {
      const field = document.getElementById('ol-body');
      if (!field) return;
      field.value = `${field.value}\n\n${this.data().signature}`;
      field.focus();
    },

    saveDraft() {
      this.push('Drafts', this.readCompose());
      Mac.Notify.show('Outlook', 'Saved to Drafts.', { app: 'outlook', transient: true });
    },

    send() {
      const draft = this.readCompose();
      const error = document.getElementById('ol-error');
      if (!draft.to) { error.textContent = 'Enter at least one recipient.'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.to.split(',')[0].trim())) {
        error.textContent = 'Outlook does not recognise that address.';
        return;
      }
      if (!this.online()) {
        /* Offline, Outlook queues in the Outbox rather than discarding —
           that queued item is exactly what a caller needs to be told about. */
        Mac.Dialog.close();
        this.push('Outbox', draft);
        Mac.Dialog.info('Message queued in the Outbox',
          'Outlook is working offline, so the message is waiting in the Outbox. It will go out at the next Send/Receive.',
          'warning');
        return;
      }
      Mac.Dialog.close();
      this.push('Sent Items', draft);
      Mac.Notify.show('Outlook', `Message sent to ${draft.to}.`, { app: 'outlook', transient: true });
    },

    push(folder, draft) {
      const data = this.data();
      data.messages.unshift({
        id: Mac.uid('ol'),
        folder,
        focused: true,
        from: data.account.name,
        email: data.account.address,
        to: draft.to,
        cc: draft.cc || '',
        subject: draft.subject || '(no subject)',
        preview: draft.body.trim().slice(0, 80),
        body: draft.body,
        date: Date.now(),
        unread: false,
        flagged: false,
      });
      Mac.save();
      Mac.wm.refresh('outlook');
      Mac.Shell.renderDock();
    },
  };

  Mac.registerApp({
    id: 'outlook',
    title: 'Microsoft Outlook',
    icon: 'outlook',
    category: 'Productivity',
    blurb: 'The Exchange client used on the support desk, with Focused Inbox, calendar and out-of-office.',
    size: [1180, 720],
    min: [620, 400],
    singleton: true,
    version: '16.92',
    toolbar: () => `<button class="tool-btn" data-command="outlook-action" data-arg="sync" aria-label="Send and receive">${glyph('refresh')}</button>
      <button class="tool-btn" data-command="outlook-action" data-arg="compose" aria-label="New mail">${glyph('compose')}</button>
      <button class="tool-btn" data-command="outlook-settings" aria-label="Settings">${glyph('gear')}</button>`,
    menus: () => ({
      File: [
        { label: 'New Email', command: 'outlook-action', arg: 'compose', shortcut: '⌘N' },
        { label: 'New Event', command: 'outlook-action', arg: 'new-event' },
        { label: 'New Task', command: 'outlook-action', arg: 'new-task' },
        { separator: true },
        { label: 'Send/Receive All', command: 'outlook-action', arg: 'sync' },
        { label: 'Print…', command: 'outlook-print', shortcut: '⌘P' },
      ],
      Message: [
        { label: 'Reply', command: 'outlook-action', arg: 'reply', shortcut: '⌘R' },
        { label: 'Reply All', command: 'outlook-action', arg: 'reply-all', shortcut: '⇧⌘R' },
        { label: 'Forward', command: 'outlook-action', arg: 'forward', shortcut: '⌘J' },
        { separator: true },
        { label: 'Mark as Read or Unread', command: 'outlook-action', arg: 'toggle-read' },
        { label: 'Flag', command: 'outlook-action', arg: 'flag' },
        { label: 'Categorise…', command: 'outlook-action', arg: 'categorise' },
        { label: 'Move to Folder…', command: 'outlook-action', arg: 'move' },
        { separator: true },
        { label: 'Archive', command: 'outlook-action', arg: 'archive' },
        { label: 'Junk', command: 'outlook-action', arg: 'junk' },
        { label: 'Delete', command: 'outlook-action', arg: 'delete', shortcut: '⌫' },
        { separator: true },
        { label: 'View Source', command: 'outlook-source' },
      ],
      Tools: [
        { label: 'Automatic Replies…', command: 'outlook-action', arg: 'auto-reply' },
        { label: 'Rules…', command: 'outlook-action', arg: 'rules' },
        { separator: true },
        { label: 'Test Account Settings', command: 'outlook-action', arg: 'test' },
        { label: 'Repair Mailbox', command: 'outlook-action', arg: 'repair' },
        { label: 'Work Offline', command: 'wifi-toggle' },
        { separator: true },
        { label: 'Settings…', command: 'outlook-settings', shortcut: '⌘,' },
      ],
      View: [
        { label: 'Mail', command: 'outlook-module', arg: 'mail' },
        { label: 'Calendar', command: 'outlook-module', arg: 'calendar' },
        { label: 'People', command: 'outlook-module', arg: 'people' },
        { label: 'To Do', command: 'outlook-module', arg: 'todo' },
        { separator: true },
        { label: 'Reading Pane Right', command: 'outlook-action', arg: 'pane-right' },
        { label: 'Reading Pane Bottom', command: 'outlook-action', arg: 'pane-bottom' },
        { label: 'Reading Pane Off', command: 'outlook-action', arg: 'pane-off' },
        { separator: true },
        { label: 'Simplified Ribbon', command: 'outlook-action', arg: 'toggle-ribbon' },
      ],
    }),
    render: () => Outlook.render(),
  });
}(window.Mac));
