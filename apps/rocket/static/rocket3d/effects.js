import * as THREE from 'three';
import { PARTICLE_SHADER } from './shaders.js';

// 粒子は「ワールド座標 − 原点オフセット」で持つ。原点オフセットはロケット付近に置き、
// GPU の 32bit 浮動小数でも細かい位置が崩れないようにする。
export class ParticleSystem {
  constructor(scene, { max = 2000, additive = false } = {}) {
    this.max = max;
    this.count = 0;
    this.p = new Float64Array(max * 3); // 位置（ワールド）
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.col = new Float32Array(max * 4);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.geo.setAttribute('aColor', this.colAttr);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uPixelScale: { value: 600 }, uAdditive: { value: additive ? 1 : 0 } },
      vertexShader: PARTICLE_SHADER.vertexShader,
      fragmentShader: PARTICLE_SHADER.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 4;
    scene.add(this.points);
  }

  emit(pos, vel, { life = 2, size0 = 1, size1 = 4, color = [1, 1, 1, 1], drag = 0 }) {
    let i = this.count;
    if (i >= this.max) {
      // 一番古い粒子を上書き
      i = Math.floor(Math.random() * this.max);
    } else {
      this.count++;
    }
    this.p[i * 3] = pos[0]; this.p[i * 3 + 1] = pos[1]; this.p[i * 3 + 2] = pos[2];
    this.v[i * 3] = vel[0]; this.v[i * 3 + 1] = vel[1]; this.v[i * 3 + 2] = vel[2];
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.col.set(color, i * 4);
    this.drag[i] = drag;
  }

  update(dt, origin, gravityFn) {
    const P = this.posAttr.array, S = this.sizeAttr.array, C = this.colAttr.array;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        // 末尾の粒子と入れ替えて消す
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      if (gravityFn) {
        const g = gravityFn(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
        this.v[i * 3] += g[0] * dt; this.v[i * 3 + 1] += g[1] * dt; this.v[i * 3 + 2] += g[2] * dt;
      }
      for (let a = 0; a < 3; a++) {
        this.v[i * 3 + a] *= k;
        this.p[i * 3 + a] += this.v[i * 3 + a] * dt;
      }
    }
    this.count = n;
    for (let i = 0; i < n; i++) {
      const t = this.life[i] / this.maxLife[i];
      P[i * 3] = this.p[i * 3] - origin[0];
      P[i * 3 + 1] = this.p[i * 3 + 1] - origin[1];
      P[i * 3 + 2] = this.p[i * 3 + 2] - origin[2];
      S[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * Math.sqrt(t);
      C[i * 4] = this.col[i * 4]; C[i * 4 + 1] = this.col[i * 4 + 1]; C[i * 4 + 2] = this.col[i * 4 + 2];
      C[i * 4 + 3] = this.col[i * 4 + 3] * Math.min(1, t * 8) * (1 - t);
    }
    this.geo.setDrawRange(0, n);
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  copy(from, to) {
    for (let a = 0; a < 3; a++) { this.p[to * 3 + a] = this.p[from * 3 + a]; this.v[to * 3 + a] = this.v[from * 3 + a]; }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from];
    this.size1[to] = this.size1[from];
    this.drag[to] = this.drag[from];
    for (let a = 0; a < 4; a++) this.col[to * 4 + a] = this.col[from * 4 + a];
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}
