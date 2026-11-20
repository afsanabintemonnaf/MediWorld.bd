'use strict';

// ════════════════════════════════════════════════════════════
// ACCOUNTS / LEDGER MODULE
// এটা একটা সরল লেনদেন-লগ, rigorous P&L নয় (সেটা Dashboard-এ)।
// 'তথ্য' ব্যাজের এন্ট্রি (বাকি ক্রয়, পাওনা-সমন্বয় রিটার্ন) নন-ক্যাশ —
// টোটালে যোগ হয় না, শুধু দৃশ্যমানতার জন্য দেখানো হয়।
// ════════════════════════════════════════════════════════════

let accountingSummaryRequest = 0;
let ledgerTableRequest = 0;

function renderAccountsModule() {
  const c = document.getElementById('accounts-content');
  if (!c) return;
  APP_STATE.ledgerDate = APP_STATE.ledgerDate || todayStr();
  APP_STATE.ledgerTab = APP_STATE.ledgerTab || 'all';
  if (APP_STATE.isOwner && APP_STATE.accountingScope === 'branch') APP_STATE.accountingScope = 'consolidated';
  APP_STATE.showExpenseForm = false;

  c.innerHTML = `
    <div class="account-filter-panel bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-4">
      <div class="flex flex-wrap gap-3 items-center">
        ${APP_STATE.isOwner ? `<select id="accounting-scope" onchange="onAccountingScopeChange(this.value)" class="px-3 py-2 border rounded-lg text-sm"><option value="consolidated" ${APP_STATE.accountingScope === 'consolidated' ? 'selected' : ''}>সব Branch — Consolidated</option>${APP_STATE.branches.map(b => `<option value="${esc(b.id)}" ${APP_STATE.accountingScope === b.id ? 'selected' : ''}>${esc(b.name)}${b.active === false ? ' — নিষ্ক্রিয়' : ''}</option>`).join('')}</select>` : ''}
        <input type="date" id="accounting-from" value="${APP_STATE.ledgerDate}" onchange="renderAccountingSummary()" class="px-3 py-1.5 border rounded-lg text-sm"/>
        <input type="date" id="accounting-to" value="${APP_STATE.ledgerDate}" onchange="renderAccountingSummary()" class="px-3 py-1.5 border rounded-lg text-sm"/>
      </div>
      <div id="accounting-summary" class="mt-4"></div>
    </div>
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-4">
      <div class="account-ledger-toolbar flex flex-wrap items-center gap-3 justify-between">
        <div class="account-ledger-date flex items-center gap-2">
          <label class="text-xs font-semibold text-slate-500 uppercase">তারিখ</label>
          <input type="date" id="ledger-date" value="${APP_STATE.ledgerDate}" onchange="onLedgerDateChange(this.value)"
            class="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"/>
        </div>
        <div class="account-ledger-tabs flex gap-2">
          <button onclick="setLedgerTab('all')" id="lt-all" class="btn btn-sm"></button>
          <button onclick="setLedgerTab('income')" id="lt-income" class="btn btn-sm"></button>
          <button onclick="setLedgerTab('expense')" id="lt-expense" class="btn btn-sm"></button>
        </div>
        <button id="account-add-income" onclick="toggleIncomeForm()" class="btn btn-emerald btn-sm">
          <i class="fa-solid fa-plus"></i> নতুন আয়
        </button>
        <button id="account-add-expense" onclick="toggleExpenseForm()" class="btn btn-primary btn-sm">
          <i class="fa-solid fa-plus"></i> নতুন খরচ যোগ
        </button>
      </div>
      <div id="expense-form-box" class="hidden mt-4 pt-4 border-t border-slate-200 dark:border-slate-700"></div>
    </div>

    <div class="account-kpis grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
      <div class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-center">
        <div class="text-[11px] uppercase text-emerald-600 font-semibold mb-1">মোট আয়</div>
        <div id="ledger-total-income" class="text-lg font-extrabold font-mono text-emerald-600">৳০</div>
      </div>
      <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-center">
        <div class="text-[11px] uppercase text-red-600 font-semibold mb-1">মোট ব্যয়</div>
        <div id="ledger-total-expense" class="text-lg font-extrabold font-mono text-red-600">৳০</div>
      </div>
      <div class="bg-brand/10 border border-brand/30 rounded-xl p-4 text-center">
        <div class="text-[11px] uppercase text-brand font-semibold mb-1">নেট</div>
        <div id="ledger-total-net" class="text-lg font-extrabold font-mono text-brand">৳০</div>
      </div>
    </div>

    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <div id="ledger-table-body"></div>
    </div>
  `;
  updateLedgerTabsUI();
  updateAccountingWriteControls();
  renderAccountingSummary();
  renderLedgerTable();
}

function accountingScope() {
  return document.getElementById('accounting-scope')?.value || APP_STATE.activeBranchId;
}

function accountingBranchIds() {
  const scope = accountingScope();
  if (scope === 'consolidated') return APP_STATE.branches.map(b => b.id);
  return APP_STATE.branches.some(b => b.id === scope) ? [scope] : [];
}

function updateAccountingWriteControls() {
  const button = document.getElementById('account-add-expense');
  const incomeButton = document.getElementById('account-add-income');
  const writable = accountingScope() === APP_STATE.activeBranchId;
  [button, incomeButton].forEach(control => {
    if (!control) return;
    control.disabled = !writable;
    control.title = writable ? '' : 'আয়/খরচ যোগ করতে আগে সক্রিয় Branch নির্বাচন করুন';
    control.classList.toggle('opacity-50', !writable);
  });
}

function onAccountingScopeChange(scope) {
  APP_STATE.accountingScope = scope;
  updateAccountingWriteControls();
  if (scope !== APP_STATE.activeBranchId) {
    const form = document.getElementById('expense-form-box');
    if (form) {
      form.classList.add('hidden');
      form.innerHTML = '';
    }
  }
  renderAccountingSummary();
  renderLedgerTable();
}

async function loadAccountingData(
  branchIds,
  from,
  to,
  names = ['sales', 'purchases', 'returns', 'expenses', 'incomes', 'payments', 'supplierPayments', 'customers', 'suppliers', 'inventory']
) {
  const transactionCollections = new Set(['sales', 'purchases', 'returns', 'expenses', 'incomes', 'payments', 'supplierPayments']);
  const result = Object.fromEntries(names.map(name => [name, []]));
  await Promise.all(branchIds.map(async branchId => {
    const docsByCollection = await Promise.all(names.map(async name => {
      let ref = fbDb.collection('branches').doc(branchId).collection(name);
      if (transactionCollections.has(name)) {
        ref = ref.where('date', '>=', from).where('date', '<=', to);
      }
      const snap = await ref.get();
      return [name, snap.docs.map(d => ({ ...d.data(), id: d.id, branchId }))];
    }));
    docsByCollection.forEach(([name, docs]) => result[name].push(...docs));
  }));
  return result;
}

async function renderAccountingSummary() {
  const box = document.getElementById('accounting-summary');
  if (!box) return;
  const requestId = ++accountingSummaryRequest;
  const from = document.getElementById('accounting-from')?.value || APP_STATE.ledgerDate;
  const to = document.getElementById('accounting-to')?.value || from;
  const branchIds = accountingBranchIds();
  box.innerHTML = '<div class="text-sm text-slate-400 py-3">হিসাব লোড হচ্ছে...</div>';
  let data;
  try {
    data = await loadAccountingData(branchIds, from, to);
  } catch (err) {
    if (requestId !== accountingSummaryRequest) return;
    box.innerHTML = `<div class="text-sm text-red-600 py-3">হিসাব লোড ব্যর্থ: ${esc(err.message)}</div>`;
    return;
  }
  if (requestId !== accountingSummaryRequest) return;

  const sales = data.sales;
  const purchases = data.purchases;
  const returns = data.returns;
  const expenses = data.expenses;
  const payments = data.payments;
  const supplierPayments = data.supplierPayments;
  const incomes = data.incomes || [];

  const salesRevenue = round2(sales.reduce((a, s) => a + (s.totalBill || 0), 0));
  const salesCOGS = round2(sales.reduce((a, s) =>
    a + (s.items || []).reduce((sum, i) => sum + ((i.qty || 0) * (i.costPrice || 0)), 0), 0));
  const customerRefunds = round2(returns
    .filter(r => r.returnType === 'customer')
    .reduce((a, r) => a + (r.amount || 0), 0));
  const operatingExpenses = round2(expenses.reduce((a, e) => a + (e.amount || 0), 0));
  const otherIncome = round2(incomes.reduce((a, i) => a + (i.amount || 0), 0));
  const grossProfit = round2(salesRevenue - customerRefunds - salesCOGS);
  const netProfit = round2(grossProfit - operatingExpenses + otherIncome);

  const cashSales = round2(sales.reduce((a, s) => a + (s.cashPaid || 0), 0));
  const cashPurchase = round2(purchases
    .filter(p => p.paymentType === 'নগদ')
    .reduce((a, p) => a + (p.totalCost || 0), 0));
  const dueCollections = round2(payments.reduce((a, p) => a + (p.amount || 0), 0));
  const supplierOutflow = round2(supplierPayments.reduce((a, p) => a + (p.amount || 0), 0));
  const expenseCashOut = operatingExpenses;
  const customerDue = round2(data.customers.reduce((a, c) => a + (c.due || 0), 0));
  const supplierPayable = round2(data.suppliers.reduce((a, s) => a + (s.totalPayable || 0), 0));
  const inventoryValuation = round2(data.inventory.reduce((a, i) => a + (i.costValue || 0), 0));

  const card = (label, value, tone) =>
    `<div class="bg-${tone}-50 dark:bg-${tone}-900/20 border border-${tone}-200 rounded-xl p-3"><div class="text-[11px] text-${tone}-600">${esc(label)}</div><div class="font-mono font-bold text-lg mt-1">৳${fmt(value)}</div></div>`;
  box.innerHTML = `
    <div class="account-summary-cards grid grid-cols-2 md:grid-cols-4 gap-3">
      ${card('Sales revenue', salesRevenue, 'emerald')}
      ${card('অন্যান্য আয়', otherIncome, 'emerald')}
      ${card('COGS', salesCOGS, 'red')}
      ${card('Gross profit', grossProfit, 'brand')}
      ${card('Operating expenses', operatingExpenses, 'amber')}
      ${card('Net profit', netProfit, 'emerald')}
      ${card('Receivables', customerDue, 'blue')}
      ${card('Payables', supplierPayable, 'red')}
      ${card('Inventory valuation', inventoryValuation, 'brand')}
    </div>
    <div class="mt-3 text-xs text-slate-500 grid grid-cols-2 md:grid-cols-4 gap-2">
      <span>Cash sales: <b>৳${fmt(cashSales)}</b></span>
      <span>Cash purchases: <b>৳${fmt(cashPurchase)}</b></span>
      <span>Due collections: <b>৳${fmt(dueCollections)}</b></span>
      <span>Supplier payments: <b>৳${fmt(supplierOutflow)}</b></span>
      <span>Expense cash out: <b>৳${fmt(expenseCashOut)}</b></span>
    </div>`;
}

function onLedgerDateChange(val) {
  APP_STATE.ledgerDate = val || todayStr();
  renderLedgerTable();
}

function setLedgerTab(tab) {
  APP_STATE.ledgerTab = tab;
  updateLedgerTabsUI();
  renderLedgerTable();
}

function updateLedgerTabsUI() {
  const map = { all: 'সব', income: 'আয়', expense: 'ব্যয়' };
  Object.keys(map).forEach(key => {
    const btn = document.getElementById('lt-' + key);
    if (!btn) return;
    btn.textContent = map[key];
    const active = APP_STATE.ledgerTab === key;
    btn.className = `btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`;
  });
}

// ────────────────────────────────────────────────────────────
// LEDGER ENTRIES BUILDER — সব সোর্স একত্র করে
// ────────────────────────────────────────────────────────────
function buildLedgerEntries(dateStr, source = APP_STATE, canDelete = true) {
  const entries = [];

  (source.sales || []).filter(s => s.date === dateStr).forEach(s => {
    entries.push({ type: 'income', category: 'বিক্রয়', desc: (s.invoiceNo || '') + ' — ' + (s.customerName || ''), amount: s.totalBill || 0, deletable: false, branchId: s.branchId });
  });

  (source.payments || []).filter(p => p.date === dateStr).forEach(p => {
    entries.push({ type: 'income', category: 'বাকি আদায়', desc: (p.customerName || p.customerId || '') + (p.note ? ' — ' + p.note : ''), amount: p.amount || 0, deletable: false, branchId: p.branchId });
  });

  (source.incomes || []).filter(i => i.date === dateStr).forEach(i => {
    entries.push({ type: 'income', category: i.category || i.source || 'অন্যান্য আয়', desc: i.description || i.note || '', amount: i.amount || 0, deletable: canDelete && i.branchId === APP_STATE.activeBranchId, refId: i.id, branchId: i.branchId, accountType: i.accountType || 'general' });
  });

  (source.expenses || []).filter(e => e.date === dateStr).forEach(e => {
    entries.push({ type: 'expense', category: e.category || 'খরচ', desc: e.description || '', amount: e.amount || 0, deletable: canDelete && e.branchId === APP_STATE.activeBranchId, refId: e.id, branchId: e.branchId });
  });

  (source.purchases || []).filter(p => p.date === dateStr).forEach(p => {
    if (p.paymentType === 'নগদ') {
      entries.push({ type: 'expense', category: 'ক্রয় (নগদ)', desc: (p.supplierName || '') + ' — ' + (p.medicineName || ''), amount: p.totalCost || 0, deletable: false, branchId: p.branchId });
    } else {
      entries.push({ type: 'info', category: 'ক্রয় (বাকি)', desc: (p.supplierName || '') + ' — নগদ প্রভাব নেই', amount: p.totalCost || 0, deletable: false, branchId: p.branchId });
    }
  });

  (source.supplierPayments || []).filter(p => p.date === dateStr).forEach(p => {
    entries.push({ type: 'expense', category: 'সরবরাহকারী পরিশোধ', desc: (p.supplierName || p.supplierId || '') + (p.note ? ' — ' + p.note : ''), amount: p.amount || 0, deletable: false, branchId: p.branchId });
  });

  (source.returns || []).filter(r => r.date === dateStr).forEach(r => {
    if (r.returnType === 'customer') {
      // ✅ ফিক্স (ধাপ ১৪): refundMethod চেক করা হচ্ছে — সাপ্লায়ার রিটার্নের
      // ব্লকের মতোই। 'নগদ ফেরত' হলে প্রকৃত ক্যাশ আউটফ্লো (expense), কিন্তু
      // 'বাকি সমন্বয়' হলে শুধু গ্রাহকের বাকি কমে, কোনো টাকা হাতবদল হয় না —
      // তাই সেটা নন-ক্যাশ 'তথ্য' এন্ট্রি, Dashboard-এর P&L লজিকের সাথে সামঞ্জস্যপূর্ণ।
      if (r.refundMethod === 'নগদ ফেরত') {
        entries.push({ type: 'expense', category: 'রিটার্ন (কাস্টমার, নগদ)', desc: (r.refName || '') + ' — ' + (r.refId || ''), amount: r.amount || 0, deletable: false, branchId: r.branchId });
      } else {
        entries.push({ type: 'info', category: 'রিটার্ন (কাস্টমার, বাকি সমন্বয়)', desc: (r.refName || '') + ' — নগদ প্রভাব নেই', amount: r.amount || 0, deletable: false, branchId: r.branchId });
      }
    } else if (r.reason === 'ধ্বংস') {
      entries.push({ type: 'expense', category: 'এক্সপায়ারি রাইট-অফ', desc: (r.refName || '') + ' — ' + (r.refId || ''), amount: r.amount || 0, deletable: false, branchId: r.branchId });
    } else if (r.refundMethod === 'নগদ ফেরত') {
      entries.push({ type: 'income', category: 'সরবরাহকারী রিটার্ন (নগদ)', desc: (r.refName || '') + ' — ' + (r.refId || ''), amount: r.amount || 0, deletable: false, branchId: r.branchId });
    } else {
      entries.push({ type: 'info', category: 'সরবরাহকারী রিটার্ন (পাওনা সমন্বয়)', desc: (r.refName || '') + ' — নগদ প্রভাব নেই', amount: r.amount || 0, deletable: false, branchId: r.branchId });
    }
  });

  return entries;
}

async function renderLedgerTable() {
  const box = document.getElementById('ledger-table-body');
  if (!box) return;
  const requestId = ++ledgerTableRequest;
  const scope = accountingScope();
  const branchIds = accountingBranchIds();
  const canDelete = scope === APP_STATE.activeBranchId;
  box.innerHTML = '<div class="px-5 py-5 text-center text-slate-400 text-sm">লেজার লোড হচ্ছে...</div>';
  let data;
  try {
    data = await loadAccountingData(
      branchIds,
      APP_STATE.ledgerDate,
      APP_STATE.ledgerDate,
      ['sales', 'purchases', 'returns', 'expenses', 'incomes', 'payments', 'supplierPayments']
    );
  } catch (err) {
    if (requestId !== ledgerTableRequest) return;
    box.innerHTML = `<div class="px-5 py-5 text-center text-red-600 text-sm">লেজার লোড ব্যর্থ: ${esc(err.message)}</div>`;
    return;
  }
  if (requestId !== ledgerTableRequest) return;
  const all = buildLedgerEntries(APP_STATE.ledgerDate, data, canDelete);

  const totalIncome = round2(all.filter(e => e.type === 'income').reduce((a, b) => a + b.amount, 0));
  const totalExpense = round2(all.filter(e => e.type === 'expense').reduce((a, b) => a + b.amount, 0));
  const net = round2(totalIncome - totalExpense);
  setText('ledger-total-income', '৳' + fmt(totalIncome));
  setText('ledger-total-expense', '৳' + fmt(totalExpense));
  const netEl = document.getElementById('ledger-total-net');
  if (netEl) { netEl.textContent = (net < 0 ? '−' : '') + '৳' + fmt(Math.abs(net)); netEl.className = `text-lg font-extrabold font-mono ${net >= 0 ? 'text-emerald-600' : 'text-red-600'}`; }


  const list = APP_STATE.ledgerTab === 'all' ? all : all.filter(e => e.type === APP_STATE.ledgerTab);

  if (!list.length) {
    box.innerHTML = `<div class="px-5 py-10 text-center text-slate-400 text-sm"><i class="fa-solid fa-book-open text-2xl opacity-30 mb-2 block"></i>এই তারিখে কোনো এন্ট্রি নেই</div>`;
    return;
  }

  box.innerHTML = `
    <div class="overflow-x-auto">
    <table class="account-ledger-table w-full text-sm">
      <thead class="bg-slate-50 dark:bg-slate-900/40 text-[11px] uppercase text-slate-500 dark:text-slate-400">
        <tr><th class="px-4 py-2.5 text-left">ধরন</th><th class="px-4 py-2.5 text-left">ক্যাটাগরি</th><th class="px-4 py-2.5 text-left">বিবরণ</th><th class="px-4 py-2.5 text-left">Branch</th><th class="px-4 py-2.5 text-right">পরিমাণ</th><th class="px-4 py-2.5 text-center">Action</th></tr>
      </thead>
      <tbody>
        ${list.map(e => `
          <tr class="border-t border-slate-100 dark:border-slate-700/50">
            <td class="px-4 py-2.5">${ledgerBadge(e.type)}</td>
            <td class="px-4 py-2.5 text-slate-600 dark:text-slate-300">${esc(e.category)}</td>
            <td class="px-4 py-2.5 text-slate-500 text-xs">${esc(e.desc)}</td>
            <td class="px-4 py-2.5 text-slate-500 text-xs">${esc(branchName(e.branchId))}</td>
            <td class="px-4 py-2.5 text-right font-mono font-bold ${e.type === 'income' ? 'text-emerald-600' : e.type === 'expense' ? 'text-red-600' : 'text-slate-400'}">৳${fmt(e.amount)}</td>
            <td class="px-4 py-2.5 text-center">${e.deletable ? `<button onclick="${e.type === 'income' ? `deleteIncomeEntry('${e.refId}')` : `deleteExpenseEntry('${e.refId}')`}" class="text-slate-400 hover:text-red-500"><i class="fa-solid fa-trash text-xs"></i></button>` : '<span class="text-slate-300 text-xs">—</span>'}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    </div>`;
}

function ledgerBadge(type) {
  if (type === 'income') return `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">আয়</span>`;
  if (type === 'expense') return `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400">ব্যয়</span>`;
  return `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">তথ্য</span>`;
}

// ────────────────────────────────────────────────────────────
// ADD EXPENSE FORM
// ────────────────────────────────────────────────────────────
function toggleExpenseForm() {
  if (accountingScope() !== APP_STATE.activeBranchId) {
    return toast('খরচ যোগ করতে আগে সক্রিয় Branch নির্বাচন করুন।', 'w');
  }
  const box = document.getElementById('expense-form-box');
  const isOpen = !box.classList.contains('hidden');
  if (isOpen) { box.classList.add('hidden'); box.innerHTML = ''; delete box.dataset.entryType; return; }
  box.dataset.entryType = 'expense';
  box.classList.remove('hidden');
  box.innerHTML = `
    <div id="exp-form-error" class="hidden bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs rounded-lg px-3 py-2 mb-3"></div>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
      <div class="md:col-span-2">
        <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">বিবরণ</label>
        <input type="text" id="exp-desc" placeholder="যেমন: বিদ্যুৎ বিল" class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"/>
      </div>
      <div>
        <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">ক্যাটাগরি</label>
        <select id="exp-cat" class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white">
          <option>ইউটিলিটি</option><option>স্টাফ বেতন</option><option>স্টাফ অ্যাডভান্স</option><option>Owner Drawings</option><option>Owner Capital/Payout</option><option>ভাড়া</option><option>পরিবহন</option><option>রক্ষণাবেক্ষণ</option><option>অন্যান্য দোকান খরচ</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">পরিমাণ (৳)</label>
        <input type="number" id="exp-amt" min="0.01" step="0.01" placeholder="০.০০" class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white"/>
      </div>
      <div class="md:col-span-2">
        <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">স্টাফ (বেতন/অ্যাডভান্স হলে)</label>
        <select id="exp-staff" class="w-full px-3 py-2 text-sm border rounded-lg"><option value="">নির্বাচন করুন না</option>${(APP_STATE.staffList || []).map(s=>`<option value="${esc(s.id)}">${esc(s.name || s.email)}</option>`).join('')}</select>
      </div>
    </div>
    <button onclick="submitExpenseEntry()" class="btn btn-primary mt-3">খরচ যোগ করুন</button>`;
  document.getElementById('exp-desc').focus();
}

function toggleIncomeForm() {
  if (accountingScope() !== APP_STATE.activeBranchId) return toast('আয় যোগ করতে আগে সক্রিয় Branch নির্বাচন করুন।', 'w');
  const box = document.getElementById('expense-form-box');
  const isOpen = !box.classList.contains('hidden') && box.dataset.entryType === 'income';
  if (isOpen) { box.classList.add('hidden'); box.innerHTML = ''; delete box.dataset.entryType; return; }
  box.dataset.entryType = 'income';
  box.classList.remove('hidden');
  box.innerHTML = `
    <div id="income-form-error" class="hidden bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg px-3 py-2 mb-3"></div>
    <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
      <div><label class="block text-xs font-semibold text-slate-500 mb-1">পরিমাণ (৳)</label><input type="number" id="income-amt" min="0.01" step="0.01" class="w-full px-3 py-2 text-sm border rounded-lg"/></div>
      <div><label class="block text-xs font-semibold text-slate-500 mb-1">ক্যাটাগরি/উৎস</label><input type="text" id="income-category" value="অন্যান্য আয়" class="w-full px-3 py-2 text-sm border rounded-lg"/></div>
      <div><label class="block text-xs font-semibold text-slate-500 mb-1">তারিখ</label><input type="date" id="income-date" value="${APP_STATE.ledgerDate}" class="w-full px-3 py-2 text-sm border rounded-lg"/></div>
      <div><label class="block text-xs font-semibold text-slate-500 mb-1">পেমেন্ট/রেফারেন্স</label><input type="text" id="income-reference" placeholder="নগদ/ব্যাংক/রেফারেন্স" class="w-full px-3 py-2 text-sm border rounded-lg"/></div>
      <div><label class="block text-xs font-semibold text-slate-500 mb-1">নোট</label><input type="text" id="income-note" class="w-full px-3 py-2 text-sm border rounded-lg"/></div>
    </div>
    <button onclick="submitIncomeEntry()" class="btn btn-primary mt-3"><i class="fa-solid fa-plus mr-1"></i>আয় যোগ করুন</button>`;
  document.getElementById('income-amt').focus();
}

async function submitIncomeEntry() {
  if (guardReadOnly()) return;
  if (accountingScope() !== APP_STATE.activeBranchId) return toast('আয় যোগ করতে আগে সক্রিয় Branch নির্বাচন করুন।', 'w');
  const err = document.getElementById('income-form-error');
  const showErr = msg => { err.textContent = msg; err.classList.remove('hidden'); };
  const amount = round2(parseFloat(document.getElementById('income-amt').value) || 0);
  const category = document.getElementById('income-category').value.trim();
  const date = document.getElementById('income-date').value || APP_STATE.ledgerDate;
  const reference = document.getElementById('income-reference').value.trim();
  const note = document.getElementById('income-note').value.trim();
  if (amount <= 0) return showErr('সঠিক পরিমাণ দিন।');
  const income = {
    id: 'INC-' + Date.now(), date, amount, category, source: category,
    paymentMethod: reference, reference, note, accountType: 'general',
    branchId: APP_STATE.activeBranchId, createdByUid: APP_STATE.currentUser?.uid || null,
  };
  try {
    const res = await apiAddIncome(income);
    if (!res.success) return showErr(res.message);
    if (res.queued) toast(res.message, 'w'); else { APP_STATE.incomes.push(income); toast('আয় যোগ হয়েছে।', 's'); }
    toggleIncomeForm();
    renderLedgerTable();
  } catch (e) { showFatalError('আয় সংরক্ষণে সমস্যা:\n' + humanizeError(e), e); }
}

async function deleteIncomeEntry(incomeId) {
  if (guardReadOnly()) return;
  if (!confirm('এই আয় এন্ট্রি মুছবেন?')) return;
  const res = await apiDeleteIncome(incomeId);
  if (!res.success) return toast(res.message, 'w');
  APP_STATE.incomes = APP_STATE.incomes.filter(i => i.id !== incomeId);
  toast('আয় মুছে ফেলা হয়েছে।', 's');
  renderLedgerTable();
}

async function submitExpenseEntry() {
  if (guardReadOnly()) return;
  if (accountingScope() !== APP_STATE.activeBranchId) {
    return toast('খরচ যোগ করতে আগে সক্রিয় Branch নির্বাচন করুন।', 'w');
  }
  const errEl = document.getElementById('exp-form-error');
  const showErr = (msg) => { errEl.textContent = msg; errEl.classList.remove('hidden'); };
  errEl.classList.add('hidden');
  const desc = document.getElementById('exp-desc').value.trim();
  const cat = document.getElementById('exp-cat').value;
  const amount = round2(parseFloat(document.getElementById('exp-amt').value) || 0);
  const staffUid = document.getElementById('exp-staff')?.value || '';
  const staff = (APP_STATE.staffList || []).find(s => s.id === staffUid);
  if (!desc) return showErr('বিবরণ দিন।');
  if (amount <= 0) return showErr('সঠিক পরিমাণ দিন।');

  const exp = {
    id: 'EXP-' + Date.now(),
    date: APP_STATE.ledgerDate,
    description: desc,
    amount,
    category: cat,
    accountType: cat === 'স্টাফ বেতন' || cat === 'স্টাফ অ্যাডভান্স' ? 'staff' : (cat.indexOf('Owner') >= 0 ? 'owner' : 'general'),
    staffUid: staffUid || null,
    staffName: staff?.name || staff?.email || '',
    branchId: APP_STATE.activeBranchId,
    createdByUid: APP_STATE.currentUser?.uid || null,
  };
  try {
    const res = await apiAddExpense(exp);
    if (!res.success) return showErr(res.message);

    if (res.queued) {
      toast(res.message, 'w');
      refreshSyncBadge();
    } else {
      APP_STATE.expenses.push(exp);
      toast('খরচ যোগ হয়েছে।', 's');
    }

    toggleExpenseForm();
    renderLedgerTable();
  } catch (err) { showFatalError('খরচ সংরক্ষণে সমস্যা:\n' + humanizeError(err), err); }
}

async function deleteExpenseEntry(expId) {
  if (guardReadOnly()) return;
  if (accountingScope() !== APP_STATE.activeBranchId) {
    return toast('অন্য Branch-এর লেজার থেকে খরচ মুছতে পারবেন না।', 'w');
  }
  if (!confirm('এই খরচ এন্ট্রি মুছবেন?')) return;
  try {
    const res = await apiDeleteExpense(expId);
    if (!res.success) return toast(res.message, 'w');
    APP_STATE.expenses = APP_STATE.expenses.filter(e => e.id !== expId);
    toast('খরচ মুছে ফেলা হয়েছে।', 's');
    renderLedgerTable();
  } catch (err) { showFatalError('খরচ মুছতে সমস্যা:\n' + humanizeError(err), err); }
}
