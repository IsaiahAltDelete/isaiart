// render/actor.js — turns a Character into a drawable sprite by stacking the
// body / ears / hair / outfit / cloak / helm / weapon layers and recolouring each
// from the character's colorway. The composited result is cached by a signature,
// so a character costs one drawImage per frame no matter how many layers it has.

import { composeSprite, drawComposed, drawSprite, hasSprite, makeColorway, spriteDef } from './sprites.js';
import { SPRITE_W, SPRITE_H, DIRS } from '../constants.js';
import { hashStr } from '../core/rng.js';
import { resolveItem } from '../data/items.js';

// Draw order, back to front. Cloaks go behind the body; hair behind a helm.
const ORDER = ['cloak', 'tail', 'body', 'ears', 'hair', 'beard', 'outfit', 'horns', 'helm', 'shield', 'weapon'];

// --- equipment -> sprite layer mapping ------------------------------------

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
  // No armour: dress by class so an unarmoured wizard still looks like a wizard.
  const cls = ch.classes?.[0]?.id;
  if (cls === 'wizard' || cls === 'sorcerer' || cls === 'warlock') return 'outfit-robe';
  if (cls === 'monk') return 'outfit-monk';
  if (cls === 'druid' || cls === 'cleric') return 'outfit-robe';
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
  return ch.appearance?.helmStyle || 'helm-none';
}

function bodyFor(ch) {
  const a = ch.appearance || {};
  if (a.bodyStyle) return a.bodyStyle;
  const size = ch.size || 'medium';
  if (size === 'small') return 'body-small';
  const build = a.build || 'normal';
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

  push(a.cloakStyle || 'cloak-none');
  if (a.tail) push(`tail-${a.tail}`);
  push(bodyFor(ch));
  if (a.ears && a.ears !== 'round') push(`ears-${a.ears}`);
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
    a.cloakStyle, a.helmStyle, a.outfitStyle,
    idOf(eq.armor), idOf(eq.mainHand), idOf(eq.offHand), idOf(eq.helm),
    a.skin, a.hair, a.eye, a.outfit, a.outfitAlt, a.accent, a.metal, a.leather,
  ].join('')).toString(36);
}

/** Get the composed canvas for one frame of a character. */
export function actorCanvas(ch, frame) {
  const layers = actorLayers(ch, frame);
  if (!layers.length) return null;
  // Composite height is the tallest layer so hats and weapons aren't clipped.
  let h = SPRITE_H, w = SPRITE_W;
  for (const l of layers) {
    const d = spriteDef(l.name);
    if (d) { h = Math.max(h, d.h); w = Math.max(w, d.w); }
  }
  return composeSprite(`${actorSig(ch, frame)}|${w}x${h}`, w, h, layers);
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
  if (ch.sprite && hasSprite(ch.sprite) && !ch.layered) {
    return drawSprite(ctx, ch.sprite, frame, x, y, {
      colorway: ch.colorway || (ch.appearance ? colorwayOf(ch) : null),
      scale: opts.scale || 1, alpha: opts.alpha, tint: opts.tint, tintAmt: opts.tintAmt,
      shadow: opts.shadow !== false, flip: opts.flip, bob: opts.bob,
      rotate: opts.downed ? Math.PI / 2 : 0,
    });
  }

  const canvas = actorCanvas(ch, frame);
  if (!canvas) return false;
  drawComposed(ctx, canvas, x, y, {
    scale: opts.scale || 1, alpha: opts.alpha, tint: opts.tint, tintAmt: opts.tintAmt,
    shadow: opts.shadow !== false, flip: opts.flip, bob: opts.bob, sig: actorSig(ch, frame),
  });
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
    outfit: r.pick(OUTFITS),
    outfitAlt: r.pick(OUTFITS),
    accent: r.pick(['#e3b34a', '#c0c6d0', '#b06a2a', '#7fbf6a']),
    metal: r.pick(['#aab2c0', '#c8b06a', '#9a8f80']),
    leather: r.pick(['#6b4a2a', '#54381f', '#7a5a34']),
    cloth: r.pick(['#c8b58a', '#a89878', '#d8ccae']),
    ears: mods.ears && mods.ears !== 'round' ? mods.ears : null,
    horns: mods.horns ? r.pick(['curved', 'straight', 'ram', 'crown']) : null,
    tail: mods.tail ? r.pick(['thin', 'tufted', 'cat', 'scaled']) : null,
    hornColor: pick(cwPal.horn, '#8c8377'),
    cloakStyle: r.chance(0.35) ? r.pick(['cloak-short', 'cloak-long', 'cloak-hooded']) : 'cloak-none',
    helmStyle: 'helm-none',
    outfitStyle: 'outfit-tunic',
    height: mods.height || 1,
  };
}

/** Options the character-creation appearance step cycles through. */
export const APPEARANCE_OPTIONS = {
  hairStyle: ['short', 'long', 'ponytail', 'braid', 'curly', 'topknot', 'bob', 'wild', 'widowspeak', 'mohawk', 'shaved', 'bald'],
  beard: ['none', 'stubble', 'goatee', 'mustache', 'full', 'braided'],
  build: ['slim', 'normal', 'broad', 'tall'],
  cloakStyle: ['cloak-none', 'cloak-short', 'cloak-long', 'cloak-hooded'],
  helmStyle: ['helm-none', 'helm-cap', 'helm-hood', 'helm-circlet', 'helm-horned', 'helm-wizard', 'helm-great'],
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
