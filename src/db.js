// ═══════════════════════════════════════════════════
// FIREBASE DB LAYER — bilancio-nico
// ═══════════════════════════════════════════════════
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  enableIndexedDbPersistence,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
} from 'firebase/firestore';

// ── Config Firebase ──
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

// Abilita persistenza offline nativa di Firestore (IndexedDB)
// Quando sei offline, i dati restano disponibili e si sincronizzano al ritorno online
enableIndexedDbPersistence(db).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('[DB] Persistenza offline non attivata: più tab aperte');
  } else if (err.code === 'unimplemented') {
    console.warn('[DB] Persistenza offline non supportata da questo browser');
  }
});

const STATE_DOC = doc(db, 'bilancio', 'nico');

let _onRemoteUpdate     = null;
let _ignoreNextSnapshot = false;
let _unsubscribe        = null;
let _reconnectTimer     = null;
let _initialState       = null;

// ── Listener con riconnessione automatica ──
function startListener() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }

  _unsubscribe = onSnapshot(
    STATE_DOC,
    { includeMetadataChanges: true },
    (snap) => {
      const isFromCache    = snap.metadata.fromCache;
      const hasPendingWrites = snap.metadata.hasPendingWrites;

      // fromCache=true e nessuna scrittura in sospeso = offline
      if (isFromCache && !hasPendingWrites) {
        showOfflineBanner(true);
      } else {
        showOfflineBanner(false);
      }

      if (_ignoreNextSnapshot) { _ignoreNextSnapshot = false; return; }
      // Notifica solo dati confermati dal server (non pending)
      if (snap.exists() && _onRemoteUpdate && !hasPendingWrites) {
        _onRemoteUpdate(mergeState(_initialState, snap.data()));
      }
    },
    (err) => {
      console.warn('[DB] Snapshot error:', err.code, err.message);
      showOfflineBanner(true);
      // Riprova dopo 5 secondi
      clearTimeout(_reconnectTimer);
      _reconnectTimer = setTimeout(() => {
        console.log('[DB] Tentativo riconnessione...');
        startListener();
      }, 5000);
    }
  );
}

// ── initDB ──
export async function initDB(initialState, onUpdate) {
  _onRemoteUpdate = onUpdate;
  _initialState   = initialState;

  let startState = { ...initialState };

  try {
    const snap = await getDoc(STATE_DOC);
    if (snap.exists()) {
      startState = mergeState(initialState, snap.data());
      console.log('[DB] Stato caricato da Firestore');
      showOfflineBanner(false);
    } else {
      // Prima volta: migra da localStorage se esiste
      const local = localStorage.getItem('bilancio_nico_v3');
      if (local) {
        try {
          startState = mergeState(initialState, JSON.parse(local));
          await setDoc(STATE_DOC, sanitize(startState));
          console.log('[DB] Migrato da localStorage → Firestore');
          showOfflineBanner(false);
        } catch (e) {
          console.warn('[DB] Errore migrazione:', e);
        }
      } else {
        await setDoc(STATE_DOC, sanitize(startState));
        console.log('[DB] Documento Firestore creato');
        showOfflineBanner(false);
      }
    }
  } catch (e) {
    console.warn('[DB] Avvio offline:', e.message);
    const local = localStorage.getItem('bilancio_nico_v3');
    if (local) {
      try { startState = mergeState(initialState, JSON.parse(local)); } catch (_) {}
    }
  }

  startListener();
  return startState;
}

// ── saveState con debounce 1s ──
let _saveTimer = null;
export function saveState(state) {
  try { localStorage.setItem('bilancio_nico_v3', JSON.stringify(state)); } catch (_) {}

  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      _ignoreNextSnapshot = true;
      await setDoc(STATE_DOC, sanitize(state));
      showOfflineBanner(false);
    } catch (e) {
      console.warn('[DB] Errore salvataggio:', e.message);
      // IndexedDB salverà e sincronizzerà quando torna online
    }
  }, 1000);
}

// ── Helpers ──
function sanitize(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function mergeState(defaults, remote) {
  const merged = { ...defaults, ...remote };
  if (!merged.assets)              merged.assets = defaults.assets;
  if (!merged.assets.liquid)       merged.assets.liquid = defaults.assets.liquid;
  if (!merged.assets.invest)       merged.assets.invest = defaults.assets.invest;
  if (!merged.taxPayments)         merged.taxPayments = {};
  if (!merged.taxAccount)          merged.taxAccount = { balances: {} };
  if (!merged.taxAccount.balances) merged.taxAccount.balances = {};
  if (!merged.expenseCategories)   merged.expenseCategories = defaults.expenseCategories;
  if (!merged.clientFilters)       merged.clientFilters = defaults.clientFilters;
  if (!merged.filters)             merged.filters = defaults.filters;
  if (!merged.settings)            merged.settings = defaults.settings;
  if (!merged.transactions)        merged.transactions = [];
  if (!merged.clients)             merged.clients = [];

  merged.transactions.forEach(t => { if (!t.id) t.id = _uid(); });
  merged.clients.forEach(c => { if (!c.id) c.id = _uid(); });
  merged.assets.liquid.forEach(a => { if (!a.id) a.id = _uid(); });
  merged.assets.invest.forEach(a => { if (!a.id) a.id = _uid(); });

  return merged;
}

function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Banner offline/online ──
// Appare solo dopo 3s di offline, sparisce dopo 2s di ritorno online
let _banner      = null;
let _bannerTimer = null;

function showOfflineBanner(show) {
  if (show) {
    if (_banner || _bannerTimer) return;
    _bannerTimer = setTimeout(() => {
      if (_banner) return;
      _banner = document.createElement('div');
      _banner.style.cssText = `
        position:fixed;top:0;left:0;right:0;z-index:9999;
        background:#f59e0b;color:#000;text-align:center;
        font-size:12px;font-weight:700;padding:6px;letter-spacing:.3px;
      `;
      _banner.textContent = '📶 Offline — dati salvati localmente, sincronizzazione in attesa';
      document.body.prepend(_banner);
      _bannerTimer = null;
    }, 3000);
  } else {
    clearTimeout(_bannerTimer);
    _bannerTimer = null;
    if (_banner) {
      _banner.textContent = '✓ Sincronizzato con Firebase';
      _banner.style.background = '#10b981';
      _banner.style.color = '#fff';
      setTimeout(() => { _banner?.remove(); _banner = null; }, 2000);
    }
  }
}
