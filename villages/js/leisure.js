// Evening outings and staffed venues. Payments and fuel use the local store.
import { stageOf, lvlOf } from './sim.js';

export const VENUES = {
  park: { fee: 0, joy: 4, label: 'Strolling in the park', allAges: true },
  pub: { fee: 1.5, joy: 7, label: 'Enjoying a pint', job: 'barkeep' },
  bathhouse: { fee: 2, joy: 8, label: 'Taking a warm bath', job: 'attendant', allAges: true },
  theatre: { fee: 2.5, joy: 9, label: 'Watching a play', job: 'bard', allAges: true },
};
const SERVICE_JOBS = ['barkeep', 'attendant', 'bard'];
const NO_OUTING_JOBS = ['guard', 'constable', 'student', ...SERVICE_JOBS];

export function installLeisure(sim) {
  Object.assign(sim, LEISURE);
  const s = sim.s;
  const think = sim.think.bind(sim);
  sim.think = v => {
    const f = sim.dayFrac();
    if (f >= 0.72 && f < 0.88 && !v.carry && !v.quest && !v.downed && !(v.ko > 0) && !(v.jail > s.time)
      && !NO_OUTING_JOBS.includes(v.job) && !sim.sleepy(v) && !sim.stormy() && !sim.festivalActive()
      && v.lastOuting !== sim.dayNum() && sim.rng() < 0.25) {
      const venues = s.buildings.filter(b => sim.venueOpen(b) && b.sid === v.home && (VENUES[b.type].allAges || stageOf(v) !== 'child')
        && (v.purse || 0) >= sim.venueFee(b, v));
      if (venues.length) {
        const b = venues[Math.floor(sim.rng() * venues.length)];
        v.lastOuting = sim.dayNum(); sim.taskOuting(v, b); return;
      }
    }
    return think(v);
  };
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    const visitors = s.villagers.filter(v => v.outingUntil > s.time).length;
    sim.leisureJoy = Math.min(12, s.villagers.length ? visitors / s.villagers.length * 14 : 0);
    s.happiness = Math.min(100, s.happiness + sim.leisureJoy * 0.05);
  };
  const breaks = sim.mustBreak.bind(sim);
  sim.mustBreak = v => breaks(v) || sim.dayFrac() >= 0.72 && sim.dayFrac() < 0.88 && v.lastOuting !== sim.dayNum()
    && !NO_OUTING_JOBS.includes(v.job) && !v.carry && !sim.festivalActive();
}

const LEISURE = {
  venueFee(b, visitor) {
    const info = VENUES[b.type];
    return visitor && stageOf(visitor) === 'child' && info?.allAges ? 0 : info?.fee || 0;
  },
  venueOpen(b) {
    if (!b.built || !VENUES[b.type]) return false;
    if (b.type === 'park') return true;
    const staffed = b.workers.some(id => {
      const v = this.vById.get(id);
      return v && v.work === b.id && v.job === VENUES[b.type].job && !v.quest && !(v.ko > 0) && !(v.jail > this.s.time) && !v.asleep
        && !Object.values(VENUES).some(info => info.label === v.task?.label);
    });
    if (!staffed) return false;
    return b.type === 'pub' ? this.trade.get(b.sid, 'ale') >= 1 : b.type === 'bathhouse' ? b.data?.warmUntil > this.s.time : true;
  },
  taskVenue(v, b) {
    const p = this.spot(b, v.id % 3), c = this.bCenter(b);
    this.setTask(v, { barkeep: 'Serving pints', attendant: 'Heating the baths', bard: 'Rehearsing a play' }[v.job], [
      { walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] },
      { act: 10, anim: 'sell', done: () => {
        if (!this.bById.has(b.id) || v.work !== b.id) return;
        if (v.job === 'attendant') {
          if (this.trade.consume(b.sid, 'wood', 1)) { (b.data ||= {}).warmUntil = this.s.time + 35; b.status = null; this.credit(b, 'wood', -1); }
          else b.status = 'Needs wood for hot water';
        } else b.status = v.job === 'barkeep' && this.trade.get(b.sid, 'ale') < 1 ? 'Needs ale' : null;
        this.repeat(v);
      } },
    ]);
  },
  taskOuting(v, b) {
    const info = VENUES[b.type], p = this.spot(b, v.id % 4), c = this.bCenter(b);
    let admitted = false;
    this.setTask(v, info.label, [
      { walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] },
      { act: 9, anim: 'rest', start: () => {
        v.act.idle = true;
        const fee = this.venueFee(b, v);
        if (!this.bById.has(b.id) || !this.venueOpen(b) || (!info.allAges && stageOf(v) === 'child') || (v.purse || 0) < fee) return;
        if (b.type === 'pub' && !this.trade.consume(b.sid, 'ale', 1)) return;
        v.purse = Math.max(0, (v.purse || 0) - fee); this.s.res.coins += fee; this.track('coins', fee);
        if (b.type === 'pub') this.credit(b, 'ale', -1);
        this.credit(b, 'coins', fee); (b.data ||= {}).visits = (b.data.visits || 0) + 1;
        admitted = true; this.emit('res');
      }, done: () => {
        if (!admitted || !this.bById.has(b.id)) return;
        v.outingUntil = this.s.time + info.joy * 12 * (1 + (lvlOf(b) - 1) * 0.1);
        v.lastVenue = b.type;
        this.s.stats.outings = (this.s.stats.outings || 0) + 1;
      } },
    ]);
  },
};
