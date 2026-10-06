// Per-settlement stockpiles, trade carts and trade routes. Sim-side only.
//
// How it fits the existing economy: `s.res` stays the village-wide total, so the
// HUD, every cost check made from the UI and all older code keep working. On
// top of it a ledger, `s.stock[sid][good]`, records which settlement's store
// each physical (storable) good actually sits in:
//   · production lands in the store of the settlement where it happened, up to
//     that settlement's own storage (its campfire + storehouses);
//   · work inside a settlement (sawmills, bakeries, the forge…) can only use
//     what that settlement has in its own store;
//   · building materials paid from another settlement's store must be hauled
//     to the site by cart before the builders can start;
//   · trade routes ("send surplus wood from Pinehollow to Meadowbrook") are run
//     by the carts of Trade Posts, along the roads.
// Every change to `s.res` is attributed to a settlement after the fact (the
// villager whose step caused it, the site being paid for, or the settlement the
// player is looking at), so code that writes `s.res` directly stays correct.
//   invariant: s.res[k] = Σ s.stock[*][k] + goods on carts running a trade route
import { GOODS, SETTLEMENTS } from './data.js';
import { N, idx, tileX, tileZ, toWorld, toTile, inMap, CENTERS } from './world.js';
import { storageOf, lvlOf, defOf, isDecor } from './sim.js';
import { cartCost } from './roads.js';
import { boardIfHop, rideFerry } from './island.js';

export const CART_SPEED = { post: 2.1, porter: 1.3 };
export const cartCapacity = lvl => 30 + 20 * lvl;
// which goods count toward a job's specialty bonus
const PRODUCT = { woodcutter: ['wood'], miner: ['stone'], fisher: ['food'], farmer: ['grain', 'food'] };
export const specOf = sid => SETTLEMENTS.find(o => o.id === sid)?.spec || null;

export function installTrade(sim) {
  const s = sim.s, W = sim.world;
  const PHYS = Object.keys(GOODS).filter(k => GOODS[k].capped);
  const T = s.trade || (s.trade = { rules: [], carts: [], nextId: 1 });
  T.rules ||= []; T.carts ||= []; T.nextId ||= 1;
  const L = sim.ledger = { v: null, vctx: undefined, force: null, focus: 'meadow', tot: {}, pend: {}, radii: {}, caps: {}, PHYS };
  const sids = () => Object.keys(s.unlocked);
  const st = sid => (s.stock[sid] ||= {});
  const get = (sid, k) => s.stock[sid]?.[k] || 0;
  const cap = sid => L.caps[sid] ?? 0;
  const room = (sid, k) => Math.max(0, cap(sid) - get(sid, k));
  const cdist = (a, b) => { const p = CENTERS[a], q = CENTERS[b]; return p && q ? Math.hypot(p.x - q.x, p.z - q.z) : 999; };
  const others = sid => sids().filter(o => o !== sid).sort((a, b) => cdist(sid, a) - cdist(sid, b));
  const home = () => (s.unlocked[L.focus] ? L.focus : s.unlocked.meadow ? 'meadow' : sids()[0]);

  function refresh() {
    for (const sid of sids()) { st(sid); L.radii[sid] = sim.settlementRadius(sid); L.caps[sid] = 0; }
    for (const b of s.buildings) if (b.built && b.sid && L.caps[b.sid] !== undefined) L.caps[b.sid] += storageOf(b);
  }
  // which settlement a world position belongs to
  function sidAt(x, z) {
    const tx = toTile(x), tz = toTile(z);
    let best = null, bd = 1e9;
    for (const sid of sids()) {
      const c = CENTERS[sid]; if (!c) continue;
      const d = Math.hypot(tx + 0.5 - c.x, tz + 0.5 - c.z);
      if (d <= (L.radii[sid] ?? 0) && d < bd) { bd = d; best = sid; }
    }
    return best;
  }
  function nearestSid(x, z) {
    let best = home(), bd = 1e9;
    for (const sid of sids()) { const c = CENTERS[sid]; if (!c) continue; const d = Math.hypot(toWorld(c.x) - x, toWorld(c.z) - z); if (d < bd) { bd = d; best = sid; } }
    return best;
  }
  const ctxOf = v => sidAt(v.x, v.z) || (v.work && sim.bById.get(v.work)?.sid) || (s.unlocked[v.home] ? v.home : null) || home();
  const cur = () => L.force || (L.v ? (L.vctx ??= ctxOf(L.v)) : null);

  // put n of good k into sid's store; whatever won't fit spills to the nearest store with room
  function give(sid, k, n) {
    if (!(n > 0)) return;
    let left = n;
    for (const o of [sid, ...others(sid)]) {
      const put = Math.min(left, room(o, k));
      if (put > 0) { st(o)[k] = get(o, k) + put; left -= put; }
      if (left <= 1e-9) return;
    }
    st(sid)[k] = get(sid, k) + left;    // nowhere has room: it piles up here
  }
  // take n of good k: from sid first, then the nearest stores (or evenly when sid is null)
  function take(sid, k, n) {
    const got = {}; let left = n;
    const pull = (o, want) => { const t = Math.min(get(o, k), want); if (t > 0) { st(o)[k] = get(o, k) - t; got[o] = (got[o] || 0) + t; left -= t; } };
    if (sid) { pull(sid, left); for (const o of others(sid)) if (left > 1e-9) pull(o, left); }
    else {
      const all = sids(), sum = all.reduce((a, o) => a + get(o, k), 0);
      if (sum > 0) { const want = Math.min(left, sum); for (const o of all) pull(o, want * get(o, k) / sum); }
      for (const o of all.sort((a, b) => get(b, k) - get(a, k))) if (left > 1e-9) pull(o, left);
    }
    // last resort: goods already rolling along a trade route
    for (const c of T.carts) { if (left <= 1e-9) break; const have = !c.paid && c.load?.[k] || 0; if (have > 0) { const t = Math.min(have, left); c.load[k] = have - t; left -= t; } }
    return got;
  }
  // attribute every change to s.res since the last look
  function settle(ctx) {
    for (const k of PHYS) {
      const r = s.res[k] || 0, d = r - (L.tot[k] ?? r);
      L.tot[k] = r;
      if (Math.abs(d) < 1e-9) continue;
      if (d > 0) give(ctx || home(), k, d); else take(ctx, k, -d);
    }
  }
  const changed = () => { for (const k of PHYS) if ((s.res[k] || 0) !== L.tot[k]) return true; return false; };
  const transit = k => T.carts.reduce((a, c) => a + (!c.paid && c.load?.[k] || 0), 0);
  // safety net: keep Σ stores + carts equal to the total
  function reconcile() {
    for (const k of PHYS) {
      const sum = sids().reduce((a, o) => a + get(o, k), 0) + transit(k), d = (s.res[k] || 0) - sum;
      if (d > 0.5) give(home(), k, d); else if (d < -0.5) take(null, k, -d);
      L.tot[k] = s.res[k] || 0;
    }
  }

  // ── first load: share the old village-wide stock out between the stores ──
  const fresh = !s.stock;
  s.stock ||= {};
  refresh();
  if (fresh) {
    for (const k of PHYS) give(s.unlocked.meadow ? 'meadow' : home(), k, s.res[k] || 0);
    if (sids().length > 1) s.stockNote = true;       // the UI explains the change once
  }
  for (const k of PHYS) L.tot[k] = s.res[k] || 0;
  reconcile();

  // ── hooks into the sim ──
  const tick = sim.tick.bind(sim);
  sim.tick = dt => { settle(null); tick(dt); };
  const second = sim.second.bind(sim);
  sim.second = () => {
    L.v = null; settle(null); refresh();
    second();
    settle(null);
    if (((s.time | 0) % 2) === 0) dispatch();
    syncCarts(); reconcile();
  };
  const stepV = sim.stepVillager;
  sim.stepVillager = (v, dt) => {
    L.v = v; L.vctx = undefined; L.pend = {};
    stepV(v, dt);
    if (changed()) settle(cur());
    L.v = null;
  };
  // work inside a settlement uses that settlement's store
  const afford = sim.canAfford.bind(sim);
  sim.canAfford = cost => {
    if (!afford(cost)) return false;
    if (!L.v && !L.force) return true;
    const sid = cur();
    return Object.entries(cost || {}).every(([k, n]) => !PHYS.includes(k) || get(sid, k) >= n);
  };
  // production: specialty bonus, pearls, and the local store's room
  const add = sim.add.bind(sim);
  sim.add = (res, n, track = true) => {
    const v = L.v;
    if (v && n > 0) {
      const sid = cur(), sp = specOf(sid);
      if (sp && sp.job === v.job && PRODUCT[v.job]?.includes(res)) n = Math.round(n * sp.mult);
      if (sp?.pearls && v.job === 'fisher' && res === 'food' && sim.rng() < 0.12) {
        s.res.gems += 1; s.stats.pearls = (s.stats.pearls || 0) + 1;
        sim.emit('float', v.x, v.z - 0.6, 'Pearl!', 'gem');
      }
      // up in the mountains a miner's stone often comes with a lump or two of iron ore
      if (sp?.ore && v.job === 'miner' && res === 'stone' && sim.rng() < 0.35) {
        const got = sim.add('ore', 1 + (sim.rng() < 0.25 ? 1 : 0));
        if (got) sim.emit('float', v.x, v.z - 0.6, `+${got} iron ore`, 'ore');
      }
      if (GOODS[res]?.capped) {
        const r = Math.max(0, Math.floor(room(sid, res) - (L.pend[res] || 0)));
        if (n > r) {
          n = r;
          const b = v.work && sim.bById.get(v.work);
          if (b && b.sid === sid) b.status = 'Storage full';
        }
      }
    }
    const got = add(res, n, track);
    if (v && got > 0) L.pend[res] = (L.pend[res] || 0) + got;
    return got;
  };
  // construction: materials from another settlement's store wait for a cart
  function construct(b) {
    const sid = b.sid || home(), paid = {};
    for (const k of PHYS) { const d = (L.tot[k] ?? 0) - (s.res[k] || 0); L.tot[k] = s.res[k] || 0; if (d > 0) paid[k] = d; }
    const site = !isDecor(b.type) && (!b.built || b.up);
    for (const [k, n] of Object.entries(paid)) {
      const got = take(sid, k, n);
      if (!site) continue;
      for (const [src, m] of Object.entries(got)) {
        if (src === sid || m < 0.5) continue;
        (b.await ||= []).push({ res: k, n: Math.round(m), from: src, cart: null });
      }
    }
    if (b.await?.length) {
      const from = [...new Set(b.await.map(e => sim.sname(e.from)))].join(' and ');
      sim.log(`The ${defOf(b.type).name} in ${sim.sname(sid)} is waiting for materials from ${from}.`);
      sim.emit('toast', `Materials for the ${defOf(b.type).name} are coming by cart from ${from}`, 'wood');
      dispatch();
    }
  }
  const place = sim.place.bind(sim);
  sim.place = (type, tx, tz, rot) => {
    settle(null);
    const r = place(type, tx, tz, rot);
    if (r.ok && r.b) {
      construct(r.b);
      const pl = s.stats.placed || (s.stats.placed = {}); pl[type] = (pl[type] || 0) + 1;
    }
    return r;
  };
  const upgrade = sim.upgrade.bind(sim);
  sim.upgrade = b => { settle(null); const ok = upgrade(b); if (ok) construct(b); return ok; };
  const demolish = sim.demolish.bind(sim);
  sim.demolish = b => {
    settle(null);
    const pend = !b.built ? (b.await || []) : [];
    demolish(b);
    for (const k of PHYS) {
      let d = (s.res[k] || 0) - (L.tot[k] ?? 0); L.tot[k] = s.res[k] || 0;
      if (d <= 0) { if (d < 0) take(b.sid, k, -d); continue; }
      for (const e of pend) if (e.res === k && d > 0) { const m = Math.min(d, e.n); give(e.from, k, m); d -= m; }
      give(b.sid || home(), k, d);
    }
    for (const c of T.carts) if (c.job?.bid === b.id) { c.load = {}; goHome(c); }
  };
  const effect = sim.upgradeEffect.bind(sim);
  sim.upgradeEffect = b => b.type === 'tradepost' ? `+1 cart, +20 goods a load` : effect(b);
  const isSite = sim.isSite.bind(sim);
  sim.isSite = b => isSite(b) && !b.await?.length;
  const unlock = sim.unlock.bind(sim);
  sim.unlock = (sid, free) => { settle(null); const ok = unlock(sid, free); if (ok) { refresh(); settle(sid); } return ok; };
  const openChest = sim.openChest.bind(sim);
  sim.openChest = id => { settle(null); L.force = s.chests.find(o => o.id === id)?.sid || null; const r = openChest(id); settle(L.force); L.force = null; return r; };
  const deal = sim.merchantDeal.bind(sim);
  sim.merchantDeal = k => { settle(null); L.force = s.unlocked.meadow ? 'meadow' : null; const r = deal(k); settle(L.force); L.force = null; return r; };

  // ── carts ──
  const tradePosts = () => s.buildings.filter(b => b.type === 'tradepost' && b.built);
  function dropTile(sid) {
    const b = tradePosts().find(o => o.sid === sid) || s.buildings.find(o => o.type === 'campfire' && o.sid === sid);
    if (!b) { const c = CENTERS[sid]; return idx(c.x, c.z + 2); }
    const [ex, ez] = sim.entryTile(b);
    return inMap(ex, ez) ? idx(ex, ez) : idx(b.tx, b.tz);
  }
  function newCart(kind, base, homeId) {
    const t = dropTile(base);
    const c = { id: T.nextId++, kind, base, home: homeId, x: toWorld(tileX(t)), z: toWorld(tileZ(t)), face: 0, state: 'idle', leg: null, job: null, path: null, i: 0, load: {}, fail: 0 };
    T.carts.push(c); return c;
  }
  function syncCarts() {
    for (const b of tradePosts()) {
      const mine = T.carts.filter(c => c.home === b.id);
      for (let k = mine.length; k < lvlOf(b); k++) { newCart('post', b.sid, b.id); }
    }
    T.carts = T.carts.filter(c => {
      const ok = c.kind === 'porter' || sim.bById.has(c.home);
      if (!ok && c.state === 'idle') { sim.emit('cartGone', c); return false; }
      if (!ok) c.orphan = true;
      return true;
    });
  }
  function plan(c, tile, goal) {
    let start = idx(Math.max(0, Math.min(N - 1, toTile(c.x))), Math.max(0, Math.min(N - 1, toTile(c.z))));
    if (!W.passable(start)) { const e = sim.nearestPassable(start); if (e >= 0) start = e; }
    W.costHook = cartCost(W);
    let path = null;
    try { path = W.findPath(start, tileX(tile), tileZ(tile), goal || (i => i === tile), 20000); } finally { W.costHook = null; }
    c.path = path; c.i = 1; c.state = 'move';
    if (!path) { c.fail = (c.fail || 0) + 1; c.state = 'stuck'; c.retry = 3; }
    else c.fail = 0;
  }
  function goHome(c) {
    c.leg = 'return'; c.job = c.job ? { ...c.job, done: true } : null;
    plan(c, dropTile(c.base));
  }
  function freeCart(from, kind = 'post') {
    const list = T.carts.filter(c => c.kind === kind && c.state === 'idle' && !c.orphan);
    const c0 = CENTERS[from];
    list.sort((a, b) => Math.hypot(a.x - toWorld(c0.x), a.z - toWorld(c0.z)) - Math.hypot(b.x - toWorld(c0.x), b.z - toWorld(c0.z)));
    return list[0] || null;
  }
  function start(c, job) {
    c.job = job; c.leg = 'pickup'; c.load = {}; c.paid = job.type === 'site';
    plan(c, dropTile(job.from));
  }
  function dispatch() {
    // building materials first
    for (const b of s.buildings) {
      if (!b.await?.length) continue;
      const bySrc = {};
      for (const e of b.await) if (!e.cart) (bySrc[e.from] ||= []).push(e);
      for (const [from, list] of Object.entries(bySrc)) {
        if (!s.unlocked[from]) { for (const e of list) e.cart = -1; continue; }
        let c = freeCart(from);
        if (!c && !T.carts.some(o => o.kind === 'porter' && o.base === from)) c = newCart('porter', from, null);
        if (!c) continue;
        for (const e of list) e.cart = c.id;
        start(c, { type: 'site', bid: b.id, from, to: b.sid });
      }
      // sources that no longer exist: the goods arrive by the back roads
      b.await = b.await.filter(e => e.cart !== -1);
      if (!b.await.length) delete b.await;
    }
    // then the player's trade routes
    for (const r of T.rules) {
      if (!r.on || !s.unlocked[r.from] || !s.unlocked[r.to] || r.from === r.to) continue;
      if (T.carts.some(c => c.job?.rule === r.id && !c.job.done)) continue;
      const surplus = get(r.from, r.res) - r.keep, space = room(r.to, r.res);
      if (surplus < 10 || space < 10) continue;
      const c = freeCart(r.from); if (!c) continue;
      start(c, { type: 'rule', rule: r.id, from: r.from, to: r.to, res: r.res });
    }
  }
  function arrive(c) {
    const job = c.job;
    if (c.leg === 'pickup') {
      if (job.type === 'site') {
        const b = sim.bById.get(job.bid);
        if (!b?.await) return goHome(c);
        for (const e of b.await) if (e.cart === c.id) c.load[e.res] = (c.load[e.res] || 0) + e.n;
        c.leg = 'deliver'; c.path = null;
        const [ex, ez] = sim.entryTile(b);
        plan(c, idx(ex, ez), sim.adjGoal(b));
      } else {
        const r = T.rules.find(o => o.id === job.rule);
        const lvl = lvlOf(sim.bById.get(c.home) || { lvl: 1 });
        const n = r ? Math.floor(Math.min(cartCapacity(lvl), get(job.from, job.res) - r.keep, room(job.to, job.res))) : 0;
        if (n < 1) return goHome(c);
        st(job.from)[job.res] = get(job.from, job.res) - n;
        c.load = { [job.res]: n };
        c.leg = 'deliver';
        plan(c, dropTile(job.to));
      }
      return;
    }
    if (c.leg === 'deliver') {
      const amount = Object.values(c.load).reduce((a, n) => a + n, 0), [k0] = Object.keys(c.load);
      if (job.type === 'site') {
        const b = sim.bById.get(job.bid);
        if (b?.await) {
          b.await = b.await.filter(e => e.cart !== c.id);
          if (!b.await.length) {
            delete b.await;
            sim.log(`Materials arrived at the ${defOf(b.type).name} in ${sim.sname(b.sid)}.`);
            sim.emit('toast', `Materials delivered! Building the ${defOf(b.type).name} can begin.`, 'hammer');
            sim.emit('building', b);
          }
        }
      } else for (const [k, n] of Object.entries(c.load)) st(job.to)[k] = get(job.to, k) + n;
      if (amount > 0 && k0) sim.emit('float', c.x, c.z, `+${Math.round(amount)}`, GOODS[k0].icon);
      s.stats.hauls = (s.stats.hauls || 0) + 1;
      c.load = {};
      sim.emit('sfx', 'coin');
      return goHome(c);
    }
    // home again
    c.state = 'idle'; c.leg = null; c.job = null; c.path = null;
    if (c.kind === 'porter' || c.orphan) { T.carts = T.carts.filter(o => o !== c); sim.emit('cartGone', c); }
  }
  function moveCart(c, dt) {
    if (c.state === 'stuck') {
      if ((c.retry -= dt) > 0) return;
      if (c.fail > 3) {
        // no way through at all: settle the job as if it arrived
        const t = c.leg === 'pickup' ? dropTile(c.job?.from || c.base) : c.leg === 'deliver' && c.job?.type === 'site' ? (() => { const b = sim.bById.get(c.job.bid); return b ? idx(...sim.entryTile(b)) : dropTile(c.base); })() : dropTile(c.job?.to || c.base);
        c.x = toWorld(tileX(t)); c.z = toWorld(tileZ(t)); c.fail = 0;
        return arrive(c);
      }
      const t = c.leg === 'pickup' ? dropTile(c.job.from) : c.leg === 'return' ? dropTile(c.base) : c.job.type === 'site' ? null : dropTile(c.job.to);
      if (t === null) { const b = sim.bById.get(c.job.bid); if (!b) return goHome(c); const [ex, ez] = sim.entryTile(b); return plan(c, idx(ex, ez), sim.adjGoal(b)); }
      return plan(c, t);
    }
    if (c.state !== 'move' || !c.path) return;
    c.moving = false;
    if (c.ferry) { const dest = c.ferry.dest; if (rideFerry(sim, c, dt)) { const k = c.path.indexOf(dest); c.i = k + 1; } return; }
    if (c.i >= c.path.length) return arrive(c);
    const ti = c.path[c.i], tx = toWorld(tileX(ti)), tz = toWorld(tileZ(ti));
    const cur = idx(Math.max(0, Math.min(N - 1, toTile(c.x))), Math.max(0, Math.min(N - 1, toTile(c.z))));
    const sp = CART_SPEED[c.kind] * (W.paved[cur] ? 1.45 : W.road[cur] || W.bridge[cur] ? 1.3 : 0.85) * ((s.hasteUntil || 0) > s.time ? 1.35 : 1);
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz), step = sp * dt;
    if (d > 1e-4) c.face = Math.atan2(dx, dz);
    c.moving = true;
    if (d <= step) { c.x = tx; c.z = tz; c.i++; if (c.i < c.path.length) boardIfHop(sim, c, c.path[c.i - 1], c.path[c.i]); }
    else { c.x += dx / d * step; c.z += dz / d * step; }
  }
  const tick2 = sim.tick;
  sim.tick = dt => { tick2(dt); for (const c of [...T.carts]) moveCart(c, dt); };
  syncCarts();

  // ── what the UI needs ──
  sim.trade = {
    PHYS, get, cap, room, sidAt, nearestSid, transit, specOf,
    // Purchases, fuel and crime consume only the named settlement's stock.
    consume(sid, k, n) {
      settle(cur());
      if (!(n > 0) || !PHYS.includes(k) || get(sid, k) < n) return false;
      st(sid)[k] -= n; s.res[k] -= n; L.tot[k] = s.res[k];
      sim.track(k, -n); sim.emit('res'); return true;
    },
    deposit(sid, k, n) {
      settle(cur());
      if (!(n > 0) || !PHYS.includes(k) || !s.unlocked[sid]) return 0;
      const got = Math.min(n, Math.max(0, Math.floor(room(sid, k))));
      st(sid)[k] += got; s.res[k] += got; L.tot[k] = s.res[k];
      sim.track(k, got); sim.emit('res'); return got;
    },
    stockOf: sid => ({ ...(s.stock[sid] || {}) }),
    carts: () => T.carts, rules: () => T.rules,
    addRule(from, to, res, keep = 100) {
      const r = { id: T.nextId++, from, to, res, keep: Math.max(0, Math.round(keep)), on: true };
      T.rules.push(r); dispatch(); return r;
    },
    setRule(id, patch) { const r = T.rules.find(o => o.id === id); if (r) Object.assign(r, patch); },
    removeRule(id) { T.rules = T.rules.filter(o => o.id !== id); for (const c of T.carts) if (c.job?.rule === id && c.leg === 'pickup') goHome(c); },
    // a cart's job in words
    describe(c) {
      const sn = sid => sim.sname(sid), load = Object.entries(c.load || {}).filter(([, n]) => n > 0).map(([k, n]) => `${Math.round(n)} ${GOODS[k].name.toLowerCase()}`).join(', ');
      if (c.state === 'idle') return `Waiting at ${sn(c.base)}`;
      if (c.ferry) return c.ferry.state === 'wait' ? 'Waiting for the ferry' : 'Crossing on the ferry';
      if (c.state === 'stuck') return 'Looking for a way through';
      const site = c.job?.type === 'site' ? sim.bById.get(c.job.bid) : null;
      if (c.leg === 'pickup') return `Heading to ${sn(c.job.from)} to load ${site ? 'building materials' : GOODS[c.job.res].name.toLowerCase()}`;
      if (c.leg === 'deliver') return `Hauling ${load || 'goods'} to ${site ? `the ${defOf(site.type).name} in ${sn(site.sid)}` : sn(c.job.to)}`;
      return `Returning to ${sn(c.base)}`;
    },
    settle, refresh,
    settleAt(i) { settle(sidAt(toWorld(tileX(i)), toWorld(tileZ(i))) || nearestSid(toWorld(tileX(i)), toWorld(tileZ(i)))); },
  };
}
