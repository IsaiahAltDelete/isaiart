/* ============================================================================
   QUIET SKY — a slight space backdrop for the small tools
   ---------------------------------------------------------------------------
   The homepage and the 404 carry the full sky with its lens. The tools only
   want the weather of it: a sparse star chart drifting by depth, two faint
   nebula washes in the iridescent band, and now and then a meteor. Nothing
   here competes with the work on the page — every value is kept low enough
   that it reads as texture, not as a picture.

   Usage: <quiet-sky></quiet-sky> as the first child of <body>. It sits fixed
   behind everything (z-index 0); content above it needs position + z-index.
   It follows data-theme on <html>, pauses when the tab is hidden, and draws
   one still frame under prefers-reduced-motion.
   ========================================================================= */
(function () {
    'use strict';
    if (!window.customElements || customElements.get('quiet-sky')) return;

    function mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    var TAU = Math.PI * 2;
    // the same muted band the homepage uses for its iridescent touches
    var IRIS = [[157, 184, 232], [191, 174, 227], [214, 169, 196], [220, 203, 158], [163, 211, 197]];

    class QuietSky extends HTMLElement {
        connectedCallback() {
            if (this._cv) return;
            var cv = this._cv = document.createElement('canvas');
            cv.setAttribute('aria-hidden', 'true');
            this.appendChild(cv);
            var ctx = cv.getContext && cv.getContext('2d');
            if (!ctx) return;

            var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
            var r = mulberry32(0x5A1E57);
            var N = 700, sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N),
                sa = new Float32Array(N), sd = new Float32Array(N), sp = new Float32Array(N), st = new Uint8Array(N);
            for (var i = 0; i < N; i++) {
                sx[i] = r(); sy[i] = r();
                sz[i] = r() < 0.12 ? 1.7 : r() < 0.55 ? 1.2 : 0.9;
                sa[i] = 0.2 + r() * 0.55;
                sd[i] = 0.2 + r() * 0.8;            // depth: nearer stars drift and lean further
                sp[i] = r() * TAU;                  // twinkle phase
                var t = r();
                st[i] = t < 0.08 ? 1 : t < 0.13 ? 2 : t < 0.17 ? 3 : 0;   // a few carry a real star's tint
            }
            // two slow washes, one cool and one warm-rose, wandering on long orbits
            var clouds = [
                { x: 0.18, y: 0.24, rad: 0.46, c: IRIS[0], ph: r() * TAU, sp: 0.000021 },
                { x: 0.84, y: 0.78, rad: 0.42, c: IRIS[2], ph: r() * TAU, sp: 0.000017 },
                { x: 0.62, y: 0.12, rad: 0.3,  c: IRIS[1], ph: r() * TAU, sp: 0.000025 }
            ];

            var W = 0, H = 0, dpr = 1, light = false, raf = 0, last = 0, drift = 0;
            var lx = 0, ly = 0, tx = 0, ty = 0;     // pointer lean, eased
            var meteor = null, nextMeteor = performance.now() + 9000 + r() * 12000;
            var self = this;

            // an explicit data-theme wins; without one, follow the system like the page's CSS does
            var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
            function theme() {
                var set = document.documentElement.getAttribute('data-theme');
                light = set ? set === 'light' : !!(mq && mq.matches);
            }
            if (mq && mq.addEventListener) mq.addEventListener('change', function () { theme(); paint(performance.now()); });
            function size() {
                W = innerWidth; H = innerHeight;
                dpr = Math.min(devicePixelRatio || 1, W < 700 ? 1.5 : 2);
                cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
            function count() { return Math.max(160, Math.min(N, Math.round(W * H / 2400))); }

            function paint(now) {
                ctx.clearRect(0, 0, W, H);
                lx += (tx - lx) * 0.04; ly += (ty - ly) * 0.04;

                // nebula washes: very low alpha, additive in dark, plain in light
                ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
                for (var c = 0; c < clouds.length; c++) {
                    var k = clouds[c], a = now * k.sp + k.ph;
                    var cx = (k.x + Math.cos(a) * 0.05) * W - lx * 18, cy = (k.y + Math.sin(a * 1.3) * 0.05) * H - ly * 18;
                    var rad = k.rad * Math.max(W, H);
                    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
                    var al = light ? 0.14 : 0.075;
                    g.addColorStop(0, 'rgba(' + k.c[0] + ',' + k.c[1] + ',' + k.c[2] + ',' + al + ')');
                    g.addColorStop(0.55, 'rgba(' + k.c[0] + ',' + k.c[1] + ',' + k.c[2] + ',' + (al * 0.35) + ')');
                    g.addColorStop(1, 'rgba(' + k.c[0] + ',' + k.c[1] + ',' + k.c[2] + ',0)');
                    ctx.fillStyle = g;
                    ctx.fillRect(0, 0, W, H);
                }
                ctx.globalCompositeOperation = 'source-over';

                // stars
                var n = count();
                for (var j = 0; j < n; j++) {
                    var x = ((sx[j] + drift * sd[j]) % 1) * W - lx * 14 * sd[j];
                    var y = sy[j] * H - ly * 10 * sd[j];
                    if (x < -4) x += W + 8;
                    var tw = 0.72 + 0.28 * Math.sin(now * 0.0011 * (0.6 + sd[j]) + sp[j]);
                    var al2 = sa[j] * tw * (light ? 0.55 : 1);
                    if (light) ctx.fillStyle = 'rgba(40,42,56,' + al2.toFixed(3) + ')';
                    else ctx.fillStyle = st[j] === 1 ? 'rgba(206,220,255,' + al2.toFixed(3) + ')'
                                     : st[j] === 2 ? 'rgba(255,226,200,' + al2.toFixed(3) + ')'
                                     : st[j] === 3 ? 'rgba(228,210,255,' + al2.toFixed(3) + ')'
                                     : 'rgba(244,244,242,' + al2.toFixed(3) + ')';
                    var s = sz[j];
                    if (s > 1.4) { ctx.beginPath(); ctx.arc(x, y, s * 0.62, 0, TAU); ctx.fill(); }
                    else ctx.fillRect(x, y, s, s);
                }

                // a meteor now and then: a short iridescent streak that fades as it goes
                if (!reduce && !light) {
                    if (!meteor && now > nextMeteor) {
                        var ang = 0.35 + r() * 0.35;
                        meteor = { x: W * (0.15 + r() * 0.7), y: H * (0.05 + r() * 0.35), a: ang, t0: now, len: 90 + r() * 90, c: IRIS[(r() * IRIS.length) | 0] };
                    }
                    if (meteor) {
                        var p = (now - meteor.t0) / 900;
                        if (p >= 1) { meteor = null; nextMeteor = now + 14000 + r() * 22000; }
                        else {
                            var d = p * 260, hx = meteor.x + Math.cos(meteor.a) * d, hy = meteor.y + Math.sin(meteor.a) * d;
                            var bx = hx - Math.cos(meteor.a) * meteor.len * (0.4 + p), by = hy - Math.sin(meteor.a) * meteor.len * (0.4 + p);
                            var fade = Math.sin(p * Math.PI) * 0.5, mc = meteor.c;
                            var lg = ctx.createLinearGradient(bx, by, hx, hy);
                            lg.addColorStop(0, 'rgba(' + mc[0] + ',' + mc[1] + ',' + mc[2] + ',0)');
                            lg.addColorStop(1, 'rgba(244,244,242,' + fade.toFixed(3) + ')');
                            ctx.strokeStyle = lg; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
                            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
                        }
                    }
                }
            }

            function frame(now) {
                raf = 0;
                if (document.hidden) return;
                // ~30fps is plenty for something this slow, and halves the cost
                if (now - last >= 32) {
                    var dt = Math.min(64, now - (last || now));
                    drift += dt * 0.0000016;
                    last = now;
                    paint(now);
                }
                raf = requestAnimationFrame(frame);
            }
            function start() { if (!raf && !reduce) raf = requestAnimationFrame(frame); }

            theme(); size();
            paint(performance.now());
            // a timer, not a frame: a background tab or a headless capture may not paint frames yet
            setTimeout(function () { self.classList.add('live'); }, 60);

            new MutationObserver(function () { theme(); if (reduce) paint(performance.now()); })
                .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
            addEventListener('resize', function () { size(); paint(performance.now()); });
            addEventListener('pointermove', function (e) {
                tx = (e.clientX / W - 0.5) * 2; ty = (e.clientY / H - 0.5) * 2;
            }, { passive: true });
            document.addEventListener('visibilitychange', function () { if (!document.hidden) { last = 0; start(); } });
            start();
        }
    }
    customElements.define('quiet-sky', QuietSky);
})();
