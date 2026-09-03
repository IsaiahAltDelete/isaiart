// src/core/audio.js — procedural WebAudio: synthesised SFX + looping chiptune music for Sword Coast Chronicles.
//
// Everything here is generated from oscillators, noise buffers, gain envelopes and
// biquad filters. No audio files, no external libraries. The module is written so
// that a missing / blocked / suspended AudioContext degrades to silence instead of
// throwing — the game must keep running on browsers with no WebAudio at all.
//
// Signal graph:
//    voices ──▶ sfxGain ──┐
//                         ├──▶ masterGain ──▶ destination
//    trackGain(A) ─┐      │
//    trackGain(B) ─┴─▶ musicGain ──┘        (two track gains exist during a crossfade)

import { makeRNG } from './rng.js';
import { TRACKS, SPB, INSTRUMENTS, TRACK_GROUPS, trackForBiome } from './music.js';

// Dedicated RNG stream for audio jitter. Deliberately NOT the global `rng`: audio
// must never consume numbers from the gameplay stream or saves would desync.
const arng = makeRNG('sword-coast-audio');

// ─────────────────────────────────────────────────────────────────────────────
// Note / pitch helpers
// ─────────────────────────────────────────────────────────────────────────────

const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "A4" | "F#3" | "Bb5" -> MIDI number. Returns NaN for junk. */
export function noteToMidi(name) {
  if (typeof name === 'number') return name;
  const m = /^([A-Ga-g])([#s+]*|[b-]*)(-?\d+)$/.exec(String(name).trim());
  if (!m) return NaN;
  let n = SEMI[m[1].toLowerCase()];
  for (const c of m[2]) n += (c === '#' || c === 's' || c === '+') ? 1 : -1;
  return (parseInt(m[3], 10) + 1) * 12 + n;
}

/** MIDI number -> Hz (A4 = 69 = 440 Hz, equal temperament). */
export function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

/** Accepts a Hz number (>= 20), a MIDI number (< 20 treated as MIDI is ambiguous, so use names) or a note name. */
function freqOf(note, transpose = 0) {
  if (typeof note === 'number') return note > 0 && note < 128 ? midiToFreq(note + transpose) : note;
  const midi = noteToMidi(note);
  return Number.isNaN(midi) ? 440 : midiToFreq(midi + transpose);
}

/** Key name -> semitone transpose from C. Used to move a whole track into another key. */
function keyTranspose(key) {
  if (!key) return 0;
  const midi = noteToMidi(String(key).replace(/m(in(or)?)?$/i, '') + '4');
  return Number.isNaN(midi) ? 0 : ((midi - 60) % 12 + 12) % 12;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine state
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  ctx: null,
  master: null,
  musicBus: null,
  sfxBus: null,
  ok: false,          // true once a context exists and the graph is built
  dead: false,        // true if WebAudio is unavailable — stop trying
  vol: { master: 0.7, music: 0.55, sfx: 0.8 },
  muted: false,
  noiseBuf: null,     // white noise, 2 s
  pinkBuf: null,      // pink-ish noise (softer, for wind / roars)
  voices: 0,          // live sfx voices, for the polyphony cap
  lastAt: Object.create(null), // sfx name -> ctx time of last trigger (machine-gun guard)
  // music
  players: [],        // active MusicPlayer instances (2 during a crossfade)
  currentId: null,
  pendingId: null,
  timer: null,        // setInterval handle for the lookahead scheduler
  fanfareResume: null,// track id to return to after a one-shot fanfare
  duckUntil: 0,
};

const MAX_VOICES = 24;       // hard polyphony cap; extra sfx are dropped, not queued
const LOOKAHEAD_MS = 25;     // scheduler wake-up interval
const SCHEDULE_AHEAD = 0.2;  // seconds of music scheduled beyond `now`
const CROSSFADE = 0.6;       // seconds

/** Build the 2-second noise buffers once. White for percussive hits, pink for wind/roar. */
function buildNoise(ctx) {
  const n = Math.floor(ctx.sampleRate * 2);
  const white = ctx.createBuffer(1, n, ctx.sampleRate);
  const wd = white.getChannelData(0);
  for (let i = 0; i < n; i++) wd[i] = arng.float(-1, 1);
  state.noiseBuf = white;

  // Voss-McCartney-lite pink noise: sum of a few decaying random walks. Cheaper than
  // a real filter bank and plenty for a 16-bit-era game.
  const pink = ctx.createBuffer(1, n, ctx.sampleRate);
  const pd = pink.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = arng.float(-1, 1);
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57000 * b2 + w * 1.0526913;
    pd[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
  }
  state.pinkBuf = pink;
}

/** Lazily create the AudioContext. MUST be called from a user gesture on most browsers. */
function ensure() {
  if (state.ok) { resume(); return true; }
  if (state.dead) return false;
  const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  if (!AC) { state.dead = true; return false; }
  try {
    const ctx = new AC();
    const master = ctx.createGain();
    const musicBus = ctx.createGain();
    const duckGain = ctx.createGain();   // separate node so ducking never fights setVolume()
    const sfxBus = ctx.createGain();

    // A stone-hall reverb across the music. More than anything else, this is what
    // stops a synthesised loop sounding like a cheap chip and starts it sounding
    // like players in a room.
    const musicDry = ctx.createGain();
    const musicWet = ctx.createGain();
    const verb = ctx.createConvolver();
    musicDry.gain.value = 0.78;
    musicWet.gain.value = 0.34;
    try { verb.buffer = makeHallIR(ctx, 2.1, 2.6); } catch (e) { /* no reverb, still fine */ }
    // Roll off the very top of the wet path — stone absorbs treble.
    const wetTone = ctx.createBiquadFilter();
    wetTone.type = 'lowpass'; wetTone.frequency.value = 3200;

    musicBus.connect(musicDry); musicDry.connect(duckGain);
    musicBus.connect(verb); verb.connect(wetTone); wetTone.connect(musicWet); musicWet.connect(duckGain);

    duckGain.connect(master);
    sfxBus.connect(master);
    master.connect(ctx.destination);
    state.ctx = ctx; state.master = master; state.musicBus = musicBus; state.sfxBus = sfxBus;
    state.duckGain = duckGain; state.musicWet = musicWet; state.musicDry = musicDry;
    // Flush anything that was requested before the context was allowed to run.
    try { ctx.onstatechange = () => { if (ctx.state === 'running') flushPending(); }; } catch (e) { /* ignore */ }
    buildNoise(ctx);
    state.ok = true;
    applyVolumes(0);
    resume();
    return true;
  } catch (e) {
    state.dead = true;
    return false;
  }
}

/** Contexts start 'suspended' until a gesture; retry cheaply on every audio call. */
function resume() {
  const ctx = state.ctx;
  if (!ctx) return;
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
    try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  }
}

function now() { return state.ok ? state.ctx.currentTime : 0; }

/** Push the volume model into the gain nodes. `ramp` seconds of smoothing avoids clicks. */
function applyVolumes(ramp = 0.05) {
  if (!state.ok) return;
  const t = now();
  const m = state.muted ? 0 : state.vol.master;
  setGain(state.master, m, t, ramp);
  setGain(state.musicBus, state.vol.music, t, ramp);
  setGain(state.sfxBus, state.vol.sfx, t, ramp);
}

function setGain(node, v, t, ramp) {
  const p = node.gain;
  try {
    p.cancelScheduledValues(t);
    p.setValueAtTime(Math.max(0.0001, p.value), t);
    if (ramp > 0) p.linearRampToValueAtTime(Math.max(0, v), t + ramp);
    else p.setValueAtTime(Math.max(0, v), t);
  } catch (e) { try { p.value = v; } catch (e2) { /* ignore */ } }
}

/** Voice bookkeeping so a spammed sfx can't melt the audio thread. */
function claimVoice(dur) {
  if (state.voices >= MAX_VOICES) return false;
  state.voices++;
  const ms = Math.min(6000, Math.max(40, dur * 1000 + 120));
  setTimeout(() => { state.voices = Math.max(0, state.voices - 1); }, ms);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice builders — the primitives every sfx is composed from
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single pitched voice.
 * @param {object} o
 *   freq      Hz or note name ("A4"); required
 *   type      'sine'|'square'|'triangle'|'sawtooth' (default 'square')
 *   dur       seconds of sustain+decay (default 0.15)
 *   vol       peak gain (default 0.3)
 *   attack    seconds to peak (default 0.005)
 *   decay     seconds of release tail (default = dur, exponential)
 *   hold      seconds held at peak before decay (default 0)
 *   slideTo   Hz/note to glide to over `dur` (portamento)
 *   slideCurve 'exp'|'lin'
 *   vibrato   {rate, depth} — depth in Hz
 *   detune    cents
 *   filter    {type,freq,q,sweepTo} biquad on this voice
 *   pan       -1..1
 *   delay     seconds to wait before starting
 *   dest      AudioNode override (defaults to the sfx bus)
 */
export function tone(o = {}) {
  if (!ensure()) return null;
  const ctx = state.ctx;
  const t0 = now() + (o.delay || 0);
  const dur = Math.max(0.01, o.dur ?? 0.15);
  const vol = o.vol ?? 0.3;
  const atk = Math.min(o.attack ?? 0.005, dur * 0.9);
  const dec = o.decay ?? dur;
  const hold = o.hold ?? 0;

  const osc = ctx.createOscillator();
  osc.type = o.type || 'square';
  const f0 = freqOf(o.freq ?? 440);
  osc.frequency.setValueAtTime(Math.max(1, f0), t0);
  if (o.detune) try { osc.detune.setValueAtTime(o.detune, t0); } catch (e) { /* ignore */ }
  if (o.slideTo != null) {
    const f1 = Math.max(1, freqOf(o.slideTo));
    if (o.slideCurve === 'lin') osc.frequency.linearRampToValueAtTime(f1, t0 + dur);
    else osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  }

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t0 + atk);
  if (hold > 0) g.gain.setValueAtTime(Math.max(0.0002, vol), t0 + atk + hold);
  // Exponential release reads as a "pluck"; linear reads as a fade. Chiptunes want the pluck.
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + hold + Math.max(0.01, dec));

  let node = osc;
  if (o.filter) node = chainFilter(node, o.filter, t0, dur);
  const out = o.dest || state.sfxBus;
  connectPanned(node, g, out, o.pan);

  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(o.vibrato.rate ?? 6, t0);
    lg.gain.setValueAtTime(o.vibrato.depth ?? 6, t0);
    lfo.connect(lg); lg.connect(osc.frequency);
    lfo.start(t0); lfo.stop(t0 + atk + hold + dec + 0.05);
  }

  const stopAt = t0 + atk + hold + dec + 0.05;
  osc.start(t0);
  osc.stop(stopAt);
  return { osc, gain: g, endsAt: stopAt };
}

/**
 * A noise burst — the percussive half of every impact, whoosh and elemental effect.
 * @param {object} o
 *   dur, vol, attack, decay, delay, pan, dest  (as in tone)
 *   filter {type:'lowpass'|'highpass'|'bandpass', freq, q, sweepTo}
 *   sweep  shorthand for a lowpass sweeping freq -> sweep
 *   pink   true for the softer pink buffer (wind, roars, fire)
 *   rate   playbackRate of the buffer (pitch of the hiss)
 */
export function noise(o = {}) {
  if (!ensure()) return null;
  const ctx = state.ctx;
  const t0 = now() + (o.delay || 0);
  const dur = Math.max(0.01, o.dur ?? 0.15);
  const vol = o.vol ?? 0.25;
  const atk = Math.min(o.attack ?? 0.002, dur * 0.9);
  const dec = o.decay ?? dur;

  const src = ctx.createBufferSource();
  src.buffer = o.pink ? state.pinkBuf : state.noiseBuf;
  src.loop = true;
  if (o.rate) src.playbackRate.setValueAtTime(o.rate, t0);
  // Start at a random offset so consecutive hits aren't bit-identical.
  const off = arng.float(0, 1.5);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + Math.max(0.01, dec));

  const filt = o.filter || (o.sweep ? { type: 'lowpass', freq: 6000, q: 1, sweepTo: o.sweep } : null);
  let node = src;
  if (filt) node = chainFilter(node, filt, t0, dur);
  connectPanned(node, g, o.dest || state.sfxBus, o.pan);

  const stopAt = t0 + atk + dec + 0.05;
  try { src.start(t0, off); } catch (e) { src.start(t0); }
  src.stop(stopAt);
  return { src, gain: g, endsAt: stopAt };
}

/** Wire `src` through a biquad, optionally sweeping its cutoff over `dur`. Returns the filter. */
function chainFilter(src, f, t0, dur) {
  const ctx = state.ctx;
  const bq = ctx.createBiquadFilter();
  bq.type = f.type || 'lowpass';
  bq.frequency.setValueAtTime(Math.max(20, f.freq ?? 1200), t0);
  if (f.q != null) bq.Q.setValueAtTime(f.q, t0);
  if (f.gain != null) try { bq.gain.setValueAtTime(f.gain, t0); } catch (e) { /* ignore */ }
  if (f.sweepTo != null) bq.frequency.exponentialRampToValueAtTime(Math.max(20, f.sweepTo), t0 + (f.sweepDur ?? dur));
  src.connect(bq);
  return bq;
}

/** node -> gain -> [panner] -> dest. StereoPanner is missing on old Safari; degrade gracefully. */
function connectPanned(node, gain, dest, pan) {
  node.connect(gain);
  if (pan != null && state.ctx.createStereoPanner) {
    const p = state.ctx.createStereoPanner();
    try { p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now()); } catch (e) { /* ignore */ }
    gain.connect(p); p.connect(dest);
  } else {
    gain.connect(dest);
  }
}

/** Play several `tone` specs simultaneously (a chord). `common` is merged into each. */
export function chord(specs, common = {}) {
  const out = [];
  for (const s of specs) out.push(tone(Object.assign({}, common, typeof s === 'object' ? s : { freq: s })));
  return out;
}

/** Play tone specs in sequence. `gap` seconds between onsets (default: each note's dur). */
export function arp(specs, common = {}, gap = null) {
  let t = common.delay || 0;
  const out = [];
  for (const s of specs) {
    const spec = Object.assign({}, common, typeof s === 'object' ? s : { freq: s });
    spec.delay = t;
    out.push(tone(spec));
    t += gap != null ? gap : (spec.dur ?? 0.12);
  }
  return out;
}

/** ±cents of pitch jitter so a repeated sfx never machine-guns identically. */
function jitter(cents = 30) { return arng.float(-cents, cents); }
/** Multiply a frequency by a small random amount (cents -> ratio). */
function jf(f, cents = 30) { return freqOf(f) * Math.pow(2, jitter(cents) / 1200); }

// ─────────────────────────────────────────────────────────────────────────────
// SFX catalogue
//
// Each entry is `(A) => void` where A is the normalised opts bundle:
//   A.g   volume multiplier (caller's opts.vol, default 1)
//   A.pan stereo position or undefined
//   A.d   start delay in seconds
//   A.pm  pitch multiplier from opts.pitch (semitones)
// Design rules: UI blips stay under 0.12 s, combat hits land in 0.15–0.35 s,
// spells and stingers may run long. Every entry uses jitter so repeats breathe.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum seconds between two triggers of the same sfx name (anti machine-gun). */
const THROTTLE = {
  cursor: 0.035, step: 0.09, 'footstep-grass': 0.09, 'footstep-stone': 0.09,
  hit: 0.03, slash: 0.04, dice: 0.03, lowhp: 0.9, page: 0.05, coin: 0.04,
};

const SFX = {
  // ── UI ────────────────────────────────────────────────────────────────────
  // Dry, high, very short. These fire constantly while navigating menus.
  cursor: (A) => {
    tone({ freq: jf(1180, 45) * A.pm, type: 'square', dur: 0.045, vol: 0.10 * A.g, attack: 0.001, decay: 0.04, pan: A.pan, delay: A.d });
  },
  select: (A) => {
    // Rising perfect fifth — the classic "yes".
    tone({ freq: jf(760, 20) * A.pm, type: 'square', dur: 0.05, vol: 0.13 * A.g, attack: 0.001, decay: 0.05, pan: A.pan, delay: A.d });
    tone({ freq: jf(1140, 20) * A.pm, type: 'square', dur: 0.09, vol: 0.12 * A.g, attack: 0.001, decay: 0.08, pan: A.pan, delay: A.d + 0.045 });
  },
  back: (A) => {
    // Falling fourth — the mirror of `select`.
    tone({ freq: jf(700, 20) * A.pm, type: 'square', dur: 0.05, vol: 0.11 * A.g, attack: 0.001, decay: 0.05, pan: A.pan, delay: A.d });
    tone({ freq: jf(470, 20) * A.pm, type: 'square', dur: 0.09, vol: 0.10 * A.g, attack: 0.001, decay: 0.09, pan: A.pan, delay: A.d + 0.04 });
  },
  error: (A) => {
    // Minor second buzz: two clashing squares through a lowpass. Unmistakably "no".
    tone({ freq: 196 * A.pm, type: 'square', dur: 0.18, vol: 0.13 * A.g, attack: 0.002, decay: 0.16, filter: { type: 'lowpass', freq: 1400, q: 2 }, pan: A.pan, delay: A.d });
    tone({ freq: 208 * A.pm, type: 'square', dur: 0.18, vol: 0.11 * A.g, attack: 0.002, decay: 0.16, pan: A.pan, delay: A.d + 0.01 });
  },
  open: (A) => {
    // Menu window sliding open: quick upward arpeggio + a soft air swell.
    arp(['C5', 'E5', 'G5'], { type: 'triangle', dur: 0.07, vol: 0.10 * A.g, attack: 0.002, decay: 0.07, pan: A.pan, delay: A.d }, 0.028);
    noise({ dur: 0.14, vol: 0.05 * A.g, pink: true, filter: { type: 'bandpass', freq: 900, q: 1.2, sweepTo: 2600 }, pan: A.pan, delay: A.d });
  },
  close: (A) => {
    arp(['G5', 'E5', 'C5'], { type: 'triangle', dur: 0.06, vol: 0.09 * A.g, attack: 0.002, decay: 0.06, pan: A.pan, delay: A.d }, 0.026);
    noise({ dur: 0.12, vol: 0.05 * A.g, pink: true, filter: { type: 'bandpass', freq: 2400, q: 1.2, sweepTo: 700 }, pan: A.pan, delay: A.d });
  },
  page: (A) => {
    // Paper turn: a short filtered noise scrape, no pitch at all.
    noise({ dur: 0.12, vol: 0.10 * A.g, pink: true, rate: arng.float(0.9, 1.1), filter: { type: 'highpass', freq: 1600, q: 0.7, sweepTo: 4200 }, pan: A.pan, delay: A.d });
  },

  // ── Movement / world ──────────────────────────────────────────────────────
  step: (A) => { SFX['footstep-grass'](A); },
  'footstep-grass': (A) => {
    // Soft, high, brief rustle. Deliberately quiet: it plays every half-tile.
    noise({ dur: 0.075, vol: 0.055 * A.g, pink: true, rate: arng.float(0.85, 1.25),
      filter: { type: 'bandpass', freq: arng.float(1500, 2400), q: 0.9, sweepTo: 900 }, pan: A.pan, delay: A.d });
  },
  'footstep-stone': (A) => {
    // Hard boot on flagstone: clicky noise transient + a low thud body.
    noise({ dur: 0.05, vol: 0.07 * A.g, rate: arng.float(0.9, 1.2), filter: { type: 'highpass', freq: 900, q: 0.8 }, pan: A.pan, delay: A.d });
    tone({ freq: jf(150, 60), type: 'sine', dur: 0.07, vol: 0.07 * A.g, attack: 0.001, decay: 0.06, slideTo: 90, pan: A.pan, delay: A.d });
  },
  door: (A) => {
    // Creaking hinge (bandpass noise sliding up) then the latch clunk.
    noise({ dur: 0.35, vol: 0.07 * A.g, pink: true, rate: arng.float(0.9, 1.1),
      filter: { type: 'bandpass', freq: 480, q: 6, sweepTo: arng.float(900, 1300), sweepDur: 0.32 }, pan: A.pan, delay: A.d });
    tone({ freq: 120, type: 'square', dur: 0.09, vol: 0.10 * A.g, attack: 0.001, decay: 0.08, slideTo: 70, filter: { type: 'lowpass', freq: 700 }, pan: A.pan, delay: A.d + 0.3 });
  },
  chest: (A) => {
    // Lid creak, latch, then a small sparkle so loot always feels rewarding.
    noise({ dur: 0.28, vol: 0.08 * A.g, pink: true, filter: { type: 'bandpass', freq: 420, q: 7, sweepTo: 1000, sweepDur: 0.26 }, pan: A.pan, delay: A.d });
    tone({ freq: 95, type: 'square', dur: 0.12, vol: 0.11 * A.g, attack: 0.001, decay: 0.11, filter: { type: 'lowpass', freq: 600 }, pan: A.pan, delay: A.d + 0.26 });
    arp(['G5', 'B5', 'D6', 'G6'], { type: 'triangle', dur: 0.11, vol: 0.09 * A.g, attack: 0.002, decay: 0.13, pan: A.pan, delay: A.d + 0.34 }, 0.055);
  },

  // ── Attacks & impacts ─────────────────────────────────────────────────────
  slash: (A) => {
    // Blade whoosh: fast bandpass noise sweeping down through the swing arc.
    noise({ dur: 0.16, vol: 0.16 * A.g, rate: arng.float(0.9, 1.15),
      filter: { type: 'bandpass', freq: arng.float(2600, 3400), q: 1.4, sweepTo: 600, sweepDur: 0.15 }, pan: A.pan, delay: A.d });
    tone({ freq: jf(620, 80), type: 'sawtooth', dur: 0.1, vol: 0.05 * A.g, attack: 0.002, decay: 0.09, slideTo: 180, pan: A.pan, delay: A.d });
  },
  hit: (A) => {
    // Weapon connecting with meat/mail: low square thump + broadband crack.
    tone({ freq: jf(210, 70) * A.pm, type: 'square', dur: 0.12, vol: 0.16 * A.g, attack: 0.001, decay: 0.11, slideTo: 70,
      filter: { type: 'lowpass', freq: 1600, q: 1 }, pan: A.pan, delay: A.d });
    noise({ dur: 0.1, vol: 0.13 * A.g, filter: { type: 'lowpass', freq: 3200, q: 0.9, sweepTo: 500 }, pan: A.pan, delay: A.d });
  },
  hitcrit: (A) => {
    // A natural 20: everything `hit` does, plus a sub-bass drop and a bright ring.
    tone({ freq: 300, type: 'square', dur: 0.22, vol: 0.20 * A.g, attack: 0.001, decay: 0.21, slideTo: 55, filter: { type: 'lowpass', freq: 2200 }, pan: A.pan, delay: A.d });
    noise({ dur: 0.24, vol: 0.20 * A.g, filter: { type: 'lowpass', freq: 5200, q: 1, sweepTo: 320 }, pan: A.pan, delay: A.d });
    tone({ freq: 1320, type: 'triangle', dur: 0.3, vol: 0.10 * A.g, attack: 0.002, decay: 0.3, slideTo: 990, pan: A.pan, delay: A.d + 0.02 });
    tone({ freq: 44, type: 'sine', dur: 0.35, vol: 0.22 * A.g, attack: 0.004, decay: 0.34, pan: A.pan, delay: A.d + 0.01 });
  },
  miss: (A) => {
    // Whiff: airy noise sweep with no impact transient at all.
    noise({ dur: 0.2, vol: 0.09 * A.g, pink: true, rate: arng.float(0.9, 1.1),
      filter: { type: 'bandpass', freq: 1800, q: 0.8, sweepTo: 380, sweepDur: 0.19 }, pan: A.pan, delay: A.d });
  },
  arrow: (A) => {
    // Bowstring release then the fletching hiss doppler-ing away.
    tone({ freq: jf(340, 60), type: 'triangle', dur: 0.06, vol: 0.10 * A.g, attack: 0.001, decay: 0.05, slideTo: 150, pan: A.pan, delay: A.d });
    noise({ dur: 0.26, vol: 0.09 * A.g, rate: 1.2, filter: { type: 'bandpass', freq: 3600, q: 2.2, sweepTo: 1400, sweepDur: 0.25 }, pan: A.pan, delay: A.d + 0.02 });
  },
  shove: (A) => {
    // Body-check: dull low thud, cloth rustle, no metal.
    tone({ freq: jf(120, 60), type: 'sine', dur: 0.18, vol: 0.18 * A.g, attack: 0.003, decay: 0.17, slideTo: 55, pan: A.pan, delay: A.d });
    noise({ dur: 0.16, vol: 0.09 * A.g, pink: true, filter: { type: 'lowpass', freq: 1400, q: 0.8, sweepTo: 400 }, pan: A.pan, delay: A.d });
  },

  // ── Magic ─────────────────────────────────────────────────────────────────
  spell: (A) => {
    // Generic arcane release: shimmering rising fifth pair + airy tail.
    tone({ freq: jf(440, 25) * A.pm, type: 'triangle', dur: 0.3, vol: 0.11 * A.g, attack: 0.02, decay: 0.28, slideTo: 1320, vibrato: { rate: 9, depth: 8 }, pan: A.pan, delay: A.d });
    tone({ freq: jf(660, 25) * A.pm, type: 'sine', dur: 0.34, vol: 0.08 * A.g, attack: 0.03, decay: 0.31, slideTo: 1760, pan: A.pan, delay: A.d + 0.03 });
    noise({ dur: 0.34, vol: 0.05 * A.g, pink: true, filter: { type: 'bandpass', freq: 900, q: 1.1, sweepTo: 5200 }, pan: A.pan, delay: A.d });
  },
  heal: (A) => {
    // Warm major triad blooming upward — sine + triangle only, no noise, no edge.
    arp(['C5', 'E5', 'G5', 'C6'], { type: 'sine', dur: 0.5, vol: 0.10 * A.g, attack: 0.03, decay: 0.5, pan: A.pan, delay: A.d }, 0.075);
    tone({ freq: 'G4', type: 'triangle', dur: 0.7, vol: 0.06 * A.g, attack: 0.12, decay: 0.6, vibrato: { rate: 4.5, depth: 3 }, pan: A.pan, delay: A.d + 0.05 });
  },
  fire: (A) => {
    // Ignition thump then a long crackling pink-noise roar sweeping down.
    tone({ freq: 180, type: 'sawtooth', dur: 0.18, vol: 0.12 * A.g, attack: 0.004, decay: 0.17, slideTo: 60, filter: { type: 'lowpass', freq: 1200 }, pan: A.pan, delay: A.d });
    noise({ dur: 0.55, vol: 0.17 * A.g, pink: true, rate: arng.float(0.85, 1.1),
      filter: { type: 'lowpass', freq: 4200, q: 1.4, sweepTo: 420, sweepDur: 0.5 }, pan: A.pan, delay: A.d });
    // Crackle: a handful of tiny random pops over the burn.
    for (let i = 0; i < 5; i++) noise({ dur: 0.05, vol: 0.05 * A.g, delay: A.d + arng.float(0.05, 0.42), filter: { type: 'bandpass', freq: arng.float(1800, 4200), q: 6 }, pan: A.pan });
  },
  ice: (A) => {
    // Brittle crystal: high shattering noise + a descending glassy sine.
    noise({ dur: 0.3, vol: 0.11 * A.g, filter: { type: 'highpass', freq: 3200, q: 1.5, sweepTo: 7600 }, pan: A.pan, delay: A.d });
    tone({ freq: jf(2100, 20), type: 'sine', dur: 0.4, vol: 0.09 * A.g, attack: 0.004, decay: 0.4, slideTo: 620, pan: A.pan, delay: A.d });
    arp([2640, 3140, 2200], { type: 'triangle', dur: 0.12, vol: 0.06 * A.g, attack: 0.002, decay: 0.14, pan: A.pan, delay: A.d + 0.04 }, 0.05);
  },
  thunder: (A) => {
    // Crack (bright transient) followed by a rolling low rumble.
    noise({ dur: 0.14, vol: 0.24 * A.g, filter: { type: 'highpass', freq: 1800, q: 0.7, sweepTo: 400 }, pan: A.pan, delay: A.d });
    noise({ dur: 1.1, vol: 0.2 * A.g, pink: true, rate: 0.55, filter: { type: 'lowpass', freq: 900, q: 1.2, sweepTo: 90, sweepDur: 1.0 }, pan: A.pan, delay: A.d + 0.04 });
    tone({ freq: 70, type: 'sine', dur: 0.8, vol: 0.22 * A.g, attack: 0.005, decay: 0.8, slideTo: 34, pan: A.pan, delay: A.d + 0.02 });
  },
  buff: (A) => {
    // Ascending whole-tone shimmer: something good just landed on you.
    arp(['E5', 'G#5', 'B5', 'E6'], { type: 'triangle', dur: 0.22, vol: 0.09 * A.g, attack: 0.006, decay: 0.24, pan: A.pan, delay: A.d }, 0.055);
    noise({ dur: 0.4, vol: 0.04 * A.g, pink: true, filter: { type: 'bandpass', freq: 1400, q: 1.4, sweepTo: 6000 }, pan: A.pan, delay: A.d });
  },
  debuff: (A) => {
    // Descending, detuned, filtered down — the inverse of `buff`.
    arp(['B4', 'G4', 'Eb4', 'B3'], { type: 'sawtooth', dur: 0.24, vol: 0.08 * A.g, attack: 0.008, decay: 0.26,
      filter: { type: 'lowpass', freq: 2200, q: 1.5, sweepTo: 400 }, detune: -18, pan: A.pan, delay: A.d }, 0.06);
    noise({ dur: 0.45, vol: 0.05 * A.g, pink: true, filter: { type: 'bandpass', freq: 5200, q: 1.3, sweepTo: 700 }, pan: A.pan, delay: A.d });
  },

  // ── Rewards & stingers ────────────────────────────────────────────────────
  coin: (A) => {
    // Two tiny bright squares a major third apart — the classic coin chime.
    tone({ freq: jf(1980, 40), type: 'square', dur: 0.06, vol: 0.09 * A.g, attack: 0.001, decay: 0.06, pan: A.pan, delay: A.d });
    tone({ freq: jf(2640, 40), type: 'square', dur: 0.16, vol: 0.08 * A.g, attack: 0.001, decay: 0.17, pan: A.pan, delay: A.d + 0.05 });
  },
  item: (A) => {
    // Item obtained: a confident rising triad with a soft bell tail.
    arp(['G5', 'C6', 'E6'], { type: 'square', dur: 0.09, vol: 0.09 * A.g, attack: 0.002, decay: 0.1, pan: A.pan, delay: A.d }, 0.06);
    tone({ freq: 'G6', type: 'sine', dur: 0.5, vol: 0.06 * A.g, attack: 0.01, decay: 0.5, pan: A.pan, delay: A.d + 0.18 });
  },
  potion: (A) => {
    // Cork pop, three glugs, then the warm swallow.
    tone({ freq: 700, type: 'sine', dur: 0.05, vol: 0.12 * A.g, attack: 0.001, decay: 0.045, slideTo: 1500, pan: A.pan, delay: A.d });
    for (let i = 0; i < 3; i++) {
      tone({ freq: 300 + i * 40, type: 'sine', dur: 0.09, vol: 0.09 * A.g, attack: 0.003, decay: 0.08, slideTo: 170 + i * 30, pan: A.pan, delay: A.d + 0.09 + i * 0.09 });
    }
    tone({ freq: 'C5', type: 'triangle', dur: 0.35, vol: 0.07 * A.g, attack: 0.02, decay: 0.34, slideTo: freqOf('G5'), pan: A.pan, delay: A.d + 0.38 });
  },
  equip: (A) => {
    // Steel on leather: metallic bandpass ring + buckle click.
    noise({ dur: 0.14, vol: 0.10 * A.g, filter: { type: 'bandpass', freq: 2600, q: 3.5, sweepTo: 1500 }, pan: A.pan, delay: A.d });
    tone({ freq: jf(880, 25), type: 'square', dur: 0.13, vol: 0.08 * A.g, attack: 0.001, decay: 0.13, slideTo: 1320, pan: A.pan, delay: A.d + 0.02 });
  },
  unequip: (A) => {
    noise({ dur: 0.13, vol: 0.08 * A.g, filter: { type: 'bandpass', freq: 1700, q: 3.0, sweepTo: 900 }, pan: A.pan, delay: A.d });
    tone({ freq: jf(880, 25), type: 'square', dur: 0.12, vol: 0.07 * A.g, attack: 0.001, decay: 0.12, slideTo: 520, pan: A.pan, delay: A.d + 0.02 });
  },
  quest: (A) => {
    // Journal update: a small horn-ish fanfare, dotted rhythm, no percussion.
    const V = { type: 'square', vol: 0.09 * A.g, attack: 0.006, pan: A.pan };
    tone(Object.assign({ freq: 'D5', dur: 0.12, decay: 0.13, delay: A.d }, V));
    tone(Object.assign({ freq: 'F#5', dur: 0.12, decay: 0.13, delay: A.d + 0.12 }, V));
    tone(Object.assign({ freq: 'A5', dur: 0.34, decay: 0.36, delay: A.d + 0.24 }, V));
    tone({ freq: 'D4', type: 'triangle', dur: 0.6, vol: 0.07 * A.g, attack: 0.01, decay: 0.6, pan: A.pan, delay: A.d + 0.24 });
  },
  levelup: (A) => {
    // Six-note rising major run, then a sustained I chord. The big one.
    const notes = ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'];
    arp(notes, { type: 'square', dur: 0.11, vol: 0.10 * A.g, attack: 0.003, decay: 0.13, pan: A.pan, delay: A.d }, 0.075);
    chord(['C5', 'E5', 'G5', 'C6'], { type: 'triangle', dur: 1.1, vol: 0.07 * A.g, attack: 0.03, decay: 1.05, pan: A.pan, delay: A.d + 0.5 });
    noise({ dur: 0.9, vol: 0.04 * A.g, pink: true, filter: { type: 'bandpass', freq: 900, q: 1.1, sweepTo: 7000, sweepDur: 0.85 }, pan: A.pan, delay: A.d + 0.42 });
  },
  dice: (A) => {
    // A d20 tumbling: several short woody clicks at irregular spacing.
    const n = 5;
    for (let i = 0; i < n; i++) {
      const d = A.d + i * arng.float(0.035, 0.06);
      tone({ freq: arng.float(340, 900), type: 'square', dur: 0.035, vol: 0.07 * A.g * (1 - i / (n + 2)), attack: 0.001, decay: 0.03,
        filter: { type: 'bandpass', freq: arng.float(1200, 2600), q: 2 }, pan: A.pan, delay: d });
      noise({ dur: 0.03, vol: 0.05 * A.g, filter: { type: 'highpass', freq: 2200 }, pan: A.pan, delay: d });
    }
  },

  // ── Battle flow ───────────────────────────────────────────────────────────
  encounter: (A) => {
    // Ambush sting: a rising minor-second alarm over a rumble. Plays into the battle wipe.
    tone({ freq: 'D4', type: 'square', dur: 0.16, vol: 0.13 * A.g, attack: 0.002, decay: 0.16, pan: A.pan, delay: A.d });
    tone({ freq: 'Eb4', type: 'square', dur: 0.16, vol: 0.13 * A.g, attack: 0.002, decay: 0.16, pan: A.pan, delay: A.d + 0.14 });
    tone({ freq: 'D5', type: 'square', dur: 0.5, vol: 0.14 * A.g, attack: 0.002, decay: 0.5, slideTo: freqOf('Eb5'), pan: A.pan, delay: A.d + 0.28 });
    noise({ dur: 0.7, vol: 0.10 * A.g, pink: true, rate: 0.6, filter: { type: 'lowpass', freq: 260, q: 1.4, sweepTo: 1400, sweepDur: 0.65 }, pan: A.pan, delay: A.d });
  },
  victory: (A) => {
    // Short triumphant flourish (the full loop lives in the `victory` music track).
    const V = { type: 'square', vol: 0.10 * A.g, attack: 0.004, pan: A.pan };
    tone(Object.assign({ freq: 'G4', dur: 0.1, decay: 0.1, delay: A.d }, V));
    tone(Object.assign({ freq: 'C5', dur: 0.1, decay: 0.1, delay: A.d + 0.1 }, V));
    tone(Object.assign({ freq: 'E5', dur: 0.1, decay: 0.1, delay: A.d + 0.2 }, V));
    tone(Object.assign({ freq: 'G5', dur: 0.55, decay: 0.6, delay: A.d + 0.3 }, V));
    chord(['C4', 'G4', 'C5'], { type: 'triangle', dur: 0.9, vol: 0.06 * A.g, attack: 0.02, decay: 0.9, pan: A.pan, delay: A.d + 0.3 });
  },
  defeat: (A) => {
    // Sagging chromatic fall into a minor chord.
    arp(['G4', 'F#4', 'F4', 'E4'], { type: 'triangle', dur: 0.28, vol: 0.10 * A.g, attack: 0.01, decay: 0.3,
      filter: { type: 'lowpass', freq: 2400, q: 1, sweepTo: 700 }, pan: A.pan, delay: A.d }, 0.2);
    chord(['C3', 'Eb3', 'G3'], { type: 'sawtooth', dur: 1.4, vol: 0.06 * A.g, attack: 0.05, decay: 1.4,
      filter: { type: 'lowpass', freq: 1200, q: 1, sweepTo: 300 }, pan: A.pan, delay: A.d + 0.8 });
  },
  death: (A) => {
    // A creature drops: descending detuned wail + body-fall thud.
    tone({ freq: jf(520, 60), type: 'sawtooth', dur: 0.6, vol: 0.11 * A.g, attack: 0.006, decay: 0.6, slideTo: 90,
      filter: { type: 'lowpass', freq: 2600, q: 1.2, sweepTo: 400 }, vibrato: { rate: 7, depth: 12 }, pan: A.pan, delay: A.d });
    tone({ freq: 90, type: 'sine', dur: 0.3, vol: 0.16 * A.g, attack: 0.004, decay: 0.3, slideTo: 40, pan: A.pan, delay: A.d + 0.45 });
    noise({ dur: 0.3, vol: 0.08 * A.g, pink: true, filter: { type: 'lowpass', freq: 1100, q: 0.8, sweepTo: 200 }, pan: A.pan, delay: A.d + 0.45 });
  },
  roar: (A) => {
    // Dragon/giant bellow: growling saw pair under a swelling pink roar.
    const base = arng.float(70, 95);
    tone({ freq: base, type: 'sawtooth', dur: 1.0, vol: 0.14 * A.g, attack: 0.06, decay: 0.95, slideTo: base * 0.65,
      filter: { type: 'lowpass', freq: 800, q: 2.5, sweepTo: 260, sweepDur: 0.9 }, vibrato: { rate: 18, depth: 9 }, pan: A.pan, delay: A.d });
    tone({ freq: base * 1.5, type: 'sawtooth', dur: 0.9, vol: 0.08 * A.g, attack: 0.08, decay: 0.85, slideTo: base,
      vibrato: { rate: 23, depth: 14 }, filter: { type: 'lowpass', freq: 1400, q: 2, sweepTo: 400 }, pan: A.pan, delay: A.d + 0.03 });
    noise({ dur: 1.0, vol: 0.10 * A.g, pink: true, rate: 0.7, filter: { type: 'bandpass', freq: 500, q: 0.9, sweepTo: 180, sweepDur: 0.95 }, pan: A.pan, delay: A.d });
  },
  lowhp: (A) => {
    // The nagging "you're about to die" pulse. Two beeps, dry and urgent.
    tone({ freq: 'A5', type: 'square', dur: 0.09, vol: 0.09 * A.g, attack: 0.001, decay: 0.08, pan: A.pan, delay: A.d });
    tone({ freq: 'A5', type: 'square', dur: 0.09, vol: 0.09 * A.g, attack: 0.001, decay: 0.08, pan: A.pan, delay: A.d + 0.14 });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Music: the score lives in core/music.js — instrument models, modal helpers and
// every track. This file owns the synthesis and the sequencer, not the notes.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Music engine: oscillator/drum voices, lookahead sequencer, crossfading players
// ─────────────────────────────────────────────────────────────────────────────

const _pending = [];  // callbacks deferred until the context is actually running
function flushPending() {
  while (_pending.length) { const f = _pending.shift(); try { f(); } catch (e) { /* ignore */ } }
}
/** Run `fn` now if the context is running, otherwise once it starts (autoplay policy). */
function whenRunning(fn) {
  if (!ensure()) return false;
  if (state.ctx.state === 'running') { fn(); return true; }
  _pending.push(fn);
  resume();
  return false;
}

// Duty-cycle pulse waves. 25% and 12.5% pulses are *the* NES/GBA lead timbres;
// WebAudio only ships a 50% square, so synthesise them from the Fourier series
// of a rectangular wave: coefficient k = (2/(kπ))·sin(kπ·duty).
const _pulseCache = new Map();
function pulseWave(duty) {
  if (_pulseCache.has(duty)) return _pulseCache.get(duty);
  const n = 34;
  const real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
  let w = null;
  try { w = state.ctx.createPeriodicWave(real, imag, { disableNormalization: false }); } catch (e) { w = null; }
  _pulseCache.set(duty, w);
  return w;
}

// ---------------------------------------------------------------------------
// HARMONIC SPECTRA — what actually makes a note sound like an instrument.
//
// `triangle` and `sawtooth` are the two shapes every synthesised game score in
// the world is made of, and the ear knows them instantly: they are the "beep".
// A real instrument is a specific recipe of harmonic strengths, and the Web
// Audio API will build an oscillator from one directly (createPeriodicWave), so
// a violin can be a violin without shipping a single byte of sample.
//
// Each list is the amplitude of harmonic 1, 2, 3, … relative to the loudest.
// The characteristic facts are the ones worth knowing:
//   • a clarinet's cylindrical bore suppresses EVEN harmonics — that hollow, woody
//     sound is literally the missing 2nd, 4th and 6th;
//   • an oboe and a bassoon are weak at the fundamental and loud at 2–4, which is
//     why they cut through an orchestra at low volume;
//   • a flute is very nearly a sine wave, and is carried by breath noise instead;
//   • brass gets its bite from strong upper-middle harmonics, and the higher the
//     instrument the further up that peak sits.
// ---------------------------------------------------------------------------

const SPECTRA = {
  // strings — rich, dense, slow rolloff
  violin: [1, 0.72, 0.55, 0.42, 0.38, 0.28, 0.22, 0.18, 0.14, 0.11, 0.09, 0.07, 0.05, 0.04, 0.03],
  viola: [1, 0.68, 0.48, 0.34, 0.26, 0.19, 0.14, 0.10, 0.08, 0.06, 0.04, 0.03],
  cello: [1, 0.75, 0.50, 0.35, 0.26, 0.18, 0.13, 0.09, 0.07, 0.05, 0.03],
  contrabass: [1, 0.60, 0.32, 0.18, 0.11, 0.07, 0.04, 0.02],
  // brass — the peak climbs with the instrument
  horn: [1, 0.55, 0.30, 0.16, 0.09, 0.05, 0.03],
  trombone: [0.90, 1, 0.70, 0.45, 0.30, 0.20, 0.13, 0.08, 0.05],
  trumpet: [0.70, 1, 0.85, 0.62, 0.45, 0.32, 0.22, 0.15, 0.10, 0.07, 0.05],
  tuba: [1, 0.70, 0.38, 0.20, 0.11, 0.06, 0.03],
  // double reeds — quiet fundamental, loud 2nd and 3rd
  oboe: [0.45, 1, 0.90, 0.60, 0.40, 0.30, 0.20, 0.14, 0.10, 0.06],
  bassoon: [0.50, 1, 0.75, 0.50, 0.30, 0.20, 0.12, 0.08, 0.05],
  // single reed — odd harmonics only
  clarinet: [1, 0.05, 0.60, 0.04, 0.35, 0.03, 0.22, 0.02, 0.12, 0.01, 0.06],
  // air columns — almost pure
  flute: [1, 0.25, 0.08, 0.04, 0.02],
  panpipe: [1, 0.18, 0.10, 0.05, 0.02],
};

const _waveCache = new Map();

/** A cached PeriodicWave for one named spectrum. Null if the context refuses. */
function harmonicWave(name) {
  if (_waveCache.has(name)) return _waveCache.get(name);
  const spec = SPECTRA[name];
  let w = null;
  if (spec && state.ctx) {
    const n = spec.length + 1;
    const real = new Float32Array(n), imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = spec[k - 1];
    try { w = state.ctx.createPeriodicWave(real, imag, { disableNormalization: false }); } catch (e) { w = null; }
  }
  _waveCache.set(name, w);
  return w;
}

/**
 * Build a decaying-noise impulse response — a serviceable stone hall without
 * shipping an audio file. `decay` shapes how fast it dies; `secs` is the tail.
 *
 * The tail alone reads as "processed"; what tells the ear the size of a room is
 * the handful of DISCRETE early reflections that arrive before it — the first
 * bounce off a wall, then the ceiling. Those are stamped in first, at times
 * that suit a hall rather than a cupboard, and the two channels are built from
 * separate noise so the reverb has width instead of sitting in your head.
 */
function makeHallIR(ctx, secs = 2.0, decay = 2.5) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * secs));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Early reflections thin out into a smooth exponential tail.
      const env = Math.pow(1 - t, decay);
      d[i] = (arng.float(-1, 1)) * env;
    }
    // Gentle pre-delay so the dry attack still reads clearly.
    const pre = Math.floor(rate * 0.012);
    for (let i = len - 1; i >= pre; i--) d[i] = d[i - pre];
    for (let i = 0; i < pre; i++) d[i] = 0;

    // Early reflections: the first few discrete bounces. These are what carry
    // the SIZE of the room — without them a tail is just a wash. Times are
    // slightly different per channel so the hall has width.
    const taps = ch === 0
      ? [[0.0191, 0.62], [0.0295, -0.48], [0.0438, 0.36], [0.0617, -0.27], [0.0834, 0.19]]
      : [[0.0223, 0.58], [0.0331, -0.44], [0.0472, 0.33], [0.0663, -0.25], [0.0891, 0.17]];
    for (const [t, a] of taps) {
      const i = Math.floor(rate * t);
      if (i < len) d[i] += a;
    }
  }
  return buf;
}

/** Apply a layer's wave setting to an oscillator. Returns false for noise layers. */
function setWave(osc, wave) {
  switch (wave) {
    case 'pulse25': { const w = pulseWave(0.25); if (w) { osc.setPeriodicWave(w); return true; } osc.type = 'square'; return true; }
    case 'pulse18': { const w = pulseWave(0.18); if (w) { osc.setPeriodicWave(w); return true; } osc.type = 'square'; return true; }
    case 'pulse12':
    case 'pulse125': { const w = pulseWave(0.125); if (w) { osc.setPeriodicWave(w); return true; } osc.type = 'square'; return true; }
    case 'saw': case 'sawtooth': osc.type = 'sawtooth'; return true;
    case 'sine': osc.type = 'sine'; return true;
    case 'triangle': osc.type = 'triangle'; return true;
    case 'square': osc.type = 'square'; return true;
    default: {
      // A named harmonic spectrum — 'violin', 'horn', 'clarinet'. Falls back to
      // a sawtooth if the browser will not build the wave, so a missing
      // spectrum is a duller note rather than silence.
      const w = SPECTRA[wave] ? harmonicWave(wave) : null;
      if (w) { osc.setPeriodicWave(w); return true; }
      osc.type = SPECTRA[wave] ? 'sawtooth' : 'square';
      return true;
    }
  }
}

/**
 * One percussion voice. Drums are pure synthesis: a pitched sine body for the
 * low drums, filtered white noise for everything with a hiss.
 */
function drumVoice(name, when, vol, dest) {
  const ctx = state.ctx;
  const mk = (o) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, o.vol), when + (o.atk ?? 0.001));
    g.gain.exponentialRampToValueAtTime(0.0001, when + (o.atk ?? 0.001) + o.dec);
    g.connect(dest);
    return g;
  };
  const osc = (o) => {
    const s = ctx.createOscillator();
    s.type = o.type || 'sine';
    s.frequency.setValueAtTime(o.f0, when);
    if (o.f1) s.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), when + o.dec * 0.9);
    const g = mk(o);
    if (o.filter) { const bq = chainFilter(s, o.filter, when, o.dec); bq.connect(g); }
    else s.connect(g);
    s.start(when); s.stop(when + o.dec + 0.05);
  };
  const nz = (o) => {
    const s = ctx.createBufferSource();
    s.buffer = o.pink ? state.pinkBuf : state.noiseBuf;
    s.loop = true;
    const g = mk(o);
    const bq = chainFilter(s, o.filter, when, o.dec);
    bq.connect(g);
    try { s.start(when, arng.float(0, 1.5)); } catch (e) { s.start(when); }
    s.stop(when + o.dec + 0.05);
  };

  switch (name) {
    case 'kick':                                            // sine drop + a click transient
      osc({ f0: 150, f1: 44, dec: 0.19, vol: 0.9 * vol, type: 'sine' });
      nz({ filter: { type: 'lowpass', freq: 2400, sweepTo: 300 }, dec: 0.03, vol: 0.25 * vol });
      break;
    case 'snare':                                           // noise body + tuned "shell" tone
      nz({ filter: { type: 'highpass', freq: 1300, q: 0.8 }, dec: 0.13, vol: 0.55 * vol });
      osc({ f0: 195, f1: 150, dec: 0.07, vol: 0.3 * vol, type: 'triangle' });
      break;
    case 'rim':                                             // dry stick click
      nz({ filter: { type: 'bandpass', freq: 2200, q: 6 }, dec: 0.05, vol: 0.5 * vol });
      osc({ f0: 420, f1: 300, dec: 0.035, vol: 0.25 * vol, type: 'square' });
      break;
    case 'hat':
      nz({ filter: { type: 'highpass', freq: 7200, q: 0.9 }, dec: 0.035, vol: 0.4 * vol });
      break;
    case 'openhat':
      nz({ filter: { type: 'highpass', freq: 6200, q: 0.9 }, dec: 0.2, vol: 0.32 * vol });
      break;
    case 'shaker':
      nz({ pink: true, filter: { type: 'bandpass', freq: 5200, q: 1.1 }, dec: 0.06, vol: 0.5 * vol });
      break;
    case 'tom':
      osc({ f0: 230, f1: 105, dec: 0.24, vol: 0.7 * vol, type: 'sine' });
      nz({ filter: { type: 'lowpass', freq: 1400, sweepTo: 400 }, dec: 0.07, vol: 0.14 * vol });
      break;
    // ── medieval percussion ───────────────────────────────────────────────
    case 'tabor':          // small snared side-drum, the dance drum of the period
      osc({ f0: 220, f1: 170, dec: 0.075, vol: 0.34 * vol, type: 'triangle' });
      nz({ filter: { type: 'bandpass', freq: 1900, q: 1.2 }, dec: 0.075, vol: 0.30 * vol });
      break;
    case 'frame':          // hand-struck frame drum / bodhrán — soft and woody
      osc({ f0: 128, f1: 78, dec: 0.24, vol: 0.72 * vol, type: 'sine' });
      nz({ filter: { type: 'lowpass', freq: 900, q: 0.7, sweepTo: 240 }, dec: 0.10, vol: 0.16 * vol });
      break;
    case 'wardrum':        // big deep nakers — felt in the chest, not the ears
      osc({ f0: 92, f1: 46, dec: 0.42, vol: 0.95 * vol, type: 'sine' });
      osc({ f0: 138, f1: 70, dec: 0.16, vol: 0.22 * vol, type: 'triangle' });
      nz({ filter: { type: 'lowpass', freq: 600, q: 0.8, sweepTo: 160 }, dec: 0.09, vol: 0.14 * vol });
      break;
    // ── orchestral percussion ─────────────────────────────────────────────
    case 'timp':           // timpani: a tuned kettle, pitch bending down as it rings
      osc({ f0: 110, f1: 82, dec: 0.9, vol: 0.9 * vol, type: 'sine' });
      osc({ f0: 165, f1: 124, dec: 0.5, vol: 0.30 * vol, type: 'sine' });
      osc({ f0: 220, f1: 168, dec: 0.28, vol: 0.14 * vol, type: 'triangle' });
      nz({ filter: { type: 'lowpass', freq: 800, q: 0.8, sweepTo: 180 }, dec: 0.12, vol: 0.16 * vol });
      break;
    case 'timphi':         // the higher of the pair, for the answering note
      osc({ f0: 165, f1: 124, dec: 0.75, vol: 0.85 * vol, type: 'sine' });
      osc({ f0: 248, f1: 186, dec: 0.4, vol: 0.26 * vol, type: 'sine' });
      nz({ filter: { type: 'lowpass', freq: 950, q: 0.8, sweepTo: 220 }, dec: 0.1, vol: 0.14 * vol });
      break;
    case 'gong':           // tam-tam: a long inharmonic wash under a big moment
      osc({ f0: 84, f1: 72, dec: 2.4, vol: 0.34 * vol, type: 'sine', atk: 0.02 });
      osc({ f0: 131, f1: 118, dec: 2.0, vol: 0.20 * vol, type: 'triangle', atk: 0.03 });
      osc({ f0: 197, f1: 174, dec: 1.6, vol: 0.13 * vol, type: 'triangle', atk: 0.04 });
      nz({ filter: { type: 'bandpass', freq: 1800, q: 0.5 }, dec: 1.8, vol: 0.16 * vol, atk: 0.05 });
      break;
    case 'drip':           // water falling somewhere in the dark
      osc({ f0: 1500, f1: 620, dec: 0.10, vol: 0.30 * vol, type: 'sine', atk: 0.002 });
      nz({ filter: { type: 'bandpass', freq: 2600, q: 5 }, dec: 0.035, vol: 0.10 * vol });
      break;
    case 'crash':
      nz({ filter: { type: 'highpass', freq: 4200, q: 0.7 }, dec: 0.75, vol: 0.3 * vol, atk: 0.004 });
      break;
    case 'click':
    default:
      nz({ filter: { type: 'bandpass', freq: 2800, q: 5 }, dec: 0.03, vol: 0.4 * vol });
      break;
  }
}

/** One pitched music note. `layer` supplies wave/filter/vibrato/detune; `dest` is the layer gain. */
/**
 * One musical note, voiced as a real instrument.
 *
 * `layer.inst` names an entry in INSTRUMENTS; the model decides the envelope and
 * timbre. Plucked strings decay whether or not the note is "held"; bowed strings
 * and pipes sustain for the written duration and release; organs stack partials;
 * bells ring on inharmonic overtones. `layer.wave` is still honoured as a plain
 * oscillator for anything that hasn't been given an instrument.
 */
function musicVoice(layer, when, note, dur, vol, dest, transpose) {
  const ctx = state.ctx;
  const inst = INSTRUMENTS[layer.inst] || null;
  const f = Math.max(8, freqOf(note, transpose));
  const amp = Math.max(0.0002, vol * (inst ? (inst.gain ?? 1) : 1));

  // Shared output gain for this note.
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.connect(dest);

  // Where the sound stops making noise, so we know when to free the nodes.
  let stopAt;

  if (!inst) {
    // ── plain oscillator (legacy layers) ────────────────────────────────────
    const osc = ctx.createOscillator();
    setWave(osc, layer.wave);
    osc.frequency.setValueAtTime(f, when);
    try { osc.detune.setValueAtTime((layer.detune || 0) + jitter(4), when); } catch (e) { /* ignore */ }
    const rel = layer.sustain ?? 0.06;
    const atk = layer.attack ?? 0.006;
    const end = when + dur;
    g.gain.linearRampToValueAtTime(amp, when + Math.min(atk, dur * 0.5));
    g.gain.setValueAtTime(amp, Math.max(when + 0.001, end - Math.min(rel, dur * 0.5)));
    g.gain.exponentialRampToValueAtTime(0.0001, end + rel);
    let node = osc;
    if (layer.filter) node = chainFilter(node, layer.filter, when, dur);
    node.connect(g);
    osc.start(when); stopAt = end + rel + 0.06; osc.stop(stopAt);
    return;
  }

  const kind = inst.kind || 'pluck';
  const sources = [];

  // ── envelope ──────────────────────────────────────────────────────────────
  if (kind === 'pluck' || kind === 'bell') {
    // Struck/plucked: ignore the written length, ring for the instrument's decay
    // (capped so a whole-note lute chord doesn't smear into the next bar).
    const decay = Math.min(inst.decay ?? 1.2, dur + (inst.decay ?? 1.2) * 0.5);
    const atk = inst.attack ?? 0.004;
    g.gain.linearRampToValueAtTime(amp, when + atk);
    // A steeper-than-exponential curve reads as a real string dying away.
    const curve = inst.curve ?? 2.2;
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const v = Math.max(0.0001, amp * Math.pow(1 - t, curve));
      g.gain.exponentialRampToValueAtTime(v, when + atk + decay * t);
    }
    stopAt = when + atk + decay + 0.05;
  } else {
    // Sustained: attack, hold at the sustain level, release after the note ends.
    const atk = inst.attack ?? 0.05;
    const rel = inst.release ?? 0.12;
    const sus = inst.sustainLevel ?? 0.88;
    const end = when + dur;
    const peak = when + Math.min(atk, dur * 0.6);
    g.gain.linearRampToValueAtTime(amp, peak);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, amp * sus), Math.min(end, peak + 0.14));
    g.gain.setValueAtTime(Math.max(0.0002, amp * sus), Math.max(when + 0.002, end));
    g.gain.exponentialRampToValueAtTime(0.0001, end + rel);
    stopAt = end + rel + 0.06;
  }

  // ── tone generation ───────────────────────────────────────────────────────
  const mix = ctx.createGain();
  mix.gain.value = 1;

  if (inst.partials) {
    // Additive: organs, choirs and bells are sums of tuned partials.
    let total = 0;
    for (const [, a] of inst.partials) total += a;
    for (const [ratio, a] of inst.partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * ratio, when);
      try { o.detune.setValueAtTime(jitter(3), when); } catch (e) { /* ignore */ }
      const pg = ctx.createGain();
      pg.gain.value = a / total;
      o.connect(pg); pg.connect(mix);
      sources.push(o);
    }
  } else {
    // Subtractive: one oscillator per string course, slightly detuned so a lute's
    // doubled strings beat against each other the way real ones do.
    //
    // `section: n` is the same idea taken to an orchestra. Sixteen violinists
    // are not one violin played louder — they are sixteen very slightly
    // different pitches, starting at very slightly different moments, spread
    // across the stage. That spread and that smear IS the sound of a section,
    // and it is the difference between "a synth pad" and "the strings came in".
    const sect = Math.max(0, inst.section || 0);
    const n = Math.max(1, sect || inst.courses || 1);
    const width = inst.width ?? (sect ? 0.55 : 0);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      setWave(o, inst.wave || 'triangle');
      const t0 = sect ? when + arng.float(0, inst.smear ?? 0.022) : when;
      o.frequency.setValueAtTime(f, t0);
      const spread = inst.spread || 0;
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * spread;
      // Players are out of tune by a few cents in BOTH directions, never evenly.
      const cents = sect ? arng.float(-(inst.detuneCents ?? 9), inst.detuneCents ?? 9) : jitter(3);
      try { o.detune.setValueAtTime(off + cents, t0); } catch (e) { /* ignore */ }
      const pg = ctx.createGain();
      // Uneven weighting: a section is not n identical players.
      pg.gain.value = (1 / n) * (sect ? arng.float(0.72, 1.28) : 1);
      o.connect(pg);
      if (width > 0 && typeof ctx.createStereoPanner === 'function') {
        const pan = ctx.createStereoPanner();
        pan.pan.value = n === 1 ? 0 : ((i / (n - 1)) * 2 - 1) * width;
        pg.connect(pan); pan.connect(mix);
      } else {
        pg.connect(mix);
      }
      o._startAt = t0;
      sources.push(o);
    }
  }

  // Breath noise for pipes — a recorder is mostly air.
  if (inst.breath) {
    const s = ctx.createBufferSource();
    s.buffer = state.noiseBuf; s.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.setValueAtTime(f * 2, when); bp.Q.value = 1.1;
    const bg = ctx.createGain(); bg.gain.value = inst.breath;
    s.connect(bp); bp.connect(bg); bg.connect(mix);
    try { s.start(when, arng.float(0, 1.5)); } catch (e) { s.start(when); }
    s.stop(stopAt);
  }

  // Pick/plectrum click: the transient that makes a pluck sound struck.
  if (inst.click) {
    const s = ctx.createBufferSource();
    s.buffer = state.noiseBuf; s.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass'; hp.frequency.setValueAtTime(Math.min(6000, f * 6), when); hp.Q.value = 0.9;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(amp * inst.click, when);
    cg.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
    s.connect(hp); hp.connect(cg); cg.connect(g);
    try { s.start(when, arng.float(0, 1.5)); } catch (e) { s.start(when); }
    s.stop(when + 0.06);
  }

  // ── filter ────────────────────────────────────────────────────────────────
  let node = mix;
  if (inst.filter) {
    const fl = { ...inst.filter };
    // Keep the filter meaningful for high notes: never cut below the fundamental.
    if (fl.freq && fl.type === 'lowpass') fl.freq = Math.max(fl.freq, f * 1.6);
    if (fl.sweepTo) fl.sweepTo = Math.max(fl.sweepTo, f * 1.05);
    node = chainFilter(node, fl, when, Math.max(0.05, stopAt - when));
  }
  node.connect(g);

  // ── vibrato ───────────────────────────────────────────────────────────────
  if (inst.vibrato) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(inst.vibrato.rate ?? 5, when);
    // Real players ease vibrato in rather than starting with it.
    const delay = inst.vibrato.delay ?? 0;
    lg.gain.setValueAtTime(0.0001, when);
    lg.gain.setValueAtTime(0.0001, when + delay);
    lg.gain.linearRampToValueAtTime(inst.vibrato.depth ?? 4, when + delay + 0.18);
    lfo.connect(lg);
    for (const o of sources) { try { lg.connect(o.detune); } catch (e) { /* ignore */ } }
    lfo.start(when); lfo.stop(stopAt);
  }

  for (const o of sources) { o.start(o._startAt || when); o.stop(stopAt); }
}

/**
 * A playing instance of one TRACKS entry. Owns a gain node (for crossfading) and
 * an index of pattern events bucketed by step, which the sequencer walks.
 */
class MusicPlayer {
  constructor(id, track, { loop = true, gain = 1, onEnd = null } = {}) {
    this.id = id;
    this.track = track;
    this.loop = loop;
    this.onEnd = onEnd;
    this.done = false;
    this.stepDur = 60 / (track.bpm || 120) / 4;              // 16th note in seconds
    this.totalSteps = (track.loopBars || 4) * SPB;
    this.transpose = (track.transpose || 0) + (track.relative ? keyTranspose(track.key) : 0);
    this.targetGain = gain * (track.gain ?? 1);

    const ctx = state.ctx;
    this.gain = ctx.createGain();
    this.gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.gain.connect(state.musicBus);

    // Per-layer gain node + a step-bucketed event index for O(1) scheduling.
    this.layers = (track.layers || []).map((L) => {
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(L.gain ?? 0.25, ctx.currentTime);
      lg.connect(this.gain);
      const byStep = new Map();
      for (const ev of (L.pattern || [])) {
        const s = ((ev[0] % this.totalSteps) + this.totalSteps) % this.totalSteps;
        if (!byStep.has(s)) byStep.set(s, []);
        byStep.get(s).push(ev);
      }
      return { def: L, node: lg, byStep };
    });

    this.startTime = ctx.currentTime + 0.06;   // small pad so the first step isn't in the past
    this.step = 0;                              // absolute step counter (grows past totalSteps)
  }

  timeOf(absStep) { return this.startTime + absStep * this.stepDur; }

  /** Schedule everything that falls before `until`. Returns false when a one-shot has finished. */
  advance(until) {
    if (this.done) return false;
    while (this.timeOf(this.step) < until) {
      if (!this.loop && this.step >= this.totalSteps) {
        this.done = true;
        if (this.onEnd) { const f = this.onEnd; this.onEnd = null; f(this.timeOf(this.step)); }
        return false;
      }
      const s = this.step % this.totalSteps;
      const when = this.timeOf(this.step);
      for (const L of this.layers) {
        const evs = L.byStep.get(s);
        if (!evs) continue;
        for (const ev of evs) {
          const dur = Math.max(0.02, (ev[2] || 1) * this.stepDur * 0.94); // 6% gap = articulation
          const vol = (ev[3] == null ? 1 : ev[3]);
          if (L.def.wave === 'noise') drumVoice(String(ev[1]), when, vol, L.node);
          else musicVoice(L.def, when, ev[1], dur, vol, L.node, this.transpose);
        }
      }
      this.step++;
    }
    return true;
  }

  fadeIn(dur) { setGain(this.gain, this.targetGain, now(), dur); }

  /** Ramp to silence and disconnect after the ramp. Safe to call twice. */
  fadeOut(dur, thenRemove = true) {
    if (this.stopping) return;
    this.stopping = true;
    const t = now();
    setGain(this.gain, 0, t, dur);
    this.done = true;
    if (thenRemove) {
      setTimeout(() => {
        try { this.gain.disconnect(); } catch (e) { /* ignore */ }
        const i = state.players.indexOf(this);
        if (i >= 0) state.players.splice(i, 1);
        if (!state.players.length) stopScheduler();
      }, dur * 1000 + 120);
    }
  }
}

function startScheduler() {
  if (state.timer != null || !state.ok) return;
  state.timer = setInterval(() => {
    if (!state.ok) return;
    const until = now() + SCHEDULE_AHEAD;
    for (const p of state.players.slice()) p.advance(until);
  }, LOOKAHEAD_MS);
}

function stopScheduler() {
  if (state.timer != null) { clearInterval(state.timer); state.timer = null; }
}

/** Fade every live player out and forget the current track id. */
function stopMusic(fade = CROSSFADE) {
  for (const p of state.players.slice()) p.fadeOut(fade);
  state.currentId = null;
}

function startTrack(id, { loop = true, fade = CROSSFADE, onEnd = null } = {}) {
  const track = TRACKS[id];
  if (!track) return null;
  const p = new MusicPlayer(id, track, { loop, onEnd });
  state.players.push(p);
  p.advance(now() + SCHEDULE_AHEAD);
  p.fadeIn(fade);
  startScheduler();
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Friendly aliases so callers can use the vocabulary that reads best at the call site. */
const SFX_ALIAS = {
  confirm: 'select', accept: 'select', cancel: 'back', menu: 'open', close_menu: 'close',
  crit: 'hitcrit', critical: 'hitcrit', footstep: 'footstep-grass', walk: 'step',
  gold: 'coin', gp: 'coin', pickup: 'item', loot: 'chest', drink: 'potion',
  d20: 'dice', roll: 'dice', ambush: 'encounter', win: 'victory', lose: 'defeat',
  ko: 'death', bless: 'buff', curse: 'debuff', lightning: 'thunder', frost: 'ice',
  burn: 'fire', cast: 'spell', bow: 'arrow', sword: 'slash', push: 'shove',
};

const _warned = new Set();

export const Audio = {
  /** Must be called from a user gesture (click / keypress) — browsers block audio otherwise. */
  init() {
    const ok = ensure();
    if (ok) { resume(); flushPendingSoon(); }
    return ok;
  },

  /** True once a usable AudioContext exists and is running. */
  get ready() { return !!state.ok && state.ctx.state === 'running'; },
  get available() { return !state.dead; },
  get ctx() { return state.ctx; },

  /**
   * Play a procedural sound effect.
   * @param {string} name  see SFX above (aliases accepted)
   * @param {object} opts  { vol=1 multiplier, pan=-1..1, pitch=semitones, delay=seconds, force }
   */
  sfx(name, opts = {}) {
    if (state.muted || !name) return false;
    if (!ensure()) return false;
    resume();
    let key = String(name);
    if (!SFX[key] && SFX_ALIAS[key]) key = SFX_ALIAS[key];
    const fn = SFX[key];
    if (!fn) {
      if (!_warned.has(key)) { _warned.add(key); try { console.warn('[audio] unknown sfx:', name); } catch (e) { /* ignore */ } }
      return false;
    }
    // Anti machine-gun: identical rapid triggers are dropped rather than stacked.
    const t = now();
    const gap = THROTTLE[key];
    if (gap && !opts.force && (t - (state.lastAt[key] || -99)) < gap) return false;
    state.lastAt[key] = t;
    if (!claimVoice(0.5)) return false;

    const A = {
      g: opts.vol == null ? 1 : Math.max(0, opts.vol),
      pan: opts.pan,
      d: Math.max(0, opts.delay || 0),
      pm: Math.pow(2, (opts.pitch || 0) / 12),
    };
    try { fn(A); } catch (e) { /* never let a sound crash a frame */ return false; }
    return true;
  },

  /**
   * Start a looping procedural track, crossfading from whatever is playing.
   * Pass null/'' to fade the music out. Re-requesting the current track is a no-op.
   */
  music(trackId, opts = {}) {
    const fade = opts.fade ?? CROSSFADE;
    if (!trackId) {
      state.pendingId = null;
      state.fanfareResume = null;
      if (state.ok) stopMusic(fade);
      return;
    }
    if (!TRACKS[trackId]) {
      if (!_warned.has('trk:' + trackId)) { _warned.add('trk:' + trackId); try { console.warn('[audio] unknown track:', trackId); } catch (e) { /* ignore */ } }
      return;
    }
    // Remember the request even if audio can't start yet, so init() can honour it.
    state.pendingId = trackId;
    whenRunning(() => {
      if (state.pendingId !== trackId) return;              // superseded while the context was suspended
      if (state.currentId === trackId && state.players.some((p) => p.id === trackId && !p.stopping)) return;
      state.fanfareResume = null;
      for (const p of state.players.slice()) p.fadeOut(fade);
      state.currentId = trackId;
      startTrack(trackId, { loop: true, fade });
    });
  },

  /** Currently playing (or queued) loop id, or null. */
  get playing() { return state.currentId || state.pendingId || null; },
  get tracks() { return Object.keys(TRACKS); },
  get sounds() { return Object.keys(SFX); },
  hasTrack(id) { return !!TRACKS[id]; },
  hasSfx(name) { return !!(SFX[name] || SFX[SFX_ALIAS[name]]); },

  /**
   * Play `trackId` once (e.g. 'victory') and then return to the loop that was
   * playing before. Used by the battle-won / level-up flow.
   */
  fanfare(trackId, opts = {}) {
    const track = TRACKS[trackId];
    if (!track) return;
    const resumeId = state.fanfareResume || state.currentId || state.pendingId || null;
    whenRunning(() => {
      state.fanfareResume = (resumeId === trackId) ? null : resumeId;
      for (const p of state.players.slice()) p.fadeOut(opts.fadeOut ?? 0.25);
      state.currentId = trackId;
      state.pendingId = trackId;
      startTrack(trackId, {
        loop: false,
        fade: opts.fade ?? 0.05,
        onEnd: (endTime) => {
          // Give the last notes their release tail, then restore the previous loop.
          const wait = Math.max(0, (endTime - now())) * 1000 + 350;
          setTimeout(() => {
            const back = state.fanfareResume;
            state.fanfareResume = null;
            if (state.currentId === trackId) {
              state.currentId = null; state.pendingId = null;
              if (back) Audio.music(back, { fade: 0.5 });
              else stopMusic(0.4);
            }
          }, wait);
        },
      });
    });
  },

  /**
   * Temporarily pull the music down so a stinger or dialogue can cut through.
   * @param {number} amount 0..1 (1 = full silence)  @param {number} dur seconds at the low level
   */
  duck(amount = 0.6, dur = 0.8) {
    if (!state.ok || !state.duckGain) return;
    const a = Math.max(0, Math.min(1, amount));
    const t = now();
    const g = state.duckGain.gain;
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(Math.max(0.0001, 1 - a), t + 0.08);
      g.setValueAtTime(Math.max(0.0001, 1 - a), t + 0.08 + Math.max(0, dur));
      g.linearRampToValueAtTime(1, t + 0.08 + Math.max(0, dur) + 0.45);
    } catch (e) { /* ignore */ }
    state.duckUntil = t + dur + 0.5;
  },

  /**
   * Set any subset of the three volumes (0..1). Undefined/null values are left alone.
   * Mirrors Save.settings.{volMaster,volMusic,volSfx}.
   */
  setVolume(master, music, sfx) {
    if (master != null) state.vol.master = clamp01(master);
    if (music != null) state.vol.music = clamp01(music);
    if (sfx != null) state.vol.sfx = clamp01(sfx);
    applyVolumes(0.08);
    return { ...state.vol };
  },
  getVolume() { return { ...state.vol }; },

  /** Global mute. Reads/writes as a plain boolean property. */
  get muted() { return state.muted; },
  set muted(v) { state.muted = !!v; applyVolumes(0.08); },
  toggleMute() { this.muted = !state.muted; return state.muted; },

  /** Suspend/resume the whole context (used when the tab loses focus). */
  pause() { if (state.ok) { try { state.ctx.suspend(); } catch (e) { /* ignore */ } } },
  unpause() { resume(); },

  /** Hard stop: kill music and forget queued requests. SFX tails are left to decay. */
  stopAll() {
    state.pendingId = null; state.fanfareResume = null;
    if (state.ok) stopMusic(0.15);
    stopScheduler();
  },

  // Exposed builders so other modules (spell VFX, monster cries) can compose one-offs.
  tone, noise, chord, arp,
  TRACKS, TRACK_GROUPS, INSTRUMENTS, trackForBiome,

  /** Wet/dry balance of the music reverb, 0 = dry closet, 1 = cathedral. */
  setReverb(amount = 0.34) {
    if (!state.ok || !state.musicWet) return;
    const a = clamp01(amount);
    try {
      state.musicWet.gain.setTargetAtTime(a * 0.55, state.ctx.currentTime, 0.05);
      state.musicDry.gain.setTargetAtTime(1 - a * 0.35, state.ctx.currentTime, 0.05);
    } catch (e) { /* ignore */ }
  },
};

function clamp01(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }

/** After init() the context may need a tick before it reports 'running'. */
function flushPendingSoon() {
  if (!state.ok) return;
  if (state.ctx.state === 'running') { flushPending(); return; }
  setTimeout(() => { if (state.ok && state.ctx.state === 'running') flushPending(); }, 120);
}

export default Audio;
