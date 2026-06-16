// ═══════════════════════════════════════════════════
// BILANCIO NICO v3 — FULL REWRITE
// ═══════════════════════════════════════════════════
import Chart from 'chart.js/auto';
import { initDB, saveState as dbSave } from './db.js';

let state = {
  transactions: [],
  taxes: [],
  clients: [],
  taxPayments: {},   // { year: [{id, date, amount, note}] }
  taxAccount: { balances: {} },
  filters: {
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    period: 'monthly',
    rangeFrom: 1,
    rangeTo: new Date().getMonth() + 1,
    compareYear: null,
  },
  txFilters: { kind: 'all', area: 'all', search: '' },
  settings: { savingsGoal: 10000 },
  expenseCategories: ['Necessità','Extra','Lavoro','Viaggi','Cibo','Salute','Casa','Abbonamenti'],
  lastPacSync: null,
  clientFilters: { clientSearch:'', clientArea:'all', clientPay:'all' },
  assets: {
    liquidInitial: 0,
    liquid: [
      { id: 'bbva',  name: 'BBVA',              balance: 0, color: '#000000' },
      { id: 'revo',  name: 'Revolut Vacanze',   balance: 0, color: '#374151' },
      { id: 'card',  name: 'Trade Republic Card',balance: 0, color: '#6b7280' },
      { id: 'post',  name: 'Postepay',           balance: 0, color: '#9ca3af' },
      { id: 'pp',    name: 'Paypal',             balance: 0, color: '#000000' },
      { id: 'ppf',   name: 'Paypal Fluo',        balance: 0, color: '#4b5563' },
      { id: 'cash',  name: 'Contanti',           balance: 0, color: '#1f2937' },
    ],
    invest: [
      { id:'etf',  name:'Azioni/ETF',    balance:0,color:'#000000',v1:0,v0:0,add:0,hist:[],rec:{amt:50,day:10,freq:'monthly'} },
      { id:'bond', name:'Bondora',       balance:0,color:'#374151',v1:0,v0:0,add:0,hist:[],rec:null },
      { id:'btc',  name:'Bitcoin Trade', balance:0,color:'#6b7280',v1:0,v0:0,add:0,hist:[],rec:null },
      { id:'trc',  name:'TR Crypto',     balance:0,color:'#000000',v1:0,v0:0,add:0,hist:[],rec:null },
      { id:'rc',   name:'Revolut Crypto',balance:0,color:'#4b5563',v1:0,v0:0,add:0,hist:[],rec:null },
    ]
  }
};

const MONTHS   = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre','Annuale'];
const MS_ABBR  = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

const app            = document.getElementById('app');
const modalContainer = document.getElementById('modal-container');

// ═══════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════
const fmt     = n => { const v = n || 0; return (v<0?'-':'')+'€\u202f'+Math.abs(v).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}); };
const pct     = n => (n>=0?'+':'')+(n||0).toFixed(1)+'%';
const round   = n => Math.round((n+Number.EPSILON)*100)/100;
const todayISO= () => new Date().toISOString().slice(0,10);
const fmtDate = d => d ? new Date(d).toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'}) : '';
const uid     = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const esc     = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const inPeriod = (tx, m, y) => {
  const d  = new Date(tx.date);
  const tM = d.getMonth()+1, tY = d.getFullYear();
  if(tY !== parseInt(y)) return false;
  const {period,rangeFrom,rangeTo} = state.filters;
  if(period==='annual' || parseInt(m)===13) return true;
  if(period==='range') return tM>=rangeFrom && tM<=rangeTo;
  return tM === parseInt(m);
};
const getPeriodLabel = () => {
  const {month,year,period,rangeFrom,rangeTo} = state.filters;
  if(period==='annual' || parseInt(month)===13) return `Annuale ${year}`;
  if(period==='range') return `${MS_ABBR[rangeFrom-1]} – ${MS_ABBR[rangeTo-1]} ${year}`;
  return `${MONTHS[month-1]} ${year}`;
};

const saveState = () => dbSave(state);

// ═══════════════════════════════════════════════════
// CONFRONTO ANNUALE — helper functions
// ═══════════════════════════════════════════════════
const getAvailableYears = () => {
  const years = new Set();
  state.transactions.forEach(t => years.add(new Date(t.date).getFullYear()));
  Object.keys(state.taxPayments||{}).forEach(y => years.add(parseInt(y)));
  return Array.from(years).sort((a,b)=>b-a);
};

const getCompareYear = () => {
  const cy = state.filters.compareYear;
  const y  = state.filters.year;
  if(cy && cy !== y) return cy;
  // Default: anno precedente
  const avail = getAvailableYears().filter(yr => yr < y);
  return avail.length ? avail[0] : null;
};

const calcYearStats = (year) => {
  const inc  = Array.from({length:12},(_,i)=>calcNicoIncome(i+1,year));
  const exp  = Array.from({length:12},(_,i)=>calcNicoExpenses(i+1,year));
  const totalInc = round(inc.reduce((s,v)=>s+v,0));
  const totalExp = round(exp.reduce((s,v)=>s+v,0));
  return { inc, exp, totalInc, totalExp, net: round(totalInc-totalExp) };
};

const pctDiff = (curr, prev) => {
  if(!prev || prev===0) return null;
  return round(((curr-prev)/Math.abs(prev))*100);
};

const renderDelta = (curr, prev, invert=false) => {
  if(prev===null || prev===undefined) return '';
  const d = pctDiff(curr, prev);
  if(d===null) return '';
  const positive = invert ? d<0 : d>=0;
  const color = positive ? 'var(--green)' : 'var(--red)';
  const arrow = d>=0 ? '↑' : '↓';
  return `<span style="font-size:11px;font-weight:800;color:${color};margin-left:6px;">${arrow} ${Math.abs(d).toFixed(1)}%</span>`;
};

const renderCompareSelector = (label='') => {
  const years = getAvailableYears();
  const cy = state.filters.compareYear;
  const y  = state.filters.year;
  const options = years.filter(yr=>yr!==y).map(yr=>
    `<option value="${yr}" ${cy===yr?'selected':''}>${yr}</option>`
  ).join('');
  return `<div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
    <span style="font-size:10px;font-weight:900;text-transform:uppercase;color:var(--muted);">Confronta con</span>
    <select class="filter-select" onchange="window.updateFilter('compareYear',parseInt(this.value))">
      <option value="">—</option>
      ${options}
    </select>
  </div>`;
};

// Render confronto mese vs stesso mese anno di confronto
const renderMonthComparison = (month, year) => {
  const cy = getCompareYear();
  if(!cy) return '';
  const inc1=calcNicoIncome(month,year), exp1=calcNicoExpenses(month,year), net1=round(inc1-exp1);
  const inc2=calcNicoIncome(month,cy),   exp2=calcNicoExpenses(month,cy),   net2=round(inc2-exp2);
  const dInc=pctDiff(inc1,inc2), dExp=pctDiff(exp1,exp2), dNet=pctDiff(net1,net2);
  const cols = [
    {label:'Entrate', curr:inc1, prev:inc2, d:dInc, color:'var(--green)', invert:false},
    {label:'Uscite',  curr:exp1, prev:exp2, d:dExp, color:'var(--red)',   invert:true},
    {label:'Netto',   curr:net1, prev:net2, d:dNet, color:net1>=0?'#000':'var(--red)', invert:false},
  ];
  return `<div class="card" style="margin-top:16px;padding:16px 20px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div class="card-title" style="margin-bottom:0;">Confronto vs ${MS_ABBR[month-1]} ${cy}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
      ${cols.map(c=>{
        const pos=c.invert?(c.d!==null&&c.d<0):(c.d!==null&&c.d>=0);
        const col=c.d===null?'var(--muted)':pos?'var(--green)':'var(--red)';
        const dHtml=c.d!==null?('<div style="font-size:11px;font-weight:800;color:'+col+';margin-top:3px;">'+(c.d>=0?'↑':'↓')+' '+Math.abs(c.d).toFixed(1)+'%</div>'):'';
        return '<div style="background:var(--sf);border-radius:10px;padding:12px;">'+
          '<div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:4px;">'+c.label+'</div>'+
          '<div style="font-family:Sora;font-size:16px;font-weight:800;">'+fmt(c.curr)+'</div>'+
          '<div style="font-size:11px;color:var(--muted);margin-top:2px;">'+fmt(c.prev)+' in '+cy+'</div>'+
          dHtml+'</div>';
      }).join('')}
    </div>
  </div>`;
};

// Render confronto annuale completo
const renderAnnualComparison = (year) => {
  const cy = getCompareYear();
  if(!cy) return `<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px;">Seleziona un anno da confrontare nella barra in alto</div>`;
  const s1 = calcYearStats(year);
  const s2 = calcYearStats(cy);
  const rows = [
    {label:'Entrate totali',  v1:s1.totalInc, v2:s2.totalInc, color:'var(--green)', invert:false},
    {label:'Uscite totali',   v1:s1.totalExp, v2:s2.totalExp, color:'var(--red)',   invert:true},
    {label:'Risparmio netto', v1:s1.net,      v2:s2.net,      color:s1.net>=0?'#000':'var(--red)', invert:false},
  ];
  const rowsHtml = rows.map(r=>{
    const d=pctDiff(r.v1,r.v2);
    const pos=r.invert?(d!==null&&d<0):(d!==null&&d>=0);
    const col=d===null?'var(--muted)':pos?'var(--green)':'var(--red)';
    const deltaHtml=d!==null?'<div style="font-size:11px;font-weight:800;color:'+col+';margin-top:3px;">'+( d>=0?'↑':'↓')+' '+Math.abs(d).toFixed(1)+'%</div>':'';
    return '<div style="border:1.5px solid var(--border);border-radius:10px;padding:14px;">'+
      '<div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:4px;">'+r.label+'</div>'+
      '<div style="font-family:Sora;font-size:18px;font-weight:800;color:'+r.color+';">'+fmt(r.v1)+'</div>'+
      '<div style="font-size:11px;color:var(--muted);margin-top:2px;">'+fmt(r.v2)+' nel '+cy+'</div>'+
      deltaHtml+'</div>';
  }).join('');
  const monthsHtml = Array.from({length:12},(_,i)=>{
    const inc1=s1.inc[i],exp1=s1.exp[i],net1=round(inc1-exp1);
    const inc2=s2.inc[i],exp2=s2.exp[i],net2=round(inc2-exp2);
    const dNet=pctDiff(net1,net2);
    const col=dNet===null?'var(--muted)':dNet>=0?'var(--green)':'var(--red)';
    if(inc1===0&&inc2===0) return '';
    const netDelta=dNet!==null?'<span style="font-size:10px;color:'+col+';">'+( dNet>=0?'↑':'↓')+' '+Math.abs(dNet).toFixed(1)+'%</span>':'';
    return '<div style="display:grid;grid-template-columns:80px repeat(3,1fr);gap:0;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.05);font-size:12px;">'+
      '<span style="font-weight:800;color:var(--muted);">'+MS_ABBR[i]+'</span>'+
      '<span>'+fmt(inc1)+'<br><span style="font-size:10px;color:var(--muted);">'+fmt(inc2)+'</span></span>'+
      '<span>'+fmt(exp1)+'<br><span style="font-size:10px;color:var(--muted);">'+fmt(exp2)+'</span></span>'+
      '<span style="font-weight:800;">'+fmt(net1)+'<br>'+netDelta+'</span>'+
      '</div>';
  }).join('');
  return `<div class="card" style="margin-top:16px;">
    <div class="card-title" style="margin-bottom:16px;">${year} vs ${cy} — Riepilogo annuale</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;">${rowsHtml}</div>
    <div class="card-title" style="margin-bottom:10px;">Mese per mese</div>
    <div style="display:grid;grid-template-columns:80px repeat(3,1fr);gap:0;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);padding-bottom:6px;border-bottom:1.5px solid #000;">
      <span>Mese</span><span>Entrate</span><span>Uscite</span><span>Netto</span>
    </div>
    ${monthsHtml}
  </div>`;
};

// Confronto asset singolo
const renderAssetComparison = (inv) => {
  const cy = getCompareYear();
  if(!cy) return '';
  const curYear = state.filters.year;
  // v1 del confronto = v0 (valore storico iniziale) se l'anno confrontato è precedente
  const v1cy = inv.v0 || inv.v1;
  const gainCur = round(inv.balance - inv.v1);
  const pctCur = inv.v1>0 ? round((gainCur/inv.v1)*100) : 0;
  return `<div class="card" style="margin-top:14px;">
    <div class="card-title" style="margin-bottom:12px;">Confronto ${curYear} vs ${cy}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div style="background:var(--sf);border-radius:10px;padding:12px;">
        <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:4px;">${curYear} — Valore attuale</div>
        <div style="font-family:'Sora';font-size:18px;font-weight:800;">${fmt(inv.balance)}</div>
        <div style="font-size:11px;margin-top:3px;color:${gainCur>=0?'var(--green)':'var(--red)'};">${gainCur>=0?'+':''}${fmt(gainCur)} (${pct(pctCur)})</div>
      </div>
      <div style="background:var(--sf);border-radius:10px;padding:12px;">
        <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:4px;">${cy} — Inizio anno</div>
        <div style="font-family:'Sora';font-size:18px;font-weight:800;">${fmt(v1cy)}</div>
        <div style="font-size:11px;margin-top:3px;color:var(--muted);">Valore di partenza</div>
      </div>
    </div>
  </div>`;
};



// ═══════════════════════════════════════════════════
// ASSET HELPERS
// ═══════════════════════════════════════════════════
const getLiquidTotal  = () => state.assets.liquid.reduce((s,a)=>s+(parseFloat(a.balance)||0),0);
const getInvestTotal  = () => state.assets.invest.reduce((s,a)=>s+(parseFloat(a.balance)||0),0);
const getWealthTotal  = () => round(getLiquidTotal()+getInvestTotal());
const getInvestById   = id => state.assets.invest.find(i=>i.id===id);

// ═══════════════════════════════════════════════════
// FINANCIAL CALCULATIONS
// ═══════════════════════════════════════════════════
const calcNicoIncome = (m,y) => {
  let inc=0;
  state.transactions.filter(t=>inPeriod(t,m,y)&&t.kind==='income').forEach(t=>{
    if (t.nicoIncome !== undefined) {
      inc += parseFloat(t.nicoIncome) || 0;
    } else {
      // Fallback for legacy data
      const g = parseFloat(t.gross) || 0;
      if (t.area === 'nico') {
        const tax = t.payMode === 'fatt' ? round(g * 0.25) : 0;
        inc += round(g - tax);
      } else if (t.area === 'inlab') {
        const tax = t.payMode === 'fatt' ? round(g * 0.25) : 0;
        inc += round((g - tax) * 0.5);
      }
    }
  });
  return round(inc);
};
const calcNicoExpenses = (m,y) => {
  let exp=0;
  state.transactions.filter(t=>inPeriod(t,m,y)&&t.kind==='expense').forEach(t=>{
    const g = parseFloat(t.gross) || 0;
    if(t.area==='nico') exp += g;
    else exp += round(g * 0.5);
  });
  return round(exp);
};
const calcNicoNet = (m,y) => round(calcNicoIncome(m,y)-calcNicoExpenses(m,y));

const calcInlabTotal = (m,y) => {
  let tot=0;
  state.transactions.filter(t=>inPeriod(t,m,y)&&t.kind==='income'&&t.area==='inlab').forEach(t=>tot+=parseFloat(t.gross)||0);
  return round(tot);
};
const calcInlabExpenses = (m,y) => {
  let tot=0;
  state.transactions.filter(t=>inPeriod(t,m,y)&&t.kind==='expense'&&t.area==='inlab').forEach(t=>tot+=parseFloat(t.gross)||0);
  return round(tot);
};

// Inlab balance sheet: chi deve cosa a chi
const calcInlabBalance = (m,y) => {
  // "debito" = quanto Nico deve a Ilaria (positivo = Nico deve, negativo = Ilaria deve a Nico)
  let debito = 0;

  let nicoSpetta=0, ilariaSpetta=0, nicoHaInc=0, ilariaHaInc=0, nicoHaDato=0, ilariaHaDato=0;
  let inlabExp = 0;

  // 1. ENTRATE INLAB
  state.transactions.filter(t=>inPeriod(t,m,y)&&t.kind==='income'&&t.area==='inlab').forEach(t=>{
    let nInc = t.nicoIncome;
    let iInc = t.ilariaIncome;
    
    // Fallback for legacy data
    if (nInc === undefined || iInc === undefined) {
      const g = parseFloat(t.gross) || 0;
      const tax = t.payMode === 'fatt' && t.collector === 'nico' ? round(g * 0.25) : 0;
      const net = round(g - tax);
      nInc = round(net * 0.5);
      iInc = round(net * 0.5);
    }
    
    nicoSpetta   += nInc;
    ilariaSpetta += iInc;

    if(t.collector==='nico'){
      nicoHaInc += parseFloat(t.gross)||0;
      debito += iInc;
      debito -= (parseFloat(t.transferToOther) || 0); // Nico ha già dato parte di questa entrata a Ilaria
    } else if(t.collector==='ilaria'){
      ilariaHaInc += parseFloat(t.gross)||0;
      debito -= nInc;
      debito += (parseFloat(t.transferToOther) || 0); // Ilaria ha già dato parte di questa entrata a Nico
    }
  });

  // 2. SPESE INLAB
  state.transactions.filter(t=>inPeriod(t,m,y)&&t.kind==='expense'&&t.area==='inlab').forEach(t=>{
    const g = parseFloat(t.gross)||0;
    inlabExp += g;
    const half = round(g*0.5);
    if(t.paidBy==='nico'){
      debito -= half;
    } else if(t.paidBy==='ilaria'){
      debito += half;
    }
  });

  // 3. TRASFERIMENTI
  state.transactions.filter(t=>inPeriod(t,m,y)&&t.kind==='transfer').forEach(t=>{
    const g = parseFloat(t.gross)||0;
    if(t.from==='nico'){
      nicoHaDato += g;
      debito -= g;
    } else if(t.from==='ilaria'){
      ilariaHaDato += g;
      debito += g;
    }
  });

  debito = round(debito);
  const nicoExpShare = round(inlabExp * 0.5);
  const ilariaExpShare = round(inlabExp * 0.5);

  return {
    nicoSpetta:   round(nicoSpetta),
    ilariaSpetta:  round(ilariaSpetta),
    nicoShare:    round(nicoSpetta - nicoExpShare),
    ilariaShare:  round(ilariaSpetta - ilariaExpShare),
    nicoHaInc, ilariaHaInc,
    nicoHaDato, ilariaHaDato,
    saldo: debito
  };
};

const calcClientStatus = clientId => {
  const c = state.clients.find(c=>c.id===clientId);
  if(!c) return {paid:0,missing:0};
  const paid = state.transactions.filter(t=>t.clientId===clientId).reduce((s,t)=>s+(parseFloat(t.gross)||0),0);
  return {paid, missing:round(c.expectedAmount-paid)};
};

// Stipendio stimato (sum of all active clients as if fully paid)
const calcStipendioStimato = () => {
  let tot = 0;
  state.clients.filter(c=>c && c.active).forEach(c => {
    const monthly = parseFloat(c.monthlyAmount) || parseFloat(c.expectedAmount) || 0;
    if(c.area==='nico') {
      tot += c.payMode==='fatt' ? round(monthly * 0.75) : monthly;
    } else if(c.area==='inlab') {
      const net = c.payMode==='fatt' ? round(monthly * 0.75) : monthly;
      tot += round(net * 0.5);
    }
  });
  return round(tot);
};

// Tax accrual for a year
const calcTaxAccrual = y => {
  return round(
    state.transactions
      .filter(t=>t.kind==='income' && new Date(t.date).getFullYear()===parseInt(y))
      .reduce((s,t)=>s+(t.nicoTax||0),0)
  );
};
const calcTaxPaid = y => {
  const payments = state.taxPayments[y] || [];
  return round(payments.reduce((s,p)=>s+(parseFloat(p.amount)||0),0));
};

// ═══════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════
const charts = {};
const destroyChart = id => { if(charts[id]){charts[id].destroy();delete charts[id];} };

const initWealthPie = () => {
  const ctx = document.getElementById('pie-wealth');
  if(!ctx) return;
  destroyChart('pie-wealth');
  const liqColor = state.assets.liquid[0]?.color||'#000000';
  charts['pie-wealth'] = new Chart(ctx, {
    type:'doughnut',
    data:{
      labels:['Liquidità',...state.assets.invest.map(i=>i.name)],
      datasets:[{
        data:[getLiquidTotal(),...state.assets.invest.map(i=>i.balance)],
        backgroundColor:[liqColor,...state.assets.invest.map(i=>i.color)],
        borderWidth:2, borderColor:'#ffffff'
      }]
    },
    options:{responsive:false,cutout:'72%',plugins:{legend:{display:false}}}
  });
};

const initInvestHistoryChart = id => {
  const inv = getInvestById(id);
  const ctx = document.getElementById('invest-history-chart');
  if(!inv||!ctx) return;
  destroyChart('invest-history-chart');
  const now=new Date(), curM=now.getMonth(), curY=now.getFullYear();
  const labels=MS_ABBR.slice(0,curM+1);
  let runAdd=0;
  const investedPoints=labels.map((_,m)=>{
    const added=(inv.hist||[]).filter(h=>{const d=new Date(h.date);return d.getMonth()===m&&d.getFullYear()===curY;}).reduce((s,h)=>{
      const val = parseFloat(h.amt)||0;
      return s + (h.kind==='rem' ? -val : val);
    },0);
    runAdd+=added; return round((parseFloat(inv.v1)||0)+runAdd);
  });
  const v1 = parseFloat(inv.v1)||0;
  const bal = parseFloat(inv.balance)||0;
  const totalPoints=labels.map((_,m)=>{
    if(m===0) return v1;
    if(m===curM) return bal;
    return round(v1+(bal-v1)*(m/curM));
  });
  charts['invest-history-chart']=new Chart(ctx,{
    type:'line',
    data:{labels,datasets:[
      {label:'Valore totale',data:totalPoints,borderColor:'#000000',backgroundColor:'rgba(0,0,0,0.05)',fill:true,tension:0.4,pointRadius:4,pointBackgroundColor:'#000000',borderWidth:2.5},
      {label:'Capitale proprio',data:investedPoints,borderColor:'#9ca3af',borderDash:[5,5],tension:0.4,fill:false,pointRadius:2,pointBackgroundColor:'#fff',borderWidth:2}
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:'index'},
      plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:12,usePointStyle:true,font:{size:10,weight:'800'},color:'#000'}},
        tooltip:{backgroundColor:'#000000',titleFont:{size:12,weight:'900'},bodyFont:{size:11,weight:'700'},padding:12,cornerRadius:8,displayColors:true,callbacks:{label:c=>` ${c.dataset.label}: ${fmt(c.raw)}`}}
      },
      scales:{y:{ticks:{callback:v=>'€'+(v>=1000?(v/1000).toFixed(0)+'k':v),font:{size:10,weight:'800'},color:'#6b7280'},grid:{borderDash:[2,2],color:'rgba(0,0,0,0.05)',drawBorder:false}},
              x:{grid:{display:false},ticks:{font:{size:10,weight:'800'},color:'#6b7280'}}}
    }
  });
};

const initEvolutionChart = () => {
  const ctx=document.getElementById('evolution-chart');
  if(!ctx) return;
  destroyChart('evolution-chart');
  const tot=getWealthTotal();
  const history=MS_ABBR.map((_,i)=>({v:tot-(11-i)*120}));
  charts['evolution-chart']=new Chart(ctx,{
    type:'line',
    data:{labels:MS_ABBR,datasets:[{data:history.map(h=>h.v),borderColor:'#000000',backgroundColor:'rgba(0,0,0,0.05)',fill:true,tension:0.4,pointRadius:0,borderWidth:2.5}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{display:false},x:{grid:{display:false},ticks:{font:{size:10,weight:'800'},color:'#6b7280'}}}}
  });
};

// ═══════════════════════════════════════════════════
// UI — APP + NAV (Desktop Layout)
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// STATE — add debts array
// ═══════════════════════════════════════════════════
// Debts are stored in state.debts: [{id, name, amount, date, note, settled}]

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

// Insoluti per mese: ogni cliente attivo × ogni mese passato dove non ha pagato
const getMonthlyOutstanding = () => {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  const items = [];

  state.clients.filter(c => c.active && c.recurring).forEach(c => {
    // Check every month from jan of first transaction year to current month
    const startYear = 2024;
    for (let y = startYear; y <= curY; y++) {
      const maxM = y === curY ? curM : 12;
      for (let m = 1; m <= maxM; m++) {
        // How much paid for this client in this month?
        const paid = state.transactions
          .filter(t => t.clientId === c.id && t.kind === 'income')
          .filter(t => { const d = new Date(t.date); return d.getFullYear() === y && d.getMonth()+1 === m; })
          .reduce((s, t) => s + (parseFloat(t.gross)||0), 0);
        const expected = parseFloat(c.monthlyAmount || c.expectedAmount) || 0;
        if (paid < expected - 0.01) {
          items.push({ client: c, month: m, year: y, paid, missing: round(expected - paid) });
        }
      }
    }
  });

  // Sort: most recent first
  items.sort((a, b) => (b.year*12+b.month) - (a.year*12+a.month));
  return items;
};

const getDebts = () => (state.debts || []).filter(d => !d.settled);

const calcNicoAnnual = (year) => {
  const inc = calcNicoIncome(13, year);
  const exp = calcNicoExpenses(13, year);
  return { inc, exp, net: round(inc - exp) };
};

// Bar chart HTML (no numbers, visual only)
const renderBarChart = (data, height=80) => {
  const maxVal = Math.max(...data.map(d => Math.max(d.inc||0, d.exp||0)), 1);
  return data.map(d => {
    const incH = Math.round(((d.inc||0)/maxVal)*(height-4));
    const expH = Math.round(((d.exp||0)/maxVal)*(height-4));
    return '<div class="bar-col">'+
      '<div style="display:flex;flex-direction:column;justify-content:flex-end;height:'+height+'px;gap:1px;">'+
        '<div class="bar-inc" style="height:'+incH+'px;"></div>'+
        '<div class="bar-exp" style="height:'+expH+'px;"></div>'+
      '</div>'+
      '<div class="bar-label">'+d.label+'</div>'+
    '</div>';
  }).join('');
};

// Category chart for expenses
const renderCategoryBars = (month, year) => {
  const txs = state.transactions.filter(t => {
    if (t.kind !== 'expense') return false;
    const d = new Date(t.date);
    if (year && d.getFullYear() !== year) return false;
    if (month && month !== 13 && d.getMonth()+1 !== month) return false;
    return true;
  });
  const cats = {};
  txs.forEach(t => {
    const cat = t.category || 'Altro';
    cats[cat] = (cats[cat]||0) + (parseFloat(t.gross)||0);
  });
  const sorted = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if (!sorted.length) return '<div class="empty">Nessuna spesa</div>';
  const max = sorted[0][1];
  return sorted.map(([cat, amt]) => {
    const pctW = Math.round((amt/max)*100);
    return '<div style="margin-bottom:8px;">'+
      '<div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin-bottom:3px;">'+
        '<span>'+esc(cat)+'</span>'+
        '<span style="color:var(--red);font-weight:800;">'+fmt(amt)+'</span>'+
      '</div>'+
      '<div style="background:#f3f4f6;border-radius:999px;height:5px;overflow:hidden;">'+
        '<div style="width:'+pctW+'%;height:100%;background:var(--red);border-radius:999px;"></div>'+
      '</div>'+
    '</div>';
  }).join('');
};

// ═══════════════════════════════════════════════════
// SHELL + NAV
// ═══════════════════════════════════════════════════

const ensureShell = () => {
  if (document.getElementById('app-shell')) return;
  app.innerHTML = `
    <div class="app-shell" id="app-shell">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="main-content" id="main-content">
        <div id="top-bar-slot"></div>
        <div id="page-slot" style="flex:1;min-height:0;overflow-y:auto;"></div>
      </div>
    </div>`;
};

const NAV_ITEMS = [
  { id:'home',      label:'Home',        icon:'⌂', section: null },
  { id:'nico',      label:'Nico',        icon:'◉', section: 'Analisi' },
  { id:'inlab',     label:'Inlab',       icon:'◎', section: null },
  { id:'assets',    label:'Patrimonio',  icon:'◈', section: null },
  { id:'movements', label:'Movimenti',   icon:'☰', section: 'Gestione' },
  { id:'clients',   label:'Clienti',     icon:'👥', section: null },
  { id:'taxes',     label:'Tasse',       icon:'%', section: null },
];

const renderSidebar = activeId => {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  let html = '<div class="sidebar-logo">Bilancio <span>Nico</span></div>';
  let lastSec = null;
  NAV_ITEMS.forEach(it => {
    if (it.section && it.section !== lastSec) {
      html += '<div class="sidebar-section-label">'+it.section+'</div>';
      lastSec = it.section;
    }
    html += '<button class="nav-item '+(activeId===it.id?'active':'')+'" onclick="window.render(\''+it.id+'\')">'+
      '<span class="nav-icon">'+it.icon+'</span> '+it.label+'</button>';
  });
  html += '<div class="sidebar-actions">'+
    '<button class="btn-sidebar-action income" onclick="window.openIncomeModal()">＋ Entrata</button>'+
    '<button class="btn-sidebar-action expense" onclick="window.openExpenseModal()">－ Uscita</button>'+
  '</div>';
  sb.innerHTML = html;
};

const renderMobileNav = activeId => {
  document.querySelector('.bottom-nav-mobile')?.remove();
  const items = [{id:'home',label:'Home',icon:'⌂'},{id:'nico',label:'Nico',icon:'◉'},{id:'clients',label:'Clienti',icon:'👥'},{id:'assets',label:'Patrimonio',icon:'◈'}];
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav-mobile';
  nav.innerHTML = items.map(it=>'<button class="nav-btn-mobile '+(activeId===it.id?'active':'')+'" onclick="window.render(\''+it.id+'\')"><span style="font-size:18px;">'+it.icon+'</span><span>'+it.label+'</span></button>').join('');
  document.body.appendChild(nav);
};

// Top bar: only shows for non-home views
const renderTopBar = (viewId, pageLabel) => {
  const slot = document.getElementById('top-bar-slot');
  if (!slot) return;
  if (viewId === 'home') { slot.innerHTML = ''; return; }
  const {month,year,period,rangeFrom,rangeTo} = state.filters;
  const availYears = getAvailableYears();
  const yearOpts = availYears.map(y=>'<option value="'+y+'" '+(year===y?'selected':'')+'>'+y+'</option>').join('');
  const monthOpts = MONTHS.slice(0,12).map((n,i)=>'<option value="'+(i+1)+'" '+(month===i+1?'selected':'')+'>'+n+'</option>').join('');
  const cmpOpts = availYears.filter(y=>y!==year).map(y=>'<option value="'+y+'" '+(state.filters.compareYear===y?'selected':'')+'>'+y+'</option>').join('');

  slot.innerHTML = '<div class="top-bar">'+
    (pageLabel?'<span class="top-bar-label">'+pageLabel+'</span><div style="width:1px;height:18px;background:var(--border);"></div>':'')+
    '<div class="period-chips">'+
      '<button class="chip '+(period==='monthly'?'active':'')+'" onclick="window.updatePeriodType(\'monthly\')">Mese</button>'+
      '<button class="chip '+(period==='annual'?'active':'')+'" onclick="window.updatePeriodType(\'annual\')">Anno</button>'+
      '<button class="chip '+(period==='range'?'active':'')+'" onclick="window.updatePeriodType(\'range\')">Range</button>'+
    '</div>'+
    (period==='monthly'?'<select class="filter-select" onchange="window.updateFilter(\'month\',this.value)">'+monthOpts+'</select>':'')+
    (period==='range'?
      '<select class="filter-select" onchange="window.updateFilter(\'rangeFrom\',this.value)">'+MS_ABBR.map((n,i)=>'<option value="'+(i+1)+'" '+(rangeFrom===i+1?'selected':'')+'>'+n+'</option>').join('')+'</select>'+
      '<span style="font-size:10px;color:var(--muted);font-weight:800;">→</span>'+
      '<select class="filter-select" onchange="window.updateFilter(\'rangeTo\',this.value)">'+MS_ABBR.map((n,i)=>'<option value="'+(i+1)+'" '+(rangeTo===i+1?'selected':'')+'>'+n+'</option>').join('')+'</select>':'')+
    '<select class="filter-select" onchange="window.updateFilter(\'year\',this.value)">'+yearOpts+'</select>'+
    '<div style="margin-left:auto;display:flex;align-items:center;gap:6px;">'+
      '<span style="font-size:9px;font-weight:900;text-transform:uppercase;color:var(--muted);">vs</span>'+
      '<select class="filter-select" onchange="window.updateFilter(\'compareYear\',parseInt(this.value)||null)">'+
        '<option value="">—</option>'+cmpOpts+
      '</select>'+
    '</div>'+
  '</div>';
};

let lastViewId = 'home';

const render = (viewId='home') => {
  lastViewId = viewId;
  ensureShell();
  renderSidebar(viewId);
  renderMobileNav(viewId);
  const slot = document.getElementById('page-slot');
  if (!slot) return;
  const labels = {home:'',nico:'Nico',inlab:'Inlab',assets:'Patrimonio',movements:'Movimenti',clients:'Clienti',taxes:'Tasse','nico-incomes':'Entrate','nico-expenses':'Uscite','invest-detail':'Investimento'};
  renderTopBar(viewId, labels[viewId]||'');
  if      (viewId==='home')          renderHomeView(slot);
  else if (viewId==='nico')          renderNicoView(slot);
  else if (viewId==='inlab')         renderInlabView(slot);
  else if (viewId==='assets')        renderAssetsView(slot);
  else if (viewId==='invest-detail') renderInvestDetail(slot);
  else if (viewId==='movements')     renderMovementsView(slot);
  else if (viewId==='clients')       renderClientsView(slot);
  else if (viewId==='taxes')         renderTaxesView(slot);
  else if (viewId==='nico-incomes')  renderNicoIncomesView(slot);
  else if (viewId==='nico-expenses') renderNicoExpensesView(slot);
};

// ═══════════════════════════════════════════════════
// HOME VIEW
// ═══════════════════════════════════════════════════
const renderHomeView = (slot) => {
  const now = new Date();
  const curM = now.getMonth()+1, curY = now.getFullYear();
  const annual = calcNicoAnnual(curY);
  const tot = getWealthTotal();
  const stipendio = calcStipendioStimato();
  const resparmioAnnuo = annual.net;

  // Bar chart: last 12 months
  const barData = [];
  for (let i=11; i>=0; i--) {
    const d = new Date(curY, curM-1-i, 1);
    const m = d.getMonth()+1, y = d.getFullYear();
    barData.push({ label: MS_ABBR[d.getMonth()], inc: calcNicoIncome(m,y), exp: calcNicoExpenses(m,y) });
  }

  // Outstanding: monthly list
  const outstanding = getMonthlyOutstanding().slice(0,6);
  const debts = getDebts().slice(0,3);
  const totalOutstanding = getMonthlyOutstanding().reduce((s,i)=>s+i.missing,0);
  const totalDebts = getDebts().reduce((s,d)=>s+(parseFloat(d.amount)||0),0);

  slot.innerHTML = `<div class="page fade-up">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div>
        <div style="font-family:'Sora';font-size:18px;font-weight:800;letter-spacing:-.03em;color:#000;">Panoramica ${curY}</div>
        <div style="font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;">${MONTHS[curM-1]} ${curY} in corso</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn-primary" onclick="window.openIncomeModal()">＋ Entrata</button>
        <button class="btn-ghost" onclick="window.openExpenseModal()">－ Uscita</button>
      </div>
    </div>

    <!-- KPI row -->
    <div class="grid-4" style="margin-bottom:16px;">
      <div class="kpi-card" style="border-left:3px solid #000;">
        <div class="kpi-label">Netto Annuale</div>
        <div class="kpi-val" style="color:${annual.net>=0?'#000':'var(--red)'};">${fmt(annual.net)}</div>
        <div class="kpi-delta">${fmt(annual.inc)} entrate · ${fmt(annual.exp)} uscite</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid var(--green);cursor:pointer;" onclick="window.render('assets')">
        <div class="kpi-label">Patrimonio</div>
        <div class="kpi-val" style="color:var(--green);">${fmt(tot)}</div>
        <div class="kpi-delta">Liquidità + Investimenti</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid var(--blue);cursor:pointer;" onclick="window.render('clients')">
        <div class="kpi-label">Stipendio Stimato</div>
        <div class="kpi-val" style="color:var(--blue);">${fmt(stipendio)}</div>
        <div class="kpi-delta">Clienti attivi × quota</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid ${resparmioAnnuo>=0?'var(--green)':'var(--red)'};">
        <div class="kpi-label">Risparmio Annuale</div>
        <div class="kpi-val" style="color:${resparmioAnnuo>=0?'var(--green)':'var(--red)'};">${fmt(resparmioAnnuo)}</div>
        <div class="kpi-delta">${resparmioAnnuo>=0?'In attivo':'In passivo'} quest\'anno</div>
      </div>
    </div>

    <!-- Two columns -->
    <div class="two-panel">
      <!-- LEFT: chart -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <div>
            <div class="card-title" style="margin-bottom:2px;">Andamento mensile</div>
            <div style="display:flex;gap:10px;">
              <div style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:var(--muted);">
                <span style="width:8px;height:8px;border-radius:2px;background:var(--green);display:inline-block;"></span>Entrate
              </div>
              <div style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:var(--muted);">
                <span style="width:8px;height:8px;border-radius:2px;background:var(--red);display:inline-block;"></span>Uscite
              </div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:9px;font-weight:800;color:var(--muted);text-transform:uppercase;">${MONTHS[curM-1]}</div>
            <div style="font-family:'Sora';font-size:18px;font-weight:800;color:${calcNicoNet(curM,curY)>=0?'var(--green)':'var(--red)'};">${fmt(calcNicoNet(curM,curY))}</div>
          </div>
        </div>
        <div class="bar-chart">${renderBarChart(barData,80)}</div>

        <!-- Month summary row -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid rgba(0,0,0,0.05);">
          ${[{l:'Entrate',v:calcNicoIncome(curM,curY),c:'var(--green)'},{l:'Uscite',v:calcNicoExpenses(curM,curY),c:'var(--red)'},{l:'Netto mese',v:calcNicoNet(curM,curY),c:calcNicoNet(curM,curY)>=0?'var(--green)':'var(--red)'},{l:'Netto anno',v:annual.net,c:annual.net>=0?'#000':'var(--red)'}].map(x=>
            '<div><div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:2px;">'+x.l+'</div>'+
            '<div style="font-family:\'Sora\';font-size:15px;font-weight:800;color:'+x.c+';">'+fmt(x.v)+'</div></div>'
          ).join('')}
        </div>
      </div>

      <!-- RIGHT: outstanding + debts -->
      <div>
        <div class="card" style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div class="card-title" style="margin-bottom:0;">Da incassare</div>
            <div style="display:flex;gap:6px;">
              <button class="btn-ghost" style="font-size:10px;padding:4px 8px;" onclick="window.openAddDebtModal()">＋ Debito</button>
              <button class="btn-ghost" style="font-size:10px;padding:4px 8px;" onclick="window.render('clients')">Vedi tutti</button>
            </div>
          </div>
          <div style="font-family:'Sora';font-size:22px;font-weight:800;color:var(--red);margin-bottom:12px;">${fmt(totalOutstanding+totalDebts)}</div>
          <div class="tx-list">
            ${outstanding.length===0&&debts.length===0?'<div class="empty" style="padding:16px 0;">✨ Tutto in regola</div>':''}
            ${outstanding.map(item=>{
              const netto = item.client.payMode==='fatt' ? round(item.missing*0.75) : item.missing;
              return '<div class="tx-item">'+
                '<div class="tx-dot" style="background:var(--amber);"></div>'+
                '<div class="tx-info">'+
                  '<div class="tx-label">'+esc(item.client.name)+'</div>'+
                  '<div class="tx-meta">'+MS_ABBR[item.month-1]+' '+item.year+' · '+(item.client.payMode==='fatt'?'Fattura':'Contanti')+'</div>'+
                '</div>'+
                '<div style="display:flex;align-items:center;gap:6px;">'+
                  '<div style="text-align:right;">'+
                    '<div style="font-size:12px;font-weight:800;color:var(--red);">-'+fmt(item.missing)+'</div>'+
                  '</div>'+
                  '<button onclick="window.markClientPaid(\''+item.client.id+'\','+item.month+','+item.year+','+item.missing+')" style="background:var(--green);border:none;color:#fff;border-radius:5px;font-size:9px;font-weight:800;padding:3px 6px;cursor:pointer;white-space:nowrap;">Pagato</button>'+
                  '<button onclick="window.markClientSettled(\''+item.client.id+'\','+item.month+','+item.year+')" style="background:var(--muted);border:none;color:#fff;border-radius:5px;font-size:9px;font-weight:800;padding:3px 6px;cursor:pointer;">✓</button>'+
                '</div>'+
              '</div>';
            }).join('')}
            ${debts.map(d=>
              '<div class="tx-item">'+
                '<div class="tx-dot" style="background:var(--purple);"></div>'+
                '<div class="tx-info">'+
                  '<div class="tx-label">'+esc(d.name)+'</div>'+
                  '<div class="tx-meta">Debito · '+fmtDate(d.date)+(d.note?' · '+esc(d.note):'')+'</div>'+
                '</div>'+
                '<div style="display:flex;align-items:center;gap:6px;">'+
                  '<div style="font-size:12px;font-weight:800;color:var(--purple);">'+fmt(d.amount)+'</div>'+
                  '<button onclick="window.settleDebt(\''+d.id+'\')" style="background:var(--purple);border:none;color:#fff;border-radius:5px;font-size:9px;font-weight:800;padding:3px 6px;cursor:pointer;">Saldato</button>'+
                '</div>'+
              '</div>'
            ).join('')}
          </div>
        </div>
      </div>
    </div>
  </div>`;
};

// ═══════════════════════════════════════════════════
// NICO VIEW — solo flusso di cassa
// ═══════════════════════════════════════════════════
const renderNicoView = (slot) => {
  const {month,year,period} = state.filters;
  const inc = calcNicoIncome(month,year);
  const exp = calcNicoExpenses(month,year);
  const net = round(inc-exp);
  const goal = state.settings.savingsGoal||10000;
  const gp = Math.min(100,Math.max(0,(net/goal)*100));
  const label = getPeriodLabel();

  // Monthly bar data for the year
  const barData = MS_ABBR.map((l,i)=>({label:l,inc:calcNicoIncome(i+1,year),exp:calcNicoExpenses(i+1,year)}));

  // Category breakdown
  const catHtml = renderCategoryBars(month,year);

  // Recent clients this period
  const clientsTx = state.clients.filter(c=>c.active).map(c=>{
    const paid = state.transactions.filter(t=>t.clientId===c.id&&inPeriod(t,month,year)).reduce((s,t)=>s+(parseFloat(t.gross)||0),0);
    return {c,paid};
  }).filter(x=>x.paid>0).sort((a,b)=>b.paid-a.paid);

  slot.innerHTML = `<div class="page fade-up">
    <div class="page-header">
      <div class="page-title">Nico — Flusso di cassa</div>
      <div class="page-sub">${label}</div>
    </div>

    <!-- KPI -->
    <div class="grid-3" style="margin-bottom:16px;">
      <div class="kpi-card" style="border-left:3px solid var(--green);cursor:pointer;" onclick="window.render('nico-incomes')">
        <div class="kpi-label">Entrate</div>
        <div class="kpi-val" style="color:var(--green);">${fmt(inc)}</div>
        <div class="kpi-delta">Tocca per dettaglio ›</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid var(--red);cursor:pointer;" onclick="window.render('nico-expenses')">
        <div class="kpi-label">Uscite</div>
        <div class="kpi-val" style="color:var(--red);">-${fmt(exp)}</div>
        <div class="kpi-delta">Tocca per dettaglio ›</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid ${net>=0?'#000':'var(--red)'};">
        <div class="kpi-label">Risparmio</div>
        <div class="kpi-val" style="color:${net>=0?'#000':'var(--red)'};">${fmt(net)}</div>
        <div style="margin-top:6px;">
          <div class="progress-wrap"><div class="progress-bar" style="width:${gp}%;"></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:9px;font-weight:800;color:var(--muted);">
            <span>Target ${fmt(goal)}</span><span>${gp.toFixed(0)}%</span>
          </div>
        </div>
      </div>
    </div>

    <div class="three-panel">
      <!-- Andamento mensile -->
      <div class="card">
        <div class="card-title">Andamento ${year}</div>
        <div class="bar-chart" style="margin-top:8px;">${renderBarChart(barData,70)}</div>
        ${renderAnnualComparison(year)?'<div style="margin-top:12px;">'+renderAnnualComparison(year)+'</div>':''}
      </div>

      <!-- Spese per categoria -->
      <div class="card">
        <div class="card-title">Spese per categoria</div>
        <div style="margin-top:8px;">${catHtml}</div>
      </div>

      <!-- Clienti del periodo -->
      <div>
        <div class="card">
          <div class="card-title">Clienti — ${label}</div>
          <div class="tx-list">
            ${clientsTx.length?clientsTx.map(({c,paid})=>{
              const netto = c.payMode==='fatt'?round(paid*0.75):paid;
              const nicoNet = c.area==='inlab'?round(netto*0.5):netto;
              return '<div class="tx-item" onclick="window.openClientDetail(\''+c.id+'\')">'+
                '<div class="tx-dot" style="background:var(--green);"></div>'+
                '<div class="tx-info"><div class="tx-label">'+esc(c.name)+'</div><div class="tx-meta">'+c.area.toUpperCase()+'</div></div>'+
                '<div style="font-size:12px;font-weight:800;color:var(--green);">'+fmt(nicoNet)+'</div>'+
              '</div>';
            }).join(''):'<div class="empty">Nessun incasso</div>'}
          </div>
        </div>
      </div>
    </div>
  </div>`;
};

// ═══════════════════════════════════════════════════
// NICO INCOMES + EXPENSES (sub-views)
// ═══════════════════════════════════════════════════
const renderNicoIncomesView = (slot) => {
  const {month,year}=state.filters;
  const txs=state.transactions.filter(t=>inPeriod(t,month,year)&&t.kind==='income').sort((a,b)=>new Date(b.date)-new Date(a.date));
  const totalFatt=txs.filter(t=>t.payMode==='fatt').reduce((s,t)=>s+(parseFloat(t.gross)||0),0);
  const totalCont=txs.filter(t=>t.payMode==='cont').reduce((s,t)=>s+(parseFloat(t.gross)||0),0);
  slot.innerHTML=`<div class="page fade-up">
    <button class="btn-back" onclick="window.render('nico')">← Nico</button>
    <div class="page-header"><div class="page-title">Entrate</div><div class="page-sub">${getPeriodLabel()}</div></div>
    <div class="two-panel">
      <div class="card">
        <div class="tx-list">
          ${txs.length?txs.map(t=>'<div class="tx-item" onclick="window.openDetail(\''+t.id+'\')">'+
            '<div class="tx-dot" style="background:var(--green)"></div>'+
            '<div class="tx-info"><div class="tx-label">'+esc(t.desc||t.area.toUpperCase())+'</div>'+
            '<div class="tx-meta">'+t.area.toUpperCase()+' · '+(t.payMode==='fatt'?'Fattura':'Contanti')+' · '+fmtDate(t.date)+'</div></div>'+
            '<div class="tx-amount pos">+'+fmt(t.gross)+'</div></div>').join(''):'<div class="empty">Nessuna entrata</div>'}
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title">Riepilogo</div>
          <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px;">
            <div><div style="font-size:9px;color:var(--muted);font-weight:800;margin-bottom:2px;">Fattura</div><div style="font-family:'Sora';font-size:20px;font-weight:800;color:var(--green);">${fmt(totalFatt)}</div></div>
            <div><div style="font-size:9px;color:var(--muted);font-weight:800;margin-bottom:2px;">Contanti</div><div style="font-family:'Sora';font-size:20px;font-weight:800;color:var(--green);">${fmt(totalCont)}</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
};

const renderNicoExpensesView = (slot) => {
  const {month,year}=state.filters;
  const txs=state.transactions.filter(t=>inPeriod(t,month,year)&&t.kind==='expense').sort((a,b)=>new Date(b.date)-new Date(a.date));
  const nicoTxs=txs.map(t=>{const g=parseFloat(t.gross)||0;return {...t,nicoAmt:t.area==='nico'?g:round(g*0.5)};});
  const totNico=round(nicoTxs.reduce((s,t)=>s+t.nicoAmt,0));
  const cats={};
  nicoTxs.forEach(t=>{const cat=t.category||'Altro';cats[cat]=(cats[cat]||0)+t.nicoAmt;});
  slot.innerHTML=`<div class="page fade-up">
    <button class="btn-back" onclick="window.render('nico')">← Nico</button>
    <div class="page-header"><div class="page-title">Uscite</div><div class="page-sub">${getPeriodLabel()}</div></div>
    <div class="two-panel">
      <div class="card">
        <div class="tx-list">
          ${nicoTxs.length?nicoTxs.map(t=>'<div class="tx-item" onclick="window.openDetail(\''+t.id+'\')">'+
            '<div class="tx-dot" style="background:var(--red)"></div>'+
            '<div class="tx-info"><div class="tx-label">'+esc(t.desc||t.area.toUpperCase())+'</div>'+
            '<div class="tx-meta">'+(t.area==='inlab'?'Inlab (tua metà)':'Personale')+' · '+(t.category||'Altro')+' · '+fmtDate(t.date)+'</div></div>'+
            '<div class="tx-amount neg">-'+fmt(t.nicoAmt)+'</div></div>').join(''):'<div class="empty">Nessuna uscita</div>'}
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:12px;">
          <div class="card-title">Totale</div>
          <div style="font-family:'Sora';font-size:24px;font-weight:800;color:var(--red);">-${fmt(totNico)}</div>
        </div>
        ${Object.keys(cats).length?'<div class="card"><div class="card-title">Per categoria</div><div style="margin-top:8px;">'+
          Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>
            '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(0,0,0,0.04);">'+
            '<div style="font-size:12px;font-weight:700;">'+esc(cat)+'</div>'+
            '<div style="font-size:12px;font-weight:800;color:var(--red);">'+fmt(amt)+'</div></div>'
          ).join('')+'</div></div>':''}
      </div>
    </div>
  </div>`;
};

// ═══════════════════════════════════════════════════
// INLAB VIEW
// ═══════════════════════════════════════════════════
const renderInlabView = (slot) => {
  const {month,year}=state.filters;
  const inlabTotal=calcInlabTotal(month,year);
  const inlabExp=calcInlabExpenses(month,year);
  const bal=calcInlabBalance(month,year);
  const list=state.transactions.filter(t=>inPeriod(t,month,year)&&t.area==='inlab').sort((a,b)=>new Date(b.date)-new Date(a.date));
  const saldo=bal.saldo;

  const saldoHtml = Math.abs(saldo)<0.01
    ? '<div style="padding:10px;background:rgba(16,185,129,0.08);border-radius:8px;text-align:center;font-size:12px;font-weight:800;color:var(--green);">✓ In pari</div>'
    : saldo>0
      ? '<div style="padding:10px;background:#f9fafb;border-radius:8px;"><div style="font-size:9px;font-weight:900;text-transform:uppercase;color:var(--muted);margin-bottom:2px;">Nico deve ad Ilaria</div><div style="font-family:\'Sora\';font-size:20px;font-weight:800;">'+fmt(saldo)+'</div></div>'
      : '<div style="padding:10px;background:#fef2f2;border-radius:8px;"><div style="font-size:9px;font-weight:900;text-transform:uppercase;color:var(--muted);margin-bottom:2px;">Ilaria deve a Nico</div><div style="font-family:\'Sora\';font-size:20px;font-weight:800;color:var(--red);">'+fmt(Math.abs(saldo))+'</div></div>';

  // Payments to Ilaria history
  const transfers = state.transactions.filter(t=>t.kind==='transfer'&&(t.from==='nico'||t.to==='nico')).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);

  const barData = MS_ABBR.map((l,i)=>({label:l,inc:calcInlabTotal(i+1,year),exp:calcInlabExpenses(i+1,year)}));

  slot.innerHTML=`<div class="page fade-up">
    <div class="page-header"><div class="page-title">Inlab</div><div class="page-sub">${getPeriodLabel()}</div></div>

    <div class="grid-4" style="margin-bottom:16px;">
      <div class="kpi-card" style="border-left:3px solid #000;"><div class="kpi-label">Giro d'affari</div><div class="kpi-val">${fmt(inlabTotal)}</div></div>
      <div class="kpi-card" style="border-left:3px solid var(--red);"><div class="kpi-label">Spese Inlab</div><div class="kpi-val" style="color:var(--red);">-${fmt(inlabExp)}</div></div>
      <div class="kpi-card" style="border-left:3px solid var(--green);"><div class="kpi-label">Quota Nico</div><div class="kpi-val" style="color:var(--green);">${fmt(bal.nicoShare)}</div></div>
      <div class="kpi-card" style="border-left:3px solid var(--blue);"><div class="kpi-label">Quota Ilaria</div><div class="kpi-val" style="color:var(--blue);">${fmt(bal.ilariaShare)}</div></div>
    </div>

    <div class="two-panel">
      <div>
        <div class="card" style="margin-bottom:12px;">
          <div class="card-title">Andamento ${year}</div>
          <div class="bar-chart" style="margin-top:8px;">${renderBarChart(barData,65)}</div>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div class="card-title" style="margin-bottom:0;">Movimenti Inlab</div>
            <button class="btn-ghost" style="font-size:10px;padding:4px 8px;" onclick="window.openTransferModal()">💸 Trasferimento</button>
          </div>
          <div class="tx-list">
            ${list.length?list.map(t=>'<div class="tx-item" onclick="window.openDetail(\''+t.id+'\')">'+
              '<div class="tx-dot" style="background:'+(t.kind==='income'?'var(--green)':t.kind==='transfer'?'var(--purple)':'var(--red)')+'"></div>'+
              '<div class="tx-info"><div class="tx-label">'+esc(t.desc||'Inlab')+'</div>'+
              '<div class="tx-meta">'+fmtDate(t.date)+(t.collector?' · Inc.: '+t.collector:'')+(t.paidBy?' · Pagato: '+t.paidBy:'')+(t.kind==='transfer'?' · '+t.from+' → '+t.to:'')+'</div></div>'+
              '<div class="tx-amount '+(t.kind==='income'?'pos':t.kind==='transfer'?'':'neg')+'" style="'+(t.kind==='transfer'?'color:var(--purple);':'')+'">'+(t.kind==='income'?'+':t.kind==='transfer'?'↔':'-')+fmt(t.gross)+'</div>'+
            '</div>').join(''):'<div class="empty">Nessun movimento</div>'}
          </div>
        </div>
      </div>

      <div>
        <!-- Saldo soci -->
        <div class="card" style="margin-bottom:12px;">
          <div class="card-title">Saldo tra soci</div>
          <div style="margin-top:8px;">${saldoHtml}</div>
          <div style="font-size:10px;color:var(--muted);font-weight:700;margin-top:8px;">
            Nico ha incassato: ${fmt(bal.nicoHaInc)} · Spettante: ${fmt(bal.nicoSpetta)}
          </div>
        </div>

        <!-- Trasferimenti recenti -->
        <div class="card">
          <div class="card-title">Pagamenti a Ilaria</div>
          <div class="tx-list" style="margin-top:8px;">
            ${transfers.length?transfers.map(t=>'<div class="tx-item">'+
              '<div class="tx-dot" style="background:var(--purple)"></div>'+
              '<div class="tx-info"><div class="tx-label">'+esc(t.desc||'Trasferimento')+'</div>'+
              '<div class="tx-meta">'+fmtDate(t.date)+'</div></div>'+
              '<div style="font-size:12px;font-weight:800;color:var(--purple);">'+fmt(t.gross)+'</div>'+
            '</div>').join(''):'<div class="empty">Nessun trasferimento</div>'}
          </div>
        </div>
      </div>
    </div>
  </div>`;
};

// ═══════════════════════════════════════════════════
// ASSETS VIEW — analitica
// ═══════════════════════════════════════════════════
const renderAssetsView = (slot) => {
  const tot = getWealthTotal();
  const liq = getLiquidTotal();
  const inv = getInvestTotal();
  const totV1 = round(state.assets.invest.reduce((s,i)=>s+(i.v1||0),0)+(state.assets.liquidInitial||0));
  const diff = round(tot-totV1), diffPct = totV1>0?round((diff/totV1)*100):0;
  const cy = getCompareYear();

  // Wealth by month (from wealthHistory if available)
  const wh = state.wealthHistory || {};
  const curY = state.filters.year;
  const whYear = wh[curY] || {};
  const wealthBarData = MS_ABBR.map((l,i)=>({
    label:l,
    inc: whYear[i+1]?.total || 0,
    exp: 0
  }));
  const hasWH = Object.keys(whYear).length > 0;

  slot.innerHTML=`<div class="page fade-up">
    <div class="page-header"><div class="page-title">Patrimonio</div><div class="page-sub">${fmt(tot)}</div></div>

    <!-- KPI -->
    <div class="grid-4" style="margin-bottom:16px;">
      <div class="kpi-card" style="border-left:3px solid #000;">
        <div class="kpi-label">Totale</div>
        <div class="kpi-val big">${fmt(tot)}</div>
        <div class="kpi-delta" style="color:${diff>=0?'var(--green)':'var(--red)'};">${diff>=0?'↑':'↓'} ${Math.abs(diffPct).toFixed(1)}% YTD</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid var(--blue);">
        <div class="kpi-label">Liquidità</div>
        <div class="kpi-val">${fmt(liq)}</div>
        <div class="kpi-delta">${(liq/tot*100).toFixed(1)}% del totale</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid var(--green);">
        <div class="kpi-label">Investimenti</div>
        <div class="kpi-val">${fmt(inv)}</div>
        <div class="kpi-delta">${(inv/tot*100).toFixed(1)}% del totale</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid var(--amber);">
        <div class="kpi-label">Crescita YTD</div>
        <div class="kpi-val" style="color:${diff>=0?'var(--green)':'var(--red)'};">${fmt(diff)}</div>
        <div class="kpi-delta">vs inizio ${state.filters.year}</div>
      </div>
    </div>

    <div class="two-panel">
      <div>
        <!-- Composizione torta + lista -->
        <div class="card" style="margin-bottom:12px;">
          <div class="card-title">Composizione</div>
          <div style="display:flex;align-items:center;gap:20px;margin-top:10px;">
            <div class="donut-wrap" style="width:130px;height:130px;">
              <canvas id="pie-wealth" width="130" height="130"></canvas>
              <div class="donut-center">
                <div style="font-size:9px;font-weight:800;color:#000;">TOTALE</div>
                <div style="font-family:'Sora';font-size:11px;font-weight:800;">${fmt(tot)}</div>
              </div>
            </div>
            <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;">
                <span style="display:flex;align-items:center;gap:5px;font-weight:700;"><span style="width:8px;height:8px;border-radius:50%;background:#000;"></span>Liquidità</span>
                <span style="font-weight:800;">${fmt(liq)}</span>
              </div>
              ${state.assets.invest.map(i=>'<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;">'+
                '<span style="display:flex;align-items:center;gap:5px;font-weight:700;"><span style="width:8px;height:8px;border-radius:50%;background:'+i.color+';"></span>'+esc(i.name)+'</span>'+
                '<span style="font-weight:800;">'+fmt(i.balance)+'</span></div>'
              ).join('')}
            </div>
          </div>
        </div>

        <!-- Evoluzione -->
        <div class="card" style="margin-bottom:12px;">
          <div class="card-title">Evoluzione patrimonio ${curY}</div>
          <div style="height:130px;position:relative;margin-top:8px;"><canvas id="evolution-chart"></canvas></div>
        </div>

        <!-- Confronto anni -->
        ${cy?renderAnnualComparison(state.filters.year):''}
      </div>

      <div>
        <!-- Liquidità -->
        <div class="card" style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div class="card-title" style="margin-bottom:0;">Liquidità · ${fmt(liq)}</div>
            <button class="chip active" onclick="window.openAddAssetModal('liquid')">＋</button>
          </div>
          ${state.assets.liquid.map(acc=>'<div class="tx-item">'+
            '<div class="tx-dot" style="background:'+acc.color+'"></div>'+
            '<div class="tx-info"><div class="tx-label">'+esc(acc.name)+'</div></div>'+
            '<div style="display:flex;align-items:center;gap:6px;">'+
              '<input class="amount-input inline-amount-input" type="number" inputmode="decimal" value="'+acc.balance+'" oninput="window.updateLiquidBalance(\''+acc.id+'\',this.value)"/>'+
              (window._assetConfirmId===acc.id
                ? '<button style="background:var(--red);border:none;color:#fff;border-radius:4px;font-size:9px;font-weight:800;padding:2px 6px;cursor:pointer;" onclick="window.deleteAsset(\'liquid\',\''+acc.id+'\')">Sicuro?</button>'
                : '<button style="background:none;border:none;color:var(--red);font-size:13px;cursor:pointer;" onclick="window.deleteAsset(\'liquid\',\''+acc.id+'\')">✕</button>')+
            '</div></div>'
          ).join('')}
        </div>

        <!-- Investimenti -->
        <div class="card" style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div class="card-title" style="margin-bottom:0;">Investimenti · ${fmt(inv)}</div>
            <button class="chip active" onclick="window.openAddAssetModal('invest')">＋</button>
          </div>
          ${state.assets.invest.map(i=>{
            const gain = round(i.balance-i.v1);
            const gPct = i.v1>0?round((gain/i.v1)*100):0;
            return '<div class="tx-item" onclick="window.openInvestDetail(\''+i.id+'\')">'+
              '<div class="tx-dot" style="background:'+i.color+';cursor:pointer;"></div>'+
              '<div class="tx-info">'+
                '<div class="tx-label">'+esc(i.name)+'</div>'+
                '<div class="tx-meta" style="color:'+(gain>=0?'var(--green)':'var(--red)')+';">'+(gain>=0?'↑':'↓')+' '+Math.abs(gPct).toFixed(1)+'% YTD</div>'+
              '</div>'+
              '<div style="text-align:right;">'+
                '<div style="font-size:13px;font-weight:800;">'+fmt(i.balance)+'</div>'+
                (i.rec?'<div class="pac-badge">PAC '+fmt(i.rec.amt)+'</div>':'')+
              '</div>'+
              (window._assetConfirmId===i.id
                ? '<button style="background:var(--red);border:none;color:#fff;border-radius:4px;font-size:9px;font-weight:800;padding:2px 6px;cursor:pointer;margin-left:6px;" onclick="window.deleteAsset(\'invest\',\''+i.id+'\')">Sicuro?</button>'
                : '<button style="background:none;border:none;color:var(--red);font-size:13px;cursor:pointer;margin-left:6px;" onclick="window.deleteAsset(\'invest\',\''+i.id+'\')">✕</button>')+
            '</div>';
          }).join('')}
        </div>

        <!-- Settings -->
        <div class="card">
          <div class="card-title">Impostazioni anno</div>
          <label class="form-label" style="margin-top:8px;">Liquidità al 1 Gen ${state.filters.year}</label>
          <input class="form-input" type="number" value="${state.assets.liquidInitial||0}" onchange="window.updateAssetSetting('liquidInitial',this.value)"/>
        </div>
      </div>
    </div>
  </div>`;
  setTimeout(()=>{ initWealthPie(); initEvolutionChart(); },100);
};

const renderInvestDetail = (slot) => {
  const inv=getInvestById(state.activeInvestId);
  if(!inv) return render('assets');
  if(inv.v0===undefined) inv.v0=inv.v1;
  const curYear=state.filters.year;
  const addsYTD=(inv.hist||[]).filter(h=>new Date(h.date).getFullYear()===curYear).reduce((s,h)=>s+(h.kind==='rem'?-h.amt:h.amt),0);
  const addsAll=(inv.hist||[]).reduce((s,h)=>s+(h.kind==='rem'?-h.amt:h.amt),0);
  const gainYTD=round(inv.balance-inv.v1-addsYTD),costYTD=inv.v1+addsYTD;
  const pctYTD=costYTD>0?round((gainYTD/costYTD)*100):0;
  const gainAllTime=round(inv.balance-inv.v0-addsAll),costAll=inv.v0+addsAll;
  const pctAllTime=costAll>0?round((gainAllTime/costAll)*100):0;
  slot.innerHTML=`<div class="page fade-up">
    <button class="btn-back" onclick="window.render('assets')">← Patrimonio</button>
    <div class="page-header"><div class="page-title">${esc(inv.name)}</div><div class="page-sub">Asset Profilo</div></div>
    <div class="two-panel">
      <div>
        <div class="grid-2" style="margin-bottom:12px;">
          <div class="kpi-card" style="border-left:3px solid #000;"><div class="kpi-label">Valore Attuale</div><div class="kpi-val">${fmt(inv.balance)}</div></div>
          <div class="kpi-card" style="border-left:3px solid ${gainYTD>=0?'var(--green)':'var(--red)'};"><div class="kpi-label">Rendimento YTD</div><div class="kpi-val" style="color:${gainYTD>=0?'var(--green)':'var(--red)'};">${pct(pctYTD)}</div><div class="kpi-delta">${fmt(gainYTD)}</div></div>
        </div>
        <div class="card" style="margin-bottom:12px;">
          <div class="card-title">Andamento ${state.filters.year}</div>
          <div style="height:180px;position:relative;margin-top:8px;"><canvas id="invest-history-chart"></canvas></div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <button class="btn-primary" style="flex:1;background:var(--green);" onclick="window.openInvestTxModal('${inv.id}','add')">Acquista</button>
          <button class="btn-primary" style="flex:1;background:var(--red);" onclick="window.openInvestTxModal('${inv.id}','rem')">Vendi</button>
        </div>
        <div class="card">
          <div class="kpi-label">Rendimento Totale</div>
          <div style="font-family:'Sora';font-size:18px;font-weight:800;color:${gainAllTime>=0?'var(--green)':'var(--red)'};">${pct(pctAllTime)} (${fmt(gainAllTime)})</div>
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:12px;">
          <div class="card-title" style="margin-bottom:10px;">PAC</div>
          ${inv.rec?'<div style="display:flex;justify-content:space-between;align-items:center;"><div><div style="font-size:14px;font-weight:800;">'+fmt(inv.rec.amt)+' / mese</div><div style="font-size:10px;color:var(--muted);">Giorno '+inv.rec.day+'</div></div><button class="chip active" onclick="window.openPacModal(\''+inv.id+'\')">Gestisci</button></div>'
          :'<button class="btn-ghost" style="width:100%;" onclick="window.openPacModal(\''+inv.id+'\')">＋ Attiva PAC</button>'}
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:10px;">Impostazioni</div>
          <div class="form-group"><label class="form-label">Valore storico (v0)</label><input class="form-input" type="number" value="${inv.v0||0}" onchange="window.updateInvestProp('${inv.id}','v0',this.value)"/></div>
          <div class="form-group"><label class="form-label">Valore 1 Gen ${curYear}</label><input class="form-input" type="number" value="${inv.v1}" onchange="window.updateInvestProp('${inv.id}','v1',this.value)"/></div>
          <div class="form-group"><label class="form-label">Aggiunte ${curYear}</label><div style="background:#f9fafb;padding:8px 12px;border-radius:8px;font-weight:800;">${fmt(addsYTD)}</div></div>
          <div class="form-group"><label class="form-label">Valore corrente</label><input class="form-input" type="number" value="${inv.balance}" onchange="window.updateInvestProp('${inv.id}','balance',this.value)"/></div>
        </div>
        <div id="asset-cmp" style="margin-top:12px;"></div>
      </div>
    </div>
  </div>`;
  setTimeout(()=>{
    initInvestHistoryChart(inv.id);
    const aslot=document.getElementById('asset-cmp');
    if(aslot) aslot.innerHTML=renderAssetComparison(inv);
  },100);
};

// ═══════════════════════════════════════════════════
// MOVEMENTS VIEW
// ═══════════════════════════════════════════════════
const renderMovementsView = (slot) => {
  const {month,year}=state.filters;
  const {kind,area,search}=state.txFilters;
  let list=state.transactions.filter(t=>inPeriod(t,month,year));
  if(kind!=='all') list=list.filter(t=>t.kind===kind);
  if(area!=='all') list=list.filter(t=>t.area===area||t.kind==='transfer');
  if(search.trim()) list=list.filter(t=>(t.desc||'').toLowerCase().includes(search.toLowerCase()));
  list=list.sort((a,b)=>new Date(b.date)-new Date(a.date));
  slot.innerHTML=`<div class="page fade-up">
    <div class="page-header"><div class="page-title">Movimenti</div><div class="page-sub">${getPeriodLabel()} · ${list.length} voci</div></div>
    <div class="two-panel">
      <div class="card">
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;">
          <button class="chip ${kind==='all'?'active':''}" onclick="window.setTxFilter('kind','all')">Tutto</button>
          <button class="chip ${kind==='income'?'active':''}" onclick="window.setTxFilter('kind','income')">Entrate</button>
          <button class="chip ${kind==='expense'?'active':''}" onclick="window.setTxFilter('kind','expense')">Uscite</button>
          <span style="width:1px;background:var(--border);margin:0 2px;"></span>
          <button class="chip ${area==='all'?'active':''}" onclick="window.setTxFilter('area','all')">Tutti</button>
          <button class="chip ${area==='nico'?'active':''}" onclick="window.setTxFilter('area','nico')">Nico</button>
          <button class="chip ${area==='inlab'?'active':''}" onclick="window.setTxFilter('area','inlab')">Inlab</button>
        </div>
        <input class="form-input" style="margin-bottom:12px;" placeholder="🔍 Cerca..." value="${esc(search)}" oninput="window.setTxSearch(this.value)"/>
        <div class="tx-list">
          ${list.length?list.map(t=>{
            const isT=t.kind==='transfer';
            const dot=t.kind==='income'?'var(--green)':isT?'var(--purple)':'var(--red)';
            const cls=t.kind==='income'?'pos':'neg';
            const pfx=t.kind==='income'?'+':isT?'↔':'-';
            let meta=t.area.toUpperCase();
            if(t.collector) meta+=' · Inc.: '+t.collector;
            if(t.paidBy&&t.area==='inlab') meta+=' · Pagato: '+t.paidBy;
            if(isT) meta='Trasf. '+t.from+' → '+t.to;
            if(t.category) meta+=' · '+t.category;
            meta+=' · '+fmtDate(t.date);
            return '<div class="tx-item" onclick="window.openDetail(\''+t.id+'\')">'+
              '<div class="tx-dot" style="background:'+dot+'"></div>'+
              '<div class="tx-info"><div class="tx-label">'+esc(t.desc||(t.area==='nico'?'Nico':'Inlab'))+'</div><div class="tx-meta">'+meta+'</div></div>'+
              '<div class="tx-amount '+(isT?'':cls)+'" style="'+(isT?'color:var(--purple);':'')+'">'+ pfx+fmt(t.gross)+'</div>'+
            '</div>';
          }).join(''):'<div class="empty">Nessun movimento</div>'}
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title">Riepilogo</div>
          <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;">
            <div><div style="font-size:9px;font-weight:800;color:var(--muted);margin-bottom:1px;">Entrate</div><div style="font-family:'Sora';font-size:18px;font-weight:800;color:var(--green);">+${fmt(list.filter(t=>t.kind==='income').reduce((s,t)=>s+(parseFloat(t.gross)||0),0))}</div></div>
            <div><div style="font-size:9px;font-weight:800;color:var(--muted);margin-bottom:1px;">Uscite</div><div style="font-family:'Sora';font-size:18px;font-weight:800;color:var(--red);">-${fmt(list.filter(t=>t.kind==='expense').reduce((s,t)=>s+(parseFloat(t.gross)||0),0))}</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
};

window.setTxFilter=(key,val)=>{state.txFilters[key]=val;render('movements');};
window.setTxSearch=val=>{state.txFilters.search=val;render('movements');};

// ═══════════════════════════════════════════════════
// CLIENTS VIEW
// ═══════════════════════════════════════════════════
const renderClientsView = (slot) => {
  const stipendio=calcStipendioStimato();
  let {clientSearch='',clientArea='all',clientPay='all'}=state.clientFilters||{};
  let clients=state.clients;
  if(clientArea!=='all') clients=clients.filter(c=>c.area===clientArea);
  if(clientPay!=='all') clients=clients.filter(c=>c.payMode===clientPay);
  if(clientSearch.trim()) clients=clients.filter(c=>c.name.toLowerCase().includes(clientSearch.toLowerCase()));
  const debts = state.debts||[];
  const totalDue = getMonthlyOutstanding().reduce((s,i)=>s+i.missing,0);
  const totalDebts = debts.filter(d=>!d.settled).reduce((s,d)=>s+(parseFloat(d.amount)||0),0);

  slot.innerHTML=`<div class="page fade-up">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div class="page-header" style="margin-bottom:0;"><div class="page-title">Clienti & Debiti</div></div>
      <div style="display:flex;gap:8px;">
        <button class="btn-ghost" onclick="window.openAddDebtModal()">＋ Debito</button>
        <button class="btn-primary" onclick="window.openAddClientModal()">＋ Cliente</button>
      </div>
    </div>

    <div class="grid-3" style="margin-bottom:16px;">
      <div class="kpi-card" style="border-left:3px solid var(--blue);"><div class="kpi-label">Stipendio Stimato</div><div class="kpi-val" style="color:var(--blue);">${fmt(stipendio)}</div></div>
      <div class="kpi-card" style="border-left:3px solid var(--amber);"><div class="kpi-label">Da incassare (clienti)</div><div class="kpi-val" style="color:var(--amber);">${fmt(totalDue)}</div></div>
      <div class="kpi-card" style="border-left:3px solid var(--purple);"><div class="kpi-label">Debiti aperti</div><div class="kpi-val" style="color:var(--purple);">${fmt(totalDebts)}</div></div>
    </div>

    <div class="two-panel">
      <div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">
          <button class="chip ${clientArea==='all'?'active':''}" onclick="window.setClientFilter('clientArea','all')">Tutti</button>
          <button class="chip ${clientArea==='nico'?'active':''}" onclick="window.setClientFilter('clientArea','nico')">Nico</button>
          <button class="chip ${clientArea==='inlab'?'active':''}" onclick="window.setClientFilter('clientArea','inlab')">Inlab</button>
          <span style="width:1px;background:var(--border);margin:0 2px;"></span>
          <button class="chip ${clientPay==='all'?'active':''}" onclick="window.setClientFilter('clientPay','all')">Tutti</button>
          <button class="chip ${clientPay==='fatt'?'active':''}" onclick="window.setClientFilter('clientPay','fatt')">Fattura</button>
          <button class="chip ${clientPay==='cont'?'active':''}" onclick="window.setClientFilter('clientPay','cont')">Contanti</button>
        </div>
        <input class="form-input" style="margin-bottom:10px;" placeholder="🔍 Cerca cliente..." value="${esc(clientSearch)}" id="client-search-input" oninput="window.setClientSearch(this.value)"/>
        <div class="card">
          <div class="tx-list" id="clients-list">
            ${clients.map(c=>{
              const outstanding=getMonthlyOutstanding().filter(i=>i.client.id===c.id);
              const totalMissing=outstanding.reduce((s,i)=>s+i.missing,0);
              const dot=!c.active?'var(--muted)':totalMissing>0.01?'var(--amber)':'var(--green)';
              const lordo=c.monthlyAmount||c.expectedAmount||0;
              const nettoNico=c.area==='nico'?(c.payMode==='fatt'?round(lordo*0.75):lordo):(c.payMode==='fatt'?round(lordo*0.75*0.5):round(lordo*0.5));
              return '<div class="tx-item" onclick="window.openClientDetail(\''+c.id+'\')" data-client-id="'+c.id+'" data-client-name="'+esc(c.name)+'">'+
                '<div class="tx-dot" style="background:'+dot+'"></div>'+
                '<div class="tx-info"><div class="tx-label">'+esc(c.name)+'</div>'+
                '<div class="tx-meta">'+c.area.toUpperCase()+' · '+(c.payMode==='fatt'?'Fattura':'Contanti')+(c.recurring?' · gg.'+c.recurringDay:'')+' · '+(c.active?'Attivo':'Archiviato')+'</div></div>'+
                '<div style="text-align:right;flex-shrink:0;">'+
                  '<div style="font-size:12px;font-weight:800;">'+fmt(nettoNico)+'/m</div>'+
                  (totalMissing>0.01?'<div style="font-size:10px;color:var(--red);font-weight:800;">-'+fmt(totalMissing)+'</div>':'')+
                '</div></div>';
            }).join('')}
          </div>
        </div>
      </div>

      <!-- Debiti -->
      <div>
        <div class="card">
          <div class="card-title" style="margin-bottom:10px;">Debiti aperti</div>
          <div class="tx-list">
            ${debts.filter(d=>!d.settled).length?debts.filter(d=>!d.settled).map(d=>
              '<div class="tx-item">'+
                '<div class="tx-dot" style="background:var(--purple)"></div>'+
                '<div class="tx-info"><div class="tx-label">'+esc(d.name)+'</div>'+
                '<div class="tx-meta">'+fmtDate(d.date)+(d.note?' · '+esc(d.note):'')+'</div></div>'+
                '<div style="display:flex;align-items:center;gap:6px;">'+
                  '<div style="font-size:13px;font-weight:800;color:var(--purple);">'+fmt(d.amount)+'</div>'+
                  '<button onclick="window.settleDebt(\''+d.id+'\')" style="background:var(--purple);border:none;color:#fff;border-radius:5px;font-size:9px;font-weight:800;padding:3px 6px;cursor:pointer;">Saldato</button>'+
                  '<button onclick="window.deleteDebt(\''+d.id+'\')" style="background:none;border:none;color:var(--red);font-size:13px;cursor:pointer;">✕</button>'+
                '</div>'+
              '</div>'
            ).join(''):'<div class="empty">Nessun debito aperto</div>'}
          </div>
          ${debts.filter(d=>d.settled).length?'<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">'+
            '<div style="font-size:9px;font-weight:900;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">Saldati</div>'+
            debts.filter(d=>d.settled).map(d=>
              '<div class="tx-item">'+
                '<div class="tx-dot" style="background:var(--green)"></div>'+
                '<div class="tx-info"><div class="tx-label">'+esc(d.name)+'</div><div class="tx-meta">'+fmtDate(d.date)+'</div></div>'+
                '<div style="font-size:12px;font-weight:800;color:var(--muted);">'+fmt(d.amount)+'</div>'+
              '</div>'
            ).join('')+'</div>':''}
        </div>
      </div>
    </div>
  </div>`;
};

window.setClientFilter=(key,val)=>{if(!state.clientFilters)state.clientFilters={};state.clientFilters[key]=val;render('clients');};
window.setClientSearch=val=>{
  if(!state.clientFilters)state.clientFilters={};
  state.clientFilters.clientSearch=val;
  const v=val.trim().toLowerCase();
  const list=document.getElementById('clients-list');
  if(!list){render('clients');return;}
  list.querySelectorAll('.tx-item[data-client-id]').forEach(el=>{
    const name=(el.dataset.clientName||'').toLowerCase();
    el.style.display=(!v||name.includes(v))?'':'none';
  });
};

// ═══════════════════════════════════════════════════
// TAXES VIEW
// ═══════════════════════════════════════════════════
const renderTaxesView = (slot) => {
  const curYear=new Date().getFullYear(), prevYear=curYear-1;
  const accrualPrev=calcTaxAccrual(prevYear), paidPrev=calcTaxPaid(prevYear), remainPrev=round(accrualPrev-paidPrev);
  const accrualCur=calcTaxAccrual(curYear);
  const paymentsPrev=state.taxPayments[prevYear]||[];
  const yearsWithData=new Set([curYear,prevYear]);
  state.transactions.forEach(t=>{const y=new Date(t.date).getFullYear();if(y)yearsWithData.add(y);});
  Object.keys(state.taxPayments).forEach(y=>yearsWithData.add(parseInt(y)));
  const sortedYears=Array.from(yearsWithData).sort((a,b)=>b-a);
  slot.innerHTML=`<div class="page fade-up">
    <div class="page-header"><div class="page-title">Conto Tasse</div></div>
    <div class="two-panel">
      <div>
        <div class="card" style="border-left:4px solid var(--amber);margin-bottom:12px;">
          <div class="card-title">Da pagare · Anno ${prevYear}</div>
          <div style="font-family:'Sora';font-size:32px;font-weight:800;color:${remainPrev>0?'var(--red)':'var(--green)'};">${fmt(remainPrev)}</div>
          <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px solid rgba(0,0,0,0.06);">
            <div><div style="font-size:9px;font-weight:900;color:var(--muted);margin-bottom:1px;">Tasse ${prevYear}</div><div style="font-family:'Sora';font-size:16px;font-weight:800;">${fmt(accrualPrev)}</div></div>
            <div style="text-align:right;"><div style="font-size:9px;font-weight:900;color:var(--muted);margin-bottom:1px;">Già pagato</div><div style="font-family:'Sora';font-size:16px;font-weight:800;color:var(--green);">${fmt(paidPrev)}</div></div>
          </div>
        </div>
        ${paymentsPrev.length?'<div class="card" style="margin-bottom:12px;"><div class="card-title" style="margin-bottom:8px;">Pagamenti ${prevYear}</div>'+
          paymentsPrev.map(p=>'<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(0,0,0,0.04);">'+
            '<div><div style="font-size:12px;font-weight:700;">'+fmtDate(p.date)+'</div>'+(p.note?'<div style="font-size:10px;color:var(--muted);">'+esc(p.note)+'</div>':'')+
            '</div><div style="display:flex;align-items:center;gap:8px;"><div style="font-size:13px;font-weight:800;color:var(--green);">-'+fmt(p.amount)+'</div>'+
            '<button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:13px;" onclick="window.deleteTaxPayment('+prevYear+',\''+p.id+'\')">✕</button></div></div>'
          ).join('')+'</div>':''}
        <button class="btn-primary full" style="background:var(--green);margin-bottom:20px;" onclick="window.openAddTaxPaymentModal(${prevYear})"><span>＋ Registra Pagamento ${prevYear}</span></button>
        <div class="card">
          <div class="card-title" style="margin-bottom:10px;">Storico</div>
          ${sortedYears.map(y=>{const acc=calcTaxAccrual(y);if(acc===0&&!state.taxPayments[y])return '';
            return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.04);"><div style="font-weight:800;font-family:\'Sora\';">'+y+'</div><div style="font-weight:800;">'+fmt(acc)+'</div></div>';
          }).join('')}
        </div>
      </div>
      <div>
        <div class="card" style="border-left:4px solid var(--purple);margin-bottom:12px;">
          <div class="card-title">Accrual ${curYear}</div>
          <div style="font-family:'Sora';font-size:28px;font-weight:800;color:var(--purple);">${fmt(accrualCur)}</div>
          <div style="font-size:10px;color:var(--muted);font-weight:700;margin-top:4px;">Da pagare nel ${curYear+1}</div>
        </div>
        <div class="card" style="margin-bottom:12px;">
          <div class="card-title" style="margin-bottom:8px;">Saldo conto tasse ${curYear}</div>
          <input class="form-input" style="font-family:'Sora';font-size:18px;font-weight:800;" type="number" value="${state.taxAccount.balances[curYear]||0}" onchange="window.updateTaxBalance(${curYear},this.value)"/>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:8px;">Copertura ${curYear}</div>
          ${(()=>{const bal=state.taxAccount.balances[curYear]||0,diff=round(bal-accrualCur);const cc=diff>=0?'var(--green)':'var(--red)';const ct=diff>=0?'Sei in pari ✨':'Ti mancano '+fmt(Math.abs(diff));return '<div style="font-family:\'Sora\';font-size:22px;font-weight:800;color:'+cc+';">'+fmt(diff)+'</div><div style="font-size:11px;color:var(--muted);margin-top:4px;font-weight:600;">'+ct+'</div>';})(  )}
        </div>
      </div>
    </div>
  </div>`;
};

window.updateTaxBalance=(y,v)=>{state.taxAccount.balances[y]=parseFloat(v)||0;saveState();};
window.openAddTaxPaymentModal=y=>{
  modalContainer.innerHTML='<div class="overlay" onclick="window.closeModal()"><div class="sheet" onclick="event.stopPropagation()"><div class="sheet-handle"></div><div class="sheet-title">Pagamento tasse '+y+'</div><div class="form-group"><label class="form-label">Importo</label><input class="form-input" id="tp-amt" type="number" placeholder="0.00"/></div><div class="form-group"><label class="form-label">Data</label><input class="form-input" id="tp-date" type="date" value="'+todayISO()+'"/></div><div class="form-group"><label class="form-label">Note</label><input class="form-input" id="tp-note" placeholder="es. Prima rata..."/></div><button class="btn-primary" onclick="window.saveTaxPayment('+y+')">Salva</button></div></div>';
};
window.saveTaxPayment=y=>{
  const amt=parseFloat(document.getElementById('tp-amt').value)||0;
  const date=document.getElementById('tp-date').value;
  const note=document.getElementById('tp-note').value;
  if(!amt) return;
  if(!state.taxPayments[y]) state.taxPayments[y]=[];
  state.taxPayments[y].push({id:uid(),amount:amt,date,note});
  saveState();window.closeModal();render('taxes');
};
window.deleteTaxPayment=(y,id)=>{state.taxPayments[y]=(state.taxPayments[y]||[]).filter(p=>p.id!==id);saveState();render('taxes');};

// ═══════════════════════════════════════════════════
// DEBT FUNCTIONS
// ═══════════════════════════════════════════════════
window.openAddDebtModal = () => {
  modalContainer.innerHTML='<div class="overlay" onclick="window.closeModal()"><div class="sheet" onclick="event.stopPropagation()"><div class="sheet-handle"></div><div class="sheet-title">Aggiungi Debito</div>'+
    '<div class="form-group"><label class="form-label">Nome (chi ti deve)</label><input class="form-input" id="debt-name" placeholder="es. Marco"/></div>'+
    '<div class="form-group"><label class="form-label">Importo</label><input class="form-input" id="debt-amt" type="number" placeholder="0.00"/></div>'+
    '<div class="form-group"><label class="form-label">Data</label><input class="form-input" id="debt-date" type="date" value="'+todayISO()+'"/></div>'+
    '<div class="form-group"><label class="form-label">Nota (opzionale)</label><input class="form-input" id="debt-note" placeholder="es. Prestito cena..."/></div>'+
    '<button class="btn-primary" onclick="window.saveDebt()">Aggiungi</button></div></div>';
};
window.saveDebt = () => {
  const name=(document.getElementById('debt-name').value||'').trim();
  const amount=parseFloat(document.getElementById('debt-amt').value)||0;
  const date=document.getElementById('debt-date').value;
  const note=document.getElementById('debt-note').value;
  if(!name||!amount) return;
  if(!state.debts) state.debts=[];
  state.debts.push({id:uid(),name,amount,date,note,settled:false,createdAt:new Date().toISOString()});
  saveState();window.closeModal();render(lastViewId);
};
window.settleDebt = id => {
  if(!state.debts) return;
  const d=state.debts.find(x=>x.id===id);
  if(d){d.settled=true;d.settledAt=new Date().toISOString();}
  saveState();render(lastViewId);
};
window.deleteDebt = id => {
  if(!state.debts) return;
  state.debts=state.debts.filter(x=>x.id!==id);
  saveState();render(lastViewId);
};

// ═══════════════════════════════════════════════════
// MARK CLIENT PAID / SETTLED
// ═══════════════════════════════════════════════════
window.markClientPaid = (clientId, month, year, amount) => {
  const c = state.clients.find(x=>x.id===clientId);
  if(!c) return;
  const g = parseFloat(amount)||0;
  const nicoTax = c.payMode==='fatt' ? round(g*0.25) : 0;
  const nicoIncome = c.area==='nico' ? round(g-nicoTax) : round((g-nicoTax)*0.5);
  const date = year+'-'+String(month).padStart(2,'0')+'-'+String(c.recurringDay||1).padStart(2,'0');
  state.transactions.push({
    id:uid(), kind:'income', area:c.area, desc:c.name,
    gross:g, payMode:c.payMode, collector:'nico',
    clientId, date, nicoIncome, ilariaIncome:c.area==='inlab'?round((g-nicoTax)*0.5):0,
    nicoTax, createdAt:new Date().toISOString()
  });
  saveState();render(lastViewId);
};

window.markClientSettled = (clientId, month, year) => {
  // Mark as settled by adding a 0-amount "settled" transaction
  const date = year+'-'+String(month).padStart(2,'0')+'-01';
  const c = state.clients.find(x=>x.id===clientId);
  if(!c) return;
  const expected = parseFloat(c.monthlyAmount||c.expectedAmount)||0;
  state.transactions.push({
    id:uid(), kind:'income', area:c.area, desc:c.name+' (saldato)',
    gross:expected, payMode:c.payMode, collector:'nico',
    clientId, date, nicoIncome:0, ilariaIncome:0, nicoTax:0,
    settled:true, createdAt:new Date().toISOString()
  });
  saveState();render(lastViewId);
};

// ═══════════════════════════════════════════════════
// GLOBAL HELPERS
// ═══════════════════════════════════════════════════
window.updateFilter=(key,val)=>{
  if(key==='compareYear') state.filters[key]=val?parseInt(val):null;
  else state.filters[key]=parseInt(val);
  saveState();render(lastViewId);
};
window.updatePeriodType=type=>{
  state.filters.period=type;
  if(type==='annual') state.filters.month=13;
  saveState();render(lastViewId);
};
window.render=render;

// ═══════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  app.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:14px;background:#0a0a0a;"><div style="font-size:32px;">💸</div><div style="font-size:13px;color:#555;font-weight:600;font-family:sans-serif;">Caricamento...</div></div>';
  state=await initDB(state,(remoteState)=>{state=remoteState;runPacSync();render(lastViewId);});
  if(!state.debts) state.debts=[];
  runPacSync();render('home');
});
window.openClientDetail = id => {
  // modalità: 'view' | 'edit'
  let mode = 'view';

  const drawClient = () => {
    const c = state.clients.find(x=>x.id===id);
    if(!c) return;
    const {paid, missing} = calcClientStatus(id);
    const lordo = c.monthlyAmount || c.expectedAmount || 0;
    const nettoNico = (() => {
      if(c.area==='nico') return c.payMode==='fatt' ? round(lordo*0.75) : lordo;
      const net = c.payMode==='fatt' ? round(lordo*0.75) : lordo;
      return round(net*0.5);
    })();

    if(mode === 'view') {
      modalContainer.innerHTML=`
        <div class="overlay" onclick="window.closeModal()">
          <div class="sheet" onclick="event.stopPropagation()">
            <div class="sheet-handle"></div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
              <div class="sheet-title" style="margin-bottom:0;">${esc(c.name)}</div>
              <button class="chip active" onclick="mode='edit';drawClient()">✏️ Modifica</button>
            </div>

            <div class="stat-card">
              <div class="card-title">Pagamenti (storico totale)</div>
              <div style="display:flex;justify-content:space-between;">
                <div><div style="font-size:11px;color:var(--muted);font-weight:800;">Ricevuto</div><div class="stat-val green">${fmt(paid)}</div></div>
                <div style="text-align:right;"><div style="font-size:11px;color:var(--muted);font-weight:800;">Mancante</div><div class="stat-val ${missing>0.01?'red':'green'}">${fmt(missing)}</div></div>
              </div>
            </div>

            <div class="stat-card" style="margin-top:10px;">
              <div class="card-title">Dettagli</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px;">
                <div><div style="font-size:10px;color:var(--muted);font-weight:800;">Area</div><div style="font-weight:700;font-size:14px;">${c.area.toUpperCase()}</div></div>
                <div><div style="font-size:10px;color:var(--muted);font-weight:800;">Modalità</div><div style="font-weight:700;font-size:14px;">${c.payMode==='fatt'?'Fattura':'Contanti'}</div></div>
                <div><div style="font-size:10px;color:var(--muted);font-weight:800;">Lordo/mese</div><div style="font-weight:700;font-size:14px;">${fmt(lordo)}</div></div>
                <div><div style="font-size:10px;color:var(--muted);font-weight:800;">Netto Nico/m</div><div style="font-weight:700;font-size:14px;color:var(--green);">${fmt(nettoNico)}</div></div>
                <div><div style="font-size:10px;color:var(--muted);font-weight:800;">Ricorrente</div><div style="font-weight:700;font-size:14px;">${c.recurring?'Sì · gg.'+c.recurringDay:'No'}</div></div>
                <div><div style="font-size:10px;color:var(--muted);font-weight:800;">Stato</div><div style="font-weight:700;font-size:14px;">${c.active?'Attivo':'Archiviato'}</div></div>
              </div>
            </div>

            <div id="client-actions" style="margin-top:16px;">
              ${window._confirmDeleteClient === id ? `
                <div style="background:rgba(255,59,48,0.05);padding:16px;border-radius:16px;border:1px solid rgba(255,59,48,0.1);">
                  <p style="font-weight:800;color:var(--red);margin-bottom:12px;text-align:center;font-size:12px;">Eliminare cliente e tutti i suoi pagamenti?</p>
                  <div style="display:flex;gap:10px;">
                    <button class="btn-primary" style="background:var(--red);flex:1;font-size:12px;" onclick="window.doDeleteClient('${id}')">Sì, elimina</button>
                    <button class="btn-primary" style="background:var(--muted);flex:1;font-size:12px;" onclick="window._confirmDeleteClient=null;drawClient()">Annulla</button>
                  </div>
                </div>
              ` : `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                  <button class="btn-primary" style="background:var(--muted);" onclick="window.archiveClient('${id}')">${c.active?'Archivia':'Ripristina'}</button>
                  <button class="btn-primary" style="background:var(--red);" onclick="window._confirmDeleteClient='${id}';drawClient()">Elimina</button>
                </div>
              `}
            </div>
          </div>
        </div>`;

    } else {
      // ── EDIT MODE ──────────────────────────────────────────────
      // usiamo window._ec* per mantenere lo stato tra i redraw
      if(window._ecId !== id) {
        window._ecId        = id;
        window._ecName      = c.name;
        window._ecArea      = c.area;
        window._ecPayMode   = c.payMode;
        window._ecAmt       = String(lordo);
        window._ecRecurring = c.recurring || false;
        window._ecDay       = String(c.recurringDay || 1);
      }

      const pm  = window._ecPayMode;
      const rec = window._ecRecurring;

      modalContainer.innerHTML=`
        <div class="overlay" onclick="window.closeModal()">
          <div class="sheet" onclick="event.stopPropagation()">
            <div class="sheet-handle"></div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
              <div class="sheet-title" style="margin-bottom:0;">Modifica Cliente</div>
              <button class="chip" onclick="window._ecId=null;mode='view';drawClient()">← Indietro</button>
            </div>

            <div class="form-group">
              <label class="form-label">Nome</label>
              <input class="form-input" id="ec-name" value="${esc(window._ecName)}" oninput="window._ecName=this.value"/>
            </div>

            <div class="form-group">
              <label class="form-label">Area</label>
              <div style="display:flex;gap:10px;">
                <button class="chip ${window._ecArea==='nico'?'active':''}" onclick="window._ecArea='nico';window._ecRedraw()">Nico</button>
                <button class="chip ${window._ecArea==='inlab'?'active':''}" onclick="window._ecArea='inlab';window._ecRedraw()">Inlab</button>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Modalità pagamento</label>
              <div style="display:flex;gap:10px;">
                <button class="chip ${pm==='fatt'?'active':''}" onclick="window._ecPayMode='fatt';window._ecRedraw()">Fattura</button>
                <button class="chip ${pm==='cont'?'active':''}" onclick="window._ecPayMode='cont';window._ecRedraw()">Contanti</button>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Budget Mensile (lordo)</label>
              <input class="form-input" id="ec-amt" type="number" inputmode="decimal" value="${window._ecAmt}" oninput="window._ecAmt=this.value"/>
            </div>

            <div class="form-group">
              <label class="form-label">Cliente Ricorrente?</label>
              <div style="display:flex;gap:10px;">
                <button class="chip ${rec?'active':''}" onclick="window._ecRecurring=true;window._ecRedraw()">Sì</button>
                <button class="chip ${!rec?'active':''}" onclick="window._ecRecurring=false;window._ecRedraw()">No</button>
              </div>
            </div>

            ${rec?`
            <div class="form-group">
              <label class="form-label">Giorno di pagamento (del mese)</label>
              <input class="form-input" id="ec-day" type="number" min="1" max="31" value="${window._ecDay}" oninput="window._ecDay=this.value"/>
            </div>`:''}

            <button class="btn-primary" onclick="window.saveClientEdit('${id}')">Salva Modifiche</button>
          </div>
        </div>`;
    }
  };

  window._ecRedraw = () => {
    // salva i valori degli input prima del redraw
    const nameEl = document.getElementById('ec-name');
    const amtEl  = document.getElementById('ec-amt');
    const dayEl  = document.getElementById('ec-day');
    if(nameEl) window._ecName = nameEl.value;
    if(amtEl)  window._ecAmt  = amtEl.value;
    if(dayEl)  window._ecDay  = dayEl.value;
    drawClient();
  };

  window.saveClientEdit = cid => {
    const cl = state.clients.find(x=>x.id===cid);
    if(!cl) return;
    const nameEl = document.getElementById('ec-name');
    const amtEl  = document.getElementById('ec-amt');
    const dayEl  = document.getElementById('ec-day');
    const name = (nameEl?.value||window._ecName||'').trim();
    const amt  = parseFloat(amtEl?.value||window._ecAmt)||0;
    const day  = window._ecRecurring ? (parseInt(dayEl?.value||window._ecDay)||1) : null;
    if(!name){ alert('Il nome non può essere vuoto'); return; }
    cl.name         = name;
    cl.area         = window._ecArea;
    cl.payMode      = window._ecPayMode;
    cl.expectedAmount = amt;
    cl.monthlyAmount  = amt;
    cl.recurring    = window._ecRecurring;
    cl.recurringDay = day;
    saveState();
    window._ecId = null;
    mode = 'view';
    render('clients');
    window.closeModal();
  };

  window.archiveClient = cid => {
    const cl=state.clients.find(x=>x.id===cid);
    if(cl){ cl.active=!cl.active; saveState(); render('clients'); window.closeModal(); }
  };
  window.doDeleteClient = cid => {
    state.clients=state.clients.filter(x=>x.id!==cid);
    state.transactions=state.transactions.filter(t=>t.clientId!==cid);
    saveState(); render('clients'); window.closeModal();
  };

  drawClient();
};

// ═══════════════════════════════════════════════════
// MODAL — ADD CLIENT (con ricorrente + giorno + payMode)
// ═══════════════════════════════════════════════════
window.openAddClientModal = () => {
  window._acPayMode   = 'fatt';
  window._acRecurring = false;

  window._drawAddClient = () => {
    const payMode   = window._acPayMode;
    const recurring = window._acRecurring;
    const prevName = document.getElementById('c-name')?.value || '';
    const prevAmt  = document.getElementById('c-amt')?.value  || '';
    const prevArea = document.getElementById('c-area')?.value || 'nico';
    const prevDay  = document.getElementById('c-day')?.value  || '1';
    modalContainer.innerHTML=`
      <div class="overlay" onclick="window.closeModal()">
        <div class="sheet" onclick="event.stopPropagation()">
          <div class="sheet-handle"></div>
          <div class="sheet-title">Nuovo Cliente</div>
          <div class="form-group">
            <label class="form-label">Nome</label>
            <input class="form-input" id="c-name" value="${esc(prevName)}" placeholder="Nome cliente"/>
          </div>
          <div class="form-group">
            <label class="form-label">Area</label>
            <select class="form-input" id="c-area">
              <option value="nico" ${prevArea==='nico'?'selected':''}>Nico</option>
              <option value="inlab" ${prevArea==='inlab'?'selected':''}>Inlab</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Modalità pagamento</label>
            <div style="display:flex;gap:10px;">
              <button class="chip ${payMode==='fatt'?'active':''}" onclick="window._acPayMode='fatt';window._drawAddClient()">Fattura</button>
              <button class="chip ${payMode==='cont'?'active':''}" onclick="window._acPayMode='cont';window._drawAddClient()">Contanti</button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Budget Mensile (lordo)</label>
            <input class="form-input" id="c-amt" type="number" inputmode="decimal" placeholder="0.00" value="${prevAmt}"/>
          </div>
          <div class="form-group">
            <label class="form-label">Cliente Ricorrente?</label>
            <div style="display:flex;gap:10px;">
              <button class="chip ${recurring?'active':''}" onclick="window._acRecurring=true;window._drawAddClient()">Sì</button>
              <button class="chip ${!recurring?'active':''}" onclick="window._acRecurring=false;window._drawAddClient()">No</button>
            </div>
          </div>
          ${recurring?`
          <div class="form-group">
            <label class="form-label">Giorno di pagamento (del mese)</label>
            <input class="form-input" id="c-day" type="number" min="1" max="31" value="${prevDay}"/>
          </div>`:''}
          <button class="btn-primary" onclick="window.saveClient()">Crea Cliente</button>
        </div>
      </div>`;
  };

  window.saveClient = () => {
    const name = (document.getElementById('c-name')?.value||'').trim();
    const amt  = parseFloat(document.getElementById('c-amt')?.value)||0;
    const area = document.getElementById('c-area')?.value||'nico';
    const day  = window._acRecurring ? (parseInt(document.getElementById('c-day')?.value)||1) : null;
    if(!name){ alert('Inserisci il nome del cliente'); return; }
    state.clients.push({
      id:uid(), name, expectedAmount:amt, monthlyAmount:amt,
      area, payMode:window._acPayMode, active:true,
      recurring:window._acRecurring, recurringDay:day
    });
    saveState();
    window.closeModal();
    render('clients');
  };

  window._drawAddClient();
};

// ═══════════════════════════════════════════════════
// MODAL — TRANSACTION DETAIL
// ═══════════════════════════════════════════════════
window.openDetail = (id, showConfirm = false) => {
  const tx=state.transactions.find(t=>t.id===id);
  if(!tx) return;
  modalContainer.innerHTML=`
    <div class="overlay" onclick="window.closeModal()">
      <div class="sheet" onclick="event.stopPropagation()">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Dettaglio Movimento</div>
        <div class="stat-card">
          <div class="card-title">${tx.kind==='income'?'Entrata':tx.kind==='transfer'?'Trasferimento':'Uscita'} · ${tx.area.toUpperCase()}</div>
          <div class="stat-val">${esc(tx.desc||(tx.area==='nico'?'Nico':'Inlab'))}</div>
          <div style="margin-top:8px;font-size:24px;font-weight:800;" class="${tx.kind==='income'?'green':'red'}">
            ${tx.kind==='income'?'+':'-'}${fmt(tx.gross)}
          </div>
          ${tx.category?'<div style="margin-top:4px;font-size:12px;color:var(--muted);">'+esc(tx.category)+'</div>':''}
          ${tx.payMode?'<div style="font-size:12px;color:var(--muted);">'+(tx.payMode==='fatt'?'Fattura':'Contanti')+'</div>':''}
          ${tx.collector?'<div style="font-size:12px;color:var(--muted);">Incassato da: '+tx.collector+'</div>':''}
          <div style="font-size:12px;color:var(--muted);">${fmtDate(tx.date)}</div>
        </div>
        <div id="detail-actions" style="margin-top:20px;">
          ${showConfirm ? `
            <div style="background:rgba(255,59,48,0.05);padding:16px;border-radius:16px;border:1px solid rgba(255,59,48,0.1);">
              <p style="font-weight:800;color:var(--red);margin-bottom:12px;text-align:center;font-size:14px;">Eliminare definitivamente?</p>
              <div style="display:flex;gap:10px;">
                <button class="btn-primary" style="background:var(--red);flex:1;" onclick="window.doDeleteTx('${id}')">Sì, elimina</button>
                <button class="btn-primary" style="background:var(--muted);flex:1;" onclick="window.openDetail('${id}', false)">No</button>
              </div>
            </div>
          ` : `
            <div style="display:flex;gap:10px;">
              <button class="btn-primary" style="background:var(--red);flex:1;" onclick="window.openDetail('${id}', true)">Elimina</button>
              <button class="btn-primary" style="background:var(--muted);flex:1;" onclick="window.closeModal()">Chiudi</button>
            </div>
          `}
        </div>
      </div>
    </div>`;
};

window.doDeleteTx = id => {
  state.transactions=state.transactions.filter(t=>t.id!==id);
  saveState();window.closeModal();render(lastViewId);
};

// ═══════════════════════════════════════════════════
// ASSET MODALS
// ═══════════════════════════════════════════════════
window.openAddAssetModal = type => {
  modalContainer.innerHTML=`
    <div class="overlay" onclick="window.closeModal()">
      <div class="sheet" onclick="event.stopPropagation()">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Nuovo ${type==='liquid'?'Conto':'Investimento'}</div>
        <div class="form-group"><label class="form-label">Nome</label><input class="form-input" id="a-name" placeholder="es. Binance, Fineco..."/></div>
        <div class="form-group"><label class="form-label">Saldo Iniziale</label><input class="form-input" id="a-bal" type="number" value="0"/></div>
        <div class="form-group"><label class="form-label">Colore</label><input class="form-input" id="a-color" type="color" value="#1f68ff" style="height:44px;padding:4px;"/></div>
        <button class="btn-primary" onclick="window.saveAsset('${type}')">Salva Asset</button>
      </div>
    </div>`;
};

window.saveAsset = type => {
  const name=document.getElementById('a-name').value;
  const balance=parseFloat(document.getElementById('a-bal').value)||0;
  const color=document.getElementById('a-color').value;
  if(!name) return;
  const asset={id:uid(),name,balance,color};
  if(type==='invest'){asset.v1=balance;asset.v0=balance;asset.add=0;asset.hist=[];asset.rec=null;}
  state.assets[type].push(asset);
  saveState();window.closeModal();render('assets');
};

window.deleteAsset = (type,id) => {
  if(window._assetConfirmId === id){
    state.assets[type]=state.assets[type].filter(a=>a.id!==id);
    window._assetConfirmId = null;
    saveState();render('assets');
  } else {
    window._assetConfirmId = id;
    render('assets');
  }
};

window.openInvestDetail = id => { state.activeInvestId=id; render('invest-detail'); };
window.updateInvestProp = (id,prop,val) => {
  const inv=getInvestById(id);
  if(inv){inv[prop]=parseFloat(val)||0;saveState();render('invest-detail');}
};
window.updateAssetSetting = (key,val) => {
  state.assets[key]=parseFloat(val)||0;saveState();render('assets');
};
window.updateLiquidBalance = (id,val) => {
  const acc=state.assets.liquid.find(a=>a.id===id);
  if(acc){
    acc.balance=parseFloat(val)||0;
    saveState();
  }
};

// ═══════════════════════════════════════════════════
// INVEST TX MODAL
// ═══════════════════════════════════════════════════
window.openInvestTxModal = (id,kind) => {
  const inv=getInvestById(id);
  if(!inv) return;
  const title=kind==='add'?'Acquista':'Vendi';
  const color=kind==='add'?'var(--green)':'var(--red)';
  modalContainer.innerHTML=`
    <div class="overlay" onclick="window.closeModal()">
      <div class="sheet" onclick="event.stopPropagation()">
        <div class="sheet-handle"></div>
        <div class="sheet-title">${title} - ${esc(inv.name)}</div>
        <div class="form-group"><label class="form-label">Importo</label><input class="form-input" id="tx-amt" type="number" inputmode="decimal" placeholder="0.00" style="font-size:24px;text-align:center;"/></div>
        <div class="form-group"><label class="form-label">Data</label><input class="form-input" id="tx-date" type="date" value="${todayISO()}"/></div>
        <div class="form-group"><label class="form-label">Descrizione (opzionale)</label><input class="form-input" id="tx-desc" placeholder="es. Reinvestimento dividendi"/></div>
        <button class="btn-primary" style="background:${color};" onclick="window.saveInvestTx('${id}','${kind}')">Conferma ${title}</button>
      </div>
    </div>`;
  setTimeout(()=>document.getElementById('tx-amt').focus(),100);
};

window.saveInvestTx = (id,kind) => {
  const inv=getInvestById(id);
  if(!inv) return;
  const amt =parseFloat(document.getElementById('tx-amt').value)||0;
  const date=document.getElementById('tx-date').value;
  const desc=document.getElementById('tx-desc').value||(kind==='add'?'Acquisto':'Vendita');
  if(amt<=0) return;
  const realAmt=kind==='add'?amt:-amt;
  inv.balance=round(inv.balance+realAmt);
  inv.add=round(inv.add+realAmt);
  if(!inv.hist) inv.hist=[];
  inv.hist.push({id:uid(),kind,date,amt,desc});
  saveState();window.closeModal();render('invest-detail');
};

// ═══════════════════════════════════════════════════
// PAC
// ═══════════════════════════════════════════════════
const runPacSync = () => {
  const todayStr=todayISO();
  if(!state.lastPacSync){state.lastPacSync=todayStr;saveState();return;}
  let current=new Date(state.lastPacSync);
  current.setDate(current.getDate()+1);
  let changes=false;
  const today=new Date(todayStr);
  while(current<=today){
    const d=current.getDate(), w=current.getDay();
    const dateISO=current.toISOString().slice(0,10);
    state.assets.invest.forEach(inv=>{
      if(!inv.rec) return;
      const {freq,amt,day}=inv.rec;
      let match=false;
      if(freq==='monthly'&&d===day) match=true;
      if(freq==='weekly'&&w===day) match=true;
      if(match&&amt>0){
        inv.balance=round(inv.balance+amt);
        inv.add=round(inv.add+amt);
        inv.hist.push({id:uid(),kind:'add',date:dateISO,amt,desc:`PAC Auto: ${inv.name}`,isAuto:true});
        changes=true;
      }
    });
    current.setDate(current.getDate()+1);
  }
  if(changes||state.lastPacSync!==todayStr){state.lastPacSync=todayStr;saveState();}
};

window.openPacModal = id => {
  const inv=getInvestById(id);
  if(!inv) return;
  const rec=inv.rec||{amt:0,freq:'monthly',day:1};
  const draw=()=>{
    const isMonthly=rec.freq==='monthly';
    const dayLabels=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
    modalContainer.innerHTML=`
      <div class="overlay" onclick="window.closeModal()">
        <div class="sheet" onclick="event.stopPropagation()">
          <div class="sheet-handle"></div>
          <div class="sheet-title">Configura PAC - ${esc(inv.name)}</div>
          <div class="form-group"><label class="form-label">Importo ogni acquisto</label><input class="form-input" id="pac-amt" type="number" value="${rec.amt}" placeholder="0.00"/></div>
          <div class="form-group">
            <label class="form-label">Frequenza</label>
            <div style="display:flex;gap:8px;">
              <button class="chip ${isMonthly?'active':''}" onclick="window.updatePacDraft({freq:'monthly',day:1})">Mensile</button>
              <button class="chip ${!isMonthly?'active':''}" onclick="window.updatePacDraft({freq:'weekly',day:1})">Settimanale</button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">${isMonthly?'Giorno del mese':'Giorno della settimana'}</label>
            ${isMonthly?`<input class="form-input" id="pac-day" type="number" min="1" max="31" value="${rec.day}"/>`:
              `<select class="form-input" id="pac-day">${dayLabels.map((l,i)=>`<option value="${i}" ${rec.day===i?'selected':''}>${l}</option>`).join('')}</select>`}
          </div>
          <div style="background:rgba(0, 0, 0, 0.04);padding:12px;border-radius:12px;font-size:12px;color:var(--muted);margin-bottom:20px;font-weight:700;">
            L'importo verrà aggiunto automaticamente al saldo quando scatta il giorno impostato.
          </div>
          <div style="display:flex;gap:10px;">
            <button class="btn-primary" onclick="window.savePac('${id}')">Salva Progetto</button>
            ${inv.rec?'<button class="btn-primary" style="background:var(--red);" onclick="window.disablePac(\''+id+'\')"  >Disabilita</button>':''}
          </div>
        </div>
      </div>`;
  };
  window.updatePacDraft=obj=>{Object.assign(rec,obj);draw();};
  window.savePac=id=>{
    inv.rec={amt:parseFloat(document.getElementById('pac-amt').value)||0,freq:rec.freq,day:parseInt(document.getElementById('pac-day').value)||1};
    saveState();window.closeModal();render('invest-detail');
  };
  draw();
};

window.disablePac = id => {
  const inv=getInvestById(id);
  if(inv){inv.rec=null;saveState();window.closeModal();render('invest-detail');}
};

// ═══════════════════════════════════════════════════
// GLOBAL HELPERS
// ═══════════════════════════════════════════════════
