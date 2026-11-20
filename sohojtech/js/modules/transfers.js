'use strict';

let transferLines = [];

function renderTransfersModule() {
  if (!APP_STATE.isOwner && !hasTransferPermission()) {
    document.getElementById('transfers-content').innerHTML =
      '<div class="bg-white dark:bg-slate-800 rounded-xl p-5 text-red-500 text-sm">Branch transfer এর অনুমতি নেই।</div>';
    return;
  }
  transferLines = transferLines.length ? transferLines : [{ medId: '', batchId: '', qty: 1 }];
  const c = document.getElementById('transfers-content');
  c.innerHTML = `
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-4">
      <h5 class="text-sm font-semibold mb-4"><i class="fa-solid fa-arrow-right-arrow-left text-brand mr-2"></i>Branch-to-Branch Stock Transfer</h5>
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
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
      <h5 class="text-sm font-semibold mb-3">Transfer Ledger</h5>
      <div id="transfer-ledger" class="text-sm"></div>
    </div>`;
  refreshTransferMedicines();
  loadTransferLedger();
}

function renderBranchOptions(selectedId, excludeSource) {
  const source = document.getElementById('transfer-source')?.value || APP_STATE.activeBranchId;
  return APP_STATE.branches
    .filter(b => !excludeSource || b.id !== source)
    .map(b => `<option value="${esc(b.id)}" ${b.id === selectedId ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
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
      const snapshots = await Promise.all(['sourceBranchId', 'targetBranchId'].map(field =>
        fbDb.collection('transfers').where(field, 'in', branchBatch)
          .orderBy('createdAt', 'desc').limit(100).get()
      ));
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
    box.innerHTML = rows.length ? rows.map(r => `
      <div class="border-t py-3 flex justify-between gap-3">
        <div><div class="font-semibold">${esc(r.sourceBranchName || r.sourceBranchId)} <i class="fa-solid fa-arrow-right mx-1"></i> ${esc(r.targetBranchName || r.targetBranchId)}</div>
        <div class="text-xs text-slate-400">${esc(r.transferId)} • ${(r.lines || []).length} line • ${esc(r.paymentMode || 'none')}</div></div>
        <span class="text-xs text-emerald-600 font-semibold">সম্পন্ন</span>
      </div>`).join('') : '<div class="text-slate-400">কোনো transfer নেই।</div>';
  } catch (err) {
    box.innerHTML = `<div class="text-red-500 text-xs">${esc(err.message)}</div>`;
  }
}
