// Wizard towers choose what their wizards practise: Research (spells and wizard
// levels, the default) or Nature (walk out and coax nearby crops along).
// Towers saved in the retired Warding/Artifice modes simply do Research.
import { careerReady } from './careers.js';
export const TOWER_MODES = {
  research: { name: 'Research', icon: 'book', color: 0xa87ada, desc: 'Study spell lore and wizard levels.' },
  nature: { name: 'Nature', icon: 'leaf', color: 0x76b95c, desc: 'Tend growing fields within 10 tiles: each session ripens up to three of them by 10%, using 1 local food.' },
};
export const towerMode = b => TOWER_MODES[b.data?.discipline] ? b.data.discipline : 'research';
export function installArcane(sim) {
  const name = sim.homeName.bind(sim);
  sim.homeName = (b, ...args) => b.type === 'wizard' ? `${TOWER_MODES[towerMode(b)].name} Tower` : name(b, ...args);
  sim.setTowerMode = (b, mode) => {
    if (b?.type !== 'wizard' || !b.built || !TOWER_MODES[mode]) return false;
    (b.data ||= {}).discipline = mode;
    for (const id of b.workers) { const v = sim.vById.get(id); if (v) sim.dropTask(v); }
    b.status = null; sim.emit('building', b); return true;
  };
  sim.towerFields = b => {
    const c = sim.bCenter(b);
    return sim.s.buildings.filter(o => o.type === 'farm' && o.sid === b.sid && o.built && o.data.stage === 'growing' && Math.hypot(sim.bCenter(o).x - c.x, sim.bCenter(o).z - c.z) <= 10);
  };
  // one Nature session
  sim.tendFields = (b, v) => {
    if (!b || !sim.bById.has(b.id) || !b.built || b.up || !v || v.work !== b.id || !careerReady(sim, v) || v.asleep) return false;
    const fields = sim.towerFields(b);
    if (!fields.length) { b.status = 'No nearby growing fields'; return false; }
    if (!sim.trade.consume(b.sid, 'food', 1)) { b.status = 'Needs 1 local food'; return false; }
    for (const o of fields.slice(0, 3)) { o.data.grow = Math.min(1, o.data.grow + 0.1); if (o.data.grow >= 1) o.data.stage = 'ripe'; sim.emit('farm', o); }
    sim.rpgGainXp(v, 2); (b.data ||= {}).sessions = (b.data.sessions || 0) + 1; b.status = null; return true;
  };
  const study = sim.taskStudy.bind(sim);
  sim.taskStudy = (v, b) => {
    if (towerMode(b) === 'research') {
      study(v, b);
      const act = v.task.steps.find(s => s.act), done = act.done;
      act.done = () => { if (!sim.bById.has(b.id) || b.up || v.work !== b.id || !careerReady(sim, v) || v.asleep || towerMode(b) !== 'research') return; done(); (b.data ||= {}).sessions = (b.data.sessions || 0) + 1; };
      return;
    }
    const c = sim.bCenter(b), field = sim.towerFields(b)[0], target = field || b, p = field ? sim.spot(field, 0) : sim.spot(b, v.id % 3);
    sim.setTask(v, 'Tending the fields with magic', [{ walk: sim.goalBuilding(target) }, { to: [p.x, p.z] }, { face: [c.x, c.z] }, { act: 16, anim: 'cast', done: () => {
      if (towerMode(b) !== 'nature') return;
      sim.tendFields(b, v); sim.repeat(v);
    } }]);
  };
}
