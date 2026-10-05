// Small, deterministic, seamless albedo maps. Neutral values let the existing
// building colours tint each surface; lighting still comes from the scene.
import * as THREE from '../vendor/three.module.min.js';
import { mulberry32 } from './rng.js';

const SIZE = 256, cache = new Map();
const SEEDS = { plaster: 12, wood: 31, stone: 47, brick: 53, shingle: 67,
  slate: 71, straw: 83, cloth: 97, grass: 101, earth: 113, cobble: 127 };

// Draw all nine neighbours, including corners, so marks wrap at both seams.
function wrapped(g, draw) {
  for (const x of [-SIZE, 0, SIZE]) for (const y of [-SIZE, 0, SIZE]) {
    g.save(); g.translate(x, y); draw(); g.restore();
  }
}
function stroke(g, points, color, width = 1) {
  g.strokeStyle = color; g.lineWidth = width; g.beginPath();
  points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
}
function wash(g, rng, count, strength = 0.1) {
  for (let i = 0; i < count; i++) {
    const x = rng() * SIZE, y = rng() * SIZE, r = 10 + rng() * 38;
    const v = rng() < 0.5 ? 100 : 255;
    wrapped(g, () => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${v},${v},${v},${strength})`);
      grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
}
function masonry(g, rng, brick = false, cobble = false) {
  const rows = brick ? 8 : 4, cols = brick ? 4 : 4;
  const w = SIZE / cols, h = SIZE / rows;
  g.fillStyle = cobble ? '#b9bcad' : '#bbb8ae'; g.fillRect(0, 0, SIZE, SIZE);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = col * w + (row % 2) * w / 2, y = row * h;
    const pad = cobble ? 5 : 2.5, value = 211 + Math.floor(rng() * 30);
    const dent = 2 + rng() * (brick ? 2 : 8);
    wrapped(g, () => {
      g.fillStyle = `rgb(${value},${value},${value})`;
      g.beginPath(); g.moveTo(x + pad + dent, y + pad);
      g.lineTo(x + w - pad - dent, y + pad + 1);
      g.quadraticCurveTo(x + w - pad, y + pad, x + w - pad, y + pad + dent);
      g.lineTo(x + w - pad - 1, y + h - pad - dent);
      g.quadraticCurveTo(x + w - pad, y + h - pad, x + w - pad - dent, y + h - pad);
      g.lineTo(x + pad + dent, y + h - pad - 1);
      g.quadraticCurveTo(x + pad, y + h - pad, x + pad, y + h - pad - dent);
      g.lineTo(x + pad, y + pad + dent);
      g.quadraticCurveTo(x + pad, y + pad, x + pad + dent, y + pad); g.fill();
      stroke(g, [[x + pad + dent, y + pad + 2], [x + w - pad - dent, y + pad + 3]], 'rgba(255,255,255,.4)', 2);
      stroke(g, [[x + pad + dent, y + h - pad], [x + w - pad - dent, y + h - pad]], 'rgba(80,75,65,.13)', 2);
    });
  }
  wash(g, rng, 35, 0.1);
}
function roofing(g, rng, slate) {
  g.fillStyle = '#b7b7b7'; g.fillRect(0, 0, SIZE, SIZE);
  const w = 64, h = 64;
  for (let row = -1; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = col * w + (row % 2) * w / 2, y = row * h;
    const value = 213 + Math.floor(rng() * 30);
    wrapped(g, () => {
      const grad = g.createLinearGradient(0, y, 0, y + h + 8);
      grad.addColorStop(0, '#f8f8f8'); grad.addColorStop(0.8, `rgb(${value},${value},${value})`); grad.addColorStop(1, '#bababa');
      g.fillStyle = grad; g.strokeStyle = 'rgba(85,75,65,.28)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + 1, y); g.lineTo(x + w - 1, y);
      g.lineTo(x + w - 1, y + h - 10);
      if (slate) { g.lineTo(x + w - 7, y + h - 2); g.lineTo(x + 6, y + h); }
      else g.quadraticCurveTo(x + w / 2, y + h + 12, x + 1, y + h - 10);
      g.closePath(); g.fill(); g.stroke();
      stroke(g, [[x + 7, y + 14], [x + 9, y + h - 18]], 'rgba(255,255,255,.3)', 2);
    });
  }
  wash(g, rng, 22, 0.06);
}

export function surfaceTexture(kind) {
  if (cache.has(kind)) return cache.get(kind);
  if (!(kind in SEEDS)) throw new Error(`Unknown village surface: ${kind}`);
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
  const g = cv.getContext('2d'), rng = mulberry32(SEEDS[kind]);
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, SIZE, SIZE); g.lineCap = 'round';
  if (kind === 'stone' || kind === 'brick' || kind === 'cobble') masonry(g, rng, kind === 'brick', kind === 'cobble');
  else if (kind === 'shingle' || kind === 'slate') roofing(g, rng, kind === 'slate');
  else if (kind === 'wood') {
    wash(g, rng, 25, 0.09);
    for (let i = 0; i < 65; i++) {
      const x = rng() * SIZE, phase = rng() * 6.28;
      const points = Array.from({ length: 33 }, (_, k) => [x + Math.sin(k * Math.PI / 16 + phase) * 2.5 + Math.sin(k * Math.PI / 8 + phase) * 0.6, k * 8]);
      wrapped(g, () => stroke(g, points, i % 3 ? 'rgba(85,70,55,.14)' : 'rgba(255,255,255,.6)', i % 3 ? 1 : 2));
    }
    for (let i = 0; i < 4; i++) {
      const x = 25 + rng() * 205, y = rng() * SIZE;
      wrapped(g, () => { for (let ring = 1; ring <= 3; ring++) {
        g.strokeStyle = `rgba(85,70,55,${0.14 / ring})`; g.lineWidth = 1.3;
        g.beginPath(); g.ellipse(x, y, ring * 3, ring * 8, 0, 0, Math.PI * 2); g.stroke();
      } });
    }
  } else if (kind === 'cloth') {
    for (let i = 0; i < SIZE; i += 4) {
      stroke(g, [[i, 0], [i, SIZE]], 'rgba(100,90,75,.07)');
      stroke(g, [[0, i], [SIZE, i]], 'rgba(100,90,75,.07)');
    }
    wash(g, rng, 12, 0.05);
  } else if (kind === 'straw') {
    wash(g, rng, 22, 0.08);
    for (let i = 0; i < 350; i++) {
      const x = rng() * SIZE, y = rng() * SIZE, len = 16 + rng() * 42, width = 1 + rng();
      wrapped(g, () => stroke(g, [[x, y], [x + 2, y + len]], i % 3 ? 'rgba(100,80,50,.13)' : 'rgba(255,255,255,.65)', width));
    }
  } else {
    wash(g, rng, kind === 'plaster' ? 90 : 40, kind === 'plaster' ? 0.08 : 0.13);
    const grass = kind === 'grass';
    for (let i = 0; i < (grass ? 180 : 110); i++) {
      const x = rng() * SIZE, y = rng() * SIZE, rx = 1 + rng() * 2, ry = 0.6 + rng();
      wrapped(g, () => {
        if (grass) {
          stroke(g, [[x - 2, y + 3], [x, y - 3], [x + 2, y + 3]], 'rgba(95,115,80,.15)', 1.4);
        } else {
          g.fillStyle = i % 3 ? 'rgba(100,90,75,.07)' : 'rgba(255,255,255,.35)';
          g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 6.28); g.fill();
        }
      });
    }
  }
  const texture = new THREE.CanvasTexture(cv);
  texture.name = `villages/${kind}`;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4; cache.set(kind, texture);
  return texture;
}

// Position-based box UVs give the same material scale on a beam and a wall.
// Wood grain follows the longest dimension instead of stretching per face.
export function mapBoxSurface(geo, kind, density = 1) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  const dims = geo.parameters, long = dims.width >= dims.height && dims.width >= dims.depth ? 0 : dims.height >= dims.depth ? 1 : 2;
  for (let i = 0; i < p.count; i++) {
    const xyz = [p.getX(i), p.getY(i), p.getZ(i)];
    const face = Math.abs(n.getX(i)) > 0.5 ? 0 : Math.abs(n.getY(i)) > 0.5 ? 1 : 2;
    const axes = face === 0 ? [2, 1] : face === 1 ? [0, 2] : [0, 1];
    if ((kind === 'wood' || kind === 'straw') && axes[0] === long) axes.reverse();
    uv.setXY(i, xyz[axes[0]] * density, xyz[axes[1]] * density);
  }
  uv.needsUpdate = true;
}

export function stripedCloth(a = '#cc6654', b = '#fbf1da') {
  const key = `stripes/${a}/${b}`;
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
  const g = cv.getContext('2d');
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 32, 0, 32, SIZE); }
  g.globalCompositeOperation = 'multiply'; g.drawImage(surfaceTexture('cloth').image, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.35, 1); t.anisotropy = 4;
  t.name = 'villages/striped-cloth'; cache.set(key, t); return t;
}
