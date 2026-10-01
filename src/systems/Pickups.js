import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { rand } from '../core/noise.js';

export class Pickups {
  constructor(scene, coinTexture, pool = 120) {
    this.coins = [];
    for (let i = 0; i < pool; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: coinTexture,
        color: new THREE.Color(1.5, 1.5, 1.5),
        transparent: true,
        depthWrite: false,
      }));
      sprite.visible = false;
      scene.add(sprite);
      this.coins.push({
        sprite,
        vel: new THREE.Vector3(),
        life: 0,
        phase: 0,
        value: 1,
        active: false,
        size: 1.8,
        homing: false,
      });
    }
  }

  spawnCoins(pos, count, value = 1) {
    for (let i = 0; i < count; i++) {
      const c = this.coins.find((x) => !x.active);
      if (!c) return;
      c.active = true;
      c.life = CONFIG.coins.life;
      c.value = value;
      c.phase = rand(0, 6.28);
      c.size = value > 1 ? 2.6 : 1.8;
      c.homing = false;
      c.sprite.position.copy(pos);
      c.vel.randomDirection().multiplyScalar(rand(4, 12));
      c.sprite.visible = true;
    }
  }

  clear() {
    for (const c of this.coins) {
      c.active = false;
      c.sprite.visible = false;
    }
  }

  // Moves coins, pulls nearby ones into the ship, returns collected value.
  update(dt, shipPos, time, canCollect = true) {
    let collected = 0;
    const { magnetRadius, collectRadius } = CONFIG.coins;
    const toShip = new THREE.Vector3();
    for (const c of this.coins) {
      if (!c.active) continue;
      const p = c.sprite.position;
      c.life -= dt;

      toShip.subVectors(shipPos, p);
      const dist = toShip.length();
      if (canCollect && !c.homing && dist < magnetRadius) c.homing = true;

      if (c.homing && canCollect) {
        // Locked on: fly straight into the ship, accelerating (faster than the ship can fly).
        const speed = Math.max(c.vel.length(), 60) + 260 * dt;
        c.vel.copy(toShip).normalize().multiplyScalar(speed);
      } else {
        c.vel.multiplyScalar(Math.exp(-1.5 * dt));
      }
      p.addScaledVector(c.vel, dt);

      const spin = Math.abs(Math.cos(time * 4 + c.phase));
      c.sprite.scale.set(c.size * Math.max(spin, 0.12), c.size, 1);

      if (canCollect && dist < collectRadius) {
        collected += c.value;
        c.active = false;
        c.sprite.visible = false;
        continue;
      }
      if (!c.homing && c.life <= 0) {
        c.active = false;
        c.sprite.visible = false;
      } else if (!c.homing && c.life < 3) {
        c.sprite.visible = Math.floor(c.life * 10) % 2 === 0;
      } else {
        c.sprite.visible = true;
      }
    }
    return collected;
  }
}
