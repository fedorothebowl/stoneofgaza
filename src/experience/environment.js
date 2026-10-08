import * as THREE from 'three';
import * as C from './config.js';
import { gridSizeFor } from './grid.js';

const mix = (from, to, t) => from + (to - from) * t;

function createDarkSky() {
  const geometry = new THREE.SphereGeometry(2000, 64, 64);
  const material = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 midColor;
      uniform float intensity;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 color;
        if (h > 0.0) {
          color = mix(midColor, topColor, h);
        } else {
          color = mix(midColor, bottomColor, -h);
        }
        gl_FragColor = vec4(color * intensity, 1.0);
      }
    `,
    uniforms: {
      topColor:    { value: new THREE.Color(C.COLOR_SKY_TOP) },
      midColor:    { value: new THREE.Color(C.COLOR_SKY_MID) },
      bottomColor: { value: new THREE.Color(C.COLOR_SKY_BOTTOM) },
      intensity:   { value: C.INITIAL_SKY }
    },
    side: THREE.BackSide
  });
  return new THREE.Mesh(geometry, material);
}

function createTerrain(size) {
  const segments = Math.min(150, Math.floor(size / 2.5));
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color:     C.COLOR_FLOOR,
    roughness: 0.95,
    metalness: 0.0,
    emissive:  C.COLOR_FLOOR_EMISSIVE,
    side:      THREE.DoubleSide
  });

  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  return terrain;
}

function createSun() {
  const sun = new THREE.DirectionalLight(C.COLOR_DIRECTIONAL, C.INITIAL_DIRECTIONAL);
  sun.position.set(-70, 75, -70);
  sun.castShadow = true;
  sun.shadow.mapSize.width  = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near   = 0.5;
  sun.shadow.camera.far    = 300;
  sun.shadow.camera.left   = -80;
  sun.shadow.camera.right  =  80;
  sun.shadow.camera.top    =  80;
  sun.shadow.camera.bottom = -80;
  return sun;
}

// Cielo, nebbia, luci e terreno
export class Environment {
  #sky; #fog; #hemisphere; #sun; #ambient; #fill; #back;

  constructor(scene, totalCount) {
    this.#sky = createDarkSky();
    scene.add(this.#sky);

    this.#fog = new THREE.FogExp2(C.COLOR_FOG, C.INITIAL_FOG_DENSITY);
    scene.fog = this.#fog;

    this.#hemisphere = new THREE.HemisphereLight(C.COLOR_HEMI_SKY, C.COLOR_HEMI_GROUND, C.INITIAL_HEMISPHERE);
    scene.add(this.#hemisphere);

    this.#sun = createSun();
    scene.add(this.#sun);
    scene.add(this.#sun.target);

    this.#ambient = new THREE.AmbientLight(C.COLOR_AMBIENT, C.INITIAL_AMBIENT);
    scene.add(this.#ambient);

    this.#fill = new THREE.PointLight(C.COLOR_FILL, C.INITIAL_FILL);
    this.#fill.position.set(10, 30, 10);
    scene.add(this.#fill);

    this.#back = new THREE.PointLight(C.COLOR_BACK, C.INITIAL_BACK);
    this.#back.position.set(-20, 25, -30);
    scene.add(this.#back);

    scene.add(createTerrain((gridSizeFor(totalCount) + 15) * C.SPACING));
  }

  // Eye adaptation: luci, cielo e nebbia passano dai valori INITIAL ai TARGET
  adapt(elapsedSeconds) {
    let factor = Math.min(1, elapsedSeconds * C.DEV_SPEED_MULT / C.EYE_ADAPTATION_SECS);
    factor = Math.pow(factor, 1.2);

    this.#hemisphere.intensity = mix(C.INITIAL_HEMISPHERE,  C.TARGET_HEMISPHERE,  factor);
    this.#sun.intensity        = mix(C.INITIAL_DIRECTIONAL, C.TARGET_DIRECTIONAL, factor);
    this.#ambient.intensity    = mix(C.INITIAL_AMBIENT,     C.TARGET_AMBIENT,     factor);
    this.#fill.intensity       = mix(C.INITIAL_FILL,        C.TARGET_FILL,        factor);
    this.#back.intensity       = mix(C.INITIAL_BACK,        C.TARGET_BACK,        factor);

    this.#sky.material.uniforms.intensity.value = mix(C.INITIAL_SKY, C.TARGET_SKY, factor);
    this.#fog.density = mix(C.INITIAL_FOG_DENSITY, C.TARGET_FOG_DENSITY, factor);
  }

  // Tiene la shadow camera centrata sul giocatore.
  // Snap in light-space to eliminate shadow shimmer (shadow cam axes are 45° from world XZ)
  // shadow_cam_x = (-0.7071, 0, 0.7071), shadow_cam_y·xz = (0.5299, 0, 0.5299)
  follow(x, z) {
    const texel = 160 / 2048;
    const u = Math.round(0.7071 * (z - x) / texel) * texel;
    const v = Math.round(0.5299 * (x + z) / texel) * texel;
    const sx = (1.8870 * v - 1.4142 * u) / 2;
    const sz = (1.8870 * v + 1.4142 * u) / 2;
    this.#sun.position.set(sx - 70, 75, sz - 70);
    this.#sun.target.position.set(sx, 0, sz);
    this.#sun.target.updateMatrixWorld();
  }

  // Direzione da cui arriva la luce del sole
  getSunDirection(target) {
    return target.subVectors(this.#sun.position, this.#sun.target.position).normalize();
  }
}
