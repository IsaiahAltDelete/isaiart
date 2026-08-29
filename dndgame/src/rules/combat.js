// rules/combat.js — the tactical encounter engine: initiative, turns, the action
// economy, movement on the 5-ft grid, reactions, death saves and the spoils.
//
// Design contract:
//   * HEADLESS. No canvas, no DOM, no timers. ui/combatui.js asks this module what
//     is legal, tells it what the player chose, and animates the structured results.
//   * An Encounter IS the `ctx` that rules/actions.js duck-types: it exposes
//     { units, map, rng, round, turnIndex, rules, byUid(uid), onLog(entry) }.
//   * Every die goes through core/dice.js -> core/rng.js. Never Math.random().
//   * Defensive by contract. The UI may call these in any order, with half-built
//     characters, unknown ids, a missing map or no data catalogues at all. Nothing
//     in here may throw; it degrades and says so in `log`.
//   * 2024 PHB rules that are easy to get wrong are commented where they happen.

import { FEET_PER_TILE, clamp, signed } from '../constants.js';
import { makeRNG, rng as globalRng } from '../core/rng.js';
import { d20, rollExpr } from '../core/dice.js';
import { bus, EV } from '../core/events.js';

import {
  uid as newUid, isDead, isDown, weaponsOf, mechOf, hasPassive, hasFeat,
  hasFightingStyle, classLevel, abilityMod, abilityScore, profBonus,
  acOf, speedOf, maxHpOf, equippedDef, removeItem,
  revive as characterRevive, recalc,
} from './character.js';

import {
  addCondition, removeCondition, hasCondition, conditionMech, tickConditions,
  conditionName, activeConditions, speedWithConditions, expireSourceConditions,
} from './conditions.js';

import {
  isConcentrating, breakConcentration, startConcentration, spendSlot,
  availableSlots, knownSpells, spellDC, spellAtk, setUnitResolver, casterLevel,
} from './spellcasting.js';

import {
  resolveAttack, resolveSave, abilityCheck, applyDamage, healTarget, grantTempHp,
  distanceFt, lineOfSight, areaTiles, unitsInArea, opportunityCheck, rollInitiative,
  isHostile, isAlly, tileOf, unitAt, resetTurnUses, grappleAction, shoveAction,
  reachFt, applyEffect, TILE_FLAGS, saveDCFor,
} from './actions.js';

import {
  getSpell, spellDamageDice, spellHealDice, rangeFeet, spellName,
} from '../data/spells.js';
import { resolveItem, itemName } from '../data/items.js';
import { MONSTERS, xpOf, xpForCR, profForCR } from '../data/monsters.js';

// These two are written by sibling modules. Namespace imports mean a missing export
// is `undefined` rather than a link-time explosion, so a half-finished sibling can
// never stop a battle from starting.
import * as Scaling from './scaling.js';
import * as Progression from './progression.js';

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const lower = (s) => String(s == null ? '' : s).toLowerCase();
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const kxy = (x, y) => `${x},${y}`;

const SIZE_ORDER = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
const sizeRank = (ch) => {
  const i = SIZE_ORDER.indexOf(lower(ch?.size || 'medium'));
  return i < 0 ? 2 : i;
};

/** Extra event names this module fires that core/events.js has no constant for. */
export const COMBAT_EV = Object.freeze({
  MOVE: 'combat:move',
  REACTION: 'combat:reaction',
  ACTION: 'combat:action',
  INITIATIVE: 'combat:initiative',
  SUMMON: 'combat:summon',
  FLEE: 'combat:flee',
});

/** Conditions that only make sense inside a fight and are stripped when it ends. */
const TRANSIENT_CONDITIONS = [
  'dodging', 'disengaging', 'reckless', 'vexed', 'sapped', 'helped', 'hidden',
  'shielded', 'slow-mastery', 'marked', 'raging', 'blessed', 'hasted', 'lethargic',
];

/** The eight 2024 "you can always do this" actions, plus the two grapple actions. */
const BASIC_ACTIONS = [
  { id: 'dash', kind: 'dash', name: 'Dash', cost: 'action', icon: 'boot', desc: 'Gain extra movement equal to your Speed for this turn.' },
  { id: 'disengage', kind: 'disengage', name: 'Disengage', cost: 'action', icon: 'boot', desc: 'Your movement does not provoke Opportunity Attacks this turn.' },
  { id: 'dodge', kind: 'dodge', name: 'Dodge', cost: 'action', icon: 'shield-half', desc: 'Attacks against you have Disadvantage and you make Dexterity saves with Advantage until your next turn.' },
  { id: 'hide', kind: 'hide', name: 'Hide', cost: 'action', icon: 'hide', desc: 'Make a DC 15 Stealth check to become Hidden.' },
  { id: 'help', kind: 'help', name: 'Help', cost: 'action', icon: 'hand', desc: 'Give an ally Advantage on their next attack against a foe within 5 feet of you.' },
  { id: 'shove', kind: 'shove', name: 'Shove', cost: 'action', icon: 'hand', desc: 'Athletics contest to knock a creature Prone or push it 5 feet.' },
  { id: 'grapple', kind: 'grapple', name: 'Grapple', cost: 'action', icon: 'hand', desc: 'Athletics contest to seize a creature; it becomes Grappled.' },
  { id: 'search', kind: 'special', name: 'Search', cost: 'action', icon: 'eye', desc: 'Make a Perception check to find something hidden.' },
  { id: 'ready', kind: 'ready', name: 'Ready', cost: 'action', icon: 'hourglass', desc: 'Prepare an action to trigger on a condition you name, using your Reaction.' },
  { id: 'use-object', kind: 'special', name: 'Use Object', cost: 'action', icon: 'hand', desc: 'Interact with a second object this turn.' },
  { id: 'influence', kind: 'special', name: 'Influence', cost: 'action', icon: 'speech', desc: 'Try to talk a creature down with a Charisma check.' },
];

// ===========================================================================
// The Encounter
// ===========================================================================

export class Encounter {
  /**
   * opts: {
   *   party,              // Character[] — or a party-like { members, inventory, gold }
   *   enemies,            // Character[] | monsterId[] | [{id,count,level,elite,boss}]
   *   map,                // TileMap-ish; may carry map.deploy = { party:[], foe:[] }
   *   seed, biome, ambush, boss, depth, difficulty,
   *   bag,                // shared party inventory [{uid,id,qty}] for the item menu
   *   onLog(entry),       // UI log sink
   *   onReaction(reactor, offer, enc) -> optionId|bool|null
   *   rules:{ flanking:false }
   * }
   */
  constructor(opts = {}) {
    const o = opts || {};

    // --- identity & determinism -------------------------------------------
    this.id = newUid('enc');
    this.seed = o.seed != null ? o.seed : `battle-${Date.now()}`;
    this.rng = makeRNG(this.seed);
    this.biome = o.biome || o.map?.biome || 'plains';
    this.ambush = !!o.ambush;
    this.boss = !!o.boss;
    this.depth = num(o.depth, 0);
    this.difficulty = o.difficulty || 'medium';
    this.rules = { flanking: false, ...(o.rules || {}) };

    // --- the battlefield ---------------------------------------------------
    this.map = o.map || null;
    this.w = num(this.map?.w, 22);
    this.h = num(this.map?.h, 15);

    // --- log ---------------------------------------------------------------
    this.log = [];                 // [{ text, kind, unit, round }]
    this._userLog = typeof o.onLog === 'function' ? o.onLog : null;
    this._scopeLines = null;       // set while perform() collects its own lines

    // --- reaction interface ------------------------------------------------
    this._onReaction = typeof o.onReaction === 'function' ? o.onReaction : null;

    // --- rosters -----------------------------------------------------------
    const partyLike = o.party && !Array.isArray(o.party) ? o.party : null;
    const partyList = Array.isArray(o.party) ? o.party : arr(partyLike?.members);
    this.party = partyList.filter(Boolean);
    this.bag = Array.isArray(o.bag) ? o.bag : (Array.isArray(partyLike?.inventory) ? partyLike.inventory : []);
    this.purse = partyLike || null;

    this.enemies = this._buildEnemies(o.enemies);
    this.units = [];
    this.order = [];
    this.initiative = {};
    this.round = 0;
    this.turnIndex = 0;
    this.state = 'setup';
    this.budget = null;
    this.summons = [];
    this.defeated = [];            // units killed during the fight, for awardXp()
    this.escaped = [];
    this.rewards = null;
    this._byUid = new Map();
    this._turnToken = null;
    this._surprised = new Set();

    this._register();

    // spellcasting.js needs a uid -> unit resolver so breaking Concentration can
    // reach every creature the spell was riding on.
    try { setUnitResolver((uid) => this.byUid(uid)); } catch { /* optional */ }
  }

  // -------------------------------------------------------------------------
  // ctx surface used by rules/actions.js
  // -------------------------------------------------------------------------

  byUid(uid) { return this._byUid.get(uid) || null; }

  /** actions.js pushes its log lines here (it checks ctx.log first, which is our array). */
  onLog(entry) {
    if (!entry) return;
    this._push(entry.text, entry.kind || 'info', entry.unit || null);
  }

  /** Append one readable line in D&D voice. */
  _push(text, kind = 'info', unit = null) {
    if (!text) return null;
    const line = {
      text: String(text), kind,
      unit: unit ? (unit.uid || unit) : null,
      round: this.round,
    };
    this.log.push(line);
    if (this.log.length > 600) this.log.splice(0, this.log.length - 600);
    if (this._scopeLines) this._scopeLines.push(line);
    if (this._userLog) { try { this._userLog(line); } catch { /* a UI hiccup is never fatal */ } }
    return line;
  }

  /** Collect the lines produced inside `fn` so perform() can hand them back. */
  _scope(fn) {
    const lines = [];
    const prev = this._scopeLines;
    this._scopeLines = lines;
    let out;
    try { out = fn(lines); } finally { this._scopeLines = prev; }
    return { out, lines };
  }

  // -------------------------------------------------------------------------
  // Roster construction
  // -------------------------------------------------------------------------

  /**
   * Enemies may arrive as finished Characters, as bare monster ids, or as
   * { id, count } spawn requests. Anything we cannot resolve is skipped with a log
   * line rather than crashing the battle.
   */
  _buildEnemies(input) {
    const out = [];
    for (const e of arr(input)) {
      if (!e) continue;
      if (typeof e === 'object' && (e.uid || e.hp != null) && !e.count) { out.push(e); continue; }
      const id = typeof e === 'string' ? e : e.id || e.monsterId;
      const count = Math.max(1, num(typeof e === 'object' ? e.count : 1, 1));
      for (let i = 0; i < count; i++) {
        const m = this._spawnMonster(id, typeof e === 'object' ? e : {});
        if (m) out.push(m);
      }
    }
    return out;
  }

  /** Build one monster Character, preferring rules/scaling.js when it is available. */
  _spawnMonster(monsterId, opts = {}) {
    if (!monsterId) return null;
    if (typeof Scaling.makeMonster === 'function') {
      try {
        const m = Scaling.makeMonster(monsterId, {
          level: opts.level, elite: opts.elite, boss: opts.boss,
          depth: this.depth, rng: this.rng, seed: this.seed,
        });
        if (m) return m;
      } catch { /* fall through to the local builder */ }
    }
    return quickMonster(monsterId, this.rng, opts);
  }

  _register() {
    this._byUid.clear();
    for (const u of this.units) if (u?.uid) this._byUid.set(u.uid, u);
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  /**
   * Place everyone, roll Initiative, build `order` and open the first turn.
   * Idempotent: calling start() twice never re-rolls a fight in progress.
   */
  start() {
    if (this.state !== 'setup') return this;

    this.units = [];
    for (const p of this.party) {
      if (!p) continue;
      p.side = 'party';
      p.kind = p.kind || 'pc';
      this.units.push(p);
    }
    for (const e of this.enemies) {
      if (!e) continue;
      e.side = 'foe';
      e.kind = e.kind || 'monster';
      this.units.push(e);
    }
    this._register();

    this._deploy();
    this._rollInitiative();

    this.round = 1;
    this.turnIndex = 0;
    this.state = 'active';
    this._turnToken = null;

    const foeNames = summarise(this.enemies.map((e) => e?.name || 'a creature'));
    this._push(this.ambush
      ? `Ambush! ${foeNames} burst from cover — roll for Initiative!`
      : `Battle begins: ${foeNames}. Roll for Initiative!`, 'round');
    for (const uid of this.order) {
      const u = this.byUid(uid);
      const rec = this.initiative[uid];
      if (!u || !rec) continue;
      // rec.text already ends in "= <total>", so don't append it a second time.
      this._push(`${u.name || 'A combatant'} rolls Initiative: ${rec.text}${rec.dis ? ' (Disadvantage — surprised)' : ''}.`, 'info', u);
    }

    bus.emit(EV.COMBAT_START, { enc: this, units: this.units, ambush: this.ambush, boss: this.boss });
    bus.emit(COMBAT_EV.INITIATIVE, { enc: this, order: this.order, initiative: this.initiative });

    this.beginTurn();
    this._checkEnd();      // a fight with nobody left on one side is over on arrival
    return this;
  }

  /** Put everyone on the grid: the map's own deployment zones, or a sane formation. */
  _deploy() {
    const taken = new Set();
    const claim = (x, y) => { taken.add(kxy(x, y)); };
    const free = (x, y) => this._inBounds(x, y) && !this._isSolid(x, y) && !taken.has(kxy(x, y));

    const deploy = this.map?.deploy || null;
    const partySpots = arr(deploy?.party).slice();
    const foeSpots = arr(deploy?.foe).slice();

    const midY = Math.floor(this.h / 2);
    const parties = this.units.filter((u) => u.side === 'party');
    const foes = this.units.filter((u) => u.side === 'foe');

    // Fallback formations. Normally two ranks facing off across the arena; on an
    // ambush the party is bunched in the middle with foes interspersed around them.
    const fallbackParty = [];
    const fallbackFoe = [];
    if (this.ambush) {
      const cx = Math.floor(this.w / 2), cy = midY;
      for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, 0], [-1, 1]]) {
        fallbackParty.push({ x: cx + dx, y: cy + dy });
      }
      for (let ring = 2; ring <= 5; ring++) {
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2;
          fallbackFoe.push({
            x: Math.round(cx + Math.cos(ang) * ring),
            y: Math.round(cy + Math.sin(ang) * ring * 0.7),
          });
        }
      }
    } else {
      const rows = [midY, midY - 1, midY + 1, midY - 2, midY + 2, midY - 3, midY + 3];
      for (const col of [3, 2, 4, 1]) for (const ry of rows) fallbackParty.push({ x: col, y: ry });
      for (const col of [this.w - 4, this.w - 3, this.w - 5, this.w - 2]) {
        for (const ry of rows) fallbackFoe.push({ x: col, y: ry });
      }
    }

    const place = (unit, spots, fallback) => {
      // An existing .pos survives if it is still a legal square (a battle continued
      // from a previous scene, or a summon that already has a spot).
      if (unit.pos && free(unit.pos.x, unit.pos.y)) { claim(unit.pos.x, unit.pos.y); return; }
      let spot = null;
      while (spots.length && !spot) { const s = spots.shift(); if (s && free(s.x, s.y)) spot = s; }
      while (!spot && fallback.length) { const s = fallback.shift(); if (s && free(s.x, s.y)) spot = s; }
      if (!spot) spot = this._nearestFree(Math.floor(this.w / 2), midY, taken);
      unit.pos = { x: spot.x, y: spot.y };
      claim(spot.x, spot.y);
    };

    for (const u of parties) place(u, partySpots, fallbackParty);
    for (const u of foes) place(u, foeSpots, fallbackFoe);
  }

  /** Spiral out from a point until a legal, unclaimed square turns up. */
  _nearestFree(cx, cy, taken = new Set()) {
    for (let r = 0; r < Math.max(this.w, this.h); r++) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
          if (!this._inBounds(x, y) || this._isSolid(x, y)) continue;
          if (taken.has(kxy(x, y))) continue;
          if (unitAt(this, x, y)) continue;
          return { x, y };
        }
      }
    }
    return { x: clamp(cx, 1, this.w - 2), y: clamp(cy, 1, this.h - 2) };
  }

  /**
   * Roll Initiative for everyone.
   * 2024 PHB: Surprise is no longer a lost turn — a surprised creature rolls its
   * Initiative with Disadvantage. Rolling twice and keeping the lower total is
   * exactly that, since both rolls carry the same modifier.
   */
  _rollInitiative() {
    const records = [];
    for (const u of this.units) {
      if (!u) continue;
      const surprised = this.ambush && u.side === 'party' && !hasFeat(u, 'alert');
      if (surprised) this._surprised.add(u.uid);

      let rec = safe(() => rollInitiative(this, u), null)
        || { roll: d20(abilityMod(u, 'dex'), {}, this.rng), total: 10, tiebreak: 10 };
      if (rec.total == null) rec.total = rec.roll?.total ?? 10;

      if (surprised) {
        const second = safe(() => rollInitiative(this, u), null);
        if (second && second.total < rec.total) rec = second;
      }

      records.push({
        uid: u.uid,
        unit: u,
        total: num(rec.total, 10),
        roll: rec.roll || null,
        text: rec.roll?.text || `d20 = ${num(rec.total, 10)}`,
        dis: surprised,
        // Ties break toward the higher Dexterity, then a coin-flip roll.
        dex: safe(() => abilityScore(u, 'dex'), 10),
        jitter: this.rng.next(),
      });
    }

    records.sort((a, b) => (b.total - a.total) || (b.dex - a.dex) || (b.jitter - a.jitter));

    this.order = records.map((r) => r.uid);
    this.initiative = {};
    for (const r of records) {
      this.initiative[r.uid] = {
        total: r.total, roll: r.roll, text: r.text, dis: r.dis, dex: r.dex, jitter: r.jitter,
      };
      if (r.unit) r.unit.initiativeRoll = r.total;
    }
  }

  // -------------------------------------------------------------------------
  // Turn structure
  // -------------------------------------------------------------------------

  get current() {
    if (!this.order.length) return null;
    const uid = this.order[clamp(this.turnIndex, 0, this.order.length - 1)];
    return this.byUid(uid);
  }

  /** Who is up, as a uid — handy for the UI's initiative rail. */
  get currentUid() { return this.order[clamp(this.turnIndex, 0, this.order.length - 1)] || null; }

  /**
   * Open the current creature's turn: refresh its action, Bonus Action, Reaction,
   * movement and free object interaction, tick start-of-turn conditions, and roll a
   * death saving throw if it is dying.
   * Idempotent — the same (round, turnIndex) never opens twice.
   */
  beginTurn() {
    if (this.state !== 'active') return { ok: false, reason: this.state };
    const token = `${this.round}:${this.turnIndex}`;
    if (this._turnToken === token) return { ok: true, already: true, unit: this.current };

    const unit = this.current;
    if (!unit) { this._turnToken = token; return { ok: false, reason: 'no-unit' }; }

    // A corpse never gets a turn; slide past it.
    if (isDead(unit)) { this._turnToken = token; return this.endTurn(); }

    this._turnToken = token;
    resetTurnUses(unit);
    unit._reactionUsed = false;
    if (unit.flags) unit.flags.reactionUsed = false;

    this.budget = this._makeBudget(unit);
    unit._budget = this.budget;

    this._push(`— ${unit.name || 'A combatant'}'s turn (round ${this.round}) —`, 'turn', unit);
    bus.emit(EV.TURN_START, { enc: this, unit, uid: unit.uid, round: this.round });

    // Start-of-turn conditions: Burning/Bleeding damage, and everything that lasted
    // "until the start of your next turn" (Dodge, Shield, Reckless) expiring.
    for (const line of safe(() => tickConditions(unit, 'turn-start', { rng: this.rng }), [])) {
      this._push(line.text, line.kind || 'info', unit);
    }

    // Death saving throws happen at the start of the dying creature's turn.
    if (unit.kind === 'pc' && unit.hp <= 0 && !isDead(unit)) {
      const ds = this.rollDeathSave(unit);
      if (ds.dead || !ds.revived) {
        // Still down (or newly dead): nothing else can be done this turn.
        this._checkEnd();
        if (this.state === 'active') return this.endTurn();
        return { ok: true, unit, downed: true };
      }
    }

    // A creature that cannot act at all (Stunned, Paralyzed, Petrified) is skipped
    // once its conditions have ticked — but it still gets its end-of-turn saves.
    const cm = conditionMech(unit);
    if (cm.noActions && cm.speed === 0 && !isDown(unit)) {
      this._push(`${unit.name || 'The creature'} can do nothing — ${cm.ids.map((i) => conditionName(i)).join(', ') || 'incapacitated'}.`, 'debuff', unit);
      return this.endTurn();
    }

    this._checkEnd();
    return { ok: true, unit, budget: this.budget, round: this.round };
  }

  /** Build the per-turn budget object the UI reads to grey out buttons. */
  _makeBudget(unit) {
    const cm = conditionMech(unit);
    const mech = safe(() => mechOf(unit), {}) || {};
    const speed = safe(() => speedWithConditions(unit, speedOf(unit)), speedOf(unit));
    const extra = Math.max(num(mech.extraAttack), num(unit.extraAttacks));
    return {
      action: cm.noActions ? 0 : 1 + num(cm.extraAction),
      bonus: cm.noBonusActions ? 0 : 1,
      reaction: cm.noReactions ? 0 : 1,
      movement: speed,
      moveMax: speed,
      moveUsed: 0,
      objectInteraction: 1,
      // The Attack action grants 1 + Extra Attack swings; `attacksLeft` counts the
      // follow-ups still owed once the action itself has been spent.
      extraAttacks: extra,
      attacksLeft: 0,
      attacksMade: 0,
      freeAttacks: 0,          // the Nick mastery's free Light-weapon attack
      dashUsed: 0,
      readied: null,
      spellsCast: [],
      log: [],
    };
  }

  /** The budget to test options against; off-turn callers get a cached one. */
  _budgetFor(unit) {
    if (!unit) return this._makeBudget({});
    if (unit === this.current && this.budget) return this.budget;
    if (!unit._budget) unit._budget = this._makeBudget(unit);
    return unit._budget;
  }

  /**
   * Close the current turn: end-of-turn condition saves and expiries, Concentration
   * duration, effect durations, then advance to the next living creature (and the
   * next round when the order wraps).
   */
  endTurn() {
    if (this.state !== 'active') return { ok: false, reason: this.state };
    const unit = this.current;

    if (unit) {
      // End-of-turn repeat saves, duration ticks, and the riders this creature hung
      // on other creatures that expire with its turn (Vex, Sap, Help).
      for (const line of safe(() => tickConditions(unit, 'turn-end', { rng: this.rng, sourceUid: unit.uid }), [])) {
        this._push(line.text, line.kind || 'info', unit);
      }
      for (const line of safe(() => expireSourceConditions(this.units, unit.uid), [])) {
        this._push(line.text, line.kind || 'info');
      }
      this._tickEffects(unit);
      this._tickConcentration(unit);
      bus.emit(EV.TURN_END, { enc: this, unit, uid: unit.uid, round: this.round });
    }

    if (this._checkEnd()) return { ok: true, over: true, state: this.state };

    return this._advance();
  }

  /** Step the initiative pointer, skipping the dead, and open the next turn. */
  _advance() {
    if (!this.order.length) { this.state = 'defeat'; return { ok: false, reason: 'empty-order' }; }

    for (let guard = 0; guard <= this.order.length + 1; guard++) {
      this.turnIndex++;
      if (this.turnIndex >= this.order.length) {
        this.turnIndex = 0;
        this.round++;
        this._push(`Round ${this.round}.`, 'round');
        bus.emit(EV.ROUND, { enc: this, round: this.round });
        if (this.round > 200) {      // runaway guard: nobody fights for an hour
          this.state = 'fled';
          this._push('The fight peters out with nobody willing to close.', 'info');
          this._finish();
          return { ok: true, over: true, state: this.state };
        }
      }
      const next = this.current;
      if (next && !isDead(next)) {
        this._turnToken = null;
        return this.beginTurn();
      }
    }

    this._checkEnd();
    return { ok: false, reason: 'nobody-left' };
  }

  /** Effects with a numeric round duration tick down at the end of the owner's turn. */
  _tickEffects(unit) {
    if (!unit || !Array.isArray(unit.effects) || !unit.effects.length) return;
    let changed = false;
    unit.effects = unit.effects.filter((e) => {
      if (!e) return false;
      if (typeof e.dur !== 'number') return true;
      e.dur -= 1;
      if (e.dur > 0) return true;
      changed = true;
      this._push(`${unit.name || 'The creature'}: ${e.name || e.id || 'a magical effect'} fades.`, 'info', unit);
      return false;
    });
    if (changed) { unit._mech = null; safe(() => recalc(unit)); }
  }

  /** A concentration spell with a round count runs out at the end of the caster's turn. */
  _tickConcentration(unit) {
    const c = unit?.concentration;
    if (!c) return;
    if (typeof c.dur === 'number') {
      c.dur -= 1;
      if (c.dur <= 0) {
        const nm = spellName(c.spellId) || 'the spell';
        safe(() => breakConcentration(unit, 'the spell ran its course'));
        this._push(`${unit.name || 'The caster'}'s ${nm} ends.`, 'info', unit);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Death
  // -------------------------------------------------------------------------

  /**
   * One death saving throw. DC 10, no ability modifier (2024 PHB); three successes
   * stabilise, three failures kill, a natural 20 brings you back at 1 hit point and
   * a natural 1 counts as two failures. Damage taken while down is handled inside
   * character.js damage(), which adds one failure — two on a Critical Hit.
   */
  rollDeathSave(unit) {
    const out = { ok: true, rolled: false, success: false, dead: false, stable: false, revived: false, roll: null };
    if (!unit || unit.kind !== 'pc') return out;
    if (unit.hp > 0 || isDead(unit)) return out;

    unit.deathSaves = unit.deathSaves || { success: 0, fail: 0, stable: false };
    if (unit.deathSaves.stable) {
      this._push(`${unit.name} is stable but unconscious.`, 'info', unit);
      out.stable = true;
      return out;
    }

    // Exhaustion's penalty applies to every D20 Test in 2024, death saves included.
    const cm = conditionMech(unit);
    const roll = d20(cm.d20Penalty + cm.d20Bonus, { adv: !!cm.deathSaveAdv }, this.rng);
    out.rolled = true;
    out.roll = roll;

    if (roll.natural === 20) {
      // A natural 20 on a death save: you regain 1 hit point and stand up.
      safe(() => characterRevive(unit, 1));
      removeCondition(unit, 'dying');
      removeCondition(unit, 'stabilised');
      removeCondition(unit, 'unconscious');
      out.revived = true;
      out.success = true;
      this._push(`${unit.name} makes a death saving throw: ${roll.text} — a natural 20! ${unit.name} surges back to consciousness with 1 hit point.`, 'heal', unit);
      bus.emit(EV.HEAL, { ch: unit, uid: unit.uid, amount: 1, hp: unit.hp });
      return out;
    }

    if (roll.natural === 1) {
      unit.deathSaves.fail = clamp(unit.deathSaves.fail + 2, 0, 3);
      this._push(`${unit.name} makes a death saving throw: ${roll.text} — a natural 1, two failures (${unit.deathSaves.fail}/3).`, 'miss', unit);
    } else if (roll.total >= 10) {
      unit.deathSaves.success = clamp(unit.deathSaves.success + 1, 0, 3);
      out.success = true;
      this._push(`${unit.name} makes a death saving throw: ${roll.text} vs DC 10 — success (${unit.deathSaves.success}/3).`, 'save', unit);
    } else {
      unit.deathSaves.fail = clamp(unit.deathSaves.fail + 1, 0, 3);
      this._push(`${unit.name} makes a death saving throw: ${roll.text} vs DC 10 — failure (${unit.deathSaves.fail}/3).`, 'miss', unit);
    }

    if (unit.deathSaves.fail >= 3) {
      out.dead = true;
      unit.deathSaves.stable = false;
      safe(() => breakConcentration(unit, 'died'));
      this._push(`${unit.name} has died. May Kelemvor judge them kindly.`, 'death', unit);
      bus.emit(EV.DEATH, { enc: this, ch: unit, uid: unit.uid });
      this._checkEnd();
      return out;
    }
    if (unit.deathSaves.success >= 3) {
      out.stable = true;
      unit.deathSaves.stable = true;
      unit.deathSaves.success = 0;
      unit.deathSaves.fail = 0;
      addCondition(unit, 'stabilised', { source: unit.uid });
      removeCondition(unit, 'dying');
      this._push(`${unit.name} stabilises — unconscious, but no longer dying.`, 'heal', unit);
    }
    return out;
  }

  /** Note a kill for XP and the log, once, when a creature drops for good. */
  _noteDeath(unit, killer = null) {
    if (!unit || unit._counted) return;
    if (!isDead(unit)) return;
    unit._counted = true;
    this.defeated.push(unit);
    safe(() => breakConcentration(unit, 'died'));
    if (unit.side === 'foe') {
      this._push(`${unit.name || 'The creature'} falls.`, 'death', unit);
      bus.emit(EV.KILL, { enc: this, ch: unit, uid: unit.uid, killer: killer?.uid || null });
    }
    bus.emit(EV.DEATH, { enc: this, ch: unit, uid: unit.uid, killer: killer?.uid || null });
  }

  /** Sweep for creatures that dropped during a resolution step. */
  _sweepDeaths(killer = null) {
    for (const u of this.units) {
      if (!u) continue;
      if (isDead(u)) this._noteDeath(u, killer);
      else if (u.kind === 'pc' && u.hp <= 0 && !hasCondition(u, 'dying') && !hasCondition(u, 'stabilised')) {
        // Newly downed: mark the dying condition so the UI and the AI can see it.
        addCondition(u, 'dying', { source: killer?.uid || null });
        this._push(`${u.name} drops to 0 hit points and falls unconscious.`, 'death', u);
        bus.emit(EV.DOWNED, { enc: this, ch: u, uid: u.uid });
      }
    }
  }

  // =========================================================================
  // ACTION MENU
  // =========================================================================

  /**
   * Every action this creature could take right now, each with `enabled` and a
   * `reason` when it is not. The UI renders the whole list and greys out the rest.
   */
  availableActions(unit) {
    const out = [];
    if (!unit) return out;
    const b = this._budgetFor(unit);
    const cm = conditionMech(unit);

    const down = unit.hp <= 0;
    if (down) {
      out.push(opt({
        id: 'end', kind: 'end', name: 'End Turn', cost: 'free', icon: 'hourglass',
        desc: 'You are unconscious — there is nothing to do but hope.',
        enabled: true,
      }));
      return out;
    }

    this._attackOptions(unit, b, cm, out);
    this._monsterOptions(unit, b, cm, out);
    this._spellOptions(unit, b, cm, out);
    this._resourceOptions(unit, b, cm, out);
    this._itemOptions(unit, b, cm, out);
    this._basicOptions(unit, b, cm, out);

    out.push(opt({
      id: 'end', kind: 'end', name: 'End Turn', cost: 'free', icon: 'hourglass',
      desc: 'Finish your turn.', enabled: true,
    }));
    return out;
  }

  /** Weapon, off-hand and unarmed attacks, respecting Extra Attack. */
  _attackOptions(unit, b, cm, out) {
    // A creature with a stat block attacks with its stat block; a goblin has a
    // Scimitar action, not an equipped longsword and an unarmed strike.
    if (unit.kind === 'monster' && arr(unit.actions).length) return;
    const weapons = safe(() => weaponsOf(unit), []) || [];
    const canAct = b.action > 0 || b.attacksLeft > 0;
    for (const w of weapons) {
      const isBonus = w.cost === 'bonus';
      const isFree = w.cost === 'free';
      let enabled = w.enabled !== false;
      let reason = w.reason || '';

      if (enabled) {
        if (cm.noActions && !isBonus) { enabled = false; reason = 'Incapacitated'; }
        else if (isBonus && b.bonus <= 0) { enabled = false; reason = 'No Bonus Action left'; }
        else if (isFree && b.freeAttacks <= 0 && b.attacksLeft <= 0 && b.action <= 0) { enabled = false; reason = 'Nothing left to attack with'; }
        else if (!isBonus && !isFree && !canAct) { enabled = false; reason = 'No action left'; }
      }

      const label = b.attacksLeft > 0 && !isBonus
        ? `${w.name} (${b.attacksLeft} attack${b.attacksLeft === 1 ? '' : 's'} left)`
        : w.name;

      out.push(opt({
        id: `attack:${w.id}`,
        kind: 'attack',
        name: label,
        cost: w.cost || 'action',
        icon: w.ranged ? 'bow' : 'sword',
        desc: `${signed(w.attackBonus)} to hit, ${w.damage?.dice || '1'}${w.damage?.mod ? signed(w.damage.mod) : ''} ${w.damage?.type || 'damage'}`
          + (w.mastery ? ` · ${w.mastery}` : ''),
        targeting: {
          kind: 'creature', range: w.range, needsLoS: true, allowAllies: false, count: 1,
        },
        enabled, reason,
        weaponId: w.id,
        attackBonus: w.attackBonus,
        damage: w.damage,
        mastery: w.mastery || null,
        ranged: !!w.ranged,
        extraAttacks: b.extraAttacks,
      }));
    }
  }

  /** A monster's stat-block actions, bonus actions and multiattack routine. */
  _monsterOptions(unit, b, cm, out) {
    const actions = arr(unit.actions);
    const bonuses = arr(unit.bonusActions);
    if (!actions.length && !bonuses.length) return;

    const build = (act, i, cost) => {
      if (!act) return;
      const uses = act.uses;
      const spent = unit._actionUses?.[act.id || act.name] || 0;
      const exhausted = uses && typeof uses.max === 'number' && spent >= uses.max;
      const pool = cost === 'bonus' ? b.bonus : (b.action > 0 || (act.kind === 'attack' && b.attacksLeft > 0));
      let enabled = !!pool && !exhausted;
      let reason = exhausted ? 'Recharging' : (!pool ? (cost === 'bonus' ? 'No Bonus Action left' : 'No action left') : '');
      if (cm.noActions && cost !== 'bonus') { enabled = false; reason = 'Incapacitated'; }

      const isArea = !!act.target && ['sphere', 'cone', 'line', 'cube', 'cylinder', 'area'].includes(lower(act.target.kind));
      out.push(opt({
        id: `${cost === 'bonus' ? 'mbonus' : 'mact'}:${i}`,
        kind: act.kind === 'multiattack' ? 'attack' : (act.kind === 'heal' ? 'special' : act.kind === 'save' ? 'spell' : 'attack'),
        name: act.name || 'Attack',
        cost,
        icon: act.kind === 'save' ? 'spell' : act.range ? 'bow' : 'claw',
        desc: act.desc || describeMonsterAction(act),
        targeting: {
          kind: isArea ? 'point' : (act.kind === 'heal' ? 'ally' : 'creature'),
          range: act.range || [act.reach || 5, act.reach || 5],
          shape: isArea ? act.target?.kind : null,
          radius: act.target?.radius || 0,
          length: act.target?.length || 0,
          width: act.target?.width || 0,
          needsLoS: true,
          allowAllies: act.kind === 'heal',
          count: act.target?.count || 1,
        },
        enabled, reason,
        monsterAction: act,
      }));
    };

    actions.forEach((a, i) => build(a, i, 'action'));
    bonuses.forEach((a, i) => build(a, i, 'bonus'));
  }

  /**
   * Every spell the creature can pay for right now — cantrips, prepared spells and
   * anything a feature keeps always-prepared — with the slot levels available.
   */
  _spellOptions(unit, b, cm, out) {
    const sp = unit.spells;
    if (!sp) return;

    const ids = new Set();
    for (const id of arr(sp.cantrips)) ids.add(id);
    for (const id of arr(sp.prepared)) ids.add(id);
    if (!ids.size) for (const id of safe(() => knownSpells(unit), []) || []) ids.add(id);
    if (!ids.size) return;

    const dc = safe(() => spellDC(unit), 10);
    const atk = safe(() => spellAtk(unit), 0);
    const clvl = Math.max(1, num(unit.level, safe(() => casterLevel(unit), 1)));

    for (const id of ids) {
      const spell = getSpell(id);
      if (!spell) continue;

      const ct = lower(spell.castTime || 'action');
      const cost = ct === 'bonus' ? 'bonus' : ct === 'reaction' ? 'reaction' : 'action';
      const levels = spell.level === 0 ? [0] : (safe(() => availableSlots(unit, spell.level), []) || []);

      let enabled = true;
      let reason = '';
      if (cm.cannotCast) { enabled = false; reason = 'You cannot cast while Raging'; }
      else if (spell.components?.v && cm.cannotSpeak) { enabled = false; reason = 'You cannot speak'; }
      else if (ct === 'reaction') { enabled = false; reason = 'Cast as a Reaction when its trigger occurs'; }
      else if (cost === 'bonus' && b.bonus <= 0) { enabled = false; reason = 'No Bonus Action left'; }
      else if (cost === 'action' && b.action <= 0) { enabled = false; reason = 'No action left'; }
      else if (spell.level > 0 && !levels.length) { enabled = false; reason = 'No spell slot of that level'; }
      else if (spell.concentration && cm.cannotConcentrate) { enabled = false; reason = 'You cannot concentrate'; }

      const t = spell.target || {};
      out.push(opt({
        id: `spell:${id}`,
        kind: 'spell',
        name: spell.name || id,
        cost,
        icon: 'spell',
        desc: spellBlurb(spell, dc, atk),
        targeting: {
          kind: t.kind || (spell.range === 'self' ? 'self' : 'creature'),
          range: rangeFeet(spell),
          shape: ['sphere', 'cone', 'line', 'cube', 'cylinder', 'wall'].includes(lower(t.kind)) ? lower(t.kind) : null,
          radius: num(t.radius),
          length: num(t.length),
          width: num(t.width, 5),
          count: num(t.count, 1),
          maxTargets: num(t.maxTargets, num(t.count, 1)),
          allowAllies: !!t.allowAllies || !!spell.heal || (spell.tags || []).includes('buff') || (spell.tags || []).includes('heal'),
          needsLoS: true,
        },
        enabled, reason,
        spellId: id,
        level: spell.level,
        levels,                                   // the slot levels this can be cast at
        concentration: !!spell.concentration,
        ritual: !!spell.ritual,
        dc, spellAttack: atk,
      }));
    }
  }

  /** Rage, Second Wind, Action Surge, Channel Divinity, Ki, Bardic Inspiration… */
  _resourceOptions(unit, b, cm, out) {
    const res = unit.resources || {};
    const left = (id) => {
      const r = res[id];
      return r ? Math.max(0, num(r.max) - num(r.used)) : 0;
    };
    const add = (o) => out.push(opt(o));

    const spendable = (id, cost) => {
      const n = left(id);
      if (n <= 0) return { enabled: false, reason: 'No uses left' };
      if (cost === 'bonus' && b.bonus <= 0) return { enabled: false, reason: 'No Bonus Action left' };
      if (cost === 'action' && b.action <= 0) return { enabled: false, reason: 'No action left' };
      return { enabled: true, reason: '' };
    };

    // --- Barbarian: Rage ----------------------------------------------------
    if (res.rage) {
      const raging = hasCondition(unit, 'raging');
      const s = spendable('rage', 'bonus');
      add({
        id: 'special:rage', kind: 'special', name: raging ? 'Rage (active)' : 'Rage', cost: 'bonus', icon: 'rage',
        desc: 'Resistance to bludgeoning, piercing and slashing damage, Advantage on Strength checks and saves, and bonus melee damage. You cannot cast spells while Raging.',
        enabled: !raging && s.enabled, reason: raging ? 'Already Raging' : s.reason,
        targeting: { kind: 'self' }, resourceId: 'rage', uses: left('rage'),
      });
    }

    // --- Fighter: Second Wind / Action Surge --------------------------------
    if (res['second-wind']) {
      const s = spendable('second-wind', 'bonus');
      const lvl = classLevel(unit, 'fighter') || unit.level || 1;
      add({
        id: 'special:second-wind', kind: 'special', name: 'Second Wind', cost: 'bonus', icon: 'heart',
        desc: `Regain 1d10 + ${lvl} hit points.`,
        enabled: s.enabled, reason: s.reason, targeting: { kind: 'self' },
        resourceId: 'second-wind', uses: left('second-wind'),
      });
    }
    if (res['action-surge']) {
      const n = left('action-surge');
      add({
        id: 'special:action-surge', kind: 'special', name: 'Action Surge', cost: 'free', icon: 'flame',
        desc: 'Take one additional action this turn.',
        enabled: n > 0 && !b.actionSurgeUsed, reason: n <= 0 ? 'No uses left' : (b.actionSurgeUsed ? 'Already surged this turn' : ''),
        targeting: { kind: 'self' }, resourceId: 'action-surge', uses: n,
      });
    }

    // --- Cleric / Paladin: Channel Divinity & Lay on Hands -------------------
    if (res['channel-divinity']) {
      const s = spendable('channel-divinity', 'action');
      add({
        id: 'special:channel-divinity', kind: 'special', name: 'Channel Divinity', cost: 'action', icon: 'holy',
        desc: 'Call on your deity: Turn Undead, or your subclass\'s expression of divine power.',
        enabled: s.enabled, reason: s.reason,
        targeting: { kind: 'area', shape: 'sphere', radius: 30, allowAllies: false, needsLoS: true },
        resourceId: 'channel-divinity', uses: left('channel-divinity'),
      });
    }
    if (res['lay-on-hands']) {
      const pool = Math.max(0, num(res['lay-on-hands'].max) - num(res['lay-on-hands'].used));
      add({
        id: 'special:lay-on-hands', kind: 'special', name: 'Lay on Hands', cost: 'bonus', icon: 'heart',
        desc: `A pool of ${pool} hit points of healing you can spend by touch.`,
        enabled: pool > 0 && b.bonus > 0, reason: pool <= 0 ? 'The pool is empty' : (b.bonus <= 0 ? 'No Bonus Action left' : ''),
        targeting: { kind: 'creature', range: 5, allowAllies: true, needsLoS: true },
        resourceId: 'lay-on-hands', uses: pool,
      });
    }

    // --- Monk: Focus (Ki) ---------------------------------------------------
    if (res.focus) {
      const n = left('focus');
      const mk = (id, name, desc) => add({
        id: `special:${id}`, kind: 'special', name, cost: 'bonus', icon: 'fist', desc,
        enabled: n > 0 && b.bonus > 0, reason: n <= 0 ? 'No Focus Points left' : (b.bonus <= 0 ? 'No Bonus Action left' : ''),
        targeting: id === 'flurry-of-blows' ? { kind: 'creature', range: 5, needsLoS: true } : { kind: 'self' },
        resourceId: 'focus', uses: n,
      });
      mk('flurry-of-blows', 'Flurry of Blows', 'Spend 1 Focus Point to make two Unarmed Strikes as a Bonus Action.');
      mk('patient-defense', 'Patient Defense', 'Spend 1 Focus Point to take the Disengage and Dodge actions as a Bonus Action.');
      mk('step-of-the-wind', 'Step of the Wind', 'Spend 1 Focus Point to take the Dash and Disengage actions and double your jump distance.');
    }

    // --- Bard: Bardic Inspiration -------------------------------------------
    if (res['bardic-inspiration']) {
      const s = spendable('bardic-inspiration', 'bonus');
      add({
        id: 'special:bardic-inspiration', kind: 'special', name: 'Bardic Inspiration', cost: 'bonus', icon: 'music',
        desc: 'Give an ally who can hear you a die to add to one D20 Test within the hour.',
        enabled: s.enabled, reason: s.reason,
        targeting: { kind: 'creature', range: 60, allowAllies: true, needsLoS: true },
        resourceId: 'bardic-inspiration', uses: left('bardic-inspiration'),
      });
    }

    // --- Rogue: Cunning Action variants -------------------------------------
    if (hasPassive(unit, 'cunning-action') || classLevel(unit, 'rogue') >= 2) {
      for (const [id, name, desc] of [
        ['cunning-dash', 'Cunning Action: Dash', 'Dash as a Bonus Action.'],
        ['cunning-disengage', 'Cunning Action: Disengage', 'Disengage as a Bonus Action.'],
        ['cunning-hide', 'Cunning Action: Hide', 'Hide as a Bonus Action.'],
      ]) {
        add({
          id: `special:${id}`, kind: 'special', name, cost: 'bonus', icon: 'boot', desc,
          enabled: b.bonus > 0, reason: b.bonus > 0 ? '' : 'No Bonus Action left',
          targeting: { kind: 'self' },
        });
      }
    }

    // --- Rogue: the Sneak Attack rider --------------------------------------
    const sneakLevel = classLevel(unit, 'rogue');
    if (sneakLevel > 0) {
      const dice = Math.ceil(sneakLevel / 2);
      const used = !!unit._turnUses?.sneak;
      add({
        id: 'special:sneak-attack', kind: 'special', name: `Sneak Attack (${dice}d6)`, cost: 'free', icon: 'dagger',
        desc: 'Once per turn, with a Finesse or Ranged weapon, add the dice if you have Advantage or an ally is within 5 feet of the target. Applied automatically — toggle it off to save it.',
        enabled: !used, reason: used ? 'Already used this turn' : '',
        targeting: { kind: 'self' },
        toggle: true, active: unit.flags?.sneakOff !== true,
      });
    }

    // --- Paladin: Divine Smite ----------------------------------------------
    if (hasPassive(unit, 'paladins-smite') || classLevel(unit, 'paladin') > 0) {
      const slots = safe(() => availableSlots(unit, 1), []) || [];
      add({
        id: 'special:divine-smite', kind: 'special', name: 'Divine Smite', cost: 'free', icon: 'holy',
        desc: 'Expend a spell slot as you hit with a melee weapon: 2d8 radiant, +1d8 per slot level above 1st, +1d8 against Fiends and Undead.',
        enabled: slots.length > 0, reason: slots.length ? '' : 'No spell slots left',
        targeting: { kind: 'self' }, levels: slots, toggle: true, active: !!unit.flags?.smiteArmed,
      });
    }
  }

  /** Consumables from the shared party bag, plus anything on this creature. */
  _itemOptions(unit, b, cm, out) {
    const seen = new Map();
    const consider = (entry, source) => {
      if (!entry) return;
      const def = resolveItem(entry.id);
      if (!def) return;
      const usable = def.use || def.kind === 'potion' || def.kind === 'scroll' || def.kind === 'food';
      if (!usable) return;
      const k = `${source}:${entry.id}`;
      const prev = seen.get(k);
      if (prev) { prev.qty += num(entry.qty, 1); return; }
      seen.set(k, { entry, def, source, qty: num(entry.qty, 1) });
    };
    for (const e of arr(this.bag)) consider(e, 'bag');
    for (const e of arr(unit.inventory)) consider(e, 'self');

    for (const { entry, def, source, qty } of seen.values()) {
      // Drinking a potion is the Use Object action in 2024 (a Bonus Action only if
      // the item says so). Feeding one to someone else is also an action.
      const cost = lower(def.use?.cost || def.useCost || 'action');
      let enabled = true;
      let reason = '';
      if (cm.noActions) { enabled = false; reason = 'Incapacitated'; }
      else if (cost === 'bonus' && b.bonus <= 0) { enabled = false; reason = 'No Bonus Action left'; }
      else if (cost !== 'bonus' && b.action <= 0) { enabled = false; reason = 'No action left'; }

      const heals = def.use?.kind === 'heal';
      out.push(opt({
        id: `item:${source}:${entry.uid || entry.id}`,
        kind: 'item',
        name: `${def.name || entry.id}${qty > 1 ? ` x${qty}` : ''}`,
        cost: cost === 'bonus' ? 'bonus' : 'action',
        icon: def.icon || (def.kind === 'scroll' ? 'scroll' : 'potion'),
        desc: def.desc || '',
        targeting: {
          kind: 'creature',
          range: heals || def.use?.kind === 'cure' ? 5 : rangeFeet(getSpell(def.use?.spellId) || { range: 30 }),
          allowAllies: true, needsLoS: true, count: 1,
        },
        enabled, reason,
        itemId: entry.id, itemUid: entry.uid || null, source, qty,
      }));
    }
  }

  /** Dash, Disengage, Dodge, Hide, Help, Shove, Grapple, Search, Ready, Use Object. */
  _basicOptions(unit, b, cm, out) {
    for (const base of BASIC_ACTIONS) {
      let enabled = b.action > 0 && !cm.noActions;
      let reason = cm.noActions ? 'Incapacitated' : (b.action > 0 ? '' : 'No action left');

      if (base.id === 'dash' && enabled && b.moveMax <= 0) { enabled = false; reason = 'Your Speed is 0'; }
      if (base.id === 'hide' && enabled && hasCondition(unit, 'hidden')) { enabled = false; reason = 'Already Hidden'; }
      if (base.id === 'use-object' && enabled && b.objectInteraction > 0) {
        // The free interaction covers the first object; this action is the second.
        reason = 'You still have your free object interaction';
      }

      const targeting = ['shove', 'grapple'].includes(base.id)
        ? { kind: 'creature', range: reachFt(unit), needsLoS: true, allowAllies: false }
        : base.id === 'help'
          ? { kind: 'creature', range: 5, needsLoS: true, allowAllies: true }
          : { kind: 'self' };

      out.push(opt({ ...base, enabled, reason, targeting }));
    }
  }

  // =========================================================================
  // TARGETING
  // =========================================================================

  /** Legal targets for an option: creatures and/or tiles. */
  targetsFor(unit, option) {
    const empty = { units: [], tiles: [] };
    if (!unit) return empty;
    const o = typeof option === 'string' ? this._findOption(unit, option) : option;
    if (!o) return empty;

    const t = o.targeting || {};
    const kind = lower(t.kind || 'creature');
    if (kind === 'self') return { units: [unit], tiles: [tileOf(unit)] };

    const range = Array.isArray(t.range) ? num(t.range[1], num(t.range[0], 5)) : num(t.range, 5);
    const units = [];
    for (const u of this.units) {
      if (!u || u === unit) continue;
      if (isDead(u)) continue;
      const ally = isAlly(u, unit);
      if (ally && !t.allowAllies) continue;
      if (!ally && t.allowAllies && kind === 'ally') continue;
      if (distanceFt(unit, u) > range) continue;
      if (t.needsLoS !== false && !lineOfSight(this, unit, u)) continue;
      units.push(u);
    }
    if (t.allowAllies && kind !== 'ally' && !units.includes(unit)) units.push(unit);

    // Point/area options also want the legal aim tiles.
    const tiles = [];
    if (['point', 'area', 'sphere', 'cone', 'line', 'cube', 'cylinder', 'wall', 'move'].includes(kind) || o.kind === 'move') {
      const p = tileOf(unit);
      const reach = Math.max(1, Math.round(range / FEET_PER_TILE));
      for (let y = p.y - reach; y <= p.y + reach; y++) {
        for (let x = p.x - reach; x <= p.x + reach; x++) {
          if (!this._inBounds(x, y) || this._isSolid(x, y)) continue;
          if (Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) > reach) continue;
          if (t.needsLoS !== false && !lineOfSight(this, p, { x, y })) continue;
          tiles.push({ x, y });
        }
      }
    }
    return { units, tiles };
  }

  /** Preview which tiles an area option would cover if aimed at a point. */
  areaPreview(unit, option, point) {
    const o = typeof option === 'string' ? this._findOption(unit, option) : option;
    const t = o?.targeting || {};
    if (!t.shape) return [tileOf(point)];
    return safe(() => areaTiles(unit, point, {
      kind: t.shape, radius: t.radius, length: t.length || t.radius, width: t.width, ctx: this,
    }), []) || [];
  }

  _findOption(unit, optionId) {
    const id = String(optionId || '').split('@')[0];
    for (const o of this.availableActions(unit)) if (o.id === id) return o;
    return null;
  }

  // =========================================================================
  // PERFORM
  // =========================================================================

  /**
   * Execute a chosen option.
   * `optionId` may carry a slot level after an '@' ("spell:fireball@4").
   * `target` may be { unit } | { units:[] } | { x, y } | { path } | a Character |
   * a { x, y } point — everything is normalised.
   * Returns { ok, results:[], log:[] } for the UI to animate.
   */
  perform(unit, optionId, target = null) {
    const { out, lines } = this._scope(() => this._performInner(unit, optionId, target));
    const res = out || { ok: false, results: [], error: 'unknown' };
    res.log = lines;
    if (!res.results) res.results = [];
    return res;
  }

  _performInner(unit, optionId, target) {
    if (!unit) return { ok: false, results: [], error: 'no-unit' };
    if (this.state !== 'active') return { ok: false, results: [], error: `encounter is ${this.state}` };

    const raw = String(optionId == null ? '' : optionId);
    const [idPart, levelPart] = raw.split('@');
    const id = idPart.trim();
    const explicitLevel = levelPart != null ? parseInt(levelPart, 10) : null;

    const tgt = this._normTarget(target);
    if (explicitLevel != null && !Number.isNaN(explicitLevel) && tgt.level == null) tgt.level = explicitLevel;

    const b = this._budgetFor(unit);
    const results = [];

    // A creature that is Incapacitated (Stunned, Paralyzed, Unconscious, Petrified)
    // takes no actions, Bonus Actions or Reactions at all — only ending its turn.
    const cmGate = conditionMech(unit);
    if (cmGate.incapacitated && id !== 'end' && id !== 'end-turn') {
      this._push(`${unit.name || 'The creature'} is Incapacitated and can do nothing.`, 'debuff', unit);
      return { ok: false, results, error: 'incapacitated' };
    }

    // --- dispatch ---------------------------------------------------------
    if (id === 'end' || id === 'end-turn') {
      const r = this.endTurn();
      return { ok: true, results: [{ kind: 'end', ...r }], ended: true };
    }
    if (id === 'move') {
      const mv = this.moveUnit(unit, tgt.path || (tgt.point ? [tgt.point] : []));
      return { ok: mv.ok, results: [{ kind: 'move', ...mv }] };
    }
    if (id.startsWith('attack:')) return this._doWeaponAttack(unit, id.slice(7), tgt, b, results);
    if (id.startsWith('mact:') || id.startsWith('mbonus:')) return this._doMonsterAction(unit, id, tgt, b, results);
    if (id.startsWith('spell:')) return this._doCastSpell(unit, id.slice(6), tgt, b, results);
    if (id.startsWith('item:')) return this._doUseItem(unit, id, tgt, b, results);
    if (id.startsWith('special:')) return this._doSpecial(unit, id.slice(8), tgt, b, results);
    if (id.startsWith('ready')) return this._doReady(unit, tgt, b, results);

    switch (id) {
      case 'dash': return this._doDash(unit, b, results);
      case 'disengage': return this._doDisengage(unit, b, results);
      case 'dodge': return this._doDodge(unit, b, results);
      case 'hide': return this._doHide(unit, b, results);
      case 'help': return this._doHelp(unit, tgt, b, results);
      case 'shove': return this._doShoveGrapple(unit, tgt, b, results, 'shove');
      case 'grapple': return this._doShoveGrapple(unit, tgt, b, results, 'grapple');
      case 'search': return this._doSearch(unit, b, results);
      case 'use-object': return this._doUseObject(unit, tgt, b, results);
      case 'influence': return this._doInfluence(unit, tgt, b, results);
      default:
        this._push(`Nothing happens — "${id}" is not something ${unit.name || 'this creature'} can do.`, 'info', unit);
        return { ok: false, results, error: 'unknown-option' };
    }
  }

  /** Turn whatever the UI passed into { unit, units, point, path, level }. */
  _normTarget(t) {
    const out = { unit: null, units: [], point: null, path: null, level: null, extra: null };
    if (t == null) return out;
    if (Array.isArray(t)) {
      // Either a list of units or a path of points.
      if (t.length && typeof t[0] === 'object' && t[0] && t[0].uid) { out.units = t.filter(Boolean); out.unit = out.units[0]; }
      else out.path = t.filter(Boolean);
      return out;
    }
    if (typeof t === 'string') { out.unit = this.byUid(t); if (out.unit) out.units = [out.unit]; return out; }
    if (t.uid) { out.unit = t; out.units = [t]; out.point = t.pos ? { ...t.pos } : null; return out; }

    if (t.unit) { out.unit = typeof t.unit === 'string' ? this.byUid(t.unit) : t.unit; }
    if (Array.isArray(t.units)) out.units = t.units.map((u) => (typeof u === 'string' ? this.byUid(u) : u)).filter(Boolean);
    if (!out.unit && out.units.length) out.unit = out.units[0];
    if (out.unit && !out.units.length) out.units = [out.unit];
    if (Array.isArray(t.path)) out.path = t.path.filter(Boolean);
    if (typeof t.x === 'number' && typeof t.y === 'number') out.point = { x: t.x, y: t.y };
    else if (t.point && typeof t.point.x === 'number') out.point = { x: t.point.x, y: t.point.y };
    else if (out.unit?.pos) out.point = { ...out.unit.pos };
    if (t.level != null) out.level = parseInt(t.level, 10);
    if (t.slotLevel != null) out.level = parseInt(t.slotLevel, 10);
    out.extra = t;
    return out;
  }

  // --- action economy helpers ----------------------------------------------

  /** Spend a cost from the budget. Returns false (and logs) when it cannot be paid. */
  _spend(unit, b, cost) {
    if (cost === 'free' || cost === 'none') return true;
    if (cost === 'bonus') {
      if (b.bonus <= 0) { this._push(`${unit.name || 'The creature'} has no Bonus Action left.`, 'info', unit); return false; }
      b.bonus--; return true;
    }
    if (cost === 'reaction') {
      if (b.reaction <= 0 || unit._reactionUsed) { this._push(`${unit.name || 'The creature'} has already used its Reaction.`, 'info', unit); return false; }
      b.reaction--; unit._reactionUsed = true;
      if (unit.flags) unit.flags.reactionUsed = true;
      return true;
    }
    if (b.action <= 0) { this._push(`${unit.name || 'The creature'} has no action left.`, 'info', unit); return false; }
    b.action--; return true;
  }

  // --- attacks --------------------------------------------------------------

  /**
   * One weapon swing. The first swing of a turn spends the Attack action and banks
   * the follow-ups Extra Attack owes; later swings draw on that bank.
   */
  _doWeaponAttack(unit, weaponKey, tgt, b, results) {
    const weapons = safe(() => weaponsOf(unit), []) || [];
    const w = weapons.find((x) => x.id === weaponKey) || weapons[0];
    if (!w) return { ok: false, results, error: 'no-weapon' };

    const target = tgt.unit || (tgt.point ? unitAt(this, tgt.point.x, tgt.point.y) : null);
    if (!target) { this._push('There is nothing there to attack.', 'info', unit); return { ok: false, results, error: 'no-target' }; }
    if (isDead(target)) { this._push(`${target.name} is already down.`, 'info', unit); return { ok: false, results, error: 'dead-target' }; }

    // Out of range: refuse before anything is spent. (Long range is not out of
    // range — resolveAttack turns that into Disadvantage.)
    const maxRange = Array.isArray(w.range) ? num(w.range[1], num(w.range[0], 5)) : num(w.range, 5);
    const dist = distanceFt(unit, target);
    if (dist > maxRange) {
      this._push(`${target.name} is ${dist} ft away — out of ${w.name}'s ${maxRange} ft reach.`, 'miss', unit);
      return { ok: false, results, error: 'out-of-range' };
    }

    // Pay for it.
    const cost = w.cost || 'action';
    if (cost === 'bonus') {
      if (!this._spend(unit, b, 'bonus')) return { ok: false, results, error: 'no-bonus' };
    } else if (cost === 'free' && b.freeAttacks > 0) {
      b.freeAttacks--;
    } else if (b.attacksLeft > 0) {
      b.attacksLeft--;
    } else {
      if (!this._spend(unit, b, 'action')) return { ok: false, results, error: 'no-action' };
      b.attacksLeft = Math.max(0, b.extraAttacks);   // Extra Attack banks its follow-ups
    }
    b.attacksMade++;

    const res = this._attack(unit, target, {
      weapon: w.inst || w.item,
      damage: w.damage,
      atkBonus: w.attackBonus,
      range: w.range,
      ranged: w.ranged,
      twoHanded: w.mode === 'versatile',
      thrown: w.mode === 'thrown',
      offHand: w.slot === 'offHand',
      mastery: w.mastery,
      label: w.name,
      sneakAttack: unit.flags?.sneakOff ? false : undefined,
      smite: unit.flags?.smiteArmed ? { level: num(unit.flags.smiteLevel, 1) } : undefined,
    });
    if (unit.flags?.smiteArmed) { unit.flags.smiteArmed = false; unit.flags.smiteLevel = 0; }

    results.push({ kind: 'attack', attacker: unit.uid, target: target.uid, result: res });

    // The Nick mastery turns the Light property's extra attack into a free one.
    for (const e of arr(res?.effects)) {
      if (e?.id === 'nick' && e.freeLightAttack) b.freeAttacks = Math.max(b.freeAttacks, 1);
    }

    this._sweepDeaths(unit);
    this._checkEnd();
    return { ok: true, results, attacksLeft: b.attacksLeft };
  }

  /**
   * The melee swing this creature makes outside its own turn — an Opportunity
   * Attack, a Riposte, a readied strike. A creature with a stat block uses its stat
   * block; everyone else uses whatever is in their hands.
   */
  _meleeAttackOpts(unit, label = '') {
    if (!unit) return { label: label || 'Attack' };
    if (unit.kind === 'monster' && arr(unit.actions).length) {
      const acts = arr(unit.actions).filter((a) => a && lower(a.kind) === 'attack');
      const act = acts.find((a) => !a.range) || acts[0];
      if (act) {
        return {
          atkBonus: num(act.atkBonus, num(act.attackBonus, 4)),
          damage: parseMonsterDamage(act),
          range: act.range || [num(act.reach, 5), num(act.reach, 5)],
          ranged: !!act.range,
          label: label ? `${act.name || 'Attack'} (${label})` : (act.name || 'Attack'),
        };
      }
    }
    const weapons = safe(() => weaponsOf(unit), []) || [];
    const w = weapons.find((x) => !x.ranged && x.enabled !== false) || weapons[0];
    if (!w) return { label: label || 'Attack' };
    return {
      weapon: w.inst || w.item,
      damage: w.damage,
      atkBonus: w.attackBonus,
      range: w.range,
      mastery: w.mastery,
      label: label ? `${w.name} (${label})` : w.name,
    };
  }

  /**
   * The single choke point every attack in the encounter goes through, so reactions
   * always get their say before the dice fall.
   */
  _attack(attacker, target, opts = {}) {
    const mods = this._preAttackReactions(attacker, target, opts);
    const finalOpts = { ...opts };
    if (mods.dis) finalOpts.dis = true;
    if (mods.disReason) finalOpts.disReason = mods.disReason;
    if (mods.damageReduction > 0 && finalOpts.damage) {
      // Deflect Attacks reduces the damage of the triggering hit; folding the roll
      // into the damage modifier keeps it inside one clean damage package.
      finalOpts.damage = { ...finalOpts.damage, mod: num(finalOpts.damage.mod) - mods.damageReduction };
    }

    const res = mods.resistAll
      ? withTemporaryResistAll(target, () => resolveAttack(this, attacker, target, finalOpts))
      : resolveAttack(this, attacker, target, finalOpts);

    this._postAttackReactions(attacker, target, res, opts);
    this._sweepDeaths(attacker);
    return res;
  }

  /** A monster's stat-block action: attack, multiattack, area save, heal or utility. */
  _doMonsterAction(unit, id, tgt, b, results) {
    const bonus = id.startsWith('mbonus:');
    const idx = parseInt(id.split(':')[1], 10);
    const list = bonus ? arr(unit.bonusActions) : arr(unit.actions);
    const act = list[idx];
    if (!act) return { ok: false, results, error: 'no-action' };

    if (!this._spend(unit, b, bonus ? 'bonus' : 'action')) return { ok: false, results, error: 'no-economy' };

    // Limited-use actions (Recharge 5–6, 1/Day) are tracked per creature.
    if (act.uses && typeof act.uses.max === 'number') {
      unit._actionUses = unit._actionUses || {};
      const k = act.id || act.name || `a${idx}`;
      unit._actionUses[k] = (unit._actionUses[k] || 0) + 1;
    }

    const kind = lower(act.kind || 'attack');
    if (kind === 'multiattack') {
      for (const step of this._multiattackPlan(unit, act)) {
        const sub = step.action;
        for (let i = 0; i < step.count; i++) {
          const t = this._pickMonsterTarget(unit, sub, tgt);
          if (!t) break;
          results.push(...this._runMonsterAttack(unit, sub, t, tgt));
          if (isDead(t)) continue;
        }
      }
    } else {
      const t = this._pickMonsterTarget(unit, act, tgt);
      results.push(...this._runMonsterAttack(unit, act, t, tgt));
    }

    this._sweepDeaths(unit);
    this._checkEnd();
    return { ok: true, results };
  }

  /**
   * Read a multiattack routine out of a stat block. Data authors write these in a
   * few different shapes, so accept them all and fall back to "two of the first
   * attack" rather than doing nothing.
   */
  _multiattackPlan(unit, act) {
    const actions = arr(unit.actions);
    const byId = (id) => actions.find((a) => a && (a.id === id || lower(a.name) === lower(id)));
    const plan = [];
    const raw = act.attacks || act.sequence || act.multiattack || act.routine;

    for (const entry of arr(raw)) {
      if (!entry) continue;
      if (Array.isArray(entry)) {
        const a = byId(entry[0]);
        if (a) plan.push({ action: a, count: Math.max(1, num(entry[1], 1)) });
      } else if (typeof entry === 'string') {
        const a = byId(entry);
        if (a) plan.push({ action: a, count: 1 });
      } else if (typeof entry === 'object') {
        const a = byId(entry.id || entry.action || entry.name) || (entry.kind ? entry : null);
        if (a) plan.push({ action: a, count: Math.max(1, num(entry.count, 1)) });
      }
    }
    if (!plan.length) {
      const first = actions.find((a) => a && lower(a.kind) === 'attack');
      if (first) plan.push({ action: first, count: Math.max(2, num(act.count, 2)) });
    }
    return plan;
  }

  /** Choose who a monster action lands on when the UI did not say. */
  _pickMonsterTarget(unit, act, tgt) {
    if (tgt.unit && !isDead(tgt.unit)) {
      const reach = act?.range ? num(act.range[1], num(act.range[0], 5)) : num(act?.reach, 5);
      if (distanceFt(unit, tgt.unit) <= reach) return tgt.unit;
    }
    let best = null, bestD = Infinity;
    for (const u of this.units) {
      if (!u || isDead(u) || !isHostile(u, unit)) continue;
      const d = distanceFt(unit, u);
      if (d < bestD) { best = u; bestD = d; }
    }
    return best;
  }

  /** Resolve one monster stat-block action against a target or a point. */
  _runMonsterAttack(unit, act, target, tgt) {
    const results = [];
    if (!act) return results;
    const kind = lower(act.kind || 'attack');

    if (kind === 'attack') {
      if (!target) return results;
      const res = this._attack(unit, target, {
        atkBonus: num(act.atkBonus, num(act.attackBonus, 4)),
        damage: parseMonsterDamage(act),
        range: act.range || [num(act.reach, 5), num(act.reach, 5)],
        ranged: !!act.range,
        label: act.name || 'Attack',
        onHit: arr(act.effects),
        dc: num(act.save?.dc, 0) || undefined,
      });
      results.push({ kind: 'attack', attacker: unit.uid, target: target.uid, result: res });
      return results;
    }

    if (kind === 'save') {
      const shape = act.target && ['sphere', 'cone', 'line', 'cube', 'cylinder'].includes(lower(act.target.kind))
        ? { kind: lower(act.target.kind), radius: num(act.target.radius, 15), length: num(act.target.length, act.target.radius || 15), width: num(act.target.width, 5) }
        : null;
      const aim = tgt.point || (target ? tileOf(target) : tileOf(unit));
      const victims = shape
        ? safe(() => unitsInArea(this, unit, aim, shape), []) || []
        : (target ? [target] : []);
      const tiles = shape ? safe(() => areaTiles(unit, aim, { ...shape, ctx: this }), []) || [] : [aim];

      this._push(`${unit.name || 'The creature'} uses ${act.name || 'a special attack'}!`, 'info', unit);
      for (const v of victims) {
        if (!v || isDead(v)) continue;
        const sv = resolveSave(this, unit, v, {
          ability: act.save?.ability || 'dex',
          dc: num(act.save?.dc, saveDCFor(unit)),
          onSuccess: act.save?.onSuccess || 'half',
          damage: act.dice ? { dice: act.dice, type: act.dtype || 'force' } : null,
          effects: arr(act.effects),
          reason: act.name || 'Special attack',
          magic: act.magic !== false,
        });
        results.push({ kind: 'save', source: unit.uid, target: v.uid, result: sv });
      }
      results.push({ kind: 'area', tiles, shape: shape?.kind || 'point', origin: tileOf(unit), aim });
      return results;
    }

    if (kind === 'heal') {
      const ally = target && isAlly(target, unit) ? target : unit;
      const amt = act.dice ? rollExpr(act.dice, this.rng) : { total: num(act.amount, 0), rolls: [] };
      const h = healTarget(this, ally, amt.total);
      this._push(`${unit.name} uses ${act.name || 'a healing power'}: ${act.dice || amt.total} [${amt.rolls.join(',')}] = ${amt.total} hit points restored to ${ally.name}.`, 'heal', unit);
      results.push({ kind: 'heal', source: unit.uid, target: ally.uid, amount: h.healed });
      return results;
    }

    if (kind === 'summon') {
      results.push(...this._summon(unit, act.monsterId || act.summon, num(act.count, 1)));
      return results;
    }

    // 'utility' and anything unknown: log it so the UI still has something to show.
    this._push(`${unit.name || 'The creature'} uses ${act.name || 'an ability'}.`, 'info', unit);
    for (const eff of arr(act.effects)) {
      const applied = applyEffect(this, unit, target || unit, eff, { r: this.rng });
      if (applied) results.push({ kind: 'effect', ...applied });
    }
    return results;
  }

  // --- spells ---------------------------------------------------------------

  /**
   * Cast a spell. Handles the slot cost, Concentration replacement, attack rolls,
   * per-target saving throws over an area template, healing, summons and riders.
   */
  _doCastSpell(unit, spellId, tgt, b, results) {
    const spell = getSpell(spellId);
    if (!spell) { this._push(`${unit.name || 'The caster'} fumbles for a spell that isn't there.`, 'info', unit); return { ok: false, results, error: 'no-spell' }; }

    const cm = conditionMech(unit);
    if (cm.cannotCast) { this._push(`${unit.name} cannot cast while Raging.`, 'info', unit); return { ok: false, results, error: 'cannot-cast' }; }

    // --- range -------------------------------------------------------------
    // Cones, lines and walls spring from the caster, so the aim point only sets a
    // direction; everything else has to be within the spell's stated range.
    const tSpec = spell.target || {};
    const originShape = ['cone', 'line', 'wall', 'beam', 'self'].includes(lower(tSpec.kind));
    if (!originShape && lower(spell.range) !== 'self') {
      const reach = rangeFeet(spell);
      const aimPt = tgt.point || (tgt.unit ? tileOf(tgt.unit) : null);
      if (aimPt && reach < 9999) {
        const d = distanceFt(unit, aimPt);
        if (d > reach) {
          this._push(`${spell.name} only reaches ${reach} ft — that is ${d} ft away.`, 'miss', unit);
          return { ok: false, results, error: 'out-of-range' };
        }
      }
    }

    const ct = lower(spell.castTime || 'action');
    const cost = ct === 'bonus' ? 'bonus' : ct === 'reaction' ? 'reaction' : 'action';
    if (!this._spend(unit, b, cost)) return { ok: false, results, error: 'no-economy' };

    // --- pay the slot -------------------------------------------------------
    let level = spell.level;
    if (spell.level > 0) {
      const slots = safe(() => availableSlots(unit, spell.level), []) || [];
      level = tgt.level != null && slots.includes(tgt.level) ? tgt.level : (slots[0] ?? spell.level);
      const paid = safe(() => spendSlot(unit, level), false);
      if (!paid) {
        this._push(`${unit.name} has no ${ordinalLevel(level)} spell slot left.`, 'info', unit);
        // Refund the action we just took — the spell never happened.
        if (cost === 'bonus') b.bonus++; else if (cost === 'action') b.action++;
        return { ok: false, results, error: 'no-slot' };
      }
    }
    b.spellsCast.push({ id: spellId, level });

    const dc = safe(() => spellDC(unit), 10);
    const casterLvl = Math.max(1, num(unit.level, 1));
    const t = spell.target || {};
    const shapeKind = ['sphere', 'cone', 'line', 'cube', 'cylinder', 'wall'].includes(lower(t.kind)) ? lower(t.kind) : null;
    const aim = tgt.point || (tgt.unit ? tileOf(tgt.unit) : tileOf(unit));

    this._push(`${unit.name || 'The caster'} casts ${spell.name}${level > spell.level ? ` at ${ordinalLevel(level)} level` : ''}${spell.concentration ? ' (concentration)' : ''}.`, 'spell', unit);
    bus.emit(EV.SPELL_CAST, { enc: this, caster: unit, spellId, level, target: aim });

    // --- who does it touch? -------------------------------------------------
    let victims = [];
    let tiles = [];
    if (lower(t.kind) === 'self') {
      victims = [unit];
    } else if (shapeKind) {
      const shape = {
        kind: shapeKind, radius: num(t.radius, 20), length: num(t.length, t.radius || 30),
        width: num(t.width, 5), ctx: this,
      };
      tiles = safe(() => areaTiles(unit, aim, shape), []) || [];
      victims = safe(() => unitsInArea(this, unit, aim, shape), []) || [];
      // Most areas do not spare your friends; a spell that says so sets allowAllies.
      if (t.allowAllies === false) victims = victims.filter((u) => isHostile(u, unit));
      results.push({ kind: 'area', tiles, shape: shapeKind, origin: tileOf(unit), aim });
    } else if (tgt.units.length) {
      victims = tgt.units.slice(0, Math.max(1, num(t.maxTargets, num(t.count, 1))));
    } else if (tgt.unit) {
      victims = [tgt.unit];
    } else if (lower(t.kind) === 'point') {
      tiles = [aim];
    }
    victims = victims.filter((u) => u && !isDead(u));

    // --- Concentration ------------------------------------------------------
    // Starting a new Concentration spell ends the one you were holding.
    if (spell.concentration) {
      if (isConcentrating(unit)) {
        const old = spellName(unit.concentration?.spellId) || 'their previous spell';
        this._push(`${unit.name} lets ${old} lapse to concentrate on ${spell.name}.`, 'info', unit);
      }
      safe(() => startConcentration(unit, spellId, victims, {
        dur: roundsForDuration(spell.duration), level, round: this.round,
      }));
      addCondition(unit, 'concentrating', { source: unit.uid, spellId });
    }

    // --- resolution ---------------------------------------------------------
    const dmgDice = safe(() => spellDamageDice(spell, level, casterLvl), spell.damage?.dice || null);
    const healDice = safe(() => spellHealDice(spell, level), spell.heal?.dice || null);

    if (spell.attack) {
      // A spell attack roll: one target, one d20.
      const victim = victims[0];
      if (!victim) { this._push('The spell finds nothing to strike.', 'miss', unit); }
      else {
        const res = this._attack(unit, victim, {
          spell,
          atkBonus: safe(() => spellAtk(unit), 0),
          damage: dmgDice ? { dice: dmgDice, type: spell.damage?.type || 'force', mod: 0 } : null,
          ranged: spell.attack === 'ranged',
          range: [rangeFeet(spell), rangeFeet(spell)],
          label: spell.name,
          onHit: arr(spell.effects).filter((e) => e && e.kind !== 'summon'),
        });
        results.push({ kind: 'attack', attacker: unit.uid, target: victim.uid, result: res, spellId });
      }
    } else if (spell.save) {
      for (const v of victims) {
        const sv = resolveSave(this, unit, v, {
          ability: spell.save.ability || 'dex',
          dc,
          onSuccess: spell.save.onSuccess || 'half',
          damage: dmgDice ? { dice: dmgDice, type: spell.damage?.type || 'force' } : null,
          effects: arr(spell.effects).filter((e) => e && e.kind !== 'summon').map((e) => ({
            ...e,
            dc,
            save: spell.save.repeatEachTurn ? { ab: spell.save.ability, dc, end: 'turn-end' } : e.save,
            spellId,
            concentration: !!spell.concentration,
          })),
          spell, magic: true, reason: spell.name,
        });
        results.push({ kind: 'save', source: unit.uid, target: v.uid, result: sv, spellId });
      }
    } else {
      // No roll: healing, buffs, utility. Damage without a save (Magic Missile).
      for (const v of victims) {
        if (dmgDice) {
          const roll = rollExpr(dmgDice, this.rng);
          const applied = applyDamage(this, v, roll.total, spell.damage?.type || 'force', { source: unit, magical: true, label: spell.name });
          this._push(`${spell.name} strikes ${v.name}: ${dmgDice} [${roll.rolls.join(',')}] = ${roll.total} ${spell.damage?.type || 'force'} damage.`, 'damage', unit);
          results.push({ kind: 'damage', source: unit.uid, target: v.uid, amount: applied.dealt, type: spell.damage?.type || 'force' });
        }
        if (healDice) {
          const roll = rollExpr(healDice, this.rng);
          const bonus = spell.heal?.mod === 'spell' ? safe(() => abilityMod(unit, unit.spells?.ability || 'wis'), 0) : 0;
          const total = roll.total + bonus;
          this._push(`${spell.name} knits ${v.name}'s wounds: ${healDice} [${roll.rolls.join(',')}]${bonus ? ` +${bonus}` : ''} = ${total} hit points.`, 'heal', unit);
          const h = healTarget(this, v, total);
          results.push({ kind: 'heal', source: unit.uid, target: v.uid, amount: h.healed });
        }
      }
    }

    // --- rider effects (buffs, conditions, temp hp, teleports, summons) -----
    for (const eff of arr(spell.effects)) {
      if (!eff) continue;
      if (lower(eff.kind) === 'summon') {
        results.push(...this._summon(unit, eff.monsterId, num(eff.count, 1)));
        continue;
      }
      if (lower(eff.kind) === 'teleport') {
        const moved = this._teleport(unit, tgt.point || aim, num(eff.distance, 30));
        results.push({ kind: 'teleport', unit: unit.uid, ...moved });
        continue;
      }
      // Save-based spells already applied their riders inside resolveSave.
      if (spell.save) continue;
      const list = lower(spell.target?.kind) === 'self' ? [unit] : (victims.length ? victims : [unit]);
      for (const v of list) {
        const applied = applyEffect(this, unit, v, { ...eff, dc, spellId, concentration: !!spell.concentration }, { r: this.rng });
        if (applied) results.push({ kind: 'effect', ...applied });
      }
    }

    this._sweepDeaths(unit);
    this._checkEnd();
    return { ok: true, results, level, spellId };
  }

  /** Bring conjured creatures onto the field and slot them into the initiative order. */
  _summon(summoner, monsterId, count = 1) {
    const out = [];
    if (!summoner || !monsterId) return out;
    const made = [];
    for (let i = 0; i < Math.max(1, count); i++) {
      const m = this._spawnMonster(monsterId, {});
      if (!m) break;
      m.side = summoner.side || 'party';
      m.kind = 'monster';
      m.summonedBy = summoner.uid;
      m.name = m.name || 'Summoned creature';
      const spot = this._nearestFree(tileOf(summoner).x, tileOf(summoner).y);
      m.pos = { x: spot.x, y: spot.y };
      this.units.push(m);
      this._byUid.set(m.uid, m);
      this.summons.push(m);
      made.push(m);

      // Summons act immediately after the creature that called them.
      const at = this.order.indexOf(summoner.uid);
      if (at >= 0) this.order.splice(at + 1, 0, m.uid);
      else this.order.push(m.uid);
      this.initiative[m.uid] = { total: (this.initiative[summoner.uid]?.total ?? 10) - 0.5, roll: null, text: 'acts with its summoner', dis: false };
    }
    if (made.length) {
      this._push(`${summoner.name} calls ${summarise(made.map((m) => m.name))} to the field.`, 'spell', summoner);
      bus.emit(COMBAT_EV.SUMMON, { enc: this, summoner, units: made });
      out.push({ kind: 'summon', summoner: summoner.uid, units: made.map((m) => m.uid) });
    }
    return out;
  }

  /** Misty Step and friends: put the caster on a legal tile within range. */
  _teleport(unit, point, distance = 30) {
    const from = { ...tileOf(unit) };
    if (!point) return { ok: false, from, to: from };
    const maxTiles = Math.max(1, Math.round(distance / FEET_PER_TILE));
    let dest = { x: point.x, y: point.y };
    if (Math.max(Math.abs(dest.x - from.x), Math.abs(dest.y - from.y)) > maxTiles
      || this._isSolid(dest.x, dest.y) || unitAt(this, dest.x, dest.y)) {
      dest = this._nearestFree(dest.x, dest.y);
    }
    unit.pos = { x: dest.x, y: dest.y };
    this._push(`${unit.name} vanishes and reappears ${Math.round(Math.max(Math.abs(dest.x - from.x), Math.abs(dest.y - from.y)) * FEET_PER_TILE)} ft away.`, 'spell', unit);
    bus.emit(COMBAT_EV.MOVE, { enc: this, unit, from, to: dest, teleport: true });
    return { ok: true, from, to: dest };
  }

  // --- items ----------------------------------------------------------------

  /** Drink a potion, read a scroll, feed a healing draught to a fallen friend. */
  _doUseItem(unit, id, tgt, b, results) {
    const parts = id.split(':');
    const source = parts[1] || 'bag';
    const ref = parts.slice(2).join(':');
    const list = source === 'bag' ? arr(this.bag) : arr(unit.inventory);
    const entry = list.find((e) => e && (e.uid === ref || e.id === ref));
    if (!entry) { this._push('That item is gone from the pack.', 'info', unit); return { ok: false, results, error: 'no-item' }; }

    const def = resolveItem(entry.id);
    if (!def) return { ok: false, results, error: 'unknown-item' };

    const cost = lower(def.use?.cost || def.useCost || 'action');
    if (!this._spend(unit, b, cost === 'bonus' ? 'bonus' : 'action')) return { ok: false, results, error: 'no-economy' };

    const target = tgt.unit || unit;
    const use = def.use || {};
    const kind = lower(use.kind || (def.kind === 'potion' ? 'heal' : 'utility'));

    switch (kind) {
      case 'heal': {
        const roll = rollExpr(use.dice || '2d4+2', this.rng);
        this._push(`${unit.name} uses ${def.name} on ${target === unit ? 'themselves' : target.name}: ${use.dice || '2d4+2'} [${roll.rolls.join(',')}] = ${roll.total} hit points.`, 'heal', unit);
        const h = healTarget(this, target, roll.total);
        results.push({ kind: 'heal', source: unit.uid, target: target.uid, amount: h.healed, itemId: entry.id });
        break;
      }
      case 'cure': {
        const cured = [];
        for (const c of arr(use.conditions)) {
          if (removeCondition(target, c)) cured.push(conditionName(c));
        }
        this._push(cured.length
          ? `${def.name} lifts ${cured.join(' and ')} from ${target.name}.`
          : `${def.name} finds nothing to cure.`, cured.length ? 'buff' : 'info', unit);
        results.push({ kind: 'cure', target: target.uid, cured, itemId: entry.id });
        break;
      }
      case 'temphp': {
        const roll = rollExpr(use.dice || '1d4', this.rng);
        const gained = grantTempHp(this, target, roll.total + num(use.amount));
        results.push({ kind: 'temphp', target: target.uid, amount: gained, itemId: entry.id });
        break;
      }
      case 'spell': {
        // A scroll or wand casts without spending one of your own slots.
        const spell = getSpell(use.spellId);
        if (!spell) { this._push(`${def.name} fizzles — its magic is spent.`, 'info', unit); break; }
        const saved = { action: b.action, bonus: b.bonus };
        const sub = this._doCastSpell(unit, use.spellId, { ...tgt, level: num(use.level, spell.level) }, b, []);
        b.action = saved.action; b.bonus = saved.bonus;   // the item paid, not the caster
        results.push(...(sub.results || []));
        break;
      }
      case 'buff': {
        const applied = applyEffect(this, unit, target, { kind: 'buff', ...use }, { r: this.rng });
        if (applied) results.push({ kind: 'effect', ...applied });
        break;
      }
      default:
        this._push(`${unit.name} uses ${def.name}.`, 'info', unit);
        break;
    }

    // Spend the charge.
    if (source === 'bag') {
      entry.qty = num(entry.qty, 1) - 1;
      if (entry.qty <= 0) {
        const i = this.bag.indexOf(entry);
        if (i >= 0) this.bag.splice(i, 1);
      }
    } else {
      safe(() => removeItem(unit, entry.id, 1));
    }

    this._sweepDeaths(unit);
    this._checkEnd();
    return { ok: true, results };
  }

  // --- the basic actions ----------------------------------------------------

  _doDash(unit, b, results) {
    if (!this._spend(unit, b, 'action')) return { ok: false, results, error: 'no-action' };
    // Dash grants extra movement equal to your Speed, not a doubling of what's left.
    b.movement += b.moveMax;
    b.dashUsed++;
    this._push(`${unit.name} Dashes — ${b.movement} ft of movement remaining.`, 'info', unit);
    results.push({ kind: 'dash', unit: unit.uid, movement: b.movement });
    return { ok: true, results };
  }

  _doDisengage(unit, b, results, cost = 'action') {
    if (!this._spend(unit, b, cost)) return { ok: false, results, error: 'no-economy' };
    addCondition(unit, 'disengaging', { source: unit.uid });
    this._push(`${unit.name} Disengages — their movement won't provoke Opportunity Attacks this turn.`, 'buff', unit);
    results.push({ kind: 'disengage', unit: unit.uid });
    return { ok: true, results };
  }

  _doDodge(unit, b, results, cost = 'action') {
    if (!this._spend(unit, b, cost)) return { ok: false, results, error: 'no-economy' };
    addCondition(unit, 'dodging', { source: unit.uid });
    this._push(`${unit.name} takes the Dodge action — attacks against them have Disadvantage until their next turn.`, 'buff', unit);
    results.push({ kind: 'dodge', unit: unit.uid });
    return { ok: true, results };
  }

  _doHide(unit, b, results, cost = 'action') {
    if (!this._spend(unit, b, cost)) return { ok: false, results, error: 'no-economy' };
    // 2024 Hide: a DC 15 Dexterity (Stealth) check, and you must be out of sight.
    const check = abilityCheck(this, unit, 'dex', { skill: 'stealth', dc: 15, reason: 'Hide' });
    if (check.success) {
      addCondition(unit, 'hidden', { source: unit.uid });
      this._push(`${unit.name} slips out of sight (Stealth ${check.total} vs DC 15).`, 'buff', unit);
    } else {
      this._push(`${unit.name} fails to find cover (Stealth ${check.total} vs DC 15).`, 'miss', unit);
    }
    results.push({ kind: 'hide', unit: unit.uid, success: check.success, roll: check.roll });
    return { ok: true, results };
  }

  _doHelp(unit, tgt, b, results) {
    if (!this._spend(unit, b, 'action')) return { ok: false, results, error: 'no-action' };
    const ally = tgt.unit;
    if (!ally || !isAlly(ally, unit)) { this._push('There is no ally there to help.', 'info', unit); return { ok: false, results, error: 'no-ally' }; }
    // 2024 Help (attack): name a creature within 5 ft of YOU; your ally gets
    // Advantage on its next attack roll against it.
    let foe = null, bestD = Infinity;
    for (const u of this.units) {
      if (!u || isDead(u) || !isHostile(u, unit)) continue;
      const d = distanceFt(unit, u);
      if (d <= 5 && d < bestD) { foe = u; bestD = d; }
    }
    if (!foe) { this._push(`${unit.name} has no foe within reach to distract.`, 'info', unit); return { ok: false, results, error: 'no-foe' }; }
    addCondition(ally, 'helped', { source: unit.uid, data: { target: foe.uid } });
    this._push(`${unit.name} distracts ${foe.name} — ${ally.name} has Advantage on their next attack against it.`, 'buff', unit);
    results.push({ kind: 'help', unit: unit.uid, ally: ally.uid, foe: foe.uid });
    return { ok: true, results };
  }

  _doShoveGrapple(unit, tgt, b, results, mode) {
    if (!this._spend(unit, b, 'action')) return { ok: false, results, error: 'no-action' };
    const target = tgt.unit;
    if (!target) { this._push('There is nobody there to lay hands on.', 'info', unit); return { ok: false, results, error: 'no-target' }; }
    if (distanceFt(unit, target) > reachFt(unit)) {
      this._push(`${target.name} is out of reach.`, 'miss', unit);
      return { ok: false, results, error: 'out-of-reach' };
    }
    const res = mode === 'grapple'
      ? grappleAction(this, unit, target)
      : shoveAction(this, unit, target, { mode: tgt.extra?.mode === 'push' ? 'push' : 'prone' });
    results.push({ kind: mode, unit: unit.uid, target: target.uid, result: res });
    return { ok: !!res.ok, results };
  }

  _doSearch(unit, b, results) {
    if (!this._spend(unit, b, 'action')) return { ok: false, results, error: 'no-action' };
    const check = abilityCheck(this, unit, 'wis', { skill: 'perception', dc: 15, reason: 'Search' });
    // Finding a hidden creature ends its Hidden condition.
    const found = [];
    if (check.success) {
      for (const u of this.units) {
        if (!u || !isHostile(u, unit) || !hasCondition(u, 'hidden')) continue;
        if (distanceFt(unit, u) > 30) continue;
        removeCondition(u, 'hidden');
        found.push(u.name);
      }
    }
    this._push(found.length
      ? `${unit.name} searches and spots ${summarise(found)}!`
      : `${unit.name} searches but finds nothing (Perception ${check.total}).`, found.length ? 'buff' : 'info', unit);
    results.push({ kind: 'search', unit: unit.uid, success: check.success, found });
    return { ok: true, results };
  }

  _doUseObject(unit, tgt, b, results) {
    if (b.objectInteraction > 0) {
      b.objectInteraction--;
      this._push(`${unit.name} uses their free object interaction.`, 'info', unit);
    } else if (!this._spend(unit, b, 'action')) {
      return { ok: false, results, error: 'no-action' };
    } else {
      this._push(`${unit.name} takes the Use Object action.`, 'info', unit);
    }
    results.push({ kind: 'use-object', unit: unit.uid, target: tgt.point || null });
    return { ok: true, results };
  }

  _doInfluence(unit, tgt, b, results) {
    if (!this._spend(unit, b, 'action')) return { ok: false, results, error: 'no-action' };
    const target = tgt.unit;
    if (!target) return { ok: false, results, error: 'no-target' };
    const dc = 10 + Math.max(0, safe(() => abilityMod(target, 'wis'), 0)) + 5;
    const check = abilityCheck(this, unit, 'cha', { skill: 'persuasion', dc, reason: 'Influence' });
    if (check.success) {
      addCondition(target, 'charmed', { source: unit.uid, rounds: 1 });
      this._push(`${unit.name} talks ${target.name} down for a moment (Persuasion ${check.total} vs DC ${dc}).`, 'buff', unit);
    } else {
      this._push(`${target.name} is unmoved (Persuasion ${check.total} vs DC ${dc}).`, 'miss', unit);
    }
    results.push({ kind: 'influence', unit: unit.uid, target: target.uid, success: check.success });
    return { ok: true, results };
  }

  /** Ready an action to fire off your Reaction when a trigger you name occurs. */
  _doReady(unit, tgt, b, results) {
    if (!this._spend(unit, b, 'action')) return { ok: false, results, error: 'no-action' };
    const readied = {
      optionId: tgt.extra?.optionId || tgt.extra?.readyOption || null,
      trigger: tgt.extra?.trigger || 'an enemy comes within reach',
      target: tgt.unit?.uid || null,
      point: tgt.point || null,
    };
    b.readied = readied;
    unit._readied = readied;
    this._push(`${unit.name} readies an action: ${readied.trigger}.`, 'info', unit);
    results.push({ kind: 'ready', unit: unit.uid, readied });
    return { ok: true, results };
  }

  /** Rage, Second Wind, Action Surge, Ki, Bardic Inspiration, Lay on Hands… */
  _doSpecial(unit, what, tgt, b, results) {
    const res = unit.resources || {};
    const spend = (id, n = 1) => {
      const r = res[id];
      if (!r) return false;
      if (num(r.max) - num(r.used) < n) return false;
      r.used = num(r.used) + n;
      return true;
    };

    switch (what) {
      case 'rage': {
        if (!this._spend(unit, b, 'bonus')) return { ok: false, results, error: 'no-bonus' };
        if (!spend('rage')) { b.bonus++; this._push(`${unit.name} has no Rage left today.`, 'info', unit); return { ok: false, results, error: 'no-resource' }; }
        // Rage also ends any Concentration — you cannot hold a spell in that state.
        if (isConcentrating(unit)) safe(() => breakConcentration(unit, 'flew into a Rage'));
        addCondition(unit, 'raging', { source: unit.uid });
        this._push(`${unit.name} roars and enters a Rage!`, 'buff', unit);
        results.push({ kind: 'resource', unit: unit.uid, id: 'rage', left: num(res.rage.max) - num(res.rage.used) });
        return { ok: true, results };
      }

      case 'second-wind': {
        if (!this._spend(unit, b, 'bonus')) return { ok: false, results, error: 'no-bonus' };
        if (!spend('second-wind')) { b.bonus++; return { ok: false, results, error: 'no-resource' }; }
        const lvl = classLevel(unit, 'fighter') || unit.level || 1;
        const roll = rollExpr('1d10', this.rng);
        const total = roll.total + lvl;
        this._push(`${unit.name} catches their second wind: 1d10 [${roll.rolls.join(',')}] +${lvl} = ${total} hit points.`, 'heal', unit);
        const h = healTarget(this, unit, total);
        results.push({ kind: 'heal', source: unit.uid, target: unit.uid, amount: h.healed });
        return { ok: true, results };
      }

      case 'action-surge': {
        if (b.actionSurgeUsed) return { ok: false, results, error: 'already-surged' };
        if (!spend('action-surge')) return { ok: false, results, error: 'no-resource' };
        b.action += 1;
        b.actionSurgeUsed = true;
        this._push(`${unit.name} surges — one more action, right now!`, 'buff', unit);
        results.push({ kind: 'resource', unit: unit.uid, id: 'action-surge', extraAction: true });
        return { ok: true, results };
      }

      case 'channel-divinity': {
        if (!this._spend(unit, b, 'action')) return { ok: false, results, error: 'no-action' };
        if (!spend('channel-divinity')) { b.action++; return { ok: false, results, error: 'no-resource' }; }
        // Turn Undead is the universal expression; a subclass option can override it
        // by passing { mode } through the target payload.
        const dc = safe(() => spellDC(unit), 8 + profBonus(unit) + abilityMod(unit, 'wis'));
        this._push(`${unit.name} raises a holy symbol and channels divine power (DC ${dc}).`, 'spell', unit);
        for (const u of this.units) {
          if (!u || isDead(u) || !isHostile(u, unit)) continue;
          if (distanceFt(unit, u) > 30 || !lineOfSight(this, unit, u)) continue;
          if (!['undead', 'fiend'].includes(lower(u.type))) continue;
          const sv = resolveSave(this, unit, u, {
            ability: 'wis', dc, onSuccess: 'negate', reason: 'Turn Undead', magic: true,
            effects: [{ kind: 'condition', id: 'frightened', rounds: 10, dc }],
          });
          results.push({ kind: 'save', source: unit.uid, target: u.uid, result: sv });
        }
        return { ok: true, results };
      }

      case 'lay-on-hands': {
        if (!this._spend(unit, b, 'bonus')) return { ok: false, results, error: 'no-bonus' };
        const pool = res['lay-on-hands'];
        const target = tgt.unit || unit;
        const want = clamp(num(tgt.extra?.amount, Math.min(num(pool?.max) - num(pool?.used), Math.max(1, maxHpOf(target) - target.hp))), 1, Math.max(1, num(pool?.max) - num(pool?.used)));
        if (!spend('lay-on-hands', want)) { b.bonus++; return { ok: false, results, error: 'no-resource' }; }
        this._push(`${unit.name} lays on hands: ${want} hit points flow into ${target.name}.`, 'heal', unit);
        const h = healTarget(this, target, want);
        results.push({ kind: 'heal', source: unit.uid, target: target.uid, amount: h.healed });
        return { ok: true, results };
      }

      case 'flurry-of-blows': {
        if (!this._spend(unit, b, 'bonus')) return { ok: false, results, error: 'no-bonus' };
        if (!spend('focus')) { b.bonus++; return { ok: false, results, error: 'no-resource' }; }
        const weapons = safe(() => weaponsOf(unit), []) || [];
        const fist = weapons.find((w) => w.slot === 'unarmed') || weapons[weapons.length - 1];
        const target = tgt.unit;
        this._push(`${unit.name} unleashes a Flurry of Blows!`, 'buff', unit);
        for (let i = 0; i < 2; i++) {
          const t = target && !isDead(target) ? target : this._pickMonsterTarget(unit, { reach: 5 }, tgt);
          if (!t || !fist) break;
          const r = this._attack(unit, t, {
            weapon: fist.inst || fist.item, damage: fist.damage, atkBonus: fist.attackBonus,
            range: fist.range, label: 'Unarmed Strike',
          });
          results.push({ kind: 'attack', attacker: unit.uid, target: t.uid, result: r });
        }
        this._sweepDeaths(unit);
        this._checkEnd();
        return { ok: true, results };
      }

      case 'patient-defense': {
        if (!spend('focus')) return { ok: false, results, error: 'no-resource' };
        const d1 = this._doDisengage(unit, b, results, 'bonus');
        if (!d1.ok) { res.focus.used--; return d1; }
        this._doDodge(unit, b, results, 'free');
        return { ok: true, results };
      }

      case 'step-of-the-wind': {
        if (!spend('focus')) return { ok: false, results, error: 'no-resource' };
        if (!this._spend(unit, b, 'bonus')) { res.focus.used--; return { ok: false, results, error: 'no-bonus' }; }
        b.movement += b.moveMax;
        addCondition(unit, 'disengaging', { source: unit.uid });
        this._push(`${unit.name} moves like the wind — Dash and Disengage.`, 'buff', unit);
        results.push({ kind: 'dash', unit: unit.uid, movement: b.movement });
        return { ok: true, results };
      }

      case 'bardic-inspiration': {
        if (!this._spend(unit, b, 'bonus')) return { ok: false, results, error: 'no-bonus' };
        if (!spend('bardic-inspiration')) { b.bonus++; return { ok: false, results, error: 'no-resource' }; }
        const ally = tgt.unit || unit;
        const die = bardicDie(unit);
        addCondition(ally, 'inspired', { source: unit.uid, data: { die } });
        this._push(`${unit.name} inspires ${ally.name} — a ${die} to add to one D20 Test.`, 'buff', unit);
        results.push({ kind: 'effect', kindId: 'inspired', target: ally.uid, die });
        return { ok: true, results };
      }

      case 'cunning-dash': {
        if (!this._spend(unit, b, 'bonus')) return { ok: false, results, error: 'no-bonus' };
        b.movement += b.moveMax;
        this._push(`${unit.name} Dashes as a Bonus Action (Cunning Action).`, 'info', unit);
        results.push({ kind: 'dash', unit: unit.uid, movement: b.movement });
        return { ok: true, results };
      }
      case 'cunning-disengage': return this._doDisengage(unit, b, results, 'bonus');
      case 'cunning-hide': return this._doHide(unit, b, results, 'bonus');

      case 'sneak-attack': {
        unit.flags = unit.flags || {};
        unit.flags.sneakOff = !unit.flags.sneakOff;
        this._push(`Sneak Attack ${unit.flags.sneakOff ? 'held back' : 'armed'}.`, 'info', unit);
        results.push({ kind: 'toggle', id: 'sneak-attack', active: !unit.flags.sneakOff });
        return { ok: true, results };
      }

      case 'divine-smite': {
        unit.flags = unit.flags || {};
        const lvl = tgt.level != null ? tgt.level : (safe(() => availableSlots(unit, 1), [])?.[0] ?? 1);
        unit.flags.smiteArmed = !unit.flags.smiteArmed;
        unit.flags.smiteLevel = lvl;
        this._push(unit.flags.smiteArmed
          ? `${unit.name} readies a Divine Smite (${ordinalLevel(lvl)} level slot) for the next hit.`
          : `${unit.name} holds the smite back.`, 'info', unit);
        results.push({ kind: 'toggle', id: 'divine-smite', active: !!unit.flags.smiteArmed, level: lvl });
        return { ok: true, results };
      }

      default:
        this._push(`${unit.name} uses ${what.replace(/-/g, ' ')}.`, 'info', unit);
        results.push({ kind: 'special', id: what, unit: unit.uid });
        return { ok: true, results };
    }
  }

  // =========================================================================
  // MOVEMENT
  // =========================================================================

  _inBounds(x, y) {
    if (this.map && typeof this.map.inBounds === 'function') return !!this.map.inBounds(x, y);
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  _isSolid(x, y) {
    if (!this._inBounds(x, y)) return true;
    const m = this.map;
    if (!m) return false;
    if (typeof m.flagAt === 'function') return (num(m.flagAt(x, y)) & TILE_FLAGS.SOLID) !== 0;
    if (typeof m.solid === 'function') return !!m.solid(x, y);
    return false;
  }

  /** Difficult terrain: rubble, deep snow, undergrowth, shallow water. */
  _isDifficult(x, y) {
    const m = this.map;
    if (!m || typeof m.flagAt !== 'function') return false;
    const f = num(m.flagAt(x, y));
    return (f & TILE_FLAGS.SLOW) !== 0 || (f & TILE_FLAGS.WATER) !== 0;
  }

  /**
   * Can `unit` enter this square, and may it stop there?
   * You may move through an ally's space but never end your move there; a hostile's
   * space is blocked outright unless you are two sizes larger than it.
   */
  _squareFor(unit, x, y) {
    if (!this._inBounds(x, y) || this._isSolid(x, y)) return { pass: false, stop: false };
    const occ = unitAt(this, x, y);
    if (!occ || occ === unit) return { pass: true, stop: true };
    if (isAlly(occ, unit)) return { pass: true, stop: false, through: occ };
    // Two sizes larger and you can simply walk over it.
    if (sizeRank(unit) - sizeRank(occ) >= 2) return { pass: true, stop: false, through: occ };
    return { pass: false, stop: false, blocker: occ };
  }

  /**
   * Dijkstra flood fill over the grid.
   * Returns Map<'x,y', { x, y, cost, path, difficult }> of squares the unit can both
   * reach AND stop in, with the cheapest path to each (in feet).
   */
  reachableTiles(unit, opts = {}) {
    const out = new Map();
    if (!unit) return out;
    const budget = this._budgetFor(unit);
    const limit = num(opts.movement, num(budget?.movement, safe(() => speedWithConditions(unit, speedOf(unit)), 30)));
    const start = tileOf(unit);
    if (limit <= 0) return out;

    const cm = conditionMech(unit);
    // Crawling costs an extra foot per foot (2024 Prone), as does difficult terrain.
    const proneMult = cm.prone && !cm.immobile ? 2 : 1;
    const ignoreDifficult = !!cm.ignoreDifficult;

    const best = new Map();
    const startKey = kxy(start.x, start.y);
    best.set(startKey, { x: start.x, y: start.y, cost: 0, path: [] });

    // A tiny binary-less priority queue: the frontier stays small on a 22x15 arena.
    const frontier = [best.get(startKey)];
    while (frontier.length) {
      let bi = 0;
      for (let i = 1; i < frontier.length; i++) if (frontier[i].cost < frontier[bi].cost) bi = i;
      const cur = frontier.splice(bi, 1)[0];
      const curKey = kxy(cur.x, cur.y);
      if (best.get(curKey) && best.get(curKey).cost < cur.cost) continue;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cur.x + dx, ny = cur.y + dy;
          const sq = this._squareFor(unit, nx, ny);
          if (!sq.pass) continue;
          // No squeezing diagonally between two blocked corners.
          if (dx && dy && (this._isSolid(cur.x + dx, cur.y) && this._isSolid(cur.x, cur.y + dy))) continue;

          const difficult = !ignoreDifficult && this._isDifficult(nx, ny);
          const step = FEET_PER_TILE * (difficult ? 2 : 1) * proneMult;
          const cost = cur.cost + step;
          if (cost > limit) continue;

          const k = kxy(nx, ny);
          const prev = best.get(k);
          if (prev && prev.cost <= cost) continue;
          const node = { x: nx, y: ny, cost, path: [...cur.path, { x: nx, y: ny }], difficult, stop: sq.stop };
          best.set(k, node);
          frontier.push(node);
        }
      }
    }

    for (const [k, node] of best) {
      if (k === startKey) continue;
      if (node.stop === false) continue;                 // an ally is standing there
      if (unitAt(this, node.x, node.y)) continue;
      out.set(k, { x: node.x, y: node.y, cost: node.cost, path: node.path, difficult: !!node.difficult });
    }
    return out;
  }

  /** The cheapest path to a tile, or null if it is out of reach. */
  pathTo(unit, x, y) {
    const reach = this.reachableTiles(unit);
    return reach.get(kxy(x, y))?.path || null;
  }

  /**
   * Walk a path one square at a time, paying movement, triggering Opportunity
   * Attacks the moment the mover leaves a hostile's reach, and stopping the instant
   * the mover drops.
   * `path` is a list of tiles to step onto; a leading tile equal to the current
   * position is ignored.
   */
  moveUnit(unit, path) {
    const out = { ok: false, provoked: [], moved: 0, steps: [], stopped: null, from: null, to: null };
    if (!unit) return out;
    if (isDead(unit) || unit.hp <= 0) { this._push(`${unit.name || 'The creature'} cannot move.`, 'info', unit); return out; }

    const cm = conditionMech(unit);
    if (cm.immobile || cm.speed === 0) {
      this._push(`${unit.name} cannot move — ${cm.ids.map((i) => conditionName(i)).join(', ') || 'held fast'}.`, 'debuff', unit);
      return out;
    }

    const budget = this._budgetFor(unit);
    const steps = arr(path).filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number');
    const start = { ...tileOf(unit) };
    out.from = start;
    out.to = start;
    if (!steps.length) return out;
    if (steps[0].x === start.x && steps[0].y === start.y) steps.shift();

    const proneMult = cm.prone ? 2 : 1;
    const ignoreDifficult = !!cm.ignoreDifficult;
    let cur = { ...start };

    for (const step of steps) {
      const dx = Math.abs(step.x - cur.x), dy = Math.abs(step.y - cur.y);
      if (dx > 1 || dy > 1 || (!dx && !dy)) { out.stopped = 'broken-path'; break; }

      const sq = this._squareFor(unit, step.x, step.y);
      if (!sq.pass) { out.stopped = sq.blocker ? 'blocked-by-creature' : 'blocked'; break; }

      const difficult = !ignoreDifficult && this._isDifficult(step.x, step.y);
      const cost = FEET_PER_TILE * (difficult ? 2 : 1) * proneMult;
      if (cost > budget.movement) { out.stopped = 'out-of-movement'; break; }

      // --- opportunity attacks -------------------------------------------
      // Resolved while the mover is still in the square it is leaving, so the
      // attacker is unquestionably within reach.
      const reactors = safe(() => opportunityCheck(this, unit, cur, step), []) || [];
      for (const r of reactors) {
        const foe = r.unit;
        if (!foe || isDead(foe) || foe._reactionUsed) continue;
        const taken = this._askReaction(foe, {
          kind: 'opportunity-attack',
          name: 'Opportunity Attack',
          desc: `${unit.name || 'A creature'} is leaving ${foe.name || 'your'} reach.`,
          trigger: { mover: unit, from: cur, to: step },
        });
        if (!taken) continue;
        this._spend(foe, this._budgetFor(foe), 'reaction');
        this._push(`${foe.name} takes an Opportunity Attack as ${unit.name} slips away!`, 'info', foe);
        const res = this._attack(foe, unit, this._meleeAttackOpts(foe));
        out.provoked.push({ attacker: foe.uid, result: res });
        bus.emit(COMBAT_EV.REACTION, { enc: this, unit: foe, kind: 'opportunity-attack', target: unit });
        if (unit.hp <= 0) break;
      }
      if (unit.hp <= 0) { out.stopped = 'dropped'; this._sweepDeaths(); break; }

      // --- commit the step ------------------------------------------------
      budget.movement -= cost;
      budget.moveUsed += cost;
      cur = { x: step.x, y: step.y };
      unit.pos = { x: cur.x, y: cur.y };
      out.moved += cost;
      out.steps.push({ x: cur.x, y: cur.y, cost, difficult });
      bus.emit(COMBAT_EV.MOVE, { enc: this, unit, from: out.from, to: cur, cost });

      // Moving loudly breaks Hiding.
      if (hasCondition(unit, 'hidden') && !this.rng.chance(0.5)) removeCondition(unit, 'hidden');

      // Damaging terrain (lava, a caltrop field).
      if (this.map && typeof this.map.flagAt === 'function' && (num(this.map.flagAt(cur.x, cur.y)) & TILE_FLAGS.DAMAGE)) {
        const dmg = rollExpr('1d10', this.rng);
        applyDamage(this, unit, dmg.total, 'fire', { source: null, label: 'burning ground' });
        this._push(`${unit.name} crosses scorching ground: 1d10 [${dmg.rolls.join(',')}] = ${dmg.total} fire damage.`, 'damage', unit);
        if (unit.hp <= 0) { out.stopped = 'dropped'; this._sweepDeaths(); break; }
      }
    }

    out.to = cur;
    out.ok = out.moved > 0;
    if (out.moved > 0) {
      this._push(`${unit.name} moves ${out.moved} ft.`, 'info', unit);
    }
    this._sweepDeaths();
    this._checkEnd();
    return out;
  }

  // =========================================================================
  // REACTIONS
  // =========================================================================

  /**
   * Ask a creature whether it wants to spend its Reaction.
   * The UI supplies `onReaction(reactor, offer, enc)`; without one, a small default
   * AI decides. Returns the chosen option id (or true) — falsy means "no".
   */
  _askReaction(reactor, offer) {
    if (!reactor || isDead(reactor)) return null;
    if (reactor._reactionUsed || reactor.flags?.reactionUsed) return null;
    const cm = conditionMech(reactor);
    if (cm.noReactions || cm.incapacitated) return null;
    if (reactor.hp <= 0) return null;

    if (this._onReaction) {
      const answer = safe(() => this._onReaction(reactor, offer, this), undefined);
      if (answer !== undefined) return answer;
    }
    return defaultReactionAI(this, reactor, offer);
  }

  /**
   * Everything a defender (or its friends) can do BEFORE the attack roll is made.
   * Returns { dis, disReason, resistAll, damageReduction, used:[] }.
   */
  _preAttackReactions(attacker, target, opts = {}) {
    const mods = { dis: false, disReason: '', resistAll: false, damageReduction: 0, used: [] };
    if (!attacker || !target || this.state !== 'active') return mods;
    if (opts.noReactions) return mods;

    // --- Protection fighting style (an ally interposes a shield) ------------
    for (const ally of this.units) {
      if (!ally || ally === target || isDead(ally) || !isAlly(ally, target)) continue;
      if (ally._reactionUsed || distanceFt(ally, target) > 5) continue;
      if (!hasFightingStyle(ally, 'protection')) continue;
      if (!equippedDef(ally, 'shield') && !equippedDef(ally, 'offHand')) continue;
      const taken = this._askReaction(ally, {
        kind: 'protection', name: 'Protection',
        desc: `${attacker.name || 'A foe'} is attacking ${target.name}. Interpose your shield?`,
        trigger: { attacker, target },
      });
      if (!taken) continue;
      this._spend(ally, this._budgetFor(ally), 'reaction');
      mods.dis = true;
      mods.disReason = `${ally.name} interposes a shield (Protection)`;
      mods.used.push({ uid: ally.uid, kind: 'protection' });
      this._push(`${ally.name} throws a shield across ${target.name} — the attack has Disadvantage.`, 'buff', ally);
      break;
    }

    // --- Shield (the spell): +5 AC, including against the triggering attack --
    if (!target._reactionUsed && canCastReactionSpell(target, 'shield')) {
      const taken = this._askReaction(target, {
        kind: 'spell-shield', name: 'Shield',
        desc: `${attacker.name || 'A foe'} attacks. Raise a Shield (+5 AC until your next turn)?`,
        trigger: { attacker, target }, spellId: 'shield',
      });
      if (taken) {
        this._spend(target, this._budgetFor(target), 'reaction');
        const slots = safe(() => availableSlots(target, 1), []) || [];
        if (slots.length) safe(() => spendSlot(target, slots[0]));
        addCondition(target, 'shielded', { source: target.uid, spellId: 'shield' });
        mods.used.push({ uid: target.uid, kind: 'shield' });
        this._push(`${target.name} casts Shield — an invisible barrier flares, +5 AC.`, 'buff', target);
      }
    }

    // --- Uncanny Dodge: halve the damage of one attack you can see ----------
    if (!target._reactionUsed && hasPassive(target, 'uncanny-dodge')) {
      const taken = this._askReaction(target, {
        kind: 'uncanny-dodge', name: 'Uncanny Dodge',
        desc: `Halve the damage from ${attacker.name || 'the attacker'}?`,
        trigger: { attacker, target },
      });
      if (taken) {
        this._spend(target, this._budgetFor(target), 'reaction');
        mods.resistAll = true;              // one halving, exactly like Resistance
        mods.used.push({ uid: target.uid, kind: 'uncanny-dodge' });
        this._push(`${target.name} rolls with the blow — Uncanny Dodge halves the damage.`, 'buff', target);
      }
    }

    // --- Monk: Deflect Attacks ---------------------------------------------
    if (!target._reactionUsed && hasPassive(target, 'deflect-attacks')) {
      const taken = this._askReaction(target, {
        kind: 'deflect-attacks', name: 'Deflect Attacks',
        desc: 'Reduce the damage of the incoming attack.',
        trigger: { attacker, target },
      });
      if (taken) {
        this._spend(target, this._budgetFor(target), 'reaction');
        const monk = classLevel(target, 'monk') || target.level || 1;
        const roll = rollExpr('1d10', this.rng);
        const reduce = roll.total + abilityMod(target, 'dex') + monk;
        mods.damageReduction += reduce;
        mods.used.push({ uid: target.uid, kind: 'deflect-attacks', amount: reduce });
        this._push(`${target.name} deflects: 1d10 [${roll.rolls.join(',')}] +${abilityMod(target, 'dex')} +${monk} = ${reduce} damage turned aside.`, 'buff', target);
      }
    }

    return mods;
  }

  /** Riposte and Hellish Rebuke fire after the attack has been resolved. */
  _postAttackReactions(attacker, target, res, opts = {}) {
    if (!res || !res.ok || !attacker || !target || opts.noReactions) return;
    if (isDead(target) || target.hp <= 0) return;

    // --- Riposte (Battle Master): when a melee attack misses you ------------
    const maneuvers = arr(target.choices?.maneuvers).map(lower);
    if (res.miss && !res.blocked && maneuvers.includes('riposte') && !target._reactionUsed
      && distanceFt(target, attacker) <= reachFt(target)) {
      const taken = this._askReaction(target, {
        kind: 'riposte', name: 'Riposte',
        desc: `${attacker.name} missed. Strike back?`,
        trigger: { attacker, target },
      });
      if (taken) {
        this._spend(target, this._budgetFor(target), 'reaction');
        const die = superiorityDie(target);
        const swing = this._meleeAttackOpts(target, 'Riposte');
        // The Superiority Die rides along as extra damage on the counterstrike.
        swing.damage = {
          ...(swing.damage || {}),
          bonusDice: [...arr(swing.damage?.bonusDice), { dice: die, type: swing.damage?.type, label: 'Riposte' }],
        };
        swing.noReactions = true;
        this._push(`${target.name} ripostes!`, 'info', target);
        this._attack(target, attacker, swing);
        const sup = target.resources?.superiority;
        if (sup) sup.used = Math.min(num(sup.max), num(sup.used) + 1);
      }
    }

    // --- Hellish Rebuke: when a creature damages you ------------------------
    if (res.hit && num(res.applied?.dealt) > 0 && !target._reactionUsed
      && canCastReactionSpell(target, 'hellish-rebuke')) {
      const taken = this._askReaction(target, {
        kind: 'spell-hellish-rebuke', name: 'Hellish Rebuke',
        desc: `${attacker.name} hurt you. Wreathe them in flame?`,
        trigger: { attacker, target }, spellId: 'hellish-rebuke',
      });
      if (taken) {
        this._spend(target, this._budgetFor(target), 'reaction');
        const spell = getSpell('hellish-rebuke');
        const slots = safe(() => availableSlots(target, Math.max(1, spell?.level || 1)), []) || [];
        const lvl = slots[0] ?? 1;
        if (slots.length) safe(() => spendSlot(target, lvl));
        const dice = safe(() => spellDamageDice(spell, lvl, target.level || 1), '2d10') || '2d10';
        this._push(`${target.name} answers with Hellish Rebuke!`, 'spell', target);
        const sv = resolveSave(this, target, attacker, {
          ability: spell?.save?.ability || 'dex',
          dc: safe(() => spellDC(target), 13),
          onSuccess: 'half',
          damage: { dice, type: spell?.damage?.type || 'fire' },
          spell, magic: true, reason: 'Hellish Rebuke',
        });
        this._sweepDeaths(target);
        return sv;
      }
    }

    // --- Absorb Elements: elemental damage taken --------------------------
    const elemental = Object.keys(res.byType || {}).find((t) => ['acid', 'cold', 'fire', 'lightning', 'thunder'].includes(lower(t)));
    if (elemental && !target._reactionUsed && canCastReactionSpell(target, 'absorb-elements')) {
      // Absorb Elements is normally declared before the damage lands; the reaction is
      // offered here and refunded as resistance for the rest of the round instead.
      const taken = this._askReaction(target, {
        kind: 'spell-absorb-elements', name: 'Absorb Elements',
        desc: `Soak up the ${elemental} and carry it into your next strike?`,
        trigger: { attacker, target, damageType: elemental }, spellId: 'absorb-elements',
      });
      if (taken) {
        this._spend(target, this._budgetFor(target), 'reaction');
        const slots = safe(() => availableSlots(target, 1), []) || [];
        if (slots.length) safe(() => spendSlot(target, slots[0]));
        if (!Array.isArray(target.effects)) target.effects = [];
        target.effects.push({
          id: 'absorb-elements', name: 'Absorb Elements', dur: 1,
          mech: { resist: [lower(elemental)], bonusDamage: [{ dice: '1d6', type: lower(elemental) }] },
          source: target.uid, spellId: 'absorb-elements',
        });
        target._mech = null;
        safe(() => recalc(target));
        this._push(`${target.name} draws the ${elemental} into their hands — Resistance now, fury on their next hit.`, 'buff', target);
      }
    }
    return null;
  }

  /**
   * A readied action fires. The UI (or ai.js) calls this when the named trigger
   * happens; it spends the reactor's Reaction and performs the banked option.
   */
  triggerReadied(unit, target = null) {
    const readied = unit?._readied;
    if (!readied) return { ok: false, results: [], error: 'nothing-readied' };
    const b = this._budgetFor(unit);
    if (!this._spend(unit, b, 'reaction')) return { ok: false, results: [], error: 'no-reaction' };
    unit._readied = null;
    b.readied = null;
    if (!readied.optionId) {
      this._push(`${unit.name}'s readied action goes off.`, 'info', unit);
      return { ok: true, results: [] };
    }
    // The readied action is paid for by the Reaction, so lend it an action.
    b.action++;
    const res = this.perform(unit, readied.optionId, target || (readied.target ? { unit: this.byUid(readied.target) } : readied.point));
    b.action = Math.max(0, b.action - 1);
    return res;
  }

  // =========================================================================
  // END OF THE FIGHT
  // =========================================================================

  /** Have we reached a conclusion? Sets `state` and finalises when we have. */
  _checkEnd() {
    if (this.state !== 'active') return true;

    const foesUp = this.units.some((u) => u && u.side === 'foe' && !isDead(u) && u.hp > 0 && !u._fled);
    const heroesUp = this.units.some((u) => u && u.side === 'party' && u.hp > 0 && !u._fled);
    const heroesAlive = this.units.some((u) => u && u.side === 'party' && !isDead(u) && !u._fled);

    if (!foesUp) {
      this.state = 'victory';
      this._push('The last of them falls. The field is yours.', 'round');
      this._finish();
      return true;
    }
    if (!heroesUp) {
      // Everyone is down. If a hero is merely dying they still lose the fight —
      // the enemies have no reason to stop, so the party is defeated.
      this.state = 'defeat';
      this._push(heroesAlive
        ? 'The party is overwhelmed — the last of them slumps to the ground.'
        : 'The party has fallen. Darkness takes the Sword Coast a little further.', 'round');
      this._finish();
      return true;
    }
    return false;
  }

  /** Tidy up, roll the spoils once, and announce the end. */
  _finish() {
    if (this._finished) return;
    this._finished = true;
    this.budget = null;

    // Concentration and battlefield-only conditions do not follow anyone home.
    for (const u of this.units) {
      if (!u) continue;
      if (isConcentrating(u)) safe(() => breakConcentration(u, 'the fight ended'));
      for (const c of TRANSIENT_CONDITIONS) removeCondition(u, c);
      u._reactionUsed = false;
      u._budget = null;
      u._readied = null;
      u._actionUses = null;
      resetTurnUses(u);
      if (u.flags) { u.flags.reactionUsed = false; u.flags.smiteArmed = false; }
    }

    if (this.state === 'victory') this.rewards = this.awardXp();
    bus.emit(EV.COMBAT_END, { enc: this, state: this.state, rewards: this.rewards });
  }

  isOver() {
    if (this.state === 'victory' || this.state === 'defeat' || this.state === 'fled') return true;
    return this._checkEnd();
  }

  /** A summary the battle scene shows on the results screen. */
  result() {
    return {
      state: this.state,
      victory: this.state === 'victory',
      defeat: this.state === 'defeat',
      fled: this.state === 'fled',
      rounds: this.round,
      defeated: this.defeated.map((u) => ({ uid: u.uid, name: u.name, monsterId: u.monsterId || null, xp: xpValueOf(u) })),
      survivors: this.units.filter((u) => u.side === 'party' && u.hp > 0).map((u) => u.uid),
      down: this.units.filter((u) => u.side === 'party' && u.hp <= 0 && !isDead(u)).map((u) => u.uid),
      dead: this.units.filter((u) => u.side === 'party' && isDead(u)).map((u) => u.uid),
      rewards: this.rewards,
      log: this.log,
    };
  }

  /**
   * Experience, gold and loot.
   * XP from every creature the party put down, split evenly among the survivors
   * (2024 keeps the DMG's "divide the total by the number of characters" maths);
   * gold and items come from rules/scaling.js lootFor when it is available, and
   * from each stat block's own loot table when it is not.
   */
  awardXp() {
    const foes = this.defeated.filter((u) => u && u.side === 'foe');
    let xp = 0;
    for (const f of foes) xp += xpValueOf(f);

    const survivors = this.units.filter((u) => u && u.side === 'party' && u.kind !== 'monster' && !isDead(u));
    const share = survivors.length ? Math.floor(xp / survivors.length) : 0;

    const leveled = [];
    for (const s of survivors) {
      if (share <= 0) continue;
      const res = safe(() => (typeof Progression.grantXp === 'function' ? Progression.grantXp(s, share) : null), null);
      if (res?.leveled) leveled.push({ uid: s.uid, name: s.name, level: res.newLevel });
      if (!res) s.xp = num(s.xp) + share;      // fall back to a plain XP bump
    }

    // --- treasure ----------------------------------------------------------
    let gold = 0;
    let items = [];
    const fromScaling = safe(() => (typeof Scaling.lootFor === 'function' ? Scaling.lootFor(this) : null), null);
    if (fromScaling) {
      gold = num(fromScaling.gold);
      items = arr(fromScaling.items).slice();
    } else {
      for (const f of foes) {
        const loot = f.loot;
        if (!loot) continue;
        if (loot.gold) gold += Math.max(0, rollExpr(loot.gold, this.rng).total);
        for (const row of arr(loot.table)) {
          if (!Array.isArray(row)) continue;
          const [itemId, chance] = row;
          if (itemId && this.rng.chance(num(chance, 0.1))) items.push(itemId);
        }
      }
    }

    if (xp > 0) {
      this._push(`The party earns ${xp} experience${survivors.length > 1 ? ` (${share} each)` : ''}.`, 'info');
    }
    if (gold > 0) this._push(`You gather ${gold} gp from the fallen.`, 'info');
    for (const it of items) this._push(`Found: ${itemName(it) || it}.`, 'info');
    for (const l of leveled) this._push(`${l.name} reaches level ${l.level}!`, 'buff');
    if (xp > 0) bus.emit(EV.XP_GAIN, { enc: this, xp, share, survivors: survivors.map((s) => s.uid) });

    return { xp, share, gold, loot: items, items, leveled, survivors: survivors.map((s) => s.uid) };
  }

  /**
   * Try to run away. 2024/DMG chase rules resolve an escape as a group Dexterity
   * contest: every conscious member of the fleeing side rolls Dexterity (Acrobatics
   * counts if they have it), every conscious pursuer rolls the same, and the higher
   * average wins. A tie favours the pursuers — you have to genuinely outpace them.
   */
  fleeCheck(unit) {
    const out = { ok: true, success: false, side: null, rolls: [], mine: 0, theirs: 0, log: [] };
    if (!unit) { out.ok = false; return out; }
    if (this.state !== 'active') { out.ok = false; return out; }

    const side = unit.side || (unit.kind === 'monster' ? 'foe' : 'party');
    out.side = side;
    const runners = this.units.filter((u) => u && u.side === side && u.hp > 0 && !isDead(u));
    const chasers = this.units.filter((u) => u && u.side !== side && u.hp > 0 && !isDead(u));

    if (!chasers.length) { out.success = true; }
    else {
      const rollFor = (u) => {
        const useAcro = (u.skills?.acrobatics === 'prof' || u.skills?.acrobatics === 'expert');
        const check = abilityCheck(this, u, 'dex', useAcro ? { skill: 'acrobatics' } : {});
        out.rolls.push({ uid: u.uid, name: u.name, total: check.total, side: u.side });
        return check.total;
      };
      let mine = 0, theirs = 0;
      for (const u of runners) mine += rollFor(u);
      for (const u of chasers) theirs += rollFor(u);
      out.mine = runners.length ? mine / runners.length : 0;
      out.theirs = chasers.length ? theirs / chasers.length : 0;
      // Being Grappled or Restrained makes escape impossible until you are free.
      const held = runners.some((u) => conditionMech(u).immobile || conditionMech(u).speed === 0);
      out.success = !held && out.mine > out.theirs;
      if (held) this._push('Someone is held fast — the party cannot break away.', 'miss', unit);
    }

    this._push(out.success
      ? `${side === 'party' ? 'The party' : 'The enemy'} breaks off and runs (${out.mine.toFixed(1)} vs ${out.theirs.toFixed(1)}).`
      : `The escape fails — ${side === 'party' ? 'the enemy' : 'the party'} cuts them off (${out.mine.toFixed(1)} vs ${out.theirs.toFixed(1)}).`,
      out.success ? 'buff' : 'miss', unit);

    if (out.success) {
      for (const u of runners) u._fled = true;
      this.escaped.push(...runners);
      if (side === 'party') {
        this.state = 'fled';
        this._finish();
      } else {
        // The monsters ran: that counts as the party's victory.
        this._checkEnd();
      }
    } else if (side === 'party') {
      // A failed escape costs the action of whoever called for it.
      const b = this._budgetFor(unit);
      b.action = Math.max(0, b.action - 1);
    }

    bus.emit(COMBAT_EV.FLEE, { enc: this, unit, success: out.success, side });
    return out;
  }

  /** Force the fight to end (a cutscene, a surrender, a UI escape hatch). */
  forceEnd(state = 'fled') {
    if (this.state === 'victory' || this.state === 'defeat' || this.state === 'fled') return this.state;
    this.state = state;
    this._finish();
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Introspection helpers the UI and ai.js lean on
  // -------------------------------------------------------------------------

  allies(unit) { return this.units.filter((u) => u && u !== unit && !isDead(u) && isAlly(u, unit)); }
  foes(unit) { return this.units.filter((u) => u && !isDead(u) && isHostile(u, unit)); }
  livingUnits() { return this.units.filter((u) => u && !isDead(u)); }

  /** Squares this creature currently threatens, for the UI's threat overlay. */
  threatTiles(unit) {
    const out = [];
    if (!unit || isDead(unit) || unit.hp <= 0) return out;
    const p = tileOf(unit);
    const reach = Math.max(1, Math.round(reachFt(unit) / FEET_PER_TILE));
    for (let y = p.y - reach; y <= p.y + reach; y++) {
      for (let x = p.x - reach; x <= p.x + reach; x++) {
        if ((x === p.x && y === p.y) || !this._inBounds(x, y) || this._isSolid(x, y)) continue;
        out.push({ x, y });
      }
    }
    return out;
  }

  /** A compact status line for the initiative rail. */
  statusOf(unit) {
    if (!unit) return null;
    return {
      uid: unit.uid, name: unit.name, side: unit.side,
      hp: unit.hp, maxHp: maxHpOf(unit), tempHp: unit.tempHp || 0,
      ac: acOf(unit), pos: { ...tileOf(unit) },
      conditions: activeConditions(unit).map((c) => c.id),
      dead: isDead(unit), down: unit.hp <= 0 && !isDead(unit),
      concentrating: isConcentrating(unit),
      initiative: this.initiative[unit.uid]?.total ?? 0,
      current: this.currentUid === unit.uid,
    };
  }
}

// ===========================================================================
// Module-level helpers
// ===========================================================================

/** Run a function, swallow any failure, return a fallback. Nothing here may throw. */
function safe(fn, fallback = undefined) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (e) {
    if (typeof console !== 'undefined' && console.debug) console.debug('[combat] recovered:', e?.message || e);
    return fallback;
  }
}

/** Normalise an ActionOption so the UI can rely on every field being present. */
function opt(o) {
  const enabled = o.enabled !== false;
  return {
    ...o,
    id: o.id,
    kind: o.kind || 'special',
    name: o.name || o.id,
    cost: o.cost || 'action',
    icon: o.icon || 'dot',
    desc: o.desc || '',
    targeting: o.targeting || { kind: 'self' },
    enabled,
    reason: enabled ? '' : (o.reason || 'Unavailable'),
  };
}

/** "goblin, goblin and a bugbear" -> "2 goblins and a bugbear". */
function summarise(names) {
  const counts = new Map();
  for (const n of arr(names)) counts.set(n, (counts.get(n) || 0) + 1);
  const parts = [];
  for (const [n, c] of counts) parts.push(c > 1 ? `${c} ${n}s` : n);
  if (parts.length <= 1) return parts[0] || 'nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function ordinalLevel(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** A spell's duration expressed in rounds, for concentration bookkeeping. */
function roundsForDuration(duration) {
  const d = lower(duration);
  if (!d || d === 'instant' || d === 'instantaneous') return null;
  if (d === '1 round') return 1;
  const m = d.match(/^(\d+)\s*(round|minute|hour)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (m[2] === 'round') return n;
  if (m[2] === 'minute') return n * 10;      // 10 rounds to the minute
  return n * 600;
}

/** A one-line rules blurb for a spell in the action menu. */
function spellBlurb(spell, dc, atk) {
  const bits = [];
  bits.push(spell.level === 0 ? 'Cantrip' : `Level ${spell.level}`);
  if (spell.damage?.dice) bits.push(`${spell.damage.dice} ${spell.damage.type}`);
  if (spell.heal?.dice) bits.push(`heals ${spell.heal.dice}`);
  if (spell.attack) bits.push(`${signed(atk)} spell attack`);
  if (spell.save) bits.push(`DC ${dc} ${String(spell.save.ability || 'dex').toUpperCase()}`);
  if (spell.concentration) bits.push('Concentration');
  return bits.join(' · ');
}

/** "+5 to hit, 1d6+3 slashing" for a monster action with no desc of its own. */
function describeMonsterAction(act) {
  if (!act) return '';
  const bits = [];
  if (act.atkBonus != null) bits.push(`${signed(act.atkBonus)} to hit`);
  if (act.dice) bits.push(`${act.dice} ${act.dtype || 'damage'}`);
  if (act.save) bits.push(`DC ${act.save.dc} ${String(act.save.ability || 'dex').toUpperCase()}`);
  if (act.reach) bits.push(`reach ${act.reach} ft`);
  if (act.range) bits.push(`range ${arr(act.range).join('/')} ft`);
  return bits.join(', ');
}

/** Split "2d6+3" off a stat block action into the damage package resolveAttack wants. */
function parseMonsterDamage(act) {
  if (!act) return null;
  const dice = act.dice || act.damage;
  if (!dice) return null;
  return { dice: String(dice), mod: 0, type: act.dtype || act.damageType || 'bludgeoning', bonusDice: arr(act.bonusDice) };
}

/** XP a defeated creature is worth. */
function xpValueOf(u) {
  if (!u) return 0;
  if (num(u.xpValue) > 0) return num(u.xpValue);
  if (num(u.xp) > 0 && u.kind === 'monster') return num(u.xp);
  if (u.monsterId) return safe(() => xpOf(u.monsterId), 0);
  if (u.cr != null) return safe(() => xpForCR(u.cr), 0);
  return 0;
}

/** The Bardic Inspiration die grows with the bard's level. */
function bardicDie(ch) {
  const lvl = classLevel(ch, 'bard') || ch.level || 1;
  if (lvl >= 15) return '1d12';
  if (lvl >= 10) return '1d10';
  if (lvl >= 5) return '1d8';
  return '1d6';
}

/** The Battle Master's Superiority Die. */
function superiorityDie(ch) {
  const lvl = classLevel(ch, 'fighter') || ch.level || 1;
  if (lvl >= 18) return '1d12';
  if (lvl >= 10) return '1d10';
  return '1d8';
}

/** Can this creature actually pay for a named reaction spell right now? */
function canCastReactionSpell(ch, spellId) {
  if (!ch || !ch.spells) return false;
  const cm = conditionMech(ch);
  if (cm.cannotCast || cm.noReactions || cm.incapacitated) return false;
  const known = new Set([...arr(ch.spells.cantrips), ...arr(ch.spells.prepared)]);
  if (!known.has(spellId)) {
    const all = safe(() => knownSpells(ch), []) || [];
    if (!all.includes(spellId)) return false;
  }
  const spell = getSpell(spellId);
  if (!spell) return false;
  if (spell.level === 0) return true;
  return (safe(() => availableSlots(ch, spell.level), []) || []).length > 0;
}

/**
 * Run `fn` with the target temporarily Resistant to everything, then restore the
 * list. character.js halves damage once no matter how many entries match, so this
 * is exactly the "halve the damage" that Uncanny Dodge asks for — and it composes
 * correctly with a creature that was already Resistant.
 */
function withTemporaryResistAll(target, fn) {
  if (!target) return fn();
  const before = Array.isArray(target.resist) ? target.resist.slice() : [];
  try {
    target.resist = [...before, 'all'];
    return fn();
  } finally {
    target.resist = before;
  }
}

/**
 * The fallback reaction brain, used whenever the UI does not supply onReaction.
 * Deliberately simple and a little cautious: reactions are precious, so it spends
 * them on real threats rather than on the first goblin that walks past.
 */
function defaultReactionAI(enc, reactor, offer) {
  if (!reactor || !offer) return false;
  const r = enc?.rng || globalRng;
  const hpPct = maxHpOf(reactor) > 0 ? reactor.hp / maxHpOf(reactor) : 1;

  switch (offer.kind) {
    case 'opportunity-attack': {
      const mover = offer.trigger?.mover;
      // Don't waste the swing on someone already dying.
      if (!mover || mover.hp <= 0) return false;
      return true;
    }
    case 'protection':
      // Interpose for a friend who is actually in danger.
      return (offer.trigger?.target?.hp || 0) <= maxHpOf(offer.trigger?.target) * 0.5;
    case 'uncanny-dodge':
    case 'deflect-attacks':
      // Worth it when a solid hit would matter — always when badly hurt.
      return hpPct <= 0.6 || r.chance(0.5);
    case 'spell-shield':
      return hpPct <= 0.75;
    case 'spell-hellish-rebuke':
      return true;
    case 'spell-absorb-elements':
      return true;
    case 'riposte':
      return true;
    default:
      return false;
  }
}

/**
 * A last-resort monster builder used when rules/scaling.js has not been written yet
 * (or does not know the id). It produces a Character-shaped object good enough for
 * every function in the rules layer to read.
 */
function quickMonster(monsterId, r = globalRng, opts = {}) {
  const m = MONSTERS?.[monsterId];
  if (!m) return null;

  const abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...(m.abilities || {}) };
  const hpRoll = rollExpr(m.hpDice || '2d8', r);
  const conMod = Math.floor((abilities.con - 10) / 2);
  const dice = (m.hpDice || '2d8').match(/^(\d+)d/);
  const hp = Math.max(1, hpRoll.total + (dice ? parseInt(dice[1], 10) * conMod : 0));
  const prof = safe(() => profForCR(m.cr ?? 0), 2);

  const ch = {
    uid: newUid('mon'),
    kind: 'monster',
    name: opts.name || m.name || monsterId,
    title: '',
    speciesId: null, lineageId: null, backgroundId: null,
    classes: [], level: Math.max(1, Math.round((m.cr ?? 1) || 1)), xp: 0,
    base: { ...abilities }, asi: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    hp, maxHp: hp, tempHp: 0,
    hitDice: {}, deathSaves: { success: 0, fail: 0, stable: false },
    ac: num(m.ac, 12),
    speed: num(m.speed, 30),
    size: m.size || 'medium',
    prof,
    initiative: Math.floor((abilities.dex - 10) / 2),
    skills: {}, saveProfs: arr(m.saveProf).slice(),
    profs: { armor: [], weapon: [], tool: [], language: [] },
    resist: arr(m.resist).slice(), immune: arr(m.immune).slice(),
    vuln: arr(m.vuln).slice(), condImmune: arr(m.condImmune).slice(),
    senses: { ...(m.senses || {}) },
    conditions: [], effects: [], concentration: null,
    equipment: {}, inventory: [], gold: 0,
    spells: null, resources: {},
    featIds: [], choices: {},
    appearance: {}, colorway: null,
    sprite: m.sprite || 'goblin', tint: m.tint || null,
    // Stat-block data the rules layer reads directly.
    type: m.type || 'humanoid',
    traits: arr(m.traits).slice(),
    actions: arr(m.actions).slice(),
    bonusActions: arr(m.bonusActions).slice(),
    reactions: arr(m.reactions).slice(),
    legendary: m.legendary || null,
    ai: m.ai || { archetype: 'brute', aggression: 0.7, selfPreserve: 0.3, preferredRange: 5 },
    monsterId,
    cr: m.cr ?? 0,
    xpValue: num(m.xp, safe(() => xpForCR(m.cr ?? 0), 10)),
    loot: m.loot || null,
    faction: m.faction || null,
    flags: {}, notes: '',
    side: 'foe',
  };

  // Skill proficiencies come out of the stat block as flat bonuses; the closest
  // Character-shaped equivalent is a proficiency in that skill.
  for (const s of Object.keys(m.skills || {})) ch.skills[s] = 'prof';
  return ch;
}

// ===========================================================================
// Factory
// ===========================================================================

/**
 * Build (and open) an encounter.
 * The battle scene calls this, then drives the returned Encounter:
 *
 *   const enc = buildEncounter({ party: Party.members, enemies, map, seed, biome, ambush });
 *   const options = enc.availableActions(enc.current);
 *   enc.perform(enc.current, 'attack:mainHand:longsword:normal', { unit: goblin });
 *   enc.endTurn();
 */
export function buildEncounter(opts = {}) {
  const enc = new Encounter(opts);
  if (opts.autoStart !== false) safe(() => enc.start());
  return enc;
}

export default Encounter;
