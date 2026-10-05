// Round 8 controls and panel sections; all user-entered text is escaped.
import { svg } from './icons.js';
import { GOODS, JOBS, HOME_TYPES, LODGING_TYPES } from './data.js';
import { RACES, GENDERS } from './society.js';
import { GOVERNMENTS, POLICIES } from './government.js';
import { wealthOf, mortgageCost } from './economy.js';
import { VENUES } from './leisure.js';
import { UNIVERSITY_POINTS } from './education.js';
import { CLASS_PLACES } from './classplaces.js';
import { lvlOf, stageOf } from './sim.js';
import { randomSeedText, seedFromText, traitsFor } from './world.js';

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => (n || 0).toFixed(1);
const linkV = v => v ? `<button class="btn ghost sm" data-act="town-person" data-id="${v.id}">${esc(v.name)}</button>` : 'Unclaimed';
const metric = (label, n) => `<span class="chip"><b>${esc(n)}</b> ${esc(label)}</span>`;

export function townInit(ui) {
  ui.townTab = 'government'; ui.townSid = 'meadow';
  const button = document.createElement('button');
  button.id = 'btnTown'; button.className = 'round'; button.setAttribute('aria-label', 'Town');
  button.dataset.tip = 'Town|Government, household economy and village safety.'; button.innerHTML = svg('house', 22);
  button.onclick = () => ui.openModal('town'); document.getElementById('topright').prepend(button);
  const style = document.createElement('style');
  style.textContent = `.town-tabs{display:flex;gap:6px;margin:0 0 16px;flex-wrap:wrap}.town-tabs button{flex:1}.town-section{padding:14px 0;border-top:1px solid #d4b987}.town-section h3{font-size:16px;margin:0 0 8px}.town-section p{font-size:13px;line-height:1.55;color:var(--ink2);margin:6px 0 12px}.town-row{display:flex;gap:10px;align-items:center;padding:9px 0;flex-wrap:wrap}.town-row label,.town-row>div{flex:1;min-width:150px}.town-row small{display:block;font-size:11px;color:var(--ink2);line-height:1.5}.town-row input[type=range]{width:100%;accent-color:#b27a24}.town-table{width:100%;border-collapse:collapse;font-size:12px}.town-table th,.town-table td{padding:9px 6px;border-bottom:1px solid #dbc89e;text-align:left}.town-table td:nth-child(n+2){text-align:right}.town-table-wrap{overflow-x:auto}.town-muted{font-size:12px;color:var(--ink2)}.town-incident{padding:10px 0;border-bottom:1px solid #dbc89e}.seed-row{display:flex;gap:6px}.seed-row input{flex:1;min-width:0}.seed-traits{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.seed-traits span{font-size:12px;padding:5px 9px;border-radius:15px;background:#edf0d2}.town-progress{margin-top:5px}.town-section select{max-width:100%}@media(max-width:600px){.town-tabs button{font-size:12px;padding:8px}.town-table{font-size:11px}.town-row label,.town-row>div{min-width:120px}}`;
  document.head.appendChild(style);
}

export function townHtml(ui) {
  const sim = ui.sim, s = sim.s, g = s.gov, sid = s.unlocked[ui.townSid] ? ui.townSid : 'meadow';
  let h = `<div class="town-tabs" role="tablist" aria-label="Town topics">${['government', 'economy', 'crime'].map(k => `<button class="btn ${ui.townTab === k ? 'gold' : 'ghost'}" data-act="town-tab" data-k="${k}" role="tab" aria-selected="${ui.townTab === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>`;
  if (ui.townTab === 'government') {
    const leader = sim.govLeader(), info = sim.govInfo(), hall = sim.townHall();
    h += !hall ? `<div class="callout">${svg('house', 20)}<span>Build a <b>Town Hall</b> at level 4 (Build → Civic) to change the government, taxes and policies. The Council of Elders looks after the village meanwhile.</span></div>` : '';
    h += `<section class="town-section"><h3>${esc(info.name)}</h3><p>${esc(info.desc)}</p><div class="town-row"><div>${esc(info.title)}: ${linkV(leader)}</div></div>
      <label>Government <select data-act="town-government" aria-label="Government" ${hall ? '' : 'disabled'}>${Object.entries(GOVERNMENTS).map(([k, d]) => `<option value="${k}" ${g.type === k ? 'selected' : ''} ${k === 'magocracy' && !sim.highArchmage() ? 'disabled' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
      ${g.type === 'monarchy' && hall ? `<div class="town-row"><label>Monarch <select data-act="town-monarch" aria-label="Monarch">${s.villagers.filter(v => stageOf(v) !== 'child' && !(v.jail > s.time)).map(v => `<option value="${v.id}" ${g.leader === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label></div>` : ''}
      <p>Mayors and consuls are chosen at the start of each season. A Magocracy needs an Archmage; towers appoint their most accomplished eligible wizard automatically.</p></section>
      <section class="town-section"><h3>Taxes & treasury</h3><div class="summary tight">${metric('treasury coins', money(s.res.coins))}${metric('wage tax', Math.round(g.tax * 100) + '%')}</div>
      <div class="town-row"><label>Tax rate <output id="townTaxValue">${Math.round(g.tax * 100)}%</output><input type="range" min="0" max="40" step="1" value="${Math.round(g.tax * 100)}" data-act="town-tax" aria-label="Tax rate" ${hall ? '' : 'disabled'}></label></div><p>Wages are funded by the treasury. Tax retains part of each wage; higher taxes leave households less to spend and lower happiness.</p></section>
      <section class="town-section"><h3>Policies</h3>${Object.entries(POLICIES).map(([k, p]) => `<div class="town-row"><label><b>${esc(p.name)}</b><small>${esc(p.desc)}${p.cost ? ` Costs ${p.cost} treasury coins per 20 seconds. ${g.policies[k] && !sim.policyOn(k) ? 'Waiting for funding.' : ''}` : ''}</small></label><button class="tog ${g.policies[k] ? 'on' : ''}" data-act="town-policy" data-k="${k}" aria-pressed="${!!g.policies[k]}" ${hall ? '' : 'disabled'}>${g.policies[k] ? 'On' : 'Off'}</button></div>`).join('')}
      <div class="town-row"><label>Justice<small>Lenient sentences last 40 seconds. Strict sentences last 90 seconds and deter crime, but raise fear.</small></label><select data-act="town-justice" aria-label="Justice" ${hall ? '' : 'disabled'}><option value="lenient" ${g.justice === 'lenient' ? 'selected' : ''}>Lenient</option><option value="strict" ${g.justice === 'strict' ? 'selected' : ''}>Strict</option></select></div></section>`;
  } else {
    h += `<div class="town-row"><label>Settlement <select data-act="town-settlement" aria-label="Settlement">${Object.keys(s.unlocked).map(id => `<option value="${id}" ${id === sid ? 'selected' : ''}>${esc(sim.sname(id))}</option>`).join('')}</select></label></div>`;
    if (ui.townTab === 'economy') {
      const e = s.economy, locals = s.villagers.filter(v => v.home === sid && stageOf(v) !== 'child');
      h += `<div class="summary tight">${metric('treasury', money(s.res.coins))}${metric('local household coins', money(locals.reduce((n, v) => n + (v.purse || 0), 0)))}</div><section class="town-section"><h3>Last pay period · all villages</h3><div class="summary tight">${metric('gross wages', money(e.wages))}${metric('tax retained', money(e.taxes))}${metric('household spending', money(e.spending))}</div>
        ${e.shortfall > 0.01 ? `<p>Unpaid wages: ${money(e.shortfall)} coins. Sell surplus at a Market Stall to replenish the treasury.</p>` : ''}<p>Every 20 seconds workers earn wages. Households repay their homes and buy local cloth, cheese, honey or ale when they can afford it. Park visits are free.</p></section>
        <section class="town-section"><h3>Local prices</h3><p>Scarce goods and household demand raise prices. Surpluses lower them. Market Stall sales use these prices too.</p><div class="town-table-wrap"><table class="town-table"><thead><tr><th>Good</th><th>In store</th><th>Price / unit</th></tr></thead><tbody>${Object.entries(GOODS).filter(([, d]) => d.capped && d.price).map(([k, d]) => `<tr><td>${svg(d.icon, 15)} ${esc(d.name)}</td><td>${Math.floor(sim.trade.get(sid, k))}</td><td>${money(sim.priceOf(k, sid))}</td></tr>`).join('')}</tbody></table></div></section>
        <section class="town-section"><h3>Households</h3>${s.buildings.filter(b => b.sid === sid && b.owner != null && HOME_TYPES.includes(b.type)).map(b => `<div class="town-row"><div><b>${esc(sim.homeName(b))}</b><small>${esc(sim.homeOwner(b)?.name)} · ${money(b.paid)}/${mortgageCost(b)} repaid</small></div><button class="btn sm" data-act="town-building" data-id="${b.id}">View home</button></div>`).join('') || '<p>No occupied homes here yet.</p>'}</section>`;
    } else {
      const c = s.crime, pressure = sim.crimePressure(sid), local = c.incidents.filter(e => e.sid === sid);
      h += `<div class="summary tight">${metric('crime pressure / 100', pressure)}${metric('cases solved', local.filter(e => e.solved).length)}${metric('fear', money(c.fear))}</div>
        <section class="town-section"><h3>Village safety</h3><p>Poverty, idle adults and unhappiness raise pressure. Lighting, guards, constables and funded policies lower it. Constables investigate for two minutes after a report and hold caught culprits at a Watch House.</p>
        <div class="pbar"><i style="width:${pressure}%;background:${pressure > 60 ? '#b55c46' : '#699a54'}"></i></div></section>
        <section class="town-section"><h3>Recent reports</h3>${local.map(e => `<div class="town-incident"><b>${esc(e.kind)}</b> · ${e.solved ? 'Solved' : s.time - e.time >= 120 ? 'Unsolved' : 'Investigating'}<div class="town-muted">${e.solved ? esc(sim.vById.get(e.culprit)?.name || 'A former resident') + ' · ' : ''}${Math.floor((s.time - e.time) / 60)} minutes ago${e.coins ? ' · ' + money(e.coins) + ' coins' : ''}${e.good ? ' · ' + e.amount + ' ' + esc(GOODS[e.good].name.toLowerCase()) : ''}</div></div>`).join('') || '<p>No incidents reported here.</p>'}</section>`;
    }
  }
  return h;
}

export function townBuildingHtml(ui, b) {
  const sim = ui.sim, s = sim.s;
  if (!b.built) return '';
  if (CLASS_PLACES[b.type]) return `<div class="ip-sec"><div class="cap">${svg(['chapel','temple'].includes(b.type)?'heart':'sword',14)} Care & training</div><div class="desc">${esc(CLASS_PLACES[b.type].benefit)} Assign staff through the Jobs board. Commoners learn the workplace's class; experienced adventurers keep their class.</div><dl class="kv"><dt>Completed sessions</dt><dd>${b.data?.sessions || 0}</dd><dt>Recent activity</dt><dd>${b.data?.careUntil > s.time ? 'Active' : 'Waiting for a lesson or service'}</dd></dl></div>`;
  if (LODGING_TYPES.includes(b.type)) return `<div class="ip-sec"><div class="cap">${svg('house',14)} Shared lodging</div><div class="desc">Beds are shared by local residents who need a place to sleep. There is no private owner or mortgage. Families can move into a private home when one becomes available.</div><dl class="kv"><dt>Residents</dt><dd>${s.villagers.filter(v=>sim.homeOf(v)?.id===b.id).length}</dd></dl></div>`;
  if (HOME_TYPES.includes(b.type)) {
    const owner = sim.homeOwner(b), paid = Math.min(mortgageCost(b), b.paid || 0);
    return `<div class="ip-sec"><div class="cap">${svg('house', 14)} Household</div><dl class="kv"><dt>Owner</dt><dd>${linkV(owner)}</dd><dt>Home repayment</dt><dd>${money(paid)}/${mortgageCost(b)} coins</dd><dt>Tenure</dt><dd>${paid >= mortgageCost(b) ? 'Owned outright' : 'Repaying mortgage'}</dd></dl><div class="pbar"><i style="width:${paid / mortgageCost(b) * 100}%"></i></div><div class="desc">Repayment comes from household savings after keeping 4 coins per grown-up. Spare beds can take lodgers.</div></div>`;
  }
  if (b.type === 'wizard') {
    const arch = sim.archmageOf(b), candidates = b.workers.map(id => sim.vById.get(id)).filter(v => sim.canArchmage(v));
    return `<div class="ip-sec"><div class="cap">${svg('staff', 14)} Archmage</div><div class="desc">${arch ? `${esc(arch.name)} leads this tower: other wizards study 25% faster.` : 'A level 3 wizard or a Magister can lead this tower.'}</div>${candidates.map(v => `<button class="btn sm ${arch === v ? 'gold' : ''}" data-act="town-archmage" data-id="${v.id}" data-bid="${b.id}">${esc(v.name.split(' ')[0])}${arch === v ? ' · Archmage' : ' · Appoint'}</button>`).join('')}</div>`;
  }
  if (b.type === 'university') {
    const students = sim.universityStudents(b), eligible = s.villagers.filter(v => sim.universityEligible(v) && v.job !== 'student' && v.home === b.sid && !(v.work === b.id && v.job === 'professor'));
    return `<div class="ip-sec"><div class="cap">${svg('cap', 14)} Arcane students<span class="r">${students.length}/${4 + (lvlOf(b) - 1) * 2}</span></div><div class="desc">Honours grown-ups aged 14–35 can enrol. Professors need Honours too. Graduation needs ${UNIVERSITY_POINTS} study points. Tuition is 0.5 coin per lesson, waived by funded Free schooling.</div>${students.map(v => `<div class="studyrow">${linkV(v)}<button class="btn ghost sm" data-act="town-unenrol" data-id="${v.id}">Leave</button><div class="pbar"><i style="width:${Math.min(100, (v.university || 0) / UNIVERSITY_POINTS * 100)}%"></i></div><small>${Math.floor(v.university || 0)}/${UNIVERSITY_POINTS} points</small></div>`).join('')}${eligible.length ? `<label for="universityApplicant" class="sub">Applicant · ${eligible.length} eligible</label><select id="universityApplicant" data-act="town-applicant" aria-label="University applicant" style="width:100%;margin:6px 0">${eligible.map(v => `<option value="${v.id}" ${ui.universityApplicant === v.id ? 'selected' : ''}>${esc(v.name)} · ${esc(JOBS[v.job]?.name || v.job)}</option>`).join('')}</select><div class="desc">Enrolling leaves the applicant's current job. This university's professors stay on staff; remove them from their job first to enrol them.</div><button class="btn sm" data-act="town-enrol" data-bid="${b.id}" ${students.length >= 4 + (lvlOf(b) - 1) * 2 ? 'disabled' : ''}>Enrol selected applicant</button>` : '<div class="sub">No eligible local applicants yet. Current professors stay on staff.</div>'}</div>`;
  }
  if (VENUES[b.type]) return `<div class="ip-sec"><div class="cap">${svg('smile', 14)} Evening outings</div><dl class="kv"><dt>Status</dt><dd>${sim.venueOpen(b) ? 'Open' : 'Waiting for staff or supplies'}</dd><dt>Entry</dt><dd>${VENUES[b.type].fee ? money(sim.venueFee(b)) + ' coins per grown-up' : 'Free'}</dd><dt>Visits</dt><dd>${b.data?.visits || 0}</dd></dl><div class="desc">${VENUES[b.type].allAges ? 'All ages welcome. Children enter free.' : 'Grown-ups only.'} Villagers visit in the evening and carry the good cheer home.${VENUES[b.type].job ? ' Staff keep serving throughout the evening.' : ''}</div></div>`;
  if (b.type === 'townhall' || b.type === 'watchhouse') return `<div class="ip-sec"><button class="btn gold sm" data-act="town-open" data-k="${b.type === 'watchhouse' ? 'crime' : 'government'}">${svg('house', 14)} Open Town · ${b.type === 'watchhouse' ? 'Crime' : 'Government'}</button></div>`;
  return '';
}

export function townVillagerHtml(ui, v) {
  const sim = ui.sim, race = RACES[v.race] || RACES.human, gender = GENDERS[v.gender] || GENDERS.x, home = sim.homeOf(v);
  return `<div class="ip-sec"><div class="cap">${svg('person', 14)} ${esc(race.name)} · ${esc(gender.name)}${v.title ? `<span class="r">${esc(v.title)}</span>` : ''}</div><div class="desc">${esc(gender.pro)} · ${esc(race.trait)}. ${esc(race.desc)}</div><dl class="kv"><dt>Purse</dt><dd>${money(v.purse)} coins · ${wealthOf(v)}</dd><dt>Last net wage</dt><dd>${money(v.wage)} / pay period</dd>${home ? `<dt>Home</dt><dd><button class="btn ghost sm" data-act="town-building" data-id="${home.id}">${esc(sim.homeName(home))}</button></dd>` : ''}${v.jail > sim.s.time ? `<dt>Custody</dt><dd>${Math.ceil(v.jail - sim.s.time)} seconds left</dd>` : ''}</dl></div>`;
}

export function townClick(ui, act, a) {
  if (!act.startsWith('town-')) return false;
  const sim = ui.sim;
  if (['town-government', 'town-monarch', 'town-justice', 'town-settlement', 'town-tax'].includes(act)) return true;
  if (act === 'town-tab') ui.townTab = a.dataset.k;
  if (act === 'town-open') { ui.townTab = a.dataset.k || 'government'; ui.openModal('town'); }
  if (act === 'town-policy') sim.setPolicy(a.dataset.k, !sim.s.gov.policies[a.dataset.k]);
  if (act === 'town-archmage') sim.appointArchmage(sim.bById.get(+a.dataset.bid), sim.vById.get(+a.dataset.id));
  if (act === 'town-enrol' && !sim.enrol(sim.vById.get(+(a.dataset.id || document.getElementById('universityApplicant')?.value)), sim.bById.get(+a.dataset.bid))) ui.toast('This student cannot enrol here yet.', 'cap');
  if (act === 'town-unenrol') { const v = sim.vById.get(+a.dataset.id); if (v) sim.unassign(v); }
  if (act === 'town-person' || act === 'town-building') {
    const v = sim.vById.get(+a.dataset.id), b = sim.bById.get(+a.dataset.id);
    ui.closeModal(); if (act === 'town-person' && v) ui.g.select({ kind: 'v', v }, true);
    if (act === 'town-building' && b) ui.g.select({ kind: 'b', b }, true);
  }
  return true;
}

export function townChange(ui, e) {
  const a = e.target, act = a.dataset.act, sim = ui.sim;
  if (!act?.startsWith('town-')) return false;
  if (act === 'town-applicant') { ui.universityApplicant = +a.value; return true; }
  if (act === 'town-government' && !sim.setGovernment(a.value)) ui.toast('Build a Town Hall and appoint an eligible leader first.', 'house');
  if (act === 'town-monarch') sim.setGovernment('monarchy', +a.value);
  if (act === 'town-policy') sim.setPolicy(a.dataset.k, a.checked);
  if (act === 'town-tax') sim.setTax(+a.value / 100);
  if (act === 'town-justice' && sim.townHall()) sim.s.gov.justice = a.value === 'strict' ? 'strict' : 'lenient';
  if (act === 'town-settlement') ui.townSid = a.value;
  ui.drawModal(true); return true;
}

export function seedHtml(ui) {
  ui.newSeed ??= randomSeedText();
  const world = ui.sim.world;
  return `<section class="town-section"><h3>World seed</h3><p>Current map: <b>${esc(world.seedLabel)}</b> · ${world.gen === 1 ? 'Classic valley' : 'Varied valley'}</p><div class="seed-traits">${world.traits.map(t => `<span>${esc(t)}</span>`).join('')}</div>
    <label for="worldSeed">Seed for a new village</label><div class="seed-row"><input id="worldSeed" data-act="seed-input" maxlength="80" value="${esc(ui.newSeed)}" aria-label="World seed"><button class="btn sm" data-act="seed-roll">Re-roll</button><button class="btn sm" data-act="seed-preview">Preview traits</button></div><div id="seedTraits" class="seed-traits">${(ui.seedTraits || []).map(t => `<span>${esc(t)}</span>`).join('')}</div><p>The same seed gives the same starting map. Starting again replaces this village; save a share code first to keep it.</p></section>`;
}
export function seedClick(ui, act) {
  if (!act.startsWith('seed-')) return false;
  ui.newSeed = document.getElementById('worldSeed')?.value ?? ui.newSeed;
  if (act === 'seed-roll') ui.newSeed = randomSeedText();
  if (act === 'seed-preview' || act === 'seed-roll') ui.seedTraits = traitsFor(seedFromText(ui.newSeed));
  return true;
}
