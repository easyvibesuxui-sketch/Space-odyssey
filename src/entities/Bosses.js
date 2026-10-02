import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { rand } from '../core/noise.js';
import { instantiate, setFlash } from '../core/Models.js';
import { makeRadialTexture } from '../world/Sky.js';

// Each level ends with a boss. They rotate through four types, each with a unique ability:
//  Dreadnought   — hull shielded while orbiting drones live
//  Carrier       — launches fighter squadrons from hangar bays (bays shield the hull)
//  Siege Breaker — charges a planet-cracker beam; hit its core during the charge to interrupt
//  Phantom       — cloaks, teleports, and EMPs nearby turrets when it reappears
export const BOSS_TYPES = {
  dreadnought: {
    name: 'DREADNOUGHT',
    model: 'boss',
    length: 70,
    hp: 2600,
    color: '#4fd8ff',
    hint: 'Shielded by orbiting drones · destroy the drones first',
  },
  carrier: {
    name: 'CARRIER',
    model: 'bomber',
    length: 60,
    hp: 2200,
    color: '#ff9b3d',
    hint: 'Launches fighter squadrons · destroy its hangar bays',
  },
  siege: {
    name: 'SIEGE BREAKER',
    model: 'titan',
    fallback: 'fighter',
    length: 64,
    hp: 2000,
    color: '#ff4d5e',
    hint: 'Charges a planet-cracker beam · shoot the glowing core to interrupt it',
  },
  phantom: {
    name: 'PHANTOM',
    model: 'boss',
    length: 55,
    hp: 1800,
    color: '#b98cff',
    hint: 'Cloaks and teleports · its EMP knocks your turrets offline',
  },
};
const ORDER = ['dreadnought', 'carrier', 'siege', 'phantom'];
const ORBIT_R = 285;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class Bosses {
  constructor(scene, models, effects) {
    this.scene = scene;
    this.models = models;
    this.effects = effects;
    this.boss = null;
    this.targets = []; // hittable parts, same shape as enemies: { group, radius, active, hp, maxHp, speed, type }
    this.glowTex = makeRadialTexture([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']], 64);
  }

  get active() {
    return !!this.boss && this.boss.alive;
  }

  static typeForLevel(level) {
    return ORDER[(level - 1) % ORDER.length];
  }

  clear() {
    if (this.boss) this.scene.remove(this.boss.root, ...this.boss.extras);
    this.boss = null;
    this.targets.length = 0;
  }

  spawn(level, from) {
    this.clear();
    const type = Bosses.typeForLevel(level);
    const def = BOSS_TYPES[type];
    const cycle = Math.floor((level - 1) / ORDER.length);
    const root = new THREE.Group();
    this.scene.add(root);

    // Hull: the provided model at boss scale (placeholder box if models failed to load).
    const model = this.models[def.model] ?? this.models[def.fallback];
    let body;
    let materials = [];
    if (model) {
      const inst = instantiate(model, { ownMaterials: true });
      body = inst.root;
      materials = inst.materials;
      body.scale.setScalar(def.length / model.size.z);
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: 0x555a63, metalness: 0.6, roughness: 0.5 });
      mat.userData.baseEmissive = new THREE.Color(0, 0, 0);
      materials = [mat];
      body = new THREE.Mesh(new THREE.BoxGeometry(def.length * 0.3, def.length * 0.15, def.length), mat);
    }
    root.add(body);
    if (type === 'phantom') {
      for (const m of materials) {
        m.transparent = true;
        if (m.color) m.color.multiplyScalar(0.7).add(new THREE.Color(0.15, 0.05, 0.25));
      }
    }

    const L = def.length;
    const boss = {
      type,
      def,
      level,
      root,
      body,
      materials,
      extras: [],
      hp: def.hp * (1 + 0.6 * cycle) * (1 + 0.15 * (level - 1)),
      maxHp: 0,
      alive: true,
      length: L,
      flash: 0,
      angle: Math.atan2(from.z, from.x),
      height: rand(-30, 30),
      arriving: true,
      fireTimer: 4,
      timer: 0,
      state: 'move',
      status: def.hint,
      damageMul: 1,
      opacity: 1,
      cloaked: false,
    };
    boss.maxHp = boss.hp;
    root.position.copy(from);
    this.boss = boss;
    this.targets.length = 0;

    // Hull hit volumes: spheres along the keel.
    const segR = L * 0.13;
    for (let i = 0; i < 5; i++) {
      const z = -L / 2 + segR + (i / 4) * (L - 2 * segR);
      this._addTarget({ kind: 'segment', radius: segR * 1.15, local: new THREE.Vector3(0, 0, z), boss: true });
    }

    if (type === 'dreadnought') this._setupDreadnought(boss, cycle);
    if (type === 'carrier') this._setupCarrier(boss, cycle);
    if (type === 'siege') this._setupSiege(boss, cycle);
    if (type === 'phantom') boss.state = 'visible';
    return boss;
  }

  _addTarget(t) {
    const target = {
      group: new THREE.Object3D(),
      active: true,
      speed: 0,
      type: t.kind,
      hp: t.hp ?? Infinity,
      maxHp: t.hp ?? Infinity,
      ...t,
    };
    this.targets.push(target);
    return target;
  }

  _glow(color, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(size);
    return s;
  }

  // ---------------------------------------------------------------- per-type setup

  _setupDreadnought(boss, cycle) {
    const L = boss.length;
    // Ellipsoid energy shield around the hull.
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), makeShieldMaterial(new THREE.Color(0.3, 1.4, 2.6)));
    shield.scale.set(L * 0.32, L * 0.2, L * 0.62);
    boss.root.add(shield);
    boss.shield = shield;

    boss.drones = [];
    const droneMat = new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.8, roughness: 0.3, emissive: new THREE.Color(0.2, 0.9, 1.6) });
    const count = 4 + cycle;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(3.2, 0), droneMat);
      mesh.add(this._glow(new THREE.Color(0.6, 2.2, 3.5), 14));
      this.scene.add(mesh);
      boss.extras.push(mesh);
      const tether = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: new THREE.Color(0.5, 2, 3.2), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending })
      );
      tether.frustumCulled = false;
      this.scene.add(tether);
      boss.extras.push(tether);
      const t = this._addTarget({ kind: 'drone', radius: 4.5, hp: 140 * (1 + 0.5 * cycle), boss: true });
      boss.drones.push({ mesh, tether, target: t, phase: (i / count) * Math.PI * 2 });
    }
  }

  _setupCarrier(boss, cycle) {
    const L = boss.length;
    boss.bays = [];
    const bayMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, 0.3) });
    for (const [x, z] of [[-0.22, -0.1], [0.22, -0.1], [0, 0.25]]) {
      const local = new THREE.Vector3(x * L, L * 0.04, z * L);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(L * 0.045, 16, 10), bayMat);
      mesh.position.copy(local);
      mesh.add(this._glow(new THREE.Color(3, 1.4, 0.4), L * 0.25));
      boss.root.add(mesh);
      const t = this._addTarget({ kind: 'bay', radius: L * 0.07, hp: 220 * (1 + 0.5 * cycle), local, boss: true });
      boss.bays.push({ mesh, target: t });
    }
    boss.launchTimer = 6;
  }

  _setupSiege(boss, cycle) {
    const L = boss.length;
    const local = new THREE.Vector3(0, 0, -L * 0.42);
    const core = new THREE.Mesh(new THREE.SphereGeometry(L * 0.06, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.8, 0.5) }));
    core.position.copy(local);
    const glow = this._glow(new THREE.Color(3, 0.9, 0.5), L * 0.35);
    core.add(glow);
    boss.root.add(core);
    boss.core = { mesh: core, glow, target: this._addTarget({ kind: 'core', radius: L * 0.09, local, boss: true }) };
    boss.interruptNeeded = 260 * (1 + 0.5 * cycle);
    boss.interruptDamage = 0;
    boss.state = 'move';
    boss.timer = 8;

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.4, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.4, 0.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    beam.visible = false;
    this.scene.add(beam);
    boss.extras.push(beam);
    boss.beam = beam;

    const marker = new THREE.Mesh(
      new THREE.RingGeometry(8, 10, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.6, 0.3), transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    marker.visible = false;
    this.scene.add(marker);
    boss.extras.push(marker);
    boss.marker = marker;
  }

  // ---------------------------------------------------------------- update

  // ctx: { ship, lasers, enemies, turrets, time, damagePlanet(amount, at), banner(title, sub), audio }
  update(dt, ctx) {
    const b = this.boss;
    if (!b || !b.alive) return;
    const R = CONFIG.planet.radius;

    // Movement: fly in to the standoff orbit, then circle the planet broadside-on.
    const root = b.root;
    const speed = b.type === 'siege' && b.state === 'charge' ? 0 : 9;
    if (b.arriving) {
      const target = _v.set(Math.cos(b.angle) * ORBIT_R, b.height, Math.sin(b.angle) * ORBIT_R);
      const to = _v2.subVectors(target, root.position);
      const d = to.length();
      if (d < 6) b.arriving = false;
      else root.position.addScaledVector(to.normalize(), Math.min(d, 26 * dt));
      this._face(root, target);
    } else {
      b.angle += (speed / ORBIT_R) * dt;
      const next = _v.set(Math.cos(b.angle) * ORBIT_R, b.height, Math.sin(b.angle) * ORBIT_R);
      root.position.lerp(next, 1 - Math.exp(-2 * dt));
      // Face along the orbit (tangent), slowly.
      const ahead = _v2.set(Math.cos(b.angle + 0.2) * ORBIT_R, b.height, Math.sin(b.angle + 0.2) * ORBIT_R);
      this._face(root, ahead, 0.6 * dt);
    }

    this['_update_' + b.type]?.(b, dt, ctx);

    // Broadside volleys at the player (if close) or the planet.
    b.fireTimer -= dt;
    if (b.fireTimer <= 0 && !b.arriving && !b.cloaked) {
      b.fireTimer = b.type === 'phantom' ? 2.2 : 3.4;
      const toPlayer = ctx.ship.alive && ctx.ship.group.position.distanceTo(root.position) < 280;
      const shots = b.type === 'dreadnought' ? 7 : 5;
      for (let i = 0; i < shots; i++) {
        const from = root.localToWorld(_v.set(rand(-0.2, 0.2) * b.length, rand(-0.05, 0.1) * b.length, rand(-0.45, 0.45) * b.length));
        const to = toPlayer
          ? ctx.ship.group.position.clone().add(new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)))
          : root.position.clone().normalize().multiplyScalar(R).add(new THREE.Vector3(rand(-20, 20), rand(-20, 20), rand(-20, 20)));
        const l = ctx.lasers.fire(from.clone(), to, 7);
        l.planetDamage = toPlayer ? 0.03 : 0.35;
      }
    }

    // Keep hit volumes on the hull.
    for (const t of this.targets) {
      if (t.local) root.localToWorld(t.group.position.copy(t.local));
    }

    if (b.flash > 0) {
      b.flash = Math.max(0, b.flash - dt * 5);
      setFlash(b.materials, b.flash * 0.6);
    }
  }

  _face(obj, target, maxStep = Infinity) {
    _m.lookAt(obj.position, target, UP);
    _q.setFromRotationMatrix(_m);
    obj.quaternion.rotateTowards(_q, maxStep);
  }

  _update_dreadnought(b, dt, ctx) {
    let alive = 0;
    for (const d of b.drones) {
      if (!d.target.active) continue;
      alive++;
      d.phase += dt * 0.7;
      const r = b.length * 0.55;
      d.mesh.position.set(Math.cos(d.phase) * r, Math.sin(d.phase * 2) * 8, Math.sin(d.phase) * r).add(b.root.position);
      d.mesh.rotation.y += dt * 2;
      d.target.group.position.copy(d.mesh.position);
      const pos = d.tether.geometry.attributes.position;
      pos.setXYZ(0, d.mesh.position.x, d.mesh.position.y, d.mesh.position.z);
      pos.setXYZ(1, b.root.position.x, b.root.position.y, b.root.position.z);
      pos.needsUpdate = true;
    }
    const shieldUp = alive > 0;
    if (b.shield.visible && !shieldUp) {
      ctx.banner('SHIELD DOWN', 'The Dreadnought is vulnerable · open fire!');
      ctx.audio.explosion(1.6);
    }
    b.shield.visible = shieldUp;
    b.shield.material.uniforms.uFlash.value = Math.max(0, b.shield.material.uniforms.uFlash.value - dt * 3);
    b.status = shieldUp ? `SHIELD ACTIVE · ${alive} drone${alive > 1 ? 's' : ''} powering it` : 'SHIELD DOWN · hull exposed';
  }

  _update_carrier(b, dt, ctx) {
    const bays = b.bays.filter((x) => x.target.active);
    b.launchTimer -= dt;
    if (b.launchTimer <= 0 && bays.length && !b.arriving) {
      b.launchTimer = 9;
      if (ctx.enemies.activeCount < 12) {
        for (const bay of bays) {
          const pos = bay.mesh.getWorldPosition(new THREE.Vector3());
          const e = ctx.enemies.spawn('fighter', pos, b.level);
          e.role = 'hunter';
          this.effects.ring(pos, 10, 0.5);
        }
        ctx.audio.alarm();
      }
    }
    for (const bay of bays) bay.mesh.scale.setScalar(1 + Math.sin(ctx.time * 6) * 0.08);
    b.damageMul = bays.length ? 0.3 : 1;
    b.status = bays.length
      ? `${bays.length} hangar bay${bays.length > 1 ? 's' : ''} active · hull armoured · next launch ${Math.ceil(Math.max(0, b.launchTimer))}s`
      : 'Hangars destroyed · hull exposed';
  }

  _update_siege(b, dt, ctx) {
    const R = CONFIG.planet.radius;
    const core = b.core;
    b.timer -= dt;
    const aim = _v.copy(b.root.position).normalize().multiplyScalar(R);
    if (b.state === 'move') {
      b.damageMul = 0.6;
      core.mesh.scale.setScalar(1);
      b.status = `Repositioning · charge in ${Math.ceil(Math.max(0, b.timer))}s`;
      if (b.timer <= 0 && !b.arriving) {
        b.state = 'charge';
        b.timer = 10;
        b.interruptDamage = 0;
        ctx.banner('PLANET CRACKER CHARGING', 'Shoot the Siege Breaker’s glowing core to interrupt!', { danger: true });
        ctx.audio.alarm();
      }
    } else if (b.state === 'charge') {
      const k = 1 - b.timer / 10;
      core.mesh.scale.setScalar(1 + k * 1.6);
      core.glow.material.color.setRGB(3 + k * 4, 0.9 + k, 0.5);
      b.marker.visible = true;
      b.marker.position.copy(aim).multiplyScalar(1.01);
      b.marker.lookAt(0, 0, 0);
      b.marker.scale.setScalar(1 + Math.sin(ctx.time * 10) * 0.1);
      b.status = `CHARGING ${Math.round(k * 100)}% · core damage ${Math.round((b.interruptDamage / b.interruptNeeded) * 100)}% to interrupt`;
      if (b.interruptDamage >= b.interruptNeeded) {
        b.state = 'stunned';
        b.timer = 5;
        b.marker.visible = false;
        this.effects.explosion(core.mesh.getWorldPosition(new THREE.Vector3()), 10, 0);
        ctx.banner('CHARGE INTERRUPTED', 'The Siege Breaker is stunned · hull takes double damage!');
        ctx.audio.explosion(2);
      } else if (b.timer <= 0) {
        b.state = 'fire';
        b.timer = 1.6;
        b.marker.visible = false;
        ctx.damagePlanet(40, aim.clone());
        this.effects.explosion(aim.clone(), 18, 0);
        ctx.audio.explosion(2.5);
        this.effects.shake = Math.max(this.effects.shake, 1);
        ctx.banner('HOMEWORLD HIT', 'The planet cracker struck the surface', { danger: true });
      }
    } else if (b.state === 'fire') {
      const from = core.mesh.getWorldPosition(new THREE.Vector3());
      const len = from.distanceTo(aim);
      b.beam.visible = true;
      b.beam.position.copy(from).add(aim).multiplyScalar(0.5);
      b.beam.scale.set(1 + Math.random() * 0.4, len, 1 + Math.random() * 0.4);
      b.beam.quaternion.setFromUnitVectors(UP, _v2.subVectors(aim, from).normalize());
      if (b.timer <= 0) {
        b.beam.visible = false;
        b.state = 'move';
        b.timer = 12;
      }
    } else if (b.state === 'stunned') {
      b.damageMul = 2;
      core.mesh.scale.setScalar(0.8);
      core.glow.material.color.setRGB(1, 0.4, 0.3);
      b.status = `STUNNED · double damage for ${Math.ceil(Math.max(0, b.timer))}s`;
      if (b.timer <= 0) {
        b.state = 'move';
        b.timer = 10;
        core.glow.material.color.setRGB(3, 0.9, 0.5);
      }
    }
  }

  _update_phantom(b, dt, ctx) {
    b.timer -= dt;
    const setOpacity = (o) => {
      b.opacity = o;
      for (const m of b.materials) m.opacity = o;
    };
    if (b.state === 'visible') {
      b.status = `Visible · cloaking in ${Math.ceil(Math.max(0, b.timer))}s`;
      if (b.timer <= 0 && !b.arriving) {
        b.state = 'fading';
        b.timer = 1;
      }
    } else if (b.state === 'fading') {
      setOpacity(Math.max(0.06, b.timer));
      if (b.timer <= 0) {
        b.state = 'cloaked';
        b.cloaked = true;
        b.timer = 5;
        for (const t of this.targets) t.active = false;
        // Teleport to another part of the orbit.
        b.angle += rand(1.6, 3.2) * (Math.random() < 0.5 ? -1 : 1);
        b.height = rand(-40, 40);
        b.root.position.set(Math.cos(b.angle) * ORBIT_R, b.height, Math.sin(b.angle) * ORBIT_R);
      }
      b.status = 'CLOAKING…';
    } else if (b.state === 'cloaked') {
      b.status = 'CLOAKED · watch for the EMP when it reappears';
      if (b.timer <= 0) {
        b.state = 'appearing';
        b.timer = 1;
      }
    } else if (b.state === 'appearing') {
      setOpacity(Math.min(1, 1 - b.timer));
      if (b.timer <= 0) {
        setOpacity(1);
        b.state = 'visible';
        b.cloaked = false;
        b.timer = 9;
        for (const t of this.targets) t.active = true;
        // EMP pulse knocks out nearby turrets.
        const knocked = ctx.turrets.emp(b.root.position, 300, 6);
        this.effects.ring(b.root.position.clone(), 300, 1.2);
        ctx.audio.explosion(1.4);
        ctx.banner('EMP BLAST', knocked ? `${knocked} turret${knocked > 1 ? 's' : ''} offline for 6s` : 'Your turrets were out of range', { danger: !!knocked });
      }
    }
  }

  // ---------------------------------------------------------------- damage

  // Returns { absorbed, partDestroyed, bossDestroyed }.
  damage(t, amount) {
    const b = this.boss;
    const res = { absorbed: false, partDestroyed: false, bossDestroyed: false };
    if (!b || !b.alive || !t.active) return res;

    if (t.kind === 'drone' || t.kind === 'bay') {
      t.hp -= amount;
      if (t.hp <= 0) {
        t.active = false;
        res.partDestroyed = true;
        if (t.kind === 'drone') {
          const d = b.drones.find((x) => x.target === t);
          d.mesh.visible = false;
          d.tether.visible = false;
        } else {
          b.bays.find((x) => x.target === t).mesh.visible = false;
        }
      }
      return res;
    }

    let dmg = amount;
    if (t.kind === 'core') {
      if (b.state === 'charge') b.interruptDamage += amount;
      dmg *= 1.5;
    } else if (b.type === 'dreadnought' && b.shield.visible) {
      b.shield.material.uniforms.uFlash.value = 1;
      res.absorbed = true;
      return res;
    } else {
      dmg *= b.damageMul;
    }
    b.hp -= dmg;
    b.flash = 1;
    if (b.hp <= 0) {
      b.hp = 0;
      b.alive = false;
      res.bossDestroyed = true;
      for (const x of this.targets) x.active = false;
    }
    return res;
  }

  // Points along the hull for the death sequence.
  hullPoints(n = 8) {
    const b = this.boss;
    return Array.from({ length: n }, () => b.root.localToWorld(new THREE.Vector3(rand(-0.2, 0.2) * b.length, rand(-0.08, 0.08) * b.length, rand(-0.45, 0.45) * b.length)));
  }
}

function makeShieldMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uFlash: { value: 0 }, uColor: { value: color } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFlash;
      uniform vec3 uColor;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(vN, vV)), 3.0);
        gl_FragColor = vec4(uColor * (rim * 0.45 + uFlash * (0.15 + rim)), 1.0);
      }
    `,
  });
}
