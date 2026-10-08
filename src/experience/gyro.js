import * as THREE from 'three';
import { GYRO_MAX_PITCH, GYRO_SMOOTHING } from './config.js';
import { getPitch, getYaw, setYawPitch, shortestYaw } from './angles.js';

const DEG = Math.PI / 180;

const _euler  = new THREE.Euler();
const _quat   = new THREE.Quaternion();
const _screen = new THREE.Quaternion();
const _zAxis  = new THREE.Vector3(0, 0, 1);
// La camera guarda dal retro del telefono, non dal bordo superiore
const _backOfDevice = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

function screenAngle() {
  return (screen.orientation?.angle ?? window.orientation ?? 0) * DEG;
}

// Sguardo guidato dal giroscopio: su mobile fa quello che il mouse fa su desktop.
// Lo yaw è relativo (ancorato a dove guarda la camera quando si prende il
// controllo), il pitch è assoluto: telefono verticale = orizzonte.
export class Gyro {
  #ready = false;       // è arrivata almeno una lettura
  #yaw = 0;
  #pitch = 0;
  #yawOffset = 0;

  get ready() {
    return this.#ready;
  }

  // Va chiamata dentro un gesto dell'utente: iOS chiede il permesso solo così.
  // Restituisce false se il sensore manca o il permesso è negato.
  async enable(signal) {
    const Orientation = window.DeviceOrientationEvent;
    if (!Orientation) return false;

    if (typeof Orientation.requestPermission === 'function') {
      try {
        if (await Orientation.requestPermission() !== 'granted') return false;
      } catch {
        return false;
      }
    }

    window.addEventListener('deviceorientation', this.#onOrientation, { signal });
    return true;
  }

  #onOrientation = (e) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;

    _euler.set(e.beta * DEG, e.alpha * DEG, -e.gamma * DEG, 'YXZ');
    _quat.setFromEuler(_euler)
      .multiply(_backOfDevice)
      .multiply(_screen.setFromAxisAngle(_zAxis, -screenAngle()));

    _euler.setFromQuaternion(_quat, 'YXZ');
    this.#yaw   = _euler.y;
    this.#pitch = THREE.MathUtils.clamp(_euler.x, -GYRO_MAX_PITCH, GYRO_MAX_PITCH);
    this.#ready = true;
  };


  // Aggancia lo yaw del sensore a quello attuale della camera: nessuno scatto
  // quando il giroscopio riprende il controllo dopo l'autoplay.
  anchor(camera) {
    this.#yawOffset = getYaw(camera) - this.#yaw;
  }

  applyTo(camera, delta) {
    const t = 1 - Math.exp(-GYRO_SMOOTHING * delta);
    const yaw   = getYaw(camera);
    const pitch = getPitch(camera);
    setYawPitch(
      camera,
      yaw + shortestYaw(yaw, this.#yaw + this.#yawOffset) * t,
      pitch + (this.#pitch - pitch) * t
    );
  }
}
