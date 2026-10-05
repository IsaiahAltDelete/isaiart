// Government: one choice with three plain perks, a leader you can see in the
// village (a chain of office, a crown, the archmage's hat), a tax rate and three
// policies. The Council of Elders runs things until a Town Hall is built.
import { stageOf, DAY } from './sim.js';
import { SEASON_DAYS } from './data.js';
import { mod } from './rpg.js';

// effects: work/study/sale/tax are multipliers, joy shifts happiness, safety makes crime rarer
export const GOVERNMENTS = {
  elders: { name: 'Council of Elders', title: 'Elder', icon: 'leaf',
    desc: 'The oldest grown-up chairs the council.',
    perks: ['+5% work speed', '+2 happiness', 'A little safer at night'],
    fx: { work: 1.05, joy: 2, safety: 1 } },
  mayor: { name: 'Elected Mayor', title: 'Mayor', icon: 'star',
    desc: 'Every season the village votes for its most popular grown-up.',
    perks: ['+6 happiness', '+10% taxes', 'A new vote each season'],
    fx: { joy: 6, tax: 1.1 } },
  monarchy: { name: 'Monarchy', title: 'Monarch', icon: 'shield',
    desc: 'A monarch rules for life, and a grown child inherits the crown.',
    perks: ['+30% taxes', 'Much safer at night', '−3 happiness'],
    fx: { tax: 1.3, safety: 3, joy: -3 } },
  magocracy: { name: 'Magocracy', title: 'High Archmage', icon: 'staff', needs: 'an Archmage',
    desc: 'The most accomplished Archmage leads the village.',
    perks: ['+25% study and magic', '+5% work speed', 'Needs an Archmage'],
    fx: { study: 1.25, work: 1.05 } },
  republic: { name: 'Merchant Republic', title: 'Consul', icon: 'coin',
    desc: 'The most prosperous, persuasive citizen is chosen each season.',
    perks: ['+20% market prices', '+10% taxes', 'A new consul each season'],
    fx: { sale: 1.2, tax: 1.1 } },
};
// each policy costs 1 coin per pay period (20 s) for every 4 villagers
export const POLICIES = {
  nightWatch: { name: 'Night watch', icon: 'lantern', desc: 'Lantern patrols at night: thieves are caught far more often.' },
  feasts: { name: 'Public feasts', icon: 'apple', desc: '+6 happiness. Also uses a little food from the store.' },
  freeSchool: { name: 'Free school meals', icon: 'cap', desc: 'Children and students learn 15% faster.' },
};
const TYPES = Object.keys(GOVERNMENTS);

export function installGovernment(sim) {
  Object.assign(sim, GOV);
  const s = sim.s;
  s.gov ||= { type: 'elders', leader: null, tax: 0.1, policies: {}, season: -1 };
  const g = s.gov;
  if (!TYPES.includes(g.type)) g.type = 'elders';
  g.tax = Number.isFinite(g.tax) ? Math.max(0, Math.min(0.3, g.tax)) : 0.1;
  g.policies ||= {}; g.active ||= {};
  for (const o of [g.policies, g.active]) for (const k of Object.keys(o)) if (!POLICIES[k]) delete o[k];   // curfew, poor relief: retired
  delete g.justice;
  if (!sim.govLeader() || g.type === 'magocracy') sim.electLeader(true);
  const ability = sim.abilityWork.bind(sim);
  sim.abilityWork = v => {
    const fx = sim.govEffects();
    return ability(v) * fx.work * (['wizard', 'student', 'professor', 'scholar'].includes(v.job) ? fx.study : 1);
  };
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    const season = Math.floor(s.time / (DAY * SEASON_DAYS));
    if (g.season !== season) { g.season = season; sim.electLeader(); }
    if (g.leader != null && !sim.vById.has(g.leader) || g.type === 'magocracy' && sim.highArchmage()?.id !== g.leader) sim.electLeader();
    const joy = sim.govEffects().joy + (sim.policyOn('feasts') ? 6 : 0) - (sim.townHall() ? Math.max(0, g.tax - 0.1) * 30 : 0);
    s.happiness = Math.max(0, Math.min(100, s.happiness + joy * 0.05));
    if ((sim.govT = (sim.govT || 0) + 1) % 20 === 0) sim.fundPolicies();
  };
}

const GOV = {
  govInfo() { return GOVERNMENTS[this.s.gov.type]; },
  townHall() { return this.s.buildings.find(b => b.type === 'townhall' && b.built); },
  govLeader() { return this.vById.get(this.s.gov.leader) || null; },
  policyCost() { return Math.max(1, Math.ceil(this.s.villagers.length / 4)); },
  policyOn(k) { const g = this.s.gov; return !!(this.townHall() && g.policies[k] && g.active[k]); },
  setGovernment(type, leader) {
    if (!TYPES.includes(type) || !this.townHall()) return false;
    if (type === 'magocracy' && !this.highArchmage()) return false;
    if (leader != null && (!this.vById.has(leader) || stageOf(this.vById.get(leader)) === 'child')) return false;
    const g = this.s.gov; g.type = type; g.leader = type === 'monarchy' ? leader ?? null : null;
    this.electLeader(true); this.socSecond?.();
    this.log(`The village adopted ${this.govInfo().name}.`); return true;
  },
  setTax(value) { if (!this.townHall() || !Number.isFinite(+value)) return false; this.s.gov.tax = Math.max(0, Math.min(0.3, +value)); return true; },
  setPolicy(k, on) {
    if (!this.townHall() || !POLICIES[k]) return false;
    const g = this.s.gov; g.policies[k] = !!on;
    g.active[k] = !!on && this.s.res.coins >= this.policyCost();   // takes effect at once; paid each period
    return true;
  },
  electLeader(quiet = false) {
    const g = this.s.gov, old = this.govLeader();
    const adults = this.s.villagers.filter(v => stageOf(v) !== 'child' && !v.quest);
    if (g.type === 'monarchy' && old) return;
    let winner;
    if (g.type === 'magocracy') winner = this.highArchmage();
    else if (g.type === 'monarchy' && g.leader != null) winner = adults.find(v => v.parents?.includes(g.leader));
    const score = v => g.type === 'elders' ? v.age * 10 + (v.abil?.wis || 10)
      : g.type === 'republic' ? (this.homeOf?.(v)?.pros || 0) * 3 + (v.abil?.cha || 10) + (v.abil?.int || 10)
      : (v.abil?.cha || 10) * 2 + (v.abil?.wis || 10) + (this.friendsOf?.(v).length || 0) * 1.5;
    if (!winner && g.type !== 'magocracy') winner = [...adults].sort((a, b) => score(b) - score(a) || a.id - b.id)[0];
    const before = g.leader; g.leader = winner?.id ?? null;
    if (!quiet && winner && (g.type === 'mayor' || g.type === 'republic' || before !== g.leader)) {
      this.log(`${winner.name} became ${this.govInfo().title} of ${this.sname('meadow')}.`);
      this.story('leader', `${winner.name} is now ${this.govInfo().title} of ${this.sname('meadow')}.`, [winner], 'star');
    }
  },
  // the government's perks, plus a nudge from the leader's best traits
  govEffects() {
    const e = { work: 1, study: 1, sale: 1, tax: 1, joy: 0, safety: 0 };
    if (!this.townHall() && this.s.gov.type !== 'elders') return e;
    Object.assign(e, GOVERNMENTS[this.s.gov.type].fx);
    const v = this.govLeader();
    if (v) { e.joy += Math.max(0, mod(v.abil?.cha)) * 0.5; e.work *= 1 + Math.max(0, mod(v.abil?.wis)) * 0.01; }
    return e;
  },
  fundPolicies() {
    const g = this.s.gov, hall = this.townHall(), cost = this.policyCost();
    for (const k of Object.keys(POLICIES)) {
      g.active[k] = false;
      if (!g.policies[k] || !hall || this.s.res.coins < cost) continue;
      if (k === 'feasts') { const food = Math.ceil(this.s.villagers.length / 8); if (!this.trade.consume(hall.sid, 'food', food)) continue; }
      this.s.res.coins -= cost; this.track('coins', -cost); g.active[k] = true;
    }
    this.emit('res');
  },
};
