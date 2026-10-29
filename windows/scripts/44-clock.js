/* ===========================================================================
   Clock: Focus sessions, Timer, Alarm, Stopwatch and World clock.

   Alarms, timers and focus sessions are checked by one page-wide ticker, so
   they fire whether or not the Clock window is open (as on Windows, where
   Clock notifications are delivered while the PC is awake). The stopwatch
   uses performance.now() while the page is alive.
   =========================================================================== */

(function (Win) {
  'use strict';

  const MIN = 60000;

  Win.DefaultState.clock = {
    page: 'focus',
    alarms: [
      { id: 'al-1', time: '07:00', name: 'Good morning', days: [1, 2, 3, 4, 5], on: false, sound: 'Chimes', snooze: 10 },
    ],
    timers: [
      { id: 'tm-1', name: '', duration: 1 * MIN, remaining: 1 * MIN, running: false, endsAt: 0 },
      { id: 'tm-3', name: '', duration: 3 * MIN, remaining: 3 * MIN, running: false, endsAt: 0 },
      { id: 'tm-5', name: '', duration: 5 * MIN, remaining: 5 * MIN, running: false, endsAt: 0 },
      { id: 'tm-10', name: '', duration: 10 * MIN, remaining: 10 * MIN, running: false, endsAt: 0 },
    ],
    cities: ['Europe/London', 'Asia/Tokyo', 'America/Los_Angeles'],
    focus: { goal: 60, length: 30, skipBreaks: false, dnd: true, history: {}, session: null },
    stopwatch: { elapsed: 0, running: false, startedAt: 0, laps: [] },
  };

  const CITIES = [
    ['Honolulu', 'Pacific/Honolulu'], ['Anchorage', 'America/Anchorage'], ['Los Angeles', 'America/Los_Angeles'], ['Seattle', 'America/Los_Angeles'],
    ['Denver', 'America/Denver'], ['Phoenix', 'America/Phoenix'], ['Chicago', 'America/Chicago'], ['Mexico City', 'America/Mexico_City'],
    ['New York', 'America/New_York'], ['Toronto', 'America/Toronto'], ['Bogotá', 'America/Bogota'], ['São Paulo', 'America/Sao_Paulo'],
    ['Buenos Aires', 'America/Argentina/Buenos_Aires'], ['Reykjavík', 'Atlantic/Reykjavik'], ['London', 'Europe/London'], ['Dublin', 'Europe/Dublin'],
    ['Lisbon', 'Europe/Lisbon'], ['Paris', 'Europe/Paris'], ['Berlin', 'Europe/Berlin'], ['Madrid', 'Europe/Madrid'], ['Rome', 'Europe/Rome'],
    ['Stockholm', 'Europe/Stockholm'], ['Athens', 'Europe/Athens'], ['Cairo', 'Africa/Cairo'], ['Johannesburg', 'Africa/Johannesburg'],
    ['Lagos', 'Africa/Lagos'], ['Nairobi', 'Africa/Nairobi'], ['Istanbul', 'Europe/Istanbul'], ['Moscow', 'Europe/Moscow'], ['Dubai', 'Asia/Dubai'],
    ['Karachi', 'Asia/Karachi'], ['New Delhi', 'Asia/Kolkata'], ['Dhaka', 'Asia/Dhaka'], ['Bangkok', 'Asia/Bangkok'], ['Singapore', 'Asia/Singapore'],
    ['Beijing', 'Asia/Shanghai'], ['Hong Kong', 'Asia/Hong_Kong'], ['Manila', 'Asia/Manila'], ['Seoul', 'Asia/Seoul'], ['Tokyo', 'Asia/Tokyo'],
    ['Sydney', 'Australia/Sydney'], ['Melbourne', 'Australia/Melbourne'], ['Perth', 'Australia/Perth'], ['Auckland', 'Pacific/Auckland'],
  ];
  const cityName = zone => CITIES.find(c => c[1] === zone)?.[0] || zone.split('/').pop().replace(/_/g, ' ');

  const SOUNDS = ['Chimes', 'Xylophone', 'Chords', 'Tap', 'Jingle', 'Transition', 'Descending', 'Bounce', 'Echo', 'Ascending'];
  const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const C = () => Win.state?.clock;
  const two = n => String(n).padStart(2, '0');
  const todayKey = (d = new Date()) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  const h24 = () => !!Win.state?.settings?.time24;

  function hms(ms, { cs = false } = {}) {
    const total = Math.max(0, ms);
    const s = Math.floor(total / 1000);
    const base = `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
    return cs ? `${base}.${two(Math.floor((total % 1000) / 10))}` : base;
  }

  function alarmLabel(time) {
    const [h, m] = time.split(':').map(Number);
    if (h24()) return { main: `${two(h)}:${two(m)}`, ampm: '' };
    return { main: `${h % 12 || 12}:${two(m)}`, ampm: h < 12 ? 'AM' : 'PM' };
  }

  /* -------------------------------------------------------------- sounds */

  let audio = null;
  function chime(kind = 'alarm') {
    if (Win.state?.settings?.muted) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const now = audio.currentTime;
      const notes = kind === 'focus' ? [523, 659, 784] : [880, 660, 880, 660];
      notes.forEach((f, i) => {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + i * 0.22);
        g.gain.exponentialRampToValueAtTime(0.12 * ((Win.state.settings.volume ?? 60) / 100), now + i * 0.22 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.2);
        o.connect(g).connect(audio.destination);
        o.start(now + i * 0.22);
        o.stop(now + i * 0.22 + 0.22);
      });
    } catch { /* audio unavailable */ }
    Win.emit('sound', kind);
  }

  /** Notification with action buttons; Win.toast only supports a single action. */
  function notify({ title, body, buttons = [] }) {
    Win.state.notifications.unshift({ id: Win.uid('n'), app: 'Clock', icon: 'clock', appIcon: 'clock', title, body, time: Date.now() });
    Win.state.notifications = Win.state.notifications.slice(0, 30);
    Win.save('notifications');
    chime(buttons.length ? 'alarm' : 'focus');
    const host = Win.$('#toasts');
    if (!host) return;
    const el = Win.html(`<div class="toast clk-toast" role="alertdialog" aria-label="${Win.esc(title)}">
      <div class="toast-head"><span class="toast-app">${Win.appIcon('clock', 16)}Clock</span><button class="toast-x" aria-label="Dismiss">${Win.glyph('close', 12)}</button></div>
      <div class="toast-title">${Win.esc(title)}</div>${body ? `<div class="toast-body">${Win.esc(body)}</div>` : ''}
      ${buttons.length ? `<div class="clk-toast-btns">${buttons.map((b, i) => `<button class="btn ${i === buttons.length - 1 ? 'accent' : ''}" data-i="${i}">${Win.esc(b.label)}</button>`).join('')}</div>` : ''}</div>`);
    const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    el.querySelector('.toast-x').addEventListener('click', dismiss);
    el.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { buttons[Number(b.dataset.i)].action?.(); dismiss(); }));
    host.appendChild(el);
    while (host.children.length > 3) host.firstElementChild.remove();
    if (!buttons.length) setTimeout(dismiss, 8000);
  }

  /* ------------------------------------------------------------- ticker */

  const snoozed = new Map();     // alarm id -> epoch ms
  const fired = new Map();       // alarm id -> 'YYYY-MM-DD HH:MM'

  function fireAlarm(a) {
    const label = alarmLabel(a.time);
    const snooze = () => { if (a.snooze) snoozed.set(a.id, Date.now() + a.snooze * MIN); };
    notify({
      title: a.name || 'Alarm', body: `${label.main} ${label.ampm}`.trim(),
      buttons: a.snooze ? [{ label: `Snooze (${a.snooze} min)`, action: snooze }, { label: 'Dismiss' }] : [{ label: 'Dismiss' }],
    });
  }

  function tick() {
    const c = C();
    if (!c) return;
    const now = new Date();
    let changed = false;
    c.timers.forEach(t => {
      if (t.running && Date.now() >= t.endsAt) {
        t.running = false;
        t.remaining = t.duration;
        t.endsAt = 0;
        changed = true;
        notify({ title: t.name || 'Timer', body: 'Time’s up!', buttons: [{ label: 'Restart', action: () => { t.running = true; t.endsAt = Date.now() + t.duration; Win.save('clock'); } }, { label: 'Dismiss' }] });
      }
    });
    const hm = `${two(now.getHours())}:${two(now.getMinutes())}`;
    const stamp = `${todayKey(now)} ${hm}`;
    c.alarms.forEach(a => {
      if (!a.on) return;
      if (a.time === hm && fired.get(a.id) !== stamp && (!a.days.length || a.days.includes(now.getDay()))) {
        fired.set(a.id, stamp);
        if (!a.days.length) { a.on = false; changed = true; }
        fireAlarm(a);
      }
      const sn = snoozed.get(a.id);
      if (sn && Date.now() >= sn) { snoozed.delete(a.id); fireAlarm(a); }
    });
    const f = c.focus.session;
    if (f && !f.paused && Date.now() >= f.endsAt) {
      endFocus(true);
      changed = true;
    }
    if (changed) Win.save('clock');
  }
  setInterval(tick, 1000);

  /* -------------------------------------------------------------- focus */

  function startFocus(minutes) {
    const f = C().focus;
    const total = Math.max(5, Math.min(240, Math.round(minutes || f.length))) * MIN;
    f.session = { total, endsAt: Date.now() + total, paused: false, remaining: total, startedAt: Date.now(), dndBefore: !!Win.state.settings.dnd };
    if (f.dnd !== false) Win.state.settings.dnd = true;
    Win.save('settings');
    Win.save('clock');
  }

  function endFocus(completed) {
    const f = C().focus;
    const s = f.session;
    if (!s) return;
    const spent = s.paused ? s.total - s.remaining : s.total - Math.max(0, s.endsAt - Date.now());
    const minutes = Math.round(spent / MIN);
    f.history[todayKey()] = (f.history[todayKey()] || 0) + minutes;
    f.session = null;
    if (f.dnd !== false) Win.state.settings.dnd = s.dndBefore;
    Win.save('settings');
    Win.save('clock');
    if (completed) notify({ title: 'Focus session complete', body: `Nice work. You focused for ${minutes} minute${minutes === 1 ? '' : 's'}.` });
  }

  function streak() {
    const f = C().focus;
    let n = 0;
    const d = new Date();
    if (!(f.history[todayKey(d)] >= f.goal)) d.setDate(d.getDate() - 1);
    while ((f.history[todayKey(d)] || 0) >= f.goal) { n += 1; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* ---------------------------------------------------------- stopwatch */

  const sw = { base: 0, start: null, laps: [], loaded: false };
  function swLoad() {
    if (sw.loaded || !C()) return;
    sw.loaded = true;
    const s = C().stopwatch;
    sw.base = s.elapsed || 0;
    sw.laps = s.laps || [];
    if (s.running) { sw.base += Date.now() - s.startedAt; sw.start = performance.now(); }
  }
  const swElapsed = () => sw.base + (sw.start != null ? performance.now() - sw.start : 0);
  function swSave() {
    C().stopwatch = { elapsed: sw.start != null ? sw.base : swElapsed(), running: sw.start != null, startedAt: sw.start != null ? Date.now() - (performance.now() - sw.start) : 0, laps: sw.laps };
    Win.save('clock');
  }

  /* ------------------------------------------------------------- world */

  function zoneInfo(zone, now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
    const get = type => Number(parts.find(p => p.type === type)?.value);
    const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
    const localUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
    const diff = Math.round((asUTC - localUTC) / MIN);
    const dayDiff = Math.round((Date.UTC(get('year'), get('month') - 1, get('day')) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: !h24() }).format(now);
    const hrs = Math.abs(diff) / 60;
    const amount = Number.isInteger(hrs) ? `${hrs} hr` : `${Math.floor(hrs)} hr ${Math.abs(diff) % 60} min`;
    const rel = diff === 0 ? 'Same time' : `${amount} ${diff > 0 ? 'ahead' : 'behind'}`;
    return { time, day: dayDiff === 0 ? 'Today' : dayDiff > 0 ? 'Tomorrow' : 'Yesterday', rel, hour: get('hour') };
  }

  /* ------------------------------------------------------------- window */

  const NAV = [['focus', 'Focus sessions', 'focus'], ['timer', 'Timer', 'timer'], ['alarm', 'Alarm', 'alarm'], ['stopwatch', 'Stopwatch', 'stopwatch'], ['world', 'World clock', 'world']];

  const ring = (fraction, size = 200, stroke = 6) => {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    return `<svg class="clk-ring" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="bg"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Win.clamp(fraction, 0, 1))}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  };

  function create(win, args = {}) {
    swLoad();
    const st = win.state;
    st.page = args.page || C().page || 'focus';
    st.edit = false;
    st.navOpen = true;
    if (args.page === 'focus' && args.minutes && !C().focus.session) startFocus(args.minutes);

    win.el.classList.add('clk-win');
    win.body.innerHTML = `<div class="clk nav-open">
      <nav class="clk-nav" aria-label="Clock">
        <button class="clk-ham" aria-label="Collapse navigation">${Win.glyph('list', 16)}</button>
        ${NAV.map(([id, label, g]) => `<button class="clk-nav-btn" data-page="${id}" title="${label}">${Win.glyph(g, 16)}<span>${label}</span></button>`).join('')}
        <span class="clk-fill"></span>
        <button class="clk-nav-btn" data-page="settings" title="Settings">${Win.glyph('gear', 16)}<span>Settings</span></button>
      </nav>
      <main class="clk-main" tabindex="-1"></main>
    </div>`;
    const root = win.body.querySelector('.clk');
    const main = root.querySelector('.clk-main');

    const fab = label => `<div class="clk-fab">${st.page !== 'focus' && st.page !== 'stopwatch' && st.page !== 'settings' ? `<button class="clk-round" data-act="edit" aria-label="${st.edit ? 'Done' : 'Edit'} ${label}" title="${st.edit ? 'Done' : 'Edit'}">${Win.glyph(st.edit ? 'check' : 'edit', 16)}</button><button class="clk-round accent" data-act="add" aria-label="Add new ${label}" title="Add new ${label}">${Win.glyph('plus', 16)}</button>` : ''}</div>`;

    /* --------------------------------------------------------- pages */

    const focusPage = () => {
      const f = C().focus;
      const s = f.session;
      const done = f.history[todayKey()] || 0;
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yesterday = f.history[todayKey(y)] || 0;
      const breaks = f.skipBreaks ? 0 : Math.floor(f.length / 45);
      const progress = `<section class="clk-card clk-progress"><header><h2>Daily progress</h2></header>
        <div class="clk-prog-row"><div><small>Yesterday</small><b>${yesterday}</b><small>minutes</small></div>
        <div class="clk-prog-ring">${ring(done / f.goal, 140, 8)}<span><small>Daily goal</small><b>${f.goal >= 60 && f.goal % 60 === 0 ? f.goal / 60 : f.goal}</b><small>${f.goal >= 60 && f.goal % 60 === 0 ? `hour${f.goal === 60 ? '' : 's'}` : 'minutes'}</small></span></div>
        <div><small>Streak</small><b>${streak()}</b><small>days</small></div></div>
        <p class="clk-muted">Completed: ${done} minute${done === 1 ? '' : 's'}</p></section>`;
      if (s) {
        const left = s.paused ? s.remaining : Math.max(0, s.endsAt - Date.now());
        return `<h1 class="clk-h1">Focus sessions</h1><div class="clk-focus-grid"><section class="clk-card clk-focus-run">
          <div class="clk-big-ring">${ring(left / s.total, 240, 10)}<span><b data-live="focus">${Math.ceil(left / MIN)}</b><small>min</small></span></div>
          <p class="clk-muted">Focus period 1 of 1</p>
          <div class="clk-row"><button class="clk-round accent" data-act="focus-pause" aria-label="${s.paused ? 'Resume' : 'Pause'} focus session">${Win.glyph(s.paused ? 'play' : 'pause', 16)}</button><button class="clk-round" data-act="focus-stop" aria-label="End focus session">${Win.glyph('stop', 16)}</button></div>
          </section>${progress}</div>`;
      }
      return `<h1 class="clk-h1">Focus sessions</h1><div class="clk-focus-grid"><section class="clk-card clk-focus-start"><h2>Get ready to focus</h2>
        <p class="clk-muted">We’ll turn on do not disturb, and you’ll get a break notification.</p>
        <div class="clk-spin" role="group" aria-label="Focus length"><button class="clk-spin-b" data-act="focus-up" aria-label="Increase time">${Win.glyph('chevup', 14)}</button>
          <span><b>${f.length}</b><small>mins</small></span><button class="clk-spin-b" data-act="focus-down" aria-label="Decrease time">${Win.glyph('chevdown', 14)}</button></div>
        <p class="clk-muted">${breaks ? `You’ll have ${breaks} break${breaks === 1 ? '' : 's'}.` : 'You’ll have no breaks.'}</p>
        <label class="check"><input type="checkbox" data-set="skipBreaks" ${f.skipBreaks ? 'checked' : ''}> Skip breaks</label>
        <button class="btn accent clk-start" data-act="focus-start">${Win.glyph('play', 14)} Start focus session</button></section>${progress}</div>`;
    };

    const timerPage = () => {
      const list = C().timers;
      return `<h1 class="clk-h1">Timer</h1><div class="clk-grid">${list.map(t => {
        const left = t.running ? Math.max(0, t.endsAt - Date.now()) : t.remaining;
        const name = t.name || (t.duration % 3600000 === 0 ? `${t.duration / 3600000} hr` : t.duration % MIN === 0 ? `${t.duration / MIN} min` : hms(t.duration));
        return `<section class="clk-card clk-timer ${t.running ? 'running' : ''}" data-timer="${t.id}"><header><h2>${Win.esc(name)}</h2>${st.edit ? `<button class="icon-btn" data-act="timer-del" data-id="${t.id}" aria-label="Delete timer">${Win.glyph('trash', 14)}</button>` : ''}</header>
          <div class="clk-mid-ring">${ring(left / t.duration, 180, 6)}<span data-live="timer" data-id="${t.id}">${hms(left)}</span></div>
          <div class="clk-row"><button class="clk-round accent" data-act="timer-toggle" data-id="${t.id}" aria-label="${t.running ? 'Pause' : 'Start'}">${Win.glyph(t.running ? 'pause' : 'play', 16)}</button><button class="clk-round" data-act="timer-reset" data-id="${t.id}" aria-label="Reset" ${t.running || t.remaining !== t.duration ? '' : 'disabled'}>${Win.glyph('refresh', 16)}</button></div></section>`;
      }).join('') || '<p class="clk-muted">Select + to add a timer.</p>'}</div>${fab('timer')}`;
    };

    const alarmPage = () => {
      const list = C().alarms.slice().sort((a, b) => a.time.localeCompare(b.time));
      const until = a => {
        const now = new Date();
        const [h, m] = a.time.split(':').map(Number);
        for (let i = 0; i < 8; i += 1) {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m);
          if (d > now && (!a.days.length || a.days.includes(d.getDay()))) {
            const mins = Math.round((d - now) / MIN);
            const hh = Math.floor(mins / 60);
            const days = Math.floor(hh / 24);
            return days ? `in ${days} day${days === 1 ? '' : 's'}, ${hh % 24} hour${hh % 24 === 1 ? '' : 's'}` : `in ${hh} hour${hh === 1 ? '' : 's'}, ${mins % 60} minute${mins % 60 === 1 ? '' : 's'}`;
          }
        }
        return '';
      };
      return `<h1 class="clk-h1">Alarm</h1><div class="clk-grid">${list.map(a => {
        const l = alarmLabel(a.time);
        return `<section class="clk-card clk-alarm ${a.on ? 'on' : ''}" data-alarm="${a.id}" tabindex="0" role="button" aria-label="Edit alarm ${Win.esc(a.name)} ${l.main} ${l.ampm}">
          <header><span class="clk-alarm-time">${l.main}<small>${l.ampm}</small></span>${st.edit ? `<button class="icon-btn" data-act="alarm-del" data-id="${a.id}" aria-label="Delete alarm">${Win.glyph('trash', 14)}</button>` : Win.toggle(a.on, `data-alarm-toggle="${a.id}"`, `Turn alarm ${a.on ? 'off' : 'on'}`)}</header>
          <p class="clk-muted">${a.on ? `${Win.glyph('bell', 12)} ${until(a)}` : '&nbsp;'}</p>
          <p class="clk-alarm-name">${Win.glyph('alarm', 14)} ${Win.esc(a.name || 'Alarm')}</p>
          <div class="clk-days">${DAY_LETTERS.map((d, i) => `<span class="${a.days.includes(i) ? 'on' : ''}" title="${DAY_NAMES[i]}">${d}</span>`).join('')}${a.days.length ? '' : '<em>Only once</em>'}</div></section>`;
      }).join('') || '<p class="clk-muted">No alarms. Select + to add one.</p>'}</div>${fab('alarm')}`;
    };

    const stopwatchPage = () => {
      const running = sw.start != null;
      const laps = sw.laps;
      const splits = laps.map((total, i) => total - (laps[i - 1] || 0));
      const best = splits.length > 1 ? Math.min(...splits) : null;
      const worst = splits.length > 1 ? Math.max(...splits) : null;
      return `<h1 class="clk-h1">Stopwatch</h1><section class="clk-sw">
        <div class="clk-sw-time" data-live="sw" role="timer" aria-live="off">${hms(swElapsed(), { cs: true })}</div>
        <div class="clk-sw-labels"><span>hr</span><span>min</span><span>sec</span></div>
        <div class="clk-row"><button class="clk-round accent lg" data-act="sw-toggle" aria-label="${running ? 'Pause' : 'Start'}">${Win.glyph(running ? 'pause' : 'play', 18)}</button>
          <button class="clk-round lg" data-act="sw-lap" aria-label="Lap" ${running ? '' : 'disabled'}>${Win.glyph('flag', 18)}</button>
          <button class="clk-round lg" data-act="sw-reset" aria-label="Reset" ${swElapsed() > 0 && !running ? '' : 'disabled'}>${Win.glyph('refresh', 18)}</button></div>
        ${laps.length ? `<table class="clk-laps"><thead><tr><th>Laps</th><th>Time</th><th>Total</th></tr></thead><tbody>${laps.map((t, i) => ({ t, i })).reverse().map(({ t, i }) => `<tr><td>${i + 1}${splits[i] === best ? ' <em class="best">Fastest</em>' : splits[i] === worst ? ' <em class="worst">Slowest</em>' : ''}</td><td>${hms(splits[i], { cs: true })}</td><td>${hms(t, { cs: true })}</td></tr>`).join('')}</tbody></table>` : ''}</section>`;
    };

    const worldPage = () => {
      const now = new Date();
      const local = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: !h24() });
      const dayFrac = (now.getHours() * 60 + now.getMinutes()) / 1440;
      const cards = C().cities.map(zone => {
        const z = zoneInfo(zone, now);
        const night = z.hour < 6 || z.hour >= 19;
        return `<section class="clk-card clk-city ${night ? 'night' : ''}"><header><h2>${Win.esc(cityName(zone))}</h2>${st.edit ? `<button class="icon-btn" data-act="city-del" data-zone="${Win.esc(zone)}" aria-label="Remove ${Win.esc(cityName(zone))}">${Win.glyph('trash', 14)}</button>` : Win.glyph(night ? 'moon' : 'sun', 16)}</header>
          <b class="clk-city-time" data-live="city" data-zone="${Win.esc(zone)}">${z.time}</b><p class="clk-muted">${z.day}, ${z.rel}</p></section>`;
      }).join('');
      return `<h1 class="clk-h1">World clock</h1><div class="clk-map" style="--day:${dayFrac}" aria-hidden="true"><i class="clk-sun"></i></div>
        <div class="clk-grid"><section class="clk-card clk-city local"><header><h2>Local time</h2>${Win.glyph('location', 16)}</header><b class="clk-city-time" data-live="local">${local}</b><p class="clk-muted">${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p></section>${cards}</div>${fab('city')}`;
    };

    const settingsPage = () => {
      const f = C().focus;
      return `<h1 class="clk-h1">Settings</h1><div class="clk-settings">
        <h3>Focus sessions</h3>
        <div class="card-row"><span class="row-text"><span class="row-title">Daily goal</span><span class="row-desc">How long you want to focus each day.</span></span><span class="row-end">${Win.select([[30, '30 minutes'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']], f.goal, 'data-set="goal"')}</span></div>
        <div class="card-row"><span class="row-text"><span class="row-title">Turn on do not disturb during focus sessions</span></span><span class="row-end">${Win.toggle(f.dnd !== false, 'data-set="dnd"', 'Do not disturb during focus')}</span></div>
        <h3>General</h3>
        <div class="card-row"><span class="row-text"><span class="row-title">Notifications</span><span class="row-desc">Alarms and timers appear as notifications.</span></span><span class="row-end"><button class="btn" data-act="notif-settings">Change notification settings</button></span></div>
        <h3>About this app</h3><p class="clk-muted">Clock 11.2508.12.0<br>© 2026 Microsoft Corporation. All rights reserved.</p></div>`;
    };

    const PAGES = { focus: focusPage, timer: timerPage, alarm: alarmPage, stopwatch: stopwatchPage, world: worldPage, settings: settingsPage };

    const render = () => {
      root.querySelectorAll('.clk-nav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.page === st.page);
        b.setAttribute('aria-current', b.dataset.page === st.page ? 'page' : 'false');
      });
      main.innerHTML = (PAGES[st.page] || focusPage)();
    };

    /* Cheap per-second updates of just the live numbers. */
    const live = () => {
      if (win.minimized) return;
      const now = new Date();
      if (st.page === 'timer') {
        let ended = false;
        main.querySelectorAll('[data-live="timer"]').forEach(el => {
          const t = C().timers.find(x => x.id === el.dataset.id);
          if (!t) return;
          const left = t.running ? Math.max(0, t.endsAt - Date.now()) : t.remaining;
          el.textContent = hms(left);
          const card = el.closest('.clk-timer');
          if (card.classList.contains('running') !== t.running) ended = true;
          const fg = card.querySelector('.fg');
          const c = Number(fg.getAttribute('stroke-dasharray'));
          fg.setAttribute('stroke-dashoffset', String(c * (1 - left / t.duration)));
        });
        if (ended) render();
      } else if (st.page === 'focus') {
        const s = C().focus.session;
        const el = main.querySelector('[data-live="focus"]');
        if (!!s !== !!el) { render(); return; }
        if (s && el) {
          const left = s.paused ? s.remaining : Math.max(0, s.endsAt - Date.now());
          el.textContent = String(Math.ceil(left / MIN));
          const fg = main.querySelector('.clk-big-ring .fg');
          const c = Number(fg.getAttribute('stroke-dasharray'));
          fg.setAttribute('stroke-dashoffset', String(c * (1 - left / s.total)));
        }
      } else if (st.page === 'world') {
        const l = main.querySelector('[data-live="local"]');
        if (l) l.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: !h24() });
        main.querySelectorAll('[data-live="city"]').forEach(el => { el.textContent = zoneInfo(el.dataset.zone, now).time; });
      } else if (st.page === 'alarm' && now.getSeconds() === 0) render();
    };
    const timer = setInterval(live, 500);
    let raf = 0;
    const swFrame = () => {
      raf = 0;
      if (win.closed || st.page !== 'stopwatch') return;
      const el = main.querySelector('[data-live="sw"]');
      if (el) el.textContent = hms(swElapsed(), { cs: true });
      if (sw.start != null) raf = requestAnimationFrame(swFrame);
    };
    const kickSw = () => { if (!raf && sw.start != null) raf = requestAnimationFrame(swFrame); };
    win.cleanup(() => { clearInterval(timer); cancelAnimationFrame(raf); });
    win.listen('clock', () => { if (!win.closed && st.page !== 'stopwatch') render(); });

    const go = page => {
      st.page = page;
      st.edit = false;
      C().page = page === 'settings' ? C().page : page;
      Win.save('clock');
      render();
      kickSw();
    };

    /* -------------------------------------------------------- dialogs */

    const timerDialog = async () => {
      const res = await Win.dialog({
        owner: win, title: 'Add new timer', width: 360,
        body: `<div class="clk-hms"><label><span>hr</span><input class="input" type="number" min="0" max="99" value="0" data-h></label><label><span>min</span><input class="input" type="number" min="0" max="59" value="15" data-m></label><label><span>sec</span><input class="input" type="number" min="0" max="59" value="0" data-s></label></div>
          <label class="field"><span>Timer name</span><input class="input" data-name placeholder="Timer" maxlength="40"></label>`,
        buttons: [{ label: 'Save', primary: true, value: box => ({ h: +box.querySelector('[data-h]').value || 0, m: +box.querySelector('[data-m]').value || 0, s: +box.querySelector('[data-s]').value || 0, name: box.querySelector('[data-name]').value.trim() }),
          validate: box => ((+box.querySelector('[data-h]').value || 0) + (+box.querySelector('[data-m]').value || 0) + (+box.querySelector('[data-s]').value || 0) > 0 ? '' : 'Set a time greater than zero.') }, { label: 'Cancel', value: null }],
      });
      if (!res) return;
      const duration = ((res.h * 60 + res.m) * 60 + res.s) * 1000;
      C().timers.push({ id: Win.uid('tm'), name: res.name, duration, remaining: duration, running: false, endsAt: 0 });
      Win.save('clock');
      render();
    };

    const alarmDialog = async existing => {
      const a = existing || { time: (() => { const d = new Date(Date.now() + 5 * MIN); return `${two(d.getHours())}:${two(d.getMinutes())}`; })(), name: 'Alarm', days: [], sound: 'Chimes', snooze: 10 };
      const [h, m] = a.time.split(':').map(Number);
      const hourOpts = h24() ? Array.from({ length: 24 }, (_, i) => [i, two(i)]) : Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1)]);
      const res = await Win.dialog({
        owner: win, title: existing ? 'Edit alarm' : 'Add new alarm', width: 380,
        body: `<div class="clk-hms">${Win.select(hourOpts, h24() ? h : h % 12 || 12, 'data-h aria-label="Hour"')}<b>:</b>${Win.select(Array.from({ length: 60 }, (_, i) => [i, two(i)]), m, 'data-m aria-label="Minute"')}${h24() ? '' : Win.select(['AM', 'PM'], h < 12 ? 'AM' : 'PM', 'data-ap aria-label="AM or PM"')}</div>
          <label class="field"><span>Alarm name</span><input class="input" data-name value="${Win.esc(a.name)}" maxlength="40"></label>
          <label class="check"><input type="checkbox" data-repeat ${a.days.length ? 'checked' : ''}> Repeat alarm</label>
          <div class="clk-daypick">${DAY_NAMES.map((d, i) => `<button type="button" class="${a.days.includes(i) ? 'on' : ''}" data-day="${i}" aria-pressed="${a.days.includes(i)}" aria-label="${d}">${DAY_LETTERS[i]}</button>`).join('')}</div>
          <label class="field"><span>Alarm chime</span>${Win.select(SOUNDS, a.sound, 'data-sound')}</label>
          <label class="field"><span>Snooze time</span>${Win.select([[0, 'Disabled'], [5, '5 minutes'], [10, '10 minutes'], [20, '20 minutes'], [30, '30 minutes'], [60, '1 hour']], a.snooze, 'data-snooze')}</label>`,
        buttons: [
          { label: 'Save', primary: true, value: box => {
            let hour = Number(box.querySelector('[data-h]').value);
            const ap = box.querySelector('[data-ap]')?.value;
            if (ap) hour = (hour % 12) + (ap === 'PM' ? 12 : 0);
            const days = box.querySelector('[data-repeat]').checked ? [...box.querySelectorAll('[data-day].on')].map(b => Number(b.dataset.day)) : [];
            return { time: `${two(hour)}:${two(Number(box.querySelector('[data-m]').value))}`, name: box.querySelector('[data-name]').value.trim() || 'Alarm', days, sound: box.querySelector('[data-sound]').value, snooze: Number(box.querySelector('[data-snooze]').value) };
          } },
          ...(existing ? [{ label: 'Delete', value: 'delete' }] : []),
          { label: 'Cancel', value: null },
        ],
        onRender: box => {
          box.querySelector('.clk-daypick').addEventListener('click', e => {
            const b = e.target.closest('[data-day]');
            if (!b) return;
            b.classList.toggle('on');
            b.setAttribute('aria-pressed', String(b.classList.contains('on')));
            box.querySelector('[data-repeat]').checked = !!box.querySelector('[data-day].on');
          });
          box.querySelector('[data-sound]').addEventListener('change', () => chime('alarm'));
        },
      });
      if (!res) return;
      if (res === 'delete') { C().alarms = C().alarms.filter(x => x !== existing); }
      else if (existing) Object.assign(existing, res, { on: true });
      else C().alarms.push({ id: Win.uid('al'), on: true, ...res });
      Win.save('clock');
      render();
    };

    const cityDialog = async () => {
      const taken = new Set(C().cities);
      const res = await Win.dialog({
        owner: win, title: 'Add new location', width: 380,
        body: `<label class="field"><span>Enter a location</span><input class="input" data-q placeholder="Search" autocomplete="off"></label><div class="clk-citylist" role="listbox"></div>`,
        buttons: [{ label: 'Add', primary: true, value: box => box.querySelector('[data-pick].on')?.dataset.pick || null }, { label: 'Cancel', value: null }],
        onRender: box => {
          const list = box.querySelector('.clk-citylist');
          const draw = q => {
            list.innerHTML = CITIES.filter(([n, z]) => !taken.has(z) && n.toLowerCase().includes(q.toLowerCase())).map(([n, z]) => `<button type="button" role="option" data-pick="${Win.esc(z)}">${Win.esc(n)} <small>${Win.esc(z)}</small></button>`).join('');
          };
          draw('');
          box.querySelector('[data-q]').addEventListener('input', e => draw(e.target.value));
          list.addEventListener('click', e => {
            const b = e.target.closest('[data-pick]');
            if (!b) return;
            list.querySelectorAll('.on').forEach(x => x.classList.remove('on'));
            b.classList.add('on');
          });
        },
      });
      if (!res) return;
      C().cities.push(res);
      Win.save('clock');
      render();
    };

    /* --------------------------------------------------------- events */

    root.querySelector('.clk-nav').addEventListener('click', e => {
      if (e.target.closest('.clk-ham')) { st.navOpen = !st.navOpen; root.classList.toggle('nav-open', st.navOpen); return; }
      const b = e.target.closest('[data-page]');
      if (b) go(b.dataset.page);
    });

    main.addEventListener('click', e => {
      const toggle = e.target.closest('[data-alarm-toggle]');
      if (toggle) {
        e.stopPropagation();
        return;
      }
      if (e.target.closest('.tgl')) return;
      const act = e.target.closest('[data-act]');
      const c = C();
      if (act) {
        const id = act.dataset.id;
        const t = c.timers.find(x => x.id === id);
        switch (act.dataset.act) {
          case 'edit': st.edit = !st.edit; render(); return;
          case 'add': if (st.page === 'timer') timerDialog(); else if (st.page === 'alarm') alarmDialog(); else if (st.page === 'world') cityDialog(); return;
          case 'timer-toggle':
            if (t.running) { t.remaining = Math.max(0, t.endsAt - Date.now()); t.running = false; t.endsAt = 0; }
            else { t.running = true; t.endsAt = Date.now() + t.remaining; }
            break;
          case 'timer-reset': t.running = false; t.endsAt = 0; t.remaining = t.duration; break;
          case 'timer-del': c.timers = c.timers.filter(x => x.id !== id); break;
          case 'alarm-del': c.alarms = c.alarms.filter(x => x.id !== id); e.stopPropagation(); break;
          case 'city-del': c.cities = c.cities.filter(z => z !== act.dataset.zone); break;
          case 'focus-up': c.focus.length = Math.min(240, c.focus.length + (c.focus.length < 60 ? 5 : 15)); break;
          case 'focus-down': c.focus.length = Math.max(5, c.focus.length - (c.focus.length <= 60 ? 5 : 15)); break;
          case 'focus-start': startFocus(c.focus.length); render(); return;
          case 'focus-pause': {
            const s = c.focus.session;
            if (s.paused) { s.paused = false; s.endsAt = Date.now() + s.remaining; } else { s.paused = true; s.remaining = Math.max(0, s.endsAt - Date.now()); }
            break;
          }
          case 'focus-stop': endFocus(false); render(); return;
          case 'sw-toggle':
            if (sw.start != null) { sw.base = swElapsed(); sw.start = null; } else { sw.start = performance.now(); }
            swSave(); render(); kickSw(); return;
          case 'sw-lap': sw.laps.push(swElapsed()); swSave(); render(); kickSw(); return;
          case 'sw-reset': sw.base = 0; sw.start = null; sw.laps = []; swSave(); render(); return;
          case 'notif-settings': if (Win.Settings?.open) Win.Settings.open('notifications'); else Win.wm.open('settings', { page: 'notifications' }); return;
          default: return;
        }
        Win.save('clock');
        render();
        return;
      }
      const alarm = e.target.closest('[data-alarm]');
      if (alarm && !st.edit) alarmDialog(c.alarms.find(a => a.id === alarm.dataset.alarm));
    });

    main.addEventListener('keydown', e => {
      const alarm = e.target.closest('[data-alarm]');
      if (alarm && e.target === alarm && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); alarmDialog(C().alarms.find(a => a.id === alarm.dataset.alarm)); }
    });

    main.addEventListener('change', e => {
      const at = e.target.dataset.alarmToggle;
      if (at) {
        const a = C().alarms.find(x => x.id === at);
        a.on = e.target.checked;
        Win.save('clock');
        render();
        return;
      }
      const key = e.target.dataset.set;
      if (!key) return;
      const f = C().focus;
      if (key === 'goal') f.goal = Number(e.target.value);
      else f[key] = e.target.checked;
      Win.save('clock');
      render();
    });

    win.el.addEventListener('keydown', e => {
      if (e.target.matches('input, select, textarea')) return;
      if (st.page === 'stopwatch' && e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); main.querySelector('[data-act="sw-toggle"]').click(); }
      if (st.page === 'stopwatch' && e.key.toLowerCase() === 'l' && sw.start != null) { e.preventDefault(); main.querySelector('[data-act="sw-lap"]').click(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'n' && ['timer', 'alarm', 'world'].includes(st.page)) { e.preventDefault(); main.querySelector('[data-act="add"]')?.click(); }
    });

    win.api = { go };
    render();
    kickSw();
  }

  Win.apps.register({
    id: 'clock', name: 'Clock', icon: 'clock', single: true,
    width: 900, height: 620, minWidth: 420, minHeight: 420, category: 'Utilities', keywords: ['alarm', 'timer', 'stopwatch', 'focus', 'world clock'],
    create,
    reopen(win, args) {
      if (args?.page === 'focus' && args.minutes && !C().focus.session) startFocus(args.minutes);
      if (args?.page) win.api?.go(args.page);
    },
  });

  Win.Clock = { startFocus, endFocus, zoneInfo, hms, tick };
})(window.Win);
