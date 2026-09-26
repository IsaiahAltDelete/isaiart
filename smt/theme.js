/* ═══════════════════════════════════════════════════════════════════════════
   SMT SHARED THEME ENGINE
   Pairs with theme.css. Used by /transfer and /flow.

   Owns:
     • the persisted selection (one key, shared by both apps)
     • the theme picker UI (built from THEMES[], so the two apps can never
       drift out of sync again — add a theme once, both get it)
     • every animated background (matrix, goop metaballs, pixel scene, …)
     • the Retro Windows shell and the Newsroom ticker chrome
     • motion helpers the apps call: countUp, renderMeter, tilt, ripple

   Usage:
     SMTTheme.init({
       app: 'transfer',
       title: 'Transfer Rate Tracker',
       emoji: '📱',
       sibling: { label: 'Call Flow Tracker', href: 'https://isaiart.com/flow' },
       legacy: { style: 'trt-style', color: 'trt-color', mode: 'trt-mode' },
       onChange: (s) => app.render()
     });
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

var HUB = 'https://isaiart.com/smt';
var STORE = 'smt-theme';                       // shared across both apps
var reduceMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Theme catalogue ─────────────────────────────────────────────────────
   `preview` is the little swatch drawn in the picker. Order = grid order. */
var THEMES = [
    { id:'default',    name:'Default',      preview:'<div style="position:absolute;inset:0;background:linear-gradient(135deg,#0B0C10,#1B2130)"></div><div style="position:absolute;bottom:5px;left:5px;right:5px;height:5px;background:#F59E0B;opacity:.75;border-radius:2px"></div>' },
    { id:'glass',      name:'Glassmorphic', preview:'<div style="position:absolute;inset:0;background:linear-gradient(135deg,#6366F1,#06B6D4,#A855F7)"></div><div style="position:absolute;inset:5px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.32);border-radius:3px"></div>' },
    { id:'goop',       name:'Goop',         preview:'<div style="position:absolute;inset:0;background:linear-gradient(135deg,#12103A,#241A55)"></div><div style="position:absolute;width:19px;height:19px;border-radius:50%;background:#7C5CFF;top:4px;left:5px;filter:blur(.4px)"></div><div style="position:absolute;width:15px;height:15px;border-radius:50%;background:#22D3EE;top:12px;left:16px;filter:blur(.4px)"></div><div style="position:absolute;width:10px;height:10px;border-radius:50%;background:#F472B6;top:5px;left:32px;filter:blur(.4px)"></div>' },
    { id:'neumorphic', name:'Neumorphic',   preview:'<div style="position:absolute;inset:0;background:#E2E7EE"></div><div style="position:absolute;inset:6px;border-radius:5px;background:#E2E7EE;box-shadow:3px 3px 6px rgba(163,177,198,.75),-3px -3px 6px #fff"></div>' },
    { id:'minimal',    name:'Minimal',      preview:'<div style="position:absolute;inset:0;background:#fff;border:1px solid #DDD"></div><div style="position:absolute;top:8px;left:7px;right:18px;height:1px;background:#BBB"></div><div style="position:absolute;top:14px;left:7px;right:26px;height:1px;background:#DDD"></div><div style="position:absolute;bottom:7px;left:7px;width:14px;height:2px;background:#111"></div>' },
    { id:'blueprint',  name:'Blueprint',    preview:'<div style="position:absolute;inset:0;background:#0A1A2F;background-image:linear-gradient(rgba(126,190,255,.3) 1px,transparent 1px),linear-gradient(90deg,rgba(126,190,255,.3) 1px,transparent 1px);background-size:7px 7px"></div><div style="position:absolute;inset:7px;border:1px solid #7EBEFF"></div>' },
    { id:'cyberpunk',  name:'Cyberpunk',    preview:'<div style="position:absolute;inset:0;background:#07090A;background-image:linear-gradient(rgba(51,255,102,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(51,255,102,.16) 1px,transparent 1px);background-size:8px 8px;border:2px solid #33FF66"></div><div style="position:absolute;bottom:4px;left:4px;right:4px;height:3px;background:#33FF66;box-shadow:0 0 5px #33FF66"></div>' },
    { id:'pixelart',   name:'Pixel Art',    preview:'<div style="position:absolute;inset:0;background:#1A1C2C;border:3px solid #6B6BAE"></div><div style="position:absolute;top:4px;left:4px;width:5px;height:5px;background:#FFA300"></div><div style="position:absolute;top:4px;left:11px;width:5px;height:5px;background:#FFF1E8"></div><div style="position:absolute;bottom:4px;left:4px;width:6px;height:6px;background:#00E436"></div><div style="position:absolute;bottom:4px;left:13px;width:6px;height:6px;background:#29ADFF"></div><div style="position:absolute;bottom:4px;right:4px;width:6px;height:6px;background:#FF77A8"></div>' },
    { id:'retro',      name:'Retro Win',    preview:'<div style="position:absolute;inset:0;background:#008080"></div><div style="position:absolute;top:4px;left:4px;right:4px;bottom:9px;background:#C0C0C0;box-shadow:inset -1px -1px 0 #000,inset 1px 1px 0 #fff"></div><div style="position:absolute;top:5px;left:5px;right:5px;height:6px;background:#000080"></div><div style="position:absolute;bottom:0;left:0;right:0;height:7px;background:#C0C0C0;box-shadow:inset 0 1px 0 #fff"></div><div style="position:absolute;bottom:1px;left:1px;width:11px;height:5px;background:#C0C0C0;box-shadow:inset -1px -1px 0 #000,inset 1px 1px 0 #fff"></div>' },
    { id:'medieval',   name:'Medieval',     preview:'<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 30%,#A87A3A,#3A2410)"></div><div style="position:absolute;inset:3px;background:#F4E7C4;border:1px solid #9A6A32"></div><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:#8A5F14">&#9876;</div>' },
    { id:'brutalist',  name:'Brutalist',    preview:'<div style="position:absolute;inset:0;background:#E8E8E0;border:3px solid #0A0A0A"></div><div style="position:absolute;top:4px;left:4px;right:4px;height:7px;background:#FF2D2D"></div><div style="position:absolute;bottom:5px;left:4px;right:12px;height:3px;background:#0A0A0A"></div>' },
    { id:'newsroom',   name:'Newsroom',     preview:'<div style="position:absolute;inset:0;background:#0B1220"></div><div style="position:absolute;top:0;left:0;right:0;height:9px;background:#D7141A"></div><div style="position:absolute;top:13px;left:4px;right:10px;height:2px;background:rgba(255,255,255,.65)"></div><div style="position:absolute;top:18px;left:4px;right:20px;height:2px;background:rgba(255,255,255,.35)"></div><div style="position:absolute;bottom:0;left:0;right:0;height:8px;background:#101B2C;border-top:1px solid rgba(255,255,255,.25)"></div>' }
];

var COLORS = [
    /* Signature is the default: every style falls back to its own identity —
       newsroom red, cyanotype blue, phosphor green, Win95 teal, candlelit
       gold — instead of one accent being forced across all twelve.
       Mono is then just another dot, for when you want it greyscale. */
    { id:'auto',   title:'Signature', swatch:'conic-gradient(from 210deg,#D7141A,#E8820C,#C8962A,#33FF66,#7EBEFF,#818CF8,#F472B6,#D7141A)' },
    { id:'dark',   title:'Mono',    swatch:'linear-gradient(135deg,#FFFFFF 0%,#FFFFFF 48%,#141414 52%,#141414 100%)' },
    { id:'orange', title:'Amber',   swatch:'linear-gradient(135deg,#B45309,#F59E0B)' },
    { id:'white',  title:'Indigo',  swatch:'linear-gradient(135deg,#4338CA,#818CF8)' },
    { id:'blue',   title:'Sky',     swatch:'linear-gradient(135deg,#0369A1,#38BDF8)' },
    { id:'green',  title:'Emerald', swatch:'linear-gradient(135deg,#047857,#34D399)' },
    { id:'pink',   title:'Pink',    swatch:'linear-gradient(135deg,#9D174D,#F472B6)' }
];

var VALID_STYLES = THEMES.map(function (t) { return t.id; });
var VALID_COLORS = COLORS.map(function (c) { return c.id; });

var state = { style:'default', color:'auto', mode:'dark' };
var cfg = {};
var html = document.documentElement;

/* ── tiny DOM helper ──────────────────────────────────────────────────── */
function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else if (k === 'style') n.setAttribute('style', attrs[k]);
        else if (k.slice(0,2) === 'on') { if (attrs[k]) n.addEventListener(k.slice(2), attrs[k]); }
        else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
}
function $(id) { return document.getElementById(id); }
function raf(fn) { return global.requestAnimationFrame(fn); }


/* ═══════════ PERSISTENCE ════════════════════════════════════════════════
   One shared key so the suite looks consistent when you hop between the
   apps. Old per-app keys are read once and migrated so nobody loses their
   setting; flip SHARED to false below for independent per-app themes. */
var SHARED = true;

function load() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(SHARED ? STORE : STORE + '-' + cfg.app) || 'null'); } catch (e) {}
    if (!saved && cfg.legacy) {                       // one-time migration
        try {
            saved = {
                style: localStorage.getItem(cfg.legacy.style),
                color: localStorage.getItem(cfg.legacy.color),
                mode:  localStorage.getItem(cfg.legacy.mode)
            };
        } catch (e) {}
    }
    saved = saved || {};
    if (VALID_STYLES.indexOf(saved.style) > -1) state.style = saved.style;
    if (VALID_COLORS.indexOf(saved.color) > -1) state.color = saved.color;
    if (saved.mode === 'light' || saved.mode === 'dark') state.mode = saved.mode;
}
function save() {
    try { localStorage.setItem(SHARED ? STORE : STORE + '-' + cfg.app, JSON.stringify(state)); } catch (e) {}
}


/* ═══════════ BACKGROUND LAYERS ══════════════════════════════════════════ */
function buildLayers() {
    var f = document.createDocumentFragment();
    ['ambientBg','gradientBg','goopBg','pixelArtBg','medievalBg','brutalistBg','blueprintBg'].forEach(function (id) {
        if (!$(id)) f.appendChild(el('div', { id:id, 'aria-hidden':'true' }));
    });
    if (!$('matrixCanvas')) f.appendChild(el('canvas', { id:'matrixCanvas', 'aria-hidden':'true' }));
    if (!$('crtOverlay'))      f.appendChild(el('div', { id:'crtOverlay', 'aria-hidden':'true' }));
    if (!$('scanlineOverlay')) f.appendChild(el('div', { id:'scanlineOverlay', 'aria-hidden':'true' }));
    document.body.insertBefore(f, document.body.firstChild);

    // Goop stage + the alpha-threshold filter that welds the blobs together.
    var goop = $('goopBg');
    goop.innerHTML =
        '<div class="goop-tint"></div><div class="goop-stage"></div>' +
        '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
        '<filter id="smtGoo"><feGaussianBlur in="SourceGraphic" stdDeviation="18" result="b"/>' +
        '<feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11"/>' +
        '</filter></defs></svg>';

    var px = $('pixelArtBg');
    px.appendChild(el('canvas', { id:'pixelCanvas' }));

    // Medieval filigree corners: nested corner rules, a scrolled spiral at the
    // elbow, and leaf terminals — an actual ornament rather than a squiggle.
    var flourish =
        '<svg viewBox="0 0 100 100" aria-hidden="true">' +
        '<path d="M8 74 L8 16 C8 11.6 11.6 8 16 8 L74 8"/>' +
        '<path d="M17 74 L17 23 C17 19.7 19.7 17 23 17 L74 17"/>' +
        '<path d="M27 27 C38 27 45 34 45 43 C45 50 40 55 34 55 C29 55 25.5 51.5 25.5 47 C25.5 43.2 28.2 40.5 31.5 40.5 C34 40.5 36 42.5 35.5 45"/>' +
        '<path d="M56 17 C64 17 70 13 72 8"/>' +
        '<path d="M17 56 C17 64 13 70 8 72"/>' +
        '<path d="M45 43 C52 39 58 40 61 45 C63 48.5 61.5 52 58.5 52 C56.5 52 55 50.5 55.5 48.5"/>' +
        '</svg>';
    document.body.appendChild(el('div', { id:'medievalCorners', 'aria-hidden':'true', html: flourish + flourish + flourish + flourish }));

    // Blueprint title block
    // Pixel-art icons: sample the glyph on a 2px grid and harden the alpha,
    // so the icon font renders as real pixels (theme.css applies it).
    document.body.appendChild(el('div', { 'aria-hidden':'true', style:'position:absolute;width:0;height:0;overflow:hidden', html:
        '<svg width="0" height="0"><filter id="ttPixel" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">' +
        '<feFlood x="0" y="0" width="1" height="1" flood-color="#000"/><feComposite width="2" height="2"/><feTile result="grid"/>' +
        '<feComposite in="SourceGraphic" in2="grid" operator="in"/><feMorphology operator="dilate" radius="1"/>' +
        '<feComponentTransfer><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer></filter></svg>' }));
    document.body.appendChild(el('div', { id:'blueprintTitleBlock', 'aria-hidden':'true', html:
        '<div class="bp-row"><span class="bp-k">Title</span><span class="bp-v">' + (cfg.title || '') + '</span></div>' +
        '<div class="bp-row"><span class="bp-k">Drawn</span><span class="bp-v">isaiart</span></div>' +
        '<div class="bp-row"><span class="bp-k">Scale</span><span class="bp-v">1:1</span></div>' +
        '<div class="bp-row"><span class="bp-k">Rev</span><span class="bp-v">C</span></div>' }));
}


/* ── Matrix rain (cyberpunk) ─────────────────────────────────────────── */
var matrix = (function () {
    var cv, ctx, id = null, drops = [], CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*!?+-=><アイウエオカキクケコサシスセソ';
    var accent = '#33FF66', last = 0, acc = 0, n = 0, STEP = 1000 / 60;
    function size() {
        cv.width = innerWidth; cv.height = innerHeight;
        drops = Array.from({ length: Math.floor(cv.width / 14) }, function () { return Math.random() * -cv.height; });
    }
    function readAccent() { accent = getComputedStyle(html).getPropertyValue('--accent').trim() || '#33FF66'; }
    function draw() {
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.font = '14px "Share Tech Mono",monospace';
        for (var i = 0; i < drops.length; i++) {
            ctx.fillStyle = Math.random() > 0.94 ? '#ffffff' : accent;
            ctx.fillText(CH[(Math.random() * CH.length) | 0], i * 14, drops[i]);
            if (drops[i] > cv.height && Math.random() > 0.975) drops[i] = 0;
            drops[i] += 14;
        }
    }
    /* Fixed 60Hz step. It used to advance once per display frame, so on a
       120/144Hz screen the rain fell twice as fast with half-length trails,
       and it restyled the whole document every frame to read --accent. */
    function tick(now) {
        id = raf(tick);
        acc += last ? Math.min(100, now - last) : STEP; last = now;
        while (acc >= STEP) {
            acc -= STEP;
            if (++n % 30 === 0) readAccent();
            draw();
        }
    }
    return {
        start: function () {
            if (id) return;
            cv = $('matrixCanvas'); ctx = cv.getContext('2d'); size();
            readAccent(); draw();
            if (reduceMotion) { id = -1; return; }                       // one static frame
            last = 0; acc = 0; id = raf(tick);
        },
        stop:  function () { if (id && id !== -1) cancelAnimationFrame(id); id = null; if (ctx) ctx.clearRect(0, 0, cv.width, cv.height); },
        resize: function () { if (id) size(); }
    };
})();


/* ── Goop metaballs ───────────────────────────────────────────────────────
   Balls drift slowly, bounce off the walls, and are weakly attracted to
   each other so they clump, weld into one shape through the SVG filter,
   then peel apart again. Repulsion at close range stops them collapsing
   into a single permanent blob. */
var goop = (function () {
    var stage, balls = [], id = null, W = 0, H = 0, last = 0;
    var PALETTE = ['#7C5CFF','#22D3EE','#F472B6','#34D399','#F59E0B','#818CF8'];

    function build() {
        stage = document.querySelector('#goopBg .goop-stage');
        stage.innerHTML = '';
        balls = [];
        var r = stage.getBoundingClientRect(); W = r.width; H = r.height;
        var n = innerWidth < 720 ? 7 : 11;
        for (var i = 0; i < n; i++) {
            var rad = 26 + Math.random() * (innerWidth < 720 ? 52 : 84);
            var node = el('div', { class:'goop-ball' });
            node.style.width = node.style.height = (rad * 2) + 'px';
            node.style.background = PALETTE[i % PALETTE.length];
            stage.appendChild(node);
            balls.push({
                node: node, r: rad,
                x: rad + Math.random() * Math.max(1, W - rad * 2),
                y: rad + Math.random() * Math.max(1, H - rad * 2),
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                // Each ball breathes between "sticky" and "repelled" on its own
                // slow cycle. Pairs whose cycles line up clump and weld; as the
                // cycles drift out of phase they actively shove apart again.
                phase:  Math.random() * Math.PI * 2,
                period: 6500 + Math.random() * 9000,
                wander: Math.random() * Math.PI * 2
            });
        }
        draw();
    }
    function draw() {
        for (var i = 0; i < balls.length; i++) {
            var b = balls[i];
            b.node.style.transform = 'translate3d(' + (b.x - b.r) + 'px,' + (b.y - b.r) + 'px,0)';
        }
    }
    function step(ts) {
        var dt = last ? Math.min(3, (ts - last) / 16.67) : 1; last = ts;
        var i, j, a, b;

        // Refresh each ball's mood for this frame.
        for (i = 0; i < balls.length; i++) {
            a = balls[i];
            a.bond = Math.sin(ts / a.period + a.phase);        // -1 = repel, +1 = stick
            // Persistent wander so nothing ever just parks in a corner.
            a.wander += (Math.random() - 0.5) * 0.28 * dt;
            a.vx += Math.cos(a.wander) * 0.020 * dt;
            a.vy += Math.sin(a.wander) * 0.020 * dt;
        }

        for (i = 0; i < balls.length; i++) {
            a = balls[i];
            for (j = i + 1; j < balls.length; j++) {
                b = balls[j];
                var dx = b.x - a.x, dy = b.y - a.y;
                var d = Math.sqrt(dx * dx + dy * dy) || 0.001;
                var touch = a.r + b.r;
                var nx = dx / d, ny = dy / d;

                // Hard core — always on. Stops a cluster collapsing into one
                // permanent lump, which is what made them stick before.
                if (d < touch * 0.6) {
                    var push = 0.09 * (1 - d / (touch * 0.6)) * dt;
                    a.vx -= nx * push; a.vy -= ny * push;
                    b.vx += nx * push; b.vy += ny * push;
                    continue;
                }

                if (d < touch * 1.7) {
                    var mood = (a.bond + b.bond) * 0.5;         // shared mood
                    var falloff = 1 - d / (touch * 1.7);
                    var f = mood * 0.030 * falloff * dt;
                    if (mood < 0) f *= 2.4;                     // tear apart decisively
                    a.vx += nx * f; a.vy += ny * f;
                    b.vx -= nx * f; b.vy -= ny * f;
                }
            }

            // Light drag + clamp: lava-lamp pace, but never fully at rest.
            a.vx *= 0.995; a.vy *= 0.995;
            var sp = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
            if (sp > 1.0) { a.vx = a.vx / sp * 1.0; a.vy = a.vy / sp * 1.0; }

            a.x += a.vx * dt; a.y += a.vy * dt;

            if (a.x < a.r)     { a.x = a.r;     a.vx =  Math.abs(a.vx); }
            if (a.x > W - a.r) { a.x = W - a.r; a.vx = -Math.abs(a.vx); }
            if (a.y < a.r)     { a.y = a.r;     a.vy =  Math.abs(a.vy); }
            if (a.y > H - a.r) { a.y = H - a.r; a.vy = -Math.abs(a.vy); }
        }
        draw();
        id = raf(step);
    }
    return {
        start: function () { if (id) return; build(); if (reduceMotion) { id = -1; return; } last = 0; id = raf(step); },
        stop:  function () { if (id && id !== -1) cancelAnimationFrame(id); id = null; if (stage) stage.innerHTML = ''; },
        resize: function () {
            if (id === null) return;
            if (id !== -1) cancelAnimationFrame(id);
            build();
            if (reduceMotion) { id = -1; } else { last = 0; id = raf(step); }
        }
    };
})();


/* ── Pixel-art world ──────────────────────────────────────────────────────
   The endless scroller from isaiart.com/text, ported near line-for-line
   (only let/const → var to match this file) so the two can be diffed and
   kept in sync. Fifteen biomes — meadow, castle
   country, desert, sakura, the feywild, neo city, ocean, tundra, volcanoes
   and more — drift past on three parallax ridges and blend into each other
   at the borders, dressed with props, landmarks and rare world events (UFO
   abductions, dragons, whales, parades, the /text cat out for a walk), under
   rolling weather and a sun or moon crossing the sky.

   Rendered into a genuinely low-res canvas (¼ scale, ⅓ on phones) and
   upscaled with image-rendering:pixelated, so every pixel is a hard pixel.
   The journey is keyed to the wall clock, so hopping between /flow and
   /transfer picks it up exactly where it left off. Light mode rides the
   daytime, dark mode the night. */
var pixel = (function () {
    var cv, g, id = null, last = 0;

    /* ---- math / colour / noise ---- */
    function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
    function lerp(a,b,t){ return a+(b-a)*t; }
    function smooth(t){ return t*t*(3-2*t); }
    function hex(h){ var n=parseInt(h.slice(1),16); return [n>>16&255,n>>8&255,n&255]; }
    function mix(a,b,t){ return [lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)]; }
    function rgb(c,a){
        return a===undefined?'rgb('+(c[0]|0)+','+(c[1]|0)+','+(c[2]|0)+')'
                            :'rgba('+(c[0]|0)+','+(c[1]|0)+','+(c[2]|0)+','+a+')';
    }
    /* integer hash -> 0..1  (32-bit mixing; plain * would lose precision past 2^53) */
    function hash1(n){
        var h=Math.imul((n|0)^((n|0)>>>15),0x2c1b3c6d);
        h=Math.imul(h^(h>>>12),0x297a2d39);
        h^=h>>>15;
        return (h>>>0)/4294967296;
    }
    function hash2(a,b){ return hash1(Math.imul(a|0,73856093)^Math.imul(b|0,19349663)); }
    /* value noise, -1..1 */
    function vnoise(x,seed){
        var i=Math.floor(x), f=x-i;
        var a=hash2(i,seed)*2-1, b=hash2(i+1,seed)*2-1;
        return lerp(a,b,smooth(f));
    }
    function fbm(x,seed,oct){
        var s=0,amp=.5,fr=1;
        for(var i=0;i<oct;i++){ s+=vnoise(x*fr,seed+i*101)*amp; amp*=.5; fr*=2.03; }
        return s;
    }
    /* deterministic per-index stream */
    function seeded(n){
        var s=n|0;
        return function(){ s=(s+0x9E3779B9)|0; var t=Math.imul(s^(s>>>16),0x21F0AAAD); t=Math.imul(t^(t>>>15),0x735A2D97); return ((t^(t>>>15))>>>0)/4294967296; };
    }
    function pick(list,r){
        var tot=0; for(var i=0;i<list.length;i++) tot+=list[i][0];
        var v=r*tot;
        for(var i=0;i<list.length;i++){ v-=list[i][0]; if(v<=0) return list[i][1]; }
        return list[list.length-1][1];
    }

    /* ---- time ----
       One clock shared by both apps. /text runs a full day every 12 minutes;
       here the hour swings slowly back and forth inside the band that
       matches the chosen mode instead — morning → golden hour in light,
       dusk → pre-dawn in dark — so the panel always sits on a sky that
       suits it. */
    var EPOCH = Date.UTC(2026, 0, 1), SWING = 16*60*1000;
    function elapsed(){ return Date.now()-EPOCH; }
    function hourNow(){
        var c=Math.cos(elapsed()/SWING*Math.PI*2);
        return state.mode==='light' ? 12.5-4.7*c : (24.4-4*c)%24;
    }
    var SKY = [
        [0   ,'#0a0e23','#131a3d','#20264f'],
        [3.6 ,'#0b1029','#171f47','#2b2b60'],
        [5.2 ,'#241f52','#5c3f74','#c9636b'],
        [6.4 ,'#3f57a3','#a86a8e','#ffb27a'],
        [7.6 ,'#4a8ed2','#8fc7ef','#d7ecff'],
        [12  ,'#2d7ed6','#6fb8f0','#bde6ff'],
        [16  ,'#3b8ad4','#8cc6ec','#ffe6c2'],
        [17.8,'#5a6cc0','#cf8a86','#ffb374'],
        [19  ,'#33306e','#8a4a72','#ff7a5c'],
        [20.2,'#181a46','#3a2a5e','#7a3f66'],
        [21.6,'#0c1029','#181f45','#2a2f5c'],
        [24  ,'#0a0e23','#131a3d','#20264f']
    ].map(function(k){ return [k[0],hex(k[1]),hex(k[2]),hex(k[3])]; });

    function skyKeys(h){
        var i=0; while(i<SKY.length-2 && h>=SKY[i+1][0]) i++;
        var a=SKY[i], b=SKY[i+1];
        var t=clamp((h-a[0])/(b[0]-a[0]),0,1);
        return [mix(a[1],b[1],t), mix(a[2],b[2],t), mix(a[3],b[3],t)];
    }

    /* ---- weather ---- */
    var WX = {
        clear : {cloud:.14, rain:0,  snow:0,  dark:0   },
        cloudy: {cloud:.86, rain:0,  snow:0,  dark:.50 },
        rain  : {cloud:.92, rain:.55,snow:0,  dark:.68 },
        storm : {cloud:1,   rain:1,  snow:0,  dark:.88 },
        snow  : {cloud:.80, rain:0,  snow:.85,dark:.55 }
    };
    var wxKey='clear', wxNext=0;
    var cur = {cloud:.14, rain:0, snow:0, dark:0, cover:0};
    function pickWeather(force){
        if(force){ wxKey=force; }
        else{
            var roll=Math.random();
            var k = roll<.40?'clear' : roll<.66?'cloudy' : roll<.85?'rain' : roll<.93?'storm' : 'snow';
            if(k===wxKey) k = k==='clear'?'cloudy':'clear';
            wxKey=k;
        }
        wxNext = performance.now() + (55+Math.random()*95)*1000;
    }

    /* ---- biomes ----
       amp   terrain roughness multiplier
       lift  raises(+) / sinks(-) the land, as a fraction of H
       pal   [farHill, midHill, midTop, ground, groundTop, dirt]
       sky   [tintColour, amount] */
    function B(o){
        o.pal=o.pal.map(hex);
        o.sky[0]=hex(o.sky[0]);
        if(o.tree) {o.tree.t=hex(o.tree.t); o.tree.a=hex(o.tree.a); o.tree.b=hex(o.tree.b);}
        if(o.house){o.house.w=hex(o.house.w); o.house.d=hex(o.house.d); o.house.r=hex(o.house.r); o.house.rd=hex(o.house.rd);}
        if(o.tower){o.tower.a=hex(o.tower.a); o.tower.b=hex(o.tower.b);}
        o.rockC=hex(o.rockC);
        o.accent=hex(o.accent);
        if(o.water) o.water.c=hex(o.water.c);
        return o;
    }

    var BIOMES=[
    B({id:'meadow',amp:1,lift:0,
        pal:['#5b7fae','#3f7a5a','#5d9c6f','#4b8c46','#6fb95c','#6b4a35'],
        sky:['#bfe6ff',.04],grass:1,accent:'#ff9ec4',rockC:'#8a8f96',
        tree:{s:'round',t:'#5a3b2a',a:'#3f8a48',b:'#5cb45c'},
        house:{s:'cottage',w:'#e8cfa0',d:'#c9a97c',r:'#b4544a',rd:'#8e3f39',lit:1},
        small:['flower','bush','fence'],sig:'well',far:'hills',
        dens:[.9,.7,.5],amb:'pollen',ev:['balloon','cat','deer']}),

    B({id:'medieval',amp:1.15,lift:.01,
        pal:['#6b7a94','#4a6b52','#5f8560','#58803f','#79a552','#6a5136'],
        sky:['#e8dcc0',.07],grass:1,accent:'#c8443c',rockC:'#8c8a86',
        tree:{s:'round',t:'#4e3628',a:'#356e3f',b:'#4c944f'},
        house:{s:'timber',w:'#e0cfae',d:'#b8a184',r:'#7a4a3a',rd:'#5c3628',lit:1},
        tower:{s:'castle',a:'#9a9690',b:'#7c7872'},
        small:['barrel','fence','banner'],sig:'gate',far:'castle',
        dens:[1.0,.8,.5],amb:null,ev:['parade','dragon','knight']}),

    B({id:'desert',amp:1.7,lift:-.005,
        pal:['#b08a63','#c99a63','#e0b47e','#dcb87e','#f0d39a','#a37c4f'],
        sky:['#ffcf8c',.22],grass:0,accent:'#e0d0a8',rockC:'#b08a5f',
        tree:{s:'cactus',t:'#4f7a45',a:'#5b8f4f',b:'#78ad63'},
        house:{s:'adobe',w:'#d9b183',d:'#b8905f',r:'#c49a6a',rd:'#9c7448',lit:1},
        small:['bones','rock','skull'],sig:'obelisk',far:'mesa',
        dens:[.45,.4,.35],amb:'sand',ev:['caravan','mirage','vulture']}),

    B({id:'cherry',amp:1.05,lift:.008,
        pal:['#8a7fa8','#5f7a63','#7a9a72','#6d9a5c','#8fbc6e','#7a5a44'],
        sky:['#ffc2dd',.16],grass:1,accent:'#ff9ec4',rockC:'#9a94a0',
        tree:{s:'cherry',t:'#6b4a3a',a:'#ff9ec4',b:'#ffc2dd'},
        house:{s:'pagoda',w:'#f0e2cc',d:'#cdbca4',r:'#b0505c',rd:'#8a3a46',lit:1},
        small:['lantern','bush','flower'],sig:'torii',far:'peaks',
        dens:[1.2,.9,.6],amb:'petal',ev:['crane','festival']}),

    B({id:'feywild',amp:1.35,lift:.012,
        pal:['#6a4a8f','#4a2f6b','#6b4a94','#45336b','#7a4fb0','#2f2450'],
        sky:['#c46bff',.30],grass:1,accent:'#7fffd4',rockC:'#6a5a94',
        tree:{s:'spiral',t:'#4a3468',a:'#8a4fd0','b':'#c47fff'},
        house:{s:'mush',w:'#e8d8f0',d:'#c2aed6',r:'#ff6b9d',rd:'#c44a76',lit:1},
        small:['mushroom','crystal','glowflower'],sig:'portal',far:'isles',
        dens:[1.3,1.0,.7],amb:'wisp',ev:['rift','pixie','moonbeast']}),

    B({id:'city',amp:.30,lift:0,
        pal:['#6b7280','#4a5260','#606a7a','#55606b','#6b7784','#3a4048'],
        sky:['#c8ccd8',.16],grass:0,accent:'#ffd45c',rockC:'#6a707a',
        tree:{s:'round',t:'#4a3f38',a:'#3f6b45',b:'#578a56'},
        house:{s:'modern',w:'#8a94a4',d:'#6a7484',r:'#5a6474',rd:'#48505e',lit:1},
        tower:{s:'sky',a:'#7c8698',b:'#616b7c'},
        small:['streetlight','car','hydrant'],sig:'crane',far:'skyline',
        dens:[1.1,.9,.7],amb:null,ev:['parade','blimp','helicopter']}),

    B({id:'arcane',amp:1.5,lift:.02,
        pal:['#5a5a8c','#464678','#5e5e96','#4a4a74','#6a6a9c','#3a3a5c'],
        sky:['#9c8cff',.22],grass:0,accent:'#7fd4ff',rockC:'#5e5e8a',
        tree:{s:'dead',t:'#3f3a5c',a:'#4a4478',b:'#5e5896'},
        tower:{s:'wizard',a:'#6a5f9c',b:'#4e4478'},
        house:{s:'cottage',w:'#c4b8e0',d:'#a094c0',r:'#5f4a9c',rd:'#453472',lit:1},
        small:['crystal','rune','candle'],sig:'monolith',far:'spires',
        dens:[.8,.7,.55],amb:'spark',ev:['rift','dragon','comet']}),

    B({id:'ocean',amp:.5,lift:-.035,
        pal:['#4a6f96','#3d5f80','#527a9c','#2f4a66','#3f6180','#26384c'],
        sky:['#a8dcff',.18],grass:0,accent:'#7fe0ff',rockC:'#5a7490',
        water:{c:'#2f7fb0',rise:.022,alpha:.86},
        tree:{s:'palm',t:'#6b5236',a:'#3f8a55',b:'#5cb46c'},
        house:{s:'cottage',w:'#e0dcd0',d:'#bab6aa',r:'#4a6f8a',rd:'#365468',lit:1},
        tower:{s:'light',a:'#e8e4dc',b:'#c8483c'},
        small:['buoy','shell','crab'],sig:'wreck',far:'isles',
        dens:[.35,.3,.35],amb:null,ev:['whale','ship','kraken']}),

    B({id:'farm',amp:.5,lift:.004,
        pal:['#6b8aa8','#6a8a4a','#87a85f','#8a9a4a','#a8bc63','#7a5c3a'],
        sky:['#ffe9b0',.10],grass:1,accent:'#e8c45c',rockC:'#8a8474',
        tree:{s:'round',t:'#5a3f2a',a:'#4a8a45',b:'#6aac58'},
        house:{s:'barn',w:'#b8483c',d:'#8e3630',r:'#e8e0d0',rd:'#bab2a2',lit:1},
        tower:{s:'silo',a:'#d8d2c2',b:'#b0aa9a'},
        small:['crops','hay','fence'],sig:'windmill',far:'hills',
        dens:[1.0,.9,.6],amb:'pollen',ev:['ufo','tractor','crop']}),

    B({id:'ruins',amp:1.2,lift:.006,
        pal:['#7a7a8a','#5a6b5a','#7a8a70','#6b7060','#8a8f74','#5a5044'],
        sky:['#d8d0bc',.12],grass:1,accent:'#a8a294',rockC:'#8a8578',
        tree:{s:'dead',t:'#4a4238',a:'#5a6b4a',b:'#74875c'},
        house:{s:'ruin',w:'#b8b2a0',d:'#948e7c',r:'#8a8474',rd:'#6a6454',lit:0},
        small:['column','rubble','grave'],sig:'arch',far:'brokentowers',
        dens:[1.0,.8,.5],amb:null,ev:['raven','ghost','digsite']}),

    B({id:'tundra',amp:1.25,lift:.008,
        pal:['#8aa0c0','#7f96b4','#a4b8d4','#d8e6f0','#f4faff','#6a7a8a'],
        sky:['#cfe6ff',.22],grass:0,accent:'#a8e0ff',rockC:'#7e8ea0',
        tree:{s:'snowpine',t:'#4a4038',a:'#2f5a45',b:'#c8e4f0'},
        house:{s:'igloo',w:'#e8f2fa',d:'#c2d4e4',r:'#dcebf6',rd:'#b4c8dc',lit:1},
        small:['icespike','rock','snowman'],sig:'wolfrock',far:'snowpeaks',
        dens:[.6,.5,.4],amb:'drift',ev:['aurora','sled','mammoth']}),

    B({id:'volcanic',amp:1.6,lift:.014,
        pal:['#4a3a3f','#3a2a2f','#54383c','#2f2226','#4a3236','#1f1618'],
        sky:['#ff6a3c',.30],grass:0,accent:'#ff8a3c',rockC:'#3f3034',
        tree:{s:'dead',t:'#2a2022',a:'#3a2c2e',b:'#4e3a3c'},
        house:{s:'ruin',w:'#4a3c3e',d:'#332728',r:'#3a2e30',rd:'#251d1e',lit:0},
        small:['obsidian','lava','ember'],sig:'forge',far:'volcano',
        dens:[.7,.6,.5],amb:'ember',ev:['meteor','phoenix','lavaburst']}),

    B({id:'swamp',amp:.65,lift:-.006,
        pal:['#4a5a4a','#3a4a3a','#4f6349','#3f4a35','#576445','#2a3226'],
        sky:['#8aa87c',.22],grass:1,accent:'#8ade6a',rockC:'#5a6450',
        water:{c:'#3f5540',rise:.008,alpha:.7},
        tree:{s:'gnarled',t:'#3a3228',a:'#46603c',b:'#5e7a4c'},
        house:{s:'stilt',w:'#6a5c46',d:'#4e4232',r:'#5a4c38',rd:'#3e3426',lit:1},
        small:['reed','lily','toadstool'],sig:'shrine',far:'mist',
        dens:[1.2,.9,.7],amb:'wisp',ev:['heron','bubble','witch']}),

    B({id:'industrial',amp:.45,lift:.004,
        pal:['#6a6a72','#55555c','#6e6e77','#4a4a50','#62626a','#3a3a40'],
        sky:['#d8c8a8',.20],grass:0,accent:'#e08a3c',rockC:'#5e5e66',
        tree:{s:'dead',t:'#3a3630',a:'#4a4640',b:'#5c5850'},
        house:{s:'factory',w:'#7a6a5c',d:'#5c5044',r:'#6a6a72',rd:'#4e4e56',lit:1},
        tower:{s:'stack',a:'#8a7a6c',b:'#6a5e52'},
        small:['pipe','crate','gear'],sig:'gearworks',far:'stacks',
        dens:[1.0,.8,.6],amb:'ash',ev:['airship','train','steamburst']}),

    B({id:'outpost',amp:.9,lift:.006,
        pal:['#7a6a94','#5f5280','#7a6aa0','#6b5f8a','#8779ac','#4a4066'],
        sky:['#c48cff',.26],grass:0,accent:'#7fffe0',rockC:'#6a5e88',
        tree:{s:'spiral',t:'#4a4068',a:'#4a8a9c',b:'#6ab4c4'},
        house:{s:'dome',w:'#c4bcd8',d:'#a099bc',r:'#7fffe0',rd:'#4ac0a8',lit:1},
        tower:{s:'antenna',a:'#a89ec4',b:'#7f76a0'},
        small:['crate','panel','probe'],sig:'dish',far:'domes',
        dens:[.7,.6,.5],amb:'spark',ev:['ufo','drone','satellite']})
    ];

    /* ---- world: endless regions, terrain, prop chunks ---- */
    var SPEED=5.5;             /* world px per second */
    var SLOT=1300, JIT=760, BLEND=210;
    function camX(){ return elapsed()/1000*SPEED; }

    function bound(i){ return i*SLOT + (hash1(Math.imul(i,7919)+3)-.5)*JIT; }
    function regionAt(wx){
        var i=Math.floor(wx/SLOT);
        while(bound(i)>wx) i--;
        while(bound(i+1)<=wx) i++;
        return i;
    }
    function rawBiome(i){ return Math.floor(hash1(Math.imul(i,104729)+13)*BIOMES.length)%BIOMES.length; }
    function biomeOf(i){
        var k=rawBiome(i);
        if(k===rawBiome(i-1)) k=(k+1+Math.floor(hash1(Math.imul(i,31337)+7)*(BIOMES.length-1)))%BIOMES.length;
        return k;
    }
    /* {a,b,t} — a and b are biome indices, t is the blend toward b */
    function blendAt(wx){
        var i=regionAt(wx), b0=bound(i);
        var d=wx-b0;
        if(d<BLEND) return {a:biomeOf(i-1),b:biomeOf(i),t:smooth(d/BLEND)};
        var k=biomeOf(i);
        return {a:k,b:k,t:1};
    }
    function biomeIdxAt(wx){ var b=blendAt(wx); return b.t<.5?b.a:b.b; }

    /* terrain: shape from noise, palette/biome from the same world x (fully coherent) */
    var LAYER=[{base:.150,amp:.060,freq:.0024},
               {base:.070,amp:.038,freq:.0050},
               {base:.000,amp:.017,freq:.0078}];
    function layerYFor(wx,l,B_){
        var L=LAYER[l];
        return horizon - L.base*H - B_.lift*H*(l===2?1:.6)
             - fbm(wx*L.freq,l*257+11,3)*L.amp*H*B_.amp;
    }
    function terrainY(wx,l){
        var bl=blendAt(wx);
        if(bl.a===bl.b) return Math.round(layerYFor(wx,l,BIOMES[bl.a]));
        return Math.round(lerp(layerYFor(wx,l,BIOMES[bl.a]),layerYFor(wx,l,BIOMES[bl.b]),bl.t));
    }

    /* ---- prop chunks ---- */
    var CHUNK=110;
    var chunkCache={}, chunkCount=0;
    function chunkProps(l,ci){
        var key=l+':'+ci;
        var v=chunkCache[key];
        if(v) return v;
        var r=seeded(Math.imul(ci,7919)+Math.imul(l,104729)+5);
        var wx0=ci*CHUNK;
        var bi=biomeIdxAt(wx0+CHUNK/2), Bm=BIOMES[bi];
        var list=[];
        /* dens is authored [most-distant .. nearest]; the near layer carries the detail */
        var n=Math.round(Bm.dens[2-l]*(CHUNK/110)*(l===0?2.0:l===1?2.8:3.6)*(.55+r()));
        for(var i=0;i<n;i++){
            var wx=wx0+r()*CHUNK;
            var kind;
            if(l===0) kind='far';
            else{
                var tbl=l===1
                    ? [[3,'tree'],[1.1,'house'],[.5,'rock'],[1.4,'small']]
                    : [[2.6,'tree'],[1.5,'house'],[.9,'rock'],[2.6,'small'],[(Bm.tower?0.7:0),'tower'],[.45,'sig']];
                kind=pick(tbl,r());
            }
            if(kind==='tree'&&!Bm.tree) kind='rock';
            if(kind==='house'&&!Bm.house) kind='rock';
            list.push({k:kind,wx:wx,b:bi,a:r(),c:r(),d:r()});
        }
        /* rare world events, near layer only */
        if(l===2 && Bm.ev.length && r()<.30){
            list.push({k:'event',ev:Bm.ev[Math.floor(r()*Bm.ev.length)],wx:wx0+r()*CHUNK,b:bi,a:r(),c:r(),d:r()});
        }
        chunkCache[key]=list; chunkCount++;
        if(chunkCount>900){
            var cut=Math.floor(camX()/CHUNK);
            for(var k in chunkCache){
                var ci2=parseInt(k.split(':')[1],10);
                if(Math.abs(ci2-cut)>60){ delete chunkCache[k]; chunkCount--; }
            }
        }
        return list;
    }

    /* ---- prop art ---- */
    function px(x,y,w,h,c){ g.fillStyle=c; g.fillRect(x|0,y|0,Math.max(1,w|0),Math.max(1,h|0)); }
    function disc(x,y,r,c){
        g.fillStyle=c;
        for(var dy=-r;dy<=r;dy++){
            var w=Math.floor(Math.sqrt(Math.max(0,r*r-dy*dy)));
            g.fillRect((x-w)|0,(y+dy)|0,w*2+1,1);
        }
    }
    /* staircase triangle, point up */
    function tri(x,y,w,h,c){
        g.fillStyle=c;
        for(var i=0;i<h;i++){
            var ww=Math.max(1,Math.round(w*(i/h)));
            g.fillRect((x-ww/2)|0,(y-h+i)|0,ww,1);
        }
    }
    var hazeCol=[140,170,200];
    var LSCALE=[.42,.66,1];
    function C(c,l){ return rgb(l?mix(tint(c),hazeCol,l===1?.16:0):tint(c)); }
    function CF(c){ return rgb(mix(tint(c),hazeCol,.45)); }

    function drawProp(p,l,sx,gy,now){
        var Bm=BIOMES[p.b], s=LSCALE[l];
        switch(p.k){
            case 'far'  : farSil(Bm,sx,gy,p,now); break;
            case 'tree' : drawTree(Bm,sx,gy,p,l,s,now); break;
            case 'house': drawHouse(Bm,sx,gy,p,l,s,now); break;
            case 'tower': drawTower(Bm,sx,gy,p,l,s,now); break;
            case 'rock' : drawRock(Bm,sx,gy,p,l,s); break;
            case 'small': drawSmall(Bm,sx,gy,p,l,s,now); break;
            case 'sig'  : drawSig(Bm,sx,gy,p,l,s,now); break;
            case 'event': drawEvent(p.ev,Bm,sx,gy,p,now); break;
        }
    }

    /* ---------- trees ---------- */
    function drawTree(Bm,x,gy,p,l,s,now){
        var T=Bm.tree, h=Math.round((9+p.a*11)*s)+2;
        var sway=reduceMotion?0:Math.round(Math.sin(now/1500+p.wx*.07)*(l===2?1:.6));
        var tc=C(T.t,l), a=C(T.a,l), b=C(T.b,l);
        switch(T.s){
            case 'round':
                px(x,gy-h+2,Math.max(1,Math.round(s*1.6)),h-2,tc);
                disc(x+sway,gy-h,Math.max(2,Math.round(h*.42)),a);
                disc(x-1+sway,gy-h-1,Math.max(1,Math.round(h*.30)),b);
                break;
            case 'pine': case 'snowpine':
                px(x,gy-3,1,3,tc);
                for(var i=0;i<3;i++){
                    var w=Math.round(h*.62-i*h*.16), yy=gy-3-Math.round(h*.30*i)-Math.round(h*.30);
                    tri(x+Math.round(sway*i/2),yy+3,w,Math.round(h*.34),i===0?a:a);
                }
                if(T.s==='snowpine'){ tri(x+sway,gy-3-Math.round(h*.90),Math.round(h*.30),Math.round(h*.22),b); }
                else tri(x+sway,gy-3-Math.round(h*.86),Math.round(h*.28),Math.round(h*.20),b);
                break;
            case 'cherry':
                px(x,gy-h+3,Math.max(1,Math.round(s*1.6)),h-3,tc);
                px(x-2,gy-h+4,2,1,tc); px(x+2,gy-h+5,2,1,tc);
                disc(x+sway,gy-h,Math.max(2,Math.round(h*.44)),a);
                disc(x-2+sway,gy-h-2,Math.max(1,Math.round(h*.26)),b);
                disc(x+3+sway,gy-h+1,Math.max(1,Math.round(h*.22)),b);
                break;
            case 'dead':
                px(x,gy-h,1,h,tc);
                px(x-2,gy-h+2,2,1,tc); px(x+1,gy-h+4,3,1,tc);
                px(x-3,gy-h+1,1,2,tc); px(x+3,gy-h+3,1,2,tc);
                break;
            case 'gnarled':
                px(x,gy-h,2,h,tc);
                px(x-3,gy-h+3,3,1,tc); px(x+2,gy-h+5,3,1,tc);
                disc(x+sway,gy-h-1,Math.max(2,Math.round(h*.34)),a);
                disc(x+3+sway,gy-h+2,Math.max(1,Math.round(h*.20)),b);
                /* hanging moss */
                px(x-2,gy-h+2,1,Math.round(h*.25),b);
                break;
            case 'palm':
                for(var i=0;i<h;i++) px(x+Math.round(Math.sin(i/h*1.2)*2),gy-i,1,1,tc);
                var tx=x+Math.round(Math.sin(1.2)*2);
                for(var k=-2;k<=2;k++){
                    if(!k) continue;
                    for(var i=1;i<=4;i++) px(tx+k*i,gy-h+Math.abs(k)*i*.4+(i*i*.18)|0,1,1,k%2?a:b);
                }
                disc(tx,gy-h,1,b);
                break;
            case 'cactus':
                px(x,gy-h,2,h,a);
                px(x,gy-h,1,h,b);
                if(p.a>.4){ px(x-3,gy-Math.round(h*.6),3,1,a); px(x-3,gy-Math.round(h*.6)-3,1,3,a); }
                if(p.c>.5){ px(x+2,gy-Math.round(h*.75),3,1,a); px(x+4,gy-Math.round(h*.75)-4,1,4,a); }
                if(p.d>.75) px(x,gy-h-1,2,1,C(Bm.accent,l));
                break;
            case 'spiral':
                for(var i=0;i<h;i++) px(x+Math.round(Math.sin(i*.55)*2.4),gy-i,1,1,tc);
                for(var i=0;i<5;i++){
                    var ang=i*1.25+p.a*6, rr=3+i*.7;
                    disc(x+Math.round(Math.cos(ang)*rr),gy-h+Math.round(Math.sin(ang)*rr*.5),Math.max(1,Math.round(2*s)),i%2?a:b);
                }
                break;
        }
    }

    /* ---------- houses ---------- */
    function drawHouse(Bm,x,gy,p,l,s,now){
        var Hs=Bm.house, lit=clamp(night*1.4,0,1)*(Hs.lit?1:0);
        var w=Math.round((10+p.a*7)*s), hh=Math.round((8+p.c*6)*s);
        var wall=C(Hs.w,l), dark=C(Hs.d,l), roof=C(Hs.r,l), roofD=C(Hs.rd,l);
        var x0=x-(w>>1);
        var winC=lit>.15?rgb(mix([120,150,180],[255,206,110],lit)):C([126,152,174],l);
        switch(Hs.s){
            case 'modern': {
                var th=Math.round(hh*(1.6+p.a*2.6));
                px(x0,gy-th,w,th,wall); px(x0,gy-th,Math.max(1,w>>2),th,dark);
                for(var r=1;r<th-1;r+=3) for(var c=1;c<w-1;c+=3){
                    var on=hash2(p.wx+r*13,c*7)>(.42-lit*.34);
                    px(x0+c,gy-th+r,1,1,on?rgb(mix([90,110,130],[255,226,140],lit)):dark);
                }
                px(x0-1,gy-th-1,w+2,1,dark);
                if(p.d>.7) px(x,gy-th-4,1,4,dark),px(x,gy-th-5,1,1,rgb([255,80,80],.9));
                break; }
            case 'timber':
                px(x0,gy-hh,w,hh,wall);
                for(var i=1;i<w;i+=3) px(x0+i,gy-hh,1,hh,dark);
                px(x0,gy-hh+Math.round(hh/2),w,1,dark);
                for(var i=0;i<5;i++) px(x0-1-i,gy-hh-i*1.6,w+2+i*2,2,i?roof:roofD);
                break;
            case 'cottage':
                px(x0,gy-hh,w,hh,wall); px(x0,gy-3,w,3,dark);
                for(var i=0;i<4;i++) px(x0-2+i,gy-hh-i*1.7,w+4-i*2,2,i?roof:roofD);
                break;
            case 'pagoda':
                px(x0,gy-hh,w,hh,wall); px(x0,gy-hh,w,1,dark);
                for(var t=0;t<2;t++){
                    var yy=gy-hh-t*Math.round(hh*.55), ww=w+5-t*3;
                    px(x-(ww>>1),yy-2,ww,2,roof);
                    px(x-(ww>>1)-1,yy,ww+2,1,roofD);
                    if(t) px(x0+1,yy,w-2,Math.round(hh*.5),wall);
                }
                break;
            case 'adobe':
                px(x0,gy-hh,w,hh,wall); px(x0,gy-hh,w,2,roof);
                px(x0+1,gy-hh-1,w-2,1,roofD);
                for(var i=2;i<w-1;i+=4) px(x0+i,gy-hh+2,1,1,dark);
                break;
            case 'mush': {
                var cap=Math.round(w*.85);
                px(x-1,gy-hh,3,hh,wall);
                disc(x,gy-hh,cap>>1,roof);
                px(x-(cap>>1),gy-hh,cap,1,roofD);
                disc(x-2,gy-hh-1,1,C([255,255,255],l)); disc(x+2,gy-hh-2,1,C([255,255,255],l));
                break; }
            case 'stilt':
                px(x0+1,gy-4,1,4,dark); px(x0+w-2,gy-4,1,4,dark);
                px(x0,gy-hh-4,w,hh,wall);
                for(var i=0;i<3;i++) px(x0-1+i,gy-hh-4-i*1.5,w+2-i*2,2,i?roof:roofD);
                break;
            case 'barn':
                px(x0,gy-hh,w,hh,wall); px(x0,gy-hh,w,1,dark);
                px(x-1,gy-Math.round(hh*.7),2,Math.round(hh*.7),dark);
                for(var i=0;i<3;i++) px(x0-1+i,gy-hh-i*2,w+2-i*2,2,i?roof:roofD);
                break;
            case 'factory':
                px(x0,gy-hh,w,hh,wall);
                for(var i=0;i<w-2;i+=4){ tri(x0+i+2,gy-hh,4,3,roof); }
                for(var i=1;i<w-1;i+=3) px(x0+i,gy-hh+3,2,2,winC);
                break;
            case 'dome':
                disc(x,gy-2,Math.max(3,w>>1),wall);
                px(x-(w>>1),gy-1,w,2,dark);
                disc(x,gy-3,Math.max(2,(w>>1)-2),roof);
                px(x-1,gy-2,2,2,winC);
                break;
            case 'igloo':
                disc(x,gy,Math.max(3,w>>1),wall);
                px(x-(w>>1),gy+1,w,2,dark);
                disc(x,gy,Math.max(2,(w>>1)-2),roof);
                px(x-1,gy-1,3,2,dark);
                break;
            case 'ruin':
                px(x0,gy-hh,w,hh,wall);
                px(x0+Math.round(w*.4),gy-hh-2,Math.round(w*.3),2,dark);
                px(x0+1,gy-hh+1,2,3,dark); px(x0+w-4,gy-hh+2,2,4,dark);
                px(x0,gy-hh,w,1,dark);
                break;
        }
        /* door + window on ground-level styles */
        if(['cottage','timber','pagoda','adobe','barn','stilt','factory'].indexOf(Hs.s)>=0){
            var dy=Hs.s==='stilt'?gy-4:gy;
            px(x-1,dy-4,3,4,dark);
            if(w>8) px(x0+2,dy-hh+2,2,2,winC);
            if(lit>.2){ px(x0+1,dy-hh+1,4,4,rgb([255,214,130],lit*.18)); }
        }
    }

    /* ---------- towers ---------- */
    function drawTower(Bm,x,gy,p,l,s,now){
        var T=Bm.tower; if(!T) return;
        var a=C(T.a,l), b=C(T.b,l), acc=C(Bm.accent,l);
        var h=Math.round((20+p.a*16)*s), w=Math.max(3,Math.round(6*s));
        var lit=clamp(night*1.4,0,1);
        switch(T.s){
            case 'castle':
                px(x-(w>>1),gy-h,w,h,a);
                px(x-(w>>1),gy-h,2,h,b);
                for(var i=0;i<w;i+=2) px(x-(w>>1)+i,gy-h-2,1,2,a);
                px(x-(w>>1)-1,gy-h,w+2,1,b);
                if(lit>.2) px(x-1,gy-Math.round(h*.6),2,2,rgb(mix([80,90,110],[255,206,110],lit)));
                break;
            case 'wizard': {
                for(var i=0;i<h;i++){
                    var ww=Math.max(2,Math.round(w*(1-i/h*.35)))+ (Math.sin(i*.5)>0?0:0);
                    px(x-(ww>>1),gy-i,ww,1,i%5===0?b:a);
                }
                tri(x,gy-h,w+3,Math.round(h*.32),b);
                px(x,gy-h-Math.round(h*.32)-2,1,2,acc);
                disc(x,gy-h-Math.round(h*.32)-3,1,acc);
                if(lit>.15){ px(x-1,gy-Math.round(h*.55),2,2,rgb([255,226,140],lit)); disc(x,gy-Math.round(h*.55),3,rgb([255,226,140],lit*.15)); }
                break; }
            case 'sky': {
                var th=Math.round(h*1.5);
                px(x-(w>>1),gy-th,w,th,a);
                px(x-(w>>1),gy-th,1,th,b);
                for(var r=2;r<th-1;r+=3) for(var c=1;c<w-1;c+=2){
                    var on=hash2(p.wx+r*7,c*11)>(.45-lit*.35);
                    px(x-(w>>1)+c,gy-th+r,1,1,on?rgb(mix([90,110,130],[255,230,150],lit)):b);
                }
                px(x,gy-th-3,1,3,b); px(x,gy-th-4,1,1,rgb([255,90,90],.85));
                break; }
            case 'silo':
                px(x-(w>>1),gy-h,w,h,a);
                px(x-(w>>1),gy-h,1,h,b);
                for(var i=2;i<h;i+=4) px(x-(w>>1),gy-i,w,1,b);
                disc(x,gy-h,(w>>1)+1,b);
                break;
            case 'light':
                for(var i=0;i<h;i++){ var ww=Math.max(2,Math.round(w*(1-i/h*.4))); px(x-(ww>>1),gy-i,ww,1,(Math.floor(i/3)%2)?a:b); }
                px(x-2,gy-h-3,5,3,b);
                { var on=(now/900|0)%2===0;
                    px(x-1,gy-h-2,3,1,on?rgb([255,240,170]):a);
                    if(on){ disc(x,gy-h-2,7,rgb([255,240,170],.10)); px(x+2,gy-h-2,14,1,rgb([255,240,170],.14)); } }
                break;
            case 'stack':
                px(x-(w>>1),gy-h,w,h,a);
                px(x-(w>>1),gy-h,1,h,b);
                px(x-(w>>1)-1,gy-h,w+2,2,b);
                if(!reduceMotion) for(var i=0;i<4;i++){
                    var t=((now/1100)+i*.25)%1;
                    px(x+Math.round(Math.sin(t*4+i)*3),gy-h-2-t*16,1+(t>.5?1:0),1,rgb(mix([90,90,96],[40,40,46],t),(1-t)*.5));
                }
                break;
            case 'antenna':
                px(x-1,gy-h,2,h,a);
                for(var i=1;i<4;i++) px(x-3,gy-h+i*Math.round(h/4),7,1,b);
                disc(x,gy-h-2,2,C(Bm.accent,l));
                if(!reduceMotion){ var pl=.4+.6*Math.abs(Math.sin(now/500)); disc(x,gy-h-2,4,rgb(tint(Bm.accent),pl*.22)); }
                break;
        }
    }

    /* ---------- rocks ---------- */
    function drawRock(Bm,x,gy,p,l,s){
        var c=C(Bm.rockC,l), d=rgb(mix(tint(Bm.rockC),[0,0,0],.28));
        var w=Math.max(2,Math.round((3+p.a*5)*s)), h=Math.max(1,Math.round((2+p.c*3)*s));
        px(x-(w>>1),gy-h,w,h,c);
        px(x-(w>>1),gy-1,w,1,d);
        px(x-(w>>1)+1,gy-h,Math.max(1,w-3),1,rgb(mix(tint(Bm.rockC),[255,255,255],.18)));
    }

    /* ---------- small details ---------- */
    function drawSmall(Bm,x,gy,p,l,s,now){
        var kind=Bm.small[Math.floor(p.a*Bm.small.length)%Bm.small.length];
        var acc=C(Bm.accent,l), lit=clamp(night*1.4,0,1);
        var sway=reduceMotion?0:Math.round(Math.sin(now/800+p.wx*.1)*.6);
        switch(kind){
            case 'flower':
                px(x,gy-2,1,2,C([90,150,80],l)); px(x+sway,gy-3,1,1,acc); break;
            case 'glowflower':
                px(x,gy-3,1,3,C([90,150,120],l));
                disc(x+sway,gy-4,1,acc);
                if(night>.2) disc(x+sway,gy-4,3,rgb(tint(Bm.accent),night*.20));
                break;
            case 'bush':
                disc(x,gy-1,Math.max(1,Math.round(2*s)),C(Bm.tree?Bm.tree.a:[70,120,70],l));
                disc(x-1,gy-2,Math.max(1,Math.round(1.4*s)),C(Bm.tree?Bm.tree.b:[100,160,90],l)); break;
            case 'fence':
                for(var i=0;i<4;i++) px(x+i*3,gy-3,1,3,C([120,92,60],l));
                px(x,gy-3,10,1,C([140,108,72],l)); px(x,gy-1,10,1,C([120,92,60],l)); break;
            case 'crops':
                for(var i=0;i<6;i++){ var hh=3+((i*7+p.wx)%3); px(x+i*2,gy-hh,1,hh,C([180,160,70],l)); px(x+i*2+sway,gy-hh-1,1,1,acc);} break;
            case 'hay':
                disc(x,gy-2,Math.max(2,Math.round(2.6*s)),C([200,175,95],l));
                px(x-3,gy-2,7,1,C([170,145,75],l)); break;
            case 'bones':
                px(x-3,gy-1,7,1,C([224,214,190],l)); px(x-3,gy-2,1,1,C([224,214,190],l)); px(x+3,gy-2,1,1,C([224,214,190],l)); break;
            case 'skull':
                disc(x,gy-2,2,C([228,220,198],l)); px(x-1,gy-2,1,1,C([60,50,44],l)); px(x+1,gy-2,1,1,C([60,50,44],l)); break;
            case 'rock': drawRock(Bm,x,gy,p,l,s*.7); break;
            case 'obsidian':
                tri(x,gy,Math.max(2,Math.round(3*s)),Math.max(3,Math.round(6*s)),C([40,30,40],l));
                px(x,gy-4,1,2,C([120,60,90],l)); break;
            case 'lava': {
                var pulse=.55+.45*Math.sin(now/420+p.wx);
                px(x-3,gy-1,7,1,rgb(mix([255,120,40],[255,220,120],pulse)));
                disc(x,gy-1,5,rgb([255,120,40],.10*pulse)); break; }
            case 'ember': {
                var t=((now/1400)+p.a)%1;
                px(x,gy-2-t*14,1,1,rgb([255,150,60],(1-t)*.9)); break; }
            case 'crystal': {
                var hh=Math.max(3,Math.round((4+p.c*5)*s));
                tri(x,gy,Math.max(2,Math.round(2.6*s)),hh,acc);
                if(night>.15) disc(x,gy-hh/2,hh,rgb(tint(Bm.accent),night*.13));
                break; }
            case 'rune':
                px(x-2,gy-1,5,1,C([90,84,140],l));
                px(x,gy-3,1,2,rgb(tint(Bm.accent),.5+.5*Math.sin(now/700+p.wx))); break;
            case 'candle':
                px(x,gy-3,1,3,C([220,210,190],l));
                px(x,gy-4,1,1,rgb([255,200,90],.6+.4*Math.sin(now/220+p.wx)));
                if(night>.2) disc(x,gy-4,3,rgb([255,200,90],night*.16)); break;
            case 'mushroom': {
                var hh=Math.max(2,Math.round((3+p.c*4)*s));
                px(x,gy-hh,1,hh,C([230,220,240],l));
                disc(x,gy-hh,Math.max(1,Math.round(2*s)),C(Bm.house?Bm.house.r:[255,110,150],l));
                if(night>.2) disc(x,gy-hh,Math.max(3,Math.round(4*s)),rgb(tint(Bm.accent),night*.14));
                break; }
            case 'toadstool':
                px(x,gy-2,1,2,C([200,196,180],l)); disc(x,gy-2,1,C([180,70,60],l)); break;
            case 'lantern':
                px(x,gy-6,1,6,C([90,70,50],l));
                px(x-1,gy-8,3,3,rgb(mix(tint([200,90,70]),[255,200,120],lit)));
                if(lit>.15) disc(x,gy-7,5,rgb([255,190,110],lit*.18)); break;
            case 'banner':
                px(x,gy-9,1,9,C([90,70,50],l));
                px(x+1,gy-9,4,5,C(Bm.accent,l)); px(x+1,gy-4,4,1,C(Bm.accent,l)); break;
            case 'barrel':
                px(x-2,gy-4,4,4,C([130,96,58],l)); px(x-2,gy-3,4,1,C([100,72,44],l)); break;
            case 'crate':
                px(x-2,gy-4,5,4,C([150,124,86],l)); px(x-2,gy-2,5,1,C([116,94,64],l)); break;
            case 'pipe':
                px(x-1,gy-5,3,5,C([120,116,110],l)); px(x-2,gy-6,5,1,C([148,144,138],l)); break;
            case 'gear':
                disc(x,gy-3,Math.max(2,Math.round(2.4*s)),C([140,120,90],l));
                px(x-4,gy-3,9,1,C([140,120,90],l)); px(x,gy-7,1,9,C([140,120,90],l)); break;
            case 'panel':
                px(x-3,gy-4,7,3,C([90,110,140],l)); px(x-3,gy-4,7,1,C(Bm.accent,l)); px(x,gy-1,1,1,C([80,76,100],l)); break;
            case 'probe':
                px(x,gy-4,1,4,C([160,150,180],l)); disc(x,gy-5,1,C(Bm.accent,l));
                if(!reduceMotion) disc(x,gy-5,3,rgb(tint(Bm.accent),.10+.10*Math.sin(now/400))); break;
            case 'streetlight': {
                var hh=Math.round(11*s);
                px(x,gy-hh,1,hh,C([70,74,82],l)); px(x,gy-hh,3,1,C([70,74,82],l));
                px(x+2,gy-hh+1,1,1,rgb(mix([120,124,132],[255,226,150],lit)));
                if(lit>.15){ disc(x+2,gy-hh+2,6,rgb([255,220,140],lit*.13)); }
                break; }
            case 'car': {
                var col=[[200,70,70],[70,110,200],[220,200,90],[230,230,235]][Math.floor(p.c*4)%4];
                px(x-4,gy-3,9,2,C(col,l)); px(x-2,gy-5,5,2,C(col,l));
                px(x-3,gy-1,2,1,C([30,30,34],l)); px(x+2,gy-1,2,1,C([30,30,34],l));
                if(lit>.3) px(x+5,gy-3,1,1,rgb([255,240,190],lit)); break; }
            case 'hydrant': px(x,gy-3,2,3,C([200,70,60],l)); px(x-1,gy-4,4,1,C([200,70,60],l)); break;
            case 'column': {
                var hh=Math.max(4,Math.round((7+p.c*9)*s));
                px(x-1,gy-hh,3,hh,C([190,184,166],l));
                px(x-1,gy-hh,1,hh,C([160,154,138],l));
                px(x-2,gy-hh-1,5,1,C([200,194,176],l)); px(x-2,gy-1,5,1,C([200,194,176],l));
                break; }
            case 'rubble':
                px(x-3,gy-1,3,1,C([170,164,150],l)); px(x+1,gy-2,2,2,C([150,144,130],l)); break;
            case 'grave':
                px(x-1,gy-4,3,4,C([150,150,156],l)); px(x-2,gy-4,5,1,C([150,150,156],l));
                px(x,gy-3,1,1,C([100,100,108],l)); break;
            case 'icespike':
                tri(x,gy,Math.max(2,Math.round(2.4*s)),Math.max(3,Math.round(7*s)),C([200,232,248],l)); break;
            case 'snowman':
                disc(x,gy-2,2,C([245,250,255],l)); disc(x,gy-5,1,C([245,250,255],l));
                px(x-1,gy-5,1,1,C([40,40,50],l)); px(x+1,gy-5,1,1,C([40,40,50],l));
                px(x,gy-5,1,1,C([230,120,50],l)); break;
            case 'reed':
                for(var i=0;i<3;i++){ px(x+i*2+sway,gy-5-i,1,5+i,C([110,140,80],l)); px(x+i*2+sway,gy-6-i,1,1,C([120,90,60],l)); } break;
            case 'lily':
                px(x-2,gy,5,1,C([80,120,70],l)); px(x,gy-1,1,1,C([240,230,250],l)); break;
            case 'shell':
                disc(x,gy-1,1,C([240,220,215],l)); break;
            case 'crab':
                px(x-1,gy-1,3,1,C([210,90,70],l)); px(x-2,gy-2,1,1,C([210,90,70],l)); px(x+2,gy-2,1,1,C([210,90,70],l)); break;
            case 'buoy':
                px(x,gy-4,2,4,C([220,80,60],l)); px(x,gy-5,2,1,C([240,240,240],l)); break;
            default:
                drawRock(Bm,x,gy,p,l,s*.7);
        }
    }

    /* ---------- biome signature landmarks ---------- */
    function drawSig(Bm,x,gy,p,l,s,now){
        var acc=C(Bm.accent,l), lit=clamp(night*1.4,0,1);
        switch(Bm.sig){
            case 'well':
                px(x-4,gy-4,9,4,C([140,134,120],l)); px(x-4,gy-4,9,1,C([170,164,150],l));
                px(x-4,gy-10,1,6,C([110,84,54],l)); px(x+4,gy-10,1,6,C([110,84,54],l));
                px(x-5,gy-11,11,2,C([130,80,60],l)); px(x,gy-8,1,3,C([90,80,70],l)); break;
            case 'gate':
                px(x-9,gy-14,4,14,C([150,146,138],l)); px(x+6,gy-14,4,14,C([150,146,138],l));
                px(x-9,gy-16,19,2,C([130,126,118],l));
                for(var i=0;i<19;i+=3) px(x-9+i,gy-18,2,2,C([150,146,138],l));
                px(x-4,gy-9,9,9,C([90,64,44],l)); px(x,gy-9,1,9,C([70,48,32],l));
                px(x-1,gy-19,3,4,C(Bm.accent,l)); break;
            case 'obelisk': {
                var hh=Math.round(26*s);
                for(var i=0;i<hh;i++){ var ww=Math.max(2,Math.round(5*(1-i/hh*.45))); px(x-(ww>>1),gy-i,ww,1,i%6===0?C([170,140,100],l):C([196,166,120],l)); }
                tri(x,gy-hh,4,4,C([214,186,140],l));
                px(x-1,gy-Math.round(hh*.6),3,1,acc); break; }
            case 'torii': {
                var hh=Math.round(15*s), w=Math.round(14*s);
                px(x-(w>>1),gy-hh,3,hh,C([200,60,60],l)); px(x+(w>>1)-2,gy-hh,3,hh,C([200,60,60],l));
                px(x-(w>>1)-3,gy-hh,w+6,3,C([214,70,70],l));
                px(x-(w>>1)-1,gy-hh+5,w+2,2,C([200,60,60],l));
                px(x-(w>>1)-4,gy-hh-2,w+8,2,C([40,34,40],l)); break; }
            case 'portal': {
                var hh=Math.round(16*s), pulse=.55+.45*Math.sin(now/600+p.wx);
                for(var i=0;i<hh;i++){
                    var ww=Math.round(7*Math.sin(i/hh*Math.PI))+1;
                    px(x-(ww>>1),gy-i,ww,1,rgb(mix(tint(Bm.accent),[255,255,255],.25*pulse),.55+.35*pulse));
                }
                px(x-5,gy-hh,2,hh,C([70,60,100],l)); px(x+4,gy-hh,2,hh,C([70,60,100],l));
                disc(x,gy-Math.round(hh*.55),Math.round(9*s),rgb(tint(Bm.accent),.10*pulse)); break; }
            case 'monolith': {
                var hh=Math.round(24*s);
                px(x-3,gy-hh,7,hh,C([56,52,84],l)); px(x-3,gy-hh,2,hh,C([74,68,110],l));
                for(var i=3;i<hh;i+=5) px(x-1,gy-i,3,1,rgb(tint(Bm.accent),.4+.4*Math.sin(now/700+i)));
                if(night>.2) disc(x,gy-hh/2,Math.round(11*s),rgb(tint(Bm.accent),night*.10)); break; }
            case 'arch': {
                var hh=Math.round(16*s), w=Math.round(16*s);
                px(x-(w>>1),gy-hh,4,hh,C([186,180,162],l)); px(x+(w>>1)-3,gy-hh+3,4,hh-3,C([186,180,162],l));
                for(var i=0;i<6;i++){ var yy=gy-hh-2+i, ww=w-i*2; px(x-(ww>>1),yy,ww,1,C([196,190,172],l)); }
                px(x+(w>>1)-3,gy-hh,4,2,C([160,154,138],l)); break; }
            case 'windmill': {
                var hh=Math.round(22*s);
                for(var i=0;i<hh;i++){ var ww=Math.max(3,Math.round(8*(1-i/hh*.4))); px(x-(ww>>1),gy-i,ww,1,C([224,216,196],l)); }
                px(x-2,gy-6,4,6,C([120,90,60],l));
                var ang=reduceMotion?.6:now/2600;
                for(var b=0;b<4;b++){
                    var a2=ang+b*Math.PI/2;
                    for(var r=2;r<Math.round(11*s);r++)
                        px(x+Math.round(Math.cos(a2)*r),gy-hh+Math.round(Math.sin(a2)*r),1,1,C([150,116,78],l));
                }
                disc(x,gy-hh,1,C([90,70,50],l)); break; }
            case 'lighthouse': drawTower(Bm,x,gy,p,l,s,now); break;
            case 'wreck': {
                px(x-8,gy-3,17,3,C([90,70,54],l));
                px(x-6,gy-9,2,7,C([110,86,64],l)); px(x+3,gy-7,2,5,C([110,86,64],l));
                px(x-5,gy-9,7,1,C([80,62,48],l)); break; }
            case 'shrine':
                px(x-4,gy-6,9,6,C([110,104,88],l)); px(x-5,gy-8,11,2,C([90,84,70],l));
                px(x-1,gy-5,3,4,C([50,46,40],l));
                px(x,gy-4,1,1,rgb(tint(Bm.accent),.5+.5*Math.sin(now/600))); break;
            case 'forge': {
                px(x-6,gy-8,13,8,C([60,48,50],l)); px(x-6,gy-8,13,1,C([84,68,70],l));
                var pulse=.5+.5*Math.sin(now/380);
                px(x-2,gy-5,5,4,rgb(mix([255,110,40],[255,220,130],pulse)));
                disc(x,gy-4,9,rgb([255,120,50],.13*pulse));
                px(x+3,gy-14,3,6,C([70,56,58],l));
                if(!reduceMotion) for(var i=0;i<3;i++){ var t=((now/900)+i*.33)%1; px(x+4,gy-15-t*12,1,1,rgb([120,110,110],(1-t)*.5)); }
                break; }
            case 'gearworks': {
                px(x-7,gy-10,15,10,C([88,84,80],l));
                var ang=reduceMotion?0:now/1400;
                for(var k=0;k<2;k++){
                    var cx=x-3+k*7, r=3;
                    disc(cx,gy-5,r,C([140,120,90],l));
                    for(var t2=0;t2<6;t2++){ var a2=ang*(k?-1:1)+t2*1.047;
                        px(cx+Math.round(Math.cos(a2)*(r+1)),gy-5+Math.round(Math.sin(a2)*(r+1)),1,1,C([160,138,104],l)); }
                }
                break; }
            case 'dish': {
                px(x,gy-10,2,10,C([150,142,170],l));
                for(var i=0;i<7;i++){ var ww=7-Math.abs(i-3)*1.4; px(x-3+Math.round(Math.abs(i-3)*.6),gy-14-i+3,Math.max(1,Math.round(ww)),1,C([190,182,210],l)); }
                px(x+1,gy-13,1,3,C(Bm.accent,l));
                if(night>.2) disc(x,gy-13,7,rgb(tint(Bm.accent),night*.10)); break; }
            case 'wolfrock': {
                tri(x,gy,Math.round(10*s),Math.round(12*s),C([120,134,150],l));
                tri(x,gy-Math.round(8*s),Math.round(5*s),Math.round(5*s),C([220,238,250],l)); break; }
            default:
                drawRock(Bm,x,gy,p,l,s);
        }
    }

    /* ---------- far silhouettes ---------- */
    function farSil(Bm,x,gy,p,now){
        var c=CF(Bm.pal[0]), c2=CF(mix(Bm.pal[0],[255,255,255],.18));
        var s=.6+p.a*.8;
        switch(Bm.far){
            case 'hills': disc(x,gy+3,Math.round(14*s),c); break;
            case 'peaks': case 'snowpeaks': {
                var hh=Math.round(30*s);
                tri(x,gy,Math.round(30*s),hh,c);
                if(Bm.far==='snowpeaks') tri(x,gy-hh+Math.round(hh*.34),Math.round(11*s),Math.round(hh*.34),c2);
                break; }
            case 'mesa': {
                var hh=Math.round(18*s), w=Math.round(26*s);
                px(x-(w>>1),gy-hh,w,hh,c); px(x-(w>>1),gy-hh,w,2,c2); break; }
            case 'castle': {
                var hh=Math.round(24*s);
                px(x-14,gy-hh*.6,28,hh*.6,c);
                for(var i=0;i<28;i+=4) px(x-14+i,gy-hh*.6-2,2,2,c);
                px(x-6,gy-hh,5,hh,c); px(x+3,gy-hh*.85,5,hh*.85,c);
                tri(x-4,gy-hh,7,5,c); tri(x+5,gy-hh*.85,7,5,c); break; }
            case 'skyline': {
                var hh=Math.round((22+p.c*30)*s), w=Math.round((7+p.a*7));
                px(x-(w>>1),gy-hh,w,hh,c);
                var lit=clamp(night*1.5,0,1);
                if(lit>.1) for(var r=2;r<hh-1;r+=3) for(var cc=1;cc<w-1;cc+=2)
                    if(hash2(p.wx+r*5,cc*3)>.55) px(x-(w>>1)+cc,gy-hh+r,1,1,rgb([255,226,150],lit*.5));
                px(x,gy-hh-3,1,3,c); break; }
            case 'spires': {
                var hh=Math.round((26+p.c*18)*s);
                for(var i=0;i<hh;i++){ var ww=Math.max(1,Math.round(6*(1-i/hh))); px(x-(ww>>1),gy-i,ww,1,c); }
                tri(x,gy-hh,5,7,c); break; }
            case 'brokentowers': {
                var hh=Math.round((16+p.c*14)*s);
                px(x-3,gy-hh,7,hh,c);
                px(x-3,gy-hh,3,3,c2);
                px(x+5,gy-Math.round(hh*.5),3,Math.round(hh*.5),c); break; }
            case 'isles': {
                var w=Math.round(18*s);
                disc(x,gy+2,w>>1,c);
                if(p.c>.55){ px(x-2,gy-6,1,6,c); disc(x-2,gy-7,2,c2); }
                break; }
            case 'volcano': {
                var hh=Math.round(34*s), w=Math.round(40*s);
                tri(x,gy,w,hh,c);
                px(x-3,gy-hh,7,2,rgb(mix(tint([255,90,40]),hazeCol,.35),.85));
                if(!reduceMotion) for(var i=0;i<3;i++){ var t=((now/2200)+i*.33)%1;
                    px(x+Math.round(Math.sin(t*5+i)*5),gy-hh-2-t*22,1+(t>.6?1:0),1,rgb([90,80,84],(1-t)*.45)); }
                break; }
            case 'stacks': {
                var hh=Math.round((24+p.c*14)*s);
                px(x-2,gy-hh,5,hh,c); px(x-3,gy-hh,7,2,c2);
                if(!reduceMotion) for(var i=0;i<3;i++){ var t=((now/1800)+i*.33)%1;
                    px(x+Math.round(Math.sin(t*4+i)*4),gy-hh-2-t*18,1,1,rgb([110,105,100],(1-t)*.4)); }
                break; }
            case 'domes': {
                disc(x,gy+1,Math.round(11*s),c);
                if(p.c>.6){ px(x+6,gy-9,1,9,c); disc(x+6,gy-10,2,c2); }
                break; }
            case 'mist': {
                px(x-14,gy-6,28,6,rgb(mix(tint(Bm.pal[0]),hazeCol,.6),.5));
                disc(x,gy-2,Math.round(10*s),c); break; }
            default: disc(x,gy+3,Math.round(12*s),c);
        }
    }

    /* ============================================================
          6b. WORLD EVENTS  (the easter eggs)
          ============================================================ */
    function drawEvent(ev,Bm,x,gy,p,now){
        var lit=clamp(night*1.4,0,1);
        var bob=reduceMotion?0:Math.sin(now/900+p.a*6)*2;
        switch(ev){

        case 'ufo': {                      /* farmland abduction */
            var hy=gy-34+Math.round(bob);
            var beam=.5+.5*Math.sin(now/1300+p.a*6);
            /* beam */
            for(var i=0;i<32;i++){
                var t=i/32, ww=2+t*9;
                px(x-(ww>>1),hy+4+i,ww,1,rgb([180,255,200],(.30-t*.22)*beam));
            }
            /* cow, rising and spinning */
            var cy=gy-4-beam*22, spin=Math.sin(now/300)>0;
            px(x-3,cy-3,7,3,rgb(tint([245,245,245])));
            px(spin?x-3:x+1,cy-3,3,2,rgb(tint([40,36,40])));
            px(x-2,cy,1,1,rgb(tint([220,220,220]))); px(x+2,cy,1,1,rgb(tint([220,220,220])));
            px(spin?x-4:x+4,cy-4,1,1,rgb(tint([245,245,245])));
            /* saucer */
            disc(x,hy,9,rgb(tint([150,158,176])));
            px(x-9,hy,19,2,rgb(tint([110,118,138])));
            disc(x,hy-3,4,rgb(mix(tint([170,220,255]),[220,255,255],.4)));
            for(var i=0;i<5;i++){
                var a2=now/500+i*1.26;
                px(x+Math.round(Math.cos(a2)*7),hy+1,1,1,rgb([255,240,140],.5+.5*Math.sin(now/200+i)));
            }
            disc(x,hy,16,rgb([160,255,200],.06*beam));
            break; }

        case 'parade': {                   /* marchers with flags */
            var n=6;
            for(var i=0;i<n;i++){
                var off=((now/34)+i*17)%150;
                var mx=Math.round(x-70+off), step=Math.floor(now/160+i)%2;
                var my=gy;
                var col=[[210,80,80],[80,120,210],[230,200,90],[120,200,130],[200,120,210],[240,240,240]][i%6];
                px(mx,my-6,2,4,rgb(tint(col)));
                px(mx,my-8,2,2,rgb(tint([240,208,170])));
                px(mx,my-2,1,2,rgb(tint([50,44,50]))); px(mx+1,my-2,1,2,rgb(tint(step?[50,44,50]:[70,64,70])));
                if(i%2===0){ px(mx+2,my-13,1,7,rgb(tint([120,90,60]))); px(mx+3,my-13,4,3,rgb(tint(Bm.accent))); }
            }
            if(!reduceMotion) for(var i=0;i<8;i++){
                var t=((now/1600)+i*.125)%1;
                px(x-60+((i*37)%120),gy-30-t*10,1,1,rgb([255,220,120],(1-t)*.7));
            }
            break; }

        case 'dragon': {
            var dx=x+Math.sin(now/2600+p.a*6)*70, dy=gy-70+Math.sin(now/1400+p.a*6)*12;
            var flap=Math.sin(now/220)>0?-3:2;
            var c=rgb(tint(p.c>.5?[150,60,70]:[70,80,140]));
            px(dx-6,dy,13,2,c);
            px(dx+6,dy-1,3,2,c); px(dx+8,dy-2,2,2,c);
            px(dx-9,dy,4,1,c);
            px(dx-2,dy+flap,5,Math.abs(flap),c);
            px(dx+1,dy-flap,5,Math.abs(flap),c);
            px(dx+9,dy-1,1,1,rgb([255,200,60],.9));
            break; }

        case 'knight': {
            var off=((now/40)+p.a*100)%180, mx=Math.round(x-90+off);
            px(mx,gy-9,3,5,rgb(tint([180,186,196])));
            px(mx,gy-12,3,3,rgb(tint([200,206,216])));
            px(mx+1,gy-12,1,1,rgb(tint([40,40,50])));
            px(mx+3,gy-16,1,10,rgb(tint([140,120,90])));
            px(mx+3,gy-16,4,3,rgb(tint(Bm.accent)));
            px(mx,gy-4,1,4,rgb(tint([60,54,60]))); px(mx+2,gy-4,1,4,rgb(tint([60,54,60])));
            break; }

        case 'whale': {
            var t=(now/9000+p.a)%1;
            var wx2=x-60+t*120, arc=Math.sin(t*Math.PI);
            var wy=waterY-arc*26+8;
            var c=rgb(tint([70,96,130])), c2=rgb(tint([120,150,180]));
            disc(wx2,wy,7,c); px(wx2-9,wy+1,20,4,c);
            px(wx2-11,wy-2,5,3,c);          /* tail */
            px(wx2+6,wy+1,8,2,c2);
            px(wx2+4,wy-2,1,1,rgb(tint([240,240,250])));
            if(arc>.7){ for(var i=0;i<7;i++) px(wx2+2,wy-8-i,1,1,rgb([220,240,255],(1-i/7)*.7)); }
            break; }

        case 'ship': {
            var wx2=x+Math.sin(now/6000+p.a*6)*40, wy=waterY-2+Math.sin(now/900)*1;
            var c=rgb(tint([104,74,50])), s2=rgb(tint([238,234,224]));
            px(wx2-8,wy-3,17,3,c); px(wx2-6,wy-4,13,1,rgb(tint([130,96,66])));
            px(wx2,wy-16,1,13,c);
            px(wx2-6,wy-15,6,10,s2); px(wx2+1,wy-13,6,8,s2);
            px(wx2,wy-17,4,2,rgb(tint(Bm.accent)));
            break; }

        case 'kraken': {
            var t=(now/11000+p.a)%1;
            if(t<.55){
                var a2=Math.sin(t/.55*Math.PI);
                for(var k=0;k<4;k++){
                    var bx=x-18+k*12, len=Math.round(16*a2*(.6+k*.13));
                    for(var i=0;i<len;i++)
                        px(bx+Math.round(Math.sin(i*.4+k+now/600)*3),waterY-i,2,1,rgb(tint([90,60,110])));
                    px(bx,waterY-len,2,2,rgb(tint([120,80,150])));
                }
            }
            break; }

        case 'airship': {
            var ax=x+Math.sin(now/5000+p.a*6)*60, ay=gy-58+Math.sin(now/1700)*4;
            var c=rgb(tint([176,150,110])), c2=rgb(tint([130,108,78]));
            disc(ax,ay,6,c); px(ax-13,ay-4,27,9,c); px(ax-13,ay+3,27,2,c2);
            px(ax-4,ay+5,9,4,rgb(tint([110,84,58])));
            px(ax+13,ay-1,4,3,c2);
            if(!reduceMotion) px(ax-16,ay+1,3,1,rgb(tint([90,80,70])));
            for(var i=0;i<3;i++) px(ax-9+i*8,ay+5,1,1,rgb([255,220,140],lit));
            break; }

        case 'blimp': case 'satellite': {
            var ax=x+Math.sin(now/6000+p.a*6)*70, ay=gy-72;
            px(ax-9,ay,19,7,rgb(tint([220,220,230])));
            px(ax-9,ay+5,19,2,rgb(tint([180,180,195])));
            px(ax-3,ay+7,7,3,rgb(tint([80,84,96])));
            px(ax-4,ay+2,9,2,rgb(tint(Bm.accent)));
            break; }

        case 'helicopter': case 'drone': {
            var ax=x+Math.sin(now/2200+p.a*6)*46, ay=gy-52+Math.sin(now/700)*3;
            var c=rgb(tint([90,96,110]));
            px(ax-4,ay,9,4,c); px(ax+4,ay+1,6,1,c);
            var spin=Math.floor(now/60)%2;
            px(ax-(spin?8:3),ay-2,spin?17:7,1,rgb(tint([150,156,170])));
            px(ax,ay-3,1,1,c);
            if(lit>.2) px(ax-4,ay+2,1,1,rgb([255,90,90],lit));
            break; }

        case 'balloon': {
            var ax=x+Math.sin(now/4000+p.a*6)*36, ay=gy-64+Math.sin(now/2000)*7;
            var c1=rgb(tint([225,90,90])), c2=rgb(tint([240,225,200]));
            for(var i=-7;i<=7;i++){
                var ww=Math.round(Math.sqrt(Math.max(0,49-i*i)));
                px(ax-ww,ay+i,ww*2+1,1,(Math.floor((i+7)/3)%2)?c1:c2);
            }
            px(ax-2,ay+8,5,1,rgb(tint([120,96,64])));
            px(ax-2,ay+9,5,4,rgb(tint([150,116,76])));
            break; }

        case 'rift': {                     /* a tear showing another reality */
            var rx=x, ry=gy-30+bob, pulse=.55+.45*Math.sin(now/700+p.a*6);
            var other=BIOMES[Math.floor(hash1(Math.floor(p.wx/97))*BIOMES.length)%BIOMES.length];
            for(var i=-14;i<=14;i++){
                var ww=Math.round(Math.cos(i/14*1.55)*7*pulse);
                if(ww<1) continue;
                px(rx-ww,ry+i,ww*2,1,rgb(mix(other.pal[3],other.sky[0],.5)));
            }
            for(var i=-15;i<=15;i++){
                var ww=Math.round(Math.cos(i/15*1.55)*8*pulse);
                px(rx-ww-1,ry+i,1,1,rgb(mix(tint(Bm.accent),[255,255,255],.4),.9));
                px(rx+ww,ry+i,1,1,rgb(mix(tint(Bm.accent),[255,255,255],.4),.9));
            }
            disc(rx,ry,Math.round(20*pulse),rgb(tint(Bm.accent),.08));
            break; }

        case 'pixie': case 'crane': case 'raven': case 'vulture': case 'heron': {
            var n=ev==='pixie'?5:3;
            for(var i=0;i<n;i++){
                var t=((now/7000)+i*.14+p.a)%1;
                var bx=x-80+t*160, by=gy-40-Math.sin(t*Math.PI)*22+Math.sin(now/300+i)*2;
                if(ev==='pixie'){
                    px(bx,by,1,1,rgb(tint(Bm.accent)));
                    disc(bx,by,3,rgb(tint(Bm.accent),.16+.10*Math.sin(now/200+i)));
                }else{
                    var up=Math.sin(now/180+i)>0?-1:1;
                    var c=rgb(tint(ev==='crane'?[240,240,244]:ev==='raven'?[36,32,40]:[70,60,54]));
                    px(bx,by,1,1,c); px(bx-1,by+up,1,1,c); px(bx+1,by+up,1,1,c);
                }
            }
            break; }

        case 'deer': case 'mammoth': case 'sled': case 'tractor': case 'caravan': case 'cart': {
            var off=((now/(ev==='mammoth'?70:46))+p.a*200)%260, mx=Math.round(x-130+off);
            if(ev==='deer'){
                var c=rgb(tint([150,104,66]));
                px(mx,gy-6,7,3,c); px(mx+6,gy-9,2,4,c); px(mx+5,gy-11,1,2,c); px(mx+8,gy-11,1,2,c);
                var st=Math.floor(now/200)%2;
                px(mx+1,gy-3,1,3,c); px(mx+5,gy-3,1,3,c); px(mx+(st?2:4),gy-3,1,3,c);
            }else if(ev==='mammoth'){
                var c=rgb(tint([120,86,70]));
                px(mx,gy-11,15,8,c); px(mx+14,gy-10,4,5,c);
                px(mx+16,gy-6,4,1,rgb(tint([230,226,210])));
                px(mx+2,gy-3,2,3,c); px(mx+10,gy-3,2,3,c);
            }else if(ev==='tractor'){
                px(mx,gy-7,11,4,rgb(tint([200,80,60])));
                px(mx+7,gy-11,5,4,rgb(tint([200,80,60])));
                disc(mx+2,gy-2,2,rgb(tint([50,46,50]))); disc(mx+9,gy-3,3,rgb(tint([50,46,50])));
                if(!reduceMotion) for(var i=0;i<2;i++){ var t=((now/700)+i*.5)%1; px(mx+9,gy-13-t*8,1,1,rgb([120,110,105],(1-t)*.5)); }
            }else if(ev==='sled'){
                px(mx,gy-4,11,3,rgb(tint([140,100,60]))); px(mx-1,gy-1,13,1,rgb(tint([180,190,205])));
                px(mx+3,gy-8,3,4,rgb(tint([200,80,80])));
                for(var d2=0;d2<2;d2++){ var dx2=mx+13+d2*6, st=Math.floor(now/160+d2)%2;
                    px(dx2,gy-5,5,3,rgb(tint([200,196,190]))); px(dx2+4,gy-7,2,2,rgb(tint([200,196,190])));
                    px(dx2+1,gy-2,1,2,rgb(tint([170,166,160]))); px(dx2+(st?2:3),gy-2,1,2,rgb(tint([170,166,160]))); }
            }else{ /* caravan / cart */
                var c=rgb(tint([150,116,72]));
                px(mx,gy-8,13,5,c); px(mx,gy-10,13,2,rgb(tint(Bm.accent)));
                disc(mx+3,gy-2,2,rgb(tint([90,70,50]))); disc(mx+10,gy-2,2,rgb(tint([90,70,50])));
                if(ev==='caravan'){ var cx2=mx+17; px(cx2,gy-9,5,5,rgb(tint([190,160,110]))); px(cx2+4,gy-12,2,4,rgb(tint([190,160,110])));
                    px(cx2+1,gy-4,1,4,rgb(tint([170,140,95]))); px(cx2+3,gy-4,1,4,rgb(tint([170,140,95]))); }
            }
            break; }

        case 'ghost': case 'witch': case 'moonbeast': {
            var t=(now/6000+p.a)%1;
            var gx=x-50+t*100, gy2=gy-26+Math.sin(now/700)*4;
            if(ev==='witch'){
                px(gx-5,gy2+3,13,1,rgb(tint([110,86,58])));
                px(gx,gy2-4,3,7,rgb(tint([60,50,80])));
                tri(gx+1,gy2-4,7,4,rgb(tint([60,50,80])));
                px(gx+1,gy2-1,1,1,rgb(tint([250,220,190])));
            }else{
                var a2=.55+.25*Math.sin(now/800);
                disc(gx,gy2,4,rgb([230,235,255],a2*.55));
                px(gx-4,gy2,9,4,rgb([230,235,255],a2*.4));
                px(gx-2,gy2-1,1,1,rgb([40,40,60],a2)); px(gx+2,gy2-1,1,1,rgb([40,40,60],a2));
            }
            break; }

        case 'meteor': case 'comet': {
            var t=(now/5200+p.a)%1;
            if(t<.42){
                var mt=t/.42, mx=x-70+mt*150, my=gy-100+mt*70;
                for(var i=0;i<10;i++) px(mx-i*2.2,my-i*1.1,2,1,rgb([255,180+i*4,90],(1-i/10)*.8));
                px(mx,my,2,2,rgb([255,240,200]));
            }
            break; }

        case 'lavaburst': case 'steamburst': case 'bubble': case 'crop': {
            var t=(now/3400+p.a)%1;
            var hot=ev==='lavaburst';
            for(var i=0;i<7;i++){
                var a2=i/7*Math.PI, sp=t*20;
                var bx=x+Math.cos(a2)*sp*1.3, by=gy-Math.sin(a2)*sp+t*t*14;
                if(ev==='crop'){ if(t<.05) px(x-14,gy-1,29,1,rgb(tint([210,190,110]))); break; }
                px(bx,by,1,1,rgb(hot?[255,140,50]:ev==='bubble'?[170,210,170]:[210,215,220],(1-t)*.75));
            }
            if(ev==='crop'){ /* crop circle glyph */
                for(var i=0;i<12;i++){ var a2=i/12*6.283;
                    px(x+Math.round(Math.cos(a2)*11),gy-1+Math.round(Math.sin(a2)*3),1,1,rgb(tint([190,170,95]))); }
                disc(x,gy-1,3,rgb(tint([190,170,95])));
            }
            break; }

        case 'phoenix': {
            var t=(now/8000+p.a)%1;
            var fx2=x-80+t*160, fy=gy-70-Math.sin(t*Math.PI)*20;
            var up=Math.sin(now/160)>0?-3:2;
            px(fx2-4,fy,9,2,rgb([255,150,50]));
            px(fx2-2,fy+up,5,Math.abs(up),rgb([255,200,80]));
            px(fx2+1,fy-up,5,Math.abs(up),rgb([255,200,80]));
            for(var i=1;i<7;i++) px(fx2-4-i*2,fy+1,2,1,rgb([255,120,40],(1-i/7)*.7));
            break; }

        case 'aurora': break;              /* handled in the sky pass */
        case 'digsite': {
            px(x-9,gy-1,19,1,rgb(tint([150,130,100])));
            px(x-6,gy-6,1,5,rgb(tint([120,96,64]))); px(x-7,gy-7,3,1,rgb(tint([120,96,64])));
            px(x+3,gy-4,5,3,rgb(tint([210,200,180])));
            px(x+4,gy-7,1,3,rgb(tint([180,170,150])));
            break; }
        case 'mirage': {
            var a2=.25+.2*Math.sin(now/1600+p.a*6);
            for(var i=0;i<9;i++) px(x-11+i*3,gy-9-Math.round(Math.sin(now/500+i)*1.5),2,7,rgb([170,220,235],a2*.4));
            px(x-11,gy-2,25,1,rgb([200,235,245],a2)); break; }
        case 'festival': {
            for(var i=0;i<9;i++){
                var lx=x-32+i*8, ly=gy-24+Math.sin(i*.9)*3;
                px(lx,ly,2,3,rgb(mix(tint([255,120,150]),[255,230,160],(i%3)/2)));
                if(lit>.2) disc(lx,ly+1,4,rgb([255,180,140],lit*.13));
            }
            px(x-34,gy-26,70,1,rgb(tint([90,70,60])));
            break; }
        case 'cat': {                       /* the mascot, out for a walk */
            var c=rgb(tint([255,217,160])), o=rgb(tint([43,29,47]));
            var bobc=Math.floor(now/500)%2;
            px(x-3,gy-5,7,4,c); px(x-3,gy-5,7,1,o);
            px(x-4,gy-7,4,3,c); px(x-4,gy-8,1,1,c); px(x-1,gy-8,1,1,c);
            px(x-3,gy-6,1,1,o); px(x-1,gy-6,1,1,o);
            px(x+4,gy-7-bobc,1,3,c);
            px(x-2,gy-1,1,1,o); px(x+2,gy-1,1,1,o);
            break; }
        }
    }

    /* ---- scene render ---- */
    var W=0,H=0,PX=4,horizon=0,vign=null,waterY=0;
    var stars=[],clouds=[],flies=[],birds=[],rainP=[],snowP=[],splash=[],amb=[];
    var colH=[null,null,null], colW=null;
    var builtW=-1,builtH=-1;

    function build(){
        cv=$('pixelCanvas'); g=cv.getContext('2d',{alpha:false});
        builtW=innerWidth; builtH=innerHeight;
        PX = innerWidth<640 ? 3 : 4;
        W = Math.max(16,Math.ceil(innerWidth/PX)); H = Math.max(16,Math.ceil(innerHeight/PX));
        cv.width=W; cv.height=H;
        g.imageSmoothingEnabled=false;
        horizon = Math.round(H*.87);
        colH=[new Int16Array(W),new Int16Array(W),new Int16Array(W)];
        colW=new Float32Array(W);

        var r=seeded(20260811);
        stars=[];
        for(var i=0;i<120;i++) stars.push({x:(r()*W)|0,y:(r()*horizon*.86)|0,p:r()*6.283,s:r()<.10?2:1});
        clouds=[];
        for(var i=0;i<15;i++){
            var w=(10+r()*24)|0, parts=[];
            for(var j=0;j<4+((r()*3)|0);j++)
                parts.push({dx:(r()*w)|0,dy:((r()*4)|0),w:(4+r()*9)|0,h:(3+r()*3)|0});
            clouds.push({x:r()*W,y:5+r()*(horizon*.50),w:w,sp:.8+r()*1.8,parts:parts,th:i/15});
        }
        flies=[]; for(var i=0;i<16;i++) flies.push({x:r()*W,y:horizon-6-r()*26,p:r()*6.283,q:r()*6.283,sp:.35+r()*.5});
        amb=[];  for(var i=0;i<34;i++) amb.push({x:r()*W,y:r()*horizon,p:r()*6.283,v:.3+r(),s:r()});
        var grd=g.createRadialGradient(W/2,H*.45,H*.2,W/2,H*.5,H*.95);
        grd.addColorStop(0,'rgba(0,0,0,0)'); grd.addColorStop(1,'rgba(0,0,0,.18)');
        vign=grd;
        birds=[];rainP=[];snowP=[];splash=[];
        chunkCache={}; chunkCount=0;
    }

    var light=1,night=0,warm=0,sunAlt=0,skyBands=[],bandH=1;
    var NIGHT_MUL=[.24,.28,.50];
    function tint(base,extraWarm){
        var c=[base[0]*lerp(NIGHT_MUL[0],1,light),base[1]*lerp(NIGHT_MUL[1],1,light),base[2]*lerp(NIGHT_MUL[2],1,light)];
        var w=warm*(extraWarm===undefined?1:extraWarm);
        var out=w>0?mix(c,[255,152,96],w*.30):c;
        return cur.dark>.02?mix(out,[78,88,104],cur.dark*.30):out;
    }
    function skyAt(y){ return skyBands[clamp((y/bandH)|0,0,skyBands.length-1)]||skyBands[0]; }

    function capRidge(l,color,thick){
        var a=colH[l];
        g.beginPath();
        for(var x=0;x<W;x++) g.rect(x,a[x],1,thick);
        g.fillStyle=color; g.fill();
    }
    /* per-column palette blend, so biome borders are spatial not sudden */
    function colColor(x,cx,idx){
        var bl=blendAt(cx+x);
        var A=BIOMES[bl.a].pal[idx], Bp=BIOMES[bl.b].pal[idx];
        return bl.a===bl.b?A:mix(A,Bp,bl.t);
    }
    /* draws a terrain layer, recolouring wherever the biome changes across the screen */
    function paintLayer(l,idx,hazeAmt,snowAmt){
        var a=colH[l], cx=camX();
        var runStart=0, runCol=colColor(0,cx,idx);
        var flush=function(x0,x1,col){
            var c=tint(col);
            if(hazeAmt) c=mix(c,hazeCol,hazeAmt);
            if(snowAmt) c=mix(c,tint(SNOWC),snowAmt);
            g.fillStyle=rgb(c);
            g.beginPath(); g.moveTo(x0,H);
            for(var x=x0;x<x1;x++){ g.lineTo(x,a[x]); g.lineTo(x+1,a[x]); }
            g.lineTo(x1,H); g.closePath(); g.fill();
        };
        var STEP=6;
        for(var x=STEP;x<W;x+=STEP){
            var c=colColor(x,cx,idx);
            if(Math.abs(c[0]-runCol[0])+Math.abs(c[1]-runCol[1])+Math.abs(c[2]-runCol[2])>6){
                flush(runStart,x+1,runCol); runStart=x; runCol=c;
            }
        }
        flush(runStart,W,runCol);
    }
    var SNOWC=hex('#f3f8ff');

    var lightning=0,lightningNext=3000;

    function drawScene(dt,now){
        var h=hourNow(), cx=camX();
        sunAlt=Math.sin((h-6)/12*Math.PI);
        var gloom=cur.dark;
        light=clamp(sunAlt*1.10+.34,0,1)*(1-gloom*.42);
        night=clamp(-sunAlt*1.8+.06,0,1);
        warm=clamp(1-Math.abs(sunAlt)*4.2,0,1)*(1-gloom*.6);

        /* biome at screen centre drives sky mood + ambient */
        var bc=blendAt(cx+W/2);
        var BA=BIOMES[bc.a], BB=BIOMES[bc.b];

        /* ---- sky ---- */
        var k=skyKeys(h);
        var top=k[0],midc=k[1],bot=k[2];
        var bTint=mix(BA.sky[0],BB.sky[0],bc.t), bAmt=lerp(BA.sky[1],BB.sky[1],bc.t)*(0.35+light*.65);
        top=mix(top,bTint,bAmt*.85); midc=mix(midc,bTint,bAmt); bot=mix(bot,bTint,bAmt*.75);
        if(gloom>0){
            var overcast=mix([124,128,138],[62,66,78],clamp(gloom*1.15,0,1));
            var gray=mix([20,24,36],overcast,clamp(sunAlt*1.2+.35,0,1));
            top =mix(top ,gray,                       clamp(gloom*1.15,0,.93));
            midc=mix(midc,mix(gray,[255,255,255],.06),clamp(gloom*1.05,0,.88));
            bot =mix(bot ,mix(gray,[255,255,255],.16),clamp(gloom*.92 ,0,.85));
        }
        var N=20; bandH=horizon/N; skyBands=[];
        for(var i=0;i<N;i++){
            var p=i/(N-1), e=p*p*.55+p*.45;
            skyBands.push(e<.5?mix(top,midc,e*2):mix(midc,bot,(e-.5)*2));
        }
        for(var i=0;i<N;i++){ g.fillStyle=rgb(skyBands[i]); g.fillRect(0,Math.round(i*bandH),W,Math.ceil(bandH)+1); }
        g.fillStyle=rgb(skyBands[N-1]); g.fillRect(0,horizon-2,W,H-horizon+2);
        hazeCol=skyBands[N-1];

        /* ---- stars ---- */
        if(night>.02){
            for(var i=0;i<stars.length;i++){
                var s=stars[i], tw=.55+.45*Math.sin(now/620+s.p);
                g.fillStyle=rgb([255,252,236],night*tw*.95);
                g.fillRect(s.x,s.y,s.s,s.s);
            }
        }
        /* aurora — tundra nights */
        var auroraAmt=(BA.id==='tundra'?1-bc.t:0)+(BB.id==='tundra'?bc.t:0);
        if(auroraAmt>.02&&night>.35&&cur.cloud<.6){
            for(var b2=0;b2<3;b2++)
                for(var x=0;x<W;x+=2){
                    var yy=horizon*.22+Math.sin(x*.026+now/2600+b2*1.7)*13+b2*9;
                    var a2=(.16-b2*.035)*night*auroraAmt*(1-cur.cloud);
                    g.fillStyle=rgb(b2===1?[120,255,190]:[150,120,255],a2);
                    g.fillRect(x,yy,2,Math.round(16+Math.sin(x*.04+now/1900)*7));
                }
        }
        /* second moon / ringed planet for the stranger realities */
        var oddAmt=(BA.id==='outpost'||BA.id==='feywild'?1-bc.t:0)+(BB.id==='outpost'||BB.id==='feywild'?bc.t:0);
        if(oddAmt>.03){
            var px2=Math.round(W*.20), py2=Math.round(horizon*.24);
            var col=BB.id==='feywild'||BA.id==='feywild'?[255,150,210]:[170,220,255];
            disc(px2,py2,10,rgb(col,.5*oddAmt*(0.35+night*.65)));
            disc(px2-2,py2-2,4,rgb(mix(col,[255,255,255],.4),.35*oddAmt));
            for(var i=-16;i<=16;i++) px(px2+i,py2+Math.round(i*.28),1,1,rgb(mix(col,[255,255,255],.5),.28*oddAmt));
        }

        /* ---- sun / moon ---- */
        var arcTop=horizon*.14, arcH=horizon-arcTop;
        var sunX=-999,sunY=0;
        if(sunAlt>-.18){
            sunX=Math.round(W*clamp((h-5.6)/12.8,-.1,1.1));
            sunY=Math.round(horizon-8-Math.max(0,sunAlt)*arcH*.96);
            var glow=mix([255,214,120],[255,150,90],warm);
            disc(sunX,sunY,10,rgb(glow,.10*clamp(sunAlt*3,0,1)));
            disc(sunX,sunY,7,rgb(glow,.20*clamp(sunAlt*3,0,1)));
            disc(sunX,sunY,5,rgb(mix([255,240,190],[255,168,96],warm)));
            disc(sunX,sunY,4,rgb(mix([255,252,226],[255,206,140],warm*.8)));
        }
        if(night>.02){
            var mh=(h+12)%24, mAlt=Math.sin((mh-6)/12*Math.PI);
            if(mAlt>-.18){
                var px2=Math.round(W*clamp((mh-5.6)/12.8,-.1,1.1));
                var py2=Math.round(horizon-8-Math.max(0,mAlt)*arcH*.90);
                disc(px2,py2,8,rgb([210,224,255],.10*night));
                disc(px2,py2,5,rgb([246,246,226],night));
                disc(px2-1,py2-1,1,rgb([214,214,196],night));
                disc(px2+2,py2+1,1,rgb([214,214,196],night));
                disc(px2+3,py2-2,3,rgb(skyAt(py2),night*.92));
                if(sunX<-100){ sunX=px2; sunY=py2; }
            }
        }

        /* ---- clouds ---- */
        for(var i=0;i<clouds.length;i++){
            var c=clouds[i];
            c.x-=(c.sp*(reduceMotion?.25:1)*(1+cur.rain*.9)+SPEED*.055)*dt;
            if(c.x<-c.w-18) c.x=W+8+Math.random()*44;
            var vis=clamp((cur.cloud-c.th*.92)*4,0,1);
            if(vis<=.02) continue;
            var body=mix(tint([255,255,255],1.2),[186,196,214],cur.dark*.7);
            var shade=mix(body,[120,132,158],.35);
            g.globalAlpha=vis*(.85+light*.15);
            for(var j=0;j<c.parts.length;j++){
                var q=c.parts[j], x2=Math.round(c.x+q.dx), y2=Math.round(c.y+q.dy);
                g.fillStyle=rgb(shade); g.fillRect(x2,y2+q.h-1,q.w,1);
                g.fillStyle=rgb(body);  g.fillRect(x2,y2,q.w,q.h-1);
            }
            g.globalAlpha=1;
        }

        /* ---- terrain columns ---- */
        for(var l=0;l<3;l++){
            var a=colH[l];
            for(var x=0;x<W;x++) a[x]=terrainY(cx+x,l);
        }
        /* water level + per-column water amount */
        var anyWater=0;
        waterY=horizon;
        for(var x=0;x<W;x++){
            var bl=blendAt(cx+x);
            var wa=(BIOMES[bl.a].water?1-bl.t:0)+(BIOMES[bl.b].water?bl.t:0);
            colW[x]=wa; if(wa>anyWater) anyWater=wa;
        }
        if(anyWater>.02){
            var wb=BA.water||BB.water;
            waterY=Math.round(horizon-(wb?wb.rise:.02)*H);
        }
        var cov=clamp(cur.cover,0,1);

        paintLayer(0,0,.45,cov*.45);
        drawLayerProps(0,now,cx);
        paintLayer(1,1,.16,cov*.6);
        capRidge(1,rgb(mix(mix(tint(colColor(W>>1,cx,2)),hazeCol,.16),tint(SNOWC),cov*.65)),1);
        drawLayerProps(1,now,cx);
        paintLayer(2,3,0,cov*.82);
        capRidge(2,rgb(mix(tint(colColor(W>>1,cx,4)),tint(SNOWC),cov*.9)),2);
        px(0,H-Math.round(H*.035),W,Math.round(H*.035),rgb(tint(colColor(W>>1,cx,5))));

        /* ground speckle — keeps the foreground from reading as a flat slab */
        var dirtTop=H-Math.round(H*.035);
        for(var x=0;x<W;x+=2){
            if(colW[x]>.5) continue;
            var wx=Math.floor(cx+x), gy=colH[2][x];
            var sc=rgb(mix(tint(mix(colColor(x,cx,3),SNOWC,cov*.82)),[0,0,0],.16));
            for(var k2=0;k2<3;k2++){
                if(hash2(wx+k2*4099,k2*31)>.34) continue;
                var yy=gy+5+k2*8+Math.floor(hash2(wx,k2*17)*7);
                if(yy>=dirtTop) continue;
                px(x,yy,1+(hash2(wx,k2)<.3?1:0),1,sc);
            }
        }

        /* ---- water ---- */
        if(anyWater>.02){
            var wb=BA.water||BB.water||{c:hex('#2f7fb0'),alpha:.85};
            var wc=tint(wb.c);
            var shallow=mix(wc,[255,255,255],.30), deep=mix(wc,[0,0,0],.30);
            for(var x=0;x<W;x++){
                var a2=colW[x]*wb.alpha; if(a2<=.02) continue;
                var wave=Math.round(Math.sin((cx+x)*.09+now/700)*1.2
                                    +Math.sin((cx+x)*.031-now/1500)*1.6);
                var wtop=waterY+wave;
                g.fillStyle=rgb(deep,a2);   g.fillRect(x,wtop,1,H-wtop);
                g.fillStyle=rgb(wc,a2);     g.fillRect(x,wtop,1,Math.round(H*.06));
                g.fillStyle=rgb(shallow,a2);g.fillRect(x,wtop,1,3);
            }
            /* crest highlights + swell lines */
            g.fillStyle=rgb(mix(wc,[255,255,255],.62),.75*anyWater);
            for(var x=0;x<W;x++){
                if(colW[x]<.3) continue;
                var wave=Math.round(Math.sin((cx+x)*.09+now/700)*1.2
                                    +Math.sin((cx+x)*.031-now/1500)*1.6);
                if(Math.sin((cx+x)*.21+now/520)>.55) g.fillRect(x,waterY+wave,1,1);
            }
            g.fillStyle=rgb(mix(wc,[255,255,255],.35),.30*anyWater);
            for(var row=0;row<5;row++){
                var yy=waterY+6+row*Math.round(H*.022);
                if(yy>=H) break;
                for(var x=0;x<W;x+=3){
                    if(colW[x]<.3) continue;
                    if(Math.sin((cx+x)*.055+now/900+row*2.1)>.60) g.fillRect(x,yy,2,1);
                }
            }
            /* sun / moon glitter */
            if(sunX>-100&&sunX<W+40&&anyWater>.3){
                for(var i=0;i<12;i++){
                    var yy=waterY+2+i*2;
                    if(yy>=H) break;
                    var jitter=Math.round(Math.sin(now/300+i*1.3)*(1+i*.4));
                    g.fillStyle=rgb(mix([255,240,190],wc,.25),(.30-i*.022)*anyWater*(light*.6+.4));
                    g.fillRect(sunX+jitter-1,yy,2+((i%3)|0),1);
                }
            }
        }

        drawLayerProps(2,now,cx);
        drawGrass(now,cx,cov);

        /* ---- ambient per-biome particles ---- */
        drawAmbient(dt,now,BA,BB,bc.t);

        /* ---- fireflies ---- */
        if(night>.45&&cur.rain<.2&&cur.snow<.2){
            var a2=night*(1-cur.rain);
            for(var i=0;i<flies.length;i++){
                var f=flies[i];
                var x2=Math.round(f.x+Math.sin(now/900*f.sp+f.p)*9);
                var y2=Math.round(f.y+Math.cos(now/1100*f.sp+f.q)*5);
                var pulse=.35+.65*Math.abs(Math.sin(now/700+f.p));
                g.fillStyle=rgb([190,255,120],a2*pulse*.22); g.fillRect(x2-1,y2-1,3,3);
                g.fillStyle=rgb([226,255,168],a2*pulse);     g.fillRect(x2,y2,1,1);
            }
        }

        drawBirds(dt,now);
        drawRain(dt); drawSnow(dt,now);

        if(!reduceMotion&&wxKey==='storm'&&cur.rain>.6){
            lightningNext-=dt*1000;
            if(lightningNext<=0){ lightning=1; lightningNext=2600+Math.random()*7000; }
        }
        if(lightning>0){
            lightning=Math.max(0,lightning-dt*3.2);
            g.fillStyle='rgba(226,238,255,'+(lightning>.7?.30:lightning*.20)+')';
            g.fillRect(0,0,W,H);
        }
        g.fillStyle=vign; g.fillRect(0,0,W,H);
    }

    /* props for one layer across the visible span */
    function drawLayerProps(l,now,cx){
        var c0=Math.floor((cx-90)/CHUNK), c1=Math.floor((cx+W+90)/CHUNK);
        for(var ci=c0;ci<=c1;ci++){
            var list=chunkProps(l,ci);
            for(var i=0;i<list.length;i++){
                var p=list[i], sx=Math.round(p.wx-cx);
                if(sx<-70||sx>W+70) continue;
                var gx=clamp(sx,0,W-1);
                var gy=colH[l][gx];
                if(colW[gx]>.5&&(p.k==='event'||p.k==='small')&&BIOMES[p.b].water) gy=waterY;
                drawProp(p,l,sx,gy,now);
            }
        }
    }

    function drawGrass(now,cx,cov){
        var step=Math.max(2,Math.round(W/110));
        for(var x=1;x<W;x+=step){
            var bl=blendAt(cx+x);
            var gr=(BIOMES[bl.a].grass?1-bl.t:0)+(BIOMES[bl.b].grass?bl.t:0);
            if(gr<.35||colW[x]>.5) continue;
            var base=mix(colColor(x,cx,4),SNOWC,cov*.75);
            var hh=1+(Math.floor(hash2(Math.floor(cx+x),7)*3));
            var s=reduceMotion?0:Math.round(Math.sin(now/700+(cx+x)*.1)*.6);
            var c=rgb(tint(x%3===0?mix(base,[255,255,255],.22):base));
            var gy=colH[2][x];
            for(var k2=0;k2<hh;k2++) px(x+(k2===hh-1?s:0),gy-1-k2,1,1,c);
            if(hash2(Math.floor(cx+x),19)<.13){
                px(x+1,gy-hh-1,1,1,rgb(tint(BIOMES[bl.t<.5?bl.a:bl.b].accent)));
            }
        }
    }

    /* biome ambient particles */
    function drawAmbient(dt,now,BA,BB,t){
        var kind=(t<.5?BA.amb:BB.amb);
        if(!kind) return;
        var strength=t<.5?1-t*2:(t-.5)*2;
        for(var i=0;i<amb.length;i++){
            var a=amb[i];
            switch(kind){
                case 'petal':
                    a.y+=a.v*7*dt; a.x+=Math.sin(now/1200+a.p)*.5-SPEED*dt*.5;
                    px(a.x,a.y,1,1,rgb([255,170,205],.75*strength)); break;
                case 'sand':
                    a.x-=(28+a.v*30)*dt; a.y+=Math.sin(now/500+a.p)*.25;
                    px(a.x,a.y,2,1,rgb([226,200,150],.30*strength)); break;
                case 'ember':
                    a.y-=(9+a.v*13)*dt; a.x+=Math.sin(now/600+a.p)*.4;
                    px(a.x,a.y,1,1,rgb([255,140,50],.75*strength*(a.s*.6+.4))); break;
                case 'ash':
                    a.y+=(5+a.v*7)*dt; a.x+=Math.sin(now/900+a.p)*.35;
                    px(a.x,a.y,1,1,rgb([170,168,164],.42*strength)); break;
                case 'wisp': {
                    var yy=a.y+Math.sin(now/1100+a.p)*8;
                    a.x-=SPEED*dt*.4;
                    var pu=.4+.6*Math.abs(Math.sin(now/900+a.p));
                    px(a.x,yy,1,1,rgb([150,255,210],.8*strength*pu));
                    disc(a.x,yy,2,rgb([120,255,190],.10*strength*pu)); break; }
                case 'spark': {
                    var pu=.3+.7*Math.abs(Math.sin(now/500+a.p*3));
                    a.y-=(4+a.v*6)*dt;
                    px(a.x,a.y,1,1,rgb([180,240,255],.7*strength*pu)); break; }
                case 'pollen':
                    a.y+=Math.sin(now/1500+a.p)*.22; a.x-=(4+a.v*5)*dt;
                    px(a.x,a.y,1,1,rgb([255,244,180],.45*strength)); break;
                case 'drift':
                    a.x-=(20+a.v*22)*dt; a.y+=Math.sin(now/800+a.p)*.3;
                    px(a.x,a.y,1,1,rgb([236,246,255],.5*strength)); break;
            }
            if(a.x<-4) a.x=W+4; if(a.x>W+4) a.x=-4;
            if(a.y>horizon) a.y=0; if(a.y<-4) a.y=horizon;
        }
    }

    function drawBirds(dt,now){
        if(light>.55&&cur.rain<.2&&birds.length===0&&Math.random()<dt*.05){
            var n=3+((Math.random()*3)|0), dir=Math.random()<.5?1:-1;
            var by=8+Math.random()*(horizon*.35);
            for(var i=0;i<n;i++)
                birds.push({x:dir>0?-8-i*7:W+8+i*7,y:by+(i%2?2:-1)+i*1.2,d:dir,sp:9+Math.random()*5,p:Math.random()*6.283});
        }
        for(var i=birds.length-1;i>=0;i--){
            var b=birds[i];
            b.x+=b.d*b.sp*dt;
            if(b.x<-20||b.x>W+20){ birds.splice(i,1); continue; }
            var up=Math.sin(now/110+b.p)>0?-1:1;
            g.fillStyle=rgb(tint([46,52,70],0));
            var bx=Math.round(b.x), by=Math.round(b.y+Math.sin(now/700+b.p));
            g.fillRect(bx,by,1,1); g.fillRect(bx-1,by+up,1,1); g.fillRect(bx+1,by+up,1,1);
        }
    }

    function drawRain(dt){
        var want=Math.round(W*.95*cur.rain*(reduceMotion?.4:1));
        while(rainP.length<want) rainP.push({x:Math.random()*W,y:Math.random()*horizon,v:60+Math.random()*55,l:2+((Math.random()*3)|0)});
        while(rainP.length>want) rainP.pop();
        if(!rainP.length) return;
        g.fillStyle=rgb(tint(hex('#a9dcff'),0),.62);
        var wind=cur.rain*.30;
        for(var i=0;i<rainP.length;i++){
            var p=rainP[i];
            p.y+=p.v*dt; p.x+=p.v*dt*wind;
            var gx=clamp(p.x|0,0,W-1);
            var gy=colW[gx]>.5?waterY:colH[2][gx];
            if(p.y>gy){
                if(splash.length<26) splash.push({x:p.x,y:gy,t:.22});
                p.y=-2-Math.random()*10; p.x=Math.random()*W;
            }
            g.fillRect(p.x|0,p.y|0,1,p.l);
        }
        for(var i=splash.length-1;i>=0;i--){
            var s=splash[i]; s.t-=dt;
            if(s.t<=0){ splash.splice(i,1); continue; }
            g.fillStyle=rgb(tint([210,240,255],0),s.t*3.2);
            g.fillRect((s.x|0)-1,(s.y|0)-1,3,1);
        }
    }
    function drawSnow(dt,now){
        var want=Math.round(W*.36*cur.snow*(reduceMotion?.4:1));
        while(snowP.length<want) snowP.push({x:Math.random()*W,y:Math.random()*horizon,v:9+Math.random()*13,p:Math.random()*6.283,s:Math.random()<.25?2:1});
        while(snowP.length>want) snowP.pop();
        if(!snowP.length) return;
        g.fillStyle=rgb(tint(SNOWC,0),.92);
        for(var i=0;i<snowP.length;i++){
            var p=snowP[i];
            p.y+=p.v*dt;
            var x2=p.x+Math.sin(now/1000+p.p)*5;
            var gx=clamp(x2|0,0,W-1);
            if(p.y>colH[2][gx]){ p.y=-2; p.x=Math.random()*W; }
            g.fillRect(x2|0,p.y|0,p.s,p.s);
        }
    }

    /* ---- loop ----
       ~30fps: the world only scrolls 5.5px a second, so a backdrop behind a
       work app gains nothing from 60 and the battery notices. */
    function frame(now){
        id = raf(frame);
        if(document.hidden){ last=now; return; }
        if(now-last<30) return;
        var dt=Math.min(.06,(now-last)/1000); last=now;
        if(innerWidth!==builtW||innerHeight!==builtH) build();

        if(now>wxNext) pickWeather();
        var tgt=WX[wxKey], k=Math.min(1,dt*.35);
        cur.cloud=lerp(cur.cloud,tgt.cloud,k);
        cur.rain =lerp(cur.rain ,tgt.rain ,k);
        cur.snow =lerp(cur.snow ,tgt.snow ,k);
        cur.dark =lerp(cur.dark ,tgt.dark ,k);
        cur.cover=clamp(cur.cover+(cur.snow>.3?dt*.035:-dt*.07),0,1);

        drawScene(dt,now);
    }

    return {
        start: function () {
            if (id !== null) return;
            build();
            if (!wxNext) pickWeather('clear');
            last = performance.now();
            drawScene(0, last);
            if (!reduceMotion) id = raf(frame);            // reduced motion: one still frame
        },
        stop: function () { if (id !== null) cancelAnimationFrame(id); id = null; },
        resize: function () {
            if (id === null && !(reduceMotion && state.style === 'pixelart')) return;
            build(); drawScene(0, performance.now());
        }
    };
})();


/* ── Retro Windows shell ─────────────────────────────────────────────── */
var retro = (function () {
    var shell, clockTimer = null, menuOpen = false;
    function build() {
        if ($('retroShell')) return;
        var startMenu = el('div', { id:'retroStartMenu' });
        startMenu.appendChild(el('div', { class:'sm-rail', html:'<span>isai<b>art</b></span>' }));
        var items = el('div', { class:'sm-items' });
        [
            { ico:'📁', label:'Programs',  arrow:true },
            { ico:'📄', label:'Documents', arrow:true },
            { ico:'⚙️', label:'Settings',  arrow:true, act:function(){ toggleMenu(false); panelToggle(true); } },
            { ico:'🔍', label:'Find',      arrow:true },
            { ico:'❓',       label:'Help' },
            { sep:true },
            { ico:'🏠', label:'Hub…', href: HUB },
            { ico:'📞', label:(cfg.sibling ? cfg.sibling.label : 'Sibling app') + '…', href: cfg.sibling && cfg.sibling.href },
            { sep:true },
            { ico:'🔌', label:'Shut Down…', act:function(){ toggleMenu(false); shutdown(); } }
        ].forEach(function (it) {
            if (it.sep) { items.appendChild(el('div', { class:'sm-sep' })); return; }
            var node = it.href
                ? el('a', { class:'sm-item', href: it.href })
                : el('button', { class:'sm-item', type:'button', onclick: it.act || function(){ toggleMenu(false); } });
            node.appendChild(el('span', { class:'sm-ico', text: it.ico }));
            node.appendChild(el('span', { text: it.label }));
            if (it.arrow) node.appendChild(el('span', { class:'sm-arrow', text:'▶' }));
            items.appendChild(node);
        });
        startMenu.appendChild(items);

        var bar = el('div', { id:'retroTaskbar' });
        bar.appendChild(el('button', { id:'retroStartBtn', type:'button', html:'<span class="flag"><i></i><i></i><i></i><i></i></span><span>Start</span>',
            onclick: function (e) { e.stopPropagation(); toggleMenu(!menuOpen); } }));
        bar.appendChild(el('div', { class:'tb-sep' }));
        var tasks = el('div', { id:'retroTasks' });
        tasks.appendChild(el('button', { class:'tb-task active', type:'button', text: (cfg.emoji || '') + ' ' + (cfg.title || 'App') }));
        if (cfg.sibling) tasks.appendChild(el('a', { class:'tb-task', href: cfg.sibling.href, text:'🗔 ' + cfg.sibling.label }));
        bar.appendChild(tasks);
        var tray = el('div', { id:'retroTray' });
        tray.appendChild(el('span', { class:'tray-ico', text:'🔊' }));
        tray.appendChild(el('span', { class:'tray-ico', text:'📶' }));
        tray.appendChild(el('span', { id:'retroClock' }));
        bar.appendChild(tray);

        shell = el('div', { id:'retroShell' }, [startMenu, bar]);
        document.body.appendChild(shell);
        document.addEventListener('click', function (e) {
            if (menuOpen && !startMenu.contains(e.target) && e.target.id !== 'retroStartBtn') toggleMenu(false);
        });

        // In-panel chrome: title bar, menu bar, status bar.
        var panel = $('trackerPanel');
        if (panel && !$('retroTitleBar')) {
            var tb = el('div', { id:'retroTitleBar' });
            tb.appendChild(el('span', { text: (cfg.emoji || '') + ' ' + (cfg.title || '') }));
            var btns = el('div', { style:'display:flex' });
            ['_','□','✕'].forEach(function (g, i) {
                btns.appendChild(el('span', { class:'retro-win-btn', text:g, onclick: i === 2 ? shutdown : null }));
            });
            tb.appendChild(btns);
            panel.insertBefore(tb, panel.firstChild);
            var mb = el('div', { id:'retroMenuBar', html:'<span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>V</u>iew</span><span><u>H</u>elp</span>' });
            panel.insertBefore(mb, tb.nextSibling);
            panel.appendChild(el('div', { id:'retroStatusBar', html:
                '<span class="rsb grow">Ready</span><span class="rsb">' + (cfg.app || '') + '</span><span class="rsb">NUM</span>' }));
        }
    }
    function toggleMenu(open) {
        menuOpen = open;
        var m = $('retroStartMenu'), b = $('retroStartBtn');
        if (m) m.classList.toggle('open', open);
        if (b) b.classList.toggle('open', open);
    }
    function shutdown() {
        var ov = el('div', { style:'position:fixed;inset:0;z-index:200;background:#000;color:#C0C0C0;display:flex;align-items:center;justify-content:center;font-family:"Tahoma",sans-serif;font-size:0.95rem;text-align:center;padding:2rem;cursor:pointer',
            html:'<div>It&rsquo;s now safe to turn off<br>your computer.<br><br><span style="font-size:0.7rem;opacity:.6">(click anywhere)</span></div>' });
        ov.addEventListener('click', function () { ov.remove(); });
        document.body.appendChild(ov);
    }
    function tickClock() {
        var c = $('retroClock');
        if (c) c.textContent = new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
    }
    return {
        start: function () { build(); tickClock(); if (!clockTimer) clockTimer = setInterval(tickClock, 15000); },
        stop:  function () { if (clockTimer) clearInterval(clockTimer); clockTimer = null; toggleMenu(false); }
    };
})();


/* ── Newsroom chrome ──────────────────────────────────────────────────────
   Data comes from free, key-less, CORS-enabled endpoints and is cached for
   10 minutes. Every fetch is wrapped — if the network is down, rate-limited
   or blocked, the bands fall back to canned copy and the theme still looks
   right. Nothing here is required for the app to work. */
var news = (function () {
    var built = false, clockTimer = null, TTL = 10 * 60 * 1000;
    var CACHE_H = 'smt-news-headlines', CACHE_T = 'smt-news-ticker';
    var CACHE_W = 'smt-news-weather', CACHE_G = 'smt-news-geo';
    var WEATHER_TTL = 15 * 60 * 1000, GEO_TTL = 24 * 60 * 60 * 1000;

    /* Pin a location here to skip the IP lookup entirely, e.g.
         var FIXED_PLACE = { name:'Orlando', lat:28.49, lon:-81.38, unit:'fahrenheit' };
       Leave null to detect the viewer's city from their IP (no browser
       permission prompt; city-level only). */
    var FIXED_PLACE = null;
    var DEFAULT_PLACE = { name:'New York', lat:40.71, lon:-74.01, unit:'fahrenheit' };

    // WMO weather codes → [label, glyph]
    var WMO = {
        0:['Clear sky','☀️'],  1:['Mainly clear','🌤️'], 2:['Partly cloudy','⛅'], 3:['Overcast','☁️'],
        45:['Fog','🌫️'], 48:['Rime fog','🌫️'],
        51:['Light drizzle','🌦️'], 53:['Drizzle','🌦️'], 55:['Heavy drizzle','🌦️'],
        56:['Freezing drizzle','🌧️'], 57:['Freezing drizzle','🌧️'],
        61:['Light rain','🌦️'], 63:['Rain','🌧️'], 65:['Heavy rain','🌧️'],
        66:['Freezing rain','🌧️'], 67:['Freezing rain','🌧️'],
        71:['Light snow','🌨️'], 73:['Snow','❄️'], 75:['Heavy snow','❄️'], 77:['Snow grains','❄️'],
        80:['Rain showers','🌦️'], 81:['Rain showers','🌧️'], 82:['Heavy showers','⛈️'],
        85:['Snow showers','🌨️'], 86:['Snow showers','🌨️'],
        95:['Thunderstorm','⛈️'], 96:['Thunderstorm','⛈️'], 99:['Thunderstorm','⛈️']
    };
    function wmo(code) { return WMO[code] || ['—','🌡️']; }

    var FALLBACK_HEADLINES = [
        { beat:'DESK',    text:'Transfer rate holds steady as the afternoon queue clears' },
        { beat:'ANALYSIS',text:'Logging every call remains the single best predictor of a good week' },
        { beat:'LOCAL',   text:'Operator reaches inbox zero, refuses to comment' },
        { beat:'MARKETS', text:'Flat ahead of the close' },
        { beat:'WEATHER', text:'Mild, with a chance of hold music' }
    ];
    var FALLBACK_TICKER = [
        { sym:'BTC', val:'—', chg:0 }, { sym:'ETH', val:'—', chg:0 },
        { sym:'EUR', val:'—', chg:0 }, { sym:'GBP', val:'—', chg:0 }
    ];

    function build() {
        if (built) return; built = true;
        var top = el('div', { class:'news-band top' });
        top.appendChild(el('div', { class:'news-flag', text:'BREAKING NEWS' }));
        top.appendChild(el('div', { class:'news-crawl' }, [el('div', { class:'news-track', id:'newsTrack' })]));
        top.appendChild(el('div', { class:'news-clock' }, [
            el('span', { class:'news-live', html:'<span class="dot"></span>LIVE' }),
            el('span', { id:'newsClock' })
        ]));

        // Broadcast weather bug — sits clear of the centred panel, and hides
        // itself on narrow viewports rather than colliding with it.
        document.body.appendChild(el('div', { id:'newsWeather', 'aria-hidden':'true', html:
            '<div class="wx-head"><span>Weather</span><span class="wx-city" id="wxCity">—</span></div>' +
            '<div class="wx-now"><span class="wx-ico" id="wxIcon">🌡️</span>' +
            '<span class="wx-temp" id="wxTemp">—</span>' +
            '<span class="wx-cond" id="wxCond">Loading…</span></div>' +
            '<div class="wx-days" id="wxDays"></div>' }));

        var bottom = el('div', { class:'news-band bottom' });
        bottom.appendChild(el('div', { class:'news-strap' }, [
            el('span', { text: (cfg.title || '').toUpperCase() }),
            el('span', { style:'margin-left:auto', id:'newsSrcLabel', text:'MARKETS' })
        ]));
        var rail = el('div', { class:'stock-rail' });
        rail.appendChild(el('div', { class:'stock-track', id:'stockTrack' }));
        bottom.appendChild(rail);

        document.body.appendChild(el('div', { id:'newsChrome', 'aria-hidden':'true' }, [top, bottom]));
    }

    /* The crawl is headlines plus, once it lands, a WEATHER item — so the
       forecast reads out in the ticker the way it would on air, not just in
       the corner box. Both parts render through here so either can arrive
       first without clobbering the other. */
    var curHeadlines = [], wxItem = null;

    function setHeadlines(list) { curHeadlines = list || []; renderCrawl(); }

    function renderCrawl() {
        var track = $('newsTrack'); if (!track) return;
        var list = (wxItem ? [wxItem] : []).concat(curHeadlines);
        var chars = 0;
        var body = list.map(function (h) {
            if (typeof h === 'string') h = { beat:'', text:h };       // tolerate old cache shape
            chars += (h.beat || '').length + (h.text || '').length;
            return '<span class="news-item">' +
                   (h.beat ? '<b class="news-beat">' + esc(h.beat) + '</b>' : '') +
                   esc(h.text) + '</span>';
        }).join('');
        track.innerHTML = body + body;               // duplicated for a seamless loop
        track.style.animationDuration = Math.max(35, chars * 0.16) + 's';
    }
    function setTicker(list) {
        var track = $('stockTrack'); if (!track) return;
        var body = list.map(function (q) {
            var dir = q.chg > 0 ? 'up' : q.chg < 0 ? 'down' : '';
            var arrow = q.chg > 0 ? '▲' : q.chg < 0 ? '▼' : '▬';
            return '<span class="stock-item"><span class="sym">' + esc(q.sym) + '</span>' +
                   '<span class="val">' + esc(String(q.val)) + '</span>' +
                   '<span class="chg ' + dir + '">' + arrow + ' ' + Math.abs(q.chg).toFixed(2) + '%</span></span>';
        }).join('');
        track.innerHTML = body + body;
    }
    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    /* The two feeds are cached independently. Caching them together meant a
       working headline fetch would freeze a *failed* ticker fetch in place
       for the full TTL, so the markets bar never recovered. */
    function cachedFor(key, ttl) {
        try {
            var c = JSON.parse(localStorage.getItem(key) || 'null');
            if (c && Date.now() - c.at < ttl && c.data) return c.data;   // objects allowed
        } catch (e) {}
        return null;
    }
    function cached(key) {                       // list feeds: must be non-empty
        var d = cachedFor(key, TTL);
        return (d && d.length) ? d : null;
    }
    function cache(key, data) {
        try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: data })); } catch (e) {}
    }

    function fetchJSON(url) {
        return fetch(url, { mode:'cors' }).then(function (r) { if (!r.ok) throw 0; return r.json(); });
    }

    /* Two independent open feeds, both key-less and CORS-enabled:
         • Wikipedia "most read today"  — what the world is actually reading
         • Hacker News top stories      — the tech desk
       Interleaved so the crawl has variety, and either one failing still
       leaves a populated ticker. */
    function loadWikipedia() {
        var d = new Date();
        var ymd = d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
        return fetchJSON('https://en.wikipedia.org/api/rest_v1/feed/featured/' + ymd).then(function (j) {
            var out = [];
            // "In the news" is only published on some days — use it when it's there.
            (j.news || []).slice(0, 5).forEach(function (n) {
                var txt = String(n.story || '').replace(/<[^>]+>/g, '').trim();
                if (txt) out.push({ beat:'WORLD', text: txt });
            });
            ((j.mostread && j.mostread.articles) || []).slice(0, 8).forEach(function (a) {
                if (a.normalizedtitle) out.push({ beat:'TRENDING', text: a.normalizedtitle });
            });
            if (!out.length) throw 0;
            return out;
        });
    }
    function loadHN() {
        return fetchJSON('https://hacker-news.firebaseio.com/v0/topstories.json')
            .then(function (ids) {
                return Promise.all(ids.slice(0, 7).map(function (id) {
                    return fetchJSON('https://hacker-news.firebaseio.com/v0/item/' + id + '.json').catch(function () { return null; });
                }));
            })
            .then(function (items) {
                var out = items.filter(Boolean).filter(function (i) { return i.title; })
                               .map(function (i) { return { beat:'TECH', text: i.title }; });
                if (!out.length) throw 0;
                return out;
            });
    }
    function loadHeadlines() {
        return Promise.allSettled([loadWikipedia(), loadHN()]).then(function (res) {
            var a = res[0].status === 'fulfilled' ? res[0].value : [];
            var b = res[1].status === 'fulfilled' ? res[1].value : [];
            var out = [], n = Math.max(a.length, b.length);
            for (var i = 0; i < n; i++) {            // interleave the two desks
                if (a[i]) out.push(a[i]);
                if (b[i]) out.push(b[i]);
            }
            if (!out.length) throw 0;
            return out.slice(0, 14);
        });
    }
    // CoinGecko (crypto) + Frankfurter (FX). Both key-less and CORS-enabled.
    function loadTicker() {
        var crypto = fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,dogecoin&vs_currencies=usd&include_24hr_change=true')
            .then(function (d) {
                var map = { bitcoin:'BTC', ethereum:'ETH', solana:'SOL', dogecoin:'DOGE' };
                return Object.keys(map).filter(function (k) { return d[k]; }).map(function (k) {
                    return { sym: map[k], val: '$' + Number(d[k].usd).toLocaleString(undefined, { maximumFractionDigits:2 }), chg: d[k].usd_24h_change || 0 };
                });
            }).catch(function () { return []; });
        var fx = fetchJSON('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,JPY')
            .then(function (d) {
                return Object.keys(d.rates || {}).map(function (k) { return { sym:'USD/' + k, val: d.rates[k].toFixed(k === 'JPY' ? 2 : 4), chg: 0 }; });
            }).catch(function () { return []; });
        return Promise.all([crypto, fx]).then(function (r) {
            var all = r[0].concat(r[1]);
            if (!all.length) throw 0;
            return all;
        });
    }

    /* ── Weather ─────────────────────────────────────────────────────────
       Open-Meteo for the forecast and GeoJS for the city, both free, both
       key-less, both CORS-enabled. The city lookup is IP-based, so there is
       no browser permission prompt and no precise location — set FIXED_PLACE
       above to skip the lookup entirely. */
    function loadPlace() {
        if (FIXED_PLACE) return Promise.resolve(FIXED_PLACE);
        var c = cachedFor(CACHE_G, GEO_TTL);
        if (c) return Promise.resolve(c);
        return fetchJSON('https://get.geojs.io/v1/ip/geo.json').then(function (g) {
            var lat = parseFloat(g.latitude), lon = parseFloat(g.longitude);
            if (!isFinite(lat) || !isFinite(lon)) throw 0;
            var place = {
                name: g.city || g.region || g.country || 'Local',
                lat: lat, lon: lon,
                // Fahrenheit only where it is actually used day to day.
                unit: ['US','LR','MM'].indexOf(g.country_code) > -1 ? 'fahrenheit' : 'celsius'
            };
            cache(CACHE_G, place);
            return place;
        }).catch(function () { return DEFAULT_PLACE; });
    }

    function loadWeather() {
        var c = cachedFor(CACHE_W, WEATHER_TTL);
        if (c) return Promise.resolve(c);
        return loadPlace().then(function (p) {
            var url = 'https://api.open-meteo.com/v1/forecast'
                + '?latitude=' + p.lat + '&longitude=' + p.lon
                + '&current=temperature_2m,weather_code'
                + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
                + '&timezone=auto&forecast_days=5&temperature_unit=' + p.unit;
            return fetchJSON(url).then(function (w) {
                if (!w.current) throw 0;
                var days = [], d = w.daily || {};
                for (var i = 1; i < Math.min(5, (d.time || []).length); i++) {
                    days.push({
                        label: new Date(d.time[i] + 'T12:00:00').toLocaleDateString([], { weekday:'short' }).toUpperCase(),
                        code: d.weather_code[i],
                        hi: Math.round(d.temperature_2m_max[i]),
                        lo: Math.round(d.temperature_2m_min[i])
                    });
                }
                var out = {
                    city: p.name,
                    temp: Math.round(w.current.temperature_2m),
                    code: w.current.weather_code,
                    unit: p.unit === 'fahrenheit' ? 'F' : 'C',
                    days: days
                };
                cache(CACHE_W, out);
                return out;
            });
        });
    }

    function setWeather(w) {
        var city = $('wxCity'); if (!city) return;
        var cond = wmo(w.code);
        city.textContent = w.city;
        $('wxIcon').textContent = cond[1];
        $('wxTemp').textContent = w.temp + '°';
        $('wxCond').textContent = cond[0];
        $('wxDays').innerHTML = w.days.map(function (d) {
            var c = wmo(d.code);
            return '<div class="wx-day"><b>' + esc(d.label) + '</b><span>' + c[1] + '</span>' +
                   '<i>' + d.hi + '°<em>' + d.lo + '°</em></i></div>';
        }).join('');
        // …and read it out in the crawl too.
        wxItem = { beat:'WEATHER', text: w.city + ' ' + w.temp + '°' + w.unit + ' · ' + cond[0] +
                   (w.days[0] ? ' · ' + w.days[0].label + ' high ' + w.days[0].hi + '°' : '') };
        renderCrawl();
    }

    function refresh() {
        var label = $('newsSrcLabel');
        var ch = cached(CACHE_H), ct = cached(CACHE_T);

        var cw = cachedFor(CACHE_W, WEATHER_TTL);
        if (cw) setWeather(cw);
        else loadWeather().then(setWeather).catch(function () {
            var c = $('wxCond'); if (c) c.textContent = 'Unavailable';
        });

        setHeadlines(ch || FALLBACK_HEADLINES);
        setTicker(ct || FALLBACK_TICKER);
        if (label) label.textContent = ct ? 'MARKETS · LIVE' : 'MARKETS';

        if (!ch) loadHeadlines().then(function (h) { setHeadlines(h); cache(CACHE_H, h); })
                                .catch(function () { /* canned copy stays up */ });
        if (!ct) loadTicker().then(function (t) {
                                setTicker(t); cache(CACHE_T, t);
                                if (label) label.textContent = 'MARKETS · LIVE';
                             })
                             .catch(function () { if (label) label.textContent = 'MARKETS · OFFLINE'; });
    }
    function tickClock() {
        var c = $('newsClock');
        if (c) c.textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    }
    return {
        start: function () { build(); refresh(); tickClock(); if (!clockTimer) clockTimer = setInterval(tickClock, 1000); },
        stop:  function () { if (clockTimer) clearInterval(clockTimer); clockTimer = null; }
    };
})();


/* ═══════════ APPLY ══════════════════════════════════════════════════════ */
var BG = {
    cyberpunk: matrix,
    goop:      goop,
    pixelart:  pixel,
    retro:     retro,
    newsroom:  news
};

function activateBackground(style) {
    for (var k in BG) if (k !== style) BG[k].stop();
    if (BG[style]) BG[style].start();
}

function commit() {
    html.setAttribute('data-style', state.style);
    html.setAttribute('data-color', state.color);
    html.setAttribute('data-mode',  state.mode);
    activateBackground(state.style);
    iconMap = ICONS[state.style] || {};
    applyIcons(document);
    syncPanelUI();
    save();
    if (cfg.onChange) cfg.onChange(Object.assign({}, state));
}

/* The new theme spreads out from the control you clicked, as a circle,
   over the old one (View Transitions, Chrome/Edge/Safari 18+). A plain
   cross-fade went through a muddy half-and-half frame and responded late;
   this answers the click at the click. tt-theming holds every CSS
   transition off while the new state is captured (see theme.css), so the
   revealed page is already settled; tt-reveal carries the animation until
   it has finished. */
function transition(fn, from) {
    if (reduceMotion || !document.startViewTransition) { fn(); resetAnchors(); return; }
    var r = from && from.getBoundingClientRect ? from.getBoundingClientRect() : null;
    var x = r ? r.left + r.width / 2 : innerWidth - 40, y = r ? r.top + r.height / 2 : 40;
    html.style.setProperty('--tt-vt-x', x + 'px');
    html.style.setProperty('--tt-vt-y', y + 'px');
    html.style.setProperty('--tt-vt-r', Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 'px');
    html.classList.add('tt-reveal');
    var vt = document.startViewTransition(function () { html.classList.add('tt-theming'); fn(); });
    var ready = function () { html.classList.remove('tt-theming'); };
    // The anchored panel stays exactly where it was under the reveal (so the
    // circle never crosses a panel drawn at two heights) and glides back to
    // centre once the new theme is fully in.
    var done = function () { html.classList.remove('tt-reveal'); recentreAnchors(); };
    vt.ready.then(ready, ready);
    vt.finished.then(done, done);
}

function setStyle(s, from) { if (VALID_STYLES.indexOf(s) < 0) return; state.style = s; transition(commit, from); }
function setColor(c, from) { if (VALID_COLORS.indexOf(c) < 0) return; state.color = c; transition(commit, from); }
function setMode(m, from)  { state.mode = (m === 'light' ? 'light' : 'dark'); transition(commit, from); }


/* ═══════════ PICKER UI ══════════════════════════════════════════════════ */
function panelToggle(open) {
    var p = $('themePanel'); if (!p) return;
    var next = (open === undefined) ? !p.classList.contains('visible') : open;
    p.classList.toggle('visible', next);
    // The panel's contents settle top to bottom with it (heading, mode,
    // styles, colours), all inside ~130ms, so it reads in order and is
    // complete almost as soon as the shell is.
    if (next && !reduceMotion) Array.prototype.forEach.call(p.children, function (c, i) {
        c.animate([{ opacity:0, transform:'translateY(4px)' }, { opacity:1, transform:'none' }],
                  { duration:240, easing:EASE.out, delay:i * 22, fill:'backwards' });
    });
}

function buildUI() {
    var controls = el('div', { id:'ttControls' });
    controls.appendChild(el('a', { class:'tt-fab', href: HUB, 'aria-label':'Back to hub',
        html:'<span class="material-symbols-outlined">home</span>' }));
    controls.appendChild(el('button', { class:'tt-fab', id:'themePickerBtn', type:'button', 'aria-label':'Themes',
        html:'<span class="material-symbols-outlined">palette</span>',
        onclick: function (e) { e.stopPropagation(); panelToggle(); } }));
    document.body.appendChild(controls);

    var panel = el('div', { id:'themePanel', role:'dialog', 'aria-label':'Theme picker' });
    panel.appendChild(el('div', { class:'tt-panel-head' }, [
        el('b', { text:'Themes' }),
        el('button', { class:'tt-panel-close', type:'button', 'aria-label':'Close',
            html:'<span class="material-symbols-outlined" style="font-size:18px">close</span>',
            onclick: function () { panelToggle(false); } })
    ]));

    var pill = el('div', { class:'mode-pill' });
    pill.appendChild(el('button', { class:'mode-pill-btn', id:'ttModeDark', type:'button',
        html:'<span class="material-symbols-outlined">dark_mode</span><span>Dark</span>',
        onclick: function () { setMode('dark', this); } }));
    pill.appendChild(el('button', { class:'mode-pill-btn', id:'ttModeLight', type:'button',
        html:'<span class="material-symbols-outlined">light_mode</span><span>Light</span>',
        onclick: function () { setMode('light', this); } }));
    panel.appendChild(pill);

    panel.appendChild(el('span', { class:'tp-label', text:'UI Style' }));
    var grid = el('div', { class:'style-grid', id:'ttStyleGrid' });
    THEMES.forEach(function (t, i) {
        var b = el('button', { class:'style-btn', type:'button', 'data-style':t.id, style:'--i:' + i,
            onclick: function () { setStyle(t.id, this); } });
        b.appendChild(el('div', { class:'style-preview', html:t.preview }));
        b.appendChild(el('span', { text:t.name }));
        grid.appendChild(b);
    });
    panel.appendChild(grid);

    panel.appendChild(el('span', { class:'tp-label', text:'Color' }));
    var row = el('div', { class:'color-row' });
    COLORS.forEach(function (c) {
        row.appendChild(el('button', { class:'color-dot', type:'button', 'data-color':c.id, title:c.title,
            'aria-label':c.title, style:'background:' + c.swatch, onclick: function () { setColor(c.id, this); } }));
    });
    panel.appendChild(row);
    document.body.appendChild(panel);

    document.addEventListener('click', function (e) {
        var p = $('themePanel'), btn = $('themePickerBtn');
        if (p && p.classList.contains('visible') && !p.contains(e.target) && !btn.contains(e.target)) panelToggle(false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') panelToggle(false); });
}

function syncPanelUI() {
    document.querySelectorAll('.style-btn').forEach(function (b) { b.classList.toggle('selected', b.dataset.style === state.style); });
    document.querySelectorAll('.color-dot').forEach(function (d) { d.classList.toggle('selected', d.dataset.color === state.color); });
    var md = $('ttModeDark'), ml = $('ttModeLight');
    if (md) md.classList.toggle('active', state.mode === 'dark');
    if (ml) ml.classList.toggle('active', state.mode === 'light');
}


/* ═══════════ MOTION HELPERS ═════════════════════════════════════════════ */

/* Crisp-at-rest 3D tilt. The panel only gets preserve-3d and a transform
   while you're actually dragging it; the rest of the time it renders with
   no matrix at all, so text is never resampled. That, plus dropping the
   nested backdrop-filters, is the fix for "some themes look blurry". */
function tilt(panel, opts) {
    opts = opts || {};
    var max = opts.max || 16, sens = opts.sensitivity || 0.25;
    var dragging = false, px = 0, py = 0, tx = 0, ty = 0, cx = 0, cy = 0, loop = null, lastT = 0;

    var settleTimer = null, settleDone = null;

    // While dragging, ease toward the pointer so the motion is smooth rather
    // than a raw jump per mousemove. The follow rate is per unit of time, not
    // per frame, so it feels the same on a 60Hz and a 144Hz screen.
    function frame(now) {
        var dt = lastT ? Math.min(64, now - lastT) : 16.67; lastT = now;
        var k = 1 - Math.pow(1 - 0.28, dt / 16.67);
        cx += (tx - cx) * k; cy += (ty - cy) * k;
        panel.style.transform = 'rotateX(' + cy.toFixed(2) + 'deg) rotateY(' + cx.toFixed(2) + 'deg)';
        loop = dragging ? raf(frame) : null;
    }

    // Let go and it springs back on a fixed-duration CSS transition. A
    // proportional lerp decelerates forever near the end, so a two-turn spin
    // would crawl home; this returns just as snappily from 700deg as from 7.
    // The raised layers sink on the same beat (tt-lifted comes off now) and
    // the 3D context is dropped only once everything is flat — dropping it
    // while the layers were still raised made the whole panel jump 2% smaller
    // at the very end of every release.
    function settle() {
        cancelSettle();
        panel.style.transition = 'transform 720ms cubic-bezier(0.22,1,0.36,1)';
        panel.style.transform = 'rotateX(0deg) rotateY(0deg)';
        panel.classList.remove('tt-lifted');
        tx = ty = cx = cy = 0;
        function finish() {
            cancelSettle();
            // Drop the transform AND preserve-3d so the panel is rasterised at
            // native resolution again — this is what keeps the text crisp.
            panel.style.transition = '';
            panel.style.transform = '';
            panel.classList.remove('tt-tilting');
        }
        // Children's transitions bubble up here too (a hovered button, the
        // sinking layers); only the panel's own transform ends the settle.
        settleDone = function (e) { if (e.target === panel && e.propertyName === 'transform') finish(); };
        panel.addEventListener('transitionend', settleDone);
        settleTimer = setTimeout(finish, 820);   // if transitionend never fires
    }
    function cancelSettle() {
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
        if (settleDone) { panel.removeEventListener('transitionend', settleDone); settleDone = null; }
    }

    function begin(e) {
        if (reduceMotion) return;
        if (e.target.closest('button,input,a,label,select,textarea,.sound-card,.slider,.tt-no-drag')) return;
        var list = opts.excludeScroll && opts.excludeScroll();
        if (list && list.contains(e.target)) {
            var r = list.getBoundingClientRect(), sbw = list.offsetWidth - list.clientWidth;
            if (e.clientX >= r.right - sbw && e.clientX <= r.right) return;
        }
        cancelSettle();
        // Pick up from wherever the spring-back had got to, so grabbing it
        // mid-return doesn't snap.
        var m = new DOMMatrixReadOnly(getComputedStyle(panel).transform);
        cx = tx = Math.atan2(-m.m31, m.m11) * 180 / Math.PI;
        cy = ty = Math.asin(Math.max(-1, Math.min(1, m.m32))) * 180 / Math.PI;
        dragging = true; px = e.clientX; py = e.clientY;
        panel.classList.add('tt-tilting', 'tt-lifted');
        panel.style.transition = 'none';
        lastT = 0;
        if (!loop) loop = raf(frame);
    }
    document.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        cxAdd(e.clientX - px, e.clientY - py); px = e.clientX; py = e.clientY;
    });
    function cxAdd(dx, dy) {
        tx += dx * sens; ty -= dy * sens;
        // Vertical tilt stays clamped so the panel never flips onto its back,
        // but Y is deliberately UNBOUNDED — drag sideways and you can whip the
        // whole page right around and watch it spring back through the spin.
        ty = Math.max(-max, Math.min(max, ty));
    }
    document.addEventListener('mouseup', function () {
        if (!dragging) return;
        dragging = false;
        if (loop) { cancelAnimationFrame(loop); loop = null; }
        settle();
    });
    panel.addEventListener('mousedown', begin);
    panel.ondragstart = function () { return false; };
}

/* Curves for WAAPI, mirroring the CSS tokens in theme.css. */
var EASE = {
    out:  'cubic-bezier(0.22, 1, 0.36, 1)',
    in:   'cubic-bezier(0.4, 0, 1, 1)',
    move: 'cubic-bezier(0.2, 0, 0, 1)'
};
function STEPS(n, pos) { return 'steps(' + n + ', ' + (pos || 'jump-end') + ')'; }


/* ═══════════ PER-THEME MOTION LANGUAGE ══════════════════════════════════
   Every helper below asks mo() how the active theme moves instead of
   hard-coding one curve. The soft styles glide; glass comes into focus;
   goop is viscous; neumorphic rises out of the surface; minimal only fades;
   the blueprint is plotted on; the terminal glitches and powers on like a
   CRT; the 8-bit world steps; Win95 snaps and zooms its outline; the
   manuscript inks in; brutalism cuts; the newsroom wipes like a graphics
   package. Each entry is K(keyframes, ms, easing, {delay, gap}). */
function K(k, d, e, x) { var o = { k: k, d: d, e: e || 'linear', delay: 0 }; if (x) for (var i in x) o[i] = x[i]; return o; }
var PLOT = 'cubic-bezier(0.45, 0, 0.2, 1)', WIPE = 'cubic-bezier(0.8, 0, 0.2, 1)',
    INK  = 'cubic-bezier(0.3, 0.1, 0.3, 1)',  GOO  = 'cubic-bezier(0.3, 0.6, 0.35, 1)';
var HOLD = 'steps(1, jump-end)';
var GLITCH = [
    { opacity:0, clipPath:'inset(0 0 100% 0)', transform:'translateX(0)', easing:HOLD },
    { opacity:1, clipPath:'inset(35% 0 40% 0)', transform:'translateX(-8px)', offset:0.2, easing:HOLD },
    { opacity:1, clipPath:'inset(70% 0 8% 0)',  transform:'translateX(6px)',  offset:0.4, easing:HOLD },
    { opacity:1, clipPath:'inset(10% 0 55% 0)', transform:'translateX(-3px)', offset:0.6, easing:HOLD },
    { opacity:1, clipPath:'inset(0 0 0 0)',     transform:'translateX(2px)',  offset:0.8, easing:HOLD },
    { opacity:1, clipPath:'inset(0 0 0 0)',     transform:'none' }
];
var CRT_ON = [
    { opacity:0, transform:'scale(0.3, 0.006)', filter:'brightness(3)' },
    { opacity:1, transform:'scale(1, 0.006)',   filter:'brightness(3)',   offset:0.35 },
    { opacity:1, transform:'scale(1, 1)',       filter:'brightness(1.7)', offset:0.72 },
    { opacity:1, transform:'none',              filter:'brightness(1)' }
];
var CRT_OFF = [
    { opacity:1, transform:'none',              filter:'brightness(1)' },
    { opacity:1, transform:'scale(1, 0.006)',   filter:'brightness(2.5)', offset:0.55 },
    { opacity:0, transform:'scale(0, 0.006)',   filter:'brightness(3)' }
];
var FLICKER = [
    { opacity:1, easing:HOLD }, { opacity:0.25, offset:0.2, easing:HOLD }, { opacity:1, offset:0.4, easing:HOLD },
    { opacity:0.45, offset:0.6, easing:HOLD }, { opacity:1 }
];

var MOTION = {
    base: {
        rowIn:    K([{ opacity:0, transform:'scale(0.98)' }, { opacity:1, transform:'none' }], 300, EASE.out),
        rowFirst: K([{ opacity:0, transform:'translateY(10px)' }, { opacity:1, transform:'none' }], 460, EASE.out, { delay:80, gap:40 }),
        // Leaving rows are mostly gone within ~100ms, so the gap never closes
        // over a still-visible row. From the row's current opacity (dimmed
        // completed calls included), hence a single keyframe.
        rowOut:   K([{ opacity:0, transform:'translateX(12px)' }], 130, 'cubic-bezier(0.3, 0, 0.6, 1)'),
        lag: 100,                                       // gap waits this long for a leaving row
        move:     K(null, 380, EASE.move),
        reveal:   K([{ opacity:0, transform:'translateY(6px)' }, { opacity:1, transform:'none' }], 360, EASE.out),
        scrimIn:  K([{ opacity:0 }, { opacity:1 }], 220, EASE.out),
        scrimOut: K([{ opacity:1 }, { opacity:0 }], 200, EASE.in),
        boxIn:   [K([{ opacity:0 }, { opacity:1 }], 200, EASE.out, { delay:30 }),
                  K([{ transform:'translateY(12px) scale(0.97)' }, { transform:'none' }], 360, EASE.out, { delay:30 })],
        boxOut:  [K([{ opacity:1, transform:'none' }, { opacity:0, transform:'translateY(6px) scale(0.98)' }], 160, EASE.in)],
        arrive:   K([{ opacity:0, translate:'0 14px' }, { opacity:1, translate:'0 0' }], 560, EASE.out),
        roll:     { mode:'reel', d:340, e:EASE.move, gap:45 },
        // Short-tailed ease-out, so a rate or % lands together with the
        // odometers beside it instead of crawling in its last 0.x% afterwards.
        count:    { d:420, e:'cubic-bezier(0.33, 1, 0.68, 1)' },
        chart:    { d:560, e:EASE.out, draw:900 },     // line morph / first draw-on (flow)
        origin:   true,                                // dialogs grow from the control that opened them
        toggleOn: null, toggleOff: null,
        ripple:   true
    },
    glass: {                                            // frosted: things come into focus
        rowIn:    K([{ opacity:0, transform:'scale(0.98)', filter:'blur(6px)' }, { opacity:1, transform:'none', filter:'blur(0px)' }], 380, EASE.out),
        rowFirst: K([{ opacity:0, transform:'translateY(10px)', filter:'blur(6px)' }, { opacity:1, transform:'none', filter:'blur(0px)' }], 520, EASE.out, { delay:80, gap:45 }),
        rowOut:   K([{ opacity:0, transform:'scale(0.98)', filter:'blur(6px)' }], 150, EASE.in),
        lag: 120,
        reveal:   K([{ opacity:0, filter:'blur(6px)' }, { opacity:1, filter:'blur(0px)' }], 400, EASE.out),
        boxIn:   [K([{ opacity:0, filter:'blur(12px)' }, { opacity:1, filter:'blur(0px)' }], 320, EASE.out, { delay:20 }),
                  K([{ transform:'scale(0.96)' }, { transform:'none' }], 420, EASE.out, { delay:20 })],
        boxOut:  [K([{ opacity:1, filter:'blur(0px)', transform:'none' }, { opacity:0, filter:'blur(10px)', transform:'scale(0.98)' }], 200, EASE.in)]
    },
    goop: {                                             // viscous: things ooze in and settle like a drop
        rowIn:    K([{ opacity:0, transform:'scale(0.9, 0.7)' }, { opacity:1, transform:'scale(1.015, 0.99)', offset:0.6 }, { opacity:1, transform:'none' }], 560, GOO),
        rowFirst: K([{ opacity:0, transform:'translateY(12px) scale(0.92, 0.8)' }, { opacity:1, transform:'scale(1.015, 0.99)', offset:0.6 }, { opacity:1, transform:'none' }], 600, GOO, { delay:80, gap:55 }),
        rowOut:   K([{ opacity:0, transform:'scale(0.86, 0.6)' }], 170, EASE.in),
        lag: 140,
        move:     K(null, 460, GOO),
        boxIn:   [K([{ opacity:0 }, { opacity:1 }], 220, EASE.out),
                  K([{ transform:'scale(0.86, 0.72)' }, { transform:'scale(1.015, 0.99)', offset:0.6 }, { transform:'none' }], 560, GOO)],
        boxOut:  [K([{ opacity:1, transform:'none' }, { opacity:0, transform:'scale(0.88, 0.75)' }], 220, EASE.in)],
        toggleOn: K([{ transform:'scale(1.1, 0.86)' }, { transform:'none' }], 420, GOO),
        toggleOff:K([{ transform:'scale(1.1, 0.86)' }, { transform:'none' }], 420, GOO)
    },
    neumorphic: {                                       // soft UI: rises out of / sinks back into the surface
        rowIn:    K([{ opacity:0, transform:'scale(0.95)' }, { opacity:1, transform:'none' }], 420, 'cubic-bezier(0.2, 0.7, 0.2, 1)'),
        rowOut:   K([{ opacity:0, transform:'scale(0.95)' }], 150, EASE.in),
        lag: 120,
        boxIn:   [K([{ opacity:0 }, { opacity:1 }], 260, EASE.out),
                  K([{ transform:'scale(0.94)' }, { transform:'none' }], 440, 'cubic-bezier(0.2, 0.7, 0.2, 1)')],
        boxOut:  [K([{ opacity:1, transform:'none' }, { opacity:0, transform:'scale(0.95)' }], 200, EASE.in)]
    },
    minimal: {                                          // nothing travels; things are simply there
        rowIn:    K([{ opacity:0 }, { opacity:1 }], 180, 'ease-out'),
        rowFirst: K([{ opacity:0 }, { opacity:1 }], 260, 'ease-out', { delay:40, gap:25 }),
        rowOut:   K([{ opacity:0 }], 110, 'ease-out'),
        lag: 80,
        move:     K(null, 240, EASE.move),
        reveal:   K([{ opacity:0 }, { opacity:1 }], 200, 'ease-out'),
        scrimIn:  K([{ opacity:0 }, { opacity:1 }], 150, 'ease-out'),
        scrimOut: K([{ opacity:1 }, { opacity:0 }], 120, 'ease-in'),
        boxIn:   [K([{ opacity:0, transform:'translateY(4px)' }, { opacity:1, transform:'none' }], 180, 'ease-out')],
        boxOut:  [K([{ opacity:1 }, { opacity:0 }], 110, 'ease-in')],
        arrive:   K([{ opacity:0 }, { opacity:1 }], 320, 'ease-out'),
        roll:     { mode:'reel', d:220, e:EASE.move, gap:30 },
        count:    { d:300, e:'ease-out' },
        chart:    { d:300, e:'ease-out', draw:500 },
        ripple:   false
    },
    blueprint: {                                        // drafted: plotted on left to right, erased the same way
        rowIn:    K([{ clipPath:'inset(0 100% 0 0)' }, { clipPath:'inset(0 0 0 0)' }], 420, PLOT),
        rowFirst: K([{ clipPath:'inset(0 100% 0 0)' }, { clipPath:'inset(0 0 0 0)' }], 460, PLOT, { delay:80, gap:70 }),
        rowOut:   K([{ clipPath:'inset(0 0 0 0)' }, { clipPath:'inset(0 0 0 100%)' }], 220, PLOT),
        lag: 180,
        move:     K(null, 360, PLOT),
        chart:    { d:520, e:PLOT, draw:1100 },
        reveal:   K([{ clipPath:'inset(0 100% 0 0)' }, { clipPath:'inset(0 0 0 0)' }], 380, PLOT),
        boxIn:   [K([{ clipPath:'inset(-60px -60px 100% -60px)' }, { clipPath:'inset(-60px -60px -60px -60px)' }], 400, PLOT)],
        boxOut:  [K([{ clipPath:'inset(-60px -60px -60px -60px)' }, { clipPath:'inset(-60px -60px 100% -60px)' }], 220, PLOT)],
        origin:   false,
        ripple:   false
    },
    cyberpunk: {                                        // terminal: glitches in, powers off like a CRT
        rowIn:    K(GLITCH, 280, 'linear'),
        rowFirst: K(GLITCH, 300, 'linear', { delay:60, gap:60 }),
        rowOut:   K(CRT_OFF, 220, 'linear'),
        lag: 130,                                       // by then it has collapsed to a line
        move:     K(null, 180, STEPS(3, 'jump-start')),
        reveal:   K(GLITCH, 240, 'linear'),
        scrimIn:  K([{ opacity:0 }, { opacity:1 }], 160, STEPS(3, 'jump-start')),
        scrimOut: K([{ opacity:1 }, { opacity:0 }], 140, STEPS(2)),
        boxIn:   [K(CRT_ON, 380, 'ease-out')],
        boxOut:  [K(CRT_OFF, 240, 'linear')],
        arrive:   K(CRT_ON, 480, 'ease-out'),
        roll:     { mode:'scramble', d:320 },
        count:    { d:520, e:STEPS(12, 'jump-start') },
        chart:    { d:320, e:STEPS(8, 'jump-start'), draw:600 },
        toggleOn: K(FLICKER, 220, 'linear'),
        origin:   false,
        ripple:   false
    },
    pixelart: {                                         // 8-bit: everything moves on whole steps
        rowIn:    K([{ opacity:0, transform:'translateX(-24px)' }, { opacity:1, transform:'none' }], 240, STEPS(4, 'jump-start')),
        rowFirst: K([{ opacity:0, transform:'translateX(-24px)' }, { opacity:1, transform:'none' }], 280, STEPS(4, 'jump-start'), { delay:60, gap:70 }),
        rowOut:   K([{ opacity:1, transform:'none' }, { opacity:0, transform:'translateX(24px)' }], 160, STEPS(3)),
        lag: 160,                                       // a stepped exit is only gone on its last step
        move:     K(null, 240, STEPS(4, 'jump-start')),
        reveal:   K([{ opacity:0 }, { opacity:1 }], 200, STEPS(3, 'jump-start')),
        scrimIn:  K([{ opacity:0 }, { opacity:1 }], 150, STEPS(3, 'jump-start')),
        scrimOut: K([{ opacity:1 }, { opacity:0 }], 120, STEPS(2)),
        // RPG text box: opens as a line, then drops open
        boxIn:   [K([{ transform:'scale(0.1, 0.12)' }, { transform:'scale(1, 0.12)', offset:0.5 }, { transform:'none' }], 300, STEPS(8, 'jump-start'))],
        boxOut:  [K([{ opacity:1, transform:'none' }, { opacity:1, transform:'scale(1, 0.12)', offset:0.5 }, { opacity:0, transform:'scale(0.1, 0.12)' }], 220, STEPS(6))],
        arrive:   K([{ opacity:0, translate:'0 16px' }, { opacity:1, translate:'0 0' }], 400, STEPS(5, 'jump-start')),
        roll:     { mode:'reel', d:240, e:STEPS(3, 'jump-start'), gap:60 },
        count:    { d:420, e:STEPS(8, 'jump-start') },
        chart:    { d:360, e:STEPS(6, 'jump-start'), draw:600 },
        origin:   false,
        ripple:   false
    },
    retro: {                                            // Windows 95: no easing anywhere; windows zoom an outline
        rowIn:    K([{ outlineStyle:'dotted', outlineWidth:'1px', outlineColor:'#000', outlineOffset:'-3px' },
                     { outlineStyle:'dotted', outlineWidth:'1px', outlineColor:'#000', outlineOffset:'-3px' }], 1400, 'linear'),  // the new item takes focus
        rowFirst: null,
        rowOut:   K([{ opacity:0 }], 1, 'linear'),
        lag: 0,
        move:     K(null, 0),
        reveal:   null,
        scrimIn:  null, scrimOut: null,
        boxIn:   'zoom', boxOut: 'zoom',
        arrive:  'zoom',
        roll:     { mode:'snap' },
        count:    { d:0 },
        chart:    { d:0, draw:0 },                     // System Monitor just redraws
        origin:   false,
        ripple:   false
    },
    medieval: {                                         // manuscript: ink soaks in, and fades like smoke
        // Unhurried, but every response is readable within ~500ms.
        rowIn:    K([{ opacity:0, filter:'blur(3px)', transform:'translateY(-3px)' }, { opacity:1, filter:'blur(0px)', transform:'none' }], 480, INK),
        rowFirst: K([{ opacity:0, filter:'blur(3px)', transform:'translateY(-3px)' }, { opacity:1, filter:'blur(0px)', transform:'none' }], 600, INK, { delay:100, gap:70 }),
        rowOut:   K([{ opacity:0, filter:'blur(3px) sepia(1)', transform:'translateY(-8px)' }], 280, 'cubic-bezier(0.2, 0, 0.6, 1)'),
        lag: 210,
        move:     K(null, 460, 'cubic-bezier(0.45, 0, 0.25, 1)'),
        reveal:   K([{ opacity:0, filter:'blur(3px)' }, { opacity:1, filter:'blur(0px)' }], 480, INK),
        scrimIn:  K([{ opacity:0 }, { opacity:1 }], 300, 'ease'),
        scrimOut: K([{ opacity:1 }, { opacity:0 }], 240, 'ease'),
        // the dialog unrolls like a scroll from its middle
        boxIn:   [K([{ clipPath:'inset(47% -80px 47% -80px)', opacity:0.4 }, { clipPath:'inset(-80px -80px -80px -80px)', opacity:1 }], 460, 'cubic-bezier(0.6, 0, 0.2, 1)')],
        boxOut:  [K([{ clipPath:'inset(-80px -80px -80px -80px)', opacity:1 }, { clipPath:'inset(47% -80px 47% -80px)', opacity:0 }], 300, EASE.in)],
        arrive:   K([{ opacity:0, filter:'blur(4px)' }, { opacity:1, filter:'blur(0px)' }], 800, INK),
        roll:     { mode:'reel', d:420, e:INK, gap:70 },
        count:    { d:480, e:INK },
        chart:    { d:520, e:INK, draw:1100 },
        origin:   false,
        // pressing the seal: it comes down onto the page
        toggleOn: K([{ transform:'scale(1.5)', opacity:0.15 }, { transform:'scale(0.92)', opacity:1, offset:0.7 }, { transform:'none', opacity:1 }], 380, 'cubic-bezier(0.5, 0, 0.3, 1)')
    },
    brutalist: {                                        // hard cuts: no easing, things land by their offset
        rowIn:    K([{ opacity:0, transform:'translate(10px, 10px)' }, { opacity:1, transform:'none' }], 120, STEPS(2, 'jump-start')),
        rowFirst: K([{ opacity:0, transform:'translate(10px, 10px)' }, { opacity:1, transform:'none' }], 140, STEPS(2, 'jump-start'), { delay:40, gap:45 }),
        rowOut:   K([{ opacity:0, transform:'translateX(-12px)' }], 80, STEPS(1)),
        lag: 80,
        move:     K(null, 150, STEPS(3, 'jump-start')),
        reveal:   K([{ opacity:0 }, { opacity:1 }], 80, STEPS(1, 'jump-start')),
        scrimIn:  K([{ opacity:0 }, { opacity:1 }], 60, STEPS(1, 'jump-start')),
        scrimOut: K([{ opacity:1 }, { opacity:0 }], 60, STEPS(1)),
        boxIn:   [K([{ opacity:0, transform:'translate(18px, 18px)' }, { opacity:1, transform:'none' }], 130, STEPS(2, 'jump-start'))],
        boxOut:  [K([{ opacity:1 }, { opacity:0 }], 70, STEPS(1))],
        arrive:   K([{ opacity:0, translate:'20px 20px' }, { opacity:1, translate:'0 0' }], 200, STEPS(3, 'jump-start')),
        roll:     { mode:'reel', d:140, e:STEPS(2, 'jump-start'), gap:40 },
        count:    { d:260, e:STEPS(5, 'jump-start') },
        chart:    { d:180, e:STEPS(3, 'jump-start'), draw:300 },
        origin:   false,
        ripple:   false
    },
    newsroom: {                                         // broadcast package: hard wipes on a fast in-out
        rowIn:    K([{ clipPath:'inset(0 100% 0 0)', transform:'translateX(-14px)' }, { clipPath:'inset(0 0 0 0)', transform:'none' }], 380, WIPE),
        rowFirst: K([{ clipPath:'inset(0 100% 0 0)', transform:'translateX(-14px)' }, { clipPath:'inset(0 0 0 0)', transform:'none' }], 420, WIPE, { delay:80, gap:70 }),
        rowOut:   K([{ clipPath:'inset(0 0 0 0)' }, { clipPath:'inset(0 0 0 100%)' }], 220, 'cubic-bezier(0.7, 0, 0.9, 0.6)'),
        lag: 180,
        move:     K(null, 360, WIPE),
        reveal:   K([{ clipPath:'inset(0 100% 0 0)' }, { clipPath:'inset(0 0 0 0)' }], 360, WIPE),
        boxIn:   [K([{ clipPath:'inset(-60px 100% -60px -60px)', transform:'translateX(-30px)' }, { clipPath:'inset(-60px -60px -60px -60px)', transform:'none' }], 440, WIPE)],
        boxOut:  [K([{ clipPath:'inset(-60px -60px -60px -60px)', transform:'none' }, { clipPath:'inset(-60px -60px -60px 100%)', transform:'translateX(20px)' }], 260, 'cubic-bezier(0.7, 0, 0.9, 0.6)')],
        arrive:   K([{ clipPath:'inset(-80px 100% -80px -80px)' }, { clipPath:'inset(-80px -80px -80px -80px)' }], 620, WIPE),
        chart:    { d:420, e:WIPE, draw:700 },
        origin:   false,
        toggleOn: K([{ filter:'brightness(1.9)' }, { filter:'brightness(1)' }], 320, EASE.out)
    }
};
function mo() {
    var m = MOTION[state.style] || {}, b = MOTION.base, o = {};
    for (var k in b) o[k] = (k in m) ? m[k] : b[k];
    return o;
}
/* When (as a fraction of its duration) does a timing curve reach progress p?
   Measured through WAAPI itself so it is exact for any easing, including
   steps() and in-out curves, and cached per curve. Used to start a new row
   only once the rows making room for it have (nearly) finished moving. */
var reachCache = {};
function timeTo(easing, p) {
    var key = easing + '|' + p;
    if (key in reachCache) return reachCache[key];
    var a = document.documentElement.animate([], { duration:1000, easing:easing }); a.pause();
    var lo = 0, hi = 1;
    for (var i = 0; i < 14; i++) {
        var mid = (lo + hi) / 2; a.currentTime = mid * 1000;
        if ((a.effect.getComputedTiming().progress || 0) >= p) hi = mid; else lo = mid;
    }
    a.cancel();
    return (reachCache[key] = hi);
}
/* Play one motion spec on an element (null / zero-length specs are no-ops). */
function run(elm, s, x) {
    if (!elm || !s || !s.k || !(s.d > 0) || reduceMotion) return null;
    x = x || {};
    return elm.animate(s.k, { duration: s.d, easing: s.e, delay: (s.delay || 0) + (x.delay || 0),
                              fill: x.fill || 'backwards', composite: x.composite || 'replace' });
}

/* A JS-driven tween whose clock is a keyframe-less WAAPI animation. The
   browser owns timing and easing, so these run on the same timeline as the
   CSS around them (they pause and slow down with it in DevTools), and never
   mix performance.now() with rAF timestamps, which is what let the old
   countUp tick backwards for a frame before it started. cancel() stops it. */
function tween(host, duration, easing, fn, delay) {
    var a = host.animate([], { duration: duration, easing: easing || EASE.out, delay: delay || 0 });
    (function step() {
        if (a.playState === 'idle') return;                     // cancelled
        if (a.playState === 'finished') { fn(1); return; }
        var p = a.effect.getComputedTiming().progress;
        fn(p == null ? 0 : p);
        raf(step);
    })();
    return a;
}

/* Rolls a number through its in-between values (for rates and percentages).
   A newer call cancels the running one and starts from whatever figure is
   on screen, so quick successive changes never race or jump back. */
function countUp(node, to, opts) {
    opts = opts || {};
    var dec = opts.decimals || 0, suffix = opts.suffix || '', c = mo().count;
    if (node.__ttCount) { node.__ttCount.cancel(); node.__ttCount = null; }
    var from = parseFloat(String(node.textContent).replace(/[^0-9.\-]/g, '')) || 0;
    var step = opts.onStep || null;                   // e.g. colour the figure by the value SHOWN
    if (reduceMotion || from === to || !(c.d > 0)) { node.textContent = to.toFixed(dec) + suffix; if (step) step(to); return; }
    node.__ttCount = tween(node, opts.duration || c.d, c.e, function (e) {
        var v = from + (to - from) * e;
        node.textContent = v.toFixed(dec) + suffix;
        if (step) step(v);
    });
}

/* Odometer for whole-number counters. Each changed column is a clipped reel:
   the old digit and the new one sit a full line apart and travel together,
   up for an increase and down for a decrease, units first and carries a
   beat later. A press that lands mid-roll continues the reel from exactly
   where it is instead of snapping it to rest. A column that gains or loses
   a digit opens or closes smoothly. Themes may snap it (Win95) or decrypt
   it (terminal). */
function roll(node, to) {
    var next = String(to), r = mo().roll;
    var prev = node.__ttRollTo != null ? node.__ttRollTo : node.textContent.trim();
    // Where each column of an unfinished roll is right now, in lines.
    var carry = {};
    if (node.__ttRoll) {
        (node.__ttCells || []).forEach(function (c) {
            var h = c.cell.offsetHeight || 1, m = new DOMMatrixReadOnly(getComputedStyle(c.inn).transform);
            carry[c.col] = { y: m.m42 / h, out: c.outChar, dir: c.dir };
        });
        var old = node.__ttRoll; node.__ttRoll = null; old.forEach(function (a) { a.cancel(); });
    }
    node.__ttRollTo = next; node.__ttCells = null;
    if (reduceMotion || prev === next || r.mode === 'snap') { node.textContent = next; return; }
    var n = Math.max(prev.length, next.length), a = prev, b = next;
    while (a.length < n) a = ' ' + a;
    while (b.length < n) b = ' ' + b;
    // Split into text + cells the number gains line-break opportunities it
    // didn't have as one word; in a tight card it would wrap mid-roll.
    node.style.whiteSpace = 'nowrap';

    if (r.mode === 'scramble') {                       // terminal: columns decrypt left to right
        // New glyphs on a fixed 35ms tick (not per display frame, which would
        // flicker 2.4x faster on a 144Hz screen); every column has resolved
        // by 60% of the run, the rest is the settled figure.
        var anim = tween(node, r.d, 'linear', function (p) {
            var tick = Math.floor(p * r.d / 35), s = '';
            for (var i = 0; i < n; i++)
                s += (a[i] === b[i] || p >= 0.2 + 0.4 * (i + 1) / n) ? b[i] : String((tick * 7 + i * 3 + (tick * i) % 5) % 10);
            node.textContent = p >= 1 ? next : s.replace(/^ +/, '');
        });
        node.__ttRoll = [anim];
        anim.finished.then(function () { if (node.__ttRoll && node.__ttRoll[0] === anim) { node.__ttRoll = null; node.textContent = next; } }, function () {});
        return;
    }

    var dir = (parseFloat(next) || 0) >= (parseFloat(prev) || 0) ? 1 : -1;
    node.textContent = '';
    var cells = [];
    for (var i = 0; i < n; i++) {
        var col = n - 1 - i, cy = carry[col];
        if (a[i] === b[i] && !(cy && Math.abs(cy.y) > 0.01)) { if (b[i] !== ' ') node.appendChild(document.createTextNode(b[i])); continue; }
        var cell = el('span', { class:'tt-roll' });
        var outChar = a[i] === b[i] ? (cy ? cy.out : a[i]) : a[i];
        var inn = el('span', { class:'tt-roll-in', text: b[i] === ' ' ? '' : b[i] });
        var out = el('span', { class:'tt-roll-out', text: outChar === ' ' ? '' : outChar, 'aria-hidden':'true' });
        cell.appendChild(inn); cell.appendChild(out); node.appendChild(cell);
        // A column already in flight keeps its own direction and position.
        var d = (a[i] === b[i] && cy) ? cy.dir : dir, y0 = cy ? cy.y : 0;
        cells.push({ cell: cell, inn: inn, out: out, col: col, dir: d, y0: y0, outChar: outChar,
                     cont: a[i] === b[i], delay: cy ? 0 : col * r.gap });
    }
    cells.forEach(function (c) { c.w0 = c.out.offsetWidth; c.w1 = c.inn.offsetWidth; c.h = c.cell.offsetHeight || 1; });   // measure once
    var anims = [];
    cells.forEach(function (c) {
        var t = { duration: r.d, easing: r.e, delay: c.delay, fill: 'backwards' };
        // One strip: the new digit is always a full line behind the old one.
        // A column still settling from the last press keeps settling (its digit
        // is already the right one); a changing column's in-flight digit
        // becomes the one that leaves.
        var inFrom = c.cont ? c.y0 : c.y0 + c.dir, outFrom = c.cont ? c.y0 - c.dir : c.y0;
        anims.push(c.inn.animate([{ transform:'translateY(' + (inFrom * c.h) + 'px)' }, { transform:'translateY(0px)' }], t));
        anims.push(c.out.animate([{ transform:'translateY(' + (outFrom * c.h) + 'px)' }, { transform:'translateY(' + (-c.dir * c.h) + 'px)' }],
                                 { duration: r.d, easing: r.e, delay: c.delay, fill: 'both' }));
        if (c.w0 !== c.w1) anims.push(c.cell.animate([{ width:c.w0 + 'px' }, { width:c.w1 + 'px' }], t));
    });
    node.__ttRoll = anims; node.__ttCells = cells;
    Promise.all(anims.map(function (x) { return x.finished; })).then(function () {
        if (node.__ttRoll === anims) { node.__ttRoll = null; node.__ttCells = null; node.textContent = next; }
    }, function () {});
}

/* One meter, rendered in whatever form the active theme calls for, and
   updated in place. The bar is a full-width fill slid along its track with
   a transform (compositor-only; the track's rounded clip keeps the ends
   identical to the old width-based fill). Segments and hearts switch on one
   after another in the direction the value moved. A theme swap rebuilds the
   meter straight at its value; only the very first build fills from empty. */
function renderMeter(node, pct, opts) {
    if (!node) return;
    opts = opts || {};
    var p = Math.max(0, Math.min(100, pct || 0));
    var kind = ['pixelart','cyberpunk','retro','brutalist','blueprint'].indexOf(state.style) > -1 ? 'seg'
             : state.style === 'medieval' ? 'heart' : 'bar';
    var N = kind === 'seg' ? (opts.segments || 10) : kind === 'heart' ? (opts.hearts || 5) : 0;
    var sig = kind + N, first = node.__ttMeter == null, fresh = node.__ttMeter !== sig;
    var lit = N ? Math.round(p / (100 / N)) : 0;
    if (fresh) {
        node.className = (opts.baseClass || 'tt-meter');
        node.innerHTML = '';
        if (kind === 'bar') {
            node.appendChild(el('div', { class:'meter-fill', style:'transform:translateX(' + ((first ? 0 : p) - 100) + '%)' }));
        } else {
            node.classList.add(kind === 'seg' ? 'seg-meter' : 'heart-meter');
            for (var i = 0; i < N; i++) {
                var on = !first && i < lit;
                node.appendChild(el('span', kind === 'seg' ? { class:'seg' + (on ? ' on' : '') }
                                                           : { class:'heart' + (on ? ' on' : ''), text:'♥' }));
            }
        }
        node.__ttMeter = sig; node.__ttLit = first ? 0 : lit;
        if (first) void node.offsetWidth;              // commit the empty state so the fill transitions
    }
    if (kind === 'bar') { node.firstChild.style.transform = 'translateX(' + (p - 100) + '%)'; return; }
    var was = node.__ttLit, step = kind === 'seg' ? 26 : 70;
    Array.prototype.forEach.call(node.children, function (c, i) {
        var want = i < lit;
        if (c.classList.contains('on') === want) return;
        c.style.setProperty('--d', Math.max(0, lit > was ? i - was : was - 1 - i) * step + 'ms');
        c.classList.toggle('on', want);
    });
    node.__ttLit = lit;
}

/* Keyed list rendering with FLIP.
     list(container, items, { key: it => id, create: it => node,
                              update: (node, it) => void, empty: node, anchor: panel })
   Rows that survive keep their DOM node, so a switch you just flipped
   finishes its own slide instead of being rebuilt mid-motion. Rows that move
   glide to their new slot; new rows arrive into the gap the others open for
   them; removed rows lift out and are mostly gone before the rest close up.
   `empty` is shown when there are no items and cross-fades with the first
   row. Only the very first render cascades the list in (and settles its
   layout silently). How each of those moves is the theme's (mo()).

   If the container itself changes height (a panel that sizes to its
   content), its height is animated, and `anchor` (the centred panel) is
   held by its top edge with a compensating translate, so the header, the
   input and whatever is under the pointer stay still while the list grows
   or shrinks below them. Returns the new rows. */
var anchors = [];
function list(container, items, o) {
    var first = !container.__ttList, animate = !reduceMotion, empty = o.empty || null, p = mo(), A = o.anchor || null;
    container.__ttList = true;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    if (A && anchors.indexOf(A) < 0) anchors.push(A);

    var live = [], byKey = {};
    Array.prototype.forEach.call(container.children, function (c) {
        if (c.__ttKey != null && !c.__ttLeaving) { live.push(c); byKey[c.__ttKey] = c; }
    });

    // FIRST: where every row is on screen right now (mid-flight included),
    // how tall the list is, and where the anchored panel currently sits.
    var before = new Map(), h0 = 0, shift0 = 0;
    if (animate && !first) {
        live.forEach(function (c) { before.set(c, c.getBoundingClientRect()); });
        h0 = container.offsetHeight;
        if (A) shift0 = parseFloat(String(getComputedStyle(A).translate).split(' ')[1]) || 0;
    }

    var keep = {}, added = [];
    var nodes = items.map(function (it) {
        var k = String(o.key(it)), n = byKey[k];
        if (n) { if (o.update) o.update(n, it); }
        else { n = o.create(it); n.__ttKey = k; added.push(n); }
        keep[k] = true;
        return n;
    });

    // Rows on their way out are lifted out of the flow exactly where they
    // stand (all measured first, then all moved, so there is one layout) and
    // parked at the end, where they can't disturb sibling spacing. The empty
    // state leaves the same way when the first row arrives, except on the
    // very first render, where it just goes (it was only placeholder markup).
    var leaving = live.filter(function (c) { return !keep[c.__ttKey]; });
    if (empty && items.length && empty.parentNode === container && !empty.__ttLeaving) {
        if (first || !animate) empty.remove(); else leaving.push(empty);
    }
    var boxes = leaving.map(function (c) { return [c.offsetTop, c.offsetLeft, c.offsetWidth, c.offsetHeight]; });
    leaving.forEach(function (c, i) {
        if (!animate) { c.remove(); return; }
        c.__ttLeaving = true;
        c.getAnimations().forEach(function (a) { a.cancel(); });
        var b = boxes[i], s = c.style;
        s.position = 'absolute'; s.top = b[0] + 'px'; s.left = b[1] + 'px';
        s.width = b[2] + 'px'; s.height = b[3] + 'px'; s.margin = '0'; s.pointerEvents = 'none';
        container.appendChild(c);
    });

    // Put the kept and new rows in order, touching only nodes that are out of
    // place (moving a node would cancel any transition running inside it).
    var cur = live.filter(function (c) { return keep[c.__ttKey]; });
    var ghost = null;
    Array.prototype.some.call(container.children, function (c) { return c.__ttLeaving && (ghost = c); });
    nodes.forEach(function (n, i) {
        if (cur[i] === n) return;
        container.insertBefore(n, cur[i] || ghost);
        var j = cur.indexOf(n); if (j > -1) cur.splice(j, 1);
        cur.splice(i, 0, n);
    });
    var emptyIn = !!(empty && !items.length && (empty.parentNode !== container || empty.__ttLeaving));
    if (emptyIn) {
        if (empty.__ttLeaving) resetGhost(empty);
        container.insertBefore(empty, container.firstChild);
    }
    if (!animate) return added;

    if (first) {                                       // cascade in; nothing else moves
        var sf = p.rowFirst;
        if (sf) added.forEach(function (n, i) { run(n, sf, { delay: Math.min(i, 10) * (sf.gap || 0) }); });
        return added;
    }

    // LAST, measured with the list held at its old height so the layout
    // matches the first frame of the animation exactly; the height is then
    // released and animated separately.
    if (container.__ttH) { container.__ttH.cancel(); container.__ttH = null; }
    if (A && A.__ttShiftAnim) { A.__ttShiftAnim.cancel(); A.__ttShiftAnim = null; }
    var h1 = container.offsetHeight;
    container.style.height = h0 + 'px';
    if (A) A.style.translate = '0 ' + shift0 + 'px';
    var moving = nodes.filter(function (n) { return before.has(n); });
    moving.forEach(function (n) { if (n.__ttFlip) { n.__ttFlip.cancel(); n.__ttFlip = null; } });
    var shifts = moving.map(function (n) { var a = before.get(n), b = n.getBoundingClientRect(); return [a.left - b.left, a.top - b.top]; });
    container.style.height = '';

    // INVERT, PLAY. When something left and nothing arrived, the gap waits
    // for the leaving row to be (nearly) gone before it closes.
    var lag = leaving.length && !added.length ? p.lag : 0, mv = p.move;
    if (mv.d > 0) moving.forEach(function (n, i) {
        var dx = shifts[i][0], dy = shifts[i][1];
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        n.__ttFlip = n.animate([{ transform:'translate(' + dx + 'px,' + dy + 'px)' }, { transform:'translate(0,0)' }],
                               { duration: mv.d, easing: mv.e, delay: lag, fill:'backwards', composite:'add' });
    });
    if (Math.abs(h1 - h0) > 0.5 && mv.d > 0) {
        // Clip while it resizes: rows mid-slide would otherwise flash a
        // scrollbar for a few frames.
        if (container.__ttOv == null) container.__ttOv = container.style.overflowY;
        container.style.overflowY = 'hidden';
        var ha = container.__ttH = container.animate([{ height:h0 + 'px' }, { height:h1 + 'px' }],
                                                      { duration: mv.d, easing: mv.e, delay: lag, fill:'backwards' });
        var done = function () {
            if (container.__ttH !== ha && container.__ttH) return;       // superseded; the newer run restores it
            container.__ttH = null;
            container.style.overflowY = container.__ttOv; container.__ttOv = null;
        };
        ha.finished.then(done, done);
    }
    if (A && Math.abs(h1 - h0) > 0.5) {
        // Layout re-centres the panel by half the change; hold the top edge
        // still instead (never letting the bottom leave the screen).
        var r = A.getBoundingClientRect(), want = shift0 + (h1 - h0) / 2;
        var over = r.top + r.height + (h1 - h0) - (innerHeight - 12);
        if (over > 0) want -= over;
        A.style.translate = '0 ' + want + 'px';
        if (mv.d > 0) A.__ttShiftAnim = A.animate([{ translate:'0 ' + shift0 + 'px' }, { translate:'0 ' + want + 'px' }],
                                                  { duration: mv.d, easing: mv.e, delay: lag, fill:'backwards' });
    }
    var enter = moving.length && mv.d > 0 ? lag + Math.round(mv.d * timeTo(mv.e, 0.8)) : 0;
    added.forEach(function (n) { run(n, p.rowIn, { delay: enter }); });
    if (emptyIn) run(empty, p.reveal, { delay: 160 });
    var rows = leaving.filter(function (c) { return c !== empty; }), bulk = rows.length > 1;
    leaving.forEach(function (c) {
        var isEmpty = c === empty, i = rows.indexOf(c);
        var a = isEmpty ? c.animate([{ opacity:0 }], { duration:120, easing:'ease-out', fill:'forwards' })
                        : run(c, p.rowOut, { fill:'forwards', delay: bulk ? Math.min(i, 8) * 30 : 0 });
        c.__ttExit = a;
        var gone = function () {
            if (!c.__ttLeaving || c.__ttExit !== a) return;     // brought back meanwhile
            if (isEmpty) resetGhost(c);                  // the empty state is reused: clear it fully
            c.remove();
        };
        if (a) a.finished.then(gone, gone); else gone();
    });
    return added;
}
function resetGhost(c) {
    c.__ttLeaving = false;
    if (c.__ttExit) { c.__ttExit.cancel(); c.__ttExit = null; }
    c.getAnimations().forEach(function (a) { a.cancel(); });
    ['position','top','left','width','height','margin','pointerEvents'].forEach(function (p) { c.style[p] = ''; });
}
function resetAnchors() { anchors.forEach(function (A) { if (A.__ttShiftAnim) A.__ttShiftAnim.cancel(); A.__ttShiftAnim = null; A.style.translate = ''; }); }
function recentreAnchors() {
    anchors.forEach(function (A) {
        var y = parseFloat(String(getComputedStyle(A).translate).split(' ')[1]) || 0;
        if (A.__ttShiftAnim) { A.__ttShiftAnim.cancel(); A.__ttShiftAnim = null; }
        A.style.translate = '';
        if (Math.abs(y) > 0.5 && !reduceMotion)
            A.__ttShiftAnim = A.animate([{ translate:'0 ' + y + 'px' }, { translate:'0 0' }], { duration:420, easing:EASE.move });
    });
}
global.addEventListener('resize', resetAnchors);

/* Fade something into place (empty states, freshly edited text). */
function reveal(node, delay) { run(node, mo().reveal, { delay: delay || 0 }); }

/* Win95's window "explode": a hollow frame steps from one rectangle to
   another, then the window is simply there. */
function zoomRect(from, to, d) {
    var z = el('div', { class:'tt-zoomrect', 'aria-hidden':'true' });
    document.body.appendChild(z);
    var a = z.animate([from, to].map(function (r) { return { left:r.left + 'px', top:r.top + 'px', width:r.width + 'px', height:r.height + 'px' }; }),
                      { duration: d, easing: STEPS(6, 'jump-start'), fill:'forwards' });
    a.finished.then(function () { z.remove(); }, function () { z.remove(); });
    return a;
}
function shrink(r, f) { var w = r.width * f, h = r.height * f; return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h }; }

/* Modals: the scrim and the dialog each move the theme's way; closing is
   quicker, the overlay is hidden only once it has actually gone, and the
   returned promise resolves then — so a confirmed change can play out on a
   clear screen instead of underneath the closing dialog. Works on any
   `.hidden`-toggled overlay whose first child is the dialog box. */
function stopModal(m) {
    if (m.__ttModal) { var l = m.__ttModal; m.__ttModal = null; l.forEach(function (a) { a.cancel(); }); }
    m.style.pointerEvents = '';
}
function rectOf(from) { return from && from.getBoundingClientRect ? from.getBoundingClientRect() : null; }
function showModal(m, from) {
    if (!m) return;
    stopModal(m);
    m.classList.remove('hidden');
    m.__ttFrom = from || null;                         // closes back to where it came from
    if (reduceMotion) return;
    var p = mo(), box = m.firstElementChild, l = [], fr = rectOf(from);
    var s = run(m, p.scrimIn); if (s) l.push(s);
    if (box) {
        var r = box.getBoundingClientRect();
        // The dialog grows out of the control that opened it.
        box.style.transformOrigin = (p.origin && fr)
            ? (fr.left + fr.width / 2 - r.left) + 'px ' + (fr.top + fr.height / 2 - r.top) + 'px' : '';
        if (p.boxIn === 'zoom') {                      // Win95: the outline explodes out of the button
            l.push(box.animate([{ opacity:0 }, { opacity:0 }], { duration:170 }), zoomRect(fr || shrink(r, 0.08), r, 170));
        } else (p.boxIn || []).forEach(function (x) { var a = run(box, x); if (a) l.push(a); });
    }
    m.__ttModal = l;
}
function hideModal(m) {
    if (!m) return Promise.resolve();
    stopModal(m);
    if (reduceMotion || m.classList.contains('hidden')) { m.classList.add('hidden'); return Promise.resolve(); }
    var p = mo(), box = m.firstElementChild, l = [], to = rectOf(m.__ttFrom);
    var s = run(m, p.scrimOut, { fill:'forwards' }); if (s) l.push(s);
    if (box) {
        if (p.boxOut === 'zoom') {
            var r = box.getBoundingClientRect();
            l.push(box.animate([{ opacity:0 }, { opacity:0 }], { duration:130, fill:'forwards' }), zoomRect(r, to || shrink(r, 0.08), 130));
        } else (p.boxOut || []).forEach(function (x) { var a = run(box, x, { fill:'forwards' }); if (a) l.push(a); });
    }
    if (!l.length) { m.classList.add('hidden'); return Promise.resolve(); }
    m.__ttModal = l;
    m.style.pointerEvents = 'none';                    // a second click can't restart it
    return Promise.all(l.map(function (a) { return a.finished; })).then(function () {
        if (m.__ttModal === l) { m.classList.add('hidden'); stopModal(m); }
    }, function () {});
}

/* Page arrival: the panel comes in once, on first load, the theme's way.
   It animates the independent `translate` property (never `transform`, so
   it can't fight the tilt) and opacity on the panel itself (on a wrapper it
   would cut the panel's frosted blur off from the background until the
   fade ended). Skipped when the page arrived through a cross-document view
   transition, which has already animated it in. */
var arrival = null, revealedByVT = false;
global.addEventListener('pagereveal', function (e) {
    if (!e.viewTransition) return;
    revealedByVT = true;
    if (arrival) arrival.finish();
});
function arrive(node) {
    if (reduceMotion || revealedByVT || !node) return;
    var a = mo().arrive;
    if (a === 'zoom') {                                // from the taskbar button, like opening a window
        var r = node.getBoundingClientRect();
        arrival = node.animate([{ opacity:0 }, { opacity:0 }], { duration:220 });
        zoomRect({ left:4, top: innerHeight - 30, width:150, height:24 }, r, 220);
        return;
    }
    arrival = run(node, a, { fill:'none' });
}

/* Staggered entry for a freshly rendered list (older API; list() above
   replaces it in both apps). */
function stagger(nodes) {
    Array.prototype.forEach.call(nodes, function (n, i) {
        n.style.setProperty('--i', Math.min(i, 12));
        n.classList.add('tt-stagger');
    });
}

/* A small settle for anything that still asks for emphasis. It used to be a
   1.22x spring; now it is a short, restrained ease back from 1.06x. */
function pop(node) {
    if (!node || reduceMotion) return;
    node.classList.remove('tt-pop'); void node.offsetWidth; node.classList.add('tt-pop');
}

/* Switches get the theme's own "it's done" gesture (a wax seal pressed
   down, a phosphor flicker, a gooey squish) when the user flips them. */
document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.matches || !t.matches('.toggle-switch input')) return;
    var s = t.checked ? mo().toggleOn : mo().toggleOff;
    if (s) run(t.nextElementSibling, s, { fill:'none' });
});


/* ═══════════ PER-THEME ICONS ════════════════════════════════════════════
   Same meaning, the glyph each world would draw: a castle for home and a
   quill for writing in the manuscript, a terminal prompt in cyberpunk, a
   newspaper in the newsroom. Pages keep writing the original ligature
   names; the observer swaps them, remembers the original in data-icon, and
   adopts any glyph a page changes itself (the mute button). Weight, fill
   and effects per theme live in theme.css. */
var ICONS = {
    medieval:  { home:'castle', palette:'auto_fix_high', delete:'local_fire_department', add_call:'history_edu', edit:'history_edu',
                 edit_note:'ink_pen', restart_alt:'hourglass_empty', history:'hourglass_bottom', add_circle:'history_edu',
                 phone_in_talk:'history_edu', warning:'swords', add:'add', remove:'remove', notifications:'notifications_active' },
    cyberpunk: { home:'terminal', palette:'memory', delete:'close', restart_alt:'power_settings_new', notifications:'sensors',
                 history:'schedule', add_call:'add', add_circle:'add_box', edit_note:'chevron_right', edit:'code',
                 phone_in_talk:'terminal', warning:'error' },
    pixelart:  { palette:'sports_esports', history:'hourglass_bottom', restart_alt:'replay', add_circle:'add_box',
                 phone_in_talk:'sports_esports', edit_note:'chevron_right', delete:'close', add_call:'add' },
    retro:     { home:'desktop_windows', palette:'display_settings', history:'schedule', delete:'close',
                 add_circle:'note_add', phone_in_talk:'call', restart_alt:'refresh' },
    newsroom:  { home:'newspaper', palette:'live_tv', history:'schedule', notifications:'campaign', phone_in_talk:'podcasts',
                 add_circle:'add', add_call:'add_call' },
    blueprint: { palette:'architecture', home:'grid_on', history:'schedule', edit_note:'straighten', add_circle:'add',
                 phone_in_talk:'architecture', restart_alt:'layers_clear' },
    brutalist: { add_circle:'add', delete:'close', restart_alt:'refresh', history:'schedule', edit_note:'arrow_forward' },
    goop:      { palette:'bubble_chart', phone_in_talk:'bubble_chart' }
};
var iconMap = {};
function iconize(n) {
    var cur = n.textContent.trim(), orig = n.getAttribute('data-icon');
    if (orig == null || (cur !== orig && cur !== n.__ttShown)) { orig = cur; n.setAttribute('data-icon', orig); }
    var want = iconMap[orig] || orig;
    n.__ttShown = want;
    if (cur !== want) n.textContent = want;
}
function applyIcons(root) {
    if (root.classList && root.classList.contains('material-symbols-outlined')) iconize(root);
    if (root.querySelectorAll) root.querySelectorAll('.material-symbols-outlined').forEach(iconize);
}
function isIcon(n) { return n && n.classList && n.classList.contains('material-symbols-outlined'); }
function watchIcons() {
    new MutationObserver(function (list) {
        list.forEach(function (m) {
            if (m.type === 'characterData') { if (isIcon(m.target.parentNode)) iconize(m.target.parentNode); return; }
            if (isIcon(m.target)) { iconize(m.target); return; }
            m.addedNodes.forEach(function (n) { if (n.nodeType === 1) applyIcons(n); });
        });
    }).observe(document.body, { childList:true, subtree:true, characterData:true });
}

/* Accent ripple on any button that opts in via .tt-btn / .accent-bg. */
function wireRipples() {
    document.addEventListener('pointerdown', function (e) {
        if (reduceMotion || !mo().ripple) return;     // stepped / hard-edged themes don't ripple
        var b = e.target.closest('.tt-btn, .accent-bg');
        if (!b) return;
        var r = b.getBoundingClientRect(), size = Math.max(r.width, r.height);
        var s = el('span', { class:'tt-ripple' });
        s.style.width = s.style.height = size + 'px';
        s.style.left = (e.clientX - r.left - size / 2) + 'px';
        s.style.top  = (e.clientY - r.top  - size / 2) + 'px';
        if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
        b.appendChild(s);
        setTimeout(function () { s.remove(); }, 600);
    });
}


/* ═══════════ INIT ═══════════════════════════════════════════════════════ */
function init(options) {
    cfg = options || {};
    load();
    buildLayers();
    buildUI();
    wireRipples();
    watchIcons();
    commit();
    arrive($('trackerPanel'));

    var rt = null;
    global.addEventListener('resize', function () {
        clearTimeout(rt);
        rt = setTimeout(function () { matrix.resize(); goop.resize(); pixel.resize(); }, 150);
    });
}

global.SMTTheme = {
    init: init,
    tilt: tilt,
    countUp: countUp,
    roll: roll,
    renderMeter: renderMeter,
    list: list,
    reveal: reveal,
    showModal: showModal,
    hideModal: hideModal,
    tween: tween,
    EASE: EASE,
    stagger: stagger,
    pop: pop,
    motion: mo,
    setStyle: setStyle, setColor: setColor, setMode: setMode,
    openPicker: function () { panelToggle(true); },
    get style() { return state.style; },
    get mode()  { return state.mode; },
    get color() { return state.color; },
    reduceMotion: reduceMotion,
    THEMES: THEMES,
    COLORS: COLORS
};

})(window);
