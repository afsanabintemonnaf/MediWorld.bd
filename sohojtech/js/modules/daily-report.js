'use strict';

let dailyReportRequest = 0;
let dailyReportRows = [];

function renderDailyReportModule() {
  const c = document.getElementById('daily-report-content');
  if (!c) return;
  APP_STATE.reportFrom = APP_STATE.reportFrom || todayStr();
  APP_STATE.reportTo = APP_STATE.reportTo || todayStr();
  APP_STATE.reportPeriod = APP_STATE.reportPeriod || 'day';
  APP_STATE.reportScope = APP_STATE.reportScope || (APP_STATE.isOwner ? 'consolidated' : APP_STATE.activeBranchId);
  APP_STATE.reportView = APP_STATE.reportView || 'summary';
  c.innerHTML = `
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-4">
      <div class="report-controls flex flex-wrap gap-3 items-end">
        <button onclick="setReportPeriod('day')" class="btn btn-sm report-period">দিন</button>
        <button onclick="setReportPeriod('week')" class="btn btn-sm report-period">সপ্তাহ</button>
        <button onclick="setReportPeriod('month')" class="btn btn-sm report-period">মাস</button>
        <button onclick="setReportPeriod('custom')" class="btn btn-sm report-period">Custom</button>
        ${APP_STATE.isOwner ? `<select id="report-scope" onchange="onReportScopeChange(this.value)" class="px-3 py-2 border rounded-lg text-sm"><option value="consolidated" ${APP_STATE.reportScope === 'consolidated' ? 'selected' : ''}>সব Branch — Consolidated</option>${APP_STATE.branches.map(b => `<option value="${esc(b.id)}" ${APP_STATE.reportScope === b.id ? 'selected' : ''}>${esc(b.name)}${b.active === false ? ' — নিষ্ক্রিয়' : ''}</option>`).join('')}</select>` : ''}
        <div><label class="block text-[10px] text-slate-400">থেকে</label><input type="date" id="report-from" value="${APP_STATE.reportFrom}" onchange="onReportCustomChange()" class="px-2 py-1.5 border rounded-lg text-sm"/></div>
        <div><label class="block text-[10px] text-slate-400">পর্যন্ত</label><input type="date" id="report-to" value="${APP_STATE.reportTo}" onchange="onReportCustomChange()" class="px-2 py-1.5 border rounded-lg text-sm"/></div>
        <button id="report-view-summary" onclick="setReportView('summary')" class="btn btn-sm">সারসংক্ষেপ</button>
        <button id="report-view-detailed" onclick="setReportView('detailed')" class="btn btn-sm">বিস্তারিত</button>
        <button onclick="printDailyReport('summary')" class="btn btn-primary btn-sm"><i class="fa-solid fa-print mr-1"></i>সারসংক্ষেপ প্রিন্ট</button>
        <button onclick="printDailyReport('detailed')" class="btn btn-secondary btn-sm"><i class="fa-solid fa-print mr-1"></i>বিস্তারিত প্রিন্ট</button>
        <button onclick="downloadDailyReport('summary')" class="btn btn-secondary btn-sm"><i class="fa-solid fa-download mr-1"></i>Summary CSV</button>
        <button onclick="downloadDailyReport('detailed')" class="btn btn-secondary btn-sm"><i class="fa-solid fa-download mr-1"></i>Detailed CSV</button>
      </div>
    </div>
    <div id="daily-report-summary"></div>
    <div id="daily-report-table" class="mt-4"></div>`;
  setReportPeriod(APP_STATE.reportPeriod, true);
}

function setReportPeriod(period, preserve) {
  APP_STATE.reportPeriod = period;
  const today = todayStr();
  if (period === 'day') { APP_STATE.reportFrom = today; APP_STATE.reportTo = today; }
  if (period === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    APP_STATE.reportFrom = d.toISOString().split('T')[0];
    APP_STATE.reportTo = today;
  }
  if (period === 'month') {
    const d = new Date();
    APP_STATE.reportFrom = d.toISOString().slice(0, 7) + '-01';
    APP_STATE.reportTo = today;
  }
  const from = document.getElementById('report-from');
  const to = document.getElementById('report-to');
  if (from) from.value = APP_STATE.reportFrom;
  if (to) to.value = APP_STATE.reportTo;
  document.querySelectorAll('.report-period').forEach(b => b.className = 'btn btn-sm btn-secondary');
  renderDailyReportData();
}

function onReportCustomChange() {
  APP_STATE.reportFrom = document.getElementById('report-from').value || todayStr();
  APP_STATE.reportTo = document.getElementById('report-to').value || APP_STATE.reportFrom;
  renderDailyReportData();
}

function setReportView(view) {
  APP_STATE.reportView = view;
  ['summary', 'detailed'].forEach(v => {
    const b = document.getElementById('report-view-' + v);
    if (b) b.className = 'btn btn-sm ' + (v === view ? 'btn-primary' : 'btn-secondary');
  });
  renderDailyReportData();
}

function onReportScopeChange(scope) {
  APP_STATE.reportScope = scope;
  renderDailyReportData();
}

async function renderDailyReportData() {
  const requestId = ++dailyReportRequest;
  const scope = document.getElementById('report-scope')?.value || APP_STATE.activeBranchId;
  const branchIds = scope === 'consolidated'
    ? APP_STATE.branches.map(b => b.id)
    : [scope];
  const rows = [];
  const summary = document.getElementById('daily-report-summary');
  const table = document.getElementById('daily-report-table');
  if (!summary || !table) return;
  summary.innerHTML = '<div class="text-sm text-slate-400 py-3">রিপোর্ট লোড হচ্ছে...</div>';
  try {
    const collections = ['sales', 'purchases', 'returns', 'expenses', 'incomes', 'payments', 'supplierPayments'];
    const reads = branchIds.filter(Boolean).flatMap(branchId =>
      collections.map(async name => {
        const snap = await fbDb.collection('branches').doc(branchId).collection(name)
          .where('date', '>=', APP_STATE.reportFrom)
          .where('date', '<=', APP_STATE.reportTo)
          .get();
        return snap.docs.map(d => ({ ...d.data(), id: d.id, branchId, type: name }));
      })
    );
    const transferRead = loadReportTransfers(branchIds);
    const results = await Promise.all([...reads, transferRead]);
    if (requestId !== dailyReportRequest) return;
    results.slice(0, reads.length).flat().forEach(row => rows.push(row));
    rows.push(...results[results.length - 1]);
  } catch (err) {
    if (requestId !== dailyReportRequest) return;
    console.error('Daily report load failed:', err);
    summary.innerHTML = `<div class="text-sm text-red-600 py-3">রিপোর্ট লোড ব্যর্থ: ${esc(err.message)}</div>`;
    table.innerHTML = '';
    return;
  }

  const normalized = rows.map(r => normalizeReportRow(r))
    .filter(r => r.date >= APP_STATE.reportFrom && r.date <= APP_STATE.reportTo);
  normalized.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  dailyReportRows = normalized;
  const cashIn = normalized.filter(r => r.flow === 'in').reduce((a, r) => a + r.amount, 0);
  const cashOut = normalized.filter(r => r.flow === 'out').reduce((a, r) => a + r.amount, 0);
  summary.innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${summaryCard('লেনদেন', String(normalized.length), 'fa-list')}
      ${summaryCard('Cash-in', round2(cashIn), 'fa-arrow-down')}
      ${summaryCard('Cash-out', round2(cashOut), 'fa-arrow-up')}
      ${summaryCard('Net movement', round2(cashIn - cashOut), 'fa-scale-balanced')}
    </div>`;
  if (APP_STATE.reportView === 'summary') {
    const categoryMap = {};
    normalized.forEach(r => { if (r.flow !== 'none') categoryMap[r.category] = (categoryMap[r.category] || 0) + (r.flow === 'out' ? -r.amount : r.amount); });
    table.innerHTML = normalized.length ? `
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-x-auto">
      <table class="report-summary-table w-full text-sm"><thead class="bg-slate-50 text-[11px] uppercase"><tr><th class="p-3 text-left">ক্যাটাগরি</th><th class="p-3 text-right">নেট পরিমাণ</th></tr></thead>
      <tbody>${Object.entries(categoryMap).map(([category, amount]) => `<tr class="border-t"><td class="p-3">${esc(category)}</td><td class="p-3 text-right font-mono ${amount < 0 ? 'text-red-600' : 'text-emerald-600'}">${amount < 0 ? '−' : ''}৳${fmt(Math.abs(amount))}</td></tr>`).join('')}</tbody></table>
    </div>` : '<div class="bg-white dark:bg-slate-800 rounded-xl p-8 text-center text-slate-400">এই পরিসরে কোনো লেনদেন পাওয়া যায়নি।</div>';
  } else {
    table.innerHTML = normalized.length ? `
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-x-auto">
      <table class="report-detailed-table w-full text-sm"><thead class="bg-slate-50 text-[11px] uppercase"><tr><th class="p-3 text-left">তারিখ</th><th class="p-3 text-left">ধরন</th><th class="p-3 text-left">বিবরণ</th><th class="p-3 text-right">পরিমাণ</th><th class="p-3 text-left">Branch</th></tr></thead>
      <tbody>${normalized.map(r => `<tr class="border-t"><td class="p-3 text-xs">${esc(r.date)}</td><td class="p-3">${esc(r.category)}</td><td class="p-3 text-xs">${esc(r.description)}</td><td class="p-3 text-right font-mono ${r.flow === 'out' ? 'text-red-600' : r.flow === 'in' ? 'text-emerald-600' : ''}">${r.flow === 'out' ? '-' : r.flow === 'in' ? '+' : ''}৳${fmt(r.amount)}</td><td class="p-3 text-xs">${esc(branchName(r.branchId))}</td></tr>`).join('')}</tbody></table>
    </div>` : '<div class="bg-white dark:bg-slate-800 rounded-xl p-8 text-center text-slate-400">এই পরিসরে কোনো লেনদেন পাওয়া যায়নি।</div>';
}
}

async function loadReportTransfers(branchIds) {
  const ids = Array.from(new Set(branchIds.filter(Boolean)));
  const transfers = new Map();
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const snapshots = await Promise.all(['sourceBranchId', 'targetBranchId'].map(field =>
      fbDb.collection('transfers').where(field, 'in', batch).get()
    ));
    snapshots.flatMap(snap => snap.docs).forEach(doc => {
      if (!transfers.has(doc.id)) {
        transfers.set(doc.id, { id: doc.id, type: 'transfers', ...doc.data() });
      }
    });
  }
  return Array.from(transfers.values()).filter(transfer =>
    ids.includes(transfer.sourceBranchId) || ids.includes(transfer.targetBranchId)
  );
}

function normalizeReportRow(r) {
  if (r.type === 'sales') return { date: r.date, category: 'POS বিক্রয়', description: (r.invoiceNo || '') + ' — ' + (r.customerName || ''), amount: r.cashPaid || 0, flow: r.cashPaid ? 'in' : 'none', branchId: r.branchId };
  if (r.type === 'purchases') return { date: r.date, category: 'ক্রয়', description: (r.purchaseId || '') + ' — ' + (r.supplierName || ''), amount: r.paymentType === 'নগদ' ? r.totalCost || 0 : 0, flow: r.paymentType === 'নগদ' ? 'out' : 'none', branchId: r.branchId };
  if (r.type === 'returns') return { date: r.date, category: r.returnType === 'supplier' ? 'Purchase return' : 'Customer return', description: r.refId || '', amount: r.amount || 0, flow: r.refundMethod === 'নগদ ফেরত' ? (r.returnType === 'supplier' ? 'in' : 'out') : 'none', branchId: r.branchId };
  if (r.type === 'expenses') return { date: r.date, category: 'Operating expense', description: r.description || r.category, amount: r.amount || 0, flow: 'out', branchId: r.branchId };
  if (r.type === 'incomes') return { date: r.date, category: r.category || r.source || 'অন্যান্য আয়', description: r.note || r.reference || r.description || '', amount: r.amount || 0, flow: 'in', branchId: r.branchId };
  if (r.type === 'payments') return { date: r.date, category: 'Customer due collection', description: r.customerName || r.customerId, amount: r.amount || 0, flow: 'in', branchId: r.branchId };
  if (r.type === 'supplierPayments') return { date: r.date, category: 'Supplier payment', description: r.supplierName || r.supplierId, amount: r.amount || 0, flow: 'out', branchId: r.branchId };
  if (r.type === 'transfers') {
    const timestamp = r.completedAt || r.createdAt;
    const date = r.date || (timestamp?.toDate ? timestamp.toDate().toISOString().slice(0, 10) : '');
    return { date, category: 'Inter-branch transfer', description: (r.sourceBranchName || r.sourceBranchId || '') + ' → ' + (r.targetBranchName || r.targetBranchId || ''), amount: r.financialAmount || 0, flow: 'none', branchId: r.sourceBranchId };
  }
  return { date: r.date || '', category: r.type, description: r.description || '', amount: r.amount || 0, flow: 'none', branchId: r.branchId };
}

function summaryCard(label, value, icon) {
  return `<div class="bg-white dark:bg-slate-800 border rounded-xl p-4"><div class="text-xs text-slate-400">${esc(label)}</div><div class="text-lg font-bold font-mono mt-1">${typeof value === 'number' ? '৳' + fmt(value) : esc(String(value))}</div></div>`;
}

function branchName(branchId) {
  return APP_STATE.branches.find(b => b.id === branchId)?.name || branchId || '—';
}

function printDailyReport(mode = 'summary') {
  const rows = dailyReportRows || [];
  const summaryHtml = `
    <table><thead><tr><th>ক্যাটাগরি</th><th>নেট পরিমাণ</th></tr></thead><tbody>${groupDailySummary(rows).map(x => `<tr><td>${esc(x.category)}</td><td>${esc('৳'+fmt(x.amount))}</td></tr>`).join('')}</tbody></table>`;
  const detailedHtml = `
    <table><thead><tr><th>তারিখ</th><th>ধরন</th><th>বিবরণ</th><th>পরিমাণ</th><th>Branch</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.category)}</td><td>${esc(r.description)}</td><td>${esc((r.flow === 'out' ? '-' : r.flow === 'in' ? '+' : '') + '৳' + fmt(r.amount))}</td><td>${esc(branchName(r.branchId))}</td></tr>`).join('')}</tbody></table>`;
  const body = mode === 'detailed' ? detailedHtml : summaryHtml;
  const w = window.open('', '_blank');
  w.document.write(`<html><head><meta charset="utf-8"><title>${esc(APP_CONFIG.PLATFORM_NAME)} — দৈনিক রিপোর্ট</title><style>body{font-family:'Noto Sans Bengali',sans-serif;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}</style></head><body><h2>${esc(APP_CONFIG.PLATFORM_NAME)} — দৈনিক/পরিসর রিপোর্ট (${mode === 'detailed' ? 'বিস্তারিত' : 'সারসংক্ষেপ'})</h2><p>${esc(APP_STATE.reportFrom)} থেকে ${esc(APP_STATE.reportTo)}</p>${body}</body></html>`);
  w.document.close();
  w.print();
}

function groupDailySummary(rows) {
  const map = {};
  rows.forEach(r => { if (r.flow !== 'none') map[r.category] = (map[r.category] || 0) + (r.flow === 'out' ? -r.amount : r.amount); });
  return Object.entries(map).map(([category, amount]) => ({ category, amount }));
}

function downloadDailyReport(mode = 'summary') {
  const rows = dailyReportRows || [];
  const data = mode === 'detailed'
    ? [['তারিখ','ধরন','বিবরণ','প্রবাহ','পরিমাণ','Branch'], ...rows.map(r => [r.date,r.category,r.description,r.flow,r.amount,branchName(r.branchId)])]
    : [['ক্যাটাগরি','নেট পরিমাণ'], ...groupDailySummary(rows).map(r => [r.category,r.amount])];
  const csv = '\ufeff' + data.map(row => row.map(v => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sohojtech-daily-${mode}-${APP_STATE.reportFrom}-${APP_STATE.reportTo}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('UTF-8 CSV ডাউনলোড হয়েছে।', 's');
}
