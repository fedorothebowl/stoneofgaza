import * as THREE from 'three';
import { CAMERA_RADIUS, SPACING } from './config.js';

// I pilastri occupano i nodi di una griglia quadrata centrata sull'origine;
// i corridoi passano a metà tra due file di pilastri.

// Le quattro direzioni di marcia lungo i corridoi, in senso orario
export const DIRECTIONS = [
  new THREE.Vector3( 0, 0, -1),
  new THREE.Vector3( 1, 0,  0),
  new THREE.Vector3( 0, 0,  1),
  new THREE.Vector3(-1, 0,  0),
];

export function dirToYaw(dir) {
  return Math.atan2(-dir.x, -dir.z);
}

export function gridSizeFor(count) {
  return Math.ceil(Math.sqrt(count));
}

export function gridHalfSizeFor(count) {
  return (gridSizeFor(count) - 1) * SPACING / 2;
}

export function snapToGrid(v) {
  return Math.round(v / SPACING) * SPACING;
}

// Coordinata (sull'asse perpendicolare a dir) del centro del corridoio più vicino
export function nearestCorridorCenter(pos, dir, halfSize) {
  const v = dir.z !== 0 ? pos.x : pos.z;
  const cell = Math.round((v + halfSize) / SPACING - 0.5);
  return (cell + 0.5) * SPACING - halfSize;
}

// Posizione lungo dir dentro la cella corrente: 0 = fila di pilastri, 0.5 = incrocio
function cellPhase(pos, dir, halfSize) {
  const v = (dir.x !== 0 ? pos.x : pos.z) + halfSize;
  return ((v / SPACING) % 1 + 1) % 1;
}

function isPositive(dir) {
  return (dir.x !== 0 ? dir.x : dir.z) > 0;
}

export function distToNextIntersection(pos, dir, halfSize) {
  const phase = cellPhase(pos, dir, halfSize);

  let dist;
  if (isPositive(dir)) {
    dist = phase < 0.5 ? (0.5 - phase) * SPACING : (1.5 - phase) * SPACING;
  } else {
    dist = phase > 0.5 ? (phase - 0.5) * SPACING : (phase + 0.5) * SPACING;
  }

  if (dist < CAMERA_RADIUS) dist += SPACING;
  return dist;
}

export function distToNextPillar(pos, dir, halfSize) {
  const phase = cellPhase(pos, dir, halfSize);

  let dist = isPositive(dir) ? (1.0 - phase) * SPACING : phase * SPACING;
  if (dist < CAMERA_RADIUS) dist += SPACING;
  return dist;
}
