// Friendships and evening visits. Sim-side only.
//
// Every pair of villagers has an affinity from 0 to 100 (s.friends["a-b"]).
// It grows when they work at the same place, idle or chat near each other,
// dance at the same festival, and visit each other's homes in the evening.
//   30+ friends (one heart) · 60+ good friends (two) · 90+ best friends (three)
// Friendships make the whole village a little happier.

export const HEARTS = [30, 60, 90];
export const heartsOf = a => a >= 90 ? 3 : a >= 60 ? 2 : a >= 30 ? 1 : 0;
const key = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
const CHATTY = /Relaxing|Resting|Playing|Chatting|Taking it easy/;

export function installSocial(sim) {
  const s = sim.s;
  s.friends ||= {};
  const F = s.friends;
  const aff = (a, b) => F[key(a.id ?? a, b.id ?? b)] || 0;
  function bump(a, b, n) {
    if (a === b || !a || !b) return;
    const k = key(a.id, b.id), was = F[k] || 0, now = Math.min(100, was + n);
    F[k] = now;
    const h0 = heartsOf(was), h1 = heartsOf(now);
    if (h1 > h0 && h1 >= 2) {
      const what = h1 === 3 ? 'best friends' : 'good friends';
      sim.log(`${a.name} and ${b.name} are ${what} now.`);
      if (h1 === 3) sim.emit('toast', `${a.name.split(' ')[0]} & ${b.name.split(' ')[0]} are best friends!`, 'heart');
    }
  }
  sim.affinity = aff;
  sim.friendsOf = v => {
    const out = [];
    for (const o of s.villagers) { if (o === v) continue; const a = aff(v, o); if (a >= 8) out.push({ v: o, a, hearts: heartsOf(a) }); }
    return out.sort((x, y) => y.a - x.a);
  };
  const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) < r;

  // every few seconds: who's spending time together?
  function mingle() {
    const V = s.villagers;
    for (const b of s.buildings) {
      if (!b.built || b.workers.length < 2) continue;
      const ws = b.workers.map(id => sim.vById.get(id)).filter(Boolean);
      for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) if (near(ws[i], ws[j], 4)) bump(ws[i], ws[j], 1.1);
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
        if (restA && (CHATTY.test(b.task?.label || '') || b.act?.anim === 'rest') && near(a, b, 2.4)) bump(a, b, 1);
      }
    }
    // the happiness that friendship brings (shifts the village's mood target)
    let best = 0, score = 0;
    for (const k in F) {
      const a = F[k]; if (a < 30) continue;
      const [x, y] = k.split('-').map(Number);
      if (!sim.vById.has(x) || !sim.vById.has(y)) { delete F[k]; continue; }
      score += a >= 90 ? 0.6 : a >= 60 ? 0.35 : 0.15;
      if (a >= 90) best++;
    }
    s.stats.bestfriends = best;
    sim.friendJoy = Math.min(8, score);
  }

  // evening visits: walk to a friend's door, chat a while, hearts all round
  function taskVisit(v, f, house) {
    const [ex, ez] = sim.entryTile(house), door = sim.local(house, 0, sim.bCenter(house).d / 2 + 0.55);
    const day = sim.dayNum();
    sim.setTask(v, `Visiting ${f.name.split(' ')[0]}`, [
      { walk: { tx: ex, tz: ez } }, { to: [door.x + 0.3, door.z] }, { face: [door.x - 1, door.z] },
      { act: 8 + sim.rng() * 5, anim: 'sell', start: () => {
        v.chat = f.id;
        // the friend pops out to say hello if they're about
        if (!f.asleep && !f.carry && near(f, v, 14) && (!f.task || CHATTY.test(f.task.label) || f.job === 'idle' || f.job === 'retired' || f.indoors && !f.asleep)) {
          sim.setTask(f, `Chatting with ${v.name.split(' ')[0]}`, [{ walk: { tx: ex, tz: ez } }, { to: [door.x - 0.3, door.z] }, { face: [v.x, v.z] },
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
    if (sim.friendJoy) s.happiness = Math.min(100, s.happiness + sim.friendJoy * 0.05);
  };
  // a festival leaves everyone who danced together a little closer
  const end = sim.endFestival.bind(sim);
  sim.endFestival = fest => {
    for (const sid of Object.keys(s.unlocked)) {
      const folk = s.villagers.filter(v => v.home === sid && v.age >= 5);
      for (let i = 0; i < folk.length; i++) for (let j = i + 1; j < Math.min(folk.length, i + 6); j++) bump(folk[i], folk[j], 3);
    }
    return end(fest);
  };
  mingle();
}
