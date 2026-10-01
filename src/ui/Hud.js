import * as THREE from 'three';
import { CONFIG } from '../config.js';

const RADAR_RANGE = 650;
const _v = new THREE.Vector3();
const _inv = new THREE.Quaternion();

export class Hud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.root = $('hud');
    this.hull = $('hull-fill');
    this.shield = $('shield-fill');
    this.boost = $('boost-fill');
    this.planet = $('planet-fill');
    this.coinBox = $('coins');
    this.coinCount = $('coin-count');
    this.score = $('score');
    this.waveLabel = $('wave-label');
    this.waveSub = $('wave-sub');
    this.crosshair = $('crosshair');
    this.flash = $('damage-flash');
    this.bannerEl = $('banner');
    this.bannerTitle = $('banner-title');
    this.bannerSub = $('banner-sub');
    this.warningEl = $('warning');
    this.indicatorsEl = $('indicators');
    this.radar = $('radar');
    this.bossBar = $('boss-bar');
    this.bossName = $('boss-name');
    this.bossFill = $('boss-fill');
    this.bossStatus = $('boss-status');
    this.radarCtx = this.radar.getContext('2d');
    this.arrows = [];
    this.boxes = [];
    this._last = {};
    this._bannerTimer = null;
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
  }

  _set(key, value, fn) {
    if (this._last[key] === value) return;
    this._last[key] = value;
    fn(value);
  }

  banner(title, sub = '', { danger = false, duration = 2600 } = {}) {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerEl.classList.toggle('danger', danger);
    this.bannerEl.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.bannerEl.classList.remove('show'), duration);
  }

  update(game) {
    const { ship, waves } = game;
    const pct = (v, max) => Math.round((v / max) * 100);
    this._set('hull', pct(ship.hull, CONFIG.ship.hull), (v) => (this.hull.style.width = `${v}%`));
    this._set('shield', pct(ship.shield, CONFIG.ship.shield), (v) => (this.shield.style.width = `${v}%`));
    this._set('boost', pct(ship.boost, CONFIG.ship.boostMax), (v) => (this.boost.style.width = `${v}%`));
    this._set('planet', pct(game.planetHp, CONFIG.planet.hp), (v) => {
      this.planet.style.width = `${v}%`;
      this.planet.classList.toggle('low', v <= 30);
    });
    this._set('score', game.score, (v) => (this.score.textContent = v.toLocaleString('en-US')));
    this._set('coins', game.coins, (v) => {
      this.coinCount.textContent = v.toLocaleString('en-US');
      this.coinBox.classList.remove('pop');
      void this.coinBox.offsetWidth; // restart animation
      this.coinBox.classList.add('pop');
    });

    const bossFight = waves.state === 'boss';
    const label = bossFight ? `LEVEL ${waves.level} · BOSS` : `LEVEL ${waves.level} · WAVE ${Math.max(waves.wave, 1)}/${waves.perLevel}`;
    this._set('wave', label, (v) => (this.waveLabel.textContent = v));
    const sub = waves.state === 'break' ? `NEXT WAVE IN ${Math.ceil(waves.countdown)}` : bossFight ? (waves.remaining ? `ESCORTS ${waves.remaining}` : '') : `ENEMIES ${waves.remaining}`;
    this._set('waveSub', sub, (v) => (this.waveSub.textContent = v));

    let warning = '';
    if (!ship.alive) warning = `SHIP DESTROYED · RESPAWN IN ${Math.ceil(game.respawnTimer)}`;
    else if (game.outOfBounds) warning = 'LEAVING COMBAT ZONE · TURNING BACK';
    else if (game.planetHp <= 30) warning = 'HOMEWORLD CRITICAL';
    this._set('warning', warning, (v) => (this.warningEl.textContent = v));

    const boss = game.bosses.boss;
    const showBoss = !!boss && boss.alive;
    this._set('bossShow', showBoss, (v) => this.bossBar.classList.toggle('hidden', !v));
    if (showBoss) {
      this._set('bossName', boss.def.name, (v) => {
        this.bossName.textContent = v;
        this.bossBar.style.setProperty('--boss', boss.def.color);
      });
      this._set('bossHp', Math.ceil((boss.hp / boss.maxHp) * 200) / 2, (v) => (this.bossFill.style.width = `${v}%`));
      this._set('bossStatus', boss.status, (v) => (this.bossStatus.textContent = v));
    }

    this._drawRadar(game);
    this._updateIndicators(game);
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

  _drawRadar(game) {
    const ctx = this.radarCtx;
    const size = this.radar.width;
    const c = size / 2;
    const scale = (c - 8) / RADAR_RANGE;
    ctx.clearRect(0, 0, size, size);

    // Range rings + heading line.
    ctx.strokeStyle = 'rgba(79, 216, 255, 0.18)';
    ctx.lineWidth = 2;
    for (const r of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(c, c, (c - 8) * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c, 8);
    ctx.stroke();

    const shipPos = game.ship.group.position;
    _inv.copy(game.ship.group.quaternion).invert();
    const toRadar = (p) => {
      _v.subVectors(p, shipPos).applyQuaternion(_inv);
      let x = _v.x * scale;
      let y = _v.z * scale; // forward (-z) is up
      const len = Math.hypot(x, y);
      const max = c - 8;
      if (len > max) {
        x *= max / len;
        y *= max / len;
      }
      return [c + x, c + y, _v.y];
    };

    // Planet.
    const [px, py] = toRadar(new THREE.Vector3(0, 0, 0));
    ctx.fillStyle = 'rgba(77, 255, 166, 0.35)';
    ctx.strokeStyle = 'rgba(77, 255, 166, 0.9)';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(CONFIG.planet.radius * scale, 5), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Coins.
    ctx.fillStyle = '#ffc94a';
    for (const coin of game.pickups.coins) {
      if (!coin.active) continue;
      const [x, y] = toRadar(coin.sprite.position);
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }

    // Enemies (hollow when below the ship).
    for (const e of game.enemies.list) {
      if (!e.active) continue;
      const [x, y, h] = toRadar(e.group.position);
      ctx.fillStyle = e.type === 'bomber' ? '#ff9b3d' : '#ff4d5e';
      ctx.strokeStyle = ctx.fillStyle;
      const r = e.type === 'bomber' ? 6 : 4.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (h < -15) ctx.stroke();
      else ctx.fill();
    }

    // Boss.
    const boss = game.bosses.boss;
    if (boss && boss.alive && !boss.cloaked) {
      const [x, y] = toRadar(boss.root.position);
      ctx.fillStyle = boss.def.color;
      ctx.fillRect(x - 7, y - 7, 14, 14);
    }

    // Player.
    ctx.fillStyle = '#4fd8ff';
    ctx.beginPath();
    ctx.moveTo(c, c - 8);
    ctx.lineTo(c - 6, c + 6);
    ctx.lineTo(c + 6, c + 6);
    ctx.closePath();
    ctx.fill();
  }

  _updateIndicators(game) {
    const cam = game.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    let arrowCount = 0;
    let boxCount = 0;

    const place = (pos, kind, hpFrac, onScreenOnly = false) => {
      _v.copy(pos).applyMatrix4(cam.matrixWorldInverse);
      const behind = _v.z > 0;
      _v.copy(pos).project(cam);
      let x = _v.x;
      let y = _v.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const onScreen = !behind && Math.abs(x) < 0.94 && Math.abs(y) < 0.9;
      if (onScreen) {
        if (kind === 'planet') return;
        const b = this._pool(this.boxes, boxCount++, 'target-box');
        b.className = `target-box ${kind}`;
        b.style.transform = `translate(${(x * 0.5 + 0.5) * w}px, ${(-y * 0.5 + 0.5) * h}px)`;
        b.firstChild.style.width = `${Math.max(hpFrac, 0) * 100}%`;
        return;
      }
      if (onScreenOnly) return;
      // Clamp to an ellipse near the screen edge and point outward.
      const ang = Math.atan2(y, x);
      const ex = Math.cos(ang) * 0.46 * w;
      const ey = Math.sin(ang) * 0.42 * h;
      const a = this._pool(this.arrows, arrowCount++, 'indicator');
      a.className = `indicator ${kind}`;
      a.style.transform = `translate(${w / 2 + ex}px, ${h / 2 - ey}px) rotate(${Math.PI / 2 - ang}rad)`;
    };

    if (game.ship.alive) {
      for (const e of game.enemies.list) {
        if (!e.active) continue;
        place(e.group.position, e.type, e.hp / e.maxHp);
      }
      const boss = game.bosses.boss;
      if (boss && boss.alive && !boss.cloaked) {
        place(boss.root.position, 'boss', boss.hp / boss.maxHp);
        for (const t of game.bosses.targets) {
          if (t.active && t.kind !== 'segment') place(t.group.position, 'part', t.hp / t.maxHp, true);
        }
      }
      place(new THREE.Vector3(0, 0, 0), 'planet', 1);
    }

    for (let i = arrowCount; i < this.arrows.length; i++) this.arrows[i].style.display = 'none';
    for (let i = boxCount; i < this.boxes.length; i++) this.boxes[i].style.display = 'none';
  }

  _pool(arr, i, cls) {
    if (!arr[i]) {
      const el = document.createElement('div');
      el.className = cls;
      if (cls === 'target-box') el.appendChild(document.createElement('div')).className = 'hp';
      this.indicatorsEl.appendChild(el);
      arr[i] = el;
    }
    arr[i].style.display = 'block';
    return arr[i];
  }
}
