// Draw batching: a whole town in a few dozen draw calls instead of a couple of thousand.
//
// Villagers: each villager's rigid parts are baked into vertex-coloured geometry (models.js
// bakeVillager), and every part of every villager is drawn from two BatchedMeshes (shadow casters and
// the rest) sharing one material. Each frame a part's instance takes its node's world matrix, so limbs
// still swing; far away the no-detail bake is drawn instead.
//
// Buildings: once a building is settled (built, not being moved, upgraded, damaged or peeked into) its
// static meshes become instances in one BatchedMesh per material, shared by the whole town. The
// originals stay in the scene graph on a layer the camera never draws (picking still finds them),
// and any change to the building drops it back out of the batch first.
import * as THREE from '../vendor/three.module.min.js';
import { VILLAGER_BAKED, BAKED, BAKED_LAYER, SMOKES, SMOKE_GEO, SHADOW_GEO, SHADOW_MAT } from './models.js';
import { BATCHING } from './perf.js';
import { lvlOf } from './sim.js';

// a BatchedMesh that grows (and compacts) itself when it runs out of room
class Batch {
  constructor(material, cast, recv, v = 16384, i = 32768, n = 256) {
    this.v = v; this.i = i; this.n = n;
    const b = this.mesh = new THREE.BatchedMesh(n, v, i, material);
    b.castShadow = cast; b.receiveShadow = recv; b.frustumCulled = false; b.perObjectFrustumCulled = true;
    this.geos = new Map(); this.count = 0;
  }
  geometry(geo, key = geo.uuid) {
    const known = this.geos.get(key); if (known) return known;
    const nv = geo.attributes.position.count, ni = geo.index ? geo.index.count : nv;
    let id;
    try { id = this.mesh.addGeometry(geo); }
    catch {
      try { this.mesh.optimize(); id = this.mesh.addGeometry(geo); }
      catch {
        this.v = Math.max(this.v * 2, this.v + nv * 2); this.i = Math.max(this.i * 2, this.i + ni * 2);
        this.mesh.setGeometrySize(this.v, this.i); id = this.mesh.addGeometry(geo);
      }
    }
    this.geos.set(key, id);
    return id;
  }
  dropGeometry(key) { const id = this.geos.get(key); if (id !== undefined) { this.mesh.deleteGeometry(id); this.geos.delete(key); } }
  instance(gid) {
    if (this.count >= this.n) { this.n *= 2; this.mesh.setInstanceCount(this.n); }
    this.count++;
    return this.mesh.addInstance(gid);
  }
  drop(iid) { this.mesh.deleteInstance(iid); this.count--; }
}

export function installBatches(game) {
  if (!BATCHING) return null;
  const scene = game.view.scene;
  // villagers
  const vb = [new Batch(VILLAGER_BAKED, false, false, 65536, 131072, 512), new Batch(VILLAGER_BAKED, true, false, 65536, 131072, 512)];
  for (const b of vb) { b.mesh.sortObjects = false; scene.add(b.mesh); }   // one opaque material: no need to sort ~800 parts twice a frame
  const freeV = m => {
    for (const p of m.inst || []) for (const k of ['full', 'lite']) if (p[k]) { const b = vb[+p.cast]; b.drop(p[k].iid); b.dropGeometry(p[k].key); }
    m.inst = null; m.batchGen = 0;
  };
  const addV = m => {
    m.inst = m.parts.map((p, n) => {
      const b = vb[+p.cast], one = (geo, tag) => { const key = `${m.uid}:${m.bakeGen}:${n}:${tag}`, gid = b.geometry(geo, key); return { key, iid: b.instance(gid) }; };
      const e = { R: p.R, cast: p.cast, full: one(p.full, 'f'), lite: p.lite ? one(p.lite, 'l') : null };
      p.full.dispose(); p.lite?.dispose();   // the batch has its own copy now
      return e;
    });
    m.parts = null; m.batchGen = m.bakeGen;
  };
  // still in the scene at all? and if so, visible all the way up?
  const attached = o => { for (; o; o = o.parent) if (o === scene) return true; return false; };
  const shown = o => { for (; o && o !== scene; o = o.parent) if (!o.visible) return false; return true; };
  function syncVillagers() {
    for (const m of BAKED) {
      if (m.parts) { freeV(m); addV(m); }
      const live = attached(m.group);
      if (!live) {   // gone from the world (died, grew up into a new model, left, a visitor went home...)
        m.away = (m.away || 0) + 1;
        if (m.away > 90) { freeV(m); BAKED.delete(m); continue; }
      } else m.away = 0;
      for (const e of m.inst || []) {
        const vis = live && shown(e.R), b = vb[+e.cast].mesh, far = !!m.far && !!e.lite;
        b.setVisibleAt(e.full.iid, vis && !far); if (e.lite) b.setVisibleAt(e.lite.iid, vis && far);
        if (vis) b.setMatrixAt(far ? e.lite.iid : e.full.iid, e.R.matrixWorld);
      }
    }
  }
  // the soft blob shadow under every villager: one instanced mesh for the whole crowd
  let blobs = null;
  const blobMesh = n => { if (blobs) { scene.remove(blobs); blobs.dispose(); } blobs = new THREE.InstancedMesh(SHADOW_GEO, SHADOW_MAT, n); blobs.renderOrder = 1; blobs.frustumCulled = false; scene.add(blobs); return blobs; };
  blobMesh(256);
  function syncBlobs() {
    let k = 0;
    for (const m of BAKED) {
      if (!m.blob || !m.inst) continue;
      m.blob.layers.set(BAKED_LAYER);
      if (!m.blob.visible || m.away || !shown(m.group)) continue;
      if (k >= blobs.instanceMatrix.count) blobMesh(blobs.instanceMatrix.count * 2);
      blobs.setMatrixAt(k++, m.blob.matrixWorld);
    }
    blobs.count = k; blobs.instanceMatrix.needsUpdate = true;
  }
  // chimney smoke: every puff in the town in one instanced draw, each with its own fade
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9a9a9a, flatShading: true, transparent: true, depthWrite: false });
  smokeMat.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float aOp;\nvarying float vOp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vOp = aOp;');
    sh.fragmentShader = 'varying float vOp;\n' + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vOp );');
  };
  smokeMat.customProgramCacheKey = () => 'smoke-batch';
  let smoke = null, smokeCap = 0;
  const smokeMesh = n => {
    if (smoke) { scene.remove(smoke); smoke.geometry.dispose(); smoke.dispose(); }
    const geo = SMOKE_GEO.clone(); geo.setAttribute('aOp', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    smoke = new THREE.InstancedMesh(geo, smokeMat, n); smoke.frustumCulled = false; smoke.renderOrder = 2; smokeCap = n; scene.add(smoke); return smoke;
  };
  smokeMesh(512);
  function syncSmoke() {
    let k = 0;
    for (const sm of SMOKES) {
      const host = sm.puffs[0];
      if (!attached(host)) { if ((sm.away = (sm.away || 0) + 1) > 90) SMOKES.delete(sm); continue; }
      sm.away = 0;
      if (!shown(host.parent)) continue;
      for (const p of sm.puffs) {
        const op = p.userData.op ?? 0; if (op <= 0.01) continue;
        if (k >= smokeCap) smokeMesh(smokeCap * 2);
        smoke.setMatrixAt(k, p.matrixWorld); smoke.geometry.attributes.aOp.setX(k, op); k++;
      }
    }
    smoke.count = k; smoke.instanceMatrix.needsUpdate = true; smoke.geometry.attributes.aOp.needsUpdate = true;
  }
  // buildings
  const bb = new Map();
  const batchFor = (o) => {
    const g = o.geometry, sig = Object.entries(g.attributes).map(([k, a]) => k + a.itemSize).sort().join(',') + (g.index ? 'i' : 'n');
    const key = `${o.material.uuid}|${+o.castShadow}${+o.receiveShadow}|${sig}`;
    let b = bb.get(key);
    if (!b) { b = new Batch(o.material, o.castShadow, o.receiveShadow); bb.set(key, b); scene.add(b.mesh); }
    return b;
  };
  const moving = (vis) => {
    const keep = new Set(), add = v => { if (v?.isObject3D) keep.add(v); };
    for (const [k, v] of Object.entries(vis.anim || {})) {
      if (k === 'inner') continue; add(v);
      if (Array.isArray(v)) v.forEach(add); else if (v && typeof v === 'object' && !v.isObject3D) for (const w of Object.values(v)) { add(w); if (Array.isArray(w)) w.forEach(add); }
    }
    return keep;
  };
  const settled = vis => {
    const b = vis.b;
    return b.built && !b.up && !vis.scaffold && !(vis.pop > 0) && !b.damaged && !b.fire && vis.root.visible && vis.anim?.inner?.visible !== false
      && (vis.anim?.inner?.scale.y ?? 1) === 1 && game.peek?.openB !== b;
  };
  function batchIn(vis) {
    vis.root.updateMatrixWorld(true);
    const keep = moving(vis), out = [];
    const walk = (o, up) => {
      for (const c of o.children) {
        if (!c.visible || keep.has(c) || c.userData.peekRoom || c.isSprite) continue;
        if (c.isMesh && !c.isInstancedMesh && !Array.isArray(c.material) && !c.material.transparent && c.renderOrder === 0 && c.material.visible !== undefined) {
          const b = batchFor(c), iid = b.instance(b.geometry(c.geometry));
          b.mesh.setMatrixAt(iid, c.matrixWorld); c.layers.set(BAKED_LAYER); out.push({ c, b, iid });
        }
        walk(c, up);
      }
    };
    walk(vis.group, true);
    vis.batched = out;
  }
  function batchOut(vis) {
    for (const { c, b, iid } of vis.batched || []) { b.drop(iid); c.layers.set(0); }
    vis.batched = null;
  }
  // anything that changes a building's meshes drops it out of the batch first
  // (applyBuild only changes a settled building through applyLevel; scaffolds and construction unsettle it)
  const changes = {
    applyLevel: vis => vis.lvl !== lvlOf(vis.b),
    applyProsperity: vis => vis.prosLvl !== (vis.b.prosEmpty || !vis.b.built ? 0 : vis.b.pros || 0),
    removeBVis: () => true,
  };
  for (const [fn, will] of Object.entries(changes)) {
    const orig = game[fn].bind(game);
    game[fn] = (x, ...rest) => { const vis = x?.root ? x : game.bvis.get(x?.id); if (vis?.batched && will(vis)) batchOut(vis); return orig(x, ...rest); };
  }
  function syncBuildings() {
    for (const vis of game.bvis.values()) {
      const want = settled(vis);
      if (want && !vis.batched) batchIn(vis); else if (!want && vis.batched) batchOut(vis);
    }
  }
  return {
    sync() { syncBuildings(); syncVillagers(); syncBlobs(); syncSmoke(); },
    stats() { return { villagerParts: [...BAKED].reduce((n, m) => n + (m.inst?.length || 0), 0), buildingBatches: bb.size, buildingInstances: [...bb.values()].reduce((n, b) => n + b.count, 0) }; },
  };
}
