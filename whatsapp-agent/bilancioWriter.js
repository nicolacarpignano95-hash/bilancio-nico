// ═══════════════════════════════════════════════════
// bilancioWriter.js — Scrive transazioni su Firestore
//
// Lavora sul documento `bilancio/nico` che è il
// singleDoc dell'app frontend. Usa Admin SDK.
// ═══════════════════════════════════════════════════
import { getDb } from './firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

const BILANCIO_DOC = ['bilancio', 'nico'];

// ── ID univoco (compatibile con quelli dell'app) ──
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Calcola nicoTax, nicoIncome, ilariaIncome.
 * Logica identica a quella dell'app frontend.
 */
function computeFields(parsed) {
  const { kind, area, payMode, collector, gross } = parsed;
  let nicoTax      = 0;
  let nicoIncome   = null;
  let ilariaIncome = null;

  if (kind === 'income') {
    if (payMode === 'fatt' && (collector === 'nico' || area === 'nico')) {
      nicoTax = Math.round(gross * 0.25 * 100) / 100;
    }
    const netto = gross - nicoTax;
    if (area === 'inlab') {
      nicoIncome   = Math.round(netto * 0.5 * 100) / 100;
      ilariaIncome = Math.round(netto * 0.5 * 100) / 100;
    } else {
      nicoIncome = netto;
    }
  }

  return { nicoTax, nicoIncome, ilariaIncome };
}

/**
 * Costruisce l'oggetto transazione da salvare nell'array
 * `state.transactions` del documento Firestore.
 */
function buildTransaction(parsed, waMessageId) {
  const { kind, gross, desc, area, category, payMode, collector, date } = parsed;
  const { nicoTax, nicoIncome, ilariaIncome } = computeFields(parsed);

  const tx = {
    id:        uid(),
    kind,
    area:      area ?? 'nico',
    desc:      desc ?? '',
    gross,
    payMode:   payMode ?? null,
    collector: collector ?? null,
    category:  category ?? null,
    date,
    nicoIncome,
    nicoTax,
    createdAt: new Date().toISOString(),
    source:    'whatsapp',
    waMessageId,   // per idempotenza
  };

  if (ilariaIncome != null) tx.ilariaIncome = ilariaIncome;

  return tx;
}

/**
 * Aggiunge la transazione all'array state.transactions
 * nel documento bilancio/nico, usando arrayUnion per
 * evitare sovrascritture concorrenti dal frontend.
 *
 * @param {object}  parsed       — ParseResult con confident=true
 * @param {string}  waMessageId  — ID messaggio WhatsApp (idempotenza)
 * @returns {object} tx          — transazione salvata
 */
export async function writeToBilancio(parsed, waMessageId) {
  const db  = getDb();
  const ref = db.doc(BILANCIO_DOC.join('/'));

  const tx = buildTransaction(parsed, waMessageId);

  await ref.update({
    transactions: FieldValue.arrayUnion(tx),
  });

  return tx;
}

/**
 * Controlla se un messaggio WhatsApp è già stato processato
 * cercando nei processed_messages o scorrendo le transazioni.
 *
 * @param {string} waMessageId
 * @returns {boolean}
 */
export async function isAlreadyProcessed(waMessageId) {
  const db  = getDb();
  const ref = db.collection('whatsapp_processed_messages').doc(waMessageId);
  const snap = await ref.get();
  return snap.exists;
}

/**
 * Marca un messaggio come processato.
 */
export async function markProcessed(waMessageId, txId) {
  const db  = getDb();
  await db.collection('whatsapp_processed_messages').doc(waMessageId).set({
    txId,
    processedAt: new Date().toISOString(),
  });
}

// ── Pending conversation helpers ──────────────────

/**
 * Salva uno stato parziale in whatsapp_pending/{chatId}.
 */
export async function savePending(chatId, data) {
  const db = getDb();
  await db.collection('whatsapp_pending').doc(chatId).set({
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Carica uno stato parziale per chatId.
 * @returns {object|null}
 */
export async function loadPending(chatId) {
  const db   = getDb();
  const snap = await db.collection('whatsapp_pending').doc(chatId).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Elimina il pending per chatId (dopo completamento o annullamento).
 */
export async function clearPending(chatId) {
  const db = getDb();
  await db.collection('whatsapp_pending').doc(chatId).delete();
}
