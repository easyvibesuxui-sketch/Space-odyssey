import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Lasers, segmentHitsSphere } from '../systems/Lasers.js';
import { Effects } from '../systems/Effects.js';
import { instantiate, setFlash } from '../core/Models.js';
import { buildSentry } from '../systems/TurretModels.js';
import { rand } from '../core/noise.js';
import { FRONT, BACK, HALF_W, HEIGHT } from './Hangar.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ray = new THREE.Ray();
const INVADER_R = 0.75; // hit sphere radius, centred 1.2 m above the feet

// Ground combat inside the home base. Started when an enemy dropship lands on the homeworld:
// robot troopers drop in through the open hangar mouth and fight the player (on foot or in a
// mech), the companion and the base sentries. While any of them live, the homeworld drains.
export class GroundWar {
  constructor(game) {
    this.game = game;
    this.hangar = game.hangar;
    this.scene = this.hangar.scene;
    this.active = false;
    this.secured = false; // true after a won fight, until the player returns to orbit
    this.invaders = [];
    this.pending = 0;
    this.kills = 0;
    this.spawnTimer = 0;
    this.shells = [];
    this.pools = new Map();
    this.hostile = new Lasers(this.scene, { color: new THREE.Color(6, 0.9, 0.5), speed: 55, life: 2.4, pool: 140, thickness: 0.16, length: 1.5 });
    this.effects = new Effects(this.scene, 1500);
    this.effects.onResize(game.pixelRatio);
    this.player = { hp: CONFIG.war.player.hp, sinceHit: 99, dead: false, respawn: 0, cooldown: 0, gun: 0 };
    this.recoil = 0;

    this._buildViewmodel();
    this._buildSentries();
    this._buildLaunchers();
    this._buildAlarm();
    this._buildHud();
  }

  // ---------------------------------------------------------------- build

  _buildViewmodel() {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d2127, metalness: 0.4, roughness: 0.7 });
    const plate = new THREE.MeshStandardMaterial({ color: 0x3c444f, metalness: 0.4, roughness: 0.65 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.8, 1.3) });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.38), plate);
    g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.3, 10), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.33);
    g.add(barrel);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.07), dark);
    grip.position.set(0, -0.11, 0.1);
    grip.rotation.x = 0.3;
    g.add(grip);
    for (const z of [-0.05, 0.08]) {
      const coil = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.012, 0.02), glow);
      coil.position.set(0, 0.06, z);
      g.add(coil);
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), glow);
    tip.position.set(0, 0.02, -0.49);
    g.add(tip);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.02, -0.52);
    g.add(this.muzzle);
    g.scale.setScalar(0.55);
    g.position.set(0.17, -0.15, -0.36);
    g.visible = false;
    this.hangar.camera.add(g);
    this.viewmodel = g;
  }

  _buildSentries() {
    const pack = this.game.assets.models?.sentries;
    const padMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.6, roughness: 0.5 });
    this.sentries = CONFIG.war.sentries.slots.map(([x, z], i) => {
      const root = new THREE.Group();
      root.position.set(x, 0, z);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.5, 8), padMat);
      pad.position.y = 0.25;
      root.add(pad);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 6, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.2, 0.3) }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.52;
      root.add(ring);
      this.scene.add(root);
      this.hangar.obstacles.push({ c: root.position, r: 1.8 });
      return { index: i, root, level: 0, model: null, cooldown: 0, gun: 0, pack };
    });
  }

  setSentryLevel(s, level) {
    s.level = level;
    if (s.model) s.root.remove(s.model.root);
    s.model = level > 0 ? buildSentry(s.pack, level) : null;
    if (!s.model && level > 0) {
      // Placeholder if the pack failed to load.
      const head = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 1.4), new THREE.MeshStandardMaterial({ color: 0x6b7d5c }));
      head.add(box);
      const muzzle = new THREE.Object3D();
      muzzle.position.z = 0.9;
      head.add(muzzle);
      const root = new THREE.Group();
      head.position.y = 0.8;
      root.add(head);
      s.model = { root, head, muzzles: [muzzle] };
    }
    if (s.model) {
      s.model.root.position.y = 0.5;
      s.model.root.scale.setScalar(1.35 + level * 0.12);
      s.root.add(s.model.root);
    }
  }

  _buildLaunchers() {
    const model = this.game.assets.models?.launcher;
    if (!model) return;
    // Two heavy launchers guarding the hangar mouth (scenery).
    for (const s of [-1, 1]) {
      const { root } = instantiate(model);
      root.position.set(s * (HALF_W - 3.5), 0, FRONT + 4.5);
      root.rotation.y = Math.PI + s * 0.35;
      this.scene.add(root);
      this.hangar.obstacles.push({ c: root.position, r: 2.6 });
    }
  }

  _buildAlarm() {
    this.alarmLights = [];
    for (const [x, z] of [[-HALF_W + 2, -6], [HALF_W - 2, -6], [0, BACK - 2]]) {
      const l = new THREE.PointLight(0xff2a1a, 0, 40, 2);
      l.position.set(x, HEIGHT - 3, z);
      this.scene.add(l);
      this.alarmLights.push(l);
    }
  }

  _buildHud() {
    const root = document.getElementById('base-ui');
    const hud = document.createElement('div');
    hud.id = 'war-hud';
    hud.className = 'hidden';
    hud.innerHTML = `
      <div class="war-status" id="war-status"></div>
      <div class="war-bars">
        <div class="war-bar"><label id="war-hp-label">YOU</label><div class="bar"><div class="bar-fill hull" id="war-hp"></div></div></div>
        <div class="war-bar" id="war-buddy"><label id="war-buddy-label">${CONFIG.war.companion.name}</label><div class="bar"><div class="bar-fill shield" id="war-buddy-hp"></div></div></div>
        <div class="war-bar"><label>PLANET</label><div class="bar"><div class="bar-fill planet" id="war-planet"></div></div></div>
      </div>`;
    root.appendChild(hud);
    const flash = document.createElement('div');
    flash.id = 'war-flash';
    root.appendChild(flash);
    const dead = document.createElement('div');
    dead.id = 'war-dead';
    dead.className = 'hidden';
    root.appendChild(dead);
    this.ui = {
      hud,
      flash,
      dead,
      status: hud.querySelector('#war-status'),
      hp: hud.querySelector('#war-hp'),
      hpLabel: hud.querySelector('#war-hp-label'),
      buddy: hud.querySelector('#war-buddy-hp'),
      buddyRow: hud.querySelector('#war-buddy'),
      buddyLabel: hud.querySelector('#war-buddy-label'),
      planet: hud.querySelector('#war-planet'),
    };
  }

  // ---------------------------------------------------------------- lifecycle

  start(troops) {
    this.clear();
    this.active = true;
    this.secured = false;
    this.pending = troops;
    this.total = troops;
    this.kills = 0;
    this.spawnTimer = 1.5;
    this.alarmTimer = 0;
    const p = this.player;
    p.hp = CONFIG.war.player.hp;
    p.dead = false;
    p.sinceHit = 99;
    document.body.classList.add('war-mode');
    this.ui.hud.classList.remove('hidden');
  }

  // Remove every invader/projectile (used when leaving the base).
  clear() {
    for (const inv of this.invaders) this.scene.remove(inv.root);
    this.invaders.length = 0;
    for (const s of this.shells) this.scene.remove(s.mesh);
    this.shells.length = 0;
    this.hostile.clear();
    for (const pool of this.pools.values()) pool.clear();
    this.pending = 0;
    this.active = false;
    for (const l of this.alarmLights) l.intensity = 0;
    document.body.classList.remove('war-mode');
    this.ui.hud.classList.add('hidden');
    this.ui.dead.classList.add('hidden');
    this.viewmodel.visible = false;
  }

  _secure() {
    const g = this.game;
    this.active = false;
    this.secured = true;
    for (const l of this.alarmLights) l.intensity = 0;
    document.body.classList.remove('war-mode');
    this.ui.hud.classList.add('hidden');
    this.viewmodel.visible = false;
    const bonus = 40 * g.waves.level + this.kills * 4;
    g.coins += bonus;
    g.audio.coin();
    g.baseUI.toast(`BASE SECURED · +${bonus} coins · walk to your ship to return to orbit`);
    g.baseUI.refresh();
    g.companion?.onWarEnd();
  }

  get aliveCount() {
    return this.invaders.filter((i) => i.alive).length;
  }

  // ---------------------------------------------------------------- spawning

  _spawnInvader() {
    const g = this.game;
    const model = g.assets.models?.trooper;
    let root;
    let materials = [];
    if (model) {
      const inst = instantiate(model, { ownMaterials: true });
      root = new THREE.Group();
      root.add(inst.root);
      materials = inst.materials;
    } else {
      root = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a7a62, emissive: 0x000000 });
      mat.userData.baseEmissive = new THREE.Color();
      materials = [mat];
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.2, 4, 8), mat);
      body.position.y = 1.1;
      root.add(body);
    }
    const x = rand(-HALF_W + 5, HALF_W - 5);
    root.position.set(x, 9, FRONT + 2.6);
    root.rotation.y = 0;
    this.scene.add(root);
    const lvl = g.waves.level;
    const cfg = CONFIG.war.invader;
    const inv = {
      root,
      materials,
      alive: true,
      hp: cfg.hp * (1 + 0.15 * (lvl - 1)),
      maxHp: 0,
      dropping: true,
      fireTimer: rand(1, 2),
      strafe: Math.random() < 0.5 ? -1 : 1,
      strafeTimer: rand(1, 3),
      flash: 0,
      phase: Math.random() * 10,
      target: null,
    };
    inv.maxHp = inv.hp;
    this.invaders.push(inv);
    // Drop-pod streak.
    this.effects.sparks(_v.set(x, 9, FRONT + 2.6), 20, new THREE.Color(4, 1.2, 0.4), 6, 0.6, 0.5);
  }

  // ---------------------------------------------------------------- shooting helpers

  // A bolt pool per colour/size (Lasers share one material per pool).
  _pool(color, size, speed) {
    const key = `${color.join(',')}|${size}|${speed}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = new Lasers(this.scene, { color: new THREE.Color(...color), speed, life: 1.4, pool: 90, thickness: size * 0.6, length: size * 7 });
      this.pools.set(key, pool);
    }
    return pool;
  }

  fireFriendly(from, to, damage, style = {}) {
    const pool = this._pool(style.color ?? [1, 3, 5], style.size ?? 0.18, style.speed ?? 160);
    const l = pool.fire(from, to, damage);
    l.splash = style.splash ?? 0;
    return l;
  }

  // Arcing artillery shell that lands on `to`.
  fireShell(from, to, damage, splash, style = {}) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(style.size ?? 0.45, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(...(style.color ?? [5, 1.2, 0.8])) }));
    mesh.position.copy(from);
    this.scene.add(mesh);
    const flat = Math.hypot(to.x - from.x, to.z - from.z);
    const t = THREE.MathUtils.clamp(flat / (style.speed ?? 34), 0.5, 2.2);
    const gravity = 22;
    const vel = new THREE.Vector3((to.x - from.x) / t, (to.y - from.y) / t + 0.5 * gravity * t, (to.z - from.z) / t);
    this.shells.push({ mesh, vel, gravity, damage, splash, life: t + 1 });
  }

  // Where the screen centre points: the first invader on the ray, else far along it.
  aimPoint(camera, out = new THREE.Vector3()) {
    _ray.origin.copy(camera.getWorldPosition(_v));
    camera.getWorldDirection(_ray.direction);
    let best = 90;
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      _v2.copy(inv.root.position);
      _v2.y += 1.2;
      const d = _ray.origin.distanceTo(_v2);
      if (d > best) continue;
      if (_ray.distanceSqToPoint(_v2) < (INVADER_R + 0.35) ** 2) best = d;
    }
    return _ray.at(best, out);
  }

  _explode(p, radius, damage) {
    this.effects.explosion(p, radius * 0.5, 0);
    this.game.audio.explosion(0.7);
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      _v.copy(inv.root.position);
      _v.y += 1.2;
      const d = _v.distanceTo(p);
      if (d < radius) this._hitInvader(inv, damage * (1 - (d / radius) * 0.6), null);
    }
  }

  _hitInvader(inv, damage, at) {
    if (!inv.alive) return;
    inv.hp -= damage;
    inv.flash = 1;
    if (at) this.effects.sparks(at, 6, new THREE.Color(1.5, 3, 5), 8, 0.35, 0.25);
    if (inv.hp > 0) return;
    inv.alive = false;
    this.kills++;
    const p = _v.copy(inv.root.position);
    p.y += 1.1;
    this.effects.explosion(p, 1.6, 0);
    this.game.audio.explosion(0.8);
    const coins = CONFIG.war.invader.coins + this.game.waves.level;
    this.game.coins += coins;
    this.game.levelKills = (this.game.levelKills ?? 0) + 1;
    this.scene.remove(inv.root);
  }

  // Damage to whatever the invaders shoot at.
  _hitFriendly(t, damage) {
    const g = this.game;
    if (t.kind === 'player') {
      const p = this.player;
      p.hp -= damage;
      p.sinceHit = 0;
      this.ui.flash.classList.add('on');
      clearTimeout(this._flashT);
      this._flashT = setTimeout(() => this.ui.flash.classList.remove('on'), 90);
      g.audio.damage?.();
      if (p.hp <= 0) this._playerDown();
    } else if (t.kind === 'mech') {
      g.mechs.damagePiloted(damage);
    } else if (t.kind === 'companion') {
      g.companion.damage(damage);
    }
  }

  _playerDown() {
    const p = this.player;
    p.hp = 0;
    p.dead = true;
    p.respawn = CONFIG.war.player.respawn;
    this.ui.dead.classList.remove('hidden');
    this.game.audio.explosion(0.6);
  }

  // Everything the invaders may target right now.
  _friendlies() {
    const g = this.game;
    const list = [];
    const mech = g.mechs?.pilotedState;
    if (mech) {
      list.push({ kind: 'mech', pos: mech.pos, y: mech.size.y * 0.55, r: Math.max(mech.size.x, mech.size.z) * 0.3 });
    } else if (!this.player.dead) {
      list.push({ kind: 'player', pos: this.hangar.pos, y: 1.2, r: 0.55 });
    }
    if (g.companion?.alive) list.push({ kind: 'companion', pos: g.companion.pos, y: 1.1, r: 0.5 });
    return list;
  }

  // ---------------------------------------------------------------- update

  update(dt, input, canMove) {
    const g = this.game;
    const cfg = CONFIG.war;
    const camera = this.hangar.camera;
    const piloting = !!g.mechs?.piloting;

    if (this.active) {
      // Alarm lights and klaxon.
      const pulse = 0.5 + 0.5 * Math.sin(this.hangar.time * 5);
      for (const l of this.alarmLights) l.intensity = 30 + pulse * 120;
      this.alarmTimer -= dt;
      if (this.alarmTimer <= 0) {
        g.audio.alarm?.();
        this.alarmTimer = 6;
      }

      // Troopers keep dropping in until the boarding party is spent.
      this.spawnTimer -= dt;
      if (this.pending > 0 && this.spawnTimer <= 0 && this.aliveCount < cfg.maxActive) {
        this._spawnInvader();
        this.pending--;
        this.spawnTimer = rand(0.8, 1.8);
      }

      // Invaders sabotage the homeworld while they're in the base.
      const alive = this.aliveCount;
      if (alive > 0 && g.state === 'base') {
        g.planetHp = Math.max(0, g.planetHp - cfg.planetDrain * alive * dt);
        if (g.planetHp <= 0) {
          this.clear();
          g._onPlanetDestroyed();
          return;
        }
      }
      if (this.pending === 0 && alive === 0) this._secure();
    }

    this._updateInvaders(dt);
    this._updatePlayer(dt, input, canMove, piloting);
    this._updateSentries(dt);
    this._updateProjectiles(dt);
    this.effects.update(dt, 0, camera);
    this._updateHud(piloting);
    this.invaders = this.invaders.filter((i) => i.alive);
  }

  _updateInvaders(dt) {
    const cfg = CONFIG.war.invader;
    const friends = this._friendlies();
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const pos = inv.root.position;
      inv.phase += dt;
      if (inv.flash > 0) {
        inv.flash = Math.max(0, inv.flash - dt * 6);
        setFlash(inv.materials, inv.flash);
      }
      if (inv.dropping) {
        pos.y = Math.max(0, pos.y - dt * 16);
        if (pos.y === 0) {
          inv.dropping = false;
          this.effects.sparks(_v.copy(pos), 16, new THREE.Color(3, 2, 1), 7, 0.5, 0.4);
        }
        continue;
      }
      // Nearest friendly.
      let target = null;
      let best = Infinity;
      for (const f of friends) {
        const d = Math.hypot(f.pos.x - pos.x, f.pos.z - pos.z);
        if (d < best) {
          best = d;
          target = f;
        }
      }
      inv.target = target;
      let moving = false;
      if (target) {
        const dx = target.pos.x - pos.x;
        const dz = target.pos.z - pos.z;
        const yaw = Math.atan2(-dx, -dz);
        inv.root.rotation.y = rotateTowards(inv.root.rotation.y, yaw, 4 * dt);
        const dirX = dx / (best || 1);
        const dirZ = dz / (best || 1);
        let vx = 0;
        let vz = 0;
        if (best > 13) {
          vx = dirX;
          vz = dirZ;
        } else {
          // In range: strafe sideways, occasionally switching direction.
          inv.strafeTimer -= dt;
          if (inv.strafeTimer <= 0) {
            inv.strafe *= -1;
            inv.strafeTimer = rand(1.2, 3);
          }
          vx = -dirZ * inv.strafe * 0.6;
          vz = dirX * inv.strafe * 0.6;
          if (best < 6) {
            vx -= dirX * 0.6;
            vz -= dirZ * 0.6;
          }
        }
        pos.x += vx * cfg.speed * dt;
        pos.z += vz * cfg.speed * dt;
        moving = vx * vx + vz * vz > 0.01;

        inv.fireTimer -= dt;
        if (inv.fireTimer <= 0 && best < cfg.range) {
          inv.fireTimer = cfg.fireInterval * rand(0.8, 1.3);
          const from = _v.set(0.25, 1.35, -0.9).applyEuler(inv.root.rotation).add(pos);
          const aim = _v2.copy(target.pos);
          aim.y = target.y;
          aim.x += rand(-0.7, 0.7);
          aim.y += rand(-0.4, 0.5);
          aim.z += rand(-0.7, 0.7);
          const l = this.hostile.fire(from.clone(), aim.clone(), cfg.damage * (1 + 0.1 * (this.game.waves.level - 1)));
          l.splash = 0;
          this.game.audio.laser?.(0.12);
        }
      }
      // Procedural walk: bob, sway and a slight lean while moving.
      const bob = moving ? Math.abs(Math.sin(inv.phase * 7)) * 0.08 : 0;
      pos.y = bob;
      inv.root.rotation.z = moving ? Math.sin(inv.phase * 7) * 0.05 : 0;
      inv.root.rotation.x = moving ? -0.06 : 0;
      this.hangar.collide(pos, 0.5);
    }
  }

  _updatePlayer(dt, input, canMove, piloting) {
    const g = this.game;
    const p = this.player;
    const cfg = CONFIG.war.player;
    this.viewmodel.visible = this.active && !piloting && !p.dead;
    if (!this.active) return;

    if (p.dead) {
      p.respawn -= dt;
      if (p.respawn <= 0) {
        p.dead = false;
        p.hp = cfg.hp;
        this.hangar.pos.set(0, 1.7, BACK - 3);
        this.hangar.yaw = 0;
        this.ui.dead.classList.add('hidden');
      }
      return;
    }
    p.sinceHit += dt;
    if (p.sinceHit > cfg.regenDelay) p.hp = Math.min(cfg.hp, p.hp + cfg.regen * dt);
    if (piloting) return;

    // Blaster: damage scales with the ship's Laser Power upgrade.
    p.cooldown -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 8);
    this.viewmodel.position.set(0.17, -0.15 - this.recoil * 0.012, -0.36 + this.recoil * 0.03);
    if (canMove && input.fire && p.cooldown <= 0) {
      p.cooldown = cfg.interval;
      const from = this.muzzle.getWorldPosition(new THREE.Vector3());
      const to = this.aimPoint(this.hangar.camera);
      this.fireFriendly(from, to, cfg.damage * (1 + 0.1 * (g.upgrades.damage ?? 0)), { color: [1, 3, 5], size: 0.14, speed: 170 });
      this.recoil = 1;
      g.audio.laser(0.35);
    }
  }

  _updateSentries(dt) {
    const cfg = CONFIG.war.sentries;
    for (const s of this.sentries) {
      if (!s.model) continue;
      const head = s.model.head;
      let best = null;
      let bestD = cfg.range;
      for (const inv of this.invaders) {
        if (!inv.alive || inv.dropping) continue;
        const d = inv.root.position.distanceTo(s.root.position);
        if (d < bestD) {
          bestD = d;
          best = inv;
        }
      }
      s.cooldown -= dt;
      if (!best) {
        head.rotation.y += dt * 0.5;
        continue;
      }
      const tp = _v.copy(best.root.position);
      tp.y += 1.2;
      // Yaw only: atan2 in the sentry's local frame (barrels point +Z).
      const local = s.root.worldToLocal(tp.clone());
      head.rotation.y = rotateTowards(head.rotation.y, Math.atan2(local.x, local.z), 5 * dt);
      if (s.cooldown <= 0 && this.active) {
        s.cooldown = cfg.interval;
        const m = s.model.muzzles[s.gun % s.model.muzzles.length];
        s.gun++;
        const from = m.getWorldPosition(new THREE.Vector3());
        this.fireFriendly(from, tp.clone(), cfg.damage[s.level - 1], { color: [4, 2.6, 0.6], size: 0.16, speed: 150 });
        this.game.audio.laser(0.15);
      }
    }
  }

  _updateProjectiles(dt) {
    const inside = (p) => p.y > 0 && p.y < HEIGHT && Math.abs(p.x) < HALF_W && p.z > FRONT - 4 && p.z < BACK + 30;

    // Friendly bolts vs invaders.
    for (const pool of this.pools.values()) {
      pool.update(dt);
      for (const l of pool.list) {
        if (!l.active) continue;
        if (!inside(l.mesh.position)) {
          if (l.splash) this._explode(l.mesh.position, l.splash, l.damage);
          pool.kill(l);
          continue;
        }
        for (const inv of this.invaders) {
          if (!inv.alive) continue;
          _v.copy(inv.root.position);
          _v.y += 1.2;
          const hit = segmentHitsSphere(l.prev, l.mesh.position, _v, INVADER_R);
          if (!hit) continue;
          pool.kill(l);
          if (l.splash) this._explode(hit, l.splash, l.damage);
          else this._hitInvader(inv, l.damage, hit);
          break;
        }
      }
    }

    // Hostile bolts vs friendlies.
    this.hostile.update(dt);
    const friends = this._friendlies();
    for (const l of this.hostile.list) {
      if (!l.active) continue;
      if (!inside(l.mesh.position)) {
        this.effects.sparks(l.mesh.position, 4, new THREE.Color(4, 1, 0.4), 5, 0.3, 0.2);
        this.hostile.kill(l);
        continue;
      }
      for (const f of friends) {
        _v.set(f.pos.x, f.y, f.pos.z);
        const hit = segmentHitsSphere(l.prev, l.mesh.position, _v, f.r);
        if (!hit) continue;
        this.hostile.kill(l);
        this.effects.sparks(hit, 5, new THREE.Color(4, 1.2, 0.5), 6, 0.3, 0.2);
        this._hitFriendly(f, l.damage);
        break;
      }
    }

    // Artillery shells.
    for (const s of this.shells) {
      s.vel.y -= s.gravity * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.life -= dt;
      let boom = s.mesh.position.y <= 0.2 || s.life <= 0;
      for (const inv of this.invaders) {
        if (boom || !inv.alive) continue;
        _v.copy(inv.root.position);
        _v.y += 1.2;
        if (_v.distanceTo(s.mesh.position) < INVADER_R + 0.6) boom = true;
      }
      if (boom) {
        this._explode(s.mesh.position, s.splash, s.damage);
        this.scene.remove(s.mesh);
        s.dead = true;
      } else if (Math.random() < 0.6) {
        this.effects.emit(s.mesh.position, _v.set(0, 0, 0), new THREE.Color(2, 0.8, 0.4), 0.5, 0.35);
      }
    }
    this.shells = this.shells.filter((s) => !s.dead);
  }

  _updateHud(piloting) {
    const g = this.game;
    if (!this.active) return;
    const alive = this.aliveCount;
    const status = `⚠ BASE UNDER ATTACK · INVADERS ${alive + this.pending}`;
    if (this._status !== status) this.ui.status.textContent = this._status = status;
    const mech = g.mechs?.pilotedState;
    const label = mech ? mech.def.name.toUpperCase() : 'YOU';
    if (this._label !== label) this.ui.hpLabel.textContent = this._label = label;
    const hp = mech ? mech.hp / mech.maxHp : this.player.hp / CONFIG.war.player.hp;
    this.ui.hp.style.width = `${Math.max(0, hp) * 100}%`;
    const c = g.companion;
    this.ui.buddyRow.style.display = c ? '' : 'none';
    if (c) {
      this.ui.buddy.style.width = `${Math.max(0, c.hp / c.maxHp) * 100}%`;
      const bl = c.alive ? CONFIG.war.companion.name : `${CONFIG.war.companion.name} · DOWN`;
      if (this._bl !== bl) this.ui.buddyLabel.textContent = this._bl = bl;
    }
    this.ui.planet.style.width = `${(g.planetHp / CONFIG.planet.hp) * 100}%`;
    if (this.player.dead) this.ui.dead.textContent = `YOU WERE DOWNED · back in ${Math.ceil(this.player.respawn)}s`;
  }
}

export function rotateTowards(a, b, maxStep) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + THREE.MathUtils.clamp(d, -maxStep, maxStep);
}
