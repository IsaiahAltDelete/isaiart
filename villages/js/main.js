// Entry point: wires the simulation, the 3D view, the UI and input.
import * as THREE from '../vendor/three.module.min.js';
import { Sim, defOf, isDecor, footprint, DAY, lvlOf, RANGE } from './sim.js';
import { BEASTS } from './data.js';
import { View, bubbleTexture, timeUniform, iceUniform } from './view.js';
import { loadModels, hasModel, instanceModel } from './blender.js';
import { Highlight } from './select.js';
import { buildModel, scaffold, villagerModel, dressVillager, propModel, slotMaterial, VILLAGER_MATS, SNOWCAP_MAT, setTool, mat, C, pineGeo, stumpGeo, beastModel, chestModel, bunting } from './models.js';
import { snowUniform } from './snow.js';
import { UI } from './ui.js';
import { N, HALF, idx, toWorld, inMap, CENTERS, tileX, tileZ } from './world.js';
import { SETTLEMENTS, BUILD_ORDER, DECOR_ORDER, GOODS, SEASON_DAYS, DECOR } from './data.js';
import { initAudio, sfx, setSound, ambient, rainSound, setMusic, setMood } from './audio.js';
import { Life } from './life.js';
import { hookRpg, rpgFrame } from './rpgview.js';
import './props.js';                                   // trade post, cart, ferry and festive decor models
import { Extras } from './extras.js';
import { paintRoad, paintCobble } from './roads.js';

const SAVE_KEY = 'isaiart.villages.v1';
const SET_KEY = 'isaiart.villages.settings';
const NEED_ICON = { sawmill: 'wood', windmill: 'wheat', bakery: 'flour', mason: 'stone' };
const STATUS_ICON = { 'Saving wood for builders': 'hammer', 'Saving stone for builders': 'hammer', 'Storage full': 'bag', 'No trees within reach': 'axe', 'No boulders nearby': 'pick', 'Nothing to sell': 'coin', 'Waiting for berries': 'basket' };
const SACK = { wood: 0x9a6a3e, stone: 0xa9adb0, food: 0xd8304a, grain: 0xe6c35c };
const ANIM_TOOL = { cast: 'staff', chop: 'axe', mine: 'pick', hammer: 'hammer', saw: 'hammer', hoe: 'hoe', fish: 'rod', gather: 'basket', plant: 'sapling' };
const JOB_TOOL = { guard: 'spear', wizard: 'staff', shepherd: 'hoe', picker: 'basket', milker: 'basket', herder: 'basket', woodcutter: 'axe', miner: 'pick', fisher: 'rod', forager: 'basket', farmer: 'hoe', forester: 'sapling', mason: 'hammer', sawyer: 'hammer' };

// yield a frame so the loading bar paints; a timer keeps loading going in a background tab
const tick = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 60); });
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
    this.beasts = new Map();
    this.screenSprites = new Set();
    this.cbars = new Map();
    this.chests = new Map();
    this.fest = null; this.si = 0;
  }

  async init() {
    const bar = document.getElementById('loadbar');
    const step = async p => { bar.style.width = p + '%'; await tick(); };
    await step(15);
    let save = null;
    try { save = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { save = null; }
    try { this.sim = new Sim(save); } catch (err) { console.warn('Save failed to load, starting fresh', err); this.sim = new Sim(null); }
    await step(40);
    await loadModels();             // the forest and buildings are built from these
    await step(55);
    this.view = new View(document.getElementById('c'), this.sim.world, this.settings.quality);
    await step(65);
    this.makeThumbs();
    await step(80);
    for (const b of this.sim.s.buildings) this.addBVis(b);
    for (const v of this.sim.s.villagers) this.addVVis(v);
    for (const ch of this.sim.s.chests) this.addChest(ch);
    for (const ic of ['hammer', 'wheat', 'person', 'wood', 'flour', 'stone', 'bag', 'axe', 'pick', 'coin', 'basket', 'alert', 'apple', 'zzz', 'lock', 'shop', 'gift']) bubbleTexture(ic);
    this.updateSeason();
    this.makeLockMarkers();
    this.life = new Life(this.view, this.sim);
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthTest: false }));
    this.selRing.renderOrder = 10; this.selRing.visible = false;
    this.view.scene.add(this.selRing);
    this.hl = new Highlight(this);
    this.ui = new UI(this);
    this.extras = new Extras(this);                    // carts, ferry, bridges, chest arrows, share codes…
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
    const variant = b.type === 'cottage' || b.type === 'tiled';
    const { group, anim } = buildModel(b.type, def.size, variant ? b.id : 0, lvlOf(b));
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
    const blended = [];
    group.traverse(o => { if (o.userData.halo) blended.push(o); });
    for (const o of blended) {
      const big = o.userData.halo === 'lamp';
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: big ? 0xffc46a : 0xffa848, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.scale.setScalar(big ? 1.3 : 0.8); sp.position.copy(o.position); sp.renderOrder = 3;
      o.parent.add(sp); this.halos.push({ m: sp, k: big ? 0.9 : 0.6 });
    }
    group.traverse(o => {
      if (!o.isMesh || o.userData.slot || (o.material !== win && o.material !== lamp)) return;
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
    const crop = d.crop || 'wheat';
    const s = d.stage === 'empty' ? 0.001 : d.stage === 'ripe' ? 1 : 0.15 + d.grow * 0.75;
    const ripe = d.stage === 'ripe' || d.grow > 0.7;
    const col = crop === 'wheat' ? (d.stage === 'ripe' ? 0xe8c14a : d.grow > 0.7 ? 0xb5c84a : C.leaf)
      : crop === 'veg' ? (ripe ? 0x3f8f35 : 0x6fbf3f) : (ripe ? 0xe58a3a : 0x6fae45);
    if (crops.userData.blend) {
      // modelled plants: show the chosen crop, grow it, ripen its colours
      const kind = crop === 'pumpkins' ? 'pumpkin' : crop;
      const tint = { ear: d.stage === 'ripe' ? 0xe8c14a : d.grow > 0.7 ? 0xc9c45a : 0x8fbf4a, stalk: d.stage === 'ripe' ? 0xc9b04a : 0x8fbf4a,
        pumpkin: ripe ? 0xe58a3a : 0x9fbf4a, head: ripe ? 0x9fd36a : 0x6fbf3f };
      for (const bunch of crops.children) {
        const k = s * bunch.userData.jit;
        bunch.scale.set(Math.max(0.001, 0.55 + k * 0.6), Math.max(0.001, k), Math.max(0.001, 0.55 + k * 0.6));
        bunch.visible = d.stage !== 'empty';
        for (const plant of bunch.children) {
          plant.visible = plant.userData.kind === kind;
          if (plant.visible) plant.traverse(o => { if (o.isMesh && tint[o.userData.slot] !== undefined) o.material = mat(tint[o.userData.slot]); });
        }
      }
      return;
    }
    const m = mat(col);
    for (const c of crops.children) {
      c.material = m;
      if (crop === 'pumpkins') { c.scale.set(ripe ? 2.4 : 1.4, s * 0.4, ripe ? 2.4 : 1.4); c.position.y = 0.1 + 0.05 * s; }
      else if (crop === 'veg') { c.scale.set(1.8, s * 0.6, 1.8); c.position.y = 0.1 + 0.12 * s; }
      else { c.scale.set(1, s, 1); c.position.y = 0.1 + 0.2 * s; }
    }
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
      const rect = this.view.canvas.getBoundingClientRect();
      vis.sprite.visible = !!vis.sprite.material.map?.userData.ready && !this.hudHit(p.x, p.y) && p.x > rect.left + 24 && p.x < rect.right - 24 && p.y > rect.top + 30;
    }
    if (vis.pop > 0) {
      vis.pop = Math.max(0, vis.pop - dt * 2.5);
      const base = 1 + (lvlOf(b) - 1) * 0.04, k = base * (1 + Math.sin(vis.pop * Math.PI) * 0.12);
      vis.group.scale.set(k, base * (1 + Math.sin(vis.pop * Math.PI * 2) * 0.08), k);
    }
    if (!b.built) return;
    const busy = b.workers.length > 0 && !b.status;
    if (a.blades) a.blades.rotation.z += dt * (busy ? 1.6 : 0.25);
    if (a.blade && busy) a.blade.rotation[a.bladeAxis || 'y'] += dt * 12;
    if (a.smoke) a.smoke.update(dt);
    if (a.fire) {
      const big = a.light && this.fest ? 1.9 : 1;    // a roaring festival bonfire
      const f = (0.9 + Math.sin(time * 13 + vis.phase) * 0.08 + Math.sin(time * 7.3) * 0.06) * big;
      a.fire.scale.set(f, f * (1 + Math.sin(time * 9) * 0.1), f);
      if (a.light) { a.light.intensity = (1 + Math.sin(time * 11) * 0.18) * (0.25 + this.night * 5) * (big > 1 ? 1.6 : 1); a.light.distance = (5 + this.night * 5) * (big > 1 ? 1.5 : 1); }
    }
    if (a.jets) for (const j of a.jets) {
      j.t = (j.t + dt * 0.7) % 1;
      const r = 0.06 + j.t * 0.42, y = 1.12 + Math.sin(j.t * Math.PI) * 0.32 - j.t * 0.82;
      j.m.position.set(Math.cos(j.ang) * r, y, Math.sin(j.ang) * r); j.m.visible = this.sim.snowLevel() < 0.6;
    }
    if (a.fairy) for (const m of a.fairy) m.emissive.setRGB(0.1 + this.night * 0.5 + Math.sin(time * 2) * 0.05, 0.3 + this.night * 0.6, 0.4 + this.night * 0.6);
    if (a.motes) for (const mo of a.motes) { const t = time * 0.7 + mo.ph; mo.m.position.set(Math.cos(t) * 0.3, 0.2 + Math.sin(t * 1.9) * 0.1 + 0.1, Math.sin(t) * 0.3); mo.m.visible = this.night > 0.3; }
    if (a.swing) a.swing.rotation.x = Math.sin(time * 1.7 + vis.phase) * 0.45;
    if (a.animals) for (const an of a.animals) {
      an.t -= dt;
      const dx = an.tx - an.m.position.x, dz = an.tz - an.m.position.z, d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const sp = dt * (an.fast ? 0.5 : 0.25);
        an.m.position.x += dx / d * Math.min(sp, d); an.m.position.z += dz / d * Math.min(sp, d);
        an.m.rotation.y = Math.atan2(dx, dz); an.m.position.y = 0.04 + Math.abs(Math.sin(time * (an.fast ? 16 : 8))) * 0.02;
        if (an.m.userData.head) an.m.userData.head.rotation.x = 0;
      } else {
        if (an.m.userData.head) an.m.userData.head.rotation.x = 0.4 + Math.sin(time * (an.fast ? 9 : 2) + an.tx) * 0.3;   // grazing / pecking
        if (an.t <= 0) { an.t = 2 + Math.random() * 5; an.tx = (Math.random() - 0.5) * an.w; an.tz = (Math.random() - 0.5) * an.d; }
      }
    }
    // penned animals keep a body's width apart (no stacked double sheep)
    if (a.animals && a.animals.length > 1) {
      const R = a.animals[0].fast ? 0.2 : 0.42;
      for (let i = 0; i < a.animals.length; i++) for (let j = i + 1; j < a.animals.length; j++) {
        const p = a.animals[i].m.position, q = a.animals[j].m.position;
        let dx = p.x - q.x, dz = p.z - q.z; const d = Math.hypot(dx, dz);
        if (d >= R) continue;
        if (d < 1e-4) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
        const push = (R - d) * 0.5;
        p.x += dx * push; p.z += dz * push; q.x -= dx * push; q.z -= dz * push;
      }
    }
    if (a.bees) for (const bee of a.bees) { const t = time * 2.2 + bee.ph; bee.m.position.set(bee.h[0] + Math.cos(t) * bee.r, 0.55 + Math.sin(t * 2.3) * 0.15, bee.h[1] + Math.sin(t * 1.3) * bee.r); bee.m.visible = this.night < 0.6; }
    if (a.orbs) a.orbs.forEach((o, i) => { const t = time * 0.9 + i * 2.09; o.position.set(Math.cos(t) * 0.95, 3.0 + Math.sin(time * 1.7 + i) * 0.25, Math.sin(t) * 0.95); });
    if (a.flagMesh) a.flagMesh.rotation.y = Math.sin(time * 3 + vis.phase) * 0.35;
    if (a.stones) { const n = Math.min(a.stones.length, this.sim.s.stats.deaths || 0); a.stones.forEach((st, i) => st.visible = i < n); }
    if (vis.flag) vis.flag.rotation.y = Math.sin(time * 3 + vis.phase) * 0.35;
    if (a.boat) a.boat.position.y = -0.15 + Math.sin(time * 1.6 + vis.phase) * 0.03;
  }

  // ── villager visuals ──
  removeVVis(v) { const m = this.vvis.get(v.id); if (m) { this.view.objects.remove(m.group); this.screenSprites.delete(m.bubble); this.vvis.delete(v.id); } }
  screenOf(x, z) { const p = this.view.project(new THREE.Vector3(x, this.sim.world.heightAt(x, z) + 1, z)); return [p.x, p.y]; }

  // ── night beasts ──
  addBeast(b) {
    const m = beastModel(b.kind);
    m.group.position.set(b.x, this.sim.world.heightAt(b.x, b.z), b.z);
    this.view.objects.add(m.group); this.beasts.set(b.id, m);
  }
  updateBeasts(dt, time) {
    for (const b of this.sim.s.beasts) {
      const m = this.beasts.get(b.id); if (!m) { this.addBeast(b); continue; }
      const prev = m.group.position.clone();
      m.group.position.set(b.x, Math.max(this.sim.world.heightAt(b.x, b.z), 0.1), b.z);
      let d = b.face - m.group.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); m.group.rotation.y += d * Math.min(1, dt * 8);
      const moving = prev.distanceTo(m.group.position) > 0.001;
      m.legs.forEach((l, i) => l.rotation.x = moving ? Math.sin(time * 14 + i * Math.PI) * 0.7 : 0);
      m.body.position.y = moving ? Math.abs(Math.sin(time * 14)) * 0.03 : 0;
    }
  }
  arrowEffect(x, z, b) {
    const W = this.sim.world, from = new THREE.Vector3(x, W.heightAt(x, z) + 2.4, z);
    const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4).rotateX(Math.PI / 2), mat(0x5e3b22));
    this.view.fx.add(arrow); let t = 0;
    this.effects.push(dt => {
      t += dt * 2.2;
      const to = new THREE.Vector3(b.x, W.heightAt(b.x, b.z) + 0.3, b.z), p = from.clone().lerp(to, Math.min(1, t));
      p.y += Math.sin(Math.min(1, t) * Math.PI) * 1.2;
      arrow.lookAt(p); arrow.position.copy(p);
      if (t >= 1) { this.view.fx.remove(arrow); return false; }
      return true;
    });
  }
  // a burst of sparkles over every settlement when a spell goes off
  spellEffect(id) {
    sfx.level();
    const color = { harvest: 0xffd54f, rain: 0x7fd8ff, haste: 0x9fff8a, ward: 0xfff2b0, bloom: 0x8ee07a, transmute: 0xc79af2,
      mending: 0xffd27a, guidance: 0xfff2b0, light: 0xfff6c0, cure: 0xff9ecb, goodberry: 0x8ee07a, water: 0x7fd8ff, bless: 0xffe08a, magearmor: 0x9fc8ff,
      faerie: 0xc79af2, spike: 0x9ccf5a, plant: 0xffd54f, fireball: 0xff7a2a, lightning: 0xbfe6ff, fabricate: 0xd8a86a, hallow: 0xfff2b0, weather: 0xbfe6ff }[id] || 0xffffff;
    for (const sid of Object.keys(this.sim.s.unlocked)) {
      const c = CENTERS[sid], x = toWorld(c.x), z = toWorld(c.z), y = this.sim.world.heightAt(x, z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.set(x, y + 0.3, z); this.view.fx.add(ring);
      const sparks = [];
      for (let i = 0; i < 40; i++) { const sp = new THREE.Mesh(leafGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending })); const a = Math.random() * 6.28, r = Math.random() * 9; sp.position.set(x + Math.cos(a) * r, y + 0.2, z + Math.sin(a) * r); sp.userData.v = 1 + Math.random() * 2; this.view.fx.add(sp); sparks.push(sp); }
      let t = 0;
      this.effects.push(dt => {
        t += dt; ring.scale.setScalar(1 + t * 10); ring.material.opacity = Math.max(0, 0.9 - t * 0.6);
        for (const sp of sparks) { sp.position.y += sp.userData.v * dt; sp.material.opacity = Math.max(0, 1 - t / 1.6); sp.rotation.y += dt * 4; }
        if (t > 1.6) { this.view.fx.remove(ring); for (const sp of sparks) this.view.fx.remove(sp); return false; }
        return true;
      });
    }
  }

  addVVis(v) {
    const m = villagerModel(v);
    m.group.userData.ent = { kind: 'v', v };
    m.group.position.set(v.x, this.sim.world.heightAt(v.x, v.z), v.z);
    m.phase = Math.random() * 6; m.rot = v.face || 0; m.walk = 0;
    this.view.objects.add(m.group);
    this.vvis.set(v.id, m);
  }
  // villagers gently push apart so two never stand inside each other
  separate(dt) {
    // the chibi villagers are wide-headed, so keep a full head's width apart
    const vs = this.sim.s.villagers.filter(v => !v.indoors), R = 0.42;
    for (const v of vs) { const m = this.vvis.get(v.id); if (m) { m.px = m.px || 0; m.pz = m.pz || 0; m.fx = 0; m.fz = 0; } }
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i], b = vs[j], ma = this.vvis.get(a.id), mb = this.vvis.get(b.id);
      if (!ma || !mb) continue;
      let dx = (a.x + ma.px) - (b.x + mb.px), dz = (a.z + ma.pz) - (b.z + mb.pz);
      const d = Math.hypot(dx, dz);
      if (d >= R) continue;
      if (d < 1e-4) { dx = Math.cos(a.id); dz = Math.sin(a.id); } else { dx /= d; dz /= d; }
      const push = (R - d) * 0.5;
      ma.fx += dx * push; ma.fz += dz * push; mb.fx -= dx * push; mb.fz -= dz * push;
    }
    const k = Math.min(1, dt * 6);
    for (const v of vs) {
      const m = this.vvis.get(v.id); if (!m) continue;
      m.px += (m.fx * 1.6 - m.px * 0.25) * k; m.pz += (m.fz * 1.6 - m.pz * 0.25) * k;
      const l = Math.hypot(m.px, m.pz); if (l > 0.6) { m.px *= 0.6 / l; m.pz *= 0.6 / l; }
    }
  }
  updateVVis(v, m, dt, time) {
    const W = this.sim.world;
    const vx = v.x + (m.px || 0), vz = v.z + (m.pz || 0);
    let y = W.heightAt(vx, vz);
    if (W.type[idx(Math.max(0, Math.min(N - 1, Math.floor(v.x + HALF))), Math.max(0, Math.min(N - 1, Math.floor(v.z + HALF))))] === 1) y = Math.max(y, 0.12);
    if (v.onTower) y += 2.05;
    m.group.position.set(vx, y, vz);
    m.group.visible = !v.indoors;
    m.wiz.visible = v.job === 'wizard';
    dressVillager(m, v, this.si === 3 && this.sim.snowLevel() > 0.2);
    m.bed.visible = v.asleep === 'fire';
    if (v.asleep === 'fire') { m.body.rotation.set(-Math.PI / 2, 0, 0); m.body.position.set(0, 0.1, -0.25); m.bed.position.set(0, 0.03, 0); }
    let d = v.face - m.rot; d = Math.atan2(Math.sin(d), Math.cos(d));
    m.rot += d * Math.min(1, dt * 10);
    m.group.rotation.y = m.rot;
    const anim = v.act?.anim;
    setTool(m, anim === 'fight' ? (v.gear?.w === 'sword' ? 'sword' : 'spear') : anim ? ANIM_TOOL[anim] ?? null : v.carry ? null : v.job === 'guard' && v.gear?.w ? v.gear.w : JOB_TOOL[v.job] ?? null);
    const mood = v.hungry ? 'apple' : v.chat ? 'heart' : v.asleep === 'fire' && (v.id % 3 === 0) ? 'zzz' : null;
    if (mood !== m.mood) {
      m.mood = mood;
      if (mood && !m.bubble) { m.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, sizeAttenuation: false })); m.bubble.userData.px = 26; m.bubble.position.y = 1.0; m.group.add(m.bubble); this.screenSprites.add(m.bubble); }
      if (m.bubble) { m.bubble.visible = !!mood; if (mood) { m.bubble.material.map = bubbleTexture(mood); m.bubble.material.needsUpdate = true; } }
    }
    if (m.bubble && mood) m.bubble.visible = !!m.bubble.material.map?.userData.ready;
    if (m.bubble?.visible) m.bubble.position.y = 0.95 + Math.sin(time * 3 + m.phase) * 0.03;
    m.sack.visible = !!v.carry;
    if (v.carry) m.sack.material = mat(SACK[v.carry.res] ?? 0xc9a46a);
    if (v.asleep !== 'fire') { m.body.rotation.set(0, 0, 0); m.body.position.set(0, 0, 0); }
    m.armL.rotation.set(0, 0, 0); m.armR.rotation.set(0, 0, 0);
    m.hipL.rotation.x = 0; m.hipR.rotation.x = 0;
    const sp = this.sim.s.speed || 0;
    // children sled about once the snow is deep
    const sled = m.stage === 'child' && v.moving && !v.carry && this.si === 3 && this.sim.snowLevel() > 0.4;
    if (sled && !m.sled) { m.sled = propModel('sled'); if (m.sled) { m.sled.scale.setScalar(1.1); m.group.add(m.sled); } }
    if (m.sled) m.sled.visible = sled;
    if (sled && m.sled) {
      m.walk += dt * 4;
      m.body.position.set(0, 0.07, 0.04); m.body.rotation.x = -0.18;
      m.hipL.rotation.x = m.hipR.rotation.x = -1.35;
      m.armL.rotation.z = -0.9 - Math.sin(m.walk) * 0.3; m.armR.rotation.z = 0.9 + Math.sin(m.walk) * 0.3;
    } else if (v.moving) {
      m.walk += dt * 11 * Math.max(1, sp * 0.8);
      const s = Math.sin(m.walk);
      m.hipL.rotation.x = s * 0.7; m.hipR.rotation.x = -s * 0.7;
      m.armL.rotation.x = -s * 0.5; m.armR.rotation.x = v.carry ? -0.4 : s * 0.5;
      m.body.position.y = Math.abs(Math.cos(m.walk)) * 0.03;
    } else if (anim) {
      const t = time * Math.max(1, sp) + m.phase;
      if (anim === 'chop' || anim === 'mine' || anim === 'hammer' || anim === 'fight') {
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
      } else if (anim === 'play') {
        // a skipping, hopping play: elbows soft and arms out of step (never a stiff T)
        const k = Math.sin(t * 7);
        m.body.position.y = Math.abs(k) * 0.08; m.body.rotation.z = Math.sin(t * 3.5) * 0.12;
        m.armL.rotation.z = -0.3 - k * 0.12; m.armL.rotation.x = -0.75 * k; m.armR.rotation.z = 0.3 - k * 0.12; m.armR.rotation.x = 0.75 * k;   // arms swing low, one forward, one back
        m.hipL.rotation.x = Math.max(0, k) * 0.6; m.hipR.rotation.x = Math.max(0, -k) * 0.6;
      } else if (anim === 'cast') {
        m.armL.rotation.x = -2.6 + Math.sin(t * 3) * 0.2; m.armR.rotation.x = -2.6 - Math.sin(t * 3) * 0.2; m.body.position.y = Math.sin(t * 2) * 0.03;
      } else if (anim === 'dance') {
        const k = Math.sin(t * 7.5);
        m.body.position.y = Math.abs(k) * 0.07;
        m.body.rotation.y = Math.sin(t * 1.9) * 0.55;
        m.armL.rotation.z = -2.5 - k * 0.35; m.armR.rotation.z = 2.5 - k * 0.35;
        m.hipL.rotation.x = Math.max(0, k) * 0.7; m.hipR.rotation.x = Math.max(0, -k) * 0.7;
      } else if (anim === 'sleep') {
        // lying down (bedroll pose set above); breathe gently
        if (v.asleep === 'fire') m.body.position.z = -0.25 + Math.sin(t * 1.2) * 0.005;
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
        // (fixed panels have no offsetParent, so test their size instead)
        .filter(el => el && !el.classList.contains('hidden')).map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    }
    return this.hudRects.some(r => x > r.left - 20 && x < r.right + 20 && y > r.top - 40 && y < r.bottom);
  }
  nearSound(v, name) {
    const r = this.view.rig;
    if (Math.hypot(v.x - r.tx, v.z - r.tz) < 10 && r.dist < 30 && Math.random() < 0.6) sfx[name]();
  }

  // a soft glowing dome over each settlement while the Ward of Light holds
  updateWard() {
    const on = (this.sim.s.wardUntil || 0) > this.sim.s.time;
    if (on && !this.wardMeshes) {
      this.wardMeshes = Object.keys(this.sim.s.unlocked).map(sid => {
        const c = CENTERS[sid], r = this.sim.settlementRadius(sid);
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
        m.position.set(toWorld(c.x), 0, toWorld(c.z)); m.scale.y = 0.45; this.view.fx.add(m); return m;
      });
    }
    if (!on && this.wardMeshes) { for (const m of this.wardMeshes) this.view.fx.remove(m); this.wardMeshes = null; }
    if (this.wardMeshes) for (const m of this.wardMeshes) m.material.opacity = 0.03 + this.night * 0.09;
  }

  // ── gift chests ──
  addChest(ch) {
    const m = chestModel(), root = new THREE.Group(); root.add(m.group);
    root.position.set(ch.x, this.sim.world.heightAt(ch.x, ch.z), ch.z);
    m.group.rotation.y = ch.rot; root.scale.setScalar(1.3);
    root.userData.ent = { kind: 'chest', ch };
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture('gift'), transparent: true, depthWrite: false, sizeAttenuation: false }));
    sp.userData.px = innerWidth < 760 ? 28 : 32; sp.position.y = 0.95; sp.renderOrder = 5; root.add(sp); this.screenSprites.add(sp);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.0, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xffd76a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = 0.06; glow.renderOrder = 2; root.add(glow);
    this.view.objects.add(root);
    this.chests.set(ch.id, { root, lid: m.lid, sp, glow, ch, phase: Math.random() * 6, t: -1 });
  }
  updateChests(dt, time) {
    for (const [id, c] of this.chests) {
      if (c.t < 0) {
        c.sp.position.y = 0.95 + Math.sin(time * 3 + c.phase) * 0.05;
        c.glow.material.opacity = 0.45 + Math.sin(time * 2.4 + c.phase) * 0.2 + this.night * 0.25;
        const p = this.view.project(c.sp.getWorldPosition(tmpV));
        // the bubble only pops up when you're looking nearby; edge arrows cover the rest
        const r = this.view.rig, near = r.dist < 24 && Math.hypot(c.ch.x - r.tx, c.ch.z - r.tz) < r.dist * 0.75;
        c.sp.visible = near && !!c.sp.material.map?.userData.ready && !this.hudHit(p.x, p.y);
        continue;
      }
      c.t += dt;
      c.lid.rotation.x = -Math.min(1, c.t / 0.45) * 1.9;
      c.glow.material.opacity = Math.max(0, 0.9 - c.t * 0.35);
      if (c.t > 2.4) { const k = Math.max(0, 1 - (c.t - 2.4) / 0.5); c.root.scale.setScalar(1.3 * k); }
      if (c.t > 2.9) { this.view.objects.remove(c.root); this.chests.delete(id); }
    }
  }
  openChest(ch) {
    const c = this.chests.get(ch.id); if (!c || c.t >= 0) return;
    const reward = this.sim.openChest(ch.id);
    if (!reward) return;
    c.t = 0; c.root.userData.ent = null; c.sp.visible = false; this.screenSprites.delete(c.sp);
    sfx.chest();
    // a fountain of golden sparkles
    const x = ch.x, z = ch.z, y = this.sim.world.heightAt(x, z) + 0.4, n = 48;
    const pos = new Float32Array(n * 3), cols = new Float32Array(n * 3), vel = [], tint = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sv = 0.6 + Math.random() * 1.4;
      vel.push(new THREE.Vector3(Math.cos(a) * sv, 2.6 + Math.random() * 2.4, Math.sin(a) * sv));
      pos.set([x, y, z], i * 3); tint.setHex([0xffd54f, 0xfff2b0, 0xffffff, 0xf9b8cf][i % 4]); cols.set([tint.r, tint.g, tint.b], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.32, map: glowTex(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false; this.view.fx.add(pts);
    let t = 0;
    this.effects.push(dt => {
      t += dt;
      for (let i = 0; i < n; i++) { const v = vel[i]; v.y -= dt * 5; pos[i * 3] += v.x * dt; pos[i * 3 + 1] = Math.max(y - 0.3, pos[i * 3 + 1] + v.y * dt); pos[i * 3 + 2] += v.z * dt; }
      geo.attributes.position.needsUpdate = true; pts.material.opacity = Math.max(0, 1 - t / 1.5);
      if (t > 1.5) { this.view.fx.remove(pts); geo.dispose(); return false; }
      return true;
    });
    const [sx, sy] = this.screenOf(x, z);
    if (reward.kind === 'rare') {
      this.ui.toast(`A rare treasure: ${reward.name}! Find it in Decorate — place it for free.`, 'gift', true);
      this.ui.float(sx, sy - 20, reward.name, 'gift', 'tag');
    } else {
      this.ui.float(sx, sy - 20, `+${reward.n}`, GOODS[reward.res].icon);
      this.ui.toast(`The chest held ${reward.n} ${GOODS[reward.res].name.toLowerCase()}!`, GOODS[reward.res].icon);
    }
  }

  // ── festivals: garlands round every campfire, fireworks, sky lanterns ──
  updateFestival(dt, time) {
    const sim = this.sim, fest = sim.festivalActive();
    if (this.fest && (!fest || this.fest.fest.id !== fest.id)) {
      for (const g of this.fest.groups) this.view.objects.remove(g.group);
      for (const f of this.fest.floaters) this.view.fx.remove(f.m);
      this.fest = null;
    }
    if (fest && !this.fest) {
      this.fest = { fest, groups: [], t: 0, next: 1.5, floaters: [] };
      for (const b of sim.s.buildings) {
        if (b.type !== 'campfire') continue;
        const W = sim.world, c = sim.bCenter(b);
        // poles only where they won't stand inside a building
        const free = (x, z) => { const tx = Math.floor(c.x + x + HALF), tz = Math.floor(c.z + z + HALF); return inMap(tx, tz) && W.occ[idx(tx, tz)] < 0 && W.type[idx(tx, tz)] !== 1; };
        const { group, anim } = bunting(fest.id, 3.3, 9, free);
        group.position.set(c.x, this.bvis.get(b.id)?.root.position.y ?? 0, c.z);
        this.view.objects.add(group); this.fest.groups.push({ group, anim, x: c.x, z: c.z });
      }
    }
    const F = this.fest; if (!F) return;
    F.t += dt;
    for (const g of F.groups) for (const l of g.anim.lanterns) l.material.emissive.setRGB(0.5 + this.night * 0.6, 0.2 + this.night * 0.3, 0.02);
    const id = F.fest.id, r = this.view.rig;
    if ((F.next -= dt) <= 0 && F.groups.length) {
      const g = F.groups[(Math.random() * F.groups.length) | 0];
      const near = Math.hypot(g.x - r.tx, g.z - r.tz) < 30;
      if (id === 'lantern') { F.next = 0.5 + Math.random() * 0.6; this.skyLantern(g.x, g.z); }
      else if (id === 'harvest' || id === 'bonfire') { F.next = (this.night > 0.3 ? 1.1 : 3) + Math.random() * 1.4; this.firework(g.x, g.z, near); }
      else { F.next = 0.35; }
    }
    F.floaters = F.floaters.filter(f => {
      f.t += dt; f.m.position.y += dt * f.v; f.m.position.x += Math.sin(time * 0.6 + f.ph) * dt * 0.25; f.m.position.z += dt * 0.12;
      const o = f.t < 1 ? f.t : f.t > 14 ? Math.max(0, 1 - (f.t - 14) / 3) : 1;
      f.m.children[0].material.opacity = o; f.m.children[1].material.opacity = o * (0.55 + this.night * 0.45);
      if (f.t > 17) { this.view.fx.remove(f.m); return false; }
      return true;
    });
  }
  skyLantern(x, z) {
    const F = this.fest; if (F.floaters.length > 40) return;
    const g = new THREE.Group(), a = Math.random() * 6.28, rr = 1.5 + Math.random() * 2;
    // a paper lantern (wider at the top) with a warm halo that only shows after dusk
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.24, 8), new THREE.MeshBasicMaterial({ color: 0xffb35a, transparent: true })));
    g.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8), new THREE.MeshBasicMaterial({ color: 0x8a4a1a })), { position: new THREE.Vector3(0, -0.13, 0) }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffa040, transparent: true, opacity: Math.min(1, this.night * 1.4), blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(0.9); g.add(halo);
    g.position.set(x + Math.cos(a) * rr, this.sim.world.heightAt(x, z) + 1.7, z + Math.sin(a) * rr);   // released above head height
    this.view.fx.add(g); F.floaters.push({ m: g, t: 0, v: 0.55 + Math.random() * 0.3, ph: Math.random() * 6 });
  }
  firework(x, z, near) {
    // the camera looks steeply down, so bursts over the camera side of the plaza land mid-screen
    const W = this.sim.world, yaw = this.view.rig.yaw, toCam = Math.random() * 3, side = (Math.random() - 0.5) * 8;
    const ox = x + Math.sin(yaw) * toCam + Math.cos(yaw) * side, oz = z + Math.cos(yaw) * toCam - Math.sin(yaw) * side;
    const y0 = W.heightAt(ox, oz) + 0.6, top = y0 + 3.2 + Math.random() * 1.6;
    const col = new THREE.Color([0xff6b6b, 0xffd54f, 0x7fd8ff, 0xb18cff, 0x9fff8a, 0xffb0e0][(Math.random() * 6) | 0]);
    const rocket = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xfff2b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    rocket.scale.setScalar(0.45); rocket.position.set(ox, y0, oz); this.view.fx.add(rocket);
    if (near) sfx.firework();
    // sparks are glowing points that burst outwards, slow down, droop and fade
    const n = 90, pos = new Float32Array(n * 3), vel = [], cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * 6.28, rr = Math.sqrt(1 - u * u), sv = 2.6 + Math.random() * 0.6;
      vel.push(new THREE.Vector3(rr * Math.cos(th) * sv, u * sv, rr * Math.sin(th) * sv));
      const c = i % 6 ? col : new THREE.Color(0xffffff); cols.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.42, map: glowTex(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false;
    // short streaks behind each spark so a burst reads as a radial shape
    const tpos = new Float32Array(n * 6), tgeo = new THREE.BufferGeometry(); tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    const tcol = new Float32Array(n * 6); for (let i = 0; i < n; i++) { tcol.set(cols.subarray(i * 3, i * 3 + 3), i * 6); tcol.set(cols.subarray(i * 3, i * 3 + 3), i * 6 + 3); }
    tgeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
    const trails = new THREE.LineSegments(tgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    trails.frustumCulled = false;
    let t = 0, burst = false;
    this.effects.push(dt => {
      t += dt;
      if (!burst) {
        rocket.position.y = y0 + (top - y0) * Math.min(1, t / 0.6);
        if (t < 0.6) return true;
        burst = true; this.view.fx.remove(rocket); this.view.fx.add(pts, trails);
        for (let i = 0; i < n; i++) pos.set([ox, top, oz], i * 3);
      }
      const k = t - 0.6, drag = Math.pow(0.22, dt);
      for (let i = 0; i < n; i++) { const v = vel[i]; v.multiplyScalar(drag); v.y -= dt * 1.6; pos[i * 3] += v.x * dt; pos[i * 3 + 1] += v.y * dt; pos[i * 3 + 2] += v.z * dt; }
      for (let i = 0; i < n; i++) { const v = vel[i]; tpos.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], pos[i * 3] - v.x * 0.16, pos[i * 3 + 1] - v.y * 0.16, pos[i * 3 + 2] - v.z * 0.16], i * 6); }
      geo.attributes.position.needsUpdate = true; tgeo.attributes.position.needsUpdate = true;
      pts.material.opacity = Math.max(0, 1 - k / 1.7); pts.material.size = 0.42 + k * 0.08; trails.material.opacity = Math.max(0, 0.9 - k / 1.1);
      if (k > 1.7) { this.view.fx.remove(pts, trails); geo.dispose(); tgeo.dispose(); return false; }
      return true;
    });
  }

  // ── seasons: palettes blend over the first part of each season; snow settles and melts ──
  updateSeason() {
    const sim = this.sim, t = sim.s.time, len = DAY * SEASON_DAYS;
    const si = sim.seasonIdx(), into = (t % len) / DAY;
    let k = t < len ? 1 : Math.min(1, into / 0.35); k = k * k * (3 - 2 * k);
    this.view.setSeason((si + 3) % 4, si, Math.round(k * 16) / 16);
    const snow = sim.snowLevel();
    snowUniform.value = snow;
    iceUniform.value = Math.max(0, Math.min(1, (snow - 0.25) / 0.6));
    this.view.pads.visible = iceUniform.value < 0.5;
    this.si = si;
    SNOWCAP_MAT.visible = snow > 0.42;      // roofs wear their snow pillows once the snow is deep
    this.updateSnowmen(snow);
  }
  // Villagers build snowmen around each campfire once the snow settles; they
  // slump and melt away as it thaws.
  updateSnowmen(snow) {
    const want = this.si === 3 && snow > 0.35;
    this.snowmen ||= [];
    if (want && !this.snowmen.length) {
      const W = this.sim.world;
      for (const b of this.sim.s.buildings) {
        if (b.type !== 'campfire') continue;
        const c = this.sim.bCenter(b);
        let made = 0;
        // only in open snow: the tile and the tiles on the camera's side must be
        // clear, so a snowman never hides behind a cottage
        const open = (tx, tz, n) => { for (let dz = 0; dz <= n; dz++) for (let dx = 0; dx <= n; dx++) {
          if (!inMap(tx + dx, tz + dz)) return false;
          const i = idx(tx + dx, tz + dz);
          if (W.occ[i] >= 0 || W.block[i] || W.type[i] === 1 || W.tree[i] >= 0 || W.rock[i] >= 0) return false;
        } return true; };
        // prefer a roomy spot; in a crowded village settle for any free tile
        for (let k = 0; k < 180 && made < 2; k++) {
          const ang = (b.id * 1.7 + k * 2.39) % (Math.PI * 2), r = 2.4 + (k % 9) * 0.75;
          const x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
          const tx = Math.floor(x + HALF), tz = Math.floor(z + HALF);
          if (!open(tx, tz, k < 90 ? 2 : 0)) continue;
          const sm = propModel('snowman'); if (!sm) return;
          sm.position.set(x, W.heightAt(x, z), z); sm.rotation.y = Math.atan2(c.x - x, c.z - z);
          sm.userData.s = 0; this.view.objects.add(sm); this.snowmen.push(sm); made++;
        }
      }
    }
    const k = Math.max(0, Math.min(1, (snow - 0.35) / 0.25));
    for (const sm of this.snowmen) { sm.scale.set(0.9 * Math.max(0.001, k), 0.9 * Math.max(0.001, k * k), 0.9 * Math.max(0.001, k)); sm.visible = k > 0.01; }
    if (!want && k <= 0.01 && this.snowmen.length) { for (const sm of this.snowmen) this.view.objects.remove(sm); this.snowmen = []; }
  }

  // the travelling merchant's cart
  makeCart() {
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    // the Blender wagon when it's exported; its wheel nodes spin as it rolls
    const wagon = hasModel('cart') && instanceModel('cart', (slot, c, ms) => slotMaterial(slot, c, ms.smooth));
    if (wagon) {
      body.add(wagon.group);
      this.cartWheels = ['wheel0', 'wheel1', 'wheel2', 'wheel3'].map(k => wagon.nodes[k]).filter(Boolean);
      for (const p of wagon.points) if (p.name === 'glow_lamp') p.obj.userData.halo = 'lamp';
      this.addHalos(wagon.group);
    } else {
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
    }
    const vm = villagerModel({ shirt: 0x7a4aa8, skin: 0xe8b590, hair: 0x6b4226, hat: true, hatColor: 0x4a2f6b });
    vm.group.position.set(0, 0, 1.45); g.add(vm.group); this.cartMan = vm;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture('shop'), transparent: true, depthWrite: false }));
    sp.scale.set(0.42, 0.49, 1); sp.position.y = 1.95; g.add(sp); this.cartBubble = sp;   // small, above the cover
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
    else { this.cartMan.hipL.rotation.x = this.cartMan.hipR.rotation.x = 0; this.cartMan.armR.rotation.z = 2.4 + Math.sin(time * 5) * 0.3; this.cartBubble.position.y = 1.95 + Math.sin(time * 3) * 0.04; }
  }

  makeLockMarkers() {
    if (this.locks) for (const l of this.locks) this.view.objects.remove(l);
    this.locks = [];
    for (const st of SETTLEMENTS) {
      if (this.sim.s.unlocked[st.id]) continue;
      const c = CENTERS[st.id];
      if (!c) continue;                       // e.g. Pearl Isle on a map whose lake had no room for it
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
    sim.on('upgraded', b => {
      if (b.type === 'cottage' || b.type === 'tiled') { const sel = this.selected?.b === b; this.removeBVis(b); this.addBVis(b); if (sel) this.select({ kind: 'b', b }); }
      const vis = this.bvis.get(b.id); if (vis) vis.pop = 1;
    });
    sim.on('villagerStage', v => { this.removeVVis(v); this.addVVis(v); });
    sim.on('villagerGone', v => { this.removeVVis(v); if (this.selected?.v === v) this.select(null); if (this.followV === v) this.followV = null; });
    sim.on('beast', b => this.addBeast(b));
    sim.on('beastGone', b => { const m = this.beasts.get(b.id); if (m) { this.view.objects.remove(m.group); this.beasts.delete(b.id); } });
    sim.on('arrow', (x, z, b) => this.arrowEffect(x, z, b));
    sim.on('beastFled', (b, why) => { this.ui.float(...this.screenOf(b.x, b.z), why === 'walls' ? 'Blocked!' : 'Driven off!', 'shield'); sfx.pop(); });
    sim.on('spell', id => this.spellEffect(id));
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
    sim.on('chest', ch => this.addChest(ch));
    sim.on('season', sea => { this.updateSeason(); if (sea.id === 'winter') sfx.snow(); });
    hookRpg(this);                    // damage numbers and spell flashes (rpgview.js)
  }

  // ── little effects: falling trees and leaf puffs ──
  fellEffect(t) {
    const r = this.view.rig;
    if (Math.hypot(t.x - r.tx, t.z - r.tz) > 30 + r.dist * 0.4 || (this.falling || 0) > 10) return;
    this.falling = (this.falling || 0) + 1;
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
      if (age > 1.7) { this.view.fx.remove(pivot); this.falling--; return false; }
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
    // the ghost glides to its tile (see loop); the first placement snaps
    p.target = (p.target || new THREE.Vector3()).set(cx, y, cz);
    if (!p.placed) { p.ghost.position.copy(p.target); p.placed = true; }
    p.model.rotation.y = p.rot * Math.PI / 2;
    p.plane.position.set(cx, y + 0.06, cz); p.plane.scale.set(w, 1, d);
    p.plane.material.color.setHex(p.ok ? 0x7dff6a : 0xff5a4a);
    p.plane.visible = false;                    // per-tile cells (select.js) show what blocks
    this.hl.showCells(p);
    if (p.okShown !== p.ok) { p.okShown = p.ok; p.model.traverse(o => { if (o.isMesh && o.userData.base) o.material = ghostMat(o.userData.base, p.ok); }); }
    if (!p.edge) {
      // a thick coloured rim just outside the footprint
      p.edge = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({ color: 0x5fd94a, transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -4 });
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
    this.drawSynergyLinks(p, cx, y, cz);
    this.placeMsg();
  }
  placeMsg() {
    const p = this.place; if (!p) return;
    const touch = this.lastPointer !== 'mouse';
    const title = PAINT[p.type] ? PAINT[p.type] : (p.moving ? 'Move ' : '') + defOf(p.type).name;
    if (p.type === 'clear') this.ui.placeBar(true, touch ? 'Tap or drag over trees to mark them' : 'Click or drag over trees · right-drag to pan', false, false, title);
    else if (p.type === 'pave') this.ui.placeBar(true, (touch ? 'Tap or drag to cobble' : 'Click or drag to cobble · right-drag to pan') + ' · 1 stone a tile, tap again to lift', false, false, title);
    else if (p.type === 'road') this.ui.placeBar(true, (touch ? 'Drag from a road to lay a dirt road' : 'Drag from a road to lay a dirt road · right-drag to pan') + ' · free, bridges 3 planks a tile', false, false, title);
    else if (p.ok) {
      const gets = (p.syn || []).filter(l => l.gets), gives = (p.syn || []).filter(l => !l.gets);
      const syn = gets.length ? ` · +${Math.round(gets.reduce((a, l) => a + l.rule.bonus, 0) * 100)}% from neighbours` : gives.length ? ` · boosts ${gives.length} neighbour${gives.length > 1 ? 's' : ''}` : '';
      this.ui.placeBar(true, (touch ? 'Tap a spot, then ✓' : 'Click to build · R rotates') + syn, false, touch, title);
    }
    else this.ui.placeBar(true, p.why, true, touch, title);
  }
  // gold lines to the neighbours a building would help or be helped by
  drawSynergyLinks(p, cx, cy, cz) {
    if (p.links) this.view.scene.remove(p.links);
    const list = PAINT[p.type] ? [] : this.sim.synergyPreview(p.type, cx, cz);
    p.syn = list;
    if (!list.length) { p.links = null; return; }
    const g = p.links = new THREE.Group();
    for (const l of list) {
      const oc = this.sim.bCenter(l.other), oy = this.sim.world.heightAt(oc.x, oc.z);
      const pts = []; for (let k = 0; k <= 20; k++) { const t = k / 20; pts.push(new THREE.Vector3(cx + (oc.x - cx) * t, Math.max(cy, oy) + 0.4 + Math.sin(t * Math.PI) * 1.2, cz + (oc.z - cz) * t)); }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: l.gets ? 0xffd54f : 0x9fff8a, dashSize: 0.3, gapSize: 0.18, depthTest: false, transparent: true }));
      line.computeLineDistances(); line.renderOrder = 12; g.add(line);
    }
    this.view.scene.add(g);
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
    if (isDecor(p.type) && (defOf(p.type).rare ? this.sim.s.tokens[p.type] > 0 : this.sim.canAfford(defOf(p.type).cost))) { this.refreshGhost(); return; }
    this.cancelPlace();
    this.ui.markCard(null);
  }
  cancelPlace(silent) {
    const p = this.place; if (!p) return;
    if (p.ghost) this.view.scene.remove(p.ghost, p.plane);
    if (p.edge) this.view.scene.remove(p.edge);
    if (p.links) this.view.scene.remove(p.links);
    if (p.moving) { const vis = this.bvis.get(p.moving.id); if (vis) vis.root.visible = true; }
    this.hl.showCells(null);
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
    if (this.place?.type === 'pave' || this.place?.type === 'road') return this.paintPave(cx, cy, first);
    return this.paintClear(cx, cy, first);
  }
  // roads and cobbles (roads.js): the first tile decides lay or lift; a fast drag fills the gaps
  paintPave(cx, cy, first) {
    const p = this.view.groundAt(cx, cy), tx = Math.floor(p.x + HALF), tz = Math.floor(p.z + HALF);
    if (!inMap(tx, tz)) return;
    const W = this.sim.world, road = this.place.type === 'road', i0 = idx(tx, tz);
    if (first) { this.paintMode = road ? !((W.road[i0] === 2 && !W.paved[i0]) || W.bridge[i0] === 2) : !W.paved[i0]; this.lastPaint = null; }
    const [lx, lz] = this.lastPaint || [tx, tz], n = Math.max(Math.abs(tx - lx), Math.abs(tz - lz));
    this.lastPaint = [tx, tz];
    for (let k = n ? 1 : 0; k <= n; k++) {
      const x = Math.round(lx + (tx - lx) * (n ? k / n : 1)), z = Math.round(lz + (tz - lz) * (n ? k / n : 1)), i = idx(x, z);
      const r = road ? paintRoad(this.sim, i, this.paintMode) : paintCobble(this.sim, i, this.paintMode);
      if (r === true) { this.sim.trade?.settleAt(i); W.bridge[i] && road ? sfx.place() : sfx.chop(); continue; }
      if (typeof r === 'string' && !this.noStoneWarned) {
        this.noStoneWarned = true; setTimeout(() => this.noStoneWarned = false, 2500);
        const msg = r === 'stone' ? 'You need stone to cobble roads' : r === 'planks' ? 'Bridges need 3 planks a tile' : r;
        this.ui.toast(msg, r === 'planks' ? 'plank' : r === 'stone' ? 'stone' : 'alert'); sfx.error();
        break;
      }
    }
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
    this.selected = ent && ent.kind !== 'lock' && ent.kind !== 'merchant' && ent.kind !== 'chest' ? ent : null;
    if (ent?.kind === 'lock') { this.ui.openModal('worldmap'); return; }
    if (ent?.kind === 'merchant') { this.ui.openModal('merchant'); return; }
    if (ent?.kind === 'chest') { this.selected = null; this.openChest(ent.ch); return; }
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
    this.selRing.visible = false;          // the outline in select.js replaces the old ring
    this.hl.setSelected(this.selected);
  }
  focus(x, z, dist) {
    const rig = this.view.rig, phone = innerWidth < 760;
    // nudge toward the camera so the thing lands in the upper part of the screen
    dist = Math.max(phone ? 17 : 15, dist || rig.dist);   // close enough to see it, never so close it fills the screen
    const k = phone ? dist * 0.24 : 0;
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
    for (const c of this.chests.values()) {
      if (c.t >= 0) continue;
      const p = this.view.project(tmpV.set(c.ch.x, c.root.position.y + 0.3, c.ch.z));
      if (p.vis && Math.hypot(p.x - cx, p.y - cy) < 38) return { kind: 'chest', ch: c.ch };
    }
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
    // a hidden or zero-size window has no aspect yet; assume a landscape one rather than NaN
    const aspect = innerWidth > 0 && innerHeight > 0 ? innerWidth / innerHeight : 1.6;
    const vt = Math.tan(cam.fov * Math.PI / 360), ht = vt * aspect;
    // usable fraction of the screen once the HUD is taken out
    const useW = phone ? 1.0 : 0.72, useH = phone ? 0.7 : 0.7;
    // ground depth is stretched by the camera's tilt (~1.25x at our pitch)
    const fitW = (w / 2 + 1.5) / (ht * useW), fitH = (h / 2 + 1.5) / (vt * 1.25 * useH);
    // a starter camp (a cottage and a campfire) opens close enough to see faces
    const starter = this.sim.s.buildings.filter(b => b.sid === sid && !isDecor(b.type)).length <= 3;
    const dist = starter ? (phone ? 13 : 10.5) : Math.max(phone ? 19 : 16, Math.min(phone ? 40 : 62, Math.max(fitW, fitH)));
    const k = phone ? dist * 0.05 : 0, side = phone ? dist * 0.055 : 0;
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
        // hover pre-selection, a few times a second is plenty
        else if (e.pointerType === 'mouse' && !this.place) {
          const now = performance.now();
          if (now - (this.hoverT || 0) > 70) { this.hoverT = now; this.hl.setHover(this.pick(e.clientX, e.clientY)); }
        }
        return;
      }
      this.hl.setHover(null);
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
    const now = performance.now(), last = this.lastTap;
    const dbl = last && now - last.t < 340 && Math.hypot(cx - last.x, cy - last.y) < 30;
    this.lastTap = dbl ? null : { t: now, x: cx, y: cy };
    const ent = this.pick(cx, cy);
    if (dbl && ent?.kind === 'v') { this.follow(ent.v); return; }
    if (dbl && !ent) { const g = this.view.groundAt(cx, cy); this.view.flyTo(g.x, g.z, Math.max(11, this.view.rig.dist * 0.6), 0.45); return; }
    this.select(ent);
  }
  // keep the camera on one villager until you drag the view
  follow(v) {
    if (!v) { this.followV = null; this.ui.drawInfo(true); return; }
    if (this.selected?.v !== v) this.select({ kind: 'v', v });
    this.followV = v;
    this.view.flyTo(v.x, v.z, Math.min(this.view.rig.dist, 18), 0.5);
    this.ui.drawInfo(true);
    sfx.pop();
  }
  // home button: frame the settlement nearest the camera
  goHome() {
    const r = this.view.rig;
    let best = 'meadow', bd = 1e9;
    for (const sid of Object.keys(this.sim.s.unlocked)) { const c = CENTERS[sid], d = Math.hypot(toWorld(c.x) - r.tx, toWorld(c.z) - r.tz); if (d < bd) { bd = d; best = sid; } }
    this.followV = null;
    this.frameSettlement(best);
    sfx.click();
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
    if (this.followV && !view.fly) { rig.tx = lerp(rig.tx, this.followV.x, Math.min(1, dt * 4)); rig.tz = lerp(rig.tz, this.followV.z, Math.min(1, dt * 4)); }

    if ((this.seasonT = (this.seasonT || 0) + dt) > 0.5) { this.seasonT = 0; this.updateSeason(); }
    this.dayLight(sim.s.time);
    this.weather(dt);
    view.updateCamera(dt);
    view.adapt(dt);

    if (this.tilesDirty.size) {
      for (const i of this.tilesDirty) { view.paintTile(i, false); view.updateGrass(i); view.updatePave(i); }
      view.terrainColor.needsUpdate = true; view.terrainSurface.needsUpdate = true;
      this.tilesDirty.clear();
    }
    while (this.stumpList.length && this.stumpList[0].t < sim.s.time) view.removeStump(this.stumpList.shift().slot);

    const t = now / 1000;
    for (const vis of this.bvis.values()) this.updateBVis(vis, dt, t);
    this.separate(dt);
    for (const v of sim.s.villagers) { const m = this.vvis.get(v.id); if (m) this.updateVVis(v, m, dt, t); }
    this.effects = this.effects.filter(f => f(dt));
    // bubbles keep a constant on-screen size (px tall) however far you zoom
    const cam = view.camera, pxK = Math.tan(cam.fov * Math.PI / 360) / (view.canvas.clientHeight / 2);
    for (const sp of this.screenSprites) { const h = sp.userData.px * pxK; sp.scale.set(h * 0.857, h, 1); }
    this.life.update(dt, t, this.night, this.rainK || 0, this.si, iceUniform.value);
    this.updateCart(dt, t);
    this.updateChests(dt, t);
    this.extras?.update(dt, t);
    this.updateFestival(dt, t);
    this.updateBeasts(dt, t);
    this.updateWard();
    this.drawBars();
    rpgFrame(this, dt);               // health bars, knocked-out poses (rpgview.js)

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
    if (this.place?.ghost && this.place.target) this.place.ghost.position.lerp(this.place.target, 1 - Math.exp(-dt * 22));
    this.hl.update(dt);
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
    this.stormK = lerp(this.stormK || 0, wx.storm ? 1 : 0, Math.min(1, dt * 0.5));
    this.cloudK = lerp(this.cloudK || 0, wx.cloud || 0, Math.min(1, dt * 0.3));
    const winter = this.si === 3, sk = this.stormK;
    this.seasonFall(dt);
    // storms: lightning now and then, thunder rolling in a moment later
    this.flashK = Math.max(0, (this.flashK || 0) - dt * 4.5);
    if (sk > 0.6 && !winter) {
      if ((this.boltT = (this.boltT ?? 2) - dt) <= 0) {
        this.boltT = 3.5 + Math.random() * 7;
        this.flashK = 1; setTimeout(() => { this.flashK = Math.max(this.flashK, 0.7); }, 140);
        const far = Math.random();
        setTimeout(() => sfx.thunder?.(1 - far * 0.5), 250 + far * 1400);
      }
    }
    const fl = document.getElementById('flash');
    if (fl && (this.flashK > 0.01 || this.flashOn)) { this.flashOn = this.flashK > 0.01; fl.style.opacity = (this.flashK * 0.32).toFixed(3); }
    const gl = document.getElementById('gloom'), go = (sk * (winter ? 0.25 : 0.42) * (1 - this.flashK)).toFixed(3);
    if (gl && gl.style.opacity !== go) gl.style.opacity = go;
    if (this.rainK > 0.01 && !winter) {
      if (!this.rain) {
        const n = 2400, pos = new Float32Array(n * 6);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.5, depthWrite: false }));
        this.rain.frustumCulled = false; this.rainDrops = Array.from({ length: n }, () => [Math.random() * 44 - 22, Math.random() * 16, Math.random() * 36 - 18]);
        view.scene.add(this.rain);
      }
      const pos = this.rain.geometry.attributes.position.array, fall = dt * (14 + sk * 9);
      // the rain volume scales with zoom so close-ups aren't a wall of streaks; storms pour and slant
      const zk = Math.max(0.45, Math.min(1.5, rig.dist / 30)), cnt = Math.round(Math.min(this.rainDrops.length, 1400 * (1 + sk * 0.7)) * Math.min(1, zk));
      const wind = 0.05 + sk * 0.3;
      this.rain.geometry.setDrawRange(0, cnt * 2);
      this.rainDrops.forEach((d, i) => {
        if (i >= cnt) return;
        d[1] -= fall; if (d[1] < 0) { d[1] += 16; d[0] = Math.random() * 44 - 22; d[2] = Math.random() * 36 - 18; }
        const x = rig.tx + d[0] * zk, z = rig.tz + d[2] * zk, y = d[1];
        pos.set([x, y, z, x - wind, y + 0.45 + sk * 0.25, z - 0.03], i * 6);
      });
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity = (0.45 + sk * 0.15) * this.rainK;
      this.rain.visible = true;
    } else if (this.rain) this.rain.visible = false;
    rainSound(winter ? 0 : this.rainK * (1 + sk * 0.6));
    // rainbow (a soft screen-space arc; the camera looks too steeply down for a 3D one)
    const show = (wx.rainbow || 0) > 0 && this.night < 0.4;
    if (show !== this.rainbowOn) { this.rainbowOn = show; document.getElementById('rainbow').classList.toggle('on', show); }
  }

  // falling things that follow the camera: snowflakes in winter, leaves in
  // autumn, blossom petals in spring (a flurry of them at the Flower Fair)
  seasonFall(dt) {
    const rig = this.view.rig, si = this.si, fair = this.fest?.fest.id === 'fair';
    const kind = si === 3 ? 'snow' : si === 2 ? 'leaf' : si === 0 || fair ? 'petal' : null;
    const want = kind === 'snow' ? 0.22 + (this.rainK || 0) * 0.78 : kind === 'leaf' ? 0.32 : kind === 'petal' ? (fair ? 0.6 : 0.16) : 0;
    this.fallK = lerp(this.fallK || 0, want, Math.min(1, dt * 0.5));
    const n = 900;
    if (!this.fall) {
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.fall = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.2, map: flakeTex(), vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.05 }));
      // flakes right by the camera would balloon into blobs: cap their size on screen
      this.fall.material.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', 'gl_PointSize = min(gl_PointSize, 16.0);\n#include <fog_vertex>'); };
      this.fall.frustumCulled = false;
      this.fallP = Array.from({ length: n }, () => [Math.random() * 44 - 22, Math.random() * 14, Math.random() * 36 - 18, Math.random() * 6.28, 0.7 + Math.random() * 0.6]);
      this.view.scene.add(this.fall);
    }
    const cnt = Math.round(n * Math.min(1, this.fallK));
    this.fall.visible = cnt > 4;
    if (!this.fall.visible) return;
    if (this.fallKind !== kind && kind) {
      this.fallKind = kind;
      const col = this.fall.geometry.attributes.color.array, c = new THREE.Color();
      const pal = kind === 'snow' ? [0xffffff, 0xf2f7ff] : kind === 'leaf' ? [0xe0702a, 0xd8a62c, 0xc4442e, 0xe8892e] : [0xf9b8cf, 0xffffff, 0xf4a3bf];
      for (let i = 0; i < n; i++) { c.setHex(pal[i % pal.length]); col.set([c.r, c.g, c.b], i * 3); }
      this.fall.geometry.attributes.color.needsUpdate = true;
      this.fall.material.size = kind === 'snow' ? 0.17 : kind === 'leaf' ? 0.26 : 0.16;
    }
    const pos = this.fall.geometry.attributes.position.array, t = performance.now() / 1000;
    const fallV = this.fallKind === 'snow' ? 1.3 : 0.9, sway = this.fallKind === 'snow' ? 0.35 : 0.9;
    for (let i = 0; i < cnt; i++) {
      const p = this.fallP[i];
      p[1] -= dt * fallV * p[4];
      if (p[1] < 0) { p[1] += 14; p[0] = Math.random() * 44 - 22; p[2] = Math.random() * 36 - 18; }
      pos[i * 3] = rig.tx + p[0] + Math.sin(t * 0.9 * p[4] + p[3]) * sway;
      pos[i * 3 + 1] = p[1];
      pos[i * 3 + 2] = rig.tz + p[2] + Math.cos(t * 0.7 * p[4] + p[3]) * sway * 0.6;
    }
    this.fall.geometry.setDrawRange(0, cnt);
    this.fall.geometry.attributes.position.needsUpdate = true;
    this.fall.material.opacity = Math.min(1, 0.4 + this.fallK) * (1 - this.night * 0.35);
  }

  dayLight(time) {
    // at night villagers get a thin cool rim (models.js) so they read against the dark ground
    // without glowing like ghosts
    if (Math.abs((this.vNight ?? -1) - this.night) > 0.02) { this.vNight = this.night; VILLAGER_MATS.rim.value.setRGB(0.09, 0.13, 0.26).multiplyScalar(this.night); }
    const f = (time % DAY) / DAY;                 // 0 = midnight
    const sunUp = Math.max(0, Math.sin((f - 0.22) / 0.56 * Math.PI));
    const light = f > 0.22 && f < 0.78 ? sunUp : 0;
    const night = this.night = 1 - Math.min(1, light * 2.2);
    document.body.classList.toggle('night', night > 0.6);
    setMood(this.sim.festivalActive() ? 'festival' : f < 0.21 || f > 0.86 ? 'night' : f < 0.34 ? 'morning' : f < 0.7 ? 'day' : 'evening');
    const v = this.view, rk = this.rainK || 0, sk = this.stormK || 0, ck = this.cloudK || 0, fk = this.flashK || 0;
    // the sun by day, a cool moon by night (dimmed by clouds and storms, lit up by lightning)
    v.sun.intensity = (0.28 + 2.27 * light) * (1 - rk * 0.55) * (1 - ck * 0.22) * (1 - sk * 0.4) + fk * 1.5;
    v.sun.color.setRGB(lerp(0.62, 1, 1 - night), lerp(0.7, lerp(0.72, 0.95, Math.min(1, light * 1.6)), 1 - night), lerp(1, lerp(0.55, 0.85, Math.min(1, light * 1.6)), 1 - night));
    v.hemi.intensity = lerp(0.42, 1.6, 1 - night) * (1 - sk * 0.3) + fk * 2.2;
    v.hemi.color.setRGB(lerp(0.34, 1, 1 - night), lerp(0.44, 0.97, 1 - night), lerp(1.0, 0.88, 1 - night));    // deep blue nights so warm windows glow
    v.hemi.groundColor.setRGB(lerp(0.07, 0.36, 1 - night), lerp(0.09, 0.54, 1 - night), lerp(0.22, 0.23, 1 - night));
    const S = v.season, SKY = [0x9cd3c0, 0xa2d7c2, 0xcbd3ad, 0xc4d5e0];
    const sky = new THREE.Color(SKY[S.a]).lerp(new THREE.Color(SKY[S.b]), S.k).lerp(new THREE.Color(0x8396a3), Math.max(rk * 0.7, ck * 0.32)).lerp(new THREE.Color(0x3c4552), sk * 0.55).lerp(new THREE.Color(0x1b2847), night * 0.92).lerp(new THREE.Color(0xdfe6ff), fk * 0.45);
    v.scene.background.copy(sky); v.scene.fog.color.copy(sky);
    const ice = iceUniform.value;
    v.water.material.color.setRGB(lerp(lerp(0.33, 0.12, night), lerp(0.8, 0.3, night), ice), lerp(lerp(0.75, 0.27, night), lerp(0.9, 0.36, night), ice), lerp(lerp(0.91, 0.5, night), lerp(0.97, 0.55, night), ice));
    v.water.material.opacity = 0.86 + ice * 0.11; v.water.material.shininess = 90 - ice * 50;
    const glow = mat(C.window, { emissive: 0x3a2a00 });
    glow.emissive.setRGB(0.23 + night * 0.85, 0.16 + night * 0.5, night * 0.1);
    mat(0xffe08a).emissive.setRGB(night * 1, night * 0.78, night * 0.3);
    const ho = night * night;
    for (const h of this.halos) { h.m.material.opacity = ho * h.k; h.m.visible = ho > 0.02; }
  }
}

const tmpV = new THREE.Vector3();
const at3 = (m, x, y, z, shadow = false) => { m.position.set(x, y, z); m.castShadow = shadow; return m; };
const PAINT = { clear: 'Clear Trees', pave: 'Cobble Road', road: 'Dirt Road' };
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
let _flake = null;
function flakeTex() {
  if (_flake) return _flake;
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(16, 16, 0, 16, 16, 15);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.55, 'rgba(255,255,255,.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.beginPath(); g.ellipse(16, 16, 15, 11, 0.6, 0, Math.PI * 2); g.fill();
  _flake = new THREE.CanvasTexture(cv); _flake.colorSpace = THREE.SRGBColorSpace;
  return _flake;
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
    // a placement ghost reads as not-yet-built: see-through, with a green (ok) or red (blocked) glow
    const g = m.clone(); g.transparent = true; g.opacity = ok ? 0.8 : 0.72; g.depthWrite = true;
    if (ok && g.emissive) g.emissive.setHex(0x16380f);
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
