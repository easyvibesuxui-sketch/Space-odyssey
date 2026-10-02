import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { instantiate } from '../core/Models.js';
import { rotateTowards } from './GroundWar.js';
import { rand } from '../core/noise.js';

const _v = new THREE.Vector3();

// Spots in the hangar the companion likes to wander between when nothing is happening.
const SPOTS = [[-6, 9], [6, 10], [-14, -1], [14, -2], [0, 13], [-13, -13], [13, -13], [-4, -22], [5, -23], [-9, 12], [9, 7]];

const CHATTER = [
  'All quiet in the hangar, captain!',
  'Ooh, shiny mechs. Can we buy the big one?',
  'I polished the ship. Mostly the left side.',
  'If those robots come back, I got your back!',
  'Is it lunch yet? Space makes me hungry.',
  'I counted the crates. Twice. Still eight... I think.',
];

// The base companion: wanders the hangar in peacetime, follows the player and fights during a
// ground war, and can be knocked down — hold E next to them (or pay at the Armory) to revive.
export class Companion {
  constructor(game) {
    this.game = game;
    this.hangar = game.hangar;
    this.scene = this.hangar.scene;
    const cfg = CONFIG.war.companion;
    this.maxHp = cfg.hp;
    this.hp = cfg.hp;
    this.alive = true;
    this.cooldown = 0;
    this.revive = 0;
    this.wait = 1;
    this.goal = new THREE.Vector3(...spot(0));
    this.phase = 0;

    this.root = new THREE.Group();
    const model = game.assets.models?.companion;
    if (model) {
      const inst = instantiate(model);
      this.body = inst.root;
      if (model.animations?.length) {
        this.mixer = new THREE.AnimationMixer(inst.root);
        this.mixer.clipAction(model.animations[0]).play();
      }
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: 0xd98a5a });
      this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 4, 8), mat);
      this.body.position.y = 0.9;
    }
    this.root.add(this.body);
    this.root.position.set(-6, 0, 9);
    this.pos = this.root.position;
    this.scene.add(this.root);

    // Small blaster in hand (visual).
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0.35, 1.15, -0.6);
    this.root.add(this.muzzle);

    // "Downed" marker.
    this.marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.6, 0.3) }));
    this.marker.position.y = 1.2;
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.label = makeLabel();
    this.label.sprite.position.y = 2.35;
    this.root.add(this.label.sprite);
    this._drawLabel();

    const hit = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1;
    this.root.add(hit);
    this.hangar.interactables.push({ id: 'companion', mesh: hit, reach: 4 });
  }

  serialize() {
    return { alive: this.alive };
  }

  load(saved) {
    this.alive = saved?.alive !== false;
    this.hp = this.alive ? this.maxHp : 0;
    this._pose();
    this._drawLabel();
  }

  damage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.game.war.effects.sparks(_v.copy(this.pos).setY(1), 18, new THREE.Color(4, 1.4, 0.5), 6, 0.5, 0.5);
      this.game.baseUI.toast(`${CONFIG.war.companion.name} is down! Hold E next to them to revive.`);
      this._pose();
    }
    this._drawLabel();
  }

  reviveNow(hpShare = 0.6) {
    this.alive = true;
    this.hp = this.maxHp * hpShare;
    this.revive = 0;
    this._pose();
    this._drawLabel();
    this.game.audio.build();
    this.game.baseUI.toast(`${CONFIG.war.companion.name}: "Thanks, captain! Back in action!"`);
  }

  talk() {
    if (!this.alive) return;
    const line = this.game.war.active ? 'Stay close, I\'ll cover you!' : CHATTER[Math.floor(Math.random() * CHATTER.length)];
    this.game.baseUI.toast(`${CONFIG.war.companion.name}: "${line}"`);
    this.wait = Math.max(this.wait, 2.5);
    this.facePlayer = 2.5;
  }

  onWarEnd() {
    if (this.alive) this.hp = this.maxHp;
    this._drawLabel();
  }

  get reviveProgress() {
    return this.revive / CONFIG.war.companion.reviveTime;
  }

  // Lying on the floor while down.
  _pose() {
    this.body.rotation.x = this.alive ? 0 : -Math.PI / 2;
    this.body.position.y = this.alive ? (this.mixer ? 0 : 0.9) : 0.25;
    this.marker.visible = !this.alive;
  }

  _drawLabel() {
    this.label.draw(CONFIG.war.companion.name, this.alive ? this.hp / this.maxHp : 0, this.alive);
  }

  update(dt, input) {
    const g = this.game;
    const war = g.war;
    const cfg = CONFIG.war.companion;
    const player = this.hangar.pos;
    const dPlayer = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
    this.mixer?.update(dt);
    this.phase += dt;

    if (!this.alive) {
      this.marker.position.set(this.pos.x, 1.4 + Math.sin(this.phase * 4) * 0.15, this.pos.z);
      this.marker.rotation.y += dt * 2;
      // Hold E (or the USE button) next to them to revive.
      const holding = !g.mechs.piloting && dPlayer < 3 && input.keys.has('KeyE') && !g.baseUI.panelOpen;
      this.revive = holding ? this.revive + dt : Math.max(0, this.revive - dt * 2);
      if (this.revive >= cfg.reviveTime) this.reviveNow();
      return;
    }

    let goal = null;
    let speed = 1.8;
    let target = null;
    if (war.active) {
      // Find something to shoot, otherwise stay near the player.
      let best = cfg.range;
      for (const inv of war.invaders) {
        if (!inv.alive || inv.dropping) continue;
        const d = inv.root.position.distanceTo(this.pos);
        if (d < best) {
          best = d;
          target = inv;
        }
      }
      if (dPlayer > 6) goal = _v.set(player.x, 0, player.z);
      speed = 4.2;
    } else {
      // Peacetime: amble between favourite spots.
      if (this.facePlayer > 0) this.facePlayer -= dt;
      this.wait -= dt;
      if (this.wait <= 0) {
        const d = Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z);
        if (d < 0.6) {
          this.wait = rand(2, 6);
          this.goal.set(...spot(Math.floor(Math.random() * SPOTS.length)));
        } else {
          goal = this.goal;
        }
      }
    }

    let moving = false;
    if (goal) {
      const dx = goal.x - this.pos.x;
      const dz = goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) {
        this.pos.x += (dx / d) * speed * dt;
        this.pos.z += (dz / d) * speed * dt;
        this.root.rotation.y = rotateTowards(this.root.rotation.y, Math.atan2(-dx, -dz), 6 * dt);
        moving = true;
      }
    }
    if (target) {
      const tp = target.root.position;
      this.root.rotation.y = rotateTowards(this.root.rotation.y, Math.atan2(-(tp.x - this.pos.x), -(tp.z - this.pos.z)), 8 * dt);
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.cooldown = cfg.interval * rand(0.8, 1.2);
        const from = this.muzzle.getWorldPosition(new THREE.Vector3());
        const to = tp.clone();
        to.y += 1.2;
        war.fireFriendly(from, to, cfg.damage * (1 + 0.1 * (g.waves.level - 1)), { color: [4, 1.6, 4], size: 0.13, speed: 140 });
        g.audio.laser(0.12);
      }
    } else if (!moving && this.facePlayer > 0) {
      this.root.rotation.y = rotateTowards(this.root.rotation.y, Math.atan2(-(player.x - this.pos.x), -(player.z - this.pos.z)), 5 * dt);
    }
    // Bouncy walk.
    this.body.position.y = (this.mixer ? 0 : 0.9) + (moving ? Math.abs(Math.sin(this.phase * 9)) * 0.07 : 0);
    this.hangar.collide(this.pos, 0.45);
    // Health tag only when hurt or nearby.
    this.label.sprite.visible = dPlayer < 14 || this.hp < this.maxHp;
  }
}

function spot(i) {
  const [x, z] = SPOTS[i % SPOTS.length];
  return [x, 0, z];
}

function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(1.6, 0.4, 1);
  return {
    sprite,
    draw(name, hp, alive) {
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, 256, 64);
      g.fillStyle = alive ? '#4dffa6' : '#ff4d5e';
      g.font = 'bold 26px Orbitron, sans-serif';
      g.textAlign = 'center';
      g.fillText(alive ? name : `${name} · DOWN`, 128, 28);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(28, 40, 200, 10);
      g.fillStyle = hp > 0.35 ? '#4dffa6' : '#ff9b3d';
      g.fillRect(28, 40, 200 * hp, 10);
      texture.needsUpdate = true;
    },
  };
}
