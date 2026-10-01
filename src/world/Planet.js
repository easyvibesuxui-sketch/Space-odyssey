import * as THREE from 'three';
import { fbm3 } from '../core/noise.js';
import { SUN_DIR } from './Sky.js';
import { CONFIG } from '../config.js';

// The homeworld the player defends. Surface and clouds are generated procedurally.
export class Planet {
  constructor(scene) {
    const R = CONFIG.planet.radius;
    this.radius = R;
    this.group = new THREE.Group();
    scene.add(this.group);

    const { color, clouds } = makePlanetTextures();

    this.surface = new THREE.Mesh(
      new THREE.SphereGeometry(R, 96, 64),
      new THREE.MeshStandardMaterial({ map: color, roughness: 0.82, metalness: 0.0 })
    );
    this.group.add(this.surface);

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.018, 72, 48),
      new THREE.MeshStandardMaterial({ alphaMap: clouds, color: 0xffffff, transparent: true, depthWrite: false, roughness: 1 })
    );
    this.group.add(this.clouds);

    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.07, 64, 48),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uSun: { value: SUN_DIR }, uHit: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vWorldN;
          varying vec3 vView;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vWorldN = normalize(mat3(modelMatrix) * normal);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun;
          uniform float uHit;
          varying vec3 vN;
          varying vec3 vWorldN;
          varying vec3 vView;
          void main() {
            float rim = 1.0 - abs(dot(vN, vView));
            float glow = pow(clamp(rim, 0.0, 1.0), 4.0);
            // Fade out at the very edge so the halo has a soft outer boundary.
            glow *= smoothstep(1.0, 0.7, rim) * 1.3;
            float lit = 0.25 + 0.75 * clamp(dot(vWorldN, uSun) * 0.5 + 0.6, 0.0, 1.0);
            vec3 col = mix(vec3(0.25, 0.6, 1.4), vec3(2.2, 0.5, 0.25), uHit);
            gl_FragColor = vec4(col * glow * lit, 1.0);
          }
        `,
      })
    );
    this.group.add(this.atmosphere);

    this.hitFlash = 0;
  }

  flash() {
    this.hitFlash = 1;
  }

  update(dt) {
    this.surface.rotation.y += dt * 0.01;
    this.clouds.rotation.y += dt * 0.016;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5);
    this.atmosphere.material.uniforms.uHit.value = this.hitFlash;
  }
}

function makePlanetTextures() {
  const W = 512;
  const H = 256;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = W;
  colorCanvas.height = H;
  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = W;
  cloudCanvas.height = H;
  const cctx = colorCanvas.getContext('2d');
  const kctx = cloudCanvas.getContext('2d');
  const colorImg = cctx.createImageData(W, H);
  const cloudImg = kctx.createImageData(W, H);

  const mix = (a, b, t) => a + (b - a) * t;
  const mixC = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
  const deep = [8, 32, 78];
  const shallow = [26, 96, 150];
  const sand = [170, 160, 115];
  const grass = [52, 104, 58];
  const forest = [30, 72, 44];
  const rock = [112, 98, 82];
  const snow = [235, 240, 245];

  for (let y = 0; y < H; y++) {
    const lat = (y / (H - 1) - 0.5) * Math.PI;
    const cl = Math.cos(lat);
    const sy = Math.sin(-lat);
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      // Sample 3D noise on the unit sphere => no seam at the date line.
      const dx = cl * Math.cos(lon);
      const dz = cl * Math.sin(lon);
      const dy = sy;
      let h = fbm3(dx * 1.6 + 3.1, dy * 1.6, dz * 1.6, 7, 5) + 0.35 * fbm3(dx * 5, dy * 5, dz * 5, 21, 3);
      h += 0.04;
      let c;
      if (h < 0) {
        c = mixC(shallow, deep, Math.min(-h * 4, 1));
      } else if (h < 0.03) {
        c = sand;
      } else if (h < 0.18) {
        c = mixC(grass, forest, (h - 0.03) / 0.15);
      } else if (h < 0.32) {
        c = mixC(forest, rock, (h - 0.18) / 0.14);
      } else {
        c = mixC(rock, snow, Math.min((h - 0.32) / 0.12, 1));
      }
      // Polar ice caps with a ragged edge.
      const ice = Math.abs(dy) + fbm3(dx * 4, dy * 4, dz * 4, 5, 3) * 0.12;
      if (ice > 0.86) c = snow;

      const i = (y * W + x) * 4;
      colorImg.data[i] = c[0];
      colorImg.data[i + 1] = c[1];
      colorImg.data[i + 2] = c[2];
      colorImg.data[i + 3] = 255;

      const cn = fbm3(dx * 2.5 + 11, dy * 4.5, dz * 2.5, 33, 5);
      const cloud = THREE.MathUtils.clamp((cn - 0.08) * 2.6, 0, 1);
      const v = Math.round(cloud * 230);
      cloudImg.data[i] = v;
      cloudImg.data[i + 1] = v;
      cloudImg.data[i + 2] = v;
      cloudImg.data[i + 3] = 255;
    }
  }
  cctx.putImageData(colorImg, 0, 0);
  kctx.putImageData(cloudImg, 0, 0);

  const color = new THREE.CanvasTexture(colorCanvas);
  color.colorSpace = THREE.SRGBColorSpace;
  color.anisotropy = 4;
  const clouds = new THREE.CanvasTexture(cloudCanvas);
  return { color, clouds };
}
