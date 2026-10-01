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

    this.list = [];
    const poolSize = CONFIG.asteroids.count + 30;
    for (let i = 0; i < poolSize; i++) {
      const mesh = new THREE.Mesh(this.smallGeos[0], this.baseMaterial.clone());
      mesh.visible = false;
      scene.add(mesh);
      this.list.push({
        mesh,
        radius: 1,
        hp: 1,
        maxHp: 1,
        spin: new THREE.Vector3(),
        drift: new THREE.Vector3(),
        active: false,
        fragment: false,
        flash: 0,
      });
    }

    // Spread the initial field over the full depth so it isn't empty at start.
    for (let i = 0; i < CONFIG.asteroids.count; i++) {
      this._spawn(this.list[i], rand(CONFIG.spawnZ, -60), false);
    }

    this._buildBackgroundField();
  }

  _spawn(a, z, fragment, size) {
    const { minSize, maxSize, spreadX, spreadY } = CONFIG.asteroids;
    const s = size ?? minSize + (maxSize - minSize) * Math.pow(Math.random(), 2.3);
    a.radius = s;
    a.maxHp = a.hp = Math.ceil(s * s * 1.2 + 8);
    a.fragment = fragment;
    a.active = true;
    a.flash = 0;
    const geos = s > 6 ? this.bigGeos : this.smallGeos;
    a.mesh.geometry = geos[Math.floor(Math.random() * geos.length)];
    a.mesh.scale.setScalar(s);
    a.mesh.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
    a.mesh.visible = true;
    if (!fragment) {
      a.mesh.position.set(rand(-spreadX, spreadX), rand(-spreadY, spreadY), z);
    }
    a.spin.set(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5)).multiplyScalar(2.2 / Math.sqrt(s));
    a.drift.set(rand(-1.5, 1.5), rand(-1, 1), rand(-3, 6));
  }

  _buildBackgroundField() {
    const count = 260;
    const geo = makeRockGeometry(500, 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x555a63, roughness: 0.95, vertexColors: true });
    this.bg = new THREE.InstancedMesh(geo, mat, count);
    this.bgData = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      // Keep them outside the play lane so they're pure scenery.
      const angle = rand(0, Math.PI * 2);
      const dist = rand(230, 750);
      const d = {
        pos: new THREE.Vector3(Math.cos(angle) * dist, Math.sin(angle) * dist * 0.55, rand(-1400, 100)),
        rot: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
        spin: rand(-0.2, 0.2),
        scale: 6 + Math.pow(Math.random(), 2) * 40,
      };
      this.bgData.push(d);
      dummy.position.copy(d.pos);
      dummy.rotation.copy(d.rot);
      dummy.scale.setScalar(d.scale);
      dummy.updateMatrix();
      this.bg.setMatrixAt(i, dummy.matrix);
    }
    this.bg.frustumCulled = false;
    this.scene.add(this.bg);
    this._dummy = dummy;
  }

  update(dt, flow) {
    for (const a of this.list) {
      if (!a.active) continue;
      const m = a.mesh;
      m.position.x += a.drift.x * dt;
      m.position.y += a.drift.y * dt;
      m.position.z += (flow + a.drift.z) * dt;
      m.rotation.x += a.spin.x * dt;
      m.rotation.y += a.spin.y * dt;
      m.rotation.z += a.spin.z * dt;

      if (a.flash > 0) {
        a.flash = Math.max(0, a.flash - dt * 6);
        m.material.emissive.setRGB(a.flash * 0.45, a.flash * 0.28, a.flash * 0.12);
      }

      if (m.position.z - a.radius > CONFIG.despawnZ) this._recycle(a);
    }

    const dummy = this._dummy;
    for (let i = 0; i < this.bgData.length; i++) {
      const d = this.bgData[i];
      d.pos.z += flow * dt;
      if (d.pos.z > 150) d.pos.z -= 1550;
      d.rot.y += d.spin * dt;
      dummy.position.copy(d.pos);
      dummy.rotation.copy(d.rot);
      dummy.scale.setScalar(d.scale);
      dummy.updateMatrix();
      this.bg.setMatrixAt(i, dummy.matrix);
    }
    this.bg.instanceMatrix.needsUpdate = true;
  }

  _recycle(a) {
    if (a.fragment) {
      a.active = false;
      a.mesh.visible = false;
    } else {
      this._spawn(a, CONFIG.spawnZ + rand(-80, 0), false);
    }
  }

  // Apply damage. Returns { position, radius } if the asteroid was destroyed, otherwise null.
  damage(a, amount) {
    a.hp -= amount;
    a.flash = 1;
    if (a.hp > 0) return null;

    const pos = a.mesh.position.clone();
    const r = a.radius;
    this._recycle(a);

    // Big rocks crumble into smaller chunks.
    if (r > 5.5) {
      const pieces = r > 9 ? 3 : 2;
      for (let i = 0; i < pieces; i++) {
        const f = this.list.find((x) => !x.active);
        if (!f) break;
        this._spawn(f, 0, true, r * rand(0.35, 0.5));
        f.mesh.position.copy(pos).add(new THREE.Vector3().randomDirection().multiplyScalar(r * 0.5));
        f.drift.set(rand(-8, 8), rand(-6, 6), rand(-4, 8));
      }
    }
    return { position: pos, radius: r };
  }
}
