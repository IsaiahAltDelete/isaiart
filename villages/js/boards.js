// The Villagers / Jobs / Buildings boards and the region picker. One compact row
// per villager or building, one toolbar row of filters. Actions: "board-".
import { GOODS, JOBS, SETTLEMENTS } from './data.js';
import { defOf, isDecor, lvlOf, workersOf, stageOf, housingOf } from './sim.js';
import { CENTERS, toWorld } from './world.js';
import { CLASSES, classOf, jobFit, fitLabel, stars } from './rpg.js';
import { RACES } from './society.js';
import { TIERS, JOB_EDU } from './education.js';
import { svg } from './icons.js';
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const selected = (a, b) => a === b ? 'selected' : '';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export function currentRegion(ui) {
  const { tx = 0, tz = 0 } = ui.g?.view?.rig || {}; let best = 'meadow', dist = Infinity;
  for (const sid of Object.keys(ui.sim.s.unlocked)) { const c = CENTERS[sid]; if (!c) continue; const d = Math.hypot(toWorld(c.x) - tx, toWorld(c.z) - tz); if (d < dist) { best = sid; dist = d; } }
  return best;
}
export function boardRegion(ui) { const sid = ui.boardSid || 'current'; return sid === 'current' ? currentRegion(ui) : sid === 'all' ? null : ui.sim.s.unlocked[sid] ? sid : currentRegion(ui); }
export const availableForJob = (sim, v) => stageOf(v) === 'adult' && !v.quest && !(v.jail > sim.s.time) && !(v.ko > 0) && !v.downed;
export function jobCandidates(sim, b) { return sim.s.villagers.filter(v => v.home === b.sid && v.job === 'idle' && availableForJob(sim, v) && sim.canDoJob(v, defOf(b.type).job)).sort((a, c) => jobFit(c, defOf(b.type).job) - jobFit(a, defOf(b.type).job) || a.name.localeCompare(c.name)); }
export function regionSummary(sim, sid) {
  const people = sim.s.villagers.filter(v => v.home === sid), buildings = sim.s.buildings.filter(b => b.sid === sid && !isDecor(b.type));
  return { pop: people.length, beds: buildings.filter(b => b.built).reduce((n, b) => n + housingOf(b), 0), idle: people.filter(v => v.job === 'idle' && availableForJob(sim, v)).length,
    jobs: buildings.filter(b => b.built && defOf(b.type).workers).reduce((n, b) => n + Math.max(0, workersOf(b) - b.workers.length), 0), upgrades: buildings.filter(b => sim.canUpgrade(b).ok).length, buildings: buildings.length };
}
const costChips = (c, s) => Object.entries(c || {}).map(([k, n]) => `<span class="${(s.res[k] || 0) < n ? 'missing' : ''}">${svg(GOODS[k].icon, 12)}${n}</span>`).join('');
// one row of filters: region, a "show" picker, search
function toolbar(ui, type, show = '') {
  const s = ui.sim.s, query = ui.boardQuery?.[type] || '';
  return `<div class="btool"><select data-act="board-region" aria-label="Region"><option value="current" ${selected(ui.boardSid || 'current', 'current')}>${esc(ui.sim.sname(currentRegion(ui)))} (here)</option><option value="all" ${selected(ui.boardSid, 'all')}>All regions</option>${Object.keys(s.unlocked).map(sid => `<option value="${sid}" ${selected(ui.boardSid, sid)}>${esc(ui.sim.sname(sid))}</option>`).join('')}</select>${show}<input type="search" data-act="board-search" data-kind="${type}" value="${esc(query)}" aria-label="Search" placeholder="Search…"></div>`;
}
const queryMatch = (ui, type, text) => text.toLowerCase().includes((ui.boardQuery?.[type] || '').toLowerCase().trim());

export function peopleBoardHtml(ui, face) {
  const sim = ui.sim, s = sim.s, sid = boardRegion(ui), people = s.villagers.filter(v => !sid || v.home === sid), f = ui.peopleStatus || 'all';
  const show = `<select data-act="board-people-status" aria-label="Show">${[['all', 'Everyone'], ['idle', 'Ready for work'], ['working', 'Working'], ['away', 'Away or resting'], ['children', 'Children'], ['hungry', 'Hungry']].map(([k, t]) => `<option value="${k}" ${selected(f, k)}>${t}</option>`).join('')}</select>`;
  const idle = people.filter(v => v.job === 'idle' && availableForJob(sim, v)).length, hungry = people.filter(v => v.hungry).length;
  let h = toolbar(ui, 'villagers', show) + `<div class="bstat">${plural(people.length, 'resident')}${idle ? ` · <b>${idle} ready for work</b>` : ''}${hungry ? ` · <b class="bad">${hungry} hungry</b>` : ''}</div>`;
  const list = people.filter(v => queryMatch(ui, 'villagers', `${v.name} ${JOBS[v.job]?.name || v.job} ${CLASSES[classOf(v)].name} ${RACES[v.race]?.name || ''}`)
    && (f === 'all' || f === 'idle' && v.job === 'idle' && availableForJob(sim, v) || f === 'working' && v.work || f === 'away' && stageOf(v) === 'adult' && !availableForJob(sim, v) || f === 'children' && stageOf(v) === 'child' || f === 'hungry' && v.hungry))
    .sort((a, b) => (a.job !== 'idle') - (b.job !== 'idle') || a.name.localeCompare(b.name));
  h += '<div class="blist">';
  for (const v of list) {
    const st = stageOf(v), status = v.jail > s.time ? 'In the stocks' : v.quest ? 'Adventuring' : v.ko > 0 || v.downed ? 'Recovering' : st === 'child' ? 'Child' : st === 'elder' ? 'Retired' : v.job === 'idle' ? 'Ready' : null;
    h += `<div class="brow" data-key="resident${v.id}">${face(v, 30)}<div class="bmain"><button class="bname" data-act="vsel" data-id="${v.id}">${esc(v.name)}</button><small>${esc(RACES[v.race]?.name || 'Human')} · ${st !== 'child' ? `${esc(CLASSES[classOf(v)].name)} ${v.lvl || 1} · ${esc(TIERS[sim.eduTier(v)].name)}` : `age ${Math.floor(v.age)}`}${v.hungry ? ' · <b class="bad">hungry</b>' : ''}</small></div>
      ${availableForJob(sim, v) ? `<select class="bsel" data-act="job" data-id="${v.id}" aria-label="Job for ${esc(v.name)}">${ui.workOptions(v, true)}</select>` : `<span class="bbadge">${esc(status || JOBS[v.job]?.name || '')}</span>`}</div>`;
  }
  return h + '</div>' + (!list.length ? '<p class="board-empty">Nobody matches.</p>' : '');
}

export function jobsBoardHtml(ui) {
  const sim = ui.sim, sid = boardRegion(ui), jobs = sim.s.buildings.filter(b => b.built && defOf(b.type).workers && (!sid || b.sid === sid));
  const open = jobs.reduce((n, b) => n + Math.max(0, workersOf(b) - b.workers.length), 0);
  const show = `<select data-act="board-open-only" aria-label="Show"><option value="open" ${ui.onlyOpen !== false ? 'selected' : ''}>Open jobs</option><option value="all" ${ui.onlyOpen === false ? 'selected' : ''}>All workplaces</option></select>`;
  let h = toolbar(ui, 'jobs', show) + `<div class="bstat">${plural(open, 'open job')} · ${plural(jobs.length, 'workplace')} · best-suited idle villagers listed first</div><div class="blist">`;
  const list = jobs.filter(b => (ui.onlyOpen === false || b.workers.length < workersOf(b)) && queryMatch(ui, 'jobs', `${sim.homeName(b)} ${JOBS[defOf(b.type).job].name} ${sim.sname(b.sid)}`));
  for (const b of list) {
    const job = defOf(b.type).job, cands = jobCandidates(sim, b), need = JOB_EDU[job] || 0, free = Math.max(0, workersOf(b) - b.workers.length);
    const staff = b.workers.map(id => sim.vById.get(id)).filter(Boolean).map(v => `<button class="mini" data-act="vsel" data-id="${v.id}" data-tip="${esc(v.name)}|${esc(JOBS[v.job]?.name || '')}">${esc(v.name.split(' ')[0])}</button>`).join('');
    h += `<div class="brow" data-key="job${b.id}"><img alt="" src="${ui.g.thumbs[b.type] || ''}"><div class="bmain"><button class="bname" data-act="bsel" data-id="${b.id}">${esc(sim.homeName(b))}</button><small>${esc(JOBS[job].name)} · ${b.workers.length}/${workersOf(b)}${need ? ` · needs ${esc(TIERS[need].name.toLowerCase())}` : ''} ${staff}</small></div>
      ${free ? cands.length ? `<select class="bsel" data-act="board-candidate" data-bid="${b.id}" aria-label="Candidate">${cands.map(v => `<option value="${v.id}" ${selected(ui.jobPicks?.[b.id], v.id)}>${esc(v.name)} ${stars(fitLabel(jobFit(v, job)).n)}</option>`).join('')}</select><button class="btn gold sm" data-act="board-hire" data-bid="${b.id}">Hire</button>` : '<span class="bbadge">No one free</span>' : '<span class="bbadge ok">Full</span>'}</div>`;
  }
  return h + '</div>' + (!list.length ? '<p class="board-empty">No open jobs here. Upgrade a building for more.</p>' : '');
}

export function buildingsBoardHtml(ui) {
  const sim = ui.sim, sid = boardRegion(ui), all = sim.s.buildings.filter(b => !isDecor(b.type) && (!sid || b.sid === sid)), f = ui.buildingStatus || 'all';
  const ready = all.filter(b => sim.canUpgrade(b).ok).length, sites = all.filter(b => !b.built || b.up).length;
  const show = `<select data-act="board-building-status" aria-label="Show">${[['all', 'All buildings'], ['ready', 'Can upgrade'], ['sites', 'Being built'], ['attention', 'Need attention']].map(([k, t]) => `<option value="${k}" ${selected(f, k)}>${t}</option>`).join('')}</select>`;
  let h = toolbar(ui, 'buildings', show) + `<div class="bstat">${plural(all.length, 'building')}${ready ? ` · <b>${ready} can upgrade</b>` : ''}${sites ? ` · ${sites} being built` : ''}</div><div class="blist">`;
  const list = all.filter(b => queryMatch(ui, 'buildings', `${sim.homeName(b)} ${defOf(b.type).name} ${sim.sname(b.sid)}`) && (f === 'all' || f === 'ready' && sim.canUpgrade(b).ok || f === 'sites' && (!b.built || b.up) || f === 'attention' && ['bad', 'warn'].includes(ui.bStatus(b)?.cls)))
    .sort((a, b) => Number(sim.canUpgrade(b).ok) - Number(sim.canUpgrade(a).ok) || sim.homeName(a).localeCompare(sim.homeName(b)));
  for (const b of list) {
    const d = defOf(b.type), st = ui.bStatus(b), ok = sim.canUpgrade(b), L = lvlOf(b), prog = Math.round((b.up?.progress || b.progress || 0) * 100);
    const right = !b.built || b.up ? `<span class="bprog"><i style="width:${prog}%"></i></span><span class="bbadge">${prog}%</span>`
      : L >= 3 ? '<span class="bbadge">Max level</span>'
      : `<span class="bcost">${costChips(sim.upgradeCost(b), sim.s)}</span><button class="btn ${ok.ok ? 'gold' : 'ghost'} sm" data-act="board-upgrade" data-bid="${b.id}" ${ok.ok ? '' : 'disabled'} data-tip="Upgrade to level ${L + 1}|${esc(sim.upgradeEffect(b) || 'A sturdier building')}${ok.ok ? '' : ' · ' + esc(ok.why || '')}">${svg('arrowup', 13)}Lv ${L + 1}</button>`;
    h += `<div class="brow" data-key="building${b.id}"><img alt="" src="${ui.g.thumbs[b.type] || ''}"><div class="bmain"><button class="bname" data-act="bsel" data-id="${b.id}">${esc(b.type === 'campfire' ? sim.sname(b.sid) + ' campfire' : sim.homeName(b))}</button><small>Lv ${L}${d.workers ? ` · ${b.workers.length}/${workersOf(b)} staff` : ''}${st?.text ? ` · <span class="${st.cls === 'bad' ? 'bad' : ''}">${esc(st.text)}</span>` : ''}</small></div>${right}</div>`;
  }
  return h + '</div>' + (!list.length ? '<p class="board-empty">Nothing matches.</p>' : '');
}

export function worldRegionsHtml(ui, rowExtra) {
  const sim = ui.sim, s = sim.s, active = currentRegion(ui);
  return SETTLEMENTS.map(st => {
    const un = s.unlocked[st.id], m = regionSummary(sim, st.id), ok = un || s.level >= st.unlock.lvl && sim.canAfford(st.unlock.cost);
    return `<article class="region-card ${active === st.id && un ? 'active' : ''}"><div class="rc-head"><div><b>${esc(sim.sname(st.id))}</b><small>${un && active === st.id ? 'You are here' : un ? 'Settled' : esc(st.blurb)}</small></div><button class="btn ${un ? 'blue' : ok ? 'gold' : 'ghost'} sm" data-act="${un ? 'travel' : 'settle'}" data-sid="${st.id}" ${ok ? '' : 'disabled'}>${un ? 'Visit' : 'Settle'}</button></div>
      ${un ? `<div class="bstat">${m.pop}/${m.beds} beds · ${plural(m.jobs, 'open job')} · ${m.upgrades} can upgrade · ${esc(sim.safetyOf?.(st.id) || '')} · ${[['villagers', 'Villagers'], ['jobs', 'Jobs'], ['buildings', 'Buildings']].map(([k, t]) => `<button class="mini" data-act="board-open-region" data-sid="${st.id}" data-panel="${k}">${t}</button>`).join('')}</div>` : `<div class="bstat">Level ${st.unlock.lvl} · <span class="bcost">${costChips(st.unlock.cost, s)}</span></div>`}${rowExtra(ui, st.id)}</article>`;
  }).join('');
}

export function boardsInit(ui) {
  const style = document.createElement('style'); style.textContent = `
.btool{display:flex;gap:6px;margin:0 0 8px}.btool select,.btool input{min-width:0;flex:1;margin:0;font-size:13px}.btool input{padding:7px 10px;border:1px solid #ceb27d;border-radius:8px;background:#fffaf0;color:var(--ink)}
.bstat{font-size:12px;color:var(--ink2);margin:2px 0 8px}.bstat b{color:var(--ink)}.bad{color:#b0412c}
.blist{display:flex;flex-direction:column;border:1px solid #e3cf9f;border-radius:12px;overflow:hidden;background:#fffaf0}
.brow{display:flex;align-items:center;gap:10px;padding:6px 10px;border-top:1px solid #efe1bd;min-height:44px}.brow:first-child{border-top:0}.brow:hover{background:#fff4dc}
.brow>img{width:36px;height:32px;object-fit:contain;flex:none}.brow .face{flex:none}
.bmain{flex:1;min-width:0}.bmain small{display:block;font-size:11.5px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bname{border:0;background:none;padding:0;text-align:left;color:var(--ink);font:inherit;font-weight:700;font-size:13.5px;cursor:pointer}.bname:hover{text-decoration:underline}
.bsel{width:190px;flex:none;font-size:12px;margin:0}.bbadge{flex:none;font-size:11.5px;padding:3px 8px;border-radius:8px;background:#efe2be}.bbadge.ok{background:#dbedc6;color:#335a29}
.bcost{display:inline-flex;gap:6px;font-size:11.5px;flex:none}.bcost span{display:inline-flex;align-items:center;gap:2px}.bcost .missing{color:#b0412c;font-weight:700}
.bprog{width:70px;height:7px;border-radius:4px;background:#eadcb6;overflow:hidden;flex:none}.bprog i{display:block;height:100%;background:#7fbf55}
.mini{border:0;background:#efe2be;border-radius:7px;font:inherit;font-size:11px;padding:1px 6px;margin-left:2px;cursor:pointer;color:var(--ink)}
.board-empty{text-align:center;padding:20px;font-size:13px;color:var(--ink2)}
.region-card{border:1px solid #e3cf9f;border-radius:12px;padding:10px 12px;background:#fffaf0;margin-bottom:8px}.region-card.active{border-color:#6d9a4c;background:#f4f6e5}.rc-head{display:flex;align-items:center;gap:10px}.rc-head>div{flex:1}.rc-head small{display:block;font-size:11.5px;color:var(--ink2)}
#regionQuick{position:fixed;left:12px;bottom:83px;z-index:5;display:flex;gap:6px;align-items:center;background:#fff5db;border:2px solid #caa064;border-radius:12px;padding:5px;box-shadow:0 2px 6px #50361f30}#regionQuick select{max-width:170px;font-size:12px;margin:0}#regionQuick button{font-size:12px;padding:6px}.placing #regionQuick,body.info-open #regionQuick,body:has(#modal:not(.hidden)) #regionQuick{display:none}
#pFace{max-width:95px;white-space:normal;font-size:11px}#pFace[aria-pressed=true]{background:#dbedc6;border-color:#6d9a4c}
@media(max-width:600px){.brow{flex-wrap:wrap}.bmain{flex:1 1 140px}.bsel{flex:1 1 60%;width:auto}#regionQuick{bottom:80px;max-width:calc(100vw - 32px)}.seg button{padding:7px!important;font-size:12px!important}.seg small{display:none}}
`; document.head.appendChild(style);
  const bar = document.createElement('div'); bar.id = 'regionQuick'; bar.setAttribute('aria-label', 'Current region'); bar.innerHTML = '<select id="regionSelect" aria-label="Visit region"></select><button class="btn ghost sm" aria-label="Region overview">Regions</button>'; document.body.appendChild(bar);
  bar.querySelector('select').onchange = e => { ui.boardSid = e.target.value; ui.g.flyToSettlement(e.target.value); };
  bar.querySelector('button').onclick = () => ui.openModal('worldmap');
  const search = e => { if (e.target.dataset.act !== 'board-search') return; (ui.boardQuery ||= {})[e.target.dataset.kind] = e.target.value; ui.drawModal(true); };
  document.getElementById('modal').addEventListener('input', search);
  const button = document.createElement('button'); button.id = 'pFace'; button.className = 'btn sm'; button.textContent = 'Face camera'; button.setAttribute('aria-label', 'Face camera'); button.dataset.tip = 'Face camera|The front follows your viewing direction. Rotate switches to manual placement.'; button.onclick = () => ui.g.facePlaceToViewer(); document.getElementById('pRot').after(button);
}
export function boardsFrame(ui) {
  const select = document.getElementById('regionSelect'); if (!select || select === document.activeElement) return;
  const unlocked = Object.keys(ui.sim.s.unlocked);
  // one village needs no picker
  document.getElementById('regionQuick').classList.toggle('hidden', unlocked.length < 2);
  const active = currentRegion(ui), markup = unlocked.map(sid => `<option value="${sid}" ${selected(active, sid)}>${esc(ui.sim.sname(sid))} · ${ui.sim.s.villagers.filter(v => v.home === sid).length}</option>`).join('');
  if (markup !== ui.regionMarkup) { ui.regionMarkup = markup; select.innerHTML = markup; }
}
export function boardChange(ui, e) {
  const t = e.target, act = t.dataset.act; if (!act?.startsWith('board-')) return false;
  if (act === 'board-region') ui.boardSid = t.value;
  if (act === 'board-people-status') ui.peopleStatus = t.value;
  if (act === 'board-building-status') ui.buildingStatus = t.value;
  if (act === 'board-open-only') ui.onlyOpen = t.value !== 'all';
  if (act === 'board-candidate') { (ui.jobPicks ||= {})[t.dataset.bid] = +t.value; return true; }
  if (act === 'board-search') return true;
  ui.drawModal(true); return true;
}
export function boardClick(ui, act, a) {
  if (!act.startsWith('board-')) return false;
  const sim = ui.sim;
  if (act === 'board-open-region') { ui.boardSid = a.dataset.sid; ui.openModal(a.dataset.panel); return true; }
  if (act === 'board-upgrade') { const b = sim.bById.get(+a.dataset.bid); if (b && !sim.upgrade(b)) ui.toast(sim.canUpgrade(b).why || 'This building cannot be upgraded yet.', 'house'); }
  if (act === 'board-hire') {
    const b = sim.bById.get(+a.dataset.bid), cands = b ? jobCandidates(sim, b) : [], pick = ui.jobPicks?.[b?.id], v = pick ? cands.find(v => v.id === pick) : cands[0];
    if (!b || !v || !sim.assign(b, v)) ui.toast('That candidate or position is no longer available.', 'person'); else { delete ui.jobPicks?.[b.id]; ui.toast(`${v.name} now works at ${sim.homeName(b)}.`, 'people'); }
  }
  if (act === 'board-upgrade' || act === 'board-hire') ui.drawModal(true);
  return true;
}
