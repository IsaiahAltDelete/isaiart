/* ===========================================================================
   Icons.

   Two families:

   - Win.glyph(name): monochrome 20×20 line glyphs that follow currentColor,
     used for chrome, menus and Settings. Original vector drawings.
   - Win.appIcon(name): colourful app, shell and file icons. Names listed in
     REAL_ICONS use Microsoft's own artwork, stored locally as unaltered PNGs
     in assets/icons (provenance and SHA-256 digests in sources.json). Every
     other name, and file types, use the original 48×48 vector drawings below,
     which also remain as the fallback for every name.
   =========================================================================== */

(function (Win) {
  'use strict';

  const G = {
    search: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.6 12.6 17 17"/>',
    taskview: '<rect x="2.5" y="4" width="9" height="12" rx="1.5"/><rect x="13.5" y="4" width="4" height="5.2" rx="1"/><rect x="13.5" y="10.8" width="4" height="5.2" rx="1"/>',
    widgets: '<rect x="2.5" y="2.5" width="6.5" height="9" rx="1.5"/><rect x="11" y="2.5" width="6.5" height="5" rx="1.5"/><rect x="11" y="9.5" width="6.5" height="8" rx="1.5"/><rect x="2.5" y="13.5" width="6.5" height="4" rx="1.5"/>',
    wifi4: '<path d="M2 7.6a11.4 11.4 0 0 1 16 0M4.6 10.3a7.7 7.7 0 0 1 10.8 0M7.2 13a4 4 0 0 1 5.6 0"/><circle cx="10" cy="15.8" r="1" fill="currentColor" stroke="none"/>',
    wifi3: '<path d="M2 7.6a11.4 11.4 0 0 1 16 0" opacity=".3"/><path d="M4.6 10.3a7.7 7.7 0 0 1 10.8 0M7.2 13a4 4 0 0 1 5.6 0"/><circle cx="10" cy="15.8" r="1" fill="currentColor" stroke="none"/>',
    wifi2: '<path d="M2 7.6a11.4 11.4 0 0 1 16 0M4.6 10.3a7.7 7.7 0 0 1 10.8 0" opacity=".3"/><path d="M7.2 13a4 4 0 0 1 5.6 0"/><circle cx="10" cy="15.8" r="1" fill="currentColor" stroke="none"/>',
    wifi1: '<path d="M2 7.6a11.4 11.4 0 0 1 16 0M4.6 10.3a7.7 7.7 0 0 1 10.8 0M7.2 13a4 4 0 0 1 5.6 0" opacity=".3"/><circle cx="10" cy="15.8" r="1" fill="currentColor" stroke="none"/>',
    wifioff: '<path d="M2 7.6a11.4 11.4 0 0 1 16 0M4.6 10.3a7.7 7.7 0 0 1 10.8 0M7.2 13a4 4 0 0 1 5.6 0" opacity=".3"/><path d="M3 3l14 14"/>',
    wifiwarn: '<path d="M2 7.6a11.4 11.4 0 0 1 16 0M4.6 10.3a7.7 7.7 0 0 1 10.8 0M7.2 13a4 4 0 0 1 5.6 0" opacity=".45"/><circle cx="15.5" cy="15" r="3.6" fill="currentColor" stroke="none"/><path d="M15.5 13.2v2M15.5 16.6v.1" stroke="var(--glyph-knock,#fff)" stroke-width="1.3"/>',
    globe: '<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c-2.6 2.6-2.6 12.4 0 15M10 2.5c2.6 2.6 2.6 12.4 0 15"/>',
    globeoff: '<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c-2.6 2.6-2.6 12.4 0 15M10 2.5c2.6 2.6 2.6 12.4 0 15"/><path d="M3 3l14 14"/>',
    ethernet: '<rect x="3" y="6" width="14" height="9" rx="1.5"/><path d="M6.5 15v2M10 15v2M13.5 15v2M7 6V3.5h6V6"/>',
    vol0: '<path d="M3 7.5h3l4-3.5v12l-4-3.5H3z"/>',
    vol1: '<path d="M3 7.5h3l4-3.5v12l-4-3.5H3z"/><path d="M13 8a3 3 0 0 1 0 4"/>',
    vol2: '<path d="M3 7.5h3l4-3.5v12l-4-3.5H3z"/><path d="M13 8a3 3 0 0 1 0 4M15.2 6a6 6 0 0 1 0 8"/>',
    vol3: '<path d="M3 7.5h3l4-3.5v12l-4-3.5H3z"/><path d="M13 8a3 3 0 0 1 0 4M15.2 6a6 6 0 0 1 0 8M17.2 4a9 9 0 0 1 0 12"/>',
    mute: '<path d="M3 7.5h3l4-3.5v12l-4-3.5H3z"/><path d="M13 7.5l5 5M18 7.5l-5 5"/>',
    battery: '<rect x="1.5" y="6" width="15" height="8" rx="2"/><path d="M18.5 8.5v3"/>',
    charging: '<path d="M10.8 4.5 7 10.5h3.2l-1 5 3.8-6h-3.2z" fill="currentColor" stroke="none"/>',
    bluetooth: '<path d="M6 6.5l8 7-4 3.5V3l4 3.5-8 7"/>',
    airplane: '<path d="M10 2.5c.8 0 1.2.8 1.2 1.6v4.2l6 3.4v1.6l-6-1.8v3.4l1.8 1.4v1.3L10 16.8l-3 .8v-1.3l1.8-1.4v-3.4l-6 1.8v-1.6l6-3.4V4.1c0-.8.4-1.6 1.2-1.6z"/>',
    saver: '<rect x="1.5" y="6" width="15" height="8" rx="2"/><path d="M18.5 8.5v3M9 8l-1.6 2.4h3.2L9 12.8"/>',
    moon: '<path d="M15.5 12.8A6.7 6.7 0 0 1 7.2 4.5a6.7 6.7 0 1 0 8.3 8.3z"/>',
    sun: '<circle cx="10" cy="10" r="3.3"/><path d="M10 2v1.8M10 16.2V18M2 10h1.8M16.2 10H18M4.3 4.3l1.3 1.3M14.4 14.4l1.3 1.3M4.3 15.7l1.3-1.3M14.4 5.6l1.3-1.3"/>',
    access: '<circle cx="10" cy="4" r="1.6"/><path d="M4 6.8c4 1.2 8 1.2 12 0M10 8.2v4.3M10 12.5l-3 5M10 12.5l3 5"/>',
    focus: '<circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="3.5"/>',
    bell: '<path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13zM8.2 17a2 2 0 0 0 3.6 0"/>',
    belloff: '<path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13zM8.2 17a2 2 0 0 0 3.6 0M3 3l14 14"/>',
    cast: '<path d="M2.5 13V5.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-4.5"/><path d="M2.5 16h.1M2.5 13a3 3 0 0 1 3 3M2.5 10a6 6 0 0 1 6 6"/>',
    project: '<rect x="2.5" y="4" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 14v3"/>',
    hotspot: '<circle cx="10" cy="10" r="1.6"/><path d="M6.6 13.4a4.8 4.8 0 0 1 0-6.8M13.4 6.6a4.8 4.8 0 0 1 0 6.8M4.2 15.8a8.2 8.2 0 0 1 0-11.6M15.8 4.2a8.2 8.2 0 0 1 0 11.6"/>',
    chevup: '<path d="M5 12.5 10 7.5l5 5"/>',
    chevdown: '<path d="M5 7.5 10 12.5l5-5"/>',
    chevleft: '<path d="M12.5 5 7.5 10l5 5"/>',
    chevright: '<path d="M7.5 5 12.5 10l-5 5"/>',
    close: '<path d="M5 5l10 10M15 5 5 15"/>',
    minimize: '<path d="M4.5 10h11"/>',
    maximize: '<rect x="4.5" y="4.5" width="11" height="11" rx="1.5"/>',
    restore: '<rect x="4.5" y="6.5" width="9" height="9" rx="1.5"/><path d="M7 4.5h6.5a2 2 0 0 1 2 2V13"/>',
    power: '<path d="M10 2.5v7"/><path d="M6 5a6.5 6.5 0 1 0 8 0"/>',
    lock: '<rect x="4" y="9" width="12" height="8.5" rx="1.8"/><path d="M6.8 9V6.5a3.2 3.2 0 0 1 6.4 0V9"/>',
    signout: '<path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3M12 6.5 15.5 10 12 13.5M15.5 10H7.5"/>',
    sleep: '<path d="M15.5 12.8A6.7 6.7 0 0 1 7.2 4.5a6.7 6.7 0 1 0 8.3 8.3z"/>',
    restart: '<path d="M16 10a6 6 0 1 1-1.8-4.3"/><path d="M15 2.5v3.6h-3.6"/>',
    gear: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5l1.4 1.9 2.3-.5.6 2.3 2.2.9-.6 2.3 1.6 1.7-1.6 1.7.6 2.3-2.2.9-.6 2.3-2.3-.5L10 17.5l-1.4-1.9-2.3.5-.6-2.3-2.2-.9.6-2.3L2.5 10l1.6-1.7-.6-2.3 2.2-.9.6-2.3 2.3.5z"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    more: '<circle cx="4.5" cy="10" r=".9" fill="currentColor"/><circle cx="10" cy="10" r=".9" fill="currentColor"/><circle cx="15.5" cy="10" r=".9" fill="currentColor"/>',
    back: '<path d="M16 10H4.5M9 5 4 10l5 5"/>',
    forward: '<path d="M4 10h11.5M11 5l5 5-5 5"/>',
    up: '<path d="M10 16V4.5M5 9l5-5 5 5"/>',
    refresh: '<path d="M16 10a6 6 0 1 1-1.8-4.3"/><path d="M15 2.5v3.6h-3.6"/>',
    home: '<path d="M3 9.5 10 3.5l7 6V16a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1z"/>',
    star: '<path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>',
    cut: '<circle cx="5.5" cy="14.5" r="2.5"/><circle cx="14.5" cy="14.5" r="2.5"/><path d="M7.3 12.7 15 3M12.7 12.7 5 3"/>',
    copy: '<rect x="6.5" y="6.5" width="10" height="11" rx="1.5"/><path d="M13.5 6.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v8.5A1.5 1.5 0 0 0 5 14h1.5"/>',
    paste: '<rect x="4" y="4" width="12" height="13.5" rx="1.5"/><rect x="7" y="2.5" width="6" height="3" rx="1"/>',
    rename: '<rect x="2.5" y="6" width="15" height="8" rx="1.5"/><path d="M10 4v12M8.5 4h3M8.5 16h3"/>',
    share: '<path d="M10 12.5V3M6.5 6.5 10 3l3.5 3.5M5 9.5H4a1 1 0 0 0-1 1V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5.5a1 1 0 0 0-1-1h-1"/>',
    trash: '<path d="M3.5 5.5h13M8 5.5V3.8h4v1.7M5 5.5l.8 11a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4l.8-11M8.5 9v5.5M11.5 9v5.5"/>',
    sort: '<path d="M6 3.5v13M3 13.5l3 3 3-3M14 16.5v-13M11 6.5l3-3 3 3"/>',
    view: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>',
    list: '<path d="M7 5h10M7 10h10M7 15h10M3 5h.1M3 10h.1M3 15h.1"/>',
    newfolder: '<path d="M2.5 6V4.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/><path d="M10 8.5v5M7.5 11h5"/>',
    folder: '<path d="M2.5 6V4.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/>',
    file: '<path d="M5 2.5h6.5L15.5 6.5V16.5a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M11.5 2.5v4h4"/>',
    pin: '<path d="M12.5 2.5 17.5 7.5l-2.6.9-3.7 3.7.4 3.6-1.3 1.3-3.2-3.2L3 17l3.2-4.1L3 9.7l1.3-1.3 3.6.4 3.7-3.7z"/>',
    unpin: '<path d="M12.5 2.5 17.5 7.5l-2.6.9-3.7 3.7.4 3.6-1.3 1.3-3.2-3.2L3 17l3.2-4.1L3 9.7l1.3-1.3 3.6.4 3.7-3.7zM2.5 2.5l15 15"/>',
    check: '<path d="M4 10.5 8 14.5l8-9"/>',
    info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6.2v.1"/>',
    warning: '<path d="M10 3 18 16.5H2z"/><path d="M10 8v4M10 14.3v.1"/>',
    error: '<circle cx="10" cy="10" r="7.5"/><path d="M7.3 7.3l5.4 5.4M12.7 7.3l-5.4 5.4"/>',
    brightness: '<circle cx="10" cy="10" r="3.3"/><path d="M10 2v1.8M10 16.2V18M2 10h1.8M16.2 10H18M4.3 4.3l1.3 1.3M14.4 14.4l1.3 1.3M4.3 15.7l1.3-1.3M14.4 5.6l1.3-1.3"/>',
    edit: '<path d="M13.5 3.5l3 3-9.5 9.5-3.8.8.8-3.8z"/>',
    mic: '<rect x="7.5" y="2.5" width="5" height="9" rx="2.5"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/>',
    camera: '<path d="M2.5 6.5a1 1 0 0 1 1-1h2.7l1.5-2h4.6l1.5 2h2.7a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/><circle cx="10" cy="10.5" r="3"/>',
    location: '<path d="M10 17.5s5.5-5.2 5.5-9.5a5.5 5.5 0 0 0-11 0c0 4.3 5.5 9.5 5.5 9.5z"/><circle cx="10" cy="8" r="2"/>',
    shield: '<path d="M10 2.5 3.5 5v4.5c0 4 2.8 7 6.5 8 3.7-1 6.5-4 6.5-8V5z"/>',
    update: '<path d="M16 10a6 6 0 0 1-10.6 3.9M4 10a6 6 0 0 1 10.6-3.9"/><path d="M15 2.5v3.6h-3.6M5 17.5v-3.6h3.6"/>',
    apps: '<rect x="3" y="3" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1"/>',
    person: '<circle cx="10" cy="6.5" r="3.5"/><path d="M3.5 17.5c.6-3.5 3.2-5.5 6.5-5.5s5.9 2 6.5 5.5"/>',
    clock: '<circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 2"/>',
    language: '<path d="M2.5 4.5h8M6.5 3v1.5c0 3.5-1.5 6-4 7.5M4.5 7.5c1 2 3 3.5 5 4M11 17.5l3-8 3 8M12.2 14.5h3.6"/>',
    game: '<path d="M6 6h8a4 4 0 0 1 3.9 4.8l-.8 3.8a1.8 1.8 0 0 1-3 .9L12 13.5H8l-2.1 2a1.8 1.8 0 0 1-3-.9l-.8-3.8A4 4 0 0 1 6 6z"/><path d="M6.5 8.5v3M5 10h3M13 9.5h.1M14.5 11h.1"/>',
    palette: '<path d="M10 2.5a7.5 7.5 0 0 0 0 15c1 0 1.5-.6 1.5-1.4 0-1.1-1-1.4-1-2.4 0-.8.6-1.2 1.4-1.2h2a3.6 3.6 0 0 0 3.6-3.6c0-3.6-3.4-6.4-7.5-6.4z"/><circle cx="6.5" cy="9" r=".9" fill="currentColor"/><circle cx="9" cy="6" r=".9" fill="currentColor"/><circle cx="12.8" cy="6.6" r=".9" fill="currentColor"/>',
    system: '<rect x="2.5" y="3.5" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 13.5V17"/>',
    devices: '<rect x="2.5" y="4" width="10" height="8" rx="1.2"/><path d="M5 15h5M7.5 12v3"/><rect x="13.5" y="7" width="4.5" height="9" rx="1"/>',
    network: '<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c-2.6 2.6-2.6 12.4 0 15M10 2.5c2.6 2.6 2.6 12.4 0 15"/>',
    privacy: '<path d="M10 2.5 3.5 5v4.5c0 4 2.8 7 6.5 8 3.7-1 6.5-4 6.5-8V5z"/><path d="M7.5 10l2 2 3.5-4"/>',
    display: '<rect x="2.5" y="3.5" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 13.5V17"/>',
    storage: '<rect x="2.5" y="5" width="15" height="10" rx="2"/><path d="M5.5 10h.1M8 10h6"/>',
    about: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6.2v.1"/>',
    keyboard: '<rect x="2" y="5" width="16" height="10" rx="1.5"/><path d="M5 8h.1M8 8h.1M11 8h.1M14 8h.1M5 11h.1M14 11h.1M7.5 12h5"/>',
    mouse: '<rect x="5.5" y="2.5" width="9" height="15" rx="4.5"/><path d="M10 5v3"/>',
    printer: '<path d="M5.5 7.5V3h9v4.5M5.5 14H3.5a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1h-2"/><rect x="5.5" y="11" width="9" height="6.5" rx=".8"/>',
    vpn: '<path d="M10 2.5 3.5 5v4.5c0 4 2.8 7 6.5 8 3.7-1 6.5-4 6.5-8V5z"/><rect x="7.3" y="9" width="5.4" height="4" rx=".8"/><path d="M8.3 9V7.8a1.7 1.7 0 0 1 3.4 0V9"/>',
    proxy: '<rect x="2.5" y="3.5" width="15" height="5" rx="1.2"/><rect x="2.5" y="11.5" width="15" height="5" rx="1.2"/><path d="M5.5 6h.1M5.5 14h.1"/>',
    data: '<path d="M4 16V9M8 16V5M12 16v-6M16 16V3"/>',
    advanced: '<path d="M4 5h12M4 10h12M4 15h12"/><circle cx="7" cy="5" r="1.6" fill="var(--panel, #fff)"/><circle cx="13" cy="10" r="1.6" fill="var(--panel, #fff)"/><circle cx="8.5" cy="15" r="1.6" fill="var(--panel, #fff)"/>',
    sound: '<path d="M3 7.5h3l4-3.5v12l-4-3.5H3z"/><path d="M13 8a3 3 0 0 1 0 4M15.2 6a6 6 0 0 1 0 8"/>',
    picture: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><circle cx="7" cy="8" r="1.5"/><path d="M2.5 14l4.5-4 3.5 3 2.5-2 4.5 4"/>',
    music: '<path d="M7.5 15V4.5l9-2V13"/><circle cx="5.5" cy="15" r="2"/><circle cx="14.5" cy="13" r="2"/>',
    video: '<rect x="2.5" y="5" width="11" height="10" rx="1.5"/><path d="M13.5 8.5 17.5 6v8l-4-2.5"/>',
    download: '<path d="M10 3v10M5.5 8.5 10 13l4.5-4.5M4 16.5h12"/>',
    document: '<path d="M5 2.5h6.5L15.5 6.5V16.5a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M11.5 2.5v4h4M7 10h6M7 13h6"/>',
    pc: '<rect x="2.5" y="3.5" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 13.5V17"/>',
    drive: '<rect x="2.5" y="6" width="15" height="8" rx="1.5"/><path d="M5.5 10h.1M9 10h5"/>',
    cloud: '<path d="M6 15.5a3.5 3.5 0 0 1-.4-7A4.6 4.6 0 0 1 14.4 7a3.8 3.8 0 0 1 .1 8.5z"/>',
    filter: '<path d="M3 4h14l-5.5 6.5V16l-3 1.5v-7z"/>',
    details: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M12 3.5v13M14 7h1.5M14 10h1.5"/>',
    open: '<path d="M11 3.5h5.5V9M16.5 3.5 9 11M14 12.5V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5"/>',
    play: '<path d="M6 4l10 6-10 6z"/>',
    pause: '<path d="M6.5 4v12M13.5 4v12"/>',
    stop: '<rect x="5" y="5" width="10" height="10" rx="1"/>',
    flag: '<path d="M4.5 17.5V3M4.5 3.5h9.5l-2 3.5 2 3.5H4.5"/>',
    timer: '<circle cx="10" cy="11" r="6.5"/><path d="M10 11V7.5M8 2.5h4"/>',
    alarm: '<circle cx="10" cy="11" r="6"/><path d="M10 8v3l2 1.5M3 5l2.5-2M17 5l-2.5-2"/>',
    stopwatch: '<circle cx="10" cy="11" r="6.5"/><path d="M10 11l2.5-2.5M8 2.5h4M15.5 5l1 1"/>',
    world: '<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c-2.6 2.6-2.6 12.4 0 15M10 2.5c2.6 2.6 2.6 12.4 0 15"/>',
    undo: '<path d="M7 5.5 3.5 9 7 12.5"/><path d="M3.5 9h8.5a4.5 4.5 0 0 1 0 9H9"/>',
    redo: '<path d="M13 5.5 16.5 9 13 12.5"/><path d="M16.5 9H8a4.5 4.5 0 0 0 0 9h3"/>',
    brush: '<path d="M16.5 3.5 9 11l-1.8-1.8 7.5-7.5zM7 11.5c-2 0-3 1.5-3 3s-1 2.5-1.5 2.5c3.5 1 6.5-.5 6.5-3.5z"/>',
    eraser: '<path d="M7.5 17h9M3.6 12.6l8.2-8.2a1.5 1.5 0 0 1 2.1 0l2.7 2.7a1.5 1.5 0 0 1 0 2.1L9.5 16.3a2 2 0 0 1-1.4.7H6.6a2 2 0 0 1-1.4-.6l-1.6-1.6a1.5 1.5 0 0 1 0-2.2z"/>',
    fill: '<path d="M4 9.5 9.5 4l6 6-5.5 5.5a1.5 1.5 0 0 1-2.1 0L4 11.6a1.5 1.5 0 0 1 0-2.1zM4 9.5h11.5M16.5 13.5s1.5 1.8 1.5 2.8a1.5 1.5 0 0 1-3 0c0-1 1.5-2.8 1.5-2.8z"/>',
    text: '<path d="M4 5V3.5h12V5M10 3.5v13M7.5 16.5h5"/>',
    shapes: '<rect x="2.5" y="9.5" width="8" height="8" rx="1"/><circle cx="13" cy="7" r="4.5"/>',
    zoomin: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.6 12.6 17 17M6 8.5h5M8.5 6v5"/>',
    zoomout: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.6 12.6 17 17M6 8.5h5"/>',
    rotate: '<path d="M4 10a6 6 0 1 0 1.8-4.3"/><path d="M5 2.5v3.6h3.6"/>',
    heart: '<path d="M10 16.5s-6.5-4-6.5-8.5A3.5 3.5 0 0 1 10 6a3.5 3.5 0 0 1 6.5 2c0 4.5-6.5 8.5-6.5 8.5z"/>',
    terminal: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M6 8l2.5 2L6 12M10.5 12.5h3.5"/>',
    tab: '<rect x="2.5" y="4.5" width="15" height="11" rx="1.5"/><path d="M2.5 8h7V4.5"/>',
    collection: '<rect x="3" y="5.5" width="11" height="11" rx="1.5"/><path d="M6 3.5h9.5a1.5 1.5 0 0 1 1.5 1.5v9.5"/>',
    history: '<path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6"/><path d="M3 3v3.5h3.5M10 6.5V10l2.5 1.5"/>',
    reading: '<path d="M10 5.5c-2-1.5-4.5-2-7-2v12c2.5 0 5 .5 7 2 2-1.5 4.5-2 7-2v-12c-2.5 0-5 .5-7 2zM10 5.5v12"/>',
    lock2: '<rect x="5" y="9" width="10" height="8" rx="1.5"/><path d="M7.2 9V7a2.8 2.8 0 0 1 5.6 0v2"/>',
    windows: '<path d="M3 3h6.5v6.5H3zM10.5 3H17v6.5h-6.5zM3 10.5h6.5V17H3zM10.5 10.5H17V17h-6.5z" fill="currentColor" stroke="none"/>',
    emoji: '<circle cx="10" cy="10" r="7.5"/><path d="M7 12a4 4 0 0 0 6 0M7.5 8h.1M12.5 8h.1"/>',
    question: '<circle cx="10" cy="10" r="7.5"/><path d="M7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.6M10 14.3v.1"/>',
    key: '<circle cx="6.5" cy="13.5" r="3.5"/><path d="M9 11 16.5 3.5M14 6l2 2M12 8l1.5 1.5"/>',
    fingerprint: '<path d="M5 6.5a6 6 0 0 1 10 0M4 10a6 6 0 0 1 .3-2M16 10c0 3-1 5-2 6.5M7 16c1-1.5 1.5-3.5 1.5-6a1.5 1.5 0 0 1 3 0c0 3-.6 5.3-1.6 7M6.5 10a3.5 3.5 0 0 1 7 0"/>',
    face: '<path d="M3 7V5a2 2 0 0 1 2-2h2M13 3h2a2 2 0 0 1 2 2v2M17 13v2a2 2 0 0 1-2 2h-2M7 17H5a2 2 0 0 1-2-2v-2"/><path d="M7.5 8v1M12.5 8v1M10 9v2.5H9M7.5 13.5a3.5 3.5 0 0 0 5 0"/>',
    family: '<circle cx="7" cy="6" r="2.5"/><circle cx="14" cy="7.5" r="2"/><path d="M2.5 16c.4-3 2.2-5 4.5-5s4.1 2 4.5 5M11.5 12.2c.7-.8 1.5-1.2 2.5-1.2 1.8 0 3.2 1.5 3.5 4"/>',
    mail: '<rect x="2.5" y="4.5" width="15" height="11" rx="1.5"/><path d="M3 5.5l7 5.5 7-5.5"/>',
    calendar: '<rect x="2.5" y="4" width="15" height="13" rx="1.5"/><path d="M2.5 8h15M6.5 2.5v3M13.5 2.5v3"/>',
    taskmgr: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M4.5 12h2l1.5-4 2 6 1.5-3h4"/>',
    snap: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M10 3.5v13"/>',
    phone: '<rect x="5.5" y="2" width="9" height="16" rx="2"/><path d="M8.5 15.5h3"/>',
    headphones: '<path d="M3.5 13v-2.5a6.5 6.5 0 0 1 13 0V13"/><rect x="2.5" y="12" width="3.5" height="5" rx="1"/><rect x="14" y="12" width="3.5" height="5" rx="1"/>',
    speaker: '<rect x="5" y="2.5" width="10" height="15" rx="1.5"/><circle cx="10" cy="12" r="2.8"/><path d="M10 6h.1"/>',
    usb: '<path d="M10 2.5v11M7.5 5 10 2.5 12.5 5M10 13.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4M10 10.5 6 8V6.5M10 9l4-2V5.5"/>',
    eye: '<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.5"/>',
    sparkle: '<path d="M10 2.5 11.6 8.4 17.5 10l-5.9 1.6L10 17.5l-1.6-5.9L2.5 10l5.9-1.6z"/>',
  };

  Win.glyph = (name, size = 16, cls = '') =>
    `<svg class="glyph ${cls}" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G[name] || G.file}</svg>`;

  Win.glyphs = G;

  /* ------------------------------------------------------------ app icons */

  const defs = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;

  const A = {
    explorer: () => `<defs>${defs('gx1', [[0, '#ffd75e'], [1, '#f2a91c']])}${defs('gx2', [[0, '#ffe58a'], [1, '#ffc83d']])}</defs>
      <path d="M4 12a3 3 0 0 1 3-3h10l4 4h20a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="url(#gx1)"/>
      <path d="M4 19a3 3 0 0 1 3-3h34a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="url(#gx2)"/>
      <rect x="4" y="27" width="40" height="5" fill="#2d7ff9"/>`,
    folder: () => `<defs>${defs('gf1', [[0, '#ffd75e'], [1, '#f2a91c']])}${defs('gf2', [[0, '#ffe58a'], [1, '#ffc83d']])}</defs>
      <path d="M4 12a3 3 0 0 1 3-3h10l4 4h20a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="url(#gf1)"/>
      <path d="M4 19a3 3 0 0 1 3-3h34a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="url(#gf2)"/>`,
    edge: () => `<defs>${defs('ge1', [[0, '#37c4f0'], [1, '#0c59a4']])}${defs('ge2', [[0, '#5bd96f'], [1, '#1d9fd8']])}</defs>
      <path d="M42 30c-2 7-9 13-18 13C13 43 5 35 5 24 5 13 14 5 24 5c10 0 18 7 18 15 0 6-5 9-10 9-4 0-7-2-7-4 0-1 1-2 1-4 0-4-4-7-8-7-6 0-11 5-11 12" fill="none" stroke="url(#ge1)" stroke-width="7" stroke-linecap="round"/>
      <path d="M14 33c3 5 9 8 15 7" fill="none" stroke="url(#ge2)" stroke-width="7" stroke-linecap="round"/>`,
    settings: () => `<defs>${defs('gs1', [[0, '#8a96a8'], [1, '#4a5568']])}</defs>
      <path d="M24 5l3.5 4.6 5.7-1.3 1.4 5.7 5.5 2.2-1.4 5.7L42.6 26l-3.9 4.1 1.4 5.7-5.5 2.2-1.4 5.7-5.7-1.3L24 47l-3.5-4.6-5.7 1.3-1.4-5.7-5.5-2.2 1.4-5.7L5.4 26l3.9-4.1-1.4-5.7 5.5-2.2 1.4-5.7 5.7 1.3z" fill="url(#gs1)" transform="translate(0 -2)"/>
      <circle cx="24" cy="24" r="7" fill="#e6ebf2"/><circle cx="24" cy="24" r="3.5" fill="#4a5568"/>`,
    store: () => `<defs>${defs('gst', [[0, '#f4f6f9'], [1, '#d5dbe4']])}</defs><path d="M8 15h32l-2 25a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3z" fill="url(#gst)" stroke="#8a96a8" stroke-width="1"/><path d="M17 15v-3a7 7 0 0 1 14 0v3" fill="none" stroke="#8a96a8" stroke-width="3"/>
      <rect x="15" y="21" width="8" height="8" fill="#f35325"/><rect x="25" y="21" width="8" height="8" fill="#81bc06"/><rect x="15" y="31" width="8" height="8" fill="#05a6f0"/><rect x="25" y="31" width="8" height="8" fill="#ffba08"/>`,
    notepad: () => `<rect x="9" y="6" width="30" height="37" rx="3" fill="#f7f9fc" stroke="#9aa6b8"/><rect x="9" y="6" width="30" height="8" rx="3" fill="#3a8ee6"/>
      <path d="M15 21h18M15 27h18M15 33h12" stroke="#7d8aa0" stroke-width="2" stroke-linecap="round"/><path d="M14 4v6M20 4v6M26 4v6M32 4v6" stroke="#2a64a8" stroke-width="2" stroke-linecap="round"/>`,
    calculator: () => `<rect x="9" y="4" width="30" height="40" rx="4" fill="#2b2f3a"/><rect x="13" y="8" width="22" height="9" rx="1.5" fill="#9fb4cc"/>
      ${[0, 1, 2].map(r => [0, 1, 2, 3].map(c => `<rect x="${13 + c * 5.8}" y="${21 + r * 7}" width="4.4" height="5" rx="1" fill="${c === 3 ? '#3a8ee6' : '#5d6475'}"/>`).join('')).join('')}`,
    terminal: () => `<rect x="4" y="7" width="40" height="34" rx="4" fill="#1d1f27"/><rect x="4" y="7" width="40" height="7" rx="4" fill="#3b3f4d"/><rect x="4" y="11" width="40" height="3" fill="#3b3f4d"/>
      <path d="M11 21l6 5-6 5" fill="none" stroke="#e8e8e8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 32h10" stroke="#e8e8e8" stroke-width="2.6" stroke-linecap="round"/>`,
    powershell: () => `<defs>${defs('gp1', [[0, '#3a7bd5'], [1, '#1f3f86']])}</defs><path d="M10 8h32l-5 32H5z" fill="url(#gp1)"/>
      <path d="M13 17l9 7-12 8" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M23 33h9" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/>`,
    cmd: () => `<rect x="4" y="7" width="40" height="34" rx="3" fill="#0c0c0c" stroke="#5a5a5a"/><text x="9" y="30" font-family="Consolas,monospace" font-size="12" fill="#cccccc">C:\\&gt;_</text>`,
    taskmgr: () => `<rect x="5" y="7" width="38" height="34" rx="4" fill="#1f6fd1"/><rect x="9" y="11" width="30" height="26" rx="2" fill="#e9f2ff"/>
      <path d="M11 29h5l3-9 4 13 3-7 3 3h6" fill="none" stroke="#1f6fd1" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    photos: () => `<defs>${defs('gph', [[0, '#5ab4ff'], [1, '#2b5fd9']])}</defs><rect x="5" y="8" width="38" height="32" rx="5" fill="url(#gph)"/>
      <circle cx="31" cy="18" r="4" fill="#ffe066"/><path d="M5 34l11-12 9 9 5-5 13 11v0a5 5 0 0 1-5 3H10a5 5 0 0 1-5-5z" fill="#d7ecff"/>`,
    paint: () => `<path d="M24 5C13 5 5 13 5 23c0 9 7 15 13 15 3 0 4-2 4-4 0-3-2-4-2-6 0-1.5 1.2-2.5 2.8-2.5H28c8 0 14-4 14-11C42 9 34 5 24 5z" fill="#f2f2f2" stroke="#b9b9b9"/>
      <circle cx="13" cy="21" r="3.4" fill="#e74856"/><circle cx="18" cy="13" r="3.4" fill="#ffb900"/><circle cx="27" cy="11" r="3.4" fill="#16c60c"/><circle cx="35" cy="16" r="3.4" fill="#0078d4"/>
      <path d="M44 26 30 43l-3-3 15-16z" fill="#8b5a2b"/><path d="M27 40l3 3-5 2z" fill="#333"/>`,
    clock: () => `<circle cx="24" cy="24" r="19" fill="#1c5fc4"/><circle cx="24" cy="24" r="15" fill="#f4f7fb"/><path d="M24 13v11l7 5" fill="none" stroke="#1c2a44" stroke-width="3" stroke-linecap="round"/>`,
    recycle: () => `<path d="M11 14h26l-2.5 26a3 3 0 0 1-3 2.7h-15a3 3 0 0 1-3-2.7z" fill="#dfe8f2" stroke="#7d93ad" stroke-width="1.5"/><rect x="9" y="10" width="30" height="5" rx="1.5" fill="#b8c8da" stroke="#7d93ad" stroke-width="1.5"/>
      <path d="M18 20v17M24 20v17M30 20v17" stroke="#9fb3c9" stroke-width="2" stroke-linecap="round"/>`,
    recyclefull: () => `<path d="M11 14h26l-2.5 26a3 3 0 0 1-3 2.7h-15a3 3 0 0 1-3-2.7z" fill="#dfe8f2" stroke="#7d93ad" stroke-width="1.5"/>
      <path d="M13 13l6-7 6 4 5-5 6 8z" fill="#f5f0dc" stroke="#9f9a85"/><rect x="9" y="11" width="30" height="5" rx="1.5" fill="#b8c8da" stroke="#7d93ad" stroke-width="1.5"/>
      <path d="M18 21v16M24 21v16M30 21v16" stroke="#9fb3c9" stroke-width="2" stroke-linecap="round"/>`,
    thispc: () => `<rect x="4" y="8" width="40" height="27" rx="3" fill="#2a3446"/><rect x="7" y="11" width="34" height="21" rx="1.5" fill="#4ba3f5"/><path d="M7 26l10-8 7 5 6-4 11 9v4H7z" fill="#2f7fd5"/><rect x="18" y="35" width="12" height="4" fill="#5d6a80"/><rect x="13" y="39" width="22" height="3" rx="1.5" fill="#8794a9"/>`,
    controlpanel: () => `<rect x="5" y="8" width="38" height="32" rx="4" fill="#3a6fc4"/><rect x="10" y="14" width="12" height="9" rx="1.5" fill="#ffd75e"/><rect x="26" y="14" width="12" height="9" rx="1.5" fill="#7fd27f"/><rect x="10" y="26" width="12" height="9" rx="1.5" fill="#ff8f6b"/><rect x="26" y="26" width="12" height="9" rx="1.5" fill="#c3dcff"/>`,
    mail: () => `<defs>${defs('gm', [[0, '#3c9bf0'], [1, '#1756c4']])}</defs><rect x="4" y="10" width="40" height="28" rx="4" fill="url(#gm)"/><path d="M6 13l18 13 18-13" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>`,
    snip: () => `<rect x="6" y="9" width="36" height="30" rx="4" fill="#fff" stroke="#9aa6b8" stroke-dasharray="4 3" stroke-width="2"/><circle cx="18" cy="31" r="5" fill="none" stroke="#e74856" stroke-width="3"/><circle cx="30" cy="31" r="5" fill="none" stroke="#e74856" stroke-width="3"/><path d="M21 27l9-14M27 27l-9-14" stroke="#333" stroke-width="2.6" stroke-linecap="round"/>`,
    weather: () => `<circle cx="19" cy="18" r="8" fill="#ffc83d"/><path d="M15 40a8 8 0 0 1-1-16 11 11 0 0 1 21 2 7 7 0 0 1 0 14z" fill="#e8f1ff" stroke="#9cb6d8"/>`,
    copilot: () => `<defs>${defs('gc1', [[0, '#26c0f3'], [.5, '#8b5cf6'], [1, '#f43f8e']])}</defs><path d="M17 8h14c5 0 8 3 9 7l3 14c1 5-3 11-9 11H20c-5 0-8-3-9-7L8 19C7 13 11 8 17 8z" fill="url(#gc1)"/><circle cx="19" cy="23" r="3" fill="#fff"/><circle cx="29" cy="23" r="3" fill="#fff"/>`,
    user: () => `<circle cx="24" cy="24" r="21" fill="#c7d6ec"/><circle cx="24" cy="19" r="8" fill="#6f86a8"/><path d="M9 39c3-7 8-10 15-10s12 3 15 10a20 20 0 0 1-30 0z" fill="#6f86a8"/>`,
    txt: () => fileShape('#ffffff', '#7d8aa0', '<path d="M16 22h16M16 27h16M16 32h11" stroke="#7d8aa0" stroke-width="2" stroke-linecap="round"/>'),
    doc: () => fileShape('#ffffff', '#2b5fd9', '<rect x="11" y="24" width="18" height="14" rx="2" fill="#2b5fd9"/><path d="M14 28l2 7 2-5 2 5 2-7" fill="none" stroke="#fff" stroke-width="1.5"/>'),
    xls: () => fileShape('#ffffff', '#107c41', '<rect x="11" y="24" width="18" height="14" rx="2" fill="#107c41"/><path d="M15 27l6 8M21 27l-6 8" stroke="#fff" stroke-width="1.8"/>'),
    pdf: () => fileShape('#ffffff', '#d13438', '<rect x="11" y="24" width="20" height="12" rx="2" fill="#d13438"/><text x="13" y="33.5" font-size="8" font-weight="700" font-family="Segoe UI,Arial" fill="#fff">PDF</text>'),
    img: () => fileShape('#ffffff', '#3a8ee6', '<rect x="13" y="20" width="22" height="17" rx="2" fill="#bfe0ff"/><circle cx="29" cy="25" r="2.5" fill="#ffc83d"/><path d="M13 35l7-7 5 5 3-3 7 7z" fill="#3a8ee6"/>'),
    audio: () => fileShape('#ffffff', '#c239b3', '<path d="M21 34V22l10-2v11" fill="none" stroke="#c239b3" stroke-width="2"/><circle cx="19" cy="34" r="2.5" fill="#c239b3"/><circle cx="29" cy="31" r="2.5" fill="#c239b3"/>'),
    vid: () => fileShape('#ffffff', '#7a5af8', '<rect x="13" y="22" width="22" height="15" rx="2" fill="#7a5af8"/><path d="M21 26l6 3.5-6 3.5z" fill="#fff"/>'),
    zip: () => fileShape('#fff7d6', '#c9a227', '<path d="M24 10v4M24 16v4M24 22v4" stroke="#8a6d10" stroke-width="2.5"/><rect x="20" y="27" width="8" height="8" rx="1.5" fill="#8a6d10"/>'),
    exe: () => fileShape('#ffffff', '#5d6475', '<rect x="13" y="21" width="22" height="16" rx="2" fill="#dfe6f0" stroke="#5d6475"/><rect x="13" y="21" width="22" height="4" fill="#5d6475"/>'),
    csv: () => fileShape('#ffffff', '#107c41', '<path d="M14 22h20M14 27h20M14 32h20M21 20v15M28 20v15" stroke="#107c41" stroke-width="1.5"/>'),
    generic: () => fileShape('#ffffff', '#9aa6b8', ''),
    drive: () => `<rect x="5" y="15" width="38" height="18" rx="3" fill="#dbe2ea" stroke="#8a97a8"/><rect x="5" y="27" width="38" height="6" rx="2" fill="#aab6c5"/><circle cx="37" cy="30" r="1.6" fill="#16c60c"/>`,
    windrive: () => `<rect x="5" y="17" width="38" height="18" rx="3" fill="#dbe2ea" stroke="#8a97a8"/><rect x="5" y="29" width="38" height="6" rx="2" fill="#aab6c5"/><circle cx="37" cy="32" r="1.6" fill="#16c60c"/><g transform="translate(17 5)"><rect width="6" height="6" fill="#0a7ce0"/><rect x="7" width="6" height="6" fill="#0a7ce0"/><rect y="7" width="6" height="6" fill="#0a7ce0"/><rect x="7" y="7" width="6" height="6" fill="#0a7ce0"/></g>`,
    usb: () => `<rect x="12" y="6" width="24" height="36" rx="3" fill="#dbe2ea" stroke="#8a97a8"/><rect x="17" y="2" width="14" height="6" fill="#aab6c5"/><circle cx="24" cy="30" r="3" fill="#3a8ee6"/>`,
    network: () => `<rect x="6" y="9" width="36" height="22" rx="3" fill="#2a3446"/><rect x="9" y="12" width="30" height="16" rx="1" fill="#4ba3f5"/><path d="M24 31v6M12 40h24M12 37v3M36 37v3" stroke="#5d6a80" stroke-width="2.5"/>`,
    onedrive: () => `<path d="M14 36a8 8 0 0 1-1-15.9A11 11 0 0 1 33.5 17 8.5 8.5 0 0 1 35 36z" fill="#1490df"/>`,
    gallery: () => `<rect x="5" y="10" width="38" height="28" rx="4" fill="#ff8c42"/><circle cx="32" cy="19" r="4" fill="#ffe066"/><path d="M5 33l11-11 8 8 5-4 14 10v1a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="#ffd2a6"/>`,
    windows: () => `<defs>${defs('gw', [[0, '#4cc2ff'], [1, '#0067c0']])}</defs><g fill="url(#gw)"><rect x="6" y="6" width="17" height="17" rx="1"/><rect x="25" y="6" width="17" height="17" rx="1"/><rect x="6" y="25" width="17" height="17" rx="1"/><rect x="25" y="25" width="17" height="17" rx="1"/></g>`,
  };

  function fileShape(fill, accent, inner) {
    return `<path d="M11 4h18l10 10v28a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="${fill}" stroke="#a4afbf"/>
      <path d="M29 4v8a2 2 0 0 0 2 2h8" fill="#e6ebf2" stroke="#a4afbf"/><rect x="9" y="41" width="30" height="3" rx="1" fill="${accent}" opacity=".8"/>${inner}`;
  }

  /* Real Windows artwork, served from this site only (never Microsoft servers).
     Keys are icon names; values are files in assets/icons. */
  const REAL_ICONS = {
    explorer: 'explorer.png', edge: 'edge.png', settings: 'settings.png', store: 'store.png',
    notepad: 'notepad.png', calculator: 'calculator.png', terminal: 'terminal.png',
    powershell: 'powershell.png', cmd: 'cmd.png', taskmgr: 'taskmgr.png', photos: 'photos.png',
    paint: 'paint.png', clock: 'clock.png', controlpanel: 'controlpanel.png', mail: 'mail.png',
    snip: 'snip.png', weather: 'weather.png', copilot: 'copilot.png',
    recycle: 'recycle.png', recyclefull: 'recyclefull.png', thispc: 'thispc.png', folder: 'folder.png',
    drive: 'drive.png', windrive: 'windrive.png', usb: 'usb.png', network: 'network.png',
    onedrive: 'onedrive.png', gallery: 'gallery.png', user: 'user.png',
  };
  /* Explorer composes known-folder badges by appending SVG before `</svg>`, so
     these names wrap the PNG in an <svg><image> to keep that seam working. */
  const SVG_WRAPPED = new Set(['folder']);
  const ICON_DIR = 'assets/icons/';

  let counter = 0;
  /** Gradient ids must be unique per document, so each render rewrites them. */
  Win.appIcon = (name, size = 32, cls = '') => {
    const file = Object.prototype.hasOwnProperty.call(REAL_ICONS, name) ? REAL_ICONS[name] : null;
    if (file && SVG_WRAPPED.has(name)) {
      return `<svg class="app-icon ${cls}" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><image href="${ICON_DIR}${file}" width="48" height="48" preserveAspectRatio="xMidYMid meet"/></svg>`;
    }
    if (file) {
      return `<img class="app-icon ${cls}" src="${ICON_DIR}${file}" width="${size}" height="${size}" alt="" draggable="false">`;
    }
    const draw = A[name] || A.generic;
    const n = ++counter;
    const body = draw().replace(/id="(g[a-z0-9]+)"/g, `id="$1-${n}"`).replace(/url\(#(g[a-z0-9]+)\)/g, `url(#$1-${n})`);
    return `<svg class="app-icon ${cls}" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
  };

  Win.appIcons = A;

  /** Icon for a file by extension. */
  Win.fileIcon = (node, size = 32) => {
    if (!node) return Win.appIcon('generic', size);
    if (node.kind === 'folder') return Win.appIcon(node.icon || 'folder', size);
    if (node.kind === 'drive') return Win.appIcon(node.icon || 'drive', size);
    if (node.kind === 'shortcut') return Win.appIcon(Win.apps.get(node.app)?.icon || 'generic', size);
    const ext = (node.ext || '').toLowerCase();
    const map = {
      txt: 'txt', log: 'txt', md: 'txt', ini: 'txt', bat: 'cmd', ps1: 'powershell',
      docx: 'doc', doc: 'doc', rtf: 'doc', xlsx: 'xls', pdf: 'pdf', csv: 'csv',
      png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', bmp: 'img', webp: 'img', svg: 'img',
      mp3: 'audio', wav: 'audio', m4a: 'audio', mp4: 'vid', mov: 'vid', mkv: 'vid',
      zip: 'zip', '7z': 'zip', exe: 'exe', msi: 'exe',
    };
    return Win.appIcon(map[ext] || 'generic', size);
  };
})(window.Win);
