// ═══════════════════════════════════════════════════
// FIREBASE DB LAYER — bilancio-nico
// Sostituisce localStorage con Firestore
// ═══════════════════════════════════════════════════
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
} from 'firebase/firestore';

// ── Config Firebase — progetto bilancio-nico ──
const firebaseConfig = {
  apiKey:            'AIzaSyDDgYLDwuwjDzjPnHv9CbpmaRfzExFO5rE',
  authDomain:        'bilancio-nico.firebaseapp.com',
  projectId:         'bilancio-nico',
  storageBucket:     'bilancio-nico.firebasestorage.app',
  messagingSenderId: '828281781529',
  appId:             '1:828281781529:web:4f91d7c1d0885445a55988',
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── Documento unico: /bilancio/nico ──
// Tutto lo state viene serializzato in un singolo documento Firestore.
// Semplice, veloce, nessun bisogno di sotto-collezioni per questa app.
const STATE_DOC = doc(db, 'bilancio', 'nico');

// ── Callback da notificare quando arrivano aggiornamenti remoti ──
let _onRemoteUpdate = null;

// ── Flag per evitare loop write→snapshot→write ──
let _ignoreNextSnapshot = false;

/**
 * Inizializza la persistenza Firebase.
 * - Carica lo state iniziale da Firestore (o da localStorage come fallback).
 * - Mette in ascolto gli aggiornamenti remoti.
 *
 * @param {object}   initialState  - Lo state default dell'app
 * @param {function} onUpdate      - Callback(newState) chiamata ad ogni sync remoto
 * @returns {Promise<object>}        Lo state da usare all'avvio
 */
export async function initDB(initialState, onUpdate) {
  _onRemoteUpdate = onUpdate;

  let startState = { ...initialState };

  try {
    const snap = await getDoc(STATE_DOC);
    if (snap.exists()) {
      // Firestore ha dati → usali
      const remote = snap.data();
      startState = mergeState(initialState, remote);
      console.log('[DB] Stato caricato da Firestore');
    } else {
      // Prima volta: prova a migrare da localStorage
      const local = localStorage.getItem('bilancio_nico_v3');
      if (local) {
        try {
          const parsed = JSON.parse(local);
          startState = mergeState(initialState, parsed);
          console.log('[DB] Migrato da localStorage → Firestore');
          // Salva subito su Firestore
          await setDoc(STATE_DOC, sanitize(startState));
        } catch (e) {
          console.warn('[DB] Errore migrazione localStorage:', e);
        }
      } else {
        // App nuova: crea documento vuoto
        await setDoc(STATE_DOC, sanitize(startState));
        console.log('[DB] Documento Firestore creato');
      }
    }
  } catch (e) {
    // Offline o errore Firestore → usa localStorage come fallback
    console.warn('[DB] Firestore non raggiungibile, uso localStorage:', e.message);
    const local = localStorage.getItem('bilancio_nico_v3');
    if (local) {
      try { startState = mergeState(initialState, JSON.parse(local)); } catch (_) {}
    }
    showOfflineBanner(true);
  }

  // Ascolta aggiornamenti real-time
  onSnapshot(STATE_DOC, (snap) => {
    if (_ignoreNextSnapshot) { _ignoreNextSnapshot = false; return; }
    if (snap.exists() && _onRemoteUpdate) {
      const remote = snap.data();
      console.log('[DB] Aggiornamento remoto ricevuto');
      _onRemoteUpdate(mergeState(initialState, remote));
    }
  }, (err) => {
    console.warn('[DB] Snapshot error:', err.message);
    showOfflineBanner(true);
  });

  return startState;
}

/**
 * Salva lo state su Firestore (e come backup su localStorage).
 * Debounced a 800ms per evitare scritture eccessive.
 */
let _saveTimer = null;
export function saveState(state) {
  // Backup immediato su localStorage
  try { localStorage.setItem('bilancio_nico_v3', JSON.stringify(state)); } catch (_) {}

  // Debounce per Firestore
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      _ignoreNextSnapshot = true;
      await setDoc(STATE_DOC, sanitize(state));
      showOfflineBanner(false);
    } catch (e) {
      console.warn('[DB] Errore salvataggio Firestore:', e.message);
      showOfflineBanner(true);
    }
  }, 800);
}

// ── Helpers ──────────────────────────────────────────

/**
 * Rimuove valori undefined/function che Firestore non accetta.
 */
function sanitize(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Unisce lo state remoto con quello di default per gestire
 * campi aggiunti in versioni future dell'app.
 */
function mergeState(defaults, remote) {
  const merged = { ...defaults, ...remote };
  // Assicura sotto-strutture critiche
  if (!merged.assets)                merged.assets = defaults.assets;
  if (!merged.assets.liquid)         merged.assets.liquid = defaults.assets.liquid;
  if (!merged.assets.invest)         merged.assets.invest = defaults.assets.invest;
  if (!merged.taxPayments)           merged.taxPayments = {};
  if (!merged.taxAccount)            merged.taxAccount = { balances: {} };
  if (!merged.taxAccount.balances)   merged.taxAccount.balances = {};
  if (!merged.expenseCategories)     merged.expenseCategories = defaults.expenseCategories;
  if (!merged.clientFilters)         merged.clientFilters = defaults.clientFilters;
  if (!merged.filters)               merged.filters = defaults.filters;
  if (!merged.settings)              merged.settings = defaults.settings;
  if (!merged.transactions)          merged.transactions = [];
  if (!merged.clients)               merged.clients = [];

  // Assicura ID su tutti gli item
  merged.transactions.forEach(t => { if (!t.id) t.id = _uid(); });
  merged.clients.forEach(c => { if (!c.id) c.id = _uid(); });
  merged.assets.liquid.forEach(a => { if (!a.id) a.id = _uid(); });
  merged.assets.invest.forEach(a => { if (!a.id) a.id = _uid(); });

  return merged;
}

function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Banner offline ────────────────────────────────────
let _banner = null;
function showOfflineBanner(show) {
  if (show) {
    if (_banner) return;
    _banner = document.createElement('div');
    _banner.id = 'offline-banner';
    _banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:9999;
      background:#ef4444;color:#fff;text-align:center;
      font-size:12px;font-weight:700;padding:6px;
      letter-spacing:.3px;
    `;
    _banner.textContent = '⚠️ Offline — i dati vengono salvati localmente';
    document.body.prepend(_banner);
  } else {
    if (_banner) { _banner.remove(); _banner = null; }
  }
}
