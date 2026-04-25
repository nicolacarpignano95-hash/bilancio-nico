// ═══════════════════════════════════════════════════
// FIREBASE DB LAYER — bilancio-nico  v3.0
// ═══════════════════════════════════════════════════
// Usa il db già inizializzato in firebase.js
// NON ri-inizializza Firebase (evita conflitti)
// ═══════════════════════════════════════════════════
import { db } from '../firebase.js';
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
} from 'firebase/firestore';

const STATE_DOC = doc(db, 'bilancio', 'nico');

let _onRemoteUpdate     = null;
let _ignoreNextSnapshot = false;
let _unsubscribe        = null;
let _reconnectTimer     = null;
let _initialState       = null;
let _listenerActive     = false;

// ════════════════════════════════════════════════════
// ① LISTENER UNICO
//    - idempotente: non duplica se già attivo
//    - forceRestart=true solo su errore o ritorno online
// ════════════════════════════════════════════════════
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

      // Offline reale = niente internet + cache + nessun write pendente
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
      _reconnectTimer = setTimeout(() => startListener(true), 5000);
    }
  );
}

// ════════════════════════════════════════════════════
// initDB — chiamato una volta al boot
// ════════════════════════════════════════════════════
export async function initDB(initialState, onUpdate) {
  _onRemoteUpdate = onUpdate;
  _initialState   = initialState;

  let startState = { ...initialState };

  try {
    const snap = await getDoc(STATE_DOC);
    if (snap.exists()) {
      startState = mergeState(initialState, snap.data());
      console.log('[DB] Stato caricato da Firestore ✓');
      setBannerState('online');
    } else {
      // Prima apertura: migra da localStorage se esiste
      const local = localStorage.getItem('bilancio_nico_v3');
      if (local) {
        try {
          startState = mergeState(initialState, JSON.parse(local));
          await setDoc(STATE_DOC, sanitize(startState));
          console.log('[DB] Migrato localStorage → Firestore ✓');
          setBannerState('online');
        } catch (e) {
          console.warn('[DB] Errore migrazione:', e);
        }
      } else {
        await setDoc(STATE_DOC, sanitize(startState));
        console.log('[DB] Documento Firestore creato ✓');
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

  // Online  → force restart per riaprire il canale Firestore
  // Offline → solo aggiorna il banner, listener già gestito da Firestore
  window.addEventListener('online',  () => { setBannerState('syncing'); startListener(true); });
  window.addEventListener('offline', () => setBannerState('offline'));

  return startState;
}

// ════════════════════════════════════════════════════
// ③ SALVATAGGIO INTELLIGENTE
//    - localStorage: sempre e subito (economico)
//    - Firestore: solo se lo state è realmente cambiato
//      (hash leggero, zero dipendenze)
// ════════════════════════════════════════════════════
let _saveTimer     = null;
let _lastSavedHash = null;

export function saveState(state) {
  // Locale sempre aggiornato
  try { localStorage.setItem('bilancio_nico_v3', JSON.stringify(state)); } catch (_) {}

  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    const hash = _hash(state);
    if (hash === _lastSavedHash) return; // nulla cambiato → skip Firestore

    try {
      _lastSavedHash      = hash;
      _ignoreNextSnapshot = true;
      setBannerState('syncing');
      await setDoc(STATE_DOC, sanitize(state));
      setBannerState('online');
    } catch (e) {
      console.warn('[DB] Errore salvataggio:', e.message);
      _lastSavedHash = null; // reset: riprova al prossimo save
      if (!navigator.onLine) setBannerState('offline');
    }
  }, 1000);
}

// Hash leggero senza dipendenze
function _hash(state) {
  const s = JSON.stringify(state);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${s.length}_${h}`;
}

// ── Helpers ──
function sanitize(obj) { return JSON.parse(JSON.stringify(obj)); }

function mergeState(defaults, remote) {
  const m = { ...defaults, ...remote };
  if (!m.assets)              m.assets = defaults.assets;
  if (!m.assets.liquid)       m.assets.liquid = defaults.assets.liquid;
  if (!m.assets.invest)       m.assets.invest = defaults.assets.invest;
  if (!m.taxPayments)         m.taxPayments = {};
  if (!m.taxAccount)          m.taxAccount = { balances: {} };
  if (!m.taxAccount.balances) m.taxAccount.balances = {};
  if (!m.expenseCategories)   m.expenseCategories = defaults.expenseCategories;
  if (!m.clientFilters)       m.clientFilters = defaults.clientFilters;
  if (!m.filters)             m.filters = defaults.filters;
  if (!m.settings)            m.settings = defaults.settings;
  if (!m.transactions)        m.transactions = [];
  if (!m.clients)             m.clients = [];

  m.transactions.forEach(t => { if (!t.id) t.id = _uid(); });
  m.clients.forEach(c => { if (!c.id) c.id = _uid(); });
  m.assets.liquid.forEach(a => { if (!a.id) a.id = _uid(); });
  m.assets.invest.forEach(a => { if (!a.id) a.id = _uid(); });

  return m;
}

function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ════════════════════════════════════════════════════
// ② BANNER A 3 STATI CON DEBOUNCE 800ms
//    Evita sfarfallio da micro-disconnessioni di rete
//    🔴 offline  → resta finché non torna online
//    🟡 syncing  → resta durante il salvataggio
//    🟢 online   → sparisce con fade dopo 2s
// ════════════════════════════════════════════════════
const BANNER_CFG = {
  offline: { bg: '#ef4444', color: '#fff', text: '🔴 Offline — dati salvati, sincronizzerò al ritorno' },
  syncing: { bg: '#f59e0b', color: '#000', text: '🟡 Sincronizzazione in corso…' },
  online:  { bg: '#10b981', color: '#fff', text: '🟢 Sincronizzato' },
};

let _banner        = null;
let _currentBanner = null;
let _debounceTimer = null;
let _hideTimer     = null;

export function setBannerState(newState) {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => _applyBanner(newState), 800);
}

function _applyBanner(newState) {
  if (_currentBanner === newState) return;
  _currentBanner = newState;
  clearTimeout(_hideTimer);

  const cfg = BANNER_CFG[newState];
  if (!cfg) return;

  if (!_banner) {
    _banner = document.createElement('div');
    _banner.style.cssText = [
      'position:fixed;top:0;left:0;right:0;z-index:9999;',
      'text-align:center;font-size:12px;font-weight:700;',
      'padding:7px;letter-spacing:.3px;',
      'transition:background .4s,opacity .35s;',
    ].join('');
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
          _currentBanner = null;
        }, 380);
      }
    }, 2000);
  }
}
