// Procedural models for round 7: the trade post and its cart, the ferry boat,
// and the festival shop's seasonal decorations. Registered with models.js, so
// a Blender model exported under the same type id replaces any of them.
import * as THREE from '../vendor/three.module.min.js';
import { registerBuilder, box, cyl, cone, ball, mat, roof, C } from './models.js';

const LAMP = 0xffe08a;     // models.js glows this colour at night (with a halo)

// ── Trade Post (2×2): a depot hut, a loading platform with crates and sacks ──
registerBuilder('tradepost', (g, a) => {
  g.add(box(1.0, 0.75, 0.9, C.wall, -0.4, 0, -0.35));
  g.add(roof(1.2, 0.5, 1.1, C.teal, -0.4, 0.75, -0.35));
  g.add(box(0.26, 0.48, 0.03, C.door, -0.4, 0, 0.11));
  g.add(box(0.22, 0.18, 0.03, C.window, -0.75, 0.35, 0.11));
  g.add(box(0.85, 0.16, 1.5, C.plank, 0.48, 0, 0));                         // loading platform
  for (const [x, z, s, c] of [[0.35, -0.45, 0.32, C.timber], [0.68, -0.4, 0.28, C.log], [0.5, -0.05, 0.26, 0xb07a44]]) g.add(box(s, s, s, c, x, 0.16, z));
  for (const [x, z] of [[0.7, 0.35], [0.45, 0.45]]) { const s = ball(0.14, 0xd9c08a, x, 0.28, z, 1); s.scale.y = 1.2; g.add(s); }
  // sign with a pair of brass scales
  g.add(box(0.06, 1.1, 0.06, C.darkwood, 0.85, 0, 0.72));
  g.add(box(0.5, 0.05, 0.05, C.darkwood, 0.62, 1.05, 0.72));
  const sign = new THREE.Group(); sign.position.set(0.48, 0.92, 0.72); g.add(sign);
  sign.add(box(0.36, 0.2, 0.04, C.plank, 0, -0.1, 0));
  sign.add(box(0.2, 0.02, 0.02, 0xd8a53a, 0, 0.0, 0.03)); sign.add(cone(0.04, 0.04, 6, 0xd8a53a, -0.08, -0.08, 0.03)); sign.add(cone(0.04, 0.04, 6, 0xd8a53a, 0.08, -0.08, 0.03));
  a.flagMesh = sign;
});

// ── a two-wheeled hand cart (the driver is added by the renderer) ──
registerBuilder('tradecart', (g, a) => {
  const body = new THREE.Group(); body.position.y = 0.24; g.add(body);
  body.add(box(0.7, 0.08, 1.0, C.plank, 0, 0.0, 0));
  for (const x of [-0.34, 0.34]) body.add(box(0.04, 0.22, 1.0, C.timber, x, 0.06, 0));
  body.add(box(0.7, 0.22, 0.04, C.timber, 0, 0.06, -0.48));
  for (const x of [-0.2, 0.2]) body.add(box(0.04, 0.04, 0.75, C.darkwood, x, 0.08, 0.85));        // shafts
  a.wheels = [];
  for (const x of [-0.42, 0.42]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 10), mat(C.darkwood)); w.rotation.z = Math.PI / 2; w.position.set(x, 0.24, 0.05); w.castShadow = true; g.add(w); a.wheels.push(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 6), mat(0xd8a53a)); hub.rotation.z = Math.PI / 2; hub.position.copy(w.position); g.add(hub);
  }
  // the load: crates, sacks and logs, shown when the cart carries something
  const load = new THREE.Group(); load.position.y = 0.3; body.add(load); a.load = load;
  load.add(box(0.3, 0.26, 0.3, 0xb07a44, -0.14, 0, -0.22));
  load.add(box(0.26, 0.22, 0.26, C.timber, 0.16, 0, -0.18));
  const sack = ball(0.15, 0xd9c08a, 0.05, 0.13, 0.22, 1); sack.scale.y = 1.15; load.add(sack);
  for (let k = 0; k < 3; k++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 7), mat(C.log)); l.rotation.x = Math.PI / 2; l.position.set(-0.12 + k * 0.12, 0.3 + (k % 2) * 0.08, 0.05); load.add(l); }
}, { pad: false });

// ── the ferry: a flat-bottomed boat with benches, a lantern post and a pennant ──
registerBuilder('ferry', (g, a) => {
  g.add(box(1.15, 0.22, 2.3, C.timber, 0, 0, 0));
  g.add(box(1.0, 0.04, 2.1, C.plank, 0, 0.22, 0));
  for (const x of [-0.56, 0.56]) g.add(box(0.06, 0.14, 2.3, C.darkwood, x, 0.22, 0));
  for (const z of [-1.13, 1.13]) g.add(box(1.15, 0.14, 0.06, C.darkwood, 0, 0.22, z));
  for (const z of [-0.55, 0.55]) g.add(box(0.95, 0.06, 0.22, C.plank, 0, 0.36, z));                    // benches
  g.add(box(0.05, 0.9, 0.05, C.darkwood, 0.45, 0.26, 1.0));
  g.add(box(0.13, 0.15, 0.13, LAMP, 0.45, 1.12, 1.0));
  g.add(cone(0.1, 0.08, 4, 0x3c3c3c, 0.45, 1.27, 1.0));
  g.add(box(0.04, 1.1, 0.04, C.darkwood, -0.45, 0.26, -1.0));
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.34), mat(C.teal)); flag.position.set(-0.45, 1.25, -0.84); g.add(flag); a.flagMesh = flag;
  a.boat = null;
}, { pad: false });

// ── festive decorations ──
registerBuilder('maypole', (g, a) => {
  g.add(cyl(0.05, 0.06, 1.9, 8, 0xf3e3c3, 0, 0, 0));
  g.add(ball(0.08, 0xd8a53a, 0, 1.92, 0));
  const top = new THREE.Group(); top.position.y = 1.78; g.add(top); a.flagMesh = top;
  const cols = [0xf06292, 0xffd54f, 0x64b5f6, 0x81c784, 0xba68c8, 0xff8a65];
  for (let k = 0; k < 6; k++) {
    const t = k / 6 * Math.PI * 2, r = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.35, 0.012), mat(cols[k]));
    r.position.set(Math.cos(t) * 0.3, -0.62, Math.sin(t) * 0.3); r.rotation.set(Math.sin(t) * 0.42, 0, -Math.cos(t) * 0.42); top.add(r);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 5, 10), mat(0x7cbf4f)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.02; top.add(ring);
  for (let k = 0; k < 5; k++) { const t = k / 5 * 6.28; g.add(ball(0.05, cols[k], Math.cos(t) * 0.12, 1.8, Math.sin(t) * 0.12)); }
}, { pad: false });

registerBuilder('flowerarch', g => {
  for (const x of [-0.38, 0.38]) g.add(box(0.07, 1.0, 0.07, C.timber, x, 0, 0));
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.04, 6, 14, Math.PI), mat(C.timber)); arch.position.y = 1.0; arch.castShadow = true; g.add(arch);
  const cols = [0xf06292, 0xffffff, 0xffd54f, 0xf48fb1];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12 * Math.PI, x = Math.cos(t) * 0.38, y = 1.0 + Math.sin(t) * 0.38;
    g.add(ball(0.07, k % 3 ? 0x5c9a3c : 0x4f8a3a, x, y, 0.0));
    if (k % 2 === 0) g.add(ball(0.045, cols[k % 4], x, y, 0.05));
  }
  for (const x of [-0.38, 0.38]) for (let y = 0.25; y < 1.0; y += 0.25) { g.add(ball(0.06, 0x5c9a3c, x, y, 0.03)); g.add(ball(0.035, cols[(y * 8) & 3], x, y + 0.05, 0.08)); }
}, { pad: false });

registerBuilder('sunflowers', g => {
  for (const [x, z, h] of [[-0.18, -0.1, 0.95], [0.16, 0.05, 1.1], [0.0, 0.2, 0.8], [-0.12, 0.22, 0.65]]) {
    g.add(cyl(0.02, 0.025, h, 5, 0x5c9a3c, x, 0, z));
    g.add(box(0.16, 0.02, 0.08, 0x5c9a3c, x + 0.06, h * 0.5, z));
    const head = new THREE.Group(); head.position.set(x, h, z + 0.02); head.rotation.x = -0.35; g.add(head);
    const petals = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 12), mat(0xf6c53f)); petals.rotation.x = Math.PI / 2; head.add(petals);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10), mat(0x6b4428)); disc.rotation.x = Math.PI / 2; disc.position.z = 0.01; head.add(disc);
  }
}, { pad: false });

registerBuilder('windchime', (g, a) => {
  g.add(box(0.07, 1.25, 0.07, C.timber, -0.25, 0, 0));
  g.add(box(0.45, 0.05, 0.05, C.timber, -0.05, 1.2, 0));
  const hang = new THREE.Group(); hang.position.set(0.12, 1.18, 0); g.add(hang); a.swing = hang;
  hang.add(cyl(0.11, 0.11, 0.03, 8, C.teal, 0, -0.08, 0));
  const cols = [0x64b5f6, 0xf06292, 0xffd54f, 0x81c784, 0xba68c8];
  for (let k = 0; k < 5; k++) { const t = k / 5 * 6.28; hang.add(cyl(0.018, 0.018, 0.3 + (k % 3) * 0.08, 6, cols[k], Math.cos(t) * 0.08, -0.45 - (k % 3) * 0.08, Math.sin(t) * 0.08)); }
  hang.add(box(0.05, 0.12, 0.01, 0xf3e3c3, 0, -0.62, 0));
}, { pad: false });

registerBuilder('pumpkinlantern', g => {
  const p = ball(0.24, C.orange, 0, 0.2, 0, 1); p.scale.set(1.15, 0.85, 1.05); g.add(p);
  g.add(cyl(0.03, 0.04, 0.1, 5, 0x5c7a2c, 0, 0.38, 0));
  for (const x of [-0.08, 0.08]) { const e = box(0.07, 0.07, 0.04, LAMP, x, 0.22, 0.23); e.rotation.z = x > 0 ? 0.6 : -0.6; g.add(e); }
  g.add(box(0.18, 0.05, 0.04, LAMP, 0, 0.11, 0.23));
  const s = ball(0.13, 0xe0702a, 0.3, 0.1, 0.12, 1); s.scale.y = 0.8; g.add(s);
}, { pad: false });

registerBuilder('scarecrow', g => {
  g.add(box(0.06, 1.2, 0.06, C.timber, 0, 0, 0));
  g.add(box(0.8, 0.06, 0.06, C.timber, 0, 0.88, 0));
  g.add(box(0.36, 0.42, 0.2, 0x6c8fb3, 0, 0.55, 0));                       // patched shirt
  g.add(box(0.12, 0.12, 0.21, 0xd9534f, 0.08, 0.66, 0.01));
  for (const x of [-0.3, 0.3]) g.add(box(0.2, 0.12, 0.14, 0x6c8fb3, x, 0.82, 0));
  for (const x of [-0.42, 0.42]) g.add(cone(0.05, 0.12, 5, C.hay, x, 0.78, 0));
  g.add(ball(0.15, 0xe9d3a8, 0, 1.12, 0, 1));
  g.add(cyl(0.24, 0.24, 0.03, 10, 0x8a5a33, 0, 1.2, 0));
  g.add(cone(0.12, 0.2, 8, 0x8a5a33, 0, 1.22, 0));
}, { pad: false });

registerBuilder('snowlantern', g => {
  g.add(cyl(0.18, 0.22, 0.12, 6, C.stone, 0, 0, 0));
  g.add(cyl(0.06, 0.08, 0.4, 6, C.stone, 0, 0.12, 0));
  g.add(cyl(0.2, 0.16, 0.06, 6, C.stone, 0, 0.52, 0));
  g.add(box(0.2, 0.18, 0.2, LAMP, 0, 0.58, 0));
  for (const [x, z] of [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]]) g.add(box(0.04, 0.2, 0.04, C.stone2, x, 0.57, z));
  g.add(cone(0.3, 0.2, 6, C.stone2, 0, 0.77, 0));
  g.add(ball(0.05, C.stone, 0, 1.0, 0));
}, { pad: false });

registerBuilder('wintertree', g => {
  g.add(cyl(0.05, 0.06, 0.2, 6, C.timber, 0, 0, 0));
  for (const [r, y, h] of [[0.42, 0.15, 0.55], [0.33, 0.45, 0.48], [0.22, 0.75, 0.42]]) g.add(cone(r, h, 8, 0x2e6d3e, 0, y, 0));
  const cols = [LAMP, 0xd9534f, 0x64b5f6, LAMP, 0xffd54f, LAMP];
  for (let k = 0; k < 10; k++) { const t = k * 2.4, y = 0.25 + (k / 10) * 0.75, r = 0.38 - (k / 10) * 0.26; g.add(ball(0.04, cols[k % cols.length], Math.cos(t) * r, y, Math.sin(t) * r)); }
  const star = ball(0.08, 0xffd54f, 0, 1.2, 0); g.add(star);
  for (let k = 0; k < 3; k++) g.add(box(0.12, 0.1, 0.12, [0xd9534f, 0x3f7fc4, 0xffd54f][k], -0.22 + k * 0.2, 0, 0.3 - (k % 2) * 0.12));
}, { pad: false });
