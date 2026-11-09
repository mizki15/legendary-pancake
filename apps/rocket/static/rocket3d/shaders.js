// 地球・月・大気を手続き的（テクスチャ画像なし）に描くシェーダー。
// MeshStandardMaterial を onBeforeCompile で拡張し、影や光源の計算は three.js に任せる。

export const NOISE_GLSL = /* glsl */ `
vec3 rk_hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float rk_hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
// 勾配ノイズ（-1..1）
float rk_noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define RK_G(c) dot(rk_hash33(i + c) * 2.0 - 1.0, f - c)
  float n000 = RK_G(vec3(0,0,0)); float n100 = RK_G(vec3(1,0,0));
  float n010 = RK_G(vec3(0,1,0)); float n110 = RK_G(vec3(1,1,0));
  float n001 = RK_G(vec3(0,0,1)); float n101 = RK_G(vec3(1,0,1));
  float n011 = RK_G(vec3(0,1,1)); float n111 = RK_G(vec3(1,1,1));
  #undef RK_G
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z) * 1.6;
}
// 画面上の1画素の大きさ (footprint) より細かいオクターブは消して、ちらつきを防ぐ
float rk_fbm(vec3 p, int octaves, float footprint) {
  float sum = 0.0, amp = 0.5, freq = 1.0;
  for (int i = 0; i < 16; i++) {
    if (i >= octaves) break;
    float fade = 1.0 - smoothstep(0.25, 0.6, footprint * freq);
    if (fade <= 0.0) break;
    sum += amp * fade * rk_noise(p * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}
// 高さ h から法線を傾ける（three.js の bumpmap と同じ考え方）
vec3 rk_perturbNormal(vec3 surfPos, vec3 surfNorm, float h, float strength) {
  vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * strength;
  vec3 vSigmaX = normalize(dFdx(surfPos));
  vec3 vSigmaY = normalize(dFdy(surfPos));
  vec3 vN = surfNorm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surfNorm - vGrad);
}
`;

// 1画素が見込む角度（ラジアン）。距離をかけると画素の大きさになる。
const FOOTPRINT_GLSL = 'uniform float uPixelAngle;\n#define RK_FOOTPRINT (length(vViewPosition) * uPixelAngle * 1.5 / max(0.1, abs(dot(normalize(vViewPosition), normalize(vNormal)))))\n';

function addObjectPositionVarying(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
}

// ---------------- 地球 ----------------
export function patchEarthMaterial(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    addObjectPositionVarying(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vObjPos;
${FOOTPRINT_GLSL}
uniform vec3 uSunView;
uniform vec3 uSiteDir;
uniform float uRadius;
${NOISE_GLSL}
float earthHeight(vec3 dir, float footprint, out float moisture) {
  float fpUnit = footprint / uRadius;
  float continents = rk_fbm(dir * 1.7 + vec3(3.1, 1.7, 0.4), 6, fpUnit * 1.7);
  float detail = rk_fbm(dir * 28.0, 9, fpUnit * 28.0);
  // 発射場（赤道・経度0）の周りは必ず陸地にする
  float site = smoothstep(0.12, 0.02, distance(dir, uSiteDir));
  moisture = rk_fbm(dir * 4.0 + vec3(9.3, 2.1, 5.7), 4, fpUnit * 4.0);
  float h = continents * 0.9 + detail * 0.12 - 0.06;
  // 発射場の周りは低い平地にする
  return mix(h, 0.06 + detail * 0.05, site);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec3 eDir = normalize(vObjPos);
  float eFoot = RK_FOOTPRINT;
  float moisture;
  float h = earthHeight(eDir, eFoot, moisture);
  float lat = abs(eDir.y);
  float land = smoothstep(0.0, 0.015, h);
  vec3 deep = vec3(0.008, 0.03, 0.085);
  vec3 shallow = vec3(0.02, 0.1, 0.16);
  vec3 ocean = mix(deep, shallow, smoothstep(-0.25, 0.0, h));
  vec3 forest = vec3(0.045, 0.085, 0.03);
  vec3 grass = vec3(0.12, 0.16, 0.06);
  vec3 desert = vec3(0.46, 0.36, 0.22);
  vec3 rock = vec3(0.22, 0.19, 0.16);
  float dry = smoothstep(0.05, -0.25, moisture) * smoothstep(0.08, 0.3, lat) * smoothstep(0.55, 0.35, lat);
  vec3 ground = mix(mix(forest, grass, smoothstep(-0.1, 0.25, moisture)), desert, dry);
  // 近くで見たときの細かな色むら
  float fine = rk_fbm(vObjPos * 0.6, 8, eFoot * 0.6);
  ground *= 0.85 + 0.3 * fine;
  ground = mix(ground, rock, smoothstep(0.35, 0.6, h));
  float snow = max(smoothstep(0.66, 0.78, lat + h * 0.15), smoothstep(0.62, 0.7, h));
  ground = mix(ground, vec3(0.75, 0.78, 0.82), snow);
  float ice = smoothstep(0.86, 0.9, lat);
  vec3 eColor = mix(ocean, ground, land);
  eColor = mix(eColor, vec3(0.8, 0.84, 0.9), ice);
  diffuseColor.rgb = eColor;
  float eLand = max(land, ice);
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(0.32, 0.92, eLand);
`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  float eGraze = smoothstep(0.03, 0.3, abs(dot(normalize(vViewPosition), normal)));
  normal = rk_perturbNormal(-vViewPosition, normal, h * eLand, 6.0 * eGraze);
`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  // 夜側の街明かり
  float night = smoothstep(0.08, -0.18, dot(normal, uSunView));
  // 遠くから見たときは個々の光ではなく平均的な明るさにする（ちらつき防止）
  float cityCells = rk_hash13(floor(vObjPos * 0.35));
  float cityNear = smoothstep(0.82, 0.98, cityCells);
  float cityFade = smoothstep(0.12, 0.45, eFoot * 0.35);
  float cityDensity = smoothstep(0.08, 0.35, rk_fbm(eDir * 18.0, 4, eFoot / uRadius * 18.0));
  float cities = mix(cityNear, 0.02, cityFade) * cityDensity;
  float coast = smoothstep(0.35, 0.02, h) * land;
  totalEmissiveRadiance += vec3(1.0, 0.62, 0.28) * cities * (0.4 + coast) * night * (1.0 - ice) * 0.8;
`);
  };
  material.customProgramCacheKey = () => 'rocket3d-earth';
}

// ---------------- 雲 ----------------
export function patchCloudMaterial(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    addObjectPositionVarying(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vObjPos;
${FOOTPRINT_GLSL}
uniform float uTime;
uniform float uRadius;
uniform vec3 uSiteDir;
${NOISE_GLSL}`)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
  vec3 cDir = normalize(vObjPos);
  float cFoot = RK_FOOTPRINT / uRadius;
  vec3 drift = vec3(uTime * 0.0004, 0.0, uTime * 0.0002);
  float warp = rk_fbm(cDir * 3.0 + drift, 4, cFoot * 3.0);
  float c = rk_fbm(cDir * 5.0 + warp * 0.6 + drift, 9, cFoot * 5.0);
  float band = 0.15 * cos(cDir.y * 9.0);
  float cover = smoothstep(0.05, 0.4, c + band);
  // 発射場の上空は晴れ
  cover *= smoothstep(0.015, 0.06, distance(cDir, uSiteDir));
  diffuseColor.a *= cover * 0.92;
`);
  };
  material.customProgramCacheKey = () => 'rocket3d-clouds';
}

// ---------------- 月 ----------------
export function patchMoonMaterial(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    addObjectPositionVarying(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vObjPos;
${FOOTPRINT_GLSL}
uniform float uRadius;
${NOISE_GLSL}
// 1 オクターブ分のクレーター（近くのセルの中で最も近い中心だけを使う）
float craterLayer(vec3 p, float cell, float footprint, float density) {
  float fade = 1.0 - smoothstep(0.08, 0.3, footprint / cell);
  if (fade <= 0.0) return 0.0;
  vec3 q = p / cell;
  vec3 iq = floor(q);
  float h = 0.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 c = iq + vec3(x, y, z);
    vec3 rnd = rk_hash33(c);
    if (rk_hash13(c + 7.7) > density) continue;
    vec3 center = c + 0.15 + rnd * 0.7;
    float radius = mix(0.18, 0.48, rk_hash13(c + 3.1));
    float r = length(q - center) / radius;
    if (r > 1.6) continue;
    float bowl = (r * r - 1.0) * 0.55;
    float rim = 0.22 * exp(-pow((r - 1.0) / 0.22, 2.0));
    float shape = r < 1.0 ? bowl + rim : rim;
    h += shape * radius;
  }
  return h * cell * fade;
}
float moonHeight(vec3 p, float footprint) {
  float h = 0.0;
  h += craterLayer(p, 90.0, footprint, 0.55);
  h += craterLayer(p, 30.0, footprint, 0.6);
  h += craterLayer(p, 10.0, footprint, 0.65);
  h += craterLayer(p, 3.4, footprint, 0.7);
  h += craterLayer(p, 1.2, footprint, 0.7);
  h += craterLayer(p, 0.4, footprint, 0.7);
  h += rk_fbm(p * 0.08, 10, footprint * 0.08) * 2.5;
  return h;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float mFoot = RK_FOOTPRINT;
  vec3 mDir = normalize(vObjPos);
  float mh = moonHeight(vObjPos, mFoot);
  // 海（暗い玄武岩の平原）と高地
  float maria = smoothstep(0.05, 0.25, rk_fbm(mDir * 2.2 + vec3(1.3, 4.2, 0.7), 5, mFoot / uRadius * 2.2));
  vec3 highland = vec3(0.2, 0.196, 0.19);
  vec3 mare = vec3(0.1, 0.098, 0.095);
  float speck = rk_fbm(vObjPos * 1.7, 6, mFoot * 1.7);
  vec3 mColor = mix(highland, mare, maria) * (0.9 + 0.2 * speck);
  // 新しいクレーターの周りの明るい噴出物
  mColor *= 1.0 + 0.25 * smoothstep(0.0, 3.0, mh);
  diffuseColor.rgb = mColor;
`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  // 浅い角度から見る縁ではちらつくので凹凸を弱める
  float mGraze = smoothstep(0.03, 0.3, abs(dot(normalize(vViewPosition), normal)));
  normal = rk_perturbNormal(-vViewPosition, normal, mh, mGraze);
`);
  };
  material.customProgramCacheKey = () => 'rocket3d-moon';
}

// ---------------- 大気散乱（レイリー散乱 + ミー散乱） ----------------
export function atmosphereShader({ planetRadius, atmosphereRadius, samples = 12, lightSamples = 4 }) {
  return {
    uniforms: {
      uSunDir: { value: null },
      uPlanetRadius: { value: planetRadius },
      uAtmoRadius: { value: atmosphereRadius },
      uSunIntensity: { value: 22.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWorldPos;
      uniform vec3 uSunDir;
      uniform float uPlanetRadius;
      uniform float uAtmoRadius;
      uniform float uSunIntensity;
      const vec3 BETA_R = vec3(5.8e-3, 13.5e-3, 33.1e-3);
      const float BETA_M = 21e-3;
      const float H_R = 8.0;
      const float H_M = 1.2;
      const float G = 0.76;
      vec2 raySphere(vec3 ro, vec3 rd, float r) {
        float b = dot(ro, rd);
        float c = dot(ro, ro) - r * r;
        float d = b * b - c;
        if (d < 0.0) return vec2(1e9, -1e9);
        d = sqrt(d);
        return vec2(-b - d, -b + d);
      }
      void main() {
        vec3 ro = cameraPosition;
        vec3 rd = normalize(vWorldPos - cameraPosition);
        vec2 ta = raySphere(ro, rd, uAtmoRadius);
        if (ta.x > ta.y) discard;
        float t0 = max(ta.x, 0.0);
        float t1 = ta.y;
        vec2 tp = raySphere(ro, rd, uPlanetRadius);
        if (tp.x > 0.0 && tp.x < tp.y) t1 = min(t1, tp.x);
        if (t1 <= t0) discard;
        float seg = (t1 - t0) / float(${samples});
        vec3 sumR = vec3(0.0), sumM = vec3(0.0);
        float odR = 0.0, odM = 0.0;
        for (int i = 0; i < ${samples}; i++) {
          vec3 p = ro + rd * (t0 + seg * (float(i) + 0.5));
          float h = length(p) - uPlanetRadius;
          float dR = exp(-h / H_R) * seg;
          float dM = exp(-h / H_M) * seg;
          odR += dR; odM += dM;
          // 太陽までの光学的厚さ
          vec2 tl = raySphere(p, uSunDir, uAtmoRadius);
          vec2 tlp = raySphere(p, uSunDir, uPlanetRadius);
          if (tlp.x > 0.0 && tlp.x < tlp.y) continue; // 地球の影
          float lseg = tl.y / float(${lightSamples});
          float lR = 0.0, lM = 0.0;
          for (int j = 0; j < ${lightSamples}; j++) {
            vec3 q = p + uSunDir * (lseg * (float(j) + 0.5));
            float lh = max(0.0, length(q) - uPlanetRadius);
            lR += exp(-lh / H_R) * lseg;
            lM += exp(-lh / H_M) * lseg;
          }
          vec3 tau = BETA_R * (odR + lR) + BETA_M * 1.1 * (odM + lM);
          vec3 att = exp(-tau);
          sumR += dR * att;
          sumM += dM * att;
        }
        float mu = dot(rd, uSunDir);
        float phaseR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
        float g2 = G * G;
        float phaseM = 3.0 / (8.0 * 3.14159265) * ((1.0 - g2) * (1.0 + mu * mu)) /
                       ((2.0 + g2) * pow(1.0 + g2 - 2.0 * G * mu, 1.5));
        vec3 col = uSunIntensity * (sumR * BETA_R * phaseR + sumM * BETA_M * phaseM);
        gl_FragColor = vec4(col, 1.0);
      }`,
  };
}

// ---------------- エンジンの炎 ----------------
export const PLUME_SHADER = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform float uTime;
    uniform float uThrottle;
    uniform float uVacuum;
    ${NOISE_GLSL}
    void main() {
      float along = 1.0 - vUv.y;         // 0 = ノズル出口, 1 = 炎の先端
      float flicker = 0.8 + 0.4 * rk_noise(vec3(vUv.x * 6.0, along * 8.0 - uTime * 30.0, uTime * 3.0));
      float core = exp(-along * mix(3.0, 6.0, uVacuum));
      // 大気中のショックダイヤモンド
      float diamonds = (1.0 - uVacuum) * 0.5 * pow(max(0.0, sin(along * 34.0)), 6.0) * exp(-along * 4.0);
      vec3 hot = vec3(1.0, 0.95, 0.85);
      vec3 mid = mix(vec3(1.0, 0.45, 0.12), vec3(0.55, 0.6, 1.0), uVacuum);
      vec3 col = mix(mid, hot, core) * (core * 3.0 + diamonds * 4.0 + 0.4 * exp(-along * 2.0));
      float a = (core + diamonds + 0.25 * exp(-along * 1.5)) * flicker * uThrottle * (1.0 - along);
      gl_FragColor = vec4(col * a * 1.3, 1.0);
    }`,
};

// ---------------- 煙・砂ぼこり・火花の粒子 ----------------
export const PARTICLE_SHADER = {
  vertexShader: /* glsl */ `
    attribute float aSize;
    attribute vec4 aColor;
    varying vec4 vColor;
    uniform float uPixelScale;
    void main() {
      vColor = aColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = clamp(aSize * uPixelScale / -mv.z, 0.0, 160.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying vec4 vColor;
    uniform float uAdditive;
    void main() {
      vec2 d = gl_PointCoord * 2.0 - 1.0;
      float r = dot(d, d);
      if (r > 1.0) discard;
      float a = vColor.a * (1.0 - r) * (1.0 - r);
      if (uAdditive > 0.5) gl_FragColor = vec4(vColor.rgb * a, 1.0);
      else gl_FragColor = vec4(vColor.rgb, a);
    }`,
};
