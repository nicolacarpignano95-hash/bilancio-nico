# whatsapp-agent

Ponte **WhatsApp → Firestore** per `bilancio-nico`.

Riceve messaggi WhatsApp via OpenWA, li interpreta in italiano e aggiorna automaticamente il documento `bilancio/nico` su Firestore — lo stesso usato dall'app frontend.

---

## Architettura

```
Tu (WhatsApp) → OpenWA → webhook POST → server.js → parser.js → bilancioWriter.js → Firestore
                                                   ↘ openwaClient.js → risposta WhatsApp
```

---

## Prerequisiti

- **Node.js** ≥ 18
- **OpenWA** in esecuzione (locale o su VPS)
- **Firebase project** con Firestore abilitato
- **Service Account** Firebase con ruolo `Cloud Datastore User`

---

## 1. Installazione

```bash
cd whatsapp-agent
npm install
cp .env.example .env
# Edita .env con i tuoi valori reali
```

---

## 2. Service Account Firebase

1. Vai su [Firebase Console](https://console.firebase.google.com) → Impostazioni progetto → Account di servizio
2. Clicca **Genera nuova chiave privata** → scarica il JSON
3. Salva il file come `whatsapp-agent/firebase-service-account.json`  
   *oppure* copia il contenuto JSON nella variabile `FIREBASE_SERVICE_ACCOUNT_JSON` del `.env`

> ⚠️ Non committare mai questo file. È già in `.gitignore`.

---

## 3. Avviare OpenWA

OpenWA è il server che gestisce la sessione WhatsApp Web.

```bash
# Dalla cartella OpenWA-main
cp .env.minimal .env
# Modifica .env: imposta API_MASTER_KEY con una chiave sicura
npm install
npm run start:dev
```

OpenWA sarà disponibile su `http://localhost:2785`.  
Il dashboard è su `http://localhost:2886`.

---

## 4. Creare la sessione WhatsApp

### Via Dashboard (raccomandato)

1. Apri `http://localhost:2886`
2. Accedi con la master key
3. Clicca **New Session** → nome `default`
4. Scansiona il QR code con WhatsApp sul tuo telefono
5. Aspetta lo stato **Ready**

### Via API

```bash
curl -X POST http://localhost:2785/api/sessions \
  -H "X-API-Key: your-master-key" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "default"}'
```

---

## 5. Registrare il webhook su OpenWA

Questo dice a OpenWA di inviare ogni messaggio ricevuto al tuo server.

```bash
curl -X POST http://localhost:2785/api/sessions/default/webhooks \
  -H "X-API-Key: your-openwa-master-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:3100/webhook",
    "events": ["message.received"],
    "secret": "il-tuo-WEBHOOK_SECRET-dal-env"
  }'
```

> **Nota**: se OpenWA è in Docker e `whatsapp-agent` gira sull'host,  
> usa `http://host.docker.internal:3100/webhook` invece di `localhost`.

---

## 6. Trovare il tuo ALLOWED_CHAT_ID

Il formato è `{prefisso internazionale}{numero}@c.us`.

Esempio per numero italiano `333 1234567`:
```
ALLOWED_CHAT_ID=393331234567@c.us
```

Puoi anche controllare i log del server: quando arriva un messaggio,
viene loggato il `chatId` del mittente.

---

## 7. Avviare whatsapp-agent

```bash
# Produzione
npm start

# Sviluppo (riavvio automatico)
npm run dev
```

Il server ascolta su `http://localhost:3100`.

---

## Esempi di messaggi supportati

### Spese

```
spesa 12,50 bar colazione nico cibo
uscita 45 benzina nico viaggi
pagato netflix 17,99 nico abbonamenti
sigarette 8 nico
ho speso 8 euro pranzo nico cibo
```

### Entrate

```
incassato 300 da Pasticceria Rossi inlab fattura nico
entrata 120 sito web nico fattura
```

### Investimenti

```
aggiungi 50 etf
comprato 100 bitcoin trade
```

### Conversazione guidata

Se mancano informazioni, il bot chiede:

```
Tu:  spesa 12,50 bar colazione
Bot: È per 1. Nico o 2. Inlab?
Tu:  1
Bot: Che categoria uso?
     1. Necessità
     2. Extra
     ...
Tu:  cibo
Bot: Ho capito: spesa 12,50€ · bar colazione · NICO · Cibo · 2026-06-16
     Confermo? Rispondi sì per registrare, no per annullare.
Tu:  sì
Bot: ✅ Registrato: Spesa 12,50€ · bar colazione · NICO · Cibo
```

---

## Struttura file

```
whatsapp-agent/
├── server.js          # Express server, webhook receiver, orchestratore
├── firebaseAdmin.js   # Init Firebase Admin SDK
├── openwaClient.js    # Invia messaggi WhatsApp via OpenWA REST API
├── parser.js          # NLP italiano → ParseResult
├── bilancioWriter.js  # Scrivi/leggi Firestore (transazioni + pending)
├── package.json
├── .env.example
└── README.md
```

---

## Collezioni Firestore usate

| Collezione | Scopo |
|---|---|
| `bilancio/nico` | Documento principale dell'app (transactions, assets...) |
| `whatsapp_processed_messages` | Idempotenza: messaggi già elaborati |
| `whatsapp_pending` | Conversazioni incomplete in attesa di risposta |

---

## Variabili d'ambiente

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | * | JSON service account inline |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | * | Path al file JSON (alternativa) |
| `FIREBASE_PROJECT_ID` | ✅ | ID progetto Firebase |
| `OPENWA_API_URL` | ✅ | URL base OpenWA (es. `http://localhost:2785`) |
| `OPENWA_API_KEY` | ✅ | Master key OpenWA |
| `OPENWA_SESSION_ID` | — | Sessione OpenWA (default: `default`) |
| `WEBHOOK_SECRET` | raccomandato | Segreto HMAC per verifica firma |
| `REQUIRE_SIGNATURE` | — | `false` per disabilitare verifica firma |
| `ALLOWED_CHAT_ID` | raccomandato | Solo questo chatId viene processato |
| `PORT` | — | Porta server (default: `3100`) |

*Una delle due è richiesta.

---

## Sicurezza

- **HMAC-SHA256**: OpenWA firma ogni richiesta con il `secret` configurato. Il server verifica la firma prima di elaborare.
- **ALLOWED_CHAT_ID**: solo messaggi dal tuo numero vengono processati. Tutti gli altri vengono silenziosamente ignorati.
- **Idempotenza**: ogni messaggio WhatsApp ha un ID univoco. Se lo stesso messaggio arriva due volte (retry OpenWA), viene processato una sola volta.
- **Service Account**: le credenziali Firebase non sono mai nel codice.

---

## Troubleshooting

**Il bot non risponde**
- Controlla che OpenWA sia in stato `Ready` nel dashboard
- Verifica che il webhook sia registrato: `GET /api/sessions/default/webhooks`
- Controlla i log del server: `npm run dev`

**Firma non valida**
- Assicurati che `WEBHOOK_SECRET` nel `.env` corrisponda al `secret` del webhook in OpenWA
- In sviluppo puoi impostare `REQUIRE_SIGNATURE=false`

**Errore Firestore**
- Verifica che il service account abbia il ruolo `Cloud Datastore User`
- Controlla che `FIREBASE_PROJECT_ID` sia corretto
