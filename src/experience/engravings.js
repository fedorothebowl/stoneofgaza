import * as THREE from 'three';
import { ENGRAVING_DISTANCE, ENGRAVINGS_PER_FRAME, PILLAR_HEIGHT, PILLAR_WIDTH } from './config.js';

// ─────────────────────────────────────────────────────────────
// TESTO INCISO NELLA PIETRA
// ─────────────────────────────────────────────────────────────

const HALF_WIDTH   = PILLAR_WIDTH / 2;
const FACE_OFFSET  = HALF_WIDTH + 0.02;
const FONT         = `'Georgia', serif`;
const _faceNormal  = new THREE.Vector3();

// Le quattro facce del pilastro: direzione della normale e rotazione del piano
const FACES = [
  { x:  0, z:  1, rotY:  0           },
  { x:  0, z: -1, rotY:  Math.PI     },
  { x:  1, z:  0, rotY:  Math.PI / 2 },
  { x: -1, z:  0, rotY: -Math.PI / 2 },
];

function createEngravedTexture({ en_name, ar_name, age }) {
  const W = 512, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  function carveText(text, x, y, fontSize) {
    if (!text || text === '—' || text === '') return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${fontSize}px ${FONT}`;
    const d = fontSize * 0.055;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';       ctx.fillText(text, x + d, y + d);
    ctx.fillStyle = 'rgba(210,210,210,0.18)';  ctx.fillText(text, x - d * 0.5, y - d * 0.5);
    ctx.fillStyle = 'rgba(145,140,135,0.88)';  ctx.fillText(text, x, y);
  }

  function wrapText(text, maxWidth, fontSize) {
    ctx.font = `${fontSize}px ${FONT}`;
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
  const hasAge = age !== undefined && age !== null && String(age).trim() !== '' && age !== '—';
  if (hasAge) carveText(`Age: ${age}`, cx, y, 24);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  return tex;
}

// Un piano trasparente con il nome su ognuna delle quattro facce.
// Texture e geometry sono condivise tra i quattro piani.
function createEngravingPlanes(item, renderer) {
  const tex = createEngravedTexture(item.person);
  // Carica subito la texture sulla GPU, invece che al primo frame in cui il piano entra in vista
  renderer.initTexture(tex);
  const geo = new THREE.PlaneGeometry(PILLAR_WIDTH, PILLAR_HEIGHT);

  return FACES.map((face, i) => {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 1.0,
      depthWrite: false, depthTest: true, alphaTest: 0.0,
      color: new THREE.Color(1, 1, 1),
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      item.position.x + face.x * FACE_OFFSET,
      PILLAR_HEIGHT / 2,
      item.position.z + face.z * FACE_OFFSET
    );
    mesh.rotation.y = face.rotY;
    mesh.renderOrder = i + 1;
    mesh.userData.face = face;
    return mesh;
  });
}

function disposeEngravingPlanes(scene, item) {
  // Geometry e texture sono condivise tra le 4 planes: dispose UNA sola volta
  const { geometry, material } = item.planes[0];
  geometry.dispose();
  material.map?.dispose();

  item.planes.forEach(p => {
    scene.remove(p);
    p.material.dispose();
  });
  item.planes = [];
}

const NEAR_SQ = ENGRAVING_DISTANCE * ENGRAVING_DISTANCE;

// Incide i nomi sui pilastri vicini alla camera e libera quelli lontani.
// La distanza è misurata in pianta, così i nomi si preparano già durante
// l'intro e la discesa, e se ne creano pochi per frame: disegnare e caricare
// decine di texture nello stesso frame produce uno scatto visibile.
// Restituisce true se in questo frame sono stati creati nuovi piani.
export function updateEngravings(scene, items, cameraPosition, sunDirection, renderer) {
  let budget = ENGRAVINGS_PER_FRAME;

  for (const item of items) {
    const dx = cameraPosition.x - item.position.x;
    const dz = cameraPosition.z - item.position.z;
    const near = dx * dx + dz * dz < NEAR_SQ;

    if (!near) {
      if (item.planes.length > 0) disposeEngravingPlanes(scene, item);
      continue;
    }

    if (item.planes.length === 0) {
      if (budget === 0) continue;
      budget--;
      item.planes = createEngravingPlanes(item, renderer);
      scene.add(...item.planes);
    }

    for (const plane of item.planes) {
      const { x, z } = plane.userData.face;
      const illum = Math.max(0, _faceNormal.set(x, 0, z).dot(sunDirection));
      // Faccia illuminata → opacity 1.0, faccia in ombra → opacity 0.25
      plane.material.opacity = 0.25 + illum * 0.75;
    }
  }

  return budget < ENGRAVINGS_PER_FRAME;
}
