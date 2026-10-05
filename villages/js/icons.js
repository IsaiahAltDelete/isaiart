// Small illustrated SVG icons, drawn on a 32×32 grid with a warm outline.
const O = 'stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"';

const P = {
  coin: `<circle cx="16" cy="16" r="12" fill="#f6c53f" ${O}/><circle cx="16" cy="16" r="8.5" fill="#ffdc6b"/><path d="M16 9.5l2 4.2 4.5.5-3.4 3 1 4.5-4.1-2.4-4.1 2.4 1-4.5-3.4-3 4.5-.5z" fill="#f0a826"/>`,
  wood: `<rect x="4" y="11" width="22" height="11" rx="5.5" fill="#b9773e" ${O}/><ellipse cx="25" cy="16.5" rx="4" ry="5.5" fill="#e9c08a" ${O}/><ellipse cx="25" cy="16.5" rx="1.6" ry="2.4" fill="#c89458"/><path d="M8 14.5h9M10 19h8" stroke="#8a5428" stroke-width="1.4" stroke-linecap="round"/>`,
  plank: `<rect x="3" y="7" width="26" height="6" rx="1.5" fill="#dca76a" ${O}/><rect x="3" y="13.5" width="26" height="6" rx="1.5" fill="#c99257" ${O}/><rect x="3" y="20" width="26" height="6" rx="1.5" fill="#dca76a" ${O}/>`,
  stone: `<path d="M5 22l3-9 7-5 8 2 5 8-2 7-12 2z" fill="#a9adb0" ${O}/><path d="M9 14l6 3 8-6M15 17l1 9" stroke="#80858a" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  brick: `<rect x="3" y="7" width="12" height="7" rx="1" fill="#c4643f" ${O}/><rect x="17" y="7" width="12" height="7" rx="1" fill="#d27350" ${O}/><rect x="9" y="16" width="14" height="7" rx="1" fill="#c4643f" ${O}/><rect x="3" y="16" width="5" height="7" rx="1" fill="#d27350" ${O}/><rect x="24" y="16" width="5" height="7" rx="1" fill="#d27350" ${O}/>`,
  wheat: `<path d="M16 29V9" ${O} fill="none"/><g fill="#efc14d" ${O}><ellipse cx="13" cy="10" rx="2.4" ry="4" transform="rotate(-25 13 10)"/><ellipse cx="19" cy="10" rx="2.4" ry="4" transform="rotate(25 19 10)"/><ellipse cx="13" cy="16.5" rx="2.4" ry="4" transform="rotate(-25 13 16.5)"/><ellipse cx="19" cy="16.5" rx="2.4" ry="4" transform="rotate(25 19 16.5)"/><ellipse cx="16" cy="5.5" rx="2.2" ry="3.6"/></g>`,
  flour: `<path d="M9 9c-2 6-3 12-1 18h16c2-6 1-12-1-18z" fill="#f4ecdc" ${O}/><path d="M9 9c3-2 11-2 14 0" fill="none" ${O}/><path d="M12 6l4 3 4-3" fill="none" ${O}/><path d="M13 18h6" stroke="#c9b48a" stroke-width="2" stroke-linecap="round"/>`,
  apple: `<path d="M16 10c-5-3-11 0-11 7 0 6 4 11 8 11 1.5 0 2-.7 3-.7s1.5.7 3 .7c4 0 8-5 8-11 0-7-6-10-11-7z" fill="#e2413c" ${O}/><path d="M16 10c0-3 1-5 3-6" fill="none" ${O}/><path d="M17 7c3-2 6-1 7 1-3 1-5 1-7-1z" fill="#6cb84a" ${O}/><ellipse cx="10.5" cy="15" rx="1.6" ry="2.6" fill="#ff8a7a"/>`,
  gem: `<path d="M8 6h16l5 7-13 14L3 13z" fill="#a66be0" ${O}/><path d="M3 13h26M12 6l-3 7 7 14 7-14-3-7" fill="none" stroke="#5b3a1e" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 13l3-7h8l3 7z" fill="#c79af2"/>`,
  hammer: `<rect x="14" y="12" width="4.5" height="17" rx="2" fill="#b9773e" ${O} transform="rotate(-30 16 20)"/><path d="M6 8l10-4 6 5-3 4-5-2-5 2z" fill="#9aa1a8" ${O}/>`,
  flower: `<path d="M16 29V17" stroke="#4d8f34" stroke-width="2.4" stroke-linecap="round"/><path d="M16 24c-3-3-6-2-7 0 3 1 5 1 7 0z" fill="#6cb84a" ${O}/><g fill="#f26c9a" ${O}><circle cx="16" cy="7.5" r="4"/><circle cx="22" cy="12" r="4"/><circle cx="19.5" cy="18" r="4"/><circle cx="12.5" cy="18" r="4"/><circle cx="10" cy="12" r="4"/></g><circle cx="16" cy="13" r="3.4" fill="#ffd54f" ${O}/>`,
  person: `<circle cx="16" cy="10" r="6" fill="#f2c9a0" ${O}/><path d="M10 9c0-5 12-5 12 0-3-2-9-2-12 0z" fill="#6b4226" ${O}/><path d="M5 29c0-7 5-11 11-11s11 4 11 11z" fill="#4f8fd9" ${O}/>`,
  people: `<circle cx="11" cy="11" r="5" fill="#f2c9a0" ${O}/><circle cx="22" cy="12" r="4.5" fill="#d9a77c" ${O}/><path d="M17 29c0-5 2-9 6-9s7 4 7 9z" fill="#5cb85c" ${O}/><path d="M2 29c0-6 4-10 9-10s9 4 9 10z" fill="#e8a23c" ${O}/>`,
  bag: `<path d="M7 12h18l2 16H5z" fill="#c98a4a" ${O}/><path d="M11 12V9a5 5 0 0110 0v3" fill="none" ${O}/><rect x="13" y="16" width="6" height="5" rx="1" fill="#f6c53f" ${O}/>`,
  map: `<path d="M3 8l8-3 10 3 8-3v19l-8 3-10-3-8 3z" fill="#9ed36a" ${O}/><path d="M11 5v19M21 8v19" stroke="#5b3a1e" stroke-width="1.2"/><path d="M16 9c-3 0-5 2-5 4.5 0 3.5 5 8.5 5 8.5s5-5 5-8.5C21 11 19 9 16 9z" fill="#e2413c" ${O}/><circle cx="16" cy="13.5" r="1.8" fill="#fff"/>`,
  gear: `<path d="M14 3h4l1 4 3 1.5 3.6-2 2.8 2.8-2 3.6L28 16l.0 0 0 4-4 1-1.5 3 2 3.6-2.8 2.8-3.6-2-3 1.5-1 3.6h-4l-1-3.6-3-1.5-3.6 2-2.8-2.8 2-3.6L4 20l-1-.1V16l4-1 1.5-3-2-3.6 2.8-2.8 3.6 2L14 6.5z" fill="#c9ccd0" ${O}/><circle cx="16" cy="16.5" r="4.5" fill="#f4eee0" ${O}/>`,
  trophy: `<path d="M9 4h14v7a7 7 0 01-14 0z" fill="#f6c53f" ${O}/><path d="M9 7H4c0 5 3 7 5 7M23 7h5c0 5-3 7-5 7" fill="none" ${O}/><path d="M14 18h4v5h-4z" fill="#e8a826" ${O}/><rect x="9" y="23" width="14" height="5" rx="1.5" fill="#b9773e" ${O}/>`,
  mail: `<rect x="3" y="7" width="26" height="18" rx="2.5" fill="#fbf3e4" ${O}/><path d="M4 9l12 9 12-9" fill="none" ${O}/>`,
  star: `<path d="M16 3l3.8 8 8.7 1.1-6.4 6 1.7 8.6L16 22.4l-7.8 4.3 1.7-8.6-6.4-6 8.7-1.1z" fill="#ffd54f" ${O}/>`,
  shop: `<path d="M5 14h22v14H5z" fill="#f4e3c0" ${O}/><path d="M3 8l3-5h20l3 5v3c0 2-2 3-4 3s-4-1-4-3c0 2-2 3-4 3s-4-1-4-3c0 2-2 3-4 3s-4-1-4-3c0 2-2 3-3 3-1 0-3-1-3-3z" fill="#e2413c" ${O}/><rect x="13" y="19" width="6" height="9" fill="#b9773e" ${O}/>`,
  fast: `<path d="M4 7l11 9-11 9zM16 7l11 9-11 9z" fill="#6cc04a" ${O}/>`,
  pause: `<rect x="7" y="6" width="6" height="20" rx="1.5" fill="#f4eee0" ${O}/><rect x="19" y="6" width="6" height="20" rx="1.5" fill="#f4eee0" ${O}/>`,
  play: `<path d="M9 5l17 11L9 27z" fill="#6cc04a" ${O}/>`,
  clock: `<circle cx="16" cy="16" r="12" fill="#fbf3e4" ${O}/><path d="M16 9v7l5 3" fill="none" ${O}/>`,
  house: `<path d="M4 15L16 5l12 10" fill="none" ${O}/><path d="M7 13v15h18V13" fill="#f3e3c3" ${O}/><path d="M3 15L16 4l13 11v-3L16 1 3 12z" fill="#c9473d" ${O}/><rect x="13" y="19" width="6" height="9" fill="#8a5a33" ${O}/>`,
  smile: `<circle cx="16" cy="16" r="12" fill="#ffd54f" ${O}/><circle cx="12" cy="13" r="1.6" fill="#5b3a1e"/><circle cx="20" cy="13" r="1.6" fill="#5b3a1e"/><path d="M10.5 18.5c3 4 8 4 11 0" fill="none" ${O}/>`,
  axe: `<path d="M9 28L22 9" stroke="#8a5428" stroke-width="3.4" stroke-linecap="round"/><path d="M18 5c4-2 9 0 10 4l-6 6c-2-1-5-4-4-10z" fill="#b5bcc3" ${O}/>`,
  pick: `<path d="M8 28L22 9" stroke="#8a5428" stroke-width="3.4" stroke-linecap="round"/><path d="M8 9c6-6 14-5 20 1-6-2-14-3-20-1z" fill="#9aa1a8" ${O}/>`,
  fish: `<path d="M4 16c5-7 14-8 20 0-6 8-15 7-20 0z" fill="#5ab0e0" ${O}/><path d="M24 16l5-5v10z" fill="#3e8fc0" ${O}/><circle cx="10" cy="14.5" r="1.5" fill="#5b3a1e"/>`,
  sapling: `<path d="M16 28v-11" stroke="#7a4e2c" stroke-width="2.4" stroke-linecap="round"/><path d="M16 18c-7 0-10-5-9-11 6 0 9 4 9 11zM16 15c1-6 5-9 10-8 0 5-4 8-10 8z" fill="#6cb84a" ${O}/><path d="M9 28h14" ${O}/>`,
  close: `<path d="M9 9l14 14M23 9L9 23" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/>`,
  check: `<path d="M7 17l6 6 12-13" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  rotate: `<path d="M24 12a9 9 0 10.5 8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M25 5v8h-8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  trash: `<path d="M7 9h18l-2 19H9z" fill="#e8665a" ${O}/><path d="M5 9h22M12 9V5h8v4" fill="none" ${O}/>`,
  plus: `<path d="M16 8v16M8 16h16" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
  minus: `<path d="M8 16h16" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
  back: `<path d="M20 6L10 16l10 10" fill="none" stroke="#5b3a1e" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  zzz: `<text x="6" y="22" font-family="Fredoka,sans-serif" font-weight="700" font-size="15" fill="#6a7fae">z</text><text x="14" y="16" font-family="Fredoka,sans-serif" font-weight="700" font-size="12" fill="#6a7fae">z</text><text x="21" y="11" font-family="Fredoka,sans-serif" font-weight="700" font-size="9" fill="#6a7fae">z</text>`,
  alert: `<circle cx="16" cy="16" r="12" fill="#f0a826" ${O}/><path d="M16 9v9" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><circle cx="16" cy="23" r="2" fill="#fff"/>`,
  basket: `<path d="M5 14h22l-3 13H8z" fill="#c98a4a" ${O}/><path d="M9 14c0-6 14-6 14 0" fill="none" ${O}/><circle cx="12" cy="12" r="3" fill="#d8304a" ${O}/><circle cx="19" cy="11.5" r="3" fill="#d8304a" ${O}/>`,
  sound: `<path d="M5 12h5l7-6v20l-7-6H5z" fill="#f4eee0" ${O}/><path d="M21 11c2 3 2 7 0 10M24 8c4 5 4 11 0 16" fill="none" ${O}/>`,
  mute: `<path d="M5 12h5l7-6v20l-7-6H5z" fill="#f4eee0" ${O}/><path d="M21 12l7 8M28 12l-7 8" fill="none" ${O}/>`,
  lock: `<rect x="7" y="14" width="18" height="14" rx="2.5" fill="#f6c53f" ${O}/><path d="M11 14V10a5 5 0 0110 0v4" fill="none" ${O}/><circle cx="16" cy="21" r="2" fill="#5b3a1e"/>`,
  eye: `<path d="M3 16c6-9 20-9 26 0-6 9-20 9-26 0z" fill="#fbf3e4" ${O}/><circle cx="16" cy="16" r="4.5" fill="#4f8fd9" ${O}/>`,
  xp: `<path d="M16 3l3.8 8 8.7 1.1-6.4 6 1.7 8.6L16 22.4l-7.8 4.3 1.7-8.6-6.4-6 8.7-1.1z" fill="#7cd0ff" ${O}/>`,
  clear: `<path d="M9 28L22 9" stroke="#8a5428" stroke-width="3.4" stroke-linecap="round"/><path d="M18 5c4-2 9 0 10 4l-6 6c-2-1-5-4-4-10z" fill="#b5bcc3" ${O}/><circle cx="8" cy="9" r="5" fill="#e2413c" ${O}/>`,
  info: `<circle cx="16" cy="16" r="12" fill="#4f8fd9" ${O}/><circle cx="16" cy="10" r="2" fill="#fff"/><path d="M16 15v8" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>`,
  wool: `<path d="M8 22c-4 0-5-5-2-7-1-4 3-7 6-5 1-3 7-3 8 0 3-2 7 1 6 5 3 2 2 7-2 7z" fill="#f6f3ea" ${O}/><path d="M11 16c1 1 2 1 3 0M17 17c1 1 2 1 3 0" fill="none" stroke="#c9c3b4" stroke-width="1.3" stroke-linecap="round"/>`,
  cloth: `<path d="M5 8h22v4H5z" fill="#4f8fd9" ${O}/><path d="M5 12h22v14H5z" fill="#6fa8e8" ${O}/><path d="M5 16h22M5 20h22M11 12v14M17 12v14M23 12v14" stroke="#3f6fa8" stroke-width="1"/>`,
  milk: `<path d="M11 6h10v4l3 4v14H8V14l3-4z" fill="#f7f7f2" ${O}/><path d="M8 18h16v6H8z" fill="#7fb8e8"/><path d="M11 6h10" ${O}/>`,
  cheese: `<path d="M4 20l14-11 10 6v8H4z" fill="#f6c53f" ${O}/><path d="M4 20h24" ${O}/><circle cx="11" cy="23" r="1.6" fill="#d9a520"/><circle cx="20" cy="17" r="1.8" fill="#d9a520"/><circle cx="23" cy="23" r="1.3" fill="#d9a520"/>`,
  honey: `<path d="M9 11h14l1 15H8z" fill="#f0a826" ${O}/><path d="M8 11c0-3 16-3 16 0" fill="#fff3d6" ${O}/><path d="M11 16c3 2 7 2 10 0" stroke="#c48a1a" stroke-width="1.4" fill="none"/><path d="M14 6l2-3 2 3" fill="none" ${O}/>`,
  ale: `<path d="M8 10h13v17H8z" fill="#e8a23c" ${O}/><path d="M21 13h3a2 2 0 012 2v5a2 2 0 01-2 2h-3" fill="none" ${O}/><path d="M7 10c0-4 4-5 6-3 2-2 6-2 8 1 1 1 0 3-1 3H8c-1 0-1-1-1-1z" fill="#fff8e8" ${O}/>`,
  heart: `<path d="M16 27C8 21 4 17 4 12a6 6 0 0112-1 6 6 0 0112 1c0 5-4 9-12 15z" fill="#f06292" ${O}/><ellipse cx="10" cy="11" rx="2" ry="1.4" fill="#ffc1d6"/>`,
  shield: `<path d="M16 3l11 4v8c0 7-5 11-11 14C10 26 5 22 5 15V7z" fill="#6fa8e8" ${O}/><path d="M16 7v18M9 13h14" stroke="#fff" stroke-width="2"/>`,
  staff: `<path d="M10 29L20 11" stroke="#8a5428" stroke-width="3" stroke-linecap="round"/><circle cx="21.5" cy="8.5" r="5" fill="#b18cff" ${O}/><path d="M26 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="#ffd54f"/>`,
  baby: `<circle cx="16" cy="13" r="8" fill="#f2c9a0" ${O}/><path d="M9 11c1-5 13-5 14 0-3-2-11-2-14 0z" fill="#f6c3d6" ${O}/><circle cx="13" cy="14" r="1" fill="#5b3a1e"/><circle cx="19" cy="14" r="1" fill="#5b3a1e"/><path d="M14 17c1 1 3 1 4 0" fill="none" ${O}/><path d="M8 29c0-5 4-7 8-7s8 2 8 7z" fill="#f6c3d6" ${O}/>`,
  moon: `<path d="M21 4a12 12 0 100 24A10 10 0 0121 4z" fill="#ffe7a3" ${O}/>`,
  target: `<circle cx="16" cy="16" r="11" fill="#fbf3e4" ${O}/><circle cx="16" cy="16" r="6" fill="#e2413c" ${O}/><circle cx="16" cy="16" r="2" fill="#fff"/>`,
  gift: `<path d="M4 15h24v13H4z" fill="#b9773e" ${O}/><path d="M3 10c0-2 1-3 3-3h20c2 0 3 1 3 3v5H3z" fill="#d48f4f" ${O}/><path d="M13 7v21M19 7v21" stroke="#f6c53f" stroke-width="2.6"/><path d="M3 15h26" ${O}/><rect x="13.5" y="13" width="5" height="5" rx="1" fill="#ffd54f" ${O}/><path d="M9 4l1 2 2 .6-2 .8L9 9.5 8 7.4l-2-.8 2-.6zM25 2.5l.8 1.6 1.7.5-1.7.6-.8 1.7-.8-1.7-1.6-.6 1.6-.5z" fill="#fff6b0"/>`,
  leaf: `<path d="M6 26C5 15 12 6 27 5c0 14-8 22-21 21z" fill="#e8892e" ${O}/><path d="M6 26C11 19 16 14 22 10" fill="none" stroke="#8a4a1a" stroke-width="1.6" stroke-linecap="round"/><path d="M12 19l-1-5M16 15l4 1" stroke="#b5611d" stroke-width="1.3" stroke-linecap="round"/>`,
  snow: `<g stroke="#5a7fae" stroke-width="2.4" stroke-linecap="round"><path d="M16 3v26M4.7 9.5l22.6 13M4.7 22.5l22.6-13"/></g><g stroke="#dff1ff" stroke-width="1.2" stroke-linecap="round"><path d="M16 3v26M4.7 9.5l22.6 13M4.7 22.5l22.6-13"/></g><path d="M12 5l4 3 4-3M12 27l4-3 4 3M5 14l4.5-1L8 8.5M27 18l-4.5 1L24 23.5M5 18l4.5 1L8 23.5M27 14l-4.5-1L24 8.5" fill="none" stroke="#5a7fae" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  sun: `<g stroke="#e8a826" stroke-width="2.6" stroke-linecap="round"><path d="M16 2v4M16 26v4M2 16h4M26 16h4M6 6l2.8 2.8M23.2 23.2L26 26M6 26l2.8-2.8M23.2 8.8L26 6"/></g><circle cx="16" cy="16" r="7.5" fill="#ffd54f" ${O}/>`,
  blossom: `<g fill="#f9b8cf" ${O}><circle cx="16" cy="8" r="5"/><circle cx="23.5" cy="13.5" r="5"/><circle cx="20.5" cy="22" r="5"/><circle cx="11.5" cy="22" r="5"/><circle cx="8.5" cy="13.5" r="5"/></g><circle cx="16" cy="16" r="3.6" fill="#ffd54f" ${O}/>`,
  lantern: `<path d="M16 2v4" ${O}/><path d="M10 9c0-2 2-3 6-3s6 1 6 3c2 3 2 11 0 14 0 2-2 3-6 3s-6-1-6-3c-2-3-2-11 0-14z" fill="#f0743a" ${O}/><path d="M12 9c-1 4-1 10 0 14M20 9c1 4 1 10 0 14" fill="none" stroke="#b5461d" stroke-width="1.2"/><ellipse cx="16" cy="16" rx="3" ry="5" fill="#ffd27a"/><path d="M14 28h4" ${O}/>`,
  pencil: `<path d="M6 26l2-7L21 6l5 5L13 24z" fill="#ffd54f" ${O}/><path d="M21 6l2-2 5 5-2 2z" fill="#f28a8a" ${O}/><path d="M6 26l2-7 5 5z" fill="#f4dcb4" ${O}/><path d="M6 26l1-3 2 2z" fill="#5b3a1e"/>`,
  party: `<path d="M4 28L10 9l13 13z" fill="#f6c53f" ${O}/><path d="M7 19l7 7M9 13l10 10" stroke="#e2413c" stroke-width="2"/><circle cx="22" cy="6" r="2" fill="#4f8fd9"/><circle cx="27" cy="13" r="1.8" fill="#6cc04a"/><circle cx="17" cy="4" r="1.5" fill="#f06292"/><path d="M20 12c2-2 5-2 7 0M14 8c0-3 2-5 4-5" fill="none" stroke="#a66be0" stroke-width="1.8" stroke-linecap="round"/>`,
  // weather
  cloud: `<path d="M8 24a5.5 5.5 0 01-.6-11A7.5 7.5 0 0121.6 11 5.6 5.6 0 0124.5 24z" fill="#eef3f8" ${O}/><path d="M11 20.5h11" stroke="#c9d3de" stroke-width="1.6" stroke-linecap="round"/>`,
  suncloud: `<g stroke="#e8a826" stroke-width="2.2" stroke-linecap="round"><path d="M12 2.5v3M3.5 11h3M5.6 4.6l2 2M18.4 4.6l-2 2"/></g><circle cx="12" cy="11.5" r="5.5" fill="#ffd54f" ${O}/><path d="M11 27a5 5 0 01-.5-10 7 7 0 0112.8-2 5 5 0 012.7 12z" fill="#eef3f8" ${O}/>`,
  rain: `<path d="M8 19a5.5 5.5 0 01-.6-11A7.5 7.5 0 0121.6 6 5.6 5.6 0 0124.5 19z" fill="#d6e1ec" ${O}/><g stroke="#4f8fd9" stroke-width="2.2" stroke-linecap="round"><path d="M10 23l-1.5 4M16 23l-1.5 4M22 23l-1.5 4"/></g>`,
  storm: `<path d="M8 18a5.5 5.5 0 01-.6-11A7.5 7.5 0 0121.6 5 5.6 5.6 0 0124.5 18z" fill="#8e9aab" ${O}/><path d="M17 15l-5 8h4l-2 7 7-10h-4l2-5z" fill="#ffd54f" ${O}/><g stroke="#4f8fd9" stroke-width="2" stroke-linecap="round"><path d="M9 22l-1.2 3.5M25 21l-1.2 3.5"/></g>`,
  snowfall: `<path d="M8 18a5.5 5.5 0 01-.6-11A7.5 7.5 0 0121.6 5 5.6 5.6 0 0124.5 18z" fill="#eef3f8" ${O}/><g fill="#7fa6d6"><circle cx="10" cy="23" r="1.8"/><circle cx="16" cy="26" r="1.8"/><circle cx="22" cy="23" r="1.8"/><circle cx="13" cy="29.5" r="1.4"/><circle cx="20" cy="29.5" r="1.4"/></g>`,
  blizzard: `<path d="M8 17a5.5 5.5 0 01-.6-11A7.5 7.5 0 0121.6 4 5.6 5.6 0 0124.5 17z" fill="#b9c6d6" ${O}/><path d="M4 21h15M8 25h18M3 29h12" stroke="#5a7fae" stroke-width="2" stroke-linecap="round"/><g fill="#fff" stroke="#5a7fae" stroke-width="1"><circle cx="23" cy="21" r="1.8"/><circle cx="19" cy="29" r="1.8"/></g>`,
  list: `<rect x="4" y="5" width="24" height="22" rx="4" fill="#fbf3e4" ${O}/><path d="M11 11h12M11 16h12M11 21h12" stroke="#8c6a48" stroke-width="2" stroke-linecap="round"/><g fill="#6cc04a"><circle cx="8" cy="11" r="1.6"/><circle cx="8" cy="16" r="1.6"/><circle cx="8" cy="21" r="1.6"/></g>`,
  next: `<path d="M12 6l10 10-10 10" fill="none" stroke="#5b3a1e" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  arrowup: `<path d="M16 27V7M8 14l8-8 8 8" fill="none" stroke="#3f8a2a" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  warn: `<path d="M16 4L29 27H3z" fill="#f6c53f" ${O}/><path d="M16 12v7" stroke="#5b3a1e" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="23" r="1.7" fill="#5b3a1e"/>`,
  home: `<circle cx="16" cy="16" r="13" fill="#fbf3e4" ${O}/><path d="M8 16l8-7 8 7" fill="none" ${O}/><path d="M10 15v8h12v-8" fill="#f3e3c3" ${O}/><path d="M14.5 23v-4h3v4" fill="#8a5a33" ${O}/>`,
};

// other modules (rpgui.js) can add their own icons
export function addIcons(more) { Object.assign(P, more); }

export const svg = (name, size = 24) =>
  `<svg class="ic" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">${P[name] ?? P.info}</svg>`;

export const svgUrl = name =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64">${P[name] ?? P.info}</svg>`);

const imgCache = new Map();
export function iconImage(name) {
  if (!imgCache.has(name)) {
    const img = new Image();
    img.src = svgUrl(name);
    imgCache.set(name, img);
  }
  return imgCache.get(name);
}
