// ── Mic trigger autoplay ────────────────────────────────────────────────
// Attiva l'autoplay quando c'è silenzio nel microfono, lo ferma quando
// rileva rumore. Calibra un baseline all'avvio (2s) per tener conto della
// musica di sottofondo che rientra dal microfono.

const COOKIE_ENABLED = 'micTriggerEnabled';
const COOKIE_TH_NOISE = 'micThNoise';
const COOKIE_TH_SILENCE = 'micThSilence';

function readCookie(key) {
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + key + '=([^;]+)'));
  return m ? m[1] : null;
}
function writeCookie(key, value) {
  document.cookie = `${key}=${value};path=/;max-age=31536000;SameSite=Lax`;
}

export function getMicEnabled() {
  const v = readCookie(COOKIE_ENABLED);
  if (v === null) return false;
  return v === '1';
}

export function setMicEnabledCookie(enabled) {
  writeCookie(COOKIE_ENABLED, enabled ? '1' : '0');
}

// ── Stato runtime esposto alla UI ────────────────────────────────────
const state = {
  running: false,
  calibrated: false,
  level: 0,
  baseline: 0,
  thNoise: 0.04,
  thSilence: 0.03,
  thNoiseOverride: null,
  thSilenceOverride: null,
};

// Carica eventuali override da cookie
{
  const n = parseFloat(readCookie(COOKIE_TH_NOISE));
  const s = parseFloat(readCookie(COOKIE_TH_SILENCE));
  if (Number.isFinite(n)) { state.thNoiseOverride = n; state.thNoise = n; }
  if (Number.isFinite(s)) { state.thSilenceOverride = s; state.thSilence = s; }
}

export function getMicState() {
  return { ...state };
}

export function setThresholds({ thNoise, thSilence } = {}) {
  if (Number.isFinite(thNoise)) {
    state.thNoise = thNoise;
    state.thNoiseOverride = thNoise;
    writeCookie(COOKIE_TH_NOISE, String(thNoise));
  }
  if (Number.isFinite(thSilence)) {
    state.thSilence = thSilence;
    state.thSilenceOverride = thSilence;
    writeCookie(COOKIE_TH_SILENCE, String(thSilence));
  }
}

export function resetThresholds() {
  state.thNoiseOverride = null;
  state.thSilenceOverride = null;
  document.cookie = `${COOKIE_TH_NOISE}=;path=/;max-age=0`;
  document.cookie = `${COOKIE_TH_SILENCE}=;path=/;max-age=0`;
  if (state.calibrated) {
    // thNoise/thSilence sono il livello "drone" + un delta fisso di rumore extra:
    // così la sensibilità non scala col volume del drone.
    state.thNoise = state.baseline + 0.025;
    state.thSilence = state.baseline + 0.005;
  }
}

let _stopRequested = false;
let _stream = null;
let _ctx = null;

let _calibRequest = null; // { startAt, max, sum, n, done }
let _noiseSince = 0;
let _silenceSince = 0;
let _resetCounters = false;

export function calibrate(durationMs = 2000) {
  if (!state.running) return Promise.reject(new Error('mic non attivo'));
  const PRE_DELAY_MS = 400; // salta il click del mouse sul bottone Calibra
  return new Promise((resolve) => {
    // startAt viene fissato dal primo tick che vede la richiesta:
    // se startMicTrigger è ancora dentro getUserMedia (permesso del
    // browser pendente), state.running è già true ma tick non gira
    // ancora — un timestamp assoluto qui scadrebbe prima del primo frame.
    _calibRequest = {
      startAt: null,
      preDelay: PRE_DELAY_MS,
      duration: durationMs,
      max: 0,
      sum: 0,
      n: 0,
      resolve,
    };
  });
}

export async function startMicTrigger(hooks, { force = false } = {}) {
  if (state.running) return;
  if (!force && !getMicEnabled()) return;
  state.running = true;
  _stopRequested = false;

  console.log('[mic] startMicTrigger. secureContext=', window.isSecureContext, 'origin=', location.origin);

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn('[mic] getUserMedia non disponibile. Serve https:// o http://localhost');
    state.running = false;
    return;
  }

  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
    });
    console.log('[mic] stream ottenuto');
  } catch (e) {
    console.warn('[mic] Microfono non disponibile:', e && e.name, e && e.message);
    state.running = false;
    return;
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  _ctx = new AudioCtx();
  try { await _ctx.resume(); } catch (_) {}
  console.log('[mic] AudioContext state:', _ctx.state);
  const src = _ctx.createMediaStreamSource(_stream);
  const analyser = _ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.2;
  src.connect(analyser);

  const buf = new Float32Array(analyser.fftSize);

  _noiseSince = 0;
  _silenceSince = 0;
  const NOISE_HOLD_MS = 0;
  const SILENCE_HOLD_MS = 1500;

  function rms() {
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  function cleanup() {
    if (_stream) {
      _stream.getTracks().forEach(t => t.stop());
      _stream = null;
    }
    if (_ctx) {
      try { _ctx.close(); } catch (_) {}
      _ctx = null;
    }
    state.running = false;
    state.level = 0;
    if (_calibRequest) { _calibRequest.resolve(null); _calibRequest = null; }
  }

  function tick() {
    if (_stopRequested) { cleanup(); return; }

    const lvl = rms();
    state.level = lvl;
    const now = performance.now();

    // Calibrazione su richiesta (non più automatica all'avvio)
    if (_calibRequest) {
      // Fissa startAt al primo frame in cui il tick vede la richiesta,
      // così il pre-delay è relativo al primo sample reale (non al click).
      if (_calibRequest.startAt === null) {
        _calibRequest.startAt = now + _calibRequest.preDelay;
      }
      // Ignora i campioni prima dello startAt (pre-delay per saltare il click)
      if (now < _calibRequest.startAt) {
        // skip
      } else {
      if (lvl > _calibRequest.max) _calibRequest.max = lvl;
      _calibRequest.sum += lvl; _calibRequest.n++;
      if (now - _calibRequest.startAt >= _calibRequest.duration) {
        const avg = _calibRequest.sum / Math.max(1, _calibRequest.n);
        state.baseline = Math.max(_calibRequest.max, avg * 1.5, 0.01);
        if (state.thNoiseOverride === null) state.thNoise = state.baseline + 0.025;
        if (state.thSilenceOverride === null) state.thSilence = state.baseline + 0.005;
        state.calibrated = true;
        console.log('[mic] calibrato. baseline=', state.baseline.toFixed(4), 'thNoise=', state.thNoise.toFixed(4), 'thSilence=', state.thSilence.toFixed(4));
        const res = { baseline: state.baseline, thNoise: state.thNoise, thSilence: state.thSilence };
        _calibRequest.resolve(res);
        _calibRequest = null;
      }
      }
    }

    if (_resetCounters) {
      _noiseSince = 0;
      _silenceSince = 0;
      _resetCounters = false;
    }
    const triggerOn = getMicEnabled();
    if (lvl > state.thNoise) {
      _silenceSince = 0;
      if (!_noiseSince) _noiseSince = now;
      if (now - _noiseSince >= NOISE_HOLD_MS) {
        if (triggerOn) {
          if (hooks.onNoise) hooks.onNoise();
          if (hooks.shouldStop && hooks.shouldStop()) hooks.onStop && hooks.onStop();
        }
        _noiseSince = now;
      }
    } else if (lvl < state.thSilence) {
      _noiseSince = 0;
      if (!_silenceSince) _silenceSince = now;
      if (now - _silenceSince >= SILENCE_HOLD_MS) {
        if (triggerOn && hooks.shouldStart && hooks.shouldStart()) hooks.onStart && hooks.onStart();
        _silenceSince = now;
      }
    } else {
      _noiseSince = 0;
      _silenceSince = 0;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

export function stopMicTrigger() {
  if (!state.running) return;
  _stopRequested = true;
}

export function setMicEnabled(enabled, hooks) {
  setMicEnabledCookie(enabled);
  if (enabled) {
    _resetCounters = true; // tick parte da contatori puliti
    if (!state.running) startMicTrigger(hooks);
  }
  // Quando si disattiva il trigger non fermiamo lo stream se sta girando per
  // il monitor del popup; la chiusura del popup si occuperà di stopparlo.
}

// ── UI: popup di configurazione (Ctrl+K) ──────────────────────────────
export function installMicSettingsUI(hooks) {
  if (document.getElementById('mic-settings-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'mic-settings-panel';
  panel.className = 'fixed inset-0 z-[200] place-items-center';
  panel.innerHTML = `
    <div class="absolute inset-0 bg-black/60" data-mic-close></div>
    <div class="relative bg-black/80 border border-white/20 rounded-md p-5 w-[90%] md:max-w-md text-stone-300 text-xs space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-sm font-bold">Mic trigger</p>
        <button class="text-stone-400 hover:text-white cursor-pointer" data-mic-close aria-label="Chiudi">✕</button>
      </div>
      <p>Quando attivo, l'autoplay parte col silenzio e si ferma quando il microfono rileva rumore ambientale.</p>

      <label class="flex items-center justify-between gap-3 cursor-pointer select-none">
        <span>Abilita mic trigger</span>
        <span class="relative inline-block w-10 h-5">
          <input type="checkbox" id="mic-toggle" class="peer sr-only">
          <span class="absolute inset-0 rounded-full bg-stone-700 peer-checked:bg-white transition-colors"></span>
          <span class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white peer-checked:bg-black peer-checked:translate-x-5 transition-transform"></span>
        </span>
      </label>

      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span>Livello microfono</span>
          <span id="mic-status" class="text-stone-500">—</span>
        </div>
        <canvas id="mic-graph" width="400" height="100" class="w-full h-24 bg-black/60 border border-white/10 rounded"></canvas>
        <div class="flex items-center justify-between text-[10px] text-stone-500">
          <span><span class="inline-block w-2 h-2 bg-white align-middle mr-1"></span>livello</span>
          <span><span class="inline-block w-2 h-2 bg-red-500 align-middle mr-1"></span>soglia rumore</span>
          <span><span class="inline-block w-2 h-2 bg-emerald-500 align-middle mr-1"></span>soglia silenzio</span>
          <span><span class="inline-block w-2 h-2 bg-stone-400 align-middle mr-1"></span>baseline</span>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2">
        <span class="text-stone-500">Baseline: <span id="mic-baseline">—</span></span>
        <button id="mic-calibrate" class="px-2 py-1 border border-white/20 rounded hover:bg-white hover:text-black transition-colors cursor-pointer">Calibra (2s)</button>
      </div>

      <p class="text-stone-500">Ctrl+K per aprire/chiudere</p>
    </div>
  `;
  panel.style.display = 'none';
  document.body.appendChild(panel);

  const toggle = panel.querySelector('#mic-toggle');
  const canvas = panel.querySelector('#mic-graph');
  const ctx2d = canvas.getContext('2d');
  const baselineEl = panel.querySelector('#mic-baseline');
  const statusEl = panel.querySelector('#mic-status');
  const calibBtn = panel.querySelector('#mic-calibrate');

  // Storico del livello (~10s a 60fps)
  const HISTORY = 600;
  const history = new Float32Array(HISTORY);
  let histIdx = 0;
  let rafId = null;

  function fillInputs() {
    baselineEl.textContent = state.calibrated ? state.baseline.toFixed(4) : 'non calibrato';
    statusEl.textContent = state.running
      ? (state.calibrated ? state.level.toFixed(4) : 'calibrazione…')
      : 'spento';
  }

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx2d.clearRect(0, 0, W, H);

    // Sfondo che lampeggia in base allo stato corrente del livello
    if (state.level > state.thNoise) {
      ctx2d.fillStyle = 'rgba(239,68,68,0.18)';
      ctx2d.fillRect(0, 0, W, H);
    } else if (state.level < state.thSilence) {
      ctx2d.fillStyle = 'rgba(16,185,129,0.12)';
      ctx2d.fillRect(0, 0, W, H);
    }

    // Scala dinamica basata su max(thNoise, picco recente) con un minimo sensato
    let peak = Math.max(state.thNoise, 0.05);
    for (let i = 0; i < HISTORY; i++) if (history[i] > peak) peak = history[i];
    const yMax = peak * 1.2;

    const yOf = (v) => H - (Math.max(0, Math.min(v, yMax)) / yMax) * H;

    // Soglia silenzio (verde)
    ctx2d.strokeStyle = 'rgba(16,185,129,0.85)';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(0, yOf(state.thSilence));
    ctx2d.lineTo(W, yOf(state.thSilence));
    ctx2d.stroke();

    // Soglia rumore (rosso)
    ctx2d.strokeStyle = 'rgba(239,68,68,0.9)';
    ctx2d.beginPath();
    ctx2d.moveTo(0, yOf(state.thNoise));
    ctx2d.lineTo(W, yOf(state.thNoise));
    ctx2d.stroke();

    // Baseline (grigio tratteggiato)
    if (state.calibrated) {
      ctx2d.strokeStyle = 'rgba(168,162,158,0.6)';
      ctx2d.setLineDash([3, 3]);
      ctx2d.beginPath();
      ctx2d.moveTo(0, yOf(state.baseline));
      ctx2d.lineTo(W, yOf(state.baseline));
      ctx2d.stroke();
      ctx2d.setLineDash([]);
    }

    // Livello (bianco)
    ctx2d.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    for (let i = 0; i < HISTORY; i++) {
      const idx = (histIdx + i) % HISTORY;
      const x = (i / (HISTORY - 1)) * W;
      const y = yOf(history[idx]);
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
  }

  function loop() {
    history[histIdx] = state.level;
    histIdx = (histIdx + 1) % HISTORY;
    fillInputs();
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function open() {
    // Rilascia il pointer lock così il cursore è visibile e si può cliccare il pannello.
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (_) {}
    }
    toggle.checked = getMicEnabled();
    history.fill(0);
    panel.style.display = 'grid';
    fillInputs();
    if (rafId === null) loop();
    // Avvia il mic per il monitor (richiede il permesso al browser).
    if (!state.running) {
      startMicTrigger(hooks, { force: true });
    }
    if (hooks.onPanelOpen) {
      try { hooks.onPanelOpen(); } catch (_) {}
    }
  }
  function close() {
    panel.style.display = 'none';
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    // Se il trigger è disabilitato, ferma lo stream del mic alla chiusura.
    if (!getMicEnabled() && state.running) {
      stopMicTrigger();
    }
    if (hooks.onPanelClose) {
      try { hooks.onPanelClose(); } catch (_) {}
    }
  }

  panel.querySelectorAll('[data-mic-close]').forEach(el => {
    el.addEventListener('click', close);
  });

  toggle.addEventListener('change', () => {
    setMicEnabled(toggle.checked, hooks);
  });

  calibBtn.addEventListener('click', async () => {
    const original = calibBtn.textContent;
    calibBtn.disabled = true;
    try {
      if (!state.running) {
        calibBtn.textContent = 'Avvio mic…';
        await startMicTrigger(hooks, { force: true });
      }
      if (!state.running) {
        statusEl.textContent = 'mic non disponibile';
        return;
      }
      calibBtn.textContent = 'Calibrazione…';
      await calibrate(2000);
    } catch (e) {
      console.warn('[mic] calibrazione fallita', e);
    } finally {
      calibBtn.disabled = false;
      calibBtn.textContent = original;
      fillInputs();
    }
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (panel.style.display === 'none') open();
      else close();
    } else if (e.key === 'Escape' && panel.style.display !== 'none') {
      close();
    }
  });
}
