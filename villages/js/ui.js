// DOM interface: resource bar, quests, info panel, build tray, modals,
// toasts and floating numbers.
import { svg, iconImage } from './icons.js';
import { GOODS, TOP_GOODS, BUILDINGS, DECOR, BUILD_ORDER, DECOR_ORDER, SETTLEMENTS, JOBS, SELLABLE, QUESTS, SYNERGY, CROPS, SPELLS, BEASTS, xpForLevel,
  SEASONS, SEASON_DAYS, FESTIVALS, RARE, FIRST_NAMES } from './data.js';
import { defOf, isDecor, DAY, workersOf, lvlOf, MAX_LVL, housingOf, storageOf, stageOf } from './sim.js';
import { N, CENTERS, T_WATER, T_SAND } from './world.js';
import { sfx } from './audio.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(Math.floor(n));
const hex = c => '#' + c.toString(16).padStart(6, '0');
const costHtml = (cost, res) => Object.entries(cost || {}).map(([k, v]) =>
  `<span class="${res && (res[k] || 0) < v ? 'no' : ''}">${svg(GOODS[k].icon, 12)}${v}</span>`).join('');

// a little portrait: shirt, face, hair or hat, eyes, cheeks and a smile
function faceSvg(v, size = 34) {
  const hair = hex(v.hair), skin = hex(v.skin);
  const top = v.hat
    ? `<path d="M6 13h20v2H6z" fill="${hex(v.hatColor)}" stroke="#5b3a1e" stroke-width="1"/><path d="M10 13c0-5 12-5 12 0z" fill="${hex(v.hatColor)}" stroke="#5b3a1e" stroke-width="1"/>`
    : `<path d="M9 15c0-7 14-7 14 0-3-2-11-2-14 0z" fill="${hair}" stroke="#5b3a1e" stroke-width="1"/>`;
  return `<svg class="face" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><circle cx="16" cy="16" r="15.5" fill="#cfe8f5"/>
    <path d="M4 32c0-7 5-10 12-10s12 3 12 10z" fill="${hex(v.shirt)}" stroke="#5b3a1e" stroke-width="1"/>
    <circle cx="16" cy="16" r="7" fill="${skin}" stroke="#5b3a1e" stroke-width="1"/>${top}
    <circle cx="13.4" cy="16.5" r="1" fill="#2a1a10"/><circle cx="18.6" cy="16.5" r="1" fill="#2a1a10"/>
    <circle cx="12" cy="18.6" r="1.1" fill="#f29a8a" opacity=".8"/><circle cx="20" cy="18.6" r="1.1" fill="#f29a8a" opacity=".8"/>
    <path d="M14.2 19.2c1 .9 2.6 .9 3.6 0" stroke="#5b3a1e" stroke-width=".9" fill="none" stroke-linecap="round"/></svg>`;
}

const SHOP = [
  { give: { wood: 150 }, gems: 5 }, { give: { stone: 100 }, gems: 6 }, { give: { food: 120 }, gems: 5 },
  { give: { planks: 60 }, gems: 8 }, { give: { coins: 300 }, gems: 10 }, { give: { bricks: 25 }, gems: 12 },
];

// what each workplace turns into what (for the production-chain view)
const CHAIN = {
  lumber: { out: ['wood'] }, forager: { out: ['food'] }, quarry: { out: ['stone'] }, dock: { out: ['food'] },
  sawmill: { in: ['wood'], out: ['planks'] }, windmill: { in: ['grain'], out: ['flour'] }, bakery: { in: ['flour'], out: ['food'] },
  mason: { in: ['stone'], out: ['bricks'] }, coop: { in: ['grain'], out: ['food'] }, orchard: { out: ['food'] }, beehive: { out: ['honey'] },
  pasture: { out: ['wool'] }, weaver: { in: ['wool'], out: ['cloth'] }, dairy: { out: ['milk'] }, creamery: { in: ['milk'], out: ['cheese'] },
  brewery: { in: ['grain'], out: ['ale'] }, tavern: { in: ['ale', 'cheese', 'honey'], out: [] }, market: { in: [], out: ['coins'] },
};
const farmOut = b => [CROPS[b.data?.crop || 'wheat'].out];
const outsOf = b => b.type === 'farm' ? farmOut(b) : CHAIN[b.type]?.out || [];
// building types that make / use a good
const makersOf = g => [...Object.keys(CHAIN).filter(t => CHAIN[t].out.includes(g)), ...(g === 'grain' || g === 'food' ? ['farm'] : [])];
const usersOf = g => Object.keys(CHAIN).filter(t => (CHAIN[t].in || []).includes(g));

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
      if (e.target.closest('.add')) { this.openModal('shop'); return; }
      const pill = e.target.closest('.pill'); if (!pill) return;
      if (this.resTipFor === pill.dataset.res && !$('#restip').classList.contains('hidden')) { this.hideResTip(); this.openModal('inventory'); }
      else this.showResTip(pill);
    });
    $('#res').addEventListener('pointerover', e => { const p = e.target.closest('.pill'); if (p && e.pointerType === 'mouse' && !e.target.closest('.add')) this.showResTip(p); });
    $('#res').addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.hideResTip(); });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('#res') && !e.target.closest('#restip')) this.hideResTip(); });
    $('#restip').addEventListener('click', e => { if (e.target.closest('[data-act=inv]')) { this.hideResTip(); this.openModal('inventory'); } });
    $('#btnLog').innerHTML = svg('mail', 22) + '<span class="badge hidden" id="logBadge">0</span>';
    $('#btnStats').innerHTML = svg('trophy', 22) + '<span class="badge hidden" id="trophyBadge">0</span>';
    $('#btnSettings').innerHTML = svg('gear', 22);
    $('#btnHome').innerHTML = svg('home', 24);
    $('#btnHome').onclick = () => g.goHome();
    $('#btnChest').onclick = () => this.flyToChest();
    $('#follow').onclick = () => g.follow(null);
    $('#season').onclick = () => { const sea = this.sim.season(), f = this.sim.festivalToday(); this.toast(f ? `${f.name}: ${f.desc}` : `${sea.name}: ${sea.blurb}`, f ? f.icon : sea.icon); };
    $('#namecard').addEventListener('click', e => { if (e.target.closest('[data-act=babyok]')) this.nameBaby(); if (e.target.closest('[data-act=babyskip]')) this.nameBaby(true); });
    $('#namecard').addEventListener('keydown', e => { if (e.key === 'Enter') this.nameBaby(); e.stopPropagation(); });
    $('#info').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const b = $('#info [data-act=renameok]'); if (b) b.click(); } });
    $('#btnMagic').innerHTML = svg('staff', 22);
    $('#btnMagic').onclick = () => this.openModal('magic');
    $('#btnLog').onclick = () => this.openModal('log');
    $('#btnStats').onclick = () => this.openModal('stats');
    $('#btnSettings').onclick = () => this.openModal('settings');
    $('#profile').onclick = () => this.openModal('profile');
    $('#qhead').innerHTML = svg('star', 18) + 'Quests';
    $('#quests header').onclick = () => { $('#quests').classList.toggle('collapsed'); sfx.click(); };
    if (innerWidth < 760) $('#quests').classList.add('collapsed');
    $('#qlist').addEventListener('click', e => {
      const go = e.target.closest('[data-go]');
      if (go) { this.doGo(QUESTS.find(q => q.id === go.dataset.go)); return; }
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
      if (c.classList.contains('locked')) { this.toast(defOf(type).rare ? `The ${defOf(type).name} can only be found in gift chests in the woods` : `Reach level ${defOf(type).lvl} to unlock`, defOf(type).rare ? 'gift' : 'lock'); sfx.error(); return; }
      g.startPlace(type);
      this.markCard(type);
    });
    $('#cards').addEventListener('pointerover', e => {
      const c = e.target.closest('.card');
      if (c && e.pointerType === 'mouse') this.cardTip(c); else if (!c) $('#cardtip').classList.add('hidden');
    });
    $('#cards').addEventListener('pointerleave', () => $('#cardtip').classList.add('hidden'));
    $('#cards').addEventListener('scroll', () => $('#cardtip').classList.add('hidden'));
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
    this.hammer = svg('hammer', 16);
    $('#coach').addEventListener('click', e => { if (e.target.closest('[data-skip]')) { this.sim.s.tutorial = 99; this.drawCoach(); } });
    $('#alert').onclick = () => {
      const t = $('#alert').dataset.go;
      if (t === 'chest') { const ch = this.sim.s.chests[0]; if (ch) { const r = this.g.view.rig; this.g.view.flyTo(ch.x + Math.sin(r.yaw) * 3, ch.z + Math.cos(r.yaw) * 3, Math.min(r.dist, 22), 0.9); } return; }
      this.doGo({ kind: 'build', key: t });
    };
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
      this.drawAlert();
      this.drawCoach();
      $('#btnMagic').classList.toggle('hidden', !this.sim.s.buildings.some(b => b.type === 'wizard' && b.built));
      const nch = this.sim.s.chests?.length || 0, cb = $('#btnChest');
      if (cb.dataset.n !== String(nch)) { cb.dataset.n = nch; cb.classList.toggle('hidden', !nch); cb.innerHTML = svg('gift', 24) + (nch > 1 ? `<span class="badge">${nch}</span>` : ''); }
      const ready = this.sim.achievements().filter(x => x.done && !x.claimed).length;
      const tb = $('#trophyBadge'); tb.classList.toggle('hidden', !ready); tb.textContent = ready;
      if (this.modal && ['villagers', 'inventory', 'stats', 'worldmap', 'merchant', 'magic'].includes(this.modal) && !$('#modal').contains(document.activeElement)) this.drawModal(true);
      this.drawQuests();
      if (this.tray) this.refreshCards();
    }
    const t = s.time / DAY, day = Math.floor(t) + 1, hm = (t % 1) * 24;
    const clock = `Day ${day} · ${String(Math.floor(hm)).padStart(2, '0')}:${String(Math.floor((hm % 1) * 60 / 10) * 10).padStart(2, '0')}`;
    if (this.lastClock !== clock) { this.lastClock = clock; $('#clock').textContent = clock; this.drawSeason(); }
    const fv = this.g.followV, fk = fv ? fv.id + fv.name : '';
    if (fk !== this.lastFollow) { this.lastFollow = fk; $('#follow').classList.toggle('hidden', !fv); if (fv) $('#follow').innerHTML = `${svg('eye', 16)}Following ${esc(fv.name.split(' ')[0])}<span class="stop">Stop</span>`; }
    document.querySelectorAll('#speeds button').forEach(b => b.classList.toggle('on', +b.dataset.s === s.speed));
  }

  // the chest button: fly to the next unopened gift chest
  flyToChest() {
    const list = this.sim.s.chests; if (!list?.length) return;
    this.chestI = ((this.chestI ?? -1) + 1) % list.length;
    const ch = list[this.chestI], g = this.g, r = g.view.rig;
    g.select(null); g.followV = null;
    g.view.flyTo(ch.x + Math.sin(r.yaw) * 2, ch.z + Math.cos(r.yaw) * 2, Math.max(16, Math.min(r.dist, 22)), 0.9);
    sfx.click();
  }
  drawSeason() {
    const sim = this.sim, sea = sim.season(), d = sim.seasonDay() + 1, fest = sim.festivalToday(), on = sim.festivalActive();
    const html = `${svg(sea.icon, 16)}<span><span>${sea.name} · <span class="dl">day </span>${d}/${SEASON_DAYS}</span>${fest ? `<span class="fest">${svg('party', 12)}<span class="fn">${esc(fest.name)} </span>${on ? 'now!' : 'tonight'}</span>` : ''}</span>`;
    if (html !== this.lastSeason) { this.lastSeason = html; $('#season').innerHTML = html; $('#season').classList.toggle('festday', !!fest); }
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
        <div class="row"><span class="t">${esc(q.title)}</span>${done ? `<button class="btn sm gold claim" data-claim="${q.id}">Claim</button>` : `<span style="font-size:11px;color:var(--ink2)">${fmt(p)}/${fmt(q.n)}</span>${this.goFor(q) ? `<button class="go" data-go="${q.id}" aria-label="Show me">${svg('target', 16)}</button>` : ''}`}</div>
        <div class="bar"><i style="width:${p / q.n * 100}%"></i></div>
        <div class="rw">${q.reward.gems ? `<span>${svg('gem', 12)}${q.reward.gems}</span>` : ''}${q.reward.coins ? `<span>${svg('coin', 12)}${q.reward.coins}</span>` : ''}${q.reward.xp ? `<span>${svg('xp', 12)}${q.reward.xp} xp</span>` : ''}</div>
      </div>`).join('') || '<div class="quest">All quests complete — you\'re a master builder!</div>';
    if (html !== this.lastQuests) { this.lastQuests = html; $('#qlist').innerHTML = html; }
    const ready = list.filter(x => x.done).length;
    $('#qhead').innerHTML = svg('star', 18) + 'Quests' + (ready ? ` <span class="badge" style="position:static">${ready}</span>` : '');
  }

  // what a good is, where it comes from, what uses it
  goodInfo(k, full = true) {
    const g = GOODS[k], s = this.sim.s, rt = Math.round(this.sim.rate(k));
    return `<div class="gi-top">${svg(g.icon, 30)}<div><b>${esc(g.name)}</b><span>${fmt(s.res[k])}${g.capped ? ` / ${this.sim.cap()}` : ''}${g.price ? ` · sells ${g.price}` : ''}${rt ? ` · <i class="${rt > 0 ? 'up' : 'down'}">${rt > 0 ? '+' : ''}${rt}/min</i>` : ''}</span></div></div>
      <p>${esc(g.desc || '')}</p>
      ${g.from ? `<div class="gi-row"><em>From</em>${esc(g.from)}</div>` : ''}${g.uses ? `<div class="gi-row"><em>Used for</em>${esc(g.uses)}</div>` : ''}
      ${full ? `<button class="btn sm ghost" data-act="inv">${svg('bag', 14)} Open inventory</button>` : ''}`;
  }
  showResTip(pill) {
    const k = pill.dataset.res, tip = $('#restip');
    this.resTipFor = k;
    tip.innerHTML = this.goodInfo(k);
    const r = pill.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(innerWidth - 268, r.left)) + 'px';
    tip.style.top = (r.bottom + 8) + 'px';
    tip.classList.remove('hidden');
  }
  hideResTip() { $('#restip').classList.add('hidden'); this.resTipFor = null; }

  // quest shortcut: where should the "show me" button take you?
  goFor(q) {
    const produceMap = { wood: 'lumber', grain: 'farm', planks: 'sawmill', bread: 'bakery', bricks: 'mason' };
    if (q.kind === 'build') return { tray: DECOR[q.key] ? 'decor' : 'build', type: q.key };
    if (q.kind === 'produce' && produceMap[q.key]) {
      const t = produceMap[q.key];
      const have = this.sim.s.buildings.find(b => b.type === t && b.built);
      return have ? { select: have } : { tray: 'build', type: t };
    }
    if (q.kind === 'pop') return { tray: 'build', type: 'cottage' };
    if (q.kind === 'decor') return { tray: 'decor' };
    if (q.kind === 'unlock') return { modal: 'worldmap' };
    if (q.kind === 'job' || q.kind === 'earn') {
      const t = q.kind === 'job' ? 'lumber' : 'market';
      const have = this.sim.s.buildings.find(b => b.type === t && b.built);
      return have ? { select: have } : { tray: 'build', type: t };
    }
    return null;
  }
  doGo(q) {
    const g = this.goFor(q); if (!g) return;
    if (g.modal) return this.openModal(g.modal);
    if (g.select) { this.g.select({ kind: 'b', b: g.select }, true); return; }
    this.openTray(g.tray);
    if (g.type) {
      const card = document.querySelector(`#cards .card[data-type="${g.type}"]`);
      if (card) {
        card.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        card.classList.add('hint'); setTimeout(() => card.classList.remove('hint'), 2400);
        if (!card.classList.contains('locked')) { this.g.startPlace(g.type); this.markCard(g.type); }
      }
    }
  }

  // first-time tips, one step at a time
  drawCoach() {
    const s = this.sim.s, g = this.g, el = $('#coach');
    const has = t => s.buildings.some(b => b.type === t);
    const touch = g.lastPointer && g.lastPointer !== 'mouse';
    const steps = [
      { text: 'Welcome to your village! Tap <b>Build</b> to see what you can make.', target: '#dockbar [data-tab=build]', done: () => this.tray === 'build' || has('lumber') },
      { text: 'Pick the <b>Lumber Hut</b>. Woodcutters will chop trees and bring you wood.', target: '#cards .card[data-type=lumber]', done: () => g.place?.type === 'lumber' || has('lumber') },
      { text: touch ? 'Tap a green spot near the campfire, then press <b>✓</b>.' : 'Click a green spot near the campfire to build it.', target: '#pOk', done: () => has('lumber') },
      { text: 'Idle villagers build it for you. Now add a <b>Forager Hut</b> so everyone has food.', target: this.tray === 'build' ? '#cards .card[data-type=forager]' : '#dockbar [data-tab=build]', done: () => has('forager') },
      { text: 'Tap any building to add workers, upgrade or move it. Claim quest rewards on the left. Have fun!', target: '#quests', done: () => (this.coachT = (this.coachT || 0) + 0.5) > 14 || g.selected },
    ];
    // a village that already has its first huts doesn't need the basics
    if (s.tutorial < 3 && has('lumber') && has('forager')) s.tutorial = 4;
    if (s.tutorial >= steps.length) { el.classList.add('hidden'); this.coachTarget(null); return; }
    const st = steps[s.tutorial];
    if (st.done()) { s.tutorial++; sfx.pop(); return this.drawCoach(); }
    el.classList.remove('hidden');
    const html = `<span class="cnum">${s.tutorial + 1}/${steps.length}</span><span>${st.text}</span><button data-skip>Skip tips</button>`;
    if (el.dataset.step !== String(s.tutorial)) { el.dataset.step = s.tutorial; el.innerHTML = html; }
    this.coachTarget(st.target);
  }
  coachTarget(sel) {
    const t = sel ? document.querySelector(sel) : null;
    if (this.coached && this.coached !== t) this.coached.classList.remove('coach-target');
    if (t && !t.classList.contains('coach-target')) t.classList.add('coach-target');
    this.coached = t;
  }

  // alert chip: the most urgent problem in the village
  drawAlert() {
    const sim = this.sim, s = sim.s, pop = s.villagers.length;
    let a = null;
    const hungry = s.villagers.filter(v => v.hungry).length;
    const fr = sim.rate('food');
    const prowl = (s.beasts || []).filter(b => b.state === 'prowl').length;
    if (prowl) a = { icon: 'shield', text: `${prowl === 1 ? 'A beast is' : `${prowl} beasts are`} prowling — ${s.buildings.some(b => b.type === 'watchtower' && b.built) ? 'guards are on it' : 'build a Watchtower!'}`, go: 'watchtower' };
    else if (hungry) a = { icon: 'apple', text: `${hungry} villager${hungry > 1 ? 's are' : ' is'} hungry!`, go: 'forager' };
    else if (s.res.food < pop * 2 && fr <= 5) a = { icon: 'apple', text: 'Food is running low', go: 'forager' };
    else {
      const cap = sim.cap(), full = ['wood', 'planks', 'stone', 'food', 'grain'].find(k => s.res[k] >= cap);
      if (full && s.level >= 3) a = { icon: 'bag', text: `${GOODS[full].name} storage is full`, go: 'storehouse' };
      else if (pop > sim.housing()) a = { icon: 'house', text: 'Not enough beds', go: 'cottage' };
    }
    const el = $('#alert');
    const key = a ? a.text : '';
    if (key === this.lastAlert) return;
    this.lastAlert = key;
    el.classList.toggle('hidden', !a);
    el.classList.toggle('calm', !!a?.calm);
    if (a) { el.innerHTML = svg(a.icon, 18) + esc(a.text); el.dataset.go = a.go; }
  }

  // ── info panel ──
  drawInfo(force) {
    const sel = this.g.selected, el = $('#info');
    document.body.classList.toggle('info-open', !!sel);
    if (!sel) { el.classList.add('hidden'); return; }
    if (!force && el.contains(document.activeElement) && ['SELECT', 'INPUT'].includes(document.activeElement.tagName)) return;
    if (this.renaming && !(sel.kind === 'b' ? 'b' + sel.b?.id : 'v' + sel.v?.id) === this.renaming) this.renaming = null;
    el.classList.remove('hidden');
    const html = sel.kind === 'b' ? this.buildingInfo(sel.b) : this.villagerInfo(sel.v);
    if (html !== this.lastInfo) { this.lastInfo = html; el.innerHTML = html; }
  }
  buildingInfo(b) {
    const sim = this.sim, def = defOf(b.type), s = sim.s;
    const sname = sim.sname(b.sid);
    let h = `<button class="x" data-act="close" aria-label="Close">${svg('close', 14)}</button>
      ${this.renaming === 'b' + b.id ? `<div class="rename"><input id="renameIn" maxlength="22" value="${esc(sname)}" aria-label="Village name"><button class="btn sm" data-act="renameok">Save</button></div>`
        : `<h3>${esc(b.type === 'campfire' ? sname : def.name)}${!isDecor(b.type) ? ` <span class="lvchip">Lv ${lvlOf(b)}</span>` : ''}${b.type === 'campfire' ? `<button class="pen" data-act="rename" aria-label="Rename village">${svg('pencil', 14)}</button>` : ''}</h3>`}
      <div class="sub">${b.type === 'campfire' ? 'Village campfire · the heart of the settlement' : `${esc(sname)} · ${b.built ? (b.up ? 'being upgraded' : isDecor(b.type) ? 'decoration' : 'building') : 'under construction'}`}</div>`;
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
    if (def.workers) h += `<dt>Workers</dt><dd><span class="stepper"><button class="minus" data-act="unstaff" aria-label="Remove worker">${svg('minus', 12)}</button>${b.workers.length}/${workersOf(b)}<button data-act="staff" aria-label="Add worker">${svg('plus', 12)}</button></span></dd>`;
    if (def.workers) h += `<dt>Status</dt><dd>${esc(b.status || (b.workers.length ? 'Working' : 'No workers'))}</dd>`;
    if (def.housing) h += `<dt>Housing</dt><dd>${housingOf(b)} beds</dd>`;
    if (def.storage && b.type !== 'campfire') h += `<dt>Storage</dt><dd>+${storageOf(b)}</dd>`;
    if (DECOR[b.type]) h += `<dt>Happiness</dt><dd>+${DECOR[b.type].joy}</dd>`;
    if (b.type === 'farm') h += `<dt>Crop</dt><dd>${CROPS[b.data.crop || 'wheat'].name}</dd><dt>Field</dt><dd>${{ empty: 'Needs sowing', growing: `Growing ${Math.floor(b.data.grow * 100)}%`, ripe: 'Ready to harvest!' }[b.data.stage]}</dd>`;
    if (b.type === 'watchtower') h += `<dt>Beasts driven off</dt><dd>${s.stats.fended || 0}</dd><dt>Watch range</dt><dd>${13 + lvlOf(b) * 2} tiles</dd>`;
    if (b.type === 'tavern') h += `<dt>Tavern cheer</dt><dd>${s.tavernJoy > 0 ? `+12 joy · ${Math.ceil(s.tavernJoy)}s` : 'Quiet'}</dd>`;
    if (b.type === 'wizard') h += `<dt>Mana</dt><dd>${Math.floor(s.magic.mana)} / ${sim.manaCap()}</dd>`;
    if (b.type === 'school') h += `<dt>Pupils</dt><dd>${s.villagers.filter(v => v.home === b.sid && v.age >= 5 && v.age < 14).length}</dd>`;
    if (b.type === 'campfire') {
      const pop = s.villagers.filter(v => v.home === b.sid).length;
      h += `<dt>Villagers</dt><dd>${pop}/${sim.housingIn(b.sid)}</dd><dt>Territory</dt><dd>${sim.settlementRadius(b.sid)} tiles</dd>`;
    }
    h += `</dl><div class="sub">${esc(def.desc || '')}</div>`;
    h += this.chainHtml(b);
    if (b.type === 'farm') h += `<div class="crops">${Object.entries(CROPS).map(([k, c]) => `<button class="tog ${(b.data.crop || 'wheat') === k ? 'on' : ''}" data-act="crop" data-k="${k}">${svg(c.out === 'grain' ? 'wheat' : 'apple', 16)}${c.name}<small>${c.desc}</small></button>`).join('')}</div>`;
    if (b.type === 'wizard') h += `<button class="btn sm" style="background:linear-gradient(#b18cff,#7a5ad8);border-color:#4a2f8a;margin-top:6px;width:100%" data-act="spellbook">${svg('staff', 16)} Open the spell book</button>`;
    if (b.type === 'memorial' && s.departed?.length) h += `<div class="sub" style="margin-top:6px">In loving memory: ${s.departed.slice(-6).reverse().map(d => `${esc(d.name)} (${d.age})`).join(', ')}</div>`;
    // neighbour bonuses
    const syn = sim.synergy(b), helps = SYNERGY.filter(r => r.from === b.type);
    if (syn.list.length) h += `<div class="synbox">${syn.list.map(r => `<div>${svg('star', 14)}<b>+${Math.round(r.bonus * r.n * 100)}%</b> ${esc(r.why)}${r.n > 1 ? ` (×${r.n})` : ''}</div>`).join('')}</div>`;
    else { const want = SYNERGY.filter(r => r.to === b.type); if (want.length) h += `<div class="synbox dim">${want.map(r => `<div>${svg('star', 14)}Build near a ${esc(defOf(r.from).name)} for +${Math.round(r.bonus * 100)}%</div>`).join('')}</div>`; }
    if (helps.length) h += `<div class="sub" style="margin-top:4px">Boosts nearby: ${helps.map(r => defOf(r.to).name).join(', ')}</div>`;
    const hint = { 'No trees within reach': 'Woodcutters only walk about 20 tiles from the hut (zoom out to see the dashed ring). Build another Lumber Hut by the forest, or a Forester\'s Lodge to replant.',
      'No boulders nearby': 'Miners have broken every boulder in range. Build a Quarry near rocks — Stonecrest is full of them.',
      'Waiting for berries': 'Bushes regrow in about a minute. More bushes in the ring means more food.',
      'Nothing to sell': 'Turn on more goods below, or wait until you have more than you keep in reserve.' }[b.status];
    if (hint) h += `<div class="hintbox">${svg('info', 16)}<span>${esc(hint)}</span></div>`;
    if (b.type === 'market') {
      h += `<div class="sub" style="margin-top:6px">Sell when above reserve:</div><div class="sell-toggles">${SELLABLE.map(k =>
        `<button class="tog ${s.sell[k] ? 'on' : ''}" data-act="sell" data-k="${k}">${svg(GOODS[k].icon, 16)}${GOODS[k].name} · ${GOODS[k].price}</button>`).join('')}</div>`;
    }
    if (b.workers.length) {
      h += `<div class="sub" style="margin-top:6px">${b.workers.map(id => { const v = s.villagers.find(o => o.id === id); return v ? `<a href="#" data-act="selv" data-id="${v.id}" style="color:inherit">${esc(v.name)}</a>` : ''; }).join(', ')}</div>`;
    }
    if (b.up) {
      h += `<div class="sub" style="margin-top:6px">Upgrading to level ${lvlOf(b) + 1}…</div><div class="prog"><i style="width:${b.up.progress * 100}%"></i></div>`;
    } else if (!isDecor(b.type) && lvlOf(b) < MAX_LVL) {
      const can = sim.canUpgrade(b), cost = sim.upgradeCost(b);
      h += `<div class="upbox"><div class="uprow"><b>Lv ${lvlOf(b) + 1}</b><span class="cost">${costHtml(cost, s.res)}</span>
        <button class="btn gold sm" data-act="upgrade" ${can.ok ? '' : 'disabled'}>${svg('star', 14)} Upgrade</button></div>
        <span>${esc(sim.upgradeEffect(b))}${can.ok ? '' : ` · <em>${esc(can.why)}</em>`}</span></div>`;
    }
    if (b.type !== 'campfire') h += `<div class="actions"><button class="btn blue sm" data-act="move">${svg('rotate', 14)} Move</button><button class="btn red sm" data-act="demolish">${svg('trash', 14)} Demolish</button></div>`;
    return h;
  }
  // inputs → this building → outputs, with what it really made and used in the last minute,
  // plus links to the buildings that supply it and the ones that use what it makes
  chainHtml(b) {
    const sim = this.sim, ch = b.type === 'farm' ? { in: [], out: farmOut(b) } : CHAIN[b.type];
    if (!ch || !b.built) return '';
    const ins = ch.in || [], outs = ch.out || [];
    const rate = r => { const n = Math.round(sim.bRate(b, r)); return n ? `<i class="${n > 0 ? 'up' : 'down'}">${n > 0 ? '+' : ''}${n}/min</i>` : '<i>—</i>'; };
    const node = r => `<span class="node">${svg(GOODS[r].icon, 22)}${esc(GOODS[r].name)}${rate(r)}</span>`;
    let h = `<div class="chain"><div class="cap">Production · last minute</div><div class="flow${ins.length > 1 ? ' many' : ''}">`;
    if (ins.length) h += ins.map(node).join('') + `<span class="arr">→</span>`;
    h += `<span class="node me"><img alt="" src="${this.g.thumbs[b.type] || ''}">${esc(defOf(b.type).name)}</span>`;
    if (outs.length) h += `<span class="arr">→</span>` + outs.map(node).join('');
    h += `</div>`;
    // who supplies the inputs, who uses the outputs
    const near = t => { const c = sim.bCenter(b); let best = null, bd = 1e9; for (const o of sim.s.buildings) { if (o.type !== t || !o.built || o === b) continue; const oc = sim.bCenter(o), d = Math.hypot(oc.x - c.x, oc.z - c.z); if (d < bd) { bd = d; best = o; } } return best; };
    const link = (t, verb) => { const o = near(t), d = defOf(t); return o ? `<button data-act="chainb" data-id="${o.id}">${svg(verb, 13)}${esc(d.name)}</button>` : `<button class="missing" data-act="chainbuild" data-type="${t}">${svg('plus', 13).replace('#fff', '#8a5a2b')}${esc(d.name)}</button>`; };
    const sup = [...new Set(ins.flatMap(makersOf))].filter(t => t !== b.type && BUILDINGS[t]).slice(0, 3);
    const use = [...new Set(outs.flatMap(usersOf))].filter(t => t !== b.type && BUILDINGS[t]).slice(0, 3);
    if (sup.length || use.length) h += `<div class="links">${sup.map(t => link(t, 'back')).join('')}${use.map(t => link(t, 'fast')).join('')}</div>`;
    return h + `</div>`;
  }
  villagerInfo(v) {
    const sim = this.sim, s = sim.s;
    const opts = this.workOptions(v);
    const sname = sim.sname(v.home);
    const doing = v.task?.label ?? (v.job === 'idle' ? 'Looking for something to do' : 'Thinking');
    return `<button class="x" data-act="close" aria-label="Close">${svg('close', 14)}</button>
      ${this.renaming === 'v' + v.id ? `<div class="rename">${faceSvg(v, 26)}<input id="renameIn" maxlength="22" value="${esc(v.name)}" aria-label="Name"><button class="btn sm" data-act="renameok">Save</button></div>`
        : `<h3>${faceSvg(v, 26)}${esc(v.name)}<button class="pen" data-act="rename" aria-label="Rename">${svg('pencil', 14)}</button></h3>`}
      <div class="sub">${esc(sname)} · ${JOBS[v.job].name}</div>
      <dl class="kv"><dt>Age</dt><dd>${Math.floor(v.age ?? 30)} · ${{ child: 'child', adult: 'adult', elder: 'elder' }[stageOf(v)]}${v.educated ? ' · schooled' : ''}</dd>
      ${this.family(v)}
      <dt>Doing</dt><dd>${esc(doing)}</dd><dt>Fed</dt><dd>${v.hungry ? '<span style="color:#c0392b">Hungry!</span>' : Math.round(100 - v.hunger / 80 * 100) + '%'}</dd>
      ${v.carry ? `<dt>Carrying</dt><dd>${v.carry.n} ${GOODS[v.carry.res].name.toLowerCase()}</dd>` : ''}</dl>
      ${stageOf(v) === 'adult' ? `<label class="sub" style="display:block">Job</label><select data-act="job" data-id="${v.id}" style="width:100%">${opts}</select>` : `<div class="sub">${stageOf(v) === 'child' ? 'Too young to work — plays, and studies if there\'s a school.' : 'Retired, enjoying the quiet life.'}</div>`}
      <div class="actions"><button class="btn blue sm" data-act="follow">${svg('eye', 14)} ${this.g.followV === v ? 'Stop following' : 'Follow'}</button></div>`;
  }
  family(v) {
    const vb = id => this.sim.vById.get(id), link = o => o ? `<a href="#" data-act="selv" data-id="${o.id}" style="color:inherit">${esc(o.name.split(' ')[0])}</a>` : '';
    let h = '';
    const p = v.partner && vb(v.partner); if (p) h += `<dt>Partner</dt><dd>${svg('heart', 12)} ${link(p)}</dd>`;
    const kids = (v.kids || []).map(vb).filter(Boolean); if (kids.length) h += `<dt>Children</dt><dd>${kids.map(link).join(', ')}</dd>`;
    const par = (v.parents || []).map(vb).filter(Boolean); if (par.length) h += `<dt>Parents</dt><dd>${par.map(link).join(' & ')}</dd>`;
    return h;
  }
  waitWhy(v) {
    const b = v.work ? this.sim.bById.get(v.work) : null;
    if (!b?.status || !/Waiting|Resting|Working/.test(v.task?.label || '')) return '';
    const short = { 'No trees within reach': 'no trees', 'No boulders nearby': 'no boulders', 'Storage full': 'storage full', 'Nothing to sell': 'nothing to sell', 'Waiting for berries': 'berries regrowing' }[b.status] || b.status.toLowerCase();
    return ` · <span class="why">${esc(short)}</span>`;
  }
  workplaceCaption(v) {
    const b = v.work ? this.sim.bById.get(v.work) : null;
    return b ? `${defOf(b.type).name} · ${b.workers.length}/${workersOf(b)}` : 'Builds & clears';
  }
  workOptions(v, short = false) {
    const s = this.sim.s;
    let o = `<option value="0" ${v.job === 'idle' ? 'selected' : ''}>${short ? 'Idle' : 'Idle / builder'}</option>`;
    for (const b of s.buildings) {
      const def = defOf(b.type);
      if (!def.workers || !b.built) continue;
      const mine = v.work === b.id;
      if (!mine && b.workers.length >= workersOf(b)) continue;
      const sn = this.sim.sname(b.sid);
      o += `<option value="${b.id}" ${mine ? 'selected' : ''}>${mine && short ? JOBS[def.job].name : `${JOBS[def.job].name} — ${def.name} (${b.workers.length}/${workersOf(b)})${Object.keys(s.unlocked).length > 1 ? ' · ' + sn : ''}`}</option>`;
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
    if (act === 'follow') { this.g.follow(this.g.followV === sel.v ? null : sel.v); return; }
    if (act === 'rename') {
      this.renaming = sel.kind === 'b' ? 'b' + sel.b.id : 'v' + sel.v.id; this.drawInfo(true);
      const inp = $('#renameIn'); if (inp) { inp.focus(); inp.select(); } return;
    }
    if (act === 'renameok') {
      const val = $('#renameIn')?.value || '';
      const ok = sel.kind === 'b' ? sim.renameSettlement(sel.b.sid, val) : sim.renameVillager(sel.v, val);
      this.renaming = null; if (ok) { sfx.pop(); this.toast(sel.kind === 'b' ? `Welcome to ${sim.sname(sel.b.sid)}!` : `Now known as ${sel.v.name}`, sel.kind === 'b' ? 'house' : 'person'); }
      this.drawInfo(true); return;
    }
    if (act === 'chainb') { const b = sim.bById.get(+a.dataset.id); if (b) this.g.select({ kind: 'b', b }, true); return; }
    if (act === 'chainbuild') { this.g.select(null); this.doGo({ kind: 'build', key: a.dataset.type }); return; }
    if (!sel || sel.kind !== 'b') return;
    const b = sel.b;
    if (act === 'move') { this.g.startPlace(b.type, b); return; }
    if (act === 'crop') { b.data.crop = a.dataset.k; sfx.pop(); }
    if (act === 'spellbook') { this.openModal('magic'); return; }
    if (act === 'upgrade') { if (sim.upgrade(b)) this.toast('Builders are on their way!', 'hammer'); }
    if (act === 'staff') { if (!sim.assign(b, null)) { this.toast(b.workers.length >= workersOf(b) ? 'This building is fully staffed' : 'No idle villagers — build more cottages!', 'person'); sfx.error(); } else sfx.pop(); }
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
    const order = kind === 'build' ? ['clear', ...BUILD_ORDER] : ['pave', ...DECOR_ORDER];
    $('#cards').innerHTML = order.map(t => {
      if (t === 'clear') return `<button class="card" data-type="clear"><img alt="" src="${this.g.thumbs.clear}"><div class="nm">Clear Trees</div><div class="cost"><span>tap trees</span></div></button>`;
      if (t === 'pave') return `<button class="card" data-type="pave"><img alt="" src="${this.g.thumbs.pave}"><div class="nm">Stone Path</div><div class="cost"><span>${svg('stone', 12)}1 / tile</span></div></button>`;
      const d = defOf(t);
      return `<button class="card${d.rare ? ' rare' : ''}" data-type="${t}"><img alt="" src="${this.g.thumbs[t] || ''}"><div class="nm">${esc(d.name)}</div><div class="cost"></div></button>`;
    }).join('');
    this.refreshCards();
    sfx.open();
  }
  refreshCards() {
    const s = this.sim.s;
    for (const c of document.querySelectorAll('#cards .card')) {
      const t = c.dataset.type;
      if (t === 'clear' || t === 'pave') continue;
      const d = defOf(t), have = s.tokens?.[t] || 0, locked = d.rare ? !have : d.lvl > s.level;
      c.classList.toggle('locked', locked);
      const cost = costHtml(d.cost, s.res);
      const html = d.rare ? (have ? `<span>Free · ×${have}</span>` : `<span>Chests only</span>`) : locked ? `<span>Level ${d.lvl}</span>` : cost;
      const ce = c.querySelector('.cost');
      if (ce.innerHTML !== html) ce.innerHTML = html;
      let lk = c.querySelector('.lock');
      if (locked && !lk && !d.rare) c.insertAdjacentHTML('beforeend', `<span class="lock">${svg('lock', 12)}${d.lvl}</span>`);
      if (!locked && lk) lk.remove();
    }
  }
  cardTip(card) {
    const type = card.dataset.type, tip = $('#cardtip');
    if (type === 'pave') {
      tip.innerHTML = `<b>Stone Path</b><p>Paint cobbled paths inside your settlements. Villagers walk 50% faster on stone. Costs 1 stone per tile; tap a stone again to lift it and get the stone back.</p>`;
    } else if (type === 'clear') {
      tip.innerHTML = `<b>Clear Trees</b><p>Mark trees to fell. Woodcutters go for marked trees first, and idle villagers help too. Click a marked tree again to unmark it.</p>`;
    } else {
      const d = defOf(type), s = this.sim.s;
      let rows = '';
      if (d.workers) rows += `<dt>Workers</dt><dd>${d.workers} ${JOBS[d.job].name.toLowerCase()}${d.workers > 1 ? 's' : ''}</dd>`;
      if (d.housing) rows += `<dt>Homes</dt><dd>${d.housing} villagers</dd>`;
      if (d.storage) rows += `<dt>Storage</dt><dd>+${d.storage} each</dd>`;
      if (DECOR[type]) rows += `<dt>Happiness</dt><dd>+${d.joy}</dd>`;
      if (d.time) rows += `<dt>Build work</dt><dd>${d.time}s</dd>`;
      const near = SYNERGY.filter(r => r.to === type), helps = SYNERGY.filter(r => r.from === type);
      if (near.length) rows += `<dt>Likes being near</dt><dd>${near.map(r => `${defOf(r.from).name} +${Math.round(r.bonus * 100)}%`).join(', ')}</dd>`;
      if (helps.length) rows += `<dt>Boosts</dt><dd>${helps.map(r => defOf(r.to).name).join(', ')}</dd>`;
      if (!d.rare) rows += `<dt>Cost</dt><dd>${Object.entries(d.cost || {}).map(([k, v]) => `<span style="display:inline-flex;align-items:center;gap:2px;margin-left:6px;${(s.res[k] || 0) < v ? 'color:#c0392b' : ''}">${svg(GOODS[k].icon, 14)}${v}</span>`).join('')}</dd>`;
      if (d.lvl > s.level && !d.rare) rows += `<dt>Unlocks at</dt><dd>Level ${d.lvl}</dd>`;
      if (d.rare) rows += `<dt>Owned</dt><dd>${s.tokens?.[type] || 0} · from gift chests</dd>`;
      tip.innerHTML = `<b>${esc(d.name)}</b><p>${esc(d.desc || (DECOR[type] ? 'A cozy touch that makes villagers happier.' : ''))}</p><dl class="kv">${rows}</dl>`;
    }
    const r = card.getBoundingClientRect();
    tip.style.left = Math.max(125, Math.min(innerWidth - 125, r.left + r.width / 2)) + 'px';
    tip.style.top = (r.top - 10) + 'px';
    tip.classList.remove('hidden');
  }
  markCard(type) { document.querySelectorAll('#cards .card').forEach(c => c.classList.toggle('sel', c.dataset.type === type)); }
  closeTray() {
    this.tray = null;
    $('#tray').classList.add('hidden');
    $('#dockbar').classList.remove('hidden');
  }

  placeBar(show, msg = '', bad = false, touch = false, title = '') {
    $('#placebar').classList.toggle('hidden', !show);
    $('#cardtip').classList.add('hidden');
    $('#pMsg').innerHTML = (title ? `<b>${esc(title)}</b>` : '') + esc(msg);
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
      settings: ['gear', 'Settings'], log: ['mail', 'Village News'], stats: ['trophy', 'Achievements'], profile: ['star', 'Your Progress'], merchant: ['shop', 'Travelling Merchant'], magic: ['staff', 'Spell Book'] };
    $('#mIcon').innerHTML = svg(titles[k][0], 26);
    $('#mTitle').textContent = titles[k][1];
    let h = '';
    if (k === 'villagers') {
      const idle = s.villagers.filter(v => v.job === 'idle').length;
      h += `<div class="summary tight"><span class="chip" title="Housed">${svg('house', 16)}${s.villagers.length}/${sim.housing()}</span>
        <span class="chip" title="Happiness">${svg('smile', 16)}${Math.round(s.happiness)}</span>
        <span class="chip" title="Idle">${svg('person', 16)}${idle} idle</span>
        <span class="chip" title="Hungry">${svg('apple', 16)}${s.villagers.filter(v => v.hungry).length}</span></div>`;
      const jobs = [...new Set(s.villagers.map(v => v.job))];
      const multi = Object.keys(s.unlocked).length > 1;
      const f = this.vFilter && jobs.includes(this.vFilter) ? this.vFilter : 'all';
      h += `<div class="chips"><button class="chipf ${f === 'all' ? 'on' : ''}" data-act="vf" data-f="all">All ${s.villagers.length}</button>${jobs.map(j =>
        `<button class="chipf ${f === j ? 'on' : ''}" data-act="vf" data-f="${j}">${JOBS[j].name} ${s.villagers.filter(v => v.job === j).length}</button>`).join('')}</div>`;
      h += `<div class="actions" style="margin:0 0 8px"><button class="btn sm" data-act="autoassign" ${idle ? '' : 'disabled'}>${svg('people', 16)} Give idle villagers jobs</button></div>`;
      h += `<div class="sub" style="font-size:12px;color:var(--ink2);margin-bottom:6px">Idle villagers build construction sites and clear marked trees. Pick a job to send someone to work.</div>`;
      h += s.villagers.filter(v => f === 'all' || v.job === f).map(v => `<div class="vrow">${faceSvg(v)}
        <div><b>${esc(v.name)} <span class="age">${Math.floor(v.age ?? 30)}</span></b> ${v.hungry ? '<span style="color:#c0392b;font-size:11px">hungry</span>' : ''}<div class="doing">${esc(v.task?.label ?? 'Idle')}${this.waitWhy(v)}${multi ? ' · ' + esc(sim.sname(v.home)) : ''}</div></div>
        <div class="jobcell"><select data-act="job" data-id="${v.id}">${this.workOptions(v, true)}</select>${v.work ? `<button class="cap" data-act="openb" data-id="${v.work}">${esc(this.workplaceCaption(v))} ›</button>` : `<small>${esc(this.workplaceCaption(v))}</small>`}</div></div>`).join('');
    } else if (k === 'inventory') {
      const cap = sim.cap();
      h += `<div class="summary"><span class="chip">${svg('house', 18)}Storage ${cap} per good</span><span class="chip">${svg('coin', 18)}${fmt(s.res.coins)}</span><span class="chip">${svg('gem', 18)}${s.res.gems}</span></div><div class="grid">`;
      for (const key of SELLABLE) {
        const g = GOODS[key], n = s.res[key], half = Math.max(1, Math.floor(g.price / 2));
        const rt = Math.round(sim.rate(key));
        h += `<div class="tile"><div class="top">${svg(g.icon, 26)}${g.name}<span class="rate ${rt > 0 ? 'up' : rt < 0 ? 'down' : ''}">${rt > 0 ? '+' : ''}${rt}/min</span></div><div class="amt">${fmt(n)}<span class="small"> / ${cap}</span></div>
          <div class="prog" style="margin:0"><i style="width:${Math.min(100, n / cap * 100)}%;background:linear-gradient(90deg,#7dd35a,#4fae32)"></i></div>
          <div class="small">${esc(g.desc)}</div><div class="small"><b>From:</b> ${esc(g.from)}</div><div class="small"><b>Uses:</b> ${esc(g.uses)}</div>
          <button class="btn gold sm" data-act="sell10" data-k="${key}" ${n < 10 ? 'disabled' : ''}>Sell 10 · ${svg('coin', 12)}${half * 10}</button></div>`;
      }
      const tok = RARE.filter(t => s.tokens?.[t] > 0);
      h += `</div><h3 style="margin:12px 0 6px">${svg('gift', 20)} Treasures</h3>` + (tok.length
        ? `<div class="grid">${tok.map(t => `<div class="tile" style="align-items:center;text-align:center"><img src="${this.g.thumbs[t]}" width="64" height="56" alt=""><b style="font-size:13px">${esc(DECOR[t].name)} ×${s.tokens[t]}</b><span class="small">${esc(DECOR[t].desc)}</span><button class="btn sm" data-act="placetok" data-t="${t}">Place it</button></div>`).join('')}</div>`
        : `<p class="sub" style="font-size:12px;color:var(--ink2)">Gift chests turn up in the woods every day or so. Some hold rare decorations you can't build.</p>`);
      h += `<p class="sub" style="font-size:12px;color:var(--ink2);margin-top:8px">Quick sales pay half price. A staffed Market Stall sells your surplus at full price.</p>`;
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
        h += `<div class="sett">${svg(un ? 'house' : 'lock', 28)}<div class="meta"><b>${esc(sim.sname(st.id))}</b>${un ? `${pop} villagers · ${st.blurb}` :
          `<span class="costline">Level ${st.unlock.lvl} · ${costHtml(st.unlock.cost, s.res)}</span>${st.blurb}`}</div>${right}</div>`;
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
        <button class="btn ${st.music ? '' : 'ghost'}" data-act="music">${svg('star', 18)} Music ${st.music ? 'on' : 'off'}</button>
        <button class="btn blue" data-act="quality">Graphics: ${{ high: 'High', medium: 'Medium', low: 'Low' }[st.quality] || 'High'}</button>
        <button class="btn gold" data-act="savenow">Save now</button></div>
        <div class="help"><p><b>How to play.</b> Build a Lumber Hut and a Forager Hut first so you have wood and food. Idle villagers automatically build construction sites. Tap a building to add or remove workers, or use the Villagers tab to give anyone a job.</p>
        <p><b>Seasons.</b> Each season lasts three days. Spring blossom, summer sun, autumn apples, then snow — fields and berry bushes grow slowly in winter, so stock up. On the second day of every season the village holds a festival at dusk: everyone dances round the campfire, and it lifts their spirits for a whole day.</p>
        <p><b>Gift chests</b> appear in the woods now and then — tap one to open it. Tap the campfire to rename your village, and the pencil next to anyone's name to rename them. Double-tap a villager to follow them around; the house button brings you home.</p>
        <p>Cottages bring new villagers, as long as there is food and folks are happy. Decorations raise happiness, which makes everyone work faster. Level up to unlock new buildings, then settle more clearings from the World map.</p>
        <p><b>Controls.</b> Drag to move · scroll or pinch to zoom · right-drag, two-finger twist or <kbd>Q</kbd>/<kbd>E</kbd> to rotate · <kbd>WASD</kbd> to pan · <kbd>R</kbd> rotates while placing · <kbd>Space</kbd> pauses · <kbd>Esc</kbd> cancels.</p>
        <p>Your village saves automatically in this browser.</p></div>
        <div class="actions"><button class="btn red" data-act="reset">${svg('trash', 16)} Start a new village</button></div>`;
    } else if (k === 'log') {
      h += s.log.map(l => `<div class="logline"><small>Day ${Math.floor(l.t / DAY) + 1}</small>${esc(l.msg)}</div>`).join('') || '<p>No news yet.</p>';
      this.seenLog = s.log.length; this.markLog();
    } else if (k === 'magic') {
      const m = s.magic, cap = sim.manaCap(), next = SPELLS.find(sp => !m.known.includes(sp.id));
      if (!cap) h += `<p class="sub" style="font-size:13.5px">Build a <b>Wizard Tower</b> (level 4) and give it apprentices. They gather mana and slowly learn the spells below.</p>`;
      h += `<div class="summary"><span class="chip">${svg('staff', 18)}Mana ${Math.floor(m.mana)} / ${cap}</span>${next ? `<span class="chip">${svg('star', 18)}Studying ${esc(next.name)} · ${Math.floor(m.study / next.study * 100)}%</span>` : '<span class="chip">All spells learned</span>'}</div>
        <div class="prog"><i style="width:${cap ? m.mana / cap * 100 : 0}%;background:linear-gradient(90deg,#b18cff,#7fd8ff)"></i></div><div class="grid">`;
      for (const sp of SPELLS) {
        const known = m.known.includes(sp.id), c = sim.canCast(sp.id);
        h += `<div class="tile ${known ? '' : 'locked'}"><div class="top">${svg(known ? sp.icon : 'lock', 24)}${esc(sp.name)}</div><div class="small">${esc(sp.desc)}</div>
          <button class="btn sm" style="${known ? 'background:linear-gradient(#b18cff,#7a5ad8);border-color:#4a2f8a' : ''}" data-act="cast" data-id="${sp.id}" ${c.ok ? '' : 'disabled'}>${svg('staff', 14)} ${known ? (c.ok ? `Cast · ${sp.cost} mana` : esc(c.why)) : 'Not learned yet'}</button></div>`;
      }
      h += `</div>`;
    } else if (k === 'merchant') {
      const m = s.merchant;
      if (!m || m.state !== 'here') h += `<p class="sub" style="font-size:13.5px">${m && m.state === 'arriving' ? 'The merchant\'s cart is rolling up the road…' : 'The merchant is out on the road. Check back soon — they visit every few days.'}</p>`;
      else {
        h += `<div class="summary"><span class="chip">${svg('clock', 18)}Leaving in ${Math.ceil(m.t)}s</span></div><div class="grid">`;
        m.offers.forEach((o, i) => {
          const [gr, gn] = Object.entries(o.give)[0], [rr, rn] = Object.entries(o.get)[0];
          h += `<div class="tile" style="align-items:center;text-align:center"><div class="top" style="justify-content:center">${svg(GOODS[gr].icon, 26)}${gn}<span style="margin:0 4px">→</span>${svg(GOODS[rr].icon, 26)}${rn}</div>
            <div class="small">Trade ${gn} ${GOODS[gr].name.toLowerCase()} for ${rn} ${GOODS[rr].name.toLowerCase()}</div>
            <button class="btn sm ${o.bought ? 'ghost' : ''}" data-act="deal" data-i="${i}" ${o.bought || !sim.canAfford(o.give) ? 'disabled' : ''}>${o.bought ? 'Sold!' : 'Trade'}</button></div>`;
        });
        h += `</div>`;
      }
    } else if (k === 'stats') {
      const ach = sim.achievements();
      h += `<div class="grid ach">${ach.map(({ a, p, done, claimed }) => `<div class="tile ${claimed ? 'got' : done ? 'ready' : ''}"><div class="top">${svg(a.icon, 24)}${esc(a.name)}</div>
        <div class="small">${esc(a.desc)}</div><div class="prog" style="margin:2px 0"><i style="width:${p / a.n * 100}%;background:linear-gradient(90deg,#9be86d,#4fae32)"></i></div>
        ${claimed ? `<span class="small">${svg('star', 12)} Earned</span>` : done ? `<button class="btn gold sm" data-act="ach" data-id="${a.id}">Claim ${svg('gem', 12)}${a.gems}</button>` : `<span class="small">${fmt(p)}/${fmt(a.n)} · ${svg('gem', 12)}${a.gems}</span>`}</div>`).join('')}</div>
        <h3 style="margin:14px 0 6px">Village records</h3>`;
      const st = s.stats;
      const built = Object.values(st.built).reduce((a, b) => a + b, 0);
      h += `<div class="grid">${[
        ['clock', 'Days', Math.floor(s.time / DAY) + 1], ['people', 'Villagers', s.villagers.length], ['hammer', 'Buildings', built],
        ['flower', 'Decorations', st.decor], ['axe', 'Trees felled', st.felled || 0], ['sapling', 'Saplings planted', st.produced.sapling || 0],
        ['coin', 'Coins traded', st.earned], ['smile', 'Happiness', Math.round(s.happiness)],
        ['baby', 'Babies born', st.births || 0], ['flower', 'Passed away', st.deaths || 0], ['clock', 'Oldest villager', st.oldest || 0],
        ['shield', 'Beasts driven off', st.fended || 0], ['staff', 'Spells cast', st.spells || 0],
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
    if (act === 'cast') { if (sim.cast(a.dataset.id)) { this.toast(`${SPELLS.find(o => o.id === a.dataset.id).name}!`, 'staff'); this.closeModal(); return; } }
    if (act === 'ach') { if (sim.claimAch(a.dataset.id)) this.toast('Achievement reward claimed!', 'trophy'); }
    if (act === 'deal') { if (sim.merchantDeal(+a.dataset.i)) this.toast('Pleasure doing business!', 'shop'); }
    if (act === 'placetok') { this.closeModal(); this.openTray('decor'); this.g.startPlace(a.dataset.t); this.markCard(a.dataset.t); return; }
    if (act === 'openb') { const b = sim.bById.get(+a.dataset.id); if (b) { this.closeModal(); this.g.select({ kind: 'b', b }, true); } return; }
    if (act === 'vf') { this.vFilter = a.dataset.f; this.drawModal(true); return; }
    if (act === 'autoassign') { const n = sim.autoAssign(); this.toast(n ? `${n} villager${n > 1 ? 's' : ''} got a job` : 'No open jobs — build or upgrade workplaces', 'people'); sfx.pop(); }
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
    if (act === 'music') { this.g.setSetting('music', !this.g.settings.music); }
    if (act === 'quality') { const q = this.g.settings.quality; this.g.setSetting('quality', q === 'high' ? 'medium' : q === 'medium' ? 'low' : 'high'); this.g.save(); location.reload(); return; }
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

  // a soft, illustrated map: smooth land and water, blob forests, round village medallions
  drawMinimap() {
    const cv = $('#minimap'); if (!cv) return;
    const g = cv.getContext('2d'), W = this.sim.world, S = cv.width / N;
    const base = document.createElement('canvas'); base.width = N; base.height = N;
    const img = base.getContext('2d').createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      let c = [140, 196, 98];
      if (W.type[i] === T_WATER) c = [96, 184, 230];
      else if (W.type[i] === T_SAND) c = [232, 214, 158];
      if (W.wear[i] > 0.3 || W.paved[i]) c = [214, 178, 122];
      img.data.set([...c, 255], i * 4);
    }
    base.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.fillStyle = '#8cc462'; g.fillRect(0, 0, cv.width, cv.height);
    g.filter = 'blur(1.5px)'; g.drawImage(base, 0, 0, cv.width, cv.height); g.filter = 'none';
    // forests as overlapping soft blobs
    for (const [col, r, step] of [['#4f9440', 0.95, 1], ['#62a84c', 0.6, 2]]) {
      g.fillStyle = col;
      for (let i = 0; i < W.trees.length; i += step) {
        const t = W.trees[i]; if (!t.alive) continue;
        g.beginPath(); g.arc((t.x + N / 2) * S, (t.z + N / 2) * S, S * r * t.s, 0, Math.PI * 2); g.fill();
      }
    }
    g.fillStyle = '#9a9d9f';
    for (const r of W.rocks) if (r.alive) { g.beginPath(); g.arc((r.x + N / 2) * S, (r.z + N / 2) * S, S * 0.45, 0, Math.PI * 2); g.fill(); }
    // buildings as little roofs
    for (const b of this.sim.s.buildings) {
      if (isDecor(b.type)) continue;
      const c = this.sim.bCenter(b);
      g.fillStyle = b.type === 'farm' ? '#c9a24a' : b.type === 'tiled' ? '#3f7fc4' : '#c9473d';
      g.beginPath(); g.roundRect((c.x + N / 2 - c.w / 2) * S + 1, (c.z + N / 2 - c.d / 2) * S + 1, c.w * S - 2, c.d * S - 2, 3); g.fill();
    }
    // gift chests
    for (const ch of this.sim.s.chests || []) {
      const ic = iconImage('gift'), x = (ch.x + N / 2) * S, y = (ch.z + N / 2) * S;
      if (ic.complete) g.drawImage(ic, x - 10, y - 10, 20, 20);
    }
    // camera view
    const r = this.g.view.rig;
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2.5; g.setLineDash([6, 4]);
    g.beginPath(); g.roundRect((r.tx + N / 2) * S - 34, (r.tz + N / 2) * S - 24, 68, 48, 10); g.stroke(); g.setLineDash([]);
    // settlement medallions + labels below
    g.font = '600 14px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const st of SETTLEMENTS) {
      const c = CENTERS[st.id], un = this.sim.s.unlocked[st.id], x = (c.x + 0.5) * S, y = (c.z + 0.5) * S;
      if (un) { g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, this.sim.settlementRadius(st.id) * S, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = un ? '#fff8e8' : '#f3e2bf'; g.strokeStyle = '#8a5a2b'; g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill(); g.stroke();
      const ic = iconImage(un ? 'house' : 'lock');
      if (ic.complete) g.drawImage(ic, x - 9, y - 9, 18, 18); else ic.onload = () => this.drawMinimap();
      const nm = this.sim.sname(st.id), tw = g.measureText(nm).width + 14, ly = y + 25;
      g.fillStyle = 'rgba(255,248,232,.95)'; g.strokeStyle = '#c48a4a'; g.lineWidth = 2;
      g.beginPath(); g.roundRect(x - tw / 2, ly - 10, tw, 20, 10); g.fill(); g.stroke();
      g.fillStyle = '#5b3a1e'; g.fillText(nm, x, ly + 1);
    }
  }

  markLog() {
    const n = this.sim.s.log.length - (this.seenLog || 0);
    const b = $('#logBadge'); if (!b) return;
    b.classList.toggle('hidden', n <= 0); b.textContent = n > 9 ? '9+' : n;
  }

  // ── naming a newborn: a little card that doesn't stop the game ──
  askBabyName(kid) {
    (this.babies || (this.babies = [])).push(kid.id);
    if (this.babies.length === 1) this.drawNameCard();
  }
  drawNameCard() {
    const el = $('#namecard'), id = this.babies?.[0], kid = id && this.sim.vById.get(id);
    if (!kid) { this.babies?.shift(); if (this.babies?.length) return this.drawNameCard(); el.classList.add('hidden'); return; }
    const [first, ...rest] = kid.name.split(' '), par = (kid.parents || []).map(p => this.sim.vById.get(p)?.name.split(' ')[0]).filter(Boolean);
    el.innerHTML = `<div class="row">${svg('baby', 30)}<div><b>A baby for ${esc(par.join(' & ') || 'the village')}!</b><br><small>Pick a name, or keep the one the parents chose.</small></div></div>
      <div class="row"><input id="babyName" maxlength="14" value="${esc(first)}" aria-label="Baby's first name"><span style="font-weight:600">${esc(rest.join(' '))}</span></div>
      <div class="row"><button class="btn sm ghost" data-act="babyskip">Keep ${esc(first)}</button><button class="btn sm" data-act="babyok" style="flex:1">${svg('heart', 14)} Name the baby</button></div>`;
    el.classList.remove('hidden');
    clearTimeout(this.babyTimer); this.babyTimer = setTimeout(() => this.nameBaby(true), 40000);
  }
  nameBaby(keep) {
    const id = this.babies?.shift(), kid = id && this.sim.vById.get(id), inp = $('#babyName');
    if (kid && !keep && inp?.value.trim()) {
      const old = kid.name.split(' ')[0];
      this.sim.renameVillager(kid, inp.value.trim().split(' ')[0]);
      if (kid.name.split(' ')[0] !== old) this.toast(`Welcome to the world, ${kid.name.split(' ')[0]}!`, 'baby');
    }
    sfx.pop();
    $('#namecard').classList.add('hidden');
    if (this.babies?.length) setTimeout(() => this.drawNameCard(), 400);
  }

  // ── toasts & floats ──
  toast(msg, icon = 'info', big = false) {
    this.tq = this.tq || [];
    if (this.tq.some(t => t.msg === msg)) return;
    if (/^Level \d+!/.test(msg)) this.tq = this.tq.filter(t => !/^Level \d+!/.test(t.msg));
    const done = / complete!$/.test(msg) && this.tq.find(t => t.done);
    if (done) { done.n++; done.msg = `${done.n} buildings complete!`; return; }
    const joined = / joined the village!$/.test(msg) && this.tq.find(t => t.joined);
    if (joined) { joined.n++; joined.msg = `${joined.n} villagers joined!`; return; }
    this.tq.push({ msg, icon, big, done: / complete!$/.test(msg), joined: / joined the village!$/.test(msg), n: 1 });
    if (!this.toastBusy) this.nextToast();
  }
  nextToast() {
    if (innerWidth < 760 && document.body.classList.contains('info-open') && this.tq.length) { setTimeout(() => this.nextToast(), 600); return; }
    const t = this.tq.shift();
    if (!t) { this.toastBusy = false; return; }
    this.toastBusy = true;
    this.showToast(t.msg, t.icon, t.big);
    setTimeout(() => this.nextToast(), this.tq.length ? 1400 : 600);
  }
  showToast(msg, icon, big) {
    const el = document.createElement('div');
    el.className = 'toast panel' + (big ? ' big' : '');
    el.innerHTML = svg(icon, big ? 30 : 22) + `<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(el);
    while ($('#toasts').children.length > 2) $('#toasts').firstChild.remove();
    setTimeout(() => el.remove(), 2600);
  }
  float(sx, sy, text, icon, cls = '') {
    const el = document.createElement('div');
    el.className = 'float' + (cls ? ' ' + cls : '');
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    el.innerHTML = (icon ? svg(icon, 18) : '') + esc(text);
    $('#floats').appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}
