import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

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

// Terreno collinoso
let terrainMesh;
let terrainWidth  = 0;
let terrainDepth  = 0;
let apGridHalfSize = 0; // metà della griglia — serve per calcolare le intersezioni

// Variabili per l'effetto di adattamento al buio
let gameStartTime = null;
let hemisphereLight, dirLight, ambientLight, fillLight, backLight;
let skyMesh;

// ─────────────────────────────────────────────────────────────
// VALORI INIZIALI — devono coincidere con quelli in updateEyeAdaptation
// così non c'è salto visibile al frame 0 dell'adattamento
// ─────────────────────────────────────────────────────────────
const INITIAL_HEMISPHERE  = 0.45;
const INITIAL_DIRECTIONAL = 1.2;
const INITIAL_AMBIENT     = 0.45;
const INITIAL_FILL        = 0.35;
const INITIAL_BACK        = 0.25;
const INITIAL_SKY         = 0.65;
const INITIAL_FOG_DENSITY = 0.007;

const TARGET_HEMISPHERE   = 0.90;
const TARGET_DIRECTIONAL  = 2.4;
const TARGET_AMBIENT      = 0.90;
const TARGET_FILL         = 0.70;
const TARGET_BACK         = 0.50;
const TARGET_SKY          = 1.30;
const TARGET_FOG_DENSITY  = 0.01;

// ─────────────────────────────────────────────────────────────
// AUTOPLAY
// ─────────────────────────────────────────────────────────────
const AUTOPLAY_IDLE_DELAY   = 3;    // secondi di inattività prima di partire
const AUTOPLAY_WALK_SPEED   = 1.44; // 20% più lento di prima (1.8 × 0.8)
const AUTOPLAY_TURN_SECONDS = 0.85; // durata della rotazione fluida di 90°

let lastUserInputTime = null; // null = intro/gioco non ancora iniziato
let autoplayActive    = false;

let apSub        = 'walking'; // 'walking' | 'pausing' | 'turning'
let apTimer      = 0;
let apWalkDist    = 0;  // distanza target fino al prossimo incrocio (unità Three.js)
let apWalkedDist  = 0;  // distanza percorsa nel segmento corrente
let apPauseDur    = 0;
let apDirIdx      = 0;
let apIntersCount  = 0;  // incroci attraversati nel segmento corrente
let apIntersTarget = 1;  // dopo quanti incroci girare (1–5, casuale)
let apSnapTarget   = 0;  // coordinata world del centro corridoio verso cui fare snap

// Restituisce la coordinata del centro corridoio più vicino
// sull'asse perpendicolare alla direzione di marcia.
// I pilastri stanno a n*SPACING - apGridHalfSize,
// i corridoi (centri) stanno a (n+0.5)*SPACING - apGridHalfSize.
function nearestCorridorCenter(pos, dirIdx) {
  const dir = AP_DIRS[dirIdx];
  // Asse perpendicolare: se si cammina su Z uso X, e viceversa
  const v = dir.z !== 0 ? pos.x : pos.z;
  const normalized = v + apGridHalfSize;
  const cell = Math.round(normalized / SPACING - 0.5);
  return (cell + 0.5) * SPACING - apGridHalfSize;
}

// Le 4 direzioni cardinali world-space allineate ai corridoi della griglia
const AP_DIRS = [
  new THREE.Vector3( 0, 0, -1), // Nord
  new THREE.Vector3( 1, 0,  0), // Est
  new THREE.Vector3( 0, 0,  1), // Sud
  new THREE.Vector3(-1, 0,  0), // Ovest
];

let apYawStart  = 0;
let apYawTarget = 0;

// Converte una direzione world-space nello yaw di PointerLockControls
// look_dir = (−sin yaw, 0, −cos yaw)  →  yaw = atan2(−dx, −dz)
function dirToYaw(dir) {
  return Math.atan2(-dir.x, -dir.z);
}

// Controlla se il corridoio nella direzione indicata è libero per almeno checkDist unità
function isDirectionClear(fromPos, dirIdx, checkDist = 4.0) {
  const dir     = AP_DIRS[dirIdx];
  const testPos = fromPos.clone().addScaledVector(dir, checkDist);
  const sphere  = new THREE.Sphere(testPos, CAMERA_RADIUS * 1.2); // margine extra
  for (const box of colliderBoxes) {
    if (box.intersectsSphere(sphere)) return false;
  }
  return true;
}

function apPickDir(emergencyCheckDist = SPACING * 0.8) {
  const camPos = controls.getObject().position;

  // Ordine preferito: sinistra e destra (ordine random), poi dritto, poi indietro
  const right = (apDirIdx + 1) % 4;
  const left  = (apDirIdx + 3) % 4;
  const back  = (apDirIdx + 2) % 4;

  const turns = Math.random() < 0.5 ? [right, left] : [left, right];
  const candidates = [...turns, apDirIdx, back];

  let chosen = apDirIdx; // fallback
  for (const c of candidates) {
    if (isDirectionClear(camPos, c, emergencyCheckDist)) { chosen = c; break; }
  }

  apDirIdx    = chosen;
  apYawStart  = controls.getObject().rotation.y;
  apYawTarget = dirToYaw(AP_DIRS[apDirIdx]);

  let diff = apYawTarget - apYawStart;
  diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
  apYawTarget = apYawStart + diff;
}

// Calcola la distanza esatta dal punto corrente al prossimo incrocio tra 4 pilastri,
// nella direzione di marcia indicata.
//
// I pilastri sono a posizioni world = col*SPACING - apGridHalfSize.
// In coordinate normalizzate (+ apGridHalfSize) i pilastri stanno a n*SPACING (interi).
// Le intersezioni tra 4 pilastri stanno a (n+0.5)*SPACING in coordinate normalizzate,
// cioè a (n+0.5)*SPACING - apGridHalfSize in coordinate world.
//
// La "fase" è la posizione frazionaria all'interno di una cella [0, 1):
//   fase = 0   → sopra un pilastro (mai in pratica, ci sono i collider)
//   fase = 0.5 → al centro dell'incrocio tra 4 pilastri  ← qui si gira
function distToNextIntersection(pos, dirIdx) {
  const dir   = AP_DIRS[dirIdx];
  const S     = SPACING;
  const dSign = dir.x !== 0 ? dir.x : dir.z;
  const v     = (dir.x !== 0 ? pos.x : pos.z) + apGridHalfSize; // coordinata normalizzata

  const phase = ((v / S) % 1 + 1) % 1; // [0, 1)

  let dist;
  if (dSign > 0) {
    // Avanzando: prossima intersezione a fase 0.5
    dist = phase < 0.5 ? (0.5 - phase) * S : (1.5 - phase) * S;
  } else {
    // Indietreggiando: prossima intersezione a fase 0.5 nella direzione negativa
    dist = phase > 0.5 ? (phase - 0.5) * S : (phase + 0.5) * S;
  }

  // Se siamo già sopra un incrocio (o vicinissimi), saltiamo al successivo
  if (dist < CAMERA_RADIUS) dist += S;

  return dist;
}

function startAutoplay() {
  autoplayActive = true;
  apTimer = 0;

  // FIX 2: snap immediato — azzera pitch (x) e roll (z) prima che parta qualsiasi lerp.
  // Un frame di Euler YXZ con z != 0 basta a causare l'effetto "testa inclinata".
  camera.rotation.x = 0;
  camera.rotation.z = 0;

  // Aggancia la direzione cardinale più vicina allo yaw attuale,
  // preferendo quelle con corridoio libero davanti
  const curYaw = controls.getObject().rotation.y;
  const camPos = controls.getObject().position;

  let best = 0, bestDist = Infinity;
  AP_DIRS.forEach((d, i) => {
    let diff = Math.abs(dirToYaw(d) - curYaw);
    diff = Math.min(diff, Math.PI * 2 - diff);
    // Usa checkDist corto: non vogliamo escludere corridoi liberi vicini
    const penalty = isDirectionClear(camPos, i, CAMERA_RADIUS * 2.5) ? 0 : Math.PI;
    if (diff + penalty < bestDist) { bestDist = diff + penalty; best = i; }
  });

  apDirIdx    = best;
  apYawStart  = curYaw;
  apYawTarget = dirToYaw(AP_DIRS[apDirIdx]);

  apSub          = 'snapping';
  apSnapTarget   = nearestCorridorCenter(controls.getObject().position, apDirIdx);
  apWalkDist     = distToNextIntersection(controls.getObject().position, apDirIdx);
  apWalkedDist   = 0;
  apIntersCount  = 0;
  apIntersTarget = Math.ceil(Math.random() * 5); // 1–5
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

  // ── Reset pitch → 0 (parallelo al pavimento) ─────────────────────────────
  if (Math.abs(camera.rotation.x) > 0.001) {
    camera.rotation.x += (0 - camera.rotation.x) * Math.min(1, 6 * delta);
  } else {
    camera.rotation.x = 0;
  }
  // NB: camera.rotation.z non viene toccato qui — lo snap è solo in startAutoplay.
  // Forzarlo ad ogni frame interferisce con PointerLockControls al momento del handoff.

  apTimer += delta;

  // ── Snapping — centra la camera nel corridoio prima di camminare ──────────
  if (apSub === 'snapping') {
    const dir        = AP_DIRS[apDirIdx];
    const SNAP_SPEED = 4.0; // unità/secondo — abbastanza rapido ma visibile

    // Lerp sull'asse perpendicolare verso il centro corridoio
    if (dir.z !== 0) {
      // Cammino su Z → correggo X
      const diff = apSnapTarget - camObj.position.x;
      if (Math.abs(diff) < 0.02) {
        camObj.position.x = apSnapTarget;
        apSub = 'walking';
      } else {
        camObj.position.x += Math.sign(diff) * Math.min(Math.abs(diff), SNAP_SPEED * delta);
      }
    } else {
      // Cammino su X → correggo Z
      const diff = apSnapTarget - camObj.position.z;
      if (Math.abs(diff) < 0.02) {
        camObj.position.z = apSnapTarget;
        apSub = 'walking';
      } else {
        camObj.position.z += Math.sign(diff) * Math.min(Math.abs(diff), SNAP_SPEED * delta);
      }
    }

    // Smooth yaw verso la direzione cardinale anche durante lo snap
    let yawDiff = apYawTarget - camObj.rotation.y;
    yawDiff = ((yawDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
    camObj.rotation.y += yawDiff * Math.min(1, 8 * delta);

    return; // non cammina finché non è centrato
  }

  // ── Walking ───────────────────────────────────────────────────────────────
  if (apSub === 'walking') {
    const dir  = AP_DIRS[apDirIdx];
    const step = AUTOPLAY_WALK_SPEED * delta;
    const newPos = camObj.position.clone().addScaledVector(dir, step);
    const sphere = new THREE.Sphere(newPos, CAMERA_RADIUS);

    let blocked = false;
    for (const box of colliderBoxes) {
      if (box.intersectsSphere(sphere)) { blocked = true; break; }
    }

    if (blocked) {
      // Muro davanti: usa checkDist corto per il test laterale
      // così non "vede" il pilastro successivo nel corridoio affiancato
      apPickDir(CAMERA_RADIUS * 2.5);
      apSub        = 'turning';
      apTimer      = 0;
      apWalkedDist = 0;
      if (footstepAudio && !footstepAudio.paused) {
        footstepAudio.pause();
        footstepAudio.currentTime = 0;
      }
    } else {
      camObj.position.copy(newPos);

      // Adatta altezza al terreno
      const th = getTerrainHeight(newPos.x, newPos.z);
      camObj.position.y += ((th + GROUND_HEIGHT_OFFSET) - camObj.position.y) * 0.25;

      // Smooth yaw verso la direzione cardinale target
      let yawDiff = apYawTarget - camObj.rotation.y;
      yawDiff = ((yawDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
      camObj.rotation.y += yawDiff * Math.min(1, 8 * delta);

      // Accumulazione distanza percorsa
      apWalkedDist += step;

      // Passi
      if (footstepAudio && footstepAudio.paused) footstepAudio.play();

      if (apWalkedDist >= apWalkDist) {
        apIntersCount++;
        apWalkedDist = 0;

        if (apIntersCount >= apIntersTarget) {
          // Raggiunto il numero di incroci: gira a sinistra o destra
          apPickDir(SPACING * 0.8);
          apSub          = 'turning';
          apTimer        = 0;
          apIntersCount  = 0;
          apIntersTarget = Math.ceil(Math.random() * 5); // nuovo target 1–5
        } else {
          // Incrocio attraversato ma non ancora il target: continua dritto
          apWalkDist = distToNextIntersection(camObj.position, apDirIdx);
        }
        if (footstepAudio && !footstepAudio.paused) {
          footstepAudio.pause();
          footstepAudio.currentTime = 0;
        }
      }
    }

  // ── Pausing (rimosso — la svolta avviene direttamente da walking) ─────────
  } else if (apSub === 'pausing') {
    // stato mantenuto per compatibilità ma non più usato attivamente
    apSub        = 'walking';
    apWalkDist   = distToNextIntersection(controls.getObject().position, apDirIdx);
    apWalkedDist = 0;

  // ── Turning ───────────────────────────────────────────────────────────────
  } else if (apSub === 'turning') {
    const t    = Math.min(1, apTimer / AUTOPLAY_TURN_SECONDS);
    // ease in-out quadratica
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    let diff = apYawTarget - apYawStart;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    camObj.rotation.y = apYawStart + diff * ease;

    if (t >= 1) {
      camObj.rotation.y = apYawStart + diff; // snap finale
      apYawStart        = camObj.rotation.y;
      apSnapTarget   = nearestCorridorCenter(camObj.position, apDirIdx);
      apSub          = 'snapping';
      apTimer        = 0;
      apWalkDist     = distToNextIntersection(camObj.position, apDirIdx);
      apWalkedDist   = 0;
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
      allData.push({
        en_name: 'Unknown',
        ar_name: 'غير معروف',
        age: '—'
      });
    }

    // Fisher-Yates shuffle
    for (let i = allData.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allData[i], allData[j]] = [allData[j], allData[i]];
    }

    addInstancedBlocks(allData);
    setupControls();
    animate();

    window.addEventListener('resize', onWindowResize);
  } catch (err) {
    console.error('Errore caricamento dati:', err);
  }
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
  const freq1 = 0.06;
  const freq2 = 0.12;
  const freq3 = 0.22;

  const h1 = Math.sin(x * freq1) * Math.cos(z * freq1) * 0.6;
  const h2 = Math.sin(x * freq2 + 1.5) * Math.sin(z * freq2 + 1.2) * 0.4;
  const h3 = Math.sin(x * freq3 * 2) * 0.15 + Math.cos(z * freq3 * 2) * 0.15;
  const detail = Math.sin(x * 0.4) * Math.cos(z * 0.4) * 0.1;

  let height = h1 + h2 + h3 + detail;
  height = Math.max(-0.6, Math.min(0.7, height));

  return height;
}

function createTerrain(width, depth, segments) {
  const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position.array;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    const y = getTerrainHeight(x, z);
    positions[i + 1] = y;
  }

  geometry.computeVertexNormals();

  const groundCanvas = createGroundTexture(1024);
  const groundTexture = new THREE.CanvasTexture(groundCanvas);
  groundTexture.wrapS = THREE.RepeatWrapping;
  groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(12, 12);

  const material = new THREE.MeshStandardMaterial({
    map: groundTexture,
    roughness: 0.85,
    metalness: 0.05,
    color: 0x7a6a5a
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

  let count = document.getElementById("sad-count");
  count.innerHTML = TOTAL_COUNT;

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
    const y = getTerrainHeight(x, z) + 0.05;
    grassPositions[i * 3]     = x;
    grassPositions[i * 3 + 1] = y;
    grassPositions[i * 3 + 2] = z;
  }
  grassGeometry.setAttribute('position', new THREE.BufferAttribute(grassPositions, 3));
  const grassMaterial = new THREE.PointsMaterial({ color: 0x5a6a4a, size: 0.08, transparent: true, opacity: 0.4 });
  const grass = new THREE.Points(grassGeometry, grassMaterial);
  scene.add(grass);
}

function createGroundTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgb(85, 70, 60)';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 15 + 3;
    const val = 60 + Math.random() * 35;
    ctx.fillStyle = `rgba(${val - 20}, ${val - 25}, ${val - 30}, 0.5)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + Math.random()), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = 50 + Math.random() * 40;
    ctx.fillStyle = `rgba(${v}, ${v - 10}, ${v - 15}, 0.6)`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  const imageData = ctx.getImageData(0, 0, size, size);
  const pixels = imageData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const noise = (Math.random() - 0.5) * 18;
    pixels[i]     = Math.max(45, Math.min(105, pixels[i]     + noise));
    pixels[i + 1] = Math.max(40, Math.min(95,  pixels[i + 1] + noise * 0.9));
    pixels[i + 2] = Math.max(35, Math.min(85,  pixels[i + 2] + noise * 0.8));
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}

function setupFootstepAudio() {
  footstepAudio = new Audio('public/freesound_community-footsteps-dirt-gravel-6823.mp3');
  footstepAudio.loop = true;
  footstepAudio.volume = 0.5;
}

function addInstancedBlocks(data) {
  const pilastroWidth  = 2.3;
  const pilastroHeight = 4.6;

  const geometry = new THREE.BoxGeometry(pilastroWidth, pilastroHeight, pilastroWidth);
  geometry.setAttribute('uv2', geometry.attributes.uv);

  const textureLoader = new THREE.TextureLoader();

  function loadTex(path, repeatS = 1.2, repeatT = 2.4) {
    const t = textureLoader.load(path);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatS, repeatT);
    return t;
  }

  const diffuseMap   = loadTex('lichen_rock_diff_1k.jpg');
  const normalMap    = loadTex('lichen_rock_nor_gl_1k.jpg');
  const roughnessMap = loadTex('lichen_rock_rough_1k.jpg');
  const aoMap        = loadTex('lichen_rock_ao_1k.jpg');
  const armMap       = loadTex('lichen_rock_arm_1k.jpg');

  const material = new THREE.MeshStandardMaterial({
    map:            diffuseMap,
    normalMap:      normalMap,
    normalScale:    new THREE.Vector2(2.0, 2.0),
    roughnessMap:   roughnessMap,
    roughness:      1.0,
    metalnessMap:   armMap,
    metalness:      0.08,
    aoMap:          aoMap,
    aoMapIntensity: 1.4,
    color:          0xffffff,
    side:           THREE.FrontSide
  });

  instancedMesh = new THREE.InstancedMesh(geometry, material, data.length);
  instancedMesh.castShadow    = true;
  instancedMesh.receiveShadow = true;
  scene.add(instancedMesh);

  const gridSize = Math.ceil(Math.sqrt(data.length));
  const halfGrid = (gridSize - 1) * SPACING / 2;
  apGridHalfSize = halfGrid; // rende halfGrid accessibile alle funzioni autoplay

  data.forEach((item, index) => {
    const row = Math.floor(index / gridSize);
    const col = index % gridSize;
    const x = col * SPACING - halfGrid;
    const z = row * SPACING - halfGrid;

    const terrainY = getTerrainHeight(x, z);
    const y = (pilastroHeight / 2) + terrainY;

    const matrix = new THREE.Matrix4().makeTranslation(x, y, z);
    instancedMesh.setMatrixAt(index, matrix);

    const halfWidth = pilastroWidth / 2;
    colliderBoxes.push(new THREE.Box3(
      new THREE.Vector3(x - halfWidth, terrainY,                  z - halfWidth),
      new THREE.Vector3(x + halfWidth, terrainY + pilastroHeight, z + halfWidth)
    ));

    items.push({
      basePos: new THREE.Vector3(x, y, z),
      pillarHalfW: pilastroWidth / 2,
      pillarH:     pilastroHeight,
      terrainY,
      en_name: item.en_name,
      ar_name: item.ar_name,
      age:     item.age,
      planes:  []
    });
  });

  instancedMesh.instanceMatrix.needsUpdate = true;
  console.log('Texture 1k caricate: diffuse + normal GL + roughness + AO + ARM');
}

function setupControls() {
  controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.getObject());

  const instructions = document.getElementById('instructions');
  const pauseScreen  = document.getElementById('pause-screen');

  controls.addEventListener('lock', () => {
    if (gameState === 'intro') {
      instructions.style.display = 'none';
      gameStartTime = performance.now() / 1000;
      dropping = true;
    }
    pauseScreen.classList.add('hidden');
    gameState = 'playing';
    lastUserInputTime = performance.now() / 1000; // inizia il countdown autoplay
    if (bgAudio) bgAudio.play();
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
      move.forward = false;
      move.back    = false;
      move.left    = false;
      move.right   = false;
      // Se l'autoplay era attivo lo fermiamo
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
    if (gameState === 'paused') {
      controls.lock();
    }
  });

  window.addEventListener('keydown', (e) => {
    // Qualsiasi tasto → registra input e ferma autoplay
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

  // Movimento mouse — cancella autoplay solo se il movimento è intenzionale (> 3px)
  document.addEventListener('mousemove', (e) => {
    if (!controls.isLocked || gameState !== 'playing') return;
    const moved = Math.abs(e.movementX) + Math.abs(e.movementY);
    if (moved < 3) return; // ignora jitter del sistema
    lastUserInputTime = performance.now() / 1000;
    if (autoplayActive) stopAutoplay();
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateEyeAdaptation(currentTime) {
  if (!gameStartTime) return;

  const elapsed  = currentTime - gameStartTime;
  const duration = 20;

  let factor = Math.min(1, elapsed / duration);
  factor = Math.pow(factor, 1.2);

  hemisphereLight.intensity = INITIAL_HEMISPHERE  + (TARGET_HEMISPHERE  - INITIAL_HEMISPHERE)  * factor;
  dirLight.intensity        = INITIAL_DIRECTIONAL + (TARGET_DIRECTIONAL - INITIAL_DIRECTIONAL) * factor;
  ambientLight.intensity    = INITIAL_AMBIENT     + (TARGET_AMBIENT     - INITIAL_AMBIENT)     * factor;
  fillLight.intensity       = INITIAL_FILL        + (TARGET_FILL        - INITIAL_FILL)        * factor;
  backLight.intensity       = INITIAL_BACK        + (TARGET_BACK        - INITIAL_BACK)        * factor;

  if (skyMesh && skyMesh.material) {
    skyMesh.material.uniforms.intensity.value =
      INITIAL_SKY + (TARGET_SKY - INITIAL_SKY) * factor;
  }

  scene.fog.density = INITIAL_FOG_DENSITY + (TARGET_FOG_DENSITY - INITIAL_FOG_DENSITY) * factor;
}

// ─────────────────────────────────────────────────────────────
// TESTO INCISO NELLA PIETRA
// ─────────────────────────────────────────────────────────────

function createEngravedTexture(en_name, ar_name, age) {
  const W = 512, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, W, H);

  function carveText(text, x, y, fontSize, weight = 'normal') {
    if (!text || text === '—' || text === '') return;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${weight} ${fontSize}px 'Georgia', serif`;

    const d = fontSize * 0.055;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillText(text, x + d, y + d);

    ctx.fillStyle = 'rgba(210, 210, 210, 0.18)';
    ctx.fillText(text, x - d * 0.5, y - d * 0.5);

    ctx.fillStyle = 'rgba(145, 140, 135, 0.88)';
    ctx.fillText(text, x, y);
  }

  function wrapText(text, maxWidth, fontSize, weight = 'normal') {
    ctx.font = `${weight} ${fontSize}px 'Georgia', serif`;
    const words = (text || '').split(' ');
    const lines = [];
    let cur = '';
    words.forEach(w => {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  const maxW   = W - 80;
  const cx     = W / 2;
  const arSize = 34;
  const enSize = 30;
  const agSize = 24;

  const arLines = wrapText(ar_name  || 'غير معروف', maxW, arSize, 'normal');
  const enLines = wrapText(en_name  || 'Unknown',   maxW, enSize, 'normal');

  const lineH = 46;

  const totalLines = arLines.length + enLines.length + 1;
  const blockH     = totalLines * lineH + 30;
  let y = (H - blockH) / 2;

  arLines.forEach(line => {
    carveText(line, cx, y, arSize, 'normal');
    y += lineH;
  });

  y += 18;

  enLines.forEach(line => {
    carveText(line, cx, y, enSize, 'normal');
    y += lineH;
  });

  y += 22;
  const ageLabel = (age !== undefined && age !== null && String(age).trim() !== '' && age !== '—')
    ? `Age: ${age}`
    : '';
  if (ageLabel) carveText(ageLabel, cx, y, agSize, 'normal');

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function createEngravingPlanes(item) {
  const hw = item.pillarHalfW;
  const ph = item.pillarH;
  const cx = item.basePos.x;
  const cy = item.terrainY + ph / 2;
  const cz = item.basePos.z;
  const offset = 0.02;

  const tex = createEngravedTexture(item.en_name, item.ar_name, item.age);

  const geo = new THREE.PlaneGeometry(hw * 2, ph);

  const faces = [
    { pos: new THREE.Vector3(cx,               cy, cz + hw + offset), rotY:  0,            order: 1 },
    { pos: new THREE.Vector3(cx,               cy, cz - hw - offset), rotY:  Math.PI,      order: 2 },
    { pos: new THREE.Vector3(cx + hw + offset, cy, cz),               rotY:  Math.PI / 2,  order: 3 },
    { pos: new THREE.Vector3(cx - hw - offset, cy, cz),               rotY: -Math.PI / 2,  order: 4 },
  ];

  return faces.map(({ pos, rotY, order }) => {
    const mat = new THREE.MeshStandardMaterial({
      map:               tex,
      transparent:       true,
      opacity:           1.0,
      depthWrite:        false,
      depthTest:         true,
      alphaTest:         0.0,
      roughness:         0.95,
      metalness:         0.0,
      color:             0x888888,
      emissive:          new THREE.Color(0xffffff),
      emissiveMap:       tex,
      emissiveIntensity: 0.0,
      side:              THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.rotation.y = rotY;
    mesh.renderOrder = order;
    return mesh;
  });
}

function animate() {
  requestAnimationFrame(animate);
  const delta       = Math.min(clock.getDelta(), 0.033);
  const currentTime = performance.now() / 1000;

  if (gameState === 'playing' && gameStartTime) {
    updateEyeAdaptation(currentTime);

    // ── Attiva autoplay dopo AUTOPLAY_IDLE_DELAY secondi di inattività ──────
    if (lastUserInputTime !== null && !autoplayActive && controls.isLocked && !dropping) {
      if ((currentTime - lastUserInputTime) >= AUTOPLAY_IDLE_DELAY) {
        startAutoplay();
      }
    }
  }

  // Aggiorna autoplay (gestisce movimento, yaw, reset pitch)
  if (gameState === 'playing') {
    updateAutoplay(delta);
  }

  // ── Caduta iniziale ───────────────────────────────────────────────────────
  if (dropping) {
    camera.position.y = Math.max(camera.position.y - 30 * delta, GROUND_HEIGHT_OFFSET + 0.5);
    if (camera.position.y <= GROUND_HEIGHT_OFFSET + 0.6) {
      dropping = false;
    }
  }

  // ── Movimento manuale (solo se non in autoplay) ───────────────────────────
  if (controls.isLocked && !dropping && !autoplayActive) {
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

      const terrainHeight = getTerrainHeight(newPos.x, newPos.z);
      const targetHeight  = terrainHeight + GROUND_HEIGHT_OFFSET;
      const currentHeight = controls.getObject().position.y;
      controls.getObject().position.y = currentHeight + (targetHeight - currentHeight) * 0.25;
    }

    // Luce dinamica seguendo il giocatore
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
        footstepAudio.pause();
        footstepAudio.currentTime = 0;
      }
    }
  }

  // ── Luce segue anche durante autoplay ────────────────────────────────────
  if (controls.isLocked && autoplayActive) {
    const px = controls.getObject().position.x;
    const pz = controls.getObject().position.z;
    dirLight.position.set(px - 50, 80, pz - 50);
    dirLight.target.position.set(px, 0, pz);
    dirLight.target.updateMatrixWorld();
  }

  // ── Piani di testo inciso — attivi sempre (manuale e autoplay) ────────────
  if (controls.isLocked && !dropping) {
    items.forEach(item => {
      const dist = camera.position.distanceTo(item.basePos);

      if (dist < 18) {
        const opacity = dist < 8 ? 1.0 : dist < 12 ? 0.5 : 0.2;

        if (item.planes.length === 0) {
          const planes = createEngravingPlanes(item);
          planes.forEach(p => {
            scene.add(p);
            item.planes.push(p);
          });
        }

        const glow = dist < 7
          ? Math.pow(1 - dist / 7, 1.5) * 1.2
          : 0.0;

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