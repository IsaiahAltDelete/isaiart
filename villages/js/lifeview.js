// What wishes.js, celebrations.js and visitors.js look like: cats and dogs trotting
// after their owners (and sitting by the door while they're indoors), visitors walking
// up the road, petals over a wedding, fireworks for a new rank, the crest banner by
// the campfire, and music notes while a bard plays.
import * as THREE from '../vendor/three.module.min.js';
import { hasModel, instanceModel } from './blender.js';
import { mat, villagerModel } from './models.js';
import { idx, toTile, inMap } from './world.js';
import { mainSid } from './celebrations.js';
import { VISITORS } from './visitors.js';
import { bubbleTexture } from './view.js';

const FUR = { cat: [0xe8954a, 0x8a8a92, 0x3a3438, 0xe8d6b0, 0x9a6a40, 0xf4f0e8], dog: [0xb98050, 0x3a2e28, 0xe8d6b0, 0x8a5a3a, 0xd8a060, 0x6a6a72] };
const BANNER = [null, { c: 0x3f6fb0, s: 0.8 }, { c: 0xb8322a, s: 0.95 }, { c: 0x6a3fa0, s: 1.1 }];

let soft = null;
function softTex() {
  if (soft) return soft;
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.6, 'rgba(255,255,255,.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.beginPath(); g.ellipse(16, 16, 15, 9, 0.5, 0, Math.PI * 2); g.fill();
  return (soft = new THREE.CanvasTexture(cv));
}
let note = null;
function noteTex() {
  if (note) return note;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.font = '800 50px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = '#fff8e8'; g.strokeText('♪', 32, 34); g.fillStyle = '#7a3f98'; g.fillText('♪', 32, 34);
  note = new THREE.CanvasTexture(cv); note.colorSpace = THREE.SRGBColorSpace;
  return note;
}

export function installLifeVisuals(game) {
  const sim = game.sim, view = game.view, pets = new Map(), W = sim.world;
  let visit = null, banner = null, bannerRank = 0, bannerT = 0, petals = [], notes = [], shows = 0;

  // ── pets ──
  function makePet(p) {
    const fur = FUR[p.kind][Math.floor((p.tint || 0) * FUR[p.kind].length) % FUR[p.kind].length];
    let g, N = {};
    if (hasModel(p.kind)) {
      const inst = instanceModel(p.kind, (slot, c, ms) => mat(slot === 'fur' ? fur : c, { smooth: ms.smooth, basic: slot === 'eye' || slot === 'shine' }));
      g = inst.group; N = inst.nodes;
    } else {
      g = new THREE.Group(); const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), mat(fur)); b.position.y = 0.16; g.add(b); N.body = b;
    }
    g.scale.setScalar(p.kind === 'dog' ? 1.05 : 0.95);
    view.objects.add(g);
    const v = sim.vById.get(p.owner);
    const o = { g, N, x: v?.x ?? p.x, z: v?.z ?? p.z, rot: 0, walk: 0, side: (p.id % 2 ? 1 : -1), ph: p.id * 1.7 };
    g.position.set(o.x, W.heightAt(o.x, o.z), o.z);
    pets.set(p.id, o);
    return o;
  }
  function pose(o, sit, moving, t, kind) {
    const N = o.N, b = N.body; if (!b) return;
    const legs = [N.leg0, N.leg1, N.leg2, N.leg3];
    if (sit) {
      b.rotation.x = -0.6; b.position.set(0, kind === 'dog' ? 0.012 : -0.007, 0.041);
      if (legs[0]) { legs[0].rotation.x = legs[1].rotation.x = 0.6; legs[2].rotation.x = legs[3].rotation.x = -1.0; }
      if (N.head) N.head.rotation.x = 0.45 + Math.sin(t * 0.7 + o.ph) * 0.05;
    } else {
      b.rotation.x = 0; b.position.set(0, moving ? Math.abs(Math.sin(o.walk)) * 0.025 : 0, 0);
      const s = moving ? Math.sin(o.walk) * 0.7 : 0;
      if (legs[0]) { legs[0].rotation.x = s; legs[3].rotation.x = s; legs[1].rotation.x = -s; legs[2].rotation.x = -s; }
      if (N.head) N.head.rotation.x = moving ? 0.05 : Math.sin(t * 0.9 + o.ph) * 0.08;
    }
    if (N.tail) N.tail.rotation.y = kind === 'dog' ? Math.sin(t * (sit ? 14 : 9) + o.ph) * 0.55 : Math.sin(t * 1.6 + o.ph) * 0.35;
  }
  function updatePets(dt, t) {
    const list = sim.s.pets || [], sp = Math.max(1, sim.s.speed || 0);
    for (const [id, o] of pets) if (!list.some(p => p.id === id)) { view.objects.remove(o.g); pets.delete(id); }
    for (const p of list) {
      const o = pets.get(p.id) || makePet(p), v = sim.vById.get(p.owner);
      o.g.visible = !!v && !v.quest;
      if (!o.g.visible) continue;
      // trot along just behind and beside the owner; sit when they stop or go indoors
      const back = v.moving ? 0.75 : 0.6, a = (v.face || 0) + Math.PI + o.side * (v.moving ? 0.5 : 0.9);
      const tx = v.x + Math.sin(a) * back, tz = v.z + Math.cos(a) * back;
      let dx = tx - o.x, dz = tz - o.z; const d = Math.hypot(dx, dz);
      if (d > 14) { o.x = tx; o.z = tz; }
      const moving = d > 0.12;
      if (moving) {
        const step = Math.min(d, Math.min(4.2, 1.2 + d * 2.4) * dt * sp);
        o.x += dx / d * step; o.z += dz / d * step;
        o.rot = Math.atan2(dx, dz); o.walk += dt * 16 * sp;
      } else if (!v.moving && !v.indoors) {
        // settle facing the owner
        const turn = ((Math.atan2(v.x - o.x, v.z - o.z) - o.rot + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        o.rot += turn * Math.min(1, dt * 3);
      }
      o.g.position.set(o.x, W.heightAt(o.x, o.z), o.z);
      o.g.rotation.y = o.rot;
      pose(o, !moving, moving, t, p.kind);
    }
  }

  // ── visitors at the gate ──
  function makeVisit(c) {
    const figs = c.members.map((m, i) => {
      const fake = { id: -1000 - c.id * 10 - i, race: c.race, gender: m.gender, age: m.age, job: m.age < 16 ? 'child' : 'idle', ...m.look };
      const vm = villagerModel(fake); view.objects.add(vm.group);
      return { m: vm, off: [(i % 2 ? 0.45 : -0.45) * (i > 0 ? 1 : 0), -Math.ceil(i / 2) * 0.55], walk: 0 };
    });
    // a bubble over the leader while they wait for an answer, so they stand out from the villagers
    const bub = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture(VISITORS[c.kind].icon), transparent: true, depthWrite: false, sizeAttenuation: false }));
    bub.userData.px = 34; bub.position.y = 1.15; bub.renderOrder = 5; figs[0].m.group.add(bub); game.screenSprites.add(bub);
    return { c, figs, bub };
  }
  function dropVisit() { if (visit) { for (const f of visit.figs) view.objects.remove(f.m.group); game.screenSprites.delete(visit.bub); visit = null; } }
  function updateVisit(dt, t) {
    const c = sim.s.visitors?.cur;
    if (!c) { dropVisit(); return; }
    if (visit?.c.id !== c.id) { dropVisit(); visit = makeVisit(c); }
    const p = sim.visitorPos(c); if (!p) return;
    const performing = c.answered === 'yes' && c.show > sim.s.time && !c.leaving;
    visit.bub.visible = !c.answered && !c.leaving;
    // heading: along the path (backwards when leaving), or toward the fire once arrived
    const ahead = sim.visitorPos({ ...c, made: c.made - 0.4, leaving: c.leaving ? c.leaving - 0.4 : 0 }) || p;
    const fire = sim.s.buildings.find(b => b.type === 'campfire' && b.sid === c.sid), fc = fire && sim.bCenter(fire);
    const yaw = p.moving ? Math.atan2(ahead.x - p.x, ahead.z - p.z) : fc ? Math.atan2(fc.x - p.x, fc.z - p.z) : 0;
    visit.figs.forEach((f, i) => {
      const ox = Math.cos(yaw) * f.off[0] + Math.sin(yaw) * f.off[1], oz = -Math.sin(yaw) * f.off[0] + Math.cos(yaw) * f.off[1];
      const x = p.x + ox, z = p.z + oz, m = f.m;
      m.group.position.set(x, W.heightAt(x, z), z); m.group.rotation.y = yaw;
      m.hipL.rotation.x = m.hipR.rotation.x = 0; m.armL.rotation.set(0, 0, 0); m.armR.rotation.set(0, 0, 0); m.body.position.y = 0; m.body.rotation.set(0, 0, 0);
      if (p.moving) {
        f.walk += dt * 10 * Math.max(1, sim.s.speed || 0); const s = Math.sin(f.walk + i);
        m.hipL.rotation.x = s * 0.7; m.hipR.rotation.x = -s * 0.7; m.armL.rotation.x = -s * 0.5; m.armR.rotation.x = s * 0.5;
        m.body.position.y = Math.abs(Math.cos(f.walk + i)) * 0.03;
      } else if (performing && c.kind === 'bard') {
        // strumming and swaying
        m.armR.rotation.x = -0.9 + Math.sin(t * 9) * 0.25; m.armL.rotation.x = -1.1; m.body.rotation.z = Math.sin(t * 2) * 0.08;
      } else if (performing && c.kind === 'scholar') {
        m.armR.rotation.x = -1.2 + Math.sin(t * 2.5) * 0.5; m.armR.rotation.z = 0.3;   // pointing at the sky, lecturing
      } else {
        m.armR.rotation.z = Math.sin(t * 3 + i) > 0.6 ? 0.9 + Math.sin(t * 10) * 0.3 : 0;  // a wave now and then
      }
    });
    // music notes while the bard plays
    if (performing && c.kind === 'bard' && Math.random() < dt * 1.6) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex(), transparent: true, depthWrite: false }));
      s.scale.setScalar(0.26); s.position.set(p.x + (Math.random() - 0.5) * 0.5, W.heightAt(p.x, p.z) + 1.2, p.z); view.fx.add(s);
      notes.push({ s, t: 0, dx: (Math.random() - 0.5) * 0.6 });
    }
  }

  // ── wedding petals ──
  function updatePetals(dt) {
    for (const w of sim.s.weddings || []) {
      if (!w.on || Math.random() > dt * 14) continue;
      const fire = sim.s.buildings.find(b => b.type === 'campfire' && b.sid === w.sid); if (!fire) continue;
      const c = sim.bCenter(fire), a = Math.random() * Math.PI * 2, r = Math.random() * 2.6, x = c.x + Math.cos(a) * r, z = c.z + 2.1 + Math.sin(a) * r;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: [0xffb6cc, 0xffffff, 0xffd6e4, 0xfff0a0][(Math.random() * 4) | 0], transparent: true, depthWrite: false }));
      s.scale.set(0.16, 0.11, 1); s.position.set(x, W.heightAt(x, z) + 2.6 + Math.random(), z); view.fx.add(s);
      petals.push({ s, t: 0, ph: Math.random() * 6, y0: W.heightAt(x, z) });
    }
    for (let i = petals.length - 1; i >= 0; i--) {
      const p = petals[i]; p.t += dt; p.s.position.y -= dt * 0.55; p.s.position.x += Math.sin(p.t * 3 + p.ph) * dt * 0.4;
      p.s.material.rotation = Math.sin(p.t * 4 + p.ph);
      if (p.s.position.y < p.y0 + 0.05) p.s.material.opacity -= dt * 1.5;
      if (p.s.material.opacity <= 0 || p.t > 9) { view.fx.remove(p.s); petals.splice(i, 1); }
    }
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i]; n.t += dt; n.s.position.y += dt * 0.5; n.s.position.x += n.dx * dt; n.s.material.opacity = Math.max(0, 1 - n.t / 2.2);
      if (n.t > 2.2) { view.fx.remove(n.s); notes.splice(i, 1); }
    }
  }

  // ── the crest banner by the campfire ──
  function updateBanner(dt, t) {
    const rank = sim.s.rank || 0;
    if ((bannerT -= dt) <= 0 || rank !== bannerRank) {
      bannerT = 10;
      if (rank !== bannerRank && banner) { view.objects.remove(banner.g); banner = null; }
      bannerRank = rank;
      const fire = rank && sim.s.buildings.find(b => b.type === 'campfire' && b.sid === mainSid(sim));
      if (fire && hasModel('crestbanner')) {
        const c = sim.bCenter(fire), free = (x, z) => { const tx = toTile(x), tz = toTile(z), i = idx(tx, tz); return inMap(tx, tz) && W.occ[i] < 0 && W.passable(i) && !W.road?.[i]; };
        // a free tile beside the campfire (moves if something gets built there)
        const spots = [[2.4, -1.4], [-2.4, -1.4], [2.4, 1.4], [-2.4, 1.4], [0, -2.6], [3.2, 0], [-3.2, 0]];
        const at = banner && free(banner.x, banner.z) ? [banner.x - c.x, banner.z - c.z] : spots.find(([x, z]) => free(c.x + x, c.z + z));
        if (at && (!banner || banner.x !== c.x + at[0] || banner.z !== c.z + at[1])) {
          if (banner) view.objects.remove(banner.g);
          const B = BANNER[Math.min(3, rank)];
          const inst = instanceModel('crestbanner', (slot, col, ms) => mat(slot === 'banner' ? B.c : col, { smooth: ms.smooth }));
          const x = c.x + at[0], z = c.z + at[1];
          inst.group.position.set(x, W.heightAt(x, z), z); inst.group.scale.setScalar(B.s); inst.group.rotation.y = Math.atan2(c.x - x, c.z - z) + Math.PI / 2;
          view.objects.add(inst.group);
          banner = { g: inst.group, flag: inst.nodes.anim_flagMesh || inst.nodes.flagMesh, x, z };
        }
      }
    }
    if (banner?.flag) banner.flag.rotation.y = Math.sin(t * 2.4) * 0.3;
  }

  // ── a new rank: fireworks over the square ──
  function celebrate() {
    const fire = sim.s.buildings.find(b => b.type === 'campfire' && b.sid === mainSid(sim)); if (!fire) return;
    const c = sim.bCenter(fire), r = view.rig, near = Math.hypot(c.x - r.tx, c.z - r.tz) < 30;
    for (let k = 0; k < 9; k++) setTimeout(() => game.firework(c.x, c.z, near && k % 3 === 0), k * 550 + Math.random() * 300);
    shows++;
  }

  return {
    celebrate,
    update(dt, t) { updatePets(dt, t); updateVisit(dt, t); updatePetals(dt); updateBanner(dt, t); },
    petMesh: id => pets.get(id)?.g || null,
  };
}
