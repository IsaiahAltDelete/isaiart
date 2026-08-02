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
    document.body.appendChild(el('div', { id:'blueprintTitleBlock', 'aria-hidden':'true', html:
        '<div class="bp-row"><span class="bp-k">Title</span><span class="bp-v">' + (cfg.title || '') + '</span></div>' +
        '<div class="bp-row"><span class="bp-k">Drawn</span><span class="bp-v">isaiart</span></div>' +
        '<div class="bp-row"><span class="bp-k">Scale</span><span class="bp-v">1:1</span></div>' +
        '<div class="bp-row"><span class="bp-k">Rev</span><span class="bp-v">C</span></div>' }));
}


/* ── Matrix rain (cyberpunk) ─────────────────────────────────────────── */
var matrix = (function () {
    var cv, ctx, id = null, drops = [], CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*!?+-=><アイウエオカキクケコサシスセソ';
    function size() {
        cv.width = innerWidth; cv.height = innerHeight;
        drops = Array.from({ length: Math.floor(cv.width / 14) }, function () { return Math.random() * -cv.height; });
    }
    function tick() {
        var accent = getComputedStyle(html).getPropertyValue('--accent').trim() || '#33FF66';
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.font = '14px "Share Tech Mono",monospace';
        for (var i = 0; i < drops.length; i++) {
            ctx.fillStyle = Math.random() > 0.94 ? '#ffffff' : accent;
            ctx.fillText(CH[(Math.random() * CH.length) | 0], i * 14, drops[i]);
            if (drops[i] > cv.height && Math.random() > 0.975) drops[i] = 0;
            drops[i] += 14;
        }
        id = raf(tick);
    }
    return {
        start: function () {
            if (id) return;
            cv = $('matrixCanvas'); ctx = cv.getContext('2d'); size();
            tick();
            if (reduceMotion) { cancelAnimationFrame(id); id = -1; }   // one static frame
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


/* ── Pixel-art parallax scene ─────────────────────────────────────────────
   Rendered into a genuinely low-resolution canvas (≈1/6 scale) then
   upscaled with image-rendering:pixelated, so every pixel is a real, hard
   pixel. Repaints at 12fps on purpose — that chunky cadence is half of
   what makes it read as a sprite game rather than a webpage. */
var pixel = (function () {
    var cv, ctx, id = null, t = 0, timer = null, SCALE = 6, W = 0, H = 0, stars = [];
    function size() {
        cv = $('pixelCanvas'); ctx = cv.getContext('2d');
        W = Math.max(80, Math.ceil(innerWidth / SCALE));
        H = Math.max(60, Math.ceil(innerHeight / SCALE));
        cv.width = W; cv.height = H;
        ctx.imageSmoothingEnabled = false;
        stars = [];
        for (var i = 0; i < Math.floor(W * H / 900); i++) {
            stars.push({ x: Math.random() * W, y: Math.random() * H * 0.6, s: Math.random() < 0.25 ? 2 : 1, p: Math.random() * 60 | 0 });
        }
    }
    function css(v, fb) { return (getComputedStyle(html).getPropertyValue(v).trim() || fb); }
    function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
    function draw() {
        var dark = state.mode === 'dark';
        var accent = css('--accent', '#FFA300');
        var sky1 = dark ? '#12132A' : '#BFE3F0';
        var sky2 = dark ? '#2D2B55' : '#E8F0E8';
        var far  = dark ? '#1A1C2C' : '#8FB68C';
        var mid  = dark ? '#232649' : '#6E9C6C';
        var gnd  = dark ? '#151626' : '#4F7A50';

        // Banded sky (hard bands, no gradient — gradients aren't pixel art)
        var bands = 7, bh = Math.ceil(H * 0.62 / bands);
        for (var i = 0; i < bands; i++) {
            rect(0, i * bh, W, bh, mix(sky1, sky2, i / (bands - 1)));
        }
        // Bayer dithering along each band seam
        for (var i = 1; i < bands; i++) {
            var y = i * bh;
            for (var x = 0; x < W; x += 2) if (((x >> 1) + i) % 2 === 0) rect(x, y - 1, 1, 1, mix(sky1, sky2, (i - 1) / (bands - 1)));
        }

        if (dark) {
            stars.forEach(function (s) {
                if (((t + s.p) % 60) < 46) rect(s.x, s.y, s.s, s.s, s.s > 1 ? accent : '#FFF1E8');
            });
        } else {
            // drifting clouds
            for (var c = 0; c < 4; c++) {
                var cx = ((t * (0.35 + c * 0.12) + c * W / 3) % (W + 40)) - 20;
                var cy = 8 + c * 9;
                rect(cx, cy, 16, 4, '#FFFFFF'); rect(cx + 4, cy - 3, 9, 3, '#FFFFFF'); rect(cx + 2, cy + 4, 12, 2, '#E3EEF3');
            }
        }

        // Far ridge — deterministic sine so it never shimmers
        var horizon = Math.floor(H * 0.62);
        for (var x = 0; x < W; x++) {
            var h1 = Math.floor(Math.sin(x * 0.045) * 6 + Math.sin(x * 0.017) * 10 + 14);
            rect(x, horizon - h1, 1, h1, far);
        }
        for (var x = 0; x < W; x++) {
            var h2 = Math.floor(Math.sin(x * 0.08 + 2) * 4 + Math.sin(x * 0.03) * 7 + 9);
            rect(x, horizon - h2 + 6, 1, h2, mid);
        }
        rect(0, horizon, W, H - horizon, gnd);

        // Scrolling ground tiles
        var off = Math.floor(t * 0.6) % 8;
        for (var x = -8; x < W + 8; x += 8) {
            rect(x - off, horizon, 4, 1, mix(gnd, accent, 0.22));
            rect(x - off + 4, horizon + 3, 3, 1, mix(gnd, '#000000', 0.25));
        }
        for (var y = horizon + 7; y < H; y += 6) {
            for (var x = ((y / 6) | 0) % 2 ? 0 : 3; x < W; x += 6) rect(x, y, 1, 1, mix(gnd, '#000000', 0.3));
        }
        // Accent sun/moon
        var sx = Math.floor(W * 0.78), sy = Math.floor(H * 0.16);
        rect(sx - 5, sy - 3, 11, 7, accent); rect(sx - 3, sy - 5, 7, 11, accent);
        rect(sx - 4, sy - 4, 9, 9, accent);
        t++;
    }
    function mix(a, b, f) {
        function p(h) { h = h.replace('#',''); if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; return [parseInt(h.substr(0,2),16), parseInt(h.substr(2,2),16), parseInt(h.substr(4,2),16)]; }
        try {
            var A = p(a), B = p(b);
            var r = Math.round(A[0] + (B[0]-A[0])*f), g = Math.round(A[1] + (B[1]-A[1])*f), bl = Math.round(A[2] + (B[2]-A[2])*f);
            // quantise to a 5-bit-ish ramp so the palette stays limited
            r = Math.round(r/8)*8; g = Math.round(g/8)*8; bl = Math.round(bl/8)*8;
            return 'rgb(' + r + ',' + g + ',' + bl + ')';
        } catch (e) { return a; }
    }
    return {
        start: function () {
            if (timer) return;
            size(); draw();
            if (!reduceMotion) timer = setInterval(draw, 1000 / 12);   // 12fps on purpose
        },
        stop: function () { if (timer) clearInterval(timer); timer = null; },
        resize: function () { if (timer || reduceMotion) { size(); draw(); } }
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
    syncPanelUI();
    save();
    if (cfg.onChange) cfg.onChange(Object.assign({}, state));
}

/* Cross-fade the whole document when the theme changes, where supported. */
function transition(fn) {
    if (!reduceMotion && document.startViewTransition) { document.startViewTransition(fn); }
    else fn();
}

function setStyle(s) { if (VALID_STYLES.indexOf(s) < 0) return; state.style = s; transition(commit); }
function setColor(c) { if (VALID_COLORS.indexOf(c) < 0) return; state.color = c; transition(commit); }
function setMode(m)  { state.mode = (m === 'light' ? 'light' : 'dark'); transition(commit); }


/* ═══════════ PICKER UI ══════════════════════════════════════════════════ */
function panelToggle(open) {
    var p = $('themePanel'); if (!p) return;
    var next = (open === undefined) ? !p.classList.contains('visible') : open;
    p.classList.toggle('visible', next);
    if (next) p.querySelectorAll('.style-btn').forEach(function (b, i) {
        b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
        b.style.setProperty('--i', i);
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
        onclick: function () { setMode('dark'); } }));
    pill.appendChild(el('button', { class:'mode-pill-btn', id:'ttModeLight', type:'button',
        html:'<span class="material-symbols-outlined">light_mode</span><span>Light</span>',
        onclick: function () { setMode('light'); } }));
    panel.appendChild(pill);

    panel.appendChild(el('span', { class:'tp-label', text:'UI Style' }));
    var grid = el('div', { class:'style-grid', id:'ttStyleGrid' });
    THEMES.forEach(function (t, i) {
        var b = el('button', { class:'style-btn', type:'button', 'data-style':t.id, style:'--i:' + i,
            onclick: function () { setStyle(t.id); } });
        b.appendChild(el('div', { class:'style-preview', html:t.preview }));
        b.appendChild(el('span', { text:t.name }));
        grid.appendChild(b);
    });
    panel.appendChild(grid);

    panel.appendChild(el('span', { class:'tp-label', text:'Color' }));
    var row = el('div', { class:'color-row' });
    COLORS.forEach(function (c) {
        row.appendChild(el('button', { class:'color-dot', type:'button', 'data-color':c.id, title:c.title,
            'aria-label':c.title, style:'background:' + c.swatch, onclick: function () { setColor(c.id); } }));
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
    var dragging = false, px = 0, py = 0, tx = 0, ty = 0, cx = 0, cy = 0, loop = null;

    var settleTimer = null, settleDone = null;

    // While dragging, lerp toward the pointer so the motion is smooth rather
    // than a raw jump per mousemove.
    function frame() {
        cx += (tx - cx) * 0.28; cy += (ty - cy) * 0.28;
        panel.style.transform = 'rotateX(' + cy.toFixed(2) + 'deg) rotateY(' + cx.toFixed(2) + 'deg)';
        loop = dragging ? raf(frame) : null;
    }

    // Let go and it springs back on a fixed-duration CSS transition. A
    // proportional lerp decelerates forever near the end, so a two-turn spin
    // would crawl home; this returns just as snappily from 700deg as from 7.
    function settle() {
        cancelSettle();
        panel.style.transition = 'transform 720ms cubic-bezier(0.22,1,0.36,1)';
        panel.style.transform = 'rotateX(0deg) rotateY(0deg)';
        tx = ty = cx = cy = 0;
        settleDone = function () {
            cancelSettle();
            // Drop the transform AND preserve-3d so the panel is rasterised at
            // native resolution again — this is what keeps the text crisp.
            panel.style.transition = '';
            panel.style.transform = '';
            panel.classList.remove('tt-tilting');
        };
        panel.addEventListener('transitionend', settleDone, { once: true });
        settleTimer = setTimeout(settleDone, 820);   // if transitionend never fires
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
        panel.classList.add('tt-tilting');
        panel.style.transition = 'none';
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

/* Rolls a number instead of snapping it.
   Each run stamps a token on the node and bails the moment a newer run takes
   over. Without this, two overlapping rolls on the same element race and
   whichever finishes last wins — so a quick add-then-toggle could leave the
   old figure on screen while the meter beside it showed the new one. */
function countUp(node, to, opts) {
    opts = opts || {};
    var token = (node.__ttCount = (node.__ttCount || 0) + 1);
    var from = parseFloat(String(node.textContent).replace(/[^0-9.\-]/g, '')) || 0;
    var dec = opts.decimals || 0, suffix = opts.suffix || '';
    if (reduceMotion || from === to) { node.textContent = to.toFixed(dec) + suffix; return; }
    var dur = opts.duration || 480, t0 = performance.now();
    (function step(now) {
        if (node.__ttCount !== token) return;          // superseded
        var p = Math.min(1, (now - t0) / dur);
        var e = 1 - Math.pow(1 - p, 3);
        node.textContent = (from + (to - from) * e).toFixed(dec) + suffix;
        if (p < 1) raf(step); else node.textContent = to.toFixed(dec) + suffix;
    })(t0);
}

/* One meter, rendered in whatever form the active theme calls for. */
function renderMeter(node, pct, opts) {
    if (!node) return;
    opts = opts || {};
    var p = Math.max(0, Math.min(100, pct || 0));
    node.className = (opts.baseClass || 'tt-meter');
    node.innerHTML = '';
    if (['pixelart','cyberpunk','retro','brutalist','blueprint'].indexOf(state.style) > -1) {
        node.classList.add('seg-meter');
        var N = opts.segments || 10, filled = Math.round(p / (100 / N));
        for (var i = 0; i < N; i++) {
            var s = el('span', { class:'seg' + (i < filled ? ' on' : ''), style:'--i:' + i });
            node.appendChild(s);
        }
    } else if (state.style === 'medieval') {
        node.classList.add('heart-meter');
        var H = opts.hearts || 5, full = Math.round(p / (100 / H));
        for (var j = 0; j < H; j++) node.appendChild(el('span', { class:'heart' + (j < full ? ' on' : ''), style:'--i:' + j, text:'♥' }));
    } else {
        var f = el('div', { class:'meter-fill', style:'width:0%' });
        node.appendChild(f);
        void f.offsetWidth;
        f.style.width = p + '%';
    }
}

/* Staggered entry for a freshly rendered list. */
function stagger(nodes) {
    Array.prototype.forEach.call(nodes, function (n, i) {
        n.style.setProperty('--i', Math.min(i, 12));
        n.classList.add('tt-stagger');
    });
}

function pop(node) {
    if (!node || reduceMotion) return;
    node.classList.remove('tt-pop'); void node.offsetWidth; node.classList.add('tt-pop');
}

/* Accent ripple on any button that opts in via .tt-btn / .accent-bg. */
function wireRipples() {
    document.addEventListener('pointerdown', function (e) {
        if (reduceMotion) return;
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
    commit();

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
    renderMeter: renderMeter,
    stagger: stagger,
    pop: pop,
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
