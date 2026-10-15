/* Coloring-page worker. Holds decoded sources by key, each with its own stage
   cache, so dragging a slider only re-runs the stages that slider feeds. The
   page keeps at most the current image and the one being exported resident;
   everything else lives as a File on the main thread until it is needed. */
importScripts('lineart.js?v=2');

var store = {};

self.onmessage = function (e) {
    var m = e.data;
    if (m.type === 'load') {
        store[m.key] = { rgba: new Uint8ClampedArray(m.buf), w: m.w, h: m.h, cache: {} };
        return;
    }
    if (m.type === 'drop') {
        delete store[m.key];
        return;
    }
    if (m.type === 'run') {
        var s = store[m.key];
        if (!s) { self.postMessage({ type: 'error', id: m.id, key: m.key, msg: 'NOT LOADED' }); return; }
        try {
            var r = LINEART.run(s.cache, s.rgba, s.w, s.h, m.opts);
            var msg = { type: 'result', id: m.id, key: m.key, gray: r.gray.buffer, geo: r.geo,
                        stats: r.stats, black: r.black, ms: r.ms };
            var xfer = [r.gray.buffer];
            if (m.diag) {
                var d = LINEART.diagnostic(s.cache);
                msg.diag = d.buffer; xfer.push(d.buffer);
            }
            self.postMessage(msg, xfer);
        } catch (err) {
            self.postMessage({ type: 'error', id: m.id, key: m.key, msg: String(err && err.message || err) });
        }
    }
};
