/* ============================================================================
   STIPPLE — marks laid down by hand, one per cell
   ---------------------------------------------------------------------------
   The old Stipple Studio page, ported into the Effects panel. What changed on
   the way, and why:

   1. EACH CELL IS AREA-SAMPLED.
      The old page read the one source pixel at the top-left of each cell, so
      a 12px grid threw away 143 of every 144 pixels and the result shimmered
      on any texture finer than the grid. The source is now drawn down to one
      pixel per cell through the browser's own downscaler, which box-filters,
      so every mark answers to the mean of the area it stands for.

   2. MARK AREA, NOT RADIUS, FOLLOWS TONE.
      Radius ∝ darkness makes a 50% grey print at 25% ink. Radius ∝ √darkness
      makes the inked area track the tone, which is what the eye averages.

   3. THE RANDOMNESS IS SEEDED.
      Jitter and scribble angles used to be Math.random() per render, so every
      slider nudge reshuffled the whole picture and the export never matched
      the preview. One seed now drives both; RE-ROLL picks a new one.

   The halftone screen the old page also offered is gone from here — Halftone,
   one tab over, does that properly.

   Shares effects/index.html with plate.js and tape.js; ids carry sp-.
   ========================================================================= */
(function () {
    'use strict';

    var S = window.SRCH;
    var MODE = 'stipple', PFX = 'sp-';
    var root = FX.root(MODE);
    var el = FX.el(PFX);

    var SRC_CAP       = 4096;       /* longest edge of the source we keep     */
    var VIEW_CAP      = 1600;       /* longest edge of the on-screen render   */
    var EXPORT_BUDGET = 40000000;   /* pixels in a raster export              */

    var st = {
        name: '', src: null, w: 0, h: 0,
        seed: 0x5eed, gen: 0,
        compare: false
    };

    var view = el('view'), vctx = view.getContext('2d');
    var wrap = el('wrap');

    /* ── Parameters ──────────────────────────────────────────────────────── */

    function params() {
        return {
            style:   S.r('spStyle') || 'stipple',
            spacing: parseFloat(el('uSpacing').value),
            size:    parseFloat(el('uSize').value),
            jitter:  parseFloat(el('uJitter').value) / 100,
            gamma:   parseFloat(el('uGamma').value) / 100,
            invert:  el('uInvert').checked,
            keep:    el('uKeep').checked,
            ink:     el('uInk').value,
            paper:   el('uPaper').value,
            alpha:   el('uAlpha').checked,
            fmt:     S.r('spFmt') || 'png',
            scale:   parseFloat(el('uScale').value),
            quality: parseFloat(el('uQual').value) / 100
        };
    }

    function fmt(s) {
        var v = parseFloat(s.value);
        switch (s.dataset.fmt) {
            case 'px':    return v + ' PX';
            case 'pct':   return v + '%';
            case 'gamma': return (v / 100).toFixed(2);
            case 'mult':  return v + '×';
        }
        return String(v);
    }

    var sliders = Array.prototype.slice.call(root.querySelectorAll('input[data-u][type="range"]'));

    function syncUI() {
        var p = params();
        sliders.forEach(function (s) {
            var row = s.closest('.sl');
            if (row) row.querySelector('.val').textContent = fmt(s);
        });
        el('sizeLbl').textContent = p.style === 'scribble' ? 'STROKE WIDTH' : 'MARK SIZE';
        el('uJitter').disabled = p.style === 'grid';
        el('uInk').disabled = p.keep;
        el('inkRow').classList.toggle('off', p.keep);
        el('inkHex').textContent = p.ink.toUpperCase();
        el('paperHex').textContent = p.paper.toUpperCase();
        Array.prototype.forEach.call(root.querySelectorAll('[data-fmt-when]'), function (n) {
            n.hidden = n.getAttribute('data-fmt-when').split(/\s+/).indexOf(p.fmt) < 0;
        });
        wrap.classList.toggle('see-through', p.alpha);
    }

    /* ── Random ──────────────────────────────────────────────────────────── */

    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            var t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    /* ── Cells ───────────────────────────────────────────────────────────── */

    var cellCache = { key: '', data: null, cols: 0, rows: 0 };

    function cells(spacing) {
        var key = st.gen + ':' + spacing;
        if (cellCache.key === key) return cellCache;
        var cols = Math.max(1, Math.ceil(st.w / spacing));
        var rows = Math.max(1, Math.ceil(st.h / spacing));
        var c = document.createElement('canvas');
        c.width = cols; c.height = rows;
        var cx = c.getContext('2d', { willReadFrequently: true });
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = 'high';
        /* Fractional destination size: the last row and column cover only the
           part of a cell the picture reaches, and come back partly
           transparent — which is honest about how much picture is there. */
        cx.drawImage(st.src, 0, 0, st.w / spacing, st.h / spacing);
        cellCache = { key: key, data: cx.getImageData(0, 0, cols, rows).data, cols: cols, rows: rows };
        return cellCache;
    }

    /* Every mark, in source pixels. Four random draws per cell whether the
       cell gets a mark or not, so moving the tone curve never reshuffles the
       marks that survive it. */
    function marks(p) {
        var g = cells(p.spacing), d = g.data;
        var rand = mulberry32(st.seed);
        var out = [];
        var sp = p.spacing;
        for (var j = 0; j < g.rows; j++) {
            for (var i = 0; i < g.cols; i++) {
                var r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand();
                var o = (j * g.cols + i) * 4;
                if (d[o + 3] < 5) continue;
                var R = d[o], G = d[o + 1], B = d[o + 2];
                var lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
                var v = Math.pow(p.invert ? lum : 1 - lum, p.gamma);
                var cx = (i + 0.5) * sp, cy = (j + 0.5) * sp;
                var col = p.keep ? 'rgb(' + R + ',' + G + ',' + B + ')' : null;

                if (p.style === 'scribble') {
                    if (v < 0.08) continue;
                    var len = sp * v, a = r1 * Math.PI * 2;
                    var dx = Math.cos(a) * len, dy = Math.sin(a) * len;
                    out.push({ s: 1, x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy,
                               qx: cx + (r2 - 0.5) * len, qy: cy + (r3 - 0.5) * len, col: col });
                } else {
                    var rad = (p.size / 2) * Math.sqrt(v);
                    if (rad < 0.3) continue;
                    if (p.style === 'stipple') {
                        cx += (r2 - 0.5) * sp * p.jitter;
                        cy += (r3 - 0.5) * sp * p.jitter;
                    }
                    out.push({ s: 0, x: cx, y: cy, r: rad, col: col });
                }
            }
        }
        return out;
    }

    /* ── Render ──────────────────────────────────────────────────────────── */

    /* Uniform ink goes down as one path and one fill — tens of thousands of
       arcs in a single call instead of one call each. */
    function paint(ctx, list, p, k, withPaper) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        if (withPaper) {
            ctx.fillStyle = p.paper;
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(0.5, p.size * 0.5);
        var i, m;
        if (!p.keep) {
            ctx.fillStyle = ctx.strokeStyle = p.ink;
            ctx.beginPath();
            for (i = 0; i < list.length; i++) {
                m = list[i];
                if (m.s) { ctx.moveTo(m.x1, m.y1); ctx.quadraticCurveTo(m.qx, m.qy, m.x2, m.y2); }
                else { ctx.moveTo(m.x + m.r, m.y); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); }
            }
            if (p.style === 'scribble') ctx.stroke(); else ctx.fill();
        } else {
            for (i = 0; i < list.length; i++) {
                m = list[i];
                ctx.beginPath();
                if (m.s) {
                    ctx.strokeStyle = m.col;
                    ctx.moveTo(m.x1, m.y1); ctx.quadraticCurveTo(m.qx, m.qy, m.x2, m.y2);
                    ctx.stroke();
                } else {
                    ctx.fillStyle = m.col;
                    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    var raf = 0;
    function schedule() {
        if (raf) return;
        raf = requestAnimationFrame(function () { raf = 0; render(); });
    }

    function render() {
        if (!st.src) return;
        var t0 = performance.now();
        var p = params();
        var k = Math.min(1, VIEW_CAP / Math.max(st.w, st.h));
        view.width = Math.max(1, Math.round(st.w * k));
        view.height = Math.max(1, Math.round(st.h * k));
        if (st.compare) {
            vctx.drawImage(st.src, 0, 0, view.width, view.height);
        } else {
            var list = marks(p);
            paint(vctx, list, p, k, !p.alpha);
            el('fMarks').textContent = list.length.toLocaleString();
        }
        el('fMs').textContent = Math.round(performance.now() - t0) + ' MS';
        el('vLed').className = 'led on green';
        el('vStat').textContent = st.compare ? 'SOURCE' : 'READY';
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
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);

            st.name = file.name || 'pasted';
            st.src = c; st.w = w; st.h = h; st.gen++;
            FX.loaded(MODE, file);

            el('sName').textContent = st.name.length > 24 ? st.name.slice(0, 22) + '…' : st.name;
            el('sSize').textContent = w + ' × ' + h;
            el('fSize').textContent = w + '×' + h;
            el('dockStat').textContent = w + '×' + h;
            el('hint').style.display = 'none';
            wrap.classList.add('has-img');
            el('saveBtn').disabled = false;
            render();
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            if (window.CAS) CAS.toast('COULD NOT DECODE THAT FILE', true);
        };
        img.src = url;
    }

    /* ── Export ──────────────────────────────────────────────────────────── */

    function baseName() { return (st.name.replace(/\.[^.]+$/, '') || 'stipple') + '_' + params().style; }

    function svgString(p) {
        var list = marks(p);
        var n = function (x) { return Math.round(x * 100) / 100; };
        var out = [];
        out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + st.w + '" height="' + st.h +
                 '" viewBox="0 0 ' + st.w + ' ' + st.h + '">');
        if (!p.alpha) out.push('<rect width="100%" height="100%" fill="' + p.paper + '"/>');
        var sw = n(Math.max(0.5, p.size * 0.5));
        if (p.style === 'scribble') {
            out.push('<g fill="none" stroke-linecap="round" stroke-width="' + sw + '"' +
                     (p.keep ? '' : ' stroke="' + p.ink + '"') + '>');
            list.forEach(function (m) {
                out.push('<path d="M' + n(m.x1) + ',' + n(m.y1) + 'Q' + n(m.qx) + ',' + n(m.qy) + ' ' +
                         n(m.x2) + ',' + n(m.y2) + '"' + (m.col ? ' stroke="' + m.col + '"' : '') + '/>');
            });
        } else {
            out.push('<g' + (p.keep ? '' : ' fill="' + p.ink + '"') + '>');
            list.forEach(function (m) {
                out.push('<circle cx="' + n(m.x) + '" cy="' + n(m.y) + '" r="' + n(m.r) + '"' +
                         (m.col ? ' fill="' + m.col + '"' : '') + '/>');
            });
        }
        out.push('</g></svg>');
        return out.join('\n');
    }

    function rasterAt(scale, p) {
        var s = scale;
        if (st.w * st.h * s * s > EXPORT_BUDGET) {
            s = Math.max(1, Math.floor(Math.sqrt(EXPORT_BUDGET / (st.w * st.h)) * 2) / 2);
            if (window.CAS) CAS.toast('SCALE HELD AT ' + s + '× (SIZE LIMIT)', true);
        }
        var c = document.createElement('canvas');
        c.width = Math.round(st.w * s); c.height = Math.round(st.h * s);
        /* JPEG has no alpha, so it always gets its paper. */
        paint(c.getContext('2d'), marks(p), p, s, !p.alpha || p.fmt === 'jpeg');
        return c;
    }

    function save(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        if (window.CAS) CAS.toast('SAVED ' + name);
    }

    el('saveBtn').addEventListener('click', function () {
        if (!st.src) return;
        var p = params();
        if (p.fmt === 'svg') {
            save(new Blob([svgString(p)], { type: 'image/svg+xml;charset=utf-8' }), baseName() + '.svg');
            return;
        }
        var c = rasterAt(p.scale, p);
        var type = p.fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
        c.toBlob(function (blob) {
            if (!blob) { if (window.CAS) CAS.toast('EXPORT FAILED', true); return; }
            save(blob, baseName() + '_' + c.width + 'x' + c.height + (p.fmt === 'jpeg' ? '.jpg' : '.png'));
        }, type, p.fmt === 'jpeg' ? p.quality : undefined);
    });

    el('copyBtn').addEventListener('click', function () {
        if (!st.src) { if (window.CAS) CAS.toast('NOTHING TO COPY', true); return; }
        if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
            if (window.CAS) CAS.toast('CLIPBOARD IMAGES UNSUPPORTED HERE', true); return;
        }
        rasterAt(1, params()).toBlob(function (blob) {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                .then(function () { CAS.toast('COPIED'); },
                      function () { CAS.toast('COPY BLOCKED', true); });
        }, 'image/png');
    });

    el('resetBtn').addEventListener('click', function () {
        st.src = null; st.name = ''; st.w = st.h = 0; st.gen++;
        cellCache = { key: '', data: null, cols: 0, rows: 0 };
        view.width = view.height = 0;
        wrap.classList.remove('has-img');
        el('file').value = '';
        el('hint').style.display = '';
        ['sName', 'sSize', 'fSize', 'fMarks', 'fMs'].forEach(function (id) { el(id).textContent = '—'; });
        el('saveBtn').disabled = true;
        el('dockStat').textContent = 'NO IMAGE';
        el('vLed').className = 'led';
        el('vStat').textContent = 'IDLE';
        if (window.CAS) CAS.toast('CLEARED');
    });

    /* ── Wiring ──────────────────────────────────────────────────────────── */

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

    var controls = root.querySelector('.controls');
    controls.addEventListener('input', function (e) {
        if (!e.target.matches('[data-u]')) return;
        syncUI(); schedule();
    });
    controls.addEventListener('change', function (e) {
        if (!e.target.matches('[data-u], input[name="spStyle"], input[name="spFmt"]')) return;
        syncUI(); schedule();
    });

    el('reroll').addEventListener('click', function () {
        st.seed = (Math.random() * 4294967296) >>> 0;
        schedule();
    });

    /* Hold, not toggle — the same A/B Tape uses. */
    var cmp = el('cmpBtn');
    function cmpOn() { if (!st.src) return; st.compare = true; render(); }
    function cmpOff() { if (!st.compare) return; st.compare = false; render(); }
    cmp.addEventListener('pointerdown', cmpOn);
    cmp.addEventListener('pointerup', cmpOff);
    cmp.addEventListener('pointerleave', cmpOff);
    cmp.addEventListener('pointercancel', cmpOff);

    /* ── Boot ────────────────────────────────────────────────────────────── */
    syncUI();
    FX.register(MODE, { load: loadFile });
})();
