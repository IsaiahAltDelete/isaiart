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

import { getSpell, spellHealDice } from '../data/spells.js';
import { resolveItem } from '../data/items.js';
import { roundsFor, conditionInstance, removeCondition } from './conditions.js';
import { applyEffect, healTarget } from './actions.js';
import { recalc, isDead, abilityMod } from './character.js';
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

  // --- the world verbs go FIRST -------------------------------------------
  // A spell that turns out to have nothing to act on must not cost a slot, and
  // fieldCastable cannot know: whether there is a locked chest within sixty
  // feet is a question only the map can answer. So ask the map before paying.
  const worldLines = [];
  let worldDidSomething = false;
  for (const eff of arr(sp.effects)) {
    if (lower(eff && eff.kind) !== 'utility') continue;
    const res = castWorldEffect(ch, sp, eff, env);
    if (!res) continue;
    worldLines.push(res.text);
    if (res.ok) worldDidSomething = true;
  }
  if (gate.role === 'world' && !worldDidSomething) {
    return { ok: false, text: worldLines[0] || 'Nothing comes of it.', lines: [], slot: 0, ritual: false };
  }

  // --- the slot ------------------------------------------------------------
  if (!gate.ritual && sp.level > 0) {
    if (!safe(() => spendSlot(ch, level), false)) {
      return { ok: false, text: 'The slot slips away.', lines: [], slot: 0, ritual: false };
    }
  }

  // Rituals take ten minutes; everything else is over in six seconds.
  const minutes = gate.ritual ? 10 : 0;

  // --- concentration, BEFORE the effects it protects ------------------------
  // startConcentration drops whatever came before it, and dropping a spell
  // strips the effects that spell applied. Re-casting the same ward on the same
  // ally would otherwise remove the ward you just put up.
  if (sp.concentration) {
    if (isConcentrating(ch)) lines.push(`${ch.name} lets their previous spell go.`);
    safe(() => startConcentration(ch, spellId, [target], { dur: roundsFor(sp.duration) }));
  }

  // --- healing -------------------------------------------------------------
  if (sp.heal && !arr(sp.effects).some((e) => lower(e && e.tag) === 'create-item')) {
    const healed = healWith(ctx, ch, target, sp, level, log);
    lines.push(healed > 0
      ? `${target.name} recovers ${healed} hit points.`
      : `${target.name} is no better for it.`);
  }

  // --- buffs, wards, temp hp and helpful conditions -------------------------
  const dc = safe(() => spellDC(ch), 10);
  for (const eff of arr(sp.effects)) {
    const k = lower(eff && eff.kind);
    if (k !== 'buff' && k !== 'shield' && k !== 'temphp' && k !== 'condition') continue;
    if (!Array.isArray(target.effects)) target.effects = [];
    const before = target.effects.length;
    const applied = safe(() => applyEffect(ctx, ch, target, {
      ...eff, dc, spellId, concentration: !!sp.concentration,
    }, { r: rng, log }), null);
    if (!applied) continue;
    stampExpiry(target, eff, sp, st, before, applied);
    lines.push(`${target.name}: ${eff.name || sp.name} takes hold.`);
  }

  for (const l of worldLines) lines.push(l);

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

/**
 * Roll and apply the spell's heal block. This mirrors what rules/combat.js does
 * for the same spell in a fight — same dice, same scaling, same "does this add
 * the caster's spellcasting modifier" rule — and goes through healTarget so the
 * dying, the stabilised and the dead are treated correctly rather than having
 * their hp poked directly.
 */
function healWith(ctx, caster, target, sp, level, log) {
  const h = obj(sp.heal);
  const dice = safe(() => spellHealDice(sp, level), h.dice) || h.dice || null;
  const rolled = dice ? (safe(() => rollExpr(String(dice), rng).total, 0) || 0) : 0;
  const bonus = h.mod === 'spell'
    ? safe(() => abilityMod(caster, (caster.spells && caster.spells.ability) || 'wis'), 0)
    : 0;
  const total = Math.max(0, rolled + bonus);
  if (total <= 0) return 0;
  const res = safe(() => healTarget(ctx, target, total), null);
  if (res && Array.isArray(res.log)) log.push(...res.log);
  return res ? res.healed : 0;
}

/**
 * Give the freshly-applied effect a world-clock expiry.
 *
 * combat.js ticks `dur` in rounds; out here nothing does, so a numeric `dur`
 * would simply freeze. We clear it and record `until` in absolute minutes
 * instead — expireFieldBuffs sweeps it, and fieldBuffsToRounds converts it back
 * when a fight starts.
 *
 * `before` is the length of target.effects prior to applyEffect. applyEffect
 * only pushes there for buffs and mech-carrying wards: temp hp and conditions
 * go elsewhere entirely. Without that check this stamped — and mangled — an
 * unrelated effect that happened to be last in the list.
 */
function stampExpiry(target, eff, sp, st, before, applied) {
  if (!target || !st) return;
  const mins = minutesFor(eff.duration || sp.duration);
  const until = mins == null ? null : clockMinutes(st) + mins;

  if (Array.isArray(target.effects) && target.effects.length > before) {
    const inst = target.effects[target.effects.length - 1];
    if (inst) {
      inst.field = true;
      inst.dur = null;                       // no longer ticks per round
      inst.until = until;
      inst.name = inst.name || eff.name || sp.name;
    }
    return;
  }

  // A helpful condition (Invisibility, Heroism's fright immunity). Conditions
  // live in their own list and are ticked by combat's turn boundaries, which
  // never come around out here — so they get the same world-clock treatment.
  if (applied && applied.kind === 'condition' && applied.id) {
    const inst = safe(() => conditionInstance(target, applied.id), null);
    if (inst) {
      inst.field = true;
      inst.dur = null;
      inst.until = until;
    }
  }
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
    if (!ch) continue;
    let changed = false;

    if (Array.isArray(ch.effects) && ch.effects.length) {
      const before = ch.effects.length;
      ch.effects = ch.effects.filter((e) => {
        if (!e || !e.field || e.until == null) return true;
        if (now < e.until) return true;
        gone.push(`${ch.name}: ${e.name || 'a spell'} fades.`);
        return false;
      });
      changed = changed || ch.effects.length !== before;
    }

    // Conditions applied out of combat expire the same way: nothing else will
    // ever tick them, because their clock is the turn boundary.
    if (Array.isArray(ch.conditions) && ch.conditions.length) {
      for (const c of ch.conditions.slice()) {
        if (!c || !c.field || c.until == null || now < c.until) continue;
        safe(() => removeCondition(ch, c.id, { source: c.source ?? null }));
        gone.push(`${ch.name}: ${c.id} fades.`);
        changed = true;
      }
    }

    if (changed) { ch._mech = null; safe(() => recalc(ch)); }
  }
  return gone;
}

/**
 * Convert field buffs back into round counts as a fight begins, so a ward with
 * two minutes left is worth twenty rounds and one with eight hours is worth the
 * whole battle.
 */
export function fieldBuffsToRounds(ch, st) {
  if (!ch) return;
  const now = clockMinutes(st);
  const convert = (e) => {
    if (!e || !e.field) return;
    if (e.until == null) { e.dur = null; return; }
    e.dur = Math.max(1, Math.round((e.until - now) * 10));
  };
  if (Array.isArray(ch.effects)) for (const e of ch.effects) convert(e);
  if (Array.isArray(ch.conditions)) for (const c of ch.conditions) convert(c);
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
  const said = (ok, text) => ({ ok, text });

  switch (tag) {
    case 'light': {
      const r = Number(mech.lightRadius) || 20;
      if (typeof w.light === 'function') safe(() => w.light(r, sp.id, minutesFor(sp.duration)));
      return said(true, `A ${r}-foot pool of light follows ${ch.name}.`);
    }
    case 'unlock': {
      const done = typeof w.unlock === 'function' ? safe(() => w.unlock(), null) : null;
      if (done && done.ok) return said(true, done.text || 'The lock springs open with a loud metallic knock.');
      return said(false, (done && done.text) || 'Nothing within reach is locked.');
    }
    case 'detect-magic': {
      const found = typeof w.detect === 'function' ? safe(() => w.detect('magic'), null) : null;
      if (found && found.count) {
        return said(true, `The Weave answers: ${found.count} enchanted thing${found.count === 1 ? '' : 's'} nearby.`);
      }
      // Learning that there is nothing here IS the answer a divination gives,
      // so this one has done its job even when the count is zero.
      return said(true, 'Nothing nearby carries an enchantment.');
    }
    case 'create-item': {
      // Spell data names the fiction ('goodberry'); the catalogue names the
      // item ('goodberry-preserve'). Try the spell's id, then the nearest thing
      // the pack can actually hold, rather than silently conjuring nothing.
      const wanted = [mech.itemId, mech.item, `${mech.itemId}-preserve`].filter(Boolean);
      const qty = Number(mech.qty) || 1;
      const party = env.party;
      if (!party || typeof party.addItem !== 'function') return said(false, 'The conjuring will not hold.');
      for (const id of wanted) {
        if (!safe(() => !!resolveItem(id), false)) continue;
        if (!safe(() => party.addItem(id, qty), false)) continue;
        const nm = safe(() => resolveItem(id).name, null) || String(id).replace(/-/g, ' ');
        return said(true, `${qty} ${nm} in cupped hands.`);
      }
      return said(false, 'The conjuring will not hold.');
    }
    case 'telekinesis': {
      const done = typeof w.reach === 'function' ? safe(() => w.reach(Number(mech.carryLimit) || 10), null) : null;
      if (done && done.ok) return said(true, done.text || 'The spectral hand fetches it back.');
      return said(false, 'The spectral hand drifts, finds nothing worth fetching, and fades.');
    }
    case 'identify': {
      const done = typeof w.identify === 'function' ? safe(() => w.identify(), null) : null;
      if (done && done.ok) return said(true, done.text || 'It gives up its name.');
      return said(false, (done && done.text) || 'Nothing in the pack is a mystery.');
    }
    // Flavour verbs with no world state behind them yet. They still cost the
    // slot, because in the fiction they still happen.
    case 'purify':
    case 'water':
    case 'clean':
    case 'mend':
    case 'comprehend':
    case 'disguise':
    case 'alarm':
      return said(true, `${sp.name} takes hold.`);
    default:
      return null;
  }
}
