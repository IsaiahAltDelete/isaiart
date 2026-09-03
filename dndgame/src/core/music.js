// core/music.js — the score for Sword Coast Chronicles.
//
// This is deliberately NOT chiptune. A Realms tavern in 1496 DR has a lute, a
// recorder, a bowed vielle and a tabor, so the synth models those instead of
// NES pulse waves: plucked strings with real decay envelopes and doubled
// courses, bowed strings with slow attack and vibrato, reed pipes with breath
// noise, and a portative organ built from stacked partials. Everything runs
// through a stone-hall reverb in audio.js, which is most of what stops a
// synthesised loop sounding harsh.
//
// The writing is modal, as period music is: Dorian, Aeolian, Mixolydian and
// Phrygian rather than functional major/minor. Cadences fall bVII–I or iv–i, not
// V–I; open fifths and parallel motion are correct here, not mistakes.
//
// Pattern entry: [step, note, durSteps, vol]. One step = a 16th, 16 steps = a bar.
// `note` is a MIDI number (from the degree helpers) or a drum id on noise layers.

export const SPB = 16;

// ── note helpers (local copies so this module has no import cycle) ───────────

const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function noteToMidi(name) {
  const m = /^([a-gA-G])([#b+\-s]*)(-?\d)$/.exec(String(name).trim());
  if (!m) return NaN;
  let n = SEMI[m[1].toLowerCase()];
  for (const c of m[2]) n += (c === '#' || c === 's' || c === '+') ? 1 : -1;
  return (parseInt(m[3], 10) + 1) * 12 + n;
}

/** Church modes as semitone offsets from the tonic. */
export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  // Not a church mode, but the raised-4th sound of eastern-Faerûnian tunes.
  hijaz: [0, 1, 4, 5, 7, 8, 10],
};

/**
 * Scale degree -> MIDI. `d` is 1-based and may run past 7 or below 1, wrapping
 * into the octave above/below, so a melody can climb without bookkeeping.
 */
export function deg(root, mode, d) {
  const steps = MODES[mode] || MODES.aeolian;
  const n = steps.length;
  const i = Math.round(d) - 1;
  const oct = Math.floor(i / n);
  const within = ((i % n) + n) % n;
  return root + steps[within] + oct * 12;
}

/**
 * Write a melody in scale degrees.
 *   tune(root, 'dorian', 0, [[1,4],[3,2],[null,2],[5,4]])
 * pairs are [degree|null, durSteps, vol?]; null is a rest. Degrees may be
 * fractional-free integers, or a string note name for an accidental.
 */
export function tune(root, mode, start, pairs, vol = 1) {
  const out = [];
  let s = start;
  for (const [d, dur, v] of pairs) {
    if (d != null) {
      const note = typeof d === 'string' ? noteToMidi(d) : deg(root, mode, d);
      out.push([s, note, dur, v ?? vol]);
    }
    s += dur;
  }
  return out;
}

/** Repeat a degree-written figure across `count` bars, optionally transposing per bar. */
export function rep(count, root, mode, fig, { every = SPB, shift = null, vol = 1 } = {}) {
  const out = [];
  for (let b = 0; b < count; b++) {
    const r = root + (shift ? shift[b % shift.length] : 0);
    for (const [st, d, dur, v] of fig) {
      if (d == null) continue;
      const note = typeof d === 'string' ? noteToMidi(d) : deg(r, mode, d);
      out.push([b * every + st, note, dur ?? 1, (v ?? 1) * vol]);
    }
  }
  return out;
}

/** A sustained open-fifth drone: the bagpipe/hurdy-gurdy bed under most of this. */
export function drone(root, bars, { fifth = true, octave = false, dur = SPB, vol = 1 } = {}) {
  const out = [];
  for (let b = 0; b < bars; b++) {
    const s = b * SPB;
    out.push([s, root, dur, vol]);
    if (fifth) out.push([s, root + 7, dur, vol * 0.8]);
    if (octave) out.push([s, root + 12, dur, vol * 0.5]);
  }
  return out;
}

/** Broken-chord accompaniment in a mode — the lute's default job. */
export function pluckFig(root, mode, bars, degrees, { pattern = [0, 4, 8, 12], dur = 3, vol = 0.9, shift = null } = {}) {
  const out = [];
  for (let b = 0; b < bars; b++) {
    const r = root + (shift ? shift[b % shift.length] : 0);
    pattern.forEach((st, i) => {
      const d = degrees[i % degrees.length];
      out.push([b * SPB + st, deg(r, mode, d), dur, vol]);
    });
  }
  return out;
}

/** Drum hits at the given absolute steps. */
export function hits(steps, name, vol = 1, dur = 1) { return steps.map((s) => [s, name, dur, vol]); }

/** Drum hits at per-bar offsets, repeated over `count` bars. */
export function beat(count, offsets, name, vol = 1) {
  const out = [];
  for (let b = 0; b < count; b++) for (const s of offsets) out.push([b * SPB + s, name, 1, vol]);
  return out;
}

// Convenient roots.
const C3 = 48, D3 = 50, E3 = 52, F3 = 53, G3 = 55, A3 = 57, Bb3 = 58, B3 = 59;
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69;

// ─────────────────────────────────────────────────────────────────────────────
// INSTRUMENTS — how each voice is actually built. audio.js reads these.
//
//   kind:'pluck'  string attacked and left to ring (lute, harp, psaltery)
//   kind:'bow'    sustained with slow attack and vibrato (vielle, rebec)
//   kind:'wind'   breathy pipe (recorder, flute, shawm, crumhorn)
//   kind:'organ'  additive partials, sustained (portative organ, choir)
//   kind:'drone'  never decays while held (bagpipe, hurdy-gurdy)
//   kind:'bell'   inharmonic partials, very long decay
// ─────────────────────────────────────────────────────────────────────────────

export const INSTRUMENTS = {
  // --- plucked strings ------------------------------------------------------
  lute: {
    kind: 'pluck', wave: 'triangle', courses: 2, spread: 7,
    attack: 0.004, decay: 1.15, curve: 2.4,
    filter: { type: 'lowpass', freq: 2600, q: 0.8, sweepTo: 620, sweepDur: 0.8 },
    click: 0.05, gain: 1,
  },
  gittern: {                       // brighter, wire-strung cousin of the lute
    kind: 'pluck', wave: 'sawtooth', courses: 2, spread: 10,
    attack: 0.003, decay: 0.75, curve: 2.8,
    filter: { type: 'lowpass', freq: 3000, q: 1.1, sweepTo: 800, sweepDur: 0.5 },
    click: 0.08, gain: 0.8,
  },
  harp: {
    kind: 'pluck', wave: 'triangle', courses: 1,
    attack: 0.005, decay: 2.2, curve: 1.9,
    filter: { type: 'lowpass', freq: 3400, q: 0.6, sweepTo: 900, sweepDur: 1.6 },
    click: 0.03, gain: 0.95,
  },
  psaltery: {                      // struck/plucked box zither — glassy and short
    kind: 'pluck', wave: 'triangle', courses: 3, spread: 14,
    attack: 0.002, decay: 0.9, curve: 3.2,
    filter: { type: 'bandpass', freq: 1900, q: 1.4 },
    click: 0.10, gain: 0.7,
  },
  citole: {
    kind: 'pluck', wave: 'square', courses: 2, spread: 6,
    attack: 0.003, decay: 0.6, curve: 3.0,
    filter: { type: 'lowpass', freq: 2200, q: 1.4, sweepTo: 700, sweepDur: 0.4 },
    click: 0.07, gain: 0.55,
  },

  // --- bowed strings --------------------------------------------------------
  vielle: {
    kind: 'bow', wave: 'sawtooth', courses: 2, spread: 5,
    attack: 0.085, release: 0.14, sustainLevel: 0.85,
    filter: { type: 'lowpass', freq: 1750, q: 1.6 },
    vibrato: { rate: 5.2, depth: 4.5, delay: 0.22 },
    gain: 0.62,
  },
  rebec: {
    kind: 'bow', wave: 'sawtooth', courses: 1,
    attack: 0.06, release: 0.10, sustainLevel: 0.8,
    filter: { type: 'lowpass', freq: 2300, q: 2.0 },
    vibrato: { rate: 6.0, depth: 6, delay: 0.18 },
    gain: 0.5,
  },
  viol: {                          // low bowed bass — the floor of a consort
    kind: 'bow', wave: 'sawtooth', courses: 2, spread: 4,
    attack: 0.11, release: 0.18, sustainLevel: 0.9,
    filter: { type: 'lowpass', freq: 900, q: 1.2 },
    vibrato: { rate: 4.4, depth: 3, delay: 0.3 },
    gain: 0.7,
  },

  // --- wind -----------------------------------------------------------------
  recorder: {
    kind: 'wind', wave: 'triangle', attack: 0.045, release: 0.09, sustainLevel: 0.9,
    breath: 0.055, filter: { type: 'lowpass', freq: 2300, q: 1.0 },
    vibrato: { rate: 5.0, depth: 3.2, delay: 0.28 }, gain: 0.6,
  },
  flute: {
    kind: 'wind', wave: 'sine', attack: 0.07, release: 0.12, sustainLevel: 0.9,
    breath: 0.10, filter: { type: 'lowpass', freq: 2800, q: 0.8 },
    vibrato: { rate: 4.6, depth: 4, delay: 0.3 }, gain: 0.65,
  },
  shawm: {                         // loud double reed — the medieval outdoor horn
    kind: 'wind', wave: 'pulse18', attack: 0.028, release: 0.07, sustainLevel: 0.88,
    breath: 0.035, filter: { type: 'bandpass', freq: 1250, q: 2.2 },
    vibrato: { rate: 5.6, depth: 5, delay: 0.2 }, gain: 0.42,
  },
  crumhorn: {                      // capped reed — buzzy, nasal, comic and menacing
    kind: 'wind', wave: 'pulse12', attack: 0.02, release: 0.06, sustainLevel: 0.9,
    breath: 0.02, filter: { type: 'lowpass', freq: 1050, q: 3.0 },
    vibrato: { rate: 6.4, depth: 3, delay: 0.15 }, gain: 0.34,
  },
  horn: {                          // hunting/war horn
    kind: 'wind', wave: 'triangle', attack: 0.05, release: 0.2, sustainLevel: 0.85,
    breath: 0.03, filter: { type: 'lowpass', freq: 1400, q: 1.4 },
    vibrato: { rate: 4.2, depth: 3, delay: 0.35 }, gain: 0.6,
  },

  // --- the orchestra --------------------------------------------------------
  //
  // The consort above is a handful of players in a room, which is right for a
  // tavern and thin for a dragon. These are SECTIONS: `section: n` voices the
  // note n times, each a few cents out, each starting a few milliseconds late,
  // each panned to its own seat. That smear is the entire difference between a
  // synth pad and "the strings came in" — sixteen violinists are not one violin
  // played louder.
  //
  // `wave` here names a harmonic spectrum in audio.js rather than an oscillator
  // shape, so a horn is built from a horn's actual overtone recipe.

  strings: {                       // violins I+II together — the main singing line
    kind: 'bow', wave: 'violin', section: 7, detuneCents: 9, smear: 0.03, width: 0.62,
    attack: 0.16, release: 0.34, sustainLevel: 0.92,
    filter: { type: 'lowpass', freq: 3600, q: 0.7 },
    vibrato: { rate: 5.4, depth: 5, delay: 0.35 }, gain: 0.5,
  },
  stringsHigh: {                   // violins alone, up in the light
    kind: 'bow', wave: 'violin', section: 6, detuneCents: 7, smear: 0.024, width: 0.7,
    attack: 0.13, release: 0.28, sustainLevel: 0.9,
    filter: { type: 'lowpass', freq: 4800, q: 0.6 },
    vibrato: { rate: 5.8, depth: 6, delay: 0.3 }, gain: 0.4,
  },
  violas: {
    kind: 'bow', wave: 'viola', section: 5, detuneCents: 10, smear: 0.03, width: 0.4,
    attack: 0.17, release: 0.32, sustainLevel: 0.9,
    filter: { type: 'lowpass', freq: 2400, q: 0.9 },
    vibrato: { rate: 5.0, depth: 4, delay: 0.36 }, gain: 0.44,
  },
  celli: {
    kind: 'bow', wave: 'cello', section: 5, detuneCents: 8, smear: 0.032, width: 0.34,
    attack: 0.19, release: 0.4, sustainLevel: 0.92,
    filter: { type: 'lowpass', freq: 1500, q: 0.9 },
    vibrato: { rate: 4.6, depth: 4, delay: 0.4 }, gain: 0.56,
  },
  basses: {                        // the floor everything else stands on
    kind: 'bow', wave: 'contrabass', section: 4, detuneCents: 7, smear: 0.036, width: 0.24,
    attack: 0.22, release: 0.45, sustainLevel: 0.94,
    filter: { type: 'lowpass', freq: 700, q: 0.8 },
    vibrato: { rate: 4.0, depth: 3, delay: 0.5 }, gain: 0.62,
  },
  pizzicato: {                     // the same players, plucking
    kind: 'pluck', wave: 'cello', section: 4, detuneCents: 8, smear: 0.014, width: 0.4,
    attack: 0.003, decay: 0.5, curve: 3.0,
    filter: { type: 'lowpass', freq: 2600, q: 1.0, sweepTo: 700, sweepDur: 0.35 },
    click: 0.06, gain: 0.5,
  },

  horns: {                         // the heroic sound: four horns in unison
    kind: 'bow', wave: 'horn', section: 4, detuneCents: 6, smear: 0.026, width: 0.36,
    attack: 0.10, release: 0.3, sustainLevel: 0.9,
    filter: { type: 'lowpass', freq: 1900, q: 0.9 },
    vibrato: { rate: 4.4, depth: 2.5, delay: 0.45 }, gain: 0.55,
  },
  trumpets: {
    kind: 'bow', wave: 'trumpet', section: 3, detuneCents: 5, smear: 0.016, width: 0.3,
    attack: 0.045, release: 0.2, sustainLevel: 0.9,
    filter: { type: 'lowpass', freq: 3400, q: 1.0 },
    vibrato: { rate: 5.2, depth: 3, delay: 0.4 }, gain: 0.36,
  },
  trombones: {
    kind: 'bow', wave: 'trombone', section: 3, detuneCents: 6, smear: 0.022, width: 0.3,
    attack: 0.07, release: 0.26, sustainLevel: 0.92,
    filter: { type: 'lowpass', freq: 2000, q: 0.9 },
    gain: 0.46,
  },
  tuba: {
    kind: 'bow', wave: 'tuba', section: 2, detuneCents: 5, smear: 0.03, width: 0.2,
    attack: 0.11, release: 0.34, sustainLevel: 0.94,
    filter: { type: 'lowpass', freq: 620, q: 0.8 }, gain: 0.6,
  },

  oboeSolo: {                      // one player: no section, no smear
    kind: 'wind', wave: 'oboe', attack: 0.055, release: 0.13, sustainLevel: 0.9,
    breath: 0.03, filter: { type: 'lowpass', freq: 3000, q: 1.1 },
    vibrato: { rate: 5.5, depth: 5, delay: 0.25 }, gain: 0.34,
  },
  clarinetSolo: {
    kind: 'wind', wave: 'clarinet', attack: 0.05, release: 0.14, sustainLevel: 0.92,
    breath: 0.035, filter: { type: 'lowpass', freq: 2600, q: 0.9 },
    vibrato: { rate: 4.8, depth: 3, delay: 0.3 }, gain: 0.38,
  },
  bassoonSolo: {
    kind: 'wind', wave: 'bassoon', attack: 0.06, release: 0.16, sustainLevel: 0.9,
    breath: 0.03, filter: { type: 'lowpass', freq: 1400, q: 1.0 },
    vibrato: { rate: 4.4, depth: 3, delay: 0.35 }, gain: 0.42,
  },
  fluteSolo: {
    kind: 'wind', wave: 'flute', attack: 0.075, release: 0.15, sustainLevel: 0.9,
    breath: 0.11, filter: { type: 'lowpass', freq: 3400, q: 0.7 },
    vibrato: { rate: 5.0, depth: 4.5, delay: 0.3 }, gain: 0.5,
  },
  woodwinds: {                     // flutes and clarinets doubling, as a pad
    kind: 'wind', wave: 'clarinet', section: 4, detuneCents: 7, smear: 0.028, width: 0.5,
    attack: 0.09, release: 0.2, sustainLevel: 0.9,
    breath: 0.05, filter: { type: 'lowpass', freq: 2800, q: 0.8 },
    vibrato: { rate: 4.9, depth: 3, delay: 0.34 }, gain: 0.34,
  },

  // --- sustained beds -------------------------------------------------------
  organetto: {                     // portative organ: stacked partials, no vibrato
    kind: 'organ', partials: [[1, 1], [2, 0.5], [3, 0.28], [4, 0.16], [6, 0.08]],
    attack: 0.05, release: 0.16, sustainLevel: 0.9,
    filter: { type: 'lowpass', freq: 2400, q: 0.7 }, gain: 0.34,
  },
  choir: {
    kind: 'organ', partials: [[1, 1], [2, 0.32], [3, 0.14], [5, 0.05]],
    attack: 0.28, release: 0.5, sustainLevel: 0.85,
    filter: { type: 'lowpass', freq: 1500, q: 0.8 },
    vibrato: { rate: 4.0, depth: 3, delay: 0.5 }, gain: 0.3,
  },
  bagpipe: {
    kind: 'drone', wave: 'sawtooth', courses: 2, spread: 9,
    attack: 0.12, release: 0.3,
    filter: { type: 'bandpass', freq: 900, q: 1.6 }, gain: 0.3,
  },
  hurdygurdy: {
    kind: 'drone', wave: 'sawtooth', courses: 3, spread: 12,
    attack: 0.09, release: 0.25,
    filter: { type: 'lowpass', freq: 1200, q: 2.2 },
    vibrato: { rate: 7.5, depth: 2.5, delay: 0 }, gain: 0.26,
  },
  pad: {                           // low sustained fifth, felt more than heard
    kind: 'organ', partials: [[1, 1], [2, 0.22], [3, 0.07]],
    attack: 0.6, release: 0.9, sustainLevel: 0.8,
    filter: { type: 'lowpass', freq: 700, q: 0.7 }, gain: 0.34,
  },

  // --- struck ---------------------------------------------------------------
  bell: {
    kind: 'bell', partials: [[1, 1], [2.76, 0.5], [5.4, 0.28], [8.9, 0.12]],
    attack: 0.004, decay: 3.0, curve: 1.6,
    filter: { type: 'lowpass', freq: 4200, q: 0.6 }, gain: 0.24,
  },
  chime: {
    kind: 'bell', partials: [[1, 1], [3.0, 0.4], [6.1, 0.16]],
    attack: 0.003, decay: 1.5, curve: 2.2,
    filter: { type: 'highpass', freq: 500, q: 0.7 }, gain: 0.2,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TRACKS
// ─────────────────────────────────────────────────────────────────────────────

export const TRACKS = {

  // ── TITLE — "The Sword Coast" ─────────────────────────────────────────────
  // A slow Aeolian ballad for solo vielle over a lute. Noble, cold, a little sad:
  // the sound of the North before you have done anything worth singing about.
  title: {
    bpm: 66, loopBars: 8, gain: 0.92,
    layers: [
      { name: 'melody', inst: 'vielle', gain: 0.34, pattern: [
        ...tune(A3 + 12, 'aeolian', 0, [
          [1, 6], [2, 2], [3, 4], [2, 4],
          [1, 6], [7 - 7, 2], [1, 8],
          [3, 4], [4, 4], [5, 6], [4, 2],
          [3, 8], [null, 8],
          [5, 6], [6, 2], [5, 4], [4, 4],
          [3, 6], [2, 2], [1, 8],
          [1, 4], [2, 4], [3, 4], [2, 4],
          [1, 12], [null, 4],
        ]),
      ] },
      { name: 'lute', inst: 'lute', gain: 0.30, pattern: [
        ...pluckFig(A3, 'aeolian', 8, [1, 5, 8, 5], { pattern: [0, 4, 8, 12], dur: 4, vol: 0.75,
          shift: [0, 0, -4, -4, 3, 3, 0, 0] }),
      ] },
      { name: 'bass', inst: 'viol', gain: 0.30, pattern: [
        ...drone(A3 - 12, 2, { dur: SPB, vol: 0.8 }),
        ...drone(A3 - 12 - 4, 2, { dur: SPB, vol: 0.8 }).map(([s, n, d, v]) => [s + 32, n, d, v]),
        ...drone(A3 - 12 + 3, 2, { dur: SPB, vol: 0.8 }).map(([s, n, d, v]) => [s + 64, n, d, v]),
        ...drone(A3 - 12, 2, { dur: SPB, vol: 0.8 }).map(([s, n, d, v]) => [s + 96, n, d, v]),
      ] },
      { name: 'perc', wave: 'noise', gain: 0.16,
        pattern: beat(8, [0], 'frame', 0.34).concat(beat(8, [10], 'frame', 0.16)) },
    ],
  },

  // ── TOWN — "Phandalin Market" ─────────────────────────────────────────────
  // A ductia: bright Mixolydian dance tune on recorder and lute over a tabor.
  // Busy, friendly, slightly rustic — a frontier town having a good morning.
  town: {
    bpm: 112, loopBars: 8, gain: 0.9,
    layers: [
      { name: 'melody', inst: 'recorder', gain: 0.30, pattern: [
        ...tune(G4, 'mixolydian', 0, [
          [1, 2], [2, 2], [3, 2], [1, 2], [5, 4], [3, 4],
          [4, 2], [3, 2], [2, 2], [1, 2], [2, 4], [null, 4],
          [3, 2], [4, 2], [5, 2], [6, 2], [5, 4], [3, 4],
          [2, 2], [1, 2], [7 - 7, 4], [1, 8],
          [5, 2], [6, 2], [7, 2], [8, 2], [7, 4], [5, 4],
          [6, 2], [5, 2], [4, 2], [3, 2], [4, 4], [null, 4],
          [3, 2], [2, 2], [1, 2], [2, 2], [3, 4], [2, 4],
          [1, 8], [null, 8],
        ]),
      ] },
      { name: 'lute', inst: 'lute', gain: 0.26, pattern: [
        ...pluckFig(G3, 'mixolydian', 8, [1, 5, 8, 5], { pattern: [0, 3, 6, 10], dur: 3, vol: 0.7,
          shift: [0, 0, 5, 5, -2, -2, 0, 0] }),
      ] },
      { name: 'bass', inst: 'gittern', gain: 0.26, pattern: [
        ...rep(8, G3 - 12, 'mixolydian', [[0, 1, 4, 0.9], [8, 5, 4, 0.7], [12, 1, 2, 0.5]],
          { shift: [0, 0, 5, 5, -2, -2, 0, 0] }),
      ] },
      { name: 'perc', wave: 'noise', gain: 0.22,
        pattern: beat(8, [0, 8], 'tabor', 0.5)
          .concat(beat(8, [4, 12], 'tabor', 0.22), beat(8, [6, 14], 'shaker', 0.14)) },
    ],
  },

  // ── FIELD — "The Triboar Trail" ───────────────────────────────────────────
  // An estampie: the walking tune. Dorian, insistent, built to loop for an hour
  // while you cross the moors without wearing out its welcome.
  field: {
    bpm: 104, loopBars: 8, gain: 0.86,
    layers: [
      { name: 'melody', inst: 'vielle', gain: 0.28, pattern: [
        ...tune(D4, 'dorian', 0, [
          [1, 4], [3, 2], [2, 2], [1, 4], [5, 4],
          [4, 4], [3, 2], [2, 2], [1, 8],
          [5, 4], [6, 2], [5, 2], [4, 4], [3, 4],
          [2, 4], [1, 4], [2, 8],
          [1, 4], [3, 2], [4, 2], [5, 4], [6, 4],
          [5, 4], [4, 2], [3, 2], [2, 8],
          [3, 4], [2, 4], [1, 4], [7 - 7, 4],
          [1, 12], [null, 4],
        ]),
      ] },
      { name: 'pipe', inst: 'recorder', gain: 0.16, pattern: [
        ...rep(8, D4 + 12, 'dorian', [[8, 1, 2, 0.5], [12, 5, 2, 0.4]], { shift: [0, 0, 0, 0, 5, 5, -2, 0] }),
      ] },
      { name: 'lute', inst: 'lute', gain: 0.26, pattern: [
        ...pluckFig(D3, 'dorian', 8, [1, 5, 8, 5], { pattern: [0, 4, 8, 12], dur: 3, vol: 0.7,
          shift: [0, 0, 0, 0, 5, 5, -2, 0] }),
      ] },
      { name: 'drone', inst: 'bagpipe', gain: 0.16, pattern: drone(D3 - 12, 8, { dur: SPB, vol: 0.55 }) },
      { name: 'perc', wave: 'noise', gain: 0.24,
        pattern: beat(8, [0, 6, 8, 14], 'tabor', 0.42).concat(beat(8, [4, 12], 'frame', 0.2)) },
    ],
  },

  // ── BATTLE ────────────────────────────────────────────────────────────────
  // Dorian, driving, shawm-led. Fast enough to push a turn along without turning
  // into a chiptune siren.
  battle: {
    bpm: 148, loopBars: 4, gain: 0.9,
    layers: [
      { name: 'lead', inst: 'shawm', gain: 0.30, pattern: [
        ...tune(D4, 'dorian', 0, [
          [1, 2], [1, 2], [3, 2], [2, 2], [1, 4], [5, 4],
          [4, 2], [3, 2], [2, 2], [1, 2], [7 - 7, 4], [1, 4],
          [5, 2], [5, 2], [6, 2], [5, 2], [4, 4], [3, 4],
          [2, 2], [1, 2], [2, 2], [3, 2], [1, 8],
        ]),
      ] },
      { name: 'gittern', inst: 'gittern', gain: 0.24, pattern: [
        ...rep(4, D3, 'dorian', [[0, 1, 2, 0.9], [2, 1, 2, 0.4], [4, 5, 2, 0.7],
          [6, 1, 2, 0.4], [8, 1, 2, 0.85], [10, 1, 2, 0.4], [12, 5, 2, 0.7], [14, 8, 2, 0.5]],
          { shift: [0, 0, -2, 3] }),
      ] },
      { name: 'bass', inst: 'viol', gain: 0.32, pattern: [
        ...rep(4, D3 - 12, 'dorian', [[0, 1, 6, 0.95], [8, 1, 4, 0.8], [12, 5, 4, 0.7]],
          { shift: [0, 0, -2, 3] }),
      ] },
      { name: 'perc', wave: 'noise', gain: 0.30,
        pattern: beat(4, [0, 8], 'wardrum', 0.6)
          .concat(beat(4, [4, 12], 'tabor', 0.4), beat(4, [2, 6, 10, 14], 'shaker', 0.14)) },
    ],
  },

  // ── BOSS ──────────────────────────────────────────────────────────────────
  // Phrygian — that flat second is the oldest "something is very wrong" sound in
  // European music. Organ, crumhorn and war drums.
  boss: {
    bpm: 132, loopBars: 4, gain: 0.92,
    layers: [
      { name: 'organ', inst: 'organetto', gain: 0.26, pattern: [
        ...rep(4, E3, 'phrygian', [[0, 1, 8, 0.9], [8, 2, 4, 0.7], [12, 1, 4, 0.8]],
          { shift: [0, 0, 5, 0] }),
      ] },
      { name: 'reed', inst: 'crumhorn', gain: 0.28, pattern: [
        ...tune(E4, 'phrygian', 0, [
          [1, 4], [2, 2], [1, 2], [7 - 7, 4], [1, 4],
          [5, 4], [4, 2], [3, 2], [2, 4], [1, 4],
          [1, 2], [2, 2], [3, 2], [4, 2], [5, 8],
          [4, 4], [3, 4], [2, 4], [1, 4],
        ]),
      ] },
      { name: 'bass', inst: 'viol', gain: 0.34, pattern: [
        ...rep(4, E3 - 12, 'phrygian', [[0, 1, 4, 1], [4, 1, 2, 0.6], [8, 2, 4, 0.85], [12, 1, 4, 0.7]],
          { shift: [0, 0, 5, 0] }),
      ] },
      { name: 'bell', inst: 'bell', gain: 0.16, pattern: hits([0, 32], 52, 0.5, 8) },
      { name: 'perc', wave: 'noise', gain: 0.34,
        pattern: beat(4, [0, 6, 8], 'wardrum', 0.7).concat(beat(4, [12, 14], 'tabor', 0.35)) },
    ],
  },

  // ── DUNGEON ───────────────────────────────────────────────────────────────
  // Almost nothing: a low drone, a psaltery figure that arrives when you have
  // stopped expecting it, and water. Space is the instrument here.
  dungeon: {
    bpm: 76, loopBars: 8, gain: 0.8,
    layers: [
      { name: 'pad', inst: 'pad', gain: 0.34, pattern: [
        ...drone(D3 - 12, 4, { dur: SPB * 2, vol: 0.7 }).filter((_, i) => i % 2 === 0 || true),
        [64, D3 - 12 - 1, SPB * 2, 0.6], [64, D3 - 12 + 6, SPB * 2, 0.4],
        [96, D3 - 12, SPB * 2, 0.7], [96, D3 - 5, SPB * 2, 0.5],
      ] },
      { name: 'psaltery', inst: 'psaltery', gain: 0.18, pattern: [
        ...tune(D4, 'aeolian', 12, [[1, 4], [null, 12], [3, 4], [null, 20], [2, 4]]),
        ...tune(D4, 'aeolian', 76, [[5, 4], [null, 16], [4, 4], [null, 12], [1, 6]]),
      ] },
      { name: 'breath', inst: 'choir', gain: 0.12, pattern: [
        [32, D3, SPB, 0.5], [48, F3, SPB, 0.4], [112, D3, SPB, 0.45],
      ] },
      { name: 'perc', wave: 'noise', gain: 0.14,
        pattern: hits([14, 46, 78, 110], 'drip', 0.4).concat(hits([0, 64], 'frame', 0.22)) },
    ],
  },

  // ── VICTORY ───────────────────────────────────────────────────────────────
  // Short Mixolydian flourish: shawms and bells, the sound of a gate opening.
  victory: {
    bpm: 120, loopBars: 2, gain: 1,
    layers: [
      { name: 'fanfare', inst: 'shawm', gain: 0.34, pattern: [
        ...tune(G4, 'mixolydian', 0, [[1, 2], [3, 2], [5, 2], [8, 6], [7, 2], [8, 8], [null, 8]]),
      ] },
      { name: 'harmony', inst: 'horn', gain: 0.24, pattern: [
        ...tune(G3, 'mixolydian', 0, [[1, 6], [5, 2], [8, 8], [5, 8], [1, 8]]),
      ] },
      { name: 'bells', inst: 'bell', gain: 0.24, pattern: hits([0, 8, 16], 79, 0.6, 8).concat(hits([16], 74, 0.4, 8)) },
      { name: 'perc', wave: 'noise', gain: 0.26, pattern: beat(2, [0, 8], 'tabor', 0.5) },
    ],
  },

  // ── INN — "The Stonehill Common Room" ─────────────────────────────────────
  // A lullaby for solo lute with a recorder that wanders in halfway. Warm, low,
  // meant to be half-heard behind conversation.
  inn: {
    bpm: 78, loopBars: 8, gain: 0.82,
    layers: [
      { name: 'lute', inst: 'lute', gain: 0.34, pattern: [
        ...pluckFig(A3, 'aeolian', 8, [1, 5, 8, 10], { pattern: [0, 4, 8, 12], dur: 4, vol: 0.8,
          shift: [0, 0, -4, -4, 3, 3, 0, 0] }),
      ] },
      { name: 'melody', inst: 'recorder', gain: 0.20, pattern: [
        ...tune(A4, 'aeolian', 64, [
          [1, 6], [2, 2], [3, 8],
          [2, 6], [1, 2], [7 - 7, 8],
          [3, 4], [2, 4], [1, 8],
          [null, 16],
        ]),
      ] },
      { name: 'bass', inst: 'viol', gain: 0.24, pattern: [
        ...drone(A3 - 12, 2, { dur: SPB, vol: 0.7 }),
        ...drone(A3 - 16, 2, { dur: SPB, vol: 0.7 }).map(([s, n, d, v]) => [s + 32, n, d, v]),
        ...drone(A3 - 9, 2, { dur: SPB, vol: 0.7 }).map(([s, n, d, v]) => [s + 64, n, d, v]),
        ...drone(A3 - 12, 2, { dur: SPB, vol: 0.7 }).map(([s, n, d, v]) => [s + 96, n, d, v]),
      ] },
    ],
  },

  // ── SHOP ──────────────────────────────────────────────────────────────────
  // A branle: quick, chattery, transactional. Gittern and psaltery.
  shop: {
    bpm: 126, loopBars: 4, gain: 0.84,
    layers: [
      { name: 'melody', inst: 'gittern', gain: 0.28, pattern: [
        ...tune(C4 + 12, 'ionian', 0, [
          [1, 2], [3, 2], [5, 2], [3, 2], [4, 2], [2, 2], [1, 4],
          [5, 2], [4, 2], [3, 2], [2, 2], [3, 4], [1, 4],
          [1, 2], [3, 2], [5, 2], [6, 2], [5, 4], [3, 4],
          [2, 2], [4, 2], [3, 2], [2, 2], [1, 8],
        ]),
      ] },
      { name: 'psaltery', inst: 'psaltery', gain: 0.16, pattern: [
        ...rep(4, C4 + 12, 'ionian', [[6, 8, 2, 0.4], [14, 5, 2, 0.3]], { shift: [0, 5, -3, 0] }),
      ] },
      { name: 'bass', inst: 'lute', gain: 0.26, pattern: [
        ...rep(4, C3, 'ionian', [[0, 1, 4, 0.9], [4, 5, 2, 0.5], [8, 1, 4, 0.8], [12, 5, 4, 0.6]],
          { shift: [0, 5, -3, 0] }),
      ] },
      { name: 'perc', wave: 'noise', gain: 0.2,
        pattern: beat(4, [0, 4, 8, 12], 'tabor', 0.34).concat(beat(4, [2, 10], 'shaker', 0.16)) },
    ],
  },

  // ── TENSE ─────────────────────────────────────────────────────────────────
  // A hurdy-gurdy ostinato that will not resolve. For the moment before it starts.
  tense: {
    bpm: 96, loopBars: 4, gain: 0.8,
    layers: [
      { name: 'gurdy', inst: 'hurdygurdy', gain: 0.22, pattern: drone(E3 - 12, 4, { dur: SPB, vol: 0.6 }) },
      { name: 'ost', inst: 'citole', gain: 0.24, pattern: [
        ...rep(4, E3, 'phrygian', [[0, 1, 2, 0.8], [4, 2, 2, 0.6], [8, 1, 2, 0.7], [12, 7 - 7, 2, 0.5]]),
      ] },
      { name: 'vielle', inst: 'vielle', gain: 0.20, pattern: [
        [0, deg(E4, 'phrygian', 1), 12, 0.5], [32, deg(E4, 'phrygian', 2), 12, 0.55],
      ] },
      { name: 'perc', wave: 'noise', gain: 0.16, pattern: beat(4, [0], 'frame', 0.35) },
    ],
  },

  // ── TEMPLE — "The Shrine of Luck" ─────────────────────────────────────────
  // A Dorian hymn to Tymora: portative organ and voices, no percussion at all.
  temple: {
    bpm: 60, loopBars: 8, gain: 0.86,
    layers: [
      { name: 'organ', inst: 'organetto', gain: 0.30, pattern: [
        ...rep(8, D3, 'dorian', [[0, 1, 8, 0.8], [8, 5, 8, 0.7]], { shift: [0, 0, 5, 5, 3, 3, 0, 0] }),
      ] },
      { name: 'voices', inst: 'choir', gain: 0.28, pattern: [
        ...tune(D4, 'dorian', 0, [
          [1, 8], [2, 8], [3, 16],
          [5, 8], [4, 8], [3, 16],
          [4, 8], [3, 8], [2, 16],
          [1, 16], [null, 16],
        ]),
      ] },
      { name: 'harp', inst: 'harp', gain: 0.18, pattern: [
        ...rep(8, D4, 'dorian', [[0, 1, 4, 0.4], [8, 5, 4, 0.3]], { shift: [0, 0, 5, 5, 3, 3, 0, 0] }),
      ] },
    ],
  },

  // ── FOREST — "Neverwinter Wood" ───────────────────────────────────────────
  // Lydian: that raised fourth is the sound of somewhere slightly enchanted.
  // Flute and harp, no drums — the wood keeps its own time.
  forest: {
    bpm: 82, loopBars: 8, gain: 0.84,
    layers: [
      { name: 'flute', inst: 'flute', gain: 0.26, pattern: [
        ...tune(F4, 'lydian', 0, [
          [1, 6], [2, 2], [3, 4], [4, 4],
          [5, 8], [3, 8],
          [4, 6], [3, 2], [2, 8],
          [1, 12], [null, 4],
          [5, 4], [6, 4], [5, 4], [4, 4],
          [3, 8], [2, 8],
          [3, 4], [2, 4], [1, 8],
          [1, 16],
        ]),
      ] },
      { name: 'harp', inst: 'harp', gain: 0.24, pattern: [
        ...pluckFig(F3, 'lydian', 8, [1, 3, 5, 8], { pattern: [0, 4, 8, 12], dur: 4, vol: 0.6,
          shift: [0, 0, 2, 2, -3, -3, 0, 0] }),
      ] },
      { name: 'pad', inst: 'pad', gain: 0.2, pattern: [
        ...drone(F3 - 12, 8, { dur: SPB, vol: 0.5 }),
      ] },
    ],
  },

  // ── CAVE ──────────────────────────────────────────────────────────────────
  // Deep, wet, and mostly silence. Locrian fragments that never settle.
  cave: {
    bpm: 68, loopBars: 8, gain: 0.76,
    layers: [
      { name: 'pad', inst: 'pad', gain: 0.32, pattern: [
        [0, C3 - 12, SPB * 4, 0.7], [64, C3 - 13, SPB * 4, 0.6],
      ] },
      { name: 'drip', inst: 'chime', gain: 0.18, pattern: [
        [10, 84, 4, 0.4], [38, 79, 4, 0.3], [70, 86, 4, 0.35], [104, 77, 4, 0.28],
      ] },
      { name: 'low', inst: 'viol', gain: 0.16, pattern: [
        [24, C3 - 5, 12, 0.4], [88, C3 - 6, 12, 0.4],
      ] },
      { name: 'perc', wave: 'noise', gain: 0.14, pattern: hits([16, 52, 96], 'drip', 0.35) },
    ],
  },

  // ── NIGHT ─────────────────────────────────────────────────────────────────
  // Overworld after dark: solo harp, very sparse, Aeolian.
  night: {
    bpm: 62, loopBars: 8, gain: 0.78,
    layers: [
      { name: 'harp', inst: 'harp', gain: 0.30, pattern: [
        ...tune(A3, 'aeolian', 0, [
          [1, 8], [5, 8], [8, 8], [5, 8],
          [7 - 7, 8], [4, 8], [7, 8], [4, 8],
          [3, 8], [7, 8], [10, 8], [7, 8],
          [1, 8], [5, 8], [8, 16],
        ]),
      ] },
      { name: 'pad', inst: 'pad', gain: 0.22, pattern: [
        [0, A3 - 24, SPB * 2, 0.6], [32, A3 - 28, SPB * 2, 0.55],
        [64, A3 - 21, SPB * 2, 0.55], [96, A3 - 24, SPB * 2, 0.6],
      ] },
      { name: 'flute', inst: 'flute', gain: 0.14, pattern: [
        [64, deg(A4, 'aeolian', 3), 12, 0.4], [96, deg(A4, 'aeolian', 1), 16, 0.4],
      ] },
    ],
  },

  // ── WILDS ─────────────────────────────────────────────────────────────────
  // Off the road and past the last farm. Phrygian, unsettled, watchful.
  wilds: {
    bpm: 88, loopBars: 8, gain: 0.82,
    layers: [
      { name: 'vielle', inst: 'vielle', gain: 0.26, pattern: [
        ...tune(E4, 'phrygian', 0, [
          [1, 6], [2, 2], [1, 8],
          [3, 4], [2, 4], [1, 8],
          [5, 6], [4, 2], [3, 8],
          [2, 8], [1, 8],
          [null, 16],
          [1, 4], [2, 4], [3, 4], [4, 4],
          [3, 8], [2, 8],
          [1, 16],
        ]),
      ] },
      { name: 'gurdy', inst: 'hurdygurdy', gain: 0.16, pattern: drone(E3 - 12, 8, { dur: SPB, vol: 0.5 }) },
      { name: 'lute', inst: 'lute', gain: 0.2, pattern: [
        ...rep(8, E3, 'phrygian', [[0, 1, 4, 0.7], [8, 5, 4, 0.5]]),
      ] },
      { name: 'perc', wave: 'noise', gain: 0.16, pattern: beat(8, [0, 12], 'frame', 0.3) },
    ],
  },

  // ── CITY — "Neverwinter, Protector's Enclave" ─────────────────────────────
  // Grander than the frontier: organ, vielles and bells. A city that survived.
  city: {
    bpm: 92, loopBars: 8, gain: 0.88,
    layers: [
      { name: 'organ', inst: 'organetto', gain: 0.24, pattern: [
        ...rep(8, G3, 'ionian', [[0, 1, 8, 0.7], [8, 5, 8, 0.6]], { shift: [0, 0, 5, 5, -3, -3, 0, 0] }),
      ] },
      { name: 'melody', inst: 'vielle', gain: 0.28, pattern: [
        ...tune(G4, 'ionian', 0, [
          [1, 4], [2, 4], [3, 8],
          [5, 4], [4, 4], [3, 8],
          [4, 4], [5, 4], [6, 8],
          [5, 8], [3, 8],
          [3, 4], [4, 4], [5, 8],
          [2, 4], [3, 4], [4, 8],
          [3, 4], [2, 4], [1, 8],
          [1, 16],
        ]),
      ] },
      { name: 'harp', inst: 'harp', gain: 0.18, pattern: [
        ...pluckFig(G3 + 12, 'ionian', 8, [1, 5, 8, 5], { pattern: [2, 6, 10, 14], dur: 3, vol: 0.45,
          shift: [0, 0, 5, 5, -3, -3, 0, 0] }),
      ] },
      { name: 'bells', inst: 'bell', gain: 0.14, pattern: hits([0, 64], 67, 0.4, 8) },
      { name: 'perc', wave: 'noise', gain: 0.14, pattern: beat(8, [0, 8], 'frame', 0.26) },
    ],
  },

  // ── UNDERMOUNTAIN ─────────────────────────────────────────────────────────
  // Halaster's dungeon. A bell that is slightly out of tune with everything else,
  // over a drone that never resolves. Deliberately uncomfortable, never shrill.
  undermountain: {
    bpm: 58, loopBars: 8, gain: 0.8,
    layers: [
      { name: 'pad', inst: 'pad', gain: 0.34, pattern: [
        [0, C3 - 12, SPB * 4, 0.75], [64, C3 - 12, SPB * 4, 0.7],
      ] },
      { name: 'wrongbell', inst: 'bell', gain: 0.2, pattern: [
        [0, 60, 8, 0.5], [40, 61, 8, 0.4], [80, 60, 8, 0.45], [116, 66, 8, 0.35],
      ] },
      { name: 'voices', inst: 'choir', gain: 0.16, pattern: [
        [16, deg(C4, 'locrian', 1), SPB, 0.4], [48, deg(C4, 'locrian', 2), SPB, 0.35],
        [80, deg(C4, 'locrian', 5), SPB, 0.4], [112, deg(C4, 'locrian', 1), SPB, 0.35],
      ] },
      { name: 'psaltery', inst: 'psaltery', gain: 0.14, pattern: [
        [28, deg(C4 + 12, 'locrian', 3), 4, 0.35], [92, deg(C4 + 12, 'locrian', 2), 4, 0.3],
      ] },
      { name: 'perc', wave: 'noise', gain: 0.12, pattern: hits([20, 84], 'drip', 0.3) },
    ],
  },

  // ── LAMENT ────────────────────────────────────────────────────────────────
  // For a death, or a hard defeat. Solo vielle over a viol drone. No drums.
  lament: {
    bpm: 54, loopBars: 4, gain: 0.86,
    layers: [
      { name: 'vielle', inst: 'vielle', gain: 0.34, pattern: [
        ...tune(D4, 'aeolian', 0, [
          [5, 8], [4, 4], [3, 4],
          [2, 8], [1, 8],
          [3, 6], [2, 2], [1, 8],
          [7 - 7, 8], [1, 8],
        ]),
      ] },
      { name: 'drone', inst: 'viol', gain: 0.26, pattern: drone(D3 - 12, 4, { dur: SPB, vol: 0.65 }) },
      { name: 'harp', inst: 'harp', gain: 0.14, pattern: [
        [0, deg(D3, 'aeolian', 1), 8, 0.4], [32, deg(D3, 'aeolian', 4), 8, 0.35],
      ] },
    ],
  },

  // ── MYSTERY ───────────────────────────────────────────────────────────────
  // Harper business: whispered, plucked, unresolved. Dorian with a flat second
  // leaning in where it shouldn't.
  mystery: {
    bpm: 84, loopBars: 4, gain: 0.8,
    layers: [
      { name: 'lute', inst: 'lute', gain: 0.28, pattern: [
        ...tune(A3 + 12, 'dorian', 0, [
          [1, 2], [3, 2], [5, 2], [null, 2], [4, 2], [2, 2], [1, 4],
          [null, 4], [5, 2], [4, 2], [3, 4], [2, 4],
          [1, 2], [3, 2], [6, 2], [null, 2], [5, 4], [3, 4],
          [2, 4], [1, 12],
        ]),
      ] },
      { name: 'psaltery', inst: 'psaltery', gain: 0.14, pattern: [
        [12, deg(A4 + 12, 'dorian', 5), 2, 0.35], [44, deg(A4 + 12, 'dorian', 4), 2, 0.3],
      ] },
      { name: 'pad', inst: 'pad', gain: 0.2, pattern: drone(A3 - 24, 4, { dur: SPB, vol: 0.5 }) },
    ],
  },

  // ── DRAGON ────────────────────────────────────────────────────────────────
  // The biggest thing in the game is coming. Full consort, slow and enormous.
  dragon: {
    bpm: 100, loopBars: 4, gain: 0.94,
    layers: [
      { name: 'horns', inst: 'horn', gain: 0.30, pattern: [
        ...tune(C4, 'phrygian', 0, [
          [1, 8], [2, 4], [1, 4],
          [5, 8], [4, 8],
          [1, 4], [2, 4], [3, 4], [4, 4],
          [5, 8], [1, 8],
        ]),
      ] },
      { name: 'organ', inst: 'organetto', gain: 0.24, pattern: [
        ...rep(4, C3, 'phrygian', [[0, 1, 8, 0.85], [8, 2, 8, 0.7]]),
      ] },
      { name: 'bass', inst: 'viol', gain: 0.34, pattern: [
        ...rep(4, C3 - 12, 'phrygian', [[0, 1, 8, 1], [8, 1, 4, 0.75], [12, 2, 4, 0.7]]),
      ] },
      { name: 'bell', inst: 'bell', gain: 0.2, pattern: hits([0, 32], 48, 0.55, 8) },
      { name: 'perc', wave: 'noise', gain: 0.36,
        pattern: beat(4, [0, 8], 'wardrum', 0.8).concat(beat(4, [6, 14], 'frame', 0.3)) },
    ],
  },

  // ── DEFEAT ────────────────────────────────────────────────────────────────
  defeat: {
    bpm: 60, loopBars: 2, gain: 0.9,
    layers: [
      { name: 'vielle', inst: 'vielle', gain: 0.3, pattern: [
        ...tune(C4, 'aeolian', 0, [[3, 6], [2, 4], [1, 6], [7 - 7, 16]]),
      ] },
      { name: 'organ', inst: 'organetto', gain: 0.24, pattern: [
        [0, C3, SPB, 0.7], [16, C3 - 1, SPB, 0.6],
      ] },
      { name: 'bell', inst: 'bell', gain: 0.18, pattern: hits([0], 48, 0.5, 12) },
    ],
  },

  // ── CAMP ──────────────────────────────────────────────────────────────────
  // Resting in the wilds: one lute, played badly and fondly by whoever has watch.
  camp: {
    bpm: 70, loopBars: 4, gain: 0.78,
    layers: [
      { name: 'lute', inst: 'lute', gain: 0.32, pattern: [
        ...tune(G3 + 12, 'mixolydian', 0, [
          [1, 4], [2, 2], [3, 2], [5, 8],
          [4, 4], [3, 4], [2, 8],
          [3, 4], [5, 4], [4, 8],
          [2, 4], [1, 12],
        ]),
      ] },
      { name: 'bass', inst: 'lute', gain: 0.2, pattern: [
        ...rep(4, G3 - 12, 'mixolydian', [[0, 1, 6, 0.7], [8, 5, 6, 0.5]]),
      ] },
      { name: 'perc', wave: 'noise', gain: 0.1, pattern: hits([28, 60], 'frame', 0.2) },
    ],
  },

  // ── ORCHESTRAL — "The Coast Road" ─────────────────────────────────────────
  // The full band, and the reason the section instruments exist: five string
  // desks, four horns and a pair of kettles. Written so the sections ENTER
  // rather than all playing at once — basses and celli lay the floor, violas
  // fill, the violins take the tune, and the horns answer them a bar later.
  // That staggering is what an orchestra sounds like; everyone playing all the
  // time is what a synthesiser sounds like.
  orchestral: {
    bpm: 76, loopBars: 8, gain: 0.95,
    layers: [
      // The tune: a rising Aeolian line that reaches for the sixth and falls back.
      { name: 'violins', inst: 'strings', gain: 0.34, pattern: [
        ...tune(D4, 'aeolian', 0, [
          [1, 8], [2, 4], [3, 4],
          [5, 12], [4, 4],
          [3, 8], [4, 4], [5, 4],
          [6, 12], [5, 4],
          [4, 8], [3, 4], [2, 4],
          [1, 16],
          [null, 8], [5, 4], [4, 4],
          [3, 8], [1, 8],
        ]),
      ] },
      // Violins an octave up, only over the second half: the moment it opens out.
      { name: 'descant', inst: 'stringsHigh', gain: 0.16, pattern: [
        ...tune(D4 + 12, 'aeolian', 64, [
          [3, 8], [4, 4], [5, 4],
          [6, 12], [5, 4],
          [4, 8], [3, 4], [2, 4],
          [1, 16],
        ]),
      ] },
      // Horns answer the violins one bar behind, which is the oldest trick in
      // orchestration and still the most effective.
      { name: 'horns', inst: 'horns', gain: 0.26, pattern: [
        ...tune(D3, 'aeolian', 16, [
          [1, 8], [2, 4], [3, 4],
          [5, 12], [null, 4],
        ]),
        ...tune(D3, 'aeolian', 80, [
          [3, 8], [4, 4], [5, 4],
          [6, 12], [null, 4],
        ]),
      ] },
      { name: 'violas', inst: 'violas', gain: 0.2, pattern: [
        ...rep(8, D3 + 7, 'aeolian', [[0, 1, 8, 0.7], [8, 3, 8, 0.6]],
          { shift: [0, 0, -2, -2, 3, 3, 0, 0] }),
      ] },
      { name: 'celli', inst: 'celli', gain: 0.3, pattern: [
        ...rep(8, D3, 'aeolian', [[0, 1, 12, 0.85], [12, 5, 4, 0.6]],
          { shift: [0, 0, -2, -2, 3, 3, 0, 0] }),
      ] },
      { name: 'basses', inst: 'basses', gain: 0.34, pattern: [
        ...rep(8, D3 - 12, 'aeolian', [[0, 1, 16, 0.9]],
          { shift: [0, 0, -2, -2, 3, 3, 0, 0] }),
      ] },
      // Kettles on the bar lines, and the pair answering each other at the turn.
      { name: 'timp', wave: 'noise', gain: 0.3,
        pattern: beat(8, [0], 'timp', 0.55)
          .concat(hits([56, 60, 120, 124], 'timphi', 0.4), hits([112], 'gong', 0.5)) },
    ],
  },

  // ── RIVER BALLAD — "Down the Chionthar" ───────────────────────────────────
  // An ORIGINAL tavern song for Baldur's Gate, not a cover of anyone's. The
  // Chionthar is the river the city stands on, so the tune moves the way the
  // barge traffic does: a long lilting three-feel, the fiddle carrying it, the
  // lute walking underneath, and a bodhrán keeping the oars honest. Dorian, so
  // it is wistful without being a dirge — a song for people who work water.
  rivertune: {
    bpm: 96, loopBars: 8, gain: 0.88,
    layers: [
      { name: 'fiddle', inst: 'vielle', gain: 0.32, pattern: [
        ...tune(D4, 'dorian', 0, [
          [5, 6], [4, 3], [3, 3], [4, 4],
          [3, 6], [2, 3], [1, 3], [2, 4],
          [1, 6], [2, 3], [3, 3], [5, 4],
          [4, 12], [null, 4],
          [5, 6], [6, 3], [5, 3], [4, 4],
          [3, 6], [4, 3], [3, 3], [2, 4],
          [1, 6], [2, 3], [3, 3], [2, 4],
          [1, 12], [null, 4],
        ]),
      ] },
      // The whistle takes the second half an octave up, the way a second player
      // joins a chorus once everyone knows how it goes.
      { name: 'whistle', inst: 'recorder', gain: 0.15, pattern: [
        ...tune(D4 + 12, 'dorian', 64, [
          [5, 6], [6, 3], [5, 3], [4, 4],
          [3, 6], [4, 3], [3, 3], [2, 4],
          [1, 6], [2, 3], [3, 3], [2, 4],
          [1, 12], [null, 4],
        ]),
      ] },
      { name: 'lute', inst: 'lute', gain: 0.24, pattern: [
        ...rep(8, D3, 'dorian', [
          [0, 1, 3, 0.85], [3, 5, 3, 0.4], [6, 8, 3, 0.45],
          [9, 5, 3, 0.35], [12, 3, 2, 0.5], [14, 5, 2, 0.3],
        ], { shift: [0, 0, -2, -2, 5, 5, 3, 0] }),
      ] },
      { name: 'celli', inst: 'celli', gain: 0.22, pattern: [
        ...rep(8, D3 - 12, 'dorian', [[0, 1, 10, 0.8], [10, 5, 6, 0.55]],
          { shift: [0, 0, -2, -2, 5, 5, 3, 0] }),
      ] },
      { name: 'perc', wave: 'noise', gain: 0.24,
        pattern: beat(8, [0, 6], 'frame', 0.5)
          .concat(beat(8, [3, 9, 12], 'frame', 0.22), beat(8, [14], 'shaker', 0.16)) },
    ],
  },
};

/** Track ids grouped by where they belong, so callers can pick sensibly. */
export const TRACK_GROUPS = {
  menu: ['title'],
  settlement: ['town', 'city', 'inn', 'shop', 'temple'],
  overworld: ['field', 'forest', 'wilds', 'night'],
  underground: ['dungeon', 'cave', 'undermountain'],
  combat: ['battle', 'boss', 'dragon'],
  sting: ['victory', 'defeat', 'lament'],
  mood: ['tense', 'mystery', 'camp'],
  grand: ['orchestral', 'rivertune'],
};

/** Sensible music for a map's biome, so maps.js doesn't have to hard-code ids. */
export function trackForBiome(biome, { night = false, indoor = false } = {}) {
  if (indoor) return 'inn';
  switch (biome) {
    case 'city': return 'city';
    case 'forest': case 'pine-forest': return 'forest';
    case 'cave': case 'mine': return 'cave';
    case 'dungeon': case 'crypt': return 'dungeon';
    case 'underdark': return 'undermountain';
    case 'marsh': case 'ash-waste': case 'ruins': return 'wilds';
    case 'road': case 'plains': case 'hills': case 'coast': case 'mountain': case 'tundra':
      return night ? 'night' : 'field';
    default: return night ? 'night' : 'field';
  }
}
