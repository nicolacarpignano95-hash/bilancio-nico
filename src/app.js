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
    rangeTo: new Date().getMonth() + 1
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
const app           = document.getElementById('app');
const modalContainer= document.getElementById('modal-container');
let lastViewId      = 'home';
window._assetConfirmId = null;

// Build the persistent app shell on first render
const ensureShell = () => {
  if(document.getElementById('app-shell')) return;
  app.innerHTML = `
    <div class="app-shell" id="app-shell">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="main-content" id="main-content">
        <div id="period-bar-slot"></div>
        <div id="page-slot" style="flex:1;min-height:0;overflow-y:auto;"></div>
      </div>
    </div>
    <!-- mobile bottom nav injected separately -->`;
};

const NAV_ITEMS = [
  { section: null,       id:'home',      label:'Home',        icon:'⌂' },
  { section: 'Analisi',  id:'nico',      label:'Nico',        icon:'◉' },
  { section: null,       id:'inlab',     label:'Inlab',       icon:'◎' },
  { section: 'Gestione', id:'movements', label:'Movimenti',   icon:'☰' },
  { section: null,       id:'clients',   label:'CRM Clienti', icon:'👥' },
  { section: null,       id:'assets',    label:'Patrimonio',  icon:'◈' },
  { section: null,       id:'taxes',     label:'Tasse',       icon:'%' },
];

const renderSidebar = activeId => {
  const sb = document.getElementById('sidebar');
  if(!sb) return;
  let html = `<div class="sidebar-logo">Bilancio <span>Nico</span></div>`;
  let lastSection = null;
  NAV_ITEMS.forEach(it => {
    if(it.section && it.section !== lastSection){
      html += `<div class="sidebar-section-label">${it.section}</div>`;
      lastSection = it.section;
    }
    html += `<button class="nav-item ${activeId===it.id?'active':''}" onclick="window.render('${it.id}')">
      <span class="nav-icon">${it.icon}</span> ${it.label}
    </button>`;
  });
  html += `<div class="sidebar-actions">
    <button class="btn-sidebar-action income" onclick="window.openIncomeModal()">＋ Entrata</button>
    <button class="btn-sidebar-action expense" onclick="window.openExpenseModal()">－ Uscita</button>
  </div>`;
  sb.innerHTML = html;
};

const renderMobileNav = activeId => {
  document.querySelector('.bottom-nav-mobile')?.remove();
  const items = [
    {id:'home',label:'Home',icon:'⌂'},
    {id:'movements',label:'Lista',icon:'☰'},
    {id:'clients',label:'CRM',icon:'👥'},
    {id:'taxes',label:'Tasse',icon:'%'}
  ];
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav-mobile';
  nav.innerHTML = items.map(it=>`
    <button class="nav-btn-mobile ${activeId===it.id?'active':''}" onclick="window.render('${it.id}')">
      <span style="font-size:18px;">${it.icon}</span>
      <span>${it.label}</span>
    </button>`).join('');
  document.body.appendChild(nav);
};

const render = (viewId='home') => {
  lastViewId = viewId;
  ensureShell();
  renderSidebar(viewId);
  renderMobileNav(viewId);
  const slot = document.getElementById('page-slot');
  if(!slot) return;
  if     (viewId==='home')          renderHomeView(slot);
  else if(viewId==='nico')          renderNicoView(slot);
  else if(viewId==='inlab')         renderInlabView(slot);
  else if(viewId==='assets')        renderAssetsView(slot);
  else if(viewId==='invest-detail') renderInvestDetail(slot);
  else if(viewId==='movements')     renderMovementsView(slot);
  else if(viewId==='clients')       renderClientsView(slot);
  else if(viewId==='taxes')         renderTaxesView(slot);
  else if(viewId==='nico-incomes')  renderNicoIncomesView(slot);
  else if(viewId==='nico-expenses') renderNicoExpensesView(slot);
};

const renderPeriodSelectors = (pageLabel='') => {
  const {month,year,period,rangeFrom,rangeTo}=state.filters;
  const years=[new Date().getFullYear(),new Date().getFullYear()-1];
  const monthSel=`<select class="filter-select" onchange="window.updateFilter('month',this.value)">${MONTHS.slice(0,12).map((n,i)=>`<option value="${i+1}" ${month===i+1?'selected':''}>${n}</option>`).join('')}</select>`;
  const yearSel =`<select class="filter-select" onchange="window.updateFilter('year',this.value)">${years.map(y=>`<option value="${y}" ${year===y?'selected':''}>${y}</option>`).join('')}</select>`;
  const rangeSel=`<div style="display:flex;align-items:center;gap:6px;"><select class="filter-select" onchange="window.updateFilter('rangeFrom',this.value)">${MS_ABBR.map((n,i)=>`<option value="${i+1}" ${rangeFrom===i+1?'selected':''}>${n}</option>`).join('')}</select><span style="font-size:10px;color:var(--muted);font-weight:800;">→</span><select class="filter-select" onchange="window.updateFilter('rangeTo',this.value)">${MS_ABBR.map((n,i)=>`<option value="${i+1}" ${rangeTo===i+1?'selected':''}>${n}</option>`).join('')}</select></div>`;
  const barSlot = document.getElementById('period-bar-slot');
  if(barSlot){
    barSlot.innerHTML=`<div class="period-bar">
      ${pageLabel?`<span class="period-bar-label">${pageLabel}</span><div style="width:1px;height:20px;background:var(--border);"></div>`:''}
      <div class="period-chips">
        <button class="chip ${period==='monthly'?'active':''}" onclick="window.updatePeriodType('monthly')">Mese</button>
        <button class="chip ${period==='annual'?'active':''}" onclick="window.updatePeriodType('annual')">Annuale</button>
        <button class="chip ${period==='range'?'active':''}" onclick="window.updatePeriodType('range')">Range</button>
      </div>
      ${period==='monthly'?monthSel:period==='range'?rangeSel:''}
      ${yearSel}
      <div style="margin-left:auto;font-size:11px;font-weight:800;color:var(--muted);">${getPeriodLabel()}</div>
    </div>`;
  }
  // Return empty string — no inline period block anymore
  return '';
};

// ═══════════════════════════════════════════════════
// HOME VIEW
// ═══════════════════════════════════════════════════
const renderOutstandingPayments = () => {
  const allMissing=state.clients.filter(c=>c.active&&calcClientStatus(c.id).missing>0.01);
  if(!allMissing.length) return '<div style="text-align:center;padding:24px 0;font-size:13px;font-weight:700;color:var(--muted);">✨ Nessun insoluto</div>';
  return allMissing.map(c=>{
    const {missing}=calcClientStatus(c.id);
    const lordo=c.monthlyAmount||c.expectedAmount||0;
    return `<div class="tx-item" onclick="window.openClientDetail('${c.id}')" style="cursor:pointer;">
      <div style="width:8px;height:8px;border-radius:50%;background:var(--amber);flex-shrink:0;"></div>
      <div class="tx-info">
        <div class="tx-label">${esc(c.name)}</div>
        <div class="tx-meta">${c.area.toUpperCase()} · ${c.payMode==='fatt'?'Fattura':'Contanti'}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-family:'Sora';font-size:14px;font-weight:800;color:var(--red);">-${fmt(missing)}</div>
        <div style="font-size:10px;color:var(--muted);font-weight:700;">atteso ${fmt(lordo)}/m</div>
      </div>
    </div>`;
  }).join('');
};

const renderMonthlyChart = (month, year) => {
  // Ultimi 6 mesi di entrate nette Nico
  const now = new Date(year, month-1, 1);
  const bars = [];
  for(let i=5; i>=0; i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const m = d.getMonth()+1, y = d.getFullYear();
    const inc = calcNicoIncome(m,y);
    const exp = calcNicoExpenses(m,y);
    bars.push({label: MS_ABBR[d.getMonth()], inc, exp});
  }
  const maxVal = Math.max(...bars.map(b=>b.inc), ...bars.map(b=>b.exp), 1);
  return bars.map(b=>`
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">
      <div style="width:100%;display:flex;flex-direction:column;align-items:center;gap:1px;height:80px;justify-content:flex-end;">
        <div style="width:70%;background:var(--green);border-radius:3px 3px 0 0;height:${Math.round((b.inc/maxVal)*72)}px;min-height:${b.inc>0?2:0}px;"></div>
        <div style="width:70%;background:var(--red);border-radius:0 0 3px 3px;height:${Math.round((b.exp/maxVal)*72)}px;min-height:${b.exp>0?2:0}px;"></div>
      </div>
      <div style="font-size:9px;color:var(--muted);font-weight:800;">${b.label}</div>
    </div>`).join('');
};

const renderHomeView = (slot) => {
  const {month,year}=state.filters;
  const net=calcNicoNet(month,year);
  const inlab=calcInlabTotal(month,year);
  const inc=calcNicoIncome(month,year), exp=calcNicoExpenses(month,year);
  const tot=getWealthTotal();
  const stipendio=calcStipendioStimato();
  const bal=calcInlabBalance(month,year);
  const liq=getLiquidTotal();
  const inv=getInvestTotal();

  // Ultimi 5 movimenti ordinati per data desc, con amount > 0
  const recentTx = [...state.transactions]
    .filter(tx => tx.amount > 0)
    .sort((a,b)=>(b.date||'').localeCompare(a.date||''))
    .slice(0,5);

  const catIcon = cat => {
    const map = {
      'Necessità':'🏠','Extra':'🛍️','Lavoro':'💼','Viaggi':'✈️',
      'Cibo':'🍽️','Salute':'💊','Casa':'🏡','Abbonamenti':'📱',
      'Stipendio':'💰','Freelance':'🧑‍💻','Inlab':'🏢','Affitto':'🏠',
      'default':'💳'
    };
    return map[cat] || map['default'];
  };

  const recentHtml = recentTx.length ? recentTx.map(tx=>{
    const isInc = tx.kind==='income';
    const icon = catIcon(tx.category);
    const area = tx.area==='inlab' ? `<span style="font-size:9px;font-weight:700;background:#f0f0f0;color:#888;border-radius:3px;padding:1px 4px;margin-left:5px;letter-spacing:.04em;">INLAB</span>` : '';
    const dateStr = tx.date ? new Date(tx.date).toLocaleDateString('it-IT',{day:'2-digit',month:'short'}) : '—';
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.05);">
      <div style="width:36px;height:36px;border-radius:10px;background:${isInc?'#f0faf5':'#fef2f2'};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">${icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(tx.label||tx.category||'—')}${area}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:1px;">${dateStr}${tx.category?' · '+esc(tx.category):''}</div>
      </div>
      <div style="font-family:'Sora';font-size:14px;font-weight:800;color:${isInc?'#059669':'#dc2626'};flex-shrink:0;">${isInc?'+':'−'}${fmt(Math.abs(tx.amount||0))}</div>
    </div>`;
  }).join('') : `<div style="text-align:center;padding:24px 0;font-size:12px;font-weight:700;color:#9ca3af;">Nessun movimento</div>`;

  renderPeriodSelectors('Dashboard');
  slot.innerHTML=`<div class="page fade-up" style="padding:24px 28px;">

    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;">
      <div>
        <div style="font-family:'Sora';font-size:24px;font-weight:800;letter-spacing:-0.04em;color:#000;">Panoramica</div>
        <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.12em;margin-top:3px;">${getPeriodLabel()}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn-primary" onclick="window.openIncomeModal()" style="gap:6px;padding:10px 18px;">＋ Entrata</button>
        <button class="btn-ghost" onclick="window.openExpenseModal()" style="padding:10px 18px;">－ Uscita</button>
      </div>
    </div>

    <!-- Hero KPI row -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">

      <!-- Netto Nico — hero card -->
      <div onclick="window.render('nico')" style="cursor:pointer;background:${net>=0?'#f0fdf4':'#fff1f2'};border:1.5px solid ${net>=0?'#bbf7d0':'#fecdd3'};border-radius:16px;padding:20px;transition:transform .15s,box-shadow .15s;" onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.08)'" onmouseleave="this.style.transform='';this.style.boxShadow=''">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:${net>=0?'#16a34a':'#dc2626'};margin-bottom:10px;">Netto Nico</div>
        <div style="font-family:'Sora';font-size:28px;font-weight:800;letter-spacing:-0.04em;color:${net>=0?'#15803d':'#b91c1c'};line-height:1;">${fmt(net)}</div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid ${net>=0?'#bbf7d0':'#fecdd3'};display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:11px;font-weight:700;color:${net>=0?'#16a34a':'#dc2626'};">${net>=0?'↑':'↓'} ${fmt(inc)} entr.</div>
          <div style="font-size:10px;color:#9ca3af;font-weight:700;">↗ Dettaglio</div>
        </div>
      </div>

      <!-- Inlab -->
      <div onclick="window.render('inlab')" style="cursor:pointer;background:#fff;border:1.5px solid rgba(0,0,0,0.08);border-radius:16px;padding:20px;transition:transform .15s,box-shadow .15s;" onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.08)'" onmouseleave="this.style.transform='';this.style.boxShadow=''">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#6b7280;margin-bottom:10px;">Giro Inlab</div>
        <div style="font-family:'Sora';font-size:28px;font-weight:800;letter-spacing:-0.04em;color:#111;line-height:1;">${fmt(inlab)}</div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(0,0,0,0.06);display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;">Quota: ${fmt(bal.nicoShare)}</div>
          <div style="font-size:10px;color:#9ca3af;font-weight:700;">↗ Dettaglio</div>
        </div>
      </div>

      <!-- Patrimonio -->
      <div onclick="window.render('assets')" style="cursor:pointer;background:#fff;border:1.5px solid rgba(0,0,0,0.08);border-radius:16px;padding:20px;transition:transform .15s,box-shadow .15s;" onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.08)'" onmouseleave="this.style.transform='';this.style.boxShadow=''">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#059669;margin-bottom:10px;">Patrimonio</div>
        <div style="font-family:'Sora';font-size:28px;font-weight:800;letter-spacing:-0.04em;color:#111;line-height:1;">${fmt(tot)}</div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(0,0,0,0.06);display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:11px;font-weight:700;color:#059669;">${fmt(liq)} liq</div>
          <div style="font-size:11px;font-weight:700;color:#374151;">${fmt(inv)} inv</div>
        </div>
      </div>

      <!-- Stipendio stimato -->
      <div onclick="window.render('taxes')" style="cursor:pointer;background:#fffbeb;border:1.5px solid #fde68a;border-radius:16px;padding:20px;transition:transform .15s,box-shadow .15s;" onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.08)'" onmouseleave="this.style.transform='';this.style.boxShadow=''">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#d97706;margin-bottom:10px;">Stipendio stimato</div>
        <div style="font-family:'Sora';font-size:28px;font-weight:800;letter-spacing:-0.04em;color:#92400e;line-height:1;">${fmt(stipendio)}</div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid #fde68a;display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:11px;font-weight:700;color:#d97706;">Clienti attivi × quota</div>
          <div style="font-size:10px;color:#9ca3af;font-weight:700;">↗</div>
        </div>
      </div>
    </div>

    <!-- Bottom: grafico + pannello destro -->
    <div style="display:grid;grid-template-columns:1fr 340px;gap:16px;">

      <!-- Grafico entrate/uscite -->
      <div style="background:#fff;border:1.5px solid rgba(0,0,0,0.08);border-radius:16px;padding:24px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
          <div>
            <div style="font-size:13px;font-weight:800;color:#111;letter-spacing:-0.01em;">Entrate vs Uscite</div>
            <div style="font-size:11px;color:#9ca3af;font-weight:600;margin-top:2px;">Ultimi 6 mesi</div>
            <div style="display:flex;gap:12px;margin-top:8px;">
              <div style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#9ca3af;">
                <span style="width:10px;height:10px;border-radius:3px;background:#10b981;display:inline-block;"></span>Entrate
              </div>
              <div style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#9ca3af;">
                <span style="width:10px;height:10px;border-radius:3px;background:#f87171;display:inline-block;"></span>Uscite
              </div>
            </div>
          </div>
          <div style="text-align:right;background:${net>=0?'#f0fdf4':'#fff1f2'};border-radius:12px;padding:10px 14px;">
            <div style="font-size:9px;font-weight:800;color:${net>=0?'#16a34a':'#dc2626'};text-transform:uppercase;letter-spacing:.1em;">Saldo mese</div>
            <div style="font-family:'Sora';font-size:20px;font-weight:800;color:${net>=0?'#15803d':'#b91c1c'};margin-top:2px;">${fmt(net)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:90px;">
          ${renderMonthlyChart(month,year)}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;margin-top:20px;padding-top:16px;border-top:1px solid rgba(0,0,0,0.05);">
          <div style="padding-right:16px;border-right:1px solid rgba(0,0,0,0.05);">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af;margin-bottom:4px;">Entrate</div>
            <div style="font-family:'Sora';font-size:20px;font-weight:800;color:#059669;">${fmt(inc)}</div>
          </div>
          <div style="padding:0 16px;border-right:1px solid rgba(0,0,0,0.05);">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af;margin-bottom:4px;">Uscite</div>
            <div style="font-family:'Sora';font-size:20px;font-weight:800;color:#dc2626;">−${fmt(exp)}</div>
          </div>
          <div style="padding-left:16px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af;margin-bottom:4px;">Saldo</div>
            <div style="font-family:'Sora';font-size:20px;font-weight:800;color:${net>=0?'#059669':'#dc2626'};">${fmt(net)}</div>
          </div>
        </div>
      </div>

      <!-- Colonna destra -->
      <div style="display:flex;flex-direction:column;gap:14px;">

        <!-- Ultimi movimenti -->
        <div style="background:#fff;border:1.5px solid rgba(0,0,0,0.08);border-radius:16px;padding:20px;flex:1;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <div style="font-size:13px;font-weight:800;color:#111;">Ultimi movimenti</div>
            <button onclick="window.render('movements')" style="font-size:11px;font-weight:700;color:#6b7280;background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:6px;transition:background .1s;" onmouseenter="this.style.background='#f3f4f6'" onmouseleave="this.style.background='none'">Vedi tutti →</button>
          </div>
          ${recentHtml}
        </div>

        <!-- Insoluti clienti -->
        <div style="background:#fff;border:1.5px solid rgba(0,0,0,0.08);border-radius:16px;padding:20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <div style="font-size:13px;font-weight:800;color:#111;">Da incassare</div>
            <button onclick="window.render('clients')" style="font-size:11px;font-weight:700;color:#6b7280;background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:6px;transition:background .1s;" onmouseenter="this.style.background='#f3f4f6'" onmouseleave="this.style.background='none'">Vedi tutti →</button>
          </div>
          ${renderOutstandingPayments()}
        </div>

      </div>
    </div>
  </div>`;
};
// ═══════════════════════════════════════════════════
// NICO VIEW
// ═══════════════════════════════════════════════════
const renderNicoView = (slot) => {
  const {month,year}=state.filters;
  const inc=calcNicoIncome(month,year), exp=calcNicoExpenses(month,year), net=round(inc-exp);
  const goal=state.settings.savingsGoal||10000, gp=Math.min(100,Math.max(0,(net/goal)*100));
  const tot=getWealthTotal();
  const totV1=round(state.assets.invest.reduce((s,i)=>s+(i.v1||0),0)+(state.assets.liquidInitial||0));
  const diff=round(tot-totV1), diffPct=totV1>0?round((diff/totV1)*100):0;
  renderPeriodSelectors('Analisi Nico');
  slot.innerHTML=`<div class="page fade-up">
    <div class="page-header">
      <div class="page-title">Analisi Nico</div>
      <div class="page-sub">${getPeriodLabel()}</div>
    </div>

    <div class="grid-3" style="margin-bottom:20px;">
      <div class="kpi-card" style="cursor:pointer;border-left:3px solid var(--green);" onclick="window.render('nico-incomes')">
        <div class="kpi-label">Entrate ↗</div>
        <div class="kpi-val" style="color:var(--green);">${fmt(inc)}</div>
        <div class="kpi-delta">Tocca per dettaglio</div>
      </div>
      <div class="kpi-card" style="cursor:pointer;border-left:3px solid var(--red);" onclick="window.render('nico-expenses')">
        <div class="kpi-label">Uscite ↗</div>
        <div class="kpi-val" style="color:var(--red);">-${fmt(exp)}</div>
        <div class="kpi-delta">Tocca per dettaglio</div>
      </div>
      <div class="kpi-card" style="border-left:3px solid #000;">
        <div class="kpi-label">Risparmio Netto</div>
        <div class="kpi-val" style="color:${net>=0?'#000':'var(--red)'};">${fmt(net)}</div>
        <div style="margin-top:8px;">
          <div class="progress-wrap"><div class="progress-bar" style="width:${gp}%;"></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;font-weight:800;color:var(--muted);">
            <span>Target ${fmt(goal)}</span><span>${gp.toFixed(0)}%</span>
          </div>
        </div>
      </div>
    </div>

    <div class="two-panel">
      <div>
        <div class="card" style="margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <div class="card-title" style="margin-bottom:0;">Patrimonio Totale</div>
            <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:800;color:${diff>=0?'var(--green)':'var(--red)'};">
              ${diff>=0?'↑':'↓'} ${Math.abs(diffPct).toFixed(1)}% YTD
            </div>
          </div>
          <div style="font-family:'Sora';font-size:36px;font-weight:800;letter-spacing:-0.04em;margin-bottom:20px;">${fmt(tot)}</div>
          <div style="display:flex;align-items:center;gap:24px;">
            <div style="position:relative;width:120px;height:120px;flex-shrink:0;">
              <canvas id="pie-wealth" width="120" height="120"></canvas>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;">
                <div style="font-size:9px;font-weight:800;color:#000;">TOTALE</div>
              </div>
            </div>
            <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;">
                  <span style="width:8px;height:8px;border-radius:50%;background:#000;flex-shrink:0;"></span> Liquidità
                </div>
                <div style="font-size:12px;font-weight:800;">${fmt(getLiquidTotal())}</div>
              </div>
              ${state.assets.invest.map(i=>`
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                  <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;">
                    <span style="width:8px;height:8px;border-radius:50%;background:${i.color};flex-shrink:0;"></span> ${esc(i.name)}
                  </div>
                  <div style="font-size:12px;font-weight:800;">${fmt(i.balance)}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title" style="margin-bottom:12px;">Evoluzione Patrimonio</div>
          <div style="height:140px;position:relative;"><canvas id="evolution-chart"></canvas></div>
        </div>
      </div>

      <div>
        <button class="btn-primary full" style="margin-bottom:16px;" onclick="window.render('assets')">
          <span>Dashboard Patrimoniale</span><span>›</span>
        </button>
        <div class="card">
          <div class="card-title">Liquidità per conto</div>
          ${state.assets.liquid.map(acc=>`
            <div class="tx-item" style="cursor:default;">
              <div class="tx-dot" style="background:${acc.color}"></div>
              <div class="tx-info"><div class="tx-label">${esc(acc.name)}</div></div>
              <div style="font-family:'Sora';font-size:13px;font-weight:800;">${fmt(acc.balance)}</div>
            </div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
  setTimeout(()=>{ initWealthPie(); initEvolutionChart(); },100);
};

// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// NICO — INCOMES DETAIL VIEW
// ═══════════════════════════════════════════════════
const renderNicoIncomesView = (slot) => {
  const {month,year}=state.filters;
  const txs=state.transactions.filter(t=>inPeriod(t,month,year)&&t.kind==='income').sort((a,b)=>new Date(b.date)-new Date(a.date));
  const totalFatt=txs.filter(t=>t.payMode==='fatt').reduce((s,t)=>s+(parseFloat(t.gross)||0),0);
  const totalCont=txs.filter(t=>t.payMode==='cont').reduce((s,t)=>s+(parseFloat(t.gross)||0),0);
  renderPeriodSelectors('Entrate Nico');
  slot.innerHTML=`<div class="page fade-up">
    <button class="btn-back" onclick="window.render('nico')">← Nico</button>
    <div class="page-header"><div class="page-title">Entrate</div><div class="page-sub">${getPeriodLabel()}</div></div>
    <div class="two-panel">
      <div class="card">
        <div class="tx-list">
          ${txs.length?txs.map(t=>`
            <div class="tx-item" onclick="window.openDetail('${t.id}')">
              <div class="tx-dot" style="background:var(--green)"></div>
              <div class="tx-info">
                <div class="tx-label">${esc(t.desc||t.area.toUpperCase())}</div>
                <div class="tx-meta">${t.area.toUpperCase()} · ${t.payMode==='fatt'?'Fattura':'Contanti'} · ${fmtDate(t.date)}</div>
              </div>
              <div class="tx-amount pos">+${fmt(t.gross)}</div>
            </div>`).join(''):'<div class="empty">Nessuna entrata</div>'}
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title">Riepilogo</div>
          <div style="display:flex;flex-direction:column;gap:14px;margin-top:10px;">
            <div><div style="font-size:10px;color:var(--muted);font-weight:800;margin-bottom:2px;">Fattura</div><div style="font-family:'Sora';font-size:22px;font-weight:800;color:var(--green);">${fmt(totalFatt)}</div></div>
            <div><div style="font-size:10px;color:var(--muted);font-weight:800;margin-bottom:2px;">Contanti</div><div style="font-family:'Sora';font-size:22px;font-weight:800;color:var(--green);">${fmt(totalCont)}</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
};

// ═══════════════════════════════════════════════════
// NICO — EXPENSES DETAIL VIEW
// ═══════════════════════════════════════════════════
const renderNicoExpensesView = (slot) => {
  const {month,year}=state.filters;
  const txs=state.transactions.filter(t=>inPeriod(t,month,year)&&t.kind==='expense').sort((a,b)=>new Date(b.date)-new Date(a.date));
  const nicoTxs=txs.map(t=>{const g=parseFloat(t.gross)||0;return {...t,nicoAmt:t.area==='nico'?g:round(g*0.5)};});
  const totNico=round(nicoTxs.reduce((s,t)=>s+t.nicoAmt,0));
  const cats={};
  nicoTxs.forEach(t=>{const cat=t.category||'Altro';cats[cat]=(cats[cat]||0)+t.nicoAmt;});
  renderPeriodSelectors('Uscite Nico');
  slot.innerHTML=`<div class="page fade-up">
    <button class="btn-back" onclick="window.render('nico')">← Nico</button>
    <div class="page-header"><div class="page-title">Uscite</div><div class="page-sub">${getPeriodLabel()}</div></div>
    <div class="two-panel">
      <div class="card">
        <div class="tx-list">
          ${nicoTxs.length?nicoTxs.map(t=>`
            <div class="tx-item" onclick="window.openDetail('${t.id}')">
              <div class="tx-dot" style="background:var(--red)"></div>
              <div class="tx-info">
                <div class="tx-label">${esc(t.desc||t.area.toUpperCase())}</div>
                <div class="tx-meta">${t.area==='inlab'?'Inlab (tua metà)':'Personale'} · ${t.category||'Altro'} · ${fmtDate(t.date)}</div>
              </div>
              <div class="tx-amount neg">-${fmt(t.nicoAmt)}</div>
            </div>`).join(''):'<div class="empty">Nessuna uscita</div>'}
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:14px;">
          <div class="card-title">Totale</div>
          <div style="font-family:'Sora';font-size:26px;font-weight:800;color:var(--red);">-${fmt(totNico)}</div>
        </div>
        ${Object.keys(cats).length?`<div class="card"><div class="card-title">Per categoria</div><div style="margin-top:8px;">${Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.04);"><div style="font-size:13px;font-weight:700;">${esc(cat)}</div><div style="font-size:13px;font-weight:800;color:var(--red);">${fmt(amt)}</div></div>`).join('')}</div></div>`:''}
      </div>
    </div>
  </div>`;
};

// INLAB VIEW
// ═══════════════════════════════════════════════════
const renderInlabView = (slot) => {
  const {month,year}=state.filters;
  const inlabTotal = calcInlabTotal(month,year);
  const inlabExp   = calcInlabExpenses(month,year);
  const bal        = calcInlabBalance(month,year);
  const list=state.transactions.filter(t=>inPeriod(t,month,year)&&t.area==='inlab').sort((a,b)=>new Date(b.date)-new Date(a.date));
  const saldo = bal.saldo;
  let balanceHtml='';
  if(Math.abs(saldo)<0.01){
    balanceHtml='<div style="padding:12px;background:rgba(16,185,129,0.08);border-radius:10px;text-align:center;font-size:13px;font-weight:800;color:var(--green);">✓ In pari</div>';
  } else if(saldo>0){
    balanceHtml=`<div style="padding:12px;background:rgba(0,0,0,0.04);border-radius:10px;"><div style="font-size:10px;color:var(--muted);font-weight:900;margin-bottom:4px;">NICO DEVE AD ILARIA</div><div style="font-family:'Sora';font-size:22px;font-weight:800;">${fmt(saldo)}</div></div>`;
  } else {
    balanceHtml=`<div style="padding:12px;background:rgba(239,68,68,0.05);border-radius:10px;"><div style="font-size:10px;color:var(--muted);font-weight:900;margin-bottom:4px;">ILARIA DEVE A NICO</div><div style="font-family:'Sora';font-size:22px;font-weight:800;color:var(--red);">${fmt(Math.abs(saldo))}</div></div>`;
  }
  renderPeriodSelectors('Inlab Core');
  slot.innerHTML=`<div class="page fade-up">
    <div class="page-header"><div class="page-title">Inlab Core</div><div class="page-sub">${getPeriodLabel()}</div></div>
    <div class="grid-3" style="margin-bottom:20px;">
      <div class="kpi-card" style="border-left:3px solid #000;"><div class="kpi-label">Giro d'affari</div><div class="kpi-val">${fmt(inlabTotal)}</div></div>
      <div class="kpi-card" style="border-left:3px solid var(--red);"><div class="kpi-label">Spese Inlab</div><div class="kpi-val" style="color:var(--red);">-${fmt(inlabExp)}</div></div>
      <div class="kpi-card" style="border-left:3px solid var(--green);"><div class="kpi-label">Netto</div><div class="kpi-val" style="color:var(--green);">${fmt(round(inlabTotal-inlabExp))}</div></div>
    </div>
    <div class="two-panel">
      <div>
        <div class="card" style="margin-bottom:16px;">
          <div class="card-title" style="margin-bottom:12px;">Movimenti Inlab</div>
          <div class="tx-list">
            ${list.length?list.map(t=>`
              <div class="tx-item" onclick="window.openDetail('${t.id}')">
                <div class="tx-dot" style="background:${t.kind==='income'?'var(--green)':t.kind==='transfer'?'#8b5cf6':'var(--red)'}"></div>
                <div class="tx-info">
                  <div class="tx-label">${esc(t.desc||'Inlab')}</div>
                  <div class="tx-meta">${fmtDate(t.date)}${t.collector?' · Inc.: '+t.collector:''}${t.paidBy?' · Pagato: '+t.paidBy:''}${t.kind==='transfer'?' · '+t.from+' → '+t.to:''}</div>
                </div>
                <div class="tx-amount ${t.kind==='income'?'pos':t.kind==='transfer'?'':'neg'}">${t.kind==='income'?'+':t.kind==='transfer'?'↔':'-'}${fmt(t.gross)}</div>
              </div>`).join(''):'<div class="empty">Nessun movimento</div>'}
          </div>
        </div>
        <button class="btn-primary full" onclick="window.openTransferModal()"><span>💸 Registra Trasferimento</span><span>›</span></button>
      </div>
      <div>
        <div class="card" style="margin-bottom:14px;">
          <div class="card-title" style="margin-bottom:10px;">Quote Soci</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div><div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:2px;">Quota Nico</div><div style="font-family:'Sora';font-size:20px;font-weight:800;">${fmt(bal.nicoShare)}</div></div>
            <div><div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:2px;">Quota Ilaria</div><div style="font-family:'Sora';font-size:20px;font-weight:800;">${fmt(bal.ilariaShare)}</div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:10px;">Saldo tra Soci</div>
          ${balanceHtml}
          <div style="font-size:11px;color:var(--muted);font-weight:700;margin-top:8px;">Nico incassato: ${fmt(bal.nicoHaInc)} · Spettante: ${fmt(bal.nicoSpetta)}</div>
        </div>
      </div>
    </div>
  </div>`;
};

const renderAssetsView = (slot) => {
  renderPeriodSelectors('Patrimonio');
  slot.innerHTML=`<div class="page fade-up">
    <div class="page-header"><div class="page-title">Patrimonio</div><div class="page-sub">${fmt(getWealthTotal())}</div></div>
    <div class="two-panel">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div class="section-label" style="margin:0;">Liquidità · ${fmt(getLiquidTotal())}</div>
          <button class="chip active" onclick="window.openAddAssetModal('liquid')">＋ Aggiungi</button>
        </div>
        <div class="card" style="margin-bottom:20px;">
          ${state.assets.liquid.map(acc=>`
            <div class="tx-item">
              <div class="tx-dot" style="background:${acc.color}"></div>
              <div class="tx-info"><div class="tx-label">${esc(acc.name)}</div></div>
              <div style="display:flex;align-items:center;gap:8px;">
                <input class="amount-input inline-amount-input" type="number" inputmode="decimal" value="${acc.balance}" oninput="window.updateLiquidBalance('${acc.id}',this.value)"/>
                ${window._assetConfirmId===acc.id?`<button style="background:var(--red);border:none;color:#fff;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer;" onclick="window.deleteAsset('liquid','${acc.id}')">SICURO?</button>`:`<button style="background:none;border:none;color:var(--red);font-size:14px;cursor:pointer;" onclick="window.deleteAsset('liquid','${acc.id}')">✕</button>`}
              </div>
            </div>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div class="section-label" style="margin:0;">Investimenti · ${fmt(getInvestTotal())}</div>
          <button class="chip active" onclick="window.openAddAssetModal('invest')">＋ Aggiungi</button>
        </div>
        <div class="card">
          ${state.assets.invest.map(inv=>`
            <div class="tx-item">
              <div class="tx-dot" style="background:${inv.color};cursor:pointer;" onclick="window.openInvestDetail('${inv.id}')"></div>
              <div class="tx-info" onclick="window.openInvestDetail('${inv.id}')" style="cursor:pointer;">
                <div class="tx-label">${esc(inv.name)}</div>
                ${inv.rec?`<div class="pac-badge">● PAC ${fmt(inv.rec.amt)}</div>`:''}
              </div>
              <div class="tx-amount" onclick="window.openInvestDetail('${inv.id}')" style="cursor:pointer;">${fmt(inv.balance)}</div>
              ${window._assetConfirmId===inv.id?`<button style="background:var(--red);border:none;color:#fff;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:800;cursor:pointer;margin-left:8px;" onclick="window.deleteAsset('invest','${inv.id}')">SICURO?</button>`:`<button style="background:none;border:none;color:var(--red);font-size:14px;cursor:pointer;margin-left:8px;" onclick="window.deleteAsset('invest','${inv.id}')">✕</button>`}
            </div>`).join('')}
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title">Impostazioni</div>
          <label class="form-label" style="margin-top:10px;">Liquidità totale al 1 Gen ${state.filters.year}</label>
          <input class="form-input" type="number" value="${state.assets.liquidInitial||0}" onchange="window.updateAssetSetting('liquidInitial',this.value)"/>
          <div style="font-size:11px;color:var(--muted);margin-top:6px;font-weight:600;">Usato per calcolare la crescita % annuale del patrimonio</div>
        </div>
      </div>
    </div>
  </div>`;
};

const renderInvestDetail = (slot) => {
  const inv=getInvestById(state.activeInvestId);
  if(!inv) return render('assets');
  if(inv.v0===undefined) inv.v0=inv.v1;
  const curYear = state.filters.year;
  const addsYTD = (inv.hist||[]).filter(h=>new Date(h.date).getFullYear()===curYear).reduce((s,h)=>s+(h.kind==='rem'?-h.amt:h.amt),0);
  const addsAll = (inv.hist||[]).reduce((s,h)=>s+(h.kind==='rem'?-h.amt:h.amt),0);
  const gainYTD=round(inv.balance-inv.v1-addsYTD), costYTD=inv.v1+addsYTD;
  const pctYTD=costYTD>0?round((gainYTD/costYTD)*100):0;
  const gainAllTime=round(inv.balance-inv.v0-addsAll), costAll=inv.v0+addsAll;
  const pctAllTime=costAll>0?round((gainAllTime/costAll)*100):0;
  renderPeriodSelectors('Portfolio');
  slot.innerHTML=`<div class="page fade-up">
    <button class="btn-back" onclick="window.render('assets')">← Patrimonio</button>
    <div class="page-header"><div class="page-title">${esc(inv.name)}</div><div class="page-sub">Asset Profilo</div></div>
    <div class="two-panel">
      <div>
        <div class="grid-2" style="margin-bottom:16px;">
          <div class="kpi-card" style="border-left:3px solid #000;"><div class="kpi-label">Valore Attuale</div><div class="kpi-val">${fmt(inv.balance)}</div></div>
          <div class="kpi-card" style="border-left:3px solid ${gainYTD>=0?'var(--green)':'var(--red)'};"><div class="kpi-label">Rendimento YTD</div><div class="kpi-val" style="color:${gainYTD>=0?'var(--green)':'var(--red)'};">${pct(pctYTD)}</div><div class="kpi-delta">${fmt(gainYTD)}</div></div>
        </div>
        <div class="card" style="margin-bottom:16px;">
          <div class="card-title">Andamento ${state.filters.year}</div>
          <div style="height:200px;position:relative;margin-top:10px;"><canvas id="invest-history-chart"></canvas></div>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:16px;">
          <button class="btn-primary" style="flex:1;background:var(--green);" onclick="window.openInvestTxModal('${inv.id}','add')">Acquista</button>
          <button class="btn-primary" style="flex:1;background:var(--red);" onclick="window.openInvestTxModal('${inv.id}','rem')">Vendi</button>
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:14px;">
          <div class="card-title" style="margin-bottom:12px;">PAC — Investimento ricorrente</div>
          ${inv.rec?`<div style="display:flex;justify-content:space-between;align-items:center;">
            <div><div style="font-size:15px;font-weight:800;">${fmt(inv.rec.amt)} / mese</div><div style="font-size:11px;color:var(--muted);font-weight:700;">Giorno ${inv.rec.day}</div></div>
            <button class="chip active" onclick="window.openPacModal('${inv.id}')">Gestisci</button>
          </div>`:`<button class="btn-ghost" style="width:100%;" onclick="window.openPacModal('${inv.id}')">＋ Attiva PAC</button>`}
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:12px;">Impostazioni</div>
          <div class="form-group"><label class="form-label">Valore Iniziale Storico (v0)</label><input class="form-input" type="number" value="${inv.v0||0}" onchange="window.updateInvestProp('${inv.id}','v0',this.value)"/></div>
          <div class="form-group"><label class="form-label">Valore 1 Gen ${state.filters.year}</label><input class="form-input" type="number" value="${inv.v1}" onchange="window.updateInvestProp('${inv.id}','v1',this.value)"/></div>
          <div class="form-group"><label class="form-label">Aggiunte ${curYear}</label><div style="background:rgba(0,0,0,0.03);padding:10px 14px;border-radius:10px;font-weight:800;">${fmt(addsYTD)}</div></div>
          <div class="form-group"><label class="form-label">Valore Corrente (Manuale)</label><input class="form-input" type="number" value="${inv.balance}" onchange="window.updateInvestProp('${inv.id}','balance',this.value)"/></div>
          <div style="display:flex;gap:8px;margin-top:4px;">
            <div class="kpi-card" style="flex:1;"><div class="kpi-label">Rendimento Totale</div><div style="font-family:'Sora';font-size:16px;font-weight:800;color:${gainAllTime>=0?'var(--green)':'var(--red)'};">${pct(pctAllTime)} (${fmt(gainAllTime)})</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  setTimeout(()=>initInvestHistoryChart(inv.id),100);
};

// MOVEMENTS VIEW (con filtri)
// ═══════════════════════════════════════════════════
const renderMovementsView = (slot) => {
  const {month,year}=state.filters;
  const {kind,area,search}=state.txFilters;
  let list=state.transactions.filter(t=>inPeriod(t,month,year));
  if(kind!=='all') list=list.filter(t=>t.kind===kind);
  if(area!=='all') list=list.filter(t=>t.area===area||t.kind==='transfer');
  if(search.trim()) list=list.filter(t=>(t.desc||''). toLowerCase().includes(search.toLowerCase()));
  list=list.sort((a,b)=>new Date(b.date)-new Date(a.date));
  renderPeriodSelectors('Movimenti');
  slot.innerHTML=`<div class="page fade-up">
    <div class="page-header"><div class="page-title">Movimenti</div><div class="page-sub">${getPeriodLabel()} · ${list.length} voci</div></div>
    <div class="two-panel">
      <div class="card">
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
          <button class="chip ${kind==='all'?'active':''}" onclick="window.setTxFilter('kind','all')">Tutto</button>
          <button class="chip ${kind==='income'?'active':''}" onclick="window.setTxFilter('kind','income')">Entrate</button>
          <button class="chip ${kind==='expense'?'active':''}" onclick="window.setTxFilter('kind','expense')">Uscite</button>
          <span style="width:1px;background:var(--border);margin:0 2px;"></span>
          <button class="chip ${area==='all'?'active':''}" onclick="window.setTxFilter('area','all')">Tutti</button>
          <button class="chip ${area==='nico'?'active':''}" onclick="window.setTxFilter('area','nico')">Nico</button>
          <button class="chip ${area==='inlab'?'active':''}" onclick="window.setTxFilter('area','inlab')">Inlab</button>
        </div>
        <input class="form-input" style="margin-bottom:16px;" placeholder="🔍 Cerca per parola chiave..." value="${esc(search)}" oninput="window.setTxSearch(this.value)"/>
        <div class="tx-list">
          ${list.length?list.map(t=>{
            const isT=t.kind==='transfer';
            const dot=t.kind==='income'?'var(--green)':isT?'#8b5cf6':'var(--red)';
            const cls=t.kind==='income'?'pos':'neg';
            const pfx=t.kind==='income'?'+':isT?'↔':'-';
            let meta=t.area.toUpperCase();
            if(t.collector) meta+=' · Inc.: '+t.collector;
            if(t.paidBy&&t.area==='inlab') meta+=' · Pagato: '+t.paidBy;
            if(isT) meta='Trasf. '+t.from+' → '+t.to;
            if(t.category) meta+=' · '+t.category;
            meta+=' · '+fmtDate(t.date);
            return `<div class="tx-item" onclick="window.openDetail('${t.id}')">
              <div class="tx-dot" style="background:${dot}"></div>
              <div class="tx-info"><div class="tx-label">${esc(t.desc||(t.area==='nico'?'Nico':'Inlab'))}</div><div class="tx-meta">${meta}</div></div>
              <div class="tx-amount ${isT?'':cls}" style="${isT?'color:#8b5cf6;':''}">${pfx}${fmt(t.gross)}</div>
            </div>`;
          }).join(''):'<div class="empty">Nessun movimento</div>'}
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title">Riepilogo periodo</div>
          <div style="display:flex;flex-direction:column;gap:12px;margin-top:10px;">
            <div><div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:2px;">Entrate</div><div style="font-family:'Sora';font-size:20px;font-weight:800;color:var(--green);">+${fmt(list.filter(t=>t.kind==='income').reduce((s,t)=>s+(parseFloat(t.gross)||0),0))}</div></div>
            <div><div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:2px;">Uscite</div><div style="font-family:'Sora';font-size:20px;font-weight:800;color:var(--red);">-${fmt(list.filter(t=>t.kind==='expense').reduce((s,t)=>s+(parseFloat(t.gross)||0),0))}</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
};

window.setTxFilter = (key, val) => {
  state.txFilters[key]=val;
  render('movements');
};
window.setTxSearch = val => {
  state.txFilters.search=val;
  render('movements');
};

// ═══════════════════════════════════════════════════
// CLIENTS VIEW
// ═══════════════════════════════════════════════════
const renderClientsView = (slot) => {
  const stipendio = calcStipendioStimato();
  let {clientSearch='',clientArea='all',clientPay='all'} = state.clientFilters || {};
  let clients = state.clients;
  if(clientArea!=='all') clients=clients.filter(c=>c.area===clientArea);
  if(clientPay!=='all')  clients=clients.filter(c=>c.payMode===clientPay);
  if(clientSearch.trim()) clients=clients.filter(c=>c.name.toLowerCase().includes(clientSearch.toLowerCase()));
  renderPeriodSelectors('CRM Clienti');
  slot.innerHTML=`<div class="page fade-up">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div class="page-header" style="margin-bottom:0;"><div class="page-title">CRM Clienti</div><div class="page-sub">Gestione Anagrafica</div></div>
      <button class="btn-primary" onclick="window.openAddClientModal()">＋ Nuovo Cliente</button>
    </div>
    <div class="two-panel">
      <div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          <button class="chip ${clientArea==='all'?'active':''}" onclick="window.setClientFilter('clientArea','all')">Tutti</button>
          <button class="chip ${clientArea==='nico'?'active':''}" onclick="window.setClientFilter('clientArea','nico')">Nico</button>
          <button class="chip ${clientArea==='inlab'?'active':''}" onclick="window.setClientFilter('clientArea','inlab')">Inlab</button>
          <span style="width:1px;background:var(--border);margin:0 2px;"></span>
          <button class="chip ${clientPay==='all'?'active':''}" onclick="window.setClientFilter('clientPay','all')">Tutti</button>
          <button class="chip ${clientPay==='fatt'?'active':''}" onclick="window.setClientFilter('clientPay','fatt')">Fattura</button>
          <button class="chip ${clientPay==='cont'?'active':''}" onclick="window.setClientFilter('clientPay','cont')">Contanti</button>
        </div>
        <input class="form-input" style="margin-bottom:14px;" placeholder="🔍 Cerca cliente..." value="${esc(clientSearch)}" id="client-search-input" oninput="window.setClientSearch(this.value)"/>
        <div class="card">
          <div class="tx-list" id="clients-list">
            ${clients.map(c=>{
              const {missing}=calcClientStatus(c.id);
              const dot=!c.active?'var(--muted)':missing>0.01?'var(--amber)':'var(--green)';
              const lordo=c.monthlyAmount||c.expectedAmount||0;
              const nettoNico=(()=>{
                if(c.area==='nico') return c.payMode==='fatt'?round(lordo*0.75):lordo;
                const net=c.payMode==='fatt'?round(lordo*0.75):lordo;
                return round(net*0.5);
              })();
              return `<div class="tx-item" onclick="window.openClientDetail('${c.id}')" data-client-id="${c.id}" data-client-name="${esc(c.name)}">
                <div class="tx-dot" style="background:${dot}"></div>
                <div class="tx-info">
                  <div class="tx-label">${esc(c.name)}</div>
                  <div class="tx-meta">${c.area.toUpperCase()} · ${c.payMode==='fatt'?'Fattura':'Contanti'}${c.recurring?' · gg.'+c.recurringDay:''} · ${c.active?'Attivo':'Archiviato'}</div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                  <div style="font-size:13px;font-weight:800;color:#000;">${fmt(nettoNico)}/m</div>
                  ${missing>0.01?`<div style="font-size:11px;color:var(--red);font-weight:700;">-${fmt(missing)}</div>`:''}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div>
        <div class="card" style="background:linear-gradient(135deg,#1756d8,#2f7aff);border:none;margin-bottom:14px;">
          <div class="card-title" style="color:rgba(255,255,255,0.7);">Stipendio Stimato Mensile</div>
          <div style="font-family:'Sora';font-size:32px;font-weight:800;color:#fff;margin-top:4px;">${fmt(stipendio)}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.55);margin-top:6px;font-weight:700;">Clienti attivi × quota Nico</div>
        </div>
      </div>
    </div>
  </div>`;
};

window.setClientFilter = (key, val) => {
  if(!state.clientFilters) state.clientFilters={};
  state.clientFilters[key]=val;
  render('clients');
};
window.setClientSearch = val => {
  if(!state.clientFilters) state.clientFilters={};
  state.clientFilters.clientSearch=val;
  const v = val.trim().toLowerCase();
  const list = document.getElementById('clients-list');
  if(!list){ render('clients'); return; }
  list.querySelectorAll('.tx-item[data-client-id]').forEach(el => {
    const name = (el.dataset.clientName||'').toLowerCase();
    el.style.display = (!v || name.includes(v)) ? '' : 'none';
  });
};

// ═══════════════════════════════════════════════════
// TAXES VIEW
// ═══════════════════════════════════════════════════
const renderTaxesView = (slot) => {
  const curYear = new Date().getFullYear();
  const prevYear = curYear - 1;
  const accrualPrev = calcTaxAccrual(prevYear);
  const paidPrev    = calcTaxPaid(prevYear);
  const remainPrev  = round(accrualPrev - paidPrev);
  const accrualCur  = calcTaxAccrual(curYear);
  const paymentsPrev = state.taxPayments[prevYear] || [];
  const yearsWithData = new Set([curYear, prevYear]);
  state.transactions.forEach(t=>{const y=new Date(t.date).getFullYear();if(y)yearsWithData.add(y);});
  Object.keys(state.taxPayments).forEach(y=>yearsWithData.add(parseInt(y)));
  const sortedYears = Array.from(yearsWithData).sort((a,b)=>b-a);
  renderPeriodSelectors('Tasse');
  slot.innerHTML=`<div class="page fade-up">
    <div class="page-header"><div class="page-title">Conto Tasse</div></div>
    <div class="two-panel">
      <div>
        <div class="card" style="border-left:4px solid var(--amber);margin-bottom:16px;">
          <div class="card-title">Da pagare · Anno ${prevYear}</div>
          <div style="font-family:'Sora';font-size:36px;font-weight:800;letter-spacing:-0.04em;color:${remainPrev>0?'var(--red)':'var(--green)'};">${fmt(remainPrev)}</div>
          <div style="display:flex;justify-content:space-between;margin-top:16px;padding-top:14px;border-top:1px solid rgba(0,0,0,0.06);">
            <div><div style="font-size:10px;font-weight:900;color:var(--muted);margin-bottom:2px;">Tasse ${prevYear}</div><div style="font-family:'Sora';font-size:18px;font-weight:800;">${fmt(accrualPrev)}</div></div>
            <div style="text-align:right;"><div style="font-size:10px;font-weight:900;color:var(--muted);margin-bottom:2px;">Già pagato</div><div style="font-family:'Sora';font-size:18px;font-weight:800;color:var(--green);">${fmt(paidPrev)}</div></div>
          </div>
        </div>
        ${paymentsPrev.length?`<div class="card" style="margin-bottom:14px;">
          <div class="card-title" style="margin-bottom:10px;">Pagamenti registrati ${prevYear}</div>
          ${paymentsPrev.map(p=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.04);">
            <div><div style="font-size:13px;font-weight:700;">${fmtDate(p.date)}</div>${p.note?`<div style="font-size:11px;color:var(--muted);">${esc(p.note)}</div>`:''}</div>
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="font-size:14px;font-weight:800;color:var(--green);">-${fmt(p.amount)}</div>
              <button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;" onclick="window.deleteTaxPayment(${prevYear},'${p.id}')">✕</button>
            </div>
          </div>`).join('')}
        </div>`:''} 
        <button class="btn-primary full" style="background:var(--green);margin-bottom:24px;" onclick="window.openAddTaxPaymentModal(${prevYear})"><span>＋ Registra Pagamento Tasse ${prevYear}</span></button>
        
        <div class="card">
          <div class="card-title" style="margin-bottom:12px;">Storico Accantonamenti</div>
          <div style="display:flex;justify-content:space-between;font-size:9px;font-weight:900;text-transform:uppercase;color:var(--muted);letter-spacing:.1em;margin-bottom:8px;">
            <span>ANNO</span><span>ACCANTONAMENTO</span>
          </div>
          ${sortedYears.map(y=>{const acc=calcTaxAccrual(y);if(acc===0&&!state.taxPayments[y])return '';return `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.04);">
            <div style="font-weight:800;font-family:'Sora';">${y}</div>
            <div style="font-weight:800;color:#000;">${fmt(acc)}</div>
          </div>`;}).join('')}
        </div>
      </div>
      <div>
        <div class="card" style="border-left:4px solid #8b5cf6;margin-bottom:14px;">
          <div class="card-title">Accrual ${curYear} — da pagare nel ${curYear+1}</div>
          <div style="font-family:'Sora';font-size:32px;font-weight:800;color:#8b5cf6;margin:6px 0;">${fmt(accrualCur)}</div>
          <div style="font-size:11px;color:var(--muted);font-weight:700;">Metti da parte per pagare nel ${curYear+1}</div>
        </div>
        <div class="card" style="margin-bottom:14px;">
          <div class="card-title" style="margin-bottom:8px;">Saldo conto tasse ${curYear}</div>
          <input class="form-input" style="font-family:'Sora';font-size:20px;font-weight:800;" type="number" value="${state.taxAccount.balances[curYear]||0}" onchange="window.updateTaxBalance(${curYear},this.value)"/>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:8px;">Copertura ${curYear}</div>
          ${(()=>{const bal=state.taxAccount.balances[curYear]||0,diff=round(bal-accrualCur);return `<div style="font-family:'Sora';font-size:24px;font-weight:800;color:${diff>=0?'var(--green)':'var(--red)'};">${fmt(diff)}</div><div style="font-size:11px;color:var(--muted);margin-top:4px;font-weight:600;">${diff>=0?'Sei in pari o in surplus ✨':'Ti mancano '+fmt(Math.abs(diff))+' per la copertura.'}</div>`;})()}
        </div>
      </div>
    </div>
  </div>`;
};

window.updateTaxBalance = (y,v) => {
  state.taxAccount.balances[y]=parseFloat(v)||0;
  saveState();
};
window.openAddTaxPaymentModal = y => {
  modalContainer.innerHTML=`
    <div class="overlay" onclick="window.closeModal()">
      <div class="sheet" onclick="event.stopPropagation()">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Registra pagamento tasse ${y}</div>
        <div class="form-group"><label class="form-label">Importo</label><input class="form-input" id="tp-amt" type="number" placeholder="0.00"/></div>
        <div class="form-group"><label class="form-label">Data</label><input class="form-input" id="tp-date" type="date" value="${todayISO()}"/></div>
        <div class="form-group"><label class="form-label">Note (opzionale)</label><input class="form-input" id="tp-note" placeholder="es. Prima rata acconto..."/></div>
        <button class="btn-primary" onclick="window.saveTaxPayment(${y})">Salva Pagamento</button>
      </div>
    </div>`;
};
window.saveTaxPayment = y => {
  const amt=parseFloat(document.getElementById('tp-amt').value)||0;
  const date=document.getElementById('tp-date').value;
  const note=document.getElementById('tp-note').value;
  if(!amt) return;
  if(!state.taxPayments[y]) state.taxPayments[y]=[];
  state.taxPayments[y].push({id:uid(),amount:amt,date,note});
  saveState();
  window.closeModal();
  render('taxes');
};
window.deleteTaxPayment = (y,id) => {
  state.taxPayments[y]=(state.taxPayments[y]||[]).filter(p=>p.id!==id);
  saveState();
  render('taxes');
};

// ═══════════════════════════════════════════════════
// MODAL — INCOME (con flusso Inlab migliorato)
// ═══════════════════════════════════════════════════
window.openIncomeModal = () => {
  let step=1;
  let data={area:'nico',payMode:'fatt',gross:0,collector:'nico',transferToOther:0,clientId:'',date:todayISO(),desc:''};

  const draw = () => {
    let content='';
    if(step===1){
      content=`
        <div class="sheet-title">Tipo di Entrata</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <button class="btn-analysis ${data.area==='nico'?'nico':''}" onclick="window.incomeNext({area:'nico'})">Nico</button>
          <button class="btn-analysis ${data.area==='inlab'?'inlab':''}" onclick="window.incomeNext({area:'inlab'})">Inlab</button>
        </div>`;
    } else if(step===2 && data.area==='inlab'){
      content=`
        <div class="sheet-title">Chi ha incassato?</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
          <button class="btn-analysis ${data.collector==='nico'?'nico':''}" onclick="window.incomeUpdate({collector:'nico'})">Nico</button>
          <button class="btn-analysis" style="${data.collector==='ilaria'?'border:2px solid #6f7bff;':''}" onclick="window.incomeUpdate({collector:'ilaria'})">Ilaria</button>
        </div>
        <button class="btn-primary" onclick="window.incomeStep(3)">Avanti →</button>`;
    } else if(step===2 && data.area==='nico'){
      content=`
        <div class="sheet-title">Dettagli</div>
        <div class="form-group">
          <label class="form-label">Cliente</label>
          <select class="form-input" onchange="window.incomeUpdate({clientId:this.value})">
            <option value="">Nessuno / Altro</option>
            <option value="EXTRA">Extra</option>
            ${state.clients.filter(c=>c.area==='nico').map(c=>`<option value="${c.id}" ${data.clientId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
            <option value="NEW">＋ Nuovo</option>
          </select>
        </div>
        ${data.clientId==='NEW'?`<div class="form-group"><label class="form-label">Nome Cliente</label><input class="form-input" id="income-client-name" value="${esc(data.customName||'')}" oninput="window.incomeUpdate({customName:this.value},true)"/></div>`:''}
        <div class="form-group">
          <label class="form-label">Modalità</label>
          <div style="display:flex;gap:10px;">
            <button class="chip ${data.payMode==='fatt'?'active':''}" onclick="window.incomeUpdate({payMode:'fatt'})">Fattura</button>
            <button class="chip ${data.payMode==='cont'?'active':''}" onclick="window.incomeUpdate({payMode:'cont'})">Contanti</button>
          </div>
        </div>
        <button class="btn-primary" onclick="window.incomeStep(3)">Avanti →</button>`;
    } else if(step===3 && data.area==='inlab'){
      // Inlab step 3: modalità pagamento
      content=`
        <div class="sheet-title">Modalità pagamento</div>
        <div style="display:flex;gap:10px;margin-bottom:20px;">
          <button class="chip ${data.payMode==='fatt'?'active':''}" onclick="window.incomeUpdate({payMode:'fatt'})">Fattura</button>
          <button class="chip ${data.payMode==='cont'?'active':''}" onclick="window.incomeUpdate({payMode:'cont'})">Contanti</button>
        </div>
        <div class="form-group">
          <label class="form-label">Cliente Inlab</label>
          <select class="form-input" onchange="window.incomeUpdate({clientId:this.value})">
            <option value="">Nessuno / Altro</option>
            <option value="EXTRA">Extra Inlab</option>
            ${state.clients.filter(c=>c.area==='inlab').map(c=>`<option value="${c.id}" ${data.clientId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
            <option value="NEW">＋ Nuovo</option>
          </select>
        </div>
        ${data.clientId==='NEW'?`<div class="form-group"><label class="form-label">Nome Cliente</label><input class="form-input" id="income-client-name" value="${esc(data.customName||'')}" oninput="window.incomeUpdate({customName:this.value},true)"/></div>`:''}
        <button class="btn-primary" onclick="window.incomeStep(4)">Avanti →</button>`;
    } else if(step===4 && data.area==='inlab'){
      // Inlab step 4: importo + quanto hai dato/ricevuto dall'altro
      const lordo = parseFloat(data.gross)||0;
      const tax = data.payMode==='fatt' ? round(lordo*0.25) : 0;
      const netto = round(lordo - tax);
      const halfNetto = round(netto * 0.5);
      // Se nico ha incassato → deve dare metà (netta) a ilaria (e viceversa)
      const label = data.collector==='nico'
        ? `Nico ha incassato → deve dare ${fmt(halfNetto)} a Ilaria`
        : `Ilaria ha incassato → deve dare ${fmt(halfNetto)} a Nico`;
      content=`
        <div class="sheet-title">Importo Incassato</div>
        <div class="form-group">
          <input class="form-input" style="font-size:24px;text-align:center;" id="income-gross" type="number" inputmode="decimal" placeholder="0.00" value="${data.gross||''}" oninput="window.incomeUpdate({gross:parseFloat(this.value)||0},true);window.refreshInlabPreview()"/>
        </div>
        <div class="form-group">
          <label class="form-label">Data</label>
          <input class="form-input" type="date" value="${data.date}" onchange="window.incomeUpdate({date:this.value},true)"/>
        </div>
        <div id="inlab-preview" class="preview-box visible" style="margin-bottom:16px; display:block !important;">
          <div class="preview-row"><span>Lordo</span><span>${fmt(lordo)}</span></div>
          ${data.payMode==='fatt'?`<div class="preview-row"><span>Tasse (25%)</span><span class="amber">${fmt(tax)}</span></div>`:''}
          <div class="preview-row"><span>Netto</span><span>${fmt(netto)}</span></div>
          <div class="preview-row"><span>Quota Nico</span><span class="green">${fmt(halfNetto)}</span></div>
          <div class="preview-row"><span>Quota Ilaria</span><span class="green">${fmt(halfNetto)}</span></div>
          <div class="preview-row" style="border-top:2px dashed rgba(33,83,173,0.15);margin-top:4px;padding-top:4px;">
            <span style="font-size:11px;color:var(--muted);">${label}</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Quanto hai già dato/ricevuto? (trasferimento manuale)</label>
          <input class="form-input" type="number" inputmode="decimal" placeholder="0.00" value="${data.transferToOther||''}" oninput="window.incomeUpdate({transferToOther:parseFloat(this.value)||0},true)"/>
        </div>
        <button class="btn-primary" onclick="window.saveIncomeRecord()">Registra Entrata</button>`;
    } else if(step===3 && data.area==='nico'){
      // Nico step 3: importo
      const tax = data.payMode==='fatt' ? round((parseFloat(data.gross)||0)*0.25) : 0;
      const net = data.payMode==='fatt' ? round((parseFloat(data.gross)||0)*0.75) : (parseFloat(data.gross)||0);
      content=`
        <div class="sheet-title">Lordo Ricevuto</div>
        <div class="form-group">
          <input class="form-input" style="font-size:24px;text-align:center;" id="income-gross" type="number" inputmode="decimal" placeholder="0.00" value="${data.gross||''}" oninput="window.incomeUpdate({gross:parseFloat(this.value)||0},true);window.refreshNicoPreview()"/>
        </div>
        <div class="form-group">
          <label class="form-label">Data</label>
          <input class="form-input" type="date" value="${data.date}" onchange="window.incomeUpdate({date:this.value},true)"/>
        </div>
        <div id="nico-preview" class="preview-box visible" style="display:block !important;">
          <div class="preview-row"><span>Lordo</span><span>${fmt(parseFloat(data.gross)||0)}</span></div>
          ${data.payMode==='fatt'?`<div class="preview-row"><span>Tasse (25%)</span><span class="amber">${fmt(tax)}</span></div>`:''}
          <div class="preview-row"><span>Netto Nico</span><span class="green">${fmt(net)}</span></div>
        </div>
        <button class="btn-primary" style="margin-top:12px;" onclick="window.saveIncomeRecord()">Registra Entrata</button>`;
    }

    modalContainer.innerHTML=`
      <div class="overlay" onclick="window.closeModal()">
        <div class="sheet" onclick="event.stopPropagation()">
          <div class="sheet-handle"></div>
          ${content}
        </div>
      </div>`;

    if(step===3&&data.area==='nico'||step===4&&data.area==='inlab'){
      setTimeout(()=>{
        const el=document.getElementById('income-gross');
        if(el) el.focus();
      },50);
    }
  };

  window.incomeNext   = obj => { Object.assign(data,obj); step++; draw(); };
  window.incomeUpdate = (obj,skipDraw=false) => { Object.assign(data,obj); if(!skipDraw) draw(); };
  window.incomeStep   = s => { step=s; draw(); };

  window.refreshNicoPreview = () => {
    const g=parseFloat(data.gross)||0;
    const tax=data.payMode==='fatt'?round(g*0.25):0;
    const net=data.payMode==='fatt'?round(g*0.75):g;
    const p=document.getElementById('nico-preview');
    if(p) p.innerHTML=`
      <div class="preview-row"><span>Lordo</span><span>${fmt(g)}</span></div>
      ${data.payMode==='fatt'?`<div class="preview-row"><span>Tasse (25%)</span><span class="amber">${fmt(tax)}</span></div>`:''}
      <div class="preview-row"><span>Netto Nico</span><span class="green">${fmt(net)}</span></div>`;
  };

  window.refreshInlabPreview = () => {
    const g=parseFloat(data.gross)||0;
    const tax=data.payMode==='fatt'?round(g*0.25):0;
    const netto=round(g-tax);
    const half=round(netto*0.5);
    const label=data.collector==='nico'?`Nico ha incassato → deve dare ${fmt(half)} a Ilaria`:`Ilaria ha incassato → deve dare ${fmt(half)} a Nico`;
    const p=document.getElementById('inlab-preview');
    if(p) p.innerHTML=`
      <div class="preview-row"><span>Lordo</span><span>${fmt(g)}</span></div>
      ${data.payMode==='fatt'?`<div class="preview-row"><span>Tasse (25%)</span><span class="amber">${fmt(tax)}</span></div>`:''}
      <div class="preview-row"><span>Netto</span><span>${fmt(netto)}</span></div>
      <div class="preview-row"><span>Quota Nico</span><span class="green">${fmt(half)}</span></div>
      <div class="preview-row"><span>Quota Ilaria</span><span class="green">${fmt(half)}</span></div>
      <div class="preview-row" style="border-top:2px dashed rgba(33,83,173,0.15);margin-top:4px;padding-top:4px;">
        <span style="font-size:11px;color:var(--muted);">${label}</span>
      </div>`;
  };

  window.saveIncomeRecord = () => {
    const g=parseFloat(data.gross)||0;
    if(!g) return;
    let desc=data.desc;
    if(data.clientId==='EXTRA') desc=(data.area==='nico'?'Extra Nico':'Extra Inlab');
    else if(data.clientId==='NEW') desc=data.customName||'Cliente Manuale';
    else if(data.clientId){ const c=state.clients.find(x=>x.id===data.clientId); if(c) desc=c.name; }

    let nicoIncome=0, ilariaIncome=0, nicoTax=0;
    if(data.area==='nico'){
      nicoTax    = data.payMode==='fatt'?round(g*0.25):0;
      nicoIncome = round(g-nicoTax);
      ilariaIncome=0;
    } else {
      // Inlab
      nicoTax      = data.payMode==='fatt'&&data.collector==='nico'?round(g*0.25):0;
      const netto  = round(g-(data.payMode==='fatt'?round(g*0.25):0));
      nicoIncome   = round(netto*0.5);
      ilariaIncome = round(netto*0.5);
    }

    state.transactions.push({
      id:uid(), kind:'income', area:data.area, desc:desc||(data.area==='nico'?'Nico':'Inlab'),
      gross:g, payMode:data.payMode, collector:data.collector,
      transferToOther:data.transferToOther||0, clientId:data.clientId,
      date:data.date, nicoIncome, ilariaIncome, nicoTax,
      createdAt:new Date().toISOString()
    });
    saveState();
    window.closeModal();
    render(lastViewId);
  };
  draw();
};

// ═══════════════════════════════════════════════════
// MODAL — EXPENSE (con categoria)
// ═══════════════════════════════════════════════════
window.openExpenseModal = () => {
  window._exp = { area:'nico', paidBy:'nico', category: state.expenseCategories[0]||'Necessità', desc:'', amt:'', date: todayISO() };

  const catOpts = () => state.expenseCategories.map(c=>`<option value="${esc(c)}" ${window._exp.category===c?'selected':''}>${esc(c)}</option>`).join('');

  const drawExp = () => {
    const e = window._exp;
    modalContainer.innerHTML=`
      <div class="overlay" onclick="window.closeModal()">
        <div class="sheet" onclick="event.stopPropagation()">
          <div class="sheet-handle"></div>
          <div class="sheet-title">Nuova Uscita</div>
          <div class="form-group">
            <label class="form-label">Descrizione</label>
            <input class="form-input" id="exp-desc" placeholder="es. Amazon, Affitto..." value="${esc(e.desc)}" oninput="window._exp.desc=this.value"/>
          </div>
          <div class="form-group">
            <label class="form-label">Importo</label>
            <input class="form-input" id="exp-amt" type="number" inputmode="decimal" placeholder="0.00" value="${e.amt}" oninput="window._exp.amt=this.value; window._refreshExpPreview()"/>
          </div>
          <div id="exp-preview" class="preview-box" style="display:none;"></div>
          <div class="form-group">
            <label class="form-label">Area</label>
            <div style="display:flex;gap:10px;">
              <button class="chip ${e.area==='nico'?'active':''}" onclick="window._exp.area='nico';window._drawExp();window._refreshExpPreview()">Personale (Nico)</button>
              <button class="chip ${e.area==='inlab'?'active':''}" onclick="window._exp.area='inlab';window._drawExp();window._refreshExpPreview()">Inlab (50/50)</button>
            </div>
          </div>
          ${e.area==='inlab'?`
          <div class="form-group">
            <label class="form-label">Chi ha pagato?</label>
            <div style="display:flex;gap:10px;">
              <button class="chip ${e.paidBy==='nico'?'active':''}" onclick="window._exp.paidBy='nico';window._drawExp();window._refreshExpPreview()">Nico</button>
              <button class="chip ${e.paidBy==='ilaria'?'active':''}" onclick="window._exp.paidBy='ilaria';window._drawExp();window._refreshExpPreview()">Ilaria</button>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:6px;font-weight:700;">Chi ha pagato anticiperà la metà dell'altro socio</div>
          </div>`:''}
          <div class="form-group">
            <label class="form-label">Categoria</label>
            <div style="display:flex;gap:8px;align-items:center;">
              <select class="form-input" id="exp-cat" onchange="window._exp.category=this.value">${catOpts()}</select>
              <button class="chip" onclick="window.addExpenseCategory()" style="flex-shrink:0;white-space:nowrap;">＋</button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Data</label>
            <input class="form-input" id="exp-date" type="date" value="${e.date}" onchange="window._exp.date=this.value"/>
          </div>
          <button class="btn-primary" onclick="window.saveExpense()">Salva Uscita</button>
        </div>
      </div>`;
  };

  window._drawExp = drawExp;

  window._refreshExpPreview = () => {
    const e = window._exp;
    const amt = parseFloat(document.getElementById('exp-amt')?.value || e.amt) || 0;
    const p = document.getElementById('exp-preview');
    if(!p) return;
    if(!amt) { p.style.display='none'; p.classList.remove('visible'); return; }
    p.style.display='block';
    p.classList.add('visible');
    if(e.area==='nico') {
      p.innerHTML = `<div class="preview-row"><span>Spesa Nico</span><span class="red">${fmt(amt)}</span></div>`;
    } else {
      const half = round(amt*0.5);
      p.innerHTML = `
        <div class="preview-row"><span>Spesa Inlab</span><span class="red">${fmt(amt)}</span></div>
        <div class="preview-row"><span>Quota Nico</span><span class="red">${fmt(half)}</span></div>
        <div class="preview-row"><span>Quota Ilaria</span><span class="red">${fmt(half)}</span></div>
        <div class="preview-row" style="border-top:1px dashed rgba(0,0,0,0.1); margin-top:8px; padding-top:8px;">
          <span style="font-size:11px; color:var(--muted);">${e.paidBy==='nico'?'Nico ha pagato → Ilaria deve ' + fmt(half) : 'Ilaria ha pagato → Nico deve ' + fmt(half)}</span>
        </div>
      `;
    }
  };

  window.addExpenseCategory = () => {
    const name=prompt('Nome nuova categoria:');
    if(name&&name.trim()&&!state.expenseCategories.includes(name.trim())){
      state.expenseCategories.push(name.trim());
      window._exp.category=name.trim();
      saveState();
    }
    drawExp();
  };

  window.saveExpense = () => {
    const e = window._exp;
    const amt = parseFloat(document.getElementById('exp-amt')?.value||e.amt)||0;
    const desc = (document.getElementById('exp-desc')?.value||e.desc).trim();
    const date = document.getElementById('exp-date')?.value||e.date;
    const cat  = document.getElementById('exp-cat')?.value||e.category;
    if(!amt) return;
    state.transactions.push({
      id:uid(), kind:'expense', area:e.area,
      paidBy: e.area==='inlab' ? e.paidBy : 'nico',
      desc, gross:amt, category:cat, date,
      createdAt:new Date().toISOString()
    });
    saveState();
    window.closeModal();
    render(lastViewId);
  };

  drawExp();
  setTimeout(()=>window._refreshExpPreview(), 0);
};


window.openTransferModal = () => {
  modalContainer.innerHTML=`
    <div class="overlay" onclick="window.closeModal()">
      <div class="sheet" onclick="event.stopPropagation()">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Registra Trasferimento</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:16px;">Registra quando Nico passa soldi a Ilaria o viceversa, per pareggiare i conti Inlab.</div>
        <div class="form-group">
          <label class="form-label">Da</label>
          <div style="display:flex;gap:10px;" id="tr-from-btns">
            <button class="chip active" id="tr-from-nico" onclick="window._trSetFrom('nico')">Nico</button>
            <button class="chip" id="tr-from-ilaria" onclick="window._trSetFrom('ilaria')">Ilaria</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">A</label>
          <div id="tr-to-label" style="font-size:14px;font-weight:800;color:var(--text);padding:10px 0;">Ilaria</div>
        </div>
        <div class="form-group">
          <label class="form-label">Importo</label>
          <input class="form-input" id="tr-amt" type="number" inputmode="decimal" placeholder="0.00" style="font-size:22px;text-align:center;"/>
        </div>
        <div class="form-group">
          <label class="form-label">Data</label>
          <input class="form-input" id="tr-date" type="date" value="${todayISO()}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Note (opzionale)</label>
          <input class="form-input" id="tr-note" placeholder="es. Bonifico aprile"/>
        </div>
        <button class="btn-primary" style="background:var(--purple);" onclick="window.saveTransfer()">Registra Trasferimento</button>
      </div>
    </div>`;
  window._trFrom = 'nico';
  window._trSetFrom = (who) => {
    window._trFrom = who;
    document.getElementById('tr-from-nico').className   = 'chip' + (who==='nico'?' active':'');
    document.getElementById('tr-from-ilaria').className = 'chip' + (who==='ilaria'?' active':'');
    document.getElementById('tr-to-label').textContent  = who==='nico' ? 'Ilaria' : 'Nico';
  };
  window.saveTransfer = () => {
    const amt  = parseFloat(document.getElementById('tr-amt')?.value)||0;
    const date = document.getElementById('tr-date')?.value||todayISO();
    const note = document.getElementById('tr-note')?.value||'';
    const from = window._trFrom;
    const to   = from==='nico' ? 'ilaria' : 'nico';
    if(!amt) return;
    state.transactions.push({
      id:uid(), kind:'transfer', area:'inlab',
      from, to, gross:amt,
      desc: note || `Trasferimento ${from} → ${to}`,
      date, createdAt:new Date().toISOString()
    });
    saveState();
    window.closeModal();
    render(lastViewId);
  };
  setTimeout(()=>document.getElementById('tr-amt')?.focus(), 100);
};

window.closeModal = () => { modalContainer.innerHTML=''; window._expDesc=''; window._expAmt=''; };

// ═══════════════════════════════════════════════════
// MODAL — CLIENT DETAIL
// ═══════════════════════════════════════════════════
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
          ${tx.category?`<div style="margin-top:4px;font-size:12px;color:var(--muted);">${esc(tx.category)}</div>`:''}
          ${tx.payMode?`<div style="font-size:12px;color:var(--muted);">${tx.payMode==='fatt'?'Fattura':'Contanti'}</div>`:''}
          ${tx.collector?`<div style="font-size:12px;color:var(--muted);">Incassato da: ${tx.collector}</div>`:''}
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
            ${inv.rec?`<button class="btn-primary" style="background:var(--red);" onclick="window.disablePac('${id}')">Disabilita</button>`:''}
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
window.updateFilter = (key,val) => {
  state.filters[key]=parseInt(val);saveState();render(lastViewId);
};
window.updatePeriodType = type => {
  state.filters.period=type;
  if(type==='annual') state.filters.month=13;
  saveState();render(lastViewId);
};
window.render=render;

// ═══════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  // Schermata di caricamento
  app.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                height:100vh;gap:16px;background:#0a0a0a;">
      <div style="font-size:36px;">💸</div>
      <div style="font-size:14px;color:#555;font-weight:600;font-family:sans-serif;letter-spacing:.5px;">
        Caricamento dati...
      </div>
    </div>`;

  // Carica state da Firestore (con fallback localStorage)
  state = await initDB(state, (remoteState) => {
    // Callback: aggiornamento da altro dispositivo
    state = remoteState;
    runPacSync();
    render(lastViewId);
  });

  runPacSync();
  render('home');
});
