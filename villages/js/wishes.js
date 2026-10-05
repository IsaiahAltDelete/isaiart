// Wishes and pets: the villagers as people.
//
// Now and then a villager makes a small wish, shown as a thought bubble over their
// head and on the Story page: a bench by their door, somewhere to unwind, to study,
// a pet, a treat, a job they'd love, to make up with a rival, a swing for a child.
// Some come true when the village changes (build the bench); some have a one-tap
// answer on their panel (adopt the pet, give the treat). Granting a wish makes them
// beam, lifts the village a little and writes a happy Story entry. Wishes that go
// unanswered fade after two days, no harm done.
// Pets follow their owners about (drawn by lifeview.js) and cheer the village.
import { stageOf, defOf, workersOf, DAY } from './sim.js';
import { JOBS, GOODS } from './data.js';
import { pronouns } from './society.js';
import { jobFit } from './rpg.js';
import { addIcons } from './icons.js';

addIcons({
  paw: '<ellipse cx="16" cy="21" rx="7" ry="6" fill="#c98a4a" stroke="#5b3a1e" stroke-width="1.6"/><circle cx="8" cy="13" r="3" fill="#c98a4a" stroke="#5b3a1e" stroke-width="1.4"/><circle cx="13" cy="8" r="3" fill="#c98a4a" stroke="#5b3a1e" stroke-width="1.4"/><circle cx="19" cy="8" r="3" fill="#c98a4a" stroke="#5b3a1e" stroke-width="1.4"/><circle cx="24" cy="13" r="3" fill="#c98a4a" stroke="#5b3a1e" stroke-width="1.4"/>',
  wish: '<path d="M16 3l3.6 7.4 8.2 1.2-5.9 5.8 1.4 8.1L16 21.6l-7.3 3.9 1.4-8.1-5.9-5.8 8.2-1.2z" fill="#ffd54f" stroke="#b07a10" stroke-width="1.6" stroke-linejoin="round"/><circle cx="25" cy="6" r="1.6" fill="#ffe9a0"/><circle cx="6" cy="24" r="1.3" fill="#ffe9a0"/>',
});

const first = v => v.name.split(' ')[0];
// "wishes for a bench", but "wishes to study"
export const wishVerb = text => text.startsWith('to ') ? 'wishes' : 'wishes for';
const PET_NAMES = { cat: ['Biscuit', 'Pip', 'Mittens', 'Saffron', 'Pudding', 'Tansy', 'Juniper', 'Marmalade', 'Socks', 'Clove'],
  dog: ['Barley', 'Scout', 'Muddle', 'Bramble', 'Rufus', 'Pepper', 'Hazel', 'Turnip', 'Wiggles', 'Oatcake'] };
export const PET_COST = 15;
const near = (sim, b, types, r) => !!b && sim.near(b, types, r);
// only wish for what the player could build today (unlocked, and not a rare find)
const buildable = (sim, types) => types.some(t => { const d = defOf(t); return d && !d.rare && (d.lvl || 1) <= sim.s.level; });

// each wish: who can make it, when it's already true, how to grant it, and the words
export const WISHES = {
  bench: { icon: 'flower', who: v => stageOf(v) !== 'child',
    want: (sim, v) => !!sim.homeOf(v) && !near(sim, sim.homeOf(v), ['bench', 'swing', 'statue', 'fountain'], 4),
    met: (sim, v) => near(sim, sim.homeOf(v), ['bench', 'swing', 'statue', 'fountain'], 4),
    text: v => `a bench by ${pronouns(v).their} door`, how: 'Place a bench (or a statue, swing or fountain) within 4 tiles of their home.',
    done: v => `${first(v)}'s wish came true: a bench by the door, for watching the world go by.` },
  flowers: { icon: 'flower', who: v => stageOf(v) !== 'child',
    want: (sim, v) => !!sim.homeOf(v) && !near(sim, sim.homeOf(v), ['flowers', 'flowerarch', 'sunflowers', 'memorial'], 4),
    met: (sim, v) => near(sim, sim.homeOf(v), ['flowers', 'flowerarch', 'sunflowers', 'memorial'], 4),
    text: () => 'flowers outside the house', how: 'Plant flowers (or an arch or sunflowers) within 4 tiles of their home.',
    done: v => `${first(v)}'s wish came true: flowers by the house. ${pronouns(v).they[0].toUpperCase() + pronouns(v).they.slice(1)} can't stop smiling.` },
  unwind: { icon: 'smile', who: v => stageOf(v) === 'adult',
    want: (sim, v) => !!sim.homeOf(v) && buildable(sim, ['park', 'pub', 'tavern', 'bathhouse', 'theatre']) && !near(sim, sim.homeOf(v), ['park', 'pub', 'tavern', 'bathhouse', 'theatre'], 14),
    met: (sim, v) => near(sim, sim.homeOf(v), ['park', 'pub', 'tavern', 'bathhouse', 'theatre'], 14),
    text: () => 'somewhere nearby to unwind', how: 'Build a Park, Pub, Tavern, Bathhouse or Theatre near their home.',
    done: v => `${first(v)}'s wish came true: somewhere to put ${pronouns(v).their} feet up after work.` },
  study: { icon: 'book', who: v => stageOf(v) === 'adult' && (v.tier || 0) < 3,
    want: (sim, v) => sim.s.buildings.some(b => b.type === 'library' && b.built && b.sid === v.home && b.workers.length < workersOf(b)),
    met: (sim, v, w) => v.job === 'scholar' || (v.tier || 0) > (w.data.tier || 0),
    text: () => 'to study at the Library', how: 'Give them the Scholar job at the Library.', act: 'study', actLabel: 'Send them to study',
    done: v => `${first(v)}'s wish came true: a seat at the Library and a stack of books.` },
  job: { icon: 'hammer', who: v => stageOf(v) === 'adult',
    want: (sim, v) => !!dreamJob(sim, v), make: (sim, v) => ({ job: dreamJob(sim, v) }),
    met: (sim, v, w) => v.job === w.data.job,
    text: (v, w) => `to work as a ${JOBS[w.data.job]?.name.toLowerCase() || 'something new'}`, how: 'Give them that job (they would be good at it).', act: 'job', actLabel: 'Give them the job',
    done: (v, w) => `${first(v)}'s wish came true: a ${JOBS[w.data.job]?.name.toLowerCase()} at last, and good at it.` },
  treat: { icon: 'cheese', who: () => true,
    want: (sim) => ['cheese', 'honey', 'ale'].some(k => (sim.s.res[k] || 0) >= 1), make: (sim, v) => { const have = (stageOf(v) === 'child' ? ['honey', 'cheese'] : ['cheese', 'honey', 'ale']).filter(k => (sim.s.res[k] || 0) >= 1); return { good: have[(v.id + sim.dayNum()) % Math.max(1, have.length)] || 'honey' }; },
    met: () => false,
    text: (v, w) => `a little ${GOODS[w.data.good]?.name.toLowerCase() || 'treat'}`, how: 'Give them a treat from the store.', act: 'treat', actLabel: 'Give a treat',
    done: (v, w) => `${first(v)}'s wish came true: a little ${GOODS[w.data.good]?.name.toLowerCase()}, savoured slowly.` },
  pet: { icon: 'paw', who: v => !v.pet,
    want: (sim, v) => !sim.s.pets.some(p => p.owner === v.id) && sim.s.pets.length < Math.ceil(sim.s.villagers.length / 5), met: (sim, v) => sim.s.pets.some(p => p.owner === v.id), w: 0.5,
    text: v => stageOf(v) === 'child' ? 'a puppy or a kitten' : `a pet to keep ${pronouns(v).them} company`, how: `Adopt a cat or a dog for them (${PET_COST} coins).`, act: 'pet', actLabel: 'Adopt a pet',
    done: v => `${first(v)}'s wish came true: a new best friend with four paws.` },
  makeup: { icon: 'heart', who: v => stageOf(v) !== 'child',
    want: (sim, v) => (sim.rivalsOf?.(v) || []).length > 0, make: (sim, v) => ({ with: sim.rivalsOf(v)[0].v.id }),
    met: (sim, v, w) => (sim.affinity?.(v, w.data.with) ?? 0) > -10,
    text: (v, w, sim) => `to make up with ${first(sim.vById.get(w.data.with) || { name: 'an old rival' })}`, how: 'Arrange a picnic for the two of them (10 food), or wait for a festival.', act: 'picnic', actLabel: 'Arrange a picnic',
    done: (v, w, sim) => `${first(v)}'s wish came true: ${first(v)} and ${first(sim.vById.get(w.data.with) || { name: 'their rival' })} made up over a picnic.` },
  swing: { icon: 'party', who: v => stageOf(v) === 'child' && v.age >= 4,
    want: (sim, v) => !!sim.homeOf(v) && buildable(sim, ['park']) && !near(sim, sim.homeOf(v), ['swing', 'park'], 10), met: (sim, v) => near(sim, sim.homeOf(v), ['swing', 'park'], 10),
    text: () => 'a swing to play on', how: 'Build a Park near their home (or place a tree swing).',
    done: v => `${first(v)}'s wish came true: a swing! Higher, higher, all afternoon.` },
};
function dreamJob(sim, v) {
  const jobs = [...new Set(sim.s.buildings.filter(b => b.built && b.sid === v.home && defOf(b.type).workers && b.workers.length < workersOf(b)).map(b => defOf(b.type).job))]
    .filter(j => j && j !== v.job && sim.canDoJob(v, j) && jobFit(v, j) >= 4);
  return jobs.sort((a, b) => jobFit(v, b) - jobFit(v, a))[0] || null;
}

export function installWishes(sim) {
  const s = sim.s;
  s.pets ||= []; s.petId ||= 0;
  Object.assign(sim, WISH);
  const second = sim.second.bind(sim);
  sim.second = () => { second(); if ((sim.wishT = (sim.wishT || 0) + 1) % 5 === 0) sim.wishSecond(); };
  // pets cheer the village a little (each +0.25 happiness, at most +3)
  const second2 = sim.second;
  sim.second = () => { second2(); if (s.pets.length) s.happiness = Math.min(100, s.happiness + Math.min(3, s.pets.length * 0.25) * 0.05); };
}

const WISH = {
  openWishes() { return this.s.villagers.filter(v => v.wish && v.wish.until > this.s.time); },
  wishCap() { return Math.min(5, 1 + Math.floor(this.s.villagers.length / 12)); },
  makeWish(v, kind) {
    const W = WISHES[kind], s = this.s;
    if (!W || v.wish || !W.who(v) || !W.want(this, v)) return null;
    const w = { kind, made: s.time, until: s.time + DAY * 2, data: { tier: v.tier || 0, ...(W.make?.(this, v) || {}) } };
    if (kind === 'job' && !w.data.job) return null;
    v.wish = w; v.wishDay = this.dayNum();
    const t = W.text(v, w, this), msg = `${v.name} ${wishVerb(t)} ${t}.`;
    this.log(msg); this.story('wish', msg, [v], 'wish');
    return w;
  },
  grantWish(v, how = '') {
    const w = v.wish; if (!w) return false;
    const W = WISHES[w.kind], s = this.s;
    v.wish = null; v.beamUntil = s.time + 12;
    s.stats.wishes = (s.stats.wishes || 0) + 1;
    s.happiness = Math.min(100, s.happiness + 3);
    this.addXp?.(10);
    const msg = W.done(v, w, this);
    this.log(msg); this.story('granted', msg, [v], 'wish');
    this.emit('float', v.x, v.z, 'Wish granted!', 'wish');
    this.emit('sfx', 'done');
    return true;
  },
  // the one-tap answers on a villager's panel
  answerWish(v, act) {
    const w = v.wish; if (!w) return { ok: false, why: 'No wish' };
    const s = this.s;
    if (act === 'treat') { const g = w.data.good; if ((s.res[g] || 0) < 1) return { ok: false, why: `No ${GOODS[g].name.toLowerCase()} in store` }; this.pay({ [g]: 1 }); return { ok: this.grantWish(v) }; }
    if (act === 'pet') { const p = this.adoptPet(v); return p ? { ok: true } : { ok: false, why: `Needs ${PET_COST} coins` }; }
    if (act === 'picnic') {
      const o = this.vById.get(w.data.with); if (!o) { v.wish = null; return { ok: false, why: 'They have moved on' }; }
      if ((s.res.food || 0) < 10) return { ok: false, why: 'Needs 10 food' };
      this.pay({ food: 10 }); this.bumpAffinity?.(v, o, 40); this.talk?.(v, o, 'love', 6);
      return { ok: this.grantWish(v) };
    }
    if (act === 'study' || act === 'job') {
      const job = act === 'study' ? 'scholar' : w.data.job;
      const b = s.buildings.find(o => o.built && o.sid === v.home && defOf(o.type).job === job && o.workers.length < workersOf(o));
      if (!b) return { ok: false, why: 'No free place for that job' };
      if (v.work) this.unassign(v);
      if (!this.assign(b, v)) return { ok: false, why: act === 'study' ? 'The Library is full' : 'They can\'t take that job yet' };
      // granted on the spot (not at the next wish check, which made the button look broken)
      return { ok: this.grantWish(v) };
    }
    return { ok: false, why: '' };
  },
  adoptPet(v, kind) {
    const s = this.s;
    if (s.res.coins < PET_COST || s.pets.some(p => p.owner === v.id)) return null;
    s.res.coins -= PET_COST; this.track('coins', -PET_COST); this.emit('res');
    kind ||= this.rng() < 0.5 ? 'cat' : 'dog';
    const names = PET_NAMES[kind], p = { id: ++s.petId, kind, owner: v.id, name: names[(s.petId * 7 + v.id) % names.length], x: v.x, z: v.z, tint: this.rng() };
    s.pets.push(p);
    const msg = `${v.name} adopted a ${kind} called ${p.name}.`;
    this.log(msg); this.story('pet', msg, [v], 'paw');
    if (v.wish?.kind === 'pet') this.grantWish(v);
    this.emit('pet', p);
    return p;
  },
  petOf(v) { return this.s.pets.find(p => p.owner === v.id) || null; },
  wishSecond() {
    const s = this.s, day = this.dayNum();
    // wishes come true, or quietly fade
    for (const v of s.villagers) {
      const w = v.wish; if (!w) continue;
      if (s.time > w.until) { v.wish = null; continue; }
      const W = WISHES[w.kind];
      if (W.met(this, v, w)) this.grantWish(v);
    }
    // pets whose owner has gone find someone else in the family, or the nearest kind soul
    for (const p of s.pets) if (!this.vById.has(p.owner)) {
      const heir = s.villagers.find(o => !s.pets.some(q => q.owner === o.id) && stageOf(o) !== 'child');
      if (heir) { p.owner = heir.id; this.log(`${heir.name} took in ${p.name} the ${p.kind}.`); } else s.pets = s.pets.filter(q => q !== p);
    }
    // a new wish now and then (not at night, not in a storm, not too many at once)
    // (not during the first-time tips, nor on the very first day)
    if (this.isNight() || this.stormy() || day < 1 || (s.tutorial ?? 99) < 5 || this.openWishes().length >= this.wishCap() || this.rng() > 0.25) return;
    const pool = s.villagers.filter(v => !v.wish && v.wishDay !== day && v.wishDay !== day - 1 && !v.quest && !(v.jail > s.time) && v.age >= 4);
    if (!pool.length) return;
    const v = pool[(this.rng() * pool.length) | 0];
    const kinds = Object.keys(WISHES).filter(k => WISHES[k].who(v) && WISHES[k].want(this, v));
    let x = this.rng() * kinds.reduce((t, k) => t + (WISHES[k].w ?? 1), 0);
    for (const k of kinds) if ((x -= WISHES[k].w ?? 1) <= 0) { this.makeWish(v, k); break; }
  },
};
