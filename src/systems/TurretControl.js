import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { TurretBadges } from '../ui/TurretBadges.js';
import { settings } from '../core/Settings.js';

const MAN_RANGE = 45; // how close the ship must be to take over a turret
const MANUAL_DAMAGE = 1.5;
const LOCK_TIME = 0.8;
const OVERCHARGE_TIME = 6;
const OVERCHARGE_COOLDOWN = 25;
const _v = new THREE.Vector3();

// Lets the player climb into any turret: first-person aiming, manual fire with a damage
// bonus, missile lock-on, and a planetary shield overcharge. The ship docks meanwhile.
export class TurretControl {
  constructor(game) {
    this.game = game;
    this.slot = null;
    this.yaw = 0;
    this.pitch = 0.3;
    this.cooldown = 0;
    this.lockTarget = null;
    this.lockProgress = 0;
    this.overchargeCooldown = 0;
    this.locked = false;
    this.drag = null;
    this.raycaster = new THREE.Raycaster();
    this.basis = { up: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3() };

    const $ = (id) => document.getElementById(id);
    this.ui = $('turret-ui');
    this.nameEl = $('turret-name');
    this.statusEl = $('turret-status');
    this.prompt = $('turret-prompt');
    this.manBtn = $('man-btn');
    this.crosshair = $('crosshair');
    $('turret-exit').addEventListener('click', () => this.exit());
    this.manBtn.addEventListener('click', () => this.tryEnterNearest());
    this._bindAim(game.canvas);
  }

  get active() {
    return !!this.slot;
  }

  nearestSlot() {
    const p = this.game.ship.group.position;
    let best = null;
    let bd = MAN_RANGE;
    for (const s of this.game.turrets.slots) {
      if (!s.turret) continue;
      const d = s.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  tryEnterNearest() {
    const slot = this.nearestSlot();
    if (slot && this.game.state === 'playing' && this.game.ship.alive) this.enter(slot);
  }

  enter(slot) {
    const g = this.game;
    this.slot = slot;
    slot.turret.manned = true;
    // The glowing rim and halo sit right under the gunner's eye: hide them while seated.
    slot.turret.model.rim.visible = false;
    slot.turret.model.halo.visible = false;
    // Gunner's-eye view: hide the head shell so the barrels are what you see.
    for (const o of slot.turret.model.shell) o.visible = false;
    g.state = 'turret';
    document.body.classList.add('turret-mode');
    this.ui.classList.remove('hidden');

    // Local frame: up = away from the planet, plus an arbitrary tangent basis.
    const { up, fwd, right } = this.basis;
    up.copy(slot.normal);
    fwd.set(0, 1, 0).cross(up);
    if (fwd.lengthSq() < 0.01) fwd.set(1, 0, 0).cross(up);
    fwd.normalize();
    right.crossVectors(fwd, up).normalize();

    // Start looking at the nearest threat (or out along the horizon).
    this.yaw = 0;
    this.pitch = 0.25;
    const target = g.targets.reduce((a, b) => (!a || b.group.position.distanceTo(slot.pos) < a.group.position.distanceTo(slot.pos) ? b : a), null);
    if (target) {
      const d = _v.subVectors(target.group.position, slot.pos).normalize();
      this.yaw = Math.atan2(d.dot(right), d.dot(fwd));
      this.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(d.dot(up), -1, 1)), -0.9, 1.45);
    }

    // Dock the ship beside the platform.
    g.ship.group.position.copy(slot.pos).addScaledVector(up, 24).addScaledVector(fwd, -16);
    g.ship.velocity.set(0, 0, 0);
    this.cooldown = 0;
    this.lockTarget = null;
    this.lockProgress = 0;
    g.audio.build();
    g.hud.banner(`${CONFIG.turrets.types[slot.turret.type].name.toUpperCase()} · MANUAL`, this._hint(slot.turret.type), { duration: 2600 });
  }

  _hint(type) {
    if (type === 'laser' || type === 'cannon') return 'Aim and fire · manual control deals +50% damage';
    if (type === 'missile') return 'Hold the crosshair on a target to lock, then fire a 4-missile salvo';
    return 'Fire to overcharge the planetary shield';
  }

  exit() {
    const g = this.game;
    const slot = this.slot;
    if (!slot) return;
    if (slot.turret) {
      slot.turret.manned = false;
      slot.turret.model.rim.visible = true;
      for (const o of slot.turret.model.shell) o.visible = true;
      slot.turret.model.halo.visible = !(slot.turret.disabled > 0);
    }
    this.slot = null;
    this.drag = null;
    if (document.pointerLockElement) document.exitPointerLock?.();
    document.body.classList.remove('turret-mode');
    this.ui.classList.add('hidden');
    this.crosshair.classList.remove('locking', 'locked');
    g.input.mouseDown = false;
    g.input.mouseActive = false;
    if (g.state === 'turret') {
      g.state = 'playing';
      // Undock: point the ship away from the planet.
      const ship = g.ship.group;
      ship.position.copy(slot.pos).addScaledVector(slot.normal, 16);
      ship.lookAt(_v.copy(ship.position).addScaledVector(slot.normal, -10));
      g.ship.invulnerable = 1.5;
      g.camQuat.copy(ship.quaternion);
    }
  }

  _bindAim(canvas) {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.active && this.locked) this._look(e.movementX, e.movementY, 0.0022);
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (e.pointerType === 'mouse' && !this.locked) canvas.requestPointerLock?.()?.catch?.(() => {});
      if (!this.locked) this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!this.active || !d || d.id !== e.pointerId || this.locked) return;
      this._look(e.clientX - d.x, e.clientY - d.y, e.pointerType === 'touch' ? 0.006 : 0.004);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    window.addEventListener('pointerup', (e) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    });
  }

  _look(dx, dy, sens) {
    sens *= settings.sensitivity;
    this.yaw += dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -0.9, 1.45);
  }

  // Aim direction in world space.
  aimDir(out) {
    const { up, fwd, right } = this.basis;
    const c = Math.cos(this.pitch);
    return out
      .copy(fwd)
      .multiplyScalar(Math.cos(this.yaw) * c)
      .addScaledVector(right, Math.sin(this.yaw) * c)
      .addScaledVector(up, Math.sin(this.pitch))
      .normalize();
  }

  update(dt) {
    const g = this.game;
    const slot = this.slot;
    if (!slot.turret) {
      this.exit();
      return;
    }
    const t = slot.turret;
    const stats = g.turrets.statsFor(t.type, t.level);
    const dir = this.aimDir(new THREE.Vector3());
    const scale = t.model.root.scale.x;

    // Head follows the aim; the camera is the gunner's eye, just above the barrels.
    t.model.head.lookAt(_v.copy(slot.pos).addScaledVector(dir, 200));
    const cam = g.camera;
    cam.position.copy(slot.pos).addScaledVector(slot.normal, t.model.eye * scale + 1.5).addScaledVector(dir, -0.6);
    cam.up.copy(slot.normal);
    cam.lookAt(_v.copy(cam.position).add(dir));
    const s = g.effects.shake;
    if (s > 0) cam.position.addScaledVector(slot.normal, (Math.random() - 0.5) * s * s);
    cam.updateMatrixWorld();
    g.hud.setCrosshair(0, 0);

    // Keep the docked ship safe and out of the way.
    g.ship.invulnerable = Math.max(g.ship.invulnerable, 0.5);

    this.cooldown -= dt;
    this.overchargeCooldown -= dt;
    const offline = t.disabled > 0;
    const aim = this._aimPoint(dir, stats.range * (t.type === 'missile' ? 2 : 1.6));
    let status = '';

    if (offline) {
      status = `OFFLINE · EMP · rebooting ${Math.ceil(t.disabled)}s`;
    } else if (t.type === 'laser' || t.type === 'cannon') {
      const heavy = t.type === 'cannon';
      const interval = stats.interval * (heavy ? 0.75 : 0.6);
      status = heavy && this.cooldown > 0
        ? `RECHARGING ${this.cooldown.toFixed(1)}s`
        : `MANUAL FIRE · +50% damage · ${(1 / interval).toFixed(1)} shots/s`;
      if (g.input.fire && this.cooldown <= 0) {
        this.cooldown = interval;
        const muzzle = t.model.muzzles[t.gunIndex].getWorldPosition(new THREE.Vector3());
        t.gunIndex = (t.gunIndex + 1) % t.model.muzzles.length;
        (heavy ? g.heavyLasers : g.turretLasers).fire(muzzle, aim.point, stats.damage * MANUAL_DAMAGE);
        if (heavy) g.audio.explosion?.(0.4);
        else g.audio.laser(0.5);
      }
    } else if (t.type === 'missile') {
      // Lock on to whatever stays under the crosshair. The lock is sticky: it holds while the
      // current target stays near the crosshair, even if another ship crosses in front.
      const keep = this.lockTarget && this.lockTarget.active && this._underCrosshair(this.lockTarget, dir, 2.2);
      if (keep) this.lockProgress += dt;
      else {
        this.lockTarget = aim.target;
        this.lockProgress = 0;
      }
      const lockedOn = this.lockTarget && this.lockProgress >= LOCK_TIME;
      this.crosshair.classList.toggle('locking', !!this.lockTarget && !lockedOn);
      this.crosshair.classList.toggle('locked', !!lockedOn);
      if (this.cooldown > 0) status = `RELOADING ${this.cooldown.toFixed(1)}s`;
      else if (lockedOn) status = 'LOCKED · FIRE!';
      else if (this.lockTarget) status = `LOCKING ${Math.round((this.lockProgress / LOCK_TIME) * 100)}%`;
      else status = 'Hold the crosshair on a target to lock';
      if (g.input.fire && lockedOn && this.cooldown <= 0) {
        this.cooldown = stats.interval;
        for (const m of t.model.muzzles) {
          const from = m.getWorldPosition(new THREE.Vector3());
          g.missiles.fire(from, dir, this.lockTarget, stats.damage * MANUAL_DAMAGE, stats.splash);
        }
        g.audio.dash(0.8);
      }
    } else {
      const active = g.overcharge > 0;
      if (active) status = `OVERCHARGE ACTIVE · ${Math.ceil(g.overcharge)}s`;
      else if (this.overchargeCooldown > 0) status = `Recharging ${Math.ceil(this.overchargeCooldown)}s`;
      else status = 'Fire to OVERCHARGE the planetary shield (+50% for 6s)';
      if (g.input.fire && !active && this.overchargeCooldown <= 0) {
        g.overcharge = OVERCHARGE_TIME;
        this.overchargeCooldown = OVERCHARGE_COOLDOWN;
        g.planet.flash(true, slot.pos.clone().setLength(CONFIG.planet.radius * 1.2));
        g.audio.build();
        g.hud.banner('SHIELD OVERCHARGED', 'The homeworld takes far less damage for 6 seconds');
      }
    }

    const name = `${CONFIG.turrets.types[t.type].name} <span class="rank">${TurretBadges.chevrons(t.level)} Lv ${t.level}</span>`;
    if (this._lastName !== name) this.nameEl.innerHTML = this._lastName = name;
    if (this._lastStatus !== status) this.statusEl.textContent = this._lastStatus = status;
  }

  _underCrosshair(target, dir, slack) {
    const origin = this.game.camera.position;
    const to = _v.subVectors(target.group.position, origin);
    const along = to.dot(dir);
    if (along < 5) return false;
    const r = (target.radius + (this.game.isTouch ? 6 : 2.5) + along * 0.01) * slack;
    return to.lengthSq() - along * along < r * r;
  }

  // Ray from the crosshair: the first target under it (with a little assist), else a far point.
  _aimPoint(dir, maxRange) {
    const g = this.game;
    const origin = g.camera.position;
    const assist = g.isTouch ? 6 : 2.5;
    let best = null;
    let bestAlong = maxRange;
    for (const e of g.targets) {
      if (!e.active) continue;
      const to = _v.subVectors(e.group.position, origin);
      const along = to.dot(dir);
      if (along < 5 || along > bestAlong) continue;
      const perpSq = to.lengthSq() - along * along;
      const r = e.radius + assist + along * 0.01;
      if (perpSq < r * r) {
        best = e;
        bestAlong = along;
      }
    }
    const point = best ? best.group.position.clone() : origin.clone().addScaledVector(dir, maxRange);
    return { target: best, point };
  }

  // Proximity prompt while flying.
  updatePrompt() {
    const g = this.game;
    const slot = g.state === 'playing' && g.ship.alive ? this.nearestSlot() : null;
    const text = slot ? `<kbd>${g.isTouch ? 'MAN' : 'F'}</kbd> Take control: ${CONFIG.turrets.types[slot.turret.type].name}` : '';
    if (this._lastPrompt !== text) {
      this._lastPrompt = text;
      this.prompt.innerHTML = text;
      this.manBtn.classList.toggle('hidden', !slot);
    }
  }
}
