import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { segmentHitsSphere } from './Lasers.js';
import { makeRadialTexture } from '../world/Sky.js';
import { buildZeusTurret } from './TurretModels.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// Orbital defence platforms. Slots sit on a ring around the planet; each can hold one turret.
export class Turrets {
  constructor(scene, models = {}) {
    this.scene = scene;
    this.models = models;
    this.slots = [];
    this.glowTex = makeRadialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']], 64);
    this._buildSlots();
  }

  _buildSlots() {
    const r = CONFIG.turrets.orbit;
    const dirs = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      dirs.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    dirs.push(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0));

    const ringGeo = new THREE.TorusGeometry(5, 0.35, 8, 40);
    const hitGeo = new THREE.SphereGeometry(11, 12, 8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    for (const [i, dir] of dirs.entries()) {
      const pos = dir.clone().multiplyScalar(r);
      const marker = new THREE.Group();
      marker.position.copy(pos);
      marker.quaternion.setFromUnitVectors(UP, dir);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.5, 1.6, 2.6),
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }));
      ring.rotation.x = Math.PI / 2; // lie flat on the platform plane
      marker.add(ring);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.userData.slotIndex = i;
      marker.add(hit);
      marker.visible = false;
      this.scene.add(marker);

      this.slots.push({ index: i, pos, normal: dir.clone(), marker, ring, hit, turret: null });
    }

    // Range outline for the selected slot in tactical view (a camera-facing ring = the
    // silhouette of the turret's range sphere).
    this.rangeMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1, 128),
      new THREE.MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide })
    );
    this.rangeMesh.add(new THREE.Mesh(
      new THREE.CircleGeometry(0.985, 128),
      new THREE.MeshBasicMaterial({ color: 0x4fd8ff, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide })
    ));
    this.rangeMesh.visible = false;
    this.scene.add(this.rangeMesh);
  }

  get hitTargets() {
    return this.slots.map((s) => s.hit);
  }

  showSlots(visible, selectedIndex = -1) {
    for (const s of this.slots) {
      s.marker.visible = visible;
      s.ring.visible = visible && !s.turret;
      const sel = s.index === selectedIndex;
      s.ring.material.color.setRGB(sel ? 3 : 0.5, sel ? 2.4 : 1.6, sel ? 0.6 : 2.6);
    }
    const sel = this.slots[selectedIndex];
    const range = sel?.turret ? this.statsFor(sel.turret.type, sel.turret.level).range : 0;
    this.rangeMesh.visible = visible && !!range;
    if (range) {
      this.rangeMesh.position.copy(sel.pos);
      this.rangeMesh.scale.setScalar(range);
      const c = CONFIG.turrets.types[sel.turret.type].color;
      this.rangeMesh.material.color.set(c);
      this.rangeMesh.children[0].material.color.set(c);
    }
  }

  statsFor(type, level) {
    const t = CONFIG.turrets.types[type];
    const i = level - 1;
    return {
      range: (t.range ?? 0) * CONFIG.turrets.rangeMul[i],
      damage: (t.damage ?? 0) * CONFIG.turrets.damageMul[i],
      interval: (t.interval ?? 0) * CONFIG.turrets.intervalMul[i],
      splash: t.splash ?? 0,
      reduction: t.reduction?.[i] ?? 0,
    };
  }

  upgradeCost(turret) {
    if (turret.level >= CONFIG.turrets.maxLevel) return null;
    return Math.round(CONFIG.turrets.types[turret.type].cost * 0.75 * turret.level);
  }

  sellValue(turret) {
    return Math.round(turret.spent * CONFIG.turrets.sellRefund);
  }

  // Total fraction of planet damage absorbed by shield generators.
  get shieldReduction() {
    let r = 0;
    for (const s of this.slots) {
      if (s.turret?.type === 'shield') r += this.statsFor('shield', s.turret.level).reduction;
    }
    return Math.min(r, CONFIG.turrets.types.shield.maxReduction);
  }

  // Disable every turret within radius of center for duration seconds. Returns how many.
  emp(center, radius, duration) {
    let n = 0;
    for (const s of this.slots) {
      if (!s.turret || s.pos.distanceTo(center) > radius) continue;
      s.turret.disabled = duration;
      this._setPowered(s.turret, false);
      n++;
    }
    return n;
  }

  _setPowered(t, on) {
    t.model.root.traverse((o) => {
      if (o.isSprite) o.visible = on;
    });
  }

  get count() {
    return this.slots.filter((s) => s.turret).length;
  }

  build(slot, type) {
    const model = buildTurretModel(type, this.glowTex, this.models);
    model.root.position.copy(slot.pos);
    model.root.quaternion.setFromUnitVectors(UP, slot.normal);
    // lookAt() needs the platform's own up, or the head rolls sideways on a sphere.
    model.head.up.copy(slot.normal);
    this.scene.add(model.root);
    slot.turret = { type, level: 1, spent: CONFIG.turrets.types[type].cost, model, cooldown: 0.5, target: null, gunIndex: 0 };
    this._refreshPips(slot.turret);
    return slot.turret;
  }

  upgrade(slot) {
    const t = slot.turret;
    const cost = this.upgradeCost(t);
    if (cost === null) return;
    t.level++;
    t.spent += cost;
    this._refreshPips(t);
  }

  sell(slot) {
    const t = slot.turret;
    this.scene.remove(t.model.root);
    slot.turret = null;
  }

  clear() {
    for (const s of this.slots) if (s.turret) this.sell(s);
  }

  _refreshPips(t) {
    t.model.pips.forEach((p, i) => (p.visible = i < t.level));
    t.model.setLevel?.(t.level); // GLB turrets change colour scheme with every level
    t.model.root.scale.setScalar(1.5 + (t.level - 1) * 0.1);
  }

  // ctx: { enemies, lasers (turret lasers), missiles, time, onFire(type, slot) }
  update(dt, ctx) {
    const R = CONFIG.planet.radius;
    for (const slot of this.slots) {
      const t = slot.turret;
      if (!t) continue;
      const m = t.model;
      // Under manual control: the player aims and fires (see TurretControl).
      if (t.manned) {
        if (t.disabled > 0) {
          t.disabled -= dt;
          if (t.disabled <= 0) this._setPowered(t, true);
        }
        continue;
      }
      // Knocked out by an EMP: dark and silent until it reboots.
      if (t.disabled > 0) {
        t.disabled -= dt;
        m.head.rotation.x = Math.sin(ctx.time * 20) * 0.05;
        if (t.disabled <= 0) this._setPowered(t, true);
        continue;
      }
      if (t.type === 'shield') {
        m.core.scale.setScalar(1 + Math.sin(ctx.time * 3 + slot.index) * 0.12);
        continue;
      }

      const stats = this.statsFor(t.type, t.level);
      t.cooldown -= dt;

      // Prefer the enemy closest to the planet among those in range with a clear line of sight.
      let best = null;
      let bestScore = Infinity;
      for (const e of ctx.targets) {
        if (!e.active) continue;
        const d = e.group.position.distanceTo(slot.pos);
        if (d > stats.range) continue;
        if (segmentHitsSphere(slot.pos, e.group.position, _v.set(0, 0, 0), R * 0.97)) continue;
        const score = e.group.position.length() + d * 0.3;
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      }
      t.target = best;

      if (best) {
        // Lead the target for lasers.
        const fwd = _v2.set(0, 0, -1).applyQuaternion(best.group.quaternion);
        const boltSpeed = t.type === 'cannon' ? ctx.heavy.speed : CONFIG.laser.speed;
        const lead = t.type === 'missile' ? 0 : best.group.position.distanceTo(slot.pos) / boltSpeed;
        const aim = _v.copy(best.group.position).addScaledVector(fwd, best.speed * lead);
        m.head.lookAt(aim);

        if (t.cooldown <= 0) {
          t.cooldown = stats.interval;
          const muzzle = m.muzzles[t.gunIndex].getWorldPosition(new THREE.Vector3());
          t.gunIndex = (t.gunIndex + 1) % m.muzzles.length;
          if (t.type === 'laser') {
            ctx.lasers.fire(muzzle, aim.clone(), stats.damage);
          } else if (t.type === 'cannon') {
            ctx.heavy.fire(muzzle, aim.clone(), stats.damage);
          } else {
            const dir = new THREE.Vector3().subVectors(muzzle, slot.pos).normalize();
            ctx.missiles.fire(muzzle, dir, best, stats.damage, stats.splash);
          }
          ctx.onFire?.(t.type, slot);
        }
      } else {
        // Idle sweep.
        m.head.rotation.y += dt * 0.4;
      }
    }
  }
}

function buildTurretModel(type, glowTex, models = {}) {
  const color = new THREE.Color(CONFIG.turrets.types[type].color);
  const glb = buildZeusTurret(models.turrets, type);
  if (glb) {
    // Model from the turret pack + a thin type-coloured rim and a power halo.
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.1, 6, 40), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2) }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.15;
    glb.root.add(rim);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: color.clone().multiplyScalar(0.7),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    halo.scale.setScalar(7);
    halo.position.y = 0.4;
    glb.root.add(halo);
    // Under the planet-facing platform: a strut like the procedural ones.
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.2, 3, 6), new THREE.MeshStandardMaterial({ color: 0x2a2e36, metalness: 0.7, roughness: 0.5 }));
    strut.position.y = -1.5;
    glb.root.add(strut);
    return { ...glb, pips: [], core: null, rim, halo, shell: [] };
  }
  const root = new THREE.Group();
  const hdr = color.clone().multiplyScalar(3);
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a919b, metalness: 0.6, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e36, metalness: 0.7, roughness: 0.5 });
  const glow = new THREE.MeshBasicMaterial({ color: hdr });

  // Hexagonal platform with a glowing rim.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 0.9, 6), dark);
  root.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.12, 6, 6), glow);
  rim.rotation.x = Math.PI / 2;
  rim.rotation.z = Math.PI / 6;
  rim.position.y = 0.45;
  root.add(rim);
  // Underside struts pointing at the planet.
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.2, 3, 6), dark);
  strut.position.y = -1.9;
  root.add(strut);

  // Level pips.
  const pips = [];
  for (let i = 0; i < CONFIG.turrets.maxLevel; i++) {
    const pip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glow);
    const a = (i - 1) * 0.5 + Math.PI / 2;
    pip.position.set(Math.cos(a) * 2.6, 0.55, Math.sin(a) * 2.6);
    root.add(pip);
    pips.push(pip);
  }

  const head = new THREE.Group();
  head.position.y = 1.4;
  root.add(head);
  const muzzles = [];
  let core = null;

  if (type === 'laser' || type === 'cannon') {
    head.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 2.2), metal));
    for (const s of [-1, 1]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.2, 8), dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0.55 * s, 0.1, 2.4);
      head.add(barrel);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glow);
      tip.position.set(0.55 * s, 0.1, 4.0);
      head.add(tip);
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0.55 * s, 0.1, 4.3);
      head.add(muzzle);
      muzzles.push(muzzle);
    }
  } else if (type === 'missile') {
    head.add(new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.8, 2.4), metal));
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 10), dark);
        tube.rotation.x = Math.PI / 2;
        tube.position.set(0.7 * sx, 0.45 * sy, 1.3);
        head.add(tube);
        const warhead = new THREE.Mesh(new THREE.CircleGeometry(0.28, 10), glow);
        warhead.position.set(0.7 * sx, 0.45 * sy, 1.56);
        head.add(warhead);
        const muzzle = new THREE.Object3D();
        muzzle.position.set(0.7 * sx, 0.45 * sy, 2.0);
        head.add(muzzle);
        muzzles.push(muzzle);
      }
    }
  } else {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x9fffd0, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.35 })
    );
    head.add(dome);
    core = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 10), glow);
    core.position.y = 0.6;
    head.add(core);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 2.6, 6), dark);
      pylon.position.set(Math.cos(a) * 2.3, 0.8, Math.sin(a) * 2.3);
      head.add(pylon);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glow);
      light.position.set(Math.cos(a) * 2.3, 2.15, Math.sin(a) * 2.3);
      head.add(light);
    }
  }

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex,
    color: color.clone().multiplyScalar(1.2),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  halo.scale.setScalar(9);
  halo.position.y = 0.6;
  root.add(halo);

  return { root, head, muzzles, pips, core, rim, halo, eye: 1.4, shell: [head.children[0]] };
}
