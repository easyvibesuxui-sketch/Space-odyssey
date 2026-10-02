import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { rand } from '../core/noise.js';

// Runs the level: break -> wave (staggered spawns) -> cleared -> break ... -> level complete.
export class Waves {
  constructor(enemies, callbacks) {
    this.enemies = enemies;
    this.cb = callbacks; // { onWaveStart(info), onWaveCleared(info), onLevelComplete(info) }
    this.reset();
  }

  reset() {
    this.level = 1;
    this.wave = 0; // wave within the current level (1..perLevel)
    this.state = 'break';
    this.timer = CONFIG.waves.firstBreak;
    this.queue = [];
    this.spawnTimer = 0;
  }

  get perLevel() {
    return CONFIG.waves.perLevel;
  }

  // Seconds until the next wave, or 0 while a wave is running.
  get countdown() {
    return this.state === 'break' ? Math.max(0, this.timer) : 0;
  }

  get remaining() {
    return this.enemies.activeCount + this.queue.length;
  }

  // Call the next wave early. Returns bonus coins for the time skipped.
  skip() {
    if (this.state !== 'break') return 0;
    const bonus = Math.floor(this.timer);
    this.timer = 0;
    return bonus;
  }

  update(dt) {
    if (this.state === 'break') {
      this.timer -= dt;
      if (this.timer <= 0) this._startWave();
      return;
    }

    if (this.queue.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const next = this.queue.shift();
        this.enemies.spawn(next.type, next.pos, this.level);
        this.spawnTimer = CONFIG.waves.spawnInterval;
      }
      return;
    }

    if (this.state === 'boss') {
      // The level ends when the boss and everything it launched are gone.
      if (this.cb.bossAlive?.() || this.enemies.activeCount > 0) return;
      this.cb.onLevelComplete?.({ level: this.level });
      this.level++;
      this.wave = 0;
      this.timer = CONFIG.waves.breakTime + 4;
      this.state = 'break';
      return;
    }

    if (this.enemies.activeCount === 0) {
      const levelDone = this.wave >= this.perLevel;
      if (levelDone) {
        this.state = 'boss';
        this.cb.onBossStart?.({ level: this.level });
        return;
      } else {
        this.cb.onWaveCleared?.({ level: this.level, wave: this.wave });
        this.timer = CONFIG.waves.breakTime;
      }
      this.state = 'break';
    }
  }

  _startWave() {
    this.wave++;
    const n = this.wave;
    const L = this.level;
    const fighters = 2 + n + (L - 1) * 2;
    const bombers = n >= 2 ? Math.floor(n / 2) + (L - 1) : 0;
    // Elite interceptors from level 2; troop dropships try to land and storm the base.
    const interceptors = L >= 2 && n >= 2 ? Math.floor((L - 1) * 0.7 + n / 3) : 0;
    const dropships = (L === 1 ? n === 3 : n === 2 || n === 4 || n === 5) ? 1 + Math.floor((L - 1) / 2) : 0;

    // Attack from one or two directions, roughly around the equator.
    const groups = n >= 3 ? 2 : 1;
    const dirs = Array.from({ length: groups }, () => {
      const a = rand(0, Math.PI * 2);
      return new THREE.Vector3(Math.cos(a), rand(-0.35, 0.35), Math.sin(a)).normalize();
    });

    const list = [];
    for (let i = 0; i < fighters; i++) list.push('fighter');
    for (let i = 0; i < bombers; i++) list.push('bomber');
    for (let i = 0; i < interceptors; i++) list.push('interceptor');
    for (let i = 0; i < dropships; i++) list.push('dropship');
    this.queue = list.map((type, i) => {
      const dir = dirs[i % groups];
      const pos = dir.clone().multiplyScalar(CONFIG.waves.spawnDistance);
      pos.add(new THREE.Vector3(rand(-40, 40), rand(-25, 25), rand(-40, 40)));
      return { type, pos };
    });
    this.spawnTimer = 0;
    this.state = 'active';
    this.cb.onWaveStart?.({ level: L, wave: n, fighters, bombers, interceptors, dropships, dirs });
  }
}
