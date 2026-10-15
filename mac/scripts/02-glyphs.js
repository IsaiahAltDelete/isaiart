/* ===========================================================================
   Vector glyph library.

   All UI symbols are drawn inline from this table (24x24 grid, currentColor)
   so nothing is fetched at runtime and every glyph inherits the surrounding
   text color. App artwork lives in assets/icons as locally stored images and SVG files.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const G = {
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    /* ---------------------------------------------------------- navigation */
    'identity-card': '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M5 16c0-3 6-3 6 0M14 9h4M14 12h4M14 15h3"/>',
    puzzle: '<path d="M9 4h2a2.5 2.5 0 1 1 5 0h4v6a2.5 2.5 0 1 0 0 5v5h-6a2.5 2.5 0 1 0-5 0H4v-6a2.5 2.5 0 1 0 0-5V4z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.4"/><path d="m15.3 15.3 4.4 4.4"/>',
    back: '<path d="m14.5 5.5-7 6.5 7 6.5"/>',
    forward: '<path d="m9.5 5.5 7 6.5-7 6.5"/>',
    up: '<path d="m5.5 14.5 6.5-7 6.5 7"/>',
    down: '<path d="m5.5 9.5 6.5 7 6.5-7"/>',
    chevron: '<path d="m10 7 5 5-5 5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12.8 4.6 4.6L19 7"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7"/><path d="M19.5 4.5V9h-4.5"/>',
    ellipsis: '<circle class="fill" cx="6" cy="12" r="1.5"/><circle class="fill" cx="12" cy="12" r="1.5"/><circle class="fill" cx="18" cy="12" r="1.5"/>',
    share: '<path d="M12 16V4M8 8l4-4 4 4"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
    sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
    list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle class="fill" cx="4.5" cy="6.5" r="1.2"/><circle class="fill" cx="4.5" cy="12" r="1.2"/><circle class="fill" cx="4.5" cy="17.5" r="1.2"/>',
    columns: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.2 4.5v15M14.8 4.5v15"/>',
    gallery: '<rect x="3.5" y="5" width="17" height="10" rx="2"/><path d="M6 18h12"/>',
    sort: '<path d="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3"/>',
    tag: '<path d="M11 3.5H19a1.5 1.5 0 0 1 1.5 1.5v8L11 3.5z" transform="rotate(0)"/><path d="M3.9 12.4 12 4.3l7.7 7.7-8.1 8.1a1.5 1.5 0 0 1-2.1 0l-5.6-5.6a1.5 1.5 0 0 1 0-2.1z"/><circle class="fill" cx="15.3" cy="8.7" r="1.3"/>',

    /* ---------------------------------------------------------- menu bar */
    wifi: '<path d="M3.2 9.1a13.4 13.4 0 0 1 17.6 0"/><path d="M6.5 12.5a8.4 8.4 0 0 1 11 0"/><path d="M9.8 15.9a3.6 3.6 0 0 1 4.4 0"/><circle class="fill" cx="12" cy="19" r="1.2"/>',
    'wifi-off': '<path d="M3.2 9.1a13.4 13.4 0 0 1 17.6 0" opacity=".35"/><path d="M6.5 12.5a8.4 8.4 0 0 1 11 0" opacity=".35"/><circle class="fill" cx="12" cy="19" r="1.2" opacity=".35"/><path d="M4 4l16 16"/>',
    bluetooth: '<path d="M7 7 17 17 12 21V3l5 4L7 17"/>',
    'control-center': '<path d="M5 7.5h14M5 16.5h14"/><circle class="fill" cx="9" cy="7.5" r="2.4"/><circle class="fill" cx="15" cy="16.5" r="2.4"/>',
    moon: '<path class="fill" d="M18.2 16.4A7.8 7.8 0 0 1 8.3 6a7.9 7.9 0 1 0 9.9 10.4z"/>',
    sun: '<circle cx="12" cy="12" r="4.4"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/>',
    volume: '<path class="fill" d="M4 9.5h3.2L11.5 6v12L7.2 14.5H4z"/><path d="M14.4 9.2a4 4 0 0 1 0 5.6M16.8 6.8a7.4 7.4 0 0 1 0 10.4"/>',
    'volume-off': '<path class="fill" d="M4 9.5h3.2L11.5 6v12L7.2 14.5H4z"/><path d="m15 9.5 5 5M20 9.5l-5 5"/>',
    'volume-low': '<path class="fill" d="M4 9.5h3.2L11.5 6v12L7.2 14.5H4z"/><path d="M14.4 9.2a4 4 0 0 1 0 5.6"/>',
    bell: '<path d="M6.4 16.5h11.2l-1.3-2V9.8a4.3 4.3 0 0 0-8.6 0v4.7z"/><path d="M10 18.4a2.1 2.1 0 0 0 4 0"/>',
    'bell-off': '<path d="M6.4 16.5h11.2l-1.3-2V9.8a4.3 4.3 0 0 0-6.4-3.7"/><path d="M4 4l16 16"/>',
    battery: '<rect x="3" y="7.5" width="16" height="9" rx="2.4"/><path d="M21 10.5v3"/><path class="fill" d="M5.2 9.6h8.5v4.8H5.2z"/>',
    charging: '<rect x="3" y="7.5" width="16" height="9" rx="2.4"/><path d="M21 10.5v3"/><path class="fill" d="m11.5 8.6-4 4.6h2.6l-.6 2.9 4-4.8h-2.6z"/>',
    spotlight: '<circle cx="10.6" cy="10.6" r="6.3"/><path d="m15.2 15.2 4.6 4.6"/>',

    /* ------------------------------------------------------------ settings */
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M5.9 5.9l1.6 1.6M16.5 16.5l1.6 1.6M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6"/>',
    appearance: '<circle cx="9.3" cy="12" r="5.4"/><path class="fill" d="M9.3 6.6a5.4 5.4 0 0 1 0 10.8z"/><circle cx="15.2" cy="12" r="5.4"/>',
    accessibility: '<circle class="fill" cx="12" cy="5.2" r="1.8"/><path d="M5.2 8.4c4.8 1.6 8.8 1.6 13.6 0M12 8.9v10.3M8 20l4-7.2 4 7.2"/>',
    siri: '<path class="fill" d="m12 3.2 1.4 4.2 4.2 1.4-4.2 1.4L12 14.4l-1.4-4.2L6.4 8.8l4.2-1.4z"/><path class="fill" d="m18.2 13.6.75 2.2 2.2.75-2.2.75-.75 2.2-.75-2.2-2.2-.75 2.2-.75z"/>',
    focus: '<path class="fill" d="M18 16.6A7.8 7.8 0 0 1 8.1 6.1 7.9 7.9 0 1 0 18 16.6z"/>',
    'screen-time': '<circle cx="12" cy="12" r="8.4"/><path d="M12 5.4V12l4.6 2.7"/>',
    display: '<rect x="2.8" y="4" width="18.4" height="13" rx="2.2"/><path d="M8 20h8M12 17v3"/>',
    wallpaper: '<rect x="3.4" y="4.2" width="17.2" height="15.6" rx="2.2"/><circle class="fill" cx="8.2" cy="9.2" r="1.7"/><path d="m4.8 17 4.2-4.4 3.2 2.9 2.3-2.2 5.2 5"/>',
    'screen-saver': '<rect x="3.4" y="4.2" width="17.2" height="15.6" rx="2.2"/><path class="fill" d="m10 8.4 6.2 3.6L10 15.6z"/>',
    dock: '<rect x="3.2" y="4.4" width="17.6" height="12" rx="1.8"/><path d="M6.4 19.6h11.2M9.6 16.4v3.2M14.4 16.4v3.2"/>',
    keyboard: '<rect x="2.8" y="6.2" width="18.4" height="11.6" rx="2"/><path d="M6 9.4h.1M9 9.4h.1M12 9.4h.1M15 9.4h.1M18 9.4h.1M6 12.4h.1M9 12.4h.1M12 12.4h.1M15 12.4h.1M18 12.4h.1M7.4 15.4h9.2"/>',
    trackpad: '<rect x="3" y="5" width="18" height="14" rx="2.6"/><path d="M3 15.4h18"/>',
    mouse: '<rect x="7.2" y="3.2" width="9.6" height="17.6" rx="4.8"/><path d="M12 3.2v6M7.2 9.6h9.6"/>',
    printer: '<path d="M7 8.4V4h10v4.4M7 17H4.6A1.6 1.6 0 0 1 3 15.4v-5A1.6 1.6 0 0 1 4.6 8.8h14.8A1.6 1.6 0 0 1 21 10.4v5A1.6 1.6 0 0 1 19.4 17H17"/><rect x="7" y="14" width="10" height="6" rx="1.2"/>',
    network: '<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8M12 3.6c2.7 2.4 3.9 5.2 3.9 8.4s-1.2 6-3.9 8.4c-2.7-2.4-3.9-5.2-3.9-8.4S9.3 6 12 3.6z"/>',
    ethernet: '<rect x="4" y="9" width="16" height="10" rx="1.8"/><path d="M8 9V5h8v4M8 19v-3M12 19v-3M16 19v-3"/>',
    vpn: '<path d="M12 3.4 19 6v5.2c0 4.3-2.7 7.5-7 9.6-4.3-2.1-7-5.3-7-9.6V6z"/><path d="M9.4 11.6h5.2M12 9v5.2"/>',
    shield: '<path d="M12 3.4 19 6v5.2c0 4.3-2.7 7.5-7 9.6-4.3-2.1-7-5.3-7-9.6V6z"/><path d="m8.8 12 2.3 2.3 4.6-4.8"/>',
    lock: '<rect x="5" y="10.4" width="14" height="9.6" rx="2.2"/><path d="M8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8"/><circle class="fill" cx="12" cy="15" r="1.3"/>',
    unlock: '<rect x="5" y="10.4" width="14" height="9.6" rx="2.2"/><path d="M8.4 10.4V7.6a3.6 3.6 0 0 1 7-1.2"/>',
    key: '<circle cx="8.6" cy="9.4" r="3.6"/><path d="m11.2 12 7.4 7.4M16.4 18l1.8-1.8"/>',
    person: '<circle cx="12" cy="8.6" r="3.6"/><path d="M5.4 19.6c.6-3.9 3.2-5.8 6.6-5.8s6 1.9 6.6 5.8"/>',
    people: '<circle cx="9.2" cy="9" r="3.2"/><circle cx="16.6" cy="10.2" r="2.4"/><path d="M3.8 18.8c.5-3.4 2.4-5 5.4-5s4.9 1.6 5.4 5M14.6 14.2c3.2-.5 5.2.9 5.7 3.6"/>',
    family: '<circle cx="8" cy="8.6" r="2.8"/><circle cx="16" cy="8.6" r="2.8"/><path d="M3.6 18.4c.4-3 2-4.5 4.4-4.4M20.4 18.4c-.4-3-2-4.5-4.4-4.4M12 20v-4.6M9.6 17.4h4.8"/>',
    at: '<circle cx="12" cy="12" r="8.4"/><path d="M15.8 15.4a5 5 0 1 1 .8-4.7c.7 2.2-.3 3.6-1.5 3.5-1-.1-1.3-1-1-2.3l.8-3.3M13.9 10.5c-.8-1-2.5-.6-3.2.6s-.5 2.8.5 3.2 2.3-.6 2.7-2.1"/>',
    icloud: '<path d="M7.4 18.4h9.8a3.6 3.6 0 0 0 .4-7.2 5.4 5.4 0 0 0-10.3-1.6 3.9 3.9 0 0 0 .1 8.8z"/>',
    storage: '<rect x="3.4" y="6" width="17.2" height="12" rx="2"/><path d="M6.4 9.4h7"/><circle class="fill" cx="17.4" cy="14.4" r="1.2"/>',
    clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 6.6V12l4.2 2.4"/>',
    calendar: '<rect x="3.6" y="5.4" width="16.8" height="15" rx="2.2"/><path d="M3.6 10h16.8M8.4 3.6v3.4M15.6 3.6v3.4"/>',
    globe: '<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8M12 3.6a13 13 0 0 1 0 16.8 13 13 0 0 1 0-16.8z"/>',
    language: '<path d="M4 6.4h8M8 4.4v2M10.4 6.4c0 4.4-2.6 8-6.4 9.6M6.4 10.8c1.2 2.4 3.2 4 5.6 4.8"/><path d="m12.8 19.6 3.6-9.2 3.6 9.2M14.2 16.6h5.2"/>',
    'time-machine': '<circle cx="12" cy="12" r="8.4"/><path d="M12 6.8V12l4 2.4"/><path d="M20 6v4.4h-4.2"/>',
    update: '<path d="M12 19.6V6.4M7.6 10.8 12 6.4l4.4 4.4"/><path d="M4.6 19.6h14.8"/>',
    sharing: '<circle cx="6.6" cy="12" r="2.6"/><circle cx="17.4" cy="6.8" r="2.6"/><circle cx="17.4" cy="17.2" r="2.6"/><path d="m9 10.9 6-3.2M9 13.1l6 3"/>',
    airdrop: '<path d="M7.8 17.6a7.4 7.4 0 0 1 0-11.2M16.2 6.4a7.4 7.4 0 0 1 0 11.2"/><path d="M12 8.4v8.2M8.8 11.6 12 8.4l3.2 3.2"/>',
    handoff: '<rect x="3" y="6" width="10" height="12" rx="1.8"/><rect x="14.5" y="9" width="6.5" height="9" rx="1.6"/><path d="M6.4 21h3.2"/>',
    location: '<path d="M12 21c4-5 6.4-8.4 6.4-11.4A6.4 6.4 0 0 0 5.6 9.6C5.6 12.6 8 16 12 21z"/><circle class="fill" cx="12" cy="9.8" r="2"/>',
    mic: '<rect x="9" y="3.6" width="6" height="10.8" rx="3"/><path d="M6 12.4a6 6 0 0 0 12 0M12 18.4V21M9 21h6"/>',
    camera: '<rect x="3.4" y="7" width="17.2" height="12" rx="2.4"/><circle cx="12" cy="13" r="3.6"/><path d="M9 7l1.4-2.4h3.2L15 7"/>',
    photo: '<rect x="3.4" y="5" width="17.2" height="14" rx="2.2"/><circle class="fill" cx="8.4" cy="10" r="1.7"/><path d="m4.8 17.6 4.4-4.6 3.2 2.9 2.5-2.4 5.1 4.9"/>',
    document: '<path d="M6.4 3.6h7l4.2 4.2v12.6H6.4z"/><path d="M13.4 3.6v4.2h4.2"/><path d="M9 12.4h6M9 15.6h6"/>',
    folder: '<path d="M3.4 7.4a1.8 1.8 0 0 1 1.8-1.8h4l2 2.4h7.6a1.8 1.8 0 0 1 1.8 1.8v7.8a1.8 1.8 0 0 1-1.8 1.8H5.2a1.8 1.8 0 0 1-1.8-1.8z"/>',
    trash: '<path d="M5.6 7.4h12.8M9.4 7.4V5.6h5.2v1.8M7 7.4l.8 12.2h8.4L17 7.4"/><path d="M10.4 10.6v6M13.6 10.6v6"/>',
    archive: '<rect x="3.4" y="5" width="17.2" height="4.4" rx="1.2"/><path d="M5.2 9.4v9a1.6 1.6 0 0 0 1.6 1.6h10.4a1.6 1.6 0 0 0 1.6-1.6v-9"/><path d="M10 13h4"/>',
    junk: '<path d="M12 3.6 21 19.4H3z"/><path d="M12 9v5"/><circle class="fill" cx="12" cy="16.8" r="1.2"/>',
    flag: '<path d="M6.4 20V4.4c4-1.6 7.6 1.6 11.2 0v9.2c-3.6 1.6-7.2-1.6-11.2 0"/>',
    reply: '<path d="M9 6 4 11l5 5"/><path d="M4.4 11h9.2a6 6 0 0 1 6 6v1"/>',
    'reply-all': '<path d="M8 6 3 11l5 5M13 6 8 11l5 5"/><path d="M8.4 11h6.2a6 6 0 0 1 6 6v1"/>',
    'forward-mail': '<path d="m15 6 5 5-5 5"/><path d="M19.6 11h-9.2a6 6 0 0 0-6 6v1"/>',
    send: '<path d="M20.4 3.6 3.6 10.4l6.6 2.8 2.8 6.6z"/><path d="m10.2 13.2 10.2-9.6"/>',
    compose: '<path d="M4 20h4.4l10.2-10.2a2.4 2.4 0 0 0-3.4-3.4L5 16.6z"/><path d="m14.4 7.6 3.4 3.4"/>',
    inbox: '<path d="M3.4 12.8 6 5.4h12l2.6 7.4v5.4a1.4 1.4 0 0 1-1.4 1.4H4.8a1.4 1.4 0 0 1-1.4-1.4z"/><path d="M3.4 12.8h4.2l1.2 2.4h6.4l1.2-2.4h4.2"/>',
    star: '<path d="m12 4 2.5 5.4 5.9.7-4.3 4 1.1 5.9L12 17.2 6.8 20l1.1-5.9-4.3-4 5.9-.7z"/>',
    heart: '<path d="M12 19.6C7 16 4 13.2 4 10a4.2 4.2 0 0 1 8-1.6A4.2 4.2 0 0 1 20 10c0 3.2-3 6-8 9.6z"/>',
    play: '<path class="fill" d="m8 5.6 11 6.4-11 6.4z"/>',
    pause: '<path class="fill" d="M8 5.6h3v12.8H8zM13 5.6h3v12.8h-3z"/>',
    next: '<path class="fill" d="m6 6 8 6-8 6z"/><path class="fill" d="M16 6h2.4v12H16z"/>',
    prev: '<path class="fill" d="m18 6-8 6 8 6z"/><path class="fill" d="M5.6 6H8v12H5.6z"/>',
    cpu: '<rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2"/><path d="M10 3.6v2.8M14 3.6v2.8M10 17.6v2.8M14 17.6v2.8M3.6 10h2.8M3.6 14h2.8M17.6 10h2.8M17.6 14h2.8"/>',
    memory: '<rect x="3.4" y="7" width="17.2" height="10" rx="1.8"/><path d="M7 10v4M11 10v4M15 10v4M19 10v4" opacity=".7"/>',
    disk: '<circle cx="12" cy="12" r="8.4"/><circle class="fill" cx="12" cy="12" r="2.2"/>',
    chart: '<path d="M4 19.6h16"/><path d="M7 16V9.4M11.6 16V5.6M16.2 16v-7.4"/>',
    activity: '<path d="M3.4 13h3.4l2.2-6 3 12 2.6-8 1.8 2h4.2"/>',
    terminal: '<rect x="3" y="4.6" width="18" height="14.8" rx="2.2"/><path d="m7.4 10.4 2.6 2.4-2.6 2.4M12.6 15.2h4.2"/>',
    info: '<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.4"/><circle class="fill" cx="12" cy="8.1" r="1.15"/>',
    warning: '<path d="M12 3.6 21 19.4H3z"/><path d="M12 9.2v4.8"/><circle class="fill" cx="12" cy="16.8" r="1.15"/>',
    question: '<circle cx="12" cy="12" r="8.4"/><path d="M9.8 9.4a2.3 2.3 0 0 1 4.5.7c0 1.6-2.3 1.8-2.3 3.5"/><circle class="fill" cx="12" cy="16.6" r="1.1"/>',
    power: '<path d="M12 3.6v7.8"/><path d="M7.4 7.2a6.6 6.6 0 1 0 9.2 0"/>',
    restart: '<path d="M20 12a8 8 0 1 1-2.8-6.1"/><path d="M20 4v4.6h-4.6"/>',
    eject: '<path d="m12 5 7 8H5z"/><path d="M5 17.6h14"/>',
    eye: '<path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z"/><circle cx="12" cy="12" r="2.8"/>',
    'eye-off': '<path d="M4.4 8.4C3.2 9.8 2.8 12 2.8 12s3.4 6 9.2 6c1.5 0 2.8-.4 4-1M9.6 6.4A9.6 9.6 0 0 1 12 6c5.8 0 9.2 6 9.2 6a15 15 0 0 1-2.4 3"/><path d="M4 4l16 16"/>',
    bolt: '<path class="fill" d="M13.4 3.4 6.6 13.2h4.6l-1.2 7.4 7-10.2h-4.6z"/>',
    apps: '<rect x="3.6" y="3.6" width="7" height="7" rx="1.8"/><rect x="13.4" y="3.6" width="7" height="7" rx="1.8"/><rect x="3.6" y="13.4" width="7" height="7" rx="1.8"/><rect x="13.4" y="13.4" width="7" height="7" rx="1.8"/>',
    download: '<path d="M12 4v11M8 11.4l4 4 4-4"/><path d="M4.6 19.4h14.8"/>',
    upload: '<path d="M12 19.4V8.4M8 12l4-4 4 4"/><path d="M4.6 4.6h14.8"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    bookmark: '<path d="M6.4 4.4h11.2v15.2L12 15.6l-5.6 4z"/>',
    history: '<path d="M4 12a8 8 0 1 0 8-8 8 8 0 0 0-6.7 3.6"/><path d="M4 4.4V8h3.6"/><path d="M12 8v4.4l3.4 2"/>',
    tab: '<rect x="3.4" y="5.4" width="17.2" height="13.2" rx="2"/><path d="M3.4 9.4h6.2V5.4"/>',
    window: '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2"/><path d="M3.4 8.6h17.2"/><circle class="fill" cx="6.4" cy="6.6" r="0.9"/><circle class="fill" cx="9" cy="6.6" r="0.9"/>',
    tile: '<rect x="3.4" y="4.6" width="7.6" height="14.8" rx="1.8"/><rect x="13" y="4.6" width="7.6" height="14.8" rx="1.8"/>',
    fullscreen: '<path d="M4.6 9.4V4.6h4.8M19.4 9.4V4.6h-4.8M4.6 14.6v4.8h4.8M19.4 14.6v4.8h-4.8"/>',
    zoom: '<path d="M9.4 4.6H4.6v4.8M14.6 19.4h4.8v-4.8"/><path d="m4.6 4.6 6 6M19.4 19.4l-6-6"/>',
  };

  /** Alias map so callers can use domain names. */
  const ALIAS = {
    'system-settings': 'gear', general: 'gear', sound: 'volume', notifications: 'bell',
    'privacy-security': 'shield', 'users-groups': 'people', 'internet-accounts': 'at',
    'lock-screen': 'lock', 'desktop-dock': 'dock', displays: 'display',
    'printers-scanners': 'printer', 'siri-spotlight': 'siri', 'apple-account': 'icloud',
    'game-center': 'star', 'find-my': 'location', 'software-update': 'update',
    'date-time': 'clock', 'language-region': 'language', 'login-items': 'apps',
    'transfer-reset': 'restart', 'about': 'info', 'screen-time': 'screen-time',
    'wallet-payment': 'storage', 'startup-disk': 'disk',
    /* Mac.paneIcon slugifies a pane's display name, so the hyphenated forms of
       multi-word panes need entries too — without them Mac.glyph silently
       substitutes the generic 'info' icon and the pane looks unfinished. */
    'wi-fi': 'wifi', 'family-sharing': 'family', 'transfer-or-reset': 'restart',
    'wallet-apple-pay': 'storage',
  };

  /**
   * Render a glyph.
   * @param {string} name  glyph key or alias
   * @param {object} opts  {size, cls, stroke, fill}
   */
  Mac.glyph = (name, opts = {}) => {
    const key = G[name] ? name : (ALIAS[name] && G[ALIAS[name]] ? ALIAS[name] : 'info');
    const size = opts.size ? `width="${opts.size}" height="${opts.size}"` : '';
    const cls = opts.cls ? ` class="${opts.cls}"` : '';
    if (opts.fill) {
      return `<svg${cls} ${size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" ` +
        `stroke-width="${opts.stroke || 1}" stroke-linejoin="round" aria-hidden="true">${G[key]}</svg>`;
    }
    return `<svg${cls} ${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="${opts.stroke || 1.7}" stroke-linecap="round" stroke-linejoin="round" ` +
      `aria-hidden="true">${G[key]}</svg>`;
  };

  Mac.hasGlyph = name => Boolean(G[name] || ALIAS[name]);

  /* --------------------------------------------------------- app artwork */

  // Original published artwork; provenance and image hashes are in assets/icons/sources.json.
  const OFFICIAL_APP_ICONS = new Set(['apps','activity-monitor','appstore','calculator','calendar','console','contacts','disk-utility','facetime','freeform','mail','maps','messages','migration','music','notes','photos','podcasts','preview','reminders','screenshot','system-info','settings','terminal','textedit','weather','safari','finder','keychain','outlook','trash-full']);
  Mac.appIcon = (icon, cls = 'app-icon') => {
    const src = `assets/icons/${Mac.esc(icon)}.${OFFICIAL_APP_ICONS.has(icon) ? 'png' : 'svg'}`;
    if (icon === 'calendar') {
      const now = new Date();
      const day = now.toLocaleDateString('en-US', {weekday:'short'});
      // Retain Apple's tile underneath live weekday/day text, without changing the source PNG.
      return `<svg class="${cls}" viewBox="0 0 60 60" aria-hidden="true" focusable="false">
        <image href="${src}" width="60" height="60"/>
        <rect x="10" y="6" width="40" height="15" fill="#fff"/>
        <rect x="7" y="21" width="46" height="31" fill="#fff"/>
        <text x="30" y="18" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" fill="#ed3039">${day}</text>
        <text x="30" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" fill="#181818">${now.getDate()}</text>
      </svg>`;
    }
    return `<img class="${cls}" src="${src}" alt="" aria-hidden="true" draggable="false" decoding="async">`;
  };

  /** Coloured settings squircle wrapping a stroke glyph. */
  const PANE_TINTS = {
    'Wi-Fi': ['#62c8ff', '#1678df'], Bluetooth: ['#55bbff', '#1670dd'],
    Network: ['#64b5ff', '#2e68cc'], Notifications: ['#ff7868', '#d72b32'],
    Sound: ['#ff7184', '#d72d52'], Focus: ['#8b81f5', '#5147c9'],
    'Screen Time': ['#948bf6', '#5b52ca'], General: ['#adb2b9', '#60666f'],
    Appearance: ['#8ecbff', '#4d57d9'], Accessibility: ['#4aaeff', '#1472dc'],
    'Control Center': ['#777d87', '#32363d'], 'Siri & Spotlight': ['#5dd9e3', '#7659d5'],
    'Desktop & Dock': ['#65c6ff', '#3374d7'], Displays: ['#63ceff', '#1882df'],
    Wallpaper: ['#67d5dd', '#5968da'], 'Screen Saver': ['#ff9b5b', '#e34e38'],
    Battery: ['#63df7a', '#20a945'], 'Lock Screen': ['#7b86f5', '#4658cc'],
    'Privacy & Security': ['#51b8ff', '#2561d6'], 'Users & Groups': ['#aeb7c3', '#596372'],
    'Internet Accounts': ['#66c9ff', '#1c76df'], Keyboard: ['#aeb4bd', '#686f79'],
    Trackpad: ['#aeb4bd', '#686f79'], Mouse: ['#aeb4bd', '#686f79'],
    'Printers & Scanners': ['#8e98a5', '#5d6570'], 'Apple Account': ['#8fd0ff', '#2f7cf6'],
    'Family Sharing': ['#7ddc9a', '#1e9e57'], iCloud: ['#8ed6ff', '#3b8ee8'],
    'Wallet & Apple Pay': ['#3c4149', '#16181c'], 'Game Center': ['#ffd06a', '#f08a2c'],
    'Find My': ['#7cd68e', '#22a04f'], 'Software Update': ['#8ec7ff', '#2f6fd8'],
    Storage: ['#a8b0bd', '#5a626e'], 'Time Machine': ['#5fd2c0', '#12857f'],
    'Startup Disk': ['#c3c8d0', '#6b7280'], Sharing: ['#66c9ff', '#1c76df'],
    'Date & Time': ['#adb2b9', '#60666f'], 'Language & Region': ['#8fd0ff', '#2f7cf6'],
    'Transfer or Reset': ['#ffb066', '#e2691f'], AirDrop: ['#66c9ff', '#1c76df'],
    VPN: ['#7b86f5', '#4658cc'], Firewall: ['#51b8ff', '#2561d6'],
  };

  Mac.paneTint = name => PANE_TINTS[name] || ['#70c8ff', '#2877d6'];

  Mac.paneIcon = (name, extraClass = '') => {
    const [a, b] = Mac.paneTint(name);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const rainbow = name === 'Siri & Spotlight' ? ' rainbow' : '';
    return `<span class="settings-icon${rainbow} ${extraClass}" style="--si-a:${a};--si-b:${b}" aria-hidden="true">` +
      `${Mac.glyph(slug, { stroke: 1.9 })}</span>`;
  };

  /** The Apple mark, drawn from the local brand asset path data. */
  Mac.appleMark = () =>
    '<svg viewBox="0 0 84 100" aria-hidden="true">' +
    '<path fill="currentColor" d="M57.8 53.2c-.1-10.4 8.5-15.4 8.9-15.6-4.8-7-12.3-8-15-8.2-6.8-.5-12.5 3.8-15.8 3.8-3.3 0-8.1-3.7-13.3-3.6C15.8 29.7 9 34.4 5.3 41.7c-7.5 13-1.9 32.3 5.4 42.9 3.6 5.2 7.9 10.9 13.6 10.7 5.4-.2 7.5-3.5 14.1-3.5 6.6 0 8.4 3.5 14.1 3.4 5.8-.1 9.5-5.3 13.1-10.5 4.1-6 5.8-11.8 5.9-12.1-.1-.1-11.6-4.5-11.7-19.4z"/>' +
    '<path fill="currentColor" d="M48.6 22.1c2.9-3.5 4.9-8.4 4.4-13.3-4.3.2-9.5 2.9-12.5 6.4-2.7 3.1-5 8.1-4.4 12.9 4.8.4 9.6-2.4 12.5-6z"/></svg>';
}(window.Mac));
