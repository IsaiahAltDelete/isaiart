// Seasonal shader tweaks shared by every material: snow settles on anything
// facing the sky as winter sets in, and melts away in spring.
export const snowUniform = { value: 0 };

const VERT_HEAD = 'varying vec3 vSnowW;\n';
const VERT_BODY = `#include <project_vertex>
  #ifdef USE_INSTANCING
    vSnowW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vSnowW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`;
const FRAG_HEAD = `uniform float uSnow;
varying vec3 vSnowW;
float snowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float snowNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(snowHash(i), snowHash(i + vec2(1.0, 0.0)), f.x), mix(snowHash(i + vec2(0.0, 1.0)), snowHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;
const fragBody = (paths, lo, hi, max) => `#include <normal_fragment_maps>
  if (uSnow > 0.001) {
    vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float up = dot(normal, upV);
    float n = snowNoise(vSnowW.xz * 1.7) * 0.65 + snowNoise(vSnowW.xz * 5.3) * 0.35;
    float cover = smoothstep(${lo.toFixed(2)}, ${hi.toFixed(2)}, up) * smoothstep(n * 0.8, n * 0.8 + 0.25, uSnow * 1.15) * ${max.toFixed(2)};
    ${paths ? '#ifdef USE_COLOR\n    cover *= mix(1.0, 0.38, step(vColor.g, vColor.r * 1.02));\n    #endif' : ''}
    ${paths ? '#ifdef USE_COLOR\n    float lane = step(vColor.g, vColor.r * 1.02);\n    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.47, 0.45), lane * uSnow * 0.55);\n    #endif' : ''}
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.97), cover);
  }`;

// patch a material in place; `paths` keeps worn dirt (reddish vertex colour) slushy.
// lo/hi: how flat a face must be to hold snow; max: how white it gets
export function snowPatch(sh, paths = false, lo = 0.28, hi = 0.62, max = 1) {
  sh.uniforms.uSnow = snowUniform;
  sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <project_vertex>', VERT_BODY);
  sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <normal_fragment_maps>', fragBody(paths, lo, hi, max));
}
const plain = sh => snowPatch(sh, false);
const pathy = sh => snowPatch(sh, true);
// buildings: snow only partway up a roof slope and never pure white, so each roof keeps its colour
const built = sh => snowPatch(sh, false, 0.6, 0.98, 0.7);
export function snowify(m, paths = false, kind = null) {
  m.onBeforeCompile = kind === 'built' ? built : paths ? pathy : plain;
  return m;
}
