/* ============================================================================
   Encoders for print: greyscale PNG with a real DPI, multi-page PDF, and a
   stored ZIP for batches.

   Canvas toBlob would give a PNG, but an RGBA one with no resolution in it —
   four times the data it needs, and every layout program opens it at 72 DPI,
   so a 2550 × 3300 page arrives as a 35-inch poster. Writing the file here
   means one grey channel (or one BIT, when the page is pure black and white:
   a 300 DPI letter page drops from ~8 MB raw to ~1 MB), plus a pHYs chunk so
   the file says 300 DPI to whatever opens it.

   Compression is the browser's own DEFLATE via CompressionStream, whose
   'deflate' format is zlib-wrapped — exactly what both PNG IDAT and PDF
   /FlateDecode expect, so one call serves both.
   ========================================================================= */
(function (root) {
    'use strict';

    var CRC = (function () {
        var t = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(bytes, start, end, seed) {
        var c = seed == null ? 0xFFFFFFFF : seed;
        for (var i = start || 0, e = end == null ? bytes.length : end; i < e; i++) {
            c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        }
        return c;
    }

    function hasDeflate() { return typeof CompressionStream === 'function'; }

    function deflate(u8) {
        var cs = new CompressionStream('deflate');
        var stream = new Blob([u8]).stream().pipeThrough(cs);
        return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }

    function isBilevel(gray) {
        for (var i = 0; i < gray.length; i++) { var v = gray[i]; if (v !== 0 && v !== 255) return false; }
        return true;
    }

    /* Rows packed MSB-first, 1 = white. PNG greyscale and PDF DeviceGray agree
       on that, which is why one packer serves both. `filterByte` inserts the
       PNG per-row filter byte (0, none). */
    function packRows(gray, w, h, bits, filterByte) {
        var rb = bits === 1 ? (w + 7) >> 3 : w;
        var stride = rb + (filterByte ? 1 : 0);
        var out = new Uint8Array(stride * h);
        for (var y = 0; y < h; y++) {
            var o = y * stride + (filterByte ? 1 : 0), r = y * w;
            if (bits === 8) { out.set(gray.subarray(r, r + w), o); continue; }
            for (var x = 0; x < w; x += 8) {
                var byte = 0, lim = Math.min(8, w - x);
                for (var b = 0; b < lim; b++) if (gray[r + x + b] >= 128) byte |= 0x80 >> b;
                /* Pad bits past the edge white, so a reader that ignores the
                   width shows paper rather than a black sliver. */
                if (lim < 8) byte |= (0xFF >> lim);
                out[o + (x >> 3)] = byte;
            }
        }
        return out;
    }

    function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }

    function chunk(type, data) {
        var len = data.length;
        var buf = new Uint8Array(12 + len);
        buf.set(u32(len), 0);
        for (var i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i);
        buf.set(data, 8);
        var c = crc32(buf, 4, 8 + len) ^ 0xFFFFFFFF;
        buf.set(u32(c >>> 0), 8 + len);
        return buf;
    }

    function physData(dpi) {
        var ppm = Math.round(dpi / 0.0254);
        return new Uint8Array([].concat(u32(ppm), u32(ppm), [1]));
    }

    /* → Promise<Blob> */
    function png(gray, w, h, dpi) {
        var bits = isBilevel(gray) ? 1 : 8;
        if (!hasDeflate()) return pngViaCanvas(gray, w, h, dpi);
        return deflate(packRows(gray, w, h, bits, true)).then(function (z) {
            var ihdr = new Uint8Array([].concat(u32(w), u32(h), [bits, 0, 0, 0, 0]));
            return new Blob([
                new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
                chunk('IHDR', ihdr),
                chunk('pHYs', physData(dpi)),
                chunk('IDAT', z),
                chunk('IEND', new Uint8Array(0))
            ], { type: 'image/png' });
        });
    }

    /* Old browsers: let the canvas encode, then splice the pHYs chunk in
       straight after IHDR (always the first chunk, always 25 bytes). */
    function pngViaCanvas(gray, w, h, dpi) {
        return new Promise(function (resolve) {
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            var cx = c.getContext('2d');
            var id = cx.createImageData(w, h), d = id.data;
            for (var i = 0, j = 0; i < gray.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = gray[i]; d[j + 3] = 255; }
            cx.putImageData(id, 0, 0);
            c.toBlob(function (blob) {
                blob.arrayBuffer().then(function (ab) {
                    var src = new Uint8Array(ab), at = 33;
                    resolve(new Blob([src.subarray(0, at), chunk('pHYs', physData(dpi)), src.subarray(at)], { type: 'image/png' }));
                });
            }, 'image/png');
        });
    }

    /* ── PDF ─────────────────────────────────────────────────────────────────
       One image per page. Pages are sized from the geometry: a FULL PAGE
       render is the sheet exactly; an ART ONLY render is placed at its true
       printed size in the middle of the sheet it was fitted to, so the PDF is
       always a real page size a printer or KDP will accept. */
    function PdfBuilder() {
        this.parts = [];
        this.offsets = [];
        this.pos = 0;
        this.pageIds = [];
        this.nextId = 3;               /* 1 catalog, 2 page tree */
        this.enc = new TextEncoder();
        this.write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    }
    PdfBuilder.prototype.write = function (s) {
        var b = typeof s === 'string' ? this.enc.encode(s) : s;
        this.parts.push(b); this.pos += b.length;
    };
    PdfBuilder.prototype.obj = function (id, body, stream) {
        this.offsets[id] = this.pos;
        this.write(id + ' 0 obj\n' + body);
        if (stream) { this.write('\nstream\n'); this.write(stream); this.write('\nendstream'); }
        this.write('\nendobj\n');
    };
    /* → Promise */
    PdfBuilder.prototype.addPage = function (gray, geo) {
        var self = this;
        var bits = isBilevel(gray) ? 1 : 8;
        var pw = geo.pw, ph = geo.ph;
        var ptW, ptH, drawW, drawH, dx, dy;
        var pxToPt = 72 / geo.dpi;
        if (geo.sheetW && (pw !== Math.round(geo.sheetW * geo.dpi) || ph !== Math.round(geo.sheetH * geo.dpi))) {
            ptW = geo.sheetW * 72; ptH = geo.sheetH * 72;
            drawW = pw * pxToPt; drawH = ph * pxToPt;
            dx = (ptW - drawW) / 2; dy = (ptH - drawH) / 2;
        } else {
            ptW = drawW = pw * pxToPt; ptH = drawH = ph * pxToPt; dx = dy = 0;
        }
        var raw = packRows(gray, pw, ph, bits, false);
        return deflate(raw).then(function (z) {
            var pageId = self.nextId++, contId = self.nextId++, imgId = self.nextId++;
            var f = function (n) { return (Math.round(n * 1000) / 1000).toString(); };
            var content = self.enc.encode('q ' + f(drawW) + ' 0 0 ' + f(drawH) + ' ' + f(dx) + ' ' + f(dy) + ' cm /Im0 Do Q');
            self.obj(pageId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(ptW) + ' ' + f(ptH) + '] ' +
                     '/Resources << /XObject << /Im0 ' + imgId + ' 0 R >> >> /Contents ' + contId + ' 0 R >>');
            self.obj(contId, '<< /Length ' + content.length + ' >>', content);
            self.obj(imgId, '<< /Type /XObject /Subtype /Image /Width ' + pw + ' /Height ' + ph +
                     ' /ColorSpace /DeviceGray /BitsPerComponent ' + bits +
                     ' /Filter /FlateDecode /Length ' + z.length + ' >>', z);
            self.pageIds.push(pageId);
        });
    };
    /* A full-colour page from JPEG bytes, embedded as-is: PDF's /DCTDecode
       IS baseline JPEG, so the file the canvas wrote goes in untouched — no
       re-encode, no second generation of compression artefacts. The image
       fills the page. Synchronous; the caller already has the bytes. */
    PdfBuilder.prototype.addJpegPage = function (jpeg, pxW, pxH, ptW, ptH) {
        var pageId = this.nextId++, contId = this.nextId++, imgId = this.nextId++;
        var f = function (n) { return (Math.round(n * 1000) / 1000).toString(); };
        var content = this.enc.encode('q ' + f(ptW) + ' 0 0 ' + f(ptH) + ' 0 0 cm /Im0 Do Q');
        this.obj(pageId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(ptW) + ' ' + f(ptH) + '] ' +
                 '/Resources << /XObject << /Im0 ' + imgId + ' 0 R >> >> /Contents ' + contId + ' 0 R >>');
        this.obj(contId, '<< /Length ' + content.length + ' >>', content);
        this.obj(imgId, '<< /Type /XObject /Subtype /Image /Width ' + pxW + ' /Height ' + pxH +
                 ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>', jpeg);
        this.pageIds.push(pageId);
    };

    PdfBuilder.prototype.finish = function () {
        var kids = this.pageIds.map(function (id) { return id + ' 0 R'; }).join(' ');
        this.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
        this.obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + this.pageIds.length + ' >>');
        var xref = this.pos, n = this.nextId;
        var s = 'xref\n0 ' + n + '\n0000000000 65535 f \n';
        for (var i = 1; i < n; i++) s += ('0000000000' + (this.offsets[i] || 0)).slice(-10) + ' 00000 n \n';
        s += 'trailer\n<< /Size ' + n + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
        this.write(s);
        return new Blob(this.parts, { type: 'application/pdf' });
    };

    /* ── ZIP (stored) ────────────────────────────────────────────────────────
       No compression: PNG is already deflated, and a second pass buys a
       percent or two for real CPU. Stored entries only need a CRC. */
    function ZipBuilder() { this.parts = []; this.central = []; this.pos = 0; this.enc = new TextEncoder(); this.names = {}; }
    ZipBuilder.prototype.add = function (name, bytes) {
        /* Two sources called "page.png" must not overwrite each other. */
        var base = name, n = 2;
        while (this.names[name]) name = base.replace(/(\.[^.]+)?$/, '-' + (n++) + '$1');
        this.names[name] = 1;
        var nb = this.enc.encode(name);
        var crc = (crc32(bytes) ^ 0xFFFFFFFF) >>> 0;
        var d = new Date();
        var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
        var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        var hdr = new DataView(new ArrayBuffer(30));
        hdr.setUint32(0, 0x04034b50, true); hdr.setUint16(4, 20, true); hdr.setUint16(6, 0x0800, true);
        hdr.setUint16(8, 0, true); hdr.setUint16(10, time, true); hdr.setUint16(12, date, true);
        hdr.setUint32(14, crc, true); hdr.setUint32(18, bytes.length, true); hdr.setUint32(22, bytes.length, true);
        hdr.setUint16(26, nb.length, true); hdr.setUint16(28, 0, true);
        var cen = new DataView(new ArrayBuffer(46));
        cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
        cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true); cen.setUint16(12, time, true);
        cen.setUint16(14, date, true); cen.setUint32(16, crc, true); cen.setUint32(20, bytes.length, true);
        cen.setUint32(24, bytes.length, true); cen.setUint16(28, nb.length, true);
        cen.setUint32(42, this.pos, true);
        this.central.push(new Uint8Array(cen.buffer), nb);
        this.parts.push(new Uint8Array(hdr.buffer), nb, bytes);
        this.pos += 30 + nb.length + bytes.length;
    };
    ZipBuilder.prototype.finish = function () {
        var start = this.pos, size = 0, count = this.central.length / 2;
        this.central.forEach(function (b) { size += b.length; });
        var end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, count, true); end.setUint16(10, count, true);
        end.setUint32(12, size, true); end.setUint32(16, start, true);
        return new Blob(this.parts.concat(this.central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
    };

    /* ── Colour canvases (covers) ────────────────────────────────────────── */

    function toBlob(canvas, type, q) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('encode')); }, type, q);
        });
    }

    /* RGB PNG with its DPI written in. */
    function canvasPng(canvas, dpi) {
        return toBlob(canvas, 'image/png').then(function (blob) {
            return blob.arrayBuffer().then(function (ab) {
                var src = new Uint8Array(ab), at = 33;
                return new Blob([src.subarray(0, at), chunk('pHYs', physData(dpi)), src.subarray(at)], { type: 'image/png' });
            });
        });
    }

    /* JPEG with the JFIF density set to the real DPI. The canvas writes a
       JFIF header with "1:1 aspect, no units", which most programs read as
       72 DPI; patching units to dots-per-inch fixes that in five bytes. */
    function canvasJpeg(canvas, dpi, q) {
        return toBlob(canvas, 'image/jpeg', q || 0.95).then(function (blob) {
            return blob.arrayBuffer().then(function (ab) {
                var u = new Uint8Array(ab);
                if (u[2] === 0xFF && u[3] === 0xE0 && u[6] === 0x4A && u[7] === 0x46 && u[8] === 0x49 && u[9] === 0x46) {
                    u[13] = 1; u[14] = dpi >> 8; u[15] = dpi & 255; u[16] = dpi >> 8; u[17] = dpi & 255;
                }
                return u;
            });
        });
    }

    root.PRINTENC = root.CBENC = {
        png: png, Pdf: PdfBuilder, Zip: ZipBuilder, isBilevel: isBilevel,
        canvasPng: canvasPng, canvasJpeg: canvasJpeg
    };
})(window);
