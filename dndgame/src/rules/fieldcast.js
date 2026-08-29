// rules/fieldcast.js — casting spells when nobody is trying to kill you.
//
// The spellbook used to be a filing cabinet: you could tick a spell as prepared
// and that was the whole of it. Mage Armor, Light, Knock and Longstrider might
// as well not have been in the catalogue, because the only place a spell could
// ever be cast was the battle screen — and Mage Armor lasts eight hours, which
// is a strange duration for something you can only cast once the goblins are
// already on top of you.
//
// This module is the other half. It answers two questions for any spell:
//
//   fieldCastable(ch, spellId)  Can this be cast right now, standing here?
//   fieldCast(ch, spellId, ctx) Cast it, and what visibly happened?
//
// It is headless: no scenes, no drawing. ui/menus.js drives it from the
// spellbook, the overworld supplies the world hooks (a locked chest to Knock
// open, a dark cave for Light), and rules/combat.js is untouched.
//
// WHAT MAKES A SPELL CASTABLE OUT OF COMBAT
//
// The spell data already says, in `effects[]`, `heal` and `duration`. Nothing is
// hard-coded per spell except the handful of world verbs (unlock, detect, make
// an item) that need to reach into the map. Everything else falls out of:
//
//   * a `heal` block                       -> mend a companion
//   * a buff/shield effect lasting a while -> put it up before you set off
//   * a `utility` effect                   -> the world verbs below
//   * `ritual: true`                       -> no slot, ten minutes of the clock
//   * a `damage` block and nothing else    -> refused; there is nothing to burn
//
// Refusing is as important as casting: a spell that cannot do anything useful
// here must not silently eat a slot.

import { getSpell } from '../data/spells.js';
import { roundsFor } from './conditions.js';
import { applyEffect } from './actions.js';
import { recalc, maxHpOf, isDead } from './character.js';
import {
  availableSlots, hasSlot, spendSlot, spellDC, knownSpells,
  alwaysPreparedSpells, startConcentration, isConcentrating,
} from './spellcasting.js';
import { rollExpr } from '../core/dice.js';
import { rng } from '../core/rng.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' ? v : {});
const lower = (v) => String(v == null ? '' : v).toLowerCase();

function safe(fn, fb) { try { const v = fn(); return v === undefined ? fb : v; } catch (e) { return fb; } }

/** Absolute minutes since the campaign began — buffs expire against this. */
export function clockMinutes(st) {
  if (!st) return 0;
  return (Number(st.day) || 0) * 1440 + (Number(st.time) || 0);
}

/** A duration string in minutes of world time. Null means "until dispelled". */
export function minutesFor(duration) {
  const rounds = roundsFor(duration);
  if (rounds == null) return null;
  return rounds / 10;                       // ten six-second rounds to the minute
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** The world verbs a `utility` effect can ask for, and who services them. */
const WORLD_TAGS = new Set([
  'light', 'unlock', 'detect-magic', 'create-item', 'telekinesis',
  'purify', 'clean', 'mend', 'identify', 'comprehend', 'disguise', 'alarm', 'water',
]);

/**
 * What this spell would DO if cast standing here.
 *   'heal' | 'buff' | 'world' | 'none'
 */
export function fieldRole(spell) {
  const sp = obj(spell);
  if (sp.heal) return 'heal';
  for (const e of arr(sp.effects)) {
    const k = lower(e && e.kind);
    if (k === 'buff' || k === 'shield' || k === 'temphp') return 'buff';
  }
  for (const e of arr(sp.effects)) {
    if (lower(e && e.kind) === 'utility' && WORLD_TAGS.has(lower(e.tag))) return 'world';
  }
  // A condition that helps rather than hurts (heroism's fright immunity, say).
  if (!sp.damage && !sp.attack && !sp.save && arr(sp.effects).length) return 'buff';
  return 'none';
}

/** Who the caster must choose between: 'self' | 'ally' | 'none'. */
export function fieldTargeting(spell) {
  const sp = obj(spell);
  const t = obj(sp.target);
  const role = fieldRole(sp);
  if (role === 'world') return 'none';
  if (lower(t.kind) === 'self') return 'self';
  if (role === 'heal' || t.allowAllies || lower(t.kind) === 'creature' || lower(t.kind) === 'multi') return 'ally';
  return 'self';
}

/** Is `spellId` on this character's prepared/known list right now? */
export function isAvailable(ch, spellId) {
  if (!ch || !spellId) return false;
  const sp = getSpell(spellId);
  if (!sp) return false;
  if (sp.level === 0) return arr(safe(() => knownSpells(ch), [])).indexOf(spellId) >= 0
    || arr(ch.spells && ch.spells.cantrips).indexOf(spellId) >= 0;
  const prepared = arr(ch.spells && ch.spells.prepared);
  const always = arr(safe(() => alwaysPreparedSpells(ch), []));
  return prepared.indexOf(spellId) >= 0 || always.indexOf(spellId) >= 0;
}

/**
 * May `ch` cast `spellId` here and now?
 * @returns {{ok:boolean, why:string|null, role:string, slot:number, ritual:boolean}}
 */
export function fieldCastable(ch, spellId, env = {}) {
  const sp = getSpell(spellId);
  const no = (why, role = 'none') => ({ ok: false, why, role, slot: 0, ritual: false });
  if (!sp) return no('No such spell.');
  if (!ch || isDead(ch)) return no('They are in no state to cast.');
  if (!isAvailable(ch, spellId)) return no(sp.level === 0 ? 'Not one of their cantrips.' : 'Not prepared today.');

  const role = fieldRole(sp);
  if (role === 'none') {
    return no(sp.damage || sp.attack || sp.save
      ? 'Nothing here to aim it at — save it for the fight.'
      : 'There is no call for it just now.', role);
  }

  // A ritual is cast off-book: no slot, ten minutes of daylight.
  const ritual = !!sp.ritual && sp.level > 0;
  if (ritual) return { ok: true, why: null, role, slot: 0, ritual: true };

  if (sp.level === 0) return { ok: true, why: null, role, slot: 0, ritual: false };

  const wanted = Math.max(sp.level, Math.min(9, Number(env.slotLevel) || sp.level));
  if (safe(() => hasSlot(ch, wanted), false)) return { ok: true, why: null, role, slot: wanted, ritual: false };

  const open = arr(safe(() => availableSlots(ch, sp.level), []));
  if (!open.length) return no(`No ${ordinalish(sp.level)} slot or better left.`, role);
  return { ok: true, why: null, role, slot: open[0], ritual: false };
}

function ordinalish(n) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

// ---------------------------------------------------------------------------
// Casting
// ---------------------------------------------------------------------------

/**
 * A minimal stand-in for the Encounter that rules/actions.js expects. Out of
 * combat there is no initiative, no map and no log — applyEffect only reaches
 * for the RNG and a place to push text.
 */
function fieldCtx(log) {
  return { rng, log, round: 0, units: [], _push(text, kind) { log.push({ text, kind }); } };
}

/**
 * Cast `spellId` outside combat.
 *
 * @param {object} ch      the caster
 * @param {string} spellId
 * @param {object} env {
 *   target,            // the Character to affect (defaults to the caster)
 *   party,             // world/party.js, for goodberry and the like
 *   state,             // GameState, for the world clock and flags
 *   world,             // { unlock(), light(), detect(), nearby() } from the overworld
 *   slotLevel,         // upcast level
 * }
 * @returns {{ok:boolean, text:string, lines:string[], slot:number, ritual:boolean}}
 */
export function fieldCast(ch, spellId, env = {}) {
  const sp = getSpell(spellId);
  const gate = fieldCastable(ch, spellId, env);
  if (!gate.ok) return { ok: false, text: gate.why || 'It will not come.', lines: [], slot: 0, ritual: false };

  const st = env.state || null;
  const target = env.target || ch;
  const lines = [];
  const log = [];
  const ctx = fieldCtx(log);
  const level = gate.slot || sp.level;

  // Concentration out of combat behaves as it does in it: one at a time.
  if (sp.concentration && isConcentrating(ch)) {
    lines.push(`${ch.name} lets their previous spell go.`);
  }

  // --- the slot ------------------------------------------------------------
  if (!gate.ritual && sp.level > 0) {
    if (!safe(() => spendSlot(ch, level), false)) {
      return { ok: false, text: 'The slot slips away.', lines: [], slot: 0, ritual: false };
    }
  }

  // --- time ----------------------------------------------------------------
  // Rituals take ten minutes; everything else is over in six seconds.
  const minutes = gate.ritual ? 10 : 0;

  // --- healing -------------------------------------------------------------
  if (sp.heal && !arr(sp.effects).some((e) => lower(e && e.tag) === 'create-item')) {
    const healed = healWith(ch, target, sp, level);
    lines.push(healed > 0
      ? `${target.name} recovers ${healed} hit points.`
      : `${target.name} is already whole.`);
  }

  // --- buffs, wards and temp hp -------------------------------------------
  const dc = safe(() => spellDC(ch), 10);
  for (const eff of arr(sp.effects)) {
    const k = lower(eff && eff.kind);
    if (k !== 'buff' && k !== 'shield' && k !== 'temphp' && k !== 'condition') continue;
    const applied = safe(() => applyEffect(ctx, ch, target, {
      ...eff, dc, spellId, concentration: !!sp.concentration,
    }, { r: rng, log }), null);
    if (!applied) continue;
    // Out here, duration is measured on the world clock rather than in rounds:
    // an eight-hour ward should not evaporate because the party took ten steps.
    stampExpiry(target, eff, sp, st);
    lines.push(`${target.name}: ${eff.name || sp.name} takes hold.`);
  }

  // --- world verbs ---------------------------------------------------------
  for (const eff of arr(sp.effects)) {
    if (lower(eff && eff.kind) !== 'utility') continue;
    const said = castWorldEffect(ch, sp, eff, env);
    if (said) lines.push(said);
  }

  if (sp.concentration) safe(() => startConcentration(ch, spellId, [target], { rounds: roundsFor(sp.duration) }));
  safe(() => recalc(target));

  for (const l of log) if (l && l.text && lines.indexOf(l.text) < 0) lines.push(l.text);
  if (!lines.length) lines.push(`${ch.name} casts ${sp.name}.`);

  return {
    ok: true,
    text: lines[0],
    lines,
    slot: gate.ritual ? 0 : (sp.level > 0 ? level : 0),
    ritual: gate.ritual,
    minutes,
  };
}

/** Roll the spell's heal block at `level` and apply it. */
function healWith(caster, target, sp, level) {
  const h = obj(sp.heal);
  const mod = h.addSpellMod === false ? 0 : spellMod(caster);
  let dice = h.dice || '0';
  const per = obj(h.scale).perSlot;
  const up = Math.max(0, level - Math.max(1, sp.level));
  if (per && up > 0) dice = `${dice}+${repeatDice(per, up)}`;
  const rolled = safe(() => rollExpr(String(dice), rng).total, 0) || 0;
  const flat = Number(h.flat) || 0;
  const amount = Math.max(0, rolled + flat + (h.dice ? mod : 0));
  const before = target.hp || 0;
  const max = safe(() => maxHpOf(target), target.maxHp || before) || before;
  target.hp = Math.min(max, before + amount);
  return target.hp - before;
}

function repeatDice(expr, times) {
  const out = [];
  for (let i = 0; i < times; i++) out.push(expr);
  return out.join('+');
}

function spellMod(ch) {
  const m = Number(ch && ch.spellMod);
  if (Number.isFinite(m)) return m;
  const ab = safe(() => ch.spells && ch.spells.ability, null);
  const score = ab && ch.abilities ? Number(ch.abilities[ab]) : NaN;
  return Number.isFinite(score) ? Math.floor((score - 10) / 2) : 0;
}

/**
 * Give the freshly-applied effect a world-clock expiry. combat.js ticks `dur`
 * in rounds; out here nothing does, so a numeric `dur` would simply freeze. We
 * clear it and record `until` in absolute minutes instead — expireFieldBuffs
 * sweeps it, and combat converts it back to rounds when a fight starts.
 */
function stampExpiry(target, eff, sp, st) {
  if (!target || !Array.isArray(target.effects)) return;
  const inst = target.effects[target.effects.length - 1];
  if (!inst) return;
  const mins = minutesFor(eff.duration || sp.duration);
  inst.field = true;
  inst.dur = null;                             // no longer ticks per round
  inst.until = mins == null || !st ? null : clockMinutes(st) + mins;
  inst.name = inst.name || eff.name || sp.name;
}

/**
 * Drop any field buff whose hour has come. Called from the world clock, so a
 * Mage Armor cast at dawn is gone by nightfall whether or not you fought.
 * @returns {string[]} names of the effects that lapsed, for the toast
 */
export function expireFieldBuffs(members, st) {
  const now = clockMinutes(st);
  const gone = [];
  for (const ch of arr(members)) {
    if (!ch || !Array.isArray(ch.effects) || !ch.effects.length) continue;
    const before = ch.effects.length;
    ch.effects = ch.effects.filter((e) => {
      if (!e || !e.field || e.until == null) return true;
      if (now < e.until) return true;
      gone.push(`${ch.name}: ${e.name || 'a spell'} fades.`);
      return false;
    });
    if (ch.effects.length !== before) { ch._mech = null; safe(() => recalc(ch)); }
  }
  return gone;
}

/**
 * Convert field buffs back into round counts as a fight begins, so a ward with
 * two minutes left is worth twenty rounds and one with eight hours is worth the
 * whole battle.
 */
export function fieldBuffsToRounds(ch, st) {
  if (!ch || !Array.isArray(ch.effects)) return;
  const now = clockMinutes(st);
  for (const e of ch.effects) {
    if (!e || !e.field) continue;
    if (e.until == null) { e.dur = null; continue; }
    e.dur = Math.max(1, Math.round((e.until - now) * 10));
  }
}

// ---------------------------------------------------------------------------
// World verbs
// ---------------------------------------------------------------------------

/**
 * The handful of effects that have to reach outside the character sheet. The
 * overworld hands in `env.world` with the hooks it can service; anything it
 * cannot do simply reports what the spell achieved in prose, which is still
 * more than the spellbook managed before.
 */
function castWorldEffect(ch, sp, eff, env) {
  const w = obj(env.world);
  const tag = lower(eff.tag);
  const mech = obj(eff.mech);

  switch (tag) {
    case 'light': {
      const r = Number(mech.lightRadius) || 20;
      if (typeof w.light === 'function') { safe(() => w.light(r, sp.id, minutesFor(sp.duration))); }
      return `A ${r}-foot pool of light follows ${ch.name}.`;
    }
    case 'unlock': {
      const done = typeof w.unlock === 'function' ? safe(() => w.unlock(), null) : null;
      if (done && done.ok) return done.text || 'The lock springs open with a loud metallic knock.';
      return done && done.text ? done.text : 'Nothing within reach is locked.';
    }
    case 'detect-magic': {
      const found = typeof w.detect === 'function' ? safe(() => w.detect('magic'), null) : null;
      if (found && found.count) return `The Weave answers: ${found.count} enchanted thing${found.count === 1 ? '' : 's'} nearby.`;
      return 'Nothing nearby carries an enchantment.';
    }
    case 'create-item': {
      const id = mech.itemId;
      const qty = Number(mech.qty) || 1;
      const party = env.party;
      if (id && party && typeof party.addItem === 'function' && safe(() => party.addItem(id, qty), false)) {
        return `${qty} ${id.replace(/-/g, ' ')} appear in cupped hands.`;
      }
      return 'The conjuring will not hold.';
    }
    case 'telekinesis': {
      const done = typeof w.reach === 'function' ? safe(() => w.reach(Number(mech.carryLimit) || 10), null) : null;
      if (done && done.ok) return done.text || 'The spectral hand fetches it back.';
      return 'The spectral hand drifts, finds nothing worth fetching, and fades.';
    }
    case 'identify':
      return typeof w.identify === 'function'
        ? (safe(() => w.identify(), null) || {}).text || 'Nothing unidentified in the pack.'
        : 'Nothing unidentified in the pack.';
    case 'purify':
    case 'water':
    case 'clean':
    case 'mend':
    case 'comprehend':
    case 'disguise':
    case 'alarm':
      return `${sp.name} takes hold.`;
    default:
      return null;
  }
}
