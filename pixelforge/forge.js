/* ============================================================================
   pixelforge in the browser
   ---------------------------------------------------------------------------
   A one-to-one port of the parts of pxlib that the page needs: the .pxa
   parser and validator (fmt.py), the built-in palettes (palettes.py), the
   3x5 label font (font.py), the annotated preview (render.py) and the
   GIF89a writer (gif.py). The text in the box is the sprite; painting on the
   canvas edits that text, so the two can never disagree.
   ========================================================================= */
(function () {
    'use strict';

    /* ── Palettes ───────────────────────────────────────────────────────── */

    function pal(keys, colors, notes) {
        var od = {}; keys.split('').forEach(function (k, i) { od[k] = colors[i]; });
        return { keys: keys, colors: od, notes: notes || {} };
    }
    var PALETTES = {
        chr16: pal('Kks123456789mMhHWe',
            ['#0d0b14', '#241f2e', '#3c3247', '#7a4a34', '#c17f5b', '#f0b98d', '#2c4a7c', '#3f6cb0', '#6fa0e0',
             '#6d2233', '#a63b4c', '#d9697a', '#5a5f6e', '#a8b0c0', '#2a1a12', '#6b4227', '#f4f1e8', '#101018'],
            { '1': 'skin dark', '2': 'skin mid', '3': 'skin light', '4': 'clothA dark', '5': 'clothA mid', '6': 'clothA light',
              '7': 'clothB dark', '8': 'clothB mid', '9': 'clothB light', 'm': 'metal dark', 'M': 'metal light',
              'h': 'hair dark', 'H': 'hair light', 'K': 'outline', 'k': 'shadow', 's': 'guide/greyblock', 'W': 'highlight', 'e': 'eye' }),
        pico8: pal('0123456789abcdef',
            ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
             '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa']),
        sweetie16: pal('0123456789abcdef',
            ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
             '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57']),
        db16: pal('0123456789abcdef',
            ['#140c1c', '#442434', '#30346d', '#4e4a4e', '#854c30', '#346524', '#d04648', '#757161',
             '#597dce', '#d27d2c', '#8595a1', '#6daa2c', '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6']),
        gb: pal('0123', ['#0f380f', '#306230', '#8bac0f', '#9bbc0f']),
        mono: pal('0123', ['#000000', '#555555', '#aaaaaa', '#ffffff']),
        edg32: pal('0123456789abcdefghijklmnopqrstuv',
            ['#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
             '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
             '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
             '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569'])
    };
    var DEFAULT_PALETTE = 'chr16';
    var TRANSPARENT = [0, 0, 0, 0];

    /* ── Format ─────────────────────────────────────────────────────────── */

    function PxaError(msg) { this.message = msg; }
    PxaError.prototype = Object.create(Error.prototype);

    function parseColor(tok) {
        var t = tok.trim().toLowerCase();
        if (t === 'transparent' || t === 'none' || t === 'clear' || t === '-') return TRANSPARENT.slice();
        if (t[0] !== '#') throw new PxaError("color must be #hex or 'transparent', got '" + tok + "'");
        var h = t.slice(1);
        if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
        if (h.length === 6) h += 'ff';
        if (h.length !== 8 || /[^0-9a-f]/.test(h)) throw new PxaError("bad hex color '" + tok + "' (want #rgb, #rrggbb or #rrggbbaa)");
        return [0, 2, 4, 6].map(function (i) { return parseInt(h.substr(i, 2), 16); });
    }
    function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }
    function colorHex(c) {
        if (c[3] === 0) return 'transparent';
        var s = '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
        return c[3] === 255 ? s : s + hex2(c[3]);
    }
    function same(a, b) { return a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]; }

    function applyUse(sprite, name) {
        if (!PALETTES[name]) throw new PxaError("unknown palette '" + name + "' (have: " + Object.keys(PALETTES).sort().join(', ') + ')');
        var p = PALETTES[name];
        p.keys.split('').forEach(function (k) { sprite.palette[k] = parseColor(p.colors[k]); if (!(k in sprite.order)) { sprite.order[k] = sprite.keys.length; sprite.keys.push(k); } });
        if (!sprite.meta.use) sprite.meta.use = name;
    }

    /* loads(text) -> sprite. Each frame also remembers which source line each
       of its rows came from, so a paint on the canvas can edit the text. */
    function loads(text) {
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        var sprite = { name: 'sprite', palette: { '.': TRANSPARENT.slice() }, keys: ['.'], order: { '.': 0 }, frames: [], meta: {}, notes: {} };
        var mode = null, pending = null, sawUse = false;
        var lines = text.split('\n');
        function flush() {
            if (pending) {
                if (!pending.rows.length) throw new PxaError("frame '" + pending.name + "' has no rows");
                sprite.frames.push(pending);
            }
        }
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/\r$/, ''), stripped = line.trim(), lineno = i + 1;
            if (stripped[0] === '@') {
                var m = /^@(\S+)\s*(.*)$/.exec(stripped), key = m[1].toLowerCase(), val = m[2].trim();
                if (key === 'grid' || key === 'frame') { flush(); pending = { name: val || ('f' + sprite.frames.length), rows: [], lines: [] }; mode = 'grid'; }
                else if (key === 'palette') { flush(); pending = null; mode = 'palette'; }
                else if (key === 'name') sprite.name = val;
                else if (key === 'use') { applyUse(sprite, val); sawUse = true; }
                else if (key === 'scale' || key === 'fps' || key === 'cols' || key === 'gap' || key === 'loop') {
                    if (!/^-?\d+$/.test(val)) throw new PxaError(lineno + ': @' + key + " wants an integer, got '" + val + "'");
                    sprite.meta[key] = parseInt(val, 10);
                }
                else sprite.meta[key] = val;
                continue;
            }
            if (mode === 'grid') {
                if (!stripped || stripped[0] === '#') continue;
                pending.rows.push(line.replace(/\s+$/, '')); pending.lines.push(i);
                continue;
            }
            if (!stripped || stripped[0] === '#' || stripped.slice(0, 2) === '//') continue;
            if (mode === 'palette') {
                var bits = stripped.split(/\s+/), ch = bits[0], tok = bits[1];
                if (bits.length < 2) throw new PxaError(lineno + ": palette line needs '<char> <color>', got '" + stripped + "'");
                if (ch.length !== 1) throw new PxaError(lineno + ": palette key must be one character, got '" + ch + "'");
                try { sprite.palette[ch] = parseColor(tok); } catch (e) { throw new PxaError(lineno + ': ' + e.message); }
                if (!(ch in sprite.order)) { sprite.order[ch] = sprite.keys.length; sprite.keys.push(ch); }
                if (bits.length > 2) sprite.notes[ch] = stripped.replace(/^\S+\s+\S+\s+/, '');
                continue;
            }
            throw new PxaError(lineno + ": unexpected text outside any block: '" + stripped + "'");
        }
        flush();
        if (!sprite.frames.length) throw new PxaError('no @grid or @frame block found');
        if (!sawUse && sprite.keys.length === 1) applyUse(sprite, DEFAULT_PALETTE);
        return sprite;
    }

    function width(f) { return f.rows.length ? f.rows[0].length : 0; }
    function usedKeys(sprite) {
        var used = {};
        sprite.frames.forEach(function (f) { f.rows.forEach(function (r) { for (var i = 0; i < r.length; i++) used[r[i]] = true; }); });
        return used;
    }

    function validate(sprite) {
        var errors = [], warnings = [];
        if (!sprite.frames.length) return { errors: ['sprite has no frames'], warnings: warnings };
        var f0 = sprite.frames[0], w = width(f0), h = f0.rows.length, seen = {};
        if (w === 0) errors.push("frame '" + f0.name + "' has zero width");
        sprite.frames.forEach(function (f) {
            if (seen[f.name]) warnings.push("duplicate frame name '" + f.name + "'");
            seen[f.name] = true;
            if (f.rows.length !== h) errors.push("frame '" + f.name + "' has " + f.rows.length + " rows, frame '" + f0.name + "' has " + h);
            f.rows.forEach(function (row, y) {
                if (row.length !== w) errors.push("frame '" + f.name + "' row " + y + ' is ' + row.length + ' chars, expected ' + w + ": '" + row + "'");
            });
        });
        var undef = {};
        sprite.frames.forEach(function (f) { f.rows.forEach(function (row, y) { for (var x = 0; x < row.length; x++) if (!(row[x] in sprite.palette) && !(row[x] in undef)) undef[row[x]] = [f.name, x, y]; }); });
        Object.keys(undef).sort().forEach(function (ch) { var u = undef[ch]; errors.push("undefined palette key '" + ch + "' (first at frame '" + u[0] + "' x=" + u[1] + ' y=' + u[2] + ')'); });
        if ('#' in sprite.palette) warnings.push("'#' is a palette key; grid rows starting with it are read as comments");
        var used = usedKeys(sprite), unused = Object.keys(sprite.palette).filter(function (k) { return k !== '.' && !used[k]; }).sort();
        if (unused.length) warnings.push('palette keys defined but unused: ' + unused.join(' '));
        return { errors: errors, warnings: warnings };
    }

    function frameOf(sprite, ref) {
        if (ref == null || ref === '') return sprite.frames[0];
        for (var i = 0; i < sprite.frames.length; i++) if (sprite.frames[i].name === ref) return sprite.frames[i];
        var n = parseInt(ref, 10); if (sprite.frames[n]) return sprite.frames[n];
        throw new PxaError("no frame '" + ref + "'");
    }

    /* rasterize(sprite, frame, scale, bg) -> {w, h, data: Uint8ClampedArray RGBA} */
    function rasterize(sprite, f, scale, bg) {
        scale = scale || 1;
        var w = width(f), h = f.rows.length, W = w * scale, H = h * scale, d = new Uint8ClampedArray(W * H * 4);
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
            var c = sprite.palette[f.rows[y][x]] || TRANSPARENT;
            if (c[3] === 0 && bg) c = bg;
            if (c[3] === 0) continue;
            for (var sy = 0; sy < scale; sy++) for (var sx = 0; sx < scale; sx++) {
                var i = ((y * scale + sy) * W + x * scale + sx) * 4;
                d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
            }
        }
        return { w: W, h: H, data: d };
    }

    /* ── Font ───────────────────────────────────────────────────────────── */

    var G = {
        '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 7, 1, 7], '4': [5, 5, 7, 1, 1],
        '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 2, 2, 2], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7],
        A: [7, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [7, 4, 4, 4, 7], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7], F: [7, 4, 6, 4, 4],
        G: [7, 4, 5, 5, 7], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 7], K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7],
        M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [7, 5, 5, 5, 7], P: [7, 5, 7, 4, 4], Q: [7, 5, 5, 7, 1], R: [7, 5, 6, 5, 5],
        S: [7, 4, 7, 1, 7], T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5],
        Y: [5, 5, 2, 2, 2], Z: [7, 1, 2, 4, 7], ' ': [0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 2], ',': [0, 0, 0, 2, 4],
        '-': [0, 0, 7, 0, 0], '+': [0, 2, 7, 2, 0], '*': [5, 2, 5, 0, 0], '=': [0, 7, 0, 7, 0], '/': [1, 1, 2, 4, 4],
        '\\': [4, 4, 2, 1, 1], '#': [5, 7, 5, 7, 5], '@': [7, 5, 7, 4, 7], ':': [0, 2, 0, 2, 0], ';': [0, 2, 0, 2, 4],
        '!': [2, 2, 2, 0, 2], '?': [7, 1, 2, 0, 2], '<': [1, 2, 4, 2, 1], '>': [4, 2, 1, 2, 4], '(': [1, 2, 2, 2, 1],
        ')': [4, 2, 2, 2, 4], '[': [3, 2, 2, 2, 3], ']': [6, 2, 2, 2, 6], '{': [3, 2, 6, 2, 3], '}': [6, 2, 3, 2, 6],
        '_': [0, 0, 0, 0, 7], '|': [2, 2, 2, 2, 2], '~': [0, 3, 7, 6, 0], '^': [2, 5, 0, 0, 0], '&': [6, 6, 7, 5, 7],
        '%': [5, 1, 2, 4, 5], '$': [3, 6, 3, 6, 2], '"': [5, 5, 0, 0, 0], "'": [2, 2, 0, 0, 0], '`': [4, 2, 0, 0, 0]
    };
    var GW = 3, GH = 5, UNKNOWN = [7, 7, 7, 7, 7];
    function glyph(ch) { return G[ch] || G[ch.toUpperCase()] || UNKNOWN; }
    function textWidth(s, scale) { return s.length ? (s.length * (GW + 1) - 1) * scale : 0; }

    /* ── Canvas drawing (render.py) ─────────────────────────────────────── */

    var CHECKER_A = [58, 58, 68, 255], CHECKER_B = [44, 44, 52, 255], BG = [24, 24, 30, 255], INK = [232, 232, 240, 255],
        DIM = [128, 132, 148, 255], GRID_MINOR = [255, 255, 255, 40], GRID_MAJOR = [255, 255, 255, 96], ACCENT = [120, 190, 255, 255];
    function css(c) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] / 255) + ')'; }

    function Painter(ctx) { this.ctx = ctx; }
    Painter.prototype.frect = function (x, y, w, h, c) { this.ctx.fillStyle = css(c); this.ctx.fillRect(x, y, w, h); };
    Painter.prototype.text = function (x, y, s, c, scale) {
        var cx = x; this.ctx.fillStyle = css(c);
        for (var i = 0; i < s.length; i++) {
            var g = glyph(s[i]);
            for (var gy = 0; gy < GH; gy++) for (var gx = 0; gx < GW; gx++)
                if (g[gy] & (1 << (GW - 1 - gx))) this.ctx.fillRect(cx + gx * scale, y + gy * scale, scale, scale);
            cx += (GW + 1) * scale;
        }
        return cx;
    };
    Painter.prototype.checker = function (x, y, w, h, cell) {
        for (var yy = 0; yy < h; yy += cell) for (var xx = 0; xx < w; xx += cell)
            this.frect(x + xx, y + yy, Math.min(cell, w - xx), Math.min(cell, h - yy), ((xx / cell + yy / cell) % 2 === 0) ? CHECKER_A : CHECKER_B);
    };
    Painter.prototype.blit = function (sprite, f, x, y, scale) {
        var r = rasterize(sprite, f, scale);
        var tmp = document.createElement('canvas'); tmp.width = Math.max(1, r.w); tmp.height = Math.max(1, r.h);
        if (r.w && r.h) { tmp.getContext('2d').putImageData(new ImageData(r.data, r.w, r.h), 0, 0); this.ctx.drawImage(tmp, x, y); }
    };

    function autoScale(w, h, target) { return Math.max(1, Math.min(32, Math.floor(target / Math.max(1, Math.max(w, h))))); }

    /* Annotated preview. Returns the geometry so clicks can be mapped back. */
    function renderPreview(canvas, sprite, f, scale) {
        var fs = 2, w = width(f), h = f.rows.length;
        if (!(scale > 0)) scale = Math.max(6, autoScale(w, h, 520));
        var gw = w * scale, gh = h * scale, dw = GW * fs, dh = GH * fs;
        var head = dh + 6, rulerT = dh * 2 + 5, rulerL = dw * 2 + fs + 6, pad = 8, swatch = dh + 2;

        var usedMap = usedKeys(sprite), used = Object.keys(usedMap).filter(function (k) { return k in sprite.palette; }).sort();
        var notes = {};
        if (sprite.meta.use && PALETTES[sprite.meta.use]) { var pn = PALETTES[sprite.meta.use].notes; Object.keys(pn).forEach(function (k) { notes[k] = pn[k]; }); }
        Object.keys(sprite.notes).forEach(function (k) { notes[k] = sprite.notes[k]; });
        var labels = used.map(function (k) { return (notes[k] || colorHex(sprite.palette[k])).slice(0, 16).toUpperCase(); });

        var keyCol = swatch + 4 + textWidth('W', fs) + fs * 2;
        var widest = labels.reduce(function (m, s) { return Math.max(m, textWidth(s, fs)); }, 0);
        var legendW = Math.max(keyCol + widest, textWidth('PALETTE', fs)) + 10;
        var legendH = used.length * (swatch + 3) + dh + 6;

        var cw = pad + rulerL + gw + 14 + legendW + pad, chh = pad + head + rulerT + Math.max(gh, legendH) + pad;
        canvas.width = cw; canvas.height = chh;
        var ctx = canvas.getContext('2d'), p = new Painter(ctx);
        p.frect(0, 0, cw, chh, BG);
        var ox = pad + rulerL, oy = pad + head + rulerT;

        p.text(pad, pad, (sprite.name + ' / ' + f.name + '  ' + w + 'x' + h + '  scale ' + scale).toUpperCase(), ACCENT, fs);
        p.checker(ox, oy, gw, gh, Math.max(4, Math.floor(scale / 2)));
        p.blit(sprite, f, ox, oy, scale);
        for (var x = 0; x <= w; x++) p.frect(ox + x * scale, oy, 1, gh, x % 8 === 0 ? GRID_MAJOR : GRID_MINOR);
        for (var y = 0; y <= h; y++) p.frect(ox, oy + y * scale, gw, 1, y % 8 === 0 ? GRID_MAJOR : GRID_MINOR);

        var step = scale >= dw + 2 ? 1 : 5;
        for (x = 0; x < w; x++) {
            if (x % step) continue;
            var col = x % 8 === 0 ? ACCENT : DIM, lx = ox + x * scale + Math.max(0, Math.floor((scale - dw) / 2)), ly = pad + head;
            if (x >= 10) p.text(lx, ly, String(Math.floor(x / 10)), col, fs);
            p.text(lx, ly + dh + 2, String(x % 10), col, fs);
        }
        for (y = 0; y < h; y++) {
            if (y % step) continue;
            p.text(pad, oy + y * scale + Math.max(0, Math.floor((scale - dh) / 2)), (y < 10 ? ' ' : '') + y, y % 8 === 0 ? ACCENT : DIM, fs);
        }

        var lx2 = ox + gw + 14, ly2 = pad + head;
        p.text(lx2, ly2, 'PALETTE', ACCENT, fs); ly2 += dh + 6;
        used.forEach(function (k, i) {
            var c = sprite.palette[k];
            if (c[3] === 0) p.checker(lx2, ly2, swatch, swatch, Math.max(2, Math.floor(swatch / 2))); else p.frect(lx2, ly2, swatch, swatch, c);
            p.frect(lx2, ly2, swatch, 1, [255, 255, 255, 60]);
            p.text(lx2 + swatch + 4, ly2 + 1, k, INK, fs);
            p.text(lx2 + keyCol, ly2 + 1, labels[i], DIM, fs);
            ly2 += swatch + 3;
        });
        return { ox: ox, oy: oy, scale: scale, w: w, h: h };
    }

    /* Clean view: the sprite on a checker, nothing else. */
    function renderClean(canvas, sprite, f, scale) {
        var w = width(f), h = f.rows.length;
        if (!(scale > 0)) scale = Math.max(4, autoScale(w, h, 520));
        var pad = 8;
        canvas.width = w * scale + pad * 2; canvas.height = h * scale + pad * 2;
        var p = new Painter(canvas.getContext('2d'));
        p.frect(0, 0, canvas.width, canvas.height, BG);
        p.checker(pad, pad, w * scale, h * scale, Math.max(4, Math.floor(scale / 2)));
        p.blit(sprite, f, pad, pad, scale);
        return { ox: pad, oy: pad, scale: scale, w: w, h: h };
    }

    /* ── GIF89a (gif.py) ────────────────────────────────────────────────── */

    function Bits() { this.out = []; this.acc = 0; this.n = 0; }
    Bits.prototype.put = function (code, width) {
        this.acc |= code << this.n; this.n += width;
        while (this.n >= 8) { this.out.push(this.acc & 0xFF); this.acc >>>= 8; this.n -= 8; }
    };
    Bits.prototype.finish = function () { if (this.n) { this.out.push(this.acc & 0xFF); this.acc = 0; this.n = 0; } return this.out; };
    function subBlocks(data, out) {
        for (var i = 0; i < data.length; i += 255) { var part = data.slice(i, i + 255); out.push(part.length); out.push.apply(out, part); }
        out.push(0);
    }
    function encodeIndices(idx, minCode, out) {
        var clear = 1 << minCode, eoi = clear + 1, width = minCode + 1, budget = (1 << width) - (eoi + 1) - 2;
        var bits = new Bits(); bits.put(clear, width); var since = 0;
        for (var i = 0; i < idx.length; i++) {
            if (since >= budget) { bits.put(clear, width); since = 0; }
            bits.put(idx[i], width); since++;
        }
        bits.put(eoi, width);
        subBlocks(bits.finish(), out);
    }
    function u16(out, v) { out.push(v & 0xFF, (v >> 8) & 0xFF); }
    function writeGif(w, h, frames, delayCs, loop) {
        var order = [[0, 0, 0, 0]], seen = { '0,0,0,0': 0 }, idxFrames = [];
        frames.forEach(function (d) {
            var idx = new Uint8Array(w * h);
            for (var p = 0; p < w * h; p++) {
                var i = p * 4, key = d[i + 3] < 128 ? '0,0,0,0' : d[i] + ',' + d[i + 1] + ',' + d[i + 2] + ',255';
                if (!(key in seen)) { seen[key] = order.length; order.push(key === '0,0,0,0' ? [0, 0, 0, 0] : [d[i], d[i + 1], d[i + 2], 255]); }
                idx[p] = seen[key];
            }
            idxFrames.push(idx);
        });
        if (order.length > 256) throw new Error('GIF supports at most 256 colors, sprite uses ' + order.length);
        var bits = Math.max(1, Math.ceil(Math.log2(order.length))), tableSize = 1 << bits, minCode = Math.max(2, bits);
        var out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; u16(out, w); u16(out, h);
        out.push(0xF0 | (bits - 1), 0, 0);
        order.forEach(function (c) { out.push(c[0], c[1], c[2]); });
        for (var k = order.length; k < tableSize; k++) out.push(0, 0, 0);
        out.push(0x21, 0xFF, 0x0B); 'NETSCAPE2.0'.split('').forEach(function (ch) { out.push(ch.charCodeAt(0)); }); out.push(3, 1); u16(out, loop || 0); out.push(0);
        var delay = Math.max(1, Math.round(delayCs));
        idxFrames.forEach(function (idx) {
            out.push(0x21, 0xF9, 0x04, 0x09); u16(out, delay); out.push(0, 0);
            out.push(0x2C); u16(out, 0); u16(out, 0); u16(out, w); u16(out, h); out.push(0);
            out.push(minCode);
            encodeIndices(idx, minCode, out);
        });
        out.push(0x3B);
        return new Blob([new Uint8Array(out)], { type: 'image/gif' });
    }

    /* ── The editor ─────────────────────────────────────────────────────── */

    var KNIGHT = [
        '@name  knight', '@use   chr16', '@scale 12', '@fps   6', '', '@frame idle',
        '................', '.....KKKKKK.....', '....KMMMMMMK....', '....KMMMMMMK....', '....KMeeeeMK....',
        '....KM2222MK....', '.....KMMMMK.....', '......K22K......', '...KKK4444KKK...', '..KM4K5555K4MK..',
        '..KM4K5555K4MK..', '..KMK.5665.KMK..', '...K..5665..K...', '...K2K5555K2K...', '....K.4444.K....',
        '......4444......', '.....K44K44K....', '.....K4K.K4K....', '.....K4K.K4K....', '....KKKK.KKKK...', ''
    ].join('\n');
    var BLANK = '@name  sprite\n@use   chr16\n@scale 12\n\n@frame idle\n' + new Array(17).join('................\n');

    var $ = function (id) { return document.getElementById(id); };
    var root = $('forge'); if (!root) return;
    var ta = $('fgText'), canvas = $('fgCanvas'), status = $('fgStatus'), framesEl = $('fgFrames'), keysEl = $('fgKeys'), pos = $('fgPos');
    var exSel = $('fgExample'), viewSel = $('fgView'), scaleSel = $('fgScale'), playBtn = $('fgPlay');
    var STORE = 'isaiart.pixelforge.text';

    var sprite = null, error = null, frameIx = 0, key = 'K', geo = null, playTimer = null, parseTimer = null;

    function store(v) { try { localStorage.setItem(STORE, v); } catch (e) {} }

    function parse() {
        var text = ta.value;
        try { sprite = loads(text); error = null; }
        catch (e) { sprite = null; error = e.message || String(e); }
        if (sprite && frameIx >= sprite.frames.length) frameIx = 0;
        if (sprite && !(key in sprite.palette)) key = sprite.keys[sprite.keys.length > 1 ? 1 : 0];
        draw(); drawFrames(); drawKeys(); drawStatus();
        store(text);
    }
    function scheduleParse() { clearTimeout(parseTimer); parseTimer = setTimeout(parse, 90); }

    function draw() {
        if (!sprite) { if (geo) { canvas.getContext('2d').fillStyle = 'rgba(24,24,30,.5)'; canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height); } return; }
        var f = sprite.frames[frameIx], sc = parseInt(scaleSel.value, 10) || 0;
        try { geo = (viewSel.value === 'clean' ? renderClean : renderPreview)(canvas, sprite, f, sc); }
        catch (e) { error = e.message; sprite = null; drawStatus(); }
    }
    function drawFrames() {
        framesEl.innerHTML = '';
        if (!sprite || sprite.frames.length < 2) { playBtn.hidden = true; return; }
        playBtn.hidden = false;
        sprite.frames.forEach(function (f, i) {
            var b = document.createElement('button'); b.type = 'button'; b.className = 'fkey' + (i === frameIx ? ' on' : ''); b.textContent = f.name;
            b.addEventListener('click', function () { stopPlay(); frameIx = i; draw(); drawFrames(); });
            framesEl.appendChild(b);
        });
    }
    function drawKeys() {
        keysEl.innerHTML = '';
        if (!sprite) return;
        var used = usedKeys(sprite);
        sprite.keys.forEach(function (k) {
            var c = sprite.palette[k], b = document.createElement('button'); b.type = 'button';
            b.className = 'swatch' + (k === key ? ' on' : '') + (used[k] ? '' : ' unused') + (c[3] === 0 ? ' clear' : '');
            b.title = (k === '.' ? 'transparent' : (sprite.notes[k] || (sprite.meta.use && PALETTES[sprite.meta.use] && PALETTES[sprite.meta.use].notes[k]) || colorHex(c)));
            if (c[3]) b.style.background = colorHex(c);
            var lum = (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000;
            b.style.color = (c[3] === 0 || lum > 150) ? '#000' : '#fff';
            b.textContent = k;
            b.addEventListener('click', function () { key = k; drawKeys(); });
            keysEl.appendChild(b);
        });
    }
    function drawStatus() {
        status.className = 'forge-status';
        if (!sprite) { status.classList.add('bad'); status.textContent = error; return; }
        var v = validate(sprite), f = sprite.frames[frameIx];
        var head = sprite.name + ' · ' + width(f) + '×' + f.rows.length + ' · ' + sprite.frames.length + (sprite.frames.length === 1 ? ' frame' : ' frames') + ' · ' + sprite.keys.filter(function (k) { return k !== '.'; }).length + ' keys';
        if (v.errors.length) { status.classList.add('bad'); status.textContent = head + '\n' + v.errors.join('\n'); }
        else if (v.warnings.length) { status.classList.add('warn'); status.textContent = head + '\n' + v.warnings.join('\n'); }
        else status.textContent = head + ' · valid';
    }

    /* Painting on the canvas edits the source line for that row. */
    function cellAt(e) {
        if (!sprite || !geo) return null;
        var r = canvas.getBoundingClientRect(), sx = canvas.width / r.width, sy = canvas.height / r.height;
        var px = (e.clientX - r.left) * sx, py = (e.clientY - r.top) * sy;
        var x = Math.floor((px - geo.ox) / geo.scale), y = Math.floor((py - geo.oy) / geo.scale);
        if (x < 0 || y < 0 || x >= geo.w || y >= geo.h) return null;
        return { x: x, y: y };
    }
    function setCell(x, y, ch) {
        var f = sprite.frames[frameIx], row = f.rows[y];
        if (x >= row.length || row[x] === ch) return false;
        var lines = ta.value.split('\n'), li = f.lines[y], line = lines[li];
        var lead = line.length - line.replace(/^\s+/, '').length;   /* rows keep any indent */
        var at = lead + x;
        lines[li] = line.slice(0, at) + ch + line.slice(at + 1);
        f.rows[y] = row.slice(0, x) + ch + row.slice(x + 1);
        var top = ta.scrollTop, s0 = ta.selectionStart, s1 = ta.selectionEnd;
        ta.value = lines.join('\n'); ta.scrollTop = top;
        try { ta.setSelectionRange(s0, s1); } catch (e) {}
        return true;
    }
    var painting = false, paintKey = null;
    canvas.addEventListener('pointerdown', function (e) {
        var c = cellAt(e); if (!c) return;
        e.preventDefault(); stopPlay();
        if (e.button === 2 || e.altKey) { key = sprite.frames[frameIx].rows[c.y][c.x] || '.'; drawKeys(); return; }
        painting = true; paintKey = (e.button === 1 || e.shiftKey) ? '.' : key;
        canvas.setPointerCapture(e.pointerId);
        if (setCell(c.x, c.y, paintKey)) { draw(); drawStatus(); store(ta.value); }
    });
    canvas.addEventListener('pointermove', function (e) {
        var c = cellAt(e);
        pos.textContent = c ? ('x ' + c.x + ', y ' + c.y + ' · ' + (sprite.frames[frameIx].rows[c.y][c.x] || '.')) : '—';
        if (painting && c && setCell(c.x, c.y, paintKey)) { draw(); drawStatus(); store(ta.value); }
    });
    window.addEventListener('pointerup', function () { if (painting) { painting = false; drawKeys(); } });
    canvas.addEventListener('pointerleave', function () { if (!painting) pos.textContent = '—'; });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    /* Animation */
    function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; playBtn.textContent = 'Play'; playBtn.setAttribute('aria-pressed', 'false'); } }
    playBtn.addEventListener('click', function () {
        if (playTimer) { stopPlay(); return; }
        if (!sprite || sprite.frames.length < 2) return;
        var fps = sprite.meta.fps > 0 ? sprite.meta.fps : 8;
        playBtn.textContent = 'Stop'; playBtn.setAttribute('aria-pressed', 'true');
        playTimer = setInterval(function () { if (!sprite) return; frameIx = (frameIx + 1) % sprite.frames.length; draw(); drawFrames(); }, 1000 / fps);
    });

    ta.addEventListener('input', scheduleParse);
    viewSel.addEventListener('change', draw);
    scaleSel.addEventListener('change', draw);
    exSel.addEventListener('change', function () {
        var v = exSel.value; if (!v) return;
        stopPlay(); frameIx = 0;
        if (v === 'blank') { ta.value = BLANK; parse(); return; }
        if (v === 'knight') { ta.value = KNIGHT; parse(); return; }
        fetch('files/examples/' + v + '.pxa').then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
            .then(function (t) { ta.value = t; parse(); })
            .catch(function () { status.className = 'forge-status bad'; status.textContent = 'Could not load ' + v + '.pxa'; });
    });

    /* Export */
    function save(blob, name) {
        var url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }
    function outScale() { var s = parseInt(scaleSel.value, 10); return s > 0 ? s : (sprite.meta.scale > 0 ? sprite.meta.scale : 8); }
    function toPng(w, h, data, name) {
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
        c.toBlob(function (b) { save(b, name); }, 'image/png');
    }
    $('fgPng').addEventListener('click', function () {
        if (!sprite) return;
        var r = rasterize(sprite, sprite.frames[frameIx], outScale());
        toPng(r.w, r.h, r.data, sprite.name + '-' + sprite.frames[frameIx].name + '.png');
    });
    $('fgSheet').addEventListener('click', function () {
        if (!sprite) return;
        var sc = outScale(), fw = width(sprite.frames[0]) * sc, fh = sprite.frames[0].rows.length * sc, n = sprite.frames.length;
        var c = document.createElement('canvas'); c.width = fw * n; c.height = fh; var ctx = c.getContext('2d');
        sprite.frames.forEach(function (f, i) { var r = rasterize(sprite, f, sc); if (r.w && r.h) ctx.putImageData(new ImageData(r.data, r.w, r.h), i * fw, 0); });
        c.toBlob(function (b) { save(b, sprite.name + '-sheet.png'); }, 'image/png');
    });
    $('fgGif').addEventListener('click', function () {
        if (!sprite) return;
        var sc = outScale(), fps = sprite.meta.fps > 0 ? sprite.meta.fps : 8, w = width(sprite.frames[0]) * sc, h = sprite.frames[0].rows.length * sc;
        try {
            var frames = sprite.frames.map(function (f) { return rasterize(sprite, f, sc).data; });
            save(writeGif(w, h, frames, Math.max(2, Math.round(100 / fps)), sprite.meta.loop || 0), sprite.name + '.gif');
        } catch (e) { status.className = 'forge-status bad'; status.textContent = e.message; }
    });
    $('fgPxa').addEventListener('click', function () {
        save(new Blob([ta.value], { type: 'text/plain' }), ((sprite && sprite.name) || 'sprite') + '.pxa');
    });
    $('fgCopy').addEventListener('click', function () {
        var b = this, label = b.textContent;
        function done(ok) { b.textContent = ok ? 'Copied' : 'Select and copy'; setTimeout(function () { b.textContent = label; }, 1400); }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(function () { done(true); }, function () { done(false); });
        else { ta.select(); done(false); }
    });

    /* Boot: last text, else the knight. */
    var saved = null; try { saved = localStorage.getItem(STORE); } catch (e) {}
    ta.value = saved || KNIGHT;
    if (!saved) exSel.value = 'knight';
    parse();

    window.pixelforge = { loads: loads, validate: validate, rasterize: rasterize, writeGif: writeGif, PALETTES: PALETTES };
})();
