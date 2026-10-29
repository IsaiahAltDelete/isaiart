/* ===========================================================================
   File Explorer, plus the file plumbing every other app leans on:

   - Win.openFile(id)          route a node to the app that opens it
   - Win.openWith(id, appId)   open a node in a specific app
   - Win.pickFile(options)     modal Open / Save As dialog
   - Win.Explorer              helpers (new folder, paste, properties, ...)
                               shared with the desktop and the tests

   Each window holds tabs; each tab has its own location, history and
   selection. A location is a node id from Win.FS, one of the virtual roots in
   Win.FS.roots, 'profile' (the user folder: its node id 'home' collides with
   the Home view) or 'zip:<id>[|sub/path]' for a browsable archive.

   Drags carry the dataTransfer type 'application/x-win-fs' (a JSON array of
   node ids) and also set Win.dragFiles = { ids } while in flight.
   =========================================================================== */

(function (Win) {
  'use strict';

  const DAY = 86400000;
  const START = Date.now();
  const MIME = 'application/x-win-fs';
  const PROFILE = 'profile';
  const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']);
  const TEXT = new Set(['txt', 'log', 'ini', 'md', 'csv', 'bat', 'ps1', 'cmd', 'json', 'xml', 'reg', 'cfg', 'inf', 'html', 'htm', 'css', 'js']);
  const OFFICE = { docx: 'Word', doc: 'Word', rtf: 'Word', xlsx: 'Excel', xls: 'Excel', pptx: 'PowerPoint', ppt: 'PowerPoint' };
  const MEDIA = new Set(['mp3', 'wav', 'm4a', 'wma', 'flac', 'mp4', 'mov', 'mkv', 'avi', 'wmv']);
  const g = (name, size = 16) => Win.glyph(name, size);
  const esc = Win.esc;
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

  Win.DefaultState.explorer = {
    pinned: ['desktop', 'downloads', 'documents', 'pictures', 'music', 'videos'],
    favorites: [],
    views: {},          // location -> view id
    sorts: {},          // location -> { key, dir }
    cols: {},           // column key -> width in px
    assoc: {},          // extension -> app id chosen with "Always"
    navPane: true,
    navWidth: 220,
    pane: '',           // '' | 'details' | 'preview'
    compact: false,
    openTo: 'home',
    showRecent: true,
    fullPath: false,
    netDiscovery: false,
  };

  const X = () => (Win.state.explorer ||= Win.clone(Win.DefaultState.explorer));
  const S = () => Win.state.settings;

  const VIEWS = [
    { id: 'xl', label: 'Extra large icons', glyph: 'view' },
    { id: 'lg', label: 'Large icons', glyph: 'view' },
    { id: 'md', label: 'Medium icons', glyph: 'view' },
    { id: 'sm', label: 'Small icons', glyph: 'apps' },
    { id: 'list', label: 'List', glyph: 'list' },
    { id: 'details', label: 'Details', glyph: 'details' },
    { id: 'tiles', label: 'Tiles', glyph: 'apps' },
    { id: 'content', label: 'Content', glyph: 'document' },
  ];

  /* ------------------------------------------------------------- node facts */

  const hash = value => [...String(value)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const bytesOf = text => (text ? new Blob([text]).size : 0);
  const isFolderish = n => !!n && (n.kind === 'folder' || n.kind === 'drive');
  const mtime = n => n.modified ?? n.created ?? START - (20 + (hash(n.id) % 60)) * DAY;
  const sizeOf = n => (n.kind === 'file' ? (n.size ?? bytesOf(n.content)) : n.virtual ? 0 : Win.FS.size(n.id));
  const typeOf = n => (n.kind === 'shortcut' ? 'Shortcut' : Win.FS.typeName(n));
  const stemOf = n => (n.kind === 'file' && n.ext ? n.name.slice(0, -(n.ext.length + 1)) : n.name);
  const profilePath = () => `C:\\Users\\${Win.PERSONA.user}`;
  const pathOf = id => (id === 'home' ? profilePath() : Win.FS.path(id));
  const isImage = n => !!n && n.kind === 'file' && IMAGE.has((n.ext || '').toLowerCase());
  const kb = b => `${Math.ceil(b / 1024).toLocaleString('en-US')} KB`;

  /** Explorer's status-bar size style: three significant digits, truncated. */
  function human(b) {
    if (!Number.isFinite(b)) return '';
    if (b < 1024) return `${b} bytes`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = b;
    let i = -1;
    do { v /= 1024; i += 1; } while (v >= 1024 && i < units.length - 1);
    const s = v >= 100 ? String(Math.floor(v)) : v >= 10 ? (Math.floor(v * 10) / 10).toFixed(1) : (Math.floor(v * 100) / 100).toFixed(2);
    return `${s} ${units[i]}`;
  }
  const bytesLong = b => `${human(b)} (${b.toLocaleString('en-US')} bytes)`;
  const longDate = t => new Date(t).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

  /** Not trashed and not on an ejected drive. */
  function reachable(node) {
    let n = node;
    while (n) {
      if (n.parent === 'bin') return false;
      if (n.kind === 'drive') return !n.ejected;
      n = Win.FS.get(n.parent);
    }
    return true;
  }

  const visible = n => S().hiddenFiles || !n.hidden;

  /* -------------------------------------------------------------- locations */

  const locOf = id => (id === 'home' ? PROFILE : id);
  const folderOf = loc => (loc === PROFILE ? 'home' : loc);
  const isZip = loc => typeof loc === 'string' && loc.startsWith('zip:');
  const zipParts = loc => { const [id, sub = ''] = loc.slice(4).split('|'); return { id, sub }; };
  const nodeAt = loc => (loc === PROFILE ? Win.FS.get('home') : (Win.FS.roots[loc] || isZip(loc)) ? null : Win.FS.get(loc));

  function locExists(loc) {
    if (Win.FS.roots[loc]) return true;
    if (isZip(loc)) {
      const { id, sub } = zipParts(loc);
      const zip = Win.FS.get(id);
      return !!zip && reachable(zip) && !!zipEntry(zip, sub);
    }
    const node = nodeAt(loc);
    return !!node && isFolderish(node) && reachable(node);
  }

  function locName(loc) {
    if (Win.FS.roots[loc]) return Win.FS.roots[loc];
    if (isZip(loc)) {
      const { id, sub } = zipParts(loc);
      return sub ? sub.split('/').pop() : Win.FS.display(Win.FS.get(id));
    }
    const node = nodeAt(loc);
    if (!node) return '';
    return node.id === 'onedrive' ? 'OneDrive - Personal' : Win.FS.display(node);
  }

  function locPath(loc) {
    if (Win.FS.roots[loc]) return Win.FS.roots[loc];
    if (isZip(loc)) {
      const { id, sub } = zipParts(loc);
      return pathOf(id) + (sub ? `\\${sub.replace(/\//g, '\\')}` : '');
    }
    return pathOf(folderOf(loc));
  }

  function parentLoc(loc) {
    if (Win.FS.roots[loc]) return null;
    if (isZip(loc)) {
      const { id, sub } = zipParts(loc);
      if (sub) { const parts = sub.split('/'); parts.pop(); return parts.length ? `zip:${id}|${parts.join('/')}` : `zip:${id}`; }
      const zip = Win.FS.get(id);
      return zip ? locOf(zip.parent) : null;
    }
    const node = nodeAt(loc);
    if (!node) return null;
    if (node.kind === 'drive') return 'pc';
    return node.parent === 'pc' ? 'pc' : locOf(node.parent);
  }

  const writableFolder = loc => {
    if (Win.FS.roots[loc] || isZip(loc)) return null;
    const node = nodeAt(loc);
    return node && isFolderish(node) ? node.id : null;
  };

  /** Where a tab lands when its folder disappears: the nearest live ancestor. */
  function survivingLoc(loc) {
    if (isZip(loc)) {
      const zip = Win.FS.get(zipParts(loc).id);
      return zip ? survivingLoc(locOf(zip.parent)) : 'home';
    }
    let node = nodeAt(loc);
    let guard = 0;
    while (node && guard++ < 64) {
      if (locExists(locOf(node.id))) return locOf(node.id);
      if (node.kind === 'drive') return 'pc';
      node = Win.FS.get(node.parent === 'bin' ? node.trashedFrom : node.parent);
    }
    return 'pc';
  }

  const ROOT_NAMES = { 'this pc': 'pc', computer: 'pc', 'my computer': 'pc', 'recycle bin': 'bin', home: 'home', 'quick access': 'home', gallery: 'gallery', network: 'network' };
  const KNOWN_NAMES = { desktop: 'desktop', documents: 'documents', downloads: 'downloads', pictures: 'pictures', music: 'music', videos: 'videos', onedrive: 'onedrive', 'onedrive - personal': 'onedrive' };

  /** Address-bar input -> { loc } for a folder, { file } for a file, or null. */
  function resolveInput(text, cwd) {
    const value = String(text || '').trim();
    if (!value) return null;
    const lower = value.toLowerCase().replace(/\\+$/, '');
    if (ROOT_NAMES[lower]) return { loc: ROOT_NAMES[lower] };
    if (KNOWN_NAMES[lower] && Win.FS.get(KNOWN_NAMES[lower])) return { loc: KNOWN_NAMES[lower] };
    const base = writableFolder(cwd) || 'home';
    const id = Win.FS.resolve(value, base);
    const node = id && Win.FS.get(id);
    if (!node || !reachable(node)) return null;
    if (isFolderish(node)) return { loc: locOf(node.id) };
    return { file: node.id };
  }

  /** Accept anything callers pass as `path`: a location, node id or file id. */
  function normalizeLoc(path) {
    if (!path) return null;
    if (Win.FS.roots[path] || path === PROFILE || isZip(path)) return { loc: path };
    const node = Win.FS.get(path);
    if (!node) return null;
    if (isFolderish(node)) return { loc: locOf(node.id) };
    if (node.ext === 'zip') return { loc: `zip:${node.id}` };
    return { loc: locOf(node.parent), select: node.id };
  }

  /* -------------------------------------------------------------- archives */

  /** Contents for archives that arrived from elsewhere and carry no listing. */
  function fictionalEntries(zip) {
    const stem = zip.name.replace(/\.zip$/i, '');
    if (/photo|pic|img|camera/i.test(stem)) {
      return [
        { name: 'IMG_2041.jpg', kind: 'file', ext: 'jpg', size: 2_910_442, art: 'beach' },
        { name: 'IMG_2042.jpg', kind: 'file', ext: 'jpg', size: 3_204_118, art: 'sunset' },
        { name: 'IMG_2047.jpg', kind: 'file', ext: 'jpg', size: 3_877_090, art: 'mountain' },
        { name: 'IMG_2051.jpg', kind: 'file', ext: 'jpg', size: 2_455_731, art: 'city' },
        { name: 'Captions.txt', kind: 'file', ext: 'txt', content: 'IMG_2041 - first morning at the beach\r\nIMG_2042 - sunset from the dock\r\nIMG_2047 - the ridge trail\r\nIMG_2051 - downtown on the last night\r\n' },
      ];
    }
    return [
      { name: 'Readme.txt', kind: 'file', ext: 'txt', content: `${stem}\r\n\r\nExtract all files to a folder before using them.\r\n` },
      { name: 'Files', kind: 'folder', children: [
        { name: 'notes.txt', kind: 'file', ext: 'txt', content: 'Archive notes.\r\n' },
        { name: 'data.csv', kind: 'file', ext: 'csv', content: 'name,value\r\nalpha,1\r\nbeta,2\r\n' },
      ] },
    ];
  }

  const zipEntries = zip => zip.entries || fictionalEntries(zip);

  function zipEntry(zip, sub) {
    let list = zipEntries(zip);
    if (!sub) return { kind: 'folder', children: list };
    let cur = null;
    for (const part of sub.split('/')) {
      cur = list.find(e => e.kind === 'folder' && e.name === part);
      if (!cur) return null;
      list = cur.children || [];
    }
    return cur;
  }

  function zipItems(loc) {
    const { id, sub } = zipParts(loc);
    const zip = Win.FS.get(id);
    const entry = zip && zipEntry(zip, sub);
    if (!entry) return [];
    const prefix = sub ? `${sub}/` : '';
    return (entry.children || []).map(e => ({
      id: `z:${id}|${prefix}${e.name}`,
      name: e.name,
      kind: e.kind === 'folder' ? 'folder' : 'file',
      ext: e.kind === 'folder' ? '' : (e.ext ?? (e.name.includes('.') ? e.name.split('.').pop().toLowerCase() : '')),
      size: e.kind === 'folder' ? undefined : (e.size ?? bytesOf(e.content)),
      content: e.content,
      art: e.art,
      data: e.data,
      modified: zip.modified,
      parent: id,
      virtual: true,
      zipLoc: e.kind === 'folder' ? `zip:${id}|${prefix}${e.name}` : null,
    }));
  }

  function writeEntries(entries, parent) {
    for (const e of entries) {
      if (e.kind === 'folder') {
        const folder = Win.FS.create(parent, e.name, 'folder');
        writeEntries(e.children || [], folder.id);
      } else {
        const props = {};
        for (const key of ['size', 'content', 'art', 'data', 'entries']) if (e[key] !== undefined) props[key] = e[key];
        Win.FS.create(parent, e.name, 'file', props);
      }
    }
  }

  /* ------------------------------------------------------------------ icons */

  const KNOWN_ART = {
    desktop: ['#2f7de1', 'display'], documents: ['#5b6b82', 'document'], downloads: ['#15a046', 'download'],
    pictures: ['#0f9bd7', 'picture'], music: ['#ea6a13', 'music'], videos: ['#7c4ddb', 'video'],
  };

  function knownIcon(known, size) {
    const [color, glyph] = KNOWN_ART[known];
    const badge = `<rect x="15" y="21" width="18" height="15" rx="3" fill="${color}"/><svg x="17.5" y="22.5" width="13" height="12" viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${Win.glyphs[glyph]}</svg>`;
    return Win.appIcon('folder', size).replace(/<\/svg>$/, `${badge}</svg>`);
  }

  function iconFor(n, size) {
    if (!n) return Win.appIcon('generic', size);
    if (n.kind === 'folder' && KNOWN_ART[n.known]) return knownIcon(n.known, size);
    return Win.fileIcon(n, size);
  }

  function locIcon(loc, size = 16) {
    switch (loc) {
      case 'home': return `<span class="fx-homeico">${g('home', size)}</span>`;
      case 'gallery': return Win.appIcon('gallery', size);
      case 'pc': return Win.appIcon('thispc', size);
      case 'bin': return Win.appIcon(Win.FS.children('bin', { hidden: true }).length ? 'recyclefull' : 'recycle', size);
      case 'network': return Win.appIcon('network', size);
      case PROFILE: return Win.appIcon('user', size);
      default:
        if (isZip(loc)) return zipParts(loc).sub ? Win.appIcon('folder', size) : Win.appIcon('zip', size);
        return iconFor(nodeAt(loc), size);
    }
  }

  /** Image thumbnail when there is a picture to show, the type icon otherwise. */
  function thumb(n, size) {
    const url = isImage(n) && Win.imageURL ? Win.imageURL(n) : '';
    if (!url || size < 40) return iconFor(n, size);
    const rot = n.rotation ? ` style="transform:rotate(${Number(n.rotation) || 0}deg)"` : '';
    return `<span class="fx-thumb" style="width:${size}px;height:${size}px"><img src="${esc(url)}" alt="" draggable="false" decoding="async"${rot}></span>`;
  }

  /* --------------------------------------------------------------- columns */

  const origin = n => pathOf(Win.FS.get(n.trashedFrom) ? n.trashedFrom : 'desktop');
  const COLS = {
    name: { label: 'Name', w: 280, sort: n => Win.FS.display(n) },
    modified: { label: 'Date modified', w: 170, sort: mtime, text: n => Win.formatDateTime(mtime(n)) },
    type: { label: 'Type', w: 170, sort: typeOf, text: typeOf },
    size: { label: 'Size', w: 96, right: true, sort: n => (n.kind === 'file' ? sizeOf(n) : -1), text: n => (n.kind === 'file' ? kb(sizeOf(n)) : '') },
    from: { label: 'Original Location', w: 230, sort: origin, text: origin },
    deleted: { label: 'Date Deleted', w: 170, sort: n => n.deletedAt || 0, text: n => Win.formatDateTime(n.deletedAt || START) },
    folder: { label: 'Folder', w: 240, sort: n => pathOf(n.parent), text: n => pathOf(n.parent) },
    location: { label: 'File location', w: 300, sort: n => pathOf(n.parent), text: n => pathOf(n.parent) },
  };
  const colW = key => X().cols[key] || COLS[key].w;
  const colTemplate = cols => cols.map(c => `${colW(c)}px`).join(' ');

  function sortList(items, { key, dir }) {
    const val = (COLS[key] || COLS.name).sort;
    return items.slice().sort((a, b) => {
      const fa = isFolderish(a);
      const fb = isFolderish(b);
      if (fa !== fb) return (fa ? -1 : 1) * dir;
      const va = val(a);
      const vb = val(b);
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb));
      return (r || collator.compare(Win.FS.display(a), Win.FS.display(b))) * dir;
    });
  }

  const isPictureLoc = loc => loc === 'pictures' || Win.FS.contains('pictures', loc);
  const viewFor = loc => X().views[loc] || (isPictureLoc(loc) ? 'lg' : 'details');
  const sortFor = loc => X().sorts[loc] || (loc === 'bin' ? { key: 'deleted', dir: -1 } : { key: 'name', dir: 1 });

  const FILTERS = [
    { id: 'folders', label: 'Folders', test: n => isFolderish(n) },
    { id: 'documents', label: 'Documents', test: n => ['txt', 'md', 'pdf', 'docx', 'doc', 'xlsx', 'csv', 'rtf', 'pptx', 'log'].includes(n.ext) },
    { id: 'pictures', label: 'Pictures', test: isImage },
    { id: 'music', label: 'Music', test: n => ['mp3', 'wav', 'm4a', 'flac', 'wma'].includes(n.ext) },
    { id: 'videos', label: 'Videos', test: n => ['mp4', 'mov', 'mkv', 'avi', 'wmv'].includes(n.ext) },
    { id: 'archives', label: 'Compressed', test: n => ['zip', '7z'].includes(n.ext) },
  ];

  function galleryImages() {
    const seen = new Set();
    return ['pictures', 'onedrive'].flatMap(root => Win.FS.descendants(root))
      .filter(n => isImage(n) && !seen.has(n.id) && seen.add(n.id) && reachable(n) && visible(n))
      .sort((a, b) => mtime(b) - mtime(a));
  }

  /* -------------------------------------------------------------- clipboard */

  const clip = () => Win.state.clipboard;
  const isCut = id => clip()?.op === 'cut' && clip().ids?.includes(id);
  const canPaste = folder => !!folder && ['copy', 'cut'].includes(clip()?.op) && clip().ids.some(id => Win.FS.get(id));

  /* ================================================================ helpers */

  const Explorer = Win.Explorer = {
    human, kb, galleryImages, iconFor, pathOf, reachable,

    newFolder: (parent, name = 'New folder') => Win.FS.create(parent, name, 'folder'),
    newTextDocument: parent => Win.FS.create(parent, 'New Text Document.txt', 'file', { content: '' }),
    newZip: parent => Win.FS.create(parent, 'New Compressed (zipped) Folder.zip', 'file', { size: 22, entries: [] }),

    /** Returns '' on success or the reason the name was refused. */
    rename: (id, name) => Win.FS.rename(id, name),

    setClipboard(op, ids) {
      Win.state.clipboard = { op, ids: [...ids] };
      Win.save();
    },

    copyAsPath(ids) {
      const text = ids.map(id => `"${pathOf(id)}"`).join('\r\n');
      Win.state.clipboard = { op: 'text', ids: [], text };
      Win.save();
      try { navigator.clipboard?.writeText(text).catch(() => {}); } catch { /* no clipboard */ }
      return text;
    },

    /** Paste the shared clipboard into a folder; returns the new/moved ids. */
    paste(folder) {
      const c = clip();
      if (!folder || !c || !['copy', 'cut'].includes(c.op)) return [];
      const out = Explorer.transfer(c.ids, folder, c.op === 'cut' ? 'move' : 'copy');
      if (c.op === 'cut') { Win.state.clipboard = null; Win.save(); }
      return out;
    },

    transfer(ids, folder, effect) {
      const out = [];
      for (const id of ids) {
        const node = Win.FS.get(id);
        if (!node || id === folder || Win.FS.contains(id, folder)) continue;
        if (effect === 'move') { if (Win.FS.move(id, folder)) out.push(id); } else {
          const dupe = Win.FS.copy(id, folder);
          if (dupe) out.push(dupe.id);
        }
      }
      return out;
    },

    /** Recycle (or, from the bin / removable drives / `permanent`, purge). */
    async remove(ids, { permanent = false, owner = null } = {}) {
      const nodes = ids.map(id => Win.FS.get(id)).filter(Boolean);
      const blocked = nodes.filter(n => n.system || n.kind === 'drive');
      const rest = nodes.filter(n => !blocked.includes(n));
      if (blocked.length) {
        const folder = blocked.some(isFolderish);
        await Win.alert(folder ? 'Folder Access Denied' : 'File Access Denied', `You'll need to provide administrator permission to delete ${blocked.length > 1 ? 'these items' : folder ? 'this folder' : 'this file'}.`, owner);
      }
      if (!rest.length) return 0;
      const purge = permanent || rest.some(n => n.parent === 'bin' || Win.FS.onRemovable(n.id));
      if (purge) {
        const one = rest.length === 1 ? rest[0] : null;
        const ok = await Win.confirm(one ? (isFolderish(one) ? 'Delete Folder' : 'Delete File') : 'Delete Multiple Items',
          one ? `Are you sure you want to permanently delete this ${isFolderish(one) ? 'folder' : 'file'}?\n\n${one.name}` : `Are you sure you want to permanently delete these ${rest.length} items?`, { owner });
        if (!ok) return 0;
        rest.forEach(n => Win.FS.purge(n.id));
      } else {
        rest.forEach(n => Win.FS.remove(n.id));
      }
      return rest.length;
    },

    restore: ids => ids.forEach(id => Win.FS.restore(id)),

    async emptyBin(owner = null) {
      const count = Win.FS.children('bin', { hidden: true }).length;
      if (!count) return false;
      const ok = await Win.confirm('Delete Multiple Items', count === 1 ? 'Are you sure you want to permanently delete this item?' : `Are you sure you want to permanently delete these ${count} items?`, { owner });
      if (ok) Win.FS.emptyBin();
      return ok;
    },

    isPinned: id => X().pinned.includes(id),
    pin(id) { if (!X().pinned.includes(id)) X().pinned.push(id); Win.save(); },
    unpin(id) { X().pinned = X().pinned.filter(p => p !== id); Win.save(); },
    isFavorite: id => X().favorites.includes(id),
    toggleFavorite(id) {
      X().favorites = X().favorites.includes(id) ? X().favorites.filter(f => f !== id) : [...X().favorites, id];
      Win.save();
    },

    eject(id) {
      const drive = Win.FS.get(id);
      if (!drive?.removable) return false;
      drive.ejected = true;
      Win.save('fs');
      Win.toast({ app: 'Windows', glyph: 'usb', title: 'Safe To Remove Hardware', body: `The '${Win.FS.display(drive)}' device can now be safely removed from the computer.` });
      return true;
    },

    compress(ids) {
      const nodes = ids.map(id => Win.FS.get(id)).filter(n => n && n.kind !== 'drive');
      if (!nodes.length) return null;
      const snap = n => (n.kind === 'folder'
        ? { name: n.name, kind: 'folder', children: Win.FS.children(n.id, { hidden: true }).map(snap) }
        : { name: n.name, kind: 'file', ext: n.ext, size: sizeOf(n), content: n.content, art: n.art, data: n.data });
      const total = nodes.reduce((sum, n) => sum + sizeOf(n), 0);
      return Win.FS.create(nodes[0].parent, `${stemOf(nodes[0])}.zip`, 'file', { size: Math.max(22, Math.round(total * 0.62)), entries: nodes.map(snap) });
    },

    /** Extract All dialog; resolves to the destination folder id or null. */
    extractAll(zipId, { owner = null, silent = false } = {}) {
      const zip = Win.FS.get(zipId);
      if (!zip) return Promise.resolve(null);
      const target = `${pathOf(zip.parent)}\\${zip.name.replace(/\.zip$/i, '')}`;
      const run = (path, show) => {
        const folder = ensureFolder(path);
        if (!folder) return null;
        writeEntries(zipEntries(zip), folder.id);
        if (show) Win.wm.open('explorer', { path: folder.id });
        return folder.id;
      };
      if (silent) return Promise.resolve(run(target, false));
      return Win.dialog({
        title: 'Extract Compressed (Zipped) Folders', owner, width: 540,
        body: `<p class="muted">Select a Destination and Extract Files</p>
          <label class="field"><span>Files will be extracted to this folder:</span><input class="input" data-dest value="${esc(target)}" spellcheck="false"></label>
          <label class="check"><input type="checkbox" data-show checked> Show extracted files when complete</label>`,
        buttons: [
          { label: 'Extract', primary: true, validate: box => destProblem(box.querySelector('[data-dest]').value), value: box => ({ path: box.querySelector('[data-dest]').value, show: box.querySelector('[data-show]').checked }) },
          { label: 'Cancel', value: null },
        ],
      }).then(result => (result ? run(result.path, result.show) : null));
    },

    properties: (ids, owner) => properties([].concat(ids), owner),

    /** Folder id under a viewport point inside an Explorer window element. */
    dropTarget(winEl, x, y) {
      const win = Win.wm.windows.find(w => w.el === winEl || w.el.contains(winEl));
      const ui = win?.state.fx;
      if (!ui) return null;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !win.el.contains(hit)) return null;
      const row = hit.closest('.fx-ni');
      if (row) return writableFolder(row.dataset.loc);
      const tabEl = hit.closest('.ft-tab');
      if (tabEl) return writableFolder(ui.tabs.find(t => t.id === tabEl.dataset.tab)?.loc);
      const crumb = hit.closest('[data-crumb]');
      if (crumb) return writableFolder(crumb.dataset.crumb);
      const item = hit.closest('.fx-item');
      const n = item && ui.map.get(item.dataset.id);
      if (n && !n.virtual && isFolderish(n)) return n.id;
      return writableFolder(ui.tab.loc);
    },

    /**
     * The window manager focuses `[autofocus]` (or the frame) a frame after a
     * press on an inactive window, which would steal focus from whatever was
     * clicked. Marking the pressed control first keeps the click's focus.
     */
    holdFocus(win) {
      const onDown = e => {
        if (!win.el.contains(e.target) || win.el.contains(document.activeElement)) return;
        const target = e.target.closest?.('input, textarea, select, button, [tabindex]');
        if (!target || !win.body.contains(target) || target.hasAttribute('autofocus')) return;
        const home = win.body.querySelector('[autofocus]');
        home?.removeAttribute('autofocus');
        target.setAttribute('autofocus', '');
        setTimeout(() => {
          target.removeAttribute('autofocus');
          if (home?.isConnected) home.setAttribute('autofocus', '');
        }, 150);
      };
      document.addEventListener('pointerdown', onDown, true);
      win.cleanup(() => document.removeEventListener('pointerdown', onDown, true));
    },
    options: owner => folderOptions(owner),
    share: (ids, owner) => share(ids, owner),
  };

  function destProblem(path) {
    const value = String(path || '').trim().replace(/\\+$/, '');
    const existing = Win.FS.resolve(value);
    if (existing) return isFolderish(Win.FS.get(existing)) ? '' : 'The destination is a file. Choose a folder.';
    const cut = value.lastIndexOf('\\');
    const parent = cut > 0 ? Win.FS.resolve(value.slice(0, cut) || '\\') : null;
    if (!parent || !isFolderish(Win.FS.get(parent))) return `The destination path '${value}' is invalid.`;
    return Win.FS.validName(value.slice(cut + 1));
  }

  function ensureFolder(path) {
    const value = String(path || '').trim().replace(/\\+$/, '');
    const existing = Win.FS.resolve(value);
    if (existing) return Win.FS.get(existing);
    const cut = value.lastIndexOf('\\');
    const parent = Win.FS.resolve(value.slice(0, cut));
    return parent ? Win.FS.create(parent, value.slice(cut + 1), 'folder') : null;
  }

  /* ============================================================= open files */

  const appName = id => Win.apps.get(id)?.name || id;

  function openWithApps(node) {
    const ext = (node.ext || '').toLowerCase();
    const list = [];
    if (isImage(node)) list.push('photos', 'paint', 'edge');
    else if (ext === 'pdf') list.push('edge');
    else if (MEDIA.has(ext)) list.push('mediaplayer', 'edge');
    if (!isImage(node) && ext !== 'zip') list.push('notepad');
    if (TEXT.has(ext) || node.content != null) list.push('edge');
    return [...new Set(list)].filter(id => Win.apps.get(id));
  }

  Win.openWith = (id, appId) => {
    const node = Win.FS.get(id);
    if (!node || !Win.apps.get(appId)) {
      Win.toast({ app: 'Windows', glyph: 'warning', title: 'App not found', body: `Windows can't find '${appId}'.`, transient: true });
      return false;
    }
    Win.FS.touch(id);
    Win.wm.open(appId, { fileId: id });
    return true;
  };

  Win.openFile = id => {
    const node = Win.FS.get(id);
    if (!node) return false;
    if (node.parent === 'bin') { properties([id]); return true; }
    if (node.kind === 'shortcut') {
      if (node.target && Win.FS.get(node.target)) return Win.openFile(node.target);
      Win.wm.open(node.app, node.args || {});
      return true;
    }
    if (isFolderish(node)) { Win.wm.open('explorer', { path: id }); return true; }
    const ext = (node.ext || '').toLowerCase();
    const chosen = X().assoc[ext];
    if (chosen && Win.apps.get(chosen)) return Win.openWith(id, chosen);
    if (IMAGE.has(ext)) return Win.openWith(id, 'photos');
    if (ext === 'zip') { Win.FS.touch(id); Win.wm.open('explorer', { path: `zip:${id}` }); return true; }
    if (ext === 'pdf') { Win.FS.touch(id); Win.wm.open('edge', { fileId: id }); return true; }
    if (OFFICE[ext]) { officeDialog(node); return true; }
    if (ext === 'exe' || ext === 'msi') { uac(node); return true; }
    if (TEXT.has(ext) || node.content != null) return Win.openWith(id, 'notepad');
    if (MEDIA.has(ext) && Win.apps.get('mediaplayer')) return Win.openWith(id, 'mediaplayer');
    chooseApp(node);
    return true;
  };

  function officeDialog(node) {
    const app = OFFICE[node.ext];
    Win.dialog({
      title: `Sign in to use ${app}`,
      body: `<p>To open “${esc(node.name)}”, sign in to Microsoft 365 with the account that has your ${app} subscription.</p>
        <p class="muted">You can still look inside the file with Notepad.</p>`,
      buttons: [{ label: 'Open with Notepad', value: 'notepad', primary: true }, { label: 'Close', value: null }],
    }).then(choice => choice && Win.openWith(node.id, 'notepad'));
  }

  function chooseApp(node) {
    const apps = [...new Set([...openWithApps(node), 'notepad', 'edge', 'photos', 'paint'])].filter(id => Win.apps.get(id));
    if (!apps.length) { Win.alert('File Explorer', `There's no app to open “${node.name}”.`); return; }
    const label = node.ext ? `.${node.ext}` : '';
    Win.dialog({
      title: `Select an app to open this ${label} file`, width: 420,
      body: `<div class="fx-apps" role="radiogroup">${apps.map((id, i) => `<label class="fx-appopt"><input type="radio" name="fx-app" value="${esc(id)}" ${i === 0 ? 'checked' : ''}>${Win.appIcon(Win.apps.get(id).icon, 24)}<span>${esc(appName(id))}</span></label>`).join('')}</div>`,
      buttons: [
        { label: 'Just once', primary: true, value: box => ({ app: box.querySelector('input:checked')?.value, always: false }) },
        { label: 'Always', value: box => ({ app: box.querySelector('input:checked')?.value, always: true }) },
        { label: 'Cancel', value: null },
      ],
    }).then(result => {
      if (!result?.app) return;
      if (result.always && node.ext) { X().assoc[node.ext] = result.app; Win.save(); }
      Win.openWith(node.id, result.app);
    });
  }

  /** User Account Control prompt for installers. */
  function uac(node) {
    const layer = Win.$('#overlay-layer') || document.body;
    const stem = stemOf(node);
    const publisher = /printer|hp/i.test(node.name) ? 'HP Inc.' : '';
    const el = Win.html(`<div class="uac" role="presentation">
      <div class="uac-box" role="alertdialog" aria-modal="true" aria-labelledby="uac-q">
        <div class="uac-head ${publisher ? '' : 'unknown'}">${g('shield', 16)}<span>User Account Control</span></div>
        <div class="uac-body">
          <h2 id="uac-q">Do you want to allow this app${publisher ? '' : ' from an unknown publisher'} to make changes to your device?</h2>
          <div class="uac-app">${Win.fileIcon(node, 32)}<span>${esc(stem)}</span></div>
          <p>${publisher ? `Verified publisher: ${esc(publisher)}` : 'Publisher: Unknown'}<br>File origin: ${Win.FS.onRemovable(node.id) ? 'Removable media on this computer' : 'Hard drive on this computer'}</p>
          <button class="link" data-more>Show more details</button>
          <p class="uac-more hidden">Program location: "${esc(pathOf(node.id))}"</p>
        </div>
        <div class="uac-actions"><button class="btn accent" data-v="yes">Yes</button><button class="btn" data-v="no">No</button></div>
      </div></div>`);
    const finish = yes => {
      el.remove();
      document.removeEventListener('keydown', onKey, true);
      if (!yes) return;
      Win.FS.touch(node.id);
      Win.toast({ app: stem, icon: 'exe', title: `Installing ${stem}`, body: 'Setup is copying files.', transient: true, timeout: 2500 });
      setTimeout(() => {
        const apps = Win.state.apps || [];
        if (!apps.some(a => a.installedFrom === node.id)) {
          apps.push({ id: Win.uid('app'), name: stem.replace(/setup$/i, '').trim() || stem, publisher: publisher || 'Unknown publisher', size: Math.round((node.size || 1e6) * 2.4), version: '1.0.0', date: Date.now(), installedFrom: node.id });
          Win.state.apps = apps;
          Win.save('apps');
        }
        Win.toast({ app: stem, icon: 'exe', title: 'Installation complete', body: `${stem} was set up successfully.` });
      }, 1800);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    };
    el.addEventListener('click', e => {
      if (e.target.closest('[data-more]')) { el.querySelector('.uac-more').classList.toggle('hidden'); return; }
      const v = e.target.closest('[data-v]')?.dataset.v;
      if (v) finish(v === 'yes');
    });
    el.addEventListener('pointerdown', e => e.stopPropagation());
    document.addEventListener('keydown', onKey, true);
    layer.appendChild(el);
    requestAnimationFrame(() => el.querySelector('[data-v="no"]').focus());
  }

  /* ========================================================= properties etc */

  function properties(ids, owner = null) {
    const nodes = ids.map(id => Win.FS.get(id)).filter(Boolean);
    if (!nodes.length) return Promise.resolve(null);
    const one = nodes.length === 1 ? nodes[0] : null;
    const rows = [];
    const sep = () => rows.push(null);
    const row = (label, value, raw = false) => rows.push([label, raw ? value : esc(value)]);
    let head = '';
    let ring = '';

    if (one?.kind === 'drive') {
      const used = Win.FS.used(one.id);
      const cap = one.capacity || used;
      const pct = Math.min(100, (used / cap) * 100);
      head = Win.appIcon(one.icon || 'drive', 32);
      row('Type:', one.removable ? 'USB Drive' : 'Local Disk');
      row('File system:', one.removable ? 'exFAT' : 'NTFS');
      sep();
      row('Used space:', `<span class="fx-sw used"></span>${esc(bytesLong(Math.round(used)))}`, true);
      row('Free space:', `<span class="fx-sw"></span>${esc(bytesLong(Math.round(cap - used)))}`, true);
      sep();
      row('Capacity:', bytesLong(Math.round(cap)));
      ring = `<div class="fx-ringwrap"><div class="fx-ring" style="--p:${pct.toFixed(1)}"></div><span>Drive ${esc(one.letter)}:</span></div>`;
    } else if (one) {
      head = iconFor(one, 32);
      const size = sizeOf(one);
      const disk = one.kind === 'file' ? Math.ceil(size / 4096) * 4096 : Win.FS.descendants(one.id).filter(n => n.kind === 'file').reduce((s, n) => s + Math.ceil(sizeOf(n) / 4096) * 4096, 0);
      if (one.kind === 'file') {
        row('Type of file:', `${typeOf(one)}${one.ext ? ` (.${one.ext})` : ''}`);
        const opener = openWithApps(one)[0];
        if (opener) row('Opens with:', `${Win.appIcon(Win.apps.get(opener).icon, 16)} ${esc(appName(opener))}`, true);
      } else {
        row('Type:', 'File folder');
      }
      sep();
      if (one.parent === 'bin') {
        row('Location:', 'Recycle Bin');
        row('Original location:', origin(one));
        row('Date deleted:', longDate(one.deletedAt || START));
      } else {
        row('Location:', pathOf(one.parent));
      }
      row('Size:', bytesLong(size));
      row('Size on disk:', bytesLong(disk));
      if (one.kind === 'folder') {
        const all = Win.FS.descendants(one.id);
        row('Contains:', `${all.filter(n => n.kind !== 'folder').length.toLocaleString('en-US')} Files, ${all.filter(n => n.kind === 'folder').length.toLocaleString('en-US')} Folders`);
      }
      sep();
      row('Created:', longDate(one.created ?? mtime(one)));
      row('Modified:', longDate(mtime(one)));
      if (one.kind === 'file') row('Accessed:', longDate(Win.state.recent.includes(one.id) ? Date.now() : mtime(one)));
    } else {
      head = iconFor(nodes[0], 32);
      const files = nodes.filter(n => !isFolderish(n)).length;
      const types = new Set(nodes.map(typeOf));
      const parents = new Set(nodes.map(n => n.parent));
      const size = nodes.reduce((s, n) => s + sizeOf(n), 0);
      row('Type:', types.size === 1 ? `All of type ${[...types][0]}` : 'Multiple types');
      row('Location:', parents.size === 1 ? `All in ${pathOf(nodes[0].parent)}` : 'Various folders');
      sep();
      row('Size:', bytesLong(size));
      row('Contains:', `${files} Files, ${nodes.length - files} Folders`);
    }

    const editable = one && one.kind !== 'drive' && !one.system && one.parent !== 'bin';
    const nameValue = one ? (one.kind === 'drive' ? one.name : Win.FS.display(one)) : `${nodes.filter(n => !isFolderish(n)).length} Files, ${nodes.filter(isFolderish).length} Folders`;
    const attrs = one?.kind === 'drive' ? '' : `<div class="fx-pattr"><span>Attributes:</span>
      <label class="check"><input type="checkbox" data-attr="readonly" ${nodes.every(n => n.readonly) ? 'checked' : ''} ${nodes.some(n => n.system) ? 'disabled' : ''}> Read-only</label>
      <label class="check"><input type="checkbox" data-attr="hidden" ${nodes.every(n => n.hidden) ? 'checked' : ''} ${nodes.some(n => n.system && n.kind === 'drive') ? 'disabled' : ''}> Hidden</label></div>`;
    const title = `${one ? (one.kind === 'drive' ? Win.FS.display(one) : one.name) : `${nodes.length} items`} Properties`;
    const body = `<div class="fx-props">
      <div class="fx-ptabs" role="tablist"><span role="tab" aria-selected="true">General</span></div>
      <div class="fx-phead">${head}<input class="input" data-pname value="${esc(nameValue)}" ${editable && one.kind !== 'drive' ? '' : 'readonly'} aria-label="Name" spellcheck="false"></div>
      <div class="fx-prows">${rows.map(r => (r ? `<span class="k">${esc(r[0])}</span><span class="v">${r[1]}</span>` : '<hr>')).join('')}</div>
      ${ring}${attrs ? `<hr>${attrs}` : ''}
    </div>`;
    const fullName = (n, value) => (n.kind === 'file' && !S().fileExtensions && n.ext ? `${value}.${n.ext}` : value);
    return Win.dialog({
      title, body, owner, width: 420,
      buttons: [
        {
          label: 'OK', primary: true,
          validate: box => {
            if (!editable) return '';
            const value = box.querySelector('[data-pname]').value.trim();
            if (value === nameValue) return '';
            const name = fullName(one, value);
            const problem = Win.FS.validName(name);
            if (problem) return problem;
            const clash = Win.FS.children(one.parent, { hidden: true }).some(n => n.id !== one.id && n.name.toLowerCase() === name.toLowerCase());
            return clash ? 'There is already a file with the same name in this location.' : '';
          },
          value: box => {
            const read = attr => box.querySelector(`[data-attr="${attr}"]`);
            return { name: box.querySelector('[data-pname]').value.trim(), readonly: read('readonly')?.checked, hidden: read('hidden')?.checked };
          },
        },
        { label: 'Cancel', value: null },
      ],
    }).then(result => {
      if (!result) return null;
      if (editable && result.name !== nameValue) Win.FS.rename(one.id, fullName(one, result.name));
      if (one?.kind !== 'drive') {
        nodes.forEach(n => {
          if (!n.system && result.readonly !== undefined) n.readonly = !!result.readonly || undefined;
          if (result.hidden !== undefined && n.kind !== 'drive') n.hidden = !!result.hidden || undefined;
        });
        Win.save('fs');
      }
      return result;
    });
  }

  function folderOptions(owner = null) {
    const x = X();
    return Win.dialog({
      title: 'Folder Options', owner, width: 460,
      body: `<div class="fx-opts">
        <div class="fx-ptabs" role="tablist"><span role="tab" aria-selected="true">General &amp; View</span></div>
        <label class="field"><span>Open File Explorer to:</span>${Win.select([['home', 'Home'], ['pc', 'This PC']], x.openTo, 'data-o="openTo"')}</label>
        <h3>Privacy</h3>
        <label class="check"><input type="checkbox" data-o="showRecent" ${x.showRecent ? 'checked' : ''}> Show recently used files</label>
        <div class="fx-orow"><span class="muted">Clear File Explorer history</span><button class="btn sm" data-clear>Clear</button></div>
        <h3>Files and folders</h3>
        <label class="check"><input type="checkbox" data-o="hiddenFiles" ${S().hiddenFiles ? 'checked' : ''}> Show hidden files, folders, and drives</label>
        <label class="check"><input type="checkbox" data-o="hideExt" ${S().fileExtensions ? '' : 'checked'}> Hide extensions for known file types</label>
        <label class="check"><input type="checkbox" data-o="fullPath" ${x.fullPath ? 'checked' : ''}> Display the full path in the title bar</label>
      </div>`,
      onRender(box) {
        box.querySelector('[data-clear]').addEventListener('click', e => {
          Win.state.recent = [];
          Win.save('fs');
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = 'Cleared';
        });
      },
      buttons: [
        { label: 'OK', primary: true, value: box => Object.fromEntries(Win.$$('[data-o]', box).map(el => [el.dataset.o, el.type === 'checkbox' ? el.checked : el.value])) },
        { label: 'Cancel', value: null },
      ],
    }).then(o => {
      if (!o) return;
      x.openTo = o.openTo;
      x.showRecent = o.showRecent;
      x.fullPath = o.fullPath;
      S().hiddenFiles = o.hiddenFiles;
      S().fileExtensions = !o.hideExt;
      Win.save('fs');
    });
  }

  function share(ids, owner = null) {
    const nodes = ids.map(id => Win.FS.get(id)).filter(n => n && n.kind === 'file');
    if (!nodes.length) return Promise.resolve(null);
    const targets = [
      Win.apps.get('mail') && { id: 'mail', label: 'Mail', icon: Win.appIcon('mail', 32) },
      { id: 'onedrive', label: 'OneDrive', icon: Win.appIcon('onedrive', 32) },
      { id: 'copy', label: 'Copy', icon: `<span class="fx-shareglyph">${g('copy', 22)}</span>` },
    ].filter(Boolean);
    return Win.dialog({
      title: nodes.length === 1 ? `Share “${Win.FS.display(nodes[0])}”` : `Share ${nodes.length} items`, owner, width: 420,
      body: `<div class="fx-share">
        <div class="fx-sharesec"><span class="caption muted">Nearby Share</span><p class="caption" data-near>Nearby sharing is off. <button class="link" data-on>Turn on</button></p></div>
        <div class="fx-sharesec"><span class="caption muted">Share using</span><div class="fx-shareapps">${targets.map(t => `<button class="fx-shareapp" data-target="${t.id}">${t.icon}<span>${esc(t.label)}</span></button>`).join('')}</div></div>
      </div>`,
      buttons: [{ label: 'Close', value: null }],
      onRender(box, { close }) {
        box.addEventListener('click', e => {
          if (e.target.closest('[data-on]')) {
            const line = box.querySelector('[data-near]');
            line.textContent = 'Looking for nearby devices…';
            setTimeout(() => { line.textContent = 'No devices found nearby. Make sure the other device has Nearby sharing turned on.'; }, 1600);
            return;
          }
          const t = e.target.closest('[data-target]')?.dataset.target;
          if (t) close(t);
        });
      },
    }).then(target => {
      if (target === 'mail') Win.wm.open('mail', { attachments: nodes.map(n => n.id) });
      if (target === 'copy') { Explorer.setClipboard('copy', nodes.map(n => n.id)); Win.toast({ app: 'File Explorer', icon: 'explorer', title: 'Copied', body: `${nodes.length} item${nodes.length > 1 ? 's' : ''} copied to the clipboard.`, transient: true }); }
      if (target === 'onedrive') {
        Explorer.transfer(nodes.map(n => n.id), 'onedrive', 'copy');
        Win.toast({ app: 'OneDrive', icon: 'onedrive', title: 'Upload complete', body: `${nodes.length === 1 ? nodes[0].name : `${nodes.length} files`} uploaded to OneDrive.` });
      }
      return target;
    });
  }

  /* ============================================================ file picker */

  const TYPE_LABELS = {
    txt: 'Text Documents', png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', bmp: 'Bitmap', gif: 'GIF', webp: 'WebP', svg: 'SVG',
    md: 'Markdown', csv: 'CSV', log: 'Log files', pdf: 'PDF', ini: 'Configuration settings',
  };

  function fileTypes(exts) {
    const clean = [...new Set((exts || []).map(e => String(e).replace(/^\*?\./, '').toLowerCase()).filter(Boolean))];
    const types = clean.map(e => ({ label: `${TYPE_LABELS[e] || `${e.toUpperCase()} files`} (*.${e})`, exts: [e] }));
    if (clean.length > 1 && clean.every(e => IMAGE.has(e))) types.unshift({ label: `All Picture Files (${clean.map(e => `*.${e}`).join(';')})`, exts: clean });
    types.push({ label: 'All files (*.*)', exts: null });
    return types;
  }

  /**
   * Win.pickFile({ mode: 'open'|'save', title, exts, defaultName, folder, owner })
   * Resolves { id } (open), { folder, name } (save), { id, folder, name,
   * overwrite: true } (save over an existing file) or null when cancelled.
   */
  Win.pickFile = (opts = {}) => {
    const { mode = 'open', exts = [], defaultName = '', owner = null } = opts;
    const save = mode === 'save';
    const types = fileTypes(exts);
    const start = opts.folder && Win.FS.get(opts.folder) && isFolderish(Win.FS.get(opts.folder)) && reachable(Win.FS.get(opts.folder)) ? opts.folder : 'documents';
    const st = { loc: locOf(start), type: 0, back: [], sel: null };
    const places = [['desktop', 'Desktop'], ['downloads', 'Downloads'], ['documents', 'Documents'], ['pictures', 'Pictures'], ['music', 'Music'], ['videos', 'Videos'], ['onedrive', 'OneDrive - Personal']]
      .filter(([id]) => Win.FS.get(id));
    const navHTML = () => `${places.map(([id, label]) => `<button class="fp-place" data-go="${id}">${iconFor(Win.FS.get(id), 16)}<span>${esc(label)}</span></button>`).join('')}
      <div class="fx-nsep"></div><button class="fp-place" data-go="pc">${Win.appIcon('thispc', 16)}<span>This PC</span></button>
      ${Win.FS.children('pc').map(d => `<button class="fp-place sub" data-go="${d.id}">${Win.appIcon(d.icon || 'drive', 16)}<span>${esc(Win.FS.display(d))}</span></button>`).join('')}`;
    const body = `<div class="fp">
      <div class="fp-top">
        <button class="icon-btn" data-fp="back" aria-label="Back" title="Back">${g('back')}</button>
        <button class="icon-btn" data-fp="up" aria-label="Up to parent folder" title="Up">${g('up')}</button>
        <div class="fp-path"></div>
        <button class="btn sm" data-fp="newfolder">${g('newfolder', 14)}<span>New folder</span></button>
      </div>
      <div class="fp-main">
        <nav class="fp-nav" aria-label="Locations">${navHTML()}</nav>
        <div class="fp-list" role="listbox" tabindex="0" aria-label="Folder contents"></div>
      </div>
      <div class="fp-bottom">
        <label class="fp-field"><span>File name:</span><input class="input" data-fp-name spellcheck="false" value="${esc(defaultName)}" autocomplete="off"></label>
        <label class="fp-field"><span>${save ? 'Save as type:' : 'File type:'}</span>${Win.select(types.map((t, i) => [i, t.label]), 0, 'data-fp-type')}</label>
      </div>
      <div class="fp-msg hidden" role="alert"></div>
    </div>`;

    return Win.dialog({
      title: opts.title || (save ? 'Save As' : 'Open'), body, owner, width: 780,
      buttons: [{ label: save ? 'Save' : 'Open', value: 'ok' }, { label: 'Cancel', value: null }],
      onRender(box, { close }) {
        const list = box.querySelector('.fp-list');
        const nameInput = box.querySelector('[data-fp-name]');
        const msgBox = box.querySelector('.fp-msg');
        const okButton = box.querySelector('[data-i="0"]');
        okButton.classList.add('accent');

        const msg = (html = '') => { msgBox.innerHTML = html; msgBox.classList.toggle('hidden', !html); };
        const realFolder = () => writableFolder(st.loc);
        const findIn = (folder, name) => Win.FS.children(folder, { hidden: true }).find(n => n.name.toLowerCase() === name.toLowerCase());
        const matches = n => {
          if (isFolderish(n)) return true;
          const t = types[st.type];
          return !t.exts || t.exts.includes((n.ext || '').toLowerCase());
        };

        const render = () => {
          const folder = realFolder();
          const items = st.loc === 'pc' ? Win.FS.children('pc') : folder ? sortList(Win.FS.children(folder).filter(matches), { key: 'name', dir: 1 }) : [];
          box.querySelector('.fp-path').innerHTML = `${locIcon(st.loc, 16)}<span>${esc(st.loc === 'pc' ? 'This PC' : locPath(st.loc))}</span>`;
          box.querySelector('[data-fp="back"]').disabled = !st.back.length;
          box.querySelector('[data-fp="up"]').disabled = !parentLoc(st.loc);
          box.querySelector('[data-fp="newfolder"]').disabled = !folder;
          Win.$$('.fp-place', box).forEach(b => b.classList.toggle('cur', locOf(b.dataset.go) === st.loc));
          list.innerHTML = `<div class="fp-row fp-head"><span>Name</span><span>Date modified</span><span>Type</span><span>Size</span></div>${items.length
            ? items.map(n => `<div class="fp-row ${st.sel === n.id ? 'sel' : ''}" role="option" aria-selected="${st.sel === n.id}" data-id="${esc(n.id)}"><span class="fp-n">${iconFor(n, 16)}<span>${esc(Win.FS.display(n))}</span></span><span>${n.kind === 'drive' ? '' : esc(Win.formatDateTime(mtime(n)))}</span><span>${esc(typeOf(n))}</span><span class="r">${n.kind === 'file' ? kb(sizeOf(n)) : ''}</span></div>`).join('')
            : '<p class="fp-empty">No items match your search.</p>'}`;
        };
        const go = (loc, push = true) => {
          if (!locExists(loc) || (isZip(loc))) return;
          if (push && loc !== st.loc) st.back.push(st.loc);
          st.loc = loc;
          st.sel = null;
          msg('');
          render();
        };
        const pick = n => {
          if (isFolderish(n)) { go(locOf(n.id)); return; }
          if (!save) { close({ id: n.id }); return; }
          nameInput.value = n.name;
          accept();
        };
        const askReplace = existing => {
          msg(`<span>${esc(existing.name)} already exists.<br>Do you want to replace it?</span><span class="fp-ask"><button class="btn accent sm" data-yes>Yes</button><button class="btn sm" data-no>No</button></span>`);
          msgBox.querySelector('[data-yes]').addEventListener('click', () => close({ id: existing.id, folder: existing.parent, name: existing.name, overwrite: true }));
          msgBox.querySelector('[data-no]').addEventListener('click', () => { msg(''); nameInput.focus(); });
          msgBox.querySelector('[data-yes]').focus();
        };
        const accept = () => {
          msg('');
          const raw = nameInput.value.trim();
          if (!raw) {
            const n = st.sel && Win.FS.get(st.sel);
            if (n && isFolderish(n)) go(locOf(n.id));
            return;
          }
          let folder = realFolder();
          let name = raw;
          if (/[\\/]/.test(raw) || /^[a-z]:/i.test(raw)) {
            const id = Win.FS.resolve(raw, folder || 'home');
            const hit = id && Win.FS.get(id);
            if (hit && isFolderish(hit)) { go(locOf(hit.id)); nameInput.value = ''; return; }
            if (hit && !save) { close({ id: hit.id }); return; }
            const cut = raw.replace(/\//g, '\\').lastIndexOf('\\');
            const dir = Win.FS.resolve(raw.slice(0, cut) || '\\', folder || 'home');
            if (!dir || !isFolderish(Win.FS.get(dir))) { msg(`The path “${esc(raw)}” does not exist.<br>Check the path and try again.`); return; }
            folder = dir;
            name = raw.replace(/\//g, '\\').slice(cut + 1);
          }
          if (!folder) { msg('Choose a folder first.'); return; }
          const t = types[st.type];
          const withExt = t.exts && !/\.[^.\\]+$/.test(name) ? `${name}.${t.exts[0]}` : name;
          const existing = findIn(folder, name) || findIn(folder, withExt);
          if (existing && isFolderish(existing)) { go(locOf(existing.id)); nameInput.value = ''; return; }
          if (!save) {
            if (!existing) { msg(`${esc(name)}<br>File not found.<br>Check the file name and try again.`); return; }
            close({ id: existing.id });
            return;
          }
          const problem = Win.FS.validName(withExt);
          if (problem) { msg(esc(problem)); return; }
          const clash = findIn(folder, withExt);
          if (clash) { askReplace(clash); return; }
          close({ folder, name: withExt });
        };

        okButton.addEventListener('click', e => { e.stopPropagation(); accept(); }, true);
        nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); accept(); } });
        box.querySelector('[data-fp-type]').addEventListener('change', e => { st.type = Number(e.target.value); render(); });
        box.querySelector('.fp-nav').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(locOf(b.dataset.go)); });
        box.querySelector('.fp-top').addEventListener('click', e => {
          const act = e.target.closest('[data-fp]')?.dataset.fp;
          if (act === 'back' && st.back.length) go(st.back.pop(), false);
          if (act === 'up' && parentLoc(st.loc)) go(parentLoc(st.loc));
          if (act === 'newfolder' && realFolder()) { const n = Explorer.newFolder(realFolder()); st.sel = n.id; render(); }
        });
        list.addEventListener('click', e => {
          const row = e.target.closest('.fp-row[data-id]');
          if (!row) return;
          st.sel = row.dataset.id;
          const n = Win.FS.get(st.sel);
          if (n && !isFolderish(n)) nameInput.value = n.name;
          render();
        });
        list.addEventListener('dblclick', e => {
          const n = Win.FS.get(e.target.closest('.fp-row[data-id]')?.dataset.id);
          if (n) pick(n);
        });
        list.addEventListener('keydown', e => {
          const rows = Win.$$('.fp-row[data-id]', list).map(r => r.dataset.id);
          if (!rows.length) return;
          const i = rows.indexOf(st.sel);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            st.sel = rows[Win.clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1)];
            const n = Win.FS.get(st.sel);
            if (n && !isFolderish(n)) nameInput.value = n.name;
            render();
            list.querySelector('.fp-row.sel')?.scrollIntoView({ block: 'nearest' });
          }
          if (e.key === 'Enter' && st.sel) { e.preventDefault(); e.stopPropagation(); pick(Win.FS.get(st.sel)); }
          if (e.key === 'Backspace' && parentLoc(st.loc)) { e.preventDefault(); go(parentLoc(st.loc)); }
        });
        render();
        if (save && defaultName) {
          const dot = defaultName.lastIndexOf('.');
          setTimeout(() => { try { nameInput.setSelectionRange(0, dot > 0 ? dot : defaultName.length); } catch { /* detached */ } }, 30);
        }
      },
    }).then(v => (v && typeof v === 'object' ? v : null));
  };

  /* ========================================================= explorer window */

  Win.apps.register({
    id: 'explorer',
    name: 'File Explorer',
    icon: 'explorer',
    customTitle: true,
    width: 1060,
    height: 640,
    minWidth: 480,
    minHeight: 320,
    category: 'System',
    keywords: ['files', 'folders', 'this pc', 'documents', 'explorer'],
    create: createExplorer,
  });

  function createExplorer(win, args = {}) {
    const ui = {
      win, tabs: [], tab: null, expanded: new Set(), collapsed: new Set(),
      renaming: null, editing: false, queued: 0, order: [], map: new Map(), rendered: null, pending: null, title: '',
    };
    win.state.fx = ui;
    win.el.classList.add('fx-window');
    win.titleContent.innerHTML = `<div class="ft-strip" role="tablist" aria-label="Tabs"></div>
      <button class="ft-add" data-act="newtab" aria-label="New tab" title="Add new tab (Ctrl+T)">${g('plus', 14)}</button>`;
    win.body.innerHTML = `<div class="fx">
      <div class="fx-top">
        <div class="fx-addr">
          <button class="icon-btn" data-act="back" aria-label="Back" title="Back (Alt+Left Arrow)">${g('back')}</button>
          <button class="icon-btn" data-act="forward" aria-label="Forward" title="Forward (Alt+Right Arrow)">${g('forward')}</button>
          <button class="icon-btn" data-act="up" aria-label="Up" title="Up to parent folder (Alt+Up Arrow)">${g('up')}</button>
          <button class="icon-btn" data-act="refresh" aria-label="Refresh" title="Refresh (F5)">${g('refresh')}</button>
          <div class="fx-bar" title="">
            <div class="fx-crumbs"></div>
            <input class="fx-pathin hidden" aria-label="Address" spellcheck="false" autocomplete="off">
          </div>
          <label class="fx-search">${g('search', 14)}<input type="text" aria-label="Search" spellcheck="false" autocomplete="off"><button class="fx-sx hidden" aria-label="Clear search">${g('close', 12)}</button></label>
        </div>
        <div class="fx-cmd" role="toolbar" aria-label="Command bar"></div>
      </div>
      <div class="fx-main">
        <nav class="fx-nav" aria-label="Navigation pane" role="tree"></nav>
        <div class="fx-split" role="separator" aria-orientation="vertical" aria-label="Resize navigation pane"></div>
        <div class="fx-view" tabindex="0" aria-label="Items view" autofocus></div>
        <aside class="fx-side hidden" aria-label="Details"></aside>
      </div>
      <div class="fx-status" role="status"></div>
    </div>`;
    const $ = sel => win.body.querySelector(sel);
    ui.el = {
      root: $('.fx'), strip: win.titleContent.querySelector('.ft-strip'), crumbs: $('.fx-crumbs'), pathIn: $('.fx-pathin'),
      bar: $('.fx-bar'), search: $('.fx-search input'), searchX: $('.fx-sx'), cmd: $('.fx-cmd'), nav: $('.fx-nav'),
      split: $('.fx-split'), view: $('.fx-view'), side: $('.fx-side'), status: $('.fx-status'),
    };
    wire(ui);
    Explorer.holdFocus(win);
    const start = normalizeLoc(args.path) || normalizeLoc(X().openTo) || { loc: 'home' };
    openTab(ui, start.loc, { select: start.select });
    win.listen('fs', () => schedule(ui));
    win.listen('state', () => schedule(ui));
  }

  /* -------------------------------------------------------------- tab model */

  function makeTab(loc) {
    return { id: Win.uid('t'), loc, back: [], fwd: [], sel: new Set(), anchor: null, focus: null, search: '', filter: '', scroll: 0 };
  }

  function openTab(ui, loc, { select = null, background = false, after = false } = {}) {
    const tab = makeTab(locExists(loc) ? loc : 'home');
    if (select) { tab.sel.add(select); tab.anchor = tab.focus = select; }
    const at = after && ui.tab ? ui.tabs.indexOf(ui.tab) + 1 : ui.tabs.length;
    ui.tabs.splice(at, 0, tab);
    if (!background || !ui.tab) activate(ui, tab);
    else renderTabs(ui);
    return tab;
  }

  function activate(ui, tab) {
    if (ui.tab && ui.tab !== tab) ui.tab.scroll = ui.el.view.scrollTop;
    ui.tab = tab;
    ui.el.search.value = tab.search;
    ui.rendered = null;
    endEdit(ui);
    renderAll(ui);
  }

  function closeTab(ui, id) {
    const index = ui.tabs.findIndex(t => t.id === id);
    if (index < 0) return;
    if (ui.tabs.length === 1) { ui.win.close(); return; }
    const [gone] = ui.tabs.splice(index, 1);
    if (gone === ui.tab) activate(ui, ui.tabs[Math.min(index, ui.tabs.length - 1)]);
    else renderTabs(ui);
  }

  function navigate(ui, loc, { select = null, push = true } = {}) {
    const tab = ui.tab;
    if (!locExists(loc)) return false;
    if (loc === tab.loc && !tab.search) {
      if (select) { tab.sel = new Set([select]); tab.anchor = tab.focus = select; }
      renderAll(ui);
      return true;
    }
    if (push) { tab.back.push(tab.loc); tab.fwd = []; }
    tab.loc = loc;
    tab.sel = new Set(select ? [select] : []);
    tab.anchor = tab.focus = select;
    tab.search = '';
    tab.filter = '';
    tab.scroll = 0;
    ui.el.search.value = '';
    ui.rendered = null;
    endEdit(ui);
    renderAll(ui);
    if (ui.win.el.contains(document.activeElement) && !document.activeElement.closest?.('.fx-nav')) ui.el.view.focus({ preventScroll: true });
    return true;
  }

  function goBack(ui) {
    const tab = ui.tab;
    while (tab.back.length) {
      const prev = tab.back.pop();
      if (!locExists(prev)) continue;
      const from = tab.loc;
      tab.fwd.push(from);
      navigate(ui, prev, { push: false, select: isZip(from) ? null : folderOf(from) });
      return;
    }
    renderAddress(ui);
  }

  function goForward(ui) {
    const tab = ui.tab;
    while (tab.fwd.length) {
      const next = tab.fwd.pop();
      if (!locExists(next)) continue;
      tab.back.push(tab.loc);
      navigate(ui, next, { push: false });
      return;
    }
  }

  function goUp(ui) {
    const up = parentLoc(ui.tab.loc);
    if (up) navigate(ui, up, { select: isZip(ui.tab.loc) ? (zipParts(ui.tab.loc).sub ? null : zipParts(ui.tab.loc).id) : folderOf(ui.tab.loc) });
  }

  /* --------------------------------------------------------------- rendering */

  function schedule(ui) {
    if (ui.queued || ui.win.closed) return;
    ui.queued = requestAnimationFrame(() => {
      ui.queued = 0;
      if (ui.win.closed) return;
      for (const tab of ui.tabs) {
        if (!locExists(tab.loc)) {
          tab.loc = survivingLoc(tab.loc);
          tab.sel.clear();
          tab.search = '';
        }
      }
      renderAll(ui);
    });
  }

  function renderAll(ui) {
    ui.el.root.classList.toggle('compact', !!X().compact);
    renderTabs(ui);
    renderAddress(ui);
    renderNav(ui);
    if (!ui.renaming) renderContent(ui);
    renderCmd(ui);
    renderSide(ui);
    renderStatus(ui);
    const title = X().fullPath && !Win.FS.roots[ui.tab.loc] ? locPath(ui.tab.loc) : tabLabel(ui.tab);
    if (title !== ui.title) { ui.title = title; ui.win.setTitle(title); }
  }

  const tabLabel = tab => (tab.search ? `Search Results in ${locName(tab.loc)}` : locName(tab.loc) || 'File Explorer');

  function renderTabs(ui) {
    ui.el.strip.innerHTML = ui.tabs.map(t => {
      const on = t === ui.tab;
      return `<div class="ft-tab ${on ? 'on' : ''}" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-tab="${t.id}" title="${esc(tabLabel(t))}">
        <span class="ft-ico">${t.search ? g('search', 14) : locIcon(t.loc, 16)}</span><span class="ft-name">${esc(tabLabel(t))}</span>
        <button class="ft-x" data-close="${t.id}" aria-label="Close tab" title="Close tab (Ctrl+W)" tabindex="-1">${g('close', 12)}</button></div>`;
    }).join('');
  }

  /* ----------------------------------------------------------- address row */

  function crumbsFor(loc) {
    if (Win.FS.roots[loc]) return [{ loc, label: Win.FS.roots[loc] }];
    const rev = [];
    let id;
    if (isZip(loc)) {
      const { id: zid, sub } = zipParts(loc);
      const parts = sub ? sub.split('/') : [];
      for (let i = parts.length; i > 0; i -= 1) rev.push({ loc: `zip:${zid}|${parts.slice(0, i).join('/')}`, label: parts[i - 1] });
      rev.push({ loc: `zip:${zid}`, label: Win.FS.display(Win.FS.get(zid)) });
      id = Win.FS.get(zid)?.parent;
    } else {
      id = folderOf(loc);
    }
    let guard = 0;
    while (id && guard++ < 64) {
      const n = Win.FS.get(id);
      if (!n) break;
      if (n.kind === 'drive') { rev.push({ loc: n.id, label: Win.FS.display(n) }, { loc: 'pc', label: 'This PC' }); break; }
      if (n.id === 'onedrive') { rev.push({ loc: 'onedrive', label: 'OneDrive - Personal' }); break; }
      rev.push({ loc: locOf(n.id), label: n.name });
      if (KNOWN_ART[n.known]) break;
      id = n.parent;
    }
    return rev.reverse();
  }

  const subfolders = loc => {
    if (loc === 'pc') return Win.FS.children('pc');
    if (isZip(loc)) return zipItems(loc).filter(n => n.kind === 'folder');
    const folder = writableFolder(loc);
    return folder ? sortList(Win.FS.children(folder).filter(isFolderish), { key: 'name', dir: 1 }) : [];
  };

  function renderAddress(ui) {
    const tab = ui.tab;
    const $ = act => ui.el.root.querySelector(`[data-act="${act}"]`);
    $('back').disabled = !tab.back.length;
    $('forward').disabled = !tab.fwd.length;
    $('up').disabled = !parentLoc(tab.loc);
    ui.el.search.placeholder = `Search ${locName(tab.loc)}`;
    ui.el.searchX.classList.toggle('hidden', !ui.el.search.value);
    if (ui.editing) return;
    const crumbs = crumbsFor(tab.loc);
    if (tab.search) crumbs.push({ loc: '', label: `Search Results in ${locName(tab.loc)}` });
    ui.el.crumbs.innerHTML = `<span class="fx-cico">${locIcon(tab.loc, 16)}</span><button class="fx-chev" data-chev="__root" aria-label="Locations" tabindex="-1">${g('chevright', 12)}</button>${crumbs.map((c, i) => {
      const last = i === crumbs.length - 1;
      const chev = c.loc && (!last || subfolders(c.loc).length) ? `<button class="fx-chev" data-chev="${esc(c.loc)}" aria-label="Folders in ${esc(c.label)}" tabindex="-1">${g('chevright', 12)}</button>` : '';
      return `<button class="fx-crumb ${last ? 'last' : ''}" data-crumb="${esc(c.loc)}" tabindex="-1">${esc(c.label)}</button>${chev}`;
    }).join('')}`;
    // Keep the tail visible when the path is longer than the bar.
    const box = ui.el.crumbs;
    const items = Win.$$('.fx-crumb', box);
    let hidden = 0;
    while (box.scrollWidth > box.clientWidth + 1 && hidden < items.length - 1) {
      items[hidden].classList.add('hidden');
      items[hidden].nextElementSibling?.classList.add('hidden');
      hidden += 1;
    }
    if (hidden) {
      const root = box.querySelector('[data-chev="__root"]');
      root.dataset.chev = '__overflow';
      root.dataset.hidden = String(hidden);
      root.innerHTML = '<span class="fx-more">«</span>';
      root.setAttribute('aria-label', 'Show hidden path segments');
    }
  }

  function chevMenu(ui, button) {
    const key = button.dataset.chev;
    const r = button.getBoundingClientRect();
    let items;
    if (key === '__overflow') {
      items = crumbsFor(ui.tab.loc).slice(0, Number(button.dataset.hidden)).reverse().map(c => ({ label: c.label, icon: locIcon(c.loc, 16), action: () => navigate(ui, c.loc) }));
    } else if (key === '__root') {
      items = [
        ...['home', 'gallery'].map(loc => ({ label: locName(loc), icon: locIcon(loc, 16), action: () => navigate(ui, loc) })),
        Win.FS.get('onedrive') && { label: 'OneDrive - Personal', icon: Win.appIcon('onedrive', 16), action: () => navigate(ui, 'onedrive') },
        { divider: true },
        ...X().pinned.map(id => Win.FS.get(id)).filter(n => n && reachable(n)).map(n => ({ label: Win.FS.display(n), icon: iconFor(n, 16), action: () => navigate(ui, locOf(n.id)) })),
        { divider: true },
        ...['pc', 'network', 'bin'].map(loc => ({ label: locName(loc), icon: locIcon(loc, 16), action: () => navigate(ui, loc) })),
      ];
    } else {
      items = subfolders(key).map(n => ({ label: Win.FS.display(n), icon: iconFor(n, 16), action: () => navigate(ui, n.virtual ? n.zipLoc : locOf(n.id)) }));
      if (!items.length) items = [{ label: 'No subfolders', disabled: true }];
    }
    Win.menu(r.left, r.bottom + 2, items, { className: 'fx-chevmenu' });
  }

  function startEdit(ui) {
    if (ui.editing) { ui.el.pathIn.select(); return; }
    ui.editing = true;
    ui.el.crumbs.classList.add('hidden');
    ui.el.pathIn.classList.remove('hidden');
    ui.el.bar.classList.add('editing');
    ui.el.pathIn.value = locPath(ui.tab.loc);
    ui.el.pathIn.focus();
    ui.el.pathIn.select();
  }

  function endEdit(ui) {
    if (!ui.editing) return;
    ui.editing = false;
    ui.el.crumbs.classList.remove('hidden');
    ui.el.pathIn.classList.add('hidden');
    ui.el.bar.classList.remove('editing');
    renderAddress(ui);
  }

  function goTyped(ui, value) {
    const result = resolveInput(value, ui.tab.loc);
    if (result?.loc) { endEdit(ui); navigate(ui, result.loc); return; }
    if (result?.file) {
      endEdit(ui);
      const node = Win.FS.get(result.file);
      if (node.ext === 'zip') navigate(ui, `zip:${node.id}`); else Win.openFile(node.id);
      return;
    }
    Win.alert('File Explorer', `Windows can't find '${value.trim()}'. Check the spelling and try again.`, ui.win)
      .then(() => { if (ui.editing) { ui.el.pathIn.focus(); ui.el.pathIn.select(); } });
  }

  /* ------------------------------------------------------------- command bar */

  const selNodes = ui => [...ui.tab.sel].map(id => ui.map.get(id) || Win.FS.get(id)).filter(Boolean);

  function renderCmd(ui) {
    const tab = ui.tab;
    const loc = tab.loc;
    const sel = selNodes(ui);
    const real = sel.filter(n => !n.virtual);
    const folder = writableFolder(loc);
    const locked = real.some(n => n.system || n.kind === 'drive');
    const focusAct = ui.el.cmd.contains(document.activeElement) ? document.activeElement.dataset.act : null;
    const btn = (act, glyph, label, { text = false, disabled = false, drop = false, title = label, on = false } = {}) =>
      `<button class="fx-cb ${text ? 'txt' : ''} ${on ? 'on' : ''}" data-act="${act}" ${disabled ? 'disabled' : ''} aria-label="${esc(label)}" title="${esc(title)}" ${drop ? 'aria-haspopup="menu"' : ''}>${g(glyph, 16)}${text ? `<span class="lbl">${esc(label)}</span>` : ''}${drop ? `<span class="dd">${g('chevdown', 12)}</span>` : ''}</button>`;
    const sep = '<span class="fx-csep"></span>';
    const editing = [
      btn('cut', 'cut', 'Cut', { disabled: !real.length || locked, title: 'Cut (Ctrl+X)' }),
      btn('copy', 'copy', 'Copy', { disabled: !real.length, title: 'Copy (Ctrl+C)' }),
      btn('paste', 'paste', 'Paste', { disabled: !canPaste(folder) || loc === 'bin', title: 'Paste (Ctrl+V)' }),
      btn('rename', 'rename', 'Rename', { disabled: real.length !== 1 || locked || loc === 'bin', title: 'Rename (F2)' }),
      btn('share', 'share', 'Share', { disabled: !real.length || real.some(isFolderish) || loc === 'bin' }),
      btn('delete', 'trash', 'Delete', { disabled: !real.length || locked, title: 'Delete (Delete)' }),
    ].join('');
    let left;
    if (loc === 'bin' && !tab.search) {
      const count = Win.FS.children('bin', { hidden: true }).length;
      left = btn('emptybin', 'trash', 'Empty Recycle Bin', { text: true, disabled: !count })
        + btn('restoreall', 'undo', 'Restore all items', { text: true, disabled: !count })
        + btn('restoresel', 'undo', 'Restore the selected items', { text: true, disabled: !real.length }) + sep + editing;
    } else {
      left = btn('new', 'plus', 'New', { text: true, drop: true, disabled: !folder }) + sep + editing;
    }
    const zipSel = real.length === 1 && real[0].ext === 'zip' ? real[0] : null;
    if (isZip(loc) || zipSel) left += sep + btn('extract', 'folder', 'Extract all', { text: true });
    const drive = real.length === 1 && real[0].kind === 'drive' ? real[0] : (nodeAt(loc)?.kind === 'drive' ? nodeAt(loc) : null);
    if (drive?.removable) left += sep + btn('eject', 'up', 'Eject', { text: true });
    left += sep + btn('sort', 'sort', 'Sort', { text: true, drop: true })
      + btn('view', 'view', 'View', { text: true, drop: true })
      + btn('filter', 'filter', 'Filter', { text: true, drop: true, on: !!tab.filter })
      + sep + btn('more', 'more', 'See more');
    const right = btn('pane', 'details', 'Details', { text: true, on: X().pane === 'details', title: 'Show the details pane (Alt+Shift+P)' });
    ui.el.cmd.innerHTML = `<div class="fx-cl">${left}</div><div class="fx-cr">${right}</div>`;
    if (focusAct) ui.el.cmd.querySelector(`[data-act="${focusAct}"]`)?.focus();
  }

  /* --------------------------------------------------------- navigation pane */

  function renderNav(ui) {
    const nav = ui.el.nav;
    const show = !!X().navPane;
    nav.classList.toggle('hidden', !show);
    ui.el.split.classList.toggle('hidden', !show);
    if (!show) return;
    nav.style.width = `${X().navWidth || 220}px`;
    const cur = ui.tab.loc;
    let marked = false;
    const rows = [];
    const row = (key, loc, label, icon, depth, { expandable = false, open = false, pin = false } = {}) => {
      const isCur = !marked && loc === cur;
      if (isCur) marked = true;
      rows.push(`<div class="fx-ni ${isCur ? 'cur' : ''}" role="treeitem" tabindex="${isCur ? 0 : -1}" data-loc="${esc(loc)}" data-key="${esc(key)}" style="--d:${depth}" ${expandable ? `aria-expanded="${open}"` : ''} aria-selected="${isCur}">
        <span class="fx-tw ${expandable ? '' : 'none'} ${open ? 'open' : ''}" data-twist="${esc(key)}" aria-hidden="true">${g('chevright', 12)}</span>
        <span class="fx-nico">${icon}</span><span class="fx-nl">${esc(label)}</span>${pin ? `<span class="fx-npin" aria-label="Pinned">${g('pin', 12)}</span>` : ''}</div>`);
    };
    const folderKids = id => (id === 'pc' ? Win.FS.children('pc') : sortList(Win.FS.children(id).filter(isFolderish), { key: 'name', dir: 1 }));
    const tree = (key, id, label, icon, depth, extra = {}) => {
      const open = ui.expanded.has(key);
      const kids = folderKids(id);
      const node = Win.FS.get(id);
      row(key, id === 'pc' ? 'pc' : locOf(id), label, icon, depth, { expandable: kids.length > 0 || node?.kind === 'drive', open, ...extra });
      if (open) kids.forEach(k => tree(`${key}/${k.id}`, k.id, Win.FS.display(k), iconFor(k, 16), depth + 1));
    };
    row('home', 'home', 'Home', locIcon('home'), 0);
    row('gallery', 'gallery', 'Gallery', locIcon('gallery'), 0);
    if (Win.FS.get('onedrive')) tree('od', 'onedrive', 'OneDrive - Personal', Win.appIcon('onedrive', 16), 0);
    rows.push('<div class="fx-nsep" role="separator"></div>');
    X().pinned.map(id => Win.FS.get(id)).filter(n => n && reachable(n) && isFolderish(n))
      .forEach(n => tree(`pin:${n.id}`, n.id, Win.FS.display(n), iconFor(n, 16), 0, { pin: true }));
    rows.push('<div class="fx-nsep" role="separator"></div>');
    tree('pc', 'pc', 'This PC', locIcon('pc'), 0);
    row('network', 'network', 'Network', locIcon('network'), 0);
    const scroll = nav.scrollTop;
    nav.innerHTML = rows.join('');
    nav.scrollTop = scroll;
  }

  /* ------------------------------------------------------------- the content */

  function listItems(ui) {
    const tab = ui.tab;
    const loc = tab.loc;
    let items;
    if (tab.search) items = searchItems(loc, tab.search);
    else if (loc === 'bin') items = Win.FS.children('bin');
    else if (isZip(loc)) items = zipItems(loc);
    else if (writableFolder(loc)) items = Win.FS.children(writableFolder(loc));
    else items = [];
    const filter = FILTERS.find(f => f.id === tab.filter);
    if (filter) items = items.filter(filter.test);
    return sortList(items, sortFor(tab.search ? `search:${loc}` : loc));
  }

  function searchItems(loc, query) {
    const q = query.toLowerCase();
    let pool;
    if (loc === 'bin') pool = Win.FS.children('bin');
    else if (loc === 'gallery') pool = galleryImages();
    else if (isZip(loc)) pool = zipItems(loc);
    else if (loc === 'pc' || loc === 'network') pool = Win.FS.children('pc').flatMap(d => Win.FS.descendants(d.id));
    else if (loc === 'home') pool = Win.FS.descendants('home');
    else pool = Win.FS.descendants(writableFolder(loc));
    return pool.filter(n => (n.virtual || (reachable(n) && visible(n))) && Win.FS.display(n).toLowerCase().includes(q)).slice(0, 500);
  }

  function itemAttrs(ui, n, extra = '') {
    const tab = ui.tab;
    const on = tab.sel.has(n.id);
    const cls = Win.cls('fx-item', extra, on && 'sel', isCut(n.id) && 'cut', n.hidden && 'hid', tab.focus === n.id && 'focus', ui.pendingDrop === n.id && 'drop');
    const tip = [`Type: ${typeOf(n)}`, n.kind === 'file' ? `Size: ${human(sizeOf(n))}` : '', n.kind !== 'drive' ? `Date modified: ${Win.formatDateTime(mtime(n))}` : ''].filter(Boolean).join('\n');
    return `class="${cls}" role="option" aria-selected="${on}" data-id="${esc(n.id)}" draggable="${n.virtual || n.kind === 'drive' ? 'false' : 'true'}" title="${esc(tip)}"`;
  }

  const nameSpan = n => `<span class="fx-name">${esc(Win.FS.display(n))}</span>`;

  function itemHTML(ui, n, view, cols) {
    const a = itemAttrs(ui, n, `v-${view}`);
    switch (view) {
      case 'details':
        return `<div ${a}>${cols.map(c => (c === 'name'
          ? `<span class="fx-c fx-cn">${iconFor(n, 16)}${nameSpan(n)}</span>`
          : `<span class="fx-c ${COLS[c].right ? 'r' : ''}">${esc(COLS[c].text(n))}</span>`)).join('')}</div>`;
      case 'list':
      case 'sm':
        return `<div ${a}>${iconFor(n, 16)}${nameSpan(n)}</div>`;
      case 'tiles':
        return `<div ${a}><span class="fx-ib">${thumb(n, 48)}</span><span class="fx-meta">${nameSpan(n)}<span class="fx-sub">${esc(typeOf(n))}</span>${n.kind === 'file' ? `<span class="fx-sub">${esc(human(sizeOf(n)))}</span>` : ''}</span></div>`;
      case 'content':
        return `<div ${a}><span class="fx-ib">${thumb(n, 48)}</span><span class="fx-meta">${nameSpan(n)}<span class="fx-sub">${esc(typeOf(n))}</span></span><span class="fx-meta fx-mr"><span class="fx-sub">Date modified: ${esc(Win.formatDateTime(mtime(n)))}</span>${n.kind === 'file' ? `<span class="fx-sub">Size: ${esc(human(sizeOf(n)))}</span>` : ''}</span></div>`;
      default: {
        const size = { xl: 256, lg: 96, md: 48 }[view] || 96;
        return `<div ${a}><span class="fx-ib" style="height:${size}px">${thumb(n, size)}</span>${nameSpan(n)}</div>`;
      }
    }
  }

  function headerHTML(ui, cols, sortKey) {
    const s = sortFor(sortKey);
    return `<div class="fx-head" role="row">${cols.map(c => `<div class="fx-hc"><button class="fx-h ${COLS[c].right ? 'r' : ''}" data-sortcol="${c}" role="columnheader" aria-sort="${s.key === c ? (s.dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(COLS[c].label)}${s.key === c ? `<span class="fx-sorted">${g(s.dir > 0 ? 'chevup' : 'chevdown', 10)}</span>` : ''}</button><span class="fx-grip" data-grip="${c}"></span></div>`).join('')}</div>`;
  }

  function folderHTML(ui, items) {
    const tab = ui.tab;
    const loc = tab.loc;
    const view = tab.search ? 'details' : viewFor(loc);
    const cols = colsFor(ui);
    const sortKey = tab.search ? `search:${loc}` : loc;
    const empty = `<div class="fx-empty">${tab.search ? 'No items match your search.' : tab.filter ? 'No items match the current filter.' : 'This folder is empty.'}</div>`;
    if (view === 'details') {
      return `<div class="fx-details" style="--cols:${colTemplate(cols)}">${headerHTML(ui, cols, sortKey)}<div class="fx-items" role="listbox" aria-multiselectable="true" aria-label="Items">${items.map(n => itemHTML(ui, n, view, cols)).join('')}</div>${items.length ? '' : empty}</div>`;
    }
    if (!items.length) return empty;
    return `<div class="fx-items fx-${view}" role="listbox" aria-multiselectable="true" aria-label="Items">${items.map(n => itemHTML(ui, n, view, cols)).join('')}</div>`;
  }

  function colsFor(ui) {
    const tab = ui.tab;
    if (tab.search) return ['name', 'folder', 'modified', 'type', 'size'];
    if (tab.loc === 'bin') return ['name', 'from', 'deleted', 'size', 'type'];
    return ['name', 'modified', 'type', 'size'];
  }

  function section(ui, key, title, inner) {
    const closed = ui.collapsed.has(key);
    return `<section class="fx-sec ${closed ? 'closed' : ''}"><button class="fx-sech" data-sec="${key}" aria-expanded="${!closed}">${g('chevdown', 12)}<span>${esc(title)}</span></button><div class="fx-secb">${inner}</div></section>`;
  }

  function homeHTML(ui, reg) {
    const pinned = reg(X().pinned.map(id => Win.FS.get(id)).filter(n => n && reachable(n) && isFolderish(n)));
    const favs = reg(X().favorites.map(id => Win.FS.get(id)).filter(n => n && reachable(n) && visible(n)));
    const recent = X().showRecent ? reg(Win.state.recent.map(id => Win.FS.get(id)).filter(n => n && n.kind === 'file' && reachable(n) && visible(n))) : [];
    const sub = n => (n.id === 'onedrive' || Win.FS.contains('onedrive', n.id) ? 'OneDrive - Personal' : Win.FS.onRemovable(n.id) ? Win.FS.display(Win.FS.driveOf(n.id)) : 'Stored locally');
    const qa = `<div class="fx-items fx-qa" role="listbox" aria-label="Quick access">${pinned.map(n => `<div ${itemAttrs(ui, n, 'fx-qtile')}><span class="fx-ib">${iconFor(n, 48)}</span><span class="fx-meta">${nameSpan(n)}<span class="fx-sub">${esc(sub(n))}</span></span><span class="fx-qpin">${g('pin', 12)}</span></div>`).join('')}</div>`;
    const cols = ['name', 'modified', 'location'];
    const table = (list, emptyText) => (list.length
      ? `<div class="fx-details fx-hlist"><div class="fx-head" role="row">${cols.map(c => `<div class="fx-hc"><span class="fx-h static">${esc(COLS[c].label)}</span></div>`).join('')}</div><div class="fx-items" role="listbox">${list.map(n => itemHTML(ui, n, 'details', cols)).join('')}</div></div>`
      : `<p class="fx-note">${emptyText}</p>`);
    return `<div class="fx-home">
      ${section(ui, 'qa', 'Quick access', qa)}
      ${section(ui, 'fav', 'Favorites', table(favs, "After you've favorited some files, we'll show them here."))}
      ${section(ui, 'recent', 'Recent', table(recent, X().showRecent ? "After you've opened some files, we'll show the most recent ones here." : 'Recent files are turned off in Folder Options.'))}
    </div>`;
  }

  function pcHTML(ui, reg) {
    const drives = reg(Win.FS.children('pc'));
    return `<div class="fx-pc">${section(ui, 'drives', 'Devices and drives', `<div class="fx-items fx-drives" role="listbox" aria-label="Devices and drives">${drives.map(d => {
      const used = Win.FS.used(d.id);
      const cap = d.capacity || used;
      const pct = Math.min(100, (used / cap) * 100);
      return `<div ${itemAttrs(ui, d, 'fx-drive')}><span class="fx-ib">${Win.appIcon(d.icon || 'drive', 48)}</span><span class="fx-meta">${nameSpan(d)}<span class="fx-meter ${pct > 90 ? 'full' : ''}"><i style="width:${pct.toFixed(1)}%"></i></span><span class="fx-sub">${esc(Win.bytes(cap - used))} free of ${esc(Win.bytes(cap))}</span></span></div>`;
    }).join('')}</div>`)}</div>`;
  }

  function galleryHTML(ui, reg) {
    const images = reg(galleryImages());
    if (!images.length) return '<div class="fx-empty">Add photos to your Pictures folder to see them here.</div>';
    const groups = new Map();
    images.forEach(n => {
      const label = new Date(mtime(n)).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(n);
    });
    return `<div class="fx-gallery">${[...groups].map(([label, list]) => `<h3 class="fx-gh">${esc(label)}</h3><div class="fx-items fx-gal" role="listbox" aria-label="${esc(label)}">${list.map(n => `<div ${itemAttrs(ui, n, 'fx-gi')}><img src="${esc(Win.imageURL ? Win.imageURL(n) : '')}" alt="${esc(Win.FS.display(n))}" draggable="false" decoding="async" ${n.rotation ? `style="transform:rotate(${Number(n.rotation) || 0}deg)"` : ''}></div>`).join('')}</div>`).join('')}</div>`;
  }

  function networkHTML() {
    if (!X().netDiscovery) {
      return `<div class="fx-net"><div class="infobar warning">${g('warning')}<div><strong>Network discovery is turned off.</strong> Network computers and devices are not visible. <button class="link" data-act="netdisc">Turn on network discovery and file sharing</button></div></div></div>`;
    }
    const tile = (icon, name, sub, act) => `<button class="fx-ntile" data-act="${act}">${Win.appIcon(icon, 48)}<span class="fx-meta"><span class="fx-name">${esc(name)}</span><span class="fx-sub">${esc(sub)}</span></span></button>`;
    return `<div class="fx-net">
      <h3 class="fx-gh">Computer (1)</h3><div class="fx-ntiles">${tile('thispc', Win.PERSONA.computer, 'This PC', 'net-pc')}</div>
      <h3 class="fx-gh">Printers (1)</h3><div class="fx-ntiles">${tile('drive', 'HP OfficeJet Pro 8025e', 'Network printer', 'net-printer')}</div>
    </div>`;
  }

  function renderContent(ui) {
    const tab = ui.tab;
    const view = ui.el.view;
    const key = `${tab.loc}|${tab.search}|${tab.filter}`;
    const fresh = ui.rendered !== key;
    const scroll = fresh ? tab.scroll || 0 : view.scrollTop;
    ui.map = new Map();
    ui.order = [];
    const reg = list => {
      list.forEach(n => { if (!ui.map.has(n.id)) { ui.map.set(n.id, n); ui.order.push(n.id); } });
      return list;
    };
    let html;
    let mode = 'folder';
    if (!tab.search && tab.loc === 'home') { html = homeHTML(ui, reg); mode = 'home'; } else if (!tab.search && tab.loc === 'pc') { html = pcHTML(ui, reg); mode = 'pc'; } else if (!tab.search && tab.loc === 'gallery') { html = galleryHTML(ui, reg); mode = 'gallery'; } else if (!tab.search && tab.loc === 'network') { html = networkHTML(); mode = 'network'; } else html = folderHTML(ui, reg(listItems(ui)));
    for (const id of [...tab.sel]) if (!ui.map.has(id)) tab.sel.delete(id);
    if (tab.focus && !ui.map.has(tab.focus)) tab.focus = null;
    view.dataset.mode = mode;
    view.dataset.view = mode === 'folder' ? (tab.search ? 'details' : viewFor(tab.loc)) : mode;
    view.innerHTML = html;
    view.scrollTop = scroll;
    ui.rendered = key;
    if (fresh && tab.focus) view.querySelector(`.fx-item[data-id="${cssEsc(tab.focus)}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }

  const cssEsc = value => (window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&'));

  function paintSelection(ui, { light = false } = {}) {
    const tab = ui.tab;
    for (const el of ui.el.view.querySelectorAll('.fx-item')) {
      const on = tab.sel.has(el.dataset.id);
      el.classList.toggle('sel', on);
      el.setAttribute('aria-selected', String(on));
      el.classList.toggle('focus', el.dataset.id === tab.focus);
    }
    renderStatus(ui);
    if (light) return;
    renderCmd(ui);
    renderSide(ui);
  }

  /* ------------------------------------------------------- details / preview */

  function renderSide(ui) {
    const pane = X().pane;
    const side = ui.el.side;
    side.classList.toggle('hidden', !pane);
    if (!pane) return;
    const sel = selNodes(ui);
    const one = sel.length === 1 ? sel[0] : null;
    if (pane === 'preview') {
      let inner = '<p class="fx-sidenote">Select a file to preview.</p>';
      if (one && isImage(one) && Win.imageURL?.(one)) inner = `<div class="fx-pv"><img src="${esc(Win.imageURL(one))}" alt="${esc(Win.FS.display(one))}" ${one.rotation ? `style="transform:rotate(${Number(one.rotation) || 0}deg)"` : ''}></div>`;
      else if (one && one.kind === 'file' && one.content != null) inner = `<pre class="fx-pvtext">${esc(String(one.content).slice(0, 6000))}</pre>`;
      else if (one && one.kind === 'file') inner = '<p class="fx-sidenote">No preview available.</p>';
      else if (sel.length > 1) inner = `<p class="fx-sidenote">${sel.length} items selected</p>`;
      side.innerHTML = inner;
      return;
    }
    const prop = (k, v) => (v ? `<div class="fx-dprop"><span>${esc(k)}</span><span>${esc(v)}</span></div>` : '');
    if (one) {
      side.innerHTML = `<div class="fx-dhero">${isImage(one) ? thumb(one, 160) : iconFor(one, 96)}</div>
        <div class="fx-dname">${esc(Win.FS.display(one))}</div><div class="fx-dtype">${esc(typeOf(one))}</div>
        <h4>Details</h4>
        ${one.kind === 'drive' ? prop('Free space', Win.bytes((one.capacity || 0) - Win.FS.used(one.id))) + prop('Total size', Win.bytes(one.capacity || 0)) : ''}
        ${one.kind === 'file' ? prop('Size', human(sizeOf(one))) : ''}
        ${one.kind !== 'drive' ? prop('Date modified', Win.formatDateTime(mtime(one))) + prop('Date created', Win.formatDateTime(one.created ?? mtime(one))) : ''}
        ${one.virtual ? prop('Location', locPath(ui.tab.loc)) : one.parent === 'bin' ? prop('Original location', origin(one)) : one.kind !== 'drive' ? prop('Location', pathOf(one.parent)) : ''}
        ${one.readonly ? prop('Attributes', 'Read-only') : ''}`;
    } else if (sel.length > 1) {
      const files = sel.filter(n => n.kind === 'file');
      side.innerHTML = `<div class="fx-dhero stack">${iconFor(sel[0], 96)}</div><div class="fx-dname">${sel.length} items selected</div>
        <h4>Details</h4>${files.length === sel.length ? prop('Total size', human(files.reduce((s, n) => s + sizeOf(n), 0))) : ''}`;
    } else {
      side.innerHTML = `<div class="fx-dhero">${locIcon(ui.tab.loc, 96)}</div><div class="fx-dname">${esc(tabLabel(ui.tab))}</div>
        <div class="fx-dtype">${ui.order.length} item${ui.order.length === 1 ? '' : 's'}</div>
        <p class="fx-sidenote">Select a single file to get more information and share your cloud content.</p>`;
    }
  }

  function renderStatus(ui) {
    const sel = selNodes(ui);
    const total = ui.order.length;
    const files = sel.filter(n => n.kind === 'file');
    const size = files.length && files.length === sel.length ? `\u2002${human(files.reduce((s, n) => s + sizeOf(n), 0))}` : '';
    const view = ui.tab.search ? 'details' : viewFor(ui.tab.loc);
    const folderView = !['home', 'pc', 'gallery', 'network'].includes(ui.tab.loc) || ui.tab.search;
    ui.el.status.innerHTML = `<div class="fx-st"><span>${total} item${total === 1 ? '' : 's'}</span>${sel.length ? `<span class="fx-stsep"></span><span>${sel.length} item${sel.length === 1 ? '' : 's'} selected${size}</span>` : ''}</div>
      <div class="fx-sv">
        <button class="fx-svb ${folderView && view === 'details' ? 'on' : ''}" data-act="view-details" aria-label="Details view" title="Displays information about each item in the window.">${g('list', 14)}</button>
        <button class="fx-svb ${folderView && view === 'lg' ? 'on' : ''}" data-act="view-lg" aria-label="Large icons view" title="Display items by using large thumbnails.">${g('view', 14)}</button>
      </div>`;
  }

  /* ---------------------------------------------------------------- actions */

  const menuAt = (el, items) => { const r = el.getBoundingClientRect(); Win.menu(r.left, r.bottom + 4, items); };

  function setView(ui, view) {
    X().views[ui.tab.loc] = view;
    ui.rendered = null;
    Win.save();
    renderAll(ui);
  }

  function setSort(ui, key, dir) {
    const sortKey = ui.tab.search ? `search:${ui.tab.loc}` : ui.tab.loc;
    X().sorts[sortKey] = { key, dir };
    Win.save();
    renderAll(ui);
  }

  function setPane(pane) {
    X().pane = X().pane === pane ? '' : pane;
    Win.save();
  }

  function toggleSetting(key) {
    S()[key] = !S()[key];
    Win.save('fs');
  }

  function newMenu(ui) {
    const folder = writableFolder(ui.tab.loc);
    return [
      { label: 'Folder', icon: Win.appIcon('folder', 16), shortcut: 'Ctrl+Shift+N', action: () => createAndRename(ui, Explorer.newFolder(folder)) },
      { divider: true },
      { label: 'Compressed (zipped) Folder', icon: Win.appIcon('zip', 16), action: () => createAndRename(ui, Explorer.newZip(folder)) },
      { label: 'Text Document', icon: Win.appIcon('txt', 16), action: () => createAndRename(ui, Explorer.newTextDocument(folder)) },
    ];
  }

  function createAndRename(ui, node) {
    if (!node) return;
    ui.tab.sel = new Set([node.id]);
    ui.tab.anchor = ui.tab.focus = node.id;
    ui.rendered = null;
    renderAll(ui);
    beginRename(ui, node.id);
  }

  function sortMenu(ui) {
    const s = sortFor(ui.tab.search ? `search:${ui.tab.loc}` : ui.tab.loc);
    return [
      ...colsFor(ui).map(k => ({ label: COLS[k].label, checked: s.key === k, radio: true, action: () => setSort(ui, k, s.dir) })),
      { divider: true },
      { label: 'Ascending', checked: s.dir === 1, radio: true, action: () => setSort(ui, s.key, 1) },
      { label: 'Descending', checked: s.dir === -1, radio: true, action: () => setSort(ui, s.key, -1) },
    ];
  }

  function viewMenu(ui) {
    const cur = viewFor(ui.tab.loc);
    return [
      ...VIEWS.map((v, i) => ({ label: v.label, glyph: v.glyph, checked: cur === v.id, shortcut: `Ctrl+Shift+${i + 1}`, action: () => setView(ui, v.id) })),
      { divider: true },
      { label: 'Compact view', glyph: 'list', checked: !!X().compact, action: () => { X().compact = !X().compact; Win.save(); } },
      {
        label: 'Show', glyph: 'eye', submenu: [
          { label: 'Navigation pane', checked: !!X().navPane, action: () => { X().navPane = !X().navPane; Win.save(); } },
          { label: 'Details pane', checked: X().pane === 'details', shortcut: 'Alt+Shift+P', action: () => setPane('details') },
          { label: 'Preview pane', checked: X().pane === 'preview', shortcut: 'Alt+P', action: () => setPane('preview') },
          { divider: true },
          { label: 'File name extensions', checked: !!S().fileExtensions, action: () => toggleSetting('fileExtensions') },
          { label: 'Hidden items', checked: !!S().hiddenFiles, action: () => toggleSetting('hiddenFiles') },
        ],
      },
    ];
  }

  function filterMenu(ui) {
    const tab = ui.tab;
    const set = id => { tab.filter = tab.filter === id ? '' : id; ui.rendered = null; renderAll(ui); };
    return [
      ...FILTERS.map(f => ({ label: f.label, checked: tab.filter === f.id, action: () => set(f.id) })),
      { divider: true },
      { label: 'Clear filter', glyph: 'close', disabled: !tab.filter, action: () => set('') },
    ];
  }

  function moreMenu(ui) {
    return [
      { label: 'Select all', glyph: 'check', shortcut: 'Ctrl+A', action: () => selectAll(ui) },
      { label: 'Select none', glyph: 'close', action: () => { ui.tab.sel.clear(); paintSelection(ui); } },
      { label: 'Invert selection', glyph: 'refresh', action: () => { ui.tab.sel = new Set(ui.order.filter(id => !ui.tab.sel.has(id))); paintSelection(ui); } },
      { divider: true },
      { label: 'Copy as path', glyph: 'copy', shortcut: 'Ctrl+Shift+C', disabled: !selNodes(ui).some(n => !n.virtual), action: () => Explorer.copyAsPath(selNodes(ui).filter(n => !n.virtual).map(n => n.id)) },
      { label: 'Properties', glyph: 'info', shortcut: 'Alt+Enter', action: () => propsForSelection(ui) },
      { label: 'Options', glyph: 'gear', action: () => folderOptions(ui.win) },
    ];
  }

  function selectAll(ui) {
    ui.tab.sel = new Set(ui.order);
    paintSelection(ui);
  }

  function propsForSelection(ui) {
    const sel = selNodes(ui).filter(n => !n.virtual);
    if (sel.length) { properties(sel.map(n => n.id), ui.win); return; }
    const loc = ui.tab.loc;
    if (loc === 'pc') { if (Win.apps.get('settings')) Win.wm.open('settings', { page: 'about' }); return; }
    const folder = writableFolder(loc);
    if (folder) properties([folder], ui.win);
  }

  async function deleteSelection(ui, permanent = false) {
    const ids = selNodes(ui).filter(n => !n.virtual).map(n => n.id);
    if (!ids.length) return;
    const order = ui.order;
    const last = order.indexOf(ids[ids.length - 1]);
    const n = await Explorer.remove(ids, { permanent, owner: ui.win });
    if (n) {
      // Keep focus moving through the list, as Explorer does.
      const next = order.slice(last + 1).find(id => !ids.includes(id)) || order.slice(0, last).reverse().find(id => !ids.includes(id));
      ui.tab.sel = new Set(next ? [next] : []);
      ui.tab.anchor = ui.tab.focus = next || null;
    }
  }

  function doPaste(ui) {
    const folder = writableFolder(ui.tab.loc);
    if (!canPaste(folder)) return;
    const ids = Explorer.paste(folder);
    if (ids.length) { ui.tab.sel = new Set(ids); ui.tab.anchor = ui.tab.focus = ids[ids.length - 1]; }
  }

  function openNodes(ui, nodes, where = 'here') {
    const folders = nodes.filter(isFolderish);
    const files = nodes.filter(n => !isFolderish(n));
    const locFor = n => (n.virtual ? n.zipLoc : locOf(n.id));
    if (ui.tab.loc === 'bin') { properties(nodes.map(n => n.id), ui.win); return; }
    if (where === 'here' && folders.length === 1 && nodes.length === 1) navigate(ui, locFor(folders[0]));
    else folders.forEach(n => (where === 'window' ? Win.wm.open('explorer', { path: locFor(n) }) : openTab(ui, locFor(n), { background: where !== 'tab-front', after: true })));
    files.forEach(f => {
      if (f.virtual) { askExtract(ui, f.parent); return; }
      if (f.ext === 'zip' && nodes.length === 1 && where === 'here') { Win.FS.touch(f.id); navigate(ui, `zip:${f.id}`); return; }
      Win.openFile(f.id);
    });
  }

  function askExtract(ui, zipId) {
    Win.dialog({
      title: 'Compressed (zipped) Folders', owner: ui.win,
      body: '<p>To open files that are in a compressed folder, extract them first.</p>',
      buttons: [{ label: 'Extract all', primary: true, value: true }, { label: 'Cancel', value: false }],
    }).then(ok => ok && extractInto(ui, zipId));
  }

  function extractInto(ui, zipId) {
    return Explorer.extractAll(zipId, { owner: ui.win }).then(folder => folder);
  }

  function runAct(ui, act, el) {
    const tab = ui.tab;
    const sel = selNodes(ui).filter(n => !n.virtual);
    switch (act) {
      case 'newtab': openTab(ui, normalizeLoc(X().openTo)?.loc || 'home'); break;
      case 'back': goBack(ui); break;
      case 'forward': goForward(ui); break;
      case 'up': goUp(ui); break;
      case 'refresh': ui.el.view.classList.add('fx-flash'); setTimeout(() => ui.el.view.classList.remove('fx-flash'), 120); schedule(ui); break;
      case 'new': menuAt(el, newMenu(ui)); break;
      case 'cut': if (sel.length) Explorer.setClipboard('cut', sel.map(n => n.id)); break;
      case 'copy': if (sel.length) Explorer.setClipboard('copy', sel.map(n => n.id)); break;
      case 'paste': doPaste(ui); break;
      case 'rename': if (sel.length === 1) beginRename(ui, sel[0].id); break;
      case 'share': share(sel.map(n => n.id), ui.win); break;
      case 'delete': deleteSelection(ui); break;
      case 'emptybin': Explorer.emptyBin(ui.win); break;
      case 'restoreall': Explorer.restore(Win.FS.children('bin', { hidden: true }).map(n => n.id)); break;
      case 'restoresel': Explorer.restore(sel.map(n => n.id)); break;
      case 'extract': {
        const zipId = isZip(tab.loc) ? zipParts(tab.loc).id : sel[0]?.id;
        if (zipId) extractInto(ui, zipId);
        break;
      }
      case 'eject': {
        const drive = sel[0]?.kind === 'drive' ? sel[0] : nodeAt(tab.loc);
        if (drive) Explorer.eject(drive.id);
        break;
      }
      case 'sort': menuAt(el, sortMenu(ui)); break;
      case 'view': menuAt(el, viewMenu(ui)); break;
      case 'filter': menuAt(el, filterMenu(ui)); break;
      case 'more': menuAt(el, moreMenu(ui)); break;
      case 'pane': setPane('details'); break;
      case 'view-details': setView(ui, 'details'); break;
      case 'view-lg': setView(ui, 'lg'); break;
      case 'netdisc': X().netDiscovery = true; Win.save(); break;
      case 'net-pc': navigate(ui, 'pc'); break;
      case 'net-printer': if (Win.apps.get('settings')) Win.wm.open('settings', { page: 'printers' }); break;
      default: break;
    }
  }

  /* ------------------------------------------------------------ context menus */

  function itemMenu(ui, x, y) {
    const sel = selNodes(ui);
    if (!sel.length) return;
    const one = sel.length === 1 ? sel[0] : null;
    const ids = sel.filter(n => !n.virtual).map(n => n.id);
    const locked = sel.some(n => n.system || n.kind === 'drive');
    const folders = sel.every(isFolderish);
    if (ui.tab.loc === 'bin') {
      Win.menu(x, y, [
        { label: 'Restore', glyph: 'undo', action: () => Explorer.restore(ids) },
        { divider: true },
        { label: 'Cut', glyph: 'cut', shortcut: 'Ctrl+X', action: () => Explorer.setClipboard('cut', ids) },
        { label: 'Delete', glyph: 'trash', shortcut: 'Delete', action: () => deleteSelection(ui) },
        { divider: true },
        { label: 'Properties', glyph: 'info', shortcut: 'Alt+Enter', action: () => properties(ids, ui.win) },
      ]);
      return;
    }
    if (sel.some(n => n.virtual)) {
      Win.menu(x, y, [
        { label: one && isFolderish(one) ? 'Open' : 'Open', glyph: 'open', action: () => openNodes(ui, sel) },
        { label: 'Extract All...', glyph: 'folder', action: () => extractInto(ui, sel[0].parent) },
      ]);
      return;
    }
    const quick = [
      { label: 'Cut', glyph: 'cut', disabled: locked, action: () => Explorer.setClipboard('cut', ids) },
      { label: 'Copy', glyph: 'copy', action: () => Explorer.setClipboard('copy', ids) },
      { label: 'Rename', glyph: 'rename', disabled: !one || one.system, action: () => beginRename(ui, one.id) },
      { label: 'Share', glyph: 'share', disabled: sel.some(isFolderish), action: () => share(ids, ui.win) },
      { label: 'Delete', glyph: 'trash', disabled: locked, action: () => deleteSelection(ui) },
    ];
    const withApps = one && !isFolderish(one) ? openWithApps(one) : [];
    const items = [
      { label: 'Open', glyph: 'open', shortcut: 'Enter', action: () => openNodes(ui, sel) },
      withApps.length && {
        label: 'Open with', glyph: 'apps', submenu: [
          ...withApps.map(app => ({ label: appName(app), icon: Win.appIcon(Win.apps.get(app).icon, 16), action: () => Win.openWith(one.id, app) })),
          { divider: true },
          { label: 'Choose another app', action: () => chooseApp(one) },
        ],
      },
      folders && { label: 'Open in new tab', glyph: 'tab', action: () => openNodes(ui, sel, 'tab') },
      folders && { label: 'Open in new window', glyph: 'open', action: () => openNodes(ui, sel, 'window') },
      one && one.kind === 'folder' && (Explorer.isPinned(one.id)
        ? { label: 'Unpin from Quick access', glyph: 'unpin', action: () => Explorer.unpin(one.id) }
        : { label: 'Pin to Quick access', glyph: 'pin', action: () => Explorer.pin(one.id) }),
      one && one.kind === 'file' && { label: Explorer.isFavorite(one.id) ? 'Remove from Favorites' : 'Add to Favorites', glyph: 'star', action: () => Explorer.toggleFavorite(one.id) },
      one && isImage(one) && { label: 'Set as desktop background', glyph: 'picture', action: () => { S().wallpaper = `file:${one.id}`; Win.save('theme'); } },
      one && isImage(one) && { label: 'Rotate right', glyph: 'rotate', action: () => { one.rotation = ((one.rotation || 0) + 90) % 360; Win.save('fs'); } },
      one?.kind === 'drive' && one.removable && { label: 'Eject', glyph: 'up', action: () => Explorer.eject(one.id) },
      one?.ext === 'zip' && { label: 'Extract All...', glyph: 'folder', action: () => extractInto(ui, one.id) },
      !sel.some(n => n.kind === 'drive') && { label: 'Compress to ZIP file', icon: Win.appIcon('zip', 16), action: () => { const z = Explorer.compress(ids); if (z && z.parent === writableFolder(ui.tab.loc)) createAndRename(ui, z); } },
      { label: 'Copy as path', glyph: 'copy', shortcut: 'Ctrl+Shift+C', action: () => Explorer.copyAsPath(ids) },
      one && isFolderish(one) && Win.apps.get('terminal') && { label: 'Open in Terminal', glyph: 'terminal', action: () => Win.wm.open('terminal', { cwd: one.id }) },
      { label: 'Properties', glyph: 'info', shortcut: 'Alt+Enter', action: () => properties(ids, ui.win) },
      { divider: true },
      { label: 'Show more options', glyph: 'more', action: () => classicMenu(ui, x, y, sel) },
    ].filter(Boolean);
    Win.menu(x, y, items, { quick });
  }

  function classicMenu(ui, x, y, sel) {
    const ids = sel.map(n => n.id);
    const locked = sel.some(n => n.system || n.kind === 'drive');
    const usb = Win.FS.children('pc').find(d => d.removable);
    Win.menu(x, y, [
      { label: 'Open', action: () => openNodes(ui, sel) },
      {
        label: 'Send to', submenu: [
          { label: 'Compressed (zipped) folder', icon: Win.appIcon('zip', 16), disabled: sel.some(n => n.kind === 'drive'), action: () => Explorer.compress(ids) },
          { label: 'Desktop', icon: knownIcon('desktop', 16), action: () => Explorer.transfer(ids, 'desktop', 'copy') },
          { label: 'Documents', icon: knownIcon('documents', 16), action: () => Explorer.transfer(ids, 'documents', 'copy') },
          usb && { label: Win.FS.display(usb), icon: Win.appIcon('usb', 16), action: () => Explorer.transfer(ids, usb.id, 'copy') },
        ].filter(Boolean),
      },
      { divider: true },
      { label: 'Cut', disabled: locked, action: () => Explorer.setClipboard('cut', ids) },
      { label: 'Copy', action: () => Explorer.setClipboard('copy', ids) },
      { divider: true },
      { label: 'Delete', disabled: locked, action: () => deleteSelection(ui) },
      { label: 'Rename', disabled: sel.length !== 1 || locked, action: () => beginRename(ui, ids[0]) },
      { divider: true },
      { label: 'Properties', action: () => properties(ids, ui.win) },
    ], { className: 'classic' });
  }

  function backgroundMenu(ui, x, y) {
    const loc = ui.tab.loc;
    const folder = writableFolder(loc);
    const items = [];
    if (!['home', 'network'].includes(loc) || ui.tab.search) {
      items.push({ label: 'View', glyph: 'view', submenu: viewMenu(ui).slice(0, 8) }, { label: 'Sort by', glyph: 'sort', submenu: sortMenu(ui) });
    }
    items.push({ label: 'Refresh', glyph: 'refresh', action: () => schedule(ui) });
    if (loc === 'bin') {
      items.push({ divider: true }, { label: 'Empty Recycle Bin', glyph: 'trash', disabled: !Win.FS.children('bin', { hidden: true }).length, action: () => Explorer.emptyBin(ui.win) });
    }
    if (folder) {
      items.push({ divider: true });
      if (canPaste(folder)) items.push({ label: 'Paste', glyph: 'paste', shortcut: 'Ctrl+V', action: () => doPaste(ui) });
      items.push({ label: 'New', glyph: 'plus', submenu: newMenu(ui) });
    }
    if (folder || loc === 'pc') {
      items.push({ divider: true }, { label: 'Properties', glyph: 'info', action: () => propsForSelection(ui) });
    }
    if (folder && Win.apps.get('terminal')) items.push({ label: 'Open in Terminal', glyph: 'terminal', action: () => Win.wm.open('terminal', { cwd: folder }) });
    Win.menu(x, y, items);
  }

  function navMenu(ui, row, x, y) {
    const loc = row.dataset.loc;
    const folder = writableFolder(loc);
    const key = row.dataset.key;
    const items = [
      { label: 'Open in new tab', glyph: 'tab', action: () => openTab(ui, loc) },
      { label: 'Open in new window', glyph: 'open', action: () => Win.wm.open('explorer', { path: loc }) },
    ];
    if (folder && Win.FS.get(folder)?.kind === 'folder') {
      items.push(Explorer.isPinned(folder)
        ? { label: 'Unpin from Quick access', glyph: 'unpin', action: () => Explorer.unpin(folder) }
        : { label: 'Pin to Quick access', glyph: 'pin', action: () => Explorer.pin(folder) });
    }
    const drive = folder && Win.FS.get(folder);
    if (drive?.kind === 'drive' && drive.removable) items.push({ label: 'Eject', glyph: 'up', action: () => Explorer.eject(drive.id) });
    if (folder && canPaste(folder)) items.push({ label: 'Paste', glyph: 'paste', action: () => Explorer.paste(folder) });
    if (key.startsWith('pin:') || key === 'pc' || ui.expanded.has(key)) {
      items.push({ label: ui.expanded.has(key) ? 'Collapse' : 'Expand', glyph: ui.expanded.has(key) ? 'chevup' : 'chevdown', action: () => toggleExpand(ui, key) });
    }
    if (folder) items.push({ divider: true }, { label: 'Properties', glyph: 'info', action: () => properties([folder], ui.win) });
    if (loc === 'pc') items.push({ divider: true }, { label: 'Properties', glyph: 'info', action: () => Win.apps.get('settings') && Win.wm.open('settings', { page: 'about' }) });
    Win.menu(x, y, items);
  }

  function toggleExpand(ui, key, force) {
    const open = force ?? !ui.expanded.has(key);
    if (open) ui.expanded.add(key); else ui.expanded.delete(key);
    renderNav(ui);
    ui.el.nav.querySelector(`[data-key="${cssEsc(key)}"]`)?.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ rename */

  function beginRename(ui, id) {
    const node = Win.FS.get(id);
    if (!node) return;
    if (node.system) { Win.alert('File Explorer', "You'll need to provide administrator permission to rename this item.", ui.win); return; }
    const el = ui.el.view.querySelector(`.fx-item[data-id="${cssEsc(id)}"]`);
    const label = el?.querySelector('.fx-name');
    if (!label) return;
    finishRename(ui);
    el.scrollIntoView({ block: 'nearest' });
    const shown = node.kind === 'drive' ? node.name : Win.FS.display(node);
    const input = Win.html('<input class="fx-rename" spellcheck="false" autocomplete="off" aria-label="Rename">');
    input.value = shown;
    label.classList.add('hidden');
    label.after(input);
    el.draggable = false;
    el.classList.add('renaming');
    const state = { id, input, label, el, busy: false, tip: null };
    ui.renaming = state;
    input.focus();
    const dot = shown.lastIndexOf('.');
    if (node.kind === 'file' && S().fileExtensions && dot > 0) input.setSelectionRange(0, dot); else input.select();
    const fullName = value => (node.kind === 'file' && !S().fileExtensions && node.ext ? `${value}.${node.ext}` : value);

    const commit = async () => {
      if (state.busy || ui.renaming !== state) return;
      const value = input.value.replace(/[\s.]+$/, '').trim();
      if (!value || value === shown) { finishRename(ui); return; }
      const name = fullName(value);
      if (node.kind === 'file' && S().fileExtensions && node.ext && !name.toLowerCase().endsWith(`.${node.ext}`)) {
        state.busy = true;
        const ok = await Win.confirm('Rename', 'If you change a file name extension, the file might become unusable.\n\nAre you sure you want to change it?', { owner: ui.win });
        state.busy = false;
        if (!ok) { if (ui.renaming === state) { input.focus(); input.setSelectionRange(0, input.value.length); } return; }
      }
      const problem = Win.FS.rename(id, name);
      if (problem) { showTip(ui, input, problem); input.focus(); return; }
      finishRename(ui);
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); finishRename(ui); }
    });
    input.addEventListener('beforeinput', e => {
      if (e.data && /[\\/:*?"<>|]/.test(e.data)) {
        e.preventDefault();
        showTip(ui, input, 'A file name can\'t contain any of the following characters:\n\\ / : * ? " < > |');
      }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (ui.renaming === state && !state.busy) commit().then(() => { if (ui.renaming === state && document.activeElement !== input) finishRename(ui); }); }, 0));
    ['pointerdown', 'dblclick', 'click', 'dragstart'].forEach(type => input.addEventListener(type, e => e.stopPropagation()));
  }

  function finishRename(ui) {
    const r = ui.renaming;
    if (!r) return;
    ui.renaming = null;
    r.tip?.remove();
    const hadFocus = document.activeElement === r.input;
    r.input.remove();
    r.label.classList.remove('hidden');
    ui.rendered = `${ui.tab.loc}|${ui.tab.search}|${ui.tab.filter}`;
    renderAll(ui);
    if (hadFocus || !ui.win.el.contains(document.activeElement)) ui.el.view.focus({ preventScroll: true });
  }

  function showTip(ui, anchor, message) {
    const r = ui.renaming;
    r?.tip?.remove();
    const host = ui.win.body.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const tip = Win.html(`<div class="fx-tip" role="alert">${g('error', 14)}<span>${esc(message)}</span></div>`);
    tip.style.left = `${Math.max(4, a.left - host.left)}px`;
    tip.style.top = `${a.bottom - host.top + 6}px`;
    ui.win.body.appendChild(tip);
    if (r) r.tip = tip;
    setTimeout(() => tip.remove(), 4500);
  }

  /* ---------------------------------------------------------- drag and drop */

  const draggedIds = e => {
    if (!e.dataTransfer?.types?.includes(MIME)) return null;
    return Win.dragFiles?.ids || [];
  };

  const sameDrive = (ids, target) => {
    const t = Win.FS.driveOf(target)?.id;
    return ids.every(id => Win.FS.driveOf(id)?.id === t);
  };

  function dropEffect(e, ids, target) {
    if (e.ctrlKey) return 'copy';
    if (e.shiftKey) return 'move';
    if (ids.some(id => Win.FS.get(id)?.system)) return 'copy';
    return !ids.length || sameDrive(ids, target) ? 'move' : 'copy';
  }

  const canDrop = (ids, target) => !!target && ids.every(id => id !== target && !Win.FS.contains(id, target)) && (!ids.length || !ids.every(id => Win.FS.get(id)?.parent === target));

  function readDropIds(e) {
    let ids = Win.dragFiles?.ids;
    if (!ids) { try { ids = JSON.parse(e.dataTransfer.getData(MIME) || '[]'); } catch { ids = []; } }
    return ids.filter(id => Win.FS.get(id));
  }

  function setDropHi(ui, el) {
    if (ui.dropEl === el) return;
    ui.dropEl?.classList.remove('drop');
    ui.dropEl = el;
    el?.classList.add('drop');
  }

  function startDrag(ui, e, ids) {
    Win.dragFiles = { ids, from: ui.win.id };
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(MIME, JSON.stringify(ids));
    e.dataTransfer.setData('text/plain', ids.map(id => pathOf(id)).join('\r\n'));
    if (ids.length > 1 && e.dataTransfer.setDragImage) {
      const ghost = Win.html(`<div class="fx-ghost">${iconFor(Win.FS.get(ids[0]), 48)}<span>${ids.length}</span></div>`);
      ui.win.el.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 30, 30);
      setTimeout(() => ghost.remove(), 0);
    }
  }

  /** Content-area target: a folder under the pointer, else the open folder. */
  function contentTarget(ui, e) {
    const item = e.target.closest?.('.fx-item');
    const n = item && ui.map.get(item.dataset.id);
    if (n && !n.virtual && isFolderish(n) && ui.tab.loc !== 'bin') return { id: n.id, el: item };
    if (ui.tab.loc === 'bin') return { id: 'bin', el: null };
    const folder = writableFolder(ui.tab.loc);
    return folder ? { id: folder, el: null } : null;
  }

  function performDrop(ui, e, target) {
    const ids = readDropIds(e);
    Win.dragFiles = null;
    if (!ids.length) return [];
    if (target === 'bin') { Explorer.remove(ids, { owner: ui.win }); return []; }
    if (!canDrop(ids, target)) return [];
    return Explorer.transfer(ids, target, dropEffect(e, ids, target));
  }

  /* ---------------------------------------------------------------- marquee */

  function startMarquee(ui, e) {
    const view = ui.el.view;
    const tab = ui.tab;
    const base = e.ctrlKey ? new Set(tab.sel) : new Set();
    if (!e.ctrlKey && !e.shiftKey && tab.sel.size) { tab.sel.clear(); paintSelection(ui); }
    const vr = view.getBoundingClientRect();
    const ox = e.clientX - vr.left + view.scrollLeft;
    const oy = e.clientY - vr.top + view.scrollTop;
    const items = Win.$$('.fx-item', view).map(el => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.id, l: r.left - vr.left + view.scrollLeft, t: r.top - vr.top + view.scrollTop, r: r.right - vr.left + view.scrollLeft, b: r.bottom - vr.top + view.scrollTop };
    });
    const box = Win.html('<div class="fx-marquee" aria-hidden="true"></div>');
    let started = false;
    let frame = 0;
    let last = e;
    let scroller = 0;
    view.setPointerCapture?.(e.pointerId);
    const update = () => {
      frame = 0;
      const now = view.getBoundingClientRect();
      const x = Win.clamp(last.clientX - now.left + view.scrollLeft, 0, view.scrollWidth);
      const y = Win.clamp(last.clientY - now.top + view.scrollTop, 0, view.scrollHeight);
      const l = Math.min(ox, x);
      const t = Math.min(oy, y);
      const r = Math.max(ox, x);
      const b = Math.max(oy, y);
      Object.assign(box.style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px` });
      const next = new Set(base);
      for (const it of items) {
        if (it.r < l || it.l > r || it.b < t || it.t > b) continue;
        if (base.has(it.id)) next.delete(it.id); else next.add(it.id);
      }
      tab.sel = next;
      paintSelection(ui, { light: true });
    };
    const autoScroll = () => {
      const now = view.getBoundingClientRect();
      const dy = last.clientY < now.top + 16 ? -14 : last.clientY > now.bottom - 16 ? 14 : 0;
      if (dy) { view.scrollTop += dy; if (!frame) frame = requestAnimationFrame(update); }
      scroller = requestAnimationFrame(autoScroll);
    };
    const move = ev => {
      last = ev;
      if (!started) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        started = true;
        view.appendChild(box);
        scroller = requestAnimationFrame(autoScroll);
      }
      if (!frame) frame = requestAnimationFrame(update);
    };
    const up = () => {
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', up);
      view.removeEventListener('pointercancel', up);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scroller);
      if (started) { update(); box.remove(); ui.suppressClick = true; }
      paintSelection(ui);
    };
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
  }

  /* -------------------------------------------------------------- selection */

  function selectRange(ui, from, to, add) {
    const a = ui.order.indexOf(from);
    const b = ui.order.indexOf(to);
    if (a < 0 || b < 0) { ui.tab.sel = new Set([to]); return; }
    const range = ui.order.slice(Math.min(a, b), Math.max(a, b) + 1);
    ui.tab.sel = add ? new Set([...ui.tab.sel, ...range]) : new Set(range);
  }

  function gridColumns(ui) {
    const els = Win.$$('.fx-item', ui.el.view);
    if (els.length < 2) return 1;
    const mode = ui.el.view.dataset.view;
    if (mode === 'list') {
      const left = els[0].offsetLeft;
      let rows = 0;
      while (rows < els.length && els[rows].offsetLeft === left) rows += 1;
      return { rows };
    }
    if (mode === 'details' || mode === 'content') return 1;
    const top = els[0].getBoundingClientRect().top;
    let cols = 0;
    while (cols < els.length && Math.abs(els[cols].getBoundingClientRect().top - top) < 2) cols += 1;
    return cols || 1;
  }

  function moveFocus(ui, e) {
    const ids = ui.order;
    if (!ids.length) return;
    const tab = ui.tab;
    const i = ids.indexOf(tab.focus);
    const layout = gridColumns(ui);
    const list = typeof layout === 'object';
    const cols = list ? 1 : layout;
    const step = {
      ArrowDown: list ? 1 : cols, ArrowUp: list ? -1 : -cols,
      ArrowRight: list ? layout.rows : cols > 1 ? 1 : 0, ArrowLeft: list ? -layout.rows : cols > 1 ? -1 : 0,
      PageDown: 10 * cols, PageUp: -10 * cols,
    }[e.key];
    let next;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    else if (i < 0) next = 0;
    else next = Win.clamp(i + (step || 0), 0, ids.length - 1);
    const id = ids[next];
    if (e.shiftKey) selectRange(ui, tab.anchor || id, id, e.ctrlKey);
    else if (!e.ctrlKey) { tab.sel = new Set([id]); tab.anchor = id; }
    tab.focus = id;
    paintSelection(ui);
    ui.el.view.querySelector(`.fx-item[data-id="${cssEsc(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function typeAhead(ui, ch) {
    clearTimeout(ui.typeTimer);
    ui.typed = (ui.typed || '') + ch.toLowerCase();
    ui.typeTimer = setTimeout(() => { ui.typed = ''; }, 900);
    const ids = ui.order;
    const start = ui.typed.length === 1 ? ids.indexOf(ui.tab.focus) + 1 : Math.max(0, ids.indexOf(ui.tab.focus));
    const ordered = [...ids.slice(start), ...ids.slice(0, start)];
    const hit = ordered.find(id => Win.FS.display(ui.map.get(id)).toLowerCase().startsWith(ui.typed));
    if (!hit) return;
    ui.tab.sel = new Set([hit]);
    ui.tab.anchor = ui.tab.focus = hit;
    paintSelection(ui);
    ui.el.view.querySelector(`.fx-item[data-id="${cssEsc(hit)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  /* ----------------------------------------------------------------- wiring */

  function wire(ui) {
    const { win } = ui;
    const { view, nav, strip, bar, pathIn, search, searchX, split } = ui.el;

    win.body.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled && win.body.contains(b) && !b.closest('.fx-view .fx-item')) runAct(ui, b.dataset.act, b);
    });
    win.titleContent.addEventListener('click', e => {
      if (e.target.closest('[data-act="newtab"]')) runAct(ui, 'newtab');
      const x = e.target.closest('[data-close]');
      if (x) closeTab(ui, x.dataset.close);
    });

    /* Tabs activate on press, like Explorer; the strip still drags the window. */
    strip.addEventListener('pointerdown', e => {
      const t = e.target.closest('.ft-tab');
      if (!t || e.button !== 0 || e.target.closest('.ft-x')) return;
      const tab = ui.tabs.find(x => x.id === t.dataset.tab);
      if (tab && tab !== ui.tab) activate(ui, tab);
    });
    strip.addEventListener('auxclick', e => {
      const t = e.target.closest('.ft-tab');
      if (t && e.button === 1) { e.preventDefault(); closeTab(ui, t.dataset.tab); }
    });
    strip.addEventListener('keydown', e => {
      const t = e.target.closest('.ft-tab');
      if (!t) return;
      const i = ui.tabs.findIndex(x => x.id === t.dataset.tab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = ui.tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + ui.tabs.length) % ui.tabs.length];
        activate(ui, next);
        strip.querySelector('.ft-tab.on')?.focus();
      }
      if (e.key === 'Delete') closeTab(ui, t.dataset.tab);
    });
    strip.addEventListener('contextmenu', e => {
      const t = e.target.closest('.ft-tab');
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const tab = ui.tabs.find(x => x.id === t.dataset.tab);
      const i = ui.tabs.indexOf(tab);
      Win.menu(e.clientX, e.clientY, [
        { label: 'New tab', glyph: 'plus', shortcut: 'Ctrl+T', action: () => runAct(ui, 'newtab') },
        { label: 'Duplicate tab', glyph: 'copy', action: () => openTab(ui, tab.loc, { after: true }) },
        { label: 'Move tab to new window', glyph: 'open', disabled: ui.tabs.length < 2, action: () => { Win.wm.open('explorer', { path: tab.loc }); closeTab(ui, tab.id); } },
        { divider: true },
        { label: 'Close tab', glyph: 'close', shortcut: 'Ctrl+W', action: () => closeTab(ui, tab.id) },
        { label: 'Close other tabs', disabled: ui.tabs.length < 2, action: () => { ui.tabs = [tab]; activate(ui, tab); } },
        { label: 'Close tabs to the right', disabled: i === ui.tabs.length - 1, action: () => { ui.tabs = ui.tabs.slice(0, i + 1); activate(ui, ui.tabs.includes(ui.tab) ? ui.tab : tab); } },
      ]);
    });
    let hoverTimer = 0;
    strip.addEventListener('dragover', e => {
      const t = e.target.closest('.ft-tab');
      const ids = draggedIds(e);
      if (!t || !ids) return;
      const tab = ui.tabs.find(x => x.id === t.dataset.tab);
      const folder = tab && writableFolder(tab.loc);
      if (tab !== ui.tab && !hoverTimer) hoverTimer = setTimeout(() => { hoverTimer = 0; if (tab && ui.tabs.includes(tab)) activate(ui, tab); }, 650);
      if (folder && canDrop(ids, folder)) { e.preventDefault(); e.dataTransfer.dropEffect = dropEffect(e, ids, folder); }
    });
    strip.addEventListener('dragleave', () => { clearTimeout(hoverTimer); hoverTimer = 0; });
    strip.addEventListener('drop', e => {
      clearTimeout(hoverTimer);
      hoverTimer = 0;
      const t = e.target.closest('.ft-tab');
      const tab = t && ui.tabs.find(x => x.id === t.dataset.tab);
      const folder = tab && writableFolder(tab.loc);
      if (!folder) return;
      e.preventDefault();
      performDrop(ui, e, folder);
    });

    /* Address bar */
    bar.addEventListener('click', e => {
      if (ui.editing) return;
      const chev = e.target.closest('[data-chev]');
      if (chev) { chevMenu(ui, chev); return; }
      const crumb = e.target.closest('[data-crumb]');
      if (crumb) { if (crumb.dataset.crumb && crumb.dataset.crumb !== ui.tab.loc) navigate(ui, crumb.dataset.crumb); else if (crumb.dataset.crumb === ui.tab.loc && ui.tab.search) navigate(ui, ui.tab.loc, { push: false }); return; }
      startEdit(ui);
    });
    bar.addEventListener('dragover', e => {
      const crumb = e.target.closest('[data-crumb]');
      const ids = draggedIds(e);
      const folder = crumb && writableFolder(crumb.dataset.crumb);
      if (ids && folder && canDrop(ids, folder)) { e.preventDefault(); e.dataTransfer.dropEffect = dropEffect(e, ids, folder); }
    });
    bar.addEventListener('drop', e => {
      const crumb = e.target.closest('[data-crumb]');
      const folder = crumb && writableFolder(crumb.dataset.crumb);
      if (!folder) return;
      e.preventDefault();
      performDrop(ui, e, folder);
    });
    pathIn.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); goTyped(ui, pathIn.value); }
      if (e.key === 'Escape') { e.preventDefault(); endEdit(ui); view.focus({ preventScroll: true }); }
    });
    pathIn.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== pathIn && !win.el.querySelector('.dlg-smoke')) endEdit(ui); }, 0));

    /* Search */
    const runSearch = Win.debounce(() => {
      const q = search.value.trim();
      if (q === ui.tab.search) return;
      ui.tab.search = q;
      ui.tab.sel.clear();
      ui.rendered = null;
      renderAll(ui);
    }, 220);
    search.addEventListener('input', () => { searchX.classList.toggle('hidden', !search.value); runSearch(); });
    search.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); search.value = ''; runSearch(); view.focus({ preventScroll: true }); }
      if (e.key === 'Enter') { e.preventDefault(); ui.tab.search = ''; runSearch(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); view.focus({ preventScroll: true }); }
    });
    searchX.addEventListener('click', e => { e.preventDefault(); search.value = ''; searchX.classList.add('hidden'); runSearch(); search.focus(); });

    /* Navigation pane */
    nav.addEventListener('click', e => {
      const row = e.target.closest('.fx-ni');
      if (!row) return;
      if (e.target.closest('[data-twist]') && !e.target.closest('.fx-tw.none')) { toggleExpand(ui, row.dataset.key); return; }
      navigate(ui, row.dataset.loc);
      row.focus({ preventScroll: true });
    });
    nav.addEventListener('dblclick', e => {
      const row = e.target.closest('.fx-ni');
      if (row?.hasAttribute('aria-expanded') && !e.target.closest('[data-twist]')) toggleExpand(ui, row.dataset.key);
    });
    nav.addEventListener('auxclick', e => {
      const row = e.target.closest('.fx-ni');
      if (row && e.button === 1) { e.preventDefault(); openTab(ui, row.dataset.loc, { background: true }); }
    });
    nav.addEventListener('contextmenu', e => {
      const row = e.target.closest('.fx-ni');
      e.preventDefault();
      e.stopPropagation();
      if (row) navMenu(ui, row, e.clientX, e.clientY);
    });
    nav.addEventListener('keydown', e => {
      const row = e.target.closest('.fx-ni');
      if (!row) return;
      const rows = Win.$$('.fx-ni', nav);
      const i = rows.indexOf(row);
      const expandable = row.hasAttribute('aria-expanded');
      const open = row.getAttribute('aria-expanded') === 'true';
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[Win.clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1)].focus(); }
      if (e.key === 'ArrowRight' && expandable) { e.preventDefault(); if (!open) toggleExpand(ui, row.dataset.key, true); else rows[i + 1]?.focus(); }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (open) toggleExpand(ui, row.dataset.key, false);
        else { const parentKey = row.dataset.key.split('/').slice(0, -1).join('/'); nav.querySelector(`[data-key="${cssEsc(parentKey)}"]`)?.focus(); }
      }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(ui, row.dataset.loc); nav.querySelector(`[data-key="${cssEsc(row.dataset.key)}"]`)?.focus(); }
    });
    nav.addEventListener('dragover', e => {
      const row = e.target.closest('.fx-ni');
      const ids = draggedIds(e);
      const target = row && (row.dataset.loc === 'bin' ? 'bin' : writableFolder(row.dataset.loc));
      if (!ids || !target || (target !== 'bin' && !canDrop(ids, target))) { setDropHi(ui, null); return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = target === 'bin' ? 'move' : dropEffect(e, ids, target);
      setDropHi(ui, row);
      clearTimeout(ui.navExpandTimer);
      if (row.getAttribute('aria-expanded') === 'false') ui.navExpandTimer = setTimeout(() => toggleExpand(ui, row.dataset.key, true), 800);
    });
    nav.addEventListener('dragleave', e => { if (!nav.contains(e.relatedTarget)) setDropHi(ui, null); });
    nav.addEventListener('drop', e => {
      const row = e.target.closest('.fx-ni');
      setDropHi(ui, null);
      clearTimeout(ui.navExpandTimer);
      const target = row && writableFolder(row.dataset.loc);
      if (!target) return;
      e.preventDefault();
      performDrop(ui, e, target);
    });

    /* Navigation pane width */
    split.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      split.setPointerCapture(e.pointerId);
      const start = X().navWidth || 220;
      document.body.classList.add('fx-resizing');
      const move = ev => { X().navWidth = Win.clamp(start + ev.clientX - e.clientX, 140, 480); nav.style.width = `${X().navWidth}px`; };
      const up = () => { split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); document.body.classList.remove('fx-resizing'); Win.save(); };
      split.addEventListener('pointermove', move);
      split.addEventListener('pointerup', up);
    });

    /* Items */
    view.addEventListener('pointerdown', e => {
      if (e.target.closest('.fx-rename')) return;
      const grip = e.target.closest('[data-grip]');
      if (grip) { resizeColumn(ui, e, grip.dataset.grip); return; }
      if (e.target.closest('.fx-head, .fx-sech, button, .fx-note, .infobar')) return;
      const item = e.target.closest('.fx-item');
      if (ui.renaming && (!item || item.dataset.id !== ui.renaming.id)) ui.renaming.input.blur();
      if (!item) {
        if (e.button === 0) startMarquee(ui, e);
        else if (e.button === 2 && !e.ctrlKey && ui.tab.sel.size) { ui.tab.sel.clear(); paintSelection(ui); }
        return;
      }
      const id = item.dataset.id;
      const tab = ui.tab;
      ui.pending = null;
      if (e.shiftKey && tab.anchor && e.button === 0) selectRange(ui, tab.anchor, id, e.ctrlKey);
      else if (e.ctrlKey && e.button === 0) { if (tab.sel.has(id)) tab.sel.delete(id); else tab.sel.add(id); tab.anchor = id; } else if (!tab.sel.has(id)) { tab.sel = new Set([id]); tab.anchor = id; } else if (e.button === 0) ui.pending = id;
      tab.focus = id;
      paintSelection(ui);
    });
    view.addEventListener('click', e => {
      if (ui.suppressClick) { ui.suppressClick = false; return; }
      const sec = e.target.closest('[data-sec]');
      if (sec) { const k = sec.dataset.sec; if (ui.collapsed.has(k)) ui.collapsed.delete(k); else ui.collapsed.add(k); renderContent(ui); return; }
      const head = e.target.closest('[data-sortcol]');
      if (head) {
        const s = sortFor(ui.tab.search ? `search:${ui.tab.loc}` : ui.tab.loc);
        const key = head.dataset.sortcol;
        setSort(ui, key, s.key === key ? -s.dir : (key === 'modified' || key === 'deleted' ? -1 : 1));
        return;
      }
      const item = e.target.closest('.fx-item');
      if (item && ui.pending === item.dataset.id && !e.ctrlKey && !e.shiftKey) {
        ui.tab.sel = new Set([ui.pending]);
        ui.tab.anchor = ui.pending;
        paintSelection(ui);
      }
      ui.pending = null;
    });
    view.addEventListener('dblclick', e => {
      const item = e.target.closest('.fx-item');
      if (!item || e.target.closest('.fx-rename')) return;
      const node = ui.map.get(item.dataset.id);
      if (node) openNodes(ui, [node]);
    });
    view.addEventListener('auxclick', e => {
      const item = e.target.closest('.fx-item');
      const node = item && ui.map.get(item.dataset.id);
      if (e.button === 1 && node && isFolderish(node)) { e.preventDefault(); openNodes(ui, [node], 'tab'); }
    });
    view.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target.closest('.fx-rename')) return;
      const item = e.target.closest('.fx-item');
      if (item) itemMenu(ui, e.clientX, e.clientY);
      else backgroundMenu(ui, e.clientX, e.clientY);
    });
    view.addEventListener('dragstart', e => {
      const item = e.target.closest('.fx-item');
      if (!item || item.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
      ui.pending = null;
      const id = item.dataset.id;
      if (!ui.tab.sel.has(id)) { ui.tab.sel = new Set([id]); paintSelection(ui); }
      const ids = [...ui.tab.sel].filter(x => Win.FS.get(x));
      startDrag(ui, e, ids);
    });
    view.addEventListener('dragover', e => {
      const ids = draggedIds(e);
      if (!ids) return;
      const target = contentTarget(ui, e);
      if (!target || (target.id !== 'bin' && !canDrop(ids, target.id))) { setDropHi(ui, null); e.dataTransfer.dropEffect = 'none'; return; }
      e.preventDefault();
      setDropHi(ui, target.el);
      e.dataTransfer.dropEffect = target.id === 'bin' ? 'move' : dropEffect(e, ids, target.id);
    });
    view.addEventListener('dragleave', e => { if (!view.contains(e.relatedTarget)) setDropHi(ui, null); });
    view.addEventListener('drop', e => {
      const target = contentTarget(ui, e);
      setDropHi(ui, null);
      if (!target) return;
      e.preventDefault();
      const moved = performDrop(ui, e, target.id);
      if (moved.length && target.id === writableFolder(ui.tab.loc)) ui.tab.sel = new Set(moved);
    });
    view.addEventListener('dragend', () => { Win.dragFiles = null; setDropHi(ui, null); });

    win.el.addEventListener('keydown', e => onKey(ui, e));
    win.el.addEventListener('win-resize', Win.debounce(() => { if (!ui.editing) renderAddress(ui); }, 60));
  }

  function resizeColumn(ui, e, key) {
    e.preventDefault();
    e.stopPropagation();
    const grip = e.target;
    const table = grip.closest('.fx-details');
    const start = colW(key);
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('fx-resizing');
    const cols = ui.tab.loc === 'home' ? ['name', 'modified', 'location'] : colsFor(ui);
    const move = ev => {
      X().cols[key] = Math.round(Win.clamp(start + ev.clientX - e.clientX, 50, 900));
      table.style.setProperty('--cols', colTemplate(cols));
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      document.body.classList.remove('fx-resizing');
      ui.suppressClick = true;
      setTimeout(() => { ui.suppressClick = false; }, 0);
      Win.save();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  }

  function onKey(ui, e) {
    if (e.defaultPrevented || e.target.closest?.('.dlg-smoke')) return;
    const k = e.key;
    const l = k.length === 1 ? k.toLowerCase() : k;
    const ctrl = e.ctrlKey || e.metaKey;
    const typing = e.target.matches?.('input, textarea, select, [contenteditable="true"]');
    const tab = ui.tab;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const cycle = d => activate(ui, ui.tabs[(ui.tabs.indexOf(tab) + d + ui.tabs.length) % ui.tabs.length]);

    if (ctrl && !e.altKey) {
      if (k === 'Tab') { stop(); cycle(e.shiftKey ? -1 : 1); return; }
      if (!e.shiftKey && l === 't') { stop(); runAct(ui, 'newtab'); return; }
      if (!e.shiftKey && l === 'w') { stop(); closeTab(ui, tab.id); return; }
      if (!e.shiftKey && l === 'n') { stop(); Win.wm.open('explorer', { path: tab.loc }); return; }
      if (!e.shiftKey && l === 'l') { stop(); startEdit(ui); return; }
      if (!e.shiftKey && (l === 'e' || l === 'f')) { stop(); ui.el.search.focus(); ui.el.search.select(); return; }
    }
    if (e.altKey && !ctrl) {
      if (k === 'ArrowLeft') { stop(); goBack(ui); return; }
      if (k === 'ArrowRight') { stop(); goForward(ui); return; }
      if (k === 'ArrowUp') { stop(); goUp(ui); return; }
      if (l === 'd') { stop(); startEdit(ui); return; }
      if (l === 'p') { stop(); setPane(e.shiftKey ? 'details' : 'preview'); return; }
      if (k === 'Enter' && !typing) { stop(); propsForSelection(ui); return; }
    }
    if (k === 'F5') { stop(); runAct(ui, 'refresh'); return; }
    if (k === 'F3') { stop(); ui.el.search.focus(); return; }
    if (k === 'F4' && !e.altKey) { stop(); startEdit(ui); return; }
    if (typing) return;
    if (e.target.closest?.('.ft-strip, .fx-nav') && !ctrl) return;
    const inView = e.target === ui.el.view || e.target === ui.win.el;

    const sel = selNodes(ui).filter(n => !n.virtual);
    if (ctrl && e.shiftKey && /^Digit[1-8]$/.test(e.code)) { stop(); setView(ui, VIEWS[Number(e.code.slice(5)) - 1].id); return; }
    if (ctrl && e.shiftKey && l === 'n') { stop(); const folder = writableFolder(tab.loc); if (folder) createAndRename(ui, Explorer.newFolder(folder)); return; }
    if (ctrl && e.shiftKey && l === 'c') { stop(); if (sel.length) Explorer.copyAsPath(sel.map(n => n.id)); return; }
    if (ctrl && !e.shiftKey) {
      if (l === 'a') { stop(); selectAll(ui); return; }
      if (l === 'c') { stop(); runAct(ui, 'copy'); return; }
      if (l === 'x') { stop(); if (!sel.some(n => n.system || n.kind === 'drive')) runAct(ui, 'cut'); return; }
      if (l === 'v') { stop(); doPaste(ui); return; }
      if (k === ' ') { stop(); if (tab.focus) { if (tab.sel.has(tab.focus)) tab.sel.delete(tab.focus); else tab.sel.add(tab.focus); paintSelection(ui); } return; }
    }
    if (k === 'Delete') { stop(); deleteSelection(ui, e.shiftKey); return; }
    if (k === 'F2') { stop(); if (sel.length === 1) beginRename(ui, sel[0].id); return; }
    if (k === 'Enter') { stop(); const nodes = selNodes(ui); if (nodes.length) openNodes(ui, nodes); return; }
    if (k === 'Backspace') { stop(); goBack(ui); return; }
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown', 'PageUp'].includes(k) && inView) { stop(); moveFocus(ui, e); return; }
    if (k === 'ContextMenu' || (e.shiftKey && k === 'F10')) {
      stop();
      const el = tab.focus && ui.el.view.querySelector(`.fx-item[data-id="${cssEsc(tab.focus)}"]`);
      const r = (el || ui.el.view).getBoundingClientRect();
      if (el && tab.sel.size) itemMenu(ui, r.left + 24, r.top + r.height / 2); else backgroundMenu(ui, r.left + 24, r.top + 24);
      return;
    }
    if (k.length === 1 && !ctrl && !e.altKey && inView && k !== ' ') { stop(); typeAhead(ui, k); }
  }

  /* --------------------------------------------- dropping onto the desktop */

  /* Fallback for drags that leave a window over the wallpaper. The desktop
     module may handle these itself; it then calls preventDefault first. */
  const onDesktop = t => !!t?.closest?.('#desktop') && !t.closest('.win');
  document.addEventListener('dragover', e => {
    if (e.defaultPrevented || !e.dataTransfer?.types?.includes(MIME) || !onDesktop(e.target)) return;
    const ids = Win.dragFiles?.ids || [];
    if (ids.length && ids.every(id => Win.FS.get(id)?.parent === 'desktop')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dropEffect(e, ids, 'desktop');
  });
  document.addEventListener('drop', e => {
    if (e.defaultPrevented || !e.dataTransfer?.types?.includes(MIME) || !onDesktop(e.target)) return;
    e.preventDefault();
    const ids = readDropIds(e);
    Win.dragFiles = null;
    if (ids.length && canDrop(ids, 'desktop')) Explorer.transfer(ids, 'desktop', dropEffect(e, ids, 'desktop'));
  });
  document.addEventListener('dragend', () => { Win.dragFiles = null; });

  Object.assign(Explorer, { locExists, resolveInput, normalizeLoc, zipItems, fileTypes, openWithApps });
})(window.Win);
