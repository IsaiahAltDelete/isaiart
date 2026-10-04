// Entry point: wires the simulation, the 3D view, the UI and input.
import * as THREE from '../vendor/three.module.min.js';
import { Sim, defOf, isDecor, footprint, DAY } from './sim.js';
import { View, bubbleTexture, timeUniform } from './view.js';
import { buildModel, scaffold, villagerModel, setTool, mat, C, pineGeo, stumpGeo } from './models.js';
import { UI } from './ui.js';
import { N, HALF, idx, toWorld, inMap, CENTERS, tileX, tileZ } from './world.js';
import { SETTLEMENTS, BUILD_ORDER, DECOR_ORDER, GOODS } from './data.js';
import { initAudio, sfx, setSound, ambient } from './audio.js';

const SAVE_KEY = 'isaiart.villages.v1';
const SET_KEY = 'isaiart.villages.settings';
const NEED_ICON = { sawmill: 'wood', windmill: 'wheat', bakery: 'flour', mason: 'stone' };
const STATUS_ICON = { 'Storage full': 'bag', 'No trees nearby': 'axe', 'No boulders nearby': 'pick', 'Nothing to sell': 'coin', 'Waiting for berries': 'basket' };
const SACK = { wood: 0x9a6a3e, stone: 0xa9adb0, food: 0xd8304a, grain: 0xe6c35c };
const ANIM_TOOL = { chop: 'axe', mine: 'pick', hammer: 'hammer', saw: 'hammer', hoe: 'hoe', fish: 'rod', gather: 'basket', plant: 'sapling' };
const JOB_TOOL = { woodcutter: 'axe', miner: 'pick', fisher: 'rod', forager: 'basket', farmer: 'hoe', forester: 'sapling', mason: 'hammer', sawyer: 'hammer' };

const tick = () => new Promise(r => requestAnimationFrame(() => r()));
const lerp = (a, b, t) => a + (b - a) * t;

class Game {
  constructor() {
    this.settings = { sound: true, quality: matchMedia('(pointer: coarse)').matches ? 'low' : 'high' };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch { /* defaults */ }
    this.bvis = new Map(); this.vvis = new Map();
    this.tilesDirty = new Set();
    this.stumpList = [];
    this.keys = new Set();
    this.selected = null; this.followV = null;
    this.place = null;
    this.thumbs = {};
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
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthTest: false }));
    this.selRing.renderOrder = 10; this.selRing.visible = false;
    this.view.scene.add(this.selRing);
    this.ui = new UI(this);
    this.hookEvents();
    this.bindInput();
    setSound(this.settings.sound);
    const c = CENTERS.meadow;
    Object.assign(this.view.rig, { tx: toWorld(c.x), tz: toWorld(c.z) + 1, dist: innerWidth < 760 ? 34 : 27 });
    await step(100);
    document.getElementById('loading').classList.add('gone');
    setTimeout(() => document.getElementById('loading').remove(), 700);
    if (!save) setTimeout(() => this.ui.toast('Welcome to Meadowbrook! Open Build to begin.', 'house', true), 900);
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
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture('hammer'), transparent: true, depthWrite: false }));
    sp.scale.set(0.75, 0.875, 1); sp.position.y = Math.max(1.4, top + 0.55); sp.visible = false; sp.renderOrder = 5;
    root.add(sp);
    const vis = { b, root, group, anim, sprite: sp, icon: null, scaffold: null, phase: Math.random() * 6, pop: 0 };
    this.view.objects.add(root);
    this.bvis.set(b.id, vis);
    this.applyBuild(vis);
    if (b.type === 'farm') this.applyFarm(vis);
  }
  applyBuild(vis) {
    const b = vis.b;
    if (!b.built) {
      if (!vis.scaffold) { vis.scaffold = scaffold(footprint(b.type, 0)); vis.group.add(vis.scaffold); }
      vis.anim.inner.scale.y = 0.06 + 0.94 * b.progress;
      if (vis.anim.smoke) vis.anim.smoke.on = false;
    } else {
      if (vis.scaffold) { vis.group.remove(vis.scaffold); vis.scaffold = null; vis.pop = 1; }
      vis.anim.inner.scale.y = 1;
      if (vis.anim.smoke) vis.anim.smoke.on = true;
    }
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
    if (this.selected?.b === b) this.select(null);
  }
  bubbleFor(b) {
    if (!b.built) return isDecor(b.type) ? null : 'hammer';
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
    if (icon) vis.sprite.position.y += Math.sin(time * 3 + vis.phase) * 0.003;
    if (vis.pop > 0) {
      vis.pop = Math.max(0, vis.pop - dt * 2.5);
      const k = 1 + Math.sin(vis.pop * Math.PI) * 0.12;
      vis.group.scale.set(k, 1 + Math.sin(vis.pop * Math.PI * 2) * 0.08, k);
    }
    if (!b.built) return;
    const busy = b.workers.length > 0 && !b.status;
    if (a.blades) a.blades.rotation.z += dt * (busy ? 1.6 : 0.25);
    if (a.blade && busy) a.blade.rotation.y += dt * 12;
    if (a.smoke) a.smoke.update(dt);
    if (a.fire) {
      const f = 0.9 + Math.sin(time * 13 + vis.phase) * 0.08 + Math.sin(time * 7.3) * 0.06;
      a.fire.scale.set(f, f * (1 + Math.sin(time * 9) * 0.1), f);
      a.light.intensity = (1.6 + Math.sin(time * 11) * 0.3) * (1 + this.night * 2.5);
    }
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
  nearSound(v, name) {
    const r = this.view.rig;
    if (Math.hypot(v.x - r.tx, v.z - r.tz) < 10 && r.dist < 30 && Math.random() < 0.6) sfx[name]();
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
    sim.on('settlements', () => { this.makeLockMarkers(); });
  }

  // ── placement ──
  startPlace(type) {
    this.cancelPlace(true);
    this.select(null);
    const p = this.place = { type, rot: 0, tx: 0, tz: 0, ok: false, why: '' };
    if (type !== 'clear') {
      const { group, anim } = buildModel(type, defOf(type).size);
      anim.smoke?.update(0.3);
      group.traverse(o => { if (o.isMesh) { o.material = ghostMat(o.material); o.castShadow = false; } });
      const root = new THREE.Group(); root.add(group);
      p.ghost = root; p.model = group;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7dff6a, transparent: true, opacity: 0.4, depthTest: false }));
      plane.renderOrder = 9; p.plane = plane;
      this.view.scene.add(root, plane);
    }
    this.drawTerritory();
    const r = this.view.canvas.getBoundingClientRect();
    this.ghostAt(r.left + r.width / 2, r.top + r.height * 0.45);
    sfx.click();
  }
  ghostAt(cx, cy) {
    const p = this.place; if (!p) return;
    const g = this.view.groundAt(cx, cy);
    if (p.type === 'clear') { p.cursor = g; this.placeMsg(); return; }
    let [w, d] = footprint(p.type, p.rot);
    p.tx = Math.round(g.x + HALF - w / 2); p.tz = Math.round(g.z + HALF - d / 2);
    if (p.type === 'dock') { p.rot = this.sim.bestDockRot(p.tx, p.tz); [w, d] = footprint(p.type, p.rot); }
    this.refreshGhost();
  }
  refreshGhost() {
    const p = this.place; if (!p || !p.ghost) return;
    const chk = this.sim.checkPlace(p.type, p.tx, p.tz, p.rot);
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
    this.placeMsg();
  }
  placeMsg() {
    const p = this.place; if (!p) return;
    const touch = this.lastPointer !== 'mouse';
    if (p.type === 'clear') this.ui.placeBar(true, touch ? 'Tap or drag over trees to mark them' : 'Click or drag over trees · right-drag to pan', false, false);
    else if (p.ok) this.ui.placeBar(true, touch ? 'Tap to move · ✓ to build' : 'Click to build · R rotates', false, touch);
    else this.ui.placeBar(true, p.why, true, touch);
  }
  rotatePlace() {
    const p = this.place; if (!p || p.type === 'clear' || p.type === 'dock') return;
    p.rot = (p.rot + 1) % 4; this.refreshGhost(); sfx.click();
  }
  confirmPlace() {
    const p = this.place; if (!p || p.type === 'clear') return;
    if (!p.ok) { sfx.error(); this.ui.toast(p.why, 'alert'); return; }
    const res = this.sim.place(p.type, p.tx, p.tz, p.rot);
    if (!res.ok) { sfx.error(); return; }
    if (isDecor(p.type) && this.sim.canAfford(defOf(p.type).cost)) { this.refreshGhost(); return; }
    this.cancelPlace();
    this.ui.markCard(null);
  }
  cancelPlace(silent) {
    const p = this.place; if (!p) return;
    if (p.ghost) this.view.scene.remove(p.ghost, p.plane);
    this.place = null;
    if (this.terr) { this.view.scene.remove(this.terr); this.terr = null; }
    this.ui?.placeBar(false);
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
    this.selected = ent && ent.kind !== 'lock' ? ent : null;
    if (ent?.kind === 'lock') { this.ui.openModal('worldmap'); return; }
    if (!ent || ent.kind !== 'v') this.followV = null;
    if (ent) sfx.click();
    this.ui.lastInfo = null;
    this.ui.drawInfo(true);
    if (ent?.kind === 'b') {
      const c = this.sim.bCenter(ent.b);
      this.selRing.scale.setScalar(Math.max(c.w, c.d) * 0.78);
      this.selRing.position.set(c.x, this.bvis.get(ent.b.id).root.position.y + 0.05, c.z);
      if (fly) this.view.flyTo(c.x, c.z);
    } else if (ent?.kind === 'v') {
      this.selRing.scale.setScalar(0.35);
      if (fly) this.view.flyTo(ent.v.x, ent.v.z);
    }
    this.selRing.visible = !!this.selected;
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
  flyToSettlement(sid) {
    const c = CENTERS[sid];
    this.view.flyTo(toWorld(c.x), toWorld(c.z) + 1, 28, 1.4);
  }

  // ── input ──
  bindInput() {
    const cv = this.view.canvas, view = this.view, rig = view.rig;
    const ptrs = new Map();
    let drag = null, pinch = null;
    const anchor = new THREE.Vector3(), tmp = new THREE.Vector3();
    cv.addEventListener('contextmenu', e => e.preventDefault());
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
      const clearing = this.place?.type === 'clear' && e.button === 0;
      if (clearing) { this.paintMode = undefined; this.paintClear(e.clientX, e.clientY, true); drag = { mode: 'paint' }; return; }
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
      if (drag.mode === 'paint') { this.paintClear(e.clientX, e.clientY, false); return; }
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
    if (p && p.type !== 'clear') {
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
  }

  save() {
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
    view.updateCamera(dt);

    if (this.tilesDirty.size) { for (const i of this.tilesDirty) view.paintTile(i, false); view.terrainColor.needsUpdate = true; this.tilesDirty.clear(); }
    while (this.stumpList.length && this.stumpList[0].t < sim.s.time) view.removeStump(this.stumpList.shift().slot);

    const t = now / 1000;
    for (const vis of this.bvis.values()) this.updateBVis(vis, dt, t);
    for (const v of sim.s.villagers) { const m = this.vvis.get(v.id); if (m) this.updateVVis(v, m, dt, t); }

    // selection ring + name tag
    const tag = document.getElementById('tag');
    if (this.selected?.kind === 'v') {
      const v = this.selected.v;
      this.selRing.position.set(v.x, sim.world.heightAt(v.x, v.z) + 0.05, v.z);
      const p = view.project(new THREE.Vector3(v.x, sim.world.heightAt(v.x, v.z) + 0.95, v.z));
      tag.classList.toggle('hidden', !p.vis); tag.textContent = v.name.split(' ')[0];
      tag.style.left = p.x + 'px'; tag.style.top = p.y + 'px';
    } else tag.classList.add('hidden');
    if (this.selRing.visible) this.selRing.material.opacity = 0.65 + Math.sin(t * 4) * 0.25;

    ambient(dt * (this.night > 0.5 ? 0.2 : 1));
    this.ui.frame(dt);
    view.render();
    this.saveTimer += dt;
    if (this.saveTimer > 20) { this.saveTimer = 0; this.save(); }
  }

  dayLight(time) {
    const f = (time % DAY) / DAY;                 // 0 = midnight
    const sunUp = Math.max(0, Math.sin((f - 0.22) / 0.56 * Math.PI));
    const light = f > 0.22 && f < 0.78 ? sunUp : 0;
    const night = this.night = 1 - Math.min(1, light * 2.2);
    const v = this.view;
    v.sun.intensity = 0.55 + 2.0 * light;
    v.sun.color.setRGB(1, lerp(0.72, 0.95, Math.min(1, light * 1.6)), lerp(0.55, 0.85, Math.min(1, light * 1.6)));
    v.hemi.intensity = 0.85 + 0.75 * light;
    v.hemi.color.setRGB(lerp(0.62, 1, 1 - night), lerp(0.7, 0.97, 1 - night), lerp(1, 0.88, 1 - night));
    const sky = new THREE.Color(0x9cd3c0).lerp(new THREE.Color(0x3a4f78), night * 0.85);
    v.scene.background.copy(sky); v.scene.fog.color.copy(sky);
    const glow = mat(C.window, { emissive: 0x3a2a00 });
    glow.emissive.setRGB(0.23 + night * 0.75, 0.16 + night * 0.5, night * 0.12);
    mat(0xffe08a).emissive.setRGB(night * 0.9, night * 0.7, night * 0.25);
  }
}

const ghostCache = new Map();
function ghostMat(m) {
  if (!ghostCache.has(m)) {
    const g = m.clone(); g.transparent = true; g.opacity = 0.72; g.depthWrite = true;
    ghostCache.set(m, g);
  }
  return ghostCache.get(m);
}

const game = new Game();
window.villages = game;
game.init().catch(err => {
  console.error(err);
  const l = document.getElementById('loading');
  if (l) l.querySelector('p').textContent = 'Something went wrong loading the village: ' + err.message;
});
