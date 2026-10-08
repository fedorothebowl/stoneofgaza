import { BOB_AMP, BOB_FREQ, GROUND_HEIGHT_OFFSET } from './config.js';

export function getTerrainHeight(_x, _z) {
  return 0;
}

// Oscillazione verticale della camera durante la camminata,
// condivisa tra movimento manuale e autoplay.
export class HeadBob {
  #timer = 0;
  #blend = 0;   // 0 = fermo, 1 = in cammino (fade in/out)

  walk(distance, delta) {
    this.#timer += distance;
    this.#blend += (1 - this.#blend) * Math.min(1, 6 * delta);
  }

  rest(delta) {
    this.#blend += (0 - this.#blend) * Math.min(1, 6 * delta);
  }

  // Avvicina la camera all'altezza degli occhi sopra il terreno, bob incluso
  applyTo(camera) {
    const { x, y, z } = camera.position;
    const bob = Math.sin(this.#timer * BOB_FREQ) * BOB_AMP * this.#blend;
    camera.position.y = y + ((getTerrainHeight(x, z) + GROUND_HEIGHT_OFFSET + bob) - y) * 0.25;
  }
}
