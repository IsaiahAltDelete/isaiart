/* ===========================================================================
   Shared UI: dialogs, context menus, toasts and small control helpers.
   =========================================================================== */

(function (Win) {
  'use strict';

  const layer = () => Win.$('#overlay-layer');

  /* ----------------------------------------------------------------- dialogs */

  /**
   * Content dialog. Resolves with the clicked button's value, or null when
   * dismissed with Escape. `owner` scopes the smoke layer to one window.
   *   Win.dialog({ title, body, buttons: [{ label, value, primary }], owner, onRender })
   */
  Win.dialog = ({ title = '', body = '', buttons = [{ label: 'OK', value: true, primary: true }], owner = null, onRender = null, width = 0, icon = '' } = {}) =>
    new Promise(resolve => {
      const host = owner?.el || document.body;
      const smoke = Win.html(`<div class="dlg-smoke ${owner ? 'in-window' : ''}" role="presentation">
        <div class="dlg" role="dialog" aria-modal="true" aria-label="${Win.esc(title)}" ${width ? `style="width:${width}px"` : ''}>
          <div class="dlg-body">
            ${title ? `<h2 class="dlg-title">${icon ? `<span class="dlg-icon">${icon}</span>` : ''}${Win.esc(title)}</h2>` : ''}
            <div class="dlg-content">${body}</div>
          </div>
          <div class="dlg-actions">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'accent' : ''}" data-i="${i}" ${b.disabled ? 'disabled' : ''}>${Win.esc(b.label)}</button>`).join('')}</div>
        </div></div>`);
      (owner ? owner.el : layer() || host).appendChild(smoke);
      const box = smoke.querySelector('.dlg');
      const previous = document.activeElement;
      const finish = value => {
        smoke.remove();
        document.removeEventListener('keydown', onKey, true);
        try { previous?.focus?.(); } catch { /* gone */ }
        resolve(value);
      };
      const onKey = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); }
        if (event.key === 'Enter' && !event.target.matches('textarea, button')) {
          const primary = buttons.findIndex(b => b.primary);
          if (primary >= 0) { event.preventDefault(); clickButton(primary); }
        }
      };
      const clickButton = i => {
        const b = buttons[i];
        if (b.validate) {
          const problem = b.validate(box);
          if (problem) { showError(problem); return; }
        }
        finish(typeof b.value === 'function' ? b.value(box) : b.value);
      };
      const showError = message => {
        let line = box.querySelector('.dlg-error');
        if (!line) { line = Win.html('<p class="dlg-error" role="alert"></p>'); box.querySelector('.dlg-content').appendChild(line); }
        line.textContent = message;
      };
      smoke.addEventListener('click', event => {
        const button = event.target.closest('[data-i]');
        if (button && box.contains(button)) clickButton(Number(button.dataset.i));
      });
      smoke.addEventListener('pointerdown', event => event.stopPropagation());
      document.addEventListener('keydown', onKey, true);
      onRender?.(box, { close: finish, error: showError });
      requestAnimationFrame(() => (box.querySelector('input, select, textarea') || box.querySelector('.btn.accent') || box.querySelector('.btn'))?.focus());
    });

  Win.alert = (title, message, owner) => Win.dialog({ title, body: `<p>${Win.esc(message)}</p>`, owner, buttons: [{ label: 'OK', value: true, primary: true }] });

  Win.confirm = (title, message, { ok = 'Yes', cancel = 'No', owner = null } = {}) =>
    Win.dialog({ title, body: `<p>${Win.esc(message)}</p>`, owner, buttons: [{ label: ok, value: true, primary: true }, { label: cancel, value: false }] }).then(v => v === true);

  Win.prompt = (title, label, value = '', { owner = null, ok = 'OK', validate = null, type = 'text' } = {}) =>
    Win.dialog({
      title, owner,
      body: `<label class="field"><span>${Win.esc(label)}</span><input class="input" type="${type}" value="${Win.esc(value)}" spellcheck="false"></label>`,
      buttons: [
        { label: ok, primary: true, value: box => box.querySelector('input').value, validate: validate ? box => validate(box.querySelector('input').value) : null },
        { label: 'Cancel', value: null },
      ],
      onRender: box => { const input = box.querySelector('input'); setTimeout(() => input.select(), 20); },
    });

  /* ------------------------------------------------------------ context menu */

  let openMenu = null;

  Win.closeMenu = () => {
    openMenu?.remove();
    openMenu = null;
    document.querySelectorAll('#overlay-layer > .ctx.sub').forEach(sub => sub.remove());
  };

  /**
   * Context menu at viewport coordinates.
   * items: [{ label, glyph, shortcut, action, disabled, checked, radio, submenu, divider }]
   * quick: optional top row of icon-only commands (cut, copy, rename, share, delete).
   */
  Win.menu = (x, y, items, { quick = [], className = '' } = {}) => {
    Win.closeMenu();
    const el = buildMenu(items, quick, className);
    layer().appendChild(el);
    place(el, x, y);
    openMenu = el;
    requestAnimationFrame(() => el.querySelector('button:not([disabled])')?.focus({ preventScroll: true }));
    return el;
  };

  function buildMenu(items, quick = [], className = '') {
    const el = Win.html(`<div class="ctx ${className}" role="menu"></div>`);
    if (quick.length) {
      const row = Win.html('<div class="ctx-quick"></div>');
      quick.forEach(q => {
        const b = Win.html(`<button role="menuitem" title="${Win.esc(q.label)}" aria-label="${Win.esc(q.label)}" ${q.disabled ? 'disabled' : ''}>${Win.glyph(q.glyph, 16)}</button>`);
        b.addEventListener('click', () => { Win.closeMenu(); q.action?.(); });
        row.appendChild(b);
      });
      el.appendChild(row);
    }
    items.filter(Boolean).forEach(item => {
      if (item.divider) { el.appendChild(Win.html('<div class="ctx-sep" role="separator"></div>')); return; }
      const mark = item.checked ? (item.radio ? '<span class="ctx-dot"></span>' : Win.glyph('check', 14)) : '';
      const b = Win.html(`<button role="menuitem" class="${item.submenu ? 'has-sub' : ''}" ${item.disabled ? 'disabled' : ''}>
        <span class="ctx-ico">${item.icon || (item.glyph ? Win.glyph(item.glyph, 16) : mark)}</span>
        <span class="ctx-label">${Win.esc(item.label)}</span>
        ${item.shortcut ? `<span class="ctx-key">${Win.esc(item.shortcut)}</span>` : ''}
        ${item.submenu ? `<span class="ctx-chev">${Win.glyph('chevright', 12)}</span>` : (item.glyph && item.checked ? `<span class="ctx-chev">${Win.glyph('check', 12)}</span>` : '')}
      </button>`);
      if (item.submenu) {
        let sub = null;
        /* Submenus live in the overlay layer: the parent's backdrop-filter
           would otherwise become the containing block for position: fixed. */
        const show = () => {
          if (sub?.isConnected && el._sub === sub) return;
          el._sub?.remove();
          sub = buildMenu(item.submenu);
          sub.classList.add('sub');
          sub._parentItem = b;
          el._sub = sub;
          layer().appendChild(sub);
          const r = b.getBoundingClientRect();
          place(sub, r.right - 4, r.top - 4, r.left);
        };
        b.addEventListener('pointerenter', show);
        b.addEventListener('click', show);
        b.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { show(); sub?.querySelector('button')?.focus(); } });
      } else {
        b.addEventListener('pointerenter', () => { el._sub?.remove(); el._sub = null; });
        b.addEventListener('click', () => { Win.closeMenu(); item.action?.(); });
      }
      el.appendChild(b);
    });
    el.addEventListener('keydown', e => {
      const buttons = [...el.querySelectorAll(':scope > button:not([disabled]), :scope > .ctx-quick button:not([disabled])')];
      const i = buttons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
      if (e.key === 'ArrowLeft' && el.classList.contains('sub')) { e.preventDefault(); e.stopPropagation(); el._parentItem?.focus(); el.remove(); }
      if (e.key === 'Escape') { e.preventDefault(); Win.closeMenu(); }
    });
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('contextmenu', e => e.preventDefault());
    return el;
  }

  function place(el, x, y, flipX = null) {
    el.style.left = '0px';
    el.style.top = '0px';
    const r = el.getBoundingClientRect();
    const maxX = innerWidth - r.width - 6;
    const maxY = innerHeight - r.height - 6;
    let left = x;
    if (left > maxX) left = flipX != null ? flipX - r.width + 4 : maxX;
    el.style.left = `${Math.max(6, left)}px`;
    el.style.top = `${Math.max(6, Math.min(y, maxY))}px`;
  }

  document.addEventListener('pointerdown', () => Win.closeMenu());
  window.addEventListener('blur', () => Win.closeMenu());

  /* ------------------------------------------------------------------ toasts */

  /**
   * Notification toast. Also files the notification in Notification Center
   * unless `transient`. Respects Do not disturb.
   */
  Win.toast = ({ app = 'Windows', glyph = 'info', icon = '', title = '', body = '', transient = false, action = null, timeout = 6000 } = {}) => {
    if (!transient) {
      Win.state.notifications.unshift({ id: Win.uid('n'), app, icon: glyph, appIcon: icon, title, body, time: Date.now() });
      Win.state.notifications = Win.state.notifications.slice(0, 30);
      Win.save('notifications');
    }
    if (Win.state.settings.dnd || !Win.state.settings.notifications) return;
    const host = Win.$('#toasts');
    if (!host) return;
    const el = Win.html(`<div class="toast" role="status">
      <div class="toast-head"><span class="toast-app">${icon ? Win.appIcon(icon, 16) : Win.glyph(glyph, 14)}${Win.esc(app)}</span><button class="toast-x" aria-label="Dismiss">${Win.glyph('close', 12)}</button></div>
      <div class="toast-title">${Win.esc(title)}</div>${body ? `<div class="toast-body">${Win.esc(body)}</div>` : ''}</div>`);
    const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    el.querySelector('.toast-x').addEventListener('click', e => { e.stopPropagation(); dismiss(); });
    el.addEventListener('click', () => { dismiss(); action?.(); });
    host.appendChild(el);
    while (host.children.length > 3) host.firstElementChild.remove();
    setTimeout(dismiss, timeout);
  };

  /* -------------------------------------------------------- control helpers */

  /** Toggle switch markup; pair with data attributes in the caller. */
  Win.toggle = (on, attrs = '', label = '') =>
    `<label class="tgl ${on ? 'on' : ''}"><span class="tgl-text">${on ? 'On' : 'Off'}</span><input type="checkbox" role="switch" ${on ? 'checked' : ''} ${attrs} ${label ? `aria-label="${Win.esc(label)}"` : ''}><span class="tgl-track"><span class="tgl-thumb"></span></span></label>`;

  /* Keep the On/Off text and class in sync for every toggle in the page. */
  document.addEventListener('change', event => {
    const input = event.target;
    if (!input.matches('.tgl input')) return;
    const wrap = input.closest('.tgl');
    wrap.classList.toggle('on', input.checked);
    const t = wrap.querySelector('.tgl-text');
    if (t) t.textContent = input.checked ? 'On' : 'Off';
  });

  /** Native select styled as a Fluent combo box. */
  Win.select = (options, value, attrs = '') =>
    `<select class="combo" ${attrs}>${options.map(o => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${Win.esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${Win.esc(l)}</option>`;
    }).join('')}</select>`;

  /** Make a range input paint its filled portion with the accent colour. */
  Win.paintRange = input => {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  };
  document.addEventListener('input', event => { if (event.target.matches('input[type=range]')) Win.paintRange(event.target); });
  Win.paintRanges = scope => Win.$$('input[type=range]', scope).forEach(Win.paintRange);
})(window.Win);
