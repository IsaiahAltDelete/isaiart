/* ============================================================================
   EFFECTS — the shell that holds three image effects on one page
   ---------------------------------------------------------------------------
   Halftone, Stipple and Tape used to be three pages. They are still three
   engines (plate.js, stipple.js, tape.js), each owning its own controls,
   stage and dock inside a panel #fx-<mode>; this file decides which panel is
   on screen, carries the picture between them, and runs the page's motion.

   The contract each engine keeps:
     FX.el(prefix)        → an id lookup that adds the engine's id prefix
     FX.root(mode)        → the engine's panel, for scoped queries
     FX.loaded(mode, f)   → call when a file has been decoded successfully
     FX.register(mode, {load}) → how the shell hands the engine a file

   An engine that fails to boot (Tape with no WebGL) simply never registers,
   and the shell leaves it alone.

   The engines were written against the site's shared console.js and
   cassette.js, but only ever used two things from them: SRCH.r (read a radio
   group) and CAS.toast. This page no longer loads either, so both are
   supplied here, before any engine runs.

   No dependencies. Exposes window.FX, window.SRCH, window.CAS.
   ========================================================================= */
(function () {
    'use strict';

    var doc = document, html = doc.documentElement;
    var MODES = ['halftone', 'stipple', 'tape'];
    var KEY = { mode: 'isaiart.effects.mode', theme: 'isaiart.effects.theme', notes: 'isaiart.effects.notes' };
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

    /* ── The two helpers the engines need ───────────────────────────────── */

    window.SRCH = {
        r: function (name) {
            var node = doc.querySelector('input[name="' + name + '"]:checked');
            return node ? node.value : '';
        }
    };

    var toastEl = null, toastTimer = 0;
    window.CAS = {
        toast: function (message, isError) {
            if (!toastEl) {
                toastEl = doc.createElement('div');
                toastEl.className = 'toast';
                toastEl.setAttribute('role', 'status');
                toastEl.setAttribute('aria-live', 'polite');
                doc.body.appendChild(toastEl);
            }
            toastEl.textContent = message;
            toastEl.classList.toggle('bad', !!isError);
            /* Drop and re-raise, so a second message in a row still moves. */
            toastEl.classList.remove('up');
            void toastEl.offsetWidth;
            toastEl.classList.add('up');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(function () { toastEl.classList.remove('up'); }, 2200);
        }
    };

    /* ── Shell API ──────────────────────────────────────────────────────── */

    var mods = {};
    var seen = {};          /* the File each engine last loaded */
    var shared = null;      /* the File the page is currently about */
    var active = null;

    window.FX = {
        el: function (prefix) {
            return function (id) { return doc.getElementById(prefix + id); };
        },
        root: function (mode) { return doc.getElementById('fx-' + mode); },
        isActive: function (mode) { return active === mode; },
        register: function (mode, api) { mods[mode] = api; },
        loaded: function (mode, file) {
            shared = file;
            seen[mode] = file;
            var name = file.name || 'Pasted image';
            doc.getElementById('fxSrc').textContent = name;
            doc.getElementById('fxSrcLine').classList.add('has');
        }
    };

    /* ── Theme ──────────────────────────────────────────────────────────── */
    /* White first. This page keeps its own choice rather than the site-wide
       one, because the rest of the site is still dark-first. */

    var themeBtn = doc.getElementById('themeBtn');
    function setTheme(t) {
        html.setAttribute('data-theme', t);
        themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
        var meta = doc.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', t === 'dark' ? '#0b0b0b' : '#ffffff');
        store(KEY.theme, t);
    }
    setTheme(html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    themeBtn.addEventListener('click', function () {
        setTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });

    /* ── Notes ──────────────────────────────────────────────────────────── */
    /* The long explanation under each control, off until asked for. */

    var notesBtn = doc.getElementById('notesBtn');
    function setNotes(on) {
        html.classList.toggle('notes', on);
        notesBtn.setAttribute('aria-pressed', String(on));
        store(KEY.notes, on ? '1' : '0');
    }
    setNotes(html.classList.contains('notes'));
    notesBtn.addEventListener('click', function () { setNotes(!html.classList.contains('notes')); });

    /* ── Title ──────────────────────────────────────────────────────────── */
    /* "Effects" is set letter by letter so it can rise into place. */

    Array.prototype.forEach.call(doc.querySelectorAll('[data-split]'), function (node) {
        var text = node.textContent;
        node.setAttribute('aria-label', text);
        node.textContent = '';
        text.split('').forEach(function (ch, i) {
            var s = doc.createElement('span');
            s.className = 'ch';
            s.setAttribute('aria-hidden', 'true');
            s.style.setProperty('--i', i);
            s.textContent = ch;
            node.appendChild(s);
        });
    });

    var words = {};
    Array.prototype.forEach.call(doc.querySelectorAll('.title-mode .word'), function (w) {
        words[w.getAttribute('data-word')] = w;
    });

    /* Old word slides up and out; new word is parked below without a
       transition, then slides up into the slot. */
    function swapWord(mode) {
        Object.keys(words).forEach(function (k) {
            var w = words[k];
            if (k === mode) {
                w.classList.add('ins');
                w.classList.remove('on', 'out');
                void w.offsetWidth;
                w.classList.remove('ins');
                w.classList.add('on');
            } else if (w.classList.contains('on')) {
                w.classList.remove('on');
                w.classList.add('out');
            } else {
                w.classList.remove('out');
            }
        });
    }

    /* ── Tab bar ────────────────────────────────────────────────────────── */

    var bar = doc.querySelector('.mode-bar');
    function placeBar() {
        var r = doc.querySelector('input[name="fxMode"]:checked');
        if (!r || !bar) return;
        var label = r.closest('.mode');
        bar.style.setProperty('--x', label.offsetLeft + 'px');
        bar.style.setProperty('--w', label.offsetWidth + 'px');
    }

    /* ── Slider fill ────────────────────────────────────────────────────── */
    /* The track is filled up to the thumb with the accent. CSS can't read an
       input's value, so --p is written here: on every input, and after any
       click inside a panel, because presets and resets move sliders without
       firing input events. */

    function fill(r) {
        var min = parseFloat(r.min) || 0, max = parseFloat(r.max) || 100;
        var p = max > min ? (parseFloat(r.value) - min) / (max - min) * 100 : 0;
        r.style.setProperty('--p', p + '%');
    }
    function fillAll(root) {
        Array.prototype.forEach.call((root || doc).querySelectorAll('input[type="range"]'), fill);
    }
    doc.addEventListener('input', function (e) {
        if (e.target.type === 'range') fill(e.target);
    });
    doc.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.fx-mode')) setTimeout(function () { fillAll(FX.root(active)); }, 0);
    });

    /* ── Switching ──────────────────────────────────────────────────────── */

    function pick(mode) {
        if (MODES.indexOf(mode) < 0) mode = 'halftone';
        if (mode === active) return;
        var first = active === null;
        active = mode;

        MODES.forEach(function (m) { FX.root(m).hidden = m !== mode; });
        html.setAttribute('data-fx', mode);
        var radio = doc.querySelector('input[name="fxMode"][value="' + mode + '"]');
        if (radio) radio.checked = true;
        placeBar();
        swapWord(mode);

        /* The panel rises in: stage first, then its sections one by one. */
        var panel = FX.root(mode);
        Array.prototype.forEach.call(panel.querySelectorAll('.sec'), function (s, i) {
            s.style.setProperty('--n', i);
        });
        panel.classList.remove('enter');
        void panel.offsetWidth;
        panel.classList.add('enter');
        fillAll(panel);

        try { history.replaceState(null, '', '#' + mode); } catch (e) {}
        store(KEY.mode, mode);

        /* The picture follows you. Loaded only on arrival, not eagerly into
           all three: each engine sizes its first render from its stage, and a
           hidden stage measures zero. */
        if (shared && seen[mode] !== shared && mods[mode]) {
            seen[mode] = shared;
            mods[mode].load(shared);
        }

        /* Every engine already redraws on resize; a panel that was hidden
           while the window changed needs exactly that. */
        window.dispatchEvent(new Event('resize'));
        if (!first && !reduce) window.scrollTo({ top: Math.min(window.scrollY, doc.querySelector('.modes').offsetTop - 16), behavior: 'smooth' });
    }

    doc.querySelectorAll('input[name="fxMode"]').forEach(function (r) {
        r.addEventListener('change', function () { if (r.checked) pick(r.value); });
    });
    window.addEventListener('hashchange', function () { pick(location.hash.slice(1)); });
    window.addEventListener('resize', placeBar);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(placeBar);

    /* One paste handler for the page, delivered to whichever effect you are
       looking at. Three listeners would load the image three times. */
    doc.addEventListener('paste', function (e) {
        var items = (e.clipboardData || {}).items || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') === 0) {
                if (mods[active]) mods[active].load(items[i].getAsFile());
                break;
            }
        }
    });

    /* ── Boot ───────────────────────────────────────────────────────────── */
    /* Runs after every engine script, because DOMContentLoaded waits for all
       synchronous scripts to finish — so every engine has registered. */
    doc.addEventListener('DOMContentLoaded', function () {
        var want = location.hash.slice(1);
        if (MODES.indexOf(want) < 0) want = recall(KEY.mode) || '';
        pick(want);
    });
})();
