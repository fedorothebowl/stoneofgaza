import { API_TIMEOUT_SECS } from './config.js';

const API_BASE = import.meta.env.DEV
  ? '/tfp/api/v3'
  : 'https://data.techforpalestine.org/api/v3';

const UNKNOWN_PERSON = { en_name: 'Unknown', ar_name: 'غير معروف', age: '—' };

// Dopo il primo fallimento dell'API si leggono solo le copie in public/, così
// totale e nomi arrivano dallo stesso snapshot.
let usingLocal = false;

async function fetchFromApi(file) {
  // Il timeout copre solo l'attesa dell'inizio della risposta: una volta
  // arrivati gli header il download non viene interrotto (la lista pesa ~7 MB).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_SECS * 1000);

  try {
    const res = await fetch(`${API_BASE}/${file}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLocal(file) {
  const res = await fetch(`/${file}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} su /${file}`);
  return res.json();
}

async function fetchJson(file) {
  if (!usingLocal) {
    try {
      return await fetchFromApi(file);
    } catch (err) {
      console.warn('API non disponibile, uso i dati locali:', err);
      usingLocal = true;
    }
  }
  return fetchLocal(file);
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// snapshotDate (YYYY-MM-DD) è valorizzata solo se il totale arriva dalla copia locale
export async function fetchSummary() {
  const summary = await fetchJson('summary.json');
  return {
    totalCount: summary.gaza.killed.total,
    snapshotDate: usingLocal ? summary.gaza.last_update : null,
  };
}

// Una voce per ogni vittima: i nomi noti più tanti "Unknown" quanti ne mancano
// per arrivare al totale, in ordine casuale.
export async function fetchPeople(totalCount) {
  const [, ...rows] = await fetchJson('killed-in-gaza.min.json');

  const people = rows.map(row => ({
    en_name: row[1],
    ar_name: row[2],
    age: row[3]
  }));

  const unknownCount = totalCount - people.length;
  for (let i = 0; i < unknownCount; i++) people.push({ ...UNKNOWN_PERSON });

  return shuffle(people);
}
