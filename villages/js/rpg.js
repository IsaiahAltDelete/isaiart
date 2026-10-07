// Ability scores, hit points, combat, the forge, the spell book's rules and adventuring
// parties. D&D 5e flavoured: the spells, monsters and core rules (d20 + modifier against
// armour class, saving throws, spell slots) come from the System Reference Document 5.1
// (CC-BY-4.0), retold in our own words. Kept cozy: nobody dies in a fight. They're knocked
// out, helped home, and rest up by the fire.
// No DOM in here. installRpg(Sim) adds the rpg* methods to the simulation.
import { BEASTS, SPELLS, RARE, DECOR, GOODS } from './data.js';
import { toTile } from './world.js';
import { mulberry32 } from './rng.js';
import { stageOf, lvlOf, DAY } from './sim.js';

// ── dice ──
export const roll = (r, n, sides) => { let t = 0; for (let i = 0; i < n; i++) t += 1 + ((r() * sides) | 0); return t; };
export const dice = str => { const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(str); return { n: +m[1], s: +m[2], b: +(m[3] || 0) }; };
export const diceStr = dd => `${dd.n}d${dd.s}${dd.b ? (dd.b > 0 ? '+' : '') + dd.b : ''}`;
const rollD = (r, dd, crit = false) => roll(r, dd.n * (crit ? 2 : 1), dd.s) + dd.b;
const d20 = (r, adv = 0) => { const a = 1 + ((r() * 20) | 0); if (!adv) return a; const b = 1 + ((r() * 20) | 0); return adv > 0 ? Math.max(a, b) : Math.min(a, b); };
const first = v => v.name.split(' ')[0];

// ── the six abilities ──
export const ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABIL_INFO = {
  str: { short: 'STR', name: 'Strength',     desc: 'Muscle and grit: felling trees, hauling stone, swinging a sword.' },
  dex: { short: 'DEX', name: 'Dexterity',    desc: 'Quick hands and light feet: baking, weaving, archery, and dodging blows (it adds to armour class).' },
  con: { short: 'CON', name: 'Constitution', desc: 'Stamina and health: more hit points, and long days in the fields without flagging.' },
  int: { short: 'INT', name: 'Intelligence', desc: 'Book learning: wizards, teachers, brewers and smiths who follow recipes.' },
  wis: { short: 'WIS', name: 'Wisdom',       desc: 'Patience and good sense: farmers, foragers, fishers and beekeepers, and clerics\' healing.' },
  cha: { short: 'CHA', name: 'Charisma',     desc: 'Warmth and confidence: merchants, innkeepers, teachers, and bards who talk their way out of trouble.' },
};
export const mod = sc => Math.floor(((sc ?? 10) - 10) / 2);
export const fmtMod = m => (m >= 0 ? '+' : '−') + Math.abs(m);
export const prof = L => 2 + Math.floor(((L || 1) - 1) / 4);
export const xpToNext = L => 50 * (L || 1);

// 4d6, drop the lowest, six times
export function rollScores(r) {
  const o = {};
  for (const k of ABIL) { const d = [0, 0, 0, 0].map(() => 1 + ((r() * 6) | 0)).sort((a, b) => a - b); o[k] = d[1] + d[2] + d[3]; }
  return o;
}
// a child takes after both parents, give or take a little
export function inheritScores(a, b, r) {
  const o = {};
  for (const k of ABIL) o[k] = Math.max(3, Math.min(18, Math.round((a[k] + b[k]) / 2 + (r() * 4 - 2))));
  return o;
}

// which abilities each job leans on: [primary, secondary]
export const JOB_ABIL = {
  acolyte:['wis','cha'], trainer:['str','con'], scout:['dex','wis'], locksmith:['dex','int'],
  barkeep: ['cha', 'wis'], attendant: ['con', 'wis'], bard: ['cha', 'dex'], constable: ['wis', 'str'],
  professor: ['int', 'cha'], student: ['int', 'wis'], scholar: ['int', 'wis'],
  builder: ['str', 'con'], woodcutter: ['str', 'con'], forager: ['wis', 'dex'], farmer: ['con', 'wis'], sawyer: ['str', 'dex'],
  miner: ['str', 'con'], fisher: ['wis', 'dex'], merchant: ['cha', 'int'], forester: ['wis', 'con'], miller: ['con', 'str'],
  baker: ['dex', 'wis'], mason: ['str', 'int'], herder: ['wis', 'cha'], picker: ['dex', 'con'], beekeeper: ['wis', 'dex'],
  shepherd: ['wis', 'cha'], weaver: ['dex', 'int'], milker: ['con', 'wis'], cheesemaker: ['int', 'wis'], brewer: ['int', 'con'],
  innkeeper: ['cha', 'wis'], teacher: ['int', 'cha'], guard: ['str', 'dex'], wizard: ['int', 'wis'], smith: ['str', 'int'],
  scribe: ['int', 'dex'], enchanter: ['int', 'cha'],
};
// work speed: +5% per point of the primary ability's modifier, +2% per point of the secondary's
export function abilityWorkMult(v, job) {
  const ja = JOB_ABIL[job];
  if (!ja || !v.abil) return 1;
  return Math.max(0.75, Math.min(1.3, 1 + 0.05 * mod(v.abil[ja[0]]) + 0.02 * mod(v.abil[ja[1]])));
}
export function jobFit(v, job) { const ja = JOB_ABIL[job]; return ja && v.abil ? 2 * mod(v.abil[ja[0]]) + mod(v.abil[ja[1]]) : 0; }
export function fitLabel(f) { return f >= 6 ? { n: 3, name: 'Great fit' } : f >= 3 ? { n: 2, name: 'Good fit' } : f >= 0 ? { n: 1, name: 'Fair fit' } : { n: 0, name: 'Poor fit' }; }
export const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);

// ── classes: what kind of adventurer someone would be, from their best abilities ──
export const CLASSES = {
  fighter: { name: 'Fighter', icon: 'sword',  hd: 10, w: { str: 2, con: 1 }, saves: ['str', 'con'], gear: { w: ['sword'], a: 1, s: 1 },
             desc: 'A front-line sword arm with a d10 hit die. Wears armour and a shield, and catches a Second Wind once per fight.' },
  ranger:  { name: 'Ranger',  icon: 'bow',    hd: 10, w: { dex: 1.4, wis: 1.4, con: 0.3 }, saves: ['str', 'dex'], gear: { w: ['bow', 'sword'], a: 1 },
             desc: 'A woodland archer with a d10 hit die. Shoots a longbow and finds the safe path through the wilds.' },
  rogue:   { name: 'Rogue',   icon: 'bow',    hd: 8,  w: { dex: 2, int: 0.5, cha: 0.5 }, saves: ['dex', 'int'], gear: { w: ['bow', 'sword'], a: 1 },
             desc: 'Quick and sneaky. Adds Sneak Attack dice whenever a friend is in the fight, and is good with locks and traps.' },
  wizard:  { name: 'Wizard',  icon: 'staff',  hd: 6,  w: { int: 2, dex: 0.5, con: 0.5 }, saves: ['int', 'wis'], gear: { w: ['staff'] },
             desc: 'Hurls Fire Bolt (d10) from the back row. Fragile (d6 hit die) and can\'t wear armour, but a staff sharpens the magic.' },
  cleric:  { name: 'Cleric',  icon: 'heart',  hd: 8,  w: { wis: 2, con: 0.5, str: 0.5 }, saves: ['wis', 'cha'], gear: { w: ['staff', 'sword'], a: 1, s: 1 },
             desc: 'Calls down Sacred Flame and patches friends up with Cure Wounds when they get hurt.' },
  paladin: { name: 'Paladin', icon: 'shield', hd: 10, w: { str: 1.4, cha: 1.4, con: 0.4 }, saves: ['wis', 'cha'], gear: { w: ['sword'], a: 1, s: 1 },
             desc: 'A holy warrior with a d10 hit die, armour and shield. Divine Smite adds 2d8 radiant damage to a hit once a fight, and Lay on Hands heals a friend.' },
  commoner: { name: 'Commoner', icon: 'person', hd: 8, w: {}, saves: [], gear: { w: ['sword'] },
             desc: 'An ordinary villager with no adventuring training: a d8 hit die and a club. Joining a guild party, the watch or a wizard tower trains them into a class.' },
  bard:    { name: 'Bard',    icon: 'party',  hd: 8,  w: { cha: 2, dex: 1 }, saves: ['dex', 'cha'], gear: { w: ['sword'], a: 1 },
             desc: 'Stings foes with Vicious Mockery, heals with Healing Word, and is the one who does the talking.' },
};
// Everyone starts as a Commoner. A villager earns a real class by training for it:
// joining a guild party (their best-fit class), the watch (fighter or ranger), or a
// wizard tower or the Arcane University (wizard). aptitudeOf() is that best fit.
export function classOf(v) { return v.cls && CLASSES[v.cls] ? v.cls : 'commoner'; }
export function aptitudeOf(v, among = null) {
  let best = 'fighter', bs = -1e9;
  for (const [k, c] of Object.entries(CLASSES)) {
    if (k === 'commoner' || (among && !among.includes(k))) continue;
    let sc = 0, wt = 0;
    for (const [a, w] of Object.entries(c.w)) { sc += (v.abil?.[a] ?? 10) * w; wt += w; }
    sc /= wt;
    if (sc > bs + 1e-9) { bs = sc; best = k; }
  }
  return best;
}
// hit points: a full hit die at level 1, then the average roll each level, plus CON each time
export function maxHp(v) {
  const c = CLASSES[classOf(v)], L = v.lvl || 1, cm = mod(v.abil?.con);
  let hp = Math.max(4, c.hd + cm + (L - 1) * (c.hd / 2 + 1 + cm));
  if (v.age !== undefined && stageOf(v) === 'child') hp = Math.max(3, Math.round(hp / 2));
  return Math.round(hp);
}
// armour class: 10 + DEX, a chain shirt is 13 + DEX (max +2), a shield adds 2, Mage Armor is 13 + DEX
export function armorClass(v, buffs = {}, now = 0) {
  const dm = mod(v.abil?.dex), g = v.gear || {}, wiz = classOf(v) === 'wizard';
  let ac = 10 + dm;
  if (g.a && !wiz) ac = 13 + Math.min(2, dm);
  else if ((buffs.magearmor || 0) > now) ac = 13 + dm;
  if (g.s && !wiz) ac += 2;
  if (g.m === 'amulet') ac += 1;            // Warding Amulet (magic.js)
  return ac;
}
// a guard's swing (melee, off the tower) or shot (ranged, from the tower)
export function guardAttack(v, mode) {
  const P = prof(v.lvl), g = v.gear || {};
  if (mode === 'melee') {
    const m = mod(v.abil?.str), rb = g.m === 'runeblade' ? 1 : 0;   // a Runeblade: +1 to hit, +2 damage
    if (rb) return { name: 'runeblade', bonus: P + m + 1 + rb, dmg: { n: 1, s: 8, b: m + 1 + 2 * rb } };
    return g.w === 'sword' ? { name: 'longsword', bonus: P + m + 1, dmg: { n: 1, s: 8, b: m + 1 } } : { name: 'spear', bonus: P + m, dmg: { n: 1, s: 6, b: m } };
  }
  const m = mod(v.abil?.dex);
  return g.w === 'bow' ? { name: 'longbow', bonus: P + m + 1, dmg: { n: 1, s: 8, b: m + 1 } } : { name: 'shortbow', bonus: P + m, dmg: { n: 1, s: 6, b: m } };
}
// an adventurer's best move each round
// magic items (magic.js). A Wand sharpens spells: +1 to hit (or to the save DC) and +2 damage. A Runeblade
// is an enchanted longsword: in melee it's swung with longsword dice (finesse, so DEX fighters use DEX),
// +1 to hit and +2 damage on top. Bows and spells don't use it.
const SPELL_CLS = { wizard: true, cleric: true };
export const isSpell = (a, cls) => !!a.save || !!SPELL_CLS[cls];
export function classAttack(v, cls = classOf(v)) {
  const a = baseAttack(v, cls), m = v.gear?.m;
  if (m === 'wand' && isSpell(a, cls)) {
    const out = { ...a, dmg: { ...a.dmg, b: a.dmg.b + 2 } };
    if (a.save) out.dc = a.dc + 1; else out.bonus = a.bonus + 1;
    return out;
  }
  if (m === 'runeblade' && !isSpell(a, cls) && !a.ranged) {
    const am = mod(v.abil?.[a.k || 'str']), P = prof(v.lvl || 1);
    return { name: 'runeblade', k: a.k, bonus: P + am + 2, dmg: { n: 1, s: 8, b: am + 3 } };
  }
  return a;
}
function baseAttack(v, cls) {
  const L = v.lvl || 1, P = prof(L), g = v.gear || {}, am = k => mod(v.abil?.[k]), tier = L >= 5 ? 2 : 1;
  const melee = (name, k, s, fine) => ({ name, k, ranged: /bow/.test(name), bonus: P + am(k) + (fine ? 1 : 0), dmg: { n: 1, s, b: am(k) + (fine ? 1 : 0) } });
  switch (cls) {
    case 'fighter': return g.w === 'sword' ? melee('longsword', 'str', 8, true) : melee('handaxe', 'str', 6);
    case 'ranger': return g.w === 'bow' ? melee('longbow', 'dex', 8, true) : g.w === 'sword' ? melee('shortsword', 'dex', 8, true) : melee('shortbow', 'dex', 6);
    case 'rogue': return g.w === 'bow' ? melee('longbow', 'dex', 8, true) : g.w === 'sword' ? melee('rapier', 'dex', 8, true) : melee('dagger', 'dex', 4);
    case 'bard': return g.w === 'sword' ? melee('rapier', 'dex', 8, true) : { name: 'Vicious Mockery', save: 'wis', dc: 8 + P + am('cha'), dmg: { n: tier, s: 4, b: 0 } };
    case 'wizard': return { name: 'Fire Bolt', bonus: P + am('int') + (g.w === 'staff' ? 1 : 0), dmg: { n: tier, s: 10, b: g.w === 'staff' ? 1 : 0 } };
    case 'paladin': return melee('longsword', 'str', 8, true);
    case 'cleric': return { name: 'Sacred Flame', save: 'dex', dc: 8 + P + am('wis') + (g.w === 'staff' ? 1 : 0), dmg: { n: tier, s: 8, b: g.w === 'staff' ? 1 : 0 } };
  }
  return melee('club', 'str', 4);
}

// ── night beasts, with real stat blocks ──
export const BEAST_STATS = {
  wolf:   { ac: 13, hp: 11, atk: 4, dmg: '2d4+2', dex: 2, attack: 'bite' },
  boar:   { ac: 11, hp: 11, atk: 3, dmg: '1d6+1', dex: 0, attack: 'tusk' },
  goblin: { ac: 15, hp: 7,  atk: 4, dmg: '1d6+2', dex: 2, attack: 'scimitar' },
};
export const MORALE = 0.4;     // beasts flee once they're down to 40% of their hit points
export const beastStats = kind => BEAST_STATS[kind] || { ac: 12, hp: Math.max(6, (BEASTS[kind]?.hp || 3) * 2), atk: 3, dmg: '1d6', dex: 1, attack: 'bite' };

// ── monsters met on expeditions ──
export const MONSTERS = {
  rat:      { name: 'giant rat', plural: 'giant rats', ac: 12, hp: 7, atk: 4, dmg: '1d4+2', sv: 2, beaten: 'sent the giant rats squeaking off into the reeds' },
  skeleton: { name: 'skeleton', plural: 'skeletons', ac: 13, hp: 13, atk: 4, dmg: '1d6+2', sv: 2, beaten: 'clattered the skeletons back into their alcoves' },
  goblin:   { name: 'goblin', plural: 'goblins', ac: 15, hp: 7, atk: 4, dmg: '1d6+2', sv: 2, beaten: 'sent the goblins scampering down their burrows' },
  kobold:   { name: 'kobold', plural: 'kobolds', ac: 12, hp: 5, atk: 4, dmg: '1d4+2', sv: 2, beaten: 'chased the yapping kobolds out of the mine' },
  bandit:   { name: 'bandit', plural: 'bandits', ac: 12, hp: 11, atk: 3, dmg: '1d6+1', sv: 1, beaten: 'disarmed the bandits and marched them off to the reeve' },
  spider:   { name: 'giant spider', plural: 'giant spiders', ac: 14, hp: 26, atk: 5, dmg: '1d8+3', sv: 3, beaten: 'drove the giant spider back up into the dead trees' },
  wisp:     { name: 'will-o\'-wisp', plural: 'will-o\'-wisps', ac: 19, hp: 22, atk: 4, dmg: '2d8', sv: 9, beaten: 'snuffed out the will-o\'-wisp\'s glow' },
  owlbear:  { name: 'owlbear', plural: 'owlbears', ac: 13, hp: 59, atk: 7, dmg: '2d8+5', sv: 1, beaten: 'sent the owlbear hooting back into the hollow' },
  ogre:     { name: 'ogre', plural: 'ogres', ac: 11, hp: 59, atk: 6, dmg: '2d8+4', sv: -1, beaten: 'bonked the ogre until it sat down and agreed to go home' },
};

// ── expeditions from the Guild Hall ──
// steps: fight (foe × n), save (everyone rolls; failures take damage), check (the best person
// rolls; success adds loot, and "skip" avoids the next fight). Rewards are ranges.
export const EXPEDITIONS = [
  { id: 'mill', name: 'The Sunken Mill', icon: 'flour', lvl: 1, days: 0.5,
    blurb: 'Giant rats have moved into a flooded old mill downriver. The miller would be ever so grateful.',
    steps: [
      { kind: 'fight', foe: 'rat', n: 2, text: 'Two giant rats burst out of the soggy flour sacks!' },
      { kind: 'check', abil: 'int', dc: 10, text: 'Behind the millstone sits a rusty lockbox.', win: 'worked the lock open', lose: 'couldn\'t budge the lockbox', loot: { coins: 30 } },
      { kind: 'fight', foe: 'rat', n: 2, text: 'The rest of the rat family wants a word.' },
    ], reward: { coins: [40, 70], food: [20, 40], xp: 50 } },
  { id: 'warren', name: 'Goblin Warren at Fernhill', icon: 'coin', lvl: 2, days: 1,
    blurb: 'Goblins have been pinching coins from the villages. Their warren is under Fernhill.',
    steps: [
      { kind: 'save', abil: 'dex', dc: 12, dmg: '1d6', text: 'A snare trap snaps shut across the path!', pass: 'hopped clear', fail: 'got tangled up' },
      { kind: 'fight', foe: 'goblin', n: 3, text: 'Goblins pour out of a burrow, waving rusty scimitars!' },
      { kind: 'check', abil: 'cha', dc: 12, text: 'The goblin boss glares from a throne of stolen chairs.', win: 'talked the boss into handing back the stolen coins', lose: 'got nothing out of the boss but a raspberry', loot: { coins: 80 } },
    ], reward: { coins: [90, 150], xp: 100 } },
  { id: 'barrow', name: 'The Whispering Barrow', icon: 'moon', lvl: 2, days: 1,
    blurb: 'Something rattles inside the old hill grave at night. Bring a lantern.',
    steps: [
      { kind: 'save', abil: 'wis', dc: 11, dmg: '1d6', text: 'Eerie whispers curl out of the dark…', pass: 'kept their nerve', fail: 'got the shivers' },
      { kind: 'fight', foe: 'skeleton', n: 2, text: 'Two skeletons climb out of their alcoves.' },
      { kind: 'check', abil: 'int', dc: 12, text: 'Old runes circle the burial chamber.', win: 'read the runes and found a hidden niche (and a cache of glowing crystals)', lose: 'couldn\'t make sense of the runes', loot: { gems: 3, crystal: 2 } },
    ], reward: { coins: [60, 110], gems: [2, 4], crystal: [1, 3], xp: 110 } },
  { id: 'bridge', name: 'The Toll Bridge', icon: 'shield', lvl: 3, days: 1,
    blurb: 'Bandits are charging travellers to cross the old stone bridge on the east road.',
    steps: [
      { kind: 'check', abil: 'cha', dc: 13, skip: true, text: 'Four bandits block the bridge, demanding a toll.', win: 'talked the bandits into leaving (and handing back the tolls)', lose: 'tried talking, but the bandits just laughed', loot: { coins: 60 } },
      { kind: 'fight', foe: 'bandit', n: 4, text: 'Swords out: the bandits charge!' },
      { kind: 'check', abil: 'wis', dc: 11, text: 'Their hideout must be somewhere under the bridge.', win: 'spotted the hideout behind a curtain of ivy', lose: 'searched until dark and found only frogs', loot: { iron: 4, coins: 50 } },
    ], reward: { coins: [140, 220], iron: [2, 5], xp: 150 } },
  { id: 'mine', name: 'The Old Dwarf Mine', icon: 'pick', lvl: 3, days: 1.5,
    blurb: 'An abandoned mine in the hills, still rich with iron. And kobolds.',
    steps: [
      { kind: 'save', abil: 'dex', dc: 13, dmg: '2d6', text: 'Rocks tumble from the tunnel roof!', pass: 'dived out of the way', fail: 'got bonked' },
      { kind: 'fight', foe: 'kobold', n: 5, text: 'A pack of kobolds yaps in the lamplight.' },
      { kind: 'check', abil: 'str', dc: 13, text: 'A seam of ore glints behind a rubble pile.', win: 'heaved the rubble aside', lose: 'couldn\'t shift the rubble', loot: { ore: 20 } },
    ], reward: { ore: [20, 35], iron: [4, 8], gems: [2, 5], crystal: [2, 5], xp: 170 } },
  { id: 'marsh', name: 'Wisp Marsh', icon: 'lantern', lvl: 4, days: 1.5,
    blurb: 'Lights dance over the marsh at night. They say a merchant\'s caravan sank there, treasure and all.',
    steps: [
      { kind: 'check', abil: 'wis', dc: 13, text: 'Bog and mist in every direction.', win: 'found the safe path through the bog', lose: 'got everyone soaked to the knees' },
      { kind: 'fight', foe: 'spider', n: 1, text: 'A giant spider drops from the dead trees!' },
      { kind: 'fight', foe: 'wisp', n: 1, text: 'A will-o\'-wisp flickers out of the fog.' },
      { kind: 'check', abil: 'int', dc: 13, text: 'The caravan\'s strongbox lies half sunk in the mud.', win: 'worked out the old lock', lose: 'had to leave the strongbox to the bog', loot: { gems: 5 } },
    ], reward: { gems: [5, 9], coins: [80, 140], crystal: [3, 6], rare: 0.5, xp: 230 } },
  { id: 'owlbear', name: 'Owlbear Hollow', icon: 'leaf', lvl: 5, days: 1.5,
    blurb: 'An owlbear keeps raiding the woodcutters\' camps. Very fluffy. Very cross.',
    steps: [
      { kind: 'check', abil: 'wis', dc: 13, text: 'Huge clawed tracks lead off the path.', win: 'tracked the owlbear to its den, finding its stash of stolen picnics', lose: 'lost the trail twice', loot: { food: 30 } },
      { kind: 'save', abil: 'con', dc: 12, dmg: '1d6', text: 'The den smells… powerful.', pass: 'held their noses', fail: 'felt quite ill' },
      { kind: 'fight', foe: 'owlbear', n: 1, text: 'The owlbear rears up with a furious HOOT!' },
    ], reward: { coins: [180, 280], food: [40, 70], rare: 0.3, xp: 300 } },
  { id: 'dragon', name: 'The Dragon\'s Nap', icon: 'gem', lvl: 7, days: 2,
    blurb: 'A young green dragon sleeps on a heap of gold in the far hills. Tiptoe in, grab what you can, tiptoe out.',
    steps: [
      { kind: 'fight', foe: 'ogre', n: 2, text: 'Two ogres guard the valley pass.' },
      { kind: 'check', abil: 'dex', dc: 15, text: 'The dragon snores atop its hoard.', win: 'tiptoed in and filled every pocket', lose: 'stepped on a goblet with a terrible CLANG', loot: { gems: 15, coins: 300 },
        onFail: { kind: 'save', abil: 'con', dc: 14, dmg: '12d6', half: true, text: 'The dragon\'s eye opens, and it breathes a cloud of poison!', pass: 'held their breath', fail: 'choked on the fumes' } },
    ], reward: { coins: [300, 500], gems: [10, 18], crystal: [6, 10], rare: 1, xp: 520 } },
];
export const SUPPLIES = 10;   // food per adventurer
export function difficulty(q, vs) {
  if (!vs.length) return { name: '—', cls: '' };
  const avg = vs.reduce((a, v) => a + (v.lvl || 1), 0) / vs.length, k = avg - q.lvl + (vs.length - 3) * 0.6;
  return k >= 1 ? { name: 'Easy', cls: 'ok' } : k >= -0.4 ? { name: 'Fair', cls: 'ok' } : k >= -1.6 ? { name: 'Risky', cls: 'warn' } : { name: 'Deadly', cls: 'bad' };
}

// Play out a whole expedition with dice. Returns story lines, everyone's hit points
// afterwards, the loot and the xp.
export function runExpedition(q, vs, r, opt = {}) {
  const party = vs.map(v => {
    const cls = classOf(v), L = v.lvl || 1, c = CLASSES[cls];
    const p = { id: v.id, first: first(v), cls, L, hd: c.hd, con: mod(v.abil?.con), max: maxHp(v), hp: Math.max(1, Math.round(v.hp ?? maxHp(v))),
      ac: armorClass(v, opt.buffs, opt.now), atk: classAttack(v, cls), wind: cls === 'fighter', heals: 0, abil: v.abil, saves: c.saves, P: prof(L) };
    if (cls === 'cleric') { p.heal = { name: 'Cure Wounds', s: 8, b: mod(v.abil?.wis) }; p.heals = 1 + (L >> 1); }
    if (cls === 'bard') { p.heal = { name: 'Healing Word', s: 4, b: mod(v.abil?.cha) }; p.heals = 1 + (L >> 1); }
    if (cls === 'rogue') p.sneak = Math.ceil(L / 2);
    if (cls === 'paladin') { p.smite = true; p.heal = { name: 'Lay on Hands', s: 4, b: 2 + L * 2 }; p.heals = 1; }
    // racial traits (society.js): Lucky, Relentless Endurance, Breath Weapon
    p.lucky = v.race === 'halfling'; p.relentless = v.race === 'halforc'; p.breath = v.race === 'dragonborn';
    p.ward = v.gear?.m === 'amulet' ? 1 : 0;   // Warding Amulet: +1 to saves
    return p;
  });
  // spell scrolls (magic.js), read by the party's best caster: Burning Hands opens a fight against three or more
  // foes, Bless one against a tough foe, and Guidance adds a d4 to a check that just failed
  let scrolls = opt.scrolls || 0;
  const SCROLL_DC = 13;
  const reader = () => up().sort((a, b) => (['wizard', 'cleric', 'bard'].includes(b.cls) - ['wizard', 'cleric', 'bard'].includes(a.cls)) || mod(b.abil?.int) - mod(a.abil?.int))[0];
  let blessed = false;   // a scroll of Bless read for one fight
  const bless = () => opt.bless || blessed ? roll(r, 1, 4) : 0;
  const names = list => list.length <= 1 ? (list[0] || '') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  const lines = [`${names(party.map(p => p.first))} set off for ${q.name}.`];
  const loot = {}, addLoot = o => { for (const [k, n] of Object.entries(o || {})) loot[k] = (loot[k] || 0) + n; };
  let wins = 0, total = 0, retreat = false, crits = 0, skipNext = false;
  const up = () => party.filter(p => p.hp > 0);
  // Harsh (hardship.js): a fallen adventurer makes death saving throws (d20: 10+ is a success, three of
  // either decides it; a 1 counts twice, a 20 gets them up). A healer with a heal left spends it on them.
  const harsh = !!opt.harsh;
  const fallDown = o => { if (harsh && o.hp <= 0 && !o.dying && !o.dead) o.dying = { s: 0, f: 0 }; };
  const deathSave = o => {
    const d = d20(r), D = o.dying;
    if (d === 20) { o.hp = 1; o.dying = null; lines.push(`${o.first} rolled a 20 on a death save and got back up!`); return; }
    if (d >= 10) D.s++; else D.f += d === 1 ? 2 : 1;
    if (D.s >= 3) { o.dying = null; lines.push(`${o.first} is badly hurt, but stable.`); }
    else if (D.f >= 3) { o.dying = null; o.dead = true; o.hp = 0; lines.push(`${o.first} failed their last death save. They did not come home.`); }
  };
  const rescue = () => {   // a healer with a heal to spare pulls the dying back first
    for (const o of party) {
      if (!o.dying) continue;
      const h = party.find(p => p.hp > 0 && p.heal && p.heals > 0);
      if (!h) continue;
      const n = Math.max(1, roll(r, 1, h.heal.s) + h.heal.b); o.hp = n; o.dying = null; h.heals--;
      lines.push(`${h.first} cast ${h.heal.name} on ${o.first} and pulled them back from the brink (+${n} HP).`);
    }
  };
  const settle = () => { if (!harsh) return; rescue(); for (let k = 0; k < 12 && party.some(o => o.dying); k++) for (const o of party) if (o.dying) deathSave(o); };

  const save = st => {
    const ok = [], bad = []; let hurt = 0;
    for (const p of up()) {
      const t = d20(r) + mod(p.abil?.[st.abil]) + (p.saves.includes(st.abil) ? p.P : 0) + p.ward + bless();
      const n = rollD(r, dice(st.dmg));
      if (t >= st.dc) { ok.push(p.first); if (st.half) { p.hp -= Math.floor(n / 2); hurt += Math.floor(n / 2); } }
      else { bad.push(p.first); p.hp -= n; hurt += n; }
    }
    for (const p of party) { p.hp = Math.max(0, p.hp); if (p.hp === 0 && !p.dead) fallDown(p); }
    lines.push(`${st.text} ${ok.length ? `${names(ok)} ${st.pass}` : ''}${ok.length && bad.length ? '; ' : ''}${bad.length ? `${names(bad)} ${st.fail}` : ''} (${st.abil.toUpperCase()} save, DC ${st.dc}${hurt ? `, ${hurt} damage` : ''}).`);
    return bad.length <= ok.length;
  };

  const fight = st => {
    const M = MONSTERS[st.foe], md = dice(M.dmg);
    const foes = Array.from({ length: st.n }, () => ({ hp: M.hp }));
    const alive = () => foes.filter(f => f.hp > 0);
    const dealt = new Map(), healed = [], breaths = [], lucky = [];   // dealt: "Sigrun's longsword" -> damage
    let taken = 0, critBy = null, falls = [];
    lines.push(st.text);
    if (scrolls > 0 && reader() && (st.n >= 3 || M.hp >= 20)) {
      const who = reader(); scrolls--;
      if (st.n >= 3) {
        const n = roll(r, 3, 6); let total = 0, saved = 0;
        for (const f of foes) { const half = d20(r) + M.sv >= SCROLL_DC; if (half) saved++; const d = half ? Math.floor(n / 2) : n; f.hp -= d; total += d; }
        dealt.set(`${who.first}'s Burning Hands`, total);
        lines.push(`${who.first} read a scroll of Burning Hands: a fan of flame for ${n} fire damage${saved ? ` (${saved} dodged for half)` : ''}!`);
      } else {
        blessed = true;
        lines.push(`${who.first} read a scroll of Bless: everyone adds a d4 to their attacks this fight.`);
      }
    }
    for (let round = 0; round < 14 && up().length && alive().length; round++) {
      for (const p of party) {
        if (p.hp <= 0 || !alive().length) continue;
        const hurt = up().filter(o => o.hp < o.max * 0.4).sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
        if (p.heal && p.heals > 0 && hurt) {
          const n = roll(r, 1, p.heal.s) + p.heal.b; hurt.hp = Math.min(hurt.max, hurt.hp + Math.max(1, n)); p.heals--;
          healed.push(`${p.first} cast ${p.heal.name} on ${hurt === p ? 'themself' : hurt.first} (+${Math.max(1, n)} HP)`); continue;
        }
        if (p.wind && p.hp < p.max / 2) { p.hp = Math.min(p.max, p.hp + roll(r, 1, 10) + p.L); p.wind = false; }
        const f = alive()[0];
        if (p.breath && round === 0) {
          const n = roll(r, 2 + (p.L >= 6 ? 1 : 0), 6), hitF = alive().slice(0, 2);
          for (const o of hitF) o.hp -= n;
          p.breath = false; breaths.push(`${p.first} breathed a gout of dragon fire (${n} damage${hitF.length > 1 ? ' each' : ''})`); continue;
        }
        let hit = false, crit = false;
        if (p.atk.save) hit = d20(r) + M.sv < p.atk.dc;
        else { let d = d20(r); if (d === 1 && p.lucky) { d = d20(r); lucky.push(p.first); } crit = d === 20; hit = crit || (d !== 1 && d + p.atk.bonus + bless() >= M.ac); }
        if (!hit) continue;
        let n = Math.max(1, rollD(r, p.atk.dmg, crit));
        if (p.sneak && up().length > 1) n += roll(r, p.sneak * (crit ? 2 : 1), 6);
        if (p.smite) { const sm = roll(r, crit ? 4 : 2, 8); n += sm; p.smite = false; breaths.push(`${p.first} called down a Divine Smite (+${sm} radiant)`); }
        const who = `${p.first}'s ${p.atk.name}`; f.hp -= n; dealt.set(who, (dealt.get(who) || 0) + n);
        if (crit) { crits++; critBy = critBy || p; }
      }
      for (const f of alive()) {
        const ts = up(); if (!ts.length) break;
        const t = ts[(r() * ts.length) | 0], d = d20(r), crit = d === 20;
        if (!(crit || (d !== 1 && d + M.atk >= t.ac))) continue;
        const n = Math.max(1, rollD(r, md, crit));
        t.hp = Math.max(0, t.hp - n); taken += n;
        if (t.hp === 0 && t.relentless) { t.hp = 1; t.relentless = false; breaths.push(`${t.first} refused to fall (Relentless Endurance)`); }
        if (t.hp === 0) { falls.push(t.first); fallDown(t); }
      }
      if (harsh) { rescue(); for (const o of party) if (o.dying) deathSave(o); }
    }
    const won = !alive().length;
    const top = [...dealt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([who]) => who);
    blessed = false;
    if (critBy) lines.push(`${critBy.first} rolled a natural 20!`);
    if (breaths.length) lines.push(breaths.join('; ') + '.');
    if (lucky.length) lines.push(`Halfling luck: ${names([...new Set(lucky)])} turned a fumble around.`);
    if (healed.length) lines.push(healed.slice(0, 2).join('; ') + '.');
    if (won) lines.push(`${top.length ? names(top) : 'Teamwork'} ${M.beaten}${taken ? ` (the party took ${taken} damage${falls.length ? `; ${names([...new Set(falls)])} got knocked down` : ''})` : ', without a scratch'}.`);
    else lines.push(`The ${st.n > 1 ? M.plural : M.name} ${st.n > 1 ? 'were' : 'was'} too much. The party fell back, carrying each other home.`);
    return won;
  };

  const check = st => {
    let best = null, bv = -99;
    for (const p of up()) { const b = mod(p.abil?.[st.abil]) + (CLASS_SKILL[p.cls]?.includes(st.abil) ? p.P : 0); if (b > bv) { bv = b; best = p; } }
    if (!best) return false;
    const d = d20(r); let t = d + bv + bless(), ok = d === 20 || t >= st.dc, guided = 0;
    if (!ok && d !== 1 && scrolls > 0 && reader() && t + 4 >= st.dc) {   // only worth reading if a d4 could save it
      const who = reader(); scrolls--; guided = roll(r, 1, 4); t += guided; ok = t >= st.dc;
      lines.push(`${st.text} ${best.first} was just short, ${who === best ? 'and read' : `so ${who.first} read`} a scroll of Guidance (+${guided}).`);
      lines.push(`${best.first} ${ok ? st.win : st.lose} (${st.abil.toUpperCase()} check with Guidance: ${t} vs DC ${st.dc}).`);
    } else lines.push(`${st.text} ${best.first} ${ok ? st.win : st.lose} (${st.abil.toUpperCase()} check: rolled ${t} vs DC ${st.dc}).`);
    if (ok) addLoot(st.loot);
    if (ok && st.skip) skipNext = true;
    if (!ok && st.onFail) save(st.onFail);
    return ok;
  };

  for (let i = 0; i < q.steps.length && !retreat; i++) {
    const st = q.steps[i];
    if (skipNext && st.kind === 'fight') { skipNext = false; total++; wins++; continue; }
    skipNext = false; total++;
    if (st.kind === 'fight') { if (fight(st)) wins++; else retreat = true; }
    else if (st.kind === 'save') { if (save(st)) wins++; }
    else if (st.kind === 'check') { if (check(st)) wins++; }
    if (!up().length) retreat = true;
    // a short rest between encounters: the fallen are patched up, everyone spends a hit die
    settle();   // nobody walks on while someone is still dying
    if (!retreat && i < q.steps.length - 1) for (const p of party) if (!p.dead) p.hp = Math.min(p.max, Math.max(1, p.hp) + Math.max(1, roll(r, 1, p.hd) + p.con));
  }
  // the haul
  const k = retreat ? 0.35 : 0.6 + 0.4 * (total ? wins / total : 1), rw = q.reward;
  for (const [res, v] of Object.entries(rw)) if (Array.isArray(v)) addLoot({ [res]: Math.round((v[0] + r() * (v[1] - v[0])) * k) });
  if (!retreat && rw.rare && r() < rw.rare) loot.rare = 1;
  if (scrolls > 0) loot.scroll = (loot.scroll || 0) + scrolls;   // unread scrolls come home
  const xp = Math.round(rw.xp * (retreat ? 0.5 : 1));
  lines.push(retreat ? `They limped home from ${q.name} with what they could carry.` : `The party came home from ${q.name}, tired and triumphant!`);
  for (const p of party) if (retreat && !p.dead) p.hp = Math.max(1, p.hp);
  const dead = party.filter(p => p.dead).map(p => p.id);
  return { lines, hp: Object.fromEntries(party.map(p => [p.id, Math.max(1, p.hp)])), loot, xp, ok: !retreat, crits, dead };
}
// classes that are trained in an ability check (they add proficiency)
const CLASS_SKILL = { paladin: ['str', 'cha'], fighter: ['str'], ranger: ['wis', 'dex'], rogue: ['dex', 'int'], wizard: ['int'], cleric: ['wis'], bard: ['cha', 'dex'] };

// ── the forge ──
export const RECIPES = [
  { id: 'iron',   out: 'iron',   in: { ore: 3, wood: 2 },    t: 7,  know: 0,   verb: 'Smelting iron' },
  { id: 'sword',  out: 'sword',  in: { iron: 2, planks: 1 }, t: 10, know: 20,  verb: 'Forging a sword' },
  { id: 'shield', out: 'shield', in: { iron: 1, planks: 3 }, t: 9,  know: 35,  verb: 'Making a shield' },
  { id: 'bow',    out: 'bow',    in: { planks: 4, iron: 1 }, t: 9,  know: 50,  verb: 'Carving a bow' },
  { id: 'armor',  out: 'armor',  in: { iron: 5, cloth: 1 },  t: 14, know: 90,  verb: 'Riveting armour' },
  { id: 'staff',  out: 'staff',  in: { planks: 3, gems: 2 }, t: 12, know: 140, verb: 'Carving a staff' },
];
export const GEAR = ['sword', 'bow', 'staff', 'shield', 'armor'];
const AUTO_KEEP = 2;   // "Auto" keeps a couple of each unlocked item in the armory

// ── the spell book ──
const SLOTS = [[], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]];
export const slotsFor = L => SLOTS[Math.max(0, Math.min(20, L || 0))];
export const casterNeeds = sp => sp.lvl ? sp.lvl * 2 - 1 : 1;
export const studyCost = sp => 40 + 60 * sp.lvl;
const OLD_SPELLS = { harvest: 'plant', rain: 'water', haste: 'haste', ward: 'hallow', bloom: 'goodberry', transmute: 'fabricate' };

// ── the simulation side ──
const RPG = {
  rpg() { return this.s.rpg || (this.s.rpg = { know: 0, buffs: {}, dawn: -1 }); },
  buffOn(k) { return (this.s.rpg?.buffs?.[k] || 0) > this.s.time; },
  nextDawn() { const t = this.s.time; let n = Math.floor(t / DAY) * DAY + DAY * 0.25; if (n <= t) n += DAY; return n; },

  // a newcomer or newborn gets their ability scores
  rpgInit(v, o = {}) {
    const pa = (o.parents || []).map(id => this.vById.get(id)).filter(p => p?.abil);
    v.abil = pa.length === 2 ? inheritScores(pa[0].abil, pa[1].abil, this.rng) : rollScores(this.rng);
    v.lvl = 1; v.xp = 0; v.gear = {}; v.hp = maxHp(v);
  },
  // old saves: scores are rolled from the villager's id so they're always the same
  rpgEnsure(v) {
    if (!v.abil) v.abil = rollScores(mulberry32(((v.id * 2654435761) ^ (this.s.seed || 7)) >>> 0));
    v.lvl = v.lvl || 1; v.xp = v.xp || 0; v.gear = v.gear || {};
    if (!(v.hp >= 0)) v.hp = maxHp(v);
    v.engage = null; v.koLying = false; v.resting = false;
    if (v.ko > 0) v.ko = 1;
  },
  rpgLoad() {
    const s = this.s, R = this.rpg();
    R.buffs = R.buffs || {}; R.know = R.know || 0;
    for (const v of s.villagers) { this.rpgEnsure(v); if (v.quest?.phase === 'away') v.indoors = true; }
    const m = s.magic;
    const old = (m.known || []).filter(id => OLD_SPELLS[id]).length;
    if (old) {
      m.known = [...new Set(m.known.map(id => OLD_SPELLS[id] || id))];
      for (const v of s.villagers) if (v.job === 'wizard') v.lvl = Math.max(v.lvl, Math.min(5, 1 + old));
    }
    m.known = (m.known || []).filter(id => SPELLS.some(sp => sp.id === id));
    m.used = m.used || {}; m.cds = m.cds || {}; m.study = m.study || 0;
    for (const b of s.buildings) if (b.type === 'guild') this.guildOf(b);
  },
  // growing up and growing old
  rpgStage(v, stage) {
    const a = v.abil; if (!a) return;
    if (stage === 'adult' && v.educated) { a.int = Math.min(18, a.int + 1); a.wis = Math.min(18, a.wis + 1); }
    if (stage === 'elder' && !v.aged) { v.aged = true; a.str = Math.max(3, a.str - 1); a.dex = Math.max(3, a.dex - 1); }
    v.hp = stage === 'adult' ? maxHp(v) : Math.min(v.hp ?? maxHp(v), maxHp(v));
  },
  abilityWork(v) {
    const job = v.work ? v.job : v.task?.bid ? 'builder' : null;
    return abilityWorkMult(v, job) * (this.buffOn('guidance') ? 1.1 : 1);
  },
  jobFit(v, job) { return jobFit(v, job); },
  litNight(v) { return v.age >= 14 && this.buffOn('light'); },

  rpgGainXp(v, n) {
    v.xp = (v.xp || 0) + n;
    let up = false;
    while (v.xp >= xpToNext(v.lvl || 1) && (v.lvl || 1) < 20) {
      v.xp -= xpToNext(v.lvl || 1);
      const before = maxHp(v); v.lvl = (v.lvl || 1) + 1;
      v.hp = Math.min(maxHp(v), (v.hp ?? before) + maxHp(v) - before); up = true;
    }
    if (up) {
      this.log(`${v.name} reached level ${v.lvl} (${CLASSES[classOf(v)].name}).`);
      this.emit('toast', `${first(v)} reached level ${v.lvl}!`, 'star');
    }
  },

  // ── villager brains: knocked out, on an expedition, or in a fight ──
  rpgThink(v) {
    if (v.ko > 0) { this.taskKO(v); return true; }
    if (v.quest) { this.taskQuest(v); return true; }
    if (v.downed) { if ((v.hp ?? 0) >= maxHp(v) * 0.6) v.downed = false; else { this.taskRest(v); return true; } }
    if (v.engage && this.taskFight(v)) return true;
    v.engage = null;
    return false;
  },
  taskKO(v) {
    this.setTask(v, 'Knocked out', [{ act: 9999, anim: 'rest', until: () => !(v.ko > 0),
      start: () => { v.koLying = true; v.act.idle = true; }, done: () => { v.koLying = false; } }]);
  },
  taskRest(v) {
    const b = this.bedFor(v).b;
    const healed = () => (v.hp ?? 0) >= maxHp(v) * 0.6;
    const done = () => { v.resting = false; v.indoors = false; v.asleep = null; if (healed()) v.downed = false; };
    if (!b) return this.setTask(v, 'Resting to heal', [{ act: 9999, anim: 'rest', until: healed, start: () => { v.resting = true; v.act.idle = true; }, done }]);
    if (b.type === 'campfire') {
      const c = this.bCenter(b), a = (v.id * 2.39) % 6.28, px = c.x + Math.cos(a) * 1.5, pz = c.z + Math.sin(a) * 1.5;
      return this.setTask(v, 'Resting by the fire to heal', [{ walk: this.goalBuilding(b) }, { to: [px, pz] }, { face: [c.x, c.z] },
        { act: 9999, anim: 'sleep', until: healed, start: () => { v.resting = true; v.asleep = 'fire'; v.act.idle = true; }, done }]);
    }
    const [ex, ez] = this.entryTile(b), door = this.local(b, 0, this.bCenter(b).d / 2 - 0.2);
    this.setTask(v, 'Resting at home to heal', [{ walk: { tx: ex, tz: ez } }, { to: [door.x, door.z] },
      { act: 9999, anim: 'sleep', until: healed, start: () => { v.resting = true; v.indoors = true; v.act.idle = true; }, done }]);
  },
  taskQuest(v) {
    const q = v.quest, e = this.world.entry;
    if (q.phase === 'leaving') return this.setTask(v, 'Setting off on an expedition', [{ walk: { tx: e.x, tz: e.z } }, { fn: () => { if (v.quest) v.quest.phase = 'away'; } }]);
    if (q.phase === 'away') return this.setTask(v, 'Away on an expedition', [{ act: 9999, anim: 'rest', until: () => v.quest?.phase !== 'away',
      start: () => { v.indoors = true; v.act.idle = true; }, done: () => { v.indoors = false; } }]);
    const fire = this.s.buildings.find(o => o.type === 'campfire' && o.sid === v.home);
    const back = () => { v.quest = null; this.rpgReturned(v); };
    if (!fire) return this.setTask(v, 'Home from an expedition', [{ fn: back }]);
    this.setTask(v, 'Heading home from an expedition', [{ walk: this.goalBuilding(fire) }, { fn: back }]);
  },
  rpgReturned(v) {
    if (v.job === 'adventurer') v.job = 'idle';
    const b = v.prevWork && this.bById.get(v.prevWork);
    v.prevWork = null;
    if (b && stageOf(v) === 'adult') this.assign(b, v);
    if ((v.hp ?? 0) < maxHp(v) * 0.4) v.downed = true;
  },
  taskFight(v) {
    const bst = this.s.beasts.find(o => o.id === v.engage);
    if (!bst || bst.state === 'flee') return false;
    const name = BEASTS[bst.kind]?.name.toLowerCase() || 'beast';
    const d = Math.hypot(bst.x - v.x, bst.z - v.z);
    if (d > 1.4) {
      const k = 0.85 / Math.max(0.01, d), px = bst.x + (v.x - bst.x) * k, pz = bst.z + (v.z - bst.z) * k;
      this.setTask(v, `Charging a ${name}`, [{ walk: { tx: toTile(bst.x), tz: toTile(bst.z), adj: true } }, { to: [px, pz] }]);
      return true;
    }
    this.setTask(v, `Fighting a ${name}`, [{ face: [bst.x, bst.z] },
      { act: 2.5, anim: 'fight', until: () => bst.state === 'flee' || v.ko > 0 || !this.s.beasts.includes(bst) }]);
    return true;
  },

  // ── defence, once a second: arrows from the towers, guards meeting beasts, flames and thorns ──
  rpgDefend() {
    const s = this.s;
    if (!s.beasts.length) return;
    const now = s.time;
    const ready = g => g && !(g.ko > 0) && !g.downed && !g.quest && !g.carry;
    const towers = s.buildings.filter(b => b.type === 'watchtower' && b.built);
    // 1) melee: an engaged guard and their beast trade blows
    for (const bst of s.beasts) {
      if (bst.state !== 'fight') continue;
      const g = this.vById.get(bst.foe);
      if (!ready(g) || g.engage !== bst.id || now - bst.fightT > 45) { this.rpgRelease(bst, g); continue; }
      if (Math.hypot(g.x - bst.x, g.z - bst.z) > 1.6) { if (now - bst.fightT > 20) this.rpgRelease(bst, g); continue; }
      bst.face = Math.atan2(g.x - bst.x, g.z - bst.z);
      this.rpgSwing(g, bst, 'melee');
      if (bst.hp > (bst.maxHp || 0) * MORALE) this.rpgBite(bst, g);
    }
    // 2) archers on the towers: one arrow each a second, at the nearest beast in range
    for (const tw of towers) {
      const c = this.bCenter(tw), range = 13 + lvlOf(tw) * 2;
      for (const id of tw.workers) {
        const g = this.vById.get(id);
        if (!ready(g) || g.engage || Math.hypot(g.x - c.x, g.z - c.z) > 4) continue;
        let tgt = null, bd = range;
        for (const bst of s.beasts) { if (bst.state === 'flee' || bst.hp <= (bst.maxHp || 0) * MORALE) continue; const dd = Math.hypot(bst.x - c.x, bst.z - c.z); if (dd < bd) { bd = dd; tgt = bst; } }
        if (!tgt) continue;
        this.emit('arrow', c.x, c.z, tgt);
        this.rpgSwing(g, tgt, 'ranged');
      }
    }
    // 3) torches singe, Spike Growth's thorns prick
    const lights = s.buildings.filter(b => b.type === 'torch' || b.type === 'lantern');
    const thorns = this.buffOn('spike') && (now | 0) % 2 === 0;
    for (const bst of s.beasts) {
      if (bst.state === 'flee') continue;
      for (const t of lights) { const c = this.bCenter(t); if (Math.hypot(bst.x - c.x, bst.z - c.z) < 3) bst.hp -= 1; }
      if (thorns && this.settlementAt(toTile(bst.x), toTile(bst.z))) { const n = roll(this.rng, 1, 4); bst.hp -= n; this.emit('dmg', bst.x, bst.z, String(n), 'thorn'); }
    }
    // 4) a guard climbs down to meet a beast that comes close to the tower
    for (const bst of s.beasts) {
      if (bst.state !== 'prowl' || bst.hp <= (bst.maxHp || 0) * MORALE || (bst.calm || 0) > now) continue;
      let pick = null, best = -1e9;
      for (const tw of towers) {
        const c = this.bCenter(tw);
        if (Math.hypot(bst.x - c.x, bst.z - c.z) > 7) continue;
        for (const id of tw.workers) {
          const g = this.vById.get(id);
          if (!ready(g) || g.engage || (g.hp ?? 0) < maxHp(g) * 0.5 || Math.hypot(g.x - c.x, g.z - c.z) > 4) continue;
          const sc = mod(g.abil?.str) + (g.gear?.w === 'sword' ? 2 : 0) + (g.gear?.s ? 1 : 0) + (g.hp / maxHp(g));
          if (sc > best) { best = sc; pick = g; }
        }
      }
      if (!pick) continue;
      pick.engage = bst.id; bst.foe = pick.id; bst.state = 'fight'; bst.fightT = now; bst.path = null;
      this.dropTask(pick); pick.thinkCd = 0;
      this.emit('dmg', bst.x, bst.z, '!', 'alert');
    }
    // 5) wild things don't fight to the end: badly hurt (40% HP or less), they run for the trees
    for (const bst of s.beasts) if (bst.state !== 'flee' && bst.hp <= (bst.maxHp || 0) * MORALE) this.rpgDriveOff(bst, 'guards');
  },
  rpgRelease(bst, g) {
    if (bst.state === 'fight') { bst.state = 'prowl'; bst.path = null; }
    bst.foe = null; bst.calm = this.s.time + 15;
    if (g && g.engage === bst.id) { g.engage = null; if (g.task && /Charging|Fighting/.test(g.task.label)) this.dropTask(g); }
  },
  rpgSwing(g, bst, mode) {
    const r = this.rng, st = beastStats(bst.kind), at = guardAttack(g, mode);
    const d = d20(r, this.buffOn('faerie') ? 1 : 0), crit = d === 20;
    const hit = crit || (d !== 1 && d + at.bonus + (this.buffOn('bless') ? roll(r, 1, 4) : 0) >= st.ac);
    const hb = bst.hitBy || (bst.hitBy = []); if (!hb.includes(g.id)) hb.push(g.id);
    if (!hit) { this.emit('dmg', bst.x, bst.z, 'Miss', 'miss'); return 0; }
    const n = Math.max(1, rollD(r, at.dmg, crit));
    bst.hp -= n;
    if (crit) this.s.stats.crits = (this.s.stats.crits || 0) + 1;
    this.emit('dmg', bst.x, bst.z, crit ? `${n}!` : String(n), crit ? 'crit' : 'hit');
    return n;
  },
  rpgBite(bst, g) {
    const r = this.rng, st = beastStats(bst.kind), ac = armorClass(g, this.s.rpg?.buffs, this.s.time);
    const d = d20(r), crit = d === 20, hit = crit || (d !== 1 && d + st.atk >= ac);
    if (!hit) { this.emit('dmg', g.x, g.z, 'Miss', 'miss'); return; }
    this.rpgHurt(g, Math.max(1, rollD(r, dice(st.dmg), crit)), `a ${BEASTS[bst.kind]?.name.toLowerCase() || 'beast'}`);
    if (g.ko > 0) this.rpgRelease(bst, null);
  },
  rpgHurt(v, n, by) {
    v.hp = Math.max(0, (v.hp ?? maxHp(v)) - n);
    this.emit('dmg', v.x, v.z, String(n), 'hurt');
    if (v.hp > 0) return;
    v.ko = 6; v.downed = true; v.engage = null;
    this.dropTask(v);
    this.log(`${v.name} was knocked out by ${by}. Friends helped them home to rest.`);
    this.emit('toast', `${first(v)} was knocked out! They'll rest up at home.`, 'heart');
  },
  rpgDriveOff(bst, why) {
    const s = this.s;
    bst.state = 'flee'; bst.path = null;
    s.stats.fended = (s.stats.fended || 0) + 1;
    this.addXp(6); this.emit('beastFled', bst, why);
    if (bst.kind === 'goblin') { s.res.coins += 15; this.emit('float', bst.x, bst.z, '+15', 'coin'); }
    for (const id of bst.hitBy || []) { const g = this.vById.get(id); if (g) this.rpgGainXp(g, 10); }
    const g = this.vById.get(bst.foe); if (g?.engage === bst.id) g.engage = null;
    bst.foe = null;
  },
  rpgBeast(bst) { const st = beastStats(bst.kind); bst.hp = bst.maxHp = st.hp; },

  // ── once a second: healing, dawn, the schoolhouse, the armory, expeditions ──
  rpgSecond() {
    const s = this.s, R = this.rpg(), now = s.time, f = this.dayFrac(), day = this.dayNum();
    if (f >= 0.25 && R.dawn !== day) { R.dawn = day; s.magic.used = {}; }
    const warm = s.buildings.filter(b => b.built && (b.type === 'campfire' || b.type === 'tavern')).map(b => this.bCenter(b));
    const cheer = (s.tavernJoy || 0) > 0;
    for (const v of s.villagers) {
      const mx = maxHp(v);
      if (!(v.hp >= 0)) v.hp = mx;
      if (v.ko > 0) v.ko -= 1;
      if (v.hp >= mx) { v.hp = mx; continue; }
      if (v.quest?.phase === 'away') continue;
      let k = 1 / 60;
      k *= v.hungry ? 0.4 : 1.5;
      if (v.asleep || v.resting) k *= 3;
      if (warm.some(c => Math.hypot(c.x - v.x, c.z - v.z) < 5)) k *= 1.5;
      if (cheer) k *= 1.25;
      v.hp = Math.min(mx, v.hp + k);
    }
    // knowledge: teachers at work, with pupils, build up what the village knows
    for (const b of s.buildings) {
      if (b.type !== 'school' || !b.built) continue;
      const pupils = s.villagers.filter(v => v.home === b.sid && v.act && v.task?.label === 'At school').length;
      for (const id of b.workers) {
        const t = this.vById.get(id);
        if (!t || !t.act || t.act.idle || t.task?.label !== 'Teaching') continue;
        R.know += 0.1 * (1 + 0.1 * mod(t.abil?.int)) * (1 + 0.1 * Math.min(8, pupils)) * (1 + (lvlOf(b) - 1) * 0.25);
      }
    }
    // guards help themselves to gear from the armory
    if ((now | 0) % 5 === 0) for (const v of s.villagers) if (v.job === 'guard') this.equip(v, 'guard', true);
    // expeditions
    for (const b of s.buildings) if (b.type === 'guild' && b.data?.exp) this.expTick(b);
    for (const v of s.villagers) if (v.quest && v.quest.phase !== 'returning' && !this.bById.get(v.quest.bid)?.data?.exp) v.quest.phase = 'returning';
  },

  // ── the armory ──
  gearWants(v, role) {
    if (role === 'guard') { const str = mod(v.abil?.str) >= mod(v.abil?.dex); return { w: str ? ['sword', 'bow'] : ['bow', 'sword'], a: 1, s: 1 }; }
    return CLASSES[classOf(v)].gear;
  },
  equip(v, role, quiet) {
    const res = this.s.res, g = v.gear || (v.gear = {}), want = this.gearWants(v, role), got = [];
    const take = k => { if ((res[k] || 0) >= 1) { res[k] -= 1; this.track(k, -1); got.push(k); return true; } return false; };
    if (!g.w) for (const w of want.w) if (take(w)) { g.w = w; break; }
    if (!g.a && want.a && take('armor')) g.a = 1;
    if (!g.s && want.s && g.w !== 'bow' && g.w !== 'staff' && take('shield')) g.s = 1;
    if (got.length) { this.emit('res'); if (!quiet) this.emit('sfx', 'place'); }
    return got;
  },
  // would equip() find anything useful in the armory?
  canEquip(v, role) {
    const res = this.s.res, g = v.gear || {}, want = this.gearWants(v, role);
    if (!g.w && want.w.some(w => res[w] >= 1)) return true;
    if (!g.a && want.a && res.armor >= 1) return true;
    return !g.s && want.s && g.w !== 'bow' && g.w !== 'staff' && res.shield >= 1;
  },
  unequip(v) {
    const g = v.gear || {}, res = this.s.res;
    if (g.w) res[g.w] = (res[g.w] || 0) + 1;
    if (g.a) res.armor = (res.armor || 0) + 1;
    if (g.s) res.shield = (res.shield || 0) + 1;
    v.gear = {}; this.emit('res');
  },

  // ── the forge ──
  recipeOpen(rc) { return (this.s.rpg?.know || 0) >= rc.know; },
  forgePick(b) {
    const mode = b.data?.recipe || 'auto', res = this.s.res, cap = this.cap();
    const short = rc => Object.entries(rc.in).find(([k, n]) => (res[k] || 0) < n);
    if (mode !== 'auto') {
      const rc = RECIPES.find(o => o.id === mode);
      if (!rc || !this.recipeOpen(rc)) return { why: `Needs ${rc?.know} knowledge` };
      const sh = short(rc); if (sh) return { why: `Needs ${sh[1]} ${sh[0] === 'ore' ? 'iron ore' : sh[0] === 'iron' ? 'iron bars' : sh[0]}` };
      if (rc.out === 'iron' && res.iron >= cap) return { why: 'Storage full' };
      return { rc };
    }
    const keep = out => AUTO_KEEP + (this.enchantDemand?.(out) || 0);   // more swords while an enchanter needs them
    const want = RECIPES.filter(rc => rc.out !== 'iron' && this.recipeOpen(rc) && (res[rc.out] || 0) < keep(rc.out) && !short(rc))
      .sort((a, c) => (res[a.out] || 0) - (res[c.out] || 0))[0];
    if (want) return { rc: want };
    const smelt = RECIPES[0];
    if (!short(smelt) && res.iron < Math.min(cap, 30)) return { rc: smelt };
    return { why: (res.ore || 0) < 3 ? 'Needs iron ore (quarry miners find it)' : 'Armory stocked' };
  },
  taskForge(v, b) {
    const p = this.spot(b, b.workers.indexOf(v.id)), c = this.bCenter(b);
    let rc = null;
    this.setTask(v, 'Smithing', [{ walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] },
      { act: 8, anim: 'hammer', start: () => {
        const pk = this.forgePick(b);
        if (!pk.rc) { b.status = pk.why; b.data.making = null; v.act.anim = 'rest'; v.act.idle = true; return; }
        rc = pk.rc; b.status = null; b.data.making = rc.id; v.act.dur = rc.t;
        if (v.task) v.task.label = rc.verb;
        this.pay(rc.in); for (const [k, n] of Object.entries(rc.in)) this.credit(b, k, -n);
      }, done: act => {
        if (!act.idle && rc) {
          const got = this.add(rc.out, 1); this.credit(b, rc.out, got);
          this.emit('float', c.x, c.z, got ? '+1' : 'Full!', rc.out);
          this.s.stats.forged = (this.s.stats.forged || 0) + (rc.out === 'iron' ? 0 : got);
          this.addXp(rc.out === 'iron' ? 1 : 4); this.rpgGainXp(v, 2);
        }
        this.repeat(v);
      } }]);
  },
  // quarry miners turn up iron ore once there's a forge to use it
  rpgOre(v, b) {
    if (this.rng() > 0.3 || !this.s.buildings.some(o => o.type === 'forge' && o.built)) return;
    const got = this.add('ore', 2);
    if (got) { this.emit('float', v.x, v.z, `+${got}`, 'ore'); this.credit(b, 'ore', got); }
  },

  // ── the spell book ──
  caster() {
    let best = null;
    for (const v of this.s.villagers) if (v.job === 'wizard' && !v.quest && !(v.ko > 0) && (!best || v.lvl > best.lvl || (v.lvl === best.lvl && v.abil.int > best.abil.int))) best = v;
    return best;
  },
  casterLevel() { return this.caster()?.lvl || 0; },
  slotFor(lvl) {
    if (!lvl) return 0;
    const slots = slotsFor(this.casterLevel()), used = this.s.magic.used || {};
    for (let k = lvl; k <= slots.length; k++) if ((used[k] || 0) < slots[k - 1]) return k;
    return -1;
  },
  rpgTaskStudy(v, b) {
    const p = this.spot(b, b.workers.indexOf(v.id)), c = this.bCenter(b), m = this.s.magic;
    this.setTask(v, 'Studying the arcane', [{ walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] },
      { act: 10, anim: 'cast', done: () => {
        const rate = this.workRate(v);
        this.rpgGainXp(v, Math.max(1, 3 + mod(v.abil?.int)) * rate);
        const L = this.casterLevel(), next = SPELLS.find(sp => !m.known.includes(sp.id) && L >= casterNeeds(sp));
        if (next) {
          m.study += 4 * rate;
          if (m.study >= studyCost(next)) {
            m.study = 0; m.known.push(next.id);
            this.log(`Your wizards learned a new spell: ${next.name} (${next.lvl ? `level ${next.lvl}` : 'cantrip'}, ${next.school.toLowerCase()}).`);
            this.emit('toast', `New spell learned: ${next.name}!`, 'staff'); this.emit('sfx', 'level');
          }
        }
        this.emit('float', c.x, c.z, `+${Math.round(4 * rate)}`, 'staff');
        this.repeat(v);
      } }]);
  },
  rpgCanCast(id) {
    const s = this.s, m = s.magic, sp = SPELLS.find(o => o.id === id);
    if (!sp || !m.known.includes(id)) return { ok: false, why: 'Not learned yet' };
    const c = this.caster();
    if (!c) return { ok: false, why: 'No wizard at the tower' };
    if (c.lvl < casterNeeds(sp)) return { ok: false, why: `Needs a level ${casterNeeds(sp)} wizard` };
    if (sp.lvl && this.slotFor(sp.lvl) < 0) return { ok: false, why: `No level ${sp.lvl}+ slots left (back at dawn)` };
    if ((m.cds[id] || 0) > s.time) return { ok: false, why: `Ready in ${Math.ceil(m.cds[id] - s.time)}s` };
    const prowl = s.beasts.filter(b => b.state !== 'flee');
    if (id === 'light' && !this.isNight()) return { ok: false, why: 'Only after dark' };
    if ((id === 'fireball' || id === 'lightning') && !prowl.length) return { ok: false, why: 'No beasts in sight' };
    if (id === 'cure' && !s.villagers.some(v => v.hp < maxHp(v) - 0.5 && v.quest?.phase !== 'away')) return { ok: false, why: 'Nobody is hurt' };
    if (id === 'fabricate' && s.res.wood < 80 && s.res.stone < 60) return { ok: false, why: 'Needs 80 wood or 60 stone' };
    if (id === 'mending' && !s.buildings.some(b => this.isSite(b))) return { ok: false, why: 'Nothing being built' };
    if (id === 'plant' && !s.buildings.some(b => b.type === 'farm' && b.data.stage === 'growing')) return { ok: false, why: 'No fields growing' };
    return { ok: true };
  },
  rpgCast(id) {
    if (!this.rpgCanCast(id).ok) return false;
    const s = this.s, m = s.magic, R = this.rpg(), sp = SPELLS.find(o => o.id === id), W = this.world, r = this.rng, now = s.time;
    const c = this.caster(), cm = mod(c.abil?.int), slot = this.slotFor(sp.lvl);
    const used = m.used || (m.used = {});
    if (slot > 0) used[slot] = (used[slot] || 0) + 1;
    m.cds[id] = now + sp.cd;
    s.stats.spells = (s.stats.spells || 0) + 1;
    const dawn = this.nextDawn(), dc = 8 + prof(c.lvl) + cm;
    const blast = (targets, n, label) => {
      for (const bst of targets) {
        const st = beastStats(bst.kind), dmg = roll(r, n, 6), half = d20(r) + st.dex >= dc;
        const got = half ? Math.floor(dmg / 2) : dmg;
        bst.hp -= got; (bst.hitBy || (bst.hitBy = [])).push(c.id);
        this.emit('dmg', bst.x, bst.z, `${got}${half ? '' : '!'}`, 'crit');
        this.emit('spellHit', id, bst.x, bst.z);
        if (bst.hp <= (bst.maxHp || 0) * MORALE) this.rpgDriveOff(bst, 'magic');
      }
      this.log(`${first(c)} cast ${label}, scattering ${targets.length} beast${targets.length > 1 ? 's' : ''}.`);
    };
    switch (id) {
      case 'mending':
        for (const b of s.buildings.filter(o => this.isSite(o))) {
          const pg = b.up || b; pg.progress = Math.min(1, pg.progress + 0.12); this.emit('progress', b);
          if (pg.progress >= 1 && !b.clear.length) { if (b.up) this.finishUpgrade(b); else this.finishBuilding(b); }
        }
        break;
      case 'guidance': R.buffs.guidance = now + 120; break;
      case 'light': R.buffs.light = dawn; for (const v of s.villagers) if (v.asleep === 'home' || v.asleep === 'fire') { if (v.age >= 14 && !v.resting) this.dropTask(v); } break;
      case 'cure': {
        const hurt = s.villagers.filter(v => v.hp < maxHp(v) - 0.5 && v.quest?.phase !== 'away').sort((a, b) => a.hp / maxHp(a) - b.hp / maxHp(b)).slice(0, 4);
        for (const v of hurt) { const n = roll(r, slot, 8) + Math.max(cm, mod(c.abil?.wis)); v.hp = Math.min(maxHp(v), v.hp + Math.max(1, n)); this.emit('dmg', v.x, v.z, `+${Math.max(1, n)}`, 'heal'); }
        break;
      }
      case 'goodberry':
      { const tw = this.bById.get(c.work), o = tw ? this.bCenter(tw) : { x: c.x, z: c.z }; this.floatGain(o.x, o.z, 'food', this.add('food', 40)); }
        W.bushes.forEach((b, i) => { if (b.alive && !b.ripe) { b.ripe = true; this.emit('bush', i); } });
        break;
      case 'water': s.weather = { ...s.weather, rain: true, t: 70, sched: false }; this.emit('weather', true); break;
      case 'bless': R.buffs.bless = dawn; break;
      case 'magearmor': R.buffs.magearmor = dawn; break;
      case 'faerie': R.buffs.faerie = dawn; break;
      case 'spike': R.buffs.spike = dawn; break;
      case 'plant': for (const b of s.buildings) if (b.type === 'farm' && b.data.stage === 'growing') { b.data.grow = 1; b.data.stage = 'ripe'; this.emit('farm', b); } break;
      case 'haste': s.hasteUntil = now + 90; break;
      case 'fireball': {
        const prowl = s.beasts.filter(b => b.state !== 'flee'), by = {};
        for (const b of prowl) by[b.sid] = (by[b.sid] || 0) + 1;
        const sid = Object.keys(by).sort((a, b) => by[b] - by[a])[0];
        blast(prowl.filter(b => b.sid === sid), 8, 'Fireball');
        break;
      }
      case 'lightning': {
        const tw = this.bById.get(c.work), o = tw ? this.bCenter(tw) : { x: c.x, z: c.z };
        blast(s.beasts.filter(b => b.state !== 'flee').sort((a, b) => Math.hypot(a.x - o.x, a.z - o.z) - Math.hypot(b.x - o.x, b.z - o.z)).slice(0, 3), 8, 'Lightning Bolt');
        break;
      }
      case 'fabricate':
        if (s.res.wood >= 80) { s.res.wood -= 80; this.track('wood', -80); this.add('planks', 40); }
        else { s.res.stone -= 60; this.track('stone', -60); this.add('bricks', 20); }
        break;
      case 'hallow': s.wardUntil = now + DAY * 3; for (const b of s.beasts) { b.state = 'flee'; b.path = null; } break;
      case 'weather': {
        const d = this.dayNum();
        for (const k of [d, d + 1]) { const e = this.dayWeather(k); e.kind = 'clear'; e.start = 0; e.len = 0; }
        if (s.weather) s.weather.t = 0;
        break;
      }
    }
    this.rpgGainXp(c, sp.lvl ? 10 * sp.lvl : 2);
    if (!['fireball', 'lightning'].includes(id)) this.log(`${first(c)} cast ${sp.name}!`);
    this.emit('spell', id); this.emit('res');
    return true;
  },

  // ── the Guild Hall: a party, the quest board and expeditions ──
  guildOf(b) { const d = b.data || (b.data = {}); d.party = d.party || []; d.logs = d.logs || []; return d; },
  partyMembers(b) { return this.guildOf(b).party.map(id => this.vById.get(id)).filter(Boolean); },
  partyToggle(b, v) {
    const d = this.guildOf(b);
    if (d.exp) return { ok: false, why: 'The party is away on an expedition' };
    d.party = d.party.filter(id => this.vById.has(id));
    if (d.party.includes(v.id)) { d.party = d.party.filter(id => id !== v.id); return { ok: true, joined: false }; }
    if (v.jail > this.s.time) return { ok: false, why: `${first(v)} is in the stocks until morning` };
    if (d.party.length >= 4) return { ok: false, why: 'A party has at most 4 adventurers' };
    if (stageOf(v) !== 'adult') return { ok: false, why: 'Only grown-ups go adventuring' };
    if (this.s.buildings.some(o => o !== b && o.type === 'guild' && o.data?.party?.includes(v.id))) return { ok: false, why: 'Already in another party' };
    d.party.push(v.id);
    if (classOf(v) === 'commoner') { v.cls = aptitudeOf(v); v.hp = Math.min(v.hp ?? maxHp(v), maxHp(v)); this.log(`${v.name} began training as a ${CLASSES[v.cls].name}.`); }
    return { ok: true, joined: true };
  },
  canDepart(b, q) {
    const d = this.guildOf(b), vs = this.partyMembers(b);
    if (!b.built) return { ok: false, why: 'Still being built' };
    if (d.exp) return { ok: false, why: 'Already on an expedition' };
    if (vs.length < 2) return { ok: false, why: 'Needs at least 2 adventurers' };
    const jailed = vs.find(v => v.jail > this.s.time);
    if (jailed) return { ok: false, why: `${first(jailed)} is in the stocks until morning` };
    const tired = vs.find(v => v.ko > 0 || v.downed || v.quest || v.hp < maxHp(v) * 0.5);
    if (tired) return { ok: false, why: `${first(tired)} needs to rest first` };
    if (vs.some(v => stageOf(v) !== 'adult')) return { ok: false, why: 'Everyone must be a grown-up' };
    if ((this.s.res.food || 0) < SUPPLIES * vs.length) return { ok: false, why: `Needs ${SUPPLIES * vs.length} food for supplies` };
    return { ok: true };
  },
  startExpedition(b, qid) {
    const q = EXPEDITIONS.find(o => o.id === qid);
    if (!q || !this.canDepart(b, q).ok) return false;
    const s = this.s, d = this.guildOf(b), vs = this.partyMembers(b), now = s.time;
    this.pay({ food: SUPPLIES * vs.length });
    for (const v of vs) this.equip(v, 'party', true);
    const scrolls = this.takeScrolls?.() || 0;
    const out = runExpedition(q, vs, mulberry32(((this.rng() * 1e9) | 0) ^ b.id), { bless: this.buffOn('bless'), buffs: s.rpg?.buffs, now, scrolls, harsh: s.events?.mode === 'harsh' });
    const n = out.lines.length;
    d.exp = { q: q.id, t0: now, dur: q.days * DAY, log: out.lines.map((msg, i) => ({ f: i === 0 ? 0 : i === n - 1 ? 1 : 0.08 + 0.84 * i / (n - 1), msg })), out, members: vs.map(v => v.id) };
    for (const v of vs) {
      v.prevWork = v.work; this.unassign(v);
      v.job = 'adventurer'; v.quest = { bid: b.id, phase: 'leaving' }; v.engage = null;
      this.dropTask(v); v.thinkCd = 0;
    }
    this.log(`${vs.map(first).join(', ')} set off from the Guild Hall for ${q.name}.`);
    this.emit('toast', `The party set off for ${q.name}!`, 'sword');
    this.emit('sfx', 'level');
    return true;
  },
  expTick(b) {
    const s = this.s, d = b.data, e = d.exp, q = EXPEDITIONS.find(o => o.id === e.q), now = s.time;
    if (!e.back && now >= e.t0 + e.dur) {
      e.back = true;
      const out = e.out, got = [];
      for (const id of e.members) {
        const v = this.vById.get(id); if (!v) continue;
        if (out.dead?.includes(id)) { this.passAway(v, { cause: 'wounds', where: q.name }); continue; }
        v.hp = Math.min(maxHp(v), out.hp[id] ?? v.hp);
        if (v.quest) v.quest.phase = 'returning';
        this.rpgGainXp(v, out.xp);
      }
      for (const [k, n] of Object.entries(out.loot)) {
        if (k === 'rare') {
          const tokens = s.tokens || (s.tokens = {}), owned = t => (tokens[t] || 0) + s.buildings.filter(o => o.type === t).length;
          const t = [...RARE].sort((a, c) => owned(a) - owned(c))[0];
          tokens[t] = (tokens[t] || 0) + 1; got.push(`a ${DECOR[t].name}`); continue;
        }
        if (n <= 0) continue;
        const add = ['coins', 'gems'].includes(k) ? (s.res[k] += n, this.track(k, n), n) : this.add(k, n, false);
        if (add) got.push(`${add} ${k === 'ore' ? 'iron ore' : k === 'iron' ? 'iron bars' : GOODS[k] ? GOODS[k].name.toLowerCase() : k}`);
      }
      s.stats.expeditions = (s.stats.expeditions || 0) + (out.ok ? 1 : 0);
      s.stats.crits = (s.stats.crits || 0) + out.crits;
      this.addXp(20 + q.lvl * 15);
      e.got = got;
      this.log(`The party is back from ${q.name}${got.length ? `: ${got.join(', ')}` : ''}.`);
      this.emit('toast', `${out.ok ? 'The party is home' : 'The party limped home'} from ${q.name}!${got.length ? ' ' + got.slice(0, 3).join(' · ') : ''}`, out.ok ? 'trophy' : 'heart');
      this.emit('sfx', out.ok ? 'level' : 'pop'); this.emit('res');
    }
    if (e.back && !e.members.some(id => this.vById.get(id)?.quest)) {
      d.logs.unshift({ q: e.q, t: now, lines: e.out.lines, got: e.got || [], ok: e.out.ok });
      d.logs = d.logs.slice(0, 4);
      d.exp = null;
    }
  },
  expProgress(b) { const e = b.data?.exp; return e ? Math.min(1, (this.s.time - e.t0) / e.dur) : 0; },
};
export function installRpg(Sim) { for (const [k, fn] of Object.entries(RPG)) Sim.prototype[k] = fn; }
