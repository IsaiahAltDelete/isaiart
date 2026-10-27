// A flat, toon-shaded 3.5" floppy that turns slowly. Cel ramp via MeshToonMaterial,
// ink outlines via inverted hulls pushed out along smoothed normals.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const INK = 0x161616;
const RED = 0xe2483d;
const STEEL = 0xc4c8cf;
const W = 9, H = 9.4, D = 0.34;

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
camera.position.set(0, 0.6, 27);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-6, 8, 10);
scene.add(sun);

// Three hard bands: shadow, mid, lit.
const ramp = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });

const hullMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { thickness: { value: 0.07 }, color: { value: new THREE.Color(INK) } },
    vertexShader: `
        uniform float thickness;
        void main() {
            vec3 p = position + normal * thickness;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
    fragmentShader: `
        uniform vec3 color;
        void main() { gl_FragColor = vec4(color, 1.0); }`,
});

function withOutline(geometry, material) {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, material));
    const g = geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    const smooth = mergeVertices(g, 1e-3);
    smooth.computeVertexNormals();
    group.add(new THREE.Mesh(smooth, hullMat));
    return group;
}

// Flat decal on a face; z is the face's offset, back faces are flipped.
function decal(w, h, material, x, y, back = false, lift = 0.004) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    m.position.set(x, y, (back ? -1 : 1) * (D / 2 + lift));
    if (back) m.rotation.y = Math.PI;
    return m;
}

const disk = new THREE.Group();
scene.add(disk);

// Body: rounded square with the chamfered corner.
{
    const r = 0.28, c = 0.5, x0 = -W / 2, x1 = W / 2, y0 = -H / 2, y1 = H / 2;
    const s = new THREE.Shape();
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0);
    s.quadraticCurveTo(x1, y0, x1, y0 + r);
    s.lineTo(x1, y1 - c);
    s.lineTo(x1 - c, y1);
    s.lineTo(x0 + r, y1);
    s.quadraticCurveTo(x0, y1, x0, y1 - r);
    s.lineTo(x0, y0 + r);
    s.quadraticCurveTo(x0, y0, x0 + r, y0);
    const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, -D / 2);
    disk.add(withOutline(g, toon(RED)));
}

// Shutter: a steel sleeve over the top edge, with a slot on each face.
const SW = 4.6, SH = 3.5, SX = -0.4, SY = H / 2 - SH / 2 + 0.02;
{
    const g = new THREE.BoxGeometry(SW, SH, D + 0.08);
    g.translate(SX, SY, 0);
    disk.add(withOutline(g, toon(STEEL)));
    const slot = new THREE.MeshBasicMaterial({ color: INK });
    // The hull sits inside the body here, so draw the shutter's ink edge as decals.
    disk.add(decal(SW + 0.16, SH + 0.1, slot, SX, SY - 0.05, false, 0.002));
    disk.add(decal(SW + 0.16, SH + 0.1, slot, SX, SY - 0.05, true, 0.002));
    disk.add(decal(1.1, 2.4, slot, SX - 0.5, SY - 0.35, false, 0.045));
    disk.add(decal(1.1, 2.4, slot, SX - 0.5, SY - 0.35, true, 0.045));
}

// Write-protect and density holes, both faces.
{
    const hole = new THREE.MeshBasicMaterial({ color: INK });
    for (const back of [false, true]) {
        disk.add(decal(0.55, 0.55, hole, -W / 2 + 0.75, -H / 2 + 0.75, back));
        disk.add(decal(0.55, 0.55, hole, W / 2 - 0.75, -H / 2 + 0.75, back));
    }
}

// Back: steel hub.
{
    const g = new THREE.CylinderGeometry(1.25, 1.25, 0.06, 40);
    g.rotateX(Math.PI / 2);
    g.translate(0, -0.6, -D / 2 - 0.03);
    disk.add(withOutline(g, toon(STEEL)));
    const pin = new THREE.MeshBasicMaterial({ color: INK });
    const rim = new THREE.Mesh(new THREE.CircleGeometry(1.33, 40), pin);
    rim.position.set(0, -0.6, -D / 2 - 0.002);
    rim.rotation.y = Math.PI;
    disk.add(rim);
    disk.add(decal(0.5, 0.5, pin, 0, -0.6, true, 0.07));
    disk.add(decal(0.32, 0.5, pin, 0.65, -0.6, true, 0.07));
}

// Label, drawn once Poppins is ready so the canvas doesn't fall back to a system font.
async function makeLabel() {
    try { await document.fonts.load('700 120px Poppins'); await document.fonts.load('500 60px Poppins'); } catch (e) {}
    const cw = 1024, ch = 760;
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const x = cv.getContext('2d');
    x.fillStyle = '#f6f3ec';
    x.fillRect(0, 0, cw, ch);
    x.lineWidth = 14;
    x.strokeStyle = '#161616';
    x.strokeRect(7, 7, cw - 14, ch - 14);

    x.fillStyle = '#161616';
    x.textBaseline = 'alphabetic';
    x.font = '700 132px Poppins, sans-serif';
    x.fillText('critic loop', 64, 196);

    x.font = '500 50px Poppins, sans-serif';
    x.fillStyle = '#6d6a63';
    x.fillText('build → critique → fix', 68, 290);

    x.strokeStyle = '#dcd7cb';
    x.lineWidth = 6;
    for (let i = 0; i < 4; i++) {
        const y = 400 + i * 90;
        x.beginPath(); x.moveTo(64, y); x.lineTo(cw - 64, y); x.stroke();
    }

    // Score stamp.
    x.fillStyle = '#e2483d';
    x.beginPath(); x.arc(cw - 190, 560, 118, 0, Math.PI * 2); x.fill();
    x.lineWidth = 12; x.strokeStyle = '#161616'; x.stroke();
    x.fillStyle = '#ffffff';
    x.font = '700 130px Poppins, sans-serif';
    x.textAlign = 'center';
    x.fillText('9', cw - 190, 606);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    // Sits between the shutter and the corner holes.
    const lw = 6.6, lh = lw * ch / cw;
    disk.add(decal(lw, lh, new THREE.MeshBasicMaterial({ map: tex }), 0, -H / 2 + 0.55 + lh / 2));
}
makeLabel();

// Size to the stage.
function fit() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
new ResizeObserver(fit).observe(stage);
fit();

// Motion: a slow turn, a little tilt, and a flick if you drag it.
const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const BASE = still ? 0 : 0.35;
let angle = -0.6, vel = BASE, dragging = false, lastX = 0, lastT = 0;

stage.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastT = performance.now();
    stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const now = performance.now(), dx = e.clientX - lastX;
    angle += dx * 0.012;
    vel = (dx * 0.012) / Math.max((now - lastT) / 1000, 1 / 120);
    lastX = e.clientX; lastT = now;
});
const release = () => { dragging = false; };
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    if (!dragging) {
        vel += (BASE - vel) * Math.min(dt * 1.5, 1);
        angle += vel * dt;
    }
    disk.rotation.set(-0.18 + (still ? 0 : Math.sin(t * 0.6) * 0.04), angle, still ? 0 : Math.sin(t * 0.4) * 0.03);
    disk.position.y = still ? 0 : Math.sin(t * 0.8) * 0.12;
    renderer.render(scene, camera);
});
