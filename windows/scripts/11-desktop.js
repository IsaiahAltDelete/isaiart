/* ===========================================================================
   Desktop icons, desktop context menu and global keyboard shortcuts.

   Desktop icons are the Recycle Bin and Edge shortcut plus the contents of
   the user's Desktop folder. Positions are grid cells saved per item.
   =========================================================================== */

(function (Win) {
  'use strict';

  const SIZES = { large: { w: 100, h: 120, icon: 64 }, medium: { w: 76, h: 96, icon: 48 }, small: { w: 76, h: 30, icon: 16 } };
  const S = () => Win.state.settings;
  const D = () => Win.state.desktop;
  const host = () => Win.$('#desktop-icons');

  let selection = new Set();
  let anchor = null;

  const sysItems = () => [
    { id: 'sys-bin', name: 'Recycle Bin', icon: Win.FS.children('bin', { hidden: true }).length ? 'recyclefull' : 'recycle', sys: true, open: () => Win.wm.open('explorer', { path: 'bin' }) },
    { id: 'sys-edge', name: 'Microsoft Edge', icon: 'edge', sys: true, shortcut: true, open: () => Win.wm.open('edge') },
  ];

  function items() {
    const files = Win.FS.children('desktop').map(n => ({ id: n.id, name: Win.FS.display(n), node: n }));
    const sort = D().sort;
    files.sort((a, b) => {
      if (sort === 'size') return Win.FS.size(b.id) - Win.FS.size(a.id);
      if (sort === 'type') return Win.FS.typeName(a.node).localeCompare(Win.FS.typeName(b.node)) || a.name.localeCompare(b.name);
      if (sort === 'date') return (b.node.modified || 0) - (a.node.modified || 0);
      return (a.node.kind === 'folder' ? 0 : 1) - (b.node.kind === 'folder' ? 0 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return [...sysItems(), ...files];
  }

  function grid() {
    const size = SIZES[S().iconSize] || SIZES.medium;
    const rows = Math.max(1, Math.floor((innerHeight - 48 - 8) / size.h));
    return { ...size, rows };
  }

  /** Assign each item a free cell, keeping saved positions where possible. */
  function layout(list) {
    const g = grid();
    const taken = new Set();
    const pos = D().positions;
    const out = [];
    list.forEach(item => {
      const p = pos[item.id];
      if (p && p.r < g.rows && !taken.has(`${p.c},${p.r}`)) { taken.add(`${p.c},${p.r}`); out.push({ item, c: p.c, r: p.r }); }
      else out.push({ item, c: -1, r: -1 });
    });
    let c = 0;
    let r = 0;
    out.forEach(o => {
      if (o.c >= 0) return;
      while (taken.has(`${c},${r}`)) { r += 1; if (r >= g.rows) { r = 0; c += 1; } }
      o.c = c; o.r = r;
      taken.add(`${c},${r}`);
    });
    return out;
  }

  function render() {
    const el = host();
    if (!el) return;
    if (!S().desktopIcons) { el.innerHTML = ''; return; }
    const g = grid();
    const cut = Win.state.clipboard?.op === 'cut' ? new Set(Win.state.clipboard.ids) : new Set();
    const placed = layout(items());
    const alive = new Set(placed.map(p => p.item.id));
    selection = new Set([...selection].filter(id => alive.has(id)));
    el.className = `size-${S().iconSize}`;
    el.innerHTML = placed.map(({ item, c, r }) => {
      const icon = item.sys ? Win.appIcon(item.icon, g.icon) : Win.fileIcon(item.node, g.icon);
      const shortcut = item.shortcut || item.node?.kind === 'shortcut';
      return `<div class="dk-icon ${selection.has(item.id) ? 'sel' : ''} ${cut.has(item.id) ? 'cut' : ''}" role="option" tabindex="-1" aria-selected="${selection.has(item.id)}"
        data-id="${item.id}" style="left:${4 + c * g.w}px;top:${4 + r * g.h}px;width:${g.w}px" title="${Win.esc(item.node ? `${Win.FS.typeName(item.node)}\n${item.node.kind === 'file' ? `Size: ${Win.bytes(Win.FS.size(item.id))}\n` : ''}Date modified: ${Win.formatDateTime(item.node.modified || Date.now())}` : item.name)}">
        <span class="dk-img">${icon}${shortcut ? '<i class="dk-arrow"></i>' : ''}</span><span class="dk-label">${Win.esc(item.name)}</span></div>`;
    }).join('');
  }

  const node = id => Win.FS.get(id);
  const selected = () => [...selection].filter(id => !id.startsWith('sys-'));

  function open(id) {
    const sys = sysItems().find(s => s.id === id);
    if (sys) { sys.open(); return; }
    Win.openFile ? Win.openFile(id) : Win.wm.open('explorer', { path: id });
  }

  function select(id, { add = false, range = false } = {}) {
    if (range && anchor) {
      const ids = layout(items()).sort((a, b) => a.c - b.c || a.r - b.r).map(p => p.item.id);
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
      selection = new Set(ids.slice(a, b + 1));
    } else if (add) {
      selection.has(id) ? selection.delete(id) : selection.add(id);
      anchor = id;
    } else {
      selection = new Set([id]);
      anchor = id;
    }
    Win.$$('.dk-icon', host()).forEach(i => { const on = selection.has(i.dataset.id); i.classList.toggle('sel', on); i.setAttribute('aria-selected', on); });
  }

  function clearSelection() { selection.clear(); Win.$$('.dk-icon.sel', host()).forEach(i => { i.classList.remove('sel'); i.setAttribute('aria-selected', 'false'); }); }

  /* -------------------------------------------------------- inline rename */

  function rename(id) {
    const iconEl = Win.$(`.dk-icon[data-id="${CSS.escape(id)}"]`, host());
    const n = node(id);
    if (!iconEl || !n) return;
    const label = iconEl.querySelector('.dk-label');
    const box = Win.html(`<textarea class="dk-rename" spellcheck="false" aria-label="Rename"></textarea>`);
    box.value = n.name;
    label.replaceWith(box);
    box.focus();
    const dot = n.kind === 'file' ? n.name.lastIndexOf('.') : -1;
    box.setSelectionRange(0, dot > 0 && !S().fileExtensions ? dot : dot > 0 ? dot : n.name.length);
    let done = false;
    const commit = async keep => {
      if (done) return;
      done = true;
      const value = box.value.replace(/\n/g, '').trim();
      if (keep && value && value !== n.name) {
        const problem = Win.FS.rename(id, value);
        if (problem) await Win.alert('Rename', problem);
      }
      render();
    };
    box.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    box.addEventListener('blur', () => commit(true));
    box.addEventListener('pointerdown', e => e.stopPropagation());
  }

  /* -------------------------------------------------------------- actions */

  function newItem(kind) {
    const created = kind === 'folder'
      ? Win.FS.create('desktop', 'New folder', 'folder')
      : Win.FS.create('desktop', 'New Text Document.txt', 'file', { content: '' });
    selection = new Set([created.id]);
    render();
    rename(created.id);
  }

  function remove(ids, permanent = false) {
    if (!ids.length) return;
    if (permanent) {
      Win.confirm(ids.length > 1 ? 'Delete Multiple Items' : 'Delete File', ids.length > 1 ? `Are you sure you want to permanently delete these ${ids.length} items?` : `Are you sure you want to permanently delete this file?\n\n${node(ids[0])?.name}`)
        .then(ok => ok && ids.forEach(id => Win.FS.purge(id)));
      return;
    }
    ids.forEach(id => Win.FS.remove(id));
  }

  function paste() {
    const clip = Win.state.clipboard;
    if (!clip?.ids?.length) return;
    clip.ids.forEach(id => {
      if (!node(id)) return;
      if (clip.op === 'cut') Win.FS.move(id, 'desktop');
      else Win.FS.copy(id, 'desktop');
    });
    if (clip.op === 'cut') Win.state.clipboard = null;
    Win.save('fs');
  }

  function properties(id) {
    if (Win.Explorer?.properties) { Win.Explorer.properties(id); return; }
    const n = node(id);
    if (!n) return;
    Win.dialog({
      title: `${n.name} Properties`,
      body: `<div class="props-grid"><span>Type:</span><span>${Win.esc(Win.FS.typeName(n))}</span><span>Location:</span><span>${Win.esc(Win.FS.path(n.parent))}</span>
        <span>Size:</span><span>${Win.esc(Win.bytes(Win.FS.size(id)))}</span><span>Modified:</span><span>${Win.esc(Win.formatDateTime(n.modified || Date.now()))}</span></div>`,
    });
  }

  function iconMenu(e, id) {
    if (!selection.has(id)) select(id);
    const ids = selected();
    if (id === 'sys-bin') {
      const empty = !Win.FS.children('bin', { hidden: true }).length;
      Win.menu(e.clientX, e.clientY, [
        { label: 'Open', glyph: 'open', action: () => open(id) },
        { label: 'Empty Recycle Bin', glyph: 'trash', disabled: empty, action: () => Win.confirm('Delete Multiple Items', 'Are you sure you want to permanently delete all of the items in the Recycle Bin?').then(ok => ok && Win.FS.emptyBin()) },
        { divider: true },
        { label: 'Pin to Start', glyph: 'pin', disabled: true },
      ]);
      return;
    }
    if (id === 'sys-edge') {
      Win.menu(e.clientX, e.clientY, [
        { label: 'Open', glyph: 'open', action: () => open(id) },
        { label: 'Open in InPrivate window', glyph: 'eye', action: () => Win.wm.open('edge', { inprivate: true }) },
      ], { quick: [{ label: 'Delete', glyph: 'trash', disabled: true }] });
      return;
    }
    const n = node(id);
    const isFolder = Win.FS.isFolder(n);
    Win.menu(e.clientX, e.clientY, [
      { label: 'Open', glyph: 'open', action: () => ids.forEach(open) },
      isFolder ? { label: 'Open in new window', glyph: 'open', action: () => Win.wm.open('explorer', { path: id }) } : null,
      !isFolder && n.content != null ? { label: 'Edit in Notepad', glyph: 'edit', action: () => Win.wm.open('notepad', { fileId: id }) } : null,
      { divider: true },
      { label: 'Compress to ZIP file', glyph: 'file', action: () => { Win.FS.create('desktop', `${n.name.replace(/\.[^.]+$/, '')}.zip`, 'file', { size: Math.round(Win.FS.size(id) * 0.6) + 22 }); } },
      { label: 'Copy as path', glyph: 'copy', shortcut: 'Ctrl+Shift+C', action: () => { Win.state.clipboard = { text: `"${Win.FS.path(id)}"` }; navigator.clipboard?.writeText(`"${Win.FS.path(id)}"`).catch(() => {}); } },
      { label: 'Properties', glyph: 'details', shortcut: 'Alt+Enter', action: () => properties(id) },
      { divider: true },
      { label: 'Open in Terminal', glyph: 'terminal', disabled: !isFolder, action: () => Win.wm.open('terminal', { cwd: id }) },
    ].filter(Boolean), {
      quick: [
        { label: 'Cut', glyph: 'cut', action: () => { Win.state.clipboard = { op: 'cut', ids }; Win.save(); } },
        { label: 'Copy', glyph: 'copy', action: () => { Win.state.clipboard = { op: 'copy', ids }; Win.save(); } },
        { label: 'Rename', glyph: 'rename', action: () => rename(id) },
        { label: 'Share', glyph: 'share', action: () => Win.toast({ app: 'Nearby sharing', glyph: 'share', title: 'Nearby sharing is off', body: 'Turn it on in Settings to share with nearby devices.', transient: true }) },
        { label: 'Delete', glyph: 'trash', action: () => remove(ids) },
      ],
    });
  }

  function desktopMenu(e) {
    clearSelection();
    const size = S().iconSize;
    const sort = D().sort;
    const canPaste = !!Win.state.clipboard?.ids?.length;
    Win.menu(e.clientX, e.clientY, [
      { label: 'View', glyph: 'view', submenu: [
        { label: 'Large icons', checked: size === 'large', radio: true, action: () => { S().iconSize = 'large'; Win.save(); } },
        { label: 'Medium icons', checked: size === 'medium', radio: true, action: () => { S().iconSize = 'medium'; Win.save(); } },
        { label: 'Small icons', checked: size === 'small', radio: true, action: () => { S().iconSize = 'small'; Win.save(); } },
        { divider: true },
        { label: 'Auto arrange icons', action: () => { D().positions = {}; Win.save(); } },
        { label: 'Show desktop icons', checked: S().desktopIcons, action: () => { S().desktopIcons = !S().desktopIcons; Win.save(); } },
      ] },
      { label: 'Sort by', glyph: 'sort', submenu: [['name', 'Name'], ['size', 'Size'], ['type', 'Item type'], ['date', 'Date modified']].map(([v, l]) => ({
        label: l, checked: sort === v, radio: true, action: () => { D().sort = v; D().positions = {}; Win.save(); },
      })) },
      { label: 'Refresh', glyph: 'refresh', action: () => { host().style.opacity = '0'; setTimeout(() => { render(); host().style.opacity = ''; }, 120); } },
      { divider: true },
      { label: 'Paste', glyph: 'paste', shortcut: 'Ctrl+V', disabled: !canPaste, action: paste },
      { label: 'New', glyph: 'plus', submenu: [
        { label: 'Folder', icon: Win.appIcon('folder', 16), action: () => newItem('folder') },
        { label: 'Text Document', icon: Win.appIcon('txt', 16), action: () => newItem('file') },
      ] },
      { divider: true },
      { label: 'Display settings', glyph: 'display', action: () => Win.wm.open('settings', { page: 'display' }) },
      { label: 'Personalize', glyph: 'palette', action: () => Win.wm.open('settings', { page: 'personalization' }) },
      { divider: true },
      { label: 'Open in Terminal', glyph: 'terminal', action: () => Win.wm.open('terminal', { cwd: 'desktop' }) },
    ]);
  }

  /* ------------------------------------------------------- pointer wiring */

  function wire() {
    const el = host();
    const desk = Win.$('#desktop');

    el.addEventListener('dblclick', e => {
      const icon = e.target.closest('.dk-icon');
      if (icon && !e.target.closest('.dk-rename')) open(icon.dataset.id);
    });

    desk.addEventListener('contextmenu', e => {
      if (e.target.closest('.win')) return;
      e.preventDefault();
      const icon = e.target.closest('.dk-icon');
      if (icon) iconMenu(e, icon.dataset.id);
      else desktopMenu(e);
    });

    desk.addEventListener('pointerdown', e => {
      if (e.target.closest('.win, .dk-rename') || e.button !== 0) return;
      Win.Flyout.close();
      Win.wm.blurAll();
      const icon = e.target.closest('.dk-icon');
      if (icon) {
        const id = icon.dataset.id;
        if (e.ctrlKey || e.metaKey) select(id, { add: true });
        else if (e.shiftKey) select(id, { range: true });
        else if (!selection.has(id)) select(id);
        dragIcons(e, icon);
        return;
      }
      if (!e.ctrlKey) clearSelection();
      marquee(e);
    });
  }

  function marquee(start) {
    const box = Win.$('#marquee');
    const base = new Set(selection);
    const sx = start.clientX;
    const sy = start.clientY;
    const move = e => {
      const x = Math.min(sx, e.clientX);
      const y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx);
      const h = Math.abs(e.clientY - sy);
      if (w + h < 4) return;
      box.classList.remove('hidden');
      Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      selection = new Set(base);
      Win.$$('.dk-icon', host()).forEach(i => {
        const r = i.querySelector('.dk-img').getBoundingClientRect();
        const hit = r.right > x && r.left < x + w && r.bottom > y && r.top < y + h;
        if (hit) selection.add(i.dataset.id);
        i.classList.toggle('sel', selection.has(i.dataset.id));
      });
    };
    const up = () => {
      box.classList.add('hidden');
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }

  function dragIcons(start, iconEl) {
    const g = grid();
    const moving = [...selection].map(id => Win.$(`.dk-icon[data-id="${CSS.escape(id)}"]`, host())).filter(Boolean);
    const origins = moving.map(m => ({ el: m, x: parseFloat(m.style.left), y: parseFloat(m.style.top) }));
    let moved = false;
    let target = null;
    const move = e => {
      const dx = e.clientX - start.clientX;
      const dy = e.clientY - start.clientY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      document.body.classList.add('dragging');
      origins.forEach(o => { o.el.style.left = `${o.x + dx}px`; o.el.style.top = `${o.y + dy}px`; o.el.classList.add('moving'); });
      Win.$$('.dk-icon.drop', host()).forEach(i => i.classList.remove('drop'));
      const under = document.elementsFromPoint(e.clientX, e.clientY).find(n => n.closest?.('.dk-icon') && !moving.includes(n.closest('.dk-icon')))?.closest('.dk-icon');
      const id = under?.dataset.id;
      const ok = id === 'sys-bin' || (id && Win.FS.isFolder(node(id)));
      target = ok ? id : null;
      under?.classList.toggle('drop', ok);
    };
    const up = e => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      document.body.classList.remove('dragging');
      if (!moved) return;
      const ids = selected();
      const win = document.elementsFromPoint(e.clientX, e.clientY).find(n => n.classList?.contains('win'));
      if (target === 'sys-bin') ids.forEach(id => Win.FS.remove(id));
      else if (target) ids.forEach(id => Win.FS.move(id, target));
      else if (win && Win.Explorer?.dropTarget) {
        const folder = Win.Explorer.dropTarget(win, e.clientX, e.clientY);
        if (folder) ids.forEach(id => (e.ctrlKey ? Win.FS.copy(id, folder) : Win.FS.move(id, folder)));
      } else {
        /* Snap each moved icon to the nearest free cell. */
        const taken = new Set(layout(items()).filter(p => !selection.has(p.item.id)).map(p => `${p.c},${p.r}`));
        origins.forEach(o => {
          let c = Math.max(0, Math.round((parseFloat(o.el.style.left) - 4) / g.w));
          let r = Win.clamp(Math.round((parseFloat(o.el.style.top) - 4) / g.h), 0, g.rows - 1);
          while (taken.has(`${c},${r}`)) { r += 1; if (r >= g.rows) { r = 0; c += 1; } }
          taken.add(`${c},${r}`);
          D().positions[o.el.dataset.id] = { c, r };
        });
        Win.save();
      }
      render();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    void iconEl;
  }

  /* -------------------------------------------------------------- keyboard */

  function onKey(e) {
    if (!Win.state.session.signedIn || Win.state.session.locked) return;
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    const meta = e.metaKey;
    const key = e.key.toLowerCase();

    if ((meta && key === 'r')) { e.preventDefault(); Win.wm.open('run'); return; }
    if (meta && ['e', 'i', 'a', 'n', 'd', 'l', 's', 'x', 'tab', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'v'].includes(key)) {
      e.preventDefault();
      const f = Win.wm.focused;
      ({
        e: () => Win.wm.open('explorer'),
        i: () => Win.wm.open('settings'),
        a: () => Win.Flyout.toggle('quick'),
        n: () => Win.Flyout.toggle('notify'),
        d: () => Win.wm.showDesktop(),
        l: () => Win.Session.lock(),
        s: () => Win.Flyout.toggle('search'),
        w: () => Win.Flyout.toggle('widgets'),
        x: () => Win.Start.winX(8, innerHeight - 60),
        tab: () => Win.Flyout.toggle('taskview'),
        arrowleft: () => f && (f.mode === 'right' ? Win.wm.unsnap(f) : Win.wm.snap(f, 'left')),
        arrowright: () => f && (f.mode === 'left' ? Win.wm.unsnap(f) : Win.wm.snap(f, 'right')),
        arrowup: () => f && (f.mode === 'left' ? Win.wm.snap(f, 'tl') : f.mode === 'right' ? Win.wm.snap(f, 'tr') : Win.wm.maximize(f)),
        arrowdown: () => f && (f.mode === 'max' ? Win.wm.unsnap(f) : f.mode ? Win.wm.unsnap(f) : Win.wm.minimize(f)),
        v: () => Win.toast({ app: 'Clipboard', glyph: 'paste', title: S().clipboardHistory ? 'Clipboard history' : 'Clipboard history is off', body: S().clipboardHistory ? 'Items you copy will appear here.' : 'Turn it on in Settings > System > Clipboard.', transient: true }),
      })[key]?.();
      return;
    }
    if (e.key === 'Meta' || (e.ctrlKey && e.key === 'Escape')) { metaAlone = e.key === 'Meta'; if (!metaAlone) { e.preventDefault(); Win.Flyout.toggle('start'); } return; }
    if (e.ctrlKey && e.shiftKey && e.key === 'Escape') { e.preventDefault(); Win.wm.open('taskmgr'); return; }
    if (e.key === 'Escape' && Win.Flyout.current) { Win.Flyout.close(); return; }
    if (e.altKey && e.key === 'F4') {
      e.preventDefault();
      if (Win.wm.focused) Win.wm.close(Win.wm.focused);
      else Win.Session.shutdownDialog?.();
      return;
    }

    /* Desktop-focused keys apply only when no window has focus. */
    if (typing || Win.wm.focused || Win.Flyout.current || document.querySelector('.dlg-smoke')) return;
    const ids = selected();
    if (e.key === 'Delete') { e.preventDefault(); remove(ids, e.shiftKey); }
    else if (e.key === 'F2' && ids.length === 1) { e.preventDefault(); rename(ids[0]); }
    else if (e.key === 'Enter' && selection.size) { e.preventDefault(); [...selection].forEach(open); }
    else if (e.ctrlKey && key === 'a') { e.preventDefault(); selection = new Set(items().map(i => i.id)); render(); }
    else if (e.ctrlKey && key === 'c' && ids.length) { Win.state.clipboard = { op: 'copy', ids }; Win.save(); }
    else if (e.ctrlKey && key === 'x' && ids.length) { Win.state.clipboard = { op: 'cut', ids }; Win.save(); }
    else if (e.ctrlKey && key === 'v') { e.preventDefault(); paste(); }
    else if (e.ctrlKey && e.shiftKey && key === 'n') { e.preventDefault(); newItem('folder'); }
    else if (e.key === 'F5') { e.preventDefault(); render(); }
  }

  /* A lone tap of the Windows key toggles Start, as on a real PC. */
  let metaAlone = false;
  function onKeyUp(e) {
    if (e.key === 'Meta' && metaAlone) { metaAlone = false; if (Win.state.session.signedIn && !Win.state.session.locked) Win.Flyout.toggle('start'); }
  }
  document.addEventListener('keydown', e => { if (e.key !== 'Meta') metaAlone = false; }, true);

  Win.Desktop = {
    render,
    select,
    rename,
    init() {
      wire();
      render();
      document.addEventListener('keydown', onKey);
      document.addEventListener('keyup', onKeyUp);
      Win.on('state', render);
      addEventListener('resize', Win.debounce(render, 120));
    },
  };
})(window.Win);
