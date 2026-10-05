// Crime: rare, visible and a little silly. Never hurts anyone.
//
// Once a night each settlement may have a bit of trouble. The chance grows with
// struggling homes and a glum village, and shrinks with guards, lanterns, a
// safe government and the Night watch policy; a happy, prosperous village is
// peaceful. The culprit pulls on a mask, sneaks to the store with a sack and
// heads home. Any guard or constable who comes within sight can catch them on
// the way: the loot goes back, and with a Watch House in the settlement they
// spend the next morning in the stocks out front (v.jail = until when).
import { stageOf, defOf, DAY } from './sim.js';

const SIGHT = 7;            // world units
const first = v => v.name.split(' ')[0];

export function installCrime(sim) {
  Object.assign(sim, CRIME);
  const s = sim.s;
  // saves from the pressure/custody version: release everyone, keep only a short log
  if (!s.crime?.v2) {
    for (const v of s.villagers) { v.jail = 0; v.jailHouse = null; v.sneak = null; }
    s.crime = { v2: 1, nights: {}, log: [], caught: 0, thefts: 0 };
  }
  s.crime.wanted ||= []; s.crime.pid ||= 0;
  const think = sim.think.bind(sim);
  sim.think = v => {
    if (v.jail > s.time) return sim.taskStocks(v);
    // a storm, or daybreak before they reached the store, calls it off
    if (v.sneak && !v.sneak.home && (sim.stormy() || !sim.isNight())) v.sneak = null;
    if (v.sneak) return sim.taskSneak(v);
    if (v.raid) return sim.taskRaid(v);
    return think(v);
  };
  const assign = sim.assign.bind(sim);
  sim.assign = (b, v) => {
    if (v?.jail > s.time || v?.sneak || v?.quest || v?.ko > 0 || v?.downed) return false;
    // when the game picks, it skips anyone in the stocks, away or hurt
    if (!v) v = s.villagers.filter(o => o.job === 'idle' && stageOf(o) === 'adult' && !(o.jail > s.time) && !o.sneak && !o.quest && !(o.ko > 0) && !o.downed
        && sim.canDoJob(o, b.type === 'university' ? 'professor' : defOf(b.type).job))
      .sort((a, c) => (a.home !== b.sid) - (c.home !== b.sid) || sim.jobFit(c, defOf(b.type).job) - sim.jobFit(a, defOf(b.type).job) || a.id - c.id)[0];
    return v ? assign(b, v) : false;
  };
  // constables keep the night watch, like guards on the towers
  const sleepy = sim.sleepy.bind(sim);
  sim.sleepy = v => (v.job === 'constable' && sim.isNight() ? false : sleepy(v));
  const second = sim.second.bind(sim);
  sim.second = () => {
    second();
    for (const v of s.villagers) if (v.jail && (v.jail <= s.time || !sim.bById.has(v.jailHouse))) {
      v.jail = 0; v.jailHouse = null; sim.dropTask(v);
    }
    // a roll for each settlement, once each night
    if (sim.isNight() && !sim.stormy()) {
      const night = sim.dayFrac() < 0.5 ? sim.dayNum() - 1 : sim.dayNum();
      for (const sid of Object.keys(s.unlocked)) {
        if (s.crime.nights[sid] === night) continue;
        s.crime.nights[sid] = night;
        if (sim.rng() < sim.crimeChance(sid)) sim.startCrime(sid);
      }
    }
    for (const v of s.villagers) if (v.sneak) sim.watchFor(v);
    sim.wantedSecond();
    // hungry villagers with an empty store go looking for food where they shouldn't
    if ((sim.hungerT = (sim.hungerT || 0) + 1) % 15 === 0 && !sim.isNight()) for (const v of s.villagers) {
      if (v.hungry && stageOf(v) !== 'child' && !v.raid && !v.sneak && !(v.jail > s.time) && !v.quest && v.fireB == null && sim.rng() < 0.12) sim.startRaid(v);
    }
    // a prank or two by day (once a day per settlement, around midday)
    const f = sim.dayFrac(), day = sim.dayNum();
    if (f > 0.45 && f < 0.7 && !sim.stormy()) for (const sid of Object.keys(s.unlocked)) {
      const k = 'p' + sid;
      if (s.crime.nights[k] === day) continue;
      s.crime.nights[k] = day;
      sim.mischief(sid);
    }
  };
}

const CRIME = {
  // how likely trouble is tonight in a settlement (0..0.4)
  crimeChance(sid) {
    const s = this.s, homes = this.lodgings().filter(b => b.sid === sid && !b.prosEmpty);
    const struggling = homes.length ? homes.filter(b => (b.pros || 0) === 0).length / homes.length : 0;
    const watchers = s.villagers.filter(v => v.home === sid && ['guard', 'constable'].includes(v.job)).length;
    const lights = s.buildings.filter(b => b.built && b.sid === sid && ['torch', 'lantern'].includes(b.type)).length;
    const folk = s.villagers.filter(v => v.home === sid), hungry = folk.length ? folk.filter(v => v.hungry).length / folk.length : 0;
    const p = 0.07 + struggling * 0.3 + hungry * 0.25 + Math.max(0, 55 - s.happiness) * 0.006
      - watchers * 0.02 - Math.min(0.06, lights * 0.01) - this.govEffects().safety * 0.02 - (this.policyOn('nightWatch') ? 0.06 : 0);
    return Math.max(0, Math.min(0.4, p));
  },
  // a word for the Town panel
  safetyOf(sid) {
    const s = this.s, open = s.crime.wanted.filter(p => !p.caught && p.sid === sid).length;
    const recent = s.crime.log.filter(l => s.time - l.t < DAY * 2 && /made off|sneaking off/.test(l.msg)).length;
    const p = this.crimeChance(sid), score = p * 20 + open + recent;
    return score < 1 ? 'Peaceful' : score < 3 ? 'Uneasy' : 'Troubled';
  },
  startCrime(sid) {
    const s = this.s;
    const store = s.buildings.filter(b => b.built && b.sid === sid && ['storehouse', 'campfire', 'market'].includes(b.type))[0];
    if (!store) return null;
    const ok = v => v.home === sid && stageOf(v) === 'adult' && !['guard', 'constable'].includes(v.job) && s.gov?.leader !== v.id
      && !v.quest && !(v.ko > 0) && !v.downed && !(v.jail > s.time);
    const pool = s.villagers.filter(ok), poor = pool.filter(v => (this.homeOf(v)?.pros ?? 0) === 0 || v.job === 'idle');
    const shady = pool.filter(v => v.shady && this.rng() < 0.5);   // a pickpocket trying to go straight (visitors.js)
    const list = shady.length ? shady : poor.length ? poor : pool;
    if (!list.length) return null;
    const v = list[Math.floor(this.rng() * list.length)];
    this.dropTask(v); v.asleep = false; v.indoors = false;
    v.sneak = { store: store.id, loot: null };
    return v;
  },
  taskSneak(v) {
    const st = this.bById.get(v.sneak.store);
    if (!st) { v.sneak = null; return this.taskSleep(v); }
    const home = this.bedFor(v).b || st, c = this.bCenter(st);
    const goHome = [{ walk: this.goalBuilding(home) }, { act: 0.2, done: () => this.escaped(v) }];
    if (v.sneak.home) return this.setTask(v, 'Sneaking home', goHome);   // interrupted on the way back
    this.setTask(v, 'Sneaking about', [
      { walk: this.goalBuilding(st) }, { face: [c.x, c.z] },
      { act: 3, anim: 'work', done: () => {
        if (!v.sneak) return;
        const coins = Math.min(Math.floor(this.s.res.coins), Math.min(120 * this.s.level, Math.max(10 + Math.floor(this.s.villagers.length / 3), Math.floor(this.s.res.coins * 0.01))));
        if (coins > 0) { this.s.res.coins -= coins; this.track('coins', -coins); this.emit('res'); }
        v.sneak.loot = coins; v.sneak.home = true;
      } },
      ...goHome,
    ]);
  },
  // guards and constables nearby spot a sneaking villager
  watchFor(v) {
    if (!v.sneak?.home) return;
    const s = this.s;
    const seen = s.villagers.find(o => o !== v && (['guard', 'constable'].includes(o.job) || ['rogue', 'paladin'].includes(o.cls) && stageOf(o) === 'adult') && !o.asleep && !(o.ko > 0) && !o.quest
      && Math.hypot(o.x - v.x, o.z - v.z) < SIGHT * (this.policyOn('nightWatch') ? 1.6 : 1));
    if (seen && this.rng() < 0.35) this.caught(v, seen);
  },
  caught(v, by) {
    const s = this.s, loot = v.sneak?.loot || 0;
    if (loot) { s.res.coins += loot; this.track('coins', loot); this.emit('res'); }
    v.sneak = null; this.dropTask(v);
    const house = s.buildings.find(b => b.type === 'watchhouse' && b.built && b.sid === v.home);
    const morning = (Math.floor(s.time / DAY) + (this.dayFrac() > 0.5 ? 1 : 0)) * DAY + DAY * 0.42;
    if (house) { v.jail = Math.max(s.time + 30, morning); v.jailHouse = house.id; }
    s.crime.caught++;
    const msg = `${by.name} caught ${v.name} sneaking off with ${loot} coins.${house ? ' A morning in the stocks!' : ' The coins went back.'}`;
    this.crimeLog(msg); this.log(msg);
    this.story('crime', msg, [by, v], 'shield');
    this.emit('float', v.x, v.z, 'Caught!', 'shield');
  },
  escaped(v) {
    const loot = v.sneak?.loot || 0;
    v.sneak = null;
    if (!loot) return;
    this.s.crime.thefts++;
    this.addWanted(v, `Theft of ${loot} coins`, this.rng() < 0.35);   // sometimes someone glimpsed them
    const msg = `Someone made off with ${loot} coins in the night.`;
    this.crimeLog(msg); this.log(msg);
    this.story('crime', msg, [], 'coin');
  },
  // harmless mischief: a borrowed pie, a frog in a boot, a very pink bucket
  mischief(sid) {
    const s = this.s, folk = s.villagers.filter(v => v.home === sid && v.age >= 10 && !v.asleep && !v.quest && !(v.jail > s.time));
    const pranksters = folk.filter(v => v.quirk === 'prankster' || v.age < 22 && v.quirk !== 'shy');
    if (!pranksters.length || this.rng() > 0.35 + (folk.some(v => v.quirk === 'prankster') ? 0.3 : 0)) return null;
    const a = pranksters[Math.floor(this.rng() * pranksters.length)], others = folk.filter(o => o !== a && o.age >= 14);
    const b = others[Math.floor(this.rng() * others.length)];
    const has = t => s.buildings.find(o => o.built && o.sid === sid && o.type === t);
    const F = a => a.name.split(' ')[0];
    const pranks = [
      this.trade.get(sid, 'food') >= 3 && (() => { this.trade.consume(sid, 'food', 3); return `${F(a)} “borrowed” a fresh pie from the ${has('bakery') ? 'bakery' : 'food store'}. Crumbs everywhere.`; }),
      b && (() => { this.affinity && this.bumpAffinity?.(a, b, b.quirk === 'proud' ? -15 : b.quirk === 'cheerful' ? 4 : -7); return `${F(a)} hid a frog in ${F(b)}’s boot.${b.quirk === 'cheerful' ? ` ${F(b)} laughed it off.` : b.quirk === 'proud' ? ` ${F(b)} is not amused.` : ''}`; }),
      has('well') && (() => `${F(a)} painted the well bucket bright pink. Nobody can prove a thing.`),
      has('coop') && (() => { s.happiness = Math.min(100, s.happiness + 1); return `${F(a)} let the chickens out. Half the village spent the morning chasing them.`; }),
      has('bakery') && (() => `${F(a)} swapped the salt and the sugar at the bakery. Today's bread was… interesting.`),
      b && this.seasonIdx?.() === 3 && (() => { this.bumpAffinity?.(a, b, -3); return `${F(a)} built a snowman that looks suspiciously like ${F(b)}.`; }),
      b && (() => { this.bumpAffinity?.(a, b, -4); return `${F(a)} tied ${F(b)}’s bootlaces together during lunch.`; }),
    ].filter(Boolean);
    const msg = pranks[Math.floor(this.rng() * pranks.length)]();
    this.log(msg); this.story('mischief', msg, b && msg.includes(F(b)) ? [a, b] : [a], 'party');
    return msg;
  },
  // two rivals come to blows: a shove, a tumble, a few bruises. Never a knock-out.
  scuffle(a, b) {
    const temper = v => (v.quirk === 'grumpy' ? 3 : v.quirk === 'proud' ? 2 : 0) + (v.hungry ? 2 : 0) - (v.quirk === 'cheerful' ? 2 : 0);
    if (temper(b) > temper(a)) [a, b] = [b, a];
    const s = this.s, why = ['a borrowed hammer', 'the last pie', 'whose turn it was at the well', 'a remark about their hat', 'the sunny bench', 'a game of cards'][Math.floor(this.rng() * 6)];
    for (const v of [a, b]) {
      this.dropTask(v);
      v.hp = Math.max(1, (v.hp ?? 5) - 1 - Math.floor(this.rng() * 2));
      this.setTask(v, 'Scuffling', [{ face: [v === a ? b.x : a.x, v === a ? b.z : a.z] }, { act: 4, anim: 'scuffle' }]);
    }
    this.talk?.(a, b, 'angry', 5);
    s.happiness = Math.max(0, s.happiness - 2);
    s.crime.scuffles = (s.crime.scuffles || 0) + 1;
    const near = s.villagers.filter(o => o !== a && o !== b && !o.asleep && !o.quest && !(o.ko > 0) && stageOf(o) === 'adult'
        && (['guard', 'constable'].includes(o.job) || ['paladin', 'fighter'].includes(o.cls)) && Math.hypot(o.x - a.x, o.z - a.z) < 12)
      .sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z))[0] || null;
    let msg = `${a.name.split(' ')[0]} and ${b.name.split(' ')[0]} came to blows over ${why}! Just a few bruises.`;
    if (near) {
      const house = s.buildings.find(o => o.type === 'watchhouse' && o.built && o.sid === a.home);
      msg += ` ${near.name.split(' ')[0]} broke it up${house ? `, and ${a.name.split(' ')[0]} will spend the morning in the stocks` : ''}.`;
      if (house) { const morning = (Math.floor(s.time / DAY) + (this.dayFrac() > 0.5 ? 1 : 0)) * DAY + DAY * 0.42; a.jail = Math.max(s.time + 40, morning); a.jailHouse = house.id; }
    }
    this.log(msg); this.story('scuffle', msg, [a, b], 'storm');
    this.emit('float', a.x, a.z, 'Scuffle!', 'storm');
  },
  // hunger: raid a field, an orchard, a coop or a hive
  startRaid(v) {
    const s = this.s, c = { x: v.x, z: v.z };
    const spots = s.buildings.filter(b => b.built && b.sid === v.home && (b.type === 'farm' && b.data?.stage === 'growing' || ['orchard', 'coop', 'beehive', 'dairy'].includes(b.type)))
      .sort((p, q) => Math.hypot(this.bCenter(p).x - c.x, this.bCenter(p).z - c.z) - Math.hypot(this.bCenter(q).x - c.x, this.bCenter(q).z - c.z));
    if (!spots.length) return false;
    this.dropTask(v); v.raid = { bid: spots[0].id };
    return true;
  },
  taskRaid(v) {
    const b = this.bById.get(v.raid.bid);
    if (!b) { v.raid = null; return; }
    const c = this.bCenter(b);
    this.setTask(v, 'Looking for something to eat', [
      { walk: this.goalBuilding(b) }, { face: [c.x, c.z] },
      { act: 4, anim: 'gather', done: () => this.raidDone(v, b) },
    ]);
  },
  raidDone(v, b) {
    const s = this.s; v.raid = null;
    if (!this.bById.has(b.id)) return;
    if (b.type === 'farm' && b.data) { b.data.grow = Math.max(0, (b.data.grow || 0) - 0.25); this.emit('farm', b); }
    v.hunger = 0; v.hungry = false; v.foodThefts = (v.foodThefts || 0) + 1;
    const what = { farm: 'pulled up half a row of the crops', orchard: 'filled their pockets with apples', coop: 'snuck a few eggs', beehive: 'dipped into the honey', dairy: 'helped themselves to the milk' }[b.type] || 'helped themselves';
    const F = v.name.split(' ')[0];
    const seen = s.villagers.find(o => o !== v && (['guard', 'constable'].includes(o.job) || o.cls === 'paladin') && !o.asleep && Math.hypot(o.x - v.x, o.z - v.z) < 9);
    let msg = `Hungry and desperate, ${F} ${what} at the ${b.type === 'farm' ? 'fields' : b.type}.`;
    const KIND = ['let them off with a loaf of bread', 'sent them home with a bowl of soup', 'gave them a stern word and an apple', 'shared their own lunch with them', 'made them promise to ask next time'];
    if (seen) {
      const house = v.foodThefts >= 3 && s.buildings.find(o => o.type === 'watchhouse' && o.built && o.sid === v.home);
      if (house) { v.jail = s.time + 60; v.jailHouse = house.id; msg += ` ${seen.name.split(' ')[0]} caught them again: an hour in the stocks.`; }
      else {
        msg += ` ${seen.name.split(' ')[0]} caught them, and ${KIND[(v.id + v.foodThefts) % KIND.length]}.`;
        // the same kind-hearted catcher, the same day: one entry that counts them up
        const top = s.story?.[0], day = Math.floor(s.time / DAY);
        if (top?.raidBy === seen.id && Math.floor(top.t / DAY) === day) {
          top.raids = (top.raids || 1) + 1; top.t = s.time; top.n = s.storyN = (s.storyN || 0) + 1;
          top.text = `Hungry neighbours kept raiding the fields and coops today. ${seen.name.split(' ')[0]} caught ${top.raids} of them, and sent each home with something to eat.`;
          if (!top.faces.some(f => f.id === v.id) && top.faces.length < 6) top.faces.push({ id: v.id, name: v.name, skin: v.skin, hair: v.hair, shirt: v.shirt, hat: v.hat, hatColor: v.hatColor, race: v.race, horn: v.horn });
          this.log(msg); this.emit('float', v.x, v.z, 'Munch', 'apple'); return;
        }
      }
    } else if (v.foodThefts >= 2) this.addWanted?.(v, 'Stealing food', true);
    this.log(msg);
    const e = this.story('crime', msg, seen ? [v, seen] : [v], 'apple'); if (seen && e) e.raidBy = seen.id;
    this.emit('float', v.x, v.z, 'Munch', 'apple');
  },
  // ── wanted posters ──
  // An escaped culprit gets a poster: a "?" silhouette until a constable, rogue or paladin works out
  // who it was, then their face. Watchers who spot a known culprit catch them. A bounty doubles both.
  addWanted(v, crime, known) {
    const c = this.s.crime, W = c.wanted;
    let p = W.find(o => o.vid === v.id && !o.caught);
    if (!p) {
      if (W.filter(o => !o.caught).length >= 6) { const old = [...W].reverse().find(o => !o.caught); W.splice(W.indexOf(old), 1); }
      p = { id: ++c.pid, vid: v.id, name: v.name, face: { id: v.id, name: v.name, skin: v.skin, hair: v.hair, shirt: v.shirt, hat: false, race: v.race, horn: v.horn },
        crimes: [], known: false, bounty: 0, since: this.s.time, sid: v.home, caught: false };
      W.unshift(p);
    }
    p.crimes.push(crime); p.since = this.s.time;
    const m = /([0-9]+) coins/.exec(crime); if (m) p.loot = (p.loot || 0) + +m[1];
    if (known && !p.known) this.identify(p, null);
    return p;
  },
  identify(p, by) {
    p.known = true; p.knownAt = this.s.time;
    const v0 = this.vById.get(p.vid);
    if (v0 && this.bumpAffinity) for (const o of this.s.villagers.filter(o => o !== v0 && o.home === v0.home && o.age >= 14).slice(0, 5)) this.bumpAffinity(v0, o, -6);
    const v = this.vById.get(p.vid), msg = by ? `${by.name} worked out who it was: ${p.name} is wanted for ${p.crimes[0].toLowerCase()}.` : `A witness saw the culprit: ${p.name} is wanted for ${p.crimes[0].toLowerCase()}.`;
    this.log(msg); this.story('wanted', msg, by ? [v, by] : [v], 'alert');
  },
  bountyCost(p) { return Math.min(300, Math.max(20, Math.round((p?.loot || 0) * 0.5))); },
  postBounty(p) {
    const cost = this.bountyCost(p);
    if (!p || p.caught || p.bounty || this.s.res.coins < cost) return false;
    this.s.res.coins -= cost; this.track('coins', -cost); p.bounty = cost; this.emit('res');
    return true;
  },
  wantedSecond() {
    const s = this.s, W = s.crime.wanted;
    for (const p of [...W]) {
      const v = this.vById.get(p.vid);
      if (!v) { W.splice(W.indexOf(p), 1); continue; }
      if (p.caught) { if (s.time - p.caughtAt > DAY) W.splice(W.indexOf(p), 1); continue; }
      const k = p.bounty ? 2 : 1, watchers = s.villagers.filter(o => o !== v && o.home === p.sid && stageOf(o) === 'adult' && !o.asleep && !o.quest
        && (['guard', 'constable'].includes(o.job) || ['rogue', 'paladin'].includes(o.cls)));
      if (!p.known) {
        // the trail: a little digging every 20 s; it goes cold after three days
        if ((s.time | 0) % 20 === 0) { const sleuth = watchers.find(o => o.job === 'constable' || o.cls === 'rogue') || watchers[0]; if (sleuth && this.rng() < 0.12 * k) this.identify(p, sleuth); }
        if (s.time - p.since > DAY * 3) { W.splice(W.indexOf(p), 1); this.log('The trail of the night thief went cold.'); }
        continue;
      }
      if (s.time - (p.knownAt || p.since) > DAY * 4) { W.splice(W.indexOf(p), 1); this.log(`${p.name} made amends, and the poster came down.`); continue; }
      if (v.jail > s.time || v.quest || v.asleep || v.indoors) continue;
      const seen = watchers.find(o => Math.hypot(o.x - v.x, o.z - v.z) < 6);
      if (seen && this.rng() < 0.08 * k) {
        p.caught = true; p.caughtAt = s.time; this.dropTask(v); v.sneak = null; v.raid = null;
        const house = s.buildings.find(b => b.type === 'watchhouse' && b.built && b.sid === v.home);
        if (house) { const morning = (Math.floor(s.time / DAY) + (this.dayFrac() > 0.5 ? 1 : 0)) * DAY + DAY * 0.42; v.jail = Math.max(s.time + 40, morning); v.jailHouse = house.id; }
        s.crime.caught++;
        const msg = `Wanted no more: ${seen.name} caught ${p.name}${house ? ', who is off to the stocks' : ''}.`;
        this.log(msg); this.story('wanted', msg, [v, seen], 'shield');
        this.emit('float', v.x, v.z, 'Caught!', 'shield');
      }
    }
  },
  wantedOf(v) { return this.s.crime.wanted.find(p => p.vid === v.id && p.known && !p.caught) || null; },
  crimeLog(msg) { const L = this.s.crime.log; L.unshift({ msg, t: this.s.time }); if (L.length > 8) L.pop(); },
  // the stocks in front of the Watch House
  taskStocks(v) {
    const b = this.bById.get(v.jailHouse);
    if (!b) { v.jail = 0; return this.taskSleep(v); }
    const p = this.local(b, 0.45, 0.5), out = this.local(b, 0.45, 4);   // head through the stocks' boards (watchhouse model)
    this.setTask(v, 'In the stocks', [
      { walk: this.goalBuilding(b) }, { to: [p.x, p.z] }, { face: [out.x, out.z] },
      { act: 9999, anim: 'rest', until: () => !(v.jail > this.s.time), start: () => { v.act.idle = true; } },
    ]);
  },
  // constables walk between the village's public places, with a lantern after dark
  taskConstable(v, b) {
    const stops = this.s.buildings.filter(o => o.built && o.sid === b.sid
      && ['campfire', 'market', 'storehouse', 'park', 'pub', 'bathhouse', 'theatre', 'townhall'].includes(o.type));
    v.patrolStep = (v.patrolStep || 0) + 1;
    const stop = stops.length ? stops[(v.id + v.patrolStep) % stops.length] : b;
    const c = this.bCenter(stop);
    this.setTask(v, this.isNight() ? 'On night patrol' : 'Keeping the peace', [
      { walk: this.goalBuilding(stop) }, { face: [c.x, c.z] },
      { act: 6, anim: 'rest', done: () => { if (this.bById.has(b.id) && v.work === b.id) this.repeat(v); } },
    ]);
  },
};
