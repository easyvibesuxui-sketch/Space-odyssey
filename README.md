# Space Odyssey

3D space shooter / planet defense in the browser (Three.js + Vite).

Fly freely around your homeworld and destroy the enemy fleets that attack it in waves.
Fighters either hunt you or raid the planet; bombers settle into low orbit and bombard it.
If the planet's HP reaches zero the game is over; if your ship is destroyed it respawns.

Between waves, open the **tactical view** (B / BUILD) to spend coins on orbital turrets:
Laser Turret (fast, anti-fighter), Missile Battery (homing, splash) and Shield Generator
(reduces planet damage). Turrets upgrade to level 3 and sell for 50%. Calling the next wave
early (N / NEXT WAVE) pays bonus coins.

**Play:** https://easyvibesuxui-sketch.github.io/Space-odyssey/

## Run

```bash
npm install
npm run dev      # dev server (also reachable from your phone on the same Wi-Fi)
npm run build    # production build in dist/
```

## Controls

| Desktop | Mobile |
|---|---|
| Mouse: steer & aim (ship turns towards the crosshair) | Stick: steer |
| Click / Space: fire | FIRE button (with aim assist) |
| W / S: throttle · A / D: roll · arrows: pitch/yaw | |
| Shift: boost | BOOST button |
| B: tactical/build view · N: call next wave early | BUILD / NEXT WAVE buttons |

## Structure

- `src/Game.js` – main loop, collisions, camera
- `src/config.js` – all tunable gameplay numbers
- `src/entities/Ship.js` – player ship + flight model (placeholder model, swap for a GLB later)
- `src/entities/Enemies.js` – enemy fighters/bombers and their AI
- `src/world/` – sky/nebula/sun, procedural planet, asteroid belt, space dust
- `src/systems/` – lasers, missiles, turrets, waves, particles/explosions, coin pickups
- `src/ui/Hud.js` – HUD, radar, off-screen enemy markers, banners
- `src/ui/BuildMode.js` – tactical view: orbit camera, slot picking, build/upgrade/sell panel
- `src/core/` – input (keyboard/mouse/touch), procedural audio, asset loading
- `public/assets/` – Kling-generated coin, turret icons, preloader video and poster
