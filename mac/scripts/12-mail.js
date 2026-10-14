/* ===========================================================================
   Apple Mail.

   Two accounts, unified mailboxes, categories, threading-lite, compose with
   drafts, rules, signatures, junk filtering and a full settings sheet. Sending
   and receiving both respect the simulated network state.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, UI } = Mac;

  const MAILBOXES = [
    { id: 'Inbox', glyph: 'inbox' },
    { id: 'VIP', glyph: 'star' },
    { id: 'Flagged', glyph: 'flag' },
    { id: 'Drafts', glyph: 'compose' },
    { id: 'Sent', glyph: 'send' },
    { id: 'Junk', glyph: 'junk' },
    { id: 'Trash', glyph: 'trash' },
    { id: 'Archive', glyph: 'archive' },
  ];

  const CATEGORIES = ['All', 'Primary', 'Transactions', 'Updates', 'Promotions'];

  const Mail = Mac.Mail = {
    data() { return Mac.state.mail; },

    accounts() { return this.data().accounts; },

    account(id) { return this.accounts().find(account => account.id === id) || null; },

    activeAccount() { return this.account(this.data().activeAccountId) || this.accounts()[0]; },

    /* One definition of reachability for the whole simulator — see
       Mac.Network.offlineReason. Mail used to keep its own, which ignored DNS
       and proxy faults, so it happily fetched mail on a Mac that could not
       resolve a hostname. */
    online() { return Mac.Network.online(); },

    /** Messages for the current mailbox, account scope, category and search. */
    visible() {
      const data = this.data();
      let messages = data.messages.filter(message => {
        const account = this.account(message.accountId);
        return !account || account.enabled;
      });

      if (data.scopeAccountId) messages = messages.filter(message => message.accountId === data.scopeAccountId);

      if (data.mailbox === 'Flagged') messages = messages.filter(message => message.flagged);
      else if (data.mailbox === 'VIP') messages = messages.filter(message => message.vip);
      else messages = messages.filter(message => message.mailbox === data.mailbox);

      if (data.mailbox === 'Inbox' && data.category !== 'All') {
        messages = messages.filter(message => message.category === data.category);
      }

      const query = data.search.trim().toLowerCase();
      if (query) {
        messages = messages.filter(message => [message.subject, message.from, message.preview, message.body]
          .some(field => String(field || '').toLowerCase().includes(query)));
      }

      return messages.sort((a, b) => (data.viewing.newestFirst ? b.date - a.date : a.date - b.date));
    },

    count(mailbox) {
      const data = this.data();
      if (mailbox === 'Flagged') return data.messages.filter(message => message.flagged).length;
      if (mailbox === 'VIP') return data.messages.filter(message => message.vip).length;
      if (mailbox === 'Inbox') return data.messages.filter(message => message.mailbox === 'Inbox' && message.unread).length;
      return data.messages.filter(message => message.mailbox === mailbox).length;
    },

    selected() {
      const data = this.data();
      return data.messages.find(message => message.id === data.selected) || null;
    },

    select(id) {
      const data = this.data();
      data.selected = id;
      const message = data.messages.find(candidate => candidate.id === id);
      if (message?.unread) message.unread = false;
      Mac.save();
      Mac.wm.refresh('mail');
      Mac.Shell.renderDock();
    },

    setMailbox(mailbox, accountId = null) {
      const data = this.data();
      data.mailbox = mailbox;
      data.scopeAccountId = accountId;
      data.category = 'All';
      const first = this.visible()[0];
      data.selected = first ? first.id : null;
      Mac.save();
      Mac.wm.refresh('mail');
    },

    /* ------------------------------------------------------------ rendering */

    render(win) {
      const data = this.data();
      const messages = this.visible();
      const selected = this.selected();
      const showList = win.state.pane !== 'reader';

      return `<div class="mail-app ${showList ? 'show-list' : ''}">
        ${this.sidebar()}
        <div class="mail-list-pane">
          <div class="mail-list-head">
            <div class="mail-list-title"><h2>${esc(data.mailbox)}</h2>
              <span>${Mac.plural(messages.length, 'message')}</span></div>
            <div class="search"><span>${glyph('search')}</span>
              <input data-mail-search value="${esc(data.search)}" placeholder="Search" aria-label="Search mail"></div>
          </div>
          ${data.mailbox === 'Inbox' ? `<div class="mail-filters">${CATEGORIES.map(category =>
            `<button class="mail-filter ${data.category === category ? 'on' : ''}" data-mail-category="${category}">${category}</button>`).join('')}</div>` : ''}
          <div class="mail-messages">${messages.length ? messages.map(message => this.row(message)).join('')
            : UI.empty('No messages', data.search ? 'No message matches this search.' : 'This mailbox is empty.', { icon: 'inbox' })}</div>
        </div>
        <div class="mail-reading">${selected ? this.reader(selected) : this.noSelection()}</div>
      </div>`;
    },

    sidebar() {
      const data = this.data();
      return `<aside class="mail-sidebar">
        <div class="sidebar-heading">Mailboxes</div>
        ${MAILBOXES.map(mailbox => {
          const count = this.count(mailbox.id);
          const on = data.mailbox === mailbox.id && !data.scopeAccountId;
          return `<button class="side-item ${on ? 'on' : ''}" data-mail-mailbox="${mailbox.id}">
            <span class="side-glyph">${glyph(mailbox.glyph, { size: 15 })}</span>
            <span class="side-label">${mailbox.id}</span>
            ${count ? `<span class="side-count">${count}</span>` : ''}</button>`;
        }).join('')}
        ${this.accounts().map(account => `<div class="sidebar-heading">${esc(account.description)}</div>
          ${['Inbox', 'Sent', 'Archive'].map(mailbox => {
            const on = data.mailbox === mailbox && data.scopeAccountId === account.id;
            return `<button class="side-item ${on ? 'on' : ''}" data-mail-mailbox="${mailbox}" data-mail-account="${account.id}">
              <span class="side-glyph" style="color:${account.color}">${glyph('inbox', { size: 15 })}</span>
              <span class="side-label">${mailbox}</span></button>`;
          }).join('')}`).join('')}
      </aside>`;
    },

    row(message) {
      const data = this.data();
      const selected = data.selected === message.id;
      const previewLines = Number(String(data.viewing.previewLines).charAt(0)) || 2;
      return `<button class="mail-row ${message.unread ? '' : 'read'} ${selected ? 'on' : ''}" data-mail-message="${message.id}">
        <span class="mail-dot" aria-hidden="true"></span>
        <span class="mail-face" style="background:${Mac.tint(message.from)}">${esc(Mac.initials(message.from))}</span>
        <span class="mail-row-copy">
          <span class="mail-row-top"><strong>${esc(message.from)}</strong>
            ${message.flagged ? `<span class="mail-flag">${glyph('flag', { size: 11 })}</span>` : ''}
            ${message.attachment ? glyph('tag', { size: 11 }) : ''}
            <time>${this.stamp(message.date)}</time></span>
          <span class="mail-subject" style="${data.viewing.boldUnread && message.unread ? 'font-weight:700' : ''}">${esc(message.subject)}</span>
          ${previewLines ? `<span class="mail-preview">${esc(message.preview)}</span>` : ''}
        </span></button>`;
    },

    stamp(date) {
      const value = new Date(date);
      const sameDay = value.toDateString() === new Date().toDateString();
      return sameDay
        ? Mac.formatTime(value)
        : value.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    },

    reader(message) {
      const account = this.account(message.accountId);
      return `<div class="mail-reader-bar">
          <button class="tool-btn" data-mail-action="reply" aria-label="Reply">${glyph('reply')}</button>
          <button class="tool-btn" data-mail-action="reply-all" aria-label="Reply All">${glyph('reply-all')}</button>
          <button class="tool-btn" data-mail-action="forward" aria-label="Forward">${glyph('forward-mail')}</button>
          <span class="spacer"></span>
          <button class="tool-btn ${message.flagged ? 'on' : ''}" data-mail-action="flag" aria-label="Flag">${glyph('flag')}</button>
          <button class="tool-btn ${message.vip ? 'on' : ''}" data-mail-action="vip" aria-label="VIP">${glyph('star')}</button>
          <button class="tool-btn" data-mail-action="archive" aria-label="Archive">${glyph('archive')}</button>
          <button class="tool-btn" data-mail-action="junk" aria-label="Mark as junk">${glyph('junk')}</button>
          <button class="tool-btn" data-mail-action="delete" aria-label="Delete">${glyph('trash')}</button>
        </div>
        <div class="mail-content">
          <h1>${esc(message.subject)}</h1>
          <div class="mail-sender">
            <span class="mail-face" style="width:36px;height:36px;background:${Mac.tint(message.from)}">${esc(Mac.initials(message.from))}</span>
            <span class="mail-sender-copy"><strong>${esc(message.from)}</strong>
              <span>${esc(message.email)}${message.to ? ` › ${esc(message.to)}` : ''}</span></span>
            <span class="row-value">${new Date(message.date).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          </div>
          ${!this.online() ? `<div class="badge warn" style="margin-top:12px;display:inline-block">Offline — showing the cached copy</div>` : ''}
          <div class="mail-body">${esc(message.body)}</div>
          ${message.attachment ? `<div class="mail-attachment">${Mac.appIcon('document-pdf')}
            <div class="row-text"><strong>${esc(message.attachment)}</strong><p>PDF document — 1 attachment</p></div>
            <button class="btn" data-mail-action="save-attachment">Save to Downloads</button></div>` : ''}
          ${account ? `<p class="section-note">Delivered to ${esc(account.description)} (${esc(account.address)})</p>` : ''}
        </div>`;
    },

    noSelection() {
      return `<div class="mail-content">${UI.empty('No message selected',
        'Choose a message from the list, or write a new one.', {
          icon: 'mail',
          action: '<button class="btn primary" data-mail-action="compose">New Message</button>',
        })}</div>`;
    },

    /* ------------------------------------------------------------- actions */

    action(name) {
      const data = this.data();
      const message = this.selected();
      const needsMessage = ['reply', 'reply-all', 'forward', 'flag', 'vip', 'archive', 'junk', 'delete', 'save-attachment', 'toggle-read'];
      if (needsMessage.includes(name) && !message) {
        Mac.Notify.show('Mail', 'Select a message first.', { app: 'mail', transient: true });
        return;
      }

      switch (name) {
        case 'compose': this.compose(); break;
        case 'reply': this.compose({ reply: message }); break;
        case 'reply-all': this.compose({ reply: message, all: true }); break;
        case 'forward': this.compose({ forward: message }); break;
        case 'flag':
          message.flagged = !message.flagged;
          break;
        case 'vip':
          message.vip = !message.vip;
          break;
        case 'archive':
          message.mailbox = 'Archive';
          Mac.Notify.show('Mail', 'Message archived.', { app: 'mail', transient: true });
          break;
        case 'junk':
          message.mailbox = 'Junk';
          if (!data.blocked.includes(message.email)) data.blocked.push(message.email);
          Mac.Notify.show('Mail', `${message.email} was marked as junk and blocked.`, { app: 'mail', transient: true });
          break;
        case 'delete':
          message.mailbox = 'Trash';
          data.selected = null;
          break;
        case 'toggle-read':
          message.unread = !message.unread;
          break;
        case 'save-attachment':
          Mac.Browser.download(message.attachment, 839680);
          break;
        case 'get-mail': this.getMail(); break;
        case 'settings': this.settings(); break;
        default: break;
      }

      Mac.save();
      Mac.wm.refresh('mail');
      Mac.Shell.renderDock();
    },

    async getMail() {
      if (!this.online()) {
        Mac.Dialog.open({
          title: 'Cannot receive mail',
          icon: 'warning',
          body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">
            The server for the account “${esc(this.activeAccount().description)}” is not responding.
            This Mac is not connected to the internet.</p>`,
          buttons: [
            { label: 'Try Later' },
            { label: 'Open Wi-Fi Settings', primary: true, action: () => Mac.run('open-setting', 'Wi-Fi') },
          ],
        });
        this.accounts().forEach(account => { account.status = 'Offline'; });
        Mac.save();
        Mac.wm.refresh('mail');
        return;
      }

      Mac.Notify.show('Mail', 'Checking for new mail…', { app: 'mail', transient: true, duration: 1400 });
      await Mac.wait(700);

      const account = this.activeAccount();
      const arrivals = [
        { from: 'Service Desk', email: 'servicedesk@support.example', subject: 'Ticket 4821 updated', preview: 'The customer confirmed the fix.', body: 'The customer confirmed the captive portal fix worked. Closing the ticket.\n\nService Desk', category: 'Updates' },
        { from: 'Apple', email: 'no_reply@apple.example', subject: 'Your Mac is up to date', preview: 'macOS 27.0.1 is the latest version.', body: 'No further updates are available for this Mac.\n\nApple', category: 'Transactions' },
      ];
      const arrival = arrivals[Math.floor(Math.random() * arrivals.length)];
      const message = Object.assign({
        id: Mac.uid('mail'),
        accountId: account.id,
        mailbox: 'Inbox',
        unread: true,
        flagged: false,
        date: Date.now(),
      }, arrival);

      this.applyRules(message);
      this.data().messages.unshift(message);
      this.accounts().forEach(candidate => { candidate.status = 'Online'; candidate.lastChecked = 'Just now'; });
      Mac.save();
      Mac.wm.refresh('mail');
      Mac.Shell.renderDock();
      Mac.Notify.show(message.from, message.subject, { app: 'mail' });
    },

    applyRules(message) {
      this.data().rules.filter(rule => rule.enabled).forEach(rule => {
        const haystack = rule.condition.startsWith('Sender') ? message.email : message.subject;
        if (!String(haystack).toLowerCase().includes(rule.value.toLowerCase())) return;
        if (rule.action === 'Flag Message') message.flagged = true;
        if (rule.action.startsWith('Move to')) message.mailbox = 'Archive';
      });
      if (this.data().junk.enabled && this.data().blocked.includes(message.email)) {
        message.mailbox = 'Junk';
      }
    },

    compose({ reply = null, forward = null, all = false, prefill = null } = {}) {
      const account = this.activeAccount();
      const signature = this.data().signatures.find(item => item.id === this.data().activeSignatureId);
      const source = reply || forward;
      const to = reply ? reply.email : '';
      const subject = reply ? `Re: ${reply.subject}` : forward ? `Fwd: ${forward.subject}` : prefill?.subject || '';
      const quoted = source && this.data().composing.quoteOriginal
        ? `\n\nOn ${new Date(source.date).toLocaleString()}, ${source.from} wrote:\n> ${source.body.split('\n').join('\n> ')}`
        : '';
      const body = `${prefill?.body || ''}${signature ? `\n\n${signature.body}` : ''}${quoted}`;

      Mac.Dialog.open({
        title: reply ? 'Reply' : forward ? 'Forward' : 'New Message',
        wide: true,
        className: 'sheet-style',
        body: `<div class="mail-compose-tools" style="display:flex;gap:6px;padding-bottom:8px">
            <span class="badge info">${esc(account.description)}</span>
            <span class="badge">${this.online() ? 'Server reachable' : 'Offline — will queue'}</span></div>
          <div class="mail-compose-grid">
            <label for="compose-from">From</label>
            <select id="compose-from" class="field">${this.accounts().map(candidate =>
              `<option value="${candidate.id}" ${candidate.id === account.id ? 'selected' : ''}>${esc(candidate.address)}</option>`).join('')}</select>
            <label for="compose-to">To</label><input id="compose-to" value="${esc(all && source ? `${to}, dana@support.example` : to)}" autocomplete="off">
            <label for="compose-cc">Cc</label><input id="compose-cc" autocomplete="off">
            <label for="compose-subject">Subject</label><input id="compose-subject" value="${esc(subject)}" autocomplete="off">
          </div>
          <div class="dialog-field"><textarea id="compose-body" style="min-height:180px">${esc(body)}</textarea></div>
          <p class="field-error" id="compose-error"></p>`,
        buttons: [
          { label: 'Cancel' },
          { label: 'Save Draft', action: () => this.saveDraft() },
          { label: 'Send', primary: true, close: false, action: () => this.send() },
        ],
        onMount: () => setTimeout(() => document.getElementById(reply || forward ? 'compose-body' : 'compose-to')?.focus(), 30),
      });
    },

    readCompose() {
      return {
        accountId: document.getElementById('compose-from')?.value,
        to: document.getElementById('compose-to')?.value.trim() || '',
        cc: document.getElementById('compose-cc')?.value.trim() || '',
        subject: document.getElementById('compose-subject')?.value.trim() || '',
        body: document.getElementById('compose-body')?.value || '',
      };
    },

    saveDraft() {
      const draft = this.readCompose();
      const account = this.account(draft.accountId) || this.activeAccount();
      this.data().messages.unshift({
        id: Mac.uid('mail'),
        accountId: account.id,
        mailbox: 'Drafts',
        category: 'Primary',
        from: account.name,
        email: account.address,
        to: draft.to,
        subject: draft.subject || '(No subject)',
        preview: draft.body.trim().slice(0, 80),
        body: draft.body,
        date: Date.now(),
        unread: false,
        flagged: false,
      });
      Mac.save();
      Mac.wm.refresh('mail');
      Mac.Notify.show('Mail', 'Message saved to Drafts.', { app: 'mail', transient: true });
    },

    send() {
      const draft = this.readCompose();
      const error = document.getElementById('compose-error');
      if (!draft.to) { error.textContent = 'Enter at least one recipient.'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.to.split(',')[0].trim())) {
        error.textContent = 'That address is not valid.';
        return;
      }
      if (!draft.subject) { error.textContent = 'Enter a subject, or the message will be rejected by the server.'; return; }

      const account = this.account(draft.accountId) || this.activeAccount();

      if (!this.online()) {
        Mac.Dialog.close();
        this.saveDraft();
        Mac.Dialog.open({
          title: 'Cannot send message',
          icon: 'warning',
          body: `<p style="margin:0;font-size:12.5px;color:var(--text-2)">The outgoing server
            “${esc(account.outgoing.host)}” is not responding because this Mac is offline.
            The message has been saved to Drafts and will need to be sent again.</p>`,
          buttons: [
            { label: 'OK' },
            { label: 'Open Wi-Fi Settings', primary: true, action: () => Mac.run('open-setting', 'Wi-Fi') },
          ],
        });
        return;
      }

      Mac.Dialog.close();
      this.data().messages.unshift({
        id: Mac.uid('mail'),
        accountId: account.id,
        mailbox: 'Sent',
        category: 'Primary',
        from: account.name,
        email: account.address,
        to: draft.to,
        subject: draft.subject,
        preview: draft.body.trim().slice(0, 80),
        body: draft.body,
        date: Date.now(),
        unread: false,
        flagged: false,
      });
      Mac.save();
      Mac.wm.refresh('mail');
      Mac.Notify.show('Mail', `Message sent to ${draft.to}.`, { app: 'mail', transient: true });
    },

    /* ------------------------------------------------------------ settings */

    PANES: ['General', 'Accounts', 'Junk Mail', 'Composing', 'Signatures', 'Rules', 'Privacy'],

    settings(pane) {
      const data = this.data();
      if (pane) data.settingsPane = pane;
      Mac.save();

      Mac.Dialog.open({
        title: 'Mail Settings',
        wide: true,
        className: 'sheet-style',
        body: `<div class="tabs-bar" style="padding:0 0 8px;border-bottom:0.5px solid var(--hair);margin-bottom:14px">
            ${this.PANES.map(name => `<button class="tab-pill ${data.settingsPane === name ? 'on' : ''}"
              data-mail-settings-pane="${esc(name)}">${esc(name)}</button>`).join('')}
          </div>
          <div id="mail-settings-body">${this.settingsPane(data.settingsPane)}</div>`,
        buttons: [{ label: 'Done', primary: true }],
      });
    },

    settingsPane(name) {
      const data = this.data();
      switch (name) {
        case 'General':
          return UI.group(
            UI.select('Check for new messages', 'mail.general.checkInterval', ['Automatically', 'Every minute', 'Every 5 minutes', 'Every 15 minutes', 'Manually']),
            UI.select('New message sound', 'mail.general.newMessageSound', ['New Messages', 'Blow', 'Bottle', 'None']),
            UI.select('Dock unread count', 'mail.general.dockUnread', ['Inbox only', 'All mailboxes', 'None']),
            UI.select('Downloads folder', 'mail.general.downloadsFolder', ['Downloads', 'Desktop', 'Documents']),
          ) + UI.group(
            UI.toggle('Show most recent message at the top', 'mail.viewing.newestFirst'),
            UI.toggle('Bold unread subjects', 'mail.viewing.boldUnread'),
            UI.toggle('Organise by conversation', 'mail.viewing.threading'),
            UI.select('Preview lines', 'mail.viewing.previewLines', ['None', '1 Line', '2 Lines', '3 Lines', '5 Lines']),
          );

        case 'Accounts':
          return `<div class="group">${this.accounts().map(account => `
            <div class="row"><span class="mail-face" style="background:${account.color}">${esc(Mac.initials(account.description))}</span>
              <div class="row-text"><strong>${esc(account.description)}</strong>
                <p>${esc(account.address)} — ${esc(account.provider)}</p></div>
              <div class="row-action"><span class="badge ${account.status === 'Online' ? 'ok' : 'bad'}">${esc(account.status)}</span>
                <button class="switch ${account.enabled ? 'on' : ''}" data-mail-account-toggle="${account.id}" aria-label="Enable ${esc(account.description)}"></button></div></div>
            <div class="row block" style="background:var(--card-2)">
              <div class="mail-compose-grid" style="grid-template-columns:120px 1fr;gap:6px 12px">
                <label>Incoming server</label><input class="field" value="${esc(account.incoming.host)}" data-mail-field="incoming.host" data-account="${account.id}">
                <label>Incoming port</label><input class="field" value="${esc(account.incoming.port)}" data-mail-field="incoming.port" data-account="${account.id}">
                <label>Outgoing server</label><input class="field" value="${esc(account.outgoing.host)}" data-mail-field="outgoing.host" data-account="${account.id}">
                <label>Outgoing port</label><input class="field" value="${esc(account.outgoing.port)}" data-mail-field="outgoing.port" data-account="${account.id}">
                <label>Authentication</label><input class="field" value="${esc(account.incoming.auth)}" data-mail-field="incoming.auth" data-account="${account.id}">
              </div>
              <div class="row-flex" style="margin-top:10px">
                <button class="btn" data-command="mail-test-connection" data-arg="${account.id}">Test Connection</button>
                <button class="btn destructive" data-command="mail-remove-account" data-arg="${account.id}">Remove Account…</button>
                <span class="muted" style="font-size:11px">Last checked ${esc(account.lastChecked)}</span></div>
            </div>`).join('')}</div>
            <button class="btn primary" data-command="mail-add-account">Add Account…</button>`;

        case 'Junk Mail':
          return UI.group(
            UI.toggle('Enable junk mail filtering', 'mail.junk.enabled'),
            UI.select('When junk mail arrives', 'mail.junk.action', ['Move it to the Junk mailbox', 'Mark as junk but leave in Inbox', 'Perform custom actions']),
            UI.toggle('Exempt senders in my Contacts', 'mail.junk.exemptContacts'),
            UI.toggle('Trust junk mail headers from my provider', 'mail.junk.trustHeaders'),
          ) + `<div class="section-title">Blocked senders</div>
            <div class="group">${data.blocked.length ? data.blocked.map(address =>
              `<div class="row"><div class="row-text"><strong>${esc(address)}</strong></div>
                <button class="btn" data-command="mail-unblock" data-arg="${esc(address)}">Unblock</button></div>`).join('')
              : '<div class="row"><div class="row-text"><strong>No blocked senders</strong><p>Mark a message as junk to block its sender.</p></div></div>'}</div>`;

        case 'Composing':
          return UI.group(
            UI.select('Message format', 'mail.composing.format', ['Rich Text', 'Plain Text']),
            UI.select('Check spelling', 'mail.composing.spelling', ['As I Type', 'When I Click Send', 'Never']),
            UI.toggle('Quote the text of the original message', 'mail.composing.quoteOriginal'),
            UI.select('Send new messages from', 'mail.composing.sendFrom', ['Selected Mailbox Account', 'iCloud', 'Support Desk']),
          );

        case 'Signatures': {
          const active = data.signatures.find(item => item.id === data.activeSignatureId) || data.signatures[0];
          return `<div class="group">${data.signatures.map(signature =>
            `<button class="row tappable ${signature.id === active?.id ? '' : ''}" data-mail-signature="${signature.id}">
              <div class="row-text"><strong>${esc(signature.name)}</strong>
                <p>${esc(this.account(signature.accountId)?.description || 'All accounts')}</p></div>
              ${signature.id === active?.id ? '<span class="badge info">Editing</span>' : ''}</button>`).join('')}</div>
            ${active ? `<div class="dialog-field"><label>Signature text</label>
              <textarea data-mail-signature-body="${active.id}" style="min-height:110px">${esc(active.body)}</textarea></div>` : ''}
            <div class="row-flex" style="margin-top:10px">
              <button class="btn" data-command="mail-add-signature">Add Signature</button>
              ${active ? `<button class="btn destructive" data-command="mail-remove-signature" data-arg="${active.id}">Remove</button>` : ''}</div>`;
        }

        case 'Rules':
          return `<div class="group">${data.rules.length ? data.rules.map(rule =>
            `<div class="row"><div class="row-text"><strong>${esc(rule.name)}</strong>
              <p>${esc(rule.condition)} “${esc(rule.value)}” → ${esc(rule.action)}</p></div>
              <div class="row-action">
                <button class="switch ${rule.enabled ? 'on' : ''}" data-mail-rule-toggle="${rule.id}" aria-label="Enable rule"></button>
                <button class="btn destructive" data-command="mail-remove-rule" data-arg="${rule.id}">Remove</button></div></div>`).join('')
            : '<div class="row"><div class="row-text"><strong>No rules</strong><p>Rules run on new mail as it arrives.</p></div></div>'}</div>
            <button class="btn primary" data-command="mail-add-rule">Add Rule…</button>`;

        case 'Privacy':
          return UI.group(
            UI.toggle('Protect Mail activity', 'mail.privacy.protectActivity', 'Hide the IP address and load remote content privately.'),
            UI.toggle('Hide IP address', 'mail.privacy.hideIP'),
            UI.toggle('Block all remote content', 'mail.privacy.blockRemoteContent'),
          ) + '';

        default:
          return '';
      }
    },

    refreshSettings() {
      const host = document.getElementById('mail-settings-body');
      if (host) host.innerHTML = this.settingsPane(this.data().settingsPane);
    },

    async addAccount() {
      const providers = ['iCloud', 'Microsoft Exchange', 'Google', 'Yahoo', 'Other Mail Account'];
      Mac.Dialog.open({
        title: 'Choose a Mail account provider',
        icon: 'at',
        body: `<div class="group">${providers.map(provider =>
          `<button class="row tappable" data-command="mail-provider" data-arg="${esc(provider)}">
            <div class="row-text"><strong>${esc(provider)}</strong></div>
            <span class="chevron">${glyph('chevron', { size: 13 })}</span></button>`).join('')}</div>`,
        buttons: [{ label: 'Cancel' }],
      });
    },

    providerForm(provider) {
      const defaults = {
        iCloud: ['imap.mail.me.example', 'smtp.mail.me.example'],
        'Microsoft Exchange': ['outlook.office365.example', 'smtp.office365.example'],
        Google: ['imap.gmail.example', 'smtp.gmail.example'],
        Yahoo: ['imap.mail.yahoo.example', 'smtp.mail.yahoo.example'],
        'Other Mail Account': ['', ''],
      }[provider] || ['', ''];

      Mac.Dialog.open({
        title: `Add ${provider} account`,
        icon: 'at',
        body: `<div class="dialog-field"><label for="acct-name">Full name</label><input id="acct-name" value="${esc(Mac.state.account.name)}"></div>
          <div class="dialog-field"><label for="acct-address">Email address</label><input id="acct-address" placeholder="name@example.com" autocomplete="off"></div>
          <div class="dialog-field"><label for="acct-password">Password</label><input id="acct-password" type="password" autocomplete="off"></div>
          <div class="dialog-field"><label for="acct-incoming">Incoming server</label><input id="acct-incoming" value="${esc(defaults[0])}"></div>
          <div class="dialog-field"><label for="acct-outgoing">Outgoing server</label><input id="acct-outgoing" value="${esc(defaults[1])}"></div>
          <p class="field-error" id="acct-error"></p>`,
        buttons: [
          { label: 'Cancel' },
          { label: 'Sign In', primary: true, close: false, action: () => this.saveAccount(provider) },
        ],
      });
    },

    saveAccount(provider) {
      const name = document.getElementById('acct-name').value.trim();
      const address = document.getElementById('acct-address').value.trim();
      const password = document.getElementById('acct-password').value;
      const incoming = document.getElementById('acct-incoming').value.trim();
      const outgoing = document.getElementById('acct-outgoing').value.trim();
      const error = document.getElementById('acct-error');

      if (!name) { error.textContent = 'Enter a name for this account.'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { error.textContent = 'Enter a valid email address.'; return; }
      if (password.length < 4) { error.textContent = 'Enter the account password (any 4 or more characters here).'; return; }
      if (!incoming || !outgoing) { error.textContent = 'Both server names are required.'; return; }
      if (this.accounts().some(account => account.address.toLowerCase() === address.toLowerCase())) {
        error.textContent = 'That account has already been added.';
        return;
      }
      if (!this.online()) { error.textContent = 'Cannot verify the account while this Mac is offline.'; return; }

      const account = {
        id: Mac.uid('acct'),
        provider,
        name,
        address,
        description: provider === 'Other Mail Account' ? address.split('@')[1] : provider,
        enabled: true,
        color: Mac.tint(address),
        status: 'Online',
        lastChecked: 'Just now',
        incoming: { host: incoming, port: '993', tls: true, auth: 'Password' },
        outgoing: { host: outgoing, port: '587', tls: true, auth: 'Password' },
        mailboxes: { drafts: 'Drafts', sent: 'Sent', junk: 'Junk', trash: 'Trash', archive: 'Archive' },
      };
      this.accounts().push(account);
      this.data().activeAccountId = account.id;
      Mac.save();
      Mac.Dialog.close();
      Mac.wm.refresh('mail');
      Mac.Notify.show('Mail', `${account.description} was added.`, { app: 'mail' });
    },

    async removeAccount(id) {
      const account = this.account(id);
      if (!account) return;
      if (this.accounts().length === 1) {
        Mac.Dialog.info('Cannot remove the only account', 'Add another account before removing this one.');
        return;
      }
      const confirmed = await Mac.Dialog.confirm({
        title: `Remove the account “${account.description}”?`,
        body: 'Its messages will be removed from this Mac.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!confirmed) return;
      const data = this.data();
      data.accounts = data.accounts.filter(candidate => candidate.id !== id);
      data.messages = data.messages.filter(message => message.accountId !== id);
      data.activeAccountId = data.accounts[0].id;
      Mac.save();
      Mac.wm.refresh('mail');
      this.settings('Accounts');
    },

    async addRule() {
      const name = await Mac.Dialog.prompt({ title: 'Add rule', label: 'Description', value: 'New rule', confirmLabel: 'Add' });
      if (!name) return;
      this.data().rules.push({ id: Mac.uid('rule'), name, enabled: true, condition: 'Subject contains', value: name, action: 'Flag Message' });
      Mac.save();
      this.refreshSettings();
    },

    testConnection(id) {
      const account = this.account(id);
      if (!account) return;
      const online = this.online();
      account.status = online ? 'Online' : 'Offline';
      account.lastChecked = 'Just now';
      Mac.save();
      this.refreshSettings();
      Mac.Notify.show('Mail', online
        ? `${account.incoming.host} and ${account.outgoing.host} are reachable.`
        : 'Connection failed — this Mac is offline.', { app: 'mail' });
    },
  };

  Mac.registerApp({
    id: 'mail',
    title: 'Mail',
    icon: 'mail',
    category: 'Productivity',
    blurb: 'Read and write email.',
    size: [1080, 660],
    min: [520, 340],
    singleton: true,
    initialState: () => ({ pane: 'split' }),
    toolbar: () => `<button class="tool-btn" data-mail-action="get-mail" aria-label="Get new mail">${glyph('refresh')}</button>
      <button class="tool-btn" data-mail-action="compose" aria-label="New message">${glyph('compose')}</button>
      <button class="tool-btn" data-mail-action="settings" aria-label="Mail settings">${glyph('gear')}</button>`,
    menus: () => ({
      File: [
        { label: 'New Message', command: 'mail-action', arg: 'compose', shortcut: '⌘N' },
        { label: 'Get All New Mail', command: 'mail-action', arg: 'get-mail', shortcut: '⇧⌘N' },
      ],
      Message: [
        { label: 'Reply', command: 'mail-action', arg: 'reply', shortcut: '⌘R' },
        { label: 'Reply All', command: 'mail-action', arg: 'reply-all', shortcut: '⇧⌘R' },
        { label: 'Forward', command: 'mail-action', arg: 'forward', shortcut: '⇧⌘F' },
        'sep',
        { label: 'Mark as Unread', command: 'mail-action', arg: 'toggle-read' },
        { label: 'Flag', command: 'mail-action', arg: 'flag' },
        { label: 'Move to Junk', command: 'mail-action', arg: 'junk' },
        { label: 'Archive', command: 'mail-action', arg: 'archive' },
      ],
      Mailbox: MAILBOXES.map(mailbox => ({ label: mailbox.id, command: 'mail-mailbox', arg: mailbox.id })),
    }),
    render: win => Mail.render(win),
  });
}(window.Mac));
