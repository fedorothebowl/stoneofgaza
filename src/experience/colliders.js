import * as THREE from 'three';
import { CAMERA_RADIUS } from './config.js';

export class Colliders {
  #boxes = [];
  #sphere = new THREE.Sphere();

  add(box) {
    this.#boxes.push(box);
  }

  // true se una sfera centrata in `center` tocca almeno un collider
  blocks(center, radius = CAMERA_RADIUS) {
    this.#sphere.set(center, radius);
    for (const box of this.#boxes) {
      if (box.intersectsSphere(this.#sphere)) return true;
    }
    return false;
  }
}
