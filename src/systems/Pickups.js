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
      c.age = 0;
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
      c.age += dt;

      toShip.subVectors(shipPos, p);
      const dist = toShip.length();
      // Coins burst out of the wreck, then fly to the player on their own.
      if (canCollect && !c.homing && (c.age > CONFIG.coins.homingDelay || dist < magnetRadius)) c.homing = true;

      if (c.homing && canCollect) {
        // Accelerate hard so even far-away salvage (turret kills) arrives in a couple of seconds.
        const speed = Math.min(Math.max(c.vel.length(), 40) + (180 + dist * 0.8) * dt, 600);
        c.vel.lerp(toShip.normalize().multiplyScalar(speed), 1 - Math.exp(-10 * dt));
      } else {
        c.vel.multiplyScalar(Math.exp(-1.5 * dt));
      }
      p.addScaledVector(c.vel, dt);

      const spin = Math.abs(Math.cos(time * 4 + c.phase));
      c.sprite.scale.set(c.size * Math.max(spin, 0.12), c.size, 1);

      // A fast coin can cover more than the pickup radius in one frame: count it if it would reach us.
      if (canCollect && dist < collectRadius + (c.homing ? c.vel.length() * dt : 0)) {
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
