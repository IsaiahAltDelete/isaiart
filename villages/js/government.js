// Government, seasonal elections and funded policies. No browser dependencies.
import { stageOf, DAY } from './sim.js';
import { SEASON_DAYS } from './data.js';
import { mod } from './rpg.js';

export const GOVERNMENTS = {
  elders: { name: 'Council of Elders', title: 'Elder', desc: 'The oldest grown-up chairs the council. Wisdom improves work and public trust.' },
  mayor: { name: 'Elected Mayor', title: 'Mayor', desc: 'A seasonal election chooses a persuasive, well-liked mayor. Charisma raises cheer.' },
  monarchy: { name: 'Monarchy', title: 'Monarch', desc: 'Choose a monarch for life. A grown-up child inherits when possible; strength supports the watch.' },
  magocracy: { name: 'Magocracy', title: 'High Archmage', desc: 'The High Archmage leads. Intelligence speeds study and arcane work.' },
  republic: { name: 'Merchant Republic', title: 'Consul', desc: 'Prosperous, persuasive citizens compete each season. The consul improves sale prices.' },
};
export const POLICIES = {
  nightWatch: { name: 'Night watch', cost: 2, desc: 'Extra patrols lower crime pressure by 12.' },
  curfew: { name: 'Curfew', cost: 0, desc: 'Everyone except guards and constables heads home at 20:00. Less crime, fewer evening visits.' },
  feasts: { name: 'Public feasts', cost: 2, desc: 'Spend coins and surplus food every pay period for +6 happiness.' },
  freeSchool: { name: 'Free schooling', cost: 1, desc: '+15% teaching quality and no university tuition.' },
  poorRelief: { name: 'Poor relief', cost: 0, desc: 'Give up to 2 coins per pay period to grown-ups carrying fewer than 4 coins.' },
};
const TYPES = Object.keys(GOVERNMENTS);

export function installGovernment(sim) {
  Object.assign(sim, GOV);
  const s = sim.s;
  s.gov ||= { type: 'elders', leader: null, tax: 0.1, policies: {}, justice: 'lenient', season: -1 };
  const g = s.gov;
  if (!TYPES.includes(g.type)) g.type = 'elders';
  g.tax = Number.isFinite(g.tax) ? Math.max(0, Math.min(0.4, g.tax)) : 0.1;
  g.policies ||= {}; g.active ||= {}; g.justice = g.justice === 'strict' ? 'strict' : 'lenient';
  if (!sim.govLeader() || g.type === 'magocracy') sim.electLeader(true);
  const ability = sim.abilityWork.bind(sim);
  sim.abilityWork = v => ability(v) * sim.govEffects().work * (['wizard', 'student', 'professor', 'scholar'].includes(v.job) ? sim.govEffects().study : 1);
  const sleepy = sim.sleepy.bind(sim);
  sim.sleepy = v => {
    if (v.job === 'constable' && sim.policyOn('nightWatch') && sim.isNight()) return false;
    return sim.policyOn('curfew') && sim.dayFrac() >= 20 / 24 && !['guard', 'constable'].includes(v.job) || sleepy(v);
  };
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    const season = Math.floor(s.time / (DAY * SEASON_DAYS));
    if (g.season !== season) { g.season = season; sim.electLeader(); }
    if (g.leader != null && !sim.vById.has(g.leader) || g.type === 'magocracy' && sim.highArchmage()?.id !== g.leader) sim.electLeader();
    const joy = sim.govEffects().joy + (sim.policyOn('feasts') ? 6 : 0) - g.tax * 10;
    s.happiness = Math.max(0, Math.min(100, s.happiness + joy * 0.05));
    if ((sim.govT = (sim.govT || 0) + 1) % 20 === 0) sim.fundPolicies();
  };
}

const GOV = {
  govInfo() { return GOVERNMENTS[this.s.gov.type]; },
  townHall() { return this.s.buildings.find(b => b.type === 'townhall' && b.built); },
  govLeader() { return this.vById.get(this.s.gov.leader) || null; },
  policyOn(k) { const g = this.s.gov; return !!(this.townHall() && g.policies[k] && (POLICIES[k]?.cost ? g.active[k] : true)); },
  setGovernment(type, leader) {
    if (!TYPES.includes(type) || !this.townHall()) return false;
    if (type === 'magocracy' && !this.highArchmage()) return false;
    if (leader != null && (!this.vById.has(leader) || stageOf(this.vById.get(leader)) === 'child')) return false;
    const g = this.s.gov; g.type = type; g.leader = type === 'monarchy' ? leader ?? g.leader : null;
    this.electLeader(true); this.socSecond();
    this.log(`The village adopted ${this.govInfo().name}.`); return true;
  },
  setTax(value) { if (!this.townHall() || !Number.isFinite(+value)) return false; this.s.gov.tax = Math.max(0, Math.min(0.4, +value)); return true; },
  setPolicy(k, on) {
    if (!this.townHall() || !POLICIES[k]) return false;
    const g = this.s.gov; g.policies[k] = !!on; if (!on) g.active[k] = false;
    return true;
  },
  electLeader(quiet = false) {
    const g = this.s.gov, old = this.govLeader();
    const adults = this.s.villagers.filter(v => stageOf(v) !== 'child' && !(v.jail > this.s.time));
    if (g.type === 'monarchy' && old) return;
    let winner;
    if (g.type === 'magocracy') winner = this.highArchmage();
    else if (g.type === 'monarchy') {
      winner = adults.find(v => v.parents?.includes(g.leader));
    }
    const score = v => g.type === 'elders' ? v.age * 10 + (v.abil?.wis || 10)
      : g.type === 'republic' ? (v.purse || 0) * 0.15 + (v.abil?.cha || 10) + (v.abil?.int || 10)
      : (v.abil?.cha || 10) * 2 + (v.abil?.wis || 10) + (this.friendsOf?.(v).length || 0) * 1.5;
    if (!winner && g.type !== 'magocracy') winner = [...adults].sort((a, b) => score(b) - score(a) || a.id - b.id)[0];
    const before = g.leader; g.leader = winner?.id ?? null;
    if (!quiet && winner && (g.type === 'mayor' || g.type === 'republic' || before !== g.leader)) {
      this.log(`${winner.name} became ${this.govInfo().title} of ${this.sname('meadow')}.`);
      this.emit('toast', `${winner.name.split(' ')[0]} is now ${this.govInfo().title}!`, 'star');
    }
  },
  govEffects() {
    const v = this.govLeader(), g = this.s.gov, e = { work: 1, study: 1, sale: 1, joy: 0, security: 0 };
    if (!v || !this.townHall()) return e;
    const positive = a => Math.max(0, mod(v.abil?.[a]));
    if (g.type === 'elders') { e.work += positive('wis') * 0.02; e.security = positive('wis'); }
    if (g.type === 'mayor') e.joy = 2 + positive('cha');
    if (g.type === 'monarchy') { e.security = 3 + positive('str') * 2; e.work += positive('con') * 0.015; }
    if (g.type === 'magocracy') e.study += 0.05 + positive('int') * 0.03;
    if (g.type === 'republic') e.sale += 0.05 + positive('cha') * 0.025;
    return e;
  },
  fundPolicies() {
    const g = this.s.gov, hall = this.townHall();
    for (const [k, p] of Object.entries(POLICIES)) {
      g.active[k] = false;
      if (!g.policies[k] || !hall) continue;
      const food = k === 'feasts' ? Math.max(1, Math.ceil(this.s.villagers.length / 8)) : 0;
      if (this.s.res.coins < p.cost || food && this.trade.get(hall.sid, 'food') < food + this.s.villagers.length * 3) continue;
      if (food && !this.trade.consume(hall.sid, 'food', food)) continue;
      this.s.res.coins -= p.cost; this.track('coins', -p.cost); g.active[k] = true;
    }
  },
};
