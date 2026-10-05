// The panels for wishes, pets, weddings, the town's rank, the chronicle and visitors:
// the wish card on a villager's panel, the open wishes on the Story page, the rank
// card in the Town panel (and a row in the quest panel), the Chronicle tab in the
// Journal, and the visitor / wedding rows in the banner under the resource bar.
import { svg } from './icons.js';
import { DAY, stageOf } from './sim.js';
import { GOODS } from './data.js';
let sfx = {};   // handed over by ui.js (audio.js needs a browser, and the tests load this file)
import { WISHES, PET_COST } from './wishes.js';
import { RANKS, mainSid } from './celebrations.js';
import { VISITORS } from './visitors.js';

const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const first = n => String(n).split(' ')[0];
const left = (sim, until) => { const d = (until - sim.s.time) / DAY; return d >= 1 ? `${Math.round(d)} day${Math.round(d) > 1 ? 's' : ''}` : d * 24 >= 1 ? `${Math.round(d * 24)} hours` : 'soon'; };

export function lifeInit(ui, audio) {
  sfx = audio || {};
  ui.lifeRows = () => lifeRows(ui);
  ui.lifeClick = (act, a) => { lifeClick(ui, act, a); if (ui.g.selected) ui.drawInfo(true); if (ui.modal) ui.drawModal(true); ui.dirty.res = true; };
  const st = document.createElement('style');
  st.textContent = `.ip-sec.wishcard{background:#fffbe8;border-color:#e8c860}.wishcard .wtext{font-weight:700;font-size:13.5px;color:var(--ink);margin:0 0 3px}.wishcard .desc{font-size:12px;color:var(--ink2);line-height:1.4;margin-bottom:6px}.wishcard .wbtns{display:flex;gap:6px;flex-wrap:wrap}.wishcard .wbtns .btn{flex:1}
.petrow{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12.5px;color:var(--ink2)}.petrow .btn{margin-left:auto}
.vchip.pet{background:#fff3e0;border-color:#e0b070}
.wishlist{margin:0 0 12px;padding:8px 10px;border-radius:14px;background:#fffbe8;border:2px solid #e8c860}.wishlist h4{margin:0 0 6px;font-size:13px;display:flex;align-items:center;gap:6px}.wishlist .wrow{display:flex;align-items:center;gap:8px;padding:4px 0;border-top:1px dashed #ecd8a0;font-size:12.5px}.wishlist .wrow:first-of-type{border-top:0}.wishlist .wrow span{flex:1;min-width:0;line-height:1.35}.wishlist .wrow small{display:block;color:var(--ink2);font-size:11.5px}.wishlist .sface{flex:none}
.rankcard .rk{display:flex;align-items:center;gap:10px;margin-bottom:8px}.rankcard .rk b{font-size:17px;display:block}.rankcard .rk small{color:var(--ink2);font-size:12px}.rankcard .steps{display:flex;gap:4px;margin:0 0 8px}.rankcard .steps i{flex:1;height:6px;border-radius:3px;background:#eadcb6}.rankcard .steps i.on{background:#c8453a}
.rgoals{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px}.rgoal{font-size:12px;display:flex;flex-direction:column;gap:2px}.rgoal span{display:flex;justify-content:space-between;gap:6px}.rgoal span b{font-weight:inherit;display:flex;align-items:center;gap:3px}.rgoal span em{font-style:normal;color:var(--ink2)}.rgoal.done span{color:#3f7a39;font-weight:700}.rgoal .bar{height:5px;border-radius:3px;background:#eadcb6;overflow:hidden}.rgoal .bar i{display:block;height:100%;background:#d9a43a}.rgoal.done .bar i{background:#5cae4a}
@media(max-width:520px){.rgoals{grid-template-columns:1fr}}
.chron{margin:0 0 14px;padding:14px 16px 12px;border-radius:6px;background:#f8ecd0;border:2px solid #b98c4f;box-shadow:inset 0 0 0 4px #f8ecd0,inset 0 0 0 5px #d8b780,0 3px 8px rgba(90,60,20,.18);font-family:Georgia,'Times New Roman',serif;color:#4a3218}
.chron h3{margin:0;text-align:center;font-size:19px;letter-spacing:.02em}.chron .yr{text-align:center;font-style:italic;color:#7a5a30;margin:2px 0 10px;font-size:14px}
.chron .nums{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 14px;padding:8px 0;border-top:1px solid #d8b780;border-bottom:1px solid #d8b780;margin-bottom:8px;font-family:Fredoka,system-ui,sans-serif;font-size:12.5px}.chron .nums span{display:flex;align-items:center;gap:4px}
.chron .head{display:flex;gap:8px;align-items:flex-start;padding:5px 0;font-size:13.5px;line-height:1.45}.chron .head .when{flex:none;font-size:11px;color:#8a6a40;width:44px;padding-top:2px;font-family:Fredoka,system-ui,sans-serif}.chron .head .fc{display:flex;flex:none}.chron .head .fc svg{margin-right:-8px}
.chron.mini{padding:8px 12px;cursor:pointer}.chron.mini h3{font-size:15px;text-align:left}.chron.mini .yr{text-align:left;margin:0}.chron.sofar{background:#fbf4e2;border-style:dashed}
.chron .end{text-align:center;color:#8a6a40;font-size:12px;margin-top:6px;font-style:italic}
.quest.qrank .t{display:flex;align-items:center;gap:5px}`;
  document.head.appendChild(st);
}

// ── wishes and pets on a villager's panel ──
export function wishVillagerHtml(ui, v) {
  const sim = ui.sim, w = v.wish;
  if (!w || w.until < sim.s.time) return '';
  const W = WISHES[w.kind]; if (!W) return '';
  const btns = wishButtons(ui, v, false);
  return `<div class="ip-sec wishcard"><div class="cap">${svg('wish', 14)} ${esc(first(v.name))} wishes for<span class="r">fades in ${left(sim, w.until)}</span></div>
    <div class="wtext">${esc(W.text(v, w, sim))}</div><div class="desc">${esc(W.how)}</div>${btns ? `<div class="wbtns">${btns}</div>` : ''}</div>`;
}
// the one-tap answer to a wish (short labels in the Story page's list)
function wishButtons(ui, v, short) {
  const sim = ui.sim, w = v.wish, W = WISHES[w.kind];
  let btns = '';
  if (W.act === 'pet' && short) btns = `<button class="btn gold sm" data-act="lv-adopt" data-id="${v.id}" ${sim.s.res.coins < PET_COST ? 'disabled' : ''}>${svg('paw', 14)} Adopt · ${PET_COST}${svg('coin', 12)}</button>`;
  else if (W.act === 'pet') btns = ['cat', 'dog'].map(k => `<button class="btn gold sm" data-act="lv-adopt" data-id="${v.id}" data-k="${k}" ${sim.s.res.coins < PET_COST ? 'disabled' : ''}>${svg('paw', 14)} Adopt a ${k} · ${PET_COST}${svg('coin', 12)}</button>`).join('');
  else if (W.act === 'treat') { const g = w.data.good, have = sim.s.res[g] || 0; btns = `<button class="btn gold sm" data-act="lv-wish" data-id="${v.id}" ${have < 1 ? 'disabled' : ''}>${svg(GOODS[g]?.icon || 'gift', 14)} ${have < 1 ? `No ${esc(GOODS[g]?.name.toLowerCase())} in store` : `Give 1 ${esc(GOODS[g]?.name.toLowerCase())}`}</button>`; }
  else if (W.act === 'picnic') btns = `<button class="btn gold sm" data-act="lv-wish" data-id="${v.id}" ${(sim.s.res.food || 0) < 10 ? 'disabled' : ''}>${svg('heart', 14)} Arrange a picnic · 10 food</button>`;
  else if (W.act) btns = `<button class="btn gold sm" data-act="lv-wish" data-id="${v.id}">${svg('check', 14)} ${esc(short ? 'Grant' : W.actLabel)}</button>`;
  if (short) btns = btns.replace(/ Give 1 [a-z ]+</, ' Give<').replace(' Arrange a picnic · 10 food', ' Picnic · 10 food');
  return btns;
}
export function petChip(ui, v) {
  const p = ui.sim.petOf?.(v); if (!p) return '';
  return `<span class="vchip pet" data-tip="${esc(p.name)} the ${p.kind}|Follows ${esc(first(v.name))} everywhere. Every pet cheers the whole village a little.">${svg('paw', 13)}${esc(p.name)}</span>`;
}
// a small row under friends: adopt a pet for anyone without one
export function petRowHtml(ui, v) {
  const sim = ui.sim, p = sim.petOf?.(v);
  if (p) return `<div class="petrow">${svg('paw', 16)}<span><b>${esc(p.name)}</b> the ${p.kind} is never far behind.</span></div>`;
  return `<div class="petrow">${svg('paw', 16)}<span>No pet yet.</span><button class="btn sm" data-act="lv-adopt" data-id="${v.id}" ${sim.s.res.coins < PET_COST ? 'disabled' : ''} data-tip="Adopt a pet|A cat or a dog that follows ${esc(first(v.name))} about. ${PET_COST} coins.">Adopt · ${PET_COST}${svg('coin', 12)}</button></div>`;
}
// the open wishes, at the top of the Story page
export function wishListHtml(ui) {
  const sim = ui.sim, open = sim.openWishes?.() || [];
  if (!open.length) return '';
  return `<div class="wishlist"><h4>${svg('wish', 18)} Wishes · ${open.length}<small style="font-weight:400;color:var(--ink2);margin-left:auto">granting one lifts the whole village</small></h4>${open.map(v => {
    const W = WISHES[v.wish.kind];
    return `<div class="wrow"><button class="sface" data-act="vsel" data-id="${v.id}" data-tip="${esc(v.name)}|Tap to visit">${ui.face(v, 30)}</button><span><b>${esc(first(v.name))}</b> wishes for ${esc(W.text(v, v.wish, sim))}<small>${esc(W.how)}</small></span>${wishButtons(ui, v, true)}</div>`;
  }).join('')}</div>`;
}

// ── the town's rank ──
export function rankHtml(ui) {
  const sim = ui.sim, s = sim.s, R = sim.rankOf?.(); if (!R) return '';
  const nx = sim.nextRank(), goals = sim.rankGoals(), name = sim.sname(mainSid(sim));
  let h = `<section class="town-section rankcard"><div class="rk">${svg('crest', 36)}<div><b>${esc(name)} · ${esc(R.name)}</b><small>${nx ? `${goals.filter(g => g.done).length} of ${goals.length} goals to become a ${esc(nx.name)} · +${nx.gems} gems` : 'A City! The crest banner flies over the square.'}</small></div></div>`;
  h += `<div class="steps">${RANKS.slice(1).map((r, i) => `<i class="${i < (s.rank || 0) ? 'on' : ''}" data-tip="${esc(r.name)}|${i < (s.rank || 0) ? 'Reached!' : 'Not yet'}"></i>`).join('')}</div>`;
  if (nx) h += `<div class="rgoals">${goals.map(g => `<div class="rgoal${g.done ? ' done' : ''}"${g.tip ? ` data-tip="${esc(g.text)}|${esc(g.tip)}"` : ''}><span><b>${g.done ? svg('check', 12) : ''}${esc(g.text)}</b><em>${g.n > 1 ? `${Math.min(g.have, g.n)}/${g.n}` : g.done ? '' : '—'}</em></span><div class="bar"><i style="width:${Math.min(1, g.have / g.n) * 100}%"></i></div></div>`).join('')}</div>`;
  return h + '</section>';
}
export function rankQuestRow(ui) {
  const sim = ui.sim, nx = sim.nextRank?.(); if (!nx) return '';
  const goals = sim.rankGoals(), d = goals.filter(g => g.done).length;
  return `<div class="quest qrank" data-key="rank"><div class="row"><span class="t">${svg('crest', 15)}Become a ${esc(nx.name)}</span><span class="qmeta">${d}/${goals.length}</span><button class="go" data-rank aria-label="Town goals" data-tip="Town goals|See what ${esc(sim.sname(mainSid(sim)))} needs to become a ${esc(nx.name)}.">${svg('target', 16)}</button></div><div class="qbar"><div class="bar"><i style="width:${d / goals.length * 100}%"></i></div><div class="rw"><span>${svg('gem', 12)}${nx.gems}</span></div></div></div>`;
}

// ── the chronicle ──
function chronCard(ui, c, full) {
  const N = c.nums, row = (icon, t) => `<span>${svg(icon, 15)}${t}</span>`;
  const nums = [row('people', `${N.pop[0]} → ${N.pop[1]} villagers`), N.births ? row('baby', `${N.births} born`) : '', N.weddings ? row('rings', `${N.weddings} wedding${N.weddings > 1 ? 's' : ''}`) : '',
    N.wishes ? row('wish', `${N.wishes} wish${N.wishes > 1 ? 'es' : ''} granted`) : '', N.built ? row('hammer', `${N.built} built`) : '', N.festivals ? row('party', `${N.festivals} festival${N.festivals > 1 ? 's' : ''}`) : '',
    N.hard ? row('storm', `${N.hard} hard time${N.hard > 1 ? 's' : ''}`) : '', N.rank ? row('crest', `became a ${N.rank}`) : ''].join('');
  if (!full) return `<div class="chron mini" data-act="lv-chron" data-i="${c.year}"><h3>Year ${c.year}: ${esc(c.title[0].toUpperCase() + c.title.slice(1))}</h3><div class="yr">${N.pop[1]} villagers${N.weddings ? ` · ${N.weddings} wedding${N.weddings > 1 ? 's' : ''}` : ''}${N.births ? ` · ${N.births} born` : ''} · tap to read</div></div>`;
  const heads = c.heads.map(e => `<div class="head"><span class="when">Day ${e.day}</span>${e.faces.length ? `<span class="fc">${e.faces.slice(0, 2).map(f => ui.face(f, 26)).join('')}</span>` : `<span class="fc">${svg(e.icon, 22)}</span>`}<span>${esc(e.text)}</span></div>`).join('');
  return `<div class="chron${c.partial ? ' sofar' : ''}"><h3>The Chronicle of ${esc(c.name)}</h3><div class="yr">Year ${c.year}${c.partial ? ', so far' : ''} · ${esc(c.title)}</div><div class="nums">${nums}</div>${heads || '<div class="end">A quiet year. The kettle was always on.</div>'}${c.partial ? '<div class="end">The year ends on day ' + c.year * 12 + '. The full chronicle is written then.</div>' : '<div class="end">~ here ends the year ~</div>'}</div>`;
}
export function chronicleHtml(ui) {
  const sim = ui.sim, s = sim.s, list = s.chronicles || [];
  s.chronNew = 0; ui.markLog?.();
  const open = ui.chronOpen ?? list[0]?.year;
  let h = '';
  for (const c of list) h += chronCard(ui, c, c.year === open);
  if (open === 'now' || !list.length) h += chronCard(ui, sim.compileYear(s.chron.year, true), true);
  else h += `<button class="btn sm" style="width:100%" data-act="lv-chron" data-i="now">${svg('scroll', 14)} This year so far</button>`;
  return h;
}

// ── visitors and weddings in the banner ──
function lifeRows(ui) {
  const sim = ui.sim, s = sim.s, rows = [], c = s.visitors?.cur;
  if (c && !c.answered && !c.leaving) {
    const D = VISITORS[c.kind];
    const poor = D.fee && s.res.coins < D.fee;
    rows.push(`<div class="evrow visitor">${svg(D.icon, 22)}<b>${esc(D.name)}</b><span data-tip="${esc(D.name)}|${esc(D.ask(c))} ${esc(D.tip(c))}"><strong>${esc(D.brief(c))}</strong></span><button class="btn gold sm" data-act="lv-yes" ${poor ? `disabled data-tip="Not enough coins|Needs ${D.fee} coins."` : `data-tip="${esc(D.yes)}|${esc(D.tip(c))}"`}>${esc(D.yes)}${D.fee ? svg('coin', 12) : ''}</button><button class="btn sm" data-act="lv-no">${esc(D.no)}</button><button class="btn sm" data-act="lv-vgo" aria-label="Show">Show</button></div>`);
  }
  for (const w of s.weddings || []) if (w.on) {
    const a = sim.vById.get(w.a), b = sim.vById.get(w.b); if (!a || !b) continue;
    rows.push(`<div class="evrow wedding">${svg('rings', 22)}<b>A wedding!</b><span><strong>${esc(first(a.name))} &amp; ${esc(first(b.name))}</strong> are getting married at the campfire · ${w.guests.length - 2} guests</span><button class="btn sm" data-act="lv-wgo" data-sid="${w.sid}">Watch</button></div>`);
  }
  return rows;
}

export function lifeClick(ui, act, a) {
  const sim = ui.sim, s = sim.s, v = sim.vById.get(+a.dataset.id);
  if (act === 'lv-yes' || act === 'lv-no') {
    const r = sim.answerVisitor(act === 'lv-yes');
    if (!r.ok) ui.toast(r.why, 'coin'); else sfx[act === 'lv-yes' ? 'coin' : 'click']?.();
    return true;
  }
  if (act === 'lv-vgo') { const p = sim.visitorPos?.(); if (p) ui.g.view.flyTo(p.x, p.z, Math.min(ui.g.view.rig.dist, 16), 0.7); return true; }
  if (act === 'lv-wgo') { const f = s.buildings.find(b => b.type === 'campfire' && b.sid === a.dataset.sid); if (f) { const c = sim.bCenter(f); ui.g.follow?.(null); ui.g.view.flyTo(c.x, c.z + 2, 9, 0.8); } return true; }
  if (act === 'lv-adopt' && v) {
    const p = sim.adoptPet(v, a.dataset.k || null);
    if (p) { ui.toast(`${first(v.name)} adopted ${p.name} the ${p.kind}!`, 'paw'); sfx.done?.(); } else ui.toast(`Adopting costs ${PET_COST} coins.`, 'coin');
    return true;
  }
  if (act === 'lv-wish' && v) {
    const r = sim.answerWish(v, WISHES[v.wish?.kind]?.act);
    if (!r.ok) ui.toast(r.why || 'Not yet', 'wish');
    return true;
  }
  if (act === 'lv-chron') { ui.chronOpen = a.dataset.i === 'now' ? 'now' : +a.dataset.i; sfx.click?.(); return true; }
  return false;
}
