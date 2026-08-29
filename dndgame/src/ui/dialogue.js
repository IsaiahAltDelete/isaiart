// ui/dialogue.js — DialogueScene: the conversation window used for every NPC on
// the Sword Coast, plus `say()` for one-off lines.
//
// Layout (400x240 logical):
//   y 100..156   choice window (only while a node offers choices)
//   y 162..236   the message box: 44px portrait bust, gold speaker tab, typewriter
//   centre       an animated d20 whenever a [Persuasion 15] style check is rolled
//
// The scene is non-opaque and pauses the scene below, so Phandalin keeps sitting
// behind the window while Toblen Stonehill talks.
//
// Every catalogue this file reads (dialogue, npcs, quests, tables, overworld,
// combat) is pulled in with a dynamic import so a module that has not been
// written yet leaves an empty holder instead of breaking the module graph.

import { UI } from './kit.js';
import { ShopScene } from './shop.js';
import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { Save } from '../core/save.js';
import { Game } from '../engine.js';
import { FX } from '../render/fx.js';
import { VIEW_W, VIEW_H, clamp, titleCase } from '../constants.js';
import { rng, hashStr } from '../core/rng.js';
import { bus, EV, toast } from '../core/events.js';
import { drawActorBust } from '../render/actor.js';
import { hasSprite } from '../render/sprites.js';
import { SKILLS, ABILITIES, ABILITY_ABBR } from '../rules/abilities.js';
import { abilityCheck } from '../rules/actions.js';
import {
  createCharacter, recalc, skillMod, abilityMod, abilityScore,
} from '../rules/character.js';
import { recomputeSpells } from '../rules/spellcasting.js';
import { canAttack } from '../rules/crime.js';
import { grantXp } from '../rules/progression.js';
import { getSpell } from '../data/spells.js';
import { resolveItem, itemName as catalogueItemName } from '../data/items.js';
import { Party } from '../world/party.js';
import {
  setFlag, hasFlag, isQuestActive, isQuestDone, startQuest, completeQuest,
  addReputation, advanceTime,
} from '../state.js';

// ===========================================================================
// 0. SAFETY
// ===========================================================================

/** Run `fn`; return `fb` if it throws or produces nothing. Nothing here may throw. */
function safe(fn, fb) {
  try { const v = fn(); return v === undefined || v === null ? fb : v; } catch (e) { return fb; }
}
function sfx(name) { safe(() => Audio.sfx(name), false); }
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const S = () => Game.state || null;

// --- late catalogues -------------------------------------------------------
// null = still loading, false = absent, object = loaded.
const LATE = {
  dialogue: null, npcs: null, quests: null, tables: null,
  overworld: null, combat: null, scaling: null, combatui: null,
};
function pull(key, path) {
  safe(() => import(/* @vite-ignore */ path)
    .then((m) => { LATE[key] = m || false; })
    .catch(() => { LATE[key] = false; }));
}
pull('dialogue', '../data/dialogue.js');
pull('npcs', '../data/npcs.js');
pull('quests', '../data/quests.js');
pull('tables', '../data/tables.js');
pull('overworld', '../world/overworld.js');
pull('combat', '../rules/combat.js');
pull('scaling', '../rules/scaling.js');
pull('combatui', './combatui.js');

const DIALOGUE = () => (LATE.dialogue && LATE.dialogue.DIALOGUE) || {};
const NPCS = () => (LATE.npcs && LATE.npcs.NPCS) || {};
const RECRUITS = () => arr(LATE.npcs && LATE.npcs.RECRUITS);
const QUESTS = () => (LATE.quests && LATE.quests.QUESTS) || {};
const RUMORS = () => arr(LATE.tables && LATE.tables.RUMORS);
const FACTIONS = () => (LATE.tables && LATE.tables.FACTIONS) || {};

function itemDefOf(id) { return safe(() => resolveItem(id), null); }
function itemLabel(id) {
  return safe(() => itemDefOf(id).name, null) || safe(() => catalogueItemName(id), null)
    || String(id || '').replace(/-/g, ' ');
}
/** "harpers" -> "The Harpers" once tables.js lands, "Harpers" before it does. */
function factionName(id) {
  const f = FACTIONS()[id];
  return (f && (f.name || f.title)) || titleCase(String(id || '').replace(/-/g, ' '));
}

// ===========================================================================
// 1. GEOMETRY
// ===========================================================================

const BOX_X = 4;
const BOX_W = VIEW_W - 8;          // 392
const BOX_H = 74;
const BOX_Y = VIEW_H - BOX_H - 4;  // 162

const PORT_S = 44;
const PORT_X = BOX_X + 6;
const PORT_Y = BOX_Y + 7;

const TEXT_X = PORT_X + PORT_S + 7;             // 61
const TEXT_W = BOX_X + BOX_W - 7 - TEXT_X;      // 328
const TEXT_Y = BOX_Y + 10;
const TEXT_LINES = 5;

const CH_X = 96;
const CH_W = 300;
const CH_ROW = 12;
const CH_MAX_ROWS = 4;

const PAUSE_TIME = 0.34;      // \p hold, in seconds
const ROLL_MIN = 0.85;        // shortest a d20 may stay on screen
const ROLL_HOLD = 2.1;        // auto-advance after this long

// ===========================================================================
// 2. TEXT MARKUP
// ===========================================================================
// Supported inline markup:
//   {name}   the player character's name        {party} a random companion
//   {npc}    the speaker                        {gold}  the party purse
//   [gold]…[/]  [red]…[/]  [blue]…[/]  (also green/purple/cyan/dim/white/yellow)
//   \p       a short dramatic pause

const TAG_COLORS = {
  gold: UI.COLORS.gold, red: UI.COLORS.red, blue: UI.COLORS.blue,
  green: UI.COLORS.green, purple: UI.COLORS.purple, cyan: UI.COLORS.cyan,
  dim: UI.COLORS.inkDim, white: UI.COLORS.inkBright, yellow: UI.COLORS.yellow,
  ink: UI.COLORS.ink,
};
const TAG_RE = /\[(\/?)(gold|red|blue|green|purple|cyan|dim|white|yellow|ink)\]|\[\/\]|\\p/g;

/** Substitute the {…} tokens once, when a page is built. */
function expandTokens(str, speakerName) {
  let s = String(str == null ? '' : str);
  if (s.indexOf('{') < 0) return s;
  const lead = Party.members[0];
  const mates = Party.members.filter((m) => m && m !== lead);
  const mate = mates.length ? safe(() => rng.pick(mates), mates[0]) : lead;
  return s
    .replace(/\{name\}/g, (lead && lead.name) || 'friend')
    .replace(/\{party\}/g, (mate && mate.name) || (lead && lead.name) || 'your companion')
    .replace(/\{npc\}/g, speakerName || 'they')
    .replace(/\{gold\}/g, String(Party.gold | 0))
    .replace(/\{level\}/g, String(Party.levelAvg()));
}

/** Split marked-up text into colour runs, recording the \p pause offsets. */
function parseRuns(str) {
  const src = String(str == null ? '' : str);
  const runs = [];
  const pauses = new Set();
  const stack = [];
  let plain = '';
  const push = (text) => {
    if (!text) return;
    runs.push({ text, color: stack.length ? stack[stack.length - 1] : null });
    plain += text;
  };
  TAG_RE.lastIndex = 0;
  let last = 0;
  let m = TAG_RE.exec(src);
  while (m) {
    push(src.slice(last, m.index));
    last = TAG_RE.lastIndex;
    const tok = m[0];
    if (tok === '\\p') pauses.add(plain.length);
    else if (tok === '[/]' || m[1] === '/') stack.pop();
    else stack.push(TAG_COLORS[m[2]] || null);
    m = TAG_RE.exec(src);
  }
  push(src.slice(last));
  return { runs, pauses, plain, length: plain.length };
}

let _advCache = null;
/** Pixels of advance per glyph — the bitmap font is fixed-pitch, so this is exact. */
function advOf(size) {
  if (!_advCache) _advCache = {};
  if (_advCache[size] == null) {
    _advCache[size] = safe(() => UI.measure('nn', size) - UI.measure('n', size), 6) || 6;
  }
  return _advCache[size];
}

/**
 * Wrap the runs into drawable line segments.
 * -> [{ start, segs:[{ text, color, off }] }]  where `start` is the absolute
 * character index of the line and `off` the segment's offset inside it.
 */
function layoutRuns(parsed, maxW, size) {
  const adv = advOf(size);
  const maxChars = Math.max(1, Math.floor((maxW + 1) / adv));
  const plain = parsed.plain;
  const n = plain.length;

  // per-character colour, so segments can be regrouped after wrapping
  const cols = new Array(n);
  let k = 0;
  for (const r of parsed.runs) for (let i = 0; i < r.text.length; i++) cols[k++] = r.color;

  const lines = [];
  let i = 0;
  let guard = 0;
  while (i <= n && guard++ < 4000) {
    if (i === n && lines.length) break;
    const hardEnd = Math.min(n, i + maxChars);
    const nl = plain.indexOf('\n', i);
    let start = i;
    let end;
    if (nl >= 0 && nl <= hardEnd) { end = nl; i = nl + 1; }
    else if (hardEnd >= n) { end = n; i = n + 1; }
    else {
      let cut = hardEnd;
      while (cut > start && plain[cut] !== ' ') cut--;
      if (cut <= start) cut = hardEnd;            // one very long word: hard break
      end = cut;
      i = cut;
      while (i < n && plain[i] === ' ') i++;
      if (i <= start) i = start + 1;              // never stall
    }
    // regroup [start,end) into same-colour segments
    const segs = [];
    let sIdx = start;
    while (sIdx < end) {
      const c = cols[sIdx];
      let e = sIdx;
      while (e < end && cols[e] === c) e++;
      segs.push({ text: plain.slice(sIdx, e), color: c, off: sIdx - start });
      sIdx = e;
    }
    lines.push({ start, segs });
    if (i > n) break;
  }
  return lines;
}

// ===========================================================================
// 3. SKILL-CHECK TAGS
// ===========================================================================

// "[Persuasion 15]", "[Insight DC 12]", "[STR 13]" — parsed straight out of the
// choice text so a writer never has to hand-build a check object.
const CHECK_RE = /\[\s*([A-Za-z][A-Za-z' -]*?)\s+(?:DC\s*)?(\d{1,2})\s*\]/;

function skillIdFor(label) {
  const key = String(label || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (SKILLS[key]) return key;
  const alt = key.replace(/-/g, '');
  for (const id of Object.keys(SKILLS)) if (id.replace(/-/g, '') === alt) return id;
  return null;
}

function abilityIdFor(label) {
  const key = String(label || '').trim().toLowerCase();
  if (ABILITIES.includes(key)) return key;
  for (const ab of ABILITIES) {
    if (String(ABILITY_ABBR[ab]).toLowerCase() === key) return ab;
    if (key.startsWith(ab)) return ab;
  }
  return null;
}

/** -> { label, tag, check:{skill, ability, dc} } — `tag` is the visible "[…]" part. */
function parseCheckTag(text) {
  const s = String(text == null ? '' : text);
  const m = CHECK_RE.exec(s);
  if (!m) return { label: s, tag: null, check: null };
  const skill = skillIdFor(m[1]);
  const ability = skill ? SKILLS[skill].ability : abilityIdFor(m[1]);
  if (!skill && !ability) return { label: s, tag: null, check: null };
  const label = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim();
  return {
    label: label || s,
    tag: m[0].trim(),
    check: { skill, ability: ability || 'cha', dc: parseInt(m[2], 10) || 10 },
  };
}

/** The companion with the best odds — a party sends its face to do the talking. */
function bestChecker(skill, ability) {
  let best = null;
  let bm = -99;
  for (const m of Party.members) {
    if (!m || m.hp <= 0) continue;
    const v = skill ? safe(() => skillMod(m, skill).mod, 0) : safe(() => abilityMod(m, ability), 0);
    if (v > bm) { bm = v; best = m; }
  }
  return best || Party.members[0] || null;
}

// ===========================================================================
// 4. CONDITIONS  —  if:{ flag, quest, gold, level, faction, item, ability }
// ===========================================================================

/**
 * -> { ok, reason, hide }
 * Narrative gates (flags, quests, species) hide the choice entirely; resource
 * gates (gold, level, items, reputation, ability scores) show it greyed with the
 * reason, because "you can see what you cannot yet afford" is better play.
 */
function evalIf(cond, scene) {
  if (!cond) return { ok: true, reason: '', hide: false };
  if (Array.isArray(cond)) {
    for (const c of cond) { const r = evalIf(c, scene); if (!r.ok) return r; }
    return { ok: true, reason: '', hide: false };
  }
  if (typeof cond === 'string') return evalIf({ flag: cond }, scene);
  if (typeof cond === 'function') {
    const v = safe(() => cond(scene), true);
    return v ? { ok: true, reason: '', hide: false } : { ok: false, reason: '', hide: true };
  }
  if (!isObj(cond)) return { ok: true, reason: '', hide: false };

  const st = S();
  const fail = (reason, hide) => ({
    ok: false,
    reason: cond.reason != null ? String(cond.reason) : reason,
    hide: cond.hide != null ? !!cond.hide : (cond.grey ? false : !!hide),
  });

  if (cond.not) { const r = evalIf(cond.not, scene); if (r.ok) return fail('', true); }
  if (cond.all) { const r = evalIf(arr(cond.all), scene); if (!r.ok) return r; }
  if (cond.any) {
    const list = arr(cond.any);
    if (list.length && !list.some((c) => evalIf(c, scene).ok)) return fail('', true);
  }

  // --- flags -------------------------------------------------------------
  for (const f of arr(cond.flag)) {
    const name = isObj(f) ? f.name : String(f);
    const want = isObj(f) ? (f.value === undefined ? true : f.value) : true;
    const has = st ? hasFlag(st, name) : false;
    if (!!has !== !!want) return fail('', true);
  }
  for (const f of arr(cond.notFlag ?? cond.noFlag)) {
    if (st && hasFlag(st, String(f))) return fail('', true);
  }

  // --- quests ------------------------------------------------------------
  for (const q of arr(cond.quest ?? cond.questActive)) {
    if (!st || !isQuestActive(st, String(q))) return fail('', true);
  }
  for (const q of arr(cond.questDone)) {
    if (!st || !isQuestDone(st, String(q))) return fail('', true);
  }
  for (const q of arr(cond.questNot ?? cond.noQuest)) {
    if (st && (isQuestActive(st, String(q)) || isQuestDone(st, String(q)))) return fail('', true);
  }

  // --- purse, level ------------------------------------------------------
  if (cond.gold != null && Party.gold < Number(cond.gold)) {
    return fail(`${Number(cond.gold)} gp`, false);
  }
  if (cond.level != null && Party.levelMax() < Number(cond.level)) {
    return fail(`Level ${Number(cond.level)}`, false);
  }

  // --- carried items -----------------------------------------------------
  for (const it of arr(cond.item)) {
    const id = isObj(it) ? (it.id || it.item) : String(it);
    const qty = isObj(it) ? (it.qty || it.count || 1) : 1;
    const held = Party.countItem(id) + Party.members.reduce(
      (a, m) => a + arr(m && m.inventory).reduce((b, e) => b + (e.id === id ? (e.qty || 1) : 0), 0), 0);
    if (held < qty) return fail(qty > 1 ? `${qty}× ${itemLabel(id)}` : itemLabel(id), false);
  }

  // --- reputation --------------------------------------------------------
  const facs = cond.faction != null ? cond.faction : cond.rep;
  if (facs != null) {
    for (const f of arr(facs)) {
      const id = isObj(f) ? (f.id || f.faction) : String(f);
      const min = isObj(f) ? (f.min ?? f.value ?? 1) : (cond.repMin ?? 1);
      const have = (st && st.reputation && st.reputation[id]) || 0;
      if (have < min) return fail(`${factionName(id)} ${min}`, false);
    }
  }

  // --- ability scores ----------------------------------------------------
  if (isObj(cond.ability)) {
    const pairs = cond.ability.ability
      ? [[cond.ability.ability, cond.ability.min ?? cond.ability.value ?? 13]]
      : Object.entries(cond.ability);
    for (const [ab, min] of pairs) {
      if (!ABILITIES.includes(ab)) continue;
      const best = Party.members.reduce((a, m) => Math.max(a, safe(() => abilityScore(m, ab), 10)), 0);
      if (best < Number(min)) return fail(`${ABILITY_ABBR[ab]} ${min}`, false);
    }
  }

  // --- party composition -------------------------------------------------
  for (const c of arr(cond.classId ?? cond.class)) {
    if (!Party.members.some((m) => arr(m && m.classes).some((k) => k.id === c))) return fail('', true);
  }
  for (const sp of arr(cond.species ?? cond.speciesId)) {
    if (!Party.members.some((m) => m && m.speciesId === sp)) return fail('', true);
  }

  return { ok: true, reason: '', hide: false };
}

// ===========================================================================
// 5. RUMOURS
// ===========================================================================

/** A rotating rumour: same speaker, same day, same line — a new one tomorrow. */
function rumorLine(seedKey) {
  const st = S();
  const day = (st && st.day) || 1;
  const lvl = Party.levelMax();
  const pool = RUMORS().filter((r) => {
    if (!r) return false;
    if (typeof r === 'string') return true;
    if (r.minLevel != null && lvl < r.minLevel) return false;
    if (r.flag && st && !hasFlag(st, r.flag)) return false;
    return true;
  });
  if (!pool.length) return null;
  const i = hashStr(`${seedKey}:${day}`) % pool.length;
  const r = pool[i];
  return typeof r === 'string' ? r : (r.text || r.line || r.desc || null);
}

// ===========================================================================
// 6. THE SCENE
// ===========================================================================

export class DialogueScene {
  /**
   * @param {string|object} dialogueId  a DIALOGUE key, or an inline {start,nodes} tree
   * @param {object} npc                NPCS entry / Character used for the bust
   * @param {object} opts               { node, speaker, rumor, onClose, shopId, tint }
   */
  constructor(dialogueId, npc = null, opts = {}) {
    this.opaque = false;         // Phandalin keeps showing through
    this.pausesBelow = true;
    this.uiLayer = true;         // …but the rain does not fall on the text box
    this.id = 'dialogue';

    this.dialogueId = typeof dialogueId === 'string' ? dialogueId : (opts.id || 'inline');
    this.inlineTree = isObj(dialogueId) ? dialogueId : (opts.tree || null);
    this.npc = npc || null;
    this.npcId = (npc && (npc.id || npc.npcId)) || (typeof dialogueId === 'string' ? dialogueId : 'stranger');
    this.opts = opts || {};
    this.onClose = opts.onClose || null;

    this.tree = null;
    this.node = null;
    this.nodeId = null;
    this.startNode = opts.node || opts.start || null;

    this.mode = 'text';          // 'text' | 'choose' | 'roll'
    this.pages = [];
    this.page = 0;
    this.shown = 0;
    this.holdT = 0;
    this.seenPause = new Set();

    this.choices = [];
    this.index = 0;
    this.listTop = 0;

    this.roll = null;            // { display, res, choice, t }
    this.t = 0;
    this.waitT = 0;
    this.footer = null;          // transient status line
    this.footerT = 0;
    this._closed = false;
    this._started = false;
    this._announced = false;
  }

  // --- lifecycle ---------------------------------------------------------

  enter() {
    safe(() => Input.flush());
    this._resolveTree();
    if (!this._announced) {
      this._announced = true;
      safe(() => bus.emit(EV.DIALOGUE_OPEN, { id: this.dialogueId, npc: this.npcId }));
      const st = S();
      if (st) {
        st.npcState = st.npcState || {};
        const rec = st.npcState[this.npcId] || { met: false, talkCount: 0 };
        rec.met = true;
        rec.talkCount = (rec.talkCount || 0) + 1;
        st.npcState[this.npcId] = rec;
      }
    }
  }

  exit() { /* the window simply stops drawing */ }

  /** Resolve the dialogue tree once data/dialogue.js has landed. */
  _resolveTree() {
    if (this.tree) return;
    if (this.inlineTree && isObj(this.inlineTree.nodes)) {
      this.tree = this.inlineTree;
    } else if (LATE.dialogue === null && this.waitT < 1.5) {
      return;                                   // still loading; try again next frame
    } else {
      const found = DIALOGUE()[this.dialogueId];
      this.tree = isObj(found) && isObj(found.nodes) ? found : this._fallbackTree();
    }
    if (!this._started) {
      this._started = true;
      this._goto(this.startNode || this.tree.start || Object.keys(this.tree.nodes)[0]);
    }
  }

  /** Something to say when the writers have not filled this NPC in yet. */
  _fallbackTree() {
    const line = (this.opts.rumor && rumorLine(this.npcId))
      || 'Well met. Keep to the Triboar Trail after dark — the goblins have grown bold.';
    return { start: 'n1', nodes: { n1: { text: line } } };
  }

  // --- node navigation ---------------------------------------------------

  _goto(id) {
    if (id == null || id === 'close' || id === 'end' || id === false) { this._close(); return; }
    const node = this.tree && this.tree.nodes ? this.tree.nodes[id] : null;
    if (!node) { this._close(); return; }
    this.nodeId = id;
    this.node = node;
    this.mode = 'text';
    this.index = 0;
    this.listTop = 0;
    this.roll = null;

    if (node.once && S()) setFlag(S(), `seen:${this.dialogueId}:${id}`, true);
    if (node.do) {
      const r = this._runDo(node.do);
      if (r.close) { this._close(); return; }
      if (r.goto) { this._goto(r.goto); return; }
    }

    this._buildPages(node);
    this._buildChoices(node);
  }

  _speakerName(node) {
    return (node && node.speaker)
      || this.opts.speaker
      || (this.npc && (this.npc.name || this.npc.title))
      || 'Stranger';
  }

  _buildPages(node) {
    const name = this._speakerName(node);
    let raw = node.text != null ? node.text : node.lines;
    if (node.rumor || (this.opts.rumor && node.allowRumor !== false && !raw)) {
      const line = rumorLine(`${this.npcId}:${this.nodeId}`);
      if (line) raw = raw ? `${raw}\n\n${line}` : line;
    }
    let pages = Array.isArray(raw) ? raw.slice() : String(raw == null ? '' : raw).split(/\n\s*\n/);
    pages = pages.map((p) => String(p == null ? '' : p).trim()).filter((p) => p.length);
    if (!pages.length) pages = ['…'];
    this.pages = pages.map((p) => {
      const parsed = parseRuns(expandTokens(p, name));
      return { ...parsed, lines: layoutRuns(parsed, TEXT_W, 'sm') };
    });
    this.page = 0;
    this.shown = 0;
    this.holdT = 0;
    this.seenPause = new Set();
  }

  _buildChoices(node) {
    const out = [];
    const st = S();
    arr(node && node.choices).forEach((raw, i) => {
      if (!raw) return;
      const c = typeof raw === 'string' ? { text: raw } : raw;
      const parsed = parseCheckTag(expandTokens(c.text || c.label || '…', this._speakerName(node)));
      const check = c.check ? { dc: 10, ability: 'cha', ...c.check } : parsed.check;
      if (check && !check.skill && check.ability == null) check.ability = 'cha';

      const gate = evalIf(c.if || c.cond, this);
      // A one-shot check that has already been failed stays visible but spent.
      const spentKey = check && (check.once || c.once)
        ? `check:${this.dialogueId}:${this.nodeId}:${i}` : null;
      const spent = spentKey && st ? hasFlag(st, spentKey) : false;

      if (!gate.ok && gate.hide) return;
      out.push({
        raw: c,
        index: i,
        label: parsed.label,
        tag: check ? (parsed.tag || `[${checkLabel(check)} ${check.dc}]`) : null,
        check,
        spentKey,
        disabled: !gate.ok || spent,
        reason: spent ? 'already tried' : gate.reason,
      });
    });
    // --- the option that is always on the table -----------------------------
    //
    // Baldur's Gate 3's rule: you may always draw steel. It is a terrible idea
    // and the game lets you find that out yourself. Only the root node carries
    // it, so it never interrupts a scripted exchange mid-flow, and never on a
    // node that is already a fight or a shop.
    if (this._canOfferAttack(node)) {
      out.push({
        raw: { attack: true },
        index: -1,
        label: 'Draw your weapon.',
        tag: null,
        check: null,
        spentKey: null,
        attack: true,
        disabled: false,
        reason: null,
      });
    }

    this.choices = out;
    this.index = out.findIndex((c) => !c.disabled);
    if (this.index < 0) this.index = 0;
  }

  /** Is "Draw your weapon" a legal thing to offer on this node? */
  _canOfferAttack(node) {
    if (!node || node !== (this.tree && this.tree.nodes && this.tree.nodes[this.tree.start])) {
      // Only the opening node, unless the writer explicitly asked for it.
      if (!node || !node.allowAttack) return false;
    }
    if (this.tree && this.tree.noCombat) return false;
    if (node && node.noCombat) return false;
    if (!this.npc) return false;
    // The NPCS record carries `tag`/`essential`; the entity may only be a sprite
    // that maps.js placed, so fall back to the catalogue before deciding.
    // The entity may be `this.npc`, and its own catalogue record may hang off
    // `.npc`. Fall back to the catalogue keyed on the ENTITY's npcId — this.npcId
    // is derived from `id` first, which for an entity is 'npc-toblen', not a key.
    const record = (this.npc && this.npc.npc)
      || NPCS()[(this.npc && this.npc.npcId) || this.npcId]
      || NPCS()[this.npcId]
      || this.npc;
    const gate = safe(() => canAttack(record, this.npc), { ok: false });
    return !!(gate && gate.ok);
  }

  /** The player chose violence. Hand it to the overworld, which owns the crime. */
  _doAttack() {
    const ow = LATE.overworld;
    const target = this.opts.entity || (this.npc && this.npc.kind === 'npc' ? this.npc : null);
    this._closed = true;
    if (Game.top === this) Game.pop();
    if (!ow || !target) { safe(() => toast('There is no one here to fight.')); return; }
    const scene = Game.top;
    if (scene && typeof scene.attackNPC === 'function') safe(() => scene.attackNPC(target));
    else safe(() => toast('The moment passes.'));
  }

  // --- update ------------------------------------------------------------

  update(dt) {
    this.t += dt;
    this.waitT += dt;
    if (this.footerT > 0) { this.footerT -= dt; if (this.footerT <= 0) this.footer = null; }
    if (!this.tree) { this._resolveTree(); if (!this.tree) return; }
    if (this._closed) return;

    if (this.mode === 'roll') this._updateRoll(dt);
    else if (this.mode === 'choose') this._updateChoose();
    else this._updateText(dt);
  }

  /**
   * Typewriter speed in characters per second, from Save.settings.textSpeed.
   * 'instant' comes back as Infinity, which _updateText reads as "print the
   * whole page this frame".
   */
  _cps() {
    let v = safe(() => Save.textSpeedCps(), null);
    if (v == null) {
      const named = safe(() => Save.settings.textSpeed, 'normal');
      v = { slow: 18, normal: 42, fast: 90, instant: Infinity }[named];
    }
    return typeof v === 'number' && v > 0 ? v : 42;
  }

  _updateText(dt) {
    const pg = this.pages[this.page];
    if (!pg) { this._advancePage(); return; }
    const done = this.shown >= pg.length;

    if (!done) {
      if (this.holdT > 0) this.holdT -= dt;
      else {
        const at = Math.floor(this.shown);
        if (pg.pauses.has(at) && !this.seenPause.has(at)) {
          this.seenPause.add(at);
          this.holdT = PAUSE_TIME;
        } else {
          const cps = this._cps();
          this.shown = Math.min(pg.length, this.shown + (cps === Infinity ? pg.length : cps * dt));
        }
      }
    }

    const m = Input.mouse;
    const clicked = !!(m && m.clicked && m.y >= BOX_Y - 8);
    const pressed = Input.consume('confirm') || Input.consume('interact') || clicked;
    if (clicked && m) m.clicked = false;
    const skipped = Input.consume('cancel');

    if (pressed || skipped) {
      if (this.shown < pg.length) {
        // First press fills the line; the second one turns the page.
        this.shown = pg.length;
        this.holdT = 0;
        sfx('cursor');
      } else {
        this._advancePage();
      }
    }
  }

  _advancePage() {
    if (this.page + 1 < this.pages.length) {
      this.page++;
      this.shown = 0;
      this.holdT = 0;
      this.seenPause = new Set();
      sfx('page');
      return;
    }
    if (this.choices.length) {
      this.mode = 'choose';
      sfx('cursor');
      return;
    }
    const nxt = this.node && (this.node.goto ?? this.node.next);
    sfx('select');
    if (nxt) this._goto(nxt); else this._close();
  }

  _moveCursor(delta) {
    const n = this.choices.length;
    if (n < 2) return;
    let i = this.index;
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (!this.choices[i].disabled) break;
    }
    if (i !== this.index) { this.index = i; sfx('cursor'); }
  }

  _updateChoose() {
    if (Input.repeatConsume('up')) this._moveCursor(-1);
    if (Input.repeatConsume('down')) this._moveCursor(1);

    const L = this._choiceLayout();
    const m = Input.mouse;
    if (m && m.over) {
      for (let r = 0; r < L.rows; r++) {
        const i = this.listTop + r;
        if (i >= this.choices.length) break;
        const ry = L.listY + r * CH_ROW;
        if (m.x >= L.listX && m.x <= L.listX + L.listW && m.y >= ry && m.y < ry + CH_ROW) {
          if (this.index !== i && !this.choices[i].disabled) { this.index = i; sfx('cursor'); }
          if (m.clicked) { m.clicked = false; this._pick(); }
          break;
        }
      }
    }

    // Number keys jump straight to a choice, the way a keyboard player expects.
    for (let k = 0; k < 5; k++) {
      if (Input.consume(`tab${k + 1}`) && k < this.choices.length && !this.choices[k].disabled) {
        this.index = k;
        this._pick();
        return;
      }
    }

    if (Input.consume('confirm') || Input.consume('interact')) this._pick();
    if (Input.consume('cancel')) {
      const bail = this.choices.findIndex((c) => !c.disabled && (c.raw.cancel || c.raw.leave));
      if (bail >= 0) { this.index = bail; this._pick(); }
      else if (this.node && this.node.cancelable !== false) { sfx('back'); this._close(); }
      else sfx('error');
    }
  }

  _pick() {
    const c = this.choices[this.index];
    if (!c) { this._close(); return; }
    if (c.disabled) {
      sfx('error');
      this._say(c.reason ? `You need ${c.reason}.` : 'Not just now.');
      return;
    }
    if (c.attack) { sfx('select'); this._doAttack(); return; }
    if (c.check) { this._beginRoll(c); return; }
    sfx('select');
    this._resolveChoice(c, true);
  }

  /** Roll the gate, then show the d20 before the story branches. */
  _beginRoll(c) {
    const skill = c.check.skill || null;
    const ability = skill ? SKILLS[skill].ability : (c.check.ability || 'cha');
    const who = bestChecker(skill, ability);
    const res = safe(() => abilityCheck(null, who, ability, {
      skill: skill || undefined,
      dc: c.check.dc,
      adv: !!c.check.adv,
      dis: !!c.check.dis,
    }), null);
    const success = res ? !!res.success : true;
    const display = res && res.roll ? {
      ...res.roll,
      mod: res.mod,
      total: res.total,
      dc: res.dc,
      hit: success,
      adv: res.adv,
      dis: res.dis,
      label: success ? 'SUCCESS' : 'FAILED',
      labelColor: success ? UI.COLORS.good : UI.COLORS.bad,
    } : null;

    this.roll = { c, res, display, success, who, t: 0 };
    this.mode = 'roll';
    sfx('dice');
    if (c.spentKey && S()) setFlag(S(), c.spentKey, true);
  }

  _updateRoll(dt) {
    const r = this.roll;
    if (!r) { this.mode = 'choose'; return; }
    r.t += dt;
    const m = Input.mouse;
    const clicked = !!(m && m.clicked);
    if (clicked && m) m.clicked = false;
    const pressed = Input.consume('confirm') || Input.consume('cancel') || clicked;
    if (r.t >= ROLL_HOLD || (pressed && r.t >= ROLL_MIN)) {
      sfx(r.success ? 'select' : 'back');
      this.roll = null;
      this._resolveChoice(r.c, r.success);
    }
  }

  /** Apply a chosen branch: run its `do`, then jump. */
  _resolveChoice(c, success) {
    const raw = c.raw || {};
    const ck = c.check || {};
    let target;
    if (c.check) {
      target = success
        ? (ck.success ?? raw.success ?? raw.goto ?? raw.next)
        : (ck.failure ?? ck.fail ?? raw.failure ?? raw.fail ?? raw.goto ?? raw.next);
    } else {
      target = raw.goto ?? raw.next;
    }

    const act = c.check ? (success ? (raw.do || ck.do) : (raw.failDo || ck.failDo)) : raw.do;
    if (act) {
      const r = this._runDo(act);
      if (r.close) { this._close(); return; }
      if (r.goto) { this._goto(r.goto); return; }
    }
    // A branch with nowhere to go ends the conversation — _goto handles null.
    this._goto(target == null ? null : target);
  }

  // --- node / choice actions ---------------------------------------------

  /**
   * Run a `do:{}` block. Supported keys:
   *   shop, quest, complete, flag, give, take, gold, recruit, heal, rest,
   *   teach, battle, warp, rep, xp, close, say, goto
   * -> { close, goto }
   */
  _runDo(d) {
    const out = { close: false, goto: null };
    if (!d) return out;
    if (Array.isArray(d)) {
      for (const one of d) {
        const r = this._runDo(one);
        if (r.close) return r;
        if (r.goto) return r;
      }
      return out;
    }
    if (!isObj(d)) return out;
    const st = S();
    const msgs = [];

    if (d.flag != null) {
      for (const f of arr(d.flag)) {
        if (isObj(f)) { for (const [k, v] of Object.entries(f)) if (st) setFlag(st, k, v); }
        else if (st) setFlag(st, String(f), true);
      }
    }
    if (d.clearFlag != null && st) for (const f of arr(d.clearFlag)) setFlag(st, String(f), false);

    if (d.gold != null) {
      const n = Number(d.gold) || 0;
      if (n < 0 && !Party.canAfford(-n)) msgs.push('You cannot cover that.');
      else { Party.addGold(n); sfx('coin'); msgs.push(n >= 0 ? `+${n} gp` : `${n} gp`); }
      if (st) { if (n > 0) st.stats.goldEarned += n; else st.stats.goldSpent += -n; }
    }

    for (const g of arr(d.give ?? d.giveItem)) {
      const spec = isObj(g) ? g : { id: g, qty: 1 };
      const id = spec.id || spec.item;
      const qty = spec.qty || spec.count || 1;
      if (Party.addItem(id, qty)) { sfx('item'); msgs.push(`Received ${itemLabel(id)}${qty > 1 ? ` ×${qty}` : ''}`); }
    }
    for (const g of arr(d.take ?? d.takeItem)) {
      const spec = isObj(g) ? g : { id: g, qty: 1 };
      Party.removeItem(spec.id || spec.item, spec.qty || spec.count || 1);
    }

    for (const q of arr(d.quest ?? d.startQuest)) {
      const id = isObj(q) ? q.id : String(q);
      const def = QUESTS()[id] || (isObj(q) ? q : null);
      if (st && def && startQuest(st, def)) {
        sfx('quest');
        safe(() => toast(`Quest: ${def.title || id}`, { kind: 'quest' }));
      }
    }
    for (const q of arr(d.complete ?? d.turnIn ?? d.questDone)) {
      const id = isObj(q) ? q.id : String(q);
      if (st && completeQuest(st, id)) {
        sfx('quest');
        this._grantQuestRewards(QUESTS()[id]);
        safe(() => toast(`Completed: ${QUESTS()[id]?.title || id}`, { kind: 'quest' }));
      }
    }

    if (d.rep) {
      for (const r of arr(d.rep)) {
        const id = isObj(r) ? (r.id || r.faction) : String(r);
        const amt = isObj(r) ? (r.amount ?? r.value ?? 1) : 1;
        if (st) { addReputation(st, id, amt); msgs.push(`${factionName(id)} ${amt >= 0 ? '+' : ''}${amt}`); }
      }
    }

    if (d.xp != null) {
      const n = Number(d.xp) || 0;
      for (const m of Party.members) safe(() => grantXp(m, n));
      if (n) msgs.push(`+${n} XP`);
    }

    if (d.recruit) { const m = this._recruit(d.recruit); if (m) msgs.push(m); }
    if (d.teach) { const m = this._teach(d.teach); if (m) msgs.push(m); }
    if (d.heal || d.rest) { const m = this._heal(d.heal === true ? {} : (d.heal || d.rest)); if (m) msgs.push(m); }

    if (d.shop) {
      const spec = isObj(d.shop) ? d.shop : { id: String(d.shop) };
      safe(() => Game.push(new ShopScene(spec.id || spec.shop, { npc: this.npc, ...spec })));
    }

    if (d.battle) { this._startBattle(isObj(d.battle) ? d.battle : { group: String(d.battle) }); out.close = true; }
    if (d.warp) { this._warp(d.warp); out.close = true; }

    if (d.say) msgs.push(String(d.say));
    if (msgs.length) this._say(msgs.join('   '));
    if (d.close) out.close = true;
    if (d.goto) out.goto = d.goto;
    return out;
  }

  _grantQuestRewards(def) {
    const rw = def && def.rewards;
    if (!rw) return;
    if (rw.gold) { Party.addGold(rw.gold); sfx('coin'); }
    if (rw.xp) for (const m of Party.members) safe(() => grantXp(m, rw.xp));
    for (const it of arr(rw.items)) {
      const spec = isObj(it) ? it : { id: it, qty: 1 };
      Party.addItem(spec.id || spec.item, spec.qty || 1);
    }
  }

  /** Hire a companion from data/npcs.js RECRUITS for a purse of gold. */
  _recruit(spec) {
    const s = isObj(spec) ? spec : { id: String(spec) };
    const entry = RECRUITS().find((r) => r && r.id === s.id) || (isObj(s.entry) ? s.entry : null);
    if (!entry) return 'They have already taken another road.';
    if (Party.all().some((m) => m && m.recruitId === entry.id)) return 'They already march with you.';
    const cost = s.cost != null ? Number(s.cost) : Number(entry.cost || 0);
    if (!Party.canAfford(cost)) return `${entry.name} wants ${cost} gp.`;

    const ch = safe(() => createCharacter({
      name: entry.name,
      speciesId: entry.speciesId,
      lineageId: entry.lineageId || null,
      classId: entry.classId,
      subclassId: entry.subclassId || null,
      backgroundId: entry.backgroundId || entry.background || null,
      level: entry.level || Math.max(1, Party.levelAvg()),
      abilities: entry.abilities || null,
      appearance: entry.appearance || null,
      kind: 'pc',
    }), null);
    if (!ch) return 'They cannot be found.';
    ch.recruitId = entry.id;
    if (entry.colorway) ch.colorway = entry.colorway;
    if (entry.personality) ch.notes = entry.personality;
    safe(() => recalc(ch));

    if (!Party.add(ch)) return 'Your company is already full.';
    Party.spendGold(cost);
    sfx('levelup');
    safe(() => toast(`${entry.name} joins the company.`, { kind: 'party' }));
    return `${entry.name} joins you for ${cost} gp.`;
  }

  /** Teach a spell — Sister Garaele and the Phandalin hedge-mages do this. */
  _teach(spec) {
    const s = isObj(spec) ? spec : { spell: String(spec) };
    const spellId = s.spell || s.id;
    const sp = safe(() => getSpell(spellId), null);
    if (!sp) return 'That lore is lost to the Realms.';
    const lists = arr(sp.lists);
    const target = Party.members.find((m) => m && m.uid === s.uid)
      || Party.members.find((m) => m && arr(m.classes).some((k) => lists.includes(k.id)))
      || Party.members.find((m) => m && m.spells);
    if (!target) return 'None of you can hold that spell.';
    const cost = Number(s.cost || 0);
    if (cost && !Party.spendGold(cost)) return `That teaching costs ${cost} gp.`;

    target.spells = target.spells || { known: [], prepared: [], cantrips: [] };
    const bucket = sp.level === 0 ? 'cantrips' : 'known';
    target.spells[bucket] = arr(target.spells[bucket]);
    if (!target.spells[bucket].includes(spellId)) target.spells[bucket].push(spellId);
    safe(() => recomputeSpells(target));
    safe(() => recalc(target));
    sfx('spell');
    return `${target.name} learns ${sp.name}.`;
  }

  _heal(spec) {
    const s = isObj(spec) ? spec : {};
    const cost = Number(s.cost || 0);
    if (cost && !Party.spendGold(cost)) return `That would cost ${cost} gp.`;
    if (cost) sfx('coin');
    safe(() => Party.longRest());
    safe(() => Party.healAll());
    const st = S();
    if (st) {
      safe(() => advanceTime(st, s.minutes != null ? s.minutes : (s.hours != null ? s.hours * 60 : 480)));
      st.stats.longRests = (st.stats.longRests || 0) + 1;
    }
    sfx('heal');
    safe(() => FX.flash('#ffe9a8', 0.45));
    return 'The party is rested and whole.';
  }

  _startBattle(spec) {
    const { combat, scaling, combatui } = LATE;
    if (!combat || !scaling || !combatui) { this._say('That fight can wait.'); return; }
    safe(() => {
      const level = Math.max(1, Party.levelAvg());
      const enemies = [];
      const listed = arr(spec.monsters || spec.enemies || (spec.id ? [spec.id] : []));
      for (const e of listed) {
        const one = isObj(e) ? e : { id: String(e), count: 1 };
        for (let i = 0; i < (one.count || 1); i++) {
          const mob = scaling.makeMonster(one.id, { level: one.level || level });
          if (mob) enemies.push(mob);
        }
      }
      if (!enemies.length && spec.group && scaling.rollEncounter) {
        const roll = scaling.rollEncounter({ biome: spec.biome || 'road', level, size: Party.size });
        for (const g of arr(roll && roll.monsters)) {
          for (let i = 0; i < (g.count || 1); i++) {
            const mob = scaling.makeMonster(g.id, { level });
            if (mob) enemies.push(mob);
          }
        }
      }
      if (!enemies.length) return;
      const enc = combat.buildEncounter({
        party: Party.members, enemies, biome: spec.biome || 'road',
        boss: !!spec.boss, ambush: !!spec.ambush,
      });
      Game.transition('battle', () => { safe(() => Game.push(new combatui.BattleScene(enc))); });
    });
  }

  _warp(w) {
    const spec = typeof w === 'string' ? { map: w } : (w || {});
    const ow = LATE.overworld;
    if (!ow || typeof ow.travelTo !== 'function') { this._say('The road is not open yet.'); return; }
    Game.transition('fade', () => {
      safe(() => ow.travelTo(spec.map || spec.mapId, spec.x, spec.y, spec.dir || 'down'));
    });
  }

  // --- helpers -----------------------------------------------------------

  _say(text, seconds = 2.4) { this.footer = String(text); this.footerT = seconds; }

  _close(result) {
    if (this._closed) return;
    this._closed = true;
    sfx('back');
    if (Game.top === this) Game.pop(result);
  }

  _choiceLayout() {
    const n = Math.max(1, this.choices.length);
    const rows = Math.max(1, Math.min(CH_MAX_ROWS, n));
    const h = rows * CH_ROW + 8;
    const y = BOX_Y - h - 6;
    return { x: CH_X, y, w: CH_W, h, rows, listX: CH_X + 5, listY: y + 4, listW: CH_W - 10 };
  }

  /** The character whose bust fills the portrait frame. */
  _portraitOf() {
    const p = this.node && this.node.portrait;
    if (p === 'player') return Party.members[0] || this.npc;
    if (p === 'party') return Party.members[1] || Party.members[0] || this.npc;
    if (typeof p === 'string') return NPCS()[p] || this.npc;
    if (isObj(p)) return p;
    return this.npc;
  }

  // --- draw --------------------------------------------------------------

  draw(ctx) {
    UI.scrim(ctx, 0.30);
    if (!this.tree) { this._drawBox(ctx, '…'); return; }
    this._drawBox(ctx, null);
    if (this.mode === 'choose' || (this.mode === 'roll' && this.choices.length)) this._drawChoices(ctx);
    if (this.mode === 'roll' && this.roll) this._drawRoll(ctx);
  }

  _drawBox(ctx, placeholder) {
    const p = UI.panel(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, { style: 'window' });
    const speaker = this._speakerName(this.node);

    // --- brass name plate, notched over the top-left corner -----------------
    // The 'gold' panel is a light plate, so the name is struck in dark ink with a
    // pale highlight beneath it — like lettering stamped into metal.
    const tw = Math.min(184, safe(() => UI.measure(speaker, 'md'), 60) + 16);
    UI.panel(ctx, BOX_X + 8, BOX_Y - 7, tw, 15, { style: 'gold', shadow: 0.35, studs: false });
    UI.text(ctx, BOX_X + 15, BOX_Y - 3, speaker, {
      size: 'md', color: '#2a1c07', shadow: 'rgba(255,246,214,0.55)', maxWidth: tw - 14,
    });

    this._drawPortrait(ctx, this._portraitOf(), PORT_X, PORT_Y, PORT_S);

    if (placeholder != null) {
      UI.text(ctx, TEXT_X, TEXT_Y + 12, placeholder, { size: 'sm', color: UI.COLORS.inkDim, shadow: true });
      return;
    }

    // --- typewriter body ----------------------------------------------------
    const pg = this.pages[this.page];
    if (pg) {
      const adv = advOf('sm');
      const lineH = 9;
      const shown = Math.floor(this.shown);
      const first = Math.max(0, Math.min(pg.lines.length - TEXT_LINES,
        this._scrollFor(pg, shown)));
      for (let li = 0; li < TEXT_LINES; li++) {
        const line = pg.lines[first + li];
        if (!line) break;
        const ly = TEXT_Y + li * lineH;
        for (const seg of line.segs) {
          const segStart = line.start + seg.off;
          const vis = clamp(shown - segStart, 0, seg.text.length);
          if (vis <= 0) continue;
          UI.text(ctx, TEXT_X + seg.off * adv, ly, seg.text.slice(0, vis), {
            size: 'sm', color: seg.color || p.ink || UI.COLORS.ink, shadow: true,
          });
        }
      }
      // page pips when a node runs longer than one screen
      if (this.pages.length > 1) {
        for (let i = 0; i < this.pages.length && i < 12; i++) {
          ctx.fillStyle = i === this.page ? UI.COLORS.gold : UI.COLORS.goldDim;
          ctx.fillRect(TEXT_X + i * 5, BOX_Y + BOX_H - 9, 3, 2);
        }
      }
    }

    // --- footer: status line, then key hints --------------------------------
    const fy = BOX_Y + BOX_H - 12;
    if (this.footer) {
      UI.text(ctx, TEXT_X + 42, fy, this.footer, {
        size: 'sm', color: UI.COLORS.gold, shadow: true, maxWidth: TEXT_W - 100,
      });
    } else if (this.mode === 'choose') {
      UI.text(ctx, BOX_X + BOX_W - 8, fy, 'Z choose   X leave', {
        size: 'sm', color: UI.COLORS.inkDim, align: 'right', shadow: true,
      });
    }

    const pgDone = pg && this.shown >= pg.length;
    if (this.mode === 'text' && pgDone) UI.advanceCaret(ctx, BOX_X + BOX_W - 14, BOX_Y + BOX_H - 14, this.t);
  }

  /** Which wrapped line to scroll to while a long page is still typing. */
  _scrollFor(pg, shown) {
    if (pg.lines.length <= TEXT_LINES) return 0;
    let at = 0;
    for (let i = 0; i < pg.lines.length; i++) if (pg.lines[i].start <= shown) at = i;
    return Math.max(0, at - TEXT_LINES + 1);
  }

  _drawPortrait(ctx, ch, x, y, size) {
    const f = UI.panel(ctx, x, y, size, size, { style: 'inset', shadow: 0.3 });
    const ix = f.ix + 1;
    const iy = f.iy + 1;
    const iw = Math.max(1, f.iw - 2);
    const ih = Math.max(1, f.ih - 2);
    ctx.fillStyle = '#16110d';
    ctx.fillRect(ix, iy, iw, ih);

    const art = !!(ch && (ch.appearance || (ch.sprite && safe(() => hasSprite(ch.sprite), false))));
    if (art) {
      safe(() => { drawActorBust(ctx, ch, ix, iy, Math.min(iw, ih)); return true; }, false);
    } else {
      // No sprite family registered yet: a lettered signet still reads as a person.
      const name = (ch && ch.name) || this._speakerName(this.node);
      ctx.fillStyle = 'rgba(227,179,74,0.10)';
      ctx.fillRect(ix, iy, iw, ih);
      UI.text(ctx, ix + iw / 2, iy + ih / 2 - 6, String(name).charAt(0).toUpperCase(), {
        size: 'lg', color: UI.COLORS.goldDim, align: 'center', shadow: true,
      });
    }

    // Role / faction caption under the bust — free characterisation, zero words.
    const role = (ch && (ch.role || ch.title))
      || (ch && ch.faction ? factionName(ch.faction) : null);
    if (role) {
      UI.text(ctx, x + size / 2, y + size + 3, String(role).replace(/-/g, ' '), {
        size: 'sm', color: UI.COLORS.gold, align: 'center', shadow: 'rgba(0,0,0,0.8)', maxWidth: size + 8,
      });
    }
  }

  _drawChoices(ctx) {
    const L = this._choiceLayout();
    UI.panel(ctx, L.x, L.y, L.w, L.h, { style: 'window' });

    const items = this.choices.map((c) => {
      const hint = c.disabled
        ? (c.reason ? `✗ ${c.reason}` : '✗')
        : (c.tag || '');
      return {
        label: c.label,
        hint: c.attack ? 'ATTACK' : hint,
        hintColor: c.disabled ? UI.COLORS.bad : c.attack ? UI.COLORS.red : UI.COLORS.gold,
        disabled: c.disabled,
        icon: c.attack ? 'sword' : undefined,
        // Violence is offered in red so it is never picked by accident.
        color: c.disabled ? UI.COLORS.disabled : c.attack ? UI.COLORS.red : undefined,
      };
    });

    const r = UI.list(ctx, L.listX, L.listY, L.listW, items, this.index, {
      rows: L.rows, rowH: CH_ROW, top: this.listTop, t: this.t, scrollbar: this.choices.length > L.rows,
    });
    this.listTop = r.top;
  }

  _drawRoll(ctx) {
    const r = this.roll;
    UI.scrim(ctx, 0.35);
    const cx = 200;
    const cy = 84;
    safe(() => UI.diceRoll(ctx, cx, cy, r.display, r.t));

    // Who is rolling, and against what — the maths is the point.
    const who = (r.who && r.who.name) || 'The party';
    const what = r.c.check.skill ? SKILLS[r.c.check.skill].name : (ABILITY_ABBR[r.c.check.ability] || 'Check');
    UI.text(ctx, cx, cy - 44, `${who} — ${what}`, {
      size: 'md', color: UI.COLORS.gold, align: 'center', shadow: true, maxWidth: 260,
    });
    if (r.t >= ROLL_MIN) {
      UI.text(ctx, cx, cy + 44, 'Z continue', {
        size: 'sm', color: UI.COLORS.inkDim, align: 'center', shadow: true,
      });
    }
  }
}

function checkLabel(check) {
  if (check.skill && SKILLS[check.skill]) return SKILLS[check.skill].name;
  return ABILITY_ABBR[check.ability] || 'Check';
}

// ===========================================================================
// 7. say() — one-off lines without authoring a dialogue tree
// ===========================================================================

/**
 * Show a quick message (or a list of pages) in the standard dialogue window.
 *   say('The chest is empty.')
 *   say(['Gundren clasps your arm.', 'Meet me in Phandalin, {name}.'], { npc, speaker })
 * opts: { npc, speaker, choices, rumor, onClose, push:false }
 * -> the DialogueScene (already pushed unless opts.push === false)
 */
export function say(lines, opts = {}) {
  const pages = arr(lines).map((l) => String(l == null ? '' : l)).filter((l) => l.length);
  const list = pages.length ? pages : ['…'];
  const nodes = {};
  list.forEach((text, i) => {
    const last = i === list.length - 1;
    nodes[`p${i}`] = {
      text,
      speaker: opts.speaker,
      goto: last ? null : `p${i + 1}`,
      choices: last ? opts.choices : null,
      portrait: opts.portrait,
    };
  });
  const scene = new DialogueScene({ start: 'p0', nodes }, opts.npc || null, {
    ...opts, id: opts.id || 'say',
  });
  if (opts.push !== false) safe(() => Game.push(scene));
  return scene;
}

export default DialogueScene;
