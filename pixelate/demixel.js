/* ============================================================================
   DEMIXEL — recover true pixel art from an image that only looks like it
   ---------------------------------------------------------------------------
   The problem this solves is "mixels": art generated or rescaled at the wrong
   size, where the blocks LOOK like pixels but aren't. Three things are wrong
   with such an image, and they have to be fixed in this order:

     1. The block grid is unknown. It is rarely a whole number of screen
        pixels (a 60-wide sprite rendered into 1024px has 17.0667px cells) and
        rarely starts at x=0. Guessing "8" and dividing, which is what a plain
        pixelate filter does, lands the sample points inside the wrong blocks
        and smears two source blocks into one output pixel. THAT is the mixel.

     2. Each block is not one colour. It has anti-aliased edges, JPEG ringing,
        and often a gentle gradient. Averaging the whole block pulls the edge
        contamination into the result and gives mud.

     3. The palette is enormous. Art that reads as 12 colours routinely holds
        several thousand near-duplicates, and no two blocks of "the same"
        colour are actually equal.

   So: measure the grid, sample each cell robustly, then rebuild the palette.
   Everything here is pure — it takes pixels and returns pixels — so the page
   can call the stages independently and cache them.
   ========================================================================= */
(function () {
    'use strict';

    /* ── Colour ──────────────────────────────────────────────────────────────
       Two different distance metrics, on purpose.

       cheapDist is the classic low-cost weighted RGB approximation, used for
       the edge profile where it runs once per pixel pair over the whole image
       and only ever gets compared against itself.

       OKLab is used everywhere a decision is made that a human will look at —
       palette clustering, nearest-colour snapping. Plain RGB distance is badly
       non-uniform: it will happily merge two greens a viewer reads as separate
       while splitting two blues they read as one. */

    function cheapDist(r1, g1, b1, r2, g2, b2) {
        var dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
        return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
    }

    function srgbToLinear(c) {
        c /= 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function rgbToOklab(r, g, b) {
        var R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
        var l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
        var m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
        var s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
        var l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
        return [
            0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
        ];
    }

    /* ── 1. EDGE PROFILE ─────────────────────────────────────────────────────
       Collapse the image to two 1-D signals: how much colour changes across
       each column boundary, and across each row boundary. A real block grid
       shows up as a comb of tall spikes in these signals, and everything the
       detector does is a search for that comb.

       Transparency counts as a colour change, so sprite silhouettes on a
       transparent ground contribute their outline to the grid evidence rather
       than being invisible to it. */

    /* Each position reports the FRACTION OF ROWS that cross a real edge there,
       not the average size of the change.

       Averaging magnitude looks equivalent and is not, because real art is
       mostly flat. A vertical seam that only exists where a sprite's outline
       crosses it is present in perhaps a fifth of the rows; average its
       magnitude down the full height and it arrives at the detector five times
       weaker, while sensor noise — which is present in EVERY row — arrives at
       full strength. Measured on structured sprites the true boundaries came
       back at a value of ~10 against a noise floor of the same order, where
       the same code on flat-cell test images gave ~290. The grid was still
       there; averaging had buried it.

       Counting instead makes a seam worth what it is regardless of how much of
       the height it spans, and drops sub-threshold noise entirely. The
       threshold is set from the image's own median adjacent difference, so it
       tracks how noisy the source actually is; the floor of 24 keeps a
       perfectly clean image from setting a threshold of zero and counting
       everything.

       Transparency counts as a change, so sprite silhouettes on a transparent
       ground contribute their outline as grid evidence. */

    function edgeProfiles(img) {
        var d = img.data, w = img.width, h = img.height;
        var px = new Float64Array(w), py = new Float64Array(h);
        var x, y, i, j, dist;

        /* Threshold from a subsample of horizontal neighbour differences. */
        var samples = [];
        var stepY = Math.max(1, Math.floor(h / 120));
        var stepX = Math.max(1, Math.floor(w / 120));
        for (y = 0; y < h; y += stepY) {
            for (x = 1; x < w; x += stepX) {
                i = (y * w + x) * 4;
                j = i - 4;
                samples.push(cheapDist(d[i], d[i + 1], d[i + 2], d[j], d[j + 1], d[j + 2]));
            }
        }
        samples.sort(function (a, b) { return a - b; });
        var mid = samples.length ? samples[samples.length >> 1] : 0;
        var T = Math.max(24, mid * 3);

        for (y = 0; y < h; y++) {
            for (x = 1; x < w; x++) {
                i = (y * w + x) * 4;
                j = i - 4;
                dist = cheapDist(d[i], d[i + 1], d[i + 2], d[j], d[j + 1], d[j + 2]) +
                       Math.abs(d[i + 3] - d[j + 3]) * 4;
                if (dist > T) px[x]++;
            }
        }
        for (y = 1; y < h; y++) {
            for (x = 0; x < w; x++) {
                i = (y * w + x) * 4;
                j = i - w * 4;
                dist = cheapDist(d[i], d[i + 1], d[i + 2], d[j], d[j + 1], d[j + 2]) +
                       Math.abs(d[i + 3] - d[j + 3]) * 4;
                if (dist > T) py[y]++;
            }
        }
        for (x = 0; x < w; x++) px[x] /= h;
        for (y = 0; y < h; y++) py[y] /= w;
        return { x: px, y: py };
    }

    /* ── 2. GRID SEARCH ──────────────────────────────────────────────────────
       This is a comb filter, and it is the same problem as pitch detection:
       the danger is not missing the period, it is locking onto a harmonic of
       it. A candidate can be wrong in exactly two ways, and each needs its own
       term, because a metric that catches one is blind to the other.

         TOO LONG (p = m·true). Sampling every 5th boundary of a true 16px grid
         still lands every tooth on a real edge, so any "are my teeth on edges"
         measure scores it perfectly. What gives it away is that it leaves 4/5
         of the image's edge energy unexplained.
           → RECALL: the share of all edge energy the comb accounts for.

         TOO SHORT (p = true/m). Sampling every 8px of a true 16px grid explains
         100% of the energy, so recall cannot fault it. What gives it away is
         that every other tooth lands on flat interior and comes back empty.
           → LIVENESS: mean tooth height measured against what a real edge in
             this image looks like. A comb sitting on every boundary scores ~1;
             one that alternates hit/miss scores ~0.5.

       score = recall × liveness, both in 0..1, and only the true fundamental
       scores well on both.

       Two earlier attempts at that second term are worth recording, because
       both look right and neither is:

         mean(boundary) − mean(interior) — the missed edges get averaged across
         every flat position in the image, so the penalty arrives diluted ~50×.
         The true period beat its own 5th harmonic by 2%; noise flipped it.

         mean(tooth) / 90th-percentile(tooth) — self-referential, so it has no
         idea what a real edge looks like. On a noisy image every tooth is
         equally mediocre and it reports a perfect 1.0; worse, it is unbounded,
         because a mean pulled up by outliers above the 90th percentile exceeds
         it. A pure-noise comb at p=2 scored 1.00.

       The fix is that the reference has to come from OUTSIDE the candidate:
       pTop, the 99th percentile of the whole profile, computed once per axis.
       That is "what a strong edge is worth here", so a comb that lands on
       noise is measured against real edges and scores near zero. */

    /* `teethSrc` is the dilated profile and `total` the undilated one — see
       detectAxis. Recall is clamped because a dense comb's overlapping tooth
       windows can double-count a spike and read above 1; only the ordering
       matters here, and every candidate that clamps is smaller than the
       fundamental anyway, so the tie is broken correctly downstream. */
    function scoreComb(teethSrc, total, pTop, period, phase) {
        var n = teethSrc.length, bSum = 0, bCount = 0, k, pos;
        for (k = 0; ; k++) {
            pos = Math.round(phase + k * period);
            if (pos >= n) break;
            if (pos >= 1) { bSum += teethSrc[pos]; bCount++; }
        }
        if (bCount < 3 || bSum <= 0) return null;

        var bMean = bSum / bCount;
        var recall = Math.min(1, bSum / total);
        var liveness = Math.min(1, bMean / pTop);
        return {
            score: recall * liveness,
            recall: recall,
            liveness: liveness,
            bMean: bMean
        };
    }

    /* The score is already a 0..1 quantity where both factors are ratios, so
       it doubles as the confidence. Near 1 the grid is unambiguous; under
       ~0.15 there is probably no grid to find — the image may already be 1:1,
       or may not be pixel art at all. */

    function detectAxis(prof, minPeriod, maxPeriod, recallFloor) {
        var n = prof.length, i;
        if (n < 8) return { period: 1, phase: 0, confidence: 0 };

        var hi = Math.min(maxPeriod, Math.floor(n / 3));
        var lo = Math.max(2, minPeriod);
        if (hi < lo) return { period: 1, phase: 0, confidence: 0 };

        /* Subtract the noise floor before anything is scored.

           Recall is a share of total energy, so it is only meaningful if the
           total is made of edges. On a grainy or JPEG-damaged source it is
           not: film grain across all 1023 positions can carry several times
           the energy of the twelve real boundaries, and the true grid — which
           explains every edge in the image — is left claiming 13% of the
           total. It loses to a 2px comb that explains nothing but samples half
           of everything. Both of the images this failed on were heavily
           blurred and noisy, which is exactly the AI-upscale case this tool is
           for, so it is the normal input rather than a corner.

           The 25th percentile is the floor estimate: boundaries are always a
           minority of positions (period ≥ 2 caps them at half), so a low
           quantile sits in the flat interior no matter what the period is. */
        var sorted = Float64Array.from(prof.subarray(1));
        sorted.sort();
        var floor = sorted[Math.floor(sorted.length * 0.25)];

        var lifted = new Float64Array(n);
        for (i = 1; i < n; i++) lifted[i] = Math.max(0, prof[i] - floor);

        /* Then collapse every edge to a single spike (non-maximum suppression).

           Recall assumes one boundary contributes to one tooth. A blurred or
           resampled source breaks that: its seams are 3–5px wide ramps, and a
           comb — which samples one position per cell — can only ever collect
           the crest, forfeiting the shoulders. Meanwhile a 2px comb samples
           half of every position in the image and rakes in the whole smear. So
           on any soft source the densest combs out-recall the truth, and
           selection goes to a 2px grid again. Blurred and low-contrast inputs
           both failed exactly this way.

           Suppressing non-maxima restores the assumption the metric needs: one
           edge, one position, whatever its width. Ties are kept (>= rather than
           >) so a symmetric two-pixel ramp does not erase itself. */
        var R = 2;
        var work = new Float64Array(n);
        var total = 0, j, hiLocal;
        for (i = 1; i < n; i++) {
            hiLocal = 0;
            for (j = Math.max(1, i - R); j <= Math.min(n - 1, i + R); j++) {
                if (lifted[j] > hiLocal) hiLocal = lifted[j];
            }
            work[i] = lifted[i] >= hiLocal ? lifted[i] : 0;
            total += work[i];
        }
        if (total <= 0) return { period: 1, phase: 0, confidence: 0 };
        prof = work;

        /* Finally, give each spike ±1px of slack by dilating.

           A comb tooth samples one exact position, so it is all-or-nothing
           against a spike that anti-aliasing or noise has nudged a pixel off
           its ideal location. The true period, having to hit every seam, is
           the candidate most exposed to that: it misses a few, its recall
           falls to ~0.8, and a SUBHARMONIC — twice the teeth, twice the
           chances — sweeps up everything and wins. Every remaining failure at
           this stage was an exact divisor of the truth: 6.4→3.2, 85.33→21.33,
           14.22→7.11.

           Dilating once here rather than widening the sample inside the scoring
           loop keeps the sweep at one array read per tooth. Note the asymmetry
           in what gets passed on: teeth are read from the DILATED profile, but
           `total` stays the undilated sum, so recall keeps meaning "share of
           real edge energy" instead of inflating with the window width. */
        /* Tolerance has to scale with the cell, and a single fixed radius
           cannot: ±1px around a 4px cell already covers three positions in
           four, so every candidate period lands "on" an edge and the metric
           stops discriminating entirely — measured, a 4px grid was read as
           5.3 to 8. The same ±1px is meanwhile far too tight for an 85px cell
           in a blurred source, where the seam wanders further than that.

           So three profiles are built once and the sweep picks by candidate
           size: tight for fine grids, generous for coarse ones. */
        function dilate(src, win) {
            if (win <= 0) return src;
            var out = new Float64Array(n), a, b, m;
            for (var q = 1; q < n; q++) {
                m = 0;
                a = Math.max(1, q - win);
                b = Math.min(n - 1, q + win);
                for (var z = a; z <= b; z++) if (src[z] > m) m = src[z];
                out[q] = m;
            }
            return out;
        }
        var dils = [prof, dilate(prof, 1), dilate(prof, 2)];
        function winFor(pp) { return pp < 8 ? 0 : (pp < 28 ? 1 : 2); }

        /* The reference edge height, computed ONCE for the whole axis so that
           every candidate is judged against the same yardstick. This is the
           thing that makes liveness meaningful — see scoreComb. */
        var above = Float64Array.from(prof.subarray(1));
        above.sort();
        var pTop = above[Math.floor(above.length * 0.99)];
        if (!(pTop > 0)) pTop = above[above.length - 1];
        if (!(pTop > 0)) return { period: 1, phase: 0, confidence: 0 };

        /* How finely the period must be sampled is the whole problem here, and
           it is not a constant.

           A comb is only as good as its last tooth. Testing period p when the
           truth is p+Δ walks the k-th tooth off by k·Δ, so across the n/p teeth
           that span the image the error reaches (n/p)·Δ. Holding that under one
           pixel requires

               Δp ≤ p / n

           — a step that must get FINER as the period gets longer, because a
           long period has fewer cells over which to accumulate the same total
           error. Both of the obvious sweeps violate it at one end or the other:

             Integer periods. At a true cell of 48.5px in a 768px image, period
             48 drifts 8px by the 16th tooth and scores 0.014 where the truth
             scores 0.295. The fundamental is invisible, and what wins instead
             is whatever short period best fits the noise — which is how a
             detector ends up confidently reporting a 2px grid.

             Integer CELL COUNTS. Tempting, because consecutive counts differ by
             Δp = p²/n and that looks adaptive. It is adaptive in the wrong
             direction: total drift works out to (n/p)·(p²/n) = p, a full cell
             end to end. It also silently assumes the art spans a whole number
             of cells, which a phase offset and two partial edge cells make
             false — 48.5px into 768px is 15.8 cells, and no integer count ever
             tests it.

           Stepping by p/n satisfies the bound at every scale. The candidate
           count comes to n·ln(hi/lo) — a few thousand — and since long periods
           have proportionally fewer teeth, total work stays near linear. */
        var cands = [], p, ph, s, bestForP;
        for (p = lo; p <= hi; p += Math.max(0.01, p / n)) {
            bestForP = null;
            for (ph = 0; ph < p; ph += 0.5) {
                s = scoreComb(dils[winFor(p)], total, pTop, p, ph);
                if (s && (!bestForP || s.recall > bestForP.recall)) {
                    bestForP = { p: p, ph: ph, recall: s.recall, liveness: s.liveness };
                }
            }
            if (bestForP) cands.push(bestForP);
        }
        if (!cands.length) return { period: 1, phase: 0, confidence: 0 };

        /* SELECTION: the largest period that still explains nearly all the
           edge energy.

           Maximising recall × liveness is wrong on real art, and the reason is
           worth stating plainly. Actual pixel art is mostly flat regions, so
           most true cell boundaries have identical colour on both sides and
           produce NO edge at all — a 48-cell sprite may show only fifteen real
           vertical seams. Liveness, being mean tooth height, therefore reads
           low for the correct grid through no fault of the grid, and a spurious
           longer period that happens to land only on the strong seams outscores
           it. Measured on structured sprites, maximising the product returned
           29 columns where the truth was 48, and 6 where the truth was 40.

           Recall alone is the honest signal: the true period explains 100% of
           the edges, because every edge lies on a cell boundary by
           construction. What recall cannot do alone is reject SUBHARMONICS —
           half the true period also explains 100%, it merely adds empty teeth
           between the real ones.

           So recall picks the set and SIZE breaks the tie. Every period below
           the truth explains everything; every period above it starts missing
           seams. The fundamental is exactly the largest member of the
           explains-everything set, and no measure of tooth quality is needed to
           find it. Liveness survives only as a confidence report. */
        var rMax = 0, i;
        for (i = 0; i < cands.length; i++) if (cands[i].recall > rMax) rMax = cands[i].recall;
        if (rMax <= 0) return { period: 1, phase: 0, confidence: 0 };

        /* 0.7 chosen by sweeping the threshold across the whole synthetic suite:
           0.65–0.80 all score 13/14 and everything outside that band degrades,
           so this sits in the middle of the stable plateau rather than on an
           edge. Below ~0.55 the 2x harmonic (recall ~0.5) starts slipping
           through; above ~0.85 a blurred true grid, which forfeits some of its
           seams to the blur, no longer clears its own bar. */
        var floorR = rMax * (recallFloor || 0.7);
        var chosen = cands[0];
        for (i = cands.length - 1; i >= 0; i--) {
            if (cands[i].recall >= floorR) { chosen = cands[i]; break; }
        }

        /* Phase refinement at sub-pixel resolution; the period from the sweep
           is already finer than a finer step would change. */
        var bestPh = chosen.ph, bestS = null;
        for (ph = 0; ph < chosen.p; ph += 0.05) {
            s = scoreComb(dils[winFor(chosen.p)], total, pTop, chosen.p, ph);
            if (s && (!bestS || s.recall > bestS.recall)) { bestS = s; bestPh = ph; }
        }

        /* Ranked alternates. Harmonic ambiguity is not always the detector
           being wrong — a sprite drawn on a 16px grid where every pair of
           columns happens to match really is also a valid 32px reading, and no
           amount of signal processing can know which the artist meant. So the
           runners-up are handed to the caller: the UI offers them as one click,
           which turns the hardest failure mode into a choice instead of a
           silent mistake. Deduped by ratio so the list is genuinely different
           options rather than fifty neighbours of one peak. */
        var alts = [];
        for (i = cands.length - 1; i >= 0; i--) {
            if (cands[i].recall < floorR) continue;
            var dup = false;
            for (var q = 0; q < alts.length; q++) {
                var ratio = alts[q].period / cands[i].p;
                if (ratio < 1.15 && ratio > 0.87) { dup = true; break; }
            }
            if (dup) continue;
            alts.push({ period: cands[i].p, phase: cands[i].ph, recall: cands[i].recall });
            if (alts.length >= 4) break;
        }

        return {
            period: chosen.p,
            phase: bestPh,
            confidence: bestS ? Math.max(0, Math.min(1, bestS.recall * bestS.liveness)) : 0,
            alternates: alts
        };
    }

    /* Both axes independently: AI upscales are frequently anisotropic, and a
       non-square source aspect makes cells non-square even when the generator
       intended them square. */
    function detectGrid(img, opts) {
        opts = opts || {};
        var prof = edgeProfiles(img);
        var minP = opts.minPeriod || 2;
        var maxP = opts.maxPeriod || 96;
        var rf = opts.recallFloor;
        var gx = detectAxis(prof.x, minP, maxP, rf);
        var gy = detectAxis(prof.y, minP, maxP, rf);
        return {
            cellW: gx.period, offsetX: gx.phase, confX: gx.confidence,
            cellH: gy.period, offsetY: gy.phase, confY: gy.confidence,
            confidence: Math.min(gx.confidence, gy.confidence),
            altsX: gx.alternates || [],
            altsY: gy.alternates || [],
            profiles: prof
        };
    }

    /* ── 3. CELL GEOMETRY ────────────────────────────────────────────────────
       Boundaries at phase + k·period, clipped to the image. A partial cell at
       either edge is kept only if it holds at least half a cell's worth of
       pixels — below that it is a crop artefact, and letting it through would
       shift every column of the output by one. */

    function axisCells(n, period, phase) {
        var ph = phase % period;
        if (ph < 0) ph += period;
        var bounds = [], k, b;
        if (ph > 1e-6) bounds.push(0);
        for (k = 0; ; k++) {
            b = ph + k * period;
            if (b >= n - 1e-6) break;
            bounds.push(b);
        }
        bounds.push(n);

        var cells = [];
        for (k = 0; k < bounds.length - 1; k++) {
            if (bounds[k + 1] - bounds[k] >= period * 0.5) {
                cells.push([bounds[k], bounds[k + 1]]);
            }
        }
        return cells;
    }

    /* ── 4. CELL COLOUR ──────────────────────────────────────────────────────
       Sampling is inset from the cell edge before anything is measured. The
       outer ~20% of a cell is where the anti-aliasing lives; include it and
       every cell is contaminated by its neighbours, which is precisely the
       smearing this tool exists to undo.

       Three estimators, because they fail differently:
         DOMINANT — the modal colour of the cell, found by bucketing to 4 bits
                    per channel and then averaging only the winning bucket.
                    Ignores outliers completely, returns a colour that really
                    is in the cell. Right for flat art, which is most of it.
         MEDIAN   — per channel. Robust to speckle, cheap, but can return a
                    colour no pixel in the cell actually had.
         MEAN     — what a plain pixelate filter does. Kept because it is the
                    correct choice for genuinely dithered or gradient cells. */

    var SAMPLE_CAP = 400;

    function cellColour(d, w, x0, x1, y0, y1, mode) {
        var ix0 = Math.max(0, Math.floor(x0)), ix1 = Math.min(w, Math.ceil(x1));
        var iy0 = Math.max(0, Math.floor(y0)), iy1 = Math.ceil(y1);
        if (ix1 <= ix0) ix1 = ix0 + 1;
        if (iy1 <= iy0) iy1 = iy0 + 1;

        var cw = ix1 - ix0, ch = iy1 - iy0;
        /* Stride so a 64px cell costs the same as an 8px one. */
        var stride = Math.max(1, Math.floor(Math.sqrt((cw * ch) / SAMPLE_CAP)));

        var rs = [], gs = [], bs = [], as = [];
        var x, y, i;
        for (y = iy0; y < iy1; y += stride) {
            for (x = ix0; x < ix1; x += stride) {
                i = (y * w + x) * 4;
                rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); as.push(d[i + 3]);
            }
        }
        if (!rs.length) return [0, 0, 0, 0];

        if (mode === 'mean') {
            var sr = 0, sg = 0, sb = 0, sa = 0;
            for (i = 0; i < rs.length; i++) { sr += rs[i]; sg += gs[i]; sb += bs[i]; sa += as[i]; }
            return [sr / rs.length, sg / rs.length, sb / rs.length, sa / rs.length];
        }

        if (mode === 'median') {
            return [med(rs), med(gs), med(bs), med(as)];
        }

        /* dominant */
        var buckets = {}, key, bestKey = null, bestN = 0;
        for (i = 0; i < rs.length; i++) {
            key = (rs[i] >> 4) * 4096 + (gs[i] >> 4) * 256 + (bs[i] >> 4) * 16 + (as[i] >> 4);
            buckets[key] = (buckets[key] || 0) + 1;
            if (buckets[key] > bestN) { bestN = buckets[key]; bestKey = key; }
        }
        var ar = 0, ag = 0, ab = 0, aa = 0, cnt = 0;
        for (i = 0; i < rs.length; i++) {
            key = (rs[i] >> 4) * 4096 + (gs[i] >> 4) * 256 + (bs[i] >> 4) * 16 + (as[i] >> 4);
            if (key === bestKey) { ar += rs[i]; ag += gs[i]; ab += bs[i]; aa += as[i]; cnt++; }
        }
        return [ar / cnt, ag / cnt, ab / cnt, aa / cnt];
    }

    function med(arr) {
        arr.sort(function (a, b) { return a - b; });
        var m = arr.length >> 1;
        return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
    }

    /* Resample the image onto the detected grid. Returns a cols×rows raster of
       RGBA — true pixel art, one array entry per art pixel. */
    function extractCells(img, grid, opts) {
        opts = opts || {};
        var mode = opts.mode || 'dominant';
        var inset = opts.inset === undefined ? 0.2 : opts.inset;
        var d = img.data, w = img.width, h = img.height;

        var colsX = axisCells(w, grid.cellW, grid.offsetX);
        var colsY = axisCells(h, grid.cellH, grid.offsetY);
        var cols = colsX.length, rows = colsY.length;
        var out = new Float32Array(cols * rows * 4);

        for (var j = 0; j < rows; j++) {
            var yA = colsY[j][0], yB = colsY[j][1];
            var yPad = (yB - yA) * inset;
            for (var i = 0; i < cols; i++) {
                var xA = colsX[i][0], xB = colsX[i][1];
                var xPad = (xB - xA) * inset;
                var c = cellColour(d, w, xA + xPad, xB - xPad, yA + yPad, yB - yPad, mode);
                var o = (j * cols + i) * 4;
                out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
            }
        }
        return { cols: cols, rows: rows, data: out };
    }

    /* ── 5. PALETTE ──────────────────────────────────────────────────────────
       Weighted k-means in OKLab. Weighting matters: an unweighted clustering
       spends its colours on the handful of bright accent pixels and leaves the
       background — three quarters of the image — sharing one entry with a
       shadow. Frequency weighting puts the palette where the art is.

       Centroids are then SNAPPED to the nearest colour that actually occurs in
       the source, so every palette entry is a colour the artist (or the model)
       really produced, rather than an average that sits between two of them. */

    function buildPalette(cells, k, opts) {
        opts = opts || {};
        var alphaCut = opts.alphaCut === undefined ? 8 : opts.alphaCut;

        /* Collapse to unique colours with counts before clustering — a 128×128
           raster is 16k samples but usually only a few hundred distinct
           colours, and k-means over the distinct set is far cheaper. */
        var map = new Map(), i, key, e;
        var n = cells.cols * cells.rows;
        for (i = 0; i < n; i++) {
            var o = i * 4;
            if (cells.data[o + 3] < alphaCut) continue;
            var r = Math.round(cells.data[o]), g = Math.round(cells.data[o + 1]), b = Math.round(cells.data[o + 2]);
            key = (r << 16) | (g << 8) | b;
            e = map.get(key);
            if (e) e.n++;
            else map.set(key, { r: r, g: g, b: b, n: 1, lab: rgbToOklab(r, g, b) });
        }
        var uniq = Array.from(map.values());
        if (!uniq.length) return [];
        if (uniq.length <= k) {
            return uniq.sort(function (a, b) { return b.n - a.n; })
                       .map(function (u) { return [u.r, u.g, u.b]; });
        }

        /* k-means++ seeding, weighted by frequency. */
        var cent = [];
        uniq.sort(function (a, b) { return b.n - a.n; });
        cent.push(uniq[0].lab.slice());
        var dist = new Float64Array(uniq.length).fill(Infinity);
        while (cent.length < k) {
            var last = cent[cent.length - 1], sum = 0;
            for (i = 0; i < uniq.length; i++) {
                var dd = labDist2(uniq[i].lab, last);
                if (dd < dist[i]) dist[i] = dd;
                sum += dist[i] * uniq[i].n;
            }
            if (sum <= 0) break;
            var pick = sum * 0.5, acc = 0, chosen = uniq.length - 1;
            for (i = 0; i < uniq.length; i++) {
                acc += dist[i] * uniq[i].n;
                if (acc >= pick) { chosen = i; break; }
            }
            cent.push(uniq[chosen].lab.slice());
        }

        /* Lloyd. Twelve passes is well past the point the assignment stops
           changing for palettes this size. */
        var assign = new Int32Array(uniq.length);
        for (var pass = 0; pass < 12; pass++) {
            var moved = false;
            for (i = 0; i < uniq.length; i++) {
                var bestD = Infinity, bestC = 0;
                for (var c = 0; c < cent.length; c++) {
                    var dv = labDist2(uniq[i].lab, cent[c]);
                    if (dv < bestD) { bestD = dv; bestC = c; }
                }
                if (assign[i] !== bestC) { assign[i] = bestC; moved = true; }
            }
            var sums = cent.map(function () { return [0, 0, 0, 0]; });
            for (i = 0; i < uniq.length; i++) {
                var s = sums[assign[i]], u = uniq[i];
                s[0] += u.lab[0] * u.n; s[1] += u.lab[1] * u.n; s[2] += u.lab[2] * u.n; s[3] += u.n;
            }
            for (c = 0; c < cent.length; c++) {
                if (sums[c][3] > 0) {
                    cent[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
                }
            }
            if (!moved) break;
        }

        /* Snap each centroid onto a real colour from the image. */
        var out = [], used = {};
        for (c = 0; c < cent.length; c++) {
            var nearD = Infinity, near = null;
            for (i = 0; i < uniq.length; i++) {
                var q = labDist2(uniq[i].lab, cent[c]);
                if (q < nearD) { nearD = q; near = uniq[i]; }
            }
            if (near) {
                key = (near.r << 16) | (near.g << 8) | near.b;
                if (!used[key]) { used[key] = 1; out.push([near.r, near.g, near.b]); }
            }
        }
        return out;
    }

    function labDist2(a, b) {
        var d0 = a[0] - b[0], d1 = a[1] - b[1], d2 = a[2] - b[2];
        return d0 * d0 + d1 * d1 + d2 * d2;
    }

    /* Map every cell onto the palette, in OKLab. Returns indices, with -1 for
       cells that are transparent. */
    function mapToPalette(cells, palette, alphaCut) {
        alphaCut = alphaCut === undefined ? 8 : alphaCut;
        var labs = palette.map(function (p) { return rgbToOklab(p[0], p[1], p[2]); });
        var n = cells.cols * cells.rows;
        var idx = new Int32Array(n);
        var cache = new Map();
        for (var i = 0; i < n; i++) {
            var o = i * 4;
            if (cells.data[o + 3] < alphaCut) { idx[i] = -1; continue; }
            var r = Math.round(cells.data[o]), g = Math.round(cells.data[o + 1]), b = Math.round(cells.data[o + 2]);
            var key = (r << 16) | (g << 8) | b;
            var hit = cache.get(key);
            if (hit === undefined) {
                var lab = rgbToOklab(r, g, b), bestD = Infinity;
                hit = 0;
                for (var c = 0; c < labs.length; c++) {
                    var d = labDist2(lab, labs[c]);
                    if (d < bestD) { bestD = d; hit = c; }
                }
                cache.set(key, hit);
            }
            idx[i] = hit;
        }
        return idx;
    }

    /* ── 6. DESPECKLE ────────────────────────────────────────────────────────
       A lone cell whose colour matches none of its four neighbours is almost
       always a sampling casualty — a cell that straddled an edge, or a JPEG
       artefact that survived. Replace it with the majority around it, but only
       when the neighbourhood actually agrees, so real single-pixel detail
       (an eye, a highlight, a star) is left alone.

       Applied to a copy so the pass is simultaneous; done in place it would
       propagate a change along the scan direction like a smear. */

    function despeckle(idx, cols, rows, minAgree) {
        var src = Int32Array.from(idx);
        var out = Int32Array.from(idx);
        for (var y = 0; y < rows; y++) {
            for (var x = 0; x < cols; x++) {
                var i = y * cols + x, self = src[i];
                if (self < 0) continue;
                var counts = {}, best = -1, bestN = 0, matches = 0, total = 0;
                var nb = [
                    x > 0 ? src[i - 1] : null,
                    x < cols - 1 ? src[i + 1] : null,
                    y > 0 ? src[i - cols] : null,
                    y < rows - 1 ? src[i + cols] : null
                ];
                for (var k = 0; k < 4; k++) {
                    var v = nb[k];
                    if (v === null || v < 0) continue;
                    total++;
                    if (v === self) matches++;
                    counts[v] = (counts[v] || 0) + 1;
                    if (counts[v] > bestN) { bestN = counts[v]; best = v; }
                }
                if (total >= minAgree && matches === 0 && bestN >= minAgree) out[i] = best;
            }
        }
        return out;
    }

    /* ── 7. RENDER ───────────────────────────────────────────────────────── */

    function toImageData(cells, palette, idx, alphaCut) {
        alphaCut = alphaCut === undefined ? 8 : alphaCut;
        var out = new ImageData(cells.cols, cells.rows);
        var n = cells.cols * cells.rows;
        for (var i = 0; i < n; i++) {
            var o = i * 4;
            var a = cells.data[o + 3];
            if (a < alphaCut) { out.data[o + 3] = 0; continue; }
            if (idx && palette && idx[i] >= 0) {
                var p = palette[idx[i]];
                out.data[o] = p[0]; out.data[o + 1] = p[1]; out.data[o + 2] = p[2];
            } else {
                out.data[o] = Math.round(cells.data[o]);
                out.data[o + 1] = Math.round(cells.data[o + 1]);
                out.data[o + 2] = Math.round(cells.data[o + 2]);
            }
            out.data[o + 3] = 255;
        }
        return out;
    }

    /* Count of distinct colours actually present — the honest "how many
       colours is this really" number, before and after. */
    function countColours(img, alphaCut) {
        alphaCut = alphaCut === undefined ? 8 : alphaCut;
        var seen = new Set(), d = img.data;
        for (var i = 0; i < d.length; i += 4) {
            if (d[i + 3] < alphaCut) continue;
            seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        }
        return seen.size;
    }

    window.DEMIXEL = {
        edgeProfiles: edgeProfiles,
        detectGrid: detectGrid,
        detectAxis: detectAxis,
        axisCells: axisCells,
        extractCells: extractCells,
        buildPalette: buildPalette,
        mapToPalette: mapToPalette,
        despeckle: despeckle,
        toImageData: toImageData,
        countColours: countColours,
        rgbToOklab: rgbToOklab
    };
})();
