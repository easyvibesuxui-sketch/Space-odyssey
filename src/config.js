// Tunable gameplay constants.
export const CONFIG = {
  planet: {
    radius: 80,
    hp: 100,
  },
  // Players are gently steered back if they fly further than this from the planet.
  arenaRadius: 850,

  ship: {
    speed: 46,
    minSpeed: 18,
    maxSpeed: 72,
    boostSpeed: 125,
    accel: 55,
    turnRate: 1.9, // rad/s at full stick
    rollRate: 2.6,
    hull: 100,
    shield: 60,
    shieldRegenDelay: 3,
    shieldRegenRate: 14,
    boostMax: 100,
    boostDrain: 38,
    boostRegen: 20,
    respawnTime: 3,
  },

  laser: {
    speed: 650,
    fireInterval: 0.1,
    damage: 10,
    life: 1.2,
  },

  enemyLaser: {
    speed: 230,
    life: 3,
  },

  enemies: {
    fighter: { hp: 30, speed: 52, turnRate: 1.7, radius: 4.2, damage: 5, fireInterval: 0.55, range: 230, coins: 3, score: 100 },
    bomber: { hp: 110, speed: 26, turnRate: 0.8, radius: 8, damage: 4, fireInterval: 1.1, range: 170, coins: 7, score: 250 },
  },

  startCoins: 100,

  waves: {
    perLevel: 5,
    firstBreak: 15,
    breakTime: 20,
    spawnDistance: 560,
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
    maxLevel: 3,
    sellRefund: 0.5,
    // Per-level multipliers.
    damageMul: [1, 1.45, 2.0],
    intervalMul: [1, 0.85, 0.7],
    rangeMul: [1, 1.1, 1.2],
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
      shield: {
        name: 'Shield Generator',
        desc: 'Planetary shield: the homeworld takes less damage.',
        cost: 150,
        reduction: [0.15, 0.22, 0.3], // per level, stacking, capped
        maxReduction: 0.7,
        color: '#4dffa6',
        icon: 'turret-shield.jpg',
      },
    },
  },

  coins: {
    magnetRadius: 24,
    collectRadius: 3.6,
    life: 25,
  },
};
