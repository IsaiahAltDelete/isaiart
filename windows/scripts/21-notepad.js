/* ===========================================================================
   Notepad.

   Tabs live in the title bar; each tab owns its own <textarea> so native
   undo history survives switching. Find/Replace highlights are painted on a
   backdrop layer behind a transparent textarea with identical metrics.

   Opening a file while a Notepad window exists adds a tab to that window, as
   Windows 11 Notepad does; "New window" (or args.newWindow) opens another.
   =========================================================================== */

(function (Win) {
  'use strict';

  const g = (name, size = 16) => Win.glyph(name, size);
  const esc = Win.esc;

  /* Formatting-toolbar glyphs (Fluent-style outlines on the shared 20-unit grid). */
  const FMT_GLYPHS = {
    heading: '<path d="M3.5 4.5v11M10.5 4.5v11M3.5 10h7"/><path d="M14 9.2l2-1.2v7.5"/>',
    bullet: '<circle cx="4" cy="5.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="4" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="4" cy="14.5" r="1.1" fill="currentColor" stroke="none"/><path d="M8 5.5h9M8 10h9M8 14.5h9"/>',
    number: '<path d="M3 3.8l1.3-.8v4.5M2.8 7.5h2.9M2.8 11.2c.2-.7.8-1 1.4-1 .7 0 1.2.4 1.2 1 0 1-2.6 1.6-2.6 3.3h2.7"/><path d="M8.5 5.5h8.5M8.5 10h8.5M8.5 14.5h8.5"/>',
    bold: '<path d="M6 3.8h4.6a3 3 0 0 1 0 6H6zM6 9.8h5.4a3.2 3.2 0 0 1 0 6.4H6z" stroke-width="2"/>',
    italic: '<path d="M8.5 3.8h7M4.5 16.2h7M12.4 3.8 8.6 16.2"/>',
    link: '<path d="M8.6 11.4a3.1 3.1 0 0 0 4.4 0l2.7-2.7a3.1 3.1 0 0 0-4.4-4.4l-1 1M11.4 8.6a3.1 3.1 0 0 0-4.4 0l-2.7 2.7a3.1 3.1 0 0 0 4.4 4.4l1-1"/>',
    clear: '<path d="M3 15.5 7.2 4.5h1.1l2.2 5.7M4.6 11.6h4.4"/><path d="M12.8 12.2l4.3 4.3M17.1 12.2l-4.3 4.3"/>',
  };
  const fg = name => `<svg class="glyph" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${FMT_GLYPHS[name]}</svg>`;

  Win.DefaultState.notepad = { wrap: true, statusBar: true, font: 'Consolas', fontSize: 11, spellcheck: false };
  const N = () => (Win.state.notepad ||= Win.clone(Win.DefaultState.notepad));

  const FONTS = ['Consolas', 'Cascadia Mono', 'Courier New', 'Lucida Console', 'Segoe UI', 'Arial', 'Georgia'];
  const MONO = new Set(['Consolas', 'Cascadia Mono', 'Courier New', 'Lucida Console']);
  const fontStack = name => (MONO.has(name) ? `"${name}", var(--mono)` : `"${name}", var(--font)`);

  /* What Notepad shows for a file with no text content, such as a .docx. */
  function binaryText(node) {
    let seed = [...String(node.id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 17);
    const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
    const pool = 'ÿ¤¶§ÐÞßøæ¿¡·¸ªº°±²³µ¼½¾×÷ìíîïðñòóôõöùúûüýþ';
    const parts = ['PK\u0003\u0004\u0014\u0000\u0006\u0000\b\u0000\u0000\u0000!\u0000'];
    const names = ['[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', node.ext === 'xlsx' ? 'xl/workbook.xml' : 'word/document.xml', 'theme/theme1.xml'];
    for (let i = 0; i < 26; i += 1) {
      let run = '';
      const len = 30 + Math.floor(rand() * 60);
      for (let j = 0; j < len; j += 1) {
        const r = rand();
        run += r < 0.5 ? pool[Math.floor(rand() * pool.length)] : r < 0.85 ? String.fromCharCode(33 + Math.floor(rand() * 90)) : '\u0000';
      }
      parts.push(run, i % 4 === 0 ? names[(i / 4) % names.length] : '');
    }
    return parts.join('');
  }

  const readText = node => String(node.content ?? binaryText(node)).replace(/\r\n?/g, '\n');
  const eolOf = text => (/\r\n/.test(text) || !/\n/.test(text) ? 'CRLF' : 'LF');

  /* --------------------------------------------------------------- windows */

  const windows = () => Win.wm.byApp('notepad').filter(w => !w.closed && w.state.np);

  function findOpen(fileId) {
    for (const win of windows()) {
      const tab = win.state.np.tabs.find(t => t.fileId === fileId);
      if (tab) return { win, tab };
    }
    return null;
  }

  /* wm.open hands control to `launch` while it is defined; dropping it for
     one call lets us create a real window from inside it. */
  function openWindow(args) {
    const app = Win.apps.get('notepad');
    const launch = app.launch;
    app.launch = null;
    try { return Win.wm.open('notepad', args); } finally { app.launch = launch; }
  }

  Win.apps.register({
    id: 'notepad',
    name: 'Notepad',
    icon: 'notepad',
    customTitle: true,
    width: 860,
    height: 560,
    minWidth: 380,
    minHeight: 240,
    category: 'Accessories',
    keywords: ['text', 'editor', 'txt', 'notes'],
    launch(args = {}) {
      const open = args.fileId && findOpen(args.fileId);
      if (open) { Win.wm.focus(open.win); activate(open.win.state.np, open.tab); return; }
      const target = !args.newWindow && args.fileId && windows().sort((a, b) => b.z - a.z)[0];
      if (target && Win.FS.get(args.fileId)) {
        Win.wm.focus(target);
        openFileTab(target.state.np, args.fileId);
        return;
      }
      openWindow(args);
    },
    create: createNotepad,
    async beforeClose(win) {
      const np = win.state.np;
      if (!np) return true;
      for (const tab of np.tabs.slice()) {
        if (!dirty(tab)) continue;
        const answer = await askSave(np, tab);
        if (answer === 'cancel') return false;
      }
      return true;
    },
  });

  function createNotepad(win, args = {}) {
    const np = { win, tabs: [], tab: null, zoom: 100, menuEl: null, menuName: '', find: { open: false, replace: false, matchCase: false, wrap: true, cur: -1 } };
    win.state.np = np;
    win.el.classList.add('np-window');
    win.titleContent.innerHTML = `<span class="np-appico">${Win.appIcon('notepad', 16)}</span><div class="ft-strip" role="tablist" aria-label="Tabs"></div>
      <button class="ft-add" data-act="new" aria-label="New tab" title="Add new tab (Ctrl+T)">${g('plus', 14)}</button>`;
    win.body.innerHTML = `<div class="np">
      <div class="np-menubar" role="menubar" aria-label="Menu bar">
        <button class="np-mb" role="menuitem" data-menu="file" aria-haspopup="menu">File</button>
        <button class="np-mb" role="menuitem" data-menu="edit" aria-haspopup="menu">Edit</button>
        <button class="np-mb" role="menuitem" data-menu="view" aria-haspopup="menu">View</button>
        <span class="np-div" aria-hidden="true"></span>
        <div class="np-fmt" role="toolbar" aria-label="Formatting">
          <button class="np-tb dd" data-fmt="heading" aria-haspopup="menu" aria-label="Heading" title="Heading">${fg('heading')}${g('chevdown', 10)}</button>
          <button class="np-tb" data-fmt="bullet" aria-label="Bulleted list" title="Bulleted list">${fg('bullet')}</button>
          <button class="np-tb" data-fmt="number" aria-label="Numbered list" title="Numbered list">${fg('number')}</button>
          <button class="np-tb" data-fmt="bold" aria-label="Bold" title="Bold (Ctrl+B)">${fg('bold')}</button>
          <button class="np-tb" data-fmt="italic" aria-label="Italic" title="Italic (Ctrl+I)">${fg('italic')}</button>
          <button class="np-tb np-tb-x" data-fmt="link" aria-label="Link" title="Link (Ctrl+K)">${fg('link')}</button>
          <button class="np-tb np-tb-x" data-fmt="clear" aria-label="Clear formatting" title="Clear formatting">${fg('clear')}</button>
        </div>
        <span class="np-sp"></span>
        <button class="np-tb dd np-copilot" data-fmt="copilot" aria-haspopup="menu" aria-label="Write with Copilot" title="Write">${Win.appIcon('copilot', 16)}${g('chevdown', 10)}</button>
        <button class="icon-btn np-gear" data-act="settings" aria-label="Settings" title="Settings">${g('gear')}</button>
      </div>
      <div class="np-editor">
        <div class="np-find hidden" role="search" aria-label="Find and replace">
          <button class="icon-btn np-fexp" data-f="expand" aria-label="Show replace options" title="Toggle replace">${g('chevright', 12)}</button>
          <div class="np-frows">
            <div class="np-frow">
              <input class="input np-fq" placeholder="Find" aria-label="Find" spellcheck="false" autocomplete="off">
              <span class="np-fcount" aria-live="polite"></span>
              <button class="icon-btn" data-f="next" aria-label="Find next" title="Find next (F3)">${g('chevdown', 14)}</button>
              <button class="icon-btn" data-f="prev" aria-label="Find previous" title="Find previous (Shift+F3)">${g('chevup', 14)}</button>
              <button class="icon-btn" data-f="opts" aria-label="Find options" title="Options">${g('gear', 14)}</button>
              <button class="icon-btn" data-f="close" aria-label="Close find" title="Close (Esc)">${g('close', 14)}</button>
            </div>
            <div class="np-frow np-rrow hidden">
              <input class="input np-fr" placeholder="Replace" aria-label="Replace with" spellcheck="false" autocomplete="off">
              <button class="btn sm" data-f="replace">Replace</button>
              <button class="btn sm" data-f="all">Replace all</button>
            </div>
          </div>
        </div>
        <div class="np-pages"></div>
      </div>
      <div class="np-status" role="status">
        <span class="np-pos"></span><span class="np-count"></span><span class="np-sp"></span>
        <span class="np-zoom"></span><span>Windows (CRLF)</span><span>UTF-8</span>
      </div>
    </div>`;
    const $ = sel => win.body.querySelector(sel);
    np.el = {
      strip: win.titleContent.querySelector('.ft-strip'), pages: $('.np-pages'), find: $('.np-find'), fq: $('.np-fq'), fr: $('.np-fr'),
      fcount: $('.np-fcount'), rrow: $('.np-rrow'), status: $('.np-status'), pos: $('.np-pos'), count: $('.np-count'), zoom: $('.np-zoom'),
      eol: $('.np-status span:nth-last-child(2)'), menubar: $('.np-menubar'),
    };
    wire(np);
    Win.Explorer?.holdFocus?.(win);
    const node = args.fileId && Win.FS.get(args.fileId);
    if (node) openFileTab(np, node.id); else newTab(np);
    applySettings(np);
    win.listen('fs', () => {
      let changed = false;
      for (const tab of np.tabs) {
        const n = tab.fileId && Win.FS.get(tab.fileId);
        if (n && n.name !== tab.name) { tab.name = n.name; changed = true; }
      }
      if (changed) { renderTabs(np); updateTitle(np); }
    });
    win.listen('state', () => applySettings(np));
  }

  /* -------------------------------------------------------------- tab model */

  const dirty = tab => tab.ta.value !== tab.saved;

  function newTab(np, { fileId = null, text = '', name = 'Untitled', eol = 'CRLF' } = {}) {
    const page = Win.html(`<div class="np-page hidden"><div class="np-back" aria-hidden="true"></div><textarea class="np-ta" spellcheck="false" aria-label="Text editor" autocomplete="off"></textarea></div>`);
    const tab = { id: Win.uid('nt'), fileId, name, saved: text, eol, page, ta: page.querySelector('textarea'), back: page.querySelector('.np-back'), wasDirty: false };
    tab.ta.value = text;
    np.el.pages.appendChild(page);
    np.tabs.push(tab);
    wireTab(np, tab);
    activate(np, tab);
    return tab;
  }

  function openFileTab(np, fileId) {
    const open = findOpen(fileId);
    if (open) { if (open.win !== np.win) Win.wm.focus(open.win); activate(open.win.state.np, open.tab); return open.tab; }
    const node = Win.FS.get(fileId);
    if (!node) return null;
    const raw = String(node.content ?? '');
    const text = readText(node);
    const blank = np.tabs.length === 1 && !np.tab.fileId && !np.tab.ta.value && !dirty(np.tab) ? np.tab : null;
    const tab = newTab(np, { fileId, text, name: node.name, eol: eolOf(raw) });
    if (blank) closeTab(np, blank, { force: true });
    Win.FS.touch(fileId);
    return tab;
  }

  function activate(np, tab) {
    if (!tab) return;
    np.tab = tab;
    np.tabs.forEach(t => t.page.classList.toggle('hidden', t !== tab));
    renderTabs(np);
    updateTitle(np);
    updateStatus(np);
    if (np.find.open) refreshFind(np);
    requestAnimationFrame(() => { if (np.tab === tab && !np.find.open) tab.ta.focus({ preventScroll: true }); });
  }

  async function closeTab(np, tab, { force = false } = {}) {
    if (!force && dirty(tab)) {
      const answer = await askSave(np, tab);
      if (answer === 'cancel') return false;
    }
    const index = np.tabs.indexOf(tab);
    if (index < 0) return true;
    np.tabs.splice(index, 1);
    tab.page.remove();
    if (!np.tabs.length) { np.win.close({ force: true }); return true; }
    if (np.tab === tab) activate(np, np.tabs[Math.min(index, np.tabs.length - 1)]);
    else renderTabs(np);
    return true;
  }

  function renderTabs(np) {
    np.el.strip.innerHTML = np.tabs.map(t => {
      const on = t === np.tab;
      const d = dirty(t);
      return `<div class="ft-tab ${on ? 'on' : ''} ${d ? 'dirty' : ''}" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-tab="${t.id}" title="${esc(t.fileId ? Win.Explorer?.pathOf?.(t.fileId) || t.name : t.name)}">
        <span class="ft-name">${esc(t.name)}</span>
        <button class="ft-x" data-close="${t.id}" aria-label="${d ? 'Close tab, unsaved changes' : 'Close tab'}" title="Close tab (Ctrl+W)" tabindex="-1"><span class="ft-dot" aria-hidden="true"></span>${g('close', 12)}</button></div>`;
    }).join('');
  }

  function updateTitle(np) {
    const title = `${np.tab.name}${dirty(np.tab) ? ' •' : ''} - Notepad`;
    if (title !== np.title) { np.title = title; np.win.setTitle(title); }
  }

  function onEdit(np, tab) {
    const d = dirty(tab);
    if (d !== tab.wasDirty) { tab.wasDirty = d; renderTabs(np); updateTitle(np); }
    updateStatus(np);
    if (np.find.open) refreshFind(np, { keepCur: true });
  }

  /* ----------------------------------------------------------------- saving */

  function askSave(np, tab) {
    activate(np, tab);
    return Win.dialog({
      title: 'Notepad', owner: np.win,
      body: `<p>Do you want to save changes to ${esc(tab.name)}?</p>`,
      buttons: [{ label: 'Save', value: 'save', primary: true }, { label: "Don't save", value: 'discard' }, { label: 'Cancel', value: 'cancel' }],
    }).then(async answer => {
      if (answer === 'save') return (await save(np, tab)) ? 'saved' : 'cancel';
      return answer === 'discard' ? 'discard' : 'cancel';
    });
  }

  const toDisk = tab => (tab.eol === 'CRLF' ? tab.ta.value.replace(/\n/g, '\r\n') : tab.ta.value);

  function markSaved(np, tab) {
    tab.saved = tab.ta.value;
    tab.wasDirty = false;
    renderTabs(np);
    updateTitle(np);
  }

  async function save(np, tab, as = false) {
    const node = tab.fileId && Win.FS.get(tab.fileId);
    if (!as && node && node.parent !== 'bin') {
      if (node.readonly || node.system) {
        const again = await Win.dialog({
          title: 'Notepad', owner: np.win,
          body: `<p>Access is denied.</p><p class="muted">You don't have permission to save “${esc(node.name)}” in this location. Do you want to save it somewhere else?</p>`,
          buttons: [{ label: 'Save as', value: true, primary: true }, { label: 'Cancel', value: false }],
        });
        return again ? save(np, tab, true) : false;
      }
      Win.FS.write(node.id, toDisk(tab));
      markSaved(np, tab);
      return true;
    }
    const result = await Win.pickFile({
      mode: 'save', title: 'Save as', exts: ['txt'], owner: np.win,
      defaultName: node ? node.name : `${tab.name === 'Untitled' ? 'Untitled' : tab.name.replace(/\.txt$/i, '')}.txt`,
      folder: node && node.parent !== 'bin' ? node.parent : 'documents',
    });
    if (!result) return false;
    let id;
    if (result.overwrite) {
      const target = Win.FS.get(result.id);
      if (!target || target.readonly || target.system) { await Win.alert('Notepad', 'Access is denied.', np.win); return false; }
      Win.FS.write(target.id, toDisk(tab));
      id = target.id;
    } else {
      id = Win.FS.create(result.folder, result.name, 'file', { content: toDisk(tab) }).id;
    }
    const other = np.tabs.find(t => t !== tab && t.fileId === id);
    if (other) closeTab(np, other, { force: true });
    tab.fileId = id;
    tab.name = Win.FS.get(id).name;
    markSaved(np, tab);
    Win.FS.touch(id);
    return true;
  }

  async function saveAll(np) {
    for (const tab of np.tabs.slice()) {
      if (dirty(tab) || !tab.fileId) {
        if (!tab.fileId && !tab.ta.value) continue;
        activate(np, tab);
        if (!(await save(np, tab))) return;
      }
    }
  }

  async function openDialog(np) {
    const result = await Win.pickFile({ mode: 'open', title: 'Open', exts: ['txt'], owner: np.win, folder: np.tab.fileId ? Win.FS.get(np.tab.fileId)?.parent : 'documents' });
    if (result?.id) openFileTab(np, result.id);
  }

  /* ---------------------------------------------------------------- editing */

  function insertText(np, text) {
    const ta = np.tab.ta;
    ta.focus();
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      onEdit(np, np.tab);
    }
  }

  function exec(np, command) {
    const ta = np.tab.ta;
    ta.focus();
    try { document.execCommand(command); } catch { /* unsupported */ }
    onEdit(np, np.tab);
  }

  function paste(np) {
    const fallback = () => { const text = Win.state.clipboard?.text; if (text) insertText(np, text); };
    try {
      if (navigator.clipboard?.readText) navigator.clipboard.readText().then(text => (text ? insertText(np, text) : fallback()), fallback);
      else fallback();
    } catch { fallback(); }
  }

  /* -------------------------------------------------- lightweight formatting
     Notepad's formatting is stored as Markdown, so the toolbar edits the
     plain text: headings and lists prefix whole lines, bold/italic/link wrap
     the selection. Every change goes through insertText to keep native undo. */

  const LINE_MARK = /^(\s*)(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/;

  /** Expands the selection to whole lines and returns them. */
  function selectedLines(ta) {
    const v = ta.value;
    const start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let end = v.indexOf('\n', ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === '\n' ? ta.selectionEnd - 1 : ta.selectionEnd);
    if (end < 0) end = v.length;
    return { start, end, lines: v.slice(start, end).split('\n') };
  }

  function replaceLines(np, map) {
    const ta = np.tab.ta;
    const { start, end, lines } = selectedLines(ta);
    const out = map(lines).join('\n');
    ta.setSelectionRange(start, end);
    insertText(np, out);
    ta.setSelectionRange(start, start + out.length);
    updateStatus(np);
  }

  function setHeading(np, level) {
    replaceLines(np, lines => lines.map(line => {
      const body = line.replace(/^\s*#{1,6}\s+/, '');
      return level ? `${'#'.repeat(level)} ${body}` : body;
    }));
  }

  function toggleList(np, kind) {
    const re = kind === 'bullet' ? /^(\s*)[-*+]\s+/ : /^(\s*)\d+[.)]\s+/;
    replaceLines(np, lines => {
      const filled = lines.filter(l => l.trim());
      const on = filled.length && filled.every(l => re.test(l));
      let n = 0;
      return lines.map(line => {
        if (on) return line.replace(re, '$1');
        if (!line.trim() && lines.length > 1) return line;
        const bare = line.replace(LINE_MARK, '$1');
        const indent = bare.match(/^\s*/)[0];
        return `${indent}${kind === 'bullet' ? '-' : `${++n}.`} ${bare.slice(indent.length)}`;
      });
    });
  }

  function wrapSelection(np, mark) {
    const ta = np.tab.ta;
    const { selectionStart: a, selectionEnd: b, value: v } = ta;
    const sel = v.slice(a, b);
    const m = mark.length;
    const run = (i, dir) => { let n = 0; while (v[i + n * dir] === '*') n++; return n; };
    const before = run(a - 1, -1);
    const after = run(b, 1);
    /* '***text***' is bold and italic: bold needs two stars each side, italic an odd count. */
    const on = m === 2 ? before >= 2 && after >= 2 : before % 2 === 1 && after % 2 === 1;
    if (on) {
      ta.setSelectionRange(a - m, b + m);
      insertText(np, sel);
      ta.setSelectionRange(a - m, b - m);
    } else {
      insertText(np, mark + sel + mark);
      ta.setSelectionRange(a + m, b + m);
    }
    updateStatus(np);
  }

  function insertLink(np) {
    const ta = np.tab.ta;
    const { selectionStart: a, selectionEnd: b, value: v } = ta;
    const sel = v.slice(a, b);
    const isUrl = /^(https?:\/\/|www\.)\S+$/i.test(sel);
    const text = isUrl ? sel : sel || 'link text';
    const url = isUrl ? sel : 'https://';
    insertText(np, `[${text}](${url})`);
    if (isUrl || sel) ta.setSelectionRange(a + text.length + 3, a + text.length + 3 + url.length);
    else ta.setSelectionRange(a + 1, a + 1 + text.length);
    updateStatus(np);
  }

  function clearFormatting(np) {
    const strip = t => t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(\S(?:.*?\S)?)\*/g, '$1');
    replaceLines(np, lines => lines.map(line => strip(line.replace(LINE_MARK, '$1'))));
  }

  function format(np, kind, button) {
    if (kind === 'heading') {
      const r = button.getBoundingClientRect();
      const cur = (np.tab.ta.value.slice(np.tab.ta.value.lastIndexOf('\n', np.tab.ta.selectionStart - 1) + 1).match(/^#{1,6}(?=\s)/) || [''])[0].length;
      Win.menu(r.left, r.bottom + 2, [
        ...[1, 2, 3, 4, 5, 6].map(n => ({ label: `Heading ${n}`, checked: cur === n, action: () => setHeading(np, n) })),
        { divider: true },
        { label: 'Body text', checked: cur === 0, action: () => setHeading(np, 0) },
      ], { className: 'np-menu' });
      return;
    }
    if (kind === 'copilot') {
      const r = button.getBoundingClientRect();
      const hasSel = np.tab.ta.selectionStart !== np.tab.ta.selectionEnd;
      const signIn = title => Win.toast({ app: 'Notepad', icon: 'notepad', title, body: 'Sign in with your Microsoft account to use AI features in Notepad.', transient: true });
      Win.menu(r.right - 220, r.bottom + 2, [
        { label: 'Write', glyph: 'edit', action: () => signIn('Write') },
        { label: 'Rewrite', glyph: 'sparkle', disabled: !hasSel, action: () => signIn('Rewrite') },
        { label: 'Summarize', glyph: 'document', disabled: !hasSel, action: () => signIn('Summarize') },
      ], { className: 'np-menu' });
      return;
    }
    if (kind === 'bullet' || kind === 'number') toggleList(np, kind);
    if (kind === 'bold') wrapSelection(np, '**');
    if (kind === 'italic') wrapSelection(np, '*');
    if (kind === 'link') insertLink(np);
    if (kind === 'clear') clearFormatting(np);
  }

  function deleteSelection(np) {
    const ta = np.tab.ta;
    exec(np, ta.selectionStart === ta.selectionEnd ? 'forwardDelete' : 'delete');
  }

  function goToLine(np) {
    const ta = np.tab.ta;
    const lines = ta.value.split('\n');
    const current = ta.value.slice(0, ta.selectionStart).split('\n').length;
    Win.prompt('Go to line', 'Line number', String(current), {
      owner: np.win, ok: 'Go to', type: 'number',
      validate: v => (!/^\d+$/.test(String(v).trim()) || Number(v) < 1 ? 'Enter a line number.' : Number(v) > lines.length ? 'The line number is beyond the total number of lines.' : ''),
    }).then(v => {
      if (v == null) return;
      const n = Number(v);
      const pos = lines.slice(0, n - 1).reduce((sum, l) => sum + l.length + 1, 0);
      ta.focus();
      ta.setSelectionRange(pos, pos);
      ta.blur();
      ta.focus();
      updateStatus(np);
    });
  }

  /* ----------------------------------------------------------- find/replace */

  function matches(np) {
    const q = np.el.fq.value;
    const text = np.tab.ta.value;
    if (!q) return [];
    const hay = np.find.matchCase ? text : text.toLowerCase();
    const needle = np.find.matchCase ? q : q.toLowerCase();
    const out = [];
    for (let i = hay.indexOf(needle); i >= 0 && out.length < 5000; i = hay.indexOf(needle, i + needle.length)) out.push(i);
    return out;
  }

  function openFind(np, replace = false) {
    const f = np.find;
    f.open = true;
    f.replace = replace || f.replace;
    np.el.find.classList.remove('hidden');
    np.el.rrow.classList.toggle('hidden', !f.replace);
    np.el.find.querySelector('[data-f="expand"]').innerHTML = g(f.replace ? 'chevdown' : 'chevright', 12);
    const ta = np.tab.ta;
    const picked = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (picked && !picked.includes('\n') && picked.length < 200) np.el.fq.value = picked;
    (replace && np.el.fq.value ? np.el.fr : np.el.fq).focus();
    (replace && np.el.fq.value ? np.el.fr : np.el.fq).select();
    refreshFind(np);
  }

  function closeFind(np) {
    np.find.open = false;
    np.el.find.classList.add('hidden');
    np.tabs.forEach(t => { t.back.innerHTML = ''; });
    const ta = np.tab.ta;
    const list = matches(np);
    const cur = list[np.find.cur];
    ta.focus();
    if (cur != null) ta.setSelectionRange(cur, cur + np.el.fq.value.length);
  }

  /** Repaint highlights; the current match is the one at/after the caret. */
  function refreshFind(np, { keepCur = false } = {}) {
    const tab = np.tab;
    const list = matches(np);
    const q = np.el.fq.value;
    if (!keepCur || np.find.cur >= list.length) {
      const caret = tab.ta.selectionStart;
      np.find.cur = list.length ? Math.max(0, list.findIndex(i => i >= caret)) : -1;
    }
    np.el.fcount.textContent = q ? (list.length ? `${np.find.cur + 1} of ${list.length}` : 'No results') : '';
    np.el.fq.classList.toggle('bad', !!q && !list.length);
    paintMarks(np, list, q.length);
  }

  function paintMarks(np, list, len) {
    const tab = np.tab;
    const text = tab.ta.value;
    if (!list.length || text.length > 400000) { tab.back.innerHTML = ''; return; }
    let html = '';
    let at = 0;
    list.forEach((i, n) => {
      html += esc(text.slice(at, i)) + `<mark class="${n === np.find.cur ? 'cur' : ''}">${esc(text.slice(i, i + len))}</mark>`;
      at = i + len;
    });
    tab.back.innerHTML = `${html + esc(text.slice(at))}\n `;
    syncBack(tab);
  }

  function syncBack(tab) {
    tab.back.style.width = `${tab.ta.clientWidth}px`;
    tab.back.style.height = `${tab.ta.clientHeight}px`;
    tab.back.scrollTop = tab.ta.scrollTop;
    tab.back.scrollLeft = tab.ta.scrollLeft;
  }

  function findStep(np, dir) {
    if (!np.find.open) { openFind(np); return; }
    const list = matches(np);
    if (!list.length) { refreshFind(np); return; }
    const f = np.find;
    let next = f.cur + dir;
    if (next >= list.length || next < 0) {
      if (!f.wrap) { np.el.fcount.textContent = `Can't find "${np.el.fq.value}"`; return; }
      next = (next + list.length) % list.length;
    }
    f.cur = next;
    reveal(np, list[next], np.el.fq.value.length);
    refreshFind(np, { keepCur: true });
  }

  function reveal(np, at, len) {
    const ta = np.tab.ta;
    ta.setSelectionRange(at, at + len);
    paintMarks(np, matches(np), len);
    const mark = np.tab.back.querySelector('mark.cur');
    if (!mark) return;
    const top = mark.offsetTop;
    if (top < ta.scrollTop + 8 || top > ta.scrollTop + ta.clientHeight - 40) ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
    const left = mark.offsetLeft;
    if (left < ta.scrollLeft || left > ta.scrollLeft + ta.clientWidth - 40) ta.scrollLeft = Math.max(0, left - ta.clientWidth / 3);
    syncBack(np.tab);
    updateStatus(np);
  }

  function replaceOne(np) {
    const list = matches(np);
    const f = np.find;
    if (!list.length) { refreshFind(np); return; }
    const q = np.el.fq.value;
    const at = list[Math.max(0, f.cur)];
    const ta = np.tab.ta;
    ta.focus();
    ta.setSelectionRange(at, at + q.length);
    insertText(np, np.el.fr.value);
    ta.setSelectionRange(at + np.el.fr.value.length, at + np.el.fr.value.length);
    np.el.fr.focus();
    refreshFind(np);
    const after = matches(np);
    if (after.length) reveal(np, after[Math.max(0, f.cur)], q.length);
  }

  function replaceAll(np) {
    const list = matches(np);
    if (!list.length) { refreshFind(np); return; }
    const q = np.el.fq.value;
    const ta = np.tab.ta;
    const text = ta.value;
    let out = '';
    let at = 0;
    list.forEach(i => { out += text.slice(at, i) + np.el.fr.value; at = i + q.length; });
    out += text.slice(at);
    ta.focus();
    ta.select();
    insertText(np, out);
    ta.setSelectionRange(0, 0);
    np.el.fr.focus();
    refreshFind(np);
    np.el.fcount.textContent = `Replaced ${list.length}`;
  }

  /* ------------------------------------------------------- status & settings */

  function updateStatus(np) {
    const ta = np.tab.ta;
    const caret = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
    const before = ta.value.slice(0, caret);
    const line = (before.match(/\n/g) || []).length + 1;
    const col = caret - before.lastIndexOf('\n');
    const total = ta.value.length;
    const picked = ta.selectionEnd - ta.selectionStart;
    np.el.pos.textContent = `Ln ${line}, Col ${col}`;
    np.el.count.textContent = picked ? `${picked.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} characters` : `${total.toLocaleString('en-US')} character${total === 1 ? '' : 's'}`;
    np.el.zoom.textContent = `${np.zoom}%`;
    np.el.eol.textContent = np.tab.eol === 'LF' ? 'Unix (LF)' : 'Windows (CRLF)';
  }

  function applySettings(np) {
    const s = N();
    np.el.status.classList.toggle('hidden', !s.statusBar);
    const px = (s.fontSize * 4) / 3 * (np.zoom / 100);
    np.win.body.querySelector('.np').style.setProperty('--np-font', fontStack(s.font));
    np.win.body.querySelector('.np').style.setProperty('--np-size', `${px.toFixed(2)}px`);
    np.win.body.querySelector('.np').classList.toggle('nowrap', !s.wrap);
    np.tabs.forEach(t => {
      t.ta.wrap = s.wrap ? 'soft' : 'off';
      t.ta.spellcheck = !!s.spellcheck;
    });
    updateStatus(np);
    if (np.find.open) refreshFind(np, { keepCur: true });
  }

  function setZoom(np, value) {
    np.zoom = Win.clamp(Math.round(value / 10) * 10, 10, 500);
    applySettings(np);
  }

  function settingsDialog(np) {
    const s = N();
    Win.dialog({
      title: 'Settings', owner: np.win, width: 440,
      body: `<div class="np-settings">
        <label class="field"><span>Font family</span>${Win.select(FONTS, s.font, 'data-s="font"')}</label>
        <label class="field"><span>Size</span>${Win.select([8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72], s.fontSize, 'data-s="fontSize"')}</label>
        <div class="np-preview" style="font-family:${esc(fontStack(s.font))}">The quick brown fox jumps over the lazy dog</div>
        <div class="np-srow"><span>Word wrap</span>${Win.toggle(s.wrap, 'data-s="wrap"', 'Word wrap')}</div>
        <div class="np-srow"><span>Spell check</span>${Win.toggle(s.spellcheck, 'data-s="spellcheck"', 'Spell check')}</div>
        <p class="caption muted">Notepad uses the app mode chosen in Settings &gt; Personalization &gt; Colors.</p>
      </div>`,
      onRender(box) {
        box.addEventListener('change', () => {
          const font = box.querySelector('[data-s="font"]').value;
          box.querySelector('.np-preview').style.fontFamily = fontStack(font);
        });
      },
      buttons: [
        { label: 'Save', primary: true, value: box => Object.fromEntries(Win.$$('[data-s]', box).map(el => [el.dataset.s, el.type === 'checkbox' ? el.checked : el.dataset.s === 'fontSize' ? Number(el.value) : el.value])) },
        { label: 'Cancel', value: null },
      ],
    }).then(v => {
      if (!v) return;
      Object.assign(N(), v);
      Win.save();
    });
  }

  /* ------------------------------------------------------------------ menus */

  function menuItems(np, name) {
    const s = N();
    const ta = np.tab.ta;
    const hasSel = ta.selectionStart !== ta.selectionEnd;
    if (name === 'file') {
      return [
        { label: 'New tab', glyph: 'tab', shortcut: 'Ctrl+N', action: () => newTab(np) },
        { label: 'New window', glyph: 'open', shortcut: 'Ctrl+Shift+N', action: () => openWindow({ newWindow: true }) },
        { label: 'Open', glyph: 'folder', shortcut: 'Ctrl+O', action: () => openDialog(np) },
        { label: 'Save', glyph: 'download', shortcut: 'Ctrl+S', action: () => save(np, np.tab) },
        { label: 'Save as', shortcut: 'Ctrl+Shift+S', action: () => save(np, np.tab, true) },
        { label: 'Save all', shortcut: 'Ctrl+Alt+S', action: () => saveAll(np) },
        { divider: true },
        { label: 'Close tab', glyph: 'close', shortcut: 'Ctrl+W', action: () => closeTab(np, np.tab) },
        { label: 'Close window', shortcut: 'Ctrl+Shift+W', action: () => np.win.close() },
        { label: 'Exit', action: () => Promise.all(windows().map(w => w.close())) },
      ];
    }
    if (name === 'edit') {
      return [
        { label: 'Undo', glyph: 'undo', shortcut: 'Ctrl+Z', action: () => exec(np, 'undo') },
        { label: 'Redo', glyph: 'redo', shortcut: 'Ctrl+Y', action: () => exec(np, 'redo') },
        { divider: true },
        { label: 'Cut', glyph: 'cut', shortcut: 'Ctrl+X', disabled: !hasSel, action: () => exec(np, 'cut') },
        { label: 'Copy', glyph: 'copy', shortcut: 'Ctrl+C', disabled: !hasSel, action: () => exec(np, 'copy') },
        { label: 'Paste', glyph: 'paste', shortcut: 'Ctrl+V', action: () => paste(np) },
        { label: 'Delete', glyph: 'trash', shortcut: 'Del', action: () => deleteSelection(np) },
        { divider: true },
        { label: 'Find', glyph: 'search', shortcut: 'Ctrl+F', action: () => openFind(np) },
        { label: 'Find next', shortcut: 'F3', action: () => findStep(np, 1) },
        { label: 'Find previous', shortcut: 'Shift+F3', action: () => findStep(np, -1) },
        { label: 'Replace', shortcut: 'Ctrl+H', action: () => openFind(np, true) },
        { label: 'Go to', shortcut: 'Ctrl+G', action: () => goToLine(np) },
        { divider: true },
        { label: 'Select all', shortcut: 'Ctrl+A', action: () => { ta.focus(); ta.select(); updateStatus(np); } },
        { label: 'Time/Date', glyph: 'clock', shortcut: 'F5', action: () => insertText(np, `${Win.formatTime()} ${Win.formatDate()}`) },
        { divider: true },
        { label: 'Font', glyph: 'text', action: () => settingsDialog(np) },
      ];
    }
    return [
      {
        label: 'Zoom', glyph: 'zoomin', submenu: [
          { label: 'Zoom in', glyph: 'zoomin', shortcut: 'Ctrl+Plus', action: () => setZoom(np, np.zoom + 10) },
          { label: 'Zoom out', glyph: 'zoomout', shortcut: 'Ctrl+Minus', action: () => setZoom(np, np.zoom - 10) },
          { label: 'Restore default zoom', shortcut: 'Ctrl+0', action: () => setZoom(np, 100) },
        ],
      },
      { label: 'Status bar', checked: !!s.statusBar, action: () => { s.statusBar = !s.statusBar; Win.save(); } },
      { label: 'Word wrap', checked: !!s.wrap, action: () => { s.wrap = !s.wrap; Win.save(); } },
    ];
  }

  function openMenu(np, button) {
    const r = button.getBoundingClientRect();
    np.menuName = button.dataset.menu;
    np.el.menubar.querySelectorAll('.np-mb').forEach(b => b.classList.toggle('open', b === button));
    np.menuEl = Win.menu(r.left, r.bottom + 2, menuItems(np, np.menuName), { className: 'np-menu' });
    const watch = setInterval(() => {
      if (!np.menuEl?.isConnected) { clearInterval(watch); button.classList.remove('open'); }
    }, 120);
  }

  /* ----------------------------------------------------------------- wiring */

  function wireTab(np, tab) {
    const ta = tab.ta;
    ta.addEventListener('input', () => onEdit(np, tab));
    ['keyup', 'mouseup', 'select', 'focus'].forEach(type => ta.addEventListener(type, () => { if (np.tab === tab) updateStatus(np); }));
    ta.addEventListener('scroll', () => { if (tab.back.firstChild) syncBack(tab); });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); insertText(np, '\t'); }
    });
  }

  function wire(np) {
    const { win } = np;
    const { strip, pages, find, fq, fr, menubar } = np.el;

    win.titleContent.addEventListener('click', e => {
      if (e.target.closest('[data-act="new"]')) newTab(np);
      const x = e.target.closest('[data-close]');
      if (x) { const tab = np.tabs.find(t => t.id === x.dataset.close); if (tab) closeTab(np, tab); }
    });
    strip.addEventListener('pointerdown', e => {
      const t = e.target.closest('.ft-tab');
      if (!t || e.button !== 0 || e.target.closest('.ft-x')) return;
      const tab = np.tabs.find(x => x.id === t.dataset.tab);
      if (tab && tab !== np.tab) activate(np, tab);
    });
    strip.addEventListener('auxclick', e => {
      const t = e.target.closest('.ft-tab');
      if (t && e.button === 1) { e.preventDefault(); const tab = np.tabs.find(x => x.id === t.dataset.tab); if (tab) closeTab(np, tab); }
    });
    strip.addEventListener('keydown', e => {
      const i = np.tabs.indexOf(np.tab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        activate(np, np.tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + np.tabs.length) % np.tabs.length]);
        strip.querySelector('.ft-tab.on')?.focus();
      }
    });

    menubar.addEventListener('pointerdown', e => {
      const b = e.target.closest('.np-mb');
      np.menuWasOpen = !!(b && np.menuEl?.isConnected && np.menuName === b.dataset.menu);
    });
    menubar.addEventListener('click', e => {
      const b = e.target.closest('.np-mb');
      if (b) { if (!np.menuWasOpen) openMenu(np, b); np.menuWasOpen = false; return; }
      const t = e.target.closest('[data-fmt]');
      if (t) { format(np, t.dataset.fmt, t); return; }
      if (e.target.closest('[data-act="settings"]')) settingsDialog(np);
    });
    /* Keep the caret (and selection) in the editor while using the toolbar. */
    menubar.addEventListener('mousedown', e => { if (e.target.closest('.np-tb')) e.preventDefault(); });
    menubar.addEventListener('pointerover', e => {
      const b = e.target.closest('.np-mb');
      if (b && np.menuEl?.isConnected && np.menuName !== b.dataset.menu) openMenu(np, b);
    });
    menubar.addEventListener('keydown', e => {
      const b = e.target.closest('.np-mb');
      if (!b) return;
      const all = Win.$$('.np-mb', menubar);
      const i = all.indexOf(b);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length].focus(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(np, b); }
    });

    find.addEventListener('click', e => {
      const f = e.target.closest('[data-f]')?.dataset.f;
      if (!f) return;
      if (f === 'next') findStep(np, 1);
      if (f === 'prev') findStep(np, -1);
      if (f === 'close') closeFind(np);
      if (f === 'replace') replaceOne(np);
      if (f === 'all') replaceAll(np);
      if (f === 'expand') { np.find.replace = !np.find.replace; openFind(np, np.find.replace); }
      if (f === 'opts') {
        const r = e.target.closest('button').getBoundingClientRect();
        Win.menu(r.left, r.bottom + 2, [
          { label: 'Match case', checked: np.find.matchCase, action: () => { np.find.matchCase = !np.find.matchCase; refreshFind(np); fq.focus(); } },
          { label: 'Wrap around', checked: np.find.wrap, action: () => { np.find.wrap = !np.find.wrap; fq.focus(); } },
        ]);
      }
    });
    fq.addEventListener('input', () => refreshFind(np));
    const findKeys = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (e.target === fr) { if (e.ctrlKey && e.altKey) replaceAll(np); else replaceOne(np); } else findStep(np, e.shiftKey ? -1 : 1);
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(np); }
    };
    fq.addEventListener('keydown', findKeys);
    fr.addEventListener('keydown', findKeys);

    pages.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(np, np.zoom + (e.deltaY < 0 ? 10 : -10));
    }, { passive: false });
    pages.addEventListener('dragover', e => {
      if (e.dataTransfer?.types?.includes('application/x-win-fs')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    pages.addEventListener('drop', e => {
      if (!e.dataTransfer?.types?.includes('application/x-win-fs')) return;
      e.preventDefault();
      let ids = Win.dragFiles?.ids;
      if (!ids) { try { ids = JSON.parse(e.dataTransfer.getData('application/x-win-fs') || '[]'); } catch { ids = []; } }
      Win.dragFiles = null;
      ids.map(id => Win.FS.get(id)).filter(n => n && n.kind === 'file').forEach(n => openFileTab(np, n.id));
    });

    const onSelection = () => { if (document.activeElement === np.tab?.ta) updateStatus(np); };
    document.addEventListener('selectionchange', onSelection);
    win.cleanup(() => document.removeEventListener('selectionchange', onSelection));
    win.el.addEventListener('win-resize', () => { if (np.find.open && np.tab.back.firstChild) syncBack(np.tab); });
    win.el.addEventListener('keydown', e => onKey(np, e));
  }

  function onKey(np, e) {
    if (e.defaultPrevented || e.target.closest?.('.dlg-smoke')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (ctrl && e.altKey && k === 's') { stop(); saveAll(np); return; }
    if (ctrl && !e.altKey) {
      if (k === 'Tab') { stop(); const i = np.tabs.indexOf(np.tab); activate(np, np.tabs[(i + (e.shiftKey ? -1 : 1) + np.tabs.length) % np.tabs.length]); return; }
      if (e.shiftKey) {
        if (k === 'n') { stop(); openWindow({ newWindow: true }); return; }
        if (k === 's') { stop(); save(np, np.tab, true); return; }
        if (k === 'w') { stop(); np.win.close(); return; }
        return;
      }
      if (k === 'n' || k === 't') { stop(); newTab(np); return; }
      if (k === 'o') { stop(); openDialog(np); return; }
      if (k === 'b' && e.target === np.tab.ta) { stop(); format(np, 'bold'); return; }
      if (k === 'i' && e.target === np.tab.ta) { stop(); format(np, 'italic'); return; }
      if (k === 'k' && e.target === np.tab.ta) { stop(); format(np, 'link'); return; }
      if (k === 's') { stop(); save(np, np.tab); return; }
      if (k === 'w') { stop(); closeTab(np, np.tab); return; }
      if (k === 'f') { stop(); openFind(np); return; }
      if (k === 'h') { stop(); openFind(np, true); return; }
      if (k === 'g') { stop(); goToLine(np); return; }
      if (k === '=' || k === '+') { stop(); setZoom(np, np.zoom + 10); return; }
      if (k === '-') { stop(); setZoom(np, np.zoom - 10); return; }
      if (k === '0') { stop(); setZoom(np, 100); return; }
      if (/^[1-9]$/.test(k)) { stop(); activate(np, np.tabs[Math.min(Number(k), np.tabs.length) - 1]); return; }
    }
    if (k === 'F3') { stop(); findStep(np, e.shiftKey ? -1 : 1); return; }
    if (k === 'F5') { stop(); insertText(np, `${Win.formatTime()} ${Win.formatDate()}`); return; }
    if (k === 'Escape' && np.find.open) { stop(); closeFind(np); }
  }

  Win.Notepad = { binaryText, findOpen };
})(window.Win);
