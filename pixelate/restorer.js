/* ============================================================================
   PIXEL RESTORER — page wiring for demixel.js
   ---------------------------------------------------------------------------
   The pipeline is staged and cached, because the stages cost wildly different
   amounts and the controls that drive them change at wildly different rates.
   Detection sweeps a few thousand comb candidates and only ever needs to run
   on load or on demand; dragging the palette slider must not re-run it.

        source ──▶ grid ──▶ cells ──▶ palette ──▶ indices ──▶ raster
                    ▲         ▲          ▲           ▲
                 detect   sampling    palette     despeckle

   Each entry point invalidates its own stage and everything downstream, and
   nothing above it.
   ========================================================================= */
(function () {
    'use strict';

    var D = window.DEMIXEL;
    var S = window.SRCH;
    var el = function (id) { return document.getElementById(id); };

    /* ── Header furniture ────────────────────────────────────────────────── */
    if (window.CAS) CAS.bootOnce(el('headScreen'));
    S.clock(el('clock'));
    var trace = S.scope(el('scope'));
    S.themeSwitch(el('themeSw'), function () { if (trace) trace.repaint(); });
    if (window.CAS) CAS.pageTransition();

    /* ── State ───────────────────────────────────────────────────────────── */
    var st = {
        name: '', src: null, srcCanvas: null,
        grid: null, cells: null, palette: null, idx: null,
        out: null, outCanvas: null,
        showSource: false, showGrid: false,
        /* View transform. fit=true means the scale is recomputed from the box
           on every draw, so a resize keeps the art framed. */
        view: { scale: 1, x: 0, y: 0, fit: true }
    };

    var view = el('view'), vctx = view.getContext('2d');
    var wrap = el('wrap');

    function busy(on) {
        document.querySelector('.controls').classList.toggle('busy', on);
        el('vStat').textContent = on ? 'WORKING' : (st.out ? 'READY' : 'IDLE');
        el('vLed').className = 'led' + (st.out && !on ? ' on green' : '');
    }

    /* ── Stage 1: load ───────────────────────────────────────────────────── */

    function loadFile(file) {
        if (!file || !/^image\//.test(file.type)) {
            if (window.CAS) CAS.toast('NOT AN IMAGE', true);
            return;
        }
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
            URL.revokeObjectURL(url);
            var c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            var cx = c.getContext('2d', { willReadFrequently: true });
            cx.drawImage(img, 0, 0);
            st.name = file.name || 'pasted';
            st.srcCanvas = c;
            st.src = cx.getImageData(0, 0, c.width, c.height);
            el('sName').textContent = st.name.length > 24 ? st.name.slice(0, 22) + '…' : st.name;
            el('sSize').textContent = c.width + ' × ' + c.height;
            el('fSrc').textContent = c.width + '×' + c.height;
            el('hint').style.display = 'none';
            wrap.classList.add('has-img');
            st.view.fit = true;
            runDetect();
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            if (window.CAS) CAS.toast('COULD NOT DECODE THAT FILE', true);
        };
        img.src = url;
    }

    /* ── Stage 2: detect ─────────────────────────────────────────────────── */

    function runDetect() {
        if (!st.src) return;
        busy(true);
        /* A timer, not requestAnimationFrame. The point of deferring is to let
           the WORKING lamp paint before the sweep blocks the thread, and rAF
           does that — but rAF does not fire at all in a tab that is not
           compositing, so backgrounding the page mid-detect left the panel
           stuck on WORKING with its controls disabled and nothing to clear
           them. A timer still fires when backgrounded. */
        setTimeout(function () {
            var t0 = performance.now();
            try {
                st.grid = D.detectGrid(st.src);
            } catch (err) {
                /* Never strand the panel behind a busy flag. */
                busy(false);
                if (window.CAS) CAS.toast('DETECTION FAILED', true);
                throw err;
            }
            var ms = Math.round(performance.now() - t0);

            /* Independent axes can disagree — measured 9.05 vs 9.63 on a real
               generation, a 6% split that silently restretches the art. Unless
               the user has asked for anisotropy, take the mean of the two. */
            var dw = st.grid.cellW, dh = st.grid.cellH;
            if (el('sqLock').checked) { dw = dh = (dw + dh) / 2; }
            el('cellW').value = dw.toFixed(2);
            el('cellH').value = dh.toFixed(2);
            el('offX').value = st.grid.offsetX.toFixed(2);
            el('offY').value = st.grid.offsetY.toFixed(2);

            var pct = Math.round(st.grid.confidence * 100);
            el('confPct').textContent = pct + '%';
            el('confBar').style.width = pct + '%';
            el('gLed').className = 'led on' + (pct >= 40 ? ' green' : (pct >= 15 ? '' : ' red'));
            el('gStat').textContent = pct >= 40 ? 'LOCKED' : (pct >= 15 ? 'WEAK' : 'NO GRID');
            el('confNote').textContent = pct >= 40
                ? 'A clean repeating block edge. The numbers below should need no help.'
                : (pct >= 15
                    ? 'The grid is there but noisy. Check it against the overlay, and try the other readings if the output looks doubled or halved.'
                    : 'No convincing repeat — most likely this was drawn at full resolution in a pixel style rather than upscaled from a grid. There is nothing to recover; use SET THE ART SIZE below to choose a resolution instead.');

            renderAlternates();
            renderDivisors();
            el('fMs').textContent = ms + 'ms';
            runResample();
        }, 30);
    }

    function renderAlternates() {
        var box = el('alts');
        box.innerHTML = '';
        var ax = (st.grid && st.grid.altsX) || [];
        var ay = (st.grid && st.grid.altsY) || [];
        var n = Math.max(ax.length, ay.length);
        if (n < 2) { box.innerHTML = '<span class="hint">—</span>'; return; }
        for (var i = 0; i < n; i++) {
            var cw = (ax[i] || ax[ax.length - 1]).period;
            var ch = (ay[i] || ay[ay.length - 1]).period;
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'key';
            b.textContent = cw.toFixed(1) + ' × ' + ch.toFixed(1);
            /* Closure per button so each keeps its own pair. */
            (function (w, h, px, py) {
                b.addEventListener('click', function () {
                    el('cellW').value = w.toFixed(2);
                    el('cellH').value = h.toFixed(2);
                    el('offX').value = px.toFixed(2);
                    el('offY').value = py.toFixed(2);
                    runResample();
                });
            })(cw, ch, (ax[i] || ax[0]).phase, (ay[i] || ay[0]).phase);
            box.appendChild(b);
        }
    }

    /* ── Stage 3: resample ───────────────────────────────────────────────── */

    function readGrid() {
        var cw = parseFloat(el('cellW').value), ch = parseFloat(el('cellH').value);
        var ox = parseFloat(el('offX').value), oy = parseFloat(el('offY').value);
        if (!(cw > 0)) cw = 1;
        if (!(ch > 0)) ch = 1;
        return {
            cellW: cw, cellH: ch,
            offsetX: isFinite(ox) ? ox : 0,
            offsetY: isFinite(oy) ? oy : 0
        };
    }

    function runResample() {
        if (!st.src) return;
        var g = readGrid();
        var t0 = performance.now();
        st.cells = D.extractCells(st.src, g, {
            mode: S.r('mode') || 'dominant',
            inset: parseInt(el('inset').value, 10) / 100
        });
        el('artW').value = st.cells.cols;
        el('artH').value = st.cells.rows;
        el('fGrid').textContent = g.cellW.toFixed(2) + '×' + g.cellH.toFixed(2) +
                                  ' @' + g.offsetX.toFixed(1) + ',' + g.offsetY.toFixed(1);
        el('fMs').textContent = Math.round(performance.now() - t0) + 'ms';
        runPalette();
    }

    /* ── Stage 4: palette ────────────────────────────────────────────────── */

    function runPalette() {
        if (!st.cells) return;
        if (el('palOn').checked) {
            st.palette = D.buildPalette(st.cells, parseInt(el('palN').value, 10));
            st.idx = D.mapToPalette(st.cells, st.palette);
        } else {
            st.palette = null;
            st.idx = null;
        }
        var sw = el('swatches');
        sw.innerHTML = '';
        if (st.palette) {
            st.palette.forEach(function (p) {
                var i = document.createElement('i');
                i.style.background = 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')';
                i.title = '#' + [p[0], p[1], p[2]].map(function (v) {
                    return ('0' + v.toString(16)).slice(-2);
                }).join('');
                sw.appendChild(i);
            });
        } else {
            sw.innerHTML = '<span class="hint">Palette rebuild is off — cells keep their sampled colours.</span>';
        }
        runCompose();
    }

    /* ── Stage 5: compose ────────────────────────────────────────────────── */

    function runCompose() {
        if (!st.cells) return;
        var idx = st.idx;
        if (idx && el('despOn').checked) {
            idx = D.despeckle(idx, st.cells.cols, st.cells.rows, parseInt(S.r('desp'), 10) || 4);
        }
        st.out = D.toImageData(st.cells, st.palette, idx);

        var c = document.createElement('canvas');
        c.width = st.out.width; c.height = st.out.height;
        c.getContext('2d').putImageData(st.out, 0, 0);
        st.outCanvas = c;

        el('oDim').textContent = st.out.width + ' × ' + st.out.height;
        el('oCols').textContent = D.countColours(st.out);
        el('fOut').textContent = st.out.width + '×' + st.out.height;
        el('dockStat').textContent = st.out.width + '×' + st.out.height + ' · ' + D.countColours(st.out) + ' COLOURS';
        el('saveBtn').disabled = false;
        busy(false);
        draw();
    }

    /* ── View ────────────────────────────────────────────────────────────────
       The canvas is the size of its box and never changes; the artwork is
       positioned inside it by a transform. Drawing the image at its natural
       size into a resized canvas — which is what this did before — cannot pan,
       and has to rebuild the bitmap on every zoom step.

       Scale snaps to a ladder rather than moving continuously. Pixel art at
       3.7x puts some art pixels on 4 screen pixels and some on 3, which reads
       as exactly the unevenness this tool exists to remove; every rung at or
       above 1 is a whole number so the grid stays even. */

    var LADDER = [1/16, 1/12, 1/8, 1/6, 1/4, 1/3, 1/2, 2/3,
                  1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

    function activeCanvas() {
        return st.showSource ? st.srcCanvas : st.outCanvas;
    }

    function boxSize() {
        return { w: wrap.clientWidth, h: wrap.clientHeight };
    }

    function fitScale(cv) {
        var b = boxSize();
        if (!cv || !b.w || !b.h) return 1;
        return Math.min((b.w - 24) / cv.width, (b.h - 24) / cv.height);
    }

    /* Nearest rung, used when leaving FIT so the first zoom step is sane. */
    function nearestRung(s) {
        var best = 0, bd = Infinity;
        for (var i = 0; i < LADDER.length; i++) {
            var d = Math.abs(Math.log(LADDER[i] / s));
            if (d < bd) { bd = d; best = i; }
        }
        return best;
    }

    function currentScale() {
        var cv = activeCanvas();
        return st.view.fit ? fitScale(cv) : st.view.scale;
    }

    /* Centre the art in the box. */
    function centre() {
        var cv = activeCanvas(); if (!cv) return;
        var b = boxSize(), s = currentScale();
        st.view.x = (b.w - cv.width * s) / 2;
        st.view.y = (b.h - cv.height * s) / 2;
    }

    function doFit() {
        st.view.fit = true;
        st.view.scale = fitScale(activeCanvas());
        centre();
        draw();
    }

    /* Keep the art reachable: at least a quarter of it must stay in the box,
       so a stray drag can never fling it somewhere you cannot get it back. */
    function clampPan() {
        var cv = activeCanvas(); if (!cv) return;
        var b = boxSize(), s = currentScale();
        var w = cv.width * s, h = cv.height * s;
        var minVis = Math.min(w, b.w) * 0.25, minVisY = Math.min(h, b.h) * 0.25;
        st.view.x = Math.min(b.w - minVis, Math.max(minVis - w, st.view.x));
        st.view.y = Math.min(b.h - minVisY, Math.max(minVisY - h, st.view.y));
    }

    /* Zoom about a point in box coordinates, so the pixel under the cursor
       stays under the cursor — the thing that makes wheel zoom feel anchored
       rather than like the image jumping. */
    function zoomTo(rung, cx, cy) {
        var cv = activeCanvas(); if (!cv) return;
        var b = boxSize();
        if (cx === undefined) { cx = b.w / 2; cy = b.h / 2; }
        var oldS = currentScale();
        var newS = LADDER[Math.max(0, Math.min(LADDER.length - 1, rung))];
        /* Art-space point under the cursor before the change. */
        var ax = (cx - st.view.x) / oldS, ay = (cy - st.view.y) / oldS;
        st.view.fit = false;
        st.view.scale = newS;
        st.view.x = cx - ax * newS;
        st.view.y = cy - ay * newS;
        clampPan();
        draw();
    }

    function stepZoom(dir, cx, cy) {
        var rung = st.view.fit ? nearestRung(fitScale(activeCanvas())) : nearestRung(st.view.scale);
        zoomTo(rung + dir, cx, cy);
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
        if (st.view.fit) { st.view.scale = fitScale(cv); centre(); }

        var s = st.view.scale;
        vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        vctx.imageSmoothingEnabled = false;
        vctx.drawImage(cv, st.view.x, st.view.y, cv.width * s, cv.height * s);

        el('zoomVal').textContent = st.view.fit
            ? 'FIT ' + Math.round(s * 100) + '%'
            : (s >= 1 ? Math.round(s * 100) + '%' : (Math.round(s * 1000) / 10) + '%');

        drawGridOverlay(s, dpr);
    }

    /* Where the detector thinks the seams are, drawn straight over the source
       so a wrong reading is visible rather than something you infer from a bad
       result. Shares the view transform, so it stays glued while you pan. */
    function drawGridOverlay(s, dpr) {
        if (!st.showGrid || !st.showSource || !st.srcCanvas) return;
        var cv = st.srcCanvas, g = readGrid();
        /* Below ~3px on screen the lines would be denser than the cells they
           describe and the overlay becomes a solid wash. */
        if (g.cellW * s < 3 || g.cellH * s < 3) return;

        vctx.save();
        vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        vctx.translate(st.view.x, st.view.y);
        vctx.lineWidth = 1;
        vctx.strokeStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--s1').trim() || '#e5484d';
        vctx.globalAlpha = 0.8;
        vctx.beginPath();
        var xs = D.axisCells(cv.width, g.cellW, g.offsetX);
        var ys = D.axisCells(cv.height, g.cellH, g.offsetY);
        var h = cv.height * s, w = cv.width * s, i, p;
        for (i = 0; i < xs.length; i++) { p = xs[i][0] * s; vctx.moveTo(p, 0); vctx.lineTo(p, h); }
        for (i = 0; i < ys.length; i++) { p = ys[i][0] * s; vctx.moveTo(0, p); vctx.lineTo(w, p); }
        vctx.stroke();
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
        wrap.addEventListener(ev, function (e) {
            e.preventDefault(); wrap.classList.add('drag');
        });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
        wrap.addEventListener(ev, function (e) {
            e.preventDefault(); wrap.classList.remove('drag');
        });
    });
    wrap.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });

    document.addEventListener('paste', function (e) {
        var items = (e.clipboardData || {}).items || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') === 0) {
                loadFile(items[i].getAsFile());
                break;
            }
        }
    });

    el('detectBtn').addEventListener('click', runDetect);

    ['cellW', 'cellH', 'offX', 'offY'].forEach(function (id) {
        el(id).addEventListener('input', debounce(function () {
            if ((id === 'cellW' || id === 'cellH') && el('sqLock').checked) {
                el(id === 'cellW' ? 'cellH' : 'cellW').value = el(id).value;
            }
            runResample();
        }, 220));
    });

    el('sqLock').addEventListener('change', function () {
        if (!this.checked) return;
        var w = parseFloat(el('cellW').value), h = parseFloat(el('cellH').value);
        if (w > 0 && h > 0) {
            var m = ((w + h) / 2).toFixed(2);
            el('cellW').value = m; el('cellH').value = m;
            runResample();
        }
    });

    /* ── Target size ─────────────────────────────────────────────────────────
       Detection assumes the art was upscaled FROM a small grid, so there is a
       grid down there to find. Plenty of AI "pixel art" is not that: it is
       rendered at full resolution in a pixel style, every neighbouring pixel
       different, no block structure at any scale. Tested on real generations
       at 888×1184 the confidence came back 12–14% — correctly, since roughly
       three quarters of their horizontal runs are a single pixel long and they
       carry 150,000 colours.

       For those there is nothing to recover and the resolution is a choice, so
       this just names it: cell size becomes source ÷ target, and the rest of
       the pipeline — inset sampling, OKLab palette, despeckle — runs unchanged.
       Grid recovery and honest downscaling are the same machine pointed at a
       different question. */

    function targetToGrid() {
        if (!st.srcCanvas) return;
        var aw = parseInt(el('artW').value, 10);
        var ah = parseInt(el('artH').value, 10);
        if (!(aw > 1) || !(ah > 1)) return;
        var cw = st.srcCanvas.width / aw, ch = st.srcCanvas.height / ah;
        if (el('sqLock').checked) { cw = ch = (cw + ch) / 2; }
        el('cellW').value = cw.toFixed(4);
        el('cellH').value = ch.toFixed(4);
        el('offX').value = '0';
        el('offY').value = '0';
        runResample();
    }

    ['artW', 'artH'].forEach(function (id) {
        el(id).addEventListener('input', debounce(targetToGrid, 260));
    });

    /* Divisor shortcuts, built from the source once an image is in. */
    function renderDivisors() {
        var box = el('divs');
        box.innerHTML = '';
        if (!st.srcCanvas) return;
        [4, 6, 8, 10, 12, 16].forEach(function (k) {
            var w = Math.round(st.srcCanvas.width / k);
            var h = Math.round(st.srcCanvas.height / k);
            if (w < 8 || h < 8) return;
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'key';
            b.textContent = '÷' + k + ' · ' + w + '×' + h;
            b.addEventListener('click', function () {
                el('artW').value = w;
                el('artH').value = h;
                targetToGrid();
            });
            box.appendChild(b);
        });
    }

    el('inset').addEventListener('input', function () {
        el('insetVal').textContent = this.value + '%';
    });
    el('inset').addEventListener('input', debounce(runResample, 160));
    document.querySelectorAll('input[name="mode"]').forEach(function (r) {
        r.addEventListener('change', runResample);
    });

    el('palOn').addEventListener('change', runPalette);
    el('palN').addEventListener('input', function () {
        el('palNVal').textContent = this.value;
    });
    el('palN').addEventListener('input', debounce(runPalette, 160));

    el('despOn').addEventListener('change', runCompose);
    document.querySelectorAll('input[name="desp"]').forEach(function (r) {
        r.addEventListener('change', runCompose);
    });

    el('scale').addEventListener('input', function () {
        el('scaleVal').textContent = this.value + '×';
    });

    el('cmpBtn').addEventListener('click', function () {
        if (!st.src) return;
        st.showSource = !st.showSource;
        this.setAttribute('aria-pressed', String(st.showSource));
        this.textContent = st.showSource ? 'SHOW RESULT' : 'SHOW SOURCE';
        /* Source and result differ in size by the cell factor, so a scale that
           framed one leaves the other off-screen. Re-fit on every swap. */
        doFit();
    });

    el('gridBtn').addEventListener('click', function () {
        st.showGrid = !st.showGrid;
        this.setAttribute('aria-pressed', String(st.showGrid));
        /* The overlay only means anything over the source, so turning it on
           takes you there rather than leaving you wondering why nothing drew. */
        if (st.showGrid && !st.showSource) el('cmpBtn').click();
        else draw();
    });

    el('zoomIn').addEventListener('click', function () { stepZoom(1); });
    el('zoomOut').addEventListener('click', function () { stepZoom(-1); });
    el('fitBtn').addEventListener('click', doFit);
    el('oneBtn').addEventListener('click', function () {
        if (!activeCanvas()) return;
        zoomTo(LADDER.indexOf(1));
    });

    /* ── Pan & zoom input ────────────────────────────────────────────────── */

    wrap.addEventListener('wheel', function (e) {
        if (!activeCanvas()) return;
        e.preventDefault();
        var r = wrap.getBoundingClientRect();
        stepZoom(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    var drag = null;
    wrap.addEventListener('pointerdown', function (e) {
        if (!activeCanvas() || e.button !== 0) return;
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
        if (st.out || st.srcCanvas) { clampPan(); draw(); }
    }, 150));

    /* ── Export ──────────────────────────────────────────────────────────── */

    function exportCanvas() {
        var k = parseInt(el('scale').value, 10) || 1;
        if (k === 1) return st.outCanvas;
        var c = document.createElement('canvas');
        c.width = st.outCanvas.width * k;
        c.height = st.outCanvas.height * k;
        var cx = c.getContext('2d');
        cx.imageSmoothingEnabled = false;
        cx.drawImage(st.outCanvas, 0, 0, c.width, c.height);
        return c;
    }

    el('saveBtn').addEventListener('click', function () {
        if (!st.outCanvas) return;
        var c = exportCanvas();
        c.toBlob(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            var base = st.name.replace(/\.[^.]+$/, '') || 'pixel';
            a.href = url;
            a.download = base + '_' + c.width + 'x' + c.height + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
            if (window.CAS) CAS.toast('SAVED ' + c.width + '×' + c.height);
        }, 'image/png');
    });

    el('copyBtn').addEventListener('click', function () {
        if (!st.outCanvas) { if (window.CAS) CAS.toast('NOTHING TO COPY', true); return; }
        if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
            if (window.CAS) CAS.toast('CLIPBOARD IMAGES UNSUPPORTED HERE', true);
            return;
        }
        exportCanvas().toBlob(function (blob) {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(
                function () { CAS.toast('COPIED'); },
                function () { CAS.toast('COPY BLOCKED', true); }
            );
        }, 'image/png');
    });

    el('resetBtn').addEventListener('click', function () {
        st.src = null; st.srcCanvas = null; st.grid = null; st.cells = null;
        st.palette = null; st.idx = null; st.out = null; st.outCanvas = null;
        st.showSource = false; st.showGrid = false;
        st.view = { scale: 1, x: 0, y: 0, fit: true };
        wrap.classList.remove('has-img');
        el('file').value = '';
        draw();
        el('hint').style.display = '';
        ['sName', 'sSize', 'oDim', 'oCols', 'fSrc', 'fGrid', 'fOut', 'fMs'].forEach(function (id) {
            el(id).textContent = '—';
        });
        el('alts').innerHTML = '<span class="hint">—</span>';
        el('divs').innerHTML = '';
        el('artW').value = '';
        el('artH').value = '';
        el('swatches').innerHTML = '';
        el('confPct').textContent = '—';
        el('confBar').style.width = '0';
        el('gLed').className = 'led';
        el('gStat').textContent = 'NO IMAGE';
        el('saveBtn').disabled = true;
        el('dockStat').textContent = 'NO IMAGE';
        el('cmpBtn').textContent = 'SHOW SOURCE';
        el('cmpBtn').setAttribute('aria-pressed', 'false');
        el('gridBtn').setAttribute('aria-pressed', 'false');
        busy(false);
        if (window.CAS) CAS.toast('CLEARED');
    });
})();
