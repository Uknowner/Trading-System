/* ============================================================
   TRADING OS — script.js  (enhanced: deposits, withdrawals, equity curve)
   Single-file vanilla JS. No frameworks. No libraries.
   All state lives in localStorage under the "tradingOS" key.
   ============================================================ */

'use strict';

/* ============================================================
   SECTION 1 — DEFAULT CONFIGURATION
   ============================================================ */

const DEFAULT_STRATEGY = [
  {
    id: 'htf',
    name: 'Higher Timeframe Analysis',
    rules: [
      { id: 'htf1', name: 'Weekly bias identified',    desc: 'Determine overall weekly trend direction', weight: 10, required: true  },
      { id: 'htf2', name: 'Daily bias aligned',        desc: 'Daily chart confirms weekly direction',     weight: 10, required: true  },
      { id: 'htf3', name: 'H4 bias aligned',           desc: 'H4 structure supports daily bias',          weight: 8,  required: false },
    ]
  },
  {
    id: 'zone',
    name: 'Zone Rules',
    rules: [
      { id: 'z1', name: 'Weekly Zone Identified', desc: 'Price left the zone impulsively.', weight: 10, required: true },
      { id: 'z2', name: 'Daily Zone Confirmed', desc: 'Daily zone aligns with the weekly zone and left impulsively.', weight: 10, required: true },
      { id: 'z3', name: 'Fresh Zone', desc: 'The zone has not been significantly tapped before.', weight: 8, required: false },
      { id: 'z4', name: 'No Deep Penetration', desc: 'Price has not penetrated more than 50% into the zone.', weight: 7, required: false }
    ]
  },
  {
    id: 'confirmation',
    name: 'Confirmation Rules',
    rules: [
      { id: 'c1', name: 'Absorption / Accumulation', desc: 'Evidence of absorption or accumulation before the move.', weight: 8, required: false },
      { id: 'c2', name: 'Engulfing Candle', desc: 'Strong engulfing candle confirms momentum.', weight: 10, required: true },
      { id: 'c3', name: 'Lower Timeframe Change in Structure', desc: 'Market structure changes in the trade direction.', weight: 10, required: true },
      { id: 'c4', name: 'Liquidity Sweep / False Tap', desc: 'Liquidity is taken before the move.', weight: 8, required: false },
      { id: 'c5', name: '50 EMA Retest', desc: 'Price retests the 50 EMA before entry.', weight: 9, required: true }
    ]
  },
  {
    id: 'risk',
    name: 'Risk Rules',
    rules: [
      { id: 'r1', name: 'SL below/above structure',   desc: 'Stop loss is placed beyond key structure',     weight: 10, required: true  },
      { id: 'r2', name: 'Min 1:2 RR',                 desc: 'Reward must be at least twice the risk',       weight: 10, required: true  }
    ]
  },
  {
    id: 'news',
    name: 'News Rules',
    rules: [
      { id: 'n1', name: 'No red-folder news within 30min', desc: 'Avoid high-impact news events',           weight: 8,  required: false },
      { id: 'n2', name: 'News checked on Forex Factory', desc: 'Verified on economic calendar',             weight: 5,  required: false },
    ]
  },
  {
    id: 'psychology',
    name: 'Psychology Rules',
    rules: [
      { id: 'p1', name: 'Not revenge trading',         desc: 'No previous loss in last 30 minutes',         weight: 9,  required: true  },
      { id: 'p2', name: 'Mental state is clear',       desc: 'Stress and fatigue are acceptable',           weight: 7,  required: false },
      { id: 'p3', name: 'No FOMO detected',            desc: 'Entry is planned, not chased',                weight: 8,  required: true  },
    ]
  },
];

const DEFAULT_MISTAKES = [
  'FOMO', 'Early Entry', 'Late Entry', 'Ignored Confirmation',
  'Ignored HTF', 'Ignored News', 'Poor RR', 'Overtrading',
  'Revenge Trade', 'Moved SL', 'Moved TP', 'Poor Psychology', 'Skipped Checklist'
];

const DEFAULT_STRENGTHS = [
  'Waited Patiently', 'Perfect Confirmation', 'Excellent RR',
  'Good Discipline', 'Followed Plan', 'Protected Capital',
  'Accepted Loss', 'No FOMO', 'Managed Risk Well'
];

const PSYCH_FIELDS = [
  { id: 'confidence', label: 'Confidence' },
  { id: 'patience',   label: 'Patience'   },
  { id: 'discipline', label: 'Discipline' },
  { id: 'fear',       label: 'Fear'       },
  { id: 'greed',      label: 'Greed'      },
  { id: 'focus',      label: 'Focus'      },
  { id: 'stress',     label: 'Stress'     },
  { id: 'fatigue',    label: 'Fatigue'    },
  { id: 'sleep',      label: 'Sleep'      },
  { id: 'mood',       label: 'Mood'       },
];

const DEFAULT_SETTINGS = {
  startingBalance: 10000,
  currentBalance:  10000,
  defaultRisk:     1,
  defaultRR:       2,
  currency:        'USD',
  timezone:        'UTC',
  theme:           'system',
  accentColor:     '#2563eb',
};

/* ============================================================
   SECTION 2 — STATE / STORAGE
   ============================================================ */

const DB_KEY = 'tradingOS_v1';

let state = {
  strategy:     DEFAULT_STRATEGY,
  trades:       [],
  transactions: [],   // NEW: { id, type: 'deposit'|'withdrawal', date, amount, note }
  settings:     { ...DEFAULT_SETTINGS },
  mistakes:     [...DEFAULT_MISTAKES],
  strengths:    [...DEFAULT_STRENGTHS],
};

function loadState() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state = {
        strategy:     saved.strategy     ?? DEFAULT_STRATEGY,
        trades:       saved.trades       ?? [],
        transactions: saved.transactions ?? [],
        settings:     { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
        mistakes:     saved.mistakes     ?? [...DEFAULT_MISTAKES],
        strengths:    saved.strengths    ?? [...DEFAULT_STRENGTHS],
      };
    }
  } catch (e) {
    console.error('Failed to load state:', e);
  }
}

function saveState() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

/* ============================================================
   SECTION 3 — UTILITY HELPERS
   ============================================================ */

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function fmtCurrency(n, cur) {
  const sign = n >= 0 ? '+' : '';
  return sign + Number(n).toFixed(2) + (cur ? ' ' + cur : '');
}

function fmtPct(n) {
  return Number(n).toFixed(1) + '%';
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nowTimeStr() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

function notify(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'notification ' + type;
  el.textContent = msg;
  document.getElementById('notification-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function confirm(msg) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-overlay');
    document.getElementById('confirm-message').textContent = msg;
    overlay.classList.remove('hidden');
    const yes = document.getElementById('confirm-yes');
    const no  = document.getElementById('confirm-no');
    const cleanup = () => overlay.classList.add('hidden');
    yes.onclick = () => { cleanup(); resolve(true);  };
    no.onclick  = () => { cleanup(); resolve(false); };
  });
}

function downloadFile(content, filename, mime = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
   SECTION 4 — THEME
   ============================================================ */

function applyTheme() {
  const { theme, accentColor } = state.settings;
  document.documentElement.setAttribute('data-theme', theme === 'system' ? '' : theme);
  document.documentElement.style.setProperty('--accent', accentColor);
  document.documentElement.style.setProperty('--accent-h', accentColor);
}

/* ============================================================
   SECTION 5 — NAVIGATION / TABS
   ============================================================ */

function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
  });
}

function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.add('active');

  if (tab === 'dashboard')  renderDashboard();
  if (tab === 'statistics') renderStatistics();
  if (tab === 'journal')    renderJournal();
  if (tab === 'account')    renderAccount();
  if (tab === 'new-trade') {
    if (!_editingTradeId) resetTradeForm();
    renderChecklist();
  }
}

/* ============================================================
   SECTION 6 — DASHBOARD
   ============================================================ */

/** Compute the "live" balance = starting balance + all deposits/withdrawals + all trade PnL */
function computeLiveBalance() {
  const txnNet = state.transactions.reduce((sum, t) => {
    return sum + (t.type === 'deposit' ? t.amount : -t.amount);
  }, 0);
  const tradeNet = state.trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  return state.settings.startingBalance + txnNet + tradeNet;
}

/** Total net deposits (deposits minus withdrawals) */
function computeNetDeposits() {
  return state.transactions.reduce((sum, t) => {
    return sum + (t.type === 'deposit' ? t.amount : -t.amount);
  }, 0);
}

function renderDashboard() {
  const trades = state.trades;
  const s = state.settings;

  const wins   = trades.filter(t => t.outcome === 'WIN');
  const losses = trades.filter(t => t.outcome === 'LOSS');

  const totalProfit = wins.reduce((a, t) => a + (t.pnl || 0), 0);
  const totalLoss   = losses.reduce((a, t) => a + (t.pnl || 0), 0);
  const netProfit   = totalProfit + totalLoss;

  const completedTrades = trades.filter(t => t.outcome);
  const winRate  = completedTrades.length > 0 ? (wins.length / completedTrades.length * 100) : 0;
  const avgRR    = trades.length > 0 ? trades.reduce((a, t) => a + (Number(t.rr) || 0), 0) / trades.length : 0;
  const pf       = Math.abs(totalLoss) > 0 ? totalProfit / Math.abs(totalLoss) : 0;

  const grades    = trades.filter(t => t.grade).map(t => gradeToNum(t.grade));
  const avgGradeN = grades.length > 0 ? grades.reduce((a, b) => a + b, 0) / grades.length : null;

  const psychScores = trades.filter(t => t.psychScore).map(t => t.psychScore);
  const avgPsych    = psychScores.length > 0 ? psychScores.reduce((a, b) => a + b, 0) / psychScores.length : 0;

  const pnls      = trades.map(t => t.pnl || 0);
  const largestWin  = pnls.length ? Math.max(...pnls) : 0;
  const largestLoss = pnls.length ? Math.min(...pnls) : 0;

  const now   = new Date();
  const weekStart  = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisWeek   = trades.filter(t => new Date(t.date) >= weekStart).length;
  const thisMonth  = trades.filter(t => new Date(t.date) >= monthStart).length;

  const sorted = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date));
  let tempWin = 0, tempLoss = 0, bestStreak = 0, worstStreak = 0, curStreak = 0;
  sorted.forEach(t => {
    if (t.outcome === 'WIN') { tempWin++; tempLoss = 0; }
    else if (t.outcome === 'LOSS') { tempLoss++; tempWin = 0; }
    bestStreak  = Math.max(bestStreak,  tempWin);
    worstStreak = Math.max(worstStreak, tempLoss);
  });
  if (sorted.length > 0) {
    const last = sorted[sorted.length - 1];
    if (last.outcome === 'WIN')       curStreak =  tempWin;
    else if (last.outcome === 'LOSS') curStreak = -tempLoss;
  }

  // Drawdown (running balance includes deposits/withdrawals)
  const liveBalance = computeLiveBalance();
  let runBal = s.startingBalance, peak = s.startingBalance, maxDD = 0;
  // Mix sorted txn + sorted trades for drawdown
  const events = buildChronologicalEvents();
  runBal = s.startingBalance; peak = s.startingBalance;
  events.forEach(ev => {
    if (ev.kind === 'deposit')     runBal += ev.amount;
    else if (ev.kind === 'withdrawal') runBal -= ev.amount;
    else runBal += (ev.pnl || 0);
    if (runBal > peak) peak = runBal;
    const dd = peak > 0 ? (peak - runBal) / peak * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  });

  const totalDeposits    = state.transactions.filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
  const totalWithdrawals = state.transactions.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);

  const cards = [
    { label: 'Live Balance',        value: `$${liveBalance.toFixed(2)}`,        cls: liveBalance >= s.startingBalance ? 'positive' : 'negative' },
    { label: 'Starting Balance',    value: `$${s.startingBalance.toFixed(2)}` },
    { label: 'Net Trading P&L',     value: `$${netProfit.toFixed(2)}`,          cls: netProfit >= 0 ? 'positive' : 'negative' },
    { label: 'Total Deposits',      value: `$${totalDeposits.toFixed(2)}`,      cls: 'positive' },
    { label: 'Total Withdrawals',   value: `$${totalWithdrawals.toFixed(2)}`,   cls: totalWithdrawals > 0 ? 'negative' : '' },
    { label: 'Max Drawdown',        value: fmtPct(maxDD),                       cls: maxDD > 10 ? 'negative' : '' },
    { label: 'Largest Win',         value: `$${largestWin.toFixed(2)}`,         cls: 'positive' },
    { label: 'Largest Loss',        value: `$${largestLoss.toFixed(2)}`,        cls: 'negative' },
    { label: 'Win Rate',            value: fmtPct(winRate) },
    { label: 'Average RR',          value: avgRR.toFixed(2) },
    { label: 'Profit Factor',       value: pf.toFixed(2) },
    { label: 'Avg Grade',           value: avgGradeN ? numToGrade(avgGradeN) : '-' },
    { label: 'Avg Psychology',      value: avgPsych ? avgPsych.toFixed(1) + '/10' : '-' },
    { label: 'Trades This Week',    value: thisWeek },
    { label: 'Trades This Month',   value: thisMonth },
    { label: 'Total Trades',        value: trades.length },
    { label: 'Current Streak',      value: curStreak >= 0 ? `+${curStreak} W` : `${curStreak} L`, cls: curStreak > 0 ? 'positive' : curStreak < 0 ? 'negative' : '' },
    { label: 'Best Win Streak',     value: `${bestStreak} W`,  cls: 'positive' },
    { label: 'Worst Loss Streak',   value: `${worstStreak} L`, cls: worstStreak > 2 ? 'negative' : '' },
  ];

  const grid = document.getElementById('dashboard-cards');
  grid.innerHTML = cards.map(c => `
    <div class="dash-card">
      <div class="dash-card-label">${c.label}</div>
      <div class="dash-card-value ${c.cls || ''}">${c.value}</div>
    </div>
  `).join('');
}

/* ============================================================
   SECTION 6B — ACCOUNT TAB (deposits, withdrawals, equity)
   ============================================================ */

/** Returns all money events sorted by date ascending */
function buildChronologicalEvents() {
  const txnEvents = state.transactions.map(t => ({
    kind:   t.type,   // 'deposit' | 'withdrawal'
    date:   t.date,
    amount: t.amount,
    note:   t.note,
    id:     t.id,
  }));
  const tradeEvents = state.trades.filter(t => t.outcome && t.pnl).map(t => ({
    kind:  'trade',
    date:  t.date,
    pnl:   t.pnl,
    pair:  t.pair,
    id:    t.id,
  }));
  return [...txnEvents, ...tradeEvents].sort((a, b) => a.date.localeCompare(b.date));
}

function renderAccount() {
  renderAccountCards();
  renderEquityCurve();
  renderTransactionTable();
}

function renderAccountCards() {
  const totalDeposits    = state.transactions.filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
  const totalWithdrawals = state.transactions.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);
  const netTxn           = totalDeposits - totalWithdrawals;
  const tradePnl         = state.trades.reduce((s, t) => s + (t.pnl || 0), 0);
  const liveBalance      = state.settings.startingBalance + netTxn + tradePnl;
  const roi              = state.settings.startingBalance > 0 ? ((liveBalance - state.settings.startingBalance) / state.settings.startingBalance * 100) : 0;

  const cards = [
    { label: 'Live Balance',      value: `$${liveBalance.toFixed(2)}`,      cls: liveBalance >= state.settings.startingBalance ? 'positive' : 'negative' },
    { label: 'Total Deposited',   value: `$${totalDeposits.toFixed(2)}`,    cls: 'positive' },
    { label: 'Total Withdrawn',   value: `$${totalWithdrawals.toFixed(2)}`, cls: totalWithdrawals > 0 ? 'negative' : '' },
    { label: 'Net Deposits',      value: (netTxn >= 0 ? '+' : '') + `$${netTxn.toFixed(2)}`, cls: netTxn >= 0 ? 'positive' : 'negative' },
    { label: 'Net Trading P&L',   value: (tradePnl >= 0 ? '+' : '') + `$${tradePnl.toFixed(2)}`, cls: tradePnl >= 0 ? 'positive' : 'negative' },
    { label: 'ROI (vs Starting)', value: (roi >= 0 ? '+' : '') + roi.toFixed(2) + '%', cls: roi >= 0 ? 'positive' : 'negative' },
  ];

  document.getElementById('account-balance-cards').innerHTML = cards.map(c => `
    <div class="dash-card">
      <div class="dash-card-label">${c.label}</div>
      <div class="dash-card-value ${c.cls || ''}">${c.value}</div>
    </div>
  `).join('');
}

function renderEquityCurve() {
  const canvas = document.getElementById('equity-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Build data points
  const events = buildChronologicalEvents();
  let balance = state.settings.startingBalance;
  const points = [{ date: 'Start', balance }];

  events.forEach(ev => {
    if (ev.kind === 'deposit')    balance += ev.amount;
    else if (ev.kind === 'withdrawal') balance -= ev.amount;
    else balance += (ev.pnl || 0);
    points.push({ date: ev.date, balance });
  });

  if (points.length < 2) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#888';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    canvas.width = canvas.offsetWidth || 600;
    canvas.height = 160;
    ctx.fillText('Add transactions or trades to see your equity curve.', canvas.width / 2, 80);
    return;
  }

  // Responsive sizing
  canvas.width  = canvas.offsetWidth || 600;
  canvas.height = 160;
  const W = canvas.width;
  const H = canvas.height;
  const pad = { top: 20, right: 20, bottom: 30, left: 60 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top  - pad.bottom;

  // Colour tokens from CSS vars
  const accent   = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()      || '#2563eb';
  const textMuted= getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim()  || '#6b7280';
  const border   = getComputedStyle(document.documentElement).getPropertyValue('--border').trim()      || '#e5e7eb';

  ctx.clearRect(0, 0, W, H);

  const bals   = points.map(p => p.balance);
  const minBal = Math.min(...bals);
  const maxBal = Math.max(...bals);
  const range  = maxBal - minBal || 1;

  const xOf = i => pad.left + (i / (points.length - 1)) * cW;
  const yOf = b => pad.top  + cH - ((b - minBal) / range) * cH;

  // Grid lines (4 horizontal)
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke();
    const val = maxBal - (range / 4) * i;
    ctx.fillStyle = textMuted;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('$' + val.toFixed(0), pad.left - 4, y + 4);
  }

  // Fill under curve
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(points[0].balance));
  points.forEach((p, i) => ctx.lineTo(xOf(i), yOf(p.balance)));
  ctx.lineTo(xOf(points.length - 1), pad.top + cH);
  ctx.lineTo(pad.left, pad.top + cH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
  grad.addColorStop(0, accent + '55');
  grad.addColorStop(1, accent + '00');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(points[0].balance));
  points.forEach((p, i) => ctx.lineTo(xOf(i), yOf(p.balance)));
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.lineJoin  = 'round';
  ctx.stroke();

  // Dots at events
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(xOf(i), yOf(p.balance), 3, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
  });

  // Starting balance reference line
  const refY = yOf(state.settings.startingBalance);
  if (refY >= pad.top && refY <= pad.top + cH) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, refY); ctx.lineTo(pad.left + cW, refY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = textMuted;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('Start', pad.left + 4, refY - 3);
  }
}

function renderTransactionTable() {
  const tbody = document.getElementById('txn-tbody');
  const empty = document.getElementById('txn-empty');

  const txns = [...state.transactions].sort((a, b) => a.date.localeCompare(b.date));

  if (txns.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // Compute running balance
  let running = state.settings.startingBalance;
  const rows = txns.map(t => {
    running += t.type === 'deposit' ? t.amount : -t.amount;
    const badgeCls = t.type === 'deposit' ? 'badge-deposit' : 'badge-withdrawal';
    const amtSign  = t.type === 'deposit' ? '+' : '-';
    const amtCls   = t.type === 'deposit' ? 'positive' : 'negative';
    return `
      <tr>
        <td>${t.date}</td>
        <td><span class="badge ${badgeCls}">${t.type.charAt(0).toUpperCase() + t.type.slice(1)}</span></td>
        <td class="${amtCls}">${amtSign}$${t.amount.toFixed(2)}</td>
        <td>$${running.toFixed(2)}</td>
        <td>${esc(t.note || '—')}</td>
        <td>
          <div class="tbl-actions">
            <button class="btn btn-sm btn-danger" onclick="deleteTransaction('${t.id}')">Del</button>
          </div>
        </td>
      </tr>
    `;
  });

  // Show newest first in display (reverse), but running balance computed chronologically
  tbody.innerHTML = rows.reverse().join('');
}

/* ============================================================
   SECTION 6C — TRANSACTION MODAL
   ============================================================ */

let _txnMode = 'deposit'; // 'deposit' | 'withdrawal'

function openTxnModal(type) {
  _txnMode = type;
  const overlay = document.getElementById('txn-overlay');
  document.getElementById('txn-title').textContent = type === 'deposit' ? 'Add Deposit' : 'Add Withdrawal';
  document.getElementById('txn-type').value  = type;
  document.getElementById('txn-date').value  = todayStr();
  document.getElementById('txn-amount').value = '';
  document.getElementById('txn-note').value   = '';
  overlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('txn-amount').focus(), 50);
}

function closeTxnModal() {
  document.getElementById('txn-overlay').classList.add('hidden');
}

function saveTxn() {
  const type   = document.getElementById('txn-type').value;
  const date   = document.getElementById('txn-date').value;
  const amount = parseFloat(document.getElementById('txn-amount').value);
  const note   = document.getElementById('txn-note').value.trim();

  if (!date) { notify('Please enter a date.', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { notify('Please enter a valid amount greater than 0.', 'error'); return; }

  // Validate withdrawal doesn't exceed current balance
  if (type === 'withdrawal') {
    const liveBalance = computeLiveBalance();
    if (amount > liveBalance) {
      notify(`Withdrawal of $${amount.toFixed(2)} exceeds live balance of $${liveBalance.toFixed(2)}.`, 'error');
      return;
    }
  }

  const txn = { id: uid(), type, date, amount, note };
  state.transactions.push(txn);
  saveState();
  closeTxnModal();
  renderAccount();
  renderDashboard();
  notify(`${type.charAt(0).toUpperCase() + type.slice(1)} of $${amount.toFixed(2)} saved.`, 'success');
}

window.deleteTransaction = async function(id) {
  const ok = await confirm('Delete this transaction? This cannot be undone.');
  if (!ok) return;
  state.transactions = state.transactions.filter(t => t.id !== id);
  saveState();
  renderAccount();
  renderDashboard();
  notify('Transaction deleted.', 'success');
};

/* ============================================================
   SECTION 7 — STRATEGY BUILDER
   ============================================================ */

function renderStrategyBuilder() {
  const container = document.getElementById('strategy-builder');
  container.innerHTML = '';

  state.strategy.forEach((cat, catIdx) => {
    const catEl = document.createElement('div');
    catEl.className = 'strategy-category';
    catEl.dataset.catId = cat.id;

    catEl.innerHTML = `
      <div class="strategy-cat-header">
        <input class="strategy-cat-name" type="text" value="${esc(cat.name)}" data-cat-idx="${catIdx}" placeholder="Category name" />
        <button class="btn btn-sm btn-danger" data-del-cat="${catIdx}">✕ Remove</button>
      </div>
      <div class="strategy-rules-list" id="rules-${cat.id}">
        ${cat.rules.map((rule, rIdx) => renderRuleRow(catIdx, rIdx, rule)).join('')}
      </div>
      <div class="strategy-add-rule">
        <button class="btn btn-sm" data-add-rule="${catIdx}">+ Add Rule</button>
      </div>
    `;

    container.appendChild(catEl);
  });

  container.querySelectorAll('.strategy-cat-name').forEach(input => {
    input.addEventListener('change', e => {
      const idx = +e.target.dataset.catIdx;
      state.strategy[idx].name = e.target.value.trim();
    });
  });

  container.querySelectorAll('[data-del-cat]').forEach(btn => {
    btn.addEventListener('click', async e => {
      const idx = +e.currentTarget.dataset.delCat;
      const ok = await confirm(`Remove category "${state.strategy[idx].name}"?`);
      if (ok) { state.strategy.splice(idx, 1); renderStrategyBuilder(); }
    });
  });

  container.querySelectorAll('[data-add-rule]').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = +e.currentTarget.dataset.addRule;
      state.strategy[idx].rules.push({ id: uid(), name: 'New Rule', desc: '', weight: 5, required: false });
      renderStrategyBuilder();
    });
  });

  container.querySelectorAll('[data-rule-field]').forEach(input => {
    input.addEventListener('change', e => {
      const { catIdx, rIdx, field } = e.target.dataset;
      let val = e.target.type === 'checkbox' ? e.target.checked :
                e.target.type === 'number'   ? Number(e.target.value) :
                e.target.value;
      if (field === 'required') val = (e.target.value === 'true');
      state.strategy[+catIdx].rules[+rIdx][field] = val;
    });
  });

  container.querySelectorAll('[data-del-rule]').forEach(btn => {
    btn.addEventListener('click', e => {
      const { catIdx, rIdx } = e.currentTarget.dataset;
      state.strategy[+catIdx].rules.splice(+rIdx, 1);
      renderStrategyBuilder();
    });
  });
}

function renderRuleRow(catIdx, rIdx, rule) {
  return `
    <div class="strategy-rule">
      <input type="text"   data-rule-field data-cat-idx="${catIdx}" data-r-idx="${rIdx}" data-field="name"
             value="${esc(rule.name)}" placeholder="Rule name" />
      <input type="text"   data-rule-field data-cat-idx="${catIdx}" data-r-idx="${rIdx}" data-field="desc"
             value="${esc(rule.desc)}" placeholder="Description (optional)" />
      <input type="number" data-rule-field data-cat-idx="${catIdx}" data-r-idx="${rIdx}" data-field="weight"
             value="${rule.weight}" min="1" max="10" style="width:60px" title="Weight 1-10" />
      <select data-rule-field data-cat-idx="${catIdx}" data-r-idx="${rIdx}" data-field="required" style="width:90px">
        <option value="false" ${!rule.required ? 'selected' : ''}>Optional</option>
        <option value="true"  ${rule.required  ? 'selected' : ''}>Required</option>
      </select>
      <button class="strategy-rule-delete" data-del-rule data-cat-idx="${catIdx}" data-r-idx="${rIdx}" title="Remove rule">✕</button>
    </div>
  `;
}

/* ============================================================
   SECTION 8 — CHECKLIST
   ============================================================ */

let _checklistState = {};

function resetChecklistState() {
  _checklistState = {};
  state.strategy.forEach(cat => {
    cat.rules.forEach(r => { _checklistState[r.id] = false; });
  });
}

function renderChecklist(filterQuery = '') {
  const container = document.getElementById('checklist-container');
  container.innerHTML = '';
  const q = (filterQuery || document.getElementById('checklist-search').value || '').toLowerCase();

  state.strategy.forEach(cat => {
    const filtered = cat.rules.filter(r =>
      !q || r.name.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q)
    );
    if (filtered.length === 0) return;

    const catEl = document.createElement('div');
    catEl.className = 'checklist-category';

    const header = document.createElement('div');
    header.className = 'checklist-cat-header';
    header.innerHTML = `
      <span class="checklist-cat-name">${esc(cat.name)}</span>
      <span class="checklist-cat-toggle">▾</span>
    `;

    const items = document.createElement('div');
    items.className = 'checklist-items';

    filtered.forEach(rule => {
      const checked = !!_checklistState[rule.id];
      const itemEl = document.createElement('label');
      itemEl.className = 'checklist-item';
      itemEl.innerHTML = `
        <input type="checkbox" data-rule-id="${rule.id}" ${checked ? 'checked' : ''} />
        <span class="checklist-item-label">
          <span class="checklist-item-name">${esc(rule.name)}${rule.required ? ' <span class="checklist-item-required">*</span>' : ''}</span>
          ${rule.desc ? `<span class="checklist-item-desc">${esc(rule.desc)}</span>` : ''}
        </span>
      `;
      items.appendChild(itemEl);
    });

    catEl.appendChild(header);
    catEl.appendChild(items);
    container.appendChild(catEl);

    header.addEventListener('click', () => {
      const isOpen = items.style.display !== 'none';
      items.style.display = isOpen ? 'none' : '';
      header.querySelector('.checklist-cat-toggle').textContent = isOpen ? '▸' : '▾';
    });
  });

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', e => {
      _checklistState[e.target.dataset.ruleId] = e.target.checked;
      updateChecklistProgress();
    });
  });

  updateChecklistProgress();
}

function updateChecklistProgress() {
  const allRules = state.strategy.flatMap(c => c.rules);
  const total    = allRules.length;
  const checked  = allRules.filter(r => _checklistState[r.id]).length;
  const pct      = total > 0 ? Math.round(checked / total * 100) : 0;
  document.getElementById('checklist-progress-bar').style.width = pct + '%';
  document.getElementById('checklist-progress-text').textContent = pct + '%';
}

function getChecklistPct() {
  const allRules = state.strategy.flatMap(c => c.rules);
  const total    = allRules.length;
  const checked  = allRules.filter(r => _checklistState[r.id]).length;
  return total > 0 ? Math.round(checked / total * 100) : 0;
}

/* ============================================================
   SECTION 9 — PSYCHOLOGY SLIDERS
   ============================================================ */

function renderPsychSliders() {
  const container = document.getElementById('psychology-sliders');
  container.innerHTML = PSYCH_FIELDS.map(f => `
    <div class="psych-slider-row">
      <span class="psych-label">${f.label}</span>
      <input type="range" id="psych-${f.id}" min="1" max="10" value="5" step="1" />
      <span class="psych-val" id="psych-val-${f.id}">5</span>
    </div>
  `).join('');

  PSYCH_FIELDS.forEach(f => {
    const slider = document.getElementById(`psych-${f.id}`);
    const valEl  = document.getElementById(`psych-val-${f.id}`);
    slider.addEventListener('input', () => { valEl.textContent = slider.value; });
  });
}

function getPsychValues() {
  const out = {};
  PSYCH_FIELDS.forEach(f => {
    out[f.id] = Number(document.getElementById(`psych-${f.id}`)?.value ?? 5);
  });
  return out;
}

function setPsychValues(values) {
  PSYCH_FIELDS.forEach(f => {
    const slider = document.getElementById(`psych-${f.id}`);
    const valEl  = document.getElementById(`psych-val-${f.id}`);
    if (slider && values[f.id] !== undefined) {
      slider.value = values[f.id];
      if (valEl) valEl.textContent = values[f.id];
    }
  });
}

function computePsychScore(psych) {
  const positive = ['confidence', 'patience', 'discipline', 'focus', 'sleep', 'mood'];
  const negative = ['fear', 'greed', 'stress', 'fatigue'];
  let sum = 0;
  positive.forEach(k => { sum += (psych[k] ?? 5); });
  negative.forEach(k => { sum += (10 - (psych[k] ?? 5)); });
  return Math.round(sum / PSYCH_FIELDS.length * 10) / 10;
}

/* ============================================================
   SECTION 10 — MISTAKES / STRENGTHS
   ============================================================ */

function renderMistakes(selectedArr = []) {
  const container = document.getElementById('mistakes-checks');
  container.innerHTML = state.mistakes.map(m => `
    <label class="tag-check">
      <input type="checkbox" name="mistake" value="${esc(m)}" ${selectedArr.includes(m) ? 'checked' : ''} />
      ${esc(m)}
    </label>
  `).join('');
}

function renderStrengths(selectedArr = []) {
  const container = document.getElementById('strengths-checks');
  container.innerHTML = state.strengths.map(s => `
    <label class="tag-check">
      <input type="checkbox" name="strength" value="${esc(s)}" ${selectedArr.includes(s) ? 'checked' : ''} />
      ${esc(s)}
    </label>
  `).join('');
}

function getChecked(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
}

/* ============================================================
   SECTION 11 — TRADE FORM
   ============================================================ */

let _editingTradeId = null;

function resetTradeForm() {
  _editingTradeId = null;
  document.getElementById('trade-form-title').textContent = 'New Trade';

  const fields = ['pair','direction','date','time','session','htf','ltf',
                  'entry','sl','tp','risk','rr','outcome','pnl','duration',
                  'news','tags','screenshot','emotion-notes','notes'];
  fields.forEach(f => {
    const el = document.getElementById('f-' + f);
    if (!el) return;
    if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });

  document.getElementById('f-date').value = todayStr();
  document.getElementById('f-time').value = nowTimeStr();

  if (state.settings.defaultRisk)  document.getElementById('f-risk').value = state.settings.defaultRisk;
  if (state.settings.defaultRR)    document.getElementById('f-rr').value   = state.settings.defaultRR;

  resetChecklistState();
  renderChecklist();
  renderMistakes();
  renderStrengths();
  setPsychValues({});

  document.getElementById('grade-letter').textContent = '-';
  document.getElementById('grade-reason').textContent = '';
  document.getElementById('ai-review-text').textContent = 'Fill in the trade details and calculate grade to see a review.';
}

function loadTradeIntoForm(trade) {
  _editingTradeId = trade.id;
  document.getElementById('trade-form-title').textContent = 'Edit Trade — ' + trade.pair;

  const set = (id, val) => {
    const el = document.getElementById('f-' + id);
    if (el) el.value = val ?? '';
  };
  set('pair',       trade.pair);
  set('direction',  trade.direction);
  set('date',       trade.date);
  set('time',       trade.time);
  set('session',    trade.session);
  set('htf',        trade.htf);
  set('ltf',        trade.ltf);
  set('entry',      trade.entry);
  set('sl',         trade.sl);
  set('tp',         trade.tp);
  set('risk',       trade.risk);
  set('rr',         trade.rr);
  set('outcome',    trade.outcome);
  set('pnl',        trade.pnl);
  set('duration',   trade.duration);
  set('news',       trade.news);
  set('tags',       (trade.tags || []).join(', '));
  set('screenshot', trade.screenshot);
  set('emotion-notes', trade.emotionNotes);
  set('notes',      trade.notes);

  resetChecklistState();
  if (trade.checklist) Object.assign(_checklistState, trade.checklist);
  renderChecklist();

  setPsychValues(trade.psych || {});
  renderMistakes(trade.mistakes || []);
  renderStrengths(trade.strengths || []);

  if (trade.grade) {
    document.getElementById('grade-letter').textContent = trade.grade;
    document.getElementById('grade-reason').textContent = trade.gradeReason || '';
  }
  if (trade.aiReview) {
    document.getElementById('ai-review-text').textContent = trade.aiReview;
  }
}

function readTradeForm() {
  const g = id => document.getElementById(id)?.value ?? '';
  const psych = getPsychValues();

  return {
    id:           _editingTradeId || uid(),
    pair:         g('f-pair').toUpperCase(),
    direction:    g('f-direction'),
    date:         g('f-date'),
    time:         g('f-time'),
    session:      g('f-session'),
    htf:          g('f-htf'),
    ltf:          g('f-ltf'),
    entry:        Number(g('f-entry')),
    sl:           Number(g('f-sl')),
    tp:           Number(g('f-tp')),
    risk:         Number(g('f-risk')),
    rr:           Number(g('f-rr')),
    outcome:      g('f-outcome'),
    pnl:          Number(g('f-pnl')),
    duration:     g('f-duration'),
    news:         g('f-news'),
    tags:         g('f-tags').split(',').map(s => s.trim()).filter(Boolean),
    screenshot:   g('f-screenshot'),
    emotionNotes: g('f-emotion-notes'),
    notes:        g('f-notes'),
    psych,
    psychScore:   computePsychScore(psych),
    mistakes:     getChecked('mistake'),
    strengths:    getChecked('strength'),
    checklist:    { ..._checklistState },
    checklistPct: getChecklistPct(),
  };
}

/* ============================================================
   SECTION 12 — GRADER
   ============================================================ */

const GRADE_SCALE = [
  { min: 97, grade: 'A+' },
  { min: 93, grade: 'A'  },
  { min: 90, grade: 'A-' },
  { min: 87, grade: 'B+' },
  { min: 83, grade: 'B'  },
  { min: 80, grade: 'B-' },
  { min: 70, grade: 'C'  },
  { min: 60, grade: 'D'  },
  { min: 0,  grade: 'F'  },
];

function gradeToNum(g) {
  const map = { 'A+':98,'A':95,'A-':91,'B+':88,'B':85,'B-':81,'C':75,'D':65,'F':50 };
  return map[g] ?? 0;
}

function numToGrade(n) {
  for (const row of GRADE_SCALE) { if (n >= row.min) return row.grade; }
  return 'F';
}

function calculateGrade(trade) {
  const reasons = [];
  let score = 0;
  let maxScore = 0;

  const clPct = trade.checklistPct ?? getChecklistPct();
  const clScore = Math.round(clPct * 0.40);
  score    += clScore;
  maxScore += 40;
  reasons.push(`Checklist: ${clPct}% complete (${clScore}/40 pts)`);

  const allRules  = state.strategy.flatMap(c => c.rules);
  const reqRules  = allRules.filter(r => r.required);
  const reqMissed = reqRules.filter(r => !trade.checklist?.[r.id]);
  if (reqMissed.length > 0) {
    const penalty = reqMissed.length * 5;
    score -= penalty;
    reasons.push(`${reqMissed.length} required rule(s) missed: -${penalty} pts`);
  }

  const ps = trade.psychScore ?? computePsychScore(trade.psych ?? {});
  const psScore = Math.round(ps * 2);
  score    += psScore;
  maxScore += 20;
  reasons.push(`Psychology score: ${ps.toFixed(1)}/10 (${psScore}/20 pts)`);

  const rr = trade.rr ?? 0;
  let rrScore = 0;
  if      (rr >= 4)   rrScore = 20;
  else if (rr >= 3)   rrScore = 17;
  else if (rr >= 2)   rrScore = 14;
  else if (rr >= 1.5) rrScore = 10;
  else if (rr >= 1)   rrScore = 6;
  score    += rrScore;
  maxScore += 20;
  reasons.push(`RR: ${rr.toFixed(2)} (${rrScore}/20 pts)`);

  const mistakeCount = (trade.mistakes ?? []).length;
  if (mistakeCount > 0) {
    const penalty = Math.min(15, mistakeCount * 3);
    score -= penalty;
    reasons.push(`${mistakeCount} mistake(s): -${penalty} pts`);
  } else {
    reasons.push('No mistakes: full marks');
  }

  const strengthCount = (trade.strengths ?? []).length;
  if (strengthCount > 0) {
    const bonus = Math.min(10, strengthCount * 2);
    score    += bonus;
    maxScore += 10;
    reasons.push(`${strengthCount} strength(s) noted: +${bonus} pts`);
  }

  const rawPct = Math.max(0, Math.min(100, score));
  const grade  = numToGrade(rawPct);
  return { grade, score: rawPct, reasons };
}

function generateAIReview(trade, gradeResult) {
  const { grade, score } = gradeResult;
  const pair     = trade.pair     || 'Unknown Pair';
  const clPct    = trade.checklistPct ?? 0;
  const outcome  = trade.outcome  || 'pending';
  const rr       = trade.rr       || 0;
  const mistakes  = trade.mistakes ?? [];
  const strengths = trade.strengths ?? [];

  let text = `You completed ${clPct}% of your strategy checklist on this ${pair} ${trade.direction || ''} trade. `;

  if (clPct >= 90) text += 'Your plan adherence was excellent. ';
  else if (clPct >= 70) text += 'Your plan adherence was acceptable but there is room to improve. ';
  else text += 'A significant portion of your strategy was skipped — this requires attention. ';

  if (trade.psychScore >= 7) text += 'Your mental state was solid going into this trade. ';
  else if (trade.psychScore >= 5) text += 'Your mental state was average. ';
  else text += 'Poor psychology may have influenced your decision-making. ';

  if (rr >= 2) text += `Risk-reward of ${rr.toFixed(2)} was within acceptable parameters. `;
  else text += `Risk-reward of ${rr.toFixed(2)} was below the recommended minimum. `;

  if (mistakes.length === 0) {
    text += 'No execution mistakes were recorded, which reflects strong discipline. ';
  } else {
    text += `The following mistakes were noted: ${mistakes.join(', ')}. Work to eliminate these in future trades. `;
  }

  if (strengths.length > 0) {
    text += `Positive behaviours included: ${strengths.join(', ')}. `;
  }

  if (outcome === 'WIN') text += 'The trade closed as a winner. ';
  else if (outcome === 'LOSS') text += 'The trade closed as a loss. Remember: following the process matters more than the outcome. ';
  else if (outcome === 'BE') text += 'The trade closed at breakeven. ';

  text += `Overall this qualifies as a ${grade} trade with a process score of ${score}/100.`;
  return text;
}

/* ============================================================
   SECTION 13 — TRADE JOURNAL
   ============================================================ */

function renderJournal() {
  const search  = document.getElementById('journal-search').value.toLowerCase();
  const outcome = document.getElementById('journal-filter-outcome').value;
  const pair    = document.getElementById('journal-filter-pair').value;

  let trades = [...state.trades].sort((a, b) => {
    const da = new Date(a.date + 'T' + (a.time || '00:00'));
    const db = new Date(b.date + 'T' + (b.time || '00:00'));
    return db - da;
  });

  const pairs = [...new Set(state.trades.map(t => t.pair).filter(Boolean))].sort();
  const pairSel = document.getElementById('journal-filter-pair');
  const curPair = pairSel.value;
  pairSel.innerHTML = '<option value="">All Pairs</option>' + pairs.map(p => `<option value="${p}" ${p === curPair ? 'selected' : ''}>${p}</option>`).join('');

  if (search)  trades = trades.filter(t => JSON.stringify(t).toLowerCase().includes(search));
  if (outcome) trades = trades.filter(t => t.outcome === outcome);
  if (pair)    trades = trades.filter(t => t.pair === pair);

  const tbody = document.getElementById('journal-tbody');
  const empty = document.getElementById('journal-empty');

  if (trades.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = trades.map(t => {
    const badgeCls = t.outcome === 'WIN' ? 'badge-win' : t.outcome === 'LOSS' ? 'badge-loss' : t.outcome === 'BE' ? 'badge-be' : 'badge-pending';
    const pnlStr   = t.pnl ? (t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`) : '-';
    const pnlCls   = t.pnl > 0 ? 'positive' : t.pnl < 0 ? 'negative' : '';
    return `
      <tr>
        <td>${t.date || '-'} ${t.time || ''}</td>
        <td>${esc(t.pair || '-')}</td>
        <td>${esc(t.direction || '-')}</td>
        <td><span class="badge ${badgeCls}">${t.outcome || 'Pending'}</span></td>
        <td class="${pnlCls}">${pnlStr}</td>
        <td>${t.rr ? t.rr.toFixed(2) : '-'}</td>
        <td>${t.grade || '-'}</td>
        <td>
          <div class="tbl-actions">
            <button class="btn btn-sm" onclick="viewTrade('${t.id}')">View</button>
            <button class="btn btn-sm btn-danger" onclick="deleteTrade('${t.id}')">Del</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.viewTrade = function(id) {
  const trade = state.trades.find(t => t.id === id);
  if (!trade) return;
  loadTradeIntoForm(trade);
  switchTab('new-trade');
};

window.deleteTrade = async function(id) {
  const ok = await confirm('Delete this trade? This cannot be undone.');
  if (!ok) return;
  state.trades = state.trades.filter(t => t.id !== id);
  saveState();
  renderJournal();
  notify('Trade deleted.', 'success');
};

/* ============================================================
   SECTION 14 — STATISTICS
   ============================================================ */

function renderStatistics() {
  const trades  = state.trades.filter(t => t.outcome);
  const content = document.getElementById('stats-content');

  if (trades.length === 0) {
    content.innerHTML = '<p class="text-muted">No completed trades yet.</p>';
    return;
  }

  content.innerHTML = '';
  content.appendChild(statsGroupTable('By Pair',        groupByKey(trades, 'pair')));
  content.appendChild(statsGroupTable('By Session',     groupByKey(trades, 'session')));
  content.appendChild(statsGroupTable('By Day of Week', groupByFn(trades, t => {
    const d = new Date(t.date);
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  })));
  content.appendChild(statsGroupTable('By HTF Bias',    groupByKey(trades, 'htf')));
  content.appendChild(statsGroupTable('By Grade',       groupByKey(trades, 'grade')));
  content.appendChild(statsGroupTable('By Outcome',     groupByKey(trades, 'outcome')));
}

function groupByKey(trades, key) {
  const groups = {};
  trades.forEach(t => {
    const k = t[key] || 'Unknown';
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  });
  return groups;
}

function groupByFn(trades, fn) {
  const groups = {};
  trades.forEach(t => {
    const k = fn(t) || 'Unknown';
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  });
  return groups;
}

function statsGroupTable(title, groups) {
  const el = document.createElement('div');
  el.className = 'stats-group';

  let rows = '';
  Object.entries(groups).forEach(([key, arr]) => {
    const wins     = arr.filter(t => t.outcome === 'WIN').length;
    const losses   = arr.filter(t => t.outcome === 'LOSS').length;
    const total    = arr.length;
    const wr       = total > 0 ? Math.round(wins / total * 100) : 0;
    const totalPnl = arr.reduce((a, t) => a + (t.pnl || 0), 0);
    const avgRR    = arr.reduce((a, t) => a + (t.rr || 0), 0) / total;
    const pnlCls   = totalPnl >= 0 ? 'positive' : 'negative';
    rows += `
      <tr>
        <td>${esc(key)}</td>
        <td>${total}</td>
        <td>${wins}W / ${losses}L</td>
        <td>${wr}%</td>
        <td class="${pnlCls}">${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</td>
        <td>${avgRR.toFixed(2)}</td>
      </tr>
    `;
  });

  el.innerHTML = `
    <h2 class="section-title">${title}</h2>
    <table class="stats-table">
      <thead><tr><th>Group</th><th>Trades</th><th>W/L</th><th>Win Rate</th><th>Total P&L</th><th>Avg RR</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  return el;
}

/* ============================================================
   SECTION 15 — IMPORT / EXPORT
   ============================================================ */

function exportJSON() {
  const data = {
    exportedAt:   new Date().toISOString(),
    version:      2,
    strategy:     state.strategy,
    trades:       state.trades,
    transactions: state.transactions,
    mistakes:     state.mistakes,
    strengths:    state.strengths,
  };
  downloadFile(JSON.stringify(data, null, 2), `trading-os-export-${todayStr()}.json`);
  notify('Trades exported as JSON.', 'success');
}

function exportCSV() {
  const cols = ['id','date','time','pair','direction','session','htf','ltf',
                'entry','sl','tp','risk','rr','outcome','pnl','duration',
                'news','tags','grade','checklistPct','psychScore','mistakes','strengths','notes'];
  const header = cols.join(',');
  const rows = state.trades.map(t => cols.map(c => {
    let v = t[c];
    if (Array.isArray(v)) v = v.join('; ');
    if (v === undefined || v === null) v = '';
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  downloadFile([header, ...rows].join('\n'), `trading-os-trades-${todayStr()}.csv`, 'text/csv');
  notify('Trades exported as CSV.', 'success');
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.trades || !Array.isArray(data.trades)) {
        notify('Invalid file format.', 'error');
        return;
      }
      const ok = await confirm(`Import ${data.trades.length} trade(s)? Existing trades with the same ID will be overwritten.`);
      if (!ok) return;

      data.trades.forEach(incoming => {
        const idx = state.trades.findIndex(t => t.id === incoming.id);
        if (idx >= 0) state.trades[idx] = incoming;
        else          state.trades.push(incoming);
      });

      // Import transactions if present (v2 export)
      if (data.transactions && Array.isArray(data.transactions)) {
        data.transactions.forEach(incoming => {
          const idx = state.transactions.findIndex(t => t.id === incoming.id);
          if (idx >= 0) state.transactions[idx] = incoming;
          else          state.transactions.push(incoming);
        });
      }

      if (data.strategy) {
        const importStrat = await confirm('Import strategy from file too?');
        if (importStrat) state.strategy = data.strategy;
      }

      saveState();
      renderJournal();
      notify(`Imported ${data.trades.length} trade(s) successfully.`, 'success');
    } catch (err) {
      notify('Failed to import: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function backupAll() {
  downloadFile(JSON.stringify(state, null, 2), `trading-os-FULL-BACKUP-${todayStr()}.json`);
  notify('Full backup downloaded.', 'success');
}

/* ============================================================
   SECTION 16 — SETTINGS
   ============================================================ */

function loadSettingsForm() {
  const s = state.settings;
  document.getElementById('s-starting-balance').value = s.startingBalance;
  document.getElementById('s-current-balance').value  = s.currentBalance;
  document.getElementById('s-default-risk').value     = s.defaultRisk;
  document.getElementById('s-default-rr').value       = s.defaultRR;
  document.getElementById('s-currency').value         = s.currency;
  document.getElementById('s-timezone').value         = s.timezone;
  document.getElementById('s-theme').value            = s.theme;
  document.getElementById('s-accent-color').value     = s.accentColor;
}

function saveSettings() {
  state.settings.startingBalance = Number(document.getElementById('s-starting-balance').value);
  state.settings.currentBalance  = Number(document.getElementById('s-current-balance').value);
  state.settings.defaultRisk     = Number(document.getElementById('s-default-risk').value);
  state.settings.defaultRR       = Number(document.getElementById('s-default-rr').value);
  state.settings.currency        = document.getElementById('s-currency').value.trim();
  state.settings.timezone        = document.getElementById('s-timezone').value.trim();
  state.settings.theme           = document.getElementById('s-theme').value;
  state.settings.accentColor     = document.getElementById('s-accent-color').value;
  saveState();
  applyTheme();
  notify('Settings saved.', 'success');
}

/* ============================================================
   SECTION 17 — KEYBOARD SHORTCUTS
   ============================================================ */

function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 's': e.preventDefault(); handleSave();    break;
        case 'n': e.preventDefault(); switchTab('new-trade'); break;
        case 'e': e.preventDefault(); exportJSON();    break;
        case 'f': e.preventDefault();
          switchTab('journal');
          setTimeout(() => document.getElementById('journal-search').focus(), 100);
          break;
      }
    }
    // ESC closes modals
    if (e.key === 'Escape') {
      closeTxnModal();
    }
  });
}

function handleSave() {
  const activeTab = document.querySelector('.tab-section.active')?.id;
  if (activeTab === 'tab-new-trade') saveTrade();
  else if (activeTab === 'tab-settings') saveSettings();
  else if (activeTab === 'tab-strategy') saveStrategy();
}

/* ============================================================
   SECTION 18 — SAVE TRADE
   ============================================================ */

function saveTrade() {
  const trade = readTradeForm();

  if (!trade.pair || !trade.date) {
    notify('Pair and Date are required.', 'error');
    return;
  }

  const gradeResult = calculateGrade(trade);
  trade.grade       = gradeResult.grade;
  trade.gradeReason = gradeResult.reasons.join('\n');
  trade.aiReview    = generateAIReview(trade, gradeResult);
  trade.checklistPct = getChecklistPct();

  document.getElementById('grade-letter').textContent = trade.grade;
  document.getElementById('grade-reason').textContent = trade.gradeReason;
  document.getElementById('ai-review-text').textContent = trade.aiReview;

  if (_editingTradeId) {
    const idx = state.trades.findIndex(t => t.id === _editingTradeId);
    if (idx >= 0) state.trades[idx] = trade;
    else          state.trades.push(trade);
  } else {
    state.trades.push(trade);
    _editingTradeId = trade.id;
  }

  saveState();
  notify('Trade saved! Grade: ' + trade.grade, 'success');
  document.getElementById('trade-form-title').textContent = 'Edit Trade — ' + trade.pair;
}

function saveStrategy() {
  saveState();
  renderStrategyBuilder();
  notify('Strategy saved.', 'success');
}

/* ============================================================
   SECTION 19 — UTILITY: HTML ESCAPE
   ============================================================ */

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================================
   SECTION 20 — INIT
   ============================================================ */

function init() {
  loadState();
  applyTheme();
  initNav();
  initKeyboardShortcuts();

  renderDashboard();
  renderStrategyBuilder();
  renderPsychSliders();
  resetTradeForm();
  loadSettingsForm();

  // Sidebar quick button
  document.getElementById('btn-new-trade-quick').addEventListener('click', () => {
    _editingTradeId = null;
    resetTradeForm();
    switchTab('new-trade');
  });

  // Strategy Builder
  document.getElementById('btn-add-category').addEventListener('click', () => {
    state.strategy.push({ id: uid(), name: 'New Category', rules: [] });
    renderStrategyBuilder();
  });
  document.getElementById('btn-save-strategy').addEventListener('click', saveStrategy);

  // Checklist search
  document.getElementById('checklist-search').addEventListener('input', e => {
    renderChecklist(e.target.value);
  });

  // Mistakes / Strengths custom
  document.getElementById('btn-add-mistake').addEventListener('click', () => {
    const inp = document.getElementById('new-mistake-input');
    const val = inp.value.trim();
    if (!val) return;
    if (!state.mistakes.includes(val)) state.mistakes.push(val);
    saveState();
    inp.value = '';
    renderMistakes(getChecked('mistake'));
  });
  document.getElementById('btn-add-strength').addEventListener('click', () => {
    const inp = document.getElementById('new-strength-input');
    const val = inp.value.trim();
    if (!val) return;
    if (!state.strengths.includes(val)) state.strengths.push(val);
    saveState();
    inp.value = '';
    renderStrengths(getChecked('strength'));
  });
  ['new-mistake-input', 'new-strength-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-add-' + id.replace('new-', '').replace('-input', '')).click();
    });
  });

  // Trade form
  document.getElementById('btn-save-trade').addEventListener('click', saveTrade);
  document.getElementById('btn-reset-form').addEventListener('click', async () => {
    const ok = await confirm('Reset form? Unsaved changes will be lost.');
    if (ok) { _editingTradeId = null; resetTradeForm(); }
  });
  document.getElementById('btn-calc-grade').addEventListener('click', () => {
    const trade = readTradeForm();
    const result = calculateGrade(trade);
    document.getElementById('grade-letter').textContent = result.grade;
    document.getElementById('grade-reason').textContent = result.reasons.join('\n');
    document.getElementById('ai-review-text').textContent = generateAIReview(trade, result);
  });

  // Journal filters
  document.getElementById('journal-search').addEventListener('input', renderJournal);
  document.getElementById('journal-filter-outcome').addEventListener('change', renderJournal);
  document.getElementById('journal-filter-pair').addEventListener('change', renderJournal);

  // Import / Export
  document.getElementById('btn-export-json').addEventListener('click', exportJSON);
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-import-json').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importJSON(file);
    e.target.value = '';
  });

  // Account tab: deposit / withdrawal buttons
  document.getElementById('btn-add-deposit').addEventListener('click', () => openTxnModal('deposit'));
  document.getElementById('btn-add-withdrawal').addEventListener('click', () => openTxnModal('withdrawal'));

  // Transaction modal: type select → update title
  document.getElementById('txn-type').addEventListener('change', e => {
    document.getElementById('txn-title').textContent =
      e.target.value === 'deposit' ? 'Add Deposit' : 'Add Withdrawal';
  });
  document.getElementById('txn-save').addEventListener('click', saveTxn);
  document.getElementById('txn-cancel').addEventListener('click', closeTxnModal);
  document.getElementById('txn-amount').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveTxn();
  });

  // Settings
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-backup').addEventListener('click', backupAll);
  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    const ok = await confirm('Clear ALL data? This cannot be undone.');
    if (!ok) return;
    state = {
      strategy:     DEFAULT_STRATEGY,
      trades:       [],
      transactions: [],
      settings:     { ...DEFAULT_SETTINGS },
      mistakes:     [...DEFAULT_MISTAKES],
      strengths:    [...DEFAULT_STRENGTHS],
    };
    saveState();
    applyTheme();
    renderDashboard();
    renderStrategyBuilder();
    resetTradeForm();
    loadSettingsForm();
    notify('All data cleared.', 'success');
  });

  // Redraw equity curve on resize
  window.addEventListener('resize', () => {
    const accountTab = document.getElementById('tab-account');
    if (accountTab && accountTab.classList.contains('active')) {
      renderEquityCurve();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
