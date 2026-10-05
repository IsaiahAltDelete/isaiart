// Festival quests, festival tokens and the festival shop. Sim-side only.
//
// From the morning of a festival day until the end of the next day, the
// festival offers three themed quests. Each pays festival tokens, which buy that
// festival's seasonal decorations at its shop. A bought decoration goes into
// your pocket (s.tokens, like gift-chest treasures) and is placed for free from
// Decorate → Festive.
import { FESTIVALS, FESTIVE, DECOR, SEASON_DAYS } from './data.js';

// kinds: produce (stats.produced delta), stat (stats delta), placed (decorations placed of these types)
export const FEST_QUESTS = {
  fair: [
    { id: 'garden', title: 'Plant 3 flower beds', kind: 'placed', keys: ['flowers'], n: 3, tokens: 3, icon: 'flower' },
    { id: 'berries', title: 'Gather 60 food for the fair', kind: 'produce', key: 'food', n: 60, tokens: 3, icon: 'apple' },
    { id: 'dance', title: 'Dance at the Flower Fair', kind: 'stat', key: 'festivals', n: 1, tokens: 4, icon: 'party' },
  ],
  bonfire: [
    { id: 'logs', title: 'Fell 20 trees for the bonfire', kind: 'stat', key: 'felled', n: 20, tokens: 3, icon: 'axe' },
    { id: 'roads', title: 'Lay 12 road tiles for the visitors', kind: 'stat', key: 'roads', n: 12, tokens: 3, icon: 'stone' },
    { id: 'dance', title: 'Dance round the Midsummer Bonfire', kind: 'stat', key: 'festivals', n: 1, tokens: 4, icon: 'party' },
  ],
  harvest: [
    { id: 'grain', title: 'Bring in 60 grain', kind: 'produce', key: 'grain', n: 60, tokens: 3, icon: 'wheat' },
    { id: 'visits', title: 'Visit friends 3 times', kind: 'stat', key: 'visits', n: 3, tokens: 3, icon: 'heart' },
    { id: 'dance', title: 'Feast at the Harvest Festival', kind: 'stat', key: 'festivals', n: 1, tokens: 4, icon: 'party' },
  ],
  lantern: [
    { id: 'lights', title: 'Put up 3 lanterns or torches', kind: 'placed', keys: ['lantern', 'torch'], n: 3, tokens: 3, icon: 'lantern' },
    { id: 'wood', title: 'Stack 150 wood for the winter', kind: 'produce', key: 'wood', n: 150, tokens: 3, icon: 'wood' },
    { id: 'dance', title: 'Light a lantern on Lantern Night', kind: 'stat', key: 'festivals', n: 1, tokens: 4, icon: 'party' },
  ],
};
const festOfSeason = si => FESTIVALS[['spring', 'summer', 'autumn', 'winter'][si]];

function statNow(s, q) {
  const st = s.stats;
  if (q.kind === 'produce') return st.produced?.[q.key] || 0;
  if (q.kind === 'placed') return q.keys.reduce((a, k) => a + (st.placed?.[k] || 0), 0);
  return st[q.key] || 0;
}

export function installFestival(sim) {
  // sim.s is replaced when a save loads or a share code is imported, so re-read it at every entry point
  let s = sim.s;
  const cur = () => { s = sim.s; s.ftokens ||= 0; };
  cur();
  // the festival whose quests and shop are open right now (festival day + the day after)
  function open() {
    const day = sim.dayNum(), sd = sim.seasonDay(), f = sim.dayFrac();
    if (sd === 1 && f >= 0.2) return { fest: festOfSeason(sim.seasonIdx()), day };
    if (sd === 2) return { fest: festOfSeason(sim.seasonIdx()), day: day - 1 };
    return null;
  }
  function refresh() {
    cur();
    const o = open();
    if (s.fq && (!o || s.fq.day !== o.day || s.fq.fest !== o.fest.id)) {
      // closing: completed quests pay out by themselves
      for (const q of quests()) if (q.done && !q.claimed) claim(q.id, true);
      s.fq = null;
    }
    if (o && !s.fq && SEASON_DAYS > 1) {
      const list = FEST_QUESTS[o.fest.id] || [];
      s.fq = { fest: o.fest.id, day: o.day, base: Object.fromEntries(list.map(q => [q.id, statNow(s, q)])), claimed: [] };
      sim.log(`The ${o.fest.name} has begun! Festival quests and the festival shop are open until tomorrow night.`);
      sim.emit('toast', `${o.fest.name}: festival quests and the festival shop are open!`, 'party');
      sim.emit('festShop', true);
    }
  }
  function quests() {
    cur();
    if (!s.fq) return [];
    return (FEST_QUESTS[s.fq.fest] || []).map(q => {
      const p = Math.max(0, statNow(s, q) - (s.fq.base[q.id] ?? 0));
      return { ...q, p: Math.min(q.n, p), done: p >= q.n, claimed: s.fq.claimed.includes(q.id) };
    });
  }
  function claim(id, auto = false) {
    cur();
    const q = quests().find(o => o.id === id);
    if (!q || !q.done || q.claimed) return false;
    s.fq.claimed.push(id);
    s.ftokens += q.tokens;
    s.stats.festquests = (s.stats.festquests || 0) + 1;
    sim.addXp(20);
    sim.log(`Festival quest done: ${q.title}. +${q.tokens} festival tokens${auto ? ' (claimed for you)' : ''}.`);
    sim.emit('res'); sim.emit('sfx', 'coin');
    return true;
  }
  function buy(type) {
    cur();
    const d = DECOR[type];
    if (!d?.festive || !s.fq || d.festive !== s.fq.fest) return { ok: false, why: 'Not sold at this festival' };
    if (s.ftokens < d.price) return { ok: false, why: `Needs ${d.price} tokens` };
    s.ftokens -= d.price;
    s.tokens[type] = (s.tokens[type] || 0) + 1;
    sim.log(`Bought a ${d.name} at the festival shop.`);
    sim.emit('sfx', 'coin'); sim.emit('res');
    return { ok: true };
  }
  const second = sim.second;
  sim.second = () => { second(); refresh(); };
  refresh();
  // open() re-checks the calendar so a paused game or a time jump never shows a past festival
  sim.festShop = { open: () => { refresh(); return !!s.fq; }, current: () => (cur(), s.fq) ? Object.values(FESTIVALS).find(f => f.id === s.fq.fest) : null, quests, claim, buy,
    stock: () => (cur(), s.fq) ? FESTIVE[s.fq.fest] || [] : [], tokens: () => (cur(), s.ftokens) };
}
