// Dev-only helpers for staging scenes in the browser (never loaded by the game).
// In the console: const dk = await import('/villages/tools/devkit.js'); await dk.ready(); dk.noSave(); ...
import { paintCobble } from '../js/roads.js';
import { CENTERS, idx, N } from '../js/world.js';

export const g = () => window.villages;
export async function ready() { for (let i = 0; i < 200 && !window.villages?.ui; i++) await new Promise(r => setTimeout(r, 100)); return window.villages; }
// test scenes must never overwrite the real save
export function noSave() { g().save = () => {}; }
export const toW = t => t - N / 2 + 0.5;
// a short cobbled street near the main campfire
export function cobbles(rows = [3, 4], halfLen = 7) {
  const sim = g().sim, W = sim.world, c = CENTERS.meadow; sim.s.res.stone += 500; let n = 0;
  for (const dz of rows) for (let dx = -halfLen; dx <= halfLen; dx++) { const i = idx(c.x + dx, c.z + dz); if (W.occ[i] < 0 && W.type[i] === 0 && !W.paved[i] && paintCobble(sim, i, true)) n++; }
  return n;
}
export async function look(tx, tz, dist = 8, wait = 1200) { g().view.flyTo(toW(tx), toW(tz), dist, 0.25); await new Promise(r => setTimeout(r, wait)); }
export const home = () => CENTERS.meadow;
// time of day (0..1) and season index (0 spring … 3 winter), by moving the clock
export function setTime(frac, season = null) {
  const sim = g().sim, s = sim.s, DAY = 240, SD = 3;
  let day = Math.floor(s.time / DAY);
  if (season != null) day = Math.floor(day / (SD * 4)) * SD * 4 + season * SD + 1;
  s.time = day * DAY + frac * DAY;
}
export function weather(kind) { const w = g().sim.s.weather; w.rain = kind === 'rain' || kind === 'storm'; w.storm = kind === 'storm'; w.t = 200; }
// Step the game by hand (the preview pane pauses requestAnimationFrame while it's hidden).
// rAF is stubbed while stepping so no extra game loops get scheduled.
export function steps(n = 60, dt = 1 / 30) {
  const game = g(), raf = window.requestAnimationFrame;
  window.requestAnimationFrame = () => 0;
  try { for (let k = 0; k < n; k++) { game.last = performance.now() - dt * 1000; game.loop(); } }
  finally { window.requestAnimationFrame = raf; }
}
// Blow a region of the rendered frame (CSS pixels) up to fill the screen, for close inspection in a screenshot.
export function magnify(x, y, w, h) {
  unmagnify();
  const game = g(), cv = game.view.renderer.domElement; game.view.render();
  const r = cv.width / cv.clientWidth, c = document.createElement('canvas'); c.width = 1280; c.height = Math.round(1280 * h / w);
  c.getContext('2d').drawImage(cv, x * r, y * r, w * r, h * r, 0, 0, c.width, c.height);
  const img = new Image(); img.src = c.toDataURL(); img.id = 'dkmag';
  img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;background:#000;z-index:9999';
  document.body.appendChild(img);
}
export const unmagnify = () => document.getElementById('dkmag')?.remove();
// Wait for the game, skip the loader and the welcome card, and never save.
export async function boot() {
  for (let i = 0; i < 150 && !window.villages?.last; i++) await new Promise(r => setTimeout(r, 200));
  for (let i = 0; i < 40 && document.getElementById('loading'); i++) { steps(2); await new Promise(r => setTimeout(r, 150)); }
  noSave(); document.getElementById('welcome')?.remove(); steps(5); return g();
}
// Open a home with its family inside: the first `sleepers` in bed, the rest awake; gives the first a cat.
export async function peekScene(type = 'cottage', sleepers = 2) {
  const game = g(), sim = game.sim, b = sim.s.buildings.find(o => o.type === type); if (!b) return null;
  const folk = sim.s.villagers.filter(v => sim.homeOf(v) === b);
  folk.forEach((v, i) => { v.indoors = true; v.asleep = i < sleepers ? 'home' : null; });
  sim.s.pets ||= []; if (folk[0] && !sim.s.pets.some(p => p.owner === folk[0].id)) sim.s.pets.push({ id: 900 + b.id, owner: folk[0].id, kind: 'cat', name: 'Biscuit', tint: 0.3 });
  game.select({ kind: 'b', b }); steps(60);
  return b;
}
export async function magnifyAt(x, y, z, w = 400, h = 225) {
  const THREE = await import('../vendor/three.module.min.js'), p = g().view.project(new THREE.Vector3(x, y, z));
  magnify(p.x - w / 2, p.y - h / 2, w, h);
}
// A big town for performance work: up to `nb` buildings round the main fire and `nv` extra villagers.
export function bigTown(nb = 40, nv = 60) {
  const sim = g().sim, s = sim.s, c = CENTERS.meadow, types = ['cottage', 'cottage', 'tiled', 'lumber', 'farm', 'bakery', 'market', 'well', 'cottage', 'forager', 'school', 'tavern'];
  s.level = Math.max(s.level, 12); let n = 0;
  for (let r = 3; r < 22 && n < nb; r++) for (let z = c.z - r; z <= c.z + r && n < nb; z++) for (let x = c.x - r; x <= c.x + r && n < nb; x++) {
    if (Math.max(Math.abs(x - c.x), Math.abs(z - c.z)) !== r) continue;
    const t = types[n % types.length], ok = sim.checkPlace(t, x, z, 0, -2);
    if (ok.ok && sim.addBuilding(t, x, z, 0, true)) n++;
  }
  for (let i = 0; i < nv; i++) sim.spawnVillager('meadow', toW(c.x) + (i % 10) - 5, toW(c.z) + Math.floor(i / 10) - 3);
  return { buildings: n, villagers: s.villagers.length };
}
// Frame cost: n frames stepped by hand, each finished on the GPU (gl.finish) so GPU time counts too.
export function perf(n = 60) {
  const game = g(), gl = game.view.renderer.getContext(), info = game.view.renderer.info, raf = window.requestAnimationFrame;
  window.requestAnimationFrame = () => 0;
  const ts = [], cpu = [];
  try {
    for (let k = 0; k < n; k++) { const t0 = performance.now(); game.last = t0 - 1000 / 30; game.loop(); const t1 = performance.now(); gl.finish(); ts.push(performance.now() - t0); cpu.push(t1 - t0); }
  } finally { window.requestAnimationFrame = raf; }
  ts.sort((a, b) => a - b); cpu.sort((a, b) => a - b);
  let meshes = 0; game.view.scene.traverse(o => { if (o.isMesh && o.visible) meshes++; });
  return { cpu: +cpu[n >> 1].toFixed(2), cpu90: +cpu[Math.floor(n * 0.9)].toFixed(2), median: +ts[n >> 1].toFixed(2), p90: +ts[Math.floor(n * 0.9)].toFixed(2), calls: info.render.calls, tris: info.render.triangles, meshes, programs: info.programs?.length };
}
// The standard performance scene: a 40-building, ~64-villager town, camera at the given distance.
export async function perfScene(dist = 30) {
  const game = await boot(); setTime(0.45, 0); bigTown(40, 60); steps(40);
  const r = game.view.rig, c = home(); r.tx = toW(c.x); r.tz = toW(c.z); r.dist = dist; game.view.fly = null; steps(30);
  const a = perf(60), b = perf(60), by = callsBy();
  return { perfOff: sessionStorage.getItem('villagesPerfOff') === '1', w: innerWidth, a, b, by };
}
// One frame's draw calls by category (main pass and shadow pass together), via renderBufferDirect.
export function callsBy() {
  const game = g(), r = game.view.renderer, orig = r.renderBufferDirect, out = {}, view = game.view;
  const kind = o => o.isBatchedMesh ? (o.material.vertexColors ? 'villagers (batched)' : 'buildings (batched)')
    : o.isInstancedMesh ? (o.material.colorWrite === false ? 'tree shadow twins' : view.chunks?.includes(o) ? 'forest chunks' : view.skirtTrees?.includes(o) ? 'skirt trees' : 'other instanced')
    : (() => { for (let p = o; p; p = p.parent) { if (p.userData?.ent?.kind === 'b') return 'buildings (unbatched)'; if (p.name === 'villager') return 'villagers (unbatched)'; } return o === view.terrain ? 'terrain' : 'other'; })();
  r.renderBufferDirect = function (cam, scene, geo, mat, obj, grp) { const k = kind(obj) + (cam.isOrthographicCamera ? ' [shadow]' : ''); out[k] = (out[k] || 0) + 1; return orig.apply(this, arguments); };
  try { steps(1); } finally { r.renderBufferDirect = orig; }
  return { multiDraw: r.extensions.has('WEBGL_multi_draw'), calls: out };
}
