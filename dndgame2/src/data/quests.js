// data/quests.js — every charge, errand, bounty and contract on the Sword Coast:
// the Lost Mine of Phandelver spine, the townsfolk's small troubles, the road out
// to Waterdeep, and the endless faction contract boards that keep going forever.
//
// Imports only other data modules and core/ helpers (HARD RULE 4). The catalogues
// are deep frozen (HARD RULE 8); `generateQuest` builds fresh, unfrozen objects so
// state.js can carry a procedural quest's definition inside the save file.
//
// Quest shape (SPEC.md §3):
//   { id, title, giver, type, minLevel, desc, steps:[{kind,target,count,map}],
//     rewards:{xp,gold,items,rep}, next, repeatable, faction }
//
// Step kinds the engine understands:
//   'kill'    target = monster id      (data/monsters.js)
//   'collect' target = item id         (data/items.js)
//   'reach'   target = map id
//   'talk'    target = npc id          (data/npcs.js)
//   'flag'    target = flag name       (state.js flags)
//   'escort'  target = npc id
//   'clear'   target = map id
//   'deliver' target = npc id
// Every step also carries a plain-English `text`, so ui/menus.js never has to
// resolve an id it may not have a map or catalogue entry for yet.
//
// Setting note: every place, person and creature named here is published
// Forgotten Realms canon or is built from the naming tables in docs/SETTING.md §5.

import { rng, makeRNG } from '../core/rng.js';
import { NPCS } from './npcs.js';
import { resolveItem, itemName } from './items.js';
import { MONSTERS, MONSTER_GROUPS, monstersByBiome, monstersByCR } from './monsters.js';

// ---------------------------------------------------------------------------
// deepFreeze — recursive Object.freeze for the exported catalogues.
// ---------------------------------------------------------------------------
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
function titleCase(s) {
  return String(s || '').replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// ===========================================================================
// 1. REWARD SCALING
//
// A quest's purse is a function of the level it is written for. The tier weight
// separates "the innkeeper's rats" from "the Black Spider in Wave Echo Cave".
// ===========================================================================

const TIER_W = Object.freeze({
  trivial: 0.3, minor: 0.5, small: 0.7, standard: 1,
  major: 1.5, chain: 2, capstone: 3,
});

/** Experience for a quest written at `level`, at a given tier weight. */
function xpFor(level, w) {
  const lv = clamp(Number(level) || 1, 1, 30);
  return Math.max(10, Math.round((60 * lv + 20 * lv * lv) * w / 10) * 10);
}

/** Purse in gold pieces. Frontier money — Phandalin is not Waterdeep. */
function goldFor(level, w) {
  const lv = clamp(Number(level) || 1, 1, 30);
  return Math.max(5, Math.round((12 * lv + 6 * lv * lv) * w / 5) * 5);
}

/**
 * Normalise a reward item list. Unknown ids are silently dropped rather than
 * handed to Party.addItem, so a half-written catalogue degrades instead of
 * throwing (HARD RULE: be defensive).
 */
function itemList(items) {
  const out = [];
  for (const it of items || []) {
    const spec = typeof it === 'string' ? { id: it, qty: 1 } : { id: it && (it.id || it.item), qty: (it && it.qty) || 1 };
    if (!spec.id) continue;
    let ok = false;
    try { ok = !!resolveItem(spec.id); } catch (e) { ok = false; }
    if (!ok) continue;
    out.push({ id: spec.id, qty: Math.max(1, spec.qty | 0) });
  }
  return out;
}

/** `{ harpers: 3, zhentarim: -2 }` -> `[{id:'harpers',amount:3}, ...]`. */
function repList(rep) {
  const out = [];
  if (!rep) return out;
  if (Array.isArray(rep)) {
    for (const r of rep) {
      if (!r) continue;
      if (typeof r === 'string') { out.push({ id: r, amount: 1 }); continue; }
      const id = r.id || r.faction;
      if (id) out.push({ id, amount: r.amount != null ? r.amount : (r.value != null ? r.value : 1) });
    }
    return out;
  }
  for (const k of Object.keys(rep)) out.push({ id: k, amount: Number(rep[k]) || 0 });
  return out;
}

function rewardsFor(level, tier, items, rep) {
  const w = TIER_W[tier] != null ? TIER_W[tier] : 1;
  return { xp: xpFor(level, w), gold: goldFor(level, w), items: itemList(items), rep: repList(rep) };
}

// ===========================================================================
// 2. BUILDERS
// ===========================================================================

const kill = (target, count, text, map) => ({ kind: 'kill', target, count: count || 1, text: text || '', map: map || null });
const collect = (target, count, text, map) => ({ kind: 'collect', target, count: count || 1, text: text || '', map: map || null });
const reach = (map, text) => ({ kind: 'reach', target: map, count: 1, text: text || '', map });
const talk = (target, text, map) => ({ kind: 'talk', target, count: 1, text: text || '', map: map || null });
const flagStep = (target, text) => ({ kind: 'flag', target, count: 1, text: text || '', map: null });
const clear = (map, text) => ({ kind: 'clear', target: map, count: 1, text: text || '', map });
const escort = (target, text, map) => ({ kind: 'escort', target, count: 1, text: text || '', map: map || null });
const deliver = (target, text, map) => ({ kind: 'deliver', target, count: 1, text: text || '', map: map || null });

function normStep(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    kind: s.kind || 'flag',
    target: s.target != null ? s.target : null,
    count: Math.max(1, (s.count | 0) || 1),
    map: s.map || null,
    text: s.text || '',
    optional: !!s.optional,
  };
}

/** Build one quest entry. Every optional field is present, so no consumer needs `?.`. */
function Q(id, title, o = {}) {
  const minLevel = clamp(o.minLevel || 1, 1, 30);
  return {
    id,
    title,
    giver: o.giver || null,
    type: o.type || 'fetch',
    minLevel,
    desc: o.desc || '',
    summary: o.summary || '',
    steps: (o.steps || []).map(normStep).filter(Boolean),
    rewards: rewardsFor(minLevel, o.tier || 'standard', o.items, o.rep),
    next: o.next || null,
    unlocks: Object.freeze((o.unlocks || []).slice()),
    repeatable: !!o.repeatable,
    faction: o.faction || null,
    // --- extras the engine may use; harmless to ignore -----------------------
    chain: o.chain || null,
    after: Object.freeze((o.after || []).slice()),
    requires: Object.freeze((o.requires || []).slice()),
    forbid: Object.freeze((o.forbid || []).slice()),
    sets: Object.freeze((o.sets || []).slice()),
    map: o.map || null,
    turnIn: o.turnIn || o.giver || null,
    generated: false,
  };
}

export { rewardsFor };

// ===========================================================================
// 3. THE QUESTS
//
// 3a — THE MAIN SPINE. The Lost Mine of Phandelver, then the road out of
// Phandalin to the Yawning Portal. It threads together through `next`, while
// `unlocks` opens the parallel wilderness charges at Old Owl Well, Wyvern Tor,
// Thundertree and Agatha's grove.
// ===========================================================================

const MAIN_CHAIN = [

  Q('deliver-barthens-supplies', "Barthen's Wagon", {
    giver: 'elmar-barthen', type: 'deliver', minLevel: 1, tier: 'standard',
    chain: 'lost-mine-of-phandelver', map: 'triboar-trail',
    desc: 'Gundren Rockseeker paid Barthen up front for a wagonload of picks, rope and salt pork, then rode east ahead of it with a Waterdhavian swordsman. The wagon never came in. Barthen would like his oxen back at the least, and he would like somebody to walk the Triboar Trail and find out why.',
    summary: "Recover Gundren Rockseeker's supply wagon from the Triboar Trail.",
    steps: [
      reach('triboar-trail', 'Follow the Triboar Trail east out of Phandalin'),
      kill('goblin', 4, 'Break the Cragmaw ambush at the dead horses', 'triboar-trail'),
      deliver('elmar-barthen', "Bring the provisions in to Barthen's", 'barthens-provisions'),
    ],
    items: [{ id: 'rations', qty: 4 }, 'potion-healing'],
    rep: { 'lords-alliance': 1 },
    next: 'rockseeker-brothers',
    sets: ['cragmaw-ambush-survived'],
  }),

  Q('rockseeker-brothers', 'The Rockseeker Brothers', {
    giver: 'gundren-rockseeker', type: 'clear', minLevel: 2, tier: 'chain',
    chain: 'lost-mine-of-phandelver', map: 'cragmaw-hideout',
    after: ['deliver-barthens-supplies'],
    desc: 'The goblins on the trail were Cragmaws, and they were paid to be there. Their tracks run north-west up a stream bed to a cave mouth hung with briar. Gundren is not inside it. Klarg the bugbear is, and so is the greying Waterdhavian who rode east with him, chained to a post and still breathing.',
    summary: 'Storm the Cragmaw Hideout, kill Klarg, and cut Sildar Hallwinter loose.',
    steps: [
      reach('cragmaw-hideout', 'Find the Cragmaw Hideout up the stream bed'),
      kill('klarg', 1, 'Kill Klarg the bugbear in his den', 'cragmaw-hideout'),
      talk('sildar-hallwinter', 'Free Sildar Hallwinter and hear him out', 'cragmaw-hideout'),
    ],
    items: [{ id: 'potion-healing', qty: 2 }, 'goblin-totem'],
    rep: { 'lords-alliance': 3 },
    next: 'sildars-commission',
    sets: ['sildar-rescued', 'droop-freed'],
  }),

  Q('sildars-commission', "Sildar's Commission", {
    giver: 'sildar-hallwinter', type: 'clear', minLevel: 3, tier: 'chain',
    chain: 'lost-mine-of-phandelver', map: 'phandalin',
    after: ['rockseeker-brothers'], requires: ['sildar-rescued'],
    desc: "The Lords' Alliance sent Sildar east with two charges: see order restored in Phandalin, and find the wizard Iarno Albrek, who went ahead of him and has not written since. Harbin Wester has locked his shutters. The Redbrands have the streets. Sildar has three cracked ribs and a commission he intends to keep.",
    summary: "Take Sildar's charge and put the Redbrands off the streets of Phandalin.",
    steps: [
      talk('harbin-wester', 'Ask the townmaster what he means to do about the Redbrands', 'townmasters-hall'),
      kill('redbrand-ruffian', 4, 'Put four Redbrands down in the streets of Phandalin', 'phandalin'),
      talk('sildar-hallwinter', 'Report back to Sildar at the Stonehill', 'stonehill-inn'),
    ],
    items: [{ id: 'potion-healing', qty: 2 }, 'studded-leather'],
    rep: { 'lords-alliance': 3 },
    next: 'redbrand-menace',
  }),

  Q('redbrand-menace', 'The Redbrand Menace', {
    giver: 'redbrand-bruiser', type: 'clear', minLevel: 3, tier: 'chain',
    chain: 'lost-mine-of-phandelver', map: 'phandalin-manor',
    after: ['sildars-commission'],
    desc: 'They wear scarlet cloaks, they drink at the Sleeping Giant, and they hanged Nars Dendrar from his own gatepost for objecting to them. Their nest is the cellar of Tresendar Manor on the eastern rise, and something down there is not a man at all, and watches out of the rubble with one great lidless eye.',
    summary: 'Clear the Redbrands out of the cellars beneath Tresendar Manor.',
    steps: [
      reach('phandalin-manor', 'Get down into the Tresendar Manor cellars'),
      kill('nothic', 1, 'Deal with the nothic in the flooded crevasse', 'phandalin-manor'),
      clear('phandalin-manor', 'Break the Redbrands in their own hideout'),
    ],
    items: [{ id: 'redbrand-cloak', qty: 2 }, 'potion-greater-healing'],
    rep: { 'lords-alliance': 4 },
    next: 'iarno-albrek-missing',
    sets: ['redbrands-broken'],
  }),

  Q('iarno-albrek-missing', 'The Missing Wizard', {
    giver: 'sildar-hallwinter', type: 'fetch', minLevel: 4, tier: 'chain',
    chain: 'lost-mine-of-phandelver', map: 'phandalin-manor',
    after: ['redbrand-menace'],
    desc: 'Sildar wants Iarno Albrek found. There is correspondence in the manor cellars in a careful Waterdhavian hand, and the man the Redbrands call Glasstaff signs every order in it. Sildar reads the letters twice, and then puts them down very quietly.',
    summary: "Find out what became of the Alliance's wizard in Tresendar Manor.",
    steps: [
      reach('phandalin-manor', "Search the wizard's workroom in the manor cellars"),
      flagStep('glasstaff-identified', 'Read the Redbrand correspondence and put a name to Glasstaff'),
      talk('sildar-hallwinter', "Put the letters into Sildar's hands", 'stonehill-inn'),
    ],
    items: ['scroll-identify', 'potion-greater-healing'],
    rep: { 'lords-alliance': 3, harpers: 2 },
    next: 'glasstaff',
    sets: ['glasstaff-identified'],
  }),

  Q('glasstaff', 'Glasstaff', {
    giver: 'iarno-albrek', type: 'boss', minLevel: 4, tier: 'chain',
    chain: 'lost-mine-of-phandelver', map: 'phandalin-manor',
    after: ['iarno-albrek-missing'],
    desc: 'Iarno Albrek was sent to establish order in Phandalin. He established the Redbrands instead, took a glass staff and a title to go with it, and sold the town to a drow who calls himself the Black Spider. He has an escape tunnel and a great deal to say. Neither will help him.',
    summary: 'Corner Iarno "Glasstaff" Albrek in his workroom and finish the Redbrands.',
    steps: [
      reach('phandalin-manor', "Take the wizard's door in the Tresendar cellars"),
      kill('glasstaff', 1, 'Kill or take Iarno "Glasstaff" Albrek', 'phandalin-manor'),
    ],
    items: ['staff-of-defense', { id: 'potion-greater-healing', qty: 2 }],
    rep: { 'lords-alliance': 5, harpers: 3 },
    next: 'old-owl-well',
    unlocks: ['wyvern-tor', 'thundertree-ruins', 'agathas-answer', 'glasstaffs-head'],
    sets: ['glasstaff-defeated', 'black-spider-named'],
  }),

  Q('old-owl-well', 'Old Owl Well', {
    giver: 'daran-edermath', type: 'clear', minLevel: 5, tier: 'chain',
    chain: 'lost-mine-of-phandelver', map: 'old-owl-well', faction: 'gauntlet',
    after: ['glasstaff'],
    desc: 'Old Owl Well is a Netherese ruin north-east of town: a broken tower over a spring that has been dry since before Phandalin had a name. Daran Edermath has had reports of undead walking its stones in daylight, which is not how undead behave, and of a man in red Thayan robes directing them, which is worse.',
    summary: 'Find out who is raising the dead at the Netherese ruin of Old Owl Well.',
    steps: [
      reach('old-owl-well', 'Ride north-east to the ruin of Old Owl Well'),
      kill('skeleton', 6, 'Put down the skeletons picketed among the stones', 'old-owl-well'),
      talk('hamun-kost', 'Treat with the Thayan, Hamun Kost — or do not', 'old-owl-well'),
    ],
    items: ['gem-onyx', 'potion-greater-healing'],
    rep: { gauntlet: 4, 'lords-alliance': 1 },
    next: 'nundros-rescue',
    unlocks: ['kosts-bargain'],
    sets: ['old-owl-well-found'],
  }),

  Q('nundros-rescue', 'Nundro in the Dark', {
    giver: 'nundro-rockseeker', type: 'escort', minLevel: 6, tier: 'chain',
    chain: 'lost-mine-of-phandelver', map: 'wave-echo-cave-entrance',
    after: ['old-owl-well'], requires: ['wave-echo-entered'],
    desc: "The youngest Rockseeker is alive: half-starved, chained to a pit prop in the dark of the old Phandelver workings, and still arguing about ore quality. His brother Tharden is not. Get Nundro up the shaft and into daylight before the Black Spider's bugbears notice the chain is empty.",
    summary: 'Get Nundro Rockseeker out of the Wave Echo workings alive.',
    steps: [
      reach('wave-echo-cave-entrance', 'Descend into the old Phandelver workings'),
      kill('bugbear', 3, "Kill the Black Spider's bugbear gaolers", 'wave-echo-cave-entrance'),
      escort('nundro-rockseeker', 'Walk Nundro Rockseeker up the shaft to daylight', 'wave-echo-cave-entrance'),
    ],
    items: [{ id: 'silver-ore-wave-echo', qty: 2 }, 'potion-greater-healing'],
    rep: { 'lords-alliance': 4 },
    next: 'wave-echo-cave',
    sets: ['nundro-rescued'],
  }),

  Q('wave-echo-cave', 'Wave Echo Cave', {
    giver: 'gundren-rockseeker', type: 'boss', minLevel: 7, tier: 'capstone',
    chain: 'lost-mine-of-phandelver', map: 'wave-echo-cave',
    after: ['nundros-rescue'],
    desc: 'The Lost Mine of Phandelver, and at the heart of it the Forge of Spells, where five hundred years ago dwarves and gnomes and the wizards of old Phandalin made weapons together until something came up out of the deep dark and ended all of it. Nezznar the Black Spider is standing in the forge chamber now. He wants the magic. He will not be leaving with it.',
    summary: 'Take the Forge of Spells back from Nezznar the Black Spider.',
    steps: [
      reach('wave-echo-cave', 'Reach the Forge of Spells in Wave Echo Cave'),
      kill('nezznar', 1, 'Kill Nezznar the Black Spider', 'wave-echo-cave'),
      clear('wave-echo-cave', 'Clear the last of the drow and their creatures out of the mine'),
    ],
    items: ['lightbringer', 'gem-emerald', { id: 'potion-greater-healing', qty: 2 }],
    rep: { 'lords-alliance': 8, harpers: 4, gauntlet: 4 },
    next: 'leilon-dispatch',
    sets: ['wave-echo-won', 'lost-mine-complete'],
  }),

  Q('leilon-dispatch', 'The Leilon Dispatch', {
    giver: 'silifrey-windrivver', type: 'deliver', minLevel: 8, tier: 'chain',
    chain: 'the-road-to-waterdeep', map: 'leilon', faction: 'lords-alliance',
    after: ['wave-echo-cave'],
    desc: 'Word of Phandelver has reached the High Road, and the Alliance post rider wants it carried on to Leilon before the Waterdhavian caravans set out. The stretch below the Mere of Dead Men is bad ground and getting worse: the lizardfolk have come up out of the salt marsh onto the road itself.',
    summary: 'Carry the Alliance dispatch down the High Road to Leilon.',
    steps: [
      reach('high-road', 'Turn west onto the High Road'),
      kill('lizardfolk', 4, 'Drive the Mere of Dead Men lizardfolk off the road', 'high-road'),
      talk('silifrey-windrivver', "Put the dispatch into Leilon's hands", 'leilon'),
    ],
    items: ['boots-of-striding-and-springing'],
    rep: { 'lords-alliance': 5 },
    next: 'the-alliance-road',
  }),

  Q('the-alliance-road', 'The Alliance Road', {
    giver: 'sildar-hallwinter', type: 'clear', minLevel: 9, tier: 'chain',
    chain: 'the-road-to-waterdeep', map: 'high-road', faction: 'lords-alliance',
    after: ['leilon-dispatch'],
    desc: 'Sildar has his answer out of Waterdeep, and the answer is a road. If Phandalin is to be worth holding, the High Road between Leilon and Neverwinter has to be walkable by a wagon with one guard on it. At present it is walkable by orcs out of the Sword Mountains and by very little else.',
    summary: 'Open the High Road between Leilon and Neverwinter.',
    steps: [
      clear('high-road', 'Break the raiding camps along the High Road'),
      kill('orc', 8, 'Kill the Many-Arrows raiders working the road', 'high-road'),
      kill('orog', 1, 'Kill the orog driving them', 'high-road'),
    ],
    items: ['weapon-of-warning', 'potion-superior-healing'],
    rep: { 'lords-alliance': 6, gauntlet: 2 },
    next: 'protectors-enclave-patrol',
  }),

  Q('protectors-enclave-patrol', "The Protector's Enclave", {
    giver: 'general-sabine', type: 'clear', minLevel: 10, tier: 'chain',
    chain: 'the-road-to-waterdeep', map: 'neverwinter', faction: 'lords-alliance',
    after: ['the-alliance-road'],
    desc: "Neverwinter is half a city and half a graveyard, and General Sabine has to hold both with the same garrison. The ash off Mount Hotenow still walks in the ruined quarters, and something wearing a Wall-guard's face has been signing passes at the gate that Sabine never issued.",
    summary: "Walk General Sabine's patrol through the ruins of Neverwinter.",
    steps: [
      reach('neverwinter', "Report to General Sabine in the Protector's Enclave"),
      kill('ash-zombie', 6, 'Clear the ash-walkers out of the ruined quarter', 'neverwinter'),
      kill('doppelganger', 1, "Unmask the thing wearing a guardsman's face", 'neverwinter'),
    ],
    items: ['cloak-of-protection'],
    rep: { 'lords-alliance': 7, harpers: 2 },
    next: 'the-yawning-portal',
  }),

  Q('the-yawning-portal', 'The Yawning Portal', {
    giver: 'durnan', type: 'clear', minLevel: 11, tier: 'chain',
    chain: 'the-road-to-waterdeep', map: 'waterdeep',
    after: ['protectors-enclave-patrol'],
    desc: 'There is a tavern on the Street of the Silks in Waterdeep with a well in the middle of the common room, and the well goes down into Undermountain. Durnan pulls ale beside it and charges a gold piece to be lowered. He does not lower people he has not measured, and he measures them by sending them down one floor and seeing what comes back.',
    summary: "Pay Durnan's price and prove you can come back up his well.",
    steps: [
      reach('waterdeep', 'Come south to Waterdeep and find the Yawning Portal'),
      talk('durnan', 'Buy the rope from Durnan', 'waterdeep'),
      kill('flameskull', 1, "Burn out the flameskull on Undermountain's first level", 'undermountain'),
    ],
    items: ['potion-supreme-healing', 'driftglobe'],
    rep: { harpers: 3, 'lords-alliance': 3 },
    next: 'descent-into-undermountain',
    sets: ['yawning-portal-open'],
  }),

  Q('descent-into-undermountain', 'Descent into Undermountain', {
    giver: 'durnan', type: 'boss', minLevel: 12, tier: 'capstone',
    chain: 'the-road-to-waterdeep', map: 'undermountain',
    after: ['the-yawning-portal'], requires: ['yawning-portal-open'],
    desc: 'Halaster Blackcloak dug his halls beneath Mount Waterdeep before the city above it had a name, and he is still down there, still digging, still moving the doors. There is no bottom to Undermountain. There is only how far down you are willing to go, and whether the stone begins to use your name.',
    summary: 'Go down the well for good. Undermountain has no bottom — find out how deep you can go.',
    steps: [
      reach('undermountain', 'Take the rope down into Undermountain'),
      kill('wraith', 2, 'Put down the wraiths haunting the Dungeon Level', 'undermountain'),
      flagStep('undermountain-unlocked', 'Find the stair to the second level, and hear Halaster laugh'),
    ],
    items: ['rope-of-climbing', 'potion-supreme-healing', 'gem-diamond'],
    rep: { harpers: 4, 'lords-alliance': 4 },
    next: null,
    sets: ['undermountain-unlocked', 'endless-dungeon-open'],
  }),
];

// ---------------------------------------------------------------------------
// 3b — PHANDALIN: the Stonehill Inn, Barthen's Provisions, the Lionshield
// Coster, the Shrine of Luck, the Miner's Exchange and the Townmaster's Hall.
// ---------------------------------------------------------------------------

const PHANDALIN_QUESTS = [

  // --- Stonehill Inn -------------------------------------------------------

  Q('stonehill-cellar-rats', "Something in Toblen's Cellar", {
    giver: 'toblen-stonehill', type: 'clear', minLevel: 1, tier: 'minor', map: 'stonehill-inn',
    desc: "Toblen has not been down to his own cellar in four days. Something got in through the drain when the spring floods came, and now it squeals behind the ale casks and Trilena will not send Pip down for the salt pork.",
    summary: "Clear the vermin out of the Stonehill Inn's cellar.",
    steps: [
      kill('giant-rat', 4, 'Kill the giant rats behind the ale casks', 'stonehill-inn'),
      kill('swarm-of-rats', 1, 'Break the swarm nesting in the drain', 'stonehill-inn'),
      talk('toblen-stonehill', 'Tell Toblen his cellar is his own again', 'stonehill-inn'),
    ],
    items: ['potion-healing', { id: 'rations', qty: 3 }],
  }),

  Q('toblens-brother', "Toblen's Brother", {
    giver: 'toblen-stonehill', type: 'deliver', minLevel: 2, tier: 'small', map: 'triboar-trail',
    desc: "Toblen came west from Triboar in the boom years and left a brother behind him keeping the family's mill. He has written eleven letters and had none back, and he has begun to say 'if he is alive' the way a man says a thing he has decided is true.",
    summary: "Get Toblen's letter east to Triboar with a caravan that is actually going.",
    steps: [
      reach('triboar-trail', 'Take the letter out onto the Triboar Trail'),
      talk('evendur-greycastle', 'Find a caravan master bound east for Triboar', 'triboar-trail'),
      talk('toblen-stonehill', 'Tell Toblen the letter is on the road', 'stonehill-inn'),
    ],
    items: ['neverwinter-ale', { id: 'rations', qty: 2 }],
  }),

  Q('pips-lost-cat', "Pip's Lost Cat", {
    giver: 'toblen-stonehill', type: 'fetch', minLevel: 1, tier: 'trivial', map: 'stonehill-inn',
    desc: "Coppertail is the Stonehill's mouser, a ginger tom who owns the hearthstone and permits the Stonehills to live beside it. Pip loses him about once a tenday and is inconsolable about it every single time. Toblen will pay in ale and gratitude, in that order.",
    summary: 'Find Coppertail the inn cat before Pip cries himself sick.',
    steps: [
      talk('stonehill-cat', 'Find Coppertail wherever he has got to', 'stonehill-inn'),
      talk('pip-stonehill', 'Put the cat back in Pip Stonehill\'s arms', 'stonehill-inn'),
    ],
    items: ['trail-bread', 'neverwinter-ale'],
  }),

  Q('pips-dare', "Pip's Dare", {
    giver: 'pip-stonehill', type: 'fetch', minLevel: 2, tier: 'minor', map: 'phandalin',
    desc: 'Pip Stonehill is eight winters old and has decided that the Redbrands are the most exciting thing ever to happen to Phandalin. He dares you to bring him a scarlet cloak off one of them. He has not thought through what it would mean if you did.',
    summary: 'Bring Pip a Redbrand cloak, and a word about what wearing one costs.',
    steps: [
      collect('redbrand-cloak', 1, 'Take a scarlet cloak off a Redbrand', 'phandalin'),
      talk('pip-stonehill', 'Give Pip his trophy, and the truth with it', 'stonehill-inn'),
    ],
    items: ['gaming-dice'],
  }),

  Q('trilenas-market-list', "Trilena's Market List", {
    giver: 'trilena-stonehill', type: 'fetch', minLevel: 1, tier: 'trivial', map: 'phandalin',
    desc: 'Trilena runs the Stonehill kitchen, the ledger and — everyone agrees — Toblen. Her list is short, her patience is shorter, and she has a taproom of miners to feed before dusk.',
    summary: "Fill Trilena Stonehill's market list before the supper bell.",
    steps: [
      collect('rations', 4, 'Buy four days of salt provisions in the town'),
      collect('goodberry-preserve', 1, 'Fetch a crock of Alderleaf preserves from the farm', 'alderleaf-farm'),
      deliver('trilena-stonehill', 'Carry it all in to the Stonehill kitchen', 'stonehill-inn'),
    ],
    items: ['luirens-best'],
    repeatable: true,
  }),

  Q('a-song-for-phandalin', 'A Song for Phandalin', {
    giver: 'milo-brushgather', type: 'fetch', minLevel: 3, tier: 'small', map: 'phandalin',
    desc: 'Milo Brushgather has ninety-one songs and not one of them is about Phandalin, which he considers an oversight and the town considers a mercy. He wants a verse worth singing, and he is not going to get one until somebody does something about the scarlet cloaks.',
    summary: 'Give Milo Brushgather something worth putting to a lute.',
    steps: [
      flagStep('redbrands-broken', 'Give the town a last verse worth singing'),
      talk('milo-brushgather', 'Tell Milo how it went, in order, with names', 'stonehill-inn'),
    ],
    items: ['zzar', 'potion-healing'],
  }),

  // --- Barthen's Provisions ------------------------------------------------

  Q('barthens-ledger', "Barthen's Ledger", {
    giver: 'elmar-barthen', type: 'fetch', minLevel: 2, tier: 'small', map: 'phandalin',
    desc: "Barthen extends credit to precisely nobody, which is not the same as being owed nothing. Three prospectors took gear on a tenday's word and the tenday was in Ches. He does not want them dunned. He wants to know which of them are still alive.",
    summary: "Find the three prospectors in Barthen's ledger and see who still breathes.",
    steps: [
      talk('freda', 'Find Freda at her claim in the foothills', 'phandalin'),
      talk('mosk', 'Find Mosk in the shallow diggings', 'phandalin'),
      talk('veit-ungart', 'Find Veit Ungart at the Sleeping Giant, where he always is', 'sleeping-giant'),
      deliver('elmar-barthen', 'Report the tally back to Barthen', 'barthens-provisions'),
    ],
    items: ['rope-hempen', { id: 'torch', qty: 5 }],
  }),

  Q('the-rockseeker-debt', 'The Rockseeker Debt', {
    giver: 'elmar-barthen', type: 'deliver', minLevel: 4, tier: 'standard', map: 'phandalin',
    desc: "Gundren Rockseeker owes for a wagon, two oxen and everything that was on it. Barthen has decided he would rather be paid in Phandalin ore than in Rockseeker promises, and he is prepared to be reasonable about which ore.",
    summary: "Settle Gundren's account at Barthen's in ore rather than coin.",
    steps: [
      collect('ore-sample-phandalin', 3, 'Bring three good ore samples out of the diggings'),
      deliver('elmar-barthen', "Weigh them out on Barthen's counter", 'barthens-provisions'),
    ],
    items: ['healers-kit', 'potion-healing'],
    rep: { 'lords-alliance': 1 },
  }),

  Q('anders-first-inventory', "Ander's First Inventory", {
    giver: 'ander', type: 'fetch', minLevel: 1, tier: 'trivial', map: 'barthens-provisions',
    desc: 'Ander is nineteen, gangly, Illuskan, and can find any crate in the storeroom and no thought whatever in his own head. Barthen has set him his first stock count. He has already lost it twice and would rather die than say so to Thistle.',
    summary: "Quietly make Ander's stock count come out right.",
    steps: [
      collect('torch', 5, 'Turn up five torches that are not on the shelf'),
      collect('rope-hempen', 1, 'Find the coil of hempen rope Ander swears he counted'),
      deliver('ander', 'Hand Ander a count that will survive Thistle', 'barthens-provisions'),
    ],
    items: ['tinderbox', 'trail-bread'],
  }),

  Q('thistles-cartography', "Thistle's Cartography", {
    giver: 'thistle', type: 'fetch', minLevel: 3, tier: 'small', map: 'triboar-trail',
    desc: "Thistle keeps Barthen's map case, and every chart in it is a lie copied off an older lie. She is drawing a true one. She cannot walk it herself, so she will pay for landmarks seen with somebody's own eyes and described honestly.",
    summary: 'Walk the landmarks Thistle needs for an honest map of the Trail.',
    steps: [
      reach('triboar-trail', 'Pace the Triboar Trail east of the Phandalin turning'),
      reach('neverwinter-wood', 'Mark the eaves of Neverwinter Wood'),
      reach('conyberry-ruins', 'Find what is left of Conyberry and note the road'),
      deliver('thistle', 'Bring the notes back to the map case', 'barthens-provisions'),
    ],
    items: ['map', 'cartographers-tools'],
  }),

  // --- Lionshield Coster ---------------------------------------------------

  Q('lionshield-stolen-goods', 'Lionshield Stolen Goods', {
    giver: 'linene-graywind', type: 'fetch', minLevel: 2, tier: 'standard', map: 'cragmaw-hideout',
    desc: "A Coster wagon out of Yartar was taken on the Triboar Trail a tenday since, driver and all. Every crate on it carries the blue lion stamp, which means every crate on it is Linene's, which means she is going to be extremely direct about wanting them back.",
    summary: 'Recover the blue-lion crates the Cragmaws took off the Coster wagon.',
    steps: [
      collect('coster-crate', 3, 'Recover three Lionshield crates from the goblins', 'cragmaw-hideout'),
      deliver('linene-graywind', 'Carry them in to Linene Graywind', 'lionshield-coster'),
    ],
    items: ['shortsword', 'potion-healing'],
    rep: { 'lords-alliance': 2 },
  }),

  Q('coster-caravan-escort', 'Coster Caravan Escort', {
    giver: 'linene-graywind', type: 'escort', minLevel: 4, tier: 'standard',
    map: 'triboar-trail', faction: 'lords-alliance',
    desc: 'The Coster has to move steel between Phandalin and the High Road, and Taman Helder has lost two wagons in a season doing it. Linene will hire swords by the trip. She will not hire them twice if a wagon goes missing.',
    summary: 'Walk a Lionshield wagon down the Trail and bring the wagon back too.',
    steps: [
      escort('taman-helder', 'Take the wagon out with Taman Helder driving', 'triboar-trail'),
      reach('triboar-trail', 'See the wagon as far as the High Road turning'),
      kill('bandit', 4, 'Beat off the road-thieves working that stretch', 'triboar-trail'),
    ],
    items: ['studded-leather', 'potion-healing'],
    rep: { 'lords-alliance': 2 },
    repeatable: true,
  }),

  Q('blue-lion-brand', 'The Blue Lion Brand', {
    giver: 'linene-graywind', type: 'kill', minLevel: 5, tier: 'standard', map: 'triboar-trail',
    desc: 'Somebody on the Trail is selling mail stamped with the blue lion of Yartar that never came out of a Lionshield forge. Bad steel under a good mark will get a caravan guard killed, and then it will get the Coster blamed. Linene wants the fence, not the goods.',
    summary: 'Find whoever is stamping the blue lion on counterfeit Coster steel.',
    steps: [
      reach('triboar-trail', 'Follow the counterfeit steel out onto the Trail'),
      kill('bandit-captain', 1, 'Take the fence running the false-stamp trade', 'triboar-trail'),
      collect('coster-crate', 2, 'Recover the crates carrying the forged brand', 'triboar-trail'),
      deliver('linene-graywind', 'Lay it all out on the Coster counter', 'lionshield-coster'),
    ],
    items: ['chain-shirt', 'potion-greater-healing'],
    rep: { 'lords-alliance': 3 },
  }),

  // --- Shrine of Luck ------------------------------------------------------

  Q('agathas-answer', "Agatha's Answer", {
    giver: 'sister-garaele', type: 'fetch', minLevel: 4, tier: 'major',
    map: 'conyberry-ruins', faction: 'harpers',
    desc: 'There is a banshee in a grove outside ruined Conyberry who was an elf of surpassing beauty once, and who still is vain about it. Sister Garaele will send a silver comb and a courteous question about the spellbook of Bowgentle. Agatha answers one question truthfully, if she is courted properly — and not at all if she is not.',
    summary: 'Court the banshee Agatha with a gift, and bring back the one answer she gives.',
    steps: [
      reach('conyberry-ruins', "Find Agatha's grove beyond the ruins of Conyberry"),
      talk('agatha', 'Offer the silver comb and ask the Harpers\' question', 'conyberry-ruins'),
      talk('sister-garaele', 'Carry the answer back to the Shrine of Luck', 'shrine-of-luck'),
    ],
    items: ['potion-greater-healing', 'scroll-identify', 'gem-moonstone'],
    rep: { harpers: 5 },
    sets: ['agatha-courted'],
  }),

  Q('shrine-offerings', 'Offerings for the Lady', {
    giver: 'sister-garaele', type: 'fetch', minLevel: 1, tier: 'minor',
    map: 'shrine-of-luck', faction: 'harpers',
    desc: "Tymora's coin-bowl in Phandalin is a wooden dish with four coppers in it, and Sister Garaele will not shame the town by saying so out loud. Luck, she says, is spent and not saved — but a shrine still needs stone polish and lamp oil.",
    summary: "Restock the Shrine of Luck's offering bowl.",
    steps: [
      collect('gem-malachite', 2, 'Find two green stones fit to lay in the bowl'),
      collect('oil-flask', 1, 'Bring a flask of lamp oil for the shrine lamps'),
      deliver('sister-garaele', 'Lay the offering before Tymora', 'shrine-of-luck'),
    ],
    items: ['potion-healing'],
    rep: { harpers: 1 },
    repeatable: true,
  }),

  Q('harper-cipher', 'The Harper Cipher', {
    giver: 'sister-garaele', type: 'kill', minLevel: 3, tier: 'standard',
    map: 'triboar-trail', faction: 'harpers',
    desc: "There is a silver harp pin sewn inside Sister Garaele's sleeve and a dead-drop in the alms box that only three people know about. One of them has sold it. A Black Network hand walked east out of Phandalin this morning with a cipher sheet that names Harpers from here to Yartar.",
    summary: 'Catch the Zhentarim hand carrying a stolen Harper cipher east.',
    steps: [
      reach('triboar-trail', 'Ride east after the Black Network courier'),
      kill('spy', 1, 'Take the Zhentarim spy before the cipher leaves the Trail', 'triboar-trail'),
      talk('sister-garaele', 'Put the cipher sheet back in Garaele\'s hand', 'shrine-of-luck'),
    ],
    items: ['cloak-common', 'potion-healing'],
    rep: { harpers: 4, zhentarim: -3 },
  }),

  // --- Phandalin Miner's Exchange ------------------------------------------

  Q('glasstaffs-head', "Glasstaff's Head", {
    giver: 'halia-thornton', type: 'boss', minLevel: 4, tier: 'major',
    map: 'phandalin-manor', faction: 'zhentarim',
    desc: "Halia Thornton smiles a great deal and weighs everything, ore included. Iarno Albrek is a competitor with a private army, and the Black Network does not share a town. She does not want him arrested and sent to Waterdeep for a hearing. She wants his glass staff on her counter.",
    summary: 'Bring Halia Thornton proof that Glasstaff is finished, not merely arrested.',
    steps: [
      kill('glasstaff', 1, 'End Iarno "Glasstaff" Albrek', 'phandalin-manor'),
      deliver('halia-thornton', 'Lay the proof on the Exchange counter', 'miners-exchange'),
    ],
    items: ['potion-greater-healing', 'gem-onyx'],
    rep: { zhentarim: 5, 'lords-alliance': -2 },
    after: ['iarno-albrek-missing'],
  }),

  Q('the-exchange-ledger', 'The Exchange Ledger', {
    giver: 'halia-thornton', type: 'fetch', minLevel: 3, tier: 'small',
    map: 'phandalin', faction: 'zhentarim',
    desc: "Barthen forgives debts. Halia records them. Two prospectors have been weighing their ore somewhere other than the Exchange, and the Guildmaster would like them reminded — politely, by somebody unfamiliar, in daylight — of whose scales Phandalin uses.",
    summary: "Remind two prospectors whose scales the Miner's Exchange keeps.",
    steps: [
      talk('freda', 'Call on Freda at her claim', 'phandalin'),
      talk('mosk', 'Call on Mosk in the diggings', 'phandalin'),
      deliver('halia-thornton', 'Report both answers to Halia Thornton', 'miners-exchange'),
    ],
    items: ['ore-sample-phandalin', 'gem-quartz'],
    rep: { zhentarim: 2 },
  }),

  Q('zhent-shipment', 'A Crate That Stays Shut', {
    giver: 'halia-thornton', type: 'deliver', minLevel: 5, tier: 'standard',
    map: 'triboar-trail', faction: 'zhentarim',
    desc: 'A crate is going east off the Exchange floor and it is not going to be opened, weighed, or discussed. Halia pays well for that, and she pays the same rate every time. She is very clear that the peddler Ivor Marsk will be waiting on the Trail, and equally clear that you have never met her.',
    summary: 'Move a sealed Black Network crate up the Triboar Trail. Do not open it.',
    steps: [
      collect('coster-crate', 1, 'Take the sealed crate off the Exchange floor', 'miners-exchange'),
      reach('triboar-trail', 'Carry it east, off the town road'),
      deliver('ivor-marsk', 'Hand it to Ivor Marsk and walk away', 'triboar-trail'),
    ],
    items: ['potion-greater-healing', 'gem-amber'],
    rep: { zhentarim: 4, harpers: -2 },
    repeatable: true,
  }),

  // --- Townmaster's Hall and the watch --------------------------------------

  Q('wyvern-tor', 'Orcs at Wyvern Tor', {
    giver: 'harbin-wester', type: 'clear', minLevel: 5, tier: 'major',
    map: 'wyvern-tor', faction: 'lords-alliance',
    desc: 'Wyvern Tor is a saddle of grey rock in the Sword Mountains east of town, and there are orcs of Many-Arrows camped in it who have begun coming down to the farms for cattle. Harbin Wester has posted a bounty on them. Harbin Wester has also locked his shutters.',
    summary: 'Break the Many-Arrows raiding band camped at Wyvern Tor.',
    steps: [
      reach('wyvern-tor', 'Climb to the saddle of Wyvern Tor'),
      kill('orc', 5, 'Kill the Many-Arrows raiders in the camp', 'wyvern-tor'),
      kill('ogre', 1, 'Kill the ogre they bought with stolen cattle', 'wyvern-tor'),
    ],
    items: ['javelin-of-lightning', 'potion-greater-healing'],
    rep: { 'lords-alliance': 4, gauntlet: 2 },
    after: ['glasstaff'],
  }),

  Q('townmasters-bounty', "The Townmaster's Bounty", {
    giver: 'harbin-wester', type: 'kill', minLevel: 2, tier: 'small',
    map: 'triboar-trail', faction: 'lords-alliance',
    desc: 'There is a board on the wall of the Townmaster\'s Hall with a standing bounty on goblinkind, and Harbin Wester will point at it rather than look at you. The coin is real. The reading is on you.',
    summary: 'Take the standing goblin bounty off the Townmaster\'s board.',
    steps: [
      kill('goblin', 6, 'Kill six goblins anywhere within a day of Phandalin'),
      deliver('harbin-wester', 'Claim the bounty at the Hall', 'townmasters-hall'),
    ],
    items: ['potion-healing'],
    rep: { 'lords-alliance': 1 },
    repeatable: true,
  }),

  Q('the-tax-rolls', 'The Tax Rolls', {
    giver: 'harbin-wester', type: 'deliver', minLevel: 3, tier: 'small',
    map: 'phandalin', faction: 'lords-alliance',
    desc: "Phandalin's levy is a shilling on the acre and a tenth on ore, and Harbin Wester has not walked out to collect it since the scarlet cloaks appeared on the streets. He would like somebody else to knock on the doors. He would like it very much.",
    summary: "Walk the townmaster's levy round for him, since he will not.",
    steps: [
      talk('narth', 'Call on Narth in the strip fields south of town', 'phandalin'),
      talk('favric', 'Call on Favric at the woodpile', 'phandalin'),
      talk('freda', 'Call on Freda at her claim', 'phandalin'),
      deliver('harbin-wester', 'Bring the rolls back to the Hall', 'townmasters-hall'),
    ],
    items: ['potion-healing'],
    rep: { 'lords-alliance': 2 },
  }),

  Q('night-watch', 'The Night Watch', {
    giver: 'hall-guard-kerri', type: 'clear', minLevel: 2, tier: 'small',
    map: 'phandalin', faction: 'lords-alliance',
    desc: 'Kerri Amblecrown is one of the four townsfolk Harbin Wester calls a garrison. Her hauberk is two sizes large and her nerve is a good deal larger than the man who pays her. She walks the streets after dark alone. She would rather not.',
    summary: 'Walk the Phandalin streets after dark with Kerri Amblecrown.',
    steps: [
      kill('redbrand-ruffian', 3, 'Break up the scarlet cloaks working the night streets', 'phandalin'),
      talk('hall-guard-kerri', 'See Kerri back to the Hall at dawn', 'townmasters-hall'),
    ],
    items: ['potion-healing', 'lantern-hooded'],
    rep: { 'lords-alliance': 2 },
    repeatable: true,
  }),

  Q('the-gate-tally', 'The Gate Tally', {
    giver: 'gate-guard-stor', type: 'fetch', minLevel: 1, tier: 'trivial',
    map: 'phandalin', faction: 'lords-alliance',
    desc: "Stor Hornraven keeps a tally of every wagon on the Triboar road in a stick of chalk on the gatepost, and it rained. He is an old Illuskan spearman who has never in forty years handed in a short count, and he is not going to start now.",
    summary: "Reconstruct Stor Hornraven's washed-out wagon tally.",
    steps: [
      talk('ivor-marsk', 'Ask the peddler Ivor Marsk what he passed on the road', 'triboar-trail'),
      talk('taman-helder', 'Ask the Coster teamster Taman Helder', 'triboar-trail'),
      talk('evendur-greycastle', 'Ask the caravan master Evendur Greycastle', 'triboar-trail'),
      deliver('gate-guard-stor', 'Chalk the tally back onto the gatepost', 'phandalin'),
    ],
    items: ['chalk', 'neverwinter-ale'],
    rep: { 'lords-alliance': 1 },
  }),
];

// ---------------------------------------------------------------------------
// 3c — THE REST OF PHANDALIN: the orchard, the farm, the rough taproom, the
// Dendrar house, and the townsfolk who have nobody else to ask.
// ---------------------------------------------------------------------------

const TOWNSFOLK_QUESTS = [

  // --- Edermath Orchard ----------------------------------------------------

  Q('orchard-blights', 'Blights in the Orchard', {
    giver: 'daran-edermath', type: 'kill', minLevel: 2, tier: 'small',
    map: 'phandalin', faction: 'gauntlet',
    desc: 'Daran Edermath poured out his sword arm at Neverwinter and took up apples instead. Something has come down out of Neverwinter Wood into his rows: little walking bundles of thorn and dead wood that go for the ankles and the roots both. He knows exactly what they are. That is what worries him.',
    summary: "Clear the twig blights out of Daran Edermath's apple rows.",
    steps: [
      kill('twig-blight', 6, 'Burn the twig blights out of the orchard rows', 'phandalin'),
      talk('daran-edermath', 'Sit on the bench and tell Daran what you saw', 'phandalin'),
    ],
    items: [{ id: 'goodberry-preserve', qty: 2 }, 'potion-healing'],
    rep: { gauntlet: 2, 'emerald-enclave': 1 },
  }),

  Q('gauntlet-oath', 'The Gauntlet Oath', {
    giver: 'daran-edermath', type: 'boss', minLevel: 6, tier: 'major',
    map: 'old-owl-well', faction: 'gauntlet',
    desc: "The Order of the Gauntlet does not take a name on a letter. It takes proof, and the proof it takes is the same one it has always taken: go where the dead are walking, and stop them, and come back able to say what it cost. Daran Edermath was a Marshal once. He will stand your oath if you earn it.",
    summary: 'Earn a Marshal of the Gauntlet\'s word by putting down what walks at Old Owl Well.',
    steps: [
      reach('old-owl-well', 'Return to the Netherese ruin where the dead still walk'),
      kill('ghoul', 4, 'Put down the ghouls denning in the broken foundations', 'old-owl-well'),
      kill('wight', 1, 'Destroy the wight that has been raising them', 'old-owl-well'),
      talk('daran-edermath', 'Take the Order\'s oath under the apple trees', 'phandalin'),
    ],
    items: ['mace-plus1', 'potion-greater-healing', 'holy-water'],
    rep: { gauntlet: 6 },
    after: ['old-owl-well'],
    sets: ['gauntlet-sworn'],
  }),

  // --- Alderleaf Farm ------------------------------------------------------

  Q('reidoths-whereabouts', "Reidoth's Whereabouts", {
    giver: 'qelline-alderleaf', type: 'fetch', minLevel: 3, tier: 'small', map: 'neverwinter-wood',
    desc: 'Qelline Alderleaf keeps the best turnips in Phandalin and is rather better informed than the townmaster. She knows a druid named Reidoth who walks the ash of Thundertree and knows every path in Neverwinter Wood. If anyone can tell you what is in those ruins, it is him — if he will speak to you at all.',
    summary: 'Find the druid Reidoth in Neverwinter Wood, as Qelline Alderleaf suggests.',
    steps: [
      reach('neverwinter-wood', 'Walk in under the pines of Neverwinter Wood'),
      talk('reidoth', 'Find Reidoth and give him Qelline Alderleaf\'s name', 'neverwinter-wood'),
    ],
    items: ['goodberry-preserve', 'potion-healing'],
    rep: { 'emerald-enclave': 2 },
    next: 'thundertree-ruins',
  }),

  Q('alderleaf-harvest', 'The Alderleaf Harvest', {
    giver: 'qelline-alderleaf', type: 'kill', minLevel: 1, tier: 'minor', map: 'alderleaf-farm',
    desc: 'The turnips have to come up before the first frost, and something has got into the irrigation ditch that is too big to be a frog and is, unfortunately, a frog. Qelline is unflappable about it. She would still like it gone.',
    summary: 'Get the giant frogs out of the Alderleaf irrigation ditch before the frost.',
    steps: [
      kill('giant-frog', 3, 'Clear the giant frogs out of the irrigation ditch', 'alderleaf-farm'),
      talk('qelline-alderleaf', 'Help Qelline get the turnips up', 'alderleaf-farm'),
    ],
    items: [{ id: 'goodberry-preserve', qty: 3 }, { id: 'rations', qty: 2 }],
    repeatable: true,
  }),

  Q('carps-secret-tunnel', "Carp's Secret Tunnel", {
    giver: 'carp-alderleaf', type: 'clear', minLevel: 3, tier: 'standard', map: 'phandalin-manor',
    desc: 'Carp Alderleaf has found a hole in the hillside under Tresendar Manor that a halfling can get through and a Redbrand cannot. He cannot decide whether to be terrified or immensely proud, and he is both. He will show you the way in if you promise not to tell his mother.',
    summary: "Take Carp Alderleaf's secret tunnel into the Tresendar Manor cellars.",
    steps: [
      talk('carp-alderleaf', 'Get the tunnel mouth out of Carp — and a promise out of yourself', 'alderleaf-farm'),
      reach('phandalin-manor', 'Crawl through into the manor cellars'),
      kill('nothic', 1, 'Face whatever is watching from the crevasse', 'phandalin-manor'),
    ],
    items: ['potion-healing', 'thieves-tools'],
    sets: ['manor-tunnel-known'],
  }),

  // --- The Sleeping Giant --------------------------------------------------

  Q('sleeping-giant-brawl', 'A Brawl at the Sleeping Giant', {
    giver: 'grista', type: 'kill', minLevel: 2, tier: 'minor', map: 'sleeping-giant',
    desc: 'Three toughs have been drinking on the slate at the Sleeping Giant for eleven days and have stopped pretending they intend to pay. Grista has forearms like mooring rope and has never used four words where one would do. The word she uses is "out".',
    summary: "Throw three deadbeats out of Grista's taproom.",
    steps: [
      kill('thug', 3, 'Put the three toughs through the taproom door', 'sleeping-giant'),
      talk('grista', 'Collect from Grista, who does not thank people', 'sleeping-giant'),
    ],
    items: [{ id: 'shadowdark-ale', qty: 2 }, 'potion-healing'],
  }),

  Q('gristas-stock', "Grista's Stock", {
    giver: 'grista', type: 'deliver', minLevel: 2, tier: 'small', map: 'triboar-trail',
    desc: "The dray out of Neverwinter should have brought four casks of North Brew to the Sleeping Giant two days ago. It is sitting on the Triboar Trail with its axle broken and its driver hiding in the ditch, and Grista's taproom is down to the sour stuff. Grista does not consider this a small matter.",
    summary: "Get Grista's ale delivery off the Triboar Trail and into her cellar.",
    steps: [
      reach('triboar-trail', 'Find the broken-down dray on the Trail'),
      kill('bandit', 3, 'Drive off the road-thieves picking the dray over', 'triboar-trail'),
      collect('iriaeboran-north-brew', 4, 'Get four casks of North Brew off the wagon', 'triboar-trail'),
      deliver('grista', "Roll them into the Sleeping Giant's cellar", 'sleeping-giant'),
    ],
    items: [{ id: 'shadowdark-ale', qty: 2 }, 'potion-healing'],
    repeatable: true,
  }),

  Q('veits-debt', "Veit's Debt", {
    giver: 'veit-ungart', type: 'deliver', minLevel: 2, tier: 'minor', map: 'phandalin',
    desc: 'Veit Ungart came south from Mirabar for the Phandelver strike, found nothing, and has been at the same corner table of the Sleeping Giant ever since. He owes Grista for a season of ale and Barthen for a pick. He has one seam left that he swears is good, and no legs steady enough to work it.',
    summary: "Work Veit Ungart's last seam and pay off what he owes Grista.",
    steps: [
      collect('ore-sample-phandalin', 2, "Work Veit's seam in the foothills", 'phandalin'),
      deliver('grista', 'Settle the slate at the Sleeping Giant', 'sleeping-giant'),
      talk('veit-ungart', 'Tell Veit he is square, and watch him take it badly', 'sleeping-giant'),
    ],
    items: ['zzar', 'potion-healing'],
  }),

  // --- The Dendrar family ---------------------------------------------------

  Q('dendrar-emerald-necklace', 'The Dendrar Emerald', {
    giver: 'mirna-dendrar', type: 'fetch', minLevel: 4, tier: 'standard', map: 'phandalin-manor',
    desc: "Mirna Dendrar's husband Nars objected to the Redbrands and they hanged him from his own gatepost. They took the house too, and everything in it — including an emerald necklace her grandmother carried out of Neverwinter the year the mountain burned. She has not asked anyone for it. She would not know how.",
    summary: "Recover the emerald necklace the Redbrands took from Mirna Dendrar.",
    steps: [
      collect('gem-emerald', 1, 'Find the emerald in the Redbrands\' plunder', 'phandalin-manor'),
      deliver('mirna-dendrar', 'Put it back into Mirna Dendrar\'s hands', 'phandalin'),
    ],
    items: ['potion-greater-healing', 'gem-moonstone'],
    rep: { 'lords-alliance': 2, harpers: 2 },
    after: ['redbrand-menace'],
  }),

  Q('nars-grave', "Nars Dendrar's Grave", {
    giver: 'mirna-dendrar', type: 'boss', minLevel: 5, tier: 'major', map: 'phandalin',
    desc: 'They cut Nars Dendrar down after three days and buried him outside the fence because Harbin Wester would not have a hanged man in the yard. He has not stayed buried. Mirna has heard him at the shutters four nights running, saying her name in a voice that is nearly right.',
    summary: 'Lay Nars Dendrar to rest — properly, and inside the fence.',
    steps: [
      reach('phandalin', 'Go out to the unmarked grave beyond the fence at dusk'),
      kill('nars-dendrar', 1, 'Give Nars Dendrar the rest the Redbrands denied him', 'phandalin'),
      talk('mirna-dendrar', 'Tell Mirna it is finished, and where he lies now', 'phandalin'),
    ],
    items: ['holy-water', 'potion-greater-healing', 'gem-onyx'],
    rep: { gauntlet: 3, harpers: 2 },
    after: ['dendrar-emerald-necklace'],
    sets: ['nars-at-rest'],
  }),

  Q('nilsas-courage', "Nilsa's Courage", {
    giver: 'nilsa-dendrar', type: 'fetch', minLevel: 3, tier: 'minor', map: 'phandalin',
    desc: 'Nilsa Dendrar is twelve, furious and entirely out of tears. She has decided that when she is grown she will kill every Redbrand in Faerûn, and she means it, and that is exactly what her mother is afraid of. She wants to see the scarlet cloaks gone. Then she wants to be told it is over.',
    summary: 'Show Nilsa Dendrar that the Redbrands are finished, so she can put it down.',
    steps: [
      flagStep('redbrands-broken', 'Break the Redbrands for good'),
      talk('nilsa-dendrar', 'Tell Nilsa yourself, and let her decide what to do with it', 'phandalin'),
    ],
    items: ['dagger', 'potion-healing'],
    rep: { harpers: 1 },
  }),

  // --- The rest of the town -------------------------------------------------

  Q('droops-freedom', "Droop's Freedom", {
    giver: 'droop', type: 'fetch', minLevel: 3, tier: 'minor', map: 'phandalin',
    desc: 'Droop was the Cragmaw tribe\'s dogsbody and is now nobody\'s. He is small, bruised, and wants very badly to be useful to somebody who does not hit him. Phandalin is not sure what to do with a goblin who says please. Toblen Stonehill might be persuaded to find out.',
    summary: 'Find Droop the goblin a place in Phandalin that is not a cage.',
    steps: [
      talk('toblen-stonehill', 'Talk Toblen into taking a goblin on at the Stonehill', 'stonehill-inn'),
      talk('droop', 'Tell Droop he has somewhere to sleep', 'phandalin'),
    ],
    items: ['goblin-totem', 'potion-healing'],
    requires: ['droop-freed'],
  }),

  Q('fredas-claim', "Freda's Claim", {
    giver: 'freda', type: 'deliver', minLevel: 2, tier: 'small', map: 'phandalin',
    desc: "Freda was a weaver until she staked a claim in the foothills, and she has been washing gravel for two years to prove she was right to. The Miner's Exchange says her stake overlaps a Zhentarim-registered lot and that her ore assays poor. She is nearly out of gravel and entirely out of savings.",
    summary: "Settle Freda's claim dispute at the Miner's Exchange with ore she can't be argued out of.",
    steps: [
      talk('halia-thornton', 'Hear the Exchange\'s side of the claim', 'miners-exchange'),
      collect('ore-sample-phandalin', 3, 'Wash three assayable samples out of Freda\'s gravel', 'phandalin'),
      deliver('freda', 'Take the assay back to Freda so she can file it', 'phandalin'),
    ],
    items: ['gem-quartz', 'potion-healing'],
  }),

  Q('narths-scarecrows', "Narth's Scarecrows", {
    giver: 'narth', type: 'kill', minLevel: 3, tier: 'small', map: 'phandalin',
    desc: 'Narth has farmed the strip fields south of Phandalin for forty years and complains about the weather on principle. He is not complaining about the weather now. Two of his scarecrows have moved between the rows in the night, and one of them has moved as far as the fence.',
    summary: 'Find out what is walking in Narth\'s fields wearing his scarecrows.',
    steps: [
      kill('scarecrow', 2, 'Destroy the scarecrows walking in the strip fields', 'phandalin'),
      talk('narth', 'Tell Narth he can bring the harvest in', 'phandalin'),
    ],
    items: [{ id: 'rations', qty: 3 }, 'potion-healing'],
  }),

  Q('favrics-wager', "Favric's Wager", {
    giver: 'favric', type: 'kill', minLevel: 1, tier: 'minor', map: 'phandalin',
    desc: 'Favric cuts pine on the edge of the foothills and will wager on absolutely anything, including how long this conversation lasts. His current offer: the wolves have been coming down to the woodpile at dusk, and he bets you cannot clear five of them before he finishes his cord.',
    summary: "Take Favric's wager and clear the wolves off his woodpile.",
    steps: [
      kill('wolf', 5, 'Kill five wolves in the pines above the woodpile', 'phandalin'),
      talk('favric', 'Collect the wager before Favric thinks of a new one', 'phandalin'),
    ],
    items: ['gaming-dice', 'trail-bread'],
    repeatable: true,
  }),

  Q('mosks-pick', "Mosk's Pick", {
    giver: 'mosk', type: 'fetch', minLevel: 1, tier: 'minor', map: 'phandalin',
    desc: 'Mosk is soot-dark and quiet and sells whatever he digs to Halia Thornton at whatever price she names, because he stopped arguing about it a year ago. His pick head is at the bottom of a shallow drift with something long and many-legged coiled around it, and a miner without a pick is not a miner.',
    summary: "Get Mosk's pick head back out of the drift, and whatever is down there with it.",
    steps: [
      kill('giant-centipede', 3, 'Kill the centipedes nesting in the shallow drift', 'phandalin'),
      collect('ore-sample-phandalin', 2, 'Bring up what Mosk was digging for', 'phandalin'),
      talk('mosk', 'Put the pick back in Mosk\'s hands', 'phandalin'),
    ],
    items: ['war-pick', 'potion-healing'],
  }),

  Q('the-strays-bone', "The Stray's Bone", {
    giver: 'phandalin-stray', type: 'fetch', minLevel: 1, tier: 'trivial', map: 'phandalin',
    desc: 'The lean yellow dog belongs to the whole of Phandalin and to nobody, and she has been trotting up the street all morning with something in her mouth that is not a sheep bone and is not, on closer inspection, anything a dog should have found within a mile of the town well.',
    summary: 'Find out where the stray dog got what she is carrying.',
    steps: [
      talk('phandalin-stray', 'Get the thing out of the yellow dog\'s mouth'),
      collect('goblin-totem', 1, 'Follow her back and find the rest of it', 'phandalin'),
      talk('harbin-wester', 'Put it on the townmaster\'s desk and watch him blanch', 'townmasters-hall'),
    ],
    items: ['rations', 'potion-healing'],
  }),
];

// ---------------------------------------------------------------------------
// 3d — THE ROAD: travellers on the Triboar Trail and the High Road, the druid
// of Thundertree, the Red Wizard at Old Owl Well, and Waterdeep at the end of it.
// ---------------------------------------------------------------------------

const ROAD_QUESTS = [

  Q('peddlers-lost-wagon', "The Peddler's Lost Wagon", {
    giver: 'ivor-marsk', type: 'clear', minLevel: 2, tier: 'small', map: 'triboar-trail',
    desc: 'Ivor Marsk has walked the Triboar Trail eleven years with a handcart and a bad knee and has never once been robbed, he says. He is saying it rather less this tenday, because the cart is gone, and with it every needle, ribbon and tin whistle he owns.',
    summary: "Get Ivor Marsk's handcart back off whatever took it.",
    steps: [
      reach('triboar-trail', 'Backtrack the cart ruts off the Trail'),
      kill('goblin', 4, 'Kill the goblins who dragged it into the bracken', 'triboar-trail'),
      collect('coster-crate', 1, 'Recover the crate holding his stock', 'triboar-trail'),
      deliver('ivor-marsk', 'Wheel it back to Ivor on the road', 'triboar-trail'),
    ],
    items: ['potion-healing', 'signal-whistle'],
  }),

  Q('pilgrims-road', "The Pilgrim's Road", {
    giver: 'ceidil-pashar', type: 'escort', minLevel: 2, tier: 'small', map: 'triboar-trail',
    desc: 'Ceidil Pashar is walking from Waterdeep to the shrine at Leilon barefoot, which she insists is the point. She binds wounds for nothing and asks only for the news. The stretch of road ahead of her has men on it who take payment in whatever a traveller happens to have.',
    summary: 'Walk Ceidil Pashar of Ilmater through the bad stretch of the road.',
    steps: [
      escort('ceidil-pashar', 'Set out with the pilgrim at first light', 'triboar-trail'),
      kill('bandit', 3, 'Turn back the men waiting at the ford', 'triboar-trail'),
      reach('triboar-trail', 'See her as far as the Leilon turning'),
    ],
    items: [{ id: 'holy-water', qty: 2 }, 'potion-healing'],
    rep: { gauntlet: 2 },
  }),

  Q('caravan-to-triboar', 'Caravan to Triboar', {
    giver: 'evendur-greycastle', type: 'escort', minLevel: 4, tier: 'standard',
    map: 'triboar-trail', faction: 'lords-alliance',
    desc: "Twenty years hauling Waterdhavian goods up the High Road have left Evendur Greycastle with a squint, a limp and an absolute refusal to travel after dark. He is going east to Triboar with six wagons and four guards, and he knows perfectly well that four is two short.",
    summary: 'Hire on as caravan guard for the run east to Triboar.',
    steps: [
      escort('evendur-greycastle', 'Take a place on the Triboar run', 'triboar-trail'),
      kill('hobgoblin', 4, 'Beat off the hobgoblin toll-takers at the narrows', 'triboar-trail'),
      reach('triboar-trail', 'See the wagons through to the eastern stage'),
    ],
    items: ['potion-greater-healing', { id: 'rations', qty: 4 }],
    rep: { 'lords-alliance': 3 },
    repeatable: true,
  }),

  Q('teamsters-toll', "The Teamster's Toll", {
    giver: 'taman-helder', type: 'kill', minLevel: 3, tier: 'small',
    map: 'triboar-trail', faction: 'lords-alliance',
    desc: 'Taman Helder drives the Coster wagons out of Yartar and has lost two of them on this road in a season. Linene has words for him. He has better ones for the men who have set themselves up at the stream crossing and started calling their robbery a toll.',
    summary: 'Break up the "toll" the road-thugs have set up at the crossing.',
    steps: [
      reach('triboar-trail', 'Ride out to the stream crossing east of the turning'),
      kill('thug', 5, 'Clear the toll-takers off the crossing', 'triboar-trail'),
      talk('taman-helder', 'Tell Taman the road is his again', 'triboar-trail'),
    ],
    items: ['potion-healing', 'spear'],
    rep: { 'lords-alliance': 2 },
    repeatable: true,
  }),

  // --- Reidoth and the ash of Thundertree ----------------------------------

  Q('thundertree-ruins', 'The Ruins of Thundertree', {
    giver: 'reidoth', type: 'clear', minLevel: 5, tier: 'major',
    map: 'thundertree', faction: 'emerald-enclave',
    desc: 'Thundertree was a woodcutters\' village until Mount Hotenow blew and the Neverwinter Wood took it back. Ash lies a foot deep in the lanes and the walking dead of that day still lie in it. Reidoth keeps the ruin from spreading. Lately there have been men in the ruin who wear a black dragon on their sleeves.',
    summary: 'Walk the ash-choked ruin of Thundertree and find out who the cultists serve.',
    steps: [
      reach('thundertree', 'Come up the ash road into Thundertree'),
      kill('cultist', 4, 'Break up the Cult of the Dragon cell in the ruin', 'thundertree'),
      clear('thundertree', 'Clear the ash-dead out of the lanes'),
    ],
    items: ['dragonguard', 'dragon-cult-token', 'potion-greater-healing'],
    rep: { 'emerald-enclave': 5, gauntlet: 2 },
    after: ['glasstaff'],
    next: 'thundertree-blights',
    sets: ['thundertree-entered'],
  }),

  Q('thundertree-blights', 'The Blights of Thundertree', {
    giver: 'reidoth', type: 'kill', minLevel: 4, tier: 'standard',
    map: 'thundertree', faction: 'emerald-enclave',
    desc: 'The blights grow in the ash where the village gardens used to be — twig, needle and vine, all of them walking, all of them spreading down the valley toward the farms. Reidoth has been burning them back alone for thirty years. He is old, and there are more of them every spring.',
    summary: 'Burn the blights back out of the Thundertree gardens with Reidoth.',
    steps: [
      kill('twig-blight', 8, 'Burn the twig blights out of the ash gardens', 'thundertree'),
      kill('vine-blight', 2, 'Destroy the vine blights choking the old orchard', 'thundertree'),
      talk('reidoth', 'Report the count to Reidoth, who will not thank you', 'thundertree'),
    ],
    items: [{ id: 'potion-healing', qty: 2 }, 'herbalism-kit'],
    rep: { 'emerald-enclave': 3 },
    next: 'the-ash-and-the-wood',
  }),

  Q('the-ash-and-the-wood', 'The Ash and the Wood', {
    giver: 'reidoth', type: 'boss', minLevel: 7, tier: 'capstone',
    map: 'thundertree', faction: 'emerald-enclave',
    desc: 'There is a green dragon in the ruined tower at the top of Thundertree, young and vain and very much awake, and the Cult of the Dragon has been feeding it. Venomfang will take the whole valley in five years if it is left. Reidoth says the wood will heal. He does not say it will heal in his lifetime.',
    summary: 'Drive Venomfang out of Thundertree before the Cult finishes buying it.',
    steps: [
      reach('thundertree', 'Climb to the ruined tower at the head of the village'),
      kill('venomfang', 1, 'Kill or drive out Venomfang the green dragon', 'thundertree'),
      talk('reidoth', 'Stand with Reidoth and watch the ash settle', 'thundertree'),
    ],
    items: ['gem-jade', 'potion-superior-healing', 'staff-of-the-python'],
    rep: { 'emerald-enclave': 8, gauntlet: 3 },
    after: ['thundertree-ruins'],
    sets: ['venomfang-driven'],
  }),

  Q('kosts-bargain', "Kost's Bargain", {
    giver: 'hamun-kost', type: 'fetch', minLevel: 5, tier: 'standard', map: 'old-owl-well',
    desc: 'Hamun Kost is a Red Wizard of Thay poking at a Netherese ruin with a crew of skeletons and a great deal of confidence. He would rather bargain than fight, but only just. What he wants out of Old Owl Well is black stone the Netherese cut their wards from — and he does not much care to dig it himself.',
    summary: 'Trade with the Thayan necromancer at Old Owl Well, if you can stomach it.',
    steps: [
      collect('gem-onyx', 3, 'Dig the warded onyx out of the Netherese foundations', 'old-owl-well'),
      talk('hamun-kost', 'Make the trade with Hamun Kost', 'old-owl-well'),
    ],
    items: ['scroll-3', 'gem-amber', 'potion-greater-healing'],
    rep: { gauntlet: -2, zhentarim: 1 },
    requires: ['old-owl-well-found'],
    repeatable: true,
  }),

  // --- Waterdeep -----------------------------------------------------------

  Q('durnans-tab', "Durnan's Tab", {
    giver: 'durnan', type: 'fetch', minLevel: 11, tier: 'standard', map: 'undermountain',
    desc: 'Durnan went down the well once and came back rich, and has spent every year since pulling ale for people who intend to do the same. A great many of them do not come back, and a great many of those had a tab. He is not sentimental about it. He would simply like the tab settled out of what they were carrying.',
    summary: "Settle the tabs of patrons who went down Durnan's well and stayed down.",
    steps: [
      reach('undermountain', 'Go back down the Yawning Portal well'),
      collect('platinum-ingot', 2, 'Recover what the dead were carrying', 'undermountain'),
      deliver('durnan', 'Square the tab on the bar of the Yawning Portal', 'waterdeep'),
    ],
    items: ['potion-greater-healing', 'evermead'],
    repeatable: true,
    requires: ['yawning-portal-open'],
  }),

  Q('volos-notes', "Volo's Notes", {
    giver: 'volothamp-geddarm', type: 'kill', minLevel: 10, tier: 'standard', map: 'waterdeep',
    desc: 'Volothamp Geddarm is writing a guide to the Sword Coast and requires eyewitnesses, preferably ones who survive long enough to be interviewed. He will pay well for a good story and haggle bitterly over a true one. He wants monsters described from close range. He is not going to be doing the describing.',
    summary: 'Give Volo the eyewitness accounts his guide is missing.',
    steps: [
      kill('owlbear', 1, 'Face an owlbear at close range and remember the details'),
      kill('wyvern', 1, 'Do the same for a wyvern, if you can'),
      talk('volothamp-geddarm', 'Sit down with Volo and let him take it all wrong', 'waterdeep'),
    ],
    items: ['book', 'potion-greater-healing'],
    repeatable: true,
  }),

  Q('mirts-loan', "Mirt's Loan", {
    giver: 'mirt', type: 'deliver', minLevel: 11, tier: 'major',
    map: 'waterdeep', faction: 'harpers',
    desc: 'Mirt is a fat, wheezing old rogue in a stained doublet who is also a Lord of Waterdeep, a Harper, and considerably more dangerous than he looks sitting down. He has lent money in the Dock Ward to a man who has since hired a great many friends. Mirt would like the principal. The friends are your problem.',
    summary: "Collect on Mirt the Moneylender's Dock Ward loan.",
    steps: [
      reach('waterdeep', 'Go down into the Dock Ward after dark'),
      kill('thug', 5, 'Get through the debtor\'s hired friends', 'waterdeep'),
      talk('mirt', 'Bring Mirt his principal and keep the interest', 'waterdeep'),
    ],
    items: ['potion-superior-healing', 'gem-pearl'],
    rep: { harpers: 5 },
    repeatable: true,
  }),
];

// ---------------------------------------------------------------------------
// 3e — THE CATALOGUE
// ---------------------------------------------------------------------------

const ALL_QUESTS = [].concat(MAIN_CHAIN, PHANDALIN_QUESTS, TOWNSFOLK_QUESTS, ROAD_QUESTS);

/** Every hand-written quest in the game, keyed by id. */
export const QUESTS = deepFreeze(Object.fromEntries(ALL_QUESTS.map((q) => [q.id, q])));
export const QUEST_IDS = Object.freeze(Object.keys(QUESTS));

// ===========================================================================
// 4. QUEST CHAINS
//
// The named arcs. `quests` is in narrative order; the same order the `next`
// links walk. ui/menus.js can render a chain as a progress spine, and
// `chainOf(id)` answers "what story is this part of?".
// ===========================================================================

function chain(id, name, o = {}) {
  return {
    id, name,
    desc: o.desc || '',
    faction: o.faction || null,
    tier: o.tier || '',
    quests: Object.freeze((o.quests || []).slice()),
    startsWith: (o.quests || [])[0] || null,
    endsWith: (o.quests || [])[(o.quests || []).length - 1] || null,
    completionFlag: o.completionFlag || null,
    reward: rewardsFor(o.rewardLevel || 1, o.tier2 || 'major', o.items, o.rep),
  };
}

export const QUEST_CHAINS = deepFreeze({

  'lost-mine-of-phandelver': chain('lost-mine-of-phandelver', 'The Lost Mine of Phandelver', {
    tier: 'Levels 1–7', rewardLevel: 7, tier2: 'major',
    desc: 'A wagonload of picks and salt pork, a dwarf who talked too loudly about a map, and five hundred years of dwarven and gnomish magic sealed under the Sword Mountains. It begins on the Triboar Trail with four goblins in the bracken and it ends in the Forge of Spells with a drow who thought he had bought the whole thing.',
    quests: [
      'deliver-barthens-supplies', 'rockseeker-brothers', 'sildars-commission',
      'redbrand-menace', 'iarno-albrek-missing', 'glasstaff', 'old-owl-well',
      'nundros-rescue', 'wave-echo-cave',
    ],
    completionFlag: 'lost-mine-complete',
    items: ['gem-emerald', 'potion-superior-healing'],
    rep: { 'lords-alliance': 5, harpers: 3, gauntlet: 3 },
  }),

  'the-road-to-waterdeep': chain('the-road-to-waterdeep', 'The Road to Waterdeep', {
    tier: 'Levels 8–12', rewardLevel: 12, tier2: 'major', faction: 'lords-alliance',
    desc: "Phandelver made your name, and a name travels the High Road faster than you do. Leilon, Neverwinter, and at last the City of Splendors — where there is a tavern with a well in the common room, and the well has no bottom.",
    quests: [
      'leilon-dispatch', 'the-alliance-road', 'protectors-enclave-patrol',
      'the-yawning-portal', 'descent-into-undermountain',
    ],
    completionFlag: 'undermountain-unlocked',
    items: ['potion-supreme-healing', 'gem-diamond'],
    rep: { 'lords-alliance': 8, harpers: 4 },
  }),

  'the-redbrand-menace': chain('the-redbrand-menace', 'The Redbrand Menace', {
    tier: 'Levels 3–4', rewardLevel: 4, tier2: 'standard', faction: 'lords-alliance',
    desc: 'Scarlet cloaks on a frontier street, a hanged man on his own gatepost, and a wizard of the Lords\' Alliance who decided he preferred being obeyed. Everything the Redbrands did to Phandalin was done from a cellar under a burnt manor house.',
    quests: ['sildars-commission', 'redbrand-menace', 'iarno-albrek-missing', 'glasstaff'],
    completionFlag: 'redbrands-broken',
    items: ['potion-greater-healing'],
    rep: { 'lords-alliance': 4 },
  }),

  'the-dendrar-family': chain('the-dendrar-family', 'The Dendrar Family', {
    tier: 'Levels 3–5', rewardLevel: 5, tier2: 'standard',
    desc: 'Nars Dendrar objected to the Redbrands out loud, once, and they hanged him for it. What is left is a widow selling lamp wicks out of a front room, a twelve-year-old planning a war, and a grave outside the fence that will not stay quiet.',
    quests: ['nilsas-courage', 'dendrar-emerald-necklace', 'nars-grave'],
    completionFlag: 'nars-at-rest',
    items: ['gem-moonstone'],
    rep: { harpers: 3, gauntlet: 3 },
  }),

  'the-ash-of-thundertree': chain('the-ash-of-thundertree', 'The Ash of Thundertree', {
    tier: 'Levels 3–7', rewardLevel: 7, tier2: 'major', faction: 'emerald-enclave',
    desc: 'Mount Hotenow buried a woodcutters\' village in ash and the Neverwinter Wood came back for the ground. One old druid has held the line there for thirty years. Now the Cult of the Dragon has found something in the ruined tower worth feeding.',
    quests: ['reidoths-whereabouts', 'thundertree-ruins', 'thundertree-blights', 'the-ash-and-the-wood'],
    completionFlag: 'venomfang-driven',
    items: ['staff-of-the-woodlands'],
    rep: { 'emerald-enclave': 8 },
  }),

  'the-old-owl-well': chain('the-old-owl-well', 'The Dead of Old Owl Well', {
    tier: 'Levels 5–6', rewardLevel: 6, tier2: 'standard', faction: 'gauntlet',
    desc: 'A Netherese tower over a spring that has been dry since before Phandalin had a name, a Red Wizard of Thay with a crew of skeletons, and a retired Marshal of the Order of the Gauntlet who wants to know whose side you take.',
    quests: ['old-owl-well', 'kosts-bargain', 'gauntlet-oath'],
    completionFlag: 'gauntlet-sworn',
    items: ['holy-water'],
    rep: { gauntlet: 6 },
  }),
});

export const QUEST_CHAIN_IDS = Object.freeze(Object.keys(QUEST_CHAINS));

// ===========================================================================
// 5. CANONICAL LOCATIONS
//
// Every place a generated contract can send a party. `prep` is the phrase the
// title and description drop in whole ("on the Triboar Trail", "beneath
// Waterdeep"), so the Realms voice survives the string templating.
// ===========================================================================

function loc(id, name, prep, biome, lo, hi, map) {
  return { id, name, prep, biome, band: [lo, hi], map: map || id };
}

export const QUEST_LOCATIONS = deepFreeze([
  loc('triboar-trail', 'the Triboar Trail', 'on the Triboar Trail', 'road', 1, 8, 'triboar-trail'),
  loc('phandalin-foothills', 'the Phandalin foothills', 'in the Phandalin foothills', 'hills', 1, 6, 'phandalin'),
  loc('neverwinter-wood', 'Neverwinter Wood', 'in Neverwinter Wood', 'pine-forest', 2, 18, 'neverwinter-wood'),
  loc('cragmaw-hideout', 'the Cragmaw Hideout', 'in the Cragmaw Hideout', 'cave', 1, 6, 'cragmaw-hideout'),
  loc('cragmaw-castle', 'Cragmaw Castle', 'in Cragmaw Castle', 'ruins', 3, 9, 'cragmaw-castle'),
  loc('conyberry-ruins', 'the ruins of Conyberry', 'among the ruins of Conyberry', 'ruins', 2, 9, 'conyberry-ruins'),
  loc('thundertree', 'Thundertree', 'in the ash of Thundertree', 'ash-waste', 4, 16, 'thundertree'),
  loc('wyvern-tor', 'Wyvern Tor', 'at Wyvern Tor', 'hills', 3, 9, 'wyvern-tor'),
  loc('old-owl-well', 'Old Owl Well', 'at Old Owl Well', 'ruins', 4, 10, 'old-owl-well'),
  loc('sword-mountains', 'the Sword Mountains', 'in the Sword Mountains', 'mountain', 3, 20, 'sword-mountains'),
  loc('kryptgarden-forest', 'Kryptgarden Forest', 'in Kryptgarden Forest', 'forest', 4, 20, 'kryptgarden-forest'),
  loc('high-road', 'the High Road', 'on the High Road', 'road', 4, 12, 'high-road'),
  loc('mere-of-dead-men', 'the Mere of Dead Men', 'in the Mere of Dead Men', 'marsh', 5, 20, 'mere-of-dead-men'),
  loc('leilon', 'Leilon', 'outside Leilon', 'road', 4, 11, 'leilon'),
  loc('wave-echo-cave', 'Wave Echo Cave', 'in Wave Echo Cave', 'mine', 5, 13, 'wave-echo-cave'),
  loc('dessarin-valley', 'the Dessarin Valley', 'in the Dessarin Valley', 'plains', 3, 11, 'dessarin-valley'),
  loc('goldenfields', 'Goldenfields', 'on the Goldenfields road', 'plains', 4, 12, 'goldenfields'),
  loc('ardeep-forest', 'Ardeep Forest', 'in Ardeep Forest', 'forest', 5, 20, 'ardeep-forest'),
  loc('starmetal-hills', 'the Starmetal Hills', 'in the Starmetal Hills', 'hills', 6, 20, 'starmetal-hills'),
  loc('icespire-peak', 'Icespire Peak', 'under Icespire Peak', 'mountain', 6, 22, 'icespire-peak'),
  loc('mount-hotenow', 'Mount Hotenow', 'on the slopes of Mount Hotenow', 'ash-waste', 8, 22, 'mount-hotenow'),
  loc('neverwinter', 'Neverwinter', 'in the ruins of Neverwinter', 'city', 6, 22, 'neverwinter'),
  loc('waterdeep', 'Waterdeep', 'in Waterdeep', 'city', 8, 30, 'waterdeep'),
  loc('undermountain', 'Undermountain', 'beneath Waterdeep', 'dungeon', 8, 30, 'undermountain'),
  loc('the-underdark', 'the Underdark', 'in the Underdark', 'underdark', 11, 30, 'underdark'),
  loc('crypts-of-phandalin', 'the old crypts', 'in the crypts below the ruins', 'crypt', 3, 14, 'phandalin-manor'),
]);

// ===========================================================================
// 6. FACTION CONTRACT BOARDS
//
// Five boards, each with its own voice, objectives and reward table. These are
// TEMPLATES; `generateQuest` instantiates one against a location, a creature
// and the party's level, forever. Rank names are the canonical ones from
// docs/SETTING.md §3.
// ===========================================================================

/** One repeatable contract template. */
function tpl(id, o = {}) {
  return {
    id,
    kind: o.kind || 'kill',                     // kill | clear | collect | escort | recon | boss
    name: o.name || titleCase(id),
    titles: Object.freeze((o.titles || ['{foes} {prep}']).slice()),
    desc: o.desc || 'A contract, plainly worded and plainly paid.',
    count: Object.freeze((o.count || [4, 6]).slice()),   // objective count band
    types: Object.freeze((o.types || []).slice()),        // preferred creature types
    biomes: Object.freeze((o.biomes || []).slice()),      // preferred biomes
    crShift: o.crShift != null ? o.crShift : 0,           // nudge the CR band
    goldMult: o.goldMult != null ? o.goldMult : 1,
    xpMult: o.xpMult != null ? o.xpMult : 1,
    repMult: o.repMult != null ? o.repMult : 1,
    type: o.type || 'kill',                                // SPEC quest `type`
  };
}

/** A faction board. `rewards` entries are [itemId, minPartyLevel]. */
function board(id, name, o = {}) {
  return {
    id, name,
    short: o.short || name,
    giver: o.giver || null,
    board: o.board || '',
    sigil: o.sigil || '',
    creed: o.creed || '',
    ranks: Object.freeze((o.ranks || []).slice()),
    biomes: Object.freeze((o.biomes || []).slice()),
    rivals: Object.freeze({ ...(o.rivals || {}) }),
    rep: Object.freeze({ perContract: o.repPer || 3, perTier: o.repTier || 1, ...(o.rep || {}) }),
    goldMult: o.goldMult != null ? o.goldMult : 1,
    xpMult: o.xpMult != null ? o.xpMult : 1,
    rewards: Object.freeze((o.rewards || []).map((e) => Object.freeze(e.slice()))),
    templates: Object.freeze((o.templates || []).map(Object.freeze)),
    lines: Object.freeze({
      offer: (o.lines && o.lines.offer) || 'There is work on the board.',
      accept: (o.lines && o.lines.accept) || 'Then it is yours.',
      done: (o.lines && o.lines.done) || 'It is done. You will be paid.',
    }),
  };
}

export const FACTION_CONTRACTS = deepFreeze({

  harpers: board('harpers', 'The Harpers', {
    short: 'Harpers', giver: 'sister-garaele', board: 'the Shrine of Luck, Phandalin',
    sigil: 'a silver harp between the horns of a crescent moon',
    creed: 'Watch, remember, and act only where it will matter. Power gathered in one place goes bad in that place.',
    ranks: ['Watcher', 'Harpshadow', 'Brightcandle', 'Wise Owl'],
    biomes: ['road', 'forest', 'pine-forest', 'ruins', 'city', 'hills', 'plains'],
    rivals: { zhentarim: -1 },
    repPer: 3, goldMult: 0.9, xpMult: 1.1,
    lines: {
      offer: 'A quiet word, and it stays quiet. Will you take it?',
      accept: 'Then walk softly, and come back and tell me everything.',
      done: 'Good. Nobody will ever know you did it. That is rather the point.',
    },
    rewards: [
      ['potion-healing', 1], ['cloak-common', 1], ['scroll-identify', 3],
      ['potion-greater-healing', 5], ['cloak-of-elvenkind', 5], ['boots-of-elvenkind', 5],
      ['sending-stones', 6], ['ring-of-mind-shielding', 8], ['pearl-of-power', 9],
      ['cloak-of-displacement', 12], ['gem-of-seeing', 13],
    ],
    templates: [
      tpl('harper-watch', {
        kind: 'recon', type: 'fetch', name: 'Eyes On', count: [2, 3],
        titles: ['Eyes {prep}', 'A Quiet Look {prep}', 'Watch and Remember: {place}'],
        desc: 'The Harpers want eyes {prep} and nothing more — no banners, no bodies left in the road. Walk it, count what is there, and come back able to describe it.',
        goldMult: 0.8, xpMult: 1, repMult: 1,
      }),
      tpl('harper-thread', {
        kind: 'kill', type: 'kill', name: 'Cut the Thread', count: [3, 5],
        titles: ['Cut the Thread: {band} {prep}', 'The Harpers Ask: {foes} {prep}'],
        desc: 'Somebody {prep} is gathering more than they can be trusted with. Cut the thread before the knot is tied — the {foes} first, and quietly.',
        types: ['humanoid', 'fiend', 'monstrosity'], goldMult: 1, xpMult: 1.1,
      }),
      tpl('harper-recover', {
        kind: 'collect', type: 'fetch', name: 'Quietly Recovered', count: [3, 4],
        titles: ['Quietly Recovered {prep}', 'What Was Taken {prep}'],
        desc: 'A thing that should not be in the hands it is in has turned up {prep}. Recover it. If it can be done without anyone noticing it was recovered, better still.',
        goldMult: 1.1, xpMult: 0.9,
      }),
      tpl('harper-name', {
        kind: 'boss', type: 'boss', name: 'A Name Out Of', count: [1, 1],
        titles: ['A Name Out of {place}', 'The One Who Speaks for the {band}'],
        desc: 'The Harpers have a name and half a face to go with it, and both are {prep}. Bring back the rest, or bring back proof there is nothing left to bring.',
        crShift: 1, goldMult: 1.3, xpMult: 1.3, repMult: 1.5,
      }),
    ],
  }),

  gauntlet: board('gauntlet', 'The Order of the Gauntlet', {
    short: 'Gauntlet', giver: 'daran-edermath', board: 'Edermath Orchard, Phandalin',
    sigil: 'a gauntleted fist upon a field of white',
    creed: 'Evil is not argued with. It is found, it is named, and it is put down before it can be excused.',
    ranks: ['Chevall', 'Marshal', 'Whitehawk', 'Vindicator'],
    biomes: ['ruins', 'crypt', 'dungeon', 'hills', 'mountain', 'ash-waste', 'cave'],
    rivals: { zhentarim: -1 },
    repPer: 3, goldMult: 1, xpMult: 1.15,
    lines: {
      offer: 'There is a thing that needs doing and no one else will do it. Sit. Listen first.',
      accept: 'Then go, and come back able to say what it cost.',
      done: 'It is done. The Order will hear your name said properly.',
    },
    rewards: [
      ['potion-healing', 1], ['holy-water', 2], ['shield', 2],
      ['mace-plus1', 4], ['potion-greater-healing', 5], ['shield-plus1', 6],
      ['periapt-of-wound-closure', 8], ['ring-of-protection', 10],
      ['mace-of-disruption', 12], ['holy-avenger', 17],
    ],
    templates: [
      tpl('gauntlet-purge', {
        kind: 'clear', type: 'clear', name: 'Purge the Lair', count: [1, 1],
        titles: ['Purge {place}', 'Cleanse {place}'],
        desc: 'The Order does not besiege. It goes in. Whatever has made a lair {prep} is to be put down entire, and the ground salted behind you.',
        crShift: 0.5, goldMult: 1.1, xpMult: 1.2, repMult: 1.2,
      }),
      tpl('gauntlet-bounty', {
        kind: 'kill', type: 'kill', name: 'Bounty', count: [5, 8],
        titles: ['Bounty: {band} {prep}', 'Bounty: {foes} {prep}'],
        desc: 'A standing bounty, posted plainly: {foes} {prep}, paid by the head, no questions about method and no excuses about numbers.',
        types: ['undead', 'fiend', 'aberration', 'monstrosity', 'humanoid'],
        goldMult: 1.1, xpMult: 1,
      }),
      tpl('gauntlet-judgement', {
        kind: 'boss', type: 'boss', name: "The Order's Judgement", count: [1, 1],
        titles: ["The Order's Judgement: {foe}", 'Judgement {prep}'],
        desc: 'The Order has heard the case and passed the sentence. What remains is the carrying out of it, {prep}, in daylight if it can be managed.',
        crShift: 1.5, goldMult: 1.4, xpMult: 1.4, repMult: 1.6,
        types: ['undead', 'fiend', 'dragon', 'giant'],
      }),
      tpl('gauntlet-relic', {
        kind: 'collect', type: 'fetch', name: 'Consecrate What Was Taken', count: [3, 5],
        titles: ['Consecrate What Was Taken {prep}', 'Reclaim the Holy Things {prep}'],
        desc: 'Things were taken from a shrine and carried {prep} by hands that had no right to them. Bring them back so they can be consecrated again.',
        goldMult: 0.9, xpMult: 1, repMult: 1.1,
      }),
    ],
  }),

  'emerald-enclave': board('emerald-enclave', 'The Emerald Enclave', {
    short: 'Enclave', giver: 'reidoth', board: 'the eaves of Neverwinter Wood',
    sigil: 'a green leaf on a grey field',
    creed: 'The wild is not yours and it is not your enemy. Keep the balance, and put back whatever you take out of it.',
    ranks: ['Springwarden', 'Summerstrider', 'Autumnreaver', 'Winterstalker'],
    biomes: ['forest', 'pine-forest', 'marsh', 'plains', 'hills', 'ash-waste', 'mountain', 'coast'],
    rivals: { zhentarim: -1 },
    repPer: 3, goldMult: 0.85, xpMult: 1.1,
    lines: {
      offer: 'The wood has a problem in it that the wood cannot solve alone. Rare, that. Listen.',
      accept: 'Then go. Carry your own water and do not light fires you cannot put out.',
      done: 'The balance holds a while longer. That is all any of us get.',
    },
    rewards: [
      ['goodberry-preserve', 1], ['potion-healing', 1], ['herbalism-kit', 2],
      ['potion-climbing', 3], ['staff-of-the-python', 5], ['cloak-of-the-manta-ray', 6],
      ['ring-of-animal-influence', 7], ['keoghtoms-ointment', 8],
      ['staff-of-the-woodlands', 11], ['ring-of-free-action', 12],
    ],
    templates: [
      tpl('enclave-cull', {
        kind: 'kill', type: 'kill', name: 'Cull', count: [6, 9],
        titles: ['Cull the {foes} {prep}', 'Too Many {foes} {prep}'],
        desc: 'There are too many {foes} {prep} and the ground cannot carry them. Cull them back to a number the land can feed, and no further than that.',
        types: ['beast', 'plant', 'monstrosity', 'aberration', 'ooze'],
        goldMult: 0.9, xpMult: 1,
      }),
      tpl('enclave-blight', {
        kind: 'clear', type: 'clear', name: 'The Blight', count: [1, 1],
        titles: ['The Blight {prep}', 'Burn It Back {prep}'],
        desc: 'Something has gone wrong {prep} in a way that spreads. Burn it back to clean ground, and be certain before you say it is finished.',
        biomes: ['forest', 'pine-forest', 'marsh', 'ash-waste'],
        crShift: 0.5, goldMult: 1, xpMult: 1.2, repMult: 1.2,
      }),
      tpl('enclave-restore', {
        kind: 'collect', type: 'fetch', name: 'Restore the Grove', count: [4, 6],
        titles: ['Restore the Grove {prep}', 'What the Wood Needs Back {prep}'],
        desc: 'A grove {prep} was stripped by people who did not intend to come back. The Enclave means to put it right, and putting it right takes carrying.',
        goldMult: 0.8, xpMult: 0.9,
      }),
      tpl('enclave-beast', {
        kind: 'boss', type: 'boss', name: 'The Great Beast', count: [1, 1],
        titles: ['The Great {foe} of {place}', 'The {foe} That Will Not Move On'],
        desc: 'One creature {prep} has grown past what the country can hold, and it will not be driven. The Enclave regrets this. It still has to be done.',
        types: ['beast', 'monstrosity', 'dragon', 'giant', 'plant'],
        crShift: 1.5, goldMult: 1.3, xpMult: 1.4, repMult: 1.5,
      }),
    ],
  }),

  'lords-alliance': board('lords-alliance', "The Lords' Alliance", {
    short: 'Alliance', giver: 'sildar-hallwinter', board: "the Townmaster's Hall, Phandalin",
    sigil: 'the crossed keys and sword of the allied cities',
    creed: 'Roads open, caravans moving, towns standing. Everything else the cities argue about afterwards.',
    ranks: ['Cloak', 'Redknife', 'Stingblade', 'Warduke'],
    biomes: ['road', 'plains', 'hills', 'city', 'coast', 'mountain', 'ruins'],
    rivals: { zhentarim: -2 },
    repPer: 3, goldMult: 1.15, xpMult: 1,
    lines: {
      offer: 'A commission, properly sealed, properly paid. The Alliance keeps its books.',
      accept: 'Good. The seal is your authority; try not to need it.',
      done: 'Recorded and paid. The road is open a little longer because of you.',
    },
    rewards: [
      ['potion-healing', 1], ['studded-leather', 2], ['chain-shirt', 3],
      ['longsword-plus1', 4], ['shield-plus1', 5], ['potion-greater-healing', 5],
      ['cloak-of-protection', 8], ['weapon-of-warning', 9],
      ['ring-of-protection', 11], ['dwarven-plate', 14],
    ],
    templates: [
      tpl('alliance-escort', {
        kind: 'escort', type: 'escort', name: 'Caravan Escort', count: [4, 6],
        titles: ['Caravan Escort: {place}', 'Wagons Through {place}'],
        desc: 'Wagons are going through {place} and the Alliance would prefer they arrive. Ride with them, and be visible about it — half of this work is being seen doing it.',
        biomes: ['road', 'plains', 'hills', 'coast'],
        goldMult: 1.2, xpMult: 0.95,
      }),
      tpl('alliance-open-road', {
        kind: 'clear', type: 'clear', name: 'Open the Road', count: [1, 1],
        titles: ['Open the Road {prep}', 'Clear the Way {prep}'],
        desc: 'The road {prep} has been closed by force for long enough that the caravan masters have started pricing it in. Open it, and keep it open a tenday.',
        crShift: 0.5, goldMult: 1.2, xpMult: 1.15, repMult: 1.2,
      }),
      tpl('alliance-bounty', {
        kind: 'kill', type: 'kill', name: 'Bounty', count: [5, 8],
        titles: ['Bounty: {band} {prep}', '{foes} {prep}'],
        desc: 'Posted under the Alliance seal: {band} {prep}, a standing danger to lawful traffic. Paid on proof, at the usual rate, without argument.',
        types: ['humanoid', 'monstrosity', 'giant', 'beast'],
        goldMult: 1.15, xpMult: 1,
      }),
      tpl('alliance-dispatch', {
        kind: 'recon', type: 'deliver', name: 'Dispatch', count: [2, 3],
        titles: ['Dispatch to {place}', 'Sealed Orders for {place}'],
        desc: 'Sealed orders for the Alliance post at {place}. Carry them, do not open them, and do not be the reason they arrive late.',
        goldMult: 1, xpMult: 0.9,
      }),
    ],
  }),

  zhentarim: board('zhentarim', 'The Zhentarim', {
    short: 'Black Network', giver: 'halia-thornton', board: "the Phandalin Miner's Exchange",
    sigil: 'a black winged serpent',
    creed: 'Everything has a price and everyone has a rate. The Network simply writes both down.',
    ranks: ['Fang', 'Wolf', 'Viper', 'Ardragon'],
    biomes: ['road', 'city', 'cave', 'mine', 'ruins', 'dungeon', 'underdark', 'hills'],
    rivals: { harpers: -2, 'lords-alliance': -1 },
    repPer: 3, goldMult: 1.35, xpMult: 0.95,
    lines: {
      offer: 'A matter of business. It pays better than the board at the Hall, and it is quieter.',
      accept: 'Then we have never spoken and you have never been here.',
      done: 'Weighed and paid. The Network remembers who is useful.',
    },
    rewards: [
      ['potion-healing', 1], ['thieves-tools', 1], ['poisoners-kit', 3],
      ['dagger-plus1', 3], ['dust-of-disappearance', 5], ['bag-of-holding', 6],
      ['cloak-of-elvenkind', 6], ['dagger-of-venom', 8],
      ['cape-of-the-mountebank', 10], ['ring-of-invisibility', 15],
    ],
    templates: [
      tpl('zhentarim-shipment', {
        kind: 'recon', type: 'deliver', name: 'Move the Goods', count: [2, 3],
        titles: ['Move the Goods {prep}', 'A Crate That Stays Shut: {place}'],
        desc: 'Something is going {prep} and it is not going to be opened, weighed or discussed. Deliver it, take the fee, and forget the road you took.',
        goldMult: 1.4, xpMult: 0.85,
      }),
      tpl('zhentarim-collection', {
        kind: 'kill', type: 'kill', name: 'A Word With', count: [4, 6],
        titles: ['A Word With the {band} {prep}', 'Collections {prep}'],
        desc: 'Certain parties {prep} have decided the Network is far away and slow. Correct the impression. The Network is neither.',
        types: ['humanoid', 'monstrosity'],
        goldMult: 1.35, xpMult: 0.95,
      }),
      tpl('zhentarim-acquisition', {
        kind: 'collect', type: 'fetch', name: 'Acquisition', count: [4, 6],
        titles: ['Acquisition: {item} {prep}', 'Off the Books {prep}'],
        desc: 'The Network has a buyer and no stock. There is stock {prep}, currently in the wrong hands. Change whose hands it is in.',
        goldMult: 1.4, xpMult: 0.9,
      }),
      tpl('zhentarim-silence', {
        kind: 'boss', type: 'boss', name: 'Silence', count: [1, 1],
        titles: ['Silence the {foe} {prep}', 'A Loose Tongue {prep}'],
        desc: 'Somebody {prep} has been talking about the Network to people who write things down. Halia Thornton is very sorry about it. She is also very clear.',
        crShift: 1, goldMult: 1.5, xpMult: 1.1, repMult: 1.4,
      }),
    ],
  }),
});

export const FACTION_IDS = Object.freeze(Object.keys(FACTION_CONTRACTS));

// ===========================================================================
// 7. THE ENDLESS BOARD — generateQuest
//
// Everything below is defensive by construction: a missing catalogue entry, an
// unwritten map module or a nonsense party level produces a duller contract,
// never an exception.
// ===========================================================================

/**
 * Accept an RNG instance, a numeric/string seed, or nothing. Never returns
 * null, so no caller has to guard.
 */
function toRNG(rngi) {
  if (rngi && typeof rngi.int === 'function' && typeof rngi.pick === 'function') return rngi;
  if (typeof rngi === 'number' || typeof rngi === 'string') {
    try { return makeRNG(rngi); } catch (e) { /* fall through */ }
  }
  return rng;
}

const IRREGULAR_PLURALS = Object.freeze({
  wolf: 'wolves', dwarf: 'dwarves', elf: 'elves', thief: 'thieves', man: 'men',
  woman: 'women', mouse: 'mice', ox: 'oxen', child: 'children', person: 'people',
  goose: 'geese', foot: 'feet', tooth: 'teeth', deer: 'deer', sheep: 'sheep',
});

/** "Wolf" -> "Wolves", "Ochre Jelly" -> "Ochre Jellies", "Swarm of Rats" -> "Swarms of Rats". */
function pluralize(name) {
  const s = String(name || '').trim();
  if (!s) return 'Creatures';
  // "Swarm of Rats" pluralises the head noun, not the tail.
  const ofAt = s.toLowerCase().indexOf(' of ');
  if (ofAt > 0) return pluralize(s.slice(0, ofAt)) + s.slice(ofAt);
  const parts = s.split(' ');
  const last = parts[parts.length - 1];
  const lower = last.toLowerCase();
  let out;
  if (IRREGULAR_PLURALS[lower]) {
    out = IRREGULAR_PLURALS[lower];
    if (last[0] === last[0].toUpperCase()) out = out[0].toUpperCase() + out.slice(1);
  } else if (/[^aeiou]y$/i.test(last)) out = last.slice(0, -1) + 'ies';
  else if (/(s|x|z|ch|sh)$/i.test(last)) out = last + 'es';
  else if (/fe$/i.test(last)) out = last.slice(0, -2) + 'ves';
  else if (/[^f]f$/i.test(last)) out = last.slice(0, -1) + 'ves';
  else out = last + 's';
  parts[parts.length - 1] = out;
  return parts.join(' ');
}

/** Collective nouns by creature type — "Orc Raiders", "Wolf Pack", "Skeleton Host". */
const BAND_WORDS = Object.freeze({
  humanoid: ['Raiders', 'Warband', 'Reavers', 'Marauders', 'Band'],
  beast: ['Pack', 'Hunters'],
  undead: ['Dead', 'Host', 'Restless'],
  monstrosity: ['Terror', 'Brood'],
  plant: ['Growth', 'Thicket'],
  ooze: ['Seep'],
  fiend: ['Incursion', 'Horde'],
  dragon: ['Flight', 'Brood'],
  giant: ['Raiders', 'Steading'],
  fey: ['Court', 'Revel'],
  aberration: ['Horror', 'Spawn'],
  construct: ['Watch', 'Sentinels'],
  elemental: ['Fury', 'Rift'],
  celestial: ['Choir'],
});

function bandName(m, r) {
  const nm = (m && m.name) || 'Raider';
  const words = BAND_WORDS[(m && m.type) || 'humanoid'] || BAND_WORDS.humanoid;
  const w = r.pick(words) || 'Band';
  return `${nm} ${w}`;
}

/** Fill {tokens} in a title or description pattern. Unknown tokens vanish. */
function fill(pattern, vars) {
  return String(pattern || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''))
    .replace(/\s{2,}/g, ' ').trim();
}

/** The CR band a party of `level` should be hunting. */
function crBandFor(level, shift) {
  const lo = Math.max(0, (level - 3) / 3 + (shift || 0) * 0.5);
  const hi = Math.max(lo + 0.5, level / 2 + 1 + (shift || 0));
  return [lo, hi];
}

/** Locations whose level band contains `level`; widened until something matches. */
function locationsFor(level, biomes) {
  const inBand = QUEST_LOCATIONS.filter((L) => level >= L.band[0] && level <= L.band[1]);
  const pool = inBand.length ? inBand : QUEST_LOCATIONS.slice();
  if (biomes && biomes.length) {
    const narrowed = pool.filter((L) => biomes.includes(L.biome));
    if (narrowed.length) return narrowed;
  }
  return pool;
}

/**
 * Creatures no faction would post a bounty on: harmless, benign, or on the
 * same side. A flumph is not a danger to the Sword Coast, and the Order of the
 * Gauntlet would be embarrassed to say otherwise in writing.
 */
const NOT_QUARRY = Object.freeze(new Set([
  'rat', 'bat', 'raven', 'mastiff', 'flumph', 'myconid-sprout', 'myconid-adult',
  'awakened-shrub', 'blink-dog', 'sprite', 'pixie', 'pseudodragon', 'giant-owl',
  'unicorn', 'couatl', 'treant', 'dryad', 'satyr', 'acolyte', 'guard',
]));

/** A creature that fits the biome, CR band and (if possible) the template's taste. */
function pickFoe(r, biome, crLo, crHi, types) {
  const usable = (ids) => (ids || []).filter((id) => MONSTERS[id] && !NOT_QUARRY.has(id));
  let pool = [];
  try { pool = usable(monstersByBiome(biome, crLo, crHi)); } catch (e) { pool = []; }
  if (types && types.length) {
    const narrowed = pool.filter((id) => types.includes(MONSTERS[id].type));
    if (narrowed.length) pool = narrowed;
  }
  if (!pool.length) {
    try { pool = usable(monstersByCR(crLo, crHi)); } catch (e) { pool = []; }
    if (types && types.length) {
      const narrowed = pool.filter((id) => types.includes(MONSTERS[id].type));
      if (narrowed.length) pool = narrowed;
    }
  }
  if (!pool.length) {
    try { pool = usable(monstersByCR(0, Math.max(1, crHi + 2))); } catch (e) { pool = []; }
  }
  const id = r.pick(pool);
  return id && MONSTERS[id] ? id : (MONSTERS.goblin ? 'goblin' : (Object.keys(MONSTERS)[0] || null));
}

/** An encounter pack suited to the biome and level, for 'clear' contracts. */
function pickPack(r, biome, level) {
  const keys = Object.keys(MONSTER_GROUPS || {}).filter((k) => {
    const g = MONSTER_GROUPS[k];
    if (!g) return false;
    if (g.biomes && g.biomes.length && !g.biomes.includes(biome)) return false;
    if (g.minLevel != null && level < g.minLevel - 2) return false;
    if (g.maxLevel != null && level > g.maxLevel + 3) return false;
    return true;
  });
  return keys.length ? MONSTER_GROUPS[r.pick(keys)] : null;
}

/** Haulable objects a contract can ask for. Filtered against the catalogue. */
const HAUL_ITEMS = Object.freeze(['gem-malachite', 'gem-quartz', 'gem-onyx', 'gem-amber',
  'gem-jade', 'gem-moonstone', 'ore-sample-phandalin', 'silver-ore-wave-echo',
  'platinum-ingot', 'coster-crate', 'goblin-totem', 'dragon-cult-token'].filter((id) => {
    try { return !!resolveItem(id); } catch (e) { return false; }
  }));

/** Two reward items at most, weighted toward the best the party has earned. */
function pickRewardItems(r, boardDef, level) {
  const table = (boardDef && boardDef.rewards) || [];
  const eligible = table.filter((e) => e && (e[1] || 1) <= level && (() => {
    try { return !!resolveItem(e[0]); } catch (err) { return false; }
  })());
  if (!eligible.length) return [];
  const chosen = [];
  const best = r.pickWeighted(eligible, (e) => 1 + (e[1] || 1));
  if (best) chosen.push(best[0]);
  if (r.chance(0.45)) {
    const second = r.pick(eligible);
    if (second && second[0] !== chosen[0]) chosen.push(second[0]);
  }
  return chosen;
}

let CONTRACT_SEQ = 0;

/**
 * Build an endless, scaled faction contract.
 *
 *   generateQuest(partyLevel, rngi) -> quest
 *
 * `rngi` may be an RNG from core/rng.js, a numeric or string seed, or omitted
 * (the global stream is used). The returned quest is a fresh, unfrozen object
 * carrying `generated: true`, which is what state.js looks for when it decides
 * to store the definition inside the save file.
 */
export function generateQuest(partyLevel = 1, rngi) {
  const r = toRNG(rngi);
  const level = clamp(Math.round(Number(partyLevel) || 1), 1, 30);

  try {
    // --- who is hiring ----------------------------------------------------
    const fid = r.pick(FACTION_IDS) || 'lords-alliance';
    const bd = FACTION_CONTRACTS[fid] || FACTION_CONTRACTS['lords-alliance'];
    const t = r.pick(bd.templates) || bd.templates[0];

    // --- where ------------------------------------------------------------
    const biomePool = (t.biomes && t.biomes.length) ? t.biomes : bd.biomes;
    const L = r.pick(locationsFor(level, biomePool)) || QUEST_LOCATIONS[0];

    // --- what -------------------------------------------------------------
    const [crLo, crHi] = crBandFor(level, t.crShift);
    const foeId = pickFoe(r, L.biome, crLo, crHi, t.types);
    const foe = MONSTERS[foeId] || null;
    const foeName = foe ? foe.name : 'Raider';
    const pack = t.kind === 'clear' ? pickPack(r, L.biome, level) : null;

    const vars = {
      foe: foeName,
      foes: pluralize(foeName),
      band: bandName(foe, r),
      place: L.name,
      prep: L.prep,
      pack: pack ? pack.name : pluralize(foeName),
      item: '',
    };

    // --- objectives -------------------------------------------------------
    const baseCount = r.int(t.count[0], t.count[1] || t.count[0]);
    const count = clamp(Math.round(baseCount * (1 + level / 40)), 1, 20);
    const steps = [];
    let haulId = null;

    if (t.kind === 'collect') {
      haulId = r.pick(HAUL_ITEMS) || null;
      let haulName = 'the goods';
      if (haulId) { try { haulName = itemName(haulId); } catch (e) { haulName = 'the goods'; } }
      vars.item = haulName;
      steps.push(reach(L.map, `Travel ${L.prep}`));
      if (haulId) steps.push(collect(haulId, count, `Recover ${count} ${pluralize(haulName)} ${L.prep}`, L.map));
      steps.push(kill(foeId, Math.max(2, Math.round(count / 2)), `Get past the ${vars.foes} holding them`, L.map));
      if (bd.giver) steps.push(deliver(bd.giver, `Deliver the haul to ${npcName(bd.giver)}`));
    } else if (t.kind === 'clear') {
      steps.push(reach(L.map, `Travel ${L.prep}`));
      steps.push(kill(foeId, count, `Break the ${vars.foes} ${L.prep}`, L.map));
      steps.push(clear(L.map, `Clear ${L.name} out entire`));
    } else if (t.kind === 'escort') {
      steps.push(reach(L.map, `Take the road ${L.prep}`));
      steps.push(kill(foeId, count, `Beat off the ${vars.foes} on the road`, L.map));
      if (bd.giver) steps.push(deliver(bd.giver, `Report the run to ${npcName(bd.giver)}`));
    } else if (t.kind === 'recon') {
      steps.push(reach(L.map, `Travel ${L.prep} and see it for yourself`));
      steps.push(kill(foeId, Math.max(1, Math.round(count / 2)), `Deal with the ${vars.foes} in the way`, L.map));
      if (bd.giver) steps.push(talk(bd.giver, `Report to ${npcName(bd.giver)}`));
    } else if (t.kind === 'boss') {
      steps.push(reach(L.map, `Travel ${L.prep}`));
      steps.push(kill(foeId, 1, `Bring down the ${foeName} ${L.prep}`, L.map));
      if (bd.giver) steps.push(deliver(bd.giver, `Bring the proof to ${npcName(bd.giver)}`));
    } else {
      steps.push(reach(L.map, `Travel ${L.prep}`));
      steps.push(kill(foeId, count, `Kill ${count} ${vars.foes} ${L.prep}`, L.map));
    }

    // --- purse ------------------------------------------------------------
    const w = t.kind === 'boss' ? 1.6 : 1;
    const xp = Math.max(20, Math.round(xpFor(level, w) * (t.xpMult || 1) * (bd.xpMult || 1) / 10) * 10);
    const gold = Math.max(5, Math.round(goldFor(level, w) * (t.goldMult || 1) * (bd.goldMult || 1) / 5) * 5);
    const repAmount = Math.max(1, Math.round(((bd.rep.perContract || 3) + Math.floor(level / 5) * (bd.rep.perTier || 1)) * (t.repMult || 1)));
    const rep = [{ id: fid, amount: repAmount }];
    for (const k of Object.keys(bd.rivals || {})) rep.push({ id: k, amount: bd.rivals[k] });

    const title = fill(r.pick(t.titles) || '{foes} {prep}', vars);
    const desc = fill(t.desc, vars);

    CONTRACT_SEQ = (CONTRACT_SEQ + 1) % 100000;
    const id = `contract-${fid}-${t.id}-${r.int(1000, 9999)}${CONTRACT_SEQ}`;

    return {
      id,
      title: title || `${vars.foes} ${L.prep}`,
      giver: bd.giver || null,
      type: t.type || 'kill',
      minLevel: level,
      desc: desc || `${bd.name} pays for work done ${L.prep}.`,
      summary: `${bd.short}: ${title}`,
      steps: steps.map(normStep).filter(Boolean),
      rewards: { xp, gold, items: itemList(pickRewardItems(r, bd, level)), rep },
      next: null,
      unlocks: [],
      repeatable: true,
      faction: fid,
      chain: null,
      after: [],
      requires: [],
      forbid: [],
      sets: [],
      map: L.map,
      turnIn: bd.giver || null,
      // --- procedural extras -------------------------------------------------
      generated: true,
      template: t.id,
      location: L.id,
      biome: L.biome,
      foe: foeId,
      pack: pack ? pack.id : null,
      board: bd.name,
      rank: rankFor(bd, level),
    };
  } catch (e) {
    // Absolute fallback: a plain bounty that cannot fail to build.
    const gold = goldFor(level, 1);
    return {
      id: `contract-fallback-${level}-${(CONTRACT_SEQ = (CONTRACT_SEQ + 1) % 100000)}`,
      title: 'Wolves on the Triboar Trail',
      giver: 'harbin-wester', type: 'kill', minLevel: level,
      desc: 'A standing bounty off the board at the Townmaster\'s Hall. The coin is real; the reading is on you.',
      summary: 'Clear the wolves off the Triboar Trail.',
      steps: [normStep(kill('wolf', 6, 'Kill six wolves on the Triboar Trail', 'triboar-trail'))],
      rewards: { xp: xpFor(level, 1), gold, items: [], rep: [{ id: 'lords-alliance', amount: 2 }] },
      next: null, unlocks: [], repeatable: true, faction: 'lords-alliance',
      chain: null, after: [], requires: [], forbid: [], sets: [],
      map: 'triboar-trail', turnIn: 'harbin-wester', generated: true,
      template: null, location: 'triboar-trail', biome: 'road', foe: 'wolf',
      pack: null, board: "The Lords' Alliance", rank: '',
    };
  }
}

/** The rank name a faction would use for a party of this level. */
function rankFor(bd, level) {
  const ranks = (bd && bd.ranks) || [];
  if (!ranks.length) return '';
  const i = clamp(Math.floor((level - 1) / 5), 0, ranks.length - 1);
  return ranks[i];
}

/** NPC display name, degrading to a title-cased id if npcs.js has no entry. */
function npcName(id) {
  const n = NPCS && NPCS[id];
  return (n && n.name) || titleCase(id);
}

// ===========================================================================
// 8. QUERIES
//
// Everything the dialogue tree, the journal and the contract board ask of this
// module. All of it tolerates a null state, an unknown id and a half-built
// save file, because all three happen.
// ===========================================================================

/** A quest definition by id, or null. */
export function getQuest(id) {
  if (!id) return null;
  return QUESTS[id] || null;
}

/** The player-facing title, degrading to a title-cased id. */
export function questTitle(id) {
  if (!id) return '';
  const q = QUESTS[id];
  if (q && q.title) return q.title;
  if (id && typeof id === 'object' && id.title) return id.title;
  return titleCase(String(id && id.id ? id.id : id));
}

/** The quest's short journal line, falling back to the first sentence of `desc`. */
export function questSummary(id) {
  const q = typeof id === 'object' && id ? id : QUESTS[id];
  if (!q) return '';
  if (q.summary) return q.summary;
  const d = String(q.desc || '');
  const stop = d.indexOf('. ');
  return stop > 0 ? d.slice(0, stop + 1) : d;
}

/**
 * Every quest a given NPC hands out. Honours both directions of the contract:
 * the quest's own `giver`, and the `quests` array data/npcs.js already ships
 * (Agatha and Hamun Kost each carry a quest whose primary giver is somebody
 * else, and both must still offer it).
 */
export function questsFor(npcId) {
  if (!npcId) return [];
  const seen = new Set();
  const out = [];
  const push = (id) => {
    if (!id || seen.has(id)) return;
    const q = QUESTS[id];
    if (!q) return;
    seen.add(id);
    out.push(q);
  };
  const npc = NPCS && NPCS[npcId];
  for (const id of (npc && npc.quests) || []) push(id);
  for (const id of QUEST_IDS) {
    const q = QUESTS[id];
    if (q.giver === npcId || q.turnIn === npcId) push(id);
  }
  out.sort((a, b) => (a.minLevel - b.minLevel) || a.id.localeCompare(b.id));
  return out;
}

/** Which named arc a quest belongs to, or null. */
export function chainOf(id) {
  const q = QUESTS[id];
  if (q && q.chain && QUEST_CHAINS[q.chain]) return QUEST_CHAINS[q.chain];
  for (const cid of QUEST_CHAIN_IDS) {
    if (QUEST_CHAINS[cid].quests.includes(id)) return QUEST_CHAINS[cid];
  }
  return null;
}

/** The next quest in the spine, as a definition. */
export function nextQuest(id) {
  const q = QUESTS[id];
  return q && q.next ? (QUESTS[q.next] || null) : null;
}

/** Everything a quest opens up when it is finished: its `next` plus `unlocks`. */
export function questUnlocks(id) {
  const q = QUESTS[id];
  if (!q) return [];
  const ids = [];
  if (q.next) ids.push(q.next);
  for (const u of q.unlocks) if (!ids.includes(u)) ids.push(u);
  return ids.filter((i) => !!QUESTS[i]);
}

/** All the repeatable contract quests belonging to a faction board. */
export function questsForFaction(fid) {
  if (!fid) return [];
  return QUEST_IDS.map((id) => QUESTS[id]).filter((q) => q.faction === fid);
}

// --- state helpers ---------------------------------------------------------

function flagOn(st, name) {
  if (!name) return true;
  if (!st) return false;
  const f = st.flags;
  if (f && f[name]) return true;
  // A completed quest counts as its own flag, which keeps `requires` readable.
  return !!(st.quests && Array.isArray(st.quests.done) && st.quests.done.includes(name));
}

function doneSet(st) {
  const s = new Set();
  const d = st && st.quests && st.quests.done;
  if (Array.isArray(d)) for (const id of d) s.add(id);
  return s;
}

function activeSet(st) {
  const s = new Set();
  const a = st && st.quests && st.quests.active;
  if (Array.isArray(a)) for (const q of a) if (q && q.id) s.add(q.id);
  return s;
}

/**
 * Every hand-written quest the party could take right now.
 *
 *   availableQuests(state, partyLevel) -> quest[]
 *
 * Filters on level, on quests already active or finished, on prerequisite
 * quests (`after`) and on world flags (`requires` / `forbid`). Sorted so the
 * main chain floats to the top of a board.
 */
export function availableQuests(state, partyLevel = 1) {
  const st = state || null;
  const lvl = clamp(Math.round(Number(partyLevel) || 1), 1, 30);
  const done = doneSet(st);
  const active = activeSet(st);
  const out = [];

  for (const id of QUEST_IDS) {
    const q = QUESTS[id];
    if (!q) continue;
    if (active.has(id)) continue;
    if (done.has(id) && !q.repeatable) continue;
    if (q.minLevel > lvl) continue;
    let ok = true;
    for (const a of q.after) if (!done.has(a)) { ok = false; break; }
    if (!ok) continue;
    for (const f of q.requires) if (!flagOn(st, f)) { ok = false; break; }
    if (!ok) continue;
    for (const f of q.forbid) if (flagOn(st, f)) { ok = false; break; }
    if (!ok) continue;
    out.push(q);
  }

  out.sort((a, b) => {
    const ac = a.chain ? 0 : 1, bc = b.chain ? 0 : 1;
    if (ac !== bc) return ac - bc;
    if (a.minLevel !== b.minLevel) return a.minLevel - b.minLevel;
    return a.id.localeCompare(b.id);
  });
  return out;
}

/** The subset of `availableQuests` a particular NPC would actually offer. */
export function availableQuestsFrom(npcId, state, partyLevel = 1) {
  const offered = new Set(questsFor(npcId).map((q) => q.id));
  return availableQuests(state, partyLevel).filter((q) => offered.has(q.id));
}

/** Roll a fresh board of contracts — the never-ending content, per SPEC §8. */
export function generateContractBoard(partyLevel = 1, count = 4, rngi) {
  const r = toRNG(rngi);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < Math.max(1, count | 0) * 3 && out.length < Math.max(1, count | 0); i++) {
    const q = generateQuest(partyLevel, r);
    if (!q || seen.has(q.title)) continue;
    seen.add(q.title);
    out.push(q);
  }
  return out;
}

// ===========================================================================
// 9. SELF-CHECK
//
// Called by dev.html and by nothing else. Returns a list of problems rather
// than throwing, so a half-finished catalogue is diagnosable in the browser.
// ===========================================================================

export function validateQuests() {
  const problems = [];
  const npcIds = new Set(Object.keys(NPCS || {}));

  for (const id of QUEST_IDS) {
    const q = QUESTS[id];
    if (q.giver && npcIds.size && !npcIds.has(q.giver)) problems.push(`${id}: giver "${q.giver}" is not in NPCS`);
    if (q.next && !QUESTS[q.next]) problems.push(`${id}: next "${q.next}" does not exist`);
    for (const u of q.unlocks) if (!QUESTS[u]) problems.push(`${id}: unlocks "${u}" does not exist`);
    for (const a of q.after) if (!QUESTS[a]) problems.push(`${id}: after "${a}" does not exist`);
    if (!q.steps.length) problems.push(`${id}: has no steps`);
    for (const s of q.steps) {
      if (s.kind === 'kill' && s.target && !MONSTERS[s.target]) problems.push(`${id}: kill target "${s.target}" is not a monster`);
      if (s.kind === 'collect' && s.target) {
        let ok = false;
        try { ok = !!resolveItem(s.target); } catch (e) { ok = false; }
        if (!ok) problems.push(`${id}: collect target "${s.target}" is not an item`);
      }
      if ((s.kind === 'talk' || s.kind === 'deliver' || s.kind === 'escort') && s.target && npcIds.size && !npcIds.has(s.target)) {
        problems.push(`${id}: ${s.kind} target "${s.target}" is not in NPCS`);
      }
    }
    for (const it of q.rewards.items) {
      let ok = false;
      try { ok = !!resolveItem(it.id); } catch (e) { ok = false; }
      if (!ok) problems.push(`${id}: reward item "${it.id}" does not resolve`);
    }
  }

  // Every quest an NPC advertises must exist here.
  for (const nid of npcIds) {
    for (const qid of (NPCS[nid].quests || [])) {
      if (!QUESTS[qid]) problems.push(`npcs.js ${nid} offers "${qid}", which quests.js does not define`);
    }
  }

  for (const cid of QUEST_CHAIN_IDS) {
    for (const qid of QUEST_CHAINS[cid].quests) {
      if (!QUESTS[qid]) problems.push(`chain ${cid}: "${qid}" does not exist`);
    }
  }

  for (const bid of FACTION_IDS) {
    const bd = FACTION_CONTRACTS[bid];
    if (bd.giver && npcIds.size && !npcIds.has(bd.giver)) problems.push(`board ${bid}: giver "${bd.giver}" is not in NPCS`);
    if (!bd.templates.length) problems.push(`board ${bid}: has no templates`);
    for (const e of bd.rewards) {
      let ok = false;
      try { ok = !!resolveItem(e[0]); } catch (err) { ok = false; }
      if (!ok) problems.push(`board ${bid}: reward "${e[0]}" does not resolve`);
    }
  }

  return problems;
}

export function questCount() { return QUEST_IDS.length; }
