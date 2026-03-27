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
let terrainWidth = 0;
let terrainDepth = 0;

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
      // FIX 1: usa INITIAL_SKY così il cielo parte già al valore corretto
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

  // FIX 1: fog inizia già al valore INITIAL_FOG_DENSITY
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

  // FIX 1: tutte le intensità iniziali coincidono con INITIAL_* usati in updateEyeAdaptation
  hemisphereLight = new THREE.HemisphereLight(0x404040, 0x202020, INITIAL_HEMISPHERE);
  scene.add(hemisphereLight);

  dirLight = new THREE.DirectionalLight(0x707070, INITIAL_DIRECTIONAL);
  dirLight.position.set(-50, 80, -50);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width  = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near   = 0.5;
  dirLight.shadow.camera.far    = 300;
  // FIX 2: bounds più ampi per coprire l'area intorno al giocatore
  dirLight.shadow.camera.left   = -80;
  dirLight.shadow.camera.right  =  80;
  dirLight.shadow.camera.top    =  80;
  dirLight.shadow.camera.bottom = -80;
  scene.add(dirLight);
  // FIX 2: il target deve essere aggiunto alla scena per poter essere aggiornato
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

  // Geometria semplice — nessun segmento extra, performance ok su decine di migliaia di istanze
  const geometry = new THREE.BoxGeometry(pilastroWidth, pilastroHeight, pilastroWidth);

  // aoMap richiede uv2 — lo copiamo dagli UV primari
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
  const normalMap    = loadTex('lichen_rock_nor_gl_1k.jpg'); // GL convention = compatibile Three.js
  const roughnessMap = loadTex('lichen_rock_rough_1k.jpg');
  const aoMap        = loadTex('lichen_rock_ao_1k.jpg');
  // arm_1k contiene AO(R) Roughness(G) Metalness(B) — lo usiamo per metalness
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
      planes:  []   // plane meshes con testo inciso, creati/distrutti on demand
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
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateEyeAdaptation(currentTime) {
  if (!gameStartTime) return;

  const elapsed  = currentTime - gameStartTime;
  const duration = 20; // secondi di transizione

  let factor = Math.min(1, elapsed / duration);
  factor = Math.pow(factor, 1.2); // inizio più lento, poi accelera

  // FIX 1: i valori INITIAL coincidono con quelli usati in setupScene()
  hemisphereLight.intensity = INITIAL_HEMISPHERE + (TARGET_HEMISPHERE  - INITIAL_HEMISPHERE)  * factor;
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
  // Risoluzione alta per testo nitido — il canvas viene scalato alla size della plane
  // quindi più pixel = meno sgranatura quando Three.js la mappa sulla geometria
  const W = 512, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Sfondo completamente trasparente: la pietra vera rimane visibile sotto
  ctx.clearRect(0, 0, W, H);

  // ── Funzione incisione ──────────────────────────────────────────────────────
  // Simula un segno inciso nella pietra con tre pass:
  //   1. solco scuro (offset +x+y) = profondità del taglio
  //   2. luce fredda (offset -x-y) = bordo illuminato del solco
  //   3. testo principale grigio medio = superficie incisa
  function carveText(text, x, y, fontSize, weight = 'normal') {
    if (!text || text === '—' || text === '') return;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${weight} ${fontSize}px 'Georgia', serif`;

    const d = fontSize * 0.055; // offset proporzionale alla dimensione

    // 1. Solco — nero semi-trasparente, offset basso-destra
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillText(text, x + d, y + d);

    // 2. Luce — grigio chiarissimo, offset alto-sinistra
    ctx.fillStyle = 'rgba(210, 210, 210, 0.18)';
    ctx.fillText(text, x - d * 0.5, y - d * 0.5);

    // 3. Testo: grigio medio-scuro, non bianco
    ctx.fillStyle = 'rgba(145, 140, 135, 0.88)';
    ctx.fillText(text, x, y);
  }

  // ── Wrap testo su più righe ─────────────────────────────────────────────────
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

  // ── Layout testo ────────────────────────────────────────────────────────────
  // Ordine richiesto: nome arabo / nome europeo / età
  const maxW   = W - 80;
  const cx     = W / 2;
  const arSize = 34;   // nome arabo — leggermente più grande
  const enSize = 30;   // nome europeo
  const agSize = 24;   // età

  const arLines = wrapText(ar_name  || 'غير معروف',     maxW, arSize, 'normal');
  const enLines = wrapText(en_name  || 'Unknown',        maxW, enSize, 'normal');

  const lineH = 46; // interlinea

  // Calcola altezza totale del blocco testo per centrarlo verticalmente
  const totalLines = arLines.length + enLines.length + 1; // +1 per età
  const blockH     = totalLines * lineH + 30; // 30 = gap tra gruppi
  let y = (H - blockH) / 2;

  // Nome arabo
  arLines.forEach(line => {
    carveText(line, cx, y, arSize, 'normal');
    y += lineH;
  });

  // Piccolo gap tra arabo ed europeo
  y += 18;

  // Nome europeo
  enLines.forEach(line => {
    carveText(line, cx, y, enSize, 'normal');
    y += lineH;
  });

  // Gap e età
  y += 22;
  const ageLabel = (age !== undefined && age !== null && String(age).trim() !== '' && age !== '—')
    ? `Age: ${age}`
    : '';
  if (ageLabel) carveText(ageLabel, cx, y, agSize, 'normal');

  const tex = new THREE.CanvasTexture(canvas);
  // Filtraggio lineare per bordi netti anche a distanza ravvicinata
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
    { pos: new THREE.Vector3(cx,               cy, cz + hw + offset), rotY:  0,           order: 1 },
    { pos: new THREE.Vector3(cx,               cy, cz - hw - offset), rotY:  Math.PI,     order: 2 },
    { pos: new THREE.Vector3(cx + hw + offset, cy, cz),               rotY:  Math.PI / 2, order: 3 },
    { pos: new THREE.Vector3(cx - hw - offset, cy, cz),               rotY: -Math.PI / 2, order: 4 },
  ];

  return faces.map(({ pos, rotY, order }) => {
    const mat = new THREE.MeshStandardMaterial({
      map:               tex,
      transparent:       true,
      opacity:           1.0,
      depthWrite:        false,
      depthTest:         true,   // il pilastro oscura le facce posteriori
      alphaTest:         0.0,
      roughness:         0.95,
      metalness:         0.0,
      color:             0x888888,
      emissive:          new THREE.Color(0xffffff), // DEVE essere bianco, non nero
      emissiveMap:       tex,
      emissiveIntensity: 0.0,
      side:              THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.rotation.y = rotY;
    mesh.renderOrder = order; // ordine esplicito: evita z-sorting casuale
    return mesh;
  });
}

function animate() {
  requestAnimationFrame(animate);
  const delta       = Math.min(clock.getDelta(), 0.033);
  const currentTime = performance.now() / 1000;

  if (gameState === 'playing' && gameStartTime) {
    updateEyeAdaptation(currentTime);
  }

  if (dropping) {
    camera.position.y = Math.max(camera.position.y - 30 * delta, GROUND_HEIGHT_OFFSET + 0.5);
    if (camera.position.y <= GROUND_HEIGHT_OFFSET + 0.6) {
      dropping = false;
    }
  }

  if (controls.isLocked && !dropping) {
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

    // FIX 2: aggiorna posizione luce e target ogni frame seguendo il giocatore
    // così la shadow frustum è sempre centrata su chi cammina
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

        // Brillantezza: si accende gradualmente sotto i 7 unità
        // da 0 (lontano) a 1.2 (vicinissimo, quasi luminoso)
        const glow = dist < 7
          ? Math.pow(1 - dist / 7, 1.5) * 1.2
          : 0.0;

        item.planes.forEach(p => {
          p.material.opacity = opacity;
          p.material.emissiveIntensity = glow;
        });

      } else if (item.planes.length > 0) {
        // Rimuovi e smaltisci quando il giocatore si allontana
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