// Entry point: wires the simulation, the 3D view, the UI and input.
import * as THREE from '../vendor/three.module.min.js';
import { Sim, defOf, isDecor, footprint, DAY, lvlOf, RANGE } from './sim.js';
import { View, bubbleTexture, timeUniform } from './view.js';
import { buildModel, scaffold, villagerModel, setTool, mat, C, pineGeo, stumpGeo } from './models.js';
import { UI } from './ui.js';
import { N, HALF, idx, toWorld, inMap, CENTERS, tileX, tileZ } from './world.js';
import { SETTLEMENTS, BUILD_ORDER, DECOR_ORDER, GOODS } from './data.js';
import { initAudio, sfx, setSound, ambient, rainSound, setMusic } from './audio.js';
import { Life } from './life.js';

const SAVE_KEY = 'isaiart.villages.v1';
const SET_KEY = 'isaiart.villages.settings';
const NEED_ICON = { sawmill: 'wood', windmill: 'wheat', bakery: 'flour', mason: 'stone' };
const STATUS_ICON = { 'Saving wood for builders': 'hammer', 'Saving stone for builders': 'hammer', 'Storage full': 'bag', 'No trees within reach': 'axe', 'No boulders nearby': 'pick', 'Nothing to sell': 'coin', 'Waiting for berries': 'basket' };
const SACK = { wood: 0x9a6a3e, stone: 0xa9adb0, food: 0xd8304a, grain: 0xe6c35c };
const ANIM_TOOL = { chop: 'axe', mine: 'pick', hammer: 'hammer', saw: 'hammer', hoe: 'hoe', fish: 'rod', gather: 'basket', plant: 'sapling' };
const JOB_TOOL = { woodcutter: 'axe', miner: 'pick', fisher: 'rod', forager: 'basket', farmer: 'hoe', forester: 'sapling', mason: 'hammer', sawyer: 'hammer' };

const tick = () => new Promise(r => requestAnimationFrame(() => r()));
const lerp = (a, b, t) => a + (b - a) * t;

class Game {
  constructor() {
    this.settings = { sound: true, music: true, quality: matchMedia('(pointer: coarse)').matches ? 'medium' : 'high' };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch { /* defaults */ }
    this.bvis = new Map(); this.vvis = new Map();
    this.tilesDirty = new Set();
    this.stumpList = [];
    this.keys = new Set();
    this.selected = null; this.followV = null;
    this.place = null;
    this.thumbs = {};
    this.effects = [];
    this.halos = [];
    this.screenSprites = new Set();
    this.cbars = new Map();
  }

  async init() {
    const bar = document.getElementById('loadbar');
    const step = async p => { bar.style.width = p + '%'; await tick(); };
    await step(15);
    let save = null;
    try { save = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { save = null; }
    try { this.sim = new Sim(save); } catch (err) { console.warn('Save failed to load, starting fresh', err); this.sim = new Sim(null); }
    await step(40);
    this.view = new View(document.getElementById('c'), this.sim.world, this.settings.quality);
    await step(65);
    this.makeThumbs();
    await step(80);
    for (const b of this.sim.s.buildings) this.addBVis(b);
    for (const v of this.sim.s.villagers) this.addVVis(v);
    this.makeLockMarkers();
    this.life = new Life(this.view, this.sim);
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthTest: false }));
    this.selRing.renderOrder = 10; this.selRing.visible = false;
    this.view.scene.add(this.selRing);
    this.ui = new UI(this);
    this.hookEvents();
    this.bindInput();
    setSound(this.settings.sound);
    this.frameSettlement('meadow', true);
    await step(100);
    document.getElementById('loading').classList.add('gone');
    setTimeout(() => document.getElementById('loading').remove(), 700);
    if (!save && this.sim.s.tutorial >= 99) setTimeout(() => this.ui.toast('Welcome to Meadowbrook! Open Build to begin.', 'house', true), 900);
    this.last = performance.now();
    this.saveTimer = 0;
    this.loop();
    addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
  }

  // ── thumbnails for the build tray ──
  makeThumbs() {
    const W = 160, H = 140;
    let r;
    try { r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); }
    catch { return; }
    r.setSize(W, H); r.setPixelRatio(1);
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xfff6e2, 0x7a9a5a, 2.2));
    const d = new THREE.DirectionalLight(0xfff0d0, 2.4); d.position.set(4, 6, 5); sc.add(d);
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
    const shoot = (obj, key) => {
      sc.add(obj);
      const box = new THREE.Box3().setFromObject(obj), sph = box.getBoundingSphere(new THREE.Sphere());
      const dir = new THREE.Vector3(1, 0.95, 1.5).normalize();
      cam.position.copy(sph.center).addScaledVector(dir, sph.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 0.92);
      cam.lookAt(sph.center);
      r.render(sc, cam);
      this.thumbs[key] = r.domElement.toDataURL();
      sc.remove(obj);
    };
    for (const t of [...BUILD_ORDER, ...DECOR_ORDER, 'campfire']) {
      const { group, anim } = buildModel(t, defOf(t).size);
      anim.smoke?.update(0.4);
      shoot(group, t);
    }
    const clear = new THREE.Group();
    const vm = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const tree = new THREE.Mesh(pineGeo(), vm); tree.position.x = -0.25; clear.add(tree);
    const st = new THREE.Mesh(stumpGeo(), vm); st.position.set(0.45, 0, 0.3); st.scale.setScalar(1.6); clear.add(st);
    shoot(clear, 'clear');
    const pave = new THREE.Group();
    pave.add(at3(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 2.2), mat(0x7cbf4f)), 0, -0.03, 0));
    for (let i = 0; i < 9; i++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.28 + (i % 3) * 0.04, 0.3, 0.08, 7), mat([0xd8cdb4, 0xc9bda3, 0xe2d8c2][i % 3])); st.position.set(-0.7 + (i % 3) * 0.7, 0.03, -0.7 + ((i / 3) | 0) * 0.7); st.rotation.y = i; pave.add(st); }
    shoot(pave, 'pave');
    r.dispose(); r.forceContextLoss?.();
  }

  // ── building visuals ──
  baseY(b) {
    const [w, d] = footprint(b.type, b.rot), W = this.sim.world;
    let sum = 0, n = 0, mx = -9;
    for (let z = b.tz; z < b.tz + d; z++) for (let x = b.tx; x < b.tx + w; x++) { const h = W.tileHeight(x, z); sum += h; n++; mx = Math.max(mx, h); }
    return b.type === 'dock' ? Math.max(mx, 0.05) : sum / n;
  }
  addBVis(b) {
    const def = defOf(b.type);
    const { group, anim } = buildModel(b.type, def.size);
    const root = new THREE.Group(); root.add(group);
    const c = this.sim.bCenter(b);
    root.position.set(c.x, this.baseY(b), c.z);
    group.rotation.y = b.rot * Math.PI / 2;
    root.userData.ent = { kind: 'b', b };
    const top = new THREE.Box3().setFromObject(group).max.y - root.position.y;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture('hammer'), transparent: true, depthWrite: false, sizeAttenuation: false }));
    sp.userData.px = 38; sp.position.y = Math.max(1.4, top + 0.55); sp.visible = false; sp.renderOrder = 5;
    root.add(sp);
    const vis = { b, root, group, anim, sprite: sp, icon: null, scaffold: null, phase: Math.random() * 6, pop: 0 };
    this.addHalos(group);
    if (b.type === 'campfire') {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(3.2, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xff9a40, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      pool.position.y = 0.08; pool.renderOrder = 2; root.add(pool); this.halos.push({ m: pool, k: 0.55 });
    }
    this.view.objects.add(root);
    this.bvis.set(b.id, vis);
    this.screenSprites.add(sp);
    this.applyBuild(vis);
    if (b.type === 'farm') this.applyFarm(vis);
  }
  // warm glow sprites on every window and lantern, faded in at night
  addHalos(group) {
    const win = mat(C.window, { emissive: 0x3a2a00 }), lamp = mat(0xffe08a);
    group.traverse(o => {
      if (!o.isMesh || (o.material !== win && o.material !== lamp)) return;
      const big = o.material === lamp;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: big ? 0xffc46a : 0xffa848, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.scale.setScalar(big ? 1.6 : 0.9); sp.position.copy(o.position); sp.renderOrder = 3;
      o.parent.add(sp); this.halos.push({ m: sp, k: big ? 0.9 : 0.7 });
    });
  }
  applyBuild(vis) {
    const b = vis.b;
    this.applyLevel(vis);
    if (b.built && b.up) {
      if (!vis.scaffold) { vis.scaffold = scaffold(footprint(b.type, 0)); vis.scaffold.scale.set(1.12, 1.25, 1.12); vis.group.add(vis.scaffold); }
      return;
    }
    if (!b.built) {
      if (!vis.scaffold) {
        vis.scaffold = scaffold(footprint(b.type, 0));
        const [w, d] = footprint(b.type, 0);
        vis.scaffold.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.1, d * 0.9), mat(0xb08a5a)), { receiveShadow: true }));
        vis.group.add(vis.scaffold);
      }
      vis.anim.inner.visible = b.progress > 0.03;
      vis.anim.inner.scale.y = 0.1 + 0.9 * b.progress;
      if (vis.anim.smoke) vis.anim.smoke.on = false;
    } else {
      if (vis.scaffold) { vis.group.remove(vis.scaffold); vis.scaffold = null; vis.pop = 1; }
      vis.anim.inner.visible = true; vis.anim.inner.scale.y = 1;
      if (vis.anim.smoke) vis.anim.smoke.on = true;
    }
  }
  // upgraded buildings get a little flag, flower boxes and lanterns
  applyLevel(vis) {
    const L = lvlOf(vis.b);
    if (vis.lvl === L) return;
    vis.lvl = L;
    if (vis.deco) { vis.group.remove(vis.deco); const gone = new Set(); vis.deco.traverse(o => gone.add(o)); this.halos = this.halos.filter(h => !gone.has(h.m)); }
    vis.deco = null;
    if (L < 2 || isDecor(vis.b.type)) return;
    const [w, d] = footprint(vis.b.type, 0), g = new THREE.Group();
    const px = w / 2 - 0.15, pz = -d / 2 + 0.15;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 2.1, 6), mat(0x6b4428)); pole.position.set(px, 1.05, pz); pole.castShadow = true; g.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.02), mat(L === 2 ? 0x4f8fd9 : 0xf0b429)); flag.position.set(px + 0.22, 1.9, pz); flag.castShadow = true; g.add(flag);
    vis.flag = flag;
    for (const sx of [-1, 1]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.12), mat(0x8a5a33)); box.position.set(sx * 0.4, 0.08, d / 2 + 0.08); g.add(box);
      for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(leafGeo, mat([0xf06292, 0xffd54f, 0xba68c8][(k + (sx > 0 ? 1 : 0)) % 3])); f.position.set(sx * 0.4 - 0.11 + k * 0.11, 0.18, d / 2 + 0.08); g.add(f); }
    }
    if (L >= 3) for (const sx of [-1, 1]) {
      const lp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.04), mat(0x3c3c3c)); lp.position.set(sx * (w / 2 - 0.05), 0.3, d / 2 + 0.2); g.add(lp);
      const lg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), mat(0xffe08a)); lg.position.set(sx * (w / 2 - 0.05), 0.64, d / 2 + 0.2); g.add(lg);
    }
    vis.group.add(g); vis.deco = g; this.addHalos(g);
    vis.group.scale.setScalar(1 + (L - 1) * 0.04);
  }
  applyFarm(vis) {
    const d = vis.b.data, crops = vis.anim.crops;
    if (!crops) return;
    const s = d.stage === 'empty' ? 0.001 : d.stage === 'ripe' ? 1 : 0.15 + d.grow * 0.75;
    const m = mat(d.stage === 'ripe' ? 0xe8c14a : d.grow > 0.7 ? 0xb5c84a : C.leaf);
    for (const c of crops.children) { c.scale.set(1, s, 1); c.position.y = 0.1 + 0.2 * s; c.material = m; }
  }
  removeBVis(b) {
    const vis = this.bvis.get(b.id);
    if (!vis) return;
    this.view.objects.remove(vis.root);
    this.bvis.delete(b.id);
    this.screenSprites.delete(vis.sprite);
    const gone = new Set(); vis.root.traverse(o => gone.add(o)); this.halos = this.halos.filter(h => !gone.has(h.m));
    if (this.selected?.b === b) this.select(null);
  }
  bubbleFor(b) {
    if (!b.built) return null;
    const def = defOf(b.type);
    if (b.type === 'farm' && b.data.stage === 'ripe') return 'wheat';
    if (def.workers && !b.workers.length) return 'person';
    if (b.status) return b.status.startsWith('Needs') ? NEED_ICON[b.type] || 'alert' : STATUS_ICON[b.status] || 'alert';
    return null;
  }
  updateBVis(vis, dt, time) {
    const b = vis.b, a = vis.anim;
    const icon = this.bubbleFor(b);
    if (icon !== vis.icon) {
      vis.icon = icon;
      vis.sprite.visible = !!icon;
      if (icon) vis.sprite.material.map = bubbleTexture(icon), vis.sprite.material.needsUpdate = true;
    }
    if (icon) {
      vis.sprite.position.y += Math.sin(time * 3 + vis.phase) * 0.003;
      const p = this.view.project(vis.sprite.getWorldPosition(tmpV));
      vis.sprite.visible = !this.hudHit(p.x, p.y);
    }
    if (vis.pop > 0) {
      vis.pop = Math.max(0, vis.pop - dt * 2.5);
      const base = 1 + (lvlOf(b) - 1) * 0.04, k = base * (1 + Math.sin(vis.pop * Math.PI) * 0.12);
      vis.group.scale.set(k, base * (1 + Math.sin(vis.pop * Math.PI * 2) * 0.08), k);
    }
    if (!b.built) return;
    const busy = b.workers.length > 0 && !b.status;
    if (a.blades) a.blades.rotation.z += dt * (busy ? 1.6 : 0.25);
    if (a.blade && busy) a.blade.rotation.y += dt * 12;
    if (a.smoke) a.smoke.update(dt);
    if (a.fire) {
      const f = 0.9 + Math.sin(time * 13 + vis.phase) * 0.08 + Math.sin(time * 7.3) * 0.06;
      a.fire.scale.set(f, f * (1 + Math.sin(time * 9) * 0.1), f);
      a.light.intensity = (1 + Math.sin(time * 11) * 0.18) * (0.25 + this.night * 5); a.light.distance = 5 + this.night * 5;
    }
    if (vis.flag) vis.flag.rotation.y = Math.sin(time * 3 + vis.phase) * 0.35;
    if (a.boat) a.boat.position.y = -0.15 + Math.sin(time * 1.6 + vis.phase) * 0.03;
  }

  // ── villager visuals ──
  addVVis(v) {
    const m = villagerModel(v);
    m.group.userData.ent = { kind: 'v', v };
    m.group.position.set(v.x, this.sim.world.heightAt(v.x, v.z), v.z);
    m.phase = Math.random() * 6; m.rot = v.face || 0; m.walk = 0;
    this.view.objects.add(m.group);
    this.vvis.set(v.id, m);
  }
  updateVVis(v, m, dt, time) {
    const W = this.sim.world;
    let y = W.heightAt(v.x, v.z);
    if (W.type[idx(Math.max(0, Math.min(N - 1, Math.floor(v.x + HALF))), Math.max(0, Math.min(N - 1, Math.floor(v.z + HALF))))] === 1) y = Math.max(y, 0.12);
    m.group.position.set(v.x, y, v.z);
    let d = v.face - m.rot; d = Math.atan2(Math.sin(d), Math.cos(d));
    m.rot += d * Math.min(1, dt * 10);
    m.group.rotation.y = m.rot;
    const anim = v.act?.anim;
    setTool(m, anim ? ANIM_TOOL[anim] ?? null : v.carry ? null : JOB_TOOL[v.job] ?? null);
    const mood = v.hungry ? 'apple' : (this.night > 0.7 && anim === 'rest') ? 'zzz' : null;
    if (mood !== m.mood) {
      m.mood = mood;
      if (mood && !m.bubble) { m.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, sizeAttenuation: false })); m.bubble.userData.px = 26; m.bubble.position.y = 1.0; m.group.add(m.bubble); this.screenSprites.add(m.bubble); }
      if (m.bubble) { m.bubble.visible = !!mood; if (mood) { m.bubble.material.map = bubbleTexture(mood); m.bubble.material.needsUpdate = true; } }
    }
    if (m.bubble?.visible) m.bubble.position.y = 0.95 + Math.sin(time * 3 + m.phase) * 0.03;
    m.sack.visible = !!v.carry;
    if (v.carry) m.sack.material = mat(SACK[v.carry.res] ?? 0xc9a46a);
    m.body.rotation.x = 0; m.body.position.y = 0;
    m.armL.rotation.set(0, 0, 0); m.armR.rotation.set(0, 0, 0);
    m.hipL.rotation.x = 0; m.hipR.rotation.x = 0;
    const sp = this.sim.s.speed || 0;
    if (v.moving) {
      m.walk += dt * 11 * Math.max(1, sp * 0.8);
      const s = Math.sin(m.walk);
      m.hipL.rotation.x = s * 0.7; m.hipR.rotation.x = -s * 0.7;
      m.armL.rotation.x = -s * 0.5; m.armR.rotation.x = v.carry ? -0.4 : s * 0.5;
      m.body.position.y = Math.abs(Math.cos(m.walk)) * 0.03;
    } else if (anim) {
      const t = time * Math.max(1, sp) + m.phase;
      if (anim === 'chop' || anim === 'mine' || anim === 'hammer') {
        const k = Math.sin(t * 7);
        m.armR.rotation.x = -1.6 - k * 0.9; m.armL.rotation.x = -1.2 - k * 0.6;
        m.body.rotation.x = 0.1 + k * 0.08;
        if (k > 0.97 && !m.hit) { m.hit = true; this.nearSound(v, anim === 'mine' ? 'mine' : 'chop'); } else if (k < 0) m.hit = false;
      } else if (anim === 'gather' || anim === 'plant' || anim === 'hoe') {
        m.body.rotation.x = 0.45 + Math.sin(t * 4) * 0.12; m.armR.rotation.x = -0.9 + Math.sin(t * 4) * 0.4; m.armL.rotation.x = -0.7;
      } else if (anim === 'fish') {
        m.armR.rotation.x = -1.0 + Math.sin(t * 1.3) * 0.05; m.armL.rotation.x = -0.6;
      } else if (anim === 'saw' || anim === 'work') {
        const k = Math.sin(t * 6);
        m.armR.rotation.x = -1.1 + k * 0.35; m.armL.rotation.x = -1.1 - k * 0.35; m.body.rotation.x = 0.12;
      } else if (anim === 'sell') {
        m.armR.rotation.z = 2.4 + Math.sin(t * 6) * 0.35;
      } else {
        m.body.position.y = Math.sin(t * 2) * 0.006;
        m.armL.rotation.z = -0.08; m.armR.rotation.z = 0.08;
      }
    }
  }
  // is a screen point under a piece of the bottom HUD?
  hudHit(x, y) {
    if (!this.hudRects || performance.now() - this.hudT > 500) {
      this.hudT = performance.now();
      this.hudRects = ['#dockbar', '#tray', '#world', '#shop', '#placebar', '#topright', '#info'].map(q => document.querySelector(q))
        .filter(el => el && el.offsetParent !== null && !el.classList.contains('hidden')).map(el => el.getBoundingClientRect());
    }
    return this.hudRects.some(r => x > r.left - 20 && x < r.right + 20 && y > r.top - 40 && y < r.bottom);
  }
  nearSound(v, name) {
    const r = this.view.rig;
    if (Math.hypot(v.x - r.tx, v.z - r.tz) < 10 && r.dist < 30 && Math.random() < 0.6) sfx[name]();
  }

  // the travelling merchant's cart
  makeCart() {
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    body.add(at3(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 1.3), mat(C.plank)), 0, 0.45, 0, true));
    const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.3, 10, 1, true, -Math.PI / 2, Math.PI), mat(0x9b6bd1));
    canopy.rotation.x = Math.PI / 2; canopy.rotation.z = Math.PI / 2; canopy.rotation.y = 0; canopy.position.set(0, 0.62, 0);
    canopy.material.side = THREE.DoubleSide; canopy.castShadow = true; body.add(canopy);
    this.cartWheels = [];
    for (const [x, z] of [[-0.48, 0.35], [0.48, 0.35], [-0.48, -0.35], [0.48, -0.35]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), mat(C.darkwood)); w.rotation.z = Math.PI / 2; w.position.set(x, 0.2, z); body.add(w); this.cartWheels.push(w);
    }
    for (const [x, c] of [[-0.2, C.berry], [0.1, C.yellow], [0.25, 0x5ab0e0]]) body.add(at3(new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), mat(c)), x, 0.72, -0.3));
    for (const x of [-0.25, 0.25]) body.add(at3(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.8), mat(C.timber)), x, 0.4, 1.0));
    const vm = villagerModel({ shirt: 0x7a4aa8, skin: 0xe8b590, hair: 0x6b4226, hat: true, hatColor: 0x4a2f6b });
    vm.group.position.set(0, 0, 1.45); g.add(vm.group); this.cartMan = vm;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture('shop'), transparent: true, depthWrite: false }));
    sp.scale.set(0.7, 0.82, 1); sp.position.y = 1.7; g.add(sp); this.cartBubble = sp;
    g.userData.ent = { kind: 'merchant' };
    g.visible = false;
    this.view.objects.add(g);
    this.cart = g;
  }
  updateCart(dt, time) {
    const m = this.sim.s.merchant;
    if (!this.cart) this.makeCart();
    const on = m && m.state !== 'away';
    this.cart.visible = !!on;
    if (!on) return;
    const y = this.sim.world.heightAt(m.x, m.z);
    this.cart.position.set(m.x, Math.max(y, 0.12), m.z);
    let d = (m.face ?? 0) - this.cart.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.cart.rotation.y += d * Math.min(1, dt * 5);
    const moving = m.state !== 'here';
    this.cartBubble.visible = !moving;
    if (moving) { for (const w of this.cartWheels) w.rotation.x += dt * 6 * Math.max(1, this.sim.s.speed); const k = Math.sin(time * 10) * 0.6; this.cartMan.hipL.rotation.x = k; this.cartMan.hipR.rotation.x = -k; this.cartMan.armR.rotation.x = -0.9; this.cartMan.armL.rotation.x = -0.9; }
    else { this.cartMan.hipL.rotation.x = this.cartMan.hipR.rotation.x = 0; this.cartMan.armR.rotation.z = 2.4 + Math.sin(time * 5) * 0.3; this.cartBubble.position.y = 1.7 + Math.sin(time * 3) * 0.04; }
  }

  makeLockMarkers() {
    if (this.locks) for (const l of this.locks) this.view.objects.remove(l);
    this.locks = [];
    for (const st of SETTLEMENTS) {
      if (this.sim.s.unlocked[st.id]) continue;
      const c = CENTERS[st.id];
      const { group } = buildModel('sign', [1, 1]);
      const root = new THREE.Group(); root.add(group);
      root.position.set(toWorld(c.x), this.sim.world.heightAt(toWorld(c.x), toWorld(c.z)), toWorld(c.z));
      root.scale.setScalar(1.5);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture('lock'), transparent: true, depthWrite: false }));
      sp.scale.set(0.6, 0.7, 1); sp.position.y = 1.35; root.add(sp);
      root.userData.ent = { kind: 'lock', sid: st.id };
      this.view.objects.add(root); this.locks.push(root);
    }
  }

  // ── events from the sim ──
  hookEvents() {
    const sim = this.sim, ui = this.ui, view = this.view;
    sim.on('res', () => { ui.dirty.res = true; });
    sim.on('xp', () => { ui.dirty.res = true; });
    sim.on('building', b => {
      const vis = this.bvis.get(b.id);
      if (!vis) this.addBVis(b); else { this.applyBuild(vis); if (b.type === 'farm') this.applyFarm(vis); }
      if (this.place) this.drawTerritory();
    });
    sim.on('removed', b => this.removeBVis(b));
    sim.on('moved', b => { this.removeBVis(b); this.addBVis(b); });
    sim.on('upgraded', b => { const vis = this.bvis.get(b.id); if (vis) vis.pop = 1; });
    sim.on('progress', b => { const vis = this.bvis.get(b.id); if (vis) this.applyBuild(vis); });
    sim.on('farm', b => { const vis = this.bvis.get(b.id); if (vis) this.applyFarm(vis); });
    sim.on('villager', v => this.addVVis(v));
    sim.on('tree', ti => view.updateTree(ti));
    sim.on('treeNew', ti => view.placeTree(ti));
    sim.on('stump', (x, z) => {
      sim.s.stats.felled = (sim.s.stats.felled || 0) + 1;
      const slot = view.addStump(x, z);
      if (slot >= 0) this.stumpList.push({ slot, t: sim.s.time + 140 });
    });
    sim.on('felled', ti => this.fellEffect(sim.world.trees[ti]));
    sim.on('rock', k => view.updateRock(k));
    sim.on('bush', k => view.updateBush(k));
    sim.on('tile', i => this.tilesDirty.add(i));
    sim.on('float', (x, z, text, icon) => {
      const r = view.rig;
      if (Math.hypot(x - r.tx, z - r.tz) > 26 + r.dist * 0.3) return;
      const p = view.project(new THREE.Vector3(x, sim.world.heightAt(x, z) + 1.1, z));
      if (p.vis) ui.float(p.x, p.y, text, icon);
    });
    sim.on('toast', (msg, icon) => ui.toast(msg, icon));
    sim.on('levelup', (lvl, unlocked, gems) => {
      sfx.level();
      ui.toast(`Level ${lvl}! +${gems} gems`, 'star', true);
      if (unlocked.length) setTimeout(() => ui.toast('Unlocked: ' + unlocked.join(', '), 'hammer'), 700);
      if (ui.tray) ui.refreshCards();
    });
    sim.on('log', () => ui.markLog());
    sim.on('sfx', name => sfx[name]?.());
    sim.on('merchant', st => { if (st === 'here') sfx.coin(); });
    sim.on('settlements', () => { this.makeLockMarkers(); this.life?.placeButterflies(); });
  }

  // ── little effects: falling trees and leaf puffs ──
  fellEffect(t) {
    const r = this.view.rig;
    if (Math.hypot(t.x - r.tx, t.z - r.tz) > 30 + r.dist * 0.4) return;
    const geo = t.kind ? this.view.roundG : this.view.pineG;
    const m = new THREE.Mesh(geo, fallMat()); m.castShadow = true;
    const s = t.s;
    m.scale.set(s, s * (0.9 + t.tint * 0.3), s); m.rotation.y = t.rot;
    const pivot = new THREE.Group(); pivot.add(m);
    pivot.position.set(t.x, this.sim.world.heightAt(t.x, t.z), t.z);
    pivot.rotation.y = Math.random() * Math.PI * 2;
    this.view.fx.add(pivot);
    let age = 0, landed = false;
    this.effects.push(dt => {
      age += dt;
      const f = Math.min(1, age / 0.9);
      pivot.rotation.x = Math.pow(f, 2.2) * Math.PI / 2 * 0.96;
      if (f >= 1 && !landed) { landed = true; this.puff(pivot, s); }
      if (age > 1.2) { const k = Math.max(0, 1 - (age - 1.2) / 0.5); m.scale.multiplyScalar(k > 0 ? 0.88 : 0); }
      if (age > 1.7) { this.view.fx.remove(pivot); return false; }
      return true;
    });
  }
  puff(pivot, s) {
    const tip = new THREE.Vector3(0, 1.0 * s, 0).applyMatrix4(pivot.matrixWorld);
    const parts = [];
    for (let i = 0; i < 7; i++) {
      const p = new THREE.Mesh(leafGeo, mat(i % 2 ? 0x5fae3f : 0x8cc85a));
      p.position.copy(tip); p.userData.v = new THREE.Vector3((Math.random() - 0.5) * 2.4, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2.4);
      this.view.fx.add(p); parts.push(p);
    }
    let age = 0;
    this.effects.push(dt => {
      age += dt;
      for (const p of parts) { p.userData.v.y -= dt * 5; p.position.addScaledVector(p.userData.v, dt); p.scale.setScalar(Math.max(0.01, 1 - age / 0.7)); p.rotation.x += dt * 6; }
      if (age > 0.7) { for (const p of parts) this.view.fx.remove(p); return false; }
      return true;
    });
  }

  // progress bars floating over construction sites
  drawBars() {
    const view = this.view, seen = new Set();
    for (const b of this.sim.s.buildings) {
      if ((b.built && !b.up) || isDecor(b.type)) continue;
      const vis = this.bvis.get(b.id); if (!vis) continue;
      seen.add(b.id);
      let el = this.cbars.get(b.id);
      if (!el) {
        el = document.createElement('div'); el.className = 'cbar';
        el.innerHTML = this.ui.hammer + '<div class="t"><i></i></div><small></small>';
        document.getElementById('bars').appendChild(el); this.cbars.set(b.id, el);
      }
      const p = view.project(tmpV.set(vis.root.position.x, vis.root.position.y + 1.7, vis.root.position.z));
      el.style.display = p.vis ? '' : 'none';
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
      const pct = Math.floor((b.up ? b.up.progress : b.progress) * 100) + '%';
      if (el.lastChild.textContent !== pct) { el.lastChild.textContent = pct; el.querySelector('i').style.width = pct; }
    }
    for (const [id, el] of this.cbars) if (!seen.has(id)) { el.remove(); this.cbars.delete(id); }
  }

  // dashed ring showing how far a gatherer will walk for work
  rangeFor(type) { return { lumber: RANGE.woodcutter, forager: RANGE.forager, quarry: RANGE.miner, forester: RANGE.forester }[type] || 0; }
  showRange(type, x, z) {
    const r = this.rangeFor(type);
    if (!r) { if (this.rangeRing) this.rangeRing.visible = false; return; }
    if (!this.rangeRing || this.rangeRing.userData.r !== r || this.rangeRing.userData.x !== x || this.rangeRing.userData.z !== z) {
      if (this.rangeRing) this.view.scene.remove(this.rangeRing);
      const segs = Math.round(r * 2.4), pos = [], W = this.sim.world;
      for (let i = 0; i < segs; i++) {
        const a0 = i / segs * Math.PI * 2, a1 = (i + 0.55) / segs * Math.PI * 2;
        for (const [a, w] of [[a0, -0.17], [a0, 0.17], [a1, -0.17], [a1, 0.17]]) {
          const px = x + Math.cos(a) * (r + w), pz = z + Math.sin(a) * (r + w);
          pos.push(px, Math.max(W.heightAt(px, pz), -0.1) + 0.18, pz);
        }
      }
      const idxs = []; for (let i = 0; i < segs; i++) { const o = i * 4; idxs.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idxs);
      const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
      ring.renderOrder = 8;
      ring.userData = { r, x, z };
      // a dark outline band underneath so the dashes read on grass and trees
      const ob = [];
      for (let i = 0; i <= 96; i++) for (const w of [-0.26, 0.26]) {
        const a = i / 96 * Math.PI * 2, px = x + Math.cos(a) * (r + w), pz = z + Math.sin(a) * (r + w);
        ob.push(px, Math.max(W.heightAt(px, pz), -0.1) + 0.16, pz);
      }
      const oi = []; for (let i = 0; i < 96; i++) { const o = i * 2; oi.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
      const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.Float32BufferAttribute(ob, 3)); og.setIndex(oi);
      const outline = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ color: 0x3b2410, transparent: true, opacity: 0.45, depthTest: false, side: THREE.DoubleSide }));
      outline.renderOrder = 7; ring.add(outline);
      const rig = this.view.rig, lx = x - Math.sin(rig.yaw) * r, lz = z - Math.cos(rig.yaw) * r;
      const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex('Work range'), transparent: true, depthTest: false }));
      lab.scale.set(5.6, 1.4, 1); lab.position.set(lx, Math.max(W.heightAt(lx, lz), 0) + 0.9, lz); lab.renderOrder = 11;
      ring.add(lab); ring.userData.label = lab;
      this.rangeRing = ring; this.view.scene.add(ring);
    }
    this.rangeRing.visible = true;
  }

  // keep the ring's label on a part of the ring that's actually on screen
  placeRangeLabel() {
    const ring = this.rangeRing, lab = ring.userData.label; if (!lab) return;
    const { r, x, z } = ring.userData, W = this.sim.world, rect = this.view.canvas.getBoundingClientRect();
    const sheet = document.querySelector('#info:not(.hidden)')?.getBoundingClientRect();
    const top = rect.top + (innerWidth < 760 ? 330 * 0.5 + 20 : 80), bottom = (sheet && innerWidth < 760 ? sheet.top : rect.bottom - 110) - 30;
    let best = null, bd = 1e9;
    const cx = rect.left + rect.width / 2, cy = (top + bottom) / 2;
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const p = this.view.project(tmpV.set(px, Math.max(W.heightAt(px, pz), 0) + 0.9, pz));
      if (!p.vis || p.x < rect.left + 60 || p.x > rect.right - 60 || p.y < top || p.y > bottom) continue;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bd) { bd = d; best = [px, pz]; }
    }
    lab.visible = !!best;
    if (best) lab.position.set(best[0], Math.max(W.heightAt(best[0], best[1]), 0) + 0.9, best[1]);
  }

  // ── placement ──
  startPlace(type, moving = null) {
    this.cancelPlace(true);
    this.select(null);
    const p = this.place = { type, rot: moving ? moving.rot : 0, tx: 0, tz: 0, ok: false, why: '', moving };
    if (moving) { const vis = this.bvis.get(moving.id); if (vis) vis.root.visible = false; }
    if (!PAINT[type]) {
      const { group, anim } = buildModel(type, defOf(type).size);
      anim.smoke?.update(0.3);
      group.traverse(o => { if (o.isMesh) { o.userData.base = o.material; o.material = ghostMat(o.material, true); o.castShadow = false; } });
      const root = new THREE.Group(); root.add(group);
      p.ghost = root; p.model = group;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7dff6a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      plane.renderOrder = 1; p.plane = plane;
      this.view.scene.add(root, plane);
    }
    this.drawTerritory();
    document.body.classList.add('placing');
    if (moving) {
      const c = this.sim.bCenter(moving), sp = this.view.project(new THREE.Vector3(c.x, 0.2, c.z));
      this.ghostAt(sp.x, sp.y);
    } else {
      const r = this.view.canvas.getBoundingClientRect();
      this.ghostAt(r.left + r.width / 2, r.top + r.height * 0.45);
      if (p.ghost && !p.ok) this.snapToFree();
    }
    sfx.click();
  }
  ghostAt(cx, cy) {
    const p = this.place; if (!p) return;
    const g = this.view.groundAt(cx, cy);
    if (PAINT[p.type]) { p.cursor = g; this.placeMsg(); return; }
    let [w, d] = footprint(p.type, p.rot);
    p.tx = Math.round(g.x + HALF - w / 2); p.tz = Math.round(g.z + HALF - d / 2);
    if (p.type === 'dock') { p.rot = this.sim.bestDockRot(p.tx, p.tz); [w, d] = footprint(p.type, p.rot); }
    this.refreshGhost();
  }
  refreshGhost() {
    const p = this.place; if (!p || !p.ghost) return;
    const chk = this.sim.checkPlace(p.type, p.tx, p.tz, p.rot, p.moving ? p.moving.id : -1);
    p.ok = chk.ok; p.why = chk.why || '';
    const [w, d] = footprint(p.type, p.rot);
    const cx = toWorld(p.tx) + (w - 1) / 2, cz = toWorld(p.tz) + (d - 1) / 2;
    const fake = { type: p.type, tx: p.tx, tz: p.tz, rot: p.rot };
    let y = 0.1;
    try { if (inMap(p.tx, p.tz) && inMap(p.tx + w - 1, p.tz + d - 1)) y = this.baseY(fake); } catch { /* off map */ }
    p.ghost.position.set(cx, y, cz);
    p.model.rotation.y = p.rot * Math.PI / 2;
    p.plane.position.set(cx, y + 0.06, cz); p.plane.scale.set(w, 1, d);
    p.plane.material.color.setHex(p.ok ? 0x7dff6a : 0xff5a4a);
    if (p.okShown !== p.ok) { p.okShown = p.ok; p.model.traverse(o => { if (o.isMesh && o.userData.base) o.material = ghostMat(o.userData.base, p.ok); }); }
    if (!p.edge) {
      // a thick coloured rim just outside the footprint
      p.edge = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({ color: 0x5fd94a, transparent: true, opacity: 0.95, depthTest: false });
      for (let k = 0; k < 4; k++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 1), m); bar.renderOrder = 10; p.edge.add(bar); }
      p.edge.userData.m = m; this.view.scene.add(p.edge);
    }
    const t = 0.13, [b0, b1, b2, b3] = p.edge.children;
    b0.scale.set(w + t * 2, 1, t); b0.position.set(0, 0, -d / 2 - t / 2);
    b1.scale.set(w + t * 2, 1, t); b1.position.set(0, 0, d / 2 + t / 2);
    b2.scale.set(t, 1, d); b2.position.set(-w / 2 - t / 2, 0, 0);
    b3.scale.set(t, 1, d); b3.position.set(w / 2 + t / 2, 0, 0);
    p.edge.position.copy(p.plane.position);
    p.edge.userData.m.color.setHex(p.ok ? 0x5fd94a : 0xf0564a);
    this.showRange(p.type, cx, cz);
    this.placeMsg();
  }
  placeMsg() {
    const p = this.place; if (!p) return;
    const touch = this.lastPointer !== 'mouse';
    const title = PAINT[p.type] ? PAINT[p.type] : (p.moving ? 'Move ' : '') + defOf(p.type).name;
    if (p.type === 'clear') this.ui.placeBar(true, touch ? 'Tap or drag over trees to mark them' : 'Click or drag over trees · right-drag to pan', false, false, title);
    else if (p.type === 'pave') this.ui.placeBar(true, (touch ? 'Tap or drag to lay stones' : 'Click or drag to lay stones · right-drag to pan') + ' · 1 stone each, tap again to lift', false, false, title);
    else if (p.ok) this.ui.placeBar(true, touch ? 'Tap a spot, then ✓' : 'Click to build · R rotates', false, touch, title);
    else this.ui.placeBar(true, p.why, true, touch, title);
  }
  // spiral out from the ghost to the closest spot where it fits
  snapToFree() {
    const p = this.place, x0 = p.tx, z0 = p.tz;
    for (let r = 1; r < 14; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const tx = x0 + dx, tz = z0 + dz;
      const rot = p.type === 'dock' ? this.sim.bestDockRot(tx, tz) : p.rot;
      const c = this.sim.checkPlace(p.type, tx, tz, rot);
      if (c.ok || c.why === 'Not enough resources' || c.why?.startsWith('Needs level')) { p.tx = tx; p.tz = tz; p.rot = rot; this.refreshGhost(); return; }
    }
  }
  rotatePlace() {
    const p = this.place; if (!p || PAINT[p.type] || p.type === 'dock') return;
    p.rot = (p.rot + 1) % 4;
    // keep the footprint centred where it was when rotating a non-square building
    this.refreshGhost(); sfx.click();
  }
  confirmPlace() {
    const p = this.place; if (!p || PAINT[p.type]) return;
    if (!p.ok) { sfx.error(); this.ui.toast(p.why, 'alert'); return; }
    if (p.moving) {
      const b = p.moving, r = this.sim.move(b, p.tx, p.tz, p.rot);
      if (!r.ok) { sfx.error(); return; }
      p.moving = null; this.cancelPlace();
      this.select({ kind: 'b', b });
      return;
    }
    const res = this.sim.place(p.type, p.tx, p.tz, p.rot);
    if (!res.ok) { sfx.error(); return; }
    if (isDecor(p.type) && this.sim.canAfford(defOf(p.type).cost)) { this.refreshGhost(); return; }
    this.cancelPlace();
    this.ui.markCard(null);
  }
  cancelPlace(silent) {
    const p = this.place; if (!p) return;
    if (p.ghost) this.view.scene.remove(p.ghost, p.plane);
    if (p.edge) this.view.scene.remove(p.edge);
    if (p.moving) { const vis = this.bvis.get(p.moving.id); if (vis) vis.root.visible = true; }
    this.place = null;
    if (this.terr) { this.view.scene.remove(this.terr); this.terr = null; }
    if (this.rangeRing) this.rangeRing.visible = false;
    this.ui?.placeBar(false);
    document.body.classList.remove('placing');
    if (!silent) this.ui?.markCard(null);
  }
  drawTerritory() {
    if (this.terr) this.view.scene.remove(this.terr);
    const g = this.terr = new THREE.Group();
    for (const sid of Object.keys(this.sim.s.unlocked)) {
      const c = CENTERS[sid], r = this.sim.settlementRadius(sid), pts = [];
      for (let i = 0; i <= 120; i++) {
        const a = i / 120 * Math.PI * 2, x = toWorld(c.x) - 0.5 + Math.cos(a) * r, z = toWorld(c.z) - 0.5 + Math.sin(a) * r;
        pts.push(new THREE.Vector3(x, Math.max(this.sim.world.heightAt(x, z), -0.1) + 0.12, z));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.85 }));
      line.computeLineDistances();
      g.add(line);
    }
    this.view.scene.add(g);
  }
  paint(cx, cy, first) {
    if (this.place?.type === 'pave') return this.paintPave(cx, cy, first);
    return this.paintClear(cx, cy, first);
  }
  paintPave(cx, cy, first) {
    const p = this.view.groundAt(cx, cy), tx = Math.floor(p.x + HALF), tz = Math.floor(p.z + HALF);
    if (!inMap(tx, tz)) return;
    const i = idx(tx, tz), W = this.sim.world;
    if (first) this.paintMode = !W.paved[i];
    const r = this.sim.pave(i, this.paintMode);
    if (r === 'stone' && !this.noStoneWarned) { this.noStoneWarned = true; this.ui.toast('You need stone to lay paths', 'stone'); sfx.error(); setTimeout(() => this.noStoneWarned = false, 3000); }
    else if (r === true) sfx.chop();
  }
  paintClear(cx, cy, first) {
    const W = this.sim.world, p = this.view.groundAt(cx, cy);
    const tx = Math.floor(p.x + HALF), tz = Math.floor(p.z + HALF);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, z = tz + dz;
      if (!inMap(x, z)) continue;
      const ti = W.tree[idx(x, z)];
      if (ti < 0) continue;
      const t = W.trees[ti];
      if (Math.hypot(t.x - p.x, t.z - p.z) > 1.3) continue;
      if (first && this.paintMode === undefined) this.paintMode = !t.marked;
      if (t.marked !== this.paintMode) { this.sim.markTree(ti, this.paintMode); if (this.paintMode) sfx.pop(); }
    }
  }

  // ── selection ──
  select(ent, fly) {
    this.selected = ent && ent.kind !== 'lock' && ent.kind !== 'merchant' ? ent : null;
    if (ent?.kind === 'lock') { this.ui.openModal('worldmap'); return; }
    if (ent?.kind === 'merchant') { this.ui.openModal('merchant'); return; }
    if (!ent || ent.kind !== 'v') this.followV = null;
    if (ent) sfx.click();
    this.ui.lastInfo = null;
    this.ui.drawInfo(true);
    if (this.rangeRing) this.rangeRing.visible = false;
    if (ent?.kind === 'b') {
      const c = this.sim.bCenter(ent.b);
      this.showRange(ent.b.type, c.x, c.z);
      this.selRing.scale.setScalar(Math.max(c.w, c.d) * 0.78);
      this.selRing.position.set(c.x, this.bvis.get(ent.b.id).root.position.y + 0.05, c.z);
      if (fly || innerWidth < 760) this.focus(c.x, c.z, this.rangeFor(ent.b.type) ? Math.max(this.view.rig.dist, this.rangeFor(ent.b.type) * 2.3) : undefined);
    } else if (ent?.kind === 'v') {
      this.selRing.scale.setScalar(0.35);
      if (fly || innerWidth < 760) this.focus(ent.v.x, ent.v.z);
    }
    this.selRing.visible = !!this.selected;
  }
  focus(x, z, dist) {
    const rig = this.view.rig, phone = innerWidth < 760;
    // nudge toward the camera so the thing lands in the upper part of the screen
    const k = phone ? (dist || rig.dist) * 0.24 : 0;
    this.view.flyTo(x + Math.sin(rig.yaw) * k, z + Math.cos(rig.yaw) * k, dist, 0.6);
  }
  pick(cx, cy) {
    // villagers are tiny, so test them in screen space first
    let best = null, bd = 26;
    for (const v of this.sim.s.villagers) {
      const p = this.view.project(new THREE.Vector3(v.x, this.sim.world.heightAt(v.x, v.z) + 0.35, v.z));
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (p.vis && d < bd) { bd = d; best = { kind: 'v', v }; }
    }
    if (best) return best;
    const hits = this.view.raycast(cx, cy, this.view.objects.children);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.ent) o = o.parent;
      if (o) return o.userData.ent;
    }
    return null;
  }
  // centre the camera on a settlement's buildings, leaving room for the HUD
  frameSettlement(sid, instant = false) {
    const c = CENTERS[sid], rig = this.view.rig;
    let x0 = toWorld(c.x) - 3, x1 = toWorld(c.x) + 3, z0 = toWorld(c.z) - 3, z1 = toWorld(c.z) + 3;
    for (const b of this.sim.s.buildings) {
      if (b.sid !== sid) continue;
      const p = this.sim.bCenter(b);
      x0 = Math.min(x0, p.x - 1); x1 = Math.max(x1, p.x + 1); z0 = Math.min(z0, p.z - 1); z1 = Math.max(z1, p.z + 1);
    }
    const phone = innerWidth < 760, cam = this.view.camera;
    // measure the actual buildings along the camera's right and forward axes
    const rx = Math.cos(rig.yaw), rz = -Math.sin(rig.yaw), fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw);
    let a0 = 1e9, a1 = -1e9, c0 = 1e9, c1 = -1e9;
    let pts = [[toWorld(c.x), toWorld(c.z), 2]];
    for (const b of this.sim.s.buildings) if (b.sid === sid) { const p = this.sim.bCenter(b); pts.push([p.x, p.z, Math.max(p.w, p.d) / 2]); }
    if (innerWidth < 760 && pts.length > 6) {
      // phones frame the cosy core around the plaza; outlying fields can sit off-screen
      const cx0 = toWorld(c.x), cz0 = toWorld(c.z);
      pts.sort((p, q) => Math.hypot(p[0] - cx0, p[1] - cz0) - Math.hypot(q[0] - cx0, q[1] - cz0));
      pts = pts.slice(0, Math.ceil(pts.length * 0.7));
    }
    for (const [x, z, e] of pts) {
      const a = x * rx + z * rz, f = x * fx + z * fz;
      a0 = Math.min(a0, a - e); a1 = Math.max(a1, a + e); c0 = Math.min(c0, f - e); c1 = Math.max(c1, f + e);
    }
    const w = a1 - a0, h = c1 - c0;
    const vt = Math.tan(cam.fov * Math.PI / 360), ht = vt * (innerWidth / innerHeight);
    // usable fraction of the screen once the HUD is taken out
    const useW = phone ? 1.0 : 0.72, useH = phone ? 0.7 : 0.7;
    // ground depth is stretched by the camera's tilt (~1.25x at our pitch)
    const fitW = (w / 2 + 1.5) / (ht * useW), fitH = (h / 2 + 1.5) / (vt * 1.25 * useH);
    const dist = Math.max(phone ? 22 : 20, Math.min(phone ? 40 : 62, Math.max(fitW, fitH)));
    const k = phone ? dist * 0.05 : 0, side = phone ? dist * 0.03 : 0;
    const tx = (x0 + x1) / 2 - Math.sin(rig.yaw) * k + Math.cos(rig.yaw) * side, tz = (z0 + z1) / 2 - Math.cos(rig.yaw) * k - Math.sin(rig.yaw) * side;
    if (instant) Object.assign(rig, { tx, tz, dist });
    else this.view.flyTo(tx, tz, dist, 1.4);
  }
  flyToSettlement(sid) { this.frameSettlement(sid); }

  // ── input ──
  bindInput() {
    const cv = this.view.canvas, view = this.view, rig = view.rig;
    const ptrs = new Map();
    let drag = null, pinch = null;
    const anchor = new THREE.Vector3(), tmp = new THREE.Vector3();
    cv.addEventListener('contextmenu', e => e.preventDefault());
    const wake = () => { initAudio(); setMusic(this.settings.music); };
    addEventListener('pointerdown', wake, { once: true });
    addEventListener('keydown', wake, { once: true });
    cv.addEventListener('pointerdown', e => {
      initAudio();
      cv.setPointerCapture(e.pointerId);
      this.lastPointer = e.pointerType;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      view.fly = null; this.followV = null;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), dist: rig.dist, yaw: rig.yaw, moved: true };
        view.groundAt((a.x + b.x) / 2, (a.y + b.y) / 2, anchor);
        drag = null;
        return;
      }
      const clearing = PAINT[this.place?.type] && e.button === 0;
      if (clearing) { this.paintMode = undefined; this.paint(e.clientX, e.clientY, true); drag = { mode: 'paint' }; return; }
      if (e.button === 2 || e.button === 1) drag = { mode: 'rot', x: e.clientX, y: e.clientY };
      else { drag = { mode: 'pan', last: performance.now() }; view.groundAt(e.clientX, e.clientY, anchor); }
      rig.vx = rig.vz = 0;
    });
    cv.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse' && this.place) { this.lastPointer = 'mouse'; this.ghostAt(e.clientX, e.clientY); }
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      if (pinch && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        rig.dist = pinch.dist * pinch.d / Math.max(20, d);
        rig.yaw = pinch.yaw + (ang - pinch.ang);
        view.updateCamera(0);
        view.groundAt((a.x + b.x) / 2, (a.y + b.y) / 2, tmp);
        rig.tx += anchor.x - tmp.x; rig.tz += anchor.z - tmp.z;
        view.updateCamera(0);
        return;
      }
      if (!drag) return;
      if (drag.mode === 'paint') { this.paint(e.clientX, e.clientY, false); return; }
      if (drag.mode === 'rot') {
        rig.yaw -= (e.clientX - drag.x) * 0.006; rig.pitch += (e.clientY - drag.y) * 0.004;
        drag.x = e.clientX; drag.y = e.clientY; return;
      }
      if (Math.hypot(p.x - p.sx, p.y - p.sy) < 4) return;
      view.groundAt(e.clientX, e.clientY, tmp);
      const dx = anchor.x - tmp.x, dz = anchor.z - tmp.z;
      rig.tx += dx; rig.tz += dz;
      const now = performance.now(), dtm = Math.max(8, now - drag.last) / 1000;
      rig.vx = lerp(rig.vx, dx / dtm, 0.5); rig.vz = lerp(rig.vz, dz / dtm, 0.5); drag.last = now;
      view.updateCamera(0);
      if (this.place && e.pointerType === 'mouse') this.ghostAt(e.clientX, e.clientY);
    });
    const up = e => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      ptrs.delete(e.pointerId);
      const wasPinch = !!pinch;
      if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 1 && wasPinch) {
        const [o] = [...ptrs.values()];
        drag = { mode: 'pan', last: performance.now() }; view.groundAt(o.x, o.y, anchor); rig.vx = rig.vz = 0;
        o.sx = -999; // never a tap
        return;
      }
      if (drag?.mode === 'pan' && performance.now() - drag.last > 80) rig.vx = rig.vz = 0;
      const tap = !wasPinch && Math.hypot(p.x - p.sx, p.y - p.sy) < 8 && performance.now() - p.t < 500 && drag?.mode !== 'rot';
      drag = null;
      if (tap && e.type === 'pointerup') this.tap(e.clientX, e.clientY, e.pointerType);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      view.fly = null;
      view.groundAt(e.clientX, e.clientY, anchor);
      rig.dist *= Math.pow(1.0015, e.deltaY * (e.deltaMode ? 30 : 1));
      view.updateCamera(0);
      view.groundAt(e.clientX, e.clientY, tmp);
      rig.tx += anchor.x - tmp.x; rig.tz += anchor.z - tmp.z;
    }, { passive: false });
    addEventListener('keydown', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'escape') {
        if (this.ui.modal) this.ui.closeModal();
        else if (this.place) { this.cancelPlace(); }
        else if (this.selected) this.select(null);
        else if (this.ui.tray) this.ui.closeTray();
      }
      if (k === 'r') this.rotatePlace();
      if (k === ' ') { e.preventDefault(); this.setSpeed(this.sim.s.speed ? 0 : (this.prevSpeed || 1)); }
      if (k === '1' || k === '2' || k === '3') this.setSpeed(+k);
      if (k === 'b') this.ui.tray === 'build' ? this.ui.closeTray() : this.ui.openTray('build');
    });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }
  tap(cx, cy, type) {
    initAudio();
    const p = this.place;
    if (p && !PAINT[p.type]) {
      this.ghostAt(cx, cy);
      if (type === 'mouse') this.confirmPlace();
      return;
    }
    if (p) return;
    this.select(this.pick(cx, cy));
  }
  setSpeed(n) { if (this.sim.s.speed) this.prevSpeed = this.sim.s.speed; this.sim.s.speed = n; }
  setSetting(k, v) {
    this.settings[k] = v;
    localStorage.setItem(SET_KEY, JSON.stringify(this.settings));
    if (k === 'sound') setSound(v);
    if (k === 'music') setMusic(v);
  }

  save() {
    if (this.resetting) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.sim.serialize())); } catch (err) { console.warn('save failed', err); }
  }
  reset() {
    this.resetting = true;
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }

  // ── main loop ──
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const sim = this.sim, view = this.view, rig = view.rig;
    for (const v of sim.s.villagers) v.moving = false;
    const simDt = dt * sim.s.speed;
    let left = simDt;
    while (left > 1e-4) { const st = Math.min(0.1, left); sim.tick(st); left -= st; }
    timeUniform.value = now / 1000;

    // keyboard camera
    const k = this.keys, pan = rig.dist * 0.9 * dt;
    const fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw);
    if (k.has('w') || k.has('arrowup')) { rig.tx += fx * pan; rig.tz += fz * pan; view.fly = null; }
    if (k.has('s') || k.has('arrowdown')) { rig.tx -= fx * pan; rig.tz -= fz * pan; view.fly = null; }
    if (k.has('a') || k.has('arrowleft')) { rig.tx += fz * pan; rig.tz -= fx * pan; view.fly = null; }
    if (k.has('d') || k.has('arrowright')) { rig.tx -= fz * pan; rig.tz += fx * pan; view.fly = null; }
    if (k.has('q')) rig.yaw -= dt * 1.4;
    if (k.has('e')) rig.yaw += dt * 1.4;
    if (k.has('=') || k.has('+')) rig.dist *= 1 - dt;
    if (k.has('-')) rig.dist *= 1 + dt;
    if (this.followV) { rig.tx = lerp(rig.tx, this.followV.x, Math.min(1, dt * 4)); rig.tz = lerp(rig.tz, this.followV.z, Math.min(1, dt * 4)); }

    this.dayLight(sim.s.time);
    this.weather(dt);
    view.updateCamera(dt);
    view.adapt(dt);

    if (this.tilesDirty.size) { for (const i of this.tilesDirty) { view.paintTile(i, false); view.updateGrass(i); view.updatePave(i); } view.terrainColor.needsUpdate = true; this.tilesDirty.clear(); }
    while (this.stumpList.length && this.stumpList[0].t < sim.s.time) view.removeStump(this.stumpList.shift().slot);

    const t = now / 1000;
    for (const vis of this.bvis.values()) this.updateBVis(vis, dt, t);
    for (const v of sim.s.villagers) { const m = this.vvis.get(v.id); if (m) this.updateVVis(v, m, dt, t); }
    this.effects = this.effects.filter(f => f(dt));
    // bubbles keep a constant on-screen size (px tall) however far you zoom
    const cam = view.camera, pxK = Math.tan(cam.fov * Math.PI / 360) / (view.canvas.clientHeight / 2);
    for (const sp of this.screenSprites) { const h = sp.userData.px * pxK; sp.scale.set(h * 0.857, h, 1); }
    this.life.update(dt, t, this.night, this.rainK || 0);
    this.updateCart(dt, t);
    this.drawBars();

    // selection ring + name tag
    const tag = document.getElementById('tag');
    if (this.selected?.kind === 'v') {
      const v = this.selected.v;
      this.selRing.position.set(v.x, sim.world.heightAt(v.x, v.z) + 0.05, v.z);
      const p = view.project(new THREE.Vector3(v.x, sim.world.heightAt(v.x, v.z) + 0.95, v.z));
      tag.classList.toggle('hidden', !p.vis); tag.textContent = v.name.split(' ')[0];
      tag.style.left = p.x + 'px'; tag.style.top = p.y + 'px';
    } else tag.classList.add('hidden');
    if (this.place?.model) this.place.model.position.y = 0.08 + Math.sin(t * 4) * 0.06;
    if (this.rangeRing?.visible) { this.rangeRing.material.opacity = 0.75 + Math.sin(t * 3) * 0.2; this.placeRangeLabel(); }
    if (this.selRing.visible) this.selRing.material.opacity = 0.65 + Math.sin(t * 4) * 0.25;

    ambient(dt * (this.night > 0.5 ? 0.2 : 1));
    this.ui.frame(dt);
    view.render();
    this.saveTimer += dt;
    if (this.saveTimer > 20) { this.saveTimer = 0; this.save(); }
  }

  // rain particles that follow the camera, plus a rainbow once it clears
  weather(dt) {
    const wx = this.sim.s.weather || {}, view = this.view, rig = view.rig;
    this.rainK = lerp(this.rainK || 0, wx.rain ? 1 : 0, Math.min(1, dt * 0.6));
    if (this.rainK > 0.01) {
      if (!this.rain) {
        const n = 1400, pos = new Float32Array(n * 6);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.5, depthWrite: false }));
        this.rain.frustumCulled = false; this.rainDrops = Array.from({ length: n }, () => [Math.random() * 44 - 22, Math.random() * 16, Math.random() * 36 - 18]);
        view.scene.add(this.rain);
      }
      const pos = this.rain.geometry.attributes.position.array, fall = dt * 14;
      this.rainDrops.forEach((d, i) => {
        d[1] -= fall; if (d[1] < 0) { d[1] += 16; d[0] = Math.random() * 44 - 22; d[2] = Math.random() * 36 - 18; }
        const x = rig.tx + d[0], z = rig.tz + d[2], y = d[1];
        pos.set([x, y, z, x - 0.05, y + 0.45, z - 0.03], i * 6);
      });
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity = 0.45 * this.rainK;
      this.rain.visible = true;
    } else if (this.rain) this.rain.visible = false;
    rainSound(this.rainK);
    // rainbow (a soft screen-space arc; the camera looks too steeply down for a 3D one)
    const show = (wx.rainbow || 0) > 0 && this.night < 0.4;
    if (show !== this.rainbowOn) { this.rainbowOn = show; document.getElementById('rainbow').classList.toggle('on', show); }
  }

  dayLight(time) {
    const f = (time % DAY) / DAY;                 // 0 = midnight
    const sunUp = Math.max(0, Math.sin((f - 0.22) / 0.56 * Math.PI));
    const light = f > 0.22 && f < 0.78 ? sunUp : 0;
    const night = this.night = 1 - Math.min(1, light * 2.2);
    document.body.classList.toggle('night', night > 0.6);
    const v = this.view, rk = this.rainK || 0;
    // the sun by day, a cool moon by night
    v.sun.intensity = (0.35 + 2.2 * light) * (1 - rk * 0.55);
    v.sun.color.setRGB(lerp(0.62, 1, 1 - night), lerp(0.7, lerp(0.72, 0.95, Math.min(1, light * 1.6)), 1 - night), lerp(1, lerp(0.55, 0.85, Math.min(1, light * 1.6)), 1 - night));
    v.hemi.intensity = lerp(0.55, 1.6, 1 - night);
    v.hemi.color.setRGB(lerp(0.42, 1, 1 - night), lerp(0.5, 0.97, 1 - night), lerp(0.95, 0.88, 1 - night));
    v.hemi.groundColor.setRGB(lerp(0.12, 0.36, 1 - night), lerp(0.14, 0.54, 1 - night), lerp(0.26, 0.23, 1 - night));
    const sky = new THREE.Color(0x9cd3c0).lerp(new THREE.Color(0x8396a3), rk * 0.7).lerp(new THREE.Color(0x1b2847), night * 0.92);
    v.scene.background.copy(sky); v.scene.fog.color.copy(sky);
    v.water.material.color.setRGB(lerp(0.33, 0.12, night), lerp(0.75, 0.27, night), lerp(0.91, 0.5, night));
    const glow = mat(C.window, { emissive: 0x3a2a00 });
    glow.emissive.setRGB(0.23 + night * 0.85, 0.16 + night * 0.5, night * 0.1);
    mat(0xffe08a).emissive.setRGB(night * 1, night * 0.78, night * 0.3);
    const ho = night * night;
    for (const h of this.halos) { h.m.material.opacity = ho * h.k; h.m.visible = ho > 0.02; }
  }
}

const tmpV = new THREE.Vector3();
const at3 = (m, x, y, z, shadow = false) => { m.position.set(x, y, z); m.castShadow = shadow; return m; };
const PAINT = { clear: 'Clear Trees', pave: 'Stone Path' };
const leafGeo = new THREE.IcosahedronGeometry(0.09, 0);
let _fall = null;
const fallMat = () => _fall || (_fall = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));

const _labels = new Map();
function labelTex(text) {
  if (_labels.has(text)) return _labels.get(text);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff8e8'; g.strokeStyle = '#8a5a2b'; g.lineWidth = 5;
  g.beginPath(); g.roundRect(6, 6, 244, 52, 26); g.fill(); g.stroke();
  g.fillStyle = '#5b3a1e'; g.font = '600 28px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  _labels.set(text, t); return t;
}
let _glow = null;
function glowTex() {
  if (_glow) return _glow;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(cv);
  return _glow;
}

const ghostCache = new Map();
function ghostMat(m, ok) {
  const key = m.uuid + ok;
  if (!ghostCache.has(key)) {
    const g = m.clone(); g.transparent = true; g.opacity = ok ? 0.94 : 0.8; g.depthWrite = true;
    if (!ok && g.emissive) g.emissive.setHex(0x5a0e0a);
    ghostCache.set(key, g);
  }
  return ghostCache.get(key);
}

const game = new Game();
window.villages = game;
game.init().catch(err => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.querySelector('p').textContent = 'Something went wrong loading the village: ' + err.message;
});
