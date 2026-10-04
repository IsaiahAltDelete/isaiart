// Procedural low-poly models. Every building, tree and villager is built
// from primitives here so the game ships without any model files.
import * as THREE from '../vendor/three.module.min.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
export const roof = (w, h, d, c, x = 0, y = 0, z = 0, ry = 0) => at(mesh(prismGeo(w, h, d), c), x, y, z, ry);

let stripeTex = null;
function stripes(a = '#d9433b', b = '#fbf3e4') {
  if (stripeTex) return stripeTex;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8;
  const g = cv.getContext('2d');
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 8, 0, 8, 8); }
  stripeTex = new THREE.CanvasTexture(cv);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  stripeTex.magFilter = THREE.NearestFilter;
  return stripeTex;
}

// palette
export const C = {
  wall: 0xf3e3c3, wall2: 0xe9d3a8, timber: 0x8a5a33, darkwood: 0x5e3b22, log: 0x9a6a3e, plank: 0xc8955a,
  red: 0xc9473d, redDark: 0x9f3530, blue: 0x3f7fc4, yellow: 0xe8b23a, teal: 0x2f9e98, green: 0x5c9a3c,
  stone: 0x9a9d9f, stone2: 0x7d8184, brick: 0xb8613f, window: 0xffe9a3, door: 0x6b4428, soil: 0x7a5434,
  hay: 0xe6c35c, white: 0xfbf6ea, leaf: 0x4f9a3a, berry: 0xd23a4a, orange: 0xe58a3a,
};

function windowPane(x, y, z, ry = 0) { return at(mesh(new THREE.BoxGeometry(0.22, 0.22, 0.04), C.window, { emissive: 0x3a2a00 }), x, y, z, ry); }
function door(x, y, z, ry = 0, c = C.door) { return at(mesh(new THREE.BoxGeometry(0.26, 0.42, 0.05), c), x, y + 0.21, z, ry); }

// Smoke puffs that drift up from a chimney.
export class Smoke {
  constructor(parent, x, y, z, color = 0xeeeeee) {
    this.puffs = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.7, flatShading: true }));
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
      p.material.opacity = this.on ? 0.65 * (1 - t) : 0;
    }
  }
}

function pad(w, d, color = 0xb89466) {
  const m = mesh(new THREE.BoxGeometry(w, 0.08, d), color);
  m.position.y = 0.0; m.castShadow = false; return m;
}

function cottage(g, a, opts = {}) {
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

function tiled(g, a) {
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
  g.add(door(-0.15, 0, 0.31));
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

const BUILDERS = { cottage, tiled, lumber, forager, farm, sawmill, quarry, storehouse, dock, market, forester, windmill, bakery, mason, campfire,
  flowers, bench, lantern, hay, pumpkins, fence, well, sign, statue };

// Returns { group, anim } — anim holds handles to animated parts.
export function buildModel(type, size = [2, 2]) {
  const g = new THREE.Group(), a = {};
  const inner = new THREE.Group(); g.add(inner);
  if (!['campfire', 'farm', 'dock', 'fence', 'flowers', 'sign', 'lantern', 'bench'].includes(type)) inner.add(pad(size[0] * 0.92, size[1] * 0.92));
  BUILDERS[type](inner, a);
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
  else { const hair = new THREE.Mesh(new THREE.SphereGeometry(0.118, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(v.hair)); hair.position.y = 0.51; hair.rotation.x = -0.25; body.add(hair); }
  // eyes
  for (const x of [-0.04, 0.04]) body.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.01), mat(0x222222)), x, 0.52, 0.105));
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.14, 0.36, 0); armR.position.set(0.14, 0.36, 0);
  armL.add(box(0.06, 0.2, 0.06, v.shirt, 0, -0.2, 0)); armR.add(box(0.06, 0.2, 0.06, v.shirt, 0, -0.2, 0));
  body.add(armL, armR);
  const tool = new THREE.Group(); tool.position.set(0, -0.2, 0.04); armR.add(tool);
  const sack = ball(0.11, 0xc9a46a, 0, 0.35, -0.15); sack.visible = false; body.add(sack);
  g.scale.setScalar(1.3);
  return { group: g, body, hipL, hipR, armL, armR, tool, sack, toolKind: null };
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
  else if (kind === 'sapling') { t.add(cone(0.06, 0.16, 5, C.leaf, 0, -0.08, 0.05)); }
}
