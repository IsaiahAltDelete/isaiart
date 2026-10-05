// Hover (pre-selection) and selection highlights, plus the per-tile footprint
// shown while placing. Buildings get a rounded outline that hugs their
// footprint; villagers a small ring. Labels are DOM tags that follow the model.
import * as THREE from '../vendor/three.module.min.js';
import { defOf, footprint, lvlOf, workersOf, housingOf, isDecor } from './sim.js';
import { idx, inMap, toWorld } from './world.js';
import {HOME_TYPES,LODGING_TYPES} from './data.js';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function rrShape(W, D, R) {
  const s = new THREE.Shape(), x = -W / 2, y = -D / 2;
  R = Math.min(R, W / 2, D / 2);
  s.moveTo(x + R, y); s.lineTo(x + W - R, y); s.quadraticCurveTo(x + W, y, x + W, y + R);
  s.lineTo(x + W, y + D - R); s.quadraticCurveTo(x + W, y + D, x + W - R, y + D);
  s.lineTo(x + R, y + D); s.quadraticCurveTo(x, y + D, x, y + D - R);
  s.lineTo(x, y + R); s.quadraticCurveTo(x, y, x + R, y);
  return s;
}
// a flat rounded-rectangle ring, w x d outside, `t` thick
function roundedRing(w, d, r, t) {
  const outer = rrShape(w, d, r), inner = rrShape(w - t * 2, d - t * 2, Math.max(0.01, r - t));
  outer.holes.push(new THREE.Path(inner.getPoints(8).reverse()));
  return new THREE.ShapeGeometry(outer, 8).rotateX(-Math.PI / 2);
}
const plate = (w, d, r) => new THREE.ShapeGeometry(rrShape(w, d, r), 8).rotateX(-Math.PI / 2);
// L-shaped corner brackets just outside a footprint
function brackets(w, d, len = 0.45, t = 0.09) {
  const parts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const a = new THREE.BoxGeometry(len, 0.02, t).translate(sx * (w / 2 - len / 2 + t), 0, sz * (d / 2 + t / 2));
    const b = new THREE.BoxGeometry(t, 0.02, len).translate(sx * (w / 2 + t / 2), 0, sz * (d / 2 - len / 2 + t));
    parts.push(a, b);
  }
  const g = new THREE.BufferGeometry(), pos = [];
  for (const p of parts) pos.push(...p.toNonIndexed().attributes.position.array);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
// ground outlines are depth-tested (buildings stand in front of them); brackets draw on top
const flatMat = (color, opacity, onTop = false) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: !onTop, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });

export class Highlight {
  constructor(game) {
    this.g = game;
    const scene = game.view.scene;
    this.hover = { ent: null, group: new THREE.Group() };
    this.sel = { ent: null, group: new THREE.Group() };
    for (const h of [this.hover, this.sel]) { h.group.visible = false; h.group.renderOrder = 9; scene.add(h.group); }
    this.hoverTag = document.createElement('div'); this.hoverTag.id = 'hovertag'; this.hoverTag.className = 'hidden';
    document.body.appendChild(this.hoverTag);
    this.selTag = document.createElement('div'); this.selTag.id = 'seltag'; this.selTag.className = 'hidden';
    document.body.appendChild(this.selTag);
    this.cells = null;
    this.t = 0;
  }

  // ── shapes ──
  build(h, ent, selected) {
    h.group.clear();
    if (!ent) { h.group.visible = false; return; }
    if (ent.kind === 'b') {
      const [w, d] = footprint(ent.b.type, ent.b.rot), pad = selected ? 0.12 : 0.06;
      const ring = new THREE.Mesh(roundedRing(w + pad * 2, d + pad * 2, 0.32, selected ? 0.09 : 0.06), flatMat(selected ? 0xffd34a : 0xfff3d6, selected ? 0.95 : 0.7));
      ring.renderOrder = 10; h.group.add(ring);
      const fill = new THREE.Mesh(plate(w + pad * 2, d + pad * 2, 0.32), flatMat(selected ? 0xffe27a : 0xffffff, selected ? 0.16 : 0.1));
      fill.renderOrder = 9; h.group.add(fill);
      if (selected) {
        const br = new THREE.Mesh(brackets(w + 0.3, d + 0.3), flatMat(0xffffff, 0.95, true));
        br.renderOrder = 11; h.group.add(br); h.brackets = br;
      }
      h.w = w; h.d = d;
    } else if (ent.kind === 'v') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(selected ? 0.34 : 0.3, selected ? 0.42 : 0.36, 28).rotateX(-Math.PI / 2), flatMat(selected ? 0xffd34a : 0xfff3d6, selected ? 0.95 : 0.75));
      ring.renderOrder = 10; h.group.add(ring);
      h.brackets = null;
    } else { h.group.visible = false; return; }
    h.group.visible = true;
  }
  same(a, b) { return a === b || (!!a && !!b && a.kind === b.kind && ((a.kind === 'b' && a.b === b.b) || (a.kind === 'v' && a.v === b.v))); }

  setHover(ent) {
    if (ent && ent.kind !== 'b' && ent.kind !== 'v') ent = null;
    if (this.same(ent, this.sel.ent)) ent = null;          // selection already shows it
    if (this.same(ent, this.hover.ent)) return;
    this.hover.ent = ent;
    this.build(this.hover, ent, false);
    this.g.view.canvas.style.cursor = ent ? 'pointer' : '';
    if (ent?.kind === 'b') { const vis = this.g.bvis.get(ent.b.id); if (vis && !vis.pop) vis.pop = 0.35; }   // a tiny hop
    this.hoverTag.classList.toggle('hidden', !ent);
    if (ent) this.hoverTag.innerHTML = this.label(ent);
  }
  setSelected(ent) {
    if (ent && ent.kind !== 'b' && ent.kind !== 'v') ent = null;
    this.sel.ent = ent;
    this.build(this.sel, ent, true);
    this.selT = 0;
    if (ent?.kind === 'b') { const vis = this.g.bvis.get(ent.b.id); if (vis) vis.pop = 1; }
    if (this.same(this.hover.ent, ent)) this.setHover(null);
    this.selTag.classList.toggle('hidden', !ent || ent.kind !== 'b');
    if (ent?.kind === 'b') this.selTag.innerHTML = this.label(ent, true);
  }
  label(ent, sel = false) {
    if (ent.kind === 'v') return `<b>${esc(ent.v.name.split(' ')[0])}</b>`;
    const b = ent.b, def = defOf(b.type);
    const bits = [];
    if (!isDecor(b.type)) bits.push(`Lv ${lvlOf(b)}`);
    if (!b.built) bits.push(`${Math.round((b.progress || 0) * 100)}% built`);
    else if (workersOf(b)) bits.push(`${b.workers.length}/${workersOf(b)} workers`);
    else if (housingOf(b)) bits.push(`${housingOf(b)} beds`);
    const name = [...HOME_TYPES,...LODGING_TYPES,'wizard'].includes(b.type) ? this.g.sim.homeName(b) : def.name;
    return `<b>${esc(name)}</b>${bits.length ? `<small>${bits.join(' · ')}</small>` : ''}${sel ? '' : '<i>Click to open</i>'}`;
  }

  // ── placement: one coloured cell per footprint tile ──
  showCells(p) {
    if (!p || !p.ghost) { if (this.cells) this.cells.visible = false; return; }
    const sim = this.g.sim, W = sim.world, [w, d] = footprint(p.type, p.rot), n = w * d;
    if (!this.cells || this.cells.count < n) {
      if (this.cells) this.g.view.scene.remove(this.cells);
      const geo = new THREE.PlaneGeometry(0.86, 0.86).rotateX(-Math.PI / 2);
      // ground-level cells: depth-tested so the ghost building stands on top of them
      this.cells = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), 16);
      this.cells.renderOrder = 8; this.g.view.scene.add(this.cells);
    }
    const m = new THREE.Matrix4(), c = new THREE.Color(), ignore = p.moving ? p.moving.id : -1;
    let k = 0;
    for (let z = p.tz; z < p.tz + d; z++) for (let x = p.tx; x < p.tx + w; x++) {
      let ok = inMap(x, z);
      let y = 0.1;
      if (ok) {
        const i = idx(x, z);
        y = W.tileHeight(x, z) + 0.08;
        ok = W.type[i] !== 1 && (W.occ[i] < 0 || W.occ[i] === ignore) && !!sim.settlementAt(x, z) && !(isDecor(p.type) && W.rock[i] >= 0);
      }
      m.makeTranslation(toWorld(x), y, toWorld(z)); this.cells.setMatrixAt(k, m);
      this.cells.setColorAt(k, c.setHex(ok ? (p.ok ? 0x6fe05a : 0xf2c14a) : 0xf0564a)); k++;
    }
    this.cells.count = k; this.cells.visible = true;
    this.cells.instanceMatrix.needsUpdate = true; if (this.cells.instanceColor) this.cells.instanceColor.needsUpdate = true;
  }

  // ── per frame ──
  update(dt) {
    this.t += dt;
    const g = this.g, view = g.view;
    if (this.hover.ent) { const h = this.label(this.hover.ent); if (this.hoverTag.innerHTML !== h) this.hoverTag.innerHTML = h; }
    if (this.sel.ent?.kind === 'b') { const h = this.label(this.sel.ent, true); if (this.selTag.innerHTML !== h) this.selTag.innerHTML = h; }
    for (const h of [this.hover, this.sel]) {
      const ent = h.ent;
      if (!ent || !h.group.visible) continue;
      if (ent.kind === 'b') {
        const vis = g.bvis.get(ent.b.id);
        if (!vis) { h === this.sel ? this.setSelected(null) : this.setHover(null); continue; }
        const c = g.sim.bCenter(ent.b);
        h.group.position.set(c.x, vis.root.position.y + 0.07, c.z);
      } else {
        const v = ent.v, m = g.vvis.get(v.id);
        const x = v.x + (m?.px || 0), z = v.z + (m?.pz || 0);
        h.group.position.set(x, g.sim.world.heightAt(x, z) + 0.05, z);
        h.group.visible = !v.indoors;
      }
    }
    // selection: a gentle pulse and brackets that breathe in and out
    if (this.sel.group.visible) {
      this.selT = (this.selT || 0) + dt;
      const k = Math.min(1, this.selT * 5), ease = 1 + (1 - k) * 0.25;
      this.sel.group.scale.set(ease, 1, ease);
      if (this.sel.brackets) { const s = 1 + Math.sin(this.t * 3.2) * 0.03; this.sel.brackets.scale.set(s, 1, s); }
      this.sel.group.children[0].material.opacity = 0.75 + Math.sin(this.t * 4) * 0.2;
    }
    // labels
    this.place(this.hoverTag, this.hover, 1.0);
    this.place(this.selTag, this.sel, 1.0);
  }
  place(tag, h, extra) {
    if (!h.ent || (h.ent.kind === 'v' && tag === this.selTag)) { tag.classList.add('hidden'); return; }
    const g = this.g;
    let y;
    if (h.ent.kind === 'b') {
      const vis = g.bvis.get(h.ent.b.id); if (!vis) return;
      if (vis.top === undefined) vis.top = new THREE.Box3().setFromObject(vis.group).max.y - vis.root.position.y;
      y = vis.root.position.y + vis.top + 0.35 * extra;
    } else y = h.group.position.y + 1.05;
    const p = g.view.project(new THREE.Vector3(h.group.position.x, y, h.group.position.z));
    tag.classList.toggle('hidden', !p.vis);
    tag.style.left = p.x + 'px'; tag.style.top = p.y + 'px';
  }
}
