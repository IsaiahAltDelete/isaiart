/* ===========================================================================
   File system model and Finder.

   Nodes are stored flat with a `parent` pointer (see 03-state.js). Finder
   windows each own their own location, view mode, selection and back/forward
   history, so several windows can browse independently.
   =========================================================================== */

(function (Mac) {
  'use strict';

  const { esc, glyph, appIcon, UI } = Mac;

  /* ------------------------------------------------------------ file system */

  const FS = Mac.FS = {
    all() { return Mac.state.fs; },

    node(id) { return Mac.state.fs.find(entry => entry.id === id) || null; },

    children(parentId) {
      return Mac.state.fs.filter(entry => entry.parent === parentId);
    },

    /** Ancestor chain from the volume down to (and including) the node. */
    path(id) {
      const chain = [];
      let node = this.node(id);
      while (node) {
        chain.unshift(node);
        node = node.parent ? this.node(node.parent) : null;
      }
      return chain;
    },

    pathString(id) {
      if (id === 'trash') return 'Trash';
      const chain = this.path(id);
      if (!chain.length) return '';
      return chain.map(node => node.name).join(' › ');
    },

    isFolder(node) { return node && (node.kind === 'folder' || node.kind === 'volume'); },

    kindLabel(node) {
      if (!node) return '';
      if (node.kind === 'volume') return 'Volume';
      if (node.kind === 'folder') return 'Folder';
      if (node.kind === 'app') return 'Application';
      const names = {
        pdf: 'PDF Document', txt: 'Plain Text Document', png: 'PNG Image',
        jpeg: 'JPEG Image', m4a: 'Apple MPEG-4 Audio', mov: 'QuickTime Movie',
        pkg: 'Installer Package', csv: 'Comma Separated Values', rtf: 'Rich Text Document',
      };
      return names[node.ext] || `${(node.ext || 'Unknown').toUpperCase()} Document`;
    },

    iconFor(node) {
      if (!node) return 'document';
      if (node.kind === 'volume') return node.kind === 'volume' && node.id === 'vol-backup' ? 'volume-external' : 'volume';
      if (node.kind === 'app') return Mac.apps[node.appId]?.icon || 'appstore';
      if (node.kind === 'folder') {
        if (node.id === 'dir-public') return 'folder-shared';
        if (node.id === 'dir-apps') return 'folder';
        return 'folder';
      }
      const byExt = {
        pdf: 'document-pdf', png: 'photos', jpeg: 'photos', jpg: 'photos',
        m4a: 'music', mov: 'podcasts', pkg: 'appstore',
      };
      return byExt[node.ext] || 'document';
    },

    /** Which app opens this node when double-clicked. */
    openerFor(node) {
      if (node.kind === 'app') return node.appId;
      const byExt = {
        pdf: 'preview', png: 'preview', jpeg: 'preview', jpg: 'preview',
        txt: 'textedit', rtf: 'textedit', csv: 'textedit',
        m4a: 'music', mov: 'preview', pkg: 'preview',
      };
      return byExt[node.ext] || 'preview';
    },

    search(query) {
      const q = String(query).toLowerCase();
      if (!q) return [];
      return Mac.state.fs.filter(node =>
        node.parent !== 'trash' && node.kind !== 'volume'
        && node.name.toLowerCase().includes(q) && this.reachable(node));
    },

    /** The volume a node sits on, or null for the startup volume. */
    volumeOf(id) {
      const root = this.path(id)[0];
      return root && root.kind === 'volume' ? root : null;
    },

    /* An unplugged disk's files must not turn up in Recents or in a search;
       that is the difference between a disk being ejected and merely
       hidden. */
    reachable(node) {
      const volume = this.volumeOf(node.id);
      if (!volume || volume.id === 'vol-hd') return true;
      const record = Mac.state.volumes.find(entry => entry.id === volume.id);
      return !record || record.mounted !== false;
    },

    /** Recently modified files, used for the Recents sidebar item. */
    recents() {
      return Mac.state.fs
        .filter(node => node.kind === 'file' && node.parent !== 'trash')
        .filter(node => this.reachable(node))
        .sort((a, b) => (b.modified || 0) - (a.modified || 0))
        .slice(0, 24);
    },

    uniqueName(parentId, base) {
      const siblings = this.children(parentId).map(node => node.name.toLowerCase());
      if (!siblings.includes(base.toLowerCase())) return base;
      let counter = 2;
      const dot = base.lastIndexOf('.');
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : '';
      while (siblings.includes(`${stem} ${counter}${ext}`.toLowerCase())) counter += 1;
      return `${stem} ${counter}${ext}`;
    },

    createFolder(parentId, name = 'untitled folder') {
      const node = { id: Mac.uid('dir'), name: this.uniqueName(parentId, name), kind: 'folder', parent: parentId, modified: Date.now() };
      Mac.state.fs.push(node);
      Mac.save();
      return node;
    },

    createFile(parentId, name, { ext = 'txt', size = 1024 } = {}) {
      const node = { id: Mac.uid('f'), name: this.uniqueName(parentId, name), kind: 'file', ext, parent: parentId, size, modified: Date.now() };
      Mac.state.fs.push(node);
      Mac.save();
      return node;
    },

    rename(id, name) {
      const node = this.node(id);
      if (!node) return false;
      node.name = name;
      node.modified = Date.now();
      Mac.save();
      return true;
    },

    /**
     * Move a node into another folder.
     *
     * Finder could navigate and delete and nothing else, so the single most
     * common thing anyone is walked through on a call — "drag that into your
     * Documents folder" — had no equivalent here at all.
     *
     * @returns {true|string} true, or why it was refused
     */
    move(id, targetId) {
      const node = this.node(id);
      const target = this.node(targetId);
      if (!node) return 'That item no longer exists.';
      if (node.system || node.home || node.kind === 'volume') return `“${node.name}” is required by macOS and cannot be moved.`;
      if (!target || !this.isFolder(target)) return 'Choose a folder to move it into.';
      if (targetId === node.parent) return `“${node.name}” is already in “${target.name}”.`;
      /* Moving a folder inside itself would orphan the whole subtree, and
         the flat parent-pointer model would not notice. */
      if (targetId === id || this.descendants(id).some(child => child.id === targetId))
        return `“${node.name}” cannot be moved inside itself.`;
      node.name = this.uniqueName(targetId, node.name);
      node.parent = targetId;
      node.modified = Date.now();
      delete node.trashedFrom;
      delete node.trashedAt;
      this.descendants(id).forEach(child => { delete child.hiddenInTrash; });
      Mac.save();
      return true;
    },

    /**
     * Copy a node — and everything inside it — into another folder.
     * @returns {object|string} the new node, or why it was refused
     */
    copy(id, targetId, { name = null } = {}) {
      const node = this.node(id);
      const target = this.node(targetId);
      if (!node) return 'That item no longer exists.';
      if (!target || !this.isFolder(target)) return 'Choose a folder to copy it into.';
      if (targetId === id || this.descendants(id).some(child => child.id === targetId))
        return `“${node.name}” cannot be copied inside itself.`;

      const clone = (source, parentId, forcedName) => {
        const copyNode = Object.assign({}, source, {
          id: Mac.uid(source.kind === 'folder' ? 'dir' : 'f'),
          name: this.uniqueName(parentId, forcedName || source.name),
          parent: parentId,
          modified: Date.now(),
        });
        delete copyNode.trashedFrom;
        delete copyNode.trashedAt;
        delete copyNode.hiddenInTrash;
        Mac.state.fs.push(copyNode);
        /* Depth-first, so a copied folder arrives with its contents. Duplicate
           used to clone the folder alone and leave the copy empty. */
        this.children(source.id).forEach(child => clone(child, copyNode.id));
        return copyNode;
      };

      const created = clone(node, targetId, name);
      Mac.save();
      return created;
    },

    /**
     * Resolve a POSIX path the way Go to Folder does.
     * Accepts ~, /, and a trailing slash; matching is case-insensitive.
     * @returns {string|null} the node id, or null
     */
    resolvePath(input) {
      let path = String(input || '').trim();
      if (!path) return null;
      if (path === '~' || path === '~/') return 'dir-home';
      let current;
      if (path.startsWith('~/')) { current = 'dir-home'; path = path.slice(2); }
      else if (path.startsWith('/')) { current = 'vol-hd'; path = path.slice(1); }
      else { current = 'dir-home'; }
      const parts = path.split('/').filter(Boolean);
      for (const part of parts) {
        if (part === '.') continue;
        if (part === '..') { current = this.node(current)?.parent || current; continue; }
        const match = this.children(current).find(child => child.name.toLowerCase() === part.toLowerCase());
        if (!match) return null;
        current = match.id;
      }
      return current;
    },

    /** The POSIX path of a node, for display and for Copy as Pathname. */
    posixPath(id) {
      const chain = this.path(id);
      if (!chain.length) return '';
      return `/${chain.slice(1).map(node => node.name).join('/')}` || '/';
    },

    /** Move to the Trash, remembering where it came from for Put Back. */
    trash(id) {
      const node = this.node(id);
      if (!node || node.system || node.home || node.kind === 'volume') return false;
      const descendants = this.descendants(id);
      node.trashedFrom = node.parent;
      node.parent = 'trash';
      node.trashedAt = Date.now();
      descendants.forEach(child => { child.hiddenInTrash = true; });
      Mac.save();
      return true;
    },

    putBack(id) {
      const node = this.node(id);
      if (!node || node.parent !== 'trash') return false;
      node.parent = node.trashedFrom && this.node(node.trashedFrom) ? node.trashedFrom : 'dir-documents';
      delete node.trashedFrom;
      delete node.trashedAt;
      this.descendants(id).forEach(child => { delete child.hiddenInTrash; });
      Mac.save();
      return true;
    },

    descendants(id) {
      const result = [];
      const walk = parent => this.children(parent).forEach(child => { result.push(child); walk(child.id); });
      walk(id);
      return result;
    },

    deleteForever(id) {
      const ids = new Set([id, ...this.descendants(id).map(node => node.id)]);
      Mac.state.fs = Mac.state.fs.filter(node => !ids.has(node.id));
      Mac.state.desktopItems = Mac.state.desktopItems.filter(item => !ids.has(item));
      Mac.save();
    },

    emptyTrash() {
      const top = this.children('trash');
      top.forEach(node => this.deleteForever(node.id));
      Mac.save();
      return top.length;
    },

    /** Recursive size for folders, direct size for files. */
    sizeOf(node) {
      if (!node) return 0;
      if (node.kind === 'file') return node.size || 0;
      return this.descendants(node.id).reduce((total, child) => total + (child.size || 0), 0);
    },
  };

  /* ------------------------------------------------------------------ Finder */

  const SIDEBAR = [
    { label: 'Favorites', items: [
      { id: 'recents', name: 'Recents', glyph: 'clock' },
      { id: 'dir-desktop', name: 'Desktop', glyph: 'display' },
      { id: 'dir-documents', name: 'Documents', glyph: 'document' },
      { id: 'dir-downloads', name: 'Downloads', glyph: 'download' },
      { id: 'dir-pictures', name: 'Pictures', glyph: 'photo' },
      { id: 'dir-music', name: 'Music', glyph: 'play' },
      { id: 'dir-movies', name: 'Movies', glyph: 'gallery' },
      { id: 'dir-home', name: Mac.PERSONA.shortName, glyph: 'person' },
      { id: 'applications', name: 'Applications', glyph: 'apps' },
    ] },
    { label: 'iCloud', items: [
      { id: 'icloud-drive', name: 'iCloud Drive', glyph: 'icloud' },
      { id: 'dir-public', name: 'Shared', glyph: 'people' },
    ] },
    { label: 'Locations', items: [
      { id: 'vol-hd', name: 'Macintosh HD', glyph: 'disk' },
      // vol-backup is spliced in here by sidebarGroups() while it is mounted.
      { id: 'network', name: 'Network', glyph: 'globe' },
      { id: 'trash', name: 'Trash', glyph: 'trash' },
    ] },
  ];

  const Finder = Mac.Finder = {
    /** Contents of a location id, honouring search and sort. */
    contents(win) {
      const location = win.state.location;
      let nodes;
      if (location === 'recents') nodes = FS.recents();
      else if (location === 'applications') {
        nodes = Mac.appList().filter(app => app.id !== 'trash').map(app => ({
          id: `app-${app.id}`, appId: app.id, name: app.title, kind: 'app', parent: 'applications',
          size: 42 * 1024 * 1024, modified: Date.now(),
        }));
      } else if (location === 'icloud-drive') {
        nodes = FS.children('dir-documents');
      } else if (location === 'network') nodes = [];
      else nodes = FS.children(location).filter(node => !node.hiddenInTrash);

      const query = (win.state.query || '').trim().toLowerCase();
      if (query) nodes = nodes.filter(node => node.name.toLowerCase().includes(query));

      const direction = win.state.sortDescending ? -1 : 1;
      const sorted = [...nodes].sort((a, b) => {
        if (win.state.sort === 'size') return (FS.sizeOf(a) - FS.sizeOf(b)) * direction;
        if (win.state.sort === 'date') return ((a.modified || 0) - (b.modified || 0)) * direction;
        if (win.state.sort === 'kind') return FS.kindLabel(a).localeCompare(FS.kindLabel(b)) * direction;
        const folderFirst = Number(FS.isFolder(b)) - Number(FS.isFolder(a));
        return folderFirst || a.name.localeCompare(b.name, undefined, { numeric: true }) * direction;
      });
      return sorted;
    },

    locationName(win) {
      const location = win.state.location;
      const named = { recents: 'Recents', applications: 'Applications', trash: 'Trash', network: 'Network', 'icloud-drive': 'iCloud Drive' };
      return named[location] || FS.node(location)?.name || 'Finder';
    },

    navigate(win, location, { record = true } = {}) {
      if (record && win.state.location !== location) {
        win.state.history = win.state.history.slice(0, win.state.historyIndex + 1);
        win.state.history.push(location);
        win.state.historyIndex = win.state.history.length - 1;
      }
      win.state.location = location;
      win.state.selected = null;
      win.state.query = '';
      Mac.wm.render(win);
    },

    go(win, delta) {
      const next = win.state.historyIndex + delta;
      if (next < 0 || next >= win.state.history.length) return;
      win.state.historyIndex = next;
      this.navigate(win, win.state.history[next], { record: false });
    },

    selected(win) {
      const id = win.state.selected;
      if (!id) return null;
      if (id.startsWith('app-')) return { id, name: Mac.apps[id.slice(4)]?.title, kind: 'app', appId: id.slice(4) };
      return FS.node(id);
    },

    open(win, id) {
      if (id.startsWith('app-')) { Mac.wm.open(id.slice(4)); return; }
      const node = FS.node(id);
      if (!node) return;
      if (FS.isFolder(node)) { this.navigate(win, node.id); return; }
      const opener = FS.openerFor(node);
      Mac.wm.open(opener, { newWindow: true, state: { fileId: node.id } });
    },

    /* ------------------------------------------------------------- rendering */

    render(win) {
      const nodes = this.contents(win);
      const name = this.locationName(win);
      const view = win.state.view;

      return `<div class="app-shell">
        ${win.state.sidebar ? this.sidebar(win) : ''}
        <section class="main-pane">
          ${this.pathBar(win)}
          <div class="finder-content" style="${view === 'column' ? 'padding:0;overflow:hidden' : ''}">
            ${nodes.length || view === 'column'
              ? this.body(win, nodes)
              : UI.empty(win.state.query ? 'No results' : `${name} is empty`,
                  win.state.query ? 'Try a different search term.'
                    : win.state.location === 'trash' ? 'Items you move to the Trash appear here.'
                    : 'Drag items here or create a new folder.',
                  { icon: win.state.location === 'trash' ? 'trash' : 'folder',
                    action: ['recents', 'applications', 'network', 'trash'].includes(win.state.location)
                      ? '' : '<button class="btn primary" data-command="finder-new-folder">New Folder</button>' })}
          </div>
          ${this.statusBar(win, nodes)}
        </section>
      </div>`;
    },

    /** Whether the external disk is currently plugged in. */
    volumeMounted(id) {
      const volume = Mac.state.volumes.find(entry => entry.id === id);
      return Boolean(volume) && volume.mounted !== false;
    },

    /* SIDEBAR is a constant; connected volumes are not, so they are spliced
       in at render time. Without this, mounting the backup disk in Disk
       Utility changed a flag and nothing else — Finder never showed it, so
       "plug the drive in and copy your files across" had no visible effect
       anywhere in the simulator. */
    sidebarGroups() {
      if (!this.volumeMounted('vol-backup')) return SIDEBAR;
      return SIDEBAR.map(section => {
        if (section.label !== 'Locations') return section;
        const items = [...section.items];
        items.splice(1, 0, { id: 'vol-backup', name: 'Time Machine Backup', glyph: 'volume-external', eject: true });
        return { label: section.label, items };
      });
    },

    sidebar(win) {
      return `<aside class="sidebar">${this.sidebarGroups().map(section =>
        `<div class="sidebar-heading">${esc(section.label)}</div>` +
        section.items.map(item => {
          const count = item.id === 'trash' ? FS.children('trash').length : 0;
          return `<button class="side-item ${win.state.location === item.id ? 'on' : ''}" data-finder-go="${item.id}">
            <span class="side-glyph">${glyph(item.glyph, { size: 15 })}</span>
            <span class="side-label">${esc(item.name)}</span>
            ${item.eject ? `<span class="side-count" role="button" tabindex="0" title="Eject ${esc(item.name)}"
              data-command="disk-eject" data-arg="${item.id}" aria-label="Eject ${esc(item.name)}">⏏</span>`
              : count ? `<span class="side-count">${count}</span>` : ''}</button>`;
        }).join('')).join('')}</aside>`;
    },

    pathBar(win) {
      const location = win.state.location;
      const chain = ['recents', 'applications', 'trash', 'network', 'icloud-drive'].includes(location)
        ? [{ id: location, name: this.locationName(win) }]
        : FS.path(location);

      return `<div class="finder-path">${chain.map((node, index) =>
        `${index ? `<span class="sep">${glyph('chevron', { size: 10 })}</span>` : ''}
         <button data-finder-go="${node.id}">${appIcon(FS.iconFor(FS.node(node.id) || node))}${esc(node.name)}</button>`).join('')}
        ${win.state.location === 'trash' && FS.children('trash').length
          ? `<span class="spacer"></span><button class="btn" data-command="empty-trash">Empty Trash</button>` : ''}</div>`;
    },

    body(win, nodes) {
      if (win.state.view === 'list') return this.listView(win, nodes);
      if (win.state.view === 'column') return this.columnView(win);
      if (win.state.view === 'gallery') return this.galleryView(win, nodes);
      return this.iconView(win, nodes);
    },

    iconView(win, nodes) {
      return `<div class="file-grid">${nodes.map(node =>
        `<button class="file-card ${win.state.selected === node.id ? 'selected' : ''}"
          data-file="${node.id}" data-win="${win.id}">
          ${appIcon(FS.iconFor(node))}<span>${esc(node.name)}</span></button>`).join('')}</div>`;
    },

    listView(win, nodes) {
      const header = (label, key) => `<th><button class="row-flex" data-finder-sort="${key}" style="color:inherit;font:inherit">
        ${esc(label)}${win.state.sort === key ? (win.state.sortDescending ? ' ▾' : ' ▴') : ''}</button></th>`;
      return `<table class="data-table file-table">
        <thead><tr>${header('Name', 'name')}${header('Date Modified', 'date')}${header('Size', 'size')}${header('Kind', 'kind')}</tr></thead>
        <tbody>${nodes.map(node => `<tr class="${win.state.selected === node.id ? 'selected' : ''}" data-file="${node.id}" data-win="${win.id}">
          <td class="name-cell">${appIcon(FS.iconFor(node))}${esc(node.name)}</td>
          <td>${node.modified ? new Date(node.modified).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '--'}</td>
          <td>${FS.isFolder(node) ? '--' : Mac.bytes(FS.sizeOf(node))}</td>
          <td>${esc(FS.kindLabel(node))}</td></tr>`).join('')}</tbody></table>`;
    },

    columnView(win) {
      const location = win.state.location;
      const chain = ['recents', 'applications', 'trash', 'network', 'icloud-drive'].includes(location)
        ? [location]
        : FS.path(location).map(node => node.id);

      const columns = chain.map(id => {
        const items = id === location ? this.contents(win) : FS.children(id).filter(node => !node.hiddenInTrash);
        const nextInChain = chain[chain.indexOf(id) + 1];
        return `<div class="finder-column">${items.map(node =>
          `<button class="finder-column-item ${node.id === nextInChain || node.id === win.state.selected ? 'selected' : ''}"
            data-file="${node.id}" data-win="${win.id}">
            ${appIcon(FS.iconFor(node))}<span>${esc(node.name)}</span>
            ${FS.isFolder(node) ? glyph('chevron', { size: 11 }) : ''}</button>`).join('')}</div>`;
      });

      const selected = this.selected(win);
      const preview = selected && !FS.isFolder(selected)
        ? `<div class="finder-preview">${appIcon(FS.iconFor(selected))}<h4>${esc(selected.name)}</h4>
            <dl><dt>Kind</dt><dd>${esc(FS.kindLabel(selected))}</dd>
              <dt>Size</dt><dd>${Mac.bytes(FS.sizeOf(selected))}</dd>
              <dt>Where</dt><dd>${esc(FS.pathString(selected.parent))}</dd>
              <dt>Modified</dt><dd>${selected.modified ? new Date(selected.modified).toLocaleDateString() : '--'}</dd></dl>
            <button class="btn wide" style="margin-top:12px" data-command="finder-open">Open</button></div>`
        : '';

      return `<div class="finder-columns">${columns.join('')}${preview}</div>`;
    },

    galleryView(win, nodes) {
      const selected = this.selected(win) || nodes[0];
      return `<div style="display:grid;grid-template-rows:1fr auto;height:100%;gap:12px">
        <div style="display:grid;place-items:center;min-height:0">
          ${selected ? `<div style="text-align:center">${appIcon(FS.iconFor(selected), 'app-icon')}
            <div style="width:140px;height:140px;margin:0 auto">${appIcon(FS.iconFor(selected))}</div>
            <strong style="display:block;margin-top:10px">${esc(selected.name)}</strong>
            <small class="muted">${esc(FS.kindLabel(selected))} — ${Mac.bytes(FS.sizeOf(selected))}</small></div>`
            : '<p class="muted">Nothing to preview</p>'}
        </div>
        <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px">
          ${nodes.map(node => `<button class="file-card ${win.state.selected === node.id ? 'selected' : ''}"
            style="min-width:78px" data-file="${node.id}" data-win="${win.id}">
            ${appIcon(FS.iconFor(node))}<span>${esc(node.name)}</span></button>`).join('')}
        </div></div>`;
    },

    statusBar(win, nodes) {
      const volume = Mac.state.volumes[0];
      const free = volume.totalBytes - volume.usedBytes;
      const selected = this.selected(win);
      return `<div class="finder-status">
        <span>${Mac.plural(nodes.length, 'item')}${selected ? `, 1 selected` : ''}</span>
        <span>${Mac.bytes(free)} available</span></div>`;
    },

    /* ---------------------------------------------------------- operations */

    newFolder(win) {
      const blocked = ['recents', 'applications', 'network', 'trash', 'icloud-drive'];
      if (blocked.includes(win.state.location)) {
        Mac.Notify.show('Finder', 'Create folders in Desktop, Documents, Downloads or Shared.', { app: 'finder', transient: true });
        return;
      }
      const node = FS.createFolder(win.state.location);
      win.state.selected = node.id;
      Mac.wm.refresh('finder');
      Mac.Shell.renderDesktop();
      Mac.Notify.show('Finder', `“${node.name}” was created.`, { app: 'finder', transient: true });
    },

    async rename(win) {
      const node = this.selected(win);
      if (!node || node.kind === 'app') { this.requireSelection(); return; }
      const name = await Mac.Dialog.prompt({
        title: 'Rename item',
        label: 'Name',
        value: node.name,
        confirmLabel: 'Rename',
        validate: text => {
          if (!text) return 'The name cannot be blank.';
          const clash = FS.children(node.parent).some(sibling =>
            sibling.id !== node.id && sibling.name.toLowerCase() === text.toLowerCase());
          return clash ? 'An item with that name already exists.' : '';
        },
      });
      if (!name) return;
      FS.rename(node.id, name);
      Mac.wm.refresh('finder');
      Mac.Shell.renderDesktop();
    },

    trash(win) {
      const node = this.selected(win);
      if (!node) { this.requireSelection(); return; }
      if (node.kind === 'app') {
        Mac.Notify.show('Finder', 'Remove apps from the App Store pane instead.', { app: 'finder', transient: true });
        return;
      }
      if (node.parent === 'trash') { this.deleteForever(win); return; }
      if (!FS.trash(node.id)) {
        Mac.Notify.show('Finder', `“${node.name}” is required by macOS and cannot be moved.`, { app: 'finder' });
        return;
      }
      win.state.selected = null;
      Mac.wm.refresh('finder');
      Mac.Shell.renderDock();
      Mac.Shell.renderDesktop();
      Mac.Notify.show('Finder', `“${node.name}” was moved to the Trash.`, { app: 'finder', transient: true });
    },

    putBack(win) {
      const node = this.selected(win);
      if (!node || node.parent !== 'trash') {
        Mac.Notify.show('Finder', 'Select an item in the Trash first.', { app: 'finder', transient: true });
        return;
      }
      const from = FS.pathString(node.trashedFrom);
      FS.putBack(node.id);
      win.state.selected = null;
      Mac.wm.refresh('finder');
      Mac.Shell.renderDock();
      Mac.Notify.show('Finder', `“${node.name}” was put back to ${from || 'Documents'}.`, { app: 'finder', transient: true });
    },

    async deleteForever(win) {
      const node = this.selected(win);
      if (!node) { this.requireSelection(); return; }
      const confirmed = await Mac.Dialog.confirm({
        title: `Delete “${node.name}” immediately?`,
        body: 'This item will be deleted immediately. You cannot undo this action.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!confirmed) return;
      FS.deleteForever(node.id);
      win.state.selected = null;
      Mac.wm.refresh('finder');
      Mac.Shell.renderDock();
      Mac.Shell.renderDesktop();
    },

    async emptyTrash() {
      const count = FS.children('trash').length;
      if (!count) {
        Mac.Notify.show('Finder', 'The Trash is already empty.', { app: 'finder', transient: true });
        return;
      }
      const confirmed = await Mac.Dialog.confirm({
        title: 'Are you sure you want to permanently erase the items in the Trash?',
        body: `${Mac.plural(count, 'item')} will be removed. You can’t undo this action.`,
        confirmLabel: 'Empty Trash',
        danger: true,
        icon: 'trash',
      });
      if (!confirmed) return;
      FS.emptyTrash();
      Mac.wm.refresh('finder');
      Mac.Shell.renderDock();
      Mac.Shell.renderDesktop();
      Mac.Notify.show('Finder', 'The Trash was emptied.', { app: 'finder', transient: true });
    },

    getInfo(win) {
      const node = this.selected(win);
      if (!node) { this.requireSelection(); return; }
      const isApp = node.kind === 'app';
      Mac.Dialog.open({
        title: node.name,
        icon: { app: isApp ? Mac.apps[node.appId].icon : FS.iconFor(node) },
        body: UI.group(
          UI.info('Kind', isApp ? 'Application' : FS.kindLabel(node)),
          UI.info('Size', isApp ? '42 MB' : Mac.bytes(FS.sizeOf(node))),
          UI.info('Where', isApp ? 'Macintosh HD › Applications' : FS.pathString(node.parent)),
          UI.info('Created', node.modified ? new Date(node.modified - 864e5 * 12).toLocaleString() : '--'),
          UI.info('Modified', node.modified ? new Date(node.modified).toLocaleString() : '--'),
          node.parent === 'trash' ? UI.info('Original location', FS.pathString(node.trashedFrom)) : '',
        ) + UI.group(
          UI.info('Locked', 'No'),
          UI.info('Shared folder', node.id === 'dir-public' ? 'Yes' : 'No'),
        ),
        buttons: [{ label: 'Done', primary: true }],
      });
    },

    requireSelection() {
      Mac.Notify.show('Finder', 'Select an item first.', { app: 'finder', transient: true });
    },

    /** Contextual menu items for a file or the background. */
    contextItems(win, nodeId) {
      if (nodeId) {
        const node = nodeId.startsWith('app-') ? null : FS.node(nodeId);
        const inTrash = node?.parent === 'trash';
        return [
          { label: 'Open', command: 'finder-open' },
          { label: 'Get Info', command: 'finder-info' },
          'sep',
          { label: 'Rename', command: 'finder-rename', disabled: !node },
          { label: 'Duplicate', command: 'finder-duplicate', disabled: !node },
          'sep',
          { label: 'Copy', command: 'finder-copy', disabled: !node },
          { label: 'Cut', command: 'finder-cut', disabled: !node },
          { label: 'Move To…', command: 'finder-move-to', disabled: !node },
          { label: 'Copy To…', command: 'finder-copy-to', disabled: !node },
          'sep',
          inTrash
            ? { label: 'Put Back', command: 'finder-put-back' }
            : { label: 'Move to Trash', command: 'finder-trash', disabled: !node },
          inTrash ? { label: 'Delete Immediately…', command: 'finder-delete' } : 'sep',
        ].filter(Boolean);
      }
      return [
        { label: 'New Folder', command: 'finder-new-folder' },
        { label: 'New Text Document', command: 'finder-new-file' },
        { label: 'Paste Item', command: 'finder-paste', disabled: !this.clipboard },
        'sep',
        { label: 'Go to Folder…', command: 'finder-go-folder' },
        { label: 'Get Info', command: 'finder-info' },
        { label: 'Change Wallpaper…', command: 'open-setting', arg: 'Wallpaper' },
        'sep',
        { label: 'Show View Options', command: 'finder-view-options' },
      ];
    },

    duplicate(win) {
      const node = this.selected(win);
      if (!node || node.kind === 'app') { this.requireSelection(); return; }
      const dot = node.name.lastIndexOf('.');
      const copyName = dot > 0
        ? `${node.name.slice(0, dot)} copy${node.name.slice(dot)}`
        : `${node.name} copy`;
      /* Through FS.copy so a duplicated folder arrives with its contents.
         This used to clone the folder node alone, which produced an empty
         copy that looked right in the list and was wrong the moment you
         opened it. */
      const clone = FS.copy(node.id, node.parent, { name: copyName });
      if (typeof clone === 'string') { Mac.Dialog.info('Cannot duplicate', clone, 'warning'); return; }
      win.state.selected = clone.id;
      Mac.wm.refresh('finder');
      Mac.Shell.renderDesktop();
    },

    /* ------------------------------------------------------- move and copy */

    /* One clipboard for the whole simulator, like the real one. `cut` marks
       the item for a move; the pasteboard is not cleared until it lands, so
       Paste can be pressed in the wrong window and corrected. */
    clipboard: null,

    copyToClipboard(win, { cut = false } = {}) {
      const node = this.selected(win);
      if (!node || node.kind === 'app') { this.requireSelection(); return; }
      this.clipboard = { id: node.id, cut };
      Mac.Notify.show('Finder', `${cut ? 'Cut' : 'Copied'} “${node.name}”.`,
        { app: 'finder', transient: true, duration: 1600 });
    },

    paste(win) {
      const target = win.state.location;
      if (!this.clipboard) {
        Mac.Notify.show('Finder', 'The Clipboard is empty.', { app: 'finder', transient: true });
        return;
      }
      if (!FS.isFolder(FS.node(target))) {
        Mac.Dialog.info('Cannot paste here', 'Open a folder first — Recents, Applications and Network are not real locations.', 'warning');
        return;
      }
      const { id, cut } = this.clipboard;
      const result = cut ? FS.move(id, target) : FS.copy(id, target);
      if (typeof result === 'string') { Mac.Dialog.info(cut ? 'Cannot move' : 'Cannot copy', result, 'warning'); return; }
      if (cut) this.clipboard = null;
      win.state.selected = cut ? id : result.id;
      Mac.wm.refreshAll();
      Mac.Shell.renderDesktop();
    },

    /**
     * Move or copy the selection into a folder chosen from a list.
     *
     * There is no drag-and-drop here, so this is the equivalent of the real
     * "Move to…" — and it is arguably better for a training tool, because
     * the destination is named out loud rather than aimed at.
     */
    transferTo(win, mode) {
      const node = this.selected(win);
      if (!node || node.kind === 'app') { this.requireSelection(); return; }
      const folders = Mac.state.fs
        .filter(entry => FS.isFolder(entry) && entry.id !== node.id && entry.parent !== 'trash')
        .filter(entry => !FS.descendants(node.id).some(child => child.id === entry.id))
        .sort((a, b) => FS.posixPath(a.id).localeCompare(FS.posixPath(b.id)));

      Mac.Dialog.open({
        title: `${mode === 'move' ? 'Move' : 'Copy'} “${node.name}” to…`,
        icon: 'folder',
        body: `<div class="dialog-field"><label for="finder-dest">Destination</label>
          <select id="finder-dest">${folders.map(folder =>
            `<option value="${esc(folder.id)}" ${folder.id === node.parent ? 'disabled' : ''}>${esc(FS.posixPath(folder.id) || '/')}</option>`).join('')}</select></div>`,
        buttons: [
          { label: 'Cancel' },
          {
            label: mode === 'move' ? 'Move' : 'Copy',
            primary: true,
            action: () => {
              const target = document.getElementById('finder-dest').value;
              const result = mode === 'move' ? FS.move(node.id, target) : FS.copy(node.id, target);
              if (typeof result === 'string') { Mac.Dialog.info(`Cannot ${mode}`, result, 'warning'); return; }
              // Follow the item, so it is obvious where it went.
              this.navigate(win, target);
              win.state.selected = mode === 'move' ? node.id : result.id;
              Mac.wm.refreshAll();
              Mac.Shell.renderDesktop();
              Mac.Notify.show('Finder',
                `“${node.name}” ${mode === 'move' ? 'moved' : 'copied'} to “${FS.node(target).name}”.`,
                { app: 'finder', transient: true, duration: 1800 });
            },
          },
        ],
      });
    },

    /**
     * Eject a removable volume.
     *
     * The interesting part is not the flag, it is the windows: a Finder
     * window sitting inside a disk that has just been pulled has to go
     * somewhere, and macOS sends it home. Leaving them pointed at an
     * unreachable location is how you get a list that renders empty and
     * looks like data loss.
     */
    eject(volumeId) {
      const volume = Mac.state.volumes.find(entry => entry.id === volumeId);
      if (!volume) return;
      if (volume.kind !== 'external') {
        Mac.Dialog.info('The startup volume cannot be ejected',
          'Restart in Recovery to work on Macintosh HD.', 'warning');
        return;
      }
      volume.mounted = false;
      Mac.save();
      const stranded = FS.descendants(volumeId).map(node => node.id).concat(volumeId);
      Mac.wm.windows.forEach(win => {
        if (win.appId !== 'finder') return;
        if (stranded.includes(win.state.location)) this.navigate(win, 'dir-home');
        win.state.history = win.state.history.filter(entry => !stranded.includes(entry));
        win.state.historyIndex = Math.min(win.state.historyIndex, win.state.history.length - 1);
      });
      Mac.wm.refreshAll();
      Mac.Notify.show('Finder', `“${volume.name}” has been ejected. It is now safe to disconnect it.`,
        { app: 'finder' });
    },

    mount(volumeId) {
      const volume = Mac.state.volumes.find(entry => entry.id === volumeId);
      if (!volume) return;
      volume.mounted = true;
      Mac.save();
      Mac.wm.refreshAll();
      Mac.Notify.show('Finder', `“${volume.name}” is now available in the Finder sidebar.`, { app: 'finder' });
    },

    /** Go to Folder (⇧⌘G) — the fastest way to reach a path over the phone. */
    goToFolder(win) {
      Mac.Dialog.open({
        title: 'Go to Folder',
        icon: 'folder',
        body: `<p style="margin:0 0 8px;font-size:12.5px;color:var(--text-2)">Type a path, for example <code>~/Documents</code> or <code>/Applications</code>.</p>
          <div class="dialog-field"><label for="finder-path">Path</label>
            <input id="finder-path" value="~/" spellcheck="false" autocapitalize="off"></div>
          <p id="finder-path-error" style="margin:8px 0 0;font-size:12px;color:var(--red)"></p>`,
        buttons: [
          { label: 'Cancel' },
          {
            label: 'Go',
            primary: true,
            close: false,
            action: () => {
              const value = document.getElementById('finder-path').value;
              const id = FS.resolvePath(value);
              if (!id) {
                document.getElementById('finder-path-error').textContent = `The folder “${value}” can’t be found.`;
                return;
              }
              if (!FS.isFolder(FS.node(id))) {
                document.getElementById('finder-path-error').textContent = `“${value}” is a file, not a folder.`;
                return;
              }
              Mac.Dialog.close();
              const target = win?.appId === 'finder' ? win : Mac.wm.open('finder');
              this.navigate(target, id);
            },
          },
        ],
        onMount: () => setTimeout(() => {
          const field = document.getElementById('finder-path');
          field?.focus();
          field?.setSelectionRange(field.value.length, field.value.length);
        }, 30),
      });
    },
  };

  /* -------------------------------------------------------------- app defs */

  Mac.registerApp({
    id: 'finder',
    title: 'Finder',
    icon: 'finder',
    category: 'System',
    blurb: 'Browse files, folders, connected volumes and the Trash.',
    size: [900, 580],
    min: [420, 300],
    initialState: () => ({
      location: 'recents',
      view: 'icon',
      sort: 'name',
      sortDescending: false,
      sidebar: true,
      selected: null,
      query: '',
      history: ['recents'],
      historyIndex: 0,
    }),
    titleFor: win => Finder.locationName(win),

    toolbar(win) {
      const views = [['icon', 'grid'], ['list', 'list'], ['column', 'columns'], ['gallery', 'gallery']];
      return `<div class="segmented" role="group" aria-label="View">${views.map(([id, icon]) =>
          `<button class="${win.state.view === id ? 'on' : ''}" data-finder-view="${id}" aria-label="${id} view">${glyph(icon)}</button>`).join('')}</div>
        <button class="tool-btn" data-command="finder-actions" aria-label="Actions">${glyph('ellipsis')}</button>
        <button class="tool-btn" data-command="finder-new-folder" aria-label="New folder">${glyph('plus')}</button>
        <div class="search" data-search-host><span>${glyph('search')}</span>
          <input data-finder-search value="${esc(win.state.query)}" placeholder="Search" aria-label="Search this folder"></div>`;
    },

    /* Sidebar toggle and history live to the left of the title, as in Finder. */
    leading: win => `<button class="tool-btn" data-command="toggle-sidebar" aria-label="Toggle sidebar">${glyph('sidebar')}</button>
      <button class="tool-btn" data-command="finder-back" ${win.state.historyIndex <= 0 ? 'disabled' : ''} aria-label="Back">${glyph('back')}</button>
      <button class="tool-btn" data-command="finder-forward" ${win.state.historyIndex >= win.state.history.length - 1 ? 'disabled' : ''} aria-label="Forward">${glyph('forward')}</button>`,

    menus(win) {
      return {
        File: [
          { label: 'New Folder', command: 'finder-new-folder', shortcut: '⇧⌘N' },
          { label: 'New Text Document', command: 'finder-new-file' },
          { label: 'Get Info', command: 'finder-info', shortcut: '⌘I' },
          { label: 'Duplicate', command: 'finder-duplicate', shortcut: '⌘D' },
          { label: 'Move to Trash', command: 'finder-trash', shortcut: '⌘⌫' },
          { label: 'Empty Trash…', command: 'empty-trash', shortcut: '⇧⌘⌫' },
        ],
        Edit: [
          { label: 'Cut', command: 'finder-cut', shortcut: '⌘X' },
          { label: 'Copy', command: 'finder-copy', shortcut: '⌘C' },
          { label: 'Paste Item', command: 'finder-paste', shortcut: '⌘V' },
          'sep',
          { label: 'Move To…', command: 'finder-move-to' },
          { label: 'Copy To…', command: 'finder-copy-to' },
        ],
        View: [
          { label: 'as Icons', command: 'finder-view', arg: 'icon', checked: win?.state.view === 'icon' },
          { label: 'as List', command: 'finder-view', arg: 'list', checked: win?.state.view === 'list' },
          { label: 'as Columns', command: 'finder-view', arg: 'column', checked: win?.state.view === 'column' },
          { label: 'as Gallery', command: 'finder-view', arg: 'gallery', checked: win?.state.view === 'gallery' },
        ],
        Go: [
          { label: 'Recents', command: 'finder-go', arg: 'recents' },
          { label: 'Documents', command: 'finder-go', arg: 'dir-documents' },
          { label: 'Downloads', command: 'finder-go', arg: 'dir-downloads' },
          { label: 'Applications', command: 'finder-go', arg: 'applications' },
          { label: 'Trash', command: 'finder-go', arg: 'trash' },
          'sep',
          { label: 'Go to Folder…', command: 'finder-go-folder', shortcut: '⇧⌘G' },
          ...(Finder.volumeMounted('vol-backup')
            ? [{ label: 'Eject “Time Machine Backup”', command: 'disk-eject', arg: 'vol-backup', shortcut: '⌘E' }]
            : [{ label: 'Connect Time Machine Backup', command: 'disk-mount', arg: 'vol-backup' }]),
        ],
      };
    },

    render: win => Finder.render(win),
  });

  /* The Trash is a Finder window pinned to the trash location. */
  Mac.registerApp({
    id: 'trash',
    title: 'Trash',
    icon: 'trash',
    category: 'System',
    hidden: true,
    launch: () => Mac.wm.open('finder', { state: { location: 'trash', selected: null } }),
  });

  Mac.registerApp({
    id: 'launchpad',
    title: 'Launchpad',
    icon: 'launchpad',
    category: 'System',
    launch: () => Mac.Shell.openLaunchpad(),
  });
}(window.Mac));
