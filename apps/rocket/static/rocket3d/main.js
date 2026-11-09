import * as THREE from 'three';
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } from 'three';
import * as P from './physics.js';
import { createWorld } from './world.js';
import { createRocketModel, detachBottom, setLegDeploy, updatePlumes } from './rocketModel.js';
import { ParticleSystem } from './effects.js';

// ===================== 設定 =====================
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const lowQuality = isTouch || Math.min(screen.width, screen.height) < 700;
if (isTouch) document.body.classList.add('touch');

const WARPS = [1, 2, 5, 10, 25, 50, 100];
const ROT_RATE = 0.9;        // 最大角速度 (rad/s)
const ROT_ACCEL = 2.4;       // 角加速度 (rad/s^2)
const Y = new THREE.Vector3(0, 1, 0);

// ===================== レンダラー =====================
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowQuality ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200000);

const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: lowQuality ? 2 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.4, 1.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  world.shared.uPixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / (h * renderer.getPixelRatio());
  for (const ps of [smoke, fire]) ps.material.uniforms.uPixelScale.value = h * renderer.getPixelRatio() * 0.9;
  const stars = world.sky.getObjectByName('stars');
  stars.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
}

// ===================== ワールド =====================
const world = createWorld(scene, renderer, { lowQuality });
const smoke = new ParticleSystem(scene, { max: lowQuality ? 1200 : 2500, additive: false });
const fire = new ParticleSystem(scene, { max: lowQuality ? 600 : 1200, additive: true });

// 予測軌道の線（地球基準と月基準の2本）
function makeLine(color) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1600 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  line.frustumCulled = false;
  line.renderOrder = 3;
  scene.add(line);
  return line;
}
const earthLine = makeLine(new THREE.Color(0.35, 0.85, 1.3));
const moonLine = makeLine(new THREE.Color(1.4, 0.85, 0.3));
const exitLine = makeLine(new THREE.Color(0.35, 0.85, 1.3)); // 月の影響圏を出た後（地球基準）
exitLine.material.opacity = 0.6;
const trailLine = makeLine(new THREE.Color(0.4, 1.0, 0.5));
trailLine.material.opacity = 0.45;

// 月の公転軌道（マップ用）
const moonOrbit = (() => {
  const pts = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * P.MOON.distance, 0, -Math.sin(a) * P.MOON.distance));
  }
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x4a5a70, transparent: true, opacity: 0.6 }));
  scene.add(l);
  return l;
})();
const soiRing = (() => {
  const pts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * P.MOON.soi, 0, Math.sin(a) * P.MOON.soi));
  }
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7a6a40, transparent: true, opacity: 0.5 }));
  scene.add(l);
  return l;
})();

// ===================== ゲーム状態 =====================
const sim = P.createSim({ moonPhase0: Math.random() * Math.PI * 2 });
const model = createRocketModel(sim.stages);
scene.add(model.root);
const rocketQ = new THREE.Quaternion();
const omega = new THREE.Vector3();
let sasMode = 'stab';
let throttleLevel = 1.0;
let warpIndex = 0;
let viewMode = 'chase'; // chase | landing | map
let autoLandingView = false;
let helpVisible = !isTouch;
let gameEnded = false;
let overlayShown = false;
let frameNo = 0;
let prediction = null;
let legDeployTarget = 0;
const trail = [];
const debrisVisuals = [];
const objectives = { liftoff: false, space: false, orbit: false, soi: false, landed: false };

function siteBasis(up) {
  // 機体の +Z が南（初期カメラ側）を向くように向きを決める
  const east = new THREE.Vector3().crossVectors(Y, up).normalize();
  const north = new THREE.Vector3().crossVectors(up, east);
  const south = north.clone().negate();
  const m = new THREE.Matrix4().makeBasis(east, up, south);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
rocketQ.copy(siteBasis(new THREE.Vector3(...sim.nose)));

// ===================== 入力 =====================
const keys = new Set();
const touchState = { thrust: false, left: false, right: false, fwd: false, back: false };

function toast(text, ms = 1800) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.style.opacity = 1;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.style.opacity = 0; }, ms);
}

function setWarp(i) {
  const max = maxWarpIndex();
  const n = Math.max(0, Math.min(i, WARPS.length - 1));
  if (n > max) {
    warpIndex = max;
    if (n > 0) toast(max === 0 ? '今は時間加速できません（大気中・天体の近く・噴射中）' : `この高度では ×${WARPS[max]} までです`);
  } else {
    warpIndex = n;
  }
}

function setSas(mode) {
  sasMode = mode;
  const names = { stab: '安定', pro: '順行', retro: '逆行', up: '天頂' };
  document.getElementById('t-sas').textContent = names[mode];
  toast('姿勢制御: ' + names[mode] + (mode === 'pro' ? '（進行方向へ向ける）' : mode === 'retro' ? '（進行方向の逆へ向ける＝減速用）' : mode === 'up' ? '（真上へ向ける）' : '（回転を止めて保持）'));
}

function doStage() {
  if (gameEnded) return;
  if (sim.status === 'prelaunch') { toast('打ち上げてから切り離してください'); return; }
  if (sim.stages.length <= 1) { toast('これ以上切り離せる段はありません'); return; }
  const piece = P.stageSeparation(sim);
  const part = detachBottom(model);
  if (piece && part) {
    scene.add(part.group);
    part.group.position.set(0, 0, 0);
    debrisVisuals.push({ piece, part, q: rocketQ.clone() });
    // 切り離しの白煙
    const n = new THREE.Vector3(...sim.nose);
    for (let i = 0; i < 40; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      d.addScaledVector(n, -d.dot(n)).normalize();
      smoke.emit(sim.pos, [sim.vel[0] + d.x * 4, sim.vel[1] + d.y * 4, sim.vel[2] + d.z * 4], { life: 2.5, size0: 0.4, size1: 3, color: [0.9, 0.9, 0.92, 0.5], drag: 0.6 });
    }
    legDeployTarget = 1;
    toast('第1段を切り離しました。着陸脚を展開');
  }
}

const KEYMAP_PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
window.addEventListener('keydown', (e) => {
  if (KEYMAP_PREVENT.has(e.code)) e.preventDefault();
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  switch (e.code) {
    case 'Space': doStage(); break;
    case 'Digit1': setSas('stab'); break;
    case 'Digit2': setSas('pro'); break;
    case 'Digit3': setSas('retro'); break;
    case 'Digit4': setSas('up'); break;
    case 'Period': setWarp(warpIndex + 1); break;
    case 'Comma': setWarp(warpIndex - 1); break;
    case 'KeyZ': throttleLevel = Math.min(1, throttleLevel + 0.1); break;
    case 'KeyX': throttleLevel = Math.max(0.05, throttleLevel - 0.1); break;
    case 'KeyC': cycleView(); break;
    case 'KeyM': toggleMap(); break;
    case 'KeyH': helpVisible = !helpVisible; document.getElementById('help').style.display = helpVisible ? '' : 'none'; break;
    case 'KeyR': location.reload(); break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); for (const k in touchState) touchState[k] = false; });
document.getElementById('help-close').addEventListener('click', () => { helpVisible = false; document.getElementById('help').style.display = 'none'; });

function cycleView() {
  viewMode = viewMode === 'chase' ? 'landing' : viewMode === 'landing' ? 'map' : 'chase';
  applyViewDefaults();
}
function toggleMap() {
  viewMode = viewMode === 'map' ? 'chase' : 'map';
  applyViewDefaults();
}

// カメラ: ロケットの周りを回る（角度は地平面基準）
const cam = { theta: Math.PI, phi: 0.12, dist: 34, mapTheta: -Math.PI / 2, mapPhi: 1.25, mapDist: 6000 };
const smoothed = { center: new THREE.Vector3(), up: new THREE.Vector3(), pos: new THREE.Vector3(), init: false };
function applyViewDefaults() {
  if (viewMode === 'landing') { cam.dist = 26; cam.phi = 0.08; }
  if (viewMode === 'chase') { cam.dist = Math.max(cam.dist, 20); if (cam.dist > 400) cam.dist = 34; }
  const names = { chase: '追従', landing: '着陸', map: 'マップ' };
  document.getElementById('h-view').textContent = names[viewMode];
}

let drag = null;
let pinch = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  canvas.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId || pinch) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (viewMode === 'map') {
    cam.mapTheta -= dx * 0.005;
    cam.mapPhi = THREE.MathUtils.clamp(cam.mapPhi + dy * 0.005, 0.05, 1.5);
  } else {
    cam.theta -= dx * 0.006;
    cam.phi = THREE.MathUtils.clamp(cam.phi + dy * 0.006, -1.45, 1.45);
  }
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom(Math.exp(e.deltaY * 0.0012));
}, { passive: false });
function zoom(f) {
  if (viewMode === 'map') cam.mapDist = THREE.MathUtils.clamp(cam.mapDist * f, 600, 140000);
  else cam.dist = THREE.MathUtils.clamp(cam.dist * f, 7, 5000);
}
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    const [a, b] = e.touches;
    pinch = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && pinch) {
    const [a, b] = e.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    zoom(pinch / d);
    pinch = d;
  }
}, { passive: true });
canvas.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; }, { passive: true });

// スマホのボタン
function holdButton(id, key) {
  const el = document.getElementById(id);
  const on = (e) => { e.preventDefault(); touchState[key] = true; el.classList.add('active'); };
  const off = (e) => { e.preventDefault(); touchState[key] = false; el.classList.remove('active'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}
holdButton('t-thrust', 'thrust');
holdButton('t-left', 'left');
holdButton('t-right', 'right');
holdButton('t-fwd', 'fwd');
holdButton('t-back', 'back');
const tap = (id, fn) => document.getElementById(id).addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
tap('t-stage', doStage);
tap('t-sas', () => setSas({ stab: 'pro', pro: 'retro', retro: 'up', up: 'stab' }[sasMode]));
tap('t-warp-up', () => setWarp(warpIndex + 1));
tap('t-warp-down', () => setWarp(0));
tap('t-view', cycleView);
tap('t-map', toggleMap);
document.querySelectorAll('#sas-modes .chip').forEach((el) => {
  el.style.pointerEvents = 'auto';
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => setSas(el.dataset.sas));
});
(() => {
  const el = document.getElementById('t-throttle');
  const set = (e) => {
    const r = el.getBoundingClientRect();
    throttleLevel = THREE.MathUtils.clamp(1 - (e.clientY - r.top) / r.height, 0.05, 1);
  };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(e); el.onpointermove = set; });
  el.addEventListener('pointerup', () => { el.onpointermove = null; });
})();

function readInput() {
  const k = (c) => keys.has(c);
  return {
    thrust: k('ArrowUp') || k('ShiftLeft') || k('ShiftRight') || touchState.thrust,
    screen: (k('ArrowRight') || k('KeyD') || touchState.right ? 1 : 0) - (k('ArrowLeft') || k('KeyA') || touchState.left ? 1 : 0),
    tilt: (k('KeyW') || touchState.fwd ? 1 : 0) - (k('KeyS') || touchState.back ? 1 : 0),
    roll: (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0),
  };
}

// ===================== 補助 =====================
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function localInfo() {
  const rel = P.relativeState(sim);
  const r = P.length(rel.pos);
  const up = P.normalize(rel.pos);
  const alt = r - rel.radius;
  const vVert = P.dot(rel.vel, up);
  const vHorVec = P.sub(rel.vel, P.scale(up, vVert));
  const el = P.orbitalElements(rel.pos, rel.vel, rel.mu, rel.radius);
  const altEarth = P.length(sim.pos) - P.EARTH.radius;
  const moonRel = P.sub(sim.pos, P.moonPosition(sim));
  const altMoon = P.length(moonRel) - P.MOON.radius;
  return { rel, up, alt, vVert, vHor: P.length(vHorVec), vHorVec, el, altEarth, altMoon, speed: P.length(rel.vel) };
}

function maxWarpIndex() {
  if (sim.status === 'prelaunch' || gameEnded) return 0;
  const info = localInfo();
  if (info.rel.body === 'earth' && info.altEarth < P.EARTH.atmosphereHeight) return 0;
  const a = info.alt;
  if (a < 25) return 0;
  if (a < 150) return 3;
  if (a < 600) return 4;
  if (a < 2500) return 5;
  return 6;
}

// ===================== 姿勢制御 =====================
const tmpQ = new THREE.Quaternion();
const camF = new THREE.Vector3(), camR = new THREE.Vector3();
function sasTarget(info) {
  if (sasMode === 'stab') return null;
  if (sasMode === 'up') return v3(info.up);
  if (info.speed < 0.05) return null;
  const v = v3(info.rel.vel).normalize();
  return sasMode === 'pro' ? v : v.negate();
}

function updateAttitude(dt, input, warp, info) {
  if (sim.status === 'prelaunch') {
    rocketQ.copy(siteBasis(new THREE.Vector3(...P.launchSite(sim.time).up)));
    omega.set(0, 0, 0);
    return;
  }
  const nose = Y.clone().applyQuaternion(rocketQ);
  const target = sasTarget(info);
  if (warp > 1) {
    omega.set(0, 0, 0);
    if (target) rocketQ.premultiply(tmpQ.setFromUnitVectors(nose, target));
    return;
  }
  const cmd = new THREE.Vector3();
  if (input.screen || input.tilt || input.roll) {
    cmd.addScaledVector(camF, input.screen * ROT_RATE);
    cmd.addScaledVector(camR, -input.tilt * ROT_RATE);
    cmd.addScaledVector(nose, input.roll * ROT_RATE);
  } else if (target) {
    const axis = new THREE.Vector3().crossVectors(nose, target);
    const s = axis.length();
    const angle = Math.atan2(s, nose.dot(target));
    if (angle > 1e-4) {
      if (s < 1e-6) axis.copy(camR); // 真逆を向いているとき
      axis.normalize().multiplyScalar(Math.min(ROT_RATE, angle * 2.5));
      cmd.copy(axis);
    }
  }
  const d = cmd.sub(omega);
  const maxD = ROT_ACCEL * dt;
  if (d.length() > maxD) d.setLength(maxD);
  omega.add(d);
  const w = omega.length();
  if (w > 1e-6) {
    rocketQ.premultiply(tmpQ.setFromAxisAngle(omega.clone().divideScalar(w), w * dt));
    rocketQ.normalize();
  }
}

// ===================== 終了処理 =====================
function explode(pos, vel) {
  for (let i = 0; i < 220; i++) {
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 22);
    fire.emit(pos, [vel[0] + d.x, vel[1] + d.y, vel[2] + d.z], { life: 0.8 + Math.random() * 1.8, size0: 1.5, size1: 6, color: [4, 1.6 + Math.random(), 0.4, 1], drag: 1.2 });
  }
  for (let i = 0; i < 90; i++) {
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 9);
    smoke.emit(pos, [vel[0] + d.x, vel[1] + d.y, vel[2] + d.z], { life: 4 + Math.random() * 5, size0: 2, size1: 14, color: [0.12, 0.11, 0.1, 0.8], drag: 0.7 });
  }
}

function formatTime(t) {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

function endGame(result) {
  gameEnded = true;
  warpIndex = 0;
  if (result.body === 'moon' && result.ok) {
    objectives.landed = true;
    legDeployTarget = 1;
    // 着陸地点の砂ぼこり
    for (let i = 0; i < 120; i++) {
      const up = v3(result.up);
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      d.addScaledVector(up, -d.dot(up)).normalize().multiplyScalar(3 + Math.random() * 6);
      const mv = P.moonVelocity(sim);
      smoke.emit(sim.pos, [mv[0] + d.x, mv[1] + d.y, mv[2] + d.z], { life: 2 + Math.random(), size0: 0.5, size1: 3, color: [0.55, 0.53, 0.5, 0.6], drag: 0 });
    }
  } else if (sim.status === 'crashed') {
    model.root.visible = false;
    explode(sim.pos, sim.vel);
  }
  setTimeout(() => showResult(result), result.ok ? 1200 : 1800);
}

function showResult(result) {
  overlayShown = true;
  const ov = document.getElementById('overlay');
  const title = document.getElementById('ov-title');
  const desc = document.getElementById('ov-desc');
  const stats = document.getElementById('ov-stats');
  const lander = sim.stages[sim.stages.length - 1];
  const fuelPct = lander ? (lander.fuel / lander.fuelMax) * 100 : 0;
  if (result.body === 'moon' && result.ok) {
    const score = Math.round(fuelPct * 20 + (P.SAFE_LANDING_SPEED - result.speed) * 300 + (P.SAFE_LANDING_TILT_DEG - result.tilt) * 15);
    const rank = score > 2000 ? 'S' : score > 1500 ? 'A' : score > 1000 ? 'B' : 'C';
    title.textContent = '月面着陸成功！';
    title.className = '';
    desc.textContent = 'おめでとうございます。静かの海へようこそ。';
    stats.innerHTML = `接地速度: ${result.speed.toFixed(2)} m/s<br>傾き: ${result.tilt.toFixed(1)}°<br>残り燃料: ${fuelPct.toFixed(0)}%<br>飛行時間: ${formatTime(result.time)}<br>最大G: ${sim.maxG.toFixed(1)} G<br><b>スコア: ${score}（ランク ${rank}）</b>`;
  } else {
    title.textContent = result.body === 'earth' && sim.status === 'earth_landed' ? '帰還' : 'ミッション失敗';
    title.className = 'fail';
    desc.textContent = result.reason;
    stats.innerHTML = `飛行時間: ${formatTime(result.time)}<br>残り燃料: ${fuelPct.toFixed(0)}%`;
  }
  ov.style.display = 'flex';
}
document.getElementById('ov-restart').addEventListener('click', () => location.reload());
document.getElementById('ov-close').addEventListener('click', () => { document.getElementById('overlay').style.display = 'none'; });

// ===================== 予測線・軌跡 =====================
function updatePrediction(origin) {
  if (sim.status === 'prelaunch' || gameEnded) {
    for (const l of [earthLine, moonLine, exitLine]) l.geometry.setDrawRange(0, 0);
    prediction = null;
    return;
  }
  prediction = P.predict(sim, { maxPoints: 1500 });
  const mNow = P.moonPosition(sim);
  // 区間ごとに座標の基準を変える: 地球基準 → 月の影響圏内は月基準 → 抜けたら再び地球基準
  const lines = [earthLine, moonLine, exitLine];
  const counts = [0, 0, 0];
  let seg = prediction.body === 'moon' ? 1 : 0;
  const put = (k, p) => {
    if (counts[k] >= 1599) return;
    lines[k].geometry.attributes.position.array.set([p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]], counts[k] * 3);
    counts[k]++;
  };
  for (let i = 0; i < prediction.points.length; i++) {
    const inside = prediction.inMoon[i];
    if (seg === 0 && inside) { put(0, prediction.points[i]); seg = 1; }
    else if (seg === 1 && !inside) seg = 2;
    if (seg === 1) {
      const r = prediction.moonRel[i];
      put(1, [mNow[0] + r[0], mNow[1] + r[1], mNow[2] + r[2]]);
    } else {
      put(seg, prediction.points[i]);
    }
  }
  lines.forEach((l, k) => {
    l.geometry.setDrawRange(0, counts[k]);
    l.geometry.attributes.position.needsUpdate = true;
    l.userData.origin = origin.slice();
  });
}

function updateTrail(origin) {
  if (sim.status === 'prelaunch') return;
  if (frameNo % 6 === 0 && !gameEnded) {
    // 地球基準の軌跡（月の近くでは月基準）
    trail.push(sim.pos.slice());
    if (trail.length > 1500) trail.shift();
  }
  const a = trailLine.geometry.attributes.position.array;
  for (let i = 0; i < trail.length; i++) {
    a[i * 3] = trail[i][0] - origin[0];
    a[i * 3 + 1] = trail[i][1] - origin[1];
    a[i * 3 + 2] = trail[i][2] - origin[2];
  }
  trailLine.geometry.setDrawRange(0, trail.length);
  trailLine.geometry.attributes.position.needsUpdate = true;
}

// ===================== HUD =====================
const el = (id) => document.getElementById(id);
const hud = {
  time: el('h-time'), body: el('h-body'), alt: el('h-alt'), speed: el('h-speed'), vh: el('h-vh'), ap: el('h-ap'), pe: el('h-pe'),
  moon: el('h-moon'), closest: el('h-closest'), phase: el('h-phase'), throttle: el('h-throttle'), bThrottle: el('b-throttle'),
  twr: el('h-twr'), warp: el('h-warp'), stages: el('stages'), hint: el('hint'), objectives: el('objectives'),
  radar: el('radar'), rAlt: el('r-alt'), rVs: el('r-vs'), rHs: el('r-hs'), rTilt: el('r-tilt'),
  tThrottleFill: el('t-throttle-fill'), tThrottleLabel: el('t-throttle-label'),
};
const fmtKm = (x) => (!Number.isFinite(x) ? '脱出' : Math.abs(x) >= 10000 ? (x / 1000).toFixed(1) + 'k km' : x.toFixed(x < 100 ? 1 : 0) + ' km');

function phaseAngle() {
  const rAng = Math.atan2(-sim.pos[2], sim.pos[0]);
  const m = P.moonPosition(sim);
  const mAng = Math.atan2(-m[2], m[0]);
  let d = ((mAng - rAng) * 180) / Math.PI;
  d = ((d % 360) + 360) % 360;
  return d;
}

function currentHint(info) {
  if (gameEnded) return objectives.landed ? '着陸成功！ドラッグで機体の周りを見回せます。' : '';
  const st = sim.stages[0];
  if (sim.status === 'prelaunch') return isTouch ? '「噴射」を押し続けて打ち上げ！' : '<b>↑</b>（または Shift）を押し続けて打ち上げ！';
  if (st && st.fuel <= 0 && sim.stages.length > 1) return isTouch ? '第1段の燃料切れ。「切離」で切り離そう' : '第1段の燃料切れ。<b>Space</b> で切り離そう';
  if (info.rel.body === 'earth') {
    const pe = info.el.pe, ap = info.el.ap;
    if (!objectives.orbit) {
      if (info.altEarth < 6) return 'まずは真上へ上昇';
      if (ap < 100) return (isTouch ? '⟳' : '<b>→</b>') + ' で少しずつ東（右）へ傾けながら加速。遠点 Ap が 100 km を超えたら噴射を止める';
      if (info.vVert > 0.5) return '慣性で上昇中。遠点（最高点）に近づいたら<b>2 順行</b>モードで噴射して近点を上げよう';
      return '<b>2 順行</b>モードで噴射し、近点 Pe を 70 km 以上にすれば地球周回軌道！';
    }
    if (ap < P.MOON.distance * 0.8) {
      const ph = phaseAngle();
      const ok = ph > 95 && ph < 125;
      return `月との位相角 ${ph.toFixed(0)}°。<b>約110°</b>になったら順行噴射し、黄色い予測線が月に届くまで加速しよう` + (ok ? '　<span class="good">← 今がチャンス！</span>' : '（時間加速 <b>.</b> で待てる）');
    }
    if (prediction && (prediction.impact?.body === 'moon' || prediction.closest.alt < 600)) return '月遷移軌道に乗りました！時間加速（<b>.</b>）で月まで早送り';
    return '予測線が月に届いていません。順行/逆行の短い噴射で調整しよう';
  }
  // 月の影響圏
  if (info.altMoon > 300) {
    if (prediction?.impact?.body === 'moon') return '月面への落下軌道です。<b>3 逆行</b>モードにして、高度に合わせて減速を始めよう';
    return '月の近くを通過します。<b>3 逆行</b>で減速すると月に落ちていきます';
  }
  if (sim.stages.length > 1) return '着陸前にブースターを切り離そう（着陸脚が必要）';
  return '<b>3 逆行</b>で減速。接地は 降下速度 3 m/s 未満・傾き 20° 未満で！';
}

function updateObjectives(info) {
  if (sim.status !== 'prelaunch') objectives.liftoff = true;
  if (info.altEarth > P.EARTH.atmosphereHeight) objectives.space = true;
  if (info.rel.body === 'earth' && info.el.pe > P.EARTH.atmosphereHeight) objectives.orbit = true;
  if (info.rel.body === 'moon') { objectives.soi = true; objectives.orbit = true; objectives.space = true; }
  const list = [['liftoff', '打ち上げ'], ['space', '宇宙へ'], ['orbit', '地球周回'], ['soi', '月の影響圏'], ['landed', '月面着陸']];
  let cur = false;
  hud.objectives.innerHTML = list.map(([k, label]) => {
    const done = objectives[k];
    const isCur = !done && !cur;
    if (isCur) cur = true;
    return `<span class="obj ${done ? 'done' : ''} ${isCur ? 'current' : ''}">${done ? '✔' : '○'} ${label}</span>`;
  }).join('');
}

function updateHud(info) {
  const t = sim.status === 'prelaunch' ? 'T- 00:00' : 'T+ ' + formatTime(sim.missionTime);
  hud.time.textContent = t;
  hud.body.textContent = info.rel.body === 'moon' ? '月' : '地球';
  hud.alt.textContent = fmtKm(info.alt);
  hud.speed.textContent = info.speed.toFixed(1) + ' m/s';
  hud.vh.textContent = `${info.vVert >= 0 ? '+' : ''}${info.vVert.toFixed(1)} / ${info.vHor.toFixed(1)}`;
  if (sim.status === 'prelaunch') { hud.ap.textContent = '-'; hud.pe.textContent = '-'; }
  else {
    hud.ap.textContent = fmtKm(info.el.ap);
    hud.pe.textContent = info.el.pe < 0 ? `${fmtKm(info.el.pe)}（落下）` : fmtKm(info.el.pe);
    hud.pe.className = info.el.pe < 0 ? 'warn' : '';
  }
  hud.moon.textContent = fmtKm(info.altMoon);
  if (prediction) {
    if (prediction.impact?.body === 'moon') { hud.closest.textContent = '月面に到達'; hud.closest.className = 'good'; }
    else if (prediction.closest.alt < 8000) { hud.closest.textContent = fmtKm(prediction.closest.alt) + `（${formatTime(prediction.closest.time)}後）`; hud.closest.className = prediction.closest.alt < 300 ? 'good' : ''; }
    else { hud.closest.textContent = '-'; hud.closest.className = ''; }
  } else hud.closest.textContent = '-';
  hud.phase.textContent = info.rel.body === 'earth' && sim.status !== 'prelaunch' ? phaseAngle().toFixed(0) + '°' : '-';
  hud.throttle.textContent = Math.round(throttleLevel * 100) + '%';
  hud.bThrottle.style.width = throttleLevel * 100 + '%';
  hud.tThrottleFill.style.height = throttleLevel * 100 + '%';
  hud.tThrottleLabel.textContent = Math.round(throttleLevel * 100) + '%';
  const st = sim.stages[0];
  const g = info.rel.mu / P.length(info.rel.pos) ** 2;
  const twr = st ? (st.thrust * throttleLevel) / P.rocketMass(sim) / g : 0;
  hud.twr.textContent = `${twr.toFixed(2)} / ${P.deltaV(sim).total.toFixed(0)} m/s`;
  hud.warp.textContent = '×' + WARPS[warpIndex];
  hud.stages.innerHTML = sim.stages.map((s, i) => {
    const pct = (s.fuel / s.fuelMax) * 100;
    return `<div class="stage-label ${i ? 'inactive' : ''}"><span>${s.name}</span><span>${pct.toFixed(0)}%</span></div><div class="bar"><div style="width:${pct}%;${pct < 15 ? 'background:#ff5d5d' : ''}"></div></div>`;
  }).reverse().join('');
  document.querySelectorAll('#sas-modes .chip').forEach((c) => c.classList.toggle('on', c.dataset.sas === sasMode));
  hud.hint.innerHTML = currentHint(info);
  updateObjectives(info);

  // 着陸レーダー
  const showRadar = (info.rel.body === 'moon' && info.altMoon < 400) || (sim.status !== 'prelaunch' && info.altEarth < 30 && info.vVert < 0);
  hud.radar.style.display = showRadar ? 'block' : 'none';
  if (showRadar) {
    const nose = Y.clone().applyQuaternion(rocketQ);
    const tilt = THREE.MathUtils.radToDeg(nose.angleTo(v3(info.up)));
    hud.rAlt.textContent = (info.rel.body === 'moon' ? info.altMoon : info.altEarth).toFixed(1) + ' km';
    hud.rVs.textContent = info.vVert.toFixed(1);
    hud.rHs.textContent = info.vHor.toFixed(1);
    hud.rTilt.textContent = tilt.toFixed(0) + '°';
    hud.rVs.className = -info.vVert < P.SAFE_LANDING_SPEED * 0.8 ? 'good' : -info.vVert < 8 ? 'warn' : 'bad';
    hud.rHs.className = info.vHor < 1.5 ? 'good' : info.vHor < 4 ? 'warn' : 'bad';
    hud.rTilt.className = tilt < 10 ? 'good' : tilt < P.SAFE_LANDING_TILT_DEG ? 'warn' : 'bad';
  }
}

// 画面上のマーカー
const markers = { pro: el('mk-pro'), retro: el('mk-retro'), rocket: el('mk-rocket'), moon: el('lb-moon'), earth: el('lb-earth'), impact: el('lb-impact') };
function placeMarker(node, worldPos, visible = true) {
  if (!visible) { node.style.display = 'none'; return; }
  const p = worldPos.clone().project(camera);
  if (p.z > 1 || p.z < -1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05) { node.style.display = 'none'; return; }
  node.style.display = 'block';
  node.style.left = ((p.x + 1) / 2) * window.innerWidth + 'px';
  node.style.top = ((1 - p.y) / 2) * window.innerHeight + 'px';
}

// ===================== カメラ =====================
function updateCamera(dt, info) {
  const rocketPos = v3(sim.pos);
  const nose = Y.clone().applyQuaternion(rocketQ);
  const stackH = P.stackHeight(sim);
  const rocketCenter = rocketPos.clone().addScaledVector(nose, stackH * 0.45);
  const up = v3(info.up);
  if (!smoothed.init) { smoothed.up.copy(up); smoothed.center.copy(rocketCenter); smoothed.init = true; }
  smoothed.up.lerp(up, 1 - Math.exp(-dt * 2.5)).normalize();

  let desiredCenter, offset, camUp;
  if (viewMode === 'map') {
    const bodyCenter = info.rel.body === 'moon' ? v3(P.moonPosition(sim)) : new THREE.Vector3();
    desiredCenter = bodyCenter;
    offset = new THREE.Vector3(
      Math.cos(cam.mapPhi) * Math.cos(cam.mapTheta), Math.sin(cam.mapPhi), -Math.cos(cam.mapPhi) * Math.sin(cam.mapTheta),
    ).multiplyScalar(cam.mapDist);
    camUp = Y.clone();
  } else {
    // 自動で着陸視点へ
    if (info.rel.body === 'moon' && info.altMoon < 250 && !autoLandingView && viewMode === 'chase' && !gameEnded) {
      autoLandingView = true;
      viewMode = 'landing';
      applyViewDefaults();
      toast('着陸視点に切り替えました（C で変更）');
    }
    desiredCenter = rocketCenter;
    const u = smoothed.up;
    let east = new THREE.Vector3().crossVectors(Y, u);
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    east.normalize();
    const north = new THREE.Vector3().crossVectors(u, east);
    const horiz = north.clone().multiplyScalar(Math.cos(cam.theta)).addScaledVector(east, Math.sin(cam.theta));
    offset = horiz.multiplyScalar(Math.cos(cam.phi)).addScaledVector(u, Math.sin(cam.phi)).multiplyScalar(cam.dist);
    camUp = u.clone();
  }
  // 中心はロケットからの相対位置で補間（高速で動いても遅れない）
  const rel = smoothed.center.clone().sub(rocketCenter);
  const relTarget = desiredCenter.clone().sub(rocketCenter);
  const k = 1 - Math.exp(-dt * (viewMode === 'map' ? 4 : 10));
  rel.lerp(relTarget, k);
  smoothed.center.copy(rocketCenter).add(rel);
  if (!smoothed.pos.lengthSq()) smoothed.pos.copy(offset);
  smoothed.pos.lerp(offset, 1 - Math.exp(-dt * 6));

  let camPos = smoothed.center.clone().add(smoothed.pos);
  // 地面にめり込まないように
  for (const [c, R] of [[new THREE.Vector3(), P.EARTH.radius], [v3(P.moonPosition(sim)), P.MOON.radius]]) {
    const d = camPos.clone().sub(c);
    if (d.length() < R + 1.2) camPos = c.clone().add(d.setLength(R + 1.2));
  }
  camera.position.copy(camPos);
  camera.up.copy(camUp);
  camera.lookAt(smoothed.center);
  const dist = smoothed.pos.length();
  camera.near = THREE.MathUtils.clamp(dist * 0.004, 0.05, 80);
  camera.far = 200000;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const m = camera.matrixWorld.elements;
  camR.set(m[0], m[1], m[2]).normalize();
  camF.set(-m[8], -m[9], -m[10]).normalize();
}

// ===================== メインループ =====================
const timer = new THREE.Timer();
let shadersReady = false;

function emitEngineParticles(dt, info, throttle) {
  if (throttle <= 0 || !model.root.visible) return;
  const nose = v3(sim.nose);
  const base = v3(sim.pos);
  const atm = P.atmosphereDensity(sim.pos);
  // 大気中の排気煙
  if (atm > 0.02 && info.altEarth < 45) {
    const surf = new THREE.Vector3(0, P.EARTH.omega, 0).cross(base);
    const n = Math.ceil(70 * dt * throttle * (lowQuality ? 0.6 : 1));
    const up = v3(info.up);
    for (let i = 0; i < n; i++) {
      const spread = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6);
      const v = nose.clone().multiplyScalar(-20 - Math.random() * 12).add(spread).add(surf);
      let pos = base.clone().addScaledVector(nose, -1 - Math.random() * 2);
      // 地面近くでは横に広がる
      if (info.altEarth < 4) {
        const d = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
        d.addScaledVector(up, -d.dot(up)).normalize().multiplyScalar(10 + Math.random() * 16);
        v.copy(d).addScaledVector(up, 1 + Math.random() * 3).add(surf);
        pos = base.clone().addScaledVector(up, 0.5);
      }
      const sunlit = THREE.MathUtils.clamp(up.dot(world.sunDir) * 1.4 + 0.25, 0.08, 1);
      const b = (0.75 + Math.random() * 0.2) * sunlit;
      smoke.emit([pos.x, pos.y, pos.z], [v.x, v.y, v.z], { life: 5 + Math.random() * 6, size0: 1.2, size1: 12 + Math.random() * 10, color: [b, b * 0.98, b * 0.95, 0.55 * atm + 0.15], drag: 1.1 });
    }
  }
  // 月面の砂ぼこり
  if (info.altMoon < 22 && info.rel.body === 'moon') {
    const moonC = v3(P.moonPosition(sim));
    const up = base.clone().sub(moonC).normalize();
    const ground = moonC.clone().addScaledVector(up, P.MOON.radius + 0.1);
    const mv = v3(P.moonVelocity(sim));
    const strength = (1 - info.altMoon / 22) * throttle;
    const n = Math.ceil(220 * dt * strength * (lowQuality ? 0.6 : 1));
    const sunlit = THREE.MathUtils.clamp(up.dot(world.sunDir) * 1.3 + 0.1, 0.05, 1);
    for (let i = 0; i < n; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      d.addScaledVector(up, -d.dot(up)).normalize();
      const pos = ground.clone().addScaledVector(d, Math.random() * 2.5);
      const v = d.multiplyScalar(14 + Math.random() * 18).addScaledVector(up, 0.2 + Math.random() * 0.5).add(mv);
      const b = 0.6 * sunlit;
      smoke.emit([pos.x, pos.y, pos.z], [v.x, v.y, v.z], { life: 1.2 + Math.random() * 1.2, size0: 0.25, size1: 1.2, color: [b, b * 0.97, b * 0.92, 0.22], drag: 0 });
    }
  }
}

function frame() {
  requestAnimationFrame(frame);
  timer.update();
  const realDt = Math.min(timer.getDelta(), 0.05);
  frameNo++;
  const input = readInput();
  if (gameEnded) { input.thrust = false; input.screen = input.tilt = input.roll = 0; }

  // 噴射中・低高度では時間加速を解除
  if (input.thrust && warpIndex > 0) { warpIndex = 0; toast('噴射中は時間加速できません'); }
  if (warpIndex > maxWarpIndex()) { warpIndex = maxWarpIndex(); toast(`高度が下がったので時間加速を ×${WARPS[warpIndex]} にしました`); }
  const warp = WARPS[warpIndex];
  const gameDt = realDt * warp;
  const steps = Math.min(400, Math.max(1, Math.ceil(gameDt / (1 / 60))));
  const h = gameDt / steps;
  const throttle = input.thrust ? throttleLevel : 0;
  let info = localInfo();
  for (let i = 0; i < steps; i++) {
    updateAttitude(h, input, warp, info);
    const nose = Y.clone().applyQuaternion(rocketQ);
    const ev = P.step(sim, h, { throttle, nose: [nose.x, nose.y, nose.z] });
    if (i % 8 === 0) info = localInfo();
    if (ev && !gameEnded) { endGame(ev); break; }
  }
  info = localInfo();
  const actualThrottle = sim.thrusting ? throttle : 0;

  // ---- ワールドの更新 ----
  const origin = sim.pos.slice();
  world.earthGroup.rotation.y = P.earthRotation(sim.time);
  world.shared.uTime.value = sim.time;
  const mp = P.moonPosition(sim);
  world.moon.position.set(mp[0], mp[1], mp[2]);
  world.moon.rotation.y = P.moonRotation(sim) + Math.PI;
  model.root.position.set(sim.pos[0], sim.pos[1], sim.pos[2]);
  model.root.quaternion.copy(rocketQ);

  // 物理側で段が減っていたら見た目も合わせる
  while (model.parts.length > sim.stages.length) {
    const part = detachBottom(model);
    if (!part) break;
    legDeployTarget = 1;
  }

  // 着陸脚の展開
  const lander = model.parts.find((p) => p.legs);
  if (lander && model.parts[0] === lander) {
    lander.deploy += (legDeployTarget - lander.deploy) * Math.min(1, realDt * 1.5);
    setLegDeploy(lander, lander.deploy);
  }

  // 残骸
  for (const d of debrisVisuals) {
    if (!d.piece.alive) {
      if (d.part.group.parent) {
        if (d.part.group.position.distanceTo(camera.position) < 3000) explode(d.piece.pos, d.piece.vel);
        scene.remove(d.part.group);
      }
      continue;
    }
    d.part.group.position.set(d.piece.pos[0], d.piece.pos[1], d.piece.pos[2]);
    const s = d.piece.spin;
    const ang = Math.hypot(...s) * realDt * warp;
    if (ang > 0) d.q.premultiply(tmpQ.setFromAxisAngle(new THREE.Vector3(...s).normalize(), ang));
    d.part.group.quaternion.copy(d.q);
  }

  const vacuum = 1 - Math.min(1, P.atmosphereDensity(sim.pos) * 2.5);
  updatePlumes(model, { throttle: actualThrottle, vacuum, time: performance.now() / 1000 });
  emitEngineParticles(realDt * warp, info, actualThrottle);
  const gravityFn = (x, y, z) => {
    const m = P.moonPosition(sim);
    const dx = x - m[0], dy = y - m[1], dz = z - m[2];
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > 2500 * 2500) return [0, 0, 0];
    const k = -P.MOON.mu / (r2 * Math.sqrt(r2));
    return [dx * k, dy * k, dz * k];
  };
  smoke.update(realDt * warp, origin, info.rel.body === 'moon' ? gravityFn : null);
  fire.update(realDt * warp, origin, null);
  smoke.points.position.set(...origin);
  fire.points.position.set(...origin);

  // ---- カメラ ----
  updateCamera(realDt, info);
  world.sky.position.copy(camera.position);

  // 予測線
  if (frameNo % (input.thrust ? 2 : 5) === 0 || !prediction) updatePrediction(origin);
  for (const l of [earthLine, moonLine, exitLine]) {
    const o = l.userData.origin || origin;
    l.position.set(o[0], o[1], o[2]);
  }
  updateTrail(origin);
  trailLine.position.set(...origin);
  const mapMode = viewMode === 'map';
  moonOrbit.visible = mapMode;
  soiRing.visible = mapMode;
  soiRing.position.set(mp[0], mp[1], mp[2]);
  trailLine.visible = mapMode || info.alt > 20;

  // 大気・空の明るさ
  const camR3 = camera.position.length();
  const inAtmo = camR3 < P.EARTH.radius + P.EARTH.atmosphereHeight;
  world.atmosphere.material.side = inAtmo ? THREE.BackSide : THREE.FrontSide;
  const camAlt = camR3 - P.EARTH.radius;
  const camUpE = camera.position.clone().normalize();
  const daylight = THREE.MathUtils.smoothstep(camUpE.dot(world.sunDir), -0.15, 0.25);
  const skyBright = THREE.MathUtils.clamp(1 - camAlt / 45, 0, 1) * daylight;
  world.sky.getObjectByName('stars').material.uniforms.uOpacity.value = 1 - THREE.MathUtils.smoothstep(skyBright, 0, 0.35);
  world.shared.uSunView.value.copy(world.sunDir).transformDirection(camera.matrixWorldInverse);

  // 太陽光の影はロケットの周りだけに当てる
  const sl = world.sunLight;
  sl.target.position.copy(model.root.position);
  sl.position.copy(model.root.position).addScaledVector(world.sunDir, 150);
  const span = Math.max(16, P.stackHeight(sim) * 1.6) + (sim.status === 'prelaunch' ? 14 : 0);
  const sc = sl.shadow.camera;
  if (sc.right !== span) { sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = 400; sc.updateProjectionMatrix(); }
  // 地球の夜側では太陽光が当たらない
  const toSun = new THREE.Ray(model.root.position.clone(), world.sunDir);
  const inEarthShadow = toSun.intersectsSphere(new THREE.Sphere(new THREE.Vector3(), P.EARTH.radius - 1));
  sl.castShadow = !mapMode && !inEarthShadow;
  // 環境光（空・地球・月面からの照り返し）を機体の真上方向に合わせる
  const nearMoon = info.rel.body === 'moon' && info.altMoon < 600;
  const rocketUp = v3(info.up);
  const sunUp = rocketUp.dot(world.sunDir);
  let env, envI;
  if (info.rel.body === 'earth' && info.altEarth < P.EARTH.atmosphereHeight) {
    env = world.envs.sky;
    envI = THREE.MathUtils.smoothstep(sunUp, -0.2, 0.2) * (1 - info.altEarth / P.EARTH.atmosphereHeight * 0.6) + 0.02;
  } else if (nearMoon) {
    env = world.envs.moon;
    envI = THREE.MathUtils.smoothstep(sunUp, -0.1, 0.2) * 0.8 + 0.03;
  } else {
    env = world.envs.space;
    envI = info.rel.body === 'earth' ? THREE.MathUtils.smoothstep(sunUp, -0.3, 0.3) * 0.9 + 0.02 : 0.03;
  }
  scene.environment = env;
  scene.environmentIntensity = envI;
  scene.environmentRotation.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, rocketUp));

  // マーカー
  const showVel = !mapMode && sim.status === 'flying' && info.speed > 0.3;
  const vdir = v3(info.rel.vel).normalize();
  const center = model.root.position.clone();
  placeMarker(markers.pro, center.clone().addScaledVector(vdir, cam.dist * 0.6), showVel);
  placeMarker(markers.retro, center.clone().addScaledVector(vdir, -cam.dist * 0.6), showVel);
  placeMarker(markers.rocket, center, mapMode);
  placeMarker(markers.moon, world.moon.position.clone().add(new THREE.Vector3(0, P.MOON.radius, 0)), mapMode || info.altMoon > 3000);
  placeMarker(markers.earth, new THREE.Vector3(0, P.EARTH.radius, 0), mapMode);
  if (prediction?.impact && !gameEnded) {
    const ip = prediction.impact.body === 'moon'
      ? v3(P.moonPosition(sim)).add(v3(prediction.impact.moonRel))
      : v3(prediction.impact.pos);
    placeMarker(markers.impact, ip, mapMode || cam.dist > 200);
  } else placeMarker(markers.impact, center, false);

  if (frameNo % 3 === 0) updateHud(info);

  composer.render();
  if (!shadersReady) {
    shadersReady = true;
    document.getElementById('loading').style.display = 'none';
  }
}

resize();
window.addEventListener('resize', resize);
applyViewDefaults();
document.getElementById('help').style.display = helpVisible ? '' : 'none';
// 最初の1フレームでシェーダーをまとめてコンパイル
renderer.compile(scene, camera);
frame();
// テスト・デバッグ用
window.__rocket3d = { sim, P, camera, world, scene, renderer, setView: (m) => { viewMode = m; applyViewDefaults(); }, cam, setSas, rocketQ, keys };
