/* ===========================================================================
   Spotlight.

   Searches apps, settings panes, files, mail, notes, bookmarks and system
   actions, evaluates arithmetic and unit conversions, and offers keyboard
   navigation with a preview pane for the selected hit.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, appIcon } = Mac;

  const CONVERSIONS = {
    // value in metres / grams / celsius-offset handled separately
    length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, in: 0.0254, yd: 0.9144 },
    mass: { g: 1, kg: 1000, mg: 0.001, lb: 453.592, oz: 28.3495 },
    data: { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 },
  };

  const Spotlight = Mac.Spotlight = {
    open() {
      if (Mac.$('.spotlight')) { this.close(); return; }
      Mac.Surfaces.close();
      Mac.session.surface = 'spotlight';
      this.index = 0;
      this.query = '';

      const layer = Mac.$('#surface-layer');
      layer.innerHTML =
        `<div class="spotlight-backdrop" data-command="close-spotlight"></div>
         <section class="spotlight" role="dialog" aria-label="Spotlight Search">
          <div class="spotlight-head">${glyph('spotlight', { size: 22 })}
            <input id="spotlight-input" placeholder="Spotlight Search" autocomplete="off" spellcheck="false" aria-label="Search">
          </div>
          <div class="spotlight-body">
            <div class="spotlight-results" id="spotlight-results"></div>
            <aside class="spotlight-preview" id="spotlight-preview"></aside>
          </div>
        </section>`;

      this.render('');
      Mac.$('#spotlight-input').focus();
    },

    close() {
      if (Mac.session.surface === 'spotlight') Mac.Surfaces.close();
    },

    /** Build the ranked, grouped result set for a query. */
    results(query) {
      const q = query.trim().toLowerCase();
      const groups = [];

      // Arithmetic / conversion top hit.
      const computed = this.compute(query.trim());
      if (computed) {
        groups.push({ label: computed.label, items: [{
          title: computed.value, detail: computed.detail, glyph: 'chart', command: 'copy-value', arg: computed.value, kind: 'calc',
        }] });
      }

      if (!q) {
        const suggestions = ['safari', 'settings', 'terminal', 'mail', 'activity-monitor', 'disk-utility']
          .filter(id => Mac.apps[id])
          .map(id => ({ title: Mac.apps[id].title, detail: 'Application', icon: Mac.apps[id].icon, command: 'open-app', arg: id, kind: 'app' }));
        groups.push({ label: 'Suggestions', items: suggestions });
        groups.push({ label: 'System actions', items: this.actions().slice(0, 4) });
        return groups;
      }

      const match = text => String(text).toLowerCase().includes(q);
      const rank = text => {
        const value = String(text).toLowerCase();
        if (value === q) return 0;
        if (value.startsWith(q)) return 1;
        return 2;
      };

      const apps = Mac.appList()
        .filter(app => match(app.title) || match(app.category))
        .sort((a, b) => rank(a.title) - rank(b.title))
        .map(app => ({ title: app.title, detail: `Application — ${app.category}`, icon: app.icon, command: 'open-app', arg: app.id, kind: 'app' }));
      if (apps.length) groups.push({ label: 'Applications', items: apps.slice(0, 6) });

      const files = (Mac.FS?.search(q) || []).slice(0, 8).map(node => ({
        title: node.name,
        detail: `${Mac.FS.pathString(node.parent)} — ${Mac.FS.kindLabel(node)}`,
        icon: Mac.FS.iconFor(node),
        command: 'reveal-file',
        arg: node.id,
        kind: 'file',
        node,
      }));
      if (files.length) groups.push({ label: 'Documents', items: files });

      const panes = (Mac.Settings?.paneNames() || [])
        .filter(name => match(name) || (Mac.Settings.keywords(name) || []).some(match))
        .slice(0, 5)
        .map(name => ({ title: name, detail: 'System Settings', pane: name, command: 'open-setting', arg: name, kind: 'pane' }));
      if (panes.length) groups.push({ label: 'System Settings', items: panes });

      const mail = Mac.state.mail.messages
        .filter(message => match(message.subject) || match(message.from) || match(message.body))
        .slice(0, 4)
        .map(message => ({
          title: message.subject,
          detail: `Mail — ${message.from}`,
          icon: 'mail',
          command: 'open-mail-message',
          arg: message.id,
          kind: 'mail',
          message,
        }));
      if (mail.length) groups.push({ label: 'Mail', items: mail });

      const notes = Mac.state.notes
        .filter(note => match(note.title) || match(note.body))
        .slice(0, 4)
        .map(note => ({ title: note.title, detail: 'Notes', icon: 'notes', command: 'open-note', arg: note.id, kind: 'note', note }));
      if (notes.length) groups.push({ label: 'Notes', items: notes });

      const sites = Mac.state.browser.favorites.concat(Mac.state.browser.bookmarks)
        .filter(site => match(site.title) || match(site.url))
        .slice(0, 4)
        .map(site => ({ title: site.title, detail: site.url, icon: 'safari', command: 'browse', arg: site.url, kind: 'site' }));
      if (sites.length) groups.push({ label: 'Websites', items: sites });

      const actions = this.actions().filter(action => match(action.title) || match(action.detail));
      if (actions.length) groups.push({ label: 'System actions', items: actions.slice(0, 5) });

      if (!groups.length) {
        groups.push({ label: 'Web search', items: [{
          title: `Search the web for “${query.trim()}”`, detail: 'Search the web', glyph: 'globe',
          command: 'browse', arg: `search:${query.trim()}`, kind: 'web',
        }] });
      }
      return groups;
    },

    actions() {
      const wifi = Mac.state.wifi;
      return [
        { title: wifi.enabled ? 'Turn Wi-Fi Off' : 'Turn Wi-Fi On', detail: 'Network', glyph: 'wifi', command: 'wifi-toggle', kind: 'action' },
        { title: 'Run Network Diagnostics', detail: 'Troubleshooting', glyph: 'activity', command: 'run-diagnostics', kind: 'action' },
        { title: 'Empty Trash', detail: 'Finder', glyph: 'trash', command: 'empty-trash', kind: 'action' },
        { title: 'Lock Screen', detail: 'System', glyph: 'lock', command: 'power', arg: 'lock', kind: 'action' },
        { title: 'Restart', detail: 'System', glyph: 'restart', command: 'power', arg: 'restart', kind: 'action' },
        { title: 'Take Screenshot', detail: 'Utilities', glyph: 'camera', command: 'open-app', arg: 'screenshot', kind: 'action' },
        { title: 'Show Mission Control', detail: 'Window management', glyph: 'window', command: 'mission-control', kind: 'action' },
        { title: 'Erase All Content and Settings', detail: 'Transfer or Reset', glyph: 'restart', command: 'factory-reset', kind: 'action' },
      ];
    },

    /** Arithmetic and simple unit/currency conversion. */
    compute(input) {
      if (!input) return null;

      const convert = input.match(/^([\d.]+)\s*([a-z]+)\s+(?:in|to)\s+([a-z]+)$/i);
      if (convert) {
        const [, rawAmount, fromUnit, toUnit] = convert;
        const amount = parseFloat(rawAmount);
        const from = fromUnit.toLowerCase();
        const to = toUnit.toLowerCase();
        for (const table of Object.values(CONVERSIONS)) {
          if (table[from] && table[to]) {
            const result = (amount * table[from]) / table[to];
            return { label: 'Conversion', value: `${Math.round(result * 10000) / 10000} ${to}`, detail: `${amount} ${from} = ${Math.round(result * 10000) / 10000} ${to}` };
          }
        }
        if ((from === 'c' || from === 'celsius') && (to === 'f' || to === 'fahrenheit')) {
          return { label: 'Conversion', value: `${Math.round((amount * 9 / 5 + 32) * 10) / 10} °F`, detail: `${amount} °C in Fahrenheit` };
        }
        if ((from === 'f' || from === 'fahrenheit') && (to === 'c' || to === 'celsius')) {
          return { label: 'Conversion', value: `${Math.round(((amount - 32) * 5 / 9) * 10) / 10} °C`, detail: `${amount} °F in Celsius` };
        }
        return null;
      }

      if (!/^[-+*/(). \d]+$/.test(input) || !/[-+*/]/.test(input)) return null;
      try {
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict";return (${input})`)();
        if (!Number.isFinite(result)) return null;
        return { label: 'Calculator', value: String(Math.round(result * 1e10) / 1e10), detail: `${input} =` };
      } catch (error) {
        return null;
      }
    },

    render(query) {
      this.query = query;
      const groups = this.results(query);
      const flat = groups.flatMap(group => group.items);
      this.flat = flat;
      this.index = Mac.clamp(this.index, 0, Math.max(0, flat.length - 1));

      const host = Mac.$('#spotlight-results');
      if (!host) return;

      let cursor = -1;
      host.innerHTML = groups.map(group => `<div class="spot-group-label">${esc(group.label)}</div>` +
        group.items.map(item => {
          cursor += 1;
          const art = item.icon ? appIcon(item.icon) : `<span class="spot-glyph">${glyph(item.glyph || 'info')}</span>`;
          return `<button class="spot-result ${cursor === this.index ? 'on' : ''}" data-spot-index="${cursor}"
            data-command="${esc(item.command)}" ${item.arg !== undefined ? `data-arg="${esc(item.arg)}"` : ''}>
            ${item.pane ? Mac.paneIcon(item.pane) : art}
            <span><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></span>
            ${cursor === this.index ? '<kbd>↩</kbd>' : ''}</button>`;
        }).join('')).join('');

      if (!flat.length) {
        host.innerHTML = `<div class="empty" style="min-height:150px"><div><h2>No results</h2><p>Try another search term.</p></div></div>`;
      }
      this.renderPreview(flat[this.index]);
    },

    renderPreview(item) {
      const host = Mac.$('#spotlight-preview');
      if (!host) return;
      if (!item) { host.innerHTML = ''; return; }

      if (item.kind === 'app') {
        const app = Mac.apps[item.arg];
        host.innerHTML = `${appIcon(app.icon)}<h4>${esc(app.title)}</h4>
          <p>${esc(app.blurb || `${app.category} — included with this Mac.`)}</p>
          <div class="preview-meta"><span>Version<b>${esc(app.version)}</b></span>
          <span>Kind<b>Application</b></span><span>Category<b>${esc(app.category)}</b></span></div>`;
        return;
      }
      if (item.kind === 'file') {
        const node = item.node;
        host.innerHTML = `${appIcon(Mac.FS.iconFor(node))}<h4>${esc(node.name)}</h4>
          <div class="preview-meta"><span>Kind<b>${esc(Mac.FS.kindLabel(node))}</b></span>
            <span>Size<b>${node.size ? Mac.bytes(node.size) : '--'}</b></span>
            <span>Where<b>${esc(Mac.FS.pathString(node.parent))}</b></span>
            <span>Modified<b>${node.modified ? new Date(node.modified).toLocaleDateString() : '--'}</b></span></div>`;
        return;
      }
      if (item.kind === 'mail') {
        const message = item.message;
        host.innerHTML = `${appIcon('mail')}<h4>${esc(message.subject)}</h4>
          <p>${esc(message.preview)}</p>
          <div class="preview-meta"><span>From<b>${esc(message.from)}</b></span>
            <span>Mailbox<b>${esc(message.mailbox)}</b></span></div>`;
        return;
      }
      if (item.kind === 'note') {
        host.innerHTML = `${appIcon('notes')}<h4>${esc(item.note.title)}</h4>
          <p style="text-align:left">${esc(item.note.body.slice(0, 220))}</p>`;
        return;
      }
      if (item.kind === 'pane') {
        host.innerHTML = `<div style="display:grid;place-items:center;margin-bottom:12px">${Mac.paneIcon(item.pane, 'size-44')}</div>
          <h4>${esc(item.title)}</h4><p>Open this pane in System Settings.</p>`;
        return;
      }
      host.innerHTML = `<div style="display:grid;place-items:center;margin-bottom:12px;color:var(--accent)">${glyph(item.glyph || 'info', { size: 56 })}</div>
        <h4>${esc(item.title)}</h4><p>${esc(item.detail)}</p>`;
    },

    move(delta) {
      if (!this.flat?.length) return;
      this.index = Mac.clamp(this.index + delta, 0, this.flat.length - 1);
      this.render(this.query);
      Mac.$('.spot-result.on')?.scrollIntoView({ block: 'nearest' });
    },

    activate() {
      const item = this.flat?.[this.index];
      if (!item) return;
      this.close();
      Mac.run(item.command, item.arg);
    },
  };
}(window.Mac));
