import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { instantiate } from '../core/Models.js';
import { ShipMods } from './ShipMods.js';

// The player's starfighter: the COLAID1 GLB when loaded, otherwise a primitive placeholder.
// Either way the visual lives in `this.model` with the same shape (root/roll/guns/trails/glows).
//
// Flight model: arcade 6-DOF. The ship always flies forward (-Z); stick input sets pitch/yaw
// rates, A/D roll, W/S throttle, boost burns energy. It slowly auto-levels to the planet's
// equator plane so the player never gets lost upside down.
export class Ship {
  constructor(scene, models = {}) {
    this.group = new THREE.Group();
    this.model = makePlayerModel(models);
    this.group.add(this.model.root);
    scene.add(this.group);

    this.velocity = new THREE.Vector3();
    this.speed = CONFIG.ship.speed;
    this.angVel = new THREE.Vector3();
    this.radius = 2.4;
    this.gunIndex = 0;

    this.shieldMesh = makeShieldBubble();
    this.group.add(this.shieldMesh);
    this.shieldFlash = 0;

    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this.reset();
  }

  reset() {
    // Start where the planet is half-lit and the sun is just off to the side.
    this.group.position.set(284, 45, 142);
    this.group.lookAt(0, 0, 0);
    this.group.rotateY(Math.PI); // model faces -Z, lookAt points +Z
    this.velocity.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.speed = CONFIG.ship.speed;
    this.hull = CONFIG.ship.hull;
    this.shield = CONFIG.ship.shield;
    this.boost = CONFIG.ship.boostMax;
    this.boosting = false;
    this.sinceHit = 99;
    this.invulnerable = 2;
    this.alive = true;
    this.group.visible = true;
  }

  get forward() {
    return this._v.set(0, 0, -1).applyQuaternion(this.group.quaternion);
  }

  // controls: { pitch, yaw, roll, throttle, boost } with axes in [-1, 1]
  update(dt, controls, time) {
    const cfg = CONFIG.ship;
    const g = this.group;

    // Smooth angular velocity towards the stick for a weighty feel.
    const k = 1 - Math.exp(-7 * dt);
    this.angVel.x += (controls.pitch * cfg.turnRate - this.angVel.x) * k;
    this.angVel.y += (controls.yaw * cfg.turnRate - this.angVel.y) * k;
    this.angVel.z += (controls.roll * cfg.rollRate - this.angVel.z) * k;

    this._e.set(this.angVel.x * dt, -this.angVel.y * dt, this.angVel.z * dt, 'YXZ');
    this._q.setFromEuler(this._e);
    g.quaternion.multiply(this._q);

    // Auto-level: roll so the wings stay parallel to the world horizon when not rolling.
    if (Math.abs(controls.roll) < 0.1) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(g.quaternion);
      if (Math.abs(fwd.y) < 0.85) {
        const tilt = right.y; // >0 => right wing up
        this._q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -tilt * 1.6 * dt);
        g.quaternion.multiply(this._q);
      }
    }
    g.quaternion.normalize();

    // Throttle and boost.
    this.boosting = controls.boost && this.boost > 0;
    let target = cfg.speed + controls.throttle * (controls.throttle > 0 ? cfg.maxSpeed - cfg.speed : cfg.speed - cfg.minSpeed);
    if (this.boosting) {
      target = cfg.boostSpeed;
      this.boost = Math.max(0, this.boost - cfg.boostDrain * dt);
    } else {
      this.boost = Math.min(cfg.boostMax, this.boost + cfg.boostRegen * dt);
    }
    // Turbo kicks in hard; easing off is gentler.
    this.speed += (target - this.speed) * (1 - Math.exp((this.boosting ? -4 : -2) * dt));

    this.velocity.copy(this.forward).multiplyScalar(this.speed);
    g.position.addScaledVector(this.velocity, dt);

    // Visual banking into turns (model only, doesn't affect flight).
    const roll = this.model.roll;
    roll.rotation.z += (-this.angVel.y * 0.35 - roll.rotation.z) * (1 - Math.exp(-6 * dt));
    roll.rotation.x += (this.angVel.x * 0.06 - roll.rotation.x) * (1 - Math.exp(-6 * dt));

    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.sinceHit += dt;
    if (this.sinceHit > cfg.shieldRegenDelay) {
      this.shield = Math.min(cfg.shield, this.shield + cfg.shieldRegenRate * dt);
    }

    // Engines: trail length follows speed.
    const thrust = THREE.MathUtils.clamp((this.speed - cfg.minSpeed) / (cfg.boostSpeed - cfg.minSpeed), 0, 1);
    // Engine Tuning makes the flames visibly longer, wider and hotter.
    const mods = this.model.mods;
    const eng = mods.engine;
    const len = (0.35 + thrust * 1.5) * (1 + eng * 0.08);
    const wide = 1 + eng * 0.06;
    for (let i = 0; i < this.model.trails.length; i++) {
      const flick = (0.9 + Math.sin(time * 40 + i * 1.7) * 0.06 + Math.random() * 0.06) * wide;
      this.model.trails[i].scale.set(flick, flick, len * (0.95 + Math.random() * 0.1));
      this.model.glows[i].scale.setScalar((this.model.glows[i].userData.base ?? 1.1) * flick * (1 + eng * 0.03) * (this.boosting ? 1.5 : 1));
    }
    mods.update(dt, time);
    mods.settle(dt);

    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
    this.shieldMesh.material.uniforms.uStrength.value = this.shieldFlash;
    this.shieldMesh.visible = this.shieldFlash > 0.01;
  }

  // Returns muzzle world position (alternates between the two guns).
  nextMuzzle(out) {
    this.gunIndex %= this.model.guns.length;
    const gun = this.model.guns[this.gunIndex];
    this.gunIndex = (this.gunIndex + 1) % this.model.guns.length;
    this.model.mods.kick();
    return gun.getWorldPosition(out);
  }

  // Returns true if the ship was destroyed.
  takeDamage(amount) {
    if (this.invulnerable > 0 || !this.alive) return false;
    this.sinceHit = 0;
    const absorbed = Math.min(this.shield, amount);
    this.shield -= absorbed;
    this.hull -= amount - absorbed;
    if (absorbed > 0) this.shieldFlash = 1;
    if (this.hull <= 0) {
      this.hull = 0;
      this.alive = false;
      return true;
    }
    return false;
  }
}

export function makePlayerModel(models = {}) {
  const model = models.player ? buildShipFromGLB(models.player) : buildShipModel();
  model.mods = new ShipMods(model);
  return model;
}

// GLB ship + engine flames on its four rear nozzles + two gun muzzles at the nose.
function buildShipFromGLB(model) {
  const root = new THREE.Group();
  const roll = new THREE.Group();
  root.add(roll);
  const hull = instantiate(model).root;
  roll.add(hull);

  const { x: W, y: H, z: L } = model.size;
  const rearZ = L / 2 - 0.25;
  const glowTex = makeGlowTexture();
  const trailMat = makeTrailMaterial();
  const trails = [];
  const glows = [];
  for (const [fx, big] of [[-0.21, true], [-0.08, false], [0.08, false], [0.21, true]]) {
    const x = fx * W;
    const y = H * 0.04;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: new THREE.Color(0.5, 1.1, 2.4),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    glow.position.set(x, y, rearZ + 0.1);
    glow.userData.base = big ? 1.0 : 0.7;
    roll.add(glow);
    glows.push(glow);

    const holder = new THREE.Group();
    holder.position.set(x, y, rearZ);
    holder.scale.setScalar(big ? 0.65 : 0.45);
    const trail = new THREE.Mesh(makeTrailGeometry(), trailMat);
    holder.add(trail);
    roll.add(holder);
    trails.push(trail);
  }

  const guns = [];
  for (const s of [-1, 1]) {
    const muzzle = new THREE.Object3D();
    muzzle.position.set(s * W * 0.16, -H * 0.15, -L * 0.42);
    roll.add(muzzle);
    guns.push(muzzle);
  }
  return { root, roll, guns, trails, glows, hull, source: model, size: model.size, trailMat };
}

export function buildShipModel() {
  const root = new THREE.Group();
  const roll = new THREE.Group();
  root.add(roll);

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x7f8792, metalness: 0.55, roughness: 0.45 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, metalness: 0.4, roughness: 0.55 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.6, roughness: 0.55 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xd7cf9c, metalness: 0.35, roughness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0c1a2a, metalness: 0.9, roughness: 0.15, emissive: 0x0a2a48 });
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.7, 2.2) });
  const engineGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.8, 2.0) });

  const extrudeTop = (pts, depth, mat, bevel = 0.08) => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
    });
    // Shape (x, y) -> world (x, height, -y), so +y in the shape points to the nose.
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  };

  // Main hull: wide arrow-head, flat.
  const hull = extrudeTop([[0, 4.2], [1.3, 3.4], [2.5, 0.2], [2.7, -2.6], [-2.7, -2.6], [-2.5, 0.2], [-1.3, 3.4]], 0.7, hullMat);
  hull.position.y = -0.35;
  roll.add(hull);

  // Raised upper deck panels.
  const deck = extrudeTop([[0, 3.2], [0.9, 2.5], [1.8, -0.2], [1.9, -2.4], [-1.9, -2.4], [-1.8, -0.2], [-0.9, 2.5]], 0.35, panelMat, 0.05);
  deck.position.y = 0.38;
  roll.add(deck);

  // Panel seams (dark grooves) running front to back.
  for (const x of [-1.2, -0.4, 0.4, 1.2]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 4.2), darkMat);
    seam.position.set(x, 0.82, -0.4);
    roll.add(seam);
  }

  // Lit edge strips like in the reference.
  for (const s of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 2.6), lightMat);
    strip.position.set(s * 1.6, 0.85, 0.6);
    strip.rotation.y = s * 0.18;
    roll.add(strip);
  }

  // Cockpit / bridge tower.
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 1.6), darkMat);
  bridge.position.set(0, 1.0, -1.0);
  roll.add(bridge);
  const bridgeTop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.45, 8), hullMat);
  bridgeTop.position.set(0, 1.5, -1.1);
  roll.add(bridgeTop);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.1), glassMat);
  glass.position.set(0, 1.12, -1.82);
  roll.add(glass);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1.6, 6), darkMat);
  antenna.position.set(0, 2.4, -1.2);
  roll.add(antenna);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.6, 0.5) }));
  beacon.position.set(0, 3.2, -1.2);
  roll.add(beacon);

  // Swept wings with pale accent tips.
  for (const s of [-1, 1]) {
    const wing = extrudeTop([[0, 0.9], [2.8 * s, -0.6], [3.3 * s, -1.6], [0, -1.4]], 0.18, hullMat, 0.04);
    wing.position.set(2.3 * s, -0.15, 0.4);
    roll.add(wing);
    const tip = extrudeTop([[0, 0.2], [1.1 * s, -0.4], [1.3 * s, -0.95], [0, -0.7]], 0.2, accentMat, 0.03);
    tip.position.set(2.3 * s + 2.1 * s, -0.12, 0.85);
    roll.add(tip);
  }

  // Guns under the nose sides.
  const guns = [];
  for (const s of [-1, 1]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.6, 8), darkMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(1.15 * s, -0.25, -2.4);
    roll.add(barrel);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(1.15 * s, -0.25, -3.3);
    roll.add(muzzle);
    guns.push(muzzle);
  }

  // Four engines across the back, each with a glowing nozzle and a long trail.
  const trails = [];
  const glows = [];
  const glowTex = makeGlowTexture();
  const trailMat = makeTrailMaterial();
  const engineXs = [-1.65, -0.55, 0.55, 1.65];
  for (const x of engineXs) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.62, 0.9), darkMat);
    housing.position.set(x, 0.0, 2.75);
    roll.add(housing);
    const nozzle = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.36, 0.08), engineGlowMat);
    nozzle.position.set(x, 0.0, 3.22);
    roll.add(nozzle);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color: new THREE.Color(0.5, 1.1, 2.4),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    glow.position.set(x, 0, 3.35);
    glow.scale.setScalar(1.1);
    roll.add(glow);
    glows.push(glow);

    const trail = new THREE.Mesh(makeTrailGeometry(), trailMat);
    trail.position.set(x, 0, 3.25);
    roll.add(trail);
    trails.push(trail);
  }

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
  root.scale.setScalar(0.75);
  return { root, roll, guns, trails, glows, hull: null, size: new THREE.Vector3(11, 1.5, 7.5), trailMat };
}

function makeTrailGeometry() {
  // Tapered beam pointing +Z (behind the ship), length 1 => scaled per-frame.
  const geo = new THREE.CylinderGeometry(0.08, 0.17, 11, 10, 1, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, 5.5);
  return geo;
}

function makeTrailMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uPower: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vT = position.z / 11.0;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uPower;
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(vN, vV)), 1.5);
        float fade = pow(1.0 - clamp(vT, 0.0, 1.0), 1.6 - uPower * 0.5);
        vec3 col = mix(vec3(0.15, 0.6, 2.0), vec3(1.2, 1.8, 3.0), edge * (1.0 - vT));
        // Tuned engines burn hotter: a white-cyan core.
        col = mix(col, vec3(1.0, 2.0, 3.2), uPower * 0.5 * edge);
        gl_FragColor = vec4(col * edge * fade * (0.8 + uPower * 0.25), 1.0);
      }
    `,
  });
}

function makeGlowTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(140,210,255,0.6)');
  grad.addColorStop(1, 'rgba(0,80,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeShieldBubble() {
  const geo = new THREE.SphereGeometry(3.6, 32, 20);
  geo.scale(1, 0.55, 1.2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uStrength: { value: 0 } },
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
      uniform float uStrength;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
        gl_FragColor = vec4(vec3(0.4, 1.4, 3.0) * f * uStrength, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  return mesh;
}
