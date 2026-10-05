// The 3D side of the RPG layer: health bars over hurt villagers and beasts, floating
// damage numbers, knocked-out poses, spell flashes, and stand-in models for the Forge and
// Guild Hall (Blender models of the same name win when they exist).
import * as THREE from '../vendor/three.module.min.js';
import { registerBuilder, box, cyl, cone, ball, roof, mat, C, Smoke } from './models.js';
import { maxHp } from './rpg.js';

// ── stand-in buildings ──
registerBuilder('forge', (g, a) => {
  // an open-sided smithy: stone hearth with a chimney, a lean-to roof on posts, an anvil out front
  g.add(box(1.5, 0.12, 1.3, C.stone2, 0, 0, -0.05));
  g.add(box(0.7, 0.62, 0.6, C.stone, -0.35, 0.12, -0.3));
  g.add(box(0.32, 1.1, 0.32, C.stone2, -0.5, 0.74, -0.42)); a.smoke = new Smoke(g, -0.5, 1.95, -0.42, 0xd9d3cc);
  const glow = box(0.4, 0.18, 0.06, 0xff8a1e, -0.3, 0.32, 0.005); glow.material = mat(0xff8a1e, { basic: true }); g.add(glow);
  for (const [x, z] of [[0.62, 0.5], [0.62, -0.5], [-0.62, 0.5]]) g.add(box(0.08, 1.05, 0.08, C.timber, x, 0.12, z));
  const r = roof(1.6, 0.4, 1.4, 0x6b5a4a, 0, 1.15, -0.05); g.add(r);
  g.add(box(0.3, 0.1, 0.16, 0x4a4f55, 0.3, 0.42, 0.25)); g.add(box(0.14, 0.3, 0.12, 0x5a6066, 0.3, 0.12, 0.25)); g.add(box(0.12, 0.05, 0.06, 0x4a4f55, 0.5, 0.47, 0.25));
  g.add(cyl(0.14, 0.14, 0.22, 10, 0x6b4428, 0.62, 0.12, 0.05)); g.add(box(0.03, 0.4, 0.03, C.darkwood, 0.62, 0.3, 0.05));
  for (let k = 0; k < 3; k++) g.add(box(0.28, 0.06, 0.1, 0xaeb6bf, 0.3 + (k % 2) * 0.05, 0.12 + k * 0.06, -0.45));
}, { pad: true });
registerBuilder('guild', (g, a) => {
  // a long timbered hall with a blue banner, a quest board and a weapon rack
  g.add(box(2.3, 0.95, 1.2, C.wall, 0, 0, -0.15));
  for (const x of [-1.1, -0.4, 0.4, 1.1]) g.add(box(0.07, 0.95, 0.06, C.timber, x, 0, 0.46));
  g.add(box(2.36, 0.08, 0.06, C.timber, 0, 0.6, 0.46));
  g.add(roof(2.6, 0.75, 1.55, 0x3f6fae, 0, 0.95, -0.15));
  g.add(box(0.36, 0.52, 0.05, C.door, 0, 0, 0.47)); g.add(box(0.44, 0.06, 0.08, C.plank, 0, 0.52, 0.48));
  for (const x of [-0.75, 0.75]) g.add(box(0.26, 0.24, 0.04, C.window, x, 0.4, 0.47));
  const pole = box(0.05, 1.3, 0.05, C.darkwood, -1.05, 0.95, 0.42); g.add(pole);
  const flag = box(0.32, 0.5, 0.02, 0x4f8fd9, -0.88, 1.6, 0.42); g.add(flag); a.flagMesh = flag;
  g.add(ball(0.06, 0xffd54f, -0.88, 1.85, 0.44));
  // quest board
  g.add(box(0.05, 0.6, 0.05, C.timber, 0.7, 0, 0.75)); g.add(box(0.05, 0.6, 0.05, C.timber, 1.1, 0, 0.75));
  g.add(box(0.5, 0.36, 0.04, C.plank, 0.9, 0.32, 0.75));
  for (const [x, y, c] of [[0.8, 0.5, 0xfbf6ea], [0.98, 0.46, 0xf6e6b4], [0.9, 0.38, 0xfbf6ea]]) g.add(box(0.12, 0.14, 0.01, c, x, y, 0.775));
  // weapon rack
  g.add(box(0.5, 0.05, 0.06, C.timber, -0.75, 0.42, 0.72)); g.add(box(0.05, 0.45, 0.05, C.timber, -0.98, 0, 0.72)); g.add(box(0.05, 0.45, 0.05, C.timber, -0.52, 0, 0.72));
  for (const x of [-0.85, -0.72, -0.6]) { g.add(box(0.025, 0.55, 0.025, 0xb8bcc0, x, 0.05, 0.75)); }
  g.add(cyl(0.16, 0.16, 0.04, 10, 0xc9473d, -0.35, 0.25, 0.72).rotateX(Math.PI / 2));
}, { pad: true });

// ── per-frame: health bars, knocked-out poses, hover ──
const tmp = new THREE.Vector3();
let hoverV = null, ptr = null, hoverT = 0;
export function hookRpg(game) {
  const sim = game.sim, ui = game.ui, view = game.view;
  sim.on('dmg', (x, z, text, cls) => {
    const r = view.rig;
    if (Math.hypot(x - r.tx, z - r.tz) > 30 + r.dist * 0.35) return;
    const p = view.project(tmp.set(x + (Math.random() - 0.5) * 0.3, sim.world.heightAt(x, z) + 1.25, z));
    if (p.vis) ui.float(p.x, p.y, text, null, 'dmg ' + cls);
  });
  sim.on('spellHit', (id, x, z) => spellHit(game, id, x, z));
  view.canvas.addEventListener('pointermove', e => { ptr = e.pointerType === 'mouse' ? [e.clientX, e.clientY] : null; });
  view.canvas.addEventListener('pointerleave', () => { ptr = null; hoverV = null; });
}
export function rpgFrame(game, dt) {
  const sim = game.sim, view = game.view, s = sim.s, seen = new Set();
  // which villager is under the mouse (screen-space, a few times a second)
  if ((hoverT -= dt) <= 0) {
    hoverT = 0.12; hoverV = null;
    if (ptr) {
      let bd = 22;
      for (const v of s.villagers) {
        if (v.indoors) continue;
        const p = view.project(tmp.set(v.x, sim.world.heightAt(v.x, v.z) + 0.35, v.z));
        const d = Math.hypot(p.x - ptr[0], p.y - ptr[1]);
        if (p.vis && d < bd) { bd = d; hoverV = v; }
      }
    }
  }
  const sel = game.selected?.kind === 'v' ? game.selected.v : null;
  const host = document.getElementById('bars');
  const bar = (key, x, y, k, beast) => {
    seen.add(key);
    let el = game.hbars?.get(key);
    if (!el) { el = document.createElement('div'); el.className = 'hbar' + (beast ? ' beast' : ''); el.innerHTML = '<i></i>'; host.appendChild(el); (game.hbars || (game.hbars = new Map())).set(key, el); }
    const cls = 'hbar' + (beast ? ' beast' : '') + (beast ? '' : k > 0.6 ? '' : k > 0.3 ? ' mid' : ' low');
    if (el.className !== cls) el.className = cls;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    const w = Math.max(0, Math.round(k * 100)) + '%';
    if (el.firstChild.style.width !== w) el.firstChild.style.width = w;
  };
  for (const v of s.villagers) {
    const m = game.vvis.get(v.id);
    if (!m) continue;
    // knocked out: lie flat where they fell
    if (v.koLying) { m.body.rotation.set(-Math.PI / 2, 0, 0); m.body.position.set(0, 0.1, -0.25); }
    if (v.indoors || !m.group.visible) continue;
    const mx = maxHp(v), k = (v.hp ?? mx) / mx;
    if (!(k < 0.995 || v === hoverV || v === sel)) continue;
    const gp = m.group.position, p = view.project(tmp.set(gp.x, gp.y + (v.koLying ? 0.55 : sel === v ? 0.95 : 1.12), gp.z));
    if (!p.vis) continue;
    bar('v' + v.id, p.x, p.y - (sel === v && !v.koLying ? 26 : 0), k, false);   // sits above the name tag when selected
  }
  for (const b of s.beasts) {
    if (b.state === 'flee' || !b.maxHp) continue;
    if (b.hp >= b.maxHp && b.state !== 'fight') continue;
    const m = game.beasts.get(b.id); if (!m) continue;
    const gp = m.group.position, p = view.project(tmp.set(gp.x, gp.y + 0.95, gp.z));
    if (!p.vis) continue;
    bar('b' + b.id, p.x, p.y, Math.max(0, b.hp) / b.maxHp, true);
    // Faerie Fire: a violet glow on every prowling beast
    if (!m.faerie && (s.rpg?.buffs?.faerie || 0) > s.time) {
      m.faerie = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: 0xc79af2, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.faerie.position.y = 0.35; m.group.add(m.faerie);
    }
  }
  if (game.hbars) for (const [key, el] of game.hbars) if (!seen.has(key)) { el.remove(); game.hbars.delete(key); }
}

// a burst where Fireball lands or Lightning Bolt strikes
function spellHit(game, id, x, z) {
  const view = game.view, y = game.sim.world.heightAt(x, z);
  if (id === 'fireball') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x, y + 0.4, z); view.fx.add(m);
    let t = 0;
    game.effects.push(dt => { t += dt; m.scale.setScalar(1 + t * 6); m.material.opacity = Math.max(0, 0.9 - t * 1.6); if (t > 0.6) { view.fx.remove(m); return false; } return true; });
  } else {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 9, 5), new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x, y + 4.5, z); view.fx.add(m);
    let t = 0;
    game.effects.push(dt => { t += dt; m.material.opacity = Math.max(0, 1 - t * 3) * (Math.sin(t * 60) > -0.3 ? 1 : 0.3); if (t > 0.35) { view.fx.remove(m); return false; } return true; });
  }
}
