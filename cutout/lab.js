/* ============================================================================
   CUTOUT LAB — page wiring for engines.js and matting.js
   ---------------------------------------------------------------------------
   The pipeline is staged and cached, because the stages cost wildly different
   amounts and the controls that drive them change at wildly different rates.
   The graph cut is a quarter of a second; the black point is a memcpy. Dragging
   one must not pay for the other.

     source ─▶ engines ─▶ mix ─▶ shape ─▶ crf ─▶ matte ─▶ output ─▶ paint
        0         1        2       3       3       4        5

   Every control declares the stage it dirties. A run recomputes from the
   lowest dirty stage down and reuses everything above it, yielding to the
   browser between stages so the page never locks up mid-solve. A new run
   started while one is in flight simply bumps a generation counter; the old
   one notices at its next yield and abandons quietly.

   Two resolutions are in play at all times and it matters which is which:

     WORK  a downscaled copy — every engine, the trimap and the matte solver
           run here, and nothing about the answer's SHAPE improves by running
           them bigger
     OUT   the size you are looking at (capped for the preview) or exporting
           at — the alpha is carried here through the full-resolution photo by
           a guided filter, so the edge sharpens back up on the way

   Nothing is uploaded anywhere. The single exception is the neural engine,
   which fetches a model file and is off until you ask for it.
   ========================================================================= */
(function () {
    'use strict';

    var C = window.CUT;
    var S = window.SRCH;
    var el = function (id) { return document.getElementById(id); };
    var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

    /* ── Header furniture ────────────────────────────────────────────────── */
    if (window.CAS) CAS.bootOnce(el('headScreen'));
    S.clock(el('clock'));
    var trace = S.scope(el('scope'));
    S.themeSwitch(el('themeSw'), function () { if (trace) trace.repaint(); });
    if (window.CAS) CAS.pageTransition();

    var STORE = 'isa.cutout.v1';
    var PREVIEW_CAP = 1600;      /* long edge of the on-screen composite */
    var THUMB_W = 58, THUMB_H = 42;

    /* ═══ STATE ══════════════════════════════════════════════════════════ */

    var st = {
        name: '', srcImg: null, srcW: 0, srcH: 0,
        plateImg: null, plateName: '',

        /* work-resolution copies */
        work: null,          /* {w,h,n,rgb,lab} from CUT.makeImage */
        workRgb01: null,     /* Float32Array(n*3), 0..1 — what matting wants */
        plateWork: null,
        ww: 0, wh: 0,

        strokes: [],         /* {label:1|2|0, r, pts:[x,y,...]} in SOURCE px */
        rect: null,          /* {x,y,w,h} in SOURCE px */
        marks: null,         /* {fg:Uint8Array, bg:Uint8Array, fgList, bgList} at work res */

        engines: {},         /* id -> Float32Array at work res */
        engineMs: {},
        engineSig: {},
        neural: { mod: null, model: null, processor: null, ready: false, busy: false, map: null, sig: '' },

        mixed: null, shaped: null, tri: null, matte: null,
        outAlpha: null, outImageData: null, outW: 0, outH: 0,

        solo: null,
        srcVersion: 0, markVersion: 0,

        view: { scale: 1, x: 0, y: 0, fit: true },
        pickMode: false,
        keys: [],            /* [[r,g,b], ...] 0..255 */
        showMarks: true, solidBg: false
    };

    var ENGINE_IDS = ['border', 'chroma', 'ift', 'saliency', 'slic', 'grabcut', 'plate', 'manual', 'neural'];

    var view = el('view'), wrap = el('wrap');
    var vctx = view.getContext('2d');
    var resultCanvas = document.createElement('canvas');
    var scratchCanvas = document.createElement('canvas');

    /* ═══ SMALL HELPERS ══════════════════════════════════════════════════ */

    function v(id) { var n = el(id); return n ? +n.value : 0; }
    function chk(id) { var n = el(id); return !!(n && n.checked); }
    function radio(name) { var n = document.querySelector('input[name="' + name + '"]:checked'); return n ? n.value : ''; }
    function txt(id, s) { var n = el(id); if (n) n.textContent = s; }

    function frame() { return new Promise(function (r) { setTimeout(r, 0); }); }

    function fmtBytes(b) {
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(1) + ' MB';
    }

    function hexToRgb(hex) {
        var m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
        return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
    }
    function rgbToHex(c) {
        return '#' + c.map(function (x) { return ('0' + Math.round(x).toString(16)).slice(-2); }).join('');
    }

    /* Draw an image (or canvas) into a fresh ImageData of the given size. */
    function rasterise(src, w, h) {
        scratchCanvas.width = w; scratchCanvas.height = h;
        var ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h);
    }

    function workSize(sw, sh, cap) {
        var long = Math.max(sw, sh);
        if (long <= cap) return [sw, sh];
        var k = cap / long;
        return [Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k))];
    }

    /* ═══ CONTROL READOUTS ═══════════════════════════════════════════════

       Every slider carries an integer and means something else. One table
       rather than one listener each, so a control added to the HTML later
       shows the right units without touching this file twice. */

    var FMT = {
        b_band: function (x) { return x + '%'; },
        b_quant: function (x) { return x + '%'; },
        b_sharp: function (x) { return (x / 100).toFixed(2); },
        k_inner: function (x) { return (x / 1000).toFixed(3); },
        k_outer: function (x) { return (x / 1000).toFixed(3); },
        k_chroma: function (x) { return (x / 100).toFixed(2); },
        k_luma: function (x) { return (x / 100).toFixed(2); },
        i_sigma: function (x) { return (x / 1000).toFixed(3); },
        i_chroma: function (x) { return (x / 100).toFixed(2); },
        i_gamma: function (x) { return (x / 100).toFixed(2); },
        s_ft: function (x) { return (x / 100).toFixed(2); },
        s_sr: function (x) { return (x / 100).toFixed(2); },
        s_hc: function (x) { return (x / 100).toFixed(2); },
        s_centre: function (x) { return (x / 100).toFixed(2); },
        p_count: function (x) { return String(x); },
        p_compact: function (x) { return (x / 100).toFixed(2); },
        p_sigma: function (x) { return (x / 1000).toFixed(3); },
        g_iter: String, g_gamma: String, g_k: String,
        pl_inner: function (x) { return (x / 1000).toFixed(3); },
        pl_outer: function (x) { return (x / 1000).toFixed(3); },
        pl_shadow: function (x) { return (x / 100).toFixed(2); },
        m_spread: function (x) { return x + '%'; },
        brushSize: function (x) { return x + ' px'; },
        sh_black: function (x) { return (x / 100).toFixed(2); },
        sh_white: function (x) { return (x / 100).toFixed(2); },
        sh_gamma: function (x) { return (x / 100).toFixed(2); },
        sh_open: String, sh_close: String, sh_blobs: String,
        sh_minfrac: function (x) { return x + '%'; },
        sh_shift: function (x) { return (x / 2).toFixed(1) + ' px'; },
        mt_band: function (x) { return x + ' px'; },
        mt_eps: function (x) { return epsOf(x).toExponential(0).replace('e-', 'e-'); },
        mt_geps: function (x) { return epsOf(x).toExponential(0); },
        mt_iter: String, mt_radius: function (x) { return x + ' px'; },
        mt_rays: String, mt_ggamma: String,
        crf_iter: String,
        crf_colour: function (x) { return (x / 1000).toFixed(3); },
        crf_spatial: function (x) { return x + ' px'; },
        crf_wb: function (x) { return (x / 10).toFixed(1); },
        dc_strength: function (x) { return (x / 100).toFixed(2); },
        ds_strength: function (x) { return (x / 100).toFixed(2); },
        out_blur: function (x) { return x + ' px'; },
        out_scale: function (x) { return x + '%'; }
    };

    /* The tolerance sliders are logarithmic: the interesting range spans
       1e-9 to 1e-3 and a linear slider would spend 99% of its travel in the
       part where nothing changes. */
    function epsOf(slider) { return Math.pow(10, -9 + slider / 10); }

    function paintReadouts() {
        Object.keys(FMT).forEach(function (id) {
            var node = el(id + 'Val');
            if (node && el(id)) node.textContent = FMT[id](+el(id).value);
        });
        var wr = el('workRes');
        if (wr) txt('workResVal', wr.value + ' px');
    }

    /* ═══ MARKS ══════════════════════════════════════════════════════════

       Strokes are stored as polylines in SOURCE pixel coordinates, never as
       a bitmap. That is what makes undo one array pop, makes a change of
       working resolution free, and keeps a hundred strokes cheaper than one
       megapixel mask. They are rasterised on demand at whatever size the
       engines are running.                                                  */

    var markCanvas = document.createElement('canvas');

    function rasteriseMarks(w, h) {
        var fg = new Uint8Array(w * h), bg = new Uint8Array(w * h);
        var fgList = [], bgList = [];
        if (!st.strokes.length) return { fg: fg, bg: bg, fgList: fgList, bgList: bgList, any: false };

        markCanvas.width = w; markCanvas.height = h;
        var ctx = markCanvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, w, h);
        var k = w / st.srcW;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        st.strokes.forEach(function (s) {
            ctx.globalCompositeOperation = s.label === 0 ? 'destination-out' : 'source-over';
            /* Foreground in red, background in green — two masks in one pass,
               and 'destination-out' erases both at once, which is exactly what
               the eraser should do. */
            ctx.strokeStyle = s.label === 1 ? 'rgba(255,0,0,1)' : s.label === 2 ? 'rgba(0,255,0,1)' : 'rgba(0,0,0,1)';
            ctx.fillStyle = ctx.strokeStyle;
            ctx.lineWidth = Math.max(1, s.r * 2 * k);
            ctx.beginPath();
            ctx.moveTo(s.pts[0] * k, s.pts[1] * k);
            for (var i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i] * k, s.pts[i + 1] * k);
            if (s.pts.length === 2) ctx.lineTo(s.pts[0] * k + 0.01, s.pts[1] * k);
            ctx.stroke();
        });
        ctx.globalCompositeOperation = 'source-over';

        var d = ctx.getImageData(0, 0, w, h).data;
        for (var i = 0, q = 0; i < w * h; i++, q += 4) {
            if (d[q + 3] < 64) continue;
            if (d[q] > 100) { fg[i] = 1; fgList.push(i); }
            else if (d[q + 1] > 100) { bg[i] = 1; bgList.push(i); }
        }
        return {
            fg: fg, bg: bg,
            fgList: Int32Array.from(fgList), bgList: Int32Array.from(bgList),
            any: fgList.length > 0 || bgList.length > 0
        };
    }

    /* ═══ ENGINES ════════════════════════════════════════════════════════ */

    /* A signature per engine: if it has not changed, the cached map stands.
       Cheap string concatenation beats being clever — these run once per
       control change, not once per pixel. */
    function engineSig(id) {
        var base = st.srcVersion + '|' + st.ww + 'x' + st.wh + '|' + st.markVersion + '|';
        switch (id) {
            case 'border': return base + [v('b_band'), v('b_quant'), v('b_sharp'),
                chk('b_top'), chk('b_bottom'), chk('b_left'), chk('b_right')].join(',');
            case 'chroma': return base + JSON.stringify(st.keys) + [v('k_inner'), v('k_outer'), v('k_chroma'), v('k_luma')].join(',');
            case 'ift': return base + [el('i_metric').value, v('i_sigma'), v('i_chroma'), v('i_gamma')].join(',');
            case 'saliency': return base + [v('s_ft'), v('s_sr'), v('s_hc'), v('s_centre')].join(',');
            case 'slic': return base + [v('p_count'), v('p_compact'), v('p_sigma')].join(',');
            case 'grabcut': return base + [el('g_seed').value, v('g_iter'), v('g_gamma'), v('g_k'),
                st.rect ? [st.rect.x, st.rect.y, st.rect.w, st.rect.h].join('.') : '-',
                el('g_seed').value === 'engines' ? consensusSig() : ''].join(',');
            case 'plate': return base + (st.plateName || '-') + [v('pl_inner'), v('pl_outer'), v('pl_shadow')].join(',');
            case 'manual': return base + v('m_spread');
            case 'neural': return base;
            default: return base;
        }
    }

    /* GrabCut seeded from the others depends on the others, so its signature
       has to include theirs or it will happily reuse a stale cut. */
    function consensusSig() {
        return ENGINE_IDS.filter(function (id) {
            return id !== 'grabcut' && chk('e_' + id);
        }).map(function (id) { return id + ':' + st.engineSig[id]; }).join(';');
    }

    function engineOpts(id) {
        var m = st.marks;
        switch (id) {
            case 'border': return {
                band: v('b_band') / 100, fgQuantile: v('b_quant') / 100, sharpness: v('b_sharp') / 100,
                top: chk('b_top'), bottom: chk('b_bottom'), left: chk('b_left'), right: chk('b_right')
            };
            case 'chroma': return {
                keys: st.keys.length ? st.keys : null,
                inner: v('k_inner') / 1000, outer: v('k_outer') / 1000,
                chromaWeight: v('k_chroma') / 100, lumaWeight: v('k_luma') / 100
            };
            case 'ift': return {
                metric: el('i_metric').value, sigma: v('i_sigma') / 1000,
                chromaWeight: v('i_chroma') / 100, gamma: v('i_gamma') / 100,
                fgSeeds: m && m.fgList.length ? m.fgList : null,
                bgSeeds: m && m.bgList.length ? m.bgList : null
            };
            case 'saliency': return {
                wFt: v('s_ft') / 100, wSr: v('s_sr') / 100, wHc: v('s_hc') / 100, centre: v('s_centre') / 100
            };
            case 'slic': return {
                superpixels: v('p_count'), compactness: v('p_compact') / 100, sigmaColour: v('p_sigma') / 1000
            };
            case 'plate': return {
                inner: v('pl_inner') / 1000, outer: v('pl_outer') / 1000, shadow: v('pl_shadow') / 100
            };
            case 'manual': return {
                spread: v('m_spread') / 100,
                fgSeeds: m && m.fgList.length ? m.fgList : null,
                bgSeeds: m && m.bgList.length ? m.bgList : null
            };
            default: return {};
        }
    }

    function runEngine(id) {
        var img = st.work;
        switch (id) {
            case 'border': return C.engineBorder(img, engineOpts(id));
            case 'chroma': return C.engineChroma(img, engineOpts(id));
            case 'ift': return C.engineIFT(img, engineOpts(id));
            case 'saliency': return C.engineSaliency(img, engineOpts(id));
            case 'slic': return C.engineSLIC(img, engineOpts(id)).alpha;
            case 'plate': return st.plateWork ? C.enginePlate(img, st.plateWork, engineOpts(id))
                                              : new Float32Array(img.n).fill(0.5);
            case 'manual': return C.engineManual(img, engineOpts(id));
            case 'neural': return st.neural.map ? Float32Array.from(st.neural.map) : new Float32Array(img.n).fill(0.5);
            case 'grabcut': return runGrabCut();
            default: return new Float32Array(img.n).fill(0.5);
        }
    }

    function runGrabCut() {
        var img = st.work, w = st.ww, h = st.wh, n = img.n;
        var GC = C.GC;
        var mask = new Uint8Array(n);
        var mode = el('g_seed').value;
        var i, x, y;

        if (mode === 'engines') {
            var others = [], weights = [];
            ENGINE_IDS.forEach(function (id) {
                if (id === 'grabcut' || !chk('e_' + id) || !st.engines[id]) return;
                others.push(st.engines[id]);
                weights.push(Math.max(0.0001, v('w_' + id) / 100));
            });
            var cons = others.length ? C.blend(others, weights, radio('mixMode')) : null;
            /* Refuse a seed that cannot possibly be right. Handing the cut a
               consensus that found four pixels — or the whole frame — does not
               produce a bad answer, it produces a CONFIDENT bad answer: the
               colour models get fitted to nonsense and every later round makes
               it worse. Better to throw the seed away and start from a box. */
            var area = 0;
            if (cons) { for (i = 0; i < n; i++) if (cons[i] >= 0.5) area++; }
            if (cons && area > n * 0.004 && area < n * 0.98) {
                /* Everything outside the consensus's bounding box, generously
                   padded, becomes definite background.

                   This is the part that matters. GrabCut's colour models are
                   only as good as the pixels they are fitted to, and a box
                   that spans nearly the whole frame trains the FOREGROUND
                   model on mostly background — after which the cut cheerfully
                   keeps half the wall, because by then the wall genuinely is
                   what foreground looks like. A tight box is worth more to it
                   than any amount of iteration, and the other engines already
                   know roughly where the subject is even when they disagree
                   about its outline. */
                var bx0 = w, by0 = h, bx1 = -1, by1 = -1;
                for (y = 0; y < h; y++) {
                    for (x = 0; x < w; x++) {
                        if (cons[y * w + x] < 0.5) continue;
                        if (x < bx0) bx0 = x;
                        if (x > bx1) bx1 = x;
                        if (y < by0) by0 = y;
                        if (y > by1) by1 = y;
                    }
                }
                var pad = Math.round(Math.max(w, h) * 0.06);
                bx0 = Math.max(0, bx0 - pad); by0 = Math.max(0, by0 - pad);
                bx1 = Math.min(w - 1, bx1 + pad); by1 = Math.min(h - 1, by1 + pad);

                for (y = 0; y < h; y++) {
                    for (x = 0; x < w; x++) {
                        i = y * w + x;
                        if (x < bx0 || x > bx1 || y < by0 || y > by1) mask[i] = GC.BGD;
                        else mask[i] = cons[i] >= 0.5 ? GC.PR_FGD : GC.PR_BGD;
                    }
                }

                /* And that is deliberately ALL the seeding does. An earlier
                   version also promoted confident consensus pixels to hard
                   FGD/BGD, on the theory that the colour models need some
                   facts to hold on to. They do not — a rectangle is all
                   OpenCV's own initialiser gives them — and the cost of that
                   theory was that the cut could no longer disagree with the
                   engines that seeded it. A see-through gap is the case that
                   exposes it: every connectivity engine necessarily calls an
                   enclosed hole foreground, because a flood from the frame can
                   never get into it, so the consensus is confidently wrong
                   there and pinning it made that permanent. Left probable, the
                   cut looks at the colour, sees background, and opens it. */
            } else {
                mode = 'auto';
            }
        }

        if (mode === 'rect' || mode === 'auto') {
            var r;
            if (mode === 'rect' && st.rect) {
                var k = w / st.srcW;
                r = {
                    x: Math.round(st.rect.x * k), y: Math.round(st.rect.y * k),
                    w: Math.round(st.rect.w * k), h: Math.round(st.rect.h * k)
                };
            } else {
                var ix = Math.round(w * 0.06), iy = Math.round(h * 0.06);
                r = { x: ix, y: iy, w: w - ix * 2, h: h - iy * 2 };
            }
            for (y = 0; y < h; y++) {
                for (x = 0; x < w; x++) {
                    var inside = x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
                    mask[y * w + x] = inside ? GC.PR_FGD : GC.BGD;
                }
            }
        }

        /* Brush marks are facts and outrank every seeding mode. */
        var m = st.marks;
        if (m) {
            for (i = 0; i < n; i++) {
                if (m.fg[i]) mask[i] = GC.FGD;
                else if (m.bg[i]) mask[i] = GC.BGD;
            }
        }

        /* Both labels must exist or the GMMs cannot be fitted at all. */
        var hasF = false, hasB = false;
        for (i = 0; i < n && !(hasF && hasB); i++) {
            if (mask[i] === GC.FGD || mask[i] === GC.PR_FGD) hasF = true;
            else hasB = true;
        }
        if (!hasF || !hasB) return new Float32Array(n).fill(hasF ? 1 : 0);

        return C.engineGrabCut(st.work, mask, {
            components: v('g_k'), gamma: v('g_gamma'), iterations: v('g_iter')
        }).alpha;
    }

    /* ═══ NEURAL ═════════════════════════════════════════════════════════

       The only part of this page that touches the network, and it is inert
       until the button is pressed. Written defensively on purpose: a CDN that
       moved, a model card that changed shape, a browser without WebGPU — none
       of those should take the other eight engines down with them.           */

    var TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1';
    var RMBG_CONFIG = {
        do_normalize: true, do_pad: false, do_rescale: true, do_resize: true,
        image_mean: [0.5, 0.5, 0.5], image_std: [1, 1, 1],
        feature_extractor_type: 'ImageFeatureExtractor',
        resample: 2, rescale_factor: 0.00392156862745098,
        size: { width: 1024, height: 1024 }
    };

    function neuralStatus(msg, pct) {
        txt('n_status', msg);
        var bar = el('n_bar');
        if (bar) bar.style.width = (pct === undefined ? 0 : Math.round(pct * 100)) + '%';
    }

    async function loadNeural() {
        if (st.neural.busy) return;
        st.neural.busy = true;
        el('n_load').disabled = true;
        try {
            neuralStatus('Fetching the runtime…', 0.02);
            var mod = await import(/* webpackIgnore: true */ TRANSFORMERS_URL);
            if (mod.env) { mod.env.allowLocalModels = false; }

            var seen = {};
            function progress(p) {
                if (!p || !p.file) return;
                if (p.status === 'progress' && p.total) {
                    seen[p.file] = p.loaded / p.total;
                    var vals = Object.keys(seen).map(function (k) { return seen[k]; });
                    var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
                    neuralStatus('Downloading ' + p.file + ' — ' + fmtBytes(p.loaded) + ' of ' + fmtBytes(p.total), avg);
                } else if (p.status === 'done') {
                    seen[p.file] = 1;
                }
            }

            var want = el('n_device').value;
            var opts = { config: { model_type: 'custom' }, progress_callback: progress };
            if (want === 'auto' && 'gpu' in navigator) opts.device = 'webgpu';

            neuralStatus('Downloading the model — about 45 MB, once…', 0.05);
            var model;
            try {
                model = await mod.AutoModel.from_pretrained('briaai/RMBG-1.4', opts);
            } catch (e) {
                /* WebGPU is the most likely thing to have gone wrong; retry on
                   the CPU before giving up on the engine entirely. */
                if (opts.device) {
                    neuralStatus('GPU refused the model — retrying on the CPU…', 0.5);
                    delete opts.device;
                    model = await mod.AutoModel.from_pretrained('briaai/RMBG-1.4', opts);
                } else { throw e; }
            }
            var processor = await mod.AutoProcessor.from_pretrained('briaai/RMBG-1.4', { config: RMBG_CONFIG });

            st.neural.mod = mod;
            st.neural.model = model;
            st.neural.processor = processor;
            st.neural.ready = true;
            el('e_neural').disabled = false;
            el('e_neural').checked = true;
            neuralStatus('Ready. Running on ' + (opts.device || 'the CPU') + '.', 1);
            if (window.CAS) CAS.toast('MODEL READY');
            st.neural.sig = '';
            invalidate(1);
        } catch (e) {
            neuralStatus('Could not load: ' + (e && e.message ? e.message : String(e)) +
                         ' — the other eight engines are unaffected.', 0);
            el('n_load').disabled = false;
            if (window.CAS) CAS.toast('MODEL LOAD FAILED', true);
        } finally {
            st.neural.busy = false;
        }
    }

    async function runNeural() {
        var nn = st.neural;
        if (!nn.ready || !st.srcImg) return null;
        var sig = st.srcVersion + '|' + st.ww + 'x' + st.wh;
        if (nn.sig === sig && nn.map) return nn.map;

        var mod = nn.mod;
        /* The model wants a picture, not our float buffers. Hand it the work
           canvas — running it at working resolution is plenty, since it
           internally resizes to 1024 anyway. */
        var cvs = document.createElement('canvas');
        cvs.width = st.ww; cvs.height = st.wh;
        cvs.getContext('2d').drawImage(st.srcImg, 0, 0, st.ww, st.wh);

        var image = await mod.RawImage.fromCanvas(cvs);
        var processed = await nn.processor(image);
        var result = await nn.model({ input: processed.pixel_values });
        var tensor = result.output || result.logits || result[Object.keys(result)[0]];
        var raw = await mod.RawImage.fromTensor(tensor[0].mul(255).to('uint8')).resize(st.ww, st.wh);

        var out = new Float32Array(st.ww * st.wh);
        var d = raw.data, ch = raw.channels || 1;
        for (var i = 0; i < out.length; i++) out[i] = d[i * ch] / 255;
        nn.map = out; nn.sig = sig;
        return out;
    }

    /* ═══ PIPELINE ═══════════════════════════════════════════════════════ */

    var dirty = 0, gen = 0, timer = null, running = false;

    function invalidate(level) {
        if (level < dirty) dirty = level;
        clearTimeout(timer);
        timer = setTimeout(run, 170);
    }

    function busy(on, pct, label) {
        el('busybar').classList.toggle('on', !!on);
        el('busyfill').style.width = Math.round((pct || 0) * 100) + '%';
        el('engLed').classList.toggle('on', !!on);
        el('engLed').classList.toggle('green', !on);
        txt('engStat', on ? (label || 'WORKING') : (st.work ? 'READY' : 'IDLE'));
        if (label) txt('fStage', label);
    }

    async function run() {
        if (!st.work || dirty > 5) return;
        var my = ++gen;
        var t0 = performance.now();
        running = true;
        /* Claimed here and never touched again. Resetting it at the END of a
           run looks tidier and is a bug: a control moved while the solve was
           in flight has already set `dirty` and armed the next run, and the
           finishing run would wipe that back to "nothing to do" — so the
           change the user just made would be quietly thrown away. */
        var startLevel = dirty;
        dirty = 99;

        try {
            /* ── 1. ENGINES ─────────────────────────────────────────────── */
            if (startLevel <= 1) {
                st.marks = rasteriseMarks(st.ww, st.wh);

                /* Non-graph-cut engines first: the graph cut can be seeded
                   from their consensus, so it has to see them settled. */
                var order = ENGINE_IDS.filter(function (id) { return id !== 'grabcut'; }).concat(['grabcut']);
                for (var oi = 0; oi < order.length; oi++) {
                    var id = order[oi];
                    if (!chk('e_' + id)) { st.engineMs[id] = null; continue; }

                    if (id === 'neural') {
                        busy(true, oi / order.length, 'NEURAL');
                        await frame(); if (my !== gen) return;
                        var t = performance.now();
                        try { st.neural.map = await runNeural(); }
                        catch (e) { neuralStatus('Inference failed: ' + e.message, 0); }
                        if (my !== gen) return;
                        st.engines[id] = st.neural.map ? st.neural.map : new Float32Array(st.work.n).fill(0.5);
                        st.engineMs[id] = performance.now() - t;
                        st.engineSig[id] = engineSig(id);
                        drawThumb(id);
                        continue;
                    }

                    var sig = engineSig(id);
                    if (st.engineSig[id] === sig && st.engines[id]) continue;

                    busy(true, oi / order.length, id.toUpperCase());
                    await frame(); if (my !== gen) return;
                    var t1 = performance.now();
                    st.engines[id] = runEngine(id);
                    st.engineMs[id] = performance.now() - t1;
                    st.engineSig[id] = sig;
                    drawThumb(id);
                    if (my !== gen) return;
                }
                paintEngineTimes();
            }

            /* ── 2. MIX ─────────────────────────────────────────────────── */
            if (startLevel <= 2) {
                busy(true, 0.55, 'MIX');
                var maps = [], ws = [];
                if (st.solo && st.engines[st.solo] && chk('e_' + st.solo)) {
                    maps.push(st.engines[st.solo]); ws.push(1);
                } else {
                    ENGINE_IDS.forEach(function (id) {
                        if (!chk('e_' + id) || !st.engines[id]) return;
                        maps.push(st.engines[id]);
                        ws.push(Math.max(0.0001, v('w_' + id) / 100));
                    });
                }
                st.mixed = maps.length ? C.blend(maps, ws, radio('mixMode'))
                                       : new Float32Array(st.work.n).fill(0);
                drawHistogram(st.mixed);
            }

            /* ── 3. SHAPE (+ CRF) ───────────────────────────────────────── */
            if (startLevel <= 3) {
                busy(true, 0.62, 'SHAPE');
                await frame(); if (my !== gen) return;
                var a = Float32Array.from(st.mixed);
                var w = st.ww, h = st.wh;

                C.levels(a, v('sh_black') / 100, v('sh_white') / 100, v('sh_gamma') / 100);

                /* Marks are law: whatever the mixer decided, a stroke wins. */
                var marked = st.marks && st.marks.any;
                function assertMarks() {
                    for (var mi = 0; mi < a.length; mi++) {
                        if (st.marks.fg[mi]) a[mi] = 1;
                        else if (st.marks.bg[mi]) a[mi] = 0;
                    }
                }
                if (marked) assertMarks();

                C.openClose(a, w, h, v('sh_open'), v('sh_close'));
                /* The cleanup steps get told what they may not touch. Without
                   that, painting KEEP on something small is futile: the stroke
                   lands, and then "keep the largest piece" deletes it again
                   two lines later with no way for the user to tell why. */
                if (v('sh_blobs') > 0) {
                    C.keepBlobs(a, w, h, 0.5, v('sh_blobs'), v('sh_minfrac') / 100,
                                marked ? st.marks.fg : null);
                }
                if (chk('sh_holes')) C.fillHoles(a, w, h, 0.5, 1, marked ? st.marks.bg : null);

                if (chk('crf_on')) {
                    busy(true, 0.68, 'DENSE CRF');
                    await frame(); if (my !== gen) return;
                    a = C.denseCRF(st.workRgb01, st.work.lab, w, h, a, {
                        iterations: v('crf_iter'),
                        spatial: v('crf_spatial'),
                        colour: v('crf_colour') / 1000,
                        wBilateral: v('crf_wb') / 10,
                        wSmooth: 1.5
                    });
                }

                /* Once more after the CRF, which is a smoother and will
                   happily average a thin stroke out of existence. Before the
                   edge shift, so choke and spread still apply evenly. */
                if (marked) assertMarks();

                var shift = v('sh_shift') / 2;
                if (Math.abs(shift) > 0.01) C.shiftEdge(a, w, h, shift, 0.5);

                st.shaped = a;
            }

            /* ── 4. MATTE ───────────────────────────────────────────────── */
            if (startLevel <= 4) {
                busy(true, 0.74, 'TRIMAP');
                await frame(); if (my !== gen) return;
                var w2 = st.ww, h2 = st.wh;
                var method = el('mt_method').value;
                var band = v('mt_band');
                st.tri = C.trimap(st.shaped, w2, h2, band, 0.05, 0.95);

                var unk = 0;
                for (var ti = 0; ti < st.tri.length; ti++) if (st.tri[ti] === C.TRI.UNK) unk++;
                txt('bandStat', unk.toLocaleString() + ' PX');
                txt('fBand', unk.toLocaleString() + ' px');

                busy(true, 0.78, 'MATTE — ' + method.toUpperCase());
                await frame(); if (my !== gen) return;

                var m2;
                if (method === 'none') {
                    m2 = Float32Array.from(st.shaped);
                } else if (method === 'guided') {
                    m2 = C.guidedFilterColor(st.workRgb01, st.shaped, w2, h2,
                                             v('mt_radius'), epsOf(v('mt_geps')));
                    for (var gi = 0; gi < m2.length; gi++) {
                        if (st.tri[gi] === C.TRI.FG) m2[gi] = 1;
                        else if (st.tri[gi] === C.TRI.BG) m2[gi] = 0;
                        else m2[gi] = C.clamp01(m2[gi]);
                    }
                } else if (method === 'closed') {
                    m2 = C.closedFormMatting(st.workRgb01, w2, h2, st.tri, st.shaped, {
                        eps: epsOf(v('mt_eps')), iterations: v('mt_iter')
                    });
                } else if (method === 'sampling') {
                    m2 = C.samplingMatting(st.workRgb01, w2, h2, st.tri, {
                        rays: v('mt_rays'), fallback: st.shaped
                    });
                    /* Sampling decides every pixel on its own, so it is noisy
                       by construction; one small guided pass through the image
                       removes the noise without moving the edge. */
                    var sm = C.guidedFilterColor(st.workRgb01, m2, w2, h2, 2, 1e-6);
                    for (var si = 0; si < m2.length; si++) {
                        m2[si] = st.tri[si] === C.TRI.FG ? 1 : st.tri[si] === C.TRI.BG ? 0 : C.clamp01(sm[si]);
                    }
                } else {
                    m2 = C.geodesicMatting(st.workRgb01, w2, h2, st.tri, { gamma: v('mt_ggamma') });
                }
                st.matte = m2;
            }

            /* ── 5. OUTPUT ──────────────────────────────────────────────── */
            if (startLevel <= 5) {
                busy(true, 0.88, 'COMPOSITE');
                await frame(); if (my !== gen) return;
                var pv = workSize(st.srcW, st.srcH, PREVIEW_CAP);
                await composeInto(resultCanvas, pv[0], pv[1], my);
                if (my !== gen) return;
            }

            draw();
            var ms = performance.now() - t0;
            txt('fMs', ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s');
            busy(false);
            txt('fStage', 'DONE');
            enableExport(true);
        } catch (e) {
            busy(false);
            txt('fStage', 'ERROR');
            if (window.CAS) CAS.toast('PIPELINE ERROR: ' + (e.message || e), true);
            /* eslint-disable-next-line no-console */
            console.error(e);
        } finally {
            running = false;
        }
    }

    /* ═══ COMPOSITE ══════════════════════════════════════════════════════

       Runs at whatever size it is asked for. The alpha never leaves the
       working grid until here: guided-filter coefficients are fitted small
       and applied against the target-resolution photograph, which is what
       recovers an edge finer than the grid the solve happened on.           */

    async function composeInto(canvas, tw, th, my) {
        var src = rasterise(st.srcImg, tw, th);
        var d = src.data, n = tw * th;

        var co = C.guidedCoeffs(st.workRgb01, st.matte, st.ww, st.wh, 2, 1e-6);
        var alpha = C.applyCoeffsToU8(co, d, tw, th);
        if (my !== undefined && my !== gen) return;

        /* Anything the trimap called certain stays certain. The guided
           re-fit is a local model and will happily drift a solid interior by
           a per-cent or two, which reads as a haze over the whole subject. */
        var triBig = nearestUp(st.tri, st.ww, st.wh, tw, th);
        for (var k = 0; k < n; k++) {
            if (triBig[k] === C.TRI.FG) alpha[k] = 1;
            else if (triBig[k] === C.TRI.BG) alpha[k] = 0;
        }

        st.outAlpha = alpha; st.outW = tw; st.outH = th;

        /* Colour work, in place on the RGBA bytes. */
        if (chk('dc_on') && v('dc_strength') > 0) {
            await frame(); if (my !== undefined && my !== gen) return;
            var B = C.estimateBackground(st.workRgb01, st.matte, st.ww, st.wh);
            var Bb = [
                C.bilinear(plane(B, st.ww * st.wh, 0), st.ww, st.wh, tw, th),
                C.bilinear(plane(B, st.ww * st.wh, 1), st.ww, st.wh, tw, th),
                C.bilinear(plane(B, st.ww * st.wh, 2), st.ww, st.wh, tw, th)
            ];
            var strength = v('dc_strength') / 100;
            for (var i = 0, q = 0; i < n; i++, q += 4) {
                var a = alpha[i];
                if (a >= 0.999 || a <= 0.001) continue;
                var inv = 1 / Math.max(0.06, a);
                var mix = strength * Math.min(1, a * 3);
                for (var c = 0; c < 3; c++) {
                    var cv = d[q + c] / 255;
                    var un = (cv - (1 - a) * Bb[c][i]) * inv;
                    un = un < 0 ? 0 : un > 1 ? 1 : un;
                    d[q + c] = Math.round((cv * (1 - mix) + un * mix) * 255);
                }
            }
        }

        if (chk('ds_on') && st.keys.length && v('ds_strength') > 0) {
            await frame(); if (my !== undefined && my !== gen) return;
            despillU8(d, n, alpha, st.keys[0], v('ds_strength') / 100, chk('ds_luma'));
        }

        /* Background. */
        var mode = el('out_bg').value;
        canvas.width = tw; canvas.height = th;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, tw, th);

        if (mode === 'none') {
            for (var j = 0, p = 3; j < n; j++, p += 4) d[p] = Math.round(alpha[j] * 255);
            ctx.putImageData(src, 0, 0);
        } else {
            var bgData;
            if (mode === 'blur') {
                var bc = document.createElement('canvas');
                bc.width = tw; bc.height = th;
                var bctx = bc.getContext('2d', { willReadFrequently: true });
                bctx.filter = 'blur(' + Math.max(1, Math.round(v('out_blur') * tw / st.srcW)) + 'px)';
                bctx.drawImage(st.srcImg, 0, 0, tw, th);
                bgData = bctx.getImageData(0, 0, tw, th).data;
            } else {
                var col = hexToRgb(el('out_colour').value);
                bgData = null;
                for (var z = 0, pz = 0; z < n; z++, pz += 4) {
                    var az = alpha[z];
                    d[pz] = Math.round(d[pz] * az + col[0] * (1 - az));
                    d[pz + 1] = Math.round(d[pz + 1] * az + col[1] * (1 - az));
                    d[pz + 2] = Math.round(d[pz + 2] * az + col[2] * (1 - az));
                    d[pz + 3] = 255;
                }
            }
            if (bgData) {
                for (var y2 = 0, py = 0; y2 < n; y2++, py += 4) {
                    var ay = alpha[y2];
                    d[py] = Math.round(d[py] * ay + bgData[py] * (1 - ay));
                    d[py + 1] = Math.round(d[py + 1] * ay + bgData[py + 1] * (1 - ay));
                    d[py + 2] = Math.round(d[py + 2] * ay + bgData[py + 2] * (1 - ay));
                    d[py + 3] = 255;
                }
            }
            ctx.putImageData(src, 0, 0);
        }

        var soft = 0;
        for (var s2 = 0; s2 < n; s2++) if (alpha[s2] > 0.004 && alpha[s2] < 0.996) soft++;
        txt('oSoft', (100 * soft / n).toFixed(2) + '%');
        txt('oDim', Math.round(st.srcW * v('out_scale') / 100) + ' × ' + Math.round(st.srcH * v('out_scale') / 100));
    }

    function plane(interleaved, n, c) {
        var out = new Float32Array(n);
        for (var i = 0; i < n; i++) out[i] = interleaved[i * 3 + c];
        return out;
    }

    function nearestUp(src, sw, sh, dw, dh) {
        var out = new Uint8Array(dw * dh);
        for (var y = 0; y < dh; y++) {
            var sy = Math.min(sh - 1, ((y + 0.5) * sh / dh) | 0);
            for (var x = 0; x < dw; x++) {
                out[y * dw + x] = src[sy * sw + Math.min(sw - 1, ((x + 0.5) * sw / dw) | 0)];
            }
        }
        return out;
    }

    /* Despill straight on the byte array, skipping everything the matte has
       already thrown away — on a typical cutout that is most of the picture,
       and the OKLab round trip is the most expensive per-pixel thing here. */
    function despillU8(d, n, alpha, key, strength, holdLuma) {
        var k = C.srgbToOklab(key[0] / 255, key[1] / 255, key[2] / 255);
        var kc = Math.hypot(k[1], k[2]);
        if (kc < 1e-5) return;
        var kx = k[1] / kc, ky = k[2] / kc;
        var lab = new Float32Array(3), lin = new Float32Array(3);
        var L8 = C.LIN8;
        for (var i = 0, q = 0; i < n; i++, q += 4) {
            if (alpha[i] <= 0.004) continue;
            C.linToOklab(L8[d[q]], L8[d[q + 1]], L8[d[q + 2]], lab, 0);
            var proj = lab[1] * kx + lab[2] * ky;
            if (proj <= 0) continue;
            var perp = Math.hypot(lab[1] - proj * kx, lab[2] - proj * ky);
            var cut = Math.max(0, proj - perp) * strength;
            if (cut <= 0) continue;
            var L0 = lab[0];
            C.oklabToLin(holdLuma ? L0 : lab[0], lab[1] - cut * kx, lab[2] - cut * ky, lin, 0);
            d[q] = Math.round(255 * C.clamp01(C.linearToSrgb(lin[0])));
            d[q + 1] = Math.round(255 * C.clamp01(C.linearToSrgb(lin[1])));
            d[q + 2] = Math.round(255 * C.clamp01(C.linearToSrgb(lin[2])));
        }
    }

    /* ═══ DRAWING ════════════════════════════════════════════════════════ */

    var alphaCanvas = document.createElement('canvas');
    var triCanvas = document.createElement('canvas');

    function buildAlphaCanvas() {
        if (!st.outAlpha) return null;
        alphaCanvas.width = st.outW; alphaCanvas.height = st.outH;
        var ctx = alphaCanvas.getContext('2d');
        var im = ctx.createImageData(st.outW, st.outH);
        var d = im.data;
        for (var i = 0, q = 0; i < st.outAlpha.length; i++, q += 4) {
            var g = Math.round(st.outAlpha[i] * 255);
            d[q] = d[q + 1] = d[q + 2] = g;
            d[q + 3] = 255;
        }
        ctx.putImageData(im, 0, 0);
        return alphaCanvas;
    }

    function buildTriCanvas() {
        if (!st.tri) return null;
        triCanvas.width = st.ww; triCanvas.height = st.wh;
        var ctx = triCanvas.getContext('2d');
        var im = ctx.createImageData(st.ww, st.wh);
        var d = im.data;
        for (var i = 0, q = 0; i < st.tri.length; i++, q += 4) {
            var t = st.tri[i];
            /* Certain-subject white, certain-background black, and the band
               that is actually being solved in the accent colour. */
            if (t === C.TRI.FG) { d[q] = d[q + 1] = d[q + 2] = 255; }
            else if (t === C.TRI.BG) { d[q] = d[q + 1] = d[q + 2] = 12; }
            else { d[q] = 76; d[q + 1] = 154; d[q + 2] = 255; }
            d[q + 3] = 255;
        }
        ctx.putImageData(im, 0, 0);
        return triCanvas;
    }

    function fitScale() {
        var box = wrap.getBoundingClientRect();
        if (!st.srcW) return 1;
        return Math.min(box.width / st.srcW, box.height / st.srcH) * 0.96;
    }

    function draw() {
        var box = wrap.getBoundingClientRect();
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var W = Math.max(1, Math.round(box.width)), H = Math.max(1, Math.round(box.height));
        if (view.width !== Math.round(W * dpr) || view.height !== Math.round(H * dpr)) {
            view.width = Math.round(W * dpr); view.height = Math.round(H * dpr);
        }
        vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        vctx.clearRect(0, 0, W, H);
        if (!st.srcImg) return;

        if (st.view.fit) {
            st.view.scale = fitScale();
            st.view.x = (W - st.srcW * st.view.scale) / 2;
            st.view.y = (H - st.srcH * st.view.scale) / 2;
        }
        txt('zoomVal', st.view.fit ? 'FIT' : Math.round(st.view.scale * 100) + '%');

        var mode = radio('vMode');
        var layer = null;
        if (mode === 'result') layer = resultCanvas;
        else if (mode === 'alpha') layer = buildAlphaCanvas();
        else if (mode === 'trimap') layer = buildTriCanvas();
        else layer = st.srcImg;

        vctx.save();
        vctx.translate(st.view.x, st.view.y);
        vctx.scale(st.view.scale, st.view.scale);
        vctx.imageSmoothingEnabled = st.view.scale < 3;
        vctx.imageSmoothingQuality = 'high';

        if (st.solidBg && mode === 'result' && el('out_bg').value === 'none') {
            vctx.fillStyle = el('out_colour').value;
            vctx.fillRect(0, 0, st.srcW, st.srcH);
        }
        if (layer) {
            try { vctx.drawImage(layer, 0, 0, st.srcW, st.srcH); } catch (e) { /* not ready yet */ }
        }

        if (st.showMarks) drawMarks(vctx);
        vctx.restore();
    }

    function drawMarks(ctx) {
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        st.strokes.forEach(function (s) {
            if (s.label === 0) return;   /* an eraser leaves nothing to show */
            ctx.strokeStyle = s.label === 1 ? 'rgba(74,222,128,0.62)' : 'rgba(229,72,77,0.62)';
            ctx.lineWidth = s.r * 2;
            ctx.beginPath();
            ctx.moveTo(s.pts[0], s.pts[1]);
            for (var i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i], s.pts[i + 1]);
            if (s.pts.length === 2) ctx.lineTo(s.pts[0] + 0.01, s.pts[1]);
            ctx.stroke();
        });
        if (st.rect) {
            ctx.strokeStyle = 'rgba(76,154,255,0.9)';
            ctx.lineWidth = Math.max(1, 1.5 / st.view.scale);
            ctx.setLineDash([6 / st.view.scale, 4 / st.view.scale]);
            ctx.strokeRect(st.rect.x, st.rect.y, st.rect.w, st.rect.h);
            ctx.setLineDash([]);
        }
        ctx.restore();
    }

    function drawThumb(id) {
        var node = document.querySelector('.eng[data-eng="' + id + '"] .eng-thumb');
        if (!node) return;
        var map = st.engines[id];
        var ctx = node.getContext('2d');
        ctx.clearRect(0, 0, THUMB_W, THUMB_H);
        if (!map) return;
        /* Letterbox so a portrait and a landscape engine map are comparable. */
        var k = Math.min(THUMB_W / st.ww, THUMB_H / st.wh);
        var dw = Math.max(1, Math.round(st.ww * k)), dh = Math.max(1, Math.round(st.wh * k));
        var im = ctx.createImageData(dw, dh);
        var d = im.data;
        for (var y = 0; y < dh; y++) {
            var sy = Math.min(st.wh - 1, ((y + 0.5) / k) | 0);
            for (var x = 0; x < dw; x++) {
                var sx = Math.min(st.ww - 1, ((x + 0.5) / k) | 0);
                var g = Math.round(C.clamp01(map[sy * st.ww + sx]) * 255);
                var q = (y * dw + x) * 4;
                d[q] = d[q + 1] = d[q + 2] = g; d[q + 3] = 255;
            }
        }
        ctx.putImageData(im, Math.round((THUMB_W - dw) / 2), Math.round((THUMB_H - dh) / 2));
    }

    function paintEngineTimes() {
        ENGINE_IDS.forEach(function (id) {
            var node = document.querySelector('.eng[data-eng="' + id + '"] .eng-ms');
            if (!node) return;
            var ms = st.engineMs[id];
            node.textContent = ms == null ? '—' : (ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s');
        });
    }

    function drawHistogram(map) {
        var cvs = el('hist');
        if (!cvs || !map) return;
        var ctx = cvs.getContext('2d');
        var W = cvs.width, H = cvs.height;
        var bins = new Float64Array(96);
        for (var i = 0; i < map.length; i++) bins[Math.min(95, (C.clamp01(map[i]) * 96) | 0)]++;
        var max = 0;
        /* Log scale: the ends of an alpha histogram are two spikes a thousand
           times taller than the middle, and the middle is the part you are
           trying to read. */
        for (var b = 0; b < 96; b++) { bins[b] = Math.log(1 + bins[b]); if (bins[b] > max) max = bins[b]; }
        var cs = getComputedStyle(document.documentElement);
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = (cs.getPropertyValue('--phos-dim') || '#b07b06').trim();
        var bw = W / 96;
        for (var j = 0; j < 96; j++) {
            var hgt = max > 0 ? (bins[j] / max) * (H - 2) : 0;
            ctx.fillRect(j * bw, H - hgt, Math.max(1, bw - 0.5), hgt);
        }
        ctx.fillStyle = (cs.getPropertyValue('--s6') || '#4c9aff').trim();
        ctx.fillRect(W * v('sh_black') / 100, 0, 1, H);
        ctx.fillRect(W * v('sh_white') / 100 - 1, 0, 1, H);
    }

    /* ═══ SOURCE ═════════════════════════════════════════════════════════ */

    function loadFile(f, isPlate) {
        if (!f || !/^image\//.test(f.type)) {
            if (window.CAS) CAS.toast('NOT AN IMAGE', true);
            return;
        }
        var url = URL.createObjectURL(f);
        var img = new Image();
        img.onload = function () {
            URL.revokeObjectURL(url);
            if (isPlate) {
                st.plateImg = img; st.plateName = f.name;
                txt('plateName', f.name);
                el('plateClear').disabled = false;
                el('e_plate').checked = true;
                rebuildPlate();
                invalidate(1);
            } else {
                setSource(img, f.name);
            }
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            if (window.CAS) CAS.toast('COULD NOT DECODE', true);
        };
        img.src = url;
    }

    function setSource(img, name) {
        st.srcImg = img; st.name = name || 'pasted';
        st.srcW = img.naturalWidth || img.width;
        st.srcH = img.naturalHeight || img.height;
        st.srcVersion++;
        st.strokes = []; st.rect = null; st.markVersion++;
        st.engines = {}; st.engineSig = {}; st.engineMs = {};
        st.neural.map = null; st.neural.sig = '';
        st.view.fit = true;
        st.solo = null;
        $$('.eng').forEach(function (e) { e.classList.remove('solo'); });

        txt('sName', st.name);
        txt('sSize', st.srcW + ' × ' + st.srcH + '  ·  ' + ((st.srcW * st.srcH) / 1e6).toFixed(1) + ' MP');
        el('hint').style.display = 'none';
        wrap.classList.add('has-img');
        updateMarkStat();

        rebuildWork();
        rebuildPlate();
        dirty = 0;
        run();
    }

    function rebuildWork() {
        if (!st.srcImg) return;
        var cap = +el('workRes').value;
        var wh = workSize(st.srcW, st.srcH, cap);
        st.ww = wh[0]; st.wh = wh[1];
        var im = rasterise(st.srcImg, st.ww, st.wh);
        st.work = C.makeImage(im);
        st.workRgb01 = new Float32Array(st.work.n * 3);
        for (var i = 0; i < st.workRgb01.length; i++) st.workRgb01[i] = st.work.rgb[i] / 255;
        st.engineSig = {};
        txt('fWork', st.ww + ' × ' + st.wh);
    }

    function rebuildPlate() {
        if (!st.plateImg || !st.ww) { st.plateWork = null; return; }
        st.plateWork = C.makeImage(rasterise(st.plateImg, st.ww, st.wh));
    }

    /* ═══ VIEWPORT & PAINTING ════════════════════════════════════════════ */

    function toImage(ev) {
        var box = wrap.getBoundingClientRect();
        return {
            x: (ev.clientX - box.left - st.view.x) / st.view.scale,
            y: (ev.clientY - box.top - st.view.y) / st.view.scale
        };
    }

    var pointer = { down: false, mode: null, last: null, stroke: null, rect0: null };
    var spaceHeld = false;

    function currentTool() {
        if (spaceHeld) return 'pan';
        if (st.pickMode) return 'pick';
        return radio('tool');
    }

    function updateCursor() {
        var t = currentTool();
        wrap.classList.toggle('paint', t === 'fg' || t === 'bg' || t === 'erase' || t === 'rect');
        wrap.classList.toggle('pick', t === 'pick');
    }

    wrap.addEventListener('pointerdown', function (ev) {
        if (!st.srcImg) return;
        wrap.setPointerCapture(ev.pointerId);
        var t = currentTool();
        var p = toImage(ev);

        if (t === 'pick') {
            pickColourAt(p);
            return;
        }
        pointer.down = true;
        pointer.last = { x: ev.clientX, y: ev.clientY };

        if (t === 'pan') {
            pointer.mode = 'pan';
            wrap.classList.add('panning');
            st.view.fit = false;
        } else if (t === 'rect') {
            pointer.mode = 'rect';
            pointer.rect0 = p;
            st.rect = { x: p.x, y: p.y, w: 0, h: 0 };
        } else {
            pointer.mode = 'paint';
            pointer.stroke = {
                label: t === 'fg' ? 1 : t === 'bg' ? 2 : 0,
                r: v('brushSize') / 2,
                pts: [p.x, p.y]
            };
            st.strokes.push(pointer.stroke);
            draw();
        }
    });

    wrap.addEventListener('pointermove', function (ev) {
        if (!pointer.down) return;
        if (pointer.mode === 'pan') {
            st.view.x += ev.clientX - pointer.last.x;
            st.view.y += ev.clientY - pointer.last.y;
            pointer.last = { x: ev.clientX, y: ev.clientY };
            draw();
        } else if (pointer.mode === 'rect') {
            var p = toImage(ev);
            st.rect = {
                x: Math.min(pointer.rect0.x, p.x), y: Math.min(pointer.rect0.y, p.y),
                w: Math.abs(p.x - pointer.rect0.x), h: Math.abs(p.y - pointer.rect0.y)
            };
            draw();
        } else if (pointer.mode === 'paint') {
            var q = toImage(ev);
            var pts = pointer.stroke.pts;
            var dx = q.x - pts[pts.length - 2], dy = q.y - pts[pts.length - 1];
            /* Thin the polyline: a pointer emits far more samples than a
               stroke needs, and every one of them is replayed on every
               rasterisation. */
            if (dx * dx + dy * dy < 4) return;
            pts.push(q.x, q.y);
            draw();
        }
    });

    function endPointer() {
        if (!pointer.down) return;
        pointer.down = false;
        wrap.classList.remove('panning');
        if (pointer.mode === 'paint') {
            st.markVersion++;
            updateMarkStat();
            invalidate(1);
        } else if (pointer.mode === 'rect') {
            if (!st.rect || st.rect.w < 4 || st.rect.h < 4) st.rect = null;
            else if (el('g_seed').value !== 'rect') {
                el('g_seed').value = 'rect';
                if (window.CAS) CAS.toast('GRAPH CUT NOW STARTS FROM THE BOX');
            }
            invalidate(1);
        }
        pointer.mode = null; pointer.stroke = null;
    }
    wrap.addEventListener('pointerup', endPointer);
    wrap.addEventListener('pointercancel', endPointer);

    wrap.addEventListener('wheel', function (ev) {
        if (!st.srcImg) return;
        ev.preventDefault();
        var box = wrap.getBoundingClientRect();
        var mx = ev.clientX - box.left, my = ev.clientY - box.top;
        var before = { x: (mx - st.view.x) / st.view.scale, y: (my - st.view.y) / st.view.scale };
        if (st.view.fit) { st.view.scale = fitScale(); st.view.fit = false; }
        var k = Math.exp(-ev.deltaY * 0.0016);
        st.view.scale = Math.max(0.02, Math.min(60, st.view.scale * k));
        st.view.x = mx - before.x * st.view.scale;
        st.view.y = my - before.y * st.view.scale;
        draw();
    }, { passive: false });

    wrap.addEventListener('dblclick', function () { st.view.fit = true; draw(); });

    function pickColourAt(p) {
        if (!st.work) return;
        var x = Math.round(p.x * st.ww / st.srcW), y = Math.round(p.y * st.wh / st.srcH);
        if (x < 0 || y < 0 || x >= st.ww || y >= st.wh) return;
        var o = (y * st.ww + x) * 3;
        addKey([st.work.rgb[o], st.work.rgb[o + 1], st.work.rgb[o + 2]]);
        st.pickMode = false;
        el('k_pick').setAttribute('aria-pressed', 'false');
        updateCursor();
    }

    /* ═══ KEY COLOURS ════════════════════════════════════════════════════ */

    function addKey(rgb) {
        st.keys.push(rgb.map(function (x) { return Math.round(x); }));
        el('e_chroma').checked = true;
        paintKeys();
        invalidate(1);
    }

    function paintKeys() {
        var list = el('keyList');
        list.innerHTML = '';
        if (!st.keys.length) {
            var s = document.createElement('span');
            s.className = 'hint';
            s.textContent = 'none — add one';
            list.appendChild(s);
            return;
        }
        st.keys.forEach(function (c, i) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'sw';
            b.style.background = rgbToHex(c);
            b.title = 'Remove ' + rgbToHex(c);
            b.setAttribute('aria-label', 'Remove key colour ' + rgbToHex(c));
            b.addEventListener('click', function () {
                st.keys.splice(i, 1);
                paintKeys();
                invalidate(1);
            });
            list.appendChild(b);
        });
    }

    /* ═══ EXPORT ═════════════════════════════════════════════════════════ */

    function enableExport(on) {
        ['saveBtn', 'maskBtn', 'copyBtn'].forEach(function (id) { el(id).disabled = !on; });
        txt('dockStat', on ? st.srcW + '×' + st.srcH : 'NO IMAGE');
    }

    async function exportCanvas() {
        var scale = v('out_scale') / 100;
        var tw = Math.max(1, Math.round(st.srcW * scale));
        var th = Math.max(1, Math.round(st.srcH * scale));
        var cvs = document.createElement('canvas');
        busy(true, 0.5, 'RENDERING ' + tw + '×' + th);
        await frame();
        await composeInto(cvs, tw, th);
        busy(false);
        /* composeInto leaves st.outAlpha at whatever size it just rendered, so
           an export at 40% would quietly downgrade the ALPHA view and the soft
           pixel readout until something else moved. Put the preview back. */
        invalidate(5);
        return cvs;
    }

    function download(cvs, suffix) {
        var fmt = el('out_format').value;
        var type = fmt === 'webp' ? 'image/webp' : 'image/png';
        var base = (st.name || 'cutout').replace(/\.[^.]+$/, '');
        cvs.toBlob(function (blob) {
            if (!blob) { if (window.CAS) CAS.toast('EXPORT FAILED', true); return; }
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = base + suffix + '.' + (fmt === 'webp' ? 'webp' : 'png');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
            if (window.CAS) CAS.toast('SAVED ' + fmtBytes(blob.size));
        }, type, 0.95);
    }

    /* ═══ PERSISTENCE ════════════════════════════════════════════════════ */

    function controls() {
        return $$('input, select', document).filter(function (n) {
            return n.type !== 'file' && n.type !== 'button' && !n.dataset.noSave && (n.id || n.name);
        });
    }

    function save() {
        var out = {};
        controls().forEach(function (n) {
            if (n.type === 'checkbox') { if (n.id) out['c:' + n.id] = n.checked; }
            else if (n.type === 'radio') { if (n.checked && n.name) out['r:' + n.name] = n.value; }
            else if (n.id) out['v:' + n.id] = n.value;
        });
        out['keys'] = st.keys;
        try { localStorage.setItem(STORE, JSON.stringify(out)); } catch (e) {}
    }

    function restore() {
        var s;
        try { s = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { s = null; }
        if (!s) return;
        controls().forEach(function (n) {
            if (n.type === 'checkbox') { if (n.id && typeof s['c:' + n.id] === 'boolean') n.checked = s['c:' + n.id]; }
            else if (n.type === 'radio') { if (n.name && typeof s['r:' + n.name] === 'string') n.checked = n.value === s['r:' + n.name]; }
            else if (n.id && typeof s['v:' + n.id] === 'string') n.value = s['v:' + n.id];
        });
        if (Array.isArray(s.keys)) st.keys = s.keys;
        /* The neural engine can never come back switched on: its model is not
           in storage, and a checked box with nothing behind it is a lie. */
        el('e_neural').checked = false;
        el('e_neural').disabled = true;
    }

    /* ═══ BINDING ════════════════════════════════════════════════════════

       One table from control to the stage it dirties. Anything not listed
       here only affects what is drawn, not what is computed.               */

    var LEVELS = {
        workRes: 0,
        e_border: 1, e_chroma: 1, e_ift: 1, e_saliency: 1, e_slic: 1, e_grabcut: 1, e_plate: 1, e_manual: 1, e_neural: 1,
        b_band: 1, b_quant: 1, b_sharp: 1, b_top: 1, b_bottom: 1, b_left: 1, b_right: 1,
        k_inner: 1, k_outer: 1, k_chroma: 1, k_luma: 1,
        i_metric: 1, i_sigma: 1, i_chroma: 1, i_gamma: 1,
        s_ft: 1, s_sr: 1, s_hc: 1, s_centre: 1,
        p_count: 1, p_compact: 1, p_sigma: 1,
        g_seed: 1, g_iter: 1, g_gamma: 1, g_k: 1,
        pl_inner: 1, pl_outer: 1, pl_shadow: 1,
        m_spread: 1,
        w_border: 2, w_chroma: 2, w_ift: 2, w_saliency: 2, w_slic: 2,
        w_grabcut: 2, w_plate: 2, w_manual: 2, w_neural: 2,
        sh_black: 3, sh_white: 3, sh_gamma: 3, sh_open: 3, sh_close: 3,
        sh_blobs: 3, sh_minfrac: 3, sh_holes: 3, sh_shift: 3,
        crf_on: 3, crf_iter: 3, crf_spatial: 3, crf_colour: 3, crf_wb: 3,
        mt_method: 4, mt_band: 4, mt_eps: 4, mt_iter: 4, mt_radius: 4,
        mt_geps: 4, mt_rays: 4, mt_ggamma: 4,
        dc_on: 5, dc_strength: 5, ds_on: 5, ds_strength: 5, ds_luma: 5,
        out_bg: 5, out_colour: 5, out_blur: 5
    };

    function onControl(ev) {
        var t = ev.target;
        paintReadouts();
        save();

        if (t.name === 'mixMode') { invalidate(2); return; }
        if (t.name === 'vMode') { draw(); return; }
        if (t.name === 'tool') { updateCursor(); return; }
        if (t.id === 'out_scale') { txt('oDim', Math.round(st.srcW * v('out_scale') / 100) + ' × ' + Math.round(st.srcH * v('out_scale') / 100)); return; }
        if (t.id === 'out_format' || t.id === 'brushSize') return;

        if (t.id === 'workRes') {
            rebuildWork(); rebuildPlate();
            st.neural.sig = '';
            invalidate(1);
            return;
        }
        if (t.id === 'mt_method') { showMatteFields(); invalidate(4); return; }
        if (t.id === 'sh_black' || t.id === 'sh_white') drawHistogram(st.mixed);

        var lv = LEVELS[t.id];
        if (lv !== undefined) invalidate(lv);
    }

    function showMatteFields() {
        var m = el('mt_method').value;
        $$('[data-for]').forEach(function (n) {
            n.style.display = n.getAttribute('data-for') === m ? '' : 'none';
        });
    }

    function updateMarkStat() {
        var n = st.strokes.length;
        txt('markStat', n + (n === 1 ? ' STROKE' : ' STROKES'));
        el('undoBtn').disabled = n === 0;
        el('clearMarks').disabled = n === 0 && !st.rect;
    }

    /* ── wiring ─────────────────────────────────────────────────────────── */

    document.addEventListener('input', onControl);
    document.addEventListener('change', onControl);

    el('pickBtn').addEventListener('click', function () { el('file').click(); });
    el('file').addEventListener('change', function (e) { if (e.target.files[0]) loadFile(e.target.files[0], false); });
    el('plateBtn').addEventListener('click', function () { el('plateFile').click(); });
    el('plateFile').addEventListener('change', function (e) { if (e.target.files[0]) loadFile(e.target.files[0], true); });
    el('plateClear').addEventListener('click', function () {
        st.plateImg = null; st.plateWork = null; st.plateName = '';
        txt('plateName', '—');
        el('plateClear').disabled = true;
        el('e_plate').checked = false;
        invalidate(1);
    });

    $$('.eng-more').forEach(function (b) {
        b.addEventListener('click', function () {
            var box = b.closest('.eng');
            var open = box.classList.toggle('open');
            b.setAttribute('aria-expanded', open ? 'true' : 'false');
            b.innerHTML = open ? '&#9652;' : '&#9662;';
        });
    });

    $$('.eng-thumb').forEach(function (cv) {
        cv.addEventListener('click', function () {
            var box = cv.closest('.eng');
            var id = box.getAttribute('data-eng');
            var on = el('e_' + id);
            if (on.disabled) { if (window.CAS) CAS.toast('LOAD THE MODEL FIRST', true); return; }
            if (!on.checked) {
                on.checked = true;
                save();
                invalidate(1);
                return;
            }
            st.solo = st.solo === id ? null : id;
            $$('.eng').forEach(function (e) { e.classList.toggle('solo', e.getAttribute('data-eng') === st.solo); });
            if (window.CAS) CAS.toast(st.solo ? 'SOLO — ' + id.toUpperCase() : 'ALL ENGINES');
            invalidate(2);
        });
    });

    el('k_auto').addEventListener('click', function () {
        if (!st.work) { if (window.CAS) CAS.toast('LOAD AN IMAGE FIRST', true); return; }
        addKey(C.autoKey(st.work));
    });
    el('k_pick').addEventListener('click', function () {
        st.pickMode = !st.pickMode;
        el('k_pick').setAttribute('aria-pressed', st.pickMode ? 'true' : 'false');
        updateCursor();
        if (st.pickMode && window.CAS) CAS.toast('CLICK THE SCREEN COLOUR');
    });

    el('undoBtn').addEventListener('click', function () {
        if (!st.strokes.length) return;
        st.strokes.pop();
        st.markVersion++;
        updateMarkStat();
        draw();
        invalidate(1);
    });
    el('clearMarks').addEventListener('click', function () {
        st.strokes = []; st.rect = null;
        st.markVersion++;
        updateMarkStat();
        draw();
        invalidate(1);
    });

    el('marksBtn').addEventListener('click', function () {
        st.showMarks = !st.showMarks;
        el('marksBtn').setAttribute('aria-pressed', st.showMarks ? 'true' : 'false');
        draw();
    });
    el('compBtn').addEventListener('click', function () {
        st.solidBg = !st.solidBg;
        el('compBtn').setAttribute('aria-pressed', st.solidBg ? 'true' : 'false');
        draw();
    });

    el('zoomIn').addEventListener('click', function () {
        if (st.view.fit) { st.view.scale = fitScale(); st.view.fit = false; }
        st.view.scale = Math.min(60, st.view.scale * 1.3); draw();
    });
    el('zoomOut').addEventListener('click', function () {
        if (st.view.fit) { st.view.scale = fitScale(); st.view.fit = false; }
        st.view.scale = Math.max(0.02, st.view.scale / 1.3); draw();
    });
    el('fitBtn').addEventListener('click', function () { st.view.fit = true; draw(); });
    el('oneBtn').addEventListener('click', function () {
        var box = wrap.getBoundingClientRect();
        st.view.fit = false; st.view.scale = 1;
        st.view.x = (box.width - st.srcW) / 2; st.view.y = (box.height - st.srcH) / 2;
        draw();
    });

    el('n_load').addEventListener('click', loadNeural);

    el('saveBtn').addEventListener('click', async function () {
        var cvs = await exportCanvas();
        download(cvs, '-cutout');
    });
    el('maskBtn').addEventListener('click', async function () {
        await exportCanvas();      /* refreshes st.outAlpha at export size */
        var cvs = document.createElement('canvas');
        cvs.width = st.outW; cvs.height = st.outH;
        var ctx = cvs.getContext('2d');
        var im = ctx.createImageData(st.outW, st.outH);
        for (var i = 0, q = 0; i < st.outAlpha.length; i++, q += 4) {
            var g = Math.round(st.outAlpha[i] * 255);
            im.data[q] = im.data[q + 1] = im.data[q + 2] = g;
            im.data[q + 3] = 255;
        }
        ctx.putImageData(im, 0, 0);
        download(cvs, '-mask');
    });
    el('copyBtn').addEventListener('click', async function () {
        try {
            var cvs = await exportCanvas();
            var blob = await new Promise(function (r) { cvs.toBlob(r, 'image/png'); });
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            if (window.CAS) CAS.toast('COPIED TO CLIPBOARD');
        } catch (e) {
            if (window.CAS) CAS.toast('CLIPBOARD BLOCKED — USE EXPORT', true);
        }
    });
    el('resetBtn').addEventListener('click', function () {
        try { localStorage.removeItem(STORE); } catch (e) {}
        location.reload();
    });

    /* Drag and drop, paste. */
    ['dragenter', 'dragover'].forEach(function (n) {
        wrap.addEventListener(n, function (e) { e.preventDefault(); wrap.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (n) {
        wrap.addEventListener(n, function (e) { e.preventDefault(); wrap.classList.remove('drag'); });
    });
    wrap.addEventListener('drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files[0];
        if (f) loadFile(f, e.shiftKey);
    });
    window.addEventListener('paste', function (e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== 0) continue;
            loadFile(items[i].getAsFile(), false);
            e.preventDefault();
            return;
        }
    });

    /* Keyboard. */
    var TOOL_KEYS = { '1': 'pan', '2': 'fg', '3': 'bg', '4': 'erase', '5': 'rect' };
    window.addEventListener('keydown', function (e) {
        var tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.code === 'Space' && !spaceHeld) { spaceHeld = true; updateCursor(); e.preventDefault(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault(); el('undoBtn').click(); return;
        }
        if (TOOL_KEYS[e.key]) {
            var r = document.querySelector('input[name="tool"][value="' + TOOL_KEYS[e.key] + '"]');
            if (r) { r.checked = true; updateCursor(); save(); }
            return;
        }
        if (e.key === '[') { el('brushSize').value = Math.max(2, v('brushSize') - 4); paintReadouts(); save(); }
        if (e.key === ']') { el('brushSize').value = Math.min(200, v('brushSize') + 4); paintReadouts(); save(); }
    });
    window.addEventListener('keyup', function (e) {
        if (e.code === 'Space') { spaceHeld = false; updateCursor(); }
    });

    window.addEventListener('resize', CAS.debounce(function () { draw(); }, 120));

    /* ── boot ───────────────────────────────────────────────────────────── */
    restore();
    paintReadouts();
    paintKeys();
    showMatteFields();
    updateMarkStat();
    updateCursor();
    enableExport(false);
    draw();

    /* Expose the internals for the console — this is a lab, and being able to
       poke the engines by hand is half of what that means. */
    window.LAB = {
        st: st, run: run, invalidate: invalidate, CUT: C,
        result: resultCanvas, compose: composeInto,
        /* True when everything the controls asked for has actually been
           computed — nothing pending, nothing in flight. */
        idle: function () { return dirty > 5 && !running; }
    };
})();
