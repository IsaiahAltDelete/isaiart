/* ============================================================================
   HALFTONE PLATE — page wiring for screen.js
   ---------------------------------------------------------------------------
   The pipeline is staged and cached, because the stages cost wildly different
   amounts and the controls that drive them change at wildly different rates.
   Rotating every source pixel into its cell is the expensive one and it only
   depends on pitch and angle; dragging the dot-gain slider must not re-run it.

        source ──▶ lattice ──▶ cell sums ──▶ coverage ──▶ plate
                      ▲            ▲            ▲           ▲
                   pitch        pitch         tone        screen
                   angle        angle         inks        shape

   There is one plate, not two, and it is the file you would export. It is
   rendered in bands once the controls go quiet, and the stage draws it down
   to whatever size it is showing. That is what makes the preview honest: a
   preview screened at the STAGE's scale is a different, coarser screen than
   the one being exported — at a 6px pitch shown half size it has three
   pixels to draw a four-ink rosette in, and four inks sampled that thinly
   read as colour noise rather than as print. A rough single-sample pass
   covers the gap while a slider is moving.

   And the view plate is screened from a PROXY: the source, decimated to about
   900k pixels. A cell mean is an average, so averaging a decimated copy lands
   within a rounding error of the real thing, and it turns a 400ms drag into a
   60ms one. The export plate always uses the full source.
   ========================================================================= */
(function () {
    'use strict';

    var ST = window.SCREENTONE;
    var S = window.SRCH;
    var el = function (id) { return document.getElementById(id); };
    var D2R = Math.PI / 180;

    /* ── Header furniture ────────────────────────────────────────────────────
       No clock and no trace on this one: the control strip is the readout, and
       it reports something the page can actually be judged by. */
    S.themeSwitch(el('themeSw'));
    if (window.CAS) CAS.pageTransition();

    /* ── Budgets ─────────────────────────────────────────────────────────────
       Measured on a 2048² source: the proxy accumulation lands at ~60ms and a
       view plate at ~20ms with smoothing off, which is what makes a slider
       drag feel attached to the picture. */
    var SRC_CAP       = 4096;        /* longest edge of the source we keep    */
    var PROXY_BUDGET  = 900000;      /* pixels in the decimated screening copy*/
    var QUICK_MS      = 40;          /* compute allowed for the rough pass    */
    var MIN_CELL_PX   = 3;           /* output pixels a cell needs to be drawn*/
    var EXPORT_BUDGET = 24000000;    /* pixels in the export plate            */
    var BAND_MS       = 14;          /* compute per slice of a banded render  */
    var SPECULATE_MS  = 5000;        /* past this, wait to be asked           */
    /* Cell accumulators are the one structure that grows without bound: their
       size is set by how many CELLS the image holds, which is a function of
       pitch alone and does not shrink when the source does. A fine screen on a
       very large plate can ask for tens of millions of them, four times over
       in CMYK. Past this, area sampling gives way to per-pixel — which at that
       pitch is nearly the same answer anyway, because a cell that small holds
       barely more than the pixels a bilinear tap already reads. */
    var ACC_BYTES     = 96000000;

    /* ── State ───────────────────────────────────────────────────────────── */

    var st = {
        name: '', srcCanvas: null,
        full: null,                  /* source bundle at native resolution    */
        proxy: null,                 /* decimated bundle for the view plate   */
        viewCanvas: null, viewScaleOf: 1,
        outCanvas: null, outKey: '',
        job: null,
        showSource: false, showLattice: false,
        /* The view transform is in SOURCE pixels per screen pixel, not canvas
           pixels — the canvas underneath changes size with the render scale,
           and a transform defined against it could never be stable. */
        view: { scale: 1, x: 0, y: 0, fit: true }
    };

    var view = el('view'), vctx = view.getContext('2d');
    var wrap = el('wrap');

    /* ── Controls ────────────────────────────────────────────────────────── */

    (function fillShapes() {
        var sel = el('uShape');
        ST.SHAPES.forEach(function (s) {
            var o = document.createElement('option');
            o.value = s.id; o.textContent = s.name;
            sel.appendChild(o);
        });
        sel.value = 'round';
    })();

    var sliders = Array.prototype.slice.call(document.querySelectorAll('input[data-u][type="range"]'));

    function num(id) { return parseFloat(el(id).value); }

    function params() {
        return {
            pitch:   num('uPitch'),
            angle:   num('uAngle'),
            shape:   el('uShape').value,
            ss:      parseInt(S.r('ss'), 10) || 1,
            samp:    S.r('samp') || 'area',
            black:   num('uBlack') / 100,
            white:   num('uWhite') / 100,
            gamma:   num('uGamma') / 100,
            gain:    num('uGain') / 100,
            steps:   num('uSteps'),
            invert:  el('uInvert').checked,
            ink:     S.r('ink') || 'mono',
            inkCol:  el('uInk').value,
            ink2Col: el('uInk2').value,
            split:   num('uSplit') / 100,
            gcr:     num('uGcr') / 100,
            paper:   el('uPaper').value,
            alpha:   el('uAlpha').checked,
            over:    el('uOver').checked,
            strength: num('uStrength') / 100,
            edge:    el('uEdge').checked,
            edgeAmt: num('uEdgeAmt') / 100,
            edgeThr: num('uEdgeThr') / 100,
            scale:   num('uScale')
        };
    }

    /* One lattice per ink. Black takes the angle you set and the rest are
       placed around it: 30° apart is the separation at which two screens stop
       beating, and yellow breaks the rule at 15° because yellow on white is
       the one ink whose pattern nobody can see anyway. */
    function angles(p) {
        var a = p.angle * D2R;
        if (p.ink === 'cmyk') return [a - 30 * D2R, a + 30 * D2R, a - 45 * D2R, a];
        if (p.ink === 'duo')  return [a, a + 30 * D2R];
        return [a];
    }

    function angleDegs(p) {
        return angles(p).map(function (r) {
            var d = Math.round(r / D2R) % 180;
            return (d + 180) % 180;
        });
    }

    /* ── Presets ─────────────────────────────────────────────────────────────
       Read off what the process actually was rather than invented. The eras
       differ mostly in how coarse the screen ran and how much the ink spread
       once it hit the stock.

       A word on why these look lighter than a filter you may have used. Ink
       coverage is 1 − LINEAR luminance, so a plain mid grey — sRGB 128 — is a
       78% dot, not a 50% one. Halftones are genuinely inkier than people
       expect, and stacking much dot gain on top of that puts the whole
       midtone a stop down. Measured on a mid-toned photograph, the first pass
       at these presets rendered 0.063 mean linear against a 0.19 source; the
       gain figures below are what brings that back. */

    var PRESETS = {
        'NEWSPRINT': {
            uPitch: 9, uAngle: 45, uShape: 'round', ss: '3', samp: 'area',
            uBlack: 3, uWhite: 98, uGamma: 92, uGain: 14, uSteps: 0, uInvert: false,
            ink: 'mono', uInk: '#1a1a1a', uPaper: '#e6e0cf',
            uEdge: false, uEdgeAmt: 80, uEdgeThr: 30, uScale: 1, uAlpha: false, uOver: false, uStrength: 100
        },
        'COMIC BOOK': {
            uPitch: 6, uAngle: 45, uShape: 'round', ss: '3', samp: 'area',
            uBlack: 8, uWhite: 96, uGamma: 88, uGain: 6, uSteps: 0, uInvert: false,
            ink: 'mono', uInk: '#101010', uPaper: '#f6f0dd',
            uEdge: true, uEdgeAmt: 70, uEdgeThr: 34, uScale: 1, uAlpha: false, uOver: false, uStrength: 100
        },
        'MANGA TONE': {
            uPitch: 5, uAngle: 45, uShape: 'round', ss: '3', samp: 'area',
            uBlack: 12, uWhite: 92, uGamma: 82, uGain: 0, uSteps: 6, uInvert: false,
            ink: 'mono', uInk: '#000000', uPaper: '#ffffff',
            uEdge: true, uEdgeAmt: 88, uEdgeThr: 28, uScale: 2, uAlpha: false, uOver: false, uStrength: 100
        },
        'RISO DUO': {
            uPitch: 8, uAngle: 45, uShape: 'ellipse', ss: '3', samp: 'area',
            uBlack: 0, uWhite: 100, uGamma: 78, uGain: 4, uSteps: 0, uInvert: false,
            ink: 'duo', uInk: '#ff4f7a', uInk2: '#1257c9', uSplit: 52, uPaper: '#f2ecdc',
            uEdge: false, uEdgeAmt: 80, uEdgeThr: 30, uScale: 1, uAlpha: false, uOver: false, uStrength: 100
        },
        'CMYK PROCESS': {
            uPitch: 6, uAngle: 45, uShape: 'ellipse', ss: '3', samp: 'area',
            uBlack: 0, uWhite: 100, uGamma: 94, uGain: 4, uSteps: 0, uInvert: false,
            ink: 'cmyk', uGcr: 70, uPaper: '#fbfaf6',
            uEdge: false, uEdgeAmt: 80, uEdgeThr: 30, uScale: 1, uAlpha: false, uOver: false, uStrength: 100
        },
        'LINE SCREEN': {
            uPitch: 7, uAngle: 45, uShape: 'line', ss: '3', samp: 'area',
            uBlack: 4, uWhite: 98, uGamma: 88, uGain: 0, uSteps: 0, uInvert: false,
            ink: 'mono', uInk: '#141414', uPaper: '#f4f1e8',
            uEdge: false, uEdgeAmt: 80, uEdgeThr: 30, uScale: 1, uAlpha: false, uOver: false, uStrength: 100
        },
        'ENGRAVING': {
            uPitch: 6, uAngle: 45, uShape: 'cross', ss: '4', samp: 'detail',
            uBlack: 5, uWhite: 99, uGamma: 96, uGain: -14, uSteps: 0, uInvert: false,
            ink: 'mono', uInk: '#1b1a17', uPaper: '#eee7d4',
            uEdge: true, uEdgeAmt: 50, uEdgeThr: 42, uScale: 2, uAlpha: false, uOver: false, uStrength: 100
        },
        'TONE OVER': {
            uPitch: 7, uAngle: 45, uShape: 'round', ss: '3', samp: 'area',
            uBlack: 0, uWhite: 100, uGamma: 120, uGain: 0, uSteps: 0, uInvert: false,
            ink: 'mono', uInk: '#0d0d0d', uPaper: '#ffffff',
            uEdge: false, uEdgeAmt: 80, uEdgeThr: 30, uScale: 1, uAlpha: false,
            uOver: true, uStrength: 58
        },
        'PHOTOCOPY': {
            uPitch: 4, uAngle: 45, uShape: 'euclidean', ss: '1', samp: 'detail',
            uBlack: 10, uWhite: 93, uGamma: 80, uGain: 2, uSteps: 0, uInvert: false,
            ink: 'mono', uInk: '#232323', uPaper: '#eceae4',
            uEdge: false, uEdgeAmt: 80, uEdgeThr: 30, uScale: 1, uAlpha: false, uOver: false, uStrength: 100
        }
    };
    var DEFAULT_PRESET = 'NEWSPRINT';
    var activePreset = DEFAULT_PRESET;

    function applyPreset(name) {
        var p = PRESETS[name];
        if (!p) return;
        activePreset = name;
        Object.keys(p).forEach(function (k) {
            var node = el(k);
            if (node) {
                if (node.type === 'checkbox') node.checked = !!p[k];
                else node.value = p[k];
                return;
            }
            /* Not an id — then it names a radio group. */
            var r = document.querySelector('input[name="' + k + '"][value="' + p[k] + '"]');
            if (r) r.checked = true;
        });
        Array.prototype.forEach.call(el('presets').children, function (b) {
            b.classList.toggle('latched', b.textContent === name);
        });
        syncUI();
        schedule(true);
    }

    Object.keys(PRESETS).forEach(function (name) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'key';
        b.textContent = name;
        b.addEventListener('click', function () { applyPreset(name); });
        el('presets').appendChild(b);
    });

    /* ── Swatches ────────────────────────────────────────────────────────── */

    function swatches(host, list, target) {
        list.forEach(function (hex) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'key sw';
            b.style.background = hex;
            b.title = hex.toUpperCase();
            b.setAttribute('aria-label', 'Set to ' + hex);
            b.addEventListener('click', function () {
                el(target).value = hex;
                syncUI();
                schedule(true);
            });
            host.appendChild(b);
        });
    }
    swatches(el('inkSw'),
             ['#141414', '#000000', '#1b3b6f', '#ff4f7a', '#1257c9', '#00a95c', '#6b3f23', '#8b1a1a'],
             'uInk');
    swatches(el('paperSw'),
             ['#ffffff', '#f4f1e8', '#e6e0cf', '#ddd0ae', '#e3e7ee', '#141414'],
             'uPaper');

    /* ── Label sync ──────────────────────────────────────────────────────── */

    function fmt(s) {
        var v = parseFloat(s.value);
        switch (s.dataset.fmt) {
            case 'px':     return v.toFixed(1) + ' PX';
            case 'deg':    return v + '°';
            case 'pct':    return v + '%';
            case 'signed': return (v > 0 ? '+' : '') + v + '%';
            case 'gamma':  return (v / 100).toFixed(2);
            case 'steps':  return v > 1 ? v + ' LEVELS' : 'OFF';
            case 'mult':   return v + '×';
        }
        return String(v);
    }

    var INK_NAMES = ['CYAN', 'MAGENTA', 'YELLOW', 'BLACK'];

    function syncUI() {
        var p = params();

        sliders.forEach(function (s) {
            var row = s.closest('.sl');
            if (!row) return;
            row.querySelector('.val').textContent = fmt(s);
            var base = PRESETS[activePreset] && PRESETS[activePreset][s.id];
            row.classList.toggle('moved', base !== undefined && parseFloat(s.value) !== base);
        });

        el('inkHex').textContent = p.inkCol.toUpperCase();
        el('ink2Hex').textContent = p.ink2Col.toUpperCase();
        el('paperHex').textContent = p.paper.toUpperCase();

        /* Panels that only mean something for one plate arrangement. */
        Array.prototype.forEach.call(document.querySelectorAll('[data-when]'), function (n) {
            n.hidden = n.getAttribute('data-when').split(/\s+/).indexOf(p.ink) < 0;
        });

        /* Linework has its own strength controls; grey them rather than hide
           them, so you can see what turning it on is about to do. */
        el('uEdgeAmt').disabled = !p.edge;
        el('uEdgeThr').disabled = !p.edge;
        el('uAlpha').disabled = p.over;

        if (p.ink === 'cmyk') {
            var degs = angleDegs(p), cols = [ST.PROCESS.c, ST.PROCESS.m, ST.PROCESS.y, ST.PROCESS.k];
            el('angleOut').innerHTML = degs.map(function (d, i) {
                return '<span><i style="background:' + cols[i] + '"></i>' +
                       INK_NAMES[i] + ' ' + d + '°</span>';
            }).join('');
        }

        var src = st.full;
        if (src) {
            var W = Math.round(src.w * p.scale), H = Math.round(src.h * p.scale);
            el('oDim').textContent = W + ' × ' + H;
            el('oPitch').textContent = (p.pitch * p.scale).toFixed(1) + ' px';
            el('oCells').textContent = Math.round(src.w * src.h / (p.pitch * p.pitch)).toLocaleString();
            /* Say so when the pitch has pushed area sampling past what will
               fit — a readout that keeps claiming AREA would be lying. */
            var fell = p.samp === 'area' && !areaPossible(p);
            el('fScreen').textContent = p.pitch.toFixed(1) + 'px @' + Math.round(p.angle) + '°' +
                                        (fell ? ' · DETAIL' : '');
        }

        /* The strip needs no image, so it is the one thing on the page that
           works before you have loaded anything — which makes it the obvious
           place to go and find out what a shape or an angle does. */
        drawStrip();
    }

    /* ── Control strip ───────────────────────────────────────────────────────
       The colour bar a press lays down the trim edge of every sheet: a solid
       and a few tints of each ink, printed by the same plates as the job, so a
       pressman can read what the screen is actually doing to known values
       without having to find them in the picture.

       Ours is the real article rather than a picture of one — the same
       renderer, the same pitch, angle, shape, inks and paper. Change the
       screen and the strip changes with it, which makes it the fastest way to
       see what a shape or a dot-gain setting does to a 25% tint. */

    var STRIP_TINTS = [1, 0.75, 0.5, 0.25, 0.1];
    var STRIP_H = 26, STRIP_W = 30;

    function drawStrip() {
        var cv = el('strip');
        if (!cv || !cv.getContext) return;
        var p = params();
        var angs = angles(p);
        var np = angs.length;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var W = STRIP_W * STRIP_TINTS.length * np, H = STRIP_H;
        var OW = Math.round(W * dpr), OH = Math.round(H * dpr);

        var cols = inkColours(p);
        var planes = [], i, j, x, y;
        for (i = 0; i < np; i++) {
            var data = new Uint8Array(W * H);
            for (j = 0; j < STRIP_TINTS.length; j++) {
                var x0 = (i * STRIP_TINTS.length + j) * STRIP_W;
                var v = (STRIP_TINTS[j] * 255 + 0.5) | 0;
                for (y = 0; y < H; y++) {
                    for (x = x0; x < x0 + STRIP_W; x++) data[y * W + x] = v;
                }
            }
            var g = ST.grid(W, H, p.pitch, angs[i]);
            planes.push({
                co: g.co, si: g.si, u0: g.u0, v0: g.v0, cw: g.cw,
                cells: null, plane: data,
                ink: cols[i], multiply: p.ink === 'cmyk',
                edge: null, edgeLut: null
            });
        }

        var cfg = {
            w: W, h: H, scale: dpr, cellSrc: p.pitch,
            screen: ST.buildScreen(p.shape), samples: 3, planes: planes,
            paper: ST.hexLin(p.paper), alpha: false,
            outW: OW, outH: OH, buf: new Uint8ClampedArray(OW * OH * 4)
        };
        ST.render(cfg);

        if (cv.width !== OW || cv.height !== OH) {
            cv.width = OW; cv.height = OH;
            cv.style.width = W + 'px'; cv.style.height = H + 'px';
        }
        cv.getContext('2d').putImageData(new ImageData(cfg.buf, OW, OH), 0, 0);
    }

    /* ── Source bundles ──────────────────────────────────────────────────────
       A bundle is an ImageData plus everything derived from it that no control
       can change, plus the caches for everything a control CAN change. */

    function bundle(img) {
        return {
            img: img, w: img.width, h: img.height,
            an: ST.analyse(img),
            geomKey: '', geom: null,
            accKey: '', acc: null,
            covKey: '', cov: null
        };
    }

    function geomOf(b, p) {
        var key = [p.pitch, p.angle, p.ink].join('|');
        if (b.geomKey === key && b.geom) return b.geom;
        var angs = angles(p);
        var f = b.w / st.full.w;                 /* proxy scale, 1 for the full */
        var cell = p.pitch * f;
        b.geom = {
            cell: cell,
            angs: angs,
            grids: angs.map(function (a) { return ST.grid(b.w, b.h, cell, a); })
        };
        b.geomKey = key;
        return b.geom;
    }

    /* Would the accumulators for this configuration fit? Cell count is set by
       the image's size in CELLS, which is the same whichever bundle screens
       it, so this is one answer for the whole page. */
    function areaPossible(p) {
        if (!st.full) return true;
        var g = ST.grid(st.full.w, st.full.h, p.pitch, p.angle * D2R);
        var n = angles(p).length;
        var stride = p.ink === 'cmyk' ? 3 : 1;
        return g.cw * g.ch * n * (4 * stride + 4) <= ACC_BYTES;
    }

    function accOf(b, p, g) {
        if (p.samp !== 'area' || !areaPossible(p)) return null;
        var key = [b.geomKey, p.ink].join('|');
        if (b.accKey === key && b.acc) return b.acc;
        b.acc = null;                       /* release the old set before the new */
        b.acc = g.grids.map(function (grid) {
            return p.ink === 'cmyk'
                ? ST.accumRGB(b.img, grid, g.cell)
                : ST.accumLum(b.an.lum, b.w, b.h, grid, g.cell);
        });
        b.accKey = key;
        return b.acc;
    }

    function toneKey(p) {
        return [p.samp, p.black, p.white, p.gamma, p.gain, p.steps, p.invert,
                p.ink, p.gcr, p.split,
                /* The separation solves against the paper, so a four-colour
                   plate has to be rebuilt when the stock changes. One ink does
                   not — and rebuilding a per-pixel plane it did not need is a
                   pass over the whole source for nothing. */
                p.ink === 'cmyk' ? p.paper : ''].join(',');
    }

    /* Coverage: one number per cell (AREA) or one per source pixel (DETAIL),
       for each ink, in the order the plates print. */
    function coverageOf(b, p, g, acc) {
        /* Per-pixel coverage does not depend on the lattice at all, so dragging
           the pitch slider in DETAIL mode must not throw the planes away. */
        var key = (acc ? b.geomKey : 'px') + '|' + toneKey(p) + '|' + (acc ? 'A' : 'D');
        if (b.covKey === key && b.cov) return b.cov;

        var curve = ST.makeCurve({
            black: p.black, white: p.white,
            gamma: p.gamma, gain: p.gain, steps: p.steps, invert: p.invert
        });
        var out;

        if (acc) {
            if (p.ink === 'cmyk') {
                /* Each plate has its own lattice, so each needs its own
                   separation — take the one channel from each. */
                var sepA = separator(p);
                out = acc.map(function (a, i) {
                    return { cells: ST.cellCoverageCMYK(a, curve, sepA)[i] };
                });
            } else {
                out = acc.map(function (a) { return { cells: ST.cellCoverage(a, curve) }; });
                if (p.ink === 'duo') out[1].cells = splitCells(out[1].cells, p.split);
            }
        } else {
            var table = ST.curveTable(curve);
            if (p.ink === 'cmyk') {
                out = ST.pixelPlanesCMYK(b.img, table, separator(p)).map(function (d) {
                    return { plane: d };
                });
            } else {
                var one = ST.pixelPlane(b.an.lum, table);
                out = [{ plane: one }];
                if (p.ink === 'duo') out.push({ plane: splitPlane(one, p.split) });
            }
        }

        b.cov = out; b.covKey = key;
        return out;
    }

    /* The second plate of a duotone carries only what lies below the split, so
       it colours the shadows without touching the highlights the first ink is
       already covering. */
    function splitCells(src, split) {
        var out = new Float32Array(src.length), k = 1 / Math.max(0.02, 1 - split);
        for (var i = 0; i < src.length; i++) {
            var a = (src[i] - split) * k;
            out[i] = a < 0 ? 0 : (a > 1 ? 1 : a);
        }
        return out;
    }
    function splitPlane(src, split) {
        var out = new Uint8Array(src.length), k = 255 / Math.max(0.02, 1 - split), s = split * 255;
        for (var i = 0; i < src.length; i++) {
            var a = (src[i] - s) * k / 255;
            out[i] = a < 0 ? 0 : (a > 255 ? 255 : a);
        }
        return out;
    }

    function edgeTable(p) {
        if (!p.edge) return null;
        var t = new Float32Array(256), thr = p.edgeThr * 255, w = 34;
        for (var i = 0; i < 256; i++) {
            var x = (i - thr) / w;
            x = x < 0 ? 0 : (x > 1 ? 1 : x);
            t[i] = x * x * (3 - 2 * x) * p.edgeAmt;
        }
        return t;
    }

    function separator(p) {
        return ST.makeSeparator(inkColours(p), ST.hexLin(p.paper), p.gcr);
    }

    function inkColours(p) {
        if (p.ink === 'cmyk') {
            return [ST.hexLin(ST.PROCESS.c), ST.hexLin(ST.PROCESS.m),
                    ST.hexLin(ST.PROCESS.y), ST.hexLin(ST.PROCESS.k)];
        }
        if (p.ink === 'duo') return [ST.hexLin(p.inkCol), ST.hexLin(p.ink2Col)];
        return [ST.hexLin(p.inkCol)];
    }

    /* Everything render() needs, assembled from the caches above. */
    function config(b, p, scale, samples) {
        var g = geomOf(b, p);
        var acc = accOf(b, p, g);
        var cov = coverageOf(b, p, g, acc);
        var cols = inkColours(p);
        var mul = p.ink === 'cmyk';
        var et = edgeTable(p);
        var edgeOn = et ? (p.ink === 'cmyk' ? 3 : 0) : -1;

        var planes = cov.map(function (c, i) {
            var grid = g.grids[i];
            return {
                co: grid.co, si: grid.si, u0: grid.u0, v0: grid.v0,
                cw: grid.cw, cells: c.cells || null, plane: c.plane || null,
                ink: cols[i], multiply: mul,
                edge: i === edgeOn ? b.an.edge : null,
                edgeLut: i === edgeOn ? et : null
            };
        });

        var W = Math.max(1, Math.round(b.w * scale));
        var H = Math.max(1, Math.round(b.h * scale));
        return {
            w: b.w, h: b.h, scale: scale, cellSrc: g.cell,
            screen: ST.buildScreen(p.shape),
            samples: samples, planes: planes,
            paper: ST.hexLin(p.paper),
            /* Printing over the picture and knocking the paper out to alpha
               are the same request answered two ways, and asking for both at
               once has no meaning — so overlay wins and the checkbox greys. */
            alpha: p.alpha && !p.over,
            base: p.over ? b.img.data : null,
            strength: p.strength,
            outW: W, outH: H, buf: new Uint8ClampedArray(W * H * 4)
        };
    }

    function toCanvas(cfg) {
        var c = document.createElement('canvas');
        c.width = cfg.outW; c.height = cfg.outH;
        c.getContext('2d').putImageData(new ImageData(cfg.buf, cfg.outW, cfg.outH), 0, 0);
        return c;
    }

    /* ── The view plate ──────────────────────────────────────────────────── */

    function fitScale() {
        var b = boxSize(), src = st.full;
        if (!src || !b.w || !b.h) return 1;
        return Math.min((b.w - 24) / src.w, (b.h - 24) / src.h);
    }

    function currentScale() {
        return st.view.fit ? fitScale() : st.view.scale;
    }

    /* How many output pixels fit in a given number of milliseconds. */
    function budgetPixels(ms, planes, samples) {
        return Math.max(40000, ms / costMs(1, planes, samples));
    }

    /* The rough pass. It exists to move with the slider, nothing more: one
       sample per pixel, at whatever resolution fits inside a frame or two. The
       exact plate lands a moment later and replaces it. */
    function renderQuick() {
        if (!st.proxy) return;
        var p = params();
        var np = angles(p).length;

        /* Never finer than the plate itself — there is nothing beyond it to
           show — and never so coarse that a cell has no pixels to be drawn in,
           which is what turns a screen into a field of moiré blobs. */
        var want = Math.min(p.scale, Math.max(currentScale(), MIN_CELL_PX / p.pitch));
        var cap = Math.sqrt(budgetPixels(QUICK_MS, np, 1) / (st.full.w * st.full.h));
        if (want > cap) want = cap;
        if (want < 0.04) want = 0.04;

        /* The proxy is only a shortcut while it has more pixels than the plate
           being drawn from it, and while a cell still covers enough of them to
           be an average of anything. Zoom in, or ask for a fine pitch, and the
           full source takes over. */
        var b = st.proxy;
        if (b !== st.full) {
            var f = b.w / st.full.w;
            if (want > f || p.pitch * f < 3) b = st.full;
        }

        var t0 = performance.now();
        var cfg;
        try {
            cfg = config(b, p, want * (st.full.w / b.w), 1);
            ST.render(cfg);
        } catch (err) {
            if (window.CAS) CAS.toast('OUT OF MEMORY — TRY A COARSER PITCH', true);
            return;
        }
        st.viewCanvas = toCanvas(cfg);
        st.viewScaleOf = want;
        el('fMs').textContent = Math.round(performance.now() - t0) + 'ms';
        el('fOut').textContent = Math.round(st.full.w * p.scale) + '×' +
                                 Math.round(st.full.h * p.scale);
        el('saveBtn').disabled = false;
        lamp();
        draw();
    }

    /* ── The export plate ────────────────────────────────────────────────────
       Banded, so a 24-megapixel four-colour render does not freeze the tab,
       and cancellable, so moving a slider mid-render costs nothing. */

    function exportKey(p) {
        return [p.pitch, p.angle, p.shape, p.ss, p.scale, p.alpha, p.paper,
                p.over, p.strength,
                p.inkCol, p.ink2Col, p.edge, p.edgeAmt, p.edgeThr,
                toneKey(p)].join('|');
    }

    function cancelJob() {
        if (st.job) { clearTimeout(st.job.timer); st.job = null; }
        progress(0);
    }

    function progress(f) {
        el('progBar').style.width = (f > 0 && f < 1 ? f * 100 : 0) + '%';
    }

    /* Roughly what a plate will cost, in milliseconds. Fitted to measurements
       on this engine — 4.3 megapixels came out at 262ms for one plate with no
       supersampling, 418ms at 3×, and 1555ms for four plates at 3×. It only
       has to be right to within a factor of two: it decides whether to pull a
       plate speculatively, and how thick a band can be before it eats a frame. */
    function costMs(px, planes, samples) {
        return px * (30 + 25 * planes + 7 * planes * samples * samples) / 1e6;
    }

    function startExport(done) {
        var p = params();
        var key = exportKey(p);

        if (st.outKey === key && st.outCanvas) { if (done) done(st.outCanvas); return; }
        if (st.job && st.job.key === key) { if (done) st.job.done.push(done); return; }
        cancelJob();
        if (!st.full) return;

        var scale = p.scale;
        var cap = Math.sqrt(EXPORT_BUDGET / (st.full.w * st.full.h));
        if (scale > cap) {
            scale = Math.max(1, Math.floor(cap));
            if (window.CAS) CAS.toast('PLATE SCALE HELD AT ' + scale + '× (SIZE LIMIT)', true);
        }

        var cfg;
        try {
            cfg = config(st.full, p, scale, p.ss);
        } catch (err) {
            if (window.CAS) CAS.toast('PLATE TOO LARGE FOR MEMORY', true);
            return;
        }

        /* Slice it so one band is about one frame of work. A band that takes
           longer than that is a dropped frame however many setTimeouts wrap
           it, and a band much shorter than that is all timer overhead. */
        var perPx = costMs(1, cfg.planes.length, cfg.samples);
        var rows = Math.max(1, Math.min(cfg.outH, Math.round(BAND_MS / (perPx * cfg.outW))));
        st.job = { key: key, cfg: cfg, y: 0, t0: performance.now(), timer: 0, done: done ? [done] : [] };
        lamp();

        (function step() {
            var j = st.job;
            if (!j) return;
            cfg.y0 = j.y;
            cfg.y1 = Math.min(cfg.outH, j.y + rows);
            ST.render(cfg);
            j.y = cfg.y1;
            progress(j.y / cfg.outH);
            if (j.y < cfg.outH) {
                j.timer = setTimeout(step, 0);
                return;
            }
            st.outCanvas = toCanvas(cfg);
            st.outKey = j.key;
            st.job = null;
            progress(0);
            el('fMs').textContent = Math.round(performance.now() - j.t0) + 'ms';
            /* The finished plate becomes what the stage shows. There is no
               point rendering a second, coarser screen to look at when the
               real one is sitting right here — and a preview screened at the
               STAGE's scale is a genuinely different screen from the one being
               exported: at a 6px pitch shown half size it has three pixels to
               draw a four-ink rosette in, which reads as colour noise rather
               than as print. Drawn down from the real plate instead, the stage
               averages the dots the way the eye does. */
            st.viewCanvas = st.outCanvas;
            st.viewScaleOf = scale;
            lamp();
            draw();
            j.done.forEach(function (fn) { fn(st.outCanvas); });
        })();
    }

    function lamp() {
        var working = !!st.job;
        var ready = st.outCanvas && st.outKey === exportKey(params());
        el('vStat').textContent = !st.viewCanvas ? 'IDLE'
                                : working ? 'PULLING PLATE'
                                : ready ? 'PLATE READY' : 'PREVIEW';
        el('vLed').className = 'led' + (st.viewCanvas ? (ready ? ' on green' : ' on') : '');
        if (st.full) {
            var p = params();
            el('dockStat').textContent = Math.round(st.full.w * p.scale) + '×' +
                                         Math.round(st.full.h * p.scale) + ' · ' +
                                         (p.ink === 'cmyk' ? '4 PLATES'
                                          : p.ink === 'duo' ? '2 PLATES' : '1 PLATE');
        }
    }

    /* ── Scheduling ──────────────────────────────────────────────────────────
       Two passes at two latencies. The rough one lands on the next frame so
       the picture moves with the slider. The real plate starts once the hand
       stops and arrives banded, taking over the stage when it is done — so
       what you end up looking at is always the file you would export, never a
       second screen made to approximate it. */

    var rafId = 0, fullTimer = 0;

    function schedule(immediate) {
        if (!st.proxy) { syncUI(); return; }
        st.outKey = '';                       /* whatever is cached is now stale */
        cancelJob();

        if (!rafId) {
            rafId = requestAnimationFrame(function () {
                rafId = 0;
                renderQuick();
            });
        }

        /* Pull the plate ahead of being asked. It is banded, so the cost is
           CPU rather than a stalled tab — but a four-plate render of a large
           source at 4× is still ten seconds of work, and spending that after
           every slider release to preview something nobody may look at is
           rude. Past the threshold it waits for the button. */
        clearTimeout(fullTimer);
        var p = params();
        var cost = costMs(st.full.w * st.full.h * p.scale * p.scale,
                          angles(p).length, p.ss);
        if (cost <= SPECULATE_MS) {
            fullTimer = setTimeout(function () { startExport(null); }, immediate ? 220 : 400);
        }
    }

    /* ── Load ────────────────────────────────────────────────────────────── */

    function loadFile(file) {
        if (!file || !/^image\//.test(file.type)) {
            if (window.CAS) CAS.toast('NOT AN IMAGE', true);
            return;
        }
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
            URL.revokeObjectURL(url);
            var w = img.naturalWidth, h = img.naturalHeight;
            var k = Math.min(1, SRC_CAP / Math.max(w, h));
            if (k < 1) {
                w = Math.round(w * k); h = Math.round(h * k);
                if (window.CAS) CAS.toast('FITTED TO ' + w + '×' + h, true);
            }

            /* Composited onto white first. A halftone has no way to express
               "nothing here" — an alpha hole would otherwise screen as solid
               ink, which is the opposite of what it means. */
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            var cx = c.getContext('2d', { willReadFrequently: true });
            cx.fillStyle = '#ffffff';
            cx.fillRect(0, 0, w, h);
            cx.drawImage(img, 0, 0, w, h);

            st.name = file.name || 'pasted';
            st.srcCanvas = c;
            st.full = bundle(cx.getImageData(0, 0, w, h));
            st.proxy = makeProxy(c, w, h);
            st.outCanvas = null; st.outKey = '';

            el('sName').textContent = st.name.length > 24 ? st.name.slice(0, 22) + '…' : st.name;
            el('sSize').textContent = w + ' × ' + h;
            el('fSrc').textContent = w + '×' + h;
            el('hint').style.display = 'none';
            wrap.classList.add('has-img');
            st.view.fit = true;
            syncUI();
            schedule(true);
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            if (window.CAS) CAS.toast('COULD NOT DECODE THAT FILE', true);
        };
        img.src = url;
    }

    /* The decimated copy the view plate is screened from. Drawn through the
       browser's own downscaler, which box-filters — the right thing here,
       since every value it produces is a mean of the pixels it replaced and a
       mean is exactly what a cell wants. */
    function makeProxy(canvas, w, h) {
        var n = w * h;
        if (n <= PROXY_BUDGET) return st.full;
        var k = Math.sqrt(PROXY_BUDGET / n);
        var pw = Math.max(2, Math.round(w * k)), ph = Math.max(2, Math.round(h * k));
        var c = document.createElement('canvas');
        c.width = pw; c.height = ph;
        var cx = c.getContext('2d', { willReadFrequently: true });
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(canvas, 0, 0, pw, ph);
        return bundle(cx.getImageData(0, 0, pw, ph));
    }

    /* ── View ────────────────────────────────────────────────────────────────
       The canvas is the size of its box and never changes; the plate is placed
       inside it by a transform. Scale is screen pixels per SOURCE pixel, so it
       stays meaningful while the plate under it is re-rendered at whatever
       resolution the stage happens to need. */

    var LADDER = [1 / 16, 1 / 12, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3,
                  1, 1.5, 2, 3, 4, 6, 8, 12, 16];

    function boxSize() { return { w: wrap.clientWidth, h: wrap.clientHeight }; }

    function activeCanvas() {
        return st.showSource ? st.srcCanvas : st.viewCanvas;
    }
    function activeRenderScale() {
        return st.showSource ? 1 : st.viewScaleOf;
    }

    function centre() {
        if (!st.full) return;
        var b = boxSize(), s = currentScale();
        st.view.x = (b.w - st.full.w * s) / 2;
        st.view.y = (b.h - st.full.h * s) / 2;
    }

    function doFit() {
        st.view.fit = true;
        st.view.scale = fitScale();
        centre();
        draw();
        scheduleZoom();
    }

    function nearestRung(s) {
        var best = 0, bd = Infinity;
        for (var i = 0; i < LADDER.length; i++) {
            var d = Math.abs(Math.log(LADDER[i] / s));
            if (d < bd) { bd = d; best = i; }
        }
        return best;
    }

    /* Keep the plate reachable: at least a quarter of it stays in the box, so
       a stray drag can never fling it somewhere you cannot get it back. */
    function clampPan() {
        if (!st.full) return;
        var b = boxSize(), s = currentScale();
        var w = st.full.w * s, h = st.full.h * s;
        var mx = Math.min(w, b.w) * 0.25, my = Math.min(h, b.h) * 0.25;
        st.view.x = Math.min(b.w - mx, Math.max(mx - w, st.view.x));
        st.view.y = Math.min(b.h - my, Math.max(my - h, st.view.y));
    }

    /* Zoom about a point in box coordinates, so the dot under the cursor stays
       under the cursor. */
    function zoomTo(rung, cx, cy) {
        if (!st.full) return;
        var b = boxSize();
        if (cx === undefined) { cx = b.w / 2; cy = b.h / 2; }
        var oldS = currentScale();
        var newS = LADDER[Math.max(0, Math.min(LADDER.length - 1, rung))];
        var ax = (cx - st.view.x) / oldS, ay = (cy - st.view.y) / oldS;
        st.view.fit = false;
        st.view.scale = newS;
        st.view.x = cx - ax * newS;
        st.view.y = cy - ay * newS;
        clampPan();
        draw();
        scheduleZoom();
    }

    function stepZoom(dir, cx, cy) {
        zoomTo(nearestRung(currentScale()) + dir, cx, cy);
    }

    /* A zoom changes the resolution the plate should be screened at, so it has
       to re-render — but only once the wheel stops. */
    var zoomTimer = 0;
    function scheduleZoom() {
        clearTimeout(zoomTimer);
        zoomTimer = setTimeout(function () {
            /* Once the real plate is up, zooming is pure transform — it is
               already at export resolution and there is nothing better to
               render. Only the rough pass, which is screened at the stage's
               own scale, has to be redone. */
            if (!st.proxy || st.showSource) return;
            if (st.outCanvas && st.outKey === exportKey(params())) return;
            renderQuick();
        }, 200);
    }

    function draw() {
        var b = boxSize();
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (view.width !== Math.round(b.w * dpr) || view.height !== Math.round(b.h * dpr)) {
            view.width = Math.round(b.w * dpr);
            view.height = Math.round(b.h * dpr);
            view.style.width = b.w + 'px';
            view.style.height = b.h + 'px';
        }
        vctx.setTransform(1, 0, 0, 1, 0, 0);
        vctx.clearRect(0, 0, view.width, view.height);

        var cv = activeCanvas();
        if (!cv) { el('zoomVal').textContent = 'FIT'; return; }
        if (st.view.fit) { st.view.scale = fitScale(); centre(); }

        var s = st.view.scale;
        var k = s / activeRenderScale();          /* canvas px → screen px */
        vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        /* Upscaling shows the plate's own pixels, which is the point. Down-
           scaling gets filtered, because nearest-neighbour on a dot pattern is
           a moiré generator. */
        vctx.imageSmoothingEnabled = k < 1;
        vctx.drawImage(cv, st.view.x, st.view.y, cv.width * k, cv.height * k);

        el('zoomVal').textContent = st.view.fit
            ? 'FIT ' + Math.round(s * 100) + '%'
            : (s >= 1 ? Math.round(s * 100) + '%' : (Math.round(s * 1000) / 10) + '%');

        drawLattice(s, dpr);
    }

    /* Where the screens actually are. In four-colour work all four are drawn
       in their own ink, which is the fastest way to see why the angles have to
       differ: overlay two of them at the same angle and the moiré is obvious
       before a single dot is rendered. */
    function drawLattice(s, dpr) {
        if (!st.showLattice || !st.full) return;
        var p = params();
        var step = p.pitch * s;
        /* Below about nine screen pixels the ruling is finer than the thing it
           is meant to explain and the overlay becomes a grey wash. */
        if (step < 9) return;

        var angs = angles(p);
        var cols = p.ink === 'cmyk'
            ? [ST.PROCESS.c, ST.PROCESS.m, ST.PROCESS.y, ST.PROCESS.k]
            : [getComputedStyle(document.documentElement).getPropertyValue('--s1').trim() || '#e5484d',
               getComputedStyle(document.documentElement).getPropertyValue('--s6').trim() || '#4c9aff'];

        /* Four lattices is eight families of lines. Once they stop being
           separable, show the black plate alone rather than all four badly —
           it is the one the angle control names, and one readable lattice
           says more than four overlaid ones. */
        if (step < 9 * angs.length) {
            var last = angs.length - 1;
            angs = [angs[last]];
            cols = [cols[Math.min(last, cols.length - 1)]];
        }

        var W = st.full.w * s, H = st.full.h * s;
        var reach = Math.sqrt(W * W + H * H);

        vctx.save();
        vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        vctx.beginPath();
        vctx.rect(st.view.x, st.view.y, W, H);
        vctx.clip();
        vctx.translate(st.view.x, st.view.y);
        vctx.lineWidth = 1;
        vctx.globalAlpha = 0.55;

        for (var a = 0; a < angs.length; a++) {
            vctx.save();
            vctx.rotate(angs[a]);
            vctx.strokeStyle = cols[a % cols.length];
            vctx.beginPath();
            var n = Math.ceil(reach / step) + 1;
            for (var i = -n; i <= n; i++) {
                var q = i * step;
                vctx.moveTo(q, -reach); vctx.lineTo(q, reach);
                vctx.moveTo(-reach, q); vctx.lineTo(reach, q);
            }
            vctx.stroke();
            vctx.restore();
        }
        vctx.restore();
    }

    /* ── Wiring ──────────────────────────────────────────────────────────── */

    function debounce(fn, ms) {
        var t;
        return function () { clearTimeout(t); t = setTimeout(fn, ms); };
    }

    el('pickBtn').addEventListener('click', function () { el('file').click(); });
    el('file').addEventListener('change', function () {
        if (this.files && this.files[0]) loadFile(this.files[0]);
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
        wrap.addEventListener(ev, function (e) { e.preventDefault(); wrap.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
        wrap.addEventListener(ev, function (e) { e.preventDefault(); wrap.classList.remove('drag'); });
    });
    wrap.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });

    document.addEventListener('paste', function (e) {
        var items = (e.clipboardData || {}).items || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') === 0) { loadFile(items[i].getAsFile()); break; }
        }
    });

    /* One delegated pair, so a control added to the HTML later is live without
       touching this file. Anything the user moves takes them off the preset. */
    var controls = document.querySelector('.controls');
    controls.addEventListener('input', function (e) {
        if (!e.target.matches('[data-u]')) return;
        syncUI();
        schedule(false);
    });
    controls.addEventListener('change', function (e) {
        if (!e.target.matches('[data-u], input[name="ss"], input[name="samp"], input[name="ink"]')) return;
        syncUI();
        schedule(true);
    });

    el('cmpBtn').addEventListener('click', function () {
        if (!st.full) return;
        st.showSource = !st.showSource;
        this.setAttribute('aria-pressed', String(st.showSource));
        this.textContent = st.showSource ? 'SHOW PLATE' : 'SHOW SOURCE';
        draw();
        if (!st.showSource) scheduleZoom();
    });

    el('latBtn').addEventListener('click', function () {
        st.showLattice = !st.showLattice;
        this.setAttribute('aria-pressed', String(st.showLattice));
        draw();
    });

    el('zoomIn').addEventListener('click', function () { stepZoom(1); });
    el('zoomOut').addEventListener('click', function () { stepZoom(-1); });
    el('fitBtn').addEventListener('click', doFit);
    el('oneBtn').addEventListener('click', function () { zoomTo(LADDER.indexOf(1)); });

    wrap.addEventListener('wheel', function (e) {
        if (!st.full) return;
        e.preventDefault();
        var r = wrap.getBoundingClientRect();
        stepZoom(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    var drag = null;
    wrap.addEventListener('pointerdown', function (e) {
        if (!st.full || e.button !== 0) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        wrap.setPointerCapture(e.pointerId);
        wrap.classList.add('panning');
    });
    wrap.addEventListener('pointermove', function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        st.view.x += e.clientX - drag.x;
        st.view.y += e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        /* Panning is a deliberate framing choice, so it leaves FIT — otherwise
           the next draw would recentre and undo the drag. */
        if (st.view.fit) { st.view.fit = false; st.view.scale = currentScale(); }
        clampPan();
        draw();
    });
    function endDrag(e) {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        try { wrap.releasePointerCapture(drag.id); } catch (err) {}
        drag = null;
        wrap.classList.remove('panning');
    }
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);
    wrap.addEventListener('dblclick', function (e) { e.preventDefault(); doFit(); });

    window.addEventListener('resize', debounce(function () {
        if (!st.full) return;
        clampPan();
        draw();
        scheduleZoom();
    }, 180));

    /* ── Export ──────────────────────────────────────────────────────────── */

    function fileName(c) {
        var base = st.name.replace(/\.[^.]+$/, '') || 'plate';
        return base + '_halftone_' + c.width + 'x' + c.height + '.png';
    }

    /* Eight characters, letters and digits, at least one of each. Guaranteeing
       the mix rather than hoping for it matters: one run in nine of a purely
       random eight is all letters, and a name that has to be scannable at a
       glance should not sometimes be a word. Shuffled afterwards so the two
       guaranteed characters do not always sit at the front. */
    var NAME_A = 'abcdefghijklmnopqrstuvwxyz';
    var NAME_D = '0123456789';

    function pick(s) { return s.charAt((Math.random() * s.length) | 0); }

    function randomName() {
        var pool = NAME_A + NAME_D;
        var out = [pick(NAME_A), pick(NAME_D)];
        while (out.length < 8) out.push(pick(pool));
        for (var i = out.length - 1; i > 0; i--) {
            var j = (Math.random() * (i + 1)) | 0;
            var t = out[i]; out[i] = out[j]; out[j] = t;
        }
        return out.join('');
    }

    function download(c, name) {
        c.toBlob(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
            if (window.CAS) CAS.toast('SAVED ' + name);
        }, 'image/png');
    }

    el('saveBtn').addEventListener('click', function () {
        if (!st.full) return;
        el('vStat').textContent = 'PULLING PLATE';
        startExport(function (c) { download(c, fileName(c)); });
    });

    /* The same plate, straight out under a name nobody has to think about. */
    el('quickBtn').addEventListener('click', function () {
        if (!st.full) { if (window.CAS) CAS.toast('NOTHING TO EXPORT', true); return; }
        el('vStat').textContent = 'PULLING PLATE';
        startExport(function (c) { download(c, randomName() + '.png'); });
    });

    el('copyBtn').addEventListener('click', function () {
        if (!st.full) { if (window.CAS) CAS.toast('NOTHING TO COPY', true); return; }
        if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
            if (window.CAS) CAS.toast('CLIPBOARD IMAGES UNSUPPORTED HERE', true);
            return;
        }
        startExport(function (c) {
            c.toBlob(function (blob) {
                navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(
                    function () { CAS.toast('COPIED'); },
                    function () { CAS.toast('COPY BLOCKED', true); }
                );
            }, 'image/png');
        });
    });

    el('resetBtn').addEventListener('click', function () {
        cancelJob();
        clearTimeout(fullTimer);
        st.full = null; st.proxy = null; st.srcCanvas = null;
        st.viewCanvas = null; st.outCanvas = null; st.outKey = '';
        st.showSource = false; st.showLattice = false;
        st.view = { scale: 1, x: 0, y: 0, fit: true };
        wrap.classList.remove('has-img');
        el('file').value = '';
        el('hint').style.display = '';
        ['sName', 'sSize', 'fSrc', 'fScreen', 'fOut', 'fMs', 'oDim', 'oPitch', 'oCells']
            .forEach(function (id) { el(id).textContent = '—'; });
        el('saveBtn').disabled = true;
        el('dockStat').textContent = 'NO IMAGE';
        el('cmpBtn').textContent = 'SHOW SOURCE';
        el('cmpBtn').setAttribute('aria-pressed', 'false');
        el('latBtn').setAttribute('aria-pressed', 'false');
        el('vStat').textContent = 'IDLE';
        el('vLed').className = 'led';
        draw();
        if (window.CAS) CAS.toast('CLEARED');
    });

    /* ── Boot ────────────────────────────────────────────────────────────── */

    applyPreset(DEFAULT_PRESET);
    syncUI();
    draw();
})();
