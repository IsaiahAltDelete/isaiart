// DOM interface: resource bar, quests, info panel, build tray, modals,
// toasts and floating numbers.
import { svg } from './icons.js';
import { GOODS, TOP_GOODS, BUILDINGS, DECOR, BUILD_ORDER, DECOR_ORDER, SETTLEMENTS, JOBS, SELLABLE, xpForLevel } from './data.js';
import { defOf, isDecor, DAY } from './sim.js';
import { N, CENTERS, T_WATER, T_SAND } from './world.js';
import { sfx } from './audio.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(Math.floor(n));
const hex = c => '#' + c.toString(16).padStart(6, '0');
const costHtml = (cost, res) => Object.entries(cost || {}).map(([k, v]) =>
  `<span class="${res && (res[k] || 0) < v ? 'no' : ''}">${svg(GOODS[k].icon, 12)}${v}</span>`).join('');

const SHOP = [
  { give: { wood: 150 }, gems: 5 }, { give: { stone: 100 }, gems: 6 }, { give: { food: 120 }, gems: 5 },
  { give: { planks: 60 }, gems: 8 }, { give: { coins: 300 }, gems: 10 }, { give: { bricks: 25 }, gems: 12 },
];

export class UI {
  constructor(game) {
    this.g = game;
    this.dirty = { res: true, quests: true, info: true, modal: false };
    this.tray = null;
    this.modal = null;
    this.timer = 0;
    this.initStatic();
  }
  get sim() { return this.g.sim; }

  initStatic() {
    const g = this.g;
    $('#avatar').innerHTML = `<svg viewBox="0 0 32 32" width="52" height="52"><circle cx="16" cy="13" r="7.5" fill="#f2c9a0" stroke="#5b3a1e" stroke-width="1.4"/><path d="M8.5 12c0-7 15-7 15 0-2-2.5-5-3-7.5-3s-5.5.5-7.5 3z" fill="#7a4a26" stroke="#5b3a1e" stroke-width="1.4"/><circle cx="13" cy="14" r="1" fill="#5b3a1e"/><circle cx="19" cy="14" r="1" fill="#5b3a1e"/><path d="M13.5 17.3c1.5 1.2 3.5 1.2 5 0" stroke="#5b3a1e" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M4 32c0-7 5-11 12-11s12 4 12 11z" fill="#5cb85c" stroke="#5b3a1e" stroke-width="1.4"/></svg>`;
    $('#res').innerHTML = TOP_GOODS.map(k => `<div class="pill" data-res="${k}" title="${GOODS[k].name}">${svg(GOODS[k].icon, 26)}<span class="n">0</span><button class="add" data-shop="${k}" aria-label="Get more ${GOODS[k].name}">${svg('plus', 14)}</button></div>`).join('');
    $('#res').addEventListener('click', e => {
      if (e.target.closest('.add')) this.openModal('shop');
      else if (e.target.closest('.pill')) this.openModal('inventory');
    });
    $('#btnLog').innerHTML = svg('mail', 22) + '<span class="badge hidden" id="logBadge">0</span>';
    $('#btnStats').innerHTML = svg('trophy', 22);
    $('#btnSettings').innerHTML = svg('gear', 22);
    $('#btnLog').onclick = () => this.openModal('log');
    $('#btnStats').onclick = () => this.openModal('stats');
    $('#btnSettings').onclick = () => this.openModal('settings');
    $('#profile').onclick = () => this.openModal('profile');
    $('#qhead').innerHTML = svg('star', 18) + 'Quests';
    $('#quests header').onclick = () => { $('#quests').classList.toggle('collapsed'); sfx.click(); };
    if (innerWidth < 760) $('#quests').classList.add('collapsed');
    $('#qlist').addEventListener('click', e => {
      const b = e.target.closest('[data-claim]');
      if (b && this.sim.claim(b.dataset.claim)) { this.toast('Reward claimed!', 'gem'); this.dirty.quests = true; }
    });
    $('#speedLbl').innerHTML = svg('clock', 13) + 'Speed';
    $('#speeds [data-s="0"]').innerHTML = svg('pause', 13);
    $('#speeds').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { g.setSpeed(+b.dataset.s); sfx.click(); } });
    const sideIcons = { quests: 'star', villagers: 'people', worldmap: 'map', inventory: 'bag' };
    document.querySelectorAll('#side [data-open]').forEach(b => {
      b.innerHTML = svg(sideIcons[b.dataset.open], 24);
      b.onclick = () => {
        if (b.dataset.open === 'quests') { $('#quests').classList.toggle('collapsed'); sfx.click(); }
        else this.openModal(b.dataset.open);
      };
    });
    $('#world').innerHTML = svg('map', 32) + 'World';
    $('#shop').innerHTML = svg('shop', 32) + 'Shop';
    $('#world').onclick = () => this.openModal('worldmap');
    $('#shop').onclick = () => this.openModal('shop');
    const tabs = { build: ['hammer', 'Build'], decor: ['flower', 'Decorate'], villagers: ['people', 'Villagers'], inventory: ['bag', 'Inventory'] };
    document.querySelectorAll('#dockbar [data-tab]').forEach(b => {
      const [ic, label] = tabs[b.dataset.tab];
      b.innerHTML = svg(ic, 26) + label;
      b.onclick = () => {
        const t = b.dataset.tab;
        if (t === 'build' || t === 'decor') this.openTray(t);
        else this.openModal(t);
      };
    });
    $('#trayBack').innerHTML = svg('back', 18) + 'Back';
    $('#trayBack').onclick = () => { this.closeTray(); g.cancelPlace(); sfx.click(); };
    $('#cards').addEventListener('click', e => {
      const c = e.target.closest('.card');
      if (!c) return;
      const type = c.dataset.type;
      if (c.classList.contains('locked')) { this.toast(`Reach level ${defOf(type).lvl} to unlock`, 'lock'); sfx.error(); return; }
      g.startPlace(type);
      this.markCard(type);
    });
    $('#cards').addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { $('#cards').scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    $('#pCancel').innerHTML = svg('close', 22); $('#pRot').innerHTML = svg('rotate', 22); $('#pOk').innerHTML = svg('check', 22);
    $('#pCancel').onclick = () => g.cancelPlace();
    $('#pRot').onclick = () => g.rotatePlace();
    $('#pOk').onclick = () => g.confirmPlace();
    $('#mClose').innerHTML = svg('close', 18);
    $('#mClose').onclick = () => this.closeModal();
    $('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') this.closeModal(); });
    $('#modal').addEventListener('click', e => this.modalClick(e));
    $('#modal').addEventListener('change', e => this.modalChange(e));
    $('#info').addEventListener('click', e => this.infoClick(e));
    $('#info').addEventListener('change', e => this.modalChange(e));
    this.seenLog = 0;
  }

  // ── per-frame ──
  frame(dt) {
    const s = this.sim.s;
    this.timer += dt;
    if (this.dirty.res) { this.dirty.res = false; this.drawRes(); }
    if (this.dirty.quests) { this.dirty.quests = false; this.drawQuests(); }
    if (this.timer > 0.5) {
      this.timer = 0;
      this.drawInfo();
      if (this.modal && ['villagers', 'inventory', 'stats', 'worldmap'].includes(this.modal) && !$('#modal').contains(document.activeElement)) this.drawModal(true);
      this.drawQuests();
      if (this.tray) this.refreshCards();
    }
    const t = s.time / DAY, day = Math.floor(t) + 1, hm = (t % 1) * 24;
    const clock = `Day ${day} · ${String(Math.floor(hm)).padStart(2, '0')}:${String(Math.floor((hm % 1) * 60 / 10) * 10).padStart(2, '0')}`;
    if (this.lastClock !== clock) { this.lastClock = clock; $('#clock').textContent = clock; }
    document.querySelectorAll('#speeds button').forEach(b => b.classList.toggle('on', +b.dataset.s === s.speed));
  }

  drawRes() {
    const s = this.sim.s, cap = this.sim.cap();
    for (const el of document.querySelectorAll('#res .pill')) {
      const k = el.dataset.res, n = el.querySelector('.n');
      const txt = fmt(s.res[k]);
      if (n.textContent !== txt) {
        if (+n.dataset.v < s.res[k]) { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); }
        n.textContent = txt; n.dataset.v = s.res[k];
      }
      n.classList.toggle('full', !!GOODS[k].capped && s.res[k] >= cap);
    }
    const need = xpForLevel(s.level);
    $('#lvl').textContent = s.level;
    $('#xpfill').style.width = Math.min(100, s.xp / need * 100) + '%';
    $('#xptext').textContent = `${Math.floor(s.xp)}/${need}`;
  }

  drawQuests() {
    const list = this.sim.activeQuests();
    const html = list.map(({ q, p, done }) => `
      <div class="quest ${done ? 'done' : ''}">
        <div class="row"><span class="t">${esc(q.title)}</span>${done ? `<button class="btn sm gold claim" data-claim="${q.id}">Claim</button>` : `<span style="font-size:11px;color:var(--ink2)">${fmt(p)}/${fmt(q.n)}</span>`}</div>
        <div class="bar"><i style="width:${p / q.n * 100}%"></i></div>
        <div class="rw">${q.reward.gems ? `<span>${svg('gem', 12)}${q.reward.gems}</span>` : ''}${q.reward.coins ? `<span>${svg('coin', 12)}${q.reward.coins}</span>` : ''}${q.reward.xp ? `<span>${svg('xp', 12)}${q.reward.xp} xp</span>` : ''}</div>
      </div>`).join('') || '<div class="quest">All quests complete — you\'re a master builder!</div>';
    if (html !== this.lastQuests) { this.lastQuests = html; $('#qlist').innerHTML = html; }
    const ready = list.filter(x => x.done).length;
    $('#qhead').innerHTML = svg('star', 18) + 'Quests' + (ready ? ` <span class="badge" style="position:static">${ready}</span>` : '');
  }

  // ── info panel ──
  drawInfo(force) {
    const sel = this.g.selected, el = $('#info');
    if (!sel) { el.classList.add('hidden'); return; }
    if (!force && el.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    el.classList.remove('hidden');
    const html = sel.kind === 'b' ? this.buildingInfo(sel.b) : this.villagerInfo(sel.v);
    if (html !== this.lastInfo) { this.lastInfo = html; el.innerHTML = html; }
  }
  buildingInfo(b) {
    const sim = this.sim, def = defOf(b.type), s = sim.s;
    const sname = SETTLEMENTS.find(o => o.id === b.sid)?.name ?? '—';
    let h = `<button class="x" data-act="close" aria-label="Close">${svg('close', 14)}</button>
      <h3>${esc(def.name)}</h3><div class="sub">${esc(sname)} · ${b.built ? (isDecor(b.type) ? 'decoration' : 'building') : 'under construction'}</div>`;
    if (!b.built) {
      const builders = s.villagers.filter(v => v.task?.bid === b.id).length;
      h += `<div class="prog"><i style="width:${b.progress * 100}%"></i></div>
        <dl class="kv"><dt>Progress</dt><dd>${Math.floor(b.progress * 100)}%</dd><dt>Builders</dt><dd>${builders}</dd>
        ${b.clear.length ? `<dt>Clearing</dt><dd>${b.clear.length} left</dd>` : ''}</dl>
        <div class="sub">${builders ? 'Idle villagers come help automatically.' : 'Waiting for an idle villager to help.'}</div>
        <div class="actions"><button class="btn red sm" data-act="demolish">${svg('trash', 14)} Cancel (refund)</button></div>`;
      return h;
    }
    h += `<dl class="kv">`;
    if (def.workers) h += `<dt>Workers</dt><dd><span class="stepper"><button class="minus" data-act="unstaff" aria-label="Remove worker">${svg('minus', 12)}</button>${b.workers.length}/${def.workers}<button data-act="staff" aria-label="Add worker">${svg('plus', 12)}</button></span></dd>`;
    if (def.workers) h += `<dt>Status</dt><dd>${esc(b.status || (b.workers.length ? 'Working' : 'No workers'))}</dd>`;
    if (def.housing) h += `<dt>Housing</dt><dd>${def.housing} beds</dd>`;
    if (def.storage) h += `<dt>Storage</dt><dd>+${def.storage}</dd>`;
    if (DECOR[b.type]) h += `<dt>Happiness</dt><dd>+${DECOR[b.type].joy}</dd>`;
    if (b.type === 'farm') h += `<dt>Field</dt><dd>${{ empty: 'Needs sowing', growing: `Growing ${Math.floor(b.data.grow * 100)}%`, ripe: 'Ready to harvest!' }[b.data.stage]}</dd>`;
    if (b.type === 'campfire') {
      const pop = s.villagers.filter(v => v.home === b.sid).length;
      h += `<dt>Villagers</dt><dd>${pop}/${sim.housingIn(b.sid)}</dd><dt>Territory</dt><dd>${sim.settlementRadius(b.sid)} tiles</dd>`;
    }
    h += `</dl><div class="sub">${esc(def.desc || '')}</div>`;
    if (b.type === 'market') {
      h += `<div class="sub" style="margin-top:6px">Sell when above reserve:</div><div class="sell-toggles">${SELLABLE.map(k =>
        `<button class="tog ${s.sell[k] ? 'on' : ''}" data-act="sell" data-k="${k}">${svg(GOODS[k].icon, 16)}${GOODS[k].name} · ${GOODS[k].price}</button>`).join('')}</div>`;
    }
    if (b.workers.length) {
      h += `<div class="sub" style="margin-top:6px">${b.workers.map(id => { const v = s.villagers.find(o => o.id === id); return v ? `<a href="#" data-act="selv" data-id="${v.id}" style="color:inherit">${esc(v.name)}</a>` : ''; }).join(', ')}</div>`;
    }
    if (b.type !== 'campfire') h += `<div class="actions"><button class="btn red sm" data-act="demolish">${svg('trash', 14)} Demolish</button></div>`;
    return h;
  }
  villagerInfo(v) {
    const sim = this.sim, s = sim.s;
    const opts = this.workOptions(v);
    const sname = SETTLEMENTS.find(o => o.id === v.home)?.name ?? '';
    const doing = v.task?.label ?? (v.job === 'idle' ? 'Looking for something to do' : 'Thinking');
    return `<button class="x" data-act="close" aria-label="Close">${svg('close', 14)}</button>
      <h3><span class="face" style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${hex(v.shirt)};border:2px solid var(--edge)"></span>${esc(v.name)}</h3>
      <div class="sub">${esc(sname)} · ${JOBS[v.job].name}</div>
      <dl class="kv"><dt>Doing</dt><dd>${esc(doing)}</dd><dt>Fed</dt><dd>${v.hungry ? '<span style="color:#c0392b">Hungry!</span>' : Math.round(100 - v.hunger / 80 * 100) + '%'}</dd>
      ${v.carry ? `<dt>Carrying</dt><dd>${v.carry.n} ${GOODS[v.carry.res].name.toLowerCase()}</dd>` : ''}</dl>
      <label class="sub" style="display:block">Job</label>
      <select data-act="job" data-id="${v.id}" style="width:100%">${opts}</select>
      <div class="actions"><button class="btn blue sm" data-act="follow">${svg('eye', 14)} ${this.g.followV === v ? 'Stop following' : 'Follow'}</button></div>`;
  }
  workOptions(v) {
    const s = this.sim.s;
    let o = `<option value="0" ${v.job === 'idle' ? 'selected' : ''}>Idle / builder</option>`;
    for (const b of s.buildings) {
      const def = defOf(b.type);
      if (!def.workers || !b.built) continue;
      const mine = v.work === b.id;
      if (!mine && b.workers.length >= def.workers) continue;
      const sn = SETTLEMENTS.find(x => x.id === b.sid)?.name ?? '';
      o += `<option value="${b.id}" ${mine ? 'selected' : ''}>${JOBS[def.job].name} — ${def.name} (${b.workers.length}/${def.workers}) · ${sn}</option>`;
    }
    return o;
  }
  infoClick(e) {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    e.preventDefault();
    const sim = this.sim, sel = this.g.selected;
    const act = a.dataset.act;
    if (act === 'close') { this.g.select(null); return; }
    if (act === 'selv') { const v = sim.vById.get(+a.dataset.id); if (v) this.g.select({ kind: 'v', v }, true); return; }
    if (act === 'follow') { this.g.followV = this.g.followV === sel.v ? null : sel.v; this.drawInfo(true); return; }
    if (!sel || sel.kind !== 'b') return;
    const b = sel.b;
    if (act === 'staff') { if (!sim.assign(b, null)) { this.toast(b.workers.length >= defOf(b.type).workers ? 'This building is fully staffed' : 'No idle villagers — build more cottages!', 'person'); sfx.error(); } else sfx.pop(); }
    if (act === 'unstaff') { const id = b.workers[b.workers.length - 1]; if (id) { sim.unassign(sim.vById.get(id)); sfx.click(); } }
    if (act === 'sell') { sim.s.sell[a.dataset.k] = !sim.s.sell[a.dataset.k]; sfx.click(); }
    if (act === 'demolish') {
      if (a.dataset.sure) { sim.demolish(b); this.g.select(null); sfx.place(); return; }
      a.dataset.sure = 1; a.innerHTML = svg('trash', 14) + ' Tap again to confirm'; return;
    }
    this.drawInfo(true);
  }

  // ── build tray ──
  openTray(kind) {
    this.tray = kind;
    $('#tray').classList.remove('hidden');
    $('#dockbar').classList.add('hidden');
    const order = kind === 'build' ? ['clear', ...BUILD_ORDER] : DECOR_ORDER;
    $('#cards').innerHTML = order.map(t => {
      if (t === 'clear') return `<button class="card" data-type="clear"><img alt="" src="${this.g.thumbs.clear}"><div class="nm">Clear Trees</div><div class="cost"><span>tap trees</span></div></button>`;
      const d = defOf(t);
      return `<button class="card" data-type="${t}"><img alt="" src="${this.g.thumbs[t] || ''}"><div class="nm">${esc(d.name)}</div><div class="cost"></div></button>`;
    }).join('');
    this.refreshCards();
    sfx.open();
  }
  refreshCards() {
    const s = this.sim.s;
    for (const c of document.querySelectorAll('#cards .card')) {
      const t = c.dataset.type;
      if (t === 'clear') continue;
      const d = defOf(t), locked = d.lvl > s.level;
      c.classList.toggle('locked', locked);
      const cost = costHtml(d.cost, s.res);
      const html = locked ? `<span>Level ${d.lvl}</span>` : cost;
      const ce = c.querySelector('.cost');
      if (ce.innerHTML !== html) ce.innerHTML = html;
      let lk = c.querySelector('.lock');
      if (locked && !lk) c.insertAdjacentHTML('beforeend', `<span class="lock">${svg('lock', 12)}${d.lvl}</span>`);
      if (!locked && lk) lk.remove();
    }
  }
  markCard(type) { document.querySelectorAll('#cards .card').forEach(c => c.classList.toggle('sel', c.dataset.type === type)); }
  closeTray() {
    this.tray = null;
    $('#tray').classList.add('hidden');
    $('#dockbar').classList.remove('hidden');
  }

  placeBar(show, msg = '', bad = false, touch = false) {
    $('#placebar').classList.toggle('hidden', !show);
    $('#pMsg').textContent = msg;
    $('#pMsg').classList.toggle('bad', bad);
    $('#pOk').classList.toggle('hidden', !touch);
  }

  // ── modals ──
  openModal(kind) {
    this.modal = kind;
    $('#modal').classList.remove('hidden');
    this.drawModal();
    sfx.open();
  }
  closeModal() { this.modal = null; $('#modal').classList.add('hidden'); }
  drawModal(refresh) {
    const k = this.modal, sim = this.sim, s = sim.s;
    const titles = { villagers: ['people', 'Villagers'], inventory: ['bag', 'Inventory'], worldmap: ['map', 'World'], shop: ['shop', 'Shop'],
      settings: ['gear', 'Settings'], log: ['mail', 'Village News'], stats: ['trophy', 'Village Records'], profile: ['star', 'Your Progress'] };
    $('#mIcon').innerHTML = svg(titles[k][0], 26);
    $('#mTitle').textContent = titles[k][1];
    let h = '';
    if (k === 'villagers') {
      const idle = s.villagers.filter(v => v.job === 'idle').length;
      h += `<div class="summary"><span class="chip">${svg('people', 18)}${s.villagers.length} / ${sim.housing()} housed</span>
        <span class="chip">${svg('smile', 18)}Happiness <span class="happy"><i style="width:${s.happiness}%"></i></span>${Math.round(s.happiness)}</span>
        <span class="chip">${svg('person', 18)}${idle} idle</span>
        <span class="chip">${svg('apple', 18)}${s.villagers.filter(v => v.hungry).length} hungry</span></div>`;
      h += `<div class="sub" style="font-size:12px;color:var(--ink2);margin-bottom:6px">Idle villagers build construction sites and clear marked trees. Pick a job to send someone to work.</div>`;
      h += s.villagers.map(v => `<div class="vrow"><span class="face" style="background:${hex(v.shirt)}"></span>
        <div><b>${esc(v.name)}</b> ${v.hungry ? '<span style="color:#c0392b;font-size:11px">hungry</span>' : ''}<div class="doing">${esc(v.task?.label ?? 'Idle')} · ${esc(SETTLEMENTS.find(o => o.id === v.home)?.name ?? '')}</div></div>
        <select data-act="job" data-id="${v.id}">${this.workOptions(v)}</select></div>`).join('');
    } else if (k === 'inventory') {
      const cap = sim.cap();
      h += `<div class="summary"><span class="chip">${svg('house', 18)}Storage ${cap} per good</span><span class="chip">${svg('coin', 18)}${fmt(s.res.coins)}</span><span class="chip">${svg('gem', 18)}${s.res.gems}</span></div><div class="grid">`;
      for (const key of SELLABLE) {
        const g = GOODS[key], n = s.res[key], half = Math.max(1, Math.floor(g.price / 2));
        h += `<div class="tile"><div class="top">${svg(g.icon, 26)}${g.name}</div><div class="amt">${fmt(n)}<span class="small"> / ${cap}</span></div>
          <div class="prog" style="margin:0"><i style="width:${Math.min(100, n / cap * 100)}%;background:linear-gradient(90deg,#7dd35a,#4fae32)"></i></div>
          <button class="btn gold sm" data-act="sell10" data-k="${key}" ${n < 10 ? 'disabled' : ''}>Sell 10 · ${svg('coin', 12)}${half * 10}</button></div>`;
      }
      h += `</div><p class="sub" style="font-size:12px;color:var(--ink2);margin-top:8px">Quick sales pay half price. A staffed Market Stall sells your surplus at full price.</p>`;
    } else if (k === 'worldmap') {
      h += `<div class="worldwrap"><canvas id="minimap" width="384" height="384"></canvas><div>`;
      for (const st of SETTLEMENTS) {
        const un = s.unlocked[st.id];
        const pop = s.villagers.filter(v => v.home === st.id).length;
        let right = '';
        if (un) right = `<button class="btn blue sm" data-act="travel" data-sid="${st.id}">Visit</button>`;
        else {
          const ok = s.level >= st.unlock.lvl && sim.canAfford(st.unlock.cost);
          right = `<button class="btn sm ${ok ? '' : 'ghost'}" data-act="settle" data-sid="${st.id}" ${ok ? '' : 'disabled'}>Settle</button>`;
        }
        h += `<div class="sett">${svg(un ? 'house' : 'lock', 28)}<div class="meta"><b>${st.name}</b>${un ? `${pop} villagers · ${st.blurb}` :
          `Level ${st.unlock.lvl} · <span class="card" style="all:unset">${costHtml(st.unlock.cost, s.res).replace(/class="no"/g, 'style="color:#c0392b"')}</span><br>${st.blurb}`}</div>${right}</div>`;
      }
      h += `</div></div>`;
    } else if (k === 'shop') {
      h += `<div class="summary"><span class="chip">${svg('gem', 18)}${s.res.gems} gems</span></div><p class="sub" style="font-size:12px;color:var(--ink2);margin-bottom:8px">Gems come from quests and levelling up. No real money here — just cozy trades.</p><div class="grid">`;
      SHOP.forEach((p, i) => {
        const [r, n] = Object.entries(p.give)[0];
        h += `<div class="tile" style="align-items:center;text-align:center">${svg(GOODS[r].icon, 40)}<div class="amt">${n}</div><div class="small">${GOODS[r].name}</div>
          <button class="btn sm" data-act="buy" data-i="${i}" ${s.res.gems < p.gems ? 'disabled' : ''}>${svg('gem', 14)} ${p.gems}</button></div>`;
      });
      h += `</div>`;
    } else if (k === 'settings') {
      const st = this.g.settings;
      h += `<div class="summary"><button class="btn ${st.sound ? '' : 'ghost'}" data-act="sound">${svg(st.sound ? 'sound' : 'mute', 18)} Sound ${st.sound ? 'on' : 'off'}</button>
        <button class="btn blue" data-act="quality">Graphics: ${st.quality === 'high' ? 'High' : 'Low'}</button>
        <button class="btn gold" data-act="savenow">Save now</button></div>
        <div class="help"><p><b>How to play.</b> Build a Lumber Hut and a Forager Hut first so you have wood and food. Idle villagers automatically build construction sites. Tap a building to add or remove workers, or use the Villagers tab to give anyone a job.</p>
        <p>Cottages bring new villagers, as long as there is food and folks are happy. Decorations raise happiness, which makes everyone work faster. Level up to unlock new buildings, then settle more clearings from the World map.</p>
        <p><b>Controls.</b> Drag to move · scroll or pinch to zoom · right-drag, two-finger twist or <kbd>Q</kbd>/<kbd>E</kbd> to rotate · <kbd>WASD</kbd> to pan · <kbd>R</kbd> rotates while placing · <kbd>Space</kbd> pauses · <kbd>Esc</kbd> cancels.</p>
        <p>Your village saves automatically in this browser.</p></div>
        <div class="actions"><button class="btn red" data-act="reset">${svg('trash', 16)} Start a new village</button></div>`;
    } else if (k === 'log') {
      h += s.log.map(l => `<div class="logline"><small>Day ${Math.floor(l.t / DAY) + 1}</small>${esc(l.msg)}</div>`).join('') || '<p>No news yet.</p>';
      this.seenLog = s.log.length; this.markLog();
    } else if (k === 'stats') {
      const st = s.stats;
      const built = Object.values(st.built).reduce((a, b) => a + b, 0);
      h += `<div class="grid">${[
        ['clock', 'Days', Math.floor(s.time / DAY) + 1], ['people', 'Villagers', s.villagers.length], ['hammer', 'Buildings', built],
        ['flower', 'Decorations', st.decor], ['axe', 'Trees felled', st.felled || 0], ['sapling', 'Saplings planted', st.produced.sapling || 0],
        ['coin', 'Coins traded', st.earned], ['smile', 'Happiness', Math.round(s.happiness)],
        ...SELLABLE.map(k => [GOODS[k].icon, GOODS[k].name + ' made', st.produced[k] || 0]),
      ].map(([ic, l, v]) => `<div class="tile"><div class="top">${svg(ic, 22)}${l}</div><div class="amt">${fmt(v)}</div></div>`).join('')}</div>`;
    } else if (k === 'profile') {
      const need = xpForLevel(s.level);
      h += `<div class="summary"><span class="chip">${svg('star', 18)}Level ${s.level}</span><span class="chip">${svg('xp', 18)}${Math.floor(s.xp)} / ${need} xp</span></div>
        <div class="prog"><i style="width:${s.xp / need * 100}%;background:linear-gradient(90deg,#9be86d,#4fae32)"></i></div>
        <p class="sub" style="font-size:12.5px;color:var(--ink2)">Earn xp by finishing buildings, completing quests and bringing goods home.</p><h3 style="margin:10px 0 6px">Coming up</h3><div class="grid">`;
      const up = [...Object.entries(BUILDINGS), ...Object.entries(DECOR)].filter(([, d]) => d.lvl > s.level).sort((a, b) => a[1].lvl - b[1].lvl).slice(0, 8);
      h += up.map(([t, d]) => `<div class="tile" style="align-items:center"><img src="${this.g.thumbs[t]}" width="64" height="56" alt=""><b style="font-size:13px">${d.name}</b><span class="small">Level ${d.lvl}</span></div>`).join('') + '</div>';
    }
    const body = $('#mBody');
    const scroll = body.scrollTop;
    body.innerHTML = h;
    if (refresh) body.scrollTop = scroll;
    if (k === 'worldmap') this.drawMinimap();
  }
  modalClick(e) {
    const a = e.target.closest('[data-act]');
    if (!a) {
      if (e.target.id === 'minimap') {
        const r = e.target.getBoundingClientRect();
        const tx = (e.clientX - r.left) / r.width * N, tz = (e.clientY - r.top) / r.height * N;
        this.g.view.flyTo(tx - N / 2, tz - N / 2); this.closeModal();
      }
      return;
    }
    const sim = this.sim, s = sim.s, act = a.dataset.act;
    if (act === 'sell10') {
      const k = a.dataset.k, half = Math.max(1, Math.floor(GOODS[k].price / 2));
      if (s.res[k] >= 10) { s.res[k] -= 10; s.res.coins += half * 10; s.stats.earned += half * 10; sfx.coin(); this.dirty.res = true; }
    }
    if (act === 'travel') { this.g.flyToSettlement(a.dataset.sid); this.closeModal(); return; }
    if (act === 'settle') {
      if (sim.unlock(a.dataset.sid)) { this.g.flyToSettlement(a.dataset.sid); this.closeModal(); sfx.level(); return; }
    }
    if (act === 'buy') {
      const p = SHOP[+a.dataset.i];
      if (s.res.gems >= p.gems) {
        s.res.gems -= p.gems;
        for (const [r, n] of Object.entries(p.give)) { s.res[r] += n; }
        sfx.coin(); this.toast('Thanks for shopping!', 'shop');
      }
    }
    if (act === 'sound') { this.g.setSetting('sound', !this.g.settings.sound); }
    if (act === 'quality') { this.g.setSetting('quality', this.g.settings.quality === 'high' ? 'low' : 'high'); this.g.save(); location.reload(); return; }
    if (act === 'savenow') { this.g.save(); this.toast('Village saved', 'star'); }
    if (act === 'reset') {
      if (a.dataset.sure) { this.g.reset(); return; }
      a.dataset.sure = 1; a.innerHTML = 'Tap again — this erases your village'; return;
    }
    this.dirty.res = true;
    this.drawModal(true);
  }
  modalChange(e) {
    const t = e.target;
    if (t.dataset.act !== 'job') return;
    const sim = this.sim, v = sim.vById.get(+t.dataset.id), bid = +t.value;
    if (!v) return;
    if (!bid) sim.unassign(v);
    else { const b = sim.bById.get(bid); if (b && !sim.assign(b, v)) { this.toast('That job is full', 'person'); sfx.error(); } }
    sfx.pop();
    t.blur();
    if (this.modal === 'villagers') this.drawModal(true);
    this.drawInfo(true);
  }

  drawMinimap() {
    const cv = $('#minimap'); if (!cv) return;
    const g = cv.getContext('2d'), W = this.sim.world, S = cv.width / N;
    const img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      let c = [111, 176, 74];
      if (W.type[i] === T_WATER) c = [85, 176, 228];
      else if (W.type[i] === T_SAND) c = [226, 206, 146];
      if (W.wear[i] > 0.3) c = [205, 165, 105];
      if (W.tree[i] >= 0) c = [52, 120, 52];
      if (W.rock[i] >= 0) c = [150, 150, 145];
      if (W.occ[i] >= 0) c = [190, 80, 60];
      img.data.set([...c, 255], i * 4);
    }
    const tmp = document.createElement('canvas'); tmp.width = N; tmp.height = N;
    tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, 0, 0, cv.width, cv.height);
    g.font = '600 15px Fredoka, sans-serif'; g.textAlign = 'center';
    for (const st of SETTLEMENTS) {
      const c = CENTERS[st.id], un = this.sim.s.unlocked[st.id];
      g.strokeStyle = un ? '#fff' : 'rgba(255,255,255,.6)'; g.setLineDash(un ? [] : [5, 4]); g.lineWidth = 2.5;
      g.beginPath(); g.arc((c.x + 0.5) * S, (c.z + 0.5) * S, (un ? this.sim.settlementRadius(st.id) : c.r + 4) * S, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      g.lineWidth = 4; g.strokeStyle = '#5b3a1e'; g.fillStyle = '#fff';
      g.strokeText((un ? '' : '🔒 ') + st.name, (c.x + 0.5) * S, (c.z + 0.5) * S - 4);
      g.fillText((un ? '' : '🔒 ') + st.name, (c.x + 0.5) * S, (c.z + 0.5) * S - 4);
    }
    // camera marker
    const r = this.g.view.rig;
    g.strokeStyle = '#ffd54f'; g.lineWidth = 3;
    g.strokeRect((r.tx + N / 2) * S - 30, (r.tz + N / 2) * S - 22, 60, 44);
  }

  markLog() {
    const n = this.sim.s.log.length - (this.seenLog || 0);
    const b = $('#logBadge'); if (!b) return;
    b.classList.toggle('hidden', n <= 0); b.textContent = n;
  }

  // ── toasts & floats ──
  toast(msg, icon = 'info', big = false) {
    const el = document.createElement('div');
    el.className = 'toast panel' + (big ? ' big' : '');
    el.innerHTML = svg(icon, big ? 30 : 22) + `<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(el);
    while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
    setTimeout(() => el.remove(), 3100);
  }
  float(sx, sy, text, icon) {
    const el = document.createElement('div');
    el.className = 'float';
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    el.innerHTML = (icon ? svg(icon, 18) : '') + esc(text);
    $('#floats').appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}
