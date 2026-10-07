// Hardship: what makes a village's survival matter. Set with the Town panel's "Hard times" setting.
//   Off      no hard times, and nobody ever leaves.
//   Gentle,  a grown-up who goes hungry, sleeps by the fire in winter, freezes in the pass or lives in a
//   Normal   miserable village for a whole day starts thinking of leaving (a bag over their head). Put it
//            right within another day and they stay; otherwise they pack up and walk out the gate, and
//            their young children go with them if no parent is left.
//   Harsh    the above, plus: a day without food makes people sick and two can kill; a winter night by
//            the fire chills them sick; sickness can take the old, the young and the starving; anyone
//            knocked out makes death saving throws (a cleric or paladin nearby steadies them); and when
//            the last villager is gone the village has fallen.
// The removals themselves go through Sim.passAway (sim.js), which knows the causes and the leavers.
import { DAY, stageOf } from './sim.js';
import { classOf } from './rpg.js';
import { svg } from './icons.js';

const CHECK = 5;                  // seconds between grievance checks
const first = v => v.name.split(' ')[0];
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const hardMode = s => s.events?.mode || 'normal';
export const leavingOn = s => hardMode(s) !== 'off';
export const harshOn = s => hardMode(s) === 'harsh';

export function installHardship(sim) {
  const s = sim.s, W = sim.world;
  // (read here, not at the top: sim.js is still loading when this module is first evaluated)
  const NOTICE = DAY;   // a day of hardship before someone thinks of leaving
  const GRACE = DAY;    // ...and another day to put it right before they go
  // villages from before this existed: say once what changed
  if (!s.hardshipSeen) { s.hardshipSeen = true; if (s.time > DAY && leavingOn(s)) sim.log('Villagers who stay hungry, cold or miserable for a whole day may now pack up and leave. (Settings → Hard times)'); }
  const winter = () => sim.seasonIdx() === 3;
  const noBed = v => sim.bedFor(v)?.b?.type === 'campfire';
  // what is wrong for this villager right now, if anything (the worst first)
  sim.grievance = v => {
    if (v.hungry) return { k: 'hunger', t: 'hungry', go: 'tired of going hungry' };
    if (v.cold > s.time) return { k: 'cold', t: 'freezing', go: 'to get out of the cold' };
    if (winter() && noBed(v)) return { k: 'bed', t: 'no bed for the winter', go: 'to find a warm bed for the winter' };
    if (s.happiness < 25) return { k: 'misery', t: 'unhappy here', go: 'to look for a happier village' };
    return null;
  };
  const awayOrBusy = v => v.quest || v.jail > s.time || v.departing;

  // ── once every CHECK seconds: grievances, leaving, and in Harsh the dangers ──
  let tick = 0;
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    if (harshOn(s)) sim.deathSaves();
    if (++tick % CHECK) return;
    const day = sim.dayNum(), worried = [];
    if (leavingOn(s) && day >= 2) {
      for (const v of [...s.villagers]) {
        if (stageOf(v) === 'child' || awayOrBusy(v)) continue;
        const g = sim.grievance(v);
        v.grief = g ? Math.min(NOTICE * 2, (v.grief || 0) + CHECK) : Math.max(0, (v.grief || 0) - CHECK * 2);
        if (g && !v.leaving && v.grief >= NOTICE) { v.leaving = { why: g.t, go: g.go, at: s.time + GRACE }; worried.push(v); }
        else if (v.leaving && !g && v.grief < NOTICE / 2) {
          v.leaving = null; sim.log(`${v.name} decided to stay after all.`);
        } else if (v.leaving && g) { v.leaving.why = g.t; v.leaving.go = g.go; }
        if (v.leaving && s.time >= v.leaving.at) sim.setOff(v);
      }
      if (worried.length) {
        const why = worried[0].leaving.why;
        sim.emit('toast', worried.length === 1 ? `${first(worried[0])} is thinking of leaving (${why}). Put it right within a day.` : `${worried.length} villagers are thinking of leaving (${why}…). Put it right within a day.`, 'bag');
        for (const v of worried) sim.log(`${v.name} is thinking of leaving: ${v.leaving.why}.`);
      }
    }
    if (harshOn(s)) sim.harshCheck();
    if (harshOn(s) && !s.villagers.length && !s.fallen) sim.fall();
  };
  // leaving everyone off the hook when hard times are switched off
  sim.calmHardship = () => { for (const v of s.villagers) { v.grief = 0; if (!v.departing) v.leaving = null; } };

  // ── walking out of the village ──
  sim.setOff = v => {
    if (v.departing) return;
    v.departing = s.time;
    sim.unassign(v); sim.dropTask(v); v.thinkCd = 0;
    // a partner who's also had enough goes too
    const p = v.partner && sim.vById.get(v.partner);
    if (p?.leaving && !p.departing) sim.setOff(p);
  };
  sim.departNow = v => {
    if (!sim.vById.has(v.id)) return;
    const why = v.leaving?.go;
    // young children go with the family if nobody who raises them is staying
    const kids = (v.kids || []).map(id => sim.vById.get(id)).filter(k => k && stageOf(k) === 'child'
      && !(k.parents || []).some(pid => pid !== v.id && sim.vById.get(pid) && !sim.vById.get(pid).departing));
    sim.passAway(v, { left: true, why });
    for (const k of kids) sim.passAway(k, { left: true, why: `with ${first(v)}` });
  };
  const think = sim.think.bind(sim);
  sim.think = v => {
    if (!v.departing) return think(v);
    // can't find the way out for half a day (an island, a blocked road): they've gone anyway
    if (s.time - v.departing > DAY / 2) return sim.departNow(v);
    sim.setTask(v, 'Leaving the village', [{ walk: { tx: W.entry.x, tz: W.entry.z } }, { fn: () => sim.departNow(v) }]);
  };

  // ── Harsh: hunger, cold and sickness ──
  sim.harshCheck = () => {
    const now = s.time;
    for (const v of [...s.villagers]) {
      if (v.quest?.phase === 'away') continue;
      const st = stageOf(v), frail = st !== 'adult';
      v.starve = v.hungry ? (v.starve || 0) + CHECK : 0;
      const chilly = (winter() && v.asleep === 'fire') || v.cold > now;
      v.chill = chilly ? (v.chill || 0) + CHECK : Math.max(0, (v.chill || 0) - CHECK);
      if (v.starve >= DAY) v.sick = Math.max(v.sick || 0, now + 30);
      if (v.chill >= 120) v.sick = Math.max(v.sick || 0, now + 120);
      v.sickT = v.sick > now ? (v.sickT || 0) + CHECK : 0;
      let risk = 0, cause = 'illness';
      if (v.starve >= DAY * 1.5) { risk = CHECK / (frail ? 150 : 300); cause = 'hunger'; }
      else if (v.sickT >= 60 && frail) { risk = CHECK / (st === 'elder' ? 600 : 900); cause = v.chill ? 'cold' : 'illness'; }
      else if (v.sickT >= DAY) { risk = CHECK / 1500; cause = v.chill ? 'cold' : 'illness'; }
      if (risk && sim.rng() < risk) sim.passAway(v, { cause });
    }
  };

  // ── Harsh: death saving throws for anyone knocked out ──
  const hurt = sim.rpgHurt.bind(sim);
  sim.rpgHurt = (v, n, by) => {
    hurt(v, n, by);
    if (harshOn(s) && v.hp <= 0 && !v.dying && sim.vById.has(v.id)) { v.dying = { s: 0, f: 0, by, t: s.time }; sim.emit('toast', `${first(v)} is down and dying! A cleric or paladin nearby can steady them.`, 'alert'); }
  };
  sim.deathSaves = () => {
    for (const v of [...s.villagers]) {
      const d = v.dying; if (!d) continue;
      v.hp = 0; v.ko = Math.max(v.ko || 0, 1);   // no mending or getting up until the saves are settled
      // Spare the Dying: a cleric or paladin on their feet within reach steadies them at once
      const help = s.villagers.find(o => o !== v && !o.dying && !(o.ko > 0) && ['cleric', 'paladin'].includes(classOf(o)) && Math.hypot(o.x - v.x, o.z - v.z) < 8);
      if (help) { v.dying = null; sim.log(`${help.name} knelt by ${v.name} and steadied them.`); continue; }
      if ((s.time - d.t) % 2 >= 1) continue;   // a save every two seconds
      const r = 1 + ((sim.rng() * 20) | 0);
      if (r === 20) { v.dying = null; v.hp = 1; v.ko = 0; sim.log(`${v.name} gasped and came round!`); continue; }
      if (r >= 10) d.s++; else d.f += r === 1 ? 2 : 1;
      if (d.s >= 3) { v.dying = null; sim.log(`${v.name} is badly hurt, but stable.`); }
      else if (d.f >= 3) sim.passAway(v, { cause: 'wounds' });
    }
  };

  // ── Harsh: the village falls when nobody is left ──
  sim.fall = () => {
    const st = s.stats;
    s.fallen = { day: sim.dayNum() + 1, peak: st.peakPop || 0, births: st.births || 0, deaths: st.deaths || 0, left: st.left || 0, built: s.buildings.filter(b => b.built).length };
    s.popTimer = -1e9;   // no newcomers to a fallen village
    sim.log('The last villager is gone. The village has fallen.');
    sim.emit('fallen');
  };
  // remember the biggest the village ever got, for the fallen village's epitaph
  const life = sim.lifeCycle.bind(sim);
  sim.lifeCycle = () => { life(); s.stats.peakPop = Math.max(s.stats.peakPop || 0, s.villagers.length); };
}

// ── UI bits ──
// the villager panel's warning line
export function hardshipNoteHtml(sim, v) {
  if (v.dying) return `<div class="note bad">${svg('alert', 13)} Dying: ${v.dying.s} of 3 good saves, ${v.dying.f} of 3 bad. A cleric or paladin nearby can steady them.</div>`;
  if (v.departing) return `<div class="note bad">${svg('bag', 13)} Leaving the village.</div>`;
  if (v.leaving) {
    const left = Math.max(0, v.leaving.at - sim.s.time), h = Math.ceil(left / DAY * 24);
    return `<div class="note bad">${svg('bag', 13)} Thinking of leaving: ${esc(v.leaving.why)}. Leaves in about ${h} hour${h === 1 ? '' : 's'} unless that's put right.</div>`;
  }
  return '';
}
// the "Hard times" setting
export const HARD_MODES = [
  ['off', 'Off', 'No hard times, and nobody ever leaves.'],
  ['gentle', 'Gentle', 'Now and then a drought, fever or raid. Villagers who go hungry, have no bed in winter or are miserable for a whole day start thinking of leaving, and go a day later if it isn\'t put right.'],
  ['normal', 'Normal', 'Hard times come more often. Villagers who go hungry, have no bed in winter or are miserable for a whole day start thinking of leaving, and go a day later if it isn\'t put right.'],
  ['harsh', 'Harsh', 'The most hard times, and they can kill: hunger, cold and fever can take the weak, anyone knocked out makes death saving throws, and when the last villager is gone the village falls.'],
];
// the fallen village's epitaph
export function fallenHtml(ui) {
  const s = ui.sim.s, F = s.fallen; if (!F) return '';
  const row = (icon, t) => `<span>${svg(icon, 15)}${t}</span>`;
  return `<div class="chron"><h3>${esc(ui.sim.sname('meadow'))} has fallen</h3>
    <p class="sub" style="text-align:center">The last villager is gone. The village lasted ${F.day} day${F.day === 1 ? '' : 's'}.</p>
    <div class="nums">${row('people', `${F.peak} at its biggest`)}${row('baby', `${F.births} born`)}${row('flower', `${F.deaths} laid to rest`)}${row('bag', `${F.left} left`)}${row('hammer', `${F.built} buildings`)}</div>
    <div class="autorow"><button class="btn gold" data-act="ev-restart">${svg('house', 15)} Start again on this map</button><button class="btn" data-act="ev-watch">Stay and look around</button></div></div>`;
}
