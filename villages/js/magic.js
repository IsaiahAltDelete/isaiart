// Magic goods: arcane crystals and what's made from them.
//   - Quarry miners turn up crystals now and then once a Wizard Tower stands; expeditions bring more.
//   - The Scriptorium's scribes make Spell Scrolls (a plain converter: see CONVERT.scribe in sim.js).
//   - The Enchanter's Forge works crystals into the Forge's goods: Runeblades, Wands, Warding Amulets.
//   - Adventurers and guards take one magic item each from storage (a fourth gear slot, `gear.m`), and a
//     party takes up to two scrolls on an expedition (runExpedition in rpg.js reads them).
// Effects of the items live with the rest of the dice in rpg.js (armorClass, guardAttack, classAttack).
import { GOODS } from './data.js';
import { classOf } from './rpg.js';

export const ENCHANTS = [
  { id: 'runeblade', out: 'runeblade', in: { sword: 1, crystal: 2 },  t: 30, verb: 'Etching a runeblade', keep: { sword: 2 } },
  { id: 'wand',      out: 'wand',      in: { planks: 1, crystal: 2 }, t: 24, verb: 'Binding a wand' },
  { id: 'amulet',    out: 'amulet',    in: { iron: 1, crystal: 2 },   t: 26, verb: 'Warding an amulet', keep: { iron: 2 } },
];
export const MAGIC_ITEMS = ['runeblade', 'wand', 'amulet'];
// What each adventurer reaches for: the item that helps their attack, then an amulet. A Runeblade is a
// melee weapon (no use to archers), a Wand only helps real spells (a bard with a rapier isn't casting).
export function magicWants(v, role) {
  if (role === 'guard') return v.gear?.w === 'bow' ? ['amulet'] : ['runeblade', 'amulet'];   // tower archers don't swing a blade
  const cls = classOf(v), w = v.gear?.w;
  if (cls === 'wizard' || cls === 'cleric') return ['wand', 'amulet'];
  if (cls === 'bard') return w === 'sword' ? ['runeblade', 'amulet'] : ['wand', 'amulet'];
  if (cls === 'ranger' || cls === 'rogue') return w === 'bow' ? ['amulet'] : ['runeblade', 'amulet'];
  return ['runeblade', 'amulet'];
}
export const SCROLLS_PER_PARTY = 2;
const CRYSTAL_CHANCE = 0.3;    // per load of stone a miner brings back, once a Wizard Tower stands: 1 or 2 crystals
const enchanterAt = sim => sim.s.buildings.some(b => b.type === 'enchanter' && b.built && b.workers.length);

export function installMagic(sim) {
  const s = () => sim.s;

  // ── the Enchanter's Forge ──
  // the smith's Auto keeps two more swords on hand while an enchanter is at work (rpg.js forgePick)
  sim.enchantDemand = out => out === 'sword' && enchanterAt(sim) ? 2 : 0;
  // Should the scribes leave crystals alone? Only while an enchanter is at work and has everything else
  // for at least one item, and only if the player puts the Enchanter first (the default; see the panel).
  sim.enchanterWantsCrystals = () => {
    if ((s().crystalPriority || 'enchanter') !== 'enchanter') return false;
    const res = s().res;
    const ready = rc => Object.entries(rc.in).every(([k, n]) => k === 'crystal' || (res[k] || 0) - n >= (rc.keep?.[k] || 0));
    // only the recipes this enchanter would actually make: all of them on Auto, else the one picked
    return s().buildings.some(b => b.type === 'enchanter' && b.built && b.workers.length
      && ENCHANTS.some(rc => ((b.data?.recipe || 'auto') === 'auto' || b.data.recipe === rc.id) && ready(rc)));
  };
  // what one enchanter gets through: crystals a minute at this worker's speed (workRate: skill, happiness, upgrades)
  sim.enchantUse = b => {
    const v = sim.vById.get(b.workers[0]); if (!v) return 0;
    const t = ENCHANTS.reduce((a, rc) => a + rc.t, 0) / ENCHANTS.length;
    return 2 * 60 * sim.workRate(v) / t;
  };
  // crystals coming in per minute, from what quarries reported (for the panel)
  // (null until there's at least half a minute of history: one lucky find shouldn't read as a rate)
  sim.crystalRate = () => sim.bflowHist.length < 3 ? null : s().buildings.filter(b => b.type === 'quarry').reduce((a, b) => a + sim.bRate(b, 'crystal'), 0);
  sim.enchantPick = b => {
    const res = s().res, mode = b.data?.recipe || 'auto';
    const short = rc => Object.entries(rc.in).some(([k, n]) => (res[k] || 0) - n < (rc.keep?.[k] || 0));
    const need = rc => `Needs ${Object.entries(rc.in).filter(([k, n]) => (res[k] || 0) - n < (rc.keep?.[k] || 0)).map(([k]) => GOODS[k].name.toLowerCase()).join(', ')}`;
    if (mode !== 'auto') {
      const rc = ENCHANTS.find(o => o.id === mode);
      return rc && !short(rc) ? { rc } : { why: rc ? need(rc) : 'Pick something to make' };
    }
    // auto: whatever there's least of (so adventurers get a bit of everything), then round and round for the market
    const ok = ENCHANTS.filter(rc => !short(rc)).sort((a, c) => (res[a.out] || 0) - (res[c.out] || 0));
    return ok.length ? { rc: ok[0] } : { why: (res.crystal || 0) < 2 ? 'Needs arcane crystals' : need(ENCHANTS[0]) };
  };
  sim.taskEnchant = (v, b) => {
    const p = sim.spot(b, b.workers.indexOf(v.id)), c = sim.bCenter(b);
    let rc = null;
    sim.setTask(v, 'Enchanting', [{ walk: sim.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] },
      { act: 12, anim: 'cast', start: () => {
        const pk = sim.enchantPick(b);
        b.data ||= {};
        if (!pk.rc) { b.status = pk.why; b.data.making = null; v.act.anim = 'rest'; v.act.idle = true; if (v.task) v.task.label = 'Waiting for materials'; return; }
        rc = pk.rc; b.status = null; b.data.making = rc.id; v.act.dur = rc.t;
        if (v.task) v.task.label = rc.verb;
        sim.pay(rc.in); for (const [k, n] of Object.entries(rc.in)) sim.credit(b, k, -n);
      }, done: act => {
        if (!act.idle && rc) {
          const got = sim.add(rc.out, 1); sim.credit(b, rc.out, got);
          sim.emit('float', c.x, c.z, got ? '+1' : 'Full!', rc.out);
          s().stats.enchanted = (s().stats.enchanted || 0) + got;
          sim.addXp(6); sim.rpgGainXp?.(v, 3);
        }
        sim.repeat(v);
      } }]);
  };

  // ── crystals from the quarry ──
  const ore = sim.rpgOre.bind(sim);
  sim.rpgOre = (v, b) => {
    ore(v, b);
    if (sim.rng() > CRYSTAL_CHANCE || !s().buildings.some(o => o.type === 'wizard' && o.built)) return;
    const got = sim.add('crystal', sim.rng() < 0.5 ? 2 : 1);
    if (got) { sim.emit('float', v.x, v.z, `+${got}`, 'crystal'); sim.credit(b, 'crystal', got); }
  };

  // ── a fourth gear slot for one magic item ──
  const takeOne = k => { const res = s().res; if ((res[k] || 0) >= 1) { res[k] -= 1; sim.track(k, -1); return true; } return false; };
  const equip = sim.equip.bind(sim);
  sim.equip = (v, role, quiet) => {
    const got = equip(v, role, quiet), g = v.gear || (v.gear = {});
    if (!g.m) for (const m of magicWants(v, role)) if (takeOne(m)) { g.m = m; got.push(m); sim.emit('res'); break; }
    return got;
  };
  const canEquip = sim.canEquip.bind(sim);
  sim.canEquip = (v, role) => canEquip(v, role) || (!v.gear?.m && magicWants(v, role).some(m => (s().res[m] || 0) >= 1));
  const unequip = sim.unequip.bind(sim);
  sim.unequip = v => {
    const m = v.gear?.m;
    if (m) s().res[m] = (s().res[m] || 0) + 1;
    unequip(v);
  };

  // ── scrolls for an expedition: up to two from storage; unread ones come home with the loot ──
  sim.takeScrolls = () => {
    let n = 0;
    while (n < SCROLLS_PER_PARTY && takeOne('scroll')) n++;
    if (n) sim.emit('res');
    return n;
  };
}
