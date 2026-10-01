import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { segmentHitsSphere } from '../systems/Lasers.js';

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const FLIGHT_RANGE = 340;

// One rank chevron; level 1 is the bottom one.
const CHEVRON = (y, on) =>
  `<polyline points="3,${y + 9} 14,${y + 2} 25,${y + 9}" class="${on ? 'on' : ''}" />`;

// Rank badges (chevrons) floating over every built turret, so it's obvious at a glance which
// turrets are upgraded and which aren't. Shown in the tactical view and, nearby, in flight.
export class TurretBadges {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.id = 'turret-badges';
    document.body.appendChild(this.root);
    this.items = game.turrets.slots.map(() => {
      const el = document.createElement('div');
      el.className = 'turret-badge hidden';
      this.root.appendChild(el);
      return { el, key: '' };
    });
  }

  static chevrons(level, max = CONFIG.turrets.maxLevel) {
    let lines = '';
    for (let i = 0; i < max; i++) lines += CHEVRON((max - 1 - i) * 8, i < level);
    return `<svg class="chevrons" viewBox="0 0 28 ${max * 8 + 4}" aria-label="Level ${level} of ${max}">${lines}</svg>`;
  }

  hide() {
    if (this.root.classList.contains('hidden')) return;
    this.root.classList.add('hidden');
  }

  update() {
    const g = this.game;
    const state = g.state;
    const tactical = state === 'build';
    if (!(tactical || state === 'playing' || state === 'turret')) return this.hide();
    this.root.classList.remove('hidden');

    const cam = g.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const max = CONFIG.turrets.maxLevel;
    const manned = g.turretControl?.slot;

    for (const [i, slot] of g.turrets.slots.entries()) {
      const item = this.items[i];
      const t = slot.turret;
      let show = !!t && slot !== manned;
      let dist = 0;
      if (show) {
        _p.copy(slot.pos).addScaledVector(slot.normal, 7);
        dist = _p.distanceTo(cam.position);
        if (!tactical && dist > FLIGHT_RANGE) show = false;
        // Hidden behind the planet?
        if (show && segmentHitsSphere(cam.position, _p, _n.set(0, 0, 0), CONFIG.planet.radius * 0.98)) show = false;
      }
      if (show) {
        _p.project(cam);
        if (_p.z > 1 || Math.abs(_p.x) > 1.1 || Math.abs(_p.y) > 1.1) show = false;
      }
      item.el.classList.toggle('hidden', !show);
      if (!show) continue;

      const upCost = g.turrets.upgradeCost(t);
      const canUp = tactical && upCost !== null && g.coins >= upCost;
      const key = `${t.type}|${t.level}|${canUp}|${t.disabled > 0}|${slot.index === g.build.selected}`;
      if (key !== item.key) {
        item.key = key;
        const def = CONFIG.turrets.types[t.type];
        item.el.style.setProperty('--accent', def.color);
        item.el.classList.toggle('max', t.level >= max);
        item.el.classList.toggle('can-up', canUp);
        item.el.classList.toggle('offline', t.disabled > 0);
        item.el.classList.toggle('selected', tactical && slot.index === g.build.selected);
        const tag = t.level >= max ? 'MAX' : `LV ${t.level}`;
        item.el.innerHTML = `${TurretBadges.chevrons(t.level)}<span class="lv">${tag}</span>${canUp ? '<span class="up">▲</span>' : ''}`;
      }
      const x = (_p.x * 0.5 + 0.5) * w;
      const y = (-_p.y * 0.5 + 0.5) * h;
      const s = tactical ? 1 : THREE.MathUtils.clamp(170 / dist, 0.55, 1);
      item.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(3)})`;
    }
  }
}
