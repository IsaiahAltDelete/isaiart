/* ============================================================================
   STUDIO runtime — theme, toasts, the animated controls, and the viewport
   that both print tools draw into.
   ========================================================================= */
(function () {
    'use strict';

    var S = window.STUDIO = {};
    var root = document.documentElement;
    var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    S.reduced = reduced;

    /* ── Theme ───────────────────────────────────────────────────────────
       The head of each page stamps data-theme before first paint (see the
       inline snippet in the pages); this only handles the toggle. */
    var KEY = 'isa.studio.theme';
    S.theme = function () { return root.getAttribute('data-theme') || 'light'; };
    S.setTheme = function (t) {
        root.setAttribute('data-theme', t);
        try { localStorage.setItem(KEY, t); } catch (e) {}
        document.dispatchEvent(new CustomEvent('studio:theme', { detail: t }));
    };
    S.bindThemeButton = function (btn) {
        if (!btn) return;
        function sync() { btn.setAttribute('aria-pressed', String(S.theme() === 'dark')); }
        btn.addEventListener('click', function () { S.setTheme(S.theme() === 'dark' ? 'light' : 'dark'); sync(); });
        sync();
    };

    /* ── Toast ───────────────────────────────────────────────────────────── */
    var host = null;
    S.toast = function (msg, bad) {
        if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
        var t = document.createElement('div');
        t.className = 'toast' + (bad ? ' bad' : '');
        var ic = document.createElement('span'), span = document.createElement('span');
        ic.className = 'material-symbols-outlined';
        ic.textContent = bad ? 'error' : 'check_circle';
        span.textContent = msg;
        t.appendChild(ic); t.appendChild(span);
        host.appendChild(t);
        while (host.children.length > 3) host.removeChild(host.firstChild);
        setTimeout(function () {
            t.classList.add('out');
            setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 240);
        }, bad ? 3600 : 2400);
    };

    S.download = function (blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
    };

    S.debounce = function (fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; };

    /* ── Range fill ──────────────────────────────────────────────────────── */
    function fillRange(r) {
        var min = +r.min || 0, max = r.max === '' ? 100 : +r.max, v = +r.value;
        r.style.setProperty('--p', ((v - min) / (max - min || 1) * 100) + '%');
    }
    S.fillRange = fillRange;
    document.addEventListener('input', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('range')) fillRange(e.target);
    });

    /* ── Segmented pill ──────────────────────────────────────────────────── */
    function placePill(seg, animate) {
        var pill = seg.querySelector('.seg-pill');
        var on = seg.querySelector('input:checked');
        if (!pill) return;
        if (!on) { pill.style.opacity = '0'; return; }
        var lab = on.closest('label');
        if (!animate) pill.style.transition = 'none';
        pill.style.opacity = '1';
        pill.style.width = lab.offsetWidth + 'px';
        pill.style.transform = 'translateX(' + lab.offsetLeft + 'px)';
        if (!animate) { void pill.offsetWidth; pill.style.transition = ''; }
    }
    S.syncSeg = function (seg) { placePill(seg, false); };
    function initSegs(scope) {
        (scope || document).querySelectorAll('.seg').forEach(function (seg) {
            if (seg._pill) return;
            seg._pill = true;
            var pill = document.createElement('span');
            pill.className = 'seg-pill';
            seg.insertBefore(pill, seg.firstChild);
            seg.addEventListener('change', function () { placePill(seg, true); });
            if (window.ResizeObserver) new ResizeObserver(function () { placePill(seg, false); }).observe(seg);
            placePill(seg, false);
        });
    }

    /* ── Collapsible panels: <details class="panel"> animates its height
          instead of jumping. ─────────────────────────────────────────────── */
    function initDetails(scope) {
        (scope || document).querySelectorAll('details.panel').forEach(function (d) {
            if (d._anim) return;
            d._anim = true;
            var sum = d.querySelector('summary');
            var body = d.querySelector('.panel-body-wrap');
            if (!sum || !body) return;
            sum.addEventListener('click', function (e) {
                e.preventDefault();
                if (reduced) { d.open = !d.open; return; }
                var opening = !d.open;
                if (opening) d.open = true;
                var h = body.scrollHeight;
                var a = body.animate(
                    opening ? [{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }]
                            : [{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
                    { duration: 620, easing: 'cubic-bezier(.2, .75, .1, 1)' });
                if (!opening) a.onfinish = function () { d.open = false; };
                if (opening) setTimeout(function () { d.querySelectorAll('.seg').forEach(function (s) { placePill(s, false); }); }, 0);
            });
        });
    }

    /* The page title rises in letter by letter, as on the character sheet. */
    function splitTitles(scope) {
        (scope || document).querySelectorAll('h1.name[data-split]').forEach(function (h) {
            if (h._split) return;
            h._split = true;
            var text = h.textContent;
            h.setAttribute('aria-label', text);
            var line = document.createElement('span');
            line.className = 'line'; line.setAttribute('aria-hidden', 'true');
            Array.prototype.forEach.call(text, function (c, i) {
                var s = document.createElement('span');
                s.className = 'ch'; s.style.setProperty('--i', i); s.textContent = c;
                line.appendChild(s);
            });
            h.textContent = ''; h.appendChild(line);
        });
    }

    /* Top bar gains its hairline once the page has scrolled. */
    function watchTop() {
        var top = document.querySelector('.top');
        if (!top) return;
        var on = function () { top.classList.toggle('scrolled', window.scrollY > 8); };
        window.addEventListener('scroll', on, { passive: true }); on();
    }

    S.init = function (scope) {
        splitTitles(scope);
        if (!scope) watchTop();
        initSegs(scope);
        initDetails(scope);
        (scope || document).querySelectorAll('.range').forEach(fillRange);
        (scope || document).querySelectorAll('.scroll-auto, .sidebar').forEach(function (n) { n.classList.add('scroll'); });
    };

    /* Controls with a data-def mark themselves `.moved` when off it. */
    S.markMoved = function (input) {
        var c = input.closest('.ctl');
        if (c && c.dataset.def != null) c.classList.toggle('moved', String(+input.value) !== String(+c.dataset.def));
    };

    /* ── Whole-window file drop ─────────────────────────────────────────── */
    S.fileDrop = function (onFiles, text) {
        var veil = document.createElement('div');
        veil.className = 'dropveil';
        veil.innerHTML = '<div><span class="material-symbols-outlined">upload_file</span><span></span></div>';
        veil.firstChild.lastChild.textContent = text || 'Drop images';
        document.body.appendChild(veil);
        var depth = 0;
        function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
        window.addEventListener('dragenter', function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth++; veil.classList.add('on'); });
        window.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); });
        window.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) veil.classList.remove('on'); });
        window.addEventListener('drop', function (e) {
            if (!hasFiles(e)) return;
            e.preventDefault(); depth = 0; veil.classList.remove('on');
            if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files, e);
        });
        document.addEventListener('paste', function (e) {
            var items = (e.clipboardData || {}).items || [], files = [];
            for (var i = 0; i < items.length; i++) if (items[i].type.indexOf('image') === 0) files.push(items[i].getAsFile());
            if (files.length) onFiles(files, e);
        });
    };

    /* ── Viewport ────────────────────────────────────────────────────────────
       A canvas the size of its box, and content drawn into it through one
       transform: screen = art × s + (x, y). Zooming is animated, and animated
       about an ANCHOR — the art point under the cursor stays under the cursor
       on every frame of the animation, not just the last one. Interpolating
       scale and offset independently (the obvious way) makes the image swing
       sideways mid-zoom; anchoring removes that.

       Options
         size()                  → {w, h} of the content in art units, or null
         draw(ctx, view, dpr)    → paint; ctx already carries the transform
         overlay(ctx, view, dpr) → optional, drawn after with the identity
                                   transform (for screen-space UI)
         down(pt, e)             → optional; return {move(pt,e), up(pt,e)} to
                                   take the drag, or nothing to let it pan
         hover(pt, e)            → optional
         change(view)            → optional; fired after every paint
    */
    S.viewport = function (wrap, canvas, o) {
        var ctx = canvas.getContext('2d');
        var v = { s: 1, x: 0, y: 0 };
        var fitMode = true, anim = null, frame = 0, dpr = 1;
        var pad = o.pad == null ? 32 : o.pad;
        var MAXS = o.maxScale || 16;

        function box() { return { w: wrap.clientWidth, h: wrap.clientHeight }; }
        function fitState() {
            var c = o.size(), b = box();
            if (!c || !b.w || !b.h) return { s: 1, x: 0, y: 0 };
            var s = Math.min((b.w - 2 * pad) / c.w, (b.h - 2 * pad) / c.h);
            if (!(s > 0)) s = 0.01;
            return { s: s, x: (b.w - c.w * s) / 2, y: (b.h - c.h * s) / 2 };
        }
        function minS() { return fitState().s * 0.4; }

        function paint() {
            frame = 0;
            var b = box();
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            var W = Math.round(b.w * dpr), H = Math.round(b.h * dpr);
            if (canvas.width !== W || canvas.height !== H) {
                canvas.width = W; canvas.height = H;
                canvas.style.width = b.w + 'px'; canvas.style.height = b.h + 'px';
            }
            if (fitMode && !anim) { var f = fitState(); v.s = f.s; v.x = f.x; v.y = f.y; }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, W, H);
            if (o.size()) {
                ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
                o.draw(ctx, v, dpr);
                if (o.overlay) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); o.overlay(ctx, v, dpr); }
            }
            if (o.change) o.change(v, fitMode);
        }
        function redraw() { if (!frame) frame = requestAnimationFrame(step); }

        function ease(t) { return 1 - Math.pow(1 - t, 3); }
        function step(now) {
            frame = 0;
            if (anim) {
                var t = Math.min(1, (now - anim.t0) / anim.dur);
                if (!anim.t0) { anim.t0 = now; t = 0; }
                var e = ease(t);
                var s = Math.exp(Math.log(anim.s0) + (Math.log(anim.s1) - Math.log(anim.s0)) * e);
                if (anim.type === 'anchor') {
                    v.s = s; v.x = anim.px - anim.ax * s; v.y = anim.py - anim.ay * s;
                } else {
                    /* Centre mode (fit): the art point at the box centre
                       travels linearly while scale moves in log space. */
                    var b = box();
                    var cx = anim.c0x + (anim.c1x - anim.c0x) * e, cy = anim.c0y + (anim.c1y - anim.c0y) * e;
                    v.s = s; v.x = b.w / 2 - cx * s; v.y = b.h / 2 - cy * s;
                }
                if (t >= 1) { anim = null; } else { frame = requestAnimationFrame(step); }
            }
            paint();
        }

        function animateAnchor(s1, px, py) {
            s1 = Math.max(minS(), Math.min(MAXS, s1));
            var ax = (px - v.x) / v.s, ay = (py - v.y) / v.s;
            fitMode = false;
            anim = { type: 'anchor', s0: v.s, s1: s1, px: px, py: py, ax: ax, ay: ay, t0: 0, dur: reduced ? 1 : 340 };
            redraw();
        }
        function target() { return anim ? anim.s1 : v.s; }

        var api = {
            redraw: redraw,
            fit: function (instant) {
                var f = fitState(), b = box();
                if (instant || reduced) { anim = null; fitMode = true; v.s = f.s; v.x = f.x; v.y = f.y; redraw(); return; }
                anim = { type: 'center', s0: v.s, s1: f.s,
                         c0x: (b.w / 2 - v.x) / v.s, c0y: (b.h / 2 - v.y) / v.s,
                         c1x: (b.w / 2 - f.x) / f.s, c1y: (b.h / 2 - f.y) / f.s, t0: 0, dur: 700 };
                fitMode = true;
                redraw();
            },
            zoomBy: function (k, px, py) {
                var b = box();
                if (px == null) { px = b.w / 2; py = b.h / 2; }
                animateAnchor(target() * k, px, py);
            },
            zoomTo: function (s, px, py) {
                var b = box();
                if (px == null) { px = b.w / 2; py = b.h / 2; }
                animateAnchor(s, px, py);
            },
            scale: function () { return v.s; },
            fitScale: function () { return fitState().s; },
            isFit: function () { return fitMode; },
            toArt: function (clientX, clientY) {
                var r = wrap.getBoundingClientRect();
                return { x: (clientX - r.left - v.x) / v.s, y: (clientY - r.top - v.y) / v.s };
            },
            view: v
        };

        /* Wheel: zoom about the cursor. A pinch on a trackpad arrives as a
           wheel with ctrlKey and small deltas, so it gets a steeper curve. */
        wrap.addEventListener('wheel', function (e) {
            if (!o.size()) return;
            e.preventDefault();
            var r = wrap.getBoundingClientRect();
            var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            var k = Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0018));
            k = Math.max(0.5, Math.min(2, k));
            animateAnchor(target() * k, e.clientX - r.left, e.clientY - r.top);
        }, { passive: false });

        /* Pointers: one pointer drags (the page's handler if it claims it,
           else a pan); two pointers pinch. */
        var ptrs = {}, drag = null, pinch = null;
        function count() { return Object.keys(ptrs).length; }
        wrap.addEventListener('pointerdown', function (e) {
            if (!o.size()) return;
            if (e.button !== 0 && e.button !== 1) return;
            ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
            try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
            if (count() === 2) {
                if (drag && drag.handler && drag.handler.up) drag.handler.up(api.toArt(e.clientX, e.clientY), e);
                drag = null;
                var ids = Object.keys(ptrs), a = ptrs[ids[0]], b2 = ptrs[ids[1]];
                pinch = { d: Math.hypot(a.x - b2.x, a.y - b2.y), s: v.s, mx: (a.x + b2.x) / 2, my: (a.y + b2.y) / 2 };
                pinch.ax = (pinch.mx - wrap.getBoundingClientRect().left - v.x) / v.s;
                pinch.ay = (pinch.my - wrap.getBoundingClientRect().top - v.y) / v.s;
                return;
            }
            var pt = api.toArt(e.clientX, e.clientY);
            var handler = (e.button === 0 && !e.altKey && o.down) ? o.down(pt, e) : null;
            drag = { id: e.pointerId, x: e.clientX, y: e.clientY, handler: handler };
            if (!handler) wrap.classList.add('grabbing');
            anim = null;
        });
        wrap.addEventListener('pointermove', function (e) {
            if (ptrs[e.pointerId]) ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
            if (pinch && count() >= 2) {
                var ids = Object.keys(ptrs), a = ptrs[ids[0]], b2 = ptrs[ids[1]];
                var d = Math.hypot(a.x - b2.x, a.y - b2.y);
                var r = wrap.getBoundingClientRect();
                var mx = (a.x + b2.x) / 2 - r.left, my = (a.y + b2.y) / 2 - r.top;
                v.s = Math.max(minS(), Math.min(MAXS, pinch.s * d / (pinch.d || 1)));
                v.x = mx - pinch.ax * v.s; v.y = my - pinch.ay * v.s;
                fitMode = false; redraw();
                return;
            }
            if (!drag || e.pointerId !== drag.id) {
                if (!drag && o.hover && o.size()) o.hover(api.toArt(e.clientX, e.clientY), e);
                return;
            }
            if (drag.handler) { drag.handler.move(api.toArt(e.clientX, e.clientY), e); return; }
            v.x += e.clientX - drag.x; v.y += e.clientY - drag.y;
            drag.x = e.clientX; drag.y = e.clientY;
            fitMode = false; redraw();
        });
        function up(e) {
            delete ptrs[e.pointerId];
            try { wrap.releasePointerCapture(e.pointerId); } catch (err) {}
            if (pinch && count() < 2) { pinch = null; drag = null; return; }
            if (!drag || e.pointerId !== drag.id) return;
            if (drag.handler && drag.handler.up) drag.handler.up(api.toArt(e.clientX, e.clientY), e);
            drag = null;
            wrap.classList.remove('grabbing');
        }
        wrap.addEventListener('pointerup', up);
        wrap.addEventListener('pointercancel', up);
        wrap.addEventListener('dblclick', function (e) { if (o.size() && !(o.dblclick && o.dblclick(api.toArt(e.clientX, e.clientY), e))) api.fit(); });

        wrap.tabIndex = 0;
        wrap.addEventListener('keydown', function (e) {
            if (!o.size()) return;
            if (e.key === '+' || e.key === '=') { api.zoomBy(1.4); e.preventDefault(); }
            else if (e.key === '-' || e.key === '_') { api.zoomBy(1 / 1.4); e.preventDefault(); }
            else if (e.key === '0' || e.key === 'f') { api.fit(); e.preventDefault(); }
        });

        if (window.ResizeObserver) new ResizeObserver(function () { redraw(); }).observe(wrap);
        else window.addEventListener('resize', redraw);
        document.addEventListener('studio:theme', redraw);
        return api;
    };

    var inited = false;
    function boot() { if (inited) return; inited = true; S.init(); }
    if (document.readyState !== 'loading') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
