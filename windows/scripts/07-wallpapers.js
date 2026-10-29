/* ===========================================================================
   Wallpapers and appearance.

   Wallpapers are original vector compositions generated here, not Microsoft
   artwork. Win.applyTheme() turns the appearance settings into classes and
   CSS variables, and runs whenever the 'theme' topic fires.
   =========================================================================== */

(function (Win) {
  'use strict';

  const svg = (w, h, body) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">${body}</svg>`)}`;

  /* Translucent teardrop petals fanned out from one point, like a bloom
     opening toward the light. Back petals are drawn first. */
  function glow(dark) {
    const cx = 1010;
    const cy = 760;
    const bg = dark ? ['#071226', '#0d2350', '#03070f'] : ['#dbe9f8', '#b7d3f1', '#eef5fc'];
    const petal = (len, wid) => `M${cx} ${cy} C${cx - wid} ${cy - len * 0.35} ${cx - wid * 0.7} ${cy - len} ${cx} ${cy - len} C${cx + wid * 0.7} ${cy - len} ${cx + wid} ${cy - len * 0.35} ${cx} ${cy}Z`;
    const layers = [
      [-78, 560, 190], [78, 560, 190], [-52, 620, 200], [52, 620, 200], [-26, 660, 205], [26, 660, 205], [0, 690, 210],
      [-64, 470, 160], [64, 470, 160], [-38, 520, 170], [38, 520, 170], [-12, 560, 175], [12, 560, 175],
    ];
    const tips = dark ? ['#7cc0ff', '#3f8dff'] : ['#cfe6ff', '#6fb0fa'];
    const base = dark ? '#0b3aa8' : '#1c63d6';
    const petals = layers.map(([angle, len, wid], i) => `<path d="${petal(len, wid)}" transform="rotate(${angle} ${cx} ${cy})" fill="url(#pg${i < 7 ? 0 : 1})" opacity="${i < 7 ? 0.62 : 0.78}" stroke="${dark ? '#9fd0ff' : '#ffffff'}" stroke-opacity=".28" stroke-width="2"/>`).join('');
    return svg(1920, 1080, `<defs>
      <radialGradient id="bg" cx=".53" cy=".62" r=".85"><stop offset="0" stop-color="${bg[1]}"/><stop offset=".55" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[2]}"/></radialGradient>
      <radialGradient id="pg0" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="700"><stop offset="0" stop-color="${base}"/><stop offset=".55" stop-color="${tips[1]}"/><stop offset="1" stop-color="${tips[0]}" stop-opacity=".55"/></radialGradient>
      <radialGradient id="pg1" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="560"><stop offset="0" stop-color="${base}"/><stop offset=".5" stop-color="${dark ? '#2a6ef0' : '#3a85ee'}"/><stop offset="1" stop-color="${tips[0]}" stop-opacity=".7"/></radialGradient>
      <radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${dark ? '#2b6cff' : '#ffffff'}" stop-opacity="${dark ? 0.45 : 0.9}"/><stop offset="1" stop-color="${dark ? '#2b6cff' : '#ffffff'}" stop-opacity="0"/></radialGradient>
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter></defs>
      <rect width="1920" height="1080" fill="url(#bg)"/>
      <ellipse cx="${cx}" cy="${cy - 260}" rx="760" ry="560" fill="url(#halo)"/>
      <g filter="url(#soft)">${petals}</g>
      <ellipse cx="${cx}" cy="${cy - 10}" rx="120" ry="60" fill="url(#halo)"/>`);
  }

  const ribbon = () => svg(1920, 1080, `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1035"/><stop offset="1" stop-color="#3a1446"/></linearGradient>
    <linearGradient id="r1" x1="0" x2="1"><stop offset="0" stop-color="#ff6aa2"/><stop offset=".5" stop-color="#b65cff"/><stop offset="1" stop-color="#4f7dff"/></linearGradient>
    <linearGradient id="r2" x1="0" x2="1"><stop offset="0" stop-color="#ffb36b"/><stop offset="1" stop-color="#ff5c8a"/></linearGradient><filter id="s"><feGaussianBlur stdDeviation="3"/></filter></defs>
    <rect width="1920" height="1080" fill="url(#b)"/>
    <g fill="none" filter="url(#s)" stroke-linecap="round">
      ${Array.from({ length: 14 }, (_, i) => `<path d="M-100 ${640 + i * 9} C 500 ${300 + i * 14}, 900 ${980 - i * 10}, 2020 ${420 + i * 12}" stroke="url(#r1)" stroke-width="${10 - i * 0.5}" opacity="${0.9 - i * 0.05}"/>`).join('')}
      ${Array.from({ length: 8 }, (_, i) => `<path d="M-100 ${820 + i * 8} C 600 ${620 + i * 10}, 1200 ${1040 - i * 6}, 2020 ${760 + i * 9}" stroke="url(#r2)" stroke-width="${6 - i * 0.5}" opacity="${0.7 - i * 0.07}"/>`).join('')}
    </g>`);

  const dune = () => svg(1920, 1080, `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf9e"/><stop offset=".55" stop-color="#ff9a76"/><stop offset="1" stop-color="#d4607a"/></linearGradient></defs>
    <rect width="1920" height="1080" fill="url(#sky)"/><circle cx="1320" cy="520" r="120" fill="#fff1d6" opacity=".85"/>
    <path d="M0 700 Q 480 560 960 690 T 1920 640 V1080 H0z" fill="#e0786a"/>
    <path d="M0 800 Q 560 680 1100 800 T 1920 760 V1080 H0z" fill="#c45a63"/>
    <path d="M0 900 Q 700 790 1300 910 T 1920 880 V1080 H0z" fill="#9c3f5a"/>
    <path d="M0 990 Q 800 920 1920 1000 V1080 H0z" fill="#6f2c4f"/>`);

  const lagoon = () => svg(1920, 1080, `<defs><linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fe0d6"/><stop offset=".5" stop-color="#1fa7b8"/><stop offset="1" stop-color="#0b4f7a"/></linearGradient><filter id="s"><feGaussianBlur stdDeviation="18"/></filter></defs>
    <rect width="1920" height="1080" fill="url(#w)"/>
    <g fill="none" stroke="#ffffff" filter="url(#s)" opacity=".35">${Array.from({ length: 9 }, (_, i) => `<path d="M-200 ${120 + i * 120} C 400 ${40 + i * 120}, 1200 ${220 + i * 120}, 2100 ${100 + i * 120}" stroke-width="${40 - i * 3}"/>`).join('')}</g>`);

  const aurora = () => svg(1920, 1080, `<defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050b1a"/><stop offset="1" stop-color="#0c2233"/></linearGradient><filter id="s"><feGaussianBlur stdDeviation="40"/></filter></defs>
    <rect width="1920" height="1080" fill="url(#n)"/>
    <g filter="url(#s)"><path d="M100 520 C 500 200, 900 600, 1300 260 S 1800 380, 1900 200" stroke="#2fe39b" stroke-width="140" fill="none" opacity=".55"/>
    <path d="M0 640 C 400 420, 1000 720, 1500 420 S 1900 520, 2000 400" stroke="#2b9cff" stroke-width="90" fill="none" opacity=".45"/></g>
    ${Array.from({ length: 70 }, (_, i) => `<circle cx="${(i * 277) % 1920}" cy="${(i * 131) % 600}" r="${1 + (i % 3) * 0.6}" fill="#fff" opacity="${0.3 + (i % 5) * 0.12}"/>`).join('')}
    <path d="M0 960 L 260 860 L 420 920 L 640 820 L 900 930 L 1180 840 L 1420 920 L 1700 850 L 1920 900 V1080 H0z" fill="#03070f"/>`);

  const cache = {};
  /* Stock Windows 11 images copied from C:\Windows\Web; see assets/wallpapers/sources.json. */
  const LIST = [
    { id: 'bloom-light', name: 'Windows (light)', file: 'assets/wallpapers/bloom-light.jpg' },
    { id: 'bloom-dark', name: 'Windows (dark)', file: 'assets/wallpapers/bloom-dark.jpg' },
    { id: 'lock', name: 'Windows lock screen', file: 'assets/wallpapers/lock.jpg' },
    { id: 'glow-light', name: 'Glow (light)', draw: () => glow(false) },
    { id: 'glow-dark', name: 'Glow (dark)', draw: () => glow(true) },
    { id: 'ribbon', name: 'Ribbon', draw: ribbon },
    { id: 'dune', name: 'Dune', draw: dune },
    { id: 'lagoon', name: 'Lagoon', draw: lagoon },
    { id: 'aurora', name: 'Aurora', draw: aurora },
  ];

  Win.Wallpapers = {
    list: () => LIST.map(({ id, name }) => ({ id, name })),

    url(id) {
      const item = LIST.find(w => w.id === id);
      if (!item) return '';
      return item.file || (cache[id] ||= item.draw());
    },

    /** CSS `background` value for a wallpaper id, 'solid' or 'file:<nodeId>'. */
    css(id, fit = 'Fill') {
      if (id === 'solid') return Win.state.settings.solidColor;
      let url = '';
      if (String(id).startsWith('file:')) {
        const node = Win.FS.get(id.slice(5));
        url = node && Win.imageURL ? Win.imageURL(node) : '';
      } else {
        url = Win.Wallpapers.url(id);
      }
      if (!url) url = Win.Wallpapers.url('bloom-light');
      const size = { Fill: 'cover', Fit: 'contain', Stretch: '100% 100%', Tile: 'auto', Center: 'auto', Span: 'cover' }[fit] || 'cover';
      const repeat = fit === 'Tile' ? 'repeat' : 'no-repeat';
      /* Single quotes so the value can sit inside a style="" attribute. */
      return `#000 url('${url.replace(/'/g, '%27').replace(/"/g, '%22')}') center / ${size} ${repeat}`;
    },
  };

  /* ---------------------------------------------------------- accent maths */

  const hexToRgb = hex => {
    const v = hex.replace('#', '');
    const n = parseInt(v.length === 3 ? v.split('').map(c => c + c).join('') : v, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (rgb, target, amount) => rgb.map((c, i) => Math.round(c + (target[i] - c) * amount));
  const toHex = rgb => `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`;

  Win.accentShades = base => {
    const rgb = hexToRgb(base);
    return { base, light: toHex(mix(rgb, [255, 255, 255], 0.45)), dark: toHex(mix(rgb, [0, 0, 0], 0.08)) };
  };

  /* ----------------------------------------------------------- apply theme */

  Win.applyTheme = () => {
    const s = Win.state.settings;
    const sys = s.theme === 'dark' ? 't-dark' : 't-light';
    const app = (s.appTheme || s.theme) === 'dark' ? 't-dark' : 't-light';
    document.body.classList.remove('t-light', 't-dark');
    document.body.classList.add(sys);
    for (const id of ['windows', 'overlay-layer']) {
      const el = document.getElementById(id);
      if (el) { el.classList.remove('t-light', 't-dark'); el.classList.add(app); }
    }
    document.body.classList.toggle('no-transparency', !s.transparency);
    document.body.classList.toggle('no-animations', !s.animations);
    document.body.classList.toggle('accent-start', !!s.accentOnStart);

    const accent = s.accentAuto ? '#0067c0' : s.accent;
    const shades = Win.accentShades(accent);
    const root = document.documentElement.style;
    root.setProperty('--accent-base', shades.base);
    root.setProperty('--accent-light', shades.light);
    root.setProperty('--accent-dark', shades.dark);
    root.setProperty('font-size', `${s.textSize || 100}%`);
    document.body.style.fontSize = s.textSize && s.textSize !== 100 ? `${14 * s.textSize / 100}px` : '';

    const wall = document.getElementById('wallpaper');
    if (wall) wall.style.background = Win.Wallpapers.css(s.wallpaper, s.wallpaperFit);
    Win.applyDisplay();
  };

  /** Brightness and Night light are overlays above the whole desktop. */
  Win.applyDisplay = () => {
    const s = Win.state.settings;
    const dim = document.getElementById('dimmer');
    const night = document.getElementById('night-light');
    if (dim) dim.style.opacity = String(Math.max(0, (100 - s.brightness) / 100) * 0.7);
    if (night) night.style.opacity = s.nightLight ? String(0.12 + s.nightStrength / 100 * 0.38) : '0';
  };

  Win.on('theme', () => Win.applyTheme());
})(window.Win);
