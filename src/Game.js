import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { CONFIG } from './config.js';
import { Input } from './core/Input.js';
import { Sky, SUN_DIR } from './world/Sky.js';
import { Planet } from './world/Planet.js';
import { Asteroids } from './world/Asteroids.js';
import { SpaceDust } from './world/SpaceDust.js';
import { Ship } from './entities/Ship.js';
import { Enemies } from './entities/Enemies.js';
import { Lasers, segmentHitsSphere } from './systems/Lasers.js';
import { Effects } from './systems/Effects.js';
import { Pickups } from './systems/Pickups.js';
import { Waves } from './systems/Waves.js';
import { Hud } from './ui/Hud.js';

const AIM_DISTANCE = 500;
const ORIGIN = new THREE.Vector3(0, 0, 0);
const CAM_OFFSET = new THREE.Vector3(0, 4.2, 16.5);
const CAM_TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.06);

export class Game {
  constructor(canvas, assets, audio) {
    this.canvas = canvas;
    this.assets = assets;
    this.audio = audio;
    this.input = new Input(canvas);
    this.isTouch = this.input.isTouch;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio, this.isTouch ? 1.5 : 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x061426, 0.0007);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);
    this.baseFov = 62;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.scene.add(new THREE.HemisphereLight(0x3d6c9e, 0x05070c, 0.55));
    const sun = new THREE.DirectionalLight(0xd5e9ff, 2.8);
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fb4e0, 0.5);
    fill.position.copy(SUN_DIR).multiplyScalar(-100).add(new THREE.Vector3(0, 60, 0));
    this.scene.add(fill);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.45, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.sky = new Sky(this.scene);
    this.planet = new Planet(this.scene);
    this.asteroids = new Asteroids(this.scene);
    this.dust = new SpaceDust(this.scene);
    this.ship = new Ship(this.scene);
    this.enemies = new Enemies(this.scene);
    this.lasers = new Lasers(this.scene);
    this.enemyLasers = new Lasers(this.scene, {
      color: new THREE.Color(8, 1.6, 0.6),
      speed: CONFIG.enemyLaser.speed,
      life: CONFIG.enemyLaser.life,
      pool: 160,
      thickness: 0.3,
      length: 4,
    });
    this.effects = new Effects(this.scene);
    this.effects.onResize(this.pixelRatio);
    this.pickups = new Pickups(this.scene, assets.coin);
    this.hud = new Hud();
    this.waves = new Waves(this.enemies, {
      onWaveStart: ({ wave, fighters, bombers }) => {
        const parts = [`${fighters} fighters`];
        if (bombers) parts.push(`${bombers} bomber${bombers > 1 ? 's' : ''}`);
        this.hud.banner(`WAVE ${wave}`, `Incoming: ${parts.join(' · ')}`, { danger: true });
        this.audio.alarm?.();
      },
      onWaveCleared: ({ wave }) => {
        this.hud.banner('WAVE CLEARED', `Wave ${wave} destroyed · next wave incoming`);
      },
      onLevelComplete: ({ level }) => {
        const bonus = 40 * level;
        this.coins += bonus;
        this.score += 1000 * level;
        this.planetHp = Math.min(CONFIG.planet.hp, this.planetHp + 25);
        this.hud.banner(`LEVEL ${level} COMPLETE`, `+${bonus} coins · planet repaired +25`, { duration: 4000 });
      },
    });

    this.state = 'menu';
    this.time = 0;
    this.fireTimer = 0;
    this.hitSoundCooldown = 0;
    this.respawnTimer = 0;
    this.outOfBounds = false;
    this.score = 0;
    this.coins = 0;
    this.planetHp = CONFIG.planet.hp;

    this.aimPoint = new THREE.Vector3();
    this.aimNdc = new THREE.Vector2(0, 0.13);
    this.raycaster = new THREE.Raycaster();
    this.camQuat = this.ship.group.quaternion.clone();
    this.controls = { pitch: 0, yaw: 0, roll: 0, throttle: 0, boost: false };
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();

    window.addEventListener('resize', () => this.onResize());
    document.getElementById('restart-btn').addEventListener('click', () => this.restart());

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    window.__game = this; // handy for debugging from the console
    this._updateCamera(1);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  start() {
    this.hud.show(true);
    document.getElementById('touch-controls').classList.toggle('hidden', !this.isTouch);
    this.restart();
  }

  restart() {
    document.getElementById('game-over').classList.add('hidden');
    this.ship.reset();
    this.enemies.clear();
    this.lasers.clear();
    this.enemyLasers.clear();
    this.pickups.clear();
    this.waves.reset();
    this.score = 0;
    this.coins = 0;
    this.planetHp = CONFIG.planet.hp;
    this.respawnTimer = 0;
    this.camQuat.copy(this.ship.group.quaternion);
    this.state = 'playing';
    this.hud.banner('DEFEND YOUR HOMEWORLD', 'Enemy fleet detected · first wave in 3 seconds', { duration: 3000 });
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.effects.onResize(this.pixelRatio);
  }

  frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    this.time += dt;
    this.update(dt);
    this.composer.render();
  }

  update(dt) {
    const playing = this.state === 'playing';
    this.input.update();

    if (playing) this.waves.update(dt);

    this._updateControls(dt, playing);
    if (this.ship.alive) this.ship.update(dt, this.controls, this.time);
    this._updateAim();

    if (playing && this.ship.alive) this._handleFiring(dt);

    this.planet.update(dt);
    this.asteroids.update(dt);
    this.enemies.update(dt, {
      ship: this.ship,
      planetRadius: CONFIG.planet.radius,
      lasers: this.enemyLasers,
      time: this.time,
    });
    this.lasers.update(dt);
    this.enemyLasers.update(dt);
    if (this.state !== 'menu') this._collisions();

    const collected = this.pickups.update(dt, this.ship.group.position, this.time, this.ship.alive);
    if (collected > 0) {
      this.coins += collected;
      this.audio.coin();
    }

    if (playing && !this.ship.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.ship.reset();
        this.camQuat.copy(this.ship.group.quaternion);
        this.hud.banner('SHIP RESPAWNED', 'Back to the fight');
      }
    }

    this.effects.update(dt, 0, this.camera);
    this._updateCamera(dt);
    this.dust.update(this.camera.position, this.ship.velocity);
    this.sky.update(this.camera, this.time);

    if (this.state !== 'menu') this.hud.update(this);
    this.hitSoundCooldown -= dt;
  }

  _updateControls(dt, playing) {
    const c = this.controls;
    const pos = this.ship.group.position;

    if (!playing) {
      // Attract mode / game over: lazy orbit around the planet.
      const toC = this._v.copy(pos).negate().applyQuaternion(this._q.copy(this.ship.group.quaternion).invert());
      c.yaw = THREE.MathUtils.clamp(toC.x * 0.01 + 0.25, -1, 1);
      c.pitch = THREE.MathUtils.clamp(toC.y * 0.01, -1, 1);
      c.roll = 0;
      c.throttle = -0.3;
      c.boost = false;
      this.outOfBounds = false;
      return;
    }

    const input = this.input;
    // Where the ship's nose points on screen: steering is relative to this.
    const nose = this._v.copy(this.ship.forward).multiplyScalar(AIM_DISTANCE).add(pos).project(this.camera);
    let sx = input.keySteer.x;
    let sy = input.keySteer.y;
    if (!this.isTouch && sx === 0 && sy === 0 && input.mouseActive) {
      const dz = (v) => (Math.abs(v) < 0.035 ? 0 : (v - Math.sign(v) * 0.035) / 0.45);
      sx = dz(input.aim.x - nose.x);
      sy = dz(input.aim.y - nose.y);
    }
    c.yaw = THREE.MathUtils.clamp(sx, -1, 1);
    c.pitch = THREE.MathUtils.clamp(sy, -1, 1);
    c.roll = input.roll;
    c.throttle = input.throttle;
    c.boost = input.boost;

    // Crosshair: the mouse on desktop, the ship's nose on touch.
    if (this.isTouch || !input.mouseActive) this.aimNdc.set(nose.x, nose.y);
    else this.aimNdc.set(input.aim.x, input.aim.y);
    this.hud.setCrosshair(this.aimNdc.x, this.aimNdc.y);

    // Leaving the arena: take over and turn back towards the planet.
    this.outOfBounds = pos.length() > CONFIG.arenaRadius;
    if (this.outOfBounds) {
      const local = this._v2.copy(pos).negate().normalize().applyQuaternion(this._q.copy(this.ship.group.quaternion).invert());
      c.yaw = THREE.MathUtils.clamp(local.x * 3, -1, 1);
      c.pitch = THREE.MathUtils.clamp(local.y * 3, -1, 1);
      if (local.z > 0) c.yaw = c.yaw >= 0 ? 1 : -1; // target behind us: hard turn
    }
  }

  _updateAim() {
    this.raycaster.setFromCamera(this.aimNdc, this.camera);
    const ray = this.raycaster.ray;
    let best = AIM_DISTANCE;
    let lock = null;

    // Lasers converge on whatever is under the crosshair; touch gets a wide aim assist.
    const assist = this.isTouch ? 9 : 2;
    for (const e of this.enemies.list) {
      if (!e.active) continue;
      const along = this._v.subVectors(e.group.position, ray.origin).dot(ray.direction);
      if (along < 5 || along > 600) continue;
      const r = e.radius + assist + (this.isTouch ? along * 0.03 : 0);
      if (ray.distanceSqToPoint(e.group.position) < r * r && along < best + 50) {
        best = along;
        lock = e;
      }
    }
    for (const a of this.asteroids.list) {
      const along = this._v.subVectors(a.mesh.position, ray.origin).dot(ray.direction);
      if (along < 5 || along > best) continue;
      if (ray.distanceSqToPoint(a.mesh.position) < a.radius * a.radius) best = along - a.radius * 0.5;
    }
    const planetHit = ray.intersectSphere(new THREE.Sphere(ORIGIN, CONFIG.planet.radius), this._v2);
    if (planetHit) best = Math.min(best, ray.origin.distanceTo(planetHit));

    if (lock && this.isTouch) {
      // Lead the target a little so assisted shots actually connect.
      const d = this.ship.group.position.distanceTo(lock.group.position);
      const fwd = this._v.set(0, 0, -1).applyQuaternion(lock.group.quaternion);
      this.aimPoint.copy(lock.group.position).addScaledVector(fwd, lock.speed * (d / CONFIG.laser.speed));
    } else {
      ray.at(Math.max(best, 15), this.aimPoint);
    }
  }

  _handleFiring(dt) {
    this.fireTimer -= dt;
    if (!this.input.fire || this.fireTimer > 0) return;
    this.fireTimer = CONFIG.laser.fireInterval;
    const muzzle = this.ship.nextMuzzle(this._v2);
    this.lasers.fire(muzzle, this.aimPoint, CONFIG.laser.damage);
    this.effects.sparks(muzzle, 3, new THREE.Color(1.5, 3, 6), 6, 0.5, 0.08);
    this.audio.laser();
  }

  _collisions() {
    const R = CONFIG.planet.radius;
    const shipPos = this.ship.group.position;
    const hot = new THREE.Color(3, 2.2, 1.2);

    // Player lasers vs enemies, asteroids and the planet.
    for (const l of this.lasers.list) {
      if (!l.active) continue;
      let hitSomething = false;
      for (const e of this.enemies.list) {
        if (!e.active) continue;
        const hit = segmentHitsSphere(l.prev, l.mesh.position, e.group.position, e.radius);
        if (!hit) continue;
        this.effects.sparks(hit, 10, hot, 22, 0.5, 0.3);
        this._hitSound();
        if (this.enemies.damage(e, l.damage)) this._onEnemyDestroyed(e);
        hitSomething = true;
        break;
      }
      if (!hitSomething) {
        for (const a of this.asteroids.list) {
          const hit = segmentHitsSphere(l.prev, l.mesh.position, a.mesh.position, a.radius * 0.95);
          if (!hit) continue;
          this.effects.sparks(hit, 8, hot, 18, 0.5, 0.3);
          this._hitSound();
          const destroyed = this.asteroids.damage(a, l.damage);
          if (destroyed) this._onAsteroidDestroyed(destroyed);
          hitSomething = true;
          break;
        }
      }
      if (!hitSomething && l.mesh.position.lengthSq() < R * R) {
        this.effects.sparks(l.mesh.position, 4, hot, 8, 0.4, 0.2);
        hitSomething = true;
      }
      if (hitSomething) this.lasers.kill(l);
    }

    // Enemy lasers vs the player and the planet.
    for (const l of this.enemyLasers.list) {
      if (!l.active) continue;
      if (this.ship.alive && segmentHitsSphere(l.prev, l.mesh.position, shipPos, this.ship.radius + 0.4)) {
        this.enemyLasers.kill(l);
        this._damageShip(l.damage, l.mesh.position);
        continue;
      }
      if (l.mesh.position.lengthSq() < R * R) {
        this.enemyLasers.kill(l);
        this._damagePlanet(l.planetDamage ?? 0.1, l.mesh.position);
        continue;
      }
      for (const a of this.asteroids.list) {
        if (l.mesh.position.distanceToSquared(a.mesh.position) < a.radius * a.radius) {
          this.enemyLasers.kill(l);
          this.effects.sparks(l.mesh.position, 5, new THREE.Color(4, 1.2, 0.4), 10, 0.4, 0.2);
          break;
        }
      }
    }

    if (!this.ship.alive || this.state !== 'playing') return;

    // Ship vs asteroids.
    for (const a of this.asteroids.list) {
      const r = a.radius * 0.85 + this.ship.radius;
      if (a.mesh.position.distanceToSquared(shipPos) > r * r) continue;
      const destroyed = this.asteroids.damage(a, 1e6);
      if (destroyed) this._onAsteroidDestroyed(destroyed);
      this._damageShip(8 + a.radius * 2.2, shipPos, true);
      break;
    }

    // Ship vs enemy ships (ramming hurts both).
    for (const e of this.enemies.list) {
      if (!e.active) continue;
      const r = e.radius + this.ship.radius;
      if (e.group.position.distanceToSquared(shipPos) > r * r) continue;
      this.enemies.damage(e, 1e6);
      this._onEnemyDestroyed(e);
      this._damageShip(20, shipPos, true);
      break;
    }

    // Ship vs planet surface: bounce off.
    const d = shipPos.length();
    if (d < R + 4) {
      const n = this._v.copy(shipPos).normalize();
      shipPos.copy(n).multiplyScalar(R + 4);
      this._m.lookAt(shipPos, this._v2.copy(shipPos).addScaledVector(n, 10), this.ship.forward.clone());
      this._q.setFromRotationMatrix(this._m);
      this.ship.group.quaternion.rotateTowards(this._q, 0.6);
      this._damageShip(15, shipPos, true);
    }
  }

  _hitSound() {
    if (this.hitSoundCooldown > 0) return;
    this.audio.hit();
    this.hitSoundCooldown = 0.06;
  }

  _damageShip(amount, at, impact = false) {
    if (this.ship.invulnerable > 0) return;
    const dead = this.ship.takeDamage(amount);
    if (impact) {
      this.ship.invulnerable = 0.6;
      this.audio.explosion(0.8);
      this.effects.shake = Math.max(this.effects.shake, 0.8);
    } else {
      this.effects.shake = Math.max(this.effects.shake, 0.35);
    }
    this.effects.sparks(at, 8, new THREE.Color(4, 1.2, 0.4), 14, 0.5, 0.3);
    this.audio.damage();
    this.hud.damageFlash();
    if (dead) this._onShipDestroyed();
  }

  _damagePlanet(amount, at) {
    if (this.state !== 'playing') return;
    this.planetHp = Math.max(0, this.planetHp - amount);
    this.planet.flash();
    this.effects.sparks(at, amount > 0.5 ? 26 : 8, new THREE.Color(4, 1.4, 0.4), amount > 0.5 ? 26 : 10, 0.9, 0.6);
    if (amount > 0.5) this.effects.ring(at, 8, 0.4);
    if (this.planetHp <= 0) this._onPlanetDestroyed();
  }

  _onEnemyDestroyed(e) {
    const cfg = CONFIG.enemies[e.type];
    const p = e.group.position;
    this.effects.explosion(p, e.radius * 1.3, 0);
    this.audio.explosion(e.type === 'bomber' ? 1.5 : 1);
    this.score += cfg.score * this.waves.level;
    this.pickups.spawnCoins(p, cfg.coins, 1);
    if (e.type === 'bomber') this.pickups.spawnCoins(p, 1, 5);
  }

  _onAsteroidDestroyed({ position, radius }) {
    this.effects.explosion(position, radius, 0);
    this.audio.explosion(Math.min(0.5 + radius / 8, 1.6));
    this.score += Math.round(radius * 8);
    this.pickups.spawnCoins(position, Math.ceil(radius / 4), 1);
  }

  _onShipDestroyed() {
    const p = this.ship.group.position.clone();
    this.effects.explosion(p, 6, 0);
    this.effects.explosion(p, 3, 0);
    this.audio.explosion(2);
    this.ship.group.visible = false;
    this.respawnTimer = CONFIG.ship.respawnTime;
    this.coins = Math.floor(this.coins * 0.9); // small penalty
  }

  _onPlanetDestroyed() {
    this.state = 'over';
    this.effects.shake = 1;
    this.audio.explosion(2.5);
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Vector3().randomDirection().multiplyScalar(CONFIG.planet.radius);
      setTimeout(() => this.effects.explosion(p, 14, 0), i * 220);
    }
    this.hud.banner('HOMEWORLD LOST', '', { danger: true, duration: 2200 });
    setTimeout(() => {
      document.getElementById('final-level').textContent = this.waves.level;
      document.getElementById('final-wave').textContent = Math.max(this.waves.wave, 1);
      document.getElementById('final-score').textContent = this.score.toLocaleString('en-US');
      document.getElementById('final-coins').textContent = this.coins;
      document.getElementById('game-over').classList.remove('hidden');
    }, 2400);
  }

  _updateCamera(dt) {
    const cam = this.camera;
    const shipQ = this.ship.group.quaternion;
    this.camQuat.slerp(shipQ, 1 - Math.exp(-5 * dt));
    cam.quaternion.copy(this.camQuat).multiply(CAM_TILT);
    cam.position.copy(CAM_OFFSET).applyQuaternion(this.camQuat).add(this.ship.group.position);

    const s = this.effects.shake;
    if (s > 0) {
      cam.position.x += (Math.random() - 0.5) * s * s * 1.6;
      cam.position.y += (Math.random() - 0.5) * s * s * 1.6;
    }

    const targetFov = this.ship.boosting ? this.baseFov + 10 : this.baseFov;
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, 1 - Math.exp(-5 * dt));
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }
}
