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
// a teardrop flame: hot white-yellow core, orange body, soft edges
let flame = null;
function flameTex() {
  if (flame) return flame;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 96;
  const g = cv.getContext('2d');
  g.beginPath(); g.moveTo(32, 4); g.bezierCurveTo(46, 30, 60, 52, 56, 70); g.bezierCurveTo(52, 90, 12, 90, 8, 70); g.bezierCurveTo(4, 52, 18, 30, 32, 4); g.closePath();
  const grd = g.createRadialGradient(32, 68, 2, 32, 60, 40);
  grd.addColorStop(0, 'rgba(255,255,230,1)'); grd.addColorStop(0.35, 'rgba(255,220,90,1)'); grd.addColorStop(0.7, 'rgba(255,140,40,.9)'); grd.addColorStop(1, 'rgba(230,70,20,0)');
  g.fillStyle = grd; g.fill();
  flame = new THREE.CanvasTexture(cv); flame.colorSpace = THREE.SRGBColorSpace;
  return flame;
}
// a water droplet: opaque, with a white highlight and a darker edge, so it reads as water and not light
let drop = null;
function dropTex() {
  if (drop) return drop;
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  g.beginPath(); g.moveTo(16, 3); g.bezierCurveTo(22, 12, 27, 17, 26, 21); g.bezierCurveTo(25, 28, 7, 28, 6, 21); g.bezierCurveTo(5, 17, 10, 12, 16, 3); g.closePath();
  const grd = g.createLinearGradient(8, 6, 24, 28); grd.addColorStop(0, '#bfe6ff'); grd.addColorStop(0.6, '#4aa3f0'); grd.addColorStop(1, '#2a6fc0');
  g.fillStyle = grd; g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(31,90,160,.45)'; g.stroke();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.ellipse(12.5, 18, 2.2, 3.4, -0.4, 0, Math.PI * 2); g.fill();
  drop = new THREE.CanvasTexture(cv); drop.colorSpace = THREE.SRGBColorSpace;
  return drop;
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
    // flickering flame particles: they rise, shrink and cool from yellow to red
    for (let k = 0; k < 22; k++) {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex(), transparent: true, depthWrite: false, opacity: 0.95 }));
      const a = k * 2.399, r = 0.15 + (k % 5) * 0.12;
      f.userData = { ph: k / 22, ox: Math.cos(a) * r, oz: Math.sin(a) * r, sp: 0.9 + (k % 3) * 0.25 };
      g.add(f); flames.push(f);
    }
    const halo = sprite(0xff8a30, 4.5, true, 0.7); halo.position.y = top * 0.7; g.add(halo);
    const base = sprite(0xb8301a, 2.2, false, 0.75); base.position.y = top * 0.5; g.add(base);
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
  const breath = [], splash = [], puffs = [];
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
    if (sb && Math.random() < dt * 70) {
      const from = new THREE.Vector3(); (D.mouth || D.g).getWorldPosition(from);
      const bc = sim.bCenter(sb), to = new THREE.Vector3(bc.x + (Math.random() - 0.5), 0.6, bc.z + (Math.random() - 0.5));
      const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex(), transparent: true, depthWrite: false }));
      // the round end leads and the tip trails back towards the jaw, along the flight on screen
      const sa = from.clone().project(view.camera), sz = to.clone().project(view.camera);
      p.material.rotation = Math.atan2(sz.x - sa.x, -(sz.y - sa.y) * (innerHeight / innerWidth));
      p.scale.set(0.22, 0.36, 1); p.position.copy(from); view.fx.add(p); breath.push({ p, from, to, t: 0, flame: true });
      if (Math.random() < 0.2) { const gl = sprite(0xff6a1a, 0.5, true, 0.25); gl.position.copy(from); view.fx.add(gl); breath.push({ p: gl, from, to, t: 0, glow: true }); }
    }
    // arrows and bolts flash on the dragon when it's hit
    if (e?.data.hitAt && e.data.hitAt !== D.lastHit) { D.lastHit = e.data.hitAt; D.flash = 0.25; }
    const base = D.base || 1;
    if (D.flash > 0) { D.flash -= dt; D.g.scale.setScalar(base * (1 + D.flash * 0.6)); } else D.g.scale.setScalar(base);
  }

  // ── wisps for restless spirits ──
  function updateWisps(dt, t) {
    const haunt = sim.s.events.list.find(e => e.type === 'spirits'), want = haunt ? 12 : 0, k = Math.min(1, (game.night || 0) * 1.5);
    while (wisps.length < want) { const s = sprite(0x3fe0b8, 2.0, true, 0); s.add(sprite(0xa8fff0, 0.32, true, 1)); s.userData = { a: Math.random() * 6.28, r: 2 + Math.random() * 8, h: 0.6 + Math.random() * 1.4, sp: 0.15 + Math.random() * 0.25 }; view.fx.add(s); wisps.push(s); }
    while (wisps.length > want) view.fx.remove(wisps.pop());
    if (!haunt) return;
    const c = CENTERS[haunt.sid], cx = toWorld(c.x), cz = toWorld(c.z);
    const folk = sim.s.villagers.filter(v => v.home === haunt.sid && !v.indoors);
    wisps.forEach((s, i) => {
      const u = s.userData; u.a += dt * u.sp;
      // half of them haunt whoever is still out; the rest drift round the campfire
      const v = i % 2 && folk.length ? folk[(i * 7) % folk.length] : null, ax = v ? v.x : cx, az = v ? v.z : cz, r = v ? 0.9 : u.r;
      s.position.set(ax + Math.cos(u.a * (v ? 2.4 : 1)) * r, u.h + 0.4 + Math.sin(t * 1.5 + u.a * 3) * 0.3, az + Math.sin(u.a * (v ? 2.4 : 1.3)) * r);
      s.material.opacity = k * (0.65 + Math.sin(t * 3 + u.r) * 0.25); s.children[0].material.opacity = k * 0.7;
    });
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
        const h = 0.7 + b.fire.heat * 1.1, col = new THREE.Color();
        for (const fl of f.flames) {
          const u = fl.userData, p = (t * u.sp + u.ph) % 1;
          fl.position.set(u.ox * (1 - p * 0.5) + Math.sin(t * 9 + u.ph * 20) * 0.05, f.top * 0.55 + p * 1.5 * h, u.oz * (1 - p * 0.5));
          const sc = (1.2 - p * 0.8) * h; fl.scale.set(sc * 0.42, sc * 1.15, 1);
          fl.material.color.copy(col.setHSL(0.11 - p * 0.09, 1, 0.75 - p * 0.2));
          fl.material.opacity = (1 - p) * 0.95;
        }
        f.halo.material.opacity = 0.45 + Math.sin(t * 7) * 0.15;
        for (const p of f.smoke) { const u = (t * 0.35 + p.userData.ph) % 1; p.position.set(Math.sin(u * 6 + p.userData.ph * 9) * 0.4, f.top + u * 3.2, Math.cos(u * 5) * 0.3); p.scale.setScalar(0.8 + u * 2); p.material.opacity = 0.45 * (1 - u); }
      }
      // splashes from the bucket chain
      for (const v of sim.s.villagers) {
        if (v.fireB == null || v.act?.anim !== 'bucket' || Math.random() > dt * 2.2) continue;
        const b = sim.bById.get(v.fireB), f = b && fires.get(b.id); if (!f) continue;
        const c = sim.bCenter(b), from = new THREE.Vector3(v.x, sim.world.heightAt(v.x, v.z) + 0.55, v.z), to = new THREE.Vector3(c.x + (Math.random() - 0.5), f.top * 0.7, c.z + (Math.random() - 0.5));
        for (let k = 0; k < 3; k++) {
          const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: dropTex(), transparent: true, depthWrite: false }));
          p.scale.setScalar(0.13 + Math.random() * 0.08); p.position.copy(from); view.fx.add(p);
          const spread = new THREE.Vector3((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25);
          splash.push({ p, from, to: to.clone().add(spread), t: -k * 0.09, lead: k === 0, arc: 0.45 + Math.random() * 0.35, s0: p.scale.x });
        }
      }
      for (let i = splash.length - 1; i >= 0; i--) {
        const w = splash[i]; w.t += dt * 1.6; const q = Math.max(0, Math.min(1, w.t));
        const prev = w.p.position.clone();
        w.p.position.lerpVectors(w.from, w.to, q); w.p.position.y += Math.sin(q * Math.PI) * (w.arc ?? 0.6);
        if (w.s0) {
          // turn the drop to trail along its flight (the tip points back), stretched a little by speed
          const a = prev.project(view.camera), b = w.p.position.clone().project(view.camera);
          if (b.distanceToSquared(a) > 1e-8) w.p.material.rotation = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
          w.p.visible = w.t >= 0; w.p.scale.set(w.s0 * 0.8, w.s0 * 1.3, 1); w.p.material.opacity = 1 - Math.max(0, q - 0.8) * 5;
        }
        if (w.t >= 1) {
          view.fx.remove(w.p); splash.splice(i, 1);
          if (w.lead) { const pf = sprite(0xffffff, 0.5, false, 0.85); pf.position.copy(w.to); view.fx.add(pf); puffs.push({ p: pf, t: 0 }); }
        }
      }
      // the "pssh" where water meets fire
      for (let i = puffs.length - 1; i >= 0; i--) { const f = puffs[i]; f.t += dt * 2.5; f.p.scale.setScalar(0.5 + f.t * 0.9); f.p.position.y += dt * 0.6; f.p.material.opacity = 0.85 * (1 - f.t); if (f.t >= 1) { view.fx.remove(f.p); puffs.splice(i, 1); } }
      // breath particles: yellow at the jaw to red at the roof; the glow fades before it reaches the walls
      for (let i = breath.length - 1; i >= 0; i--) { const b = breath[i]; b.t += dt * 1.8; b.p.position.lerpVectors(b.from, b.to, Math.min(1, b.t)); if (b.flame) { b.p.scale.set(0.22 + b.t * 0.3, 0.36 + b.t * 0.4, 1); b.p.material.color.setRGB(1, Math.max(0.28, 1 - b.t * 1.1), Math.max(0.08, 0.7 - b.t * 1.3)); b.p.material.opacity = b.t < 0.85 ? 1 : (1 - b.t) / 0.15; } else { b.p.scale.setScalar(0.5 + b.t * 1.2); b.p.material.opacity = 0.25 * Math.max(0, 1 - b.t * 2); }  if (b.t >= 1) { view.fx.remove(b.p); breath.splice(i, 1); } }
      updateDragon(dt, t);
      updateWisps(dt, t);
      // the ground shakes
      const rig = view.rig;
      rig.tx -= shook.x; rig.tz -= shook.z; shook = { x: 0, z: 0 };
      if (shake > 0) { shake -= dt; const a = Math.min(1, shake) * 0.12; shook = { x: Math.sin(t * 47) * a, z: Math.cos(t * 39) * a }; rig.tx += shook.x; rig.tz += shook.z; }
      if ((slow += dt) > 0.5) { slow = 0; for (const vis of game.bvis.values()) { applyDamage(vis); if (vis.b.fire && !fires.has(vis.b.id)) addFire(vis.b); } }
    },
  };
}
