/* ============================================================================
   SCREENTONE — halftone screening, built the way a RIP builds it
   ---------------------------------------------------------------------------
   Most "halftone filters" tile a picture of some dots over the image and
   threshold it. That gets the LOOK approximately and the PHYSICS wrong: the
   dots land on a square grid instead of a rotated one, their area is driven by
   a radius rather than by tone, and the result is measurably darker or lighter
   than what went in. Four ideas here fix that, and they are the whole file.

   1. A SCREEN IS A THRESHOLD FIELD, NOT A PICTURE.
      Every shape below is written as one scalar function f(u,v) over the unit
      cell — the "spot function", exactly as PostScript defines it. Low values
      ink first. Nothing draws a circle; a circle is what you get when you
      threshold u²+v².

   2. THE FIELD IS EQUALISED, SO DOT AREA IS EXACT.
      f is sampled on a 256×256 grid, the samples are sorted, and each sample
      is replaced by its position in that order. The result R(u,v) has the
      property that the fraction of the cell with R < a is exactly a, for any
      a. So "ink where R < coverage" lays down precisely the coverage asked
      for — for EVERY shape, including lines and cross-hatch, with no per-shape
      calibration and no radius formula to get wrong.

   3. TONE IS MEASURED IN LINEAR LIGHT.
      A 50% screen viewed from far enough away that the dots fuse reads as the
      average of half black and half white — which is linear 0.5, i.e. sRGB
      188, not sRGB 128. Coverage is therefore 1 − Y where Y is LINEAR
      luminance. Deriving it from the sRGB byte instead (what most filters do)
      lightens the whole midtone by roughly a third of a stop.

   4. THE CELL IS AREA-INTEGRATED, NOT POINT-SAMPLED.
      In AREA mode every source pixel is rotated into screen space and added to
      the cell it falls in, so a dot's size comes from the mean of everything
      under it. That is what a process camera did, and it is why the result
      still reads correctly when the dots are coarser than the detail.

   No dependencies. Exposes window.SCREENTONE.
   ========================================================================= */
(function () {
    'use strict';

    /* ── 1. COLOUR ───────────────────────────────────────────────────────── */

    /* sRGB byte → linear. */
    var S2L = new Float32Array(256);
    (function () {
        for (var i = 0; i < 256; i++) {
            var c = i / 255;
            S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        }
    })();

    /* Linear → sRGB byte, as a table. The encode is a pow() and it would
       otherwise run three times per output pixel. */
    var L2S = new Uint8Array(4098);
    (function () {
        for (var i = 0; i <= 4097; i++) {
            var l = i / 4096; if (l > 1) l = 1;
            var s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
            L2S[i] = Math.round(s * 255);
        }
    })();

    function enc(l) {
        return l <= 0 ? 0 : (l >= 1 ? 255 : L2S[(l * 4096) | 0]);
    }

    function hexLin(hex) {
        var m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
        var n = m ? parseInt(m[1], 16) : 0xffffff;
        return [S2L[(n >> 16) & 255], S2L[(n >> 8) & 255], S2L[n & 255]];
    }

    /* ── 2. SPOT FUNCTIONS ───────────────────────────────────────────────────
       u and v run over [-0.5, 0.5) — one cell, centred on the dot. Return low
       where ink should land first. Absolute scale is irrelevant: equalisation
       only reads the ORDER, which is why none of these needs a constant.

       Every one is symmetric about both axes, so f is continuous across the
       cell boundary and dots meet their neighbours cleanly in the shadows. */

    var SHAPES = [
        { id: 'round',     name: 'ROUND' },
        { id: 'ellipse',   name: 'ELLIPTICAL' },
        { id: 'euclidean', name: 'EUCLIDEAN' },
        { id: 'square',    name: 'SQUARE' },
        { id: 'diamond',   name: 'DIAMOND' },
        { id: 'line',      name: 'LINE' },
        { id: 'cross',     name: 'CROSS-HATCH' }
    ];

    function spot(shape, u, v) {
        var x, y, au, av;
        switch (shape) {
            /* Wider than it is tall before rotation. Elliptical screens were
               the standard fix for the "tone jump" a round screen makes at 50%,
               where four dots touch at once and the midtone visibly steps. */
            case 'ellipse':
                x = u / 0.55; y = v / 0.40; return x * x + y * y;

            case 'square':  return Math.abs(u) > Math.abs(v) ? Math.abs(u) : Math.abs(v);
            case 'diamond': return Math.abs(u) + Math.abs(v);

            /* A stripe growing symmetrically out of the cell's midline. */
            case 'line':    return Math.abs(v);

            /* Two crossing bands — the engraver's answer to shading, and the
               one screen that still reads as a drawing rather than as print. */
            case 'cross':   return Math.abs(u) < Math.abs(v) ? Math.abs(u) : Math.abs(v);

            /* Round in the highlights, square at 50%, round-in-reverse in the
               shadows — the dot never has four neighbours touching at once, so
               the midtone steps nowhere. The classic PostScript spot, sign
               flipped because low inks first here. */
            case 'euclidean':
                x = 2 * u; y = 2 * v; au = x < 0 ? -x : x; av = y < 0 ? -y : y;
                return (au + av <= 1)
                    ? x * x + y * y - 1
                    : 1 - ((au - 1) * (au - 1) + (av - 1) * (av - 1));

            default:        return u * u + v * v;      /* round */
        }
    }

    /* ── 3. EQUALISATION ─────────────────────────────────────────────────────
       Turn a spot function into a rank field: R(u,v) = the fraction of the cell
       whose spot value is below this one. Thresholding R at a therefore covers
       exactly a of the cell, whatever the shape.

       R is a monotone function of f, and f is continuous, so R is continuous
       too — equal spot values get equal rank rather than being split by however
       the sort happened to break the tie. That matters: a tie-break artefact
       would show up as a one-sample ripple along every iso-contour. */

    function lowerBound(a, x) {
        var lo = 0, hi = a.length;
        while (lo < hi) { var m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
        return lo;
    }
    function upperBound(a, x) {
        var lo = 0, hi = a.length;
        while (lo < hi) { var m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; }
        return lo;
    }

    /* 256 rather than 128. The rank field can only express as many distinct
       coverages as the spot function has distinct level sets, and the blunt
       shapes have few: max(|u|,|v|) has exactly N/2 of them, so at N=128 a
       square dot could only land within 1.6% of the coverage asked for, and on
       a flat tone that error does not average out — every cell rounds the same
       way. Doubling N halves it, for 256KB and about 10ms, once per shape. */
    var SCREEN_N = 256, SCREEN_SHIFT = 8;
    var screenCache = {};

    function buildScreen(shape) {
        if (screenCache[shape]) return screenCache[shape];

        var N = SCREEN_N, M = N * N, f = new Float32Array(M), i, j;
        for (j = 0; j < N; j++) {
            var v = (j + 0.5) / N - 0.5;
            for (i = 0; i < N; i++) f[j * N + i] = spot(shape, (i + 0.5) / N - 0.5, v);
        }

        var sorted = Float32Array.from(f);
        sorted.sort();                          /* typed-array sort is numeric */

        var rank = new Float32Array(M), inv = 0.5 / M;
        for (i = 0; i < M; i++) {
            rank[i] = (lowerBound(sorted, f[i]) + upperBound(sorted, f[i])) * inv;
        }

        var s = { id: shape, N: N, shift: SCREEN_SHIFT, rank: rank };
        screenCache[shape] = s;
        return s;
    }

    /* ── 4. SOURCE ANALYSIS ──────────────────────────────────────────────────
       Done once per image, because none of it depends on a control. */

    function analyse(img) {
        var w = img.width, h = img.height, d = img.data, n = w * h;
        var lum = new Uint8Array(n);
        for (var i = 0, o = 0; i < n; i++, o += 4) {
            /* Rec.709 weights, applied in LINEAR light — the quantity the eye
               integrates once the dots are too small to resolve. Stored back
               through the sRGB curve so eight bits still holds the shadows. */
            var Y = 0.2126 * S2L[d[o]] + 0.7152 * S2L[d[o + 1]] + 0.0722 * S2L[d[o + 2]];
            lum[i] = L2S[(Y * 4096) | 0];
        }
        return { w: w, h: h, lum: lum, edge: sobel(lum, w, h) };
    }

    /* Edge magnitude, for the linework pass. Deliberately measured on the
       PERCEPTUAL luma rather than the linear one: an outline is a contrast
       feature, and contrast is what the transfer curve encodes. */
    function sobel(lum, w, h) {
        var out = new Uint8Array(w * h);
        if (w < 3 || h < 3) return out;
        for (var y = 1; y < h - 1; y++) {
            var r = y * w;
            for (var x = 1; x < w - 1; x++) {
                var i = r + x;
                var a = lum[i - w - 1], b = lum[i - w], c = lum[i - w + 1];
                var e = lum[i - 1],                     g = lum[i + 1];
                var p = lum[i + w - 1], q = lum[i + w], s = lum[i + w + 1];
                var gx = (c + 2 * g + s) - (a + 2 * e + p);
                var gy = (p + 2 * q + s) - (a + 2 * b + c);
                var m = Math.sqrt(gx * gx + gy * gy) * 0.25;
                out[i] = m > 255 ? 255 : m;
            }
        }
        return out;
    }

    /* ── 5. TONE ─────────────────────────────────────────────────────────────
       Linear tone (0 = black, 1 = paper) → ink coverage (0 = blank, 1 = solid).

       Order matters. The end points clip FIRST, so "everything under 12% is
       solid black" survives every later stage — that clip is how line art keeps
       its blacks instead of dissolving into 95% dots. Dot gain goes LAST and is
       midtone-only by construction, because a press spreads ink at the edge of
       a dot and a cell with no dot in it has no edge to spread. */

    function toS(y) { return y <= 0.0031308 ? y * 12.92 : 1.055 * Math.pow(y, 1 / 2.4) - 0.055; }
    function toL(s) { return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }

    function makeCurve(o) {
        var blk = o.black, wht = o.white;
        var gam = o.gamma, gain = o.gain, steps = o.steps | 0, inv = !!o.invert;
        var span = wht - blk; if (span < 1e-4) span = 1e-4;
        var q = steps > 1 ? steps - 1 : 0;

        return function (Y) {
            /* The end points and the midtone bend are read and set the way a
               levels dialog is: against the tone AS SEEN. Applying them to
               linear light instead would put a white point of 84% at 67% of
               the range and crush every midtone along with it. Coverage still
               comes off the linear value at the end, because that is the part
               physics has an opinion about. */
            var t = (toS(Y) - blk) / span;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            if (gam !== 1) t = Math.pow(t, gam);
            var a = 1 - toL(t);
            if (gain) a += gain * a * (1 - a) * 2;
            if (inv) a = 1 - a;
            if (a < 0) a = 0; else if (a > 1) a = 1;
            /* Screentone came on sheets, and a sheet has one density. Snapping
               coverage to a ladder is what turns a photograph into something
               that could have been laid down by hand. */
            if (q) a = Math.round(a * q) / q;
            return a;
        };
    }

    /* The same curve as a table over sRGB-encoded bytes, for the per-pixel path
       where it would otherwise run a pow() a few million times. */
    function curveTable(fn) {
        var t = new Float32Array(256);
        for (var i = 0; i < 256; i++) t[i] = fn(S2L[i]);
        return t;
    }

    /* ── 6. SCREEN GEOMETRY ──────────────────────────────────────────────────
       One lattice per ink. The origin is pushed two cells outside the image so
       every coordinate the renderer computes is positive — which lets the hot
       loop truncate with |0 instead of calling Math.floor. */

    function grid(w, h, cellSrc, angle) {
        var co = Math.cos(angle), si = Math.sin(angle);
        var us = [], vs = [], pts = [[0, 0], [w, 0], [0, h], [w, h]];
        for (var i = 0; i < 4; i++) {
            us.push((pts[i][0] * co + pts[i][1] * si) / cellSrc);
            vs.push((-pts[i][0] * si + pts[i][1] * co) / cellSrc);
        }
        var u0 = Math.floor(Math.min.apply(null, us)) - 2;
        var v0 = Math.floor(Math.min.apply(null, vs)) - 2;
        return {
            co: co, si: si, u0: u0, v0: v0,
            cw: Math.ceil(Math.max.apply(null, us)) + 4 - u0,
            ch: Math.ceil(Math.max.apply(null, vs)) + 4 - v0
        };
    }

    /* Every source pixel, rotated into screen space and added to its cell.
       O(n) and exact: this is area integration, not a resample. */

    function accumLum(lum, w, h, g, cellSrc) {
        var n = g.cw * g.ch;
        var sum = new Float32Array(n), cnt = new Uint32Array(n);
        var co = g.co / cellSrc, si = g.si / cellSrc, cw = g.cw;
        for (var y = 0; y < h; y++) {
            var yy = y + 0.5, row = y * w;
            var u = 0.5 * co + yy * si - g.u0;
            var v = -0.5 * si + yy * co - g.v0;
            for (var x = 0; x < w; x++) {
                var ci = ((v | 0) * cw) + (u | 0);
                sum[ci] += S2L[lum[row + x]];
                cnt[ci]++;
                u += co; v -= si;
            }
        }
        return { sum: sum, cnt: cnt, n: n, stride: 1 };
    }

    function accumRGB(img, g, cellSrc) {
        var w = img.width, h = img.height, d = img.data;
        var n = g.cw * g.ch;
        var sum = new Float32Array(n * 3), cnt = new Uint32Array(n);
        var co = g.co / cellSrc, si = g.si / cellSrc, cw = g.cw;
        for (var y = 0; y < h; y++) {
            var yy = y + 0.5, row = y * w * 4;
            var u = 0.5 * co + yy * si - g.u0;
            var v = -0.5 * si + yy * co - g.v0;
            for (var x = 0, o = row; x < w; x++, o += 4) {
                var ci = ((v | 0) * cw) + (u | 0), c3 = ci * 3;
                sum[c3]     += S2L[d[o]];
                sum[c3 + 1] += S2L[d[o + 1]];
                sum[c3 + 2] += S2L[d[o + 2]];
                cnt[ci]++;
                u += co; v -= si;
            }
        }
        return { sum: sum, cnt: cnt, n: n, stride: 3 };
    }

    /* Cell sums → per-cell coverage. Cheap, and it is the only thing that has
       to re-run when a tone slider moves: the accumulation above depends on
       pitch and angle alone. */

    function cellCoverage(acc, curve) {
        var n = acc.n, out = new Float32Array(n), sum = acc.sum, cnt = acc.cnt;
        for (var i = 0; i < n; i++) {
            out[i] = cnt[i] ? curve(sum[i] / cnt[i]) : curve(1);
        }
        return out;
    }

    /* ── 6b. SEPARATION ──────────────────────────────────────────────────────
       How much of each ink reproduces a given colour.

       The obvious answer — cyan = 1 − red, and so on — assumes each ink is a
       perfect block filter for one channel. Real process inks are nothing of
       the sort: process cyan passes a third of the green and three quarters of
       the blue, and yellow is barely an absorber at all outside the blue. Print
       a mid grey by that rule and it comes back a third too light and warm.

       Worse, grey component replacement makes it much worse rather than
       better. Pulling min(c,m,y) out and handing it to the black plate is only
       colour-preserving if the three inks it came from really did combine into
       exactly that black. They do not, so at 80% replacement the naive rule
       lightens a midtone from 0.22 to 0.31 and swings it warm.

       So solve it instead. Under a halftone the ink at any point is either
       there or it is not, so a plate at coverage a transmits (1 − a(1 − I)) on
       average, and independent plates multiply. That gives three equations —
       one per channel — in three unknowns, once black is fixed. Each ink
       dominates its own channel, so Gauss-Seidel converges in three sweeps:
       hold two inks, divide them out, read the third straight off. Black is
       chosen first from the naive guess and then held, which turns grey
       component replacement into what it is supposed to be — the other three
       inks are re-solved AROUND the black, so the colour does not move.

       Measured on a neutral 0.216 midtone at 80% replacement: c 0.40, m 0.19,
       y 0.25, k 0.63, reproducing 0.2156 / 0.2169 / 0.2160. Neutral, and the
       right lightness. */

    function makeSeparator(inks, paper, gcr) {
        var t = [], i;
        for (i = 0; i < 4; i++) {
            t.push([1 - inks[i][0], 1 - inks[i][1], 1 - inks[i][2]]);
        }
        var ipr = 1 / Math.max(0.004, paper[0]);
        var ipg = 1 / Math.max(0.004, paper[1]);
        var ipb = 1 / Math.max(0.004, paper[2]);
        var tC = t[0], tM = t[1], tY = t[2], tK = t[3];

        /* 1 − a·t = rhs, solved for a and clamped to something printable. */
        function amount(rhs, tt) {
            if (tt < 0.02) return 0;
            var a = (1 - rhs) / tt;
            return a < 0 ? 0 : (a > 1 ? 1 : a);
        }
        function den(x) { return x < 1e-4 ? 1e-4 : x; }

        return function (r, g, b, out) {
            var Tr = r * ipr, Tg = g * ipg, Tb = b * ipb;
            if (Tr > 1) Tr = 1; if (Tg > 1) Tg = 1; if (Tb > 1) Tb = 1;

            var c = 1 - Tr, m = 1 - Tg, y = 1 - Tb;
            if (c < 0) c = 0; if (m < 0) m = 0; if (y < 0) y = 0;
            var k = (c < m ? (c < y ? c : y) : (m < y ? m : y)) * gcr;

            var kR = den(1 - k * tK[0]), kG = den(1 - k * tK[1]), kB = den(1 - k * tK[2]);

            for (var it = 0; it < 3; it++) {
                c = amount(Tr / den(kR * (1 - m * tM[0]) * (1 - y * tY[0])), tC[0]);
                m = amount(Tg / den(kG * (1 - c * tC[1]) * (1 - y * tY[1])), tM[1]);
                y = amount(Tb / den(kB * (1 - c * tC[2]) * (1 - m * tM[2])), tY[2]);
            }
            out[0] = c; out[1] = m; out[2] = y; out[3] = k;
        };
    }

    /* Four-ink separation from per-cell mean RGB. The tone curve runs first,
       per channel, and its result is read back as a colour for the separator to
       aim at — so black point, midtones and dot gain stay meaningful without
       any of them having to know what an ink is. */
    function cellCoverageCMYK(acc, curve, sep) {
        var n = acc.n, sum = acc.sum, cnt = acc.cnt;
        var C = new Float32Array(n), M = new Float32Array(n),
            Y = new Float32Array(n), K = new Float32Array(n);
        var o = [0, 0, 0, 0];
        for (var i = 0; i < n; i++) {
            var w = cnt[i] ? 1 / cnt[i] : 0, i3 = i * 3;
            sep(1 - curve(cnt[i] ? sum[i3]     * w : 1),
                1 - curve(cnt[i] ? sum[i3 + 1] * w : 1),
                1 - curve(cnt[i] ? sum[i3 + 2] * w : 1), o);
            C[i] = o[0]; M[i] = o[1]; Y[i] = o[2]; K[i] = o[3];
        }
        return [C, M, Y, K];
    }

    /* ── 7. PER-PIXEL COVERAGE (DETAIL mode) ─────────────────────────────────
       No cell averaging: the screen is compared against the picture where it
       stands, so a dot deforms around whatever detail runs under it. Finer,
       but the tone is only right where the detail is smooth. */

    function pixelPlane(lum, table) {
        var n = lum.length, out = new Uint8Array(n);
        for (var i = 0; i < n; i++) out[i] = (table[lum[i]] * 255 + 0.5) | 0;
        return out;
    }

    function pixelPlanesCMYK(img, table, sep) {
        var n = img.width * img.height, d = img.data;
        var C = new Uint8Array(n), M = new Uint8Array(n),
            Y = new Uint8Array(n), K = new Uint8Array(n);
        var v = [0, 0, 0, 0];
        for (var i = 0, o = 0; i < n; i++, o += 4) {
            sep(1 - table[d[o]], 1 - table[d[o + 1]], 1 - table[d[o + 2]], v);
            C[i] = (v[0] * 255 + 0.5) | 0;
            M[i] = (v[1] * 255 + 0.5) | 0;
            Y[i] = (v[2] * 255 + 0.5) | 0;
            K[i] = (v[3] * 255 + 0.5) | 0;
        }
        return [C, M, Y, K];
    }

    /* ── 8. RENDER ───────────────────────────────────────────────────────────
       Rows [y0, y1) of the output, so the page can slice a long render into
       bands and keep the tab alive.

       Anti-aliasing is K×K supersampling of the hard threshold, not a softened
       edge. That is deliberate. The analytic shortcut — comparing coverage
       against the rank and dividing by the local gradient — is exact where a
       dot edge crosses a pixel and badly wrong where a dot is SMALLER than one,
       because the rank field has an extremum there and the linear model of it
       does not: on genuinely blank paper it returns a 25% grey dot centre.
       Supersampling has no such blind spot, and at K=1 it is the honest 1-bit
       output that a screen actually is. */

    /* Bilinear of four bytes, rounded back to a byte so the sRGB table can be
       used on the result. Interpolating the encoded value rather than the
       linear one is what an image editor does and the difference is well under
       a code point on anything but a hard edge. */
    function bilerp(a, b, c, d, fx, fy) {
        var t = a + (b - a) * fx;
        return (t + ((c + (d - c) * fx) - t) * fy + 0.5) | 0;
    }

    function render(cfg) {
        var W = cfg.outW, H = cfg.outH, buf = cfg.buf;
        var y0 = cfg.y0 | 0, y1 = (cfg.y1 === undefined ? H : cfg.y1 | 0);
        var s = cfg.scale, invS = 1 / s, cell = cfg.cellSrc;
        var sc = cfg.screen, N = sc.N, SH = sc.shift, mask = N - 1, rank = sc.rank;
        var invN = 1 / N;
        var K = cfg.samples || 1, KK = K * K, invKK = 1 / KK;
        var pls = cfg.planes, np = pls.length;
        var pr = cfg.paper[0], pg = cfg.paper[1], pb = cfg.paper[2];
        var alpha = !!cfg.alpha;
        var sw = cfg.w, sh = cfg.h;
        /* OVERLAY: the picture itself becomes the stock the screen prints on,
           instead of a flat sheet. Everything downstream is unchanged — the
           ink still lands where the coverage says — so what you get is the
           original with a screen laid over it rather than a screen made out
           of it. Strength is the ink's opacity, which is a different thing
           from its coverage: coverage decides how much of the paper a dot
           covers, strength decides how much of the paper it hides. */
        var base = cfg.base || null;
        var strength = cfg.strength === undefined ? 1 : cfg.strength;
        var swm = sw - 1.002, shm = sh - 1.002;
        if (swm < 0) swm = 0;
        if (shm < 0) shm = 0;

        /* Hoist everything the inner loop touches out of the plane objects. */
        var uN = [], vN = [], duN = [], dvN = [], subU = [], subV = [],
            cells = [], cellW = [], cellN = [], pdat = [], irk = [], igk = [],
            ibk = [], mulk = [], edat = [], elut = [], anyPixel = false;

        var p, i, j, k;
        for (p = 0; p < np; p++) {
            var P = pls[p];
            /* Rates of change of the screen coordinates, in cell units × N so
               the sub-cell index is one truncation and one mask away. */
            var ax = invS * P.co / cell * N, ay = invS * P.si / cell * N;
            var bx = -invS * P.si / cell * N, by = invS * P.co / cell * N;
            duN[p] = ax; dvN[p] = bx;

            var sU = new Float64Array(KK), sV = new Float64Array(KK);
            k = 0;
            for (j = 0; j < K; j++) {
                var oy = (j + 0.5) / K - 0.5;
                for (i = 0; i < K; i++) {
                    var ox = (i + 0.5) / K - 0.5;
                    sU[k] = ox * ax + oy * ay;
                    sV[k] = ox * bx + oy * by;
                    k++;
                }
            }
            subU[p] = sU; subV[p] = sV;

            cells[p] = P.cells || null;
            cellW[p] = P.cw || 0;
            cellN[p] = P.cells ? P.cells.length : 0;
            pdat[p]  = P.plane || null;
            if (P.plane) anyPixel = true;
            irk[p] = P.ink[0]; igk[p] = P.ink[1]; ibk[p] = P.ink[2];
            mulk[p] = !!P.multiply;
            edat[p] = P.edge || null;
            elut[p] = P.edgeLut || null;
        }

        for (var Y = y0; Y < y1; Y++) {
            var sy = (Y + 0.5) * invS;

            for (p = 0; p < np; p++) {
                var Q = pls[p];
                uN[p] = (( 0.5 * invS * Q.co + sy * Q.si) / cell - Q.u0) * N;
                vN[p] = ((-0.5 * invS * Q.si + sy * Q.co) / cell - Q.v0) * N;
            }

            /* Source row for the per-pixel and edge lookups — constant across
               the row, so the vertical half of every bilinear is done once. */
            var py = sy - 0.5; if (py < 0) py = 0; else if (py > shm) py = shm;
            var yi = py | 0, fy = py - yi;
            var rowA = yi * sw, rowB = rowA + sw;
            var eRow = (sy < sh ? (sy | 0) : sh - 1) * sw;

            var sx = 0.5 * invS;
            var o = Y * W * 4;

            for (var X = 0; X < W; X++, o += 4) {
                var xi = 0, fx = 0, exi = 0;
                if (anyPixel || base) {
                    var px = sx - 0.5; if (px < 0) px = 0; else if (px > swm) px = swm;
                    xi = px | 0; fx = px - xi;
                }
                exi = sx < sw ? (sx | 0) : sw - 1;

                var rr = pr, gg = pg, bb = pb, open = 1;

                if (base) {
                    var ba = (rowA + xi) * 4, bb2 = (rowB + xi) * 4;
                    rr = S2L[bilerp(base[ba],     base[ba + 4],
                                    base[bb2],    base[bb2 + 4], fx, fy)];
                    gg = S2L[bilerp(base[ba + 1], base[ba + 5],
                                    base[bb2 + 1], base[bb2 + 5], fx, fy)];
                    bb = S2L[bilerp(base[ba + 2], base[ba + 6],
                                    base[bb2 + 2], base[bb2 + 6], fx, fy)];
                }

                for (p = 0; p < np; p++) {
                    var un = uN[p], vn = vN[p];
                    uN[p] = un + duN[p]; vN[p] = vn + dvN[p];

                    /* ── coverage under this pixel ── */
                    var a;
                    var cd = cells[p];
                    if (cd) {
                        var ci = ((vn * invN) | 0) * cellW[p] + ((un * invN) | 0);
                        a = (ci >= 0 && ci < cellN[p]) ? cd[ci] : 0;
                    } else {
                        var d = pdat[p];
                        var t0 = d[rowA + xi], t1 = d[rowA + xi + 1];
                        var b0 = d[rowB + xi], b1 = d[rowB + xi + 1];
                        var top = t0 + (t1 - t0) * fx;
                        a = (top + ((b0 + (b1 - b0) * fx) - top) * fy) * (1 / 255);
                    }

                    /* ── the screen ── */
                    var ink;
                    if (a <= 0) {
                        ink = 0;
                    } else if (a >= 1) {
                        ink = 1;
                    } else {
                        var sU2 = subU[p], sV2 = subV[p], hit = 0;
                        for (k = 0; k < KK; k++) {
                            if (a > rank[((((vn + sV2[k]) | 0) & mask) << SH) |
                                         (((un + sU2[k]) | 0) & mask)]) hit++;
                        }
                        ink = hit * invKK;
                    }

                    /* Linework is drawn at full resolution, over the screen —
                       an outline that has been broken into dots is no longer an
                       outline. */
                    var ed = edat[p];
                    if (ed) {
                        var e = elut[p][ed[eRow + exi]];
                        if (e > 0) ink += e * (1 - ink);
                    }

                    if (strength !== 1) ink *= strength;

                    if (ink > 0) {
                        if (mulk[p]) {
                            /* Process inks are transparent: each one filters
                               what the ones under it left. */
                            rr *= 1 - ink * (1 - irk[p]);
                            gg *= 1 - ink * (1 - igk[p]);
                            bb *= 1 - ink * (1 - ibk[p]);
                        } else {
                            /* A spot ink laid on thick is not. */
                            rr += (irk[p] - rr) * ink;
                            gg += (igk[p] - gg) * ink;
                            bb += (ibk[p] - bb) * ink;
                        }
                        open *= 1 - ink;
                    }
                }

                if (alpha) {
                    var A = 1 - open;
                    if (A > 0.0008) {
                        var ia = 1 / A;
                        buf[o]     = enc((rr - pr * open) * ia);
                        buf[o + 1] = enc((gg - pg * open) * ia);
                        buf[o + 2] = enc((bb - pb * open) * ia);
                        buf[o + 3] = (A * 255 + 0.5) | 0;
                    } else {
                        buf[o] = buf[o + 1] = buf[o + 2] = buf[o + 3] = 0;
                    }
                } else {
                    buf[o]     = enc(rr);
                    buf[o + 1] = enc(gg);
                    buf[o + 2] = enc(bb);
                    buf[o + 3] = 255;
                }

                sx += invS;
            }
        }
    }

    /* ── 9. PROCESS INKS ─────────────────────────────────────────────────────
       Measured off a SWOP-ish solid rather than the RGB primaries — process
       cyan is not #00FFFF and printing it as if it were is why naive CMYK
       conversions come out looking like a television. */

    var PROCESS = {
        c: '#00A9E0',
        m: '#E5007E',
        y: '#FFE800',
        k: '#1A1A1A'
    };

    window.SCREENTONE = {
        SHAPES: SHAPES,
        PROCESS: PROCESS,
        srgbToLinear: function (b) { return S2L[b & 255]; },
        linearToSrgb: enc,
        hexLin: hexLin,
        buildScreen: buildScreen,
        analyse: analyse,
        makeCurve: makeCurve,
        curveTable: curveTable,
        makeSeparator: makeSeparator,
        grid: grid,
        accumLum: accumLum,
        accumRGB: accumRGB,
        cellCoverage: cellCoverage,
        cellCoverageCMYK: cellCoverageCMYK,
        pixelPlane: pixelPlane,
        pixelPlanesCMYK: pixelPlanesCMYK,
        render: render
    };
})();
