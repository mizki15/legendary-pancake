import * as THREE from 'three';
import { PLUME_SHADER } from './shaders.js';

// ロケットの見た目。原点 = いちばん下の段の底（エンジン/着陸脚の下端）、+Y = 機首方向。

function lathe(points, segments = 40) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

function paintedTexture(draw, w = 512, h = 512) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function foilNormalMap() {
  // 着陸機の金色の断熱フィルムのしわ
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(128,128,255)';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 6 + Math.random() * 26;
    const nx = 128 + (Math.random() - 0.5) * 120, ny = 128 + (Math.random() - 0.5) * 120;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${nx | 0},${ny | 0},255,0.55)`);
    grad.addColorStop(1, 'rgba(128,128,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

function createPlume(radius, length) {
  const geo = new THREE.CylinderGeometry(radius * 1.6, radius * 0.9, length, 24, 1, true);
  geo.translate(0, -length / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uThrottle: { value: 0 }, uVacuum: { value: 0 } },
    vertexShader: PLUME_SHADER.vertexShader,
    fragmentShader: PLUME_SHADER.fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  mesh.userData.baseRadius = radius;
  mesh.userData.baseLength = length;
  mesh.visible = false;
  return mesh;
}

function createBooster(stage) {
  const g = new THREE.Group();
  const R = stage.radius;
  const bodyTex = paintedTexture((ctx, w, h) => {
    ctx.fillStyle = '#f3f3f1';
    ctx.fillRect(0, 0, w, h);
    // 回転確認用の白黒パターンと文字
    ctx.fillStyle = '#151515';
    ctx.fillRect(0, h * 0.06, w * 0.25, h * 0.06);
    ctx.fillRect(w * 0.5, h * 0.06, w * 0.25, h * 0.06);
    ctx.fillRect(w * 0.25, h * 0.86, w * 0.25, h * 0.08);
    ctx.fillRect(w * 0.75, h * 0.86, w * 0.25, h * 0.08);
    ctx.save();
    ctx.translate(w * 0.38, h * 0.5);
    ctx.rotate(-Math.PI / 2);
    ctx.font = 'bold 54px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PANCAKE-1', 0, 18);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < h; y += 64) ctx.fillRect(0, y, w, 2);
  });
  const white = new THREE.MeshStandardMaterial({ map: bodyTex, roughness: 0.45, metalness: 0.05 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.35, metalness: 0.9 });
  const gray = new THREE.MeshStandardMaterial({ color: 0x6e6e72, roughness: 0.6, metalness: 0.4 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 6.6, 48, 1, true), white);
  body.position.y = 1.2 + 3.3;
  g.add(body);
  const skirt = new THREE.Mesh(lathe([[R * 0.7, 0.9], [R * 1.05, 1.0], [R, 1.25]]), black);
  g.add(skirt);
  // インターステージ（上段のエンジンを覆う）
  const inter = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R, 2.2, 48, 1, true), gray);
  inter.position.y = 7.8 + 1.1;
  g.add(inter);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.05, 8, 48), metal);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 7.8;
  g.add(ring);
  // エンジン 5 基
  const bellGeo = lathe([[0.12, 1.0], [0.18, 0.85], [0.25, 0.5], [0.36, 0.05], [0.38, 0.0]], 24);
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide });
  const nozzles = [];
  const positions = [[0, 0], [0.62, 0], [-0.62, 0], [0, 0.62], [0, -0.62]];
  for (const [x, z] of positions) {
    const bell = new THREE.Mesh(bellGeo, bellMat);
    bell.position.set(x, 0, z);
    g.add(bell);
    nozzles.push(new THREE.Vector3(x, 0.02, z));
  }
  // フィン
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0); finShape.lineTo(0.9, -0.4); finShape.lineTo(0.9, 0.3); finShape.lineTo(0, 2.0); finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.08, bevelEnabled: false });
  finGeo.translate(0, 0, -0.04);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, black);
    fin.position.y = 1.0;
    fin.rotation.y = (i * Math.PI) / 2 + Math.PI / 4;
    fin.position.x = Math.cos(-fin.rotation.y) * R * 0.98;
    fin.position.z = Math.sin(-fin.rotation.y) * R * 0.98;
    g.add(fin);
  }
  const plumes = nozzles.map((n) => {
    const p = createPlume(0.36, 9);
    p.position.copy(n);
    g.add(p);
    return p;
  });
  g.traverse((o) => { if (o.isMesh && !o.material.isShaderMaterial) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, plumes, nozzles, legs: null };
}

function createLander(stage) {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xd6a33a, roughness: 0.32, metalness: 1.0, normalMap: foilNormalMap(), normalScale: new THREE.Vector2(0.7, 0.7) });
  const silver = new THREE.MeshStandardMaterial({ color: 0xc8c8cc, roughness: 0.3, metalness: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: 0xc9c9c4, roughness: 0.55 });
  const black = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.5, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1a2a, roughness: 0.05, metalness: 0.9 });

  // 下降用エンジン
  const bell = new THREE.Mesh(lathe([[0.16, 0.95], [0.22, 0.85], [0.32, 0.6], [0.44, 0.48]], 28), new THREE.MeshStandardMaterial({ color: 0x8b8580, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide }));
  g.add(bell);
  // 下降段（八角形の金色の箱）
  const desc = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 1.0, 8), gold);
  desc.position.y = 1.45;
  desc.rotation.y = Math.PI / 8;
  g.add(desc);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.98, 0.12, 8), black);
  deck.position.y = 2.0;
  deck.rotation.y = Math.PI / 8;
  g.add(deck);
  // 上昇段（キャビン）
  const cabin = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, 1.0, 10), white);
  cabin.position.y = 2.56;
  g.add(cabin);
  const top = new THREE.Mesh(lathe([[0.62, 0], [0.52, 0.35], [0.3, 0.55], [0.18, 0.62], [0, 0.64]], 32), silver);
  top.position.y = 3.06;
  g.add(top);
  for (let i = 0; i < 2; i++) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.32), glass);
    const a = -0.35 + i * 0.7;
    win.position.set(Math.sin(a) * 0.72, 2.66, Math.cos(a) * 0.72);
    win.rotation.y = a;
    win.rotation.x = -0.12;
    g.add(win);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), silver);
  antenna.position.set(0.3, 3.85, 0);
  g.add(antenna);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), silver);
  dish.position.set(0.3, 4.15, 0);
  dish.rotation.x = Math.PI;
  g.add(dish);
  // 姿勢制御用の小型スラスタ
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const rcs = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), black);
    rcs.position.set(Math.cos(a) * 0.8, 2.75, Math.sin(a) * 0.8);
    g.add(rcs);
  }

  // 着陸脚：上端を下降段の側面に取り付け、展開すると足先が y=0 に届く
  const legs = [];
  const strutGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8);
  strutGeo.translate(0, -0.5, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 0.95, 1.8, Math.sin(a) * 0.95);
    pivot.rotation.y = -a;
    const arm = new THREE.Group();
    pivot.add(arm);
    const strut = new THREE.Mesh(strutGeo, silver);
    strut.scale.y = 2.0;
    arm.add(strut);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 16), silver);
    pad.position.y = -2.0;
    arm.add(pad);
    pad.userData.keepUpright = true;
    const brace = new THREE.Mesh(strutGeo, silver);
    brace.scale.y = 1.15;
    brace.position.set(0, -0.15, 0);
    arm.add(brace);
    g.add(pivot);
    legs.push({ pivot, arm, pad, brace });
  }
  const plume = createPlume(0.44, 5);
  plume.position.y = 0.5;
  g.add(plume);
  g.traverse((o) => { if (o.isMesh && !o.material.isShaderMaterial) { o.castShadow = true; o.receiveShadow = true; } });
  const model = { group: g, plumes: [plume], nozzles: [new THREE.Vector3(0, 0.5, 0)], legs, deploy: 0 };
  setLegDeploy(model, 0);
  return model;
}

// 0 = 折りたたみ, 1 = 展開。展開時は足先が y=0 で地面に接する。
export function setLegDeploy(model, t) {
  if (!model.legs) return;
  model.deploy = t;
  // 展開角：ピボット（高さ1.8）から長さ2の脚を傾け、足先を高さ0に届かせる
  const open = Math.acos(1.8 / 2.0);
  const angle = THREE.MathUtils.lerp(-0.05, open, t);
  for (const leg of model.legs) {
    leg.arm.rotation.z = angle;
    leg.arm.scale.y = THREE.MathUtils.lerp(0.62, 1.0, t);
    leg.pad.rotation.z = -angle;
    leg.brace.rotation.z = THREE.MathUtils.lerp(0, -0.5, t);
  }
}

export function createRocketModel(stages) {
  const root = new THREE.Group();
  const parts = [];
  let y = 0;
  for (const s of stages) {
    const m = s.legs ? createLander(s) : createBooster(s);
    m.group.position.y = y;
    m.stage = s;
    root.add(m.group);
    parts.push(m);
    y += s.height;
  }
  const engineLight = new THREE.PointLight(0xffa860, 0, 35, 2);
  engineLight.position.y = -1.5;
  root.add(engineLight);
  return { root, parts, engineLight };
}

// 最下段を外して、残骸用の独立したオブジェクトとして返す
export function detachBottom(model) {
  const part = model.parts.shift();
  if (!part) return null;
  const dy = part.group.position.y + part.stage.height;
  model.root.remove(part.group);
  for (const p of model.parts) p.group.position.y -= dy;
  for (const pl of part.plumes) pl.visible = false;
  return part;
}

export function updatePlumes(model, { throttle, vacuum, time }) {
  const part = model.parts[0];
  for (const p of model.parts) for (const pl of p.plumes) pl.visible = false;
  if (!part) return;
  for (const pl of part.plumes) {
    pl.visible = throttle > 0.001;
    pl.material.uniforms.uTime.value = time;
    pl.material.uniforms.uThrottle.value = Math.min(1, 0.35 + throttle * 0.75);
    pl.material.uniforms.uVacuum.value = vacuum;
    // 真空では炎が横に広がり、大気中では細長くなる
    const len = (0.5 + throttle * 0.6) * (1 + 0.3 * Math.sin(time * 47));
    pl.scale.set(1 + vacuum * 0.9, len * (1 - vacuum * 0.35), 1 + vacuum * 0.9);
  }
  model.engineLight.intensity = throttle > 0 ? (10 + Math.random() * 4) * throttle * (1 - vacuum * 0.6) : 0;
}
