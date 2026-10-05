// What hard times look like (events.js): flames and smoke on burning buildings,
// charred damaged ones, wisps drifting through a haunted village at night, a sickly
// glow over villagers with a fever, the ground shaking, and the dragon itself.
import * as THREE from '../vendor/three.module.min.js';
import { hasModel, instanceModel } from './blender.js';
import { mat } from './models.js';
import { CENTERS, toWorld } from './world.js';

let glow = null;
function glowTex() {
  if (glow) return glow;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return (glow = new THREE.CanvasTexture(cv));
}
const sprite = (color, size, additive = true, opacity = 1) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  s.scale.setScalar(size); return s;
};

export function installEventVisuals(game) {
  const sim = game.sim, view = game.view, fires = new Map(), wisps = [], sickMarks = new Map();
  let shake = 0, shook = { x: 0, z: 0 }, dragon = null;

  // ── fire ──
  function addFire(b) {
    if (fires.has(b.id)) return;
    const vis = game.bvis.get(b.id); if (!vis) return;
    const g = new THREE.Group(), flames = [];
    const top = new THREE.Box3().setFromObject(vis.group).max.y - vis.root.position.y;
    for (let k = 0; k < 7; k++) {
      const f = new THREE.Group();
      f.add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 6), mat(0xff7a1a, { basic: true })));
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.38, 6), mat(0xffd34a, { basic: true })); inner.position.y = -0.06; f.add(inner);
      const a = k / 7 * Math.PI * 2, r = 0.35 + (k % 3) * 0.22;
      f.position.set(Math.cos(a) * r, top * (0.55 + (k % 2) * 0.3), Math.sin(a) * r);
      f.userData.ph = k * 1.7; g.add(f); flames.push(f);
    }
    const halo = sprite(0xff8a30, 4.5, true, 0.7); halo.position.y = top * 0.7; g.add(halo);
    const smoke = [];
    for (let k = 0; k < 6; k++) { const p = sprite(0x2a2622, 1.2, false, 0.5); p.userData.ph = k / 6; g.add(p); smoke.push(p); }
    vis.root.add(g);
    fires.set(b.id, { g, flames, smoke, halo, vis, top });
  }
  function removeFire(id) { const f = fires.get(id); if (f) { f.vis.root.remove(f.g); fires.delete(id); } }

  // ── damage: darken the building's materials (restored on repair) ──
  function applyDamage(vis) {
    const dmg = !!vis.b.damaged;
    if (vis.dmg === dmg) return;
    vis.dmg = dmg;
    vis.anim?.inner?.traverse(o => {
      if (!o.isMesh || !o.material) return;
      if (dmg) { o.userData.origMat ??= o.material; const m = o.material.clone(); m.color?.multiplyScalar(0.38); if (m.emissive) m.emissive.setHex(0); o.material = m; }
      else if (o.userData.origMat) { o.material = o.userData.origMat; delete o.userData.origMat; }
    });
  }

  // ── the dragon ──
  function makeDragon() {
    if (hasModel('dragon')) {
      const inst = instanceModel('dragon', (slot, c, ms) => mat(c, { smooth: ms.smooth, basic: slot === 'eye' }));
      const N = inst.nodes, find = n => N[n] || N['anim_' + n] || null;
      const mouth = inst.points.find(p => p.name === 'mouth' || p.name === 'pt_mouth');
      inst.group.scale.setScalar(1.3);
      return { g: inst.group, wingL: find('wingL'), wingR: find('wingR'), jaw: find('jaw'), tail: find('tail'), neck: find('neck'), mouth: mouth?.obj || null, base: 1.3 };
    }
    // a stand-in until the Blender dragon is exported
    const g = new THREE.Group(), red = mat(0xb8322a), dark = mat(0x5a1a14);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.6, 4, 8).rotateX(Math.PI / 2), red); body.position.y = 0; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.6), red); head.position.set(0, 0.25, 1.2); g.add(head);
    const wing = s => { const p = new THREE.Group(); const m = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 3).rotateZ(-s * Math.PI / 2), dark); m.position.x = s * 1.1; m.scale.y = 0.15; p.add(m); p.position.x = s * 0.25; g.add(p); return p; };
    return { g, wingL: wing(-1), wingR: wing(1), jaw: null, tail: null, mouth: head };
  }
  const breath = [];
  function updateDragon(dt, t) {
    const e = sim.s.events.list.find(o => o.type === 'dragon');
    if (e && !dragon) { const d = makeDragon(); view.objects.add(d.g); dragon = { ...d, e, ang: 0, pos: new THREE.Vector3(), leaving: 0, lastHit: 0 }; }
    if (!dragon) return;
    const D = dragon, c = CENTERS[D.e.sid], cx = toWorld(c.x), cz = toWorld(c.z);
    if (!e) D.leaving += dt;
    if (D.leaving > 5) { view.objects.remove(D.g); dragon = null; return; }
    D.ang += dt * 0.55;
    let x = cx + Math.cos(D.ang) * 7, z = cz + Math.sin(D.ang) * 7, y = 5.5 + Math.sin(t * 0.8) * 0.6;
    const sw = e?.data.swoop, sb = sw && sim.s.time - sw.at < 3 ? sim.bById.get(sw.bid) : null;
    if (sb) { const bc = sim.bCenter(sb), k = Math.sin(Math.min(1, (sim.s.time - sw.at) / 3) * Math.PI); x += (bc.x - x) * k * 0.8; z += (bc.z - z) * k * 0.8; y -= k * 2.2; }
    if (D.leaving) { x += Math.cos(D.ang) * D.leaving * 9; z += Math.sin(D.ang) * D.leaving * 9; y += D.leaving * 3; }
    const prev = D.pos.clone(); D.pos.set(x, y, z); D.g.position.copy(D.pos);
    if (prev.lengthSq()) { const dir = D.pos.clone().sub(prev); if (dir.lengthSq() > 1e-6) D.g.rotation.y = Math.atan2(dir.x, dir.z); D.g.rotation.z = -0.25; }
    const flap = Math.sin(t * 6) * 0.55;
    if (D.wingL) D.wingL.rotation.z = -flap; if (D.wingR) D.wingR.rotation.z = flap;   // +z raises the right wing
    if (D.neck) D.neck.rotation.x = sb ? 0.25 : -0.1 + Math.sin(t * 1.3) * 0.08;
    if (D.tail) D.tail.rotation.y = Math.sin(t * 2) * 0.3;
    if (D.jaw) D.jaw.rotation.x = sb ? 0.5 : 0.05;
    // fire breath during a swoop
    if (sb && Math.random() < dt * 30) {
      const from = new THREE.Vector3(); (D.mouth || D.g).getWorldPosition(from);
      const bc = sim.bCenter(sb), to = new THREE.Vector3(bc.x + (Math.random() - 0.5), 0.6, bc.z + (Math.random() - 0.5));
      const p = sprite(Math.random() < 0.5 ? 0xff7a1a : 0xffd34a, 0.7); p.position.copy(from); view.fx.add(p); breath.push({ p, from, to, t: 0 });
    }
    // arrows and bolts flash on the dragon when it's hit
    if (e?.data.hitAt && e.data.hitAt !== D.lastHit) { D.lastHit = e.data.hitAt; D.flash = 0.25; }
    const base = D.base || 1;
    if (D.flash > 0) { D.flash -= dt; D.g.scale.setScalar(base * (1 + D.flash * 0.6)); } else D.g.scale.setScalar(base);
  }

  // ── wisps for restless spirits ──
  function updateWisps(dt, t) {
    const haunt = sim.s.events.list.find(e => e.type === 'spirits'), want = haunt ? 12 : 0, k = Math.min(1, (game.night || 0) * 1.5);
    while (wisps.length < want) { const s = sprite(0xa8d0ff, 1.4, true, 0); s.add(sprite(0xffffff, 0.35, true, 1)); s.userData = { a: Math.random() * 6.28, r: 2 + Math.random() * 8, h: 0.6 + Math.random() * 1.4, sp: 0.15 + Math.random() * 0.25 }; view.fx.add(s); wisps.push(s); }
    while (wisps.length > want) view.fx.remove(wisps.pop());
    if (!haunt) return;
    const c = CENTERS[haunt.sid], cx = toWorld(c.x), cz = toWorld(c.z);
    for (const s of wisps) {
      const u = s.userData; u.a += dt * u.sp;
      s.position.set(cx + Math.cos(u.a) * u.r, u.h + Math.sin(t * 1.5 + u.a * 3) * 0.3, cz + Math.sin(u.a * 1.3) * u.r);
      s.material.opacity = k * (0.8 + Math.sin(t * 3 + u.r) * 0.2); s.children[0].material.opacity = k;
    }
  }

  // ── a sickly glow over feverish villagers ──
  function updateSick() {
    const now = sim.s.time;
    for (const v of sim.s.villagers) {
      const m = game.vvis.get(v.id); if (!m) continue;
      const sick = v.sick > now;
      let sp = sickMarks.get(v.id);
      if (sick && !sp) { sp = sprite(0x9ee86a, 0.35, true, 0.8); sp.position.y = 1.15; m.group.add(sp); sickMarks.set(v.id, sp); }
      if (!sick && sp) { sp.parent?.remove(sp); sickMarks.delete(v.id); }
    }
  }

  sim.on('fire', b => { if (b.fire) addFire(b); else removeFire(b.id); const vis = game.bvis.get(b.id); if (vis) applyDamage(vis); });
  sim.on('quake', () => { shake = 2.6; });
  sim.on('damaged', b => { const vis = game.bvis.get(b.id); if (vis) applyDamage(vis); });

  let slow = 0;
  return {
    update(dt, t) {
      // fires flicker and smoke rises
      for (const [id, f] of fires) {
        const b = sim.bById.get(id);
        if (!b?.fire) { removeFire(id); continue; }
        if (game.bvis.get(id) !== f.vis) { removeFire(id); addFire(b); continue; }   // the building was rebuilt
        const h = 1.1 + b.fire.heat * 1.3;
        for (const fl of f.flames) { const k = 0.8 + Math.sin(t * 12 + fl.userData.ph) * 0.2; fl.scale.set(h * k, h * (1 + Math.sin(t * 9 + fl.userData.ph) * 0.25), h * k); }
        f.halo.material.opacity = 0.45 + Math.sin(t * 7) * 0.15;
        for (const p of f.smoke) { const u = (t * 0.35 + p.userData.ph) % 1; p.position.set(Math.sin(u * 6 + p.userData.ph * 9) * 0.4, f.top + u * 3.2, Math.cos(u * 5) * 0.3); p.scale.setScalar(0.8 + u * 2); p.material.opacity = 0.45 * (1 - u); }
      }
      // breath particles
      for (let i = breath.length - 1; i >= 0; i--) { const b = breath[i]; b.t += dt * 2.2; b.p.position.lerpVectors(b.from, b.to, Math.min(1, b.t)); b.p.scale.setScalar(0.5 + b.t * 1.4); b.p.material.opacity = 1 - b.t; if (b.t >= 1) { view.fx.remove(b.p); breath.splice(i, 1); } }
      updateDragon(dt, t);
      updateWisps(dt, t);
      // the ground shakes
      const rig = view.rig;
      rig.tx -= shook.x; rig.tz -= shook.z; shook = { x: 0, z: 0 };
      if (shake > 0) { shake -= dt; const a = Math.min(1, shake) * 0.12; shook = { x: Math.sin(t * 47) * a, z: Math.cos(t * 39) * a }; rig.tx += shook.x; rig.tz += shook.z; }
      if ((slow += dt) > 0.5) { slow = 0; updateSick(); for (const vis of game.bvis.values()) { applyDamage(vis); if (vis.b.fire && !fires.has(vis.b.id)) addFire(vis.b); } }
    },
  };
}
