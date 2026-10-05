// The census: a Population page under People. Who lives here, at a glance: how many,
// how the number has changed day by day, ages, peoples, genders, classes, schooling,
// work, families and temperaments, for the whole realm or one settlement.
// installCensus() keeps a small daily history (s.census.hist) so the chart has a past.
import { svg } from './icons.js';
import { stageOf } from './sim.js';
import { JOBS } from './data.js';
import { RACES, GENDERS } from './society.js';
import { CLASSES, classOf } from './rpg.js';
import { TIERS } from './education.js';
import { QUIRKS } from './social.js';

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HIST_MAX = 120;   // days kept

export function installCensus(sim) {
  const s = sim.s;
  s.census ||= { hist: [], arrived: 0, left: 0 };
  const C = s.census;
  const snap = () => {
    const vs = s.villagers, by = {};
    for (const v of vs) by[v.home] = (by[v.home] || 0) + 1;
    return { d: sim.dayNum(), n: vs.length, kids: vs.filter(v => stageOf(v) === 'child').length, by };
  };
  // an older save starts with what the yearly chronicles remember (where each year began and ended)
  if (!C.hist.some(h => h.d < sim.dayNum())) {
    const past = [];
    for (const c of [...(s.chronicles || [])].reverse()) past.push({ d: (c.year - 1) * 12, n: c.nums.pop[0] }, { d: c.year * 12 - 1, n: c.nums.pop[1] });
    if (s.chron?.snap && s.chron.year * 12 < sim.dayNum()) past.push({ d: s.chron.year * 12, n: s.chron.snap.pop });
    const early = past.filter(p => p.d < sim.dayNum()).sort((a, b) => a.d - b.d).filter((p, i, l) => !i || p.d !== l[i - 1].d);
    C.hist.unshift(...early.map(p => ({ ...p, kids: null, by: null })));
  }
  if (!C.hist.length || C.hist[C.hist.length - 1].d !== sim.dayNum()) C.hist.push(snap());
  // one sample a day (the last one of the day wins, so the chart shows where each day ended)
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    if (((s.time | 0) % 10) !== 0) return;
    const now = snap(), last = C.hist[C.hist.length - 1];
    if (last && last.d === now.d) C.hist[C.hist.length - 1] = now; else C.hist.push(now);
    if (C.hist.length > HIST_MAX) C.hist.shift();
  };
  // newcomers (grown-ups who walk in, not babies) and anyone who leaves
  const spawn = sim.spawnVillager.bind(sim);
  sim.spawnVillager = (sid, x, z, o = {}) => { const v = spawn(sid, x, z, o); if (!(o.parents || []).length && v.age >= 14) C.arrived++; return v; };
  const pass = sim.passAway.bind(sim);
  sim.passAway = v => { C.left++; return pass(v); };
}

// ── the page ──
const pct = (n, of) => of ? Math.round(n / of * 100) : 0;
function bars(rows, total, opts = {}) {
  rows = rows.filter(r => r.n > 0 || opts.keepZero);
  if (!rows.length) return '<p class="pnone">Nobody yet.</p>';
  const max = Math.max(...rows.map(r => r.n), 1);
  return `<div class="pbars">${rows.map(r => `<div class="pbr"${r.tip ? ` data-tip="${esc(r.label)}|${esc(r.tip)}"` : ''}><span class="pl">${r.icon ? svg(r.icon, 15) : ''}${esc(r.label)}</span><span class="pt"><i style="width:${Math.max(r.n ? 3 : 0, r.n / max * 100)}%;background:${r.col || 'var(--gold)'}"></i></span><span class="pn">${r.n}<small>${pct(r.n, total)}%</small></span></div>`).join('')}</div>`;
}
// one bar split into parts (ages, work)
function split(parts, total) {
  const ps = parts.filter(p => p.n > 0);
  return `<div class="psplit">${ps.map(p => `<i style="flex:${p.n};background:${p.col}" data-tip="${esc(p.label)}|${p.n} (${pct(p.n, total)}%)"></i>`).join('')}</div>
    <div class="pkey">${parts.map(p => `<span><b style="background:${p.col}"></b>${esc(p.label)} <em>${p.n}</em></span>`).join('')}</div>`;
}
function chart(hist, sid) {
  const pts = hist.filter(h => sid === 'all' || h.by).map(h => ({ d: h.d, n: sid === 'all' ? h.n : (h.by[sid] || 0) }));
  if (pts.length < 2) return '<p class="pnone">The chart fills in day by day. Come back tomorrow.</p>';
  const W = 600, H = 150, L = 34, R = 10, T = 12, B = 22;
  const max = Math.max(4, ...pts.map(p => p.n)), d0 = pts[0].d, d1 = pts[pts.length - 1].d, span = Math.max(1, d1 - d0);
  const min = Math.min(...pts.map(p => p.n)), range = Math.max(4, max - (min > 20 ? min * 0.8 : 0));
  const step = range > 60 ? 20 : range > 24 ? 10 : range > 10 ? 5 : 2, top = Math.ceil(max / step) * step;
  // a big, steady village doesn't need the axis to start at zero: start just under the lowest point
  const low = min > 20 ? Math.max(0, Math.floor(min * 0.8 / step) * step) : 0;
  const x = d => L + (d - d0) / span * (W - L - R), y = n => T + (1 - (n - low) / Math.max(1, top - low)) * (H - T - B);
  const line = pts.map(p => `${x(p.d).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ');
  let g = '';
  for (let v = low; v <= top; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 6}" y="${y(v) + 4}" class="ya">${v}</text>`;
  // year marks (a year is 12 days)
  for (let d = Math.ceil(d0 / 12) * 12; d <= d1; d += 12) if (d > d0) g += `<line x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${H - B}" class="yr"/><text x="${x(d) + 4}" y="${T + 10}" class="yl">Year ${d / 12 + 1}</text>`;
  const last = pts[pts.length - 1];
  return `<svg class="pchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Population over the last ${span + 1} days, now ${last.n}">${g}
    <polygon points="${x(d0)},${y(low)} ${line} ${x(d1)},${y(low)}" class="ar"/><polyline points="${line}" class="ln"/>
    <circle cx="${x(last.d)}" cy="${y(last.n)}" r="4.5" class="dt"/>
    <text x="${L}" y="${H - 5}" class="xa">Day ${d0 + 1}</text><text x="${W - R}" y="${H - 5}" class="xa" text-anchor="end">Day ${d1 + 1}</text></svg>`;
}

export function censusHtml(ui) {
  const sim = ui.sim, s = sim.s, C = s.census || { hist: [], arrived: 0, left: 0 };
  const sids = Object.keys(s.unlocked);
  let sid = ui.popSid || 'all'; if (sid !== 'all' && !s.unlocked[sid]) sid = ui.popSid = 'all';
  const vs = s.villagers.filter(v => sid === 'all' || v.home === sid), N = vs.length;
  const beds = sid === 'all' ? sids.reduce((t, k) => t + sim.housingIn(k), 0) : sim.housingIn(sid);
  // change over the last day and the last year (12 days)
  const at = d => { const h = [...C.hist].reverse().find(h => h.d <= d); return h ? (sid === 'all' ? h.n : (h.by?.[sid] || 0)) : null; };
  const day = sim.dayNum(), dDay = at(day - 1), dYear = at(day - 12);
  const delta = (was, label) => was == null ? '' : `<small class="${N - was > 0 ? 'up' : N - was < 0 ? 'down' : ''}">${N - was > 0 ? '+' : ''}${N - was} ${label}</small>`;
  const kids = vs.filter(v => stageOf(v) === 'child'), elders = vs.filter(v => stageOf(v) === 'elder'), adults = vs.filter(v => stageOf(v) === 'adult');
  const avgAge = N ? Math.round(vs.reduce((t, v) => t + (v.age || 0), 0) / N) : 0;

  let h = '';
  if (sids.length > 1) h += `<div class="storybar">${[['all', 'Everywhere'], ...sids.map(k => [k, sim.sname(k)])].map(([k, t]) => `<button class="tog ${sid === k ? 'on' : ''}" data-act="pop-sid" data-k="${k}">${esc(t)}</button>`).join('')}</div>`;
  // the headline numbers
  h += `<div class="pstats">
    <div class="pstat big">${svg('people', 26)}<b>${N}</b><span>villagers${delta(dDay, 'since yesterday')}${delta(dYear, 'this year')}</span></div>
    <div class="pstat" data-tip="Beds|Beds in homes and lodgings. Without a free bed, nobody new moves in.">${svg('house', 22)}<b>${Math.min(N, beds)}/${beds}</b><span>beds filled</span></div>
    <div class="pstat" data-tip="Happiness|How the whole village feels. Happy villagers work faster, and newcomers only arrive when folks are happy.">${svg('smile', 22)}<b>${Math.round(s.happiness)}%</b><span>happiness</span></div>
    <div class="pstat" data-tip="Average age|Children grow up at 14 and retire at 66.">${svg('clock', 22)}<b>${avgAge}</b><span>average age</span></div>
  </div>`;
  // over time
  h += `<section class="psec"><h3>${svg('xp', 16)} Over time</h3>${chart(C.hist, sid)}
    <div class="pkey"><span>${svg('baby', 13)}Born <em>${s.stats.births || 0}</em></span><span>${svg('person', 13)}Moved in <em>${C.arrived || 0}</em></span><span>${svg('people', 13)}Visitors welcomed <em>${s.stats.visitors || 0}</em></span><span>${svg('heart', 13)}Weddings <em>${s.stats.weddings || 0}</em></span><span>${svg('leaf', 13)}Farewells <em>${s.stats.deaths || 0}</em></span></div></section>`;
  // ages and work
  const idle = adults.filter(v => v.job === 'idle').length, study = adults.filter(v => v.job === 'student').length, work = adults.length - idle - study;
  h += `<div class="pcols"><section class="psec"><h3>${svg('baby', 16)} Ages</h3>${split([{ label: 'Children', n: kids.length, col: '#f2b36a' }, { label: 'Grown-ups', n: adults.length, col: '#7cc05a' }, { label: 'Elders', n: elders.length, col: '#a98bd6' }], N)}</section>
    <section class="psec"><h3>${svg('hammer', 16)} Work</h3>${split([{ label: 'Working', n: work, col: '#5f9fd6' }, { label: 'Idle', n: idle, col: '#e0b450' }, { label: 'Studying', n: study, col: '#a98bd6' }, { label: 'Retired', n: elders.length, col: '#c9b48a' }], adults.length + elders.length)}</section></div>`;
  // peoples and genders
  const count = (list, key) => { const m = {}; for (const v of list) { const k = key(v); m[k] = (m[k] || 0) + 1; } return m; };
  const races = count(vs, v => v.race || 'human'), gens = count(vs, v => v.gender || 'x');
  h += `<div class="pcols"><section class="psec"><h3>${svg('person', 16)} Peoples</h3>${bars(Object.entries(races).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: RACES[k]?.name || k, n, tip: RACES[k] ? `${RACES[k].trait}: ${RACES[k].desc}` : '' })), N)}</section>
    <section class="psec"><h3>${svg('heart', 16)} Genders</h3>${bars(Object.entries(GENDERS).map(([k, g]) => ({ label: g.name, n: gens[k] || 0, col: { f: '#e88aa6', m: '#6fa8dc', x: '#b48ad6' }[k], tip: g.pro })), N, { keepZero: false })}</section></div>`;
  // classes and schooling (grown-ups)
  const grown = vs.filter(v => stageOf(v) !== 'child');
  const cls = count(grown, v => classOf(v)), edu = count(grown, v => sim.eduTier(v));
  h += `<div class="pcols"><section class="psec"><h3>${svg('shield', 16)} Classes</h3>${bars(Object.entries(cls).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: CLASSES[k]?.name || k, n, icon: CLASSES[k]?.icon, col: k === 'commoner' ? '#c9b48a' : 'var(--gold)' })), grown.length)}</section>
    <section class="psec"><h3>${svg('cap', 16)} Schooling</h3>${bars(TIERS.map((t, i) => ({ label: t.name, n: edu[i] || 0, tip: t.desc, col: ['#c9b48a', '#9fd07a', '#6fbf6a', '#4f9fd0', '#8a6ad6'][i] })), grown.length)}</section></div>`;
  // jobs
  const jobs = count(adults.filter(v => !['idle', 'student'].includes(v.job)), v => v.job);
  const jl = Object.entries(jobs).sort((a, b) => b[1] - a[1]);
  h += `<section class="psec"><h3>${svg('gear', 16)} Jobs</h3>${jl.length ? `<div class="pjobs">${jl.map(([k, n]) => `<span>${esc(JOBS[k]?.name || k)} <em>${n}</em></span>`).join('')}</div>` : '<p class="pnone">Nobody has a job yet.</p>'}</section>`;
  // families and temperaments
  const couples = vs.filter(v => v.partner && v.id < v.partner && sim.vById.has(v.partner)).length;
  const singles = adults.filter(v => !v.partner).length;
  const parents = vs.filter(v => (v.kids || []).some(id => sim.vById.has(id)));
  const homes = new Set(vs.map(v => sim.homeOf?.(v)?.id).filter(Boolean)).size;
  const pets = (s.pets || []).filter(p => vs.some(v => v.id === p.owner)).length;
  const qs = count(vs, v => v.quirk || 'cheerful');
  h += `<div class="pcols"><section class="psec"><h3>${svg('house', 16)} Families</h3><div class="pfacts">
      <span><b>${couples}</b>couples</span><span><b>${singles}</b>single grown-ups</span><span><b>${parents.length}</b>parents</span><span><b>${homes}</b>households</span><span><b>${N && homes ? (N / homes).toFixed(1) : '0'}</b>per home</span><span><b>${pets}</b>pets</span></div></section>
    <section class="psec"><h3>${svg('smile', 16)} Temperaments</h3>${bars(Object.entries(QUIRKS).map(([k, q]) => ({ label: q.name, n: qs[k] || 0, tip: q.desc, col: '#e0a86a' })).sort((a, b) => b.n - a.n), N)}</section></div>`;
  // settlements side by side
  if (sid === 'all' && sids.length > 1) {
    h += `<section class="psec"><h3>${svg('map', 16)} Settlements</h3><div class="ptable"><div class="pth"><span>Settlement</span><span>Villagers</span><span>Beds</span><span>Children</span></div>${sids.map(k => { const p = s.villagers.filter(v => v.home === k); return `<button class="ptr" data-act="pop-sid" data-k="${k}"><span>${esc(sim.sname(k))}</span><span>${p.length}</span><span>${sim.housingIn(k)}</span><span>${p.filter(v => stageOf(v) === 'child').length}</span></button>`; }).join('')}</div></section>`;
  }
  return h;
}

export const CENSUS_CSS = `.pstats{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:8px;margin-bottom:10px}.pstat{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:8px 10px;border-radius:12px;background:#fffaf0;border:2px solid #ead2a6}.pstat b{font-size:20px;line-height:1.1}.pstat span{font-size:11.5px;color:var(--ink2);display:flex;flex-direction:column}.pstat.big{background:#fff3cf;border-color:#e8c860}.pstat.big b{font-size:28px}.pstat small{font-size:11px;font-weight:700;color:var(--ink2)}.pstat small.up{color:#3f7a39}.pstat small.down{color:#a8432f}
.psec{padding:10px 12px;border-radius:12px;background:#fffaf0;border:2px solid #ead2a6;margin-bottom:8px;min-width:0}.psec h3{font-size:13.5px;margin:0 0 8px;display:flex;align-items:center;gap:6px}
.pcols{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pcols .psec{margin-bottom:8px}
.pchart{width:100%;height:auto;display:block}.pchart .gl{stroke:#eadcb6;stroke-width:1}.pchart .yr{stroke:#d9bb86;stroke-width:1;stroke-dasharray:3 3}.pchart .ya,.pchart .xa,.pchart .yl{font:600 11px Fredoka,sans-serif;fill:#8a6a48}.pchart .ya{text-anchor:end}.pchart .ar{fill:#f4c24a;opacity:.28}.pchart .ln{fill:none;stroke:#d9932a;stroke-width:2.5;stroke-linejoin:round}.pchart .dt{fill:#fff;stroke:#d9932a;stroke-width:2.5}
.pbars{display:grid;gap:5px}.pbr{display:grid;grid-template-columns:minmax(80px,auto) 1fr 58px;align-items:center;gap:8px;font-size:12px}.pl{display:flex;align-items:center;gap:4px;font-weight:600;white-space:nowrap}.pt{height:10px;border-radius:5px;background:#f1e3c2;overflow:hidden}.pt i{display:block;height:100%;border-radius:5px}.pn{text-align:right;font-weight:700}.pn small{font-weight:600;color:var(--ink2);margin-left:4px;font-size:10.5px}
.psplit{display:flex;height:16px;border-radius:8px;overflow:hidden;background:#f1e3c2;margin-bottom:6px}.psplit i{display:block;height:100%}
.pkey{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--ink2);margin-top:6px}.pkey span{display:inline-flex;align-items:center;gap:4px}.pkey b{display:inline-block;width:10px;height:10px;border-radius:3px}.pkey em{font-style:normal;font-weight:700;color:var(--ink)}
.pjobs{display:flex;flex-wrap:wrap;gap:5px}.pjobs span{font-size:12px;padding:3px 9px;border-radius:10px;background:#f3e7c6;border:1px solid #e2cfa0}.pjobs em{font-style:normal;font-weight:700}
.pfacts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.pfacts span{display:flex;flex-direction:column;font-size:11.5px;color:var(--ink2);padding:6px 8px;border-radius:10px;background:#f7efd9}.pfacts b{font-size:18px;color:var(--ink)}
.ptable{display:grid;gap:3px}.pth,.ptr{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:6px;font-size:12px;padding:5px 8px;border-radius:8px;text-align:left}.pth{font-weight:700;color:var(--ink2)}.ptr{background:#f7efd9;border:0;font:inherit;font-size:12.5px;color:var(--ink);cursor:pointer}.ptr:hover{background:#f1e3c2}
.pnone{font-size:12px;color:var(--ink2);margin:0}
@media(max-width:600px){.pstats{grid-template-columns:1fr 1fr}.pcols{grid-template-columns:1fr}.pfacts{grid-template-columns:repeat(2,1fr)}}`;
