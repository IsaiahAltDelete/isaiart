// DOM interface: resource bar, clock and forecast, quests, info panel, build tray,
// modals, tooltips, toasts and floating numbers.
import { svg, iconImage } from './icons.js';
import { GOODS, TOP_GOODS, BUILDINGS, DECOR, BUILD_ORDER, DECOR_ORDER, SETTLEMENTS, JOBS, SELLABLE, QUESTS, SYNERGY, CROPS, SPELLS, BEASTS, xpForLevel,
  SEASONS, SEASON_DAYS, FESTIVALS, RARE, FIRST_NAMES, HOME_TYPES, LODGING_TYPES } from './data.js';
import { defOf, isDecor, DAY, workersOf, lvlOf, MAX_LVL, housingOf, storageOf, stageOf } from './sim.js';
import { N, CENTERS, T_WATER, T_SAND } from './world.js';
import { sfx } from './audio.js';
import { FESTIVE } from './data.js';
import { r7Init, r7Frame, r7QuestsHtml, r7GoodHtml, r7WorldRow, r7SiteHtml, r7BuildingHtml, r7VillagerHtml, r7ModalHtml, r7Click, r7Change,
  r7CardTip, r7CardHtml, r7SpecNote, R7_MODALS, R7_LIVE } from './panels.js';   // roads, trade, festivals, friends, share codes
import { rpgVillagerHtml, rpgBuildingHtml, rpgGuildHtml, rpgSpellbookHtml, rpgInfoClick, rpgModalClick, fitStars } from './rpgui.js';
import { eduVillagerHtml, eduBuildingHtml, eduClick, JOB_EDU, TIERS } from './education.js';
import { boardsInit, boardsFrame, boardClick, boardChange, peopleBoardHtml, jobsBoardHtml, buildingsBoardHtml, worldRegionsHtml } from './boards.js';
import {progressBuildingHtml,progressVillagerHtml,progressClick} from './progressui.js';
import { RACES, GENDERS } from './society.js';
import { CLASS_DUTY } from './classduties.js';
import { eventsInit, eventsFrame, eventsBuildingHtml, eventsSettingsHtml, eventsClick } from './events.js';
import { hardshipNoteHtml, fallenHtml } from './hardship.js';
import { CLASSES, classOf, maxHp } from './rpg.js';
import { censusHtml, CENSUS_CSS } from './census.js';
import { expMapHtml, drawExpMap, EXPMAP_CSS } from './expmap.js';
import { lifeInit, wishVillagerHtml, petChip, petRowHtml, wishListHtml, rankQuestRow, chronicleHtml, lifeClick } from './lifeui.js';
import { townInit, townHtml, townClick, townChange, townBuildingHtml, seedHtml, seedClick } from './townui.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(Math.floor(n));
const short = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.floor(n));
const hex = c => '#' + (c ?? 0xb09070).toString(16).padStart(6, '0');   // tolerant: portrait snapshots may lack a colour
const costHtml = (cost, res) => Object.entries(cost || {}).map(([k, v]) =>
  `<span class="${res && (res[k] || 0) < v ? 'no' : ''}">${svg(GOODS[k].icon, 12)}${v}</span>`).join('');
const phone = () => innerWidth < 760;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
// "HH:MM" for a fraction of the day, in ten-minute steps
const hm = f => { const h = ((f % 1) + 1) % 1 * 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 6) * 10).padStart(2, '0')}`; };
const partOfDay = f => f < 0.2 ? 'night' : f < 0.27 ? 'dawn' : f < 0.48 ? 'morning' : f < 0.7 ? 'afternoon' : f < 0.8 ? 'evening' : f < 0.86 ? 'dusk' : 'night';
const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

// Patch a container's DOM toward new HTML, keeping the elements that didn't change.
// Re-rendering by innerHTML every half second swallowed clicks (the button under the
// pointer was replaced between pointerdown and click), reset hover states and closed
// dropdowns; this keeps nodes alive so clicks, focus and scroll all survive refreshes.
function morph(el, html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  patchKids(el, t.content);
}
function patchKids(a, b) {
  const an = [...a.childNodes], bn = [...b.childNodes];
  for (let i = 0; i < bn.length; i++) {
    const x = an[i], y = bn[i];
    if (!x) { a.appendChild(y); continue; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || (x.nodeType === 1 && x.getAttribute('data-key') !== y.getAttribute('data-key'))) { a.replaceChild(y, x); continue; }
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
    if (x.isEqualNode(y)) continue;
    for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
    for (const at of y.attributes) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
    if ((x.tagName === 'SELECT' || x.tagName === 'INPUT') && x === document.activeElement) continue;
    patchKids(x, y);
    if (x.tagName === 'SELECT') for (const o of x.options) o.selected = o.hasAttribute('selected');
    if (x.tagName === 'INPUT') x.value = y.getAttribute('value') ?? '';
  }
  for (let i = an.length - 1; i >= bn.length; i--) an[i].remove();
}

// a little portrait: shirt, face, hair or hat, eyes, cheeks and a smile
export function faceSvg(v, size = 34) {
  const hair = hex(v.hair), skin = hex(v.skin);
  const top = v.race === 'dragonborn' ? '' : v.hat
    ? `<path d="M6 13h20v2H6z" fill="${hex(v.hatColor)}" stroke="#5b3a1e" stroke-width="1"/><path d="M10 13c0-5 12-5 12 0z" fill="${hex(v.hatColor)}" stroke="#5b3a1e" stroke-width="1"/>`
    : `<path d="M9 15c0-7 14-7 14 0-3-2-11-2-14 0z" fill="${hair}" stroke="#5b3a1e" stroke-width="1"/>`;
  const pointed = ['elf', 'halfelf', 'gnome'].includes(v.race) ? `<path d="M10 15L4 11l3 8 4 1M22 15l6-4-3 8-4 1" fill="${skin}" stroke="#5b3a1e"/>` : '';
  const horns = v.race === 'tiefling' ? `<path d="M10 12Q5 5 9 3l3 8M22 12q5-7 1-9l-3 8" fill="${hex(v.horn ?? 0x4a3030)}" stroke="#5b3a1e"/>` : '';
  const features = v.race === 'dwarf' ? `<path d="M10 19q6 3 12 0l-2 7h-8z" fill="${hair}" stroke="#5b3a1e"/>`
    : v.race === 'halforc' ? '<path d="M12 21l1-4 2 4M17 21l2-4 1 4" fill="#fff6db" stroke="#5b3a1e" stroke-width=".5"/>'
    : v.race === 'dragonborn' ? `<path d="M11 18q5-3 10 0l-1 4h-8z" fill="${skin}" stroke="#5b3a1e"/><circle cx="13.5" cy="19" r=".6"/><circle cx="18.5" cy="19" r=".6"/>` : '';
  return `<svg class="face" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><circle cx="16" cy="16" r="15.5" fill="#cfe8f5"/>
    <path d="M4 32c0-7 5-10 12-10s12 3 12 10z" fill="${hex(v.shirt)}" stroke="#5b3a1e" stroke-width="1"/>
    ${pointed}<circle cx="16" cy="16" r="7" fill="${skin}" stroke="#5b3a1e" stroke-width="1"/>${top}${horns}
    <circle cx="13.4" cy="16.5" r="1" fill="#2a1a10"/><circle cx="18.6" cy="16.5" r="1" fill="#2a1a10"/>
    <circle cx="12" cy="18.6" r="1.1" fill="#f29a8a" opacity=".8"/><circle cx="20" cy="18.6" r="1.1" fill="#f29a8a" opacity=".8"/>
    <path d="M14.2 19.2c1 .9 2.6 .9 3.6 0" stroke="#5b3a1e" stroke-width=".9" fill="none" stroke-linecap="round"/>${features}</svg>`;
}

const SHOP = [
  { give: { wood: 150 }, gems: 5 }, { give: { stone: 100 }, gems: 6 }, { give: { food: 120 }, gems: 5 },
  { give: { planks: 60 }, gems: 8 }, { give: { coins: 300 }, gems: 10 }, { give: { bricks: 25 }, gems: 12 },
];

// what each workplace turns into what (for the production-chain view)
const CHAIN = {
  scriptorium: { in: ['cloth', 'crystal'], out: ['scroll'] }, enchanter: { in: ['sword', 'planks', 'iron', 'crystal'], out: ['runeblade', 'wand', 'amulet'] },
  lumber: { out: ['wood'] }, forager: { out: ['food'] }, quarry: { out: ['stone'] }, dock: { out: ['food'] },
  sawmill: { in: ['wood'], out: ['planks'] }, windmill: { in: ['grain'], out: ['flour'] }, bakery: { in: ['flour'], out: ['food'] },
  mason: { in: ['stone'], out: ['bricks'] }, coop: { in: ['grain'], out: ['food'] }, orchard: { out: ['food'] }, beehive: { out: ['honey'] },
  pasture: { out: ['wool'] }, weaver: { in: ['wool'], out: ['cloth'] }, dairy: { out: ['milk'] }, creamery: { in: ['milk'], out: ['cheese'] },
  brewery: { in: ['grain'], out: ['ale'] }, tavern: { in: ['ale', 'cheese', 'honey'], out: [] }, market: { in: [], out: ['coins'] },
};
const farmOut = b => [CROPS[b.data?.crop || 'wheat'].out];
// building types that make / use a good
const makersOf = g => [...Object.keys(CHAIN).filter(t => CHAIN[t].out.includes(g)), ...(g === 'grain' || g === 'food' ? ['farm'] : [])];
const usersOf = g => Object.keys(CHAIN).filter(t => (CHAIN[t].in || []).includes(g));

// build-tray categories; anything new that isn't listed lands in "Services"
const CATS = {
  build: [
    { id: 'all', name: 'All', icon: 'grid' },
    { id: 'homes', name: 'Homes', icon: 'house', types: ['cottage', 'tiled', 'rowhouse', 'hostel', 'manor', 'storehouse'] },
    { id: 'food', name: 'Food', icon: 'apple', types: ['forager', 'farm', 'dock', 'coop', 'orchard', 'windmill', 'bakery', 'beehive', 'dairy', 'creamery'] },
    { id: 'industry', name: 'Industry', icon: 'axe', types: ['clear', 'lumber', 'forester', 'quarry', 'sawmill', 'mason', 'pasture', 'weaver', 'brewery', 'forge', 'enchanter', 'road', 'pave', 'tradepost'] },
    { id: 'serv', name: 'Services', icon: 'staff', types: ['market', 'townhall', 'school', 'library', 'university', 'wizard', 'guild', 'trainingyard'], rest: true },
    { id: 'leisure', name: 'Leisure & Faith', icon: 'smile', types: ['park', 'tavern', 'pub', 'bathhouse', 'theatre', 'chapel', 'temple'] },
    { id: 'def', name: 'Defense', icon: 'shield', types: ['watchtower', 'watchhouse', 'torch', 'palisade'] },
  ],
  decor: [
    { id: 'all', name: 'All', icon: 'grid' },
    { id: 'garden', name: 'Garden', icon: 'flower', types: ['flowers', 'bench', 'lantern', 'hay', 'pumpkins', 'sign', 'well', 'memorial', 'statue'], rest: true },
    { id: 'paths', name: 'Paths & Fences', icon: 'stone', types: ['road', 'pave', 'fence', 'palisade', 'torch'] },
    { id: 'rare', name: 'Treasures', icon: 'gift', types: RARE },
    { id: 'festive', name: 'Festive', icon: 'party', types: Object.values(FESTIVE).flat() },
  ],
};
const CAT_OF = {};
for (const c of CATS.build) for (const t of c.types || []) CAT_OF[t] ??= c.name;

// the weather, as the forecast shows it
const WX = {
  clear:    { name: 'Sunny',    icon: 'sun',      tip: 'Clear skies all day.' },
  cloudy:   { name: 'Cloudy',   icon: 'suncloud', tip: 'Grey skies, but dry.' },
  rain:     { name: 'Rain',     icon: 'rain',     tip: 'A passing shower. Crops grow 60% faster while it rains, and a rainbow often follows.' },
  storm:    { name: 'Storm',    icon: 'storm',    tip: 'Thunder, lightning and heavy rain. Villagers shelter indoors and outdoor work pauses until it passes; workshops like the sawmill and bakery keep going. Crops still enjoy the rain.' },
  snow:     { name: 'Snow',     icon: 'snowfall', tip: 'Soft snowfall. Fields and berry bushes grow slowly in winter.' },
  blizzard: { name: 'Blizzard', icon: 'blizzard', tip: 'Howling snow. Villagers shelter indoors and outdoor work pauses until it blows over.' },
};
const STORMY = k => k === 'storm' || k === 'blizzard';

// sky colours through the day: [day fraction, top, bottom]
const SKY = [
  [0.00, [14, 24, 56], [34, 48, 90]], [0.19, [22, 34, 78], [60, 64, 120]], [0.24, [104, 130, 200], [255, 170, 120]],
  [0.30, [110, 180, 236], [200, 232, 246]], [0.50, [86, 170, 232], [190, 228, 250]], [0.70, [104, 176, 230], [236, 226, 190]],
  [0.77, [104, 100, 180], [255, 150, 98]], [0.83, [42, 52, 112], [138, 90, 140]], [0.90, [16, 26, 62], [38, 50, 94]], [1.00, [14, 24, 56], [34, 48, 90]],
];
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const rgb = c => `rgb(${c.map(v => Math.round(v)).join(',')})`;
function skyAt(f) {
  let i = 0; while (i < SKY.length - 2 && SKY[i + 1][0] <= f) i++;
  const [f0, t0, b0] = SKY[i], [f1, t1, b1] = SKY[i + 1], k = Math.min(1, Math.max(0, (f - f0) / (f1 - f0)));
  return [mix(t0, t1, k), mix(b0, b1, k)];
}
// a point on the dial's arc (quadratic curve 6,44 → 50,-18 → 94,44 in a 100×50 box), as percentages
const arcAt = t => { const u = 1 - t; return [u * u * 6 + 2 * u * t * 50 + t * t * 94, (u * u * 44 + 2 * u * t * -18 + t * t * 44) * 2]; };

// which main-bar button each page belongs to
const DOCK_OF = { villagers: 'people', jobs: 'people', buildings: 'people', population: 'people', town: 'town', inventory: 'town', story: 'journal', chronicle: 'journal', log: 'journal', stats: 'journal', festival: 'journal', worldmap: 'world', trade: 'world', guild: 'world' };
// static tooltips for the HUD: "Title|Body|Key"
const HUD_TIPS = {
  '#btnHome': 'Home|Fly back to your village.|H', '#btnShop': 'Shop|Trade gems for supplies.', '#btnSettings': 'Settings & help|Sound, music, graphics and how to play.|?',
  '#dockbar [data-tab=build]': 'Build|Homes, workplaces and farms, and decorations (G) in the same tray.|B',
  '#dockbar [data-tab=people]': 'People|Everyone in your villages, their jobs, and every building.|V',
  '#dockbar [data-tab=town]': 'Town|Your rank and its goals, government, treasury, safety and wanted posters, and the stores (I).|T',
  '#dockbar [data-tab=journal]': 'Journal|The Story, the yearly Chronicle, news, achievements and festival quests.|N',
  '#dockbar [data-tab=world]': 'World|The map: settle new clearings, see your regions, and trade between them.|M',
  '#profile': '@xp', '#follow': 'Stop following|The camera is following a villager. Tap to stop, or drag the view.',
  '#alert': 'Needs attention|The most urgent problem in your village. Tap to fix it.',
};

export class UI {
  constructor(game) {
    this.g = game;
    this.dirty = { res: true, quests: true, info: true, modal: false };
    this.tray = null;
    this.modal = null;
    this.timer = 0;
    this.shown = {};                        // resource numbers as currently displayed (they tick toward the real values)
    this.catMem = { build: 'all', decor: 'all' };
    this.vFilter = 'all'; this.bFilter = { sid: 'all', cat: 'all' };
    this.initStatic();
    this.initTips();
    this.initKeys();
    r7Init(this);
    this.face = faceSvg; townInit(this); eventsInit(this); lifeInit(this, sfx);
    { const st = document.createElement('style'); st.textContent = CENSUS_CSS; document.head.appendChild(st); }
    boardsInit(this);
  }
  get sim() { return this.g.sim; }

  initStatic() {
    const g = this.g;
    $('#avatar').innerHTML = `<svg viewBox="0 0 32 32" width="52" height="52"><circle cx="16" cy="13" r="7.5" fill="#f2c9a0" stroke="#5b3a1e" stroke-width="1.4"/><path d="M8.5 12c0-7 15-7 15 0-2-2.5-5-3-7.5-3s-5.5.5-7.5 3z" fill="#7a4a26" stroke="#5b3a1e" stroke-width="1.4"/><circle cx="13" cy="14" r="1" fill="#5b3a1e"/><circle cx="19" cy="14" r="1" fill="#5b3a1e"/><path d="M13.5 17.3c1.5 1.2 3.5 1.2 5 0" stroke="#5b3a1e" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M4 32c0-7 5-11 12-11s12 4 12 11z" fill="#5cb85c" stroke="#5b3a1e" stroke-width="1.4"/></svg>`;
    $('#res').innerHTML = TOP_GOODS.map(k => `<div class="pill" data-res="${k}" aria-label="${GOODS[k].name}">${svg(GOODS[k].icon, 26)}<span class="n">0</span><button class="add" data-shop="${k}" aria-label="Get more ${GOODS[k].name}" data-tip="Get more|Open the shop to trade gems for ${GOODS[k].name.toLowerCase()}.">${svg('plus', 14)}</button></div>`).join('');
    $('#res').addEventListener('click', e => {
      if (e.target.closest('.add')) { this.openModal('shop'); return; }
      const pill = e.target.closest('.pill'); if (!pill) return;
      if (this.resTipFor === pill.dataset.res && !$('#restip').classList.contains('hidden')) { this.hideResTip(); this.openModal('inventory'); }
      else this.showResTip(pill);
    });
    $('#res').addEventListener('pointerover', e => { const p = e.target.closest('.pill'); if (p && e.pointerType === 'mouse' && !e.target.closest('.add')) this.showResTip(p); });
    $('#res').addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.hideResTip(); });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('#res') && !e.target.closest('#restip')) this.hideResTip(); });
    $('#restip').addEventListener('click', e => {
      if (e.target.closest('[data-act=inv]')) { this.hideResTip(); this.openModal('inventory'); }
      const go = e.target.closest('[data-act=flaggo]'); if (go) { this.hideResTip(); this.doGo({ kind: 'build', key: go.dataset.go }); }
    });
    // persistent problems are not toasts: beasts / beds sit in the top bar as a status chip
    // (desktop) or above the dock (phone); food and storage problems are badges on their counters
    $('#res').appendChild($('#alert'));
    $('#btnSettings').innerHTML = svg('gear', 22);
    $('#btnHome').innerHTML = svg('home', 24);
    $('#btnHome').onclick = () => g.goHome();
    $('#btnShop').innerHTML = svg('shop', 22);
    $('#btnShop').onclick = () => this.modal === 'shop' ? this.closeModal() : this.openModal('shop');
    $('#nowbar').addEventListener('click', e => {
      const c = e.target.closest('[data-now]'); if (!c) return;
      if (c.dataset.now === 'chest') this.flyToChest();
      else this.modal === c.dataset.now ? this.closeModal() : this.openModal(c.dataset.now);
    });
    $('#follow').onclick = () => g.follow(null);
    $('#info').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const b = $('#info [data-act=renameok]'); if (b) b.click(); } });
    // on smaller screens the clock folds to a slim pill; tap the sky for the forecast
    $('#sky').addEventListener('click', () => { $('#speed').classList.toggle('open'); sfx.click(); });
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
      if (e.target.closest('[data-claimall]')) {
        const ids = this.sim.activeQuests().filter(x => x.done).map(x => x.q.id), fs = this.sim.festShop;
        let n = ids.filter(id => this.sim.claim(id)).length, t = 0;
        if (fs?.open()) for (const q of fs.quests()) if (q.done && !q.claimed && fs.claim(q.id)) { n++; t += q.tokens; }
        if (n) { this.toast(`${n} reward${n > 1 ? 's' : ''} claimed!${t ? ` +${t} festival tokens` : ''}`, 'gem'); this.dirty.quests = true; }
        return;
      }
      const fc = e.target.closest('[data-fclaim]');
      if (fc && this.sim.festShop?.claim(fc.dataset.fclaim)) { this.toast('Festival tokens earned!', 'party'); this.drawQuests(); return; }
      if (e.target.closest('[data-fest]')) { this.openModal('festival'); return; }
      if (e.target.closest('[data-rank]')) { this.openModal('town'); return; }
      if (e.target.closest('[data-fqtoggle]')) { this.fqOpen = !this.fqOpen; sfx.click(); this.drawQuests(); }
    });
    $('#speeds [data-s="0"]').innerHTML = svg('pause', 13);
    // on a phone only the current speed shows, as one thumb-sized button: tapping it steps 1x → 2x → 3x → pause → 1x
    $('#speeds').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const n = $('#speeds').querySelectorAll('button').length; g.setSpeed(innerWidth <= 760 && b.classList.contains('on') ? (+b.dataset.s + 1) % n : +b.dataset.s); sfx.click(); });
    // the main bar: five places, each opening its group of pages (tabs along the top of the window)
    const tabs = { build: ['hammer', 'Build', 'B'], people: ['people', 'People', 'V'], town: ['crest', 'Town', 'T'], journal: ['book', 'Journal', 'N'], world: ['map', 'World', 'M'] };
    document.querySelectorAll('#dockbar [data-tab]').forEach(b => {
      const [ic, label, key] = tabs[b.dataset.tab];
      b.innerHTML = svg(ic, 26) + label + `<span class="kbd">${key}</span><span class="badge hidden"></span><span class="dot hidden"></span>`;
      b.dataset.label = label; b.setAttribute('aria-label', label);
      b.onclick = () => this.dockGo(b.dataset.tab);
    });
    for (const [sel, tip] of Object.entries(HUD_TIPS)) { const el = $(sel); if (el) el.dataset.tip = tip; }
    $('#trayBack').innerHTML = svg('back', 18) + 'Back';
    $('#trayBack').onclick = () => { this.closeTray(); g.cancelPlace(); sfx.click(); };
    $('#trayTabs').addEventListener('click', e => {
      const kb = e.target.closest('[data-kind]');
      if (kb) { if (kb.dataset.kind !== this.tray) { this.openTray(kb.dataset.kind); sfx.click(); } return; }
      const b = e.target.closest('[data-cat]'); if (!b || b.dataset.cat === this.trayCat) return;
      this.setTrayCat(b.dataset.cat); sfx.click();
    });
    $('#cards').addEventListener('click', e => {
      const c = e.target.closest('.card');
      if (!c) return;
      const type = c.dataset.type;
      if (c.classList.contains('locked')) { this.toast(defOf(type).festive ? `The ${defOf(type).name} is sold at the festival shop during its festival` : defOf(type).rare ? `The ${defOf(type).name} can only be found in gift chests in the woods` : this.gateFor(type) ? `${defOf(type).name}: ${this.gateFor(type).why.replace(/^Needs a Library first, to school its workers$/, 'its workers need schooling, so build a Library first')}` : `${defOf(type).name} unlocks at level ${defOf(type).lvl}`, defOf(type).rare ? 'gift' : 'lock'); sfx.error(); return; }
      this.hideTip();
      g.startPlace(type);
      this.markCard(type);
    });
    // edge arrows for the two scrolling rows
    for (const row of ['tabs', 'cards']) for (const side of ['l', 'r']) {
      const a = document.createElement('button'); a.className = 'trayarrow hidden'; a.dataset.row = row; a.dataset.side = side;
      a.setAttribute('aria-label', side === 'l' ? 'Scroll left' : 'Scroll right'); a.innerHTML = svg(side === 'l' ? 'back' : 'next', 14);
      if (row === 'tabs') { a.style.width = a.style.height = '24px'; }
      a.onclick = () => { const el = row === 'tabs' ? $('#trayTabs') : $('#cards'); el.scrollBy({ left: (side === 'l' ? -1 : 1) * el.clientWidth * 0.7, behavior: 'smooth' }); };
      $('#tray .traymain').appendChild(a);
    }
    $('#trayTabs').addEventListener('scroll', () => this.trayEdges(), { passive: true });
    $('#cards').addEventListener('scroll', () => this.trayEdges(), { passive: true });
    addEventListener('resize', () => { if (this.tray) this.trayEdges(); });
    $('#cards').addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { $('#cards').scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    $('#pCancel').innerHTML = svg('close', 22); $('#pRot').innerHTML = svg('rotate', 22); $('#pOk').innerHTML = svg('check', 22);
    $('#pCancel').dataset.tip = 'Cancel|Stop placing.|Esc'; $('#pRot').dataset.tip = 'Rotate|Turn the building.|R';
    $('#pCancel').onclick = () => g.cancelPlace();
    $('#pRot').onclick = () => g.rotatePlace();
    $('#pOk').onclick = () => g.confirmPlace();
    $('#mClose').innerHTML = svg('close', 18);
    $('#mClose').dataset.tip = 'Close|Esc';
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

  // ── tooltips: one floating card, hover on desktop, long-press on touch ──
  initTips() {
    const tip = $('#tip');
    document.addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse') return;
      const el = e.target.closest?.('[data-tip]');
      if (el && el === this.tipEl) { clearTimeout(this.tipT); return; }
      clearTimeout(this.tipT);
      if (!el) { if (this.tipEl) this.tipT = setTimeout(() => this.hideTip(), 90); return; }
      this.tipT = setTimeout(() => this.showTip(el), tip.classList.contains('on') ? 50 : 330);
    });
    document.addEventListener('pointerdown', e => {
      this.lastPtr = e.pointerType;
      clearTimeout(this.tipT); clearTimeout(this.lpT);
      if (e.target.closest?.('#tip')) return;
      const el = e.target.closest?.('[data-tip]');
      if (e.pointerType === 'mouse') { this.hideTip(); return; }
      if (this.tipEl && this.tipEl !== el) this.hideTip();
      if (!el) return;
      this.lp = { x: e.clientX, y: e.clientY };
      this.lpT = setTimeout(() => { this.showTip(el); this.tipLong = true; navigator.vibrate?.(8); }, 430);
    }, true);
    document.addEventListener('pointermove', e => { if (this.lp && Math.hypot(e.clientX - this.lp.x, e.clientY - this.lp.y) > 10) { clearTimeout(this.lpT); this.lp = null; } }, true);
    const up = () => { clearTimeout(this.lpT); this.lp = null; };
    document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
    document.addEventListener('click', e => {
      // a long-press shows the tip instead of tapping the thing
      if (this.tipLong) { this.tipLong = false; e.stopPropagation(); e.preventDefault(); return; }
      const el = e.target.closest?.('[data-tiptap]');
      if (el && this.lastPtr && this.lastPtr !== 'mouse') { if (this.tipEl === el) this.hideTip(); else this.showTip(el); e.stopPropagation(); }
    }, true);
    document.addEventListener('scroll', () => this.hideTip(), true);
    document.addEventListener('contextmenu', e => { if (e.target.closest?.('[data-tip]')) e.preventDefault(); });
  }
  showTip(el) {
    if (!el.isConnected) return;
    const html = this.tipHtml(el); if (!html) return;
    const tip = $('#tip'), wasOn = tip.classList.contains('on');
    tip.innerHTML = html;
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, cx = r.left + r.width / 2;
    const above = r.top - th - 12 > 4 && (r.top + r.height / 2 > innerHeight * 0.4 || r.bottom + th + 14 > innerHeight);
    const left = Math.max(8, Math.min(innerWidth - tw - 8, cx - tw / 2));
    const top = above ? r.top - th - 11 : Math.min(innerHeight - th - 6, r.bottom + 11);
    const ax = Math.max(14, Math.min(tw - 14, cx - left));
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
    tip.style.setProperty('--ax', ax + 'px'); tip.style.setProperty('--oy', above ? '100%' : '0%'); tip.style.setProperty('--dy', above ? '6px' : '-6px');
    tip.classList.toggle('above', above); tip.classList.toggle('below', !above);
    if (!wasOn) void tip.offsetWidth;
    tip.classList.add('on');
    this.tipEl = el;
  }
  hideTip() { clearTimeout(this.tipT); $('#tip').classList.remove('on'); this.tipEl = null; }
  tipHtml(el) {
    const k = el.dataset.tip; if (!k) return '';
    if (k[0] !== '@') {
      const [t, body, key] = k.split('|');
      const kb = key && finePointer() ? `<span class="k">${esc(key)}</span>` : '';
      return body !== undefined ? `<b class="t">${kb}${esc(t)}</b>${body ? `<p>${esc(body)}</p>` : ''}` : `<p>${esc(t)}</p>`;
    }
    const sim = this.sim, s = sim.s;
    if (k === '@card') return this.cardTipHtml(el.dataset.type);
    if (k === '@clock') {
      const f = sim.dayFrac(), fest = sim.festivalToday();
      return `<b class="t">Day ${sim.dayNum() + 1} · ${hm(f)}</b><p>${partOfDay(f)[0].toUpperCase() + partOfDay(f).slice(1)}. A whole day lasts 4 minutes at 1× speed.</p>
        <p>Villagers wake around 05:20 and head to bed around 22:30. After dark, wolves and goblins may prowl in from the forest.</p>
        ${fest ? `<div class="note">${esc(fest.name)} tonight at dusk (17:20).</div>` : ''}${s.weather?.storm ? '<div class="note bad">A storm is raging: everyone is sheltering indoors.</div>' : ''}`;
    }
    if (k === '@season') {
      const sea = sim.season(), d = sim.seasonDay(), fest = sim.festivalToday(), on = sim.festivalActive();
      const next = SEASONS[(sim.seasonIdx() + 1) % 4], left = SEASON_DAYS - d;
      const nf = fest ? null : d === 0 ? FESTIVALS[sea.id] : FESTIVALS[next.id];
      return `<b class="t">${esc(sea.name)} · day ${d + 1} of ${SEASON_DAYS}</b><p>${esc(sea.blurb)}</p>
        ${fest ? `<div class="note good">${svg('party', 14)} <b>${esc(fest.name)}</b> ${on ? 'is on now!' : 'tonight at dusk.'} ${esc(fest.desc)} Everyone feasts afterwards and stays happier for a day.</div>` : ''}
        <p>${esc(next.name)} arrives in ${left} day${left > 1 ? 's' : ''}.${nf ? ` Next festival: ${esc(nf.name)} (${d === 0 ? 'tomorrow' : `in ${left + 1} days`}).` : ''}</p>`;
    }
    if (k === '@wx') {
      const e = sim.forecast(3)[+el.dataset.i], w = WX[e.kind], wet = e.len > 0;
      const when = wet ? `${hm(e.start)}–${hm(e.start + e.len)}` : '';
      const day = +el.dataset.i === 0 ? 'Today' : +el.dataset.i === 1 ? 'Tomorrow' : `Day ${e.d + 1}`;
      return `<b class="t">${day}: ${w.name}${when ? ` · ${when}` : ''}</b><p>${esc(w.tip)}</p>${STORMY(e.kind) ? '<div class="note bad">Plan ahead: builders and gatherers stop while it blows.</div>' : ''}`;
    }
    if (k === '@speed') {
      const n = +el.dataset.s;
      return [`<b class="t">${finePointer() ? '<span class="k">Space</span>' : ''}Pause</b><p>Freeze time. You can still build and plan.</p>`,
        `<b class="t">${finePointer() ? '<span class="k">1</span>' : ''}Normal speed</b><p>A day lasts 4 minutes.</p>`,
        `<b class="t">${finePointer() ? '<span class="k">2</span>' : ''}Double speed</b>`,
        `<b class="t">${finePointer() ? '<span class="k">3</span>' : ''}Triple speed</b><p>Handy for waiting on harvests and builds.</p>`][n];
    }
    if (k === '@xp') {
      const need = xpForLevel(s.level), nx = [...Object.entries(BUILDINGS), ...Object.entries(DECOR)].filter(([, d]) => d.lvl === s.level + 1).map(([, d]) => d.name);
      return `<b class="t">Level ${s.level}</b><p>${Math.floor(s.xp)} / ${need} xp (${Math.floor(s.xp / need * 100)}%). ${need - Math.floor(s.xp)} xp to level ${s.level + 1}.</p>
        <p>Earn xp by finishing buildings, completing quests and bringing goods home.</p>${nx.length ? `<div class="note good">Level ${s.level + 1} unlocks ${esc(nx.join(', '))}.</div>` : ''}`;
    }
    if (k === '@stat') return `<b class="t">${esc(el.dataset.t)}</b><p>${esc(el.dataset.b)}</p>`;
    return '';
  }

  // ── keyboard shortcuts (the game handles WASD, Q/E, R, Space, 1-3, B and Esc) ──
  initKeys() {
    addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, select, textarea')) return;
      const k = e.key.toLowerCase(), toggle = m => this.modal === m ? this.closeModal() : this.openModal(m);
      if (k === 'escape') { this.hideTip(); this.hideResTip(); return; }
      if (k === 'v') this.dockGo('people');
      else if (k === 'l') toggle('buildings');
      else if (k === 'i') toggle('inventory');
      else if (k === 't') this.dockGo('town');
      else if (k === 'm') this.dockGo('world');
      else if (k === 'n') this.dockGo('journal');
      else if (k === '?' || k === 'f1') { e.preventDefault(); toggle('settings'); }
      else if (k === 'g') this.tray === 'decor' ? this.closeTray() : this.openTray('decor');
      else if (k === 'h') this.g.goHome();
      else if ((k === '[' || k === ']') && this.tray) {
        const cats = this.trayCats(), i = cats.findIndex(c => c.id === this.trayCat);
        this.setTrayCat(cats[(i + (k === ']' ? 1 : cats.length - 1)) % cats.length].id); sfx.click();
      }
    });
  }

  // ── per-frame ──
  frame(dt) {
    const s = this.sim.s;
    this.timer += dt;
    if (this.dirty.res) { this.dirty.res = false; this.drawRes(); }
    if (this.resAnim) this.tweenRes(dt);
    if (this.dirty.quests) { this.dirty.quests = false; this.drawQuests(); }
    if (this.timer > 0.5) {
      this.timer = 0;
      this.drawInfo();
      this.drawAlert();
      this.drawCoach();
      this.drawForecast();
      this.drawNow();
      this.markLog();
      const ae = document.activeElement;
      if (this.modal && ['villagers', 'jobs', 'buildings', 'population', 'inventory', 'stats', 'worldmap', 'merchant', 'magic', 'guild', 'town', 'story', ...R7_LIVE].includes(this.modal) && !($('#modal').contains(ae) && /SELECT|INPUT/.test(ae.tagName))) this.drawModal(true);
      this.drawQuests();
      r7Frame(this);
      eventsFrame(this);
      boardsFrame(this);
      if (this.tray) this.refreshCards();
      if (this.tipEl && (!this.tipEl.isConnected || !this.tipEl.offsetParent)) this.hideTip();
    }
    this.drawClock(dt);
    const fv = this.g.followV, fk = fv ? fv.id + fv.name : '';
    if (fk !== this.lastFollow) { this.lastFollow = fk; $('#follow').classList.toggle('hidden', !fv); if (fv) $('#follow').innerHTML = `${svg('eye', 16)}Following ${esc(fv.name.split(' ')[0])}<span class="stop">Stop</span>`; }
    if (this.lastSpeed !== s.speed) {
      this.lastSpeed = s.speed;
      document.querySelectorAll('#speeds button').forEach(b => b.classList.toggle('on', +b.dataset.s === s.speed));
      const th = $('#speeds .thumb'); th.style.transform = `translateX(${s.speed * 100}%)`; th.classList.toggle('paused', !s.speed);
      $('#sky').classList.toggle('paused', !s.speed);
    }
  }

  // ── the clock: sky colour, sun / moon on the arc, weather in the window ──
  drawClock(dt) {
    const sim = this.sim, s = sim.s, f = sim.dayFrac(), g = this.g, wx = s.weather || {};
    const sky = $('#sky');
    // the orb moves every frame; colours only need a few updates a second
    const day = f >= 0.21 && f < 0.79, t = day ? (f - 0.21) / 0.58 : ((f - 0.79 + 1) % 1) / 0.42;
    const [x, y] = arcAt(t), orb = $('#orb');
    orb.style.left = x.toFixed(2) + '%'; orb.style.top = y.toFixed(2) + '%';
    if (orb.dataset.k !== String(day)) { orb.dataset.k = day; orb.className = day ? 'sun' : 'moon'; }
    const fk = g.flashK || 0;
    if (fk > 0.01 || this.boltOn) { this.boltOn = fk > 0.01; sky.querySelector('.bolt').style.opacity = (fk * 0.85).toFixed(3); }
    this.clockT = (this.clockT || 0) + dt;
    const clock = hm(f);
    // keyed on the day too: a time jump to the same HH:MM on another day must still redraw day, season and festival
    const dayKey = sim.dayNum() + '|' + clock;
    if (this.lastClock !== dayKey) {
      this.lastClock = dayKey;
      $('#clockT').innerHTML = clock.replace(':', '<i>:</i>');
      $('#clockP').textContent = partOfDay(f);
      $('#clockD').textContent = `Day ${sim.dayNum() + 1}`;
      this.drawSeason();
    }
    if (this.clockT < 0.25 && this.skyDone) return;
    this.clockT = 0; this.skyDone = true;
    const rk = g.rainK ?? (wx.rain ? 1 : 0), sk = g.stormK ?? (wx.storm ? 1 : 0), ck = g.cloudK ?? (wx.cloud || 0);
    let [top, bot] = skyAt(f);
    const night = day ? Math.max(0, 1 - Math.min(1, Math.sin(t * Math.PI) * 2.6)) : 1;
    const grey = Math.max(ck * 0.35, rk * 0.55) + sk * 0.3;
    top = mix(top, mix([128, 142, 158], [28, 34, 52], night), grey); bot = mix(bot, mix([168, 178, 188], [44, 52, 72], night), grey);
    if (sk > 0.05) { top = mix(top, [52, 60, 74], sk * 0.45 * (1 - night * 0.5)); bot = mix(bot, [86, 94, 106], sk * 0.4 * (1 - night * 0.5)); }
    sky.style.setProperty('--sky1', rgb(top)); sky.style.setProperty('--sky2', rgb(bot));
    sky.querySelector('.stars').style.opacity = (Math.max(0, night - grey * 0.8) * 0.95).toFixed(2);
    sky.querySelector('.clouds').style.opacity = Math.min(1, Math.max(ck * 0.75, rk * 0.9, sk)).toFixed(2);
    sky.querySelector('.rainfx').style.opacity = Math.min(1, rk * (0.75 + sk * 0.25)).toFixed(2);
    orb.style.opacity = (1 - Math.min(0.75, grey * 0.9)).toFixed(2);
    const si = sim.seasonIdx(), winter = si === 3;
    sky.classList.toggle('storm', sk > 0.4); sky.classList.toggle('snow', winter); sky.classList.toggle('dark', sk > 0.3 || night > 0.6);
    const H = [[[127, 191, 90], [79, 154, 54]], [[118, 186, 80], [70, 146, 48]], [[214, 168, 82], [176, 112, 52]], [[236, 242, 248], [196, 212, 228]]][si];
    const nk = night * 0.72 + grey * 0.2;
    $('#hill1').setAttribute('fill', rgb(mix(H[0], [26, 38, 58], nk))); $('#hill2').setAttribute('fill', rgb(mix(H[1], [18, 28, 44], nk)));
  }
  drawSeason() {
    const sim = this.sim, sea = sim.season(), d = sim.seasonDay(), fest = sim.festivalToday(), on = sim.festivalActive();
    const pips = Array.from({ length: SEASON_DAYS }, (_, i) => `<i class="${i < d ? 'on' : i === d ? 'now' : ''}"></i>`).join('');
    const html = `<span class="sb">${svg(sea.icon, 16)}${esc(sea.name)}<span class="pips" aria-label="day ${d + 1} of ${SEASON_DAYS}">${pips}</span></span>${fest ? `<span class="fest${on ? ' now' : ''}">${svg('party', 14)}<span><b>${esc(fest.name)}</b> <em>${on ? 'now!' : sim.dayFrac() > 0.925 ? 'was tonight' : 'tonight'}</em></span></span>` : ''}`;
    if (html !== this.lastSeason) { this.lastSeason = html; $('#season').innerHTML = html; $('#season').setAttribute('aria-label', `${sea.name}, day ${d + 1} of ${SEASON_DAYS}${fest ? `, ${fest.name} tonight` : ''}`); }
  }
  drawForecast() {
    const sim = this.sim, f = sim.dayFrac(), list = sim.forecast(3), night = f < 0.21 || f > 0.82;
    const cells = list.map((e, i) => {
      const w = WX[e.kind], wet = e.len > 0;
      const live = i === 0 && wet && f >= e.start && f < e.start + e.len, done = i === 0 && wet && f >= e.start + e.len;
      const icon = i === 0 && e.kind === 'clear' && night ? 'moon' : i === 0 && done ? 'suncloud' : w.icon;
      const name = i === 0 && done ? 'Cleared' : i === 0 && e.kind === 'clear' && night ? 'Clear' : w.name;
      const when = !wet ? '' : live ? 'now' : done ? `ended ${hm(e.start + e.len)}` : `from ${hm(e.start)}`;
      const lbl = i === 0 ? 'Today' : i === 1 ? 'Tmrw' : `Day ${e.d + 1}`;
      return `<div class="fc${i === 0 ? ' today' : ''}${STORMY(e.kind) && !done ? ' storm' : ''}${live ? ' live' : ''}" data-tip="@wx" data-tiptap data-i="${i}"><small>${lbl}</small>${svg(icon, phone() ? 18 : 22)}<b>${name}</b>${when ? `<span class="when">${when}</span>` : ''}</div>`;
    }).join('');
    if (cells !== this.lastFc) { this.lastFc = cells; morph($('#forecast'), cells); }
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

  // resources: the numbers tick toward their new values instead of jumping
  drawRes() {
    const s = this.sim.s, cap = this.sim.cap();
    for (const el of document.querySelectorAll('#res .pill')) {
      const k = el.dataset.res, n = el.querySelector('.n'), want = s.res[k], was = this.shown[k];
      if (was === undefined) { this.shown[k] = want; n.textContent = fmt(want); }
      else if (Math.floor(was) !== Math.floor(want)) {
        this.resAnim = true;
        const prev = +n.dataset.t || 0;
        if (want > prev) restart(n, 'bump'); else if (want < prev - 4) restart(n, 'drop');
      }
      n.dataset.t = want;
      n.classList.toggle('full', !!GOODS[k].capped && want >= cap);
    }
    const need = xpForLevel(s.level);
    $('#lvl').textContent = s.level;
    $('#xpfill').style.width = Math.min(100, s.xp / need * 100) + '%';
    $('#xptext').textContent = phone() ? `${short(s.xp)}/${short(need)}` : `${Math.floor(s.xp)} / ${need}`;
  }
  tweenRes(dt) {
    const s = this.sim.s, snap = reduced();
    let moving = false;
    for (const el of document.querySelectorAll('#res .pill')) {
      const k = el.dataset.res, want = s.res[k];
      let v = this.shown[k] ?? want;
      if (v === want) continue;
      v = snap || Math.abs(want - v) < 1 ? want : v + (want - v) * Math.min(1, dt * 9);
      this.shown[k] = v; moving ||= v !== want;
      const txt = fmt(v), n = el.querySelector('.n');
      if (n.textContent !== txt) n.textContent = txt;
    }
    this.resAnim = moving;
  }

  drawQuests() {
    // compact: one festival row (expands on click), one "rewards to claim" row, then at most
    // a few in-progress quests, so the panel never runs down the whole screen
    const list = this.sim.activeQuests(), fs = this.sim.festShop, fopen = !!fs?.open();
    const fq = fopen ? fs.quests() : [], fready = fq.filter(q => q.done && !q.claimed);
    const doneQ = list.filter(x => x.done), todo = list.filter(x => !x.done);
    const rw = q => `${q.reward.gems ? `<span>${svg('gem', 12)}${q.reward.gems}</span>` : ''}${q.reward.coins ? `<span>${svg('coin', 12)}${q.reward.coins}</span>` : ''}${q.reward.xp ? `<span>${svg('xp', 12)}${q.reward.xp} xp</span>` : ''}`;
    let html = '';
    if (fopen) {
      const f = fs.current(), nd = fq.filter(q => q.done).length, tok = fq.reduce((n, q) => n + (q.claimed ? 0 : q.tokens), 0);
      html += `<div class="quest qrow qfest${this.fqOpen ? ' open' : ''}" data-key="fest"><div class="row"><button class="qtog" data-fqtoggle aria-expanded="${!!this.fqOpen}">${svg('party', 16)}<span class="t">${esc(f.name)}<small class="qmeta">${nd}/${fq.length} festival quests · ${tok} token${tok === 1 ? '' : 's'}</small></span><span class="chev">▾</span></button><button class="go" data-fest aria-label="Festival shop" data-tip="Festival shop|Spend festival tokens on seasonal decorations.">${svg('shop', 16)}</button></div>`;
      if (this.fqOpen) html += `<div class="qsub">${fq.map(q => `<div class="row"><span class="t">${svg(q.icon, 13)} ${esc(q.title)}</span>${q.claimed ? `<span class="r7got">${svg('check', 12)}</span>` : q.done ? `<button class="btn sm gold" data-fclaim="${q.id}">+${q.tokens}</button>` : `<span class="qmeta">${fmt(q.p)}/${fmt(q.n)}</span>`}</div><div class="bar"><i style="width:${q.p / q.n * 100}%"></i></div>`).join('')}</div>`;
      html += `</div>`;
    }
    const nReady = doneQ.length + fready.length;
    if (nReady === 1 && doneQ.length) {
      const { q } = doneQ[0];
      html += `<div class="quest qrow done" data-key="claim"><div class="row"><span class="t">${esc(q.title)}</span><button class="btn sm gold claim" data-claim="${q.id}">Claim</button></div><div class="rw">${rw(q)}</div></div>`;
    } else if (nReady) {
      html += `<div class="quest qrow done" data-key="claim"><div class="row">${svg('gift', 18)}<span class="t">${nReady} rewards ready</span><button class="btn sm gold claim" data-claimall>Claim all</button></div></div>`;
    }
    const room = Math.max(1, 3 - (fopen ? 1 : 0) - (nReady ? 1 : 0));
    html += todo.slice(0, room).map(({ q, p }) => `
      <div class="quest" data-key="q${q.id}">
        <div class="row"><span class="t">${esc(q.title)}</span><span class="qmeta">${fmt(p)}/${fmt(q.n)}</span>${this.goFor(q) ? `<button class="go" data-go="${q.id}" aria-label="Show me" data-tip="Show me|Jump to where you can do this.">${svg('target', 16)}</button>` : ''}</div>
        <div class="qbar"><div class="bar"><i style="width:${p / q.n * 100}%"></i></div><div class="rw">${rw(q)}</div></div>
      </div>`).join('');
    if (todo.length < room) html += rankQuestRow(this);
    if (!html) html = '<div class="quest">All quests complete — you\'re a master builder!</div>';
    if (html !== this.lastQuests) { this.lastQuests = html; morph($('#qlist'), html); }
    const ready = nReady;
    // phone: the toast lane sits below whichever is lower, the quest panel or the clock panel (never over the speed buttons)
    if (phone()) {
      const qr = $('#quests').getBoundingClientRect(), sr = $('#speed').getBoundingClientRect();
      const qb = Math.round(Math.max(sr.bottom, qr.height ? qr.bottom : 0) + 8) + 'px';
      if (document.body.style.getPropertyValue('--qb') !== qb) document.body.style.setProperty('--qb', qb);
    }
    const qh = svg('star', 18) + 'Quests' + (ready ? ` <span class="badge" style="position:static">${ready}</span>` : '');
    if (qh !== this.lastQh) { this.lastQh = qh; $('#qhead').innerHTML = qh; }
  }

  // what a good is, where it comes from, what uses it
  goodInfo(k, full = true) {
    const g = GOODS[k], s = this.sim.s, rt = Math.round(this.sim.rate(k));
    return `<div class="gi-top">${svg(g.icon, 30)}<div><b>${esc(g.name)}</b><span>${fmt(s.res[k])}${g.capped ? ` / ${this.sim.cap()}` : ''}${g.price ? ` · sells ${g.price}` : ''}${rt ? ` · <i class="${rt > 0 ? 'up' : 'down'}">${rt > 0 ? '+' : ''}${rt}/min</i>` : ''}</span></div></div>
      <p>${esc(g.desc || '')}</p>
      ${full && this.resFlags?.[k] ? `<div class="gi-flag ${this.resFlags[k].cls}"><span>${esc(this.resFlags[k].text)}</span><button class="btn sm gold" data-act="flaggo" data-go="${this.resFlags[k].go}">${esc(this.resFlags[k].btn)}</button></div>` : ''}
      ${g.from ? `<div class="gi-row"><em>From</em>${esc(g.from)}</div>` : ''}${g.uses ? `<div class="gi-row"><em>Used for</em>${esc(g.uses)}</div>` : ''}
      ${r7GoodHtml(this, k)}${full ? `<button class="btn sm ghost" data-act="inv">${svg('bag', 14)} Open inventory</button>` : ''}`;
  }
  showResTip(pill) {
    const k = pill.dataset.res, tip = $('#restip');
    if (this.resTipFor === k && !tip.classList.contains('hidden')) return;
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
    const cats = CATS[g.tray], cur = cats.find(c => c.id === (this.tray === g.tray ? this.trayCat : this.catMem[g.tray]));
    this.openTray(g.tray, g.type && !this.catTypes(g.tray, cur).includes(g.type) ? 'all' : undefined);
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
    if (prowl) a = { icon: 'shield', text: `${prowl === 1 ? 'A beast is' : `${prowl} beasts are`} prowling — ${s.buildings.some(b => b.type === 'watchtower' && b.built) ? 'guards are on it' : 'build a Watchtower!'}`, short: prowl === 1 ? 'Beast prowling!' : `${prowl} beasts prowling!`, go: 'watchtower' };
    else if (pop > sim.housing()) a = { icon: 'house', text: 'Not enough beds — build a Cottage', short: 'Need beds', go: 'cottage' };
    // badges on the resource counters
    const flags = {}, cap = sim.cap();
    if (hungry) flags.food = { cls: 'bad', label: '!', text: `${hungry} villager${hungry > 1 ? 's are' : ' is'} hungry — gather more food (Forager Hut, farms, fishing)`, go: 'forager', btn: 'Build a Forager Hut' };
    else if (s.res.food < pop * 2 && fr <= 5) flags.food = { cls: 'warn', label: '!', text: 'Food is running low — gather more (Forager Hut, farms, fishing)', go: 'forager', btn: 'Build a Forager Hut' };
    for (const k of TOP_GOODS) if (!flags[k] && GOODS[k].capped && s.res[k] >= cap) flags[k] = { cls: 'full', label: 'FULL', text: `${GOODS[k].name} storage is full — build or upgrade a Storehouse`, go: 'storehouse', btn: 'Build a Storehouse' };
    this.resFlags = flags;
    for (const p of document.querySelectorAll('#res .pill')) {
      const f = flags[p.dataset.res]; let fl = p.querySelector('.flag');
      p.classList.toggle('flagged', !!f);
      if (!f) { fl?.remove(); continue; }
      if (!fl) { fl = document.createElement('span'); p.appendChild(fl); }
      if (fl.className !== 'flag ' + f.cls) fl.className = 'flag ' + f.cls;
      if (fl.textContent !== f.label) fl.textContent = f.label;
      p.setAttribute('aria-label', `${GOODS[p.dataset.res].name}: ${f.text}`);
    }
    const el = $('#alert');
    const key = a ? a.text : '';
    if (key === this.lastAlert) return;
    this.lastAlert = key;
    el.classList.toggle('hidden', !a);
    el.classList.toggle('calm', !!a?.calm);
    if (a) { el.innerHTML = svg(a.icon, 18) + `<span class="full">${esc(a.text)}</span><span class="short">${esc(a.short)}</span>`; el.dataset.go = a.go; el.dataset.tip = `Needs attention|${a.text}. Tap to fix it.`; }
  }

  // ── info panel ──
  drawInfo(force) {
    const sel = this.g.selected, el = $('#info');
    document.body.classList.toggle('info-open', !!sel);
    if (!sel) { el.classList.add('hidden'); this.infoKey = null; return; }
    if (!force && el.contains(document.activeElement) && ['SELECT', 'INPUT'].includes(document.activeElement.tagName)) return;
    const key = sel.kind === 'b' ? 'b' + sel.b?.id : 'v' + sel.v?.id;
    if (this.renaming && this.renaming !== key) this.renaming = null;
    const wasHidden = el.classList.contains('hidden');
    el.classList.remove('hidden');
    if (wasHidden) restart(el, 'in');
    const html = sel.kind === 'b' ? this.buildingInfo(sel.b) : this.villagerInfo(sel.v);
    if (key !== this.infoKey) {
      el.innerHTML = html; el.scrollTop = 0;
      if (!wasHidden && this.infoKey) { const w = el.querySelector('.ipwrap'); if (w) w.classList.add('swap'); }
      this.infoKey = key;
    } else if (html !== this.lastInfo) morph(el, html);
    this.lastInfo = html;
  }
  // same-type neighbours for the ‹ › arrows
  sameType(b) { return this.sim.s.buildings.filter(o => o.type === b.type).sort((a, c) => a.id - c.id); }
  // a short, honest status for a building
  bStatus(b) {
    const sim = this.sim, s = sim.s, def = defOf(b.type);
    if (!b.built) return { cls: 'info', dot: 'warn', text: `Under construction · ${Math.floor(b.progress * 100)}%` };
    if (b.fire) return { cls: 'bad', dot: 'bad', text: 'On fire!' };
    if (b.up?.repair) return { cls: 'info', dot: 'warn', text: `Repairing · ${Math.floor(b.up.progress * 100)}%` };
    if (b.damaged) return { cls: 'bad', dot: 'bad', text: 'Damaged · needs repair' };
    if (b.up) return { cls: 'info', dot: 'warn', text: `Upgrading · ${Math.floor(b.up.progress * 100)}%` };
    if (!def.workers) {
      if (def.housing) { const n = s.villagers.filter(v => sim.bedFor(v).b === b).length; return { cls: n ? 'ok' : 'info', dot: n ? 'ok' : 'off', text: `${n}/${housingOf(b)} beds used` }; }
      return null;
    }
    const ws = b.workers.map(id => sim.vById.get(id)).filter(Boolean), cap = workersOf(b);
    if (!ws.length) return { cls: 'bad', dot: 'bad', text: 'No workers' };
    if (s.weather?.storm && ws.every(v => /shelter/i.test(v.task?.label || ''))) return { cls: 'warn', dot: 'warn', text: 'Sheltering from the storm' };
    if (ws.every(v => v.asleep)) return { cls: 'info', dot: 'off', text: 'Workers are asleep' };
    if (b.status) return { cls: 'warn', dot: 'warn', text: b.status };
    if (ws.length < cap) return { cls: 'info', dot: 'ok', text: `${ws.length}/${cap} workers · ${(ws.map(v => v.task?.label).find(Boolean) || 'working').toLowerCase()}` };
    const labels = ws.map(v => v.task?.label).filter(Boolean), top = labels.sort((a, c) => labels.filter(x => x === c).length - labels.filter(x => x === a).length)[0];
    return { cls: 'ok', dot: 'ok', text: top || 'Working' };
  }
  buildingInfo(b) {
    const sim = this.sim, def = defOf(b.type), s = sim.s;
    const sname = sim.sname(b.sid), lvl = lvlOf(b);
    const home = [...HOME_TYPES,...LODGING_TYPES].includes(b.type);
    const title = b.type === 'campfire' ? sname : home || b.type === 'wizard' ? sim.homeName(b) : def.name;
    let h = `<button class="x" data-act="close" aria-label="Close" data-tip="Close|Esc">${svg('close', 14)}</button><div class="ipwrap">`;
    // header: picture, name, level, where
    h += `<div class="ip-hd"><img class="thumb" alt="" src="${this.g.thumbs[b.type] || ''}"><div style="min-width:0;flex:1">${this.renaming === 'b' + b.id
      ? `<div class="rename"><input id="renameIn" maxlength="22" value="${esc(home ? b.hname || title : sname)}" aria-label="${home ? 'Home name' : 'Village name'}"><button class="btn sm" data-act="renameok">Save</button></div>`
      : `<h3>${esc(title)}${!isDecor(b.type) ? ` <span class="lvchip">Lv ${lvl}</span>` : ''}${b.type === 'campfire' || home ? `<button class="pen" data-act="rename" aria-label="${home ? 'Rename home' : 'Rename village'}" data-tip="${home ? 'Rename this home|Clear the name to use its owner’s surname again.' : 'Rename your village'}">${svg('pencil', 14)}</button>` : ''}</h3>`}
      <div class="sub">${b.type === 'campfire' ? 'Village campfire · the heart of the settlement' : `${esc(sname)} · ${isDecor(b.type) ? 'decoration' : esc(CAT_OF[b.type] || 'building')}`}</div></div></div>`;
    // browse buildings of this type, or all of them
    if (!isDecor(b.type)) {
      const same = this.sameType(b), i = same.indexOf(b);
      h += `<div class="ip-nav">${same.length > 1 ? `<button class="ar" data-act="bnav" data-d="-1" aria-label="Previous ${esc(def.name)}" data-tip="Previous ${esc(def.name)}">${svg('back', 12)}</button><span class="of">${i + 1} of ${same.length}</span><button class="ar" data-act="bnav" data-d="1" aria-label="Next ${esc(def.name)}" data-tip="Next ${esc(def.name)}">${svg('next', 12)}</button>` : ''}<span class="grow"></span><button data-act="blist" data-tip="All buildings|Every building in your villages, with problems flagged.|L">${svg('list', 14)} All buildings</button></div>`;
    }
    if (!b.built) {
      const builders = s.villagers.filter(v => v.task?.bid === b.id).length;
      h += `<div class="ip-sec"><div class="cap">${svg('hammer', 14)} Construction<span class="r">${Math.floor(b.progress * 100)}%</span></div>
        <div class="pbar"><i style="width:${b.progress * 100}%"></i></div>
        <dl class="kv"><dt>Builders</dt><dd>${builders}</dd>${b.clear.length ? `<dt>Trees to clear</dt><dd>${b.clear.length}</dd>` : ''}</dl>
        <div class="desc">${builders ? 'Idle villagers come and help automatically.' : s.weather?.storm ? 'Builders are sheltering from the storm.' : 'Waiting for an idle villager to help. Free someone up in the Villagers tab.'}</div></div>
        ${r7SiteHtml(this, b)}<div class="actions"><button class="btn red sm" data-act="demolish">${svg('trash', 14)} Cancel (refund)</button></div>`;
      return h + '</div>';
    }
    h += eventsBuildingHtml(this, b);   // on fire, or damaged and waiting for repairs (events.js)
    // live status with progress
    const st = b.damaged || b.fire ? null : this.bStatus(b);
    if (st) {
      let prog = 0;
      if (b.type === 'farm') prog = b.data.stage === 'ripe' ? 1 : b.data.grow || 0;
      else for (const id of b.workers) { const v = sim.vById.get(id); if (v?.act && !v.act.idle && v.act.dur < 999) prog = Math.max(prog, v.act.t / v.act.dur); }
      h += `<div class="ip-sec"><div class="statusline ${st.dot}"><span class="dot"></span><span>${esc(st.text)}</span></div>${def.workers && !b.damaged && !b.fire ? `<div class="pbar"><i style="width:${Math.round(prog * 100)}%"></i></div>` : ''}</div>`;
    }
    // workers as portraits: tap a face to see them, × to send them off, + to hire
    if (def.workers) {
      const cap = workersOf(b), idle = s.villagers.some(v => v.job === 'idle' && stageOf(v) === 'adult');
      let slots = '';
      for (let i = 0; i < cap; i++) {
        const v = sim.vById.get(b.workers[i]);
        slots += v ? `<div class="wslot"><button class="av" data-act="selv" data-id="${v.id}" data-tip="${esc(v.name)}|${esc(v.task?.label || JOBS[v.job].name)}">${faceSvg(v, 38)}</button><button class="rm" data-act="unstaffv" data-id="${v.id}" aria-label="Remove ${esc(v.name)}" data-tip="Remove from this job|They become idle and help with building.">${svg('minus', 10)}</button><span class="nm">${esc(v.name.split(' ')[0])}</span></div>`
          : `<div class="wslot empty"><button class="av" data-act="staff" aria-label="Add a worker" data-tip="${idle ? 'Add a worker|The nearest idle villager takes the job.' : 'No one is idle|Free someone up in the Villagers tab, or build more cottages.'}">${svg('plus', 16).replace('#fff', '#c48a4a')}</button><span class="nm">${idle ? 'Add' : 'No one idle'}</span></div>`;
      }
      if (lvl < MAX_LVL) slots += `<div class="wslot locked"><span class="av">${svg('lock', 16)}</span><span class="nm">Lv ${lvl + 1}</span></div>`;
      h += `<div class="ip-sec"><div class="cap">${svg('people', 14)} Workers<span class="r">${b.workers.length}/${cap} ${esc(JOBS[def.job].name.toLowerCase())}s</span></div><div class="wslots">${slots}</div>${b.damaged && b.workers.length ? '<div class="sub">Waiting for repairs</div>' : ''}</div>`;
    }
    // homes: who lives here
    if (def.housing) {
      const res = s.villagers.filter(v => sim.bedFor(v).b === b);
      if (res.length) h += `<div class="ip-sec"><div class="cap">${svg('house', 14)} Residents<span class="r">${res.length}/${housingOf(b)}</span></div><div class="wslots">${res.map(v => `<div class="wslot"><button class="av" data-act="selv" data-id="${v.id}">${faceSvg(v, 38)}</button><span class="nm">${esc(v.name.split(' ')[0])}</span></div>`).join('')}</div></div>`;
    }
    // details
    let kv = '';
    if (def.housing) kv += `<dt>Beds</dt><dd>${housingOf(b)}</dd>`;
    if (def.storage && b.type !== 'campfire') kv += `<dt>Storage</dt><dd>+${storageOf(b)} each good</dd>`;
    if (DECOR[b.type]) kv += `<dt>Happiness</dt><dd>+${DECOR[b.type].joy}</dd>`;
    if (b.type === 'farm') kv += `<dt>Crop</dt><dd>${CROPS[b.data.crop || 'wheat'].name}</dd><dt>Field</dt><dd>${{ empty: 'Needs sowing', growing: `Growing ${Math.floor(b.data.grow * 100)}%${s.weather?.rain && sim.seasonIdx() !== 3 ? ' · rain +60%' : ''}`, ripe: 'Ready to harvest!' }[b.data.stage]}</dd>`;
    if (b.type === 'watchtower') kv += `<dt>Beasts driven off</dt><dd>${s.stats.fended || 0}</dd><dt>Watch range</dt><dd>${13 + lvl * 2} tiles</dd>`;
    if (b.type === 'tavern') kv += `<dt>Tavern cheer</dt><dd>${s.tavernJoy > 0 ? `+12 joy · ${Math.ceil(s.tavernJoy)}s` : 'Quiet'}</dd>`;
    if (b.type === 'school') kv += `<dt>Pupils</dt><dd>${s.villagers.filter(v => v.home === b.sid && v.age >= 5 && v.age < 14).length}</dd>`;
    if (b.type === 'campfire') { const pop = s.villagers.filter(v => v.home === b.sid).length; kv += `<dt>Villagers</dt><dd>${pop}/${sim.housingIn(b.sid)}</dd><dt>Territory</dt><dd>${sim.settlementRadius(b.sid)} tiles</dd>`; }
    h += `<div class="ip-sec"><div class="desc">${esc(def.desc || (DECOR[b.type] ? 'A cozy touch that makes villagers happier.' : ''))}</div>${kv ? `<dl class="kv">${kv}</dl>` : ''}`;
    if (b.type === 'farm') h += `<div class="crops">${Object.entries(CROPS).map(([k, c]) => `<button class="tog ${(b.data.crop || 'wheat') === k ? 'on' : ''}" data-act="crop" data-k="${k}">${svg(c.out === 'grain' ? 'wheat' : 'apple', 16)}${c.name}<small>${c.desc}</small></button>`).join('')}</div>`;
    if (b.type === 'wizard') h += `<button class="btn sm" style="background:linear-gradient(#b18cff,#7a5ad8);border-color:#4a2f8a;margin-top:6px;width:100%" data-act="spellbook">${svg('staff', 16)} Open the spell book</button>`;
    if (b.type === 'memorial' && s.departed?.length) h += `<div class="sub" style="margin-top:6px">In loving memory: ${s.departed.slice(-6).reverse().map(d => `${esc(d.name)} (${d.age})`).join(', ')}</div>`;
    if (b.type === 'market') h += `<div class="sub" style="margin-top:6px">Sell when above reserve · coins each:</div><div class="sell-toggles">${SELLABLE.map(k => `<button class="tog ${s.sell[k] ? 'on' : ''}" data-act="sell" data-k="${k}">${svg(GOODS[k].icon, 16)}${GOODS[k].name} · ${Math.round(sim.priceOf(k) * 10) / 10}</button>`).join('')}</div>`;
    h += `</div>`;
    h += progressBuildingHtml(this, b);
    h += townBuildingHtml(this, b);
    h += eduBuildingHtml(this, b);   // home needs + auto-growing, classroom, reading room (education.js)
    h += rpgBuildingHtml(this, b);   // forge, guild hall, watch, knowledge, spell slots (rpgui.js)
    h += r7BuildingHtml(this, b) + r7SiteHtml(this, b);   // stores, specialty, carts, deliveries (panels.js)
    if (!b.damaged) h += this.chainHtml(b);
    // neighbour bonuses
    const syn = sim.synergy(b), helps = SYNERGY.filter(r => r.from === b.type);
    if (b.damaged) { /* a damaged building does nothing, so it has no bonuses to show */ }
    else if (syn.list.length) h += `<div class="synbox">${syn.list.map(r => `<div>${svg('star', 14)}<b>+${Math.round(r.bonus * r.n * 100)}%</b> ${esc(r.why)}${r.n > 1 ? ` (×${r.n})` : ''}</div>`).join('')}</div>`;
    else { const want = SYNERGY.filter(r => r.to === b.type); if (want.length) h += `<div class="synbox dim">${want.map(r => `<div>${svg('star', 14)}Build near a ${esc(defOf(r.from).name)} for +${Math.round(r.bonus * 100)}%</div>`).join('')}</div>`; }
    if (helps.length) h += `<div class="sub" style="margin-top:4px">Boosts nearby: ${helps.map(r => defOf(r.to).name).join(', ')}</div>`;
    const hint = { 'No trees within reach': 'Woodcutters only walk about 20 tiles from the hut (zoom out to see the dashed ring). Build another Lumber Hut by the forest, or a Forester\'s Lodge to replant.',
      'No boulders nearby': 'Miners have broken every boulder in range. Build a Quarry near rocks — Stonecrest is full of them.',
      'Waiting for berries': 'Bushes regrow in about a minute. More bushes in the ring means more food.',
      'Storage full': 'Build a Storehouse, upgrade one, or sell the surplus at a Market Stall.',
      'Nothing to sell': 'Turn on more goods above, or wait until you have more than you keep in reserve.' }[b.status];
    if (hint) h += `<div class="hintbox">${svg('info', 16)}<span>${esc(hint)}</span></div>`;
    // upgrade: what changes, what it costs
    if (b.up) {
      h += `<div class="ip-sec"><div class="cap">${svg('arrowup', 14)} Upgrading to Lv ${lvl + 1}<span class="r">${Math.floor(b.up.progress * 100)}%</span></div><div class="pbar"><i style="width:${b.up.progress * 100}%"></i></div></div>`;
    } else if (!isDecor(b.type) && lvl < MAX_LVL && !b.damaged) {
      const can = sim.canUpgrade(b), cost = sim.upgradeCost(b);
      const row = (k, a, z) => `<dt>${k}</dt><dd><s>${a}</s>→<b>${z}</b></dd>`;
      let pv = '';
      if (def.workers) pv += row('Workers', workersOf(b), workersOf(b) + 1) + row('Work speed', `+${(lvl - 1) * 15}%`, `+${lvl * 15}%`);
      if (def.housing || b.type === 'campfire') pv += row('Beds', housingOf(b), housingOf(b) + 2);
      if (def.storage) pv += row('Storage', storageOf(b), storageOf(b) + 300);
      if (!pv) pv = `<dt>Effect</dt><dd>${esc(sim.upgradeEffect(b) || 'A sturdier look')}</dd>`;
      h += `<div class="ip-sec upgrade"><div class="cap">${svg('arrowup', 14)} Upgrade to Lv ${lvl + 1}<span class="r costline">${costHtml(cost, s.res)}</span></div><dl class="uppv">${pv}</dl>
        <button class="btn gold sm" style="width:100%" data-act="upgrade" ${can.ok ? '' : 'disabled'}>${svg('star', 14)} ${can.ok ? 'Upgrade' : esc(can.why || 'Upgrade')}</button></div>`;
    }
    if (b.type !== 'campfire') h += `<div class="actions"><button class="btn ghost sm" data-act="move">${svg('rotate', 14)} Move</button><button class="btn red sm" data-act="demolish">${svg('trash', 14)} Demolish</button></div>`;
    return h + '</div>';
  }
  // inputs → this building → outputs, with what it really made and used in the last minute,
  // plus links to the buildings that supply it and the ones that use what it makes
  chainHtml(b) {
    const sim = this.sim, ch = b.type === 'farm' ? { in: [], out: farmOut(b) } : CHAIN[b.type];
    if (!ch || !b.built) return '';
    const ins = ch.in || [], outs = ch.out || [], res = sim.s.res;
    const rate = r => { const n = Math.round(sim.bRate(b, r)); return n ? `<i class="${n > 0 ? 'up' : 'down'}">${n > 0 ? '+' : ''}${n}/min</i>` : '<i>—</i>'; };
    const node = (r, inp) => `<span class="node">${svg(GOODS[r].icon, 22)}${esc(GOODS[r].name)}${rate(r)}<i class="stock${inp && res[r] < 5 ? ' low' : ''}">${fmt(res[r] || 0)} in store</i></span>`;
    let h = `<div class="chain"><div class="cap">Production · last minute</div><div class="flow${ins.length > 1 ? ' many' : ''}">`;
    if (ins.length) h += ins.map(r => node(r, true)).join('') + `<span class="arr">→</span>`;
    h += `<span class="node me"><img alt="" src="${this.g.thumbs[b.type] || ''}">${esc(defOf(b.type).name)}</span>`;
    if (outs.length) h += `<span class="arr">→</span>` + outs.map(r => node(r, false)).join('');
    h += `</div>`;
    const near = t => { const c = sim.bCenter(b); let best = null, bd = 1e9; for (const o of sim.s.buildings) { if (o.type !== t || !o.built || o === b) continue; const oc = sim.bCenter(o), d = Math.hypot(oc.x - c.x, oc.z - c.z); if (d < bd) { bd = d; best = o; } } return best; };
    const link = (t, verb) => { const o = near(t), d = defOf(t); return o ? `<button data-act="chainb" data-id="${o.id}">${svg(verb, 13)}${esc(d.name)}</button>` : `<button class="missing" data-act="chainbuild" data-type="${t}" data-tip="Not built yet|Tap to build a ${esc(d.name)}.">${svg('plus', 13).replace('#fff', '#8a5a2b')}${esc(d.name)}</button>`; };
    const sup = [...new Set(ins.flatMap(makersOf))].filter(t => t !== b.type && BUILDINGS[t]).slice(0, 3);
    const use = [...new Set(outs.flatMap(usersOf))].filter(t => t !== b.type && BUILDINGS[t]).slice(0, 3);
    if (sup.length || use.length) h += `<div class="links">${sup.map(t => link(t, 'back')).join('')}${use.map(t => link(t, 'fast')).join('')}</div>`;
    return h + `</div>`;
  }
  villagerInfo(v) {
    const sim = this.sim, st = stageOf(v);
    const sname = sim.sname(v.home), work = v.work ? sim.bById.get(v.work) : null, home = sim.homeOf?.(v);
    const race = RACES[v.race] || RACES.human, gen = GENDERS[v.gender] || GENDERS.x, cls = CLASSES[classOf(v)], tier = sim.eduTier(v);
    // who they are, at a glance
    const chips = [
      sim.wantedOf?.(v) ? `<span class="vchip wanted" data-tip="Wanted|${esc(Object.entries(sim.wantedOf(v).crimes.reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {})).map(([c, n]) => c + (n > 1 ? ' ×' + n : '')).join(', '))}. The watch will catch them if they spot them.">${svg('alert', 13)}Wanted</span>` : '',
      v.title ? `<span class="vchip gold" data-tip="${esc(v.title)}|${esc(v.title === 'Archmage' ? 'Leads a Wizard Tower: its wizards study faster.' : 'Leads the village government.')}">${svg('star', 13)}${esc(v.title)}</span>` : '',
      `<span class="vchip" data-tip="${esc(race.name)} · ${esc(race.trait)}|${esc(race.desc)}">${esc(race.name)} · ${esc(gen.pro)}</span>`,
      sim.quirkOf ? `<span class="vchip" data-tip="${esc(sim.quirkOf(v).name)}|${esc(sim.quirkOf(v).desc)}">${esc(sim.quirkOf(v).name)}</span>` : '',
      st !== 'child' ? `<span class="vchip" data-tip="${esc(cls.name)} · level ${v.lvl || 1}|${esc(cls.desc)} In the village: ${esc(CLASS_DUTY[classOf(v)] || '')}">${svg(cls.icon, 13)}${esc(cls.name)} ${v.lvl || 1}</span>` : '',
      st !== 'child' ? `<span class="vchip" data-tip="${esc(TIERS[tier].name)}|${esc(TIERS[tier].desc)}">${v.grade ? `<span class="grade g${v.grade}">${v.grade}</span>` : svg('cap', 13)}${esc(TIERS[tier].name)}</span>` : '',
      petChip(this, v),
      home ? `<button class="vchip link" data-act="chainb" data-id="${home.id}" data-tip="Home|${esc(sim.homeName(home))}">${svg('house', 13)}${esc(sim.homeName(home))}</button>` : '',
    ].join('');
    const fed = v.hungry ? '<span style="color:#c0392b">Hungry!</span>' : Math.round(100 - v.hunger / 80 * 100) + '%';
    const hp = Math.ceil(v.hp ?? 0), mx = maxHp(v);
    return `<button class="x" data-act="close" aria-label="Close" data-tip="Close|Esc">${svg('close', 14)}</button><div class="ipwrap">
      <div class="ip-hd">${faceSvg(v, 44)}<div style="min-width:0;flex:1">${this.renaming === 'v' + v.id ? `<div class="rename"><input id="renameIn" maxlength="22" value="${esc(v.name)}" aria-label="Name"><button class="btn sm" data-act="renameok">Save</button></div>`
        : `<h3>${esc(v.name)}<button class="pen" data-act="rename" aria-label="Rename" data-tip="Rename">${svg('pencil', 14)}</button></h3>`}
      <div class="sub">${esc(sname)} · ${JOBS[v.job].name} · age ${Math.floor(v.age ?? 30)}</div></div></div>
      <div class="vchips">${chips}</div>
      ${wishVillagerHtml(this, v)}
      <div class="ip-sec"><div class="statusline ${v.hungry ? 'bad' : v.asleep ? 'off' : 'ok'}"><span class="dot"></span><span>${esc(this.doingOf(v))}</span></div>${hardshipNoteHtml(this.sim, v)}
      <dl class="kv" style="margin:6px 0 0">${this.family(v)}<dt>Fed</dt><dd>${fed}</dd>
      ${v.carry ? `<dt>Carrying</dt><dd>${v.carry.n} ${GOODS[v.carry.res].name.toLowerCase()}</dd>` : ''}
      ${work ? `<dt>Works at</dt><dd><a href="#" data-act="chainb" data-id="${work.id}" style="color:inherit">${esc(sim.homeName(work))} ›</a></dd>` : ''}</dl>
      ${st === 'adult' ? `<select data-act="job" data-id="${v.id}" style="width:100%;margin-top:8px" aria-label="Job">${this.workOptions(v)}</select>` : `<div class="desc" style="margin-top:6px">${st === 'child' ? 'Too young to work — plays, and studies if there is a school.' : 'Retired, enjoying the quiet life.'}</div>`}</div>
      ${this.fold('skills', 'Skills & health', 'heart', `${hp}/${mx} HP`, () => rpgVillagerHtml(this, v))}
      ${this.fold('edu', st === 'child' ? 'Schooling' : 'Education', 'cap', v.grade ? `Grade ${v.grade}` : TIERS[tier].name, () => eduVillagerHtml(this, v) + progressVillagerHtml(this, v))}
      ${this.fold('friends', 'Friends & rivals', 'heart', `${sim.friendsOf?.(v).filter(f => f.hearts > 0).length || 0}${sim.rivalsOf?.(v).length ? ` · ${sim.rivalsOf(v).length} rival${sim.rivalsOf(v).length > 1 ? 's' : ''}` : ''}`, () => r7VillagerHtml(this, v) + petRowHtml(this, v))}
      <div class="actions"><button class="btn ghost sm" data-act="follow">${svg('eye', 14)} ${this.g.followV === v ? 'Stop following' : 'Follow'}</button><button class="btn ghost sm" data-act="vlist" data-tip="People|Everyone in your villages, with jobs.|V">${svg('people', 14)} All villagers</button></div></div>`;
  }
  // a section that opens on tap (remembered while the game runs)
  fold(key, title, icon, hint, body) {
    const open = this.folds?.has(key);
    return `<div class="fold${open ? ' open' : ''}"><button class="fold-hd" data-act="fold" data-k="${key}" aria-expanded="${!!open}">${svg(icon, 14)}<span>${esc(title)}</span><span class="r">${esc(hint)}</span><i class="chev"></i></button>${open ? `<div class="fold-bd">${body()}</div>` : ''}</div>`;
  }
  doingOf(v) {
    if (v.task?.label) return v.task.label;
    return v.job === 'idle' ? 'Looking for something to do' : v.job === 'child' ? 'Playing' : v.job === 'retired' ? 'Taking it easy' : this.sim.s.speed ? 'Thinking' : 'Waiting (paused)';
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
    const sh = { 'No trees within reach': 'no trees', 'No boulders nearby': 'no boulders', 'Storage full': 'storage full', 'Nothing to sell': 'nothing to sell', 'Waiting for berries': 'berries regrowing' }[b.status] || b.status.toLowerCase();
    return ` · <span class="why">${esc(sh)}</span>`;
  }
  workplaceCaption(v) {
    const b = v.work ? this.sim.bById.get(v.work) : null;
    return b ? `${defOf(b.type).name} · ${b.workers.length}/${workersOf(b)}` : 'Builds & clears';
  }
  workOptions(v, compact = false) {
    const s = this.sim.s;
    // short labels so the closed dropdown never truncates: the current job reads "Woodcutter ★★★",
    // the open list "Woodcutter ★★☆ · Lumber Hut 1/2" (plus #2 / the village when there are several)
    let o = `<option value="0" ${v.job === 'idle' ? 'selected' : ''}>${compact ? 'Idle' : 'Idle / builder'}</option>`;
    if (v.job === 'student') o += `<option value="student" selected disabled>Student · Arcane University</option>`;
    const multi = Object.keys(s.unlocked).length > 1, seen = {};
    for (const b of s.buildings) {
      const def = defOf(b.type);
      if (!def.workers || !b.built) continue;
      const key = b.type + b.sid, k = seen[key] = (seen[key] || 0) + 1;
      const mine = v.work === b.id && v.job !== 'student';
      if (!mine && b.workers.length >= workersOf(b)) continue;
      const need = JOB_EDU[def.job] || 0, barred = !mine && need && this.sim.eduTier(v) < need;
      const job = JOBS[def.job].name + (barred ? ` · needs ${TIERS[need].name.toLowerCase()}` : fitStars(v, def.job));
      const where = `${b.type==='wizard'?this.sim.homeName(b):def.name}${k > 1 ? ` #${k}` : ''} ${b.workers.length}/${workersOf(b)}${multi ? ' · ' + this.sim.sname(b.sid) : ''}`;
      o += `<option value="${b.id}" ${mine ? 'selected' : ''}${barred ? ' disabled' : ''}>${mine ? job : `${job} · ${where}`}</option>`;
    }
    return o;
  }
  infoClick(e) {
    const a = e.target.closest('[data-act]');
    if (!a || a.tagName === 'SELECT') return;
    e.preventDefault();
    const sim = this.sim, sel = this.g.selected;
    const act = a.dataset.act;
    if (progressClick(this,act,a,sel)) { this.drawInfo(true); return; }
    if (act.startsWith('town-')) { townClick(this, act, a); this.drawInfo(true); return; }
    if (act.startsWith('ev-')) { eventsClick(this, act, a, sel?.b); this.drawInfo(true); return; }
    if (act.startsWith('r7-')) { if (r7Click(this, act, a)) this.drawInfo(true); return; }
    if (act.startsWith('lv-')) { lifeClick(this, act, a); this.dirty.res = true; this.drawInfo(true); return; }
    if (act === 'close') { this.g.select(null); return; }
    if (act === 'fold') { (this.folds ||= new Set()).has(a.dataset.k) ? this.folds.delete(a.dataset.k) : this.folds.add(a.dataset.k); sfx.click(); this.drawInfo(true); return; }
    if (act === 'selv') { const v = sim.vById.get(+a.dataset.id); if (v) this.g.select({ kind: 'v', v }, true); return; }
    if (act === 'follow') { this.g.follow(this.g.followV === sel.v ? null : sel.v); return; }
    if (act === 'vlist') { this.openModal('villagers'); return; }
    if (act === 'blist') { this.openModal('buildings'); return; }
    if (act === 'rename') {
      this.renaming = sel.kind === 'b' ? 'b' + sel.b.id : 'v' + sel.v.id; this.drawInfo(true);
      const inp = $('#renameIn'); if (inp) { inp.focus(); inp.select(); } return;
    }
    if (act === 'renameok') {
      const val = $('#renameIn')?.value || '';
      const home = sel.kind === 'b' && [...HOME_TYPES,...LODGING_TYPES].includes(sel.b.type);
      const ok = sel.kind === 'b' ? home ? sim.renameHome(sel.b, val) : sim.renameSettlement(sel.b.sid, val) : sim.renameVillager(sel.v, val);
      this.renaming = null; if (ok) { sfx.pop(); this.toast(sel.kind === 'b' ? home ? `Home named ${sim.homeName(sel.b)}` : `Welcome to ${sim.sname(sel.b.sid)}!` : `Now known as ${sel.v.name}`, sel.kind === 'b' ? 'house' : 'person'); }
      this.drawInfo(true); return;
    }
    if (act === 'chainb') { const b = sim.bById.get(+a.dataset.id); if (b) this.g.select({ kind: 'b', b }, true); return; }
    if (act === 'chainbuild') { this.g.select(null); this.doGo({ kind: 'build', key: a.dataset.type }); return; }
    if (act.startsWith('rpg-')) { rpgInfoClick(this, act, a, sel); this.drawInfo(true); return; }
    if (act.startsWith('edu-')) { eduClick(this, act, sel?.b); this.drawInfo(true); return; }
    if (!sel || sel.kind !== 'b') return;
    const b = sel.b;
    if (act === 'bnav') { const same = this.sameType(b), n = same[(same.indexOf(b) + +a.dataset.d + same.length) % same.length]; if (n) this.g.select({ kind: 'b', b: n }, true); return; }
    if (act === 'move') { this.g.startPlace(b.type, b); return; }
    if (act === 'crop') { b.data.crop = a.dataset.k; sfx.pop(); }
    if (act === 'spellbook') { this.openModal('magic'); return; }
    if (act === 'upgrade') { if (sim.upgrade(b)) this.toast('Builders are on their way!', 'hammer'); }
    if (act === 'staff') { if (!sim.assign(b, null)) { this.toast(b.workers.length >= workersOf(b) ? 'This building is fully staffed' : 'No idle villagers — free someone up or build more cottages', 'person'); sfx.error(); } else sfx.pop(); }
    if (act === 'unstaffv') { const v = sim.vById.get(+a.dataset.id); if (v) { sim.unassign(v); sfx.click(); this.toast(`${v.name.split(' ')[0]} is now idle`, 'person'); } }
    if (act === 'sell') { sim.s.sell[a.dataset.k] = !sim.s.sell[a.dataset.k]; sfx.click(); }
    if (act === 'demolish') {
      if (a.dataset.sure) { sim.demolish(b); this.g.select(null); sfx.place(); return; }
      a.dataset.sure = 1; a.innerHTML = svg('trash', 14) + ' Tap again to confirm'; return;
    }
    this.drawInfo(true);
  }

  // ── build tray: category tabs, then cards ──
  trayCats(kind = this.tray) { return CATS[kind]; }
  catTypes(kind, cat) {
    const order = kind === 'build' ? ['clear', ...BUILD_ORDER, 'road', 'pave'] : ['road', 'pave', ...DECOR_ORDER];
    if (!cat || cat.id === 'all') return order;
    const listed = new Set(CATS[kind].flatMap(c => c.types || []));
    return [...cat.types, ...(cat.rest ? order.filter(t => !listed.has(t)) : [])].filter(t => t === 'clear' || t === 'pave' || t === 'road' || defOf(t));
  }
  isLocked(t) { const s = this.sim.s, d = defOf(t); return !d ? false : d.rare ? !(s.tokens?.[t] > 0) : d.lvl > s.level || !!this.sim.gateOf(t); }
  // unlocked by level but waiting on other buildings or a Library (Sim.gateOf)
  gateFor(t) { const d = defOf(t); return d && !d.rare && d.lvl <= this.sim.s.level ? this.sim.gateOf(t) : null; }
  openTray(kind, cat) {
    if (this.modal) this.closeModal();
    const t = $('#tray'), was = this.tray === kind, open = !!this.tray;
    clearTimeout(this.trayT);
    this.tray = kind;
    t.classList.remove('hidden', 'out');
    if (!open) restart(t, 'in');
    $('#dockbar').classList.add('hidden');
    this.trayCat = cat || (was ? this.trayCat : this.catMem[kind]) || 'all';
    if (!CATS[kind].some(c => c.id === this.trayCat)) this.trayCat = 'all';
    this.drawTrayTabs();
    this.drawCards(!was);
    if (!open) sfx.open();
  }
  setTrayCat(id) {
    this.trayCat = this.catMem[this.tray] = id;
    this.drawTrayTabs(); this.drawCards(true);
    $('#cards').scrollLeft = 0;
  }
  drawTrayTabs() {
    const kind = this.tray;
    $('#trayTabs').innerHTML = `<span class="kindseg" role="tablist" aria-label="Build or decorate">${[['build', 'hammer', 'Build'], ['decor', 'flower', 'Decorate']].map(([k, ic, t]) => `<button data-kind="${k}" class="${k === kind ? 'on' : ''}" role="tab" aria-selected="${k === kind}" data-tip="${t}|${k === 'build' ? 'Homes, workplaces, farms and defenses.|B' : 'Flowers, paths, fences and treasures. Happier villagers work faster.|G'}">${svg(ic, 16)}${t}</button>`).join('')}</span>` + CATS[kind].map(c => {
      const types = this.catTypes(kind, c), open = types.filter(t => !this.isLocked(t)).length;
      const nnew = types.filter(t => this.freshCard(t)).length;
      return `<button role="tab" aria-selected="${c.id === this.trayCat}" class="${c.id === this.trayCat ? 'on' : ''}" data-cat="${c.id}" data-tip="${esc(c.name)}|${open} of ${types.length} available${nnew ? ` · ${nnew} new` : ''}${finePointer() ? ' · [ and ] switch tabs' : ''}">${svg(c.icon, 18)}<span class="lb">${esc(c.name)}</span><span class="n">${open}</span>${nnew ? '<i class="tdot"></i>' : ''}</button>${c.id === 'all' ? '<span class="sep"></span>' : ''}`;
    }).join('');
    const on = $('#trayTabs .on'), tt = $('#trayTabs');
    if (on && (on.offsetLeft < tt.scrollLeft || on.offsetLeft + on.offsetWidth > tt.scrollLeft + tt.clientWidth)) tt.scrollLeft = on.offsetLeft - 30;
    requestAnimationFrame(() => this.trayEdges());
  }
  // a building that has just unlocked and hasn't been seen in the tray yet
  freshCard(t) {
    const d = defOf(t), s = this.sim.s;
    return this.tray === 'build' && !!d && !d.rare && !this.isLocked(t) && d.lvl > 1 && !(s.seenCards || []).includes(t) && !s.buildings.some(o => o.type === t);
  }
  // rows that scroll sideways fade at the edge and get an arrow, so the rest is discoverable
  trayEdges() {
    for (const [el, key] of [[$('#trayTabs'), 'tabs'], [$('#cards'), 'cards']]) {
      const l = el.scrollLeft > 4, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      el.classList.toggle('more-l', l); el.classList.toggle('more-r', r);
      for (const [side, on] of [['l', l], ['r', r]]) {
        const a = $(`.trayarrow[data-row="${key}"][data-side="${side}"]`); if (!a) continue;
        a.classList.toggle('hidden', !on);
        a.style.top = el.offsetTop + el.offsetHeight / 2 - 15 + 'px';
        a.style[side === 'l' ? 'left' : 'right'] = side === 'l' ? el.offsetLeft - 6 + 'px' : '-6px';
      }
    }
  }
  drawCards(anim) {
    const kind = this.tray, cat = CATS[kind].find(c => c.id === this.trayCat);
    // available first (in the usual order), then locked by unlock level
    const types = this.catTypes(kind, cat).map((t, i) => ({ t, i, lk: this.isLocked(t), lvl: defOf(t)?.lvl || 0 }))
      .map(o => ({ ...o, nw: this.freshCard(o.t) })).sort((a, b) => a.lk - b.lk || b.nw - a.nw || (a.lk ? a.lvl - b.lvl : 0) || a.i - b.i).map(o => o.t);
    $('#cards').innerHTML = types.map((t, i) => {
      const a = anim ? ` in" style="--i:${Math.min(i, 14)}` : '';
      if (t === 'clear') return `<button class="card${a}" data-type="clear" data-tip="@card"><img alt="" src="${this.g.thumbs.clear}"><div class="nm">Clear Trees</div><div class="cost"><span class="txt">tap trees</span></div></button>`;
      if (t === 'pave' || t === 'road') return r7CardHtml(t, this, a);
      const d = defOf(t);
      const role = d.workers ? `${svg('person', 12)}${d.workers}` : d.housing ? `${svg('house', 12)}${d.housing}` : d.storage ? `${svg('bag', 12)}+` : DECOR[t] && d.joy ? `${svg('smile', 12)}+${d.joy}` : '';
      const fresh = kind === 'build' && !d.rare && !this.isLocked(t) && d.lvl > 1 && !(this.sim.s.seenCards || []).includes(t) && !this.sim.s.buildings.some(o => o.type === t);
      return `<button class="card${d.rare ? ' rare' : ''}${a}" data-type="${t}" data-tip="@card"><img alt="" src="${this.g.thumbs[t] || ''}">${role ? `<span class="role">${role}</span>` : ''}${fresh ? '<span class="newb">New</span>' : ''}<div class="nm">${esc(d.name)}</div><div class="cost"></div></button>`;
    }).join('');
    this.refreshCards();
    if (this.g.place) this.markCard(this.g.place.type);
  }
  refreshCards() {
    const s = this.sim.s;
    for (const c of document.querySelectorAll('#cards .card')) {
      const t = c.dataset.type;
      if (t === 'clear' || t === 'pave' || t === 'road') continue;
      const d = defOf(t), have = s.tokens?.[t] || 0, locked = this.isLocked(t);
      const cant = !locked && !d.rare && !this.sim.canAfford(d.cost);
      c.classList.toggle('locked', locked); c.classList.toggle('cant', cant);
      const html = d.rare ? (have ? `<span class="txt">Free · ×${have}</span>` : (d.festive ? '<span class="txt">Festival shop</span>' : `<span class="txt">Chests only</span>`)) : locked ? `<span class="txt">${this.gateFor(t)?.short || `Unlocks at Lv ${d.lvl}`}</span>` : costHtml(d.cost, s.res);
      const ce = c.querySelector('.cost');
      if (ce.innerHTML !== html) ce.innerHTML = html;
      const lk = c.querySelector('.lock');
      const lkTxt = this.gateFor(t) ? 'Needs' : `Lv ${d.lvl}`;
      if (locked && !d.rare && (!lk || !lk.textContent.endsWith(lkTxt))) { lk?.remove(); c.insertAdjacentHTML('beforeend', `<span class="lock">${svg('lock', 12)}${lkTxt}</span>`); }
      if (!locked && lk) lk.remove();
    }
  }
  // the rich tooltip for a build card: what it is, what it makes, workers, bonuses, cost
  cardTipHtml(type) {
    if (type === 'pave' || type === 'road') return r7CardTip(type, this);
    if (type === 'clear') return `<b class="t">Clear Trees</b><p>Mark trees to fell. Woodcutters go for marked trees first, and idle villagers help too. Tap a marked tree again to unmark it.</p>`;
    const d = defOf(type), s = this.sim.s; if (!d) return '';
    const locked = this.isLocked(type);
    let h = `<div class="tt-hd"><img alt="" src="${this.g.thumbs[type] || ''}"><div><b class="t">${esc(d.name)}</b><span>${DECOR[type] ? (d.rare ? 'Treasure' : 'Decoration') : esc(CAT_OF[type] || 'Building')} · ${d.size[0]}×${d.size[1]} tiles</span></div></div>`;
    h += `<p>${esc(d.desc || (DECOR[type] ? 'A cozy touch that makes villagers happier.' : ''))}</p>`;
    const ch = type === 'farm' ? { in: [], out: ['grain', 'food'] } : CHAIN[type];
    if (ch && (ch.out?.length || ch.in?.length)) {
      const g = r => `${svg(GOODS[r].icon, 15)}${esc(GOODS[r].name)}`;
      h += `<div class="flowln">${ch.in?.length ? ch.in.map(g).join(' ') + '<em>→</em>' : ''}${ch.out?.length ? ch.out.map(g).join(type === 'farm' ? ' or ' : ' ') : 'happiness'}</div>`;
    }
    let rows = '';
    if (d.workers) rows += `<dt>Workers</dt><dd>${d.workers} ${esc(JOBS[d.job].name.toLowerCase())}${d.workers > 1 ? 's' : ''}</dd>`;
    if (d.housing) rows += `<dt>Homes</dt><dd>${d.housing} villagers</dd>`;
    if (d.storage) rows += `<dt>Storage</dt><dd>+${d.storage} each good</dd>`;
    if (DECOR[type] && d.joy) rows += `<dt>Happiness</dt><dd>+${d.joy}</dd>`;
    if (d.time) rows += `<dt>Build work</dt><dd>${d.time}s</dd>`;
    if (!d.rare && Object.keys(d.cost || {}).length) rows += `<dt>Cost</dt><dd>${Object.entries(d.cost).map(([k, v]) => `<span style="display:inline-flex;align-items:center;gap:2px;${(s.res[k] || 0) < v ? 'color:#c0392b' : ''}">${svg(GOODS[k].icon, 14)}${v}</span>`).join('')}</dd>`;
    if (d.rare) rows += `<dt>Owned</dt><dd>${s.tokens?.[type] || 0} · from gift chests</dd>`;
    h += `<dl class="kv">${rows}</dl>`;
    const near = SYNERGY.filter(r => r.to === type), helps = SYNERGY.filter(r => r.from === type);
    for (const r of near) h += `<div class="syn">${svg('star', 13)}<span>+${Math.round(r.bonus * 100)}% near a ${esc(defOf(r.from).name)}: ${esc(r.why.toLowerCase())}</span></div>`;
    h += r7SpecNote(type);
    if (helps.length) h += `<div class="syn">${svg('fast', 13)}<span>Boosts nearby ${esc([...new Set(helps.map(r => defOf(r.to).name))].join(', '))}</span></div>`;
    if (d.needsWater) h += `<div class="note">Must touch the shore of a lake or river.</div>`;
    if (locked && !d.rare) h += this.gateFor(type) ? `<div class="note bad">${svg('lock', 13)} ${esc(/Library first, to school/.test(this.gateFor(type).why) ? 'Its workers need schooling: build a Library first, where grown-ups study.' : this.gateFor(type).why + '.')}</div>`
      : `<div class="note bad">${svg('lock', 13)} Unlocks at level ${d.lvl} (you're level ${s.level}).</div>`;
    else if (locked) h += `<div class="note">${d.festive ? 'Buy one with festival tokens at the festival shop.' : 'Find one in a gift chest in the woods.'}</div>`;
    else if (!d.rare && !this.sim.canAfford(d.cost)) h += `<div class="note bad">Not enough resources yet.</div>`;
    return h;
  }
  markCard(type) { document.querySelectorAll('#cards .card').forEach(c => c.classList.toggle('sel', c.dataset.type === type)); }
  closeTray() {
    if (!this.tray) return;
    // everything unlocked that the player has now seen stops being "New"
    if (this.tray === 'build') { const s = this.sim.s; s.seenCards = [...new Set([...(s.seenCards || []), ...BUILD_ORDER.filter(t => !this.isLocked(t))])]; }
    this.tray = null;
    const t = $('#tray'), d = $('#dockbar');
    t.classList.remove('in'); t.classList.add('out');
    clearTimeout(this.trayT);
    this.trayT = setTimeout(() => { t.classList.add('hidden'); t.classList.remove('out'); }, 170);
    d.classList.remove('hidden'); restart(d, 'in');
    this.hideTip();
  }

  placeBar(show, msg = '', bad = false, touch = false, title = '') {
    const pb = $('#placebar'), was = !pb.classList.contains('hidden');
    pb.classList.toggle('hidden', !show);
    if (show && !was) restart(pb, 'in');
    $('#pMsg').innerHTML = (title ? `<b>${esc(title)}</b>` : '') + esc(msg);
    $('#pMsg').classList.toggle('bad', bad);
    $('#pOk').classList.toggle('hidden', !touch);
    $('#pFace').classList.toggle('hidden', !this.g.place?.ghost || this.g.place?.type==='dock');
    $('#pFace').setAttribute('aria-pressed', !!this.g.place?.autoFace);
  }

  // ── modals ──
  openModal(kind) {
    const m = $('#modal');
    clearTimeout(this.modalT);
    const was = !!this.modal;
    this.modal = kind;
    m.classList.remove('hidden', 'closing');
    if (!was) restart(m, 'opening');
    m.querySelector('.box').classList.toggle('tall', ['villagers', 'jobs', 'buildings', 'inventory', 'stats', 'log', 'story', 'chronicle', 'festival', 'settings', 'guild', 'town', 'population'].includes(kind));
    this.drawModal(false, was);
    this.drawDock();
    this.hideTip(); this.hideResTip();
    if (!was) sfx.open(); else sfx.click();
  }
  closeModal() {
    if (!this.modal) return;
    this.storyOpenSeen = null;
    this.modal = null;
    const m = $('#modal');
    m.classList.remove('opening'); m.classList.add('closing');
    clearTimeout(this.modalT);
    this.modalT = setTimeout(() => { m.classList.add('hidden'); m.classList.remove('closing'); }, 170);
    this.drawDock(); this.hideTip();
  }
  drawDock() {
    const on = DOCK_OF[this.modal];
    document.querySelectorAll('#dockbar [data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === on); b.setAttribute('aria-pressed', b.dataset.tab === on); });
  }
  // a main-bar button: open its group (on the page with something waiting), or close it if it's open
  dockGo(tab) {
    if (tab === 'build') { this.tray ? this.closeTray() : this.openTray('build'); return; }
    if (DOCK_OF[this.modal] === tab) { this.closeModal(); return; }
    const sim = this.sim;
    if (tab === 'people') this.openModal('villagers');
    else if (tab === 'town') this.openModal('town');
    else if (tab === 'world') this.openModal('worldmap');
    else if (tab === 'journal') {
      const news = (sim.s.storyN || 0) > (sim.s.storySeen || 0);
      const fest = sim.festShop?.open() && sim.festShop.quests().some(q => q.done && !q.claimed), trophies = sim.achievements().some(x => x.done && !x.claimed);
      this.openModal(fest ? 'festival' : sim.s.chronNew ? 'chronicle' : trophies && !news ? 'stats' : 'story');
    }
  }
  // things that come and go, as labelled chips: a gift chest, the festival, the spell book
  drawNow() {
    const s = this.sim.s, fs = this.sim.festShop, chips = [];
    const nch = s.chests?.length || 0;
    if (nch) chips.push(['chest', 'gift', 'gift', nch > 1 ? `${nch} gift chests` : 'Gift chest', 'Gift chest|A gift chest is waiting in the woods. Tap to fly to it.', 0]);
    if (fs?.open()) chips.push(['festival', 'fest', 'party', fs.current()?.name || 'Festival', 'Festival|Festival quests pay tokens; spend them on seasonal decorations at the festival shop.', 0]);
    if (s.buildings.some(b => b.type === 'wizard' && b.built)) chips.push(['magic', 'magic', 'staff', 'Spells', 'Spell book|Cast the spells your wizards have learned.', 0]);
    const html = chips.map(([k, cls, ic, label, tip, n]) => `<button class="nowchip ${cls}" data-now="${k}" data-tip="${esc(tip)}" aria-label="${esc(label)}">${svg(ic, 22)}<span class="l">${esc(label)}</span>${n ? `<span class="badge">${n}</span>` : ''}</button>`).join('');
    const bar = $('#nowbar'); if (bar.dataset.h !== html) { bar.dataset.h = html; bar.innerHTML = html; }
    // a count on Build for buildings that have just unlocked
    const fresh = BUILD_ORDER.filter(t => { const d = defOf(t); return d && !d.rare && d.lvl > 1 && !this.isLocked(t) && !(s.seenCards || []).includes(t) && !s.buildings.some(o => o.type === t); }).length;
    this.dockBadge('build', 0, '', { dot: fresh > 0 });
    $('#dockbar [data-tab=build]').dataset.tip = `Build|Homes, workplaces and farms, and decorations (G) in the same tray.${fresh ? ` ${fresh} new building${fresh > 1 ? 's' : ''} to look at.` : ''}|B`;
  }
  // a number (or just a dot) on a main-bar button
  dockBadge(tab, n, label, { bad = false, dot = false } = {}) {
    const b = $(`#dockbar [data-tab=${tab}]`); if (!b) return;
    const bd = b.querySelector('.badge'), dt = b.querySelector('.dot'), key = `${n}|${bad}|${dot}`;
    if (b.dataset.bk === key) return; b.dataset.bk = key;
    bd.classList.toggle('hidden', !(n > 0)); bd.textContent = n > 9 ? '9+' : n; bd.classList.toggle('bad', bad);
    if (n > 0) restart(bd, 'pop');
    dt.classList.toggle('hidden', !(dot && !(n > 0)));
    b.setAttribute('aria-label', b.dataset.label + (n > 0 ? ` (${n} ${label})` : dot ? ' (something new)' : ''));
  }
  drawModal(refresh, swap) {
    const k = this.modal, sim = this.sim, s = sim.s;
    if (!k) return;
    const titles = { villagers: ['people', 'Villagers'], jobs: ['hammer','Jobs'], buildings: ['list', 'Buildings'], inventory: ['bag', 'Inventory'], worldmap: ['map', 'World'], shop: ['shop', 'Shop'],
      settings: ['gear', 'Settings'], fallen: ['flower', 'The village has fallen'], town: ['house', 'Town'], log: ['mail', 'Village News'], story: ['heart', 'Story'], population: ['people', 'Population'], chronicle: ['scroll', 'Chronicle'], stats: ['trophy', 'Achievements'], profile: ['star', 'Your Progress'], merchant: ['shop', 'Travelling Merchant'], magic: ['staff', 'Spell Book'], guild: ['banner', 'Guild Hall'], ...R7_MODALS };
    const seg = (label, tabs) => `<span class="seg" role="tablist" aria-label="${label}">` + tabs.map(([id, name]) => `<button data-act="mtab" data-m="${id}" class="${k === id ? 'on' : ''}" role="tab" aria-selected="${k === id}">${name}</button>`).join('') + '</span>';
    const journal = ['story', 'chronicle', 'log', 'stats', 'festival'].includes(k), boards = ['villagers', 'jobs', 'buildings', 'population'].includes(k);
    const townG = ['town', 'inventory'].includes(k), worldG = ['worldmap', 'trade'].includes(k);
    const head = boards ? seg('People', [['villagers', 'Villagers'], ['jobs', 'Jobs'], ['buildings', 'Buildings'], ['population', 'Population']])
      : townG ? seg('Town', [['town', 'Town'], ['inventory', 'Stores']])
      : worldG && (Object.keys(s.unlocked).length > 1 || k === 'trade') ? seg('World', [['worldmap', 'Map'], ['trade', 'Trade']])
      : journal ? (() => {
        const tn = n => n > 0 ? `<span class="tn">${n > 9 ? '9+' : n}</span>` : '', unread = k !== 'story' && (s.storyN || 0) > (s.storySeen || 0);
        const trophies = sim.achievements().filter(x => x.done && !x.claimed).length;
        return seg('Journal', [['story', `Story${unread ? '<i class="tdot"></i>' : ''}`], ['chronicle', `Chronicle${tn(s.chronNew)}`], ['log', 'News'], ['stats', `Achievements${tn(trophies)}`], ...(sim.festShop?.open() || k === 'festival' ? [['festival', 'Festival']] : [])]);
      })()
      : esc(titles[k][1]);
    if (head !== this.lastHead) { this.lastHead = head; $('#mTitle').innerHTML = head; }
    $('#mIcon').innerHTML = boards || journal || townG || (worldG && head.startsWith('<span class="seg')) ? '' : svg(titles[k][0], 26);
    let h = '';
    if (k === 'villagers') h = this.villagersHtml();
    else if (k === 'fallen') h = fallenHtml(this);
    else if(k === 'jobs') h = jobsBoardHtml(this);
    else if (k === 'town') h = townHtml(this);
    else if (k === 'population') h = censusHtml(this);
    else if (k === 'buildings') h = this.buildingsHtml();
    else if (k === 'inventory') {
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
      const tok = [...RARE, ...Object.values(FESTIVE).flat()].filter(t => s.tokens?.[t] > 0);
      h += `</div><h3 style="margin:12px 0 6px">${svg('gift', 20)} Treasures</h3>` + (tok.length
        ? `<div class="grid">${tok.map(t => `<div class="tile" style="align-items:center;text-align:center"><img src="${this.g.thumbs[t]}" width="64" height="56" alt=""><b style="font-size:13px">${esc(DECOR[t].name)} ×${s.tokens[t]}</b><span class="small">${esc(DECOR[t].desc)}</span><button class="btn sm" data-act="placetok" data-t="${t}">Place it</button></div>`).join('')}</div>`
        : `<p class="sub" style="font-size:12px;color:var(--ink2)">Gift chests turn up in the woods every day or so. Some hold rare decorations you can't build.</p>`);
      h += `<p class="sub" style="font-size:12px;color:var(--ink2);margin-top:8px">Quick sales pay half price. A staffed Market Stall sells your surplus at full price.</p>`;
    } else if (k === 'worldmap') {
      h += `<div class="worldwrap"><div><div class="mapstack"><canvas id="minimap" width="384" height="384"></canvas>${expMapHtml()}</div><div id="expnote"></div></div><div>`;
      h += worldRegionsHtml(this, r7WorldRow);
      if (Object.keys(s.unlocked).length > 1) h += `<button class="btn sm" style="margin-top:8px;width:100%" data-act="r7-trade">${svg('wood', 16)} Stores &amp; trade routes</button>`;
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
        <button class="btn gold" data-act="savenow">Save now</button>
        <button class="btn blue" data-act="r7-share" data-tip="Share code|Turn your village into a line of text to send to a friend, or load someone else's.">${svg('star', 18)} Share / load a village</button></div>
        <div class="help"><p><b>How to play.</b> Build a Lumber Hut and a Forager Hut first so you have wood and food. Idle villagers automatically build construction sites. Tap a building to add or remove workers, or open <b>People</b> to give anyone a job.</p>
        <p><b>Seasons.</b> Each season lasts three days. Spring blossom, summer sun, autumn apples, then snow — fields and berry bushes grow slowly in winter, so stock up. On the second day of every season the village holds a festival at dusk: everyone dances round the campfire, and it lifts their spirits for a whole day.</p>
        <p><b>Weather.</b> The clock shows a three-day forecast. Rain makes crops grow faster. Storms (and winter blizzards) send everyone indoors for a while, so outdoor work and building pause — workshops keep going. You'll get a warning before one arrives.</p>
        <p><b>Gift chests</b> appear in the woods now and then — tap one to open it. Tap the campfire to rename your village, and the pencil next to anyone's name to rename them. Double-tap a villager to follow them around; the house button brings you home.</p>
        <p>Cottages bring new villagers, as long as there is food and folks are happy. Decorations raise happiness, which makes everyone work faster. Level up to unlock new buildings, then settle more clearings from the World map.</p>
        <p><b>Controls.</b> Drag to move · scroll or pinch to zoom · right-drag, two-finger twist or <kbd>Q</kbd>/<kbd>E</kbd> to rotate · <kbd>WASD</kbd> to pan · <kbd>R</kbd> rotates while placing · <kbd>Space</kbd> pauses · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> set the speed · <kbd>Esc</kbd> closes or cancels.</p>
        <p><b>Shortcuts.</b> <kbd>B</kbd> build · <kbd>G</kbd> decorate · <kbd>V</kbd> people · <kbd>T</kbd> town · <kbd>N</kbd> journal · <kbd>M</kbd> world · <kbd>L</kbd> buildings · <kbd>I</kbd> stores · <kbd>H</kbd> home · <kbd>[</kbd> <kbd>]</kbd> switch build tabs · <kbd>?</kbd> this page. Hover (or long-press) almost anything for an explanation.</p>
        <p>Your village saves automatically in this browser.</p></div>
        ${eventsSettingsHtml(this)}${seedHtml(this)}<div class="actions"><button class="btn red" data-act="reset">${svg('trash', 16)} Start a new village with this seed</button><a class="btn ghost" href="/">${svg('back', 16)} Back to isaiart.com</a></div>`;
    } else if (k === 'story') {
      h += this.storyHtml();
    } else if (k === 'chronicle') {
      h += chronicleHtml(this);
    } else if (k === 'log') {
      h += s.log.map(l => `<div class="logline"><small>Day ${Math.floor(l.t / DAY) + 1}</small>${esc(l.msg)}</div>`).join('') || '<p>No news yet.</p>';
      this.seenLog = s.log.length; this.markLog();
    } else if (k === 'magic') {
      h += rpgSpellbookHtml(this);          // SRD 5.1 spells, slots and attribution (rpgui.js)
    } else if (k === 'guild') {
      h += rpgGuildHtml(this);
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
        ['coin', 'Coins traded', st.earned], ['smile', 'Happiness', Math.round(s.happiness)], ['rain', 'Showers & storms', st.rains || 0],
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
    if (R7_MODALS[k]) h = r7ModalHtml(this, k);
    const body = $('#mBody');
    if (refresh) morph(body, h);
    else {
      body.innerHTML = h; body.scrollTop = 0;
      if (swap) restart(body, 'swap');
    }
    if (k === 'worldmap') {
      this.drawMinimap();
      // parties out on expeditions walk across the map while it's open
      if (!document.getElementById('expmapcss')) { const st = document.createElement('style'); st.id = 'expmapcss'; st.textContent = EXPMAP_CSS; document.head.appendChild(st); }
      clearInterval(this._expT); drawExpMap(this, svg);
      this._expT = setInterval(() => { if (!drawExpMap(this, svg)) clearInterval(this._expT); }, 120);
    }
  }

  // ── villagers: who does what, with filters, grouping and one-tap jobs ──
  villagersHtml() { return peopleBoardHtml(this, faceSvg); }
  buildingsHtml() { return buildingsBoardHtml(this); }

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
    if (boardClick(this,act,a)) return;
    if (act === 'seed-input') return;
    if (seedClick(this, act)) { this.drawModal(true); return; }
    if (act.startsWith('town-')) { townClick(this, act, a); if (this.modal) this.drawModal(true); return; }
    if (act.startsWith('ev-')) { eventsClick(this, act, a); if (this.modal) this.drawModal(true); return; }
    if (act.startsWith('lv-')) { lifeClick(this, act, a); this.dirty.res = true; if (this.modal) this.drawModal(true); return; }
    if (act === 'job') return;                       // the dropdown itself; handled on change
    if (act.startsWith('rpg-')) { rpgModalClick(this, act, a); this.dirty.res = true; this.drawModal(true); return; }
    if (act.startsWith('r7-')) { r7Click(this, act, a); this.dirty.res = true; if (this.modal) this.drawModal(true); return; }
    if (act === 'sell10') {
      const k = a.dataset.k, half = Math.max(1, Math.floor(GOODS[k].price / 2));
      if (s.res[k] >= 10) { s.res[k] -= 10; s.res.coins += half * 10; s.stats.earned += half * 10; sfx.coin(); this.dirty.res = true; }
    }
    if (act === 'pop-sid') { this.popSid = a.dataset.k; sfx.click(); this.drawModal(true); return; }
    if (act === 'storyf') { this.storyFilter = a.dataset.k; sfx.click(); this.drawModal(true); return; }
    if (act === 'mtab') { if (a.dataset.m !== this.modal) { this.modal = a.dataset.m; this.drawModal(false, true); this.drawDock(); sfx.click(); } return; }
    if (act === 'vsel') { const v = sim.vById.get(+a.dataset.id); if (v) { this.closeModal(); this.g.select({ kind: 'v', v }, true); } return; }
    if (act === 'bsel') { const b = sim.bById.get(+a.dataset.id); if (b) { this.closeModal(); this.g.select({ kind: 'b', b }, true); } return; }
    if (act === 'bf') { this.bFilter[a.dataset.k] = a.dataset.v; sfx.click(); this.drawModal(true); return; }
    if (act === 'cast') { if (sim.cast(a.dataset.id)) { this.toast(`${SPELLS.find(o => o.id === a.dataset.id).name}!`, 'staff'); this.closeModal(); return; } }
    if (act === 'ach') { if (sim.claimAch(a.dataset.id)) this.toast('Achievement reward claimed!', 'trophy'); }
    if (act === 'deal') { if (sim.merchantDeal(+a.dataset.i)) this.toast('Pleasure doing business!', 'shop'); }
    if (act === 'placetok') { this.closeModal(); this.openTray('decor', DECOR[a.dataset.t]?.festive ? 'festive' : 'rare'); this.g.startPlace(a.dataset.t); this.markCard(a.dataset.t); return; }
    if (act === 'openb') { const b = sim.bById.get(+a.dataset.id); if (b) { this.closeModal(); this.g.select({ kind: 'b', b }, true); } return; }
    if (act === 'vf') { this.vFilter = a.dataset.f; sfx.click(); this.drawModal(true); $('#mBody').scrollTop = 0; return; }
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
      if (a.dataset.sure) { this.g.reset($('#worldSeed')?.value ?? this.newSeed); return; }
      a.dataset.sure = 1; a.innerHTML = 'Tap again — this erases your village'; return;
    }
    this.dirty.res = true;
    this.drawModal(true);
  }
  modalChange(e) {
    if (boardChange(this,e)) return;
    if (townChange(this, e)) return;
    if (e.target.dataset.act === 'seed-input') { this.newSeed = e.target.value; this.seedTraits = null; return; }
    if (r7Change(this, e)) return;
    const t = e.target;
    if (t.dataset.act !== 'job') return;
    const sim = this.sim, v = sim.vById.get(+t.dataset.id), bid = +t.value;
    if (!v) return;
    const first = v.name.split(' ')[0];
    if (!bid) { sim.unassign(v); this.toast(`${first} is now idle — they'll help build`, 'person'); }
    else {
      const b = sim.bById.get(bid);
      if (b && sim.assign(b, v)) this.toast(`${first} is now a ${JOBS[defOf(b.type).job].name.toLowerCase()} at the ${defOf(b.type).name}`, 'hammer');
      else { this.toast(stageOf(v) !== 'adult' ? `${first} is too young or too old to work` : 'That job is full', 'person'); sfx.error(); }
    }
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
    // the snowbound pass, white up to its ragged snow line
    if (W.frost) {
      const F = W.frost, fx = (F.x + 0.5) * S, fz = (F.z + 0.5) * S, gr = g.createRadialGradient(fx, fz, F.R * S * 0.55, fx, fz, F.R * S);
      gr.addColorStop(0, 'rgba(240,246,255,.92)'); gr.addColorStop(0.82, 'rgba(226,236,250,.88)'); gr.addColorStop(1, 'rgba(226,236,250,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(fx, fz, F.R * S, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(120,150,190,.55)'; g.lineWidth = 1.5; g.setLineDash([3, 3]); g.beginPath(); g.arc(fx, fz, F.R * S * 0.86, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      // a little range of snow-capped peaks round the back of the pass
      g.lineJoin = 'round';
      for (let k = 0; k < 9; k++) {
        const a = F.passA + 0.9 + (k / 8) * (Math.PI * 2 - 1.8), d = F.R * S * (0.5 + (k % 2) * 0.14), px = fx + Math.cos(a) * d, py = fz + Math.sin(a) * d;
        if (px < 12 || py < 16 || px > cv.width - 12) continue;
        const w = 14 + (k * 7 % 5) * 1.8, h = w * 1.1;
        g.fillStyle = '#7d828c'; g.strokeStyle = '#3f434b'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(px - w, py + h * 0.45); g.lineTo(px, py - h * 0.55); g.lineTo(px + w, py + h * 0.45); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#f7faff';
        g.beginPath(); g.moveTo(px - w * 0.42, py - h * 0.13); g.lineTo(px, py - h * 0.55); g.lineTo(px + w * 0.42, py - h * 0.13); g.lineTo(px + w * 0.15, py - h * 0.2); g.lineTo(px - w * 0.1, py - h * 0.08); g.closePath(); g.fill();
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
    // the ferry crossing
    const I = this.sim.world.island;
    if (I) {
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo((I.moor[0][0] + N / 2) * S, (I.moor[0][1] + N / 2) * S); g.lineTo((I.moor[1][0] + N / 2) * S, (I.moor[1][1] + N / 2) * S); g.stroke(); g.setLineDash([]);
    }
    // settlement medallions + labels below
    g.font = '600 14px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const st of SETTLEMENTS) {
      const c = CENTERS[st.id]; if (!c) continue;
      const un = this.sim.s.unlocked[st.id], x = (c.x + 0.5) * S, y = (c.z + 0.5) * S;
      if (un) { g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, this.sim.settlementRadius(st.id) * S, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = un ? '#fff8e8' : '#f3e2bf'; g.strokeStyle = '#8a5a2b'; g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill(); g.stroke();
      const ic = iconImage(un ? 'house' : 'lock');
      if (ic.complete) g.drawImage(ic, x - 9, y - 9, 18, 18); else ic.onload = () => this.drawMinimap();
      const nm = this.sim.sname(st.id), tw = g.measureText(nm).width + 14, ly = y + 25, lx = Math.min(cv.width - tw / 2 - 3, Math.max(tw / 2 + 3, x));   // kept inside the map
      g.fillStyle = 'rgba(255,248,232,.95)'; g.strokeStyle = '#c48a4a'; g.lineWidth = 2;
      g.beginPath(); g.roundRect(lx - tw / 2, ly - 10, tw, 20, 10); g.fill(); g.stroke();
      g.fillStyle = '#5b3a1e'; g.fillText(nm, lx, ly + 1);
    }
  }

  // the village's story: love, friendships, squabbles, babies, farewells… grouped by day
  storyHtml() {
    const s = this.sim.s, list = s.story || [], f = this.storyFilter || 'all';
    // entries that arrived since you last looked get a soft highlight; opening the page reads them
    if (this.storyOpenSeen == null) this.storyOpenSeen = s.storySeen || 0;
    const seen = this.storyOpenSeen;
    if (s.storySeen !== s.storyN) { s.storySeen = s.storyN || 0; this.markLog(); }
    const KINDS = { family: ['love', 'baby', 'farewell', 'breakup', 'wedding'], friends: ['friends', 'rivals', 'squabble', 'makeup'], wishes: ['wish', 'granted', 'pet'], milestones: ['arrive', 'leave', 'grow', 'study', 'leader', 'archmage', 'rank', 'visitor'], trouble: ['crime', 'mischief'] };
    const pinned = e => e.kind === 'wish' && this.sim.vById.get(e.faces[0]?.id)?.wish?.made === e.t;
    const shown = list.filter(e => (f === 'all' || KINDS[f]?.includes(e.kind)) && !pinned(e));
    let h = `<div class="storybar">${[['all', 'Everything'], ['family', 'Love & family'], ['friends', 'Friends & rivals'], ['wishes', 'Wishes & pets'], ['milestones', 'Milestones'], ['trouble', 'Mischief']].map(([k, t]) => `<button class="tog ${f === k ? 'on' : ''}" data-act="storyf" data-k="${k}">${t}</button>`).join('')}</div>`;
    if (f === 'all' || f === 'wishes') h += wishListHtml(this);
    if (!shown.length) return h + '<p class="sub" style="text-align:center;padding:20px">Nothing yet. Life in the village will be written here.</p>';
    let day = null;
    for (const e of shown.slice(0, 80)) {
      const d = Math.floor(e.t / DAY) + 1;
      if (d !== day) { day = d; h += `<h4 class="sday">Day ${d}</h4>`; }
      const faces = e.faces.map(p => this.sim.vById.has(p.id) ? `<button class="sface" data-act="vsel" data-id="${p.id}" data-tip="${esc(p.name)}|Tap to visit">${faceSvg(p, 34)}</button>` : `<span class="sface gone" data-tip="${esc(p.name)}|No longer in the village">${faceSvg(p, 34)}</span>`).join('');
      h += `<div class="sentry k-${e.kind}${e.n > seen ? ' fresh' : ''}">${faces ? `<div class="sfaces">${faces}</div>` : `<div class="sfaces"><span class="sic">${svg(e.icon, 22)}</span></div>`}<div class="stext">${esc(e.text)}<small>${svg(e.icon, 12)} ${hm((e.t % DAY) / DAY)}</small></div></div>`;
    }
    return h;
  }
  // one badge on the Journal: unread story, achievements to claim, festival rewards
  markLog() {
    const sim = this.sim, news = Math.max(0, (sim.s.storyN || 0) - (sim.s.storySeen || 0));
    const trophies = sim.achievements().filter(x => x.done && !x.claimed).length;
    const fest = sim.festShop?.open() ? sim.festShop.quests().filter(q => q.done && !q.claimed).length : 0;
    const n = trophies + (sim.s.chronNew || 0);
    this.dockBadge('journal', n, 'to collect', { dot: news > 0 }); void fest;
  }

  // ── toasts & floats ──
  // One toast at a time: a new one waits until the current one has been up briefly, then
  // replaces it once it has faded out (no stacking, no overlap); duplicates merge.
  toast(msg, icon = 'info', big = false) {
    this.tq = this.tq || [];
    // while the first-time tips are running, family and friendship news waits in the log
    const tut = this.sim.s.tutorial;
    if (tut !== undefined && tut < 5 && /fell in love|best friends|baby was born|welcome to the world|grew up/i.test(msg)) return;
    // a festival-opening toast must name the festival whose quests are actually open
    const fm = /^(.+): festival quests and the festival shop are open!$/.exec(msg), cur = fm && this.sim.festShop?.current?.();
    if (fm && (!cur || cur.name !== fm[1])) return;
    if (this.tq.some(t => t.msg === msg)) return;
    if (this.curToast?.msg === msg) { this.curToast.start = performance.now(); return; }
    if (/^Level \d+!/.test(msg)) this.tq = this.tq.filter(t => !/^Level \d+!/.test(t.msg));
    const done = / complete!$/.test(msg) && this.tq.find(t => t.done);
    if (done) { done.n++; done.msg = `${done.n} buildings complete!`; return; }
    const joined = / joined the village!$/.test(msg) && this.tq.find(t => t.joined);
    if (joined) { joined.n++; joined.msg = `${joined.n} villagers joined!`; return; }
    this.tq.push({ msg, icon, big, done: / complete!$/.test(msg), joined: / joined the village!$/.test(msg), n: 1 });
    // a long backlog is just noise (it's all in the news log): drop the oldest small ones
    while (this.tq.length > 4) { const i = this.tq.findIndex(t => !t.big); this.tq.splice(i < 0 ? 0 : i, 1); }
    if (!this.toastBusy) this.nextToast();
  }
  nextToast() {
    if (innerWidth < 760 && document.body.classList.contains('info-open') && this.tq.length) { setTimeout(() => this.nextToast(), 600); return; }
    const t = this.tq.shift();
    if (!t) { this.toastBusy = false; return; }
    this.toastBusy = true;
    const warn = t.icon === 'storm' || /storm|blizzard/i.test(t.msg);
    const el = this.showToast(t.msg, t.icon, t.big, warn);
    const cur = this.curToast = { msg: t.msg, el, start: performance.now() };
    const min = warn ? 2200 : t.big ? 1800 : 1300, life = warn ? 4400 : t.big ? 3000 : 2500;
    const step = () => {
      const age = performance.now() - cur.start;
      if (age < life && !(age >= min && this.tq.length)) { this.toastT = setTimeout(step, 150); return; }
      el.classList.add('leave');
      setTimeout(() => { el.remove(); if (this.curToast === cur) this.curToast = null; this.nextToast(); }, 190);
    };
    this.toastT = setTimeout(step, 150);
  }
  showToast(msg, icon, big, warn) {
    const el = document.createElement('div');
    el.className = 'toast panel' + (big ? ' big' : '') + (warn ? ' warn' : '');
    el.innerHTML = svg(icon, big ? 30 : 22) + `<span>${esc(msg)}</span>`;
    const box = $('#toasts');
    for (const o of [...box.children]) o.remove();
    box.appendChild(el);
    return el;
  }
  float(sx, sy, text, icon, cls = '') {
    // keep floaters on screen and off the HUD edges (on phone, clear of the right-hand button column)
    const ph = phone(), m = ph ? 30 : 40;
    sx = Math.max(m, Math.min(innerWidth - (ph ? 76 : m), sx));
    sy = Math.max(ph ? 140 : 90, Math.min(innerHeight - (ph ? 100 : 90), sy));
    const el = document.createElement('div');
    el.className = 'float' + (cls ? ' ' + cls : '');
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    el.innerHTML = (icon ? svg(icon, 18) : '') + esc(text);
    $('#floats').appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }
}
