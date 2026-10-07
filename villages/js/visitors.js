// Visitors at the gate. Once a day or so, someone walks up the road to the campfire
// and asks something of the village: a family fleeing a flood who need a home, a
// wandering bard who will sing tonight, a travelling scholar who will teach, or a
// hooded stranger who won't give a name. Each is one choice, Welcome or Turn away,
// shown in the banner under the resource bar. Nobody is hurt by a "no"; they thank
// you and walk on. Drawn by lifeview.js; answered from lifeui.js.
import { stageOf, DAY } from './sim.js';
import { idx, toWorld, toTile, tileX, tileZ, inMap } from './world.js';
import { pickRace, pickGender, firstNameFor, lastNameFor, lookFor } from './society.js';
import { SHIRTS } from './data.js';
import { maxHp } from './rpg.js';
import { mainSid } from './celebrations.js';
import { pick } from './rng.js';
import { addIcons } from './icons.js';

addIcons({
  gate: '<path d="M5 28V10l11-6 11 6v18" fill="#f3e2bd" stroke="#5b3a1e" stroke-width="1.8" stroke-linejoin="round"/><path d="M11 28V16h10v12" fill="#a8743f" stroke="#5b3a1e" stroke-width="1.6"/><circle cx="18.5" cy="22" r="1" fill="#5b3a1e"/>',
  lute: '<ellipse cx="13" cy="20" rx="7" ry="8" fill="#c98a4a" stroke="#5b3a1e" stroke-width="1.6"/><circle cx="13" cy="20" r="2.2" fill="#5b3a1e"/><path d="M17 14l9-9" stroke="#5b3a1e" stroke-width="3" stroke-linecap="round"/><path d="M24 4l3 3" stroke="#8a5a2b" stroke-width="2.4" stroke-linecap="round"/>',
  hood: '<path d="M16 3c-7 0-10 7-10 13v12h20V16c0-6-3-13-10-13z" fill="#4a4458" stroke="#2a2433" stroke-width="1.6"/><ellipse cx="16" cy="16" rx="5" ry="6" fill="#1f1a28"/><circle cx="14" cy="16" r="1" fill="#ffd54f"/><circle cx="18" cy="16" r="1" fill="#ffd54f"/>',
});

const first = n => n.split(' ')[0];
export const BARD_FEE = 20, SCHOLAR_FEE = 40;
const CAUSES = ['a flood that took their mill', 'a fire in their village', 'a hard winter in the hills', 'goblins on the north road', 'a landslide that buried their farm', 'a drought that dried their well'];
export const VISITORS = {
  family: { name: 'A family at the gate', short: 'At the gate', icon: 'people', w: 3,
    ask: c => `The ${c.last} family, ${c.n} of them, fled ${c.cause}. They ask for a home.`,
    brief: c => `The ${c.last} family (${c.n}) need a home`,
    yes: 'Welcome', no: 'Turn away',
    tip: c => `${c.n} new villagers (${c.members.filter(m => m.age < 16).length ? 'with children' : 'grown-ups'}). They sleep by the fire until there are beds.` },
  bard: { name: 'A wandering bard', short: 'A bard', icon: 'lute', w: 2, fee: BARD_FEE,
    ask: c => `${c.name}, a wandering bard, offers to sing at the campfire tonight for ${BARD_FEE} coins.`,
    brief: c => `${first(c.name)} will sing at the campfire tonight`,
    yes: `Hire · ${BARD_FEE}`, no: 'No thanks',
    tip: () => 'Everyone is happier for the evening, and tempers cool.' },
  scholar: { name: 'A travelling scholar', short: 'A scholar', icon: 'book', w: 2, fee: SCHOLAR_FEE,
    ask: c => `${c.name}, a travelling scholar, offers a day of lessons for ${SCHOLAR_FEE} coins.`,
    brief: c => `${first(c.name)} offers a day of lessons`,
    yes: `Hire · ${SCHOLAR_FEE}`, no: 'No thanks',
    tip: () => '+30 knowledge (better recipes at the forge), and the studious get a head start.' },
  stranger: { name: 'A hooded stranger', short: 'A stranger', icon: 'hood', w: 2, minPop: 6,
    ask: () => 'A hooded stranger asks for a place by the fire. They won\'t give a name.',
    brief: () => 'They ask for a place by the fire',
    yes: 'Let them stay', no: 'No',
    tip: () => 'Who knows? Maybe a hero in hiding. Maybe trouble.' },
};

export function installVisitors(sim) {
  const s = sim.s;
  s.visitors ||= { day: sim.dayNum(), cur: null, last: null, n: 0, id: 0 };
  Object.assign(sim, VIS);
  const second = sim.second.bind(sim);
  sim.second = () => { second(); if (((s.time | 0) % 2) === 0) sim.visitSecond(); };
}

const VIS = {
  visitor() { return this.s.visitors.cur; },
  // where the visitor is now: walking up the road, waiting by the fire, or walking away
  visitorPos(c = this.s.visitors.cur) {
    if (!c?.path?.length) return null;
    const speed = 2.2, n = c.path.length - 1;
    let d = (this.s.time - c.made) * speed;
    if (c.leaving) d = Math.max(0, n - (this.s.time - c.leaving) * speed);
    const k = Math.max(0, Math.min(n, d)), i = Math.floor(k), f = k - i, a = c.path[i], b = c.path[Math.min(n, i + 1)];
    return { x: toWorld(tileX(a)) + (toWorld(tileX(b)) - toWorld(tileX(a))) * f, z: toWorld(tileZ(a)) + (toWorld(tileZ(b)) - toWorld(tileZ(a))) * f,
      moving: c.leaving ? d > 0 : d < n, dir: c.leaving ? -1 : 1, arrived: !c.leaving && d >= n };
  },
  makeVisitor(kind) {
    const s = this.s, V = s.visitors, sid = mainSid(this), r = this.rng;
    const fire = s.buildings.find(b => b.type === 'campfire' && b.sid === sid);
    const W = this.world, e = W.entry;
    if (!fire || !inMap(e.x, e.z)) return null;
    const path = W.findPath(idx(e.x, e.z), fire.tx, fire.tz, this.adjGoal(fire), 6000);
    if (!path?.length) return null;
    const race = pickRace(r), gender = pickGender(r), last = lastNameFor(race, r);
    const person = (age, g = pickGender(r)) => ({ age, gender: g, name: `${firstNameFor(race, g, r)} ${last}`, look: { ...lookFor(race, r), shirt: pick(r, SHIRTS), hat: age >= 16 && r() < 0.4 } });
    const c = { id: ++V.id, kind, sid, made: s.time, until: s.time + DAY * 0.3, path: [idx(e.x, e.z), ...path], race, last };
    if (kind === 'family') {
      const n = 2 + Math.floor(r() * 3), adults = [person(24 + r() * 16, 'f'), person(24 + r() * 16, 'm')];
      if (r() < 0.3) adults[1] = person(24 + r() * 16, adults[0].gender);
      const kids = Array.from({ length: n - 2 }, () => person(3 + r() * 10));
      c.n = n; c.cause = pick(r, CAUSES); c.members = [...adults, ...kids];
    } else {
      const p = person(26 + r() * 30, gender); c.name = p.name; c.members = [p];
      if (kind === 'bard') p.look.shirt = 0x8a3fa8;
      if (kind === 'scholar') { p.look.shirt = 0x2f4f8f; p.look.hat = false; }
      if (kind === 'stranger') { p.look.shirt = 0x3a3442; p.look.hat = true; p.look.hatColor = 0x2a2433; c.secret = r() < 0.6 ? 'hero' : 'shady'; }
    }
    V.cur = c; V.last = kind;
    this.log(`${VISITORS[kind].name} is walking up the road to ${this.sname(sid)}.`);
    this.emit('visitor', c);
    this.emit('sfx', 'pop');
    return c;
  },
  // the player's answer
  answerVisitor(yes) {
    const s = this.s, V = s.visitors, c = V.cur;
    if (!c || c.answered) return { ok: false, why: 'Nobody is waiting' };
    const D = VISITORS[c.kind];
    if (yes && D.fee && s.res.coins < D.fee) return { ok: false, why: `Needs ${D.fee} coins` };
    c.answered = yes ? 'yes' : 'no'; V.n++;
    const where = this.sname(c.sid), pos = this.visitorPos(c) || { x: toWorld(this.world.entry.x), z: toWorld(this.world.entry.z) };
    if (!yes) {
      c.leaving = s.time;
      this.log(`${c.kind === 'family' ? `The ${c.last} family` : c.name || 'The stranger'} thanked you and walked on down the road.`);
      return { ok: true };
    }
    if (c.kind === 'family' || c.kind === 'stranger') {
      const made = c.members.map((m, i) => {
        const v = this.spawnVillager(c.sid, pos.x + (i % 2 ? 0.4 : -0.4), pos.z + Math.floor(i / 2) * 0.4, { age: m.age, race: c.race, gender: m.gender, last: c.last, look: m.look });
        v.name = m.name; return v;
      });
      if (c.kind === 'family') {
        const [a, b, ...kids] = made;
        a.partner = b.id; b.partner = a.id; a.wed = b.wed = 'old';
        a.kids = kids.map(k => k.id); b.kids = kids.map(k => k.id);
        for (const k of kids) k.parents = [a.id, b.id];
        this.story('visitor', `The ${c.last} family fled ${c.cause}, and found a new home in ${where}. Welcome, ${made.map(v => first(v.name)).join(', ')}!`, made.slice(0, 4), 'people');
        this.emit('toast', `The ${c.last} family moved in!`, 'house');
      } else {
        const v = made[0]; v.secret = c.secret; v.revealAt = s.time + DAY * 0.6;
        this.story('visitor', `A hooded stranger was given a place by the fire in ${where}. They say their name is ${first(v.name)}. Nobody knows much more.`, [v], 'hood');
      }
      s.stats.visitors = (s.stats.visitors || 0) + 1;
      V.cur = null; this.emit('visitorGone', c, 'stayed');
      return { ok: true };
    }
    this.pay({ coins: D.fee });
    if (c.kind === 'bard') {
      c.show = s.time + DAY * 0.35; c.until = c.show;
      s.festJoy = Math.max(s.festJoy || 0, DAY * 0.4);
      for (const v of s.villagers) if (v.home === c.sid) v.calmUntil = s.time + DAY * 0.4;
      this.story('visitor', `${c.name}, a wandering bard, sang at the campfire in ${where}. Old songs, new songs, and one very silly one about a goat.`, [], 'lute');
    }
    if (c.kind === 'scholar') {
      this.rpg().know += 30;
      const keen = s.villagers.filter(v => v.home === c.sid && stageOf(v) === 'adult').sort((a, b) => (b.abil?.int || 10) - (a.abil?.int || 10)).slice(0, 3);
      for (const v of keen) v.study = (v.study || 0) + 20;
      c.show = s.time + DAY * 0.3; c.until = c.show;
      this.story('visitor', `${c.name}, a travelling scholar, taught a day of lessons in ${where}. ${keen.map(v => first(v.name)).join(', ') || 'Everyone'} took careful notes.`, keen, 'book');
    }
    s.stats.visitors = (s.stats.visitors || 0) + 1;
    this.emit('res');
    return { ok: true };
  },
  visitSecond() {
    const s = this.s, V = s.visitors, c = V.cur, day = this.dayNum(), f = this.dayFrac();
    // hooded strangers show who they really are
    for (const v of s.villagers) if (v.secret && s.time > v.revealAt) {
      const sec = v.secret; v.secret = null;
      if (sec === 'hero') {
        v.cls = this.rng() < 0.5 ? 'fighter' : 'ranger'; v.lvl = Math.max(3, v.lvl || 1); v.hp = maxHp(v);
        this.story('visitor', `The hooded stranger, ${v.name}, turned out to be a famous ${v.cls === 'fighter' ? 'swordmaster' : 'monster hunter'}, tired of the road. ${this.sname(v.home)} is safer for it.`, [v], 'shield');
      } else {
        v.shady = true; v.quirk = 'grumpy';
        this.story('visitor', `The hooded stranger, ${v.name}, turned out to be a pickpocket trying to go straight. Trying. Keep an eye on the coin box.`, [v], 'coin');
      }
    }
    if (c) {
      // a "no", or nobody answered: they walk away down the road, then they're gone
      if (!c.leaving && !c.answered && s.time > c.until) { c.leaving = s.time; this.log(`${VISITORS[c.kind].name} waited a while, then went on their way.`); }
      if (c.answered === 'yes' && s.time > c.until && !c.leaving) c.leaving = s.time;
      if (c.leaving && !this.visitorPos(c).moving) { V.cur = null; this.emit('visitorGone', c, c.answered || 'left'); }
      return;
    }
    // a new visitor, at most one a day, from day 3, in daylight
    if (day < 2 || s.fallen || V.day === day || f < 0.3 || f > 0.6 || this.stormy() || this.isNight()) return;
    V.day = day;
    if (this.rng() > 0.6 || s.events?.list?.some(e => ['dragon', 'raiders'].includes(e.type))) return;
    const kinds = Object.keys(VISITORS).filter(k => k !== V.last && s.villagers.length >= (VISITORS[k].minPop || 0));
    const tot = kinds.reduce((t, k) => t + VISITORS[k].w, 0);
    let x = this.rng() * tot, kind = kinds[0];
    for (const k of kinds) { x -= VISITORS[k].w; if (x <= 0) { kind = k; break; } }
    this.makeVisitor(kind);
  },
};
