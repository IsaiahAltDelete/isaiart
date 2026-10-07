// Magic goods: arcane crystals, the Scriptorium, the Enchanter's Forge, magic gear and scrolls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DAY, stageOf } from '../js/sim.js';
import { CENTERS } from '../js/world.js';
import { armorClass, classAttack, runExpedition, EXPEDITIONS } from '../js/rpg.js';
import { mulberry32 } from '../js/rng.js';

const fresh = (seed = 'magic-tests') => { const sim = new Sim(null, { seed }); sim.s.level = 10; sim.s.tutorial = 99; return sim; };
function build(sim, type, sid = 'meadow') {
  const c = CENTERS[sid];
  for (let r = 2; r < 21; r++) for (let z = c.z - r; z <= c.z + r; z++) for (let x = c.x - r; x <= c.x + r; x++) {
    const ok = sim.checkPlace(type, x, z, 0, -2);
    if (ok.ok && ok.sid === sid) return sim.addBuilding(type, x, z, 0, true);
  }
  throw Error('No room for ' + type);
}
function staff(sim, b, tier = 2) {
  const v = sim.s.villagers.find(o => stageOf(o) === 'adult' && o.job === 'idle');
  v.tier = tier; v.educated = true;
  assert.ok(sim.assign(b, v), 'hired');
  return v;
}
function run(sim, secs) {
  sim.s.time = Math.floor(sim.s.time / DAY) * DAY + DAY * 0.4;
  for (let i = 0; i < secs * 10; i++) { if (sim.s.weather) sim.s.weather.storm = false; sim.s.fest = null; sim.tick(0.1); }
}

test('the Enchanter\'s Forge needs a Forge and a Wizard Tower; the Scriptorium a Library', () => {
  const sim = fresh();
  assert.match(sim.gateOf('enchanter').why, /Forge and a Wizard Tower/);
  assert.match(sim.gateOf('scriptorium').why, /Library/);
  build(sim, 'library'); build(sim, 'forge');
  assert.equal(sim.gateOf('scriptorium'), null);
  assert.match(sim.gateOf('enchanter').why, /Wizard Tower/);
  build(sim, 'wizard');
  assert.equal(sim.gateOf('enchanter'), null);
});

test('scribes work indoors and turn cloth and crystals into scrolls', () => {
  const sim = fresh('magic-scribe'), b = build(sim, 'scriptorium'), v = staff(sim, b, 1);
  sim.s.res.cloth = 10; sim.s.res.crystal = 10; sim.s.res.scroll = 0;
  run(sim, 60);
  assert.equal(v.job, 'scribe');
  assert.ok(sim.s.res.scroll >= 2, `made ${sim.s.res.scroll} scrolls`);
  assert.ok(sim.s.res.crystal <= 8);
});

test('an enchanter makes magic items and leaves two swords for the armory', () => {
  const sim = fresh('magic-enchant'), b = build(sim, 'enchanter'), v = staff(sim, b, 2);
  Object.assign(sim.s.res, { crystal: 40, sword: 3, planks: 50, iron: 10, runeblade: 0, wand: 0, amulet: 0 });
  run(sim, 120);
  assert.equal(v.job, 'enchanter');
  const made = sim.s.res.runeblade + sim.s.res.wand + sim.s.res.amulet;
  assert.ok(made >= 4, `made ${made}`);
  assert.ok(sim.s.res.wand >= 1 && sim.s.res.amulet >= 1, 'a bit of everything');
  assert.ok(sim.s.res.sword >= 2, 'swords kept for the armory');
});

test('an enchanter without crystals says so', () => {
  const sim = fresh('magic-nocrystal'), b = build(sim, 'enchanter'); staff(sim, b, 2);
  sim.s.res.crystal = 0;
  run(sim, 20);
  assert.match(b.status || '', /crystal/i);
});

test('adventurers take a magic item, and give it back', () => {
  const sim = fresh('magic-equip'), v = sim.s.villagers.find(o => stageOf(o) === 'adult');
  v.cls = 'fighter'; sim.s.res.runeblade = 1; sim.s.res.amulet = 1;
  sim.equip(v, 'party', true);
  assert.equal(v.gear.m, 'runeblade'); assert.equal(sim.s.res.runeblade, 0);
  sim.unequip(v);
  assert.equal(v.gear.m, undefined); assert.equal(sim.s.res.runeblade, 1);
  v.cls = 'wizard'; sim.s.res.wand = 1;
  sim.equip(v, 'party', true);
  assert.equal(v.gear.m, 'wand');
});

test('items change the dice: amulet +1 AC, runeblade and wand +1 to hit and +2 damage', () => {
  const v = { cls: 'fighter', lvl: 3, abil: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, gear: { w: 'sword' } };
  const ac = armorClass(v), atk = classAttack(v);
  v.gear.m = 'amulet'; assert.equal(armorClass(v), ac + 1);
  v.gear.m = 'runeblade'; const rb = classAttack(v);
  assert.equal(rb.bonus, atk.bonus + 1); assert.equal(rb.dmg.b, atk.dmg.b + 2);
  v.gear.m = 'wand'; assert.deepEqual(classAttack(v), atk, 'a wand does nothing for a sword');
  const w = { cls: 'wizard', lvl: 3, abil: { str: 8, dex: 12, con: 12, int: 16, wis: 10, cha: 10 }, gear: {} };
  const fb = classAttack(w); w.gear.m = 'wand'; const fw = classAttack(w);
  assert.equal(fw.bonus, fb.bonus + 1); assert.equal(fw.dmg.b, fb.dmg.b + 2);
  const c = { cls: 'cleric', lvl: 3, abil: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 }, gear: {} };
  const sf = classAttack(c); c.gear.m = 'wand'; assert.equal(classAttack(c).dc, sf.dc + 1);
});

test('scrolls get read on expeditions, and unread ones come home', () => {
  const party = [1, 2, 3].map(id => ({ id, name: 'A' + id, cls: id === 1 ? 'wizard' : 'fighter', lvl: 1, abil: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, gear: {} }));
  const q = EXPEDITIONS.find(o => o.id === 'warren');   // three goblins (a Fireball) and a CHA check (a second try)
  let read = 0, back = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const out = runExpedition(q, party.map(p => ({ ...p })), mulberry32(seed), { scrolls: 2 });
    const used = out.lines.filter(l => /read a scroll/.test(l)).length;
    read += used; back += out.loot.scroll || 0;
    assert.equal(used + (out.loot.scroll || 0), 2, `seed ${seed}: every scroll is read or comes home`);
  }
  assert.ok(read > 30, `scrolls were read (${read})`);
  assert.ok(runExpedition(q, party, mulberry32(7), {}).lines.every(l => !/scroll/.test(l)), 'none without scrolls');
});

test('quarry miners turn up crystals only once a Wizard Tower stands', () => {
  const sim = fresh('magic-quarry'), q = build(sim, 'quarry'), v = sim.s.villagers[0];
  sim.s.res.crystal = 0;
  for (let i = 0; i < 200; i++) sim.rpgOre(v, q);
  assert.equal(sim.s.res.crystal, 0);
  build(sim, 'wizard');
  for (let i = 0; i < 200; i++) sim.rpgOre(v, q);
  assert.ok(sim.s.res.crystal >= 8 && sim.s.res.crystal <= 45, `found ${sim.s.res.crystal}`);
});

test('the market sells magic items by default, and keeps crystals', () => {
  const sim = fresh('magic-market');
  for (const k of ['scroll', 'runeblade', 'wand', 'amulet']) assert.equal(sim.s.sell[k], true, k);
  assert.equal(sim.s.sell.crystal, false);
});
