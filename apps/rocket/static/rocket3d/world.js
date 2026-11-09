import * as THREE from 'three';
import { EARTH, MOON, SUN_DIR } from './physics.js';
import { atmosphereShader, patchCloudMaterial, patchEarthMaterial, patchMoonMaterial } from './shaders.js';

const SUN = new THREE.Vector3(...SUN_DIR);
// 太陽光の強さ。大気散乱の計算にも同じ値を使い、地表と空の明るさの比をそろえる。
export const SUN_INTENSITY = 5.0;

// 上下方向のグラデーションだけの環境マップ（空・地面からの照り返し）
function gradientEnv(renderer, stops) {
  const w = 64, h = 64;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const elev = 1 - (y + 0.5) / h * 2; // +1 = 天頂, -1 = 真下
    let c = stops[0][1];
    for (let i = 0; i < stops.length - 1; i++) {
      const [e0, c0] = stops[i], [e1, c1] = stops[i + 1];
      if (elev <= e0 && elev >= e1) {
        const t = (e0 - elev) / (e0 - e1);
        c = [0, 1, 2].map((k) => c0[k] + (c1[k] - c0[k]) * t);
      }
    }
    if (elev < stops[stops.length - 1][0]) c = stops[stops.length - 1][1];
    for (let x = 0; x < w; x++) data.set([c[0], c[1], c[2], 1], (y * w + x) * 4);
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}

export function createWorld(scene, renderer, { lowQuality = false } = {}) {
  const shared = {
    uSunView: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uPixelAngle: { value: 0.001 },
  };

  // ---------- 地球 ----------
  const earthGroup = new THREE.Group(); // 自転する
  scene.add(earthGroup);
  const seg = lowQuality ? 256 : 512;
  const earthMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, emissive: 0x000000, envMapIntensity: 0 });
  patchEarthMaterial(earthMat, {
    uSunView: shared.uSunView,
    uPixelAngle: shared.uPixelAngle,
    uSiteDir: { value: new THREE.Vector3(1, 0, 0) },
    uRadius: { value: EARTH.radius },
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH.radius, seg, seg / 2), earthMat);
  earth.receiveShadow = true;
  earthGroup.add(earth);

  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0 });
  patchCloudMaterial(cloudMat, { uTime: shared.uTime, uPixelAngle: shared.uPixelAngle, uRadius: { value: EARTH.radius }, uSiteDir: { value: new THREE.Vector3(1, 0, 0) } });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(EARTH.radius + 24, seg / 2, seg / 4), cloudMat);
  clouds.renderOrder = 1;
  earthGroup.add(clouds);

  const atmoDef = atmosphereShader({
    planetRadius: EARTH.radius,
    atmosphereRadius: EARTH.radius + EARTH.atmosphereHeight,
    samples: lowQuality ? 8 : 12,
    lightSamples: lowQuality ? 3 : 4,
  });
  atmoDef.uniforms.uSunDir.value = SUN.clone();
  atmoDef.uniforms.uSunIntensity.value = SUN_INTENSITY;
  const atmoMat = new THREE.ShaderMaterial({
    ...atmoDef,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(EARTH.radius + EARTH.atmosphereHeight, 128, 64), atmoMat);
  atmosphere.renderOrder = 2;
  scene.add(atmosphere);

  const pad = createLaunchPad();
  pad.position.set(EARTH.radius, 0, 0);
  pad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  earthGroup.add(pad);

  // ---------- 月 ----------
  const moonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 0 });
  patchMoonMaterial(moonMat, { uRadius: { value: MOON.radius }, uPixelAngle: shared.uPixelAngle });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON.radius, lowQuality ? 192 : 384, lowQuality ? 96 : 192), moonMat);
  moon.receiveShadow = true;
  scene.add(moon);

  // ---------- 星空と太陽 ----------
  const sky = new THREE.Group(); // 常にカメラの位置に置く（無限遠）
  sky.add(createStars(lowQuality ? 5000 : 9000));
  const sun = createSun();
  sun.position.copy(SUN).multiplyScalar(60000);
  sky.add(sun);
  scene.add(sky);

  // ---------- 光 ----------
  const sunLight = new THREE.DirectionalLight(0xfff4e6, SUN_INTENSITY);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(lowQuality ? 1024 : 2048, lowQuality ? 1024 : 2048);
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight, sunLight.target);
  // 環境光：+Y が「上」。実行時に機体の真上方向へ回転させて使う。
  const envs = {
    sky: gradientEnv(renderer, [[1, [0.18, 0.35, 0.85]], [0.15, [0.45, 0.6, 0.9]], [0, [0.7, 0.75, 0.8]], [-0.05, [0.12, 0.13, 0.08]], [-1, [0.06, 0.07, 0.04]]]),
    space: gradientEnv(renderer, [[1, [0, 0, 0]], [-0.1, [0.004, 0.006, 0.01]], [-0.3, [0.12, 0.2, 0.38]], [-1, [0.22, 0.32, 0.5]]]),
    moon: gradientEnv(renderer, [[1, [0, 0, 0]], [0.0, [0.01, 0.01, 0.01]], [-0.1, [0.25, 0.24, 0.23]], [-1, [0.3, 0.29, 0.28]]]),
  };

  return {
    earthGroup, earth, clouds, atmosphere, atmoMat, pad, moon, sky, sun, sunLight, envs, shared,
    sunDir: SUN,
  };
}

function createLaunchPad() {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8a8782, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb33a2a, roughness: 0.55, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });

  // 地球の丸みに合わせて少し曲げた円盤
  const disk = new THREE.CircleGeometry(26, 48, 0, Math.PI * 2);
  disk.rotateX(-Math.PI / 2);
  const p = disk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, 0.05 - (x * x + z * z) / (2 * EARTH.radius));
  }
  disk.computeVertexNormals();
  const base = new THREE.Mesh(disk, concrete);
  base.receiveShadow = true;
  g.add(base);

  // パッドのローカル座標: +X = 南（初期カメラ側）, +Z = 西, -X = 北
  const trench = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 3.2), dark);
  trench.position.set(-6, 0.02, 0);
  g.add(trench);

  // 発射塔（格子状の鉄塔）
  const tower = new THREE.Group();
  const H = 17;
  for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, H, 0.18), steel);
    leg.position.set(x, H / 2, z);
    tower.add(leg);
  }
  for (let y = 1; y < H; y += 1.6) {
    for (const rot of [0, Math.PI / 2]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.1), steel);
      brace.position.y = y;
      brace.rotation.y = rot;
      brace.position.x = rot ? 0.8 : 0;
      brace.position.z = rot ? 0 : 0.8;
      tower.add(brace);
      const brace2 = brace.clone();
      brace2.position.x = rot ? -0.8 : 0;
      brace2.position.z = rot ? 0 : -0.8;
      tower.add(brace2);
    }
    const diag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.08), steel);
    diag.position.set(0, y + 0.8, 0.8);
    diag.rotation.z = 0.8;
    tower.add(diag);
  }
  for (const y of [7.5, 12.5]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 0.5), steel);
    arm.position.set(-1.9, y, 0);
    tower.add(arm);
  }
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.1) }));
  light.position.set(0, H + 0.3, 0);
  tower.add(light);
  // 塔はロケットの西側（カメラから見て左）に置き、アームをロケットへ向ける
  tower.position.set(0, 0, 4.2);
  tower.rotation.y = -Math.PI / 2;
  tower.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.add(tower);

  // 燃料タンク
  for (const [x, z, r] of [[-12, -8, 1.6], [-15, -4, 1.3], [-10, 13, 2]]) {
    const tank = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.45, metalness: 0.1 }));
    tank.position.set(x, r, z);
    tank.castShadow = true;
    g.add(tank);
  }
  return g;
}

function createStars(count) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const R = 90000;
  // 天の川の帯（傾いた大円）付近に星を多めに置く
  const bandNormal = new THREE.Vector3(0.3, 0.9, 0.3).normalize();
  const v = new THREE.Vector3();
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    if (i % 2 === 0) {
      // 帯に寄せる
      v.addScaledVector(bandNormal, -v.dot(bandNormal) * (0.85 + Math.random() * 0.15)).normalize();
    }
    pos.set([v.x * R, v.y * R, v.z * R], i * 3);
    const mag = Math.pow(Math.random(), 6);
    const temp = Math.random();
    tmp.setRGB(temp < 0.3 ? 1.0 : 0.8 + temp * 0.2, 0.85 + temp * 0.1, temp > 0.7 ? 1.0 : 0.75 + temp * 0.25);
    const b = 0.25 + mag * 3.5;
    col.set([tmp.r * b, tmp.g * b, tmp.b * b], i * 3);
    size[i] = 1.0 + mag * 2.5;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec3 color;
      varying vec3 vColor;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      uniform float uOpacity;
      void main() {
        vec2 d = gl_PointCoord * 2.0 - 1.0;
        float a = smoothstep(1.0, 0.0, dot(d, d));
        gl_FragColor = vec4(vColor * a * uOpacity, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const stars = new THREE.Points(geo, mat);
  stars.name = 'stars';
  stars.frustumCulled = false;
  stars.renderOrder = -10;
  return stars;
}

function createSun() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.06, 'rgba(255,250,235,1)');
  grad.addColorStop(0.1, 'rgba(255,230,190,0.5)');
  grad.addColorStop(0.3, 'rgba(255,200,140,0.08)');
  grad.addColorStop(1, 'rgba(255,180,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(12, 11, 10), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(9000);
  sprite.renderOrder = -9;
  return sprite;
}
