/* ============================================================================
   CASSETTE — shared runtime for code.isaiart.com
   Vanilla, no dependencies, no build step. Exposes window.CAS.
   ========================================================================= */
(function () {
    'use strict';

    var THEME_KEY = 'isa.theme';

    /* ── Theme (dark / light) ────────────────────────────────────────────────
       This replaced an amber/green phosphor selector. That control was a joke
       about CRT tubes and it was the only global switch on every page, which
       made it the most prominent thing a first-time visitor could touch and
       also the least useful — it changed one accent and nothing else. Dark and
       light do real work.

       The applied value is held in memory, not re-read from storage. Reading
       it back made the switch one-way wherever storage is blocked (private
       mode): the getter always answered 'dark', so toggle always returned
       'light'. */
    var applied = null;

    function getTheme() {
        if (applied) return applied;
        try { applied = localStorage.getItem(THEME_KEY) || preferredTheme(); }
        catch (e) { applied = preferredTheme(); }
        return applied;
    }

    /* Follow the operating system on a first visit, and only then. Once the
       switch has been touched, the stored choice wins — someone who picked
       light at noon should not be flipped to dark by their OS at dusk. */
    function preferredTheme() {
        return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
            ? 'light' : 'dark';
    }

    function setTheme(mode) {
        var m = mode === 'light' ? 'light' : 'dark';
        applied = m;
        document.documentElement.setAttribute('data-theme', m);
        /* Keep the browser chrome in step, or the address bar stays black over
           a white page on mobile. */
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', m === 'light' ? '#eceae3' : '#0a0b0d');
        try { localStorage.setItem(THEME_KEY, m); } catch (e) {}
        return m;
    }

    function toggleTheme() {
        return setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    }

    /* Apply immediately so the page never flashes the wrong theme. */
    document.documentElement.setAttribute('data-theme', getTheme());

    /* ── file:// link fixup ──────────────────────────────────────────────────
       The pages link to directories — "editor/", "../" — which is what makes
       the live URLs clean: code.isaiart.com/editor/ rather than
       .../editor/index.html. A web server resolves those to index.html; the
       file:// scheme does not, and shows a directory listing instead.
       So when (and only when) the page was opened straight off disk, rewrite
       directory links to point at the file. The HTML stays canonical.       */

    function fixFileLinks() {
        if (location.protocol !== 'file:') return;
        var links = document.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i++) {
            var a = links[i];
            var raw = a.getAttribute('href') || '';
            if (/^(https?:|mailto:|tel:|#)/i.test(raw)) continue;
            if (raw.slice(-1) === '/') a.setAttribute('href', raw + 'index.html');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fixFileLinks);
    } else {
        fixFileLinks();
    }

    /* ── Readout toast ───────────────────────────────────────────────────── */

    var toastEl = null, toastTimer = null;

    function toast(message, isError) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'readout-toast';
            toastEl.setAttribute('role', 'status');
            toastEl.setAttribute('aria-live', 'polite');
            document.body.appendChild(toastEl);
        }
        toastEl.innerHTML = '';
        var lamp = document.createElement('span');
        lamp.className = 'led on' + (isError ? ' red' : ' green');
        var text = document.createElement('span');
        text.textContent = message;
        toastEl.appendChild(lamp);
        toastEl.appendChild(text);
        toastEl.classList.toggle('bad', !!isError);
        // reflow so a repeat message re-animates
        void toastEl.offsetWidth;
        toastEl.classList.add('up');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('up'); }, 2200);
    }

    /* ── Seven-segment readout ───────────────────────────────────────────── */

    var SEG_MAP = {
        '0': 'abcdef', '1': 'bc',    '2': 'abged', '3': 'abgcd', '4': 'fgbc',
        '5': 'afgcd', '6': 'afgedc', '7': 'abc',   '8': 'abcdefg', '9': 'abcfgd',
        '-': 'g',     ' ': '',       'E': 'adefg'
    };

    /* Build (or rebuild) a segment display with `count` digits. */
    function segInit(el, count) {
        el.classList.add('seg');
        el.innerHTML = '';
        for (var d = 0; d < count; d++) {
            var digit = document.createElement('span');
            digit.className = 'seg-digit';
            'abcdefg'.split('').forEach(function (s) {
                var bar = document.createElement('i');
                bar.className = s;
                digit.appendChild(bar);
            });
            el.appendChild(digit);
        }
        el.setAttribute('aria-hidden', 'true');
        return el;
    }

    /* Right-align a value into the display. Overflow shows dashes. */
    function segSet(el, value) {
        var digits = el.children;
        var n = digits.length;
        var str = String(value);
        if (str.length > n) str = new Array(n + 1).join('-');
        while (str.length < n) str = ' ' + str;
        for (var i = 0; i < n; i++) {
            var lit = SEG_MAP[str[i]] === undefined ? '' : SEG_MAP[str[i]];
            var bars = digits[i].children;
            for (var b = 0; b < bars.length; b++) {
                bars[b].classList.toggle('on', lit.indexOf(bars[b].className.replace(' on', '')) !== -1);
            }
        }
    }

    /* ── Clipboard ───────────────────────────────────────────────────────── */

    function copy(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            ok ? resolve() : reject(new Error('copy blocked'));
        });
    }

    function paste() {
        if (navigator.clipboard && navigator.clipboard.readText) {
            return navigator.clipboard.readText();
        }
        return Promise.reject(new Error('clipboard read unavailable'));
    }

    /* ── Download ────────────────────────────────────────────────────────── */

    function download(filename, text, mime) {
        var blob = new Blob([text], { type: mime || 'text/html;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Give the browser a beat to start the download before releasing the URL.
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    /* Open user code in a new tab. The blob URL is revoked late, never
       immediately — revoking synchronously races the new tab and blanks it. */
    function openInTab(html) {
        var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var w = window.open(url, '_blank');
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        return w;
    }

    /* ── Sandboxed preview ───────────────────────────────────────────────── */

    /* Always render user code inside a sandboxed iframe via srcdoc.
       allow-scripts without allow-same-origin: their JS runs, but it cannot
       touch this page, our localStorage, or our cookies. */
    function renderPreview(iframe, html) {
        iframe.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms allow-popups');
        iframe.srcdoc = html;
    }

    /* ── Boot wipe (once per tab session) ────────────────────────────────── */

    function bootOnce(el) {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var seen;
        try { seen = sessionStorage.getItem('isa.booted'); } catch (e) { seen = '1'; }
        if (seen || reduce || !el) return;
        try { sessionStorage.setItem('isa.booted', '1'); } catch (e) {}
        el.classList.add('crt-on');
        setTimeout(function () { el.classList.remove('crt-on'); }, 600);
    }

    /* ── Wireframe globe ─────────────────────────────────────────────────────
       An orthographic lat/long sphere stroked in 1px lines: no fill, no
       shading, no light source — drawn the way a vector display would draw it.
       Sizes itself to the canvas's CSS box, redraws on resize, rotates once
       every ~25s, and stops entirely when the tab is hidden or the user has
       asked for reduced motion.                                              */

    function globe(canvas, opts) {
        if (!canvas || !canvas.getContext) return null;
        opts = opts || {};
        var ctx = canvas.getContext('2d');
        var parallels = opts.parallels || 5;
        var meridians = opts.meridians || 6;
        /* ~0.004 rad per frame at 20fps is one revolution every ~80s — slow
           enough to read as drift rather than motion. */
        var speed = opts.speed || 0.004;
        /* Axial tilt. The limb of a sphere is always a circle, so only the
           graticule rotates — tilting the whole canvas would just spin a
           circle and look identical. */
        var tilt = opts.tilt === undefined ? -0.42 : opts.tilt;
        var lon = 0, raf = 0, last = 0, W = 0, H = 0;
        var reduce = window.matchMedia &&
                     window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function resize() {
            var box = canvas.getBoundingClientRect();
            var dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = Math.max(1, Math.round(box.width));
            H = Math.max(1, Math.round(box.height));
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function paint() {
            if (!W || !H) resize();
            var cs = getComputedStyle(document.documentElement);
            var line = (cs.getPropertyValue('--phos-dim') || '#b07b06').trim();
            var hot  = (cs.getPropertyValue('--phos') || '#ffb000').trim();
            var cx = W / 2, cy = H / 2;
            var R = Math.min(W, H) / 2 - 2;
            if (R <= 2) return;

            ctx.clearRect(0, 0, W, H);
            ctx.lineWidth = 1;

            ctx.strokeStyle = hot;                        /* limb */
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.stroke();

            /* Everything inside the limb is drawn on a tilted axis, clipped to
               the sphere so nothing spills past the edge. */
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.clip();
            ctx.translate(cx, cy);
            ctx.rotate(tilt);

            ctx.strokeStyle = line;
            var i, k, t, y, r;
            for (i = 1; i < parallels; i++) {             /* parallels */
                t = -1 + (2 * i) / parallels;
                y = R * t;
                r = R * Math.sqrt(Math.max(0, 1 - t * t));
                ctx.beginPath();
                ctx.ellipse(0, y, r, r * 0.18, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
            for (k = 0; k < meridians; k++) {             /* meridians */
                var a = lon + (k * Math.PI) / meridians;
                ctx.beginPath();
                ctx.ellipse(0, 0, Math.abs(Math.cos(a)) * R, R, 0, 0, Math.PI * 2);
                ctx.stroke();
            }

            ctx.restore();

            /* The polar axis, drawn OUTSIDE the clip so it protrudes past both
               poles — the detail that makes the tilt read as a tilt rather
               than a wonky drawing. */
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(tilt);
            ctx.strokeStyle = hot;
            ctx.beginPath();
            ctx.moveTo(0, -R * 1.14);
            ctx.lineTo(0, R * 1.14);
            ctx.stroke();
            ctx.restore();
        }

        function frame(ts) {
            raf = requestAnimationFrame(frame);
            if (ts - last < 50) return;                   /* 20fps is ample */
            last = ts;
            lon += speed;
            paint();
        }

        function start() { if (!raf && !reduce) { last = 0; raf = requestAnimationFrame(frame); } }
        function stop()  { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

        resize();
        paint();
        start();

        window.addEventListener('resize', debounce(function () { resize(); paint(); }, 120));
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) stop(); else start();
        });
        return { paint: paint, stop: stop, start: start };
    }

    /* ── Braille ─────────────────────────────────────────────────────────────
       Real uncontracted (Grade 1) English braille in Unicode, U+2800 + a dot
       bitmask: dot1=1, dot2=2, dot3=4, dot4=8, dot5=16, dot6=32. Decorative
       here, so anything that renders it must be aria-hidden — a screen reader
       announcing these cells reads gibberish, not braille.                   */

    var BRAILLE_DOTS = {
        a: 0x01, b: 0x03, c: 0x09, d: 0x19, e: 0x11, f: 0x0b, g: 0x1b,
        h: 0x13, i: 0x0a, j: 0x1a, k: 0x05, l: 0x07, m: 0x0d, n: 0x1d,
        o: 0x15, p: 0x0f, q: 0x1f, r: 0x17, s: 0x0e, t: 0x1e, u: 0x25,
        v: 0x27, w: 0x3a, x: 0x2d, y: 0x3d, z: 0x35,
        ' ': 0x00, ',': 0x02, ';': 0x06, ':': 0x12, '.': 0x32,
        '!': 0x16, '?': 0x22, "'": 0x04, '-': 0x24
    };
    var BRAILLE_NUM = '⠼';
    var BRAILLE_DIGIT = 'jabcdefghi';   /* 0 is j, 1 is a, ... */

    function braille(text) {
        var out = '', numeric = false, i, ch, dots;
        text = String(text).toLowerCase();
        for (i = 0; i < text.length; i++) {
            ch = text.charAt(i);
            if (ch >= '0' && ch <= '9') {
                if (!numeric) { out += BRAILLE_NUM; numeric = true; }
                out += String.fromCharCode(0x2800 + BRAILLE_DOTS[BRAILLE_DIGIT.charAt(+ch)]);
                continue;
            }
            numeric = false;
            dots = BRAILLE_DOTS[ch];
            out += dots === undefined ? '⠀' : String.fromCharCode(0x2800 + dots);
        }
        return out;
    }

    /* Render the braille of every [data-braille] element beneath its own text,
       so the two can never drift apart. */
    function brailleAnnotate(root) {
        var nodes = (root || document).querySelectorAll('[data-braille]');
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (el.querySelector('.braille')) continue;
            var span = document.createElement('span');
            span.className = 'braille';
            span.setAttribute('aria-hidden', 'true');
            span.textContent = braille(el.textContent.trim());
            el.appendChild(span);
        }
    }

    /* ── Page transition ─────────────────────────────────────────────────────
       A wipe with the six-band stripe as its leading edge — the same mark the
       pages are branded with, used as the cut between them. Out on click, in
       on arrival. Skipped entirely under prefers-reduced-motion, and it never
       traps the viewport: the overlay clears on a timer, on pageshow (so the
       bfcache back-button doesn't land on a covered page), and on failure.   */

    var WIPE_MS = 220;

    function buildWipe() {
        var el = document.createElement('div');
        el.className = 'page-wipe';
        el.setAttribute('aria-hidden', 'true');
        var bar = document.createElement('span');
        bar.className = 'page-wipe-edge';
        for (var i = 0; i < 6; i++) bar.appendChild(document.createElement('i'));
        el.appendChild(bar);
        return el;
    }

    function pageTransition() {
        var reduce = window.matchMedia &&
                     window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) return;

        var wipe = buildWipe();
        document.documentElement.appendChild(wipe);

        /* Arrive: the wipe is already covering, slide it off. */
        requestAnimationFrame(function () { wipe.classList.add('out'); });
        var clear = setTimeout(function () { wipe.classList.add('idle'); }, WIPE_MS + 60);

        /* A restored bfcache page must never keep a covering overlay. */
        window.addEventListener('pageshow', function (e) {
            if (!e.persisted) return;
            clearTimeout(clear);
            wipe.classList.remove('in');
            wipe.classList.add('out', 'idle');
        });

        document.addEventListener('click', function (e) {
            if (e.defaultPrevented || e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            var a = e.target && e.target.closest && e.target.closest('a[href]');
            if (!a) return;
            if (a.target && a.target !== '_self') return;
            if (a.hasAttribute('download')) return;
            var href = a.getAttribute('href') || '';
            if (href.charAt(0) === '#' || /^(mailto|tel|javascript|blob|data):/i.test(href)) return;

            var url;
            try { url = new URL(a.href, location.href); } catch (err) { return; }
            if (url.origin !== location.origin) return;           /* leave the site normally */
            if (url.pathname === location.pathname && url.hash) return;

            e.preventDefault();
            /* park it off-screen left with no transition, force a reflow so
               that position is committed, THEN animate it across. Without the
               reflow the browser coalesces both writes and nothing moves. */
            wipe.classList.remove('idle', 'out');
            wipe.classList.add('arm');
            void wipe.offsetWidth;
            wipe.classList.remove('arm');
            wipe.classList.add('in');
            var went = false;
            function go() { if (!went) { went = true; location.href = a.href; } }
            setTimeout(go, WIPE_MS);
            setTimeout(go, WIPE_MS + 400);                        /* belt and braces */
        });
    }

    /* ── Service worker ──────────────────────────────────────────────────── */

    function registerSW(path) {
        if (!('serviceWorker' in navigator)) return;
        if (location.protocol === 'file:') return;
        window.addEventListener('load', function () {
            navigator.serviceWorker.register(path || '/sw.js').catch(function () { /* offline support is optional */ });
        });
    }

    /* ── Debounce ────────────────────────────────────────────────────────── */

    function debounce(fn, ms) {
        var t;
        return function () {
            var args = arguments, self = this;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(self, args); }, ms);
        };
    }

    window.CAS = {
        getTheme: getTheme,
        setTheme: setTheme,
        toggleTheme: toggleTheme,
        /* Old names, so a page that has not been ported yet still runs. */
        getPhosphor: getTheme,
        setPhosphor: setTheme,
        togglePhosphor: toggleTheme,
        toast: toast,
        segInit: segInit,
        segSet: segSet,
        copy: copy,
        paste: paste,
        download: download,
        openInTab: openInTab,
        renderPreview: renderPreview,
        bootOnce: bootOnce,
        registerSW: registerSW,
        debounce: debounce,
        globe: globe,
        pageTransition: pageTransition,
        braille: braille,
        brailleAnnotate: brailleAnnotate
    };
})();
