// Education and homes that grow by themselves.
//
//  - Children earn lesson points at the Schoolhouse. How much they learn depends
//    on their INT and WIS, the teacher (INT, CHA, their own schooling) and the
//    school's level, and whether they've eaten. They graduate with a grade
//    (A, B or C) that sets their education tier for life.
//  - Adults can study at the Library (the Scholar job) and climb the tiers.
//  - The tier speeds up work and opens skilled jobs (wizard, smith, acolyte).
//  - Each home lists what it needs for its next level; when every need is met
//    and auto-upgrade is on, builders upgrade it by themselves.
//
// Sim-side logic is installed onto the Sim instance (installEducation); the
// panel sections at the bottom are called from ui.js.
import { defOf, lvlOf, stageOf, housingOf, isDecor, MAX_LVL, DAY } from './sim.js';
import { JOBS, HOME_TYPES } from './data.js';
import { idx, inMap } from './world.js';
import { svg, addIcons } from './icons.js';
import { maxHp } from './rpg.js';

const mod = sc => Math.floor(((sc ?? 10) - 10) / 2);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tip = (t, d) => `data-tip="${esc(t)}|${esc(d)}"`;

export const UNIVERSITY_POINTS = 180;
export const TIERS = [
  { name: 'Unschooled', work: 1.0, desc: 'Never had lessons. Fine for any common job.' },
  { name: 'Schooled', work: 1.06, desc: 'Can read, write and reckon: +6% work speed, and skilled jobs (wizard, smith, acolyte, scribe) are open.' },
  { name: 'Honours', work: 1.12, desc: "Top of the class: +12% work speed, and the Enchanter's Forge and University professorships are open." },
  { name: 'Scholar', work: 1.2, desc: 'Studied long at the Library: +20% work speed, and adds to the village\'s knowledge.' },
  { name: 'Magister', work: 1.25, desc: 'Graduated from the Arcane University: +25% work speed and trained as a level 2 wizard.' },
];
// lesson points (weighted by attendance) needed for each grade
export const GRADES = [{ g: 'A', min: 170, tier: 2 }, { g: 'B', min: 110, tier: 2 }, { g: 'C', min: 50, tier: 1 }];
// study points at the Library for each tier an adult can reach
const STUDY = [0, 60, 140, 240];
// the least schooling a job needs
// jobs that need schooling. Teachers don't: a new village's first teacher is self-taught (schooled
// teachers just teach better), or nobody could ever start the Schoolhouse.
export const JOB_EDU = { acolyte: 1, wizard: 1, smith: 1, scribe: 1, enchanter: 2, professor: 2, student: 2 };

addIcons({
  cap: '<path d="M2 12l14-6 14 6-14 6z" fill="#4a4a6a" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 15v6c3 3 13 3 16 0v-6" fill="#5b5b7e" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><path d="M27 13v8" stroke="#f0b429" stroke-width="2" stroke-linecap="round"/><circle cx="27" cy="22" r="2" fill="#f0b429"/>',
  book: '<path d="M5 6c4-1 8-1 11 2v19c-3-3-7-3-11-2z" fill="#4f8fd9" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><path d="M27 6c-4-1-8-1-11 2v19c3-3 7-3 11-2z" fill="#6fa8e8" stroke="#5b3a1e" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 11c2-.4 4-.2 5 1M8 15c2-.4 4-.2 5 1M19 12c1-1.2 3-1.4 5-1M19 16c1-1.2 3-1.4 5-1" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round"/>',
  check: '<circle cx="16" cy="16" r="12" fill="#6cc04a" stroke="#3f8a2a" stroke-width="1.6"/><path d="M10 16l4 4 8-9" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  cross: '<circle cx="16" cy="16" r="12" fill="#fbefd2" stroke="#c48a4a" stroke-width="1.6"/><path d="M11 11l10 10M21 11L11 21" stroke="#c0392b" stroke-width="2.6" stroke-linecap="round"/>',
});



export function installEducation(sim) {
  Object.assign(sim, EDU);
  // skilled jobs need schooling; when the game picks someone, it picks someone qualified
  const assign = sim.assign.bind(sim);
  sim.assign = (b, v) => {
    const job = defOf(b.type).job, need = JOB_EDU[job] || 0;
    if (v && need && sim.eduTier(v) < need) {
      sim.emit('toast', `${v.name.split(' ')[0]} needs schooling to work as a ${JOBS[job].name.toLowerCase()}.`, 'cap');
      return false;
    }
    if (!v && need) {
      const c = sim.bCenter(b);
      const ok = sim.s.villagers.filter(o => o.job === 'idle' && stageOf(o) === 'adult' && sim.eduTier(o) >= need);
      if (!ok.length) return false;
      ok.sort((a, o) => (a.home !== b.sid) - (o.home !== b.sid) || sim.eduTier(o) - sim.eduTier(a) || Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(o.x - c.x, o.z - c.z));
      v = ok[0];
    }
    return assign(b, v);
  };
  const unassign = sim.unassign.bind(sim);
  sim.unassign = v => {
    if (v?.job === 'student' && v.work) {
      const b = sim.bById.get(v.work);
      if (b?.data?.students) b.data.students = b.data.students.filter(id => id !== v.id);
    }
    return unassign(v);
  };
  const second = sim.second.bind(sim);
  sim.second = () => { second(); sim.eduSecond(); };
  // old saves: grown-ups who were "educated" count as schooled
  for (const v of sim.s.villagers) if (v.tier === undefined && stageOf(v) !== 'child') v.tier = v.educated ? 1 : 0;
  if (sim.s.autoHomes === undefined) sim.s.autoHomes = true;
}

const EDU = {
  eduTier(v) { return stageOf(v) === 'child' ? 0 : (v.tier ?? (v.educated ? 1 : 0)); },
  eduMult(v) { return TIERS[this.eduTier(v)]?.work ?? 1; },
  canDoJob(v, job) { return this.eduTier(v) >= (JOB_EDU[job] || 0); },
  // A workplace whose job needs schooling stays locked until someone could fill it: a Library stands
  // (where grown-ups study) or someone already has the schooling. Returns why, or null.
  schoolGate(type) {
    const job = type === 'university' ? 'professor' : defOf(type)?.job, need = JOB_EDU[job] || 0;
    if (!need || this.s.buildings.some(b => b.type === 'library' && b.built) || this.s.villagers.some(v => this.eduTier(v) >= need)) return null;
    return 'Needs a Library first, to school its workers';
  },

  // how well a school teaches: its teachers' INT and CHA, their own schooling, the school's level
  teachQuality(school) {
    const ts = school.workers.map(id => this.vById.get(id)).filter(v => v && !v.quest && !(v.ko > 0) && !(v.jail > this.s.time) && !v.asleep);
    if (!ts.length) return 0;
    const q = ts.reduce((a, t) => a + 1 + 0.12 * mod(t.abil?.int) + 0.06 * mod(t.abil?.cha) + 0.1 * this.eduTier(t), 0) / ts.length;
    return Math.max(0.6, Math.min(2, q * (1 + (lvlOf(school) - 1) * 0.2) * (this.policyOn?.('freeSchool') ? 1.15 : 1)));
  },
  sch(v) { return v.sch || (v.sch = { pts: v.edu || 0, days: 0, att: 0, lastDay: -1 }); },
  // one lesson at school
  learn(v, school) {
    const sc = this.sch(v), day = Math.floor(this.s.time / DAY);
    const mult = this.teachQuality(school) * (1 + 0.08 * mod(v.abil?.int) + 0.04 * mod(v.abil?.wis)) * (v.hungry ? 0.6 : 1);
    sc.pts += 8 * mult;
    if (sc.lastDay !== day) { sc.lastDay = day; sc.att++; }
    v.edu = sc.pts;
  },
  attendance(v) { const sc = this.sch(v); return sc.days ? Math.min(1, sc.att / sc.days) : 1; },
  score(v) { const sc = this.sch(v); return sc.pts * (0.6 + 0.4 * this.attendance(v)); },
  gradeFor(score) { return GRADES.find(g => score >= g.min) || null; },
  graduate(v) {
    const g = v.sch ? this.gradeFor(this.score(v)) : null;
    v.grade = g ? g.g : null;
    v.tier = g ? g.tier : 0;
    v.educated = v.tier >= 1;
    if (g) this.log(`${v.name} graduated with a ${g.g}${g.g === 'A' ? ' — top of the class!' : '.'}`);
  },

  // adults studying at the Library (the Scholar job)
  taskLibrary(v, b) {
    const p = this.spot(b, v.id % 3), c = this.bCenter(b);
    this.setTask(v, 'Studying', [{ walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] }, { act: 12, anim: 'work', done: () => {
      v.study = (v.study || 0) + 5 * (1 + 0.1 * mod(v.abil?.int) + 0.05 * mod(v.abil?.wis)) * (1 + (lvlOf(b) - 1) * 0.2) * this.workRate(v, b) / this.eduMult(v);
      const reach = STUDY.findLastIndex(n => v.study >= n);
      if (reach > this.eduTier(v)) {
        v.tier = reach; v.educated = true;
        this.story('study', `${v.name} studied hard at the Library and is now ${TIERS[reach].name === 'Scholar' ? 'a Scholar' : TIERS[reach].name.toLowerCase()}.`, [v], 'cap');
        this.log(`${v.name} reached ${TIERS[reach].name} at the Library.`);
      }
      if (this.s.rpg) this.s.rpg.know = (this.s.rpg.know || 0) + 0.4 * (1 + 0.1 * mod(v.abil?.int));
      this.repeat(v);
    } }]);
  },
  studyNext(v) { const t = this.eduTier(v); return t >= 3 ? null : { tier: t + 1, need: STUDY[t + 1], have: v.study || 0 }; },

  // Honours young adults enrol separately from the university's staff slots.
  universityEligible(v) {
    return v && stageOf(v) === 'adult' && v.age <= 35 && this.eduTier(v) >= 2 && this.eduTier(v) < 4
      && !v.quest && !(v.ko > 0) && !(v.jail > this.s.time);
  },
  universityStudents(b) {
    return (b.data?.students || []).map(id => this.vById.get(id)).filter(v => v && v.job === 'student' && v.work === b.id);
  },
  enrol(v, b) {
    if (b?.type !== 'university' || !b.built || !this.universityEligible(v) || v.job === 'student'
      || v.job === 'professor' && v.work === b.id
      || this.universityStudents(b).length >= 4 + (lvlOf(b) - 1) * 2) return false;
    this.unassign(v); v.job = 'student'; v.work = b.id;
    (b.data ||= {}).students ||= []; b.data.students.push(v.id);
    v.university = v.university || 0; this.trainFor(v, 'student'); this.dropTask(v);
    this.emit('villagerJob', v); this.log(`${v.name} enrolled at the Arcane University.`); return true;
  },
  taskUniversity(v, b) {
    const p = this.spot(b, v.id % 4), c = this.bCenter(b);
    this.setTask(v, v.job === 'professor' ? 'Teaching arcane studies' : 'Studying arcane arts', [
      { walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [c.x, c.z] },
      { act: 12, anim: 'work', done: () => {
        if (!this.bById.has(b.id) || v.work !== b.id) return;
        const teachers = b.workers.map(id => this.vById.get(id)).filter(t => t && t.job === 'professor' && !t.quest && !(t.ko > 0) && !(t.jail > this.s.time) && !t.asleep);
        if (v.job === 'student') {
          if (!teachers.length) b.status = 'Needs a professor';
          else {
            const quality = this.teachQuality(b);
            v.university = (v.university || 0) + 6 * quality * (1 + 0.06 * mod(v.abil?.int)) * (v.hungry ? 0.6 : 1);
            this.rpg().know += 0.5; b.status = null;
            if (v.university >= UNIVERSITY_POINTS) {
              this.unassign(v); v.tier = 4; v.educated = true; v.cls = 'wizard'; v.lvl = Math.max(2, v.lvl || 1); v.hp = maxHp(v);
              this.story('study', `${v.name} graduated from the Arcane University as a Magister.`, [v], 'cap');
              this.log(`${v.name} became a Magister and a level 2 wizard.`); this.socSecond(); return;
            }
          }
        } else { this.rpg().know += 0.3; b.status = teachers.length ? null : 'Needs a professor'; }
        this.repeat(v);
      } },
    ]);
  },

  // ── homes ──
  homeResidents(b) { return this.s.villagers.filter(v => this.bedFor(v).b === b); },
  near(b, types, r) {
    const c = this.bCenter(b);
    return this.s.buildings.some(o => o !== b && o.built && types.includes(o.type) && Math.hypot(this.bCenter(o).x - c.x, this.bCenter(o).z - c.z) <= r);
  },
  nearDecor(b, r) {
    const c = this.bCenter(b);
    return this.s.buildings.some(o => o.built && isDecor(o.type) && Math.hypot(this.bCenter(o).x - c.x, this.bCenter(o).z - c.z) <= r);
  },
  nearRoad(b) {
    const W = this.world, [ex, ez] = this.entryTile(b);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const x = ex + dx, z = ez + dz;
      if (inMap(x, z) && (W.road[idx(x, z)] || W.paved[idx(x, z)])) return true;
    }
    return false;
  },
  // what a home needs for its next level (null when it can't grow further)
  homeNeeds(b) {
    if (!HOME_TYPES.includes(b.type) || !b.built) return null;
    const L = lvlOf(b);
    if (L >= MAX_LVL) return { lvl: L, items: [], done: true };
    const res = this.homeResidents(b), adults = res.filter(v => stageOf(v) !== 'child');
    const tiers = adults.map(v => this.eduTier(v)), joy = this.s.happiness;
    const items = [
      { id: 'fed', ok: res.length > 0 && !res.some(v => v.hungry), label: 'Everyone fed', tip: 'Nobody living here is hungry. Keep food flowing from foragers, farms and bakeries.' },
      { id: 'water', ok: this.near(b, ['well', 'fountain'], 9), label: 'A well nearby', tip: 'A Well (or the Wishing Fountain) within 9 tiles.' },
      { id: 'decor', ok: this.nearDecor(b, 4), label: 'Something pretty', tip: 'Any decoration within 4 tiles: flowers, a bench, a lantern…' },
      { id: 'school', ok: tiers.some(t => t >= 1), label: 'A schooled grown-up', tip: 'At least one grown-up here went to school (grade C or better) or studied at the Library.' },
      { id: 'joy', ok: joy >= (L === 1 ? 55 : 70), label: `Village ${L === 1 ? 55 : 70}% happy`, tip: 'Decorations, festivals, the tavern, good food and friendships all lift happiness.' },
    ];
    if (L === 2) items.push(
      { id: 'market', ok: this.near(b, ['market', 'tavern'], 12), label: 'Market or tavern nearby', tip: 'A Market Stall or Tavern within 12 tiles.' },
      { id: 'honours', ok: tiers.some(t => t >= 2) && tiers.filter(t => t >= 1).length * 2 >= tiers.length, label: 'Well-educated household', tip: 'Most grown-ups here are schooled, and at least one graduated with honours (A or B) or studied at the Library.' },
      { id: 'road', ok: this.nearRoad(b), label: 'On a road', tip: 'A road or cobbles within 2 tiles of the door.' });
    const lvlNeed = this.upgradeLevelReq(b);
    if (this.s.level < lvlNeed) items.push({ id: 'lvl', ok: false, label: `Village level ${lvlNeed}`, tip: 'Homes grow as the village does.' });
    return { lvl: L + 1, items, done: false, met: items.filter(i => i.ok).length };
  },
  eduSecond() {
    const s = this.s, day = Math.floor(s.time / DAY);
    for (const b of s.buildings) if (b.type === 'university' && b.data?.students) b.data.students = this.universityStudents(b).map(v => v.id);
    for (const v of s.villagers) if (v.job === 'student' && (!this.bById.has(v.work) || stageOf(v) !== 'adult')) this.unassign(v);
    // count school days for every school-age child who has a staffed school at home
    if (s.eduDay !== day) {
      s.eduDay = day;
      for (const v of s.villagers) if (stageOf(v) === 'child' && v.age >= 5 && s.buildings.some(b => b.type === 'school' && b.built && b.workers.length && b.sid === v.home)) this.sch(v).days++;
    }
    // homes grow by themselves when every need is met
    if ((this.eduT = (this.eduT || 0) + 1) % 5 || s.autoHomes === false) return;
    for (const b of s.buildings) {
      if (!HOME_TYPES.includes(b.type) || b.autoUp === false || b.up) continue;
      const n = this.homeNeeds(b);
      if (!n || n.done || n.met < n.items.length) continue;
      if (this.canUpgrade(b).ok && this.upgrade(b)) {
        this.emit('toast', `A home in ${this.sname(b.sid)} is growing to level ${n.lvl}!`, 'house');
        this.log(`A ${defOf(b.type).name.toLowerCase()} in ${this.sname(b.sid)} began growing to level ${n.lvl} by itself.`);
      }
    }
  },
};

// ── panel sections (called from ui.js) ──
const gradeChip = g => `<span class="grade g${g}">${g}</span>`;
export function eduVillagerHtml(ui, v) {
  const sim = ui.sim, st = stageOf(v);
  if (st === 'child') {
    if (v.age < 5) return `<div class="ip-sec"><div class="cap">${svg('cap', 14)} Schooling</div><div class="desc">Too little for school yet — starts at 5.</div></div>`;
    const sc = sim.sch(v), score = sim.score(v), g = sim.gradeFor(score), next = [...GRADES].reverse().find(x => x.min > score);
    const att = Math.round(sim.attendance(v) * 100), pct = Math.min(1, score / GRADES[0].min);
    return `<div class="ip-sec"><div class="cap">${svg('cap', 14)} Schooling<span class="r" ${tip('Report card', 'Lesson points, weighted by attendance. Grades: A 170+, B 110+, C 50+. Learning goes faster with a sharp teacher, a bigger school, and a fed, clever pupil.')}>On track for ${g ? gradeChip(g.g) : '<i>no grade yet</i>'}</span></div>
      <div class="pbar"><i style="width:${Math.round(pct * 100)}%"></i></div>
      <dl class="kv"><dt>Lessons</dt><dd>${Math.round(sc.pts)} points</dd><dt>Attendance</dt><dd>${att}% (${sc.att}/${Math.max(sc.att, sc.days)} days)</dd>${next ? `<dt>Next grade</dt><dd>${next.g} at ${next.min}</dd>` : ''}</dl></div>`;
  }
  const t = sim.eduTier(v), nx = st === 'adult' ? sim.studyNext(v) : null;
  return `<div class="ip-sec"><div class="cap">${svg('cap', 14)} Education<span class="r" ${tip(TIERS[t].name, TIERS[t].desc)}>${v.grade ? gradeChip(v.grade) + ' ' : ''}${TIERS[t].name}</span></div>
    <div class="desc">${esc(TIERS[t].desc)}${t === 0 && st === 'adult' ? ' Send them to the Library (Scholar job) to catch up.' : ''}</div>
    ${v.job === 'student' ? `<div class="pbar"><i style="width:${Math.min(100, (v.university || 0) / UNIVERSITY_POINTS * 100)}%"></i></div><div class="sub">Arcane studies: ${Math.floor(v.university || 0)}/${UNIVERSITY_POINTS} toward Magister</div>` : ''}
    ${v.job === 'scholar' && nx ? `<div class="pbar" style="margin-top:6px"><i style="width:${Math.round(Math.min(1, nx.have / nx.need) * 100)}%"></i></div><div class="sub">Studying toward ${TIERS[nx.tier].name}: ${Math.floor(nx.have)}/${nx.need}</div>` : ''}</div>`;
}

export function eduBuildingHtml(ui, b) {
  const sim = ui.sim, s = sim.s;
  if (!b.built) return '';
  if (HOME_TYPES.includes(b.type)) {
    const n = sim.homeNeeds(b);
    if (!n) return '';
    const res = sim.homeResidents(b).filter(v => stageOf(v) !== 'child');
    const edu = res.length ? `<div class="sub" style="margin:4px 0 6px">Grown-ups: ${res.map(v => `${esc(v.name.split(' ')[0])} ${v.grade ? gradeChip(v.grade) : ''}<small>${TIERS[sim.eduTier(v)].name}</small>`).join(' · ')}</div>` : '';
    if (n.done) return `<div class="ip-sec"><div class="cap">${svg('house', 14)} Home<span class="r">Fully grown</span></div>${edu}</div>`;
    const auto = s.autoHomes !== false && b.autoUp !== false;
    return `<div class="ip-sec"><div class="cap">${svg('house', 14)} Growing to level ${n.lvl}<span class="r">${n.met}/${n.items.length}</span></div>
      <div class="pbar"><i style="width:${Math.round(n.met / n.items.length * 100)}%"></i></div>${edu}
      <ul class="needs">${n.items.map(i => `<li class="${i.ok ? 'ok' : ''}" ${tip(i.label, i.tip)}>${svg(i.ok ? 'check' : 'cross', 15)}${esc(i.label)}</li>`).join('')}</ul>
      <div class="autorow"><button class="tog ${auto ? 'on' : ''}" data-act="edu-auto" ${tip('Grow by itself', 'When every need is met and you can afford the upgrade, builders upgrade this home without being asked.')}>${svg('star', 14)} Grow by itself</button>
      <button class="tog ${s.autoHomes !== false ? 'on' : ''}" data-act="edu-autoall" ${tip('All homes', 'Turn automatic growing on or off for every home at once.')}>All homes</button></div></div>`;
  }
  if (b.type === 'school') {
    const q = sim.teachQuality(b), kids = s.villagers.filter(v => stageOf(v) === 'child' && v.age >= 5 && v.home === b.sid);
    return `<div class="ip-sec"><div class="cap">${svg('cap', 14)} Classroom<span class="r" ${tip('Teaching quality', 'From the teacher\'s Intelligence and Charisma, their own schooling, and the school\'s level. Pupils learn this much faster.')}>Teaching ×${q.toFixed(2)}</span></div>
      ${kids.length ? `<div class="pupils">${kids.map(v => { const g = sim.gradeFor(sim.score(v)); return `<button class="pupil" data-act="selv" data-id="${v.id}" ${tip(v.name, `${Math.round(sim.sch(v).pts)} lesson points · ${Math.round(sim.attendance(v) * 100)}% attendance`)}>${esc(v.name.split(' ')[0])} ${g ? gradeChip(g.g) : '<small>—</small>'}</button>`; }).join('')}</div>` : '<div class="desc">No pupils yet — children start school at 5.</div>'}</div>`;
  }
  if (b.type === 'library') {
    const ws = b.workers.map(id => sim.vById.get(id)).filter(Boolean);
    return `<div class="ip-sec"><div class="cap">${svg('book', 14)} Reading room</div>${ws.length ? ws.map(v => { const nx = sim.studyNext(v); return `<div class="studyrow"><b>${esc(v.name.split(' ')[0])}</b> <small>${TIERS[sim.eduTier(v)].name}</small>${nx ? `<div class="pbar"><i style="width:${Math.round(Math.min(1, nx.have / nx.need) * 100)}%"></i></div><small>${Math.floor(nx.have)}/${nx.need} toward ${TIERS[nx.tier].name}</small>` : '<small> · studying for the joy of it (adds knowledge)</small>'}</div>`; }).join('') : '<div class="desc">Give grown-ups the Scholar job here to study toward Schooled, Honours and Scholar.</div>'}</div>`;
  }
  return '';
}

export function eduClick(ui, act, b) {
  const s = ui.sim.s;
  if (act === 'edu-auto' && b) b.autoUp = b.autoUp === false ? true : false;
  if (act === 'edu-autoall') s.autoHomes = s.autoHomes === false;
}
