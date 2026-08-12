/* ============================================================
   TRADING OS — script.js  v1.5

   NEW vs v1.4:
   - Commission, Swap/Overnight, and Other Fees fields on every trade
   - Net P&L = Gross P&L − all fees (auto-calculated live)
   - Fees Tracker tab: total commissions, swaps, other fees, fee drag %
   - Default fees in Settings (pre-fill per trade)
   - Journal now shows Gross P&L | Fees | Net P&L columns
   - Dashboard & Account use Net P&L for equity calculations
   - Statistics use Net P&L
   - Fees deducted from balance in equity curve
   - All existing v1.4 features preserved
   ============================================================ */

'use strict';

/* ============================================================
   SECTION 1 — DEFAULT CONFIG
   ============================================================ */

const DEFAULT_STRATEGY = [
  { id:'htf', name:'Higher Timeframe Analysis', rules:[
    { id:'htf1', name:'Weekly bias identified',  desc:'Determine overall weekly trend direction', weight:10, required:true  },
    { id:'htf2', name:'Daily bias aligned',      desc:'Daily chart confirms weekly direction',    weight:10, required:true  },
    { id:'htf3', name:'H4 bias aligned',         desc:'H4 structure supports daily bias',         weight:8,  required:false },
  ]},
  { id:'zone', name:'Zone Rules', rules:[
    { id:'z1', name:'Weekly Zone Identified', desc:'Price left the zone impulsively.',                             weight:10, required:true  },
    { id:'z2', name:'Daily Zone Confirmed',   desc:'Daily zone aligns with the weekly zone, left impulsively.',   weight:10, required:true  },
    { id:'z3', name:'Fresh Zone',             desc:'Zone has not been significantly tapped before.',              weight:8,  required:false },
    { id:'z4', name:'No Deep Penetration',    desc:'Price has not penetrated more than 50% into the zone.',      weight:7,  required:false },
  ]},
  { id:'confirmation', name:'Confirmation Rules', rules:[
    { id:'c1', name:'Absorption / Accumulation',           desc:'Evidence of absorption before the move.',            weight:8,  required:false },
    { id:'c2', name:'Engulfing Candle',                    desc:'Strong engulfing candle confirms momentum.',          weight:10, required:true  },
    { id:'c3', name:'LTF Change in Structure',             desc:'Market structure changes in the trade direction.',    weight:10, required:true  },
    { id:'c4', name:'Liquidity Sweep / False Tap',         desc:'Liquidity is taken before the move.',                weight:8,  required:false },
    { id:'c5', name:'50 EMA Retest',                       desc:'Price retests the 50 EMA before entry.',             weight:9,  required:true  },
  ]},
  { id:'risk', name:'Risk Rules', rules:[
    { id:'r1', name:'SL below/above structure', desc:'Stop loss placed beyond key structure.',  weight:10, required:true },
    { id:'r2', name:'Min 1:2 RR',               desc:'Reward must be at least twice the risk.', weight:10, required:true },
  ]},
  { id:'news', name:'News Rules', rules:[
    { id:'n1', name:'No red-folder news within 30min', desc:'Avoid high-impact news events.',    weight:8, required:false },
    { id:'n2', name:'News checked on Forex Factory',   desc:'Verified on economic calendar.',     weight:5, required:false },
  ]},
  { id:'psychology', name:'Psychology Rules', rules:[
    { id:'p1', name:'Not revenge trading',   desc:'No previous loss in last 30 minutes.', weight:9, required:true  },
    { id:'p2', name:'Mental state is clear', desc:'Stress and fatigue are acceptable.',   weight:7, required:false },
    { id:'p3', name:'No FOMO detected',      desc:'Entry is planned, not chased.',        weight:8, required:true  },
  ]},
];

const DEFAULT_MISTAKES = [
  'FOMO','Early Entry','Late Entry','Ignored Confirmation',
  'Ignored HTF','Ignored News','Poor RR','Overtrading',
  'Revenge Trade','Moved SL','Moved TP','Poor Psychology','Skipped Checklist',
];
const DEFAULT_STRENGTHS = [
  'Waited Patiently','Perfect Confirmation','Excellent RR',
  'Good Discipline','Followed Plan','Protected Capital',
  'Accepted Loss','No FOMO','Managed Risk Well',
];
const PSYCH_FIELDS = [
  {id:'confidence',label:'Confidence'},{id:'patience',label:'Patience'},
  {id:'discipline',label:'Discipline'},{id:'fear',label:'Fear'},
  {id:'greed',label:'Greed'},{id:'focus',label:'Focus'},
  {id:'stress',label:'Stress'},{id:'fatigue',label:'Fatigue'},
  {id:'sleep',label:'Sleep'},{id:'mood',label:'Mood'},
];
const DEFAULT_SETTINGS = {
  startingBalance:10000, currentBalance:10000,
  defaultRisk:1, defaultRR:2,
  currency:'USD', timezone:'UTC',
  theme:'system', accentColor:'#2563eb',
  defaultCommission:0, defaultSwap:0, defaultOtherFees:0,
};

/* ============================================================
   SECTION 2 — STATE / STORAGE
   ============================================================ */

const DB_KEY = 'tradingOS_v1';

let state = {
  strategy:    DEFAULT_STRATEGY,
  trades:      [],
  transactions:[], // {id, type:'deposit'|'withdrawal', date, amount, note}
  dailyNotes:  [], // {id, date, note}
  settings:    {...DEFAULT_SETTINGS},
  mistakes:    [...DEFAULT_MISTAKES],
  strengths:   [...DEFAULT_STRENGTHS],
};

function loadState(){
  try{
    const raw=localStorage.getItem(DB_KEY);
    if(raw){
      const s=JSON.parse(raw);
      state={
        strategy:    s.strategy     ?? DEFAULT_STRATEGY,
        trades:      s.trades       ?? [],
        transactions:s.transactions ?? [],
        dailyNotes:  s.dailyNotes   ?? [],
        settings:    {...DEFAULT_SETTINGS,...(s.settings??{})},
        mistakes:    s.mistakes     ?? [...DEFAULT_MISTAKES],
        strengths:   s.strengths    ?? [...DEFAULT_STRENGTHS],
      };
    }
  }catch(e){console.error('loadState:',e);}
}

function saveState(){
  try{localStorage.setItem(DB_KEY,JSON.stringify(state));}
  catch(e){console.error('saveState:',e);}
}

/* ============================================================
   SECTION 3 — BALANCE HELPERS
   ============================================================ */

function computeCashBalance(){
  return state.transactions.reduce((bal,t)=>{
    return bal + (t.type==='deposit' ? t.amount : -t.amount);
  }, state.settings.startingBalance);
}

/** Net trading P&L = sum of all trade net P&Ls (after fees) */
function computeTradingPnl(){
  return state.trades.reduce((sum,t)=>sum+(getNetPnl(t)),0);
}

function computeEquityBalance(){
  return computeCashBalance() + computeTradingPnl();
}

/** Get total fees for a single trade */
function getTotalFees(trade){
  const commission = Number(trade.commission) || 0;
  const swap       = Number(trade.swap)       || 0; // can be negative (credit)
  const otherFees  = Number(trade.otherFees)  || 0;
  // swap negative = cost to trader, positive = credit
  return commission + (-swap) + otherFees; // total deducted
}

/** Net P&L after all fees */
function getNetPnl(trade){
  const gross = Number(trade.pnl) || 0;
  return gross - getTotalFees(trade);
}

/** All money events (txn + completed trades) sorted by date asc */
function buildChronologicalEvents(){
  const txn = state.transactions.map(t=>({
    kind:t.type, date:t.date, amount:t.amount, note:t.note, id:t.id,
  }));
  const tr = state.trades.filter(t=>t.outcome&&(t.pnl||t.commission||t.swap||t.otherFees)).map(t=>({
    kind:'trade', date:t.date, pnl:getNetPnl(t), pair:t.pair, id:t.id,
  }));
  return [...txn,...tr].sort((a,b)=>a.date.localeCompare(b.date));
}

/* ============================================================
   SECTION 4 — UTILITY
   ============================================================ */

function uid(){return Math.random().toString(36).slice(2,9);}
function fmtPct(n){return Number(n).toFixed(1)+'%';}
function todayStr(){return new Date().toISOString().slice(0,10);}
function nowTimeStr(){const d=new Date();return d.toTimeString().slice(0,5);}
function fmtMoney(n){
  const abs=Math.abs(n);
  const str='$'+abs.toFixed(2);
  return n<0?'-'+str:(n>0?'+'+str:str);
}
function monthLabel(s){
  if(!s)return'';const[y,m]=s.split('-');
  return['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]+' '+y;
}

function notify(msg,type='info'){
  const el=document.createElement('div');
  el.className='notification '+type;
  el.textContent=msg;
  document.getElementById('notification-container').appendChild(el);
  setTimeout(()=>el.remove(),3800);
}

function confirm(msg){
  return new Promise(resolve=>{
    const ov=document.getElementById('confirm-overlay');
    document.getElementById('confirm-message').textContent=msg;
    ov.classList.remove('hidden');
    const yes=document.getElementById('confirm-yes');
    const no =document.getElementById('confirm-no');
    const cleanup=()=>ov.classList.add('hidden');
    yes.onclick=()=>{cleanup();resolve(true);};
    no.onclick =()=>{cleanup();resolve(false);};
  });
}

function downloadFile(content,filename,mime='application/json'){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type:mime}));
  a.download=filename; a.click();
  URL.revokeObjectURL(a.href);
}

function esc(s){
  if(s==null)return'';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ============================================================
   SECTION 5 — THEME
   ============================================================ */

function applyTheme(){
  const{theme,accentColor}=state.settings;
  document.documentElement.setAttribute('data-theme',theme==='system'?'':theme);
  document.documentElement.style.setProperty('--accent',accentColor);
  document.documentElement.style.setProperty('--accent-h',accentColor);
}

/* ============================================================
   SECTION 6 — NAV / TABS
   ============================================================ */

function initNav(){
  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click',()=>switchTab(item.dataset.tab));
  });
}

function switchTab(tab){
  document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
  document.querySelectorAll('.tab-section').forEach(s=>s.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  if(tab==='dashboard')  renderDashboard();
  if(tab==='statistics') renderStatistics();
  if(tab==='journal')    renderJournal();
  if(tab==='account')    renderAccount();
  if(tab==='daily')      renderDailyNotes();
  if(tab==='fees')       renderFeesTracker();
  if(tab==='new-trade'){if(!_editingTradeId)resetTradeForm();renderChecklist();}
}

/* ============================================================
   SECTION 7 — DASHBOARD
   ============================================================ */

function renderDashboard(){
  const trades=state.trades;
  const s=state.settings;
  const wins  =trades.filter(t=>t.outcome==='WIN');
  const losses=trades.filter(t=>t.outcome==='LOSS');

  // Use net P&L for all calculations
  const totalProfit=wins.reduce((a,t)=>a+getNetPnl(t),0);
  const totalLoss  =losses.reduce((a,t)=>a+getNetPnl(t),0);
  const netProfit  =totalProfit+totalLoss;
  const done=trades.filter(t=>t.outcome);
  const winRate=done.length?wins.length/done.length*100:0;
  const avgRR=trades.length?trades.reduce((a,t)=>a+(Number(t.rr)||0),0)/trades.length:0;
  const pf=Math.abs(totalLoss)>0?totalProfit/Math.abs(totalLoss):0;
  const grades=trades.filter(t=>t.grade).map(t=>gradeToNum(t.grade));
  const avgGradeN=grades.length?grades.reduce((a,b)=>a+b,0)/grades.length:null;
  const netPnls=trades.map(t=>getNetPnl(t));
  const largestWin =netPnls.length?Math.max(...netPnls):0;
  const largestLoss=netPnls.length?Math.min(...netPnls):0;
  const now=new Date();
  const wkStart=new Date(now);wkStart.setDate(now.getDate()-now.getDay());
  const moStart=new Date(now.getFullYear(),now.getMonth(),1);
  const thisWeek =trades.filter(t=>new Date(t.date)>=wkStart).length;
  const thisMonth=trades.filter(t=>new Date(t.date)>=moStart).length;
  const sorted=[...trades].sort((a,b)=>new Date(a.date)-new Date(b.date));
  let tW=0,tL=0,bestStreak=0,worstStreak=0;
  sorted.forEach(t=>{
    if(t.outcome==='WIN'){tW++;tL=0;}else if(t.outcome==='LOSS'){tL++;tW=0;}
    bestStreak=Math.max(bestStreak,tW); worstStreak=Math.max(worstStreak,tL);
  });
  let curStreak=0;
  if(sorted.length){
    const last=sorted[sorted.length-1];
    curStreak=last.outcome==='WIN'?tW:last.outcome==='LOSS'?-tL:0;
  }

  // Drawdown
  const events=buildChronologicalEvents();
  let runBal=s.startingBalance,peak=s.startingBalance,maxDD=0;
  events.forEach(ev=>{
    if(ev.kind==='deposit')        runBal+=ev.amount;
    else if(ev.kind==='withdrawal')runBal-=ev.amount;
    else runBal+=(ev.pnl||0);
    if(runBal>peak)peak=runBal;
    const dd=peak>0?(peak-runBal)/peak*100:0;
    if(dd>maxDD)maxDD=dd;
  });

  const cashBal  =computeCashBalance();
  const tradePnl =computeTradingPnl();
  const equityBal=cashBal+tradePnl;
  const totalDeps=state.transactions.filter(t=>t.type==='deposit').reduce((s,t)=>s+t.amount,0);
  const totalWith=state.transactions.filter(t=>t.type==='withdrawal').reduce((s,t)=>s+t.amount,0);

  // Total fees
  const totalFees=trades.reduce((a,t)=>a+getTotalFees(t),0);

  const cards=[
    {label:'Cash Balance',       value:`$${cashBal.toFixed(2)}`,          cls:cashBal>=s.startingBalance?'positive':'negative'},
    {label:'Equity Balance',     value:`$${equityBal.toFixed(2)}`,         cls:equityBal>=s.startingBalance?'positive':'negative'},
    {label:'Net Trading P&L',    value:fmtMoney(tradePnl),                 cls:tradePnl>=0?'positive':'negative'},
    {label:'Total Fees Paid',    value:`$${totalFees.toFixed(2)}`,         cls:'fee-value'},
    {label:'Starting Balance',   value:`$${s.startingBalance.toFixed(2)}`},
    {label:'Total Deposited',    value:`$${totalDeps.toFixed(2)}`,         cls:'positive'},
    {label:'Total Withdrawn',    value:`$${totalWith.toFixed(2)}`,         cls:totalWith>0?'negative':''},
    {label:'Max Drawdown',       value:fmtPct(maxDD),                      cls:maxDD>10?'negative':''},
    {label:'Largest Win',        value:`$${largestWin.toFixed(2)}`,        cls:'positive'},
    {label:'Largest Loss',       value:`$${Math.abs(largestLoss).toFixed(2)}`, cls:'negative'},
    {label:'Win Rate',           value:fmtPct(winRate)},
    {label:'Avg RR',             value:avgRR.toFixed(2)},
    {label:'Profit Factor',      value:pf.toFixed(2)},
    {label:'Avg Grade',          value:avgGradeN?numToGrade(avgGradeN):'-'},
    {label:'Trades This Week',   value:thisWeek},
    {label:'Trades This Month',  value:thisMonth},
    {label:'Total Trades',       value:trades.length},
    {label:'Current Streak',     value:curStreak>=0?`+${curStreak}W`:`${Math.abs(curStreak)}L`, cls:curStreak>0?'positive':curStreak<0?'negative':''},
    {label:'Best Win Streak',    value:`${bestStreak}W`,   cls:'positive'},
    {label:'Worst Loss Streak',  value:`${worstStreak}L`,  cls:worstStreak>2?'negative':''},
  ];

  document.getElementById('dashboard-cards').innerHTML=cards.map(c=>`
    <div class="dash-card">
      <div class="dash-card-label">${c.label}</div>
      <div class="dash-card-value ${c.cls||''}">${c.value}</div>
    </div>`).join('');

  // Last updated
  const lu=document.getElementById('dash-last-updated');
  if(lu)lu.textContent='Updated '+new Date().toLocaleTimeString();

  renderRecentTrades();
}

function renderRecentTrades(){
  const el=document.getElementById('dashboard-recent');
  if(!el)return;
  const recent=[...state.trades]
    .sort((a,b)=>new Date(b.date+'T'+(b.time||'00:00'))-new Date(a.date+'T'+(a.time||'00:00')))
    .slice(0,8);
  if(!recent.length){el.innerHTML='';return;}
  el.innerHTML=`
    <div class="form-section" style="margin-top:0">
      <h2 class="section-title">Recent Trades</h2>
      <div style="overflow-x:auto">
        <table id="journal-table">
          <thead><tr>
            <th>Date</th><th>Pair</th><th>Dir</th><th>Outcome</th>
            <th>Net P&L</th><th>Fees</th><th>Grade</th><th></th>
          </tr></thead>
          <tbody>${recent.map(t=>{
    const bc=t.outcome==='WIN'?'badge-win':t.outcome==='LOSS'?'badge-loss':t.outcome==='BE'?'badge-be':'badge-pending';
    const net=getNetPnl(t);
    const fees=getTotalFees(t);
    const pnlStr=net?(net>=0?`+$${net.toFixed(2)}`:`-$${Math.abs(net).toFixed(2)}`):'—';
    const pnlCls=net>0?'positive':net<0?'negative':'';
    const feesStr=fees>0?`-$${fees.toFixed(2)}`:'—';
    return`<tr>
      <td>${t.date||'—'}</td><td>${esc(t.pair||'—')}</td><td>${esc(t.direction||'—')}</td>
      <td><span class="badge ${bc}">${t.outcome||'Pending'}</span></td>
      <td class="${pnlCls} mono">${pnlStr}</td>
      <td class="fee-cell">${feesStr}</td>
      <td>${t.grade||'—'}</td>
      <td><button class="btn btn-sm" onclick="viewTrade('${t.id}')">View</button></td>
    </tr>`;}).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   SECTION 8 — ACCOUNT TAB
   ============================================================ */

function renderAccount(){
  renderAccountCards();
  renderEquityCurve();
  renderTransactionTable();
}

function renderAccountCards(){
  const cashBal  =computeCashBalance();
  const tradePnl =computeTradingPnl();
  const equityBal=cashBal+tradePnl;
  const totalDeps=state.transactions.filter(t=>t.type==='deposit').reduce((s,t)=>s+t.amount,0);
  const totalWith=state.transactions.filter(t=>t.type==='withdrawal').reduce((s,t)=>s+t.amount,0);
  const netCash  =totalDeps-totalWith;
  const roi=state.settings.startingBalance>0?(equityBal-state.settings.startingBalance)/state.settings.startingBalance*100:0;
  const totalFees=state.trades.reduce((a,t)=>a+getTotalFees(t),0);

  const cards=[
    {label:'Cash Balance',        value:`$${cashBal.toFixed(2)}`,        cls:cashBal>=state.settings.startingBalance?'positive':'negative',
     tip:'Starting + deposits − withdrawals. What your broker holds.'},
    {label:'Equity Balance',      value:`$${equityBal.toFixed(2)}`,       cls:equityBal>=state.settings.startingBalance?'positive':'negative',
     tip:'Cash + net trading P&L (after fees)'},
    {label:'Total Deposited',     value:`$${totalDeps.toFixed(2)}`,       cls:'positive'},
    {label:'Total Withdrawn',     value:`$${totalWith.toFixed(2)}`,       cls:totalWith>0?'negative':''},
    {label:'Net Cash Flow',       value:(netCash>=0?'+':'')+'$'+netCash.toFixed(2), cls:netCash>=0?'positive':'negative'},
    {label:'Net Trading P&L',     value:(tradePnl>=0?'+':'')+'$'+tradePnl.toFixed(2), cls:tradePnl>=0?'positive':'negative'},
    {label:'Total Fees Paid',     value:`$${totalFees.toFixed(2)}`,       cls:'fee-value'},
    {label:'ROI vs Starting',     value:(roi>=0?'+':'')+roi.toFixed(2)+'%', cls:roi>=0?'positive':'negative'},
  ];
  document.getElementById('account-balance-cards').innerHTML=cards.map(c=>`
    <div class="dash-card" ${c.tip?`title="${c.tip}"`:''}> 
      <div class="dash-card-label">${c.label}</div>
      <div class="dash-card-value ${c.cls||''}">${c.value}</div>
    </div>`).join('');
}

function renderEquityCurve(){
  const canvas=document.getElementById('equity-canvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const events=buildChronologicalEvents();
  let balance=state.settings.startingBalance;
  const points=[{date:'Start',balance,kind:'start'}];
  events.forEach(ev=>{
    if(ev.kind==='deposit')        balance+=ev.amount;
    else if(ev.kind==='withdrawal')balance-=ev.amount;
    else balance+=(ev.pnl||0);
    points.push({date:ev.date,balance,kind:ev.kind});
  });
  canvas.width=canvas.offsetWidth||700;
  canvas.height=180;
  const W=canvas.width,H=canvas.height;
  const pad={top:24,right:20,bottom:28,left:70};
  const cW=W-pad.left-pad.right,cH=H-pad.top-pad.bottom;
  const accent =getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#2563eb';
  const muted  =getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim()||'#64748b';
  const borderC=getComputedStyle(document.documentElement).getPropertyValue('--border').trim()||'#e2e8f0';
  const success=getComputedStyle(document.documentElement).getPropertyValue('--success').trim()||'#16a34a';
  const danger =getComputedStyle(document.documentElement).getPropertyValue('--danger').trim()||'#dc2626';
  ctx.clearRect(0,0,W,H);
  if(points.length<2){
    ctx.fillStyle=muted;ctx.font='13px system-ui';ctx.textAlign='center';
    ctx.fillText('Add transactions or complete trades to see your equity curve.',W/2,H/2);
    return;
  }
  const bals=points.map(p=>p.balance);
  const minB=Math.min(...bals),maxB=Math.max(...bals);
  const range=maxB-minB||1;
  const xOf=i=>pad.left+(i/(points.length-1))*cW;
  const yOf=b=>pad.top+cH-((b-minB)/range)*cH;
  ctx.strokeStyle=borderC;ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=pad.top+(cH/4)*i;
    ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(pad.left+cW,y);ctx.stroke();
    const val=maxB-(range/4)*i;
    ctx.fillStyle=muted;ctx.font='10px system-ui';ctx.textAlign='right';
    ctx.fillText('$'+val.toFixed(0),pad.left-5,y+4);
  }
  ctx.beginPath();
  ctx.moveTo(xOf(0),yOf(points[0].balance));
  points.forEach((p,i)=>ctx.lineTo(xOf(i),yOf(p.balance)));
  ctx.lineTo(xOf(points.length-1),pad.top+cH);
  ctx.lineTo(pad.left,pad.top+cH);
  ctx.closePath();
  const grad=ctx.createLinearGradient(0,pad.top,0,pad.top+cH);
  grad.addColorStop(0,accent+'44');grad.addColorStop(1,accent+'00');
  ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();
  ctx.moveTo(xOf(0),yOf(points[0].balance));
  points.forEach((p,i)=>ctx.lineTo(xOf(i),yOf(p.balance)));
  ctx.strokeStyle=accent;ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.stroke();
  points.forEach((p,i)=>{
    const col=p.kind==='deposit'?success:p.kind==='withdrawal'?danger:p.kind==='trade'?accent:muted;
    ctx.beginPath();ctx.arc(xOf(i),yOf(p.balance),4,0,Math.PI*2);
    ctx.fillStyle=col;ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
  });
  const refY=yOf(state.settings.startingBalance);
  if(refY>=pad.top&&refY<=pad.top+cH){
    ctx.setLineDash([5,4]);ctx.strokeStyle=muted;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(pad.left,refY);ctx.lineTo(pad.left+cW,refY);ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle=muted;ctx.font='10px system-ui';ctx.textAlign='left';
    ctx.fillText('Start $'+state.settings.startingBalance.toFixed(0),pad.left+4,refY-4);
  }
}

function renderTransactionTable(){
  const tbody=document.getElementById('txn-tbody');
  const empty=document.getElementById('txn-empty');
  const txns=[...state.transactions].sort((a,b)=>a.date.localeCompare(b.date));
  if(!txns.length){tbody.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  let running=state.settings.startingBalance;
  const rows=txns.map(t=>{
    running+=t.type==='deposit'?t.amount:-t.amount;
    const bc=t.type==='deposit'?'badge-deposit':'badge-withdrawal';
    const sign=t.type==='deposit'?'+':'-';
    const cls =t.type==='deposit'?'positive':'negative';
    return`<tr>
      <td>${t.date}</td>
      <td><span class="badge ${bc}">${t.type==='deposit'?'Deposit':'Withdrawal'}</span></td>
      <td class="${cls} mono">${sign}$${t.amount.toFixed(2)}</td>
      <td class="mono">$${running.toFixed(2)}</td>
      <td>${esc(t.note||'—')}</td>
      <td><div class="tbl-actions">
        <button class="btn btn-sm" onclick="editTransaction('${t.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteTransaction('${t.id}')">Del</button>
      </div></td>
    </tr>`;
  });
  tbody.innerHTML=rows.reverse().join('');
}

/* ============================================================
   SECTION 9 — TRANSACTION MODAL
   ============================================================ */

let _editingTxnId=null;

function openTxnModal(type,existing=null){
  _editingTxnId=existing?existing.id:null;
  document.getElementById('txn-title').textContent=
    existing?'Edit Transaction':(type==='deposit'?'Add Deposit':'Add Withdrawal');
  document.getElementById('txn-type').value  =existing?existing.type:type;
  document.getElementById('txn-date').value  =existing?existing.date:todayStr();
  document.getElementById('txn-amount').value=existing?existing.amount:'';
  document.getElementById('txn-note').value  =existing?(existing.note||''):'';
  updateTxnModalInfo();
  document.getElementById('txn-overlay').classList.remove('hidden');
  setTimeout(()=>document.getElementById('txn-amount').focus(),60);
}

function updateTxnModalInfo(){
  const infoEl=document.getElementById('txn-balance-info');
  if(!infoEl)return;
  const cash=computeCashBalance();
  const pnl=computeTradingPnl();
  const equity=cash+pnl;
  const pnlStr=(pnl>=0?'+':'')+pnl.toFixed(2);
  infoEl.textContent=`Available equity: $${equity.toFixed(2)} (cash $${cash.toFixed(2)} + net P&L $${pnlStr})`;
}

function closeTxnModal(){
  document.getElementById('txn-overlay').classList.add('hidden');
  _editingTxnId=null;
}

function saveTxn(){
  const type  =document.getElementById('txn-type').value;
  const date  =document.getElementById('txn-date').value;
  const amount=parseFloat(document.getElementById('txn-amount').value);
  const note  =document.getElementById('txn-note').value.trim();

  if(!date){notify('Please enter a date.','error');return;}
  if(isNaN(amount)||amount<=0){notify('Please enter a valid amount greater than 0.','error');return;}

  if(type==='withdrawal'){
    let equityAfterEdit = computeEquityBalance();
    if(_editingTxnId){
      const old=state.transactions.find(t=>t.id===_editingTxnId);
      if(old) equityAfterEdit += (old.type==='deposit'? -old.amount : old.amount);
    }
    const equityAfterWithdrawal = equityAfterEdit - amount;
    if(equityAfterWithdrawal < 0){
      notify(
        `Cannot withdraw $${amount.toFixed(2)}. Available equity is $${equityAfterEdit.toFixed(2)}. ` +
        `You can withdraw at most $${equityAfterEdit.toFixed(2)}.`,
        'error'
      );
      return;
    }
  }

  const record={id:_editingTxnId||uid(),type,date,amount,note};
  if(_editingTxnId){
    const idx=state.transactions.findIndex(t=>t.id===_editingTxnId);
    if(idx>=0)state.transactions[idx]=record; else state.transactions.push(record);
    notify(`Transaction updated ($${amount.toFixed(2)} ${type}).`,'success');
  }else{
    state.transactions.push(record);
    notify(`${type==='deposit'?'Deposit':'Withdrawal'} of $${amount.toFixed(2)} saved.`,'success');
  }
  saveState();closeTxnModal();
  renderAccount();renderDashboard();
}

window.editTransaction=function(id){
  const t=state.transactions.find(x=>x.id===id);
  if(t)openTxnModal(t.type,t);
};
window.deleteTransaction=async function(id){
  const ok=await confirm('Delete this transaction? This cannot be undone.');
  if(!ok)return;
  state.transactions=state.transactions.filter(t=>t.id!==id);
  saveState();renderAccount();renderDashboard();
  notify('Transaction deleted.','success');
};

/* ============================================================
   SECTION 10 — STRATEGY BUILDER
   ============================================================ */

function renderStrategyBuilder(){
  const c=document.getElementById('strategy-builder');
  c.innerHTML='';
  state.strategy.forEach((cat,ci)=>{
    const el=document.createElement('div');
    el.className='strategy-category';
    el.innerHTML=`
      <div class="strategy-cat-header">
        <input class="strategy-cat-name" type="text" value="${esc(cat.name)}" data-cat-idx="${ci}" placeholder="Category name"/>
        <button class="btn btn-sm btn-danger" data-del-cat="${ci}">✕ Remove</button>
      </div>
      <div class="strategy-rules-list">
        ${cat.rules.map((r,ri)=>renderRuleRow(ci,ri,r)).join('')}
      </div>
      <div class="strategy-add-rule">
        <button class="btn btn-sm" data-add-rule="${ci}">+ Add Rule</button>
      </div>`;
    c.appendChild(el);
  });
  c.querySelectorAll('.strategy-cat-name').forEach(inp=>{
    inp.addEventListener('change',e=>{state.strategy[+e.target.dataset.catIdx].name=e.target.value.trim();});
  });
  c.querySelectorAll('[data-del-cat]').forEach(btn=>{
    btn.addEventListener('click',async e=>{
      const i=+e.currentTarget.dataset.delCat;
      if(await confirm(`Remove category "${state.strategy[i].name}"?`)){state.strategy.splice(i,1);renderStrategyBuilder();}
    });
  });
  c.querySelectorAll('[data-add-rule]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      state.strategy[+e.currentTarget.dataset.addRule].rules.push({id:uid(),name:'New Rule',desc:'',weight:5,required:false});
      renderStrategyBuilder();
    });
  });
  c.querySelectorAll('[data-rule-field]').forEach(inp=>{
    inp.addEventListener('change',e=>{
      const{catIdx,rIdx,field}=e.target.dataset;
      let v=e.target.type==='number'?Number(e.target.value):e.target.value;
      if(field==='required')v=(v==='true');
      state.strategy[+catIdx].rules[+rIdx][field]=v;
    });
  });
  c.querySelectorAll('[data-del-rule]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      const{catIdx,rIdx}=e.currentTarget.dataset;
      state.strategy[+catIdx].rules.splice(+rIdx,1);renderStrategyBuilder();
    });
  });
}

function renderRuleRow(ci,ri,rule){
  return`<div class="strategy-rule">
    <input type="text" data-rule-field data-cat-idx="${ci}" data-r-idx="${ri}" data-field="name"
      value="${esc(rule.name)}" placeholder="Rule name"/>
    <input type="text" data-rule-field data-cat-idx="${ci}" data-r-idx="${ri}" data-field="desc"
      value="${esc(rule.desc)}" placeholder="Description"/>
    <input type="number" data-rule-field data-cat-idx="${ci}" data-r-idx="${ri}" data-field="weight"
      value="${rule.weight}" min="1" max="10" style="width:60px" title="Weight 1-10"/>
    <select data-rule-field data-cat-idx="${ci}" data-r-idx="${ri}" data-field="required" style="width:90px">
      <option value="false" ${!rule.required?'selected':''}>Optional</option>
      <option value="true"  ${ rule.required?'selected':''}>Required</option>
    </select>
    <button class="strategy-rule-delete" data-del-rule data-cat-idx="${ci}" data-r-idx="${ri}">✕</button>
  </div>`;
}

/* ============================================================
   SECTION 11 — CHECKLIST
   ============================================================ */

let _checklistState={};

function resetChecklistState(){
  _checklistState={};
  state.strategy.forEach(cat=>cat.rules.forEach(r=>{_checklistState[r.id]=false;}));
}

function renderChecklist(q=''){
  const c=document.getElementById('checklist-container');c.innerHTML='';
  const qL=(q||document.getElementById('checklist-search').value||'').toLowerCase();
  state.strategy.forEach(cat=>{
    const rules=cat.rules.filter(r=>!qL||r.name.toLowerCase().includes(qL)||r.desc.toLowerCase().includes(qL));
    if(!rules.length)return;
    const catEl=document.createElement('div');catEl.className='checklist-category';
    const hdr=document.createElement('div');hdr.className='checklist-cat-header';
    hdr.innerHTML=`<span class="checklist-cat-name">${esc(cat.name)}</span><span class="checklist-cat-toggle">▾</span>`;
    const items=document.createElement('div');items.className='checklist-items';
    rules.forEach(rule=>{
      const lbl=document.createElement('label');lbl.className='checklist-item';
      lbl.innerHTML=`
        <input type="checkbox" data-rule-id="${rule.id}" ${_checklistState[rule.id]?'checked':''}/>
        <span class="checklist-item-label">
          <span class="checklist-item-name">${esc(rule.name)}${rule.required?' <span class="checklist-item-required">*</span>':''}</span>
          ${rule.desc?`<span class="checklist-item-desc">${esc(rule.desc)}</span>`:''}
        </span>`;
      items.appendChild(lbl);
    });
    catEl.appendChild(hdr);catEl.appendChild(items);c.appendChild(catEl);
    hdr.addEventListener('click',()=>{
      const open=items.style.display!=='none';
      items.style.display=open?'none':'';
      hdr.querySelector('.checklist-cat-toggle').textContent=open?'▸':'▾';
    });
  });
  c.querySelectorAll('input[type="checkbox"]').forEach(cb=>{
    cb.addEventListener('change',e=>{_checklistState[e.target.dataset.ruleId]=e.target.checked;updateChecklistProgress();});
  });
  updateChecklistProgress();
}

function updateChecklistProgress(){
  const all=state.strategy.flatMap(c=>c.rules);
  const pct=all.length?Math.round(all.filter(r=>_checklistState[r.id]).length/all.length*100):0;
  document.getElementById('checklist-progress-bar').style.width=pct+'%';
  document.getElementById('checklist-progress-text').textContent=pct+'%';
}
function getChecklistPct(){
  const all=state.strategy.flatMap(c=>c.rules);
  return all.length?Math.round(all.filter(r=>_checklistState[r.id]).length/all.length*100):0;
}

/* ============================================================
   SECTION 12 — PSYCHOLOGY
   ============================================================ */

function renderPsychSliders(){
  document.getElementById('psychology-sliders').innerHTML=PSYCH_FIELDS.map(f=>`
    <div class="psych-slider-row">
      <span class="psych-label">${f.label}</span>
      <input type="range" id="psych-${f.id}" min="1" max="10" value="5" step="1"/>
      <span class="psych-val" id="psych-val-${f.id}">5</span>
    </div>`).join('');
  PSYCH_FIELDS.forEach(f=>{
    const sl=document.getElementById(`psych-${f.id}`);
    const vl=document.getElementById(`psych-val-${f.id}`);
    sl.addEventListener('input',()=>{vl.textContent=sl.value;});
  });
}
function getPsychValues(){
  const o={};
  PSYCH_FIELDS.forEach(f=>{o[f.id]=Number(document.getElementById(`psych-${f.id}`)?.value??5);});
  return o;
}
function setPsychValues(v){
  PSYCH_FIELDS.forEach(f=>{
    const sl=document.getElementById(`psych-${f.id}`);
    const vl=document.getElementById(`psych-val-${f.id}`);
    if(sl&&v[f.id]!==undefined){sl.value=v[f.id];if(vl)vl.textContent=v[f.id];}
  });
}
function computePsychScore(psych){
  const pos=['confidence','patience','discipline','focus','sleep','mood'];
  const neg=['fear','greed','stress','fatigue'];
  let sum=0;
  pos.forEach(k=>{sum+=(psych[k]??5);});
  neg.forEach(k=>{sum+=(10-(psych[k]??5));});
  return Math.round(sum/PSYCH_FIELDS.length*10)/10;
}

/* ============================================================
   SECTION 13 — MISTAKES / STRENGTHS
   ============================================================ */

function renderMistakes(sel=[]){
  document.getElementById('mistakes-checks').innerHTML=state.mistakes.map(m=>`
    <label class="tag-check">
      <input type="checkbox" name="mistake" value="${esc(m)}" ${sel.includes(m)?'checked':''}/>
      ${esc(m)}</label>`).join('');
}
function renderStrengths(sel=[]){
  document.getElementById('strengths-checks').innerHTML=state.strengths.map(s=>`
    <label class="tag-check">
      <input type="checkbox" name="strength" value="${esc(s)}" ${sel.includes(s)?'checked':''}/>
      ${esc(s)}</label>`).join('');
}
function getChecked(name){
  return[...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el=>el.value);
}

/* ============================================================
   SECTION 14 — TRADE FORM
   ============================================================ */

let _editingTradeId=null;

function resetTradeForm(){
  _editingTradeId=null;
  document.getElementById('trade-form-title').textContent='New Trade';
  ['pair','direction','date','time','session','htf','ltf','entry','sl','tp',
   'risk','rr','outcome','pnl','duration','news','tags','screenshot',
   'emotion-notes','notes','commission','swap','other-fees'].forEach(f=>{
    const el=document.getElementById('f-'+f);
    if(!el)return;
    if(el.tagName==='SELECT')el.selectedIndex=0; else el.value='';
  });
  document.getElementById('f-date').value=todayStr();
  document.getElementById('f-time').value=nowTimeStr();
  if(state.settings.defaultRisk)document.getElementById('f-risk').value=state.settings.defaultRisk;
  if(state.settings.defaultRR)  document.getElementById('f-rr').value  =state.settings.defaultRR;
  // Pre-fill default fees
  if(state.settings.defaultCommission) document.getElementById('f-commission').value=state.settings.defaultCommission;
  if(state.settings.defaultSwap)       document.getElementById('f-swap').value=state.settings.defaultSwap;
  if(state.settings.defaultOtherFees)  document.getElementById('f-other-fees').value=state.settings.defaultOtherFees;
  updateNetPnlDisplay();
  resetChecklistState();renderChecklist();renderMistakes();renderStrengths();setPsychValues({});
  document.getElementById('grade-letter').textContent='-';
  document.getElementById('grade-reason').textContent='';
  document.getElementById('ai-review-text').textContent='Fill in the trade details and calculate grade to see a review.';
  updateScreenshotPreview('');
}

function loadTradeIntoForm(trade){
  _editingTradeId=trade.id;
  document.getElementById('trade-form-title').textContent='Edit Trade — '+trade.pair;
  const set=(id,v)=>{const el=document.getElementById('f-'+id);if(el)el.value=v??'';};
  ['pair','direction','date','time','session','htf','ltf','entry','sl','tp',
   'risk','rr','outcome','pnl','duration','news'].forEach(f=>set(f,trade[f]));
  set('tags',(trade.tags||[]).join(', '));
  set('screenshot',trade.screenshot);set('emotion-notes',trade.emotionNotes);set('notes',trade.notes);
  // Fees
  set('commission', trade.commission??'');
  set('swap',       trade.swap??'');
  set('other-fees', trade.otherFees??'');
  updateNetPnlDisplay();
  resetChecklistState();
  if(trade.checklist)Object.assign(_checklistState,trade.checklist);
  renderChecklist();setPsychValues(trade.psych||{});
  renderMistakes(trade.mistakes||[]);renderStrengths(trade.strengths||[]);
  if(trade.grade){
    document.getElementById('grade-letter').textContent=trade.grade;
    document.getElementById('grade-reason').textContent=trade.gradeReason||'';
  }
  if(trade.aiReview)document.getElementById('ai-review-text').textContent=trade.aiReview;
  updateScreenshotPreview(trade.screenshot||'');
}

function readTradeForm(){
  const g=id=>document.getElementById(id)?.value??'';
  const psych=getPsychValues();
  const commission = parseFloat(g('f-commission'))||0;
  const swap       = parseFloat(g('f-swap'))||0;
  const otherFees  = parseFloat(g('f-other-fees'))||0;
  const grossPnl   = parseFloat(g('f-pnl'))||0;
  return{
    id:_editingTradeId||uid(),
    pair:g('f-pair').toUpperCase(),direction:g('f-direction'),
    date:g('f-date'),time:g('f-time'),session:g('f-session'),
    htf:g('f-htf'),ltf:g('f-ltf'),
    entry:Number(g('f-entry')),sl:Number(g('f-sl')),tp:Number(g('f-tp')),
    risk:Number(g('f-risk')),rr:Number(g('f-rr')),
    outcome:g('f-outcome'),pnl:grossPnl,
    commission, swap, otherFees,
    duration:g('f-duration'),news:g('f-news'),
    tags:g('f-tags').split(',').map(s=>s.trim()).filter(Boolean),
    screenshot:g('f-screenshot'),emotionNotes:g('f-emotion-notes'),notes:g('f-notes'),
    psych,psychScore:computePsychScore(psych),
    mistakes:getChecked('mistake'),strengths:getChecked('strength'),
    checklist:{..._checklistState},checklistPct:getChecklistPct(),
  };
}

function updateNetPnlDisplay(){
  const gross  = parseFloat(document.getElementById('f-pnl')?.value)||0;
  const comm   = parseFloat(document.getElementById('f-commission')?.value)||0;
  const swap   = parseFloat(document.getElementById('f-swap')?.value)||0;
  const other  = parseFloat(document.getElementById('f-other-fees')?.value)||0;
  const net    = gross - comm - (-swap) - other;
  const el     = document.getElementById('net-pnl-value');
  if(!el)return;
  if(gross===0&&comm===0&&swap===0&&other===0){el.textContent='—';el.className='net-pnl-value';return;}
  el.textContent=(net>=0?'+':'')+'$'+net.toFixed(2);
  el.className='net-pnl-value'+(net>0?' positive':net<0?' negative':'');
}

function updateScreenshotPreview(url){
  const wrap=document.getElementById('screenshot-preview-wrap');
  const img =document.getElementById('screenshot-preview-img');
  if(!wrap||!img)return;
  const u=(url||'').trim();
  if(u&&(u.startsWith('http')||u.startsWith('data:'))){
    img.src=u;wrap.classList.remove('hidden');
  }else{
    img.src='';wrap.classList.add('hidden');
  }
}

/* ============================================================
   SECTION 15 — GRADER
   ============================================================ */

const GRADE_SCALE=[
  {min:97,grade:'A+'},{min:93,grade:'A'},{min:90,grade:'A-'},
  {min:87,grade:'B+'},{min:83,grade:'B'},{min:80,grade:'B-'},
  {min:70,grade:'C'},{min:60,grade:'D'},{min:0,grade:'F'},
];
function gradeToNum(g){return({'A+':98,'A':95,'A-':91,'B+':88,'B':85,'B-':81,'C':75,'D':65,'F':50}[g]??0);}
function numToGrade(n){for(const r of GRADE_SCALE){if(n>=r.min)return r.grade;}return'F';}

function calculateGrade(trade){
  const reasons=[];let score=0;
  const clPct=trade.checklistPct??getChecklistPct();
  const clScore=Math.round(clPct*0.40);
  score+=clScore;
  reasons.push(`Checklist: ${clPct}% complete (${clScore}/40 pts)`);
  const reqMissed=state.strategy.flatMap(c=>c.rules).filter(r=>r.required&&!trade.checklist?.[r.id]);
  if(reqMissed.length){const p=reqMissed.length*5;score-=p;reasons.push(`${reqMissed.length} required rule(s) missed: -${p} pts`);}
  const ps=trade.psychScore??computePsychScore(trade.psych??{});
  const psScore=Math.round(ps*2);score+=psScore;
  reasons.push(`Psychology: ${ps.toFixed(1)}/10 (${psScore}/20 pts)`);
  const rr=trade.rr??0;
  const rrScore=rr>=4?20:rr>=3?17:rr>=2?14:rr>=1.5?10:rr>=1?6:0;
  score+=rrScore;
  reasons.push(`RR: ${rr.toFixed(2)} (${rrScore}/20 pts)`);
  const mc=(trade.mistakes??[]).length;
  if(mc){const p=Math.min(15,mc*3);score-=p;reasons.push(`${mc} mistake(s): -${p} pts`);}
  else reasons.push('No mistakes: full marks');
  const sc=(trade.strengths??[]).length;
  if(sc){const b=Math.min(10,sc*2);score+=b;reasons.push(`${sc} strength(s): +${b} pts`);}
  return{grade:numToGrade(Math.max(0,Math.min(100,score))),score:Math.max(0,Math.min(100,score)),reasons};
}

function generateAIReview(trade,g){
  const pair=trade.pair||'Unknown';const cl=trade.checklistPct??0;
  const rr=trade.rr||0;const m=trade.mistakes??[];const str=trade.strengths??[];
  const fees=getTotalFees(trade);
  let t=`You completed ${cl}% of your strategy checklist on this ${pair} ${trade.direction||''} trade. `;
  t+=cl>=90?'Plan adherence was excellent. ':cl>=70?'Adherence was acceptable but could improve. ':'A significant portion was skipped — this requires attention. ';
  t+=trade.psychScore>=7?'Mental state was solid. ':trade.psychScore>=5?'Mental state was average. ':'Poor psychology may have influenced decisions. ';
  t+=rr>=2?`Risk-reward of ${rr.toFixed(2)} was within acceptable parameters. `:`Risk-reward of ${rr.toFixed(2)} was below the recommended minimum. `;
  t+=m.length===0?'No mistakes recorded — strong discipline. ':`Mistakes noted: ${m.join(', ')}. Work to eliminate these. `;
  if(str.length)t+=`Positive behaviours: ${str.join(', ')}. `;
  if(fees>0)t+=`Total fees were $${fees.toFixed(2)} — factor this into your risk calculations consistently. `;
  if(trade.outcome==='WIN')t+='Trade closed as a winner. ';
  else if(trade.outcome==='LOSS')t+='Trade closed as a loss. Process matters more than outcome. ';
  else if(trade.outcome==='BE')t+='Trade closed at breakeven. ';
  t+=`Overall: ${g.grade} trade, process score ${g.score}/100.`;
  return t;
}

/* ============================================================
   SECTION 16 — JOURNAL
   ============================================================ */

const PAGE_SIZE=20;
let _journalPage=0;

function renderJournal(){_journalPage=0;renderJournalPage();}

function renderJournalPage(){
  const search  =document.getElementById('journal-search').value.toLowerCase();
  const outcome =document.getElementById('journal-filter-outcome').value;
  const pair    =document.getElementById('journal-filter-pair').value;
  const dateFrom=document.getElementById('journal-filter-from')?.value||'';
  const dateTo  =document.getElementById('journal-filter-to')?.value||'';

  let trades=[...state.trades].sort((a,b)=>
    new Date(b.date+'T'+(b.time||'00:00'))-new Date(a.date+'T'+(a.time||'00:00')));

  const pairs=[...new Set(state.trades.map(t=>t.pair).filter(Boolean))].sort();
  const ps=document.getElementById('journal-filter-pair');
  const cp=ps.value;
  ps.innerHTML='<option value="">All Pairs</option>'+pairs.map(p=>`<option value="${p}" ${p===cp?'selected':''}>${p}</option>`).join('');

  if(search)  trades=trades.filter(t=>JSON.stringify(t).toLowerCase().includes(search));
  if(outcome) trades=trades.filter(t=>t.outcome===outcome);
  if(pair)    trades=trades.filter(t=>t.pair===pair);
  if(dateFrom)trades=trades.filter(t=>t.date>=dateFrom);
  if(dateTo)  trades=trades.filter(t=>t.date<=dateTo);

  const tbody=document.getElementById('journal-tbody');
  const empty=document.getElementById('journal-empty');
  const pg   =document.getElementById('journal-pagination');

  if(!trades.length){tbody.innerHTML='';empty.style.display='block';if(pg)pg.innerHTML='';return;}
  empty.style.display='none';

  const totalPages=Math.ceil(trades.length/PAGE_SIZE);
  _journalPage=Math.min(_journalPage,totalPages-1);
  const page=trades.slice(_journalPage*PAGE_SIZE,(_journalPage+1)*PAGE_SIZE);

  tbody.innerHTML=page.map(t=>{
    const bc=t.outcome==='WIN'?'badge-win':t.outcome==='LOSS'?'badge-loss':t.outcome==='BE'?'badge-be':'badge-pending';
    const gross=Number(t.pnl)||0;
    const fees=getTotalFees(t);
    const net=getNetPnl(t);
    const grossStr=gross?(gross>=0?`+$${gross.toFixed(2)}`:`-$${Math.abs(gross).toFixed(2)}`):'—';
    const grossCls=gross>0?'positive':gross<0?'negative':'';
    const netStr=net?(net>=0?`+$${net.toFixed(2)}`:`-$${Math.abs(net).toFixed(2)}`):'—';
    const netCls=net>0?'positive':net<0?'negative':'';
    const feesStr=fees>0?`-$${fees.toFixed(2)}`:'—';
    return`<tr>
      <td>${t.date||'—'} ${t.time||''}</td>
      <td>${esc(t.pair||'—')}</td><td>${esc(t.direction||'—')}</td>
      <td><span class="badge ${bc}">${t.outcome||'Pending'}</span></td>
      <td class="${grossCls} mono">${grossStr}</td>
      <td class="fee-cell">${feesStr}</td>
      <td class="${netCls} mono">${netStr}</td>
      <td>${t.rr?t.rr.toFixed(2):'—'}</td>
      <td>${t.grade||'—'}</td>
      <td><div class="tbl-actions">
        <button class="btn btn-sm" onclick="viewTrade('${t.id}')">View</button>
        <button class="btn btn-sm" onclick="duplicateTrade('${t.id}')">Dup</button>
        <button class="btn btn-sm btn-danger" onclick="deleteTrade('${t.id}')">Del</button>
      </div></td>
    </tr>`;
  }).join('');

  if(pg){
    if(totalPages<=1){pg.innerHTML='';return;}
    let html='';
    if(_journalPage>0)html+=`<button class="btn btn-sm" onclick="journalPage(${_journalPage-1})">← Prev</button>`;
    html+=`<span style="font-size:12px;color:var(--text-muted);padding:0 10px">Page ${_journalPage+1}/${totalPages} (${trades.length} trades)</span>`;
    if(_journalPage<totalPages-1)html+=`<button class="btn btn-sm" onclick="journalPage(${_journalPage+1})">Next →</button>`;
    pg.innerHTML=html;
  }
}
window.journalPage=p=>{_journalPage=p;renderJournalPage();};

window.viewTrade=function(id){
  const t=state.trades.find(x=>x.id===id);if(!t)return;
  loadTradeIntoForm(t);switchTab('new-trade');
};
window.deleteTrade=async function(id){
  if(!await confirm('Delete this trade? This cannot be undone.'))return;
  state.trades=state.trades.filter(t=>t.id!==id);
  saveState();renderJournal();notify('Trade deleted.','success');
};
window.duplicateTrade=function(id){
  const t=state.trades.find(x=>x.id===id);if(!t)return;
  const dup={...t,id:uid(),date:todayStr(),time:nowTimeStr(),
    outcome:'',pnl:0,grade:undefined,gradeReason:undefined,aiReview:undefined};
  loadTradeIntoForm(dup);_editingTradeId=null;
  document.getElementById('trade-form-title').textContent='New Trade (Duplicate)';
  switchTab('new-trade');notify('Trade duplicated — edit and save as new.','info');
};

/* ============================================================
   SECTION 17 — STATISTICS
   ============================================================ */

function renderStatistics(){
  const trades=state.trades.filter(t=>t.outcome);
  const c=document.getElementById('stats-content');
  if(!trades.length){c.innerHTML='<p class="text-muted">No completed trades yet.</p>';return;}
  c.innerHTML='';
  c.appendChild(statsGroupTable('By Pair',groupByKey(trades,'pair')));
  c.appendChild(statsGroupTable('By Session',groupByKey(trades,'session')));
  c.appendChild(statsGroupTable('By Day of Week',groupByFn(trades,t=>{
    const d=new Date(t.date);return['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  })));
  c.appendChild(statsGroupTable('By HTF Bias',groupByKey(trades,'htf')));
  c.appendChild(statsGroupTable('By Grade',groupByKey(trades,'grade')));
  c.appendChild(statsGroupTable('By Outcome',groupByKey(trades,'outcome')));
  c.appendChild(monthlyPnlTable(trades));
}

function groupByKey(t,k){
  const g={};t.forEach(x=>{const v=x[k]||'Unknown';if(!g[v])g[v]=[];g[v].push(x);});return g;
}
function groupByFn(t,fn){
  const g={};t.forEach(x=>{const v=fn(x)||'Unknown';if(!g[v])g[v]=[];g[v].push(x);});return g;
}
function statsGroupTable(title,groups){
  const el=document.createElement('div');el.className='stats-group';
  let rows='';
  Object.entries(groups).forEach(([key,arr])=>{
    const wins=arr.filter(t=>t.outcome==='WIN').length;
    const losses=arr.filter(t=>t.outcome==='LOSS').length;
    const total=arr.length;
    const wr=total?Math.round(wins/total*100):0;
    const grossPnl=arr.reduce((a,t)=>a+(t.pnl||0),0);
    const netPnl=arr.reduce((a,t)=>a+getNetPnl(t),0);
    const fees=arr.reduce((a,t)=>a+getTotalFees(t),0);
    const avgRR=arr.reduce((a,t)=>a+(t.rr||0),0)/total;
    rows+=`<tr>
      <td>${esc(key)}</td><td>${total}</td><td>${wins}W / ${losses}L</td>
      <td>${wr}%</td>
      <td class="${grossPnl>=0?'positive':'negative'}">${grossPnl>=0?'+':''}$${grossPnl.toFixed(2)}</td>
      <td class="fee-cell">-$${fees.toFixed(2)}</td>
      <td class="${netPnl>=0?'positive':'negative'}">${netPnl>=0?'+':''}$${netPnl.toFixed(2)}</td>
      <td>${avgRR.toFixed(2)}</td>
    </tr>`;
  });
  el.innerHTML=`<h2 class="section-title">${title}</h2>
    <table class="stats-table">
      <thead><tr><th>Group</th><th>Trades</th><th>W/L</th><th>Win Rate</th><th>Gross P&L</th><th>Fees</th><th>Net P&L</th><th>Avg RR</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  return el;
}
function monthlyPnlTable(trades){
  const el=document.createElement('div');el.className='stats-group';
  const g={};
  trades.forEach(t=>{
    const m=(t.date||'').slice(0,7);if(!m)return;
    if(!g[m])g[m]={grossPnl:0,netPnl:0,fees:0,wins:0,losses:0,be:0,trades:0};
    g[m].grossPnl+=(t.pnl||0);
    g[m].netPnl+=getNetPnl(t);
    g[m].fees+=getTotalFees(t);
    g[m].trades++;
    if(t.outcome==='WIN')g[m].wins++;else if(t.outcome==='LOSS')g[m].losses++;else g[m].be++;
  });
  let cum=0,rows='';
  Object.keys(g).sort().forEach(m=>{
    const d=g[m];cum+=d.netPnl;
    const wr=d.trades?Math.round(d.wins/d.trades*100):0;
    rows+=`<tr>
      <td>${monthLabel(m)}</td><td>${d.trades}</td>
      <td>${d.wins}W / ${d.losses}L${d.be?` / ${d.be}BE`:''}</td>
      <td>${wr}%</td>
      <td class="${d.grossPnl>=0?'positive':'negative'}">${d.grossPnl>=0?'+':''}$${d.grossPnl.toFixed(2)}</td>
      <td class="fee-cell">-$${d.fees.toFixed(2)}</td>
      <td class="${d.netPnl>=0?'positive':'negative'}">${d.netPnl>=0?'+':''}$${d.netPnl.toFixed(2)}</td>
      <td class="${cum>=0?'positive':'negative'}">${cum>=0?'+':''}$${cum.toFixed(2)}</td>
    </tr>`;
  });
  el.innerHTML=`<h2 class="section-title">Monthly P&L</h2>
    <table class="stats-table">
      <thead><tr><th>Month</th><th>Trades</th><th>W/L/BE</th><th>Win Rate</th><th>Gross P&L</th><th>Fees</th><th>Net P&L</th><th>Cumulative</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  return el;
}

/* ============================================================
   SECTION 17b — FEES TRACKER
   ============================================================ */

function renderFeesTracker(){
  const c=document.getElementById('fees-content');
  const trades=state.trades;
  if(!trades.length){c.innerHTML='<p class="text-muted">No trades yet. Add trades with fee data to see your fee analysis.</p>';return;}

  const totalCommission = trades.reduce((a,t)=>a+(Number(t.commission)||0),0);
  const totalSwapCost   = trades.reduce((a,t)=>{const s=Number(t.swap)||0;return a+(-s);},0);
  const totalOther      = trades.reduce((a,t)=>a+(Number(t.otherFees)||0),0);
  const totalFees       = trades.reduce((a,t)=>a+getTotalFees(t),0);
  const grossPnl        = trades.reduce((a,t)=>a+(Number(t.pnl)||0),0);
  const netPnl          = trades.reduce((a,t)=>a+getNetPnl(t),0);
  const feeDragPct      = grossPnl!==0 ? (totalFees/Math.abs(grossPnl)*100) : 0;
  const tradesWithFees  = trades.filter(t=>getTotalFees(t)>0).length;
  const avgFeePerTrade  = tradesWithFees>0 ? totalFees/tradesWithFees : 0;

  c.innerHTML='';

  // Summary cards
  const summaryDiv=document.createElement('div');
  summaryDiv.className='fees-summary-grid';
  const feeCards=[
    {label:'Total Fees Paid',       value:`$${totalFees.toFixed(2)}`},
    {label:'Total Commissions',     value:`$${totalCommission.toFixed(2)}`},
    {label:'Total Swap Costs',      value:`$${totalSwapCost.toFixed(2)}`},
    {label:'Other Fees',            value:`$${totalOther.toFixed(2)}`},
    {label:'Fee Drag on Gross P&L', value:`${feeDragPct.toFixed(1)}%`},
    {label:'Avg Fee Per Trade',     value:`$${avgFeePerTrade.toFixed(2)}`},
    {label:'Gross P&L',             value:(grossPnl>=0?'+':'')+'$'+grossPnl.toFixed(2)},
    {label:'Net P&L (After Fees)',  value:(netPnl>=0?'+':'')+'$'+netPnl.toFixed(2)},
  ];
  summaryDiv.innerHTML=feeCards.map(fc=>`
    <div class="fees-card">
      <div class="fees-card-label">${fc.label}</div>
      <div class="fees-card-value">${fc.value}</div>
    </div>`).join('');
  c.appendChild(summaryDiv);

  // Fees by pair
  const byPair={};
  trades.forEach(t=>{
    const p=t.pair||'Unknown';
    if(!byPair[p])byPair[p]={commission:0,swap:0,other:0,total:0,trades:0};
    byPair[p].commission+=Number(t.commission)||0;
    byPair[p].swap+=(-Number(t.swap)||0);
    byPair[p].other+=Number(t.otherFees)||0;
    byPair[p].total+=getTotalFees(t);
    byPair[p].trades++;
  });

  const pairGroup=document.createElement('div');pairGroup.className='stats-group';
  let pairRows='';
  Object.entries(byPair).sort((a,b)=>b[1].total-a[1].total).forEach(([pair,d])=>{
    pairRows+=`<tr>
      <td>${esc(pair)}</td>
      <td>${d.trades}</td>
      <td class="fee-cell">$${d.commission.toFixed(2)}</td>
      <td class="fee-cell">$${d.swap.toFixed(2)}</td>
      <td class="fee-cell">$${d.other.toFixed(2)}</td>
      <td class="fee-cell"><strong>$${d.total.toFixed(2)}</strong></td>
      <td class="fee-cell">$${(d.total/d.trades).toFixed(2)}</td>
    </tr>`;
  });
  pairGroup.innerHTML=`<h2 class="section-title">Fees by Pair</h2>
    <table class="stats-table">
      <thead><tr><th>Pair</th><th>Trades</th><th>Commission</th><th>Swap Cost</th><th>Other</th><th>Total Fees</th><th>Avg/Trade</th></tr></thead>
      <tbody>${pairRows||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No fee data recorded yet.</td></tr>'}</tbody>
    </table>`;
  c.appendChild(pairGroup);

  // Monthly fees
  const byMonth={};
  trades.forEach(t=>{
    const m=(t.date||'').slice(0,7);if(!m)return;
    if(!byMonth[m])byMonth[m]={commission:0,swap:0,other:0,total:0,trades:0};
    byMonth[m].commission+=Number(t.commission)||0;
    byMonth[m].swap+=(-Number(t.swap)||0);
    byMonth[m].other+=Number(t.otherFees)||0;
    byMonth[m].total+=getTotalFees(t);
    byMonth[m].trades++;
  });
  const monthGroup=document.createElement('div');monthGroup.className='stats-group';
  let monthRows='';
  let cumFees=0;
  Object.keys(byMonth).sort().forEach(m=>{
    const d=byMonth[m];cumFees+=d.total;
    monthRows+=`<tr>
      <td>${monthLabel(m)}</td>
      <td>${d.trades}</td>
      <td class="fee-cell">$${d.commission.toFixed(2)}</td>
      <td class="fee-cell">$${d.swap.toFixed(2)}</td>
      <td class="fee-cell">$${d.other.toFixed(2)}</td>
      <td class="fee-cell"><strong>$${d.total.toFixed(2)}</strong></td>
      <td class="fee-cell">$${cumFees.toFixed(2)}</td>
    </tr>`;
  });
  monthGroup.innerHTML=`<h2 class="section-title">Monthly Fees</h2>
    <table class="stats-table">
      <thead><tr><th>Month</th><th>Trades</th><th>Commission</th><th>Swap Cost</th><th>Other</th><th>Month Total</th><th>Cumulative</th></tr></thead>
      <tbody>${monthRows||'<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No data yet.</td></tr>'}</tbody>
    </table>`;
  c.appendChild(monthGroup);
}

/* ============================================================
   SECTION 18 — DAILY NOTES
   ============================================================ */

function renderDailyNotes(){
  const dp=document.getElementById('daily-note-date');
  if(dp&&!dp.value)dp.value=todayStr();
  loadDailyNoteForDate();
  renderDailyNoteHistory();
}
function loadDailyNoteForDate(){
  const date=document.getElementById('daily-note-date')?.value||todayStr();
  const n=state.dailyNotes.find(x=>x.date===date);
  const ta=document.getElementById('daily-note-text');
  if(ta)ta.value=n?n.note:'';
}
function saveDailyNote(){
  const date=document.getElementById('daily-note-date')?.value||todayStr();
  const note=(document.getElementById('daily-note-text')?.value||'').trim();
  if(!note){notify('Note is empty.','error');return;}
  const idx=state.dailyNotes.findIndex(n=>n.date===date);
  if(idx>=0)state.dailyNotes[idx].note=note;
  else state.dailyNotes.push({id:uid(),date,note});
  saveState();renderDailyNoteHistory();notify('Daily note saved.','success');
}
function renderDailyNoteHistory(){
  const c=document.getElementById('daily-notes-list');if(!c)return;
  const sorted=[...state.dailyNotes].sort((a,b)=>b.date.localeCompare(a.date));
  if(!sorted.length){c.innerHTML='<p class="text-muted" style="margin-top:8px">No notes yet.</p>';return;}
  c.innerHTML=sorted.map(n=>`
    <div class="daily-note-item">
      <div class="daily-note-header">
        <span class="daily-note-date">${n.date}</span>
        <div class="tbl-actions">
          <button class="btn btn-sm" onclick="loadNoteEditor('${n.date}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteDailyNote('${n.date}')">Del</button>
        </div>
      </div>
      <div class="daily-note-body">${esc(n.note)}</div>
    </div>`).join('');
}
window.loadNoteEditor=function(date){
  document.getElementById('daily-note-date').value=date;
  loadDailyNoteForDate();
  document.getElementById('daily-note-text').focus();
};
window.deleteDailyNote=function(date){
  state.dailyNotes=state.dailyNotes.filter(n=>n.date!==date);
  saveState();renderDailyNoteHistory();notify('Note deleted.','success');
};

/* ============================================================
   SECTION 19 — IMPORT / EXPORT
   ============================================================ */

function exportJSON(){
  const data={
    exportedAt:new Date().toISOString(),version:5,
    strategy:state.strategy,trades:state.trades,
    transactions:state.transactions,dailyNotes:state.dailyNotes,
    mistakes:state.mistakes,strengths:state.strengths,settings:state.settings,
  };
  downloadFile(JSON.stringify(data,null,2),`trading-os-data-${todayStr()}.json`);
  notify('Full data exported as JSON.','success');
}

function exportCSV(){
  const cols=['id','date','time','pair','direction','session','htf','ltf',
    'entry','sl','tp','risk','rr','outcome','pnl','commission','swap','otherFees',
    'duration','news','tags','grade','checklistPct','psychScore','mistakes','strengths','notes'];
  const hdr=cols.join(',');
  const rows=state.trades.map(t=>cols.map(c=>{
    let v=t[c];
    if(Array.isArray(v))v=v.join('; ');
    if(v===undefined||v===null)v='';
    return`"${String(v).replace(/"/g,'""')}"`;
  }).join(','));
  downloadFile([hdr,...rows].join('\n'),`trading-os-trades-${todayStr()}.csv`,'text/csv');
  notify('Trades exported as CSV.','success');
}

function exportTransactionsCSV(){
  if(!state.transactions.length){notify('No transactions to export.','error');return;}
  const cols=['id','date','type','amount','note'];
  let running=state.settings.startingBalance;
  const sorted=[...state.transactions].sort((a,b)=>a.date.localeCompare(b.date));
  const hdr=cols.join(',')+',balance_after';
  const rows=sorted.map(t=>{
    running+=t.type==='deposit'?t.amount:-t.amount;
    const base=cols.map(c=>`"${String(t[c]??'').replace(/"/g,'""')}"`).join(',');
    return base+`,"${running.toFixed(2)}"`;
  });
  downloadFile([hdr,...rows].join('\n'),`trading-os-transactions-${todayStr()}.csv`,'text/csv');
  notify('Transactions exported as CSV.','success');
}

function exportSiteZip(){
  notify('Preparing site ZIP...','info');
  const htmlContent = document.documentElement.outerHTML;
  const cssHref = document.querySelector('link[rel="stylesheet"]')?.href;
  const jsHref  = document.querySelector('script[src]')?.src;
  const fetchText = url => url ? fetch(url).then(r=>r.text()).catch(()=>'') : Promise.resolve('');
  Promise.all([fetchText(cssHref), fetchText(jsHref)]).then(([cssText, jsText])=>{
    const files = [
      {name:'trading-os-v1.5/index.html', data: htmlContent},
      {name:'trading-os-v1.5/style.css',  data: cssText},
      {name:'trading-os-v1.5/script.js',  data: jsText},
    ];
    const zip = buildZip(files);
    const blob = new Blob([zip], {type:'application/zip'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trading-os-v1.5-${todayStr()}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    notify('Site ZIP downloaded! Extract and open index.html.','success');
  });
}

function buildZip(files){
  const enc = new TextEncoder();
  const parts = [];
  const centralDir = [];
  let offset = 0;
  const u32 = n => {const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);return b;};
  const u16 = n => {const b=new Uint8Array(2);new DataView(b.buffer).setUint16(0,n,true);return b;};
  const crc32Table = (()=>{
    const t=new Uint32Array(256);
    for(let i=0;i<256;i++){
      let c=i;for(let j=0;j<8;j++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[i]=c;
    }return t;
  })();
  const crc32 = data => {
    let c=0xFFFFFFFF;
    for(let i=0;i<data.length;i++)c=crc32Table[(c^data[i])&0xFF]^(c>>>8);
    return(c^0xFFFFFFFF)>>>0;
  };
  const dosDate = (()=>{
    const d=new Date();
    const day=d.getDate(),month=d.getMonth()+1,year=d.getFullYear()-1980;
    const h=d.getHours(),min=d.getMinutes(),sec=Math.floor(d.getSeconds()/2);
    return{date:(year<<9)|(month<<5)|day, time:(h<<11)|(min<<5)|sec};
  })();
  files.forEach(f=>{
    const nameBytes = enc.encode(f.name);
    const dataBytes = enc.encode(f.data);
    const crc = crc32(dataBytes);
    const localHeader = new Uint8Array([
      0x50,0x4B,0x03,0x04, 20,0, 0,0, 0,0,
      ...u16(dosDate.time),...u16(dosDate.date),
      ...u32(crc),
      ...u32(dataBytes.length),...u32(dataBytes.length),
      ...u16(nameBytes.length),...u16(0),
    ]);
    const localEntry = new Uint8Array(localHeader.length+nameBytes.length+dataBytes.length);
    localEntry.set(localHeader);
    localEntry.set(nameBytes,localHeader.length);
    localEntry.set(dataBytes,localHeader.length+nameBytes.length);
    parts.push(localEntry);
    const cdEntry = new Uint8Array([
      0x50,0x4B,0x01,0x02, 20,0,20,0, 0,0,0,0,
      ...u16(dosDate.time),...u16(dosDate.date),
      ...u32(crc),
      ...u32(dataBytes.length),...u32(dataBytes.length),
      ...u16(nameBytes.length),...u16(0),...u16(0),
      ...u16(0),...u16(0),
      ...u32(0),
      ...u32(offset),
    ]);
    const cd = new Uint8Array(cdEntry.length+nameBytes.length);
    cd.set(cdEntry);cd.set(nameBytes,cdEntry.length);
    centralDir.push(cd);
    offset+=localEntry.length;
  });
  const cdBytes = centralDir.reduce((a,b)=>{const n=new Uint8Array(a.length+b.length);n.set(a);n.set(b,a.length);return n;},new Uint8Array(0));
  const eocd = new Uint8Array([
    0x50,0x4B,0x05,0x06,
    ...u16(0),...u16(0),
    ...u16(files.length),...u16(files.length),
    ...u32(cdBytes.length),...u32(offset),
    ...u16(0),
  ]);
  const total=parts.reduce((a,b)=>a+b.length,0)+cdBytes.length+eocd.length;
  const out=new Uint8Array(total);
  let pos=0;
  parts.forEach(p=>{out.set(p,pos);pos+=p.length;});
  out.set(cdBytes,pos);pos+=cdBytes.length;
  out.set(eocd,pos);
  return out;
}

function importJSON(file){
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.trades||!Array.isArray(data.trades)){notify('Invalid file — missing trades array.','error');return;}
      const ok=await confirm(`Import ${data.trades.length} trade(s) and ${(data.transactions||[]).length} transaction(s)?`);
      if(!ok)return;
      data.trades.forEach(d=>{
        const i=state.trades.findIndex(t=>t.id===d.id);
        if(i>=0)state.trades[i]=d;else state.trades.push(d);
      });
      (data.transactions||[]).forEach(d=>{
        const i=state.transactions.findIndex(t=>t.id===d.id);
        if(i>=0)state.transactions[i]=d;else state.transactions.push(d);
      });
      (data.dailyNotes||[]).forEach(d=>{
        const i=state.dailyNotes.findIndex(n=>n.date===d.date);
        if(i>=0)state.dailyNotes[i]=d;else state.dailyNotes.push(d);
      });
      if(data.strategy&&await confirm('Import strategy from file too?'))state.strategy=data.strategy;
      saveState();renderJournal();renderDashboard();
      notify(`Imported ${data.trades.length} trade(s) + ${(data.transactions||[]).length} transaction(s).`,'success');
    }catch(err){notify('Failed to import: '+err.message,'error');}
  };
  reader.readAsText(file);
}

function backupAll(){
  downloadFile(JSON.stringify(state,null,2),`trading-os-BACKUP-${todayStr()}.json`);
  notify('Full backup downloaded.','success');
}

/* ============================================================
   SECTION 20 — SETTINGS
   ============================================================ */

function loadSettingsForm(){
  const s=state.settings;
  document.getElementById('s-starting-balance').value=s.startingBalance;
  document.getElementById('s-current-balance').value =s.currentBalance;
  document.getElementById('s-default-risk').value    =s.defaultRisk;
  document.getElementById('s-default-rr').value      =s.defaultRR;
  document.getElementById('s-currency').value        =s.currency;
  document.getElementById('s-timezone').value        =s.timezone;
  document.getElementById('s-theme').value           =s.theme;
  document.getElementById('s-accent-color').value    =s.accentColor;
  document.getElementById('s-default-commission').value = s.defaultCommission||0;
  document.getElementById('s-default-swap').value       = s.defaultSwap||0;
  document.getElementById('s-default-other-fees').value = s.defaultOtherFees||0;
}
function saveSettings(){
  state.settings.startingBalance   =Number(document.getElementById('s-starting-balance').value);
  state.settings.currentBalance    =Number(document.getElementById('s-current-balance').value);
  state.settings.defaultRisk       =Number(document.getElementById('s-default-risk').value);
  state.settings.defaultRR         =Number(document.getElementById('s-default-rr').value);
  state.settings.currency          =document.getElementById('s-currency').value.trim();
  state.settings.timezone          =document.getElementById('s-timezone').value.trim();
  state.settings.theme             =document.getElementById('s-theme').value;
  state.settings.accentColor       =document.getElementById('s-accent-color').value;
  state.settings.defaultCommission =Number(document.getElementById('s-default-commission').value)||0;
  state.settings.defaultSwap       =Number(document.getElementById('s-default-swap').value)||0;
  state.settings.defaultOtherFees  =Number(document.getElementById('s-default-other-fees').value)||0;
  saveState();applyTheme();notify('Settings saved.','success');
}

/* ============================================================
   SECTION 21 — KEYBOARD SHORTCUTS
   ============================================================ */

function initKeyboardShortcuts(){
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey){
      switch(e.key.toLowerCase()){
        case 's':e.preventDefault();handleSave();break;
        case 'n':e.preventDefault();switchTab('new-trade');break;
        case 'e':e.preventDefault();exportJSON();break;
        case 'f':e.preventDefault();switchTab('journal');
          setTimeout(()=>document.getElementById('journal-search').focus(),100);break;
      }
    }
    if(e.key==='Escape')closeTxnModal();
  });
}
function handleSave(){
  const t=document.querySelector('.tab-section.active')?.id;
  if(t==='tab-new-trade')saveTrade();
  else if(t==='tab-settings')saveSettings();
  else if(t==='tab-strategy')saveStrategy();
}

/* ============================================================
   SECTION 22 — SAVE TRADE / STRATEGY
   ============================================================ */

function saveTrade(){
  const trade=readTradeForm();
  if(!trade.pair||!trade.date){notify('Pair and Date are required.','error');return;}
  const g=calculateGrade(trade);
  trade.grade=g.grade;trade.gradeReason=g.reasons.join('\n');
  trade.aiReview=generateAIReview(trade,g);trade.checklistPct=getChecklistPct();
  document.getElementById('grade-letter').textContent=trade.grade;
  document.getElementById('grade-reason').textContent=trade.gradeReason;
  document.getElementById('ai-review-text').textContent=trade.aiReview;
  if(_editingTradeId){
    const i=state.trades.findIndex(t=>t.id===_editingTradeId);
    if(i>=0)state.trades[i]=trade;else state.trades.push(trade);
  }else{
    state.trades.push(trade);_editingTradeId=trade.id;
  }
  saveState();
  const net=getNetPnl(trade);
  const fees=getTotalFees(trade);
  const feeNote=fees>0?` (fees: $${fees.toFixed(2)}, net: ${net>=0?'+':''}$${net.toFixed(2)})`:'';
  notify(`Trade saved! Grade: ${trade.grade}${feeNote}`,'success');
  document.getElementById('trade-form-title').textContent='Edit Trade — '+trade.pair;
}
function saveStrategy(){saveState();renderStrategyBuilder();notify('Strategy saved.','success');}

/* ============================================================
   SECTION 23 — INIT
   ============================================================ */

function init(){
  loadState();applyTheme();initNav();initKeyboardShortcuts();
  renderDashboard();renderStrategyBuilder();renderPsychSliders();
  resetTradeForm();loadSettingsForm();

  document.getElementById('btn-new-trade-quick').addEventListener('click',()=>{
    _editingTradeId=null;resetTradeForm();switchTab('new-trade');
  });

  // Strategy
  document.getElementById('btn-add-category').addEventListener('click',()=>{
    state.strategy.push({id:uid(),name:'New Category',rules:[]});renderStrategyBuilder();
  });
  document.getElementById('btn-save-strategy').addEventListener('click',saveStrategy);

  // Checklist
  document.getElementById('checklist-search').addEventListener('input',e=>renderChecklist(e.target.value));

  // Screenshot
  document.getElementById('f-screenshot').addEventListener('input',e=>updateScreenshotPreview(e.target.value));

  // Live net P&L calculation
  ['f-pnl','f-commission','f-swap','f-other-fees'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input',updateNetPnlDisplay);
  });

  // Mistakes / Strengths
  document.getElementById('btn-add-mistake').addEventListener('click',()=>{
    const i=document.getElementById('new-mistake-input');const v=i.value.trim();
    if(!v)return;if(!state.mistakes.includes(v))state.mistakes.push(v);
    saveState();i.value='';renderMistakes(getChecked('mistake'));
  });
  document.getElementById('btn-add-strength').addEventListener('click',()=>{
    const i=document.getElementById('new-strength-input');const v=i.value.trim();
    if(!v)return;if(!state.strengths.includes(v))state.strengths.push(v);
    saveState();i.value='';renderStrengths(getChecked('strength'));
  });
  ['new-mistake-input','new-strength-input'].forEach(id=>{
    document.getElementById(id).addEventListener('keydown',e=>{
      if(e.key==='Enter')document.getElementById('btn-add-'+id.replace('new-','').replace('-input','')).click();
    });
  });

  // Trade form
  document.getElementById('btn-save-trade').addEventListener('click',saveTrade);
  document.getElementById('btn-reset-form').addEventListener('click',async()=>{
    if(await confirm('Reset form? Unsaved changes will be lost.')){_editingTradeId=null;resetTradeForm();}
  });
  document.getElementById('btn-calc-grade').addEventListener('click',()=>{
    const t=readTradeForm();const g=calculateGrade(t);
    document.getElementById('grade-letter').textContent=g.grade;
    document.getElementById('grade-reason').textContent=g.reasons.join('\n');
    document.getElementById('ai-review-text').textContent=generateAIReview(t,g);
  });

  // Journal
  ['journal-search','journal-filter-outcome','journal-filter-pair',
   'journal-filter-from','journal-filter-to'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.addEventListener('change',renderJournal);el.addEventListener('input',renderJournal);}
  });
  document.getElementById('btn-clear-dates')?.addEventListener('click',()=>{
    document.getElementById('journal-filter-from').value='';
    document.getElementById('journal-filter-to').value='';
    renderJournal();
  });

  // Export / Import
  document.getElementById('btn-export-json').addEventListener('click',exportJSON);
  document.getElementById('btn-export-csv').addEventListener('click',exportCSV);
  document.getElementById('btn-export-site-zip').addEventListener('click',exportSiteZip);
  document.getElementById('btn-import-json').addEventListener('click',()=>document.getElementById('import-file-input').click());
  document.getElementById('import-file-input').addEventListener('change',e=>{
    if(e.target.files[0])importJSON(e.target.files[0]);e.target.value='';
  });

  // Account
  document.getElementById('btn-add-deposit').addEventListener('click',()=>openTxnModal('deposit'));
  document.getElementById('btn-add-withdrawal').addEventListener('click',()=>openTxnModal('withdrawal'));
  document.getElementById('txn-type').addEventListener('change',e=>{
    document.getElementById('txn-title').textContent=
      e.target.value==='deposit'?'Add Deposit':'Add Withdrawal';
    updateTxnModalInfo();
  });
  document.getElementById('txn-save').addEventListener('click',saveTxn);
  document.getElementById('txn-cancel').addEventListener('click',closeTxnModal);
  document.getElementById('txn-amount').addEventListener('keydown',e=>{if(e.key==='Enter')saveTxn();});
  document.getElementById('btn-export-txn-csv')?.addEventListener('click',exportTransactionsCSV);

  // Daily notes
  document.getElementById('daily-note-date')?.addEventListener('change',loadDailyNoteForDate);
  document.getElementById('btn-save-daily-note')?.addEventListener('click',saveDailyNote);

  // Settings
  document.getElementById('btn-save-settings').addEventListener('click',saveSettings);
  document.getElementById('btn-backup').addEventListener('click',backupAll);
  document.getElementById('btn-clear-all').addEventListener('click',async()=>{
    if(!await confirm('Clear ALL data? This cannot be undone.'))return;
    state={strategy:DEFAULT_STRATEGY,trades:[],transactions:[],dailyNotes:[],
      settings:{...DEFAULT_SETTINGS},mistakes:[...DEFAULT_MISTAKES],strengths:[...DEFAULT_STRENGTHS]};
    saveState();applyTheme();renderDashboard();renderStrategyBuilder();
    resetTradeForm();loadSettingsForm();notify('All data cleared.','success');
  });

  window.addEventListener('resize',()=>{
    if(document.getElementById('tab-account')?.classList.contains('active'))renderEquityCurve();
  });
}

document.addEventListener('DOMContentLoaded',init);
