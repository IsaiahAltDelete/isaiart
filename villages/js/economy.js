// Household prosperity and taxes. Deliberately simple: there are no personal
// purses, wages or mortgages. Each home is one of four steps:
//   Struggling   someone living here is hungry
//   Getting by   everyone is fed
//   Comfortable  fed, enjoyed a luxury lately, and has a park, pub, bath or
//                theatre nearby (or enjoys three or more luxuries)
//   Prosperous   fed, three or more luxuries lately, and a place to unwind
// Every 20 seconds each household buys one luxury (cloth, cheese, honey or ale)
// from its own settlement's store, if a Market Stall, Pub or Tavern sells it.
// With a Town Hall, homes pay tax that grows with their prosperity. Prosperous
// homes show it in the village: flower boxes, then a lantern by the door.
import { GOODS, HOME_TYPES, LODGING_TYPES } from './data.js';
import { stageOf } from './sim.js';

export const LUXURIES = ['cloth', 'cheese', 'honey', 'ale'];
export const PROSPERITY = [
  { name: 'Struggling', desc: 'Someone here is hungry.' },
  { name: 'Getting by', desc: 'Everyone is fed.' },
  { name: 'Comfortable', desc: 'Fed, a luxury now and then, and somewhere nice to go.' },
  { name: 'Prosperous', desc: 'Fed, plenty of luxuries, and somewhere nice to go.' },
];
const SHOPS = ['market', 'pub', 'tavern'];
const VENUE_TYPES = ['park', 'pub', 'bathhouse', 'theatre', 'tavern'];
const PERIOD = 20, LUX_MEMORY = 120;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function installEconomy(sim) {
  Object.assign(sim, ECON);
  const s = sim.s;
  // saves from the purse economy: savings return to the treasury once
  if (!s.economy?.v2) {
    let back = 0;
    for (const v of s.villagers) { back += Math.max(0, v.purse || 0); delete v.purse; delete v.wage; delete v.comfortUntil; }
    for (const b of s.buildings) delete b.paid;
    if (back > 0) { s.res.coins += Math.floor(back); sim.track('coins', Math.floor(back)); }
    s.economy = { v2: 1, income: 0, periods: 0 };
  }
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    if ((sim.econT = (sim.econT || 0) + 1) % PERIOD === 0) sim.econSecond();
    s.happiness = clamp(s.happiness + (sim.prosperJoy || 0) * 0.05, 0, 100);
  };
  sim.econSecond();
}

const ECON = {
  // market sale price: fixed, with the government's trade bonus
  priceOf(k) { return Math.round((GOODS[k]?.price || 1) * (this.govEffects?.().sale || 1) * 100) / 100; },
  lodgings() { return this.s.buildings.filter(b => b.built && (HOME_TYPES.includes(b.type) || LODGING_TYPES.includes(b.type))); },
  // what a home has going for it right now (used by the panel checklist too)
  prosperityParts(b) {
    const s = this.s, res = this.homeResidents(b), lux = LUXURIES.filter(k => (b.luxT?.[k] || -1e9) > s.time - LUX_MEMORY);
    const c = this.bCenter(b);
    const unwind = s.buildings.some(o => o.built && o.sid === b.sid && VENUE_TYPES.includes(o.type) && Math.hypot(this.bCenter(o).x - c.x, this.bCenter(o).z - c.z) <= 14);
    const shop = s.buildings.some(o => o.built && o.sid === b.sid && SHOPS.includes(o.type));
    return { fed: res.length > 0 && !res.some(v => v.hungry), lux, unwind, shop, people: res.length };
  },
  prosperityOf(b) {
    const p = this.prosperityParts(b);
    if (!p.fed) return 0;
    if (p.lux.length >= 3 && p.unwind) return 3;
    if (p.lux.length >= 1 && (p.unwind || p.lux.length >= 3)) return 2;
    return 1;
  },
  econSecond() {
    const s = this.s, e = s.economy, hall = this.townHall?.(), tax = hall ? s.gov.tax : 0;
    e.periods++; e.income = 0;
    let total = 0, n = 0;
    for (const b of this.lodgings()) {
      const p = this.prosperityParts(b);
      if (!p.people) { this.setProsperity(b, 0, true); continue; }
      // the household picks up one luxury from the local shops
      if (p.shop) {
        const order = LUXURIES.map((_, i) => LUXURIES[(e.periods + b.id + i) % LUXURIES.length]);
        const k = order.find(g => this.trade.get(b.sid, g) >= 1);
        if (k && this.trade.consume(b.sid, k, 1)) (b.luxT ||= {})[k] = s.time;
      }
      const lvl = this.prosperityOf(b);
      this.setProsperity(b, lvl);
      total += lvl; n++;
      if (tax > 0) e.income += tax * 10 * (1 + lvl) * (this.govEffects?.().tax || 1);
    }
    if (e.income > 0) { const c = Math.round(e.income); s.res.coins += c; this.track('coins', c); e.income = c; this.emit('res'); }
    e.avg = n ? total / n : 0;
    this.prosperJoy = n ? (e.avg - 1) * 3 : 0;
  },
  setProsperity(b, lvl, empty = false) {
    if (b.pros === lvl && !!b.prosEmpty === empty) return;
    b.pros = lvl; b.prosEmpty = empty;
    this.emit('prosperity', b);
  },
  // the village at a glance: how many homes sit at each step
  prosperityCounts(sid = null) {
    const out = [0, 0, 0, 0];
    for (const b of this.lodgings()) if (!b.prosEmpty && (!sid || b.sid === sid)) out[b.pros || 0]++;
    return out;
  },
};
