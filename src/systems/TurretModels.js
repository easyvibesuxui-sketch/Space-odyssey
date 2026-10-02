import * as THREE from 'three';

// Pulls individual turrets out of the two turret packs (they ship as one scene each, with
// every turret laid out side by side). Geometry is cut out by position, re-centred so the
// yaw pivot is at the origin and the barrels point down +Z (Object3D.lookAt convention).

const SUFFIX = ['', 'B', 'C', 'D', 'E']; // Zeus pack colour variants = turret levels 1..5

// Orbital turret designs in the Zeus pack: head mesh (level-1 geometry) + material family.
const ZEUS = {
  laser: { head: 'Object_15', mat: 'TwinGun' },
  missile: { head: 'Object_10', mat: 'RocketLauncher', yawFrom: 'Object_3' },
  cannon: { head: 'Object_3', mat: 'Flak' },
};

const cache = new Map();

// Compressed models store positions/normals as normalised integers (dequantised by the node
// transform), so baking a transform in place would clip them: copy to float32 first.
function floatGeometry(src) {
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.index) out.setIndex(Array.from(src.index.array));
  return out;
}

function worldGeometry(mesh) {
  mesh.updateWorldMatrix(true, false);
  const g = floatGeometry(mesh.geometry);
  g.applyMatrix4(mesh.matrixWorld);
  return g;
}

// Triangles of `geo` whose centroid lies within `radius` (horizontally) of (cx, cz).
function cutNear(geo, cx, cz, radius) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.attributes.position;
  const keep = [];
  for (let t = 0; t < pos.count; t += 3) {
    let x = 0;
    let z = 0;
    for (let k = 0; k < 3; k++) {
      x += pos.getX(t + k);
      z += pos.getZ(t + k);
    }
    if (Math.hypot(x / 3 - cx, z / 3 - cz) < radius) keep.push(t);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const arr = new attr.array.constructor(keep.length * 3 * attr.itemSize);
    keep.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        for (let c = 0; c < attr.itemSize; c++) arr[(i * 3 + k) * attr.itemSize + c] = attr.array[(t + k) * attr.itemSize + c];
      }
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize, attr.normalized));
  }
  return out;
}

export function findMesh(root, test) {
  let found = null;
  root.traverse((o) => {
    if (!found && o.isMesh && test(o)) found = o;
  });
  return found;
}

// Yaw pivot = centre of the head's lowest slice (its stand); barrel axis = the horizontal
// direction in which the head sticks out furthest past that pivot.
function analyseHead(geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const pos = geo.attributes.position;
  const cut = bb.min.y + (bb.max.y - bb.min.y) * 0.25;
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > cut) continue;
    sx += pos.getX(i);
    sz += pos.getZ(i);
    n++;
  }
  const px = n ? sx / n : (bb.min.x + bb.max.x) / 2;
  const pz = n ? sz / n : (bb.min.z + bb.max.z) / 2;
  // Barrel tip = the upper-half vertex furthest (horizontally) from the pivot.
  const upper = bb.min.y + (bb.max.y - bb.min.y) * 0.35;
  let best = -1;
  let dx = 0;
  let dz = 1;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < upper) continue;
    const x = pos.getX(i) - px;
    const z = pos.getZ(i) - pz;
    const d = x * x + z * z;
    if (d > best) {
      best = d;
      dx = x;
      dz = z;
    }
  }
  // Angle that turns the barrel direction onto +Z.
  return { px, pz, minY: bb.min.y, yaw: Math.atan2(-dx, dz) };
}

// Muzzle points: clusters of the front-most vertices, split left/right.
function findMuzzles(geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const pos = geo.attributes.position;
  const depth = bb.max.z - bb.min.z;
  const front = bb.max.z - depth * 0.06;
  const sides = { l: [], r: [] };
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) < front) continue;
    (pos.getX(i) < 0 ? sides.l : sides.r).push(i);
  }
  const out = [];
  for (const list of [sides.l, sides.r]) {
    if (!list.length) continue;
    const v = new THREE.Vector3();
    for (const i of list) v.add(new THREE.Vector3(pos.getX(i), pos.getY(i), bb.max.z));
    out.push(v.divideScalar(list.length));
  }
  if (!out.length) out.push(new THREE.Vector3(0, (bb.min.y + bb.max.y) / 2, bb.max.z));
  return out;
}

// Prepared (shared) geometry for one turret design.
function prepare(pack, key, headName, baseTest, baseRadius, width, yawFrom = null) {
  if (cache.has(key)) return cache.get(key);
  const root = pack.template;
  root.updateMatrixWorld(true);
  const headMesh = findMesh(root, (o) => o.name === headName);
  if (!headMesh) return null;
  const head = worldGeometry(headMesh);
  const a = analyseHead(head);
  // Boxy designs (missile pods) have no barrel to measure: borrow the yaw of a gun from the
  // same pack (all turrets in it face the same way).
  if (yawFrom) {
    const ref = findMesh(root, (o) => o.name === yawFrom);
    if (ref) a.yaw = analyseHead(worldGeometry(ref)).yaw;
  }
  // The platform under this head (packs may merge several platforms into one mesh).
  let baseMesh = null;
  let base = null;
  root.traverse((o) => {
    if (!o.isMesh || !baseTest(o)) return;
    const cut = cutNear(worldGeometry(o), a.px, a.pz, baseRadius);
    const n = cut.attributes.position.count;
    if (n && (!base || n > base.attributes.position.count)) {
      base = cut;
      baseMesh = o;
    }
  });

  // Re-centre: pivot at the origin, stand on y = 0, barrels to +Z, platform `width` wide.
  const rot = new THREE.Matrix4().makeRotationY(a.yaw);
  const baseMinY = base ? (base.computeBoundingBox(), base.boundingBox.min.y) : a.minY;
  head.translate(-a.px, -a.minY, -a.pz).applyMatrix4(rot);
  if (base) base.translate(-a.px, -baseMinY, -a.pz).applyMatrix4(rot);
  const ref = base ?? head;
  ref.computeBoundingBox();
  const w = Math.max(ref.boundingBox.max.x - ref.boundingBox.min.x, ref.boundingBox.max.z - ref.boundingBox.min.z);
  const s = width / w;
  head.scale(s, s, s);
  base?.scale(s, s, s);
  head.computeBoundingBox();
  const prepared = {
    head,
    base,
    headY: (a.minY - baseMinY) * s, // where the head's stand sits on the platform
    headTop: head.boundingBox.max.y,
    muzzles: findMuzzles(head),
    headMat: headMesh.material,
    baseMat: baseMesh?.material,
  };
  cache.set(key, prepared);
  return prepared;
}

function materialByName(root, name) {
  let mat = null;
  root.traverse((o) => {
    if (!mat && o.isMesh && o.material?.name === name) mat = o.material;
  });
  return mat;
}

// Orbital turret (laser / missile / cannon) from the Zeus pack. Returns the same shape as the
// procedural turret builder plus setLevel(level), which swaps to that level's colour scheme.
export function buildZeusTurret(pack, type) {
  const d = ZEUS[type];
  if (!pack || !d) return null;
  const p = prepare(pack, `zeus-${type}`, d.head, (o) => /^TurretBase$/.test(o.material?.name), 4.2, 7.2, d.yawFrom);
  if (!p) return null;
  const root = new THREE.Group();
  const baseMesh = p.base ? new THREE.Mesh(p.base, p.baseMat) : null;
  if (baseMesh) root.add(baseMesh);
  const head = new THREE.Group();
  head.position.y = p.headY;
  const headMesh = new THREE.Mesh(p.head, p.headMat);
  head.add(headMesh);
  root.add(head);
  const muzzles = p.muzzles.map((m) => {
    const o = new THREE.Object3D();
    o.position.copy(m);
    head.add(o);
    return o;
  });
  // Barrels rest level; lookAt() later aims the whole head.
  const setLevel = (level) => {
    const sfx = SUFFIX[Math.min(level, SUFFIX.length) - 1];
    headMesh.material = materialByName(pack.template, d.mat + sfx) ?? p.headMat;
    if (baseMesh) baseMesh.material = materialByName(pack.template, 'TurretBase' + sfx) ?? p.baseMat;
  };
  return { root, head, muzzles, eye: p.headY + p.headTop, setLevel };
}

// Base sentry from the stylized pack: design 1..5 (one per sentry level).
export function buildSentry(pack, design) {
  if (!pack) return null;
  const n = THREE.MathUtils.clamp(design, 1, 5);
  const headName = (o) => o.name.startsWith(`low_turret_${n}_`);
  const headMesh = findMesh(pack.template, headName);
  if (!headMesh) return null;
  const p = prepare(pack, `sentry-${n}`, headMesh.name, (o) => o.name.startsWith('low_bottom_'), 1.3, 2.2);
  if (!p) return null;
  const root = new THREE.Group();
  if (p.base) root.add(new THREE.Mesh(p.base, p.baseMat));
  const head = new THREE.Group();
  head.position.y = p.headY;
  head.add(new THREE.Mesh(p.head, p.headMat));
  root.add(head);
  const muzzles = p.muzzles.map((m) => {
    const o = new THREE.Object3D();
    o.position.copy(m);
    head.add(o);
    return o;
  });
  return { root, head, muzzles };
}
