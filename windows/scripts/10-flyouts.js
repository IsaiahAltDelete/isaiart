/* ===========================================================================
   Quick Settings, Notification Center with calendar, Widgets, the hidden
   icons tray and Task View.
   =========================================================================== */

(function (Win) {
  'use strict';

  const S = () => Win.state.settings;
  const N = () => Win.state.network;

  /* -------------------------------------------------------- Quick Settings */

  let page = 'main';
  let expandedNet = null;
  let joining = null;              // { ssid, stage: 'key'|'checking', error }

  function tile(id, glyph, label, on, { split = false, disabled = false, sub = '' } = {}) {
    return `<div class="qs-tile ${on ? 'on' : ''} ${split ? 'split' : ''} ${disabled ? 'disabled' : ''}">
      <div class="qs-btn">
        <button class="qs-main" data-qs="${id}" aria-pressed="${on}" aria-label="${Win.esc(label)}" ${disabled ? 'disabled' : ''}>${Win.glyph(glyph, 16)}</button>
        ${split ? `<button class="qs-arrow" data-qs-page="${id}" aria-label="Manage ${Win.esc(label)}">${Win.glyph('chevright', 12)}</button>` : ''}
      </div>
      <span class="qs-label">${Win.esc(sub || label)}</span>
    </div>`;
  }

  function mainPage() {
    const s = S();
    const net = Win.Network.current();
    const wifiOn = Win.Network.radioOn();
    const reason = Win.Network.reason();
    const wifiLabel = !wifiOn ? 'Wi-Fi' : net ? net.ssid : 'Not connected';
    const vol = s.muted ? 'mute' : s.volume < 34 ? 'vol1' : s.volume < 67 ? 'vol2' : 'vol3';
    const bt = Win.state.devices.find(d => d.connected && d.kind !== 'printer');
    return `
      <div class="qs-tiles">
        ${tile('wifi', wifiOn ? (reason && net ? 'wifiwarn' : 'wifi4') : 'wifioff', 'Wi-Fi', wifiOn, { split: true, sub: wifiLabel, disabled: N().airplane })}
        ${tile('bluetooth', 'bluetooth', 'Bluetooth', s.bluetooth, { split: true, sub: s.bluetooth && bt ? bt.name : 'Bluetooth' })}
        ${tile('airplane', 'airplane', 'Airplane mode', N().airplane)}
        ${tile('saver', 'saver', 'Energy saver', s.batterySaver)}
        ${tile('night', 'moon', 'Night light', s.nightLight)}
        ${tile('access', 'access', 'Accessibility', false, { split: true })}
        ${tile('hotspot', 'hotspot', 'Mobile hotspot', N().hotspot, { disabled: !net || !!reason })}
        ${tile('cast', 'cast', 'Cast', false, { split: true })}
        ${tile('project', 'project', 'Project', false, { split: true })}
      </div>
      <div class="qs-sliders">
        <div class="qs-slider">${Win.glyph('brightness', 18)}<input type="range" min="0" max="100" value="${s.brightness}" data-slider="brightness" aria-label="Brightness"><span class="qs-sval" hidden></span></div>
        <div class="qs-slider"><button class="icon-btn" data-qs="mute" aria-label="${s.muted ? 'Unmute' : 'Mute'}">${Win.glyph(vol, 18)}</button><input type="range" min="0" max="100" value="${s.volume}" data-slider="volume" aria-label="Volume"><button class="icon-btn qs-small" data-qs-page="sound" aria-label="Select a sound output">${Win.glyph('chevright', 12)}</button></div>
      </div>`;
  }

  function wifiPage() {
    const on = Win.Network.radioOn();
    const list = Win.Network.scan();
    const current = N().connected;
    const reason = Win.Network.reason();
    return `
      <div class="qs-head"><button class="icon-btn" data-qs-page="main" aria-label="Back">${Win.glyph('back', 16)}</button><h2>Wi-Fi</h2>${Win.toggle(on, 'data-qs-toggle="wifi"', 'Wi-Fi')}</div>
      <div class="qs-netlist" role="list">
        ${!on ? `<p class="qs-note">${N().airplane ? 'Airplane mode is on.' : 'Wi-Fi is turned off.'}</p>` : list.map(n => {
          const isCur = n.ssid === current;
          const open = expandedNet === n.ssid || (isCur && expandedNet == null);
          const join = joining?.ssid === n.ssid ? joining : null;
          const status = isCur ? (reason ? 'No internet, secured' : n.security === 'Open' ? 'Connected, open' : 'Connected, secured') : n.security === 'Open' ? 'Open' : 'Secured';
          return `<div class="qs-net ${open ? 'open' : ''} ${isCur ? 'cur' : ''}" role="listitem">
            <button class="qs-net-row" data-net="${Win.esc(n.ssid)}">
              <span class="qs-net-ico">${Win.glyph(`wifi${n.signal}`, 20)}${n.security !== 'Open' ? `<i>${Win.glyph('lock2', 10)}</i>` : ''}</span>
              <span class="qs-net-txt"><b>${Win.esc(n.ssid)}</b>${open || isCur ? `<span>${Win.esc(status)}</span>` : ''}</span>
            </button>
            ${open ? `<div class="qs-net-body">
              ${isCur ? `<button class="link" data-qs="props" data-ssid="${Win.esc(n.ssid)}">Properties</button><div class="qs-net-actions"><button class="btn" data-qs="disconnect">Disconnect</button></div>`
                : join?.stage === 'key' ? `<label class="qs-key"><span>Enter the network security key</span><input class="input" type="password" data-key autocomplete="off" aria-label="Network security key"></label>
                    ${join.error ? `<p class="qs-err">${Win.esc(join.error)}</p>` : ''}
                    <div class="qs-net-actions"><button class="btn accent" data-qs="join-next">Next</button><button class="btn" data-qs="join-cancel">Cancel</button></div>`
                : join?.stage === 'checking' ? `<p class="qs-checking"><span class="ring sm"></span>${n.known ? 'Connecting' : 'Checking network requirements'}</p>`
                : `<label class="check"><input type="checkbox" data-auto checked> Connect automatically</label><div class="qs-net-actions"><button class="btn accent" data-qs="connect" data-ssid="${Win.esc(n.ssid)}">Connect</button></div>`}
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="qs-foot-link"><button class="link" data-settings="wifi">More Wi-Fi settings</button></div>`;
  }

  function btPage() {
    const devices = Win.state.devices.filter(d => d.kind !== 'printer');
    return `
      <div class="qs-head"><button class="icon-btn" data-qs-page="main" aria-label="Back">${Win.glyph('back', 16)}</button><h2>Bluetooth</h2>${Win.toggle(S().bluetooth, 'data-qs-toggle="bluetooth"', 'Bluetooth')}</div>
      <div class="qs-netlist">${!S().bluetooth ? '<p class="qs-note">Bluetooth is turned off.</p>' : devices.map(d => `
        <div class="qs-net ${d.connected ? 'cur open' : ''}"><button class="qs-net-row" data-bt="${d.id}">
          <span class="qs-net-ico">${Win.glyph(d.kind === 'headphones' ? 'headphones' : d.kind, 20)}</span>
          <span class="qs-net-txt"><b>${Win.esc(d.name)}</b><span>${d.connected ? `Connected${d.battery ? `, ${d.battery}% battery` : ''}` : 'Paired'}</span></span></button></div>`).join('')}
      </div>
      <div class="qs-foot-link"><button class="link" data-settings="bluetooth">More Bluetooth settings</button></div>`;
  }

  function accessPage() {
    const s = S();
    const rows = [['magnifier', 'Magnifier'], ['colorFilters', 'Color filters'], ['narrator', 'Narrator'], ['stickyKeys', 'Sticky keys']];
    return `
      <div class="qs-head"><button class="icon-btn" data-qs-page="main" aria-label="Back">${Win.glyph('back', 16)}</button><h2>Accessibility</h2></div>
      <div class="qs-rows">${rows.map(([k, l]) => `<div class="qs-row"><span>${l}</span>${Win.toggle(!!s[k], `data-qs-toggle="${k}"`, l)}</div>`).join('')}</div>
      <div class="qs-foot-link"><button class="link" data-settings="accessibility">More accessibility settings</button></div>`;
  }

  function soundPage() {
    const outs = ['Speakers (Realtek(R) Audio)', 'Headphones (Galaxy Buds2 Pro)', 'Digital Audio (HDMI)'];
    return `
      <div class="qs-head"><button class="icon-btn" data-qs-page="main" aria-label="Back">${Win.glyph('back', 16)}</button><h2>Sound output</h2></div>
      <div class="qs-rows">${outs.map(o => `<button class="qs-choice ${S().output === o ? 'on' : ''}" data-output="${Win.esc(o)}" ${o.includes('Buds') && !Win.state.devices.find(d => d.id === 'buds')?.connected ? 'disabled' : ''}>${Win.glyph(o.includes('Head') ? 'headphones' : 'speaker', 16)}<span>${Win.esc(o)}</span></button>`).join('')}</div>
      <div class="qs-foot-link"><button class="link" data-settings="sound">More volume settings</button></div>`;
  }

  function castPage(kind) {
    return `<div class="qs-head"><button class="icon-btn" data-qs-page="main" aria-label="Back">${Win.glyph('back', 16)}</button><h2>${kind === 'cast' ? 'Cast' : 'Project'}</h2></div>
      ${kind === 'cast' ? `<p class="qs-checking"><span class="ring sm"></span>Searching for devices</p><p class="qs-note">Make sure your wireless display is on.</p>`
        : `<div class="qs-rows">${['PC screen only', 'Duplicate', 'Extend', 'Second screen only'].map((m, i) => `<button class="qs-choice ${i === 0 ? 'on' : ''}" data-project>${Win.glyph('project', 16)}<span>${m}</span></button>`).join('')}</div>`}`;
  }

  function renderQuick(el) {
    const pages = { main: mainPage, wifi: wifiPage, bluetooth: btPage, access: accessPage, sound: soundPage, cast: () => castPage('cast'), project: () => castPage('project') };
    el.innerHTML = `<div class="qs-panel">${(pages[page] || mainPage)()}</div>
      <footer class="qs-foot">
        <span class="qs-batt">${Win.glyph('battery', 18)}<i style="width:${Math.round(Win.Battery.level / 100 * 11)}px"></i>${Win.Battery.level}%</span>
        <span><button class="icon-btn" data-settings="home" aria-label="Edit quick settings">${Win.glyph('edit', 16)}</button><button class="icon-btn" data-settings="home" aria-label="All settings">${Win.glyph('gear', 16)}</button></span>
      </footer>`;
    Win.paintRanges(el);
    if (joining?.stage === 'key') el.querySelector('[data-key]')?.focus();
  }

  async function join(ssid, password, auto) {
    joining = { ssid, stage: 'checking' };
    Win.Flyout.refresh('quick');
    const result = await Win.Network.connect(ssid, password, { auto });
    if (result.ok) { joining = null; expandedNet = null; }
    else joining = { ssid, stage: Win.Network.lookup(ssid)?.security === 'Open' ? 'key' : 'key', error: result.error, auto };
    Win.Flyout.refresh('quick');
  }

  function wireQuick(el) {
    el.addEventListener('click', e => {
      const settings = e.target.closest('[data-settings]');
      if (settings) { Win.Flyout.close(); Win.wm.open('settings', { page: settings.dataset.settings }); return; }
      const pg = e.target.closest('[data-qs-page]');
      if (pg) { page = pg.dataset.qsPage; expandedNet = null; joining = null; renderQuick(el); return; }
      const net = e.target.closest('[data-net]');
      if (net) { expandedNet = expandedNet === net.dataset.net ? '' : net.dataset.net; if (joining?.ssid !== net.dataset.net) joining = null; renderQuick(el); return; }
      const out = e.target.closest('[data-output]');
      if (out) { S().output = out.dataset.output; Win.save(); return; }
      const bt = e.target.closest('[data-bt]');
      if (bt) {
        const d = Win.state.devices.find(x => x.id === bt.dataset.bt);
        d.connected = !d.connected;
        Win.save();
        return;
      }
      const act = e.target.closest('[data-qs]');
      if (!act) return;
      const s = S();
      switch (act.dataset.qs) {
        case 'wifi': Win.Network.setWifi(!Win.Network.radioOn()); break;
        case 'bluetooth': s.bluetooth = !s.bluetooth; Win.save(); break;
        case 'airplane': Win.Network.setAirplane(!N().airplane); break;
        case 'saver': s.batterySaver = !s.batterySaver; Win.save(); break;
        case 'night': s.nightLight = !s.nightLight; Win.save(); Win.applyDisplay(); break;
        case 'hotspot': N().hotspot = !N().hotspot; Win.save('network'); break;
        case 'access': page = 'access'; renderQuick(el); break;
        case 'cast': page = 'cast'; renderQuick(el); break;
        case 'project': page = 'project'; renderQuick(el); break;
        case 'mute': s.muted = !s.muted; Win.save('sound'); break;
        case 'disconnect': Win.Network.disconnect(); expandedNet = null; break;
        case 'props': Win.Flyout.close(); Win.wm.open('settings', { page: 'wifi-props', ssid: act.dataset.ssid }); break;
        case 'connect': {
          const ssid = act.dataset.ssid;
          const info = Win.Network.lookup(ssid);
          const auto = el.querySelector('[data-auto]')?.checked ?? true;
          if (info.security === 'Open' || Win.Network.profile(ssid)) join(ssid, '', auto);
          else { joining = { ssid, stage: 'key', auto }; renderQuick(el); }
          break;
        }
        case 'join-next': {
          const key = el.querySelector('[data-key]').value;
          if (key.length < 8) { joining.error = 'The password must be at least 8 characters.'; renderQuick(el); break; }
          join(joining.ssid, key, joining.auto ?? true);
          break;
        }
        case 'join-cancel': joining = null; renderQuick(el); break;
        default:
      }
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('[data-key]')) { e.preventDefault(); el.querySelector('[data-qs="join-next"]')?.click(); }
      if (e.key === 'Escape') Win.Flyout.close();
    });
    el.addEventListener('change', e => {
      const t = e.target.closest('[data-qs-toggle]');
      if (!t) return;
      const key = t.dataset.qsToggle;
      if (key === 'wifi') Win.Network.setWifi(t.checked);
      else { S()[key] = t.checked; Win.save(); }
    });
    el.addEventListener('input', e => {
      const slider = e.target.dataset.slider;
      if (!slider) return;
      S()[slider] = Number(e.target.value);
      if (slider === 'brightness') Win.applyDisplay();
      if (slider === 'volume') { S().muted = false; showVolume(); }
      quickSave();
    });
  }

  const quickSave = Win.debounce(() => Win.save('sound'), 200);

  Win.Flyout.register('quick', {
    label: 'Quick settings',
    className: 'fly-quick',
    render(el, opts = {}) {
      if (!opts.refresh) { page = opts.page || 'main'; expandedNet = null; joining = null; }
      if (opts.refresh && el.contains(document.activeElement) && document.activeElement.matches('input[type=range]')) return;
      renderQuick(el);
      if (!el.dataset.wired) { el.dataset.wired = '1'; wireQuick(el); }
    },
  });

  /* Volume OSD shown while dragging the slider or using media keys. */
  let osdTimer;
  function showVolume() {
    let osd = Win.$('#osd');
    if (!osd) { osd = Win.html('<div id="osd" class="osd"></div>'); document.body.appendChild(osd); }
    const v = S().muted ? 0 : S().volume;
    osd.innerHTML = `${Win.glyph(S().muted ? 'mute' : v < 34 ? 'vol1' : v < 67 ? 'vol2' : 'vol3', 16)}<div class="progress"><i style="width:${v}%"></i></div><b>${v}</b>`;
    osd.classList.add('show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osd.classList.remove('show'), 1600);
  }
  Win.showVolume = showVolume;

  /* --------------------------------------------- Notification Center + date */

  let calMonth = null;
  let calCollapsed = false;

  function renderNotify(el) {
    const list = Win.state.notifications;
    const today = new Date();
    const view = calMonth || new Date(today.getFullYear(), today.getMonth(), 1);
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const groups = {};
    list.forEach(n => (groups[n.app] ||= []).push(n));
    el.innerHTML = `
      <section class="nc-card nc-notes">
        <header><h2>Notifications</h2>
          <span>${S().dnd ? '' : list.length ? '<button class="btn sm subtle" data-nc="clear">Clear all</button>' : ''}
          <button class="icon-btn ${S().dnd ? 'on' : ''}" data-nc="dnd" aria-pressed="${S().dnd}" aria-label="Do not disturb" data-tip="Do not disturb">${Win.glyph(S().dnd ? 'belloff' : 'bell', 16)}</button></span></header>
        ${S().dnd ? '<p class="nc-empty">Do not disturb is on<br><small>You\'ll only see priority notifications and alarms.</small></p>'
          : list.length ? Object.entries(groups).map(([app, items]) => `<div class="nc-group"><div class="nc-app">${Win.esc(app)}<button class="icon-btn qs-small" data-nc="clear-app" data-app="${Win.esc(app)}" aria-label="Clear ${Win.esc(app)} notifications">${Win.glyph('close', 12)}</button></div>
              ${items.map(n => `<div class="nc-item"><span class="nc-ico">${n.appIcon ? Win.appIcon(n.appIcon, 20) : Win.glyph(n.icon || 'info', 16)}</span><div><b>${Win.esc(n.title)}</b>${n.body ? `<p>${Win.esc(n.body)}</p>` : ''}<small>${Win.esc(Win.formatTime(new Date(n.time)))}</small></div><button class="icon-btn qs-small" data-nc="dismiss" data-id="${n.id}" aria-label="Dismiss">${Win.glyph('close', 12)}</button></div>`).join('')}</div>`).join('')
            : '<p class="nc-empty">No new notifications</p>'}
      </section>
      <section class="nc-card nc-cal ${calCollapsed ? 'collapsed' : ''}">
        <header><button class="nc-date" data-nc="today">${Win.esc(today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))}</button>
          <button class="icon-btn" data-nc="collapse" aria-label="${calCollapsed ? 'Expand' : 'Collapse'} calendar">${Win.glyph(calCollapsed ? 'chevup' : 'chevdown', 14)}</button></header>
        ${calCollapsed ? '' : `<div class="cal-nav"><b>${Win.esc(view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))}</b><span>
            <button class="icon-btn" data-nc="prev" aria-label="Previous month">${Win.glyph('chevup', 14)}</button><button class="icon-btn" data-nc="next" aria-label="Next month">${Win.glyph('chevdown', 14)}</button></span></div>
          <div class="cal-grid" role="grid">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => `<span class="cal-dow">${d}</span>`).join('')}
            ${days.map(d => `<button class="cal-day ${d.getMonth() !== view.getMonth() ? 'other' : ''} ${d.toDateString() === today.toDateString() ? 'today' : ''}" aria-label="${Win.esc(d.toDateString())}">${d.getDate()}</button>`).join('')}</div>`}
        <footer class="nc-focus"><span><button class="icon-btn" data-nc="focus-minus" aria-label="Decrease time">−</button><b>${focusMinutes} mins</b><button class="icon-btn" data-nc="focus-plus" aria-label="Increase time">+</button></span>
          <button class="btn sm" data-nc="focus">${Win.glyph('play', 12)} Focus</button></footer>
      </section>`;
  }

  let focusMinutes = 30;

  Win.Flyout.register('notify', {
    label: 'Notification center',
    className: 'fly-notify',
    render(el, opts = {}) {
      if (!opts.refresh) calMonth = null;
      renderNotify(el);
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-nc]');
        if (!b) return;
        const today = new Date();
        const view = calMonth || new Date(today.getFullYear(), today.getMonth(), 1);
        switch (b.dataset.nc) {
          case 'clear': Win.state.notifications = []; Win.save('notifications'); break;
          case 'clear-app': Win.state.notifications = Win.state.notifications.filter(n => n.app !== b.dataset.app); Win.save('notifications'); break;
          case 'dismiss': Win.state.notifications = Win.state.notifications.filter(n => n.id !== b.dataset.id); Win.save('notifications'); break;
          case 'dnd': S().dnd = !S().dnd; Win.save(); break;
          case 'prev': calMonth = new Date(view.getFullYear(), view.getMonth() - 1, 1); break;
          case 'next': calMonth = new Date(view.getFullYear(), view.getMonth() + 1, 1); break;
          case 'today': calMonth = null; break;
          case 'collapse': calCollapsed = !calCollapsed; break;
          case 'focus-minus': focusMinutes = Math.max(5, focusMinutes - (focusMinutes > 30 ? 15 : 5)); break;
          case 'focus-plus': focusMinutes = Math.min(240, focusMinutes + (focusMinutes >= 30 ? 15 : 5)); break;
          case 'focus': Win.Flyout.close(); Win.wm.open('clock', { page: 'focus', minutes: focusMinutes }); return;
          default:
        }
        renderNotify(el);
      });
    },
  });

  /* --------------------------------------------------------------- widgets */

  Win.Flyout.register('widgets', {
    label: 'Widgets',
    className: 'fly-widgets',
    render(el) {
      const hour = new Date().getHours();
      const forecast = [['Now', 68, 'sun'], ['2 PM', 71, 'sun'], ['4 PM', 72, 'cloud'], ['6 PM', 67, 'cloud'], ['8 PM', 61, 'moon']];
      el.innerHTML = `
        <header class="wd-head"><b>${Win.esc(Win.formatTime())}</b><label class="sm-search">${Win.glyph('search', 16)}<input type="search" placeholder="Search the web" aria-label="Search the web"></label></header>
        <div class="wd-grid">
          <article class="wd-card wd-weather"><h3>${Win.glyph('sun', 14)} Weather</h3><p class="wd-loc">Orlando, FL</p>
            <div class="wd-now">${Win.appIcon('weather', 48)}<b>68°</b><span>°F</span><div><b>Mostly sunny</b><small>Feels like 70° · Humidity 54%</small></div></div>
            <div class="wd-fc">${forecast.map(([t, d, g]) => `<span><small>${t}</small>${Win.glyph(g, 18)}<b>${d}°</b></span>`).join('')}</div></article>
          <article class="wd-card"><h3>${Win.glyph('calendar', 14)} Calendar</h3><p class="wd-big">${Win.esc(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))}</p>
            <ul class="wd-list"><li><b>${hour < 10 ? '10:00 AM' : '4:30 PM'}</b> Project sync</li><li><b>7:00 PM</b> Dinner with Sam</li></ul></article>
          <article class="wd-card"><h3>${Win.glyph('sparkle', 14)} Tips</h3><p class="wd-big">Snap windows side by side</p><p class="muted">Drag a window to the edge of the screen, or hover over the maximize button to pick a layout.</p></article>
          <article class="wd-card"><h3>${Win.glyph('picture', 14)} Photos</h3><div class="wd-photo" style="background-image:url('${Win.Art?.url?.('mountain') || Win.Wallpapers.url('dune')}')"></div><p class="muted">Mountain trail · Pictures</p></article>
          <article class="wd-card"><h3>${Win.glyph('check', 14)} To Do</h3><ul class="wd-list check">${['Renew car registration', 'Order printer ink', 'Back up the Projects folder'].map(t => `<li><input type="checkbox" aria-label="${t}"> ${t}</li>`).join('')}</ul></article>
          <article class="wd-card"><h3>${Win.glyph('data', 14)} Traffic</h3><p class="wd-big">Light traffic</p><p class="muted">I-4 E · 18 min to Downtown</p></article>
        </div>`;
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.matches('input[type=search]') && e.target.value.trim()) { Win.Flyout.close(); Win.wm.open('edge', { url: e.target.value.trim() }); }
        if (e.key === 'Escape') Win.Flyout.close();
      });
    },
  });

  /* ---------------------------------------------------------- hidden icons */

  Win.Flyout.register('tray', {
    label: 'Hidden icons',
    className: 'fly-tray',
    render(el) {
      const items = [
        ['onedrive', 'OneDrive - Personal\nUp to date', () => Win.wm.open('explorer', { path: 'onedrive' })],
        ['shield', 'Windows Security - No actions needed.', () => Win.wm.open('settings', { page: 'security' })],
        ['bluetooth', 'Bluetooth Devices', () => Win.wm.open('settings', { page: 'bluetooth' })],
        ['printer', 'HP Smart', () => Win.wm.open('settings', { page: 'printers' })],
        ['usb', 'Safely Remove Hardware and Eject Media', null],
        ['speaker', 'Realtek Audio Console', () => Win.wm.open('settings', { page: 'sound' })],
      ];
      el.innerHTML = `<div class="tray-grid">${items.map(([g, tip], i) => `<button class="icon-btn" data-i="${i}" data-tip="${Win.esc(tip)}" aria-label="${Win.esc(tip.split('\n')[0])}">${g === 'onedrive' ? Win.appIcon('onedrive', 18) : Win.glyph(g, 16)}</button>`).join('')}</div>`;
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-i]');
        if (!b) return;
        const [, , action] = items[Number(b.dataset.i)];
        if (action) { Win.Flyout.close(); action(); return; }
        const usb = Win.FS.get('e');
        const r = b.getBoundingClientRect();
        Win.menu(r.left, r.top - 60, usb && !usb.ejected
          ? [{ label: `Eject ${usb.name}`, glyph: 'usb', action: () => { usb.ejected = true; Win.save('fs'); Win.Flyout.close(); Win.toast({ app: 'Windows', glyph: 'usb', title: 'Safe To Remove Hardware', body: `The '${usb.name}' device can now be safely removed from the computer.`, transient: true }); } }]
          : [{ label: 'No devices to eject', disabled: true }]);
      });
    },
  });

  /* ------------------------------------------------------------- Task View */

  Win.Flyout.register('taskview', {
    label: 'Task View',
    className: 'fly-taskview',
    render(el) {
      const wins = Win.wm.windows.slice().sort((a, b) => b.z - a.z);
      el.innerHTML = `<div class="tv-grid">${wins.length ? wins.map(w => `<div class="tv-item" data-win="${w.id}" tabindex="0" role="button" aria-label="${Win.esc(w.title)}">
          <div class="tv-head">${Win.appIcon(w.app.icon, 16)}<span>${Win.esc(w.title)}</span><button class="tbp-x" data-close="${w.id}" aria-label="Close">${Win.glyph('close', 12)}</button></div>
          <div class="tv-thumb" data-clone="${w.id}"></div></div>`).join('') : '<p class="tv-empty">No open windows</p>'}</div>
        <div class="tv-desks"><div class="tv-desk on"><div class="tv-desk-thumb" style="background:${Win.Wallpapers.css(S().wallpaper, S().wallpaperFit)}"></div><span>Desktop 1</span></div></div>`;
      /* Thumbnails share the space above the desktops strip, like the real grid. */
      const cols = wins.length <= 2 ? Math.max(1, wins.length) : Math.min(4, Math.ceil(Math.sqrt(wins.length * 16 / 9)));
      const rows = Math.ceil(wins.length / cols);
      const boxW = Math.min(640, (innerWidth - 80 - 24 * (cols - 1)) / cols - 12);
      const boxH = Math.min(480, (innerHeight - 48 - 140 - 80 - 24 * (rows - 1)) / rows - 40);
      Win.$$('[data-clone]', el).forEach(slot => {
        const win = Win.wm.windows.find(w => w.id === slot.dataset.clone);
        const r = { width: parseFloat(win.el.style.width), height: parseFloat(win.el.style.height) };
        const scale = Math.min(boxW / r.width, boxH / r.height, 1);
        slot.previousElementSibling.style.maxWidth = `${r.width * scale}px`;
        const copy = win.el.cloneNode(true);
        copy.classList.remove('minimized', 'opening', 'closing');
        Object.assign(copy.style, { left: 0, top: 0, position: 'absolute', width: `${r.width}px`, height: `${r.height}px`, transform: `scale(${scale})`, transformOrigin: '0 0', visibility: 'visible', opacity: 1, zIndex: 0 });
        copy.inert = true;
        slot.style.width = `${r.width * scale}px`;
        slot.style.height = `${r.height * scale}px`;
        slot.appendChild(copy);
      });
      el.onclick = e => {
        const close = e.target.closest('[data-close]');
        if (close) { Win.wm.close(Win.wm.windows.find(w => w.id === close.dataset.close)); setTimeout(() => Win.Flyout.refresh('taskview'), 170); return; }
        const item = e.target.closest('[data-win]');
        Win.Flyout.close();
        if (item) Win.wm.focus(Win.wm.windows.find(w => w.id === item.dataset.win));
      };
      el.onkeydown = e => {
        if (e.key === 'Escape') Win.Flyout.close();
        if (e.key === 'Enter' && e.target.matches('[data-win]')) e.target.click();
      };
    },
    onOpen(el) { el.querySelector('.tv-item')?.focus(); },
  });

  /* Keep open flyouts current when state changes underneath them. */
  Win.on('state', () => { ['quick', 'notify'].forEach(name => Win.Flyout.refresh(name)); });
})(window.Win);
