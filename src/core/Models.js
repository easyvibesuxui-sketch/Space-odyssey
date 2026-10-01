import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

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
};

// Third-party models used in the game (all from Sketchfab).
export const CREDITS = [
  { what: 'Player ship', title: 'Spaceship COLAID1 50k', author: 'Jungle Jim', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/spaceship-colaid1-50k-34acc30c89364a668ab1025686a686bc' },
  { what: 'Enemy fighter', title: 'Cool Alien Spaceship', author: 'Jungle Jim', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/cool-alien-spaceship-by-jungle-jim-62918957e1fd4667b679259c95822c5e' },
  { what: 'Enemy bomber', title: 'spaceship51', author: 'mohamedhussien', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/spaceship51-6d3cd3a61b4b4b0fb079f4eacac8d542' },
  { what: 'Bosses', title: 'UNSA Destroyer / spaceship', author: 'xaxary', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/unsa-destroyer-spaceship-0fd8c6ecd9374392a1ed900e82d7417d' },
  { what: 'Cockpit', title: 'New Futuristic Combat Jet Cockpit (Wip-1)', author: '3DHaupt', license: 'CC-BY-NC-4.0', url: 'https://sketchfab.com/3d-models/new-futuristic-combat-jet-cockpit-wip-1-cfd497076a514a458c248bfb7f4fd5b2' },
  { what: 'Base corridor', title: 'Sci-Fi Corridor - Revisited 2019', author: 'Robert Berrier', license: 'CC-BY-4.0', url: 'https://sketchfab.com/3d-models/sci-fi-corridor-revisited-2019-e3bc70aa659a4459b8dc29bd563aff08' },
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
  inner.rotation.y = spec.rotY;
  inner.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(inner);
  const raw = box.getSize(new THREE.Vector3());
  const s = spec.length ? spec.length / raw.z : spec.scale;
  inner.scale.setScalar(s);
  inner.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.x -= c.x;
  inner.position.z -= c.z;
  if (spec.floor) inner.position.y -= box.min.y;
  else if (!spec.keepY) inner.position.y -= c.y;

  inner.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = false;
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
  const size = new THREE.Box3().setFromObject(template).getSize(new THREE.Vector3());
  return { template, size, animations: gltf.animations };
}

// Returns a fresh instance. With ownMaterials, materials are cloned so the copy can flash
// independently (hit feedback) without affecting other instances.
export function instantiate(model, { ownMaterials = false } = {}) {
  const obj = model.template.clone(true);
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
