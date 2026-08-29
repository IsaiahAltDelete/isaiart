// main.js — bootstrap. Loads every subsystem in dependency order, wires the
// cross-module glue that would otherwise cause circular imports, and hands
// control to the title screen.

import { Game } from './engine.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { Save } from './core/save.js';
import { bus, EV } from './core/events.js';
import { FX } from './render/fx.js';
import { Party } from './world/party.js';
import { newGameState, loadState, saveState, stateSummary, recordKill, progressQuests, advanceTime } from './state.js';
import { VERSION } from './constants.js';

// Registries that must run before anything draws.
import { registerCharacterSprites } from './render/spritedata_chars.js';
import { registerMonsterSprites } from './render/spritedata_monsters.js';
import { registerTiles } from './render/tiles.js';

// Rules glue.
import { restShort, restLong, serializeChar, deserializeChar, createCharacter, recalc } from './rules/character.js';
import { grantXp } from './rules/progression.js';

// Scenes.
import { TitleScene } from './ui/title.js';
import { CharCreateScene } from './ui/charcreate.js';
import { OverworldScene, travelTo } from './world/overworld.js';
import { LevelUpScene } from './ui/levelup.js';

const STEPS = [
  ['waking the sprites', () => { registerCharacterSprites(); }],
  ['rousing the bestiary', () => { registerMonsterSprites(); }],
  ['laying the flagstones', () => { registerTiles(); }],
  ['consulting the Player\'s Handbook', async () => {
    // Touch the big catalogues so any authoring error surfaces during the boot
    // bar rather than mid-battle.
    const [{ SPELLS }, { ITEMS }, { MONSTERS }] = await Promise.all([
      import('./data/spells.js'), import('./data/items.js'), import('./data/monsters.js'),
    ]);
    console.info(`[Sword Coast] ${Object.keys(SPELLS).length} spells, ${Object.keys(ITEMS).length} items, ${Object.keys(MONSTERS).length} creatures.`);
  }],
  ['tuning the lute', () => { /* Audio initialises on the first gesture. */ }],
];

/** Wire the bits that would otherwise be circular imports. */
function wireGlue() {
  Party._rest.short = restShort;
  Party._rest.long = restLong;

  // Settings -> subsystems.
  const s = Save.settings;
  Audio.setVolume(s.volMaster, s.volMusic, s.volSfx);
  Audio.muted = !!s.muted;
  FX.reducedMotion = !!s.reducedMotion;
  FX.enabled = true;
  if (s.bindings) Object.assign(Input.bindings, s.bindings);

  bus.on('settings:changed', () => {
    const t = Save.settings;
    Audio.setVolume(t.volMaster, t.volMusic, t.volSfx);
    Audio.muted = !!t.muted;
    FX.reducedMotion = !!t.reducedMotion;
    Save.saveSettings();
  });

  // Combat outcomes feed the campaign state.
  bus.on(EV.DEATH, ({ unit }) => {
    if (!Game.state || !unit || unit.side === 'party') return;
    if (unit.monsterId) recordKill(Game.state, unit.monsterId);
  });
  bus.on(EV.CRIT, () => { if (Game.state) Game.state.stats.crits++; });
  bus.on(EV.SPELL_CAST, () => { if (Game.state) Game.state.stats.spellsCast++; });
  bus.on(EV.ITEM_GAIN, ({ id }) => { if (Game.state) progressQuests(Game.state, 'collect', id, 1); });
  bus.on(EV.MAP_ENTER, ({ mapId }) => { if (Game.state) progressQuests(Game.state, 'reach', mapId, 1); });
}

/** Award XP to the party and push the level-up flow if anyone advanced. */
export function awardPartyXp(amount) {
  const levelled = [];
  for (const m of Party.members) {
    const res = grantXp(m, amount);
    if (res && res.leveled) levelled.push(m);
  }
  if (levelled.length) Game.push(new LevelUpScene(levelled));
  return levelled;
}

/** Start a fresh campaign: character creation, then Phandalin. */
export function newGame() {
  Party.clear();
  Game.state = newGameState(`sc-${Date.now()}`);
  Game.push(new CharCreateScene((hero) => {
    if (!hero) { Game.pop(); return; }
    Party.add(hero);
    Party.addGold(15);                       // a modest purse to start
    Game.replace(new OverworldScene());
    travelTo(Game.state.mapId, Game.state.x, Game.state.y, Game.state.dir);
    bus.emit(EV.TOAST, { text: 'Phandalin. The Triboar Trail runs east.' });
    autosave();
  }));
}

export function continueGame(slot) {
  const target = slot != null ? slot : Save.newest();
  if (target < 0) return false;
  const data = Save.read(target);
  if (!data) return false;
  Game.state = loadState(data, deserializeChar);
  for (const m of Party.all()) recalc(m);
  Game.replace(new OverworldScene());
  travelTo(Game.state.mapId, Game.state.x, Game.state.y, Game.state.dir);
  return true;
}

export function writeSave(slot) {
  if (!Game.state) return false;
  const payload = saveState(Game.state, serializeChar);
  payload.meta = stateSummary(Game.state);
  const res = Save.write(slot, payload);
  if (res !== false) bus.emit(EV.TOAST, { text: 'Journal updated.' });
  return res;
}

export function autosave() { return writeSave(0); }

// Playtime and the world clock tick with the game loop.
let clockAcc = 0;
bus.on('tick', (dt) => {
  if (!Game.state) return;
  Game.state.playtime += dt;
  clockAcc += dt;
  if (clockAcc >= 1) { advanceTime(Game.state, 4 * clockAcc); clockAcc = 0; }
});

/**
 * Boot the game. Called by index.html.
 * hooks: { progress(pct, message), done(), gate: HTMLElement }
 */
export async function boot(hooks = {}) {
  const progress = hooks.progress || (() => {});

  for (let i = 0; i < STEPS.length; i++) {
    const [msg, fn] = STEPS[i];
    progress(i / STEPS.length, msg);
    await fn();
    // Yield so the boot bar actually paints between steps.
    await new Promise((r) => setTimeout(r, 16));
  }

  wireGlue();
  progress(1, 'the road awaits');

  const canvas = document.getElementById('game');
  Game.start(new TitleScene(), canvas);

  // Feed dt to the bus so state can tick without importing the engine.
  const origTick = Game._update.bind(Game);
  Game._update = (dt) => { origTick(dt); bus.emit('tick', dt); };

  if (hooks.done) hooks.done();

  // Browsers require a user gesture before audio may start.
  const gate = hooks.gate;
  if (gate) {
    gate.classList.add('show');
    const open = () => {
      gate.classList.remove('show');
      window.removeEventListener('keydown', open);
      gate.removeEventListener('pointerdown', open);
      try { Audio.init(); Audio.music('title'); } catch (e) { console.warn('audio unavailable', e); }
    };
    window.addEventListener('keydown', open, { once: false });
    gate.addEventListener('pointerdown', open);
  }

  // Handy console access while developing.
  window.SC = { Game, Party, Save, Audio, Input, FX, bus, EV, newGame, continueGame, writeSave, awardPartyXp, createCharacter, VERSION };
  console.info(`Sword Coast Chronicles v${VERSION} — type SC in the console for debug handles.`);
}
