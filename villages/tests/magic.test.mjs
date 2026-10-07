// Magic goods: arcane crystals, the Scriptorium, the Enchanter's Forge, magic gear and scrolls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DAY, stageOf } from '../js/sim.js';
import { CENTERS } from '../js/world.js';
import { armorClass, classAttack, guardAttack, runExpedition, EXPEDITIONS } from '../js/rpg.js';
import { magicWants } from '../js/magic.js';
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

test('with both forges on Auto, the smith keeps the enchanter in swords and Runeblades get made', () => {
  const sim = fresh('magic-autoauto'), forge = build(sim, 'forge'), b = build(sim, 'enchanter'); build(sim, 'wizard');
  staff(sim, forge, 1); staff(sim, b, 2);
  sim.rpg().know = 500;
  Object.assign(sim.s.res, { crystal: 60, sword: 0, iron: 40, ore: 60, planks: 80, wood: 80, runeblade: 0, wand: 0, amulet: 0 });
  run(sim, 400);
  assert.ok(sim.s.res.runeblade >= 1, `runeblades made: ${sim.s.res.runeblade}`);
  assert.ok(sim.s.res.wand >= 1 && sim.s.res.amulet >= 1);
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

test('each class reaches for an item that helps it, and items only help what they should', () => {
  const A = { str: 14, dex: 16, con: 12, int: 12, wis: 14, cha: 16 };
  const v = (cls, w) => ({ cls, lvl: 3, abil: A, gear: { w } });
  assert.deepEqual(magicWants(v('bard', 'sword'), 'party'), ['runeblade', 'amulet']);
  assert.deepEqual(magicWants(v('bard'), 'party'), ['wand', 'amulet']);
  assert.deepEqual(magicWants(v('ranger', 'bow'), 'party'), ['amulet']);
  assert.deepEqual(magicWants(v('wizard', 'staff'), 'party'), ['wand', 'amulet']);
  // a bard fighting with a rapier gets nothing from a wand; one casting Vicious Mockery does
  const bs = v('bard', 'sword'), plain = classAttack(bs); bs.gear.m = 'wand'; assert.deepEqual(classAttack(bs), plain);
  const bm = v('bard'), mock = classAttack(bm); bm.gear.m = 'wand'; assert.equal(classAttack(bm).dc, mock.dc + 1);
  // a ranger's bow is not a runeblade
  const rg = v('ranger', 'bow'), bow = classAttack(rg); rg.gear.m = 'runeblade'; assert.deepEqual(classAttack(rg), bow);
  // a swordless fighter swings the runeblade with longsword dice, the same as a guard does
  const f = { cls: 'fighter', lvl: 3, abil: { ...A, str: 16 }, gear: { m: 'runeblade' } }, fa = classAttack(f), ga = guardAttack(f, 'melee');
  assert.equal(fa.name, 'runeblade'); assert.equal(fa.dmg.s, 8); assert.equal(fa.bonus, ga.bonus); assert.equal(fa.dmg.b, ga.dmg.b);
});

test('scribes leave the last crystals for an enchanter who could use them, and only then', () => {
  const setup = (res, pri) => {
    const sim = fresh('magic-share'), sc = build(sim, 'scriptorium'), en = build(sim, 'enchanter');
    staff(sim, sc, 1); staff(sim, en, 2); if (pri) sim.s.crystalPriority = pri;
    Object.assign(sim.s.res, { cloth: 20, scroll: 0, sword: 0, iron: 0, planks: 0, ...res });
    return { sim, sc };
  };
  // the enchanter has nothing else to work with: scribes carry on
  let { sim } = setup({ crystal: 4 });
  run(sim, 40);
  assert.ok(sim.s.res.scroll >= 1, 'scrolls while the enchanter has no swords, planks or iron');
  // the enchanter has planks for a wand: scribes leave the last two crystals
  ({ sim } = setup({ crystal: 2, planks: 5, wand: 0 }));
  assert.equal(sim.enchanterWantsCrystals(), true);
  run(sim, 60);
  assert.equal(sim.s.res.scroll, 0, "no scrolls from the enchanter's last two crystals");
  assert.equal(sim.s.res.wand, 1, 'the enchanter got them and made a wand');
  // set to Runeblades with no spare sword, the planks don't count: nothing to save crystals for
  sim.s.buildings.find(b => b.type === 'enchanter').data.recipe = 'runeblade'; sim.s.res.planks = 5; sim.s.res.sword = 2;
  assert.equal(sim.enchanterWantsCrystals(), false);
  sim.s.buildings.find(b => b.type === 'enchanter').data.recipe = 'auto';
  // and with the priority set to Share, they don't hold back
  sim.s.crystalPriority = 'share';
  assert.equal(sim.enchanterWantsCrystals(), false);
});

test('guards on a tower with a bow take an amulet, not a runeblade', () => {
  assert.deepEqual(magicWants({ cls: 'fighter', gear: { w: 'bow' } }, 'guard'), ['amulet']);
  assert.deepEqual(magicWants({ cls: 'fighter', gear: { w: 'sword' } }, 'guard'), ['runeblade', 'amulet']);
});

test("the enchanter's crystal use follows the worker's speed", () => {
  const sim = fresh('magic-use'), b = build(sim, 'enchanter'), v = staff(sim, b, 2);
  const use = sim.enchantUse(b), base = 2 * 60 / ((30 + 24 + 26) / 3);
  assert.ok(Math.abs(use - base * sim.workRate(v)) < 1e-9);
});

test("magic gear and an Enchanter's recipe survive a save and reload", () => {
  const sim = fresh('magic-save'), b = build(sim, 'enchanter'), v = sim.s.villagers.find(o => stageOf(o) === 'adult');
  v.cls = 'fighter'; sim.s.res.runeblade = 1; sim.equip(v, 'party', true); b.data.recipe = 'wand';
  const back = new Sim(sim.serialize());
  assert.equal(back.vById.get(v.id).gear.m, 'runeblade');
  assert.equal(back.bById.get(b.id).data.recipe, 'wand');
});

test('scrolls get read on expeditions, and unread ones come home', () => {
  const party = [1, 2, 3].map(id => ({ id, name: 'A' + id, cls: id === 1 ? 'wizard' : 'fighter', lvl: 1, abil: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, gear: {} }));
  const q = EXPEDITIONS.find(o => o.id === 'warren');   // three goblins (Burning Hands) and a CHA check (Guidance)
  let read = 0, back = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const out = runExpedition(q, party.map(p => ({ ...p })), mulberry32(seed), { scrolls: 2 });
    const used = out.lines.filter(l => /read a scroll/.test(l)).length;
    read += used; back += out.loot.scroll || 0;
    assert.equal(used + (out.loot.scroll || 0), 2, `seed ${seed}: every scroll is read or comes home`);
  }
  assert.ok(read > 30, `scrolls were read (${read})`);
  const tough = EXPEDITIONS.find(o => o.id === 'owlbear');   // one big foe: Bless
  const ob = runExpedition(tough, party.map(p => ({ ...p })), mulberry32(3), { scrolls: 2 });
  assert.ok(ob.lines.some(l => /scroll of Bless/.test(l)), 'Bless against a lone owlbear');
  const bh = runExpedition(q, party.map(p => ({ ...p })), mulberry32(3), { scrolls: 2 });
  assert.ok(bh.lines.some(l => /Burning Hands/.test(l)) && !bh.lines.some(l => /^Teamwork .*goblins/.test(l)), 'the reader gets the credit');
  assert.ok(runExpedition(q, party, mulberry32(7), {}).lines.every(l => !/scroll/.test(l)), 'none without scrolls');
});

test('quarry miners turn up crystals only once a Wizard Tower stands', () => {
  const sim = fresh('magic-quarry'), q = build(sim, 'quarry'), v = sim.s.villagers[0];
  sim.s.res.crystal = 0;
  for (let i = 0; i < 200; i++) sim.rpgOre(v, q);
  assert.equal(sim.s.res.crystal, 0);
  build(sim, 'wizard');
  for (let i = 0; i < 200; i++) sim.rpgOre(v, q);
  assert.ok(sim.s.res.crystal >= 55 && sim.s.res.crystal <= 130, `found ${sim.s.res.crystal}`);   // 30% of 200 loads, 1-2 each
});

test('the market sells magic items by default, and keeps crystals', () => {
  const sim = fresh('magic-market');
  for (const k of ['scroll', 'runeblade', 'wand', 'amulet']) assert.equal(sim.s.sell[k], true, k);
  assert.equal(sim.s.sell.crystal, false);
});

test('the market sells a lone Runeblade before a bigger heap of cheap food', () => {
  const sim = fresh('magic-sell'), m = build(sim, 'market');
  const v = sim.s.villagers.find(o => stageOf(o) === 'adult' && o.job === 'idle'); assert.ok(sim.assign(m, v));
  Object.assign(sim.s.res, { food: 400, runeblade: 3 }); sim.s.sell.food = true;
  const coins = sim.s.res.coins;
  run(sim, 30);
  assert.equal(sim.s.res.runeblade, 2, 'the spare Runeblade went first');
  assert.ok(sim.s.res.coins >= coins + 70);
});
