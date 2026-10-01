import { CONFIG } from '../config.js';

// Snapshot of the un-upgraded values. Upgrades are always recomputed from this,
// so applying them twice never compounds.
const BASE = structuredClone({ ship: CONFIG.ship, laser: CONFIG.laser, coins: CONFIG.coins });

export const UPGRADES = [
  {
    id: 'damage',
    name: 'Laser Power',
    desc: '+20% laser damage',
    icon: 'up-damage.jpg',
    color: '#4fd8ff',
    costs: [80, 140, 220, 320, 450],
    apply: (l) => (CONFIG.laser.damage = BASE.laser.damage * (1 + 0.2 * l)),
    value: () => `${CONFIG.laser.damage.toFixed(0)} dmg`,
  },
  {
    id: 'firerate',
    name: 'Rapid Capacitors',
    desc: '+12% fire rate',
    icon: 'up-firerate.jpg',
    color: '#b98cff',
    costs: [90, 150, 230, 330, 460],
    apply: (l) => (CONFIG.laser.fireInterval = BASE.laser.fireInterval / (1 + 0.12 * l)),
    value: () => `${(1 / CONFIG.laser.fireInterval).toFixed(1)} shots/s`,
  },
  {
    id: 'hull',
    name: 'Hull Plating',
    desc: '+25 max hull',
    icon: 'up-hull.jpg',
    color: '#ff9b3d',
    costs: [70, 120, 190, 280, 400],
    apply: (l) => (CONFIG.ship.hull = BASE.ship.hull + 25 * l),
    value: () => `${CONFIG.ship.hull} hull`,
  },
  {
    id: 'shield',
    name: 'Shield Capacitor',
    desc: '+20 shield, +15% recharge',
    icon: 'up-shield.jpg',
    color: '#3da0ff',
    costs: [80, 140, 210, 300, 420],
    apply: (l) => {
      CONFIG.ship.shield = BASE.ship.shield + 20 * l;
      CONFIG.ship.shieldRegenRate = BASE.ship.shieldRegenRate * (1 + 0.15 * l);
    },
    value: () => `${CONFIG.ship.shield} shield`,
  },
  {
    id: 'engine',
    name: 'Engine Tuning',
    desc: '+8% speed, +25 boost energy',
    icon: 'up-engine.jpg',
    color: '#9fe8ff',
    costs: [60, 110, 170, 250, 350],
    apply: (l) => {
      const k = 1 + 0.08 * l;
      CONFIG.ship.speed = BASE.ship.speed * k;
      CONFIG.ship.maxSpeed = BASE.ship.maxSpeed * k;
      CONFIG.ship.boostSpeed = BASE.ship.boostSpeed * k;
      CONFIG.ship.boostMax = BASE.ship.boostMax + 25 * l;
    },
    value: () => `${Math.round(CONFIG.ship.maxSpeed)} top speed`,
  },
  {
    id: 'magnet',
    name: 'Salvage Magnet',
    desc: '+15% coins from every wreck',
    icon: 'up-magnet.jpg',
    color: '#ffc94a',
    costs: [50, 90, 140, 200, 280],
    apply: (l) => (CONFIG.coins.bonus = BASE.coins.bonus + 0.15 * l),
    value: () => `+${Math.round(CONFIG.coins.bonus * 100)}% salvage`,
  },
];

export const MAX_UPGRADE = 5;

export function emptyUpgrades() {
  return Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));
}

export function applyUpgrades(levels) {
  for (const u of UPGRADES) u.apply(levels[u.id] ?? 0);
}

export function upgradeCost(u, level) {
  return level >= MAX_UPGRADE ? null : u.costs[level];
}
