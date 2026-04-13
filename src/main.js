import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// ── Rilevamento mobile ────────────────────────────────────────────────────────
const isMobile = /Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent)
  || ('ontouchstart' in window && navigator.maxTouchPoints > 1);

let camera, scene, renderer, controls;
const move = { forward: false, back: false, left: false, right: false };
const speed = 2;
const clock = new THREE.Clock();
let velocity = new THREE.Vector3();

// Head bob
const BOB_FREQ = Math.PI; // ~1.8 cicli/s — un passo ogni ~0.55s a velocità 2
const BOB_AMP  = 0.02;          // ampiezza verticale (world units)
let bobTimer = 0;
let bobBlend = 0;                 // 0 = fermo, 1 = in cammino (fade in/out)

// ─────────────────────────────────────────────────────────────
// MOLTIPLICATORE VELOCITÀ (test: 10.0 — produzione: 1.0)
// Scala: movimento manuale, autoplay walk, animazioni turn/snap/pitch,
//        eye adaptation, idle delay, caduta iniziale.
// ─────────────────────────────────────────────────────────────
const DEV_SPEED_MULT = 1;

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
// COLORI SCENA
// ─────────────────────────────────────────────────────────────

// ── Cielo ─────────────────────────────────────────────────────
const COLOR_SKY_TOP    = 0x505050;   // zenith
const COLOR_SKY_MID    = 0x606060;   // orizzonte
const COLOR_SKY_BOTTOM = 0x404040;   // sotto l'orizzonte

// ── Nebbia e sfondo renderer ──────────────────────────────────
const COLOR_FOG        = 0x202020;
const COLOR_CLEAR      = 0x101010;

// ── Luci ──────────────────────────────────────────────────────
const COLOR_HEMI_SKY    = 0x404040;  // HemisphereLight — lato cielo
const COLOR_HEMI_GROUND = 0x202020;  // HemisphereLight — lato terra
const COLOR_DIRECTIONAL = 0x707070;
const COLOR_AMBIENT     = 0x303030;
const COLOR_FILL        = 0x505050;
const COLOR_BACK        = 0x404040;

// ── Terreno ───────────────────────────────────────────────────
const COLOR_FLOOR          = 0x000000;
const COLOR_FLOOR_EMISSIVE = 0x000000;

// ── Pilastri ──────────────────────────────────────────────────
const COLOR_PILLAR           = 0xffffff;  // materiale con texture (MeshStandardMaterial)
const COLOR_PILLAR_INSTANCED = 0x888888;  // materiale instanced mesh
const PILLAR_HEIGHT          = 4.5;       // altezza dei pilastri

// ─────────────────────────────────────────────────────────────
// VALORI LUCI
// ─────────────────────────────────────────────────────────────
const INITIAL_HEMISPHERE  = 0.90 * 2;
const INITIAL_DIRECTIONAL = 2.4  * 2;
const INITIAL_AMBIENT     = 0.90 * 2;
const INITIAL_FILL        = 0.70 * 2;
const INITIAL_BACK        = 0.50 * 2;
const INITIAL_SKY         = 1.30 * 2;
const INITIAL_FOG_DENSITY = 0.01;

const TARGET_HEMISPHERE   = 0.90 * 3;
const TARGET_DIRECTIONAL  = 2.4  * 3;
const TARGET_AMBIENT      = 0.90 * 3;
const TARGET_FILL         = 0.70 * 3;
const TARGET_BACK         = 0.50 * 3;
const TARGET_SKY          = 1.30 * 3;
const TARGET_FOG_DENSITY  = 0.1;

// ─────────────────────────────────────────────────────────────
// AUTOPLAY
// ─────────────────────────────────────────────────────────────
const AUTOPLAY_WALK_SPEED   = 2;
const AUTOPLAY_TURN_SECONDS = 2.6;

// ── Reading ───────────────────────────────────────────────────
const READING_TURN_SECS      = 1.5; // durata rotazione verso/da il pilastro
const READING_PITCH          = 0.28; // angolo di inclinazione testa (radianti)
const READING_TILT_SECS      = 1.4; // durata ease-in-out tilt su/giù
const READING_PAUSE_SECS     = 2; // pausa minima mentre si guarda il nome
const READING_PAUSE_DOWN_SECS = 0; // pausa dopo che la testa è tornata giù

let autoplayActive = false;

// Parallax intro: posizione normalizzata del mouse (-1 … 1)
let introMouseNX = 0;
let introMouseNY = 0;

let apSub            = 'walking';
let apTimer          = 0;
let apWalkDist       = 0;
let apWalkedDist     = 0;
let apReadWalkDist   = 0;
let apReadWalkTarget = 0;
let apDirIdx         = 0;
let apIntersCount    = 0;
let apIntersTarget   = 1;
let apSnapTarget     = 0;
let _stopAfterSnap   = false;

let apReadPhase      = '';
let apTiltPitchStart = 0;
let apReadYawBack = 0;

// ── Rotazione quaternion-safe con ordine YXZ ──────────────────
// ─────────────────────────────────────────────────────────────
// ROOT CAUSE del glitch "ubriaco":
//   Three.js usa 'XYZ' come ordine Euler di default. Noi invece
//   leggiamo/scriviamo il quaternion della camera con ordine 'YXZ'
//   (in getCameraPitch/setCameraPitch e internamente in PointerLockControls).
//   In Three.js moderno controls.getObject() restituisce direttamente
//   la camera (non un oggetto yaw separato). Quando scriviamo
//   `camera.rotation.y = val` con ordine 'XYZ', Three.js ricalcola
//   il quaternion da Euler(rotation.x, val, rotation.z, 'XYZ') —
//   ma rotation.x contiene il pitch codificato in 'XYZ', non in 'YXZ'.
//   Ogni frame la rotazione si corrompe leggermente; l'effetto
//   si accumula → vista "ubriaca" dopo qualche minuto.
//
//   FIX: impostare camera.rotation.order = 'YXZ' UNA VOLTA sola
//   in setupScene(). Tutte le operazioni rotation.y/x/.z sono
//   coerenti con i quaternion 'YXZ' e con PointerLockControls.
// ─────────────────────────────────────────────────────────────
const _pitchEuler = new THREE.Euler(0, 0, 0, 'YXZ');

function getCameraYaw() {
  _pitchEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  return _pitchEuler.y;
}

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

function setCameraYaw(value) {
  _pitchEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  _pitchEuler.y = value;
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

// Snap alla riga di pilastri più vicina lungo l'asse di cammino.
// Usato prima di entrare in lettura per centrare la camera
// esattamente di fronte a un pilastro, eliminando l'overshoot
// del passo discreto (specialmente con DEV_SPEED_MULT > 1).
function snapToPillarRow(camObj, dirIdx) {
  const dir = AP_DIRS[dirIdx];
  if (dir.z !== 0) {
    // cammino in Z → snap della Z alla riga pilastri
    const raw = camObj.position.z + apGridHalfSize;
    camObj.position.z = Math.round(raw / SPACING) * SPACING - apGridHalfSize;
  } else {
    // cammino in X → snap della X alla colonna pilastri
    const raw = camObj.position.x + apGridHalfSize;
    camObj.position.x = Math.round(raw / SPACING) * SPACING - apGridHalfSize;
  }
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
  apYawStart  = getCameraYaw();
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

// ── Arduino via Web Serial API ────────────────────────────────────────────────
async function connectArduino() {
  if (!('serial' in navigator)) {
    alert('Web Serial API non supportata. Usa Chrome o Edge aggiornato.');
    return;
  }
  let port = null;
  let reader = null;
  try {
    port = await navigator.serial.requestPort();
    for (let i = 1; i <= 5; i++) {
      try { await port.open({ baudRate: 9600 }); break; }
      catch (e) {
        if (i === 5) throw e;
        console.warn(`[Arduino] porta occupata, riprovo (${i}/5)...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    console.log('[Arduino] connesso');

    // Legge direttamente senza pipeTo (più facile da chiudere correttamente)
    const textDecoder = new TextDecoder();
    reader = port.readable.getReader();

    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += textDecoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const cmd = line.trim();
        if (gameState !== 'playing') continue;
        if (cmd === '1' && !autoplayActive && !dropping) startAutoplay();
        else if (cmd === '0' && autoplayActive && !_stopAfterSnap) stopAutoplay();
      }
    }
  } catch (e) {
    console.warn('[Arduino] disconnesso:', e.message);
  } finally {
    try { await reader?.cancel(); } catch (_) {}
    try { reader?.releaseLock(); } catch (_) {}
    try { await port?.close(); } catch (_) {}
    try { await port?.forget(); } catch (_) {} // rimuove il permesso così requestPort mostra il dialog
    console.log('[Arduino] porta chiusa — premi A per riconnettere');
  }
}

function startAutoplay() {
  autoplayActive = true;

  if (controls) controls.disconnect();

  // Azzera il roll residuo
  _pitchEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  _pitchEuler.z = 0;
  camera.quaternion.setFromEuler(_pitchEuler);

  apTimer = 0;

  const curYaw = getCameraYaw();
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
  apIntersTarget   = 5 + Math.floor(Math.random() * 6);
}

function stopAutoplay() {
  if (_stopAfterSnap) return; // già in uscita
  _stopAfterSnap = true;

  // Durante 'reading', apYawTarget punta al pilastro — usiamo apReadYawBack (corridoio)
  apYawTarget  = (apSub === 'reading') ? apReadYawBack : apYawTarget;
  apYawStart   = getCameraYaw();
  apSnapTarget = nearestCorridorCenter(controls.getObject().position, apDirIdx);
  apSub        = 'snapping';

  move.forward = move.back = move.left = move.right = false;
  if (footstepAudio && !footstepAudio.paused) {
    footstepAudio.pause();
    footstepAudio.currentTime = 0;
  }
}

function _finalizeStopAutoplay() {
  _stopAfterSnap = false;
  autoplayActive = false;
  if (controls) controls.connect();
}

function updateAutoplay(delta) {
  if (!autoplayActive) return;

  const camObj = controls.getObject();

  // Azzera il roll ogni frame (non deve mai accumularsi)
  _pitchEuler.setFromQuaternion(camera.quaternion, 'YXZ');
  if (Math.abs(_pitchEuler.z) > 0.0001) {
    _pitchEuler.z = 0;
    camera.quaternion.setFromEuler(_pitchEuler);
  }

  if (apSub !== 'reading') {
    const px = getCameraPitch();
    if (Math.abs(px) > 0.001) {
      const t = 1.0 - Math.exp(-(_stopAfterSnap ? 1.5 : 3.5) * DEV_SPEED_MULT * delta);
      setCameraPitch(THREE.MathUtils.lerp(px, 0, t));
    } else {
      setCameraPitch(0);
    }
  }

  apTimer += delta;
  // apTimerScaled accelera tutte le fasi temporizzate con DEV_SPEED_MULT.
  // 1.0 = normale, 10.0 = 10× più veloce. Le costanti di durata restano intatte.
  const apTimerScaled = apTimer * DEV_SPEED_MULT;

  // Bob fade-out quando autoplay non cammina
  if (apSub !== 'walking') bobBlend += (0 - bobBlend) * Math.min(1, 6 * delta);

  if (apSub === 'snapping') {
    const dir        = AP_DIRS[apDirIdx];
    const SNAP_SPEED = (_stopAfterSnap ? 2.5 : 18.0) * DEV_SPEED_MULT;

    if (dir.z !== 0) {
      const diff = apSnapTarget - camObj.position.x;
      if (Math.abs(diff) < 0.02) {
        camObj.position.x = apSnapTarget;
        if (_stopAfterSnap) {
          let yd = apYawTarget - getCameraYaw();
          yd = ((yd + Math.PI) % (Math.PI * 2)) - Math.PI;
          if (Math.abs(yd) < 0.01 && Math.abs(getCameraPitch()) < 0.01) _finalizeStopAutoplay();
        } else { apSub = 'walking'; }
      } else camObj.position.x += Math.sign(diff) * Math.min(Math.abs(diff), SNAP_SPEED * delta);
    } else {
      const diff = apSnapTarget - camObj.position.z;
      if (Math.abs(diff) < 0.02) {
        camObj.position.z = apSnapTarget;
        if (_stopAfterSnap) {
          let yd = apYawTarget - getCameraYaw();
          yd = ((yd + Math.PI) % (Math.PI * 2)) - Math.PI;
          if (Math.abs(yd) < 0.01 && Math.abs(getCameraPitch()) < 0.01) _finalizeStopAutoplay();
        } else { apSub = 'walking'; }
      } else camObj.position.z += Math.sign(diff) * Math.min(Math.abs(diff), SNAP_SPEED * delta);
    }

    // Corregge lo yaw durante lo snap — shortestYaw garantisce sempre il percorso più breve
    const yawDiff = shortestYaw(getCameraYaw(), apYawTarget);
    if (Math.abs(yawDiff) < 0.001) {
      setCameraYaw(apYawTarget);
    } else {
      setCameraYaw(getCameraYaw() + yawDiff * Math.min(1, (_stopAfterSnap ? 2.0 : 8.0) * DEV_SPEED_MULT * delta));
    }
    return;
  }

  if (apSub === 'walking') {
    const dir  = AP_DIRS[apDirIdx];
    const step = AUTOPLAY_WALK_SPEED * DEV_SPEED_MULT * delta;
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

      bobTimer += step;
      bobBlend += (1 - bobBlend) * Math.min(1, 6 * delta);
      const bobOffset = Math.sin(bobTimer * BOB_FREQ) * BOB_AMP * bobBlend;
      const th = getTerrainHeight(newPos.x, newPos.z);
      camObj.position.y += ((th + GROUND_HEIGHT_OFFSET + bobOffset) - camObj.position.y) * 0.25;

      let yawDiff = apYawTarget - getCameraYaw();
      yawDiff = ((yawDiff + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(yawDiff) < 0.001) {
        setCameraYaw(apYawTarget);
      } else {
        setCameraYaw(getCameraYaw() + yawDiff * Math.min(1, 8 * DEV_SPEED_MULT * delta));
      }

      apWalkedDist   += step;
      apReadWalkDist += step;

      if (footstepAudio && footstepAudio.paused) footstepAudio.play();

      if (apReadWalkDist >= apReadWalkTarget) {
        apReadWalkDist   = 0;
        apReadWalkTarget = (3 + Math.floor(Math.random() * 3)) * SPACING;

        // ── Centering fix: snap alla riga/colonna di pilastri esatta
        //    prima di girare a guardarlo. Elimina l'overshoot del passo
        //    discreto (più evidente con DEV_SPEED_MULT > 1).
        snapToPillarRow(camObj, apDirIdx);

        const sideOffset = Math.random() < 0.5 ? 1 : 3;
        const sideDirIdx = (apDirIdx + sideOffset) % 4;

        apReadYawBack = dirToYaw(AP_DIRS[apDirIdx]);
        apYawStart    = getCameraYaw();
        apYawTarget   = apYawStart + shortestYaw(apYawStart, dirToYaw(AP_DIRS[sideDirIdx]));

        apSub       = 'reading';
        apReadPhase = 'turn_to';
        apTimer     = 0;

        if (footstepAudio && !footstepAudio.paused) {
          footstepAudio.pause(); footstepAudio.currentTime = 0;
        }
        return;
      }

      if (apWalkedDist >= apWalkDist) {
        apIntersCount++;
        apWalkedDist = 0;

        if (apIntersCount >= apIntersTarget) {
          apPickDir(SPACING * 0.8);
          apSub          = 'turning';
          apTimer        = 0;
          apIntersCount  = 0;
          apIntersTarget = 5 + Math.floor(Math.random() * 6);
        } else {
          apWalkDist = distToNextIntersection(camObj.position, apDirIdx);
        }
        if (footstepAudio && !footstepAudio.paused) {
          footstepAudio.pause(); footstepAudio.currentTime = 0;
        }
      }
    }

  } else if (apSub === 'reading') {

    if (apReadPhase === 'turn_to') {
      const t    = Math.min(1, apTimerScaled / READING_TURN_SECS);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      let diff   = apYawTarget - apYawStart;
      diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
      setCameraYaw(apYawStart + diff * ease);
      if (t >= 1) {
        setCameraYaw(apYawStart + diff);
        apTiltPitchStart = getCameraPitch();
        apReadPhase = 'tilt_up'; apTimer = 0;
      }

    } else if (apReadPhase === 'tilt_up') {
      const t    = Math.min(1, apTimerScaled / READING_TILT_SECS);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setCameraPitch(apTiltPitchStart + (READING_PITCH - apTiltPitchStart) * ease);
      if (t >= 1) { setCameraPitch(READING_PITCH); apReadPhase = 'pause'; apTimer = 0; }

    } else if (apReadPhase === 'pause') {
      if (apTimerScaled >= READING_PAUSE_SECS) {
        apTiltPitchStart = getCameraPitch();
        apReadPhase = 'tilt_down'; apTimer = 0;
      }

    } else if (apReadPhase === 'tilt_down') {
      const t    = Math.min(1, apTimerScaled / READING_TILT_SECS);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setCameraPitch(apTiltPitchStart * (1 - ease));
      if (t >= 1) {
        setCameraPitch(0);
        apReadPhase = 'pause_down';
        apTimer     = 0;
      }

    } else if (apReadPhase === 'pause_down') {
      if (apTimerScaled >= READING_PAUSE_DOWN_SECS) {
        apYawStart  = getCameraYaw();
        apYawTarget = apYawStart + shortestYaw(apYawStart, apReadYawBack);
        apReadPhase = 'turn_back';
        apTimer     = 0;
      }

    } else if (apReadPhase === 'turn_back') {
      const t    = Math.min(1, apTimerScaled / READING_TURN_SECS);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      let diff   = apYawTarget - apYawStart;
      diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
      setCameraYaw(apYawStart + diff * ease);
      if (t >= 1) {
        setCameraYaw(apYawStart + diff);
        normalizeYaw();
        apYawTarget = apReadYawBack;
        apWalkDist  = distToNextIntersection(camObj.position, apDirIdx);
        apSub       = 'walking';
        apTimer     = 0;
      }
    }

  } else if (apSub === 'pausing') {
    apSub        = 'walking';
    apWalkDist   = distToNextIntersection(controls.getObject().position, apDirIdx);
    apWalkedDist = 0;

  } else if (apSub === 'turning') {
    const t    = Math.min(1, apTimerScaled / AUTOPLAY_TURN_SECONDS);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    let diff = apYawTarget - apYawStart;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    setCameraYaw(apYawStart + diff * ease);

    if (t >= 1) {
      setCameraYaw(apYawStart + diff);
      normalizeYaw();
      apSnapTarget    = nearestCorridorCenter(camObj.position, apDirIdx);
      apSub           = 'snapping';
      apTimer         = 0;
      apWalkDist      = distToNextIntersection(camObj.position, apDirIdx);
      apWalkedDist    = 0;
    }
  }
}

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
    color:          COLOR_PILLAR,
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
      topColor:    { value: new THREE.Color(COLOR_SKY_TOP) },
      midColor:    { value: new THREE.Color(COLOR_SKY_MID) },
      bottomColor: { value: new THREE.Color(COLOR_SKY_BOTTOM) },
      intensity:   { value: INITIAL_SKY }
    },
    side: THREE.BackSide
  });
  return new THREE.Mesh(skyGeometry, skyMaterial);
}

function getTerrainHeight(_x, _z) {
  return 0;
}

function createTerrain(width, depth, segments) {
  const geometry = new THREE.PlaneGeometry(width, depth, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color:    COLOR_FLOOR,
    roughness: 0.7,
    metalness: 0.1,
    emissive: COLOR_FLOOR_EMISSIVE,
    side:     THREE.DoubleSide
  });

  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.castShadow = true;

  console.log('Terreno creato con materiale nero');

  return terrain;
}

function setupScene() {
  scene = new THREE.Scene();

  skyMesh = createDarkSky();
  scene.add(skyMesh);

  scene.fog = new THREE.FogExp2(COLOR_FOG, INITIAL_FOG_DENSITY);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
  camera.position.set(SPACING / 2, START_HEIGHT, SPACING / 2);

  // ── FIX PRINCIPALE: impostare l'ordine Euler della camera a 'YXZ'.
  //    Three.js usa 'XYZ' di default. PointerLockControls usa 'YXZ'
  //    internamente. Il nostro codice (getCameraPitch/setCameraPitch,
  //    getCameraYaw) usa 'YXZ'. Con ordini diversi, ogni assegnazione
  //    diretta a camera.rotation.y ricreava il quaternion con il pitch
  //    sbagliato → accumulo di errori rotativi → effetto ubriaco.
  camera.rotation.order = 'YXZ';

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(COLOR_CLEAR);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.querySelector("main").appendChild(renderer.domElement);

  document.getElementById("sad-count").innerHTML = TOTAL_COUNT;

  hemisphereLight = new THREE.HemisphereLight(COLOR_HEMI_SKY, COLOR_HEMI_GROUND, INITIAL_HEMISPHERE);
  scene.add(hemisphereLight);

  dirLight = new THREE.DirectionalLight(COLOR_DIRECTIONAL, INITIAL_DIRECTIONAL);
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

  ambientLight = new THREE.AmbientLight(COLOR_AMBIENT, INITIAL_AMBIENT);
  scene.add(ambientLight);

  fillLight = new THREE.PointLight(COLOR_FILL, INITIAL_FILL);
  fillLight.position.set(10, 30, 10);
  scene.add(fillLight);

  backLight = new THREE.PointLight(COLOR_BACK, INITIAL_BACK);
  backLight.position.set(-20, 25, -30);
  scene.add(backLight);

  const gridSize = Math.ceil(Math.sqrt(TOTAL_COUNT));
  terrainWidth = (gridSize + 15) * SPACING;
  terrainDepth = (gridSize + 15) * SPACING;
  const segments = Math.min(150, Math.floor(terrainWidth / 2.5));

  terrainMesh = createTerrain(terrainWidth, terrainDepth, segments);
  scene.add(terrainMesh);

}

function setupFootstepAudio() {
  footstepAudio = new Audio('freesound_community-footsteps-dirt-gravel-6823.mp3');
  footstepAudio.loop = true;
  footstepAudio.volume = 0.5;
}

function startGameDirectly() {
  const instructions = document.getElementById('instructions');
  instructions.style.display = 'none';
  gameStartTime     = performance.now() / 1000;

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
  const pilastroHeight = PILLAR_HEIGHT;

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
    const y = pilastroHeight / 2 - 0.1;

    instancedMesh.setMatrixAt(index, new THREE.Matrix4().makeTranslation(x, y, z));

    const hw = pilastroWidth / 2;
    colliderBoxes.push(new THREE.Box3(
      new THREE.Vector3(x - hw, 0,             z - hw),
      new THREE.Vector3(x + hw, pilastroHeight, z + hw)
    ));

    items.push({
      basePos: new THREE.Vector3(x, y, z),
      pillarHalfW: hw, pillarH: pilastroHeight,
      en_name: item.en_name, ar_name: item.ar_name, age: item.age,
      planes: []
    });
  });

  instancedMesh.instanceMatrix.needsUpdate = true;
}

function createBorderPillars() {
  const pilastroWidth  = 2.3;
  const pilastroHeight = PILLAR_HEIGHT;
  const hw = pilastroWidth / 2;

  const outerOffset = SPACING;
  const minC = -apGridHalfSize - outerOffset;
  const maxC =  apGridHalfSize + outerOffset;

  const borderPos = [];

  for (let x = minC; x <= maxC + 0.01; x += SPACING) {
    borderPos.push({ x: snap(x), z: minC });
    borderPos.push({ x: snap(x), z: maxC });
  }
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
    const y = pilastroHeight / 2 - 0.1;
    borderMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z));

    colliderBoxes.push(new THREE.Box3(
      new THREE.Vector3(x - hw, -1,             z - hw),
      new THREE.Vector3(x + hw, pilastroHeight, z + hw)
    ));
  });

  borderMesh.instanceMatrix.needsUpdate = true;

  const wallH = 20;
  const wallD = 1.0;
  const edge  = maxC + hw;

  [
    new THREE.Box3(
      new THREE.Vector3(-edge - wallD, -5,  edge),
      new THREE.Vector3( edge + wallD, wallH, edge + wallD)
    ),
    new THREE.Box3(
      new THREE.Vector3(-edge - wallD, -5, -edge - wallD),
      new THREE.Vector3( edge + wallD, wallH, -edge)
    ),
    new THREE.Box3(
      new THREE.Vector3( edge,         -5, -edge - wallD),
      new THREE.Vector3( edge + wallD, wallH,  edge + wallD)
    ),
    new THREE.Box3(
      new THREE.Vector3(-edge - wallD, -5, -edge - wallD),
      new THREE.Vector3(-edge,         wallH,  edge + wallD)
    ),
  ].forEach(w => colliderBoxes.push(w));

  console.log(`Recinzione: ${borderPos.length} pilastri al perimetro.`);
}

function snap(v) {
  return Math.round(v / SPACING) * SPACING;
}

function shortestYaw(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d >  Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// normalizeYaw ora opera direttamente su camera.rotation.y (YXZ-coerente)
// e aggiorna i riferimenti apYawStart/apYawTarget di conseguenza.
function normalizeYaw() {
  const PI2 = Math.PI * 2;
  const y = getCameraYaw();
  if (y > Math.PI || y < -Math.PI) {
    const shift = Math.round(y / PI2) * PI2;
    setCameraYaw(y - shift);
    apYawStart  -= shift;
    apYawTarget -= shift;
  }
}

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
      
        dropping          = true;
      }
      pauseScreen.classList.add('hidden');
      gameState = 'playing';
      if (bgAudio) { bgAudio.muted = false; bgAudio.play(); }
    });

    // ── FIX ESC/pausa ────────────────────────────────────────────────
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) return; // lock acquisito, non rilasciato
      if (gameState !== 'playing') return;

      if (autoplayActive) {
        stopAutoplay();
        // controls.disconnect() era attivo durante l'autoplay, quindi isLocked
        // non è stato aggiornato dal listener interno di PointerLockControls.
        // Lo resettiamo manualmente per evitare che il mouse ruoti la camera.
        controls.isLocked = false;
      }

      // Disabilita il movimento
      move.forward = move.back = move.left = move.right = false;
      
      // Ferma l'audio dei passi
      if (footstepAudio && !footstepAudio.paused) {
        footstepAudio.pause();
        footstepAudio.currentTime = 0;
      }
      
      // Metti in pausa l'audio di sottofondo
      if (bgAudio && !bgAudio.paused) {
        bgAudio.pause();
      }
      
      // Cambia stato
      gameState = 'paused';
      pauseScreen.classList.remove('hidden');
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
      // Tasto A durante intro → connetti Arduino
      if (e.code === 'KeyA' && gameState === 'intro') {
        connectArduino();
        return;
      }

      // Blocca gli input del gioco se in pausa
      if (gameState !== 'playing') {
        // Previeni anche la gestione dei tasti di movimento
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
          e.preventDefault();
        }
        return;
      }
      
      switch (e.code) {
        case 'ArrowUp':    case 'KeyW': if (autoplayActive) stopAutoplay(); move.forward = true;  break;
        case 'ArrowDown':  case 'KeyS': if (autoplayActive) stopAutoplay(); move.back    = true;  break;
        case 'ArrowLeft':  case 'KeyA': if (autoplayActive) stopAutoplay(); move.left    = true;  break;
        case 'ArrowRight': case 'KeyD': if (autoplayActive) stopAutoplay(); move.right   = true;  break;
        case 'KeyF':
          if (!dropping) { if (autoplayActive) stopAutoplay(); else startAutoplay(); }
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      // Ignora gli input in pausa
      if (gameState !== 'playing') return;
      
      switch (e.code) {
        case 'ArrowUp':    case 'KeyW': move.forward = false; break;
        case 'ArrowDown':  case 'KeyS': move.back    = false; break;
        case 'ArrowLeft':  case 'KeyA': move.left    = false; break;
        case 'ArrowRight': case 'KeyD': move.right   = false; break;
      }
    });

    document.addEventListener('mousemove', (e) => {
      // Ignora i movimenti del mouse in pausa
      if (gameState === 'intro') {
        introMouseNX = (e.clientX / window.innerWidth)  * 2 - 1;
        introMouseNY = (e.clientY / window.innerHeight) * 2 - 1;
        return;
      }

      if (!controls.isLocked || gameState !== 'playing') return;

      const moved = Math.abs(e.movementX) + Math.abs(e.movementY);
      if (moved < 6) return;
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
  // DEV_SPEED_MULT accelera l'adattamento (20s → 2s a 10×)
  let factor = Math.min(1, elapsed * DEV_SPEED_MULT / 20);
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
  const cy = ph / 2;
  const offset = 0.02;
  const tex = createEngravedTexture(item.en_name, item.ar_name, item.age);

  // Geometry condivisa tra le 4 facce — disposta una sola volta in disposeEngravingPlanes
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
      roughness: 0.95, metalness: 0.0, color: COLOR_PILLAR_INSTANCED,
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

function disposeEngravingPlanes(item) {
  if (item.planes.length === 0) return;

  // Geometry e texture sono condivise tra le 4 planes: dispose UNA sola volta
  const sharedGeo = item.planes[0].geometry;
  const sharedTex = item.planes[0].material.map;

  item.planes.forEach(p => {
    scene.remove(p);
    p.material.dispose();
  });

  sharedGeo.dispose();
  if (sharedTex) sharedTex.dispose();

  item.planes = [];
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

  }

  if (gameState === 'playing') {
    updateAutoplay(delta);
  }

  if (gameState === 'intro') {
    const targetYaw   = -introMouseNX * (Math.PI / 8);   // ±22.5°
    const targetPitch = -introMouseNY * (Math.PI / 16);  // ±11.25°
    const t = 1 - Math.exp(-1.5 * delta);
    _pitchEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    _pitchEuler.y = THREE.MathUtils.lerp(_pitchEuler.y, targetYaw, t);
    _pitchEuler.x = THREE.MathUtils.lerp(_pitchEuler.x, targetPitch, t);
    _pitchEuler.z = 0;
    camera.quaternion.setFromEuler(_pitchEuler);
  }

  if (dropping) {
    camera.position.y = Math.max(camera.position.y - 30 * DEV_SPEED_MULT * delta, GROUND_HEIGHT_OFFSET + 0.5);
    if (camera.position.y <= GROUND_HEIGHT_OFFSET + 0.6) dropping = false;
  }

  if (!isMobile && controls.isLocked && !dropping && !autoplayActive) {
    const currentPos = controls.getObject().position.clone();

    velocity.set(
      (move.right - move.left)    * speed * DEV_SPEED_MULT * delta,
      0,
      (move.back  - move.forward) * speed * DEV_SPEED_MULT * delta
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
      const th  = getTerrainHeight(newPos.x, newPos.z);
      const ch  = controls.getObject().position.y;
      const _walking = move.forward || move.back || move.left || move.right;
      if (_walking) { bobTimer += moveVector.length(); bobBlend += (1 - bobBlend) * Math.min(1, 6 * delta); }
      else          { bobBlend += (0 - bobBlend) * Math.min(1, 6 * delta); }
      const bob = Math.sin(bobTimer * BOB_FREQ) * BOB_AMP * bobBlend;
      controls.getObject().position.y = ch + ((th + GROUND_HEIGHT_OFFSET + bob) - ch) * 0.25;
    }

    const px = controls.getObject().position.x;
    const pz = controls.getObject().position.z;
    // Snap in light-space to eliminate shadow shimmer (shadow cam axes are 45° from world XZ)
    // shadow_cam_x = (-0.7071, 0, 0.7071), shadow_cam_y·xz = (0.5299, 0, 0.5299)
    { const _t = 160 / 2048;
      const _u = Math.round(0.7071 * (pz - px) / _t) * _t;
      const _v = Math.round(0.5299 * (px + pz) / _t) * _t;
      const _sx = (1.8870 * _v - 1.4142 * _u) / 2;
      const _sz = (1.8870 * _v + 1.4142 * _u) / 2;
      dirLight.position.set(_sx - 50, 80, _sz - 50);
      dirLight.target.position.set(_sx, 0, _sz);
      dirLight.target.updateMatrixWorld(); }

    const isMoving = move.forward || move.back || move.left || move.right;
    if (isMoving && !blocked) {
      if (footstepAudio && footstepAudio.paused) footstepAudio.play();
    } else {
      if (footstepAudio && !footstepAudio.paused) {
        footstepAudio.pause(); footstepAudio.currentTime = 0;
      }
    }
  }

  if (isGameActive() && autoplayActive) {
    const px = controls.getObject().position.x;
    const pz = controls.getObject().position.z;
    { const _t = 160 / 2048;
      const _u = Math.round(0.7071 * (pz - px) / _t) * _t;
      const _v = Math.round(0.5299 * (px + pz) / _t) * _t;
      const _sx = (1.8870 * _v - 1.4142 * _u) / 2;
      const _sz = (1.8870 * _v + 1.4142 * _u) / 2;
      dirLight.position.set(_sx - 50, 80, _sz - 50);
      dirLight.target.position.set(_sx, 0, _sz);
      dirLight.target.updateMatrixWorld(); }
  }

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
        disposeEngravingPlanes(item);
      }
    });
  }

  renderer.render(scene, camera);
}