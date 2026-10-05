/* ============================================================================
   COLORING BOOK — page wiring for lineart.js
   ---------------------------------------------------------------------------
   The work runs in a worker because the expensive stage is the OUTPUT: a
   letter page at 300 DPI is 8.4 million pixels, 33 million at 600, and every
   slider tick rebuilds it. In the worker the page stays live and the preview
   lands when it is ready.

   Only the current page is decoded and resident. The rest of a batch waits
   as File objects and is decoded one at a time on export, so a fifty-page
   book costs one page of memory, not fifty.
   ========================================================================= */
(function () {
    'use strict';

    var L = window.LINEART, ENC = window.PRINTENC, S = window.STUDIO;
    var el = function (id) { return document.getElementById(id); };
    function radio(name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : null; }

    /* ── Engine: a worker when there is one, the same code inline when not
          (file:// refuses workers). Same promise API either way. ───────── */
    var engine = (function () {
        var pend = {}, seq = 0, wk = null, local = {};
        try { wk = new Worker('worker.js?v=2'); } catch (e) { wk = null; }
        function settle(m) {
            var p = pend[m.id]; delete pend[m.id];
            if (!p) return;
            if (m.type === 'error') p.reject(new Error(m.msg)); else p.resolve(m);
        }
        if (wk) wk.onmessage = function (e) { settle(e.data); };
        return {
            load: function (key, id) {
                if (wk) wk.postMessage({ type: 'load', key: key, buf: id.data.buffer, w: id.width, h: id.height }, [id.data.buffer]);
                else local[key] = { rgba: id.data, w: id.width, h: id.height, cache: {} };
            },
            drop: function (key) { if (wk) wk.postMessage({ type: 'drop', key: key }); else delete local[key]; },
            run: function (key, opts, diag) {
                var id = ++seq;
                return new Promise(function (resolve, reject) {
                    pend[id] = { resolve: resolve, reject: reject };
                    if (wk) { wk.postMessage({ type: 'run', id: id, key: key, opts: opts, diag: diag }); return; }
                    setTimeout(function () {
                        var s = local[key];
                        if (!s) { settle({ type: 'error', id: id, msg: 'NOT LOADED' }); return; }
                        var r = L.run(s.cache, s.rgba, s.w, s.h, opts);
                        settle({ type: 'result', id: id, key: key, gray: r.gray.buffer, geo: r.geo, stats: r.stats,
                                 black: r.black, ms: r.ms, diag: diag ? L.diagnostic(s.cache).buffer : null });
                    }, 20);
                });
            }
        };
    })();

    /* ── State ───────────────────────────────────────────────────────────── */
    var items = [], nextKey = 1, cur = null;
    var st = {
        src: null,          /* canvas of the current source */
        out: null,          /* page canvas of the current result */
        diag: null,         /* canvas of the REMOVED map, source size */
        gray: null, geo: null, optsKey: '',
        mode: 'result', split: 0.5
    };

    function readOpts() {
        return {
            cut: +el('cut').value,
            speck: +el('speck').value,
            flatten: el('flatten').checked,
            weight: +el('weight').value,
            smooth: +el('smooth').value / 100,
            edges: radio('edges') || 'smooth',
            page: el('page').value,
            dpi: +(radio('dpi') || 300),
            layout: radio('layout') || 'page',
            margin: +el('margin').value,
            factor: +(radio('factor') || 3),
            gain: 1.3
        };
    }

    /* ── Decode ──────────────────────────────────────────────────────────── */
    function decode(file) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                URL.revokeObjectURL(url);
                var c = document.createElement('canvas');
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                var cx = c.getContext('2d', { willReadFrequently: true });
                cx.drawImage(img, 0, 0);
                resolve({ canvas: c, data: cx.getImageData(0, 0, c.width, c.height) });
            };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
            img.src = url;
        });
    }
    function thumb(it) {
        var p = window.createImageBitmap
            ? createImageBitmap(it.file).then(function (b) { return b; })
            : decode(it.file).then(function (d) { return d.canvas; });
        p.then(function (bmp) {
            it.dims = bmp.width + '×' + bmp.height;
            var cv = it.thumb, cx = cv.getContext('2d');
            cv.width = 80; cv.height = 80;
            cx.fillStyle = '#fff'; cx.fillRect(0, 0, 80, 80);
            var k = Math.min(80 / bmp.width, 80 / bmp.height);
            cx.imageSmoothingQuality = 'high';
            cx.drawImage(bmp, (80 - bmp.width * k) / 2, (80 - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
            if (bmp.close) bmp.close();
            var d = it.row && it.row.querySelector('.nm span');
            if (d) d.textContent = it.dims;
        }).catch(function () {});
    }

    /* ── Queue ───────────────────────────────────────────────────────────── */
    function addFiles(list) {
        var first = null;
        Array.prototype.forEach.call(list, function (f) {
            if (!f || !/^image\//.test(f.type)) return;
            var it = { key: 'k' + (nextKey++), file: f, name: f.name || ('pasted-' + nextKey + '.png') };
            it.thumb = document.createElement('canvas');
            thumb(it);
            items.push(it);
            if (!first) first = it;
        });
        if (!first) { S.toast('Not an image', true); return; }
        renderQueue();
        select(first);
    }

    var dragIt = null;
    function renderQueue() {
        var q = el('queue');
        q.innerHTML = '';
        items.forEach(function (it, n) {
            var row = document.createElement('div');
            row.className = 'qi';
            row.setAttribute('role', 'listitem');
            row.tabIndex = 0;
            row.draggable = true;
            row.setAttribute('aria-current', String(it === cur));
            var nm = document.createElement('div');
            nm.className = 'nm';
            nm.innerHTML = '<b></b><span></span>';
            nm.firstChild.textContent = (n + 1) + '. ' + it.name;
            nm.firstChild.title = it.name;
            nm.lastChild.textContent = it.dims || '';
            var x = document.createElement('button');
            x.type = 'button'; x.className = 'btn x';
            x.innerHTML = '<span class="material-symbols-outlined">close</span>';
            x.setAttribute('aria-label', 'Remove ' + it.name);
            x.addEventListener('click', function (e) { e.stopPropagation(); remove(it); });
            row.appendChild(it.thumb); row.appendChild(nm); row.appendChild(x);
            row.addEventListener('click', function () { if (it !== cur) select(it); });
            row.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (it !== cur) select(it); }
                if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(it); }
            });
            /* Reorder: the order here is the page order of the PDF. */
            row.addEventListener('dragstart', function (e) {
                dragIt = it; row.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', it.key);
            });
            row.addEventListener('dragend', function () { dragIt = null; renderQueue(); });
            row.addEventListener('dragover', function (e) {
                if (!dragIt || dragIt === it) return;
                e.preventDefault();
                var r = row.getBoundingClientRect(), below = e.clientY > r.top + r.height / 2;
                row.classList.toggle('drop-below', below); row.classList.toggle('drop-above', !below);
            });
            row.addEventListener('dragleave', function () { row.classList.remove('drop-above', 'drop-below'); });
            row.addEventListener('drop', function (e) {
                if (!dragIt || dragIt === it) return;
                e.preventDefault(); e._taken = true;
                var r = row.getBoundingClientRect(), below = e.clientY > r.top + r.height / 2;
                items.splice(items.indexOf(dragIt), 1);
                items.splice(items.indexOf(it) + (below ? 1 : 0), 0, dragIt);
                dragIt = null; renderQueue();
            });
            it.row = row;
            q.appendChild(row);
        });
        el('qCount').textContent = String(items.length);
        el('pdfBtn').disabled = !items.length || exporting;
        el('zipBtn').disabled = items.length < 2 || exporting;
    }

    function remove(it) {
        var i = items.indexOf(it);
        if (i < 0) return;
        items.splice(i, 1);
        if (it === cur) {
            engine.drop(it.key);
            cur = null;
            if (items.length) select(items[Math.min(i, items.length - 1)]);
            else resetStage();
        }
        renderQueue();
    }

    function select(it) {
        if (cur && cur !== it) engine.drop(cur.key);
        cur = it;
        st.out = st.gray = st.diag = st.geo = null; st.optsKey = '';
        renderQueue();
        setBusy(true);
        decode(it.file).then(function (d) {
            if (cur !== it) return;
            it.w = d.canvas.width; it.h = d.canvas.height;
            st.src = d.canvas;
            engine.load(it.key, d.data);
            el('empty').classList.add('gone');
            updateGeometry();
            vp.fit(true);
            schedule();
        }, function () {
            S.toast('Could not read ' + it.name, true);
            remove(it);
        });
    }

    /* ── Live render: single flight. While one render runs, changes only
          mark it stale; when it lands, one more runs with whatever the
          controls say by then. ─────────────────────────────────────────── */
    var want = false, running = false;
    function schedule() { if (!cur || !cur.w) return; want = true; pump(); }
    function pump() {
        if (running || !want || !cur || !cur.w) return;
        want = false; running = true;
        var it = cur, opts = readOpts(), key = JSON.stringify(opts);
        setBusy(true);
        engine.run(it.key, opts, true).then(function (m) {
            running = false;
            if (it === cur) apply(m, key);
            if (want) pump(); else setBusy(false);
        }, function (err) {
            running = false; setBusy(false);
            S.toast('Render failed', true);
            console.error(err);
        });
    }

    function grayToCanvas(gray, w, h, cv) {
        cv = cv || document.createElement('canvas');
        cv.width = w; cv.height = h;
        var cx = cv.getContext('2d');
        var id = cx.createImageData(w, h), d = id.data;
        for (var i = 0, j = 0; i < gray.length; i++, j += 4) { var v = gray[i]; d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255; }
        cx.putImageData(id, 0, 0);
        return cv;
    }

    function apply(m, key) {
        var g = m.geo, first = !st.out;
        var sizeChanged = !st.geo || st.geo.pw !== g.pw || st.geo.ph !== g.ph;
        st.gray = new Uint8Array(m.gray);
        st.geo = g; st.optsKey = key;
        st.out = grayToCanvas(st.gray, g.pw, g.ph, st.out);
        if (m.diag) {
            var dc = st.diag || document.createElement('canvas');
            dc.width = cur.w; dc.height = cur.h;
            dc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.diag), cur.w, cur.h), 0, 0);
            st.diag = dc;
        }
        var s = m.stats;
        el('rInk').textContent = (s.inkPct * 100).toFixed(1) + '%';
        el('rGrey').textContent = (s.greyPct * 100).toFixed(1) + '%';
        el('rSpeck').textContent = s.specks + (s.specks ? ' · ' + s.speckPx + ' px' : '');
        el('rBlack').textContent = String(m.black);
        el('fMs').textContent = m.ms + ' ms';
        el('fOut').textContent = g.pw + ' × ' + g.ph + ' px · ' + g.dpi + ' DPI';
        el('saveBtn').disabled = exporting;
        if (first || (sizeChanged && vp.isFit())) vp.fit(!first); else vp.redraw();
    }

    function num(v, d) { return String(Math.round(v * Math.pow(10, d)) / Math.pow(10, d)); }
    function updateGeometry() {
        var none = el('page').value === 'none';
        el('pageOnly').hidden = none;
        el('marginRow').hidden = none;
        el('factorRow').hidden = !none;
        if (!none) S.syncSeg(el('pageOnly')); else S.syncSeg(el('factorRow'));
        if (!cur || !cur.w) {
            ['oDim', 'oSrc', 'oK', 'oW', 'oH'].forEach(function (id) { el(id).textContent = '—'; });
            return;
        }
        var g = L.geometry(cur.w, cur.h, readOpts());
        el('oK').innerHTML = num(g.k, 2) + '<small>×</small>';
        el('oW').innerHTML = num(g.inW, 2) + '<small>in</small>';
        el('oH').innerHTML = num(g.inH, 2) + '<small>in</small>';
        el('oDim').textContent = g.pw + ' × ' + g.ph + ' px';
        el('oSrc').textContent = cur.w + ' × ' + cur.h + ' px';
    }

    function setBusy(on) { el('prog').className = 'progress' + (on ? ' on indet' : ''); }

    /* ── View ────────────────────────────────────────────────────────────────
       Art space is the OUTPUT page. The source and the REMOVED map are drawn
       into the art rectangle inside it, so every view lines up with every
       other and switching never reframes — which is what makes SPLIT work. */
    function art() {
        if (st.geo && st.out) return st.geo;
        if (cur && cur.w) return L.geometry(cur.w, cur.h, readOpts());
        return null;
    }
    function drawUnder(ctx, a, layer) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, a.pw, a.ph);
        if (layer) ctx.drawImage(layer, a.x, a.y, a.w, a.h);
    }
    var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6d5dfc';

    var vp = S.viewport(el('wrap'), el('view'), {
        pad: 28,
        maxScale: 24,
        size: function () { var a = art(); return a && st.src ? { w: a.pw, h: a.ph } : null; },
        draw: function (ctx, v) {
            var a = art();
            /* Line art shrunk without smoothing shimmers into broken lines;
               enlarged with it, it hides the very edge you zoomed in to see. */
            ctx.imageSmoothingEnabled = v.s < 1;
            ctx.imageSmoothingQuality = 'high';
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 24 / v.s; ctx.shadowOffsetY = 6 / v.s;
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, a.pw, a.ph);
            ctx.restore();
            var mode = st.out ? st.mode : 'source';
            if (mode === 'source') drawUnder(ctx, a, st.src);
            else if (mode === 'removed') drawUnder(ctx, a, st.diag || st.src);
            else {
                ctx.drawImage(st.out, 0, 0, a.pw, a.ph);
                if (mode === 'split') {
                    ctx.save();
                    ctx.beginPath(); ctx.rect(0, 0, a.pw * st.split, a.ph); ctx.clip();
                    ctx.imageSmoothingEnabled = true;
                    drawUnder(ctx, a, st.src);
                    ctx.restore();
                }
            }
        },
        overlay: function (ctx, v) {
            if (st.mode !== 'split' || !st.out) return;
            var a = art(), sx = Math.round(v.x + a.pw * v.s * st.split);
            var top = Math.max(v.y, 0), bot = Math.min(v.y + a.ph * v.s, ctx.canvas.height);
            ctx.fillStyle = accent;
            ctx.fillRect(sx - 1, top, 2, bot - top);
            /* Handle */
            var hy = (top + bot) / 2;
            ctx.beginPath(); ctx.arc(sx, hy, 15, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
            ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = accent;
            ctx.beginPath(); ctx.moveTo(sx - 4, hy - 5); ctx.lineTo(sx - 9, hy); ctx.lineTo(sx - 4, hy + 5); ctx.fill();
            ctx.beginPath(); ctx.moveTo(sx + 4, hy - 5); ctx.lineTo(sx + 9, hy); ctx.lineTo(sx + 4, hy + 5); ctx.fill();
            ctx.font = '600 11px Poppins, sans-serif'; ctx.textBaseline = 'middle';
            var ly = Math.max(top + 16, 16);
            [['Before', sx - 10, 'right'], ['After', sx + 10, 'left']].forEach(function (t) {
                ctx.textAlign = t[2];
                var w = ctx.measureText(t[0]).width + 14, x0 = t[2] === 'right' ? t[1] - w : t[1];
                ctx.fillStyle = 'rgba(0,0,0,.6)';
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(x0, ly - 10, w, 20, 6); else ctx.rect(x0, ly - 10, w, 20);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.fillText(t[0], t[2] === 'right' ? t[1] - 7 : t[1] + 7, ly + 0.5);
            });
        },
        down: function (pt) {
            if (st.mode !== 'split' || !st.out) return null;
            var a = art();
            function set(p) { st.split = Math.max(0, Math.min(1, p.x / a.pw)); vp.redraw(); }
            set(pt);
            return { move: set, up: function () {} };
        },
        hover: function () { el('wrap').style.cursor = st.mode === 'split' && st.out ? 'ew-resize' : (st.src ? 'grab' : ''); },
        change: function (v) { el('zVal').textContent = Math.round(v.s * 100) + '%'; }
    });

    el('zIn').addEventListener('click', function () { vp.zoomBy(1.5); });
    el('zOut').addEventListener('click', function () { vp.zoomBy(1 / 1.5); });
    el('zFit').addEventListener('click', function () { vp.fit(); });
    el('zOne').addEventListener('click', function () { vp.zoomTo(1); });

    function resetStage() {
        st.src = st.out = st.diag = st.gray = st.geo = null; st.optsKey = '';
        el('empty').classList.remove('gone');
        ['rInk', 'rGrey', 'rSpeck', 'rBlack', 'fMs', 'fOut'].forEach(function (id) { el(id).textContent = '—'; });
        el('zVal').textContent = '—';
        el('saveBtn').disabled = true;
        setBusy(false);
        updateGeometry();
        vp.redraw();
    }

    /* ── Controls ────────────────────────────────────────────────────────── */
    var soon = S.debounce(schedule, 60);
    function slider(id, fmt) {
        var inp = el(id);
        function show() { el(id + 'Val').textContent = fmt(+inp.value); S.markMoved(inp); }
        inp.addEventListener('input', function () { show(); updateGeometry(); soon(); });
        show();
    }
    slider('cut', function (v) { return String(v); });
    slider('speck', function (v) { return v ? v + ' px' : 'Off'; });
    slider('weight', function (v) { return (v > 0 ? '+' : '') + v; });
    slider('smooth', function (v) { return v + '%'; });
    slider('margin', function (v) { return v + ' in'; });

    el('flatten').addEventListener('change', schedule);
    el('page').addEventListener('change', function () { updateGeometry(); schedule(); });
    ['edges', 'dpi', 'layout', 'factor'].forEach(function (n) {
        document.querySelectorAll('input[name="' + n + '"]').forEach(function (r) {
            r.addEventListener('change', function () { updateGeometry(); schedule(); });
        });
    });
    document.querySelectorAll('input[name="view"]').forEach(function (r) {
        r.addEventListener('change', function () {
            st.mode = this.value;
            el('legend').hidden = st.mode !== 'removed';
            vp.redraw();
        });
    });

    function pick() { el('file').click(); }
    el('pickBtn').addEventListener('click', pick);
    el('pickBtn').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    el('browseBtn').addEventListener('click', pick);
    el('file').addEventListener('change', function () {
        if (this.files && this.files.length) addFiles(this.files);
        this.value = '';
    });
    var dz = el('pickBtn');
    dz.addEventListener('dragover', function (e) { if (!dragIt) { e.preventDefault(); dz.classList.add('dragover'); } });
    dz.addEventListener('dragleave', function () { dz.classList.remove('dragover'); });
    dz.addEventListener('drop', function () { dz.classList.remove('dragover'); });
    S.fileDrop(function (files, e) { if (!e._taken) addFiles(files); }, 'Drop to add pages');

    /* ── Export ──────────────────────────────────────────────────────────── */
    function baseName(it) { return (it.name.replace(/\.[^.]+$/, '') || 'page').replace(/[\\/:*?"<>|]+/g, '_'); }
    function outName(it, geo) { return baseName(it) + '_coloring_' + geo.dpi + 'dpi.png'; }

    /* Render any page with the current settings. The current one is reused
       when its result is still fresh; others are decoded, loaded under a
       throwaway key, rendered and dropped, one at a time. */
    function renderItem(it, opts) {
        var key = JSON.stringify(opts);
        if (it === cur && st.gray && st.optsKey === key) return Promise.resolve({ gray: st.gray, geo: st.geo });
        var tmp = 'x' + (nextKey++);
        return decode(it.file).then(function (d) {
            engine.load(tmp, d.data);
            return engine.run(tmp, opts, false);
        }).then(function (m) {
            engine.drop(tmp);
            return { gray: new Uint8Array(m.gray), geo: m.geo };
        }, function (err) { engine.drop(tmp); throw err; });
    }

    var exporting = false;
    function lockExport(on) {
        exporting = on;
        ['saveBtn', 'pdfBtn', 'zipBtn', 'resetBtn'].forEach(function (id) { el(id).disabled = on; });
        if (!on) { el('saveBtn').disabled = !st.gray; el('vStat').textContent = ''; renderQueue(); }
    }
    function progress(i, n, what) {
        el('prog').className = 'progress on';
        el('prog').firstChild.style.width = Math.round(i / n * 100) + '%';
        el('vStat').textContent = what + ' ' + i + ' / ' + n;
    }
    function doneProgress() { el('prog').className = 'progress'; el('prog').firstChild.style.width = ''; }

    el('saveBtn').addEventListener('click', function () {
        if (!cur || exporting) return;
        lockExport(true);
        var it = cur;
        renderItem(it, readOpts()).then(function (r) {
            return ENC.png(r.gray, r.geo.pw, r.geo.ph, r.geo.dpi).then(function (blob) {
                S.download(blob, outName(it, r.geo));
                S.toast('Saved ' + r.geo.pw + ' × ' + r.geo.ph + ' at ' + r.geo.dpi + ' DPI');
            });
        }).catch(function (err) { S.toast('Export failed', true); console.error(err); })
          .then(function () { lockExport(false); });
    });

    function batch(what, perPage, finish) {
        if (!items.length || exporting) return;
        lockExport(true);
        var opts = readOpts(), list = items.slice(), i = 0;
        function step() {
            if (i >= list.length) return Promise.resolve();
            progress(i + 1, list.length, what);
            var it = list[i++];
            return renderItem(it, opts).then(function (r) { return perPage(it, r); }).then(step);
        }
        step().then(finish).catch(function (err) { S.toast(what + ' failed', true); console.error(err); })
            .then(function () { doneProgress(); lockExport(false); });
    }

    el('pdfBtn').addEventListener('click', function () {
        var pdf = new ENC.Pdf(), geo = null;
        batch('PDF', function (it, r) { geo = r.geo; return pdf.addPage(r.gray, r.geo); }, function () {
            var name = (items.length === 1 ? baseName(items[0]) : 'coloring-book') + '_' + (geo ? geo.dpi : 300) + 'dpi.pdf';
            S.download(pdf.finish(), name);
            S.toast('PDF saved · ' + pdf.pageIds.length + (pdf.pageIds.length === 1 ? ' page' : ' pages'));
        });
    });

    el('zipBtn').addEventListener('click', function () {
        var zip = new ENC.Zip(), n = 0;
        batch('ZIP', function (it, r) {
            return ENC.png(r.gray, r.geo.pw, r.geo.ph, r.geo.dpi).then(function (blob) { return blob.arrayBuffer(); })
                .then(function (ab) { zip.add(outName(it, r.geo), new Uint8Array(ab)); n++; });
        }, function () {
            S.download(zip.finish(), 'coloring-pages.zip');
            S.toast('ZIP saved · ' + n + ' pages');
        });
    });

    el('resetBtn').addEventListener('click', function () {
        if (exporting || !items.length) return;
        if (cur) engine.drop(cur.key);
        items = []; cur = null;
        renderQueue();
        resetStage();
        S.toast('Cleared');
    });

    updateGeometry();
    renderQueue();
})();
