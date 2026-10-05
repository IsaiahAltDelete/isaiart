// Classes earn their keep at home, not only on expeditions.
//  Paladins answer the alarm: when a beast or raider prowls their settlement they wake,
//    take up sword and shield and charge it, opening with a Divine Smite. Once a day each
//    lays hands on a knocked-out neighbour. They stand up to the dragon too.
//  Rangers shoot at prowling beasts within bowshot of wherever they are.
//  Rogues know every trick: they spot sneaking thieves and help put names to wanted posters.
//  Bards smooth things over: squabbles near a bard are half as likely.
//  Fighters break up scuffles; clerics cure fevers and lay spirits to rest (events.js);
//  wizards and the Archmage blast the dragon (events.js).
import { stageOf } from './sim.js';
import { maxHp, roll } from './rpg.js';

export const CLASS_DUTY = {
  paladin: 'Answers the alarm: charges beasts and raiders with a Divine Smite, lays hands on the knocked-out, and faces the dragon.',
  fighter: 'Breaks up scuffles, and stands with the guards when the dragon comes.',
  ranger: 'Shoots at beasts prowling within bowshot, and at the dragon.',
  rogue: 'Spots sneaking thieves and helps put names to wanted posters.',
  wizard: 'Studies at the tower, and blasts the dragon with fire bolts.',
  cleric: 'Cures fevers and lays restless spirits to rest.',
  bard: 'Smooths things over: squabbles near a bard are half as likely.',
  commoner: 'Ordinary village life. Training at a Temple, the Training Yard, a wizard tower or the guild gives them a class.',
};
const ready = v => v && stageOf(v) === 'adult' && !(v.ko > 0) && !v.downed && !v.quest && !v.jail && !v.engage;   // jail is cleared to 0 on release

export function installClassDuties(sim) {
  const s = sim.s;
  const near = (a, x, z, r) => Math.hypot(a.x - x, a.z - z) < r;
  const defend = sim.rpgDefend.bind(sim);
  sim.rpgDefend = () => {
    defend();
    if (!s.beasts.length) return;
    const now = s.time;
    for (const bst of s.beasts) {
      if (bst.state !== 'prowl' || bst.hp <= (bst.maxHp || 0) * 0.4) continue;
      // a paladin (awake or not) answers the call
      const p = s.villagers.filter(v => v.cls === 'paladin' && v.home === bst.sid && ready(v) && (v.hp ?? 0) >= maxHp(v) * 0.5 && near(v, bst.x, bst.z, 16))
        .sort((a, b) => Math.hypot(a.x - bst.x, a.z - bst.z) - Math.hypot(b.x - bst.x, b.z - bst.z))[0];
      if (p) {
        p.engage = bst.id; bst.foe = p.id; bst.state = 'fight'; bst.fightT = now; bst.path = null; bst.smitten = false;
        p.asleep = null; p.indoors = false; sim.dropTask(p); p.thinkCd = 0;
        if (!p.gear?.w) sim.equip?.(p, 'guard', true);
        sim.emit('dmg', p.x, p.z, 'For the village!', 'shield');
      }
    }
    // rangers loose an arrow every other second at the nearest beast in bowshot
    if ((now | 0) % 2 === 0) for (const r of s.villagers) {
      if (r.cls !== 'ranger' || !ready(r) || r.asleep && !s.beasts.some(b => b.sid === r.home && b.state !== 'flee' && near(r, b.x, b.z, 12))) continue;
      const tgt = s.beasts.filter(b => b.state !== 'flee' && near(r, b.x, b.z, 11)).sort((a, b) => Math.hypot(a.x - r.x, a.z - r.z) - Math.hypot(b.x - r.x, b.z - r.z))[0];
      if (!tgt) continue;
      r.asleep = null; r.indoors = false;
      sim.emit('arrow', r.x, r.z, tgt);
      sim.rpgSwing(r, tgt, 'ranged');
    }
    // lay on hands: each paladin, once a day, lifts a knocked-out neighbour back up
    const day = sim.dayNum();
    for (const p of s.villagers) {
      if (p.cls !== 'paladin' || p.layDay === day || !ready(p)) continue;
      const hurt = s.villagers.find(v => v.ko > 0 && v.home === p.home && near(v, p.x, p.z, 12));
      if (!hurt) continue;
      p.layDay = day; hurt.ko = 0; hurt.downed = false; hurt.hp = Math.max(hurt.hp || 0, Math.ceil(maxHp(hurt) * 0.6));
      sim.emit('dmg', hurt.x, hurt.z, 'Lay on Hands', 'heart');
      sim.story('hero', `${p.name} laid hands on ${hurt.name} and got them back on their feet.`, [p, hurt], 'heart');
    }
  };
  // the paladin's first blow in each fight carries a Divine Smite
  const swing = sim.rpgSwing.bind(sim);
  sim.rpgSwing = (g, bst, mode) => {
    const n = swing(g, bst, mode);
    if (n > 0 && g.cls === 'paladin' && !bst.smitten) {
      bst.smitten = true;
      const sm = roll(sim.rng, 2, 8); bst.hp -= sm;
      sim.emit('dmg', bst.x, bst.z, `Smite ${sm}`, 'crit');
    }
    return n;
  };
  // bards calm tempers nearby
  sim.calmNear = v => s.villagers.some(o => o.cls === 'bard' && o !== v && !o.asleep && near(o, v.x, v.z, 8));
}
