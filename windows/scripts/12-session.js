/* ===========================================================================
   Session: boot, lock screen, PIN sign-in, sleep, restart, shut down and the
   User Account Control prompt. Pending Windows updates install on restart.
   =========================================================================== */

(function (Win) {
  'use strict';

  const $ = id => document.getElementById(id);
  const sess = () => Win.state.session;

  const show = id => ['lock-screen', 'boot-screen', 'off-screen'].forEach(s => $(s).classList.toggle('hidden', s !== id));
  const hideAll = () => show(null);

  const logo = size => `<span class="boot-logo" style="width:${size}px;height:${size}px">${Win.appIcon('windows', size)}</span>`;
  const dots = () => '<div class="boot-dots" aria-hidden="true">' + '<i></i>'.repeat(5) + '</div>';

  /* ---------------------------------------------------------- lock screen */

  let lockTimer = null;
  let attempts = 0;

  function lockMarkup() {
    const now = new Date();
    return `<div class="lk-bg" style="background:${Win.Wallpapers.css(Win.state.settings.lockWallpaper)}"></div>
      <div class="lk-clock" aria-live="off"><div class="lk-date">${Win.esc(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))}</div>
        <div class="lk-time">${Win.esc(now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: !Win.state.settings.time24 }).replace(/\s?[AP]M$/, ''))}</div></div>
      ${Win.state.settings.lockStatus ? `<div class="lk-widgets"><span>${Win.appIcon('weather', 20)} 68°F Mostly sunny</span></div>` : ''}
      <button class="lk-hit" aria-label="Unlock">${'<span class="sr">Press any key or click to sign in</span>'}</button>`;
  }

  function signInMarkup(error = '') {
    const pinMode = Win.state.account.pinMode !== 'password';
    return `<div class="lk-bg blur" style="background:${Win.Wallpapers.css(Win.state.settings.lockWallpaper)}"></div>
      <div class="si-box">
        <span class="si-avatar">${Win.esc(Win.PERSONA.initials)}</span>
        <h1>${Win.esc(Win.state.account.name)}</h1>
        ${error ? `<p class="si-error" role="alert">${Win.esc(error)}</p><button class="btn si-ok" data-si="ok">OK</button>`
          : `<form class="si-form" autocomplete="off">
            <label class="si-field"><input type="password" inputmode="${pinMode ? 'numeric' : 'text'}" placeholder="${pinMode ? 'PIN' : 'Password'}" aria-label="${pinMode ? 'PIN' : 'Password'}" autocomplete="off">
              <button type="submit" class="si-go" aria-label="Submit">${Win.glyph('forward', 16)}</button></label>
          </form>
          <button class="link si-link" data-si="forgot">I forgot my ${pinMode ? 'PIN' : 'password'}</button>
          <button class="link si-link" data-si="options">Sign-in options</button>
          <div class="si-options hidden"><button class="icon-btn ${pinMode ? 'on' : ''}" data-si="pin" aria-label="PIN" title="PIN (Windows Hello)">${Win.glyph('keyboard', 20)}</button><button class="icon-btn ${!pinMode ? 'on' : ''}" data-si="password" aria-label="Password" title="Password">${Win.glyph('key', 20)}</button></div>`}
      </div>
      <div class="si-corner">
        <button class="icon-btn" data-si="network" aria-label="Network" data-tip="${Win.esc(Win.Network.summary())}">${Win.glyph(Win.Network.glyph(), 18)}</button>
        <button class="icon-btn" data-si="access" aria-label="Accessibility">${Win.glyph('access', 18)}</button>
        <button class="icon-btn" data-si="power" aria-label="Power">${Win.glyph('power', 18)}</button>
      </div>`;
  }

  function showLock() {
    sess().locked = true;
    Win.save();
    Win.Flyout?.close();
    Win.closeMenu();
    const el = $('lock-screen');
    el.className = 'system-screen lock t-dark';
    el.innerHTML = lockMarkup();
    show('lock-screen');
    clearInterval(lockTimer);
    lockTimer = setInterval(() => {
      if (!el.classList.contains('lock')) return;
      const clock = el.querySelector('.lk-clock');
      if (clock) clock.outerHTML = lockMarkup().match(/<div class="lk-clock"[\s\S]*?<\/div><\/div>/)[0];
    }, 5000);
    setTimeout(() => el.querySelector('.lk-hit')?.focus(), 50);
  }

  function showSignIn(error = '') {
    const el = $('lock-screen');
    el.className = 'system-screen signin t-dark';
    el.innerHTML = signInMarkup(error);
    show('lock-screen');
    setTimeout(() => (el.querySelector('.si-field input') || el.querySelector('.si-ok'))?.focus(), 80);
  }

  async function submit(value) {
    const pinMode = Win.state.account.pinMode !== 'password';
    const expected = pinMode ? Win.state.account.pin : Win.state.account.password || 'support';
    if (value === expected) {
      attempts = 0;
      const el = $('lock-screen');
      el.querySelector('.si-box').innerHTML = `<span class="si-avatar">${Win.esc(Win.PERSONA.initials)}</span><h1>${Win.esc(Win.state.account.name)}</h1>${dots()}<p class="si-welcome">Welcome</p>`;
      await Win.wait(sess().signedIn ? 500 : 1300);
      unlock();
      return;
    }
    attempts += 1;
    showSignIn(pinMode ? 'The PIN is incorrect. Try again.' : 'The password is incorrect. Try again.');
  }

  function unlock() {
    clearInterval(lockTimer);
    const firstSignIn = !sess().signedIn;
    sess().locked = false;
    sess().signedIn = true;
    Win.save();
    const el = $('lock-screen');
    el.classList.add('leaving');
    setTimeout(() => { hideAll(); el.innerHTML = ''; el.className = 'system-screen hidden'; }, 260);
    if (firstSignIn) Win.Network.autoJoin();
  }

  function wireLock() {
    const el = $('lock-screen');
    let startY = null;
    el.addEventListener('pointerdown', e => {
      if (el.classList.contains('lock')) startY = e.clientY;
    });
    el.addEventListener('pointermove', e => {
      if (startY == null || !el.classList.contains('lock')) return;
      const dy = Math.min(0, e.clientY - startY);
      el.querySelector('.lk-clock').style.transform = `translateY(${dy}px)`;
    });
    el.addEventListener('pointerup', () => {
      if (el.classList.contains('lock') && startY != null) { startY = null; showSignIn(); }
    });
    el.addEventListener('keydown', e => {
      if (el.classList.contains('lock')) { e.preventDefault(); showSignIn(); }
    });
    el.addEventListener('submit', e => {
      e.preventDefault();
      submit(el.querySelector('.si-field input').value);
    });
    el.addEventListener('input', e => {
      /* Windows Hello PINs sign in as soon as the right digits are typed. */
      if (e.target.matches('.si-field input') && Win.state.account.pinMode !== 'password' && e.target.value === Win.state.account.pin) submit(e.target.value);
    });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-si]');
      if (!b) return;
      const act = b.dataset.si;
      if (act === 'ok') showSignIn();
      if (act === 'options') el.querySelector('.si-options')?.classList.toggle('hidden');
      if (act === 'pin' || act === 'password') { Win.state.account.pinMode = act; Win.save(); showSignIn(); }
      if (act === 'forgot') {
        el.querySelector('.si-box').insertAdjacentHTML('beforeend', `<p class="si-hint">To reset your ${Win.state.account.pinMode === 'password' ? 'password' : 'PIN'}, verify your Microsoft account (${Win.esc(Win.state.account.email)}) on another device. Hint: the PIN for this PC is ${Win.esc(Win.state.account.pin)}.</p>`);
        b.remove();
      }
      if (act === 'power') {
        const r = b.getBoundingClientRect();
        const menu = Win.menu(r.left, r.top, [
          { label: 'Sleep', glyph: 'sleep', action: () => Win.Session.sleep() },
          { label: 'Shut down', glyph: 'power', action: () => Win.Session.shutdown() },
          { label: 'Restart', glyph: 'restart', action: () => Win.Session.restart() },
        ], { className: 't-dark' });
        menu.style.top = `${r.top - menu.offsetHeight - 6}px`;
        menu.style.left = `${r.right - menu.offsetWidth}px`;
      }
      if (act === 'network' || act === 'access') {
        const r = b.getBoundingClientRect();
        const items = act === 'network'
          ? Win.Network.scan().slice(0, 4).map(n => ({ label: `${n.ssid}${n.ssid === Win.state.network.connected ? '  (Connected)' : ''}`, glyph: `wifi${n.signal}`, action: () => {} }))
          : [['narrator', 'Narrator'], ['magnifier', 'Magnifier'], ['stickyKeys', 'Sticky keys']].map(([k, l]) => ({ label: l, checked: !!Win.state.settings[k], action: () => { Win.state.settings[k] = !Win.state.settings[k]; Win.save(); } }));
        const menu = Win.menu(r.left, r.top, items.length ? items : [{ label: 'Wi-Fi is turned off', disabled: true }], { className: 't-dark' });
        menu.style.top = `${r.top - menu.offsetHeight - 6}px`;
        menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
      }
    });
  }

  /* ----------------------------------------------------------- transitions */

  async function screen(message, { updates = false, minimum = 1600 } = {}) {
    const el = $('boot-screen');
    el.className = 'system-screen boot';
    el.innerHTML = `<div class="boot-msg">${dots()}<p>${Win.esc(message)}</p></div>`;
    show('boot-screen');
    if (updates) {
      for (let p = 0; p <= 100; p += Math.ceil(Math.random() * 9)) {
        el.innerHTML = `<div class="boot-msg">${dots()}<p>Working on updates ${Math.min(p, 100)}%<br>Don't turn off your PC. This will take a while.</p></div>`;
        await Win.wait(120);
      }
      el.innerHTML = `<div class="boot-msg">${dots()}<p>Working on updates 100%<br>Don't turn off your PC. This will take a while.</p></div>`;
      await Win.wait(400);
    }
    await Win.wait(minimum);
  }

  function closeAll() {
    Win.Flyout?.close();
    Win.closeMenu();
    [...Win.wm.windows].forEach(w => Win.wm.close(w, { force: true }));
  }

  /* An unsaved document blocks shutdown, as Windows does. */
  async function blockers() {
    const dirty = Win.wm.windows.filter(w => w.state.dirty || w.app.isDirty?.(w));
    if (!dirty.length) return true;
    return Win.confirm('Windows', `${dirty.length} app${dirty.length > 1 ? 's' : ''} ${dirty.length > 1 ? 'are' : 'is'} preventing this action. Close ${dirty.length > 1 ? 'them' : 'it'} anyway? Unsaved changes will be lost.`, { ok: 'End anyway', cancel: 'Cancel' });
  }

  function installUpdates() {
    const u = Win.state.update;
    u.pending.forEach(p => u.history.unshift({ id: p.id, title: p.title, date: Date.now(), kind: /Security Intelligence/.test(p.title) ? 'Definition' : 'Quality' }));
    u.pending = [];
    u.status = 'uptodate';
    u.lastChecked = Date.now();
    const m = Win.OS.build.match(/^(\d+)\.(\d+)$/);
    if (m) Win.OS.build = `${m[1]}.${Number(m[2]) + 47}`;
    u.build = Win.OS.build;
    Win.save();
  }

  async function boot({ updates = false } = {}) {
    const el = $('boot-screen');
    el.className = 'system-screen boot';
    el.innerHTML = `<div class="boot-logo-wrap">${logo(96)}</div>${dots()}`;
    show('boot-screen');
    await Win.wait(1800);
    if (updates) await screen('Working on updates', { updates: true, minimum: 300 });
    sess().signedIn = false;
    Win.Network.autoJoin();
    Win.save();
    showLock();
  }

  /* ------------------------------------------------------------------ UAC */

  /**
   * User Account Control on the secure desktop. Resolves true for Yes.
   *   Win.UAC('Windows Command Processor', () => …)
   */
  Win.UAC = (name, onYes, { publisher = 'Microsoft Windows', path = '' } = {}) => new Promise(resolve => {
    const el = Win.html(`<div class="uac t-dark" role="dialog" aria-modal="true" aria-label="User Account Control">
      <div class="uac-box">
        <header>User Account Control</header>
        <div class="uac-body">
          <h2>Do you want to allow this app to make changes to your device?</h2>
          <div class="uac-app">${Win.appIcon('windows', 32)}<b>${Win.esc(name)}</b></div>
          <p>Verified publisher: ${Win.esc(publisher)}${path ? `<br>File origin: ${Win.esc(path)}` : ''}</p>
          <button class="link uac-more">Show more details</button>
        </div>
        <footer><button class="btn accent" data-v="1">Yes</button><button class="btn" data-v="0">No</button></footer>
      </div></div>`);
    document.body.appendChild(el);
    const done = yes => { el.remove(); document.removeEventListener('keydown', key, true); resolve(yes); if (yes) onYes?.(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    document.addEventListener('keydown', key, true);
    el.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); });
    el.addEventListener('pointerdown', e => e.stopPropagation());
    setTimeout(() => el.querySelector('[data-v="0"]').focus(), 30);
  });

  /* --------------------------------------------------------------- public */

  Win.Session = {
    lock: () => showLock(),
    unlock,

    async signOut() {
      if (!(await blockers())) return;
      closeAll();
      await screen('Signing out', { minimum: 1200 });
      sess().signedIn = false;
      Win.save();
      showLock();
      showSignIn();
    },

    sleep() {
      Win.Flyout?.close();
      const el = $('off-screen');
      el.className = 'system-screen sleep';
      el.innerHTML = '<button class="sleep-wake" aria-label="Press any key to wake"></button>';
      show('off-screen');
      const wake = () => {
        el.removeEventListener('pointerdown', wake);
        document.removeEventListener('keydown', wake, true);
        Win.state.account.requireSignIn === 'Never' ? hideAll() : showLock();
      };
      setTimeout(() => { el.addEventListener('pointerdown', wake); document.addEventListener('keydown', wake, true); }, 400);
    },

    async restart() {
      if (!(await blockers())) return;
      const updates = Win.state.update.status === 'restart';
      closeAll();
      await screen(updates ? 'Working on updates' : 'Restarting', { updates, minimum: updates ? 600 : 1800 });
      if (updates) installUpdates();
      await boot({ updates: false });
    },

    async shutdown() {
      if (!(await blockers())) return;
      const updates = Win.state.update.status === 'restart';
      closeAll();
      await screen(updates ? 'Working on updates' : 'Shutting down', { updates, minimum: 1600 });
      if (updates) installUpdates();
      const el = $('off-screen');
      el.className = 'system-screen off';
      el.innerHTML = `<button class="off-power" aria-label="Press the power button">${Win.glyph('power', 28)}</button><p>Press the power button to turn on your PC</p>`;
      show('off-screen');
      el.querySelector('.off-power').addEventListener('click', () => boot(), { once: true });
      setTimeout(() => el.querySelector('.off-power').focus(), 30);
    },

    /** The classic Alt+F4 on the desktop. */
    shutdownDialog() {
      Win.dialog({
        title: 'Shut Down Windows',
        body: `<div class="sd-box">${logo(40)}<label class="field"><span>What do you want the computer to do?</span>${Win.select(['Switch user', 'Sign out', 'Sleep', 'Shut down', 'Restart'], 'Shut down', 'class="combo" data-sd')}</label></div>`,
        buttons: [{ label: 'OK', primary: true, value: box => box.querySelector('[data-sd]').value }, { label: 'Cancel', value: null }],
      }).then(choice => {
        if (choice === 'Sign out' || choice === 'Switch user') Win.Session.signOut();
        if (choice === 'Sleep') Win.Session.sleep();
        if (choice === 'Shut down') Win.Session.shutdown();
        if (choice === 'Restart') Win.Session.restart();
      });
    },

    init() {
      wireLock();
      const params = new URLSearchParams(location.search);
      if (params.has('boot')) { boot(); return; }
      if (params.has('lock') || params.has('login') || sess().locked || !sess().signedIn) { showLock(); if (params.has('login')) showSignIn(); return; }
      hideAll();
    },
  };
})(window.Win);
