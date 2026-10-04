// Procedural low-poly models. Every building, tree and villager is built
// from primitives here so the game ships without any model files.
import * as THREE from '../vendor/three.module.min.js';
import { mulberry32 } from './rng.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + (opts.map ? opts.map.uuid : '') + JSON.stringify({ ...opts, map: undefined });
  if (!matCache.has(key)) {
    const m = opts.basic
      ? new THREE.MeshBasicMaterial({ color, transparent: !!opts.opacity, opacity: opts.opacity ?? 1 })
      : new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: opts.emissive ?? 0x000000,
        transparent: !!opts.opacity, opacity: opts.opacity ?? 1, map: opts.map ?? null });
    matCache.set(key, m);
  }
  return matCache.get(key);
}

function mesh(geo, color, opts) {
  const m = new THREE.Mesh(geo, color instanceof THREE.Material ? color : mat(color, opts));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function at(m, x, y, z, ry = 0) { m.position.set(x, y, z); m.rotation.y = ry; return m; }
export const box = (w, h, d, c, x = 0, y = 0, z = 0) => at(mesh(new THREE.BoxGeometry(w, h, d), c), x, y + h / 2, z);
export const cyl = (rt, rb, h, seg, c, x = 0, y = 0, z = 0) => at(mesh(new THREE.CylinderGeometry(rt, rb, h, seg), c), x, y + h / 2, z);
export const cone = (r, h, seg, c, x = 0, y = 0, z = 0) => at(mesh(new THREE.ConeGeometry(r, h, seg), c), x, y + h / 2, z);
export const ball = (r, c, x = 0, y = 0, z = 0, det = 0) => at(mesh(new THREE.IcosahedronGeometry(r, det), c), x, y, z);

// gable roof, ridge along x
export function prismGeo(w, h, d) {
  const hw = w / 2, hd = d / 2;
  const v = [
    -hw, 0, -hd, -hw, 0, hd, -hw, h, 0,
    hw, 0, hd, hw, 0, -hd, hw, h, 0,
    -hw, 0, hd, hw, 0, hd, hw, h, 0, -hw, 0, hd, hw, h, 0, -hw, h, 0,
    hw, 0, -hd, -hw, 0, -hd, -hw, h, 0, hw, 0, -hd, -hw, h, 0, hw, h, 0,
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
  ];
  // UVs in world units (u along the ridge, v down the slope) so the shingle
  // texture keeps the same scale on every roof size
  const sl = Math.hypot(hd, h), U = 2.2, V = 3.2;
  const uv = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    -hw * U, 0, hw * U, 0, hw * U, sl * V, -hw * U, 0, hw * U, sl * V, -hw * U, sl * V,
    hw * U, 0, -hw * U, 0, -hw * U, sl * V, hw * U, 0, -hw * U, sl * V, hw * U, sl * V,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// soft shingle rows: a white tile drawn on canvas, tinted by each roof colour
let shingleTex = null;
function shingles() {
  if (shingleTex) return shingleTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  for (let row = 0; row < 2; row++) {
    const y = row * 32, off = row ? 8 : 0;
    // each row darkens toward its lower lip, then a scalloped shadow line marks the overlap
    const grd = g.createLinearGradient(0, y, 0, y + 32);
    grd.addColorStop(0, 'rgba(255,255,255,0.10)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.0)'); grd.addColorStop(0.85, 'rgba(0,0,0,0.12)'); grd.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = grd; g.fillRect(0, y, 64, 32);
    g.fillStyle = 'rgba(0,0,0,0.30)';
    for (let x = -16 + off; x < 64 + 16; x += 16) { g.beginPath(); g.ellipse(x + 8, y + 29, 8, 4.5, 0, 0, Math.PI); g.fill(); }
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y + 29, 64, 3);
  }
  shingleTex = new THREE.CanvasTexture(cv);
  shingleTex.wrapS = shingleTex.wrapT = THREE.RepeatWrapping;
  shingleTex.colorSpace = THREE.SRGBColorSpace;
  shingleTex.anisotropy = 4;
  return shingleTex;
}
export function roofMat(color) { return mat(color, { map: shingles() }); }

// a hip roof: four slopes meeting at a short ridge
export function hipGeo(w, h, d) {
  const hw = w / 2, hd = d / 2, r = Math.max(0.01, (w - d) / 2);
  const A = [-hw, 0, hd], B = [hw, 0, hd], Cc = [hw, 0, -hd], D = [-hw, 0, -hd], E = [-r, h, 0], F = [r, h, 0];
  const tris = [[A, B, F], [A, F, E], [Cc, D, E], [Cc, E, F], [D, A, E], [B, Cc, F]];
  const pos = [], uv = [], sl = Math.hypot(hd, h), U = 2.2, V = 3.2;
  for (const t of tris) for (const p of t) {
    pos.push(...p);
    const slope = 1 - p[1] / h;
    uv.push((p[0] + p[2]) * U * 0.7, slope * sl * V);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
export function hipRoof(w, h, d, c, x = 0, y = 0, z = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  g.add(mesh(hipGeo(w, h, d), roofMat(c)));
  const dark = new THREE.Color(c).multiplyScalar(0.62).getHex();
  const ridge = mesh(new THREE.BoxGeometry(Math.max(0.1, w - d) + 0.1, 0.08, 0.12), dark); ridge.position.y = h - 0.02; g.add(ridge);
  return g;
}

// a gable roof with shingles, an eave lip and a darker ridge cap
export function roof(w, h, d, c, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry;
  const m = mesh(prismGeo(w, h, d), roofMat(c)); g.add(m);
  const dark = new THREE.Color(c).multiplyScalar(0.62).getHex();
  const ridge = mesh(new THREE.BoxGeometry(w + 0.06, 0.08, 0.14), dark); ridge.position.y = h - 0.01; g.add(ridge);
  const sl = Math.atan2(h, d / 2);
  for (const s of [-1, 1]) {
    const lip = mesh(new THREE.BoxGeometry(w + 0.02, 0.05, 0.1), dark);
    lip.position.set(0, 0.02, s * (d / 2 - 0.03)); lip.rotation.x = s * sl; g.add(lip);
  }
  return g;
}

let stripeTex = null;
function stripes(a = '#d9433b', b = '#fbf3e4') {
  if (stripeTex) return stripeTex;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8;
  const g = cv.getContext('2d');
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 8, 0, 8, 8); }
  stripeTex = new THREE.CanvasTexture(cv);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  stripeTex.magFilter = THREE.NearestFilter;
  stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
  stripeTex.repeat.set(0.35, 1);
  return stripeTex;
}

// palette
export const C = {
  wall: 0xf3e3c3, wall2: 0xe9d3a8, timber: 0x8a5a33, darkwood: 0x5e3b22, log: 0x9a6a3e, plank: 0xc8955a,
  red: 0xc9473d, redDark: 0x9f3530, blue: 0x3f7fc4, yellow: 0xe8b23a, teal: 0x2f9e98, green: 0x5c9a3c,
  stone: 0x9a9d9f, stone2: 0x7d8184, brick: 0xb8613f, window: 0xffe9a3, door: 0x6b4428, soil: 0x7a5434,
  hay: 0xe6c35c, white: 0xfbf6ea, leaf: 0x4f9a3a, berry: 0xd23a4a, orange: 0xe58a3a,
};

function windowPane(x, y, z, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry;
  g.add(at(mesh(new THREE.BoxGeometry(0.29, 0.29, 0.03), C.timber), 0, 0, -0.005));
  g.add(at(mesh(new THREE.BoxGeometry(0.22, 0.22, 0.04), C.window, { emissive: 0x3a2a00 }), 0, 0, 0.005));
  g.add(at(mesh(new THREE.BoxGeometry(0.3, 0.04, 0.08), C.timber), 0, -0.16, 0.03));
  return g;
}
// a door with a lighter frame and a little step
function door(x, y, z, ry = 0, c = C.door) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry;
  g.add(at(mesh(new THREE.BoxGeometry(0.34, 0.48, 0.04), C.plank), 0, 0.24, -0.005));
  g.add(at(mesh(new THREE.BoxGeometry(0.26, 0.42, 0.06), c), 0, 0.21, 0.01));
  g.add(at(mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), 0xe8c050), 0.08, 0.22, 0.05));
  g.add(at(mesh(new THREE.BoxGeometry(0.4, 0.05, 0.14), C.stone), 0, 0.0, 0.07));
  return g;
}

// Smoke puffs that drift up from a chimney.
export class Smoke {
  constructor(parent, x, y, z, color = 0xeeeeee) {
    this.puffs = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x606060, transparent: true, opacity: 0.5, depthWrite: false }));
      m.userData.t = i / 5; parent.add(m); this.puffs.push(m);
    }
    this.o = new THREE.Vector3(x, y, z); this.on = true;
  }
  update(dt) {
    for (const p of this.puffs) {
      p.userData.t = (p.userData.t + dt * 0.35) % 1;
      const t = p.userData.t;
      p.position.set(this.o.x + Math.sin(t * 6 + p.id) * 0.08 + t * 0.25, this.o.y + t * 1.3, this.o.z);
      p.scale.setScalar(0.5 + t * 1.6);
      p.material.opacity = this.on ? 0.5 * Math.sin(Math.min(1, t * 4) * Math.PI / 2) * (1 - t) : 0;
    }
  }
}

function pad(w, d, color = 0xb89466) {
  const m = mesh(new THREE.BoxGeometry(w, 0.08, d), color);
  m.position.y = 0.0; m.castShadow = false; return m;
}

const WALLS = [C.wall, 0xf7f1e3, 0xdde8f0, 0xf2d8d4, 0xdfe8cf, 0xf6e6b4, 0xe9dccb];
const ROOFS = [C.red, C.blue, 0x4f8a3a, 0x7a5236, 0x66788a, 0xc8643a, 0x8a4f8f];
// Each cottage is seeded by its building id: wall and roof colours, roof
// shape, porch, window boxes, dormer, chimney side, garden, and at level 3 an
// upper storey.
function cottageVariant(g, a, seed, lvl) {
  const rng = mulberry32(seed * 7919 + 13), pick = arr => arr[(rng() * arr.length) | 0];
  const wall = pick(WALLS), roofC = pick(ROOFS), hip = rng() < 0.35, timber = rng() < 0.55;
  const two = lvl >= 3, H = 0.9, H2 = two ? 0.72 : 0, top = H + H2;
  g.add(box(1.5, H, 1.3, wall, 0, 0, 0));
  if (two) { g.add(box(1.56, 0.08, 1.36, C.timber, 0, H - 0.04, 0)); g.add(box(1.46, H2, 1.26, timber ? C.white : wall, 0, H, 0)); }
  if (timber) {
    for (const [x, z] of [[-0.74, -0.64], [0.74, -0.64], [-0.74, 0.64], [0.74, 0.64]]) g.add(box(0.08, top, 0.08, C.timber, x, 0, z));
    g.add(box(1.52, 0.06, 0.04, C.timber, 0, 0.45, 0.66));
    if (two) { g.add(box(0.05, H2, 0.04, C.timber, -0.25, H, 0.64)); g.add(box(0.05, H2, 0.04, C.timber, 0.25, H, 0.64)); }
  }
  g.add(box(1.52, 0.08, 1.32, C.timber, 0, top - 0.04, 0));
  if (hip) g.add(hipRoof(1.85, 0.7, 1.65, roofC, 0, top, 0));
  else g.add(roof(1.85, 0.75, 1.65, roofC, 0, top, 0));
  // door, maybe under a porch
  const dx = rng() < 0.5 ? 0 : (rng() < 0.5 ? -0.35 : 0.35);
  g.add(door(dx, 0, 0.66));
  if (rng() < 0.45) {
    for (const px of [dx - 0.28, dx + 0.28]) g.add(box(0.05, 0.62, 0.05, C.timber, px, 0, 0.92));
    g.add(roof(0.75, 0.22, 0.42, roofC, dx, 0.62, 0.86));
  }
  for (const wx of [-0.45, 0.45]) if (Math.abs(wx - dx) > 0.3) {
    g.add(windowPane(wx, 0.5, 0.66));
    if (rng() < 0.6) { g.add(box(0.3, 0.07, 0.1, C.timber, wx, 0.33, 0.72)); for (let k = 0; k < 3; k++) g.add(ball(0.045, pick([0xf06292, 0xffd54f, 0xba68c8, 0xff8a65, 0xffffff]), wx - 0.09 + k * 0.09, 0.42, 0.73)); }
  }
  g.add(windowPane(0.76, 0.5, 0, Math.PI / 2));
  if (two) { g.add(windowPane(-0.35, H + 0.38, 0.64)); g.add(windowPane(0.35, H + 0.38, 0.64)); }
  // dormer on gable roofs
  if (!hip && rng() < 0.35) {
    g.add(box(0.36, 0.3, 0.3, wall, 0.35, top + 0.12, 0.42));
    g.add(roof(0.46, 0.2, 0.4, roofC, 0.35, top + 0.42, 0.42, Math.PI / 2));
    g.add(windowPane(0.35, top + 0.28, 0.58));
  }
  const cs = rng() < 0.5 ? 1 : -1;
  g.add(box(0.2, 0.55 + H2, 0.2, rng() < 0.5 ? C.stone2 : C.brick, 0.5 * cs, top + 0.25 - H2 * 0.4, -0.3));
  a.smoke = new Smoke(g, 0.5 * cs, top + 0.85 + H2 * 0.6, -0.3);
  // garden bits
  if (rng() < 0.5) { g.add(ball(0.12, C.leaf, -0.75, 0.1, 0.85)); g.add(ball(0.06, C.berry, -0.7, 0.2, 0.9)); }
  if (rng() < 0.4) g.add(cyl(0.1, 0.09, 0.2, 8, C.log, 0.8, 0, 0.75));
  if (rng() < 0.3) for (let k = 0; k < 4; k++) g.add(box(0.04, 0.22, 0.04, C.white, -0.85 + k * 0.18, 0, 0.98));
}

function cottage(g, a, opts = {}) {
  if (opts.seed) return cottageVariant(g, a, opts.seed, opts.lvl || 1);
  const wall = opts.wall ?? C.wall, roofC = opts.roof ?? C.red;
  g.add(box(1.5, 0.9, 1.3, wall, 0, 0, 0));
  // timber frame corners
  for (const [x, z] of [[-0.74, -0.64], [0.74, -0.64], [-0.74, 0.64], [0.74, 0.64]]) g.add(box(0.08, 0.9, 0.08, C.timber, x, 0, z));
  g.add(box(1.52, 0.08, 1.32, C.timber, 0, 0.86, 0));
  g.add(roof(1.85, 0.75, 1.65, roofC, 0, 0.92, 0));
  g.add(door(0, 0, 0.66));
  g.add(windowPane(-0.45, 0.5, 0.66)); g.add(windowPane(0.45, 0.5, 0.66));
  g.add(windowPane(0.76, 0.5, 0, Math.PI / 2));
  g.add(box(0.2, 0.55, 0.2, C.stone2, 0.5, 1.15, -0.3));
  a.smoke = new Smoke(g, 0.5, 1.75, -0.3);
  // little garden
  g.add(ball(0.12, C.leaf, -0.75, 0.1, 0.85)); g.add(ball(0.06, C.berry, -0.7, 0.2, 0.9));
  g.add(ball(0.1, C.leaf, 0.75, 0.1, 0.85));
}

function tiled(g, a, opts = {}) {
  if (opts.seed) {
    const rng = mulberry32(opts.seed * 104729 + 7), pick = arr => arr[(rng() * arr.length) | 0];
    const roofC = pick([C.blue, 0x66788a, 0x3f6f9a, 0x8a4f8f, 0x4f8a3a]), wall = pick([C.wall2, 0xe8e1d0, 0xd9c8b0, 0xefe3cf]);
    const two = (opts.lvl || 1) >= 3, H2 = two ? 0.6 : 0;
    g.add(box(1.6, 0.35, 1.4, rng() < 0.5 ? C.stone : 0xb3aa9a, 0, 0, 0));
    g.add(box(1.5, 0.75 + H2, 1.3, wall, 0, 0.35, 0));
    g.add(hipRoof(1.9, 0.8, 1.75, roofC, 0, 1.1 + H2, 0));
    g.add(door(-0.3, 0.2, 0.66, 0, pick([0x4a6a8a, 0x8a4a3a, 0x3f6f4a])));
    g.add(windowPane(0.35, 0.65, 0.66)); g.add(windowPane(-0.76, 0.65, 0, Math.PI / 2)); g.add(windowPane(0.76, 0.65, 0, Math.PI / 2));
    if (two) { g.add(windowPane(-0.3, 1.25, 0.66)); g.add(windowPane(0.35, 1.25, 0.66)); }
    g.add(box(0.22, 0.7 + H2, 0.22, C.brick, -0.5, 1.2, -0.35));
    a.smoke = new Smoke(g, -0.5, 1.95 + H2, -0.35);
    g.add(box(0.5, 0.06, 0.25, C.stone, -0.3, 0, 0.82));
    if (rng() < 0.5) { for (let k = 0; k < 5; k++) g.add(box(0.05, 0.3, 0.05, C.timber, -0.8 + k * 0.4, 0, 0.98)); g.add(box(1.65, 0.04, 0.04, C.timber, 0, 0.24, 0.98)); }
    return;
  }
  g.add(box(1.6, 0.35, 1.4, C.stone, 0, 0, 0));
  g.add(box(1.5, 0.75, 1.3, C.wall2, 0, 0.35, 0));
  g.add(roof(1.9, 0.85, 1.75, C.blue, 0, 1.1, 0));
  g.add(roof(0.7, 0.4, 0.5, C.blue, 0.3, 0.95, 0.62, Math.PI / 2));
  g.add(door(-0.3, 0.2, 0.66, 0, 0x4a6a8a));
  g.add(windowPane(0.35, 0.65, 0.66)); g.add(windowPane(-0.76, 0.65, 0, Math.PI / 2));
  g.add(box(0.22, 0.7, 0.22, C.brick, -0.5, 1.2, -0.35));
  a.smoke = new Smoke(g, -0.5, 1.95, -0.35);
  g.add(box(0.5, 0.06, 0.25, C.stone, -0.3, 0, 0.82));
}

function lumber(g, a) {
  g.add(box(1.2, 0.75, 1.0, C.log, -0.15, 0, -0.2));
  for (let i = 0; i < 4; i++) {
    const l = cyl(0.06, 0.06, 1.24, 6, C.timber, -0.15, 0, 0.31);
    l.rotation.z = Math.PI / 2; l.position.y = 0.1 + i * 0.18; g.add(l);
  }
  g.add(roof(1.5, 0.55, 1.3, C.green, -0.15, 0.75, -0.2));
  g.add(at(mesh(new THREE.BoxGeometry(1.6, 0.09, 0.16), C.plank), -0.15, 1.31, -0.2));
  for (const x of [-0.85, 0.55]) g.add(at(mesh(new THREE.BoxGeometry(0.08, 0.12, 1.36), C.plank), x, 0.98, -0.2));
  for (const x of [-0.88, 0.58]) g.add(box(0.1, 0.62, 0.1, C.darkwood, x, 0.14, 0.32));
  g.add(door(-0.4, 0, 0.31));
  g.add(windowPane(0.2, 0.42, 0.32));
  g.add(box(0.5, 0.12, 0.08, C.plank, -0.15, 0.7, 0.35));
  // log pile
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) {
    const l = cyl(0.09, 0.09, 0.7, 7, C.log, 0.7, 0.09 + i * 0.16, -0.4 + j * 0.19 + i * 0.09);
    l.rotation.x = Math.PI / 2; l.position.y = 0.09 + i * 0.16; g.add(l);
  }
  const stump = cyl(0.16, 0.18, 0.22, 8, C.log, 0.55, 0, 0.6); g.add(stump);
  const axe = new THREE.Group();
  axe.add(box(0.03, 0.32, 0.03, C.darkwood, 0, 0, 0)); axe.add(box(0.12, 0.08, 0.03, 0xb0b4b8, 0.05, 0.25, 0));
  axe.position.set(0.55, 0.22, 0.6); axe.rotation.z = 0.4; g.add(axe);
}

function forager(g, a) {
  // round yurt with a striped conical roof
  g.add(cyl(0.55, 0.6, 0.62, 10, 0xe9d8b4, 0, 0, 0));
  g.add(cyl(0.61, 0.61, 0.06, 10, C.timber, 0, 0.58, 0));
  g.add(cone(0.74, 0.62, 10, C.blue, 0, 0.62, 0));
  g.add(cone(0.42, 0.36, 10, 0xeaf1f8, 0, 0.9, 0));
  g.add(cone(0.16, 0.16, 10, C.blue, 0, 1.18, 0));
  g.add(door(0, 0, 0.58));
  for (const [x, z, c] of [[0.7, 0.55, C.berry], [-0.7, 0.6, 0x5a4ab0], [0.78, -0.35, C.berry]]) {
    g.add(cyl(0.15, 0.11, 0.16, 8, C.plank, x, 0, z)); g.add(ball(0.11, c, x, 0.2, z));
  }
}

function farm(g, a) {
  // 3x3 tile field, centred
  g.add(box(2.7, 0.08, 2.7, C.soil, 0, 0, 0));
  for (let i = 0; i < 5; i++) g.add(box(2.5, 0.06, 0.22, 0x8d6340, 0, 0.08, -1.0 + i * 0.5));
  const crops = new THREE.Group(); g.add(crops);
  const geo = new THREE.ConeGeometry(0.07, 0.4, 4);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) {
    const m = new THREE.Mesh(geo, mat(C.leaf)); m.castShadow = true;
    m.position.set(-1.1 + c * 0.275, 0.3, -1.0 + r * 0.5); crops.add(m);
  }
  a.crops = crops;
  // fence on two sides
  for (let i = 0; i < 6; i++) g.add(box(0.06, 0.32, 0.06, C.timber, -1.35 + i * 0.54, 0, 1.38));
  g.add(box(2.75, 0.05, 0.04, C.timber, 0, 0.22, 1.38));
  g.add(box(0.5, 0.3, 0.35, C.hay, 1.1, 0, 1.12));
  // scarecrow
  g.add(box(0.05, 0.75, 0.05, C.timber, 0.95, 0, -0.95)); g.add(box(0.5, 0.05, 0.05, C.timber, 0.95, 0.55, -0.95));
  g.add(ball(0.11, C.hay, 0.95, 0.85, -0.95)); g.add(cone(0.15, 0.15, 6, C.darkwood, 0.95, 0.9, -0.95));
}

function sawmill(g, a) {
  g.add(box(1.7, 0.12, 1.3, C.plank, 0, 0, 0));
  for (const [x, z] of [[-0.75, -0.55], [0.75, -0.55], [-0.75, 0.55], [0.75, 0.55]]) g.add(box(0.1, 0.9, 0.1, C.timber, x, 0, z));
  g.add(roof(1.95, 0.55, 1.5, C.red, 0, 0.92, 0));
  g.add(box(1.1, 0.35, 0.35, C.darkwood, 0, 0.12, 0));
  const blade = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 12), 0xc9cdd1);
  blade.rotation.x = Math.PI / 2; blade.position.set(0.1, 0.55, 0); g.add(blade); a.blade = blade;
  const log = cyl(0.12, 0.12, 0.9, 8, C.log, -0.3, 0.47, 0); log.rotation.z = Math.PI / 2; log.position.y = 0.6; g.add(log);
  for (let i = 0; i < 4; i++) g.add(box(0.9, 0.05, 0.2, C.plank, 0.2, 0.0 + i * 0.06 + 0.06, 0.85));
}

function quarry(g, a) {
  g.add(box(1.8, 0.06, 1.6, 0x8a8478, 0, 0, 0));
  for (const [x, z, s] of [[-0.5, -0.3, 0.35], [-0.15, -0.55, 0.28], [0.55, 0.4, 0.22]]) g.add(ball(s, C.stone, x, s * 0.6, z));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g.add(box(0.26, 0.2, 0.26, 0xb5b1a7, 0.35 + j * 0.28, i * 0.2, -0.45));
  // little crane
  g.add(box(0.08, 1.3, 0.08, C.timber, -0.7, 0, 0.55)); g.add(box(0.9, 0.07, 0.07, C.timber, -0.3, 1.25, 0.55));
  const rope = box(0.02, 0.6, 0.02, 0x6a5a40, 0.1, 0.65, 0.55); g.add(rope);
  g.add(box(0.2, 0.16, 0.2, 0xb5b1a7, 0.1, 0.5, 0.55));
  g.add(box(0.5, 0.25, 0.35, C.plank, 0.5, 0, 0.6));
}

function storehouse(g, a) {
  g.add(box(2.4, 1.0, 1.5, C.red, 0, 0, 0));
  g.add(roof(2.6, 0.75, 1.8, 0x7a2e2a, 0, 1.0, 0));
  g.add(box(0.75, 0.75, 0.05, C.white, 0, 0, 0.76));
  g.add(box(0.7, 0.05, 0.02, C.red, 0, 0.36, 0.79)); // X brace hint
  g.add(box(0.05, 0.7, 0.02, C.red, 0, 0.02, 0.79));
  g.add(box(0.3, 0.3, 0.05, C.white, 0, 1.15, 0.6));
  for (const x of [-1.2, 1.2]) g.add(box(0.06, 1.0, 1.52, C.white, x, 0, 0));
  g.add(box(0.35, 0.3, 0.35, C.plank, 0.9, 0, 0.95)); g.add(box(0.3, 0.25, 0.3, C.plank, -0.9, 0, 0.95));
  g.add(cyl(0.15, 0.15, 0.35, 8, C.timber, -0.55, 0, 0.98));
}

function dock(g, a) {
  // shore hut + planks reaching toward +z (the model is rotated to face water)
  g.add(box(1.1, 0.7, 0.9, C.plank, -0.35, 0, -0.45));
  const aw = roof(1.35, 0.4, 1.15, C.teal, -0.35, 0.7, -0.45); g.add(aw);
  g.add(door(-0.35, 0, 0.0));
  for (let i = 0; i < 9; i++) g.add(box(0.7, 0.06, 0.28, C.plank, 0.45, 0.06, -0.6 + i * 0.32));
  for (let i = 0; i < 4; i++) for (const x of [0.12, 0.78]) g.add(box(0.07, 0.75, 0.07, C.darkwood, x, -0.6, -0.4 + i * 0.75));
  // a moored boat
  const boat = new THREE.Group();
  boat.add(box(0.9, 0.16, 0.36, 0x8b5a32, 0, 0, 0));
  boat.add(box(0.92, 0.04, 0.38, 0xa9744a, 0, 0.16, 0));
  boat.position.set(1.25, -0.15, 1.6); g.add(boat); a.boat = boat;
  g.add(cyl(0.12, 0.12, 0.2, 8, C.plank, 0.25, 0.1, -0.3));
}

function market(g, a) {
  g.add(box(1.5, 0.5, 0.7, C.plank, 0, 0, 0.1));
  for (const [x, z] of [[-0.72, -0.25], [0.72, -0.25], [-0.72, 0.5], [0.72, 0.5]]) g.add(box(0.07, 1.25, 0.07, C.timber, x, 0, z));
  const tex = stripes();
  const awning = mesh(prismGeo(1.7, 0.4, 1.05), mat(0xffffff, { map: tex }));
  awning.position.set(0, 1.22, 0.12); g.add(awning);
  for (const [x, c] of [[-0.45, C.berry], [-0.1, C.orange], [0.25, C.yellow], [0.55, 0x7cc04a]]) g.add(ball(0.11, c, x, 0.6, 0.15));
  g.add(box(0.35, 0.3, 0.3, C.plank, 0.9, 0, 0.7)); g.add(box(0.3, 0.25, 0.3, C.plank, -0.95, 0, 0.75));
}

function forester(g, a) {
  g.add(box(1.2, 0.7, 1.0, C.log, 0, 0, -0.2));
  g.add(roof(1.5, 0.6, 1.35, 0x3f7a39, 0, 0.7, -0.2));
  g.add(door(0, 0, 0.31));
  for (const x of [-0.6, -0.25, 0.1, 0.45]) { g.add(cyl(0.1, 0.08, 0.14, 7, C.brick, x, 0, 0.75)); g.add(cone(0.1, 0.25, 6, C.leaf, x, 0.14, 0.75)); }
}

function windmill(g, a) {
  g.add(cyl(0.48, 0.7, 1.7, 8, C.wall, 0, 0, 0));
  g.add(cone(0.62, 0.65, 8, C.red, 0, 1.7, 0));
  g.add(door(0, 0, 0.66));
  g.add(windowPane(0, 1.05, 0.56));
  const hub = new THREE.Group(); hub.position.set(0, 1.75, 0.62); g.add(hub);
  hub.add(cyl(0.08, 0.08, 0.15, 8, C.darkwood, 0, -0.07, 0).rotateX(Math.PI / 2));
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2;
    arm.add(box(0.06, 1.1, 0.04, C.timber, 0, 0, 0.05));
    arm.add(box(0.28, 0.85, 0.02, C.white, 0.17, 0.25, 0.05));
    hub.add(arm);
  }
  a.blades = hub;
  g.add(box(0.35, 0.3, 0.3, C.hay, 0.75, 0, 0.5));
}

function bakery(g, a) {
  g.add(box(1.5, 0.85, 1.25, C.brick, 0, 0, 0));
  g.add(roof(1.8, 0.65, 1.55, C.orange, 0, 0.85, 0));
  g.add(door(-0.35, 0, 0.64)); g.add(windowPane(0.3, 0.5, 0.64));
  g.add(box(0.3, 0.75, 0.3, C.stone2, 0.45, 1.0, -0.3));
  a.smoke = new Smoke(g, 0.45, 1.8, -0.3, 0xf5efe6);
  g.add(cyl(0.35, 0.35, 0.05, 10, C.plank, 0.95, 0.35, 0.6)); g.add(ball(0.12, 0xd9a35a, 0.95, 0.45, 0.6));
  g.add(box(0.08, 0.35, 0.08, C.timber, 0.95, 0, 0.6));
}

function mason(g, a) {
  g.add(box(1.3, 0.75, 1.0, C.stone, -0.15, 0, -0.25));
  g.add(roof(1.6, 0.5, 1.3, 0x6b5a4a, -0.15, 0.75, -0.25));
  g.add(door(-0.15, 0, 0.26));
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) g.add(box(0.26, 0.14, 0.18, C.brick, 0.5 + (j % 2) * 0.05, i * 0.14, 0.2 + j * 0.2));
  g.add(box(0.5, 0.35, 0.5, 0xb5b1a7, -0.6, 0, 0.6));
}

function campfire(g, a) {
  for (let i = 0; i < 9; i++) { const t = i / 9 * Math.PI * 2; g.add(ball(0.13, C.stone2, Math.cos(t) * 0.42, 0.06, Math.sin(t) * 0.42)); }
  for (let i = 0; i < 3; i++) { const l = cyl(0.06, 0.06, 0.55, 6, C.log, 0, 0.1, 0); l.rotation.z = Math.PI / 2; l.rotation.y = i * 1.05; l.position.y = 0.1; g.add(l); }
  const fire = new THREE.Group(); g.add(fire);
  fire.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 6), mat(0xff8a1e, { basic: true })), 0, 0.35, 0));
  fire.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.38, 6), mat(0xffd34a, { basic: true })), 0.04, 0.32, 0.02));
  a.fire = fire;
  const light = new THREE.PointLight(0xffa040, 2.2, 5, 1.6); light.position.set(0, 0.7, 0); g.add(light); a.light = light;
  // log benches and a tent
  for (const [x, z, r] of [[0, 0.95, 0], [-0.95, 0, Math.PI / 2], [0.9, -0.35, Math.PI / 2.4]]) {
    const b = cyl(0.1, 0.1, 0.6, 7, C.log, x, 0.1, z); b.rotation.x = Math.PI / 2; b.rotation.z = r; b.position.y = 0.1; g.add(b);
  }
  // cooking tripod with a little pot
  for (let i = 0; i < 3; i++) { const t = i / 3 * Math.PI * 2; const leg = box(0.03, 0.62, 0.03, C.darkwood, 0.62 + Math.cos(t) * 0.14, 0, -0.62 + Math.sin(t) * 0.14); leg.rotation.set(Math.sin(t) * 0.22, 0, -Math.cos(t) * 0.22); g.add(leg); }
  g.add(ball(0.11, 0x3a3a3a, 0.62, 0.36, -0.62, 1));
  g.add(box(0.36, 0.22, 0.26, C.plank, -0.7, 0, -0.55));
}

// ── decorations ──
function flowers(g) {
  g.add(box(0.8, 0.1, 0.8, C.soil, 0, 0, 0));
  const cols = [0xf06292, 0xffd54f, 0xba68c8, 0xff8a65, 0xffffff];
  for (let i = 0; i < 9; i++) { const x = -0.25 + (i % 3) * 0.25, z = -0.25 + ((i / 3) | 0) * 0.25;
    g.add(box(0.03, 0.18, 0.03, C.leaf, x, 0.08, z)); g.add(ball(0.07, cols[i % 5], x, 0.3, z)); }
}
function bench(g) {
  g.add(box(0.75, 0.05, 0.25, C.plank, 0, 0.22, 0)); g.add(box(0.75, 0.2, 0.04, C.plank, 0, 0.3, -0.12));
  for (const x of [-0.3, 0.3]) g.add(box(0.05, 0.22, 0.22, C.timber, x, 0, 0));
}
function lantern(g, a) {
  g.add(box(0.06, 0.9, 0.06, 0x3c3c3c, 0, 0, 0)); g.add(box(0.25, 0.04, 0.04, 0x3c3c3c, 0.1, 0.88, 0));
  g.add(box(0.14, 0.2, 0.14, 0xffe08a, 0.2, 0.68, 0)); a.glow = g.children[g.children.length - 1];
  g.add(cone(0.12, 0.1, 4, 0x3c3c3c, 0.2, 0.88, 0));
}
function hay(g) { g.add(box(0.5, 0.3, 0.32, C.hay, -0.12, 0, 0)); g.add(box(0.45, 0.28, 0.3, C.hay, 0.2, 0, 0.25)); g.add(box(0.45, 0.28, 0.3, 0xd9b44a, 0.05, 0.3, 0.1)); }
function pumpkins(g) { for (const [x, z, s] of [[-0.18, 0, 0.17], [0.15, 0.12, 0.13], [0.1, -0.2, 0.11]]) { const p = ball(s, C.orange, x, s * 0.8, z, 1); p.scale.y = 0.8; g.add(p); g.add(box(0.03, 0.08, 0.03, C.leaf, x, s * 1.5, z)); } }
function fence(g) { for (const x of [-0.4, 0, 0.4]) g.add(box(0.07, 0.4, 0.07, C.timber, x, 0, 0)); g.add(box(0.9, 0.05, 0.04, C.plank, 0, 0.3, 0)); g.add(box(0.9, 0.05, 0.04, C.plank, 0, 0.15, 0)); }
function well(g) {
  g.add(cyl(0.34, 0.36, 0.38, 10, C.stone, 0, 0, 0));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 10), mat(0x3f8fd0)), 0, 0.33, 0));
  for (const x of [-0.3, 0.3]) g.add(box(0.05, 0.65, 0.05, C.timber, x, 0.3, 0));
  g.add(roof(0.85, 0.32, 0.75, C.blue, 0, 0.92, 0));
  g.add(cyl(0.06, 0.06, 0.12, 8, C.plank, 0, 0.5, 0));
}
function sign(g) { g.add(box(0.06, 0.8, 0.06, C.timber, 0, 0, 0)); g.add(box(0.5, 0.15, 0.04, C.plank, 0.12, 0.6, 0.04)); g.add(box(0.45, 0.13, 0.04, C.plank, -0.1, 0.4, 0.04)); }
function statue(g) {
  g.add(box(0.6, 0.25, 0.6, C.stone, 0, 0, 0)); g.add(box(0.45, 0.15, 0.45, 0xb5b1a7, 0, 0.25, 0));
  g.add(cyl(0.12, 0.16, 0.45, 8, 0xd8d4c8, 0, 0.4, 0)); g.add(ball(0.12, 0xd8d4c8, 0, 0.95, 0)); g.add(box(0.5, 0.06, 0.06, 0xd8d4c8, 0, 0.72, 0));
  g.add(ball(0.08, 0x9b6bd1, 0, 1.15, 0));
}

// ── farm animals (wander inside their pens; main.js moves them) ──
export function chicken() {
  const g = new THREE.Group(), white = rngPick([0xfaf6ee, 0xc98a4a, 0xf0e2c8]);
  g.add(ball(0.09, white, 0, 0.1, 0, 1)); g.add(ball(0.055, white, 0, 0.19, 0.06, 1));
  g.add(box(0.02, 0.04, 0.05, 0xd83a3a, 0, 0.23, 0.06)); g.add(cone(0.02, 0.05, 4, 0xf0a020, 0, 0.17, 0.12).rotateX(Math.PI / 2));
  g.add(box(0.015, 0.05, 0.015, 0xf0a020, -0.03, 0, 0)); g.add(box(0.015, 0.05, 0.015, 0xf0a020, 0.03, 0, 0));
  g.userData.head = g.children[1];
  return g;
}
export function sheep() {
  const g = new THREE.Group();
  const wool = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), mat(0xf6f3ea)); wool.scale.set(1, 0.85, 1.25); wool.position.y = 0.28; wool.castShadow = true; g.add(wool);
  const head = box(0.11, 0.12, 0.14, 0x2e2a28, 0, 0.26, 0.24); g.add(head); g.userData.head = head;
  for (const [x, z] of [[-0.09, -0.12], [0.09, -0.12], [-0.09, 0.12], [0.09, 0.12]]) g.add(box(0.04, 0.16, 0.04, 0x2e2a28, x, 0, z));
  return g;
}
export function cow() {
  const g = new THREE.Group();
  g.add(box(0.26, 0.24, 0.48, 0xf7f3ea, 0, 0.2, 0));
  g.add(box(0.27, 0.14, 0.16, 0x2e2a28, 0.0, 0.3, -0.08)); g.add(box(0.2, 0.12, 0.12, 0x2e2a28, 0.04, 0.22, 0.14));
  const head = new THREE.Group(); head.position.set(0, 0.36, 0.28); g.add(head);
  head.add(box(0.16, 0.16, 0.16, 0xf7f3ea, 0, -0.08, 0)); head.add(box(0.14, 0.07, 0.06, 0xf2b8a8, 0, -0.1, 0.09));
  head.add(cone(0.02, 0.07, 4, 0xe8dcc0, -0.07, 0.02, 0)); head.add(cone(0.02, 0.07, 4, 0xe8dcc0, 0.07, 0.02, 0));
  g.userData.head = head;
  for (const [x, z] of [[-0.09, -0.17], [0.09, -0.17], [-0.09, 0.17], [0.09, 0.17]]) g.add(box(0.06, 0.2, 0.06, 0xf7f3ea, x, 0, z));
  return g;
}
let _pr = mulberry32(99);
function rngPick(arr) { return arr[(_pr() * arr.length) | 0]; }
function fenceRing(g, w, d, gap = true) {
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1;
  for (const [x0, z0, x1, z1] of [[-hw, -hd, hw, -hd], [hw, -hd, hw, hd], [hw, hd, -hw, hd], [-hw, hd, -hw, -hd]]) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 0.5);
    for (let k = 0; k <= n; k++) { const t = k / n; if (gap && z0 === hd && z1 === hd && Math.abs(x0 + (x1 - x0) * t) < 0.35) continue; g.add(box(0.06, 0.34, 0.06, C.timber, x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t)); }
    const rail = box(len, 0.04, 0.03, C.plank, (x0 + x1) / 2, 0.24, (z0 + z1) / 2); rail.rotation.y = Math.atan2(-(z1 - z0), x1 - x0); g.add(rail);
  }
}
function pen(g, a, w, d, make, n, ground = 0x8cc463) {
  g.add(box(w - 0.1, 0.04, d - 0.1, ground, 0, 0, 0));
  fenceRing(g, w, d);
  a.animals = [];
  for (let i = 0; i < n; i++) {
    const m = make(); const x = (Math.random() - 0.5) * (w - 1), z = (Math.random() - 0.5) * (d - 1);
    m.position.set(x, 0.04, z); g.add(m);
    a.animals.push({ m, tx: x, tz: z, t: Math.random() * 3, w: w - 0.9, d: d - 0.9 });
  }
}
function coop(g, a) {
  g.add(box(1.8, 0.04, 1.8, 0xc9b27a, 0, 0, 0));
  fenceRing(g, 1.9, 1.9);
  const house = new THREE.Group(); house.position.set(-0.35, 0, -0.35); g.add(house);
  for (const [x, z] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) house.add(box(0.06, 0.3, 0.06, C.timber, x, 0, z));
  house.add(box(0.75, 0.42, 0.6, 0xc9473d, 0, 0.3, 0)); house.add(roof(0.9, 0.32, 0.78, C.timber, 0, 0.72, 0));
  house.add(box(0.16, 0.18, 0.04, 0x3a2a20, 0, 0.36, 0.31));
  const ramp = box(0.14, 0.03, 0.5, C.plank, 0, 0.14, 0.5); ramp.rotation.x = 0.55; house.add(ramp);
  g.add(cyl(0.12, 0.1, 0.12, 8, C.plank, 0.55, 0, 0.45)); g.add(cyl(0.1, 0.1, 0.03, 8, C.hay, 0.55, 0.12, 0.45));
  a.animals = [];
  for (let i = 0; i < 5; i++) { const m = chicken(); const x = 0.2 + Math.random() * 0.5, z = Math.random() * 0.6 - 0.1; m.position.set(x, 0.04, z); g.add(m); a.animals.push({ m, tx: x, tz: z, t: Math.random() * 2, w: 1.3, d: 1.3, fast: true }); }
}
function orchard(g, a) {
  g.add(box(2.8, 0.04, 2.8, 0x7fbf55, 0, 0, 0));
  for (const [x, z] of [[-0.85, -0.85], [0.85, -0.85], [0, 0], [-0.85, 0.85], [0.85, 0.85]]) {
    g.add(cyl(0.06, 0.08, 0.5, 6, 0x7a4e2c, x, 0, z));
    g.add(ball(0.42, 0x4f9a3a, x, 0.75, z)); g.add(ball(0.3, 0x5fae45, x + 0.12, 0.98, z + 0.06));
    for (let k = 0; k < 5; k++) { const t = k * 1.3; g.add(ball(0.05, C.berry, x + Math.cos(t) * 0.36, 0.7 + (k % 2) * 0.18, z + Math.sin(t) * 0.36)); }
  }
  g.add(cyl(0.14, 0.11, 0.16, 8, C.plank, 0.4, 0, 1.15)); for (let k = 0; k < 3; k++) g.add(ball(0.05, C.berry, 0.36 + k * 0.05, 0.18, 1.15));
  const ladder = new THREE.Group(); ladder.add(box(0.03, 0.8, 0.03, C.plank, -0.08, 0, 0)); ladder.add(box(0.03, 0.8, 0.03, C.plank, 0.08, 0, 0));
  for (let k = 0; k < 4; k++) ladder.add(box(0.18, 0.025, 0.025, C.plank, 0, 0.15 + k * 0.18, 0));
  ladder.position.set(-0.45, 0, 0.3); ladder.rotation.x = -0.3; g.add(ladder);
}
function beehive(g, a) {
  g.add(box(1.8, 0.04, 1.8, 0x86c25a, 0, 0, 0));
  const hives = [[-0.45, -0.3], [0.1, -0.45], [0.55, 0.05]];
  for (const [x, z] of hives) {
    g.add(box(0.36, 0.1, 0.36, C.timber, x, 0, z));
    for (let k = 0; k < 3; k++) g.add(box(0.32, 0.14, 0.32, k % 2 ? 0xf3e0a0 : 0xf7f1e3, x, 0.1 + k * 0.14, z));
    g.add(roof(0.42, 0.12, 0.42, 0xc98a3a, x, 0.52, z));
  }
  const cols = [0xf06292, 0xffd54f, 0xba68c8, 0xffffff];
  for (let i = 0; i < 12; i++) { const x = -0.8 + Math.random() * 1.6, z = 0.35 + Math.random() * 0.45; g.add(box(0.02, 0.14, 0.02, C.leaf, x, 0, z)); g.add(ball(0.045, cols[i % 4], x, 0.17, z)); }
  a.bees = [];
  for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.022, 5, 4), mat(0xffc81e, { basic: true })); g.add(b); a.bees.push({ m: b, h: hives[i % 3], ph: Math.random() * 6, r: 0.25 + Math.random() * 0.35 }); }
}
function pasture(g, a) {
  pen(g, a, 2.9, 2.9, sheep, 5);
  g.add(box(0.7, 0.45, 0.45, C.log, -0.9, 0, -0.95)); g.add(roof(0.85, 0.25, 0.6, C.timber, -0.9, 0.45, -0.95));
  g.add(box(0.6, 0.14, 0.2, C.darkwood, 0.8, 0, -1.05)); g.add(box(0.54, 0.02, 0.14, 0x5ab0e0, 0.8, 0.12, -1.05));
}
function dairy(g, a) {
  pen(g, a, 2.9, 2.9, cow, 3);
  g.add(box(0.9, 0.6, 0.6, C.red, -0.85, 0, -0.95)); g.add(roof(1.05, 0.35, 0.8, 0x7a2e2a, -0.85, 0.6, -0.95));
  g.add(box(0.3, 0.4, 0.04, C.white, -0.85, 0, -0.64));
  for (const x of [0.7, 0.92]) g.add(cyl(0.08, 0.09, 0.24, 8, 0xc9cdd1, x, 0, -1.05));
  g.add(box(0.6, 0.12, 0.2, C.darkwood, 0.6, 0, 1.0));
}
function weaver(g, a) {
  g.add(box(1.3, 0.8, 1.0, 0xe9d8c4, -0.15, 0, -0.25)); g.add(roof(1.6, 0.6, 1.3, 0x7a5aa8, -0.15, 0.8, -0.25));
  g.add(door(-0.4, 0, 0.26)); g.add(windowPane(0.2, 0.45, 0.26));
  // a loom with coloured threads
  const lx = 0.55, lz = 0.6;
  for (const x of [-0.2, 0.2]) g.add(box(0.05, 0.55, 0.05, C.timber, lx + x, 0, lz));
  g.add(box(0.46, 0.05, 0.05, C.timber, lx, 0.53, lz)); g.add(box(0.46, 0.05, 0.05, C.timber, lx, 0.15, lz));
  ['#d9534f', '#4f8fd9', '#f0c94a', '#5cb85c'].forEach((c, i) => g.add(box(0.07, 0.36, 0.01, new THREE.Color(c).getHex(), lx - 0.13 + i * 0.087, 0.17, lz)));
  g.add(ball(0.13, 0xf6f3ea, -0.75, 0.13, 0.55)); g.add(ball(0.11, 0xf6f3ea, -0.55, 0.11, 0.7));
}
function creamery(g, a) {
  g.add(box(1.3, 0.8, 1.0, C.white, -0.15, 0, -0.25)); g.add(roof(1.6, 0.6, 1.3, 0x4f8fd9, -0.15, 0.8, -0.25));
  g.add(door(-0.15, 0, 0.26)); g.add(windowPane(0.35, 0.45, 0.26)); g.add(windowPane(-0.6, 0.45, 0.26));
  for (let k = 0; k < 3; k++) g.add(cyl(0.13, 0.13, 0.08, 10, 0xf2c94a, 0.6, k * 0.08, 0.55));
  for (const x of [-0.7, -0.5]) g.add(cyl(0.08, 0.09, 0.26, 8, 0xc9cdd1, x, 0, 0.6));
}
function brewery(g, a) {
  g.add(box(1.4, 0.85, 1.05, C.brick, -0.1, 0, -0.25)); g.add(roof(1.7, 0.6, 1.35, 0x6b4a2a, -0.1, 0.85, -0.25));
  g.add(door(-0.35, 0, 0.29)); g.add(windowPane(0.3, 0.5, 0.29));
  g.add(cyl(0.28, 0.32, 0.5, 12, 0xc0703a, 0.65, 0, -0.55)); g.add(cone(0.2, 0.3, 12, 0xc0703a, 0.65, 0.5, -0.55));
  a.smoke = new Smoke(g, 0.65, 1.05, -0.55, 0xf5efe6);
  for (const [x, z] of [[0.55, 0.55], [0.85, 0.5], [0.7, 0.75]]) { const b = cyl(0.12, 0.12, 0.3, 10, 0x8a5a33, x, 0, z); g.add(b); }
}
function tavern(g, a) {
  g.add(box(2.3, 0.9, 1.3, C.wall, 0, 0, -0.1));
  g.add(box(2.36, 0.08, 1.36, C.timber, 0, 0.86, -0.1));
  g.add(box(2.2, 0.7, 1.2, 0xf7f1e3, 0, 0.9, -0.1));
  for (const x of [-1.12, -0.4, 0.4, 1.12]) g.add(box(0.07, 1.6, 0.07, C.timber, x, 0, 0.56));
  g.add(roof(2.6, 0.75, 1.6, 0x8a3a2a, 0, 1.6, -0.1));
  g.add(door(0, 0, 0.56)); for (const x of [-0.75, 0.75]) { g.add(windowPane(x, 0.5, 0.56)); g.add(windowPane(x, 1.25, 0.56)); }
  g.add(windowPane(0, 1.25, 0.56));
  g.add(box(0.04, 0.04, 0.4, C.darkwood, 1.0, 1.3, 0.75)); g.add(box(0.36, 0.26, 0.04, 0xf0c94a, 1.0, 1.06, 0.95));
  g.add(box(0.2, 0.7, 0.2, C.stone2, -0.8, 1.6, -0.5)); a.smoke = new Smoke(g, -0.8, 2.4, -0.5);
  for (const x of [-0.65, 0.65]) { g.add(cyl(0.2, 0.2, 0.04, 10, C.plank, x, 0.3, 0.95)); g.add(box(0.04, 0.3, 0.04, C.timber, x, 0, 0.95)); g.add(box(0.5, 0.05, 0.14, C.plank, x, 0.18, 1.2)); }
  for (const [x, z] of [[1.05, 0.25], [1.05, 0.0]]) g.add(cyl(0.11, 0.11, 0.26, 10, 0x8a5a33, x, 0, z));
}
function school(g, a) {
  g.add(box(1.5, 0.85, 1.2, 0xf6e6b4, 0, 0, -0.1)); g.add(roof(1.8, 0.65, 1.5, C.red, 0, 0.85, -0.1));
  g.add(door(0, 0, 0.51)); g.add(windowPane(-0.45, 0.48, 0.51)); g.add(windowPane(0.45, 0.48, 0.51));
  // belfry
  for (const [x, z] of [[-0.12, -0.22], [0.12, -0.22], [-0.12, 0.02], [0.12, 0.02]]) g.add(box(0.04, 0.32, 0.04, C.white, x, 1.4, z - 0.1));
  g.add(roof(0.4, 0.22, 0.4, C.red, 0, 1.72, -0.2)); g.add(ball(0.07, 0xd9a520, 0, 1.55, -0.2, 1));
  g.add(box(0.5, 0.36, 0.04, 0x2f4a3a, 0.7, 0.2, 0.75)); g.add(box(0.04, 0.5, 0.04, C.timber, 0.5, 0, 0.75)); g.add(box(0.04, 0.5, 0.04, C.timber, 0.9, 0, 0.75));
}
function watchtower(g, a) {
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) { const p = box(0.1, 2.3, 0.1, C.log, x, 0, z); p.rotation.z = -x * 0.08; p.rotation.x = z * 0.08; g.add(p); }
  g.add(box(1.15, 0.08, 1.15, C.plank, 0, 2.0, 0));
  for (const [w, d, x, z] of [[1.15, 0.05, 0, 0.56], [1.15, 0.05, 0, -0.56], [0.05, 1.15, 0.56, 0], [0.05, 1.15, -0.56, 0]]) g.add(box(w, 0.32, d, C.timber, x, 2.05, z));
  g.add(hipRoof(1.35, 0.5, 1.35, C.green, 0, 2.62, 0));
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) g.add(box(0.05, 0.6, 0.05, C.timber, x, 2.05, z));
  const ladder = new THREE.Group(); ladder.add(box(0.03, 2.1, 0.03, C.plank, -0.1, 0, 0)); ladder.add(box(0.03, 2.1, 0.03, C.plank, 0.1, 0, 0));
  for (let k = 0; k < 9; k++) ladder.add(box(0.22, 0.025, 0.025, C.plank, 0, 0.18 + k * 0.22, 0));
  ladder.position.set(0, 0, 0.62); ladder.rotation.x = -0.12; g.add(ladder);
  g.add(box(0.04, 0.8, 0.04, C.darkwood, 0.45, 2.6, 0.45)); g.add(box(0.36, 0.22, 0.02, 0xd9473d, 0.64, 3.25, 0.45));
  a.flagMesh = g.children[g.children.length - 1];
  g.add(box(0.12, 0.16, 0.12, 0xffe08a, -0.45, 2.38, 0.5));   // lamp (glows at night)
}
function wizard(g, a) {
  g.add(cyl(0.62, 0.72, 0.4, 10, C.stone2, 0, 0, 0));
  g.add(cyl(0.48, 0.56, 2.5, 10, 0xb9b3c4, 0, 0.4, 0));
  for (let k = 0; k < 4; k++) g.add(cyl(0.5 + k * 0.005, 0.5, 0.05, 10, 0x8f86a3, 0, 0.9 + k * 0.55, 0));
  g.add(cyl(0.6, 0.5, 0.12, 10, 0x8f86a3, 0, 2.85, 0));
  g.add(cone(0.68, 1.3, 10, 0x5b3fa0, 0, 2.95, 0));
  g.add(ball(0.12, 0xffd54f, 0, 4.35, 0, 0));
  const glow = mat(0xc7a8ff, { emissive: 0x6a3fd0 });
  for (const [y, r] of [[1.4, 0.0], [2.1, 1.6], [2.5, -1.4]]) { const w = new THREE.Mesh(new THREE.CircleGeometry(0.11, 10), glow); w.position.set(Math.sin(r) * 0.53, y, Math.cos(r) * 0.53); w.rotation.y = r; g.add(w); }
  const d = door(0, 0.4, 0.5, 0, 0x4a2f6b); g.add(d);
  a.orbs = [];
  for (let i = 0; i < 3; i++) { const o = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: [0xb18cff, 0x7fd8ff, 0xff9ed8][i] })); g.add(o); a.orbs.push(o); }
  g.add(cyl(0.2, 0.24, 0.12, 10, C.stone, 0.75, 0, 0.55)); g.add(ball(0.09, 0x7fd8ff, 0.75, 0.2, 0.55));
}
function memorial(g, a) {
  g.add(box(1.8, 0.04, 1.8, 0x7fbf55, 0, 0, 0));
  for (let k = 0; k < 4; k++) g.add(box(0.3, 0.03, 0.3, 0xd8cdb4, 0, 0.03, 0.75 - k * 0.38));
  g.add(cyl(0.08, 0.12, 0.6, 6, 0x7a4e2c, 0.55, 0, -0.55)); for (const [x, y] of [[0.45, 0.85], [0.65, 0.95], [0.55, 1.05]]) g.add(ball(0.24, 0x6aa84f, x, y, -0.55));
  a.stones = [];
  const spots = [[-0.6, -0.55], [-0.25, -0.6], [-0.6, -0.15], [-0.25, -0.2], [-0.6, 0.25], [-0.25, 0.25], [0.45, 0.2], [0.45, 0.55]];
  for (const [x, z] of spots) { const st = new THREE.Group(); st.add(box(0.18, 0.24, 0.06, 0xb9b6ae, 0, 0, 0)); st.add(cyl(0.09, 0.09, 0.06, 10, 0xb9b6ae, 0, 0.21, 0).rotateX(Math.PI / 2)); st.add(ball(0.04, 0xf06292, 0.08, 0.04, 0.08)); st.position.set(x, 0.03, z); st.visible = false; g.add(st); a.stones.push(st); }
  g.add(box(0.5, 0.05, 0.18, C.plank, 0.5, 0.22, 0.75)); for (const x of [0.3, 0.7]) g.add(box(0.04, 0.22, 0.14, C.timber, x, 0, 0.75));
}
function torch(g, a) {
  g.add(box(0.07, 0.75, 0.07, C.darkwood, 0, 0, 0));
  g.add(cyl(0.07, 0.05, 0.1, 6, 0x5a5a5a, 0, 0.75, 0));
  g.add(box(0.09, 0.07, 0.09, 0xffe08a, 0, 0.84, 0));           // glow source
  const f = new THREE.Group(); f.position.y = 0.86; g.add(f);
  f.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), mat(0xff8a1e, { basic: true })), 0, 0.1, 0));
  f.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 6), mat(0xffd34a, { basic: true })), 0, 0.08, 0));
  a.fire = f;
}
function palisade(g) {
  for (const x of [-0.32, 0, 0.32]) { g.add(cyl(0.11, 0.12, 0.8, 7, C.log, x, 0, 0)); g.add(cone(0.11, 0.2, 7, 0xb98450, x, 0.8, 0)); }
  g.add(box(0.95, 0.06, 0.06, C.darkwood, 0, 0.5, 0.1));
}

// ── night beasts ──
export function beastModel(kind) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const eye = mat(0xffe25a, { basic: true });
  let legs = [];
  if (kind === 'goblin') {
    body.add(cyl(0.1, 0.13, 0.24, 8, 0x6b4a2a, 0, 0.14, 0)); body.add(ball(0.12, 0x6fae4a, 0, 0.46, 0, 1));
    for (const s of [-1, 1]) { const ear = cone(0.04, 0.16, 4, 0x6fae4a, s * 0.13, 0.42, 0); ear.rotation.z = -s * 1.2; body.add(ear); }
    for (const x of [-0.04, 0.04]) body.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 4), eye), x, 0.48, 0.1));
    for (const x of [-0.05, 0.05]) { const l = box(0.06, 0.14, 0.06, 0x3a2a1a, x, 0, 0); body.add(l); legs.push(l); }
    body.add(ball(0.08, 0x8a6a3a, 0, 0.32, -0.13));
  } else {
    const wolf = kind === 'wolf', c = wolf ? 0x8a8f99 : 0x5e4433, c2 = wolf ? 0x6b7079 : 0x4a3426;
    body.add(box(wolf ? 0.2 : 0.28, wolf ? 0.2 : 0.26, wolf ? 0.48 : 0.46, c, 0, 0.18, 0));
    const head = new THREE.Group(); head.position.set(0, wolf ? 0.34 : 0.28, wolf ? 0.28 : 0.27); body.add(head);
    head.add(box(0.16, 0.15, 0.16, c, 0, 0, 0)); head.add(box(0.1, 0.08, 0.14, c2, 0, -0.03, 0.12));
    if (wolf) { head.add(cone(0.035, 0.09, 4, c2, -0.05, 0.07, -0.02)); head.add(cone(0.035, 0.09, 4, c2, 0.05, 0.07, -0.02)); const tail = box(0.05, 0.05, 0.24, c2, 0, 0.26, -0.32); tail.rotation.x = 0.5; body.add(tail); }
    else { head.add(cone(0.02, 0.08, 4, 0xf3ecd8, -0.05, -0.06, 0.18).rotateX(-0.6)); head.add(cone(0.02, 0.08, 4, 0xf3ecd8, 0.05, -0.06, 0.18).rotateX(-0.6)); }
    for (const x of [-0.045, 0.045]) head.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), eye), x, 0.03, 0.08));
    for (const [x, z] of [[-0.07, -0.15], [0.07, -0.15], [-0.07, 0.15], [0.07, 0.15]]) { const l = box(0.05, 0.14, 0.05, c2, x, 0, z); body.add(l); legs.push(l); }
  }
  g.scale.setScalar(1.25);
  return { group: g, body, legs };
}

const BUILDERS = { cottage, tiled, lumber, forager, farm, sawmill, quarry, storehouse, dock, market, forester, windmill, bakery, mason, campfire,
  flowers, bench, lantern, hay, pumpkins, fence, well, sign, statue,
  coop, orchard, beehive, pasture, weaver, dairy, creamery, brewery, tavern, school, watchtower, wizard, memorial, torch, palisade };

// Returns { group, anim } — anim holds handles to animated parts.
export function buildModel(type, size = [2, 2], seed = 0, lvl = 1) {
  const g = new THREE.Group(), a = {};
  const inner = new THREE.Group(); g.add(inner);
  if (!['campfire', 'farm', 'dock', 'fence', 'flowers', 'sign', 'lantern', 'bench', 'torch', 'palisade', 'coop', 'orchard', 'beehive', 'pasture', 'dairy', 'memorial'].includes(type)) inner.add(pad(size[0] * 0.92, size[1] * 0.92));
  BUILDERS[type](inner, a, seed ? { seed, lvl } : {});
  a.inner = inner;
  return { group: g, anim: a };
}

export function scaffold(size) {
  const g = new THREE.Group();
  const w = size[0] * 0.85, d = size[1] * 0.85;
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) g.add(box(0.06, 1.3, 0.06, C.plank, x, 0, z));
  for (const y of [0.45, 0.95]) { g.add(box(w, 0.05, 0.05, C.plank, 0, y, d / 2)); g.add(box(w, 0.05, 0.05, C.plank, 0, y, -d / 2));
    g.add(box(0.05, 0.05, d, C.plank, w / 2, y, 0)); g.add(box(0.05, 0.05, d, C.plank, -w / 2, y, 0)); }
  g.add(box(0.4, 0.15, 0.3, C.plank, w / 2 + 0.1, 0, d / 2 + 0.1));
  return g;
}

// ── instanced-geometry sources (vertex-coloured, merged) ──
function colored(geo, color, m) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (m) g.applyMatrix4(m);
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}
export function merge(list) {
  let total = 0; for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}
const T = (x, y, z, s = 1, sy = s) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s, sy, s));

export function pineGeo() {
  return merge([
    colored(new THREE.CylinderGeometry(0.06, 0.09, 0.4, 5), 0x7a4e2c, T(0, 0.2, 0)),
    colored(new THREE.ConeGeometry(0.58, 0.75, 7), 0x2f7d3a, T(0, 0.65, 0)),
    colored(new THREE.ConeGeometry(0.46, 0.65, 7), 0x378a40, T(0, 1.0, 0)),
    colored(new THREE.ConeGeometry(0.32, 0.55, 7), 0x3f9646, T(0, 1.32, 0)),
  ]);
}
export function roundGeo() {
  return merge([
    colored(new THREE.CylinderGeometry(0.07, 0.11, 0.55, 5), 0x7a4e2c, T(0, 0.27, 0)),
    colored(new THREE.IcosahedronGeometry(0.5, 0), 0x56a83c, T(0, 0.9, 0)),
    colored(new THREE.IcosahedronGeometry(0.36, 0), 0x65b744, T(0.18, 1.2, 0.08)),
    colored(new THREE.IcosahedronGeometry(0.3, 0), 0x4c9c36, T(-0.22, 1.05, -0.12)),
  ]);
}
export function stumpGeo() {
  return merge([colored(new THREE.CylinderGeometry(0.11, 0.13, 0.14, 7), 0x7a4e2c, T(0, 0.07, 0)),
    colored(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 7), 0xd9b47a, T(0, 0.145, 0))]);
}
export function rockGeo() {
  const g = new THREE.DodecahedronGeometry(0.45, 0).toNonIndexed();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = Math.sin(p.getX(i) * 9 + p.getZ(i) * 7) * 0.06; p.setXYZ(i, p.getX(i) * (1 + k), p.getY(i) * 0.7 + 0.2, p.getZ(i) * (1 - k)); }
  return merge([colored(g, 0xa2a39e), colored(new THREE.DodecahedronGeometry(0.22, 0), 0x8f918c, T(0.3, 0.12, 0.2))]);
}
export function bushGeo() {
  return merge([colored(new THREE.IcosahedronGeometry(0.3, 0), 0x3f8d35, T(0, 0.24, 0, 1, 0.8)),
    colored(new THREE.IcosahedronGeometry(0.22, 0), 0x4a9a3c, T(0.2, 0.2, 0.1, 1, 0.8))]);
}
export function berriesGeo() {
  const parts = [];
  for (const [x, y, z] of [[0.15, 0.38, 0.18], [-0.18, 0.32, 0.17], [0.05, 0.42, -0.2], [0.3, 0.3, -0.05], [-0.1, 0.45, 0.02], [0.28, 0.35, 0.2]])
    parts.push(colored(new THREE.IcosahedronGeometry(0.055, 0), 0xd8304a, T(x, y, z)));
  return merge(parts);
}

// ── villagers ──
export function villagerModel(v) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const pants = 0x4a4038;
  const legL = box(0.07, 0.16, 0.08, pants, -0.05, 0, 0), legR = box(0.07, 0.16, 0.08, pants, 0.05, 0, 0);
  const hipL = new THREE.Group(); hipL.position.y = 0.16; legL.position.y = -0.08; hipL.add(legL);
  const hipR = new THREE.Group(); hipR.position.y = 0.16; legR.position.y = -0.08; hipR.add(legR);
  body.add(hipL, hipR);
  body.add(cyl(0.11, 0.14, 0.26, 8, v.shirt, 0, 0.14, 0));
  body.add(ball(0.11, v.skin, 0, 0.5, 0, 1));
  // hair or hat
  if (v.hat) { body.add(cyl(0.17, 0.17, 0.02, 10, v.hatColor, 0, 0.55, 0)); body.add(cyl(0.09, 0.1, 0.09, 10, v.hatColor, 0, 0.56, 0)); }
  else { const hair = new THREE.Mesh(new THREE.SphereGeometry(0.118, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), mat((v.age ?? 30) >= 66 ? 0xdcdad4 : v.hair)); hair.position.y = 0.51; hair.rotation.x = -0.25; body.add(hair); }
  // eyes
  for (const x of [-0.042, 0.042]) {
    body.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.019, 6, 4), mat(0x2a1a10)), x, 0.515, 0.098));
    body.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), mat(0xf29a8a)), x * 1.55, 0.475, 0.088));
  }
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.14, 0.36, 0); armR.position.set(0.14, 0.36, 0);
  armL.add(box(0.07, 0.2, 0.07, v.shirt, 0, -0.2, 0)); armR.add(box(0.07, 0.2, 0.07, v.shirt, 0, -0.2, 0));
  armL.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.042, 6, 4), mat(v.skin)), 0, -0.22, 0));
  armR.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.042, 6, 4), mat(v.skin)), 0, -0.22, 0));
  armL.position.x = -0.155; armR.position.x = 0.155;
  body.add(armL, armR);
  const tool = new THREE.Group(); tool.position.set(0, -0.2, 0.04); armR.add(tool);
  const sack = ball(0.11, 0xc9a46a, 0, 0.35, -0.15); sack.visible = false; body.add(sack);
  // a pointy wizard hat, shown while studying magic
  const wiz = new THREE.Group(); wiz.add(cyl(0.16, 0.16, 0.02, 10, 0x4a2f8a, 0, 0.56, 0)); wiz.add(cone(0.1, 0.3, 10, 0x5b3fa0, 0, 0.57, 0)); wiz.add(ball(0.03, 0xffd54f, 0, 0.75, 0)); wiz.visible = false; body.add(wiz);
  // a bedroll for sleeping by the fire
  const bed = box(0.3, 0.06, 0.62, 0x9a6a8a, 0, 0, 0); bed.visible = false; g.add(bed);
  const age = v.age ?? 30, child = age < 14, elder = age >= 66;
  g.scale.setScalar(child ? 0.85 + age / 14 * 0.35 : 1.3);
  if (child) body.children[2].scale.setScalar(1.18);
  return { group: g, body, hipL, hipR, armL, armR, tool, sack, toolKind: null, wiz, bed, stage: child ? 'child' : elder ? 'elder' : 'adult' };
}

export function setTool(vm, kind) {
  if (vm.toolKind === kind) return;
  vm.toolKind = kind;
  vm.tool.clear();
  const t = vm.tool;
  if (kind === 'axe') { t.add(box(0.025, 0.3, 0.025, C.darkwood, 0, -0.05, 0.05)); t.add(box(0.1, 0.07, 0.02, 0xb8bcc0, 0.04, 0.17, 0.05)); }
  else if (kind === 'pick') { t.add(box(0.025, 0.3, 0.025, C.darkwood, 0, -0.05, 0.05)); t.add(box(0.22, 0.04, 0.03, 0x9aa0a6, 0, 0.22, 0.05)); }
  else if (kind === 'hammer') { t.add(box(0.025, 0.22, 0.025, C.darkwood, 0, -0.03, 0.05)); t.add(box(0.1, 0.06, 0.05, 0x8a8f94, 0, 0.12, 0.05)); }
  else if (kind === 'hoe') { t.add(box(0.025, 0.38, 0.025, C.darkwood, 0, 0, 0.05)); t.add(box(0.08, 0.03, 0.06, 0x9aa0a6, 0, 0.18, 0.08)); }
  else if (kind === 'rod') { const r = box(0.015, 0.7, 0.015, C.darkwood, 0, 0, 0.05); r.rotation.x = 0.7; t.add(r); }
  else if (kind === 'basket') { t.add(cyl(0.08, 0.06, 0.08, 8, C.plank, 0, -0.06, 0.03)); }
  else if (kind === 'spear') { t.add(box(0.02, 0.75, 0.02, C.darkwood, 0, 0.15, 0.05)); t.add(cone(0.035, 0.12, 4, 0xb8bcc0, 0, 0.55, 0.05)); }
  else if (kind === 'staff') { t.add(box(0.025, 0.6, 0.025, 0x6b4428, 0, 0.1, 0.05)); t.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9fd8ff })), 0, 0.42, 0.05)); }
  else if (kind === 'sapling') { t.add(cone(0.06, 0.16, 5, C.leaf, 0, -0.08, 0.05)); }
}
