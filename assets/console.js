/* ============================================================================
   SEARCH — shared runtime for the query terminals
   ---------------------------------------------------------------------------
   Vanilla, no dependencies, no build step. Depends on cassette.js (window.CAS)
   for the toast, the boot wipe, the phosphor selector and the page wipe.

   Each terminal supplies one function — compile() — which turns the state of
   its own form into { q, url, ops }. Everything else (binding, readout,
   persistence, the transport dock, keyboard) is handled here, so the three
   pages differ only in the part that is genuinely different: which operators
   the network understands.
   ========================================================================= */
(function () {
    'use strict';

    var doc = document;
    var reduce = window.matchMedia &&
                 window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ── Value readers ───────────────────────────────────────────────────────
       Every reader is null-safe: a page that omits a control simply gets the
       empty answer rather than a TypeError that takes the whole readout down. */

    function el(id) { return doc.getElementById(id); }

    /* Trimmed text of a field. */
    function v(id) {
        var n = el(id);
        return n ? n.value.trim() : '';
    }

    /* A field's value as a non-negative integer string, or '' if it isn't one.
       Guards the count operators: min_faves:-5 and min_faves:3.7 are not
       queries, they are typos that return nothing with no explanation. */
    function n(id) {
        var raw = v(id);
        if (!raw) return '';
        var num = Math.floor(Number(raw));
        if (!isFinite(num) || num < 0) return '';
        return String(num);
    }

    function c(id) {
        var node = el(id);
        return !!(node && node.checked);
    }

    /* Selected value of a radio group. */
    function r(name) {
        var node = doc.querySelector('input[name="' + name + '"]:checked');
        return node ? node.value : '';
    }

    /* Split a free-typed list on commas and/or whitespace. Users type
       "alice, bob" and "alice bob" interchangeably; both mean two handles. */
    function list(id) {
        var raw = v(id);
        if (!raw) return [];
        return raw.split(/[,\s]+/).map(function (s) { return s.trim(); })
                  .filter(function (s) { return s.length > 0; });
    }

    /* Handles, with any leading @ removed — every network's operators take the
       bare handle, and every user types the @. */
    function handles(id) {
        return list(id).map(function (s) { return s.replace(/^@+/, ''); });
    }

    /* Tags, normalised the other way: with exactly one leading #. */
    function tags(id) {
        return list(id).map(function (s) { return '#' + s.replace(/^#+/, ''); });
    }

    /* Bare tags — no marker. Bluesky's structured tag param stores them plain. */
    function bareTags(id) {
        return list(id).map(function (s) { return s.replace(/^#+/, ''); });
    }

    /* Wrap in quotes unless the user already did. A phrase that arrives
       pre-quoted must not come back out as ""like this"". */
    function phrase(id) {
        var raw = v(id);
        if (!raw) return '';
        if (raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"' && raw.length > 1) {
            return raw;
        }
        return '"' + raw.replace(/"/g, '') + '"';
    }

    /* ── Clock ───────────────────────────────────────────────────────────── */

    function pad(x) { return (x < 10 ? '0' : '') + x; }

    function clock(node) {
        if (!node) return;
        function tick() {
            var d = new Date();
            node.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        }
        tick();
        setInterval(tick, 1000);
    }

    /* ── Oscilloscope ────────────────────────────────────────────────────────
       The same trace the hub at code.isaiart.com runs, kept here so the header
       of a search terminal is recognisably the same instrument. It stops when
       the tab is hidden — an idle background tab has no business animating. */

    function scope(canvas) {
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext('2d');
        var W = 120, H = 28;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var trace = new Array(W), phase = 0, colour = '#ffb000';
        var raf = 0, last = 0, running = false;

        /* Read the colour from the token, never a literal — otherwise the
           trace keeps drawing amber after the display is switched to green. */
        function readColour() {
            var cs = getComputedStyle(doc.documentElement);
            var got = (cs.getPropertyValue('--phos') || '').trim();
            if (got) colour = got;
        }

        function sample() {
            phase += 0.13;
            var val = Math.sin(phase) * 0.55
                    + Math.sin(phase * 0.37 + 1.1) * 0.2
                    + (Math.random() - 0.5) * 0.14;
            if (val > 1) val = 1; else if (val < -1) val = -1;
            return H / 2 - val * (H / 2 - 3);
        }

        for (var i = 0; i < W; i++) trace[i] = sample();

        function draw() {
            ctx.clearRect(0, 0, W, H);
            ctx.strokeStyle = colour;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.16;
            ctx.beginPath();
            ctx.moveTo(0, H / 2 + 0.5);
            ctx.lineTo(W, H / 2 + 0.5);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.lineWidth = 1.25;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(0, trace[0]);
            for (var k = 1; k < W; k++) ctx.lineTo(k, trace[k]);
            ctx.stroke();
        }

        function frame(ts) {
            raf = requestAnimationFrame(frame);
            if (ts - last < 33) return;          /* ~30fps */
            last = ts;
            trace.shift();
            trace.push(sample());
            draw();
        }

        function start() {
            if (running || reduce) return;
            running = true; last = 0;
            raf = requestAnimationFrame(frame);
        }
        function stop() {
            if (!running) return;
            running = false;
            cancelAnimationFrame(raf);
            raf = 0;
        }

        readColour();
        draw();
        start();

        doc.addEventListener('visibilitychange', function () {
            if (doc.hidden) stop(); else start();
        });

        return { repaint: function () { readColour(); draw(); } };
    }

    /* ── Theme rocker ────────────────────────────────────────────────────── */

    function themeSwitch(input, onChange) {
        if (!input || !window.CAS) return;
        input.checked = CAS.getTheme() === 'light';
        input.addEventListener('change', function () {
            var want = input.checked ? 'light' : 'dark';
            var mode = CAS.toggleTheme();
            /* Where storage is blocked the toggle cannot read its own state and
               can answer with the mode it just left. Force it. */
            if (mode !== want) mode = CAS.setTheme(want);
            input.checked = mode === 'light';
            if (onChange) onChange(mode);
            CAS.toast(mode === 'light' ? 'LIGHT' : 'DARK');
        });
    }

    /* ── Form state ──────────────────────────────────────────────────────────
       Serialised as a flat map. Checkboxes and radios are stored by the same
       key shape as fields so a restore is one pass in either direction. */

    function controls(root) {
        return Array.prototype.slice.call(
            (root || doc).querySelectorAll('input, select, textarea')
        ).filter(function (node) {
            return node.type !== 'button' && node.type !== 'submit' && !node.dataset.noSave;
        });
    }

    function snapshot(root) {
        var out = {};
        controls(root).forEach(function (node) {
            if (node.type === 'checkbox') {
                if (node.id) out['c:' + node.id] = node.checked;
            } else if (node.type === 'radio') {
                if (node.checked && node.name) out['r:' + node.name] = node.value;
            } else if (node.id) {
                out['v:' + node.id] = node.value;
            }
        });
        return out;
    }

    function apply(root, state) {
        if (!state) return;
        controls(root).forEach(function (node) {
            if (node.type === 'checkbox') {
                if (node.id && typeof state['c:' + node.id] === 'boolean') {
                    node.checked = state['c:' + node.id];
                }
            } else if (node.type === 'radio') {
                if (node.name && typeof state['r:' + node.name] === 'string') {
                    node.checked = node.value === state['r:' + node.name];
                }
            } else if (node.id && typeof state['v:' + node.id] === 'string') {
                node.value = state['v:' + node.id];
            }
        });
    }

    function load(key) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function save(key, state) {
        try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {}
    }

    function drop(key) {
        try { localStorage.removeItem(key); } catch (e) {}
    }

    /* ── Terminal ────────────────────────────────────────────────────────────
       Wires one search page end to end. */

    function terminal(cfg) {
        var root = doc.querySelector('main') || doc.body;
        var qOut = el('qOut');
        var uOut = el('uOut');
        var opCount = el('opCount');
        var qLed = el('qLed');
        var qStat = el('qStat');
        var goBtn = el('goBtn');
        var defaults = snapshot(root);
        var current = { q: '', url: '', ops: 0 };

        /* ── header furniture ── */
        if (window.CAS) CAS.bootOnce(el('headScreen'));
        clock(el('clock'));
        var trace = scope(el('scope'));
        themeSwitch(el('themeSw'), function () { if (trace) trace.repaint(); });

        /* ── restore, then let the URL override ──────────────────────────────
           A shared link is a deliberate act; the last local session is not. So
           ?q= wins over whatever was left in storage. */
        if (cfg.storeKey) apply(root, load(cfg.storeKey));

        if (cfg.prefill) {
            var incoming = '';
            try { incoming = new URL(location.href).searchParams.get('q') || ''; } catch (e) {}
            if (incoming) {
                var target = el(cfg.prefill);
                if (target) target.value = incoming;
            }
        }

        function paint() {
            var built;
            try {
                built = cfg.compile() || {};
            } catch (e) {
                built = { q: '', url: '', ops: 0 };
            }
            current = {
                q: built.q || '',
                url: built.url || '',
                ops: built.ops || 0
            };

            if (qOut) {
                qOut.textContent = current.q || (cfg.emptyQuery || 'Query will appear here…');
                qOut.classList.toggle('empty', !current.q);
            }
            if (uOut) {
                uOut.textContent = current.url || (cfg.emptyUrl || '—');
                uOut.classList.toggle('empty', !current.url);
            }
            /* The term count reports what was built; the lamp and the status
               report what can actually FIRE. They are not the same thing —
               Threads' web mode compiles a site: clause from nothing the user
               typed, so a query can hold terms and still have no URL. Keying
               the lamp to the term count lit ARMED next to a dead button. */
            if (opCount) {
                opCount.textContent = current.ops + (current.ops === 1 ? ' TERM' : ' TERMS');
            }
            var armed = !!current.url;
            if (qLed) {
                qLed.classList.toggle('on', armed);
                qLed.classList.toggle('green', armed);
            }
            if (qStat) qStat.textContent = armed ? 'ARMED' : 'IDLE';
            if (goBtn) goBtn.disabled = !armed;

            if (cfg.storeKey) save(cfg.storeKey, snapshot(root));
            if (cfg.onPaint) cfg.onPaint(current);
        }

        /* One delegated pair of listeners rather than one per control, so a
           rack added to the HTML later is live without touching this file. */
        root.addEventListener('input', paint);
        root.addEventListener('change', paint);

        function run() {
            if (!current.url) {
                if (window.CAS) CAS.toast('NOTHING TO SEARCH', true);
                return;
            }
            var win = window.open(current.url, '_blank', 'noopener');
            if (!win && window.CAS) CAS.toast('POPUP BLOCKED — COPY THE URL', true);
        }

        function bindKey(id, fn) {
            var node = el(id);
            if (node) node.addEventListener('click', fn);
        }

        bindKey('goBtn', run);

        bindKey('copyBtn', function () {
            if (!current.q) { if (window.CAS) CAS.toast('QUERY IS EMPTY', true); return; }
            CAS.copy(current.q).then(function () { CAS.toast('QUERY COPIED'); },
                                     function () { CAS.toast('COPY BLOCKED', true); });
        });

        bindKey('copyUrlBtn', function () {
            if (!current.url) { if (window.CAS) CAS.toast('NO URL YET', true); return; }
            CAS.copy(current.url).then(function () { CAS.toast('URL COPIED'); },
                                       function () { CAS.toast('COPY BLOCKED', true); });
        });

        bindKey('resetBtn', function () {
            apply(root, defaults);
            /* defaults only records the CHECKED radio of each group and every
               id'd control, so anything the page left unset stays unset —
               clear checkboxes explicitly rather than trusting the snapshot. */
            controls(root).forEach(function (node) {
                if (node.type === 'checkbox' && typeof defaults['c:' + node.id] !== 'boolean') {
                    node.checked = false;
                }
            });
            if (cfg.storeKey) drop(cfg.storeKey);
            paint();
            if (window.CAS) CAS.toast('CONSOLE CLEARED');
        });

        /* Enter runs the search from any single-line field; Ctrl/Cmd+Enter runs
           it from anywhere, including the textareas where Enter is a newline. */
        root.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); run(); return; }
            var t = e.target;
            if (t && t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'radio') {
                e.preventDefault();
                run();
            }
        });

        paint();
        return { paint: paint, run: run, state: function () { return current; } };
    }

    window.SRCH = {
        el: el,
        v: v,
        n: n,
        c: c,
        r: r,
        list: list,
        handles: handles,
        tags: tags,
        bareTags: bareTags,
        phrase: phrase,
        clock: clock,
        scope: scope,
        themeSwitch: themeSwitch,
        phosphorSwitch: themeSwitch,
        terminal: terminal
    };
})();
