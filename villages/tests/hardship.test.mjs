// Hardship (hardship.js): villagers who leave, and in Harsh, deaths and a village that can fall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DAY, stageOf } from '../js/sim.js';
import { CENTERS } from '../js/world.js';
import { runExpedition, EXPEDITIONS, maxHp } from '../js/rpg.js';
import { mulberry32 } from '../js/rng.js';

const fresh = (mode = 'normal', seed = 'hardship-tests') => {
  const sim = new Sim(null, { seed }); sim.s.level = 10; sim.s.tutorial = 99; sim.s.events.mode = mode;
  sim.s.time = DAY * 3 + DAY * 0.4;   // past the first two days' grace
  return sim;
};
function build(sim, type, sid = 'meadow') {
  const c = CENTERS[sid];
  for (let r = 2; r < 21; r++) for (let z = c.z - r; z <= c.z + r; z++) for (let x = c.x - r; x <= c.x + r; x++) {
    const ok = sim.checkPlace(type, x, z, 0, -2);
    if (ok.ok && ok.sid === sid) return sim.addBuilding(type, x, z, 0, true);
  }
  throw Error('No room for ' + type);
}
// run the sim, holding the world steady (no hard-times events, no festivals), with an optional nudge each tick
function run(sim, secs, each) {
  for (let i = 0; i < secs * 10; i++) {
    sim.s.events.list = []; sim.s.fest = null; if (sim.s.weather) sim.s.weather.storm = false;
    each?.(sim); sim.tick(0.1);
  }
}
const starve = sim => { sim.s.res.food = 0; };

test('a hungry villager thinks of leaving after a day, and goes a day later', () => {
  const sim = fresh(), pop = sim.s.villagers.length;
  run(sim, DAY * 1.3, starve);   // they turn hungry when their next meal is due, a little after the food runs out
  const worried = sim.s.villagers.filter(v => v.leaving);
  assert.ok(worried.length >= 1, 'someone is thinking of leaving');
  assert.equal(worried[0].leaving.why, 'hungry');
  run(sim, DAY * 1.1, starve);
  assert.ok(sim.s.villagers.length < pop, 'someone left');
  assert.ok((sim.s.stats.left || 0) >= 1);
  assert.equal(sim.s.stats.deaths || 0, 0, 'nobody died in Normal');
  assert.match(sim.s.leavers[0].why, /hungry/);
});

test('putting it right in time keeps them', () => {
  const sim = fresh('normal', 'hardship-stay');
  run(sim, DAY * 1.3, starve);
  const v = sim.s.villagers.find(o => o.leaving);
  assert.ok(v);
  sim.s.res.food = 500;
  run(sim, DAY * 0.8);
  assert.ok(sim.vById.has(v.id), 'still here');
  assert.ok(!v.leaving, 'decided to stay');
});

test('with hard times off, nobody leaves', () => {
  const sim = fresh('off', 'hardship-off'), pop = sim.s.villagers.length;
  run(sim, DAY * 2.5, starve);
  assert.equal(sim.s.villagers.length, pop);
  assert.ok(sim.s.villagers.every(v => !v.leaving));
});

test('a young child leaves with a parent who has nobody else staying', () => {
  const sim = fresh('normal', 'hardship-kid'), mum = sim.s.villagers.find(v => stageOf(v) === 'adult');
  const kid = sim.spawnVillager(mum.home, mum.x, mum.z, { age: 6, parents: [mum.id] }); (mum.kids ||= []).push(kid.id);
  mum.leaving = { why: 'hungry', go: 'tired of going hungry', at: sim.s.time };
  sim.departNow(mum);
  assert.ok(!sim.vById.has(mum.id) && !sim.vById.has(kid.id), 'both gone');
  assert.equal(sim.s.stats.deaths || 0, 0);
});

test('in Harsh, long hunger can kill, and the cause is recorded', () => {
  const sim = fresh('harsh', 'hardship-harsh-hunger');
  for (const v of sim.s.villagers) v.grief = -1e9;   // nobody gets to walk away from this one
  run(sim, DAY * 3, s2 => { starve(s2); for (const v of s2.s.villagers) { v.grief = Math.min(v.grief || 0, 0); v.leaving = null; } });
  assert.ok((sim.s.stats.deaths || 0) >= 1, `deaths: ${sim.s.stats.deaths}`);
  assert.ok(sim.s.departed.some(d => d.cause === 'hunger'));
});

test('in Harsh, someone knocked out makes death saves; a cleric nearby steadies them', () => {
  const sim = fresh('harsh', 'hardship-saves'), [a, b] = sim.s.villagers.filter(v => stageOf(v) === 'adult');
  sim.rpgHurt(a, 999, 'a wolf');
  assert.ok(a.dying, 'dying');
  b.cls = 'cleric'; b.x = a.x + 1; b.z = a.z; b.ko = 0;
  sim.deathSaves();
  assert.equal(a.dying, null, 'steadied');
  assert.ok(sim.vById.has(a.id));
  // without help it resolves one way or the other within half a minute
  b.cls = 'commoner';
  sim.rpgHurt(a, 999, 'a wolf');
  for (let i = 0; i < 300 && a.dying && sim.vById.has(a.id); i++) { sim.s.time += 0.1; if (Math.abs(sim.s.time % 1) < 0.1) sim.deathSaves(); }
  assert.ok(!a.dying || !sim.vById.has(a.id));
});

test('in Harsh, adventurers can die on a hard expedition; never outside Harsh', () => {
  const q = EXPEDITIONS.find(o => o.id === 'dragon');
  const party = () => [1, 2].map(id => { const v = { id, name: 'A' + id, cls: id === 1 ? 'fighter' : 'wizard', lvl: 3, abil: { str: 12, dex: 12, con: 12, int: 12, wis: 10, cha: 10 }, gear: {} }; v.hp = maxHp(v); return v; });
  let deaths = 0, soft = 0, line = false;
  for (let seed = 1; seed <= 60; seed++) {
    const o = runExpedition(q, party(), mulberry32(seed), { harsh: true });
    deaths += o.dead.length; line ||= o.lines.some(l => /did not come home/.test(l));
    soft += runExpedition(q, party(), mulberry32(seed), {}).dead.length;
  }
  assert.ok(deaths > 0 && line, `deaths in Harsh: ${deaths}`);
  assert.equal(soft, 0);
});

test('in Harsh the village falls when the last villager is gone, and nobody new arrives', () => {
  const sim = fresh('harsh', 'hardship-fall');
  build(sim, 'cottage'); sim.s.res.food = 500; sim.s.happiness = 80;
  for (const v of [...sim.s.villagers]) sim.passAway(v, { cause: 'illness' });
  run(sim, 120);
  assert.ok(sim.s.fallen, 'fallen');
  assert.equal(sim.s.villagers.length, 0, 'no newcomers to a fallen village');
});

test('outside Harsh an empty village can start again with newcomers', () => {
  const sim = fresh('normal', 'hardship-empty');
  build(sim, 'cottage');
  for (const v of [...sim.s.villagers]) sim.passAway(v, { left: true, why: 'test' });
  run(sim, 90, s2 => { s2.s.res.food = 500; s2.s.happiness = 80; });
  assert.ok(!sim.s.fallen);
  assert.ok(sim.s.villagers.length >= 1, 'a newcomer arrived');
});
