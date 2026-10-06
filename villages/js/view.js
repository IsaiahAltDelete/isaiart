// Rendering: terrain, water, instanced forest, camera rig and input.
import * as THREE from '../vendor/three.module.min.js';
import { N, HALF, idx, tileX, tileZ, T_WATER, T_SAND, toWorld } from './world.js';
import { fbm, mulberry32, hash2 } from './rng.js';
import { pineGeo, roundGeo, treeGeos, stumpGeo, rockGeo, bushGeo, berriesGeo } from './models.js';
import { iconImage } from './icons.js';
import { snowPatch, snowify } from './snow.js';
import { surfaceTexture, mapBoxSurface } from './textures.js';

const CH = 16;               // chunk size for instanced forest culling
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export const timeUniform = { value: 0 };
export const iceUniform = { value: 0 };
// Trees sway in the breeze. The instance colour is the tree's leaf colour for
// the season (green, blossom, autumn gold, bare winter twigs); trunks keep
// their own brown. Leaves are told apart from bark by their greener vertex colour.
function swayMaterial() {
  // smooth: the Blender trees carry their own normals (soft canopies, faceted pine skirts)
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader = 'uniform float uTime;\nattribute float snowy;\nvarying float vSnowy;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vSnowy = snowy;
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3][0] * 0.7 + instanceMatrix[3][2] * 0.45;
        float sw = max(position.y - 0.35, 0.0);
        transformed.x += sin(uTime * 1.4 + ph) * 0.035 * sw;
        transformed.z += cos(uTime * 1.1 + ph) * 0.025 * sw;
      #endif`).replace('#include <color_vertex>', `vColor = color;
      #ifdef USE_INSTANCING_COLOR
        float leaf = step(color.r * 1.15, color.g);
        float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
        vColor = mix(color * mix(vec3(1.0), instanceColor, 0.12), instanceColor * (0.62 + lum * 1.35), leaf);
        vColor = mix(vColor, vec3(0.95, 0.97, 1.0), snowy);   // modelled snow caps stay white
      #endif`);
    snowPatch(sh, false, 0.6, 0.9, 0.35);    // only a light frost from the shader: the trees carry modelled snow caps
    // the caps only exist in deep snow
    sh.fragmentShader = 'varying float vSnowy;\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n  if (vSnowy > 0.5 && uSnow < 0.4) discard;');
  };
  return m;
}

// seasonal leaf colours: pines stay evergreen, round trees blossom, turn and go bare
const LEAF = {
  pine: [0x4aa44c, 0x3a8c42, 0x34813f, 0x2e6d3e],
  round: [[0xf4b3c9, 0xf7eef2, 0x84c855, 0x7cc24e], [0x5aab3e], [0xe0702a, 0xd8a62c, 0xc4442e, 0x9aa83a], [0x3f5f3a, 0x48683f]]   // winter: deep green under the modelled snow caps,
};
const _la = new THREE.Color(), _lb = new THREE.Color(), _tilt = new THREE.Euler();
export function leafColor(kind, tint, si, out) {
  if (kind === 0) return out.setHex(LEAF.pine[si]);
  const list = LEAF.round[si];
  if (si === 0) return out.setHex(tint < 0.22 ? list[0] : tint < 0.34 ? list[1] : tint < 0.7 ? list[2] : list[3]);
  if (si === 2) return out.setHex(list[Math.min(3, (tint * 4.4) | 0)]);
  return out.setHex(list[(tint * list.length) | 0] ?? list[0]);
}
// grass hue / saturation / lightness per season
const GRASS = [[0.275, 0.6, 0.44], [0.262, 0.55, 0.42], [0.19, 0.5, 0.42], [0.22, 0.28, 0.45]];

export class View {
  constructor(canvas, world, quality = 'high') {
    this.world = world;
    this.canvas = canvas;
    this.season = { a: 0, b: 0, k: 1 };    // blend from season a to season b
    this.quality = quality;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.maxRatio = Math.min(devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1);
    this.ratio = this.maxRatio;
    r.setPixelRatio(this.ratio);
    r.shadowMap.enabled = quality !== 'low';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9cd3c0);
    scene.fog = new THREE.Fog(0x9cd3c0, 55, 120);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
    this.rig = { tx: 0, tz: 0, dist: 30, yaw: 0.55, pitch: 0.92, vx: 0, vz: 0 };
    this.fly = null;

    this.hemi = new THREE.HemisphereLight(0xfff6e2, 0x5d8a3a, 1.55);
    scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d0, 2.5);
    sun.castShadow = true;
    const sz = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(sz, sz);
    const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    this.buildTerrain();
    this.buildWater();
    this.buildForest();
    this.buildSkirt();
    this.buildBridges();
    this.buildGrass();

    this.objects = new THREE.Group(); scene.add(this.objects);
    this.fx = new THREE.Group(); scene.add(this.fx);

    // ground-plane picking
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // phones in portrait see less sideways; pull back a little
    this.camera.fov = w / h < 0.8 ? 50 : 38;
    this.camera.updateProjectionMatrix();
  }

  // ── terrain ──
  buildTerrain() {
    const W = this.world, hv = W.hv, V = N + 1;
    const pos = new Float32Array(N * N * 18), col = new Float32Array(N * N * 18);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const o = (z * N + x) * 18;
      const corners = [[x, z], [x, z + 1], [x + 1, z], [x + 1, z + 1], [x + 1, z], [x, z + 1]];
      corners.forEach(([cx, cz], k) => {
        pos[o + k * 3] = cx - HALF; pos[o + k * 3 + 1] = hv[cz * V + cx]; pos[o + k * 3 + 2] = cz - HALF;
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.terrainColor = new THREE.BufferAttribute(col, 3);
    g.setAttribute('color', this.terrainColor);
    this.terrainSurface = new THREE.BufferAttribute(new Float32Array(N * N * 12), 2);   // kept for callers; the ground texture does the blending now
    // smooth normals from the height grid, so gentle slopes don't show as a checker of facets
    const nrm = new Float32Array(N * N * 18), H = (x, z) => hv[Math.max(0, Math.min(N, z)) * V + Math.max(0, Math.min(N, x))];
    for (let k = 0; k < N * N * 6; k++) {
      const cx = Math.round(pos[k * 3] + HALF), cz = Math.round(pos[k * 3 + 2] + HALF);
      const nx = H(cx - 1, cz) - H(cx + 1, cz), nz = H(cx, cz - 1) - H(cx, cz + 1), l = Math.hypot(nx, 2, nz);
      nrm[k * 3] = nx / l; nrm[k * 3 + 1] = 2 / l; nrm[k * 3 + 2] = nz / l;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    this.terrainGeo = g;
    // one texel per tile: R worn dirt, G cobbles, B built road / bridge, A sand & shore.
    // Sampled with bilinear filtering plus a little noise, paths get soft organic edges
    // instead of square tiles.
    this.groundData = new Uint8Array(N * N * 4);
    this.groundTex = new THREE.DataTexture(this.groundData, N, N, THREE.RGBAFormat);
    this.groundTex.magFilter = this.groundTex.minFilter = THREE.LinearFilter;
    this.groundTex.wrapS = this.groundTex.wrapT = THREE.ClampToEdgeWrapping;
    for (let i = 0; i < N * N; i++) this.groundTexel(i);
    this.groundTex.needsUpdate = true;
    this.tc = new Float32Array(N * N * 3);
    const c = new THREE.Color();
    for (let i = 0; i < N * N; i++) { this.tileColor(i, c); this.tc.set([c.r, c.g, c.b], i * 3); }
    for (let i = 0; i < N * N; i++) this.writeTile(i);
    // world-space UVs for a soft painted grass texture multiplied over the tile colours
    const uv = new Float32Array(N * N * 12);
    for (let k = 0; k < N * N * 6; k++) { uv[k * 2] = pos[k * 3] * 0.32; uv[k * 2 + 1] = pos[k * 3 + 2] * 0.32; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, map: surfaceTexture('grass') });
    // The vertex colour is the meadow (or sand); worn paths, roads and cobbles come
    // from the ground texture, with noisy soft edges and a slightly darker rim.
    material.onBeforeCompile = sh => {
      sh.uniforms.uEarth = { value: surfaceTexture('earth') };
      sh.uniforms.uCobble = { value: surfaceTexture('cobble') };
      sh.uniforms.uGround = { value: this.groundTex };
      sh.vertexShader = 'varying vec2 vGW; varying float vGY;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = position.xz; vGY = position.y;');
      sh.fragmentShader = `uniform sampler2D uEarth; uniform sampler2D uCobble; uniform sampler2D uGround; varying vec2 vGW; varying float vGY;
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y); }
        ` + sh.fragmentShader.replace('#include <map_fragment>', `
        vec4 meadow = texture2D(map, vMapUv);
        vec4 earthT = texture2D(uEarth, vMapUv);
        vec4 cobT = texture2D(uCobble, vMapUv * 2.0);
        float n1 = gNoise(vGW * 1.15), n2 = gNoise(vGW * 1.15 + 17.3), n3 = gNoise(vGW * 4.3 + 5.1);
        vec4 gd = texture2D(uGround, (vGW + ${HALF.toFixed(1)}) / ${N.toFixed(1)} + (vec2(n1, n2) - 0.5) * ${(0.7 / N).toFixed(5)});
        float sandK = smoothstep(0.25, 0.75, gd.a);
        vec3 base = diffuseColor.rgb * mix(vColor * meadow.rgb, vec3(0.89, 0.81, 0.57) * earthT.rgb, sandK);   // vertex colour folded in here (color_fragment is dropped below)
        float fringe = smoothstep(0.0, 0.2, gd.g + (n3 - 0.5) * 0.12);              // worn earth all round the cobbles
        float wv = max(gd.r, gd.b);
        float road = smoothstep(0.3, 0.6, gd.b);
        float dirt = max(smoothstep(0.32, 0.6, wv + (n3 - 0.5) * 0.24), fringe * 0.95);
        // grass creeping back in round the edges of bare ground (roads keep a cleaner line)
        float edgeK = 1.0 - smoothstep(0.62, 0.97, wv);
        float speck = smoothstep(0.58, 0.72, gNoise(vGW * 3.3 + 9.1) * 0.65 + n3 * 0.35);
        dirt *= 1.0 - speck * edgeK * (1.0 - road * 0.7) * (1.0 - fringe) * 0.85;
        float cob = smoothstep(0.5, 0.68, gd.g + (n3 - 0.5) * 0.08);             // grout bed stops at the kerb line
        // two tones: a darker, scuffed centre and a lighter, compacted edge, under gentle low-frequency value noise
        float lowN = gNoise(vGW * 0.31 + 2.3) * 0.6 + gNoise(vGW * 0.83 + 7.7) * 0.4;
        vec3 wornC = vec3(0.55, 0.375, 0.19), packedC = vec3(0.69, 0.52, 0.3);
        vec3 dirtC = mix(mix(wornC, packedC, clamp(edgeK * 0.9 + (n3 - 0.5) * 0.2, 0.0, 1.0)), vec3(0.66, 0.46, 0.22), road * 0.45)
          * earthT.rgb * (0.84 + lowN * 0.3);
        dirtC = mix(dirtC, vec3(0.5, 0.42, 0.33) * earthT.rgb, fringe * (1.0 - cob) * 0.35);   // the gritty margin beside the cobbles
        vec3 col = mix(base, dirtC, dirt * (1.0 - sandK * 0.6));
        col *= 1.0 - dirt * (1.0 - dirt) * 4.0 * 0.13 * (1.0 - sandK);          // a soft trodden rim
        // cobbles: flat setts laid flush in a dark gritty bed. A staggered grid (5 a tile) of
        // rounded stones, each its own warm grey, lit from the top-left, with the bed showing
        // through the joints.
        vec3 bed = vec3(0.43, 0.38, 0.32) * mix(cobT.rgb, earthT.rgb, 0.5);
        vec2 sp = vGW * 5.0;
        float sRow = floor(sp.y);
        sp.x += mod(sRow, 2.0) * 0.5 + (gHash(vec2(sRow, 7.3)) - 0.5) * 0.3;
        vec2 sCell = floor(sp), sf = fract(sp) - 0.5;
        float sr1 = gHash(sCell + 3.1), sr2 = gHash(sCell + 11.7), sr3 = gHash(sCell + 23.9);
        sf += (vec2(sr1, sr2) - 0.5) * 0.07;
        vec2 sq = abs(sf) - vec2(0.37 - sr3 * 0.06, 0.34 - sr1 * 0.05) + 0.2;
        float sd = length(max(sq, 0.0)) + min(max(sq.x, sq.y), 0.0) - 0.2;   // rounded-box distance, < 0 inside the stone
        float aa = fwidth(sd) * 1.2 + 0.006;
        float stone = 1.0 - smoothstep(-aa, aa, sd);
        vec3 stoneC = mix(vec3(0.76, 0.67, 0.54), vec3(0.64, 0.6, 0.55), sr2) * (0.82 + sr1 * 0.28) * mix(vec3(1.0), cobT.rgb * 1.25, 0.3);
        stoneC *= 0.88 + clamp(0.5 - (sf.x - sf.y) * 0.8, 0.0, 1.0) * 0.24;  // a soft dome, lighter towards the top-left
        stoneC *= 1.0 - smoothstep(-0.12, 0.0, sd) * 0.2;                    // a worn, darker rim
        col = mix(col, mix(bed, stoneC, stone), cob);
        float wetK = (1.0 - smoothstep(-0.26, -0.04, vGY)) * gd.a;   // only real shores, not low meadow                          // damp bank below the waterline
        col = mix(col, col * vec3(0.6, 0.64, 0.68), wetK);
        diffuseColor.rgb = col;
        // under snow: built roads and cobbles turn to slush; lanes and trodden ground only thin the snow a little,
        // so the snow round houses matches their snowy ground pads instead of showing worn shapes
        float gPath = max(max(road * dirt, cob * 0.8), dirt * 0.35) * (1.0 - sandK);
      `).replace('#include <color_fragment>', '');
      snowPatch(sh, false);   // winter: snow on the meadow…
      sh.fragmentShader = sh.fragmentShader.replace('diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.97), cover);',
        // …and cold slush on paths and roads
        'cover *= 1.0 - gPath * 0.62; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.47, 0.45), gPath * uSnow * 0.5); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.97), cover);');
    };
    material.customProgramCacheKey = () => 'villages-storybook-ground-v4-flat-cobbles';
    const m = this.terrain = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    this.scene.add(m);
  }

  tileColor(i, out) {
    const W = this.world, x = tileX(i), z = tileZ(i);
    const t = W.type[i];
    if (t === T_WATER) return out.setHex(0x3a8fb0);
    const n = fbm(x * 0.09, z * 0.09, W.seed + 77);
    // only the smooth meadow colour lives in the vertices; sand, paths and cobbles are blended
    // per pixel from the ground texture, so nothing shows as a tile or a diagonal seam
    const { a, b, k } = this.season, A = GRASS[a], B = GRASS[b];
    out.setHSL(A[0] + (B[0] - A[0]) * k + n * 0.04, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k + n * 0.1);
    return out;
  }
  // the ground texture's texel for a tile (see buildTerrain)
  groundTexel(i) {
    const W = this.world, d = this.groundData, o = i * 4, t = W.type[i];
    const wear = W.road[i] || W.bridge[i] ? 1 : Math.max(0, Math.min(1, (W.wear[i] - 0.12) / 0.6)) * 0.95;
    d[o] = Math.round(Math.max(wear, W.block[i] && t !== T_WATER ? 0.42 : 0) * 255);
    d[o + 1] = W.paved[i] ? 255 : 0;
    d[o + 2] = (W.road[i] || W.bridge[i]) && t !== T_WATER ? 255 : 0;
    d[o + 3] = t === T_SAND || t === T_WATER ? 255 : 0;
  }
  // Each vertex takes the average colour of the (up to 4) tiles sharing its
  // corner, so roads and footpaths blend into soft, rounded shapes instead of
  // hard squares. The second triangle is a touch darker for the faceted look.
  cornerColor(cx, cz, out) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const o = (z * N + x) * 3;
      r += this.tc[o]; g += this.tc[o + 1]; b += this.tc[o + 2]; n++;
    }
    out[0] = r / n; out[1] = g / n; out[2] = b / n;
  }
  writeTile(i) {
    const x = tileX(i), z = tileZ(i), a = this.terrainColor.array, o = i * 18;
    const own = i * 3, tc = this.tc, k = this._ck || (this._ck = [0, 0, 0]);
    const corners = [[x, z], [x, z + 1], [x + 1, z], [x + 1, z + 1], [x + 1, z], [x, z + 1]];
    for (let v = 0; v < 6; v++) {
      this.cornerColor(corners[v][0], corners[v][1], k);
      // every corner is the plain average of its tiles: no per-tile patchwork, no darker
      // second triangle, so the ground reads as one soft surface rather than a grid
      a[o + v * 3] = k[0]; a[o + v * 3 + 1] = k[1]; a[o + v * 3 + 2] = k[2];
    }
  }
  paintTile(i, flag = true) {
    if (this.groundTex) { this.groundTexel(i); this.groundTex.needsUpdate = true; }
    const c = this.tileColor(i, new THREE.Color());
    this.tc.set([c.r, c.g, c.b], i * 3);
    const x = tileX(i), z = tileZ(i);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < N && nz < N) this.writeTile(nz * N + nx);
    }
    if (flag) { this.terrainColor.needsUpdate = true; this.terrainSurface.needsUpdate = true; }
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(N + 4, N + 4, 48, 48);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.MeshPhongMaterial({ color: 0x55bfe8, shininess: 90, specular: 0x9fe3ff, transparent: true, opacity: 0.86 });
    // terrain heights at the tile corners, so the water knows how deep it is everywhere
    const V = N + 1, hd = new Uint8Array(V * V * 4);
    for (let k = 0; k < V * V; k++) hd[k * 4] = Math.max(0, Math.min(255, Math.round((this.world.hv[k] + 1) / 2.5 * 255)));
    const hTex = new THREE.DataTexture(hd, V, V, THREE.RGBAFormat);
    hTex.magFilter = hTex.minFilter = THREE.LinearFilter; hTex.needsUpdate = true;
    // which tiles are water: the plane is cut away over dry land, even where the meadow dips low
    const wd = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) wd[i * 4] = this.world.type[i] === T_WATER ? 255 : 0;
    const mTex = new THREE.DataTexture(wd, N, N, THREE.RGBAFormat);
    mTex.magFilter = mTex.minFilter = THREE.LinearFilter; mTex.needsUpdate = true;
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = timeUniform;
      sh.uniforms.uIce = iceUniform;
      sh.uniforms.uHeight = { value: hTex };
      sh.uniforms.uMask = { value: mTex };
      sh.uniforms.uGroundW = { value: this.groundTex };
      sh.vertexShader = 'uniform float uTime; uniform float uIce; varying vec3 vWW;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y += (sin(position.x * 0.9 + uTime * 1.3) * 0.035 + cos(position.z * 1.1 + uTime * 1.1) * 0.035) * (1.0 - uIce);`)
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `uniform float uTime; uniform float uIce; uniform sampler2D uHeight; varying vec3 vWW;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y); }
        uniform sampler2D uMask; uniform sampler2D uGroundW;
        float wRipple(vec2 p) { float t = uTime;
          return sin(p.x * 1.6 + t * 1.5 + sin(p.y * 0.8 + t * 0.4) * 1.3) * 0.35 + sin(p.y * 2.1 - t * 1.2 + p.x * 0.6) * 0.25 + wNoise(p * 1.7 + vec2(t * 0.35, -t * 0.25)) * 0.6; }
        ` + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec2 wUV = (vWW.xz + ${HALF.toFixed(1)}) / ${N.toFixed(1)};
          float wMask = texture2D(uMask, wUV).r;
          if (wMask < 0.015) discard;
          // Land tiles dip below the waterline at the bank (their bank corners are sunk), so the water plane
          // also reaches a little way over the land there. Keep it off roads, cobbles and bridge landings:
          // cut it exactly at the bank wherever a road meets the water.
          vec4 wG = texture2D(uGroundW, wUV);
          if (wMask < 0.5 && max(wG.g, wG.b) > 0.3) discard;
          float wH = texture2D(uHeight, (vWW.xz + ${(HALF + 0.5).toFixed(1)}) / ${(N + 1).toFixed(1)}).r * 2.5 - 1.0;
          float depth = clamp((-0.16 - wH) / 0.55, 0.0, 1.0);          // 0 at the waterline, 1 in the deeps
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          vec3 deepC = diffuseColor.rgb * vec3(0.36, 0.58, 0.8);
          vec3 shallowC = mix(diffuseColor.rgb, vec3(0.5, 0.86, 0.78) * (0.15 + lum * 1.5), 0.5 * (1.0 - uIce));
          vec3 wc = mix(shallowC, deepC, smoothstep(0.08, 0.95, depth));
          wc *= 0.95 + 0.07 * clamp(wRipple(vWW.xz * 0.8), -0.6, 1.2) * (1.0 - uIce);   // gentle moving light and shade
          // foam: a solid lip right at the bank, and a broken band that breathes in and out
          float fn = wNoise(vWW.xz * 2.3 + vec2(uTime * 0.22, -uTime * 0.17));
          float swell = 0.2 + 0.06 * sin(uTime * 1.1 + vWW.x * 0.6 + vWW.z * 0.4);
          float foam = (1.0 - smoothstep(0.0, swell, depth)) * smoothstep(0.38, 0.6, fn + 0.22) * 0.85;
          foam = max(foam, 1.0 - smoothstep(0.04, 0.15, depth));
          foam *= 1.0 - uIce;
          wc = mix(wc, vec3(0.95, 0.98, 0.97) * (0.3 + lum * 1.25), foam * 0.9);
          diffuseColor.rgb = wc;
          diffuseColor.a = max(diffuseColor.a * mix(0.6, 1.0, smoothstep(0.0, 0.45, depth)), foam * 0.92);
          float wShore = 1.0 - smoothstep(0.0, 0.3, depth);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          { float e = 0.12, k = 0.12 * (1.0 - uIce * 0.9);
            float r0 = wRipple(vWW.xz), rx = wRipple(vWW.xz + vec2(e, 0.0)), rz = wRipple(vWW.xz + vec2(0.0, e));
            vec3 nW = normalize(vec3(-(rx - r0) / e * k, 1.0, -(rz - r0) / e * k));
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz); }`)
        .replace('#include <opaque_fragment>', `
          { float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
            #ifdef USE_FOG
              outgoingLight = mix(outgoingLight, fogColor * 1.05, fres * 0.32 * (1.0 - uIce * 0.5));
            #endif
            float sp = wNoise(vWW.xz * 7.0 + vec2(uTime * 0.9, uTime * 0.6)) * wNoise(vWW.xz * 5.3 - vec2(uTime * 0.7, -uTime * 0.4));
            outgoingLight += vec3(1.0, 0.96, 0.86) * smoothstep(0.8, 0.92, sp) * 0.7 * smoothstep(0.25, 0.55, lum) * (1.0 - uIce) * (1.0 - wShore * 0.6); }
          #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'villages-water-v2';
    const water = this.water = new THREE.Mesh(geo, m);
    water.position.y = -0.18; water.receiveShadow = true;
    this.scene.add(water);
    // lily pads + sparkles
    const rng = mulberry32(this.world.seed + 5);
    const pads = [];
    for (let i = 0; i < N * N; i++) {
      if (this.world.type[i] !== T_WATER || rng() > 0.03) continue;
      pads.push([toWorld(tileX(i)) + (rng() - 0.5) * 0.6, toWorld(tileZ(i)) + (rng() - 0.5) * 0.6, 0.18 + rng() * 0.15, rng() * 6]);
    }
    const pg = new THREE.CylinderGeometry(1, 1, 0.02, 9, 1, false, 0.4, Math.PI * 2 - 0.8);
    const pm = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ color: 0x5aa83c, flatShading: true }), pads.length);
    pads.forEach(([x, z, s, r], k) => { tmpQ.setFromAxisAngle(UP, r); pm.setMatrixAt(k, tmpM.compose(tmpV.set(x, -0.12, z), tmpQ, tmpS.set(s, 1, s))); });
    this.scene.add(pm); this.pads = pm;
    const blooms = pads.filter((p, k) => k % 3 === 0);
    const bm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 0).scale(1, 0.6, 1), new THREE.MeshLambertMaterial({ flatShading: true }), blooms.length);
    blooms.forEach(([x, z, s, r], k) => { bm.setMatrixAt(k, tmpM.compose(tmpV.set(x + Math.cos(r) * s * 0.35, -0.08, z + Math.sin(r) * s * 0.35), tmpQ.identity(), tmpS.set(1, 1, 1))); bm.setColorAt(k, tmpC.setHex(k % 2 ? 0xf7c6da : 0xfff6f0)); });
    pm.add(bm);
    this.buildReeds(rng);
  }

  // reeds and cattails in clumps along the banks (sand tiles touching the water)
  buildReeds(rng) {
    const W = this.world, spots = [];
    for (let i = 0; i < N * N; i++) {
      if (W.type[i] !== T_SAND || W.road[i] || W.occ[i] >= 0) continue;
      const x = tileX(i), z = tileZ(i);
      let wet = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz; if (nx >= 0 && nz >= 0 && nx < N && nz < N && W.type[nz * N + nx] === T_WATER) wet++; }
      if (wet && rng() < 0.32) spots.push(i);
    }
    const parts = [];
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3, r = 0.05 + (k % 2) * 0.07, h = 0.45 + (k % 3) * 0.12;
      parts.push(new THREE.ConeGeometry(0.025, h, 3).translate(Math.cos(a) * r, h / 2, Math.sin(a) * r).rotateZ((k - 2) * 0.06));
    }
    const reedGeo = mergeSimple(parts);
    const tops = mergeSimple([0, 2].map(k => new THREE.CylinderGeometry(0.03, 0.03, 0.12, 5).translate(Math.cos(k * 1.3) * 0.05, 0.5 + k * 0.04, Math.sin(k * 1.3) * 0.05)));
    const mk = (geo, color) => new THREE.InstancedMesh(geo, snowify(new THREE.MeshLambertMaterial({ color, flatShading: true })), spots.length);
    const reeds = mk(reedGeo, 0x6f9a3e), heads = mk(tops, 0x7a4a26), reedMats = [];
    spots.forEach((i, k) => {
      const x = toWorld(tileX(i)) + (rng() - 0.5) * 0.6, z = toWorld(tileZ(i)) + (rng() - 0.5) * 0.6, s = 0.75 + rng() * 0.5;
      tmpQ.setFromAxisAngle(UP, rng() * 6.28);
      tmpM.compose(tmpV.set(x, W.heightAt(x, z) - 0.02, z), tmpQ, tmpS.set(s, s, s));
      reeds.setMatrixAt(k, tmpM); heads.setMatrixAt(k, tmpM); reedMats.push(tmpM.clone());
    });
    reeds.castShadow = true;
    this.scene.add(reeds, heads); this.reeds = reeds;
    this.reedAt = new Map(spots.map((i, k) => [i, k])); this.reedMats = reedMats; this.reedHeads = heads;
  }

  // little grass tufts and wildflowers scattered over open meadow
  buildGrass() {
    const W = this.world, rng = mulberry32(W.seed + 31);
    const tuft = new THREE.ConeGeometry(0.045, 0.26, 3); tuft.translate(0, 0.13, 0);
    const parts = [];
    for (const [x, z, r] of [[0, 0, 0], [0.07, 0.03, 0.4], [-0.06, 0.04, -0.4], [0.02, -0.07, 0.2]]) {
      const g = tuft.clone(); g.rotateZ(r * 0.6); g.rotateX(r * -0.4); g.translate(x, 0, z); parts.push(g);
    }
    const tGeo = mergeSimple(parts);
    const fGeo = mergeSimple([new THREE.CylinderGeometry(0.01, 0.01, 0.2, 3).translate(0, 0.1, 0), new THREE.IcosahedronGeometry(0.05, 0).translate(0, 0.22, 0)]);
    const spots = [], flowers = [], piles = [];
    for (let i = 0; i < N * N; i++) {
      if (W.type[i] !== 0 || W.road[i]) continue;
      const r = rng();
      if (r < 0.32) spots.push(i); else if (r < 0.4) flowers.push(i); else if (r < 0.47) piles.push(i);
    }
    // little heaps of fallen leaves, only shown in autumn
    const pGeo = mergeSimple([0, 1, 2, 3].map(k => new THREE.IcosahedronGeometry(0.13 - k * 0.015, 0).scale(1, 0.32, 1).translate(Math.cos(k * 2.2) * 0.12 * (k > 0), 0.03, Math.sin(k * 2.2) * 0.12 * (k > 0))));
    const mk = (geo, list, colorFn) => {
      const im = new THREE.InstancedMesh(geo, snowify(new THREE.MeshLambertMaterial({ flatShading: true })), list.length);
      im.userData.map = new Int32Array(N * N).fill(-1);
      im.userData.mats = [];
      list.forEach((i, k) => {
        const x = toWorld(tileX(i)) + (rng() - 0.5) * 0.7, z = toWorld(tileZ(i)) + (rng() - 0.5) * 0.7, s = 0.7 + rng() * 0.7;
        tmpQ.setFromAxisAngle(UP, rng() * 6.28);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, W.heightAt(x, z), z), tmpQ, new THREE.Vector3(s, s, s));
        im.setMatrixAt(k, m); im.userData.mats.push(m);
        im.setColorAt(k, colorFn(i));
        im.userData.map[i] = k;
      });
      im.receiveShadow = true;
      this.scene.add(im);
      return im;
    };
    this.tufts = mk(tGeo, spots, i => tmpC.setHSL(0.26 + fbm(tileX(i) * 0.09, tileZ(i) * 0.09, W.seed + 77) * 0.05, 0.6, 0.38));
    this.tuftTiles = spots;
    const pal = [0xf06292, 0xffd54f, 0xffffff, 0xba68c8, 0x64b5f6, 0xff8a65];
    this.flowers = mk(fGeo, flowers, () => tmpC.setHex(pal[(rng() * pal.length) | 0]));
    const lpal = [0xe0702a, 0xd8a62c, 0xc4442e, 0xe8892e];
    this.piles = mk(pGeo, piles, () => tmpC.setHex(lpal[(rng() * lpal.length) | 0]));
    this.piles.visible = false;
    this.buildLitter(rng);
    for (let i = 0; i < N * N; i++) { this.updateGrass(i); if (W.paved[i]) this.updatePave(i); }
  }
  // little things lying on bare, trodden ground (shown only while a tile is worn)
  buildLitter(rng) {
    const W = this.world, R = (i, k) => hash2(i, k, 97);
    const pebble = mergeSimple([[0, 0, 0.06], [0.09, 0.05, 0.045], [-0.07, 0.06, 0.035]].map(([x, z, r]) => new THREE.IcosahedronGeometry(r, 0).scale(1, 0.5, 0.85).translate(x, r * 0.25, z)));
    const twig = mergeSimple([new THREE.BoxGeometry(0.26, 0.018, 0.022).translate(0, 0.01, 0), new THREE.BoxGeometry(0.1, 0.014, 0.016).rotateY(0.7).translate(0.06, 0.01, 0.03)]);
    const leaf = mergeSimple([0, 1, 2].map(k => new THREE.CylinderGeometry(0.035, 0.035, 0.008, 5).scale(1.5, 1, 0.8).rotateY(k * 2.1).translate(Math.cos(k * 2.1) * 0.07, 0.005 + k * 0.003, Math.sin(k * 2.1) * 0.07)));
    const tuft = new THREE.ConeGeometry(0.035, 0.18, 3).translate(0, 0.09, 0);
    const creep = mergeSimple([[0, 0, 0], [0.05, 0.03, 0.4], [-0.05, 0.02, -0.4], [0.02, -0.05, 0.2]].map(([x, z, r]) => tuft.clone().rotateZ(r * 0.6).translate(x, 0, z)));
    const sets = [
      { geo: pebble, p: 0.5, cols: [0x9a948a, 0x857d72, 0xb0a898, 0x8c7a66] },
      { geo: twig, p: 0.12, cols: [0x6b4a2c, 0x7a5434] },
      { geo: leaf, p: 0.16, cols: [0xa8743a, 0x8f6a30, 0xb88a3c, 0x7d6a34] },
      { geo: creep, p: 0.6, cols: [0x5f9a3c, 0x6aa443], creep: true },
    ];
    this.litter = sets.map((st, n) => {
      const tiles = [];
      for (let i = 0; i < N * N; i++) if (W.type[i] === 0 && R(i, n) < st.p) tiles.push(i);
      const im = new THREE.InstancedMesh(st.geo, snowify(new THREE.MeshLambertMaterial({ flatShading: true })), tiles.length);
      im.userData = { map: new Map(), creep: !!st.creep, n };
      tiles.forEach((i, k) => {
        im.userData.map.set(i, k); im.setMatrixAt(k, tmpM.makeScale(0, 0, 0));
        im.setColorAt(k, tmpC.setHex(st.cols[(R(i, n + 7) * st.cols.length) | 0]));
      });
      im.receiveShadow = true; im.frustumCulled = false;
      this.scene.add(im);
      return im;
    });
  }
  updateLitter(i) {
    if (!this.litter) return;
    const W = this.world, x = tileX(i), z = tileZ(i);
    const bareOf = j => (W.wear[j] > 0.45 || W.road[j]) && !W.paved[j] && !W.bridge[j] && W.occ[j] < 0 && W.type[j] === 0;
    const bare = bareOf(i);
    for (const im of this.litter) {
      const k = im.userData.map.get(i); if (k === undefined) continue;
      let show = bare && W.tree[i] < 0 && W.rock[i] < 0, ox = 0, oz = 0;
      if (show && im.userData.creep) {
        // tufts only where bare ground meets grass, leaning toward the grass side
        let g = null;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz; if (nx >= 0 && nz >= 0 && nx < N && nz < N && W.type[nz * N + nx] === 0 && W.wear[nz * N + nx] < 0.3 && !W.road[nz * N + nx] && W.occ[nz * N + nx] < 0) { g = [dx, dz]; break; } }
        show = !!g && !W.road[i]; if (g) { ox = g[0] * 0.36; oz = g[1] * 0.36; }
      }
      if (show) {
        const n = im.userData.n, h = (q) => hash2(i, q + n * 13, 61);
        const px = toWorld(x) + ox + (h(1) - 0.5) * (im.userData.creep ? 0.3 : 0.7), pz = toWorld(z) + oz + (h(2) - 0.5) * (im.userData.creep ? 0.3 : 0.7);
        const s = 0.8 + h(3) * 0.5;
        tmpQ.setFromAxisAngle(UP, h(4) * 6.28);
        im.setMatrixAt(k, tmpM.compose(tmpV.set(px, W.heightAt(px, pz) + 0.004, pz), tmpQ, tmpS.set(s, s, s)));
      } else im.setMatrixAt(k, tmpM.makeScale(0, 0, 0));
      im.instanceMatrix.needsUpdate = true;
    }
  }
  // kerbs along the edges of paved tiles (the setts themselves are painted into the ground shader)
  updatePave(i) {
    const W = this.world;
    if (!this.kerbs) {
      // kerb blocks: elongated, bevelled along the top edges, flat-shaded so each face catches the light
      const kg = new THREE.BoxGeometry(0.3, 0.11, 0.13, 1, 1, 1), kp = kg.attributes.position;
      for (let v = 0; v < kp.count; v++) if (kp.getY(v) > 0) { kp.setX(v, kp.getX(v) * 0.9); kp.setZ(v, kp.getZ(v) * 0.7); }
      kg.computeVertexNormals();
      const km = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
      km.onBeforeCompile = sh => snowPatch(sh, false, 0.75, 0.99, 0.5);
      this.kerbs = new THREE.InstancedMesh(kg, km, 12000);
      this.kerbs.castShadow = this.kerbs.receiveShadow = true; this.kerbs.frustumCulled = false; this.kerbs.count = 0;
      for (let k = 0; k < 12000; k++) { this.kerbs.setMatrixAt(k, tmpM.makeScale(0, 0, 0)); this.kerbs.setColorAt(k, tmpC.setHex(0x6b6e72)); }
      this.kerbs.userData = { free: [], used: 0, cap: 12000, slots: new Map(), sig: new Map() };
      this.scene.add(this.kerbs);
    }
    const kb = this.kerbs, ku = kb.userData, want = W.paved[i] && W.occ[i] < 0;
    const x = tileX(i), z = tileZ(i), open = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dz]) => {
      const nx = x + dx, nz = z + dz;
      return nx >= 0 && nz >= 0 && nx < N && nz < N && !W.paved[nz * N + nx] && !W.bridge[nz * N + nx];
    });
    const sig = want ? 'p' + open.map(Number).join('') : '';
    if ((ku.sig.get(i) || '') === sig) return;
    ku.sig.set(i, sig);
    const kHave = ku.slots.get(i);
    if (kHave) { for (const slot of kHave) { kb.setMatrixAt(slot, tmpM.makeScale(0, 0, 0)); ku.free.push(slot); } ku.slots.delete(i); }
    if (want) {
      const x0 = toWorld(tileX(i)), z0 = toWorld(tileZ(i));
      // kerb: three rectangular blocks laid end to end (thin joints) along each edge that meets the verge,
      // a shade darker and cooler than the setts, standing proud so the outer face steps down to the dirt
      const kslots = [];
      open.forEach((o, e) => {
        if (!o) return;
        const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][e];
        for (let k = 0; k < 3; k++) {
          const slot = ku.free.length ? ku.free.pop() : (ku.used < ku.cap ? ku.used++ : -1); if (slot < 0) break;
          const h = q => hash2(i, k + e * 3, q);
          const along = (k - 1) * 0.32 + (h(21) - 0.5) * 0.012;
          const px = x0 + dx * 0.43 + (dz ? along : 0), pz = z0 + dz * 0.43 + (dx ? along : 0);
          tmpQ.setFromAxisAngle(UP, (dx ? Math.PI / 2 : 0) + (h(23) - 0.5) * 0.05);
          const gy = Math.min(W.heightAt(px, pz), W.heightAt(px + dx * 0.06, pz + dz * 0.06));
          kb.setMatrixAt(slot, tmpM.compose(tmpV.set(px, gy + 0.03, pz), tmpQ, tmpS.set(1 - h(22) * 0.04, 1 + h(25) * 0.12, 1)));
          const t = h(24);
          kb.setColorAt(slot, tmpC.setRGB(0.37 + t * 0.05, 0.39 + t * 0.05, 0.42 + t * 0.05));
          kslots.push(slot);
        }
      });
      ku.slots.set(i, kslots);
    }
    kb.count = ku.used;
    kb.instanceMatrix.needsUpdate = true; if (kb.instanceColor) kb.instanceColor.needsUpdate = true;
  }
  updateGrass(i) {
    const W = this.world;
    this.updateLitter(i);
    const hide = W.occ[i] >= 0 || W.paved[i] || W.road[i] || W.wear[i] > 0.35 || W.tree[i] >= 0 || W.rock[i] >= 0 || W.bush[i] >= 0;
    const rk = this.reedAt?.get(i);
    if (rk !== undefined) {
      const x = tileX(i), z = tileZ(i);
      let nearBridge = false;
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz; if (nx >= 0 && nz >= 0 && nx < N && nz < N && W.bridge[nz * N + nx]) nearBridge = true; }
      const m = hide || nearBridge ? tmpM.makeScale(0, 0, 0) : this.reedMats[rk];
      this.reeds.setMatrixAt(rk, m); this.reedHeads.setMatrixAt(rk, m);
      this.reeds.instanceMatrix.needsUpdate = this.reedHeads.instanceMatrix.needsUpdate = true;
    }
    for (const im of [this.tufts, this.flowers, this.piles]) {
      if (!im) continue;
      const k = im.userData.map[i];
      if (k < 0) continue;
      im.setMatrixAt(k, hide ? tmpM.makeScale(0, 0, 0) : im.userData.mats[k]);
      im.instanceMatrix.needsUpdate = true;
    }
  }

  buildBridges() {
    const wood = new THREE.MeshLambertMaterial({ color: 0xb98450, flatShading: true, map: surfaceTexture('wood') });
    const dark = new THREE.MeshLambertMaterial({ color: 0x7a5232, flatShading: true, map: surfaceTexture('wood') });
    for (const b of this.world.bridges) {
      const g = new THREE.Group();
      const x0 = b.x0 - HALF - 0.6, x1 = b.x1 - HALF + 1.6, len = x1 - x0, cz = b.z - HALF + 1;
      for (let k = 0; k < Math.ceil(len / 0.32); k++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 1.9), k % 3 ? wood : dark);
        const x = x0 + 0.16 + k * 0.32, arch = Math.sin((x - x0) / len * Math.PI) * 0.22;
        p.position.set(x, 0.12 + arch, cz); p.castShadow = p.receiveShadow = true; g.add(p);
      }
      for (const side of [-0.95, 0.95]) {
        for (let k = 0; k <= 4; k++) {
          const x = x0 + 0.2 + k * (len - 0.4) / 4, arch = Math.sin((x - x0) / len * Math.PI) * 0.22;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.08), dark);
          post.position.set(x, 0.32 + arch, cz + side); post.castShadow = true; g.add(post);
        }
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len - 0.3, 0.06, 0.07), wood);
        rail.position.set(x0 + len / 2, 0.58 + 0.15, cz + side); g.add(rail);
      }
      g.traverse(m => { if (m.isMesh) mapBoxSurface(m.geometry, 'wood'); });
      for (const ex of [x0 + 0.15, x1 - 0.15]) g.add(abutment(ex, cz, Math.PI / 2, 2.2, this.world));
      this.scene.add(g);
    }
  }

  buildSkirt() {
    // forest floor beyond the map edge (four strips framing the square map)
    // plus a ring of decorative trees so the world never ends in a cliff
    const m = this.skirtMat = snowify(new THREE.MeshLambertMaterial({ color: 0x4d8a38 }));
    const F = 260;
    for (const [w, d, x, z] of [[2 * F, F, 0, -HALF - F / 2], [2 * F, F, 0, HALF + F / 2], [F, N, -HALF - F / 2, 0], [F, N, HALF + F / 2, 0]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), m);
      p.position.set(x, 0.9, z); p.receiveShadow = true; this.scene.add(p);
    }
    const rng = mulberry32(this.world.seed + 99);
    const spots = [[], []];
    const B = 14;
    for (let z = -B; z < N + B; z++) for (let x = -B; x < N + B; x++) {
      if (x >= 0 && z >= 0 && x < N && z < N) continue;
      if (rng() > 0.8) continue;
      spots[rng() < 0.55 ? 0 : 1].push([x - HALF + 0.5 + (rng() - 0.5) * 0.6, z - HALF + 0.5 + (rng() - 0.5) * 0.6, 0.85 + rng() * 0.6, rng() * 6, rng()]);
    }
    // chunked like the forest, so only the stretch of the ring that's on screen is drawn
    // (one mesh for the whole ring meant ~1.4M triangles every frame, nearly all off screen)
    this.skirtTrees = [];
    spots.forEach((list, kind) => {
      const cells = new Map();
      for (const p of list) { const key = Math.floor((p[0] + HALF + B) / CH) + ',' + Math.floor((p[1] + HALF + B) / CH); (cells.get(key) || cells.set(key, []).get(key)).push(p); }
      for (const part of cells.values()) {
        const im = new THREE.InstancedMesh(kind ? this.roundG : this.pineG, this.treeMat, part.length);
        part.forEach(([x, z, s, r, t], k) => {
          tmpQ.setFromAxisAngle(UP, r);
          im.setMatrixAt(k, tmpM.compose(tmpV.set(x, 0.88, z), tmpQ, tmpS.set(s, s * (0.9 + t * 0.3), s)));
        });
        im.computeBoundingSphere(); im.frustumCulled = true;
        im.userData = { kind, tints: part.map(p => p[4]) };
        im.receiveShadow = true;
        this.scene.add(im); this.skirtTrees.push(im);
      }
    });
    this.colorSkirt();
  }

  // ── forest (instanced, chunked so off-screen chunks are culled) ──
  buildForest() {
    const W = this.world;
    this.pineG = pineGeo(); this.roundG = roundGeo();
    this.treeMat = swayMaterial();
    // several shapes per kind so the forest doesn't repeat; each tree keeps its shape by position
    const tg = treeGeos();
    this.treeTypes = [...tg.pine, ...tg.round]; this.nPine = tg.pine.length; this.nRound = tg.round.length;
    const TT = this.TT = this.treeTypes.length;
    const plain = snowify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const CN = N / CH;
    this.chunks = [];
    const counts = new Array(CN * CN * TT).fill(0);
    for (const t of W.trees) counts[(((t.tz / CH) | 0) * CN + ((t.tx / CH) | 0)) * TT + this.treeType(t)]++;
    for (let k = 0; k < CN * CN * TT; k++) {
      const cap = counts[k] + 24;
      const im = new THREE.InstancedMesh(this.treeTypes[k % TT], this.treeMat, cap);
      im.castShadow = true; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const cx = ((k / TT | 0) % CN) * CH - HALF + CH / 2, cz = ((k / TT / CN) | 0) * CH - HALF + CH / 2;
      im.frustumCulled = true;
      im.userData = { used: 0, free: [], cx, cz };
      for (let s = 0; s < cap; s++) { im.setMatrixAt(s, tmpM.makeScale(0, 0, 0)); im.setColorAt(s, tmpC.setRGB(1, 1, 1)); }
      im.count = cap;
      this.chunks.push(im);
      this.scene.add(im);
    }
    for (let ti = 0; ti < W.trees.length; ti++) if (W.trees[ti].alive) this.placeTree(ti);
    for (const im of this.chunks) this.fixBounds(im);

    // stumps
    this.stumps = new THREE.InstancedMesh(stumpGeo(), plain, 1500);
    this.stumps.userData = { free: [], used: 0 };
    for (let s = 0; s < 1500; s++) this.stumps.setMatrixAt(s, tmpM.makeScale(0, 0, 0));
    this.stumps.castShadow = true; this.stumps.frustumCulled = false;
    this.scene.add(this.stumps);

    // rocks
    this.rockMesh = new THREE.InstancedMesh(rockGeo(), plain, W.rocks.length + 1);
    this.rockMesh.castShadow = true; this.rockMesh.receiveShadow = true; this.rockMesh.frustumCulled = false;
    W.rocks.forEach((r, k) => this.updateRock(k));
    this.scene.add(this.rockMesh);

    // bushes + berries
    this.bushMesh = new THREE.InstancedMesh(bushGeo(), plain, W.bushes.length + 1);
    this.berryMesh = new THREE.InstancedMesh(berriesGeo(), plain, W.bushes.length + 1);
    this.bushMesh.castShadow = true; this.bushMesh.frustumCulled = false; this.berryMesh.frustumCulled = false;
    W.bushes.forEach((b, k) => this.updateBush(k));
    this.scene.add(this.bushMesh, this.berryMesh);
  }
  fixBounds(im) {
    im.boundingSphere = new THREE.Sphere(new THREE.Vector3(im.userData.cx, 1, im.userData.cz), CH * 0.75 + 2);
  }
  treeType(t) { const h = ((t.tx * 73856093) ^ (t.tz * 19349663)) >>> 0; return t.kind ? this.nPine + h % this.nRound : h % this.nPine; }
  chunkFor(t) { const CN = N / CH; return this.chunks[(((t.tz / CH) | 0) * CN + ((t.tx / CH) | 0)) * this.TT + this.treeType(t)]; }
  placeTree(ti) {
    const t = this.world.trees[ti];
    const im = this.chunkFor(t), u = im.userData;
    let slot = u.free.length ? u.free.pop() : (u.used < im.count ? u.used++ : -1);
    if (slot < 0) return;
    t.slot = slot;
    this.updateTree(ti);
  }
  updateTree(ti) {
    const t = this.world.trees[ti];
    if (t.slot === undefined) return;
    const im = this.chunkFor(t);
    if (!t.alive) {
      im.setMatrixAt(t.slot, tmpM.makeScale(0, 0, 0));
      im.userData.free.push(t.slot); t.slot = undefined;
    } else {
      const s = t.s * Math.max(0.05, t.growth);
      // a slight lean so rows of trees don't stand to attention
      tmpQ.setFromEuler(_tilt.set((t.tint - 0.5) * 0.12, t.rot, Math.sin(t.rot * 3.1) * 0.06));
      im.setMatrixAt(t.slot, tmpM.compose(tmpV.set(t.x, this.world.heightAt(t.x, t.z) - 0.02, t.z), tmpQ, tmpS.set(s, s * (0.9 + t.tint * 0.3), s)));
      this.treeColor(t, tmpC);
      im.setColorAt(t.slot, tmpC);
      im.instanceColor.needsUpdate = true;
    }
    im.instanceMatrix.needsUpdate = true;
  }
  // the season's leaf colour for a tree, blended while one season turns into the next
  treeColor(t, out) {
    if (t.marked) return out.setHex(0xe4794e);
    const { a, b, k } = this.season;
    leafColor(t.kind, t.tint, b, out);
    if (k < 1) { leafColor(t.kind, t.tint, a, _la); out.lerp(_la, 1 - k); }
    return out.multiplyScalar(0.86 + t.tint * 0.26);
  }
  colorSkirt() {
    const { a, b, k } = this.season;
    for (const im of this.skirtTrees) {
      im.userData.tints.forEach((t, j) => {
        leafColor(im.userData.kind, t, b, tmpC);
        if (k < 1) { leafColor(im.userData.kind, t, a, _lb); tmpC.lerp(_lb, 1 - k); }
        im.setColorAt(j, tmpC.multiplyScalar(0.8 + t * 0.25));
      });
      im.instanceColor.needsUpdate = true;
    }
  }
  // repaint everything that changes colour with the seasons
  setSeason(a, b, k) {
    const S = this.season;
    if (S.a === a && S.b === b && Math.abs(S.k - k) < 1e-3) return;
    Object.assign(S, { a, b, k });
    const W = this.world;
    for (let ti = 0; ti < W.trees.length; ti++) { const t = W.trees[ti]; if (t.alive && t.slot !== undefined) { this.treeColor(t, tmpC); this.chunkFor(t).setColorAt(t.slot, tmpC); } }
    for (const im of this.chunks) if (im.instanceColor) im.instanceColor.needsUpdate = true;
    this.colorSkirt();
    const c = new THREE.Color();
    for (let i = 0; i < N * N; i++) { this.tileColor(i, c); this.tc.set([c.r, c.g, c.b], i * 3); }
    for (let i = 0; i < N * N; i++) this.writeTile(i);
    this.terrainColor.needsUpdate = true;
    // tufts: fresh green → golden → straw
    const tuftHSL = [[0.27, 0.62, 0.4], [0.26, 0.6, 0.38], [0.15, 0.55, 0.42], [0.13, 0.25, 0.5]];
    const A = tuftHSL[a], B = tuftHSL[b];
    this.tuftTiles.forEach((i, j) => this.tufts.setColorAt(j, c.setHSL(A[0] + (B[0] - A[0]) * k + fbm(tileX(i) * 0.09, tileZ(i) * 0.09, W.seed + 77) * 0.05, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k)));
    this.tufts.instanceColor.needsUpdate = true;
    const sk = [[0.28, 0.45, 0.36], [0.27, 0.42, 0.35], [0.2, 0.42, 0.34], [0.22, 0.2, 0.4]];
    const SA = sk[a], SB = sk[b];
    this.skirtMat.color.setHSL(SA[0] + (SB[0] - SA[0]) * k, SA[1] + (SB[1] - SA[1]) * k, SA[2] + (SB[2] - SA[2]) * k);
    // wildflowers: plenty in spring and summer, gone under the snow
    this.flowers.visible = b !== 3 || k < 0.5;
    this.piles.visible = (b === 2 && k > 0.3) || (a === 2 && k < 0.5);
  }
  addStump(x, z) {
    const u = this.stumps.userData;
    const slot = u.free.length ? u.free.pop() : (u.used < 1500 ? u.used++ : -1);
    if (slot < 0) return -1;
    tmpQ.setFromAxisAngle(UP, Math.random() * 6);
    this.stumps.setMatrixAt(slot, tmpM.compose(tmpV.set(x, this.world.heightAt(x, z) - 0.02, z), tmpQ, tmpS.set(1, 1, 1)));
    this.stumps.instanceMatrix.needsUpdate = true;
    return slot;
  }
  removeStump(slot) {
    if (slot < 0) return;
    this.stumps.setMatrixAt(slot, tmpM.makeScale(0, 0, 0));
    this.stumps.instanceMatrix.needsUpdate = true;
    this.stumps.userData.free.push(slot);
  }
  updateRock(k) {
    const r = this.world.rocks[k];
    const s = r.alive ? r.s * (0.45 + 0.55 * r.hp / 100) : 0;
    tmpQ.setFromAxisAngle(UP, r.rot);
    this.rockMesh.setMatrixAt(k, tmpM.compose(tmpV.set(r.x, this.world.heightAt(r.x, r.z) - 0.05, r.z), tmpQ, tmpS.set(s * 1.6, s * 1.6, s * 1.6)));
    this.rockMesh.instanceMatrix.needsUpdate = true;
  }
  updateBush(k) {
    const b = this.world.bushes[k];
    const s = b.alive ? b.s : 0;
    tmpQ.setFromAxisAngle(UP, k * 1.7);
    tmpM.compose(tmpV.set(b.x, this.world.heightAt(b.x, b.z) - 0.03, b.z), tmpQ, tmpS.set(s, s, s));
    this.bushMesh.setMatrixAt(k, tmpM);
    if (!b.ripe || !b.alive) tmpM.makeScale(0, 0, 0);
    this.berryMesh.setMatrixAt(k, tmpM);
    this.bushMesh.instanceMatrix.needsUpdate = true; this.berryMesh.instanceMatrix.needsUpdate = true;
  }

  // ── camera ──
  updateCamera(dt) {
    const r = this.rig;
    if (this.fly) {
      const f = this.fly; f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
      r.tx = f.x0 + (f.x1 - f.x0) * e; r.tz = f.z0 + (f.z1 - f.z0) * e;
      if (f.d1) r.dist = f.d0 + (f.d1 - f.d0) * e;
      if (f.t >= 1) this.fly = null;
    } else if (Math.abs(r.vx) + Math.abs(r.vz) > 0.001) {
      r.tx += r.vx * dt; r.tz += r.vz * dt;
      const k = Math.pow(0.004, dt); r.vx *= k; r.vz *= k;
    }
    const lim = HALF - 8;
    r.tx = Math.max(-lim, Math.min(lim, r.tx)); r.tz = Math.max(-lim, Math.min(lim, r.tz));
    r.dist = Math.max(9, Math.min(64, r.dist));
    // keep the haze behind the village however far out we zoom
    this.scene.fog.near = r.dist + 22; this.scene.fog.far = r.dist + 95;
    r.pitch = Math.max(0.62, Math.min(1.32, r.pitch));
    const cp = Math.cos(r.pitch), sp = Math.sin(r.pitch);
    const ty = this.world.heightAt(r.tx, r.tz) * 0.5;
    this.camera.position.set(r.tx + Math.sin(r.yaw) * cp * r.dist, ty + sp * r.dist, r.tz + Math.cos(r.yaw) * cp * r.dist);
    this.camera.lookAt(r.tx, ty, r.tz);
    // sun + shadow camera follow the view
    this.sun.position.set(r.tx + 18, 34, r.tz + 10);
    this.sun.target.position.set(r.tx, 0, r.tz);
    const span = Math.min(42, 14 + r.dist * 0.75);
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - span) > 0.5) { sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.updateProjectionMatrix(); }
  }
  flyTo(x, z, dist, dur = 0.9) {
    this.fly = { t: 0, dur, x0: this.rig.tx, z0: this.rig.tz, x1: x, z1: z, d0: this.rig.dist, d1: dist };
  }
  groundAt(clientX, clientY, out = new THREE.Vector3()) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera({ x: nx, y: ny }, this.camera);
    // refine against terrain height: march the ray
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let t = (0.1 - o.y) / d.y;
    for (let k = 0; k < 4; k++) {
      const p = tmpV.copy(d).multiplyScalar(t).add(o);
      const h = this.world.heightAt(p.x, p.z);
      t = (Math.max(h, -0.18) - o.y) / d.y;
    }
    return out.copy(d).multiplyScalar(t).add(o);
  }
  raycast(clientX, clientY, objects) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera({ x: nx, y: ny }, this.camera);
    return this.ray.intersectObjects(objects, true);
  }
  project(v) {
    const p = tmpV.copy(v).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: (p.x * 0.5 + 0.5) * rect.width + rect.left, y: (-p.y * 0.5 + 0.5) * rect.height + rect.top, vis: p.z < 1 && p.z > -1 };
  }

  // dynamic resolution: drop pixel ratio when frames are slow, recover when fast
  adapt(dt) {
    this.ft = (this.ft ?? 16) * 0.95 + dt * 1000 * 0.05;
    this.adaptT = (this.adaptT || 0) + dt;
    if (this.adaptT < 2) return;
    this.adaptT = 0;
    let r = this.ratio;
    if (this.ft > 38 && r > 0.75) r = Math.max(0.75, r - 0.25);
    else if (this.ft < 22 && r < this.maxRatio) r = Math.min(this.maxRatio, r + 0.25);
    if (r !== this.ratio) { this.ratio = r; this.renderer.setPixelRatio(r); this.resize(); }
  }

  render() { this.renderer.render(this.scene, this.camera); }
}

// chunky stones where a bridge meets the bank: a footing block with a few rounded caps
const abutMat = snowify(new THREE.MeshLambertMaterial({ color: 0x8f8a80, flatShading: true }));
const abutMat2 = snowify(new THREE.MeshLambertMaterial({ color: 0xa39d90, flatShading: true }));
export function abutment(x, z, rotY, width, W) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY;
  const top = 0.12, base = Math.min(-0.45, W.heightAt(x, z) - 0.15);
  const block = new THREE.Mesh(new THREE.BoxGeometry(width, top - base, 0.5), abutMat);
  block.position.y = (top + base) / 2; block.castShadow = block.receiveShadow = true; g.add(block);
  const n = Math.max(3, Math.round(width / 0.32));
  for (let k = 0; k < n; k++) {
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + ((k * 37) % 5) * 0.015, 0), k % 2 ? abutMat : abutMat2);
    s.scale.set(1.1, 0.7, 1); s.position.set(-width / 2 + 0.1 + k * (width - 0.2) / (n - 1), top - 0.02, ((k * 53) % 3 - 1) * 0.12);
    s.rotation.y = k * 1.7; s.castShadow = true; g.add(s);
  }
  for (const sx of [-1, 1]) { const c = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), abutMat); c.scale.set(1, 0.8, 1); c.position.set(sx * (width / 2 + 0.05), base * 0.4, 0.18); c.castShadow = true; g.add(c); }
  return g;
}

function mergeSimple(list) {
  const geos = list.map(g => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3); let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.computeVertexNormals();
  return out;
}

// ── status bubbles above buildings (sprites drawn from SVG icons) ──
const bubbleCache = new Map();
export function bubbleTexture(icon) {
  if (bubbleCache.has(icon)) return bubbleCache.get(icon);
  const cv = document.createElement('canvas'); cv.width = 96; cv.height = 112;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 96, 112);
    g.fillStyle = '#fffaf0'; g.strokeStyle = '#8a5a2b'; g.lineWidth = 5;
    g.beginPath(); g.roundRect(6, 6, 84, 80, 22); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(36, 84); g.lineTo(48, 104); g.lineTo(60, 84); g.closePath(); g.fill(); g.stroke();
    g.fillRect(38, 78, 20, 8);
    const img = iconImage(icon);
    if (img.complete && img.naturalWidth) { g.drawImage(img, 18, 16, 60, 60); tex.needsUpdate = true; tex.userData.ready = true; }
    else img.addEventListener('load', draw, { once: true });
  };
  draw();
  bubbleCache.set(icon, tex);
  return tex;
}
