// Rendering: terrain, water, instanced forest, camera rig and input.
import * as THREE from '../vendor/three.module.min.js';
import { N, HALF, idx, tileX, tileZ, T_WATER, T_SAND, toWorld } from './world.js';
import { fbm, mulberry32, hash2 } from './rng.js';
import { pineGeo, roundGeo, stumpGeo, rockGeo, bushGeo, berriesGeo } from './models.js';
import { iconImage } from './icons.js';

const CH = 16;               // chunk size for instanced forest culling
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export const timeUniform = { value: 0 };
function swayMaterial(base) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3][0] * 0.7 + instanceMatrix[3][2] * 0.45;
        float sw = max(position.y - 0.35, 0.0);
        transformed.x += sin(uTime * 1.4 + ph) * 0.035 * sw;
        transformed.z += cos(uTime * 1.1 + ph) * 0.025 * sw;
      #endif`);
  };
  return m;
}

export class View {
  constructor(canvas, world, quality = 'high') {
    this.world = world;
    this.canvas = canvas;
    this.quality = quality;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.maxRatio = Math.min(devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1);
    this.ratio = this.maxRatio;
    r.setPixelRatio(this.ratio);
    r.shadowMap.enabled = quality !== 'low';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9cd3c0);
    scene.fog = new THREE.Fog(0x9cd3c0, 55, 120);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
    this.rig = { tx: 0, tz: 0, dist: 30, yaw: 0.55, pitch: 0.92, vx: 0, vz: 0 };
    this.fly = null;

    this.hemi = new THREE.HemisphereLight(0xfff6e2, 0x5d8a3a, 1.55);
    scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d0, 2.5);
    sun.castShadow = true;
    const sz = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(sz, sz);
    const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    this.buildTerrain();
    this.buildWater();
    this.buildForest();
    this.buildSkirt();
    this.buildBridges();
    this.buildGrass();

    this.objects = new THREE.Group(); scene.add(this.objects);
    this.fx = new THREE.Group(); scene.add(this.fx);

    // ground-plane picking
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // phones in portrait see less sideways; pull back a little
    this.camera.fov = w / h < 0.8 ? 50 : 38;
    this.camera.updateProjectionMatrix();
  }

  // ── terrain ──
  buildTerrain() {
    const W = this.world, hv = W.hv, V = N + 1;
    const pos = new Float32Array(N * N * 18), col = new Float32Array(N * N * 18);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const o = (z * N + x) * 18;
      const corners = [[x, z], [x, z + 1], [x + 1, z], [x + 1, z + 1], [x + 1, z], [x, z + 1]];
      corners.forEach(([cx, cz], k) => {
        pos[o + k * 3] = cx - HALF; pos[o + k * 3 + 1] = hv[cz * V + cx]; pos[o + k * 3 + 2] = cz - HALF;
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.terrainColor = new THREE.BufferAttribute(col, 3);
    g.setAttribute('color', this.terrainColor);
    g.computeVertexNormals();
    this.terrainGeo = g;
    this.tc = new Float32Array(N * N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N * N; i++) { this.tileColor(i, c); this.tc.set([c.r, c.g, c.b], i * 3); }
    for (let i = 0; i < N * N; i++) this.writeTile(i);
    const m = this.terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    m.receiveShadow = true;
    this.scene.add(m);
  }

  tileColor(i, out) {
    const W = this.world, x = tileX(i), z = tileZ(i);
    const t = W.type[i];
    if (t === T_WATER) return out.setHex(0x3a8fb0);
    const n = fbm(x * 0.09, z * 0.09, W.seed + 77);
    if (t === T_SAND) out.setHex(0xe3cf92);
    else {
      out.setHSL(0.27 + n * 0.04, 0.55, 0.42 + n * 0.1);
      if (W.tree[i] >= 0) out.multiplyScalar(0.82);
    }
    if (W.paved[i]) {
      const k = hash2(x, z, 7);
      return out.setRGB(0.6 + k * 0.08, 0.57 + k * 0.07, 0.5 + k * 0.06);
    }
    const wear = W.wear[i];
    if (wear > 0.12) {
      const k = Math.min(1, (wear - 0.12) / 0.6);
      tmpC.setHex(W.road[i] ? 0xd6b27a : 0xcbab7c);
      out.lerp(tmpC, k * (W.road[i] ? 1 : 0.85));
    }
    if (W.occ[i] >= 0 && !W.road[i]) out.lerp(tmpC.setHex(0xb59a6c), 0.25);
    return out;
  }
  // Each vertex takes the average colour of the (up to 4) tiles sharing its
  // corner, so roads and footpaths blend into soft, rounded shapes instead of
  // hard squares. The second triangle is a touch darker for the faceted look.
  cornerColor(cx, cz, out) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const o = (z * N + x) * 3;
      r += this.tc[o]; g += this.tc[o + 1]; b += this.tc[o + 2]; n++;
    }
    out[0] = r / n; out[1] = g / n; out[2] = b / n;
  }
  writeTile(i) {
    const x = tileX(i), z = tileZ(i), a = this.terrainColor.array, o = i * 18;
    const own = i * 3, tc = this.tc, k = this._ck || (this._ck = [0, 0, 0]);
    const corners = [[x, z], [x, z + 1], [x + 1, z], [x + 1, z + 1], [x + 1, z], [x, z + 1]];
    for (let v = 0; v < 6; v++) {
      this.cornerColor(corners[v][0], corners[v][1], k);
      const s = v < 3 ? 1 : 0.95;
      // keep a little of the tile's own colour so grass keeps its patchwork
      a[o + v * 3] = (k[0] * 0.8 + tc[own] * 0.2) * s;
      a[o + v * 3 + 1] = (k[1] * 0.8 + tc[own + 1] * 0.2) * s;
      a[o + v * 3 + 2] = (k[2] * 0.8 + tc[own + 2] * 0.2) * s;
    }
  }
  paintTile(i, flag = true) {
    const c = this.tileColor(i, new THREE.Color());
    this.tc.set([c.r, c.g, c.b], i * 3);
    const x = tileX(i), z = tileZ(i);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < N && nz < N) this.writeTile(nz * N + nx);
    }
    if (flag) this.terrainColor.needsUpdate = true;
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(N + 4, N + 4, 48, 48);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.MeshPhongMaterial({ color: 0x55bfe8, shininess: 90, specular: 0x9fe3ff, transparent: true, opacity: 0.86, flatShading: true });
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = timeUniform;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y += sin(position.x * 0.9 + uTime * 1.3) * 0.04 + cos(position.z * 1.1 + uTime * 1.1) * 0.04;`);
    };
    const water = this.water = new THREE.Mesh(geo, m);
    water.position.y = -0.18; water.receiveShadow = true;
    this.scene.add(water);
    // lily pads + sparkles
    const rng = mulberry32(this.world.seed + 5);
    const pads = [];
    for (let i = 0; i < N * N; i++) {
      if (this.world.type[i] !== T_WATER || rng() > 0.03) continue;
      pads.push([toWorld(tileX(i)) + (rng() - 0.5) * 0.6, toWorld(tileZ(i)) + (rng() - 0.5) * 0.6, 0.18 + rng() * 0.15, rng() * 6]);
    }
    const pg = new THREE.CylinderGeometry(1, 1, 0.02, 9, 1, false, 0.4, Math.PI * 2 - 0.8);
    const pm = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ color: 0x5aa83c, flatShading: true }), pads.length);
    pads.forEach(([x, z, s, r], k) => { tmpQ.setFromAxisAngle(UP, r); pm.setMatrixAt(k, tmpM.compose(tmpV.set(x, -0.12, z), tmpQ, tmpS.set(s, 1, s))); });
    this.scene.add(pm);
  }

  // little grass tufts and wildflowers scattered over open meadow
  buildGrass() {
    const W = this.world, rng = mulberry32(W.seed + 31);
    const tuft = new THREE.ConeGeometry(0.045, 0.26, 3); tuft.translate(0, 0.13, 0);
    const parts = [];
    for (const [x, z, r] of [[0, 0, 0], [0.07, 0.03, 0.4], [-0.06, 0.04, -0.4], [0.02, -0.07, 0.2]]) {
      const g = tuft.clone(); g.rotateZ(r * 0.6); g.rotateX(r * -0.4); g.translate(x, 0, z); parts.push(g);
    }
    const tGeo = mergeSimple(parts);
    const fGeo = mergeSimple([new THREE.CylinderGeometry(0.01, 0.01, 0.2, 3).translate(0, 0.1, 0), new THREE.IcosahedronGeometry(0.05, 0).translate(0, 0.22, 0)]);
    const spots = [], flowers = [];
    for (let i = 0; i < N * N; i++) {
      if (W.type[i] !== 0 || W.road[i]) continue;
      const r = rng();
      if (r < 0.32) spots.push(i); else if (r < 0.4) flowers.push(i);
    }
    const mk = (geo, list, colorFn) => {
      const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), list.length);
      im.userData.map = new Int32Array(N * N).fill(-1);
      im.userData.mats = [];
      list.forEach((i, k) => {
        const x = toWorld(tileX(i)) + (rng() - 0.5) * 0.7, z = toWorld(tileZ(i)) + (rng() - 0.5) * 0.7, s = 0.7 + rng() * 0.7;
        tmpQ.setFromAxisAngle(UP, rng() * 6.28);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, W.heightAt(x, z), z), tmpQ, new THREE.Vector3(s, s, s));
        im.setMatrixAt(k, m); im.userData.mats.push(m);
        im.setColorAt(k, colorFn(i));
        im.userData.map[i] = k;
      });
      im.receiveShadow = true;
      this.scene.add(im);
      return im;
    };
    this.tufts = mk(tGeo, spots, i => tmpC.setHSL(0.26 + fbm(tileX(i) * 0.09, tileZ(i) * 0.09, W.seed + 77) * 0.05, 0.6, 0.38));
    const pal = [0xf06292, 0xffd54f, 0xffffff, 0xba68c8, 0x64b5f6, 0xff8a65];
    this.flowers = mk(fGeo, flowers, () => tmpC.setHex(pal[(rng() * pal.length) | 0]));
    for (let i = 0; i < N * N; i++) { this.updateGrass(i); if (W.paved[i]) this.updatePave(i); }
  }
  // cobblestones on paved tiles
  updatePave(i) {
    const W = this.world;
    if (!this.cobbles) {
      const cap = 4500;
      this.cobbles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 6), new THREE.MeshLambertMaterial({ flatShading: true }), cap);
      this.cobbles.receiveShadow = true; this.cobbles.frustumCulled = false;
      for (let k = 0; k < cap; k++) { this.cobbles.setMatrixAt(k, tmpM.makeScale(0, 0, 0)); this.cobbles.setColorAt(k, tmpC.setHex(0xd6ccb6)); }
      this.cobbles.userData = { free: [], used: 0, cap, slots: new Map() };
      this.scene.add(this.cobbles);
    }
    const c = this.cobbles, u = c.userData, have = u.slots.get(i);
    const want = W.paved[i] && W.occ[i] < 0;
    if (want && !have) {
      const slots = [];
      const x0 = toWorld(tileX(i)), z0 = toWorld(tileZ(i));
      for (let k = 0; k < 4; k++) {
        const slot = u.free.length ? u.free.pop() : (u.used < u.cap ? u.used++ : -1);
        if (slot < 0) break;
        const x = x0 + (k % 2 - 0.5) * 0.48 + (hash2(i, k, 3) - 0.5) * 0.1, z = z0 + ((k >> 1) - 0.5) * 0.48 + (hash2(i, k, 4) - 0.5) * 0.1;
        const sc = 0.85 + hash2(i, k, 5) * 0.35;
        tmpQ.setFromAxisAngle(UP, hash2(i, k, 6) * 6);
        c.setMatrixAt(slot, tmpM.compose(tmpV.set(x, W.heightAt(x, z) + 0.01, z), tmpQ, tmpS.set(sc, 1, sc)));
        const t = hash2(i, k, 8);
        c.setColorAt(slot, tmpC.setRGB(0.7 + t * 0.12, 0.66 + t * 0.1, 0.58 + t * 0.08));
        slots.push(slot);
      }
      u.slots.set(i, slots);
    } else if (!want && have) {
      for (const slot of have) { c.setMatrixAt(slot, tmpM.makeScale(0, 0, 0)); u.free.push(slot); }
      u.slots.delete(i);
    } else return;
    c.instanceMatrix.needsUpdate = true; if (c.instanceColor) c.instanceColor.needsUpdate = true;
  }
  updateGrass(i) {
    const W = this.world;
    const hide = W.occ[i] >= 0 || W.paved[i] || W.wear[i] > 0.35 || W.tree[i] >= 0 || W.rock[i] >= 0 || W.bush[i] >= 0;
    for (const im of [this.tufts, this.flowers]) {
      const k = im.userData.map[i];
      if (k < 0) continue;
      im.setMatrixAt(k, hide ? tmpM.makeScale(0, 0, 0) : im.userData.mats[k]);
      im.instanceMatrix.needsUpdate = true;
    }
  }

  buildBridges() {
    const wood = new THREE.MeshLambertMaterial({ color: 0xb98450, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x7a5232, flatShading: true });
    for (const b of this.world.bridges) {
      const g = new THREE.Group();
      const x0 = b.x0 - HALF - 0.6, x1 = b.x1 - HALF + 1.6, len = x1 - x0, cz = b.z - HALF + 1;
      for (let k = 0; k < Math.ceil(len / 0.32); k++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 1.9), k % 3 ? wood : dark);
        const x = x0 + 0.16 + k * 0.32, arch = Math.sin((x - x0) / len * Math.PI) * 0.22;
        p.position.set(x, 0.12 + arch, cz); p.castShadow = p.receiveShadow = true; g.add(p);
      }
      for (const side of [-0.95, 0.95]) {
        for (let k = 0; k <= 4; k++) {
          const x = x0 + 0.2 + k * (len - 0.4) / 4, arch = Math.sin((x - x0) / len * Math.PI) * 0.22;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), dark);
          post.position.set(x, 0.32 + arch, cz + side); post.castShadow = true; g.add(post);
        }
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len - 0.3, 0.06, 0.07), wood);
        rail.position.set(x0 + len / 2, 0.58 + 0.15, cz + side); g.add(rail);
      }
      this.scene.add(g);
    }
  }

  buildSkirt() {
    // forest floor beyond the map edge (four strips framing the square map)
    // plus a ring of decorative trees so the world never ends in a cliff
    const m = new THREE.MeshLambertMaterial({ color: 0x4d8a38 });
    const F = 260;
    for (const [w, d, x, z] of [[2 * F, F, 0, -HALF - F / 2], [2 * F, F, 0, HALF + F / 2], [F, N, -HALF - F / 2, 0], [F, N, HALF + F / 2, 0]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), m);
      p.position.set(x, 0.9, z); p.receiveShadow = true; this.scene.add(p);
    }
    const rng = mulberry32(this.world.seed + 99);
    const spots = [[], []];
    const B = 14;
    for (let z = -B; z < N + B; z++) for (let x = -B; x < N + B; x++) {
      if (x >= 0 && z >= 0 && x < N && z < N) continue;
      if (rng() > 0.8) continue;
      spots[rng() < 0.55 ? 0 : 1].push([x - HALF + 0.5 + (rng() - 0.5) * 0.6, z - HALF + 0.5 + (rng() - 0.5) * 0.6, 0.85 + rng() * 0.6, rng() * 6, rng()]);
    }
    spots.forEach((list, kind) => {
      const im = new THREE.InstancedMesh(kind ? this.roundG : this.pineG, this.treeMat, list.length);
      list.forEach(([x, z, s, r, t], k) => {
        tmpQ.setFromAxisAngle(UP, r);
        im.setMatrixAt(k, tmpM.compose(tmpV.set(x, 0.88, z), tmpQ, tmpS.set(s, s * (0.9 + t * 0.3), s)));
        im.setColorAt(k, tmpC.setRGB(0.78 + t * 0.25, 0.84 + t * 0.2, 0.8 + t * 0.15));
      });
      im.receiveShadow = true;
      this.scene.add(im);
    });
  }

  // ── forest (instanced, chunked so off-screen chunks are culled) ──
  buildForest() {
    const W = this.world;
    this.pineG = pineGeo(); this.roundG = roundGeo();
    this.treeMat = swayMaterial();
    const plain = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const CN = N / CH;
    this.chunks = [];
    const counts = new Array(CN * CN * 2).fill(0);
    for (const t of W.trees) counts[(((t.tz / CH) | 0) * CN + ((t.tx / CH) | 0)) * 2 + t.kind]++;
    for (let k = 0; k < CN * CN * 2; k++) {
      const cap = counts[k] + 24;
      const im = new THREE.InstancedMesh(k % 2 ? this.roundG : this.pineG, this.treeMat, cap);
      im.castShadow = true; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const cx = ((k / 2 | 0) % CN) * CH - HALF + CH / 2, cz = ((k / 2 / CN) | 0) * CH - HALF + CH / 2;
      im.frustumCulled = true;
      im.userData = { used: 0, free: [], cx, cz };
      for (let s = 0; s < cap; s++) { im.setMatrixAt(s, tmpM.makeScale(0, 0, 0)); im.setColorAt(s, tmpC.setRGB(1, 1, 1)); }
      im.count = cap;
      this.chunks.push(im);
      this.scene.add(im);
    }
    for (let ti = 0; ti < W.trees.length; ti++) if (W.trees[ti].alive) this.placeTree(ti);
    for (const im of this.chunks) this.fixBounds(im);

    // stumps
    this.stumps = new THREE.InstancedMesh(stumpGeo(), plain, 1500);
    this.stumps.userData = { free: [], used: 0 };
    for (let s = 0; s < 1500; s++) this.stumps.setMatrixAt(s, tmpM.makeScale(0, 0, 0));
    this.stumps.castShadow = true; this.stumps.frustumCulled = false;
    this.scene.add(this.stumps);

    // rocks
    this.rockMesh = new THREE.InstancedMesh(rockGeo(), plain, W.rocks.length + 1);
    this.rockMesh.castShadow = true; this.rockMesh.receiveShadow = true; this.rockMesh.frustumCulled = false;
    W.rocks.forEach((r, k) => this.updateRock(k));
    this.scene.add(this.rockMesh);

    // bushes + berries
    this.bushMesh = new THREE.InstancedMesh(bushGeo(), plain, W.bushes.length + 1);
    this.berryMesh = new THREE.InstancedMesh(berriesGeo(), plain, W.bushes.length + 1);
    this.bushMesh.castShadow = true; this.bushMesh.frustumCulled = false; this.berryMesh.frustumCulled = false;
    W.bushes.forEach((b, k) => this.updateBush(k));
    this.scene.add(this.bushMesh, this.berryMesh);
  }
  fixBounds(im) {
    im.boundingSphere = new THREE.Sphere(new THREE.Vector3(im.userData.cx, 1, im.userData.cz), CH * 0.75 + 2);
  }
  chunkFor(t) { const CN = N / CH; return this.chunks[(((t.tz / CH) | 0) * CN + ((t.tx / CH) | 0)) * 2 + t.kind]; }
  placeTree(ti) {
    const t = this.world.trees[ti];
    const im = this.chunkFor(t), u = im.userData;
    let slot = u.free.length ? u.free.pop() : (u.used < im.count ? u.used++ : -1);
    if (slot < 0) return;
    t.slot = slot;
    this.updateTree(ti);
  }
  updateTree(ti) {
    const t = this.world.trees[ti];
    if (t.slot === undefined) return;
    const im = this.chunkFor(t);
    if (!t.alive) {
      im.setMatrixAt(t.slot, tmpM.makeScale(0, 0, 0));
      im.userData.free.push(t.slot); t.slot = undefined;
    } else {
      const s = t.s * Math.max(0.05, t.growth);
      tmpQ.setFromAxisAngle(UP, t.rot);
      im.setMatrixAt(t.slot, tmpM.compose(tmpV.set(t.x, this.world.heightAt(t.x, t.z) - 0.02, t.z), tmpQ, tmpS.set(s, s * (0.9 + t.tint * 0.3), s)));
      if (t.marked) tmpC.setRGB(1.5, 0.75, 0.55);
      else tmpC.setRGB(0.82 + t.tint * 0.28, 0.88 + t.tint * 0.2, 0.82 + t.tint * 0.12);
      im.setColorAt(t.slot, tmpC);
      im.instanceColor.needsUpdate = true;
    }
    im.instanceMatrix.needsUpdate = true;
  }
  addStump(x, z) {
    const u = this.stumps.userData;
    const slot = u.free.length ? u.free.pop() : (u.used < 1500 ? u.used++ : -1);
    if (slot < 0) return -1;
    tmpQ.setFromAxisAngle(UP, Math.random() * 6);
    this.stumps.setMatrixAt(slot, tmpM.compose(tmpV.set(x, this.world.heightAt(x, z) - 0.02, z), tmpQ, tmpS.set(1, 1, 1)));
    this.stumps.instanceMatrix.needsUpdate = true;
    return slot;
  }
  removeStump(slot) {
    if (slot < 0) return;
    this.stumps.setMatrixAt(slot, tmpM.makeScale(0, 0, 0));
    this.stumps.instanceMatrix.needsUpdate = true;
    this.stumps.userData.free.push(slot);
  }
  updateRock(k) {
    const r = this.world.rocks[k];
    const s = r.alive ? r.s * (0.45 + 0.55 * r.hp / 100) : 0;
    tmpQ.setFromAxisAngle(UP, r.rot);
    this.rockMesh.setMatrixAt(k, tmpM.compose(tmpV.set(r.x, this.world.heightAt(r.x, r.z) - 0.05, r.z), tmpQ, tmpS.set(s * 1.6, s * 1.6, s * 1.6)));
    this.rockMesh.instanceMatrix.needsUpdate = true;
  }
  updateBush(k) {
    const b = this.world.bushes[k];
    const s = b.alive ? b.s : 0;
    tmpQ.setFromAxisAngle(UP, k * 1.7);
    tmpM.compose(tmpV.set(b.x, this.world.heightAt(b.x, b.z) - 0.03, b.z), tmpQ, tmpS.set(s, s, s));
    this.bushMesh.setMatrixAt(k, tmpM);
    if (!b.ripe || !b.alive) tmpM.makeScale(0, 0, 0);
    this.berryMesh.setMatrixAt(k, tmpM);
    this.bushMesh.instanceMatrix.needsUpdate = true; this.berryMesh.instanceMatrix.needsUpdate = true;
  }

  // ── camera ──
  updateCamera(dt) {
    const r = this.rig;
    if (this.fly) {
      const f = this.fly; f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
      r.tx = f.x0 + (f.x1 - f.x0) * e; r.tz = f.z0 + (f.z1 - f.z0) * e;
      if (f.d1) r.dist = f.d0 + (f.d1 - f.d0) * e;
      if (f.t >= 1) this.fly = null;
    } else if (Math.abs(r.vx) + Math.abs(r.vz) > 0.001) {
      r.tx += r.vx * dt; r.tz += r.vz * dt;
      const k = Math.pow(0.004, dt); r.vx *= k; r.vz *= k;
    }
    const lim = HALF - 8;
    r.tx = Math.max(-lim, Math.min(lim, r.tx)); r.tz = Math.max(-lim, Math.min(lim, r.tz));
    r.dist = Math.max(9, Math.min(52, r.dist));
    r.pitch = Math.max(0.62, Math.min(1.32, r.pitch));
    const cp = Math.cos(r.pitch), sp = Math.sin(r.pitch);
    const ty = this.world.heightAt(r.tx, r.tz) * 0.5;
    this.camera.position.set(r.tx + Math.sin(r.yaw) * cp * r.dist, ty + sp * r.dist, r.tz + Math.cos(r.yaw) * cp * r.dist);
    this.camera.lookAt(r.tx, ty, r.tz);
    // sun + shadow camera follow the view
    this.sun.position.set(r.tx + 18, 34, r.tz + 10);
    this.sun.target.position.set(r.tx, 0, r.tz);
    const span = Math.min(42, 14 + r.dist * 0.75);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - span) > 0.5) { sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.updateProjectionMatrix(); }
  }
  flyTo(x, z, dist, dur = 0.9) {
    this.fly = { t: 0, dur, x0: this.rig.tx, z0: this.rig.tz, x1: x, z1: z, d0: this.rig.dist, d1: dist };
  }
  groundAt(clientX, clientY, out = new THREE.Vector3()) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera({ x: nx, y: ny }, this.camera);
    // refine against terrain height: march the ray
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let t = (0.1 - o.y) / d.y;
    for (let k = 0; k < 4; k++) {
      const p = tmpV.copy(d).multiplyScalar(t).add(o);
      const h = this.world.heightAt(p.x, p.z);
      t = (Math.max(h, -0.18) - o.y) / d.y;
    }
    return out.copy(d).multiplyScalar(t).add(o);
  }
  raycast(clientX, clientY, objects) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera({ x: nx, y: ny }, this.camera);
    return this.ray.intersectObjects(objects, true);
  }
  project(v) {
    const p = tmpV.copy(v).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: (p.x * 0.5 + 0.5) * rect.width + rect.left, y: (-p.y * 0.5 + 0.5) * rect.height + rect.top, vis: p.z < 1 && p.z > -1 };
  }

  // dynamic resolution: drop pixel ratio when frames are slow, recover when fast
  adapt(dt) {
    this.ft = (this.ft ?? 16) * 0.95 + dt * 1000 * 0.05;
    this.adaptT = (this.adaptT || 0) + dt;
    if (this.adaptT < 2) return;
    this.adaptT = 0;
    let r = this.ratio;
    if (this.ft > 38 && r > 0.75) r = Math.max(0.75, r - 0.25);
    else if (this.ft < 22 && r < this.maxRatio) r = Math.min(this.maxRatio, r + 0.25);
    if (r !== this.ratio) { this.ratio = r; this.renderer.setPixelRatio(r); this.resize(); }
  }

  render() { this.renderer.render(this.scene, this.camera); }
}

function mergeSimple(list) {
  const geos = list.map(g => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3); let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.computeVertexNormals();
  return out;
}

// ── status bubbles above buildings (sprites drawn from SVG icons) ──
const bubbleCache = new Map();
export function bubbleTexture(icon) {
  if (bubbleCache.has(icon)) return bubbleCache.get(icon);
  const cv = document.createElement('canvas'); cv.width = 96; cv.height = 112;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 96, 112);
    g.fillStyle = '#fffaf0'; g.strokeStyle = '#8a5a2b'; g.lineWidth = 5;
    g.beginPath(); g.roundRect(6, 6, 84, 80, 22); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(36, 84); g.lineTo(48, 104); g.lineTo(60, 84); g.closePath(); g.fill(); g.stroke();
    g.fillRect(38, 78, 20, 8);
    const img = iconImage(icon);
    if (img.complete && img.naturalWidth) { g.drawImage(img, 18, 16, 60, 60); tex.needsUpdate = true; }
    else img.addEventListener('load', draw, { once: true });
  };
  draw();
  bubbleCache.set(icon, tex);
  return tex;
}
