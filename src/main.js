import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// ── Rilevamento mobile ────────────────────────────────────────────────────────
const isMobile = /Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent)
  || ('ontouchstart' in window && navigator.maxTouchPoints > 1);

let camera, scene, renderer, controls;
const move = { forward: false, back: false, left: false, right: false };
const speed = 2.5;
const clock = new THREE.Clock();
let velocity = new THREE.Vector3();

// Dati caricati
let TOTAL_COUNT = 0;
let instancedMesh;
const items = [];

// Collisioni
const colliderBoxes = [];
const CAMERA_RADIUS = 1;

// Corridoi
const BASE_SPACING = 4.75;
const SPACING = BASE_SPACING * 1.1;

// Altezza
const START_HEIGHT = 50;
const GROUND_HEIGHT_OFFSET = 1.5;
let dropping = false;
let gameState = 'intro';

// Audio
const bgAudio = document.getElementById('bg-audio');
let footstepAudio;

// Terreno
let terrainMesh;
let terrainWidth  = 0;
let terrainDepth  = 0;
let apGridHalfSize = 0;

// Luci e cielo
let gameStartTime = null;
let hemisphereLight, dirLight, ambientLight, fillLight, backLight;
let skyMesh;

// Materiale condiviso per tutti i pilastri (principale + bordo)
let sharedPillarMaterial = null;

// ─────────────────────────────────────────────────────────────
// VALORI LUCI
// ─────────────────────────────────────────────────────────────
const INITIAL_HEMISPHERE  = 0.90 * 0.5;
const INITIAL_DIRECTIONAL = 2.4  * 0.5;
const INITIAL_AMBIENT     = 0.90 * 0.5;
const INITIAL_FILL        = 0.70 * 0.5;
const INITIAL_BACK        = 0.50 * 0.5;
const INITIAL_SKY         = 1.30 * 0.5;
const INITIAL_FOG_DENSITY = 0;

const TARGET_HEMISPHERE   = 0.90 * 1.5;
const TARGET_DIRECTIONAL  = 2.4  * 1.5;
const TARGET_AMBIENT      = 0.90 * 1.5;
const TARGET_FILL         = 0.70 * 1.5;
const TARGET_BACK         = 0.50 * 1.5;
const TARGET_SKY          = 1.30 * 1.5;
const TARGET_FOG_DENSITY  = 0.1;

// ─────────────────────────────────────────────────────────────
// AUTOPLAY
// ─────────────────────────────────────────────────────────────
const AUTOPLAY_IDLE_DELAY   = 5;
const AUTOPLAY_WALK_SPEED   = 1.44;
const AUTOPLAY_TURN_SECONDS = 2.6;

// ── Reading ───────────────────────────────────────────────────
const READING_TURN_SECS  = 1.2;
const READING_PITCH      = 0.28;
const READING_PITCH_LERP = 0.9;
const READING_PAUSE_SECS = 1.5;

let lastUserInputTime = null;
let autoplayActive    = false;

let apSub            = 'walking';
let apTimer          = 0;
let apWalkDist       = 0;
let apWalkedDist     = 0;
let apReadWalkDist   = 0;
let apReadWalkTarget = 0;
let apPauseDur       = 0;
let apDirIdx         = 0;
let apIntersCount    = 0;
let apIntersTarget   = 1;
let apSnapTarget     = 0;

let apReadPhase   = '';
let apReadYawBack = 0;

// ── Pitch quaternion-safe ─────────────────────────────────────
const _pitchEuler = new THREE.Euler(0, 0, 0, 'YXZ');

function getCameraPitch() {
  _pitchEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  return _pitchEuler.x;
}

function setCameraPitch(value) {
  _pitchEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  _pitchEuler.x = value;
  _pitchEuler.z = 0;
  camera.quaternion.setFromEuler(_pitchEuler);
}

function nearestCorridorCenter(pos, dirIdx) {
  const dir = AP_DIRS[dirIdx];
  const v = dir.z !== 0 ? pos.x : pos.z;
  const normalized = v + apGridHalfSize;
  const cell = Math.round(normalized / SPACING - 0.5);
  return (cell + 0.5) * SPACING - apGridHalfSize;
}

const AP_DIRS = [
  new THREE.Vector3( 0, 0, -1),
  new THREE.Vector3( 1, 0,  0),
  new THREE.Vector3( 0, 0,  1),
  new THREE.Vector3(-1, 0,  0),
];

let apYawStart  = 0;
let apYawTarget = 0;

function dirToYaw(dir) {
  return Math.atan2(-dir.x, -dir.z);
}

function isDirectionClear(fromPos, dirIdx, checkDist = 4.0) {
  const dir     = AP_DIRS[dirIdx];
  const testPos = fromPos.clone().addScaledVector(dir, checkDist);
  const sphere  = new THREE.Sphere(testPos, CAMERA_RADIUS * 1.2);
  for (const box of colliderBoxes) {
    if (box.intersectsSphere(sphere)) return false;
  }
  return true;
}

function apPickDir(emergencyCheckDist = SPACING * 0.8) {
  const camPos = controls.getObject().position;

  const right = (apDirIdx + 1) % 4;
  const left  = (apDirIdx + 3) % 4;
  const back  = (apDirIdx + 2) % 4;

  const turns = Math.random() < 0.5 ? [right, left] : [left, right];
  const candidates = [...turns, apDirIdx, back];

  let chosen = apDirIdx;
  for (const c of candidates) {
    if (isDirectionClear(camPos, c, emergencyCheckDist)) { chosen = c; break; }
  }

  apDirIdx    = chosen;
  apYawStart  = controls.getObject().rotation.y;
  apYawTarget = apYawStart + shortestYaw(apYawStart, dirToYaw(AP_DIRS[apDirIdx]));
}

function distToNextIntersection(pos, dirIdx) {
  const dir   = AP_DIRS[dirIdx];
  const S     = SPACING;
  const dSign = dir.x !== 0 ? dir.x : dir.z;
  const v     = (dir.x !== 0 ? pos.x : pos.z) + apGridHalfSize;
  const phase = ((v / S) % 1 + 1) % 1;

  let dist;
  if (dSign > 0) {
    dist = phase < 0.5 ? (0.5 - phase) * S : (1.5 - phase) * S;
  } else {
    dist = phase > 0.5 ? (phase - 0.5) * S : (phase + 0.5) * S;
  }

  if (dist < CAMERA_RADIUS) dist += S;
  return dist;
}

function distToNextPillar(pos, dirIdx) {
  const dir   = AP_DIRS[dirIdx];
  const S     = SPACING;
  const dSign = dir.x !== 0 ? dir.x : dir.z;
  const v     = (dir.x !== 0 ? pos.x : pos.z) + apGridHalfSize;
  const phase = ((v / S) % 1 + 1) % 1;

  let dist;
  if (dSign > 0) {
    dist = (1.0 - phase) * S;
  } else {
    dist = phase * S;
  }
  if (dist < CAMERA_RADIUS) dist += S;
  return dist;
}

function startAutoplay() {
  autoplayActive = true;
  apTimer = 0;

  camera.rotation.z = 0;

  const curYaw = controls.getObject().rotation.y;
  const camPos = controls.getObject().position;

  let best = 0, bestDist = Infinity;
  AP_DIRS.forEach((d, i) => {
    let diff = Math.abs(dirToYaw(d) - curYaw);
    diff = Math.min(diff, Math.PI * 2 - diff);
    const penalty = isDirectionClear(camPos, i, CAMERA_RADIUS * 2.5) ? 0 : Math.PI;
    if (diff + penalty < bestDist) { bestDist = diff + penalty; best = i; }
  });

  apDirIdx    = best;
  apYawStart  = curYaw;
  apYawTarget = dirToYaw(AP_DIRS[apDirIdx]);

  apSub            = 'snapping';
  apSnapTarget     = nearestCorridorCenter(controls.getObject().position, apDirIdx);
  apWalkDist       = distToNextIntersection(controls.getObject().position, apDirIdx);
  apWalkedDist     = 0;
  apReadWalkDist   = 0;
  apReadWalkTarget = distToNextPillar(controls.getObject().position, apDirIdx);
  apIntersCount    = 0;
  apIntersTarget   = 5 + Math.floor(Math.random() * 6); // 5–10 incroci
}

function stopAutoplay() {
  autoplayActive = false;
  move.forward = move.back = move.left = move.right = false;
  if (footstepAudio && !footstepAudio.paused) {
    footstepAudio.pause();
    footstepAudio.currentTime = 0;
  }
}

function updateAutoplay(delta) {
  if (!autoplayActive) return;

  const camObj = controls.getObject();

  // ── Azzera il roll (z) via quaternione — preserva yaw (y) e pitch (x) intatti.
  // camObj === camera in PointerLockControls moderno: scrivere rotation.z direttamente
  // o usare rotation.set() tocca anche gli altri assi per effetto gimbal.
  // La via sicura è la stessa usata da setCameraPitch: Euler YXZ → zero z → quaternione.
  _pitchEuler.setFromQuaternion(camObj.quaternion, 'YXZ');
  if (Math.abs(_pitchEuler.z) > 0.0001) {
    _pitchEuler.z = 0;
    camObj.quaternion.setFromEuler(_pitchEuler);
  }

  // ── Reset pitch camera con decadimento esponenziale — smooth a qualsiasi framerate
  if (apSub !== 'reading') {
    const px = getCameraPitch();
    if (Math.abs(px) > 0.001) {
      const t = 1.0 - Math.exp(-3.5 * delta);
      setCameraPitch(THREE.MathUtils.lerp(px, 0, t));
    } else {
      setCameraPitch(0);
    }
  }

  apTimer += delta;

  // ── Snapping ──────────────────────────────────────────────────────────────
  if (apSub === 'snapping') {
    const dir        = AP_DIRS[apDirIdx];
    const SNAP_SPEED = 18.0;

    if (dir.z !== 0) {
      const diff = apSnapTarget - camObj.position.x;
      if (Math.abs(diff) < 0.02) { camObj.position.x = apSnapTarget; apSub = 'walking'; }
      else camObj.position.x += Math.sign(diff) * Math.min(Math.abs(diff), SNAP_SPEED * delta);
    } else {
      const diff = apSnapTarget - camObj.position.z;
      if (Math.abs(diff) < 0.02) { camObj.position.z = apSnapTarget; apSub = 'walking'; }
      else camObj.position.z += Math.sign(diff) * Math.min(Math.abs(diff), SNAP_SPEED * delta);
    }

    let yawDiff = apYawTarget - camObj.rotation.y;
    yawDiff = ((yawDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(yawDiff) < 0.001) {
      camObj.rotation.y = apYawTarget;
    } else {
      camObj.rotation.y += yawDiff * Math.min(1, 8 * delta);
    }
    return;
  }

  // ── Walking ───────────────────────────────────────────────────────────────
  if (apSub === 'walking') {
    const dir    = AP_DIRS[apDirIdx];
    const step   = AUTOPLAY_WALK_SPEED * delta;
    const newPos = camObj.position.clone().addScaledVector(dir, step);
    const sphere = new THREE.Sphere(newPos, CAMERA_RADIUS);

    let blocked = false;
    for (const box of colliderBoxes) {
      if (box.intersectsSphere(sphere)) { blocked = true; break; }
    }

    if (blocked) {
      apPickDir(CAMERA_RADIUS * 2.5);
      apSub        = 'turning';
      apTimer      = 0;
      apWalkedDist = 0;
      if (footstepAudio && !footstepAudio.paused) {
        footstepAudio.pause(); footstepAudio.currentTime = 0;
      }
    } else {
      camObj.position.copy(newPos);

      const th = getTerrainHeight(newPos.x, newPos.z);
      camObj.position.y += ((th + GROUND_HEIGHT_OFFSET) - camObj.position.y) * 0.25;

      let yawDiff = apYawTarget - camObj.rotation.y;
      yawDiff = ((yawDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(yawDiff) < 0.001) {
        camObj.rotation.y = apYawTarget;
      } else {
        camObj.rotation.y += yawDiff * Math.min(1, 8 * delta);
      }

      apWalkedDist   += step;
      apReadWalkDist += step;

      if (footstepAudio && footstepAudio.paused) footstepAudio.play();

      // ── Stop lettura: ogni 3–5 pilastri ───────────────────────────────────
      if (apReadWalkDist >= apReadWalkTarget) {
        apReadWalkDist   = 0;
        apReadWalkTarget = (3 + Math.floor(Math.random() * 3)) * SPACING; // 3–5

        const sideOffset = Math.random() < 0.5 ? 1 : 3;
        const sideDirIdx = (apDirIdx + sideOffset) % 4;

        apReadYawBack = dirToYaw(AP_DIRS[apDirIdx]);
        apYawStart    = camObj.rotation.y;
        apYawTarget   = apYawStart + shortestYaw(apYawStart, dirToYaw(AP_DIRS[sideDirIdx]));

        apSub       = 'reading';
        apReadPhase = 'turn_to';
        apTimer     = 0;

        if (footstepAudio && !footstepAudio.paused) {
          footstepAudio.pause(); footstepAudio.currentTime = 0;
        }
        return;
      }

      // ── Svolta all'incrocio ───────────────────────────────────────────────
      if (apWalkedDist >= apWalkDist) {
        apIntersCount++;
        apWalkedDist = 0;

        if (apIntersCount >= apIntersTarget) {
          apPickDir(SPACING * 0.8);
          apSub          = 'turning';
          apTimer        = 0;
          apIntersCount  = 0;
          apIntersTarget = 5 + Math.floor(Math.random() * 6); // 5–10
        } else {
          apWalkDist = distToNextIntersection(camObj.position, apDirIdx);
        }
        if (footstepAudio && !footstepAudio.paused) {
          footstepAudio.pause(); footstepAudio.currentTime = 0;
        }
      }
    }

  // ── Reading ───────────────────────────────────────────────────────────────
  } else if (apSub === 'reading') {

    if (apReadPhase === 'turn_to') {
      const t    = Math.min(1, apTimer / READING_TURN_SECS);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      let diff   = apYawTarget - apYawStart;
      diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
      camObj.rotation.y = apYawStart + diff * ease;
      if (t >= 1) { camObj.rotation.y = apYawStart + diff; apReadPhase = 'tilt_up'; apTimer = 0; }

    } else if (apReadPhase === 'tilt_up') {
      const cur  = getCameraPitch();
      const diff = READING_PITCH - cur;
      setCameraPitch(cur + diff * Math.min(1, READING_PITCH_LERP * delta));
      if (Math.abs(diff) < 0.005) { setCameraPitch(READING_PITCH); apReadPhase = 'pause'; apTimer = 0; }

    } else if (apReadPhase === 'pause') {
      if (apTimer >= READING_PAUSE_SECS) { apReadPhase = 'tilt_down'; apTimer = 0; }

    } else if (apReadPhase === 'tilt_down') {
      const cur = getCameraPitch();
      setCameraPitch(cur + (0 - cur) * Math.min(1, READING_PITCH_LERP * delta));
      if (Math.abs(cur) < 0.005) {
        setCameraPitch(0);
        apYawStart  = camObj.rotation.y;
        apYawTarget = apYawStart + shortestYaw(apYawStart, apReadYawBack);
        apReadPhase = 'turn_back';
        apTimer     = 0;
      }

    } else if (apReadPhase === 'turn_back') {
      const t    = Math.min(1, apTimer / READING_TURN_SECS);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      let diff   = apYawTarget - apYawStart;
      diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
      camObj.rotation.y = apYawStart + diff * ease;
      if (t >= 1) {
        camObj.rotation.y = apYawStart + diff;
        apYawStart  = camObj.rotation.y;
        normalizeYaw(camObj);
        apYawTarget = apReadYawBack;
        apWalkDist  = distToNextIntersection(camObj.position, apDirIdx);
        apSub       = 'walking';
        apTimer     = 0;
      }
    }

  // ── Pausing (fallback) ────────────────────────────────────────────────────
  } else if (apSub === 'pausing') {
    apSub        = 'walking';
    apWalkDist   = distToNextIntersection(controls.getObject().position, apDirIdx);
    apWalkedDist = 0;

  // ── Turning ───────────────────────────────────────────────────────────────
  } else if (apSub === 'turning') {
    const t    = Math.min(1, apTimer / AUTOPLAY_TURN_SECONDS);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    let diff = apYawTarget - apYawStart;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    camObj.rotation.y = apYawStart + diff * ease;

    if (t >= 1) {
      camObj.rotation.y = apYawStart + diff;
      normalizeYaw(camObj);
      apYawStart      = camObj.rotation.y;
      apSnapTarget    = nearestCorridorCenter(camObj.position, apDirIdx);
      apSub           = 'snapping';
      apTimer         = 0;
      apWalkDist      = distToNextIntersection(camObj.position, apDirIdx);
      apWalkedDist    = 0;
    }
  }
}

// ─────────────────────────────────────────────────────────────

init();

async function init() {
  try {
    const summaryRes = await fetch('https://data.techforpalestine.org/api/v3/summary.json');
    const summary = await summaryRes.json();
    TOTAL_COUNT = summary.gaza.killed.total;

    setupScene();

    const namesRes = await fetch('https://data.techforpalestine.org/api/v3/killed-in-gaza.min.json');
    const rawData = await namesRes.json();
    const rows = rawData.slice(1);

    const knownData = rows.map(row => ({
      en_name: row[1],
      ar_name: row[2],
      age: row[3]
    }));

    const unknownCount = TOTAL_COUNT - knownData.length;
    const allData = [...knownData];
    for (let i = 0; i < unknownCount; i++) {
      allData.push({ en_name: 'Unknown', ar_name: 'غير معروف', age: '—' });
    }
    for (let i = allData.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allData[i], allData[j]] = [allData[j], allData[i]];
    }

    addInstancedBlocks(allData);
    createBorderPillars();
    setupControls();
    animate();

    window.addEventListener('resize', onWindowResize);
  } catch (err) {
    console.error('Errore caricamento dati:', err);
  }
}

// ─────────────────────────────────────────────────────────────
// MATERIALE PILASTRO CONDIVISO
// ─────────────────────────────────────────────────────────────
function createPillarMaterial() {
  const textureLoader = new THREE.TextureLoader();
  function loadTex(path, repeatS = 1.2, repeatT = 2.4) {
    const t = textureLoader.load(path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatS, repeatT);
    return t;
  }
  return new THREE.MeshStandardMaterial({
    map:            loadTex('lichen_rock_diff_1k.jpg'),
    normalMap:      loadTex('lichen_rock_nor_gl_1k.jpg'),
    normalScale:    new THREE.Vector2(2.0, 2.0),
    roughnessMap:   loadTex('lichen_rock_rough_1k.jpg'),
    roughness:      1.0,
    metalnessMap:   loadTex('lichen_rock_arm_1k.jpg'),
    metalness:      0.08,
    aoMap:          loadTex('lichen_rock_ao_1k.jpg'),
    aoMapIntensity: 1.4,
    color:          0xffffff,
    side:           THREE.FrontSide
  });
}

function createDarkSky() {
  const skyGeometry = new THREE.SphereGeometry(2000, 64, 64);
  const skyMaterial = new THREE.ShaderMaterial({
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
      topColor:    { value: new THREE.Color(0x505050) },
      midColor:    { value: new THREE.Color(0x606060) },
      bottomColor: { value: new THREE.Color(0x404040) },
      intensity:   { value: INITIAL_SKY }
    },
    side: THREE.BackSide
  });
  return new THREE.Mesh(skyGeometry, skyMaterial);
}

function getTerrainHeight(x, z) {
  const freq1 = 0.06, freq2 = 0.12, freq3 = 0.22;
  const h1 = Math.sin(x * freq1) * Math.cos(z * freq1) * 0.6;
  const h2 = Math.sin(x * freq2 + 1.5) * Math.sin(z * freq2 + 1.2) * 0.4;
  const h3 = Math.sin(x * freq3 * 2) * 0.15 + Math.cos(z * freq3 * 2) * 0.15;
  const detail = Math.sin(x * 0.4) * Math.cos(z * 0.4) * 0.1;
  return Math.max(-0.6, Math.min(0.7, h1 + h2 + h3 + detail));
}

function createTerrain(width, depth, segments) {
  const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] = getTerrainHeight(positions[i], positions[i + 2]);
  }
  geometry.computeVertexNormals();

  const groundCanvas = createGroundTexture(1024);
  const groundTexture = new THREE.CanvasTexture(groundCanvas);
  groundTexture.wrapS = THREE.RepeatWrapping;
  groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(12, 12);

  const material = new THREE.MeshStandardMaterial({
    map: groundTexture, roughness: 0.85, metalness: 0.05, color: 0x7a6a5a
  });

  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  return terrain;
}

function setupScene() {
  scene = new THREE.Scene();

  skyMesh = createDarkSky();
  scene.add(skyMesh);

  scene.fog = new THREE.FogExp2(0x202020, INITIAL_FOG_DENSITY);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
  camera.position.set(SPACING / 2, START_HEIGHT, SPACING / 2);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x101010);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.querySelector("main").appendChild(renderer.domElement);

  document.getElementById("sad-count").innerHTML = TOTAL_COUNT;

  hemisphereLight = new THREE.HemisphereLight(0x404040, 0x202020, INITIAL_HEMISPHERE);
  scene.add(hemisphereLight);

  dirLight = new THREE.DirectionalLight(0x707070, INITIAL_DIRECTIONAL);
  dirLight.position.set(-50, 80, -50);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width  = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near   = 0.5;
  dirLight.shadow.camera.far    = 300;
  dirLight.shadow.camera.left   = -80;
  dirLight.shadow.camera.right  =  80;
  dirLight.shadow.camera.top    =  80;
  dirLight.shadow.camera.bottom = -80;
  scene.add(dirLight);
  scene.add(dirLight.target);

  ambientLight = new THREE.AmbientLight(0x303030, INITIAL_AMBIENT);
  scene.add(ambientLight);

  fillLight = new THREE.PointLight(0x505050, INITIAL_FILL);
  fillLight.position.set(10, 30, 10);
  scene.add(fillLight);

  backLight = new THREE.PointLight(0x404040, INITIAL_BACK);
  backLight.position.set(-20, 25, -30);
  scene.add(backLight);

  const gridSize = Math.ceil(Math.sqrt(TOTAL_COUNT));
  terrainWidth = (gridSize + 15) * SPACING;
  terrainDepth = (gridSize + 15) * SPACING;
  const segments = Math.min(150, Math.floor(terrainWidth / 2.5));

  terrainMesh = createTerrain(terrainWidth, terrainDepth, segments);
  scene.add(terrainMesh);

  const grassGeometry = new THREE.BufferGeometry();
  const grassCount = 3000;
  const grassPositions = new Float32Array(grassCount * 3);
  for (let i = 0; i < grassCount; i++) {
    const x = (Math.random() - 0.5) * terrainWidth;
    const z = (Math.random() - 0.5) * terrainDepth;
    grassPositions[i * 3]     = x;
    grassPositions[i * 3 + 1] = getTerrainHeight(x, z) + 0.05;
    grassPositions[i * 3 + 2] = z;
  }
  grassGeometry.setAttribute('position', new THREE.BufferAttribute(grassPositions, 3));
  const grassMaterial = new THREE.PointsMaterial({ color: 0x5a6a4a, size: 0.08, transparent: true, opacity: 0.4 });
  scene.add(new THREE.Points(grassGeometry, grassMaterial));
}

function createGroundTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgb(85, 70, 60)';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = Math.random() * 15 + 3, val = 60 + Math.random() * 35;
    ctx.fillStyle = `rgba(${val - 20}, ${val - 25}, ${val - 30}, 0.5)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + Math.random()), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size, y = Math.random() * size, v = 50 + Math.random() * 40;
    ctx.fillStyle = `rgba(${v}, ${v - 10}, ${v - 15}, 0.6)`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  const imageData = ctx.getImageData(0, 0, size, size);
  const px = imageData.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    px[i]     = Math.max(45, Math.min(105, px[i]     + n));
    px[i + 1] = Math.max(40, Math.min(95,  px[i + 1] + n * 0.9));
    px[i + 2] = Math.max(35, Math.min(85,  px[i + 2] + n * 0.8));
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function setupFootstepAudio() {
  footstepAudio = new Audio('public/freesound_community-footsteps-dirt-gravel-6823.mp3');
  footstepAudio.loop = true;
  footstepAudio.volume = 0.5;
}

function startGameDirectly() {
  const instructions = document.getElementById('instructions');
  instructions.style.display = 'none';
  gameStartTime     = performance.now() / 1000;
  lastUserInputTime = gameStartTime;
  gameState         = 'playing';
  dropping          = true;

  if (bgAudio) { bgAudio.muted = false; bgAudio.play(); }
  setupFootstepAudio();

  if (isMobile) {
    setTimeout(() => startAutoplay(), 300);
  }
}

function addInstancedBlocks(data) {
  const pilastroWidth  = 2.3;
  const pilastroHeight = 4.6;

  const geometry = new THREE.BoxGeometry(pilastroWidth, pilastroHeight, pilastroWidth);
  geometry.setAttribute('uv2', geometry.attributes.uv);

  sharedPillarMaterial = createPillarMaterial();

  instancedMesh = new THREE.InstancedMesh(geometry, sharedPillarMaterial, data.length);
  instancedMesh.castShadow = instancedMesh.receiveShadow = true;
  scene.add(instancedMesh);

  const gridSize = Math.ceil(Math.sqrt(data.length));
  const halfGrid = (gridSize - 1) * SPACING / 2;
  apGridHalfSize = halfGrid;

  data.forEach((item, index) => {
    const col = index % gridSize;
    const row = Math.floor(index / gridSize);
    const x   = col * SPACING - halfGrid;
    const z   = row * SPACING - halfGrid;
    const terrainY = getTerrainHeight(x, z);
    const y        = (pilastroHeight / 2) + terrainY - 0.15;

    instancedMesh.setMatrixAt(index, new THREE.Matrix4().makeTranslation(x, y, z));

    const hw = pilastroWidth / 2;
    colliderBoxes.push(new THREE.Box3(
      new THREE.Vector3(x - hw, terrainY,                  z - hw),
      new THREE.Vector3(x + hw, terrainY + pilastroHeight, z + hw)
    ));

    items.push({
      basePos: new THREE.Vector3(x, y, z),
      pillarHalfW: hw, pillarH: pilastroHeight, terrainY,
      en_name: item.en_name, ar_name: item.ar_name, age: item.age,
      planes: []
    });
  });

  instancedMesh.instanceMatrix.needsUpdate = true;
}

// ─────────────────────────────────────────────────────────────
// RECINZIONE PERIMETRALE
// Stessa geometria e materiale dei pilastri interni.
// ~4 × gridSize ≈ ~900 istanze su 50k+: peso trascurabile.
// ─────────────────────────────────────────────────────────────
function createBorderPillars() {
  const pilastroWidth  = 2.3;
  const pilastroHeight = 4.6;
  const hw = pilastroWidth / 2;

  const outerOffset = SPACING;
  const minC = -apGridHalfSize - outerOffset;
  const maxC =  apGridHalfSize + outerOffset;

  const borderPos = [];

  // Lati nord (z = maxC) e sud (z = minC)
  for (let x = minC; x <= maxC + 0.01; x += SPACING) {
    borderPos.push({ x: snap(x), z: minC });
    borderPos.push({ x: snap(x), z: maxC });
  }
  // Lati est (x = maxC) e ovest (x = minC) — angoli già inclusi sopra
  for (let z = minC + SPACING; z < maxC - 0.01; z += SPACING) {
    borderPos.push({ x: minC, z: snap(z) });
    borderPos.push({ x: maxC, z: snap(z) });
  }

  const geometry = new THREE.BoxGeometry(pilastroWidth, pilastroHeight, pilastroWidth);
  geometry.setAttribute('uv2', geometry.attributes.uv);

  const borderMesh = new THREE.InstancedMesh(geometry, sharedPillarMaterial, borderPos.length);
  borderMesh.castShadow = borderMesh.receiveShadow = true;
  scene.add(borderMesh);

  borderPos.forEach(({ x, z }, i) => {
    const terrainY = getTerrainHeight(x, z);
    const y = (pilastroHeight / 2) + terrainY - 0.15;
    borderMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z));

    colliderBoxes.push(new THREE.Box3(
      new THREE.Vector3(x - hw, terrainY - 1,              z - hw),
      new THREE.Vector3(x + hw, terrainY + pilastroHeight, z + hw)
    ));
  });

  borderMesh.instanceMatrix.needsUpdate = true;

  // ── Muri invisibili continui — cintura di sicurezza assoluta ─────────────
  const wallH = 20;
  const wallD = 1.0;
  const edge  = maxC + hw;

  [
    new THREE.Box3( // Nord
      new THREE.Vector3(-edge - wallD, -5,  edge),
      new THREE.Vector3( edge + wallD, wallH, edge + wallD)
    ),
    new THREE.Box3( // Sud
      new THREE.Vector3(-edge - wallD, -5, -edge - wallD),
      new THREE.Vector3( edge + wallD, wallH, -edge)
    ),
    new THREE.Box3( // Est
      new THREE.Vector3( edge,         -5, -edge - wallD),
      new THREE.Vector3( edge + wallD, wallH,  edge + wallD)
    ),
    new THREE.Box3( // Ovest
      new THREE.Vector3(-edge - wallD, -5, -edge - wallD),
      new THREE.Vector3(-edge,         wallH,  edge + wallD)
    ),
  ].forEach(w => colliderBoxes.push(w));

  console.log(`Recinzione: ${borderPos.length} pilastri al perimetro.`);
}

// Allinea al multiplo di SPACING più vicino
function snap(v) {
  return Math.round(v / SPACING) * SPACING;
}

// Differenza angolare più breve tra due yaw, in [-π, π].
// Usa doppio modulo per evitare il segno negativo di % in JS.
function shortestYaw(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d >  Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Riporta camObj.rotation.y in [-π, π] e aggiusta i target di animazione
// di conseguenza, così le animazioni in corso non saltano.
// Va chiamato quando una svolta è completata (rotation.y è fermo sul target).
function normalizeYaw(camObj) {
  const PI2 = Math.PI * 2;
  let y = camObj.rotation.y;
  if (y > Math.PI || y < -Math.PI) {
    const shift = Math.round(y / PI2) * PI2;
    y -= shift;
    camObj.rotation.y = y;
    apYawStart  -= shift;
    apYawTarget -= shift;
  }
}

// ─────────────────────────────────────────────────────────────

function setupControls() {
  controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.getObject());

  const instructions = document.getElementById('instructions');
  const pauseScreen  = document.getElementById('pause-screen');

  if (!isMobile) {
    controls.addEventListener('lock', () => {
      if (gameState === 'intro') {
        instructions.style.display = 'none';
        gameStartTime     = performance.now() / 1000;
        lastUserInputTime = gameStartTime;
        dropping          = true;
      }
      pauseScreen.classList.add('hidden');
      gameState = 'playing';
      lastUserInputTime = performance.now() / 1000;
      if (bgAudio) { bgAudio.muted = false; bgAudio.play(); }
    });

    controls.addEventListener('unlock', () => {
      if (gameState === 'playing') {
        gameState = 'paused';
        pauseScreen.classList.remove('hidden');
        if (bgAudio) bgAudio.pause();
        if (footstepAudio && !footstepAudio.paused) {
          footstepAudio.pause();
          footstepAudio.currentTime = 0;
        }
        move.forward = move.back = move.left = move.right = false;
        if (autoplayActive) stopAutoplay();
      }
    });

    document.getElementById("start").addEventListener('click', () => {
      if (gameState === 'intro') {
        setupFootstepAudio();
        controls.lock();
      }
    });

    document.getElementById("resume").addEventListener('click', () => {
      if (gameState === 'paused') controls.lock();
    });

    window.addEventListener('keydown', (e) => {
      if (gameState === 'playing') {
        lastUserInputTime = performance.now() / 1000;
        if (autoplayActive) stopAutoplay();
      }
      switch (e.code) {
        case 'ArrowUp':    case 'KeyW': move.forward = true;  break;
        case 'ArrowDown':  case 'KeyS': move.back    = true;  break;
        case 'ArrowLeft':  case 'KeyA': move.left    = true;  break;
        case 'ArrowRight': case 'KeyD': move.right   = true;  break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'ArrowUp':    case 'KeyW': move.forward = false; break;
        case 'ArrowDown':  case 'KeyS': move.back    = false; break;
        case 'ArrowLeft':  case 'KeyA': move.left    = false; break;
        case 'ArrowRight': case 'KeyD': move.right   = false; break;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!controls.isLocked || gameState !== 'playing') return;
      const moved = Math.abs(e.movementX) + Math.abs(e.movementY);
      if (moved < 6) return;
      lastUserInputTime = performance.now() / 1000;
      if (autoplayActive) stopAutoplay();
    });

  } else {
    document.getElementById("start").addEventListener('click', () => {
      if (gameState === 'intro') startGameDirectly();
    });
    document.getElementById("resume").addEventListener('click', () => {
      if (gameState === 'paused') {
        pauseScreen.classList.add('hidden');
        gameState = 'playing';
        if (bgAudio) bgAudio.play();
        if (!autoplayActive) startAutoplay();
      }
    });
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateEyeAdaptation(currentTime) {
  if (!gameStartTime) return;

  const elapsed = currentTime - gameStartTime;
  let factor = Math.min(1, elapsed / 20);
  factor = Math.pow(factor, 1.2);

  hemisphereLight.intensity = INITIAL_HEMISPHERE  + (TARGET_HEMISPHERE  - INITIAL_HEMISPHERE)  * factor;
  dirLight.intensity        = INITIAL_DIRECTIONAL + (TARGET_DIRECTIONAL - INITIAL_DIRECTIONAL) * factor;
  ambientLight.intensity    = INITIAL_AMBIENT     + (TARGET_AMBIENT     - INITIAL_AMBIENT)     * factor;
  fillLight.intensity       = INITIAL_FILL        + (TARGET_FILL        - INITIAL_FILL)        * factor;
  backLight.intensity       = INITIAL_BACK        + (TARGET_BACK        - INITIAL_BACK)        * factor;

  if (skyMesh?.material) {
    skyMesh.material.uniforms.intensity.value = INITIAL_SKY + (TARGET_SKY - INITIAL_SKY) * factor;
  }
  scene.fog.density = INITIAL_FOG_DENSITY + (TARGET_FOG_DENSITY - INITIAL_FOG_DENSITY) * factor;
}

// ─────────────────────────────────────────────────────────────
// TESTO INCISO NELLA PIETRA
// ─────────────────────────────────────────────────────────────

function createEngravedTexture(en_name, ar_name, age) {
  const W = 512, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  function carveText(text, x, y, fontSize) {
    if (!text || text === '—' || text === '') return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${fontSize}px 'Georgia', serif`;
    const d = fontSize * 0.055;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';       ctx.fillText(text, x + d, y + d);
    ctx.fillStyle = 'rgba(210,210,210,0.18)';  ctx.fillText(text, x - d * 0.5, y - d * 0.5);
    ctx.fillStyle = 'rgba(145,140,135,0.88)';  ctx.fillText(text, x, y);
  }

  function wrapText(text, maxWidth, fontSize) {
    ctx.font = `${fontSize}px 'Georgia', serif`;
    const words = (text || '').split(' ');
    const lines = []; let cur = '';
    words.forEach(w => {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w; }
      else cur = test;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  const maxW = W - 80, cx = W / 2;
  const arLines = wrapText(ar_name || 'غير معروف', maxW, 34);
  const enLines = wrapText(en_name || 'Unknown',   maxW, 30);
  const lineH   = 46;
  const blockH  = (arLines.length + enLines.length + 1) * lineH + 30;
  let y = (H - blockH) / 2;

  arLines.forEach(l => { carveText(l, cx, y, 34); y += lineH; });
  y += 18;
  enLines.forEach(l => { carveText(l, cx, y, 30); y += lineH; });
  y += 22;
  const ageLabel = (age !== undefined && age !== null && String(age).trim() !== '' && age !== '—') ? `Age: ${age}` : '';
  if (ageLabel) carveText(ageLabel, cx, y, 24);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  return tex;
}

function createEngravingPlanes(item) {
  const hw = item.pillarHalfW, ph = item.pillarH;
  const cx = item.basePos.x, cz = item.basePos.z;
  const cy = item.terrainY + ph / 2;
  const offset = 0.02;
  const tex = createEngravedTexture(item.en_name, item.ar_name, item.age);
  const geo = new THREE.PlaneGeometry(hw * 2, ph);

  const faces = [
    { pos: new THREE.Vector3(cx,               cy, cz + hw + offset), rotY:  0,           order: 1 },
    { pos: new THREE.Vector3(cx,               cy, cz - hw - offset), rotY:  Math.PI,     order: 2 },
    { pos: new THREE.Vector3(cx + hw + offset, cy, cz),               rotY:  Math.PI / 2, order: 3 },
    { pos: new THREE.Vector3(cx - hw - offset, cy, cz),               rotY: -Math.PI / 2, order: 4 },
  ];

  return faces.map(({ pos, rotY, order }) => {
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, opacity: 1.0,
      depthWrite: false, depthTest: true, alphaTest: 0.0,
      roughness: 0.95, metalness: 0.0, color: 0x888888,
      emissive: new THREE.Color(0xffffff), emissiveMap: tex, emissiveIntensity: 0.0,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.rotation.y = rotY;
    mesh.renderOrder = order;
    return mesh;
  });
}

function isGameActive() {
  return isMobile ? gameState === 'playing' : controls.isLocked;
}

function animate() {
  requestAnimationFrame(animate);
  const delta       = Math.min(clock.getDelta(), 0.033);
  const currentTime = performance.now() / 1000;

  if (gameState === 'playing' && gameStartTime) {
    updateEyeAdaptation(currentTime);

    if (!isMobile && lastUserInputTime !== null && !autoplayActive && controls.isLocked && !dropping) {
      if ((currentTime - lastUserInputTime) >= AUTOPLAY_IDLE_DELAY) {
        startAutoplay();
      }
    }
  }

  if (gameState === 'playing') {
    updateAutoplay(delta);
  }

  // Caduta iniziale
  if (dropping) {
    camera.position.y = Math.max(camera.position.y - 30 * delta, GROUND_HEIGHT_OFFSET + 0.5);
    if (camera.position.y <= GROUND_HEIGHT_OFFSET + 0.6) dropping = false;
  }

  // Movimento manuale
  if (!isMobile && controls.isLocked && !dropping && !autoplayActive) {
    const currentPos = controls.getObject().position.clone();

    velocity.set(
      (move.right - move.left)    * speed * delta,
      0,
      (move.back  - move.forward) * speed * delta
    );

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    direction.setY(0).normalize();
    const right      = new THREE.Vector3().crossVectors(direction, camera.up).normalize();
    const moveVector = direction.multiplyScalar(-velocity.z).add(right.multiplyScalar(velocity.x));

    const newPos = currentPos.clone().add(moveVector);
    const sphere = new THREE.Sphere(newPos, CAMERA_RADIUS);

    let blocked = false;
    for (const box of colliderBoxes) {
      if (box.intersectsSphere(sphere)) { blocked = true; break; }
    }

    if (!blocked) {
      controls.getObject().position.copy(newPos);
      const th = getTerrainHeight(newPos.x, newPos.z);
      const ch = controls.getObject().position.y;
      controls.getObject().position.y = ch + ((th + GROUND_HEIGHT_OFFSET) - ch) * 0.25;
    }

    const px = controls.getObject().position.x;
    const pz = controls.getObject().position.z;
    dirLight.position.set(px - 50, 80, pz - 50);
    dirLight.target.position.set(px, 0, pz);
    dirLight.target.updateMatrixWorld();

    const isMoving = move.forward || move.back || move.left || move.right;
    if (isMoving && !blocked) {
      if (footstepAudio && footstepAudio.paused) footstepAudio.play();
    } else {
      if (footstepAudio && !footstepAudio.paused) {
        footstepAudio.pause(); footstepAudio.currentTime = 0;
      }
    }
  }

  // Luce durante autoplay
  if (isGameActive() && autoplayActive) {
    const px = controls.getObject().position.x;
    const pz = controls.getObject().position.z;
    dirLight.position.set(px - 50, 80, pz - 50);
    dirLight.target.position.set(px, 0, pz);
    dirLight.target.updateMatrixWorld();
  }

  // Piani di testo inciso
  if (isGameActive() && !dropping) {
    items.forEach(item => {
      const dist = camera.position.distanceTo(item.basePos);

      if (dist < 18) {
        const opacity = dist < 8 ? 1.0 : dist < 12 ? 0.5 : 0.2;

        if (item.planes.length === 0) {
          createEngravingPlanes(item).forEach(p => {
            scene.add(p);
            item.planes.push(p);
          });
        }

        const glow = dist < 7 ? Math.pow(1 - dist / 7, 1.5) * 1.2 : 0.0;
        item.planes.forEach(p => {
          p.material.opacity = opacity;
          p.material.emissiveIntensity = glow;
        });

      } else if (item.planes.length > 0) {
        item.planes.forEach(p => {
          scene.remove(p);
          p.material.map.dispose();
          p.material.dispose();
          p.geometry.dispose();
        });
        item.planes = [];
      }
    });
  }

  renderer.render(scene, camera);
}