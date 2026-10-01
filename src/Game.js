import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { CONFIG } from './config.js';
import { Input } from './core/Input.js';
import { Sky, SUN_DIR } from './world/Sky.js';
import { Asteroids } from './world/Asteroids.js';
import { SpaceDust } from './world/SpaceDust.js';
import { Ship } from './entities/Ship.js';
import { Lasers, segmentHitsSphere } from './systems/Lasers.js';
import { Effects } from './systems/Effects.js';
import { Pickups } from './systems/Pickups.js';
import { Hud } from './ui/Hud.js';

const AIM_DISTANCE = 300;

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
    this.scene.fog = new THREE.FogExp2(0x061426, 0.0013);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);
    this.camera.position.set(0, 5.6, 19);
    this.baseFov = 62;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.scene.add(new THREE.HemisphereLight(0x3d6c9e, 0x05070c, 0.6));
    const sun = new THREE.DirectionalLight(0xd5e9ff, 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fb4e0, 0.8);
    fill.position.set(0, 40, 35);
    this.scene.add(fill);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.45, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.sky = new Sky(this.scene);
    this.asteroids = new Asteroids(this.scene);
    this.dust = new SpaceDust(this.scene);
    this.ship = new Ship(this.scene);
    this.lasers = new Lasers(this.scene);
    this.effects = new Effects(this.scene);
    this.effects.onResize(this.pixelRatio);
    this.pickups = new Pickups(this.scene, assets.coin);
    this.hud = new Hud();

    this.state = 'menu';
    this.score = 0;
    this.coins = 0;
    this.planetHp = 100;
    this.time = 0;
    this.fireTimer = 0;
    this.hitSoundCooldown = 0;

    this.aimPoint = new THREE.Vector3(0, 0, -AIM_DISTANCE);
    this.raycaster = new THREE.Raycaster();
    this.lookTarget = new THREE.Vector3(0, 2, -40);
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();

    window.addEventListener('resize', () => this.onResize());
    document.getElementById('restart-btn').addEventListener('click', () => this.restart());

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    window.__game = this; // handy for debugging from the console
    this.renderer.setAnimationLoop(() => this.frame());
  }

  start() {
    this.state = 'playing';
    this.hud.show(true);
    document.getElementById('touch-controls').classList.toggle('hidden', !this.isTouch);
    this.restart();
  }

  restart() {
    document.getElementById('game-over').classList.add('hidden');
    this.ship.reset();
    this.pickups.clear();
    this.score = 0;
    this.coins = 0;
    this.planetHp = 100;
    this.state = 'playing';
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
    const flow = CONFIG.flowSpeed;
    const playing = this.state === 'playing';
    this.input.update();

    // Attract mode: gentle autopilot behind the preloader.
    const move = playing
      ? this.input.move
      : { x: Math.sin(this.time * 0.4) * 0.3, y: Math.sin(this.time * 0.27) * 0.2 };

    this._updateAim(playing);

    if (playing && this.input.consumeDash() && this.ship.tryDash(move)) {
      this.audio.dash();
    }
    if (this.ship.alive) this.ship.update(dt, move, this.aimPoint, this.time);

    if (playing) this._handleFiring(dt);

    this.lasers.update(dt);
    this.asteroids.update(dt, flow);
    this._collisions();

    const collected = this.pickups.update(dt, flow, this.ship.group.position, this.time);
    if (collected > 0 && playing) {
      this.coins += collected;
      this.audio.coin();
    }

    this.effects.update(dt, flow, this.camera);
    this.dust.update(dt, flow, this.ship.group.position);
    this._updateCamera(dt);
    this.sky.update(this.camera, this.time);

    if (playing) this.hud.update(this);
    this.hitSoundCooldown -= dt;
  }

  _updateAim(playing) {
    const aim = playing ? this.input.aim : { x: 0, y: 0.15 };
    this.hud.setCrosshair(aim.x, aim.y);
    this.raycaster.setFromCamera(aim, this.camera);
    const ray = this.raycaster.ray;

    // Converge lasers on whatever is under the crosshair; touch gets a generous aim assist.
    const assist = this.isTouch ? 6 : 1.5;
    let best = AIM_DISTANCE;
    let target = null;
    for (const a of this.asteroids.list) {
      if (!a.active) continue;
      const c = a.mesh.position;
      const along = this._v.subVectors(c, ray.origin).dot(ray.direction);
      if (along < 10 || along > 700) continue;
      const distSq = ray.distanceSqToPoint(c);
      const r = a.radius + assist;
      if (distSq < r * r && along < best + 200) {
        if (!target || along < best) {
          best = along;
          target = a;
        }
      }
    }
    if (target && this.isTouch) {
      this.aimPoint.copy(target.mesh.position);
    } else if (target) {
      ray.at(Math.max(best - target.radius * 0.5, 20), this.aimPoint);
    } else {
      ray.at(AIM_DISTANCE, this.aimPoint);
    }
  }

  _handleFiring(dt) {
    this.fireTimer -= dt;
    if (!this.ship.alive || !this.input.fire || this.fireTimer > 0) return;
    this.fireTimer = CONFIG.laser.fireInterval;
    const muzzle = this.ship.nextMuzzle(this._v2);
    this.lasers.fire(muzzle, this.aimPoint);
    this.effects.sparks(muzzle, 3, new THREE.Color(1.5, 3, 6), 6, 0.5, 0.08);
    this.audio.laser();
  }

  _collisions() {
    const asteroids = this.asteroids.list;

    // Lasers vs asteroids.
    for (const l of this.lasers.list) {
      if (!l.active) continue;
      for (const a of asteroids) {
        if (!a.active) continue;
        const hit = segmentHitsSphere(l.prev, l.mesh.position, a.mesh.position, a.radius * 0.95);
        if (!hit) continue;
        this.lasers.kill(l);
        this.effects.sparks(hit, 10, new THREE.Color(3, 2.2, 1.2), 22, 0.5, 0.3);
        if (this.hitSoundCooldown <= 0) {
          this.audio.hit();
          this.hitSoundCooldown = 0.06;
        }
        const destroyed = this.asteroids.damage(a, l.damage);
        if (destroyed) this._onAsteroidDestroyed(destroyed);
        break;
      }
    }

    // Ship vs asteroids.
    if (!this.ship.alive || this.state !== 'playing') return;
    const sp = this.ship.group.position;
    for (const a of asteroids) {
      if (!a.active) continue;
      const r = a.radius * 0.85 + this.ship.radius;
      if (a.mesh.position.distanceToSquared(sp) > r * r) continue;
      if (this.ship.invulnerable > 0) continue;
      const dead = this.ship.takeDamage(8 + a.radius * 2.4);
      const destroyed = this.asteroids.damage(a, 1e6);
      if (destroyed) this.effects.explosion(destroyed.position, destroyed.radius, CONFIG.flowSpeed);
      this.audio.damage();
      this.audio.explosion(0.8);
      this.hud.damageFlash();
      this.effects.shake = Math.max(this.effects.shake, 0.8);
      if (dead) this._onShipDestroyed();
      break;
    }
  }

  _onAsteroidDestroyed({ position, radius }) {
    this.effects.explosion(position, radius, CONFIG.flowSpeed);
    this.audio.explosion(Math.min(0.5 + radius / 8, 1.6));
    this.score += Math.round(radius * 12);
    const coins = Math.ceil(radius / 3) + (Math.random() < 0.3 ? 1 : 0);
    // Big rocks occasionally drop a high-value coin.
    if (radius > 9 && Math.random() < 0.5) this.pickups.spawnCoins(position, 1, 5);
    this.pickups.spawnCoins(position, coins, 1);
  }

  _onShipDestroyed() {
    this.state = 'dead';
    const p = this.ship.group.position.clone();
    this.effects.explosion(p, 6, 0);
    this.effects.explosion(p, 3, 0);
    this.audio.explosion(2);
    this.ship.group.visible = false;
    this.hud.update(this);
    setTimeout(() => {
      document.getElementById('final-score').textContent = this.score.toLocaleString('en-US');
      document.getElementById('final-coins').textContent = this.coins;
      document.getElementById('game-over').classList.remove('hidden');
    }, 1600);
  }

  _updateCamera(dt) {
    const p = this.ship.group.position;
    const cam = this.camera;
    const k = 1 - Math.exp(-6 * dt);
    this._v.set(p.x * 0.75, p.y * 0.7 + 5.6, p.z + 19);
    cam.position.lerp(this._v, k);

    const aim = this.state === 'playing' ? this.input.aim : { x: 0, y: 0 };
    this._v.set(p.x * 0.85 + aim.x * 8, p.y * 0.8 + 1.2 + aim.y * 4, -40);
    this.lookTarget.lerp(this._v, k);
    cam.lookAt(this.lookTarget);

    const s = this.effects.shake;
    if (s > 0) {
      cam.position.x += (Math.random() - 0.5) * s * s * 1.6;
      cam.position.y += (Math.random() - 0.5) * s * s * 1.6;
    }

    const targetFov = this.ship.dashTimer > 0 ? this.baseFov + 9 : this.baseFov;
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, 1 - Math.exp(-8 * dt));
      cam.updateProjectionMatrix();
    }
  }
}
