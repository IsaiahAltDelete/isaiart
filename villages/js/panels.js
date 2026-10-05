// UI for round 7: settlement stores and specialties, trade routes and carts,
// building-site deliveries, friendships, the festival quests and shop, roads in
// the build tray, and share codes. ui.js calls these at a few marked points;
// actions are prefixed "r7-".
import { svg } from './icons.js';
import { GOODS, DECOR, SETTLEMENTS, FESTIVALS, FESTIVE, SEASONS, SEASON_DAYS, JOBS } from './data.js';
import { defOf, lvlOf, DAY } from './sim.js';
import { heartsOf } from './social.js';
import { cartCapacity } from './trade.js';
import { roadCounts, BRIDGE_PLANKS } from './roads.js';
import { encodeSave, decodeSave, describeSave, copyText, BACKUP_KEY } from './share.js';
import { sfx } from './audio.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(Math.floor(n));
const SAVE_KEY = 'isaiart.villages.v1';
const KEY_GOODS = ['wood', 'planks', 'stone', 'bricks', 'food', 'grain'];
export const R7_MODALS = { trade: ['wood', 'Trade & Stores'], festival: ['party', 'Festival'], share: ['star', 'Share your village'] };
export const R7_LIVE = ['trade', 'festival'];
const ALL_FESTIVE = Object.values(FESTIVE).flat();
const hearts = n => `<span class="r7hearts" aria-label="${n} hearts">${[0, 1, 2].map(k => svg('heart', 12).replace('<svg', `<svg class="${k < n ? 'on' : 'off'}"`)).join('')}</span>`;
const specOf = sid => SETTLEMENTS.find(o => o.id === sid)?.spec;
export const specChip = sid => { const sp = specOf(sid); return sp ? `<span class="r7spec" data-tip="${esc(sp.name)} specialty|${esc(sp.desc)}" data-tiptap>${svg(sp.icon, 13)}${esc(sp.name)}</span>` : ''; };

// ── one-time setup: styles, the festival button ──
export function r7Init(ui) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const b = document.createElement('button');
  b.className = 'round hidden'; b.id = 'btnFest'; b.setAttribute('aria-label', 'Festival quests and shop');
  b.dataset.tip = 'Festival|Festival quests pay tokens; spend them on seasonal decorations at the festival shop.';
  b.onclick = () => ui.openModal('festival');
  const tr = document.getElementById('topright'); tr.insertBefore(b, document.getElementById('btnLog'));
  ui.r7share = { code: '', status: '', confirm: null, err: '' };
}

// twice a second
export function r7Frame(ui) {
  const sim = ui.sim, fs = sim.festShop, b = document.getElementById('btnFest');
  if (b && fs) {
    const open = fs.open(), ready = open ? fs.quests().filter(q => q.done && !q.claimed).length : 0, key = `${open}|${ready}`;
    if (b.dataset.k !== key) { b.dataset.k = key; b.classList.toggle('hidden', !open); b.innerHTML = svg('party', 24) + (ready ? `<span class="badge">${ready}</span>` : ''); }
  }
  if (sim.s.stockNote) {
    sim.s.stockNote = false;
    setTimeout(() => ui.toast('Each settlement now keeps its own store. Build a Trade Post to haul goods between them.', 'wood', true), 2500);
  }
}

// ── quest panel: festival quests on top ──
export function r7QuestsHtml(ui) {
  const fs = ui.sim.festShop; if (!fs?.open()) return '';
  const f = fs.current();
  return `<div class="quest r7fq"><div class="row"><span class="t">${svg('party', 14)} ${esc(f.name)}</span><button class="go" data-fest aria-label="Festival shop" data-tip="Festival shop|Spend festival tokens on seasonal decorations.">${svg('shop', 16)}</button></div></div>` +
    fs.quests().map(q => `<div class="quest r7fq ${q.done ? 'done' : ''}">
      <div class="row"><span class="t">${svg(q.icon, 13)} ${esc(q.title)}</span>${q.claimed ? `<span class="r7got">${svg('check', 12)}</span>` : q.done ? `<button class="btn sm gold claim" data-fclaim="${q.id}">Claim</button>` : `<span style="font-size:11px;color:var(--ink2)">${fmt(q.p)}/${fmt(q.n)}</span>`}</div>
      <div class="bar"><i style="width:${q.p / q.n * 100}%"></i></div>
      <div class="rw"><span>${svg('party', 12)}${q.tokens} tokens</span></div></div>`).join('');
}

// ── resource tooltip: where the goods are ──
export function r7GoodHtml(ui, k) {
  const sim = ui.sim, T = sim.trade; if (!T || !GOODS[k]?.capped) return '';
  const sids = Object.keys(sim.s.unlocked); if (sids.length < 2) return '';
  const tr = T.transit(k);
  return `<div class="gi-row"><em>Stores</em>${sids.map(sid => `${esc(sim.sname(sid))} ${fmt(T.get(sid, k))}/${T.cap(sid)}`).join(' · ')}${tr >= 1 ? ` · on carts ${fmt(tr)}` : ''}</div>`;
}

// ── world map rows ──
export function r7WorldRow(ui, sid) {
  const sim = ui.sim, T = sim.trade;
  let h = specChip(sid);
  if (T && sim.s.unlocked[sid]) h += `<span class="r7stockline">${KEY_GOODS.slice(0, 4).map(k => `${svg(GOODS[k].icon, 12)}${fmt(T.get(sid, k))}`).join('')}</span>`;
  if (sid === 'isle' && !sim.s.unlocked.isle) h += `<span class="r7note">Reached by the ferry from the lake shore.</span>`;
  return h;
}

// ── building panel additions ──
export function r7SiteHtml(ui, b) {
  if (!b.await?.length) return '';
  const sim = ui.sim, carts = sim.s.trade?.carts || [];
  const rows = b.await.map(e => {
    const c = carts.find(o => o.id === e.cart);
    return `<div class="r7await">${svg(GOODS[e.res].icon, 16)}<b>${e.n}</b> ${esc(GOODS[e.res].name.toLowerCase())} from ${esc(sim.sname(e.from))}<span>${c ? esc(sim.trade.describe(c)) : 'Waiting for a free cart'}</span></div>`;
  }).join('');
  return `<div class="ip-sec r7wait"><div class="cap">${svg('wood', 14)} Waiting for materials</div>${rows}
    <div class="desc">These were paid from another settlement's store, so a cart is bringing them along the roads. Builders start once they arrive. Keep stock in each village (or run trade routes) to build faster.</div></div>`;
}
export function r7BuildingHtml(ui, b) {
  const sim = ui.sim, s = sim.s, T = sim.trade;
  let h = '';
  if (b.type === 'campfire' && T) {
    const sid = b.sid, cap = T.cap(sid), sp = specOf(sid);
    const goods = T.PHYS.filter(k => KEY_GOODS.includes(k) || T.get(sid, k) >= 1);
    h += `<div class="ip-sec"><div class="cap">${svg('bag', 14)} ${esc(sim.sname(sid))} store<span class="r">${cap} per good</span></div>
      <div class="r7store">${goods.map(k => { const n = T.get(sid, k), full = n >= cap - 0.5; return `<span class="${full ? 'full' : n < 1 ? 'zero' : ''}" data-tip="${esc(GOODS[k].name)}|${fmt(n)} of ${cap} in ${esc(sim.sname(sid))}'s store${full ? '. Full: workers here stop bringing more until it is hauled away or a Storehouse is built.' : '.'}">${svg(GOODS[k].icon, 16)}${fmt(n)}</span>`; }).join('')}</div>
      <div class="desc">Goods made here go into this store. Workshops here use only what's in it. ${Object.keys(s.unlocked).length > 1 ? '<a href="#" data-act="r7-trade">Trade routes ›</a>' : ''}</div></div>`;
    if (sp) h += `<div class="synbox">${svg(sp.icon, 14)}<span><b>${esc(sp.name)} specialty.</b> ${esc(sp.desc)}</span></div>`;
  }
  if (b.type === 'tradepost' && b.built && T) {
    const mine = T.carts().filter(c => c.home === b.id), routes = T.rules().filter(r => r.from === b.sid || r.to === b.sid);
    h += `<div class="ip-sec"><div class="cap">${svg('wood', 14)} Carts<span class="r">${mine.length} · ${cartCapacity(lvlOf(b))} a load</span></div>
      ${mine.map(c => `<div class="r7cart"><span class="dot ${c.state === 'idle' ? 'off' : 'ok'}"></span>${esc(T.describe(c))}</div>`).join('') || '<div class="desc">The cart is being built.</div>'}
      <div class="desc">${routes.length ? `${routes.length} trade route${routes.length > 1 ? 's' : ''} through ${esc(sim.sname(b.sid))}.` : 'No trade routes yet. Set one up to move surplus goods between villages.'} Carts keep to the roads where they can.</div>
      <button class="btn sm" style="width:100%;margin-top:6px" data-act="r7-trade">${svg('map', 14)} Trade routes &amp; stores</button></div>`;
  }
  return h;
}

// ── villager panel: friends ──
export function r7VillagerHtml(ui, v) {
  const sim = ui.sim; if (!sim.friendsOf) return '';
  const list = sim.friendsOf(v).slice(0, 4), rivals = (sim.rivalsOf?.(v) || []).slice(0, 3);
  const rv = rivals.length ? `<div class="r7rivals">${svg('storm', 13)} Rivals: ${rivals.map(r => `<a href="#" data-act="selv" data-id="${r.v.id}">${esc(r.v.name.split(' ')[0])}</a>`).join(', ')}</div>` : '';
  const visit = v.task?.label?.startsWith('Visiting') ? `<div class="desc">${svg('heart', 12)} ${esc(v.task.label)} this evening.</div>` : '';
  if (!list.length) return `<div class="ip-sec"><div class="cap">${svg('heart', 14)} Friends</div><div class="desc">No close friends yet. Working, resting and dancing together brings villagers closer.</div>${rv}${visit}</div>`;
  return `<div class="ip-sec"><div class="cap">${svg('heart', 14)} Friends<span class="r" data-tip="Friendship|Villagers grow closer working, resting and dancing together, and visit good friends in the evening. Friendships make the whole village happier.">?</span></div>
    ${list.map(f => `<div class="r7friend"><a href="#" data-act="selv" data-id="${f.v.id}">${esc(f.v.name)}</a>${hearts(f.hearts)}<small>${f.hearts === 3 ? 'best friends' : f.hearts === 2 ? 'good friends' : f.hearts === 1 ? 'friends' : 'getting to know'}</small></div>`).join('')}${rv}${visit}</div>`;
}

// ── modals ──
export function r7ModalHtml(ui, k) {
  if (k === 'trade') return tradeHtml(ui);
  if (k === 'festival') return festHtml(ui);
  if (k === 'share') return shareHtml(ui);
  return '';
}
function tradeHtml(ui) {
  const sim = ui.sim, s = sim.s, T = sim.trade, sids = Object.keys(s.unlocked);
  const posts = s.buildings.filter(b => b.type === 'tradepost' && b.built).length, carts = T.carts(), rc = roadCounts(sim.world);
  let h = `<div class="summary tight"><span class="chip" data-tip="@stat" data-t="Trade posts" data-b="Each Trade Post keeps a cart (one more per upgrade level). Carts run your trade routes and bring building materials.">${svg('house', 16)}${posts} trade post${posts === 1 ? '' : 's'}</span>
    <span class="chip" data-tip="@stat" data-t="Carts" data-b="Busy / all carts. Porters with hand carts haul building materials even without a Trade Post.">${svg('wood', 16)}${carts.filter(c => c.state !== 'idle').length}/${carts.length} carts busy</span>
    <span class="chip" data-tip="@stat" data-t="Roads" data-b="Road tiles you've laid (dirt, cobbled, bridges). Carts and villagers travel much faster on roads.">${svg('stone', 16)}${rc.road + rc.cob} road · ${rc.br} bridge</span></div>`;
  if (!posts) h += `<div class="callout">${svg('info', 20)}<span><b>Build a Trade Post</b> (level 4, Build → Roads &amp; Trade) to run trade routes. Building materials still reach far-off sites by porter, just more slowly.</span></div>`;
  h += `<h3 class="r7h">Stores</h3><div class="r7stores">`;
  for (const sid of sids) {
    const cap = T.cap(sid);
    h += `<div class="tile"><div class="top">${svg('house', 18)}${esc(sim.sname(sid))}<span class="r7cap">${cap} each</span></div>${specChip(sid)}
      <div class="r7store">${T.PHYS.filter(k => KEY_GOODS.includes(k) || T.get(sid, k) >= 1).map(k => { const n = T.get(sid, k); return `<span class="${n >= cap - 0.5 ? 'full' : n < 1 ? 'zero' : ''}" title="${esc(GOODS[k].name)}">${svg(GOODS[k].icon, 15)}${fmt(n)}</span>`; }).join('')}</div></div>`;
  }
  h += `</div><h3 class="r7h">Trade routes</h3>`;
  if (sids.length < 2) h += `<p class="r7p">Settle a second clearing (World map) to trade between villages.</p>`;
  else {
    const opt = (list, cur, lab) => list.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(lab(v))}</option>`).join('');
    for (const r of T.rules()) {
      const busy = carts.find(c => c.job?.rule === r.id && !c.job.done);
      h += `<div class="r7rule${r.on ? '' : ' off'}" data-key="rule${r.id}">
        <span>Send</span><select data-act="r7-rule" data-id="${r.id}" data-f="res" aria-label="Good">${opt(T.PHYS, r.res, k => GOODS[k].name)}</select>
        <span>from</span><select data-act="r7-rule" data-id="${r.id}" data-f="from" aria-label="From">${opt(sids, r.from, x => sim.sname(x))}</select>
        <span>to</span><select data-act="r7-rule" data-id="${r.id}" data-f="to" aria-label="To">${opt(sids, r.to, x => sim.sname(x))}</select>
        <span>keeping</span><input type="number" min="0" step="10" data-act="r7-rule" data-id="${r.id}" data-f="keep" value="${r.keep}" aria-label="Amount to keep">
        <button class="tog ${r.on ? 'on' : ''}" data-act="r7-ruleon" data-id="${r.id}" data-tip="${r.on ? 'Pause this route' : 'Resume this route'}">${r.on ? 'On' : 'Off'}</button>
        <button class="x" data-act="r7-ruledel" data-id="${r.id}" aria-label="Remove route" data-tip="Remove this route">${svg('trash', 13)}</button>
        <small>${r.from === r.to ? 'Pick two different villages.' : busy ? esc(T.describe(busy)) : `${esc(sim.sname(r.from))} has ${fmt(T.get(r.from, r.res))}; a cart goes when there are 10+ over ${r.keep} and room at ${esc(sim.sname(r.to))}.`}</small></div>`;
    }
    h += `<button class="btn sm" data-act="r7-ruleadd" ${posts ? '' : 'disabled'}>${svg('plus', 14)} Add a trade route</button>`;
  }
  if (carts.length) h += `<h3 class="r7h">Carts</h3>${carts.map(c => `<div class="r7cart"><span class="dot ${c.state === 'idle' ? 'off' : 'ok'}"></span><b>${c.kind === 'porter' ? 'Porter' : 'Cart'} · ${esc(sim.sname(c.base))}</b> ${esc(T.describe(c))}</div>`).join('')}`;
  h += `<p class="r7p">${svg('info', 14)} Roads: lay dirt roads for free and cobble them for 1 stone a tile (Build → Roads &amp; Trade). Where a road meets a river it becomes a wooden bridge (${BRIDGE_PLANKS} planks a tile).</p>`;
  return h;
}
function festHtml(ui) {
  const sim = ui.sim, s = sim.s, fs = sim.festShop, open = fs.open(), f = fs.current();
  let h = `<div class="summary tight"><span class="chip" data-tip="@stat" data-t="Festival tokens" data-b="Earned from festival quests; spent at the festival shop. They keep from one festival to the next.">${svg('party', 18)}${s.ftokens} token${s.ftokens === 1 ? '' : 's'}</span></div>`;
  if (!open) {
    const si = sim.seasonIdx(), d = sim.seasonDay(), next = d < 1 ? si : (si + 1) % 4, days = d < 1 ? 1 - d : SEASON_DAYS - d + 1;
    h += `<div class="callout calm">${svg('clock', 20)}<span>The festival shop opens on the morning of each festival (the second day of every season) and stays open until the next night. Next: <b>${esc(FESTIVALS[SEASONS[next].id].name)}</b> in ${days} day${days > 1 ? 's' : ''}.</span></div>`;
  } else {
    h += `<h3 class="r7h">${svg('party', 18)} ${esc(f.name)} quests</h3><div class="r7quests">${fs.quests().map(q => `<div class="tile ${q.done ? 'ready' : ''}"><div class="top">${svg(q.icon, 20)}${esc(q.title)}</div>
      <div class="prog" style="margin:2px 0"><i style="width:${q.p / q.n * 100}%;background:linear-gradient(90deg,#ffd866,#f0a826)"></i></div>
      ${q.claimed ? `<span class="small">${svg('check', 12)} Claimed</span>` : q.done ? `<button class="btn gold sm" data-act="r7-fclaim" data-id="${q.id}">Claim ${q.tokens} tokens</button>` : `<span class="small">${fmt(q.p)}/${fmt(q.n)} · ${q.tokens} tokens</span>`}</div>`).join('')}</div>`;
  }
  h += `<h3 class="r7h">${svg('shop', 18)} Festival shop</h3><div class="grid">`;
  const order = open ? [...FESTIVE[s.fq.fest], ...ALL_FESTIVE.filter(t => !FESTIVE[s.fq.fest].includes(t))] : ALL_FESTIVE;
  for (const t of order) {
    const d = DECOR[t], here = open && d.festive === s.fq.fest, own = s.tokens?.[t] || 0, fest = Object.values(FESTIVALS).find(o => o.id === d.festive);
    h += `<div class="tile r7item${here ? '' : ' locked'}" style="align-items:center;text-align:center"><img src="${ui.g.thumbs[t] || ''}" width="64" height="56" alt=""><b style="font-size:13px">${esc(d.name)}</b><span class="small">${esc(d.desc)} · ${svg('smile', 11)}+${d.joy}</span>
      ${here ? `<button class="btn sm" data-act="r7-buy" data-t="${t}" ${s.ftokens < d.price ? 'disabled' : ''}>${svg('party', 13)} ${d.price} tokens</button>` : `<span class="small">At the ${esc(fest.name)}</span>`}
      ${own ? `<button class="btn sm blue" data-act="placetok" data-t="${t}">Place it · ×${own}</button>` : ''}</div>`;
  }
  return h + '</div>';
}
function shareHtml(ui) {
  const S = ui.r7share;
  let backup = null; try { backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null'); } catch { backup = null; }
  let h = `<p class="r7p">A share code is your whole village in one line of text. Send it to a friend, or keep it somewhere safe.</p>
    <div class="r7share"><button class="btn gold" data-act="r7-mkcode">${svg('star', 16)} ${S.code ? 'Make a fresh code' : 'Make my share code'}</button>
    ${S.code ? `<textarea readonly id="r7code" rows="4" aria-label="Your share code">${esc(S.code)}</textarea><div class="r7row"><button class="btn sm" data-act="r7-copy">${svg('check', 14)} Copy</button><small>${(S.code.length / 1024).toFixed(1)} KB${S.status ? ' · ' + esc(S.status) : ''}</small></div>` : ''}</div>
    <h3 class="r7h">Load a village</h3>`;
  if (S.confirm) {
    const d = S.confirm.info;
    h += `<div class="callout">${svg('warn', 22)}<span><b>Load ${esc(d.name)}?</b> Level ${d.level} · day ${d.day} · ${d.pop} villagers · ${d.buildings} buildings · ${d.settled} settlement${d.settled > 1 ? 's' : ''}.<br>This replaces the village you're playing. A backup of it is kept, so you can switch back.</span></div>
      <div class="r7row"><button class="btn gold" data-act="r7-import-yes">Yes, load it</button><button class="btn ghost" data-act="r7-import-no">Cancel</button></div>`;
  } else {
    h += `<textarea id="r7paste" rows="3" placeholder="Paste a share code (VLG1.…)" aria-label="Paste a share code"></textarea>
      <div class="r7row"><button class="btn blue" data-act="r7-import">Check code</button>${S.err ? `<small class="bad">${esc(S.err)}</small>` : ''}</div>`;
  }
  if (backup?.save) h += `<div class="r7row" style="margin-top:10px"><button class="btn sm ghost" data-act="r7-restore">Restore the backup from ${esc(new Date(backup.t).toLocaleString())}</button></div>`;
  return h;
}

// ── clicks (modal and info panel); return true when handled ──
export function r7Click(ui, act, a) {
  const sim = ui.sim, T = sim.trade, g = ui.g;
  if (act === 'r7-trade') { ui.openModal('trade'); return true; }
  if (act === 'r7-share') { ui.openModal('share'); return true; }
  if (act === 'r7-ruleadd') {
    const sids = Object.keys(sim.s.unlocked), to = sids.includes('meadow') ? 'meadow' : sids[0], from = sids.find(o => o !== to);
    const best = T.PHYS.slice().sort((x, y) => T.get(from, y) - T.get(from, x))[0] || 'wood';
    T.addRule(from, to, best, 100); sfx.pop(); return true;
  }
  if (act === 'r7-ruledel') { T.removeRule(+a.dataset.id); sfx.click(); return true; }
  if (act === 'r7-ruleon') { const r = T.rules().find(o => o.id === +a.dataset.id); if (r) T.setRule(r.id, { on: !r.on }); sfx.click(); return true; }
  if (act === 'r7-fclaim') { if (sim.festShop.claim(a.dataset.id)) { ui.toast('Festival tokens earned!', 'party'); } return true; }
  if (act === 'r7-buy') {
    const r = sim.festShop.buy(a.dataset.t);
    if (r.ok) ui.toast(`${DECOR[a.dataset.t].name} bought! Place it from Decorate → Festive.`, 'party'); else { ui.toast(r.why, 'alert'); sfx.error(); }
    return true;
  }
  if (act === 'r7-mkcode') {
    ui.r7share.status = 'making…'; ui.drawModal(true);
    encodeSave(sim.serialize()).then(code => { ui.r7share.code = code; ui.r7share.status = 'ready'; return copyText(code); })
      .then(ok => { ui.r7share.status = ok ? 'copied to the clipboard' : 'select it and copy'; if (ui.modal === 'share') ui.drawModal(true); if (ok) ui.toast('Share code copied!', 'star'); });
    return true;
  }
  if (act === 'r7-copy') { copyText(ui.r7share.code).then(ok => { ui.r7share.status = ok ? 'copied' : 'select it and copy'; ui.drawModal(true); if (ok) ui.toast('Share code copied!', 'star'); }); return true; }
  if (act === 'r7-import') {
    const code = document.getElementById('r7paste')?.value || '';
    decodeSave(code).then(save => { ui.r7share.confirm = { save, info: describeSave(save) }; ui.r7share.err = ''; ui.drawModal(true); })
      .catch(err => { ui.r7share.err = err.message; ui.drawModal(true); sfx.error(); });
    return true;
  }
  if (act === 'r7-import-no') { ui.r7share.confirm = null; return true; }
  if (act === 'r7-import-yes' || act === 'r7-restore') {
    let save;
    if (act === 'r7-restore') { try { save = JSON.parse(localStorage.getItem(BACKUP_KEY)).save; } catch { return true; } }
    else save = ui.r7share.confirm?.save;
    if (!save) return true;
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify({ t: Date.now(), save: sim.serialize() }));   // keep the current village first
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (err) { ui.toast('Couldn\'t save: the browser storage is full', 'alert'); return true; }
    g.resetting = true; location.reload();
    return true;
  }
  return false;
}
export function r7Change(ui, e) {
  const t = e.target; if (t.dataset.act !== 'r7-rule') return false;
  const id = +t.dataset.id, f = t.dataset.f, v = f === 'keep' ? Math.max(0, Math.round(+t.value || 0)) : t.value;
  ui.sim.trade.setRule(id, { [f]: v });
  sfx.click(); t.blur(); ui.drawModal(true);
  return true;
}

// ── build tray: the road tools ──
export function r7CardTip(type, ui) {
  if (type === 'road') return `<b class="t">Dirt Road</b><p>Drag from a road or from inside a settlement to lay a dirt road. Free. Villagers walk 35% faster on roads, and trade carts keep to them.</p><p>Across a river the road becomes a wooden bridge (${BRIDGE_PLANKS} planks a tile, up to three tiles from a bank). Drag along a road you laid to lift it.</p><div class="note">Upgrade busy roads with the Cobble Road tool.</div>`;
  if (type === 'pave') return `<b class="t">Cobble Road</b><p>Cobble a road or path: villagers walk 50% faster on stone and carts roll quickest. Works inside settlements and along any road.</p><p>1 stone a tile; tap a cobbled tile again to lift it (you get the stone back, the dirt road stays).</p>`;
  return '';
}
export const r7CardHtml = (type, ui, a) => type === 'road'
  ? `<button class="card${a}" data-type="road" data-tip="@card"><img alt="" src="${ui.g.thumbs.road || ''}"><div class="nm">Dirt Road</div><div class="cost"><span class="txt">free · drag</span></div></button>`
  : `<button class="card${a}" data-type="pave" data-tip="@card"><img alt="" src="${ui.g.thumbs.pave}"><div class="nm">Cobble Road</div><div class="cost"><span>${svg('stone', 12)}1</span><span class="txt">/ tile</span></div></button>`;
// a line for job buildings: where they get a bonus
export function r7SpecNote(type) {
  const job = defOf(type)?.job; if (!job) return '';
  const st = SETTLEMENTS.filter(o => o.spec?.job === job);
  return st.map(o => `<div class="syn">${svg(o.spec.icon, 13)}<span>${esc(o.spec.name)} specialty: ${JOBS[job].name.toLowerCase()}s in ${esc(o.name)} bring home ${Math.round((o.spec.mult - 1) * 100)}% more.</span></div>`).join('');
}

const CSS = `
#chestArrows { position: fixed; inset: 0; pointer-events: none; z-index: 14; }
.chestarrow { position: absolute; left: -24px; top: -24px; width: 48px; height: 48px; border-radius: 50%; pointer-events: auto; cursor: pointer;
  background: radial-gradient(circle at 50% 40%, #fffaf0, #fbefd2); border: 3px solid var(--edge-dk); box-shadow: var(--shadow);
  display: grid; place-items: center; animation: r7bob 1.6s ease-in-out infinite; }
.chestarrow:hover { filter: brightness(1.06); }
.chestarrow .pt { position: absolute; inset: -11px; pointer-events: none; }
.chestarrow .pt::after { content: ''; position: absolute; right: -2px; top: 50%; margin-top: -8px; border: 8px solid transparent; border-left: 11px solid var(--edge-dk); }
@keyframes r7bob { 50% { box-shadow: var(--shadow), 0 0 0 7px rgba(255, 214, 102, .45); } }
@media (prefers-reduced-motion: reduce) { .chestarrow { animation: none; } }
.r7spec { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 600; color: var(--ink); background: #fff2c6; border: 1.5px solid #e9c46a; border-radius: 999px; padding: 1px 7px 1px 4px; margin: 2px 4px 2px 0; }
.r7stockline { display: inline-flex; gap: 6px; font-size: 11px; color: var(--ink2); align-items: center; }
.r7stockline svg { vertical-align: -2px; margin-right: 1px; }
.r7note { display: block; font-size: 11px; color: var(--ink2); }
.r7store { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12.5px; font-weight: 600; margin: 2px 0 4px; font-variant-numeric: tabular-nums; }
.r7store span { display: inline-flex; align-items: center; gap: 3px; }
.r7store .full { color: #b5651d; } .r7store .zero { opacity: .45; }
.r7stores { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.r7cap { margin-left: auto; font-size: 11px; color: var(--ink2); font-weight: 500; }
.r7h { margin: 14px 0 6px; display: flex; align-items: center; gap: 6px; font-size: 16px; }
.r7p { font-size: 12.5px; color: var(--ink2); margin: 8px 0; line-height: 1.35; }
.r7p svg { display: inline; vertical-align: -2px; }
.r7rule { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; padding: 7px 8px; border-radius: 12px; border: 2px solid #ead2a6; background: var(--card); margin-bottom: 6px; font-size: 12.5px; }
.r7rule.off { opacity: .6; }
.r7rule select, .r7rule input { font: inherit; font-size: 12.5px; padding: 2px 4px; border-radius: 8px; border: 1.5px solid var(--edge); background: #fff; color: var(--ink); max-width: 140px; }
.r7rule input { width: 64px; }
.r7rule .x { margin-left: auto; background: none; border: none; cursor: pointer; padding: 2px; }
.r7rule small { flex-basis: 100%; color: var(--ink2); font-size: 11px; }
.r7cart { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 3px 0; }
.r7cart .dot { width: 8px; height: 8px; border-radius: 50%; background: #9bd36a; flex: none; } .r7cart .dot.off { background: #c9b9a0; }
.r7await { display: grid; grid-template-columns: auto auto 1fr; align-items: center; gap: 2px 5px; font-size: 12.5px; padding: 2px 0; }
.r7await span { grid-column: 1 / -1; font-size: 11px; color: var(--ink2); padding-left: 21px; }
.r7wait { border-color: #f0d58a; background: #fffaf0; }
.r7friend { display: flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 2px 0; }
.r7friend a { color: inherit; font-weight: 600; }
.r7friend small { margin-left: auto; color: var(--ink2); font-size: 11px; }
.r7hearts { display: inline-flex; gap: 1px; } .r7hearts svg.off { filter: grayscale(1); opacity: .35; }
.r7fq { border-left: 3px solid #f0a826; }
.r7got { color: var(--green-dk); }
.r7quests { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
.r7item.locked { opacity: .55; }
.r7share textarea, #r7paste { width: 100%; font: 12px/1.3 ui-monospace, monospace; border-radius: 10px; border: 2px solid var(--edge); padding: 6px; background: #fffdf6; color: var(--ink); resize: vertical; margin-top: 8px; word-break: break-all; }
.r7row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.r7row small { color: var(--ink2); font-size: 11.5px; } .r7row small.bad { color: #c0392b; }
#btnFest { position: relative; }
`;
export { DAY };
