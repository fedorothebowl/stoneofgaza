import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// Yaw e pitch della camera vengono sempre letti e scritti passando dal
// quaternion con ordine Euler 'YXZ', lo stesso usato da PointerLockControls.
// Con l'ordine di default di Three.js ('XYZ') ogni scrittura corrompe
// leggermente la rotazione e l'errore si accumula → vista "ubriaca" dopo
// qualche minuto. Per lo stesso motivo la camera ha rotation.order = 'YXZ'.
// ─────────────────────────────────────────────────────────────
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

function readEuler(camera) {
  return _euler.setFromQuaternion(camera.quaternion, 'YXZ');
}

export function getYaw(camera) {
  return readEuler(camera).y;
}

export function getPitch(camera) {
  return readEuler(camera).x;
}

export function setYaw(camera, value) {
  setYawPitch(camera, value, getPitch(camera));
}

export function setPitch(camera, value) {
  setYawPitch(camera, getYaw(camera), value);
}

// Scrive yaw e pitch azzerando sempre il roll
export function setYawPitch(camera, yaw, pitch) {
  _euler.set(pitch, yaw, 0, 'YXZ');
  camera.quaternion.setFromEuler(_euler);
}

export function clearRoll(camera) {
  const { x, y, z } = readEuler(camera);
  if (Math.abs(z) > 0.0001) setYawPitch(camera, y, x);
}

// Wrap un angolo in [-π, π] gestendo correttamente il modulo negativo di JS
export function wrapAngle(d) {
  d = d % (Math.PI * 2);
  if (d >  Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function shortestYaw(from, to) {
  return wrapAngle(to - from);
}

export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
