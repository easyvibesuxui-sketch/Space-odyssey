import * as THREE from 'three';
import { rand } from '../core/noise.js';

// Motes floating in space around the camera. They are static in the world, so flying through
// them gives parallax; each is drawn as a short streak along the ship's velocity.
export class SpaceDust {
  constructor(scene, count = 500, size = 140) {
    this.count = count;
    this.size = size;
    this.points = [];
    const positions = new Float32Array(count * 6);
    const colors = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      this.points.push(new THREE.Vector3(rand(-size, size), rand(-size, size), rand(-size, size)));
      const b = rand(0.25, 0.7);
      colors.set([b * 0.7, b * 0.85, b, 0, 0, 0], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.lines = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }

  update(center, velocity) {
    const pos = this.geo.attributes.position.array;
    const s = this.size;
    const span = s * 2;
    const k = 0.05;
    for (let i = 0; i < this.count; i++) {
      const p = this.points[i];
      // Wrap into a cube centred on the camera.
      p.x = center.x + ((((p.x - center.x + s) % span) + span) % span) - s;
      p.y = center.y + ((((p.y - center.y + s) % span) + span) % span) - s;
      p.z = center.z + ((((p.z - center.z + s) % span) + span) % span) - s;
      pos[i * 6] = p.x;
      pos[i * 6 + 1] = p.y;
      pos[i * 6 + 2] = p.z;
      pos[i * 6 + 3] = p.x + velocity.x * k;
      pos[i * 6 + 4] = p.y + velocity.y * k;
      pos[i * 6 + 5] = p.z + velocity.z * k;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
