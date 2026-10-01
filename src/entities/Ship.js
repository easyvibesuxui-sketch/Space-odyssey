import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Placeholder starfighter built from primitives. The whole thing lives in `this.model`
// so it can be swapped for a GLB later without touching gameplay code.
export class Ship {
  constructor(scene) {
    this.group = new THREE.Group();
    this.model = buildShipModel();
    this.group.add(this.model.root);
    scene.add(this.group);

    this.velocity = new THREE.Vector3();
    this.hull = CONFIG.ship.hull;
    this.shield = CONFIG.ship.shield;
    this.sinceHit = 99;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashDir = new THREE.Vector2();
    this.rollExtra = 0;
    this.invulnerable = 0;
    this.gunIndex = 0;
    this.radius = 2.4;
    this.alive = true;

    this.shieldMesh = makeShieldBubble();
    this.group.add(this.shieldMesh);
    this.shieldFlash = 0;

    this._tmp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
  }

  reset() {
    this.group.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.hull = CONFIG.ship.hull;
    this.shield = CONFIG.ship.shield;
    this.sinceHit = 99;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.invulnerable = 0;
    this.alive = true;
    this.group.visible = true;
  }

  get dashReady() {
    return this.dashCooldown <= 0;
  }

  tryDash(move) {
    if (!this.dashReady) return false;
    const dir = new THREE.Vector2(move.x, move.y);
    if (dir.lengthSq() < 0.01) dir.set(this.velocity.x >= 0 ? 1 : -1, 0);
    dir.normalize();
    this.dashDir.copy(dir);
    this.dashTimer = CONFIG.ship.dashTime;
    this.dashCooldown = CONFIG.ship.dashCooldown;
    this.invulnerable = CONFIG.ship.dashTime + 0.1;
    // Barrel roll in the direction of the dash.
    this.rollExtra = (dir.x >= 0 ? -1 : 1) * Math.PI * 2;
    return true;
  }

  update(dt, move, aimPoint, time) {
    const cfg = CONFIG.ship;
    const p = this.group.position;
    const v = this.velocity;

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      v.x = this.dashDir.x * cfg.dashSpeed;
      v.y = this.dashDir.y * cfg.dashSpeed;
    } else {
      v.x += move.x * cfg.accel * dt;
      v.y += move.y * cfg.accel * dt;
      const damp = Math.exp(-cfg.damping * dt);
      if (Math.abs(move.x) < 0.05) v.x *= damp;
      if (Math.abs(move.y) < 0.05) v.y *= damp;
      const sp = Math.hypot(v.x, v.y);
      if (sp > cfg.maxSpeed) {
        v.x *= cfg.maxSpeed / sp;
        v.y *= cfg.maxSpeed / sp;
      }
    }
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);

    p.x += v.x * dt;
    p.y += v.y * dt;
    const { x: bx, y: by } = CONFIG.bounds;
    if (Math.abs(p.x) > bx) {
      p.x = Math.sign(p.x) * bx;
      v.x *= -0.2;
    }
    if (Math.abs(p.y) > by) {
      p.y = Math.sign(p.y) * by;
      v.y *= -0.2;
    }

    // Face the aim point (partially), then bank with lateral velocity.
    this._m.lookAt(p, aimPoint, THREE.Object3D.DEFAULT_UP);
    this._q.setFromRotationMatrix(this._m);
    const ident = new THREE.Quaternion();
    this._q.slerp(ident, 0.45);
    this.group.quaternion.slerp(this._q, 1 - Math.exp(-10 * dt));

    const bank = -v.x * 0.022;
    this.rollExtra *= Math.exp(-7 * dt);
    const pitch = v.y * 0.008;
    this.model.root.rotation.z = THREE.MathUtils.lerp(this.model.root.rotation.z, bank, 1 - Math.exp(-8 * dt));
    this.model.roll.rotation.z = this.rollExtra;
    this.model.root.rotation.x = THREE.MathUtils.lerp(this.model.root.rotation.x, pitch, 1 - Math.exp(-8 * dt));

    // Shields regenerate after a short delay.
    this.sinceHit += dt;
    if (this.sinceHit > cfg.shieldRegenDelay) {
      this.shield = Math.min(cfg.shield, this.shield + cfg.shieldRegenRate * dt);
    }

    // Engines: flicker + longer trails while dashing.
    const boost = this.dashTimer > 0 ? 2.2 : 1 + Math.max(0, -move.y) * 0.1;
    for (let i = 0; i < this.model.trails.length; i++) {
      const tr = this.model.trails[i];
      const flick = 0.9 + Math.sin(time * 40 + i * 1.7) * 0.06 + Math.random() * 0.06;
      tr.scale.set(flick, flick, boost * (0.95 + Math.random() * 0.1));
      this.model.glows[i].scale.setScalar(1.1 * flick * (boost > 1.5 ? 1.4 : 1));
    }

    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
    this.shieldMesh.material.uniforms.uStrength.value = this.shieldFlash;
    this.shieldMesh.visible = this.shieldFlash > 0.01;
  }

  // Returns muzzle world position (alternates between the two guns).
  nextMuzzle(out) {
    const g = this.model.guns[this.gunIndex];
    this.gunIndex = (this.gunIndex + 1) % this.model.guns.length;
    return g.getWorldPosition(out);
  }

  // Returns true if the ship was destroyed.
  takeDamage(amount) {
    if (this.invulnerable > 0 || !this.alive) return false;
    this.sinceHit = 0;
    const absorbed = Math.min(this.shield, amount);
    this.shield -= absorbed;
    this.hull -= amount - absorbed;
    if (absorbed > 0) this.shieldFlash = 1;
    this.invulnerable = 0.25;
    if (this.hull <= 0) {
      this.hull = 0;
      this.alive = false;
      return true;
    }
    return false;
  }
}

function buildShipModel() {
  const root = new THREE.Group();
  const roll = new THREE.Group();
  root.add(roll);

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x7f8792, metalness: 0.55, roughness: 0.45 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, metalness: 0.4, roughness: 0.55 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.6, roughness: 0.55 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xd7cf9c, metalness: 0.35, roughness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0c1a2a, metalness: 0.9, roughness: 0.15, emissive: 0x0a2a48 });
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.7, 2.2) });
  const engineGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.6, 4) });

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
      color: new THREE.Color(0.9, 1.8, 3.6),
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
  return { root, roll, guns, trails, glows };
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
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(vN, vV)), 1.5);
        float fade = pow(1.0 - clamp(vT, 0.0, 1.0), 1.6);
        vec3 col = mix(vec3(0.15, 0.6, 2.0), vec3(1.2, 1.8, 3.0), edge * (1.0 - vT));
        gl_FragColor = vec4(col * edge * fade * 0.8, 1.0);
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
