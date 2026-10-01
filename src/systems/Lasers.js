import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class Lasers {
  constructor(scene, { color = new THREE.Color(1.2, 3.2, 8), speed = CONFIG.laser.speed, life = CONFIG.laser.life, pool = 90, thickness = 0.16, length = 5 } = {}) {
    const geo = new THREE.BoxGeometry(thickness, thickness, length);
    const mat = new THREE.MeshBasicMaterial({ color });
    this.speed = speed;
    this.life = life;
    this.list = [];
    for (let i = 0; i < pool; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.list.push({
        mesh,
        dir: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        life: 0,
        damage: 0,
        active: false,
      });
    }
    this.cursor = 0;
  }

  fire(from, to, damage) {
    const l = this.list[this.cursor];
    this.cursor = (this.cursor + 1) % this.list.length;
    l.active = true;
    l.life = this.life;
    l.damage = damage;
    l.dir.subVectors(to, from).normalize();
    l.mesh.position.copy(from);
    l.prev.copy(from);
    l.mesh.lookAt(to);
    l.mesh.visible = true;
    return l;
  }

  // Recolour / resize every bolt (player laser upgrades).
  setStyle(color, width = 1, length = 1) {
    this.list[0].mesh.material.color.copy(color);
    for (const l of this.list) l.mesh.scale.set(width, width, length);
  }

  kill(l) {
    l.active = false;
    l.mesh.visible = false;
  }

  clear() {
    for (const l of this.list) this.kill(l);
  }

  update(dt) {
    for (const l of this.list) {
      if (!l.active) continue;
      l.prev.copy(l.mesh.position);
      l.mesh.position.addScaledVector(l.dir, this.speed * dt);
      l.life -= dt;
      if (l.life <= 0) this.kill(l);
    }
  }
}

// Closest distance from point c to segment ab (squared).
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _closest = new THREE.Vector3();
export function segmentHitsSphere(a, b, c, r) {
  _ab.subVectors(b, a);
  _ac.subVectors(c, a);
  const len2 = _ab.lengthSq();
  const t = len2 > 0 ? THREE.MathUtils.clamp(_ac.dot(_ab) / len2, 0, 1) : 0;
  _closest.copy(a).addScaledVector(_ab, t);
  return _closest.distanceToSquared(c) <= r * r ? _closest : null;
}
