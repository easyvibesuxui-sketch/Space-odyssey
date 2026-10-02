import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Corners of the dashboard's centre screen in ship space (measured on the cockpit model).
const TL = new THREE.Vector3(-0.411, 1.237, 0.165);
const TR = new THREE.Vector3(0.394, 1.237, 0.169);
const BL = new THREE.Vector3(-0.391, 0.842, 0.388);
const BR = new THREE.Vector3(0.385, 0.841, 0.39);
const W = 640;
const H = 360;

const BARS = [
  { key: 'hull', label: 'HULL', color: ['#ff7a3d', '#ffc94a'] },
  { key: 'shield', label: 'SHIELD', color: ['#1e7bff', '#4fd8ff'] },
  { key: 'boost', label: 'TURBO', color: ['#8a5cff', '#d59cff'] },
  { key: 'planet', label: 'PLANET', color: ['#1fbf73', '#4dffa6'] },
];

// The cockpit's centre screen shows the radar and the ship/planet bars (cockpit view only;
// the on-screen HUD versions are hidden then).
export class CockpitDisplay {
  constructor(cockpit, hud) {
    this.hud = hud;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    // Quad over the screen, inset from the bezel and lifted off the surface a hair.
    const centre = new THREE.Vector3().add(TL).add(TR).add(BL).add(BR).multiplyScalar(0.25);
    const normal = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(BL, TL), new THREE.Vector3().subVectors(TR, TL)).normalize();
    const corner = (p) => p.clone().lerp(centre, 0.04).addScaledVector(normal, 0.004);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([TL, TR, BL, BR].flatMap((p) => corner(p).toArray()), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    // The screen is slightly recessed in the dashboard: draw it on top so the bezel never cuts it.
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    this.mesh.renderOrder = 10;
    cockpit.add(this.mesh);
    this.frame = 0;
  }

  update(game) {
    // ~20 redraws per second is plenty for a dashboard.
    if (this.frame++ % 3) return;
    const g = this.ctx;
    const ship = game.ship;
    const cfgShip = CONFIG.ship;
    const values = {
      hull: ship.hull / cfgShip.hull,
      shield: ship.shield / cfgShip.shield,
      boost: ship.boost / cfgShip.boostMax,
      planet: game.planetHp / CONFIG.planet.hp,
    };

    // Background with scanlines.
    g.fillStyle = '#020c18';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(79, 216, 255, 0.05)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    const danger = values.hull < 0.3 && Math.floor(performance.now() / 300) % 2;
    g.strokeStyle = danger ? '#ff4d5e' : 'rgba(79, 216, 255, 0.8)';
    g.lineWidth = 4;
    g.strokeRect(6, 6, W - 12, H - 12);

    // Radar (re-uses the HUD's radar canvas).
    const r = 300;
    g.save();
    g.beginPath();
    g.arc(18 + r / 2, H / 2, r / 2, 0, Math.PI * 2);
    g.fillStyle = 'rgba(8, 40, 64, 0.6)';
    g.fill();
    g.clip();
    g.drawImage(this.hud.radar, 18, H / 2 - r / 2, r, r);
    g.restore();
    g.strokeStyle = 'rgba(79, 216, 255, 0.6)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(18 + r / 2, H / 2, r / 2, 0, Math.PI * 2);
    g.stroke();

    // Status line.
    const x0 = 344;
    const waves = game.waves;
    const boss = waves.state === 'boss';
    g.fillStyle = '#4fd8ff';
    g.font = 'bold 26px Orbitron, sans-serif';
    g.textAlign = 'left';
    g.fillText(boss ? `BOSS · LVL ${waves.level}` : `WAVE ${Math.max(waves.wave, 1)}/${waves.perLevel}`, x0, 50);
    g.fillStyle = 'rgba(223, 246, 255, 0.8)';
    g.font = 'bold 24px Rajdhani, sans-serif';
    const sub = waves.state === 'break' ? `NEXT IN ${Math.ceil(waves.countdown)}s` : `ENEMIES ${waves.remaining}`;
    g.textAlign = 'right';
    g.fillText(sub, W - 26, 50);
    g.textAlign = 'left';

    // Bars.
    BARS.forEach((b, i) => {
      const y = 104 + i * 64;
      const v = THREE.MathUtils.clamp(values[b.key], 0, 1);
      g.fillStyle = 'rgba(223, 246, 255, 0.85)';
      g.font = 'bold 22px Orbitron, sans-serif';
      g.fillText(b.label, x0, y);
      g.textAlign = 'right';
      g.fillText(`${Math.round(v * 100)}%`, W - 26, y);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(255, 255, 255, 0.1)';
      g.fillRect(x0, y + 8, W - 26 - x0, 22);
      const grad = g.createLinearGradient(x0, 0, W - 26, 0);
      grad.addColorStop(0, b.color[0]);
      grad.addColorStop(1, b.color[1]);
      g.fillStyle = b.key === 'hull' && v < 0.3 && danger ? '#ff4d5e' : grad;
      g.fillRect(x0, y + 8, (W - 26 - x0) * v, 22);
    });
    this.texture.needsUpdate = true;
  }
}
