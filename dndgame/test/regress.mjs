// Playwright is not a dependency of this repo; point PLAYWRIGHT at your install
// if it is not on the default global path.
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errs=[]; page.on('pageerror',e=>errs.push(String(e.stack||e))); page.on('console',m=>{if(m.type()==='error')errs.push('C:'+m.text());});
// Every module the browser actually asks for, so we can prove the import map in
// index.html is being honoured rather than silently ignored.
const asked = [];
page.on('request', (r) => { const u = r.url(); if (/\/src\/.*\.js(\?|$)/.test(u)) asked.push(u); });
const R = [];
const check = (name, ok, detail) => R.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
// GAME lets the same suite run against a copy of the game at another path, so a
// duplicate deployed to dodge a stale CDN is proved working rather than assumed.
const GAME = process.env.GAME || 'dndgame';
await page.goto(`${BASE}/${GAME}/index.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
check('boots with no errors', errs.length === 0, errs[0] || '');

// --- cache busting ---------------------------------------------------------
// A relative import does not inherit the query string of the module importing
// it, so a deploy can otherwise leave a browser running some modules from the
// new build and some from the old. index.html carries an import map pinning
// every module to a hash of its contents; these two checks are the difference
// between having written that map and having it actually take effect.
{
  const bare = asked.filter((u) => !/\?v=[0-9a-f]{8}$/.test(u));
  check('cache: every module is fetched content-hashed', bare.length === 0 && asked.length > 20,
    bare.length ? `unstamped: ${bare[0]}` : `${asked.length} modules`);

  const { spawnSync } = await import('node:child_process');
  // stamp.mjs owns dndgame/; a copy at another path carries the map it was copied with.
  const r = spawnSync(process.execPath, [new URL('../tools/stamp.mjs', import.meta.url).pathname, '--check'],
    { encoding: 'utf8' });
  check('cache: index.html import map is up to date', r.status === 0,
    (r.stderr || r.stdout || '').trim().split('\n')[0]);
}
await page.mouse.click(450,280); await page.waitForTimeout(400);

// --- char creation stash ---------------------------------------------------
const cc = await page.evaluate(() => {
  SC.newGame();
  const s = SC.Game.top;
  s.setClass('wizard');
  s.draft.skills = ['arcana','history'];
  s.draft.picks = { cantrip: ['fire-bolt'], spell1: ['magic-missile'] };
  const before = JSON.stringify([s.draft.skills, s.draft.picks]);
  s.setClass('rogue'); s.setClass('fighter'); s.setClass('wizard');
  const after = JSON.stringify([s.draft.skills, s.draft.picks]);
  s.setClass('cleric');
  const clean = s.draft.skills.length === 0 && Object.keys(s.draft.picks).length === 0;
  s.setClass('wizard');
  return { preserved: before === after, clean, restored: JSON.stringify([s.draft.skills, s.draft.picks]) === before };
});
check('charcreate: browsing classes preserves picks', cc.preserved);
check('charcreate: a fresh class starts clean', cc.clean);
check('charcreate: returning restores the stash', cc.restored);

const fb = await page.evaluate(() => {
  const s = SC.Game.top;
  s.warn('nope', 'next', 3);
  const shook = s.shakeX('next') !== 0 || s.shakeT > 0;
  const gap = s.firstIncomplete();
  return { shook, blamed: s.blameStep === 3, gap, locked: s.lockedReason(6).length > 0 };
});
check('charcreate: a refusal shakes and blames a step', fb.shook && fb.blamed);
check('charcreate: locked steps explain themselves', fb.locked);

// --- into the world --------------------------------------------------------
// "Randomise everything" must hand back a sheet the wizard will actually
// finish. It used to fill only the CLASS skill bucket, so any species trait or
// origin feat that added a second one left the player on a page they had never
// visited, with a CREATE button that refused.
const roll = await page.evaluate(() => {
  const out = [];
  for (let i = 0; i < 12; i++) {
    while (SC.Game.top && SC.Game.top.id === 'charcreate') SC.Game.pop();
    SC.newGame();
    const s = SC.Game.top;
    s.randomiseAll();
    const gap = s.firstIncomplete();
    if (gap >= 0) out.push(s.constructor.name + ' step ' + gap + ': ' + s.issue(gap));
  }
  while (SC.Game.top && SC.Game.top.id === 'charcreate') SC.Game.pop();
  return out;
});
check('charcreate: a randomised character is always complete', roll.length === 0, roll[0] || '12 rolls');

// start a clean wizard: the stash above holds deliberately bogus picks
await page.evaluate(() => {
  while (SC.Game.top && SC.Game.top.id === 'charcreate') SC.Game.pop();
  SC.newGame();
  const s = SC.Game.top;
  s.randomiseAll(); s.setClass('wizard'); s.draft.name='Reg'; s._autoFillPicks(); s.finish();
});
try {
  await page.waitForFunction(() => SC.Game.top && SC.Game.top.id === 'overworld', { timeout: 25000 });
} catch (e) {
  // A bare timeout tells you nothing; say what the wizard is actually stuck on.
  const why = await page.evaluate(() => {
    const s = SC.Game.top;
    if (!s || s.id !== 'charcreate') return 'top scene is ' + (s && s.id);
    const gap = s.firstIncomplete();
    return 'charcreate stuck on step ' + gap + ': ' + (gap >= 0 ? s.issue(gap) : s.message);
  });
  console.log('FAIL  reached the overworld  ' + why);
  console.log('page errors:', JSON.stringify(errs.slice(0, 3), null, 1));
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(500);

// --- weather never reaches the UI -----------------------------------------
const px = await page.evaluate(async () => {
  SC.FX.weather('snow', 1);
  await new Promise(r => setTimeout(r, 700));
  const m = await import('/dndgame/src/ui/menus.js');
  SC.Game.push(new m.InventoryScene());
  await new Promise(r => setTimeout(r, 500));
  // sample the top strip of the inventory panel for stray white weather motes
  const c = document.getElementById('game').getContext('2d');
  const d = c.getImageData(30, 30, 340, 60).data;
  let bright = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i+1] > 235 && d[i+2] > 245) bright++;
  SC.Game.pop();
  return { bright, layer: SC.Game.scenes.length };
});
check('weather does not fall on the inventory', px.bright === 0, `${px.bright} snow pixels`);

// --- exits and edges -------------------------------------------------------
const ow = await page.evaluate(() => {
  const s = SC.Game.top;
  const mask = s._edgeMask();
  let rimmed = 0; for (const b of mask) if (b) rimmed++;
  const exits = s._visibleExits({ x: 0, y: 0 });
  const named = s._exitName((s.map.triggers||[]).find(t => t.kind === 'warp'));
  return { rimmed, total: mask.length, named };
});
check('overworld: walkable edges are rimmed', ow.rimmed > 100, `${ow.rimmed}/${ow.total} tiles`);
check('overworld: exits resolve a destination name', !!ow.named, ow.named);

// --- casting outside combat ------------------------------------------------
const cast = await page.evaluate(() => import('/dndgame/src/rules/fieldcast.js').then(fc => {
  const ch = SC.Party.members[0];
  ch.spells.known = Array.from(new Set([...(ch.spells.known||[]), 'mage-armor','magic-missile']));
  ch.spells.prepared = Array.from(new Set([...(ch.spells.prepared||[]), 'mage-armor','magic-missile']));
  const ow = SC.Game.top;
  const env = { target: ch, party: SC.Party, state: SC.Game.state, world: ow.spellHooks() };
  const ac0 = ch.ac;
  const r = fc.fieldCast(ch, 'mage-armor', env);
  const ac1 = ch.ac;
  const burn = fc.fieldCast(ch, 'magic-missile', env);
  const slots = JSON.parse(JSON.stringify(ch.spells.slots || {}));
  // expiry
  SC.Game.state.day += 1;
  const gone = fc.expireFieldBuffs(SC.Party.all(), SC.Game.state);
  return { ac0, ac1, ok: r.ok, refused: !burn.ok, why: burn.text, slots, gone, acAfterExpiry: ch.ac,
    cond: (ch.conditions||[]).map(c=>c.id) };
}));
check('fieldcast: Mage Armor raises AC', cast.ok && cast.ac1 > cast.ac0, `${cast.ac0} -> ${cast.ac1}`);
check('fieldcast: Mage Armor is not the flat shielded condition', !cast.cond.includes('shielded'));
check('fieldcast: a damage spell is refused, no slot burnt', cast.refused && /aim it at/.test(cast.why||''), cast.why);
check('fieldcast: field buffs expire on the world clock', cast.gone.length > 0 && cast.acAfterExpiry === cast.ac0);

// --- attacking people ------------------------------------------------------
const crime = await page.evaluate(() => {
  const s = SC.Game.top;
  const child = s.entities.list.find(e => e.kind === 'npc' && e.sprite === 'npc-child');
  const adult = s.entities.list.find(e => e.kind === 'npc' && String(e.sprite||'').startsWith('npc-') && e.sprite !== 'npc-child');
  const out = { hasChild: !!child, hasAdult: !!adult };
  if (child) { s.player.setTile(child.x, child.y+1, 'up'); s.attackNPC(child); out.childBlocked = SC.Game.top.id === 'dialogue' && !SC.Game.state.crime.bounty['phandalin-hills']; while (SC.Game.top.id === 'dialogue') SC.Game.pop(); }
  return out;
});
check('crime: children cannot be attacked', crime.childBlocked !== false);

// --- the hotbar ------------------------------------------------------------
// The whole point of it: every verb the overworld has should be on screen with
// the key that does it, and none of it should need to be read in the source.
const bar = await page.evaluate(() => {
  const ow = SC.Game.top;
  const ch = SC.Party.members[0];
  ch.spells = ch.spells || {};
  ch.spells.known = Array.from(new Set([...(ch.spells.known || []), 'mage-armor', 'blade-ward']));
  ch.spells.prepared = Array.from(new Set([...(ch.spells.prepared || []), 'mage-armor']));
  ch.spells.cantrips = Array.from(new Set([...(ch.spells.cantrips || []), 'blade-ward']));
  SC.Party.addItem('potion-healing', 2);
  ow._rebuildSlots();

  const out = { slots: ow._slots.map((x) => x.name) };

  // Facing nothing: both verbs greyed, and each says why.
  ow.player.setTile(ow.map.spawn.x, ow.map.spawn.y, 'up');
  const empty = ow._hotbarModel();
  out.idleAction = { on: empty.action.enabled, why: empty.action.why };
  out.idleAttack = { on: empty.attack.enabled, why: empty.attack.why };

  // Facing a townsfolk: Talk and Attack both light up.
  const t = ow.entities.list.find((e) => e.kind === 'npc'
    && String(e.sprite || '').startsWith('npc-') && e.sprite !== 'npc-child');
  if (t) {
    ow.player.setTile(t.x, t.y + 1, 'up');
    const m = ow._hotbarModel();
    out.npcAction = { label: m.action.label, on: m.action.enabled };
    out.npcAttack = { on: m.attack.enabled };
  }

  // Facing a child: Talk lights, Attack refuses with a reason.
  const kid = ow.entities.list.find((e) => e.kind === 'npc' && e.sprite === 'npc-child');
  if (kid) {
    ow.player.setTile(kid.x, kid.y + 1, 'up');
    const m = ow._hotbarModel();
    out.childAttack = { on: m.attack.enabled, why: m.attack.why };
  }

  // Every button is hit-testable where it is drawn.
  const c = document.getElementById('game').getContext('2d');
  ow.hotbar.draw(c, ow._hotbarModel());
  out.hitRects = ow.hotbar.hot.length;
  return out;
});
check('hotbar: fills slots, longest ward first', bar.slots[0] === 'Mage Armor', bar.slots.join(', '));
check('hotbar: idle verbs grey out with a reason',
  !bar.idleAction.on && !bar.idleAttack.on && !!bar.idleAttack.why, bar.idleAttack.why);
check('hotbar: facing a townsfolk lights Talk and Attack',
  bar.npcAction && bar.npcAction.label === 'Talk' && bar.npcAction.on && bar.npcAttack.on,
  JSON.stringify(bar.npcAction));
check('hotbar: attacking a child is refused, in words',
  !bar.childAttack || (!bar.childAttack.on && !!bar.childAttack.why),
  bar.childAttack && bar.childAttack.why);
check('hotbar: every button is clickable', bar.hitRects >= 10, `${bar.hitRects} hit rects`);

// --- portrait captions -----------------------------------------------------
// The caption under a dialogue bust read `role`, an internal enum whose default
// is 'flavor' — so half the town was captioned with the word "flavor". It reads
// the authored title now, and every NPC in the game has one.
const caps = await page.evaluate(async () => {
  const ow = SC.Game.top;
  const mod = await import('/dndgame/src/ui/dialogue.js');
  const probe = new mod.DialogueScene('none', null, {});
  const rows = ow.entities.list.filter((e) => e.kind === 'npc')
    .map((e) => ({ name: e.name, caption: probe._captionFor(e) }));
  return {
    total: rows.length,
    bad: rows.filter((r) => !r.caption || /flavor|questgiver|innkeep\b/i.test(r.caption)),
    sample: rows.slice(0, 3).map((r) => `${r.name}: ${r.caption}`),
  };
});
check('dialogue: every portrait caption is prose, not an enum',
  caps.total > 0 && caps.bad.length === 0,
  caps.bad.length ? JSON.stringify(caps.bad[0]) : caps.sample[0]);

// --- the battle screen -----------------------------------------------------
const fight = await page.evaluate(async () => {
  const ow = SC.Game.top;
  for (const m of SC.Party.members) { m.maxHp = 300; m.hp = 300; }
  const t = ow.entities.list.find(e => e.kind === 'npc'
    && String(e.sprite || '').startsWith('npc-') && e.sprite !== 'npc-child');
  if (!t) return { err: 'no adult npc to fight' };
  ow.player.setTile(t.x, t.y + 1, 'up');
  ow.attackNPC(t);
  for (let i = 0; i < 200 && (!SC.Game.top || SC.Game.top.id !== 'battle'); i++) {
    await new Promise(r => setTimeout(r, 50));
  }
  const b = SC.Game.top;
  if (!b || b.id !== 'battle') return { err: 'never reached battle' };
  for (let i = 0; i < 300 && b.phase !== 'menu'; i++) await new Promise(r => setTimeout(r, 50));

  const out = { phase: b.phase };
  // Off-screen markers must be able to draw in the gutter beside the menu, not
  // under it — the whole point of them.
  const foes = b.enc.units.filter(u => u.side !== 'party');
  b._scanIndex = -1;
  b._scanFoes(1);
  out.scanHint = b.hint;
  out.scanPinned = !!b.inspectPinned;

  // The threat union must not be filtered by spent reactions.
  for (const f of foes) f._reactionUsed = true;
  b._recomputeReach(b.enc.current);
  out.threatWithSpentReactions = b.threat.size;

  // Aiming something out of range must name the creature and the reach.
  const atk = (b.options || []).find(o => o && o.kind === 'attack')
    || ((b.options || []).flatMap(o => o.sub || []).find(o => o && o.kind === 'attack'));
  if (atk) { b._explainNoTarget(b.enc.current, atk); out.noTargetHint = b.hint; }

  // A beat can be skipped.
  b.beats.push({ k: 'banner', dur: 99, text: 'x', sub: 'y' });
  b._updateBeats(0.016);
  const before = b.beats.length;
  b._skipBeat();
  b._updateBeats(0.016);
  out.skipped = b.beats.length < before;
  return out;
});
check('battle: scanning names a foe and pins the card',
  !fight.err && /\d+ft away/.test(fight.scanHint || '') && fight.scanPinned, fight.err || fight.scanHint);
check('battle: threat ignores spent reactions', (fight.threatWithSpentReactions || 0) > 0,
  `${fight.threatWithSpentReactions} tiles`);
check('battle: an unreachable target is explained', /ft/.test(fight.noTargetHint || ''), fight.noTargetHint);
check('battle: animation beats can be skipped', !!fight.skipped);

// --- an old save, missing a key ---------------------------------------------
// crimeState() only built the ledger when it was absent entirely, so a save
// written before a key existed came back truthy but partial and the next
// `cs.watchDue[region]` threw. The shape is declared twice — here and in
// state.js — so the two drifting apart has to degrade, not crash.
const partial = await page.evaluate(async () => {
  const C = await import('./src/rules/crime.js');
  // A real GameState always has flags/reputation; only `crime` is the partial bit.
  const st = { day: 3, flags: {}, reputation: {}, crime: { bounty: { phandalin: 50 } } };
  const map = { id: 'phandalin', biome: 'city' };
  const out = {};
  try { out.watch = C.watchOwed(st, map); } catch (e) { out.watch = 'THREW: ' + e; }
  try { out.outlaw = C.isOutlawIn(st, map); } catch (e) { out.outlaw = 'THREW: ' + e; }
  try { out.bounty = C.bountyIn(st, map); } catch (e) { out.bounty = 'THREW: ' + e; }
  try { C.reportDeath(st, 'toblen', { map, witnessed: true }); out.death = 'ok'; }
  catch (e) { out.death = 'THREW: ' + String(e).slice(0, 80); }
  out.filled = Object.keys(C.crimeState(st)).sort().join(',');
  return out;
});
check('crime: a save missing a key does not throw',
  partial.death === 'ok' && partial.watch === 0 && partial.outlaw === false && partial.bounty === 50,
  JSON.stringify(partial));

// --- world-verb spells ------------------------------------------------------
// fieldRole classifies a spell by the tags on its effects, against a table in
// fieldcast.js. Seven of that table's thirteen entries matched no spell in the
// catalogue at all — it said 'identify', 'mend', 'comprehend', 'alarm', the
// data says 'identify-item', 'repair', 'translate', 'ward-area'. Those spells
// fell through to the buff branch, so Identify and Comprehend Languages spent a
// first-level slot applying a buff that does not exist, and the overworld's
// _spellIdentify hook could never fire. A table matched by string against data
// in another file drifts silently, so assert the join rather than the symptom.
const world = await page.evaluate(async () => {
  const FC = await import('./src/rules/fieldcast.js');
  const S = await import('./src/data/spells.js');
  const all = S.SPELLS || S.default || {};
  const ids = Array.isArray(all) ? all.map((x) => x.id) : Object.keys(all);
  const get = (id) => (S.getSpell ? S.getSpell(id) : (Array.isArray(all) ? all.find((x) => x.id === id) : all[id])) || {};

  // Every tag the catalogue actually writes on a utility effect.
  const used = new Set();
  for (const id of ids) for (const e of (get(id).effects || [])) {
    if (e && String(e.kind).toLowerCase() === 'utility' && e.tag) used.add(String(e.tag).toLowerCase());
  }
  const table = [...(FC.WORLD_TAGS || [])];
  const orphans = table.filter((t) => !used.has(t));

  const roleOf = (id) => FC.fieldRole(get(id));
  return {
    orphans,
    tableSize: table.length,
    identify: roleOf('identify'),
    mending: roleOf('mending'),
    comprehend: roleOf('comprehend-languages'),
    prestidigitation: roleOf('prestidigitation'),
    // the ones that already worked must not regress
    light: roleOf('light'),
    mageHand: roleOf('mage-hand'),
    knock: roleOf('knock'),
    mageArmor: roleOf('mage-armor'),
    cureWounds: roleOf('cure-wounds'),
  };
});
check('spells: every world tag matches a real spell', world.orphans.length === 0,
  world.orphans.length ? `unused: ${world.orphans.join(', ')}` : `${world.tableSize} tags`);
check('spells: Identify is a world verb, not a buff', world.identify === 'world', world.identify);
check('spells: Comprehend Languages is a world verb', world.comprehend === 'world', world.comprehend);
check('spells: Mending and Prestidigitation are world verbs',
  world.mending === 'world' && world.prestidigitation === 'world',
  `${world.mending}/${world.prestidigitation}`);
check('spells: the ones that already worked still do',
  world.light === 'world' && world.mageHand === 'world' && world.knock === 'world'
  && world.mageArmor === 'buff' && world.cureWounds === 'heal',
  `${world.light}/${world.mageHand}/${world.knock}/${world.mageArmor}/${world.cureWounds}`);

// --- hotbar slot indices ----------------------------------------------------
// Each slot's fn closed over `out.length` rather than its own index, and a
// closure reads that when the key is pressed — by which time the bar is full.
const slotIdx = await page.evaluate(() => {
  for (let i = 0; i < 12 && SC.Game.top && SC.Game.top.id !== 'overworld'; i++) SC.Game.pop();
  const ow = SC.Game.top;
  if (!ow || ow.id !== 'overworld') return { skip: 'not in the overworld' };
  ow._rebuildSlots();
  const seen = [];
  const real = ow.hotbar.pulse.bind(ow.hotbar);
  ow.hotbar.pulse = (i) => { seen.push(i); return real(i); };
  const n = (ow._slots || []).length;
  for (const s of ow._slots || []) { try { s.fn && s.fn(); } catch (e) { /* refusals are fine */ } }
  ow.hotbar.pulse = real;
  return { n, seen, distinct: new Set(seen).size };
});
if (slotIdx.skip) check('hotbar: each slot pulses its own index', false, slotIdx.skip);
else {
  check('hotbar: each slot pulses its own index',
    slotIdx.seen.every((i) => i < slotIdx.n) && slotIdx.distinct === slotIdx.seen.length,
    `${slotIdx.n} slots, pulsed [${slotIdx.seen.join(',')}]`);
}

// --- fleeing ---------------------------------------------------------------
// A fight ends three ways and the results screen only ever branched two. A
// successful escape fell through to the defeat arm, so outrunning a fight
// showed "The company falls." and then a Game Over naming the creature you had
// escaped as your killer, with the whole party still at full hp.
const esc = await page.evaluate(async () => {
  // The battle checks above leave a scene on the stack; get back to the world.
  for (let i = 0; i < 12 && SC.Game.top && SC.Game.top.id !== 'overworld'; i++) SC.Game.pop();
  const ow = SC.Game.top;
  if (!ow || ow.id !== 'overworld') return { skip: 'not in the overworld: ' + (ow && ow.id) };
  const before = ow.id;

  ow._pushBattle(['goblin'], {});
  for (let i = 0; i < 60 && SC.Game.top.id !== 'battle'; i++) await new Promise((r) => setTimeout(r, 50));
  const battle = SC.Game.top;
  if (!battle || battle.id !== 'battle') return { skip: 'no battle started (' + (battle && battle.id) + ')' };

  const enc = battle.enc;
  const runner = () => enc.units.find((u) => u.side === 'party' && u.hp > 0);
  // A Dexterity contest, so retry until it lands; a failure leaves the fight
  // active and only spends the caller's action.
  let ok = false, tries = 0;
  while (!ok && tries++ < 60 && enc.state === 'active') {
    ok = !!(enc.fleeCheck(runner()) || {}).success;
  }
  if (!ok) return { skip: 'never won the escape contest in ' + tries + ' tries' };

  const hpBefore = enc.units.filter((u) => u.side === 'party').map((u) => u.hp);
  battle._checkOver();
  const kind = battle.results && battle.results.kind;

  // _leaveDefeat never called opts.onEnd, so nothing downstream of a flee ran:
  // the creatures did not scatter and the field music never came back. Spy on
  // the callback directly rather than on a side effect that was already set.
  let told = false;
  const realEnd = battle.opts.onEnd;
  battle.opts.onEnd = (res) => { told = true; return realEnd && realEnd(res); };

  // Walk off the results screen the way a player would.
  battle.results.t = 5;
  if (kind === 'escape') battle._leaveEscape();
  else if (kind === 'victory') battle._leaveVictory();
  else battle._leaveDefeat();
  for (let i = 0; i < 40 && SC.Game.top.id === 'battle'; i++) await new Promise((r) => setTimeout(r, 50));

  return {
    from: before,
    state: enc.state,
    kind,
    landedOn: SC.Game.top && SC.Game.top.id,
    alive: hpBefore.every((h) => h > 0),
    told,
  };
});

if (esc.skip) {
  check('flee: a successful escape is not a defeat', false, 'could not set up — ' + esc.skip);
} else {
  check('flee: a successful escape shows Escaped, not Defeat', esc.kind === 'escape',
    `state=${esc.state} kind=${esc.kind}`);
  check('flee: escaping does not end the run', esc.landedOn !== 'gameover',
    `landed on ${esc.landedOn}`);
  check('flee: it returns to the world you left', esc.landedOn === 'overworld', esc.landedOn);
  check('flee: nobody dies of running away', esc.alive);
  check('flee: the world is told the fight ended', esc.told, 'onEnd fired');
}

// --- save / load round trip ------------------------------------------------
const save = await page.evaluate(() => {
  SC.Game.state.crime.bounty['test-region'] = 123;
  SC.Game.state.crime.slain['someone'] = true;
  SC.writeSave(3);
  const ok = SC.continueGame(3);
  return { ok, bounty: SC.Game.state.crime && SC.Game.state.crime.bounty['test-region'],
    slain: !!(SC.Game.state.crime && SC.Game.state.crime.slain['someone']) };
});
check('save: the crime ledger round-trips', save.bounty === 123 && save.slain, JSON.stringify(save));


console.log(R.join('\n'));
console.log('\npage errors:', errs.length ? JSON.stringify(errs.slice(0,3), null, 1) : 'none');
await browser.close();
process.exit(R.some(r => r.startsWith('FAIL')) ? 1 : 0);
