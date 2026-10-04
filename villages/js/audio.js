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

function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, attack = 0.005 } = {}) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
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
