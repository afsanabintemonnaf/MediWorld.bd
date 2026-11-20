'use strict';

let transferLines = [];
let activeTransferLedgerType = 'medicine';

function normalizeTransferType(transfer) {
  return transfer.type === 'cash' || transfer.type === 'assets'
    ? transfer.type
    : 'medicine';
}

function filterTransferLedgerRows(rows, type) {
  return (rows || []).filter(row => normalizeTransferType(row) === type);
}

function renderTransfersModule() {
  if (!APP_STATE.isOwner && !hasTransferPermission()) {
    document.getElementById('transfers-content').innerHTML =
      '<div class="bg-white dark:bg-slate-800 rounded-xl p-5 text-red-500 text-sm">Branch transfer এর অনুমতি নেই।</div>';
    return;
  }
  transferLines = transferLines.length ? transferLines : [{ medId: '', batchId: '', qty: 1 }];
  const c = document.getElementById('transfers-content');
  c.innerHTML = `
    <div id="transfer-panel-medicine" class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-4">
      <h5 class="text-sm font-semibold mb-4"><i class="fa-solid fa-arrow-right-arrow-left text-brand mr-2"></i>ওষুধ Branch-to-Branch Transfer</h5>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div><label class="text-xs text-slate-500">উৎস Branch</label><select id="transfer-source" onchange="refreshTransferMedicines()" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">${renderBranchOptions(APP_STATE.activeBranchId)}</select></div>
        <div><label class="text-xs text-slate-500">গন্তব্য Branch</label><select id="transfer-target" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">${renderBranchOptions('', true)}</select></div>
      </div>
      <div id="transfer-lines" class="space-y-2"></div>
      <div class="flex gap-2 mt-3">
        <button onclick="addTransferLine()" class="btn btn-brand-outline btn-sm"><i class="fa-solid fa-plus mr-1"></i>লাইন যোগ</button>
        <button onclick="executeBranchTransfer()" class="btn btn-primary btn-sm"><i class="fa-solid fa-circle-check mr-1"></i>Transfer নিশ্চিত</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <input id="transfer-financial" type="number" min="0" step="0.01" placeholder="Financial amount (ঐচ্ছিক)" class="px-3 py-2 border rounded-lg text-sm"/>
        <select id="transfer-payment-mode" class="px-3 py-2 border rounded-lg text-sm"><option value="none">নগদ/Bank প্রভাব নেই</option><option value="cash">নগদ</option><option value="bank">Bank</option></select>
        <div id="transfer-error" class="text-xs text-red-500"></div>
      </div>
    </div>
    <div id="transfer-panel-cash" class="hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-4">
      <h5 class="text-sm font-semibold mb-4"><i class="fa-solid fa-money-bill-transfer text-brand mr-2"></i>নগদ/Bank Transfer প্রস্তুত করুন</h5>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><label class="text-xs text-slate-500">উৎস Branch</label><select id="transfer-cash-source" onchange="refreshTransferTargets('cash')" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">${renderBranchOptions(APP_STATE.activeBranchId, false, 'transfer-cash-source')}</select></div>
        <div><label class="text-xs text-slate-500">গন্তব্য Branch</label><select id="transfer-cash-target" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">${renderBranchOptions('', true, 'transfer-cash-source')}</select></div>
        <input id="transfer-cash-amount" type="number" min="0.01" step="0.01" placeholder="পরিমাণ" class="px-3 py-2 border rounded-lg text-sm"/>
        <select id="transfer-cash-mode" class="px-3 py-2 border rounded-lg text-sm"><option value="cash">নগদ</option><option value="bank">Bank</option></select>
        <input id="transfer-cash-confirmation" maxlength="160" placeholder="রেফারেন্স/নোট (ঐচ্ছিক)" class="px-3 py-2 border rounded-lg text-sm"/>
        <button onclick="createCashTransfer()" class="btn btn-primary btn-sm">Owner অনুমোদনের জন্য পাঠান</button>
      </div>
      <div id="transfer-cash-error" class="text-xs text-red-500 mt-2"></div>
      <p class="text-xs text-amber-600 mt-2">Owner অনুমোদন না হওয়া পর্যন্ত কোনো অর্থ settlement হবে না।</p>
    </div>
    <div id="transfer-panel-assets" class="hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-4">
      <h5 class="text-sm font-semibold mb-4"><i class="fa-solid fa-boxes-stacked text-brand mr-2"></i>সম্পদ Branch Transfer প্রস্তুত করুন</h5>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><label class="text-xs text-slate-500">উৎস Branch</label><select id="transfer-assets-source" onchange="refreshTransferTargets('assets')" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">${renderBranchOptions(APP_STATE.activeBranchId, false, 'transfer-assets-source')}</select></div>
        <div><label class="text-xs text-slate-500">গন্তব্য Branch</label><select id="transfer-assets-target" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">${renderBranchOptions('', true, 'transfer-assets-source')}</select></div>
        <input id="transfer-assets-id" maxlength="100" placeholder="সম্পদের ID / Serial" class="px-3 py-2 border rounded-lg text-sm"/>
        <input id="transfer-assets-name" maxlength="160" placeholder="সম্পদের নাম" class="px-3 py-2 border rounded-lg text-sm"/>
        <input id="transfer-assets-note" maxlength="160" placeholder="নোট (ঐচ্ছিক)" class="px-3 py-2 border rounded-lg text-sm"/>
        <button onclick="createAssetTransfer()" class="btn btn-primary btn-sm">Owner অনুমোদনের জন্য পাঠান</button>
      </div>
      <div id="transfer-assets-error" class="text-xs text-red-500 mt-2"></div>
      <p class="text-xs text-amber-600 mt-2">Owner অনুমোদনের পরেই সম্পদের Branch movement সম্পন্ন হবে।</p>
    </div>
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
      <h5 class="text-sm font-semibold mb-3">Transfer Ledger</h5>
      <div class="flex flex-wrap gap-2 mb-3">
        <button id="transfer-tab-medicine" onclick="setTransferLedgerType('medicine')" class="btn btn-primary btn-sm">ওষুধ</button>
        <button id="transfer-tab-cash" onclick="setTransferLedgerType('cash')" class="btn btn-brand-outline btn-sm">নগদ/Bank</button>
        <button id="transfer-tab-assets" onclick="setTransferLedgerType('assets')" class="btn btn-brand-outline btn-sm">সম্পদ</button>
      </div>
      <div id="transfer-ledger" class="text-sm"></div>
    </div>`;
  setTransferLedgerType(activeTransferLedgerType);
  refreshTransferMedicines();
  loadTransferLedger();
}

function renderBranchOptions(selectedId, excludeSource, sourceSelectId = 'transfer-source') {
  const source = document.getElementById(sourceSelectId)?.value || APP_STATE.activeBranchId;
  return APP_STATE.branches
    .filter(b => !excludeSource || b.id !== source)
    .map(b => `<option value="${esc(b.id)}" ${b.id === selectedId ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
}

function refreshTransferTargets(type) {
  const sourceId = `transfer-${type}-source`;
  const targetId = `transfer-${type}-target`;
  const target = document.getElementById(targetId);
  if (target) target.innerHTML = renderBranchOptions(target.value, true, sourceId);
}

function setTransferLedgerType(type) {
  if (!['medicine', 'cash', 'assets'].includes(type)) return;
  activeTransferLedgerType = type;
  ['medicine', 'cash', 'assets'].forEach(ledgerType => {
    const panel = document.getElementById(`transfer-panel-${ledgerType}`);
    const tab = document.getElementById(`transfer-tab-${ledgerType}`);
    if (panel) panel.classList.toggle('hidden', ledgerType !== type);
    if (tab) tab.className = `btn ${ledgerType === type ? 'btn-primary' : 'btn-brand-outline'} btn-sm`;
  });
  renderTransferLedger();
}

async function refreshTransferMedicines() {
  const sourceId = document.getElementById('transfer-source')?.value;
  if (!sourceId) return;
  try {
    const snap = await fbDb.collection('branches').doc(sourceId).collection('inventory').get();
    window._transferInventory = snap.docs.map(d => d.data());
    renderTransferLines();
    const target = document.getElementById('transfer-target');
    if (target && target.value === sourceId) {
      const targetOption = APP_STATE.branches.find(b => b.id !== sourceId);
      if (targetOption) target.value = targetOption.id;
    }
  } catch (err) {
    const box = document.getElementById('transfer-lines');
    if (box) box.innerHTML = `<div class="text-xs text-red-500">${esc(humanizeError(err))}</div>`;
  }
}

function renderTransferLines() {
  const box = document.getElementById('transfer-lines');
  if (!box) return;
  box.innerHTML = transferLines.map((line, i) => {
    const inv = (window._transferInventory || []).filter(m => (m.totalStock || 0) > 0);
    const med = inv.find(m => m.medId === line.medId);
    const batches = med?.batches || [];
    return `<div class="grid grid-cols-1 md:grid-cols-4 gap-2 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
      <select onchange="setTransferLine(${i},'medId',this.value)" class="px-2 py-2 border rounded text-sm"><option value="">ওষুধ বাছুন</option>${inv.map(m => `<option value="${esc(m.medId)}" ${m.medId === line.medId ? 'selected' : ''}>${esc(m.brand)} ${esc(m.doseForm || '')} ${esc(m.strength || '')}</option>`).join('')}</select>
      <select onchange="setTransferLine(${i},'batchId',this.value)" class="px-2 py-2 border rounded text-sm"><option value="">Batch বাছুন</option>${batches.map(b => `<option value="${esc(b.batchId)}" ${b.batchId === line.batchId ? 'selected' : ''}>${esc(b.batchNumber || b.batchId)} — মেয়াদ ${esc(b.expiry || '—')} — স্টক ${b.stock}</option>`).join('')}</select>
      <input type="number" min="0.01" step="0.01" value="${line.qty}" oninput="setTransferLine(${i},'qty',this.value)" placeholder="Qty" class="px-2 py-2 border rounded text-sm"/>
      <button onclick="removeTransferLine(${i})" class="text-red-500 text-xs">লাইন মুছুন</button>
    </div>`;
  }).join('');
}

function setTransferLine(i, field, value) {
  transferLines[i][field] = field === 'qty' ? parseFloat(value) || 0 : value;
  if (field === 'medId') transferLines[i].batchId = '';
  renderTransferLines();
}

function addTransferLine() {
  transferLines.push({ medId: '', batchId: '', qty: 1 });
  renderTransferLines();
}

function removeTransferLine(i) {
  transferLines.splice(i, 1);
  if (!transferLines.length) transferLines.push({ medId: '', batchId: '', qty: 1 });
  renderTransferLines();
}

async function executeBranchTransfer() {
  const sourceId = document.getElementById('transfer-source').value;
  const targetId = document.getElementById('transfer-target').value;
  const source = APP_STATE.branches.find(b => b.id === sourceId);
  const target = APP_STATE.branches.find(b => b.id === targetId);
  if (!sourceId || !targetId || sourceId === targetId) {
    document.getElementById('transfer-error').textContent = 'ভিন্ন উৎস ও গন্তব্য Branch দিন।';
    return;
  }
  const lines = transferLines.filter(l => l.medId && l.batchId && l.qty > 0);
  if (!lines.length) {
    document.getElementById('transfer-error').textContent = 'কমপক্ষে একটি valid batch line দিন।';
    return;
  }
  const res = await apiExecuteBranchTransfer({
    sourceBranchId: sourceId,
    targetBranchId: targetId,
    sourceBranchName: source?.name || sourceId,
    targetBranchName: target?.name || targetId,
    lines,
    financialAmount: parseFloat(document.getElementById('transfer-financial').value) || 0,
    paymentMode: document.getElementById('transfer-payment-mode').value,
  });
  document.getElementById('transfer-error').textContent = res.success ? '' : res.message;
  if (res.success) {
    toast(res.message, 's');
    transferLines = [{ medId: '', batchId: '', qty: 1 }];
    refreshTransferMedicines();
    loadTransferLedger();
  }
}

async function createCashTransfer() {
  const sourceId = document.getElementById('transfer-cash-source').value;
  const targetId = document.getElementById('transfer-cash-target').value;
  const source = APP_STATE.branches.find(branch => branch.id === sourceId);
  const target = APP_STATE.branches.find(branch => branch.id === targetId);
  const result = await apiCreateTransfer({
    type: 'cash',
    sourceBranchId: sourceId,
    targetBranchId: targetId,
    sourceBranchName: source?.name || sourceId,
    targetBranchName: target?.name || targetId,
    amount: document.getElementById('transfer-cash-amount').value,
    paymentMode: document.getElementById('transfer-cash-mode').value,
    confirmationNote: document.getElementById('transfer-cash-confirmation').value.trim(),
  });
  document.getElementById('transfer-cash-error').textContent = result.success ? '' : result.message;
  if (result.success) {
    toast(result.message, 's');
    document.getElementById('transfer-cash-amount').value = '';
    document.getElementById('transfer-cash-confirmation').value = '';
    loadTransferLedger();
  }
}

async function createAssetTransfer() {
  const sourceId = document.getElementById('transfer-assets-source').value;
  const targetId = document.getElementById('transfer-assets-target').value;
  const source = APP_STATE.branches.find(branch => branch.id === sourceId);
  const target = APP_STATE.branches.find(branch => branch.id === targetId);
  const result = await apiCreateTransfer({
    type: 'assets',
    sourceBranchId: sourceId,
    targetBranchId: targetId,
    sourceBranchName: source?.name || sourceId,
    targetBranchName: target?.name || targetId,
    assetId: document.getElementById('transfer-assets-id').value.trim(),
    assetName: document.getElementById('transfer-assets-name').value.trim(),
    note: document.getElementById('transfer-assets-note').value.trim(),
  });
  document.getElementById('transfer-assets-error').textContent = result.success ? '' : result.message;
  if (result.success) {
    toast(result.message, 's');
    document.getElementById('transfer-assets-id').value = '';
    document.getElementById('transfer-assets-name').value = '';
    document.getElementById('transfer-assets-note').value = '';
    loadTransferLedger();
  }
}

async function approveTransfer(transferId) {
  const transfer = (APP_STATE.interBranchTransfers || []).find(row =>
    row.transferId === transferId || row.id === transferId
  );
  if (!transfer) return toast('Transfer record পাওয়া যায়নি।', 'e');
  const result = await apiApproveTransfer(transfer);
  if (!result.success) return toast(result.message, 'e');
  toast(result.message, 's');
  loadTransferLedger();
}

async function loadTransferLedger() {
  const box = document.getElementById('transfer-ledger');
  if (!box) return;
  box.textContent = 'লোড হচ্ছে...';
  try {
    const branchIds = APP_STATE.isOwner
      ? APP_STATE.branches.map(branch => branch.id).filter(Boolean)
      : (APP_STATE.assignedBranchIds || []).filter(Boolean);
    const transfers = new Map();
    for (let i = 0; i < branchIds.length; i += 10) {
      const branchBatch = branchIds.slice(i, i + 10);
      const queries = [];
      ['sourceBranchId', 'targetBranchId'].forEach(field => {
        ['medicine', 'stock', 'cash', 'assets'].forEach(type => {
          queries.push(fbDb.collection('transfers').where(field, 'in', branchBatch)
            .where('type', '==', type).orderBy('createdAt', 'desc').limit(100).get());
        });
      });
      const snapshots = await Promise.all(queries);
      snapshots.flatMap(snap => snap.docs).forEach(doc => {
        if (!transfers.has(doc.id)) transfers.set(doc.id, { id: doc.id, ...doc.data() });
      });
    }
    const rows = Array.from(transfers.values())
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
        const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
        return bTime - aTime;
      })
      .slice(0, 100);
    APP_STATE.interBranchTransfers = rows;
    renderTransferLedger();
  } catch (err) {
    box.innerHTML = `<div class="text-red-500 text-xs">${esc(err.message)}</div>`;
  }
}

function renderTransferLedger() {
  const box = document.getElementById('transfer-ledger');
  if (!box) return;
  const rows = filterTransferLedgerRows(APP_STATE.interBranchTransfers, activeTransferLedgerType);
  box.innerHTML = rows.length ? rows.map(row => {
    const type = normalizeTransferType(row);
    const isPending = row.status === 'pending_owner_approval' && row.approved !== true;
    const details = type === 'medicine'
      ? `${(row.lines || []).length} line • ${esc(row.paymentMode || 'none')}`
      : type === 'cash'
        ? `৳${fmt(row.amount || 0)} • ${esc(row.paymentMode || '')}${row.confirmationNote ? ` • ${esc(row.confirmationNote)}` : ''}`
        : `${esc(row.assetName || 'সম্পদ')} • ID: ${esc(row.assetId || '—')}`;
    const status = isPending
      ? '<span class="text-xs text-amber-600 font-semibold">Owner অনুমোদনের অপেক্ষায়</span>'
      : '<span class="text-xs text-emerald-600 font-semibold">সম্পন্ন</span>';
    const approveButton = isPending && APP_STATE.isOwner
      ? `<button onclick="approveTransfer('${esc(row.transferId || row.id)}')" class="btn btn-primary btn-sm">অনুমোদন ও ${type === 'cash' ? 'settlement' : 'movement'}</button>`
      : '';
    return `<div class="border-t py-3 flex flex-wrap items-center justify-between gap-3">
      <div><div class="font-semibold">${esc(row.sourceBranchName || row.sourceBranchId)} <i class="fa-solid fa-arrow-right mx-1"></i> ${esc(row.targetBranchName || row.targetBranchId)}</div>
      <div class="text-xs text-slate-400">${esc(row.transferId || row.id)} • ${details}</div></div>
      <div class="flex items-center gap-2">${status}${approveButton}</div>
    </div>`;
  }).join('') : '<div class="text-slate-400">এই ধরনের কোনো transfer নেই।</div>';
}
