// Stato dell'interfaccia, condiviso tra i componenti e il memoriale 3D
export const ui = $state({
  instructions: true,   // popup iniziale
  pause: false,
  info: false,
  totalCount: null,     // numero di pilastri, noto dopo il caricamento
  snapshotDate: null,   // data dei dati (YYYY-MM-DD) se arrivano dalla copia locale
  touchControls: false, // pulsanti di movimento su mobile, dopo l'ingresso
});

// Popup nascosto dall'apertura dell'info, da ripristinare alla chiusura
let hiddenByInfo = null;

export function openInfo() {
  if (ui.info) return;

  hiddenByInfo = ui.instructions ? 'instructions' : ui.pause ? 'pause' : null;
  if (hiddenByInfo) ui[hiddenByInfo] = false;
  ui.info = true;
}

export function closeInfo() {
  if (!ui.info) return;

  ui.info = false;
  if (hiddenByInfo) ui[hiddenByInfo] = true;
  hiddenByInfo = null;
}

export function toggleInfo() {
  if (ui.info) closeInfo();
  else openInfo();
}
