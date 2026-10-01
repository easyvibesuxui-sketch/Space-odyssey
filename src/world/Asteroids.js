import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm3, rand } from '../core/noise.js';
import { CONFIG } from '../config.js';

function makeRockGeometry(seed, detail) {
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const squash = new THREE.Vector3(rand(0.75, 1.15), rand(0.65, 1.0), rand(0.8, 1.25));
  const craters = Array.from({ length: 5 + Math.floor(Math.random() * 5) }, () => ({
    c: new THREE.Vector3().randomDirection(),
    r: rand(0.18, 0.45),
    d: rand(0.06, 0.16),
  }));

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let n = fbm3(v.x * 1.4 + seed, v.y * 1.4, v.z * 1.4, seed, 4) * 0.42;
    n += fbm3(v.x * 4.5, v.y * 4.5 + seed, v.z * 4.5, seed + 9, 3) * 0.1;
    let crater = 0;
    for (const k of craters) {
      const dist = v.distanceTo(k.c);
      if (dist < k.r) {
        const t = dist / k.r;
        // Bowl with a slightly raised rim.
        crater += -k.d * (1 - t * t) + (t > 0.75 ? k.d * 0.5 * (1 - Math.abs(t - 0.88) / 0.13) : 0);
      }
    }
    const r = 1 + n + crater;
    v.multiplyScalar(r).multiply(squash);
    pos.setXYZ(i, v.x, v.y, v.z);

    const shade = THREE.MathUtils.clamp(0.75 + n * 0.9 + crater * 2, 0.35, 1.15);
    colors[i * 3] = shade * 0.92;
    colors[i * 3 + 1] = shade * 0.94;
    colors[i * 3 + 2] = shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export class Asteroids {
  constructor(scene) {
    this.scene = scene;
    this.smallGeos = Array.from({ length: 4 }, (_, i) => makeRockGeometry(i * 13.7, 3));
    this.bigGeos = Array.from({ length: 4 }, (_, i) => makeRockGeometry(100 + i * 7.1, 4));
    this.baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a6e78,
      roughness: 0.93,
      metalness: 0.05,
      vertexColors: true,
      emissive: 0x000000,
    });

    // Destructible rocks orbiting inside the belt.
    this.list = [];
    for (let i = 0; i < CONFIG.belt.count; i++) {
      const mesh = new THREE.Mesh(this.smallGeos[0], this.baseMaterial.clone());
      scene.add(mesh);
      const a = {
        mesh,
        radius: 1,
        hp: 1,
        maxHp: 1,
        spin: new THREE.Vector3(),
        orbitR: 0,
        angle: 0,
        height: 0,
        omega: 0,
        active: true,
        flash: 0,
      };
      this._spawn(a, rand(0, Math.PI * 2));
      this.list.push(a);
    }

    this._buildDecorativeBelt();
  }

  _spawn(a, angle) {
    const { inner, outer, thickness, minSize, maxSize } = CONFIG.belt;
    const s = minSize + (maxSize - minSize) * Math.pow(Math.random(), 2);
    a.radius = s;
    a.maxHp = a.hp = Math.ceil(s * s * 1.1 + 10);
    a.flash = 0;
    a.orbitR = rand(inner, outer);
    a.angle = angle;
    a.height = rand(-thickness, thickness) * 0.6;
    // Kepler-ish: inner rocks orbit faster.
    a.omega = 1.6 / Math.sqrt(a.orbitR);
    const geos = s > 6 ? this.bigGeos : this.smallGeos;
    a.mesh.geometry = geos[Math.floor(Math.random() * geos.length)];
    a.mesh.scale.setScalar(s);
    a.mesh.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
    a.spin.set(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5)).multiplyScalar(1.6 / Math.sqrt(s));
    this._place(a);
  }

  _place(a) {
    a.mesh.position.set(Math.cos(a.angle) * a.orbitR, a.height, Math.sin(a.angle) * a.orbitR);
  }

  _buildDecorativeBelt() {
    const count = 700;
    const geo = makeRockGeometry(500, 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x595e68, roughness: 0.95, vertexColors: true });
    this.belt = new THREE.InstancedMesh(geo, mat, count);
    const dummy = new THREE.Object3D();
    const { inner, outer, thickness } = CONFIG.belt;
    for (let i = 0; i < count; i++) {
      const ang = rand(0, Math.PI * 2);
      // Denser in the middle of the belt.
      const t = (Math.random() + Math.random()) / 2;
      const r = inner - 20 + (outer - inner + 40) * t;
      dummy.position.set(Math.cos(ang) * r, rand(-thickness, thickness) * (1 - Math.abs(t - 0.5)), Math.sin(ang) * r);
      dummy.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      dummy.scale.setScalar(0.6 + Math.pow(Math.random(), 3) * 4.5);
      dummy.updateMatrix();
      this.belt.setMatrixAt(i, dummy.matrix);
    }
    this.belt.computeBoundingSphere();
    this.scene.add(this.belt);
  }

  update(dt) {
    for (const a of this.list) {
      if (!a.active) continue;
      a.angle += a.omega * dt * 0.1;
      this._place(a);
      const m = a.mesh;
      m.rotation.x += a.spin.x * dt;
      m.rotation.y += a.spin.y * dt;
      m.rotation.z += a.spin.z * dt;
      if (a.flash > 0) {
        a.flash = Math.max(0, a.flash - dt * 6);
        m.material.emissive.setRGB(a.flash * 0.45, a.flash * 0.28, a.flash * 0.12);
      }
    }
    this.belt.rotation.y += dt * 0.006;
  }

  // Apply damage. Returns { position, radius } if the asteroid was destroyed, otherwise null.
  damage(a, amount) {
    a.hp -= amount;
    a.flash = 1;
    if (a.hp > 0) return null;
    const result = { position: a.mesh.position.clone(), radius: a.radius };
    // Respawn on the far side of the belt so rocks don't pop in front of the player.
    this._spawn(a, a.angle + Math.PI + rand(-1, 1));
    return result;
  }
}
