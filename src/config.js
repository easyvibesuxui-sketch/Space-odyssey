// Tunable gameplay constants.
export const CONFIG = {
  // Ship flies inside this box (world units); the camera follows from behind.
  bounds: { x: 38, y: 20 },
  // How fast the world streams past the ship (gives the "flying forward" feel).
  flowSpeed: 42,
  // Field depth: objects spawn at spawnZ and are recycled after passing despawnZ.
  spawnZ: -950,
  despawnZ: 40,

  ship: {
    accel: 140,
    maxSpeed: 34,
    damping: 4.5,
    hull: 100,
    shield: 50,
    shieldRegenDelay: 3,
    shieldRegenRate: 12,
    dashSpeed: 95,
    dashTime: 0.22,
    dashCooldown: 1.4,
  },

  laser: {
    speed: 520,
    fireInterval: 0.11,
    damage: 10,
    life: 1.4,
  },

  asteroids: {
    count: 46,
    minSize: 2,
    maxSize: 13,
    spreadX: 170,
    spreadY: 90,
  },

  coins: {
    magnetRadius: 18,
    collectRadius: 3.2,
    life: 20,
  },
};
