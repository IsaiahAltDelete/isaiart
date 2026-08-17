/* ============================================================================
   CUTOUT — engines.js
   ---------------------------------------------------------------------------
   The part of the machine that decides WHAT is foreground. Nine independent
   opinions, each a pure function of pixels (plus, optionally, the user's
   scribbles), each returning the same thing: a Float32Array of foreground
   probability in 0..1, one entry per pixel, at the working resolution.

   Nothing in this file touches the DOM. That is deliberate — every engine is
   testable head-less, and the self-test at the bottom does exactly that.

   THE ENGINES, and why each one exists:

     border    A background model built from the frame of the picture. Assumes
               the subject does not touch all four edges. Fast, needs nothing.
     chroma    Soft-edged colour keying with inner/outer tolerance shells.
               The only engine that is exact when the shoot was exact.
     ift       Fuzzy connectedness / image foresting transform. Background is
               "whatever you can WALK to from the edge without crossing a
               strong gradient". Bottleneck (minimax) paths, not sums — so a
               slow gradient is free to cross and a hard edge is a wall.
     saliency  Three saliency measures that fail in different ways, averaged:
               frequency-tuned distance from the mean, Hou & Zhang's spectral
               residual, and Cheng's histogram colour contrast.
     slic      Superpixels, then Zhu et al.'s boundary connectivity: a region
               is background to the extent that it spills onto the frame when
               you flood it geodesically. Handles busy backgrounds the border
               model cannot.
     grabcut   The real thing: 5-component full-covariance colour GMMs for
               each label, an 8-connected MRF, and an exact global minimum via
               Boykov–Kolmogorov max-flow. Iterated to convergence.
     plate     Difference against a clean background photograph, with the
               shadow term separated from the colour term.
     manual    Nothing but the user's own scribbles, grown a little.
     neural    (in lab.js — it needs the network) RMBG-1.4 over ONNX.

   ========================================================================= */
(function () {
    'use strict';

    /* globalThis so the same file loads in a page, a worker, and node — the
       self-test at the bottom is only useful if it can run head-less. */
    var ROOT = typeof globalThis !== 'undefined' ? globalThis : this;
    var CUT = ROOT.CUT = ROOT.CUT || {};

    /* ═══ 1. COLOUR ═══════════════════════════════════════════════════════════

       Everything perceptual happens in OKLab. It is the cheapest space in
       which "how different do these two colours look" is a plain Euclidean
       distance, which is the question every engine here is really asking.
       RGB distance would make a dark blue and a dark green look like near
       neighbours and two light greys look far apart.                        */

    var LIN8 = new Float32Array(256);
    for (var _i = 0; _i < 256; _i++) {
        var _c = _i / 255;
        LIN8[_i] = _c <= 0.04045 ? _c / 12.92 : Math.pow((_c + 0.055) / 1.055, 2.4);
    }

    function srgbToLinear(c) {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    function linearToSrgb(c) {
        return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    }

    /* Linear-light RGB → OKLab. Björn Ottosson's matrices, unmodified. */
    function linToOklab(r, g, b, out, o) {
        var l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
        var m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
        var s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
        l = Math.cbrt(l); m = Math.cbrt(m); s = Math.cbrt(s);
        out[o]     = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
        out[o + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
        out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    }

    function oklabToLin(L, a, b, out, o) {
        var l = L + 0.3963377774 * a + 0.2158037573 * b;
        var m = L - 0.1055613458 * a - 0.0638541728 * b;
        var s = L - 0.0894841775 * a - 1.2914855480 * b;
        l = l * l * l; m = m * m * m; s = s * s * s;
        out[o]     =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
        out[o + 1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
        out[o + 2] = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    }

    /* One sRGB triplet (0..1) → OKLab, for keying against a picked colour. */
    function srgbToOklab(r, g, b) {
        var out = new Float32Array(3);
        linToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), out, 0);
        return out;
    }

    function oklabToSrgb(L, a, b) {
        var lin = new Float32Array(3);
        oklabToLin(L, a, b, lin, 0);
        return [
            Math.max(0, Math.min(1, linearToSrgb(lin[0]))),
            Math.max(0, Math.min(1, linearToSrgb(lin[1]))),
            Math.max(0, Math.min(1, linearToSrgb(lin[2])))
        ];
    }

    /* ── The working image ────────────────────────────────────────────────────
       Two representations of the same pixels, both kept because different
       engines want different ones: `rgb` is sRGB 0..255 float (GrabCut's
       constants are calibrated for 8-bit RGB and its GMMs work fine there),
       `lab` is OKLab (everything perceptual).                                */

    function makeImage(imageData) {
        var w = imageData.width, h = imageData.height, n = w * h;
        var d = imageData.data;
        var rgb = new Float32Array(n * 3);
        var lab = new Float32Array(n * 3);
        var lin = new Float32Array(3);
        for (var i = 0, p = 0; i < n; i++, p += 3) {
            var q = i << 2;
            var r8 = d[q], g8 = d[q + 1], b8 = d[q + 2];
            rgb[p] = r8; rgb[p + 1] = g8; rgb[p + 2] = b8;
            lin[0] = LIN8[r8]; lin[1] = LIN8[g8]; lin[2] = LIN8[b8];
            linToOklab(lin[0], lin[1], lin[2], lab, p);
        }
        return { w: w, h: h, n: n, rgb: rgb, lab: lab };
    }

    /* Perceptual distance, with the two axes weighted separately. A green
       screen and a person's skin differ mostly in a/b; a shadow differs only
       in L. Letting the caller dial the ratio is what makes one distance
       function serve both keying and shadow rejection. */
    function labDist(lab, i, j, wL, wC) {
        var p = i * 3, q = j * 3;
        var dL = (lab[p] - lab[q]) * wL;
        var da = (lab[p + 1] - lab[q + 1]) * wC;
        var db = (lab[p + 2] - lab[q + 2]) * wC;
        return Math.sqrt(dL * dL + da * da + db * db);
    }

    /* ═══ 2. SMALL NUMERICS ══════════════════════════════════════════════════ */

    function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

    function smoothstep(e0, e1, x) {
        if (e1 <= e0) return x >= e1 ? 1 : 0;
        var t = clamp01((x - e0) / (e1 - e0));
        return t * t * (3 - 2 * t);
    }

    /* Stretch an array so its 0.5th and 99.5th percentiles land on 0 and 1.
       Percentiles rather than min/max because one blown speculars pixel must
       not be allowed to flatten the whole map. */
    function normalise(a, lo, hi) {
        lo = lo === undefined ? 0.005 : lo;
        hi = hi === undefined ? 0.995 : hi;
        var n = a.length;
        var s = Float32Array.from(a);
        s.sort();
        var vlo = s[Math.min(n - 1, Math.floor(n * lo))];
        var vhi = s[Math.min(n - 1, Math.floor(n * hi))];
        if (vhi - vlo < 1e-9) {
            var flat = vhi > 0 ? 1 : 0;
            for (var i = 0; i < n; i++) a[i] = flat;
            return a;
        }
        var k = 1 / (vhi - vlo);
        for (var j = 0; j < n; j++) a[j] = clamp01((a[j] - vlo) * k);
        return a;
    }

    /* Solve a symmetric 3×3 in place. Used everywhere a colour covariance has
       to be inverted — GMMs, the matting Laplacian, the guided filter. */
    function inv3sym(m00, m01, m02, m11, m12, m22, out) {
        var c00 = m11 * m22 - m12 * m12;
        var c01 = m02 * m12 - m01 * m22;
        var c02 = m01 * m12 - m02 * m11;
        var det = m00 * c00 + m01 * c01 + m02 * c02;
        if (Math.abs(det) < 1e-20) det = det < 0 ? -1e-20 : 1e-20;
        var id = 1 / det;
        out[0] = c00 * id;
        out[1] = c01 * id;
        out[2] = c02 * id;
        out[3] = (m00 * m22 - m02 * m02) * id;
        out[4] = (m01 * m02 - m00 * m12) * id;
        out[5] = (m00 * m11 - m01 * m01) * id;
        return det;
    }

    /* ═══ 3. GAUSSIAN MIXTURE MODEL ══════════════════════════════════════════

       Full covariance, K components, over 3 channels. Initialised by k-means++
       and then refined by hard-assignment EM, which is what GrabCut's original
       formulation actually does: it never needs soft responsibilities, only
       "which component owns this pixel", so the extra cost of soft EM buys
       nothing here.                                                          */

    function GMM(K) {
        this.K = K;
        this.w = new Float64Array(K);
        this.mean = new Float64Array(K * 3);
        this.cov = new Float64Array(K * 6);   /* xx xy xz yy yz zz */
        this.inv = new Float64Array(K * 6);
        this.logDetTerm = new Float64Array(K); /* log(w) − ½·log|Σ| */
        this.live = new Uint8Array(K);
    }

    /* k-means++ seeding over a subsample. Sampling rather than the full set
       because seeding is O(K·N) and N here can be a megapixel; 20k samples
       pins the modes of a colour distribution just as well. */
    GMM.prototype.init = function (data, idx, count, rnd) {
        var K = this.K, i, k, p;
        var maxS = 20000;
        var step = count > maxS ? count / maxS : 1;
        var samples = [];
        for (var t = 0; t < count; t += step) samples.push(idx[t | 0]);
        var S = samples.length;
        if (S === 0) return false;

        var cen = new Float64Array(K * 3);
        var first = samples[(rnd() * S) | 0] * 3;
        cen[0] = data[first]; cen[1] = data[first + 1]; cen[2] = data[first + 2];

        var d2 = new Float64Array(S);
        for (i = 0; i < S; i++) d2[i] = Infinity;

        for (k = 1; k < K; k++) {
            var total = 0;
            for (i = 0; i < S; i++) {
                p = samples[i] * 3;
                var dx = data[p] - cen[(k - 1) * 3];
                var dy = data[p + 1] - cen[(k - 1) * 3 + 1];
                var dz = data[p + 2] - cen[(k - 1) * 3 + 2];
                var dd = dx * dx + dy * dy + dz * dz;
                if (dd < d2[i]) d2[i] = dd;
                total += d2[i];
            }
            /* Pick proportional to squared distance — the ++ in k-means++. */
            var target = rnd() * total, acc = 0, pick = S - 1;
            for (i = 0; i < S; i++) { acc += d2[i]; if (acc >= target) { pick = i; break; } }
            p = samples[pick] * 3;
            cen[k * 3] = data[p]; cen[k * 3 + 1] = data[p + 1]; cen[k * 3 + 2] = data[p + 2];
        }

        /* A handful of Lloyd rounds on the subsample. Full-set refinement
           happens in fit() anyway, so this only has to get the modes roughly
           right. */
        var owner = new Int32Array(S);
        for (var it = 0; it < 8; it++) {
            for (i = 0; i < S; i++) {
                p = samples[i] * 3;
                var best = 0, bd = Infinity;
                for (k = 0; k < K; k++) {
                    var ex = data[p] - cen[k * 3];
                    var ey = data[p + 1] - cen[k * 3 + 1];
                    var ez = data[p + 2] - cen[k * 3 + 2];
                    var e = ex * ex + ey * ey + ez * ez;
                    if (e < bd) { bd = e; best = k; }
                }
                owner[i] = best;
            }
            var acc2 = new Float64Array(K * 3), cnt = new Float64Array(K);
            for (i = 0; i < S; i++) {
                p = samples[i] * 3; k = owner[i];
                acc2[k * 3] += data[p]; acc2[k * 3 + 1] += data[p + 1]; acc2[k * 3 + 2] += data[p + 2];
                cnt[k]++;
            }
            for (k = 0; k < K; k++) {
                if (cnt[k] > 0) {
                    cen[k * 3] = acc2[k * 3] / cnt[k];
                    cen[k * 3 + 1] = acc2[k * 3 + 1] / cnt[k];
                    cen[k * 3 + 2] = acc2[k * 3 + 2] / cnt[k];
                }
            }
        }
        this.mean.set(cen);
        return true;
    };

    /* Assign every listed pixel to its nearest component, then re-estimate.
       `assign` is filled with the component index so callers can reuse it. */
    GMM.prototype.fit = function (data, idx, count, assign, rounds, reg) {
        var K = this.K, i, k, p, tmp = new Float64Array(6);
        reg = reg === undefined ? 1e-3 : reg;
        rounds = rounds === undefined ? 3 : rounds;

        for (var round = 0; round < rounds; round++) {
            var sum = new Float64Array(K * 3);
            var sq = new Float64Array(K * 6);
            var cnt = new Float64Array(K);

            for (var t = 0; t < count; t++) {
                var pi = idx[t]; p = pi * 3;
                var x = data[p], y = data[p + 1], z = data[p + 2];
                var best = 0, bd = Infinity;
                for (k = 0; k < K; k++) {
                    var dx = x - this.mean[k * 3];
                    var dy = y - this.mean[k * 3 + 1];
                    var dz = z - this.mean[k * 3 + 2];
                    var d = dx * dx + dy * dy + dz * dz;
                    if (d < bd) { bd = d; best = k; }
                }
                if (assign) assign[pi] = best;
                k = best;
                sum[k * 3] += x; sum[k * 3 + 1] += y; sum[k * 3 + 2] += z;
                sq[k * 6] += x * x; sq[k * 6 + 1] += x * y; sq[k * 6 + 2] += x * z;
                sq[k * 6 + 3] += y * y; sq[k * 6 + 4] += y * z; sq[k * 6 + 5] += z * z;
                cnt[k]++;
            }

            for (k = 0; k < K; k++) {
                var c = cnt[k];
                if (c < 4) {
                    /* A component nobody claims is switched off rather than
                       left with a singular covariance that would return
                       ±Infinity log-probabilities for every pixel. */
                    this.live[k] = 0;
                    this.w[k] = 0;
                    this.logDetTerm[k] = -1e30;
                    continue;
                }
                this.live[k] = 1;
                this.w[k] = c / count;
                var mx = sum[k * 3] / c, my = sum[k * 3 + 1] / c, mz = sum[k * 3 + 2] / c;
                this.mean[k * 3] = mx; this.mean[k * 3 + 1] = my; this.mean[k * 3 + 2] = mz;
                var c00 = sq[k * 6] / c - mx * mx + reg;
                var c01 = sq[k * 6 + 1] / c - mx * my;
                var c02 = sq[k * 6 + 2] / c - mx * mz;
                var c11 = sq[k * 6 + 3] / c - my * my + reg;
                var c12 = sq[k * 6 + 4] / c - my * mz;
                var c22 = sq[k * 6 + 5] / c - mz * mz + reg;
                this.cov[k * 6] = c00; this.cov[k * 6 + 1] = c01; this.cov[k * 6 + 2] = c02;
                this.cov[k * 6 + 3] = c11; this.cov[k * 6 + 4] = c12; this.cov[k * 6 + 5] = c22;
                var det = inv3sym(c00, c01, c02, c11, c12, c22, tmp);
                for (i = 0; i < 6; i++) this.inv[k * 6 + i] = tmp[i];
                this.logDetTerm[k] = Math.log(Math.max(this.w[k], 1e-12))
                                   - 0.5 * Math.log(Math.max(Math.abs(det), 1e-30));
            }
        }
        return this;
    };

    /* log Σ_k w_k · N(x | μ_k, Σ_k), by the log-sum-exp trick. Returning the
       log rather than the probability matters: GrabCut's data term is the
       negative log-likelihood, and a raw probability underflows to zero for
       any pixel a model has never seen — which is most of them. */
    GMM.prototype.logProb = function (x, y, z) {
        var K = this.K, best = -Infinity, i;
        var q = this._q || (this._q = new Float64Array(this.K));
        for (var k = 0; k < K; k++) {
            if (!this.live[k]) { q[k] = -Infinity; continue; }
            var dx = x - this.mean[k * 3];
            var dy = y - this.mean[k * 3 + 1];
            var dz = z - this.mean[k * 3 + 2];
            var o = k * 6;
            var m = this.inv[o] * dx * dx
                  + 2 * this.inv[o + 1] * dx * dy
                  + 2 * this.inv[o + 2] * dx * dz
                  + this.inv[o + 3] * dy * dy
                  + 2 * this.inv[o + 4] * dy * dz
                  + this.inv[o + 5] * dz * dz;
            var v = this.logDetTerm[k] - 0.5 * m;
            q[k] = v;
            if (v > best) best = v;
        }
        if (best === -Infinity) return -1e30;
        var acc = 0;
        for (i = 0; i < K; i++) if (q[i] > -Infinity) acc += Math.exp(q[i] - best);
        return best + Math.log(acc) - 1.4189385332046727; /* −½·log(2π)·3 folded in */
    };

    /* A tiny deterministic PRNG. Deterministic because a segmentation that
       changes when you press the same button twice is impossible to tune. */
    function mulberry32(seed) {
        var a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* ═══ 4. MAX-FLOW (Boykov–Kolmogorov) ════════════════════════════════════

       The exact minimiser of a binary MRF with submodular pairwise terms is a
       minimum s-t cut, and BK is the algorithm that makes that practical on
       grid graphs: rather than searching for an augmenting path from scratch
       every time, it maintains two search trees and repairs them locally.

       This is a direct transcription of maxflow-v3.0's structure into typed
       arrays. Node and arc fields live in parallel arrays instead of structs;
       an "arc" is an index, and `sister` is its reverse.

       Convention: SOURCE side of the cut = label 1 (foreground).             */

    var NONE = -1, TERMINAL = -2, ORPHAN = -3;

    function MaxFlow(nodeCount, arcCountHint) {
        var n = nodeCount;
        var m = Math.max(8, (arcCountHint | 0) * 2);
        this.n = n;
        this.first = new Int32Array(n).fill(NONE);
        this.trCap = new Float64Array(n);      /* >0: residual s→i, <0: residual i→t */
        this.parent = new Int32Array(n).fill(NONE);
        this.isSink = new Uint8Array(n);
        this.ts = new Int32Array(n);
        this.dist = new Int32Array(n);
        this.inQueue = new Uint8Array(n);

        this.arcHead = new Int32Array(m);
        this.arcNext = new Int32Array(m);
        this.arcCap = new Float64Array(m);
        this.na = 0;
        this.arcCapMax = m;

        this.flow = 0;
        this.time = 0;

        /* Active list: a plain FIFO. Nodes are skipped on pop if their parent
           went away in the meantime, which is what the reference does too. */
        this.q = new Int32Array(n + 8);
        this.qHead = 0; this.qTail = 0; this.qCap = this.q.length;

        /* Orphans need both ends, so a deque over a ring buffer. */
        this.orph = new Int32Array(Math.max(64, n));
        this.oHead = 0; this.oCount = 0;
    }

    MaxFlow.prototype._growArcs = function () {
        var cap = this.arcCapMax * 2;
        var h = new Int32Array(cap); h.set(this.arcHead);
        var nx = new Int32Array(cap); nx.set(this.arcNext);
        var c = new Float64Array(cap); c.set(this.arcCap);
        this.arcHead = h; this.arcNext = nx; this.arcCap = c;
        this.arcCapMax = cap;
    };

    /* Terminal capacities. Called once per node; repeated calls accumulate,
       which is how a data term built from several sources composes. */
    MaxFlow.prototype.addTerminal = function (i, toSource, toSink) {
        var d = this.trCap[i];
        if (d > 0) toSource += d; else toSink -= d;
        this.flow += toSource < toSink ? toSource : toSink;
        this.trCap[i] = toSource - toSink;
    };

    /* An undirected pair. `cap` is i→j, `rev` is j→i; sister arcs are always
       adjacent (2k, 2k+1) so `a ^ 1` is the reverse. */
    MaxFlow.prototype.addEdge = function (i, j, cap, rev) {
        if (this.na + 2 > this.arcCapMax) this._growArcs();
        var a = this.na, b = this.na + 1;
        this.na += 2;
        this.arcHead[a] = j; this.arcNext[a] = this.first[i]; this.first[i] = a; this.arcCap[a] = cap;
        this.arcHead[b] = i; this.arcNext[b] = this.first[j]; this.first[j] = b; this.arcCap[b] = rev;
    };

    MaxFlow.prototype._setActive = function (i) {
        if (this.inQueue[i]) return;
        this.inQueue[i] = 1;
        if (this.qTail === this.qCap) {
            /* Compact rather than grow: the live span is bounded by n. */
            var live = this.qTail - this.qHead;
            this.q.copyWithin(0, this.qHead, this.qTail);
            this.qHead = 0; this.qTail = live;
            if (this.qTail === this.qCap) {
                var bigger = new Int32Array(this.qCap * 2);
                bigger.set(this.q); this.q = bigger; this.qCap = bigger.length;
            }
        }
        this.q[this.qTail++] = i;
    };

    MaxFlow.prototype._nextActive = function () {
        while (this.qHead < this.qTail) {
            var i = this.q[this.qHead++];
            this.inQueue[i] = 0;
            if (this.parent[i] !== NONE) return i;
        }
        return NONE;
    };

    MaxFlow.prototype._orphanFront = function (i) {
        this.parent[i] = ORPHAN;
        if (this.oCount === this.orph.length) this._growOrph();
        this.oHead = (this.oHead - 1 + this.orph.length) % this.orph.length;
        this.orph[this.oHead] = i;
        this.oCount++;
    };

    MaxFlow.prototype._orphanRear = function (i) {
        this.parent[i] = ORPHAN;
        if (this.oCount === this.orph.length) this._growOrph();
        this.orph[(this.oHead + this.oCount) % this.orph.length] = i;
        this.oCount++;
    };

    MaxFlow.prototype._growOrph = function () {
        var L = this.orph.length, bigger = new Int32Array(L * 2);
        for (var k = 0; k < this.oCount; k++) bigger[k] = this.orph[(this.oHead + k) % L];
        this.orph = bigger; this.oHead = 0;
    };

    MaxFlow.prototype._popOrphan = function () {
        var i = this.orph[this.oHead];
        this.oHead = (this.oHead + 1) % this.orph.length;
        this.oCount--;
        return i;
    };

    MaxFlow.prototype._augment = function (mid) {
        var arcCap = this.arcCap, arcHead = this.arcHead, parent = this.parent, trCap = this.trCap;
        var i, a, bottleneck = arcCap[mid];

        /* Bottleneck: walk to the root of each tree. `parent` points from the
           child to the parent, so `arcHead[parent[i]]` is the parent node. */
        i = arcHead[mid ^ 1];
        while ((a = parent[i]) !== TERMINAL) {
            if (arcCap[a ^ 1] < bottleneck) bottleneck = arcCap[a ^ 1];
            i = arcHead[a];
        }
        if (trCap[i] < bottleneck) bottleneck = trCap[i];

        i = arcHead[mid];
        while ((a = parent[i]) !== TERMINAL) {
            if (arcCap[a] < bottleneck) bottleneck = arcCap[a];
            i = arcHead[a];
        }
        if (-trCap[i] < bottleneck) bottleneck = -trCap[i];

        /* Push it. Every arc that saturates orphans the node it fed. */
        arcCap[mid ^ 1] += bottleneck;
        arcCap[mid] -= bottleneck;

        i = arcHead[mid ^ 1];
        while ((a = parent[i]) !== TERMINAL) {
            arcCap[a] += bottleneck;
            arcCap[a ^ 1] -= bottleneck;
            if (arcCap[a ^ 1] <= 0) this._orphanFront(i);
            i = arcHead[a];
        }
        trCap[i] -= bottleneck;
        if (trCap[i] <= 0) this._orphanFront(i);

        i = arcHead[mid];
        while ((a = parent[i]) !== TERMINAL) {
            arcCap[a ^ 1] += bottleneck;
            arcCap[a] -= bottleneck;
            if (arcCap[a] <= 0) this._orphanFront(i);
            i = arcHead[a];
        }
        trCap[i] += bottleneck;
        if (trCap[i] >= 0) this._orphanFront(i);

        this.flow += bottleneck;
    };

    var INF_D = 0x3FFFFFFF;

    MaxFlow.prototype._processOrphan = function (i, sink) {
        var arcCap = this.arcCap, arcHead = this.arcHead, arcNext = this.arcNext;
        var parent = this.parent, isSink = this.isSink, ts = this.ts, dist = this.dist;
        var a0, a, j, d, dMin = INF_D, aMin = NONE;

        for (a0 = this.first[i]; a0 !== NONE; a0 = arcNext[a0]) {
            /* Residual towards i: from the source tree the parent must still be
               able to push INTO i, i.e. the reverse arc has capacity. */
            if (sink ? arcCap[a0] <= 0 : arcCap[a0 ^ 1] <= 0) continue;
            j = arcHead[a0];
            if (isSink[j] !== sink) continue;
            a = parent[j];
            if (a === NONE) continue;

            /* Walk up to check j really still hangs off a terminal, memoising
               depths with the timestamp so the walk is amortised O(1). */
            d = 0;
            var jj = j;
            for (;;) {
                if (ts[jj] === this.time) { d += dist[jj]; break; }
                a = parent[jj];
                d++;
                if (a === TERMINAL) { ts[jj] = this.time; dist[jj] = 1; break; }
                if (a === ORPHAN) { d = INF_D; break; }
                jj = arcHead[a];
            }
            if (d < INF_D) {
                if (d < dMin) { dMin = d; aMin = a0; }
                for (jj = j; ts[jj] !== this.time; jj = arcHead[parent[jj]]) {
                    ts[jj] = this.time; dist[jj] = d--;
                }
            }
        }

        parent[i] = aMin;
        if (aMin !== NONE) {
            ts[i] = this.time;
            dist[i] = dMin + 1;
            return;
        }

        /* No parent survives: everything that leaned on i is an orphan too. */
        for (a0 = this.first[i]; a0 !== NONE; a0 = arcNext[a0]) {
            j = arcHead[a0];
            if (isSink[j] !== sink) continue;
            a = parent[j];
            if (a === NONE) continue;
            if (sink ? arcCap[a0] > 0 : arcCap[a0 ^ 1] > 0) this._setActive(j);
            if (a !== TERMINAL && a !== ORPHAN && arcHead[a] === i) this._orphanRear(j);
        }
    };

    MaxFlow.prototype.run = function () {
        var n = this.n, i, a, j;
        var arcCap = this.arcCap, arcHead = this.arcHead, arcNext = this.arcNext;
        var parent = this.parent, isSink = this.isSink, trCap = this.trCap;

        for (i = 0; i < n; i++) {
            if (trCap[i] !== 0) {
                isSink[i] = trCap[i] < 0 ? 1 : 0;
                parent[i] = TERMINAL;
                this.ts[i] = 0;
                this.dist[i] = 1;
                this._setActive(i);
            } else {
                parent[i] = NONE;
            }
        }

        var current = NONE;
        for (;;) {
            i = current;
            if (i !== NONE) {
                this.inQueue[i] = 0;
                if (parent[i] === NONE) i = NONE;
            }
            if (i === NONE) {
                i = this._nextActive();
                if (i === NONE) break;
            }

            /* GROW */
            var found = NONE;
            var sink = isSink[i];
            for (a = this.first[i]; a !== NONE; a = arcNext[a]) {
                if (sink ? arcCap[a ^ 1] <= 0 : arcCap[a] <= 0) continue;
                j = arcHead[a];
                if (parent[j] === NONE) {
                    isSink[j] = sink;
                    parent[j] = a ^ 1;
                    this.ts[j] = this.ts[i];
                    this.dist[j] = this.dist[i] + 1;
                    this._setActive(j);
                } else if (isSink[j] !== sink) {
                    /* The two trees touched. `found` must always be oriented
                       source→sink, so flip it when i is on the sink side. */
                    found = sink ? (a ^ 1) : a;
                    break;
                } else if (this.ts[j] <= this.ts[i] && this.dist[j] > this.dist[i]) {
                    parent[j] = a ^ 1;
                    this.ts[j] = this.ts[i];
                    this.dist[j] = this.dist[i] + 1;
                }
            }

            this.time++;

            if (found !== NONE) {
                current = i;
                this._augment(found);
                while (this.oCount > 0) {
                    var o = this._popOrphan();
                    this._processOrphan(o, isSink[o]);
                }
            } else {
                current = NONE;
            }
        }
        return this.flow;
    };

    /* After run(): true when the node ended on the source side. A node the
       search never reached belongs to the sink side, matching BK's own
       `what_segment` default. */
    MaxFlow.prototype.inSource = function (i) {
        return this.parent[i] !== NONE && this.isSink[i] === 0;
    };

    /* ═══ 5. ENGINE: BORDER PRIOR ════════════════════════════════════════════

       Two colour models — one learned from the frame of the picture, one from
       whatever the frame model finds least likely — and a posterior between
       them. The self-bootstrapping second model is what lets this cope with a
       subject that shares a colour family with its background: the frame model
       alone would call the whole picture background.                          */

    function engineBorder(img, opt) {
        opt = opt || {};
        var w = img.w, h = img.h, n = img.n, rgb = img.rgb;
        var band = Math.max(2, Math.round(Math.min(w, h) * (opt.band === undefined ? 0.06 : opt.band)));
        var K = opt.components || 5;
        var rnd = mulberry32(0x5EED);

        /* Which edges to trust. A subject cropped at the bottom (a portrait,
           almost always) makes the bottom edge a liar, so the caller can turn
           edges off individually. */
        var useT = opt.top !== false, useB = opt.bottom !== false;
        var useL = opt.left !== false, useR = opt.right !== false;

        var bgIdx = new Int32Array(n), bc = 0;
        var x, y, i;
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) {
                var onEdge = (useT && y < band) || (useB && y >= h - band) ||
                             (useL && x < band) || (useR && x >= w - band);
                if (onEdge) bgIdx[bc++] = y * w + x;
            }
        }
        var out = new Float32Array(n);
        if (bc < 32) { out.fill(0.5); return out; }

        var bg = new GMM(K);
        bg.init(rgb, bgIdx, bc, rnd);
        bg.fit(rgb, bgIdx, bc, null, 4);

        /* Score every pixel against the frame model, then take the least
           frame-like third of the picture as the foreground training set. */
        var bgLL = new Float32Array(n);
        for (i = 0; i < n; i++) bgLL[i] = bg.logProb(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);

        var sorted = Float32Array.from(bgLL);
        sorted.sort();
        var cut = sorted[Math.floor(n * (opt.fgQuantile === undefined ? 0.35 : opt.fgQuantile))];
        var fgIdx = new Int32Array(n), fc = 0;
        for (i = 0; i < n; i++) if (bgLL[i] <= cut) fgIdx[fc++] = i;
        if (fc < 64) { for (i = 0; i < n; i++) out[i] = 0; return out; }

        var fg = new GMM(K);
        fg.init(rgb, fgIdx, fc, rnd);
        fg.fit(rgb, fgIdx, fc, null, 4);

        var bias = opt.bias === undefined ? 0 : opt.bias;   /* −1 … +1 */
        var temp = opt.sharpness === undefined ? 1 : Math.max(0.05, opt.sharpness);
        for (i = 0; i < n; i++) {
            var p = i * 3;
            var lf = fg.logProb(rgb[p], rgb[p + 1], rgb[p + 2]);
            var lb = bgLL[i];
            out[i] = 1 / (1 + Math.exp(-((lf - lb) * temp + bias * 6)));
        }
        return out;
    }

    /* ═══ 6. ENGINE: CHROMA KEY ══════════════════════════════════════════════

       A soft key with two shells. Inside the inner radius the pixel is pure
       background; outside the outer radius it is pure subject; between them
       the alpha ramps, which is where hair and motion blur live.

       Distance is measured in OKLab with the chroma and lightness axes scaled
       independently, because that ratio IS the control a compositor wants: a
       high chroma weight keys the screen colour and forgives a shadow gradient
       across it; a high lightness weight does the opposite.                   */

    function engineChroma(img, opt) {
        opt = opt || {};
        var n = img.n, lab = img.lab;
        var keys = opt.keys && opt.keys.length ? opt.keys : [autoKey(img)];
        var inner = opt.inner === undefined ? 0.06 : opt.inner;
        var outer = opt.outer === undefined ? 0.20 : opt.outer;
        if (outer <= inner) outer = inner + 1e-4;
        var wC = opt.chromaWeight === undefined ? 1 : opt.chromaWeight;
        var wL = opt.lumaWeight === undefined ? 0.5 : opt.lumaWeight;

        var out = new Float32Array(n);
        var K = keys.length;
        var kl = new Float32Array(K * 3);
        for (var k = 0; k < K; k++) {
            var c = keys[k];
            var o = srgbToOklab(c[0] / 255, c[1] / 255, c[2] / 255);
            kl[k * 3] = o[0]; kl[k * 3 + 1] = o[1]; kl[k * 3 + 2] = o[2];
        }

        for (var i = 0; i < n; i++) {
            var p = i * 3, dmin = Infinity;
            for (var j = 0; j < K; j++) {
                var q = j * 3;
                var dL = (lab[p] - kl[q]) * wL;
                var da = (lab[p + 1] - kl[q + 1]) * wC;
                var db = (lab[p + 2] - kl[q + 2]) * wC;
                var d = Math.sqrt(dL * dL + da * da + db * db);
                if (d < dmin) dmin = d;
            }
            out[i] = smoothstep(inner, outer, dmin);
        }
        return out;
    }

    /* The most common colour along the frame, found by a coarse 3-D histogram
       and then refined to the mean of its bin. Bin-then-average rather than a
       plain mean because the mean of a green screen and a black stand is a
       colour that appears nowhere in the picture. */
    function autoKey(img) {
        var w = img.w, h = img.h, rgb = img.rgb;
        var band = Math.max(2, Math.round(Math.min(w, h) * 0.05));
        var BINS = 12, B3 = BINS * BINS * BINS;
        var hist = new Int32Array(B3);
        var sum = new Float64Array(B3 * 3);
        var x, y, i, p, bi;
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) {
                if (!(y < band || y >= h - band || x < band || x >= w - band)) continue;
                i = y * w + x; p = i * 3;
                bi = (Math.min(BINS - 1, (rgb[p] * BINS / 256) | 0) * BINS * BINS)
                   + (Math.min(BINS - 1, (rgb[p + 1] * BINS / 256) | 0) * BINS)
                   + Math.min(BINS - 1, (rgb[p + 2] * BINS / 256) | 0);
                hist[bi]++;
                sum[bi * 3] += rgb[p]; sum[bi * 3 + 1] += rgb[p + 1]; sum[bi * 3 + 2] += rgb[p + 2];
            }
        }
        var best = 0, bc = -1;
        for (i = 0; i < B3; i++) if (hist[i] > bc) { bc = hist[i]; best = i; }
        if (bc <= 0) return [0, 0, 0];
        return [sum[best * 3] / bc, sum[best * 3 + 1] / bc, sum[best * 3 + 2] / bc];
    }

    /* ═══ 7. ENGINE: FUZZY CONNECTEDNESS (IFT) ═══════════════════════════════

       Segmentation as a walking problem. Between neighbouring pixels there is
       an AFFINITY — high when they look alike. The connectedness of a pixel to
       a seed is the strength of the WEAKEST link on the best path between
       them: a bottleneck, not a sum. That single choice is why this handles
       things the other engines cannot. A background that fades from white to
       grey across the frame is one long chain of strong links, so it is fully
       connected and comes out whole; a subject separated from it by one hard
       edge is cut off no matter how similar its colour is elsewhere.

       Computed with Dijkstra over a bucketed priority queue (costs are
       quantised to 1024 levels, so the queue is O(1) per operation and the
       whole thing is linear). With seeds on both sides it becomes RELATIVE
       fuzzy connectedness: α = cF / (cF + cB), which is soft by construction. */

    var IFT_LEVELS = 1024;

    function bottleneckFrom(img, seeds, seedCount, sigma, wL, wC, connect8) {
        var w = img.w, h = img.h, n = img.n, lab = img.lab;
        /* cost[i] = 1 − connectedness. Minimised over the max edge cost on a
           path, so an unreachable pixel keeps IFT_LEVELS. */
        var cost = new Int32Array(n).fill(IFT_LEVELS);
        var done = new Uint8Array(n);
        var buckets = new Array(IFT_LEVELS + 1);
        var i;
        for (i = 0; i <= IFT_LEVELS; i++) buckets[i] = [];

        for (i = 0; i < seedCount; i++) { cost[seeds[i]] = 0; buckets[0].push(seeds[i]); }

        var inv2s2 = 1 / (2 * sigma * sigma);
        var dx8 = [1, -1, 0, 0, 1, 1, -1, -1];
        var dy8 = [0, 0, 1, -1, 1, -1, 1, -1];
        var deg = connect8 ? 8 : 4;

        for (var level = 0; level <= IFT_LEVELS; level++) {
            var b = buckets[level];
            for (var bi = 0; bi < b.length; bi++) {
                var p = b[bi];
                if (done[p] || cost[p] !== level) continue;
                done[p] = 1;
                var px = p % w, py = (p / w) | 0;
                for (var k = 0; k < deg; k++) {
                    var qx = px + dx8[k], qy = py + dy8[k];
                    if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
                    var q = qy * w + qx;
                    if (done[q]) continue;
                    var d = labDist(lab, p, q, wL, wC);
                    /* affinity = exp(−d²/2σ²); edge cost is 1 − affinity. */
                    var ec = (1 - Math.exp(-d * d * inv2s2)) * IFT_LEVELS;
                    var nc = Math.max(level, Math.round(ec));
                    if (nc < cost[q]) {
                        cost[q] = nc;
                        /* Never below the current level — that is what keeps
                           the bucket sweep monotone and the queue O(1). */
                        buckets[nc < level ? level : nc].push(q);
                    }
                }
            }
            /* Release as we go; a megapixel of arrays is worth reclaiming. */
            buckets[level] = null;
        }

        var conn = new Float32Array(n);
        for (i = 0; i < n; i++) conn[i] = 1 - cost[i] / IFT_LEVELS;
        return conn;
    }

    /* The additive sibling of bottleneckFrom: total cost along the path
       instead of the worst link on it. Solved by chamfer raster scans, which
       converge to the true geodesic in a handful of sweeps and cost a fraction
       of a priority queue.

       The two metrics fail in opposite directions, which is why both are here.
       Bottleneck is scale-free — a wall is a wall however far away it is — so
       it is the right answer when you only have background seeds and want the
       flood to stop at the subject's outline. But it SATURATES: once two seed
       sets can both reach a pixel over strong links, their scores are both
       ~1 and the ratio between them carries no information. Additive cost
       never saturates; distance keeps accumulating, so even across a
       low-contrast boundary the nearer seed set still wins.                  */
    function geodesicFrom(img, seeds, seedCount, gamma, wL, wC, passes) {
        var w = img.w, h = img.h, n = img.n, lab = img.lab;
        var d = new Float64Array(n), i;
        for (i = 0; i < n; i++) d[i] = 1e18;
        for (i = 0; i < seedCount; i++) d[seeds[i]] = 0;
        var SQ2 = Math.SQRT2;

        function step(a, b, len) {
            return len * (1 + gamma * labDist(lab, a, b, wL, wC));
        }

        for (var pass = 0; pass < (passes || 3); pass++) {
            var x, y, p, best;
            for (y = 0; y < h; y++) {
                for (x = 0; x < w; x++) {
                    p = y * w + x; best = d[p];
                    if (x > 0) best = Math.min(best, d[p - 1] + step(p, p - 1, 1));
                    if (y > 0) best = Math.min(best, d[p - w] + step(p, p - w, 1));
                    if (y > 0 && x > 0) best = Math.min(best, d[p - w - 1] + step(p, p - w - 1, SQ2));
                    if (y > 0 && x < w - 1) best = Math.min(best, d[p - w + 1] + step(p, p - w + 1, SQ2));
                    d[p] = best;
                }
            }
            for (y = h - 1; y >= 0; y--) {
                for (x = w - 1; x >= 0; x--) {
                    p = y * w + x; best = d[p];
                    if (x < w - 1) best = Math.min(best, d[p + 1] + step(p, p + 1, 1));
                    if (y < h - 1) best = Math.min(best, d[p + w] + step(p, p + w, 1));
                    if (y < h - 1 && x < w - 1) best = Math.min(best, d[p + w + 1] + step(p, p + w + 1, SQ2));
                    if (y < h - 1 && x > 0) best = Math.min(best, d[p + w - 1] + step(p, p + w - 1, SQ2));
                    d[p] = best;
                }
            }
        }
        return d;
    }

    function engineIFT(img, opt) {
        opt = opt || {};
        var w = img.w, h = img.h, n = img.n;
        var sigma = opt.sigma === undefined ? 0.09 : Math.max(0.005, opt.sigma);
        var wL = opt.lumaWeight === undefined ? 1 : opt.lumaWeight;
        var wC = opt.chromaWeight === undefined ? 1.4 : opt.chromaWeight;
        var connect8 = opt.connect8 !== false;
        var hasFg = !!(opt.fgSeeds && opt.fgSeeds.length);

        /* auto: bottleneck when only the frame seeds the flood, additive when
           the user has marked both sides and the ratio is what matters. */
        var metric = opt.metric || 'auto';
        if (metric === 'auto') metric = hasFg ? 'geodesic' : 'bottleneck';

        /* Background seeds: the user's, else the frame. */
        var bgSeeds, bgCount;
        if (opt.bgSeeds && opt.bgSeeds.length) {
            bgSeeds = opt.bgSeeds; bgCount = opt.bgSeeds.length;
        } else {
            bgSeeds = new Int32Array(2 * (w + h));
            bgCount = 0;
            for (var x = 0; x < w; x++) { bgSeeds[bgCount++] = x; bgSeeds[bgCount++] = (h - 1) * w + x; }
            for (var y = 0; y < h; y++) { bgSeeds[bgCount++] = y * w; bgSeeds[bgCount++] = y * w + w - 1; }
        }

        var out = new Float32Array(n), i, g = opt.gamma === undefined ? 1 : Math.max(0.1, opt.gamma);

        if (metric === 'geodesic') {
            /* 1/σ is the exchange rate between a step of distance and a step
               of colour, so the same σ slider drives both metrics. */
            var gam = 1 / sigma;
            var dB = geodesicFrom(img, bgSeeds, bgCount, gam, wL, wC, opt.passes || 3);
            if (hasFg) {
                var dF = geodesicFrom(img, opt.fgSeeds, opt.fgSeeds.length, gam, wL, wC, opt.passes || 3);
                for (i = 0; i < n; i++) {
                    var s = dF[i] + dB[i];
                    out[i] = s < 1e-9 ? 0.5 : dB[i] / s;
                }
            } else {
                for (i = 0; i < n; i++) out[i] = dB[i];
                normalise(out, 0.02, 0.98);
                for (i = 0; i < n; i++) out[i] = Math.pow(out[i], g);
            }
            return out;
        }

        var cB = bottleneckFrom(img, bgSeeds, bgCount, sigma, wL, wC, connect8);
        if (hasFg) {
            var cF = bottleneckFrom(img, opt.fgSeeds, opt.fgSeeds.length, sigma, wL, wC, connect8);
            for (i = 0; i < n; i++) {
                var s2 = cF[i] + cB[i];
                out[i] = s2 < 1e-6 ? 0.5 : cF[i] / s2;
            }
        } else {
            /* One-sided: foreground is what the background could not reach.

               Then STRETCHED, which is not cosmetic. The raw number is one
               minus the affinity of the single weakest link on the whole
               perimeter, and that is a terrible probability scale: a subject
               walled off by a clean edge and a subject walled off by a merely
               decent one both read as "inside", but the first scores 0.97 and
               the second 0.17, so a fixed ½ threshold turns a working
               segmentation into an empty one over a hair's width of σ. What
               the map actually carries is the ORDER of the values, not their
               magnitudes, so rescaling the observed range onto 0..1 is the
               honest reading of it — and it makes σ a control you tune rather
               than a cliff you fall off.

               normalise() collapses to a constant when there is no range to
               stretch, so a picture with nothing in it stays empty rather
               than having its noise amplified into a mask. */
            for (i = 0; i < n; i++) out[i] = 1 - cB[i];
            normalise(out, 0.02, 0.98);
            if (g !== 1) for (i = 0; i < n; i++) out[i] = Math.pow(out[i], g);
        }
        return out;
    }

    /* ═══ 8. ENGINE: SALIENCY ════════════════════════════════════════════════ */

    /* In-place iterative radix-2 FFT over separate re/im arrays. */
    function fft1d(re, im, n, inverse) {
        var i, j = 0, k, m, step;
        for (i = 1; i < n; i++) {
            var bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                var tr = re[i]; re[i] = re[j]; re[j] = tr;
                var ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        for (m = 2; m <= n; m <<= 1) {
            var ang = (inverse ? 2 : -2) * Math.PI / m;
            var wr = Math.cos(ang), wi = Math.sin(ang);
            for (i = 0; i < n; i += m) {
                var cr = 1, ci = 0;
                for (k = 0; k < (m >> 1); k++) {
                    var ar = re[i + k], ai = im[i + k];
                    var br = re[i + k + (m >> 1)], bi2 = im[i + k + (m >> 1)];
                    var xr = br * cr - bi2 * ci, xi = br * ci + bi2 * cr;
                    re[i + k] = ar + xr; im[i + k] = ai + xi;
                    re[i + k + (m >> 1)] = ar - xr; im[i + k + (m >> 1)] = ai - xi;
                    var ncr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr; cr = ncr;
                }
            }
        }
        if (inverse) for (i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
        step = 0; /* quiet linters about the unused hoisted var */
        return step;
    }

    function fft2d(re, im, w, h, inverse) {
        var rowR = new Float64Array(w), rowI = new Float64Array(w);
        var colR = new Float64Array(h), colI = new Float64Array(h);
        var x, y;
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) { rowR[x] = re[y * w + x]; rowI[x] = im[y * w + x]; }
            fft1d(rowR, rowI, w, inverse);
            for (x = 0; x < w; x++) { re[y * w + x] = rowR[x]; im[y * w + x] = rowI[x]; }
        }
        for (x = 0; x < w; x++) {
            for (y = 0; y < h; y++) { colR[y] = re[y * w + x]; colI[y] = im[y * w + x]; }
            fft1d(colR, colI, h, inverse);
            for (y = 0; y < h; y++) { re[y * w + x] = colR[y]; im[y * w + x] = colI[y]; }
        }
    }

    /* Nearest-neighbour resample of a single channel. Good enough: everything
       downstream of it is blurred anyway. */
    function resampleGray(src, sw, sh, dw, dh) {
        var out = new Float32Array(dw * dh);
        for (var y = 0; y < dh; y++) {
            var sy = Math.min(sh - 1, ((y + 0.5) * sh / dh) | 0);
            for (var x = 0; x < dw; x++) {
                var sx = Math.min(sw - 1, ((x + 0.5) * sw / dw) | 0);
                out[y * dw + x] = src[sy * sw + sx];
            }
        }
        return out;
    }

    /* Hou & Zhang 2007: the log-amplitude spectrum of natural images is
       roughly 1/f, so whatever a particular picture has ABOVE that average is
       its unusual content. Subtract the smoothed log-amplitude, keep the
       phase, transform back, and the bright parts are the odd parts. */
    function spectralResidual(gray, w, h, size) {
        var s = size || 64;
        var small = resampleGray(gray, w, h, s, s);
        var re = new Float64Array(s * s), im = new Float64Array(s * s), i;
        for (i = 0; i < s * s; i++) re[i] = small[i];
        fft2d(re, im, s, s, false);

        var logAmp = new Float64Array(s * s), phR = new Float64Array(s * s), phI = new Float64Array(s * s);
        for (i = 0; i < s * s; i++) {
            var amp = Math.hypot(re[i], im[i]);
            logAmp[i] = Math.log(amp + 1e-8);
            if (amp < 1e-12) { phR[i] = 1; phI[i] = 0; }
            else { phR[i] = re[i] / amp; phI[i] = im[i] / amp; }
        }

        /* 3×3 mean of the log spectrum — the "average natural image". */
        var avg = new Float64Array(s * s);
        for (var y = 0; y < s; y++) {
            for (var x = 0; x < s; x++) {
                var acc = 0, cnt = 0;
                for (var dy = -1; dy <= 1; dy++) {
                    for (var dx = -1; dx <= 1; dx++) {
                        var yy = y + dy, xx = x + dx;
                        if (yy < 0 || xx < 0 || yy >= s || xx >= s) continue;
                        acc += logAmp[yy * s + xx]; cnt++;
                    }
                }
                avg[y * s + x] = acc / cnt;
            }
        }

        for (i = 0; i < s * s; i++) {
            var r = Math.exp(logAmp[i] - avg[i]);
            re[i] = r * phR[i];
            im[i] = r * phI[i];
        }
        fft2d(re, im, s, s, true);

        var sal = new Float32Array(s * s);
        for (i = 0; i < s * s; i++) sal[i] = re[i] * re[i] + im[i] * im[i];
        blurGray(sal, s, s, 3);
        normalise(sal, 0.01, 0.99);
        return resampleGray(sal, s, s, w, h);
    }

    /* Separable box blur run three times ≈ a Gaussian, and it is O(n) in the
       radius rather than O(r·n). */
    function blurGray(a, w, h, r) {
        if (r < 1) return a;
        var tmp = new Float32Array(a.length);
        for (var pass = 0; pass < 3; pass++) {
            boxH(a, tmp, w, h, r);
            boxV(tmp, a, w, h, r);
        }
        return a;
    }

    function boxH(src, dst, w, h, r) {
        var inv, x, y, acc, o;
        for (y = 0; y < h; y++) {
            o = y * w;
            acc = 0;
            for (x = -r; x <= r; x++) acc += src[o + Math.min(w - 1, Math.max(0, x))];
            inv = 1 / (2 * r + 1);
            for (x = 0; x < w; x++) {
                dst[o + x] = acc * inv;
                acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
            }
        }
    }

    function boxV(src, dst, w, h, r) {
        var inv = 1 / (2 * r + 1), x, y, acc;
        for (x = 0; x < w; x++) {
            acc = 0;
            for (y = -r; y <= r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x];
            for (y = 0; y < h; y++) {
                dst[y * w + x] = acc * inv;
                acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
            }
        }
    }

    function engineSaliency(img, opt) {
        opt = opt || {};
        var w = img.w, h = img.h, n = img.n, lab = img.lab;
        var out = new Float32Array(n), i, p;

        /* (a) Frequency-tuned (Achanta 2009): distance from the image's own
               mean colour, measured on a slightly blurred copy. */
        var ft = new Float32Array(n);
        var mL = 0, mA = 0, mB = 0;
        for (i = 0; i < n; i++) { p = i * 3; mL += lab[p]; mA += lab[p + 1]; mB += lab[p + 2]; }
        mL /= n; mA /= n; mB /= n;
        var sm = new Float32Array(n * 3);
        for (var c = 0; c < 3; c++) {
            var ch = new Float32Array(n);
            for (i = 0; i < n; i++) ch[i] = lab[i * 3 + c];
            blurGray(ch, w, h, Math.max(1, Math.round(Math.min(w, h) * 0.01)));
            for (i = 0; i < n; i++) sm[i * 3 + c] = ch[i];
        }
        for (i = 0; i < n; i++) {
            p = i * 3;
            var dL = sm[p] - mL, da = sm[p + 1] - mA, db = sm[p + 2] - mB;
            ft[i] = Math.sqrt(dL * dL + da * da + db * db);
        }
        normalise(ft);

        /* (b) Spectral residual, on luminance. */
        var gray = new Float32Array(n);
        for (i = 0; i < n; i++) gray[i] = lab[i * 3];
        var sr = spectralResidual(gray, w, h, 64);

        /* (c) Histogram colour contrast (Cheng 2011): a colour is salient in
               proportion to how far it sits from every other colour in the
               picture, weighted by how common each of those is. Quantising to
               a 12³ palette turns an O(n²) idea into an O(bins²) one. */
        var hc = histContrast(img, 12);

        var wFt = opt.wFt === undefined ? 1 : opt.wFt;
        var wSr = opt.wSr === undefined ? 1 : opt.wSr;
        var wHc = opt.wHc === undefined ? 1 : opt.wHc;
        var wCentre = opt.centre === undefined ? 0.35 : opt.centre;
        var sum = wFt + wSr + wHc || 1;

        var cx = (w - 1) / 2, cy = (h - 1) / 2;
        var rx = 1 / (w * 0.55), ry = 1 / (h * 0.55);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                i = y * w + x;
                var v = (ft[i] * wFt + sr[i] * wSr + hc[i] * wHc) / sum;
                if (wCentre > 0) {
                    var ex = (x - cx) * rx, ey = (y - cy) * ry;
                    var g = Math.exp(-(ex * ex + ey * ey) * 0.5);
                    v = v * (1 - wCentre) + v * g * wCentre;
                }
                out[i] = v;
            }
        }
        normalise(out, 0.02, 0.98);
        return out;
    }

    function histContrast(img, BINS) {
        var n = img.n, rgb = img.rgb, lab = img.lab;
        var B3 = BINS * BINS * BINS;
        var hist = new Int32Array(B3);
        var accL = new Float64Array(B3), accA = new Float64Array(B3), accB = new Float64Array(B3);
        var bin = new Int32Array(n), i, p;
        for (i = 0; i < n; i++) {
            p = i * 3;
            var b = (Math.min(BINS - 1, (rgb[p] * BINS / 256) | 0) * BINS * BINS)
                  + (Math.min(BINS - 1, (rgb[p + 1] * BINS / 256) | 0) * BINS)
                  + Math.min(BINS - 1, (rgb[p + 2] * BINS / 256) | 0);
            bin[i] = b; hist[b]++;
            accL[b] += lab[p]; accA[b] += lab[p + 1]; accB[b] += lab[p + 2];
        }
        /* Keep the bins that cover 95% of the picture; the tail is noise and
           it is quadratic to carry. */
        var order = [];
        for (i = 0; i < B3; i++) if (hist[i]) order.push(i);
        order.sort(function (a, b) { return hist[b] - hist[a]; });
        var keep = [], covered = 0, need = n * 0.95;
        for (i = 0; i < order.length; i++) {
            keep.push(order[i]); covered += hist[order[i]];
            if (covered >= need) break;
        }
        var M = keep.length;
        var kL = new Float64Array(M), kA = new Float64Array(M), kB = new Float64Array(M), kN = new Float64Array(M);
        var remap = new Int32Array(B3).fill(-1);
        for (i = 0; i < M; i++) {
            var b2 = keep[i]; remap[b2] = i;
            kN[i] = hist[b2];
            kL[i] = accL[b2] / hist[b2]; kA[i] = accA[b2] / hist[b2]; kB[i] = accB[b2] / hist[b2];
        }
        var sal = new Float64Array(M);
        for (i = 0; i < M; i++) {
            var s = 0;
            for (var j = 0; j < M; j++) {
                if (i === j) continue;
                var dL = kL[i] - kL[j], da = kA[i] - kA[j], db = kB[i] - kB[j];
                s += kN[j] * Math.sqrt(dL * dL + da * da + db * db);
            }
            sal[i] = s / n;
        }
        /* Cheng's colour-space smoothing: replace each colour's saliency with
           a distance-weighted mean of its m nearest colours, which stops
           quantisation seams showing up as banding in the map. */
        var m = Math.max(2, Math.round(M * 0.25));
        var smoothed = new Float64Array(M);
        var dists = new Array(M);
        for (i = 0; i < M; i++) {
            dists.length = 0;
            for (var j2 = 0; j2 < M; j2++) {
                var eL = kL[i] - kL[j2], ea = kA[i] - kA[j2], eb = kB[i] - kB[j2];
                dists.push([Math.sqrt(eL * eL + ea * ea + eb * eb), j2]);
            }
            dists.sort(function (a, b) { return a[0] - b[0]; });
            var tot = 0, acc = 0;
            for (var t = 0; t < m; t++) tot += dists[t][0];
            if (tot < 1e-9) { smoothed[i] = sal[i]; continue; }
            for (var t2 = 0; t2 < m; t2++) {
                var wgt = (tot - dists[t2][0]);
                acc += wgt * sal[dists[t2][1]];
            }
            smoothed[i] = acc / (tot * (m - 1));
        }
        var out = new Float32Array(n);
        for (i = 0; i < n; i++) {
            var r = remap[bin[i]];
            out[i] = r >= 0 ? smoothed[r] : 0;
        }
        normalise(out, 0.01, 0.99);
        return out;
    }

    /* ═══ 9. ENGINE: SLIC + BOUNDARY CONNECTIVITY ════════════════════════════ */

    /* SLIC (Achanta 2012): k-means in (L, a, b, x, y) where the search for
       each centre is confined to a 2S×2S window. That confinement is the whole
       trick — it turns k-means from O(K·N) per round into O(N).             */
    function slic(img, K, compactness, rounds) {
        var w = img.w, h = img.h, n = img.n, lab = img.lab;
        var S = Math.max(2, Math.sqrt(n / K) | 0);
        var gx = Math.max(1, Math.round(w / S)), gy = Math.max(1, Math.round(h / S));
        var count = gx * gy;
        var cl = new Float32Array(count), ca = new Float32Array(count), cb = new Float32Array(count);
        var cx = new Float32Array(count), cy = new Float32Array(count);
        var i, k, x, y;

        for (var j = 0; j < gy; j++) {
            for (var iy = 0; iy < gx; iy++) {
                k = j * gx + iy;
                x = Math.min(w - 1, Math.round((iy + 0.5) * w / gx));
                y = Math.min(h - 1, Math.round((j + 0.5) * h / gy));
                /* Nudge off an edge: a centre that starts on a boundary tends
                   to sit there for good and split a region in two. */
                var bestG = Infinity, bx = x, by = y;
                for (var oy = -1; oy <= 1; oy++) {
                    for (var ox = -1; ox <= 1; ox++) {
                        var px2 = Math.min(w - 2, Math.max(1, x + ox));
                        var py2 = Math.min(h - 2, Math.max(1, y + oy));
                        var idx = py2 * w + px2;
                        var g = labDist(lab, idx + 1, idx - 1, 1, 1) + labDist(lab, idx + w, idx - w, 1, 1);
                        if (g < bestG) { bestG = g; bx = px2; by = py2; }
                    }
                }
                var o = (by * w + bx) * 3;
                cl[k] = lab[o]; ca[k] = lab[o + 1]; cb[k] = lab[o + 2];
                cx[k] = bx; cy[k] = by;
            }
        }

        var owner = new Int32Array(n).fill(-1);
        var dist = new Float32Array(n).fill(Infinity);
        /* m/S with m the compactness: the exchange rate between "looks alike"
           and "is nearby". OKLab distances are ~0..1, not CIELab's 0..100, so
           the usual m=10 becomes ~0.1 here. */
        var mS = (compactness / S);

        for (var round = 0; round < rounds; round++) {
            dist.fill(Infinity);
            for (k = 0; k < count; k++) {
                var x0 = Math.max(0, Math.round(cx[k]) - S), x1 = Math.min(w - 1, Math.round(cx[k]) + S);
                var y0 = Math.max(0, Math.round(cy[k]) - S), y1 = Math.min(h - 1, Math.round(cy[k]) + S);
                for (y = y0; y <= y1; y++) {
                    for (x = x0; x <= x1; x++) {
                        i = y * w + x;
                        var p = i * 3;
                        var dl = lab[p] - cl[k], da = lab[p + 1] - ca[k], db = lab[p + 2] - cb[k];
                        var dxp = x - cx[k], dyp = y - cy[k];
                        var d = Math.sqrt(dl * dl + da * da + db * db)
                              + mS * Math.sqrt(dxp * dxp + dyp * dyp);
                        if (d < dist[i]) { dist[i] = d; owner[i] = k; }
                    }
                }
            }
            var sl = new Float64Array(count), sa = new Float64Array(count), sb = new Float64Array(count);
            var sx = new Float64Array(count), sy = new Float64Array(count), sn = new Float64Array(count);
            for (y = 0; y < h; y++) {
                for (x = 0; x < w; x++) {
                    i = y * w + x; k = owner[i];
                    if (k < 0) continue;
                    var p2 = i * 3;
                    sl[k] += lab[p2]; sa[k] += lab[p2 + 1]; sb[k] += lab[p2 + 2];
                    sx[k] += x; sy[k] += y; sn[k]++;
                }
            }
            for (k = 0; k < count; k++) {
                if (sn[k] < 1) continue;
                cl[k] = sl[k] / sn[k]; ca[k] = sa[k] / sn[k]; cb[k] = sb[k] / sn[k];
                cx[k] = sx[k] / sn[k]; cy[k] = sy[k] / sn[k];
            }
        }

        /* Any pixel the sweep never claimed goes to its nearest labelled
           neighbour, so `owner` is total. */
        for (i = 0; i < n; i++) {
            if (owner[i] >= 0) continue;
            var xx = i % w, yy = (i / w) | 0;
            var found = -1;
            for (var r = 1; r < 8 && found < 0; r++) {
                for (var dy2 = -r; dy2 <= r && found < 0; dy2++) {
                    for (var dx2 = -r; dx2 <= r && found < 0; dx2++) {
                        var nx = xx + dx2, ny = yy + dy2;
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                        if (owner[ny * w + nx] >= 0) found = owner[ny * w + nx];
                    }
                }
            }
            owner[i] = found < 0 ? 0 : found;
        }

        return { owner: owner, count: count, cl: cl, ca: ca, cb: cb, cx: cx, cy: cy };
    }

    /* Zhu et al. 2014, "Saliency Optimization from Robust Background
       Detection". The insight worth stealing: an object touching the frame is
       not necessarily background, but a region whose GEODESIC neighbourhood
       spills mostly onto the frame is. BndCon = boundary length ÷ √area, both
       measured through the colour-geodesic metric rather than in pixels, so a
       big uniform background scores high even where it never touches an edge
       and a subject leaning on the frame scores low.                          */
    function engineSLIC(img, opt) {
        opt = opt || {};
        var w = img.w, h = img.h, n = img.n;
        var K = opt.superpixels || 350;
        var sp = slic(img, K, opt.compactness === undefined ? 0.12 : opt.compactness, opt.rounds || 8);
        var C = sp.count, owner = sp.owner;
        var i, k, x, y;

        /* Adjacency + which superpixels touch the frame. */
        var adj = new Array(C);
        for (k = 0; k < C; k++) adj[k] = {};
        var onEdge = new Uint8Array(C);
        var area = new Float64Array(C);
        var margin = Math.max(1, Math.round(Math.min(w, h) * 0.012));
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) {
                i = y * w + x; k = owner[i];
                area[k]++;
                if (x < margin || y < margin || x >= w - margin || y >= h - margin) onEdge[k] = 1;
                if (x + 1 < w) { var r2 = owner[i + 1]; if (r2 !== k) { adj[k][r2] = 1; adj[r2][k] = 1; } }
                if (y + 1 < h) { var d2 = owner[i + w]; if (d2 !== k) { adj[k][d2] = 1; adj[d2][k] = 1; } }
            }
        }

        /* Flatten to CSR for the Dijkstra sweeps. */
        var deg = new Int32Array(C), tot = 0, key;
        for (k = 0; k < C; k++) { deg[k] = Object.keys(adj[k]).length; tot += deg[k]; }
        var off = new Int32Array(C + 1);
        for (k = 0; k < C; k++) off[k + 1] = off[k] + deg[k];
        var nbr = new Int32Array(tot), wgt = new Float32Array(tot);
        var fill = new Int32Array(C);
        for (k = 0; k < C; k++) {
            var keys = Object.keys(adj[k]);
            for (var t = 0; t < keys.length; t++) {
                var j = +keys[t];
                var dl = sp.cl[k] - sp.cl[j], da = sp.ca[k] - sp.ca[j], db = sp.cb[k] - sp.cb[j];
                nbr[off[k] + fill[k]] = j;
                wgt[off[k] + fill[k]] = Math.sqrt(dl * dl + da * da + db * db);
                fill[k]++;
            }
        }

        var sigClr = opt.sigmaColour === undefined ? 0.10 : opt.sigmaColour;
        var inv2s2 = 1 / (2 * sigClr * sigClr);
        var bndCon = new Float64Array(C);
        var dist = new Float64Array(C);
        var visited = new Uint8Array(C);

        /* Dijkstra from every superpixel. C is a few hundred, so a binary
           heap is not worth the code — the O(C²) scan is faster in practice. */
        for (k = 0; k < C; k++) {
            dist.fill(Infinity); visited.fill(0);
            dist[k] = 0;
            for (var step = 0; step < C; step++) {
                var best = -1, bd = Infinity;
                for (i = 0; i < C; i++) if (!visited[i] && dist[i] < bd) { bd = dist[i]; best = i; }
                if (best < 0 || bd === Infinity) break;
                visited[best] = 1;
                for (var e = off[best]; e < off[best + 1]; e++) {
                    var nd = bd + wgt[e];
                    if (nd < dist[nbr[e]]) dist[nbr[e]] = nd;
                }
            }
            var spanArea = 0, spanBnd = 0;
            for (i = 0; i < C; i++) {
                if (dist[i] === Infinity) continue;
                var contrib = Math.exp(-dist[i] * dist[i] * inv2s2);
                spanArea += contrib;
                if (onEdge[i]) spanBnd += contrib;
            }
            bndCon[k] = spanArea > 1e-9 ? spanBnd / Math.sqrt(spanArea) : 0;
        }

        var sigBnd = opt.sigmaBnd === undefined ? 1.0 : opt.sigmaBnd;
        var invB = 1 / (2 * sigBnd * sigBnd);
        var fgReg = new Float64Array(C);
        for (k = 0; k < C; k++) fgReg[k] = Math.exp(-bndCon[k] * bndCon[k] * invB);

        var out = new Float32Array(n);
        for (i = 0; i < n; i++) out[i] = fgReg[owner[i]];
        normalise(out, 0.01, 0.99);
        return { alpha: out, superpixels: sp };
    }

    /* ═══ 10. ENGINE: GRABCUT ════════════════════════════════════════════════

       Rother, Kolmogorov & Blake 2004. Two GMMs and an MRF, minimised exactly
       and then re-fitted, over and over, until the labelling stops moving.

       mask codes, matching OpenCV's:  0 BGD (fixed)  1 FGD (fixed)
                                       2 PR_BGD       3 PR_FGD                */

    var GC_BGD = 0, GC_FGD = 1, GC_PR_BGD = 2, GC_PR_FGD = 3;

    /* β normalises the colour term against the picture's own contrast, so γ
       means the same thing on a foggy shot and a hard-lit one. */
    function calcBeta(img) {
        var w = img.w, h = img.h, rgb = img.rgb;
        var total = 0, count = 0, x, y;
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) {
                var i = (y * w + x) * 3;
                if (x > 0) { total += d2rgb(rgb, i, i - 3); count++; }
                if (y > 0) { total += d2rgb(rgb, i, i - w * 3); count++; }
                if (y > 0 && x > 0) { total += d2rgb(rgb, i, i - w * 3 - 3); count++; }
                if (y > 0 && x < w - 1) { total += d2rgb(rgb, i, i - w * 3 + 3); count++; }
            }
        }
        if (count === 0 || total <= 1e-9) return 0;
        return 1 / (2 * total / count);
    }

    function d2rgb(rgb, i, j) {
        var dr = rgb[i] - rgb[j], dg = rgb[i + 1] - rgb[j + 1], db = rgb[i + 2] - rgb[j + 2];
        return dr * dr + dg * dg + db * db;
    }

    function engineGrabCut(img, mask, opt) {
        opt = opt || {};
        var w = img.w, h = img.h, n = img.n, rgb = img.rgb;
        var K = opt.components || 5;
        var gamma = opt.gamma === undefined ? 50 : opt.gamma;
        var iters = opt.iterations || 4;
        var rnd = mulberry32(0xC0FFEE);
        var i, x, y;

        var beta = calcBeta(img);
        var lambda = 9 * gamma + 1;

        /* n-link weights, precomputed once — they never change across
           iterations, only the data term does. Four directions per pixel is
           enough for 8-connectivity because each edge is stored once. */
        var wL = new Float32Array(n), wUL = new Float32Array(n);
        var wU = new Float32Array(n), wUR = new Float32Array(n);
        var invSqrt2 = 1 / Math.SQRT2;
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) {
                i = y * w + x;
                var p = i * 3;
                if (x > 0) wL[i] = gamma * Math.exp(-beta * d2rgb(rgb, p, p - 3));
                if (x > 0 && y > 0) wUL[i] = gamma * invSqrt2 * Math.exp(-beta * d2rgb(rgb, p, p - (w + 1) * 3));
                if (y > 0) wU[i] = gamma * Math.exp(-beta * d2rgb(rgb, p, p - w * 3));
                if (x < w - 1 && y > 0) wUR[i] = gamma * invSqrt2 * Math.exp(-beta * d2rgb(rgb, p, p - (w - 1) * 3));
            }
        }

        var bgIdx = new Int32Array(n), fgIdx = new Int32Array(n);
        var bgGMM = new GMM(K), fgGMM = new GMM(K);
        var seeded = false;
        var changed = 0;

        for (var it = 0; it < iters; it++) {
            var bc = 0, fc = 0;
            for (i = 0; i < n; i++) {
                if (mask[i] === GC_BGD || mask[i] === GC_PR_BGD) bgIdx[bc++] = i;
                else fgIdx[fc++] = i;
            }
            if (bc < K * 4 || fc < K * 4) break;

            if (!seeded) {
                bgGMM.init(rgb, bgIdx, bc, rnd);
                fgGMM.init(rgb, fgIdx, fc, rnd);
                seeded = true;
            }
            bgGMM.fit(rgb, bgIdx, bc, null, 2);
            fgGMM.fit(rgb, fgIdx, fc, null, 2);

            var g = new MaxFlow(n, n * 4 + 8);

            for (i = 0; i < n; i++) {
                var q = i * 3;
                var toSource, toSink;
                if (mask[i] === GC_BGD) { toSource = 0; toSink = lambda; }
                else if (mask[i] === GC_FGD) { toSource = lambda; toSink = 0; }
                else {
                    /* Cost of calling it foreground is −log P_fg, and the arc
                       that gets cut when a node lands on the source side is
                       the one to the sink. Hence the crossover. */
                    toSource = -bgGMM.logProb(rgb[q], rgb[q + 1], rgb[q + 2]);
                    toSink = -fgGMM.logProb(rgb[q], rgb[q + 1], rgb[q + 2]);
                    if (!isFinite(toSource)) toSource = lambda;
                    if (!isFinite(toSink)) toSink = lambda;
                }
                g.addTerminal(i, toSource, toSink);
            }

            for (y = 0; y < h; y++) {
                for (x = 0; x < w; x++) {
                    i = y * w + x;
                    if (x > 0) g.addEdge(i, i - 1, wL[i], wL[i]);
                    if (x > 0 && y > 0) g.addEdge(i, i - w - 1, wUL[i], wUL[i]);
                    if (y > 0) g.addEdge(i, i - w, wU[i], wU[i]);
                    if (x < w - 1 && y > 0) g.addEdge(i, i - w + 1, wUR[i], wUR[i]);
                }
            }

            g.run();
            changed = 0;
            for (i = 0; i < n; i++) {
                if (mask[i] !== GC_PR_BGD && mask[i] !== GC_PR_FGD) continue;
                var want = g.inSource(i) ? GC_PR_FGD : GC_PR_BGD;
                if (want !== mask[i]) { mask[i] = want; changed++; }
            }
            if (opt.onProgress) opt.onProgress(it + 1, iters, changed);
            if (changed === 0) break;   /* converged; more rounds are wasted */
        }

        var out = new Float32Array(n);
        for (i = 0; i < n; i++) out[i] = (mask[i] === GC_FGD || mask[i] === GC_PR_FGD) ? 1 : 0;
        return { alpha: out, mask: mask, changed: changed };
    }

    /* ═══ 11. ENGINE: PLATE DIFFERENCE ═══════════════════════════════════════

       With a photograph of the empty set, the subject is simply what changed.
       Colour and lightness are kept apart so a cast shadow — which changes L
       and almost nothing else — can be forgiven, kept as partial alpha, or
       treated as subject, on a dial.                                          */

    function enginePlate(img, plate, opt) {
        opt = opt || {};
        var n = img.n, lab = img.lab, pl = plate.lab;
        var out = new Float32Array(n);
        if (plate.n !== n) { out.fill(0.5); return out; }

        var inner = opt.inner === undefined ? 0.02 : opt.inner;
        var outer = opt.outer === undefined ? 0.10 : opt.outer;
        if (outer <= inner) outer = inner + 1e-4;
        /* 0 = shadows are background, 1 = a darkening counts as much as a
           colour change. */
        var shadow = opt.shadow === undefined ? 0.25 : opt.shadow;

        for (var i = 0; i < n; i++) {
            var p = i * 3;
            var dL = lab[p] - pl[p];
            var da = lab[p + 1] - pl[p + 1];
            var db = lab[p + 2] - pl[p + 2];
            var chroma = Math.sqrt(da * da + db * db);
            /* Only a DARKENING is shadow-like; a brightening is a real change. */
            var lumaTerm = dL < 0 ? Math.abs(dL) * shadow : Math.abs(dL);
            var d = Math.sqrt(chroma * chroma + lumaTerm * lumaTerm);
            out[i] = smoothstep(inner, outer, d);
        }
        return out;
    }

    /* ═══ 12. ENGINE: MANUAL ═════════════════════════════════════════════════
       Scribbles alone, diffused. Not much of an engine, but as a member of the
       mixer it lets a user overrule everything else in one stroke.            */

    function engineManual(img, opt) {
        opt = opt || {};
        var n = img.n, w = img.w, h = img.h;
        var out = new Float32Array(n).fill(0.5);
        var i;
        if (opt.fgSeeds) for (i = 0; i < opt.fgSeeds.length; i++) out[opt.fgSeeds[i]] = 1;
        if (opt.bgSeeds) for (i = 0; i < opt.bgSeeds.length; i++) out[opt.bgSeeds[i]] = 0;
        blurGray(out, w, h, Math.max(1, Math.round(Math.min(w, h) * (opt.spread || 0.02))));
        return out;
    }

    /* ═══ 13. SELF-TEST ══════════════════════════════════════════════════════

       Max-flow is the one thing here that is easy to write and hard to know is
       right, so it gets checked against a brute-force minimum cut on small
       random graphs: enumerate all 2^n labellings, take the cheapest, compare.
       Run it from the console with CUT.selfTest(), or from node.              */

    function bruteMinCut(n, term, edges) {
        var best = Infinity;
        for (var mask = 0; mask < (1 << n); mask++) {
            var cost = 0;
            for (var i = 0; i < n; i++) {
                /* bit set = source side (label 1). Landing on the source side
                   cuts the arc to the sink, and vice versa. */
                cost += (mask >> i) & 1 ? term[i][1] : term[i][0];
            }
            for (var e = 0; e < edges.length; e++) {
                var a = edges[e][0], b = edges[e][1];
                var sa = (mask >> a) & 1, sb = (mask >> b) & 1;
                if (sa === 1 && sb === 0) cost += edges[e][2];
                if (sa === 0 && sb === 1) cost += edges[e][3];
            }
            if (cost < best) best = cost;
        }
        return best;
    }

    function selfTest(trials, verbose) {
        trials = trials || 400;
        var rnd = mulberry32(12345);
        var fails = 0, checked = 0;
        for (var t = 0; t < trials; t++) {
            var n = 2 + ((rnd() * 7) | 0);
            var term = [], i;
            for (i = 0; i < n; i++) {
                term.push([Math.round(rnd() * 10), Math.round(rnd() * 10)]);
            }
            var edges = [];
            for (i = 0; i < n; i++) {
                for (var j = i + 1; j < n; j++) {
                    if (rnd() < 0.5) continue;
                    /* Submodular by construction: both directions non-negative
                       is exactly the condition a graph cut can represent. */
                    edges.push([i, j, Math.round(rnd() * 8), Math.round(rnd() * 8)]);
                }
            }
            var g = new MaxFlow(n, edges.length + 1);
            for (i = 0; i < n; i++) g.addTerminal(i, term[i][0], term[i][1]);
            for (i = 0; i < edges.length; i++) g.addEdge(edges[i][0], edges[i][1], edges[i][2], edges[i][3]);
            var got = g.run();
            var want = bruteMinCut(n, term, edges);
            checked++;
            if (Math.abs(got - want) > 1e-6) {
                fails++;
                if (verbose) {
                    console.log('MISMATCH flow=' + got + ' brute=' + want,
                                JSON.stringify({ term: term, edges: edges }));
                }
            } else {
                /* The reported flow must also match the cut the labelling
                   actually induces, or `inSource` disagrees with `run`. */
                var cutCost = 0;
                for (i = 0; i < n; i++) cutCost += g.inSource(i) ? term[i][1] : term[i][0];
                for (i = 0; i < edges.length; i++) {
                    var sa = g.inSource(edges[i][0]) ? 1 : 0, sb = g.inSource(edges[i][1]) ? 1 : 0;
                    if (sa === 1 && sb === 0) cutCost += edges[i][2];
                    if (sa === 0 && sb === 1) cutCost += edges[i][3];
                }
                if (Math.abs(cutCost - want) > 1e-6) {
                    fails++;
                    if (verbose) console.log('LABELLING MISMATCH cut=' + cutCost + ' brute=' + want);
                }
            }
        }
        return { checked: checked, failures: fails, ok: fails === 0 };
    }

    /* ═══ EXPORTS ════════════════════════════════════════════════════════════ */

    CUT.srgbToLinear = srgbToLinear;
    CUT.linearToSrgb = linearToSrgb;
    CUT.linToOklab = linToOklab;
    CUT.oklabToLin = oklabToLin;
    CUT.srgbToOklab = srgbToOklab;
    CUT.oklabToSrgb = oklabToSrgb;
    CUT.LIN8 = LIN8;
    CUT.makeImage = makeImage;
    CUT.labDist = labDist;

    CUT.clamp01 = clamp01;
    CUT.smoothstep = smoothstep;
    CUT.normalise = normalise;
    CUT.inv3sym = inv3sym;
    CUT.mulberry32 = mulberry32;
    CUT.blurGray = blurGray;
    CUT.resampleGray = resampleGray;

    CUT.GMM = GMM;
    CUT.MaxFlow = MaxFlow;
    CUT.fft2d = fft2d;

    CUT.engineBorder = engineBorder;
    CUT.engineChroma = engineChroma;
    CUT.engineIFT = engineIFT;
    CUT.engineSaliency = engineSaliency;
    CUT.engineSLIC = engineSLIC;
    CUT.engineGrabCut = engineGrabCut;
    CUT.enginePlate = enginePlate;
    CUT.engineManual = engineManual;
    CUT.autoKey = autoKey;
    CUT.slic = slic;
    CUT.bottleneckFrom = bottleneckFrom;
    CUT.geodesicFrom = geodesicFrom;

    CUT.GC = { BGD: GC_BGD, FGD: GC_FGD, PR_BGD: GC_PR_BGD, PR_FGD: GC_PR_FGD };
    CUT.selfTest = selfTest;

    if (typeof module !== 'undefined' && module.exports) module.exports = CUT;
})();
