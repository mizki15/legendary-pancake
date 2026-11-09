// 3D 月面着陸ゲームの物理。描画ライブラリに依存しないので Node でもテストできる。
// 単位: 長さ 1 = 約 1 km（ゲーム用に縮尺）、時間 = 秒、質量 = トン。
// 地球は原点に固定、月は赤道面 (XZ 平面) 上の円軌道を決まった速さで回る。

export const EARTH = {
  radius: 1000,
  mu: 4.0e6,                 // 地表重力 4.0
  rotationPeriod: 1200,      // 自転周期（秒）
  atmosphereHeight: 70,
  scaleHeight: 8,
};
EARTH.omega = (2 * Math.PI) / EARTH.rotationPeriod;

export const MOON = {
  radius: 273,
  mu: EARTH.mu / 81.3,       // 月面重力 ≈ 0.66（地球の約 1/6）
  distance: 20000,
};
MOON.angularSpeed = Math.sqrt(EARTH.mu / MOON.distance ** 3);
MOON.soi = MOON.distance * (MOON.mu / EARTH.mu) ** 0.4;

// 太陽の方向（固定）。打ち上げ地点が昼になる向き。
export const SUN_DIR = normalize([0.78, 0.22, -0.58]);

export const SAFE_LANDING_SPEED = 3.0;
export const SAFE_LANDING_TILT_DEG = 20;
const DRAG_K = 0.012;

// 下から順に積む。1段目が燃え尽きたら切り離して2段目（着陸機）に点火する。
export function defaultStages() {
  return [
    { name: '第1段ブースター', dry: 3.0, fuel: 12.0, fuelMax: 12.0, thrust: 125, ve: 130, height: 9.0, radius: 1.1 },
    { name: '第2段 着陸機', dry: 2.0, fuel: 2.6, fuelMax: 2.6, thrust: 11, ve: 190, height: 4.2, radius: 1.0, legs: true },
  ];
}

// ---------- ベクトル（[x, y, z] 配列） ----------
export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function length(a) { return Math.hypot(a[0], a[1], a[2]); }
export function normalize(a) { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
// Y 軸まわりの回転（three.js と同じ向き）
export function rotateY(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

// ---------- 天体の位置 ----------
export function moonPosition(sim, t = sim.time) {
  const th = sim.moonPhase0 + MOON.angularSpeed * t;
  return [MOON.distance * Math.cos(th), 0, -MOON.distance * Math.sin(th)];
}
export function moonVelocity(sim, t = sim.time) {
  const th = sim.moonPhase0 + MOON.angularSpeed * t;
  const v = MOON.distance * MOON.angularSpeed;
  return [-v * Math.sin(th), 0, -v * Math.cos(th)];
}
// 月は潮汐固定：常に同じ面を地球へ向ける。Y 軸まわりの回転角を返す。
export function moonRotation(sim, t = sim.time) { return sim.moonPhase0 + MOON.angularSpeed * t; }
export function earthRotation(t) { return EARTH.omega * t; }

// 地球の自転とともに動く発射場（赤道・経度 0）
export function launchSite(t) {
  const a = earthRotation(t);
  const up = [Math.cos(a), 0, -Math.sin(a)];
  return { pos: scale(up, EARTH.radius), vel: cross([0, EARTH.omega, 0], scale(up, EARTH.radius)), up };
}

// ---------- シミュレーション ----------
export function createSim({ moonPhase0, stages } = {}) {
  const site = launchSite(0);
  return {
    time: 0,             // 経過時間（打ち上げ前も含む）
    missionTime: 0,      // 離陸からの時間
    moonPhase0: moonPhase0 ?? 1.2,
    pos: site.pos.slice(),
    vel: site.vel.slice(),
    nose: site.up.slice(),
    stages: stages ?? defaultStages(),
    status: 'prelaunch', // prelaunch | flying | landed | crashed | earth_landed
    result: null,
    debris: [],
    attach: null,
    thrusting: false,
    thrustAccel: 0,
    maxG: 0,
  };
}

export function rocketMass(sim) {
  return sim.stages.reduce((m, s) => m + s.dry + s.fuel, 0);
}
export function activeStage(sim) { return sim.stages[0] ?? null; }
export function stackHeight(sim) { return sim.stages.reduce((h, s) => h + s.height, 0); }

// 残りの Δv（各段をロケット方程式で計算）
export function deltaV(sim) {
  let total = 0;
  const perStage = [];
  for (let i = 0; i < sim.stages.length; i++) {
    const above = sim.stages.slice(i + 1).reduce((m, s) => m + s.dry + s.fuel, 0);
    const s = sim.stages[i];
    const m0 = above + s.dry + s.fuel;
    const m1 = above + s.dry;
    const dv = s.ve * Math.log(m0 / m1);
    perStage.push(dv);
    total += dv;
  }
  return { total, perStage };
}

function gravityAt(sim, pos, t) {
  const r = pos;
  const rl = length(r);
  let a = scale(r, -EARTH.mu / (rl * rl * rl));
  const m = moonPosition(sim, t);
  const d = sub(pos, m);
  const dl = length(d);
  a = add(a, scale(d, -MOON.mu / (dl * dl * dl)));
  return a;
}

function dragAccel(pos, vel, mass, area) {
  const alt = length(pos) - EARTH.radius;
  if (alt > EARTH.atmosphereHeight || mass <= 0) return [0, 0, 0];
  const rho = Math.exp(-Math.max(0, alt) / EARTH.scaleHeight);
  const air = sub(vel, cross([0, EARTH.omega, 0], pos));
  const sp = length(air);
  return scale(air, (-DRAG_K * area * rho * sp) / mass);
}

export function atmosphereDensity(pos) {
  const alt = length(pos) - EARTH.radius;
  return alt > EARTH.atmosphereHeight ? 0 : Math.exp(-Math.max(0, alt) / EARTH.scaleHeight);
}

// 1 ステップ進める。controls = { throttle: 0..1, nose: 単位ベクトル（機首の向き） }
export function step(sim, dt, controls) {
  if (sim.status === 'crashed' || sim.status === 'landed' || sim.status === 'earth_landed') {
    sim.time += dt;
    followSurface(sim);
    stepDebris(sim, dt);
    return null;
  }
  sim.nose = normalize(controls.nose ?? sim.nose);
  const stage = activeStage(sim);
  let throttle = Math.max(0, Math.min(1, controls.throttle ?? 0));
  if (!stage || stage.fuel <= 0) throttle = 0;
  const mass = rocketMass(sim);
  let thrustAcc = [0, 0, 0];
  if (throttle > 0) {
    const burn = Math.min(stage.fuel, (stage.thrust * throttle * dt) / stage.ve);
    const effThrottle = burn / ((stage.thrust * dt) / stage.ve);
    stage.fuel -= burn;
    thrustAcc = scale(sim.nose, (stage.thrust * effThrottle) / mass);
    throttle = effThrottle;
  }
  sim.thrusting = throttle > 0;
  sim.thrustAccel = length(thrustAcc);

  if (sim.status === 'prelaunch') {
    sim.time += dt;
    const site = launchSite(sim.time);
    // 地表で支えられている。上向きの推力が実効重力を上回ったら離陸。
    const g = EARTH.mu / EARTH.radius ** 2 - EARTH.omega ** 2 * EARTH.radius;
    if (dot(thrustAcc, site.up) > g) {
      sim.status = 'flying';
      sim.pos = add(site.pos, scale(site.up, 0.01));
      sim.vel = site.vel.slice();
    } else {
      sim.pos = site.pos;
      sim.vel = site.vel;
      return null;
    }
  }

  const area = 1 + sim.stages.length * 0.5;
  // リープフロッグ（キック・ドリフト・キック）
  const a0 = add(add(gravityAt(sim, sim.pos, sim.time), thrustAcc), dragAccel(sim.pos, sim.vel, mass, area));
  const vHalf = add(sim.vel, scale(a0, dt / 2));
  sim.pos = add(sim.pos, scale(vHalf, dt));
  sim.time += dt;
  sim.missionTime += dt;
  const a1 = add(add(gravityAt(sim, sim.pos, sim.time), thrustAcc), dragAccel(sim.pos, vHalf, mass, area));
  sim.vel = add(vHalf, scale(a1, dt / 2));

  const gLoad = length(sub(a1, gravityAt(sim, sim.pos, sim.time))) / (EARTH.mu / EARTH.radius ** 2);
  sim.maxG = Math.max(sim.maxG, gLoad);

  stepDebris(sim, dt);
  return checkContact(sim);
}

// 着陸（墜落）地点に固定し、天体の自転・公転と一緒に動かす
function attachToSurface(sim, body) {
  const angle = body === 'moon' ? moonRotation(sim) : earthRotation(sim.time);
  const center = body === 'moon' ? moonPosition(sim) : [0, 0, 0];
  sim.attach = { body, rel: rotateY(sub(sim.pos, center), -angle) };
  followSurface(sim);
}

function followSurface(sim) {
  const a = sim.attach;
  if (!a) return;
  if (a.body === 'moon') {
    const r = rotateY(a.rel, moonRotation(sim));
    sim.pos = add(moonPosition(sim), r);
    sim.vel = add(moonVelocity(sim), cross([0, MOON.angularSpeed, 0], r));
  } else {
    sim.pos = rotateY(a.rel, earthRotation(sim.time));
    sim.vel = cross([0, EARTH.omega, 0], sim.pos);
  }
}

function checkContact(sim) {
  const m = moonPosition(sim);
  const relM = sub(sim.pos, m);
  const altM = length(relM) - MOON.radius;
  if (altM <= 0) {
    const up = normalize(relM);
    const vRel = sub(sim.vel, moonVelocity(sim));
    const speed = length(vRel);
    const tilt = (Math.acos(Math.max(-1, Math.min(1, dot(sim.nose, up)))) * 180) / Math.PI;
    const hasLegs = activeStage(sim)?.legs === true;
    sim.pos = add(m, scale(up, MOON.radius));
    sim.vel = moonVelocity(sim);
    const ok = speed < SAFE_LANDING_SPEED && tilt < SAFE_LANDING_TILT_DEG && hasLegs;
    sim.status = ok ? 'landed' : 'crashed';
    let reason = '';
    if (!hasLegs) reason = '着陸脚がありません（ブースターを切り離してから着陸してください）';
    else if (speed >= SAFE_LANDING_SPEED) reason = `接地速度が速すぎます（${speed.toFixed(1)} / 安全 ${SAFE_LANDING_SPEED.toFixed(1)} 未満）`;
    else if (tilt >= SAFE_LANDING_TILT_DEG) reason = `機体が傾きすぎています（${tilt.toFixed(0)}° / 安全 ${SAFE_LANDING_TILT_DEG}° 未満）`;
    sim.result = { body: 'moon', ok, speed, tilt, reason, fuelLeft: activeStage(sim)?.fuel ?? 0, time: sim.missionTime, up };
    attachToSurface(sim, 'moon');
    return sim.result;
  }
  const altE = length(sim.pos) - EARTH.radius;
  if (altE <= 0) {
    const up = normalize(sim.pos);
    const surfaceVel = cross([0, EARTH.omega, 0], sim.pos);
    const speed = length(sub(sim.vel, surfaceVel));
    const tilt = (Math.acos(Math.max(-1, Math.min(1, dot(sim.nose, up)))) * 180) / Math.PI;
    const ok = speed < SAFE_LANDING_SPEED && tilt < SAFE_LANDING_TILT_DEG;
    sim.pos = scale(up, EARTH.radius);
    sim.vel = surfaceVel;
    sim.status = ok ? 'earth_landed' : 'crashed';
    sim.result = {
      body: 'earth', ok: false, speed, tilt,
      reason: ok ? '地球に戻ってきました（月には到達していません）' : `地球に落下しました（速度 ${speed.toFixed(1)}）`,
      fuelLeft: activeStage(sim)?.fuel ?? 0, time: sim.missionTime, up,
    };
    attachToSurface(sim, 'earth');
    return sim.result;
  }
  return null;
}

// 現在の最下段を切り離す。切り離した段は残骸として落ちていく。
export function stageSeparation(sim) {
  if (sim.stages.length <= 1 || sim.status === 'prelaunch') return null;
  const dropped = sim.stages.shift();
  const back = scale(sim.nose, -1.5);
  const piece = {
    stage: dropped,
    pos: sim.pos.slice(),
    vel: add(sim.vel, back),
    nose: sim.nose.slice(),
    spin: [(Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6],
    age: 0,
    alive: true,
  };
  sim.debris.push(piece);
  sim.vel = add(sim.vel, scale(sim.nose, 0.4));
  // 上段の底面が新しいロケット位置になる
  sim.pos = add(sim.pos, scale(sim.nose, dropped.height));
  return piece;
}

function stepDebris(sim, dt) {
  for (const d of sim.debris) {
    if (!d.alive) continue;
    const mass = d.stage.dry + d.stage.fuel;
    const a = add(gravityAt(sim, d.pos, sim.time), dragAccel(d.pos, d.vel, mass, 1.2));
    d.vel = add(d.vel, scale(a, dt));
    d.pos = add(d.pos, scale(d.vel, dt));
    d.age += dt;
    if (length(d.pos) < EARTH.radius || length(sub(d.pos, moonPosition(sim))) < MOON.radius || d.age > 4000) {
      d.alive = false;
    }
  }
}

// ---------- 軌道要素 ----------
export function dominantBody(sim, pos = sim.pos, t = sim.time) {
  const m = moonPosition(sim, t);
  return length(sub(pos, m)) < MOON.soi ? 'moon' : 'earth';
}

export function relativeState(sim, body = dominantBody(sim)) {
  if (body === 'moon') {
    return { body, radius: MOON.radius, mu: MOON.mu, pos: sub(sim.pos, moonPosition(sim)), vel: sub(sim.vel, moonVelocity(sim)) };
  }
  return { body, radius: EARTH.radius, mu: EARTH.mu, pos: sim.pos.slice(), vel: sim.vel.slice() };
}

export function orbitalElements(pos, vel, mu, radius) {
  const r = length(pos);
  const v2 = dot(vel, vel);
  const h = cross(pos, vel);
  const evec = sub(scale(cross(vel, h), 1 / mu), scale(pos, 1 / r));
  const e = length(evec);
  const energy = v2 / 2 - mu / r;
  const a = -mu / (2 * energy);
  const pe = (length(h) ** 2 / mu) / (1 + e) - radius;
  const ap = e < 1 ? a * (1 + e) - radius : Infinity;
  const period = e < 1 ? 2 * Math.PI * Math.sqrt(a ** 3 / mu) : Infinity;
  return { a, e, ap, pe, period, energy };
}

// ---------- 軌道予測 ----------
// これからの軌跡を、地球基準と月基準の両方の座標で返す。
export function predict(sim, { maxPoints = 1500, maxTime } = {}) {
  let pos = sim.pos.slice();
  let vel = sim.vel.slice();
  let t = sim.time;
  const rel = relativeState(sim);
  const el = orbitalElements(rel.pos, rel.vel, rel.mu, rel.radius);
  const horizon = maxTime ?? Math.min(15000, Math.max(60, (Number.isFinite(el.period) ? el.period * 1.02 : 15000)));
  const points = [];        // 地球基準の位置
  const moonRel = [];       // その時刻の月からの相対位置
  const inMoon = [];
  let closest = { dist: Infinity, time: 0, alt: Infinity };
  let impact = null;
  let soiEntry = null;
  const maxSteps = maxPoints * 4;
  const stride = 4;
  let stepCount = 0;
  const end = t + horizon;
  while (t < end && stepCount < maxSteps) {
    const rE = length(pos);
    const mp = moonPosition(sim, t);
    const dM = sub(pos, mp);
    const rM = length(dM);
    // 天体に近いほど細かい刻みで積分する
    const tE = Math.sqrt(rE ** 3 / EARTH.mu);
    const tM = Math.sqrt(rM ** 3 / MOON.mu);
    const dt = Math.max(0.02, Math.min(0.02 * Math.min(tE, tM), 20));
    if (stepCount % stride === 0) {
      points.push(pos);
      moonRel.push(dM);
      inMoon.push(rM < MOON.soi);
    }
    if (rM - MOON.radius < closest.alt) closest = { dist: rM, alt: rM - MOON.radius, time: t - sim.time };
    if (!soiEntry && rM < MOON.soi && dominantBody(sim) === 'earth') soiEntry = { time: t - sim.time };
    if (rE <= EARTH.radius) { impact = { body: 'earth', time: t - sim.time, pos }; break; }
    if (rM <= MOON.radius) { impact = { body: 'moon', time: t - sim.time, pos, moonRel: dM }; break; }
    const a0 = gravityAt(sim, pos, t);
    const vh = add(vel, scale(a0, dt / 2));
    pos = add(pos, scale(vh, dt));
    t += dt;
    const a1 = gravityAt(sim, pos, t);
    vel = add(vh, scale(a1, dt / 2));
    stepCount++;
  }
  points.push(pos);
  moonRel.push(sub(pos, moonPosition(sim, t)));
  inMoon.push(length(sub(pos, moonPosition(sim, t))) < MOON.soi);
  return { points, moonRel, inMoon, closest, impact, soiEntry, elements: el, body: rel.body };
}
