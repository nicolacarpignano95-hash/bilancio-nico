// ═══════════════════════════════════════════════════
// server.js — Express webhook receiver per OpenWA
//
// Riceve POST da OpenWA (evento message.received),
// verifica firma HMAC, filtra per ALLOWED_CHAT_ID,
// controlla idempotenza, chiama il parser e scrive
// su Firestore (o gestisce conversazione pending).
// ═══════════════════════════════════════════════════
import 'dotenv/config';
import express          from 'express';
import crypto           from 'crypto';
import { parseMessage, applyReply, EXPENSE_CATEGORIES } from './parser.js';
import {
  writeToBilancio,
  isAlreadyProcessed,
  markProcessed,
  savePending,
  loadPending,
  clearPending,
} from './bilancioWriter.js';
import { sendMessage } from './openwaClient.js';

const app  = express();
const PORT = process.env.PORT ?? 3100;

// ── Costanti da .env ──────────────────────────────
const ALLOWED_CHAT_ID   = process.env.ALLOWED_CHAT_ID;   // es. "39XXXXXXXXXX@c.us"
const WEBHOOK_SECRET    = process.env.WEBHOOK_SECRET;     // segreto HMAC configurato in OpenWA
const REQUIRE_SIGNATURE = process.env.REQUIRE_SIGNATURE !== 'false'; // default true

// ── Middleware ────────────────────────────────────
// rawBody necessario per verifica HMAC
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// ── Verifica firma HMAC-SHA256 ────────────────────
function verifySignature(req) {
  if (!REQUIRE_SIGNATURE || !WEBHOOK_SECRET) return true;

  // OpenWA invia la firma in X-OpenWA-Signature o X-Hub-Signature-256
  const sigHeader =
    req.headers['x-openwa-signature'] ||
    req.headers['x-hub-signature-256'] || '';

  const expected = 'sha256=' + crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(sigHeader),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// ── Costruzione messaggi di risposta ─────────────
function missingQuestion(missing, parsed) {
  switch (missing[0]) {
    case 'kind':
      return 'Non ho capito bene: è una *spesa* 💸 o un\'*entrata* 💰?';
    case 'gross':
      return 'Non ho trovato l\'importo. Quanto?';
    case 'area':
      return 'È per *1. Nico* o *2. Inlab*?';
    case 'payMode':
      return 'Pagamento: *1. Fattura* o *2. Contanti*?';
    case 'collector':
      return 'Ha incassato *1. Nico* o *2. Ilaria*?';
    case 'category': {
      const list = EXPENSE_CATEGORIES
        .map((c, i) => `${i + 1}. ${c}`)
        .join('\n');
      return `Che categoria uso?\n${list}`;
    }
    default:
      return `Mi manca: *${missing[0]}*. Puoi specificarlo?`;
  }
}

function confirmationText(parsed) {
  const kindLabel = parsed.kind === 'income' ? 'entrata' : 'spesa';
  const parts = [
    `Ho capito: ${kindLabel} *${parsed.gross}€*`,
    parsed.desc     ? `· ${parsed.desc}`                : null,
    parsed.area     ? `· ${parsed.area.toUpperCase()}`  : null,
    parsed.category ? `· ${parsed.category}`            : null,
    parsed.payMode  ? `· ${parsed.payMode === 'fatt' ? 'fattura' : 'contanti'}` : null,
    parsed.collector? `· incassato da ${parsed.collector}` : null,
    `· ${parsed.date}`,
  ].filter(Boolean).join(' ');
  return parts + '\n\nConfermo? Rispondi *sì* per registrare, *no* per annullare.';
}

function successText(tx) {
  const label = tx.kind === 'income' ? 'Entrata' : 'Spesa';
  const parts = [
    `✅ Registrato: ${label} *${tx.gross}€*`,
    tx.desc     ? `· ${tx.desc}`    : null,
    tx.area     ? `· ${tx.area.toUpperCase()}` : null,
    tx.category ? `· ${tx.category}`: null,
    tx.nicoIncome != null ? `· Nico incassa ${tx.nicoIncome}€` : null,
  ].filter(Boolean).join(' ');
  return parts;
}

// ── Logica principale ─────────────────────────────
async function handleMessage(chatId, messageId, text) {
  // 1. Idempotenza
  if (await isAlreadyProcessed(messageId)) {
    console.log(`[server] Messaggio già processato: ${messageId}`);
    return;
  }

  const normalText = text.trim().toLowerCase();

  // 2. Controlla se c'è una conversazione pending
  const pending = await loadPending(chatId);

  if (pending) {
    // Annullamento esplicito
    if (/\b(no|annulla|cancel|stop|basta)\b/.test(normalText)) {
      await clearPending(chatId);
      await sendMessage(chatId, '❌ Operazione annullata.');
      await markProcessed(messageId, null);
      return;
    }

    // Conferma esplicita
    if (/\b(si|sì|ok|yes|conferm|vai|procedi)\b/.test(normalText)) {
      if (pending.awaitingConfirm && pending.confident) {
        try {
          const tx = await writeToBilancio(pending, messageId);
          await clearPending(chatId);
          await markProcessed(messageId, tx.id);
          await sendMessage(chatId, successText(tx));
        } catch (err) {
          console.error('[server] Errore scrittura Firestore:', err);
          await sendMessage(chatId, '❌ Non sono riuscito a registrarlo. Riprova o apri l\'app.');
        }
        return;
      }
    }

    // Prova a completare il pending con la risposta
    const updated = applyReply(pending, text);

    if (updated.confident) {
      // Tutto presente → chiedi conferma
      await savePending(chatId, { ...updated, awaitingConfirm: true });
      await sendMessage(chatId, confirmationText(updated));
    } else {
      // Ancora campi mancanti
      await savePending(chatId, updated);
      await sendMessage(chatId, missingQuestion(updated.missing, updated));
    }

    await markProcessed(messageId, null);
    return;
  }

  // 3. Nessun pending: parse nuovo messaggio
  const parsed = parseMessage(text);

  if (!parsed.kind) {
    // Non riconosciuto
    await sendMessage(
      chatId,
      'Non sono riuscito a capire il tipo di operazione.\n' +
      'Esempi:\n' +
      '• _spesa 12,50 bar colazione nico cibo_\n' +
      '• _incassato 300 da Rossi inlab fattura nico_\n' +
      '• _aggiungi 50 etf_'
    );
    await markProcessed(messageId, null);
    return;
  }

  if (parsed.confident) {
    // Tutto chiaro → salva direttamente
    try {
      const tx = await writeToBilancio(parsed, messageId);
      await markProcessed(messageId, tx.id);
      await sendMessage(chatId, successText(tx));
    } catch (err) {
      console.error('[server] Errore scrittura Firestore:', err);
      await sendMessage(chatId, '❌ Non sono riuscito a registrarlo. Riprova o apri l\'app.');
    }
  } else {
    // Campi mancanti → salva pending e chiedi
    await savePending(chatId, { ...parsed, awaitingConfirm: false });
    const partialDesc = parsed.gross
      ? `Ho capito una ${parsed.kind === 'income' ? 'entrata' : 'spesa'} di *${parsed.gross}€*, ma mi manca qualcosa.\n`
      : '';
    await sendMessage(chatId, partialDesc + missingQuestion(parsed.missing, parsed));
    await markProcessed(messageId, null);
  }
}

// ── Endpoint webhook ──────────────────────────────
app.post('/webhook', async (req, res) => {
  // Risposta rapida a OpenWA (evita timeout/retry)
  res.status(200).json({ ok: true });

  // Verifica firma
  if (!verifySignature(req)) {
    console.warn('[server] Firma webhook non valida — richiesta ignorata');
    return;
  }

  const body = req.body;

  // OpenWA invia: { event, sessionId, data: IncomingMessage, ... }
  if (body?.event !== 'message.received') return;

  const msg = body.data;
  if (!msg) return;

  const chatId    = msg.chatId || msg.from;
  const messageId = msg.id;
  const text      = msg.body;

  // Filtro numero autorizzato
  if (ALLOWED_CHAT_ID && chatId !== ALLOWED_CHAT_ID) {
    console.log(`[server] Messaggio da numero non autorizzato: ${chatId}`);
    return;
  }

  // Ignora messaggi non testuali
  if (!text || msg.type !== 'chat') return;

  // Ignora messaggi mandati da noi stessi
  if (msg.fromMe) return;

  console.log(`[server] Messaggio ricevuto da ${chatId}: "${text}"`);

  handleMessage(chatId, messageId, text).catch(err => {
    console.error('[server] Errore handleMessage:', err);
  });
});

// ── Health check ──────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Avvio ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ whatsapp-agent in ascolto su http://localhost:${PORT}`);
  if (!ALLOWED_CHAT_ID) console.warn('⚠️  ALLOWED_CHAT_ID non configurato — accetta messaggi da tutti');
  if (!WEBHOOK_SECRET && REQUIRE_SIGNATURE) console.warn('⚠️  WEBHOOK_SECRET non configurato — firma non verificata');
});
