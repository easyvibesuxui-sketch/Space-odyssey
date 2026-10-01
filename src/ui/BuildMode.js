import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { TurretBadges } from './TurretBadges.js';

const BASE = import.meta.env.BASE_URL;
const COIN = `<img class="coin-icon" src="${BASE}assets/coin.png" alt="" />`;

// Tactical view: the game is paused, the camera orbits the planet, and the player
// builds / upgrades / sells turrets on the orbital slots.
export class BuildMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.selected = -1;
    this.sph = new THREE.Spherical(470, 1.15, 0);
    this.targetSph = this.sph.clone();
    this.raycaster = new THREE.Raycaster();
    this.pointer = null;

    this.ui = document.getElementById('build-ui');
    this.panel = document.getElementById('build-panel');
    document.getElementById('build-exit').addEventListener('click', () => this.exit());
    this.panel.addEventListener('click', (e) => this._onPanelClick(e));
    this._bindPointer(game.canvas);
  }

  enter() {
    if (this.active) return;
    this.active = true;
    // Look at the planet from the side the ship is on.
    const p = this.game.ship.group.position;
    this.targetSph.setFromVector3(p.lengthSq() > 1 ? p : new THREE.Vector3(0, 100, 400));
    this.targetSph.radius = 470;
    this.targetSph.phi = THREE.MathUtils.clamp(this.targetSph.phi, 0.35, Math.PI - 0.35);
    this.sph.copy(this.targetSph);
    this.sph.radius = 300;
    this.selected = -1;
    document.body.classList.add('build-mode');
    this.ui.classList.remove('hidden');
    this.game.turrets.showSlots(true, this.selected);
    this.render();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('build-mode');
    this.ui.classList.add('hidden');
    this.game.turrets.showSlots(false);
    this.game.onBuildExit();
  }

  update(dt, camera) {
    const k = 1 - Math.exp(-8 * dt);
    this.sph.radius += (this.targetSph.radius - this.sph.radius) * k;
    this.sph.phi += (this.targetSph.phi - this.sph.phi) * k;
    this.sph.theta += (this.targetSph.theta - this.sph.theta) * k;
    camera.position.setFromSpherical(this.sph);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    this.game.turrets.rangeMesh.quaternion.copy(camera.quaternion);
  }

  _bindPointer(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, dragged: false };
    });
    window.addEventListener('pointermove', (e) => {
      const p = this.pointer;
      if (!this.active || !p || p.id !== e.pointerId) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) p.dragged = true;
      if (p.dragged) {
        this.targetSph.theta -= dx * 0.008;
        this.targetSph.phi = THREE.MathUtils.clamp(this.targetSph.phi - dy * 0.008, 0.2, Math.PI - 0.2);
      }
    });
    window.addEventListener('pointerup', (e) => {
      const p = this.pointer;
      if (!this.active || !p || p.id !== e.pointerId) return;
      this.pointer = null;
      if (!p.dragged && e.target === canvas) this._pick(e.clientX, e.clientY);
    });
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.targetSph.radius = THREE.MathUtils.clamp(this.targetSph.radius + e.deltaY * 0.4, 260, 720);
    }, { passive: false });
  }

  _pick(x, y) {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.game.camera);
    const hits = this.raycaster.intersectObjects(this.game.turrets.hitTargets, false);
    // Ignore slots hidden behind the planet.
    const planetHit = this.raycaster.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), CONFIG.planet.radius), new THREE.Vector3());
    const planetDist = planetHit ? planetHit.distanceTo(this.raycaster.ray.origin) : Infinity;
    const hit = hits.find((h) => h.distance < planetDist);
    this.select(hit ? hit.object.userData.slotIndex : -1);
  }

  select(index) {
    this.selected = index;
    this.game.turrets.showSlots(true, index);
    this.render();
    if (index >= 0) {
      // Swing the camera round to face the chosen slot.
      const s = new THREE.Spherical().setFromVector3(this.game.turrets.slots[index].pos);
      // Take the short way round.
      let theta = s.theta;
      while (theta - this.sph.theta > Math.PI) theta -= Math.PI * 2;
      while (theta - this.sph.theta < -Math.PI) theta += Math.PI * 2;
      // Poles have no meaningful theta; keep the current one.
      if (Math.abs(this.game.turrets.slots[index].normal.y) < 0.99) this.targetSph.theta = theta;
      this.targetSph.phi = THREE.MathUtils.clamp(s.phi, 0.35, Math.PI - 0.35);
    }
  }

  _onPanelClick(e) {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const game = this.game;
    const slot = game.turrets.slots[this.selected];
    const action = btn.dataset.action;
    if (action === 'build') {
      const type = btn.dataset.type;
      const cost = CONFIG.turrets.types[type].cost;
      if (game.coins < cost || slot.turret) return;
      game.coins -= cost;
      game.turrets.build(slot, type);
      game.audio.build?.();
    } else if (action === 'upgrade') {
      const cost = game.turrets.upgradeCost(slot.turret);
      if (cost === null || game.coins < cost) return;
      game.coins -= cost;
      game.turrets.upgrade(slot);
      game.audio.build?.();
    } else if (action === 'control') {
      this.exit();
      game.turretControl.enter(slot);
      return;
    } else if (action === 'sell') {
      game.coins += game.turrets.sellValue(slot.turret);
      game.turrets.sell(slot);
      game.audio.coin();
    }
    game.planet.setShield(game.turrets.shieldReduction);
    game.turrets.showSlots(true, this.selected);
    game.hud.update(game);
    this.render();
  }

  render() {
    const game = this.game;
    const turrets = game.turrets;
    const shield = Math.round(turrets.shieldReduction * 100);
    const summary = `<div class="build-summary">${COIN} <b>${game.coins}</b> · Turrets ${turrets.count}/${turrets.slots.length}${shield ? ` · Shield −${shield}% planet damage` : ''}</div>`;

    if (this.selected < 0) {
      this.panel.innerHTML = `${summary}<div class="panel-hint">Tap a glowing ring around the planet to build a turret.<br/>Drag to rotate the view.</div>`;
      return;
    }

    const slot = turrets.slots[this.selected];
    if (!slot.turret) {
      const cards = Object.entries(CONFIG.turrets.types).map(([type, t]) => {
        const afford = game.coins >= t.cost;
        return `<button class="card" data-action="build" data-type="${type}" ${afford ? '' : 'disabled'} style="--accent:${t.color}">
          <img class="card-img" src="${BASE}assets/${t.icon}" alt="" />
          <span class="card-name">${t.name}</span>
          <span class="card-desc">${t.desc}</span>
          <span class="card-cost">${COIN} ${t.cost}</span>
        </button>`;
      });
      this.panel.innerHTML = `${summary}<div class="panel-title">Slot ${slot.index + 1} · Choose a turret</div><div class="cards">${cards.join('')}</div>`;
      return;
    }

    const t = slot.turret;
    const def = CONFIG.turrets.types[t.type];
    const now = turrets.statsFor(t.type, t.level);
    const upCost = turrets.upgradeCost(t);
    const next = upCost !== null ? turrets.statsFor(t.type, t.level + 1) : null;
    const row = (label, a, b, fmt = (v) => Math.round(v)) =>
      `<div class="stat"><span>${label}</span><b>${fmt(a)}${next ? ` → <em>${fmt(b)}</em>` : ''}</b></div>`;
    let stats = '';
    if (t.type === 'shield') {
      stats = row('Planet damage absorbed', now.reduction, next?.reduction, (v) => `${Math.round(v * 100)}%`);
    } else {
      stats =
        row('Damage', now.damage, next?.damage) +
        row('Range', now.range, next?.range) +
        row('Shots / sec', 1 / now.interval, next ? 1 / next.interval : 0, (v) => v.toFixed(1));
    }
    const upgradeBtn = upCost !== null
      ? `<button class="action upgrade" data-action="upgrade" ${game.coins >= upCost ? '' : 'disabled'}>UPGRADE ${COIN} ${upCost}</button>`
      : `<button class="action upgrade" disabled>MAX LEVEL</button>`;
    this.panel.innerHTML = `${summary}
      <div class="panel-title rank-title" style="color:${def.color}">${def.name} <span class="rank">${TurretBadges.chevrons(t.level)} Level ${t.level}/${CONFIG.turrets.maxLevel}</span></div>
      <div class="stats">${stats}</div>
      <div class="actions">${upgradeBtn}<button class="action sell" data-action="sell">SELL +${turrets.sellValue(t)}</button></div>
      <div class="actions"><button class="action control" data-action="control">TAKE CONTROL ▶</button></div>`;
  }
}
