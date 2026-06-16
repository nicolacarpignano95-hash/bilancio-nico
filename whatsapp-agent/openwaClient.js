// ═══════════════════════════════════════════════════
// openwaClient.js — Wrapper per inviare messaggi via
// OpenWA REST API (sessione già avviata su OpenWA).
// ═══════════════════════════════════════════════════

const OPENWA_BASE  = process.env.OPENWA_API_URL;   // es. http://localhost:2785
const OPENWA_KEY   = process.env.OPENWA_API_KEY;   // master key OpenWA
const SESSION_ID   = process.env.OPENWA_SESSION_ID || 'default';

/**
 * Invia un messaggio di testo al chatId specificato.
 * @param {string} chatId  — es. "39XXXXXXXXXX@c.us"
 * @param {string} text    — testo del messaggio
 */
export async function sendMessage(chatId, text) {
  if (!OPENWA_BASE) {
    console.warn('[OpenWA] OPENWA_API_URL non configurato — risposta skippata');
    return;
  }

  const url = `${OPENWA_BASE}/api/sessions/${SESSION_ID}/messages/send-text`;

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'X-API-Key':     OPENWA_KEY ?? '',
    },
    body: JSON.stringify({ chatId, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[OpenWA] sendMessage failed ${res.status}: ${body}`);
  }

  return res.json();
}
