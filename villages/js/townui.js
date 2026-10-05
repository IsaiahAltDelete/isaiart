// The Town panel (government, taxes, policies, how the village is doing) and the
// building/villager panel sections for homes, towers, the university and venues.
// Actions are prefixed "town-"; all user-entered text is escaped.
import { svg } from './icons.js';
import { JOBS, HOME_TYPES, LODGING_TYPES } from './data.js';
import { GOVERNMENTS, POLICIES } from './government.js';
import { PROSPERITY } from './economy.js';
import { VENUES } from './leisure.js';
import { UNIVERSITY_POINTS } from './education.js';
import { CLASS_PLACES } from './classplaces.js';
import { lvlOf, stageOf } from './sim.js';
import { randomSeedText, seedFromText, traitsFor } from './world.js';

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const int = n => Math.floor(n || 0).toLocaleString();
const linkV = v => v ? `<button class="btn ghost sm" data-act="town-person" data-id="${v.id}">${esc(v.name)}</button>` : '<i>nobody yet</i>';
const PROS_COL = ['#c0563f', '#c49a3a', '#6aa04a', '#3f8fb0'];
const prosChip = n => `<span class="pros p${n}">${esc(PROSPERITY[n].name)}</span>`;

export function townInit(ui) {
  const button = document.createElement('button');
  button.id = 'btnTown'; button.className = 'round'; button.setAttribute('aria-label', 'Town');
  button.dataset.tip = 'Town|Government, taxes and how your households are doing.'; button.innerHTML = svg('house', 22);
  button.onclick = () => ui.openModal('town'); document.getElementById('topright').prepend(button);
  const style = document.createElement('style');
  style.textContent = `.town-section{padding:12px 0;border-top:1px solid #e3cf9f}.town-section:first-child{border-top:0;padding-top:0}.town-section h3{font-size:15px;margin:0 0 6px;display:flex;align-items:center;gap:6px}.town-section p{font-size:12.5px;line-height:1.5;color:var(--ink2);margin:4px 0 8px}
.govs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.gov{display:flex;flex-direction:column;gap:3px;text-align:left;padding:9px 10px;border:2px solid #e0c68f;border-radius:12px;background:#fffaf0;color:var(--ink);font:inherit;cursor:pointer;transition:transform .12s,border-color .12s}.gov:hover:not(:disabled){transform:translateY(-1px);border-color:#c89a4a}.gov.on{border-color:#5f9a3e;background:#f1f7e4}.gov:disabled{opacity:.55;cursor:default}.gov.on:disabled{opacity:1}.gov b{font-size:13px;display:flex;align-items:center;gap:5px}.gov small{font-size:11px;color:var(--ink2);line-height:1.35}
.leader{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:#f7efd9;margin-bottom:10px}.leader .face{flex:none}.leader b{font-size:14px}.leader small{display:block;font-size:11.5px;color:var(--ink2)}
.taxrow{display:flex;align-items:center;gap:10px}.taxrow input{flex:1;accent-color:#b27a24}.taxrow output{min-width:42px;text-align:right;font-weight:700}
.ledger{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.ledger span{font-size:12px;padding:5px 10px;border-radius:10px;background:#efe2be}.ledger .up{background:#dbedc6;color:#335a29}.ledger .down{background:#f6d9cf;color:#8a3a26}
.pols{display:grid;gap:6px}.pol{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:10px;background:#fffaf0;border:1px solid #e6d3a6}.pol>div{flex:1;min-width:0}.pol b{font-size:13px}.pol small{display:block;font-size:11.5px;color:var(--ink2)}
.prosbar{display:flex;height:12px;border-radius:7px;overflow:hidden;background:#eadcb6;margin:6px 0}.prosbar i{display:block;height:100%}
.pros{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:9px;color:#fff}.pros.p0{background:${PROS_COL[0]}}.pros.p1{background:${PROS_COL[1]}}.pros.p2{background:${PROS_COL[2]}}.pros.p3{background:${PROS_COL[3]}}
.crimelog{font-size:12px;line-height:1.5;color:var(--ink2);margin:4px 0 0;padding-left:16px}
.seed-row{display:flex;gap:6px}.seed-row input{flex:1;min-width:0}.seed-traits{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.seed-traits span{font-size:12px;padding:5px 9px;border-radius:15px;background:#edf0d2}`;
  document.head.appendChild(style);
}

// ── the Town panel: one page ──
export function townHtml(ui) {
  const sim = ui.sim, s = sim.s, g = s.gov, hall = sim.townHall(), info = sim.govInfo(), leader = sim.govLeader();
  let h = '';
  // government
  h += `<section class="town-section"><h3>${svg(info.icon, 18)} ${esc(info.name)}</h3>`;
  h += `<div class="leader">${leader && ui.face ? ui.face(leader, 40) : ''}<div><small>${esc(info.title)}</small><b>${leader ? linkV(leader) : 'nobody yet'}</b><small>${esc(info.desc)}</small></div></div>`;
  if (!hall) h += `<div class="callout">${svg('house', 20)}<span>The Council of Elders looks after the village for now. Build a <b>Town Hall</b> (level 4, Build → Services) to choose how the village is run, set taxes and pass policies.</span></div>`;
  h += `<div class="govs">${Object.entries(GOVERNMENTS).map(([k, d]) => {
    const can = hall && (k !== 'magocracy' || sim.highArchmage());
    return `<button class="gov${g.type === k ? ' on' : ''}" data-act="town-gov" data-k="${k}" ${can && g.type !== k ? '' : 'disabled'} aria-pressed="${g.type === k}"><b>${svg(d.icon, 15)}${esc(d.name)}</b>${d.perks.map(p => `<small>· ${esc(p)}</small>`).join('')}</button>`;
  }).join('')}</div>`;
  if (g.type === 'monarchy' && hall) h += `<p style="margin-top:8px">Crown someone: <select data-act="town-monarch" aria-label="Monarch">${s.villagers.filter(v => stageOf(v) !== 'child').map(v => `<option value="${v.id}" ${g.leader === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></p>`;
  h += `</section>`;
  // treasury
  const e = s.economy || {}, perMin = n => Math.round(n * 3);
  const income = perMin(e.income || 0), spend = perMin(Object.keys(POLICIES).filter(k => sim.policyOn(k)).length * sim.policyCost());
  h += `<section class="town-section"><h3>${svg('coin', 18)} Treasury · ${int(s.res.coins)} coins</h3>
    ${hall ? `<div class="taxrow"><span>Tax</span><input type="range" min="0" max="30" step="1" value="${Math.round(g.tax * 100)}" data-act="town-tax" aria-label="Tax rate"><output id="townTaxValue">${Math.round(g.tax * 100)}%</output></div>
    <p>Homes pay more tax the more prosperous they are. Above 10%, people grumble: happiness drops a little.</p>
    <div class="ledger"><span class="up">Taxes +${income}/min</span><span class="down">Policies −${spend}/min</span></div>` : '<p>Taxes start once you have a Town Hall. Until then, coins come from Market Stalls, the merchant and expeditions.</p>'}</section>`;
  // policies
  if (hall) h += `<section class="town-section"><h3>${svg('list', 18)} Policies <small style="font-weight:400;color:var(--ink2);font-size:12px">· each costs ${perMin(sim.policyCost())} coins/min</small></h3><div class="pols">${Object.entries(POLICIES).map(([k, p]) => {
    const on = !!g.policies[k], waiting = on && !sim.policyOn(k);
    return `<div class="pol">${svg(p.icon, 20)}<div><b>${esc(p.name)}</b><small>${esc(p.desc)}${waiting ? ' <b style="color:#a83b29">Not enough coins.</b>' : ''}</small></div><button class="tog ${on ? 'on' : ''}" data-act="town-policy" data-k="${k}" aria-pressed="${on}">${on ? 'On' : 'Off'}</button></div>`;
  }).join('')}</div></section>`;
  // how households are doing
  const sids = Object.keys(s.unlocked), counts = sim.prosperityCounts(), total = counts.reduce((a, b) => a + b, 0);
  h += `<section class="town-section"><h3>${svg('smile', 18)} Households</h3>${total ? `<div class="prosbar">${counts.map((n, i) => n ? `<i style="width:${n / total * 100}%;background:${PROS_COL[i]}" title="${PROSPERITY[i].name}: ${n}"></i>` : '').join('')}</div>
    <div class="ledger">${counts.map((n, i) => n ? `<span>${prosChip(i)} ${n} home${n === 1 ? '' : 's'}</span>` : '').join('')}</div>` : '<p>No families have homes yet.</p>'}
    <p>Fed families get by. A luxury now and then (cloth, cheese, honey, ale from a Market Stall, Pub or Tavern) and a park, pub, bath or theatre nearby make them comfortable; plenty of luxuries makes them prosperous. Prosperous homes pay more tax, cheer everyone up, and show it with flower boxes and lanterns.</p></section>`;
  // safety
  const log = s.crime?.log || [];
  h += `<section class="town-section"><h3>${svg('shield', 18)} Safety</h3><div class="ledger">${sids.map(sid => `<span>${esc(sim.sname(sid))}: <b>${esc(sim.safetyOf(sid))}</b></span>`).join('')}</div>
    <p>Struggling homes and a glum village tempt someone to sneak off with a sack of coins at night. Guards, constables (Watch House), lanterns and the Night watch catch them; with a Watch House they spend the morning in the stocks.</p>
    ${log.length ? `<ul class="crimelog">${log.slice(0, 4).map(l => `<li>${esc(l.msg)}</li>`).join('')}</ul>` : ''}</section>`;
  return h;
}

// ── panel sections for particular buildings ──
export function townBuildingHtml(ui, b) {
  const sim = ui.sim, s = sim.s;
  if (!b.built) return '';
  if (CLASS_PLACES[b.type]) return `<div class="ip-sec"><div class="cap">${svg(['chapel', 'temple'].includes(b.type) ? 'heart' : 'sword', 14)} ${['chapel', 'temple'].includes(b.type) ? 'Care' : 'Training'}<span class="r">${b.data?.careUntil > s.time ? 'Active' : 'Quiet'}</span></div><div class="desc">${esc(CLASS_PLACES[b.type].benefit)}</div></div>`;
  if (HOME_TYPES.includes(b.type) || LODGING_TYPES.includes(b.type)) {
    const p = sim.prosperityParts(b), lvl = b.prosEmpty ? null : b.pros || 0, owner = sim.homeOwner?.(b);
    const items = [[p.fed, 'Everyone fed'], [p.lux.length >= 1, p.lux.length ? `Enjoying ${p.lux.join(', ')}` : 'A luxury lately'], [p.unwind, 'A park, pub, bath or theatre nearby'], [p.lux.length >= 3, 'Three or more luxuries']];
    return `<div class="ip-sec"><div class="cap">${svg('smile', 14)} ${LODGING_TYPES.includes(b.type) ? 'Lodgers' : 'Household'}<span class="r">${lvl == null ? 'Empty' : prosChip(lvl)}</span></div>
      ${owner ? `<dl class="kv"><dt>Family</dt><dd>${linkV(owner)}</dd></dl>` : ''}
      ${lvl == null ? '' : `<ul class="needs">${items.map(([ok, t]) => `<li class="${ok ? 'ok' : ''}">${svg(ok ? 'check' : 'cross', 15)}${esc(t)}</li>`).join('')}</ul>${p.shop ? '' : '<div class="desc">Build a Market Stall, Pub or Tavern so families can buy luxuries.</div>'}`}</div>`;
  }
  if (b.type === 'wizard') {
    const arch = sim.archmageOf(b), candidates = b.workers.map(id => sim.vById.get(id)).filter(v => sim.canArchmage(v));
    return `<div class="ip-sec"><div class="cap">${svg('staff', 14)} Archmage<span class="r">${arch ? esc(arch.name.split(' ')[0]) : 'none yet'}</span></div><div class="desc">${arch ? 'Leads the tower in a starry hat: its wizards study 25% faster.' : 'A level 3 wizard or a Magister can lead this tower.'}</div>${candidates.length > 1 ? `<div class="autorow">${candidates.map(v => `<button class="tog ${arch === v ? 'on' : ''}" data-act="town-archmage" data-id="${v.id}" data-bid="${b.id}">${esc(v.name.split(' ')[0])}</button>`).join('')}</div>` : ''}</div>`;
  }
  if (b.type === 'university') {
    const students = sim.universityStudents(b), cap = 4 + (lvlOf(b) - 1) * 2;
    const eligible = s.villagers.filter(v => sim.universityEligible(v) && v.job !== 'student' && v.home === b.sid && !(v.work === b.id && v.job === 'professor'));
    return `<div class="ip-sec"><div class="cap">${svg('cap', 14)} Students<span class="r">${students.length}/${cap}</span></div><div class="desc">Grown-ups with Honours (aged 14–35) study here for ${UNIVERSITY_POINTS} points and graduate as Magisters: level 2 wizards who work 25% faster.</div>
      ${students.map(v => `<div class="studyrow">${linkV(v)}<button class="btn ghost sm" data-act="town-unenrol" data-id="${v.id}">Leave</button><div class="pbar"><i style="width:${Math.min(100, (v.university || 0) / UNIVERSITY_POINTS * 100)}%"></i></div></div>`).join('')}
      ${eligible.length && students.length < cap ? `<div class="autorow"><select id="universityApplicant" data-act="town-applicant" aria-label="Applicant" style="flex:1">${eligible.map(v => `<option value="${v.id}" ${ui.universityApplicant === v.id ? 'selected' : ''}>${esc(v.name)} · ${esc(JOBS[v.job]?.name || v.job)}</option>`).join('')}</select><button class="btn sm" data-act="town-enrol" data-bid="${b.id}">Enrol</button></div>` : students.length < cap ? '<div class="sub">No eligible applicants here yet.</div>' : ''}</div>`;
  }
  if (VENUES[b.type]) return `<div class="ip-sec"><div class="cap">${svg('smile', 14)} Evening outings<span class="r">${sim.venueOpen(b) ? 'Open' : 'Closed'}</span></div><div class="desc">${VENUES[b.type].allAges ? 'Everyone' : 'Grown-ups'} drop by in the evening and carry the good cheer home.${b.type === 'pub' ? ' Pours local ale.' : b.type === 'bathhouse' ? ' Burns local wood.' : ''}</div><dl class="kv"><dt>Visits</dt><dd>${b.data?.visits || 0}</dd></dl></div>`;
  if (b.type === 'townhall' || b.type === 'watchhouse') return `<div class="ip-sec"><button class="btn gold sm" style="width:100%" data-act="town-open">${svg('house', 14)} Open the Town panel</button></div>`;
  return '';
}

export function townClick(ui, act, a) {
  if (!act.startsWith('town-')) return false;
  const sim = ui.sim;
  if (['town-monarch', 'town-tax', 'town-applicant'].includes(act)) return true;
  if (act === 'town-open') ui.openModal('town');
  if (act === 'town-gov' && !sim.setGovernment(a.dataset.k)) ui.toast('Build a Town Hall first (a Magocracy also needs an Archmage).', 'house');
  if (act === 'town-policy') sim.setPolicy(a.dataset.k, !sim.s.gov.policies[a.dataset.k]);
  if (act === 'town-archmage') sim.appointArchmage(sim.bById.get(+a.dataset.bid), sim.vById.get(+a.dataset.id));
  if (act === 'town-enrol' && !sim.enrol(sim.vById.get(+document.getElementById('universityApplicant')?.value), sim.bById.get(+a.dataset.bid))) ui.toast('This student cannot enrol here yet.', 'cap');
  if (act === 'town-unenrol') { const v = sim.vById.get(+a.dataset.id); if (v) sim.unassign(v); }
  if (act === 'town-person') { const v = sim.vById.get(+a.dataset.id); ui.closeModal(); if (v) ui.g.select({ kind: 'v', v }, true); }
  return true;
}

export function townChange(ui, e) {
  const a = e.target, act = a.dataset.act, sim = ui.sim;
  if (!act?.startsWith('town-')) return false;
  if (act === 'town-applicant') { ui.universityApplicant = +a.value; return true; }
  if (act === 'town-monarch') sim.setGovernment('monarchy', +a.value);
  if (act === 'town-tax') sim.setTax(+a.value / 100);
  ui.drawModal(true); return true;
}

export function seedHtml(ui) {
  ui.newSeed ??= randomSeedText();
  const world = ui.sim.world;
  return `<section class="town-section"><h3>World seed</h3><p>This map: <b>${esc(world.seedLabel)}</b></p><div class="seed-traits">${world.traits.map(t => `<span>${esc(t)}</span>`).join('')}</div>
    <label for="worldSeed">Seed for a new village</label><div class="seed-row"><input id="worldSeed" data-act="seed-input" maxlength="80" value="${esc(ui.newSeed)}" aria-label="World seed"><button class="btn sm" data-act="seed-roll">Re-roll</button><button class="btn sm" data-act="seed-preview">Preview</button></div><div id="seedTraits" class="seed-traits">${(ui.seedTraits || []).map(t => `<span>${esc(t)}</span>`).join('')}</div><p>The same seed always gives the same map. Starting again replaces this village; save a share code first to keep it.</p></section>`;
}
export function seedClick(ui, act) {
  if (!act.startsWith('seed-')) return false;
  ui.newSeed = document.getElementById('worldSeed')?.value ?? ui.newSeed;
  if (act === 'seed-roll') ui.newSeed = randomSeedText();
  if (act === 'seed-preview' || act === 'seed-roll') ui.seedTraits = traitsFor(seedFromText(ui.newSeed));
  return true;
}
