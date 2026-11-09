// 3D 月面着陸ゲーム（/rocket_3d）の物理のテスト
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fly } = require('./rocket3d_autopilot.cjs');

const load = () => import(pathToFileURL(path.join(__dirname, '../apps/rocket/static/rocket3d/physics.js')).href);

test('自動操縦で打ち上げから月面着陸まで成功する（月の位置を変えても）', async () => {
  for (const phase of [0, 1.2, 2.5, 4, 5.5]) {
    const r = await fly({ moonPhase0: phase });
    assert.equal(r.ok, true, `phase ${phase}: ${r.why || r.sim.result?.reason}`);
    assert.ok(r.report.fuelLeft > 0.5, 'プレイヤーが多少無駄にしても届くよう燃料に余裕がある');
  }
});

test('推力を出さなければ発射台から離れず、地球の自転とともに動く', async () => {
  const P = await load();
  const sim = P.createSim();
  for (let i = 0; i < 600; i++) P.step(sim, 1 / 60, { throttle: 0, nose: sim.nose });
  assert.equal(sim.status, 'prelaunch');
  const site = P.launchSite(sim.time);
  assert.ok(P.length(P.sub(sim.pos, site.pos)) < 1e-6);
});

test('速すぎる接地は墜落、ゆっくりなら着陸成功で、着陸後は月と一緒に動く', async () => {
  const P = await load();
  const setup = (vdown) => {
    const sim = P.createSim({ moonPhase0: 0.3 });
    sim.status = 'flying';
    sim.stages.shift();
    const up = [0, 0, 1];
    sim.pos = P.add(P.moonPosition(sim), P.scale(up, P.MOON.radius + 0.3));
    sim.vel = P.add(P.moonVelocity(sim), P.scale(up, -vdown));
    return { sim, up };
  };
  const fast = setup(8);
  for (let i = 0; i < 120 && fast.sim.status === 'flying'; i++) P.step(fast.sim, 1 / 60, { throttle: 0, nose: fast.up });
  assert.equal(fast.sim.status, 'crashed');

  const slow = setup(1);
  for (let i = 0; i < 120 && slow.sim.status === 'flying'; i++) P.step(slow.sim, 1 / 60, { throttle: 0, nose: slow.up });
  assert.equal(slow.sim.status, 'landed');
  for (let i = 0; i < 1000; i++) P.step(slow.sim, 1, { throttle: 0, nose: slow.up });
  const alt = P.length(P.sub(slow.sim.pos, P.moonPosition(slow.sim))) - P.MOON.radius;
  assert.ok(Math.abs(alt) < 1e-6, `着陸後も月面上にいる (alt=${alt})`);
});

test('ブースターを付けたままでは着陸脚がなく失敗になる', async () => {
  const P = await load();
  const sim = P.createSim();
  sim.status = 'flying';
  const up = [1, 0, 0];
  sim.pos = P.add(P.moonPosition(sim), P.scale(up, P.MOON.radius + 0.2));
  sim.vel = P.add(P.moonVelocity(sim), P.scale(up, -0.5));
  for (let i = 0; i < 60 && sim.status === 'flying'; i++) P.step(sim, 1 / 60, { throttle: 0, nose: up });
  assert.equal(sim.status, 'crashed');
  assert.match(sim.result.reason, /着陸脚/);
});

test('円軌道の予測は1周して元の位置に戻り、軌道要素も円になる', async () => {
  const P = await load();
  const sim = P.createSim({ moonPhase0: Math.PI }); // 月を遠ざけて地球だけの影響にする
  sim.status = 'flying';
  const r = P.EARTH.radius + 120;
  sim.pos = [r, 0, 0];
  sim.vel = [0, 0, -Math.sqrt(P.EARTH.mu / r)];
  const el = P.orbitalElements(sim.pos, sim.vel, P.EARTH.mu, P.EARTH.radius);
  assert.ok(Math.abs(el.ap - 120) < 0.5 && Math.abs(el.pe - 120) < 0.5);
  const pr = P.predict(sim);
  assert.equal(pr.impact, null);
  const last = pr.points[pr.points.length - 1];
  // 予測は 1.02 周分なので、終点は出発点から 0.02 周分（約 140）先になる
  const arc = 2 * Math.PI * r * 0.02;
  assert.ok(Math.abs(P.length(P.sub(last, sim.pos)) - arc) < 25, '1周してほぼ元の位置に戻る');
});
