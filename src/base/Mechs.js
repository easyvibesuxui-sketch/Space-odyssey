import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { instantiate, setFlash } from '../core/Models.js';
import { rotateTowards } from './GroundWar.js';
import { HALF_W, BACK, HEIGHT } from './Hangar.js';

const _v = new THREE.Vector3();
const RETURN_AFTER = 12; // seconds a mech may stand around away from its bay
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

// Pilotable mechs. Each has a bay along the hangar walls: a hologram until it's bought at the
// Armory, then the real machine. Walk up and press E to climb in; E again to climb out.
export class Mechs {
  constructor(game) {
    this.game = game;
    this.hangar = game.hangar;
    this.scene = this.hangar.scene;
    this.piloting = null;
    this.list = Object.entries(CONFIG.war.mechs).map(([key, def]) => this._buildBay(key, def));
    this.camPos = new THREE.Vector3();
  }

  get pilotedState() {
    return this.piloting ? this.list.find((m) => m.key === this.piloting) : null;
  }

  _buildBay(key, def) {
    const [bx, bz] = def.bay;
    const bayPos = new THREE.Vector3(bx, 0, bz);
    // Mechs face into the room.
    const bayYaw = bx < 0 ? -Math.PI / 2 : Math.PI / 2;

    // Bay: floor plate with hazard edge, gantry behind, name sign.
    const bay = new THREE.Group();
    bay.position.copy(bayPos);
    bay.rotation.y = bayYaw;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 7), new THREE.MeshStandardMaterial({ color: 0x23282f, metalness: 0.6, roughness: 0.5 }));
    plate.position.y = 0.06;
    bay.add(plate);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.05, 7.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color).multiplyScalar(1.6) }));
    edge.position.y = 0.03;
    bay.add(edge);
    const frame = new THREE.MeshStandardMaterial({ color: 0x3b434e, metalness: 0.7, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8.5, 0.5), frame);
      post.position.set(s * 3.4, 4.25, 3.3);
      bay.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(7.3, 0.6, 0.6), frame);
    beam.position.set(0, 8.4, 3.3);
    bay.add(beam);
    const sign = makeSign(def.name, def.color);
    sign.mesh.position.set(0, 9.3, 3.3);
    sign.mesh.rotation.y = Math.PI; // face the room
    bay.add(sign.mesh);
    this.scene.add(bay);

    // Holder carries the hologram or the real mech, plus the interaction hit box.
    const holder = new THREE.Group();
    holder.position.copy(bayPos);
    holder.rotation.y = bayYaw;
    this.scene.add(holder);
    const model = this.game.assets.models?.[def.model];
    const size = model ? model.size.clone() : new THREE.Vector3(3, 5, 3);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x, 3), size.y, Math.max(size.z, 3)), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = size.y / 2;
    holder.add(hit);
    const state = {
      key,
      def,
      bayPos,
      bayYaw,
      holder,
      hit,
      sign,
      size,
      pos: holder.position,
      yaw: bayYaw,
      owned: false,
      wrecked: false,
      hp: def.hp,
      maxHp: def.hp,
      inst: null,
      ghost: null,
      mixer: null,
      walk: null,
      phase: 0,
      cooldown: 0,
      gun: 0,
      flash: 0,
      moving: false,
      idle: 0,
      returning: false,
      stuck: 0,
    };
    this.hangar.interactables.push({ id: `bay:${key}`, mesh: hit, reach: 9 });
    state.obstacle = { c: holder.position, r: Math.max(size.x, size.z) * 0.32, enabled: false };
    this.hangar.obstacles.push(state.obstacle);
    this._refresh(state);
    return state;
  }

  // Swap between hologram (for sale) and the real mech (owned / wrecked).
  _refresh(m) {
    const model = this.game.assets.models?.[m.def.model];
    if (m.owned && !m.inst) {
      if (m.ghost) m.holder.remove(m.ghost);
      m.ghost = null;
      const inst = model ? instantiate(model, { ownMaterials: true }) : placeholderMech(m.size);
      m.inst = inst;
      m.holder.add(inst.root);
      if (model?.animations?.length) {
        m.mixer = new THREE.AnimationMixer(inst.root);
        const clip = model.animations[0];
        const [a, b] = m.def.walk ?? [0, Math.min(clip.duration, 2)];
        const walk = THREE.AnimationUtils.subclip(clip, 'walk', Math.round(a * 30), Math.round(b * 30), 30);
        m.walk = m.mixer.clipAction(walk);
        m.walk.play();
        m.mixer.update(0.01);
        m.walk.paused = true;
      }
      for (const mat of inst.materials) mat.userData.baseColor = mat.color?.clone();
    }
    if (!m.owned && !m.ghost) {
      // Hologram of the mech for sale.
      const holo = model ? instantiate(model).root : placeholderMech(m.size).root;
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(m.def.color).multiplyScalar(0.55), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
      holo.traverse((o) => {
        if (o.isMesh) o.material = mat;
      });
      m.ghost = holo;
      m.holder.add(holo);
    }
    // Wrecks are dark and smoking until repaired.
    if (m.inst) {
      for (const mat of m.inst.materials) {
        if (!mat.color || !mat.userData.baseColor) continue;
        mat.color.copy(mat.userData.baseColor).multiplyScalar(m.wrecked ? 0.25 : 1);
      }
    }
    m.obstacle.enabled = m.owned && this.piloting !== m.key;
    const status = !m.owned ? `FOR SALE · ${m.def.cost.toLocaleString('en-US')}` : m.wrecked ? 'WRECKED · REPAIR AT ARMORY' : 'READY';
    m.sign.draw(m.def.name, status, m.def.color);
  }

  // ---------------------------------------------------------------- economy / persistence

  buy(key) {
    const m = this.list.find((x) => x.key === key);
    const g = this.game;
    if (!m || m.owned || g.coins < m.def.cost) return false;
    g.coins -= m.def.cost;
    m.owned = true;
    m.wrecked = false;
    m.hp = m.maxHp;
    this._refresh(m);
    return true;
  }

  repairCost(m) {
    return Math.round(m.def.cost * CONFIG.war.repairShare);
  }

  repair(key) {
    const m = this.list.find((x) => x.key === key);
    const g = this.game;
    if (!m || !m.wrecked || g.coins < this.repairCost(m)) return false;
    g.coins -= this.repairCost(m);
    m.wrecked = false;
    m.hp = m.maxHp;
    this._refresh(m);
    return true;
  }

  serialize() {
    return Object.fromEntries(this.list.filter((m) => m.owned).map((m) => [m.key, m.wrecked ? 'wrecked' : 'ok']));
  }

  load(saved = {}) {
    if (this.piloting) this.exit(true);
    for (const m of this.list) {
      const s = saved[m.key];
      if (m.inst && !s) {
        m.holder.remove(m.inst.root);
        m.inst = null;
        m.mixer = null;
        m.walk = null;
      }
      m.owned = !!s;
      m.wrecked = s === 'wrecked';
      m.hp = m.maxHp;
      this._refresh(m);
    }
    this.parkAll();
  }

  // Every mech walks back to its bay (when the player arrives at the base).
  parkAll() {
    for (const m of this.list) {
      m.pos.copy(m.bayPos);
      m.yaw = m.bayYaw;
      m.holder.rotation.set(0, m.bayYaw, 0);
      if (!m.wrecked) m.hp = m.maxHp;
    }
  }

  // ---------------------------------------------------------------- piloting

  enter(key) {
    const m = this.list.find((x) => x.key === key);
    if (!m || !m.owned || m.wrecked) return;
    this.piloting = key;
    m.obstacle.enabled = false;
    m.returning = false;
    m.idle = 0;
    this.hangar.yaw = m.yaw;
    this.hangar.pitch = -0.1;
    this.camPos.copy(this.hangar.camera.position);
    this.game.audio.build();
    document.body.classList.add('mech-mode');
    this.game.baseUI.toast(`${m.def.name} online · WASD walk · mouse aim & fire · E climb out`);
  }

  exit(silent = false) {
    const m = this.pilotedState;
    this.piloting = null;
    document.body.classList.remove('mech-mode');
    if (!m) return;
    m.obstacle.enabled = m.owned;
    m.moving = false;
    m.idle = 0;
    if (m.walk) m.walk.paused = true;
    // Step out beside the mech.
    const side = _v.set(Math.cos(m.yaw), 0, -Math.sin(m.yaw)).multiplyScalar(m.obstacle.r + 1.4);
    this.hangar.pos.set(m.pos.x + side.x, 1.7, m.pos.z + side.z);
    this.hangar.collide(this.hangar.pos, 0.6, true);
    this.hangar.yaw = m.yaw;
    if (!silent) this.game.audio.hit();
  }

  damagePiloted(amount) {
    const m = this.pilotedState;
    if (!m) return;
    m.hp -= amount;
    m.flash = 1;
    if (m.hp > 0) return;
    // Destroyed: blow up, eject the pilot, leave a wreck.
    m.hp = 0;
    m.wrecked = true;
    const war = this.game.war;
    war.effects.explosion(_v.copy(m.pos).setY(m.size.y * 0.5), 3, 0);
    this.game.audio.explosion(1.6);
    this.exit(true);
    this._refresh(m);
    this.game.baseUI.toast(`${m.def.name} destroyed! Repair it at the Armory.`);
  }

  updatePilot(dt, input, canMove) {
    const m = this.pilotedState;
    if (!m) return;
    const k = input.keys;
    let fwd = 0;
    let strafe = 0;
    if (canMove) {
      fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      if (input.joy.id !== null) {
        fwd = input.joy.y;
        strafe = input.joy.x;
      }
    }
    // Body turns towards where the pilot looks (mechs are heavy: limited turn rate).
    m.yaw = rotateTowards(m.yaw, this.hangar.yaw, 2.2 * dt);
    const dir = _v.set(-Math.sin(m.yaw), 0, -Math.cos(m.yaw));
    const right = new THREE.Vector3(Math.cos(m.yaw), 0, -Math.sin(m.yaw));
    const move = new THREE.Vector3().addScaledVector(dir, fwd).addScaledVector(right, strafe * 0.6);
    if (move.lengthSq() > 1) move.normalize();
    const speed = m.def.speed * (k.has('ShiftLeft') ? 1.35 : 1);
    m.pos.addScaledVector(move, speed * dt);
    this.hangar.collide(m.pos, m.obstacle.r, false);
    m.moving = move.lengthSq() > 0.01;
    m.holder.rotation.y = m.yaw;
    // Heavy footsteps shake the camera a little.
    m.phase += dt * (m.moving ? speed * 0.9 : 0);

    // Third-person camera behind and above the cockpit.
    const h = m.size.y;
    const cam = this.hangar.camera;
    const pitch = THREE.MathUtils.clamp(this.hangar.pitch, -0.6, 0.5);
    this.hangar.pitch = pitch;
    const look = new THREE.Vector3(-Math.sin(this.hangar.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.hangar.yaw) * Math.cos(pitch));
    const pivot = new THREE.Vector3(m.pos.x, h * 0.8, m.pos.z);
    const want = pivot.clone().addScaledVector(look, -h * 1.05).add(new THREE.Vector3(0, h * 0.12, 0));
    want.x = THREE.MathUtils.clamp(want.x, -HALF_W + 0.8, HALF_W - 0.8);
    want.z = Math.min(want.z, BACK - 0.6);
    // Stay under the bay gantries and their signs.
    want.y = THREE.MathUtils.clamp(want.y, 1, Math.min(HEIGHT - 0.8, 7.6));
    this.camPos.lerp(want, 1 - Math.exp(-10 * dt));
    cam.position.copy(this.camPos);
    if (m.moving) cam.position.y += Math.abs(Math.sin(m.phase * 2.2)) * 0.06 * h * 0.1;
    cam.lookAt(pivot.clone().addScaledVector(look, 20));
    cam.updateMatrixWorld();
    // The hangar's "player position" follows the mech (enemies, revive range, prompts).
    this.hangar.pos.set(m.pos.x, 1.7, m.pos.z);

    // Weapons.
    m.cooldown -= dt;
    const w = m.def.weapon;
    if (canMove && input.fire && m.cooldown <= 0) {
      m.cooldown = w.interval;
      const war = this.game.war;
      const aim = war.aimPoint(cam);
      const [fx, fy, fz] = m.def.muzzles[m.gun % m.def.muzzles.length];
      m.gun++;
      const from = new THREE.Vector3(fx * m.size.x, fy * m.size.y, fz * m.size.z);
      from.applyQuaternion(_q.setFromAxisAngle(UP, m.yaw)).add(m.pos);
      if (w.kind === 'shell') {
        war.fireShell(from, aim, w.damage, w.splash, w);
        this.game.audio.dash(0.6);
      } else {
        war.fireFriendly(from, aim, w.damage, w);
        this.game.audio.laser(w.interval < 0.15 ? 0.3 : 0.6);
      }
      war.effects.sparks(from, 4, new THREE.Color(...w.color), 5, 0.4, 0.15);
    }
  }

  // A mech left standing somewhere walks back to its bay by itself (wrecks get towed).
  _autoReturn(m, dt) {
    const dx = m.bayPos.x - m.pos.x;
    const dz = m.bayPos.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    const home = d < 0.35;
    if (home && !m.returning) {
      // Parked: settle into the bay's facing.
      m.yaw = rotateTowards(m.yaw, m.bayYaw, 1.5 * dt);
      m.holder.rotation.y = m.yaw;
      m.moving = false;
      m.idle = 0;
      return;
    }
    if (!m.returning) {
      m.idle += dt;
      if (m.idle < RETURN_AFTER) {
        m.moving = false;
        return;
      }
      m.returning = true;
      m.stuck = 0;
    }
    if (m.wrecked || m.stuck > 8) {
      // Towed (or freed when stuck): pop back into the bay.
      this.game.war.effects.sparks(_v.copy(m.pos).setY(1), 14, new THREE.Color(1, 2.5, 4), 6, 0.5, 0.4);
      m.pos.copy(m.bayPos);
      m.yaw = m.bayYaw;
      m.holder.rotation.y = m.yaw;
      m.returning = false;
      m.moving = false;
      return;
    }
    if (home) {
      m.pos.set(m.bayPos.x, 0, m.bayPos.z);
      m.returning = false;
      m.moving = false;
      return;
    }
    const before = _v.copy(m.pos);
    const bx = before.x;
    const bz = before.z;
    const step = Math.min(d, m.def.speed * 0.55 * dt);
    m.yaw = rotateTowards(m.yaw, Math.atan2(-dx, -dz), 2 * dt);
    m.pos.x += (dx / d) * step;
    m.pos.z += (dz / d) * step;
    this.hangar.collide(m.pos, m.obstacle.r * 0.8, false);
    m.holder.rotation.y = m.yaw;
    const progress = Math.hypot(m.pos.x - bx, m.pos.z - bz);
    m.stuck = progress < step * 0.3 ? m.stuck + dt : Math.max(0, m.stuck - dt);
    m.moving = true;
    m.phase += dt * m.def.speed * 0.5;
  }

  // Animation for every mech (walk cycle while moving, procedural sway for static models).
  update(dt) {
    for (const m of this.list) {
      if (!m.inst) continue;
      const piloted = this.piloting === m.key;
      if (!piloted && m.owned) this._autoReturn(m, dt);
      if (m.walk) {
        m.walk.paused = !m.moving;
        m.walk.timeScale = 1.1;
        m.mixer.update(dt);
      } else if (m.moving) {
        // No skeleton: bob and sway the whole body.
        m.inst.root.position.y = Math.abs(Math.sin(m.phase * 2.2)) * 0.12;
        m.inst.root.rotation.z = Math.sin(m.phase * 2.2) * 0.03;
      } else {
        m.inst.root.position.y = 0;
        m.inst.root.rotation.z = 0;
      }
      if (m.flash > 0) {
        m.flash = Math.max(0, m.flash - dt * 6);
        setFlash(m.inst.materials, m.flash * 0.6);
      }
      if (m.wrecked && Math.random() < dt * 8) {
        this.game.war.effects.emit(_v.set(m.pos.x + (Math.random() - 0.5) * 2, m.size.y * 0.7, m.pos.z + (Math.random() - 0.5) * 2), new THREE.Vector3(0, 2.5, 0), new THREE.Color(0.3, 0.3, 0.33), 1.6, 1.6, 0.6);
      }
    }
  }
}

function placeholderMech(size) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x77808c, metalness: 0.6, roughness: 0.4, emissive: 0x000000 });
  mat.userData.baseEmissive = new THREE.Color();
  const body = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.8, size.y * 0.4, size.z * 0.6), mat);
  body.position.y = size.y * 0.7;
  root.add(body);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.18, size.y * 0.55, size.z * 0.25), mat);
    leg.position.set(s * size.x * 0.25, size.y * 0.27, 0);
    root.add(leg);
  }
  return { root, materials: [mat] };
}

// Small canvas sign above each bay.
function makeSign(title, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide }));
  const sign = {
    mesh,
    draw(name, status, c = color) {
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, 512, 128);
      g.fillStyle = 'rgba(4, 16, 32, 0.85)';
      g.fillRect(0, 0, 512, 128);
      g.strokeStyle = c;
      g.lineWidth = 5;
      g.strokeRect(4, 4, 504, 120);
      g.fillStyle = c;
      g.font = 'bold 40px Orbitron, sans-serif';
      g.textAlign = 'center';
      g.fillText(name.toUpperCase(), 256, 56);
      g.fillStyle = '#dff6ff';
      g.font = '30px Rajdhani, sans-serif';
      g.fillText(status, 256, 100);
      texture.needsUpdate = true;
    },
  };
  sign.draw(title, '', color);
  return sign;
}
