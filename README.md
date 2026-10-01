# Space Odyssey

3D space shooter / tower defense in the browser (Three.js + Vite).

## Run

```bash
npm install
npm run dev      # dev server (also reachable from your phone on the same Wi-Fi)
npm run build    # production build in dist/
```

## Controls

| Desktop | Mobile |
|---|---|
| WASD / arrows: move | Left stick: move |
| Mouse: aim | Drag on screen: aim (with aim assist) |
| Click / Space: fire | FIRE button |
| Shift: dash (barrel roll, brief invulnerability) | DASH button |

## Structure

- `src/Game.js` – main loop, collisions, camera
- `src/config.js` – all tunable gameplay numbers
- `src/entities/Ship.js` – player ship (placeholder model, swap for a GLB later)
- `src/world/` – sky/nebula/sun, asteroid field, space dust
- `src/systems/` – lasers, particles/explosions, coin pickups
- `src/core/` – input (keyboard/mouse/touch), procedural audio, asset loading
- `public/assets/` – Kling-generated coin, preloader video and poster
