import { GOODS, JOBS, SETTLEMENTS } from './data.js';
import { defOf, isDecor, lvlOf, workersOf, stageOf, housingOf } from './sim.js';
import { CENTERS, toWorld } from './world.js';
import { CLASSES, classOf, jobFit, fitLabel, stars } from './rpg.js';
import { RACES } from './society.js';
import { TIERS, JOB_EDU } from './education.js';
import { CLASS_PLACES } from './classplaces.js';
const esc = t => String(t ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const selected = (a,b) => a===b?'selected':'';
const cash = n => (n||0).toFixed(1);
const plural = (n,word) => `${n} ${word}${n===1?'':'s'}`;
export function currentRegion(ui) {
  const {tx=0,tz=0}=ui.g?.view?.rig || {}; let best='meadow', dist=Infinity;
  for(const sid of Object.keys(ui.sim.s.unlocked)) {const c=CENTERS[sid]; if(!c)continue; const d=Math.hypot(toWorld(c.x)-tx,toWorld(c.z)-tz);if(d<dist){best=sid;dist=d;}}
  return best;
}
export function boardRegion(ui) { const sid=ui.boardSid || 'current'; return sid==='current'?currentRegion(ui):sid==='all'?null:ui.sim.s.unlocked[sid]?sid:currentRegion(ui); }
export const availableForJob = (sim,v) => stageOf(v)==='adult' && !v.quest && !(v.jail>sim.s.time) && !(v.ko>0) && !v.downed;
export function jobCandidates(sim,b) { return sim.s.villagers.filter(v=>v.home===b.sid && v.job==='idle' && availableForJob(sim,v) && sim.canDoJob(v,defOf(b.type).job)).sort((a,c)=>jobFit(c,defOf(b.type).job)-jobFit(a,defOf(b.type).job)||a.name.localeCompare(c.name)); }
export function regionSummary(sim,sid) {
  const people=sim.s.villagers.filter(v=>v.home===sid), buildings=sim.s.buildings.filter(b=>b.sid===sid&&!isDecor(b.type));
  return {pop:people.length, beds:buildings.filter(b=>b.built).reduce((n,b)=>n+housingOf(b),0), idle:people.filter(v=>v.job==='idle'&&availableForJob(sim,v)).length,
    jobs:buildings.filter(b=>b.built&&defOf(b.type).workers).reduce((n,b)=>n+Math.max(0,workersOf(b)-b.workers.length),0), upgrades:buildings.filter(b=>sim.canUpgrade(b).ok).length, buildings:buildings.length};
}
const cost = (c,s) => Object.entries(c||{}).map(([k,n])=>`<span class="${s.res[k]<n?'missing':''}">${esc(GOODS[k].name)} ${n}</span>`).join(' · ');
function toolbar(ui,type) {
  const s=ui.sim.s, query=ui.boardQuery?.[type]||'';
  return `<div class="board-toolbar"><label>Region<select data-act="board-region" aria-label="Board region"><option value="current" ${selected(ui.boardSid||'current','current')}>Current · ${esc(ui.sim.sname(currentRegion(ui)))}</option><option value="all" ${selected(ui.boardSid,'all')}>All regions</option>${Object.keys(s.unlocked).map(sid=>`<option value="${sid}" ${selected(ui.boardSid,sid)}>${esc(ui.sim.sname(sid))}</option>`).join('')}</select></label><label>Search<input type="search" data-act="board-search" data-kind="${type}" value="${esc(query)}" aria-label="Search ${type}" placeholder="${type==='buildings'?'Building or region':'Name, class or workplace'}"></label></div>`;
}
const queryMatch=(ui,type,text)=>text.toLowerCase().includes((ui.boardQuery?.[type]||'').toLowerCase().trim());
export function peopleBoardHtml(ui,face) {
  const sim=ui.sim,s=sim.s,sid=boardRegion(ui),people=s.villagers.filter(v=>!sid||v.home===sid),f=ui.peopleStatus||'all';
  let h=toolbar(ui,'villagers')+`<div class="board-stats"><span>${plural(people.length,'resident')}</span><span>${people.filter(v=>v.job==='idle'&&availableForJob(sim,v)).length} ready for work</span><span>${people.filter(v=>v.hungry).length} hungry</span></div>`;
  h+=`<div class="board-toolbar"><label>Show<select data-act="board-people-status" aria-label="Villager status">${[['all','Everyone'],['idle','Available workers'],['working','Employed'],['unavailable','Away / custody / recovery'],['children','Children'],['hungry','Hungry']].map(([k,t])=>`<option value="${k}" ${selected(f,k)}>${t}</option>`).join('')}</select></label><label>Class<select data-act="board-class" aria-label="Villager class"><option value="all">All classes</option>${Object.entries(CLASSES).map(([k,d])=>`<option value="${k}" ${selected(ui.peopleClass,k)}>${esc(d.name)}</option>`).join('')}</select></label></div>`;
  const list=people.filter(v=>(!ui.peopleClass||ui.peopleClass==='all'||classOf(v)===ui.peopleClass)&&queryMatch(ui,'villagers',`${v.name} ${JOBS[v.job]?.name||v.job} ${v.work&&sim.bById.has(v.work)?sim.homeName(sim.bById.get(v.work)):''} ${CLASSES[classOf(v)].name} ${RACES[v.race]?.name}`)
    && (f==='all'||f==='idle'&&v.job==='idle'&&availableForJob(sim,v)||f==='working'&&v.work||f==='unavailable'&&stageOf(v)==='adult'&&!availableForJob(sim,v)||f==='children'&&stageOf(v)==='child'||f==='hungry'&&v.hungry))
    .sort((a,b)=>(a.job!=='idle')-(b.job!=='idle')||a.name.localeCompare(b.name));
  h+='<div class="board-list">';
  for(const v of list) {
    const status=v.jail>s.time?'In custody':v.quest?'On expedition':v.ko>0||v.downed?'Recovering':stageOf(v)==='child'?'Child':stageOf(v)==='elder'?'Retired':v.job==='idle'?'Ready for work':JOBS[v.job]?.name||v.job;
    h+=`<article class="resident-card" data-key="resident${v.id}"><div class="resident-top">${face(v,44)}<div><button class="board-name" data-act="vsel" data-id="${v.id}">${esc(v.name)}</button><small>${esc(RACES[v.race]?.name||'Human')} · ${esc(CLASSES[classOf(v)].name)} ${v.lvl||1} · age ${Math.floor(v.age)}</small></div><span class="board-badge">${esc(status)}</span></div><div class="board-muted">${esc(TIERS[sim.eduTier(v)]?.name)} · ${cash(v.purse)} coins · ${esc(sim.sname(v.home))}</div><p>${esc(ui.doingOf(v))}</p>${availableForJob(sim,v)?`<div class="resident-job"><label>Job<select data-act="job" data-id="${v.id}" aria-label="Job for ${esc(v.name)}">${ui.workOptions(v,true)}</select></label>${v.work?`<button class="btn ghost sm" data-act="openb" data-id="${v.work}">View workplace</button>`:'<span class="board-muted">Idle workers build and clear trees.</span>'}</div>`:''}</article>`;
  }
  return h+'</div>'+(!list.length?'<p class="board-empty">No residents match these filters.</p>':'');
}
export function jobsBoardHtml(ui) {
  const sim=ui.sim,sid=boardRegion(ui); const jobs=sim.s.buildings.filter(b=>b.built&&defOf(b.type).workers&&(!sid||b.sid===sid));
  const open=jobs.reduce((n,b)=>n+Math.max(0,workersOf(b)-b.workers.length),0);
  let h=toolbar(ui,'jobs')+`<div class="board-stats"><span>${plural(open,'open position')}</span><span>${plural(jobs.length,'workplace')}</span></div><p class="board-muted">Candidates are available local adults, ranked by job fit. Schooling, custody and recovery are checked before hiring.</p><label class="board-switch"><input type="checkbox" data-act="board-open-only" ${ui.onlyOpen!==false?'checked':''}> Show vacancies only</label><div class="board-list">`;
  const list=jobs.filter(b=>(ui.onlyOpen===false||b.workers.length<workersOf(b))&&queryMatch(ui,'jobs',`${sim.homeName(b)} ${JOBS[defOf(b.type).job].name} ${sim.sname(b.sid)} ${CLASS_PLACES[b.type]?.cls||''} ${b.workers.map(id=>sim.vById.get(id)?.name||'').join(' ')}`));
  for(const b of list) {
    const job=defOf(b.type).job,cands=jobCandidates(sim,b),need=JOB_EDU[job]||0,free=Math.max(0,workersOf(b)-b.workers.length);
    const staff=b.workers.map(id=>sim.vById.get(id)).filter(Boolean).map(v=>`<button class="btn ghost sm" data-act="vsel" data-id="${v.id}">${esc(v.name)}${availableForJob(sim,v)?'':' · Away / recovery'}</button>`).join(' ');
    h+=`<article class="job-card" data-key="job${b.id}"><div class="board-card-head"><img alt="" src="${ui.g.thumbs[b.type]||''}"><div><button class="board-name" data-act="bsel" data-id="${b.id}">${esc(sim.homeName(b))}</button><small>${esc(JOBS[job].name)} · ${esc(sim.sname(b.sid))}</small></div><span class="board-badge ${free?'ready':''}">${free} open · ${b.workers.length}/${workersOf(b)}</span></div>${staff?`<div class="region-actions" style="margin-top:10px" aria-label="Current staff">${staff}</div>`:''}${need?`<p class="board-muted">Requires ${TIERS[need].name} education.</p>`:''}${CLASS_PLACES[b.type]?`<p class="board-muted">${esc(CLASS_PLACES[b.type].benefit)}</p>`:''}${free&&cands.length?`<label>Candidate<select data-act="board-candidate" data-bid="${b.id}" aria-label="Candidate for ${esc(sim.homeName(b))}">${cands.map(v=>`<option value="${v.id}" ${selected(ui.jobPicks?.[b.id],v.id)}>${esc(v.name)} · ${stars(fitLabel(jobFit(v,job)).n)} ${fitLabel(jobFit(v,job)).name}</option>`).join('')}</select></label><button class="btn gold sm" data-act="board-hire" data-bid="${b.id}">Assign candidate</button>`:free?'<p class="board-muted">No qualified idle adults here. Use the Villager board to release or reassign a worker.</p>':'<p class="board-muted">Fully staffed.</p>'}</article>`;
  }
  return h+'</div>'+(!list.length?'<p class="board-empty">No workplaces match these filters. Show all workplaces or upgrade a building for more jobs.</p>':'');
}
export function buildingsBoardHtml(ui) {
  const sim=ui.sim,sid=boardRegion(ui),all=sim.s.buildings.filter(b=>!isDecor(b.type)&&(!sid||b.sid===sid)),f=ui.buildingStatus||'all';
  let h=toolbar(ui,'buildings')+`<div class="board-stats"><span>${plural(all.length,'building')}</span><span>${plural(all.filter(b=>sim.canUpgrade(b).ok).length,'upgrade')} ready</span><span>${plural(all.filter(b=>!b.built||b.up).length,'construction site')}</span></div><label class="board-filter">Show<select data-act="board-building-status" aria-label="Building status">${[['all','All buildings'],['ready','Upgrades ready'],['blocked','Upgrades blocked'],['sites','Construction / upgrades'],['attention','Needs attention']].map(([k,t])=>`<option value="${k}" ${selected(f,k)}>${t}</option>`).join('')}</select></label><div class="board-list">`;
  const list=all.filter(b=>queryMatch(ui,'buildings',`${sim.homeName(b)} ${defOf(b.type).name} ${sim.sname(b.sid)}`)&&(f==='all'||f==='ready'&&sim.canUpgrade(b).ok||f==='blocked'&&b.built&&!b.up&&lvlOf(b)<3&&!sim.canUpgrade(b).ok||f==='sites'&&(!b.built||b.up)||f==='attention'&&['bad','warn'].includes(ui.bStatus(b)?.cls)))
    .sort((a,b)=>Number(sim.canUpgrade(b).ok)-Number(sim.canUpgrade(a).ok)||sim.homeName(a).localeCompare(sim.homeName(b)));
  for(const b of list) {
    const d=defOf(b.type),st=ui.bStatus(b),ok=sim.canUpgrade(b),canGrow=b.built&&!b.up&&lvlOf(b)<3;
    h+=`<article class="building-card" data-key="building${b.id}"><div class="board-card-head"><img alt="" src="${ui.g.thumbs[b.type]||''}"><div><button class="board-name" data-act="bsel" data-id="${b.id}">${esc(b.type==='campfire'?sim.sname(b.sid)+' campfire':sim.homeName(b))}</button><small>Level ${lvlOf(b)} · ${esc(sim.sname(b.sid))}${d.workers?` · ${b.workers.length}/${workersOf(b)} staff`:''}</small></div><span class="board-badge ${ok.ok?'ready':''}">${ok.ok?'Upgrade ready':b.up?'Upgrading':!b.built?'Building':lvlOf(b)>=3?'Max level':esc(st?.text||'Built')}</span></div>${canGrow?`<div class="upgrade-plan"><b>Level ${lvlOf(b)} → ${lvlOf(b)+1}</b><p>${esc(sim.upgradeEffect(b)||'A sturdier building')}</p><div class="board-cost">${cost(sim.upgradeCost(b),sim.s)}</div>${ok.ok?'':`<p class="board-muted">${esc(ok.why)}</p>`}<button class="btn ${ok.ok?'gold':'ghost'} sm" data-act="board-upgrade" data-bid="${b.id}" ${ok.ok?'':'disabled'}>Upgrade to level ${lvlOf(b)+1}</button></div>`:b.up||!b.built?`<div class="pbar"><i style="width:${Math.round((b.up?.progress||b.progress||0)*100)}%"></i></div><p class="board-muted">${Math.round((b.up?.progress||b.progress||0)*100)}% complete</p>`:'<p class="board-muted">Fully upgraded.</p>'}</article>`;
  }
  return h+'</div>'+(!list.length?'<p class="board-empty">No buildings match these filters.</p>':'');
}
export function worldRegionsHtml(ui,rowExtra) {
  const sim=ui.sim,s=sim.s,active=currentRegion(ui);
  return SETTLEMENTS.map(st=>{const un=s.unlocked[st.id],m=regionSummary(sim,st.id),ok=un||s.level>=st.unlock.lvl&&sim.canAfford(st.unlock.cost);
    return `<article class="region-card ${active===st.id&&un?'active':''}"><div class="board-card-head"><div><b>${esc(sim.sname(st.id))}</b><small>${un&&active===st.id?'Viewing now':un?'Settled':'Unsettled region'}</small></div><button class="btn ${un?'blue':ok?'gold':'ghost'} sm" data-act="${un?'travel':'settle'}" data-sid="${st.id}" ${ok?'':'disabled'}>${un?'Visit region':'Settle region'}</button></div><p>${esc(st.blurb)}</p>${un?`<div class="board-stats"><span>${m.pop}/${m.beds} beds</span><span>${plural(m.jobs,'job')} open</span><span>${plural(m.upgrades,'upgrade')} ready</span></div><p class="board-muted">${Math.floor(sim.trade.get(st.id,'food'))} food stored · crime pressure ${sim.crimePressure(st.id)}/100</p><div class="region-actions">${[['villagers','Villagers'],['jobs','Jobs'],['buildings','Buildings']].map(([k,t])=>`<button class="btn ghost sm" data-act="board-open-region" data-sid="${st.id}" data-panel="${k}">${t}</button>`).join('')}</div>`:`<p class="board-cost">Village level ${st.unlock.lvl} · ${cost(st.unlock.cost,s)}</p>`}${rowExtra(ui,st.id)}</article>`;
  }).join('');
}
export function boardsInit(ui) {
  const style=document.createElement('style'); style.textContent=`
.board-toolbar{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 14px}.board-toolbar label{flex:1;min-width:145px}.board-toolbar select,.board-toolbar input,.job-card select,.resident-job select,.board-filter select{display:block;width:100%;margin-top:5px;box-sizing:border-box}.board-toolbar input{padding:9px 12px;border:1px solid #ceb27d;border-radius:8px;background:#fffaf0;color:var(--ink)}.board-stats{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 16px}.board-stats span,.board-badge{border-radius:9px;background:#efe2be;padding:6px 9px;font-size:12px}.board-badge.ready{background:#dbedc6;color:#335a29}.board-muted,.board-card-head small,.resident-top small{font-size:12px;line-height:1.5;color:var(--ink2)}.board-list{display:grid;gap:12px;margin-top:14px}.resident-card,.job-card,.building-card,.region-card{border:1px solid #d9bf8e;border-radius:12px;padding:14px;background:#fffaf0}.board-card-head,.resident-top{display:flex;gap:12px;align-items:center}.board-card-head>div,.resident-top>div{flex:1;min-width:0}.board-card-head small,.resident-top small{display:block;margin-top:4px}.board-card-head img{width:70px;height:60px;object-fit:contain}.board-name{border:0;background:none;padding:0;text-align:left;color:var(--ink);font:inherit;font-weight:700;cursor:pointer;text-decoration:underline;text-decoration-color:#d1b68c;text-underline-offset:3px}.resident-card p,.job-card p,.region-card p,.upgrade-plan p{font-size:12px;line-height:1.5;margin:8px 0}.resident-job{display:flex;align-items:end;gap:12px}.resident-job label{flex:1;min-width:0}.upgrade-plan{margin-top:12px;padding:12px;background:#f7efd9;border-radius:8px;font-size:13px}.board-cost{font-size:12px;line-height:1.7;margin:8px 0}.board-cost .missing{color:#a83b29;font-weight:700}.job-card select{margin-bottom:8px}.board-empty{text-align:center;padding:24px;font-size:13px;color:var(--ink2)}.board-switch{font-size:13px}.board-switch input{accent-color:#638d3b}.region-card{margin-bottom:12px}.region-card.active{border-color:#6d9a4c;background:#f4f6e5}.region-actions{display:flex;gap:6px;flex-wrap:wrap}#regionQuick{position:fixed;left:12px;bottom:83px;z-index:5;display:flex;gap:6px;align-items:center;background:#fff5db;border:2px solid #caa064;border-radius:12px;padding:6px;box-shadow:0 2px 6px #50361f30}#regionQuick select{max-width:170px;font-size:12px;margin:0}#regionQuick button{font-size:12px;padding:6px}.placing #regionQuick,body.info-open #regionQuick,body:has(#modal:not(.hidden)) #regionQuick{display:none}#pFace{max-width:95px;white-space:normal;font-size:11px}#pFace[aria-pressed=true]{background:#dbedc6;border-color:#6d9a4c}@media(max-width:600px){.board-card-head{flex-wrap:wrap}.board-card-head img{width:54px;height:50px}.board-badge{font-size:11px}.resident-top{align-items:start;flex-wrap:wrap}.resident-top .board-badge{margin-left:56px}.resident-job{flex-wrap:wrap}.resident-job label{flex-basis:100%}#regionQuick{bottom:80px;max-width:calc(100vw - 32px)}.seg button{padding:7px!important;font-size:12px!important}.seg small{display:none}}
`; document.head.appendChild(style);
  const bar=document.createElement('div');bar.id='regionQuick';bar.setAttribute('aria-label','Current region');bar.innerHTML='<select id="regionSelect" aria-label="Visit region"></select><button class="btn ghost sm" aria-label="Region overview">Regions</button>';document.body.appendChild(bar);
  bar.querySelector('select').onchange=e=>{ui.boardSid=e.target.value;ui.townSid=e.target.value;ui.g.flyToSettlement(e.target.value);};
  bar.querySelector('button').onclick=()=>ui.openModal('worldmap');
  const search=e=>{if(e.target.dataset.act!=='board-search')return;(ui.boardQuery||={})[e.target.dataset.kind]=e.target.value;ui.drawModal(true);};
  document.getElementById('modal').addEventListener('input',search);
  const button=document.createElement('button'); button.id='pFace';button.className='btn sm';button.textContent='Face camera';button.setAttribute('aria-label','Face camera');button.dataset.tip='Face camera|The front follows your viewing direction. Rotate switches to manual placement.';button.onclick=()=>ui.g.facePlaceToViewer();document.getElementById('pRot').after(button);
}
export function boardsFrame(ui) {
  const select=document.getElementById('regionSelect');if(!select||select===document.activeElement)return;
  const active=currentRegion(ui),markup=Object.keys(ui.sim.s.unlocked).map(sid=>`<option value="${sid}" ${selected(active,sid)}>${esc(ui.sim.sname(sid))} · ${ui.sim.s.villagers.filter(v=>v.home===sid).length}</option>`).join('');
  if(markup!==ui.regionMarkup){ui.regionMarkup=markup;select.innerHTML=markup;}
}
export function boardChange(ui,e) {
  const t=e.target,act=t.dataset.act;if(!act?.startsWith('board-'))return false;
  if(act==='board-region')ui.boardSid=t.value;
  if(act==='board-people-status')ui.peopleStatus=t.value;
  if(act==='board-class')ui.peopleClass=t.value;
  if(act==='board-building-status')ui.buildingStatus=t.value;
  if(act==='board-open-only')ui.onlyOpen=t.checked;
  if(act==='board-candidate'){(ui.jobPicks||={})[t.dataset.bid]=+t.value;return true;}
  if(act==='board-search')return true;
  ui.drawModal(true);return true;
}
export function boardClick(ui,act,a) {
  if(!act.startsWith('board-'))return false;
  const sim=ui.sim;
  if(act==='board-open-region'){ui.boardSid=a.dataset.sid;ui.openModal(a.dataset.panel);return true;}
  if(act==='board-upgrade'){const b=sim.bById.get(+a.dataset.bid);if(b&&!sim.upgrade(b))ui.toast(sim.canUpgrade(b).why||'This building cannot be upgraded yet.','house');}
  if(act==='board-hire'){
    const b=sim.bById.get(+a.dataset.bid),cands=b?jobCandidates(sim,b):[],pick=ui.jobPicks?.[b?.id],v=pick?cands.find(v=>v.id===pick):cands[0];
    if(!b||!v||!sim.assign(b,v))ui.toast('That candidate or position is no longer available.','person');else{delete ui.jobPicks?.[b.id];ui.toast(`${v.name} assigned to ${sim.homeName(b)}.`,'people');}
  }
  if(act==='board-upgrade'||act==='board-hire')ui.drawModal(true);
  return true;
}
