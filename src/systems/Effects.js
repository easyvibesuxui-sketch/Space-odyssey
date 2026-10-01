import * as THREE from 'three';
import { rand } from '../core/noise.js';

// One big pooled particle system (additive, bloom-friendly) for sparks, explosions and smoke.
export class Effects {
  constructor(scene, max = 4000) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.baseCol = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: window.innerHeight / 2 } },
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * a, 1.0);
        }
      `,
      vertexColors: true,
    });
    this.material = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Expanding shockwave rings.
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0x66ccff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 0.5, size: 10 });
    }

    this.shake = 0;
  }

  onResize(pixelRatio) {
    this.material.uniforms.uScale.value = (window.innerHeight * pixelRatio) / 2;
  }

  emit(p, v, color, size, life, drag = 1.5) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.baseCol[i * 3] = color.r;
    this.baseCol[i * 3 + 1] = color.g;
    this.baseCol[i * 3 + 2] = color.b;
    this.baseSize[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = drag;
  }

  sparks(p, count, color, speed = 30, size = 0.8, life = 0.4) {
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(rand(0.3, 1) * speed);
      this.emit(p, v, color, size * rand(0.6, 1.2), life * rand(0.6, 1.3), 3);
    }
  }

  explosion(p, radius = 3, flowSpeed = 0) {
    const v = new THREE.Vector3();
    const fire = new THREE.Color(3.5, 1.6, 0.5);
    const hot = new THREE.Color(4, 3.5, 2.5);
    const blue = new THREE.Color(0.8, 1.8, 4);
    const dust = new THREE.Color(0.35, 0.38, 0.45);
    const n = Math.min(40 + radius * 14, 220);
    for (let i = 0; i < n; i++) {
      v.randomDirection().multiplyScalar(rand(0.2, 1) * (12 + radius * 5));
      v.z += flowSpeed * 0.6;
      const r = Math.random();
      const c = r < 0.15 ? hot : r < 0.6 ? fire : r < 0.75 ? blue : dust;
      const sz = c === dust ? radius * rand(0.6, 1.2) : radius * rand(0.25, 0.6);
      this.emit(p, v, c, sz, rand(0.4, 1.1) * (0.7 + radius * 0.06), c === dust ? 1.2 : 2.2);
    }
    this.ring(p, radius * 3.2, 0.45);
    this.shake = Math.max(this.shake, Math.min(0.25 + radius * 0.05, 0.9));
  }

  ring(p, size, dur) {
    const r = this.rings.find((x) => !x.mesh.visible) ?? this.rings[0];
    r.mesh.visible = true;
    r.mesh.position.copy(p);
    r.t = 0;
    r.dur = dur;
    r.size = size;
  }

  update(dt, flow, camera) {
    const n = this.max;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(this.life[i] / this.maxLife[i], 0);
      const d = Math.exp(-this.drag[i] * dt);
      const i3 = i * 3;
      this.vel[i3] *= d;
      this.vel[i3 + 1] *= d;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += (this.vel[i3 + 2] + flow * 0.5) * dt;
      this.col[i3] = this.baseCol[i3] * k;
      this.col[i3 + 1] = this.baseCol[i3 + 1] * k;
      this.col[i3 + 2] = this.baseCol[i3 + 2] * k;
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * k);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.mesh.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(r.size * (0.2 + k));
      r.mesh.material.opacity = (1 - k) * 0.9;
      r.mesh.position.z += flow * 0.5 * dt;
      r.mesh.quaternion.copy(camera.quaternion);
    }

    this.shake = Math.max(0, this.shake - dt * 2.2);
  }
}
