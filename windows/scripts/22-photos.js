/* ===========================================================================
   Photos, plus the picture plumbing:

   - Win.Art.url(name, w, h)  original generated pictures (SVG data URLs) for
                              seeded image files that carry `node.art`
   - Win.imageURL(node)       node.data || Win.Art.url(node.art) || ''

   The app is single-instance: opening another picture reuses the window.
   Without a file it shows the Gallery of everything under Pictures and
   OneDrive.
   =========================================================================== */

(function (Win) {
  'use strict';

  const g = (name, size = 16) => Win.glyph(name, size);
  const esc = Win.esc;
  const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']);
  const isImage = n => !!n && n.kind === 'file' && IMAGE.has((n.ext || '').toLowerCase());

  /* ================================================================ artwork */

  const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const lg = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;

  const ART = {
    sunset: { w: 1500, h: 1000, draw() {
      const r = rng(11);
      let streaks = '';
      for (let i = 0; i < 22; i += 1) {
        const y = 640 + i * 16 + r() * 8;
        const w = 260 - i * 9 + r() * 40;
        streaks += `<rect x="${750 - w / 2 + (r() - 0.5) * 30}" y="${y}" width="${w}" height="${3 + r() * 3}" rx="2" fill="#ffd38a" opacity="${0.55 - i * 0.022}"/>`;
      }
      let trees = '';
      for (let i = 0; i < 14; i += 1) {
        const x = 40 + i * 34 + r() * 14;
        const h = 60 + r() * 70;
        trees += `<path d="M${x} ${640 - h}l${16 + r() * 6} ${h}h${-32 - r() * 12}z" fill="#1d0f2c"/>`;
      }
      return `<defs>${lg('sky', [[0, '#26164f'], [0.38, '#7a2f7f'], [0.6, '#e2557a'], [0.8, '#ff9c55'], [1, '#ffc977']])}${lg('lake', [[0, '#5a2d6b'], [0.4, '#321c52'], [1, '#100a24']])}
        <radialGradient id="glow" cx=".5" cy=".62" r=".45"><stop offset="0" stop-color="#fff1c4" stop-opacity=".9"/><stop offset="1" stop-color="#ffb36b" stop-opacity="0"/></radialGradient></defs>
        <rect width="1500" height="640" fill="url(#sky)"/><rect width="1500" height="640" fill="url(#glow)"/>
        <circle cx="750" cy="600" r="96" fill="#ffe7b0"/>
        <path d="M0 560 C180 520 320 540 470 580 S760 600 900 570 1220 520 1500 556V640H0z" fill="#4b2357"/>
        <path d="M0 600 C220 580 420 600 640 620 S1100 600 1500 596V640H0z" fill="#2a1438"/>
        <rect y="640" width="1500" height="360" fill="url(#lake)"/>${streaks}${trees}
        <path d="M1500 640V600c-60-6-120 10-180 40z" fill="#1d0f2c"/>`;
    } },

    mountain: { w: 1500, h: 1000, draw() {
      const r = rng(23);
      let pines = '';
      for (let i = 0; i < 30; i += 1) {
        const x = r() * 1500;
        const y = 760 + r() * 180;
        const s = 0.6 + r() * 0.9;
        pines += `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${s.toFixed(2)})"><rect x="-4" y="0" width="8" height="26" fill="#3b2a1e"/><path d="M0-110 34-30H18L44 10H-44L-18-30H-34z" fill="${r() > 0.5 ? '#1f5a3a' : '#24694a'}"/></g>`;
      }
      return `<defs>${lg('msky', [[0, '#5aa7e6'], [0.6, '#a9d4f5'], [1, '#e8f4fd']])}${lg('mfar', [[0, '#9fb7d3'], [1, '#c9d8ea']])}${lg('mmid', [[0, '#5d7896'], [1, '#41566f']])}${lg('mgrass', [[0, '#6fae4e'], [1, '#3e7d36']])}</defs>
        <rect width="1500" height="1000" fill="url(#msky)"/>
        <circle cx="1180" cy="190" r="70" fill="#fff6d8" opacity=".9"/>
        <path d="M0 560 L180 380 300 470 470 260 640 450 760 360 960 520 1120 300 1300 470 1500 380V700H0z" fill="url(#mfar)"/>
        <path d="M0 640 L240 420 420 560 620 330 820 560 1010 400 1230 610 1380 480 1500 560V760H0z" fill="url(#mmid)"/>
        <path d="M620 330 560 400 600 395 640 420 680 395 710 410z M240 420 200 460 236 455 262 470 290 452z M1010 400 966 446 1004 440 1030 456 1060 438z" fill="#f4f8fc"/>
        <path d="M0 720 C260 660 520 700 760 740 S1240 700 1500 690V1000H0z" fill="url(#mgrass)"/>
        <path d="M720 1000 C760 920 650 880 720 830 S860 790 820 750" fill="none" stroke="#d9c39a" stroke-width="34" stroke-linecap="round"/>
        <path d="M720 1000 C760 920 650 880 720 830 S860 790 820 750" fill="none" stroke="#c7ab7d" stroke-width="6" stroke-dasharray="2 22" stroke-linecap="round"/>${pines}`;
    } },

    city: { w: 1500, h: 1000, draw() {
      const r = rng(37);
      let stars = '';
      for (let i = 0; i < 90; i += 1) stars += `<circle cx="${(r() * 1500).toFixed(0)}" cy="${(r() * 420).toFixed(0)}" r="${(0.8 + r() * 1.6).toFixed(1)}" fill="#fff" opacity="${(0.3 + r() * 0.6).toFixed(2)}"/>`;
      let towers = '';
      let x = -10;
      while (x < 1500) {
        const w = 60 + r() * 90;
        const h = 180 + r() * 380;
        const top = 760 - h;
        const shade = ['#141a33', '#1a2140', '#10162b', '#1d2547'][Math.floor(r() * 4)];
        towers += `<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${shade}"/>`;
        for (let wy = top + 16; wy < 740; wy += 22) {
          for (let wx = x + 10; wx < x + w - 14; wx += 16) {
            if (r() < 0.42) towers += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="8" height="11" fill="${r() < 0.8 ? '#ffd27a' : '#9fd3ff'}" opacity="${(0.55 + r() * 0.45).toFixed(2)}"/>`;
          }
        }
        if (r() < 0.25) towers += `<rect x="${(x + w / 2 - 2).toFixed(0)}" y="${(top - 50).toFixed(0)}" width="4" height="50" fill="${shade}"/><circle cx="${(x + w / 2).toFixed(0)}" cy="${(top - 52).toFixed(0)}" r="4" fill="#ff5a5a"/>`;
        x += w + 4 + r() * 10;
      }
      return `<defs>${lg('csky', [[0, '#060a1f'], [0.6, '#1b2456'], [1, '#43407a']])}${lg('river', [[0, '#1d2350'], [1, '#05081a']])}</defs>
        <rect width="1500" height="1000" fill="url(#csky)"/>${stars}
        <circle cx="1220" cy="150" r="54" fill="#f2f0dc"/><circle cx="1244" cy="134" r="50" fill="#0c1230"/>
        ${towers}<rect y="760" width="1500" height="240" fill="url(#river)"/>
        <g opacity=".25" transform="translate(0 1520) scale(1 -1)">${towers}</g>
        <rect y="756" width="1500" height="8" fill="#2b3160"/>`;
    } },

    beach: { w: 1500, h: 1000, draw() {
      let waves = '';
      for (let i = 0; i < 6; i += 1) waves += `<path d="M0 ${600 + i * 34} q60 -14 120 0 t120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0" fill="none" stroke="#fff" stroke-width="3" opacity="${0.5 - i * 0.06}"/>`;
      return `<defs>${lg('bsky', [[0, '#3fa3ec'], [1, '#bfe6fb']])}${lg('sea', [[0, '#1a8fd0'], [0.6, '#22b8c9'], [1, '#62dccd']])}${lg('sand', [[0, '#f6e2b3'], [1, '#e8c98a']])}</defs>
        <rect width="1500" height="560" fill="url(#bsky)"/>
        <circle cx="1240" cy="150" r="80" fill="#fff4c2"/><circle cx="1240" cy="150" r="130" fill="#fff4c2" opacity=".25"/>
        <path d="M120 200c40-30 110-30 140 0 40-10 80 10 80 40H80c0-25 15-36 40-40z" fill="#fff" opacity=".85"/>
        <path d="M720 140c30-22 90-22 112 0 30-8 64 8 64 30H690c0-20 10-28 30-30z" fill="#fff" opacity=".75"/>
        <rect y="560" width="1500" height="260" fill="url(#sea)"/>${waves}
        <path d="M0 760 C300 720 620 800 900 770 S1300 730 1500 760V1000H0z" fill="url(#sand)"/>
        <path d="M0 760 C300 720 620 800 900 770 S1300 730 1500 760" fill="none" stroke="#fff" stroke-width="8" opacity=".7"/>
        <path d="M430 690 432 900" stroke="#6b4b2a" stroke-width="8"/>
        <path d="M290 700a142 90 0 0 1 284 0z" fill="#e8463c"/><path d="M361 700a71 90 0 0 1 142 0z" fill="#fff"/><path d="M408 700a24 90 0 0 1 48 0z" fill="#e8463c"/>
        <rect x="480" y="880" width="220" height="70" rx="6" fill="#2f7de1" transform="rotate(-6 590 915)"/><rect x="480" y="900" width="220" height="12" fill="#fff" transform="rotate(-6 590 915)" opacity=".8"/>
        <path d="M1220 980 C1200 860 1190 760 1230 650" fill="none" stroke="#7a5534" stroke-width="18" stroke-linecap="round"/>
        <path d="M1230 650c-60-40-150-30-190 10 60-10 120 0 190-10zM1230 650c40-60 130-80 190-50-60 10-120 30-190 50zM1230 650c-30-70-110-110-170-90 50 20 110 50 170 90zM1230 650c70-20 150 10 180 60-60-30-120-40-180-60z" fill="#2f8f46"/>`;
    } },

    screenshot: { w: 1920, h: 1080, draw() {
      const tb = 1080 - 48;
      const icons = ['#ffc83d', '#1c8ee8', '#2b2f3a', '#3a8ee6', '#6f7e93'].map((c, i) => `<rect x="${852 + i * 44}" y="${tb + 10}" width="28" height="28" rx="6" fill="${c}"/>`).join('');
      return `<defs><radialGradient id="wp" cx=".5" cy=".55" r=".75"><stop offset="0" stop-color="#9fd2ff"/><stop offset=".45" stop-color="#2f7de1"/><stop offset="1" stop-color="#0b2a6b"/></radialGradient>
        ${lg('petal', [[0, '#bfe3ff', 0.95], [1, '#1f6fe0', 0.6]])}</defs>
        <rect width="1920" height="1080" fill="url(#wp)"/>
        <g transform="translate(960 600)">${[0, 40, 80, 120, 160, 200, 240, 280, 320].map(a => `<ellipse rx="300" ry="90" transform="rotate(${a}) translate(170 0)" fill="url(#petal)" opacity=".55"/>`).join('')}</g>
        <g transform="translate(300 150)">
          <rect width="1100" height="660" rx="10" fill="#f3f3f3"/><rect width="1100" height="44" rx="10" fill="#e9e9e9"/><rect y="34" width="1100" height="10" fill="#e9e9e9"/>
          <rect x="12" y="8" width="210" height="36" rx="8" fill="#fbfbfb"/><rect x="48" y="20" width="120" height="12" rx="4" fill="#9aa3ad"/>
          <rect y="44" width="1100" height="96" fill="#fbfbfb"/><rect x="170" y="58" width="640" height="30" rx="6" fill="#fff" stroke="#d6d6d6"/><rect x="830" y="58" width="250" height="30" rx="6" fill="#fff" stroke="#d6d6d6"/>
          ${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${20 + i * 60}" y="104" width="40" height="20" rx="4" fill="#cfd5dc"/>`).join('')}
          <rect y="140" width="1100" height="520" fill="#fff"/><rect y="140" width="230" height="520" fill="#fafafa"/>
          ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<rect x="24" y="${162 + i * 36}" width="18" height="16" rx="3" fill="#ffc83d"/><rect x="52" y="${165 + i * 36}" width="${110 + (i * 37) % 60}" height="10" rx="4" fill="#b8c0c9"/>`).join('')}
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<rect x="260" y="${168 + i * 34}" width="18" height="16" rx="3" fill="${i < 3 ? '#ffc83d' : '#d9dee5'}"/><rect x="290" y="${171 + i * 34}" width="${220 + (i * 53) % 120}" height="10" rx="4" fill="#c4cbd3"/><rect x="640" y="${171 + i * 34}" width="150" height="10" rx="4" fill="#dde2e7"/><rect x="840" y="${171 + i * 34}" width="110" height="10" rx="4" fill="#dde2e7"/>`).join('')}
        </g>
        <rect y="${tb}" width="1920" height="48" fill="#eeeeee" opacity=".92"/>
        <g transform="translate(808 ${tb + 10})"><rect width="28" height="28" rx="4" fill="#0a7ce0"/><path d="M5 5h8v8H5zM15 5h8v8h-8zM5 15h8v8H5zM15 15h8v8h-8z" fill="#fff"/></g>${icons}
        <rect x="1780" y="${tb + 12}" width="110" height="24" rx="4" fill="#d6d6d6"/>`;
    } },
  };

  const cache = new Map();

  Win.Art = {
    names: Object.keys(ART),
    size: name => (ART[name] ? { w: ART[name].w, h: ART[name].h } : { w: 1500, h: 1000 }),
    url(name, w, h) {
      const art = ART[name];
      const width = Math.round(w || art?.w || 1500);
      const height = Math.round(h || art?.h || 1000);
      const key = `${name}|${width}x${height}`;
      if (cache.has(key)) return cache.get(key);
      const body = art ? art.draw() : `<defs>${lg('gen', [[0, '#7aa7d9'], [1, '#2b4e8c']])}</defs><rect width="1500" height="1000" fill="url(#gen)"/><path d="M0 800 400 500 700 720 1000 450 1500 820V1000H0z" fill="#1d3561"/>`;
      const vb = art ? `0 0 ${art.w} ${art.h}` : '0 0 1500 1000';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${vb}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      cache.set(key, url);
      return url;
    },
  };

  Win.imageURL = node => (node ? node.data || (node.art ? Win.Art.url(node.art) : '') || '' : '');

  /* ================================================================= photos */

  Win.apps.register({
    id: 'photos',
    name: 'Photos',
    icon: 'photos',
    single: true,
    width: 1040,
    height: 700,
    minWidth: 420,
    minHeight: 320,
    category: 'Photos & video',
    keywords: ['pictures', 'images', 'gallery', 'viewer'],
    create: createPhotos,
    reopen(win, args = {}) {
      const ph = win.state.ph;
      if (args.fileId && Win.FS.get(args.fileId)) show(ph, args.fileId, siblings(args.fileId));
      else gallery(ph);
    },
  });

  const sortByName = list => list.slice().sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  const siblings = id => {
    const node = Win.FS.get(id);
    if (!node) return [];
    return sortByName(Win.FS.children(node.parent).filter(isImage)).map(n => n.id);
  };
  const galleryList = () => (Win.Explorer?.galleryImages ? Win.Explorer.galleryImages() : Win.FS.descendants('pictures').filter(isImage));
  const human = b => (Win.Explorer?.human ? Win.Explorer.human(b) : Win.bytes(b));
  const pathOf = id => (Win.Explorer?.pathOf ? Win.Explorer.pathOf(id) : Win.FS.path(id));

  function createPhotos(win, args = {}) {
    const ph = {
      win, mode: 'gallery', id: null, list: [], scope: 'all', zoom: 0, fit: 1, pan: { x: 0, y: 0 }, nat: { w: 0, h: 0 },
      info: false, slideshow: 0, wheelAt: 0,
    };
    win.state.ph = ph;
    win.el.classList.add('ph-window');
    win.body.innerHTML = `<div class="ph" data-mode="gallery">
      <div class="ph-gal">
        <nav class="ph-side" aria-label="Photos navigation"></nav>
        <div class="ph-gmain">
          <div class="ph-ghead"><h1 class="ph-gtitle">Gallery</h1><span class="ph-gcount muted"></span></div>
          <div class="ph-grid" role="list"></div>
        </div>
      </div>
      <div class="ph-view">
        <div class="ph-tool" role="toolbar" aria-label="Photo commands">
          <button class="ph-tb" data-act="gallery" aria-label="See all photos" title="See all photos">${g('apps')}<span>Gallery</span></button>
          <span class="ph-name"></span>
          <span class="ph-sp"></span>
          <button class="icon-btn" data-act="zoomout" aria-label="Zoom out" title="Zoom out (Ctrl+Minus)">${g('zoomout')}</button>
          <button class="ph-tb ph-zl" data-act="fit" aria-label="Fit to window" title="Fit to window (Ctrl+0)">100%</button>
          <button class="icon-btn" data-act="zoomin" aria-label="Zoom in" title="Zoom in (Ctrl+Plus)">${g('zoomin')}</button>
          <span class="ph-tsep"></span>
          <button class="icon-btn" data-act="edit" aria-label="Edit image" title="Edit with Paint (Ctrl+E)">${g('edit')}</button>
          <button class="icon-btn" data-act="rotate" aria-label="Rotate" title="Rotate (Ctrl+R)">${g('rotate')}</button>
          <button class="icon-btn" data-act="delete" aria-label="Delete" title="Delete (Delete)">${g('trash')}</button>
          <button class="icon-btn" data-act="fav" aria-label="Add to favorites" title="Add to favorites">${g('heart')}</button>
          <button class="icon-btn" data-act="info" aria-label="File information" title="File information (Alt+Enter)">${g('info')}</button>
          <button class="ph-tb" data-act="setas" aria-haspopup="menu" title="Set as">${g('picture')}<span>Set as</span>${g('chevdown', 12)}</button>
          <button class="icon-btn" data-act="more" aria-label="See more" title="See more">${g('more')}</button>
        </div>
        <div class="ph-body">
          <div class="ph-stage" tabindex="0" aria-label="Photo" autofocus>
            <img class="ph-img" alt="" draggable="false">
            <button class="ph-nav prev" data-act="prev" aria-label="Previous" title="Previous (Left Arrow)">${g('chevleft', 20)}</button>
            <button class="ph-nav next" data-act="next" aria-label="Next" title="Next (Right Arrow)">${g('chevright', 20)}</button>
            <div class="ph-empty hidden">This file can't be displayed.</div>
          </div>
          <aside class="ph-info hidden" aria-label="File information"></aside>
        </div>
        <div class="ph-bottom">
          <div class="ph-strip" role="list" aria-label="Filmstrip"></div>
          <div class="ph-zrow"><input type="range" class="ph-zr" min="10" max="800" value="100" aria-label="Zoom"><span class="ph-zp">100%</span></div>
        </div>
      </div>
    </div>`;
    const $ = sel => win.body.querySelector(sel);
    ph.el = {
      root: $('.ph'), side: $('.ph-side'), grid: $('.ph-grid'), gtitle: $('.ph-gtitle'), gcount: $('.ph-gcount'), name: $('.ph-name'),
      stage: $('.ph-stage'), img: $('.ph-img'), empty: $('.ph-empty'), info: $('.ph-info'), strip: $('.ph-strip'),
      zr: $('.ph-zr'), zp: $('.ph-zp'), zl: $('.ph-zl'), prev: $('.ph-nav.prev'), next: $('.ph-nav.next'), fav: $('[data-act="fav"]'),
    };
    wire(ph);
    Win.Explorer?.holdFocus?.(win);
    if (args.fileId && Win.FS.get(args.fileId)) show(ph, args.fileId, siblings(args.fileId));
    else gallery(ph);
    win.listen('fs', Win.debounce(() => onFs(ph), 30));
  }

  /* --------------------------------------------------------------- gallery */

  function scopes() {
    const out = [{ id: 'all', label: 'Gallery', icon: Win.appIcon('gallery', 16) }];
    if (Win.FS.get('onedrive')) out.push({ id: 'onedrive', label: 'OneDrive - Personal', icon: Win.appIcon('onedrive', 16) });
    const folders = ['pictures', ...Win.FS.descendants('pictures').filter(n => n.kind === 'folder' && !n.hidden).map(n => n.id)];
    return { top: out, folders: folders.map(id => Win.FS.get(id)).filter(Boolean) };
  }

  function scopeImages(scope) {
    if (scope === 'all') return galleryList();
    if (scope === 'onedrive') return galleryList().filter(n => Win.FS.contains('onedrive', n.id));
    return sortByName(Win.FS.children(scope).filter(isImage));
  }

  function gallery(ph, scope = ph.scope) {
    stopShow(ph);
    ph.mode = 'gallery';
    ph.scope = Win.FS.get(scope) || ['all', 'onedrive'].includes(scope) ? scope : 'all';
    ph.el.root.dataset.mode = 'gallery';
    const { top, folders } = scopes();
    ph.el.side.innerHTML = `${top.map(s => `<button class="ph-sb ${ph.scope === s.id ? 'on' : ''}" data-scope="${s.id}">${s.icon}<span>${esc(s.label)}</span></button>`).join('')}
      <div class="ph-ssep"></div><span class="ph-slabel">Folders</span>
      ${folders.map(f => `<button class="ph-sb ${ph.scope === f.id ? 'on' : ''}" data-scope="${f.id}">${Win.appIcon('folder', 16)}<span>${esc(f.name)}</span></button>`).join('')}`;
    const images = scopeImages(ph.scope);
    const title = ph.scope === 'all' ? 'Gallery' : ph.scope === 'onedrive' ? 'OneDrive - Personal' : Win.FS.get(ph.scope).name;
    ph.el.gtitle.textContent = title;
    ph.el.gcount.textContent = `${images.length} item${images.length === 1 ? '' : 's'}`;
    const groups = new Map();
    images.forEach(n => {
      const label = new Date(n.modified || Date.now()).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(n);
    });
    ph.list = images.map(n => n.id);
    ph.el.grid.innerHTML = images.length
      ? [...groups].map(([label, list]) => `<h2 class="ph-gh">${esc(label)}</h2><div class="ph-gg">${list.map(n => `<button class="ph-gi" role="listitem" data-open="${esc(n.id)}" aria-label="${esc(n.name)}" title="${esc(n.name)}"><img src="${esc(Win.imageURL(n))}" alt="" draggable="false" decoding="async" ${n.rotation ? `style="transform:rotate(${Number(n.rotation) || 0}deg)"` : ''}>${n.favorite ? `<span class="ph-gfav">${g('heart', 12)}</span>` : ''}</button>`).join('')}</div>`).join('')
      : `<div class="ph-none">${g('picture', 40)}<p>No photos here yet.</p><p class="muted">Pictures you save to ${esc(title === 'Gallery' ? 'your Pictures folder' : title)} appear here.</p></div>`;
    ph.win.setTitle('Photos');
  }

  /* ---------------------------------------------------------------- viewer */

  function show(ph, id, list) {
    const node = Win.FS.get(id);
    if (!node) { gallery(ph); return; }
    ph.mode = 'viewer';
    ph.el.root.dataset.mode = 'viewer';
    ph.id = id;
    if (list) ph.list = list;
    if (!ph.list.includes(id)) ph.list = siblings(id);
    ph.zoom = 0;
    ph.pan = { x: 0, y: 0 };
    ph.el.empty.classList.add('hidden');
    const url = Win.imageURL(node);
    ph.el.img.style.visibility = 'hidden';
    ph.el.img.onload = () => {
      if (ph.id !== id) return;
      ph.nat = { w: ph.el.img.naturalWidth || 1500, h: ph.el.img.naturalHeight || 1000 };
      ph.el.img.style.width = `${ph.nat.w}px`;
      ph.el.img.style.height = `${ph.nat.h}px`;
      ph.el.img.style.visibility = '';
      layout(ph);
      renderInfo(ph);
    };
    ph.el.img.onerror = () => { if (ph.id === id) ph.el.empty.classList.remove('hidden'); };
    if (url) ph.el.img.src = url; else { ph.el.img.removeAttribute('src'); ph.el.empty.classList.remove('hidden'); }
    ph.el.img.alt = node.name;
    ph.el.name.textContent = Win.FS.display(node);
    ph.win.setTitle(`${node.name} - Photos`);
    renderStrip(ph);
    renderChrome(ph);
    renderInfo(ph);
    Win.FS.touch(id);
  }

  function renderChrome(ph) {
    const node = Win.FS.get(ph.id);
    const i = ph.list.indexOf(ph.id);
    ph.el.prev.disabled = i <= 0;
    ph.el.next.disabled = i < 0 || i >= ph.list.length - 1;
    ph.el.fav.classList.toggle('on', !!node?.favorite);
    ph.el.fav.setAttribute('aria-label', node?.favorite ? 'Remove from favorites' : 'Add to favorites');
    ph.el.fav.setAttribute('aria-pressed', String(!!node?.favorite));
  }

  function renderStrip(ph) {
    ph.el.strip.innerHTML = ph.list.map(id => Win.FS.get(id)).filter(Boolean).map(n => `<button class="ph-th ${n.id === ph.id ? 'on' : ''}" role="listitem" data-open="${esc(n.id)}" aria-label="${esc(n.name)}" aria-current="${n.id === ph.id}"><img src="${esc(Win.imageURL(n))}" alt="" draggable="false" decoding="async" ${n.rotation ? `style="transform:rotate(${Number(n.rotation) || 0}deg)"` : ''}></button>`).join('');
    ph.el.strip.querySelector('.ph-th.on')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }

  function renderInfo(ph) {
    ph.el.info.classList.toggle('hidden', !ph.info);
    if (!ph.info) return;
    const node = Win.FS.get(ph.id);
    if (!node) return;
    const size = node.size ?? (node.data ? Math.round(node.data.length * 0.75) : 0);
    const row = (k, v) => `<div class="ph-irow"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
    ph.el.info.innerHTML = `<div class="ph-ihead"><h2>File information</h2><button class="icon-btn" data-act="info" aria-label="Close file information">${g('close', 14)}</button></div>
      ${row('File name', node.name)}
      ${row('Date', Win.formatDateTime(node.modified || Date.now()))}
      ${row('Size', human(size))}
      ${ph.nat.w ? row('Dimensions', `${ph.nat.w} x ${ph.nat.h}`) : ''}
      ${node.rotation ? row('Rotation', `${node.rotation}°`) : ''}
      ${row('Path', pathOf(node.id))}
      <button class="link ph-ilink" data-act="folder">Open folder</button>`;
  }

  const stageSize = ph => ({ w: ph.el.stage.clientWidth || 800, h: ph.el.stage.clientHeight || 500 });
  const rotated = ph => (((Win.FS.get(ph.id)?.rotation || 0) / 90) % 2 === 1);

  function fitScale(ph) {
    const { w, h } = stageSize(ph);
    const iw = rotated(ph) ? ph.nat.h : ph.nat.w;
    const ih = rotated(ph) ? ph.nat.w : ph.nat.h;
    if (!iw || !ih) return 1;
    return Math.min((w - 48) / iw, (h - 48) / ih, 1);
  }

  function layout(ph) {
    if (ph.mode !== 'viewer') return;
    ph.fit = fitScale(ph);
    const scale = ph.zoom || ph.fit;
    if (!ph.zoom) ph.pan = { x: 0, y: 0 };
    const rot = Win.FS.get(ph.id)?.rotation || 0;
    ph.el.img.style.transform = `translate(-50%, -50%) translate(${ph.pan.x}px, ${ph.pan.y}px) rotate(${rot}deg) scale(${scale})`;
    ph.el.stage.classList.toggle('pannable', !!ph.zoom && scale > ph.fit);
    const pct = Math.round(scale * 100);
    ph.el.zl.textContent = `${pct}%`;
    ph.el.zp.textContent = `${pct}%`;
    ph.el.zr.value = String(Win.clamp(pct, 10, 800));
    Win.paintRange?.(ph.el.zr);
  }

  function setZoom(ph, scale, around = null) {
    const prev = ph.zoom || ph.fit;
    const next = Win.clamp(scale, 0.1, 8);
    if (around) {
      const r = ph.el.stage.getBoundingClientRect();
      const cx = around.x - r.left - r.width / 2;
      const cy = around.y - r.top - r.height / 2;
      ph.pan = { x: cx - (cx - ph.pan.x) * (next / prev), y: cy - (cy - ph.pan.y) * (next / prev) };
    } else {
      ph.pan = { x: ph.pan.x * (next / prev), y: ph.pan.y * (next / prev) };
    }
    ph.zoom = Math.abs(next - ph.fit) < 0.001 ? 0 : next;
    layout(ph);
  }

  function step(ph, dir) {
    const i = ph.list.indexOf(ph.id);
    const next = ph.list[i + dir];
    if (next) show(ph, next);
    else if (ph.slideshow) show(ph, ph.list[0]);
  }

  async function remove(ph) {
    const node = Win.FS.get(ph.id);
    if (!node) return;
    const ok = await Win.confirm('Delete file', `Are you sure you want to move “${node.name}” to the Recycle Bin?`, { ok: 'Delete', cancel: 'Cancel', owner: ph.win });
    if (!ok) return;
    const i = ph.list.indexOf(node.id);
    const removed = Win.FS.remove(node.id);
    if (!removed) { Win.alert('Photos', "This file can't be deleted.", ph.win); return; }
    ph.list = ph.list.filter(id => id !== node.id && Win.FS.get(id));
    const next = ph.list[Math.min(i, ph.list.length - 1)];
    if (next) show(ph, next); else gallery(ph);
  }

  function rotate(ph) {
    const node = Win.FS.get(ph.id);
    if (!node) return;
    node.rotation = ((node.rotation || 0) + 90) % 360;
    if (!node.rotation) delete node.rotation;
    ph.zoom = 0;
    Win.save('fs');
    layout(ph);
    renderStrip(ph);
    renderInfo(ph);
  }

  function setAs(ph, what) {
    const node = Win.FS.get(ph.id);
    if (!node) return;
    if (what === 'lock') Win.state.settings.lockWallpaper = `file:${node.id}`;
    else Win.state.settings.wallpaper = `file:${node.id}`;
    Win.save('theme');
    Win.toast({ app: 'Photos', icon: 'photos', title: what === 'lock' ? 'Lock screen updated' : 'Desktop background updated', body: node.name, transient: true });
  }

  function renameFile(ph) {
    const node = Win.FS.get(ph.id);
    if (!node) return;
    Win.prompt('Rename', 'File name', node.name, {
      owner: ph.win, ok: 'Save',
      validate: v => {
        if (v === node.name) return '';
        const problem = Win.FS.validName(v);
        if (problem) return problem;
        return Win.FS.children(node.parent, { hidden: true }).some(n => n.id !== node.id && n.name.toLowerCase() === v.toLowerCase()) ? 'There is already a file with the same name in this location.' : '';
      },
    }).then(v => { if (v && v !== node.name) Win.FS.rename(node.id, v); });
  }

  function startShow(ph) {
    if (ph.slideshow || ph.mode !== 'viewer') return;
    ph.el.root.classList.add('slideshow');
    ph.slideshow = setInterval(() => step(ph, 1), 3500);
    ph.el.stage.focus({ preventScroll: true });
  }

  function stopShow(ph) {
    if (!ph.slideshow) return;
    clearInterval(ph.slideshow);
    ph.slideshow = 0;
    ph.el.root.classList.remove('slideshow');
    layout(ph);
  }

  function moreMenu(ph, anchor) {
    const node = Win.FS.get(ph.id);
    if (!node) return;
    const r = anchor.getBoundingClientRect();
    const apps = ['paint', 'edge'].filter(id => Win.apps.get(id));
    Win.menu(r.right - 240, r.bottom + 4, [
      { label: 'Slideshow', glyph: 'play', shortcut: 'F5', action: () => startShow(ph) },
      { label: 'Open with', glyph: 'apps', submenu: apps.map(id => ({ label: Win.apps.get(id).name, icon: Win.appIcon(Win.apps.get(id).icon, 16), action: () => Win.openWith(node.id, id) })) },
      { divider: true },
      { label: 'Copy', glyph: 'copy', shortcut: 'Ctrl+C', action: () => Win.Explorer?.setClipboard('copy', [node.id]) },
      { label: 'Rename', glyph: 'rename', shortcut: 'F2', action: () => renameFile(ph) },
      { label: 'Open folder', glyph: 'folder', action: () => Win.wm.open('explorer', { path: node.id }) },
      { label: 'File information', glyph: 'info', checked: ph.info, action: () => { ph.info = !ph.info; renderInfo(ph); } },
    ]);
  }

  function onFs(ph) {
    if (ph.win.closed) return;
    if (ph.mode === 'gallery') { gallery(ph); return; }
    const node = Win.FS.get(ph.id);
    if (!node || node.parent === 'bin') {
      const old = ph.list.indexOf(ph.id);
      ph.list = ph.list.filter(id => Win.FS.get(id) && Win.FS.get(id).parent !== 'bin');
      const next = ph.list[Math.min(Math.max(0, old), ph.list.length - 1)];
      if (next) show(ph, next); else gallery(ph);
      return;
    }
    ph.list = ph.list.filter(id => Win.FS.get(id) && Win.FS.get(id).parent !== 'bin');
    ph.el.name.textContent = Win.FS.display(node);
    ph.win.setTitle(`${node.name} - Photos`);
    renderStrip(ph);
    renderChrome(ph);
    renderInfo(ph);
    layout(ph);
  }

  /* ----------------------------------------------------------------- wiring */

  function wire(ph) {
    const { win } = ph;
    const { stage, zr } = ph.el;

    win.body.addEventListener('click', e => {
      const open = e.target.closest('[data-open]');
      if (open) {
        const fromGallery = ph.mode === 'gallery';
        show(ph, open.dataset.open, fromGallery ? ph.list : null);
        return;
      }
      const scope = e.target.closest('[data-scope]');
      if (scope) { gallery(ph, scope.dataset.scope); return; }
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const node = Win.FS.get(ph.id);
      switch (b.dataset.act) {
        case 'gallery': gallery(ph); break;
        case 'prev': step(ph, -1); break;
        case 'next': step(ph, 1); break;
        case 'zoomin': setZoom(ph, (ph.zoom || ph.fit) * 1.25); break;
        case 'zoomout': setZoom(ph, (ph.zoom || ph.fit) / 1.25); break;
        case 'fit': ph.zoom = ph.zoom ? 0 : 1; if (!ph.zoom) ph.pan = { x: 0, y: 0 }; layout(ph); break;
        case 'edit': if (node) Win.wm.open('paint', { fileId: node.id }); break;
        case 'rotate': rotate(ph); break;
        case 'delete': remove(ph); break;
        case 'fav': if (node) { node.favorite = !node.favorite || undefined; Win.save('fs'); renderChrome(ph); } break;
        case 'info': ph.info = !ph.info; renderInfo(ph); requestAnimationFrame(() => layout(ph)); break;
        case 'folder': if (node) Win.wm.open('explorer', { path: node.id }); break;
        case 'more': moreMenu(ph, b); break;
        case 'setas': {
          const r = b.getBoundingClientRect();
          Win.menu(r.left, r.bottom + 4, [
            { label: 'Set as background', glyph: 'display', action: () => setAs(ph, 'background') },
            { label: 'Set as lock screen', glyph: 'lock', action: () => setAs(ph, 'lock') },
          ]);
          break;
        }
        default: break;
      }
    });

    zr.addEventListener('input', () => setZoom(ph, Number(zr.value) / 100));

    stage.addEventListener('wheel', e => {
      if (ph.mode !== 'viewer') return;
      e.preventDefault();
      if (e.ctrlKey || ph.zoom) { setZoom(ph, (ph.zoom || ph.fit) * (e.deltaY < 0 ? 1.12 : 1 / 1.12), { x: e.clientX, y: e.clientY }); return; }
      const now = performance.now();
      if (now - ph.wheelAt < 280 || Math.abs(e.deltaY) < 4) return;
      ph.wheelAt = now;
      step(ph, e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button') || !ph.zoom || (ph.zoom || ph.fit) <= ph.fit) return;
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      const start = { ...ph.pan };
      let frame = 0;
      let last = e;
      stage.classList.add('panning');
      const move = ev => {
        last = ev;
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          ph.pan = { x: start.x + last.clientX - e.clientX, y: start.y + last.clientY - e.clientY };
          layout(ph);
        });
      };
      const up = () => {
        stage.removeEventListener('pointermove', move);
        stage.removeEventListener('pointerup', up);
        stage.removeEventListener('pointercancel', up);
        stage.classList.remove('panning');
      };
      stage.addEventListener('pointermove', move);
      stage.addEventListener('pointerup', up);
      stage.addEventListener('pointercancel', up);
    });
    stage.addEventListener('dblclick', e => {
      if (e.target.closest('button')) return;
      if (ph.zoom) { ph.zoom = 0; layout(ph); } else setZoom(ph, Math.max(1, ph.fit * 2), { x: e.clientX, y: e.clientY });
    });
    stage.addEventListener('contextmenu', e => {
      if (ph.mode !== 'viewer') return;
      e.preventDefault();
      const node = Win.FS.get(ph.id);
      if (!node) return;
      Win.menu(e.clientX, e.clientY, [
        { label: 'Set as background', glyph: 'display', action: () => setAs(ph, 'background') },
        { label: 'Set as lock screen', glyph: 'lock', action: () => setAs(ph, 'lock') },
        { divider: true },
        { label: 'Edit with Paint', glyph: 'edit', action: () => Win.wm.open('paint', { fileId: node.id }) },
        { label: 'Rotate', glyph: 'rotate', shortcut: 'Ctrl+R', action: () => rotate(ph) },
        { label: 'Copy', glyph: 'copy', action: () => Win.Explorer?.setClipboard('copy', [node.id]) },
        { label: 'Open folder', glyph: 'folder', action: () => Win.wm.open('explorer', { path: node.id }) },
        { divider: true },
        { label: 'Delete', glyph: 'trash', shortcut: 'Delete', action: () => remove(ph) },
      ]);
    });

    win.el.addEventListener('win-resize', () => layout(ph));
    win.el.addEventListener('keydown', e => {
      if (e.defaultPrevented || e.target.closest?.('.dlg-smoke') || e.target.matches?.('input, textarea')) return;
      if (ph.mode !== 'viewer') return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;
      const act = fn => { e.preventDefault(); e.stopPropagation(); fn(); };
      if (k === 'Escape' && ph.slideshow) return act(() => stopShow(ph));
      if (k === 'Escape') return act(() => gallery(ph));
      if (k === 'ArrowRight' || k === 'PageDown') return act(() => step(ph, 1));
      if (k === 'ArrowLeft' || k === 'PageUp') return act(() => step(ph, -1));
      if (k === 'Home') return act(() => ph.list[0] && show(ph, ph.list[0]));
      if (k === 'End') return act(() => ph.list.length && show(ph, ph.list[ph.list.length - 1]));
      if (k === 'Delete') return act(() => remove(ph));
      if (k === 'F5') return act(() => (ph.slideshow ? stopShow(ph) : startShow(ph)));
      if (k === 'F2') return act(() => renameFile(ph));
      if (e.altKey && k === 'Enter') return act(() => { ph.info = !ph.info; renderInfo(ph); });
      if (ctrl && k.toLowerCase() === 'r') return act(() => rotate(ph));
      if (ctrl && k.toLowerCase() === 'e') return act(() => Win.wm.open('paint', { fileId: ph.id }));
      if (ctrl && k.toLowerCase() === 'c') return act(() => Win.Explorer?.setClipboard('copy', [ph.id]));
      if (ctrl && (k === '=' || k === '+')) return act(() => setZoom(ph, (ph.zoom || ph.fit) * 1.25));
      if (ctrl && k === '-') return act(() => setZoom(ph, (ph.zoom || ph.fit) / 1.25));
      if (ctrl && k === '0') return act(() => { ph.zoom = 0; layout(ph); });
      if (ctrl && k === '1') return act(() => setZoom(ph, 1));
      return undefined;
    });
    win.cleanup(() => stopShow(ph));
  }
})(window.Win);
