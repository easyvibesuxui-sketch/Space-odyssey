// Tunable gameplay constants.
export const CONFIG = {
  planet: {
    radius: 80,
    hp: 100,
  },
  // Players are gently steered back if they fly further than this from the planet.
  arenaRadius: 850,

  ship: {
    speed: 24,
    minSpeed: 10,
    maxSpeed: 36,
    boostSpeed: 105, // turbo (hold Shift / TURBO)
    accel: 45,
    turnRate: 1.5, // rad/s at full stick
    rollRate: 2.6,
    hull: 100,
    shield: 60,
    shieldRegenDelay: 3,
    shieldRegenRate: 14,
    boostMax: 100,
    boostDrain: 30,
    boostRegen: 18,
    respawnTime: 3,
  },

  laser: {
    speed: 540,
    fireInterval: 0.12,
    damage: 10,
    life: 1.2,
  },

  enemyLaser: {
    speed: 170,
    life: 3,
  },

  enemies: {
    fighter: { hp: 30, speed: 40, turnRate: 1.35, radius: 4.2, damage: 5, fireInterval: 0.85, range: 230, coins: 3, score: 100 },
    bomber: { hp: 110, speed: 20, turnRate: 0.65, radius: 8, damage: 4, fireInterval: 1.5, range: 170, coins: 7, score: 250 },
    // Elite hunter: fast, tough, always goes for the player.
    interceptor: { hp: 75, speed: 52, turnRate: 1.6, radius: 5.5, damage: 7, fireInterval: 0.6, range: 250, coins: 8, score: 300 },
    // Troop carrier: dives for the surface; if it lands, the fight moves to your base.
    dropship: { hp: 220, speed: 15, turnRate: 0.5, radius: 11, damage: 3, fireInterval: 2.2, range: 140, coins: 12, score: 400 },
  },

  startCoins: 100,

  waves: {
    perLevel: 5,
    firstBreak: 20,
    breakTime: 25,
    spawnDistance: 640,
    spawnInterval: 0.9,
  },

  belt: {
    inner: 165,
    outer: 255,
    thickness: 22,
    count: 34,
    minSize: 2.5,
    maxSize: 11,
  },

  turrets: {
    orbit: 106, // distance of the slots from the planet centre
    maxLevel: 5,
    sellRefund: 0.5,
    // Per-level multipliers.
    damageMul: [1, 1.4, 1.85, 2.4, 3.1],
    intervalMul: [1, 0.88, 0.76, 0.66, 0.56],
    rangeMul: [1, 1.08, 1.16, 1.25, 1.35],
    types: {
      laser: {
        name: 'Laser Turret',
        desc: 'Rapid-fire lasers. Shreds fighters.',
        cost: 60,
        range: 210,
        damage: 7,
        interval: 0.32,
        color: '#4fd8ff',
        icon: 'turret-laser.jpg',
      },
      missile: {
        name: 'Missile Battery',
        desc: 'Homing missiles with splash damage. Cracks bombers.',
        cost: 120,
        range: 330,
        damage: 34,
        splash: 16,
        interval: 2.4,
        color: '#ff9b3d',
        icon: 'turret-missile.jpg',
      },
      cannon: {
        name: 'Rail Cannon',
        desc: 'Very long range, heavy single shots. Snipes interceptors and dropships.',
        cost: 200,
        range: 420,
        damage: 70,
        interval: 2.2,
        color: '#ff4d5e',
        icon: 'turret-cannon.jpg',
      },
      shield: {
        name: 'Shield Generator',
        desc: 'Planetary shield: the homeworld takes less damage.',
        cost: 150,
        reduction: [0.12, 0.17, 0.22, 0.27, 0.32], // per level, stacking, capped
        maxReduction: 0.7,
        color: '#4dffa6',
        icon: 'turret-shield.jpg',
      },
    },
  },

  // Ground war inside the home base (after an enemy dropship lands).
  war: {
    troopsPerDropship: 4, // + level
    maxActive: 6,
    planetDrain: 0.12, // homeworld HP lost per second per invader in the base
    invader: { hp: 60, speed: 3.2, damage: 6, fireInterval: 1.3, range: 24, coins: 6 },
    player: { hp: 100, regenDelay: 4, regen: 10, damage: 12, interval: 0.16, respawn: 4 },
    companion: { name: 'JAR JAR', hp: 150, damage: 8, interval: 0.6, range: 26, reviveTime: 2, reviveCost: 120 },
    // Pilotable mechs bought at the Armory; they wait in their bays between fights.
    mechs: {
      haze: {
        name: 'Haze Skirmisher', model: 'mech-haze', cost: 900, hp: 450, speed: 8.5,
        desc: 'Light and fast. Rapid-fire rifle.', color: '#4fd8ff',
        weapon: { kind: 'bolt', damage: 15, interval: 0.11, speed: 170, color: [1, 3.2, 5], size: 0.2 },
        muzzles: [[0.42, 0.62, -0.55]], walk: [3.2, 6.4], bay: [-19, -20],
      },
      centurion: {
        name: 'Centurion Assault', model: 'mech-centurion', cost: 1800, hp: 1000, speed: 6,
        desc: 'Heavy armour. Explosive autocannons.', color: '#ff9b3d',
        weapon: { kind: 'bolt', damage: 42, interval: 0.38, speed: 140, color: [5, 2, 0.6], size: 0.38, splash: 3 },
        muzzles: [[0.45, 0.62, -0.5], [-0.45, 0.62, -0.5]], walk: [0.6, 3.0], bay: [19, -20],
      },
      pelter: {
        name: 'Pelter Artillery', model: 'mech-pelter', cost: 2800, hp: 800, speed: 5,
        desc: 'Lobs artillery shells with a huge blast radius.', color: '#ff4d5e',
        weapon: { kind: 'shell', damage: 95, interval: 1.1, speed: 34, color: [5, 1.2, 0.8], size: 0.5, splash: 6 },
        muzzles: [[0.4, 0.88, -0.45], [-0.4, 0.88, -0.45]], walk: [0, 4.5], bay: [-19, -6],
      },
      epic: {
        name: 'Le Epic Mech', model: 'mech-epic', cost: 4500, hp: 1600, speed: 6.5,
        desc: 'The big one. Armoured brawler with a rotary cannon.', color: '#ffc94a',
        weapon: { kind: 'bolt', damage: 22, interval: 0.07, speed: 180, color: [5, 3.6, 1], size: 0.22 },
        muzzles: [[0.45, 0.55, -0.6]], walk: null, bay: [19, -6],
      },
    },
    repairShare: 0.25, // repairing a wrecked mech costs this share of its price
    // Automatic base sentries (one design per level).
    sentries: { slots: [[-12, -24], [12, -24]], costs: [400, 700, 1100, 1600, 2300], damage: [8, 12, 17, 23, 30], interval: 0.45, range: 32 },
  },

  coins: {
    // Coins burst out of wrecks, then fly to the player by themselves after this delay.
    homingDelay: 0.45,
    bonus: 0, // extra coin fraction from the Salvage upgrade
    magnetRadius: 24,
    collectRadius: 3.6,
    life: 25,
  },
};
