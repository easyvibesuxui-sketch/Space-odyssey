import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { rand } from '../core/noise.js';
import { makeRadialTexture } from '../world/Sky.js';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _radial = new THREE.Vector3();

// Enemy AI:
//  - Fighters dogfight the player when close, otherwise make strafing runs on the planet.
//  - Bombers ignore the player, settle into a low orbit and bombard the planet.
export class Enemies {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.glowTex = makeRadialTexture([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,150,90,0.6)'], [1, 'rgba(255,40,0,0)']], 64);
  }

  get activeCount() {
    let n = 0;
    for (const e of this.list) if (e.active) n++;
    return n;
  }

  clear() {
    for (const e of this.list) {
      e.active = false;
      e.group.visible = false;
    }
  }

  spawn(type, position, level = 1) {
    let e = this.list.find((x) => !x.active && x.type === type);
    if (!e) {
      e = this._create(type);
      this.list.push(e);
    }
    const cfg = CONFIG.enemies[type];
    const scale = 1 + (level - 1) * 0.25;
    e.active = true;
    e.group.visible = true;
    e.maxHp = e.hp = cfg.hp * scale;
    e.speed = cfg.speed * (1 + (level - 1) * 0.08);
    e.fireTimer = rand(0.5, 2);
    e.flash = 0;
    e.evade = 0;
    e.orbitAxis.randomDirection();
    // ~40% of fighters hunt the player, the rest raid the planet unless the player gets close.
    e.role = type === 'fighter' && Math.random() < 0.4 ? 'hunter' : 'raider';
    e.group.position.copy(position);
    // Face the planet on arrival.
    _m.lookAt(position, new THREE.Vector3(0, 0, 0), UP);
    e.group.quaternion.setFromRotationMatrix(_m);
    return e;
  }

  _create(type) {
    const model = type === 'bomber' ? buildBomber(this.glowTex) : buildFighter(this.glowTex);
    this.scene.add(model.root);
    return {
      type,
      group: model.root,
      model,
      radius: CONFIG.enemies[type].radius,
      hp: 1,
      maxHp: 1,
      speed: 1,
      fireTimer: 0,
      flash: 0,
      evade: 0,
      evadeDir: new THREE.Vector3(),
      orbitAxis: new THREE.Vector3(0, 1, 0),
      active: false,
      gunIndex: 0,
      role: 'raider',
    };
  }

  // ctx: { ship, planetRadius, lasers (enemy), time }
  update(dt, ctx) {
    const R = ctx.planetRadius;
    for (const e of this.list) {
      if (!e.active) continue;
      const cfg = CONFIG.enemies[e.type];
      const pos = e.group.position;
      const fwd = _v.set(0, 0, -1).applyQuaternion(e.group.quaternion);
      const distC = pos.length();
      const alt = distC - R;

      let target = null; // what we'd shoot at
      let targetIsPlayer = false;

      const ship = ctx.ship;
      const toPlayer = _v2.subVectors(ship.group.position, pos);
      const playerDist = toPlayer.length();

      if (e.evade > 0) {
        e.evade -= dt;
        _desired.copy(e.evadeDir);
      } else if (e.type === 'fighter' && ship.alive && playerDist < (e.role === 'hunter' ? 280 : 90)) {
        // Dogfight: lead the player.
        _desired.copy(ship.group.position).addScaledVector(ship.velocity, playerDist / CONFIG.enemyLaser.speed * 0.8).sub(pos);
        target = _desired.clone().add(pos);
        targetIsPlayer = true;
        if (playerDist < 35) {
          // Too close: break off to the side and come around again.
          e.evade = 1.4;
          e.evadeDir.crossVectors(fwd, UP).normalize().multiplyScalar(Math.random() < 0.5 ? 1 : -1).add(fwd).normalize();
        }
      } else {
        // Planet attack: dive in, then orbit low and fire at the surface.
        const orbitAlt = e.type === 'bomber' ? 38 : 32;
        const radial = _radial.copy(pos).normalize();
        if (alt > 90) {
          _desired.copy(radial).negate();
          // Approach at an angle so they spiral in rather than dive straight down.
          _desired.add(_v2.crossVectors(e.orbitAxis, radial).normalize().multiplyScalar(0.5));
        } else {
          const tangent = _v2.crossVectors(e.orbitAxis, radial).normalize();
          const correction = (orbitAlt - alt) * 0.04;
          _desired.copy(tangent).addScaledVector(radial, correction);
          target = radial.clone().multiplyScalar(R).addScaledVector(tangent, 25).normalize().multiplyScalar(R);
        }
      }

      // Never fly into the planet.
      if (alt < 18) _desired.addScaledVector(_v2.copy(pos).normalize(), (18 - alt) * 0.4);

      if (_desired.lengthSq() > 1e-6) {
        _m.lookAt(pos, _v2.copy(pos).add(_desired), UP);
        _q.setFromRotationMatrix(_m);
        e.group.quaternion.rotateTowards(_q, cfg.turnRate * dt);
      }
      fwd.set(0, 0, -1).applyQuaternion(e.group.quaternion);
      pos.addScaledVector(fwd, e.speed * dt);

      // Bombers also take pot-shots at a player who gets close.
      if (e.type === 'bomber' && ship.alive && playerDist < 110) {
        target = ship.group.position.clone();
        targetIsPlayer = true;
      }

      // Fire when the target is roughly in front.
      e.fireTimer -= dt;
      if (target && e.fireTimer <= 0) {
        const toT = _v2.subVectors(target, pos);
        const d = toT.length();
        const cone = targetIsPlayer ? 0.3 : 1.1;
        if (d < cfg.range && toT.normalize().dot(fwd) > Math.cos(cone)) {
          e.fireTimer = cfg.fireInterval * rand(0.8, 1.3);
          const muzzle = e.model.guns[e.gunIndex].getWorldPosition(new THREE.Vector3());
          e.gunIndex = (e.gunIndex + 1) % e.model.guns.length;
          // Slight inaccuracy so the player can dodge.
          const spread = targetIsPlayer ? 2.5 : 4;
          target.x += rand(-spread, spread);
          target.y += rand(-spread, spread);
          target.z += rand(-spread, spread);
          const l = ctx.lasers.fire(muzzle, target, cfg.damage);
          // Stray shots aimed at the player barely scratch the planet.
          l.planetDamage = targetIsPlayer ? 0.03 : e.type === 'bomber' ? 1.2 : 0.2;
          ctx.onEnemyFire?.(e);
        }
      }

      // Hit flash + engine flicker.
      if (e.flash > 0) {
        e.flash = Math.max(0, e.flash - dt * 6);
        e.model.hullMat.emissive.setRGB(e.flash, e.flash * 0.5, e.flash * 0.3);
      }
      for (const g of e.model.glows) g.scale.setScalar(g.userData.size * (0.85 + Math.random() * 0.3));
    }
  }

  // Returns true when destroyed.
  damage(e, amount) {
    e.hp -= amount;
    e.flash = 1;
    if (e.hp > 0) return false;
    e.active = false;
    e.group.visible = false;
    return true;
  }
}

function enemyMaterials() {
  return {
    hull: new THREE.MeshStandardMaterial({ color: 0x3a3439, metalness: 0.6, roughness: 0.45, emissive: 0x000000 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c1a1e, metalness: 0.7, roughness: 0.5 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x8a2f2a, metalness: 0.4, roughness: 0.5 }),
    light: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.8, 0.4) }),
    engine: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.5, 0.5) }),
  };
}

function extrude(pts, depth, mat, bevel = 0.06) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function addGlow(parent, tex, x, y, z, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    color: new THREE.Color(3, 1.2, 0.5),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  s.position.set(x, y, z);
  s.scale.setScalar(size);
  s.userData.size = size;
  parent.add(s);
  return s;
}

function buildFighter(glowTex) {
  const root = new THREE.Group();
  const m = enemyMaterials();
  // Aggressive forward-swept dart. Shape +y = nose (-Z in world).
  const body = extrude([[0, 3.6], [0.7, 1.2], [0.8, -1.8], [-0.8, -1.8], [-0.7, 1.2]], 0.7, m.hull);
  body.position.y = -0.35;
  root.add(body);
  for (const s of [-1, 1]) {
    const wing = extrude([[0, -0.4], [3.2 * s, 1.4], [3.4 * s, 0.6], [0, -1.8]], 0.14, m.hull, 0.03);
    wing.position.set(0.6 * s, -0.1, 0);
    root.add(wing);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 1.4), m.accent);
    tip.position.set(3.9 * s, 0.05, -1.0);
    root.add(tip);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.2), m.light);
    strip.position.set(2.2 * s, 0.08, -0.4);
    strip.rotation.y = -0.55 * s;
    root.add(strip);
  }
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.light);
  canopy.scale.set(0.8, 0.6, 1.6);
  canopy.position.set(0, 0.35, -0.8);
  root.add(canopy);
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.1), m.engine);
  engine.position.set(0, 0, 1.85);
  root.add(engine);
  const glows = [addGlow(root, glowTex, 0, 0, 2.1, 2.4)];
  const guns = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Object3D();
    g.position.set(0.9 * s, -0.1, -2.2);
    root.add(g);
    guns.push(g);
  }
  root.scale.setScalar(1.35);
  return { root, guns, glows, hullMat: m.hull };
}

function buildBomber(glowTex) {
  const root = new THREE.Group();
  const m = enemyMaterials();
  const body = extrude([[0, 4.2], [1.8, 2.8], [2.4, -3.0], [-2.4, -3.0], [-1.8, 2.8]], 1.6, m.hull, 0.12);
  body.position.y = -0.8;
  root.add(body);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 5), m.dark);
  spine.position.set(0, 1.0, 0);
  root.add(spine);
  const glows = [];
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 6, 10), m.dark);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(3.4 * s, -0.2, 0.4);
    root.add(pod);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.12, 6, 16), m.engine);
    ring.position.set(3.4 * s, -0.2, 3.45);
    root.add(ring);
    glows.push(addGlow(root, glowTex, 3.4 * s, -0.2, 3.7, 3.4));
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.5), m.light);
    light.position.set(2.1 * s, 0.85, 0.2);
    root.add(light);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 2.2), m.accent);
    strut.position.set(2.5 * s, -0.2, 0.6);
    root.add(strut);
  }
  const eye = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 0.1), m.light);
  eye.position.set(0, 0.2, -4.0);
  root.add(eye);
  const guns = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Object3D();
    g.position.set(1.2 * s, -0.8, -3.8);
    root.add(g);
    guns.push(g);
  }
  root.scale.setScalar(1.4);
  return { root, guns, glows, hullMat: m.hull };
}
