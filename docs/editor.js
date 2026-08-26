/* ============================================================================
   DOCS — the word processor
   ---------------------------------------------------------------------------
   One contenteditable sheet, a store in localStorage, and no server. Nothing
   typed here is transmitted anywhere; the only I/O is the file picker and the
   download link, both of which the user drives.

   A NOTE ON execCommand. It is deprecated, and it is still the only rich-text
   engine every browser ships. The alternative is a custom model — a document
   tree, a selection mapper, an undo stack — which is a library, not a page.
   So this uses execCommand deliberately, and every mutation that could have
   been done with raw DOM surgery is routed through insertHTML/insertText
   instead, because that is what keeps the NATIVE UNDO STACK intact. Where a
   mutation genuinely cannot go through it, the comment says so.
   ========================================================================= */

(function () {
'use strict';

var $ = function (id) { return document.getElementById(id); };
var CAS = window.CAS || {};
var toast = CAS.toast || function () {};

var doc    = $('doc'),
    leaf   = $('leaf'),
    deck   = $('deck'),
    ruler  = $('ruler'),
    breaks = $('breaks'),
    zoomer = $('zoomer');

/* ── CONSTANTS ───────────────────────────────────────────────────────────── */

var DPI = 96;                                   /* the canonical CSS inch */

var SHEETS = {
    letter:  { w: 8.5,  h: 11,    name: 'LETTER'  },
    legal:   { w: 8.5,  h: 14,    name: 'LEGAL'   },
    tabloid: { w: 11,   h: 17,    name: 'TABLOID' },
    a4:      { w: 8.27, h: 11.69, name: 'A4'      },
    a5:      { w: 5.83, h: 8.27,  name: 'A5'      }
};

/* top, right, bottom, left — in inches */
var MARGINS = {
    normal:   [1, 1, 1, 1],
    narrow:   [0.5, 0.5, 0.5, 0.5],
    moderate: [1, 0.75, 1, 0.75],
    wide:     [1, 2, 1, 2]
};

var ZOOMS = [0.5, 0.65, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

var STORE = 'isa.docs.v1';
var WPM   = 220;                                /* for the reading estimate */

var PAL = [
    '#000000','#3d3d3d','#5c5c5c','#7a7a7a','#999999','#b8b8b8','#d6d6d6','#eaeaea','#f5f5f5','#ffffff',
    '#5b0f00','#7f2a00','#7f6000','#274e13','#0c343d','#073763','#20124d','#4c1130','#660000','#1c1c1c',
    '#a61c00','#cc4125','#bf9000','#38761d','#134f5c','#1155cc','#351c75','#741b47','#cc0000','#555555',
    '#e06666','#f6b26b','#ffd966','#93c47d','#76a5af','#6d9eeb','#8e7cc3','#c27ba0','#ff2d2d','#8a8a8a',
    '#f4cccc','#fce5cd','#fff2cc','#d9ead3','#d0e0e3','#cfe2f3','#d9d2e9','#ead1dc','#ffe14d','#c9c9c9'
];

var SYMS = {
    'PUNCTUATION': '— – ‑ … « » “ ” ‘ ’ ‚ „ • ‣ · ¶ § † ‡ ′ ″ ‰ ¿ ¡ ‽ ⁂ ⁄',
    'MATHS':       '× ÷ ± ∓ ≈ ≠ ≡ ≤ ≥ ∞ ∑ ∏ √ ∫ ∂ ∆ ∇ ∈ ∉ ⊂ ⊃ ∪ ∩ ∧ ∨ ¬ ∀ ∃ ∅ ° µ ‰ ½ ⅓ ¼ ¾ ⅔',
    'CURRENCY':    '$ € £ ¥ ¢ ₹ ₽ ₩ ₪ ₺ ₴ ₦ ₱ ₫ ₡ ₲ ¤ ₿',
    'ARROWS':      '← → ↑ ↓ ↔ ↕ ↖ ↗ ↘ ↙ ⇐ ⇒ ⇔ ↵ ⇧ ⌘ ⌥ ⌃ ⎋ ⏎ ▲ ▼ ◀ ▶ ⟶ ⟵',
    'GREEK':       'α β γ δ ε ζ η θ ι κ λ μ ν ξ π ρ σ τ υ φ χ ψ ω Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω',
    'MARKS':       '© ® ™ ℠ ℅ № ℮ ✓ ✔ ✗ ✘ ★ ☆ ☐ ☑ ☒ ♠ ♥ ♦ ♣ ♪ ♫ ⚠ ☰ ◆ ◇ ● ○ ■ □'
};

/* ── STATE ───────────────────────────────────────────────────────────────── */

var state = {
    docs: {},
    order: [],
    active: null,
    view: { outline: true, comments: true, ruler: true, margins: false,
            breaks: true, stock: false, focus: false, spell: true, zoom: 1 }
};

function blankSetup() {
    return { size: 'letter', orient: 'p', m: [1, 1, 1, 1],
             font: "Georgia, 'Times New Roman', serif", fontSize: 11,
             lead: 1.5, after: 8 };
}

function newDoc(title, html) {
    var now = Date.now();
    return {
        id: 'd' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36),
        title: title || 'Untitled document',
        html: html || '<p><br></p>',
        created: now, updated: now,
        setup: blankSetup(),
        comments: [],
        scroll: 0
    };
}

function active() { return state.docs[state.active]; }

/* ── STORE ───────────────────────────────────────────────────────────────── */

var dirty = false, saveTimer = null, saveFails = 0, lastFailToast = 0;

function load() {
    var raw;
    try { raw = localStorage.getItem(STORE); } catch (e) { raw = null; }
    if (raw) {
        try {
            var d = JSON.parse(raw);
            state.docs   = d.docs   || {};
            state.order  = d.order  || Object.keys(state.docs);
            state.active = d.active || state.order[0];
            if (d.view) for (var k in d.view) if (k in state.view) state.view[k] = d.view[k];
        } catch (e) { /* a corrupt store is not worth losing the session over */ }
    }
    /* Repair anything the parse left dangling, and seed a first document. */
    for (var i = state.order.length - 1; i >= 0; i--) {
        if (!state.docs[state.order[i]]) state.order.splice(i, 1);
    }
    for (var id in state.docs) {
        if (state.order.indexOf(id) < 0) state.order.push(id);
        var doc0 = state.docs[id];
        if (!doc0.setup) doc0.setup = blankSetup();
        if (!doc0.comments) doc0.comments = [];
    }
    if (!state.order.length) {
        var first = seedDoc();
        state.docs[first.id] = first;
        state.order.push(first.id);
        state.active = first.id;
    }
    if (!state.docs[state.active]) state.active = state.order[0];
}

function save() {
    var d = active();
    if (d) {
        clearHits();                       /* search marks are never stored */
        d.html = doc.innerHTML;
        d.updated = Date.now();
        d.scroll = deck.scrollTop;
    }
    try {
        localStorage.setItem(STORE, JSON.stringify({
            docs: state.docs, order: state.order, active: state.active, view: state.view
        }));
        setSaved(true);
        dirty = false;
        saveFails = 0;
    } catch (e) {
        /* Quota is the realistic failure: embedded images are data URIs and
           they are large. Say so plainly rather than failing silently.

           `dirty` MUST stay true here. It used to be cleared unconditionally
           below this block, which meant a failed save told the rest of the
           editor the work was safe: the beforeunload flush is gated on `dirty`,
           so stopping typing after a failed save — exactly what inserting a
           large image looks like — let the tab close on unsaved work without a
           word. A save that did not happen is not a save. */
        saveFails++;
        setSaved(false, true);

        /* One warning per run of failures, not one per keystroke. */
        var now = Date.now();
        if (now - lastFailToast > 8000) {
            lastFailToast = now;
            toast('STORAGE FULL — DOWNLOAD THIS DOCUMENT', true);
        }
        /* And back off, so a full store is not re-serialised every 700ms. */
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, Math.min(30000, 2000 * saveFails));
    }
}

function touched() {
    dirty = true;
    setSaved(false);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
    scheduleReflow();
}

function setSaved(ok, bad) {
    var led = $('saveLed'), tx = $('saveTx');
    led.className = 'led on' + (bad ? ' red' : ok ? ' green' : '');
    tx.textContent = bad ? 'NOT SAVED' : ok ? 'SAVED' : 'SAVING';
}

/* ── PAGE GEOMETRY ───────────────────────────────────────────────────────── */

function geo() {
    var s = active().setup, sh = SHEETS[s.size] || SHEETS.letter;
    var w = s.orient === 'l' ? sh.h : sh.w;
    var h = s.orient === 'l' ? sh.w : sh.h;
    return { w: w * DPI, h: h * DPI, sh: sh,
             mt: s.m[0] * DPI, mr: s.m[1] * DPI, mb: s.m[2] * DPI, ml: s.m[3] * DPI };
}

function applySetup() {
    var s = active().setup, g = geo(), r = document.documentElement.style;
    r.setProperty('--pw', g.w + 'px');
    r.setProperty('--ph', g.h + 'px');
    r.setProperty('--mt', g.mt + 'px');
    r.setProperty('--mr', g.mr + 'px');
    r.setProperty('--mb', g.mb + 'px');
    r.setProperty('--ml', g.ml + 'px');
    doc.style.setProperty('--doc-font', s.font);
    doc.style.setProperty('--doc-size', s.fontSize + 'pt');
    doc.style.setProperty('--doc-lead', s.lead);
    doc.style.setProperty('--doc-after', s.after + 'pt');
    $('stSheet').textContent = g.sh.name + (s.orient === 'l' ? ' ·L' : '');
    writePageRule(g, s);
    drawRuler();
    reflow();
}

/* @page cannot read custom properties — it is resolved outside the document
   tree, so var() is not available to it. The rule therefore has to be WRITTEN,
   and rewritten whenever the setup changes. Without this the print output
   silently ignores the sheet size and margins that the ruler, the break guides
   and both exports all honour: the one place the page setup is supposed to
   matter most is the one place it was not being applied. */
function writePageRule(g, s) {
    var el = $('pageRule');
    if (!el) {
        el = document.createElement('style');
        el.id = 'pageRule';
        document.head.appendChild(el);
    }
    el.textContent = '@page { size: ' + (g.w / DPI) + 'in ' + (g.h / DPI) + 'in;'
        + ' margin: ' + s.m[0] + 'in ' + s.m[1] + 'in ' + s.m[2] + 'in ' + s.m[3] + 'in; }';
}

/* The ruler is redrawn rather than scaled, because a tick that has been
   stretched by a zoom is no longer a measurement. */
function drawRuler() {
    var g = geo(), inches = g.w / DPI, html = '';
    html += '<span class="marg" style="left:0;width:' + g.ml + 'px"></span>';
    html += '<span class="marg" style="right:0;width:' + g.mr + 'px"></span>';
    for (var i = 0; i <= inches * 8; i++) {
        var x = i * DPI / 8, cls = 'tk';
        if (i % 8 === 0) cls += ' inch'; else if (i % 4 === 0) cls += ' half';
        if (x > g.w) break;
        html += '<span class="' + cls + '" style="left:' + x + 'px"></span>';
        if (i % 8 === 0 && i > 0 && x < g.w - 6) {
            html += '<span class="nm" style="left:' + x + 'px">' + (i / 8) + '</span>';
        }
    }
    ruler.innerHTML = html;
}

/* Where the flow will break. The leaf grows to whole sheets so the guides
   land on real page boundaries rather than stopping with the text. */
var reflowTimer = null, breakSig = null;
function scheduleReflow() { clearTimeout(reflowTimer); reflowTimer = setTimeout(reflow, 140); }

function reflow() {
    var g = geo(), contentH = g.h - g.mt - g.mb;
    if (contentH < 40) contentH = 40;
    var pages = Math.max(1, Math.ceil((doc.scrollHeight - 1) / contentH));
    leaf.style.minHeight = (pages * g.h) + 'px';

    /* The guides are rewritten only when they would actually differ. reflow()
       runs on every keystroke, and re-setting innerHTML each time would rebuild
       identical elements — which restarts their fade-in, so the guides would
       pulse the whole time you were typing. Cheaper and calmer to compare. */
    var sig = pages + '|' + contentH + '|' + g.mt + '|' + (state.view.breaks ? 1 : 0);
    if (sig !== breakSig) {
        breakSig = sig;
        var html = '';
        if (state.view.breaks) {
            for (var n = 1; n < pages; n++) {
                html += '<div class="pbreak" style="top:' + (g.mt + n * contentH) + 'px">'
                     +  '<span>PAGE ' + (n + 1) + '</span></div>';
            }
        }
        breaks.innerHTML = html;
    }
    pageTotal = pages;
    updateStats();
    updatePageNo();
}

var pageTotal = 1;

function updatePageNo() {
    var g = geo(), contentH = g.h - g.mt - g.mb, at = 1;
    var sel = window.getSelection();
    if (sel && sel.rangeCount && doc.contains(sel.anchorNode)) {
        var r = sel.getRangeAt(0).cloneRange(), rect = r.getBoundingClientRect();
        if (!rect.height && r.startContainer.nodeType === 1) rect = r.startContainer.getBoundingClientRect();
        if (rect.height || rect.top) {
            var y = (rect.top - doc.getBoundingClientRect().top) / state.view.zoom;
            at = Math.min(pageTotal, Math.max(1, Math.floor(y / contentH) + 1));
        }
    }
    $('stPage').textContent = at + ' / ' + pageTotal;
}

/* ── SELECTION HELPERS ───────────────────────────────────────────────────── */

var savedRange = null;

function saveSel() {
    var s = window.getSelection();
    if (s && s.rangeCount && doc.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
}

function restoreSel() {
    if (!savedRange) { doc.focus(); return; }
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(savedRange);
    doc.focus();
}

function selText() {
    var s = window.getSelection();
    return s && s.rangeCount ? s.toString() : '';
}

/* Every block the selection touches, paragraph-level only. */
function selBlocks() {
    var s = window.getSelection();
    if (!s || !s.rangeCount) return [];
    var r = s.getRangeAt(0), out = [];
    var all = doc.querySelectorAll('p,h1,h2,h3,h4,h5,h6,blockquote,pre,li');
    for (var i = 0; i < all.length; i++) if (r.intersectsNode(all[i])) out.push(all[i]);
    if (!out.length) {
        var n = r.startContainer;
        while (n && n !== doc && (n.nodeType !== 1 || !/^(P|H[1-6]|BLOCKQUOTE|PRE|LI)$/.test(n.nodeName))) n = n.parentNode;
        if (n && n !== doc) out.push(n);
    }
    return out;
}

function closestIn(node, sel) {
    while (node && node !== doc) {
        if (node.nodeType === 1 && node.matches && node.matches(sel)) return node;
        node = node.parentNode;
    }
    return null;
}

function caretNode() {
    var s = window.getSelection();
    return s && s.rangeCount ? s.getRangeAt(0).startContainer : null;
}

/* ── FORMATTING ──────────────────────────────────────────────────────────── */

function exec(cmd, val) {
    doc.focus();
    try { document.execCommand(cmd, false, val === undefined ? null : val); }
    catch (e) { return false; }
    touched();
    syncToolbar();
    return true;
}

/* execCommand('fontSize') only speaks 1–7. The standard way out is to tag the
   run with size 7, then rewrite those tags to a real point size — which keeps
   the whole operation inside one undo entry. */
function setFontSize(pt) {
    doc.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontSize', false, '7');
    var tagged = doc.querySelectorAll('font[size="7"], span[style*="xxx-large"]');
    for (var i = 0; i < tagged.length; i++) {
        var el = tagged[i], sp = document.createElement('span');
        sp.style.fontSize = pt + 'pt';
        while (el.firstChild) sp.appendChild(el.firstChild);
        el.parentNode.replaceChild(sp, el);
    }
    touched();
}

/* execCommand('fontName') takes ONE family name. Handed a stack it reports
   success and does nothing at all — which is how a font picker ends up looking
   broken. So the same sentinel trick as the size: tag the run with a name
   nothing else uses, then rewrite those tags to carry the whole stack, keeping
   the fallbacks the user's machine may actually need. */
function setFontFamily(stack) {
    doc.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontName', false, 'IsaDocsFace');
    var tagged = doc.querySelectorAll('[style*="IsaDocsFace"], font[face="IsaDocsFace"]');
    for (var i = 0; i < tagged.length; i++) {
        var el = tagged[i], sp = document.createElement('span');
        sp.style.fontFamily = stack;
        while (el.firstChild) sp.appendChild(el.firstChild);
        el.parentNode.replaceChild(sp, el);
    }
    touched();
}

var BLOCKS = {
    p:     { tag: 'p',          cls: '' },
    title: { tag: 'h1',         cls: 's-title' },
    sub:   { tag: 'h2',         cls: 's-sub' },
    h1:    { tag: 'h1',         cls: '' },
    h2:    { tag: 'h2',         cls: '' },
    h3:    { tag: 'h3',         cls: '' },
    h4:    { tag: 'h4',         cls: '' },
    quote: { tag: 'blockquote', cls: '' },
    code:  { tag: 'pre',        cls: '' }
};

function setBlock(kind) {
    var b = BLOCKS[kind];
    if (!b) return;
    doc.focus();
    document.execCommand('formatBlock', false, '<' + b.tag + '>');
    /* formatBlock cannot carry a class, so Title and Subtitle get theirs in a
       second pass. A className change is not an undo entry — the tag change
       that precedes it is, and undoing that takes the class with it. */
    var blocks = selBlocks();
    for (var i = 0; i < blocks.length; i++) {
        var el = blocks[i];
        if (el.nodeName.toLowerCase() !== b.tag) continue;
        el.classList.remove('s-title', 's-sub');
        if (b.cls) el.classList.add(b.cls);
    }
    touched();
    syncToolbar();
}

function setAlign(how) {
    exec({ left: 'justifyLeft', center: 'justifyCenter',
           right: 'justifyRight', justify: 'justifyFull' }[how]);
}

function setLead(v) {
    var blocks = selBlocks();
    if (!blocks.length) { active().setup.lead = parseFloat(v); applySetup(); return; }
    for (var i = 0; i < blocks.length; i++) blocks[i].style.lineHeight = v;
    touched();
}

/* The checklist is an unordered list wearing a class, so it inherits every
   piece of list behaviour the browser already implements — nesting, Enter to
   continue, Backspace to unwrap — instead of reimplementing them. */
function toggleTask() {
    doc.focus();
    var ul = closestIn(caretNode(), 'ul');
    if (ul) { ul.classList.toggle('task'); touched(); return; }
    document.execCommand('insertUnorderedList');
    ul = closestIn(caretNode(), 'ul');
    if (ul) ul.classList.add('task');
    touched();
}

function clearFormat() {
    doc.focus();
    document.execCommand('removeFormat');
    var blocks = selBlocks();
    for (var i = 0; i < blocks.length; i++) {
        blocks[i].removeAttribute('style');
        blocks[i].classList.remove('s-title', 's-sub');
    }
    document.execCommand('formatBlock', false, '<p>');
    touched();
    syncToolbar();
}

/* Format painter: lift the computed run styles at the caret, then stamp them
   onto the next selection. */
var painter = null;

function togglePainter() {
    var key = $('painterKey');
    if (painter) { painter = null; key.setAttribute('aria-pressed', 'false'); return; }
    var n = caretNode();
    if (!n) return;
    var el = n.nodeType === 1 ? n : n.parentNode;
    var cs = getComputedStyle(el);
    painter = {
        font: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight,
        style: cs.fontStyle, deco: cs.textDecorationLine, color: cs.color
    };
    key.setAttribute('aria-pressed', 'true');
    toast('PICK UP — NOW SELECT THE TARGET');
}

function stampPainter() {
    if (!painter || !selText()) return;
    var p = painter;
    var css = 'font-family:' + p.font + ';font-size:' + p.size + ';font-weight:' + p.weight
            + ';font-style:' + p.style + ';color:' + p.color
            + (/(underline|line-through)/.test(p.deco) ? ';text-decoration:' + p.deco : '');
    var html = '<span style="' + css.replace(/"/g, "'") + '">' + escapeHTML(selText()) + '</span>';
    exec('insertHTML', html);
    painter = null;
    $('painterKey').setAttribute('aria-pressed', 'false');
}

/* ── TOOLBAR STATE ───────────────────────────────────────────────────────── */

function q(cmd) { try { return document.queryCommandState(cmd); } catch (e) { return false; } }

function press(sel, on) {
    var el = document.querySelector(sel);
    if (el) el.setAttribute('aria-pressed', on ? 'true' : 'false');
}

var syncTimer = null;
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(syncToolbar, 60); }

function syncToolbar() {
    press('[data-cmd="fmt.bold"]',      q('bold'));
    press('[data-cmd="fmt.italic"]',    q('italic'));
    press('[data-cmd="fmt.underline"]', q('underline'));
    press('[data-cmd="fmt.strike"]',    q('strikeThrough'));
    press('[data-cmd="fmt.sup"]',       q('superscript'));
    press('[data-cmd="fmt.sub"]',       q('subscript'));
    press('[data-cmd="al.left"]',       q('justifyLeft'));
    press('[data-cmd="al.center"]',     q('justifyCenter'));
    press('[data-cmd="al.right"]',      q('justifyRight'));
    press('[data-cmd="al.justify"]',    q('justifyFull'));
    press('[data-cmd="li.ul"]',         q('insertUnorderedList'));
    press('[data-cmd="li.ol"]',         q('insertOrderedList'));

    var n = caretNode();
    if (n) {
        var el = n.nodeType === 1 ? n : n.parentNode;
        var blk = closestIn(el, 'p,h1,h2,h3,h4,blockquote,pre,li');
        if (blk) {
            var tag = blk.nodeName.toLowerCase(), kind = 'p';
            if (blk.classList.contains('s-title')) kind = 'title';
            else if (blk.classList.contains('s-sub')) kind = 'sub';
            else if (tag === 'blockquote') kind = 'quote';
            else if (tag === 'pre') kind = 'code';
            else if (/^h[1-4]$/.test(tag)) kind = tag;
            $('stylePick').value = kind;
            var lh = blk.style.lineHeight;
            if (lh) $('leadPick').value = lh;
        }
        var cs = getComputedStyle(el);
        var px = parseFloat(cs.fontSize);
        if (px) $('sizeIn').value = Math.round(px * 72 / DPI * 10) / 10;
        /* Mark the cell the caret sits in, so the TABLE menu is unambiguous. */
        var old = doc.querySelector('.cell-on');
        if (old) old.classList.remove('cell-on');
        var cell = closestIn(el, 'td,th');
        if (cell) cell.classList.add('cell-on');
    }
    updatePageNo();
}

/* ── PALETTES ────────────────────────────────────────────────────────────── */

function buildPal(el, kind) {
    var html = '';
    for (var i = 0; i < PAL.length; i++) {
        html += '<button type="button" data-c="' + PAL[i] + '" style="background:' + PAL[i] + '" aria-label="' + PAL[i] + '"></button>';
    }
    html += '<button type="button" class="key pal-wide" data-c="none">'
         +  (kind === 'mark' ? 'NO HIGHLIGHT' : 'AUTOMATIC') + '</button>';
    el.innerHTML = html;
    el.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        var c = b.getAttribute('data-c');
        restoreSel();
        document.execCommand('styleWithCSS', false, true);
        if (kind === 'mark') {
            var v = c === 'none' ? 'transparent' : c;
            if (!exec('hiliteColor', v)) exec('backColor', v);
            $('markKey').style.setProperty('--sw', c === 'none' ? '#00000000' : c);
        } else {
            exec('foreColor', c === 'none' ? (state.view.stock ? '#d9dde3' : '#1a1c20') : c);
            $('inkKey').style.setProperty('--sw', c === 'none' ? '#1a1c20' : c);
        }
        el.classList.remove('open');
    });
}

function wirePal(keyId, palId, kind) {
    var key = $(keyId), pal = $(palId);
    buildPal(pal, kind);
    key.addEventListener('click', function (e) {
        e.stopPropagation();
        saveSel();
        var open = pal.classList.contains('open');
        closeAllPals();
        if (!open) pal.classList.add('open');
    });
}

function closeAllPals() {
    var p = document.querySelectorAll('.pal.open');
    for (var i = 0; i < p.length; i++) p[i].classList.remove('open');
}

/* ── INSERTS ─────────────────────────────────────────────────────────────── */

function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

/* A URL is about to become an href, so anything that is not plainly a web or
   mail address is refused rather than sanitised into something surprising. */
function safeURL(raw) {
    var u = String(raw || '').trim();
    if (!u) return null;
    if (/^(https?:|mailto:|tel:|#|\/|\.)/i.test(u)) {
        if (/^\s*javascript:/i.test(u) || /^\s*data:/i.test(u)) return null;
        return u;
    }
    if (/^[\w.-]+@[\w.-]+\.\w+$/.test(u)) return 'mailto:' + u;
    if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(u)) return 'https://' + u;
    return null;
}

function insLink() {
    saveSel();
    var a = closestIn(caretNode(), 'a');
    $('lText').value = a ? a.textContent : selText();
    $('lUrl').value  = a ? a.getAttribute('href') : '';
    $('btnLinkRemove').style.display = a ? '' : 'none';
    openModal('linkModal');
    setTimeout(function () { $('lUrl').focus(); }, 30);
}

function applyLink() {
    var url = safeURL($('lUrl').value), text = $('lText').value;
    if (!url) { toast('THAT IS NOT A USABLE ADDRESS', true); return; }
    restoreSel();
    var a = closestIn(caretNode(), 'a');
    if (a) {
        a.setAttribute('href', url);
        a.setAttribute('rel', 'noopener noreferrer');
        a.setAttribute('target', '_blank');
        if (text) a.textContent = text;
        touched();
    } else {
        exec('insertHTML', '<a href="' + escapeHTML(url) + '" target="_blank" rel="noopener noreferrer">'
                         + escapeHTML(text || url) + '</a>&nbsp;');
    }
    closeModal('linkModal');
}

function removeLink() { restoreSel(); exec('unlink'); closeModal('linkModal'); }

var gridR = 2, gridC = 2;

function buildGrid() {
    var g = $('gridPick'), html = '';
    for (var r = 1; r <= 8; r++) for (var c = 1; c <= 10; c++) {
        html += '<i data-r="' + r + '" data-c="' + c + '"></i>';
    }
    g.innerHTML = html;
    g.addEventListener('mouseover', function (e) {
        if (e.target.tagName !== 'I') return;
        gridR = +e.target.getAttribute('data-r');
        gridC = +e.target.getAttribute('data-c');
        litGrid();
    });
    g.addEventListener('click', function (e) { if (e.target.tagName === 'I') insTable(); });
    litGrid();
}

function litGrid() {
    var cells = $('gridPick').children;
    for (var i = 0; i < cells.length; i++) {
        var el = cells[i];
        el.classList.toggle('lit', +el.getAttribute('data-r') <= gridR && +el.getAttribute('data-c') <= gridC);
    }
    $('gridRead').textContent = gridR + ' × ' + gridC;
}

function insTable() {
    restoreSel();
    var head = $('tHead').checked, html = '<table>';
    if (head) {
        html += '<thead><tr>';
        for (var c = 0; c < gridC; c++) html += '<th><br></th>';
        html += '</tr></thead>';
    }
    html += '<tbody>';
    for (var r = head ? 1 : 0; r < gridR; r++) {
        html += '<tr>';
        for (var c2 = 0; c2 < gridC; c2++) html += '<td><br></td>';
        html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    exec('insertHTML', html);
    closeModal('tableModal');
}

function insImage() {
    var file = $('imgFile').files[0];
    var w = Math.min(100, Math.max(5, +$('imgW').value || 100));
    var alt = escapeHTML($('imgAlt').value);
    var cap = $('imgCap').value;

    function place(src) {
        var img = '<img src="' + src + '" alt="' + alt + '" style="width:' + w + '%">';
        var html = cap
            ? '<figure>' + img + '<figcaption>' + escapeHTML(cap) + '</figcaption></figure><p><br></p>'
            : img;
        restoreSel();
        exec('insertHTML', html);
        closeModal('imageModal');
        $('imgFile').value = ''; $('imgUrl').value = ''; $('imgCap').value = ''; $('imgAlt').value = '';
    }

    if (file) {
        var fr = new FileReader();
        fr.onload = function () { place(fr.result); };
        fr.onerror = function () { toast('COULD NOT READ THAT FILE', true); };
        fr.readAsDataURL(file);
        return;
    }
    var u = safeURL($('imgUrl').value);
    if (!u) { toast('CHOOSE A FILE OR GIVE AN ADDRESS', true); return; }
    place(escapeHTML(u));
}

function buildSyms() {
    var tabs = $('symTabs'), grid = $('symGrid'), names = Object.keys(SYMS), html = '';
    for (var i = 0; i < names.length; i++) {
        html += '<button class="key' + (i ? '' : ' latched') + '" type="button" data-sym="' + names[i] + '">' + names[i] + '</button>';
    }
    tabs.innerHTML = html;
    tabs.addEventListener('click', function (e) {
        var b = e.target.closest('[data-sym]');
        if (!b) return;
        var all = tabs.querySelectorAll('.key');
        for (var j = 0; j < all.length; j++) all[j].classList.remove('latched');
        b.classList.add('latched');
        fillSyms(b.getAttribute('data-sym'));
    });
    grid.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        restoreSel();
        exec('insertText', b.textContent);
    });
    fillSyms(names[0]);
}

function fillSyms(name) {
    var chars = SYMS[name].split(' '), html = '';
    for (var i = 0; i < chars.length; i++) {
        if (chars[i]) html += '<button type="button">' + escapeHTML(chars[i]) + '</button>';
    }
    $('symGrid').innerHTML = html;
}

function insDate() {
    var d = new Date();
    exec('insertText', d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
                     + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
}

function insTOC() {
    var hs = doc.querySelectorAll('h1:not(.s-title), h2:not(.s-sub), h3, h4');
    if (!hs.length) { toast('NO HEADINGS TO LIST', true); return; }
    var html = '<div class="toc" contenteditable="false"><div class="toc-h">CONTENTS</div>';
    for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        if (!h.id) h.id = 'h' + i + '-' + Math.random().toString(36).slice(2, 7);
        html += '<a class="toc-row d' + h.nodeName[1] + '" href="#' + h.id + '">' + escapeHTML(h.textContent) + '</a>';
    }
    html += '</div><p><br></p>';
    var old = doc.querySelector('.toc');
    if (old) old.parentNode.removeChild(old);
    restoreSel();
    exec('insertHTML', html);
}

function insFootnote() {
    var list = doc.querySelector('.fn-list');
    if (!list) {
        doc.insertAdjacentHTML('beforeend', '<div class="fn-list"></div>');
        list = doc.querySelector('.fn-list');
    }
    var id = 'fn' + Date.now().toString(36);
    /* The marker is an anchor, not a <sup>. Two reasons, one practical and one
       semantic: insertHTML canonicalises sup/sub as style elements and throws
       the class and data attribute away, while an anchor survives intact — and
       a footnote reference really is a link to its note, so clicking the number
       jumps to it for free. The superscripting is done in CSS. */
    exec('insertHTML', '<a class="fn-ref" data-fn="' + id + '" href="#fn-' + id + '">0</a>');
    var row = document.createElement('p');
    row.setAttribute('data-fn', id);
    row.id = 'fn-' + id;
    row.innerHTML = '<span class="fn-no">0</span> ';
    list.appendChild(row);
    renumberFootnotes();
    /* Put the caret in the new note so the user types where Word would put them. */
    var r = document.createRange();
    r.selectNodeContents(row);
    r.collapse(false);
    var s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    doc.focus();
    touched();
}

/* Notes are numbered by the order their markers appear in the text, not the
   order they were created — so deleting a marker mid-document renumbers the
   rest, the way Word does. */
function renumberFootnotes() {
    var refs = doc.querySelectorAll('a.fn-ref'), list = doc.querySelector('.fn-list');
    if (!list) return;
    for (var i = 0; i < refs.length; i++) {
        refs[i].textContent = (i + 1);
        var row = list.querySelector('[data-fn="' + refs[i].getAttribute('data-fn') + '"]');
        if (row) {
            var no = row.querySelector('.fn-no');
            if (no) no.textContent = (i + 1);
            list.appendChild(row);            /* keep the notes in text order */
        }
    }
    /* A note whose marker has been deleted has nothing left to point at. */
    var rows = list.querySelectorAll('[data-fn]');
    for (var j = 0; j < rows.length; j++) {
        if (!doc.querySelector('a.fn-ref[data-fn="' + rows[j].getAttribute('data-fn') + '"]')) {
            rows[j].parentNode.removeChild(rows[j]);
        }
    }
    /* Only when the last MARKER is gone. Testing the rows instead would delete
       the list during an insertion: execCommand fires `input` synchronously,
       so this runs once with the marker already placed and its note not yet
       appended — and the note would then be added to a detached list. */
    if (!refs.length) list.parentNode.removeChild(list);
}

/* ── TABLE OPERATIONS ────────────────────────────────────────────────────── */

function curCell() { return closestIn(caretNode(), 'td,th'); }

/* Drop the caret into a node and make it the live selection. Every structural
   table edit ends with one of these: deleting the row the caret was in leaves
   the selection pointing at a detached node, and the next table command would
   then find no cell and refuse to run. */
function caretInto(node) {
    if (!node || !doc.contains(node)) { doc.focus(); return; }
    var r = document.createRange();
    r.selectNodeContents(node);
    r.collapse(true);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    savedRange = r.cloneRange();
    doc.focus();
    syncToolbar();
}

function tableOp(op) {
    var cell = curCell();
    if (!cell) { toast('PUT THE CARET IN A TABLE FIRST', true); return; }
    var row = cell.parentNode, table = closestIn(cell, 'table'), ix = cell.cellIndex;
    var landing = null;

    if (op === 'rowAbove' || op === 'rowBelow') {
        var nr = row.cloneNode(true);
        for (var i = 0; i < nr.cells.length; i++) {
            nr.cells[i].innerHTML = '<br>';
            nr.cells[i].classList.remove('cell-on');
            /* A duplicated header row would give the table two heads. */
            if (nr.cells[i].nodeName === 'TH') {
                var td = document.createElement('td');
                td.innerHTML = '<br>';
                nr.replaceChild(td, nr.cells[i]);
            }
        }
        if (op === 'rowAbove') row.parentNode.insertBefore(nr, row);
        else row.parentNode.insertBefore(nr, row.nextSibling);
        landing = nr.cells[Math.min(ix, nr.cells.length - 1)];

    } else if (op === 'colLeft' || op === 'colRight') {
        var rows = table.rows;
        for (var r = 0; r < rows.length; r++) {
            var ref = rows[r].cells[ix];
            var nc = document.createElement(ref && ref.nodeName === 'TH' ? 'th' : 'td');
            nc.innerHTML = '<br>';
            rows[r].insertBefore(nc, op === 'colLeft' ? ref : (ref ? ref.nextSibling : null));
            if (rows[r] === row) landing = nc;
        }

    } else if (op === 'delRow') {
        /* Land in the same column of whichever row takes this one's place. */
        var next = row.nextElementSibling || row.previousElementSibling;
        if (!next) {
            var otherSection = row.parentNode.nextElementSibling || row.parentNode.previousElementSibling;
            next = otherSection && otherSection.rows ? otherSection.rows[0] : null;
        }
        if (table.rows.length <= 1) {
            landing = afterTable(table);
            table.parentNode.removeChild(table);
        } else {
            row.parentNode.removeChild(row);
            landing = next && next.cells ? next.cells[Math.min(ix, next.cells.length - 1)] : afterTable(table);
        }

    } else if (op === 'delCol') {
        var rows2 = table.rows;
        if (rows2[0].cells.length <= 1) {
            landing = afterTable(table);
            table.parentNode.removeChild(table);
        } else {
            for (var r2 = 0; r2 < rows2.length; r2++) {
                if (rows2[r2].cells[ix]) rows2[r2].deleteCell(ix);
            }
            landing = row.cells[Math.min(ix, row.cells.length - 1)];
        }

    } else if (op === 'delTable') {
        landing = afterTable(table);
        table.parentNode.removeChild(table);

    } else if (op === 'header') {
        var first = table.rows[0], isHead = first.cells[0].nodeName === 'TH';
        var wasInFirst = (row === first);
        for (var c = 0; c < first.cells.length; c++) {
            var old = first.cells[c], nu = document.createElement(isHead ? 'td' : 'th');
            while (old.firstChild) nu.appendChild(old.firstChild);
            first.replaceChild(nu, old);
        }
        /* The caret's cell was just replaced by a different element. */
        landing = wasInFirst ? first.cells[Math.min(ix, first.cells.length - 1)] : cell;
    }
    /* Structural table edits are raw DOM — execCommand has no vocabulary for
       rows and columns, so these fall outside the native undo stack. */
    touched();
    caretInto(landing);
}

/* Somewhere to put the caret when the table itself goes away. */
function afterTable(table) {
    var n = table.nextElementSibling;
    if (!n) {
        n = document.createElement('p');
        n.innerHTML = '<br>';
        table.parentNode.insertBefore(n, table.nextSibling);
    }
    return n;
}

/* Tab walks the table the way it does in Word, and only inside one. */
function tableTab(e) {
    var cell = curCell();
    if (!cell) return false;
    var cells = Array.prototype.slice.call(closestIn(cell, 'table').querySelectorAll('td,th'));
    var i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1);
    if (i < 0) return false;
    if (i >= cells.length) { tableOp('rowBelow'); cells = Array.prototype.slice.call(closestIn(cell, 'table').querySelectorAll('td,th')); }
    var target = cells[i];
    if (!target) return false;
    var r = document.createRange();
    r.selectNodeContents(target);
    r.collapse(true);
    var s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    return true;
}

/* ── FIND & REPLACE ──────────────────────────────────────────────────────── */

var hits = [], hitIx = -1;

function clearHits() {
    var m = doc.querySelectorAll('mark.hit');
    for (var i = 0; i < m.length; i++) {
        var el = m[i], p = el.parentNode;
        while (el.firstChild) p.insertBefore(el.firstChild, el);
        p.removeChild(el);
    }
    if (m.length) doc.normalize();
    hits = []; hitIx = -1;
}

function runFind() {
    clearHits();
    var qs = $('fFind').value;
    if (!qs) { paintHitCount(); return; }
    var pat = qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if ($('fWhole').checked) pat = '\\b' + pat + '\\b';
    var re;
    try { re = new RegExp(pat, $('fCase').checked ? 'g' : 'gi'); }
    catch (e) { paintHitCount(); return; }

    var walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) if (n.nodeValue.trim()) nodes.push(n);

    for (var i = 0; i < nodes.length; i++) {
        var t = nodes[i], s = t.nodeValue, spans = [], mm;
        re.lastIndex = 0;
        while ((mm = re.exec(s))) {
            if (mm[0] === '') { re.lastIndex++; continue; }
            spans.push([mm.index, mm.index + mm[0].length]);
        }
        /* Wrap back to front: surroundContents splits the node, and every
           earlier offset is still valid in the head that stays behind. */
        for (var j = spans.length - 1; j >= 0; j--) {
            var r = document.createRange();
            r.setStart(t, spans[j][0]);
            r.setEnd(t, spans[j][1]);
            var mk = document.createElement('mark');
            mk.className = 'hit';
            try { r.surroundContents(mk); } catch (e) { /* straddles an element */ }
        }
    }
    hits = Array.prototype.slice.call(doc.querySelectorAll('mark.hit'));
    hitIx = hits.length ? 0 : -1;
    focusHit();
}

function focusHit() {
    for (var i = 0; i < hits.length; i++) hits[i].classList.toggle('on', i === hitIx);
    if (hitIx >= 0 && hits[hitIx]) hits[hitIx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    paintHitCount();
}

/* Both arms of the old ternary here returned the same string, so an empty
   search field claimed "NO MATCHES" — a result, for a search nobody ran. */
function paintHitCount() {
    $('hitCount').textContent = hits.length
        ? (hitIx + 1) + ' OF ' + hits.length
        : ($('fFind').value ? 'NO MATCHES' : '');
}

function stepHit(d) {
    if (!hits.length) return;
    hitIx = (hitIx + d + hits.length) % hits.length;
    focusHit();
}

/* Replacing through insertText rather than replaceChild is what keeps Ctrl+Z
   working across a replace-all. */
function replaceMark(el, text) {
    var r = document.createRange();
    r.selectNodeContents(el);
    var s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    doc.focus();
    if (text) document.execCommand('insertText', false, text);
    else document.execCommand('delete');
}

function replaceOne() {
    if (hitIx < 0 || !hits[hitIx]) return;
    replaceMark(hits[hitIx], $('fRepl').value);
    touched();
    runFind();
}

function replaceAll() {
    if (!hits.length) return;
    var list = hits.slice(), text = $('fRepl').value, n = list.length;
    for (var i = 0; i < list.length; i++) {
        if (list[i].parentNode) replaceMark(list[i], text);
    }
    touched();
    clearHits();
    runFind();
    toast(n + ' REPLACED');
}

/* ── OUTLINE ─────────────────────────────────────────────────────────────── */

function buildOutline() {
    var hs = doc.querySelectorAll('h1,h2,h3,h4'), html = '', shown = 0;
    for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        if (h.classList.contains('s-sub')) continue;
        if (!h.id) h.id = 'h-' + i + '-' + Math.random().toString(36).slice(2, 6);
        var lv = h.classList.contains('s-title') ? 1 : +h.nodeName[1];
        var tx = h.textContent.trim();
        if (!tx) continue;
        shown++;
        html += '<button class="tree-item lv' + lv + '" type="button" data-to="' + h.id + '">'
             +  '<span class="tree-ix">' + String(shown).padStart(2, '0') + '</span>'
             +  '<span class="tree-tx">' + escapeHTML(tx) + '</span></button>';
    }
    $('outlineList').innerHTML = html;
    $('outlineEmpty').hidden = shown > 0;
}

/* ── COMMENTS ────────────────────────────────────────────────────────────── */

function addComment() {
    var quote = selText();
    if (!quote) { toast('SELECT THE TEXT TO COMMENT ON', true); return; }
    var id = 'c' + Date.now().toString(36);
    exec('insertHTML', '<span class="cmt-mark" data-c="' + id + '">' + escapeHTML(quote) + '</span>');
    /* insertHTML pads the seam with non-breaking spaces to stop the browser
       collapsing them. Left alone they would change the user's text: the
       paragraph stops wrapping there, and a search for a phrase spanning the
       seam no longer matches. Annotating a word must not rewrite it. */
    var mk = doc.querySelector('.cmt-mark[data-c="' + id + '"]');
    if (mk) {
        var pv = mk.previousSibling, nx = mk.nextSibling;
        if (pv && pv.nodeType === 3) pv.nodeValue = pv.nodeValue.replace(/\u00a0$/, ' ');
        if (nx && nx.nodeType === 3) nx.nodeValue = nx.nodeValue.replace(/^\u00a0/, ' ');
    }
    active().comments.push({ id: id, quote: quote, body: '', time: Date.now() });
    if (!state.view.comments) { state.view.comments = true; applyView(); }
    renderComments(id);
    var box = document.querySelector('[data-cbody="' + id + '"]');
    if (box) { box.focus(); }
    touched();
}

function renderComments(focusId) {
    var list = active().comments, html = '';
    for (var i = 0; i < list.length; i++) {
        var c = list[i];
        html += '<div class="cmt-card" data-c="' + c.id + '">'
             +  '<div class="cmt-quote">' + escapeHTML(c.quote) + '</div>'
             +  '<textarea class="field" data-cbody="' + c.id + '" rows="2" placeholder="Write a note…">'
             +  escapeHTML(c.body) + '</textarea>'
             +  '<div class="cmt-foot"><span class="cmt-time">' + when(c.time) + '</span>'
             +  '<span class="spacer"></span>'
             +  '<button class="key" type="button" data-resolve="' + c.id + '">RESOLVE</button></div>'
             +  '</div>';
    }
    $('cmtList').innerHTML = html || '<p class="hint rail-empty">Select some text and press the comment key in bay 05 to pin a note to it.</p>';
    $('cmtCount').textContent = list.length;
    if (focusId) markComment(focusId);
}

function markComment(id) {
    var cards = document.querySelectorAll('.cmt-card');
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('here', cards[i].getAttribute('data-c') === id);
    var marks = doc.querySelectorAll('.cmt-mark');
    for (var j = 0; j < marks.length; j++) marks[j].classList.toggle('here', marks[j].getAttribute('data-c') === id);
}

function resolveComment(id) {
    var list = active().comments;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { list.splice(i, 1); break; }
    var mk = doc.querySelector('.cmt-mark[data-c="' + id + '"]');
    if (mk) {
        var p = mk.parentNode;
        while (mk.firstChild) p.insertBefore(mk.firstChild, mk);
        p.removeChild(mk);
        doc.normalize();
    }
    renderComments();
    touched();
}

function when(t) {
    var d = new Date(t), now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    return sameDay
        ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ── STATS ───────────────────────────────────────────────────────────────── */

/* The document as plain text, used by the word count and the .txt export.
   innerText is the obvious tool and the wrong one: on a DETACHED clone there
   is no layout, so it quietly degrades to textContent and every block runs
   into the next — "…eight?Nine ten." counts as one word fewer than it should.
   So the breaks are put in by hand, which is also the only way <br> survives. */
function textOf() {
    var clone = doc.cloneNode(true);
    var strip = clone.querySelectorAll('.toc, .fn-list');
    for (var i = 0; i < strip.length; i++) strip[i].parentNode.removeChild(strip[i]);

    var brs = clone.querySelectorAll('br');
    for (var b = 0; b < brs.length; b++) {
        brs[b].parentNode.replaceChild(document.createTextNode('\n'), brs[b]);
    }
    var blocks = clone.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr,figcaption');
    for (var j = 0; j < blocks.length; j++) {
        blocks[j].appendChild(document.createTextNode('\n'));
    }
    return clone.textContent || '';
}

function stats() {
    var t = textOf();
    var words = t.trim() ? t.trim().split(/\s+/).length : 0;
    var chars = t.replace(/\r/g, '').length;
    var noSp  = t.replace(/\s/g, '').length;
    var sents = (t.match(/[^.!?]+[.!?]+(\s|$)/g) || []).length;
    var paras = doc.querySelectorAll('p,h1,h2,h3,h4,li,blockquote,pre').length;
    return { words: words, chars: chars, noSp: noSp, sents: sents, paras: paras,
             read: Math.max(words ? 1 : 0, Math.round(words / WPM)) };
}

var statTimer = null;
function scheduleStats() { clearTimeout(statTimer); statTimer = setTimeout(updateStats, 240); }

function updateStats() {
    var s = stats();
    $('stWords').textContent = s.words.toLocaleString();
    $('stChars').textContent = s.chars.toLocaleString();
    $('stRead').textContent  = s.read + ' MIN';
}

function showCount() {
    var s = stats();
    $('cWords').textContent   = s.words.toLocaleString();
    $('cChars').textContent   = s.chars.toLocaleString();
    $('cCharsNo').textContent = s.noSp.toLocaleString();
    $('cSent').textContent    = s.sents.toLocaleString();
    $('cParas').textContent   = s.paras.toLocaleString();
    $('cPages').textContent   = pageTotal;
    $('cRead').textContent    = s.read + ' min';
    openModal('countModal');
}

/* ── SANITISER ───────────────────────────────────────────────────────────────
   Everything arriving from outside the page — a pasted fragment, an imported
   file — goes through here first. Scripts and event handlers are removed, and
   any href or src that is not plainly safe is dropped rather than rewritten. */

function sanitize(html) {
    var d = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    var bad = d.body.querySelectorAll('script,style,link,meta,iframe,object,embed,form,input,button,noscript,base');
    for (var i = 0; i < bad.length; i++) bad[i].parentNode.removeChild(bad[i]);

    var all = d.body.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
        var el = all[j], attrs = Array.prototype.slice.call(el.attributes);
        for (var k = 0; k < attrs.length; k++) {
            var nm = attrs[k].name.toLowerCase(), v = attrs[k].value;
            if (nm.indexOf('on') === 0) { el.removeAttribute(attrs[k].name); continue; }
            if (nm === 'href') {
                if (!safeURL(v)) el.removeAttribute('href');
            } else if (nm === 'src') {
                /* data: images are how this editor embeds its own pictures. */
                if (!/^data:image\//i.test(v) && !safeURL(v)) el.removeAttribute('src');
            } else if (nm === 'srcdoc' || nm === 'formaction') {
                el.removeAttribute(attrs[k].name);
            }
        }
    }
    return d.body.innerHTML;
}

/* ── IMPORT & EXPORT ─────────────────────────────────────────────────────── */

function docCSS(s) {
    return 'body{margin:0;background:#fff;color:#1a1c20;}'
         + '.doc{font-family:' + s.font + ';font-size:' + s.fontSize + 'pt;line-height:' + s.lead + ';}'
         + '.doc p{margin:0 0 ' + s.after + 'pt;}'
         + '.doc h1{font-size:1.65em;margin:16pt 0 6pt;}'
         + '.doc h2{font-size:1.35em;margin:16pt 0 6pt;}'
         + '.doc h3{font-size:1.15em;margin:16pt 0 6pt;}'
         + '.doc h4{font-size:1em;margin:16pt 0 6pt;}'
         + '.doc h1.s-title{font-size:2.1em;border-bottom:2px solid rgba(0,0,0,.2);padding-bottom:8pt;margin:0 0 2pt;}'
         + '.doc h2.s-sub{font-size:1.05em;font-weight:400;font-style:italic;opacity:.72;margin:6pt 0 18pt;border:none;}'
         + '.doc blockquote{margin:10pt 0;padding-left:14pt;border-left:3px solid rgba(0,0,0,.28);font-style:italic;}'
         + '.doc pre{background:rgba(0,0,0,.06);padding:10pt 12pt;white-space:pre-wrap;border-left:3px solid rgba(0,0,0,.28);}'
         + '.doc table{border-collapse:collapse;width:100%;margin:10pt 0;}'
         + '.doc td,.doc th{border:1px solid rgba(0,0,0,.34);padding:5pt 7pt;vertical-align:top;}'
         + '.doc th{background:rgba(0,0,0,.07);text-align:left;}'
         + '.doc img{max-width:100%;height:auto;}'
         + '.doc hr{border:none;border-top:1px solid rgba(0,0,0,.3);margin:14pt 0;}'
         + '.doc ul.task{list-style:none;padding-left:1.2em;}'
         + '.doc .forced-break{page-break-after:always;border:none;height:0;}'
         + '.doc .fn-list{margin-top:20pt;padding-top:8pt;border-top:1px solid rgba(0,0,0,.3);font-size:.84em;}'
         + '.doc figcaption{font-size:.82em;opacity:.7;text-align:center;margin-top:4pt;}';
}

/* The body as it should leave the building: search marks gone, comment
   highlights unwrapped, the caret's cell marker removed. */
function cleanBody() {
    clearHits();
    var clone = doc.cloneNode(true);
    var marks = clone.querySelectorAll('.cmt-mark');
    for (var i = 0; i < marks.length; i++) {
        var m = marks[i], p = m.parentNode;
        while (m.firstChild) p.insertBefore(m.firstChild, m);
        p.removeChild(m);
    }
    var on = clone.querySelectorAll('.cell-on');
    for (var j = 0; j < on.length; j++) on[j].classList.remove('cell-on');
    return clone.innerHTML;
}

function fileName(ext) {
    var t = (active().title || 'document').replace(/[^\w\d\-. ]+/g, '').trim() || 'document';
    return t + '.' + ext;
}

function expHTML() {
    var d = active(), g = geo();
    var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        + '<title>' + escapeHTML(d.title) + '</title>\n<style>\n'
        + '@page{size:' + (g.w / DPI) + 'in ' + (g.h / DPI) + 'in;margin:' + d.setup.m[0] + 'in ' + d.setup.m[1] + 'in ' + d.setup.m[2] + 'in ' + d.setup.m[3] + 'in;}\n'
        + 'body{margin:0;display:flex;justify-content:center;background:#e8e6e0;}\n'
        + '.page{width:' + (g.w / DPI) + 'in;min-height:' + (g.h / DPI) + 'in;padding:' + d.setup.m[0] + 'in ' + d.setup.m[1] + 'in ' + d.setup.m[2] + 'in ' + d.setup.m[3] + 'in;background:#fff;box-sizing:border-box;}\n'
        + '@media print{body{background:#fff;}.page{width:auto;min-height:0;padding:0;}}\n'
        + docCSS(d.setup) + '\n</style>\n</head>\n<body>\n<div class="page"><div class="doc">\n'
        + cleanBody() + '\n</div></div>\n</body>\n</html>';
    CAS.download(fileName('html'), html, 'text/html;charset=utf-8');
    toast('DOWNLOADED · HTML');
}

/* Word opens an HTML file with the Office namespaces declared, and honours
   the w:WordDocument block for page setup. It is not OOXML, but it round-trips
   headings, tables, lists and images, and Word will save it back as .docx. */
function expDoc() {
    var d = active(), g = geo();
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
        + 'xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">\n'
        + '<head><meta charset="utf-8"><title>' + escapeHTML(d.title) + '</title>\n'
        + '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View>'
        + '<w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->\n'
        + '<style>\n@page WordSection1{size:' + (g.w / DPI) + 'in ' + (g.h / DPI) + 'in;'
        + 'margin:' + d.setup.m[0] + 'in ' + d.setup.m[1] + 'in ' + d.setup.m[2] + 'in ' + d.setup.m[3] + 'in;}\n'
        + 'div.WordSection1{page:WordSection1;}\n' + docCSS(d.setup)
        + '\n</style></head>\n<body><div class="WordSection1"><div class="doc">\n'
        + cleanBody() + '\n</div></div></body></html>';
    CAS.download(fileName('doc'), html, 'application/msword');
    toast('DOWNLOADED · WORD');
}

function expTXT() {
    CAS.download(fileName('txt'), textOf().replace(/\n{3,}/g, '\n\n'), 'text/plain;charset=utf-8');
    toast('DOWNLOADED · TEXT');
}

function expMD() {
    clearHits();
    var out = mdOf(doc).replace(/\n{3,}/g, '\n\n').trim() + '\n';
    CAS.download(fileName('md'), out, 'text/markdown;charset=utf-8');
    toast('DOWNLOADED · MARKDOWN');
}

function mdInline(node) {
    var out = '';
    for (var i = 0; i < node.childNodes.length; i++) {
        var n = node.childNodes[i];
        if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, ' '); continue; }
        if (n.nodeType !== 1) continue;
        var tag = n.nodeName.toLowerCase(), inner = mdInline(n);
        var cs = n.style || {};
        if (tag === 'br') out += '  \n';
        else if (tag === 'strong' || tag === 'b' || cs.fontWeight === 'bold' || +cs.fontWeight >= 600) out += '**' + inner + '**';
        else if (tag === 'em' || tag === 'i') out += '*' + inner + '*';
        else if (tag === 'code') out += '`' + inner + '`';
        else if (tag === 's' || tag === 'strike' || tag === 'del') out += '~~' + inner + '~~';
        else if (tag === 'a') out += '[' + inner + '](' + (n.getAttribute('href') || '') + ')';
        else if (tag === 'img') out += '![' + (n.getAttribute('alt') || '') + '](' + (n.getAttribute('src') || '').slice(0, 120) + ')';
        else if (tag === 'u') out += '<u>' + inner + '</u>';
        else out += inner;
    }
    return out;
}

function mdOf(root) {
    var out = '';
    for (var i = 0; i < root.children.length; i++) {
        var el = root.children[i], tag = el.nodeName.toLowerCase();
        if (el.classList.contains('toc') || el.classList.contains('fn-list')) continue;
        if (tag === 'h1' && el.classList.contains('s-title')) out += '# ' + mdInline(el) + '\n\n';
        else if (tag === 'h2' && el.classList.contains('s-sub')) out += '*' + mdInline(el) + '*\n\n';
        else if (/^h[1-6]$/.test(tag)) out += new Array(+tag[1] + 1).join('#') + ' ' + mdInline(el) + '\n\n';
        else if (tag === 'p') out += mdInline(el) + '\n\n';
        else if (tag === 'blockquote') out += '> ' + mdInline(el).replace(/\n/g, '\n> ') + '\n\n';
        else if (tag === 'pre') out += '```\n' + el.textContent + '\n```\n\n';
        else if (tag === 'hr') out += '---\n\n';
        else if (tag === 'ul' || tag === 'ol') out += mdList(el, 0) + '\n';
        else if (tag === 'table') out += mdTable(el) + '\n';
        else if (tag === 'figure') out += mdInline(el) + '\n\n';
        else if (tag === 'div') out += mdOf(el);
        else out += mdInline(el) + '\n\n';
    }
    return out;
}

function mdList(el, depth) {
    var out = '', pad = new Array(depth * 2 + 1).join(' '), n = 1, task = el.classList.contains('task');
    for (var i = 0; i < el.children.length; i++) {
        var li = el.children[i];
        if (li.nodeName !== 'LI') continue;
        var kids = '', clone = li.cloneNode(true);
        var subs = clone.querySelectorAll(':scope > ul, :scope > ol');
        for (var j = 0; j < subs.length; j++) subs[j].parentNode.removeChild(subs[j]);
        var lead = el.nodeName === 'OL' ? (n++) + '. ' : (task ? (li.classList.contains('done') ? '- [x] ' : '- [ ] ') : '- ');
        out += pad + lead + mdInline(clone).trim() + '\n';
        var nested = li.querySelectorAll(':scope > ul, :scope > ol');
        for (var k = 0; k < nested.length; k++) out += mdList(nested[k], depth + 1);
    }
    return out;
}

function mdTable(t) {
    var rows = t.rows, out = '';
    for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].cells, line = '|';
        for (var c = 0; c < cells.length; c++) line += ' ' + mdInline(cells[c]).trim().replace(/\|/g, '\\|') + ' |';
        out += line + '\n';
        if (r === 0) {
            var sep = '|';
            for (var c2 = 0; c2 < cells.length; c2++) sep += ' --- |';
            out += sep + '\n';
        }
    }
    return out;
}

/* Markdown in. Deliberately the common subset — headings, emphasis, lists,
   quotes, fences, rules, links — because anything more needs a real parser. */
function mdToHTML(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var out = [], listType = null, inFence = false, fence = [];

    function closeList() { if (listType) { out.push('</' + listType + '>'); listType = null; } }

    for (var i = 0; i < lines.length; i++) {
        var L = lines[i];
        if (/^```/.test(L)) {
            if (inFence) { out.push('<pre>' + escapeHTML(fence.join('\n')) + '</pre>'); fence = []; inFence = false; }
            else { closeList(); inFence = true; }
            continue;
        }
        if (inFence) { fence.push(L); continue; }

        var t = L.trim();
        if (!t) { closeList(); continue; }
        if (/^(---|\*\*\*|___)$/.test(t)) { closeList(); out.push('<hr>'); continue; }

        var h = t.match(/^(#{1,6})\s+(.*)$/);
        if (h) { closeList(); out.push('<h' + h[1].length + '>' + inlineMD(h[2]) + '</h' + h[1].length + '>'); continue; }

        var q2 = t.match(/^>\s?(.*)$/);
        if (q2) { closeList(); out.push('<blockquote>' + inlineMD(q2[1]) + '</blockquote>'); continue; }

        var ul = t.match(/^[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/);
        if (ul) {
            if (listType !== 'ul') { closeList(); out.push('<ul' + (ul[1] !== undefined ? ' class="task"' : '') + '>'); listType = 'ul'; }
            out.push('<li' + (ul[1] && /x/i.test(ul[1]) ? ' class="done"' : '') + '>' + inlineMD(ul[2]) + '</li>');
            continue;
        }
        var ol = t.match(/^\d+[.)]\s+(.*)$/);
        if (ol) {
            if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
            out.push('<li>' + inlineMD(ol[1]) + '</li>');
            continue;
        }
        closeList();
        out.push('<p>' + inlineMD(t) + '</p>');
    }
    if (inFence && fence.length) out.push('<pre>' + escapeHTML(fence.join('\n')) + '</pre>');
    closeList();
    return out.join('\n');
}

function inlineMD(s) {
    return escapeHTML(s)
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/~~([^~]+)~~/g, '<s>$1</s>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function importFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
        var text = String(fr.result), name = file.name.replace(/\.[^.]+$/, ''), html;
        if (/\.(md|markdown)$/i.test(file.name)) html = mdToHTML(text);
        else if (/\.(html?|doc)$/i.test(file.name)) {
            var body = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
            html = sanitize(body ? body[1] : text);
        } else {
            html = text.split(/\n{2,}/).map(function (p) {
                return '<p>' + escapeHTML(p).replace(/\n/g, '<br>') + '</p>';
            }).join('');
        }
        var d = newDoc(name, html || '<p><br></p>');
        state.docs[d.id] = d;
        state.order.unshift(d.id);
        openDoc(d.id);
        save();
        toast('IMPORTED · ' + name.toUpperCase().slice(0, 24));
    };
    fr.onerror = function () { toast('COULD NOT READ THAT FILE', true); };
    fr.readAsText(file);
}

/* ── DOCUMENTS ───────────────────────────────────────────────────────────── */

function openDoc(id) {
    if (dirty) save();
    if (!state.docs[id]) return;
    state.active = id;
    var d = active();
    doc.innerHTML = d.html || '<p><br></p>';
    $('docTitle').value = d.title;
    applySetup();
    renderComments();
    buildOutline();
    renderFiles();
    deck.scrollTop = d.scroll || 0;
    setSaved(true);
    save();
}

function renderFiles() {
    var html = '';
    for (var i = 0; i < state.order.length; i++) {
        var d = state.docs[state.order[i]];
        if (!d) continue;
        html += '<button class="file-row' + (d.id === state.active ? ' here' : '') + '" type="button" data-open="' + d.id + '">'
             +  '<span style="min-width:0"><span class="file-name">' + escapeHTML(d.title || 'Untitled') + '</span>'
             +  '<span class="file-meta">' + when(d.updated) + '</span></span></button>';
    }
    $('fileList').innerHTML = html;
    renderDocList();
}

function renderDocList() {
    var html = '';
    for (var i = 0; i < state.order.length; i++) {
        var d = state.docs[state.order[i]];
        if (!d) continue;
        html += '<div class="doc-row' + (d.id === state.active ? ' here' : '') + '">'
             +  '<span class="grow"><span class="nm">' + escapeHTML(d.title || 'Untitled') + '</span>'
             +  '<span class="file-meta">' + when(d.updated) + '</span></span>'
             +  '<button class="key" type="button" data-open="' + d.id + '">OPEN</button>'
             +  '<button class="key key-danger key-sq" type="button" data-del="' + d.id + '" aria-label="Delete">'
             +  '<svg><use href="#i-x"/></svg></button></div>';
    }
    $('docList').innerHTML = html;
}

function createDoc() {
    var d = newDoc();
    state.docs[d.id] = d;
    state.order.unshift(d.id);
    openDoc(d.id);
    $('docTitle').focus();
    $('docTitle').select();
}

function copyDoc() {
    save();
    var s = active(), d = newDoc(s.title + ' (copy)', s.html);
    d.setup = JSON.parse(JSON.stringify(s.setup));
    d.comments = JSON.parse(JSON.stringify(s.comments));
    state.docs[d.id] = d;
    state.order.unshift(d.id);
    openDoc(d.id);
    toast('COPIED');
}

function deleteDoc(id) {
    var d = state.docs[id];
    if (!d) return;
    if (!window.confirm('Move “' + (d.title || 'Untitled') + '” to the trash? This cannot be undone.')) return;
    delete state.docs[id];
    var ix = state.order.indexOf(id);
    if (ix >= 0) state.order.splice(ix, 1);
    if (state.active === id) {
        if (!state.order.length) createDoc();
        else openDoc(state.order[0]);
    } else { renderFiles(); }
    save();
    toast('MOVED TO TRASH');
}

/* ── VIEW ────────────────────────────────────────────────────────────────── */

/* Under 1100px the rails stop being columns and become overlays that sit on
   top of the sheet. An overlay that is open on arrival hides the document, so
   narrow viewports start with both shut — and this is a RUNTIME override, not
   a change of preference: the stored setting is what a wide window goes back
   to. Toggling a rail from the VIEW menu lifts the override for the session. */
var RAIL_BP = 1100;
var shut = { outline: window.innerWidth < RAIL_BP, comments: window.innerWidth < RAIL_BP };

function applyView() {
    var v = state.view;
    $('railLeft').hidden  = !v.outline  || shut.outline;
    $('railRight').hidden = !v.comments || shut.comments;
    ruler.hidden = !v.ruler;
    $('margFrame').hidden = !v.margins;
    document.body.classList.toggle('stock-dark', v.stock);
    document.body.classList.toggle('focus', v.focus);
    doc.setAttribute('spellcheck', v.spell ? 'true' : 'false');
    document.documentElement.style.setProperty('--zoom', v.zoom);
    $('stZoom').textContent = Math.round(v.zoom * 100) + '%';

    setCheck('v.outline',  v.outline);
    setCheck('v.comments', v.comments);
    setCheck('v.ruler',    v.ruler);
    setCheck('v.margins',  v.margins);
    setCheck('v.breaks',   v.breaks);
    setCheck('v.stock',    v.stock);
    setCheck('v.focus',    v.focus);
    setCheck('t.spell',    v.spell);
    reflow();
}

/* The menu item toggles what the user can SEE, not the stored preference.
   Those differ on a narrow screen, where a rail can be preferred-on but shut:
   toggling it there has to open it, not switch the preference off and appear
   to do nothing. Opening one drawer closes the other, since on a phone they
   occupy the same space — and that closes it WITHOUT touching its preference,
   so a wide window still comes back to whatever the user chose. */
function toggleRail(which) {
    var id = which === 'outline' ? 'railLeft' : 'railRight';
    if (!$(id).hidden) {
        state.view[which] = false;
    } else {
        state.view[which] = true;
        shut[which] = false;
        if (window.innerWidth < RAIL_BP) shut[which === 'outline' ? 'comments' : 'outline'] = true;
    }
    applyView();
    save();
}

function setCheck(cmd, on) {
    var el = document.querySelector('[data-cmd="' + cmd + '"]');
    if (!el) return;
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    var mk = el.querySelector('.mk');
    if (mk && /^(ON|OFF)$/.test(mk.textContent)) mk.textContent = on ? 'ON' : 'OFF';
}

function zoomBy(d) {
    var i = ZOOMS.indexOf(state.view.zoom);
    if (i < 0) i = 4;
    i = Math.min(ZOOMS.length - 1, Math.max(0, i + d));
    state.view.zoom = ZOOMS[i];
    applyView();
    touched();
}

function zoomFit() {
    var avail = deck.clientWidth - 32;
    state.view.zoom = Math.max(0.25, Math.min(2, Math.round(avail / geo().w * 100) / 100));
    applyView();
}

/* ── MODALS ──────────────────────────────────────────────────────────────── */

function openModal(id) { closeAllMenus(); $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
function closeAllModals() {
    var m = document.querySelectorAll('.panel-modal.open');
    for (var i = 0; i < m.length; i++) m[i].classList.remove('open');
}

/* ── MENUS ───────────────────────────────────────────────────────────────── */

function closeAllMenus() {
    var m = document.querySelectorAll('.menu.open');
    for (var i = 0; i < m.length; i++) {
        m[i].classList.remove('open');
        m[i].querySelector('.menu-btn').setAttribute('aria-expanded', 'false');
    }
}

function wireMenus() {
    var menus = document.querySelectorAll('.menu');
    for (var i = 0; i < menus.length; i++) {
        (function (menu) {
            var btn = menu.querySelector('.menu-btn');
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var was = menu.classList.contains('open');
                closeAllMenus();
                if (!was) {
                    /* The caret is about to be lost to the button, so the
                       selection every FORMAT item depends on is banked here. */
                    saveSel();
                    menu.classList.add('open');
                    btn.setAttribute('aria-expanded', 'true');
                    var r = menu.getBoundingClientRect();
                    menu.classList.toggle('flip', r.left + 280 > window.innerWidth);
                }
            });
            btn.addEventListener('mouseenter', function () {
                if (document.querySelector('.menu.open') && !menu.classList.contains('open')) {
                    saveSel();
                    closeAllMenus();
                    menu.classList.add('open');
                    btn.setAttribute('aria-expanded', 'true');
                }
            });
        })(menus[i]);
    }
}

/* ── COMMANDS ────────────────────────────────────────────────────────────── */

function run(cmd) {
    switch (cmd) {
        case 'doc.new':     createDoc(); break;
        case 'doc.manage':  renderDocList(); openModal('docsModal'); break;
        case 'doc.import':  $('importFile').click(); break;
        case 'doc.save':    save(); toast('SAVED'); break;
        case 'doc.rename':  $('docTitle').focus(); $('docTitle').select(); break;
        case 'doc.copy':    copyDoc(); break;
        case 'doc.delete':  deleteDoc(state.active); break;
        case 'doc.print':   save(); window.print(); break;
        case 'page.setup':  fillPageForm(); openModal('pageModal'); break;

        case 'exp.html': expHTML(); break;
        case 'exp.doc':  expDoc();  break;
        case 'exp.md':   expMD();   break;
        case 'exp.txt':  expTXT();  break;

        case 'ed.undo': exec('undo'); break;
        case 'ed.redo': exec('redo'); break;
        case 'ed.cut':  exec('cut');  break;
        case 'ed.copy': exec('copy'); break;
        case 'ed.paste':
            /* The clipboard read needs a permission the page may not have, so
               it says what happened instead of failing silently. */
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(function (t) {
                    restoreSel(); exec('insertText', t);
                }, function () { toast('USE CTRL+V — THE BROWSER BLOCKS PASTE HERE', true); });
            } else toast('USE CTRL+V TO PASTE', true);
            break;
        case 'ed.pastePlain':
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(function (t) { restoreSel(); exec('insertText', t); },
                    function () { toast('USE CTRL+SHIFT+V', true); });
            } else toast('USE CTRL+SHIFT+V', true);
            break;
        case 'ed.selectAll': doc.focus(); exec('selectAll'); break;
        case 'ed.find':
            saveSel(); openModal('findModal');
            setTimeout(function () { $('fFind').focus(); $('fFind').select(); runFind(); }, 30);
            break;

        case 'fmt.bold':      exec('bold'); break;
        case 'fmt.italic':    exec('italic'); break;
        case 'fmt.underline': exec('underline'); break;
        case 'fmt.strike':    exec('strikeThrough'); break;
        case 'fmt.sup':       exec('superscript'); break;
        case 'fmt.sub':       exec('subscript'); break;
        case 'fmt.clear':     clearFormat(); break;
        case 'fmt.painter':   togglePainter(); break;

        case 'blk.h1': setBlock('h1'); break;
        case 'blk.h2': setBlock('h2'); break;
        case 'blk.h3': setBlock('h3'); break;
        case 'blk.h4': setBlock('h4'); break;
        case 'blk.p':  setBlock('p');  break;

        case 'al.left': case 'al.center': case 'al.right': case 'al.justify':
            setAlign(cmd.slice(3)); break;

        case 'li.ul':   exec('insertUnorderedList'); break;
        case 'li.ol':   exec('insertOrderedList'); break;
        case 'li.task': toggleTask(); break;
        case 'li.in':   exec('indent'); break;
        case 'li.out':  exec('outdent'); break;

        case 'ins.link':      insLink(); break;
        case 'ins.image':     saveSel(); openModal('imageModal'); break;
        case 'ins.table':     saveSel(); openModal('tableModal'); break;
        case 'ins.hr':        exec('insertHorizontalRule'); break;
        case 'ins.pagebreak': exec('insertHTML', '<div class="forced-break" contenteditable="false"></div><p><br></p>'); break;
        case 'ins.symbol':    saveSel(); openModal('symModal'); break;
        case 'ins.datetime':  insDate(); break;
        case 'ins.comment':   addComment(); break;
        case 'ins.footnote':  insFootnote(); break;
        case 'ins.toc':       saveSel(); insTOC(); break;

        case 'tbl.rowAbove': tableOp('rowAbove'); break;
        case 'tbl.rowBelow': tableOp('rowBelow'); break;
        case 'tbl.colLeft':  tableOp('colLeft');  break;
        case 'tbl.colRight': tableOp('colRight'); break;
        case 'tbl.delRow':   tableOp('delRow');   break;
        case 'tbl.delCol':   tableOp('delCol');   break;
        case 'tbl.delTable': tableOp('delTable'); break;
        case 'tbl.header':   tableOp('header');   break;

        case 't.wordcount': showCount(); break;
        case 't.spell':     state.view.spell = !state.view.spell; applyView(); save(); break;
        case 't.shortcuts': openModal('keysModal'); break;

        case 'v.outline':  toggleRail('outline');  break;
        case 'v.comments': toggleRail('comments'); break;
        case 'v.ruler':    state.view.ruler    = !state.view.ruler;    applyView(); save(); break;
        case 'v.margins':  state.view.margins  = !state.view.margins;  applyView(); save(); break;
        case 'v.breaks':   state.view.breaks   = !state.view.breaks;   applyView(); save(); break;
        case 'v.stock':    state.view.stock    = !state.view.stock;    applyView(); save(); break;
        case 'v.focus':    state.view.focus    = !state.view.focus;    applyView(); save(); break;
        case 'v.zoomIn':   zoomBy(1); break;
        case 'v.zoomOut':  zoomBy(-1); break;
        case 'v.zoomReset':state.view.zoom = 1; applyView(); break;
        case 'v.zoomFit':  zoomFit(); break;
    }
}

/* ── PAGE SETUP FORM ─────────────────────────────────────────────────────── */

function fillPageForm() {
    var s = active().setup;
    $('pgSize').value = s.size;
    $('pgOrient').value = s.orient;
    $('pgMT').value = s.m[0]; $('pgMR').value = s.m[1];
    $('pgMB').value = s.m[2]; $('pgML').value = s.m[3];
    $('pgSize2').value = s.fontSize;
    $('pgAfter').value = s.after;
    $('pgPreset').value = presetOf(s.m);
}

function presetOf(m) {
    for (var k in MARGINS) {
        var p = MARGINS[k];
        if (p[0] === m[0] && p[1] === m[1] && p[2] === m[2] && p[3] === m[3]) return k;
    }
    return 'custom';
}

function readPageForm() {
    var s = active().setup;
    s.size = $('pgSize').value;
    s.orient = $('pgOrient').value;
    s.m = [+$('pgMT').value || 0, +$('pgMR').value || 0, +$('pgMB').value || 0, +$('pgML').value || 0];
    s.fontSize = +$('pgSize2').value || 11;
    s.after = +$('pgAfter').value || 0;
    $('pgPreset').value = presetOf(s.m);
    applySetup();
    touched();
}

/* ── KEYBOARD ────────────────────────────────────────────────────────────── */

function onKey(e) {
    var mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') {
        if (document.querySelector('.panel-modal.open')) { closeAllModals(); clearHits(); return; }
        if (document.querySelector('.menu.open')) { closeAllMenus(); return; }
        if (state.view.focus) { state.view.focus = false; applyView(); return; }
    }

    /* Tab belongs to the table when the caret is in one, and to indentation
       otherwise — which is what both Word and Docs do. */
    if (e.key === 'Tab' && doc.contains(document.activeElement === doc ? doc : caretNode())) {
        if (document.activeElement !== doc) { /* let dialogs keep their tab order */ }
        else if (tableTab(e)) { e.preventDefault(); return; }
        else if (!e.shiftKey) { e.preventDefault(); exec('indent'); return; }
        else { e.preventDefault(); exec('outdent'); return; }
    }

    if (!mod) return;

    var k = e.key.toLowerCase();

    if (e.altKey && !e.shiftKey && /^[0-4]$/.test(k)) {
        e.preventDefault();
        setBlock(k === '0' ? 'p' : 'h' + k);
        return;
    }
    if (e.altKey && k === 'm') { e.preventDefault(); addComment(); return; }

    if (e.shiftKey) {
        switch (k) {
            case 'x': e.preventDefault(); exec('strikeThrough'); return;
            case '7': e.preventDefault(); exec('insertOrderedList'); return;
            case '8': e.preventDefault(); exec('insertUnorderedList'); return;
            case 'l': e.preventDefault(); setAlign('left'); return;
            case 'e': e.preventDefault(); setAlign('center'); return;
            case 'r': e.preventDefault(); setAlign('right'); return;
            case 'j': e.preventDefault(); setAlign('justify'); return;
            case 'c': e.preventDefault(); showCount(); return;
        }
        return;
    }

    switch (k) {
        case 'b': e.preventDefault(); exec('bold'); break;
        case 'i': e.preventDefault(); exec('italic'); break;
        case 'u': e.preventDefault(); exec('underline'); break;
        case 'k': e.preventDefault(); insLink(); break;
        case 'f': e.preventDefault(); run('ed.find'); break;
        case 'h': e.preventDefault(); run('ed.find'); break;
        case 's': e.preventDefault(); save(); toast('SAVED'); break;
        case 'o': e.preventDefault(); run('doc.manage'); break;
        case 'p': e.preventDefault(); run('doc.print'); break;
        case '\\': e.preventDefault(); clearFormat(); break;
        case '.': e.preventDefault(); exec('superscript'); break;
        case ',': e.preventDefault(); exec('subscript'); break;
        case '=': case '+': e.preventDefault(); zoomBy(1); break;
        case '-': e.preventDefault(); zoomBy(-1); break;
        case '0': e.preventDefault(); state.view.zoom = 1; applyView(); break;
        case 'enter':
            e.preventDefault();
            run('ins.pagebreak');
            break;
    }
    if (e.key === 'Enter' && mod) { e.preventDefault(); }
}

/* ── SEED ────────────────────────────────────────────────────────────────── */

function seedDoc() {
    var d = newDoc('Welcome to Docs');
    d.html =
      '<h1 class="s-title">Welcome to Docs</h1>'
    + '<h2 class="s-sub">A word processor that never leaves your machine</h2>'
    + '<p>Everything you type is written to this browser&rsquo;s local storage and nowhere else. '
    + 'There is no account, no sync and no upload &mdash; which also means that clearing your site data clears your documents, '
    + 'so use <strong>File &rarr; Download</strong> for anything you want to keep.</p>'
    + '<h2>What is here</h2>'
    + '<ul>'
    + '<li><strong>Styles</strong> &mdash; title, subtitle, four heading levels, quote and code, in bay 02.</li>'
    + '<li><strong>Character formatting</strong> &mdash; bold, italic, underline, strikethrough, super- and subscript, colour, highlight.</li>'
    + '<li><strong>Paragraphs</strong> &mdash; alignment, bulleted, numbered and check lists, indentation, line spacing.</li>'
    + '<li><strong>Insert</strong> &mdash; links, images, tables, rules, page breaks, special characters, footnotes and a generated table of contents.</li>'
    + '<li><strong>Review</strong> &mdash; find and replace, comments pinned to a selection, live word count.</li>'
    + '<li><strong>Layout</strong> &mdash; five sheet sizes, both orientations, margins, and a ruler that means it.</li>'
    + '</ul>'
    + '<h2>The sheet is real</h2>'
    + '<p>The dashed rule across the page is where the paper actually ends. Change the sheet or the margins in '
    + '<strong>File &rarr; Page setup</strong> and the guide moves with them &mdash; and so does the printed result. '
    + 'Print to PDF and you get exactly the page set up here.</p>'
    + '<blockquote>Everything is drawn, not built. The chrome is a technical manual; the paper is paper.</blockquote>'
    + '<h2>Getting out again</h2>'
    + '<p>Download as a web page, as Markdown, as plain text, or as a Word file &mdash; the <code>.doc</code> export '
    + 'opens in Word and can be saved straight back out as <code>.docx</code>.</p>'
    + '<p><br></p>';
    return d;
}

/* ── INIT ────────────────────────────────────────────────────────────────── */

function init() {
    load();

    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
    try { document.execCommand('styleWithCSS', false, true); } catch (e) {}

    openDoc(state.active);
    applyView();
    buildGrid();
    buildSyms();
    wireMenus();
    wirePal('inkKey', 'inkPal', 'ink');
    wirePal('markKey', 'markPal', 'mark');

    /* Every token swaps at once when the theme changes, which is a hard cut
       across the whole window. The cross-fade is switched on only for the
       length of the swap — left on permanently it would drag on every hover
       and focus that touches a colour. */
    var themeTimer = null;
    if (window.SRCH && SRCH.themeSwitch) {
        SRCH.themeSwitch($('themeSw'), function () {
            var root = document.documentElement;
            root.classList.add('theming');
            clearTimeout(themeTimer);
            themeTimer = setTimeout(function () { root.classList.remove('theming'); }, 260);
        });
    }

    /* A toolbar must not take the caret. Suppressing mousedown's default on
       the chrome means the editor keeps both focus and selection, so a key
       acts on what the user could still see highlighted when they pressed it.
       Click still fires, and keyboard focus is untouched. */
    document.addEventListener('mousedown', function (e) {
        if (e.target.closest('.ribbon [data-cmd], .ribbon [data-size], .menu-btn, .menu-item, .pal button, .sym-grid button, .rail-tabs [data-tab]')) {
            e.preventDefault();
        }
    });

    /* Any control anywhere with a data-cmd runs the same command table. */
    document.addEventListener('click', function (e) {
        var b = e.target.closest('[data-cmd]');
        if (b) {
            var inMenu = !!b.closest('.menu-sheet');
            if (inMenu) closeAllMenus(); else saveSel();
            if (inMenu) restoreSel();
            run(b.getAttribute('data-cmd'));
            return;
        }
        if (e.target.closest('[data-close]')) { closeAllModals(); clearHits(); return; }
        var open = e.target.closest('[data-open]');
        if (open) { openDoc(open.getAttribute('data-open')); closeModal('docsModal'); return; }
        var del = e.target.closest('[data-del]');
        if (del) { deleteDoc(del.getAttribute('data-del')); return; }
        var to = e.target.closest('[data-to]');
        if (to) {
            var h = document.getElementById(to.getAttribute('data-to'));
            if (h) {
                h.scrollIntoView({ block: 'start', behavior: 'smooth' });
                var items = document.querySelectorAll('.tree-item');
                for (var i = 0; i < items.length; i++) items[i].classList.toggle('here', items[i] === to);
            }
            return;
        }
        var res = e.target.closest('[data-resolve]');
        if (res) { resolveComment(res.getAttribute('data-resolve')); return; }
        var card = e.target.closest('.cmt-card');
        if (card) {
            var cid = card.getAttribute('data-c');
            markComment(cid);
            var mk = doc.querySelector('.cmt-mark[data-c="' + cid + '"]');
            if (mk) mk.scrollIntoView({ block: 'center', behavior: 'smooth' });
            return;
        }
        /* A click anywhere else dismisses the transient surfaces. */
        if (!e.target.closest('.menu')) closeAllMenus();
        if (!e.target.closest('.pal') && !e.target.closest('.swatch-key')) closeAllPals();
        if (e.target.classList.contains('panel-modal')) { closeAllModals(); clearHits(); }
    });

    /* Rail tabs. */
    document.querySelector('.rail-tabs').addEventListener('click', function (e) {
        var b = e.target.closest('[data-tab]');
        if (!b) return;
        var tabs = this.querySelectorAll('[data-tab]');
        for (var i = 0; i < tabs.length; i++) {
            var on = tabs[i] === b;
            tabs[i].classList.toggle('latched', on);
            tabs[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        var which = b.getAttribute('data-tab');
        $('outlinePane').hidden = which !== 'outline';
        $('filesPane').hidden   = which !== 'files';
        if (which === 'files') renderFiles();
    });

    /* The document body. */
    doc.addEventListener('input', function () {
        touched();
        scheduleStats();
        buildOutline();
        renumberFootnotes();
    });
    doc.addEventListener('keyup', scheduleSync);
    doc.addEventListener('mouseup', function () {
        scheduleSync();
        if (painter) stampPainter();
    });
    /* Bank the selection continuously while the caret is in the document.
       Every control in the chrome ends up calling restoreSel(), and banking
       only at the moment a menu opens leaves every other route — a stepper,
       a select, a dialog reached by keyboard — restoring whatever range was
       saved last, which is the wrong place. Tracking it here means there is
       one answer to "where was the user working", and it is always current. */
    document.addEventListener('selectionchange', function () {
        if (document.activeElement === doc) { saveSel(); scheduleSync(); }
    });

    /* Checklist boxes are drawn in the list's padding, so the click lands on
       the UL — find the row by its vertical position. */
    doc.addEventListener('click', function (e) {
        var ul = e.target.closest && e.target.closest('ul.task');
        if (ul && e.target === ul) {
            for (var i = 0; i < ul.children.length; i++) {
                var r = ul.children[i].getBoundingClientRect();
                if (e.clientY >= r.top && e.clientY <= r.bottom) {
                    ul.children[i].classList.toggle('done');
                    touched();
                    return;
                }
            }
        }
        var mk = e.target.closest && e.target.closest('.cmt-mark');
        if (mk) markComment(mk.getAttribute('data-c'));
        var tocRow = e.target.closest && e.target.closest('.toc-row');
        if (tocRow) {
            e.preventDefault();
            var t = document.getElementById(tocRow.getAttribute('href').slice(1));
            if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
    });

    /* Pasted HTML is foreign content; it goes through the sanitiser and then
       back in via insertHTML so it stays one undo step. */
    doc.addEventListener('paste', function (e) {
        var cd = e.clipboardData;
        if (!cd) return;
        var html = cd.getData('text/html'), text = cd.getData('text/plain');
        e.preventDefault();
        if (html && !(e.shiftKey)) document.execCommand('insertHTML', false, sanitize(html));
        else document.execCommand('insertText', false, text);
        touched();
    });

    doc.addEventListener('drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f || !/^image\//.test(f.type)) return;
        e.preventDefault();
        var fr = new FileReader();
        fr.onload = function () {
            exec('insertHTML', '<img src="' + fr.result + '" alt="" style="width:100%">');
        };
        fr.readAsDataURL(f);
    });

    /* Title. */
    $('docTitle').addEventListener('input', function () {
        active().title = this.value || 'Untitled document';
        document.title = active().title + ' — Docs';
        touched();
        renderFiles();
    });

    /* Ribbon selects and steppers. */
    $('stylePick').addEventListener('change', function () { restoreSel(); setBlock(this.value); });
    $('stylePick').addEventListener('mousedown', saveSel);
    $('fontPick').addEventListener('mousedown', saveSel);
    $('fontPick').addEventListener('change', function () {
        restoreSel();
        if (selText()) setFontFamily(this.value);
        else { active().setup.font = this.value; applySetup(); touched(); }
    });
    $('leadPick').addEventListener('mousedown', saveSel);
    $('leadPick').addEventListener('change', function () { restoreSel(); setLead(this.value); });
    $('sizeIn').addEventListener('change', function () {
        var pt = Math.min(96, Math.max(6, +this.value || 11));
        this.value = pt;
        restoreSel();
        if (selText()) setFontSize(pt);
        else { active().setup.fontSize = pt; applySetup(); touched(); }
    });
    $('sizeIn').addEventListener('mousedown', saveSel);
    var steps = document.querySelectorAll('[data-size]');
    for (var si = 0; si < steps.length; si++) {
        steps[si].addEventListener('click', function () {
            var inp = $('sizeIn');
            inp.value = Math.min(96, Math.max(6, (+inp.value || 11) + (+this.getAttribute('data-size'))));
            inp.dispatchEvent(new Event('change'));
        });
    }

    /* Find & replace. */
    var reFind = CAS.debounce ? CAS.debounce(runFind, 180) : runFind;
    $('fFind').addEventListener('input', reFind);
    $('fCase').addEventListener('change', runFind);
    $('fWhole').addEventListener('change', runFind);
    $('btnNext').addEventListener('click', function () { stepHit(1); });
    $('btnPrev').addEventListener('click', function () { stepHit(-1); });
    $('btnRepl').addEventListener('click', replaceOne);
    $('btnReplAll').addEventListener('click', replaceAll);
    $('fFind').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); }
    });

    /* Dialog actions. */
    $('btnLinkOk').addEventListener('click', applyLink);
    $('btnLinkRemove').addEventListener('click', removeLink);
    $('lUrl').addEventListener('keydown', function (e) { if (e.key === 'Enter') applyLink(); });
    $('btnTableOk').addEventListener('click', insTable);
    $('btnImgOk').addEventListener('click', insImage);

    /* Page setup is live — every field writes straight through to the sheet. */
    var pg = ['pgSize', 'pgOrient', 'pgMT', 'pgMR', 'pgMB', 'pgML', 'pgSize2', 'pgAfter'];
    for (var pi = 0; pi < pg.length; pi++) $(pg[pi]).addEventListener('input', readPageForm);
    $('pgPreset').addEventListener('change', function () {
        var p = MARGINS[this.value];
        if (!p) return;
        $('pgMT').value = p[0]; $('pgMR').value = p[1];
        $('pgMB').value = p[2]; $('pgML').value = p[3];
        readPageForm();
    });

    /* Comment bodies. */
    $('cmtList').addEventListener('input', function (e) {
        var id = e.target.getAttribute && e.target.getAttribute('data-cbody');
        if (!id) return;
        var list = active().comments;
        for (var i = 0; i < list.length; i++) if (list[i].id === id) { list[i].body = e.target.value; break; }
        touched();
    });

    $('importFile').addEventListener('change', function () {
        if (this.files && this.files[0]) importFile(this.files[0]);
        this.value = '';
    });

    /* A rail overlaying the sheet behaves like a drawer: touching the paper
       puts it away. Without this there is no way back to the document on a
       phone except the menu you came from. */
    deck.addEventListener('pointerdown', function () {
        if (window.innerWidth >= RAIL_BP) return;
        if (shut.outline && shut.comments) return;
        shut.outline = shut.comments = true;
        applyView();
    });

    var wasNarrow = window.innerWidth < RAIL_BP;
    function onResize() {
        var narrow = window.innerWidth < RAIL_BP;
        /* Crossing into overlay territory shuts them; crossing back out
           restores whatever the stored preference was. */
        if (narrow !== wasNarrow) {
            shut.outline = shut.comments = narrow;
            wasNarrow = narrow;
            applyView();
        }
        reflow();
    }

    document.addEventListener('keydown', onKey);
    deck.addEventListener('scroll', CAS.debounce ? CAS.debounce(updatePageNo, 120) : updatePageNo);
    window.addEventListener('resize', CAS.debounce ? CAS.debounce(onResize, 200) : onResize);
    window.addEventListener('beforeunload', function () { if (dirty) save(); });
    /* reflow() writes leaf.style.minHeight inline so the sheet stands a whole
       number of pages tall on screen. Inline beats the print block's
       `min-height: 0`, so left alone it pads the printout with blank pages up
       to the on-screen height. Cleared for the print, restored after. */
    window.addEventListener('beforeprint', function () {
        clearHits();
        leaf.style.minHeight = '';
    });
    window.addEventListener('afterprint', reflow);

    document.title = active().title + ' — Docs';
    doc.focus();

    /* Boot is over once the view state has been applied AND painted. Two frames:
       the first lets the browser commit the layout above, the second guarantees
       it has been rendered before transitions are armed — one frame is enough in
       theory and is not in practice.

       The timer is not redundant. requestAnimationFrame does not run in a tab
       that is not rendering, so a page opened in a background tab would sit
       with every transition disabled until it was first looked at. Harmless,
       but the class should not be able to get stuck at all. */
    function endBoot() { document.documentElement.classList.remove('boot'); }
    requestAnimationFrame(function () { requestAnimationFrame(endBoot); });
    setTimeout(endBoot, 400);
    if (CAS.bootOnce) CAS.bootOnce(leaf);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
