// Ambient wildlife: butterflies by day, fireflies at night, the odd flock
// of birds overhead and fish jumping in the river. Purely decorative.
import * as THREE from '../vendor/three.module.min.js';
import { N, HALF, T_WATER, idx } from './world.js';
import { CENTERS } from './world.js';

const BFLY = [0xffd54f, 0xf48fb1, 0x90caf9, 0xffffff, 0xffab40, 0xce93d8];

export class Life {
  constructor(view, sim) {
    this.view = view; this.sim = sim;
    const scene = view.scene;
    this.group = new THREE.Group(); scene.add(this.group);

    // butterflies
    const wing = new THREE.PlaneGeometry(0.2, 0.15); wing.translate(0.1, 0, 0); wing.rotateX(-Math.PI / 2);
    this.bflies = [];
    for (let i = 0; i < 18; i++) {
      const m = new THREE.MeshLambertMaterial({ color: BFLY[i % BFLY.length], side: THREE.DoubleSide });
      const g = new THREE.Group(), l = new THREE.Mesh(wing, m), r = new THREE.Mesh(wing, m);
      r.scale.x = -1; g.add(l, r);
      g.userData = { l, r, home: null, tx: 0, tz: 0, ty: 0.8, ph: Math.random() * 6, sp: 0.9 + Math.random() * 0.6 };
      this.group.add(g); this.bflies.push(g);
    }
    this.placeButterflies();

    // fireflies
    const n = 140, pos = new Float32Array(n * 3);
    this.ffSeed = Array.from({ length: n }, () => [Math.random() * 6.28, Math.random() * 6.28, 0.4 + Math.random() * 0.8]);
    this.ffBase = new Float32Array(n * 3);
    const ffGeo = new THREE.BufferGeometry(); ffGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.ffMat = new THREE.PointsMaterial({ color: 0xfff27a, size: 0.16, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ff = new THREE.Points(ffGeo, this.ffMat); this.ff.frustumCulled = false;
    scene.add(this.ff);
    this.ffCenter = { x: 1e9, z: 1e9 };

    // birds
    this.birds = null; this.birdTimer = 8;
    // fish jumps
    this.fishTimer = 3; this.jumps = [];
    this.fishGeo = new THREE.ConeGeometry(0.06, 0.28, 5).rotateZ(Math.PI / 2);
    this.rippleGeo = new THREE.RingGeometry(0.8, 1, 20).rotateX(-Math.PI / 2);
  }

  placeButterflies() {
    const ids = Object.keys(this.sim.s.unlocked);
    this.bflies.forEach((b, i) => {
      const c = CENTERS[ids[i % ids.length]];
      const u = b.userData;
      u.home = { x: c.x - HALF + 0.5, z: c.z - HALF + 0.5 };
      b.position.set(u.home.x + (Math.random() - 0.5) * 10, 0.8, u.home.z + (Math.random() - 0.5) * 10);
      this.retarget(b);
    });
  }
  retarget(b) {
    const u = b.userData, a = Math.random() * 6.28, r = 1 + Math.random() * 7;
    u.tx = u.home.x + Math.cos(a) * r; u.tz = u.home.z + Math.sin(a) * r;
    u.ty = 0.5 + Math.random() * 0.9;
  }

  update(dt, time, night) {
    const W = this.sim.world, rig = this.view.rig;
    // butterflies (day only)
    const day = night < 0.6;
    for (const b of this.bflies) {
      b.visible = day;
      if (!day) continue;
      const u = b.userData;
      const dx = u.tx - b.position.x, dz = u.tz - b.position.z, d = Math.hypot(dx, dz);
      if (d < 0.3) this.retarget(b);
      const sp = u.sp * dt;
      b.position.x += dx / (d || 1) * sp + Math.sin(time * 3 + u.ph) * dt * 0.4;
      b.position.z += dz / (d || 1) * sp + Math.cos(time * 2.6 + u.ph) * dt * 0.4;
      const gy = Math.max(W.heightAt(b.position.x, b.position.z), 0);
      b.position.y += ((gy + u.ty + Math.sin(time * 4 + u.ph) * 0.15) - b.position.y) * Math.min(1, dt * 3);
      b.rotation.y = Math.atan2(dx, dz) - Math.PI / 2;
      const f = Math.sin(time * 22 + u.ph) * 1.1;
      u.l.rotation.z = f; u.r.rotation.z = -f;
    }

    // fireflies around the camera target at night
    this.ffMat.opacity = Math.max(0, (night - 0.35) * 1.6);
    this.ff.visible = this.ffMat.opacity > 0.01;
    if (this.ff.visible) {
      const pos = this.ff.geometry.attributes.position, base = this.ffBase;
      if (Math.hypot(rig.tx - this.ffCenter.x, rig.tz - this.ffCenter.z) > 10) {
        this.ffCenter = { x: rig.tx, z: rig.tz };
        for (let i = 0; i < pos.count; i++) {
          const x = rig.tx + (Math.random() - 0.5) * 40, z = rig.tz + (Math.random() - 0.5) * 32;
          base[i * 3] = x; base[i * 3 + 2] = z; base[i * 3 + 1] = Math.max(W.heightAt(x, z), 0) + 0.3;
        }
      }
      for (let i = 0; i < pos.count; i++) {
        const [a, b, h] = this.ffSeed[i];
        pos.setXYZ(i, base[i * 3] + Math.sin(time * 0.5 + a) * 0.6, base[i * 3 + 1] + h + Math.sin(time * 0.9 + b) * 0.25, base[i * 3 + 2] + Math.cos(time * 0.4 + b) * 0.6);
      }
      pos.needsUpdate = true;
      this.ffMat.size = 0.12 + Math.sin(time * 3) * 0.03;
    }

    // birds
    this.birdTimer -= dt;
    if (!this.birds && this.birdTimer <= 0 && !night) this.spawnBirds();
    if (this.birds) {
      const f = this.birds;
      f.t += dt;
      f.group.position.addScaledVector(f.dir, dt * 5.5);
      for (const b of f.group.children) { const k = Math.sin(time * 9 + b.userData.ph) * 0.6; b.userData.l.rotation.z = k; b.userData.r.rotation.z = -k; }
      if (f.t > 14) { this.group.remove(f.group); this.birds = null; this.birdTimer = 25 + Math.random() * 35; }
    }

    // fish jumping
    this.fishTimer -= dt;
    if (this.fishTimer <= 0) { this.fishTimer = 2.5 + Math.random() * 5; this.jumpFish(); }
    this.jumps = this.jumps.filter(j => {
      j.t += dt;
      const k = j.t / 0.8;
      if (j.fish) {
        if (k < 1) { j.fish.position.set(j.x + j.dx * k, -0.15 + Math.sin(k * Math.PI) * 0.55, j.z + j.dz * k); j.fish.rotation.z = (0.5 - k) * 2; j.fish.rotation.y = j.ry; }
        else { this.group.remove(j.fish); j.fish = null; this.ripple(j.x + j.dx, j.z + j.dz); }
      }
      if (j.ring) {
        const r = (j.t - (j.delay || 0));
        if (r > 0) { j.ring.visible = true; j.ring.scale.setScalar(0.15 + r * 0.7); j.ring.material.opacity = Math.max(0, 0.6 - r * 0.6); }
        if (r > 1) { this.group.remove(j.ring); return false; }
        return true;
      }
      return !!j.fish;
    });
  }

  spawnBirds() {
    const rig = this.view.rig, g = new THREE.Group();
    const a = Math.random() * Math.PI * 2, dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    g.position.set(rig.tx - dir.x * 38, 9 + Math.random() * 3, rig.tz - dir.z * 38);
    g.rotation.y = Math.atan2(dir.x, dir.z);
    const m = new THREE.MeshLambertMaterial({ color: 0x4a3b30, side: THREE.DoubleSide });
    const wing = new THREE.PlaneGeometry(0.4, 0.14); wing.translate(0.2, 0, 0); wing.rotateX(-Math.PI / 2);
    const n = 3 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) {
      const b = new THREE.Group(), l = new THREE.Mesh(wing, m), r = new THREE.Mesh(wing, m); r.scale.x = -1;
      b.add(l, r, new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.26), m));
      const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
      b.position.set(side * row * 0.7, (Math.random() - 0.5) * 0.3, -row * 0.7);
      b.userData = { l, r, ph: Math.random() * 6 };
      g.add(b);
    }
    this.group.add(g);
    this.birds = { group: g, dir, t: 0 };
  }

  jumpFish() {
    const W = this.sim.world, rig = this.view.rig;
    for (let k = 0; k < 20; k++) {
      const x = rig.tx + (Math.random() - 0.5) * 30, z = rig.tz + (Math.random() - 0.5) * 24;
      const tx = Math.floor(x + HALF), tz = Math.floor(z + HALF);
      if (tx < 1 || tz < 1 || tx >= N - 1 || tz >= N - 1) continue;
      if (W.type[idx(tx, tz)] !== T_WATER || W.bridge[idx(tx, tz)]) continue;
      if (W.hv[tz * (N + 1) + tx] > -0.5) continue;      // deep enough
      const fish = new THREE.Mesh(this.fishGeo, new THREE.MeshLambertMaterial({ color: 0x9fb8c8, flatShading: true }));
      const a = Math.random() * 6.28;
      this.group.add(fish);
      this.jumps.push({ fish, x, z, dx: Math.cos(a) * 0.6, dz: Math.sin(a) * 0.6, ry: -a, t: 0 });
      this.ripple(x, z);
      return;
    }
  }
  ripple(x, z) {
    const ring = new THREE.Mesh(this.rippleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
    ring.position.set(x, -0.1, z); ring.visible = false;
    this.group.add(ring);
    this.jumps.push({ ring, t: 0 });
  }
}
