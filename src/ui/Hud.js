import { CONFIG } from '../config.js';

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.hull = document.getElementById('hull-fill');
    this.shield = document.getElementById('shield-fill');
    this.planet = document.getElementById('planet-fill');
    this.coinBox = document.getElementById('coins');
    this.coinCount = document.getElementById('coin-count');
    this.score = document.getElementById('score');
    this.dash = document.getElementById('dash-indicator');
    this.crosshair = document.getElementById('crosshair');
    this.flash = document.getElementById('damage-flash');
    this._last = {};
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
  }

  _set(key, value, fn) {
    if (this._last[key] === value) return;
    this._last[key] = value;
    fn(value);
  }

  update(state) {
    const { ship } = state;
    this._set('hull', Math.round((ship.hull / CONFIG.ship.hull) * 100), (v) => (this.hull.style.width = `${v}%`));
    this._set('shield', Math.round((ship.shield / CONFIG.ship.shield) * 100), (v) => (this.shield.style.width = `${v}%`));
    this._set('planet', Math.round(state.planetHp), (v) => (this.planet.style.width = `${v}%`));
    this._set('score', state.score, (v) => (this.score.textContent = v.toLocaleString('en-US')));
    this._set('coins', state.coins, (v) => {
      this.coinCount.textContent = v;
      this.coinBox.classList.remove('pop');
      void this.coinBox.offsetWidth; // restart animation
      this.coinBox.classList.add('pop');
    });
    this._set('dash', ship.dashReady, (v) => this.dash.classList.toggle('cooldown', !v));
  }

  setCrosshair(ndcX, ndcY) {
    const x = (ndcX * 0.5 + 0.5) * 100;
    const y = (-ndcY * 0.5 + 0.5) * 100;
    this.crosshair.style.left = `${x}%`;
    this.crosshair.style.top = `${y}%`;
  }

  damageFlash() {
    this.flash.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flash.classList.remove('on')));
  }
}
