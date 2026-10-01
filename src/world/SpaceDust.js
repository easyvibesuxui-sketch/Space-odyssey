import * as THREE from 'three';
import { rand } from '../core/noise.js';

// Fast streaks close to the camera that sell the sense of speed.
export class SpaceDust {
  constructor(scene, count = 420) {
    this.count = count;
    this.points = [];
    const positions = new Float32Array(count * 6);
    const colors = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const p = new THREE.Vector3(rand(-90, 90), rand(-55, 55), rand(-260, 30));
      this.points.push(p);
      const b = rand(0.25, 0.7);
      // Head is bright, tail fades to black (additive => invisible).
      colors.set([b * 0.7, b * 0.85, b, 0, 0, 0], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.geo, mat);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }

  update(dt, speed, center) {
    const pos = this.geo.attributes.position.array;
    const len = 0.6 + speed * 0.09;
    for (let i = 0; i < this.count; i++) {
      const p = this.points[i];
      p.z += speed * 1.6 * dt;
      if (p.z > 30) {
        p.set(center.x + rand(-90, 90), center.y + rand(-55, 55), -260);
      }
      pos[i * 6] = p.x;
      pos[i * 6 + 1] = p.y;
      pos[i * 6 + 2] = p.z;
      pos[i * 6 + 3] = p.x;
      pos[i * 6 + 4] = p.y;
      pos[i * 6 + 5] = p.z - len;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
