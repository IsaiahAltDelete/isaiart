// Panel bits for automatic careers and wizard-tower modes. Actions: "progress-".
import { svg } from './icons.js';
import { stageOf } from './sim.js';
import { TOWER_MODES, towerMode } from './arcane.js';
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function progressBuildingHtml(ui, b) {
  const sim = ui.sim; if (!b.built) return '';
  if (['library', 'school', 'university'].includes(b.type)) {
    const on = sim.s.autoCareers !== false;
    return `<div class="ip-sec"><div class="autorow"><button class="tog ${on ? 'on' : ''}" data-act="progress-cycle" aria-pressed="${on}" data-tip="Automatic careers|Idle grown-ups study at the Library, go on to the University if they qualify, then take a suitable local job.">${svg('cap', 14)} Automatic careers</button></div></div>`;
  }
  if (b.type !== 'wizard') return '';
  const mode = towerMode(b);
  return `<div class="ip-sec"><div class="cap">${svg('staff', 14)} The tower practises</div><div class="autorow">${Object.entries(TOWER_MODES).map(([id, d]) => `<button class="tog ${mode === id ? 'on' : ''}" data-act="progress-mode" data-mode="${id}" aria-pressed="${mode === id}">${svg(d.icon, 14)} ${d.name}</button>`).join('')}</div>
    <div class="desc">${esc(TOWER_MODES[mode].desc)}${mode === 'nature' ? ` ${sim.towerFields(b).length} growing field${sim.towerFields(b).length === 1 ? '' : 's'} in reach.` : ''}</div></div>`;
}
// one line inside the villager's Education section
export function progressVillagerHtml(ui, v) {
  if (stageOf(v) !== 'adult') return '';
  const on = v.autoCareer !== false && ui.sim.s.autoCareers !== false;
  return `<div class="autorow" style="margin-top:6px"><button class="tog ${v.autoCareer !== false ? 'on' : ''}" data-act="progress-person" aria-pressed="${v.autoCareer !== false}" data-tip="Automatic career|When idle, they study or take a suitable job by themselves. Turn off to keep the job you give them.">${svg('cap', 14)} Automatic career</button></div>${on && v.careerNote ? `<div class="sub">${esc(v.careerNote)}</div>` : ''}`;
}
export function progressClick(ui, act, a, sel) {
  if (!act.startsWith('progress-')) return false;
  const sim = ui.sim, b = sel?.kind === 'b' ? sel.b : null, v = sel?.kind === 'v' ? sel.v : null;
  if (act === 'progress-cycle') sim.s.autoCareers = sim.s.autoCareers === false;
  if (act === 'progress-person' && v) v.autoCareer = v.autoCareer === false;
  if (act === 'progress-mode' && b) sim.setTowerMode(b, a.dataset.mode);
  return true;
}
