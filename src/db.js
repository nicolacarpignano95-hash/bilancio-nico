// ═══════════════════════════════════════════════════
// FIREBASE DB LAYER — bilancio-nico  v2.0
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
const db          = getFirestore(firebaseApp);

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
let _listenerActive     = false;

// ════════════════════════════════════════════════════════
// ① LISTENER UNICO E CONTROLLATO
//    startListener() è idempotente: se il listener è già
//    attivo non lo duplica. Solo forceRestart=true (usato
//    su errore o ritorno online) abbatte e ricrea.
// ════════════════════════════════════════════════════════
function startListener(forceRestart = false) {
  if (_listenerActive && !forceRestart) return;

  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _listenerActive = false;

  _unsubscribe = onSnapshot(
    STATE_DOC,
    { includeMetadataChanges: true },
    (snap) => {
      _listenerActive = true;
      const { hasPendingWrites, fromCache } = snap.metadata;

      const isReallyOffline = !navigator.onLine && fromCache && !hasPendingWrites;

      if      (hasPendingWrites) setBannerState('syncing');
      else if (isReallyOffline)  setBannerState('offline');
      else                       setBannerState('online');

      if (_ignoreNextSnapshot) { _ignoreNextSnapshot = false; return; }
      if (snap.exists() && _onRemoteUpdate && !hasPendingWrites) {
        _onRemoteUpdate(mergeState(_initialState, snap.data()));
      }
    },
    (err) => {
      _listenerActive = false;
      console.warn('[DB] Snapshot error:', err.code, err.message);
      if (!navigator.onLine) setBannerState('offline');
      clearTimeout(_reconnectTimer);
      _reconnectTimer = setTimeout(() => {
        console.log('[DB] Tentativo riconnessione...');
        startListener(true);
      }, 5000);
    }
  );
}

// ════════════════════════════════════════════════════════
// initDB
// ════════════════════════════════════════════════════════
export async function initDB(initialState, onUpdate) {
  _onRemoteUpdate = onUpdate;
  _initialState   = initialState;

  let startState = { ...initialState };

  try {
    const snap = await getDoc(STATE_DOC);
    if (snap.exists()) {
      startState = mergeState(initialState, snap.data());
      console.log('[DB] Stato caricato da Firestore');
      setBannerState('online');
    } else {
      const local = localStorage.getItem('bilancio_nico_v3');
      if (local) {
        try {
          startState = mergeState(initialState, JSON.parse(local));
          await setDoc(STATE_DOC, sanitize(startState));
          console.log('[DB] Migrato da localStorage → Firestore');
          setBannerState('online');
        } catch (e) {
          console.warn('[DB] Errore migrazione:', e);
        }
      } else {
        await setDoc(STATE_DOC, sanitize(startState));
        console.log('[DB] Documento Firestore creato');
        setBannerState('online');
      }
    }
  } catch (e) {
    console.warn('[DB] Avvio offline:', e.message);
    const local = localStorage.getItem('bilancio_nico_v3');
    if (local) {
      try { startState = mergeState(initialState, JSON.parse(local)); } catch (_) {}
    }
    setBannerState('offline');
  }

  startListener();

  // "online"  → forceRestart per ristabilire il canale Firestore
  // "offline" → aggiorna solo il banner, il listener non va toccato
  window.addEventListener('online',  () => { setBannerState('syncing'); startListener(true); });
  window.addEventListener('offline', () => setBannerState('offline'));

  return startState;
}

// ════════════════════════════════════════════════════════
// ③ SALVATAGGI INTELLIGENTI
//    Confronta un hash leggero del nuovo state con l'ultimo
//    salvato. Se identico → salta setDoc (niente scrittura
//    inutile su Firestore). localStorage viene sempre
//    aggiornato perché è locale e non ha costi.
// ════════════════════════════════════════════════════════
let _saveTimer     = null;
let _lastSavedHash = null;

export function saveState(state) {
  try { localStorage.setItem('bilancio_nico_v3', JSON.stringify(state)); } catch (_) {}

  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    const hash = _hashState(state);
    if (hash === _lastSavedHash) return; // nulla è cambiato → skip

    try {
      _lastSavedHash      = hash;
      _ignoreNextSnapshot = true;
      setBannerState('syncing');
      await setDoc(STATE_DOC, sanitize(state));
      setBannerState('online');
    } catch (e) {
      console.warn('[DB] Errore salvataggio:', e.message);
      _lastSavedHash = null; // forza retry al prossimo save
      if (!navigator.onLine) setBannerState('offline');
    }
  }, 1000);
}

// Hash leggero senza dipendenze esterne
function _hashState(state) {
  const s = JSON.stringify(state);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return `${s.length}_${h}`;
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

// ════════════════════════════════════════════════════════
// ② BANNER A 3 STATI CON DEBOUNCE
//    - debounce 800ms: ignora micro-flap di rete
//    - non ridisegna se lo stato è già quello corrente
//    - 🟢 online  → sparisce con fade dopo 2s
//    - 🟡 syncing / 🔴 offline → restano fino al cambio di stato
// ════════════════════════════════════════════════════════
const BANNER_CFG = {
  offline: { bg: '#ef4444', color: '#fff', text: '🔴 Offline — dati salvati, sincronizzerò al ritorno' },
  syncing: { bg: '#f59e0b', color: '#000', text: '🟡 Sincronizzazione in corso…' },
  online:  { bg: '#10b981', color: '#fff', text: '🟢 Sincronizzato' },
};

let _banner        = null;
let _currentBanner = null;
let _debounceTimer = null;
let _hideTimer     = null;

function setBannerState(newState) {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => _applyBanner(newState), 800);
}

function _applyBanner(newState) {
  if (_currentBanner === newState) return; // già mostrato, skip
  _currentBanner = newState;
  clearTimeout(_hideTimer);

  const cfg = BANNER_CFG[newState];
  if (!cfg) return;

  if (!_banner) {
    _banner = document.createElement('div');
    _banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:9999;
      text-align:center;font-size:12px;font-weight:700;
      padding:6px;letter-spacing:.3px;
      transition:background .4s,opacity .35s;
    `;
    document.body.prepend(_banner);
  }

  _banner.style.background = cfg.bg;
  _banner.style.color      = cfg.color;
  _banner.textContent      = cfg.text;
  _banner.style.opacity    = '1';
  _banner.style.display    = 'block';

  if (newState === 'online') {
    _hideTimer = setTimeout(() => {
      if (_banner) {
        _banner.style.opacity = '0';
        setTimeout(() => {
          if (_banner) _banner.style.display = 'none';
          _currentBanner = null; // reset: il prossimo "online" riappare
        }, 380);
      }
    }, 2000);
  }
}
