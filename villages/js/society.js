// Who the villagers are, and where they live.
//
//  - Races. Every villager belongs to one of the D&D peoples (flavoured on the
//    SRD 5.1, retold in our own words): human, elf, half-elf, dwarf, halfling,
//    gnome, half-orc, tiefling or dragonborn. A race adds ability scores, a look
//    (height, build, skin, ears, horns…), a trait, and a knack for some jobs.
//    Children of two peoples take after one parent (a human and an elf have a
//    half-elf).
//  - Genders. Each villager is a woman, a man or nonbinary; it picks their name
//    and the words the game uses for them.
//  - Classes. Everyone starts as a Commoner (rpg.js). Joining the watch trains a
//    fighter or ranger, a wizard tower trains a wizard, a guild party trains
//    their best fit (rpg.js partyToggle).
//  - Homes. Each household (a couple and their children, or a single grown-up)
//    gets a home of its own, named after them ("Cobble Cottage"). Homes pass to
//    family when the owner moves on, and can be renamed. Spare beds take lodgers.
//  - The Archmage. Each Wizard Tower's most accomplished wizard (level 3+, or a
//    Magister from the Arcane University) leads it: the tower's wizards study 25%
//    faster.
// Sim-side; installed from addons.js.
import { stageOf, lvlOf, defOf, housingOf } from './sim.js';
import { CLASSES, classOf, aptitudeOf, maxHp } from './rpg.js';
import { SKINS, HAIRS, LAST_NAMES, HOME_TYPES, LODGING_TYPES } from './data.js';
import { mulberry32 } from './rng.js';

const pick = (r, a) => a[(r() * a.length) | 0];
const first = v => v.name.split(' ')[0];
const surname = v => v.name.split(' ').slice(1).join(' ') || first(v);

export const RACES = {
  human: { name: 'Human', w: 30, bonus: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, height: 1, girth: 1, parts: [],
    trait: 'Versatile', desc: 'Adaptable and ambitious: +1 to every ability. Humans take to any job.', jobs: {} },
  elf: { name: 'Elf', w: 11, bonus: { dex: 2, int: 1 }, height: 1.07, girth: 0.9, parts: ['race_elf'],
    skins: [0xf8dcc4, 0xf3d2b4, 0xe2bf96, 0xc49470, 0x9d7254], hairs: [0xeedc9a, 0xd8d0c0, 0x1b1b1b, 0x6b3a1e, 0x2f3a5a, 0xb84a2a],
    trait: 'Trance', desc: 'Keen senses, and a four-hour trance instead of sleep, so they work a little later into the night. +10% as foresters, foragers, fishers and wizards.',
    jobs: { forester: 1.1, forager: 1.1, fisher: 1.1, wizard: 1.1 } },
  halfelf: { name: 'Half-Elf', w: 6, bonus: { cha: 2, dex: 1, con: 1 }, height: 1.03, girth: 0.95, parts: ['race_elf'], ears: 0.72,
    trait: 'Two Worlds', desc: 'At home among humans and elves alike: +2 CHA and +1 to two others. +10% as merchants, innkeepers, barkeeps, bards and teachers.',
    jobs: { merchant: 1.1, innkeeper: 1.1, barkeep: 1.1, bard: 1.1, teacher: 1.1 } },
  dwarf: { name: 'Dwarf', w: 11, bonus: { str: 2, con: 2 }, height: 0.8, girth: 1.28, parts: ['race_beard'],
    skins: [0xf0c8a8, 0xd9a882, 0xb98060, 0x8a5a40], hairs: [0xa8452a, 0x3b2416, 0x1b1b1b, 0xd8d0c0, 0x8a5a2a, 0xc98a3a],
    trait: 'Stonecunning', desc: 'Sturdy and stubborn: +2 STR and CON. +15% as miners, masons and smiths, +10% as brewers.',
    jobs: { miner: 1.15, mason: 1.15, smith: 1.15, brewer: 1.1 } },
  halfling: { name: 'Halfling', w: 10, bonus: { dex: 2, cha: 1 }, height: 0.7, girth: 1.06, parts: [],
    trait: 'Lucky', desc: 'Lucky: in a fight they reroll a natural 1. Halflings love good food and company: +10% on farms, orchards, coops and ovens, +15% behind a bar.',
    jobs: { farmer: 1.1, picker: 1.1, herder: 1.1, baker: 1.1, innkeeper: 1.15, barkeep: 1.15 } },
  gnome: { name: 'Gnome', w: 8, bonus: { int: 2, con: 1 }, height: 0.66, girth: 1, parts: ['race_gnome'],
    hairs: [0xe8e0d0, 0xc9a050, 0x6b4226, 0xd96a4a, 0xb08ad0],
    trait: 'Tinker', desc: 'Curious inventors: +2 INT, +1 CON. +10% as sawyers, weavers and smiths, +15% studying at the Library or the University.',
    jobs: { sawyer: 1.1, weaver: 1.1, smith: 1.1, scholar: 1.15, student: 1.15, professor: 1.1 } },
  halforc: { name: 'Half-Orc', w: 7, bonus: { str: 2, con: 1 }, height: 1.05, girth: 1.2, parts: ['race_tusks'],
    skins: [0x9ab27e, 0x86a06c, 0xa9b98e, 0x768f60, 0xb1b48c], hairs: [0x1b1b1b, 0x3b2416, 0x4a3020, 0x5a5a5a],
    trait: 'Relentless Endurance', desc: 'Once per fight, when knocked to 0 hit points they stay on their feet. +15% as woodcutters, +10% as miners, guards and constables.',
    jobs: { woodcutter: 1.15, miner: 1.1, guard: 1.1, constable: 1.1 } },
  tiefling: { name: 'Tiefling', w: 7, bonus: { cha: 2, int: 1 }, height: 1, girth: 0.95, parts: ['race_horns', 'race_tail'],
    skins: [0xc65a5a, 0xb0506e, 0x8f5a9a, 0xd8846c, 0x7a62a8], hairs: [0x1b1b1b, 0x2a1a3a, 0x5a1a2a, 0xd8d0c0, 0x3a2a5a],
    horns: [0x3a2a30, 0x5a3a2a, 0x2a2a3a, 0xd8c8b0],
    trait: 'Infernal Legacy', desc: 'Touched by old magic: +2 CHA, +1 INT. +15% as merchants, +10% as wizards, bards and innkeepers.',
    jobs: { merchant: 1.15, wizard: 1.1, bard: 1.1, innkeeper: 1.1 } },
  dragonborn: { name: 'Dragonborn', w: 7, bonus: { str: 2, cha: 1 }, height: 1.08, girth: 1.15, parts: ['race_snout'], noHair: true,
    skins: [0xc9a24a, 0x4f7fc0, 0x5a9a4a, 0xb84a3a, 0xc8ccd4, 0xb87a3a], horns: [0xe8dcc0, 0x3a3030, 0xd8c8a0],
    trait: 'Breath Weapon', desc: 'Draconic blood: once per fight they breathe fire on up to two foes. +10% as guards, constables, smiths and miners.',
    jobs: { guard: 1.1, constable: 1.1, smith: 1.1, miner: 1.1 } },
};
export const RACE_ORDER = Object.keys(RACES);

export const GENDERS = {
  f: { name: 'Woman', kid: 'Girl', pro: 'she/her', they: 'she', them: 'her', their: 'her' },
  m: { name: 'Man', kid: 'Boy', pro: 'he/him', they: 'he', them: 'him', their: 'his' },
  x: { name: 'Nonbinary', kid: 'Child', pro: 'they/them', they: 'they', them: 'them', their: 'their' },
};
export const pronouns = v => GENDERS[v.gender] || GENDERS.x;

// first names: the village's own (shared by humans, halflings and half-elves), plus each people's
const FIRST = {
  common: {
    f: ['Ada', 'Cora', 'Effie', 'Hazel', 'June', 'Nell', 'Rosa', 'Una', 'Vera', 'Wren', 'Yara', 'Bea', 'Dot', 'Fern', 'Ivy', 'Juno', 'Olive', 'Poppy', 'Tilly', 'Clover', 'Iris', 'Maple', 'Saffron', 'Lark', 'Mabel', 'Greta', 'Daisy', 'Elsie', 'Marigold', 'Winnie'],
    m: ['Bram', 'Finn', 'Gus', 'Ivo', 'Milo', 'Otto', 'Ned', 'Hob', 'Jasper', 'Basil', 'Arlo', 'Flint', 'Dill', 'Tam', 'Alfie', 'Barnaby', 'Cedric', 'Edmund', 'Felix', 'Rufus', 'Silas', 'Wilf', 'Teddy', 'Hugo'],
    x: ['Kit', 'Pip', 'Quill', 'Sage', 'Lou', 'Moss', 'Rue', 'Sol', 'Bo', 'Elm', 'Ember', 'Linden', 'Rowan', 'Nutmeg', 'Clem', 'Dell', 'Hollis', 'Ash', 'Robin', 'Sparrow'],
  },
  elf: { f: ['Aelith', 'Sylvara', 'Thaliel', 'Eirwen', 'Mirael', 'Lyria', 'Naeris', 'Faela', 'Ilsevel', 'Shalia'],
    m: ['Caelith', 'Thalorin', 'Elvaran', 'Ithrel', 'Faelar', 'Sorin', 'Aerdan', 'Lethis', 'Vaelor', 'Quendris'], x: ['Ilyr', 'Seren', 'Aelis', 'Nimue', 'Elowen', 'Sylas'] },
  dwarf: { f: ['Brunna', 'Dagmar', 'Helka', 'Ingra', 'Marta', 'Sigrun', 'Torva', 'Vistra', 'Gudrun', 'Amber'],
    m: ['Balgrim', 'Dorn', 'Gromli', 'Harbek', 'Korrin', 'Orsik', 'Thrain', 'Vondal', 'Brottor', 'Fargrim'], x: ['Brin', 'Kell', 'Durra', 'Rurik', 'Tova'] },
  gnome: { f: ['Bimpnottin', 'Carlin', 'Ellywick', 'Nissa', 'Orla', 'Roywyn', 'Tana', 'Zanna', 'Lilli', 'Breena'],
    m: ['Alston', 'Boddynock', 'Dimble', 'Fonkin', 'Glim', 'Orryn', 'Roondar', 'Wrenn', 'Zook', 'Jebeddo'], x: ['Pock', 'Tinker', 'Fizz', 'Nim', 'Wobble'] },
  halforc: { f: ['Baggi', 'Engong', 'Kansif', 'Myev', 'Ovak', 'Shautha', 'Volen', 'Yevelda'],
    m: ['Dench', 'Feng', 'Gell', 'Henk', 'Holg', 'Krusk', 'Ront', 'Shump', 'Thokk', 'Imsh'], x: ['Grisk', 'Urra', 'Mogg', 'Tarsk'] },
  tiefling: { f: ['Akta', 'Bryseis', 'Kallista', 'Lerissa', 'Makaria', 'Nemeia', 'Orianna', 'Rieta'],
    m: ['Akmenos', 'Amnon', 'Barakas', 'Damakos', 'Ekemon', 'Kairon', 'Leucis', 'Mordai'], x: ['Hope', 'Ember', 'Solace', 'Reverie', 'Ardent', 'Wander', 'Carrion', 'Quiet'] },
  dragonborn: { f: ['Akra', 'Biri', 'Daar', 'Harann', 'Kava', 'Korinn', 'Mishann', 'Sora', 'Thava', 'Uadjit'],
    m: ['Arjhan', 'Balasar', 'Bharash', 'Donaar', 'Ghesh', 'Kriv', 'Medrash', 'Nadarr', 'Rhogar', 'Torinn'], x: ['Pandjed', 'Shamash', 'Tarhun', 'Vyth', 'Zorrin'] },
};
FIRST.halfling = FIRST.common; FIRST.human = FIRST.common;
FIRST.halfelf = { f: [...FIRST.common.f, ...FIRST.elf.f], m: [...FIRST.common.m, ...FIRST.elf.m], x: [...FIRST.common.x, ...FIRST.elf.x] };
const LAST = {
  human: LAST_NAMES, halfelf: LAST_NAMES,
  elf: ['Moonbrook', 'Silverbough', 'Starwhisper', 'Dawnpetal', 'Willowshade', 'Nightbreeze', 'Amberleaf'],
  dwarf: ['Ironhearth', 'Stonebraid', 'Copperkettle', 'Deepdelve', 'Anvilsong', 'Granitefist', 'Ambermug'],
  halfling: ['Goodbarrel', 'Applebottom', 'Tealeaf', 'Hillpocket', 'Puddlefoot', 'Brushgather', 'Thorngage'],
  gnome: ['Cogwhistle', 'Fizzlewick', 'Tinkerton', 'Brassbutton', 'Sprocket', 'Beren', 'Murnig'],
  halforc: ['Tuskwood', 'Gravelfist', 'Thornhide', 'Ashgrip', 'Oakhewer', 'Boulderback'],
  tiefling: ['Ashmantle', 'Cinderfell', 'Duskwine', 'Emberly', 'Vesper', 'Nightingale'],
  dragonborn: ['Brasscale', 'Embermaw', 'Skyfang', 'Goldhorn', 'Stormcrest', 'Kimbatuul', 'Myastan'],
};
// names from the old single list, so old saves get sensible genders
const OLD_F = new Set(FIRST.common.f), OLD_M = new Set(FIRST.common.m);

export function pickRace(r) {
  let t = r() * RACE_ORDER.reduce((a, k) => a + RACES[k].w, 0);
  for (const k of RACE_ORDER) { t -= RACES[k].w; if (t <= 0) return k; }
  return 'human';
}
export function pickGender(r) { const t = r(); return t < 0.47 ? 'f' : t < 0.94 ? 'm' : 'x'; }
function childRace(a, b, r) {
  a = a || 'human'; b = b || 'human';
  if (a === b) return a;
  if ((a === 'human' && b === 'elf') || (a === 'elf' && b === 'human')) return 'halfelf';
  if ((a === 'human' && b === 'halfelf') || (a === 'halfelf' && b === 'human')) return r() < 0.5 ? 'human' : 'halfelf';
  return r() < 0.5 ? a : b;
}
export const firstNameFor = (race, gender, r) => pick(r, FIRST[race]?.[gender] || FIRST.common[gender] || FIRST.common.x);
const lastNameFor = (race, r) => pick(r, LAST[race] || LAST_NAMES);
// a look that fits the people: skin, hair, horn colour
function lookFor(race, r) {
  const R = RACES[race] || RACES.human, o = { skin: pick(r, R.skins || SKINS), hair: pick(r, R.hairs || HAIRS) };
  if (R.horns) o.horn = pick(r, R.horns);
  return o;
}
function applyBonus(v) {
  if (!v.abil || v.raceB) return;
  for (const [k, n] of Object.entries(RACES[v.race]?.bonus || {})) v.abil[k] = Math.min(20, (v.abil[k] || 10) + n);
  v.raceB = 1;
  v.hp = maxHp(v);
}

// how a household is named on its door
const HOME_NOUN = { cottage: ['Cottage', 'Cottage', 'House'], tiled: ['House', 'House', 'Hall'], rowhouse: ['Row House','Town House','Town House'], manor: ['Manor','Manor','Estate'] };


export function installSociety(sim, fresh = false) {
  const s = sim.s;
  Object.assign(sim, SOC);

  // newcomers and babies get a people, a gender and a name that fits
  const spawn = sim.spawnVillager.bind(sim);
  sim.spawnVillager = (sid, x, z, o = {}) => {
    const r = sim.rng, pa = (o.parents || []).map(id => sim.vById.get(id)).filter(Boolean);
    const race = o.race || (pa.length === 2 ? childRace(pa[0].race, pa[1].race, r) : pickRace(r));
    const gender = o.gender || pickGender(r);
    const last = o.last || lastNameFor(race, r);
    const look = { ...lookFor(race, r), ...(o.look || {}), race, gender, name: `${firstNameFor(race, gender, r)} ${last}` };
    // a child takes the colouring of the parent whose people they belong to
    if (pa.length === 2) {
      const same = pa.filter(p => p.race === race);
      if (same.length === 1) { look.skin = same[0].skin; if (same[0].horn != null) look.horn = same[0].horn; }
      if (!same.length && race !== 'halfelf') look.skin = lookFor(race, r).skin;
      if (!look.horn && RACES[race].horns) look.horn = lookFor(race, r).horn;
    }
    const v = spawn(sid, x, z, { ...o, last, look }); sim._beds = null; return v;
  };
  // ability bonuses for newcomers (children inherit theirs from their parents' scores)
  const init = sim.rpgInit.bind(sim);
  sim.rpgInit = (v, o = {}) => {
    init(v, o);
    if (!(o.parents || []).length) applyBonus(v); else v.raceB = 1;
  };
  // a knack for some jobs
  const abilityWork = sim.abilityWork.bind(sim);
  sim.abilityWork = v => {
    let k = abilityWork(v);
    const job = v.work ? v.job : null;
    if (job) k *= RACES[v.race]?.jobs?.[job] || 1;
    if (job === 'wizard' && v.work) { const t = sim.bById.get(v.work), am = t && sim.archmageOf(t); if (am) k *= am === v ? 1.4 : 1.25; }
    return k;
  };
  // elves trance for four hours: they keep working a little after dark
  const sleepy = sim.sleepy.bind(sim);
  sim.sleepy = v => {
    if ((v.race === 'elf' || v.race === 'halfelf' && v.id % 2) && stageOf(v) !== 'child') { const f = sim.dayFrac(); if (f >= 0.935 && f < 0.985) return false; }
    return sleepy(v);
  };
  // the watch and the wizard tower train a commoner into a class
  const assign = sim.assign.bind(sim);
  sim.assign = (b, v) => {
    const before = new Set(b.workers), ok = assign(b, v);
    if (ok) for (const id of b.workers) if (!before.has(id)) sim.trainFor(sim.vById.get(id), defOf(b.type).job);
    return ok;
  };
  // homes belong to households
  sim.bedFor = v => {
    const key = (s.time / 5) | 0;
    if (sim._beds?.key !== key) sim._beds = { key, map: sim.settleHomes() };
    return sim._beds.map.get(v.id) || { b: s.buildings.find(o => o.type === 'campfire' && o.sid === v.home) || s.buildings.find(o => o.type === 'campfire'), n: 0 };
  };
  for (const method of ['addBuilding', 'demolish', 'finishBuilding', 'finishUpgrade', 'lifeCycle', 'passAway']) {
    const fn = sim[method].bind(sim);
    sim[method] = (...a) => { const out = fn(...a); sim._beds = null; return out; };
  }
  const second = sim.second.bind(sim);
  sim.second = () => { second(); if ((sim.socT = (sim.socT || 0) + 1) % 5 === 0) sim.socSecond(); };

  // old saves: everyone gets a people and a gender, seeded by id so it never changes
  for (const v of s.villagers) {
    if (!v.race) {
      const r = mulberry32(((v.id * 2246822519) ^ (s.seed || 7)) >>> 0);
      const pa = (v.parents || []).map(id => sim.vById.get(id)).filter(p => p?.race);
      v.race = pa.length === 2 ? childRace(pa[0].race, pa[1].race, r) : pa.length ? pa[0].race : pickRace(r);
      const f = first(v);
      v.gender = OLD_F.has(f) ? 'f' : OLD_M.has(f) ? 'm' : pickGender(r);
      if (fresh) v.name = `${firstNameFor(v.race, v.gender, r)} ${lastNameFor(v.race, r)}`;
      if (v.race !== 'human') {
        const same = pa.find(p => p.race === v.race);
        if (same) { v.skin = same.skin; if (same.horn) v.horn = same.horn; }
        else Object.assign(v, lookFor(v.race, r));
      }
      applyBonus(v);
    }
    if (!v.gender) v.gender = 'x';
    if (v.cls === undefined) {
      const inParty = s.buildings.some(b => b.type === 'guild' && b.data?.party?.includes(v.id));
      if (v.job === 'wizard') v.cls = 'wizard';
      else if (v.job === 'guard') v.cls = aptitudeOf(v, ['fighter', 'ranger']);
      else if (inParty || v.quest || (v.lvl || 1) > 1) v.cls = aptitudeOf(v);
      else v.cls = null;
      v.hp = Math.min(v.hp ?? maxHp(v), maxHp(v));
    }
  }
  sim._homesQuiet = true; sim.settleHomes(); sim._homesQuiet = false;
}

const SOC = {
  raceOf(v) { return RACES[v.race] || RACES.human; },
  // the watch, a wizard tower and the university turn a commoner into something more
  trainFor(v, job) {
    if (!v || classOf(v) !== 'commoner') return;
    const to = job === 'guard' ? aptitudeOf(v, ['fighter', 'ranger']) : job === 'constable' ? aptitudeOf(v, ['fighter', 'rogue']) : job === 'wizard' || job === 'student' ? 'wizard' : job === 'bard' ? 'bard' : job === 'acolyte' ? aptitudeOf(v, ['cleric', 'paladin']) : job === 'trainer' ? aptitudeOf(v, ['fighter', 'ranger', 'rogue']) : job === 'scout' ? 'ranger' : job === 'locksmith' ? 'rogue' : null;
    if (!to) return;
    v.cls = to; v.hp = Math.min(v.hp ?? maxHp(v), maxHp(v));
    this.log(`${v.name} began training as a ${CLASSES[to].name}.`);
  },

  // ── households and homes ──
  householdKey(v) {
    if (stageOf(v) === 'child') {
      const p = (v.parents || []).map(id => this.vById.get(id)).find(o => o && o.home === v.home);
      if (p) return this.householdKey(p);
      return v.id;
    }
    const pa = v.partner && this.vById.get(v.partner);
    return pa && pa.home === v.home ? Math.min(v.id, pa.id) : v.id;
  },
  // who owns which home, and who sleeps where: households first, lodgers in spare beds
  settleHomes() {
    const s = this.s, map = new Map();
    for (const sid of Object.keys(s.unlocked)) {
      const folk = s.villagers.filter(o => o.home === sid).sort((a, b) => a.id - b.id);
      const houses = s.buildings.filter(b => b.built && b.sid === sid && HOME_TYPES.includes(b.type)).sort((a, b) => a.id - b.id);
      const fire = s.buildings.find(b => b.type === 'campfire' && b.sid === sid);
      const holds = new Map();
      for (const v of folk) { const k = this.householdKey(v); if (!holds.has(k)) holds.set(k, []); holds.get(k).push(v); }
      const holdOf = id => { const v = this.vById.get(id); return v && v.home === sid ? this.householdKey(v) : null; };
      const housed = new Map();          // household key -> house
      // keep owners in their homes; pass a home to family when its owner has gone
      for (const b of houses) {
        let k = b.owner != null ? holdOf(b.owner) : null;
        if (k == null && b.owner != null) {
          const heir = [...new Set([...(b.heirs || []), ...(b.fam || [])])].map(id => this.vById.get(id))
            .find(o => o && o.home === sid && stageOf(o) !== 'child' && !housed.has(this.householdKey(o))
              && !houses.some(h => h !== b && h.owner != null && holdOf(h.owner) === this.householdKey(o)));
          if (heir) { this.homeEvent(b, `${heir.name} inherited ${this.homeName(b, b.owner)}.`); b.owner = heir.id; k = this.householdKey(heir); }
          else { b.owner = null; b.paid = 0; }
        }
        if (k != null && housed.has(k)) { b.owner = null; b.paid = 0; k = null; }   // one home per household
        if (k != null) housed.set(k, b);
      }
      // empty homes go to households without one: families with children first
      const waiting = [...holds.entries()].filter(([k, m]) => !housed.has(k) && m.some(v => stageOf(v) !== 'child'))
        .sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
      for (const b of houses) {
        if (b.owner != null) continue;
        const w = waiting.shift(); if (!w) break;
        const head = w[1].filter(v => stageOf(v) !== 'child').sort((a, c) => c.age - a.age)[0];
        b.owner = head.id; b.paid = 0; b.since = s.time;
        housed.set(w[0], b);
        this.homeEvent(b, `The ${surname(head)} household moved into ${this.homeName(b)}.`);
      }
      // beds: each household sleeps at home; the rest lodge in spare beds, near family if they can
      const lodgings = s.buildings.filter(b => b.built && b.sid === sid && LODGING_TYPES.includes(b.type));
      const sleeping = [...houses, ...lodgings];
      const room = new Map(sleeping.map(b => [b, housingOf(b)]));
      const beds = [];
      for (const [k, m] of holds) {
        const b = housed.get(k);
        if (b) for (const v of m) { if (room.get(b) > 0) { room.set(b, room.get(b) - 1); map.set(v.id, { b, n: 0 }); } else beds.push(v); }
        else beds.push(...m);
      }
      for (const b of houses) {
        const k = b.owner != null ? holdOf(b.owner) : null, owner = this.homeOwner(b);
        b.fam = k != null ? (holds.get(k) || []).map(v => v.id) : [];
        if (owner) { b.heirs = [...new Set([owner.partner, ...(owner.kids || [])].filter(id => id != null))]; b.ownerName = owner.name; }
      }
      let n = 0;
      for (const v of beds) {
        const fam = (v.parents || []).map(id => this.vById.get(id)).map(p => p && map.get(p.id)?.b).find(b => b && room.get(b) > 0);
        const b = fam || sleeping.find(h => room.get(h) > 0);
        if (b) { room.set(b, room.get(b) - 1); map.set(v.id, { b, n: 0, lodger: true }); }
        else map.set(v.id, { b: fire, n: n++ });
      }
    }
    return map;
  },
  homeEvent(b, msg) { if (!this._homesQuiet) this.log(msg); },
  homeOwner(b) { return b.owner != null ? this.vById.get(b.owner) || null : null; },
  homeName(b, ownerId = b.owner) {
    if (b.hname) return b.hname;
    const o = ownerId != null ? this.vById.get(ownerId) : null, nouns = HOME_NOUN[b.type];
    if (!nouns) return defOf(b.type).name;
    const noun = nouns[Math.min(2, lvlOf(b) - 1)];
    const name = o || (ownerId != null && b.ownerName ? { name: b.ownerName } : null);
    return name ? `${surname(name)} ${noun}` : `Empty ${noun.toLowerCase()}`;
  },
  renameHome(b, name) {
    if (!b || ![...HOME_TYPES,...LODGING_TYPES].includes(b.type)) return false;
    const n = this.cleanName(name);
    b.hname = n || null;
    return true;
  },
  homeOf(v) { const bd = this.bedFor(v); return bd.b && [...HOME_TYPES,...LODGING_TYPES].includes(bd.b.type) ? bd.b : null; },
  ownsHome(v) { return this.s.buildings.find(b => b.owner === v.id && HOME_TYPES.includes(b.type)) || null; },

  // ── wizard towers and their Archmage ──
  canArchmage(v) { return v && v.job === 'wizard' && ((v.lvl || 1) >= 3 || (v.tier || 0) >= 4); },
  archmageOf(b) {
    if (b.type !== 'wizard') return null;
    const v = b.data?.archmage != null ? this.vById.get(b.data.archmage) : null;
    return v && v.work === b.id && this.canArchmage(v) ? v : null;
  },
  appointArchmage(b, v) {
    if (!this.canArchmage(v) || v.work !== b.id) return false;
    (b.data || (b.data = {})).archmage = v.id; b.data.amPicked = true;
    this.log(`${v.name} was named Archmage of the tower.`);
    this.story('archmage', `${v.name} was named Archmage of the tower.`, [v], 'staff');
    return true;
  },
  // the archmage of the most accomplished tower: the one who leads a magocracy
  highArchmage() {
    let best = null;
    for (const b of this.s.buildings) { const a = b.type === 'wizard' && b.built ? this.archmageOf(b) : null; if (a && (!best || (a.lvl || 1) > (best.lvl || 1))) best = a; }
    for (const v of this.s.villagers) if ((v.tier || 0) >= 4 && v.job === 'professor' && (!best || (v.lvl || 1) > (best.lvl || 1))) best = v;
    return best;
  },
  // a title for the villager panel and the clothes they wear
  titleOf(v) {
    const g = this.s.gov;
    if (g?.leader === v.id && this.govInfo) return this.govInfo().title;
    if (this.s.buildings.some(b => b.type === 'wizard' && this.archmageOf(b) === v)) return 'Archmage';
    return null;
  },
  socSecond() {
    const s = this.s;
    // every tower picks its best wizard as Archmage unless the player chose one
    for (const b of s.buildings) {
      if (b.type !== 'wizard' || !b.built) continue;
      const d = b.data || (b.data = {});
      if (this.archmageOf(b)) continue;
      const best = b.workers.map(id => this.vById.get(id)).filter(v => this.canArchmage(v)).sort((a, c) => (c.lvl || 1) - (a.lvl || 1) || (c.abil?.int || 10) - (a.abil?.int || 10))[0];
      if (best) {
        d.archmage = best.id;
        this.log(`${best.name} became Archmage of the Wizard Tower.`);
        this.story('archmage', `${best.name} became Archmage of the Wizard Tower.`, [best], 'staff');
      }
    }
    // titles drive what people wear (crown, chain of office, the archmage's hat)
    for (const v of s.villagers) v.title = this.titleOf(v);
  },
};
