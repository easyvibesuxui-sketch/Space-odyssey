# Space Odyssey

3D space shooter / planet defense in the browser (Three.js + Vite).

Every game starts in your **home base**; walk to your ship to launch. A promo code field on the
title screen can unlock bonus coins.

Fly freely around your homeworld and destroy the enemy fleets that attack it in waves. Salvage
coins from every wreck fly to your ship automatically.
Fighters either hunt you or raid the planet; bombers settle into low orbit and bombard it.
If the planet's HP reaches zero the game is over; if your ship is destroyed it respawns.

Between waves, open the **tactical view** (B / BUILD) to spend coins on orbital turrets:
Laser Turret (fast, anti-fighter), Missile Battery (homing, splash) and Shield Generator
(reduces planet damage). Turrets upgrade to level 3 and sell for 50%. Calling the next wave
early (N / NEXT WAVE) pays bonus coins. You can also **take control of any turret** (fly close
and press F, or TAKE CONTROL in the tactical view): aim from the gunner's seat with +50% damage,
lock missiles onto targets, or overcharge the planetary shield.

Every level ends with a **boss** (they rotate and get tougher each cycle):
**Dreadnought** (hull shielded while its orbiting drones live), **Carrier** (launches fighter
squadrons; its hangar bays armour the hull), **Siege Breaker** (charges a planet-cracker beam —
shoot its glowing core during the charge to interrupt and stun it) and **Phantom** (cloaks,
teleports, and its EMP knocks nearby turrets offline).

After every boss you return to your **home base**: a first-person hangar where you walk
around, unload the level's cargo (rewards), upgrade your ship at the Ship Systems terminal
(laser power, fire rate, hull, shield, engines, salvage bonus — 5 levels each), repair the
homeworld, then board your ship to launch the next level. Progress is saved at the base
(CONTINUE on the title screen, RETRY FROM BASE after a defeat).

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
| Shift (hold): turbo | TURBO button (hold) |
| V: cockpit / chase view | VIEW button |
| F near a turret: take manual control (F/Esc to exit) | MAN button |
| B: tactical/build view · N: call next wave early | BUILD / NEXT WAVE buttons |
| Base: WASD walk · mouse look (click to capture) · E interact · Shift run | Stick walk · drag look · tap / USE interact |

## Structure

- `src/Game.js` – main loop, collisions, camera
- `src/config.js` – all tunable gameplay numbers
- `src/entities/Ship.js` – player ship + flight model (placeholder model, swap for a GLB later)
- `src/entities/Enemies.js` – enemy fighters/bombers and their AI
- `src/entities/Bosses.js` – the four bosses, their abilities and weak points
- `src/world/` – sky/nebula/sun, procedural planet, asteroid belt, space dust
- `src/systems/` – lasers, missiles, turrets, waves, particles/explosions, coin pickups
- `src/ui/Hud.js` – HUD, radar, off-screen enemy markers, banners
- `src/systems/TurretControl.js` – manual turret control (gunner view, lock-on, overcharge)
- `src/ui/BuildMode.js` – tactical view: orbit camera, slot picking, build/upgrade/sell panel
- `src/base/Hangar.js` – first-person home base (hangar, ship on its pad, terminals, view to the planet)
- `src/ui/BaseUI.js` – base prompts and panels (cargo, ship upgrades, repair, launch)
- `src/systems/Upgrades.js` – ship upgrade definitions; `src/core/Save.js` – localStorage save
- `src/core/` – input (keyboard/mouse/touch), procedural audio, asset loading
- `src/core/Models.js` – GLB loading/normalisation (meshopt) and model credits
- `public/models/` – compressed 3D models (originals ~118 MB → ~11 MB via gltf-transform: meshopt + WebP)
- `public/assets/` – Kling-generated coin, turret and upgrade icons, preloader video and poster

## Credits

3D models from Sketchfab (shown in-game under *Credits*):

- Player ship — “Spaceship COLAID1 50k” by Jungle Jim (CC-BY-4.0)
- Enemy fighter — “Cool Alien Spaceship” by Jungle Jim (CC-BY-4.0)
- Enemy bomber — “spaceship51” by mohamedhussien (CC-BY-4.0)
- Bosses — “UNSA Destroyer / spaceship” by xaxary (CC-BY-4.0)
- Cockpit — “New Futuristic Combat Jet Cockpit (Wip-1)” by 3DHaupt (**CC-BY-NC-4.0**, non-commercial)
- Base corridor — “Sci-Fi Corridor - Revisited 2019” by Robert Berrier (CC-BY-4.0)
