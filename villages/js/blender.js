// Loads the stylized models authored in Blender (villages/blender/*.py ->
// models/models.json + models.bin) and turns them into three.js groups.
// Materials come from models.js's mat() so snow, night glow and the shared
// surface textures work exactly as they do on the procedural parts.
import * as THREE from '../vendor/three.module.min.js';

let DATA = null, BIN = null;
const geoCache = new Map();

export async function loadModels(base = 'models/models.json') {
  try {
    const res = await fetch(base, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    const bin = await (await fetch(base.replace(/[^/]+$/, json.bin), { cache: 'no-cache' })).arrayBuffer();
    DATA = json; BIN = bin;
  } catch (err) {
    console.warn('Blender models unavailable; using procedural models', err);
    DATA = null;
  }
  return !!DATA;
}

export const hasModel = name => !!DATA?.models[name];

// Surface textures by slot. Roofs choose slate or shingle from their colour.
export const SLOT_SURFACE = {
  wall: 'plaster', plaster: 'plaster', wood: 'wood', trim: 'wood', beam: 'wood', door: 'wood', plank: 'wood', log: 'wood',
  stone: 'stone', chim: 'stone', found: 'stone', brick: 'brick', straw: 'straw', thatch: 'straw', cloth: 'cloth', awning: 'cloth',
  roof: 'roof', shingle: 'shingle', slate: 'slate',
};

// UVs that follow each face: u runs horizontally along the face, v down its
// slope, in world units, so plaster, planks and shingles keep one scale.
function faceUVs(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position, n = p.count, uv = new Float32Array(n * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3(), t = new THREE.Vector3(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    nn.subVectors(c, b).cross(t.subVectors(a, b)).normalize();
    if (Math.abs(nn.y) > 0.92) { t.set(1, 0, 0); s.set(0, 0, 1); }
    else { t.crossVectors(up, nn).normalize(); s.crossVectors(nn, t).normalize().negate(); }
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      uv[(i + k) * 2] = v.dot(t); uv[(i + k) * 2 + 1] = v.dot(s);
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function geometry(mesh, textured) {
  const key = mesh.pos + (textured ? 't' : '');
  let g = geoCache.get(key);
  if (g) return g;
  const q = 1 / DATA.quant;
  const ip = new Int16Array(BIN, mesh.pos, mesh.nv * 3), pos = new Float32Array(mesh.nv * 3);
  for (let i = 0; i < pos.length; i++) pos[i] = ip[i] * q;
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(BIN, mesh.idx, mesh.ni), 1));
  if (mesh.nrm >= 0) {
    const inr = new Int8Array(BIN, mesh.nrm, mesh.nv * 3), nrm = new Float32Array(mesh.nv * 3);
    for (let i = 0; i < nrm.length; i++) nrm[i] = inr[i] / 127;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  } else {
    // flat-shaded: split per face so every triangle gets its own normal
    g = textured ? faceUVs(g) : (g.index ? g.toNonIndexed() : g);
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  geoCache.set(key, g);
  return g;
}

/**
 * Build an instance of a model.
 *   materialFor(slot, defaultColor, mesh) -> THREE.Material
 * Returns { group, nodes: {name: Object3D}, points: [{name, obj}] }.
 */
export function instanceModel(name, materialFor) {
  const M = DATA.models[name];
  const objs = [], nodes = {}, points = [];
  M.nodes.forEach((nd, i) => {
    const o = new THREE.Group();
    o.name = nd.name;
    o.position.fromArray(nd.pos);
    o.rotation.set(nd.rot[0], nd.rot[1], nd.rot[2]);
    o.scale.fromArray(nd.scale);
    for (const ms of nd.meshes || []) {
      const surf = SLOT_SURFACE[ms.slot];
      const m = new THREE.Mesh(geometry(ms, !!surf && !ms.smooth), materialFor(ms.slot, ms.color, ms));
      m.castShadow = true; m.receiveShadow = !ms.smooth;
      m.userData.slot = ms.slot;
      o.add(m);
    }
    objs.push(o);
    if (!(nd.name in nodes)) nodes[nd.name] = o;
    if (nd.parent >= 0) objs[nd.parent].add(o);
  });
  for (const p of M.points) {
    const o = new THREE.Object3D(); o.name = 'pt_' + p.name; o.position.fromArray(p.pos);
    (p.parent >= 0 ? objs[p.parent] : objs[0]).add(o);
    points.push({ name: p.name, obj: o });
  }
  const group = objs[0];
  return { group, nodes, points };
}

// Bake a whole model into one non-indexed, vertex-coloured geometry (slot
// colours become vertex colours) for instanced use such as the forest.
// Normals are kept (smooth parts stay soft, flat parts faceted) and leaves get
// a top-lit gradient: darker underneath, lighter on top.
export function bakedGeometry(name) {
  const inst = instanceModel(name, (slot, c) => new THREE.MeshBasicMaterial({ color: c }));
  inst.group.updateMatrixWorld(true);
  const pos = [], nrm = [], col = [], snowy = [], c = new THREE.Color(), v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  let y0 = Infinity, y1 = -Infinity;
  inst.group.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, p = g.attributes.position, gn = g.attributes.normal;
    nm.getNormalMatrix(o.matrixWorld);
    c.copy(o.material.color);
    const isSnow = o.userData.slot === 'snowcap' ? 1 : 0;      // winter-only caps (the forest shader hides them otherwise)
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      n.fromBufferAttribute(gn, i).applyMatrix3(nm).normalize();
      pos.push(v.x, v.y, v.z); nrm.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b); snowy.push(isSnow);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
  });
  for (let i = 0; i < col.length; i += 3) {
    if (snowy[i / 3] || col[i + 1] <= col[i] * 1.15) continue;   // bark and snow keep their colour
    const k = 0.78 + 0.36 * (pos[i + 1] - y0) / Math.max(1e-3, y1 - y0);
    col[i] = Math.min(1, col[i] * k); col[i + 1] = Math.min(1, col[i + 1] * k); col[i + 2] = Math.min(1, col[i + 2] * k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('snowy', new THREE.Float32BufferAttribute(snowy, 1));
  return out;
}
