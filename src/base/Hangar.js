import * as THREE from 'three';
import { Sky } from '../world/Sky.js';
import { makePlayerModel } from '../entities/Ship.js';
import { instantiate } from '../core/Models.js';

// Room layout (metres). The front (z = FRONT) is open to space.
const HALF_W = 24;
const FRONT = -30;
const BACK = 18;
const HEIGHT = 14;
const EYE = 1.7;
const PAD = new THREE.Vector3(0, 0, -8);
const TERMINAL = new THREE.Vector3(-11, 0, 3);
const CARGO = new THREE.Vector3(11, 0, 3);

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();

// Home base: a first-person walkable hangar with the player's ship and interactive stations.
export class Hangar {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 5000);
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.bob = 0;
    this.locked = false;
    this.lookDrag = null;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 9;
    this.interactables = [];
    this.target = null;
    this.time = 0;

    this.scene.environment = game.scene.environment;
    this.scene.environmentIntensity = 0.2;

    this._buildRoom();
    this._buildLights();
    this._buildPadAndShip();
    this._buildTerminal();
    this._buildCargo();
    this._buildOutside();
    this._buildCorridor();
    this._bindLook(game.canvas);
  }

  // ---------------------------------------------------------------- build

  _buildRoom() {
    const wallTex = panelTexture('#2a3038', '#20252c', '#3a424c', 4);
    wallTex.repeat.set(6, 2);
    const floorTex = panelTexture('#30363e', '#262b32', '#454d58', 8);
    floorTex.repeat.set(6, 6);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, metalness: 0.5, roughness: 0.6 });
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, metalness: 0.55, roughness: 0.45 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.4, roughness: 0.8 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b434e, metalness: 0.7, roughness: 0.4 });
    const depth = BACK - FRONT;
    const midZ = (BACK + FRONT) / 2;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, depth), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, midZ);
    this.scene.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, depth), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, HEIGHT, midZ);
    this.scene.add(ceil);

    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(depth, HEIGHT), wallMat);
      wall.rotation.y = -s * Math.PI / 2;
      wall.position.set(s * HALF_W, HEIGHT / 2, midZ);
      this.scene.add(wall);
    }
    // Back wall, with a doorway into the entrance corridor when the corridor model is loaded.
    const corridor = this.game.assets.models?.corridor;
    this.corridorLen = corridor ? corridor.size.z : 0;
    const doorW = corridor ? corridor.size.x : 0;
    const doorH = corridor ? corridor.size.y : 0;
    const wallPiece = (w, h, x, y) => {
      const geo = new THREE.PlaneGeometry(w, h);
      // Keep the panel texture scale consistent across pieces.
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / (HALF_W * 2)), uv.getY(i) * (h / HEIGHT));
      const m = new THREE.Mesh(geo, wallMat);
      m.position.set(x, y, BACK);
      m.rotation.y = Math.PI;
      this.scene.add(m);
    };
    if (corridor) {
      const side = HALF_W - doorW / 2;
      wallPiece(side, HEIGHT, -(doorW / 2 + side / 2), HEIGHT / 2);
      wallPiece(side, HEIGHT, doorW / 2 + side / 2, HEIGHT / 2);
      wallPiece(doorW, HEIGHT - doorH, 0, doorH + (HEIGHT - doorH) / 2);
    } else {
      wallPiece(HALF_W * 2, HEIGHT, 0, HEIGHT / 2);
    }

    // Structural ribs along the walls and ceiling.
    for (let z = FRONT + 4; z < BACK; z += 8) {
      for (const s of [-1, 1]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(1.2, HEIGHT, 1.2), frameMat);
        rib.position.set(s * (HALF_W - 0.6), HEIGHT / 2, z);
        this.scene.add(rib);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, 0.9, 1.2), frameMat);
      beam.position.set(0, HEIGHT - 0.45, z);
      this.scene.add(beam);
    }

    // Hangar mouth frame.
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, 2, 2), frameMat);
    lintel.position.set(0, HEIGHT - 1, FRONT);
    this.scene.add(lintel);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(2, HEIGHT, 2), frameMat);
      post.position.set(s * (HALF_W - 1), HEIGHT / 2, FRONT);
      this.scene.add(post);
    }
    // Floor lip with warning stripes at the open edge.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, 0.5, 1.6), new THREE.MeshStandardMaterial({ map: stripeTexture(), metalness: 0.3, roughness: 0.6 }));
    lip.position.set(0, 0.25, FRONT + 0.8);
    this.scene.add(lip);

    // Atmospheric force field across the opening.
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_W * 2 - 4, HEIGHT - 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float edge = pow(max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0, 6.0);
            float scan = 0.5 + 0.5 * sin(vUv.y * 120.0 - uTime * 3.0);
            float a = 0.006 + edge * 0.2 + scan * 0.004;
            gl_FragColor = vec4(vec3(0.3, 0.8, 1.6) * a, 1.0);
          }`,
      })
    );
    field.position.set(0, (HEIGHT - 2) / 2, FRONT);
    this.field = field;
    this.scene.add(field);

    // Glowing guide lines on the floor leading out to space.
    const guideMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.9, 1.5) });
    for (const x of [-4.5, 4.5]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 18), guideMat);
      line.position.set(x, 0.02, FRONT + 9.5);
      this.scene.add(line);
    }
    for (const x of [-16, 16]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, depth - 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.65, 0.2) }));
      line.position.set(x, 0.02, midZ);
      this.scene.add(line);
    }
  }

  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x5a7aa0, 0x0e1014, 0.35));
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.15, 1.25, 1.45) });
    for (const x of [-12, 0, 12]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, BACK - FRONT - 6), stripMat);
      strip.position.set(x, HEIGHT - 1.0, (BACK + FRONT) / 2 + 1);
      this.scene.add(strip);
    }
    for (const [x, z] of [[-12, -16], [12, -16], [-12, 6], [12, 6]]) {
      const l = new THREE.PointLight(0xcfdcf5, 90, 40, 2);
      l.position.set(x, HEIGHT - 2, z);
      this.scene.add(l);
    }
    const spot = new THREE.SpotLight(0xffffff, 520, 40, 0.5, 0.6, 2);
    spot.position.set(0, HEIGHT - 1.5, PAD.z + 4);
    spot.target.position.copy(PAD);
    this.scene.add(spot, spot.target);
    // Cool light spilling in from space.
    const outside = new THREE.DirectionalLight(0x9ec8ff, 0.8);
    outside.position.set(0.3, 0.4, -1);
    this.scene.add(outside);
  }

  _buildPadAndShip() {
    const padMat = new THREE.MeshStandardMaterial({ color: 0x22272e, metalness: 0.6, roughness: 0.5 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.4, 0.3, 48), padMat);
    pad.position.set(PAD.x, 0.15, PAD.z);
    this.scene.add(pad);
    const hazard = new THREE.Mesh(new THREE.RingGeometry(7.4, 8.6, 64), new THREE.MeshStandardMaterial({ map: stripeTexture(true), metalness: 0.3, roughness: 0.6 }));
    hazard.rotation.x = -Math.PI / 2;
    hazard.position.set(PAD.x, 0.31, PAD.z);
    this.scene.add(hazard);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8.9, 0.08, 6, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.2, 2.0) }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(PAD.x, 0.32, PAD.z);
    this.scene.add(ring);

    const model = makePlayerModel(this.game.assets.models);
    const isGLB = !!this.game.assets.models?.player;
    const holder = new THREE.Group();
    holder.add(model.root);
    holder.scale.setScalar(isGLB ? 2.8 : 3.6);
    holder.position.set(PAD.x, 3.0, PAD.z);
    this.scene.add(holder);
    for (const t of model.trails) t.scale.set(0.8, 0.8, 0.12);
    this.ship = { holder, model };

    // Landing struts.
    const strutMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.7, roughness: 0.4 });
    for (const [x, z] of [[-3.5, -3], [3.5, -3], [0, 5]]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 2.2, 8), strutMat);
      strut.position.set(PAD.x + x, 1.4, PAD.z + z);
      this.scene.add(strut);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.15, 12), strutMat);
      foot.position.set(PAD.x + x, 0.38, PAD.z + z);
      this.scene.add(foot);
    }

    const hit = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 14), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(PAD.x, 3, PAD.z);
    this.scene.add(hit);
    this.interactables.push({ id: 'launch', mesh: hit, reach: 13 });
  }

  _buildTerminal() {
    const g = new THREE.Group();
    g.position.copy(TERMINAL);
    g.rotation.y = Math.PI / 2 - 0.35; // face the room centre
    this.scene.add(g);
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a525e, metalness: 0.7, roughness: 0.35 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1.2), metal);
    base.position.y = 0.55;
    g.add(base);
    this.terminalScreen = new ScreenTexture('SHIP SYSTEMS', 'Upgrades & repairs', '#4fd8ff');
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), new THREE.MeshBasicMaterial({ map: this.terminalScreen.texture, toneMapped: false }));
    screen.position.set(0, 1.55, 0.2);
    screen.rotation.x = -0.45;
    g.add(screen);
    // Holographic projector + spinning wireframe ship.
    const projector = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.2, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 3.2) }));
    projector.position.set(0, 1.15, -0.35);
    g.add(projector);
    const playerGLB = this.game.assets.models?.player;
    const holoMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.25, 1.0, 1.7),
      wireframe: !playerGLB, // the GLB is too dense for a readable wireframe
      transparent: true,
      opacity: playerGLB ? 0.35 : 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const holo = makePlayerModel(this.game.assets.models);
    holo.root.traverse((o) => {
      if (o.isMesh) o.material = holoMat;
      if (o.isSprite) o.visible = false;
    });
    for (const t of holo.trails) t.visible = false;
    holo.root.scale.setScalar(playerGLB ? 0.26 : 0.32);
    holo.root.position.set(0, 2.35, -0.35);
    g.add(holo.root);
    this.holo = holo.root;

    const hit = new THREE.Mesh(new THREE.BoxGeometry(3, 3.5, 2.5), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1.5;
    g.add(hit);
    this.interactables.push({ id: 'upgrade', mesh: hit, reach: 6 });
  }

  _buildCargo() {
    const g = new THREE.Group();
    g.position.copy(CARGO);
    g.rotation.y = -Math.PI / 2 + 0.35;
    this.scene.add(g);
    const crateTex = crateTexture();
    const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, metalness: 0.4, roughness: 0.55 });
    const stripe = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.7, 0.18) });
    this.crates = [];
    const spots = [[-1.9, 0, 1.2], [0, 0, 1.2], [1.9, 0, 1.2], [-1, 1, 1.2], [1, 1, 1.2], [0, 2, 1.2], [-1.9, 0, -0.8], [1.9, 0, -0.8]];
    for (const [x, layer, z] of spots) {
      const crate = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), crateMat);
      crate.add(box);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.12, 1.74), stripe);
      crate.add(band);
      crate.position.set(x, 0.85 + layer * 1.72, z);
      crate.rotation.y = (Math.random() - 0.5) * 0.2;
      g.add(crate);
      this.crates.push(crate);
    }
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a525e, metalness: 0.7, roughness: 0.35 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.3, 0.8), metal);
    post.position.set(3.6, 0.65, 1.6);
    g.add(post);
    this.cargoScreen = new ScreenTexture('CARGO BAY', 'Unload level rewards', '#ffc94a');
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.85), new THREE.MeshBasicMaterial({ map: this.cargoScreen.texture, toneMapped: false }));
    screen.position.set(3.6, 1.65, 1.8);
    screen.rotation.x = -0.35;
    g.add(screen);

    const hit = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 4), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(0.8, 2, 0.6);
    g.add(hit);
    this.interactables.push({ id: 'cargo', mesh: hit, reach: 7 });
  }

  _buildOutside() {
    this.sky = new Sky(this.scene);
    // The homeworld seen from orbit, sharing the live planet's materials (so damage shows).
    const planet = this.game.planet;
    const view = new THREE.Group();
    for (const m of [planet.surface, planet.clouds, planet.atmosphere]) view.add(new THREE.Mesh(m.geometry, m.material));
    view.position.set(-70, -22, -460);
    this.scene.add(view);
    this.planetView = view;
  }

  _buildCorridor() {
    const model = this.game.assets.models?.corridor;
    if (!model) return;
    const { root } = instantiate(model);
    // The model has sliding doors at both ends: remove them (the hangar end is open)
    // and seal the far end with an airlock bulkhead instead.
    root.traverse((o) => {
      if (o.isMesh && /Doorway_door/i.test(o.name)) o.visible = false;
    });
    root.position.set(0, 0, BACK + model.size.z / 2);
    this.scene.add(root);

    // The model only has its left wall (it's meant to be mirrored): add a mirrored copy
    // that keeps just the wall pieces, so the shared floor/pipes don't z-fight.
    const mirror = instantiate(model).root;
    mirror.traverse((o) => {
      if (o.isMesh && !/Wall|Column|light/i.test(o.name)) o.visible = false;
    });
    mirror.scale.x = -1;
    mirror.position.copy(root.position);
    this.scene.add(mirror);

    const { x: w, y: h, z: len } = model.size;
    const bulkhead = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: airlockTexture(), metalness: 0.6, roughness: 0.4, emissive: 0x220a00, emissiveIntensity: 1 })
    );
    bulkhead.position.set(0, h / 2, BACK + len - 0.35);
    bulkhead.rotation.y = Math.PI;
    this.scene.add(bulkhead);

    for (const z of [BACK + len * 0.3, BACK + len * 0.75]) {
      const l = new THREE.PointLight(0xffe2c4, 6, 7, 2);
      l.position.set(0, h - 0.4, z);
      this.scene.add(l);
    }
  }

  // ---------------------------------------------------------------- input

  _bindLook(canvas) {
    this.canvas = canvas;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || this.game.baseUI.panelOpen) return;
      if (this.locked) {
        this._look(e.movementX, e.movementY, 0.0022);
      } else if (e.target === canvas && !this.lookDrag) {
        // Free look without capturing the cursor (pointer lock can be refused or not yet
        // granted): plain mouse movement turns the head; edges keep turning (see update()).
        this._look(e.movementX, e.movementY, 0.0035);
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || this.game.baseUI.panelOpen) return;
      if (e.pointerType === 'mouse' && !this.locked) {
        canvas.requestPointerLock?.()?.catch?.(() => {});
      }
      if (e.pointerType === 'mouse' && this.locked) {
        this.game.baseUI.interact(this.target);
        return;
      }
      this.lookDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
      const d = this.lookDrag;
      if (!this.active || !d || d.id !== e.pointerId || this.locked) return;
      this._look(e.clientX - d.x, e.clientY - d.y, e.pointerType === 'touch' ? 0.006 : 0.004);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    window.addEventListener('pointerup', (e) => {
      const d = this.lookDrag;
      if (!d || d.id !== e.pointerId) return;
      this.lookDrag = null;
      // A tap (not a drag) on touch interacts with whatever is in the centre.
      if (this.active && e.pointerType === 'touch' && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 10 && this.target) {
        this.game.baseUI.interact(this.target);
      }
    });
  }

  _look(dx, dy, sens) {
    this.yaw -= dx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -1.3, 1.3);
  }

  releasePointer() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  // Re-capture the mouse (must run inside a user gesture, e.g. closing a panel by click).
  capturePointer() {
    if (!this.active || this.game.isTouch || this.locked) return;
    this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }

  // ---------------------------------------------------------------- lifecycle

  enter() {
    this.active = true;
    // Arrive through the entrance corridor if there is one.
    this.pos.set(0, EYE, this.corridorLen ? BACK + this.corridorLen - 1.2 : 13);
    this.yaw = 0;
    this.pitch = 0.02;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  exit() {
    this.active = false;
    this.lookDrag = null;
    this.releasePointer();
  }

  setCargoLoaded(loaded) {
    this.crates.forEach((c, i) => (c.visible = loaded || i >= this.crates.length - 2));
    if (loaded) this.cargoScreen.draw('CARGO BAY', 'Rewards ready to unload', '#ffc94a');
    else this.cargoScreen.draw('CARGO BAY', 'All cargo unloaded', '#7a8796');
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  update(dt, input, canMove) {
    this.time += dt;

    // Walk relative to where we're looking (horizontal only).
    let fwd = 0;
    let strafe = 0;
    if (canMove) {
      const k = input.keys;
      fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      if (input.joy.id !== null) {
        fwd = input.joy.y;
        strafe = input.joy.x;
      }
    }
    // Uncaptured mouse resting near the left/right edge keeps turning the view.
    if (canMove && !this.locked && !this.lookDrag && input.mouseActive && !this.game.isTouch) {
      const ax = input.aim.x;
      const edge = Math.max(0, Math.abs(ax) - 0.8) / 0.2;
      if (edge > 0) this.yaw -= Math.sign(ax) * edge * 1.8 * dt;
    }
    const speed = input.keys.has('ShiftLeft') ? 9 : 5.5;
    _dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3().addScaledVector(_dir, fwd).addScaledVector(_right, strafe);
    if (move.lengthSq() > 1) move.normalize();
    this.pos.addScaledVector(move, speed * dt);
    this._collide();

    const moving = move.lengthSq() > 0.01;
    this.bob += dt * (moving ? 9 : 0);
    const bobY = moving ? Math.sin(this.bob) * 0.05 : 0;

    this.camera.position.set(this.pos.x, EYE + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();

    // What are we looking at?
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    this.raycaster.far = 14;
    this.target = null;
    for (const it of this.interactables) {
      const hit = this.raycaster.intersectObject(it.mesh, false)[0];
      if (hit && hit.distance <= it.reach && (!this.target || hit.distance < this.target.distance)) {
        this.target = { id: it.id, distance: hit.distance };
      }
    }
    this.target = this.target?.id ?? null;

    // Ambient animation.
    this.holo.rotation.y += dt * 0.8;
    this.ship.holder.position.y = 3.0 + Math.sin(this.time * 1.3) * 0.06;
    for (const g of this.ship.model.glows) g.scale.setScalar(0.7 + Math.random() * 0.1);
    this.ship.model.mods.update(dt, this.time);
    this.field.material.uniforms.uTime.value = this.time;
    this.planetView.rotation.y += dt * 0.01;
    this.sky.update(this.camera, this.time);
  }

  _collide() {
    const p = this.pos;
    p.x = THREE.MathUtils.clamp(p.x, -HALF_W + 1.4, HALF_W - 1.4);
    // The corridor is a narrow walkway behind the back wall.
    const halfDoor = this.corridorLen ? this.game.assets.models.corridor.size.x / 2 - 0.55 : 0;
    const inDoorway = this.corridorLen && Math.abs(p.x) < halfDoor;
    p.z = THREE.MathUtils.clamp(p.z, FRONT + 2.2, inDoorway ? BACK + this.corridorLen - 0.9 : BACK - 1.2);
    if (p.z > BACK - 1.2) p.x = THREE.MathUtils.clamp(p.x, -halfDoor, halfDoor);
    // Round obstacles: the landing pad/ship, the terminal and the cargo stack.
    for (const [c, r] of [[PAD, 9.6], [TERMINAL, 2.2], [CARGO, 4.2]]) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 0.0001) {
        p.x = c.x + (dx / d) * r;
        p.z = c.z + (dz / d) * r;
      }
    }
  }
}

// ---------------------------------------------------------------- textures

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function panelTexture(base, dark, light, n) {
  return canvasTexture(512, 512, (g, w) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, w);
    const s = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // Slight per-panel tone variation.
        const v = Math.random() * 14 - 7;
        g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
        g.fillRect(i * s, j * s, s, s);
        g.strokeStyle = dark;
        g.lineWidth = 3;
        g.strokeRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3);
        g.strokeStyle = light;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(i * s + 3, j * s + 3);
        g.lineTo(i * s + s - 3, j * s + 3);
        g.stroke();
        g.fillStyle = dark;
        for (const [bx, by] of [[8, 8], [s - 8, 8], [8, s - 8], [s - 8, s - 8]]) {
          g.beginPath();
          g.arc(i * s + bx, j * s + by, 2.2, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  });
}

function stripeTexture(radial = false) {
  const tex = canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8b830';
    for (let x = -h; x < w + h; x += 48) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 24, h);
      g.lineTo(x + 24 + h, 0);
      g.lineTo(x + h, 0);
      g.closePath();
      g.fill();
    }
  });
  tex.repeat.set(radial ? 12 : 16, 1);
  return tex;
}

function airlockTexture() {
  const tex = canvasTexture(256, 256, (g, w) => {
    g.fillStyle = '#3a3f46';
    g.fillRect(0, 0, w, w);
    g.fillStyle = '#2a2e34';
    g.fillRect(w * 0.18, w * 0.08, w * 0.64, w * 0.9);
    g.strokeStyle = '#e8b830';
    g.lineWidth = 6;
    g.strokeRect(w * 0.18, w * 0.08, w * 0.64, w * 0.9);
    g.fillStyle = '#e8b830';
    g.font = 'bold 26px Orbitron, sans-serif';
    g.textAlign = 'center';
    g.fillText('AIRLOCK', w / 2, w * 0.45);
    g.fillStyle = '#ff5040';
    g.beginPath();
    g.arc(w / 2, w * 0.6, 8, 0, Math.PI * 2);
    g.fill();
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function crateTexture() {
  return canvasTexture(256, 256, (g, w) => {
    g.fillStyle = '#5a6068';
    g.fillRect(0, 0, w, w);
    g.strokeStyle = '#3a3f46';
    g.lineWidth = 14;
    g.strokeRect(7, 7, w - 14, w - 14);
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(14, 14);
    g.lineTo(w - 14, w - 14);
    g.stroke();
    g.fillStyle = '#e8b830';
    g.font = 'bold 34px Orbitron, sans-serif';
    g.textAlign = 'center';
    g.fillText('SUPPLY', w / 2, w / 2 + 70);
  });
}

class ScreenTexture {
  constructor(title, sub, color) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 280;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw(title, sub, color);
  }

  draw(title, sub, color) {
    const g = this.canvas.getContext('2d');
    const { width: w, height: h } = this.canvas;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#06233d');
    grad.addColorStop(1, '#03111f');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.globalAlpha = 0.12;
    g.fillStyle = color;
    for (let y = 20; y < h - 20; y += 6) g.fillRect(14, y, w - 28, 2);
    g.globalAlpha = 1;
    g.fillStyle = color;
    g.font = 'bold 54px Orbitron, sans-serif';
    g.textAlign = 'center';
    g.fillText(title, w / 2, h / 2);
    g.fillStyle = '#dff6ff';
    g.font = '30px Rajdhani, sans-serif';
    g.fillText(sub, w / 2, h / 2 + 52);
    this.texture.needsUpdate = true;
  }
}
