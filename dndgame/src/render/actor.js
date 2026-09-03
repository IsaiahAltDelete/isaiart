// render/actor.js — turns a Character into a drawable sprite by stacking the
// body / ears / hair / outfit / cloak / helm / weapon layers and recolouring each
// from the character's colorway. The composited result is cached by a signature,
// so a character costs one drawImage per frame no matter how many layers it has.

import { composeSprite, drawComposed, drawSprite, hasSprite, makeColorway, spriteDef } from './sprites.js';
import { monsterArtFor } from './spritedata_monsters.js';
import { SPRITE_W, SPRITE_H, DIRS } from '../constants.js';
import { hashStr } from '../core/rng.js';
import { resolveItem } from '../data/items.js';
import { SPECIES } from '../data/species.js';

// Draw order, back to front. Cloaks go behind the body; hair behind a helm.
const ORDER = ['cloak', 'tail', 'body', 'boots', 'ears', 'face', 'hair', 'beard', 'outfit', 'horns', 'helm', 'shield', 'weapon'];

/**
 * The species sprite flags for a character, lineage overriding species.
 * Read from the data rather than the saved appearance so a character rolled
 * before these layers existed still grows their tusks.
 */
function speciesMods(ch) {
  const sp = SPECIES?.[ch.speciesId];
  if (!sp) return {};
  const lin = (sp.lineages || []).find((l) => l.id === ch.lineageId);
  return { ...(sp.spriteMods || {}), ...(lin?.spriteMods || {}) };
}

// --- equipment -> sprite layer mapping ------------------------------------

/**
 * The rest of the outfit: what a class puts on its head, over its shoulders and
 * on its feet when the player has not chosen otherwise.
 *
 * `'auto'` is the point of this. Before it, `appearance.helmStyle` defaulted to
 * `'helm-none'`, which is also what a player picks when they want a bare head --
 * the two were the same value, so a class default could not be applied without
 * silently overriding a deliberate choice. `'auto'` means "you decide", and
 * `'helm-none'` now means what it says.
 *
 * Characters saved before this have real style ids and so keep exactly the look
 * they had. Boots are the exception: nothing ever stored a bootStyle, so an old
 * character reads as `'auto'` and gets the boots of their calling.
 */
const CLASS_KIT = {
  barbarian: { helm: 'helm-none', cloak: 'cloak-short', boots: 'boots-wraps' },
  bard: { helm: 'helm-cap', cloak: 'cloak-short', boots: 'boots-court' },
  cleric: { helm: 'helm-circlet', cloak: 'cloak-none', boots: 'boots-cuffed' },
  druid: { helm: 'helm-hood', cloak: 'cloak-none', boots: 'boots-wraps' },
  fighter: { helm: 'helm-cap', cloak: 'cloak-none', boots: 'boots-tall' },
  monk: { helm: 'helm-none', cloak: 'cloak-none', boots: 'boots-sandal' },
  paladin: { helm: 'helm-cap', cloak: 'cloak-long', boots: 'boots-plate' },
  ranger: { helm: 'helm-hood', cloak: 'cloak-short', boots: 'boots-tall' },
  rogue: { helm: 'helm-hood', cloak: 'cloak-short', boots: 'boots-cuffed' },
  sorcerer: { helm: 'helm-none', cloak: 'cloak-short', boots: 'boots-court' },
  warlock: { helm: 'helm-none', cloak: 'cloak-long', boots: 'boots-tall' },
  wizard: { helm: 'helm-wizard', cloak: 'cloak-long', boots: 'boots-cuffed' },
};

const KIT_FALLBACK = { helm: 'helm-none', cloak: 'cloak-none', boots: 'boots-cuffed' };

/** One slot of a class's default kit. */
function kitFor(ch, slot) {
  const k = CLASS_KIT[ch.classes?.[0]?.id];
  return (k && k[slot]) || KIT_FALLBACK[slot];
}

/** Resolve a chosen style, letting 'auto' (or nothing at all) defer to the class. */
function styleOr(chosen, ch, slot) {
  if (chosen && chosen !== 'auto') return chosen;
  return kitFor(ch, slot);
}

/** What each calling wears when it is not wearing armour. */
const CLASS_DRESS = {
  barbarian: 'outfit-fur',
  bard: 'outfit-doublet',
  cleric: 'outfit-vestments',
  druid: 'outfit-druidwear',
  fighter: 'outfit-gambeson',
  monk: 'outfit-monk',
  paladin: 'outfit-tabard',
  ranger: 'outfit-ranger',
  rogue: 'outfit-jerkin',
  sorcerer: 'outfit-robe',
  warlock: 'outfit-coat',
  wizard: 'outfit-robe',
};

/** Which body-armour sprite an equipped armour maps to. */
function outfitFor(ch) {
  const armor = ch.equipment?.armor;
  const id = typeof armor === 'string' ? armor : armor?.id;
  const it = id ? resolveItem(id) : null;
  if (it) {
    const byId = {
      padded: 'outfit-tunic', leather: 'outfit-leather', 'studded-leather': 'outfit-studded',
      hide: 'outfit-hide', 'chain-shirt': 'outfit-chain', 'scale-mail': 'outfit-scale',
      breastplate: 'outfit-brigandine', 'half-plate': 'outfit-half-plate',
      'ring-mail': 'outfit-chain', 'chain-mail': 'outfit-chain', splint: 'outfit-half-plate',
      plate: 'outfit-plate',
    };
    if (byId[id]) return byId[id];
    if (it.category === 'heavy') return 'outfit-plate';
    if (it.category === 'medium') return 'outfit-scale';
    if (it.category === 'light') return 'outfit-leather';
  }
  // No armour: dress by class. This used to fold twelve classes into three
  // looks -- robe, wrap, or the same brown tunic -- so an unarmoured party was
  // six people in one costume.
  const cls = ch.classes?.[0]?.id;
  if (CLASS_DRESS[cls] && hasSprite(CLASS_DRESS[cls])) return CLASS_DRESS[cls];
  return ch.appearance?.outfitStyle || 'outfit-tunic';
}

/** Which weapon sprite the character holds. */
function weaponFor(ch) {
  const mh = ch.equipment?.mainHand;
  const id = typeof mh === 'string' ? mh : mh?.id;
  const it = id ? resolveItem(id) : null;
  if (!it) return 'wep-none';
  const byId = {
    longsword: 'wep-sword', shortsword: 'wep-sword', greatsword: 'wep-greatsword',
    scimitar: 'wep-scimitar', rapier: 'wep-rapier', dagger: 'wep-dagger',
    handaxe: 'wep-axe', battleaxe: 'wep-axe', greataxe: 'wep-greataxe',
    mace: 'wep-mace', warhammer: 'wep-hammer', maul: 'wep-hammer',
    'light-hammer': 'wep-hammer', morningstar: 'wep-mace', flail: 'wep-flail',
    club: 'wep-mace', greatclub: 'wep-hammer', quarterstaff: 'wep-staff',
    spear: 'wep-spear', pike: 'wep-spear', trident: 'wep-spear', javelin: 'wep-spear',
    lance: 'wep-spear', glaive: 'wep-halberd', halberd: 'wep-halberd',
    shortbow: 'wep-bow', longbow: 'wep-bow',
    'light-crossbow': 'wep-crossbow', 'heavy-crossbow': 'wep-crossbow', 'hand-crossbow': 'wep-crossbow',
    sling: 'wep-dagger', sickle: 'wep-scimitar', whip: 'wep-dagger', 'war-pick': 'wep-axe',
  };
  const base = String(id).replace(/-plus\d$/, '');
  if (byId[base]) return byId[base];
  // Fall back on the weapon's shape hints.
  if (it.props?.includes('ammunition')) return 'wep-bow';
  if (it.props?.includes('two-handed')) return 'wep-greatsword';
  if (it.dtype === 'bludgeoning') return 'wep-mace';
  if (it.dtype === 'piercing') return 'wep-dagger';
  return 'wep-sword';
}

function shieldFor(ch) {
  const oh = ch.equipment?.offHand;
  const id = typeof oh === 'string' ? oh : oh?.id;
  if (!id) return 'shield-none';
  const it = resolveItem(id);
  if (!it || it.kind !== 'shield') return 'shield-none';
  if (String(id).includes('tower')) return 'shield-tower';
  if (String(id).includes('kite')) return 'shield-kite';
  return 'shield-round';
}

function helmFor(ch) {
  const h = ch.equipment?.helm;
  const id = typeof h === 'string' ? h : h?.id;
  if (id) {
    if (String(id).includes('crown')) return 'helm-crown';
    if (String(id).includes('circlet') || String(id).includes('headband')) return 'helm-circlet';
    if (String(id).includes('hat')) return 'helm-wizard';
    if (String(id).includes('hood')) return 'helm-hood';
    if (String(id).includes('great') || String(id).includes('plate')) return 'helm-great';
    if (String(id).includes('horn')) return 'helm-horned';
    return 'helm-cap';
  }
  return styleOr(ch.appearance?.helmStyle, ch, 'helm');
}

/** Cloaks are appearance-only; nothing in the equipment list maps to one yet. */
function cloakFor(ch) {
  return styleOr(ch.appearance?.cloakStyle, ch, 'cloak');
}

/**
 * Boots. Armour on the body implies armoured feet: a character in plate gets
 * sabatons whatever their calling would otherwise have put them in.
 */
function bootsFor(ch) {
  const a = ch.appearance || {};
  if (a.bootStyle && a.bootStyle !== 'auto') return a.bootStyle;
  const armor = outfitFor(ch);
  if (armor === 'outfit-plate' || armor === 'outfit-half-plate') return 'boots-plate';
  return kitFor(ch, 'boots');
}

function bodyFor(ch) {
  const a = ch.appearance || {};
  if (a.bodyStyle) return a.bodyStyle;
  const size = ch.size || 'medium';
  if (size === 'small') return 'body-small';
  // A dwarf is not a short human and cannot be drawn as one -- the head is
  // pinned to rows 2-9 by every helm and hair layer. The stout frame carries
  // it instead: thicker chest, shorter shank.
  const sm = speciesMods(ch);
  if (sm.build === 'stout') return 'body-stout';
  const build = a.build || 'normal';
  if (build === 'stout') return 'body-stout';
  if (build === 'slim') return 'body-slim';
  if (build === 'broad') return 'body-broad';
  if (build === 'tall') return 'body-tall';
  return 'body-normal';
}

// --- colorway -------------------------------------------------------------

/**
 * Build (and cache on the character) the colour token map the sprite layers use.
 * Armour tints the METAL/LEATHER tokens so a plate-armoured knight reads as steel
 * even though the sprite art is shared.
 */
export function colorwayOf(ch) {
  const a = ch.appearance || {};
  const sig = [a.skin, a.hair, a.eye, a.outfit, a.outfitAlt, a.accent, a.metal, a.leather].join('|');
  if (ch._cwSig === sig && ch.colorway) return ch.colorway;
  const cw = makeColorway({
    skin: a.skin || '#e0a878',
    hair: a.hair || '#3a2416',
    eye: a.eye || '#37527a',
    main: a.outfit || '#7a3030',
    alt: a.outfitAlt || '#2f4f7f',
    metal: a.metal || '#aab2c0',
    leather: a.leather || '#6b4a2a',
    cloth: a.cloth || '#c8b58a',
    accent: a.accent || '#e3b34a',
    horn: a.hornColor || '#8c8377',
  });
  ch.colorway = cw;
  ch._cwSig = sig;
  return cw;
}

// --- layer assembly -------------------------------------------------------

/** The list of layers for a character at a given animation frame. */
export function actorLayers(ch, frame) {
  const a = ch.appearance || {};
  const cw = colorwayOf(ch);
  const L = [];
  const push = (name, extra) => { if (name && name.endsWith('-none') === false && hasSprite(name)) L.push({ name, frame, colorway: cw, ...extra }); };

  push(cloakFor(ch));
  if (a.tail) push(`tail-${a.tail}`);
  push(bodyFor(ch));
  push(bootsFor(ch));
  const sm = speciesMods(ch);
  const ears = a.ears || sm.ears;
  if (ears && ears !== 'round' && ears !== 'none') push(`ears-${ears}`);
  // Species features, over the face and under the hair.
  if (a.scales ?? sm.scales) push('face-scales');
  if (a.snout ?? sm.snout) push((a.fur ?? sm.fur) ? 'face-muzzle' : 'face-snout');
  if (a.tusks ?? sm.tusks) push('face-tusks');
  if (a.markings ?? sm.markings) push('face-markings');
  const helm = helmFor(ch);
  // A great helm hides the hair; a circlet or cap sits on top of it.
  if (helm !== 'helm-great' && helm !== 'helm-hood') push(`hair-${a.hairStyle || 'short'}`);
  if (a.beard && a.beard !== 'none') push(`beard-${a.beard}`);
  push(outfitFor(ch));
  if (a.horns) push(`horns-${a.horns}`);
  push(helm);
  push(shieldFor(ch));
  push(weaponFor(ch));
  return L;
}

/** A stable signature so identical appearances share one composed canvas. */
function actorSig(ch, frame) {
  const a = ch.appearance || {};
  const eq = ch.equipment || {};
  const idOf = (v) => (typeof v === 'string' ? v : v?.id || '');
  return hashStr([
    frame, bodyFor(ch), a.hairStyle, a.beard, a.ears, a.horns, a.tail,
    ch.speciesId, ch.lineageId, ch.classes?.[0]?.id,
    a.cloakStyle, a.helmStyle, a.outfitStyle, a.bootStyle,
    helmFor(ch), cloakFor(ch), bootsFor(ch),
    idOf(eq.armor), idOf(eq.mainHand), idOf(eq.offHand), idOf(eq.helm),
    a.skin, a.hair, a.eye, a.outfit, a.outfitAlt, a.accent, a.metal, a.leather,
  ].join('')).toString(36);
}

/** Get the composed canvas for one frame of a character. */
export function actorCanvas(ch, frame, opts = {}) {
  let layers = actorLayers(ch, frame);
  if (!layers.length) return null;
  // The weapon can be pulled out and drawn separately so it can swing on its
  // own — a body that lunges with a sword welded to its fist is a body being
  // shoved, not a body striking. `omitWeapon` leaves the hand empty.
  if (opts.omitWeapon) layers = layers.filter((l) => !String(l.name).startsWith('wep-'));
  if (!layers.length) return null;
  // Composite height is the tallest layer so hats and weapons aren't clipped.
  let h = SPRITE_H, w = SPRITE_W;
  for (const l of layers) {
    const d = spriteDef(l.name);
    if (d) { h = Math.max(h, d.h); w = Math.max(w, d.w); }
  }
  const sig = `${actorSig(ch, frame)}${opts.omitWeapon ? '|nw' : ''}|${w}x${h}`;
  return composeSprite(sig, w, h, layers);
}

/** The character's weapon sprite name, or null when their hands are empty. */
export function weaponSpriteOf(ch) {
  const n = weaponFor(ch);
  return n && n !== 'wep-none' && hasSprite(n) ? n : null;
}

// --- public draw API ------------------------------------------------------

/**
 * Draw a character with their feet at (x, y).
 * opts: { dir='down', phase=0, moving, scale=1, alpha, tint, tintAmt, shadow=true,
 *         flip, bob, downed }
 */
export function drawActor(ctx, ch, x, y, opts = {}) {
  if (!ch) return false;
  const dir = opts.dir || ch.dir || 'down';
  const frame = opts.frame || `${dir}-${opts.moving ? [0, 1, 0, 2][(opts.phase | 0) & 3] : (opts.idleBob ? 3 : 0)}`;

  // Monsters and NPCs that ship as a single finished sprite skip composition.
  // A creature resolves its art through the bestiary's own map, which knows
  // that 'dragon' means dragon-adult in red at 62% tint and that 'spider' means
  // the phase-spider body. Without this every creature whose catalogue sprite
  // name has no art — 127 of 275, dragons included — fell through to the
  // LAYERED path below and was drawn as a human being.
  const art = ch.monsterId && !ch.layered ? monsterArtFor(ch.monsterId, ch.sprite) : null;
  const spriteName = art ? art.sprite : ch.sprite;
  if (spriteName && hasSprite(spriteName) && !ch.layered) {
    // Three tints can apply, in order of authority: the one the CALLER passes
    // (a hit flash, a corpse), the one on the INSTANCE (the catalogue's own
    // colour for this creature), and the FAMILY one (which colour of dragon
    // this is). Each carries its own strength — a caller's amount belongs only
    // to a caller's tint, and it is routinely 0, so it must not be inherited by
    // the other two or a red dragon comes out grey.
    let tint = opts.tint || null;
    let tintAmt = opts.tintAmt;
    if (!tint && ch.tint) { tint = ch.tint; tintAmt = art && art.tint ? art.tintAmt : 0.6; }
    if (!tint && art && art.tint) { tint = art.tint; tintAmt = art.tintAmt; }
    return drawSprite(ctx, spriteName, frame, x, y, {
      colorway: ch.colorway || (ch.appearance ? colorwayOf(ch) : null),
      scale: (opts.scale || 1) * (art ? art.scale : 1),
      alpha: opts.alpha, tint, tintAmt,
      shadow: opts.shadow !== false, flip: opts.flip, bob: opts.bob,
      rotate: opts.rotate != null ? opts.rotate : (opts.downed ? Math.PI / 2 : 0),
    });
  }

  // A swing: the weapon layer is composed separately and rotated about the
  // fist, so the blade travels through the arc while the body holds its pose.
  // `swing` is radians; 0 is the rest position.
  const swing = opts.swing || 0;
  const wep = swing ? weaponSpriteOf(ch) : null;

  const canvas = actorCanvas(ch, frame, { omitWeapon: !!wep });
  if (!canvas) return false;
  const common = {
    scale: opts.scale || 1, alpha: opts.alpha, tint: opts.tint, tintAmt: opts.tintAmt,
    flip: opts.flip, bob: opts.bob,
    rotate: opts.rotate != null ? opts.rotate : (opts.downed ? Math.PI / 2 : 0),
  };
  drawComposed(ctx, canvas, x, y, { ...common, shadow: opts.shadow !== false, sig: `${actorSig(ch, frame)}${wep ? '|nw' : ''}` });

  if (wep) {
    const wc = composeSprite(`~wep|${wep}|${frame}|${actorSig(ch, frame)}`,
      spriteDef(wep)?.w || SPRITE_W, spriteDef(wep)?.h || SPRITE_H,
      [{ name: wep, frame, colorway: colorwayOf(ch) }]);
    if (wc) {
      const sc = opts.scale || 1;
      const left = !!(opts.facingLeft || opts.flip);
      // Pivot at the fist: a little under half way up the sprite, off centre
      // on the side the character is facing.
      const px = x + (left ? -3 : 3) * sc;
      const py = y - (wc.height * 0.45) * sc;
      ctx.save();
      ctx.translate(Math.round(px), Math.round(py));
      ctx.rotate(swing * (left ? -1 : 1));
      ctx.translate(-Math.round(px), -Math.round(py));
      drawComposed(ctx, wc, x, y, { ...common, shadow: false, sig: `${wep}|${frame}` });
      ctx.restore();
    }
  }
  return true;
}

/** Draw just the head-and-shoulders of a character, for portraits and dialogue. */
export function drawActorBust(ctx, ch, x, y, size = 32) {
  const canvas = ch.sprite && hasSprite(ch.sprite) && !ch.layered
    ? null : actorCanvas(ch, 'down-0');
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  const scale = size / 14;             // zoom so the head fills the frame
  if (canvas) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, canvas.width, 12, Math.round(x - (canvas.width * scale - size) / 2), Math.round(y - 1), Math.round(canvas.width * scale), Math.round(12 * scale));
  } else if (ch.sprite && hasSprite(ch.sprite)) {
    drawSprite(ctx, ch.sprite, 'down-0', x + size / 2, y + size * 1.6, {
      colorway: ch.colorway, scale, shadow: false,
    });
  }
  ctx.restore();
}

/**
 * Randomise an appearance for a species — used by "randomise" in character
 * creation and to give every generated NPC and recruit a distinct look.
 */
export function randomAppearance(species, r, opts = {}) {
  const cwPal = species?.colorways || {};
  const mods = species?.spriteMods || {};
  const pick = (arr, fb) => (arr && arr.length ? r.pick(arr) : fb);
  // A class dresses in its own colours when we know the class. Without this
  // the outfit came from one generic swatch list and a druid could roll the
  // same brown as a warlock.
  const cp = classPalette(opts.classId, r);
  const HAIR = ['short', 'long', 'ponytail', 'braid', 'curly', 'topknot', 'bob', 'wild', 'widowspeak', 'shaved', 'mohawk', 'bald'];
  const BEARD = mods.beard === 'common' ? ['full', 'braided', 'goatee', 'mustache', 'stubble']
    : mods.beard === 'none' ? ['none'] : ['none', 'none', 'stubble', 'goatee', 'full'];
  const OUTFITS = ['#7a3030', '#2f4f7f', '#3f6b3a', '#5a3a6b', '#8a6a2a', '#4a4a52', '#7a4a20', '#2f6b6b'];

  return {
    body: opts.body || r.pick(['m', 'f', 'n']),
    build: mods.build || r.pick(['slim', 'normal', 'normal', 'broad']),
    skin: pick(cwPal.skin, '#e0a878'),
    hair: pick(cwPal.hair, '#3a2416'),
    hairStyle: r.pick(HAIR),
    beard: r.pick(BEARD),
    eye: pick(cwPal.eye, '#37527a'),
    outfit: cp ? cp.main : r.pick(OUTFITS),
    outfitAlt: cp ? cp.alt : r.pick(OUTFITS),
    accent: cp ? cp.accent : r.pick(['#e3b34a', '#c0c6d0', '#b06a2a', '#7fbf6a']),
    metal: cp ? cp.metal : r.pick(['#aab2c0', '#c8b06a', '#9a8f80']),
    leather: cp ? cp.leather : r.pick(['#6b4a2a', '#54381f', '#7a5a34']),
    cloth: cp ? cp.cloth : r.pick(['#c8b58a', '#a89878', '#d8ccae']),
    ears: mods.ears && mods.ears !== 'round' ? mods.ears : null,
    horns: mods.horns ? r.pick(['curved', 'straight', 'ram', 'crown']) : null,
    tail: mods.tail ? r.pick(['thin', 'tufted', 'cat', 'scaled']) : null,
    hornColor: pick(cwPal.horn, '#8c8377'),
    // 'auto' hands these to the class. A player who wants a bare head or no
    // cloak picks the explicit 'none' and it is honoured.
    cloakStyle: 'auto',
    helmStyle: 'auto',
    bootStyle: 'auto',
    outfitStyle: 'outfit-tunic',
    height: mods.height || 1,
  };
}


/**
 * What each calling actually wears, in colour.
 *
 * The outfit GRIDS gave every class its own cut, but the colours came out of
 * one generic eight-swatch list, so a druid and a warlock could both roll the
 * same brown and the party read as one costume in different silhouettes. The
 * NPC families in spritedata_chars.js look as distinct as they do for exactly
 * this reason: each one is pinned to a coherent palette. This gives the player
 * classes the same treatment, with two or three sets each so two clerics in
 * one party are not twins.
 *
 * main = the garment, alt = its second colour, accent = trim and metal fittings,
 * cloth = the shirt/underlayer the body layer shows at the arms.
 */
export const CLASS_PALETTE = Object.freeze({
  barbarian: [
    { main: '#8a5a3a', alt: '#5a3f22', accent: '#c8b06a', metal: '#9a8f80', leather: '#6b4a2a', cloth: '#b8a678' },
    { main: '#6a5a4a', alt: '#3f2c18', accent: '#b8ab97', metal: '#8e939c', leather: '#4e3218', cloth: '#a89878' },
  ],
  bard: [
    { main: '#8a2a5a', alt: '#c8a860', accent: '#f0d264', metal: '#c8b06a', leather: '#6b4a2a', cloth: '#d8ccae' },
    { main: '#2f4f7f', alt: '#c8306a', accent: '#e3b34a', metal: '#c8b06a', leather: '#54381f', cloth: '#d8ccae' },
    { main: '#3f6b3a', alt: '#e0a020', accent: '#f0d264', metal: '#c8b06a', leather: '#6b4a2a', cloth: '#c8b58a' },
  ],
  cleric: [
    { main: '#e8e2d2', alt: '#c8b06a', accent: '#e3b34a', metal: '#c8b06a', leather: '#7a6a48', cloth: '#ddd6c4' },
    { main: '#dfe4ec', alt: '#8a9ab8', accent: '#c0c6d0', metal: '#aab2c0', leather: '#6b4a2a', cloth: '#d8ccae' },
  ],
  druid: [
    { main: '#5a6b3a', alt: '#7a5a34', accent: '#8a9a6a', metal: '#9a8f80', leather: '#4e3218', cloth: '#b8a678' },
    { main: '#6a7a4a', alt: '#54381f', accent: '#c8b06a', metal: '#8e939c', leather: '#5a3f22', cloth: '#a89878' },
  ],
  fighter: [
    { main: '#7a3030', alt: '#4a4a52', accent: '#c4a24a', metal: '#a8b0bd', leather: '#57381d', cloth: '#c8b58a' },
    { main: '#3a4a6a', alt: '#4a4a52', accent: '#c0c6d0', metal: '#9aa2b0', leather: '#4e3218', cloth: '#a8a090' },
  ],
  monk: [
    { main: '#c07a2a', alt: '#7a2a2a', accent: '#e0a020', metal: '#9a8f80', leather: '#6b4a2a', cloth: '#d8ccae' },
    { main: '#8a6a3a', alt: '#4a3a2a', accent: '#c8b06a', metal: '#8e939c', leather: '#54381f', cloth: '#c8b58a' },
  ],
  paladin: [
    { main: '#2a3a6a', alt: '#c0c6d0', accent: '#e3b34a', metal: '#c0c6d0', leather: '#3f2c18', cloth: '#d8ccae' },
    { main: '#7a1f1f', alt: '#e8e2d2', accent: '#c8b06a', metal: '#aab2c0', leather: '#4e3218', cloth: '#ddd6c4' },
  ],
  ranger: [
    { main: '#3f5f3a', alt: '#4e3218', accent: '#8a6a2a', metal: '#8e939c', leather: '#4e3218', cloth: '#5a6b3a' },
    { main: '#4a5a4a', alt: '#54381f', accent: '#a89878', metal: '#9a8f80', leather: '#5a3f22', cloth: '#6a7a4a' },
  ],
  rogue: [
    { main: '#3a3a42', alt: '#2e2116', accent: '#8a2a2a', metal: '#8e939c', leather: '#2e2116', cloth: '#5a5a62' },
    { main: '#2f3a4a', alt: '#3f2c18', accent: '#6aa8b0', metal: '#8e939c', leather: '#3f2c18', cloth: '#4a5a6a' },
  ],
  sorcerer: [
    { main: '#8a1f3a', alt: '#c8306a', accent: '#f0d264', metal: '#c8b06a', leather: '#54381f', cloth: '#d8ccae' },
    { main: '#5a2a6a', alt: '#8a2a5a', accent: '#e3b34a', metal: '#c8b06a', leather: '#4e3218', cloth: '#c8b58a' },
  ],
  warlock: [
    { main: '#2a2230', alt: '#5a2a6a', accent: '#b07ae0', metal: '#8e939c', leather: '#2e2116', cloth: '#c8b58a' },
    { main: '#22303a', alt: '#2a5a5a', accent: '#6aa8b0', metal: '#8e939c', leather: '#3f2c18', cloth: '#a8a090' },
  ],
  wizard: [
    { main: '#2f4f7f', alt: '#1c2a4a', accent: '#c8b06a', metal: '#c8b06a', leather: '#54381f', cloth: '#d8ccae' },
    { main: '#3a2a5a', alt: '#5a4a7a', accent: '#e3b34a', metal: '#c8b06a', leather: '#4e3218', cloth: '#c8b58a' },
  ],
});

/** One of a class's palettes, or null for a class with none listed. */
export function classPalette(classId, r) {
  const sets = CLASS_PALETTE[classId];
  if (!sets || !sets.length) return null;
  if (r && typeof r.pick === 'function') return r.pick(sets);
  return sets[0];
}

/** Options the character-creation appearance step cycles through. */
export const APPEARANCE_OPTIONS = {
  hairStyle: ['short', 'long', 'ponytail', 'braid', 'curly', 'topknot', 'bob', 'wild', 'widowspeak', 'mohawk', 'shaved', 'bald'],
  beard: ['none', 'stubble', 'goatee', 'mustache', 'full', 'braided'],
  build: ['slim', 'normal', 'broad', 'stout', 'tall'],
  cloakStyle: ['auto', 'cloak-none', 'cloak-short', 'cloak-long', 'cloak-hooded'],
  helmStyle: ['auto', 'helm-none', 'helm-cap', 'helm-hood', 'helm-circlet', 'helm-horned', 'helm-wizard', 'helm-great'],
  bootStyle: ['auto', 'boots-none', 'boots-tall', 'boots-cuffed', 'boots-sandal', 'boots-wraps', 'boots-plate', 'boots-court'],
  outfitStyle: ['outfit-tunic', 'outfit-robe', 'outfit-leather', 'outfit-noble', 'outfit-peasant', 'outfit-monk'],
  horns: [null, 'curved', 'straight', 'ram', 'crown'],
  tail: [null, 'thin', 'tufted', 'cat', 'scaled'],
  ears: [null, 'pointed', 'long', 'cat'],
};

/** Fallback palettes when a species doesn't supply its own. */
export const GENERIC_PALETTES = {
  skin: ['#f6d5b4', '#e8bd95', '#e0a878', '#c98d5e', '#a86f45', '#8a5734', '#6b4227', '#4e2f1c'],
  hair: ['#1c1410', '#3a2416', '#5a3a20', '#7a5a2a', '#a8823a', '#c8a860', '#8a2a2a', '#b04a2a',
    '#6a6a72', '#a8a8b0', '#d8d8e0', '#2a3a5a', '#4a2a5a', '#2a5a3a'],
  eye: ['#37527a', '#2a6a4a', '#6a4a2a', '#4a2a1a', '#7a2a2a', '#5a4a7a', '#8a8a3a', '#3a3a3a', '#c8b060'],
};
