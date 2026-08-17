/* ============================================================================
   CUTOUT — matting.js
   ---------------------------------------------------------------------------
   Everything downstream of "which pixels are the subject". The engines answer
   that question at one bit per pixel and they answer it badly at the edge,
   which is the only place anyone ever looks. This file is the repair shop.

   The pipeline, in the order the controls run it:

     shape      levels, morphology, speck removal, hole filling — cheap fixes
                to a mask that is basically right
     trimap     a band of "don't know" straddling the edge, which is the
                input every real matting algorithm actually wants
     matte      one of four ways to solve for fractional alpha inside that
                band: guided filter, closed-form, sampling, geodesic
     crf        optional dense-CRF mean field over a bilateral grid, for when
                the matte needs to snap to colour boundaries it missed
     unmix      estimate the background behind the edge and subtract it, so
                the cutout does not carry a halo of its old surroundings
     upsample   carry the working-resolution alpha back to full size through
                the full-resolution image, not through interpolation

   The one primitive everything leans on is the Euclidean distance transform.
   Exact EDT (Felzenszwalb & Huttenlocher's two-pass parabola envelope) gives
   morphology, trimap bands, sampling radii and feathering from one function
   with no structuring-element approximations anywhere.
   ========================================================================= */
(function () {
    'use strict';

    var ROOT = typeof globalThis !== 'undefined' ? globalThis : this;
    var CUT = ROOT.CUT = ROOT.CUT || {};

    function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

    /* ═══ 1. EXACT EUCLIDEAN DISTANCE TRANSFORM ══════════════════════════════

       Felzenszwalb & Huttenlocher 2004. Each 1-D pass computes the lower
       envelope of a set of parabolas — one rooted at every sample — in linear
       time. Two passes (columns, then rows) give the exact squared Euclidean
       distance, not an approximation, and the cost does not depend on the
       radius. That is what makes a 60px choke as cheap as a 1px one.         */

    function dt1d(f, n, d, v, z) {
        var k = 0, q, s;
        v[0] = 0; z[0] = -1e20; z[1] = 1e20;
        for (q = 1; q < n; q++) {
            s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) {
                k--;
                s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            }
            k++;
            v[k] = q; z[k] = s; z[k + 1] = 1e20;
        }
        k = 0;
        for (q = 0; q < n; q++) {
            while (z[k + 1] < q) k++;
            d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
        }
    }

    /* Squared distance from every pixel to the nearest pixel where
       `isSeed(i)` holds. Passing a predicate rather than a mask array saves
       building a Uint8Array for every threshold the UI sweeps. */
    function edtSq(w, h, isSeed) {
        var m = Math.max(w, h);
        var f = new Float64Array(m), d = new Float64Array(m);
        var v = new Int32Array(m), z = new Float64Array(m + 1);
        var g = new Float64Array(w * h);
        var x, y;
        for (x = 0; x < w; x++) {
            for (y = 0; y < h; y++) f[y] = isSeed(y * w + x) ? 0 : 1e20;
            dt1d(f, h, d, v, z);
            for (y = 0; y < h; y++) g[y * w + x] = d[y];
        }
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) f[x] = g[y * w + x];
            dt1d(f, w, d, v, z);
            for (x = 0; x < w; x++) g[y * w + x] = d[x];
        }
        return g;
    }

    /* ═══ 2. BOX AND GUIDED FILTERS ══════════════════════════════════════════ */

    /* Edge-correct box mean via an integral image: the divisor is the real
       clamped window area, so the filter does not darken at the frame. */
    function boxMean(src, w, h, r, out, scratch) {
        var W1 = w + 1;
        var I = scratch && scratch.length >= W1 * (h + 1) ? scratch : new Float64Array(W1 * (h + 1));
        var x, y, rs;
        for (x = 0; x < W1; x++) I[x] = 0;
        for (y = 0; y < h; y++) {
            rs = 0;
            I[(y + 1) * W1] = 0;
            for (x = 0; x < w; x++) {
                rs += src[y * w + x];
                I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + rs;
            }
        }
        for (y = 0; y < h; y++) {
            var y0 = y - r < 0 ? 0 : y - r;
            var y1 = y + r > h - 1 ? h - 1 : y + r;
            for (x = 0; x < w; x++) {
                var x0 = x - r < 0 ? 0 : x - r;
                var x1 = x + r > w - 1 ? w - 1 : x + r;
                var s = I[(y1 + 1) * W1 + x1 + 1] - I[y0 * W1 + x1 + 1]
                      - I[(y1 + 1) * W1 + x0] + I[y0 * W1 + x0];
                out[y * w + x] = s / ((x1 - x0 + 1) * (y1 - y0 + 1));
            }
        }
        return out;
    }

    /* He, Sun & Tang's guided filter with a 3-channel guide. Within every
       window it fits alpha as a LINEAR function of colour, q = a·I + b, then
       averages the overlapping fits. That linear model is exactly the matting
       model over a small window, which is why this — a filter, not a solve —
       lands so close to closed-form matting for a fraction of the cost.

       eps is the regulariser: large eps ⇒ a→0 ⇒ plain blur; small eps ⇒ the
       alpha is allowed to follow colour into every crevice, hair included.   */
    function guidedFilterColor(rgb, p, w, h, r, eps, out) {
        var n = w * h, i, c;
        var scratch = new Float64Array((w + 1) * (h + 1));
        var ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        for (i = 0; i < n; i++) {
            ch[0][i] = rgb[i * 3]; ch[1][i] = rgb[i * 3 + 1]; ch[2][i] = rgb[i * 3 + 2];
        }

        var mI = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        for (c = 0; c < 3; c++) boxMean(ch[c], w, h, r, mI[c], scratch);

        var mP = new Float32Array(n);
        boxMean(p, w, h, r, mP, scratch);

        var tmp = new Float32Array(n);
        var covIp = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        for (c = 0; c < 3; c++) {
            for (i = 0; i < n; i++) tmp[i] = ch[c][i] * p[i];
            boxMean(tmp, w, h, r, covIp[c], scratch);
            for (i = 0; i < n; i++) covIp[c][i] -= mI[c][i] * mP[i];
        }

        /* Six entries of the symmetric colour covariance per pixel. */
        var pairs = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]];
        var varI = [];
        for (var k = 0; k < 6; k++) {
            var a = pairs[k][0], b = pairs[k][1];
            var dst = new Float32Array(n);
            for (i = 0; i < n; i++) tmp[i] = ch[a][i] * ch[b][i];
            boxMean(tmp, w, h, r, dst, scratch);
            for (i = 0; i < n; i++) dst[i] -= mI[a][i] * mI[b][i];
            varI.push(dst);
        }

        var A = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        var B = new Float32Array(n);
        var inv = new Float64Array(6);
        for (i = 0; i < n; i++) {
            CUT.inv3sym(varI[0][i] + eps, varI[1][i], varI[2][i],
                        varI[3][i] + eps, varI[4][i], varI[5][i] + eps, inv);
            var c0 = covIp[0][i], c1 = covIp[1][i], c2 = covIp[2][i];
            var a0 = inv[0] * c0 + inv[1] * c1 + inv[2] * c2;
            var a1 = inv[1] * c0 + inv[3] * c1 + inv[4] * c2;
            var a2 = inv[2] * c0 + inv[4] * c1 + inv[5] * c2;
            A[0][i] = a0; A[1][i] = a1; A[2][i] = a2;
            B[i] = mP[i] - a0 * mI[0][i] - a1 * mI[1][i] - a2 * mI[2][i];
        }

        var mA = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        var mB = new Float32Array(n);
        for (c = 0; c < 3; c++) boxMean(A[c], w, h, r, mA[c], scratch);
        boxMean(B, w, h, r, mB, scratch);

        out = out || new Float32Array(n);
        for (i = 0; i < n; i++) {
            out[i] = mA[0][i] * ch[0][i] + mA[1][i] * ch[1][i] + mA[2][i] * ch[2][i] + mB[i];
        }
        return out;
    }

    function bilinear(src, sw, sh, dw, dh, out) {
        out = out || new Float32Array(dw * dh);
        var fx = sw / dw, fy = sh / dh;
        for (var y = 0; y < dh; y++) {
            var sy = (y + 0.5) * fy - 0.5;
            var y0 = Math.floor(sy); var ty = sy - y0;
            if (y0 < 0) { y0 = 0; ty = 0; }
            var y1 = y0 + 1 > sh - 1 ? sh - 1 : y0 + 1;
            for (var x = 0; x < dw; x++) {
                var sx = (x + 0.5) * fx - 0.5;
                var x0 = Math.floor(sx); var tx = sx - x0;
                if (x0 < 0) { x0 = 0; tx = 0; }
                var x1 = x0 + 1 > sw - 1 ? sw - 1 : x0 + 1;
                var a = src[y0 * sw + x0], b = src[y0 * sw + x1];
                var c = src[y1 * sw + x0], d = src[y1 * sw + x1];
                out[y * dw + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
            }
        }
        return out;
    }

    /* Fast guided filter, used as a joint upsampler. The linear coefficients
       are estimated at the small size and only THEY are interpolated; the
       final multiply happens against the full-resolution image. So the edge in
       the output is as sharp as the photograph, not as sharp as the mask.

       This is the step that lets everything else run at 512px and still hand
       back a clean alpha at 6000px.

       Split in two on purpose. The coefficients are four small planes; the
       image they are applied to may be forty megapixels, and converting that
       to float first would cost half a gigabyte for no reason. So the second
       half reads the browser's own RGBA bytes and never allocates a float
       copy of the picture at all.                                            */
    function guidedCoeffs(smallRgb, smallAlpha, sw, sh, r, eps) {
        var n = sw * sh, i, c;
        var scratch = new Float64Array((sw + 1) * (sh + 1));
        var ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        for (i = 0; i < n; i++) {
            ch[0][i] = smallRgb[i * 3]; ch[1][i] = smallRgb[i * 3 + 1]; ch[2][i] = smallRgb[i * 3 + 2];
        }
        var mI = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        for (c = 0; c < 3; c++) boxMean(ch[c], sw, sh, r, mI[c], scratch);
        var mP = new Float32Array(n);
        boxMean(smallAlpha, sw, sh, r, mP, scratch);

        var tmp = new Float32Array(n);
        var covIp = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        for (c = 0; c < 3; c++) {
            for (i = 0; i < n; i++) tmp[i] = ch[c][i] * smallAlpha[i];
            boxMean(tmp, sw, sh, r, covIp[c], scratch);
            for (i = 0; i < n; i++) covIp[c][i] -= mI[c][i] * mP[i];
        }
        var pairs = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]];
        var varI = [];
        for (var k = 0; k < 6; k++) {
            var a = pairs[k][0], b = pairs[k][1];
            var dst = new Float32Array(n);
            for (i = 0; i < n; i++) tmp[i] = ch[a][i] * ch[b][i];
            boxMean(tmp, sw, sh, r, dst, scratch);
            for (i = 0; i < n; i++) dst[i] -= mI[a][i] * mI[b][i];
            varI.push(dst);
        }
        var A = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        var B = new Float32Array(n);
        var inv = new Float64Array(6);
        for (i = 0; i < n; i++) {
            CUT.inv3sym(varI[0][i] + eps, varI[1][i], varI[2][i],
                        varI[3][i] + eps, varI[4][i], varI[5][i] + eps, inv);
            var c0 = covIp[0][i], c1 = covIp[1][i], c2 = covIp[2][i];
            var a0 = inv[0] * c0 + inv[1] * c1 + inv[2] * c2;
            var a1 = inv[1] * c0 + inv[3] * c1 + inv[4] * c2;
            var a2 = inv[2] * c0 + inv[4] * c1 + inv[5] * c2;
            A[0][i] = a0; A[1][i] = a1; A[2][i] = a2;
            B[i] = mP[i] - a0 * mI[0][i] - a1 * mI[1][i] - a2 * mI[2][i];
        }
        var mA = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        var mB = new Float32Array(n);
        for (c = 0; c < 3; c++) boxMean(A[c], sw, sh, r, mA[c], scratch);
        boxMean(B, sw, sh, r, mB, scratch);
        return { a: mA, b: mB, w: sw, h: sh };
    }

    /* q = a·I + b, with I read straight out of an RGBA byte array. */
    function applyCoeffsToU8(co, u8, bw, bh, out) {
        var uA0 = bilinear(co.a[0], co.w, co.h, bw, bh);
        var uA1 = bilinear(co.a[1], co.w, co.h, bw, bh);
        var uA2 = bilinear(co.a[2], co.w, co.h, bw, bh);
        var uB = bilinear(co.b, co.w, co.h, bw, bh);
        out = out || new Float32Array(bw * bh);
        var inv = 1 / 255;
        for (var i = 0, q = 0; i < bw * bh; i++, q += 4) {
            out[i] = clamp01(uA0[i] * u8[q] * inv + uA1[i] * u8[q + 1] * inv
                           + uA2[i] * u8[q + 2] * inv + uB[i]);
        }
        return out;
    }

    function guidedUpsample(smallRgb, smallAlpha, sw, sh, bigRgb, bw, bh, r, eps) {
        var co = guidedCoeffs(smallRgb, smallAlpha, sw, sh, r, eps);
        var uA = [bilinear(co.a[0], sw, sh, bw, bh), bilinear(co.a[1], sw, sh, bw, bh), bilinear(co.a[2], sw, sh, bw, bh)];
        var uB = bilinear(co.b, sw, sh, bw, bh);
        var out = new Float32Array(bw * bh);
        for (var i = 0; i < bw * bh; i++) {
            var p = i * 3;
            out[i] = clamp01(uA[0][i] * bigRgb[p] + uA[1][i] * bigRgb[p + 1] + uA[2][i] * bigRgb[p + 2] + uB[i]);
        }
        return out;
    }

    /* ═══ 3. SHAPE ═══════════════════════════════════════════════════════════ */

    /* Black point / white point / gamma on the alpha itself. The cheapest and
       most-used control on the panel: nine times out of ten a mask that looks
       wrong is a mask whose midtones need pushing apart. */
    function levels(alpha, black, white, gamma) {
        var n = alpha.length, span = white - black;
        if (Math.abs(span) < 1e-6) span = span < 0 ? -1e-6 : 1e-6;
        var g = 1 / Math.max(0.01, gamma);
        for (var i = 0; i < n; i++) {
            var v = (alpha[i] - black) / span;
            v = v < 0 ? 0 : v > 1 ? 1 : v;
            alpha[i] = gamma === 1 ? v : Math.pow(v, g);
        }
        return alpha;
    }

    /* Separable running min/max over a box. Van Herk / Gil-Werman: three
       array reads per pixel regardless of radius, by keeping prefix and suffix
       extrema over blocks of the structuring element's width.

       The array is first replicated r samples at each end AND padded up to a
       whole number of blocks. Both matter: replication is what gives a clamped
       border rather than a dark rim, and block alignment is what makes
       max(suffix[lo], prefix[lo+k−1]) cover exactly the window — without it
       the two halves can leave a gap near the end of the array, which shows up
       as a band of untouched pixels along one edge of an eroded mask.        */
    function runMinMax1d(src, dst, n, r, wantMax) {
        var k = 2 * r + 1;
        var M = Math.ceil((n + 2 * r) / k) * k;
        var pad = new Float32Array(M);
        var i;
        for (i = 0; i < M; i++) {
            var s = i - r;
            pad[i] = src[s < 0 ? 0 : s > n - 1 ? n - 1 : s];
        }
        var pre = new Float32Array(M), suf = new Float32Array(M);
        for (i = 0; i < M; i++) {
            pre[i] = (i % k === 0) ? pad[i]
                   : (wantMax ? Math.max(pre[i - 1], pad[i]) : Math.min(pre[i - 1], pad[i]));
        }
        for (i = M - 1; i >= 0; i--) {
            suf[i] = ((i + 1) % k === 0 || i === M - 1) ? pad[i]
                   : (wantMax ? Math.max(suf[i + 1], pad[i]) : Math.min(suf[i + 1], pad[i]));
        }
        /* Output j sits at padded index j+r, so its window is [j, j+2r]. */
        for (var j = 0; j < n; j++) {
            var a = suf[j], b = pre[j + 2 * r];
            dst[j] = wantMax ? Math.max(a, b) : Math.min(a, b);
        }
    }

    function morph(alpha, w, h, r, wantMax) {
        if (r < 1) return alpha;
        var tmp = new Float32Array(alpha.length);
        var row = new Float32Array(w), rowOut = new Float32Array(w);
        var col = new Float32Array(h), colOut = new Float32Array(h);
        var x, y;
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) row[x] = alpha[y * w + x];
            runMinMax1d(row, rowOut, w, r, wantMax);
            for (x = 0; x < w; x++) tmp[y * w + x] = rowOut[x];
        }
        for (x = 0; x < w; x++) {
            for (y = 0; y < h; y++) col[y] = tmp[y * w + x];
            runMinMax1d(col, colOut, h, r, wantMax);
            for (y = 0; y < h; y++) alpha[y * w + x] = colOut[y];
        }
        return alpha;
    }

    var erode = function (a, w, h, r) { return morph(a, w, h, r, false); };
    var dilate = function (a, w, h, r) { return morph(a, w, h, r, true); };

    /* Open then close: opening deletes specks smaller than the radius, closing
       fills pinholes of the same size. Done in that order because the reverse
       merges specks into the subject before it can drop them. */
    function openClose(alpha, w, h, openR, closeR) {
        if (openR > 0) { erode(alpha, w, h, openR); dilate(alpha, w, h, openR); }
        if (closeR > 0) { dilate(alpha, w, h, closeR); erode(alpha, w, h, closeR); }
        return alpha;
    }

    /* 8-connected labelling of alpha ≥ t, with an explicit stack rather than
       recursion — a megapixel blob will blow the call stack otherwise. */
    function components(alpha, w, h, t, above) {
        var n = w * h;
        var label = new Int32Array(n).fill(-1);
        var sizes = [];
        var stack = new Int32Array(n);
        var dx = [1, -1, 0, 0, 1, 1, -1, -1], dy = [0, 0, 1, -1, 1, -1, 1, -1];
        var touchesEdge = [];
        for (var s = 0; s < n; s++) {
            var inSet = above ? alpha[s] >= t : alpha[s] < t;
            if (!inSet || label[s] >= 0) continue;
            var id = sizes.length;
            var count = 0, edge = false, sp = 0;
            stack[sp++] = s; label[s] = id;
            while (sp > 0) {
                var p = stack[--sp];
                count++;
                var px = p % w, py = (p / w) | 0;
                if (px === 0 || py === 0 || px === w - 1 || py === h - 1) edge = true;
                for (var k = 0; k < 8; k++) {
                    var qx = px + dx[k], qy = py + dy[k];
                    if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
                    var q = qy * w + qx;
                    if (label[q] >= 0) continue;
                    var qin = above ? alpha[q] >= t : alpha[q] < t;
                    if (!qin) continue;
                    label[q] = id;
                    stack[sp++] = q;
                }
            }
            sizes.push(count);
            touchesEdge.push(edge);
        }
        return { label: label, sizes: sizes, touchesEdge: touchesEdge };
    }

    /* Keep the `keep` largest blobs, and anything at least `minFrac` of the
       biggest. Two controls rather than one because "the subject" is
       sometimes two things (a person and the bag they are holding) and
       sometimes one thing plus a thousand JPEG specks.

       `protect` is the escape hatch, and it is not optional in practice: a
       user who paints KEEP over something has stated a fact, and a size
       heuristic running afterwards must not be allowed to quietly delete it
       for being small. Any component holding a protected pixel survives. */
    function keepBlobs(alpha, w, h, t, keep, minFrac, protect) {
        var cc = components(alpha, w, h, t, true);
        if (!cc.sizes.length) return alpha;
        var order = cc.sizes.map(function (v, i) { return [v, i]; });
        order.sort(function (a, b) { return b[0] - a[0]; });
        var biggest = order[0][0];
        var live = new Uint8Array(cc.sizes.length);
        var i, p, l;
        for (i = 0; i < order.length; i++) {
            if (i < keep || order[i][0] >= biggest * minFrac) live[order[i][1]] = 1;
        }
        if (protect) {
            for (p = 0; p < w * h; p++) {
                l = cc.label[p];
                if (l >= 0 && protect[p]) live[l] = 1;
            }
        }
        for (p = 0; p < w * h; p++) {
            l = cc.label[p];
            if (l >= 0 && !live[l]) alpha[p] = 0;
        }
        return alpha;
    }

    /* A hole is a below-threshold region that never reaches the frame. A hole
       the user has painted DROP inside is a hole they meant, so it stays. */
    function fillHoles(alpha, w, h, t, maxFrac, protect) {
        var cc = components(alpha, w, h, t, false);
        var n = w * h, p, l;
        var limit = maxFrac === undefined ? 1 : maxFrac;
        var keepOpen = null;
        if (protect) {
            keepOpen = new Uint8Array(cc.sizes.length);
            for (p = 0; p < n; p++) {
                l = cc.label[p];
                if (l >= 0 && protect[p]) keepOpen[l] = 1;
            }
        }
        for (p = 0; p < n; p++) {
            l = cc.label[p];
            if (l < 0) continue;
            if (cc.touchesEdge[l]) continue;
            if (cc.sizes[l] > n * limit) continue;
            if (keepOpen && keepOpen[l]) continue;
            alpha[p] = 1;
        }
        return alpha;
    }

    /* Move the edge in or out by a sub-pixel-accurate distance, using the EDT
       of the binarised alpha as a signed distance field. Unlike a min/max
       filter this is isotropic — a box erode eats corners faster than edges,
       which is visible on anything with a straight side. */
    function shiftEdge(alpha, w, h, px, softness) {
        if (Math.abs(px) < 0.01 && softness <= 0) return alpha;
        var n = w * h;
        var inside = edtSq(w, h, function (i) { return alpha[i] < 0.5; });
        var outside = edtSq(w, h, function (i) { return alpha[i] >= 0.5; });
        var half = Math.max(0.5, softness);
        for (var i = 0; i < n; i++) {
            /* Positive inside the subject. The −0.5 is the half-pixel that
               separates "distance to the nearest pixel of the other kind"
               from "distance to the boundary between them": without it the
               innermost edge pixel reads 1 rather than ½ and every shift
               lands half a pixel short. */
            var sd = alpha[i] >= 0.5 ? Math.sqrt(inside[i]) - 0.5 : -(Math.sqrt(outside[i]) - 0.5);
            alpha[i] = clamp01(0.5 + (sd - px) / (2 * half));
        }
        return alpha;
    }

    /* ═══ 4. TRIMAP ══════════════════════════════════════════════════════════

       Three states: definitely subject, definitely not, and the band in
       between where the actual matting happens. Width is the single most
       important number in the whole file — too narrow and hair is cut off at
       the root, too wide and the solver has to invent alpha for pixels that
       were never ambiguous.                                                   */

    var UNK = 0, BG = 1, FG = 2;

    /* The band is measured from the α = ½ ISOLINE, never from the certainty
       thresholds. That distinction is the difference between a trimap and a
       silent no-op: a mask whose maximum happens to be 0.83 — which is what an
       average of several engines' opinions routinely looks like — contains no
       pixel above a 0.95 threshold at all, so seeding the band from that
       threshold produces an empty band, an untouched matte, and no error
       message anywhere. Measured from the isoline the band always exists as
       long as the mask has two labels in it.

       loT and hiT then do a narrower and more honest job: they widen the band
       to take in pixels that are genuinely uncertain — but only within a few
       band-widths of the edge, or a uniformly soft mask would swallow its own
       anchors and the solve would have nothing to hold on to. */
    function trimap(alpha, w, h, band, loT, hiT) {
        var n = w * h, i;
        var map = new Uint8Array(n);
        var anyIn = false, anyOut = false;
        for (i = 0; i < n; i++) {
            if (alpha[i] >= 0.5) anyIn = true; else anyOut = true;
            if (anyIn && anyOut) break;
        }
        if (!anyIn || !anyOut) {
            /* One label only: there is no edge, so there is nothing to solve. */
            for (i = 0; i < n; i++) map[i] = anyIn ? FG : BG;
            return map;
        }

        var dIn = edtSq(w, h, function (k) { return alpha[k] >= 0.5; });
        var dOut = edtSq(w, h, function (k) { return alpha[k] < 0.5; });
        var b2 = band * band;
        var far = (band * 3) * (band * 3);

        function build(useFuzzy) {
            var fg = 0, bg = 0, unk = 0;
            for (var j = 0; j < n; j++) {
                var near = dIn[j] <= b2 && dOut[j] <= b2;
                var fuzzy = useFuzzy && alpha[j] > loT && alpha[j] < hiT
                            && dIn[j] <= far && dOut[j] <= far;
                if (near || fuzzy) { map[j] = UNK; unk++; }
                else if (alpha[j] >= 0.5) { map[j] = FG; fg++; }
                else { map[j] = BG; bg++; }
            }
            return { fg: fg, bg: bg, unk: unk };
        }

        var r = build(true);
        /* If widening ate every anchor on one side, the solve would be
           unconstrained and would drift to whichever side still had one. */
        if (r.fg === 0 || r.bg === 0) r = build(false);
        return map;
    }

    /* ═══ 5. CLOSED-FORM MATTING ═════════════════════════════════════════════

       Levin, Lischinski & Weiss 2008. Assume that within any small window the
       foreground and background colours are each roughly constant; then alpha
       is a linear function of colour in that window, and eliminating the
       unknown F and B analytically leaves a quadratic in alpha alone whose
       matrix — the matting Laplacian — depends only on the image.

         L(i,j) = Σ_{k: i,j ∈ w_k}  δ_ij − (1/|w_k|)(1 + (I_i−μ_k)ᵀ Σ̂_k⁻¹ (I_j−μ_k))

       Building L explicitly would mean ~25 non-zeros per row and hundreds of
       megabytes. It is never built. Conjugate gradients only ever needs the
       PRODUCT L·x, and that factors per window into two three-vector passes:

         s = Σ_j x_j            v = Σ_j (I_j−μ)x_j        u = Σ̂⁻¹v
         (Lx)_i += x_i − (1/|w|)( s + (I_i−μ)·u )

       which is O(9) per window with no matrix anywhere. And because alpha is
       already known outside the trimap band, the solve is restricted to the
       unknown set: only windows that touch the band are ever visited, so the
       cost tracks the length of the edge rather than the area of the picture.  */

    function cfmPrepare(rgb01, w, h, eps) {
        var n = w * h;
        var mu = new Float32Array(n * 3);
        /* Float64, not Float32. Where a window's colours are collinear — a
           smooth ramp, a greyscale region, anything shot under one light —
           the covariance is rank-deficient and its regularised inverse has
           entries of order 1/eps. At eps = 1e-8 that is 1e8, which single
           precision cannot hold to enough significant digits to keep the
           solve stable. Six extra bytes a pixel is a cheap fix. */
        var M = new Float64Array(n * 6);
        var inv = new Float64Array(6);
        var x, y;
        for (y = 0; y < h; y++) {
            var y0 = y - 1 < 0 ? 0 : y - 1, y1 = y + 1 > h - 1 ? h - 1 : y + 1;
            for (x = 0; x < w; x++) {
                var x0 = x - 1 < 0 ? 0 : x - 1, x1 = x + 1 > w - 1 ? w - 1 : x + 1;
                var c = (x1 - x0 + 1) * (y1 - y0 + 1);
                var s0 = 0, s1 = 0, s2 = 0;
                var q00 = 0, q01 = 0, q02 = 0, q11 = 0, q12 = 0, q22 = 0;
                for (var yy = y0; yy <= y1; yy++) {
                    for (var xx = x0; xx <= x1; xx++) {
                        var o = (yy * w + xx) * 3;
                        var r = rgb01[o], g = rgb01[o + 1], b = rgb01[o + 2];
                        s0 += r; s1 += g; s2 += b;
                        q00 += r * r; q01 += r * g; q02 += r * b;
                        q11 += g * g; q12 += g * b; q22 += b * b;
                    }
                }
                var invc = 1 / c;
                var m0 = s0 * invc, m1 = s1 * invc, m2 = s2 * invc;
                var e = eps * invc;
                CUT.inv3sym(q00 * invc - m0 * m0 + e, q01 * invc - m0 * m1, q02 * invc - m0 * m2,
                            q11 * invc - m1 * m1 + e, q12 * invc - m1 * m2,
                            q22 * invc - m2 * m2 + e, inv);
                var i = y * w + x, p3 = i * 3, p6 = i * 6;
                mu[p3] = m0; mu[p3 + 1] = m1; mu[p3 + 2] = m2;
                for (var k = 0; k < 6; k++) M[p6 + k] = inv[k];
            }
        }
        return { mu: mu, M: M };
    }

    /* out = L·x over the listed windows only. `x` must be zero wherever the
       caller wants the column excluded — that is how the restriction to the
       unknown set is expressed without ever renumbering anything. */
    function cfmApply(x, out, prep, rgb01, w, h, wins, winCount) {
        out.fill(0);
        var mu = prep.mu, M = prep.M;
        for (var t = 0; t < winCount; t++) {
            var k = wins[t];
            var kx = k % w, ky = (k / w) | 0;
            var x0 = kx - 1 < 0 ? 0 : kx - 1, x1 = kx + 1 > w - 1 ? w - 1 : kx + 1;
            var y0 = ky - 1 < 0 ? 0 : ky - 1, y1 = ky + 1 > h - 1 ? h - 1 : ky + 1;
            var c = (x1 - x0 + 1) * (y1 - y0 + 1), invc = 1 / c;
            var k3 = k * 3, k6 = k * 6;
            var m0 = mu[k3], m1 = mu[k3 + 1], m2 = mu[k3 + 2];

            var s = 0, v0 = 0, v1 = 0, v2 = 0, yy, xx, j, o, xv;
            for (yy = y0; yy <= y1; yy++) {
                for (xx = x0; xx <= x1; xx++) {
                    j = yy * w + xx;
                    xv = x[j];
                    if (xv === 0) continue;
                    s += xv;
                    o = j * 3;
                    v0 += (rgb01[o] - m0) * xv;
                    v1 += (rgb01[o + 1] - m1) * xv;
                    v2 += (rgb01[o + 2] - m2) * xv;
                }
            }
            var u0 = M[k6] * v0 + M[k6 + 1] * v1 + M[k6 + 2] * v2;
            var u1 = M[k6 + 1] * v0 + M[k6 + 3] * v1 + M[k6 + 4] * v2;
            var u2 = M[k6 + 2] * v0 + M[k6 + 4] * v1 + M[k6 + 5] * v2;

            for (yy = y0; yy <= y1; yy++) {
                for (xx = x0; xx <= x1; xx++) {
                    j = yy * w + xx;
                    o = j * 3;
                    var dot = (rgb01[o] - m0) * u0 + (rgb01[o + 1] - m1) * u1 + (rgb01[o + 2] - m2) * u2;
                    out[j] += x[j] - invc * (s + dot);
                }
            }
        }
        return out;
    }

    function cfmDiagonal(prep, rgb01, w, h, wins, winCount, diag) {
        diag.fill(0);
        var mu = prep.mu, M = prep.M;
        for (var t = 0; t < winCount; t++) {
            var k = wins[t];
            var kx = k % w, ky = (k / w) | 0;
            var x0 = kx - 1 < 0 ? 0 : kx - 1, x1 = kx + 1 > w - 1 ? w - 1 : kx + 1;
            var y0 = ky - 1 < 0 ? 0 : ky - 1, y1 = ky + 1 > h - 1 ? h - 1 : ky + 1;
            var c = (x1 - x0 + 1) * (y1 - y0 + 1), invc = 1 / c;
            var k3 = k * 3, k6 = k * 6;
            var m0 = mu[k3], m1 = mu[k3 + 1], m2 = mu[k3 + 2];
            for (var yy = y0; yy <= y1; yy++) {
                for (var xx = x0; xx <= x1; xx++) {
                    var j = yy * w + xx, o = j * 3;
                    var d0 = rgb01[o] - m0, d1 = rgb01[o + 1] - m1, d2 = rgb01[o + 2] - m2;
                    var q = M[k6] * d0 * d0 + 2 * M[k6 + 1] * d0 * d1 + 2 * M[k6 + 2] * d0 * d2
                          + M[k6 + 3] * d1 * d1 + 2 * M[k6 + 4] * d1 * d2 + M[k6 + 5] * d2 * d2;
                    diag[j] += 1 - invc * (1 + q);
                }
            }
        }
        return diag;
    }

    function closedFormMatting(rgb01, w, h, tri, alphaInit, opt) {
        opt = opt || {};
        var n = w * h, i;
        var eps = opt.eps === undefined ? 1e-6 : opt.eps;
        var iters = opt.iterations === undefined ? 60 : opt.iterations;

        /* The unknown set, and every window that touches it. */
        var uList = new Int32Array(n), uCount = 0;
        for (i = 0; i < n; i++) if (tri[i] === UNK) uList[uCount++] = i;
        if (uCount === 0) {
            var done = new Float32Array(n);
            for (i = 0; i < n; i++) done[i] = tri[i] === FG ? 1 : 0;
            return done;
        }

        var touch = new Uint8Array(n);
        for (var t = 0; t < uCount; t++) {
            var p = uList[t], px = p % w, py = (p / w) | 0;
            for (var dy = -1; dy <= 1; dy++) {
                for (var dx = -1; dx <= 1; dx++) {
                    var qx = px + dx, qy = py + dy;
                    if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
                    touch[qy * w + qx] = 1;
                }
            }
        }
        var wins = new Int32Array(n), winCount = 0;
        for (i = 0; i < n; i++) if (touch[i]) wins[winCount++] = i;

        var prep = cfmPrepare(rgb01, w, h, eps);

        /* b = −(L·α_known)|_U, with α_known zero on the unknown set. */
        var known = new Float32Array(n);
        for (i = 0; i < n; i++) known[i] = tri[i] === FG ? 1 : 0;
        var scratch = new Float32Array(n);
        cfmApply(known, scratch, prep, rgb01, w, h, wins, winCount);

        var b = new Float32Array(n);
        for (var t2 = 0; t2 < uCount; t2++) b[uList[t2]] = -scratch[uList[t2]];

        var diag = new Float32Array(n);
        cfmDiagonal(prep, rgb01, w, h, wins, winCount, diag);
        var reg = opt.reg === undefined ? 1e-6 : opt.reg;
        for (var t3 = 0; t3 < uCount; t3++) {
            var u = uList[t3];
            diag[u] = diag[u] + reg;
            if (!(diag[u] > 1e-9)) diag[u] = 1e-9;
        }

        var x = new Float32Array(n);
        for (var t4 = 0; t4 < uCount; t4++) {
            var u4 = uList[t4];
            x[u4] = alphaInit ? clamp01(alphaInit[u4]) : 0.5;
        }

        var Ax = new Float32Array(n), r = new Float32Array(n);
        var z = new Float32Array(n), pv = new Float32Array(n), Ap = new Float32Array(n);

        cfmApply(x, Ax, prep, rgb01, w, h, wins, winCount);
        var rz = 0, k5;
        for (k5 = 0; k5 < uCount; k5++) {
            var iu = uList[k5];
            r[iu] = b[iu] - (Ax[iu] + reg * x[iu]);
            z[iu] = r[iu] / diag[iu];
            pv[iu] = z[iu];
            rz += r[iu] * z[iu];
        }

        for (var it = 0; it < iters; it++) {
            if (!(rz > 1e-12)) break;
            cfmApply(pv, Ap, prep, rgb01, w, h, wins, winCount);
            var pAp = 0;
            for (k5 = 0; k5 < uCount; k5++) {
                var j5 = uList[k5];
                Ap[j5] += reg * pv[j5];
                pAp += pv[j5] * Ap[j5];
            }
            if (!(Math.abs(pAp) > 1e-20)) break;
            var alphaStep = rz / pAp;
            var rzNew = 0;
            for (k5 = 0; k5 < uCount; k5++) {
                var j6 = uList[k5];
                x[j6] += alphaStep * pv[j6];
                r[j6] -= alphaStep * Ap[j6];
                z[j6] = r[j6] / diag[j6];
                rzNew += r[j6] * z[j6];
            }
            var beta = rzNew / rz;
            for (k5 = 0; k5 < uCount; k5++) {
                var j7 = uList[k5];
                pv[j7] = z[j7] + beta * pv[j7];
            }
            rz = rzNew;
            if (opt.onProgress && (it & 7) === 0) opt.onProgress(it / iters);
        }

        var out = new Float32Array(n);
        for (i = 0; i < n; i++) out[i] = tri[i] === FG ? 1 : tri[i] === BG ? 0 : clamp01(x[i]);
        return out;
    }

    /* ═══ 6. SAMPLING MATTING ════════════════════════════════════════════════

       The other family. Rather than solving for alpha everywhere at once, each
       unknown pixel is explained on its own terms: find real foreground and
       background colours nearby, and ask what mixture of them the observed
       colour is. Where closed-form assumes smoothness, this assumes the true
       F and B are somewhere on the boundary — so it is the better answer for
       a wispy edge on a busy background, and the worse one for a smooth edge
       where its per-pixel independence shows up as noise.

       Candidates are gathered by walking rays outward in 16 directions and
       taking the first known pixel each one hits. Every F×B pair is scored on
       how well it explains the colour, and the winner's alpha is kept.        */

    function samplingMatting(rgb01, w, h, tri, opt) {
        opt = opt || {};
        var n = w * h, i;
        var RAYS = opt.rays || 16;
        var maxStep = opt.maxSteps || 0;
        if (!maxStep) maxStep = Math.max(24, Math.round(Math.min(w, h) * 0.25));

        var dirX = new Float32Array(RAYS), dirY = new Float32Array(RAYS);
        for (i = 0; i < RAYS; i++) {
            var a = (i / RAYS) * Math.PI * 2;
            dirX[i] = Math.cos(a); dirY[i] = Math.sin(a);
        }

        var out = new Float32Array(n);
        var fgS = new Float32Array(RAYS * 3), bgS = new Float32Array(RAYS * 3);
        var fgD = new Float32Array(RAYS), bgD = new Float32Array(RAYS);

        for (var p = 0; p < n; p++) {
            if (tri[p] === FG) { out[p] = 1; continue; }
            if (tri[p] === BG) { out[p] = 0; continue; }
            var px = p % w, py = (p / w) | 0;
            var nf = 0, nb = 0;

            for (var d = 0; d < RAYS; d++) {
                var fx = px + 0.5, fy = py + 0.5;
                var gotF = false, gotB = false;
                for (var s = 1; s <= maxStep && !(gotF && gotB); s++) {
                    fx += dirX[d]; fy += dirY[d];
                    var qx = fx | 0, qy = fy | 0;
                    if (qx < 0 || qy < 0 || qx >= w || qy >= h) break;
                    var q = qy * w + qx;
                    if (!gotF && tri[q] === FG) {
                        gotF = true;
                        fgS[nf * 3] = rgb01[q * 3]; fgS[nf * 3 + 1] = rgb01[q * 3 + 1]; fgS[nf * 3 + 2] = rgb01[q * 3 + 2];
                        fgD[nf] = s; nf++;
                    } else if (!gotB && tri[q] === BG) {
                        gotB = true;
                        bgS[nb * 3] = rgb01[q * 3]; bgS[nb * 3 + 1] = rgb01[q * 3 + 1]; bgS[nb * 3 + 2] = rgb01[q * 3 + 2];
                        bgD[nb] = s; nb++;
                    }
                }
            }

            if (nf === 0 || nb === 0) {
                /* No usable pair — leave it to whatever seeded the band. */
                out[p] = opt.fallback ? clamp01(opt.fallback[p]) : 0.5;
                continue;
            }

            var minFd = Infinity, minBd = Infinity, k;
            for (k = 0; k < nf; k++) if (fgD[k] < minFd) minFd = fgD[k];
            for (k = 0; k < nb; k++) if (bgD[k] < minBd) minBd = bgD[k];

            var o3 = p * 3;
            var cr = rgb01[o3], cg = rgb01[o3 + 1], cb = rgb01[o3 + 2];
            var bestCost = Infinity, bestA = 0.5;

            for (var fi = 0; fi < nf; fi++) {
                var Fr = fgS[fi * 3], Fg = fgS[fi * 3 + 1], Fb = fgS[fi * 3 + 2];
                for (var bi = 0; bi < nb; bi++) {
                    var Br = bgS[bi * 3], Bg = bgS[bi * 3 + 1], Bb = bgS[bi * 3 + 2];
                    var dr = Fr - Br, dg = Fg - Bg, db = Fb - Bb;
                    var den = dr * dr + dg * dg + db * db;
                    if (den < 1e-8) continue;
                    var av = ((cr - Br) * dr + (cg - Bg) * dg + (cb - Bb) * db) / den;
                    av = clamp01(av);
                    /* Residual of the mixing model, normalised by how far
                       apart F and B are: a pair that barely differs explains
                       everything and means nothing. */
                    var er = cr - (av * Fr + (1 - av) * Br);
                    var eg = cg - (av * Fg + (1 - av) * Bg);
                    var eb = cb - (av * Fb + (1 - av) * Bb);
                    var resid = Math.sqrt(er * er + eg * eg + eb * eb) / (Math.sqrt(den) + 1e-4);
                    var spatial = (fgD[fi] / minFd) * (bgD[bi] / minBd);
                    var cost = resid * 3 + Math.log(spatial + 1) * 0.35;
                    if (cost < bestCost) { bestCost = cost; bestA = av; }
                }
            }
            out[p] = bestA;
        }
        return out;
    }

    /* ═══ 7. GEODESIC MATTING ════════════════════════════════════════════════

       Distance measured through the picture rather than across it: stepping to
       a neighbour costs a little for being a step and a lot for being a change
       of colour. Alpha is then just the relative closeness to the two seed
       sets. Chamfer raster scans converge in a handful of passes and cost
       almost nothing, which makes this the one to reach for when the band is
       very wide and everything else has become slow.                          */

    function geodesicDistance(rgb01, w, h, isSeed, gamma, passes) {
        var n = w * h, i;
        var d = new Float64Array(n);
        for (i = 0; i < n; i++) d[i] = isSeed(i) ? 0 : 1e18;
        var SQ2 = Math.SQRT2;

        function cost(a, b, len) {
            var o = a * 3, q = b * 3;
            var dr = rgb01[o] - rgb01[q], dg = rgb01[o + 1] - rgb01[q + 1], db = rgb01[o + 2] - rgb01[q + 2];
            return len * (1 + gamma * Math.sqrt(dr * dr + dg * dg + db * db));
        }

        for (var pass = 0; pass < (passes || 3); pass++) {
            var x, y, p;
            for (y = 0; y < h; y++) {
                for (x = 0; x < w; x++) {
                    p = y * w + x;
                    var best = d[p];
                    if (x > 0) best = Math.min(best, d[p - 1] + cost(p, p - 1, 1));
                    if (y > 0) best = Math.min(best, d[p - w] + cost(p, p - w, 1));
                    if (y > 0 && x > 0) best = Math.min(best, d[p - w - 1] + cost(p, p - w - 1, SQ2));
                    if (y > 0 && x < w - 1) best = Math.min(best, d[p - w + 1] + cost(p, p - w + 1, SQ2));
                    d[p] = best;
                }
            }
            for (y = h - 1; y >= 0; y--) {
                for (x = w - 1; x >= 0; x--) {
                    p = y * w + x;
                    var best2 = d[p];
                    if (x < w - 1) best2 = Math.min(best2, d[p + 1] + cost(p, p + 1, 1));
                    if (y < h - 1) best2 = Math.min(best2, d[p + w] + cost(p, p + w, 1));
                    if (y < h - 1 && x < w - 1) best2 = Math.min(best2, d[p + w + 1] + cost(p, p + w + 1, SQ2));
                    if (y < h - 1 && x > 0) best2 = Math.min(best2, d[p + w - 1] + cost(p, p + w - 1, SQ2));
                    d[p] = best2;
                }
            }
        }
        return d;
    }

    function geodesicMatting(rgb01, w, h, tri, opt) {
        opt = opt || {};
        var n = w * h;
        var gamma = opt.gamma === undefined ? 40 : opt.gamma;
        var power = opt.power === undefined ? 1 : opt.power;
        var dF = geodesicDistance(rgb01, w, h, function (i) { return tri[i] === FG; }, gamma, opt.passes || 3);
        var dB = geodesicDistance(rgb01, w, h, function (i) { return tri[i] === BG; }, gamma, opt.passes || 3);
        var out = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            if (tri[i] === FG) { out[i] = 1; continue; }
            if (tri[i] === BG) { out[i] = 0; continue; }
            var a = Math.pow(dF[i], power), b = Math.pow(dB[i], power);
            var s = a + b;
            out[i] = s > 1e-12 ? b / s : 0.5;
        }
        return out;
    }

    /* ═══ 8. DENSE CRF, MEAN FIELD ═══════════════════════════════════════════

       Krähenbühl & Koltun 2011. Every pixel is connected to every other pixel
       by a Gaussian kernel over position and colour; the intractable part —
       summing N² messages — becomes a high-dimensional Gaussian blur, and a
       blur is something you can do with a grid.

       Here that grid is a sparse five-dimensional bilateral grid: pixels splat
       into buckets of (x, y, L, a, b), the buckets are blurred with [1 2 1]
       along each axis, and pixels read back out. Sparse because the occupied
       fraction of a 5-D grid is tiny — a dense one at any useful resolution
       would be gigabytes.

       What it buys: an alpha that snaps to colour boundaries the mask missed,
       across long distances, without the halo a big blur would leave.         */

    function denseCRF(rgb01, lab, w, h, unary, opt) {
        opt = opt || {};
        var n = w * h, i;
        var iters = opt.iterations === undefined ? 5 : opt.iterations;
        var thetaXY = opt.spatial === undefined ? 24 : opt.spatial;      /* px per grid cell */
        var thetaC = opt.colour === undefined ? 0.05 : opt.colour;       /* OKLab per cell */
        var wBil = opt.wBilateral === undefined ? 4 : opt.wBilateral;
        var wSm = opt.wSmooth === undefined ? 1.5 : opt.wSmooth;
        var smoothR = opt.smoothRadius === undefined ? 2 : opt.smoothRadius;

        var gx = Math.max(1, Math.min(255, Math.ceil(w / thetaXY)));
        var gy = Math.max(1, Math.min(255, Math.ceil(h / thetaXY)));
        var stepX = w / gx, stepY = h / gy;
        var LB = 24, AB = 20, BB = 20;   /* colour bins, coarse on purpose */

        /* One pass to find the OKLab extent, so the bins land on the colours
           this picture actually contains rather than on the whole space. */
        var lMin = 1e9, lMax = -1e9, aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9;
        for (i = 0; i < n; i++) {
            var o = i * 3;
            if (lab[o] < lMin) lMin = lab[o]; if (lab[o] > lMax) lMax = lab[o];
            if (lab[o + 1] < aMin) aMin = lab[o + 1]; if (lab[o + 1] > aMax) aMax = lab[o + 1];
            if (lab[o + 2] < bMin) bMin = lab[o + 2]; if (lab[o + 2] > bMax) bMax = lab[o + 2];
        }
        var lSpan = Math.max(1e-4, lMax - lMin), aSpan = Math.max(1e-4, aMax - aMin), bSpan = Math.max(1e-4, bMax - bMin);
        LB = Math.max(2, Math.min(LB, Math.ceil(lSpan / thetaC)));
        AB = Math.max(2, Math.min(AB, Math.ceil(aSpan / thetaC)));
        BB = Math.max(2, Math.min(BB, Math.ceil(bSpan / thetaC)));

        /* Strides in the packed key, and the neighbour offsets for the blur. */
        var SX = 1, SY = gx, SL = gx * gy, SA = SL * LB, SB = SA * AB;

        var cellOf = new Int32Array(n);
        var index = new Map();
        var keys = [];
        for (i = 0; i < n; i++) {
            var px = i % w, py = (i / w) | 0, o2 = i * 3;
            var cx = Math.min(gx - 1, (px / stepX) | 0);
            var cy = Math.min(gy - 1, (py / stepY) | 0);
            var cl = Math.min(LB - 1, ((lab[o2] - lMin) / lSpan * LB) | 0);
            var ca = Math.min(AB - 1, ((lab[o2 + 1] - aMin) / aSpan * AB) | 0);
            var cb = Math.min(BB - 1, ((lab[o2 + 2] - bMin) / bSpan * BB) | 0);
            var key = cx * SX + cy * SY + cl * SL + ca * SA + cb * SB;
            var slot = index.get(key);
            if (slot === undefined) { slot = keys.length; index.set(key, slot); keys.push(key); }
            cellOf[i] = slot;
        }
        var C = keys.length;

        var Q = new Float32Array(n);           /* P(foreground) */
        for (i = 0; i < n; i++) Q[i] = clamp01(unary[i]);

        var cellQ = new Float32Array(C), cellW = new Float32Array(C);
        var tmpQ = new Float32Array(C), tmpW = new Float32Array(C);
        var msgBil = new Float32Array(n), msgSm = new Float32Array(n);
        var strides = [SX, SY, SL, SA, SB];
        var dims = [gx, gy, LB, AB, BB];
        var coord = new Int32Array(5);
        var smoothBuf = new Float32Array(n);
        var scratch = new Float64Array((w + 1) * (h + 1));

        for (var it = 0; it < iters; it++) {
            /* ── splat ── */
            cellQ.fill(0); cellW.fill(0);
            for (i = 0; i < n; i++) { var s = cellOf[i]; cellQ[s] += Q[i]; cellW[s] += 1; }

            /* ── blur: [1 2 1] along each of the five axes ── */
            for (var d = 0; d < 5; d++) {
                var st = strides[d], dim = dims[d];
                tmpQ.set(cellQ); tmpW.set(cellW);
                for (var c2 = 0; c2 < C; c2++) {
                    var key2 = keys[c2];
                    /* Decode just this axis to know whether the neighbours
                       exist; the packed key is mixed radix. */
                    var here = ((key2 / st) | 0) % dim;
                    var qAcc = 2 * tmpQ[c2], wAcc = 2 * tmpW[c2];
                    if (here > 0) {
                        var sm = index.get(key2 - st);
                        if (sm !== undefined) { qAcc += tmpQ[sm]; wAcc += tmpW[sm]; }
                    }
                    if (here < dim - 1) {
                        var sp = index.get(key2 + st);
                        if (sp !== undefined) { qAcc += tmpQ[sp]; wAcc += tmpW[sp]; }
                    }
                    cellQ[c2] = qAcc * 0.25; cellW[c2] = wAcc * 0.25;
                }
            }

            /* ── slice, with the pixel's own contribution removed so the
                  message is from its NEIGHBOURS, as mean field requires ── */
            for (i = 0; i < n; i++) {
                var s2 = cellOf[i];
                var wgt = cellW[s2] - 1;
                msgBil[i] = wgt > 1e-6 ? (cellQ[s2] - Q[i]) / wgt : Q[i];
            }

            /* ── spatial-only kernel: a plain box mean of Q ── */
            smoothBuf.set(Q);
            boxMean(smoothBuf, w, h, smoothR, msgSm, scratch);

            /* ── compatibility (Potts) and update ──
                  E(fg) = U_fg + Σ w·k·Q(bg),  E(bg) = U_bg + Σ w·k·Q(fg)
                  with U from the unary treated as a log-odds prior.        */
            for (i = 0; i < n; i++) {
                var u = clamp01(unary[i]);
                var uFg = -Math.log(Math.max(1e-6, u));
                var uBg = -Math.log(Math.max(1e-6, 1 - u));
                var mFg = wBil * msgBil[i] + wSm * msgSm[i];
                var mBg = wBil * (1 - msgBil[i]) + wSm * (1 - msgSm[i]);
                var eFg = uFg + mBg;   /* labelling fg costs agreeing with bg neighbours */
                var eBg = uBg + mFg;
                var m = Math.min(eFg, eBg);
                var pf = Math.exp(-(eFg - m)), pb = Math.exp(-(eBg - m));
                Q[i] = pf / (pf + pb);
            }
        }
        return Q;
    }

    /* ═══ 9. BACKGROUND ESTIMATION AND UNMIXING ══════════════════════════════

       An edge pixel is a mixture. Compositing it onto white without undoing
       the mixture leaves a rim of the old background — the fringe that makes a
       cutout look like a cutout. Undoing it needs an estimate of B behind the
       subject, which does not exist anywhere in the file, so it is invented:

       pull-push interpolation. Build a pyramid where each level carries a
       colour and the confidence behind it, let the coarse levels fill in what
       the fine levels do not know, then read back down. Confidence here is
       (1−α): pixels that are certainly background speak loudest.

       With B in hand the mixing equation inverts:  F = (C − (1−α)B) / α.      */

    function pullPush(rgb01, weight, w, h) {
        var levelsArr = [];
        var lw = w, lh = h;
        var cw = new Float32Array(w * h), cc = new Float32Array(w * h * 3);
        var i;
        for (i = 0; i < w * h; i++) {
            var wt = weight[i];
            cw[i] = wt;
            cc[i * 3] = rgb01[i * 3] * wt;
            cc[i * 3 + 1] = rgb01[i * 3 + 1] * wt;
            cc[i * 3 + 2] = rgb01[i * 3 + 2] * wt;
        }
        levelsArr.push({ w: lw, h: lh, c: cc, wt: cw });

        /* PULL: 2×2 box down, summing weighted colour and weight.

           ceil, not >>1. Halving an odd dimension by shifting drops its last
           row or column outright, and one dropped column at a coarse level is
           an entire quadrant of the picture — if that is where the only
           confident pixels were, the top of the pyramid ends up with zero
           weight and the whole estimate collapses to black. */
        while (lw > 1 || lh > 1) {
            var nw = Math.max(1, Math.ceil(lw / 2)), nh = Math.max(1, Math.ceil(lh / 2));
            var pc = new Float32Array(nw * nh * 3), pw = new Float32Array(nw * nh);
            var src = levelsArr[levelsArr.length - 1];
            for (var y = 0; y < nh; y++) {
                for (var x = 0; x < nw; x++) {
                    var acc0 = 0, acc1 = 0, acc2 = 0, accw = 0;
                    for (var dy = 0; dy < 2; dy++) {
                        for (var dx = 0; dx < 2; dx++) {
                            var sx = x * 2 + dx, sy = y * 2 + dy;
                            if (sx >= src.w || sy >= src.h) continue;
                            var si = sy * src.w + sx;
                            acc0 += src.c[si * 3]; acc1 += src.c[si * 3 + 1]; acc2 += src.c[si * 3 + 2];
                            accw += src.wt[si];
                        }
                    }
                    var di = y * nw + x;
                    pc[di * 3] = acc0; pc[di * 3 + 1] = acc1; pc[di * 3 + 2] = acc2;
                    pw[di] = accw;
                }
            }
            levelsArr.push({ w: nw, h: nh, c: pc, wt: pw });
            lw = nw; lh = nh;
        }

        /* PUSH: normalise the coarsest level, then blend each finer level's
           own estimate over the upsampled coarse one wherever confidence is
           low. Confidence is capped at 1 so a well-observed pixel is never
           overwritten by its parent. */
        var top = levelsArr[levelsArr.length - 1];
        var cur = new Float32Array(top.w * top.h * 3);
        for (i = 0; i < top.w * top.h; i++) {
            var tw = Math.max(1e-6, top.wt[i]);
            cur[i * 3] = top.c[i * 3] / tw;
            cur[i * 3 + 1] = top.c[i * 3 + 1] / tw;
            cur[i * 3 + 2] = top.c[i * 3 + 2] / tw;
        }
        var curW = top.w, curH = top.h;

        for (var L = levelsArr.length - 2; L >= 0; L--) {
            var lev = levelsArr[L];
            var up = new Float32Array(lev.w * lev.h * 3);
            for (var c = 0; c < 3; c++) {
                var plane = new Float32Array(curW * curH);
                for (i = 0; i < curW * curH; i++) plane[i] = cur[i * 3 + c];
                var big = bilinear(plane, curW, curH, lev.w, lev.h);
                for (i = 0; i < lev.w * lev.h; i++) up[i * 3 + c] = big[i];
            }
            var outc = new Float32Array(lev.w * lev.h * 3);
            for (i = 0; i < lev.w * lev.h; i++) {
                var wgt = Math.min(1, lev.wt[i]);
                for (var c3 = 0; c3 < 3; c3++) {
                    var own = lev.wt[i] > 1e-6 ? lev.c[i * 3 + c3] / lev.wt[i] : 0;
                    outc[i * 3 + c3] = own * wgt + up[i * 3 + c3] * (1 - wgt);
                }
            }
            cur = outc; curW = lev.w; curH = lev.h;
        }
        return cur;
    }

    /* The background hiding behind the subject, invented by interpolating
       inwards from the parts of it that are visible. Kept separate from the
       unmix because it is the only expensive half: B is smooth by
       construction — it is an interpolation — so it can be estimated at the
       working resolution and carried to full size by plain bilinear, while
       the divide that actually needs the exact alpha happens per output pixel. */
    function estimateBackground(rgb01, alpha, w, h) {
        var n = w * h;
        var conf = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            /* Only near-pure background is evidence about what B looks like. */
            var a = alpha[i];
            conf[i] = a < 0.02 ? 1 : a < 0.5 ? (0.5 - a) / 0.48 * 0.35 : 0;
        }
        return pullPush(rgb01, conf, w, h);
    }

    /* Estimate B, then unmix F. `strength` fades the correction in, because a
       full unmix on a noisy alpha is worse than none: the divide by α blows up
       exactly where α is least trustworthy. */
    function decontaminate(rgb01, alpha, w, h, strength, out) {
        var n = w * h, i;
        out = out || new Float32Array(n * 3);
        var B = estimateBackground(rgb01, alpha, w, h);
        for (i = 0; i < n; i++) {
            var a2 = alpha[i], o = i * 3;
            if (a2 >= 0.999 || a2 <= 0.001) {
                out[o] = rgb01[o]; out[o + 1] = rgb01[o + 1]; out[o + 2] = rgb01[o + 2];
                continue;
            }
            var inv = 1 / Math.max(0.06, a2);
            var mix = strength * Math.min(1, a2 * 3);   /* fade in with alpha */
            for (var c = 0; c < 3; c++) {
                var unmixed = (rgb01[o + c] - (1 - a2) * B[o + c]) * inv;
                unmixed = unmixed < 0 ? 0 : unmixed > 1 ? 1 : unmixed;
                out[o + c] = rgb01[o + c] * (1 - mix) + unmixed * mix;
            }
        }
        return out;
    }

    /* Directional despill: push colour off the key's chroma axis without
       touching anything on the other side of it. Done in OKLab so "the green
       axis" means the same thing at every brightness — an RGB despill turns
       shadows muddy because the axis it subtracts along is not perceptual.   */
    function despill(rgb01, w, h, keyRgb, strength, preserveLuma, out) {
        var n = w * h, i;
        out = out || new Float32Array(n * 3);
        var key = CUT.srgbToOklab(keyRgb[0] / 255, keyRgb[1] / 255, keyRgb[2] / 255);
        var kc = Math.hypot(key[1], key[2]);
        if (kc < 1e-5 || strength <= 0) { out.set(rgb01); return out; }
        var kx = key[1] / kc, ky = key[2] / kc;
        var lab = new Float32Array(3), lin = new Float32Array(3);

        for (i = 0; i < n; i++) {
            var o = i * 3;
            CUT.linToOklab(CUT.srgbToLinear(rgb01[o]), CUT.srgbToLinear(rgb01[o + 1]),
                           CUT.srgbToLinear(rgb01[o + 2]), lab, 0);
            var proj = lab[1] * kx + lab[2] * ky;
            if (proj <= 0) { out[o] = rgb01[o]; out[o + 1] = rgb01[o + 1]; out[o + 2] = rgb01[o + 2]; continue; }
            /* Perpendicular chroma is what the pixel would look like with no
               key in it at all; anything beyond that is spill. */
            var perpX = lab[1] - proj * kx, perpY = lab[2] - proj * ky;
            var perp = Math.hypot(perpX, perpY);
            var excess = Math.max(0, proj - perp);
            var cut = excess * strength;
            var L0 = lab[0];
            lab[1] -= cut * kx; lab[2] -= cut * ky;
            CUT.oklabToLin(preserveLuma ? L0 : lab[0], lab[1], lab[2], lin, 0);
            out[o] = clamp01(CUT.linearToSrgb(lin[0]));
            out[o + 1] = clamp01(CUT.linearToSrgb(lin[1]));
            out[o + 2] = clamp01(CUT.linearToSrgb(lin[2]));
        }
        return out;
    }

    /* ═══ 10. MISC ═══════════════════════════════════════════════════════════ */

    function feather(alpha, w, h, r) {
        if (r < 1) return alpha;
        CUT.blurGray(alpha, w, h, r);
        return alpha;
    }

    /* Sharpen the transition without moving it: a smoothstep centred on 0.5
       with a width the caller controls. At width 0 it is a hard threshold. */
    function contrast(alpha, w, h, amount) {
        if (amount <= 0) return alpha;
        var half = Math.max(0.002, 0.5 * (1 - amount));
        for (var i = 0; i < alpha.length; i++) {
            alpha[i] = CUT.smoothstep(0.5 - half, 0.5 + half, alpha[i]);
        }
        return alpha;
    }

    /* Mix a set of engine outputs. Weighted mean by default; `min` is an AND
       (only what every engine agrees on survives) and `max` an OR. */
    function blend(maps, weights, mode) {
        var k = maps.length;
        if (!k) return null;
        var n = maps[0].length;
        var out = new Float32Array(n), i, j;
        if (mode === 'min' || mode === 'max') {
            for (i = 0; i < n; i++) {
                var v = maps[0][i];
                for (j = 1; j < k; j++) v = mode === 'min' ? Math.min(v, maps[j][i]) : Math.max(v, maps[j][i]);
                out[i] = v;
            }
            return out;
        }
        var tot = 0;
        for (j = 0; j < k; j++) tot += weights[j];
        if (tot < 1e-9) { out.fill(0.5); return out; }
        for (i = 0; i < n; i++) {
            var acc = 0;
            for (j = 0; j < k; j++) acc += maps[j][i] * weights[j];
            out[i] = acc / tot;
        }
        return out;
    }

    CUT.edtSq = edtSq;
    CUT.boxMean = boxMean;
    CUT.guidedFilterColor = guidedFilterColor;
    CUT.guidedUpsample = guidedUpsample;
    CUT.guidedCoeffs = guidedCoeffs;
    CUT.applyCoeffsToU8 = applyCoeffsToU8;
    CUT.estimateBackground = estimateBackground;
    CUT.bilinear = bilinear;
    CUT.levels = levels;
    CUT.erode = erode;
    CUT.dilate = dilate;
    CUT.openClose = openClose;
    CUT.components = components;
    CUT.keepBlobs = keepBlobs;
    CUT.fillHoles = fillHoles;
    CUT.shiftEdge = shiftEdge;
    CUT.trimap = trimap;
    CUT.closedFormMatting = closedFormMatting;
    CUT.samplingMatting = samplingMatting;
    CUT.geodesicDistance = geodesicDistance;
    CUT.geodesicMatting = geodesicMatting;
    CUT.denseCRF = denseCRF;
    CUT.pullPush = pullPush;
    CUT.decontaminate = decontaminate;
    CUT.despill = despill;
    CUT.feather = feather;
    CUT.contrast = contrast;
    CUT.blend = blend;
    CUT.TRI = { UNK: UNK, BG: BG, FG: FG };

    if (typeof module !== 'undefined' && module.exports) module.exports = CUT;
})();
