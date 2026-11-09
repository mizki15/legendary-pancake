// 3D 月面着陸ゲームの物理を、自動操縦で打ち上げから月面着陸まで飛ばす。
// テスト（rocket3d_physics.test.cjs）から使うほか、単体でも実行できる:
//   node tests/rocket3d_autopilot.cjs
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PHYSICS = pathToFileURL(path.join(__dirname, '../apps/rocket/static/rocket3d/physics.js')).href;

async function fly({ moonPhase0 = 1.2, log = false } = {}) {
  const P = await import(PHYSICS);
  const sim = P.createSim({ moonPhase0 });
  const dt = 1 / 30;
  const report = { phases: {} };
  const say = (...a) => { if (log) console.log(...a); };
  const run = (controls) => P.step(sim, dt, controls);
  const local = () => {
    const rel = P.relativeState(sim);
    const up = P.normalize(rel.pos);
    const east = P.normalize(P.cross([0, 1, 0], up));
    const el = P.orbitalElements(rel.pos, rel.vel, rel.mu, rel.radius);
    return { rel, up, east, el, alt: P.length(rel.pos) - rel.radius };
  };
  const stageIfEmpty = () => {
    if (sim.stages.length > 1 && sim.stages[0].fuel <= 0) {
      P.stageSeparation(sim);
      say('stage sep at t', sim.missionTime.toFixed(1), 'alt', local().alt.toFixed(1));
    }
  };

  // 1) 打ち上げ：垂直上昇から東へ徐々に倒す（重力ターン）
  let guard = 0;
  while (guard++ < 1e5) {
    const { up, east, el, alt } = local();
    if (el.ap >= 110) break;
    const pitch = alt < 1 ? 0 : (Math.PI / 2) * Math.min(1, (alt / 50) ** 0.55);
    const nose = P.add(P.scale(up, Math.cos(pitch)), P.scale(east, Math.sin(pitch)));
    run({ throttle: 1, nose });
    stageIfEmpty();
    if (sim.status !== 'flying' && sim.status !== 'prelaunch') return { ok: false, sim, why: 'ascent ' + sim.status };
  }
  report.phases.ascent = P.deltaV(sim).total;
  say('MECO t', sim.missionTime.toFixed(1), 'ap', local().el.ap.toFixed(1), 'dv left', P.deltaV(sim).total.toFixed(1));

  // 2) 遠地点まで慣性飛行して円軌道化
  guard = 0;
  while (guard++ < 1e5) {
    const { rel } = local();
    if (P.dot(rel.pos, rel.vel) <= 0) break;
    run({ throttle: 0, nose: P.normalize(rel.vel) });
  }
  guard = 0;
  while (guard++ < 1e5) {
    const { rel, el, up } = local();
    if (el.pe >= 85) break;
    const horiz = P.normalize(P.sub(rel.vel, P.scale(up, P.dot(rel.vel, up))));
    run({ throttle: 1, nose: horiz });
    stageIfEmpty();
  }
  stageIfEmpty();
  if (sim.stages.length > 1) { P.stageSeparation(sim); say('manual stage sep in orbit'); }
  const o = local().el;
  report.orbit = { ap: o.ap, pe: o.pe };
  report.phases.orbit = P.deltaV(sim).total;
  say('orbit ap', o.ap.toFixed(1), 'pe', o.pe.toFixed(1), 'dv left', P.deltaV(sim).total.toFixed(1));

  // 3) 月遷移噴射：タイミングを探して、月に当たる（または近くを通る）軌道に乗せる
  const tryBurn = () => {
    const c = structuredClone(sim);
    let g = 0;
    while (g++ < 5000) {
      const rel = P.relativeState(c);
      const el = P.orbitalElements(rel.pos, rel.vel, rel.mu, rel.radius);
      if (el.ap >= P.MOON.distance - 400) break;
      P.step(c, dt, { throttle: 1, nose: P.normalize(rel.vel) });
    }
    const pr = P.predict(c, { maxTime: 3500, maxPoints: 1500 });
    return { c, pr };
  };
  let chosen = null;
  for (let i = 0; i < 2000 && !chosen; i++) {
    const { pr } = tryBurn();
    if (pr.impact?.body === 'moon' || pr.closest.alt < 60) chosen = pr;
    else for (let k = 0; k < 30; k++) run({ throttle: 0, nose: P.normalize(local().rel.vel) });
  }
  if (!chosen) return { ok: false, sim, why: 'no transfer window found' };
  guard = 0;
  while (guard++ < 1e5) {
    const { rel, el } = local();
    if (el.ap >= P.MOON.distance - 400) break;
    run({ throttle: 1, nose: P.normalize(rel.vel) });
  }
  report.phases.transfer = P.deltaV(sim).total;
  say('TLI done; dv left', P.deltaV(sim).total.toFixed(1), 'coast...');

  // 4) 月へ慣性飛行（時間刻みを大きくして早送り）
  guard = 0;
  while (guard++ < 1e6) {
    const m = P.sub(sim.pos, P.moonPosition(sim));
    if (P.length(m) - P.MOON.radius < 1500) break;
    P.step(sim, 0.5, { throttle: 0, nose: sim.nose });
    if (sim.status !== 'flying') return { ok: false, sim, why: 'coast ' + sim.status };
  }
  // 月の影響圏に入ってから、月面に当たる軌道に微調整（逆噴射で横速度を消す）
  // 5) 着陸：逆噴射で減速し、最後は垂直に降りる
  guard = 0;
  while (guard++ < 1e6 && sim.status === 'flying') {
    const { rel, up, alt } = local();
    const v = rel.vel;
    const vVert = P.dot(v, up);
    const vHor = P.sub(v, P.scale(up, vVert));
    const g = P.MOON.mu / P.length(rel.pos) ** 2;
    const stage = sim.stages[0];
    const aMax = stage.thrust / P.rocketMass(sim);
    let nose, throttle;
    if (alt > 25) {
      const speed = P.length(v);
      const need = (speed * speed) / (2 * Math.max(1, alt - 15)) + g;
      nose = P.normalize(P.scale(v, -1));
      throttle = need > 0.85 * aMax ? Math.min(1, need / aMax) : 0;
    } else {
      const targetVz = -Math.max(0.8, alt * 0.12);
      const az = (targetVz - vVert) * 1.5 + g;
      const ah = P.scale(vHor, -1.2);
      const want = P.add(P.scale(up, Math.max(0.05, az)), ah);
      nose = P.normalize(want);
      if (P.dot(nose, up) < 0.9) nose = P.normalize(P.add(P.scale(up, 1), P.scale(P.normalize(ah), 0.45)));
      throttle = Math.min(1, P.length(want) / aMax);
    }
    run({ throttle, nose });
  }
  report.result = sim.result;
  report.fuelLeft = sim.stages[0]?.fuel;
  report.missionTime = sim.missionTime;
  report.maxG = sim.maxG;
  say('result', sim.result, 'fuel left', report.fuelLeft?.toFixed(2), 'mission time', sim.missionTime.toFixed(0));
  return { ok: sim.status === 'landed', sim, report };
}

module.exports = { fly };

if (require.main === module) {
  fly({ log: true, moonPhase0: Number(process.argv[2] ?? 1.2) }).then((r) => {
    console.log(r.ok ? 'LANDED' : 'FAILED: ' + (r.why || r.sim.result?.reason), JSON.stringify(r.report?.phases ?? {}));
  });
}
