import * as THREE from 'three';
import { SUN_DIR } from './Sky.js';
import { CONFIG } from '../config.js';

// The homeworld the player defends. Surface and clouds are generated procedurally.
export class Planet {
  constructor(scene, renderer) {
    const R = CONFIG.planet.radius;
    this.radius = R;
    this.group = new THREE.Group();
    scene.add(this.group);

    const { color, data } = makePlanetTextures(renderer);

    this.surface = new THREE.Mesh(
      new THREE.SphereGeometry(R, 128, 96),
      // data.r = terrain height (bump), data.g = cloud cover.
      new THREE.MeshStandardMaterial({ map: color, bumpMap: data, bumpScale: 2.5, roughness: 0.8, metalness: 0.0 })
    );
    this.group.add(this.surface);

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.018, 96, 64),
      new THREE.MeshStandardMaterial({ alphaMap: data, color: 0xffffff, transparent: true, depthWrite: false, roughness: 1 })
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

    // Hex-patterned energy shield, raised by Shield Generator turrets.
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.2, 64, 40),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        uniforms: { uStrength: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 }, uHitPos: { value: new THREE.Vector3() } },
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vView;
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            vUv = uv;
            vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uStrength;
          uniform float uFlash;
          uniform float uTime;
          uniform vec3 uHitPos;
          varying vec3 vN;
          varying vec3 vView;
          varying vec2 vUv;
          varying vec3 vWorld;
          // Distance to the nearest hexagon edge.
          float hexEdge(vec2 p) {
            p.x *= 1.1547;
            p.y += mod(floor(p.x), 2.0) * 0.5;
            p = abs(fract(p) - 0.5);
            return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
          }
          void main() {
            float rim = pow(1.0 - abs(dot(vN, vView)), 5.0);
            float hex = 1.0 - smoothstep(0.0, 0.08, hexEdge(vUv * vec2(48.0, 24.0)));
            float pulse = 0.6 + 0.4 * sin(uTime * 2.0 + vUv.y * 20.0);
            // Impacts light up a local patch of hexes around the hit point.
            float local = smoothstep(32.0, 0.0, distance(vWorld, uHitPos));
            float a = (rim * 0.6 + hex * 0.12 * pulse) * uStrength + (0.35 + hex) * local * uFlash;
            gl_FragColor = vec4(vec3(0.3, 2.0, 1.2) * a, 1.0);
          }
        `,
      })
    );
    this.shield.visible = false;
    this.group.add(this.shield);
    this.shieldFlash = 0;

    this.hitFlash = 0;
  }

  flash(absorbed = false, at = null) {
    if (absorbed) {
      this.shieldFlash = 1;
      // Project the impact onto the shield surface.
      if (at) this.shield.material.uniforms.uHitPos.value.copy(at).setLength(this.radius * 1.2);
    } else {
      this.hitFlash = 1;
    }
  }

  // reduction in [0, 1]: how much of the incoming damage the shield absorbs.
  setShield(reduction) {
    this.shieldLevel = reduction;
  }

  update(dt) {
    this.surface.rotation.y += dt * 0.01;
    this.clouds.rotation.y += dt * 0.016;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5);
    this.atmosphere.material.uniforms.uHit.value = this.hitFlash;

    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 3);
    const u = this.shield.material.uniforms;
    u.uStrength.value = Math.min(this.shieldLevel ?? 0, 0.5) * 0.35 + ((this.shieldLevel ?? 0) > 0 ? 0.03 : 0);
    u.uFlash.value = this.shieldFlash * 0.8;
    u.uTime.value += dt;
    this.shield.visible = (this.shieldLevel ?? 0) > 0;
  }
}

// Surface colour + height/cloud maps rendered once on the GPU (fast, and sharp up close).
// The fragment shader maps each texel back to its direction on the sphere using the same
// UV layout as THREE.SphereGeometry, so the noise is seamless.
function makePlanetTextures(renderer) {
  const W = 2048;
  const H = 1024;
  const opts = {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  };
  const colorRT = new THREE.WebGLRenderTarget(W, H, { ...opts, colorSpace: THREE.SRGBColorSpace });
  const dataRT = new THREE.WebGLRenderTarget(W, H, opts);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  colorRT.texture.anisotropy = aniso;
  dataRT.texture.anisotropy = aniso;

  const material = new THREE.ShaderMaterial({
    uniforms: { uMode: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform int uMode;
      varying vec2 vUv;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
          mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
          f.z) * 2.0 - 1.0;
      }
      float fbm(vec3 p, int oct) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 9; i++) {
          if (i >= oct) break;
          v += a * noise(p);
          p = p * 2.07 + vec3(1.7, 9.2, 3.1);
          a *= 0.5;
        }
        return v;
      }
      vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

      void main() {
        // Same parametrisation as THREE.SphereGeometry.
        float phi = vUv.x * 6.28318530718;
        float theta = (1.0 - vUv.y) * 3.14159265359;
        vec3 d = vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));

        // Domain-warped continents.
        vec3 q = d * 1.6 + vec3(3.1, 0.0, 0.0);
        q += 0.35 * vec3(fbm(d * 2.0 + 5.0, 4), fbm(d * 2.0 + 13.0, 4), fbm(d * 2.0 + 29.0, 4));
        float h = fbm(q, 8) + 0.3 * fbm(d * 5.0 + 21.0, 6) + 0.05;

        if (uMode == 1) {
          float cn = fbm(d * vec3(2.5, 4.5, 2.5) + 11.0 + 0.25 * fbm(d * 3.0 + 40.0, 4), 7);
          float cloud = clamp((cn - 0.06) * 2.8, 0.0, 1.0);
          gl_FragColor = vec4(max(h, 0.0) * 2.0, cloud, 0.0, 1.0);
          return;
        }

        vec3 deep = vec3(8.0, 32.0, 78.0) / 255.0;
        vec3 shallow = vec3(26.0, 100.0, 156.0) / 255.0;
        vec3 sand = vec3(178.0, 166.0, 120.0) / 255.0;
        vec3 grass = vec3(56.0, 108.0, 58.0) / 255.0;
        vec3 forest = vec3(30.0, 70.0, 42.0) / 255.0;
        vec3 rock = vec3(112.0, 98.0, 82.0) / 255.0;
        vec3 snow = vec3(235.0, 240.0, 245.0) / 255.0;

        vec3 c;
        if (h < 0.0) c = mix(shallow, deep, clamp(-h * 4.0, 0.0, 1.0));
        else if (h < 0.02) c = sand;
        else if (h < 0.17) c = mix(grass, forest, (h - 0.02) / 0.15);
        else if (h < 0.3) c = mix(forest, rock, (h - 0.17) / 0.13);
        else c = mix(rock, snow, clamp((h - 0.3) / 0.12, 0.0, 1.0));
        // Subtle colour variation so large areas aren't flat.
        c *= 0.9 + 0.2 * fbm(d * 12.0 + 3.0, 4);

        float ice = abs(d.y) + fbm(d * 4.0 + 7.0, 4) * 0.12;
        c = mix(c, snow, smoothstep(0.84, 0.88, ice));

        gl_FragColor = vec4(toLinear(c), 1.0);
      }
    `,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const prev = renderer.getRenderTarget();
  material.uniforms.uMode.value = 0;
  renderer.setRenderTarget(colorRT);
  renderer.render(scene, cam);
  material.uniforms.uMode.value = 1;
  renderer.setRenderTarget(dataRT);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);

  material.dispose();
  quad.geometry.dispose();
  return { color: colorRT.texture, data: dataRT.texture };
}
