// ═══════════════════════════════════════════════════
// ISTRUZIONI: modifica app.js in 3 punti
// ═══════════════════════════════════════════════════
//
// ① INIZIO FILE — sostituisci le prime 2 righe:
//
//   PRIMA:
//     const Chart = window.Chart;
//     const STORAGE_KEY = 'bilancio_nico_v3';
//
//   DOPO:
//     import Chart from 'chart.js/auto';
//     import { initDB, saveState as dbSave } from './db.js';
//     const STORAGE_KEY = 'bilancio_nico_v3'; // tenuto solo come fallback
//
// ─────────────────────────────────────────────────────────────────────────────
//
// ② FUNZIONE saveState — sostituiscila interamente:
//
//   PRIMA:
//     const saveState = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
//
//   DOPO:
//     const saveState = () => dbSave(state);
//
// ─────────────────────────────────────────────────────────────────────────────
//
// ③ FUNZIONE loadState — sostituiscila interamente:
//
//   PRIMA:
//     const loadState = () => {
//       const raw = localStorage.getItem(STORAGE_KEY);
//       if(!raw) return;
//       const saved = JSON.parse(raw);
//       state = {...state, ...saved};
//       ...
//     };
//
//   DOPO: (rimuovi loadState completamente — viene gestita da initDB)
//
// ─────────────────────────────────────────────────────────────────────────────
//
// ④ BOOT — sostituisci il blocco finale:
//
//   PRIMA:
//     window.addEventListener('DOMContentLoaded',()=>{
//       loadState();
//       runPacSync();
//       render('home');
//     });
//
//   DOPO:
//     window.addEventListener('DOMContentLoaded', async () => {
//       // Mostra schermata di caricamento
//       document.getElementById('app').innerHTML = `
//         <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
//                     height:100vh;gap:16px;font-family:var(--font-body);">
//           <div style="font-size:28px;">💸</div>
//           <div style="font-size:14px;color:#888;font-weight:600;">Caricamento dati...</div>
//         </div>`;
//
//       // Inizializza Firebase e carica lo state
//       state = await initDB(state, (remoteState) => {
//         // Callback: arriva un aggiornamento da un altro dispositivo
//         state = remoteState;
//         runPacSync();
//         render(lastViewId);
//       });
//
//       runPacSync();
//       render('home');
//     });
//
// ═══════════════════════════════════════════════════
// FINE ISTRUZIONI
// ═══════════════════════════════════════════════════
