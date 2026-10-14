/* ===========================================================================
   Shared UI services: modal dialogs, notifications/toasts, HUDs, and the row
   builders that every settings-style pane is assembled from.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph } = Mac;

  /* ------------------------------------------------------------------ dialogs */

  Mac.Dialog = {
    current: null,
    restoreFocus: null,

    /**
     * Open a modal dialog.
     * @param {object} config
     *   title, body (html), icon (glyph name | {app}), buttons [{label, primary,
     *   danger, action, close}], className, wide, onMount
     */
    open(config) {
      const { title, body = '', icon = 'info', buttons = [{ label: 'OK', primary: true }],
        className = '', wide = false, onMount } = config;

      if (!this.current) this.restoreFocus = document.activeElement;
      this.current = config;

      const art = typeof icon === 'object' && icon.app
        ? Mac.appIcon(icon.app, 'app-icon dialog-icon')
        : `<span class="dialog-icon" style="display:grid;place-items:center;color:var(--accent)">${glyph(icon, { size: 46 })}</span>`;

      Mac.$('#modal-layer').innerHTML =
        `<div class="modal-backdrop"><section class="dialog ${wide ? 'wide' : ''} ${className}" role="dialog" aria-modal="true" aria-labelledby="dialog-heading">
          ${wide ? '' : art}
          <h2 id="dialog-heading">${esc(title)}</h2>
          ${body ? `<div class="dialog-content">${body}</div>` : ''}
          <div class="dialog-actions">${buttons.map((button, index) =>
            `<button class="btn ${button.primary ? 'primary' : ''} ${button.danger ? 'destructive' : ''}"
              data-dialog-button="${index}" ${button.disabled ? 'disabled' : ''}>${esc(button.label)}</button>`).join('')}
          </div>
        </section></div>`;

      if (onMount) onMount(Mac.$('#modal-layer .dialog'));
      const focusable = Mac.$('#modal-layer input:not([type=hidden]), #modal-layer textarea, #modal-layer .btn.primary, #modal-layer .btn');
      focusable?.focus();
    },

    /** Replace the body of the open dialog without re-running open(). */
    setBody(html) {
      const content = Mac.$('#modal-layer .dialog-content');
      if (content) content.innerHTML = html;
    },

    setActions(buttons) {
      if (!this.current) return;
      this.current.buttons = buttons;
      const actions = Mac.$('#modal-layer .dialog-actions');
      if (!actions) return;
      actions.innerHTML = buttons.map((button, index) =>
        `<button class="btn ${button.primary ? 'primary' : ''} ${button.danger ? 'destructive' : ''}"
          data-dialog-button="${index}" ${button.disabled ? 'disabled' : ''}>${esc(button.label)}</button>`).join('');
    },

    close() {
      Mac.$('#modal-layer').innerHTML = '';
      this.current = null;
      const target = this.restoreFocus;
      this.restoreFocus = null;
      if (target && document.contains(target)) target.focus?.();
    },

    async activate(index) {
      const button = this.current?.buttons?.[index];
      if (!button) return;
      if (button.close !== false) this.close();
      if (button.action) await button.action();
    },

    /** One-button informational dialog. */
    info(title, body, icon = 'info') {
      this.open({
        title,
        icon,
        body: body ? `<p style="margin:0;color:var(--text-2);font-size:12.5px;line-height:1.55">${body}</p>` : '',
        buttons: [{ label: 'OK', primary: true }],
      });
    },

    /** Confirm/cancel dialog returning a promise. */
    confirm({ title, body = '', confirmLabel = 'Continue', danger = false, icon = 'warning' }) {
      return new Promise(resolve => {
        this.open({
          title,
          icon,
          body: body ? `<p style="margin:0;color:var(--text-2);font-size:12.5px;line-height:1.55">${body}</p>` : '',
          buttons: [
            { label: 'Cancel', action: () => resolve(false) },
            { label: confirmLabel, primary: !danger, danger, action: () => resolve(true) },
          ],
        });
      });
    },

    /** Single text field prompt. Resolves to the trimmed string, or null. */
    prompt({ title, label = 'Name', value = '', confirmLabel = 'OK', icon = 'compose', validate }) {
      return new Promise(resolve => {
        const fieldId = Mac.uid('field');
        this.open({
          title,
          icon,
          body: `<div class="dialog-field"><label for="${fieldId}">${esc(label)}</label>
            <input id="${fieldId}" value="${esc(value)}" autocomplete="off" spellcheck="false">
            <p class="field-error" data-prompt-error></p></div>`,
          buttons: [
            { label: 'Cancel', action: () => resolve(null) },
            {
              label: confirmLabel,
              primary: true,
              close: false,
              action: () => {
                const input = document.getElementById(fieldId);
                const text = input.value.trim();
                const problem = validate ? validate(text) : (text ? '' : `Enter a ${label.toLowerCase()}.`);
                if (problem) {
                  Mac.$('[data-prompt-error]').textContent = problem;
                  input.focus();
                  input.select();
                  return;
                }
                this.close();
                resolve(text);
              },
            },
          ],
          onMount: dialog => setTimeout(() => {
            const input = dialog.querySelector('input');
            input?.focus();
            input?.select();
          }, 20),
        });
      });
    },
  };

  /* ------------------------------------------------------------ notifications */

  Mac.Notify = {
    /**
     * Post a banner. Banners also land in Notification Center unless
     * `transient` is set (HUD-style feedback that should not accumulate).
     */
    show(title, body, { app = 'settings', transient = false, actions = [], duration = 5000 } = {}) {
      if (!Mac.state.settings.notifications && !transient) return;
      if (Mac.state.settings.focus && !transient) {
        this.record(app, title, body);
        return;
      }

      const id = Mac.uid('toast');
      const stack = Mac.$('#toast-stack');
      if (!stack) return;

      const toast = document.createElement('article');
      toast.className = 'toast';
      toast.id = id;
      toast.innerHTML =
        `<div class="notification-head">${Mac.appIcon(app)}<strong>${esc(Mac.appTitle(app))}</strong>
          <time>now</time>
          <button class="icon-btn" style="width:20px;height:20px" data-dismiss-toast="${id}" aria-label="Dismiss">${glyph('close', { size: 11 })}</button>
        </div>
        <strong style="display:block;font-size:12.5px;margin-bottom:2px">${esc(title)}</strong>
        <p>${esc(body)}</p>
        ${actions.length ? `<div class="notification-actions">${actions.map(action =>
          `<button class="btn" data-command="${esc(action.command)}">${esc(action.label)}</button>`).join('')}</div>` : ''}`;
      stack.appendChild(toast);

      if (!transient) this.record(app, title, body);

      setTimeout(() => {
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 220);
      }, duration);
    },

    record(app, title, body) {
      Mac.state.notifications.unshift({ id: Mac.uid('n'), app, title, body, at: Date.now() });
      Mac.state.notifications = Mac.state.notifications.slice(0, 40);
      Mac.save();
      Mac.emit('notifications');
    },

    clear() {
      Mac.state.notifications = [];
      Mac.save();
      Mac.emit('notifications');
    },
  };

  /* ---------------------------------------------------------------------- HUD */

  /** Volume / brightness / keyboard HUD, matching the macOS overlay. */
  Mac.hud = (icon, value, caption) => {
    clearTimeout(Mac.session.hudTimer);
    let hud = Mac.$('#system-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'system-hud';
      hud.className = 'hud';
      Mac.$('#surface-layer').appendChild(hud);
    }
    const filled = Math.round(value / 6.25);
    hud.innerHTML = `${glyph(icon, { size: 40 })}
      <div class="hud-bars">${Array.from({ length: 16 }, (_, i) =>
        `<i class="${i < filled ? 'on' : ''}"></i>`).join('')}</div>
      ${caption ? `<div class="hud-caption">${esc(caption)}</div>` : ''}`;
    Mac.session.hudTimer = setTimeout(() => hud.remove(), 1300);
  };

  /* ------------------------------------------------------------ row builders */

  const UI = Mac.UI = {
    /** Section heading used at the top of a settings pane. */
    header(title, subtitle = '', trailing = '') {
      return `<div class="pane-header"><div><h1>${esc(title)}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${trailing ? `<div class="row-action">${trailing}</div>` : ''}</div>`;
    },

    /** A row with a switch bound to a state path. */
    toggle(label, path, description = '', { command = '' } = {}) {
      const on = Boolean(Mac.getPath(Mac.state, path));
      return `<div class="row"><div class="row-text"><strong>${esc(label)}</strong>${description ? `<p>${description}</p>` : ''}</div>
        <div class="row-action"><button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}"
          aria-label="${esc(label)}" data-toggle-path="${esc(path)}" ${command ? `data-after="${esc(command)}"` : ''}></button></div></div>`;
    },

    /** A row that runs a command when tapped. */
    action(label, command, description = '', value = '', { chevron = true, arg = '' } = {}) {
      return `<button class="row tappable" data-command="${esc(command)}" ${arg ? `data-arg="${esc(arg)}"` : ''}>
        <div class="row-text"><strong>${esc(label)}</strong>${description ? `<p>${description}</p>` : ''}</div>
        <div class="row-action">${value ? `<span class="row-value">${esc(value)}</span>` : ''}${chevron ? `<span class="chevron">${glyph('chevron', { size: 13 })}</span>` : ''}</div></button>`;
    },

    /** A plain informational row. */
    info(label, value, description = '', trailing = '') {
      return `<div class="row"><div class="row-text"><strong>${esc(label)}</strong>${description ? `<p>${description}</p>` : ''}</div>
        <div class="row-action">${value ? `<span class="row-value">${esc(value)}</span>` : ''}${trailing}</div></div>`;
    },

    /** A row with a <select> bound to a state path. */
    select(label, path, options, description = '') {
      const current = Mac.getPath(Mac.state, path);
      return `<div class="row"><div class="row-text"><strong>${esc(label)}</strong>${description ? `<p>${description}</p>` : ''}</div>
        <div class="row-action"><select class="field" aria-label="${esc(label)}" data-select-path="${esc(path)}">
          ${options.map(option => `<option ${option === current ? 'selected' : ''}>${esc(option)}</option>`).join('')}
        </select></div></div>`;
    },

    /** A row with a slider bound to a state path. */
    slider(label, path, { min = 0, max = 100, step = 1, description = '', suffix = '%', width = 190 } = {}) {
      const value = Number(Mac.getPath(Mac.state, path));
      const pct = ((value - min) / (max - min)) * 100;
      return `<div class="row"><div class="row-text"><strong>${esc(label)}</strong>${description ? `<p>${description}</p>` : ''}</div>
        <div class="row-action"><span class="row-value">${suffix === '%' ? Math.round(value) : value}${esc(suffix)}</span>
        <input class="range" style="width:${width}px;--fill-pct:${pct}%" type="range" min="${min}" max="${max}" step="${step}"
          value="${value}" data-range-path="${esc(path)}" aria-label="${esc(label)}"></div></div>`;
    },

    /** Checkbox line, used inside dialogs. */
    check(label, path, { arg = '' } = {}) {
      const on = Boolean(Mac.getPath(Mac.state, path));
      return `<button class="check-line" data-toggle-path="${esc(path)}" ${arg ? `data-arg="${esc(arg)}"` : ''}>
        <span class="checkbox ${on ? 'on' : ''}" aria-hidden="true">✓</span><span>${esc(label)}</span></button>`;
    },

    group(...rows) {
      const inner = rows.flat().filter(Boolean).join('');
      return inner ? `<div class="group">${inner}</div>` : '';
    },

    empty(title, body, { icon = 'info', action = '' } = {}) {
      return `<div class="empty"><div>
        <div class="empty-art">${glyph(icon, { size: 52 })}</div>
        <h2>${esc(title)}</h2>${body ? `<p>${body}</p>` : ''}${action}</div></div>`;
    },

    /** Horizontal stacked bar with legend, used for storage panes. */
    stacked(segments, total) {
      const sum = segments.reduce((acc, segment) => acc + segment.bytes, 0);
      const free = Math.max(0, total - sum);
      return `<div class="storage-bar">
          ${segments.map(segment => `<i style="width:${(segment.bytes / total) * 100}%;background:${segment.color}" title="${esc(segment.label)}"></i>`).join('')}
        </div>
        <div class="legend">${segments.map(segment =>
          `<span><i style="background:${segment.color}"></i>${esc(segment.label)} — ${Mac.bytes(segment.bytes)}</span>`).join('')}
          <span><i style="background:var(--fill)"></i>Available — ${Mac.bytes(free)}</span></div>`;
    },

    /** Signal-strength bars. */
    signal(bars) {
      return `<span class="signal" data-bars="${bars}" aria-label="${bars} of 4 bars"><i></i><i></i><i></i><i></i></span>`;
    },

    avatar(name, { size = '', initials = '' } = {}) {
      const text = initials || Mac.initials(name);
      return `<span class="avatar ${size}" aria-hidden="true">${esc(text)}</span>`;
    },
  };

  /** Look up a friendly app title from anywhere (safe before apps register). */
  Mac.appTitle = id => Mac.apps?.[id]?.title || 'Finder';
}(window.Mac));
