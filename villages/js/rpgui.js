// Panels for the RPG layer: ability scores and health in the villager panel, the Forge,
// Guild Hall, Watchtower, Schoolhouse and Wizard Tower sections, the Guild Hall window and
// the spell book. ui.js calls in here with a few one-line hooks.
import { svg, addIcons } from './icons.js';
import { GOODS, JOBS, SPELLS, BUILDINGS } from './data.js';
import { stageOf, DAY, defOf } from './sim.js';
import { faceSvg } from './ui.js';
import { enchantHtml, enchantToast, magicGearTag } from './magicui.js';
import { SCROLLS_PER_PARTY } from './magic.js';
import { ABIL, ABIL_INFO, mod, fmtMod, CLASSES, classOf, aptitudeOf, maxHp, armorClass, guardAttack, classAttack, JOB_ABIL, jobFit, fitLabel, stars,
  xpToNext, RECIPES, EXPEDITIONS, difficulty, SUPPLIES, slotsFor, casterNeeds, studyCost, diceStr, MONSTERS } from './rpg.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tip = (t, b) => `data-tip="${esc(t)}|${esc(b).replace(/\|/g, '/')}"`;
const first = v => v.name.split(' ')[0];
const hpCls = k => k > 0.6 ? '' : k > 0.3 ? ' mid' : ' low';
const gname = k => ({ ore: 'iron ore', iron: 'iron bars' }[k] || GOODS[k]?.name.toLowerCase() || k);
const atkText = a => a.save ? `${a.name}: ${a.save.toUpperCase()} save vs DC ${a.dc}, ${diceStr(a.dmg)}` : `${a.name}: ${fmtMod(a.bonus)} to hit, ${diceStr(a.dmg)}`;
const dur = days => `${days === 0.5 ? '½ day' : days === 1 ? '1 day' : days === 1.5 ? '1½ days' : days + ' days'} · ${Math.round(days * DAY / 60)} min`;

addIcons({
  ore: `<path d="M5 21l4-9 8-4 8 3 3 8-4 7-13 1z" fill="#8a807a" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><g fill="#d27a3a"><circle cx="12" cy="16" r="2"/><circle cx="19" cy="13" r="1.6"/><circle cx="20" cy="21" r="2.2"/><circle cx="13" cy="23" r="1.3"/></g>`,
  iron: `<path d="M3 24l3-6h12l3 6z" fill="#9ea7b0" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><path d="M11 17l3-6h12l3 6z" fill="#c9d0d7" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 13h9M7 20h9" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".7"/>`,
  sword: `<path d="M27.5 4.5l-1 5.5L13 23.5 8.5 19 22 5.5z" fill="#e3e8ed" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><path d="M6 16l10 10" stroke="#5b3a1e" stroke-width="5" stroke-linecap="round"/><path d="M6 16l10 10" stroke="#f0b93a" stroke-width="2.6" stroke-linecap="round"/><path d="M10 22l-5 5" stroke="#5b3a1e" stroke-width="4.4" stroke-linecap="round"/><path d="M10 22l-5 5" stroke="#9a6a3e" stroke-width="2.2" stroke-linecap="round"/>`,
  bow: `<path d="M9 3c13 4 17 14 11 26" fill="none" stroke="#5b3a1e" stroke-width="4.6" stroke-linecap="round"/><path d="M9 3c13 4 17 14 11 26" fill="none" stroke="#b9773e" stroke-width="2.4" stroke-linecap="round"/><path d="M9 3l11 26" stroke="#efe6cf" stroke-width="1.2"/><path d="M4 16h21" stroke="#5b3a1e" stroke-width="1.8" stroke-linecap="round"/><path d="M25 16l-4-3v6z" fill="#9aa1a8" stroke="#5b3a1e" stroke-width="1.2" stroke-linejoin="round"/><path d="M4 16l-1-3M4 16l-1 3" stroke="#e2413c" stroke-width="1.6" stroke-linecap="round"/>`,
  armor: `<path d="M10 4l6 3 6-3 6 5-3 5-2-1v15H9V13l-2 1-3-5z" fill="#b9c2ca" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><g fill="none" stroke="#8a949e" stroke-width="1"><path d="M11 14c1.5 1 3.5 1 5 0 1.5 1 3.5 1 5 0M11 18c1.5 1 3.5 1 5 0 1.5 1 3.5 1 5 0M11 22c1.5 1 3.5 1 5 0 1.5 1 3.5 1 5 0"/></g><path d="M9 26h14" stroke="#9a6a3e" stroke-width="2.4"/>`,
  sparkle: `<path d="M16 3l2.6 10.4L29 16l-10.4 2.6L16 29l-2.6-10.4L3 16l10.4-2.6z" fill="#c79af2" stroke="#5b3a1e" stroke-width="1.5" stroke-linejoin="round"/><circle cx="25" cy="6" r="1.8" fill="#f3d6ff"/><circle cx="7" cy="25" r="1.4" fill="#f3d6ff"/>`,
  thorns: `<path d="M4 24c6-1 8-8 13-9s7 4 11 1" fill="none" stroke="#4d8f34" stroke-width="2.6" stroke-linecap="round"/><g fill="#8ab04a" stroke="#5b3a1e" stroke-width="1.1" stroke-linejoin="round"><path d="M9 21l-1-5 3 3z"/><path d="M14 16l1-5 1 5z"/><path d="M20 15l3-3-1 4z"/><path d="M24 17l1 5-3-3z"/></g>`,
  fire: `<path d="M16 29c-6 0-10-4-10-9 0-6 6-9 6-16 3 2 5 5 5 9 1-2 2-3 2-6 4 3 7 8 7 13 0 5-4 9-10 9z" fill="#ff8a3a" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 29c-3 0-5-2-5-5 0-3 3-5 4-8 2 2 6 5 6 8 0 3-2 5-5 5z" fill="#ffd54f"/>`,
  bolt: `<path d="M19 2L7 18h8l-4 12 14-17h-8l4-11z" fill="#ffd54f" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/>`,
  d20: `<path d="M16 3l11.5 6.5v13L16 29 4.5 22.5v-13z" fill="#a66be0" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 9.5l7 11.5H9z" fill="#c79af2" stroke="#5b3a1e" stroke-width="1.2" stroke-linejoin="round"/><path d="M16 3v6.5M4.5 9.5L9 21M27.5 9.5L23 21M9 21l-4.5 1.5M23 21l4.5 1.5M9 21l7 8 7-8" fill="none" stroke="#5b3a1e" stroke-width="1" stroke-linejoin="round"/>`,
  anvil: `<path d="M4 9h18c0 3 3 5 6 5v2h-8l-3 3v4h4v4H9v-4h4v-4l-3-3H8C5 16 4 13 4 9z" fill="#7d8790" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 11h13" stroke="#b9c2ca" stroke-width="1.4" stroke-linecap="round"/>`,
  banner: `<path d="M8 3v26" stroke="#5b3a1e" stroke-width="3.6" stroke-linecap="round"/><path d="M8 3v26" stroke="#9a6a3e" stroke-width="1.8" stroke-linecap="round"/><path d="M9 5h16v15l-8-3.5L9 20z" fill="#4f8fd9" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><path d="M17 7.5l1.4 3h3.1l-2.5 2 1 3-3-1.9-3 1.9 1-3-2.5-2h3.1z" fill="#ffd54f"/>`,
});

const CSS = `
.hbar{position:absolute;transform:translate(-50%,-100%);width:42px;height:9px;border-radius:5px;background:#5b3a1e;border:2px solid #fff8e8;overflow:hidden;box-shadow:0 1px 2px rgba(40,20,5,.55)}
.hbar i{display:block;height:100%;background:linear-gradient(#9be86d,#4fae32);transition:width .25s}
.hbar.mid i{background:linear-gradient(#ffe066,#f0a826)}.hbar.low i{background:linear-gradient(#ff9a8a,#d9473d)}
.hbar.beast{width:36px;border-color:#ffe2d6}.hbar.beast i{background:linear-gradient(#ff9a7a,#b8402f)}
.float.dmg{font-size:15.5px;animation:dmgRise 1.1s ease-out forwards}
.float.dmg.crit{color:#ffe066;font-size:20px}.float.dmg.miss{color:#efe8da;font-size:13px;font-style:italic}
.float.dmg.hurt{color:#ffb0a4}.float.dmg.heal{color:#b6f08f}.float.dmg.thorn{color:#c9ec8a;font-size:11px}.float.dmg.alert{color:#ffd54f;font-size:18px}
@keyframes dmgRise{0%{transform:translate(-50%,-40%) scale(.6);opacity:0}15%{transform:translate(-50%,-90%) scale(1.12);opacity:1}100%{transform:translate(-50%,-210%);opacity:0}}
.abil{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
.abil .ab{display:flex;flex-direction:column;align-items:center;padding:3px 0 4px;border-radius:9px;background:#fff;border:2px solid #ead2a6;line-height:1.08;cursor:help}
.abil .ab small{font-size:9.5px;font-weight:700;color:var(--ink2);letter-spacing:.04em}
.abil .ab b{font-size:15px;font-variant-numeric:tabular-nums}
.abil .ab i{font-style:normal;font-size:10.5px;font-weight:700;color:#3f8a2a}.abil .ab i.neg{color:#a8392f}.abil .ab i.zero{color:var(--ink2)}
.abil .ab.key{border-color:var(--gold);background:#fff8dc}
.hpline{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.hpb{flex:1;height:10px;border-radius:5px;background:#ead9b8;overflow:hidden;border:1.5px solid #d6b98a}
.hpb i{display:block;height:100%;background:linear-gradient(90deg,#9be86d,#4fae32);transition:width .4s}
.hpb.mid i{background:linear-gradient(90deg,#ffe066,#f0a826)}.hpb.low i{background:linear-gradient(90deg,#ff9a8a,#d9473d)}
.hpb.sm{height:6px;flex:none;width:100%}
.rpgtags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.rtag{display:inline-flex;align-items:center;gap:3px;padding:1px 7px 1px 3px;border-radius:9px;background:#fff;border:1.5px solid #e2c99c;font-size:11px;font-weight:600;cursor:help}
.rtag.gold{border-color:var(--gold);background:#fff8dc}.rtag.dim{opacity:.6}
.bestat{font-size:11.5px;color:var(--ink2);margin-top:6px;line-height:1.3}
.recipes{display:flex;flex-direction:column;gap:4px}
.recipe{display:flex;align-items:center;gap:6px;padding:3px 6px 3px 3px;border-radius:10px;background:#fff;border:2px solid #e2c99c;font-size:12px;text-align:left;width:100%;color:var(--ink)}
.recipe.on{border-color:var(--green);background:#effbe6}.recipe.locked{opacity:.62;background:#f7f1e3}.recipe.making{box-shadow:0 0 0 2px #ffe08a inset}
.recipe .nm{font-weight:700;flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.1}.recipe .nm small{font-weight:600;color:var(--ink2);font-size:10.5px}
.recipe .in{display:flex;gap:2px 5px;font-size:11px;color:var(--ink2);align-items:center;flex-wrap:wrap;justify-content:flex-end}.recipe .in span{display:inline-flex;align-items:center;gap:1px}
.recipe .in span.no{color:#c0392b}
.recipe .st{font-size:11.5px;font-weight:700;min-width:30px;text-align:right}
.armory{display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:6px;font-size:12px;font-weight:700}.armory span{display:inline-flex;align-items:center;gap:2px;cursor:help}
.guards{display:flex;flex-direction:column;gap:5px}
.grow2{display:flex;align-items:center;gap:7px;font-size:12px}.grow2 .face{width:30px;height:30px;flex:none}
.grow2 .gm{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.grow2 .gm b{font-size:12.5px}.grow2 .gm small{color:var(--ink2);font-size:10.5px}
.ptab{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:10px}
.pcard{background:var(--card);border:2px solid #ead2a6;border-radius:12px;padding:7px 8px;display:flex;flex-direction:column;gap:4px;font-size:11.5px}
.pcard .hd{display:flex;align-items:center;gap:6px}.pcard .hd .face{width:34px;height:34px;flex:none}.pcard .hd b{font-size:13px;display:block}
.pcard .row{display:flex;gap:4px;flex-wrap:wrap;align-items:center}.pcard .btns{display:flex;gap:4px;margin-top:auto;flex-wrap:wrap}.pcard .btns .btn{flex:1 1 auto;min-width:0;padding:4px 7px;justify-content:center}
.pcard.empty{border-style:dashed;align-items:center;justify-content:center;color:var(--ink2);min-height:92px;text-align:center}.pcard.empty .ic{width:30px;height:30px}.pcard.empty .ic path{stroke:#c9a46a}
.cands{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.cand{display:flex;align-items:center;gap:8px;padding:4px 7px;border-radius:10px;background:var(--card);border:2px solid #ead2a6;font-size:12px}
.cand .face{width:30px;height:30px;flex:none}.cand .cm{flex:1;min-width:0}.cand .cm b{display:block;font-size:12.5px}.cand .cm small{color:var(--ink2)}
.qboard{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;margin-bottom:10px}
.qcard{background:var(--card);border:2px solid #ead2a6;border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:4px}
.qcard .top{display:flex;align-items:center;gap:6px;font-weight:700;font-size:13.5px}.qcard .blurb{font-size:11.5px;color:var(--ink2);line-height:1.3}
.qcard .meta{display:flex;flex-wrap:wrap;gap:4px;font-size:11px;font-weight:600}.qcard .btn{margin-top:auto}
.diff{padding:0 6px;border-radius:8px;font-size:10.5px;font-weight:700;border:1.5px solid}.diff.ok{background:#effbe6;color:#3f7a2a;border-color:#bfe0a6}.diff.warn{background:#fff3d6;color:#7a5410;border-color:#f0d58a}.diff.bad{background:#fde6e2;color:#a8392f;border-color:#f2b8ad}
.elog{font-size:12.5px;line-height:1.35;display:flex;flex-direction:column;gap:3px;margin-top:6px}
.elog p{padding:3px 8px;border-left:3px solid #e2c99c;background:#fffdf6;border-radius:0 6px 6px 0}.elog p.new{animation:swapIn .4s var(--ease)}
.elog p.got{border-left-color:var(--gold);font-weight:600}
.expbox{background:#fffaf0;border:2px solid var(--edge);border-radius:12px;padding:8px 10px;margin-bottom:10px}
.pastlog summary{cursor:pointer;font-size:12.5px;font-weight:700;padding:4px 0}
.slotdots{display:inline-flex;gap:2px;align-items:center}.slotdots i{width:9px;height:9px;border-radius:50%;background:#b18cff;border:1.5px solid #4a2f8a;display:inline-block}.slotdots i.used{background:#ece6f6;border-color:#b9a8d8}
.slotrow{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11.5px;font-weight:700;align-items:center}
.spell .meta{font-size:10px;font-weight:700;color:#6b4ab8;text-transform:uppercase;letter-spacing:.04em}
.spell .dnd{font-size:11.5px;font-style:italic;color:var(--ink2);line-height:1.3}.spell .fx{font-size:11.5px;line-height:1.3}
.spell.locked{opacity:.66}
.splvl{margin:12px 0 6px;font-size:13px;display:flex;align-items:center;gap:6px}
.srd{font-size:11px;color:var(--ink2);margin-top:12px;text-align:center;line-height:1.4}.srd a{color:inherit}
.knowbar{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700}
@media (max-width:759px){.abil .ab b{font-size:14px}.qboard{grid-template-columns:1fr}.ptab{grid-template-columns:1fr 1fr}}
`;
if (typeof document !== 'undefined' && !document.getElementById('rpgcss')) {
  const st = document.createElement('style'); st.id = 'rpgcss'; st.textContent = CSS; document.head.appendChild(st);
}

// ── shared bits ──
function hpBar(v, sm) {
  const mx = maxHp(v), hp = Math.max(0, Math.ceil(v.hp ?? mx)), k = hp / mx;
  return sm ? `<div class="hpb sm${hpCls(k)}"><i style="width:${Math.round(k * 100)}%"></i></div>`
    : `<div class="hpb${hpCls(k)}"><i style="width:${Math.round(k * 100)}%"></i></div>`;
}
const HEAL_TIP = 'Villagers heal over time: faster when fed, asleep or resting, near a campfire or tavern, and when the tavern is lively. Cure Wounds heals at once. Knocked-out villagers rest at home until they are back above 60%.';
function gearTags(v) {
  const g = v.gear || {}, out = [];
  if (g.w) out.push(`<span class="rtag" ${tip({ sword: 'Sword', bow: 'Bow', staff: 'Staff' }[g.w], GOODS[g.w].desc)}>${svg(g.w, 14)}${esc({ sword: 'Sword', bow: 'Bow', staff: 'Staff' }[g.w])}</span>`);
  if (g.a) out.push(`<span class="rtag" ${tip('Armour', GOODS.armor.desc)}>${svg('armor', 14)}Armour</span>`);
  if (g.s) out.push(`<span class="rtag" ${tip('Shield', GOODS.shield.desc)}>${svg('shield', 14)}Shield</span>`);
  out.push(magicGearTag(v));
  return out.join('');
}
function classTag(v) {
  const k = classOf(v), c = CLASSES[k], L = v.lvl || 1;
  if (k === 'commoner') {
    const a = CLASSES[aptitudeOf(v)];
    return `<span class="rtag" ${tip(`Commoner · level ${L}`, `${c.desc} From their best abilities they would make a fine ${a.name}.`)}>${svg('person', 14)}Commoner ${L}</span><span class="rtag" ${tip(`Aptitude: ${a.name}`, a.desc)}>${svg(a.icon, 14)}→ ${a.name}</span>`;
  }
  return `<span class="rtag gold" ${tip(`${c.name} · level ${L}`, `${c.desc} They trained into this class. They earn xp by guarding, studying magic, smithing and adventuring.`)}>${svg(c.icon, 14)}${c.name} ${L}</span>`;
}
function jobFitText(v, job) {
  const f = fitLabel(jobFit(v, job)), ja = JOB_ABIL[job];
  if (!ja) return '';
  const pct = Math.round(((1 + 0.05 * mod(v.abil[ja[0]]) + 0.02 * mod(v.abil[ja[1]])) - 1) * 100);
  return { f, pct, ja };
}
// option suffix for job pickers: ★★☆
export function fitStars(v, job) { return JOB_ABIL[job] && v.abil ? ' ' + stars(fitLabel(jobFit(v, job)).n) : ''; }

// ── villager panel: health, class, abilities ──
export function rpgVillagerHtml(ui, v) {
  if (!v.abil) return '';
  const sim = ui.sim, s = sim.s, mx = maxHp(v), hp = Math.ceil(v.hp ?? mx), adult = stageOf(v) === 'adult';
  const status = v.ko > 0 ? 'Knocked out' : v.downed ? 'Resting to heal' : v.quest?.phase === 'away' ? 'Away adventuring' : hp < mx ? 'Healing' : 'Healthy';
  const ac = armorClass(v, s.rpg?.buffs, s.time), L = v.lvl || 1;
  let h = `<div class="ip-sec"><div class="cap">${svg('heart', 14)} Health<span class="r">${status}</span></div>
    <div class="hpline" ${tip(`Hit points: ${hp} of ${mx}`, `${HEAL_TIP} Maximum HP comes from their class hit die, level and Constitution.`)}>${hpBar(v)}<span>${hp}/${mx} HP</span></div>
    <div class="rpgtags">${classTag(v)}<span class="rtag" ${tip(`Experience · level ${L}`, `${Math.floor(v.xp || 0)} of ${xpToNext(L)} xp to level ${L + 1}. Each level adds hit points; every 4 levels adds +1 proficiency to attacks.`)}>${svg('xp', 14)}${Math.floor(v.xp || 0)}/${xpToNext(L)}</span>
    <span class="rtag" ${tip(`Armour class ${ac}`, 'How hard they are to hit: 10 + DEX, or 13 + DEX (max +2) in armour, +2 with a shield. Attackers roll a d20 plus their bonus and must meet this number.')}>${svg('shield', 14)}AC ${ac}</span>${gearTags(v)}</div></div>`;
  // ability scores
  const key = JOB_ABIL[v.job] || [];
  const ft = adult ? jobFitText(v, v.job) : '';
  h += `<div class="ip-sec"><div class="cap">${svg('d20', 14)} Abilities${ft ? `<span class="r" ${tip(`${ft.f.name} as ${JOBS[v.job].name.toLowerCase()}`, `This job leans on ${ABIL_INFO[ft.ja[0]].name} (+5% speed per point of modifier) and ${ABIL_INFO[ft.ja[1]].name} (+2% per point). Work speed ${ft.pct >= 0 ? '+' : ''}${ft.pct}%.`)}>${stars(ft.f.n)} ${ft.pct >= 0 ? '+' : ''}${ft.pct}% speed</span>` : ''}</div><div class="abil">`;
  for (const k of ABIL) {
    const sc = v.abil[k], m = mod(sc), inf = ABIL_INFO[k];
    const why = key[0] === k ? ` It's the main ability for their job: ${m >= 0 ? '+' : ''}${m * 5}% work speed.` : key[1] === k ? ` It helps their job a little: ${m >= 0 ? '+' : ''}${m * 2}% work speed.` : '';
    h += `<div class="ab${key.includes(k) ? ' key' : ''}" ${tip(`${inf.name} ${sc} (${fmtMod(m)})`, `${inf.desc} Scores run 3–18; the modifier (${fmtMod(m)}) is added to d20 rolls.${why}`)}><small>${inf.short}</small><b>${sc}</b><i class="${m < 0 ? 'neg' : m === 0 ? 'zero' : ''}">${fmtMod(m)}</i></div>`;
  }
  h += `</div>`;
  if (adult) {
    const jobs = Object.keys(JOB_ABIL).filter(j => j !== 'builder' && s.buildings.some(b => b.built && defOf(b.type).job === j));
    const best = jobs.sort((a, b) => jobFit(v, b) - jobFit(v, a)).slice(0, 3);
    if (best.length) h += `<div class="bestat" ${tip('Best suited jobs', 'Jobs whose main abilities match this villager best, among the workplaces you have built. "Fill jobs" and the + button pick the best-suited idle villager.')}>Best at: ${best.map(j => `<b>${esc(JOBS[j].name)}</b> ${stars(fitLabel(jobFit(v, j)).n)}`).join(' · ')}</div>`;
  } else if (stageOf(v) === 'child') h += `<div class="bestat">Took after their parents. Finishing school adds +1 INT and +1 WIS when they grow up.</div>`;
  if (v.quest) {
    const b = sim.bById.get(v.quest.bid), q = EXPEDITIONS.find(o => o.id === b?.data?.exp?.q);
    h += `<div class="hintbox">${svg('banner', 16)}<span>${q ? `Adventuring: <b>${esc(q.name)}</b> · ${Math.round(sim.expProgress(b) * 100)}% of the way through.` : 'Heading home from an expedition.'}</span></div>`;
  }
  return h + `</div>`;
}

// ── building panel sections ──
export function rpgBuildingHtml(ui, b) {
  if (!b.built) return '';
  const sim = ui.sim, s = sim.s, R = s.rpg || {};
  if (b.type === 'forge') return forgeHtml(sim, b);
  if (b.type === 'enchanter') return enchantHtml(sim, b);
  if (b.type === 'guild') return guildSection(sim, b);
  if (b.type === 'watchtower') {
    const gs = b.workers.map(id => sim.vById.get(id)).filter(Boolean);
    if (!gs.length) return '';
    const stock = gs.filter(g => sim.canEquip(g, 'guard'));
    return `<div class="ip-sec"><div class="cap">${svg('shield', 14)} The watch<span class="r" ${tip('How guards fight', 'From the tower each guard shoots one arrow a second (d20 + DEX + proficiency against the beast\'s armour class). When a beast comes within 7 tiles, the strongest healthy guard climbs down to meet it with a spear or sword, and the beast bites back. Once a beast is down to 40% of its HP it runs for the trees.')}>${svg('info', 13)} How it works</span></div><div class="guards">${gs.map(g => {
      const ac = armorClass(g, R.buffs, s.time), m = guardAttack(g, 'melee'), r = guardAttack(g, 'ranged');
      return `<div class="grow2">${faceSvg(g, 30)}<div class="gm"><b>${esc(g.name)} <small>${g.ko > 0 ? '· knocked out' : g.downed ? '· resting' : g.engage ? '· fighting!' : ''}</small></b>${hpBar(g, true)}<small ${tip('Attacks', `${atkText(r)} (from the tower). ${atkText(m)} (up close). AC ${ac}.`)}>AC ${ac} · ${esc(r.name)} ${fmtMod(r.bonus)} · ${esc(m.name)} ${fmtMod(m.bonus)}</small></div><span class="row">${gearTags(g).replace(/rtag/g, 'rtag')}</span></div>`;
    }).join('')}</div>${stock.length ? `<button class="btn sm" style="width:100%;margin-top:6px" data-act="rpg-equipguards">${svg('sword', 14)} Hand out gear from the armory</button>` : s.buildings.some(o => o.type === 'forge' && o.built) ? '' : `<div class="desc" style="margin-top:5px">A Forge can make swords, bows, shields and armour for the guards.</div>`}</div>`;
  }
  if (b.type === 'school') {
    const k = R.know || 0, next = RECIPES.find(rc => rc.know > k);
    return `<div class="ip-sec"><div class="cap">${svg('star', 14)} Village knowledge<span class="r">${Math.floor(k)}</span></div><div class="desc">Teachers at work raise the village's knowledge (smarter teachers, more pupils and a bigger school help). Knowledge unlocks Forge recipes.${next ? ` Next: <b>${esc(GOODS[next.out].name)}</b> at ${next.know}.` : ' Every recipe is unlocked!'}</div></div>`;
  }
  if (b.type === 'wizard') {
    const c = sim.caster(), L = c?.lvl || 0, used = s.magic.used || {};
    return `<div class="ip-sec"><div class="cap">${svg('staff', 14)} Spellcasting<span class="r">${c ? `${esc(first(c))} · wizard ${L}` : 'No wizard'}</span></div>${slotRow(L, used)}<div class="desc" style="margin-top:4px">Wizards gain levels as they study. Higher levels bring more spell slots and higher-level spells. Slots come back each dawn.</div></div>`;
  }
  return '';
}
function slotRow(L, used) {
  const sl = slotsFor(L);
  if (!sl.length) return `<div class="desc">Staff the tower with a wizard to cast spells.</div>`;
  return `<div class="slotrow" ${tip('Spell slots', 'Each level-1+ spell uses a slot of its level or higher. Cantrips are free. Slots refresh at dawn (05:20).')}>${sl.map((n, i) => `<span>L${i + 1} <span class="slotdots">${Array.from({ length: n }, (_, j) => `<i class="${j < (used[i + 1] || 0) ? 'used' : ''}"></i>`).join('')}</span></span>`).join('')}</div>`;
}
function forgeHtml(sim, b) {
  const s = sim.s, k = s.rpg?.know || 0, mode = b.data?.recipe || 'auto', res = s.res;
  let h = `<div class="ip-sec"><div class="cap">${svg('anvil', 14)} Recipes<span class="r" ${tip('Knowledge', 'The Schoolhouse builds up village knowledge while a teacher is at work. Each recipe needs enough of it, since smiths need schooling for fine work.')}>${svg('star', 13)} ${Math.floor(k)} knowledge</span></div><div class="recipes">`;
  h += `<button class="recipe${mode === 'auto' ? ' on' : ''}" data-act="rpg-recipe" data-k="auto" ${tip('Auto', 'The smith keeps two of every unlocked item in the armory, and smelts ore into iron bars the rest of the time.')}>${svg('rotate', 22)}<span class="nm">Auto<small>keep 2 of each, smelt the rest</small></span></button>`;
  for (const rc of RECIPES) {
    const open = k >= rc.know, making = b.data?.making === rc.id;
    const ins = Object.entries(rc.in).map(([g, n]) => `<span class="${(res[g] || 0) < n ? 'no' : ''}">${svg(GOODS[g].icon, 12)}${n}</span>`).join('');
    const t = open ? `${GOODS[rc.out].name}|Makes 1 ${gname(rc.out)} from ${Object.entries(rc.in).map(([g, n]) => `${n} ${gname(g)}`).join(' + ')} in ${rc.t}s. ${GOODS[rc.out].desc}` : `Locked: ${GOODS[rc.out].name}|Needs ${rc.know} village knowledge (you have ${Math.floor(k)}). Staff the Schoolhouse with a teacher to learn faster.`;
    h += `<button class="recipe${mode === rc.id ? ' on' : ''}${open ? '' : ' locked'}${making ? ' making' : ''}" data-act="rpg-recipe" data-k="${rc.id}" ${open ? '' : 'disabled'} data-tip="${esc(t)}">${svg(open ? rc.out : 'lock', 22)}<span class="nm">${esc(GOODS[rc.out].name)}<small>${open ? (making ? 'on the anvil now' : `${rc.t}s`) : `needs ${rc.know} knowledge`}</small></span><span class="in">${ins}</span><span class="st">${Math.floor(res[rc.out] || 0)}</span></button>`;
  }
  h += `</div><div class="armory">${['ore', 'iron', 'sword', 'bow', 'shield', 'armor', 'staff'].map(g => `<span ${tip(GOODS[g].name, `${GOODS[g].desc} From: ${GOODS[g].from}. Used by: ${GOODS[g].uses}.`)}>${svg(GOODS[g].icon, 16)}${Math.floor(res[g] || 0)}</span>`).join('')}</div>`;
  if (!s.buildings.some(o => o.type === 'quarry' && o.built)) h += `<div class="hintbox">${svg('info', 16)}<span>Build a Quarry: its miners turn up iron ore now and then once a Forge is lit.</span></div>`;
  return h + `</div>`;
}
function guildSection(sim, b) {
  const d = sim.guildOf(b), vs = sim.partyMembers(b), e = d.exp, q = e && EXPEDITIONS.find(o => o.id === e.q);
  let h = `<div class="ip-sec"><div class="cap">${svg('banner', 14)} Adventuring party<span class="r">${vs.length}/4</span></div><div class="wslots">`;
  for (const v of vs) h += `<div class="wslot"><button class="av" data-act="selv" data-id="${v.id}" ${tip(v.name, `${CLASSES[classOf(v)].name} ${v.lvl || 1} · ${Math.ceil(v.hp)}/${maxHp(v)} HP`)}>${faceSvg(v, 38)}</button>${hpBar(v, true)}<span class="nm">${esc(first(v))}</span></div>`;
  if (!vs.length) h += `<div class="desc">No one has signed up yet.</div>`;
  h += `</div>`;
  if (e && q) {
    const p = sim.expProgress(b), shown = e.log.filter(l => l.f <= p);
    h += `<div class="sub" style="margin:6px 0 0">${e.back ? 'Heading home from' : 'Away at'} <b>${esc(q.name)}</b></div><div class="pbar"><i style="width:${Math.round(p * 100)}%"></i></div><div class="elog">${shown.slice(-2).map(l => `<p>${esc(l.msg)}</p>`).join('')}</div>`;
  }
  h += `<button class="btn gold sm" style="width:100%;margin-top:7px" data-act="rpg-guild">${svg('banner', 15)} ${e ? 'Expedition log & party' : 'Manage party & expeditions'}</button></div>`;
  return h;
}

// ── the Guild Hall window ──
export function rpgGuildHtml(ui) {
  const sim = ui.sim, s = sim.s;
  const b = sim.bById.get(ui.guildBid) || s.buildings.find(o => o.type === 'guild' && o.built);
  if (!b) return `<p class="sub" style="font-size:13.5px">Build a <b>Guild Hall</b> (level ${BUILDINGS.guild.lvl}) to gather a party of adventurers.</p>`;
  ui.guildBid = b.id;
  const d = sim.guildOf(b), vs = sim.partyMembers(b), e = d.exp, R = s.rpg || {};
  let h = '';
  if (e) {
    const q = EXPEDITIONS.find(o => o.id === e.q), p = sim.expProgress(b), left = Math.max(0, e.t0 + e.dur - s.time);
    const shown = e.log.filter(l => l.f <= p);
    h += `<div class="expbox"><div class="top" style="display:flex;align-items:center;gap:6px;font-weight:700">${svg(q.icon, 22)}${esc(q.name)}<span style="margin-left:auto;font-size:12px;color:var(--ink2)">${e.back ? 'Coming home!' : `back in ${Math.ceil(left / 60)} min`}</span></div>
      <div class="prog"><i style="width:${Math.round(p * 100)}%;background:linear-gradient(90deg,#9be86d,#4fae32)"></i></div>
      <div class="elog">${shown.map((l, i) => `<p class="${i === shown.length - 1 ? 'new' : ''}">${esc(l.msg)}</p>`).join('')}${e.back && e.got?.length ? `<p class="got">${svg('gift', 14)} Brought home: ${esc(e.got.join(', '))}</p>` : ''}</div></div>`;
  } else {
    h += `<div class="callout calm">${svg('banner', 22)}<span>Pick 2–4 adventurers, then choose an expedition. Their class comes from their best abilities. They take gear from the armory (a magic item each, if there are any), up to ${SCROLLS_PER_PARTY} spell scrolls, ${SUPPLIES} food each for the road, and leave their jobs until they're home.</span></div>`;
  }
  // the party
  h += `<h3 style="margin:4px 0 6px;font-size:14px">The party · ${vs.length}/4</h3><div class="ptab">`;
  for (const v of vs) {
    const c = CLASSES[classOf(v)], a = classAttack(v), ac = armorClass(v, R.buffs, s.time), hp = Math.ceil(v.hp), mx = maxHp(v);
    const missing = !e && sim.canEquip(v, 'party');
    h += `<div class="pcard"><div class="hd">${faceSvg(v, 34)}<div style="min-width:0"><b>${esc(v.name)}</b>${classTag(v)}</div></div>
      <div class="hpline" ${tip(`${hp}/${mx} HP`, HEAL_TIP)}>${hpBar(v)}<span>${hp}/${mx}</span></div>
      <div class="row"><span class="rtag" ${tip(`Armour class ${ac}`, 'Monsters must roll this or higher on d20 + their bonus to hit.')}>${svg('shield', 13)}AC ${ac}</span><span class="rtag" ${tip(a.name, atkText(a))}>${svg(c.icon, 13)}${esc(a.name)}</span>${gearTags(v)}${v.jail > s.time ? '<span class="rtag">In the stocks</span>' : ''}</div>
      ${e ? '' : `<div class="btns">${missing ? `<button class="btn sm" data-act="rpg-pequip" data-id="${v.id}" ${tip('Equip', 'Take the best gear for their class from the armory.')}>${svg('sword', 13)}Gear</button>` : ''}${Object.keys(v.gear || {}).length ? `<button class="btn sm ghost" data-act="rpg-punequip" data-id="${v.id}" ${tip('Return gear', 'Put their gear back in the armory.')}>${svg('back', 12)}</button>` : ''}<button class="btn sm red" data-act="rpg-pkick" data-id="${v.id}">${svg('minus', 12)}Leave</button></div>`}</div>`;
  }
  for (let i = vs.length; i < (e ? 0 : 2); i++) h += `<div class="pcard empty">${svg('plus', 18)}<span>Add an adventurer below</span></div>`;
  h += `</div>`;
  if (!e) {
    // the quest board
    h += `<h3 style="margin:4px 0 6px;font-size:14px">${svg('map', 18)} Quest board</h3><div class="qboard">`;
    for (const q of EXPEDITIONS) {
      const df = difficulty(q, vs), ok = sim.canDepart(b, q);
      const rw = Object.entries(q.reward).filter(([k]) => k !== 'xp' && k !== 'rare').map(([k, r]) => `<span class="rtag" ${tip(GOODS[k].name, `${r[0]}–${r[1]} on a full success, less if the party has to fall back.`)}>${svg(GOODS[k].icon, 13)}${r[0]}–${r[1]}</span>`).join('');
      const foes = [...new Set(q.steps.flatMap(st => st.kind === 'fight' ? [MONSTERS[st.foe].plural] : []))].join(', ');
      h += `<div class="qcard"><div class="top">${svg(q.icon, 22)}${esc(q.name)}</div><div class="blurb">${esc(q.blurb)}</div>
        <div class="meta"><span class="diff ${df.cls}" ${tip(`Difficulty: ${df.name}`, `Suggested party level ${q.lvl}. Compares your party's average level and size. Fights use d20 attack rolls against armour class; there are also saving throws and ability checks. ${s.events?.mode === 'harsh' ? 'Harsh: anyone who falls makes death saving throws. A healer can pull them back, but adventurers can die.' : 'Nobody dies: if things go badly they fall back and come home hurt.'}`)}>${df.name}</span><span class="rtag">Lv ${q.lvl}+</span><span class="rtag">${svg('clock', 13)}${dur(q.days)}</span></div>
        <div class="meta">${rw}${q.reward.rare ? `<span class="rtag" ${tip('Treasure', `${Math.round(q.reward.rare * 100)}% chance of a rare treasure you can't build.`)}>${svg('gift', 13)}${Math.round(q.reward.rare * 100)}%</span>` : ''}<span class="rtag" ${tip('Experience', `${q.reward.xp} xp for each adventurer.`)}>${svg('xp', 13)}${q.reward.xp}</span></div>
        <div class="blurb">Foes: ${esc(foes)}</div>
        <button class="btn sm ${ok.ok ? 'gold' : ''}" data-act="rpg-go" data-q="${q.id}" ${ok.ok ? '' : 'disabled'}>${ok.ok ? `${svg('banner', 14)} Set off · ${svg('apple', 12)}${SUPPLIES * vs.length}${(s.res.scroll || 0) >= 1 ? ` · ${svg('scroll', 12)}${Math.min(SCROLLS_PER_PARTY, Math.floor(s.res.scroll))}` : ''}` : esc(ok.why)}</button></div>`;
    }
    h += `</div>`;
    // recruits
    const taken = new Set(s.buildings.filter(o => o.type === 'guild').flatMap(o => o.data?.party || []));
    const cands = s.villagers.filter(v => stageOf(v) === 'adult' && !taken.has(v.id) && !v.quest && !(v.jail > s.time))
      .sort((a, c) => (c.lvl || 1) - (a.lvl || 1) || Math.max(...Object.values(c.abil)) - Math.max(...Object.values(a.abil)));
    h += `<h3 style="margin:4px 0 6px;font-size:14px">${svg('people', 18)} Recruits</h3><div class="cands">`;
    for (const v of cands.slice(0, 30)) {
      const c = CLASSES[classOf(v)], top = [...ABIL].sort((x, y) => v.abil[y] - v.abil[x]).slice(0, 2);
      const cn = classOf(v) === 'commoner' ? `Commoner → ${CLASSES[aptitudeOf(v)].name}` : `${c.name} ${v.lvl || 1}`;
      h += `<div class="cand" data-key="c${v.id}">${faceSvg(v, 30)}<div class="cm"><b>${esc(v.name)}</b><small>${esc(cn)} · ${top.map(k => `${ABIL_INFO[k].short} ${v.abil[k]}`).join(', ')} · ${Math.ceil(v.hp)}/${maxHp(v)} HP · ${esc(JOBS[v.job]?.name || '')}</small></div>
        <button class="btn sm" data-act="rpg-padd" data-id="${v.id}" ${vs.length >= 4 ? 'disabled' : ''}>${svg('plus', 12)}Join</button></div>`;
    }
    if (!cands.length) h += `<p class="sub" style="font-size:12px;color:var(--ink2)">No grown-ups are free to join.</p>`;
    h += `</div>`;
  }
  if (d.logs.length) {
    h += `<h3 style="margin:4px 0 6px;font-size:14px">${svg('mail', 18)} Past expeditions</h3>`;
    for (const l of d.logs) {
      const q = EXPEDITIONS.find(o => o.id === l.q);
      h += `<details class="pastlog"><summary>${esc(q?.name || 'Expedition')} · day ${Math.floor(l.t / DAY) + 1} · ${l.ok ? 'success' : 'fell back'}</summary><div class="elog">${l.lines.map(m => `<p>${esc(m)}</p>`).join('')}${l.got.length ? `<p class="got">${svg('gift', 14)} ${esc(l.got.join(', '))}</p>` : ''}</div></details>`;
    }
  }
  return h;
}

// ── the spell book ──
export function rpgSpellbookHtml(ui) {
  const sim = ui.sim, s = sim.s, m = s.magic, c = sim.caster(), L = c?.lvl || 0, R = s.rpg || {};
  let h = '';
  if (!s.buildings.some(b => b.type === 'wizard' && b.built)) h += `<p class="sub" style="font-size:13.5px;margin-bottom:8px">Build a <b>Wizard Tower</b> (level 4) and give it apprentices. They study to learn the spells below, and gain levels for bigger spells.</p>`;
  const next = SPELLS.find(sp => !m.known.includes(sp.id) && L >= casterNeeds(sp));
  const on = [['bless', 'Bless'], ['magearmor', 'Mage Armor'], ['faerie', 'Faerie Fire'], ['spike', 'Spike Growth'], ['guidance', 'Guidance'], ['light', 'Light']].filter(([k]) => (R.buffs?.[k] || 0) > s.time);
  h += `<div class="summary"><span class="chip" ${tip('Caster', 'Spells are cast by your highest-level wizard. Wizards earn xp by studying at the tower and by casting.')}>${svg('staff', 18)}${c ? `${esc(c.name)} · wizard ${L}` : 'No wizard yet'}</span>
    ${next ? `<span class="chip" ${tip('Studying', `Your wizards are learning ${next.name}. Study points come from each study session at the tower.`)}>${svg('star', 18)}Learning ${esc(next.name)} · ${Math.floor(m.study / studyCost(next) * 100)}%</span>` : c ? `<span class="chip">${svg('star', 18)}Studying for higher levels</span>` : ''}
    ${on.length ? `<span class="chip">${svg('sparkle', 18)}Active: ${on.map(o => o[1]).join(', ')}</span>` : ''}</div>`;
  if (c) h += `<div style="margin:-2px 0 8px">${slotRow(L, m.used || {})}</div>`;
  let lastLvl = -1;
  for (const sp of SPELLS) {
    if (sp.lvl !== lastLvl) {
      if (lastLvl >= 0) h += `</div>`;
      lastLvl = sp.lvl;
      h += `<h3 class="splvl">${svg(sp.lvl ? 'd20' : 'sparkle', 18)}${sp.lvl ? `Level ${sp.lvl}` : 'Cantrips'} <small style="font-weight:600;color:var(--ink2);font-size:11.5px">${sp.lvl ? `needs a level ${casterNeeds(sp)} wizard · uses a spell slot` : 'free to cast, short cooldown'}</small></h3><div class="grid">`;
    }
    const known = m.known.includes(sp.id), cc = sim.canCast(sp.id);
    h += `<div class="tile spell ${known ? '' : 'locked'}"><div class="top">${svg(known ? sp.icon : 'lock', 24)}${esc(sp.name)}</div><div class="meta">${sp.lvl ? `Level ${sp.lvl}` : 'Cantrip'} · ${esc(sp.school)}</div>
      <div class="dnd">${esc(sp.desc)}</div><div class="fx">${esc(sp.fx)}</div>
      <button class="btn sm" style="${known ? 'background:linear-gradient(#b18cff,#7a5ad8);border-color:#4a2f8a' : ''}" data-act="cast" data-id="${sp.id}" ${cc.ok ? '' : 'disabled'}>${svg('staff', 14)} ${known ? (cc.ok ? `Cast${sp.lvl ? ` · L${sim.slotFor(sp.lvl)} slot` : ''}` : esc(cc.why)) : `Not learned yet${L < casterNeeds(sp) ? ` · wizard ${casterNeeds(sp)}` : ''}`}</button></div>`;
  }
  h += `</div><p class="srd">Spells, monsters and rules adapted from the <a href="https://dnd.wizards.com/resources/systems-reference-document" target="_blank" rel="noopener">System Reference Document 5.1</a> by Wizards of the Coast LLC, licensed under <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noopener">CC-BY-4.0</a>. Descriptions are paraphrased. SRD 5.1, CC-BY-4.0.</p>`;
  return h;
}

// ── clicks ──
export function rpgInfoClick(ui, act, a, sel) {
  const sim = ui.sim, b = sel?.kind === 'b' ? sel.b : null;
  if (act === 'rpg-crystalpri') { sim.s.crystalPriority = a.dataset.k; ui.toast(a.dataset.k === 'share' ? 'Scribes and the enchanter will share crystals' : 'Crystals go to the enchanter first', 'crystal'); return; }
  if (act === 'rpg-recipe' && b?.type === 'enchanter') { b.data.recipe = a.dataset.k; ui.toast(enchantToast(a.dataset.k), 'wand'); return; }
  if (act === 'rpg-recipe' && b) { b.data.recipe = a.dataset.k; ui.toast(a.dataset.k === 'auto' ? 'The smith will keep the armory stocked' : `The smith will make ${GOODS[RECIPES.find(r => r.id === a.dataset.k).out].name.toLowerCase()}`, 'anvil'); return; }
  if (act === 'rpg-guild') { ui.guildBid = b?.id; ui.openModal('guild'); return; }
  if (act === 'rpg-equipguards' && b) {
    let n = 0; for (const id of b.workers) { const v = sim.vById.get(id); if (v) n += sim.equip(v, 'guard').length; }
    ui.toast(n ? `Handed out ${n} piece${n > 1 ? 's' : ''} of gear` : 'Everyone already has what the armory can spare', 'shield');
  }
}
export function rpgModalClick(ui, act, a) {
  const sim = ui.sim, b = sim.bById.get(ui.guildBid), v = sim.vById.get(+a.dataset.id);
  if (!b) return;
  if (act === 'rpg-padd' || act === 'rpg-pkick') {
    const r = sim.partyToggle(b, v);
    if (!r.ok) ui.toast(r.why, 'person'); else ui.toast(r.joined ? `${first(v)} joined the party as a ${CLASSES[classOf(v)].name}` : `${first(v)} left the party`, 'banner');
  }
  if (act === 'rpg-pequip' && v) { const got = sim.equip(v, 'party'); ui.toast(got.length ? `${first(v)} took ${got.map(gname).join(', ')}` : 'Nothing suitable in the armory', 'sword'); }
  if (act === 'rpg-punequip' && v) { sim.unequip(v); ui.toast(`${first(v)}'s gear went back to the armory`, 'shield'); }
  if (act === 'rpg-go') { if (sim.startExpedition(b, a.dataset.q)) ui.toast('Off they go! Watch the log here.', 'banner'); }
}
