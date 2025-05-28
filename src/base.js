import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

let camera, scene, renderer, labelRenderer, controls;
const move = { forward: false, back: false, left: false, right: false };
const speed = 10.0;
const clock = new THREE.Clock();
let velocity = new THREE.Vector3();

// Configurazione di caricamento a blocchi
let TOTAL_COUNT = 0;
const CHUNK_SIZE = 1000;
let dataIndex = 0;
let instancedMesh;
// Salviamo posizioni e dati per etichette dinamiche
const items = []; // { basePos: Vector3, en_name, name, age, label?: CSS2DObject }

// Altezza di partenza e target dopo click
const START_HEIGHT = 50;
const GROUND_HEIGHT = 1.6;
let dropping = false;
// Soglia distanza per mostrare etichetta
const LABEL_DISTANCE = 10;

init();

async function init() {
  try {
    const resAll = await fetch('https://data.techforpalestine.org/api/v2/killed-in-gaza.json');
    const allData = await resAll.json();
    TOTAL_COUNT = allData.length;

    setupScene();
    fetchChunk();
    setupControls();
    animate();
    window.addEventListener('resize', onWindowResize);
  } catch (err) {
    console.error('Errore caricamento dati totali:', err);
  }
}

function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, START_HEIGHT, 0);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0px';
  document.body.appendChild(labelRenderer.domElement);

  const info = document.createElement('div');
  info.id = 'instructions';
  Object.assign(info.style, {
    position: 'absolute', top: '20px', left: '20px',
    color: '#fff', background: 'rgba(0,0,0,0.5)', padding: '10px',
    fontFamily: 'sans-serif', zIndex: '100'
  });
  info.innerHTML = `Clicca per entrare<br>WASD per muoverti, mouse per guardare<br>Blocchi totali: ${TOTAL_COUNT}`;
  document.body.appendChild(info);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(-100, 100, -100);
  scene.add(dir);

  const gridSize = Math.ceil(Math.sqrt(TOTAL_COUNT));
  const spacing = 5;
  const groundSize = gridSize * spacing;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ color: 0x666666 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
}

async function fetchChunk() {
  if (dataIndex >= TOTAL_COUNT) return;
  try {
    const res = await fetch(`https://data.techforpalestine.org/api/v2/killed-in-gaza.json?offset=${dataIndex}&limit=${CHUNK_SIZE}`);
    const chunk = await res.json();
    addInstancedBlocks(chunk);
    dataIndex += chunk.length;
    setTimeout(fetchChunk, 0);
  } catch (err) {
    console.error('Errore fetch chunk:', err);
  }
}

function addInstancedBlocks(data) {
  if (!instancedMesh) {
    const geo = new THREE.BoxGeometry(2, 4, 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000 });
    instancedMesh = new THREE.InstancedMesh(geo, mat, TOTAL_COUNT);
    scene.add(instancedMesh);
  }

  const spacing = 5;
  const gridSize = Math.ceil(Math.sqrt(TOTAL_COUNT));
  const halfGrid = (gridSize - 1) * spacing / 2;
  const cubeHalfWidth = 1; // metà della larghezza del cubo

  data.forEach((item, i) => {
    const idx = dataIndex + i;
    const row = Math.floor(idx / gridSize);
    const col = idx % gridSize;
    const x = col * spacing - halfGrid;
    const z = row * spacing - halfGrid;
    const y = 2;

    // istanza del cubo
    const matrix = new THREE.Matrix4().setPosition(x, y, z);
    instancedMesh.setMatrixAt(idx, matrix);

    // Salva posizione base per etichetta laterale
    const basePos = new THREE.Vector3(x + cubeHalfWidth + 0.2, y, z); // sul lato +X
    items.push({ basePos, en_name: item.en_name, name: item.name, age: item.age });
  });

  instancedMesh.instanceMatrix.needsUpdate = true;
}

function setupControls() {
  controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.object);

  const instructions = document.getElementById('instructions');
  controls.addEventListener('lock', () => { if (instructions) instructions.style.display = 'none'; });

  document.body.addEventListener('click', () => {
    if (!dropping) { dropping = true; controls.lock(); }
  });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
}

function onKeyDown(event) {
  switch (event.code) {
    case 'ArrowUp': move.forward = true; break;
    case 'ArrowDown': move.back = true;   break;
    case 'ArrowLeft': move.left = true;   break;
    case 'ArrowRight': move.right = true; break;
  }
}

function onKeyUp(event) {
  switch (event.code) {
    case 'ArrowUp': move.forward = false; break;
    case 'ArrowDown': move.back = false;  break;
    case 'ArrowLeft': move.left = false;  break;
    case 'ArrowRight': move.right = false;break;
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (dropping) {
    camera.position.y = Math.max(camera.position.y - 30 * delta, GROUND_HEIGHT);
    if (camera.position.y <= GROUND_HEIGHT) { camera.position.y = GROUND_HEIGHT; dropping = false; }
  }

  if (controls.isLocked && !dropping) {
    velocity.set((move.right - move.left) * speed * delta, 0, (move.back - move.forward) * speed * delta);
    const dir = new THREE.Vector3();
    controls.object.getWorldDirection(dir).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const moveVec = dir.multiplyScalar(-velocity.z).add(right.multiplyScalar(velocity.x));
    controls.object.position.add(moveVec);

    // Gestione etichette sul lato
    items.forEach(item => {
      const dist = camera.position.distanceTo(item.basePos);
      if (dist < LABEL_DISTANCE) {
        if (!item.label) {
          const div = document.createElement('div');
          div.className = 'label';
          div.style.color = '#fff';
          div.style.background = 'rgba(0,0,0,0.5)';
          div.style.padding = '2px';
          div.innerHTML = `<strong>${item.en_name}</strong><br>${item.name}<br>Age: ${item.age}`;
          const label = new CSS2DObject(div);
          label.position.copy(item.basePos);
          scene.add(label);
          item.label = label;
        }
      } else if (item.label) {
        scene.remove(item.label);
        item.label.element.remove();
        delete item.label;
      }
    });
  }

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}