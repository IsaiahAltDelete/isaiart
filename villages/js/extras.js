// Round 7 visuals that live beside the main renderer: trade carts and their
// drivers, the ferry and its landings, player-built bridges, the arrows at the
// screen edge that point to off-screen gift chests, and the Dirt Road card art.
import * as THREE from '../vendor/three.module.min.js';
import { buildModel, villagerModel, mat } from './models.js';
import { N, HALF, idx, tileX, tileZ, toWorld, inMap, CENTERS, T_WATER } from './world.js';
import { ferryOn, ferryPos } from './island.js';
import { surfaceTexture } from './textures.js';
import { abutment } from './view.js';
import { svg } from './icons.js';
import { sfx } from './audio.js';

const DRIVERS = [
  { shirt: 0x8a6a4a, skin: 0xe8b590, hair: 0x6b4226, hat: true, hatColor: 0x8a5a33 },
  { shirt: 0x3fb7ae, skin: 0xc98e66, hair: 0x1b1b1b, hat: true, hatColor: 0xc9a050 },
  { shirt: 0xe8a23c, skin: 0xf5d0b0, hair: 0xa8452a, hat: false, hatColor: 0 },
];
const tmp = new THREE.Vector3();

export class Extras {
  constructor(game) {
    this.g = game;
    const sim = game.sim, view = game.view;
    this.carts = new Map();
    this.group = new THREE.Group(); view.scene.add(this.group);
    this.thumb();
    this.buildBridges();
    this.buildFerry();
    sim.on('bridge', () => { this.bridgesDirty = true; });
    sim.on('cartGone', c => this.dropCart(c.id));
    this.arrows = document.createElement('div'); this.arrows.id = 'chestArrows';
    document.body.appendChild(this.arrows);
    this.arrows.addEventListener('click', e => {
      const b = e.target.closest('[data-chest]'); if (!b) return;
      const ch = sim.s.chests.find(o => o.id === +b.dataset.chest); if (!ch) return;
      const r = view.rig; game.select(null); game.followV = null;
      view.flyTo(ch.x + Math.sin(r.yaw) * 2, ch.z + Math.cos(r.yaw) * 2, Math.max(16, Math.min(r.dist, 22)), 0.9);
      sfx.click();
    });
    this.focusT = 0;
  }

  update(dt, t) {
    if (this.bridgesDirty) { this.bridgesDirty = false; this.buildBridges(); }
    this.updateCarts(dt, t);
    this.updateFerry(dt, t);
    this.updateArrows();
    // goods with no obvious home (shop, merchant) go to the settlement you're looking at
    if ((this.focusT -= dt) <= 0 && this.g.sim.trade) {
      this.focusT = 1;
      const r = this.g.view.rig; this.g.sim.ledger.focus = this.g.sim.trade.nearestSid(r.tx, r.tz);
    }
  }

  // ── carts ──
  makeCart(c) {
    const root = new THREE.Group();
    const { group, anim } = buildModel('tradecart', [1, 2]);
    root.add(group);
    const d = villagerModel(DRIVERS[c.id % DRIVERS.length]);
    d.group.position.set(0, 0, c.kind === 'porter' ? -0.85 : 1.25);    // a porter pushes, a carter pulls
    if (c.kind === 'porter') d.group.rotation.y = 0;
    root.add(d.group);
    this.g.view.objects.add(root);
    const vis = { root, anim, d, phase: Math.random() * 6 };
    this.carts.set(c.id, vis);
    return vis;
  }
  dropCart(id) { const v = this.carts.get(id); if (v) { this.g.view.objects.remove(v.root); this.carts.delete(id); } }
  updateCarts(dt, t) {
    const sim = this.g.sim, list = sim.s.trade?.carts || [], seen = new Set(), W = sim.world;
    for (const c of list) {
      seen.add(c.id);
      const vis = this.carts.get(c.id) || this.makeCart(c);
      const ti = idx(Math.max(0, Math.min(N - 1, Math.floor(c.x + HALF))), Math.max(0, Math.min(N - 1, Math.floor(c.z + HALF))));
      const onBoat = !!c.ferry && c.ferry.state === 'ride', wet = W.type[ti] === T_WATER;
      let y = W.heightAt(c.x, c.z);
      if (onBoat) y = -0.18 + 0.27; else if (wet) y = Math.max(y, 0.13);
      vis.root.position.set(c.x, y, c.z);
      let df = (c.face || 0) - vis.root.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df));
      vis.root.rotation.y += df * Math.min(1, dt * 6);
      vis.root.visible = c.state !== 'idle';      // parked carts wait in the trade post's yard
      vis.root.scale.setScalar(onBoat ? 0.7 : 1);
      const moving = c.moving && c.state === 'move' && !c.ferry;
      if (vis.anim.wheels) for (const w of vis.anim.wheels) if (moving) w.rotation.x += dt * 5 * Math.max(1, sim.s.speed);
      if (vis.anim.load) vis.anim.load.visible = Object.values(c.load || {}).some(n => n > 0);
      const m = vis.d, k = moving ? Math.sin(t * 10 + vis.phase) * 0.6 : 0;
      m.hipL.rotation.x = k; m.hipR.rotation.x = -k;
      m.armL.rotation.x = m.armR.rotation.x = c.kind === 'porter' ? -1.2 : -0.5;
      m.body.position.y = moving ? Math.abs(Math.cos(t * 10 + vis.phase)) * 0.03 : 0;
    }
    for (const id of [...this.carts.keys()]) if (!seen.has(id)) this.dropCart(id);
  }

  // ── the ferry and its two landings ──
  buildFerry() {
    const W = this.g.sim.world, I = W.island;
    if (!I) return;
    const wood = mat(0xb98450, { map: surfaceTexture('wood') }), dark = mat(0x7a5232);
    this.piers = new THREE.Group();
    for (let side = 0; side < 2; side++) {
      const L = I.landing[side], lx = toWorld(tileX(L)), lz = toWorld(tileZ(L)), [mx, mz] = I.moor[side];
      const len = Math.hypot(mx - lx, mz - lz), ang = Math.atan2(mx - lx, mz - lz), g = new THREE.Group();
      g.position.set(lx, 0, lz); g.rotation.y = ang;
      for (let z = 0.1; z < len - 0.25; z += 0.3) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.07, 0.26), z % 0.9 < 0.3 ? dark : wood);
        p.position.set(0, Math.max(W.heightAt(lx + Math.sin(ang) * z, lz + Math.cos(ang) * z), -0.05) + 0.08, z); p.castShadow = p.receiveShadow = true; g.add(p);
      }
      for (const x of [-0.48, 0.48]) for (let z = 0.6; z < len; z += 0.9) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.75, 0.09), dark); post.position.set(x, -0.15, z); post.castShadow = true; g.add(post);
      }
      // a bell post so you can tell it's a ferry landing
      const bp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.0, 0.07), dark); bp.position.set(0.55, 0.5, 0.1); g.add(bp);
      const bell = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.12, 8), mat(0xd8a53a)); bell.position.set(0.55, 0.92, 0.22); g.add(bell);
      this.piers.add(g);
    }
    this.group.add(this.piers);
    const root = new THREE.Group(), { group, anim } = buildModel('ferry', [1, 2]);
    root.add(group); this.boatAnim = anim;
    const fm = villagerModel({ shirt: 0x2f6aa8, skin: 0xc98e66, hair: 0xd8d0c0, hat: true, hatColor: 0x3f7a39 });
    fm.group.position.set(-0.25, 0.26, -0.85); root.add(fm.group); this.ferryman = fm;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 5), dark); pole.position.set(-0.05, 0.9, -0.7); pole.rotation.x = 0.35; root.add(pole); this.pole = pole;
    this.boat = root; this.g.view.objects.add(root);
  }
  updateFerry(dt, t) {
    if (!this.boat) return;
    const sim = this.g.sim, on = ferryOn(sim);
    this.boat.visible = on;
    if (!on) return;
    const p = ferryPos(sim);
    this.boat.position.set(p.x, -0.2 + Math.sin(t * 1.5) * 0.025, p.z);
    let df = p.face - this.boat.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df));
    this.boat.rotation.y += df * Math.min(1, dt * 3);
    this.boat.rotation.z = Math.sin(t * 1.1) * 0.02;
    if (this.boatAnim.flagMesh) this.boatAnim.flagMesh.rotation.y = Math.sin(t * 3) * 0.3;
    const sail = p.at < 0;
    this.pole.rotation.x = sail ? 0.35 + Math.sin(t * 1.6) * 0.25 : 0.1;
    this.ferryman.armL.rotation.x = this.ferryman.armR.rotation.x = sail ? -1.3 + Math.sin(t * 1.6) * 0.25 : -0.3;
  }

  // ── player bridges: planks across the water, rails on the open sides, posts at the corners ──
  buildBridges() {
    if (this.bridges) { this.group.remove(this.bridges); this.bridges.traverse(o => o.geometry?.dispose()); }
    const W = this.g.sim.world, g = this.bridges = new THREE.Group();
    const wood = mat(0xb98450, { map: surfaceTexture('wood') }), dark = mat(0x7a5232, { map: surfaceTexture('wood') });
    const plank = new THREE.BoxGeometry(1.06, 0.07, 0.23), post = new THREE.BoxGeometry(0.08, 0.7, 0.08), rail = new THREE.BoxGeometry(1.04, 0.05, 0.06);
    const B = (x, z) => inMap(x, z) && W.bridge[idx(x, z)] > 0;
    const R = (x, z) => inMap(x, z) && W.type[idx(x, z)] !== T_WATER && (W.road[idx(x, z)] || W.paved[idx(x, z)]);
    const L = (x, z) => inMap(x, z) && W.type[idx(x, z)] !== T_WATER;
    for (let i = 0; i < N * N; i++) {
      if (W.bridge[i] !== 2) continue;
      const x = tileX(i), z = tileZ(i), cx = toWorld(x), cz = toWorld(z);
      const ax = B(x - 1, z) + B(x + 1, z) + (R(x - 1, z) + R(x + 1, z)) * 0.8 + (L(x - 1, z) + L(x + 1, z)) * 0.3;
      const az = B(x, z - 1) + B(x, z + 1) + (R(x, z - 1) + R(x, z + 1)) * 0.8 + (L(x, z - 1) + L(x, z + 1)) * 0.3;
      const alongX = ax >= az, t = new THREE.Group(); t.position.set(cx, 0, cz); t.rotation.y = alongX ? 0 : Math.PI / 2;
      // stone abutments where the deck lands on the bank
      for (const [ex, ez] of alongX ? [[x - 1, z], [x + 1, z]] : [[x, z - 1], [x, z + 1]]) {
        if (!L(ex, ez) || B(ex, ez)) continue;
        g.add(abutment(cx + (ex - x) * 0.5, cz + (ez - z) * 0.5, alongX ? Math.PI / 2 : 0, 1.15, W));
      }
      // planks run across the direction of travel
      for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(plank, k % 3 ? wood : dark); m.rotation.y = Math.PI / 2; m.position.set(-0.375 + k * 0.25, 0.1, 0); m.castShadow = m.receiveShadow = true; t.add(m); }
      // the two sides: rail unless another bridge tile sits alongside
      const side = alongX ? [[x, z - 1], [x, z + 1]] : [[x - 1, z], [x + 1, z]];
      side.forEach(([sx, sz], k) => {
        if (B(sx, sz)) return;
        const zz = (k ? 1 : -1) * 0.49 * (alongX ? 1 : -1);
        for (const xx of [-0.45, 0.45]) { const p = new THREE.Mesh(post, dark); p.position.set(xx, 0.0, zz); p.castShadow = true; t.add(p); }
        const r = new THREE.Mesh(rail, wood); r.position.set(0, 0.36, zz); t.add(r);
      });
      g.add(t);
    }
    this.group.add(g);
  }

  // ── arrows at the screen edge for gift chests you can't see ──
  updateArrows() {
    const g = this.g, chests = g.sim.s.chests || [], el = this.arrows;
    if (!chests.length && !el.childElementCount) return;
    const rect = g.view.canvas.getBoundingClientRect(), phone = innerWidth < 760;
    // on phone the right margin keeps arrows well clear of the side button column
    const m = { l: rect.left + (phone ? 24 : 34), r: rect.right - (phone ? 104 : 34), t: rect.top + (phone ? 150 : 104), b: rect.bottom - (phone ? 150 : 128) };
    const cx = (m.l + m.r) / 2, cy = (m.t + m.b) / 2, want = new Map();
    // keep clear of the HUD panels: slide in along the ray until the arrow is free
    const huds = ['#speed', '#left', '#quests', '#topright', '#dockbar', '#tray', '#world', '#shop', '#side', '#placebar'].map(q => document.querySelector(q))
      .filter(e => e && !e.classList.contains('hidden')).map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);   // (fixed panels have no offsetParent)
    const pad = phone ? 28 : 30, blocked = (x, y) => huds.some(r => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad);
    for (const ch of chests) {
      const c = g.chests.get(ch.id); if (c && c.t >= 0) continue;     // being opened
      const p = g.view.project(tmp.set(ch.x, g.sim.world.heightAt(ch.x, ch.z) + 0.4, ch.z));
      let dx = p.x - cx, dy = p.y - cy;
      const behind = !p.vis;
      if (behind) { dx = -dx; dy = -dy; }
      if (!behind && p.x > m.l && p.x < m.r && p.y > m.t && p.y < m.b) continue;    // it's on screen
      const k = Math.min(Math.abs((m.r - cx) / (dx || 1e-6)), Math.abs((m.b - cy) / (dy || 1e-6)));
      let t = k;
      while (t > 0.05 && blocked(cx + dx * t, cy + dy * t)) t *= 0.96;
      want.set(ch.id, { x: cx + dx * t, y: cy + dy * t, a: Math.atan2(dy, dx), ch });
    }
    for (const n of [...el.children]) if (!want.has(+n.dataset.chest)) n.remove();
    for (const [id, w] of want) {
      let n = el.querySelector(`[data-chest="${id}"]`);
      if (!n) {
        n = document.createElement('button'); n.className = 'chestarrow'; n.dataset.chest = id;
        n.innerHTML = `<span class="pt"></span>${svg('gift', 24)}`;
        n.setAttribute('aria-label', 'Fly to the gift chest');
        n.dataset.tip = `Gift chest|A gift chest is waiting in the woods near ${g.sim.sname(w.ch.sid)}. Tap to fly there.`;
        el.appendChild(n);
      }
      n.style.transform = `translate(${w.x.toFixed(1)}px, ${w.y.toFixed(1)}px)`;
      n.querySelector('.pt').style.transform = `rotate(${w.a.toFixed(3)}rad)`;
    }
  }

  // the build-card picture for the Dirt Road tool
  thumb() {
    const cv = document.createElement('canvas'); cv.width = 160; cv.height = 140;
    const c = cv.getContext('2d');
    c.translate(80, 74); c.scale(1, 0.62); c.rotate(-0.5);
    c.fillStyle = '#7cbf4f'; c.beginPath(); c.roundRect(-70, -70, 140, 140, 16); c.fill();
    c.fillStyle = '#6aad42'; for (let k = 0; k < 18; k++) { c.beginPath(); c.arc(Math.sin(k * 7.1) * 60, Math.cos(k * 3.3) * 60, 4, 0, 6.3); c.fill(); }
    const road = (w, col) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(-70, 30); c.bezierCurveTo(-20, 40, 0, -40, 70, -25); c.stroke(); };
    road(40, '#a9824f'); road(32, '#d6b27a'); road(10, '#e3c793');
    c.fillStyle = '#b9bcad'; for (const [x, y] of [[-40, 30], [10, 0], [45, -24]]) { c.beginPath(); c.ellipse(x, y + 12, 5, 3, 0, 0, 6.3); c.fill(); }
    this.g.thumbs.road = cv.toDataURL();
  }
}
