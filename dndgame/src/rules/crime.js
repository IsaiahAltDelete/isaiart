// rules/crime.js — drawing steel on people who are not monsters, and paying for it.
//
// Baldur's Gate 3's best trick is that "attack" is always on the table. You can
// stab the quartermaster. Nobody stops you. What happens instead is that the
// Flaming Fist turn up, the shops close their doors, and the quest you were
// halfway through quietly dies with the man who gave it to you.
//
// This module is the bookkeeping behind that. It is headless and synchronous —
// no rendering, no scene pushes — so the overworld, the dialogue screen and the
// battle screen can all consult it without importing each other.
//
// The three questions it answers:
//   canAttack(npc)        — is this a person you are allowed to swing at?
//   statBlockFor(npc)     — which bestiary entry stands in for a townsfolk?
//   witness/report        — who saw it, and what does the watch do about it?
//
// State lives on GameState.crime, created lazily so old saves still load:
//   { bounty: { [region]: gp }, slain: { [npcId]: true },
//     outlaw: { [region]: true }, witnessed: n, lastCrimeDay: n }

import { setFlag, addReputation } from '../state.js';

/** Nobody gets to draw steel on these, whatever the player types. */
const PROTECTED_TAGS = new Set(['child', 'animal']);

/**
 * NPC role/sprite -> the bestiary entry that fights in their place. The town
 * watch is genuinely dangerous; a potter is not, and should not pretend to be.
 */
const ROLE_BLOCK = {
  guard: 'guard',
  priest: 'acolyte',
  shopkeeper: 'commoner',
  innkeep: 'commoner',
  questgiver: 'commoner',
  flavor: 'commoner',
};

const SPRITE_BLOCK = {
  'npc-guard': 'guard',
  'npc-thug': 'thug',
  'npc-noble': 'noble',
  'npc-priest': 'acolyte',
  'npc-hooded': 'spy',
  'npc-merchant': 'commoner',
  'npc-miner': 'commoner',
  'npc-smith': 'commoner',
  'npc-farmer': 'commoner',
};

/** What killing one of these costs you, in gp of bounty. */
const BOUNTY = { commoner: 40, noble: 200, acolyte: 120, guard: 300, thug: 20, spy: 80, veteran: 300 };

/** Which faction takes it personally. */
const ROLE_FACTION = { guard: 'lords-alliance', priest: 'gauntlet', shopkeeper: 'lords-alliance' };

const obj = (v) => (v && typeof v === 'object' ? v : {});
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** The crime ledger, created on first use so pre-existing saves upgrade cleanly. */
export function crimeState(st) {
  if (!st) return null;
  const cs = (st.crime && typeof st.crime === 'object') ? st.crime : (st.crime = {});
  // Backfill rather than only creating whole-cloth. A save written before a key
  // existed has a `crime` object that is truthy but partial, and the old guard
  // handed it straight back — so the next `cs.watchDue[region]` threw on a
  // TypeError. The shape is also declared a second time in state.js; filling in
  // what is missing means the two drifting apart degrades instead of crashing.
  for (const k of ['bounty', 'slain', 'outlaw', 'watchDue']) {
    if (!cs[k] || typeof cs[k] !== 'object') cs[k] = {};
  }
  if (typeof cs.witnessed !== 'number') cs.witnessed = 0;
  if (typeof cs.lastCrimeDay !== 'number') cs.lastCrimeDay = 0;
  return cs;
}

/**
 * Settlements share one watch: the Phandalin town guard does not care what you
 * did three floors down Wave Echo Cave, but they very much care about the inn.
 */
export function regionOf(map) {
  const m = obj(map);
  // `region` is the settlement's ledger key and every interior shares the one
  // the street outside uses, so stabbing the innkeeper in his taproom and
  // stabbing him on his doorstep are the same crime to the same watch.
  return String(m.region || m.parent || m.id || 'wilds');
}

/** Is this a place with a watch that will come looking for you? */
export function isSettled(map) {
  const m = obj(map);
  if (m.safe) return true;
  return m.biome === 'city' || /phandalin|neverwinter|waterdeep|inn|hall|shrine|coster|exchange|provisions|manor|farm|giant/.test(String(m.id || ''));
}

/**
 * May the player attack this NPC? Returns { ok, why }. `why` is shown to the
 * player verbatim, so it is written as a line of prose, not an error code.
 */
export function canAttack(npc, entity) {
  const n = obj(npc);
  const e = obj(entity);
  const tag = n.tag || e.tag || null;
  if (PROTECTED_TAGS.has(String(tag))) {
    return { ok: false, why: tag === 'animal' ? 'It has done nothing to you.' : 'No. Not a child.' };
  }
  if (n.essential || e.essential) return { ok: false, why: 'Killing them now would end the tale early.' };
  if (n.noCombat || e.noCombat) return { ok: false, why: 'They are not someone you can fight.' };
  return { ok: true, why: null };
}

/** The bestiary id that stands in for this townsfolk in a fight. */
export function statBlockFor(npc, entity) {
  const n = obj(npc);
  const e = obj(entity);
  if (n.monsterId) return n.monsterId;
  const sprite = n.sprite || e.sprite || '';
  if (SPRITE_BLOCK[sprite]) return SPRITE_BLOCK[sprite];
  const role = n.role || e.role || 'flavor';
  return ROLE_BLOCK[role] || 'commoner';
}

/** Everyone within `radius` tiles who could see it happen. */
export function witnessesNear(entities, x, y, radius = 7, ignore = null) {
  const out = [];
  // EntityList is iterable and also exposes `.list`; a bare array works too.
  const src = !entities ? null
    : (Array.isArray(entities) ? entities
      : (Array.isArray(entities.list) ? entities.list
        : (typeof entities[Symbol.iterator] === 'function' ? entities : null)));
  if (!src) return out;
  for (const e of src) {
    if (!e || e === ignore || e.removed || e.hidden) continue;
    if (e.kind !== 'npc') continue;
    if (Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) > radius) continue;
    out.push(e);
  }
  return out;
}

/** Guards among a list of witnesses — these join the fight instead of fleeing. */
export function guardsAmong(list) {
  return (list || []).filter((e) => {
    const role = e.role || (e.npc && e.npc.role) || '';
    return role === 'guard' || String(e.sprite || '') === 'npc-guard';
  });
}

/**
 * Record an assault. Called the moment steel is drawn, not when someone dies —
 * the crime is the swing, and the town saw it either way.
 *
 * @returns {{bounty:number, outlaw:boolean, witnesses:number, faction:string|null}}
 */
export function reportAssault(st, { map, npc, entity, witnesses = 0 }) {
  const cs = crimeState(st);
  if (!cs) return { bounty: 0, outlaw: false, witnesses: 0, faction: null };

  const region = regionOf(map);
  const block = statBlockFor(npc, entity);
  const seen = witnesses > 0;
  const fine = Math.round((BOUNTY[block] || 40) * (seen ? 1 : 0.35));

  cs.bounty[region] = (cs.bounty[region] || 0) + fine;
  cs.witnessed += seen ? 1 : 0;
  cs.lastCrimeDay = st.day || 0;
  if (seen && isSettled(map)) cs.outlaw[region] = true;

  const faction = ROLE_FACTION[obj(npc).role] || (obj(npc).faction || null);
  if (faction) addReputation(st, faction, seen ? -4 : -1);
  if (seen) addReputation(st, 'lords-alliance', -2);
  setFlag(st, `crime:${region}`, true);

  return { bounty: cs.bounty[region], outlaw: !!cs.outlaw[region], witnesses, faction };
}

/**
 * Someone actually died. Their dialogue, shop and quests go with them.
 *
 * A body left in a street gets found whether or not anyone watched you do it —
 * that is what makes murdering the only witness a wilderness tactic rather than
 * a town one. Out on the trail, an unwitnessed killing simply never surfaces.
 */
export function reportDeath(st, npcId, { map, witnessed = false } = {}) {
  const cs = crimeState(st);
  if (!cs || !npcId) return { found: false };
  cs.slain[npcId] = true;
  setFlag(st, `slain:${npcId}`, true);

  const region = regionOf(map);
  const found = witnessed || isSettled(map);
  if (!found) return { found: false };

  cs.bounty[region] = (cs.bounty[region] || 0) + 60;
  cs.outlaw[region] = true;
  // The watch is now overdue a visit. The overworld checks this as you walk.
  cs.watchDue[region] = (cs.watchDue[region] || 0) + 1;
  return { found: true };
}

export function isSlain(st, npcId) {
  const cs = st && st.crime;
  return !!(cs && npcId && cs.slain[npcId]);
}

export function bountyIn(st, map) {
  const cs = st && st.crime;
  if (!cs || !cs.bounty) return 0;
  return cs.bounty[regionOf(map)] || 0;
}

export function isOutlawIn(st, map) {
  const cs = st && st.crime;
  if (!cs || !cs.outlaw) return false;
  return !!cs.outlaw[regionOf(map)];
}

/**
 * Does the watch confront the party right now? One patrol per outstanding
 * killing, and never the instant you walk in — they have to find you first.
 */
export function watchOwed(st, map) {
  const cs = st && st.crime;
  if (!cs || !cs.watchDue || !isSettled(map)) return 0;
  return cs.watchDue[regionOf(map)] || 0;
}

export function clearWatch(st, map, n = 1) {
  const cs = crimeState(st);
  if (!cs) return;
  const region = regionOf(map);
  cs.watchDue[region] = Math.max(0, (cs.watchDue[region] || 0) - n);
}

/** The patrol the watch sends: bigger the longer your list is. */
export function watchPatrol(st, map, partyLevel = 1) {
  const bounty = bountyIn(st, map);
  const n = clamp(2 + Math.floor(bounty / 150), 2, 5);
  const out = [{ id: 'guard', count: n }];
  if (bounty >= 300) out.push({ id: 'bandit-captain', count: 1 });
  if (bounty >= 700 || partyLevel >= 7) out.push({ id: 'veteran', count: 1 });
  return out;
}

/** What it costs to have the charges dropped, and whether anyone will take it. */
export function fineFor(st, map) {
  const b = bountyIn(st, map);
  return b > 0 ? Math.max(10, Math.round(b)) : 0;
}

/** Pay up: the slate is wiped, the reputation hit is not. */
export function payFine(st, map) {
  const cs = crimeState(st);
  if (!cs) return 0;
  const region = regionOf(map);
  const owed = cs.bounty[region] || 0;
  cs.bounty[region] = 0;
  cs.outlaw[region] = false;
  cs.watchDue[region] = 0;
  return owed;
}

/** Shops mark up for a known killer, and past a point simply refuse. */
export function priceMultiplierIn(st, map) {
  const b = bountyIn(st, map);
  if (b <= 0) return 1;
  return 1 + Math.min(0.6, b / 500);
}

export function shopsRefuse(st, map) {
  return isOutlawIn(st, map) && bountyIn(st, map) >= 250;
}
