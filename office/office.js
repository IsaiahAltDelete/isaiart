// The office: one adventurer per coding-agent session. Working sessions type at a desk, waiting ones
// stand up with a sign, idle ones nap on the couch. Status comes from office/feed.mjs (see README);
// ?mock=1 shows pretend sessions.
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as cloneSkeleton } from './vendor/SkeletonUtils.js';

const FEED = 'http://127.0.0.1:7331/sessions';
const MOCK = new URLSearchParams(location.search).has('mock');
const MOCK_DATA = { sessions: [
  { id: 'a', agent: 'claude', project: 'isaiart', title: 'purring-plotting-hamster', status: 'working', activity: 'editing villages/js/peek.js', lastEventAt: new Date().toISOString() },
  { id: 'b', agent: 'codex', project: 'isaiart', title: 'office feed server', status: 'waiting', activity: 'waiting for Isaiah', lastEventAt: new Date().toISOString() },
  { id: 'c', agent: 'claude', project: 'dnd-isaiart-com', title: 'sunny-wandering-otter', status: 'idle', activity: 'idle', lastEventAt: new Date(Date.now() - 3e6).toISOString() },
] };

// ── scene ──
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x2b2a33);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
const rig = { yaw: 0.5, pitch: 0.6, dist: 9.0, target: new THREE.Vector3(0.2, 0.4, 0.2) };
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5a40, 1.3));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.2); sun.position.set(4, 8, 3); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 }); sun.shadow.bias = -0.0005;
scene.add(sun);
const lamp = new THREE.PointLight(0xffd9a0, 6, 6, 1.6); lamp.position.set(-3.2, 1.6, -1.2); scene.add(lamp);

const mat = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
function box(w, h, d, c, x, y, z, parent = scene) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; }
// the room: a wooden floor, two walls with skirting, a window on the back wall
const ROOM_W = 10, ROOM_D = 7;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), mat(0xa77a4c)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, 0.02), mat(0x8d6540)); s.rotation.x = -Math.PI / 2; s.position.set(0, 0.002, -ROOM_D / 2 + 0.4 + i * 0.75); scene.add(s); }
box(ROOM_W, 3, 0.15, 0xf1e4c6, 0, 0, -ROOM_D / 2 - 0.075);           // back wall
box(0.15, 3, ROOM_D, 0xe7d8b6, -ROOM_W / 2 - 0.075, 0, 0);           // left wall
box(ROOM_W, 0.14, 0.04, 0x8d6540, 0, 0, -ROOM_D / 2 + 0.02); box(0.04, 0.14, ROOM_D, 0x8d6540, -ROOM_W / 2 + 0.02, 0, 0);   // skirting
// window: a sky-blue pane in a cream frame
box(2.4, 1.6, 0.06, 0xfff8e8, 1.2, 1.1, -ROOM_D / 2 + 0.02);
const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.3), new THREE.MeshBasicMaterial({ color: 0x9fd3e8 })); pane.position.set(1.2, 1.9, -ROOM_D / 2 + 0.06); scene.add(pane);
box(0.06, 1.3, 0.02, 0xfff8e8, 1.2, 1.25, -ROOM_D / 2 + 0.07); box(2.1, 0.06, 0.02, 0xfff8e8, 1.2, 1.87, -ROOM_D / 2 + 0.07);

// ── assets ──
const loader = new GLTFLoader();
const load = url => new Promise((ok, no) => loader.load(url, ok, undefined, no));
const FURN = ['table_medium', 'chair_A', 'lamp_table', 'book_set', 'book_single', 'cactus_small_A', 'cactus_medium_A', 'rug_rectangle_A', 'shelf_B_small_decorated', 'pictureframe_medium', 'couch', 'lamp_standing', 'cabinet_small_decorated'];
const CHARS = { claude: 'Mage', codex: 'Knight', extra: ['Rogue', 'Barbarian'] };
const furn = {}, chars = {};
// the adventurers come armed; nobody brings a sword to the office
const GEAR = /sword|shield|axe|dagger|staff|wand|bow|arrow|quiver|spellbook|mug|smokebomb|offhand/i;
function prep(obj) { obj.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; if (GEAR.test(o.name)) o.visible = false; } }); return obj; }
// KayKit furniture is modelled with a 1.0-high table; the people are 1.6 tall, so furniture is scaled to a 0.72 table
const FS = 0.72;
function place(name, x, z, ry = 0, s = 1) { const o = prep(furn[name].scene.clone()); o.position.set(x, 0, z); o.rotation.y = ry; o.scale.setScalar(s * FS); scene.add(o); return o; }

// ── desks: one per shown session, in two rows facing the back wall ──
const DESKS = [[-3.2, -1.4], [-0.4, -1.4], [2.4, -1.4], [-3.2, 1.3], [-0.4, 1.3], [2.4, 1.3]];
const desks = [];
const COUCH = { x: 4.1, z: -0.6 };   // along the right wall

function laptop(parent, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.3), mat(0x3a3a44)); base.castShadow = true; g.add(base);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.02), mat(0x3a3a44)); lid.position.set(0, 0.15, -0.15); lid.rotation.x = -0.25; g.add(lid);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.24), new THREE.MeshBasicMaterial({ color: 0x9ad3ff })); screen.position.set(0, 0.15, -0.137); screen.rotation.x = -0.25; g.add(screen);
  const glow = new THREE.PointLight(0x9ad3ff, 0.8, 1.2); glow.position.set(0, 0.3, 0.2); g.add(glow);
  g.userData.screen = screen; g.userData.glow = glow; parent.add(g); return g;
}

async function build() {
  const names = [...FURN, ...new Set([CHARS.claude, CHARS.codex, ...CHARS.extra])];
  await Promise.all([
    ...FURN.map(async n => { furn[n] = await load(`./assets/furniture/${n}.gltf`); }),
    ...[CHARS.claude, CHARS.codex, ...CHARS.extra].map(async n => { chars[n] = await load(`./assets/characters/${n}.glb`); }),
  ]);
  // furniture heights, to sit things on tables
  const h = o => new THREE.Box3().setFromObject(o).max.y;
  const tableH = h(furn.table_medium.scene) * FS;
  for (const [x, z] of DESKS) {
    const t = place('table_medium', x, z, 0);
    const c = place('chair_A', x, z + 0.98, Math.PI);
    const lp = laptop(scene, x, tableH, z - 0.05);
    desks.push({ x, z, table: t, chair: c, laptop: lp, who: null });
  }
  place('lamp_table', DESKS[2][0] + 0.55, DESKS[2][1] - 0.1, 0.2);
  place('book_set', DESKS[0][0] - 0.5, DESKS[0][1] - 0.05, 0.4).position.y = tableH;
  place('cactus_small_A', DESKS[4][0] + 0.55, DESKS[4][1] - 0.1, 0).position.y = tableH;
  place('couch', COUCH.x, COUCH.z, -Math.PI / 2);
  place('lamp_standing', 4.3, 1.5, 0);
  place('cactus_medium_A', -4.5, -3.0, 0);
  place('rug_rectangle_A', -0.4, 0, 0, 1.2);
  place('shelf_B_small_decorated', -2.4, -ROOM_D / 2 + 0.2, 0).position.y = 1.3;
  place('cabinet_small_decorated', -4.4, -2.2, Math.PI / 2);
  const pf = place('pictureframe_medium', -0.6, -ROOM_D / 2 + 0.1, 0); pf.position.y = 1.6;
  document.getElementById('loading').classList.add('gone');
}

// ── the people ──
const people = new Map();   // session id -> person
const PERSON_H = 1.6;
function makePerson(kind) {
  const src = chars[kind] || chars.Rogue;
  const root = cloneSkeleton(src.scene); prep(root);
  const bb = new THREE.Box3().setFromObject(root); const k = PERSON_H / (bb.max.y - bb.min.y); root.scale.setScalar(k);
  const mixer = new THREE.AnimationMixer(root);
  const clips = Object.fromEntries(src.animations.map(c => [c.name, c]));
  const actions = {}; let current = null;
  const play = (name, fade = 0.3, once = false) => {
    const clip = clips[name]; if (!clip) return;
    const a = actions[name] || (actions[name] = mixer.clipAction(clip));
    if (once) { a.reset().setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; }
    else a.setLoop(THREE.LoopRepeat, Infinity);
    if (current && current !== a) { current.fadeOut(fade); }
    a.reset().fadeIn(fade).play(); current = a;
  };
  // a sign over the head for waiting sessions
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex('!'), transparent: true, depthWrite: false }));
  sign.scale.set(0.5, 0.5, 1); sign.position.y = 2.05; sign.visible = false; root.add(sign);
  scene.add(root);
  const tag = document.createElement('div'); tag.className = 'tag'; document.getElementById('tags').appendChild(tag);
  return { root, mixer, play, sign, tag, kind, state: null, typeT: 0 };
}
let _sign = null;
function signTex() {
  if (_sign) return _sign;
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
  g.fillStyle = '#f6c53f'; g.strokeStyle = '#8a5a2b'; g.lineWidth = 8; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#5b3a1e'; g.font = 'bold 86px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 64, 70);
  _sign = new THREE.CanvasTexture(cv); _sign.colorSpace = THREE.SRGBColorSpace; return _sign;
}

function kindFor(s, i) { return s.agent === 'codex' ? CHARS.codex : s.agent === 'claude' ? CHARS.claude : CHARS.extra[i % CHARS.extra.length]; }

// where a person goes for each state
function pose(p, s, desk) {
  const st = s.status;
  if (p.state === st && p.desk === desk) return;
  p.state = st; p.desk = desk;
  p.sign.visible = st === 'waiting';
  if (st === 'working' && desk) {
    // sitting on the chair, facing the laptop
    p.root.position.set(desk.x, 0.0, desk.z + 0.98); p.root.rotation.y = Math.PI;
    p.play('Sit_Chair_Idle');
  } else if (st === 'waiting' && desk) {
    // up on their feet beside the desk, turned toward the room
    p.root.position.set(desk.x + 0.85, 0, desk.z + 0.7); p.root.rotation.y = Math.PI * 0.75;
    p.play('Idle');
  } else {
    // napping on the couch (or the floor if the couch is taken)
    const n = [...people.values()].filter(o => o !== p && o.state === 'idle').length;
    if (n === 0) { p.root.position.set(COUCH.x, 0.33, COUCH.z + 0.6); p.root.rotation.y = Math.PI; p.play('Lie_Idle'); }
    else { p.root.position.set(COUCH.x - 1.2, 0, COUCH.z + 1.6 + 0.9 * (n - 1)); p.root.rotation.y = -0.8; p.play('Sit_Floor_Idle'); }
  }
}

function apply(data) {
  const list = (data.sessions || []).slice(0, 12);
  const seen = new Set();
  // desks go to the sessions that need them: working first, then waiting
  const needDesk = list.filter(s => s.status !== 'idle').slice(0, DESKS.length);
  for (const d of desks) d.who = null;
  needDesk.forEach((s, i) => { desks[i].who = s.id; });
  list.forEach((s, i) => {
    seen.add(s.id);
    let p = people.get(s.id);
    if (!p) { p = makePerson(kindFor(s, i)); people.set(s.id, p); }
    const desk = desks.find(d => d.who === s.id) || null;
    pose(p, s, desk);
    p.tag.className = 'tag ' + s.status;
    p.tag.innerHTML = `<b>${esc(s.title || s.id)}</b>${esc(s.activity || s.status)}`;
    p.session = s;
  });
  for (const [id, p] of people) if (!seen.has(id)) { scene.remove(p.root); p.tag.remove(); people.delete(id); }
  for (const d of desks) { const on = !!d.who; d.laptop.userData.screen.material.color.setHex(on ? 0x9ad3ff : 0x2a2f3a); d.laptop.userData.glow.intensity = on ? 0.8 : 0; }
  // the list
  document.getElementById('count').textContent = `${list.length} session${list.length === 1 ? '' : 's'}`;
  document.getElementById('list').innerHTML = list.map(s => `<div class="row ${s.status}"><span class="dot"></span><b>${esc(s.title || s.id)}</b><span class="act">${esc(s.activity || '')}</span><span class="ag">${esc(s.agent)}</span></div>`).join('') || '<div class="row">Nobody is in today.</div>';
}
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function poll() {
  const note = document.getElementById('note');
  if (MOCK) { apply(MOCK_DATA); note.textContent = 'Showing pretend sessions (?mock=1).'; return; }
  try {
    const r = await fetch(FEED, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status);
    apply(await r.json()); note.className = ''; note.textContent = `Live from ${FEED.replace('http://', '')}`;
  } catch {
    note.className = 'bad'; note.textContent = 'The feed isn\'t running. Start it with: node office/feed.mjs';
    if (!people.size) apply({ sessions: [] });
  }
}

// ── camera: drag to orbit, wheel to zoom, slow drift otherwise ──
let drag = null, idleT = 0;
renderer.domElement.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; idleT = 0; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', e => { if (!drag) return; rig.yaw -= (e.clientX - drag.x) * 0.006; rig.pitch = Math.max(0.2, Math.min(1.3, rig.pitch + (e.clientY - drag.y) * 0.004)); drag = { x: e.clientX, y: e.clientY }; });
addEventListener('wheel', e => { rig.dist = Math.max(4, Math.min(18, rig.dist + e.deltaY * 0.01)); }, { passive: true });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const clock = new THREE.Clock(); const tmp = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, clock.getDelta()), t = clock.elapsedTime;
  if (!drag) { idleT += dt; if (idleT > 4) rig.yaw += dt * 0.05; }
  camera.position.set(rig.target.x + Math.sin(rig.yaw) * Math.cos(rig.pitch) * rig.dist, rig.target.y + Math.sin(rig.pitch) * rig.dist, rig.target.z + Math.cos(rig.yaw) * Math.cos(rig.pitch) * rig.dist);
  camera.lookAt(rig.target);
  for (const p of people.values()) {
    p.mixer.update(dt);
    // typing: a little lean-in now and then while working
    if (p.state === 'working') { p.typeT += dt; if (p.typeT > 6 + Math.random() * 4) { p.typeT = 0; p.play('Interact', 0.2, true); setTimeout(() => p.state === 'working' && p.play('Sit_Chair_Idle', 0.3), 1400); } }
    p.sign.position.y = 2.05 + Math.sin(t * 3) * 0.05;
    // name tag follows the head
    tmp.set(0, 1.95, 0).applyMatrix4(p.root.matrixWorld).project(camera);
    const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
    p.tag.style.display = vis ? '' : 'none';
    if (vis) { p.tag.style.left = (tmp.x * 0.5 + 0.5) * innerWidth + 'px'; p.tag.style.top = (-tmp.y * 0.5 + 0.5) * innerHeight - 12 + 'px'; }
  }
  renderer.render(scene, camera);
}

build().then(() => { poll(); setInterval(poll, 2500); frame(); }).catch(e => { document.getElementById('loading').textContent = 'Could not set up the office: ' + e.message; console.error(e); });
window.office = { scene, camera, rig, people, desks, furn, chars };
