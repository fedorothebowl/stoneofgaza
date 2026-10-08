import { BG_VOLUME, FOOTSTEP_VOLUME } from './config.js';

const FIRST_GESTURE_EVENTS = ['click', 'touchstart', 'keydown'];

// Musica di sottofondo: l'elemento <audio> parte muto in autoplay
export class BackgroundAudio {
  #el;

  constructor(el, signal) {
    this.#el = el;

    // Smuta al primo gesto dell'utente (policy autoplay browser)
    const unmuteOnce = () => {
      this.unmute();
      FIRST_GESTURE_EVENTS.forEach(type => document.removeEventListener(type, unmuteOnce));
    };
    FIRST_GESTURE_EVENTS.forEach(type => document.addEventListener(type, unmuteOnce, { signal }));
  }

  unmute() {
    if (!this.#el) return;
    this.#el.volume = BG_VOLUME;
    this.#el.muted = false;
    this.resume();
  }

  resume() {
    this.#el?.play().catch(() => {});
  }

  pause() {
    if (this.#el && !this.#el.paused) this.#el.pause();
  }
}

// Passi in loop: l'audio viene creato solo all'ingresso nel memoriale
export class Footsteps {
  #audio;

  init() {
    this.#audio = new Audio('walks.mp3');
    this.#audio.loop = true;
    this.#audio.volume = FOOTSTEP_VOLUME;
  }

  play() {
    if (this.#audio?.paused) this.#audio.play().catch(() => {});
  }

  pause() {
    if (this.#audio && !this.#audio.paused) this.#audio.pause();
  }

  stop() {
    if (!this.#audio || this.#audio.paused) return;
    this.#audio.pause();
    this.#audio.currentTime = 0;
  }
}
