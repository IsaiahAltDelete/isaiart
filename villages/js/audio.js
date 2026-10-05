// Tiny WebAudio synth for cozy blips. Starts after the first user gesture.
let ctx = null, master = null, enabled = true, birdTimer = 0;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
  } catch { ctx = null; }
}
export function setSound(on) { enabled = on; if (master) master.gain.value = on ? 0.35 : 0; }

function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, attack = 0.005, at = 0, dest = null } = {}) {
  if (!ctx || !enabled) return;
  const t = (at || ctx.currentTime) + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, vol = 0.2, freq = 1200, delay = 0) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + delay;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(master); s.start(t);
}

export const sfx = {
  click: () => tone(660, 0.07, { type: 'triangle', vol: 0.18, slide: 120 }),
  open: () => { tone(520, 0.08, { type: 'triangle', vol: 0.16 }); tone(780, 0.1, { type: 'triangle', vol: 0.14, delay: 0.05 }); },
  place: () => { noise(0.12, 0.35, 500); tone(180, 0.15, { type: 'sine', vol: 0.3, slide: -60 }); },
  chop: () => { noise(0.06, 0.25, 1800); tone(320, 0.06, { type: 'square', vol: 0.05, slide: -120 }); },
  mine: () => { noise(0.05, 0.25, 3200); tone(900, 0.05, { type: 'square', vol: 0.04 }); },
  coin: () => { tone(988, 0.08, { type: 'square', vol: 0.07 }); tone(1319, 0.18, { type: 'square', vol: 0.07, delay: 0.07 }); },
  done: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.18, delay: i * 0.08 })),
  level: () => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.2, delay: i * 0.09 })),
  error: () => tone(200, 0.15, { type: 'sawtooth', vol: 0.08, slide: -60 }),
  pop: () => tone(420, 0.09, { type: 'sine', vol: 0.25, slide: 380 }),
  chest: () => { noise(0.18, 0.18, 900); [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.35, { type: 'sine', vol: 0.13, delay: 0.12 + i * 0.07 })); },
  firework: () => { tone(500, 0.6, { type: 'sine', vol: 0.03, slide: 900, attack: 0.05 }); noise(0.5, 0.22, 700, 0.62); noise(0.9, 0.08, 4000, 0.66); },
  snow: () => [1319, 1568, 1976].forEach((f, i) => tone(f, 0.5, { type: 'sine', vol: 0.05, delay: i * 0.12 })),
  howl: () => { tone(380, 0.5, { type: 'sine', vol: 0.06, slide: 260, attack: 0.15 }); tone(640, 1.1, { type: 'sine', vol: 0.05, slide: -180, delay: 0.45, attack: 0.1 }); },
};

// gentle ambient birdsong
export function ambient(dt) {
  if (!ctx || !enabled) return;
  birdTimer -= dt;
  if (birdTimer > 0) return;
  birdTimer = 3 + Math.random() * 7;
  const base = 2200 + Math.random() * 1600, n = 2 + (Math.random() * 4 | 0);
  for (let i = 0; i < n; i++) tone(base + Math.random() * 400, 0.07, { type: 'sine', vol: 0.035, slide: (Math.random() - 0.3) * 900, delay: i * 0.11 });
}

// soft looping rain hiss; k = 0..1 intensity
let rainNode = null, rainGain = null;
export function rainSound(k) {
  if (!ctx) return;
  if (!rainNode && k > 0.02) {
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    rainNode = ctx.createBufferSource(); rainNode.buffer = buf; rainNode.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rainNode.connect(f); f.connect(rainGain); rainGain.connect(master); rainNode.start();
  }
  if (rainGain) rainGain.gain.value = enabled ? k * 0.18 : 0;
}

// ── the village score ──
// A small procedural composer. Four pieces (morning, day, evening, night) built
// from chord progressions in a key; each 8-bar phrase is A A' B A'' — a short
// motif, the motif moved onto the next chords, a contrasting idea, and the
// motif again resolving home. Phrases repeat once so tunes are recognisable.
let musicOn = false, musicTimer = null, bus = null, nextT = 0, step = 0, mood = 'day', want = 'day', phrase = null, phraseN = 0, wet = null, tone2 = null;
const midi = m => 440 * Math.pow(2, (m - 69) / 12);
const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10];
const PIECES = {
  morning: { root: 60, scale: MAJOR, bpm: 84, meter: 4, prog: [0, 4, 5, 3, 0, 3, 4, 0], lead: 'piano', comp: 'harp', perc: 'shaker', bell: 0.25 },
  day:     { root: 65, scale: MAJOR, bpm: 100, meter: 4, prog: [0, 5, 3, 4, 0, 2, 3, 4], lead: 'harp', comp: 'piano', perc: 'full', bell: 0.15 },
  evening: { root: 67, scale: MAJOR, bpm: 78, meter: 3, prog: [0, 3, 1, 4, 0, 5, 3, 4], lead: 'flute', comp: 'waltz', perc: null, bell: 0.1 },
  // a lively jig for festival evenings
  festival: { root: 62, scale: [0, 2, 4, 5, 7, 9, 10], bpm: 150, meter: 3, prog: [0, 6, 0, 4, 0, 6, 3, 4], lead: 'flute', comp: 'waltz', perc: 'full', bell: 0.35 },
  night:   { root: 57, scale: MINOR, bpm: 60, meter: 4, prog: [0, 5, 2, 6, 0, 3, 5, 4], lead: 'piano', comp: 'pad', perc: null, bell: 0.3, sparse: true },
};
export function setMusic(on) { musicOn = on; if (on) startMusic(); else stopMusic(); }
export function setMood(m) { if (PIECES[m]) want = m; }

function makeBus() {
  bus = ctx.createGain(); bus.gain.value = 0.5;
  tone2 = ctx.createBiquadFilter(); tone2.type = 'lowpass'; tone2.frequency.value = 5200;
  bus.connect(tone2); tone2.connect(master);
  // a soft hall: decaying stereo noise impulse
  const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = lp * Math.pow(1 - i / len, 2.6); } }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  wet = ctx.createGain(); wet.gain.value = 0.38;
  bus.connect(conv); conv.connect(wet); wet.connect(master);
}
function startMusic() {
  if (!ctx || musicTimer || !musicOn) return;
  if (!bus) makeBus();
  nextT = ctx.currentTime + 0.25;
  musicTimer = setInterval(scheduleMusic, 100);
}
function stopMusic() { clearInterval(musicTimer); musicTimer = null; }

// ── instruments ──
function voice(type, f, t, { a = 0.01, d = 1, v = 0.1, detune = 0, dest = bus, filter = null } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  let n = o; if (filter) { n.connect(filter); n = filter; }
  n.connect(g); g.connect(dest); o.start(t); o.stop(t + a + d + 0.1);
  return o;
}
const piano = (m, t, dur, v) => { const f = midi(m), d = Math.max(1.1, dur * 1.8); voice('sine', f, t, { a: 0.006, d, v }); voice('triangle', f * 2, t, { a: 0.004, d: d * 0.5, v: v * 0.22, detune: 3 }); voice('sine', f * 3, t, { a: 0.003, d: d * 0.25, v: v * 0.06 }); };
const harp = (m, t, v) => { const f = midi(m), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.6); voice('triangle', f, t, { a: 0.003, d: 1.5, v, filter: lp }); voice('sine', f * 2, t, { a: 0.002, d: 0.4, v: v * 0.25 }); };
function flute(m, t, dur, v) {
  const f = midi(m), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
  o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f;
  lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.006, t + 0.35); lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
  const g2 = ctx.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(g); o.connect(g);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.09); g.gain.setValueAtTime(v * 0.85, t + Math.max(0.12, dur - 0.1)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
  g.connect(bus); for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + dur + 0.5); }
}
const bass = (m, t, dur, v) => { const f = midi(m); voice('sine', f, t, { a: 0.02, d: dur, v }); voice('sine', f * 2, t, { a: 0.02, d: dur * 0.5, v: v * 0.22 }); };
const bell = (m, t, v) => { const f = midi(m); voice('sine', f, t, { a: 0.002, d: 2.2, v }); voice('sine', f * 2.76, t, { a: 0.002, d: 1.2, v: v * 0.35 }); voice('sine', f * 5.4, t, { a: 0.002, d: 0.6, v: v * 0.15 }); };
function pad(notes, t, dur, v) {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.connect(bus);
  for (const m of notes) for (const dt of [-6, 6]) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = midi(m); o.detune.value = dt;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    o.connect(g); g.connect(lp); o.start(t); o.stop(t + dur * 1.1);
  }
}
let noiseBuf = null;
function shaker(t, v) {
  if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6500;
  const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(hp); hp.connect(g); g.connect(bus); src.start(t); src.stop(t + 0.1);
}
function kick(t, v) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.3);
}

// ── composition ──
const rnd = (a, b) => a + Math.random() * (b - a);
function degreeToMidi(P, deg, oct = 0) {
  const n = P.scale.length, o = Math.floor(deg / n), i = ((deg % n) + n) % n;
  return P.root + P.scale[i] + 12 * (o + oct);
}
function chordTones(P, degRoot) { return [degRoot, degRoot + 2, degRoot + 4]; }
// a motif: rhythm (in 8th steps) and contour (scale-step moves)
function makeMotif(P) {
  const steps = P.meter * 2, out = [];
  const patterns = P.meter === 3
    ? [[0, 2, 4], [0, 3, 4], [0, 2, 3, 4], [0, 4]]
    : [[0, 2, 4, 6], [0, 3, 4, 6], [0, 1, 2, 4, 6], [0, 2, 3, 4], [0, 4, 6], [0, 2, 6]];
  for (let bar = 0; bar < 2; bar++) {
    const pat = patterns[(Math.random() * patterns.length) | 0];
    pat.forEach((st, k) => {
      const next = k + 1 < pat.length ? pat[k + 1] : steps;
      out.push({ at: bar * steps + st, len: next - st, move: k === 0 && bar === 0 ? 0 : [-2, -1, -1, 1, 1, 2, 0][(Math.random() * 7) | 0] });
    });
  }
  return out;
}
function buildPhrase(P) {
  const A = makeMotif(P), B = makeMotif(P), steps = P.meter * 2, notes = [];
  const sections = [[A, 0, false], [A, 2, false], [B, 4, false], [A, 6, true]];
  let deg = 7;   // start around the upper tonic
  for (const [motif, barStart, resolve] of sections) {
    const chord = P.prog[barStart];
    // begin each section on a chord tone near where we are
    const tones = chordTones(P, chord).flatMap(d => [d, d + 7]);
    deg = tones.reduce((best, d) => Math.abs(d - deg) < Math.abs(best - deg) ? d : best, tones[0]);
    motif.forEach((n, i) => {
      deg = Math.max(3, Math.min(13, deg + n.move));
      const bar = barStart + Math.floor(n.at / steps), strong = n.at % P.meter === 0;
      if (strong) { const ct = chordTones(P, P.prog[bar]).flatMap(d => [d, d + 7]); deg = ct.reduce((b, d) => Math.abs(d - deg) < Math.abs(b - deg) ? d : b, ct[0]); }
      let len = n.len;
      if (resolve && i === motif.length - 1) { deg = 7; len = steps * 2 - (n.at % (steps * 2)); }
      if (P.sparse && Math.random() < 0.35 && !(resolve && i === motif.length - 1)) return;
      notes.push({ at: barStart * steps + n.at, len, deg });
    });
  }
  return notes;
}

function scheduleMusic() {
  if (!ctx) return;
  while (nextT < ctx.currentTime + 0.6) {
    const P = PIECES[mood], steps = P.meter * 2, eighth = 60 / P.bpm / 2;
    const s = step % (steps * 8), bar = Math.floor(s / steps), pos = s % steps;
    if (s === 0) {
      // a new phrase: switch piece if the mood changed, else repeat the tune once before writing a new one
      if (want !== mood) { mood = want; step = 0; phrase = null; continue; }
      if (!phrase || phraseN >= 2) { phrase = buildPhrase(P); phraseN = 0; }
      phraseN++;
    }
    const t = nextT, deg = P.prog[bar], tones = chordTones(P, deg);
    // bass
    if (pos === 0) bass(degreeToMidi(P, deg, -2), t, eighth * steps * 0.9, 0.12);
    if (P.meter === 4 && pos === 4 && P.comp !== 'pad') bass(degreeToMidi(P, deg + 4, -2), t, eighth * 3, 0.07);
    // accompaniment
    if (P.comp === 'harp' && pos % 1 === 0) { const seq = [0, 1, 2, 1, 3, 2, 1, 2]; const d = seq[pos % 8]; harp(degreeToMidi(P, d === 3 ? tones[0] + 7 : tones[d], 0), t, 0.045); }
    if (P.comp === 'piano' && pos % 2 === 1) for (const d of tones) piano(degreeToMidi(P, d, 0), t, eighth, 0.025);
    if (P.comp === 'waltz' && pos % 2 === 0 && pos > 0) for (const d of tones) piano(degreeToMidi(P, d, 0), t, eighth * 1.5, 0.028);
    if (P.comp === 'pad' && pos === 0) pad(tones.map(d => degreeToMidi(P, d, -1)), t, eighth * steps, 0.012);
    // melody
    for (const n of phrase) if (n.at === s) {
      const m = degreeToMidi(P, n.deg, 0), dur = n.len * eighth;
      if (P.lead === 'piano') piano(m, t, dur, 0.075);
      else if (P.lead === 'harp') { harp(m, t, 0.08); if (n.len >= 3) harp(m, t + eighth, 0.035); }
      else flute(m, t, dur * 0.95, 0.06);
    }
    // percussion and sparkle
    if (P.perc === 'shaker' && pos % 2 === 1) shaker(t, 0.035);
    if (P.perc === 'full') { if (pos === 0) kick(t, 0.16); if (pos % 2 === 1) shaker(t, 0.03 + (pos === 3 || pos === 7 ? 0.015 : 0)); }
    if (pos === 0 && Math.random() < P.bell) bell(degreeToMidi(P, tones[(Math.random() * 3) | 0], 1), t + eighth * (Math.random() < 0.5 ? 2 : 3), 0.03);
    nextT += eighth * (pos % 2 ? 0.96 : 1.04);   // a little swing
    step++;
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopMusic(); else if (musicOn) startMusic(); });
