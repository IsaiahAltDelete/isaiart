// Round 12: the Story page, village drama (quirks, squabbles, rivals, break-ups, mischief)
// and hard times (droughts, fevers, fires, quakes, raiders, spirits, the fair folk, dragons).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DAY } from '../js/sim.js';
import { CENTERS } from '../js/world.js';
import { RIVAL, QUIRKS } from '../js/social.js';
import { EVENTS } from '../js/events.js';

const fresh = () => { const sim = new Sim(null, { seed: 'round-twelve-tests' }); sim.s.level = 9; return sim; };
function build(sim, type, sid = 'meadow') {
  const c = CENTERS[sid];
  for (let r = 2; r < 21; r++) for (let z = c.z - r; z <= c.z + r; z++) for (let x = c.x - r; x <= c.x + r; x++) {
    const ok = sim.checkPlace(type, x, z, 0, -2);
    if (ok.ok && ok.sid === sid) return sim.addBuilding(type, x, z, 0, true);
  }
  throw Error('No room for ' + type);
}
const toasts = sim => { const out = []; const h = sim.handlers.toast; sim.on('toast', (m, i) => { out.push(m); h?.(m, i); }); return out; };

test('life events go to the Story with face snapshots, not popups', () => {
  const sim = fresh(), seen = toasts(sim), [a, b] = sim.s.villagers;
  sim.story('love', `${a.name} and ${b.name} fell in love.`, [a, b], 'heart');
  const e = sim.s.story[0];
  assert.equal(e.kind, 'love'); assert.deepEqual(e.faces.map(f => f.id), [a.id, b.id]); assert.equal(seen.length, 0);
  sim.passAway(a);
  assert.equal(sim.s.story[0].kind, 'farewell'); assert.equal(sim.s.story[0].faces[0].name, a.name);
  assert.ok(!seen.some(m => /passed away/.test(m)));
  const loaded = new Sim(sim.serialize()); assert.equal(loaded.s.story.length, sim.s.story.length); assert.equal(loaded.s.storyN, sim.s.storyN);
});

test('a burst of new best friends becomes one Story entry', () => {
  const sim = fresh(), [a, b, c, d] = sim.s.villagers, before = sim.s.story?.length || 0;
  sim.story('friends', `${a.name} and ${b.name} are best friends now.`, [a, b]);
  sim.story('friends', `${c.name} and ${d.name} are best friends now.`, [c, d]);
  assert.equal(sim.s.story.length, before + 1); assert.match(sim.s.story[0].text, /New best friends/); assert.equal(sim.s.story[0].faces.length, 4);
});

test('everyone has a quirk; quirks persist through saves', () => {
  const sim = fresh();
  assert.ok(sim.s.villagers.every(v => QUIRKS[v.quirk]));
  const v = sim.spawnVillager('meadow', 8, 4, { age: 20 }); assert.ok(QUIRKS[v.quirk]);
  const loaded = new Sim(sim.serialize()); assert.equal(loaded.vById.get(v.id).quirk, v.quirk);
});

test('squabbles push a pair into rivalry, with a Story entry; festivals can mend it', () => {
  const sim = fresh(), [a, b] = sim.s.villagers;
  for (let i = 0; i < 8; i++) sim.bumpAffinity(a, b, -6);
  assert.ok(sim.affinity(a, b) <= RIVAL); assert.ok(sim.rivalsOf(a).some(r => r.v === b));
  assert.ok(sim.s.story.some(e => e.kind === 'rivals'));
  sim.rng = () => 0; sim.endFestival({ name: 'Test Fair', icon: 'party' });
  assert.ok(sim.affinity(a, b) > RIVAL); assert.ok(sim.s.story.some(e => e.kind === 'makeup'));
});

test('friendships fade without time together; couples form only from friendship', () => {
  const sim = fresh(), [a, b] = sim.s.villagers;
  sim.bumpAffinity(a, b, 50); const before = sim.affinity(a, b);
  a.indoors = b.indoors = true; for (let i = 0; i < 20; i++) sim.second();
  assert.ok(sim.affinity(a, b) < before);
  // strangers don't pair up; friends do
  for (const v of sim.s.villagers) { v.partner = null; v.age = 25; }
  for (const k of Object.keys(sim.s.friends)) delete sim.s.friends[k];
  sim.rng = () => 0; sim.s.time = Math.ceil(sim.s.time / 10) * 10; sim.lifeCycle?.();
  assert.ok(sim.s.villagers.every(v => !v.partner));
});

test('a couple who keep squabbling may part ways', () => {
  const sim = fresh(), [a, b] = sim.s.villagers; a.partner = b.id; b.partner = a.id; a.loveSeeded = b.loveSeeded = true;
  sim.bumpAffinity(a, b, -40); sim.rng = () => 0;
  for (let i = 0; i < 5; i++) sim.second();
  assert.equal(a.partner, null); assert.ok(sim.s.story.some(e => e.kind === 'breakup'));
});

test('mischief is harmless: a story, a little food, a ruffled friendship', () => {
  const sim = fresh(); build(sim, 'bakery'); sim.s.villagers.forEach(v => { v.quirk = 'prankster'; v.age = 18; });
  sim.rng = () => 0.01;
  const msg = sim.mischief('meadow');
  assert.ok(msg); assert.equal(sim.s.story[0].kind, 'mischief');
});

test('hard times wait a day on a new village, and can be switched off', () => {
  const sim = fresh(); sim.s.time = DAY * 6.3;
  sim.s.events.mode = 'off'; sim.second(); assert.equal(sim.s.events.list.length, 0);
  sim.s.events.mode = 'normal'; sim.rng = () => 0; sim.s.events.rolled = -1; sim.second();
  assert.equal(sim.s.events.list.length, 1); assert.ok(EVENTS[sim.s.events.list[0].type]);
});

test('a drought slows crops and berries, and rain breaks it', () => {
  const sim = fresh(), base = sim.season().crops;
  const e = sim.startEvent('drought'); assert.ok(sim.season().crops < base);
  sim.s.weather.rain = true; sim.eventsSecond(); assert.ok(!sim.s.events.list.includes(e)); assert.equal(sim.season().crops, base);
});

test('fever slows work; a cleric at the chapel cures it', () => {
  const sim = fresh(), chapel = build(sim, 'chapel'), e = sim.startEvent('fever');
  const sick = sim.s.villagers.filter(v => v.sick > sim.s.time); assert.ok(sick.length >= 2);
  const cleric = sim.s.villagers.find(v => !sick.includes(v) && v.age >= 14) || sim.s.villagers.at(-1);
  sim.clericRound(cleric, chapel); assert.equal(sim.s.villagers.filter(v => v.sick > sim.s.time).length, sick.length - 1);
  sim.s.time = e.until + 1; sim.eventsSecond(); assert.ok(sim.s.villagers.every(v => !(v.sick > sim.s.time)));
});

test('an unattended fire burns a building down; repairs bring it back', () => {
  const sim = fresh(), b = build(sim, 'lumber'); sim.s.villagers.forEach(v => { v.quest = {}; });
  assert.ok(sim.ignite(b)); assert.equal(sim.ignite(b), false);
  for (let i = 0; i < 60 && b.fire; i++) sim.fireSecond();
  assert.equal(b.fire, null); assert.equal(b.damaged, true); assert.equal(sim.canUpgrade(b).ok, false);
  sim.s.res.coins = 999; sim.s.res.wood = 999; sim.s.stock.meadow.wood = 999; sim.ledger.tot.wood = 999;
  assert.ok(sim.repair(b)); assert.ok(b.up?.repair);
  sim.finishUpgrade(b); assert.equal(b.damaged, false); assert.equal(b.up, null); assert.equal(b.lvl || 1, 1);
});

test('a bucket chain with a well close by puts the fire out', () => {
  const sim = fresh(), b = build(sim, 'lumber'); build(sim, 'well');
  const crew = sim.s.villagers.slice(0, 4), c = sim.bCenter(b);
  for (let k = 0; k < 2; k++) crew.push(sim.spawnVillager('meadow', c.x, c.z, { age: 25 }));
  sim.ignite(b);
  for (let i = 0; i < 200 && b.fire; i++) { for (const v of crew) { v.fireB = b.id; v.x = c.x + 1; v.z = c.z; v.act = { t: 0 }; } sim.fireSecond(); }
  assert.equal(b.fire, null); assert.ok(!b.damaged); assert.ok(sim.s.story.some(e => /put out the fire/.test(e.text)));
});

test('an earthquake damages a building; raiders strike at night', () => {
  const sim = fresh(); build(sim, 'lumber'); sim.rng = () => 0.3;
  sim.startEvent('quake'); assert.ok(sim.s.buildings.some(b => b.damaged));
  const sim2 = fresh(); const e = sim2.startEvent('raiders'); sim2.s.time = DAY * 6 + DAY * 0.97;
  sim2.eventsSecond(); assert.ok(e.data.struck); assert.ok(sim2.s.beasts.filter(b => b.kind === 'goblin').length >= 4);
});

test('the fair folk take an offering and bless the fields', () => {
  const sim = fresh(), e = sim.startEvent('fae'), base = sim.season().crops;
  assert.equal(sim.makeOffering(e), false);
  sim.s.res.honey = 10; sim.s.stock.meadow.honey = 10; sim.ledger.tot.honey = 10;
  assert.ok(sim.makeOffering(e)); assert.ok(!sim.s.events.list.includes(e)); assert.ok(sim.season().crops > base);
});

test('defenders drive the dragon off for gems; it swoops at buildings meanwhile', () => {
  const sim = fresh(); build(sim, 'lumber'); build(sim, 'sawmill');
  sim.s.villagers.forEach(v => { v.job = 'guard'; v.asleep = false; v.quest = null; v.home = 'meadow'; });
  const e = sim.startEvent('dragon'), gems = sim.s.res.gems; sim.rng = () => 0.1;
  for (let i = 0; i < 300 && sim.s.events.list.includes(e); i++) { sim.dragonSecond(e); sim.s.time += 1; }
  assert.ok(!sim.s.events.list.includes(e)); assert.ok(sim.s.res.gems > gems);
  assert.ok(sim.s.story.some(e => /drove the dragon away/.test(e.text)));
});

test('hard times and fires survive a save', () => {
  const sim = fresh(), b = build(sim, 'lumber'); sim.startEvent('spirits'); sim.ignite(b);
  const loaded = new Sim(sim.serialize());
  assert.equal(loaded.s.events.list[0].type, 'spirits'); assert.ok(loaded.bById.get(b.id).fire);
});

test('chats and squabbles put speech bubbles over both villagers', () => {
  const sim = fresh(), [a, b] = sim.s.villagers;
  sim.talk(a, b, 'angry', 5);
  assert.equal(a.talk.k, 'angry'); assert.equal(b.talk.with, a.id); assert.ok(a.talk.until > sim.s.time);
});

test('a scuffle leaves bruises, never a knock-out; a guard nearby breaks it up and the Watch House holds the instigator', () => {
  const sim = fresh(), house = build(sim, 'watchhouse'), [a, b, g] = sim.s.villagers;
  a.hp = 2; b.hp = 5; g.job = 'guard'; g.x = a.x; g.z = a.z; g.asleep = null; sim.rng = () => 0.9;
  sim.scuffle(a, b);
  assert.ok(a.hp >= 1 && b.hp >= 1 && b.hp < 5); assert.ok(!(a.ko > 0)); assert.equal(a.task.label, 'Scuffling');
  assert.ok(a.jail > sim.s.time); assert.equal(a.jailHouse, house.id); assert.equal(sim.s.story[0].kind, 'scuffle');
});

test('a hungry villager raids a field, eats, and is let off with a loaf the first time', () => {
  const sim = fresh(), farm = build(sim, 'farm'), [v, g] = sim.s.villagers;
  farm.data.stage = 'growing'; farm.data.grow = 0.8; v.hungry = true; g.job = 'guard'; g.asleep = null;
  assert.ok(sim.startRaid(v)); sim.think(v); assert.equal(v.task.label, 'Looking for something to eat');
  g.x = v.x; g.z = v.z; sim.raidDone(v, farm);
  assert.equal(v.hungry, false); assert.ok(farm.data.grow < 0.8); assert.ok(!(v.jail > sim.s.time)); assert.match(sim.s.story[0].text, /loaf of bread|bowl of soup|stern word|own lunch|ask next time/);
});

test('wanted posters: unknown until identified, a bounty costs 20, a watcher catches a known culprit', () => {
  const sim = fresh(), house = build(sim, 'watchhouse'), [thief, cop] = sim.s.villagers;
  const p = sim.addWanted(thief, 'Stole 20 coins', false); assert.equal(p.known, false);
  sim.s.res.coins = 100; assert.ok(sim.postBounty(p)); assert.equal(sim.s.res.coins, 80); assert.equal(sim.postBounty(p), false);
  sim.identify(p, cop); assert.ok(p.known); assert.equal(sim.wantedOf(thief), p);
  cop.job = 'constable'; cop.home = thief.home; cop.asleep = null; cop.quest = null; cop.x = thief.x; cop.z = thief.z; thief.asleep = null; thief.indoors = false; sim.rng = () => 0;
  sim.wantedSecond(); assert.ok(p.caught); assert.ok(thief.jail > sim.s.time); assert.equal(sim.wantedOf(thief), null);
  const loaded = new Sim(sim.serialize()); assert.equal(loaded.s.crime.wanted[0].name, thief.name);
});

test('temple acolytes with the build for it become paladins, who answer the alarm with a smite', () => {
  const sim = fresh(), temple = build(sim, 'temple'), v = sim.s.villagers.find(o => o.age >= 14);
  v.tier = 2; v.cls = null; v.abil = { str: 18, dex: 10, con: 14, int: 8, wis: 10, cha: 18 };
  assert.ok(sim.assign(temple, v)); assert.equal(v.cls, 'paladin');
  sim.unassign(v);
  sim.spawnBeast('wolf', 'meadow', v.x + 3, v.z); const bst = sim.s.beasts.at(-1); v.hp = 30;
  sim.rpgDefend();
  assert.equal(bst.state, 'fight'); assert.equal(bst.foe, v.id); assert.equal(v.engage, bst.id);
});

test('same-day hunger raids caught by one guard merge into one Story entry that still draws', () => {
  const sim = fresh(), farm = build(sim, 'farm'), [g, ...rest] = sim.s.villagers;
  g.job = 'guard'; g.asleep = null;
  for (const v of rest.slice(0, 3)) { v.hungry = true; v.hat = true; g.x = v.x; g.z = v.z; farm.data.stage = 'growing'; sim.raidDone(v, farm); }
  const e = sim.s.story[0];
  assert.equal(e.raids, 3); assert.match(e.text, /caught 3 of them/); assert.ok(e.faces.length >= 3);
  assert.ok(e.faces.every(f => 'hatColor' in f || !f.hat));
});
