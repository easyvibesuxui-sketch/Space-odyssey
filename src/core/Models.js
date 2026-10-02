import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = import.meta.env.BASE_URL;

// How each model is normalised so gameplay code can treat them uniformly:
// ships face -Z, are centred on the origin and scaled to a target length.
const SPECS = {
  player: { file: 'player.glb', length: 6.5, rotY: Math.PI },
  fighter: { file: 'fighter.glb', length: 9, rotY: 0 },
  bomber: { file: 'bomber.glb', length: 17, rotY: 0 },
  boss: { file: 'boss.glb', length: 130, rotY: Math.PI / 2 },
  cockpit: { file: 'cockpit.glb', scale: 1, rotY: Math.PI, keepY: true },
  corridor: { file: 'corridor.glb', scale: 0.012, rotY: 0, floor: true },
  // Space: new enemy ships, boss hull, scenery.
  dropship: { file: 'dropship.glb', length: 30, rotY: Math.PI },
  interceptor: { file: 'interceptor.glb', length: 11, rotY: Math.PI },
  titan: { file: 'titan.glb', length: 100, rotY: Math.PI },
  aerostat: { file: 'aerostat.glb', length: 34, rotY: 0, solid: 0x8a6a3a },
  jupiter: { file: 'jupiter.glb', raw: true },
  // Orbital turret pack (5 colour variants = 5 levels) and base sentries/launcher.
  turrets: { file: 'turrets.glb', raw: true },
  sentries: { file: 'sentries.glb', raw: true },
  launcher: { file: 'launcher.glb', height: 5, rotY: 0, floor: true },
  // Ground war: invaders, pilotable mechs, the companion. Characters face -Z, feet at y = 0.
  trooper: { file: 'trooper.glb', height: 2.3, rotY: Math.PI, floor: true },
  'mech-haze': { file: 'mech-haze.glb', height: 5.6, rotY: Math.PI, floor: true },
  'mech-centurion': { file: 'mech-centurion.glb', height: 6.4, rotY: 0, floor: true },
  'mech-pelter': { file: 'mech-pelter.glb', height: 6.0, rotY: 0, floor: true },
  'mech-epic': { file: 'mech-epic.glb', height: 6.8, rotY: Math.PI, floor: true, remove: /^Plane/ },
  companion: { file: 'companion.glb', height: 1.95, rotY: Math.PI, floor: true },
};

// Third-party models used in the game (all from Sketchfab).
export const CREDITS = [
  { what: 'Player ship', title: 'Spaceship COLAID1 50k', author: 'Jungle Jim', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/spaceship-colaid1-50k-34acc30c89364a668ab1025686a686bc' },
  { what: 'Enemy fighter', title: 'Cool Alien Spaceship', author: 'Jungle Jim', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/cool-alien-spaceship-by-jungle-jim-62918957e1fd4667b679259c95822c5e' },
  { what: 'Enemy bomber', title: 'spaceship51', author: 'mohamedhussien', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/spaceship51-6d3cd3a61b4b4b0fb079f4eacac8d542' },
  { what: 'Bosses', title: 'UNSA Destroyer / spaceship', author: 'xaxary', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/unsa-destroyer-spaceship-0fd8c6ecd9374392a1ed900e82d7417d' },
  { what: 'Cockpit', title: 'New Futuristic Combat Jet Cockpit (Wip-1)', author: '3DHaupt', license: 'CC-BY-NC-4.0', url: 'https://sketchfab.com/3d-models/new-futuristic-combat-jet-cockpit-wip-1-cfd497076a514a458c248bfb7f4fd5b2' },
  { what: 'Base corridor', title: 'Sci-Fi Corridor - Revisited 2019', author: 'Robert Berrier', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/sci-fi-corridor-revisited-2019-e3bc70aa659a4459b8dc29bd563aff08' },
  { what: 'Enemy dropship', title: 'MS Fuel Transport', author: 'mohamedhussien', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/ms-fuel-transport-bb97ac41ad464c54a601738216a2791b' },
  { what: 'Enemy interceptor', title: 'Predator Knighthawk', author: 'mgfxer', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/predator-knighthawk-13e5c4694efe4d9394fd0f7cb750f1a5' },
  { what: 'Siege Breaker boss', title: 'Titan', author: 'mohamedhussien', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/titan-69735a69b4fc42989d573b8c57f1ec84' },
  { what: 'Aerostat stations', title: 'Venusian Aerostats', author: 'mohamedhussien', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/venusian-aerostats-5c2cb8cd6eed4c0ead642b97db9bd0f2' },
  { what: 'Jupiter', title: 'Jupiter - Free Downloadable Model', author: 'murilo.kleine', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/jupiter-free-downloadable-model-61671f29ca0a4fa39dc9653290282418' },
  { what: 'Orbital turrets', title: 'SciFi Turrets by Zeus', author: 'Zeus Game Assets', license: 'Sketchfab Standard', url: 'https://sketchfab.com/3d-models/scifi-turrets-by-zeus-457e0f52fdcf4dc482478e157e1442f0' },
  { what: 'Base sentries', title: 'Stylized Turrets Pack', author: 'Erroratten', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/stylized-turrets-pack-db0cceed70eb4d478735586e8a5b0c1d' },
  { what: 'Base rocket launchers', title: 'Futureistic Military Rocket Launcher', author: 'igor.tesV', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/futureistic-military-rocket-launcher-d25cb7c9089f4640980b0e3a2b2008c7' },
  { what: 'Invader robots', title: 'Another Robot', author: 'Lagst', license: 'Sketchfab Standard', url: 'https://sketchfab.com/3d-models/another-robot-b5187425ddb14676a93ab21f050e0e6f' },
  { what: 'Mech: Haze', title: 'Haze Light Skirmisher Mech', author: 'Lagst', license: 'Sketchfab Standard', url: 'https://sketchfab.com/3d-models/haze-light-skirmisher-mech-1a2296613f834f84817fe0f72e02fe52' },
  { what: 'Mech: Centurion', title: 'Centurion Heavy Assault Mech', author: 'Lagst', license: 'Sketchfab Standard', url: 'https://sketchfab.com/3d-models/centurion-heavy-assault-mech-f5536df4400d408096973799d200f797' },
  { what: 'Mech: Pelter', title: 'Pelter - Artillery Mech', author: 'Lagst', license: 'Sketchfab Standard', url: 'https://sketchfab.com/3d-models/pelter-artillery-mech-47e36fe71fd942a68eccfba2b2865f87' },
  { what: 'Mech: Le Epic Mech', title: 'Le Epic Mech', author: 'Jungle Jim', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/le-epic-mech-18feb3c805c44b98bfa62a9a00886ece' },
  { what: 'Companion', title: 'Jar Jar Binks', author: 'Mind Mulch for The Masses', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/jar-jar-binks-85aef3e496d44e9b95c7386035c0ef10' },
];

export async function loadModels(track) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const models = {};
  // One at a time: decoding dozens of textures in parallel makes browsers (especially on
  // phones) drop some of them. Every step is still tracked up front for the progress bar.
  let chain = Promise.resolve();
  for (const [name, spec] of Object.entries(SPECS)) {
    chain = chain.then(() =>
      loader
        .loadAsync(`${BASE}models/${spec.file}`)
        .then((gltf) => {
          models[name] = normalise(gltf, spec);
        })
        .catch((err) => console.warn(`Model ${name} failed to load; using a placeholder`, err))
    );
    track(chain);
  }
  await chain;
  return models;
}

function normalise(gltf, spec) {
  const inner = gltf.scene;
  let skinned = false;
  inner.traverse((o) => (skinned ||= o.isSkinnedMesh));
  if (spec.raw) {
    // Packs are taken apart at runtime; just make the scene graph static-friendly.
    inner.updateMatrixWorld(true);
    return { template: inner, size: new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3()), animations: gltf.animations, skinned, raw: true };
  }
  if (spec.remove) {
    const doomed = [];
    inner.traverse((o) => spec.remove.test(o.name) && doomed.push(o));
    for (const o of doomed) o.removeFromParent();
  }
  inner.rotation.y = spec.rotY;
  inner.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(inner, true);
  const raw = box.getSize(new THREE.Vector3());
  const s = spec.length ? spec.length / raw.z : spec.height ? spec.height / raw.y : spec.scale;
  inner.scale.setScalar(s);
  inner.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner, true);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.x -= c.x;
  inner.position.z -= c.z;
  if (spec.floor) inner.position.y -= box.min.y;
  else if (!spec.keepY) inner.position.y -= c.y;

  inner.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = false;
    // Skinned meshes animate outside their bind-pose bounds.
    if (o.isSkinnedMesh) o.frustumCulled = false;
    if (spec.solid !== undefined) {
      // Geometry stored without UVs/normals to keep the file small: plain metal finish.
      o.material = new THREE.MeshStandardMaterial({ color: spec.solid, metalness: 0.75, roughness: 0.4, flatShading: true });
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      // Real-time transmission needs an extra full-scene render pass: far too costly here.
      if (m.transmission > 0) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = 0.18;
        m.depthWrite = false;
        m.roughness = 0.05;
      }
    }
  });

  const template = new THREE.Group();
  template.add(inner);
  template.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(template, true).getSize(new THREE.Vector3());
  return { template, size, animations: gltf.animations, skinned };
}

// Returns a fresh instance. With ownMaterials, materials are cloned so the copy can flash
// independently (hit feedback) without affecting other instances.
export function instantiate(model, { ownMaterials = false } = {}) {
  // Skinned meshes need their skeleton re-bound to the cloned bones.
  const obj = model.skinned ? cloneSkinned(model.template) : model.template.clone(true);
  const materials = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (ownMaterials) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!materials.includes(m)) materials.push(m);
    }
  });
  for (const m of materials) if (m.emissive) m.userData.baseEmissive = m.emissive.clone();
  return { root: obj, materials };
}

// Hit flash: tint every material's emissive towards hot orange.
export function setFlash(materials, amount) {
  for (const m of materials) {
    if (!m.emissive) continue;
    const base = m.userData.baseEmissive;
    m.emissive.setRGB(base.r + amount, base.g + amount * 0.5, base.b + amount * 0.3);
  }
}
