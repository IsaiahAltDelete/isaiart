/* ============================================================================
   KDP COVER STUDIO
   ---------------------------------------------------------------------------
   A KDP paperback cover is one flat sheet wrapped around the book:

        ┌ bleed ┬──────── back ────────┬ spine ┬──────── front ───────┬ bleed ┐

   width  = bleed + trim + spine + trim + bleed
   height = bleed + trim height + bleed          (bleed = 0.125 in)
   spine  = pages × paper thickness              (KDP's published figures)

   Everything here is laid out in ART PIXELS — inches × 300 — so the preview
   and the export run the exact same compose() and cannot disagree. The
   preview just draws it through the viewport's transform; the export draws
   it into a canvas the size of the sheet.
   ========================================================================= */
(function () {
    'use strict';

    var S = window.STUDIO, P = window.PRINTENC;
    var el = function (id) { return document.getElementById(id); };

    var DPI = 300, BLEED = 0.125, SAFE = 0.125, SPINE_SAFE = 0.0625, SPINE_TEXT_MIN = 80;

    /* KDP paperback trims, inches. */
    var TRIMS = [
        ['5x8', 5, 8], ['5.06x7.81', 5.06, 7.81], ['5.25x8', 5.25, 8], ['5.5x8.5', 5.5, 8.5],
        ['6x9', 6, 9], ['6.14x9.21', 6.14, 9.21], ['6.69x9.61', 6.69, 9.61], ['7x10', 7, 10],
        ['7.44x9.69', 7.44, 9.69], ['7.5x9.25', 7.5, 9.25], ['8x10', 8, 10], ['8.25x6', 8.25, 6],
        ['8.25x8.25', 8.25, 8.25], ['8.5x8.5', 8.5, 8.5], ['8.25x11', 8.25, 11], ['8.5x11', 8.5, 11],
        ['8.27x11.69', 8.27, 11.69, 'A4']
    ];
    /* Inches per page (KDP's cover calculator figures). */
    var PAPER = { white: 0.002252, cream: 0.0025, std: 0.002252, prem: 0.002347 };

    /* ── Settings (persisted — images are not, they stay in memory) ─────── */
    var DEF = {
        trim: '8.5x11', pages: 100, paper: 'white',
        bgmode: 'color', bgColor: '#ffffff', bgAuto: true, blur: 60, dim: 0,
        pattern: 'checker', patColor: '#f9c4d2', patScale: 0.75, patAngle: 0,
        inset: 0, radius: 0, outline: false, outlineColor: '#111111', outlineW: 0.04,
        spinemode: 'bg', spineColor: '#1f2937', title: '', author: '', font: 'Inter',
        ink: '#111111', inkAuto: true, sSize: 100, sCaps: true,
        gBleed: true, gSafe: true, gSpine: true, gBarcode: true, pv: 'guides', tplOp: 45
    };
    var STORE = 'isa.kdp.v1';
    var cfg = {};
    (function () {
        var saved = {};
        try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) {}
        for (var k in DEF) cfg[k] = saved[k] !== undefined ? saved[k] : DEF[k];
    })();
    var save = S.debounce(function () { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) {} }, 300);

    /* ── Slots ───────────────────────────────────────────────────────────── */
    var SLOT_DEFS = [
        { id: 'front', name: 'Front cover', hint: 'Right half' },
        { id: 'back', name: 'Back cover', hint: 'Left half' },
        { id: 'bg', name: 'Wrap image', hint: 'Behind the whole cover' },
        { id: 'tpl', name: 'KDP template', hint: 'Guide overlay only' }
    ];
    var slots = { front: {}, back: {}, bg: {}, tpl: {} };
    var sel = 'front';

    /* ── Geometry ────────────────────────────────────────────────────────── */
    function trimOf(key) {
        for (var i = 0; i < TRIMS.length; i++) if (TRIMS[i][0] === key) return { w: TRIMS[i][1], h: TRIMS[i][2] };
        return { w: 8.5, h: 11 };
    }
    function G() {
        var t = trimOf(cfg.trim), k = DPI;
        var sp = Math.max(0, cfg.pages) * (PAPER[cfg.paper] || PAPER.white);
        var Win = 2 * BLEED + 2 * t.w + sp, Hin = 2 * BLEED + t.h;
        return {
            t: t, sp: sp, Win: Win, Hin: Hin, k: k,
            W: Math.round(Win * k), H: Math.round(Hin * k),
            b: BLEED * k, tw: t.w * k, th: t.h * k,
            s0: (BLEED + t.w) * k, s1: (BLEED + t.w + sp) * k
        };
    }
    /* The rectangle a slot's art fills. With no border the front and back
       run through the bleed to the sheet edge; with a border they sit inside
       the trim, inset by that much. */
    function boxOf(id, g) {
        if (id === 'bg' || id === 'tpl') return { x: 0, y: 0, w: g.W, h: g.H };
        var i = cfg.inset * g.k;
        if (i <= 0) return id === 'back' ? { x: 0, y: 0, w: g.s0, h: g.H } : { x: g.s1, y: 0, w: g.W - g.s1, h: g.H };
        var x = id === 'back' ? g.b : g.s1;
        return { x: x + i, y: g.b + i, w: Math.max(1, g.tw - 2 * i), h: Math.max(1, g.th - 2 * i) };
    }

    /* Where the image lands in its box. ox/oy are offsets as a fraction of
       the box, so a layout survives a trim-size change. FILL is clamped so
       the art always covers the box — dragging can never open a gap. */
    function placement(s, box) {
        var fill = s.fit !== 'fit';
        var base = fill ? Math.max(box.w / s.iw, box.h / s.ih) : Math.min(box.w / s.iw, box.h / s.ih);
        var sc = base * (s.zoom || 1);
        var w = s.iw * sc, h = s.ih * sc;
        var mx = fill ? Math.max(0, (w - box.w) / 2) / box.w : 0.5;
        var my = fill ? Math.max(0, (h - box.h) / 2) / box.h : 0.5;
        s.ox = Math.max(-mx, Math.min(mx, s.ox || 0));
        s.oy = Math.max(-my, Math.min(my, s.oy || 0));
        var cx = box.x + box.w / 2 + s.ox * box.w, cy = box.y + box.h / 2 + s.oy * box.h;
        return { x: cx - w / 2, y: cy - h / 2, w: w, h: h, dpi: s.iw / (w / DPI) };
    }

    /* ── Drawing ─────────────────────────────────────────────────────────── */

    function rrect(ctx, x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        if (!r) { ctx.rect(x, y, w, h); return; }
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function fadeOf(s) {
        if (!s.t0 || S.reduced) return 1;
        var t = (performance.now() - s.t0) / 420;
        if (t >= 1) { s.t0 = 0; return 1; }
        needsFrame = true;
        return 1 - Math.pow(1 - t, 3);
    }
    var needsFrame = false;

    function drawSlot(ctx, id, g) {
        var s = slots[id];
        if (!s.img) return;
        var box = boxOf(id, g), p = placement(s, box);
        ctx.save();
        var r = (id === 'front' || id === 'back') && cfg.inset > 0 ? cfg.radius * g.k : 0;
        rrect(ctx, box.x, box.y, box.w, box.h, r);
        ctx.clip();
        ctx.globalAlpha = fadeOf(s);
        ctx.drawImage(s.img, p.x, p.y, p.w, p.h);
        ctx.restore();
    }

    /* The BLUR fill: the art, cover-fitted to the whole sheet at 320px wide,
       box-blurred three times (≈ gaussian), then drawn back up with smooth
       scaling. Done in JS rather than ctx.filter because Safari ignores the
       filter — this way preview and export look the same everywhere. */
    var blurCache = { key: '', canvas: null };
    function blurSource() { return slots.front.img ? slots.front : (slots.back.img ? slots.back : (slots.bg.img ? slots.bg : null)); }
    function blurCanvas(g) {
        var src = blurSource();
        if (!src) return null;
        var sw = 320, sh = Math.max(8, Math.round(sw * g.H / g.W));
        var key = [src.id, src.iw, src.ih, cfg.blur, sw, sh].join('|');
        if (blurCache.key === key) return blurCache.canvas;
        var c = document.createElement('canvas');
        c.width = sw; c.height = sh;
        var cx = c.getContext('2d', { willReadFrequently: true });
        cx.imageSmoothingQuality = 'high';
        var k = Math.max(sw / src.iw, sh / src.ih);
        cx.drawImage(src.img, (sw - src.iw * k) / 2, (sh - src.ih * k) / 2, src.iw * k, src.ih * k);
        var r = Math.round(cfg.blur / 100 * 22);
        if (r > 0) {
            var id = cx.getImageData(0, 0, sw, sh);
            for (var pass = 0; pass < 3; pass++) boxBlur(id.data, sw, sh, r);
            cx.putImageData(id, 0, 0);
        }
        blurCache = { key: key, canvas: c };
        return c;
    }
    function boxBlur(d, w, h, r) {
        var tmp = new Float32Array(d.length), x, y, c, i, acc, n = 2 * r + 1;
        for (y = 0; y < h; y++) {
            for (c = 0; c < 3; c++) {
                acc = 0;
                for (x = -r; x <= r; x++) acc += d[(y * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
                for (x = 0; x < w; x++) {
                    tmp[(y * w + x) * 4 + c] = acc / n;
                    acc += d[(y * w + Math.min(w - 1, x + r + 1)) * 4 + c] - d[(y * w + Math.max(0, x - r)) * 4 + c];
                }
            }
        }
        for (x = 0; x < w; x++) {
            for (c = 0; c < 3; c++) {
                acc = 0;
                for (y = -r; y <= r; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 4 + c];
                for (y = 0; y < h; y++) {
                    i = (y * w + x) * 4 + c;
                    d[i] = acc / n;
                    acc += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 4 + c] - tmp[(Math.max(0, y - r) * w + x) * 4 + c];
                }
            }
        }
    }

    /* ── Patterns ────────────────────────────────────────────────────────────
       Drawn, not bitmaps: each pattern is one tile painted with canvas paths
       at the export resolution (scale × 300 px) and repeated with
       createPattern, so a printed checker or swirl has the same crisp edges
       as the vector art it sits behind. Every tile is built to repeat
       seamlessly — shapes that cross an edge are drawn on both sides. */
    var PATTERNS = [
        ['checker', 'Checker'], ['stripes', 'Stripes'], ['dots', 'Polka dots'], ['swirls', 'Swirls'],
        ['waves', 'Waves'], ['chevron', 'Chevron'], ['stars', 'Stars'], ['hearts', 'Hearts'],
        ['gingham', 'Gingham'], ['grid', 'Grid'], ['confetti', 'Confetti'], ['sunburst', 'Sunburst']
    ];
    /* Picking a pattern sets the angle it looks best at. */
    var PAT_ANGLE = { stripes: 45 };

    function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
    function shade(hex, k) {
        return rgbHex(hexRgb(hex).map(function (v) { return k < 0 ? v * (1 + k) : v + (255 - v) * k; }));
    }
    function star(c, x, y, r) {
        c.beginPath();
        for (var i = 0; i < 10; i++) {
            var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
            c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        c.closePath(); c.fill();
    }
    function heart(c, x, y, r) {
        c.beginPath();
        c.moveTo(x, y + r * 0.9);
        c.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.6, y - r * 1.15, x, y - r * 0.35);
        c.bezierCurveTo(x + r * 0.6, y - r * 1.15, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
        c.fill();
    }
    function spiral(c, x, y, r, lw, flip) {
        c.beginPath();
        for (var i = 0, n = 140; i <= n; i++) {
            var t = i / n, a = t * 2.6 * Math.PI * 2 * (flip ? -1 : 1);
            c.lineTo(x + Math.cos(a) * r * t, y + Math.sin(a) * r * t);
        }
        c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
    }
    function dot(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }

    /* One T×T tile: ground colour a, ink colour b. */
    function drawTile(c, name, T, a, b) {
        var h = T / 2, q = T / 4, i, dx, dy;
        c.fillStyle = a; c.fillRect(0, 0, T, T);
        c.fillStyle = b; c.strokeStyle = b;
        switch (name) {
            case 'checker': c.fillRect(0, 0, h, h); c.fillRect(h, h, h, h); break;
            case 'stripes': c.fillRect(0, 0, h, T); break;
            case 'dots': dot(c, q, q, T * 0.15); dot(c, 3 * q, 3 * q, T * 0.15); break;
            case 'swirls':
                spiral(c, q, q, T * 0.2, T * 0.035, false);
                spiral(c, 3 * q, 3 * q, T * 0.2, T * 0.035, true);
                dot(c, 3 * q, q, T * 0.035); dot(c, q, 3 * q, T * 0.035);
                break;
            case 'waves':
                c.lineWidth = T * 0.07;
                [q, 3 * q].forEach(function (y0) {
                    c.beginPath();
                    for (var x = -2; x <= T + 2; x += T / 64) c.lineTo(x, y0 + Math.sin(x / T * Math.PI * 2) * T * 0.1);
                    c.stroke();
                });
                break;
            case 'chevron':
                /* Drawn from -T/2 to 3T/2 so the zigzag runs through both
                   edges and meets itself when the tile repeats. */
                c.lineWidth = T * 0.1; c.lineJoin = 'miter'; c.lineCap = 'butt';
                [q, 3 * q].forEach(function (y0) {
                    c.beginPath();
                    for (var k = -1; k <= 3; k++) c.lineTo(k * h, y0 + (k % 2 ? -1 : 1) * T * 0.1);
                    c.stroke();
                });
                break;
            case 'stars': star(c, q, q, T * 0.17); star(c, 3 * q, 3 * q, T * 0.17); break;
            case 'hearts': heart(c, q, q, T * 0.15); heart(c, 3 * q, 3 * q, T * 0.15); break;
            case 'gingham':
                c.globalAlpha = 0.5; c.fillRect(0, 0, h, T); c.fillRect(0, 0, T, h); c.globalAlpha = 1;
                break;
            case 'grid':
                var lw = Math.max(1, T * 0.035);
                c.fillRect(0, 0, lw, T); c.fillRect(0, 0, T, lw);
                break;
            case 'confetti':
                var r = rng(11), cols = [b, shade(b, 0.4), shade(b, -0.3)];
                for (i = 0; i < 16; i++) {
                    var x = r() * T, y = r() * T, s = T * (0.028 + r() * 0.03), rot = r() * Math.PI, kind = i % 3;
                    c.fillStyle = cols[i % 3];
                    /* Each piece is drawn at all nine offsets, so one that
                       straddles an edge reappears on the opposite side. */
                    for (dx = -T; dx <= T; dx += T) for (dy = -T; dy <= T; dy += T) {
                        c.save(); c.translate(x + dx, y + dy); c.rotate(rot);
                        if (kind === 0) dot(c, 0, 0, s);
                        else if (kind === 1) c.fillRect(-s * 1.5, -s * 0.5, s * 3, s);
                        else { c.beginPath(); c.moveTo(0, -s * 1.2); c.lineTo(s, s * 0.8); c.lineTo(-s, s * 0.8); c.closePath(); c.fill(); }
                        c.restore();
                    }
                }
                break;
        }
    }

    var patCache = { key: '', tile: null, avg: null };
    function patternTile(g) {
        var T = Math.max(8, Math.round(cfg.patScale * g.k));
        var key = [cfg.pattern, T, cfg.bgColor, cfg.patColor].join('|');
        if (patCache.key !== key) {
            var c = document.createElement('canvas');
            c.width = c.height = T;
            drawTile(c.getContext('2d'), cfg.pattern, T, cfg.bgColor, cfg.patColor);
            patCache = { key: key, tile: c, avg: null };
        }
        return patCache.tile;
    }
    function fillPattern(ctx, g, tile, angle) {
        var p = ctx.createPattern(tile, 'repeat');
        if (angle && p.setTransform && window.DOMMatrix) p.setTransform(new DOMMatrix().rotateSelf(angle));
        ctx.save(); ctx.fillStyle = p; ctx.fillRect(0, 0, g.W, g.H); ctx.restore();
    }
    /* Sunburst isn't a tile: rays fan out from the centre of the front. */
    function drawSunburst(ctx, x0, y0, R, n, angle, b) {
        var step = Math.PI * 2 / n, a0 = angle * Math.PI / 180;
        ctx.save(); ctx.fillStyle = b; ctx.beginPath();
        for (var i = 0; i < n; i += 2) {
            ctx.moveTo(x0, y0);
            ctx.arc(x0, y0, R, a0 + i * step, a0 + (i + 1) * step);
            ctx.closePath();
        }
        ctx.fill(); ctx.restore();
    }
    function drawPattern(ctx, g) {
        if (cfg.pattern === 'sunburst') {
            var n = Math.max(8, Math.min(72, Math.round(24 / cfg.patScale / 2) * 2));
            /* Clipped to the sheet: the export canvas would crop the rays
               anyway, but the preview draws onto a much larger stage. */
            ctx.save();
            ctx.beginPath(); ctx.rect(0, 0, g.W, g.H); ctx.clip();
            drawSunburst(ctx, (g.s1 + g.W) / 2, g.H / 2, Math.hypot(g.W, g.H), n, cfg.patAngle, cfg.patColor);
            ctx.restore();
            return;
        }
        fillPattern(ctx, g, patternTile(g), cfg.patAngle);
    }
    /* Average colour of the pattern, for automatic spine-text contrast. */
    function patternAvg(g) {
        if (cfg.pattern === 'sunburst') {
            var A = hexRgb(cfg.bgColor), B = hexRgb(cfg.patColor);
            return [0, 1, 2].map(function (i) { return (A[i] + B[i]) / 2; });
        }
        var t = patternTile(g);
        if (!patCache.avg) {
            var d = t.getContext('2d').getImageData(0, 0, t.width, t.height).data, s = [0, 0, 0], n = d.length / 4;
            for (var i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
            patCache.avg = s.map(function (v) { return v / n; });
        }
        return patCache.avg;
    }

    function compose(ctx, g) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = cfg.bgColor;
        ctx.fillRect(0, 0, g.W, g.H);

        if (cfg.bgmode === 'pattern') {
            drawPattern(ctx, g);
        } else if (cfg.bgmode === 'blur') {
            var bc = blurCanvas(g);
            if (bc) ctx.drawImage(bc, 0, 0, g.W, g.H);
        } else if (cfg.bgmode === 'image') {
            drawSlot(ctx, 'bg', g);
        }
        if (cfg.bgmode !== 'color' && cfg.dim) {
            ctx.fillStyle = cfg.dim < 0 ? 'rgba(0,0,0,' + (-cfg.dim / 100) + ')' : 'rgba(255,255,255,' + (cfg.dim / 100) + ')';
            ctx.fillRect(0, 0, g.W, g.H);
        }
        if (cfg.spinemode === 'color' && g.s1 > g.s0) {
            ctx.fillStyle = cfg.spineColor;
            ctx.fillRect(g.s0, 0, g.s1 - g.s0, g.H);
        }

        drawSlot(ctx, 'back', g);
        drawSlot(ctx, 'front', g);

        if (cfg.outline) {
            var lw = cfg.outlineW * g.k, r = cfg.inset > 0 ? cfg.radius * g.k : 0;
            ctx.strokeStyle = cfg.outlineColor;
            ctx.lineWidth = lw;
            ['back', 'front'].forEach(function (id) {
                if (!slots[id].img) return;
                var b = boxOf(id, g);
                /* Stroke INSIDE the box, so the outline never eats into the
                   bleed on an edge-to-edge layout or changes the border. */
                rrect(ctx, b.x + lw / 2, b.y + lw / 2, b.w - lw, b.h - lw, Math.max(0, r - lw / 2));
                ctx.stroke();
            });
        }
        drawSpineText(ctx, g);
    }

    function fontWeight() {
        var o = el('sFont').selectedOptions[0];
        return o ? o.getAttribute('data-w') : '700';
    }
    function spineInk() { return cfg.inkAuto ? autoInk() : cfg.ink; }

    function drawSpineText(ctx, g) {
        if (cfg.pages < SPINE_TEXT_MIN) return;
        var title = (cfg.title || '').trim(), author = (cfg.author || '').trim();
        if (cfg.sCaps) { title = title.toUpperCase(); author = author.toUpperCase(); }
        if (!title && !author) return;
        var sw = g.s1 - g.s0, avail = sw - 2 * SPINE_SAFE * g.k;
        if (avail < 6) return;
        var len = g.th - 2 * 0.25 * g.k;
        var fam = '"' + cfg.font + '", Inter, sans-serif', wt = fontWeight();
        var aScale = 0.82, gap;
        function f(sz) { return wt + ' ' + sz + 'px ' + fam; }

        /* Size from the letters' real ink height, not the font size. The old
           rule (font size = 78% of the spine) left the actual capitals at
           about half the spine's printable width — on a 0.27 in spine that
           printed 5-point text. Measuring the rendered glyphs and filling
           94% of the safe band makes caps roughly 1.7× taller, and it adapts
           per font: Bebas Neue's tall caps and Fredoka's round ones both end
           up exactly as wide as the spine allows. */
        function inkHeight(text, sz) {
            ctx.font = f(sz);
            var m = ctx.measureText(text), a = m.actualBoundingBoxAscent, d = m.actualBoundingBoxDescent;
            if (!(a > 0)) return sz * (cfg.sCaps ? 0.72 : 0.95);
            return a + (d > 0 ? d : 0);
        }
        var REF = 100;
        var hMax = Math.max(title ? inkHeight(title, REF) : 0, author ? inkHeight(author, REF * aScale) : 0) || REF * 0.72;
        var size = REF * (avail * 0.94 / hMax) * (cfg.sSize / 100);
        function widths(sz) {
            ctx.font = f(sz);
            var tw = title ? ctx.measureText(title).width : 0;
            ctx.font = f(sz * aScale);
            var aw = author ? ctx.measureText(author).width : 0;
            return { tw: tw, aw: aw, total: tw + aw + (title && author ? sz * 1.6 : 0) };
        }
        var m = widths(size);
        if (m.total > len) { size *= len / m.total; m = widths(size); }
        gap = size * 1.6;

        ctx.save();
        ctx.translate((g.s0 + g.s1) / 2, g.H / 2);
        ctx.rotate(Math.PI / 2);          /* US convention: reads top to bottom */
        ctx.fillStyle = spineInk();
        ctx.textBaseline = 'alphabetic';
        function put(text, sz, x, align) {
            ctx.font = f(sz);
            ctx.textAlign = align;
            var mt = ctx.measureText(text);
            var asc = mt.actualBoundingBoxAscent || sz * 0.7, desc = mt.actualBoundingBoxDescent || 0;
            ctx.fillText(text, x, (asc - desc) / 2);
        }
        if (title && author) {
            /* Title leads from the top, author sits at the foot. Centred as
               a pair when there is room to spare, so a short title does not
               hang off one end. */
            var slack = len - m.total, lead = -len / 2 + Math.min(slack / 2, size * 0.5);
            put(title, size, lead, 'left');
            put(author, size * aScale, len / 2 - Math.min(slack / 2, size * 0.5), 'right');
        } else {
            put(title || author, title ? size : size * aScale, 0, 'center');
        }
        ctx.restore();
    }

    /* Average colour behind the spine, for automatic text contrast. */
    function spineBg() {
        if (cfg.spinemode === 'color') return hexRgb(cfg.spineColor);
        if (cfg.bgmode === 'color') return hexRgb(cfg.bgColor);
        if (cfg.bgmode === 'pattern') return patternAvg(G());
        var g = G(), c = cfg.bgmode === 'blur' ? blurCanvas(g) : null;
        if (!c) return hexRgb(cfg.bgColor);
        var x = Math.round((g.s0 + g.s1) / 2 / g.W * c.width);
        var d = c.getContext('2d').getImageData(Math.max(0, x - 1), 0, 3, c.height).data, r = 0, gg = 0, b = 0, n = d.length / 4;
        for (var i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
        var rgb = [r / n, gg / n, b / n];
        var k = cfg.dim / 100;
        return rgb.map(function (v) { return k < 0 ? v * (1 + k) : v + (255 - v) * k; });
    }
    function lum(rgb) {
        var a = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }
    function autoInk() { return lum(spineBg()) > 0.28 ? '#111111' : '#ffffff'; }
    function hexRgb(h) {
        h = (h || '#ffffff').replace('#', '');
        if (h.length === 3) h = h.replace(/./g, '$&$&');
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgbHex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join(''); }

    /* ── Guides (preview only) ───────────────────────────────────────────── */
    function drawGuides(ctx, g, v) {
        var px = 1 / v.s;
        var b = g.b;
        if (cfg.gBleed) {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
            ctx.fillRect(0, 0, g.W, b);
            ctx.fillRect(0, g.H - b, g.W, b);
            ctx.fillRect(0, b, b, g.H - 2 * b);
            ctx.fillRect(g.W - b, b, b, g.H - 2 * b);
            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.25 * px; ctx.setLineDash([]);
            ctx.strokeRect(b, b, g.W - 2 * b, g.H - 2 * b);
        }
        var sf = SAFE * g.k;
        if (cfg.gSafe) {
            ctx.strokeStyle = '#10b981'; ctx.lineWidth = 1.25 * px; ctx.setLineDash([6 * px, 4 * px]);
            ctx.strokeRect(b + sf, b + sf, g.tw - 2 * sf, g.th - 2 * sf);
            ctx.strokeRect(g.s1 + sf, b + sf, g.tw - 2 * sf, g.th - 2 * sf);
            var ss = SPINE_SAFE * g.k;
            if (g.s1 - g.s0 > 2 * ss) ctx.strokeRect(g.s0 + ss, b + sf, g.s1 - g.s0 - 2 * ss, g.th - 2 * sf);
        }
        if (cfg.gSpine) {
            ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.25 * px; ctx.setLineDash([8 * px, 5 * px]);
            ctx.beginPath();
            ctx.moveTo(g.s0, 0); ctx.lineTo(g.s0, g.H);
            ctx.moveTo(g.s1, 0); ctx.lineTo(g.s1, g.H);
            ctx.stroke();
        }
        if (cfg.gBarcode) {
            /* 2 × 1.2 in, 0.25 in in from the spine fold and the bottom trim. */
            var bw = 2 * g.k, bh = 1.2 * g.k;
            var bx = g.s0 - 0.25 * g.k - bw, by = b + g.th - 0.25 * g.k - bh;
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.fillRect(bx, by, bw, bh);
            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5 * px; ctx.setLineDash([5 * px, 4 * px]);
            ctx.strokeRect(bx, by, bw, bh);
            ctx.setLineDash([]);
            ctx.fillStyle = '#b45309';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = '600 ' + (0.15 * g.k) + 'px Poppins, sans-serif';
            ctx.fillText('Barcode area', bx + bw / 2, by + bh / 2 - 0.1 * g.k);
            ctx.font = '500 ' + (0.11 * g.k) + 'px Poppins, sans-serif';
            ctx.fillText('2 × 1.2 in', bx + bw / 2, by + bh / 2 + 0.12 * g.k);
        }
        ctx.setLineDash([]);
    }

    /* ── Viewport ────────────────────────────────────────────────────────── */
    var wrap = el('wrap');
    var snapX = false, snapY = false, dragging = null, hoverId = null;
    var css = {};
    function readCss() {
        var st = getComputedStyle(document.documentElement);
        css.muted = st.getPropertyValue('--g500').trim() || '#6b7280';
        css.accent = st.getPropertyValue('--accent').trim() || '#dc2626';
        css.text = st.getPropertyValue('--g800').trim() || '#1f2937';
    }
    readCss();
    document.addEventListener('studio:theme', readCss);

    var vp = S.viewport(wrap, el('view'), {
        pad: 44,
        size: function () { var g = G(); return { w: g.W, h: g.H }; },
        draw: function (ctx, v) {
            var g = G();
            needsFrame = false;
            /* The sheet's shadow, so the cover reads as paper on the stage. */
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = 30 / v.s; ctx.shadowOffsetY = 8 / v.s;
            ctx.fillStyle = '#fff';
            if (cfg.pv === 'print') ctx.fillRect(g.b, g.b, g.W - 2 * g.b, g.H - 2 * g.b);
            else ctx.fillRect(0, 0, g.W, g.H);
            ctx.restore();

            ctx.save();
            if (cfg.pv === 'print') { ctx.beginPath(); ctx.rect(g.b, g.b, g.W - 2 * g.b, g.H - 2 * g.b); ctx.clip(); }
            compose(ctx, g);
            ctx.restore();

            if (cfg.pv !== 'print' && slots.tpl.img) {
                ctx.save();
                ctx.globalAlpha = (cfg.tplOp / 100) * fadeOf(slots.tpl);
                ctx.drawImage(slots.tpl.img, 0, 0, g.W, g.H);
                ctx.restore();
            }
            if (cfg.pv === 'guides' && !picking && !hideGuides) drawGuides(ctx, g, v);
            if (needsFrame) vp.redraw();
        },
        overlay: function (ctx, v) {
            var g = G();
            var X = function (x) { return v.x + x * v.s; }, Y = function (y) { return v.y + y * v.s; };
            /* Eyedropper loupe: the colour under the cursor, beside it. */
            if (picking && pickHex && pickPt) {
                var lx = X(pickPt.x) + 22, ly0 = Y(pickPt.y) + 22;
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 10;
                ctx.beginPath(); ctx.arc(lx + 18, ly0 + 18, 18, 0, Math.PI * 2);
                ctx.fillStyle = pickHex; ctx.fill();
                ctx.shadowBlur = 0; ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
                ctx.font = '500 11px "JetBrains Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
                var tw = ctx.measureText(pickHex).width + 12;
                ctx.fillStyle = 'rgba(17,24,39,.85)';
                ctx.fillRect(lx + 18 - tw / 2, ly0 + 42, tw, 18);
                ctx.fillStyle = '#fff'; ctx.fillText(pickHex.toUpperCase(), lx + 18, ly0 + 45);
                ctx.restore();
                return;
            }
            /* Panel labels above the sheet. */
            ctx.font = '600 11px Poppins, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            ctx.fillStyle = css.muted;
            var ly = Y(0) - 10;
            if (ly > 12) {
                ctx.fillText('BACK', X(g.s0 / 2), ly);
                ctx.fillText('FRONT', X((g.s1 + g.W) / 2), ly);
                if ((g.s1 - g.s0) * v.s > 26) ctx.fillText('SPINE', X((g.s0 + g.s1) / 2), ly);
            }
            /* Selection ring on the chosen art, hover ring on what a drag
               would move. */
            var ring = function (id, alpha, w) {
                if (!slots[id].img || id === 'tpl') return;
                var b = id === 'bg' ? { x: 0, y: 0, w: g.W, h: g.H } : boxOf(id, g);
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = css.accent; ctx.lineWidth = w;
                var r = (id !== 'bg' && cfg.inset > 0) ? cfg.radius * g.k * v.s : 0;
                rrect(ctx, X(b.x) - 1, Y(b.y) - 1, b.w * v.s + 2, b.h * v.s + 2, r + 1);
                ctx.stroke();
                ctx.restore();
            };
            if (hoverId && hoverId !== sel && !dragging) ring(hoverId, 0.45, 1.5);
            ring(sel, dragging ? 1 : 0.85, 2);
            /* Centre snap lines while dragging. */
            if (dragging && (snapX || snapY)) {
                var bb = boxOf(dragging.id, g);
                ctx.strokeStyle = '#ec4899'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
                ctx.beginPath();
                if (snapX) { ctx.moveTo(X(bb.x + bb.w / 2), Y(bb.y)); ctx.lineTo(X(bb.x + bb.w / 2), Y(bb.y + bb.h)); }
                if (snapY) { ctx.moveTo(X(bb.x), Y(bb.y + bb.h / 2)); ctx.lineTo(X(bb.x + bb.w), Y(bb.y + bb.h / 2)); }
                ctx.stroke(); ctx.setLineDash([]);
            }
        },
        down: function (pt) {
            if (picking) {
                var fn = picking, hex = sampleAt(pt);
                endPick();
                if (hex) { fn(hex); S.toast('Picked ' + hex.toUpperCase()); }
                return { move: function () {}, up: function () {} };
            }
            var id = hitArt(pt);
            var panel = panelAt(pt);
            if (!id) {
                if (panel && panel !== 'bg') select(panel);
                return null;
            }
            select(id);
            var s = slots[id], box = boxOf(id, G());
            dragging = { id: id, x: pt.x, y: pt.y, ox: s.ox, oy: s.oy, box: box };
            wrap.style.cursor = 'grabbing';
            return {
                move: function (p) {
                    var tol = 6 / vp.scale();
                    var nx = dragging.ox + (p.x - dragging.x) / box.w;
                    var ny = dragging.oy + (p.y - dragging.y) / box.h;
                    snapX = Math.abs(nx * box.w) < tol; snapY = Math.abs(ny * box.h) < tol;
                    s.ox = snapX ? 0 : nx; s.oy = snapY ? 0 : ny;
                    placement(s, box);
                    vp.redraw();
                },
                up: function () {
                    dragging = null; snapX = snapY = false;
                    wrap.style.cursor = '';
                    updateSel(); vp.redraw();
                }
            };
        },
        hover: function (pt) {
            if (picking) {
                pickPt = pt;
                /* One sample per frame, however fast the mouse moves. */
                if (!pickQueued) {
                    pickQueued = true;
                    requestAnimationFrame(function () {
                        pickQueued = false;
                        if (!picking || !pickPt) return;
                        pickHex = sampleAt(pickPt);
                        vp.redraw();
                    });
                }
                return;
            }
            var id = hitArt(pt);
            if (id !== hoverId) { hoverId = id; vp.redraw(); }
            wrap.style.cursor = id ? 'move' : '';
        },
        dblclick: function (pt) {
            var id = hitArt(pt);
            if (!id) return false;
            var s = slots[id]; s.ox = s.oy = 0; s.zoom = 1;
            updateSel(); vp.redraw();
            S.toast('Recentered');
            return true;
        },
        change: function (v) { el('zVal').textContent = Math.round(v.s / vp.fitScale() * 100) + '%'; }
    });

    /* ── Eyedropper ──────────────────────────────────────────────────────────
       Chrome and Edge have a native screen eyedropper — it can pick from the
       preview or from anything else on screen. Elsewhere the preview itself
       becomes the picker. Either way guides are hidden while picking, so a
       sample can't land on a red trim line instead of the art. */
    var picking = null, pickHex = null, pickPt = null, pickQueued = false, hideGuides = false;

    /* The true composed colour at an art point: render the scene into a
       1×1 canvas positioned over that point. Exact at any zoom. */
    function sampleAt(pt) {
        var g = G();
        if (pt.x < 0 || pt.y < 0 || pt.x >= g.W || pt.y >= g.H) return null;
        var c = document.createElement('canvas');
        c.width = c.height = 1;
        var x = c.getContext('2d', { willReadFrequently: true });
        x.translate(-Math.floor(pt.x), -Math.floor(pt.y));
        compose(x, g);
        var d = x.getImageData(0, 0, 1, 1).data;
        return rgbHex([d[0], d[1], d[2]]);
    }
    function pickColor(apply) {
        if (window.EyeDropper) {
            hideGuides = true; vp.redraw();
            new EyeDropper().open()
                .then(function (r) { apply(r.sRGBHex); S.toast('Picked ' + r.sRGBHex.toUpperCase()); })
                .catch(function () {})
                .then(function () { hideGuides = false; vp.redraw(); });
            return;
        }
        picking = apply;
        wrap.classList.add('picking');
        S.toast('Click the cover to pick a colour · Esc to cancel');
        vp.redraw();
    }
    function endPick() {
        picking = null; pickHex = null; pickPt = null;
        wrap.classList.remove('picking');
        vp.redraw();
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && picking) endPick(); });

    function panelAt(pt) {
        var g = G();
        if (pt.x < 0 || pt.y < 0 || pt.x > g.W || pt.y > g.H) return null;
        if (pt.x < g.s0) return 'back';
        if (pt.x > g.s1) return 'front';
        return 'bg';
    }
    function inBox(pt, b) { return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h; }
    function hitArt(pt) {
        var g = G();
        if (slots.front.img && inBox(pt, boxOf('front', g))) return 'front';
        if (slots.back.img && inBox(pt, boxOf('back', g))) return 'back';
        if (slots.bg.img && cfg.bgmode === 'image' && inBox(pt, boxOf('bg', g))) return 'bg';
        return null;
    }

    wrap.addEventListener('keydown', function (e) {
        var s = slots[sel];
        if (!s.img || sel === 'tpl' || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
        e.preventDefault();
        var g = G(), box = boxOf(sel, g), step = (e.shiftKey ? 20 : 2) / vp.scale();
        if (e.key === 'ArrowLeft') s.ox -= step / box.w;
        if (e.key === 'ArrowRight') s.ox += step / box.w;
        if (e.key === 'ArrowUp') s.oy -= step / box.h;
        if (e.key === 'ArrowDown') s.oy += step / box.h;
        placement(s, box);
        vp.redraw();
    });

    el('zIn').addEventListener('click', function () { vp.zoomBy(1.5); });
    el('zOut').addEventListener('click', function () { vp.zoomBy(1 / 1.5); });
    el('zFit').addEventListener('click', function () { vp.fit(); });

    /* ── Loading images ──────────────────────────────────────────────────── */
    function isImg(f) { return f && /^image\//.test(f.type); }

    function nextEmpty() {
        if (!slots.front.img && !slots.front.pending) return 'front';
        if (!slots.back.img && !slots.back.pending) return 'back';
        return null;
    }

    function load(id, file) {
        var s = slots[id];
        s.pending = true;
        var dec = window.createImageBitmap ? createImageBitmap(file) : new Promise(function (res, rej) {
            var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = URL.createObjectURL(file);
        });
        return dec.then(function (img) {
            if (s.url) URL.revokeObjectURL(s.url);
            if (s.img && s.img.close) s.img.close();
            slots[id] = {
                id: id, img: img, iw: img.width, ih: img.height, name: file.name || 'pasted image',
                url: URL.createObjectURL(file), fit: 'fill', zoom: 1, ox: 0, oy: 0, t0: performance.now()
            };
            if (id === 'bg') setCfg('bgmode', 'image');
            if (id === 'front' || id === 'back') refreshSwatches(true);
            blurCache.key = '';
            select(id);
            renderCards();
            updateEmpty();
            vp.redraw();
            S.toast(slotName(id) + ' added');
        }, function () {
            s.pending = false;
            S.toast('Could not read ' + (file.name || 'that image'), true);
        });
    }

    function place(files, e) {
        var list = Array.prototype.filter.call(files, isImg);
        if (!list.length) { S.toast('Those are not images', true); return; }
        var target = null;
        if (e && e.clientX != null && wrap.contains(e.target)) target = panelAt(vp.toArt(e.clientX, e.clientY));
        if (target === 'bg' && list.length === 1 && !(e && e.target && e.target.closest && e.target.closest('.slot'))) target = 'bg';
        list.forEach(function (f, i) {
            var id = /template/i.test(f.name) ? 'tpl' : (i === 0 && target ? target : (nextEmpty() || (i === 0 ? sel : null)));
            if (id) load(id, f);
        });
    }

    var pickTarget = null;
    function pick(target) {
        pickTarget = target;
        var inp = el('file');
        inp.multiple = !target;
        inp.click();
    }
    el('file').addEventListener('change', function () {
        var fs = Array.prototype.slice.call(this.files || []);
        if (fs.length) {
            if (pickTarget) load(pickTarget, fs[0]); else place(fs);
        }
        this.value = '';
    });
    el('browseBtn').addEventListener('click', function () { pick(null); });
    S.fileDrop(function (files, e) { if (!e._taken) place(files, e); }, 'Drop to add to the cover');

    function slotName(id) { for (var i = 0; i < SLOT_DEFS.length; i++) if (SLOT_DEFS[i].id === id) return SLOT_DEFS[i].name; return id; }

    /* ── Slot cards ──────────────────────────────────────────────────────── */
    var ICONS = { front: 'auto_stories', back: 'flip_to_back', bg: 'wallpaper', tpl: 'grid_on' };
    var cards = {};
    SLOT_DEFS.forEach(function (d) {
        var c = document.createElement('button');
        c.type = 'button'; c.className = 'slot'; c.setAttribute('role', 'option');
        c.innerHTML = '<div class="thumb"><span class="material-symbols-outlined">' + ICONS[d.id] + '</span><img alt=""></div>' +
                      '<div class="meta"><b></b><span class="badge" hidden></span></div><div class="sub"></div>';
        c.querySelector('b').textContent = d.name;
        c.addEventListener('click', function () {
            if (!slots[d.id].img) { select(d.id); pick(d.id); return; }
            select(d.id);
        });
        c.addEventListener('dragover', function (e) { e.preventDefault(); c.classList.add('over'); });
        c.addEventListener('dragleave', function () { c.classList.remove('over'); });
        c.addEventListener('drop', function (e) {
            e.preventDefault(); c.classList.remove('over');
            e._taken = true;
            var f = Array.prototype.filter.call(e.dataTransfer.files || [], isImg)[0];
            if (f) load(d.id, f);
        });
        el('slots').appendChild(c);
        cards[d.id] = c;
    });

    function dpiBadge(dpi) {
        if (!isFinite(dpi)) return null;
        var d = Math.round(dpi);
        return { text: d + ' dpi', cls: d >= 250 ? 'ok' : (d >= 150 ? 'warn' : 'bad') };
    }

    function renderCards() {
        var g = G();
        SLOT_DEFS.forEach(function (d) {
            var c = cards[d.id], s = slots[d.id];
            c.setAttribute('aria-selected', String(sel === d.id));
            c.classList.toggle('filled', !!s.img);
            var img = c.querySelector('img');
            if (s.url && img.getAttribute('src') !== s.url) {
                img.classList.remove('on');
                img.onload = function () { img.classList.add('on'); };
                img.src = s.url;
            } else if (!s.url) { img.removeAttribute('src'); img.classList.remove('on'); }
            c.querySelector('.sub').textContent = s.img ? s.name : d.hint;
            var bd = c.querySelector('.badge');
            var info = s.img && (d.id === 'front' || d.id === 'back') ? dpiBadge(placement(s, boxOf(d.id, g)).dpi) : null;
            bd.hidden = !info;
            if (info) { bd.textContent = info.text; bd.className = 'badge ' + info.cls; }
        });
    }

    function select(id) {
        if (sel !== id) { sel = id; vp.redraw(); }
        renderCards();
        updateSel();
    }

    /* The panel under the cards edits whichever image is selected. */
    function updateSel() {
        var s = slots[sel];
        el('selctl').hidden = !s.img;
        if (!s.img) return;
        var tpl = sel === 'tpl';
        el('selName').textContent = slotName(sel);
        el('fitRow').hidden = el('zoomRow').hidden = el('posRow').hidden = tpl;
        el('opRow').hidden = !tpl;
        el('swapBtn').hidden = !(sel === 'front' || sel === 'back');
        document.querySelector('input[name="fit"][value="' + (s.fit || 'fill') + '"]').checked = true;
        S.syncSeg(el('fitRow').querySelector('.seg'));
        var z = Math.round((s.zoom || 1) * 100);
        el('izoom').value = z; el('izoomVal').textContent = z + '%';
        S.fillRange(el('izoom')); S.markMoved(el('izoom'));
        el('tplOp').value = cfg.tplOp; el('tplOpVal').textContent = cfg.tplOp + '%'; S.fillRange(el('tplOp'));
        if (sel === 'front' || sel === 'back') {
            var p = placement(s, boxOf(sel, G()));
            var d = Math.round(p.dpi);
            el('dpiNote').textContent = d + ' DPI' + (d >= 250 ? '' : d >= 150 ? ' · may print soft' : ' · too low for print');
        } else el('dpiNote').textContent = '';
        renderCards();
    }

    document.querySelectorAll('input[name="fit"]').forEach(function (r) {
        r.addEventListener('change', function () {
            var s = slots[sel]; if (!s.img) return;
            s.fit = this.value; s.ox = s.oy = 0;
            updateSel(); vp.redraw();
        });
    });
    el('izoom').addEventListener('input', function () {
        var s = slots[sel]; if (!s.img) return;
        s.zoom = +this.value / 100;
        el('izoomVal').textContent = this.value + '%';
        S.markMoved(this);
        placement(s, boxOf(sel, G()));
        renderCards(); vp.redraw();
    });
    el('izoom').addEventListener('change', updateSel);
    el('tplOp').addEventListener('input', function () {
        setCfg('tplOp', +this.value); el('tplOpVal').textContent = this.value + '%';
    });
    el('centerBtn').addEventListener('click', function () {
        var s = slots[sel]; if (!s.img) return;
        s.ox = s.oy = 0; vp.redraw(); updateSel();
    });
    el('replaceBtn').addEventListener('click', function () { pick(sel); });
    el('removeBtn').addEventListener('click', function () {
        var s = slots[sel]; if (!s.img) return;
        if (s.url) URL.revokeObjectURL(s.url);
        if (s.img.close) s.img.close();
        slots[sel] = {};
        if (sel === 'bg' && cfg.bgmode === 'image') setCfg('bgmode', 'color');
        blurCache.key = '';
        refreshSwatches(false);
        updateSel(); updateEmpty(); vp.redraw();
        S.toast(slotName(sel) + ' removed');
    });
    el('swapBtn').addEventListener('click', function () {
        var f = slots.front, b = slots.back;
        slots.front = b; slots.back = f;
        if (slots.front.id) slots.front.id = 'front';
        if (slots.back.id) slots.back.id = 'back';
        [slots.front, slots.back].forEach(function (s) { if (s.img) { s.ox = s.oy = 0; s.t0 = performance.now(); } });
        blurCache.key = '';
        select(sel === 'front' ? 'back' : 'front');
        vp.redraw();
    });

    /* ── Swatches from the art ───────────────────────────────────────────
       The colours along the outer edge of the art are what a fill has to
       continue, so those are what get offered: sample a ring 3px deep on a
       48px copy, bucket at 4 bits a channel, keep the most common buckets
       that are visibly different from each other. */
    function edgeColours(s) {
        var n = 48, c = document.createElement('canvas');
        c.width = n; c.height = n;
        var cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(s.img, 0, 0, n, n);
        var d = cx.getImageData(0, 0, n, n).data, buckets = {};
        for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
            if (x > 2 && x < n - 3 && y > 2 && y < n - 3) continue;
            var i = (y * n + x) * 4, key = (d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4);
            var b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
            b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
        }
        return Object.keys(buckets).map(function (k) {
            var b = buckets[k]; return { n: b.n, c: [b.r / b.n, b.g / b.n, b.b / b.n] };
        }).sort(function (a, b) { return b.n - a.n; }).map(function (o) { return o.c; });
    }
    var artColours = [];
    function refreshSwatches(autoApply) {
        var cols = [];
        ['front', 'back'].forEach(function (id) { if (slots[id].img) cols = cols.concat(edgeColours(slots[id]).slice(0, 8)); });
        var picked = [];
        cols.forEach(function (c) {
            if (picked.length >= 6) return;
            if (picked.every(function (p) { return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 48; })) picked.push(c);
        });
        artColours = picked.map(rgbHex);
        if (autoApply && cfg.bgAuto && artColours.length) {
            cfg.bgColor = artColours[0]; el('bgColor').value = cfg.bgColor; save();
        }
        renderSwatches();
        renderPatternThumbs();
    }
    function renderSwatches() {
        [['swatches', 'bgColor'], ['spineSwatches', 'spineColor'], ['patSwatches', 'patColor']].forEach(function (pair) {
            var box = el(pair[0]), key = pair[1];
            box.innerHTML = '';
            /* Pattern ink gets a few playful extras on top of the art's own
               colours, since a pattern usually wants contrast with the ground. */
            var extras = key === 'patColor' ? ['#f9c4d2', '#a7d8f0', '#ffe08a', '#b8e6b0', '#111111']
                                            : ['#ffffff', '#111111', '#f4ecd8'];
            var list = artColours.concat(extras).filter(function (c, i, a) { return a.indexOf(c) === i; });
            list.forEach(function (hex) {
                var b = document.createElement('button');
                b.type = 'button'; b.className = 'swatch';
                b.style.background = hex; b.title = hex;
                b.setAttribute('aria-label', 'Use ' + hex);
                b.setAttribute('aria-pressed', String(cfg[key].toLowerCase() === hex.toLowerCase()));
                b.addEventListener('click', function () {
                    if (key === 'bgColor') cfg.bgAuto = false;
                    setCfg(key, hex); el(key).value = hex;
                });
                box.appendChild(b);
            });
        });
    }

    /* ── Controls → cfg ──────────────────────────────────────────────────── */
    TRIMS.forEach(function (t) {
        var o = document.createElement('option');
        o.value = t[0];
        o.textContent = (t[3] ? t[3] + ' · ' : '') + t[1] + ' × ' + t[2] + ' in';
        el('trim').appendChild(o);
    });

    function setCfg(k, v) {
        cfg[k] = v; save();
        if (k === 'blur') blurCache.key = '';
        syncUI();
        vp.redraw();
    }

    
    var SWATCH_KEYS = { swatches: 'bgColor', spineSwatches: 'spineColor', patSwatches: 'patColor' };

    /* Pattern picker: a tile per pattern, previewed in the current colours. */
    var patThumbKey = '';
    PATTERNS.forEach(function (p) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'pat'; b.dataset.pat = p[0];
        b.setAttribute('role', 'radio'); b.title = p[1];
        b.innerHTML = '<canvas width="112" height="80"></canvas><span></span>';
        b.querySelector('span').textContent = p[1];
        b.addEventListener('click', function () {
            if (cfg.pattern !== p[0] && PAT_ANGLE[p[0]] != null) cfg.patAngle = PAT_ANGLE[p[0]];
            else if (cfg.pattern !== p[0] && PAT_ANGLE[cfg.pattern] != null) cfg.patAngle = 0;
            setCfg('pattern', p[0]);
        });
        el('patterns').appendChild(b);
    });
    function renderPatternThumbs() {
        var key = [cfg.bgColor, cfg.patColor].join('|');
        if (key === patThumbKey) return;
        patThumbKey = key;
        document.querySelectorAll('.pat').forEach(function (b) {
            var name = b.dataset.pat, c = b.querySelector('canvas'), x = c.getContext('2d');
            var g = { W: c.width, H: c.height };
            x.fillStyle = cfg.bgColor; x.fillRect(0, 0, g.W, g.H);
            if (name === 'sunburst') { drawSunburst(x, g.W / 2, g.H / 2, g.W, 16, 0, cfg.patColor); return; }
            var t = document.createElement('canvas'); t.width = t.height = 40;
            drawTile(t.getContext('2d'), name, 40, cfg.bgColor, cfg.patColor);
            fillPattern(x, g, t, PAT_ANGLE[name] || 0);
        });
    }

    /* One place that pushes cfg into every control and readout. */
    function syncUI() {
        var g = G();
        el('trim').value = cfg.trim;
        if (document.activeElement !== el('pages')) el('pages').value = cfg.pages;
        el('paper').value = cfg.paper;
        var trimNum = function (v, d) { return String(Math.round(v * Math.pow(10, d)) / Math.pow(10, d)); };
        el('oSpine').innerHTML = trimNum(g.sp, 3) + '<small>in</small>';
        el('oW').innerHTML = trimNum(g.Win, 3) + '<small>in</small>';
        el('oH').innerHTML = trimNum(g.Hin, 3) + '<small>in</small>';
        el('oSize').textContent = (Math.round(g.Win * 1000) / 1000) + ' × ' + g.Hin + ' in';
        el('oPx').textContent = g.W.toLocaleString() + ' × ' + g.H.toLocaleString() + ' px';
        el('spineBadge').textContent = trimNum(g.sp, 3) + ' in spine';
        el('fSize').textContent = (Math.round(g.Win * 1000) / 1000) + ' × ' + g.Hin + ' in · ' + g.W + ' × ' + g.H + ' px';

        [['bgmode', cfg.bgmode], ['spinemode', cfg.spinemode], ['pv', cfg.pv]].forEach(function (p) {
            var r = document.querySelector('input[name="' + p[0] + '"][value="' + p[1] + '"]');
            if (r && !r.checked) { r.checked = true; S.syncSeg(r.closest('.seg')); }
        });
        el('colorRow').hidden = false;
        el('blurRows').hidden = cfg.bgmode !== 'blur';
        el('dimRow').hidden = cfg.bgmode === 'color' || cfg.bgmode === 'pattern';
        el('bgColor').value = cfg.bgColor;
        el('colorLbl').textContent = cfg.bgmode === 'pattern' ? 'Background color' : 'Fill color';
        el('patRows').hidden = cfg.bgmode !== 'pattern';
        el('patRows2').hidden = cfg.bgmode !== 'pattern';
        el('patColor').value = cfg.patColor;
        setRange('patScale', cfg.patScale, cfg.patScale + ' in');
        setRange('patAngle', cfg.patAngle, cfg.patAngle + '°');
        el('patScaleLbl').textContent = cfg.pattern === 'sunburst' ? 'Ray width' : 'Scale';
        document.querySelectorAll('.pat').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.pat === cfg.pattern)); });
        renderPatternThumbs();

        setRange('blur', cfg.blur, String(cfg.blur));
        setRange('dim', cfg.dim, (cfg.dim > 0 ? '+' : '') + cfg.dim);
        setRange('inset', cfg.inset, cfg.inset ? cfg.inset + ' in' : 'None');
        setRange('radius', cfg.radius, (Math.round(cfg.radius * 100) / 100) + ' in');
        setRange('outlineW', cfg.outlineW, cfg.outlineW + ' in');
        setRange('sSize', cfg.sSize, cfg.sSize + '%');
        el('radiusRow').hidden = !(cfg.inset > 0);
        el('outline').checked = cfg.outline;
        el('outlineRow').hidden = !cfg.outline;
        el('outlineColor').value = cfg.outlineColor;

        el('spineColorRow').hidden = cfg.spinemode !== 'color';
        el('spineColor').value = cfg.spineColor;
        if (document.activeElement !== el('sTitle')) el('sTitle').value = cfg.title;
        if (document.activeElement !== el('sAuthor')) el('sAuthor').value = cfg.author;
        el('sFont').value = cfg.font;
        el('sCaps').checked = cfg.sCaps;
        el('sInk').value = spineInk();
        el('autoInk').setAttribute('aria-pressed', String(cfg.inkAuto));
        
        var okText = cfg.pages >= SPINE_TEXT_MIN;
        el('spineWarn').hidden = okText;
        var tb = el('spineTextBadge');
        tb.textContent = okText ? 'Text on' : '80+ pages';
        tb.className = 'badge ' + (okText ? 'ok' : 'warn');

        ['gBleed', 'gSafe', 'gSpine', 'gBarcode'].forEach(function (k) { el(k).checked = cfg[k]; });

        document.querySelectorAll('.swatch').forEach(function (b) {
            var key = SWATCH_KEYS[b.parentNode.id];
            if (!key) return;
            b.setAttribute('aria-pressed', String(cfg[key].toLowerCase() === (b.title || '').toLowerCase()));
        });

        var warn = [];
        if (cfg.pages < 24) warn.push('KDP paperbacks need at least 24 pages');
        if (cfg.pages > 828) warn.push('over KDP’s 828-page maximum');
        el('fHint').textContent = warn.join(' · ');
        renderCards();
    }
    function setRange(id, v, label) {
        var r = el(id);
        if (+r.value !== +v) r.value = v;
        S.fillRange(r); S.markMoved(r);
        el(id + 'Val').textContent = label;
    }

    el('trim').addEventListener('change', function () { setCfg('trim', this.value); vp.fit(); });
    el('paper').addEventListener('change', function () { setCfg('paper', this.value); });
    el('pages').addEventListener('input', function () {
        var n = parseInt(this.value, 10);
        if (n > 0) setCfg('pages', Math.min(2000, n));
    });
    el('pages').addEventListener('change', function () {
        var n = Math.max(24, Math.min(828, parseInt(this.value, 10) || 24));
        this.value = n; setCfg('pages', n);
    });
    document.querySelectorAll('[data-step]').forEach(function (b) {
        b.addEventListener('click', function () {
            var n = Math.max(24, Math.min(828, cfg.pages + +b.getAttribute('data-step')));
            el('pages').value = n; setCfg('pages', n);
        });
    });

    ['bgmode', 'spinemode', 'pv'].forEach(function (name) {
        document.querySelectorAll('input[name="' + name + '"]').forEach(function (r) {
            r.addEventListener('change', function () {
                if (name === 'bgmode' && this.value === 'image' && !slots.bg.img) {
                    select('bg'); pick('bg');
                }
                setCfg(name, this.value);
            });
        });
    });
    el('bgColor').addEventListener('input', function () { cfg.bgAuto = false; setCfg('bgColor', this.value); });
    el('spineColor').addEventListener('input', function () { setCfg('spineColor', this.value); });
    el('outlineColor').addEventListener('input', function () { setCfg('outlineColor', this.value); });
    el('sInk').addEventListener('input', function () { cfg.inkAuto = false; setCfg('ink', this.value); });
    el('autoInk').addEventListener('click', function () { setCfg('inkAuto', !cfg.inkAuto); if (!cfg.inkAuto) setCfg('ink', el('sInk').value); });
    el('outline').addEventListener('change', function () { setCfg('outline', this.checked); });
    el('sCaps').addEventListener('change', function () { setCfg('sCaps', this.checked); });
    el('patColor').addEventListener('input', function () { setCfg('patColor', this.value); });

    /* Eyedropper buttons: data-pick names the setting they write. */
    var PICKERS = {
        bgColor:      function (h) { cfg.bgAuto = false; setCfg('bgColor', h); },
        patColor:     function (h) { setCfg('patColor', h); },
        spineColor:   function (h) { if (cfg.spinemode !== 'color') cfg.spinemode = 'color'; setCfg('spineColor', h); },
        sInk:         function (h) { cfg.inkAuto = false; setCfg('ink', h); },
        outlineColor: function (h) { setCfg('outlineColor', h); }
    };
    document.querySelectorAll('[data-pick]').forEach(function (b) {
        b.addEventListener('click', function () { pickColor(PICKERS[b.getAttribute('data-pick')]); });
    });
    ['gBleed', 'gSafe', 'gSpine', 'gBarcode'].forEach(function (k) {
        el(k).addEventListener('change', function () {
            setCfg(k, this.checked);
            if (this.checked && cfg.pv !== 'guides') setCfg('pv', 'guides');
        });
    });
    [['blur', 1], ['dim', 1], ['inset', 1], ['radius', 1], ['outlineW', 1], ['sSize', 1], ['patScale', 1], ['patAngle', 1]].forEach(function (p) {
        el(p[0]).addEventListener('input', function () { setCfg(p[0], +this.value); if (p[0] === 'inset') renderCards(); });
    });
    el('sTitle').addEventListener('input', function () { setCfg('title', this.value); });
    el('sAuthor').addEventListener('input', function () { setCfg('author', this.value); });
    el('sFont').addEventListener('change', function () {
        setCfg('font', this.value);
        loadFont();
    });
    function loadFont() {
        if (!document.fonts || !document.fonts.load) return;
        document.fonts.load(fontWeight() + ' 40px "' + cfg.font + '"').then(function () { vp.redraw(); });
    }

    /* ── Export ──────────────────────────────────────────────────────────── */
    function renderSheet() {
        var g = G();
        var c = document.createElement('canvas');
        c.width = g.W; c.height = g.H;
        compose(c.getContext('2d'), g);
        return { c: c, g: g };
    }
    function fileBase() {
        var t = (cfg.title || '').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase();
        return (t || 'kdp-cover') + '_' + cfg.trim + '_' + cfg.pages + 'p';
    }
    function busy(on) {
        el('prog').className = 'progress' + (on ? ' on indet' : '');
        el('pdfBtn').disabled = el('pngBtn').disabled = on || !hasArt();
    }
    function preflight() {
        if (!hasArt()) { S.toast('Add some artwork first', true); return false; }
        return true;
    }
    function ready() {
        var f = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
        return f.then(function () { return new Promise(function (r) { setTimeout(r, 30); }); });
    }

    el('pdfBtn').addEventListener('click', function () {
        if (!preflight()) return;
        busy(true);
        ready().then(function () {
            var r = renderSheet();
            return P.canvasJpeg(r.c, DPI, 0.95).then(function (jpg) {
                var pdf = new P.Pdf();
                pdf.addJpegPage(jpg, r.g.W, r.g.H, r.g.Win * 72, r.g.Hin * 72);
                S.download(pdf.finish(), fileBase() + '.pdf');
                S.toast('PDF saved · ' + (Math.round(r.g.Win * 1000) / 1000) + ' × ' + r.g.Hin + ' in');
            });
        }).catch(function (err) { console.error(err); S.toast('Export failed', true); })
          .then(function () { busy(false); });
    });
    el('pngBtn').addEventListener('click', function () {
        if (!preflight()) return;
        busy(true);
        ready().then(function () {
            var r = renderSheet();
            return P.canvasPng(r.c, DPI).then(function (blob) {
                S.download(blob, fileBase() + '.png');
                S.toast('PNG saved · ' + r.g.W + ' × ' + r.g.H);
            });
        }).catch(function (err) { console.error(err); S.toast('Export failed', true); })
          .then(function () { busy(false); });
    });

    function hasArt() { return !!(slots.front.img || slots.back.img || slots.bg.img); }
    function updateEmpty() {
        el('empty').classList.toggle('gone', hasArt() || !!slots.tpl.img);
        busy(false);
    }

    S.bindThemeButton(el('themeBtn'));
    syncUI();
    renderSwatches();
    updateSel();
    updateEmpty();
    loadFont();
    vp.fit(true);
})();
