// Celebrations: weddings, the town's rank, and the yearly chronicle.
//
// Weddings: when two villagers fall in love, they marry the next evening at their
// campfire. Family and friends gather round and dance; the couple stand in the middle
// with hearts over their heads; petals fall (lifeview.js). Everyone there grows a
// little closer, and the village is happier for half a day.
// Rank: Hamlet → Village → Town → City. Each rank is a short list of goals (people,
// comfortable homes, a market, a festival, wishes granted...). Meet them all and the
// village is promoted: fireworks, gems, a happier village and a bigger crest banner.
// Chronicle: every twelve days (a year) the Story and the stats are bound into a
// one-page chronicle, kept in the Journal.
import { stageOf, DAY } from './sim.js';
import { idx, toTile, inMap } from './world.js';
import { addIcons } from './icons.js';

addIcons({
  rings: '<circle cx="12" cy="18" r="7" fill="none" stroke="#e0a82e" stroke-width="3"/><circle cx="20" cy="18" r="7" fill="none" stroke="#f3c64f" stroke-width="3"/><path d="M17 6l3 4-3 3-3-3z" fill="#9fe3ff" stroke="#3a7aa0" stroke-width="1.2"/>',
  crest: '<path d="M7 4h18v13c0 6-5 9-9 11-4-2-9-5-9-11z" fill="#c8453a" stroke="#5b3a1e" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 9l2 4 4 .6-3 2.9.7 4.1-3.7-2-3.7 2 .7-4.1-3-2.9 4-.6z" fill="#ffd54f"/>',
  scroll: '<path d="M8 6h16v20H8z" fill="#f5e6c4" stroke="#8a5a2b" stroke-width="1.6"/><path d="M6 6a2 2 0 0 1 4 0v3H6zM22 26a2 2 0 0 0 4 0v-3h-4z" fill="#e2c88f" stroke="#8a5a2b" stroke-width="1.4"/><path d="M12 11h8M12 15h8M12 19h5" stroke="#8a5a2b" stroke-width="1.6" stroke-linecap="round"/>',
});

const first = v => v.name.split(' ')[0];
export const YEAR_DAYS = 12;
const HEAD = { rank: 9, wedding: 8, baby: 7, hard: 6, granted: 5, pet: 4, visitor: 4, crime: 3, rivals: 2, arrive: 1 };   // what makes the chronicle

// ── ranks ──
const comfy = sim => { const c = sim.prosperityCounts?.() || [0, 0, 0, 0]; return c[2] + c[3]; };
const built = (sim, t) => sim.s.buildings.some(b => b.type === t && b.built);
export const RANKS = [
  { id: 'hamlet', name: 'Hamlet', goals: [] },
  { id: 'village', name: 'Village', gems: 10, goals: [
    { id: 'pop', text: '12 villagers', n: 12, have: sim => sim.s.villagers.length },
    { id: 'comfy', text: '3 comfortable homes', n: 3, have: comfy, tip: 'A home is Comfortable when the family is fed, buys a luxury (honey, cheese, cloth or ale) at a Market, and has a Park or Pub within reach.' },
    { id: 'market', text: 'A Market Stall', n: 1, have: sim => +built(sim, 'market') },
    { id: 'fest', text: 'Hold a festival', n: 1, have: sim => sim.s.stats.festivals || 0 },
    { id: 'wish', text: 'Grant a wish', n: 1, tip: 'Villagers wish for small things now and then: a star over their heads.', have: sim => sim.s.stats.wishes || 0 },
  ] },
  { id: 'town', name: 'Town', gems: 25, goals: [
    { id: 'pop', text: '30 villagers', n: 30, have: sim => sim.s.villagers.length },
    { id: 'hall', text: 'A Town Hall', n: 1, have: sim => +built(sim, 'townhall') },
    { id: 'comfy', text: '10 comfortable homes', n: 10, have: comfy, tip: 'A home is Comfortable when the family is fed, buys a luxury (honey, cheese, cloth or ale) at a Market, and has a Park or Pub within reach.' },
    { id: 'safe', text: 'Peaceful streets', n: 1, tip: 'No open wanted posters and no recent thefts. Guards, constables and a Watch House help.', have: sim => +(!sim.safetyOf || sim.safetyOf(mainSid(sim)) === 'Peaceful') },
    { id: 'wish', text: 'Grant 5 wishes', n: 5, have: sim => sim.s.stats.wishes || 0 },
    { id: 'wed', text: 'A wedding', n: 1, have: sim => sim.s.stats.weddings || 0 },
  ] },
  { id: 'city', name: 'City', gems: 50, goals: [
    { id: 'pop', text: '60 villagers', n: 60, have: sim => sim.s.villagers.length },
    { id: 'uni', text: 'An Arcane University', n: 1, have: sim => +built(sim, 'university') },
    { id: 'pros', text: '15 prosperous homes', n: 15, tip: 'Prosperous homes buy three different luxuries and have somewhere to unwind nearby.', have: sim => (sim.prosperityCounts?.() || [0, 0, 0, 0])[3] },
    { id: 'brave', text: 'Drive off a dragon or a raid', n: 1, have: sim => (sim.s.stats.dragonsRepelled || 0) + (sim.s.stats.raidsRepelled || 0) },
    { id: 'land', text: '3 settlements', n: 3, have: sim => Object.keys(sim.s.unlocked).length },
    { id: 'wish', text: 'Grant 15 wishes', n: 15, have: sim => sim.s.stats.wishes || 0 },
  ] },
];
export const mainSid = sim => sim.s.unlocked.meadow ? 'meadow' : Object.keys(sim.s.unlocked)[0];

export function installCelebrations(sim, fresh = false) {
  const s = sim.s;
  s.weddings ||= [];
  s.rank ??= 0;
  s.chronicles ||= [];
  s.chron ||= { year: Math.floor(sim.dayNum() / YEAR_DAYS), snap: snapshot(sim) };
  // couples from before weddings existed are simply married already
  if (!fresh) for (const v of s.villagers) if (v.partner && !v.wed) v.wed = 'old';
  Object.assign(sim, CEL);
  // the year's big moments are kept aside for the chronicle (the Story itself only keeps the latest 150)
  const story = sim.story.bind(sim);
  sim.story = (kind, text, people, icon) => {
    const e = story(kind, text, people, icon);
    if (e && HEAD[kind] && !(kind === 'wedding' && /getting married/.test(text))) {
      const H = s.chron.heads || (s.chron.heads = []);
      if (!H.some(h => h.n === e.n)) { H.push({ n: e.n, kind, text, icon, faces: e.faces.slice(0, 3), t: e.t }); if (H.length > 60) { const lo = H.reduce((m, h, i) => HEAD[h.kind] < HEAD[H[m].kind] ? i : m, 0); H.splice(lo, 1); } }
    }
    return e;
  };

  const second = sim.second.bind(sim);
  sim.second = () => { second(); sim.celSecond(); };
  // wedding guests leave work for the evening
  const think = sim.think.bind(sim);
  sim.think = v => { const w = sim.weddingFor(v); if (w && !sim.sleepy(v) && !v.quest && !(v.jail > s.time) && !(v.ko > 0) && !v.carry) return sim.taskWedding(v, w); return think(v); };
  const mustBreak = sim.mustBreak.bind(sim);
  sim.mustBreak = v => mustBreak(v) || !!sim.weddingFor(v);
}

function snapshot(sim) {
  const s = sim.s, st = s.stats;
  return { t: s.time, pop: s.villagers.length, built: s.buildings.filter(b => b.built).length, festivals: st.festivals || 0, wishes: st.wishes || 0,
    weddings: st.weddings || 0, births: st.births || 0, rank: s.rank || 0, coins: Math.floor(s.res.coins || 0) };
}

const CEL = {
  // ── weddings ──
  wedding(sid) { return this.s.weddings.find(w => w.on && w.sid === sid) || null; },
  weddingFor(v) { const w = this.s.weddings.find(w => w.on && w.sid === v.home); return w && (w.guests.includes(v.id)) ? w : null; },
  planWedding(a, b) {
    const s = this.s;
    const fire = s.buildings.find(o => o.type === 'campfire' && o.sid === a.home);
    if (!fire || a.home !== b.home) { a.wed = b.wed = 'quiet'; return null; }
    let day = this.dayNum() + (this.dayFrac() < 0.5 && !this.festivalToday() ? 0 : 1);
    while (s.weddings.some(o => o.sid === a.home && o.day === day)) day++;
    const today = day === this.dayNum();
    const w = { a: a.id, b: b.id, sid: a.home, day, on: false, guests: [] };
    s.weddings.push(w); a.wed = b.wed = 'planned';
    const when = today ? 'this evening' : day === this.dayNum() + 1 ? 'tomorrow evening' : `in ${day - this.dayNum()} days`;
    this.log(`${a.name} and ${b.name} are getting married ${when}!`);
    this.story('wedding', `${first(a)} and ${first(b)} are getting married ${when}, round the campfire. Everyone is invited.`, [a, b], 'rings');
    return w;
  },
  // family and friends first, then the rest of the village (never a rival); at most 14 in all
  weddingGuests(w) {
    const s = this.s, a = this.vById.get(w.a), b = this.vById.get(w.b);
    const fam = new Set([...(a.parents || []), ...(b.parents || []), ...(a.kids || []), ...(b.kids || [])]);
    const score = o => (fam.has(o.id) || this.related?.(a, o) || this.related?.(b, o) ? 100 : 0) + Math.max(this.affinity?.(a, o) || 0, this.affinity?.(b, o) || 0);
    const rest = s.villagers.filter(o => o !== a && o !== b && o.home === w.sid && score(o) > -10).sort((x, y) => score(y) - score(x)).slice(0, 12);
    return [a.id, b.id, ...rest.map(o => o.id)];
  },
  startWedding(w) {
    const s = this.s;
    w.on = true; w.guests = this.weddingGuests(w); w.started = s.time;
    for (const id of w.guests) {
      const v = this.vById.get(id);
      if (v && !v.carry && !v.asleep && v.task && !v.quest) { this.dropTask(v); v.thinkCd = this.rng() * 1.5; }
    }
    this.emit('wedding', w);
    this.emit('sfx', 'level');
  },
  endWedding(w, ok = true) {
    const s = this.s, a = this.vById.get(w.a), b = this.vById.get(w.b);
    s.weddings = s.weddings.filter(o => o !== w);
    s.wedDay = { ...(s.wedDay || {}), [w.sid]: this.dayNum() };
    for (const id of w.guests) { const v = this.vById.get(id); if (v?.task?.label?.startsWith('At the wedding')) this.dropTask(v); }
    if (!ok || !a || !b) { if (a) a.wed = 'quiet'; if (b) b.wed = 'quiet'; this.emit('weddingEnd', w); return; }
    a.wed = b.wed = 'yes';
    s.stats.weddings = (s.stats.weddings || 0) + 1;
    s.festJoy = Math.max(s.festJoy || 0, DAY * 0.5);
    const guests = w.guests.map(id => this.vById.get(id)).filter(Boolean);
    for (const g of guests) if (g !== a && g !== b) { this.bumpAffinity?.(g, a, 4); this.bumpAffinity?.(g, b, 4); }
    this.addXp(20 + guests.length * 2);
    const n = guests.length - 2;
    const msg = `${first(a)} and ${first(b)} are married! ${n > 0 ? `${n} guest${n > 1 ? 's' : ''} danced until the fire burned low.` : 'A quiet ceremony, just the two of them under the stars.'}`;
    this.log(msg); this.story('wedding', msg, [a, b], 'rings');
    this.emit('weddingEnd', w);
  },
  taskWedding(v, w) {
    const s = this.s, fire = s.buildings.find(o => o.type === 'campfire' && o.sid === w.sid);
    if (!fire) return this.thinkIdle(v);
    const c = this.bCenter(fire), W = this.world, couple = v.id === w.a || v.id === w.b;
    // the couple stand just in front of the fire; the guests make a ring round them
    const cx = c.x, cz = c.z + 2.1;
    let px = cx + (v.id === w.a ? -0.32 : 0.32), pz = cz;
    if (!couple) {
      const k = Math.max(0, w.guests.indexOf(v.id) - 2), n = Math.max(1, w.guests.length - 2);
      search: for (const dr of [0, 0.5, -0.3, 1]) for (const da of [0, 0.3, -0.3]) {
        const a = (k + da) / n * Math.PI * 2 + 0.4, r = 1.6 + (k >= 8 ? 0.8 : 0) + dr;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, i = idx(toTile(x), toTile(z));
        if (inMap(toTile(x), toTile(z)) && W.passable(i) && !W.block[i]) { px = x; pz = z; break search; }
      }
    }
    const other = couple ? this.vById.get(v.id === w.a ? w.b : w.a) : null;
    const face = couple ? [other ? (v.id === w.a ? px + 1 : px - 1) : cx, pz] : [cx, cz];
    const until = () => !w.on || this.sleepy(v);
    this.setTask(v, couple ? 'At the wedding (getting married!)' : 'At the wedding', [{ walk: this.goalBuilding(fire) }, { to: [px, pz] }, { face },
      { act: 9999, anim: 'dance', until, start: () => { v.dancing = true; }, done: () => { v.dancing = false; } }]);
  },
  weddingSecond() {
    const s = this.s, f = this.dayFrac(), day = this.dayNum();
    // new couples plan a wedding
    for (const a of s.villagers) {
      if (!a.partner || a.wed || a.id > a.partner) continue;
      const b = this.vById.get(a.partner); if (!b) continue;
      if (b.wed) { a.wed = b.wed; continue; }
      this.planWedding(a, b);
    }
    for (const w of [...s.weddings]) {
      const a = this.vById.get(w.a), b = this.vById.get(w.b);
      // called off: one of them moved away, or they parted
      if (!a || !b || a.partner !== b.id) { if (w.on) this.endWedding(w, false); else { s.weddings = s.weddings.filter(o => o !== w); if (a) a.wed = null; if (b) b.wed = null; } continue; }
      if (!w.on && w.day < day) w.day = day;                                // missed (a storm, a festival): today instead
      if (!w.on && w.day === day && s.weddings.some(o => o !== w && o.on && o.sid === w.sid)) continue;   // one at a time
      if (!w.on && w.day === day && f >= 0.56 && f < 0.68) {
        if (this.stormy() || this.festivalActive() || s.events?.list?.some(e => e.type === 'dragon' && e.sid === w.sid) || s.wedDay?.[w.sid] === day) { w.day = day + 1; continue; }
        this.startWedding(w);
      }
      if (w.on && (f >= 0.715 || f < 0.5 || s.time - w.started > DAY * 0.17)) this.endWedding(w);
    }
    // the happy couple: hearts over their heads all evening
    for (const w of s.weddings) if (w.on) for (const id of [w.a, w.b]) {
      const v = this.vById.get(id), o = this.vById.get(id === w.a ? w.b : w.a);
      if (v && o && !(v.talk?.until > s.time)) v.talk = { k: 'love', until: s.time + 3, with: o.id };
    }
  },

  // ── rank ──
  rankOf() { return RANKS[this.s.rank || 0]; },
  nextRank() { return RANKS[(this.s.rank || 0) + 1] || null; },
  rankGoals(R = this.nextRank()) { return R ? R.goals.map(g => { const have = g.have(this); return { ...g, have, done: have >= g.n }; }) : []; },
  rankSecond() {
    const s = this.s, R = this.nextRank();
    if (!R || s.time - (s.rankAt || -999) < 30) return;
    if (!this.rankGoals(R).every(g => g.done)) return;
    s.rank = (s.rank || 0) + 1; s.rankAt = s.time;
    s.res.gems += R.gems; this.track('gems', R.gems);
    s.festJoy = Math.max(s.festJoy || 0, DAY);
    this.addXp(60 * s.rank);
    const name = this.sname(mainSid(this));
    const msg = `${name} is a ${R.name} now! The bells rang, the crest banner went up, and there were fireworks over the campfire. +${R.gems} gems.`;
    this.log(msg); this.story('rank', msg, [], 'crest');
    this.emit('rank', R);
    this.emit('res');
  },

  // ── the chronicle ──
  // a year's story, bound up: numbers, a few headlines and a name for the year
  compileYear(year, partial = false) {
    const s = this.s, C = s.chron, t0 = year * YEAR_DAYS * DAY, t1 = t0 + YEAR_DAYS * DAY;
    const now = snapshot(this), was = C.snap || now;
    const ents = (s.story || []).filter(e => e.t >= t0 && e.t < t1);
    const count = k => ents.filter(e => e.kind === k).length;
    const hard = ents.filter(e => e.kind === 'hard');
    const nums = {
      pop: [was.pop, now.pop], built: Math.max(0, now.built - was.built), births: now.births - was.births,
      weddings: now.weddings - was.weddings, wishes: now.wishes - was.wishes, festivals: now.festivals - was.festivals,
      arrivals: count('arrive'), farewells: count('farewell'), left: count('leave'), hard: hard.length, crimes: count('crime'), pets: count('pet'), rank: now.rank > was.rank ? RANKS[now.rank].name : null,
    };
    // headlines: the biggest moments first, at most five (one of each kind before any repeats)
    const pool = (year === C.year && C.heads?.length ? C.heads : ents.filter(e => HEAD[e.kind] && !(e.kind === 'wedding' && /getting married/.test(e.text)))).filter(e => e.t >= t0 && e.t < t1);
    const seen = new Set(), ranked = [...pool].sort((a, b) => HEAD[b.kind] - HEAD[a.kind] || b.t - a.t);
    const firsts = ranked.filter(e => !seen.has(e.kind) && seen.add(e.kind)), rest = ranked.filter(e => !firsts.includes(e));
    const heads = [...firsts, ...rest].slice(0, 5)
      .map(e => ({ text: e.text, icon: e.icon, kind: e.kind, faces: e.faces.slice(0, 3), day: Math.floor(e.t / DAY) + 1 }))
      .sort((a, b) => a.day - b.day);
    const dragon = hard.some(e => /dragon/i.test(e.text)), fire = ents.some(e => /fire/i.test(e.text) && e.kind === 'hard');
    const title = nums.rank ? `the Year ${this.sname(mainSid(this))} Became a ${nums.rank}` : dragon ? 'the Year of the Dragon' : nums.weddings >= 2 ? 'the Year of Weddings'
      : nums.births >= 3 ? 'the Year of Cradles' : fire ? 'the Year of Smoke and Buckets' : nums.hard >= 3 ? 'the Hard Year' : nums.wishes >= 4 ? 'the Year of Wishes'
      : nums.built >= 12 ? 'the Year of Hammers' : nums.pop[1] - nums.pop[0] >= 8 ? 'the Year of New Faces' : 'a Quiet Year';
    return { year: year + 1, title, nums, heads, name: this.sname(mainSid(this)), partial, t: s.time };
  },
  chronicleSecond() {
    const s = this.s, y = Math.floor(this.dayNum() / YEAR_DAYS);
    if (y <= s.chron.year) return;
    const ch = this.compileYear(s.chron.year);
    s.chronicles.unshift(ch); if (s.chronicles.length > 20) s.chronicles.pop();
    s.chron = { year: y, snap: snapshot(this) };
    s.chronNew = (s.chronNew || 0) + 1;
    this.log(`The Chronicle of Year ${ch.year} is written: ${ch.title}.`);
    this.emit('chronicle', ch);
  },

  celSecond() {
    this.weddingSecond();
    if (((this.s.time | 0) % 5) === 0) { this.rankSecond(); this.chronicleSecond(); }
  },
};
