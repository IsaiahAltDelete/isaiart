/* ===========================================================================
   Everyday apps: Messages, Calendar, Reminders, Contacts, Photos, Music,
   Podcasts, Maps, FaceTime and Weather. These make the Mac feel populated and
   give Spotlight, Launchpad and the Dock real destinations.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, UI } = Mac;

  /* ---------------------------------------------------------------- Messages */

  Mac.registerApp({
    id: 'messages',
    title: 'Messages',
    icon: 'messages',
    category: 'Productivity',
    blurb: 'Send and receive messages.',
    size: [840, 560],
    min: [400, 300],
    singleton: true,
    render(win) {
      const data = Mac.state.messages;
      const thread = data.threads.find(candidate => candidate.id === data.selected) || data.threads[0];
      return `<div class="app-shell">
        <aside class="sidebar" style="width:224px">
          <div class="search"><span>${glyph('search')}</span><input placeholder="Search" aria-label="Search messages"></div>
          ${data.threads.map(candidate => {
            const last = candidate.lines.at(-1);
            return `<button class="note-item ${candidate.id === thread?.id ? 'on' : ''}" data-message-thread="${candidate.id}">
              <strong>${esc(candidate.name)}</strong>
              <p>${esc(last ? last.text : 'No messages')}</p></button>`;
          }).join('')}
        </aside>
        <section class="main-pane">
          ${thread ? `<div class="mail-reader-bar"><strong style="font-size:13px">${esc(thread.name)}</strong>
              <span class="spacer"></span>
              <button class="tool-btn" data-command="open-app" data-arg="facetime" aria-label="FaceTime">${glyph('camera')}</button></div>
            <div class="chat-thread">${thread.lines.map(line =>
              `<div class="bubble ${line.me ? 'me' : 'them'}">${esc(line.text)}</div>`).join('')}</div>
            <form class="chat-compose" data-message-form>
              <input class="field tall" style="flex:1" placeholder="iMessage" aria-label="Message text">
              <button class="btn primary" type="submit">Send</button></form>`
            : UI.empty('No conversations', 'Start a new message to begin.', { icon: 'messages' })}
        </section></div>`;
    },
    send(text) {
      const data = Mac.state.messages;
      const thread = data.threads.find(candidate => candidate.id === data.selected) || data.threads[0];
      if (!thread || !text.trim()) return;
      thread.lines.push({ me: true, text: text.trim(), at: Date.now() });
      Mac.save();
      Mac.wm.refresh('messages');
      setTimeout(() => {
        thread.lines.push({ me: false, text: 'Got it — thanks!', at: Date.now() });
        Mac.save();
        Mac.wm.refresh('messages');
        Mac.Notify.show(thread.name, 'Got it — thanks!', { app: 'messages' });
      }, 1600);
    },
  });

  /* ---------------------------------------------------------------- Calendar */

  Mac.registerApp({
    id: 'calendar',
    title: 'Calendar',
    icon: 'calendar',
    category: 'Productivity',
    blurb: 'Every calendar on this Mac in one grid.',
    size: [900, 600],
    min: [420, 320],
    singleton: true,
    initialState: () => ({ monthOffset: 0 }),
    toolbar: () => `<button class="tool-btn" data-command="calendar-month" data-arg="-1" aria-label="Previous month">${glyph('back')}</button>
      <button class="tool-btn" data-command="calendar-month" data-arg="0">Today</button>
      <button class="tool-btn" data-command="calendar-month" data-arg="1" aria-label="Next month">${glyph('forward')}</button>
      <button class="tool-btn" data-command="calendar-new" aria-label="New event">${glyph('plus')}</button>`,
    render(win) {
      const data = Mac.state.calendar;
      const today = new Date();
      const cursor = new Date(today.getFullYear(), today.getMonth() + win.state.monthOffset, 1);
      const firstDay = cursor.getDay();
      const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const cells = [];

      for (let i = 0; i < firstDay; i += 1) cells.push(null);
      for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
      while (cells.length % 7) cells.push(null);

      const eventsFor = day => data.events.filter(event => {
        const date = new Date(today);
        date.setDate(today.getDate() + event.offset);
        return date.getDate() === day && date.getMonth() === cursor.getMonth();
      });

      return `<div class="app-shell">
        <aside class="sidebar">
          <div class="sidebar-heading">Calendars</div>
          ${data.calendars.map(calendar => `<button class="side-item" data-calendar-toggle="${calendar.id}">
            <span class="checkbox ${calendar.on ? 'on' : ''}" style="background:${calendar.on ? calendar.color : ''};box-shadow:${calendar.on ? 'none' : 'inset 0 0 0 1px var(--hair-strong)'}">✓</span>
            <span class="side-label">${esc(calendar.name)}</span></button>`).join('')}
        </aside>
        <section class="main-pane"><div class="pane-scroll"><div class="pane-pad">
          ${UI.header(cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
            `${Mac.plural(data.events.length, 'event')} in the next week`)}
          <div class="calendar-grid">
            ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(name => `<div class="calendar-head">${name}</div>`).join('')}
            ${cells.map(day => {
              if (!day) return '<div class="calendar-cell dim"></div>';
              const isToday = win.state.monthOffset === 0 && day === today.getDate();
              const events = eventsFor(day).filter(event => data.calendars.find(calendar => calendar.id === event.calendar)?.on);
              return `<div class="calendar-cell ${isToday ? 'today' : ''}"><strong>${day}</strong>
                ${events.map(event => {
                  const color = data.calendars.find(calendar => calendar.id === event.calendar)?.color || '#888';
                  return `<div class="calendar-chip" style="background:${color}22;color:${color}">${esc(event.time)} ${esc(event.title)}</div>`;
                }).join('')}</div>`;
            }).join('')}
          </div>
        </div></div></section></div>`;
    },
  });

  /* --------------------------------------------------------------- Reminders */

  Mac.registerApp({
    id: 'reminders',
    title: 'Reminders',
    icon: 'reminders',
    category: 'Productivity',
    blurb: 'Follow-ups for open tickets.',
    size: [760, 520],
    min: [360, 280],
    singleton: true,
    scrolls: true,
    initialState: () => ({
      items: [
        { id: 'r1', text: 'Call back ticket 4821', done: false, list: 'Support', due: 'Today 15:00' },
        { id: 'r2', text: 'Attach diagnostics to escalation', done: false, list: 'Support', due: 'Today 17:30' },
        { id: 'r3', text: 'Order replacement charger', done: true, list: 'Bench', due: 'Yesterday' },
        { id: 'r4', text: 'Update Wi-Fi runbook', done: false, list: 'Bench', due: 'Thursday' },
      ],
    }),
    render(win) {
      const lists = [...new Set(win.state.items.map(item => item.list))];
      return `<div class="pane-pad">
        ${UI.header('Reminders', `${win.state.items.filter(item => !item.done).length} remaining`,
          '<button class="btn primary" data-command="reminder-new">New Reminder</button>')}
        ${lists.map(list => `<div class="section-title">${esc(list)}</div>
          <div class="group">${win.state.items.filter(item => item.list === list).map(item =>
            `<button class="row tappable" data-reminder-toggle="${item.id}">
              <span class="radio ${item.done ? 'on' : ''}" aria-hidden="true"></span>
              <div class="row-text"><strong style="${item.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(item.text)}</strong>
                <p>${esc(item.due)}</p></div></button>`).join('')}</div>`).join('')}
      </div>`;
    },
  });

  /* ---------------------------------------------------------------- Contacts */

  Mac.registerApp({
    id: 'contacts',
    title: 'Contacts',
    icon: 'contacts',
    category: 'Productivity',
    blurb: 'People and shared mailboxes.',
    size: [780, 520],
    min: [360, 280],
    singleton: true,
    initialState: () => ({ selected: 0 }),
    render(win) {
      const people = [
        { name: 'Dana Whitfield', role: 'Tier 3 Support', email: 'dana@support.example', phone: '+1 (407) 555-0148' },
        { name: 'Service Desk', role: 'Shared mailbox', email: 'servicedesk@support.example', phone: '+1 (407) 555-0100' },
        { name: 'Milo Souf', role: 'Family', email: 'milo.souf@icloud.example', phone: '+1 (407) 555-0193' },
        { name: 'Bench Tools', role: 'Vendor', email: 'news@benchtools.example', phone: '+1 (800) 555-0111' },
      ];
      const person = people[win.state.selected] || people[0];
      return `<div class="app-shell">
        <aside class="sidebar" style="width:210px">
          ${people.map((candidate, index) => `<button class="side-item ${index === win.state.selected ? 'on' : ''}" data-contact="${index}">
            <span class="side-label">${esc(candidate.name)}</span></button>`).join('')}
        </aside>
        <section class="main-pane"><div class="pane-scroll"><div class="pane-pad" style="text-align:center">
          ${UI.avatar(person.name, { size: 'big' })}
          <h1 style="margin:12px 0 2px;font-size:22px">${esc(person.name)}</h1>
          <p class="muted" style="margin:0 0 18px">${esc(person.role)}</p>
          <div style="text-align:left">${UI.group(
            UI.info('email', person.email),
            UI.info('phone', person.phone),
            UI.info('company', 'Support Desk'),
          )}
          <div class="row-flex" style="justify-content:center">
            <button class="btn" data-command="open-app" data-arg="mail">Send Mail</button>
            <button class="btn" data-command="open-app" data-arg="messages">Message</button>
            <button class="btn" data-command="open-app" data-arg="facetime">FaceTime</button></div></div>
        </div></div></section></div>`;
    },
  });

  /* ------------------------------------------------------------------ Photos */

  Mac.registerApp({
    id: 'photos',
    title: 'Photos',
    icon: 'photos',
    category: 'Media',
    blurb: 'Browse your photo library.',
    size: [900, 600],
    min: [400, 300],
    singleton: true,
    render() {
      const palette = [['#8fd0ff', '#3f6fd8'], ['#ffd28a', '#e0793a'], ['#a2e6b5', '#2b9e63'],
        ['#f5a3c7', '#c2417f'], ['#c3b5f7', '#6a4fd0'], ['#ffe08a', '#d9a218'], ['#9fe4e4', '#2a8f96']];
      return `<div class="app-shell">
        <aside class="sidebar">
          <div class="sidebar-heading">Library</div>
          ${['Recents', 'Days', 'Months', 'Years', 'People', 'Places', 'Favorites'].map((name, index) =>
            `<button class="side-item ${index === 0 ? 'on' : ''}"><span class="side-glyph">${glyph('photo', { size: 15 })}</span>
              <span class="side-label">${name}</span></button>`).join('')}
        </aside>
        <section class="main-pane"><div class="pane-scroll">
          <div class="pane-pad" style="padding-bottom:0">${UI.header('Recents', '48 items — 3 shared albums')}</div>
          <div class="photo-grid">${Array.from({ length: 28 }, (_, index) => {
            const [a, b] = palette[index % palette.length];
            return `<div class="photo-cell" style="--a:${a};--b:${b}"></div>`;
          }).join('')}</div>
        </div></section></div>`;
    },
  });

  /* ------------------------------------------------------------------- Music */

  const Media = Mac.Media = {
    track() {
      const music = Mac.state.music;
      return music.tracks[music.trackIndex] || music.tracks[0];
    },

    toggle() {
      Mac.state.music.playing = !Mac.state.music.playing;
      Mac.save();
      Mac.wm.refresh('music');
      Mac.Shell.renderMenuBar();
    },

    skip(delta) {
      const music = Mac.state.music;
      music.trackIndex = (music.trackIndex + delta + music.tracks.length) % music.tracks.length;
      music.playing = true;
      Mac.save();
      Mac.wm.refresh('music');
      Mac.Shell.renderMenuBar();
      if (Mac.session.surface === 'now-playing') Mac.Surfaces.close();
    },

    play(index) {
      Mac.state.music.trackIndex = index;
      Mac.state.music.playing = true;
      Mac.save();
      Mac.wm.refresh('music');
      Mac.Shell.renderMenuBar();
    },

    nowPlayingPopover() {
      const track = this.track();
      return `<h3>Now Playing</h3>
        <div class="row"><span class="music-art"></span>
          <div class="row-text"><strong>${esc(track.title)}</strong><p>${esc(track.artist)} — ${esc(track.album)}</p></div></div>
        <div class="row-flex" style="justify-content:center;padding:6px 0 2px">
          <button class="icon-btn" data-command="music-prev" aria-label="Previous">${glyph('prev')}</button>
          <button class="icon-btn" data-command="music-toggle" aria-label="Play or pause">${glyph(Mac.state.music.playing ? 'pause' : 'play')}</button>
          <button class="icon-btn" data-command="music-next" aria-label="Next">${glyph('next')}</button>
        </div>
        <div class="menu-list"><button data-command="open-app" data-arg="music">Open Music</button></div>`;
    },
  };

  Mac.registerApp({
    id: 'music',
    title: 'Music',
    icon: 'music',
    category: 'Media',
    blurb: 'Bench playlists for long shifts.',
    size: [860, 560],
    min: [400, 300],
    singleton: true,
    render() {
      const music = Mac.state.music;
      const track = Media.track();
      return `<div class="music-shell">
        <div class="music-now">
          <span class="music-art"></span>
          <div class="row-text"><strong>${esc(track.title)}</strong><p>${esc(track.artist)} — ${esc(track.album)}</p></div>
          <div class="row-action">
            <button class="icon-btn" data-command="music-prev" aria-label="Previous">${glyph('prev')}</button>
            <button class="icon-btn" data-command="music-toggle" aria-label="Play or pause">${glyph(music.playing ? 'pause' : 'play')}</button>
            <button class="icon-btn" data-command="music-next" aria-label="Next">${glyph('next')}</button>
            <span class="row-value">${music.playing ? 'Playing' : 'Paused'}</span></div>
        </div>
        <div class="pane-scroll">${music.tracks.map((candidate, index) =>
          `<button class="track-row ${index === music.trackIndex ? 'on' : ''}" data-music-track="${index}">
            <span>${index === music.trackIndex && music.playing ? glyph('play', { size: 12 }) : index + 1}</span>
            <span><strong>${esc(candidate.title)}</strong><br><small class="muted">${esc(candidate.artist)}</small></span>
            <span class="muted">${esc(candidate.album)}</span>
            <span class="muted">${esc(candidate.time)}</span></button>`).join('')}</div>
      </div>`;
    },
  });

  Mac.registerApp({
    id: 'podcasts',
    title: 'Podcasts',
    icon: 'podcasts',
    category: 'Media',
    blurb: 'Shows for the commute.',
    size: [820, 540],
    min: [380, 280],
    singleton: true,
    scrolls: true,
    render: () => `<div class="pane-pad">
      ${UI.header('Listen Now', 'Discover your favorite shows.')}
      <div class="tile-grid">${['Support Signal', 'The Bench Report', 'Packet Loss', 'Root Cause'].map((name, index) =>
        `<button class="tile"><div style="height:96px;border-radius:8px;margin-bottom:8px;background:linear-gradient(140deg,#c46bf0,#6a2fd0);opacity:${1 - index * 0.12}"></div>
          <strong>${esc(name)}</strong><small>Episode ${12 - index} — ${34 + index * 3} min</small></button>`).join('')}</div>
    </div>`,
  });

  /* -------------------------------------------------------------------- Maps */

  Mac.registerApp({
    id: 'maps',
    title: 'Maps',
    icon: 'maps',
    category: 'Lifestyle',
    blurb: 'Look around before the site visit.',
    size: [900, 600],
    min: [400, 300],
    singleton: true,
    render() {
      return `<div class="app-shell">
        <aside class="sidebar" style="width:236px">
          <div class="search"><span>${glyph('search')}</span><input placeholder="Search Maps" aria-label="Search Maps"></div>
          <div class="sidebar-heading">Favorites</div>
          ${['Support Bench', 'Downtown Store', 'Warehouse', 'Home'].map((name, index) =>
            `<button class="side-item ${index === 0 ? 'on' : ''}">
              <span class="side-glyph">${glyph('location', { size: 15 })}</span><span class="side-label">${name}</span></button>`).join('')}
        </aside>
        <section class="main-pane" style="position:relative;background:linear-gradient(150deg,#dcefe0,#b7d8c4 60%,#8ec1a8)">
          <div style="position:absolute;inset:0;background:
            repeating-linear-gradient(58deg, rgba(255,255,255,.6) 0 3px, transparent 3px 46px),
            repeating-linear-gradient(-34deg, rgba(255,255,255,.45) 0 3px, transparent 3px 68px)"></div>
          <div style="position:absolute;left:46%;top:44%;transform:translate(-50%,-100%);color:#e0453a">${glyph('location', { size: 40, stroke: 2.4 })}</div>
          <div style="position:absolute;left:14px;bottom:14px;padding:12px 14px;border-radius:12px;background:var(--popover);
            box-shadow:var(--shadow-pop);backdrop-filter:blur(30px)">
            <strong style="font-size:13px">Support Bench</strong>
            <p class="muted" style="margin:3px 0 0;font-size:11.5px">1 Bench Way — 4 min drive</p></div>
        </section></div>`;
    },
  });

  /* --------------------------------------------------------- FaceTime/Weather */

  Mac.registerApp({
    id: 'facetime',
    title: 'FaceTime',
    icon: 'facetime',
    category: 'Productivity',
    blurb: 'Make video and audio calls.',
    size: [720, 520],
    min: [360, 280],
    singleton: true,
    render: () => `<div style="height:100%;display:grid;grid-template-rows:1fr auto;background:#15161a;color:#fff">
      <div style="display:grid;place-items:center;text-align:center;padding:20px">
        <div><div style="width:104px;height:104px;margin:0 auto 14px;border-radius:50%;background:linear-gradient(150deg,#5ce87b,#0aa63d);
          display:grid;place-items:center">${glyph('camera', { size: 44 })}</div>
          <h2 style="margin:0 0 4px;font-size:18px">Ready to call</h2>
          <p style="margin:0;color:#a0a0a8;font-size:12.5px"></p></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:center;padding:16px">
        <button class="btn" data-command="facetime-call">New FaceTime</button>
        <button class="btn" data-command="open-app" data-arg="contacts">Choose a Contact</button></div></div>`,
  });

  Mac.registerApp({
    id: 'weather',
    title: 'Weather',
    icon: 'weather',
    category: 'Lifestyle',
    blurb: 'View the weather forecast.',
    size: [620, 540],
    min: [340, 300],
    singleton: true,
    scrolls: true,
    render() {
      const hours = Array.from({ length: 8 }, (_, index) => ({
        label: `${(new Date().getHours() + index + 1) % 24}:00`,
        temp: 28 + Math.round(Math.sin(index / 2) * 3),
      }));
      return `<div class="pane-pad" style="background:linear-gradient(160deg,#4cb8f5,#1163cf);color:#fff;min-height:100%">
        <p style="margin:0;opacity:.8;font-size:12px">Orlando, FL</p>
        <div style="font-family:var(--font-display);font-size:62px;font-weight:200;line-height:1">31°</div>
        <p style="margin:0 0 20px;opacity:.9">Partly Cloudy — H:33° L:24°</p>
        <div style="display:flex;gap:14px;overflow-x:auto;padding:12px;border-radius:14px;background:rgba(255,255,255,.16)">
          ${hours.map(hour => `<div style="text-align:center;min-width:44px">
            <div style="font-size:11px;opacity:.85">${hour.label}</div>
            <div style="margin:6px 0">${glyph('sun', { size: 18 })}</div>
            <strong style="font-size:13px">${hour.temp}°</strong></div>`).join('')}
        </div>
        <div style="margin-top:16px;padding:14px;border-radius:14px;background:rgba(255,255,255,.16)">
          <strong style="font-size:12px">10-day forecast</strong>
          ${['Today', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, index) =>
            `<div style="display:flex;align-items:center;gap:12px;padding:7px 0;border-bottom:0.5px solid rgba(255,255,255,.2)">
              <span style="width:48px;font-size:12px">${day}</span>${glyph('sun', { size: 16 })}
              <span style="flex:1;height:4px;border-radius:2px;background:linear-gradient(90deg,#ffd28a,#f7876f)"></span>
              <span style="font-size:12px">${24 + index}° / ${32 + index}°</span></div>`).join('')}
        </div></div>`;
    },
  });
}(window.Mac));
