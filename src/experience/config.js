// ─────────────────────────────────────────────────────────────
// MOLTIPLICATORE VELOCITÀ (test: 10.0 — produzione: 1.0)
// Scala: movimento manuale, autoplay walk, animazioni turn/snap/pitch,
//        eye adaptation, caduta iniziale.
// ─────────────────────────────────────────────────────────────
export const DEV_SPEED_MULT = 1;

// ── Camminata ─────────────────────────────────────────────────
export const WALK_SPEED    = 1.2;
export const CAMERA_RADIUS = 1;

// Head bob
export const BOB_FREQ = Math.PI;
export const BOB_AMP  = 0.02;   // ampiezza verticale (world units)

// ── Altezza ───────────────────────────────────────────────────
export const START_HEIGHT         = 50;
export const GROUND_HEIGHT_OFFSET = 1.5;
export const DROP_SPEED           = 30;

// ── Griglia e pilastri ────────────────────────────────────────
export const BASE_SPACING       = 4.75;
export const SPACING            = BASE_SPACING * 1.1;
export const PILLAR_WIDTH       = 2.3;
export const PILLAR_HEIGHT      = 4.5;
export const ENGRAVING_DISTANCE = 25;   // entro questa distanza i nomi vengono incisi

// ─────────────────────────────────────────────────────────────
// COLORI SCENA
// ─────────────────────────────────────────────────────────────

// ── Cielo ─────────────────────────────────────────────────────
export const COLOR_SKY_TOP    = 0x505050;   // zenith
export const COLOR_SKY_MID    = 0x606060;   // orizzonte
export const COLOR_SKY_BOTTOM = 0x404040;   // sotto l'orizzonte

// ── Nebbia e sfondo renderer ──────────────────────────────────
export const COLOR_FOG   = 0x202020;
export const COLOR_CLEAR = 0x101010;

// ── Luci ──────────────────────────────────────────────────────
export const COLOR_HEMI_SKY    = 0x505050;  // HemisphereLight — lato cielo
export const COLOR_HEMI_GROUND = 0x404040;  // HemisphereLight — lato terra
export const COLOR_DIRECTIONAL = 0x707070;
export const COLOR_AMBIENT     = 0x484848;
export const COLOR_FILL        = 0x505050;
export const COLOR_BACK        = 0x404040;

// ── Terreno ───────────────────────────────────────────────────
export const COLOR_FLOOR          = 0x000000;
export const COLOR_FLOOR_EMISSIVE = 0x000000;

// ── Pilastri ──────────────────────────────────────────────────
export const COLOR_PILLAR = 0xffffff;  // materiale con texture (MeshStandardMaterial)

// ─────────────────────────────────────────────────────────────
// VALORI LUCI — da INITIAL a TARGET in EYE_ADAPTATION_SECS
// ─────────────────────────────────────────────────────────────
export const EYE_ADAPTATION_SECS = 20;

export const INITIAL_HEMISPHERE  = 0.90 * 2;
export const INITIAL_DIRECTIONAL = 2.4  * 2;
export const INITIAL_AMBIENT     = 0.90 * 2;
export const INITIAL_FILL        = 0;
export const INITIAL_BACK        = 0;
export const INITIAL_SKY         = 1.30 * 2;
export const INITIAL_FOG_DENSITY = 0.01;

export const TARGET_HEMISPHERE   = 0.90 * 3;
export const TARGET_DIRECTIONAL  = 2.4  * 3;
export const TARGET_AMBIENT      = 0.90 * 3;
export const TARGET_FILL         = 0;
export const TARGET_BACK         = 0;
export const TARGET_SKY          = 1.30 * 3;
export const TARGET_FOG_DENSITY  = 0.1;

// ─────────────────────────────────────────────────────────────
// AUTOPLAY
// ─────────────────────────────────────────────────────────────
export const AUTOPLAY_WALK_SPEED   = 1.2;
export const AUTOPLAY_TURN_SECONDS = 2.6;
export const AUTOPLAY_IDLE_SECS    = 8;    // secondi senza input prima dell'avvio automatico (desktop)

// ── Reading ───────────────────────────────────────────────────
export const READING_TURN_SECS       = 1.5;  // durata rotazione verso/da il pilastro
export const READING_PITCH           = 0.28; // angolo di inclinazione testa (radianti)
export const READING_TILT_SECS       = 1.15; // durata ease-in-out tilt su/giù
export const READING_PAUSE_SECS      = 2;    // pausa minima mentre si guarda il nome
export const READING_PAUSE_DOWN_SECS = 0;    // pausa dopo che la testa è tornata giù

// ── Audio ─────────────────────────────────────────────────────
export const BG_VOLUME       = 0.5;
export const FOOTSTEP_VOLUME = 0.3;

// Attesa massima dell'inizio della risposta dell'API prima di usare i dati locali
export const API_TIMEOUT_SECS = 8;
