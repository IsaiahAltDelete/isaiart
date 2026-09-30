/* ============================================================================
   LINEART — coloring-page cleanup and print upscaling
   ---------------------------------------------------------------------------
   AI line art comes out almost right: black outlines, but sitting on paper
   that is not quite white, with soft grey shading the model added because it
   thinks drawings have shadows, and at a resolution that prints soft. A
   coloring page needs the opposite of all three — pure white where a crayon
   goes, pure black where it stops, and enough pixels that the line edge is
   smooth at 300 DPI.

        rgba ──▶ luma ──▶ flatten paper ──▶ levels ──▶ ink mask ──▶ field
                                                          │
                                   page ◀── threshold ◀── resample (smooth)

   The step that matters is the ink mask, because "remove the greys" is not a
   threshold. A plain threshold at mid-grey has to pick a side: set it low and
   the anti-aliased edges of every line go, thinning them to stairs; set it
   high and the shading comes along as solid black blobs. What separates the
   two is not how grey a pixel is but WHERE it is: an edge grey sits next to a
   dark core, a shading grey does not. So ink is grown from seeds —

        seed   = clearly dark (under CUT)
        fringe = lighter, but within 2px of a seed
        ink    = seed ∪ fringe, minus connected pieces smaller than SPECK

   and everything else goes to white, however dark a grey it was.

   Upscaling is then done on a continuous field, never on the black-and-white
   result. Resampling a thresholded image enlarges its staircase; resampling
   the grey field with a smooth kernel and thresholding AFTER puts the edge at
   sub-pixel precision in the new grid, which is what makes a curve come out
   as a curve. It is the same trick fonts use.

   Shared between the page and worker.js, so no DOM in here.
   ========================================================================= */
(function (root) {
    'use strict';

    /* ── Page geometry ──────────────────────────────────────────────────── */

    /* Trim sizes in inches, portrait. Orientation follows the art, so a
       landscape drawing gets a landscape page rather than a postage stamp in
       the middle of a portrait one. */
    var PAGES = {
        letter: { w: 8.5,  h: 11,    name: 'US LETTER' },
        a4:     { w: 8.27, h: 11.69, name: 'A4' },
        '8x10': { w: 8,    h: 10,    name: '8 × 10' },
        square: { w: 8.5,  h: 8.5,   name: '8.5 SQUARE' },
        '6x9':  { w: 6,    h: 9,     name: '6 × 9' }
    };

    /* Where the art lands. `o.page` is a PAGES key, or 'none' for a plain
       scale-up of the source by o.factor. Returns pixel sizes for the final
       canvas (pw × ph) and the art rectangle inside it. */
    function geometry(w, h, o) {
        var dpi = o.dpi || 300;
        if (!o.page || o.page === 'none' || !PAGES[o.page]) {
            var f = Math.max(1, o.factor || 2);
            var W = Math.round(w * f), H = Math.round(h * f);
            return { pw: W, ph: H, x: 0, y: 0, w: W, h: H, k: f, dpi: dpi,
                     inW: W / dpi, inH: H / dpi, pageName: null };
        }
        var p = PAGES[o.page];
        var pwIn = p.w, phIn = p.h;
        if ((w > h) !== (pwIn > phIn) && pwIn !== phIn) { var t = pwIn; pwIn = phIn; phIn = t; }
        var pw = Math.round(pwIn * dpi), ph = Math.round(phIn * dpi);
        var m = Math.max(0, o.margin || 0) * dpi;
        var bw = Math.max(16, pw - 2 * m), bh = Math.max(16, ph - 2 * m);
        var k = Math.min(bw / w, bh / h);
        var iw = Math.round(w * k), ih = Math.round(h * k);
        if (o.layout === 'fit') {
            return { pw: iw, ph: ih, x: 0, y: 0, w: iw, h: ih, k: k, dpi: dpi,
                     inW: iw / dpi, inH: ih / dpi, pageName: p.name,
                     sheetW: pwIn, sheetH: phIn };
        }
        return { pw: pw, ph: ph, x: Math.round((pw - iw) / 2), y: Math.round((ph - ih) / 2),
                 w: iw, h: ih, k: k, dpi: dpi, inW: pwIn, inH: phIn, pageName: p.name,
                 sheetW: pwIn, sheetH: phIn };
    }

    /* ── Stage 1: luma, paper, levels ───────────────────────────────────── */

    /* Transparent pixels are composited onto white — a PNG with a clear
       background is a drawing on nothing, and nothing is paper. */
    function luma(rgba, n) {
        var L = new Float32Array(n);
        for (var i = 0, j = 0; i < n; i++, j += 4) {
            var a = rgba[j + 3] / 255;
            var y = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
            L[i] = y * a + 255 * (1 - a);
        }
        return L;
    }

    function histogram(L, n) {
        var hst = new Uint32Array(256);
        for (var i = 0; i < n; i++) hst[L[i] < 0 ? 0 : (L[i] > 255 ? 255 : L[i] | 0)]++;
        return hst;
    }

    /* Value below which fraction q of the histogram's mass lies. */
    function pct(hst, total, q) {
        var goal = total * q, c = 0;
        for (var v = 0; v < 256; v++) { c += hst[v]; if (c >= goal) return v; }
        return 255;
    }

    /* Divide out the paper. Scans, phone photos and a surprising number of
       generations have a paper tone that drifts across the sheet — darker in
       one corner, warm in the middle. One global white point cannot fix that;
       a local one can.

       The paper level is measured per block as a high percentile (a block is
       mostly paper, and the percentile ignores the lines crossing it), then
       max-dilated so blocks sitting inside a solid black fill borrow their
       neighbours' paper instead of reporting black as the paper colour. Any
       block still far darker than the page's paper after that is inside a
       fill too large to see across, and takes the global value. */
    function flatten(L, w, h) {
        var n = w * h;
        var all = histogram(L, n);
        var P = Math.max(64, pct(all, n, 0.9));
        var b = Math.max(8, Math.round(Math.min(w, h) / 48));
        var gw = Math.ceil(w / b), gh = Math.ceil(h / b);
        var g = new Float32Array(gw * gh);
        var hst = new Uint32Array(256);
        var bx, by, x, y, i;

        for (by = 0; by < gh; by++) {
            for (bx = 0; bx < gw; bx++) {
                hst.fill(0);
                var x0 = bx * b, y0 = by * b;
                var x1 = Math.min(w, x0 + b), y1 = Math.min(h, y0 + b), c = 0;
                for (y = y0; y < y1; y++) {
                    var row = y * w;
                    for (x = x0; x < x1; x++) { hst[L[row + x] | 0]++; c++; }
                }
                g[by * gw + bx] = pct(hst, c, 0.9);
            }
        }

        function dilate(src) {
            var out = new Float32Array(src.length);
            for (var yy = 0; yy < gh; yy++) {
                for (var xx = 0; xx < gw; xx++) {
                    var m = 0;
                    for (var dy = -1; dy <= 1; dy++) {
                        var ry = yy + dy; if (ry < 0 || ry >= gh) continue;
                        for (var dx = -1; dx <= 1; dx++) {
                            var rx = xx + dx; if (rx < 0 || rx >= gw) continue;
                            var v = src[ry * gw + rx]; if (v > m) m = v;
                        }
                    }
                    out[yy * gw + xx] = m;
                }
            }
            return out;
        }
        function blur(src) {
            var out = new Float32Array(src.length);
            for (var yy = 0; yy < gh; yy++) {
                for (var xx = 0; xx < gw; xx++) {
                    var s = 0, c2 = 0;
                    for (var dy = -1; dy <= 1; dy++) {
                        var ry = yy + dy; if (ry < 0 || ry >= gh) continue;
                        for (var dx = -1; dx <= 1; dx++) {
                            var rx = xx + dx; if (rx < 0 || rx >= gw) continue;
                            s += src[ry * gw + rx]; c2++;
                        }
                    }
                    out[yy * gw + xx] = s / c2;
                }
            }
            return out;
        }

        g = dilate(dilate(g));
        for (i = 0; i < g.length; i++) if (g[i] < P * 0.75) g[i] = P;
        g = blur(blur(g));

        /* Bilinear between block centres, then divide. */
        for (y = 0; y < h; y++) {
            var fy = (y + 0.5) / b - 0.5;
            var y0b = Math.max(0, Math.min(gh - 1, Math.floor(fy)));
            var y1b = Math.min(gh - 1, y0b + 1);
            var ty = Math.max(0, Math.min(1, fy - y0b));
            for (x = 0; x < w; x++) {
                var fx = (x + 0.5) / b - 0.5;
                var x0b = Math.max(0, Math.min(gw - 1, Math.floor(fx)));
                var x1b = Math.min(gw - 1, x0b + 1);
                var tx = Math.max(0, Math.min(1, fx - x0b));
                var top = g[y0b * gw + x0b] * (1 - tx) + g[y0b * gw + x1b] * tx;
                var bot = g[y1b * gw + x0b] * (1 - tx) + g[y1b * gw + x1b] * tx;
                var bg = top * (1 - ty) + bot * ty;
                i = y * w + x;
                var v2 = L[i] * 255 / bg;
                L[i] = v2 > 255 ? 255 : v2;
            }
        }
        return L;
    }

    /* Stretch so the darkest real ink is 0 and anything close to paper is
       255. The black point comes from the dark pixels only — on a page that
       is 90% white, a percentile of the whole image is just "white". */
    function levels(L, n) {
        var hst = histogram(L, n);
        var dark = 0, v;
        for (v = 0; v < 128; v++) dark += hst[v];
        var K = 0;
        if (dark > n * 0.002) {
            var goal = dark * 0.2, c = 0;
            for (v = 0; v < 128; v++) { c += hst[v]; if (c >= goal) { K = v; break; } }
        }
        K = Math.min(K, 90);
        var WP = 242;
        var s = 255 / (WP - K);
        for (var i = 0; i < n; i++) {
            var t = (L[i] - K) * s;
            L[i] = t < 0 ? 0 : (t > 255 ? 255 : t);
        }
        return K;
    }

    function prepare(rgba, w, h, o) {
        var n = w * h;
        var L = luma(rgba, n);
        if (o.flatten !== false) flatten(L, w, h);
        var K = levels(L, n);
        return { L: L, w: w, h: h, black: K };
    }

    /* ── Stage 2: ink mask ──────────────────────────────────────────────── */

    /* Square max filter of radius r, separable. */
    function localMax(L, w, h, r) {
        var tmp = new Float32Array(w * h), out = new Float32Array(w * h);
        var x, y, k, m, row;
        for (y = 0; y < h; y++) {
            row = y * w;
            for (x = 0; x < w; x++) {
                m = 0;
                var a = x - r < 0 ? 0 : x - r, b = x + r >= w ? w - 1 : x + r;
                for (k = a; k <= b; k++) if (L[row + k] > m) m = L[row + k];
                tmp[row + x] = m;
            }
        }
        for (y = 0; y < h; y++) {
            var ya = y - r < 0 ? 0 : y - r, yb = y + r >= h ? h - 1 : y + r;
            for (x = 0; x < w; x++) {
                m = 0;
                for (k = ya; k <= yb; k++) if (tmp[k * w + x] > m) m = tmp[k * w + x];
                out[y * w + x] = m;
            }
        }
        return out;
    }

    /* Returns the cleaned field — ink keeps its (boosted) grey so the edge
       survives into resampling, everything else is 255 — plus counts and a
       diagnostic map for the REMOVED view. */
    function clean(prep, o) {
        var L = prep.L, w = prep.w, h = prep.h, n = w * h;
        var cut = o.cut == null ? 125 : o.cut;
        var fringeCut = 238;
        var minArea = Math.max(0, o.speck == null ? 8 : o.speck);
        var gain = o.gain || 1.3;
        var i, x, y;

        /* 0 none · 1 seed · 2 fringe

           Darkness alone does not make a seed. Tested on a shaded bat whose
           wings carried a mid-dark grey gradient (~90–120 after levels): with
           a plain cut at 125 the gradient seeded, its fringe grew into the
           outline, and every wing came out as a black blotch with holes in
           it. What a line has that shading does not is CONTRAST AT ITS OWN
           SCALE: within a few pixels of any line pixel there is paper, while
           a pixel in the middle of a wash is surrounded by more wash. So a
           pixel seeds if it is near black outright (solid fills, the cores of
           heavy outlines), or if it is under the cut AND at least `ridge`
           darker than the brightest thing within 3px of it. */
        var ink = new Uint8Array(n);
        var hard = cut * 0.5;
        var ridge = o.ridge == null ? 100 : o.ridge;
        var M = localMax(L, w, h, 3);
        for (i = 0; i < n; i++) {
            var lv = L[i];
            if (lv < hard || (lv < cut && M[i] - lv >= ridge)) ink[i] = 1;
        }
        M = null;

        /* Two rings of dilation: 3×3 square then plus — an octagon of radius
           2, near enough a disc that diagonal lines get the same fringe as
           straight ones. */
        var near = new Uint8Array(n);
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) {
                if (ink[y * w + x] !== 1) continue;
                for (var dy = -1; dy <= 1; dy++) {
                    var ry = y + dy; if (ry < 0 || ry >= h) continue;
                    for (var dx = -1; dx <= 1; dx++) {
                        var rx = x + dx; if (rx < 0 || rx >= w) continue;
                        near[ry * w + rx] = 1;
                    }
                }
            }
        }
        var near2 = new Uint8Array(near);
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) {
                i = y * w + x;
                if (!near[i]) continue;
                if (x > 0) near2[i - 1] = 1;
                if (x < w - 1) near2[i + 1] = 1;
                if (y > 0) near2[i - w] = 1;
                if (y < h - 1) near2[i + w] = 1;
            }
        }
        for (i = 0; i < n; i++) if (!ink[i] && near2[i] && L[i] < fringeCut) ink[i] = 2;
        near = near2 = null;

        /* Connected pieces, 8-way. A speck is a piece with too little area;
           it goes whether it is a seed or not. */
        var specks = 0, speckPx = 0;
        if (minArea > 0) {
            var seen = new Uint8Array(n);
            var stack = new Int32Array(n);
            var members = new Int32Array(n);
            for (var s = 0; s < n; s++) {
                if (!ink[s] || seen[s]) continue;
                var sp = 0, mc = 0;
                stack[sp++] = s; seen[s] = 1;
                while (sp) {
                    var p = stack[--sp];
                    members[mc++] = p;
                    var px = p % w, py = (p - px) / w;
                    for (var yy = py - 1; yy <= py + 1; yy++) {
                        if (yy < 0 || yy >= h) continue;
                        for (var xx = px - 1; xx <= px + 1; xx++) {
                            if (xx < 0 || xx >= w) continue;
                            var q = yy * w + xx;
                            if (ink[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
                        }
                    }
                }
                if (mc < minArea) {
                    specks++; speckPx += mc;
                    for (var m = 0; m < mc; m++) ink[members[m]] = 3;   /* 3 = speck, for the diagnostic */
                }
            }
        }

        /* Field + diagnostic. Diagnostic channels: 0 kept ink, 1 removed grey,
           2 speck, 255 paper — the page turns that into colours. */
        var field = new Float32Array(n);
        var diag = new Uint8Array(n);
        var inkPx = 0, greyPx = 0;
        for (i = 0; i < n; i++) {
            var v = L[i];
            /* Seeds are deepened so a thin faint line has a core dark enough
               to survive the threshold after resampling. Fringe is NOT: it
               already sits above the cut, and deepening it is what used to
               thicken every line by two pixels wherever shading touched it. */
            if (ink[i] === 1) {
                var d = (255 - v) * gain;
                field[i] = d >= 255 ? 0 : 255 - d;
                diag[i] = 0; inkPx++;
            } else if (ink[i] === 2) {
                field[i] = v;
                diag[i] = 0; inkPx++;
            } else {
                field[i] = 255;
                if (ink[i] === 3) diag[i] = 2;
                else if (v < 225) { diag[i] = 1; greyPx++; }
                else diag[i] = 255;
            }
        }
        return {
            field: field, diag: diag, w: w, h: h,
            stats: { inkPct: inkPx / n, greyPct: greyPx / n, specks: specks, speckPx: speckPx }
        };
    }

    /* ── Stage 3: resample and threshold ─────────────────────────────────── */

    /* Mitchell–Netravali, B = C = 1/3: the kernel with the least ringing that
       is still sharp. Ringing matters more than usual here, because a ring
       that crosses the threshold becomes a ghost line parallel to the real
       one. */
    function mitchell(x) {
        x = x < 0 ? -x : x;
        if (x < 1) return (7 * x * x * x - 12 * x * x + 16 / 3) / 6;
        if (x < 2) return (-7 / 3 * x * x * x + 12 * x * x - 20 * x + 32 / 3) / 6;
        return 0;
    }

    /* Tap table for one axis. `spread` widens the kernel in source pixels —
       it is the SMOOTHING control: 1 is plain Mitchell, larger averages away
       more of the source's own pixel staircase before the threshold sees it. */
    function taps(srcN, dstN, k, spread) {
        var sc = Math.max(spread, 1 / k);          /* downscaling needs the kernel wider anyway */
        var sup = 2 * sc;
        var nt = Math.ceil(sup * 2) + 1;
        var idx = new Int32Array(dstN * nt), wt = new Float32Array(dstN * nt);
        for (var d = 0; d < dstN; d++) {
            var c = (d + 0.5) / k - 0.5;
            var lo = Math.ceil(c - sup), tot = 0, base = d * nt;
            for (var t = 0; t < nt; t++) {
                var si = lo + t;
                var wv = mitchell((si - c) / sc);
                idx[base + t] = si < 0 ? 0 : (si >= srcN ? srcN - 1 : si);
                wt[base + t] = wv; tot += wv;
            }
            if (tot) for (t = 0; t < nt; t++) wt[base + t] /= tot;
        }
        return { idx: idx, wt: wt, nt: nt };
    }

    /* Resample the cleaned field into the art rectangle of a page buffer and
       threshold it. Separable: rows first into a float scratch the width of
       the output, then columns. */
    function render(cl, geo, o) {
        var w = cl.w, h = cl.h, F = cl.field;
        var W = geo.w, H = geo.h, k = geo.k;
        var spread = 1 + Math.max(0, Math.min(1, o.smooth == null ? 0.35 : o.smooth)) * 1.2;
        var tx = taps(w, W, W / w, spread), ty = taps(h, H, H / h, spread);

        var tmp = new Float32Array(h * W);
        var x, y, t, s, base;
        for (y = 0; y < h; y++) {
            var row = y * w, orow = y * W;
            for (x = 0; x < W; x++) {
                base = x * tx.nt; s = 0;
                for (t = 0; t < tx.nt; t++) s += F[row + tx.idx[base + t]] * tx.wt[base + t];
                tmp[orow + x] = s;
            }
        }

        /* Threshold: LINE WEIGHT moves the cut through the edge ramp — a
           higher cut takes in more of each edge, so every line thickens by the
           same sub-pixel amount instead of only the faint ones.

           Edge softness is set in OUTPUT pixels. The field's edge ramp spans
           roughly 1.4 × spread source pixels, which is k × that in output
           pixels; the gain maps it onto `aa` pixels so the anti-aliasing is a
           consistent width whatever the upscale factor. */
        var cut = 128 + (o.weight || 0) * 18;
        cut = cut < 20 ? 20 : (cut > 236 ? 236 : cut);
        var bw = o.edges === 'bw';
        var aa = 1.1;
        var g = (1.4 * spread * k) / aa;

        var pw = geo.pw, ph = geo.ph;
        var out = new Uint8Array(pw * ph);
        out.fill(255);
        var acc = new Float32Array(W);
        for (y = 0; y < H; y++) {
            acc.fill(0);
            base = y * ty.nt;
            for (t = 0; t < ty.nt; t++) {
                var wv = ty.wt[base + t]; if (!wv) continue;
                var srow = ty.idx[base + t] * W;
                for (x = 0; x < W; x++) acc[x] += tmp[srow + x] * wv;
            }
            var o0 = (geo.y + y) * pw + geo.x;
            if (bw) {
                for (x = 0; x < W; x++) out[o0 + x] = acc[x] < cut ? 0 : 255;
            } else {
                for (x = 0; x < W; x++) {
                    var v = 127.5 + (acc[x] - cut) * g;
                    out[o0 + x] = v <= 0 ? 0 : (v >= 255 ? 255 : v + 0.5) | 0;
                }
            }
        }
        return out;
    }

    /* ── Everything at once, with per-stage caching ─────────────────────── */

    /* The caller holds a cache object per image; each stage reuses its input
       when the options that feed it have not changed. Stage costs differ by
       two orders of magnitude between prepare (fast) and render (the whole
       output), so this is what makes the sliders tolerable. */
    function run(cache, rgba, w, h, o) {
        var t0 = Date.now();
        var pKey = String(o.flatten !== false);
        if (!cache.prep || cache.pKey !== pKey) {
            cache.prep = prepare(rgba, w, h, o); cache.pKey = pKey; cache.cl = null;
        }
        var cKey = [o.cut, o.speck, o.gain, o.ridge].join('|');
        if (!cache.cl || cache.cKey !== cKey) {
            cache.cl = clean(cache.prep, o); cache.cKey = cKey;
        }
        var geo = geometry(w, h, o);
        var out = render(cache.cl, geo, o);
        return { gray: out, geo: geo, stats: cache.cl.stats, black: cache.prep.black, ms: Date.now() - t0 };
    }

    /* The REMOVED view: kept ink in black, stripped grey in red at the
       strength it had, dropped specks in amber, paper white. At source size. */
    function diagnostic(cache) {
        var cl = cache.cl, L = cache.prep.L, n = cl.w * cl.h;
        var px = new Uint8ClampedArray(n * 4);
        for (var i = 0, j = 0; i < n; i++, j += 4) {
            var d = cl.diag[i];
            if (d === 0) {
                var v = cl.field[i]; px[j] = px[j + 1] = px[j + 2] = v;
            } else if (d === 1) {
                var a = (255 - L[i]) / 255;
                px[j] = 255 - a * (255 - 229); px[j + 1] = 255 - a * (255 - 72); px[j + 2] = 255 - a * (255 - 77);
            } else if (d === 2) {
                px[j] = 255; px[j + 1] = 176; px[j + 2] = 0;
            } else {
                px[j] = px[j + 1] = px[j + 2] = 255;
            }
            px[j + 3] = 255;
        }
        return px;
    }

    function isBilevel(gray) {
        for (var i = 0; i < gray.length; i++) { var v = gray[i]; if (v !== 0 && v !== 255) return false; }
        return true;
    }

    root.LINEART = {
        PAGES: PAGES,
        geometry: geometry,
        prepare: prepare,
        clean: clean,
        render: render,
        run: run,
        diagnostic: diagnostic,
        isBilevel: isBilevel
    };
})(typeof self !== 'undefined' ? self : this);
