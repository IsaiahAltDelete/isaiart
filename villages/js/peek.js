// Peek inside a home: select a house and its roof floats up and fades away, the walls are cut at
// window height like a doll's house, and the room inside shows: beds along the back wall, a table,
// the hearth, the family at home (tucked up in bed at night) and their pet curled by the fire.
import * as THREE from '../vendor/three.module.min.js';
import { box, cyl, ball, mat } from './models.js';
import { HOME_TYPES, LODGING_TYPES } from './data.js';
import { roomLayout } from './roomplan.js';
import { housingOf } from './sim.js';

const ROOF = new Set(['roof', 'snowcap', 'chim']);
const WALL = new Set(['wall', 'plaster']);
const QUILTS = [0xc8553d, 0x4f7cc4, 0xe0a53a, 0x6aa84f, 0x9b6bd1, 0xd96b9b, 0x3f9c9c];
const ease = k => k * k * (3 - 2 * k);
const plainCache = new Map();
const plain = c => plainCache.get(c) || (plainCache.set(c, new THREE.MeshLambertMaterial({ color: c, flatShading: true })), plainCache.get(c));
// bedding stays its own colour at night (lamplight would blow the quilts out to flat colour)
const softCache = new Map();
const soft = c => softCache.get(c) || (softCache.set(c, new THREE.MeshLambertMaterial({ color: c, flatShading: true })), softCache.get(c));
// a warm pool of light on the floor in front of the stove
let poolTex = null;
function warmPool() {
  if (!poolTex) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,200,120,1)'); gr.addColorStop(0.5, 'rgba(255,150,60,.45)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); poolTex = new THREE.CanvasTexture(cv);
  }
  return new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}
export const isHome = b => !!b && (HOME_TYPES.includes(b.type) || LODGING_TYPES.includes(b.type));

export function installPeek(game) {
  const view = game.view, sim = game.sim;
  view.renderer.localClippingEnabled = true;
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4);
  let cur = null;

  // Measure the house in its own (unrotated, unscaled) space: floor and eave heights, and a floor grid
  // made by dropping rays onto the wall volumes: each cell counts the volumes over it (0 = outdoors).
  function measure(vis) {
    const G0 = vis.group; G0.updateMatrixWorld(true);
    const inv = G0.matrixWorld.clone().invert(), walls = [], wb = new THREE.Box3(), roof = new THREE.Box3(), pad = new THREE.Box3(), all = new THREE.Box3(), tmp = new THREE.Box3();
    G0.traverse(o => {
      if (!o.isMesh) return;
      tmp.setFromObject(o).applyMatrix4(inv); all.union(tmp);
      if (WALL.has(o.userData.slot)) { walls.push(o); wb.union(tmp); }
      else if (o.userData.slot === 'roof') roof.union(tmp);
      else if (o.userData.slot === 'pad') pad.union(tmp);
    });
    const floor = pad.isEmpty() ? 0.05 : pad.max.y, eave = roof.isEmpty() ? wb.max.y : roof.min.y;
    const s = 0.1, box = wb.isEmpty() ? all : wb, gx = box.min.x, gz = box.min.z;
    const nx = Math.max(1, Math.round((box.max.x - gx) / s)), nz = Math.max(1, Math.round((box.max.z - gz) / s)), cnt = new Uint8Array(nx * nz);
    const rc = new THREE.Raycaster(); rc.layers.enableAll();   // a batched home's walls sit on an undrawn layer (batch.js)
    const p = new THREE.Vector3(), q = new THREE.Vector3(), down = new THREE.Vector3(), n = new THREE.Vector3();
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      p.set(gx + (x + 0.5) * s, box.max.y + 1, gz + (z + 0.5) * s).applyMatrix4(G0.matrixWorld);
      down.set(0, -1, 0); rc.set(p, down);
      let c = 0;
      for (const h of rc.intersectObjects(walls, false)) {
        n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
        if (n.y > 0.5 && q.copy(h.point).applyMatrix4(inv).y > floor + 0.25) c++;
      }
      cnt[z * nx + x] = Math.min(255, c);
    }
    if (!cnt.some(c => c)) cnt.fill(1);   // open-topped walls: treat the whole footprint as one room
    // cut low, like a doll's house: below the door's lintel so nothing tall stands in front of the room
    return { floor, cut: floor + Math.max(0.3, (eave - floor) * 0.42), top: all.max.y + 0.3, G: { cnt, nx, nz, s, gx, gz } };
  }

  function furnish(B, beds, seed) {
    const room = new THREE.Group(), L = roomLayout(B.G, beds), y = B.floor, { cnt, nx, nz, s, gx, gz } = B.G;
    // a plank floor over every indoor cell, a row of boards at a time in two tones
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx;) {
      if (!cnt[z * nx + x]) { x++; continue; }
      let x1 = x; while (x1 < nx && cnt[z * nx + x1]) x1++;
      room.add(box((x1 - x) * s, 0.02, s, z % 2 ? 0xc49460 : 0xb8885a, gx + (x + x1) / 2 * s, y, gz + (z + 0.5) * s));
      x = x1;
    }
    L.quilts = [];
    L.beds.forEach((b, i) => {
      // each bed is built head-to-foot along its own z, then turned to lie the way it fits
      const q = QUILTS[(seed + i * 3) % QUILTS.length], bed = new THREE.Group(), W = 0.42, Lb = b.l;
      bed.position.set(b.x, y, b.z); bed.rotation.y = b.yaw || 0; room.add(bed);
      const top = b.roll ? 0.04 : 0.19;                                                           // mattress height
      if (b.roll) bed.add(box(0.34, 0.035, Lb, 0xd8c08a, 0, 0, 0));                               // a straw bedroll on the floor
      else {
        bed.add(box(W, 0.12, Lb, 0x7a4a26, 0, 0, 0));                                             // frame
        bed.add(box(W + 0.04, 0.32, 0.05, 0x6a3e1e, 0, 0, -Lb / 2));                              // headboard
        bed.add(box(W + 0.04, 0.2, 0.04, 0x6a3e1e, 0, 0, Lb / 2));                                // footboard
        bed.add(box(W - 0.05, 0.07, Lb - 0.06, 0xf6efe0, 0, 0.12, 0));                            // mattress
      }
      bed.add(box(b.roll ? 0.24 : W - 0.16, 0.06, 0.13, 0xfffaf0, 0, top, -Lb / 2 + 0.11));       // pillow
      const quilt = box((b.roll ? 0.34 : W) + 0.01, 0.05, Lb * 0.6, q, 0, top - 0.02, Lb * 0.2); bed.add(quilt);
      quilt.userData.top = top; quilt.userData.l = Lb; L.quilts.push(quilt);
      b.top = top;
    });
    if (L.table) {
      const T = L.table, r = Math.max(0.12, T.r);
      const rug = cyl(r + 0.2, r + 0.2, 0.012, 16, 0xb8483c, T.x, y + 0.02, T.z); rug.scale.z = 0.75; room.add(rug);
      const rugIn = cyl(r + 0.1, r + 0.1, 0.014, 16, 0xe6b45a, T.x, y + 0.021, T.z); rugIn.scale.z = 0.75; room.add(rugIn);
      room.add(cyl(r, r, 0.04, 12, 0x9a6a3a, T.x, y + 0.28, T.z));
      room.add(cyl(0.035, 0.05, 0.28, 6, 0x6a3e1e, T.x, y, T.z));
      room.add(ball(0.055, 0xd9a05a, T.x + 0.04, y + 0.34, T.z - 0.02));
      room.add(cyl(0.045, 0.04, 0.05, 8, 0xf2ecdf, T.x - 0.06, y + 0.32, T.z + 0.05));               // a cup
    }
    let fire = null, pool = null;
    if (L.hearth) {
      const H = L.hearth;
      // a pot-bellied iron stove: a glowing fire-mouth at the front, a pipe up through the roof
      room.add(box(0.3, 0.03, 0.26, 0x6e6a66, H.x, y, H.z));                                        // hearthstone
      room.add(cyl(0.12, 0.13, 0.24, 10, 0x3b3430, H.x, y + 0.03, H.z));                            // the belly
      room.add(cyl(0.135, 0.135, 0.03, 10, 0x2a2420, H.x, y + 0.27, H.z));                          // top plate
      room.add(cyl(0.035, 0.035, 0.42, 6, 0x2a2420, H.x, y + 0.3, H.z - 0.04));                    // stovepipe
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.03), new THREE.MeshBasicMaterial({ color: 0xff9a2e }));
      mouth.position.set(H.x, y + 0.13, H.z + 0.12); room.add(mouth);
      fire = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.09, 6), new THREE.MeshBasicMaterial({ color: 0xffe07a }));
      fire.position.set(H.x, y + 0.13, H.z + 0.125); room.add(fire);
      pool = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20).rotateX(-Math.PI / 2), warmPool());
      pool.position.set(H.x, y + 0.03, H.z + 0.2); pool.renderOrder = 2; room.add(pool);       // the firelight, spilling from the stove's mouth
      room.add(cyl(0.11, 0.11, 0.012, 12, 0x7a5a9a, H.x, y + 0.02, H.z + 0.32));                    // the pet's cushion
    }
    // plain indoor materials: no winter snow settling on the beds
    const bedding = new Set([0xf6efe0, 0xfffaf0, 0xd8c08a, ...QUILTS]);
    // a chest in a room that would otherwise stand empty
    if (L.chest) {
      const K = L.chest;
      room.add(box(0.3, 0.16, 0.2, 0x8a5a30, K.x, y, K.z)); room.add(box(0.31, 0.03, 0.21, 0xc9973a, K.x, y + 0.1, K.z));
      const rugE = cyl(0.26, 0.26, 0.012, 14, 0x4f7cc4, K.x, y + 0.02, K.z + 0.05); rugE.scale.z = 0.7; room.add(rugE);
    }
    room.traverse(o => { if (o.isMesh && o !== fire && o !== pool && !o.material.isMeshBasicMaterial) { o.castShadow = false; o.receiveShadow = true; const h = o.material.color.getHex(); o.material = bedding.has(h) ? soft(h) : plain(h); } });
    return { room, L, fire, pool };
  }

  function open(vis) {
    const b = vis.b, B = measure(vis), parts = [];
    const folk = sim.s.villagers.filter(v => sim.homeOf?.(v) === b).sort((a, c) => a.id - c.id);
    const halos = [];
    vis.group.traverse(o => { if (o.isSprite && o.material.blending === THREE.AdditiveBlending) halos.push(o); });   // window glows would bloom on the beds
    vis.group.traverse(o => {
      if (!o.isMesh || o.userData.peekRoom) return;
      const m0 = o.material, m = m0.clone();
      m.onBeforeCompile = m0.onBeforeCompile; m.customProgramCacheKey = m0.customProgramCacheKey;
      const roof = ROOF.has(o.userData.slot) || o.userData.slot === 'door';
      if (roof) m.transparent = true;
      else { m.clippingPlanes = [plane]; m.clipShadows = true; m.side = THREE.DoubleSide; }
      o.material = m;
      parts.push({ o, m0, roof, door: o.userData.slot === 'door', y0: o.position.y, cast: o.castShadow });
    });
    const { room, L, fire, pool } = furnish(B, Math.min(8, Math.max(2, folk.length, housingOf(b))), b.id);
    room.traverse(o => { o.userData.peekRoom = true; });
    vis.group.add(room);
    return { vis, B, parts, room, L, fire, pool, folk, halos, k: 0, posed: new Map(), petMats: new Map(), petS: new Map() };
  }

  function unpose(c, id) { const m = game.vvis.get(id), sc = c.posed.get(id); if (m && sc) m.group.scale.setScalar(sc); c.posed.delete(id); }
  function close(c) {
    if (c.vis.anim?.smoke) c.vis.anim.smoke.on = !!c.vis.b.built;
    for (const p of c.parts) { p.o.material.dispose(); p.o.material = p.m0; p.o.position.y = p.y0; p.o.visible = true; p.o.castShadow = p.cast; }
    for (const id of [...c.posed.keys()]) unpose(c, id);
    for (const h of c.halos) h.scale.setScalar(h.userData.peekS ?? h.scale.x);
    for (const [g, sc] of c.petS) g.scale.setScalar(sc);
    for (const [o, m0] of c.petMats) { o.material.dispose(); o.material = m0; }
    c.vis.group.remove(c.room);
    c.room.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }

  const _v = new THREE.Vector3();
  const place = (c, obj, x, y, z, yaw) => { obj.position.copy(c.vis.group.localToWorld(_v.set(x, y, z))); obj.rotation.y = c.vis.group.rotation.y + yaw; };
  function apply(c, t) {
    const e = ease(c.k), B = c.B, ys = c.vis.group.scale.y, y0 = c.vis.root.position.y;
    plane.constant = y0 + (B.top + (B.cut - B.top) * e) * ys;
    for (const p of c.parts) if (p.roof) {
      // the roof floats up and fades; the door just fades, leaving the doorway open
      p.o.position.y = p.y0 + (p.door ? 0 : e * 1.4); p.o.material.opacity = 1 - e; p.o.visible = e < 0.98; p.o.castShadow = p.cast && e < 0.2;
    }
    // after dark the room glows with lamplight, so the peek reads as warm and lived-in, not a dark box
    const glow = (game.night || 0) * 0.42;
    if (glow !== c.glow) {
      c.glow = glow;
      for (const m of plainCache.values()) m.emissive.copy(m.color).multiplyScalar(glow);
      for (const m of softCache.values()) m.emissive.copy(m.color).multiplyScalar(glow * 0.35);
      for (const o of c.petMats.keys()) o.material.emissive.setRGB(0.5, 0.3, 0.15).multiplyScalar(glow * 1.2);
    }
    if (c.pool) c.pool.material.opacity = (0.25 + (game.night || 0) * 0.6) * (0.92 + Math.sin(t * 8) * 0.08);
    for (const h of c.halos) { h.userData.peekS ??= h.scale.x; h.scale.setScalar(h.userData.peekS * (1 - e)); }
    // no chimney smoke drifting through the open room
    const smoke = c.vis.anim?.smoke; if (smoke) smoke.on = e < 0.15 && !!c.vis.b.built;
    if (c.fire) c.fire.scale.set(1 + Math.sin(t * 7) * 0.08, 1 + Math.sin(t * 9) * 0.18, 1);
    // the family: whoever is home shows inside, a little smaller so the room fits them: tucked up in
    // bed when asleep, otherwise round the table. Anyone without a bed or a seat is upstairs.
    let bedN = 0, seat = 0;
    const occupied = new Set(), bedOf = new Map();
    for (const v of c.folk) {
      const m = game.vvis.get(v.id);
      if (!m || !v.indoors) { if (c.posed.has(v.id)) unpose(c, v.id); continue; }
      const bed = v.asleep ? c.L.beds[bedN++] : null, T = !v.asleep && seat < 3 ? c.L.table : null;
      if (!bed && !T) { m.group.visible = false; continue; }
      if (!c.posed.has(v.id)) c.posed.set(v.id, m.group.scale.x);
      m.group.scale.setScalar(c.posed.get(v.id) * 0.62);
      m.group.visible = e > 0.35;
      if (m.umb) m.umb.visible = false;
      if (bed) {
        occupied.add(bed); bedOf.set(v.id, bed);
        const yaw = bed.yaw || 0, off = bed.roll ? 0.16 : 0.24;   // lying back: head on the pillow, feet toward the foot
        place(c, m.group, bed.x + Math.sin(yaw) * off, B.floor + bed.top - 0.07, bed.z + Math.cos(yaw) * off, yaw);
        m.body.rotation.set(-Math.PI / 2 + 0.08, 0, 0); m.body.position.set(0, 0.11, -0.25); m.bed.visible = false;   // lying back, head on the pillow
      } else {
        const a = seat++ * 2.2 + 0.4, x = T.x + Math.cos(a) * (T.r + 0.16), z = T.z + Math.sin(a) * (T.r + 0.16);
        place(c, m.group, x, B.floor + 0.02, z, Math.atan2(T.x - x, T.z - z));
        m.body.rotation.set(0, 0, 0); m.body.position.set(0, 0, 0);
      }
    }
    // tucked in: the quilt drapes over the legs of whoever is in the bed, head and arms out on top
    c.L.beds.forEach((b, i) => {
      const q = c.L.quilts[i], on = occupied.has(b), h = on ? 0.1 : 0.05, top = q.userData.top, Lq = q.userData.l;
      q.scale.set(1.04, h / 0.05, 1); q.position.y = top - 0.02 + h / 2; q.position.z = on ? (b.roll ? 0.1 : 0.15) : Lq * 0.2;
    });
    // and the pet, curled up on its cushion by the hearth
    for (const p of sim.s.pets || []) {
      if (!c.folk.some(v => v.id === p.owner && v.indoors) || (!c.L.hearth && !bedOf.get(p.owner))) continue;
      const g = game.lifeVis?.petMesh?.(p.id); if (!g) continue;
      const ob = bedOf.get(p.owner);
      if (ob && !ob.roll) { const yaw = ob.yaw || 0, f = ob.l / 2 - 0.13; place(c, g, ob.x + Math.sin(yaw) * f, B.floor + ob.top + 0.1, ob.z + Math.cos(yaw) * f, yaw + Math.PI / 2); }
      else place(c, g, c.L.hearth.x, B.floor + 0.03, c.L.hearth.z + 0.32, Math.PI / 2);
      if (!c.petS.has(g)) c.petS.set(g, g.scale.x);
      g.scale.setScalar(c.petS.get(g) * 0.66);   // to the room's scale, like the family
      g.visible = e > 0.35;
      // lit by the stove: its own copies of its materials while it's indoors, so the glow can warm it
      if (!c.petMats.size) { g.traverse(o => { if (o.isMesh && o.material?.emissive) { c.petMats.set(o, o.material); o.material = o.material.clone(); o.material.onBeforeCompile = c.petMats.get(o).onBeforeCompile; } }); c.glow = -1; }
    }
  }

  return {
    get openB() { return cur?.vis.b || null; },
    // asleep in a bed we're looking into (for the 'zzz' bubble)
    showing(v) { return !!cur && cur.k > 0.5 && cur.posed.has(v.id) && !!v.asleep; },
    get debug() { return cur && { L: cur.L, floor: cur.B.floor, cut: cur.B.cut, G: { ...cur.B.G, cnt: undefined } }; },
    update(dt, t) {
      const sel = game.selected?.kind === 'b' ? game.selected.b : null;
      const want = sel && sel.built && isHome(sel) ? game.bvis.get(sel.id) : null;
      if (cur && game.bvis.get(cur.vis.b.id) !== cur.vis) cur = null;                  // the model was rebuilt under us
      if (cur && cur.vis !== want) { cur.k -= dt * 2.5; if (cur.k <= 0) { close(cur); cur = null; } }
      else if (!cur && want) cur = open(want);
      if (cur && cur.vis === want) cur.k = Math.min(1, cur.k + dt * 1.8);
      if (cur) apply(cur, t);
    },
  };
}
