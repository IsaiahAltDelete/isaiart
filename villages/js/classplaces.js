// Faith and practical class training use the existing jobs, wages and RPG rules.
import { lvlOf, stageOf } from './sim.js';
import { classOf, maxHp } from './rpg.js';

export const CLASS_PLACES = {
  chapel: { cls: 'cleric', label: 'Tending the chapel', benefit: 'Clerics restore health to a nearby injured resident and lift public spirits.' },
  temple: { cls: 'cleric', label: 'Offering temple care', benefit: 'A larger sanctuary: Clerics heal nearby residents and lift public spirits.' },
  trainingyard: { cls: 'fighter', label: 'Practising sword drills', benefit: 'Fighters train themselves and up to two nearby Fighters, Rangers or Rogues.' },
  rangerlodge: { cls: 'ranger', label: 'Studying woodland trails', benefit: 'Rangers practise fieldcraft and train up to two nearby adventurers.' },
  rogueguild: { cls: 'rogue', label: 'Practising locks and traps', benefit: 'Rogues train dexterity and help detect trouble: recent practice lowers local crime pressure.' },
};
export function installClassPlaces(sim) {
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    const sanctuaries = sim.s.buildings.filter(b => ['chapel', 'temple'].includes(b.type) && b.built && b.data?.careUntil > sim.s.time).length;
    sim.s.happiness = Math.min(100, sim.s.happiness + Math.min(3, sanctuaries) * 0.025);
  };
  const pressure = sim.crimePressure.bind(sim);
  sim.crimePressure = sid => Math.max(0, pressure(sid) - Math.min(8, sim.s.buildings.filter(b => b.type === 'rogueguild' && b.sid === sid && b.built && b.data?.careUntil > sim.s.time).length * 4));
  sim.taskClassPlace = (v, b) => {
    const info = CLASS_PLACES[b.type], c = sim.bCenter(b), p = sim.spot(b, v.id % 3);
    sim.setTask(v, info.label, [{ walk: sim.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] }, { act: 12, anim: 'work', done: () => {
      if (!sim.bById.has(b.id) || v.work !== b.id || v.jail > sim.s.time || v.quest || v.ko > 0 || v.downed) return;
      const nearby = sim.s.villagers.filter(o => o.home === b.sid && !o.quest && !(o.jail > sim.s.time) && !o.engage && !o.downed && Math.hypot(o.x - c.x, o.z - c.z) < 10);
      if (info.cls === 'cleric') {
        const patient = nearby.filter(o => o.hp < maxHp(o)).sort((a, z) => a.hp / maxHp(a) - z.hp / maxHp(z))[0];
        if (patient) patient.hp = Math.min(maxHp(patient), patient.hp + 2 + lvlOf(b));
      } else {
        sim.rpgGainXp(v, 1.5);
        for (const pupil of nearby.filter(o => o !== v && stageOf(o) === 'adult' && !(o.ko > 0) && ['fighter', 'ranger', 'rogue'].includes(classOf(o))).slice(0, 2)) sim.rpgGainXp(pupil, 0.5);
      }
      (b.data ||= {}).careUntil = sim.s.time + 30; b.data.sessions = (b.data.sessions || 0) + 1;
      b.status = null; sim.repeat(v);
    } }]);
  };
}
