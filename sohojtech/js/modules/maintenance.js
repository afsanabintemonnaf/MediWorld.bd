'use strict';

function renderMaintenanceModule() {
  if (!APP_STATE.isOwner && !(APP_STATE.permissions.inventory === true)) {
    document.getElementById('maintenance-content').innerHTML =
      '<div class="bg-white dark:bg-slate-800 border rounded-xl p-5 text-red-500 text-sm">Maintenance tools-এর inventory অনুমতি নেই।</div>';
    return;
  }
  const c = document.getElementById('maintenance-content');
  c.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-white dark:bg-slate-800 border rounded-xl p-5">
        <h5 class="font-semibold text-sm mb-3"><i class="fa-solid fa-scale-balanced text-brand mr-2"></i>ফিজিক্যাল স্টক reconciliation</h5>
        <select id="reconcile-med" onchange="loadReconcileBatch()" class="w-full px-3 py-2 border rounded-lg text-sm">${APP_STATE.inventory.map(i => `<option value="${esc(i.medId)}">${esc(i.brand)} ${esc(i.doseForm || '')} ${esc(i.strength || '')}</option>`).join('')}</select>
        <select id="reconcile-batch" class="w-full mt-2 px-3 py-2 border rounded-lg text-sm"></select>
        <div class="grid grid-cols-2 gap-2 mt-2"><input id="reconcile-count" type="number" min="0" step="0.01" placeholder="ফিজিক্যাল কাউন্ট" class="px-3 py-2 border rounded-lg text-sm"/><input id="reconcile-note" placeholder="কারণ" class="px-3 py-2 border rounded-lg text-sm"/></div>
        <button onclick="submitStockAdjustment()" class="btn btn-primary btn-sm mt-3">স্টক সমন্বয় সেভ</button>
      </div>
      <div class="bg-white dark:bg-slate-800 border rounded-xl p-5">
        <h5 class="font-semibold text-sm mb-3"><i class="fa-solid fa-trash-can text-red-500 mr-2"></i>Expired/Damaged cleanup</h5>
        <select id="cleanup-med" class="w-full px-3 py-2 border rounded-lg text-sm">${APP_STATE.inventory.map(i => `<option value="${esc(i.medId)}">${esc(i.brand)}</option>`).join('')}</select>
        <select id="cleanup-batch" class="w-full mt-2 px-3 py-2 border rounded-lg text-sm"></select>
        <select id="cleanup-reason" class="w-full mt-2 px-3 py-2 border rounded-lg text-sm"><option value="expired">মেয়াদ শেষ</option><option value="damaged">ক্ষতিগ্রস্ত</option><option value="loss">অন্যান্য loss</option></select>
        <button onclick="cleanupStock()" class="btn btn-danger btn-sm mt-3">স্টক write-off</button>
      </div>
      <div class="bg-white dark:bg-slate-800 border rounded-xl p-5">
        <h5 class="font-semibold text-sm mb-3"><i class="fa-solid fa-clone text-amber-500 mr-2"></i>ডুপ্লিকেট ওষুধ check</h5>
        <div id="duplicate-medicine-list" class="text-xs text-slate-500">চেক করা হচ্ছে...</div>
      </div>
      <div class="bg-white dark:bg-slate-800 border rounded-xl p-5">
        <h5 class="font-semibold text-sm mb-3"><i class="fa-solid fa-cloud-arrow-down text-brand mr-2"></i>লোকাল backup ও sync retry</h5>
        <button onclick="exportToExcel()" class="btn btn-brand-outline btn-sm"><i class="fa-solid fa-file-excel mr-1"></i>Excel export</button>
        <button onclick="retryFailedSync()" class="btn btn-primary btn-sm ml-2"><i class="fa-solid fa-rotate mr-1"></i>Sync retry</button>
        <div id="maintenance-status" class="text-xs text-slate-400 mt-3"></div>
      </div>
    </div>`;
  loadReconcileBatch();
  loadCleanupBatch();
  renderDuplicateMedicineCheck();
  document.getElementById('reconcile-med').addEventListener('change', loadReconcileBatch);
  document.getElementById('cleanup-med').addEventListener('change', loadCleanupBatch);
}

function loadReconcileBatch() {
  const medId = document.getElementById('reconcile-med')?.value;
  const inv = APP_STATE.inventory.find(i => i.medId === medId);
  const el = document.getElementById('reconcile-batch');
  if (el) el.innerHTML = (inv?.batches || []).map(b => `<option value="${esc(b.batchId)}">${esc(b.batchNumber || b.batchId)} — ${esc(b.expiry || 'মেয়াদ নেই')} — স্টক ${b.stock}</option>`).join('');
}

function loadCleanupBatch() {
  const medId = document.getElementById('cleanup-med')?.value;
  const inv = APP_STATE.inventory.find(i => i.medId === medId);
  const el = document.getElementById('cleanup-batch');
  if (el) el.innerHTML = (inv?.batches || []).map(b => `<option value="${esc(b.batchId)}">${esc(b.batchNumber || b.batchId)} — ${esc(b.expiry || 'মেয়াদ নেই')} — স্টক ${b.stock}</option>`).join('');
}

async function submitStockAdjustment() {
  if (guardReadOnly()) return;
  const medId = document.getElementById('reconcile-med').value;
  const batchId = document.getElementById('reconcile-batch').value;
  const physical = round2(parseFloat(document.getElementById('reconcile-count').value) || 0);
  const note = document.getElementById('reconcile-note').value.trim();
  if (!batchId) return toast('Batch বাছুন।', 'w');
  const inv = APP_STATE.inventory.find(i => i.medId === medId);
  const batch = inv?.batches.find(b => b.batchId === batchId);
  if (!batch) return;
  const previousCount = batch.stock;
  batch.stock = physical;
  inv.batches = inv.batches.filter(b => b.stock > 0);
  recalcInventoryRow(inv);
  const res = await apiSetInventoryRow(medId, inv);
  if (res.success) {
    const auditId = 'ADJ-' + Date.now();
    await fbDb.collection('audits').doc(auditId).set({
      auditId,
      action: 'stock-adjustment',
      actorUid: APP_STATE.currentUser.uid,
      branchId: APP_STATE.activeBranchId,
      medId,
      batchId,
      physicalCount: physical,
      previousCount,
      note,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(err => console.warn('Stock adjustment audit:', err));
    toast('স্টক reconciliation সেভ হয়েছে।', 's');
  } else toast(res.message, 'e');
}

async function cleanupStock() {
  if (guardReadOnly()) return;
  const medId = document.getElementById('cleanup-med').value;
  const batchId = document.getElementById('cleanup-batch').value;
  const reason = document.getElementById('cleanup-reason').value;
  if (!confirm('এই batch-এর পুরো stock write-off করবেন?')) return;
  const inv = APP_STATE.inventory.find(i => i.medId === medId);
  const batch = inv?.batches.find(b => b.batchId === batchId);
  if (!batch) return;
  const qty = batch.stock;
  inv.batches = inv.batches.filter(b => b.batchId !== batchId);
  recalcInventoryRow(inv);
  const res = await apiSetInventoryRow(medId, inv);
  if (res.success) {
    await fbDb.collection('audits').doc('WOF-' + Date.now()).set({
      action: 'stock-write-off',
      actorUid: APP_STATE.currentUser.uid,
      branchId: APP_STATE.activeBranchId,
      medId,
      batchId,
      qty,
      reason,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
    toast('Expired/damaged stock write-off করা হয়েছে।', 's');
  } else toast(res.message, 'e');
}

function renderDuplicateMedicineCheck() {
  const keyMap = new Map();
  APP_STATE.medicines.forEach(m => {
    const key = [m.brand, m.doseForm, m.strength].map(v => String(v || '').trim().toLowerCase()).join('|');
    if (!keyMap.has(key)) keyMap.set(key, []);
    keyMap.get(key).push(m);
  });
  const duplicates = [...keyMap.values()].filter(v => v.length > 1);
  const box = document.getElementById('duplicate-medicine-list');
  if (!box) return;
  box.innerHTML = duplicates.length
    ? duplicates.map(v => `<div class="border-t py-2 text-red-600">${esc(v.map(m => m.brand + ' ' + (m.doseForm || '') + ' ' + (m.strength || '')).join(' / '))}</div>`).join('')
    : '<span class="text-emerald-600">Duplicate medicine পাওয়া যায়নি।</span>';
}

async function retryFailedSync() {
  const box = document.getElementById('maintenance-status');
  if (typeof processSyncQueue === 'function') {
    try {
      await processSyncQueue();
      if (box) box.textContent = 'Sync retry সম্পন্ন হয়েছে।';
    } catch (err) {
      if (box) box.textContent = 'Sync retry ব্যর্থ: ' + err.message;
    }
  } else if (box) {
    box.textContent = 'Sync queue processor পাওয়া যায়নি।';
  }
}
