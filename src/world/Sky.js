import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.5, 0.3, -1).normalize();

const NOISE_GLSL = /* glsl */ `
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)), dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                   mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)), dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
               mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)), dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                   mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)), dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }
`;

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this._buildNebula();
    this._buildStars();
    this._buildSun();
  }

  _buildNebula() {
    const geo = new THREE.SphereGeometry(1800, 48, 32);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uSunDir: { value: SUN_DIR } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        varying vec3 vDir;
        ${NOISE_GLSL}
        void main() {
          vec3 d = normalize(vDir);
          // Base: deep space blue, brighter towards the horizon of the sun side.
          vec3 deep = vec3(0.002, 0.008, 0.02);
          vec3 mid = vec3(0.008, 0.03, 0.065);
          float h = smoothstep(-0.6, 0.5, d.y);
          vec3 col = mix(mid * 0.7, deep, h * 0.6);

          // Nebula wisps.
          float n = fbm(d * 2.2 + vec3(4.0, 1.0, 0.0));
          float n2 = fbm(d * 5.0 - vec3(2.0));
          float neb = smoothstep(-0.05, 0.55, n) * (0.6 + 0.4 * n2);
          col += vec3(0.012, 0.045, 0.09) * neb;
          col += vec3(0.03, 0.012, 0.05) * smoothstep(0.25, 0.7, n2) * 0.35;

          // Glow around the sun.
          float s = max(dot(d, uSunDir), 0.0);
          col += vec3(0.08, 0.25, 0.55) * pow(s, 16.0);
          col += vec3(0.01, 0.05, 0.12) * pow(s, 4.0);

          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.nebula = new THREE.Mesh(geo, mat);
    this.nebula.renderOrder = -10;
    this.group.add(this.nebula);
  }

  _buildStars() {
    const count = 2500;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(1500);
      pos.set([v.x, v.y, v.z], i * 3);
      const t = Math.random();
      const b = 0.4 + Math.random() * 0.8;
      // Mostly white-blue, a few warm stars.
      if (t > 0.94) col.set([1.2 * b, 0.4 * b, 0.35 * b], i * 3);
      else col.set([0.75 * b, 0.85 * b, b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.2,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      fog: false,
      map: makeRadialTexture([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]),
    });
    this.stars = new THREE.Points(geo, mat);
    this.group.add(this.stars);

    // A distant red star like in the reference shot.
    const red = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeRadialTexture([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,120,110,1)'], [0.5, 'rgba(255,60,60,0.25)'], [1, 'rgba(255,0,0,0)']]),
      color: new THREE.Color(2.5, 1.2, 1.2),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }));
    red.position.set(-0.6, -0.05, -1).normalize().multiplyScalar(1400);
    red.scale.setScalar(22);
    this.group.add(red);
  }

  _buildSun() {
    const sun = new THREE.Group();
    sun.position.copy(SUN_DIR).multiplyScalar(1300);

    const add = (tex, color, sx, sy) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex,
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }));
      s.scale.set(sx, sy, 1);
      sun.add(s);
      return s;
    };

    const glow = makeRadialTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(160,220,255,0.7)'], [0.5, 'rgba(60,140,255,0.15)'], [1, 'rgba(0,60,255,0)']]);
    const core = makeRadialTexture([[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(230,245,255,0.9)'], [1, 'rgba(200,230,255,0)']]);
    const streak = makeStreakTexture();

    add(glow, new THREE.Color(0.55, 0.75, 1.2), 420, 420);
    this.sunCore = add(core, new THREE.Color(5, 5.5, 6), 90, 90);
    // Long anamorphic flare across the whole sky.
    this.streak = add(streak, new THREE.Color(0.7, 1.4, 3.2), 4200, 18);
    add(streak, new THREE.Color(0.8, 1.4, 2.4), 900, 40);
    // Diagonal starburst spikes.
    const spike1 = add(streak, new THREE.Color(0.5, 0.9, 1.6), 700, 8);
    spike1.material.rotation = 0.6;
    const spike2 = add(streak, new THREE.Color(0.5, 0.9, 1.6), 600, 6);
    spike2.material.rotation = -0.9;

    this.sun = sun;
    this.group.add(sun);

  }

  update(camera, time) {
    // Sky is infinitely far: it follows the camera.
    this.group.position.copy(camera.position);
    this.sunCore.material.opacity = 0.9 + Math.sin(time * 3.1) * 0.05 + Math.sin(time * 7.3) * 0.03;
    this.streak.scale.y = 18 + Math.sin(time * 2.3) * 2;
  }
}

export function makeRadialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, color] of stops) grad.addColorStop(o, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStreakTexture() {
  const w = 512;
  const h = 32;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const hor = g.createLinearGradient(0, 0, w, 0);
  hor.addColorStop(0, 'rgba(255,255,255,0)');
  hor.addColorStop(0.5, 'rgba(255,255,255,1)');
  hor.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hor;
  g.fillRect(0, 0, w, h);
  // Fade vertically.
  g.globalCompositeOperation = 'destination-in';
  const ver = g.createLinearGradient(0, 0, 0, h);
  ver.addColorStop(0, 'rgba(0,0,0,0)');
  ver.addColorStop(0.5, 'rgba(0,0,0,1)');
  ver.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = ver;
  g.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
