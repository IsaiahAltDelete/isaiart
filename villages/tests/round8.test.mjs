import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Sim, stageOf, workersOf, DAY } from '../js/sim.js';
import { World, WORLD_GEN, seedFromText, idx, CENTERS, T_WATER } from '../js/world.js';
import { classOf, maxHp, EXPEDITIONS } from '../js/rpg.js';
import { townBuildingHtml } from '../js/townui.js';
import { RACE_ORDER, RACES } from '../js/society.js';
import { mortgageCost } from '../js/economy.js';
import { UNIVERSITY_POINTS } from '../js/education.js';
import { GOODS } from '../js/data.js';
import { encodeSave, decodeSave } from '../js/share.js';

const hash = a => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const fresh = () => new Sim(null, { seed: 'round-eight-tests' });
const cash = sim => sim.s.res.coins + sim.s.villagers.reduce((n, v) => n + (v.purse || 0), 0);
function build(sim, type, sid = 'meadow') {
  const c = CENTERS[sid];
  for (let r = 2; r < 15; r++) for (let z = c.z - r; z <= c.z + r; z++) for (let x = c.x - r; x <= c.x + r; x++) {
    const ok = sim.checkPlace(type, x, z, 0, -2);
    if (ok.ok && ok.sid === sid) return sim.addBuilding(type, x, z, 0, true);
  }
  throw Error(`No place for ${type}`);
}
function finishAct(sim, v, start = false) {
  const step = v.task.steps.find(s => s.act);
  if (start) { v.act = { idle: false }; step.start?.(); }
  step.done?.();
}
function stock(sim, sid, key, n) {
  const delta = n - sim.trade.get(sid, key);
  sim.s.stock[sid][key] = n; sim.s.res[key] += delta; sim.ledger.tot[key] = sim.s.res[key];
}
function ledgerOK(sim) {
  for (const k of sim.trade.PHYS) {
    const sum = Object.keys(sim.s.unlocked).reduce((n, sid) => n + sim.trade.get(sid, k), 0) + sim.trade.transit(k);
    close(sim.s.res[k], sum); assert.ok(sim.s.res[k] >= -1e-7, k + ' negative');
  }
}

test('text, numeric and zero seeds are reproducible after other worlds', () => {
  assert.equal(seedFromText('0'), 0); assert.equal(seedFromText('#12345'), 12345);
  assert.equal(seedFromText('  Mossy   Otter  '), seedFromText('mossy otter'));
  const a = new Sim(null, { seed: 0 }); const first = hash(a.world.type);
  new Sim(null, { seed: 'another-valley' });
  const b = new Sim(null, { seed: '0' });
  assert.equal(first, hash(b.world.type)); assert.equal(hash(a.world.hv), hash(b.world.hv));
  assert.deepEqual(a.s.villagers.map(v => [v.name, v.race, v.abil]), b.s.villagers.map(v => [v.name, v.race, v.abil]));
});

test('varied map seeds preserve dry clearings, usable roads and fishing shore', () => {
  const shapes = new Set();
  for (let n = 0; n < 16; n++) {
    const w = new World(seedFromText('test-map-' + n), { gen: WORLD_GEN });
    shapes.add(hash(w.type)); assert.ok(w.traits.length >= 2);
    for (const k of ['meadow', 'pine', 'shallows', 'stone']) {
      const c = CENTERS[k]; assert.notEqual(w.type[idx(c.x, c.z)], T_WATER);
      assert.ok(w.waterDist(c) > c.r + 2, `${n}: ${k} wet clearing`);
    }
    assert.ok(w.waterDist(CENTERS.shallows) <= CENTERS.shallows.r + 4);
    for (let i = 0; i < w.road.length; i++) if (w.road[i]) assert.ok(w.type[i] !== T_WATER || w.bridge[i], `${n}: road in water`);
    assert.ok(w.bridges.length > 0);
  }
  assert.ok(shapes.size >= 12, `Only ${shapes.size} distinct maps`);
});

test('classic save loads without changing terrain or tree indices', () => {
  const { save, checks } = JSON.parse(fs.readFileSync(new URL('./fixtures/classic-save.json', import.meta.url), 'utf8'));
  const sim = new Sim(save);
  assert.equal(sim.world.gen, 1); assert.equal(hash(sim.world.type), checks.type); assert.equal(hash(sim.world.hv), checks.height);
  assert.deepEqual(sim.world.trees.map(t => [t.tx, t.tz, t.kind ?? null]), checks.trees);
  assert.equal(sim.world.trees[0].alive, false);
  assert.equal(new Sim(sim.serialize()).world.gen, 1);
});

test('saving preserves seeds, local stock, purses, names and one-time racial bonuses', () => {
  const sim = fresh(), home = sim.s.buildings.find(b => b.type === 'cottage');
  sim.renameHome(home, 'Honey Hearth'); const before = cash(sim), abilities = sim.s.villagers.map(v => ({ ...v.abil }));
  const loaded = new Sim(sim.serialize()), again = new Sim(loaded.serialize());
  close(cash(again), before); assert.equal(again.world.gen, 2); assert.equal(again.world.seedLabel, 'round-eight-tests');
  assert.deepEqual(again.s.villagers.map(v => v.abil), abilities); assert.equal(again.homeName(again.bById.get(home.id)), 'Honey Hearth');
  ledgerOK(again);
});

test('commoners train only on suitable jobs; all races have initialized looks', () => {
  const sim = fresh(); assert.ok(sim.s.villagers.every(v => classOf(v) === 'commoner'));
  for (const race of RACE_ORDER) {
    const v = sim.spawnVillager('meadow', 8, 4, { race, gender: 'x' });
    assert.equal(v.race, race); assert.equal(v.gender, 'x'); assert.ok(v.name.includes(' ')); assert.ok(v.hp > 0);
    if (RACES[race].horns) assert.ok(v.horn != null);
  }
  const v = sim.s.villagers[0], b = build(sim, 'watchhouse');
  assert.equal(sim.assign(b, v), true); assert.notEqual(classOf(v), 'commoner');
});

test('children inherit parent peoples and family identity', () => {
  const sim = fresh(), a = sim.spawnVillager('meadow', 8, 4, { race: 'human' }), b = sim.spawnVillager('meadow', 8, 4, { race: 'elf' });
  const child = sim.spawnVillager('meadow', 8, 4, { age: 0, parents: [a.id, b.id], last: 'Family' });
  assert.equal(child.race, 'halfelf'); assert.equal(stageOf(child), 'child'); assert.equal(child.name.split(' ').at(-1), 'Family');
});

test('households inherit occupied homes and savings; bed cache responds immediately', () => {
  const sim = fresh(), home = sim.s.buildings.find(b => b.type === 'cottage'), owner = sim.homeOwner(home);
  const heir = sim.spawnVillager('meadow', 8, 4, { age: 18, parents: [owner.id], last: 'Family' });
  owner.kids.push(heir.id); home.fam.push(heir.id); home.paid = 13; sim.bedFor(owner);
  const name = sim.homeName(home), total = cash(sim); sim.passAway(owner); sim.settleHomes();
  assert.equal(home.owner, heir.id); assert.equal(home.paid, 13); close(cash(sim), total);
  assert.ok(![...sim._beds?.map?.keys() || []].includes(owner.id));
  assert.ok(sim.s.log.some(e => e.msg === `${heir.name} inherited ${name}.`));
});

test('home names are cleaned, customisable and resettable', () => {
  const sim = fresh(), b = sim.s.buildings.find(b => b.type === 'cottage'), original = sim.homeName(b);
  sim.renameHome(b, '<Honey> & Hearth'); assert.equal(b.hname, 'Honey Hearth');
  sim.renameHome(b, ''); assert.equal(sim.homeName(b), original);
  assert.equal(sim.renameHome(sim.s.buildings[0], 'wrong'), false);
});

test('government changes need a Town Hall; seasonal leader persists on load', () => {
  const sim = fresh(); assert.equal(sim.setGovernment('mayor'), false); assert.equal(sim.setTax(0.2), false);
  build(sim, 'townhall'); assert.equal(sim.setGovernment('mayor'), true); sim.setTax(0.99); assert.equal(sim.s.gov.tax, 0.4);
  const leader = sim.govLeader(); sim.s.gov.season = Math.floor(sim.s.time / (DAY * 3));
  const other = sim.s.villagers.find(v => v !== leader); other.abil.cha = 20; other.abil.wis = 20;
  const loaded = new Sim(sim.serialize()); assert.equal(loaded.s.gov.leader, leader.id);
  loaded.s.time = DAY * 3; loaded.second(); assert.equal(loaded.s.gov.season, 1);
  assert.equal(sim.setGovernment('magocracy'), false);
});

test('wages, taxes, relief, shopping and mortgage payments conserve coins', () => {
  const sim = fresh(); build(sim, 'townhall'); const b = build(sim, 'lumber'), v = sim.s.villagers[0]; sim.assign(b, v);
  sim.setPolicy('poorRelief', true); sim.s.res.coins = 60;
  const before = cash(sim); sim.econSecond(); close(cash(sim), before);
  assert.ok(v.wage > 0); close(sim.s.economy.taxes, sim.s.economy.wages * sim.s.gov.tax);
  assert.ok(sim.s.villagers.every(v => v.purse >= 0));
  build(sim, 'market'); sim.s.villagers.forEach(v => v.purse = 100); const total = cash(sim);
  for (const k of ['cloth', 'cheese', 'honey', 'ale']) stock(sim, 'meadow', k, 20);
  for (let i = 0; i < 5; i++) sim.econSecond();
  close(cash(sim), total); ledgerOK(sim); assert.ok(sim.s.economy.spending > 0);
  assert.ok(sim.s.buildings.find(b => b.type === 'cottage').paid > 0);
});

test('wages never overdraw an empty treasury or mint coins', () => {
  const sim = fresh(), b = build(sim, 'lumber'); sim.assign(b, sim.s.villagers[0]);
  sim.s.res.coins = 0; const total = cash(sim); sim.econSecond(); close(cash(sim), total);
  assert.ok(sim.s.res.coins >= 0); assert.ok(sim.s.economy.shortfall > 0); assert.equal(sim.s.economy.wages, 0);
});

test('local supply and household demand change prices', () => {
  const sim = fresh(); stock(sim, 'meadow', 'cloth', 0); const scarce = sim.priceOf('cloth');
  stock(sim, 'meadow', 'cloth', 200); assert.ok(sim.priceOf('cloth') < scarce);
  stock(sim, 'meadow', 'cloth', 0); sim.s.economy.demand['meadow:cloth'] = 20; assert.ok(sim.priceOf('cloth') > scarce);
});

test('funded policies stop when resources or the Town Hall are unavailable', () => {
  const sim = fresh(), hall = build(sim, 'townhall'); sim.setPolicy('freeSchool', true); sim.fundPolicies(); assert.equal(sim.policyOn('freeSchool'), true);
  sim.s.res.coins = 0; sim.fundPolicies(); assert.equal(sim.policyOn('freeSchool'), false);
  sim.setPolicy('curfew', true); sim.s.time = DAY * 0.86; assert.equal(sim.sleepy(sim.s.villagers[0]), true);
  sim.demolish(hall); assert.equal(sim.policyOn('curfew'), false);
});

test('professors need Honours, students use separate capacity and graduate as Magisters', () => {
  const sim = fresh(), b = build(sim, 'university'), professor = sim.s.villagers[0], student = sim.s.villagers[1];
  professor.tier = 1; assert.equal(sim.assign(b, professor), false); professor.tier = 2; assert.equal(sim.assign(b, professor), true);
  student.age = 20; student.tier = 1; assert.equal(sim.enrol(student, b), false);
  student.tier = 2; student.purse = 10; assert.equal(sim.enrol(student, b), true); assert.ok(!b.workers.includes(student.id));
  student.university = UNIVERSITY_POINTS - 1; sim.taskUniversity(student, b); finishAct(sim, student);
  assert.equal(student.tier, 4); assert.equal(classOf(student), 'wizard'); assert.equal(student.lvl, 2); assert.equal(student.hp, maxHp(student));
  assert.equal(student.job, 'idle'); assert.equal(sim.universityStudents(b).length, 0); assert.equal(sim.eduMult(student), 1.25);
});

test('no professor or tuition means no university progress; demolition releases students', () => {
  const sim = fresh(), b = build(sim, 'university'), v = sim.s.villagers[0]; v.age = 20; v.tier = 2; sim.enrol(v, b);
  sim.taskUniversity(v, b); finishAct(sim, v); assert.equal(v.university, 0);
  const teacher = sim.s.villagers[1]; teacher.tier = 2; sim.assign(b, teacher); v.purse = 0;
  sim.taskUniversity(v, b); finishAct(sim, v); assert.equal(v.university, 0);
  sim.demolish(b); sim.eduSecond(); assert.equal(v.job, 'idle'); assert.equal(v.work, null);
});

test('Magisters can lead wizard towers and a Magocracy', () => {
  const sim = fresh(), tower = build(sim, 'wizard'), hall = build(sim, 'townhall'), v = sim.s.villagers[0];
  v.tier = 4; v.lvl = 2; assert.equal(sim.assign(tower, v), true); assert.equal(sim.appointArchmage(tower, v), true);
  assert.equal(sim.highArchmage(), v); assert.equal(sim.setGovernment('magocracy'), true); assert.equal(v.title, 'High Archmage');
  assert.ok(sim.govEffects().study >= 1.05);
});

test('pub entry consumes local ale and transfers the admission fee exactly once', () => {
  const sim = fresh(), pub = build(sim, 'pub'), barkeep = sim.s.villagers[0], visitor = sim.s.villagers[1]; sim.assign(pub, barkeep);
  stock(sim, 'meadow', 'ale', 5); visitor.purse = 10; const total = cash(sim), purse = visitor.purse;
  sim.taskOuting(visitor, pub); finishAct(sim, visitor, true);
  close(cash(sim), total); close(visitor.purse, purse - 1.5); close(sim.trade.get('meadow', 'ale'), 4);
  assert.ok(visitor.outingUntil > sim.s.time); assert.equal(pub.data.visits, 1); ledgerOK(sim);
});

test('baths require fuel; poor villagers can still visit a free park', () => {
  const sim = fresh(), baths = build(sim, 'bathhouse'), park = build(sim, 'park'), v = sim.s.villagers[0]; sim.assign(baths, v);
  assert.equal(sim.venueOpen(baths), false); sim.taskVenue(v, baths); finishAct(sim, v); assert.equal(sim.venueOpen(baths), true); ledgerOK(sim);
  const visitor = sim.s.villagers[1]; visitor.purse = 0; sim.taskOuting(visitor, park); finishAct(sim, visitor, true); assert.ok(visitor.outingUntil > sim.s.time);
});

test('crime pressure responds to patrols and arrests restore coins and release custody', () => {
  const sim = fresh(); sim.s.villagers.forEach(v => v.purse = 0); const baseline = sim.crimePressure('meadow');
  const house = build(sim, 'watchhouse'), officer = sim.s.villagers[0], culprit = sim.s.villagers[1], victim = sim.s.villagers[2]; sim.assign(house, officer);
  assert.ok(sim.crimePressure('meadow') < baseline); victim.purse = 5; victim.purse -= 3; culprit.purse += 3;
  const event = sim.recordCrime('meadow', 'Pickpocketing', culprit, { victim: victim.id, coins: 3 }); const total = cash(sim);
  assert.equal(sim.catchCulprit(event, officer, house), true); close(cash(sim), total); close(victim.purse, 5);
  assert.equal(sim.assign(build(sim, 'lumber'), culprit), false); sim.think(culprit); assert.match(culprit.task.label, /custody/);
  sim.s.time = culprit.jail + 1; sim.second(); assert.equal(culprit.jail, 0); assert.equal(culprit.indoors, false);
});

test('custody survives saving and strict justice raises fear', () => {
  const sim = fresh(), house = build(sim, 'watchhouse'), officer = sim.s.villagers[0], culprit = sim.s.villagers[1]; sim.assign(house, officer);
  sim.s.gov.justice = 'strict'; const event = sim.recordCrime('meadow', 'Pub brawl', culprit);
  sim.catchCulprit(event, officer, house); assert.equal(culprit.jail - sim.s.time, 90); assert.ok(sim.s.crime.fear >= 4);
  const loaded = new Sim(sim.serialize()), v = loaded.vById.get(culprit.id); loaded.think(v); assert.match(v.task.label, /custody/);
});

test('round 8 saves survive share-code compression and decoding', async () => {
  const sim = fresh(), save = sim.serialize(), decoded = await decodeSave(await encodeSave(save));
  const loaded = new Sim(decoded); close(cash(sim), cash(loaded)); assert.equal(loaded.world.gen, 2);
  assert.deepEqual(loaded.s.gov, sim.s.gov);
});

test('night theft and purchases stay within the affected settlement', () => {
  const sim = fresh(); sim.unlock('pine', true);
  sim.s.villagers.forEach(v => v.purse = 0); sim.s.time = DAY * 0.97;
  stock(sim, 'meadow', 'food', 20); stock(sim, 'pine', 'food', 30);
  const event = sim.rollCrime('meadow');
  assert.equal(event.kind, 'Night theft'); close(sim.trade.get('meadow', 'food'), 18); close(sim.trade.get('pine', 'food'), 30);
  stock(sim, 'meadow', 'ale', 0); stock(sim, 'pine', 'ale', 20);
  assert.equal(sim.trade.consume('meadow', 'ale', 1), false); close(sim.trade.get('pine', 'ale'), 20); ledgerOK(sim);
});

test('automatic staff assignment skips prisoners and picks qualified professors', () => {
  const sim = fresh(), university = build(sim, 'university'), [prisoner, unqualified, professor] = sim.s.villagers;
  prisoner.tier = 3; prisoner.jail = sim.s.time + 90; unqualified.tier = 0; professor.tier = 2;
  assert.equal(sim.assign(university), true); assert.deepEqual(university.workers, [professor.id]);
});

test('a monarch passes the title to a grown child; funded schooling waives tuition', () => {
  const sim = fresh(), hall = build(sim, 'townhall'), parent = sim.s.villagers[0];
  const heir = sim.spawnVillager('meadow', 8, 4, {age:20, parents:[parent.id], last:'Crown'}); parent.kids.push(heir.id);
  sim.setGovernment('monarchy', parent.id); sim.passAway(parent); sim.govT = 19; sim.second();
  assert.equal(sim.govLeader().id, heir.id);
  const university = build(sim, 'university'), professor = sim.s.villagers.find(v=>v!==heir);
  professor.tier=2; sim.assign(university, professor); heir.tier=2; heir.purse=0; sim.enrol(heir, university);
  sim.setPolicy('freeSchool', true); sim.fundPolicies(); const before=cash(sim);
  sim.taskUniversity(heir, university); finishAct(sim, heir); assert.ok(heir.university>0); close(cash(sim),before); assert.equal(heir.purse,0);
});

test('constables patrol public places in their own settlement', () => {
  const sim=fresh(), house=build(sim,'watchhouse'), park=build(sim,'park'), officer=sim.s.villagers[0];
  sim.unlock('pine',true); sim.assign(house,officer);
  const visited=new Set();
  for(let i=0;i<6;i++) { sim.taskConstable(officer,house); const stop=officer.task.steps[0].walk.near; assert.equal(stop.sid,house.sid); visited.add(stop.id); }
  assert.ok(visited.has(park.id)); assert.ok(visited.size>1);
});

test('a working patrol can investigate and arrest through ordinary simulation ticks', () => {
  const sim=fresh(), house=build(sim,'watchhouse'), hall=build(sim,'townhall');
  const [officer,culprit]=sim.s.villagers; officer.abil.wis=20; sim.assign(house,officer);
  sim.setPolicy('nightWatch',true); sim.fundPolicies(); sim.s.time=DAY*0.8;
  const event=sim.recordCrime('meadow','Pub brawl',culprit); sim.rng=()=>0.5;
  for(let i=0;i<900 && !event.solved;i++) sim.tick(0.1);
  assert.equal(event.solved,true); assert.ok(culprit.jail>sim.s.time); ledgerOK(sim);
});

test('custody blocks new guild recruits and existing-party departures until release', () => {
  const sim = fresh(), guild = build(sim, 'guild'), house = build(sim, 'watchhouse');
  const [a, b, officer, recruit] = sim.s.villagers;
  a.age = b.age = recruit.age = 20; a.hp = maxHp(a); b.hp = maxHp(b);
  sim.partyToggle(guild, a); sim.partyToggle(guild, b); sim.assign(house, officer);
  const event = sim.recordCrime('meadow', 'Pub brawl', a); sim.catchCulprit(event, officer, house);
  recruit.jail = sim.s.time + 40;
  assert.equal(sim.partyToggle(guild, recruit).ok, false);
  assert.match(sim.canDepart(guild, EXPEDITIONS[0]).why, /custody/);
  const before = sim.s.res.food;
  assert.equal(sim.startExpedition(guild, EXPEDITIONS[0].id), false);
  close(sim.s.res.food, before); assert.equal(guild.data.exp, undefined); assert.equal(a.quest, undefined);
  sim.s.time = a.jail + 1; sim.second(); a.hp = maxHp(a); b.hp = maxHp(b);
  assert.equal(sim.canDepart(guild, EXPEDITIONS[0]).ok, true);
});

test('venue staff serve throughout outings while other residents can take a break', () => {
  const sim = fresh(); sim.s.time = DAY * 0.78; sim.rng = () => 0;
  sim.stormy = () => false; sim.festivalActive = () => false;
  const park = build(sim, 'park');
  for (const [i, type] of ['pub', 'bathhouse', 'theatre'].entries()) {
    const venue = build(sim, type), worker = sim.s.villagers[i]; worker.age = 20; sim.assign(venue, worker);
    stock(sim, 'meadow', 'ale', 10); sim.taskVenue(worker, venue);
    assert.equal(sim.mustBreak(worker), false); sim.think(worker);
    assert.notEqual(worker.lastOuting, sim.dayNum()); assert.notEqual(worker.task.label, 'Strolling in the park');
    finishAct(sim, worker); assert.equal(sim.venueOpen(venue), true);
    // A saved outing from before this fix cannot advertise the venue as covered.
    sim.taskOuting(worker, park); assert.equal(sim.venueOpen(venue), false);
  }
  const visitor = sim.s.villagers[3]; visitor.age = 20; sim.unassign(visitor); sim.think(visitor);
  assert.equal(visitor.lastOuting, sim.dayNum());
});

test('children can enter baths and theatre free while adult fees and pub restriction remain', () => {
  const sim = fresh(), child = sim.spawnVillager('meadow', 8, 4, { age: 8 });
  const adult = sim.s.villagers[3]; adult.age = 20; adult.purse = 20;
  for (const [i, type] of ['bathhouse', 'theatre'].entries()) {
    const venue = build(sim, type); sim.assign(venue, sim.s.villagers[i]);
    if (type === 'bathhouse') { sim.taskVenue(sim.s.villagers[i], venue); finishAct(sim, sim.s.villagers[i]); }
    const total = cash(sim), treasury = sim.s.res.coins;
    sim.taskOuting(child, venue); finishAct(sim, child, true);
    close(child.purse, 0); close(sim.s.res.coins, treasury); close(cash(sim), total); assert.ok(child.outingUntil > sim.s.time);
    const purse = adult.purse; sim.taskOuting(adult, venue); finishAct(sim, adult, true);
    close(adult.purse, purse - sim.venueFee(venue)); close(cash(sim), total);
    assert.match(townBuildingHtml({ sim }, venue), /Children enter free/);
  }
  const pub = build(sim, 'pub'); sim.assign(pub, sim.s.villagers[2]); stock(sim, 'meadow', 'ale', 5);
  child.purse = 10; sim.taskOuting(child, pub); finishAct(sim, child, true);
  assert.equal(pub.data?.visits || 0, 0); close(child.purse, 10); close(sim.trade.get('meadow', 'ale'), 5); ledgerOK(sim);
});

test('university lists every applicant with full identity and protects its faculty', () => {
  const sim = fresh(), uni = build(sim, 'university'), professor = sim.s.villagers[0];
  professor.age = 20; professor.tier = 2; sim.assign(uni, professor);
  const applicants = Array.from({length: 15}, (_, i) => {
    const v = sim.spawnVillager('meadow', 8, 4, { age: 20 }); v.tier = 2; v.name = `Alex Household${i}`; return v;
  });
  const html = townBuildingHtml({ sim, universityApplicant: applicants[14].id }, uni);
  for (const v of applicants) assert.ok(html.includes(`<option value="${v.id}"`), v.name);
  assert.ok(html.includes(`${applicants[14].name} · Idle`));
  assert.ok(!html.includes(`<option value="${professor.id}"`));
  assert.equal(sim.enrol(professor, uni), false); assert.ok(uni.workers.includes(professor.id));
  assert.equal(sim.enrol(applicants[14], uni), true); assert.ok(uni.workers.includes(professor.id));
  sim.unassign(professor); assert.equal(sim.enrol(professor, uni), true);
});
