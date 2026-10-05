import {svg} from './icons.js';
import {stageOf} from './sim.js';
import {TOWER_MODES,towerMode} from './arcane.js';
const esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function progressBuildingHtml(ui,b){
  const sim=ui.sim;if(!b.built)return '';
  if(['library','school','university'].includes(b.type))return `<div class="ip-sec"><div class="cap">${svg('cap',14)} Education & careers</div><div class="desc">Library graduates seek suitable local vacancies or staffed university places. New learners take the freed seats. Teachers and professors stay on staff.</div><button class="btn sm ${sim.s.autoCareers!==false?'gold':''}" data-act="progress-cycle" aria-pressed="${sim.s.autoCareers!==false}">Automatic education & careers · ${sim.s.autoCareers!==false?'On':'Off'}</button></div>`;
  if(b.type!=='wizard')return '';
  const mode=towerMode(b),check=sim.towerRitualCheck(b),recipe=b.data.recipe==='bricks'?'bricks':'planks';
  const cost=Object.entries(sim.towerCost(b)).map(([k,n])=>`${n} ${k} (${Math.floor(sim.trade.get(b.sid,k))} here)`).join(', ')||'No materials';
  const effects={research:'Add up to 8 research toward the next eligible spell, plus 1 knowledge.',ward:'Maintain a local ward for 90 seconds; crime pressure falls by 8.',nature:'Advance up to 3 nearby growing fields by 25%.',artifice:`Make 1 ${recipe==='bricks'?'brick':'plank'} from 2 ${recipe==='bricks'?'stone':'wood'}.`};
  return `<div class="ip-sec"><div class="cap">${svg('staff',14)} Tower discipline</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${Object.entries(TOWER_MODES).map(([id,d])=>`<button class="btn sm ${mode===id?'gold':'ghost'}" data-act="progress-mode" data-mode="${id}" aria-pressed="${mode===id}">${svg(d.icon,14)} ${d.name}</button>`).join('')}</div><div class="desc">${esc(TOWER_MODES[mode].desc)}</div>${mode==='artifice'?`<div class="actions">${['planks','bricks'].map(k=>`<button class="btn sm ${recipe===k?'gold':'ghost'}" data-act="progress-recipe" data-recipe="${k}" aria-pressed="${recipe===k}">${k==='planks'?'Wood → planks':'Stone → bricks'}</button>`).join('')}</div>`:''}<dl class="kv"><dt>Local materials / session</dt><dd>${esc(cost)}</dd><dt>Completed practice / rituals</dt><dd>${b.data.sessions||0}</dd>${mode==='nature'?`<dt>Growing fields in reach</dt><dd>${sim.towerFields(b).length}</dd>`:''}${mode==='ward'?`<dt>Ward remaining</dt><dd>${Math.max(0,Math.ceil((b.data.wardUntil||0)-sim.s.time))} seconds</dd>`:''}</dl><div class="desc">Focused ritual: ${esc(effects[mode])} Uses the same materials, plus 10 treasury coins; 90-second cooldown. Requires an awake wizard.</div><button class="btn blue sm" data-act="progress-ritual" ${check.ok?'':'disabled'}>Perform focused ritual · 10 coins</button>${check.ok?'':`<div class="desc">${esc(check.why)}</div>`}</div>`;
}
export function progressVillagerHtml(ui,v){
  if(stageOf(v)!=='adult')return '';
  const active=v.autoCareer!==false;
  return `<div class="ip-sec"><div class="cap">${svg('cap',14)} Education & career plan</div><div class="desc">${esc(v.careerNote||'Seek further study or suitable local work while idle. Keep productive jobs.')} ${ui.sim.s.autoCareers===false?'Village-wide automatic placement is paused.':''}</div><button class="btn sm ${active?'gold':'ghost'}" data-act="progress-person" aria-pressed="${active}">${active?'Automatic plan · On':'Keep current role · On'}</button><div class="desc">Turn the automatic plan off to keep your manual assignment, including library research.</div></div>`;
}
export function progressClick(ui,act,a,sel){
  if(!act.startsWith('progress-'))return false;
  const sim=ui.sim,b=sel?.kind==='b'?sel.b:null,v=sel?.kind==='v'?sel.v:null;
  if(act==='progress-cycle')sim.s.autoCareers=sim.s.autoCareers===false;
  if(act==='progress-person'&&v)v.autoCareer=v.autoCareer===false;
  if(act==='progress-mode'&&b)sim.setTowerMode(b,a.dataset.mode);
  if(act==='progress-recipe'&&b?.type==='wizard'&&['planks','bricks'].includes(a.dataset.recipe)){b.data.recipe=a.dataset.recipe;for(const id of b.workers){const w=sim.vById.get(id);if(w)sim.dropTask(w);}sim.emit('building',b);}
  if(act==='progress-ritual'&&b){const check=sim.towerRitualCheck(b);if(!check.ok||!sim.performTowerRitual(b))ui.toast(check.why||'Ritual is unavailable','staff');else ui.toast('Focused ritual completed','staff');}
  return true;
}
