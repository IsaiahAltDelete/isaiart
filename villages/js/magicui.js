// Panels and icons for magic goods (magic.js): the Enchanter's Forge section, the magic item in a
// villager's gear tags, and drawn icons for crystals and the three magic items (painted ones in
// art/icons/ win when they exist).
import { svg, addIcons } from './icons.js';
import { GOODS } from './data.js';
import { ENCHANTS } from './magic.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tip = (t, b) => `data-tip="${esc(t)}|${esc(b).replace(/\|/g, '/')}"`;
const O = 'stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"';

addIcons({
  crystal: `<path d="M9 28l-3-9 4-9 4 9-1 9z" fill="#2fb8c0" ${O}/><path d="M13 28l1-12 5-12 5 12 0 12z" fill="#5fe0e0" ${O}/><path d="M23 28l0-8 3-6 3 6-2 8z" fill="#239aa8" ${O}/>`
    + `<path d="M17 8l2-4 2 5-2 13z" fill="#d6fbfb"/><path d="M4 28h25" ${O} fill="none"/>`,
  runeblade: `<path d="M27.5 4.5l-1 5.5L13 23.5 8.5 19 22 5.5z" fill="#cfe4f2" ${O}/><path d="M23 9l-1.6 1.6M19.6 12.4l-1.6 1.6M16.2 15.8l-1.6 1.6" stroke="#5ff2ff" stroke-width="2" stroke-linecap="round"/>`
    + `<path d="M6 16l10 10" stroke="#5b3a1e" stroke-width="5" stroke-linecap="round"/><path d="M6 16l10 10" stroke="#2fb8c0" stroke-width="2.6" stroke-linecap="round"/>`
    + `<path d="M10 22l-5 5" stroke="#5b3a1e" stroke-width="4.4" stroke-linecap="round"/><path d="M10 22l-5 5" stroke="#4a3a6a" stroke-width="2.2" stroke-linecap="round"/>`,
  wand: `<path d="M7 27L21 11" stroke="#5b3a1e" stroke-width="4.6" stroke-linecap="round"/><path d="M7 27L21 11" stroke="#c98b4a" stroke-width="2.4" stroke-linecap="round"/>`
    + `<path d="M20 6l4-2 2 4-2 5-5-3z" fill="#5fe0e0" ${O}/><path d="M27 15l.8 1.6 1.7.8-1.7.8-.8 1.6-.8-1.6-1.7-.8 1.7-.8z" fill="#ffd54f"/><path d="M13 5l.6 1.2 1.3.6-1.3.6-.6 1.2-.6-1.2-1.3-.6 1.3-.6z" fill="#ffd54f"/>`,
  amulet: `<path d="M8 4c0 7 4 11 8 12 4-1 8-5 8-12" fill="none" stroke="#5b3a1e" stroke-width="3.4" stroke-linecap="round"/><path d="M8 4c0 7 4 11 8 12 4-1 8-5 8-12" fill="none" stroke="#c9c2b4" stroke-width="1.6" stroke-linecap="round"/>`
    + `<circle cx="16" cy="21.5" r="7.5" fill="#8a8f96" ${O}/><path d="M16 16l4.2 5.5L16 27l-4.2-5.5z" fill="#5fe0e0" ${O}/><path d="M16 17.5l2 4-2 1.5z" fill="#d6fbfb"/>`,
});

const ITEM_NAME = { runeblade: 'Runeblade', wand: 'Wand', amulet: 'Warding Amulet' };
export function magicGearTag(v) {
  const m = v.gear?.m;
  return m ? `<span class="rtag" ${tip(ITEM_NAME[m], GOODS[m].desc)}>${svg(m, 14)}${esc(ITEM_NAME[m])}</span>` : '';
}

// ── the Enchanter's Forge ──
const gname = k => GOODS[k]?.name.toLowerCase() || k;
export function enchantHtml(sim, b) {
  const s = sim.s, res = s.res, mode = b.data?.recipe || 'auto';
  let h = `<div class="ip-sec"><div class="cap">${svg('wand', 14)} Enchantments</div><div class="recipes">`;
  h += `<button class="recipe${mode === 'auto' ? ' on' : ''}" data-act="rpg-recipe" data-k="auto" ${tip('Auto', 'The enchanter makes whichever magic item there is least of, so adventurers get a bit of everything and the rest goes to market. Two swords and two iron bars are always left for the armory.')}>${svg('rotate', 22)}<span class="nm">Auto</span></button>`;
  for (const rc of ENCHANTS) {
    const making = b.data?.making === rc.id;
    const ins = Object.entries(rc.in).map(([g, n]) => `<span class="${(res[g] || 0) < n ? 'no' : ''}">${svg(GOODS[g].icon, 12)}${n}</span>`).join('');
    const t = `${GOODS[rc.out].name}|Makes 1 ${gname(rc.out).replace(/s$/, '')} from ${Object.entries(rc.in).map(([g, n]) => `${n} ${gname(g)}`).join(' + ')} in ${rc.t}s. ${GOODS[rc.out].desc}`;
    h += `<button class="recipe${mode === rc.id ? ' on' : ''}${making ? ' making' : ''}" data-act="rpg-recipe" data-k="${rc.id}" data-tip="${esc(t)}">${svg(rc.out, 22)}<span class="nm">${esc(ITEM_NAME[rc.out])}</span><span class="ins">${ins}</span></button>`;
  }
  h += `</div><div class="armory">${['crystal', 'sword', 'iron', 'planks', 'runeblade', 'wand', 'amulet', 'scroll'].map(g => `<span ${tip(GOODS[g].name, `${GOODS[g].desc} From: ${GOODS[g].from}. Used by: ${GOODS[g].uses}.`)}>${svg(GOODS[g].icon, 16)}${Math.floor(res[g] || 0)}</span>`).join('')}</div>`;
  // supply against demand: what quarries found lately, and what this enchanter gets through at their own speed
  const rate = sim.crystalRate?.(), use = sim.enchantUse?.(b) || 0, pri = s.crystalPriority || 'enchanter';
  h += `<div class="sub" style="margin-top:6px" ${tip('Crystal supply', 'Crystals found by Quarry miners over the last minute or so, against what this enchanter gets through working without a break (their speed counts: schooling, happiness, the building level). Expeditions bring more in bursts.')}>${svg('crystal', 13)} ${rate == null ? 'Counting what the quarries find…' : rate >= 0.05 ? `Quarries find about ${rate.toFixed(1)} a minute` : 'No crystals coming in from quarries yet'}${use ? ` · this enchanter uses about ${use.toFixed(1)}` : ''}</div>`;
  h += `<div class="sub" style="margin-top:6px">Crystals go first to:</div><div class="autorow">${[['enchanter', 'Enchanter', 'Scribes leave the last two crystals for the enchanter, whenever the enchanter has everything else for an item.'], ['share', 'Share', 'Scribes and the enchanter take crystals as they come.']].map(([k, t, d]) => `<button class="tog ${pri === k ? 'on' : ''}" data-act="rpg-crystalpri" data-k="${k}" ${tip(t, d)}>${t}</button>`).join('')}</div>`;
  if ((res.crystal || 0) < 2) h += `<div class="hintbox">${svg('info', 16)}<span>Arcane crystals come from Quarry miners (now and then, while a Wizard Tower stands) and from expeditions to the Barrow, the Old Dwarf Mine, Wisp Marsh and the Dragon's Nap.</span></div>`;
  return h + `</div>`;
}
export const enchantToast = k => k === 'auto' ? 'The enchanter will make a bit of everything' : `The enchanter will make ${gname(ENCHANTS.find(r => r.id === k).out)}`;
