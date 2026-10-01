import * as THREE from 'three';
import { makeRadialTexture } from '../world/Sky.js';
import { rand } from '../core/noise.js';
import { CONFIG } from '../config.js';

const _desired = new THREE.Vector3();
const TRAIL_COLOR = new THREE.Color(3, 1.3, 0.4);
const SMOKE_COLOR = new THREE.Color(0.35, 0.35, 0.4);

// Homing missiles fired by missile batteries. They chase their target and explode with splash damage.
export class Missiles {
  constructor(scene, effects, pool = 40) {
    this.effects = effects;
    const geo = new THREE.ConeGeometry(0.35, 2.2, 8);
    geo.rotateX(Math.PI / 2); // tip along +Z
    const mat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.6, roughness: 0.4, emissive: 0x401000 });
    const glowTex = makeRadialTexture([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,170,80,0.7)'], [1, 'rgba(255,60,0,0)']], 64);
    this.list = [];
    for (let i = 0; i < pool; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color(3, 1.5, 0.6),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      glow.position.z = -1.3;
      glow.scale.setScalar(2.2);
      mesh.add(glow);
      mesh.visible = false;
      scene.add(mesh);
      this.list.push({ mesh, vel: new THREE.Vector3(), target: null, damage: 0, splash: 0, life: 0, speed: 0, active: false });
    }
  }

  fire(from, dir, target, damage, splash) {
    const m = this.list.find((x) => !x.active);
    if (!m) return null;
    m.active = true;
    m.target = target;
    m.damage = damage;
    m.splash = splash;
    m.life = 6;
    m.speed = 50;
    m.mesh.position.copy(from);
    m.vel.copy(dir).normalize().multiplyScalar(m.speed);
    m.mesh.visible = true;
    return m;
  }

  clear() {
    for (const m of this.list) {
      m.active = false;
      m.mesh.visible = false;
    }
  }

  // onExplode(position, damage, splash) is called when a missile detonates.
  update(dt, enemies, onExplode) {
    for (const m of this.list) {
      if (!m.active) continue;
      m.life -= dt;
      if (m.target && !m.target.active) m.target = this._retarget(m, enemies);

      m.speed = Math.min(m.speed + 160 * dt, 190);
      const p = m.mesh.position;
      if (m.target) {
        _desired.subVectors(m.target.group.position, p).normalize().multiplyScalar(m.speed);
        m.vel.lerp(_desired, 1 - Math.exp(-4 * dt));
      }
      m.vel.setLength(m.speed);
      p.addScaledVector(m.vel, dt);
      m.mesh.lookAt(_desired.copy(p).add(m.vel));

      // Exhaust trail.
      this.effects.emit(p, _desired.copy(m.vel).multiplyScalar(-0.05), TRAIL_COLOR, 1.1, 0.25, 4);
      if (Math.random() < 0.5) {
        this.effects.emit(p, _desired.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)), SMOKE_COLOR, 1.6, 0.8, 1);
      }

      const hitTarget = m.target && p.distanceTo(m.target.group.position) < m.target.radius + 1.5;
      if (hitTarget || m.life <= 0 || p.length() < CONFIG.planet.radius + 2) {
        m.active = false;
        m.mesh.visible = false;
        onExplode(p.clone(), m.damage, m.splash);
      }
    }
  }

  _retarget(m, enemies) {
    let best = null;
    let bd = 250 * 250;
    for (const e of enemies.list) {
      if (!e.active) continue;
      const d = e.group.position.distanceToSquared(m.mesh.position);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
}
