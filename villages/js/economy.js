// Treasury-funded wages, household spending, local prices and home repayment.
import { GOODS, HOME_TYPES } from './data.js';
import { stageOf, defOf, lvlOf } from './sim.js';

export const LUXURIES = ['cloth', 'cheese', 'honey', 'ale'];
export const wealthOf = v => (v.purse || 0) < 4 ? 'Poor' : v.purse < 20 ? 'Modest' : v.purse < 60 ? 'Comfortable' : 'Wealthy';
export const mortgageCost = b => ({cottage:40,tiled:100,rowhouse:120,manor:300})[b.type] || 40;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function installEconomy(sim) {
  Object.assign(sim, ECON);
  const s = sim.s;
  s.economy ||= { prices: {}, demand: {}, wages: 0, taxes: 0, spending: 0, shortfall: 0, periods: 0 };
  const init = v => {
    if (Number.isFinite(v.purse)) return;
    const grant = stageOf(v) !== 'child' ? Math.min(8, Math.max(0, s.res.coins)) : 0;
    v.purse = grant; s.res.coins -= grant; sim.track('coins', -grant);
  };
  s.villagers.forEach(init);
  const spawn = sim.spawnVillager.bind(sim);
  sim.spawnVillager = (...a) => { const v = spawn(...a); init(v); return v; };
  const passing = sim.passAway.bind(sim);
  sim.passAway = v => {
    const heirs = [v.partner, ...(v.kids || [])].map(id => sim.vById.get(id)).filter(o => o && o !== v);
    const estate = Math.max(0, v.purse || 0); v.purse = 0;
    passing(v);
    const heir = heirs.find(o => sim.vById.has(o.id));
    if (heir) heir.purse = (heir.purse || 0) + estate;
    else { s.res.coins += estate; sim.track('coins', estate); }
  };
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    if ((sim.econT = (sim.econT || 0) + 1) % 20 === 0) sim.econSecond();
    s.happiness = clamp(s.happiness + (sim.comfortJoy || 0) * 0.05, 0, 100);
  };
}

const ECON = {
  priceOf(k, sid = 'meadow') {
    const base = GOODS[k]?.price || 1, e = this.s.economy;
    const supply = this.trade?.get(sid, k) ?? this.s.res[k] ?? 0;
    const localPop = this.s.villagers.filter(v => v.home === sid).length;
    const target = Math.max(8, (GOODS[k]?.reserve || 4) * 0.4, localPop * (k === 'food' ? 4 : 0.5));
    const wanted = e.demand[`${sid}:${k}`] || 0;
    const factor = clamp(1.25 - supply / target * 0.25 + wanted * 0.02, 0.6, 1.8);
    return Math.round(base * factor * (this.govEffects?.().sale || 1) * 100) / 100;
  },
  householdMembers(b) { return (b.fam || []).map(id => this.vById.get(id)).filter(v => v && stageOf(v) !== 'child'); },
  householdPay(members, cost) {
    if (!(cost >= 0) || members.reduce((sum, v) => sum + (v.purse || 0), 0) + 1e-8 < cost) return false;
    let left = cost;
    for (const v of members) { const n = Math.min(left, v.purse || 0); v.purse = Math.max(0, (v.purse || 0) - n); left -= n; }
    this.s.res.coins += cost; this.track('coins', cost); this.s.economy.spending += cost;
    return true;
  },
  econSecond() {
    const s = this.s, e = s.economy;
    e.wages = 0; e.taxes = 0; e.spending = 0; e.shortfall = 0; e.periods++;
    // Round-robin payment avoids permanently starving the last workers when funds run low.
    const adults = s.villagers.filter(v => stageOf(v) !== 'child');
    const shift = adults.length ? e.periods % adults.length : 0;
    const workers = [...adults.slice(shift), ...adults.slice(0, shift)];
    for (const v of workers) {
      const b = v.work && this.bById.get(v.work);
      const working = b?.built && !v.quest && !(v.jail > s.time) && !(v.ko > 0) && !v.asleep && v.job !== 'student'
        || v.job === 'idle' && /Building|Upgrading|Clearing/.test(v.task?.label || '');
      const gross = working ? Math.max(0.8, 1.6 * this.abilityWork(v) * (b ? 1 + (lvlOf(b) - 1) * 0.1 : 0.75)) : 0;
      const paid = Math.min(gross, Math.max(0, s.res.coins));
      const tax = paid * s.gov.tax, net = paid - tax;
      v.purse = (v.purse || 0) + net; v.wage = net;
      s.res.coins -= net; this.track('coins', -net); e.wages += paid; e.taxes += tax; e.shortfall += gross - paid;
      if (this.policyOn('poorRelief') && v.purse < 4) {
        const n = Math.min(2, 4 - v.purse, Math.max(0, s.res.coins));
        v.purse += n; s.res.coins -= n; this.track('coins', -n);
      }
    }
    for (const k of Object.keys(e.demand)) { e.demand[k] *= 0.8; if (e.demand[k] < 0.01) delete e.demand[k]; }
    this._beds = null; this.settleHomes();
    const households = s.buildings.filter(b => b.built && b.owner != null && HOME_TYPES.includes(b.type));
    for (const b of households) {
      const family = this.householdMembers(b);
      if (!family.length) continue;
      if ((b.paid || 0) < mortgageCost(b)) {
        const savings = family.reduce((sum, v) => sum + (v.purse || 0), 0);
        const payment = Math.min(1.5, mortgageCost(b) - (b.paid || 0), Math.max(0, savings - family.length * 4));
        if (payment > 0 && this.householdPay(family, payment)) {
          b.paid = (b.paid || 0) + payment;
          if (b.paid + 1e-8 >= mortgageCost(b)) { b.paid = mortgageCost(b); this.log(`${this.homeName(b)} is now owned outright.`); }
        }
      }
      const k = LUXURIES[(e.periods + b.id) % LUXURIES.length], key = `${b.sid}:${k}`;
      const price = this.priceOf(k, b.sid);
      const market = s.buildings.some(o => o.built && ['market', 'pub', 'tavern'].includes(o.type) && o.sid === b.sid);
      if (!market) continue;
      e.demand[key] = (e.demand[key] || 0) + 1;
      if (this.trade.get(b.sid, k) < 1 || family.reduce((sum, v) => sum + (v.purse || 0), 0) < price + family.length * 2) continue;
      if (this.householdPay(family, price)) {
        this.trade.consume(b.sid, k, 1); b.lastPurchase = { good: k, time: s.time };
        for (const v of family) v.comfortUntil = s.time + 60;
      }
    }
    const comfort = adults.filter(v => v.comfortUntil > s.time).length;
    this.comfortJoy = adults.length ? comfort / adults.length * 5 : 0;
    this.emit('res');
  },
};
