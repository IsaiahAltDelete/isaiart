// Workshop staff work inside their workplace rather than standing at the wall outside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DAY, stageOf } from '../js/sim.js';
import { CENTERS } from '../js/world.js';

const fresh = (seed = 'work-inside-tests') => { const sim = new Sim(null, { seed }); sim.s.level = 10; sim.s.tutorial = 99; return sim; };
function build(sim, type, sid = 'meadow') {
  const c = CENTERS[sid];
  for (let r = 2; r < 21; r++) for (let z = c.z - r; z <= c.z + r; z++) for (let x = c.x - r; x <= c.x + r; x++) {
    const ok = sim.checkPlace(type, x, z, 0, -2);
    if (ok.ok && ok.sid === sid) return sim.addBuilding(type, x, z, 0, true);
  }
  throw Error('No room for ' + type);
}
// hire the nearest grown-up who isn't already busy with something special
function staff(sim, b) {
  const v = sim.s.villagers.find(o => stageOf(o) === 'adult' && !o.quest && o.job !== 'guard');
  v.tier = 3; v.educated = true;              // schooled enough for any trade
  assert.ok(sim.assign(b, v), 'hired someone');
  return v;
}
// run the sim at midday, in fair weather, until the worker settles into their work act
function settle(sim, v, secs = 40) {
  sim.s.time = Math.floor(sim.s.time / DAY) * DAY + DAY * 0.45;
  for (let i = 0; i < secs * 10; i++) {
    if (sim.s.weather) { sim.s.weather.storm = false; sim.s.weather.next = null; }
    sim.tick(0.1);
    if (v.act && v.task?.label && !/walk/i.test(v.task.label) && v.work && (v.indoors || i > secs * 8)) break;
  }
}

test('a baker goes in through the door and works indoors', () => {
  const sim = fresh(), b = build(sim, 'bakery');
  const v = staff(sim, b);
  sim.s.res.flour = 50;
  settle(sim, v);
  assert.equal(v.job, 'baker');
  assert.ok(v.indoors, 'the baker is inside');
  assert.equal(v.inside, b.id);
  // and it still bakes
  const before = sim.s.res.food;
  for (let i = 0; i < 200; i++) sim.tick(0.1);
  assert.ok(sim.s.res.food > before || sim.s.stats.produced.bread > 0, 'bread is still being made');
});

test('the smith stays out at the anvil', () => {
  const sim = fresh('work-inside-forge'), b = build(sim, 'forge');
  const v = staff(sim, b);
  settle(sim, v);
  assert.equal(v.job, 'smith');
  assert.ok(!v.indoors, 'the smith works outside');
});

test('a worker leaves the building when the task is dropped', () => {
  const sim = fresh('work-inside-drop'), b = build(sim, 'bakery');
  const v = staff(sim, b);
  sim.s.res.flour = 50;
  settle(sim, v);
  assert.ok(v.indoors);
  sim.dropTask(v);
  assert.ok(!v.indoors && v.inside == null);
});
