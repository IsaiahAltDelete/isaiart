/* ============================================================================
   DRUMPAD — engine
   ---------------------------------------------------------------------------
   Sixteen steps, twelve tracks. Every sound is synthesised on the spot from
   oscillators and filtered noise, so the same voice() runs live and inside
   an OfflineAudioContext for the WAV export. Scheduling is the usual
   look-ahead pattern: a timer books notes a tenth of a second early, and a
   frame loop paints the playhead when the booked time arrives, so what you
   see lines up with what you hear.

   The pattern, tempo and swing are kept in localStorage and can be folded
   into the URL (#p=…) for sharing.
   ========================================================================= */
(function () {
    'use strict';

    var doc = document, html = doc.documentElement;
    var reduced = matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var STEPS = 16;
    var KEY = { theme: 'isaiart.drumpad.theme', state: 'isaiart.drumpad.state' };
    function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

    /* ── Instruments ────────────────────────────────────────────────────── */

    var GLYPH = {
        kick:  '<svg class="ico g g-kick" viewBox="0 0 24 24" aria-hidden="true"><circle class="body" cx="12" cy="12" r="7.5"/><circle class="f" cx="12" cy="12" r="1.8"/></svg>',
        snare: '<svg class="ico g g-snare" viewBox="0 0 24 24" aria-hidden="true"><g class="body"><rect x="4" y="8" width="16" height="7"/><path d="M4 11.5h16"/></g><path d="M6 18.5h12M8 15v3.5M16 15v3.5"/></svg>',
        clap:  '<svg class="ico g g-clap" viewBox="0 0 24 24" aria-hidden="true"><rect class="l" x="5.5" y="6" width="4.5" height="12" rx="2"/><rect class="r" x="14" y="6" width="4.5" height="12" rx="2"/><path d="M12 3.5v2M12 18.5v2"/></svg>',
        hat:   '<svg class="ico g g-hat" viewBox="0 0 24 24" aria-hidden="true"><path class="top" d="M4 10.5h16l-8-3z"/><path d="M4 13h16l-8 3z"/><path d="M12 16v4.5"/></svg>',
        hato:  '<svg class="ico g g-hato" viewBox="0 0 24 24" aria-hidden="true"><path class="top" d="M4 8.5h16l-8-3z"/><path d="M4 14h16l-8 3z"/><path d="M12 17v3.5"/></svg>',
        tom:   '<svg class="ico g g-tom" viewBox="0 0 24 24" aria-hidden="true"><circle class="body" cx="12" cy="11" r="6.5"/><path d="M7 17.5l-2 3M17 17.5l2 3"/></svg>',
        tomh:  '<svg class="ico g g-tom" viewBox="0 0 24 24" aria-hidden="true"><circle class="body" cx="12" cy="11.5" r="5"/><path d="M8 16.5l-2 4M16 16.5l2 4"/></svg>',
        rim:   '<svg class="ico g g-rim" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="6"/><path class="stick" d="M15 10l5-5"/></svg>',
        key:   '<svg class="ico g g-key" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14"/><path d="M9.3 5v14M14.6 5v14"/><rect class="k f" x="9.3" y="5" width="5.3" height="8"/></svg>'
    };

    var INST = [
        { id: 'kick',  name: 'Kick',     sub: '1', glyph: 'kick',  type: 'drum', param: 1 },
        { id: 'snare', name: 'Snare',    sub: '2', glyph: 'snare', type: 'drum', param: 1 },
        { id: 'clap',  name: 'Clap',     sub: '3', glyph: 'clap',  type: 'drum', param: 1 },
        { id: 'hat',   name: 'Hat',      sub: '4 · closed', glyph: 'hat',  type: 'drum', param: 1 },
        { id: 'hato',  name: 'Open hat', sub: '5', glyph: 'hato',  type: 'drum', param: 1 },
        { id: 'tom',   name: 'Low tom',  sub: '6', glyph: 'tom',   type: 'drum', param: 1 },
        { id: 'tomh',  name: 'High tom', sub: '7', glyph: 'tomh',  type: 'drum', param: 1 },
        { id: 'rim',   name: 'Rim',      sub: '8', glyph: 'rim',   type: 'drum', param: 1 },
        { id: 'c',     name: 'C',        sub: 'Q', glyph: 'key',   type: 'key',  param: 0.6, freq: 261.63 },
        { id: 'e',     name: 'E',        sub: 'W', glyph: 'key',   type: 'key',  param: 0.6, freq: 329.63 },
        { id: 'g',     name: 'G',        sub: 'E', glyph: 'key',   type: 'key',  param: 0.6, freq: 392.00 },
        { id: 'a',     name: 'A',        sub: 'R', glyph: 'key',   type: 'key',  param: 0.6, freq: 440.00 }
    ];
    var N = INST.length;
    var KEYMAP = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, KeyQ: 8, KeyW: 9, KeyE: 10, KeyR: 11 };

    /* ── State ──────────────────────────────────────────────────────────── */

    /* grid[t][s]: 0 off, 1 on, 2 accent */
    var grid = [], vol = [], param = [], mute = [], solo = [];
    for (var t = 0; t < N; t++) {
        grid.push(new Array(STEPS).fill(0));
        vol.push(0.85); param.push(INST[t].param); mute.push(false); solo.push(false);
    }
    var bpm = 112, swing = 0, master = 0.8, muted = false;
    var playing = false, rec = false;
    var step = 0, nextTime = 0, timer = null, queue = [], lastStep = -1, lastStepTime = 0;
    var LOOKAHEAD = 25, AHEAD = 0.1;

    var ctx = null, bus = null, comp = null, analyser = null, vuBuf = null;

    /* ── Audio graph ────────────────────────────────────────────────────── */

    function ensureAudio() {
        if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
        var AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC({ latencyHint: 'interactive' });
        var g = buildBus(ctx);
        bus = g.bus; comp = g.comp;
        analyser = ctx.createAnalyser(); analyser.fftSize = 512;
        comp.connect(analyser);
        vuBuf = new Float32Array(analyser.fftSize);
        bus.gain.value = muted ? 0 : master;
    }

    /* Master: gain → gentle compressor → out. The compressor is what lets
       twelve voices land on one step without the kick disappearing. */
    function buildBus(c) {
        var g = c.createGain();
        var k = c.createDynamicsCompressor();
        k.threshold.value = -12; k.knee.value = 8; k.ratio.value = 3;
        k.attack.value = 0.004; k.release.value = 0.14;
        g.connect(k); k.connect(c.destination);
        return { bus: g, comp: k };
    }

    function noise(c) {
        if (c._noise) return c._noise;
        var len = Math.floor(c.sampleRate * 1.5), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        c._noise = b; return b;
    }
    function shaper(c) {
        if (c._shaper) return c._shaper;
        var n = 1024, curve = new Float32Array(n);
        for (var i = 0; i < n; i++) { var x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
        var s = c.createWaveShaper(); s.curve = curve; s.oversample = '2x';
        c._shaper = s; return s;
    }

    /* Helpers that build one short voice. */
    function env(c, t, peak, decay, dest, attack) {
        var g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + (attack || 0.002));
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        g.connect(dest);
        return g;
    }
    function osc(c, type, f, t, stop) {
        var o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
        o.start(t); o.stop(t + stop); return o;
    }
    function hiss(c, t, stop) {
        var s = c.createBufferSource(); s.buffer = noise(c);
        s.loop = true; s.loopStart = 0; s.loopEnd = s.buffer.duration;
        s.start(t, Math.random() * 0.9); s.stop(t + stop); return s;
    }
    function filt(c, type, f, q) {
        var b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 1; return b;
    }

    /* voice(track, when, context, destination, velocity) */
    function voice(i, t, c, dest, vel) {
        var ins = INST[i], p = param[i], v = vol[i] * (vel || 0.8);
        var out = c.createGain(); out.gain.value = v; out.connect(dest);
        var o, n, f, g;

        switch (ins.id) {
        case 'kick': {
            /* Sine that falls from 170 to 48 Hz in 90 ms, through a soft
               clipper for weight, with a filtered click on the front. */
            var sh = c.createWaveShaper(); sh.curve = shaper(c).curve; sh.oversample = '2x'; sh.connect(out);
            o = osc(c, 'sine', 170 * p, t, 0.55);
            o.frequency.exponentialRampToValueAtTime(48 * p, t + 0.09);
            o.connect(env(c, t, 1.0, 0.5, sh, 0.001));
            n = hiss(c, t, 0.03); f = filt(c, 'bandpass', 3200, 0.8);
            n.connect(f); f.connect(env(c, t, 0.5, 0.025, out));
            break;
        }
        case 'snare': {
            /* Two short tones for the shell, a bright noise burst for the
               wires, a tiny sine knock for the stick. */
            o = osc(c, 'triangle', 186 * p, t, 0.2);
            o.frequency.exponentialRampToValueAtTime(120 * p, t + 0.08);
            o.connect(env(c, t, 0.55, 0.17, out));
            o = osc(c, 'sine', 330 * p, t, 0.12);
            o.connect(env(c, t, 0.35, 0.09, out));
            n = hiss(c, t, 0.26); f = filt(c, 'highpass', 1400 * Math.sqrt(p), 0.7);
            var f2 = filt(c, 'peaking', 4500, 1); f2.gain.value = 5;
            n.connect(f); f.connect(f2); f2.connect(env(c, t, 0.9, 0.22, out, 0.001));
            break;
        }
        case 'clap': {
            /* Four noise bursts ten milliseconds apart, then a tail that
               rings in a band around 1.1 kHz — hands, then the room. */
            n = hiss(c, t, 0.34); f = filt(c, 'bandpass', 1100 * p, 1.4); n.connect(f);
            g = c.createGain(); g.connect(out); f.connect(g);
            g.gain.setValueAtTime(0.0001, t);
            for (var k = 0; k < 4; k++) {
                var tk = t + k * 0.011;
                g.gain.linearRampToValueAtTime(0.95, tk + 0.001);
                if (k < 3) g.gain.exponentialRampToValueAtTime(0.15, tk + 0.010);
            }
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.033 + 0.26);
            n = hiss(c, t + 0.02, 0.4); f = filt(c, 'lowpass', 3800, 0.5);
            n.connect(f); f.connect(env(c, t + 0.02, 0.22, 0.36, out, 0.01));
            break;
        }
        case 'hat':
        case 'hato': {
            /* The 808 recipe: six square waves at inharmonic ratios through
               a band around 10 kHz, so what is left is metal, not tone. */
            var open = ins.id === 'hato', dur = open ? 0.5 : 0.07;
            var fr = [205.3, 304.4, 369.6, 522.7, 540, 800];
            f = filt(c, 'bandpass', 10000, 0.9); var hp = filt(c, 'highpass', 7200, 0.7);
            f.connect(hp); hp.connect(env(c, t, open ? 0.6 : 0.8, dur, out, 0.001));
            for (var h = 0; h < fr.length; h++) {
                o = osc(c, 'square', fr[h] * p, t, dur + 0.02);
                var og = c.createGain(); og.gain.value = 0.16; o.connect(og); og.connect(f);
            }
            if (open) { n = hiss(c, t, 0.5); var nf = filt(c, 'highpass', 9000, 0.5); n.connect(nf); nf.connect(env(c, t, 0.25, 0.45, out, 0.002)); }
            break;
        }
        case 'tom':
        case 'tomh': {
            var base = ins.id === 'tom' ? 96 : 168, dec = ins.id === 'tom' ? 0.42 : 0.3;
            o = osc(c, 'sine', base * p, t, dec + 0.05);
            o.frequency.exponentialRampToValueAtTime(base * 0.55 * p, t + dec * 0.6);
            o.connect(env(c, t, 0.9, dec, out, 0.001));
            o = osc(c, 'triangle', base * 1.5 * p, t, 0.1);
            o.connect(env(c, t, 0.2, 0.08, out));
            n = hiss(c, t, 0.03); f = filt(c, 'bandpass', 2400, 1); n.connect(f); f.connect(env(c, t, 0.3, 0.02, out));
            break;
        }
        case 'rim': {
            /* Rimshot: a bright click and a short ring at 440. */
            o = osc(c, 'triangle', 1720 * p, t, 0.05); o.connect(env(c, t, 0.5, 0.035, out));
            o = osc(c, 'sine', 440 * p, t, 0.07); o.connect(env(c, t, 0.4, 0.06, out));
            n = hiss(c, t, 0.03); f = filt(c, 'highpass', 4000, 0.7); n.connect(f); f.connect(env(c, t, 0.45, 0.022, out));
            break;
        }
        default: {
            /* Keys: an electric-piano tine. A sine carrier with a fast FM
               bite at the start, a faint octave, and a lowpass that closes
               as the note dies. The track's slider is the decay. */
            var fq = ins.freq, d = p;
            var lp = filt(c, 'lowpass', 2600, 0.6); lp.connect(out);
            lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(900, t + d);
            var car = osc(c, 'sine', fq, t, d + 0.1);
            var mod = osc(c, 'sine', fq * 14, t, 0.12);
            var mg = c.createGain(); mg.gain.setValueAtTime(fq * 1.6, t); mg.gain.exponentialRampToValueAtTime(1, t + 0.09);
            mod.connect(mg); mg.connect(car.frequency);
            car.connect(env(c, t, 0.75, d, lp, 0.003));
            o = osc(c, 'triangle', fq * 2, t, d + 0.1); o.connect(env(c, t, 0.08, d * 0.7, lp, 0.003));
            o = osc(c, 'sine', fq * 0.5, t, d + 0.1); o.connect(env(c, t, 0.18, d, lp, 0.003));
        }
        }
    }

    function audible(i) {
        var anySolo = solo.some(Boolean);
        return anySolo ? solo[i] : !mute[i];
    }

    /* ── Sequencer ──────────────────────────────────────────────────────── */

    function stepDur() { return 15 / bpm; }
    function swingFor(s) { return (s % 2) ? swing / 100 * stepDur() / 3 : 0; }

    function scheduler() {
        while (nextTime < ctx.currentTime + AHEAD) {
            var when = nextTime + swingFor(step);
            for (var i = 0; i < N; i++) {
                var v = grid[i][step];
                if (v && audible(i)) voice(i, when, ctx, bus, v === 2 ? 1 : 0.7);
            }
            queue.push({ step: step, time: when });
            nextTime += stepDur();
            step = (step + 1) % STEPS;
        }
        timer = setTimeout(scheduler, LOOKAHEAD);
    }

    function paint() {
        if (!playing) return;
        var now = ctx.currentTime, s = -1;
        while (queue.length && queue[0].time <= now + 0.004) { var q = queue.shift(); s = q.step; lastStepTime = q.time; }
        if (s >= 0 && s !== lastStep) { drawStep(s); lastStep = s; }
        vu();
        requestAnimationFrame(paint);
    }

    var cells = [], nums = [], pads = [], tracksEl = [];
    function drawStep(s) {
        var prev = (s + STEPS - 1) % STEPS;
        nums[prev].classList.remove('now'); nums[s].classList.add('now');
        for (var i = 0; i < N; i++) {
            cells[i][prev].classList.remove('now');
            var el = cells[i][s]; el.classList.add('now');
            if (grid[i][s] && audible(i)) { flash(el); hit(i); }
        }
    }
    function clearPlayhead() {
        doc.querySelectorAll('.now').forEach(function (n) { n.classList.remove('now'); });
        lastStep = -1;
    }
    function flash(el) {
        if (reduced) return;
        el.classList.remove('fire'); void el.offsetWidth; el.classList.add('fire');
    }
    function hit(i) {
        if (reduced) return;
        var p = pads[i];
        p.classList.remove('hit'); void p.offsetWidth; p.classList.add('hit');
        clearTimeout(p._t); p._t = setTimeout(function () { p.classList.remove('hit'); }, 220);
    }

    var vuEl = doc.getElementById('vu');
    function vu() {
        if (!analyser) return;
        analyser.getFloatTimeDomainData(vuBuf);
        var sum = 0; for (var i = 0; i < vuBuf.length; i += 4) sum += vuBuf[i] * vuBuf[i];
        var rms = Math.sqrt(sum / (vuBuf.length / 4));
        var v = Math.min(1, rms * 2.2);
        vuEl.style.setProperty('--v', v.toFixed(3));
        vuEl.classList.toggle('hot', v > 0.85);
    }

    function play() {
        ensureAudio();
        playing = true; step = 0; queue = []; lastStep = -1;
        nextTime = ctx.currentTime + 0.05;
        scheduler(); requestAnimationFrame(paint);
        playBtn.setAttribute('aria-pressed', 'true');
    }
    function pause() {
        playing = false; clearTimeout(timer); queue = [];
        playBtn.setAttribute('aria-pressed', 'false');
        vuEl.style.setProperty('--v', 0);
    }
    function stop() { pause(); step = 0; clearPlayhead(); }

    /* ── Build the grid ─────────────────────────────────────────────────── */

    var seq = doc.getElementById('seq');
    function col(s) { return 2 + s + Math.floor(s / 4); }

    function build() {
        var corner = doc.createElement('div'); corner.className = 'corner';
        corner.innerHTML = '<span class="label">Tracks</span><span class="hint">click a pad to hear it</span>';
        seq.appendChild(corner);
        for (var s = 0; s < STEPS; s++) {
            var n = doc.createElement('div'); n.className = 'num' + (s % 4 === 0 ? ' beat' : '');
            n.style.setProperty('--gc', col(s)); n.style.gridColumn = 'var(--gc)';
            n.textContent = s + 1; seq.appendChild(n); nums.push(n);
        }
        var r = 0;
        INST.forEach(function (ins, i) {
            if (i === 8) {
                var gl = doc.createElement('div'); gl.className = 'group'; gl.textContent = 'Keys';
                gl.style.setProperty('--r', r++); seq.appendChild(gl);
            }
            var tr = doc.createElement('div'); tr.className = 'track'; tr.setAttribute('role', 'rowheader');
            tr.style.setProperty('--r', r);
            var isKey = ins.type === 'key';
            tr.innerHTML =
                '<button class="pad" type="button" aria-label="Play ' + ins.name + '" title="' + ins.name + ' · key ' + ins.sub.split(' ')[0] + '">' + GLYPH[ins.glyph] + '</button>' +
                '<span class="name">' + ins.name + '<small>' + ins.sub + '</small></span>' +
                '<span class="mini">' +
                    '<label title="Level"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path class="f" d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6"/></svg>' +
                        '<input type="range" min="0" max="1" step="0.01" value="' + vol[i] + '" data-k="vol" aria-label="' + ins.name + ' level"></label>' +
                    '<label title="' + (isKey ? 'Decay' : 'Tune') + '"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + (isKey ? '<path d="M4 18c4 0 6-12 8-12s4 12 8 12"/>' : '<path d="M4 12h3l2-6 3 12 3-9 2 3h3"/>') + '</svg>' +
                        '<input type="range" min="' + (isKey ? 0.12 : 0.5) + '" max="' + (isKey ? 2 : 2) + '" step="0.01" value="' + param[i] + '" data-k="param" aria-label="' + ins.name + (isKey ? ' decay' : ' tune') + '"></label>' +
                '</span>' +
                '<span class="ms"><button type="button" class="mute" aria-pressed="false" title="Mute">M</button><button type="button" class="solo" aria-pressed="false" title="Solo">S</button></span>';
            seq.appendChild(tr); tracksEl.push(tr);
            var pad = tr.querySelector('.pad'); pads.push(pad);
            pad.addEventListener('pointerdown', function (e) { e.preventDefault(); trigger(i); });
            tr.querySelector('.mute').addEventListener('click', function () { mute[i] = !mute[i]; this.setAttribute('aria-pressed', String(mute[i])); refreshTracks(); save(); });
            tr.querySelector('.solo').addEventListener('click', function () { solo[i] = !solo[i]; this.setAttribute('aria-pressed', String(solo[i])); refreshTracks(); save(); });
            tr.querySelectorAll('input[type="range"]').forEach(function (inp) {
                fill(inp);
                inp.addEventListener('input', function () {
                    fill(inp);
                    if (inp.dataset.k === 'vol') vol[i] = +inp.value; else param[i] = +inp.value;
                    save();
                });
                inp.addEventListener('change', function () { trigger(i); });
            });

            cells.push([]);
            for (var s = 0; s < STEPS; s++) {
                var c = doc.createElement('button'); c.type = 'button';
                c.className = 'cell' + (s % 4 === 0 ? ' beat' : '');
                c.style.setProperty('--gc', col(s)); c.style.setProperty('--r', r);
                c.setAttribute('role', 'gridcell'); c.setAttribute('aria-label', ins.name + ' step ' + (s + 1));
                c.dataset.t = i; c.dataset.s = s;
                seq.appendChild(c); cells[i].push(c);
            }
            r++;
        });
        seq.addEventListener('click', function (e) {
            var c = e.target.closest('.cell'); if (!c) return;
            var i = +c.dataset.t, s = +c.dataset.s;
            if (e.shiftKey) grid[i][s] = grid[i][s] === 2 ? 1 : 2;
            else grid[i][s] = grid[i][s] ? 0 : 1;
            paintCell(i, s);
            if (grid[i][s] && !playing) { ensureAudio(); voice(i, ctx.currentTime, ctx, bus, grid[i][s] === 2 ? 1 : 0.7); hit(i); }
            save();
        });
        seq.addEventListener('contextmenu', function (e) {
            var c = e.target.closest('.cell'); if (!c) return;
            e.preventDefault();
            var i = +c.dataset.t, s = +c.dataset.s;
            grid[i][s] = grid[i][s] === 2 ? 1 : 2;
            paintCell(i, s); save();
        });
        /* Drag across steps to paint them. */
        var painting = null;
        seq.addEventListener('pointerdown', function (e) {
            var c = e.target.closest('.cell'); if (!c || e.button !== 0) return;
            painting = grid[+c.dataset.t][+c.dataset.s] ? 0 : 1;
        });
        seq.addEventListener('pointerover', function (e) {
            if (painting === null) return;
            var c = e.target.closest('.cell'); if (!c) return;
            var i = +c.dataset.t, s = +c.dataset.s;
            if (grid[i][s] !== painting && !(painting === 1 && grid[i][s] === 2)) { grid[i][s] = painting; paintCell(i, s); save(); }
        });
        window.addEventListener('pointerup', function () { painting = null; });
        setTimeout(function () { seq.classList.remove('enter'); }, 1400);
    }

    function paintCell(i, s) {
        var c = cells[i][s], v = grid[i][s];
        c.classList.toggle('on', v === 1); c.classList.toggle('acc', v === 2);
        c.setAttribute('aria-pressed', String(!!v));
    }
    function paintAll() { for (var i = 0; i < N; i++) for (var s = 0; s < STEPS; s++) paintCell(i, s); }
    function refreshTracks() {
        for (var i = 0; i < N; i++) {
            var off = !audible(i);
            tracksEl[i].classList.toggle('off', off);
            cells[i].forEach(function (c) { c.classList.toggle('muted', off); });
        }
    }
    function fill(inp) {
        var min = +inp.min || 0, max = +inp.max || 100;
        inp.style.setProperty('--p', ((+inp.value - min) / (max - min) * 100).toFixed(1) + '%');
    }

    /* A live hit: from a pad or a key. While recording and playing it also
       lands on the nearest step. */
    function trigger(i) {
        ensureAudio();
        voice(i, ctx.currentTime, ctx, bus, 0.85);
        hit(i);
        if (rec && playing) {
            var d = stepDur(), s = lastStep;
            if (s < 0) return;
            if (ctx.currentTime - lastStepTime > d / 2) s = (s + 1) % STEPS;
            if (!grid[i][s]) { grid[i][s] = 1; paintCell(i, s); save(); }
        }
    }

    /* ── Presets ────────────────────────────────────────────────────────── */

    /* Each row is a 16-character string: . off, x on, X accent. Rows are in
       instrument order; missing rows are empty. */
    var PRESETS = [
        { name: 'Four to the floor', bpm: 124, swing: 0, rows: {
            kick: 'X...x...X...x...', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', hato: '..x...x...x...x.', rim: '.......x......x.', c: 'x.......', g: '........x...', e: '............x...' } },
        { name: 'Boom bap', bpm: 92, swing: 42, rows: {
            kick: 'X.....x..x..x...', snare: '....X.......X...', hat: 'x.x.x.xxx.x.x.x.', hato: '..............x.', rim: '...x......x.....', a: 'x.......', e: '......x.........', c: '..........x.....' } },
        { name: 'Breakbeat', bpm: 136, swing: 0, rows: {
            kick: 'X.x.....x.x.....', snare: '....X.....x.X..x', hat: 'x.x.x.x.x.x.x.x.', hato: '......x.........', rim: '..........x.....', tomh: '.............x..', tom: '..............x.' } },
        { name: 'Trap', bpm: 140, swing: 0, rows: {
            kick: 'X.....x...x.....', clap: '....X.......X...', hat: 'x.x.x.x.x.x.xxxx', hato: '..............x.', tom: '.........x......', c: 'x...............', a: '........x.......' } },
        { name: 'Bossa', bpm: 118, swing: 8, rows: {
            kick: 'x..x..x.x..x..x.', rim: 'x..x..x...x..x..', hat: 'x.x.x.x.x.x.x.x.', hato: '.......x........', tomh: '.............x..', c: 'x.......', e: '...x............', g: '......x.........', a: '..........x.....' } },
        { name: 'Techno', bpm: 130, swing: 0, rows: {
            kick: 'X...X...X...X...', clap: '....x.......x...', hat: '..x...x...x...x.', hato: '..............x.', rim: 'x.....x..x.....x', tom: '.......x........', tomh: '...........x....', a: 'x.......x.......' } }
    ];

    function applyPreset(p) {
        for (var i = 0; i < N; i++) {
            var row = p.rows[INST[i].id] || '';
            for (var s = 0; s < STEPS; s++) { var ch = row[s] || '.'; grid[i][s] = ch === 'X' ? 2 : ch === 'x' ? 1 : 0; }
        }
        if (p.bpm) setBpm(p.bpm);
        if (p.swing != null) setSwing(p.swing);
        paintAll(); save();
    }

    /* Random: a kick on most downbeats, a backbeat, hats that mostly keep
       time, sparse everything else. Each roll is different but playable. */
    function randomise() {
        var rnd = Math.random;
        for (var i = 0; i < N; i++) for (var s = 0; s < STEPS; s++) {
            var id = INST[i].id, p = 0.06, acc = 0;
            if (id === 'kick') { p = s % 4 === 0 ? 0.9 : (s % 4 === 2 ? 0.18 : 0.08); acc = s === 0 ? 0.9 : 0.2; }
            else if (id === 'snare' || id === 'clap') { p = (s === 4 || s === 12) ? (id === 'snare' ? 0.75 : 0.5) : 0.05; acc = 0.6; }
            else if (id === 'hat') { p = s % 2 === 0 ? 0.8 : 0.22; acc = s % 4 === 0 ? 0.4 : 0; }
            else if (id === 'hato') { p = s % 4 === 2 ? 0.3 : 0.03; }
            else if (id === 'rim') { p = 0.12; }
            else if (id === 'tom' || id === 'tomh') { p = s >= 12 ? 0.16 : 0.04; }
            else p = 0.07;
            grid[i][s] = rnd() < p ? (rnd() < acc ? 2 : 1) : 0;
        }
        paintAll(); save();
    }

    /* ── Persistence and sharing ────────────────────────────────────────── */

    /* Each track's sixteen trits become one base-36 number (five chars). */
    function encode() {
        var parts = [];
        for (var i = 0; i < N; i++) { var n = 0; for (var s = 0; s < STEPS; s++) n = n * 3 + grid[i][s]; parts.push(n.toString(36).padStart(5, '0')); }
        return parts.join('') + '.' + bpm + '.' + swing;
    }
    function decode(str) {
        var m = /^([0-9a-z]{60})\.(\d+)\.(\d+)$/.exec(str || ''); if (!m) return false;
        for (var i = 0; i < N; i++) {
            var n = parseInt(m[1].substr(i * 5, 5), 36);
            for (var s = STEPS - 1; s >= 0; s--) { grid[i][s] = n % 3; n = Math.floor(n / 3); }
        }
        setBpm(+m[2]); setSwing(+m[3]);
        return true;
    }
    function save() {
        store(KEY.state, JSON.stringify({ p: encode(), vol: vol, param: param, mute: mute, solo: solo, master: master }));
    }
    function restore() {
        var raw = load(KEY.state); if (!raw) return false;
        try {
            var o = JSON.parse(raw);
            if (!decode(o.p)) return false;
            if (o.vol && o.vol.length === N) vol = o.vol;
            if (o.param && o.param.length === N) param = o.param;
            if (o.mute && o.mute.length === N) mute = o.mute;
            if (o.solo && o.solo.length === N) solo = o.solo;
            if (typeof o.master === 'number') master = o.master;
            return true;
        } catch (e) { return false; }
    }
    function syncControls() {
        for (var i = 0; i < N; i++) {
            var tr = tracksEl[i];
            var v = tr.querySelector('[data-k="vol"]'), p = tr.querySelector('[data-k="param"]');
            v.value = vol[i]; p.value = param[i]; fill(v); fill(p);
            tr.querySelector('.mute').setAttribute('aria-pressed', String(mute[i]));
            tr.querySelector('.solo').setAttribute('aria-pressed', String(solo[i]));
        }
        volIn.value = master; fill(volIn);
        refreshTracks();
    }

    /* ── Controls ───────────────────────────────────────────────────────── */

    var playBtn = doc.getElementById('playBtn'), stopBtn = doc.getElementById('stopBtn'), recBtn = doc.getElementById('recBtn');
    var bpmIn = doc.getElementById('bpm'), bpmVal = doc.getElementById('bpmVal');
    var swIn = doc.getElementById('swing'), swVal = doc.getElementById('swingVal');
    var volIn = doc.getElementById('volume'), muteBtn = doc.getElementById('muteBtn');
    var titleMode = doc.getElementById('titleMode');

    function setBpm(v) {
        bpm = Math.max(50, Math.min(200, Math.round(v)));
        bpmIn.value = bpm; bpmVal.textContent = bpm; fill(bpmIn);
        titleMode.textContent = bpm + ' bpm';
    }
    function setSwing(v) {
        swing = Math.max(0, Math.min(100, Math.round(v)));
        swIn.value = swing; swVal.textContent = swing; fill(swIn);
    }
    function setMaster() { if (bus) bus.gain.setTargetAtTime(muted ? 0 : master, ctx.currentTime, 0.02); }

    playBtn.addEventListener('click', function () { playing ? pause() : play(); });
    stopBtn.addEventListener('click', stop);
    recBtn.addEventListener('click', function () { rec = !rec; recBtn.setAttribute('aria-pressed', String(rec)); if (rec && !playing) play(); });
    bpmIn.addEventListener('input', function () { setBpm(+bpmIn.value); save(); });
    swIn.addEventListener('input', function () { setSwing(+swIn.value); save(); });
    volIn.addEventListener('input', function () { master = +volIn.value; fill(volIn); muted = false; muteBtn.setAttribute('aria-pressed', 'false'); setMaster(); save(); });
    muteBtn.addEventListener('click', function () { muted = !muted; muteBtn.setAttribute('aria-pressed', String(muted)); setMaster(); });

    doc.getElementById('randomBtn').addEventListener('click', function () { randomise(); unlatch(); });
    doc.getElementById('clearBtn').addEventListener('click', function () {
        for (var i = 0; i < N; i++) grid[i].fill(0);
        paintAll(); unlatch(); save(); toast('Cleared');
    });
    doc.getElementById('shareBtn').addEventListener('click', function () {
        var url = location.origin + location.pathname + '#p=' + encode();
        history.replaceState(null, '', '#p=' + encode());
        var done = function () { toast('Link copied'); }, fail = function () { toast('Link is in the address bar'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fail); else fail();
    });

    var presetsEl = doc.getElementById('presets');
    PRESETS.forEach(function (p) {
        var b = doc.createElement('button'); b.type = 'button'; b.className = 'key'; b.textContent = p.name;
        b.addEventListener('click', function () { applyPreset(p); unlatch(); b.classList.add('latched'); });
        presetsEl.appendChild(b);
    });
    function unlatch() { presetsEl.querySelectorAll('.latched').forEach(function (k) { k.classList.remove('latched'); }); }

    /* Keyboard: space plays, digits and QWER are the pads, arrows nudge the
       tempo. Nothing fires while a field has focus. */
    doc.addEventListener('keydown', function (e) {
        if (e.target.matches('input, textarea, select') || exportDlg.open) return;
        if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); return; }
        if (e.code === 'ArrowRight') { setBpm(bpm + (e.shiftKey ? 10 : 1)); save(); return; }
        if (e.code === 'ArrowLeft') { setBpm(bpm - (e.shiftKey ? 10 : 1)); save(); return; }
        if (e.code === 'Escape' && playing) { stop(); return; }
        var i = KEYMAP[e.code];
        if (i != null && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); trigger(i); }
    });

    /* ── Theme ──────────────────────────────────────────────────────────── */

    var themeBtn = doc.getElementById('themeBtn');
    function setTheme(t) {
        html.setAttribute('data-theme', t);
        themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
        var meta = doc.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', t === 'dark' ? '#0b0b0b' : '#f6f3ec');
        store(KEY.theme, t);
    }
    setTheme(html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    themeBtn.addEventListener('click', function () { setTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); });

    /* ── Title ──────────────────────────────────────────────────────────── */

    doc.querySelectorAll('[data-split]').forEach(function (node) {
        var text = node.textContent; node.setAttribute('aria-label', text); node.textContent = '';
        text.split('').forEach(function (ch, i) {
            var s = doc.createElement('span'); s.className = 'ch'; s.setAttribute('aria-hidden', 'true');
            s.style.setProperty('--i', i); s.textContent = ch; node.appendChild(s);
        });
    });

    /* ── Toast ──────────────────────────────────────────────────────────── */

    var toastEl = null, toastT = null;
    function toast(msg) {
        if (!toastEl) { toastEl = doc.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); doc.body.appendChild(toastEl); }
        toastEl.textContent = msg;
        requestAnimationFrame(function () { toastEl.classList.add('up'); });
        clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('up'); }, 2200);
    }

    /* ── Export ─────────────────────────────────────────────────────────── */

    var exportDlg = doc.getElementById('exportDlg'), exportForm = doc.getElementById('exportForm'), exportStatus = doc.getElementById('exportStatus');
    var statusText = doc.getElementById('statusText'), statusBar = doc.getElementById('statusBar'), dlHost = doc.getElementById('downloadHost');
    var loopsIn = doc.getElementById('loops'), loopsHint = doc.getElementById('loopsHint');
    var lastUrl = null;

    function loopsText() {
        var n = Math.max(1, Math.min(64, +loopsIn.value || 1));
        var secs = n * STEPS * stepDur();
        loopsHint.textContent = n + (n === 1 ? ' loop · ' : ' loops · ') + secs.toFixed(1) + ' seconds at ' + bpm + ' bpm.';
    }
    loopsIn.addEventListener('input', loopsText);
    exportForm.addEventListener('submit', function (e) { e.preventDefault(); doc.getElementById('renderBtn').click(); });
    doc.getElementById('exportBtn').addEventListener('click', function () {
        exportForm.hidden = false; exportStatus.hidden = true; dlHost.innerHTML = '';
        loopsText(); exportDlg.showModal();
    });
    function closeExport() { exportDlg.close(); if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; } }
    doc.getElementById('exportClose').addEventListener('click', closeExport);
    doc.getElementById('exportCancel').addEventListener('click', closeExport);
    exportDlg.addEventListener('click', function (e) { if (e.target === exportDlg) closeExport(); });

    doc.getElementById('renderBtn').addEventListener('click', function () {
        var loops = Math.max(1, Math.min(64, +loopsIn.value || 1));
        exportForm.hidden = true; exportStatus.hidden = false; statusBar.hidden = false;
        statusText.textContent = 'Rendering ' + loops + (loops === 1 ? ' loop…' : ' loops…');
        var rate = 44100, d = stepDur(), total = loops * STEPS * d + 1.0;
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        var oc = new OAC(2, Math.ceil(rate * total), rate);
        var g = buildBus(oc); g.bus.gain.value = master;
        for (var l = 0; l < loops; l++) for (var s = 0; s < STEPS; s++) {
            var when = 0.02 + (l * STEPS + s) * d + swingFor(s);
            for (var i = 0; i < N; i++) { var v = grid[i][s]; if (v && audible(i)) voice(i, when, oc, g.bus, v === 2 ? 1 : 0.7); }
        }
        oc.startRendering().then(function (buf) {
            var blob = wav(buf);
            lastUrl = URL.createObjectURL(blob);
            statusText.textContent = 'Done · ' + (blob.size / 1048576).toFixed(1) + ' MB';
            statusBar.hidden = true;
            var a = doc.createElement('a'); a.className = 'btn btn-primary'; a.href = lastUrl;
            a.download = 'drumpad-' + bpm + 'bpm-' + loops + 'x.wav'; a.textContent = 'Download WAV';
            dlHost.innerHTML = ''; dlHost.appendChild(a);
        }, function (err) {
            console.error(err); statusText.textContent = 'Rendering failed.'; statusBar.hidden = true;
        });
    });

    /* 16-bit PCM WAV. */
    function wav(buf) {
        var ch = buf.numberOfChannels, len = buf.length, bytes = 44 + len * ch * 2;
        var ab = new ArrayBuffer(bytes), v = new DataView(ab), pos = 0;
        function u16(x) { v.setUint16(pos, x, true); pos += 2; }
        function u32(x) { v.setUint32(pos, x, true); pos += 4; }
        u32(0x46464952); u32(bytes - 8); u32(0x45564157); u32(0x20746d66); u32(16); u16(1); u16(ch);
        u32(buf.sampleRate); u32(buf.sampleRate * ch * 2); u16(ch * 2); u16(16); u32(0x61746164); u32(bytes - 44);
        var data = []; for (var c = 0; c < ch; c++) data.push(buf.getChannelData(c));
        for (var i = 0; i < len; i++) for (c = 0; c < ch; c++) {
            var x = Math.max(-1, Math.min(1, data[c][i]));
            v.setInt16(pos, x < 0 ? x * 32768 : x * 32767, true); pos += 2;
        }
        return new Blob([ab], { type: 'audio/wav' });
    }

    /* ── Boot ───────────────────────────────────────────────────────────── */

    build();
    var fromUrl = /^#p=(.+)$/.exec(location.hash);
    if (fromUrl && decode(fromUrl[1])) { toast('Pattern loaded from link'); }
    else if (!restore()) { applyPreset(PRESETS[0]); presetsEl.firstChild.classList.add('latched'); }
    setBpm(bpm); setSwing(swing);
    paintAll(); syncControls(); fill(bpmIn); fill(swIn);
    doc.addEventListener('visibilitychange', function () { if (doc.hidden && playing) pause(); });
})();
