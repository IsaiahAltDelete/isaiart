// Friendships, rivalries and evening visits. Sim-side only.
//
// Every pair of villagers has an affinity from -100 to 100 (s.friends["a-b"]).
// It grows when they work at the same place, idle or chat near each other,
// dance at the same festival, and visit each other's homes in the evening.
//   30+ friends (one heart) · 60+ good friends (two) · 90+ best friends (three)
//   -30 or less: rivals
// Not everyone gets along. Each villager has a quirk (cheerful, grumpy, prankster,
// proud, shy or chatterbox); time together sometimes ends in a squabble instead of
// a laugh, more often between clashing quirks. Friendships fade without contact,
// grudges fade too, festivals mend fences, and couples who keep squabbling may part.
// Friendships make the whole village happier; rivalries take a little of it away.
// The notable moments go to the Journal's Story page (sim.story).
import { mulberry32 } from './rng.js';
import { stageOf } from './sim.js';

export const HEARTS = [30, 60, 90];
export const RIVAL = -30;
export const heartsOf = a => a >= 90 ? 3 : a >= 60 ? 2 : a >= 30 ? 1 : 0;
export const QUIRKS = {
  cheerful: { name: 'Cheerful', desc: 'Gets along with almost everyone, and forgives quickly.' },
  grumpy: { name: 'Grumpy', desc: 'Quick to squabble and slow to forgive. Loyal once you win them over.' },
  prankster: { name: 'Prankster', desc: 'Cannot resist a practical joke. Proud folk do not find it funny.' },
  proud: { name: 'Proud', desc: 'Hates being made a fool of. Clashes with pranksters and the grumpy.' },
  shy: { name: 'Shy', desc: 'Makes few friends, but keeps them for life.' },
  gossip: { name: 'Chatterbox', desc: 'Befriends everyone, and tells everyone everything.' },
};
const QUIRK_KEYS = Object.keys(QUIRKS);
// pairs that rub each other up the wrong way
const CLASH = new Set(['grumpy-cheerful', 'prankster-proud', 'grumpy-prankster', 'proud-grumpy', 'gossip-shy', 'proud-gossip']);
const clashes = (a, b) => CLASH.has(`${a}-${b}`) || CLASH.has(`${b}-${a}`);
const key = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
const CHATTY = /Relaxing|Resting|Playing|Chatting|Taking it easy/;
const first = v => v.name.split(' ')[0];
const SQUABBLES = [
  '{a} and {b} argued over whose turn it was to fetch water.',
  '{a} told {b} their soup needed salt. {b} did not take it well.',
  '{a} and {b} squabbled about the right way to stack firewood.',
  '{a} accused {b} of humming off-key. All day.',
  '{a} and {b} had words about a borrowed hammer that never came back.',
  '{b} beat {a} at cards, and {a} is demanding a rematch.',
  '{a} and {b} disagree, loudly, about whether a pumpkin is a fruit.',
  '{a} trod on {b}’s vegetable patch. Twice.',
  '{a} and {b} both claim the sunny bench by the fire.',
];

export function pickQuirk(r) { return QUIRK_KEYS[(r() * QUIRK_KEYS.length) | 0]; }

export function installSocial(sim) {
  const s = sim.s;
  s.friends ||= {};
  const F = s.friends, D = s.drama || (s.drama = { day: -1, told: 0, last: {} });
  const aff = (a, b) => F[key(a.id ?? a, b.id ?? b)] || 0;
  const quirk = v => v.quirk || 'cheerful';
  // old saves and newcomers: everyone gets a quirk (seeded by id, so it never changes)
  for (const v of s.villagers) if (!v.quirk) v.quirk = pickQuirk(mulberry32(((v.id * 2654435761) ^ 0x9e37) >>> 0));
  const spawn = sim.spawnVillager.bind(sim);
  sim.spawnVillager = (...args) => { const v = spawn(...args); v.quirk ||= pickQuirk(sim.rng); return v; };

  // a squabble story now and then (not every one: at most a few a day, and not the same pair twice running)
  function tell(kind, text, a, b, icon) {
    const day = sim.dayNum();
    if (D.day !== day) { D.day = day; D.told = 0; }
    const k = key(a.id, b.id);
    if (kind === 'squabble' && (D.told >= 3 || (D.last[k] ?? -9) > day - 2)) return;
    if (kind === 'squabble') { D.told++; D.last[k] = day; }
    sim.story(kind, text, [a, b], icon);
  }
  function bump(a, b, n) {
    if (a === b || !a || !b) return;
    const k = key(a.id, b.id), was = F[k] || 0, now = Math.max(-100, Math.min(100, was + n));
    F[k] = now;
    const h0 = heartsOf(was), h1 = heartsOf(now);
    if (h1 > h0 && h1 >= 2) {
      const what = h1 === 3 ? 'best friends' : 'good friends';
      sim.log(`${a.name} and ${b.name} are ${what} now.`);
      if (h1 === 3) sim.story('friends', `${a.name} and ${b.name} are best friends now.`, [a, b], 'heart');
    }
    if (was > RIVAL && now <= RIVAL) {
      sim.log(`${a.name} and ${b.name} have become rivals.`);
      tell('rivals', `${a.name} and ${b.name} have become rivals. They pretend not to see each other at the well.`, a, b, 'storm');
    }
    if (was <= RIVAL && now > RIVAL) {
      sim.log(`${a.name} and ${b.name} made up.`);
      tell('makeup', `${a.name} and ${b.name} finally made up. Old grudges, forgotten.`, a, b, 'heart');
    }
  }
  // a speech bubble over their heads for a few seconds (drawn by main.js); they turn to face each other
  function talk(a, b, k, secs = 4) {
    for (const [x, y] of [[a, b], [b, a]]) {
      x.talk = { k, until: s.time + secs * (0.8 + sim.rng() * 0.4), with: y.id };
      if (x.act && !x.path?.length) x.face = Math.atan2(y.x - x.x, y.z - x.z);
    }
  }
  sim.talk = talk;
  // time together: usually a laugh, sometimes a squabble
  function meet(a, b, n) {
    const qa = quirk(a), qb = quirk(b), clash = clashes(qa, qb);
    let p = 0.03 * (clash ? 4 : 1) * (qa === 'grumpy' || qb === 'grumpy' ? 1.8 : 1) * (qa === 'cheerful' && qb === 'cheerful' ? 0.2 : 1)
      * (a.hungry || b.hungry ? 1.6 : 1) * (s.happiness < 50 ? 1.5 : 1);
    if (aff(a, b) >= 60) p *= 0.4;                    // good friends forgive a lot
    if (sim.calmNear?.(a)) p *= 0.5;                   // a bard nearby smooths things over
    if (sim.rng() < p) {
      bump(a, b, -(6 + sim.rng() * 5));
      talk(a, b, 'angry', 5);
      // bitter rivals with short fuses sometimes come to blows (a few bruises, never worse)
      const fuse = [qa, qb].some(q => q === 'grumpy' || q === 'proud') || a.hungry || b.hungry;
      if (aff(a, b) <= -60 && fuse && stageOf(a) !== 'child' && stageOf(b) !== 'child' && sim.rng() < 0.2) { sim.scuffle?.(a, b); return; }
      if (sim.rng() < 0.35) {
        // a line the Story hasn't used lately
        const recent = D.lines || (D.lines = []), fresh = SQUABBLES.map((_, i) => i).filter(i => !recent.includes(i));
        const li = fresh[(sim.rng() * fresh.length) | 0]; recent.push(li); if (recent.length > 5) recent.shift();
        const line = SQUABBLES[li], [x, y] = sim.rng() < 0.5 ? [a, b] : [b, a];
        tell('squabble', line.replace(/\{a\}/g, first(x)).replace(/\{b\}/g, first(y)), x, y, 'storm');
      }
      return;
    }
    const mult = (qa === 'gossip' || qb === 'gossip' ? 1.4 : 1) * (qa === 'shy' || qb === 'shy' ? 0.6 : 1);
    bump(a, b, n * mult);
    if (!(a.talk?.until > s.time) && sim.rng() < 0.4) talk(a, b, a.partner === b.id && sim.rng() < 0.5 ? 'love' : 'chat');
  }
  sim.affinity = aff;
  sim.bumpAffinity = bump;
  sim.friendsOf = v => {
    const out = [];
    for (const o of s.villagers) { if (o === v) continue; const a = aff(v, o); if (a >= 8) out.push({ v: o, a, hearts: heartsOf(a) }); }
    return out.sort((x, y) => y.a - x.a);
  };
  sim.rivalsOf = v => s.villagers.filter(o => o !== v && aff(v, o) <= RIVAL).map(o => ({ v: o, a: aff(v, o) })).sort((x, y) => x.a - y.a);
  sim.quirkOf = v => QUIRKS[quirk(v)];
  const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) < r;

  // every few seconds: who's spending time together?
  function mingle() {
    const V = s.villagers;
    for (const b of s.buildings) {
      if (!b.built || b.workers.length < 2) continue;
      const ws = b.workers.map(id => sim.vById.get(id)).filter(Boolean);
      for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) if (near(ws[i], ws[j], 4)) meet(ws[i], ws[j], 1.1);
    }
    const fest = sim.festivalActive();
    for (let i = 0; i < V.length; i++) {
      const a = V[i];
      if (a.asleep || a.indoors || a.age < 5) continue;
      const restA = CHATTY.test(a.task?.label || '') || a.act?.anim === 'rest';
      for (let j = i + 1; j < V.length; j++) {
        const b = V[j];
        if (b.asleep || b.indoors || b.age < 5) continue;
        if (fest && a.dancing && b.dancing && a.home === b.home && near(a, b, 3)) { bump(a, b, 1.5); continue; }
        if (restA && (CHATTY.test(b.task?.label || '') || b.act?.anim === 'rest') && near(a, b, 2.4)) meet(a, b, 1);
      }
    }
    // friendships fade without time together, and grudges fade too (shy folk hold on longer)
    for (const k in F) {
      const a = F[k];
      const [x, y] = k.split('-').map(Number), vx = sim.vById.get(x), vy = sim.vById.get(y);
      if (!vx || !vy) { delete F[k]; continue; }
      const keep = vx.quirk === 'shy' || vy.quirk === 'shy' ? 0.5 : 1, couple = vx.partner === y;
      if (a > 0 && !couple) F[k] = Math.max(0, a - 0.18 * keep);
      else if (a < 0) F[k] = Math.min(0, a + (vx.quirk === 'grumpy' || vy.quirk === 'grumpy' ? 0.06 : 0.12));
      if (Math.abs(F[k]) < 0.5) delete F[k];
    }
    // couples who can't stop squabbling may part ways (rarely)
    for (const v of V) {
      const p = v.partner && sim.vById.get(v.partner);
      if (!p || v.id > p.id) continue;
      if (!v.loveSeeded) { v.loveSeeded = p.loveSeeded = true; F[key(v.id, p.id)] = Math.max(aff(v, p), 70); }
      if (aff(v, p) < 0 && sim.rng() < 0.02) {
        v.partner = null; p.partner = null;
        sim.log(`${v.name} and ${p.name} parted ways.`);
        sim.story('breakup', `${v.name} and ${p.name} have parted ways. They'll stay civil… mostly.`, [v, p], 'storm');
      }
    }
    // the happiness that friendship brings (shifts the village's mood target); rivalries cost a little
    let best = 0, score = 0, rivals = 0;
    for (const k in F) {
      const a = F[k];
      if (a <= RIVAL) { rivals++; continue; }
      if (a < 30) continue;
      score += a >= 90 ? 0.6 : a >= 60 ? 0.35 : 0.15;
      if (a >= 90) best++;
    }
    s.stats.bestfriends = best;
    sim.friendJoy = Math.min(8, score) - Math.min(5, rivals * 0.5);
  }

  // evening visits: walk to a friend's door, chat a while, hearts all round
  function taskVisit(v, f, house) {
    const [ex, ez] = sim.entryTile(house), door = sim.local(house, 0, sim.bCenter(house).d / 2 + 0.55);
    const day = sim.dayNum();
    sim.setTask(v, `Visiting ${first(f)}`, [
      { walk: { tx: ex, tz: ez } }, { to: [door.x + 0.3, door.z] }, { face: [door.x - 1, door.z] },
      { act: 8 + sim.rng() * 5, anim: 'sell', start: () => {
        v.chat = f.id; talk(v, f, v.partner === f.id ? 'love' : 'chat', 9);
        // the friend pops out to say hello if they're about
        if (!f.asleep && !f.carry && near(f, v, 14) && (!f.task || CHATTY.test(f.task.label) || f.job === 'idle' || f.job === 'retired' || f.indoors && !f.asleep)) {
          sim.setTask(f, `Chatting with ${first(v)}`, [{ walk: { tx: ex, tz: ez } }, { to: [door.x - 0.3, door.z] }, { face: [v.x, v.z] },
            { act: 9, anim: 'sell', start: () => { f.chat = v.id; }, done: () => { f.chat = null; } }]);
        }
      }, done: () => {
        v.chat = null; v.lastVisit = day;
        bump(v, f, f.chat === v.id || near(f, v, 1.6) ? 5 : 2);
        s.stats.visits = (s.stats.visits || 0) + 1;
      } },
    ]);
  }
  const think = sim.think.bind(sim);
  sim.think = v => {
    const f = sim.dayFrac();
    if (!v.carry && v.age >= 14 && f > 0.72 && f < 0.9 && !sim.festivalActive() && !sim.stormy?.() && !sim.sleepy(v)
      && v.lastVisit !== sim.dayNum() && v.job !== 'guard' && sim.rng() < 0.18) {
      const mine = sim.bedFor(v).b;
      const pals = sim.friendsOf(v).filter(o => o.a >= 20 && o.v.age >= 5);
      for (const p of pals.slice(0, 3)) {
        const h = sim.bedFor(p.v).b;
        if (!h || h === mine || h.type === 'campfire') continue;
        v.lastVisit = sim.dayNum();
        return taskVisit(v, p.v, h);
      }
      v.lastVisit = sim.dayNum();
    }
    return think(v);
  };
  // a dropped visit shouldn't leave a heart hanging
  const drop = sim.dropTask.bind(sim);
  sim.dropTask = v => { if (v) v.chat = null; return drop(v); };
  let t = 0;
  const second = sim.second;
  sim.second = () => {
    second();
    if (++t % 5 === 0) mingle();
    if (sim.friendJoy) s.happiness = Math.max(0, Math.min(100, s.happiness + sim.friendJoy * 0.05));
  };
  // a festival leaves everyone who danced together a little closer, and mends a few fences
  const end = sim.endFestival.bind(sim);
  sim.endFestival = fest => {
    for (const sid of Object.keys(s.unlocked)) {
      const folk = s.villagers.filter(v => v.home === sid && v.age >= 5);
      for (let i = 0; i < folk.length; i++) for (let j = i + 1; j < Math.min(folk.length, i + 6); j++) bump(folk[i], folk[j], 3);
      for (const a of folk) for (const r of sim.rivalsOf(a)) if (a.id < r.v.id && sim.rng() < 0.4) bump(a, r.v, 20);
    }
    return end(fest);
  };
  mingle();
}
