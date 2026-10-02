import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { CONFIG } from './config.js';
import { Input } from './core/Input.js';
import { Sky, SUN_DIR } from './world/Sky.js';
import { Planet } from './world/Planet.js';
import { Asteroids } from './world/Asteroids.js';
import { SpaceDust } from './world/SpaceDust.js';
import { Ship } from './entities/Ship.js';
import { Enemies } from './entities/Enemies.js';
import { Bosses, BOSS_TYPES } from './entities/Bosses.js';
import { Lasers, segmentHitsSphere } from './systems/Lasers.js';
import { Effects } from './systems/Effects.js';
import { Pickups } from './systems/Pickups.js';
import { Waves } from './systems/Waves.js';
import { Turrets } from './systems/Turrets.js';
import { Missiles } from './systems/Missiles.js';
import { Hud } from './ui/Hud.js';
import { BuildMode } from './ui/BuildMode.js';
import { TurretControl } from './systems/TurretControl.js';
import { BaseUI } from './ui/BaseUI.js';
import { Hangar } from './base/Hangar.js';
import { TurretBadges } from './ui/TurretBadges.js';
import { CockpitDisplay } from './ui/CockpitDisplay.js';
import { GroundWar } from './base/GroundWar.js';
import { Mechs } from './base/Mechs.js';
import { Companion } from './base/Companion.js';
import { emptyUpgrades, applyUpgrades, UPGRADES, MAX_UPGRADE } from './systems/Upgrades.js';
import { loadSave, writeSave } from './core/Save.js';
import { settings, saveSettings } from './core/Settings.js';
import { instantiate } from './core/Models.js';

const AIM_DISTANCE = 500;
const ORIGIN = new THREE.Vector3(0, 0, 0);
const CAM_OFFSET = new THREE.Vector3(0, 3.8, 14.5);
// Pilot's eye inside the cockpit model (cockpit space, nose towards -Z).
const COCKPIT_EYE = new THREE.Vector3(0, 1.58, 2.4);
const VIEW_KEY = 'space-odyssey-view';
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const CAM_TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.06);

export class Game {
  constructor(canvas, assets, audio) {
    this.canvas = canvas;
    this.assets = assets;
    this.audio = audio;
    this.input = new Input(canvas);
    this.isTouch = this.input.isTouch;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio, this.isTouch ? 1.5 : 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x061426, 0.0007);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);
    this.baseFov = 62;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.scene.add(new THREE.HemisphereLight(0x3d6c9e, 0x05070c, 0.55));
    const sun = new THREE.DirectionalLight(0xd5e9ff, 2.8);
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fb4e0, 0.5);
    fill.position.copy(SUN_DIR).multiplyScalar(-100).add(new THREE.Vector3(0, 60, 0));
    this.scene.add(fill);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.45, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.sky = new Sky(this.scene);
    this.sky.addGasGiant(assets.models);
    this.planet = new Planet(this.scene, this.renderer);
    this._addAerostats(assets.models.aerostat);
    this.asteroids = new Asteroids(this.scene);
    this.dust = new SpaceDust(this.scene);
    this.ship = new Ship(this.scene, assets.models);
    this.enemies = new Enemies(this.scene, assets.models);
    // Everything the player and turrets can shoot at (enemies + boss parts), rebuilt every frame.
    this.targets = [];
    this.lasers = new Lasers(this.scene);
    this.enemyLasers = new Lasers(this.scene, {
      color: new THREE.Color(8, 1.6, 0.6),
      speed: CONFIG.enemyLaser.speed,
      life: CONFIG.enemyLaser.life,
      pool: 160,
      thickness: 0.3,
      length: 4,
    });
    this.effects = new Effects(this.scene);
    this.effects.onResize(this.pixelRatio);
    this.pickups = new Pickups(this.scene, assets.coin);
    this.turrets = new Turrets(this.scene, assets.models);
    this.turretLasers = new Lasers(this.scene, {
      color: new THREE.Color(0.6, 3.6, 3.0),
      pool: 90,
      thickness: 0.24,
      length: 4,
    });
    // Rail cannon slugs: slow-firing, heavy, very visible.
    this.heavyLasers = new Lasers(this.scene, {
      color: new THREE.Color(6, 1.2, 1.4),
      speed: 700,
      life: 1.1,
      pool: 40,
      thickness: 0.7,
      length: 10,
    });
    this.missiles = new Missiles(this.scene, this.effects);
    this.bosses = new Bosses(this.scene, assets.models, this.effects);
    this.hud = new Hud();
    this.waves = new Waves(this.enemies, {
      onWaveStart: ({ wave, fighters, bombers, interceptors, dropships }) => {
        const parts = [`${fighters} fighters`];
        if (bombers) parts.push(`${bombers} bomber${bombers > 1 ? 's' : ''}`);
        if (interceptors) parts.push(`${interceptors} interceptor${interceptors > 1 ? 's' : ''}`);
        if (dropships) parts.push(`${dropships} DROPSHIP${dropships > 1 ? 'S' : ''} · don't let them land!`);
        this.hud.banner(`WAVE ${wave}`, `Incoming: ${parts.join(' · ')}`, { danger: true });
        this.audio.alarm?.();
      },
      onBossStart: ({ level }) => {
        const a = Math.random() * Math.PI * 2;
        const from = new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a)).multiplyScalar(CONFIG.waves.spawnDistance + 80);
        const boss = this.bosses.spawn(level, from);
        this.hud.banner(`BOSS · ${boss.def.name}`, boss.def.hint, { danger: true, duration: 4500 });
        this.audio.alarm();
        setTimeout(() => this.audio.alarm(), 1200);
      },
      bossAlive: () => this.bosses.active,
      onWaveCleared: ({ wave }) => {
        this.hud.banner('WAVE CLEARED', `Wave ${wave} destroyed · press BUILD to place turrets`);
      },
      onLevelComplete: ({ level }) => {
        this.score += 1000 * level;
        this.hud.banner(`LEVEL ${level} COMPLETE`, 'Returning to base…', { duration: 2600 });
        const cargo = {
          level,
          levelBonus: 60 * level,
          integrity: Math.round(this.planetHp),
          killCount: this.levelKills,
          kills: this.levelKills * 2,
        };
        setTimeout(() => {
          if (this.state === 'playing' || this.state === 'build' || this.state === 'turret') this.enterBase(cargo);
        }, 2600);
      },
    });

    this.state = 'menu';
    this.time = 0;
    this.fireTimer = 0;
    this.hitSoundCooldown = 0;
    this.respawnTimer = 0;
    this.outOfBounds = false;
    this.score = 0;
    this.coins = 0;
    this.planetHp = CONFIG.planet.hp;
    this.levelKills = 0;
    this.upgrades = emptyUpgrades();
    this.applyShipUpgrades();

    this.aimPoint = new THREE.Vector3();
    this.aimNdc = new THREE.Vector2(0, 0.13);
    this.raycaster = new THREE.Raycaster();
    this.camQuat = this.ship.group.quaternion.clone();
    this.controls = { pitch: 0, yaw: 0, roll: 0, throttle: 0, boost: false };
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();

    // Cockpit view: the cockpit model rides along with the ship and is shown instead of the hull.
    if (assets.models?.cockpit) {
      this.cockpit = instantiate(assets.models.cockpit).root;
      this.cockpit.visible = false;
      this.ship.group.add(this.cockpit);
      this.cockpitDisplay = new CockpitDisplay(this.cockpit, this.hud);
    }
    this.cockpitEye = COCKPIT_EYE.clone();
    this.viewMode = 'chase';
    try {
      if (localStorage.getItem(VIEW_KEY) === 'cockpit' && this.cockpit) this.viewMode = 'cockpit';
    } catch {
      // Storage unavailable: keep the default view.
    }
    this.setView(this.viewMode);

    this.build = new BuildMode(this);
    this.turretControl = new TurretControl(this);
    this.badges = new TurretBadges(this);
    this.overcharge = 0; // seconds of shield overcharge left (from a manned Shield Generator)
    this.hangar = new Hangar(this);
    this.war = new GroundWar(this);
    this.mechs = new Mechs(this);
    this.companion = new Companion(this);
    this.baseUI = new BaseUI(this);
    this.pendingTroops = 0;
    this.warTimer = 0;
    this.fadeEl = document.getElementById('fade');
    this.turretSoundCooldown = 0;

    window.addEventListener('resize', () => this.onResize());
    document.getElementById('restart-btn').addEventListener('click', () => this._fadeThen(() => this.newGame()));
    document.getElementById('retry-btn').addEventListener('click', () => {
      const save = loadSave();
      if (save) this._fadeThen(() => this.loadGame(save));
    });
    document.getElementById('build-btn').addEventListener('click', () => this.toggleBuild());
    document.getElementById('view-btn').addEventListener('click', () => this.toggleView());
    this.nextWaveBtn = document.getElementById('next-wave-btn');
    this.nextWaveBtn.addEventListener('click', () => this.callNextWave());
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'KeyP' || (e.code === 'Escape' && this.paused)) {
        this.togglePause();
        return;
      }
      if (this.paused) return;
      if (this.state === 'base') return;
      if (e.code === 'Escape' && this.state === 'playing' && !this.build.active) {
        this.togglePause(true);
        return;
      }
      if (this.state === 'turret') {
        if (e.code === 'KeyF' || e.code === 'Escape') this.turretControl.exit();
        return;
      }
      if (e.code === 'KeyF') this.turretControl.tryEnterNearest();
      else if (e.code === 'KeyB') this.toggleBuild();
      else if (e.code === 'KeyV') this.toggleView();
      else if (e.code === 'Escape' && this.build.active) this.build.exit();
      else if (e.code === 'KeyN' || e.code === 'Enter') this.callNextWave();
    });

    this._bindPause();
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    window.__game = this;
    if (location.search.includes('debug')) window.THREE = THREE; // test harness access // handy for debugging from the console
    this._updateCamera(1);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // Pause menu (P / Esc / pause buttons) with the mouse sensitivity setting.
  _bindPause() {
    const $ = (id) => document.getElementById(id);
    this.pauseEl = $('pause-menu');
    const slider = $('sens-slider');
    const value = $('sens-value');
    const show = () => (value.textContent = `${settings.sensitivity.toFixed(2)}×`);
    slider.value = settings.sensitivity;
    show();
    slider.addEventListener('input', () => {
      settings.sensitivity = +slider.value;
      show();
      saveSettings();
    });
    $('pause-resume').addEventListener('click', () => this.togglePause(false));
    $('pause-quit').addEventListener('click', () => location.reload());
    for (const id of ['pause-btn', 'base-pause-btn']) $(id)?.addEventListener('click', () => this.togglePause(true));
  }

  togglePause(on = !this.paused) {
    if (!['playing', 'turret', 'build', 'base'].includes(this.state)) on = false;
    if (on === !!this.paused) return;
    this.paused = on;
    this.pauseEl.classList.toggle('hidden', !on);
    document.body.classList.toggle('paused', on);
    if (on) {
      this.input.mouseDown = false;
      this.input.keys.clear();
      if (document.pointerLockElement) document.exitPointerLock?.();
    }
  }

  // Every game starts in the home base; the first level launches from the hangar.
  start(save = null, { promo = null } = {}) {
    document.getElementById('touch-controls').classList.toggle('hidden', !this.isTouch);
    if (save) this.loadGame(save);
    else this.newGame();
    if (promo) this.applyPromo(promo);
  }

  newGame() {
    this.loadGame({
      level: 1,
      coins: CONFIG.startCoins,
      score: 0,
      planetHp: CONFIG.planet.hp,
      upgrades: {},
      turrets: [],
      cargo: null,
      promosUsed: [],
    });
    this.saveProgress(null);
  }

  // Grants a promo code's coins once per save. Returns 'ok' or 'used'.
  applyPromo(promo) {
    this.promosUsed ??= [];
    if (this.promosUsed.includes(promo.id)) {
      this.baseUI.toast(`Promo ${promo.id} was already used in this save`);
      return 'used';
    }
    this.promosUsed.push(promo.id);
    this.coins += promo.coins;
    this.audio.coin();
    this.baseUI.refresh();
    this.saveProgress();
    this.baseUI.toast(`PROMO ${promo.id} · +${promo.coins.toLocaleString('en-US')} coins`);
    return 'ok';
  }

  // ------------------------------------------------------------ home base

  _fadeThen(fn) {
    this.fadeEl.classList.add('on');
    setTimeout(() => {
      fn();
      this.fadeEl.classList.remove('on');
    }, 650);
  }

  enterBase(cargo) {
    if (this.build.active) this.build.exit();
    if (this.turretControl.active) this.turretControl.exit();
    this.overcharge = 0;
    this._fadeThen(() => {
      // Any coins still floating around are beamed aboard.
      for (const c of this.pickups.coins) if (c.active) this.coins += c.value;
      this.pickups.clear();
      this.enemies.clear();
      this.bosses.clear();
      this.lasers.clear();
      this.enemyLasers.clear();
      this.turretLasers.clear();
      this.heavyLasers.clear();
      this.missiles.clear();

      this.state = 'base';
      document.body.classList.remove('turbo');
      this._wasTurbo = false;
      document.body.classList.add('base-mode');
      this.hud.show(false);
      this.renderPass.scene = this.hangar.scene;
      this.renderPass.camera = this.hangar.camera;
      this.bloom.strength = 0.3;
      this.war.clear();
      this.war.secured = false;
      this.warReturn = false;
      this.mechs.parkAll();
      this.hangar.enter();
      this.baseUI.show(cargo);
      this.saveProgress(cargo);
      // A dropship that landed right at the end of the level still gets its fight.
      if (this.pendingTroops > 0) {
        this.warTimer = 0;
        this.hangar.pos.set(0, 1.7, 9);
        this.war.start(Math.min(this.pendingTroops, 14));
        this.pendingTroops = 0;
      }
    });
  }

  // An enemy dropship touched down: its troops will storm the base in a few seconds.
  _onDropshipLanded() {
    this.pendingTroops += CONFIG.war.troopsPerDropship + this.waves.level;
    if (this.warTimer > 0) return;
    this.warTimer = 3.5;
    this.hud.banner('DROPSHIP LANDED', 'Enemy troops are storming your base · get back there!', { danger: true, duration: 3200 });
    this.audio.alarm();
    setTimeout(() => this.audio.alarm(), 900);
  }

  // Space pauses while the player defends the base on foot (or in a mech).
  enterBaseBattle() {
    if (this.build.active) this.build.exit();
    if (this.turretControl.active) this.turretControl.exit();
    const troops = Math.min(this.pendingTroops, 14);
    this.pendingTroops = 0;
    this._fadeThen(() => {
      this.state = 'base';
      document.body.classList.remove('turbo');
      this._wasTurbo = false;
      document.body.classList.add('base-mode');
      this.hud.show(false);
      this.renderPass.scene = this.hangar.scene;
      this.renderPass.camera = this.hangar.camera;
      this.bloom.strength = 0.3;
      this.mechs.parkAll();
      this.hangar.enter();
      // Start in the middle of the hangar, facing the open mouth.
      this.hangar.pos.set(0, 1.7, 9);
      this.baseUI.show(this.baseUI.cargo);
      this.warReturn = true;
      this.war.start(troops);
      this.baseUI.toast('INVADERS IN THE BASE! Click to shoot · E to use a mech or the Armory');
    });
  }

  // Back to the fight in orbit after the base is secured (the level carries on).
  resumeFromBase() {
    this._fadeThen(() => {
      if (this.mechs.piloting) this.mechs.exit(true);
      this.war.clear();
      this.war.secured = false;
      this.hangar.exit();
      this.baseUI.hide();
      document.body.classList.remove('base-mode');
      this.renderPass.scene = this.scene;
      this.renderPass.camera = this.camera;
      this.bloom.strength = 0.7;
      this.hud.show(true);
      this.ship.reset();
      this.camQuat.copy(this.ship.group.quaternion);
      this.state = 'playing';
      this.hud.banner('BACK IN ORBIT', 'Stop the next dropships before they land!', { duration: 3000 });
    });
  }

  launchFromBase() {
    this._fadeThen(() => {
      if (this.mechs.piloting) this.mechs.exit(true);
      this.war.clear();
      this.hangar.exit();
      this.baseUI.hide();
      document.body.classList.remove('base-mode');
      this.renderPass.scene = this.scene;
      this.renderPass.camera = this.camera;
      this.bloom.strength = 0.7;
      this.hud.show(true);

      this.applyShipUpgrades();
      this.ship.reset();
      this.camQuat.copy(this.ship.group.quaternion);
      this.respawnTimer = 0;
      this.levelKills = 0;
      this.waves.state = 'break';
      this.waves.wave = 0;
      this.waves.timer = CONFIG.waves.firstBreak;
      this.waves.queue = [];
      this.state = 'playing';
      this.saveProgress();
      const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
      const mods = UPGRADES.filter((u) => this.upgrades[u.id] > 0).map((u) => `${u.name} ${ROMAN[this.upgrades[u.id]]}`);
      this.hud.banner(
        `LEVEL ${this.waves.level}`,
        mods.length ? `Ship upgrades online: ${mods.join(' · ')}` : 'The enemy fleet returns · reinforce your turrets',
        { duration: mods.length ? 4500 : 3500 }
      );
    });
  }

  // Floating cities drifting in the homeworld's upper atmosphere (scenery only).
  _addAerostats(model) {
    if (!model) return;
    const R = CONFIG.planet.radius;
    this.aerostats = new THREE.Group();
    for (const [lat, lon] of [[0.35, 0.4], [-0.2, 2.6], [0.55, 4.4]]) {
      const n = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      const { root } = instantiate(model);
      root.position.copy(n).multiplyScalar(R + 9);
      root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      root.scale.setScalar(0.45);
      this.aerostats.add(root);
    }
    this.scene.add(this.aerostats);
  }

  // Apply upgrade stats and show them on the ship: bolted-on mods, laser bolts, HUD strip.
  applyShipUpgrades() {
    applyUpgrades(this.upgrades);
    const up = this.upgrades;
    this.ship.model.mods.set(up);
    this.hangar?.ship.model.mods.set(up);
    const k = (up.damage ?? 0) / MAX_UPGRADE;
    this.lasers.setStyle(
      new THREE.Color(1.2, 3.2, 8).lerp(new THREE.Color(3.4, 4.8, 8), k),
      1 + k * 1.1,
      1 + k * 0.4
    );
    this.hud.setMods?.(up);
  }

  saveProgress(cargo = this.baseUI?.cargo ?? null) {
    writeSave({
      level: this.waves.level,
      coins: this.coins,
      score: this.score,
      planetHp: this.planetHp,
      upgrades: this.upgrades,
      promosUsed: this.promosUsed ?? [],
      turrets: this.turrets.slots.filter((s) => s.turret).map((s) => ({ slot: s.index, type: s.turret.type, level: s.turret.level, spent: s.turret.spent })),
      mechs: this.mechs.serialize(),
      sentries: this.war.sentries.map((s) => s.level),
      companion: this.companion.serialize(),
      cargo,
    });
  }

  // Restore a saved game and drop the player into the home base.
  loadGame(save) {
    document.getElementById('game-over').classList.add('hidden');
    this.restart();
    this.waves.level = save.level;
    this.coins = save.coins ?? CONFIG.startCoins;
    this.score = save.score ?? 0;
    this.planetHp = save.planetHp ?? CONFIG.planet.hp;
    this.promosUsed = save.promosUsed ?? [];
    this.upgrades = { ...emptyUpgrades(), ...save.upgrades };
    this.applyShipUpgrades();
    for (const t of save.turrets ?? []) {
      const slot = this.turrets.slots[t.slot];
      if (!slot || slot.turret || !CONFIG.turrets.types[t.type]) continue;
      const built = this.turrets.build(slot, t.type);
      built.level = Math.min(t.level, CONFIG.turrets.maxLevel);
      built.spent = t.spent;
      this.turrets._refreshPips(built);
    }
    this.planet.setShield(this.turrets.shieldReduction);
    this.mechs.load(save.mechs ?? {});
    this.war.sentries.forEach((s, i) => this.war.setSentryLevel(s, Math.min(save.sentries?.[i] ?? 0, 5)));
    this.companion.load(save.companion);
    this.state = 'base';
    document.body.classList.remove('turbo');
    this._wasTurbo = false;
    document.body.classList.add('base-mode');
    this.hud.show(false);
    this.renderPass.scene = this.hangar.scene;
    this.renderPass.camera = this.hangar.camera;
    this.bloom.strength = 0.3;
    this.hangar.enter();
    this.baseUI.show(save.cargo ?? null);
  }

  toggleView() {
    if (this.state !== 'playing' || !this.cockpit) return;
    this.setView(this.viewMode === 'chase' ? 'cockpit' : 'chase');
    try {
      localStorage.setItem(VIEW_KEY, this.viewMode);
    } catch {
      // Not critical.
    }
  }

  setView(mode) {
    this.viewMode = mode;
    const cockpit = mode === 'cockpit';
    if (this.cockpit) this.cockpit.visible = cockpit;
    // Hide the hull (and its engine flames) from the inside.
    this.ship.model.root.visible = !cockpit;
    document.body.classList.toggle('cockpit-view', cockpit);
    this.camQuat.copy(this.ship.group.quaternion);
  }

  toggleBuild() {
    if (this.build.active) this.build.exit();
    else if (this.state === 'playing') {
      this.state = 'build';
      this.dust.lines.visible = false;
      this.build.enter();
    }
  }

  onBuildExit() {
    this.state = 'playing';
    this.dust.lines.visible = true;
    this.input.mouseDown = false;
    this.input.mouseActive = false; // don't yank the ship towards a stale cursor position
    this.camQuat.copy(this.ship.group.quaternion);
  }

  callNextWave() {
    if ((this.state !== 'playing' && this.state !== 'turret') || this.waves.state !== 'break') return;
    const bonus = this.waves.skip();
    if (bonus > 0) {
      this.coins += bonus;
      this.audio.coin();
    }
  }

  restart() {
    if (this.build.active) this.build.exit();
    if (this.turretControl.active) this.turretControl.exit();
    if (this.mechs.piloting) this.mechs.exit(true);
    this.war.clear();
    this.war.secured = false;
    this.pendingTroops = 0;
    this.warTimer = 0;
    this.overcharge = 0;
    if (this.state === 'base') {
      this.hangar.exit();
      this.baseUI.hide();
      document.body.classList.remove('base-mode');
      this.renderPass.scene = this.scene;
      this.renderPass.camera = this.camera;
      this.bloom.strength = 0.7;
    }
    this.hud.show(true);
    document.getElementById('game-over').classList.add('hidden');
    this.ship.reset();
    this.enemies.clear();
    this.bosses.clear();
    this.lasers.clear();
    this.enemyLasers.clear();
    this.pickups.clear();
    this.turrets.clear();
    this.turretLasers.clear();
    this.heavyLasers.clear();
    this.missiles.clear();
    this.planet.setShield(0);
    this.waves.reset();
    this.score = 0;
    this.coins = CONFIG.startCoins;
    this.planetHp = CONFIG.planet.hp;
    this.levelKills = 0;
    this.upgrades = emptyUpgrades();
    this.applyShipUpgrades();
    this.ship.reset(); // pick up the reset stats
    this.respawnTimer = 0;
    this.camQuat.copy(this.ship.group.quaternion);
    this.state = 'playing';
    this.hud.banner('DEFEND YOUR HOMEWORLD', 'Build turrets before the first wave arrives', { duration: 3500 });
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.effects.onResize(this.pixelRatio);
    this.hangar.onResize();
  }

  frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    if (!this.paused) {
      this.time += dt;
      this.update(dt);
    }
    this.badges.update();
    this.composer.render();
  }

  update(dt) {
    if (this.state === 'base') {
      this.input.update();
      const canMove = !this.baseUI.panelOpen;
      if (this.mechs.piloting) {
        this.mechs.updatePilot(dt, this.input, canMove);
        this.hangar.target = null;
      } else if (!this.war.player.dead) {
        this.hangar.update(dt, this.input, canMove);
      }
      this.hangar.updateAmbient(dt);
      this.mechs.update(dt);
      this.companion.update(dt, this.input);
      this.war.update(dt, this.input, canMove);
      this.planet.update(dt);
      this.baseUI.update();
      return;
    }
    if (this.state === 'build') {
      // Paused: only the tactical camera and cosmetic bits move.
      this.build.update(dt, this.camera);
      this.planet.update(dt * 0.2);
      this.sky.update(this.camera, this.time);
      this.hud.update(this);
      return;
    }
    const manning = this.state === 'turret';
    const playing = this.state === 'playing' || manning;
    this.input.update();

    if (playing) this.waves.update(dt);
    if (playing && this.warTimer > 0) {
      this.warTimer -= dt;
      if (this.warTimer <= 0) this.enterBaseBattle();
    }

    if (manning) {
      // The player is in a turret: the docked ship idles, the turret takes the input.
      this.turretControl.update(dt);
    } else {
      this._updateControls(dt, playing);
      if (this.ship.alive) this.ship.update(dt, this.controls, this.time);
      this._updateAim();
      if (playing && this.ship.alive) this._handleFiring(dt);
    }

    // Turbo feedback: whoosh on engage, speed-line overlay while active.
    const turbo = this.ship.boosting && this.state === 'playing';
    if (turbo && !this._wasTurbo) this.audio.dash(0.7);
    if (turbo !== this._wasTurbo) document.body.classList.toggle('turbo', turbo);
    this._wasTurbo = turbo;

    // Shield overcharge from a manned Shield Generator.
    if (this.overcharge > 0) this.overcharge = Math.max(0, this.overcharge - dt);
    this.planet.setShield(this.shieldReduction);

    this.planet.update(dt);
    if (this.aerostats) this.aerostats.rotation.y = this.planet.surface.rotation.y;
    this.asteroids.update(dt);
    this._refreshTargets();
    this.enemies.update(dt, {
      ship: this.ship,
      planetRadius: CONFIG.planet.radius,
      lasers: this.enemyLasers,
      time: this.time,
      onLanded: (e) => this._onDropshipLanded(e),
    });
    if (this.state !== 'menu') {
      this.bosses.update(dt, {
        ship: this.ship,
        lasers: this.enemyLasers,
        enemies: this.enemies,
        turrets: this.turrets,
        time: this.time,
        audio: this.audio,
        damagePlanet: (amount, at) => this._damagePlanet(amount, at),
        banner: (title, sub, opts) => this.hud.banner(title, sub, opts),
      });
      this.turrets.update(dt, {
        targets: this.targets,
        lasers: this.turretLasers,
        heavy: this.heavyLasers,
        missiles: this.missiles,
        time: this.time,
        onFire: (type, slot) => this._turretSound(type, slot),
      });
      this.missiles.update(dt, { list: this.targets }, (p, damage, splash) => this._missileExplode(p, damage, splash));
    }
    this.lasers.update(dt);
    this.turretLasers.update(dt);
    this.heavyLasers.update(dt);
    this.enemyLasers.update(dt);
    if (this.state !== 'menu') this._collisions();

    const collected = this.pickups.update(dt, this.ship.group.position, this.time, this.ship.alive);
    if (collected > 0) {
      // Salvage bonus accumulates fractions so +15% on single coins still pays out.
      this.coinFrac = (this.coinFrac ?? 0) + collected * (1 + CONFIG.coins.bonus);
      const whole = Math.floor(this.coinFrac);
      this.coinFrac -= whole;
      this.coins += whole;
      this.audio.coin();
    }

    if (playing && !this.ship.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.ship.reset();
        this.camQuat.copy(this.ship.group.quaternion);
        this.hud.banner('SHIP RESPAWNED', 'Back to the fight');
      }
    }

    this.effects.update(dt, 0, this.camera);
    if (!manning) this._updateCamera(dt);
    this.turretControl.updatePrompt();
    this.dust.update(this.camera.position, this.ship.velocity);
    this.sky.update(this.camera, this.time);

    if (this.state !== 'menu') this.hud.update(this);
    if (this.viewMode === 'cockpit' && this.cockpit?.visible) this.cockpitDisplay?.update(this);
    this.nextWaveBtn.classList.toggle('hidden', !(playing && this.waves.state === 'break'));
    this.hitSoundCooldown -= dt;
    this.turretSoundCooldown -= dt;
  }

  _updateControls(dt, playing) {
    const c = this.controls;
    const pos = this.ship.group.position;

    if (!playing) {
      // Attract mode / game over: lazy orbit around the planet.
      const toC = this._v.copy(pos).negate().applyQuaternion(this._q.copy(this.ship.group.quaternion).invert());
      c.yaw = THREE.MathUtils.clamp(toC.x * 0.01 + 0.25, -1, 1);
      c.pitch = THREE.MathUtils.clamp(toC.y * 0.01, -1, 1);
      c.roll = 0;
      c.throttle = -0.3;
      c.boost = false;
      this.outOfBounds = false;
      return;
    }

    const input = this.input;
    // Where the ship's nose points on screen: steering is relative to this.
    const nose = this._v.copy(this.ship.forward).multiplyScalar(AIM_DISTANCE).add(pos).project(this.camera);
    let sx = input.keySteer.x;
    let sy = input.keySteer.y;
    if (!this.isTouch && sx === 0 && sy === 0 && input.mouseActive) {
      // Mouse sensitivity: how far from the nose the cursor must be for a full-rate turn.
      const span = 0.45 / settings.sensitivity;
      const dz = (v) => (Math.abs(v) < 0.035 ? 0 : (v - Math.sign(v) * 0.035) / span);
      sx = dz(input.aim.x - nose.x);
      sy = dz(input.aim.y - nose.y);
    }
    c.yaw = THREE.MathUtils.clamp(sx, -1, 1);
    c.pitch = THREE.MathUtils.clamp(sy, -1, 1);
    c.roll = input.roll;
    c.throttle = input.throttle;
    c.boost = input.boost;

    // Crosshair: the mouse on desktop, the ship's nose on touch.
    if (this.isTouch || !input.mouseActive) this.aimNdc.set(nose.x, nose.y);
    else this.aimNdc.set(input.aim.x, input.aim.y);
    this.hud.setCrosshair(this.aimNdc.x, this.aimNdc.y);

    // Leaving the arena: take over and turn back towards the planet.
    this.outOfBounds = pos.length() > CONFIG.arenaRadius;
    if (this.outOfBounds) {
      const local = this._v2.copy(pos).negate().normalize().applyQuaternion(this._q.copy(this.ship.group.quaternion).invert());
      c.yaw = THREE.MathUtils.clamp(local.x * 3, -1, 1);
      c.pitch = THREE.MathUtils.clamp(local.y * 3, -1, 1);
      if (local.z > 0) c.yaw = c.yaw >= 0 ? 1 : -1; // target behind us: hard turn
    }
  }

  _updateAim() {
    this.raycaster.setFromCamera(this.aimNdc, this.camera);
    const ray = this.raycaster.ray;
    let best = AIM_DISTANCE;
    let lock = null;

    // Lasers converge on whatever is under the crosshair; touch gets a wide aim assist.
    const assist = this.isTouch ? 9 : 2;
    for (const e of this.targets) {
      if (!e.active) continue;
      const along = this._v.subVectors(e.group.position, ray.origin).dot(ray.direction);
      if (along < 5 || along > 600) continue;
      const r = e.radius + assist + (this.isTouch ? along * 0.03 : 0);
      if (ray.distanceSqToPoint(e.group.position) < r * r && along < best + 50) {
        best = along;
        lock = e;
      }
    }
    for (const a of this.asteroids.list) {
      const along = this._v.subVectors(a.mesh.position, ray.origin).dot(ray.direction);
      if (along < 5 || along > best) continue;
      if (ray.distanceSqToPoint(a.mesh.position) < a.radius * a.radius) best = along - a.radius * 0.5;
    }
    const planetHit = ray.intersectSphere(new THREE.Sphere(ORIGIN, CONFIG.planet.radius), this._v2);
    if (planetHit) best = Math.min(best, ray.origin.distanceTo(planetHit));

    if (lock && this.isTouch) {
      // Lead the target a little so assisted shots actually connect.
      const d = this.ship.group.position.distanceTo(lock.group.position);
      const fwd = this._v.set(0, 0, -1).applyQuaternion(lock.group.quaternion);
      this.aimPoint.copy(lock.group.position).addScaledVector(fwd, lock.speed * (d / CONFIG.laser.speed));
    } else {
      ray.at(Math.max(best, 15), this.aimPoint);
    }
  }

  _handleFiring(dt) {
    this.fireTimer -= dt;
    if (!this.input.fire || this.fireTimer > 0) return;
    this.fireTimer = CONFIG.laser.fireInterval;
    const muzzle = this.ship.nextMuzzle(this._v2);
    this.lasers.fire(muzzle, this.aimPoint, CONFIG.laser.damage);
    this.effects.sparks(muzzle, 3, new THREE.Color(1.5, 3, 6), 6, 0.5, 0.08);
    this.audio.laser();
  }

  _collisions() {
    const R = CONFIG.planet.radius;
    const shipPos = this.ship.group.position;
    const hot = new THREE.Color(3, 2.2, 1.2);

    // Player lasers vs enemies, asteroids and the planet.
    for (const l of this.lasers.list) {
      if (!l.active) continue;
      let hitSomething = false;
      for (const e of this.targets) {
        if (!e.active) continue;
        const hit = segmentHitsSphere(l.prev, l.mesh.position, e.group.position, e.radius);
        if (!hit) continue;
        this.effects.sparks(hit, 10, hot, 22, 0.5, 0.3);
        this._hitSound();
        this._hitTarget(e, l.damage, hit);
        hitSomething = true;
        break;
      }
      if (!hitSomething) {
        for (const a of this.asteroids.list) {
          const hit = segmentHitsSphere(l.prev, l.mesh.position, a.mesh.position, a.radius * 0.95);
          if (!hit) continue;
          this.effects.sparks(hit, 8, hot, 18, 0.5, 0.3);
          this._hitSound();
          const destroyed = this.asteroids.damage(a, l.damage);
          if (destroyed) this._onAsteroidDestroyed(destroyed);
          hitSomething = true;
          break;
        }
      }
      if (!hitSomething && l.mesh.position.lengthSq() < R * R) {
        this.effects.sparks(l.mesh.position, 4, hot, 8, 0.4, 0.2);
        hitSomething = true;
      }
      if (hitSomething) this.lasers.kill(l);
    }

    // Turret lasers vs enemies (they pass harmlessly through everything else).
    for (const pool of [this.turretLasers, this.heavyLasers]) {
      const heavy = pool === this.heavyLasers;
      for (const l of pool.list) {
        if (!l.active) continue;
        for (const e of this.targets) {
          if (!e.active) continue;
          const hit = segmentHitsSphere(l.prev, l.mesh.position, e.group.position, e.radius + (heavy ? 1 : 0));
          if (!hit) continue;
          pool.kill(l);
          if (heavy) this.effects.sparks(hit, 14, new THREE.Color(5, 1.5, 1), 28, 0.6, 0.45);
          else this.effects.sparks(hit, 6, new THREE.Color(1, 3.5, 3), 16, 0.4, 0.25);
          this._hitTarget(e, l.damage, hit);
          break;
        }
      }
    }

    // Enemy lasers vs the player and the planet.
    for (const l of this.enemyLasers.list) {
      if (!l.active) continue;
      if (this.ship.alive && segmentHitsSphere(l.prev, l.mesh.position, shipPos, this.ship.radius + 0.4)) {
        this.enemyLasers.kill(l);
        this._damageShip(l.damage, l.mesh.position);
        continue;
      }
      if (l.mesh.position.lengthSq() < R * R) {
        this.enemyLasers.kill(l);
        this._damagePlanet(l.planetDamage ?? 0.1, l.mesh.position);
        continue;
      }
      for (const a of this.asteroids.list) {
        if (l.mesh.position.distanceToSquared(a.mesh.position) < a.radius * a.radius) {
          this.enemyLasers.kill(l);
          this.effects.sparks(l.mesh.position, 5, new THREE.Color(4, 1.2, 0.4), 10, 0.4, 0.2);
          break;
        }
      }
    }

    if (!this.ship.alive || this.state !== 'playing') return;

    // Ship vs asteroids.
    for (const a of this.asteroids.list) {
      const r = a.radius * 0.85 + this.ship.radius;
      if (a.mesh.position.distanceToSquared(shipPos) > r * r) continue;
      const destroyed = this.asteroids.damage(a, 1e6);
      if (destroyed) this._onAsteroidDestroyed(destroyed);
      this._damageShip(8 + a.radius * 2.2, shipPos, true);
      break;
    }

    // Ship vs enemy ships (ramming hurts both).
    for (const e of this.enemies.list) {
      if (!e.active) continue;
      const r = e.radius + this.ship.radius;
      if (e.group.position.distanceToSquared(shipPos) > r * r) continue;
      this.enemies.damage(e, 1e6);
      this._onEnemyDestroyed(e);
      this._damageShip(20, shipPos, true);
      break;
    }

    // Ship vs boss hull: solid, hurts, pushes the ship away.
    for (const t of this.bosses.targets) {
      if (!t.active || t.kind !== 'segment') continue;
      const r = t.radius + this.ship.radius;
      const dsq = t.group.position.distanceToSquared(shipPos);
      if (dsq > r * r) continue;
      const n = this._v.subVectors(shipPos, t.group.position).normalize();
      shipPos.copy(t.group.position).addScaledVector(n, r + 0.5);
      this._damageShip(18, shipPos, true);
      break;
    }

    // Ship vs planet surface: bounce off.
    const d = shipPos.length();
    if (d < R + 4) {
      const n = this._v.copy(shipPos).normalize();
      shipPos.copy(n).multiplyScalar(R + 4);
      this._m.lookAt(shipPos, this._v2.copy(shipPos).addScaledVector(n, 10), this.ship.forward.clone());
      this._q.setFromRotationMatrix(this._m);
      this.ship.group.quaternion.rotateTowards(this._q, 0.6);
      this._damageShip(15, shipPos, true);
    }
  }

  _hitSound() {
    if (this.hitSoundCooldown > 0) return;
    this.audio.hit();
    this.hitSoundCooldown = 0.06;
  }

  _damageShip(amount, at, impact = false) {
    if (this.ship.invulnerable > 0) return;
    const dead = this.ship.takeDamage(amount);
    if (impact) {
      this.ship.invulnerable = 0.6;
      this.audio.explosion(0.8);
      this.effects.shake = Math.max(this.effects.shake, 0.8);
    } else {
      this.effects.shake = Math.max(this.effects.shake, 0.35);
    }
    this.effects.sparks(at, 8, new THREE.Color(4, 1.2, 0.4), 14, 0.5, 0.3);
    this.audio.damage();
    this.hud.damageFlash();
    if (dead) this._onShipDestroyed();
  }

  _turretSound(type, slot) {
    if (this.turretSoundCooldown > 0) return;
    // Quieter the further the turret is from the camera.
    const d = slot.pos.distanceTo(this.camera.position);
    const vol = THREE.MathUtils.clamp(1 - d / 500, 0.08, 0.5);
    if (type === 'laser') this.audio.laser(vol);
    else this.audio.dash(vol);
    this.turretSoundCooldown = 0.07;
  }

  _missileExplode(p, damage, splash) {
    this.effects.explosion(p, 3.5, 0);
    const d = p.distanceTo(this.camera.position);
    this.audio.explosion(THREE.MathUtils.clamp(1 - d / 600, 0.2, 0.9));
    for (const e of this.targets) {
      if (!e.active) continue;
      if (e.group.position.distanceTo(p) > splash + e.radius) continue;
      this._hitTarget(e, damage, p);
    }
  }

  _refreshTargets() {
    const t = this.targets;
    t.length = 0;
    for (const e of this.enemies.list) if (e.active) t.push(e);
    for (const b of this.bosses.targets) if (b.active) t.push(b);
  }

  // Route damage to a regular enemy or a boss part.
  _hitTarget(t, amount, at) {
    if (!t.active) return;
    if (!t.boss) {
      if (this.enemies.damage(t, amount)) this._onEnemyDestroyed(t);
      return;
    }
    const r = this.bosses.damage(t, amount);
    if (r.absorbed) this.effects.sparks(at, 6, new THREE.Color(0.6, 2, 4), 14, 0.4, 0.2);
    if (r.partDestroyed) {
      this.effects.explosion(t.group.position.clone(), 5, 0);
      this.audio.explosion(1.2);
      this.pickups.spawnCoins(t.group.position, 3, 1);
      this.score += 300 * this.waves.level;
    }
    if (r.bossDestroyed) this._onBossDestroyed();
  }

  _onBossDestroyed() {
    const boss = this.bosses.boss;
    const level = this.waves.level;
    this.score += 3000 * level;
    this.hud.banner(`${boss.def.name} DESTROYED`, `+${3000 * level} score · collect the salvage!`, { duration: 3500 });
    // A chain of explosions along the hull, then it's gone.
    const points = this.bosses.hullPoints(10);
    points.forEach((p, i) =>
      setTimeout(() => {
        this.effects.explosion(p, 10 + Math.random() * 8, 0);
        this.audio.explosion(1.6);
        this.effects.shake = Math.max(this.effects.shake, 0.6);
      }, i * 180)
    );
    setTimeout(() => {
      const c = boss.root.position.clone();
      this.effects.explosion(c, 28, 0);
      this.audio.explosion(3);
      this.pickups.spawnCoins(c, 8, 5);
      this.pickups.spawnCoins(c, 20, 1);
      this.bosses.clear();
    }, points.length * 180 + 200);
  }

  get shieldReduction() {
    return Math.min(0.9, this.turrets.shieldReduction + (this.overcharge > 0 ? 0.5 : 0));
  }

  _damagePlanet(amount, at) {
    if (this.state !== 'playing' && this.state !== 'turret') return;
    const reduction = this.shieldReduction;
    amount *= 1 - reduction;
    this.planetHp = Math.max(0, this.planetHp - amount);
    this.planet.flash(reduction > 0, at);
    this.effects.sparks(at, amount > 0.5 ? 26 : 8, new THREE.Color(4, 1.4, 0.4), amount > 0.5 ? 26 : 10, 0.9, 0.6);
    if (amount > 0.5) this.effects.ring(at, 8, 0.4);
    if (this.planetHp <= 0) this._onPlanetDestroyed();
  }

  _onEnemyDestroyed(e) {
    this.levelKills++;
    const cfg = CONFIG.enemies[e.type];
    const p = e.group.position;
    this.effects.explosion(p, e.radius * 1.3, 0);
    const big = e.type === 'bomber' || e.type === 'dropship';
    this.audio.explosion(big ? 1.5 : 1);
    this.score += cfg.score * this.waves.level;
    this.pickups.spawnCoins(p, cfg.coins, 1);
    if (big) this.pickups.spawnCoins(p, e.type === 'dropship' ? 2 : 1, 5);
    if (e.type === 'dropship') this.hud.banner('DROPSHIP DOWN', 'Its boarding party died with it', { duration: 2000 });
  }

  _onAsteroidDestroyed({ position, radius }) {
    this.effects.explosion(position, radius, 0);
    this.audio.explosion(Math.min(0.5 + radius / 8, 1.6));
    this.score += Math.round(radius * 8);
    this.pickups.spawnCoins(position, Math.ceil(radius / 4), 1);
  }

  _onShipDestroyed() {
    const p = this.ship.group.position.clone();
    this.effects.explosion(p, 6, 0);
    this.effects.explosion(p, 3, 0);
    this.audio.explosion(2);
    this.ship.group.visible = false;
    this.respawnTimer = CONFIG.ship.respawnTime;
    this.coins = Math.floor(this.coins * 0.9); // small penalty
  }

  _onPlanetDestroyed() {
    if (this.turretControl.active) this.turretControl.exit();
    this.state = 'over';
    this.effects.shake = 1;
    this.audio.explosion(2.5);
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Vector3().randomDirection().multiplyScalar(CONFIG.planet.radius);
      setTimeout(() => this.effects.explosion(p, 14, 0), i * 220);
    }
    this.hud.banner('HOMEWORLD LOST', '', { danger: true, duration: 2200 });
    setTimeout(() => {
      document.getElementById('final-level').textContent = this.waves.level;
      document.getElementById('final-wave').textContent = Math.max(this.waves.wave, 1);
      document.getElementById('final-score').textContent = this.score.toLocaleString('en-US');
      document.getElementById('final-coins').textContent = this.coins;
      document.getElementById('retry-btn').classList.toggle('hidden', !loadSave());
      document.getElementById('game-over').classList.remove('hidden');
    }, 2400);
  }

  _updateCamera(dt) {
    const cam = this.camera;
    const shipQ = this.ship.group.quaternion;
    if (this.viewMode === 'cockpit' && this.ship.alive) {
      // Locked to the ship, with a touch of bank from the visual roll.
      this.camQuat.copy(shipQ);
      cam.quaternion.copy(shipQ).multiply(this._q.setFromAxisAngle(Z_AXIS, this.ship.model.roll.rotation.z * 0.35));
      cam.position.copy(this.cockpitEye).applyQuaternion(shipQ).add(this.ship.group.position);
      this._applyShakeAndFov(dt);
      return;
    }
    this.camQuat.slerp(shipQ, 1 - Math.exp(-5 * dt));
    cam.quaternion.copy(this.camQuat).multiply(CAM_TILT);
    cam.position.copy(CAM_OFFSET).applyQuaternion(this.camQuat).add(this.ship.group.position);
    this._applyShakeAndFov(dt);
  }

  _applyShakeAndFov(dt) {
    const cam = this.camera;
    const s = this.effects.shake;
    if (s > 0) {
      cam.position.x += (Math.random() - 0.5) * s * s * 1.6;
      cam.position.y += (Math.random() - 0.5) * s * s * 1.6;
    }

    const targetFov = this.ship.boosting ? this.baseFov + 16 : this.baseFov;
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, 1 - Math.exp(-5 * dt));
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }
}
