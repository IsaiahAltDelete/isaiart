// Round 15: expeditions on the World map, peeking inside a home, and Frostpeak Pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DAY } from '../js/sim.js';
import { CENTERS, N, idx, T_WATER } from '../js/world.js';
import { SETTLEMENTS } from '../js/data.js';
import { EXPEDITIONS } from '../js/rpg.js';
import { expLeg, activeExpeditions, EXP_SITES, storyBeat } from '../js/expmap.js';
import { largestRect, roomLayout } from '../js/roomplan.js';
import { FROST_DEF, FIREWOOD, frostAt, ridgeAt } from '../js/frost.js';

const fresh = (seed = 'round-fifteen-tests') => { const sim = new Sim(null, { seed }); sim.s.level = 10; sim.s.tutorial = 99; return sim; };
function build(sim, type, sid = 'meadow') {
  const c = CENTERS[sid];
  for (let r = 2; r < 21; r++) for (let z = c.z - r; z <= c.z + r; z++) for (let x = c.x - r; x <= c.x + r; x++) {
    const ok = sim.checkPlace(type, x, z, 0, -2);
    if (ok.ok && ok.sid === sid) return sim.addBuilding(type, x, z, 0, true);
  }
  throw Error('No room for ' + type);
}
const adults = sim => sim.s.villagers.filter(v => v.age >= 18 && v.age < 60);

// ── expeditions on the map ──
test('every expedition has a place on the map, on its rim', () => {
  for (const q of EXPEDITIONS) {
    const at = EXP_SITES[q.id];
    assert.ok(at, `${q.id} has a site`);
    assert.ok(Math.min(at[0], at[1], 1 - at[0], 1 - at[1]) < 0.1, `${q.id} sits near the edge of the map`);
  }
});

test('the party walks out, waits at the site, and walks home', () => {
  assert.deepEqual(expLeg(0), { leg: 'out', k: 0 });
  assert.equal(expLeg(0.15).leg, 'out');
  assert.ok(expLeg(0.15).k > 0 && expLeg(0.15).k < 1);
  assert.deepEqual(expLeg(0.5), { leg: 'site', k: 1 });
  assert.equal(expLeg(0.85).leg, 'home');
  assert.equal(expLeg(1).k, 0);
  assert.equal(expLeg(0.5, true).leg, 'back');
  // monotonic out, then back
  let prev = -1; for (let p = 0; p <= 0.3; p += 0.02) { const k = expLeg(p).k; assert.ok(k >= prev); prev = k; }
});

test('a guild expedition shows up as a party on the map, with its latest news', () => {
  const sim = fresh(), b = build(sim, 'guild');
  sim.s.res.food += 200;
  const vs = adults(sim).slice(0, 2); sim.guildOf(b).party = vs.map(v => v.id);
  for (const v of vs) v.hp = 999;
  assert.ok(sim.startExpedition(b, 'mill'));
  let [x] = activeExpeditions(sim);
  assert.equal(x.q.id, 'mill'); assert.equal(x.leg, 'out'); assert.equal(x.line, '', 'no news before the first step');
  sim.s.time += b.data.exp.dur * 0.5;
  [x] = activeExpeditions(sim);
  assert.equal(x.leg, 'site'); assert.ok(x.line.length > 0, 'a step of the adventure is shown');
  assert.notEqual(x.line, b.data.exp.log.at(-1).msg, 'the ending is never given away early');
});

test('the map tells the expedition as a story, without dice rolls', () => {
  assert.equal(storyBeat('Krusk talked the bandits into leaving (and handing back the tolls) (CHA check: rolled 17 vs DC 13).'), 'Krusk talked the bandits into leaving (and handing back the tolls).');
  assert.equal(storyBeat('Ghesh breathed a gout of dragon fire (11 damage).'), 'Ghesh breathed a gout of dragon fire.');
  assert.equal(storyBeat('Everyone held their noses (CON save: 14 vs DC 12), mostly.'), 'Everyone held their noses, mostly.');
});

// ── a peek inside ──
test('the room plan never crosses a wall, and puts the beds in the biggest room', () => {
  // two overlapping volumes, like a cottage with a front wing: labels 2 (body), 4 (overlap), 2 (wing)
  const rows = ['2222222222222000', '2222222222222000', '2222222222222000', '2222222222222000', '2222222222222000', '2222222222222000', '2222222222222000',
    '2222222224444222', '2222222224444222', '2222222224444222', '0000000002222222', '0000000002222222', '0000000002222222', '0000000002222222', '0000000002222222'];
  const nx = 16, nz = rows.length, cnt = new Uint8Array(nx * nz);
  rows.forEach((r, z) => [...r].forEach((c, x) => { cnt[z * nx + x] = +c; }));
  const used = new Uint8Array(nx * nz), R = largestRect(cnt, nx, nz, used);
  for (let z = R.z; z < R.z + R.d; z++) for (let x = R.x; x < R.x + R.w; x++) assert.equal(cnt[z * nx + x], cnt[R.z * nx + R.x], 'one room only');
  const L = roomLayout({ cnt, nx, nz, s: 0.1, gx: 0, gz: 0 }, 3);
  assert.ok(L.beds.length >= 1 && L.beds.length <= 3);
  for (const b of L.beds) {
    assert.ok(b.l >= 0.6, 'a bed long enough to lie in');
    for (const [fx, fz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      const x = Math.floor((b.x + fx * b.w * 0.98) / 0.1), z = Math.floor((b.z + fz * b.l * 0.98) / 0.1);
      assert.equal(cnt[z * nx + x], 2, 'each bed sits inside the main room');
    }
  }
  assert.ok(L.table, 'a table somewhere'); assert.ok(cnt[Math.floor(L.table.z / 0.1) * nx + Math.floor(L.table.x / 0.1)] > 0, 'the table is indoors');
});

// ── Frostpeak Pass ──
test('Frostpeak Pass sits in a dry corner far from every other settlement', () => {
  for (const seed of ['round-fifteen-tests', 'snowy', 'a third map']) {
    const sim = fresh(seed), F = sim.world.frost;
    if (!F) continue;
    assert.ok(SETTLEMENTS.some(s => s.id === 'frost'));
    assert.deepEqual([CENTERS.frost.x, CENTERS.frost.z], [F.x, F.z]);
    for (const [k, c] of Object.entries(CENTERS)) if (k !== 'frost') assert.ok(Math.hypot(c.x - F.x, c.z - F.z) >= 26, `clear of ${k}`);
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) assert.notEqual(sim.world.type[idx(F.x + dx, F.z + dz)], T_WATER);
    assert.equal(ridgeAt(F, F.x, F.z), 0, 'the glade is flat');
    assert.ok(frostAt(F, F.x - N / 2, F.z - N / 2) === 1 && frostAt(F, 0, 0) < 1);
  }
});

test('the pass is the same on every load, and adds no trees an old save could miscount', () => {
  const a = fresh(), b = new Sim(JSON.parse(JSON.stringify(a.serialize())));
  assert.deepEqual([a.world.frost.x, a.world.frost.z], [b.world.frost.x, b.world.frost.z]);
  assert.equal(a.origTrees, b.origTrees);
});

test('settling clears a glade; nights burn firewood, and running out leaves everyone cold', () => {
  const sim = fresh(), c = CENTERS.frost;
  const before = sim.world.trees.filter(t => t.alive && Math.hypot(t.tx - c.x, t.tz - c.z) <= c.r).length;
  assert.ok(before > 0, 'the pass starts out forested');
  sim.s.res.coins += 5000; sim.s.res.planks += 400; sim.s.res.bricks += 200;
  assert.ok(sim.unlock('frost'));
  assert.equal(sim.world.trees.filter(t => t.alive && Math.hypot(t.tx - c.x, t.tz - c.z) <= c.r).length, 0);
  const folk = sim.s.villagers.filter(v => v.home === 'frost');
  assert.ok(folk.length >= 2);
  sim.s.stock.frost.wood = 50; sim.s.res.wood += 50;
  const wood = sim.s.res.wood;
  sim.rng = () => 0.99;   // no wolves tonight
  sim.frostNight();
  assert.equal(sim.s.stock.frost.wood, 50 - folk.length * FIREWOOD);
  assert.equal(sim.s.res.wood, wood - folk.length * FIREWOOD, 'the town total keeps matching the stores');
  assert.ok(folk.every(v => !(v.cold > sim.s.time)));
  sim.s.res.wood -= sim.s.stock.frost.wood; sim.s.stock.frost.wood = 0;
  const happy = sim.s.happiness;
  sim.frostNight();
  assert.ok(folk.every(v => v.cold > sim.s.time), 'out of firewood: everyone wakes up cold');
  assert.ok(sim.s.happiness < happy);
});

test('wolves come down from the peaks in packs', () => {
  const sim = fresh();
  sim.s.res.coins += 5000; sim.s.res.planks += 400; sim.s.res.bricks += 200;
  sim.unlock('frost');
  sim.s.time = DAY * 5; sim.s.stock.frost.wood = 99; sim.s.res.wood += 99;
  let k = 0; sim.rng = () => (k++ === 0 ? 0.1 : (k * 0.37) % 1);   // the pack comes tonight; then wherever there's room
  const n0 = (sim.s.beasts || []).length;
  sim.frostNight();
  const wolves = (sim.s.beasts || []).slice(n0);
  assert.ok(wolves.length >= 2 && wolves.every(b => b.kind === 'wolf' && b.sid === 'frost'));
});

test('miners at the pass turn up iron ore with their stone', () => {
  assert.equal(FROST_DEF.spec.job, 'miner'); assert.ok(FROST_DEF.spec.ore);
  const sim = fresh();
  sim.s.res.coins += 5000; sim.s.res.planks += 400; sim.s.res.bricks += 200;
  sim.unlock('frost');
  const v = sim.s.villagers.find(o => o.home === 'frost'); v.job = 'miner';
  const ore0 = sim.s.res.ore || 0;
  sim.ledger.v = v;
  for (let k = 0; k < 40; k++) sim.add('stone', 1);
  sim.ledger.v = null;
  assert.ok((sim.s.res.ore || 0) > ore0, 'some ore came up');
});
