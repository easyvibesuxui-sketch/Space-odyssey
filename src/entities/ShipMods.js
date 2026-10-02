import * as THREE from 'three';

// Visible ship upgrades. Every upgrade bought at the base bolts something onto the ship that
// grows with its level, so the ship in flight (and on the hangar pad) shows what it carries:
//   Laser Power      – glowing gun barrels, thicker and hotter bolts (see Game)
//   Rapid Capacitors – purple coils on the guns, then extra under-wing gun pods
//   Hull Plating     – orange-trimmed armour plates on the hull
//   Shield Capacitor – blue shield emitter nodes on the hull
//   Engine Tuning    – longer, wider, hotter engine flames
//   Salvage Magnet   – a spinning gold magnet ring with orbiting sparks under the ship
export const MOD_COLORS = {
  damage: new THREE.Color(0.5, 1.6, 2.6),
  firerate: new THREE.Color(1.5, 0.6, 2.6),
  hull: new THREE.Color(2.4, 0.9, 0.2),
  shield: new THREE.Color(0.35, 1.0, 2.6),
  engine: new THREE.Color(0.9, 2.0, 2.6),
  magnet: new THREE.Color(2.6, 1.7, 0.3),
};

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const surfaceCache = new WeakMap();
let whiteGlow = null;

function glowTexture() {
  if (whiteGlow) return whiteGlow;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  whiteGlow = new THREE.CanvasTexture(c);
  whiteGlow.colorSpace = THREE.SRGBColorSpace;
  return whiteGlow;
}

export class ShipMods {
  // model: { root, roll, guns, hull, size: {x, y, z}, trailMat }
  constructor(model) {
    this.model = model;
    this.glowTex = glowTexture();
    this.baseGuns = model.guns.slice();
    this.group = new THREE.Group();
    model.roll.add(this.group);
    this.levels = {};
    this.spinners = [];
    this.pulsers = [];
    this.coils = [];
    this.engine = 0;
    this._raycaster = new THREE.Raycaster();
    this._surfaces = surfaceCache.get(model.source) ?? new Map();
    if (model.source) surfaceCache.set(model.source, this._surfaces);
  }

  // Point on the hull straight above (top=true) or below (x, z), in roll space.
  _surface(fx, fz, top = true) {
    const key = `${fx}|${fz}|${top}`;
    if (this._surfaces.has(key)) return this._surfaces.get(key);
    const { x: W, y: H, z: L } = this.model.size;
    const x = fx * W;
    const z = fz * L;
    let res = { point: new THREE.Vector3(x, top ? H * 0.35 : -H * 0.35, z), normal: (top ? UP : DOWN).clone() };
    if (this.model.hull) {
      // Ray-cast against the hull, working in roll space.
      this.model.hull.updateWorldMatrix(true, true);
      const inv = new THREE.Matrix4().copy(this.model.roll.matrixWorld).invert();
      const origin = new THREE.Vector3(x, top ? H * 3 : -H * 3, z).applyMatrix4(this.model.roll.matrixWorld);
      const dir = (top ? DOWN : UP).clone().transformDirection(this.model.roll.matrixWorld);
      this._raycaster.set(origin, dir);
      const hit = this._raycaster.intersectObject(this.model.hull, true).find((h) => h.object.isMesh && h.face);
      if (hit) {
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(inv);
        if (n.y * (top ? 1 : -1) < 0.2) n.copy(top ? UP : DOWN);
        res = { point: hit.point.applyMatrix4(inv), normal: n };
      } else {
        res = null; // nothing there (gap between wings etc.)
      }
    }
    this._surfaces.set(key, res);
    return res;
  }

  _glow(color, scale, opacity = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex,
      color: color.clone().multiplyScalar(opacity),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    s.scale.setScalar(scale);
    return s;
  }

  set(levels) {
    this.levels = { ...levels };
    for (const c of [...this.group.children]) this.group.remove(c);
    this.spinners = [];
    this.pulsers = [];
    this.coils = [];
    const m = this.model;
    m.guns.length = 0;
    m.guns.push(...this.baseGuns);
    const { x: W, y: H, z: L } = m.size;
    const u = L / 6.5; // ship-relative unit (player GLB is 6.5 long)
    // Ten upgrade levels map onto five visual tiers.
    const lv = (id) => Math.ceil((levels?.[id] ?? 0) / 2);

    const dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.75, roughness: 0.35 });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x7c848f, metalness: 0.7, roughness: 0.35 });
    const basic = (c) => new THREE.MeshBasicMaterial({ color: c });

    // --- Laser Power: barrels with glowing emitters on the nose guns.
    const dmg = lv('damage');
    if (dmg > 0) {
      for (const g of this.baseGuns) {
        const len = (0.55 + dmg * 0.1) * u;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * u, 0.075 * u, len, 8), dark);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.copy(g.position).add(new THREE.Vector3(0, 0, len / 2));
        this.group.add(barrel);
        for (let i = 0; i < Math.min(dmg, 3); i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085 * u, 0.018 * u, 6, 14), basic(MOD_COLORS.damage));
          ring.position.copy(g.position).add(new THREE.Vector3(0, 0, (0.08 + i * 0.13) * u));
          this.group.add(ring);
        }
        const tip = this._glow(MOD_COLORS.damage, (0.3 + dmg * 0.08) * u, 0.3);
        tip.position.copy(g.position);
        tip.userData.base = tip.scale.x;
        this.group.add(tip);
        this.pulsers.push({ obj: tip, speed: 6, amp: 0.15 });
      }
    }

    // --- Rapid Capacitors: purple coils on the guns, then extra wing pods that also fire.
    const rof = lv('firerate');
    if (rof > 0) {
      for (const g of this.baseGuns) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.12 * u, 0.03 * u, 6, 16), basic(MOD_COLORS.firerate));
        coil.position.copy(g.position).add(new THREE.Vector3(0, 0, 0.62 * u));
        this.group.add(coil);
        this.coils.push(coil);
      }
      const pods = rof >= 4 ? [0.3, 0.42] : rof >= 2 ? [0.3] : [];
      for (const fx of pods) {
        for (const s of [-1, 1]) {
          const surf = this._surface(s * fx, 0.05, false);
          const y = surf ? surf.point.y - 0.12 * u : -H * 0.3;
          const zFront = -L * 0.22;
          const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * u, 0.11 * u, 1.1 * u, 8), dark);
          body.rotation.x = Math.PI / 2;
          body.position.set(s * fx * W, y, zFront + 0.55 * u);
          this.group.add(body);
          const coil = new THREE.Mesh(new THREE.TorusGeometry(0.12 * u, 0.028 * u, 6, 16), basic(MOD_COLORS.firerate));
          coil.position.set(s * fx * W, y, zFront + 0.3 * u);
          this.group.add(coil);
          this.coils.push(coil);
          const tip = this._glow(MOD_COLORS.firerate, 0.35 * u, 0.3);
          tip.position.set(s * fx * W, y, zFront);
          this.group.add(tip);
          const muzzle = new THREE.Object3D();
          muzzle.position.set(s * fx * W, y, zFront - 0.1 * u);
          this.group.add(muzzle);
          m.guns.push(muzzle);
        }
      }
      // Alternate outer/inner guns so the extra pods visibly fire.
      if (m.guns.length > 2) {
        const order = [];
        const half = m.guns.length / 2;
        for (let i = 0; i < half; i++) order.push(m.guns[i * 2], m.guns[i * 2 + 1]);
        m.guns.length = 0;
        m.guns.push(...order);
      }
    }

    // --- Hull Plating: armour plates with orange trim on top of the hull.
    const hull = lv('hull');
    const platePlan = [[0.12, 0.08], [0.12, 0.24], [0, -0.12], [0.27, 0.18], [0.27, 0.32]];
    for (let i = 0; i < hull; i++) {
      const [fx, fz] = platePlan[i];
      for (const s of fx ? [-1, 1] : [1]) {
        const surf = this._surface(s * fx, fz, true);
        if (!surf) continue;
        const plate = new THREE.Group();
        const pw = (fx ? 0.1 : 0.08) * W;
        const pl = 0.1 * L;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.05 * u, pl), plateMat);
        plate.add(slab);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(pw * 1.02, 0.03 * u, 0.03 * u), basic(MOD_COLORS.hull));
        trim.position.set(0, 0.03 * u, -pl / 2);
        plate.add(trim);
        const trim2 = trim.clone();
        trim2.position.z = pl / 2;
        plate.add(trim2);
        plate.position.copy(surf.point).addScaledVector(surf.normal, 0.03 * u);
        plate.quaternion.setFromUnitVectors(UP, surf.normal);
        this.group.add(plate);
      }
    }

    // --- Shield Capacitor: blue emitter nodes along the hull.
    const sh = lv('shield');
    for (let i = 0; i < sh; i++) {
      const fz = -0.05 + i * 0.09;
      const fx = i % 2 ? 0.2 : 0.06;
      for (const s of [-1, 1]) {
        const surf = this._surface(s * fx, fz, true);
        if (!surf) continue;
        const node = new THREE.Mesh(new THREE.SphereGeometry(0.06 * u, 8, 6), basic(MOD_COLORS.shield));
        node.position.copy(surf.point).addScaledVector(surf.normal, 0.05 * u);
        this.group.add(node);
        const g = this._glow(MOD_COLORS.shield, 0.4 * u, 0.3);
        g.position.copy(node.position);
        g.userData.base = g.scale.x;
        this.group.add(g);
        this.pulsers.push({ obj: g, speed: 2.5, amp: 0.3, phase: i });
      }
    }

    // --- Engine Tuning: drives flame length/width/heat (Ship.update reads this.engine).
    this.engine = lv('engine');
    if (m.trailMat) m.trailMat.uniforms.uPower.value = this.engine / 5;

    // --- Salvage Magnet: spinning gold ring + orbiting sparks under the ship.
    const mag = lv('magnet');
    if (mag > 0) {
      const surf = this._surface(0, 0.1, false);
      const y = (surf ? surf.point.y : -H * 0.4) - 0.25 * u;
      const ring = new THREE.Group();
      ring.position.set(0, y, 0.1 * L);
      const r = (0.55 + mag * 0.06) * u;
      const torus = new THREE.Mesh(new THREE.TorusGeometry(r, (0.025 + mag * 0.006) * u, 6, 48), basic(MOD_COLORS.magnet));
      torus.rotation.x = Math.PI / 2;
      ring.add(torus);
      for (let i = 0; i < mag + 1; i++) {
        const a = (i / (mag + 1)) * Math.PI * 2;
        const spark = this._glow(MOD_COLORS.magnet, 0.3 * u, 0.5);
        spark.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        ring.add(spark);
      }
      const core = this._glow(MOD_COLORS.magnet, (0.5 + mag * 0.06) * u, 0.12);
      ring.add(core);
      this.group.add(ring);
      this.spinners.push({ obj: ring, speed: 1.2 + mag * 0.35 });
    }
  }

  update(dt, time) {
    for (const s of this.spinners) s.obj.rotation.y += s.speed * dt;
    for (const p of this.pulsers) {
      p.obj.scale.setScalar(p.obj.userData.base * (1 + Math.sin(time * p.speed + (p.phase ?? 0)) * p.amp));
    }
  }

  // Called when a gun fires: its capacitor coils flash.
  kick() {
    for (const c of this.coils) c.scale.setScalar(1.35);
  }

  settle(dt) {
    for (const c of this.coils) c.scale.setScalar(1 + (c.scale.x - 1) * Math.exp(-10 * dt));
  }
}
