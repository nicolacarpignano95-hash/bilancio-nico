// ═══════════════════════════════════════════════════
// parser.js — NLP leggero per messaggi in italiano
//
// Legge un testo libero e restituisce un oggetto
// ParseResult con i campi trovati e quelli mancanti.
// NON inventa dati: se un campo è ambiguo, lo lascia
// null e lo mette in `missing[]`.
// ═══════════════════════════════════════════════════

// ── Keyword maps ──────────────────────────────────

const KIND_EXPENSE_KW = [
  'spesa','speso','uscita','uscite','pagato','pago','pagato','comprare',
  'comprato','acquistato','acquisto','pagamento','netflix','benza','benzina',
  'sigarette','pranzo','cena','colazione','bar','gasolio','gasolii',
];
const KIND_INCOME_KW = [
  'incassato','incasso','entrata','entrate','guadagnato','pagato da',
  'ricevuto','fattura','fatt','bonifico','ricavo',
];
const KIND_INVEST_KW = [
  'etf','bitcoin','btc','crypto','investito','investimento',
  'trade republic','revolut crypto','bondora',
];

const AREA_NICO_KW  = ['nico'];
const AREA_INLAB_KW = ['inlab','in lab'];

const PAYMODE_FATT_KW = ['fattura','fatt','ftt','f.tt','f.t.t.','con fattura'];
const PAYMODE_CONT_KW = ['contanti','cash','cont','senza fattura','nero'];

const COLLECTOR_NICO_KW   = ['nico','da nico','incassato nico'];
const COLLECTOR_ILARIA_KW = ['ilaria','da ilaria','incassato ilaria'];

const EXPENSE_CATEGORIES = [
  'Necessità','Extra','Lavoro','Viaggi','Cibo','Salute',
  'Casa','Abbonamenti','Cazzate','Uscite',
];

const CATEGORY_KW = {
  'Necessità':   ['necessità','necessita','necessario','bolletta','affitto','rata'],
  'Extra':       ['extra','straordinario','regalo'],
  'Lavoro':      ['lavoro','lavori','professionale','ufficio','benza','benzina','gasolio','gasolii'],
  'Viaggi':      ['viaggio','viaggi','weekend','vacanza','vacanze','volo','treno','autostrada'],
  'Cibo':        ['cibo','pranzo','cena','colazione','bar','ristorante','spesa','supermercato','conad','lidl','esselunga'],
  'Salute':      ['salute','medico','farmacia','farmaco','visita','dottore'],
  'Casa':        ['casa','affitto','mutuo','mobili','arredamento'],
  'Abbonamenti': ['abbonamento','abbonamenti','netflix','spotify','amazon','prime','palestra'],
  'Cazzate':     ['cazzate','sigarette','sigare','fumo','tabacco','gratta'],
  'Uscite':      ['uscita','uscite','serata','aperitivo','pizzeria','pizza','birra'],
};

// ── Helpers ───────────────────────────────────────

function normalise(str) {
  return str.toLowerCase()
    .replace(/[àáâ]/g, 'a').replace(/[èéê]/g, 'e')
    .replace(/[ìíî]/g, 'i').replace(/[òóô]/g, 'o')
    .replace(/[ùúû]/g, 'u')
    .replace(/[^a-z0-9\s.,€]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function matchesAny(text, keywords) {
  return keywords.some(kw => text.includes(kw));
}

/**
 * Estrae il primo numero dal testo.
 * Supporta: 12.50, 12,50, 12 euro, €12
 */
function extractAmount(text) {
  const m = text.match(/€?\s*(\d{1,6}[.,]\d{1,2})|\b(\d{1,6})\s*(?:euro|€|eur)?/i);
  if (!m) return null;
  const raw = (m[1] || m[2]).replace(',', '.');
  const n = parseFloat(raw);
  return isNaN(n) || n <= 0 ? null : n;
}

/**
 * Tenta di estrarre una data dal testo (gg/mm, gg-mm, "ieri", "oggi").
 * Se non trovata, restituisce la data di oggi in ISO.
 */
function extractDate(text) {
  const today = new Date();

  if (/\bieri\b/.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  // gg/mm o gg-mm (assume anno corrente)
  const m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    const d = new Date(today.getFullYear(), mon, day);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }

  return today.toISOString().split('T')[0];
}

/**
 * Tenta di estrarre la descrizione / nome cliente.
 * Rimuove keyword numeriche e di classificazione, prende quello che resta.
 */
function extractDesc(text, amount) {
  let s = text;
  // Rimuovi l'importo
  if (amount != null) {
    s = s.replace(new RegExp(`€?\\s*${String(amount).replace('.', '[.,]')}\\s*(euro|€|eur)?`, 'i'), '');
  }
  // Rimuovi keyword strutturali
  const structuralKw = [
    ...KIND_EXPENSE_KW, ...KIND_INCOME_KW, ...KIND_INVEST_KW,
    ...AREA_NICO_KW, ...AREA_INLAB_KW,
    ...PAYMODE_FATT_KW, ...PAYMODE_CONT_KW,
    ...COLLECTOR_NICO_KW, ...COLLECTOR_ILARIA_KW,
    'euro','eur','aggiungi','aggiunto','metti','registra','oggi','ieri',
    'da','per','su','di','il','la','le','lo','un','una',
  ];
  structuralKw.forEach(kw => {
    s = s.replace(new RegExp(`\\b${kw}\\b`, 'gi'), ' ');
  });
  // Rimuovi date gg/mm
  s = s.replace(/\b\d{1,2}[\/\-]\d{1,2}\b/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s || null;
}

function detectCategory(text) {
  for (const [cat, kws] of Object.entries(CATEGORY_KW)) {
    if (matchesAny(text, kws)) return cat;
  }
  return null;
}

// ── Main parse function ───────────────────────────

/**
 * @typedef {Object} ParseResult
 * @property {'expense'|'income'|'invest'|null} kind
 * @property {number|null}  gross
 * @property {string|null}  desc
 * @property {'nico'|'inlab'|null} area
 * @property {string|null}  category
 * @property {'fatt'|'cont'|null} payMode
 * @property {'nico'|'ilaria'|null} collector
 * @property {string}       date        — sempre valorizzata (oggi se non trovata)
 * @property {string[]}     missing     — campi da chiedere
 * @property {boolean}      confident   — true se tutto il necessario è presente
 */

export function parseMessage(rawText) {
  const text = normalise(rawText);

  const result = {
    kind:      null,
    gross:     null,
    desc:      null,
    area:      null,
    category:  null,
    payMode:   null,
    collector: null,
    date:      extractDate(text),
    missing:   [],
    confident: false,
  };

  // ── Kind ──
  if (matchesAny(text, KIND_INVEST_KW)) {
    result.kind = 'invest';
  } else if (matchesAny(text, KIND_INCOME_KW)) {
    result.kind = 'income';
  } else if (matchesAny(text, KIND_EXPENSE_KW)) {
    result.kind = 'expense';
  }
  // fallback: se c'è solo un numero potrebbe essere spesa
  // non assumiamo — resta null

  // ── Gross ──
  result.gross = extractAmount(text);

  // ── Area ──
  if (matchesAny(text, AREA_INLAB_KW))     result.area = 'inlab';
  else if (matchesAny(text, AREA_NICO_KW)) result.area = 'nico';

  // ── PayMode ──
  if (matchesAny(text, PAYMODE_FATT_KW))     result.payMode = 'fatt';
  else if (matchesAny(text, PAYMODE_CONT_KW)) result.payMode = 'cont';

  // ── Collector ──
  if (matchesAny(text, COLLECTOR_ILARIA_KW))     result.collector = 'ilaria';
  else if (matchesAny(text, COLLECTOR_NICO_KW))  result.collector = 'nico';

  // ── Category (solo expense) ──
  if (result.kind === 'expense' || result.kind === null) {
    result.category = detectCategory(text);
  }

  // ── Desc ──
  result.desc = extractDesc(text, result.gross);

  // ── Missing fields validation ──
  if (!result.kind) {
    result.missing.push('kind');
    return result; // impossibile procedere senza sapere il tipo
  }

  if (result.gross == null) result.missing.push('gross');

  if (result.kind === 'expense') {
    if (!result.area)     result.missing.push('area');
    if (!result.category) result.missing.push('category');
  }

  if (result.kind === 'income') {
    if (!result.area)      result.missing.push('area');
    if (!result.payMode)   result.missing.push('payMode');
    if (result.area === 'inlab' && !result.collector) result.missing.push('collector');
  }

  result.confident = result.missing.length === 0;
  return result;
}

/**
 * Dato un pending parziale e una risposta dell'utente, prova a
 * completare i campi mancanti.
 * @param {object} pending  — risultato parziale salvato in Firestore
 * @param {string} reply    — risposta dell'utente al chiarimento
 * @returns {object}        — pending aggiornato
 */
export function applyReply(pending, reply) {
  const text = normalise(reply);
  const p = { ...pending, missing: [...(pending.missing || [])] };

  if (p.missing.includes('area')) {
    if (matchesAny(text, AREA_INLAB_KW))      { p.area = 'inlab'; p.missing = p.missing.filter(x => x !== 'area'); }
    else if (matchesAny(text, AREA_NICO_KW))  { p.area = 'nico';  p.missing = p.missing.filter(x => x !== 'area'); }
    else if (/\b1\b/.test(text))              { p.area = 'nico';  p.missing = p.missing.filter(x => x !== 'area'); }
    else if (/\b2\b/.test(text))              { p.area = 'inlab'; p.missing = p.missing.filter(x => x !== 'area'); }
  }

  if (p.missing.includes('payMode')) {
    if (matchesAny(text, PAYMODE_FATT_KW))      { p.payMode = 'fatt'; p.missing = p.missing.filter(x => x !== 'payMode'); }
    else if (matchesAny(text, PAYMODE_CONT_KW)) { p.payMode = 'cont'; p.missing = p.missing.filter(x => x !== 'payMode'); }
    else if (/\b1\b/.test(text))                { p.payMode = 'fatt'; p.missing = p.missing.filter(x => x !== 'payMode'); }
    else if (/\b2\b/.test(text))                { p.payMode = 'cont'; p.missing = p.missing.filter(x => x !== 'payMode'); }
  }

  if (p.missing.includes('collector')) {
    if (matchesAny(text, COLLECTOR_NICO_KW))    { p.collector = 'nico';   p.missing = p.missing.filter(x => x !== 'collector'); }
    else if (matchesAny(text, COLLECTOR_ILARIA_KW)) { p.collector = 'ilaria'; p.missing = p.missing.filter(x => x !== 'collector'); }
    else if (/\b1\b/.test(text))                { p.collector = 'nico';   p.missing = p.missing.filter(x => x !== 'collector'); }
    else if (/\b2\b/.test(text))                { p.collector = 'ilaria'; p.missing = p.missing.filter(x => x !== 'collector'); }
  }

  if (p.missing.includes('category')) {
    // Cerca corrispondenza diretta con le categorie
    const found = EXPENSE_CATEGORIES.find(cat =>
      text.includes(cat.toLowerCase()) || detectCategory(text) === cat
    );
    if (found) { p.category = found; p.missing = p.missing.filter(x => x !== 'category'); }
    // Accetta numero 1-N come indice
    const idx = parseInt(text.match(/\b(\d+)\b/)?.[1] ?? '', 10);
    if (!isNaN(idx) && idx >= 1 && idx <= EXPENSE_CATEGORIES.length) {
      p.category = EXPENSE_CATEGORIES[idx - 1];
      p.missing = p.missing.filter(x => x !== 'category');
    }
  }

  if (p.missing.includes('gross')) {
    const amt = extractAmount(text);
    if (amt) { p.gross = amt; p.missing = p.missing.filter(x => x !== 'gross'); }
  }

  p.confident = p.missing.length === 0;
  return p;
}

export { EXPENSE_CATEGORIES };
