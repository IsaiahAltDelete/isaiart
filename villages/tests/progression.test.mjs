// Building progression: workplaces whose jobs need schooling wait for a Library (or a schooled villager),
// and a new village's Schoolhouse can always get a teacher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, stageOf } from '../js/sim.js';
import { CENTERS } from '../js/world.js';
import { BUILDINGS } from '../js/data.js';

const fresh = (seed = 'progression-tests') => { const sim = new Sim(null, { seed }); sim.s.tutorial = 99; return sim; };
const rich = sim => { for (const k of Object.keys(sim.s.res)) sim.s.res[k] = 9999; };
// the first spot where the game would let the player place this (ignoreId -1: level, cost and gates apply)
function tryPlace(sim, type, sid = 'meadow') {
  const c = CENTERS[sid]; let last = null;
  for (let r = 2; r < 21; r++) for (let z = c.z - r; z <= c.z + r; z++) for (let x = c.x - r; x <= c.x + r; x++) {
    const ok = sim.checkPlace(type, x, z, 0, -1);
    if (ok.ok && ok.sid === sid) return { ok: true, x, z };
    if (/Library|level/.test(ok.why || '')) last = ok;
  }
  return last || { ok: false, why: 'no room' };
}
function build(sim, type, sid = 'meadow') {
  const c = CENTERS[sid];
  for (let r = 2; r < 21; r++) for (let z = c.z - r; z <= c.z + r; z++) for (let x = c.x - r; x <= c.x + r; x++) {
    const ok = sim.checkPlace(type, x, z, 0, -2);
    if (ok.ok && ok.sid === sid) return sim.addBuilding(type, x, z, 0, true);
  }
  throw Error('No room for ' + type);
}

test('the Wizard Tower comes after the Library', () => {
  assert.ok(BUILDINGS.wizard.lvl > BUILDINGS.library.lvl);
  assert.ok(BUILDINGS.wizard.lvl < BUILDINGS.university.lvl);
});

test('a wizard tower waits for a Library when nobody is schooled', () => {
  const sim = fresh(); rich(sim); sim.s.level = 8;
  for (const v of sim.s.villagers) v.tier = 0;
  const no = tryPlace(sim, 'wizard');
  assert.equal(no.ok, false); assert.match(no.why, /Library/);
  build(sim, 'library');
  assert.ok(tryPlace(sim, 'wizard').ok, 'a Library opens it');
});

test('someone already schooled opens it without a Library', () => {
  const sim = fresh('progression-schooled'); rich(sim); sim.s.level = 8;
  sim.s.villagers.find(v => stageOf(v) === 'adult').tier = 1;
  assert.ok(tryPlace(sim, 'wizard').ok);
});

test('jobs that need no schooling are never gated', () => {
  const sim = fresh('progression-free'); rich(sim); sim.s.level = 8;
  for (const v of sim.s.villagers) v.tier = 0;
  for (const type of ['school', 'library', 'bakery', 'trainingyard']) assert.equal(sim.schoolGate(type), null, type);
  assert.ok(sim.schoolGate('forge') && sim.schoolGate('chapel') && sim.schoolGate('university'));
});

test("a new village's Schoolhouse can hire an unschooled teacher", () => {
  const sim = fresh('progression-teacher'); sim.s.level = 8;
  for (const v of sim.s.villagers) v.tier = 0;
  const b = build(sim, 'school');
  const v = sim.s.villagers.find(o => stageOf(o) === 'adult' && o.job === 'idle');
  assert.ok(sim.assign(b, v), 'hired');
  assert.equal(v.job, 'teacher');
});
