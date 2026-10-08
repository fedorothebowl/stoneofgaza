import * as THREE from 'three';
import {
  AUTOPLAY_TURN_SECONDS, AUTOPLAY_WALK_SPEED, CAMERA_RADIUS, DEV_SPEED_MULT,
  READING_PAUSE_DOWN_SECS, READING_PAUSE_SECS, READING_PITCH, READING_TILT_SECS,
  READING_TURN_SECS, SPACING
} from './config.js';
import {
  clearRoll, easeInOutQuad, getPitch, getYaw, setPitch, setYaw, shortestYaw, wrapAngle
} from './angles.js';
import {
  DIRECTIONS, dirToYaw, distToNextIntersection, distToNextPillar, nearestCorridorCenter
} from './grid.js';

const _probe = new THREE.Vector3();
const _sunDir = new THREE.Vector3();

// Passeggiata automatica lungo i corridoi. Stati:
//   snapping → si allinea al centro del corridoio (anche in uscita dall'autoplay)
//   walking  → cammina; ogni tanto si ferma a leggere o svolta a un incrocio
//   reading  → si gira verso un pilastro, alza lo sguardo sul nome, torna indietro
//   turning  → ruota verso la nuova direzione di marcia
export class Autoplay {
  active = false;

  #camera; #controls; #colliders; #halfSize; #footsteps; #environment; #bob;

  #state     = 'walking';
  #readPhase = '';
  #timer     = 0;
  #stopping  = false;   // in uscita: snap al corridoio, poi restituisce i controlli

  #dirIdx = 0;
  #snapTarget = 0;

  #yawStart = 0;
  #yawTarget = 0;
  #readYawBack = 0;
  #tiltPitchStart = 0;

  #walkDist = 0;          // distanza dal prossimo incrocio
  #walkedDist = 0;
  #readWalkDist = 0;
  #readWalkTarget = 0;    // distanza dalla prossima sosta di lettura
  #intersCount = 0;
  #intersTarget = 1;      // incroci da attraversare prima di svoltare

  constructor({ camera, controls, colliders, halfSize, footsteps, environment, bob }) {
    this.#camera = camera;
    this.#controls = controls;
    this.#colliders = colliders;
    this.#halfSize = halfSize;
    this.#footsteps = footsteps;
    this.#environment = environment;
    this.#bob = bob;
  }

  get #dir() {
    return DIRECTIONS[this.#dirIdx];
  }

  start() {
    const camera = this.#camera;
    this.active = true;

    this.#controls.disconnect();
    this.#footsteps.play();

    // Azzera il roll residuo
    clearRoll(camera);

    // Parte nella direzione libera più vicina a dove si sta guardando
    const curYaw = getYaw(camera);
    let best = 0, bestDist = Infinity;
    DIRECTIONS.forEach((d, i) => {
      let diff = Math.abs(dirToYaw(d) - curYaw);
      diff = Math.min(diff, Math.PI * 2 - diff);
      const penalty = this.#isDirectionClear(i, CAMERA_RADIUS * 2.5) ? 0 : Math.PI;
      if (diff + penalty < bestDist) { bestDist = diff + penalty; best = i; }
    });

    this.#dirIdx    = best;
    this.#yawStart  = curYaw;
    this.#yawTarget = dirToYaw(this.#dir);

    this.#enter('snapping');
    this.#snapTarget     = nearestCorridorCenter(camera.position, this.#dir, this.#halfSize);
    this.#walkDist       = distToNextIntersection(camera.position, this.#dir, this.#halfSize);
    this.#walkedDist     = 0;
    this.#readWalkDist   = 0;
    this.#readWalkTarget = distToNextPillar(camera.position, this.#dir, this.#halfSize);
    this.#intersCount    = 0;
    this.#intersTarget   = randomIntersections();
  }

  // Avvia l'uscita morbida dall'autoplay. Restituisce false se era già in corso.
  requestStop() {
    if (this.#stopping) return false;
    this.#stopping = true;

    // Durante 'reading', yawTarget punta al pilastro — si torna verso il corridoio
    if (this.#state === 'reading') this.#yawTarget = this.#readYawBack;
    this.#yawStart   = getYaw(this.#camera);
    this.#snapTarget = nearestCorridorCenter(this.#camera.position, this.#dir, this.#halfSize);
    this.#state      = 'snapping';

    this.#footsteps.pause();
    return true;
  }

  // Esce subito, senza animazione di snap (es. quando si entra in pausa)
  abort() {
    this.#stopping = false;
    this.active = false;
    this.#controls.connect();
  }

  update(delta) {
    if (!this.active) return;
    const camera = this.#camera;

    // Azzera il roll ogni frame (non deve mai accumularsi)
    clearRoll(camera);

    if (this.#state !== 'reading') {
      const pitch = getPitch(camera);
      if (Math.abs(pitch) > 0.001) {
        const t = 1.0 - Math.exp(-(this.#stopping ? 1.5 : 3.5) * DEV_SPEED_MULT * delta);
        setPitch(camera, THREE.MathUtils.lerp(pitch, 0, t));
      } else {
        setPitch(camera, 0);
      }
    }

    this.#timer += delta;

    // Bob fade-out quando autoplay non cammina
    if (this.#state !== 'walking') this.#bob.rest(delta);

    switch (this.#state) {
      case 'snapping': this.#updateSnapping(delta); break;
      case 'walking':  this.#updateWalking(delta);  break;
      case 'reading':  this.#updateReading();       break;
      case 'turning':  this.#updateTurning();       break;
    }
  }

  #enter(state) {
    this.#state = state;
    this.#timer = 0;
  }

  // Avanzamento 0…1 della fase corrente. DEV_SPEED_MULT accelera tutte le fasi
  // temporizzate: le costanti di durata restano intatte.
  #progress(duration) {
    return Math.min(1, this.#timer * DEV_SPEED_MULT / duration);
  }

  // Ruota con ease da yawStart a yawTarget; true quando la rotazione è completa
  #animateYaw(duration) {
    const t = this.#progress(duration);
    const diff = wrapAngle(this.#yawTarget - this.#yawStart);
    setYaw(this.#camera, this.#yawStart + diff * (t >= 1 ? 1 : easeInOutQuad(t)));
    return t >= 1;
  }

  // Avvicina lo yaw al target; rate = velocità di inseguimento
  #chaseYaw(rate, delta) {
    const diff = shortestYaw(getYaw(this.#camera), this.#yawTarget);
    if (Math.abs(diff) < 0.001) {
      setYaw(this.#camera, this.#yawTarget);
    } else {
      setYaw(this.#camera, getYaw(this.#camera) + diff * Math.min(1, rate * DEV_SPEED_MULT * delta));
    }
  }

  #turnToward(dirIdx) {
    this.#yawStart  = getYaw(this.#camera);
    this.#yawTarget = this.#yawStart + shortestYaw(this.#yawStart, dirToYaw(DIRECTIONS[dirIdx]));
  }

  #isDirectionClear(dirIdx, checkDist) {
    _probe.copy(this.#camera.position).addScaledVector(DIRECTIONS[dirIdx], checkDist);
    return !this.#colliders.blocks(_probe, CAMERA_RADIUS * 1.2);
  }

  // Sceglie la nuova direzione: prima una svolta a caso, poi dritto, infine indietro
  #pickDirection(checkDist) {
    const right = (this.#dirIdx + 1) % 4;
    const left  = (this.#dirIdx + 3) % 4;
    const back  = (this.#dirIdx + 2) % 4;

    const turns = Math.random() < 0.5 ? [right, left] : [left, right];
    const candidates = [...turns, this.#dirIdx, back];

    this.#dirIdx = candidates.find(c => this.#isDirectionClear(c, checkDist)) ?? this.#dirIdx;
    this.#turnToward(this.#dirIdx);
  }

  #startTurning(checkDist) {
    this.#pickDirection(checkDist);
    this.#enter('turning');
    this.#walkedDist = 0;
    this.#footsteps.pause();
  }

  #updateSnapping(delta) {
    const camera = this.#camera;
    const axis = this.#dir.z !== 0 ? 'x' : 'z';
    const snapSpeed = (this.#stopping ? 2.5 : 18.0) * DEV_SPEED_MULT;
    const diff = this.#snapTarget - camera.position[axis];

    if (Math.abs(diff) < 0.02) {
      camera.position[axis] = this.#snapTarget;
      if (!this.#stopping) {
        this.#state = 'walking';
      } else {
        const yawLeft = wrapAngle(this.#yawTarget - getYaw(camera));
        if (Math.abs(yawLeft) < 0.01 && Math.abs(getPitch(camera)) < 0.01) this.abort();
      }
    } else {
      camera.position[axis] += Math.sign(diff) * Math.min(Math.abs(diff), snapSpeed * delta);
    }

    // Corregge lo yaw durante lo snap — sempre lungo il percorso più breve
    this.#chaseYaw(this.#stopping ? 2.0 : 8.0, delta);
  }

  #updateWalking(delta) {
    const camera = this.#camera;
    const step = AUTOPLAY_WALK_SPEED * DEV_SPEED_MULT * delta;

    _probe.copy(camera.position).addScaledVector(this.#dir, step);
    if (this.#colliders.blocks(_probe)) {
      this.#startTurning(CAMERA_RADIUS * 2.5);
      return;
    }

    camera.position.copy(_probe);
    this.#bob.walk(step, delta);
    this.#bob.applyTo(camera);
    this.#chaseYaw(8, delta);

    this.#walkedDist   += step;
    this.#readWalkDist += step;
    this.#footsteps.play();

    if (this.#readWalkDist >= this.#readWalkTarget) {
      this.#startReading();
    } else if (this.#walkedDist >= this.#walkDist) {
      this.#reachIntersection();
    }
  }

  #reachIntersection() {
    this.#intersCount++;
    this.#walkedDist = 0;

    if (this.#intersCount >= this.#intersTarget) {
      this.#startTurning(SPACING * 0.8);
      this.#intersCount  = 0;
      this.#intersTarget = randomIntersections();
    } else {
      this.#walkDist = distToNextIntersection(this.#camera.position, this.#dir, this.#halfSize);
    }
  }

  #startReading() {
    this.#readWalkDist = 0;
    // Target = prossima riga di pilastri + N spacing extra:
    // così il termine del cammino cade naturalmente su una riga
    // (modulo l'overshoot di un singolo frame, < pochi cm), senza
    // bisogno di uno snap discreto che produce uno scatto visibile.
    this.#readWalkTarget = distToNextPillar(this.#camera.position, this.#dir, this.#halfSize)
      + (2 + Math.floor(Math.random() * 3)) * SPACING;

    // Sceglie il lato con la facciata illuminata dal sole:
    // la faccia che guarda il giocatore ha normale = -DIRECTIONS[sideDirIdx]
    const right = (this.#dirIdx + 1) % 4;
    const left  = (this.#dirIdx + 3) % 4;
    const rightIsLit = -DIRECTIONS[right].dot(this.#environment.getSunDirection(_sunDir)) >= 0;

    this.#readYawBack = dirToYaw(this.#dir);
    this.#turnToward(rightIsLit ? right : left);

    this.#enter('reading');
    this.#readPhase = 'turn_to';
    this.#footsteps.pause();
  }

  #enterReadPhase(phase) {
    this.#readPhase = phase;
    this.#timer = 0;
  }

  #updateReading() {
    const camera = this.#camera;

    switch (this.#readPhase) {
      case 'turn_to':
        if (this.#animateYaw(READING_TURN_SECS)) {
          this.#tiltPitchStart = getPitch(camera);
          this.#enterReadPhase('tilt_up');
        }
        break;

      case 'tilt_up': {
        const t = this.#progress(READING_TILT_SECS);
        setPitch(camera, this.#tiltPitchStart + (READING_PITCH - this.#tiltPitchStart) * easeInOutQuad(t));
        if (t >= 1) { setPitch(camera, READING_PITCH); this.#enterReadPhase('pause'); }
        break;
      }

      case 'pause':
        if (this.#progress(READING_PAUSE_SECS) >= 1) {
          this.#tiltPitchStart = getPitch(camera);
          this.#enterReadPhase('tilt_down');
        }
        break;

      case 'tilt_down': {
        const t = this.#progress(READING_TILT_SECS);
        setPitch(camera, this.#tiltPitchStart * (1 - easeInOutQuad(t)));
        if (t >= 1) { setPitch(camera, 0); this.#enterReadPhase('pause_down'); }
        break;
      }

      case 'pause_down':
        if (this.#timer * DEV_SPEED_MULT >= READING_PAUSE_DOWN_SECS) {
          this.#yawStart  = getYaw(camera);
          this.#yawTarget = this.#yawStart + shortestYaw(this.#yawStart, this.#readYawBack);
          this.#enterReadPhase('turn_back');
        }
        break;

      case 'turn_back':
        if (this.#animateYaw(READING_TURN_SECS)) {
          this.#yawTarget = this.#readYawBack;
          this.#walkDist  = distToNextIntersection(camera.position, this.#dir, this.#halfSize);
          this.#enter('walking');
        }
        break;
    }
  }

  #updateTurning() {
    if (!this.#animateYaw(AUTOPLAY_TURN_SECONDS)) return;

    this.#snapTarget = nearestCorridorCenter(this.#camera.position, this.#dir, this.#halfSize);
    this.#walkDist   = distToNextIntersection(this.#camera.position, this.#dir, this.#halfSize);
    this.#walkedDist = 0;
    this.#enter('snapping');
  }
}

function randomIntersections() {
  return 5 + Math.floor(Math.random() * 6);
}
