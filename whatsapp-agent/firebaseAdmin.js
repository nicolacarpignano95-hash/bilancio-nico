// ═══════════════════════════════════════════════════
// firebaseAdmin.js — Firebase Admin SDK
// Usa service account da variabile d'ambiente, mai
// credenziali hardcoded nel codice.
// ═══════════════════════════════════════════════════
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let _db = null;

export function getDb() {
  if (_db) return _db;

  if (admin.apps.length === 0) {
    let credential;

    // Opzione 1: JSON inline in env (es. su Railway/Render)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      credential = admin.credential.cert(sa);
    }
    // Opzione 2: path al file .json
    else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const saPath = resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      const sa = JSON.parse(readFileSync(saPath, 'utf8'));
      credential = admin.credential.cert(sa);
    }
    else {
      throw new Error(
        'Firebase: definisci FIREBASE_SERVICE_ACCOUNT_JSON o FIREBASE_SERVICE_ACCOUNT_PATH nel .env'
      );
    }

    admin.initializeApp({
      credential,
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }

  _db = admin.firestore();
  return _db;
}
