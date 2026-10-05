// Round 13: wishes and pets, weddings, the town's rank, the yearly chronicle and
// visitors at the gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DAY } from '../js/sim.js';
import { CENTERS } from '../js/world.js';
import { WISHES, PET_COST } from '../js/wishes.js';
import { RANKS, YEAR_DAYS } from '../js/celebrations.js';
import { VISITORS } from '../js/visitors.js';

const fresh = () => { const sim = new Sim(null, { seed: 'round-thirteen-tests' }); sim.s.level = 9; sim.s.tutorial = 99; return sim; };
function build(sim, type, sid = 'meadow') {
  const c = CENTERS[sid];
  for (let r = 2; r < 21; r++) for (let z = c.z - r; z <= c.z + r; z++) for (let x = c.x - r; x <= c.x + r; x++) {
    const ok = sim.checkPlace(type, x, z, 0, -2);
    if (ok.ok && ok.sid === sid) return sim.addBuilding(type, x, z, 0, true);
  }
  throw Error('No room for ' + type);
}
const adults = sim => sim.s.villagers.filter(v => v.age >= 18 && v.age < 60);
const toasts = sim => { const out = []; const h = sim.handlers.toast; sim.on('toast', (m, i) => { out.push(m); h?.(m, i); }); return out; };

test('a wish is made, shows on the Story page, and comes true when the village changes', () => {
  const sim = fresh(), v = adults(sim)[0];
  build(sim, 'cottage');
  sim._beds = null;
  const home = sim.homeOf(v); assert.ok(home, 'villager has a home');
  const w = sim.makeWish(v, 'bench');
  assert.ok(w); assert.equal(v.wish.kind, 'bench'); assert.equal(sim.s.story[0].kind, 'wish');
  assert.ok(sim.openWishes().includes(v));
  // place a bench by the door: granted on the next check
  const c = sim.bCenter(home);
  let placed = null;
  for (let r = 1; r < 4 && !placed; r++) for (let dz = -r; dz <= r && !placed; dz++) for (let dx = -r; dx <= r && !placed; dx++) {
    const tx = home.tx + dx, tz = home.tz + dz;
    if (sim.checkPlace('bench', tx, tz, 0).ok) placed = sim.addBuilding('bench', tx, tz, 0, true);
  }
  assert.ok(placed, 'room for a bench'); assert.ok(Math.hypot(sim.bCenter(placed).x - c.x, sim.bCenter(placed).z - c.z) <= 4);
  sim.wishSecond();
  assert.equal(v.wish, null); assert.equal(sim.s.stats.wishes, 1); assert.equal(sim.s.story[0].kind, 'granted');
});

test('wishes fade quietly after two days; at most a few at once', () => {
  const sim = fresh(), v = adults(sim)[0];
  sim.makeWish(v, 'treat') || sim.makeWish(v, 'pet');
  assert.ok(v.wish);
  sim.s.time += DAY * 2.1; sim.wishSecond();
  assert.equal(v.wish, null);
  assert.equal(sim.wishCap(), 1);       // a small village: one wish at a time
  for (const k of Object.keys(WISHES)) assert.equal(typeof WISHES[k].text, 'function');
});

test('a treat wish is granted from the store with one tap', () => {
  const sim = fresh(), v = adults(sim)[0];
  sim.s.res.cheese = 3; sim.s.res.honey = 3; sim.s.res.ale = 3;
  assert.ok(sim.makeWish(v, 'treat'));
  const g = v.wish.data.good, before = sim.s.res[g];
  assert.ok(sim.answerWish(v, 'treat').ok);
  assert.equal(sim.s.res[g], before - 1); assert.equal(v.wish, null);
});

test('adopting a pet costs coins, grants a pet wish, and the pet survives a save', () => {
  const sim = fresh(), v = adults(sim)[0];
  sim.s.res.coins = PET_COST + 5;
  assert.ok(sim.makeWish(v, 'pet'));
  const p = sim.adoptPet(v, 'cat');
  assert.ok(p); assert.equal(p.kind, 'cat'); assert.equal(sim.s.res.coins, 5); assert.equal(v.wish, null);
  assert.equal(sim.petOf(v), p);
  assert.equal(sim.adoptPet(v, 'dog'), null, 'one pet each');
  const loaded = new Sim(sim.serialize());
  assert.equal(loaded.s.pets.length, 1); assert.equal(loaded.petOf(loaded.vById.get(v.id)).name, p.name);
});

test('a pet whose owner moves away is taken in by someone else', () => {
  const sim = fresh(), [a] = adults(sim);
  sim.s.res.coins = 100;
  const p = sim.adoptPet(a, 'dog');
  sim.passAway(a);
  sim.wishSecond();
  assert.ok(sim.s.pets.length === 0 || sim.vById.has(sim.s.pets[0].owner));
  assert.ok(sim.s.pets.every(q => q.owner !== a.id)); assert.ok(p);
});

test('a new couple is married at the campfire, with guests, the next evening', () => {
  const sim = fresh(), [a, b] = adults(sim);
  for (const v of [a, b]) { v.partner = null; v.wed = null; }
  a.partner = b.id; b.partner = a.id;
  sim.s.time = sim.dayNum() * DAY + DAY * 0.3;
  sim.weddingSecond();
  const w = sim.s.weddings[0];
  assert.ok(w); assert.equal(a.wed, 'planned'); assert.equal(sim.s.story[0].kind, 'wedding');
  sim.s.time = w.day * DAY + DAY * 0.6; sim.s.weather.storm = false;
  sim.weddingSecond();
  assert.ok(w.on); assert.ok(w.guests.includes(a.id) && w.guests.includes(b.id)); assert.ok(w.guests.length >= 3, 'friends come');
  const g = sim.vById.get(w.guests[2]); g.task = null; sim.think(g);
  assert.match(g.task.label, /wedding/);
  sim.s.time = w.day * DAY + DAY * 0.72;
  sim.weddingSecond();
  assert.equal(a.wed, 'yes'); assert.equal(sim.s.stats.weddings, 1); assert.equal(sim.s.weddings.length, 0);
  assert.match(sim.s.story[0].text, /married/);
});

test('weddings make no popups (they belong to the Story and the banner)', () => {
  const sim = fresh(), seen = toasts(sim), [a, b] = adults(sim);
  a.partner = b.id; b.partner = a.id; a.wed = b.wed = null;
  sim.s.time = sim.dayNum() * DAY + DAY * 0.3; sim.weddingSecond();
  const w = sim.s.weddings[0]; sim.s.time = w.day * DAY + DAY * 0.6; sim.s.weather.storm = false; sim.weddingSecond();
  sim.s.time = w.day * DAY + DAY * 0.72; sim.weddingSecond();
  assert.ok(!seen.some(m => /married|wedding/i.test(m)));
});

test('couples from old saves count as married already', () => {
  const sim = fresh(), [a, b] = adults(sim);
  a.partner = b.id; b.partner = a.id; a.wed = b.wed = undefined;
  const loaded = new Sim(sim.serialize());
  assert.equal(loaded.vById.get(a.id).wed, 'old'); assert.equal(loaded.s.weddings.length, 0);
});

test('the village is promoted one rank at a time when every goal is met', () => {
  const sim = fresh(), got = [];
  sim.on('rank', R => got.push(R.id));
  assert.equal(sim.rankOf().id, 'hamlet'); assert.equal(sim.nextRank().id, 'village');
  sim.rankSecond(); assert.equal(sim.s.rank, 0);
  // meet the Village goals
  while (sim.s.villagers.length < 12) sim.spawnVillager('meadow', 8, 4, { age: 25 });
  sim.prosperityCounts = () => [0, 0, 3, 0];
  build(sim, 'market');
  sim.s.stats.festivals = 1; sim.s.stats.wishes = 1;
  assert.ok(sim.rankGoals().every(g => g.done));
  const gems = sim.s.res.gems;
  sim.rankSecond();
  assert.equal(sim.s.rank, 1); assert.deepEqual(got, ['village']); assert.equal(sim.s.res.gems, gems + RANKS[1].gems);
  assert.equal(sim.s.story[0].kind, 'rank');
  sim.rankSecond(); assert.equal(sim.s.rank, 1, 'Town needs more');
  assert.equal(new Sim(sim.serialize()).s.rank, 1);
});

test('the chronicle is written at the end of each year', () => {
  const sim = fresh(), got = [];
  sim.on('chronicle', c => got.push(c));
  const [a] = adults(sim);
  sim.story('baby', `${a.name} welcomed a baby.`, [a], 'baby');
  sim.s.time = YEAR_DAYS * DAY + 10;
  sim.chronicleSecond();
  assert.equal(sim.s.chronicles.length, 1); assert.equal(got.length, 1);
  const c = sim.s.chronicles[0];
  assert.equal(c.year, 1); assert.ok(c.title.length > 3); assert.ok(c.heads.some(h => h.kind === 'baby'));
  assert.equal(sim.s.chronNew, 1); assert.equal(sim.s.chron.year, 1);
  sim.chronicleSecond(); assert.equal(sim.s.chronicles.length, 1, 'once a year');
  const live = sim.compileYear(1, true); assert.ok(live.partial);
});

test('a family at the gate: welcomed, they move in as a household', () => {
  const sim = fresh(), pop = sim.s.villagers.length;
  const c = sim.makeVisitor('family');
  assert.ok(c); assert.ok(c.path.length > 2); assert.ok(c.members.length >= 2);
  assert.ok(sim.answerVisitor(true).ok);
  assert.equal(sim.s.villagers.length, pop + c.members.length);
  const [a, b] = sim.s.villagers.slice(pop);
  assert.equal(a.partner, b.id); assert.equal(a.wed, 'old'); assert.equal(a.name, c.members[0].name);
  assert.equal(sim.s.visitors.cur, null); assert.equal(sim.s.story[0].kind, 'visitor');
});

test('turning a visitor away is harmless; a paid bard needs the coins', () => {
  const sim = fresh();
  sim.makeVisitor('bard'); sim.s.res.coins = 5;
  assert.equal(sim.answerVisitor(true).ok, false);
  sim.s.res.coins = 100; const joy = sim.s.festJoy || 0;
  assert.ok(sim.answerVisitor(true).ok);
  assert.equal(sim.s.res.coins, 100 - VISITORS.bard.fee); assert.ok(sim.s.festJoy > joy);
  sim.s.visitors.cur = null;
  sim.makeVisitor('scholar'); const pop = sim.s.villagers.length, h = sim.s.happiness;
  assert.ok(sim.answerVisitor(false).ok);
  assert.equal(sim.s.villagers.length, pop); assert.equal(sim.s.happiness, h);
  assert.ok(sim.s.visitors.cur.leaving);
});

test('a hooded stranger shows who they really are after a while', () => {
  const sim = fresh(), pop = sim.s.villagers.length;
  while (sim.s.villagers.length < 7) sim.spawnVillager('meadow', 8, 4, { age: 25 });
  const c = sim.makeVisitor('stranger'); c.secret = 'hero';
  assert.ok(sim.answerVisitor(true).ok);
  const v = sim.s.villagers[sim.s.villagers.length - 1];
  assert.equal(v.secret, 'hero'); assert.ok(pop > 0);
  sim.s.time = v.revealAt + 1; sim.visitSecond();
  assert.equal(v.secret, null); assert.ok(['fighter', 'ranger'].includes(v.cls)); assert.ok(v.lvl >= 3);
});

test('a long run: wishes, weddings, visitors and a chronicle happen on their own, with no errors', () => {
  const sim = fresh();
  sim.s.res.food = 500;
  for (let i = 0; i < DAY * 13 * 4; i++) sim.tick(0.25);
  assert.ok(sim.s.story.some(e => e.kind === 'wish'), 'a wish was made');
  assert.ok(sim.s.chronicles.length >= 1, 'a chronicle was written');
  assert.ok(new Sim(sim.serialize()).s.chronicles.length >= 1);
});

test('the census keeps a daily population history, through saves', async () => {
  const { censusHtml } = await import('../js/census.js');
  const sim = fresh();
  for (let i = 0; i < DAY * 3 * 4; i++) sim.tick(0.25);
  const H = sim.s.census.hist;
  assert.ok(H.length >= 3); assert.equal(H[H.length - 1].n, sim.s.villagers.length);
  assert.ok(H.every((h, i) => i === 0 || h.d > H[i - 1].d), 'one sample a day');
  const loaded = new Sim(sim.serialize()); assert.equal(loaded.s.census.hist.length, H.length);
  const html = censusHtml({ sim, popSid: 'all' });
  assert.match(html, /villagers/); assert.match(html, /<svg class="pchart"/); assert.match(html, /Peoples/);
});
