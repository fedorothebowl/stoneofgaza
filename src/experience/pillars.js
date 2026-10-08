import * as THREE from 'three';
import { COLOR_PILLAR, PILLAR_HEIGHT, PILLAR_WIDTH, SPACING } from './config.js';
import { gridHalfSizeFor, gridSizeFor, snapToGrid } from './grid.js';

const HALF_WIDTH = PILLAR_WIDTH / 2;
const CENTER_Y   = PILLAR_HEIGHT / 2 - 0.1;

// Materiale condiviso per tutti i pilastri (principale + bordo)
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
    normalScale:    new THREE.Vector2(0.35, 0.35),
    roughnessMap:   loadTex('lichen_rock_rough_1k.jpg'),
    roughness:      1.0,
    metalnessMap:   loadTex('lichen_rock_arm_1k.jpg'),
    metalness:      0.75,
    aoMap:          loadTex('lichen_rock_ao_1k.jpg'),
    aoMapIntensity: 1.4,
    color:          COLOR_PILLAR,
    side:           THREE.FrontSide
  });
}

// Un InstancedMesh con un pilastro (e il relativo collider) per ogni posizione
function addPillars(scene, material, positions, colliders, colliderFloor) {
  const geometry = new THREE.BoxGeometry(PILLAR_WIDTH, PILLAR_HEIGHT, PILLAR_WIDTH);
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);

  const matrix = new THREE.Matrix4();
  positions.forEach(({ x, z }, i) => {
    mesh.setMatrixAt(i, matrix.makeTranslation(x, CENTER_Y, z));

    colliders.add(new THREE.Box3(
      new THREE.Vector3(x - HALF_WIDTH, colliderFloor, z - HALF_WIDTH),
      new THREE.Vector3(x + HALF_WIDTH, PILLAR_HEIGHT, z + HALF_WIDTH)
    ));
  });

  mesh.instanceMatrix.needsUpdate = true;
}

// Recinzione: un anello di pilastri attorno alla griglia
function borderPositions(halfSize) {
  const min = -halfSize - SPACING;
  const max =  halfSize + SPACING;
  const positions = [];

  for (let x = min; x <= max + 0.01; x += SPACING) {
    positions.push({ x: snapToGrid(x), z: min });
    positions.push({ x: snapToGrid(x), z: max });
  }
  for (let z = min + SPACING; z < max - 0.01; z += SPACING) {
    positions.push({ x: min, z: snapToGrid(z) });
    positions.push({ x: max, z: snapToGrid(z) });
  }
  return positions;
}

// Muri invisibili appena fuori dalla recinzione
function addOuterWalls(colliders, edge) {
  const wallH = 20;
  const wallD = 1.0;
  const outer = edge + wallD;

  [
    [[-outer, -5,  edge ], [ outer, wallH,  outer]],
    [[-outer, -5, -outer], [ outer, wallH, -edge ]],
    [[ edge,  -5, -outer], [ outer, wallH,  outer]],
    [[-outer, -5, -outer], [-edge,  wallH,  outer]],
  ].forEach(([min, max]) => {
    colliders.add(new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)));
  });
}

// Costruisce il memoriale: un pilastro per persona più la recinzione.
// Restituisce gli item usati per incidere i nomi e la semi-ampiezza della griglia.
export function buildPillars(scene, people, colliders) {
  const material = createPillarMaterial();
  const gridSize = gridSizeFor(people.length);
  const halfSize = gridHalfSizeFor(people.length);

  const items = people.map((person, index) => ({
    position: new THREE.Vector3(
      (index % gridSize) * SPACING - halfSize,
      CENTER_Y,
      Math.floor(index / gridSize) * SPACING - halfSize
    ),
    person,
    planes: []
  }));

  addPillars(scene, material, items.map(item => item.position), colliders, 0);
  addPillars(scene, material, borderPositions(halfSize), colliders, -1);
  addOuterWalls(colliders, halfSize + SPACING + HALF_WIDTH);

  return { items, halfSize };
}
