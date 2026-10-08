import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import {
  AUTOPLAY_IDLE_SECS, COLOR_CLEAR, DEV_SPEED_MULT, DROP_SPEED, GROUND_HEIGHT_OFFSET, SPACING, START_HEIGHT, WALK_SPEED
} from './config.js';
import { getPitch, getYaw, setYawPitch } from './angles.js';
import { BackgroundAudio, Footsteps } from './audio.js';
import { Autoplay } from './autoplay.js';
import { Colliders } from './colliders.js';
import { fetchPeople, fetchSummary } from './data.js';
import { isMobile } from './device.js';
import { updateEngravings } from './engravings.js';
import { Environment } from './environment.js';
import { gridSizeFor } from './grid.js';
import { HeadBob } from './headBob.js';
import { buildPillars } from './pillars.js';

const MOVE_KEYS = {
  ArrowUp: 'forward', KeyW: 'forward',
  ArrowDown: 'back',  KeyS: 'back',
  ArrowLeft: 'left',  KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

const _forward = new THREE.Vector3();
const _right   = new THREE.Vector3();
const _newPos  = new THREE.Vector3();
const _sunDir  = new THREE.Vector3();

// Il memoriale 3D: carica i dati, costruisce la scena e gestisce input e game loop.
// Comunica con l'interfaccia solo attraverso l'oggetto `ui`.
export class Experience {
  #container; #ui;
  #scene; #camera; #renderer; #controls;
  #environment; #autoplay; #items = [];

  #colliders = new Colliders();
  #bob       = new HeadBob();
  #footsteps = new Footsteps();
  #bgAudio;

  #clock = new THREE.Clock();
  #listeners = new AbortController();
  #frame = 0;
  #destroyed = false;

  #state = 'loading';    // loading → intro → playing ⇄ paused
  #dropping = false;     // caduta iniziale dall'alto
  #idleTime = 0;         // secondi senza input, per l'avvio automatico dell'autoplay
  #startTime = null;
  #move = { forward: false, back: false, left: false, right: false };
  #introMouse = { x: 0, y: 0 };   // posizione normalizzata del mouse (-1 … 1) per il parallax

  constructor({ container, bgAudio, ui }) {
    this.#container = container;
    this.#ui = ui;
    this.#bgAudio = new BackgroundAudio(bgAudio, this.#listeners.signal);
  }

  async load() {
    const { totalCount, snapshotDate } = await fetchSummary();
    if (this.#destroyed) return;
    this.#ui.totalCount = totalCount;
    this.#ui.snapshotDate = snapshotDate;
    this.#setupScene(totalCount);

    const people = await fetchPeople(totalCount);
    if (this.#destroyed) return;
    const { items, halfSize } = buildPillars(this.#scene, people, this.#colliders);
    this.#items = items;

    this.#controls = new PointerLockControls(this.#camera, this.#renderer.domElement);
    this.#scene.add(this.#camera);

    this.#autoplay = new Autoplay({
      camera: this.#camera,
      controls: this.#controls,
      colliders: this.#colliders,
      halfSize,
      footsteps: this.#footsteps,
      environment: this.#environment,
      bob: this.#bob,
    });

    if (!isMobile) this.#bindDesktopInput();
    window.addEventListener('resize', this.#onResize, { signal: this.#listeners.signal });

    this.#state = 'intro';
    this.#animate();
  }

  // Click su "Enter"
  start() {
    if (this.#state !== 'intro') return;

    if (!isMobile) {
      this.#footsteps.init();
      this.#controls.lock();   // il resto avviene nell'evento 'lock'
      return;
    }

    this.#beginDescent();
    this.#state = 'playing';
    this.#bgAudio.unmute();
    this.#footsteps.init();
    setTimeout(() => { if (!this.#destroyed) this.#autoplay.start(); }, 300);
  }

  // Click su "Resume"
  resume() {
    if (this.#state !== 'paused') return;

    if (!isMobile) {
      this.#controls.lock();
      return;
    }

    this.#ui.pause = false;
    this.#state = 'playing';
    this.#bgAudio.resume();
    if (!this.#autoplay.active) this.#autoplay.start();
  }

  destroy() {
    this.#destroyed = true;
    this.#listeners.abort();
    cancelAnimationFrame(this.#frame);
    this.#footsteps.pause();
    this.#controls?.dispose();
    this.#renderer?.dispose();
    this.#renderer?.domElement.remove();
  }

  // ── Setup ───────────────────────────────────────────────────

  #setupScene(totalCount) {
    this.#scene = new THREE.Scene();
    this.#environment = new Environment(this.#scene, totalCount);

    // I pilastri sono allineati a (col - (N-1)/2) * SPACING. Con N pari, SPACING/2
    // cade esattamente su una colonna di pilastri → la camera atterrerebbe dentro
    // un pilastro. Con N dispari, SPACING/2 è il centro del corridoio.
    const start = gridSizeFor(totalCount) % 2 === 0 ? 0 : SPACING / 2;
    this.#camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
    this.#camera.position.set(start, START_HEIGHT, start);
    this.#camera.rotation.order = 'YXZ';   // vedi angles.js

    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setSize(window.innerWidth, window.innerHeight);
    this.#renderer.setClearColor(COLOR_CLEAR);
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.#container.appendChild(this.#renderer.domElement);
  }

  #bindDesktopInput() {
    const signal = this.#listeners.signal;

    this.#controls.addEventListener('lock', this.#onLock);
    document.addEventListener('pointerlockchange', this.#onPointerLockChange, { signal });
    window.addEventListener('keydown', this.#onKeyDown, { signal });
    window.addEventListener('keyup', this.#onKeyUp, { signal });
    document.addEventListener('mousemove', this.#onMouseMove, { signal });
  }

  // ── Input desktop ───────────────────────────────────────────

  #onLock = () => {
    if (this.#state === 'intro') this.#beginDescent();
    this.#idleTime = 0;
    this.#ui.pause = false;
    this.#state = 'playing';
    this.#bgAudio.unmute();
  };

  // ESC rilascia il pointer lock → pausa
  #onPointerLockChange = () => {
    if (document.pointerLockElement) return;   // lock acquisito, non rilasciato
    if (this.#state !== 'playing') return;

    if (this.#autoplay.active) {
      // Esce subito dall'autoplay senza aspettare l'animazione di snap, che in
      // pausa non verrebbe mai completata. Durante l'autoplay i controlli sono
      // scollegati, quindi isLocked va aggiornato a mano.
      this.#autoplay.abort();
      this.#controls.isLocked = false;
    }

    this.#releaseMoveKeys();
    this.#footsteps.stop();
    this.#bgAudio.pause();

    this.#state = 'paused';
    this.#ui.pause = true;
  };

  #onKeyDown = (e) => {
    const direction = MOVE_KEYS[e.code];

    if (this.#state !== 'playing') {
      if (direction) e.preventDefault();
      return;
    }

    if (direction) {
      this.#stopAutoplay();
      this.#move[direction] = true;
    }
  };

  #onKeyUp = (e) => {
    if (this.#state !== 'playing') return;
    const direction = MOVE_KEYS[e.code];
    if (direction) this.#move[direction] = false;
  };

  #onMouseMove = (e) => {
    if (this.#state === 'intro') {
      this.#introMouse.x = (e.clientX / window.innerWidth)  * 2 - 1;
      this.#introMouse.y = (e.clientY / window.innerHeight) * 2 - 1;
      return;
    }

    if (!this.#controls.isLocked || this.#state !== 'playing') return;

    // Un movimento deciso del mouse interrompe l'autoplay e azzera l'attesa
    if (Math.abs(e.movementX) + Math.abs(e.movementY) >= 6) this.#stopAutoplay();
  };

  #onResize = () => {
    this.#camera.aspect = window.innerWidth / window.innerHeight;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(window.innerWidth, window.innerHeight);
  };

  // ── Stato ───────────────────────────────────────────────────

  #beginDescent() {
    this.#ui.instructions = false;
    this.#startTime = performance.now() / 1000;
    this.#dropping = true;
  }

  #stopAutoplay() {
    this.#idleTime = 0;
    if (this.#autoplay.active && this.#autoplay.requestStop()) this.#releaseMoveKeys();
  }

  #releaseMoveKeys() {
    const move = this.#move;
    move.forward = move.back = move.left = move.right = false;
  }

  get #active() {
    return isMobile ? this.#state === 'playing' : this.#controls.isLocked;
  }

  // ── Game loop ───────────────────────────────────────────────

  #animate = () => {
    this.#frame = requestAnimationFrame(this.#animate);
    const delta = Math.min(this.#clock.getDelta(), 0.033);
    const camera = this.#camera;
    const autoplay = this.#autoplay;

    if (this.#state === 'playing') {
      if (this.#startTime) this.#environment.adapt(performance.now() / 1000 - this.#startTime);
      autoplay.update(delta);
    }

    if (this.#state === 'intro') this.#updateIntroParallax(delta);

    if (this.#dropping) {
      const landing = GROUND_HEIGHT_OFFSET + 0.5;
      camera.position.y = Math.max(camera.position.y - DROP_SPEED * DEV_SPEED_MULT * delta, landing);
      if (camera.position.y <= landing + 0.1) this.#dropping = false;
    }

    if (!isMobile && this.#controls.isLocked && !this.#dropping && !autoplay.active) {
      this.#updateManualWalk(delta);
      this.#updateIdle(delta);
      this.#environment.follow(camera.position.x, camera.position.z);
    }

    if (this.#active && autoplay.active) {
      this.#environment.follow(camera.position.x, camera.position.z);
    }

    if (this.#active && !this.#dropping) {
      updateEngravings(this.#scene, this.#items, camera.position, this.#environment.getSunDirection(_sunDir));
    }

    this.#renderer.render(this.#scene, camera);
  };

  // Dopo AUTOPLAY_IDLE_SECS senza input (tasti di movimento o mouse) parte l'autoplay
  #updateIdle(delta) {
    const move = this.#move;
    if (move.forward || move.back || move.left || move.right) {
      this.#idleTime = 0;
      return;
    }

    this.#idleTime += delta * DEV_SPEED_MULT;
    if (this.#idleTime >= AUTOPLAY_IDLE_SECS) {
      this.#idleTime = 0;
      this.#autoplay.start();
    }
  }

  // Nell'intro la camera segue leggermente il mouse
  #updateIntroParallax(delta) {
    const camera = this.#camera;
    const targetYaw   = -this.#introMouse.x * (Math.PI / 8);    // ±22.5°
    const targetPitch = -this.#introMouse.y * (Math.PI / 16);   // ±11.25°
    const t = 1 - Math.exp(-1.5 * delta);
    setYawPitch(
      camera,
      THREE.MathUtils.lerp(getYaw(camera), targetYaw, t),
      THREE.MathUtils.lerp(getPitch(camera), targetPitch, t)
    );
  }

  #updateManualWalk(delta) {
    const camera = this.#camera;
    const move = this.#move;
    const distance = WALK_SPEED * DEV_SPEED_MULT * delta;
    const isMoving = move.forward || move.back || move.left || move.right;

    camera.getWorldDirection(_forward).setY(0).normalize();
    _right.crossVectors(_forward, camera.up).normalize();
    const step = _forward.multiplyScalar((move.forward - move.back) * distance)
      .add(_right.multiplyScalar((move.right - move.left) * distance));

    _newPos.copy(camera.position).add(step);
    const blocked = this.#colliders.blocks(_newPos);

    if (!blocked) {
      camera.position.copy(_newPos);
      if (isMoving) this.#bob.walk(step.length(), delta);
      else this.#bob.rest(delta);
      this.#bob.applyTo(camera);
    }

    if (isMoving && !blocked) this.#footsteps.play();
    else this.#footsteps.pause();
  }
}
