'use strict';

// ════════════════════════════════════════════════════════════
// REORDER QUICK-LIST MODULE — ধাপ ৩৩.৩
// Dashboard-এর স্টকশূন্য/স্বল্প-স্টক suggestion থেকে ট্রিগার হয়।
// preferredSupplierId (ধাপ ৩৩.২) অনুযায়ী গ্রুপ, ভেতরে preferredRepId
// অনুযায়ী সাব-গ্রুপ। কোনো navigate নেই — সম্পূর্ণ ইনলাইন মডাল।
// কপি-বাটন ছাড়া কোনো auto-send/API-cost নেই — সম্পূর্ণ rule-based,
// ফ্রি-টিয়ার ফিচার (AI Business Assistant/ধাপ ৩৪-এ পরে reorderListDraft
// হিসেবে এক্সপোজ হবে, কিন্তু এই rule-based ভার্সনই সবসময় fallback থাকবে)।
// ════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────
// DATA — candidates বের করা ও গ্রুপ করা
// ────────────────────────────────────────────────────────────
function getReorderCandidates() {
  return APP_STATE.inventory
    .filter(inv => {
      if (!hasMedicinePurchaseHistory(inv.medId)) return false;
      const med = APP_STATE.medicines.find(m => m.id === inv.medId);
      const level = getEffectiveReorderLevel(med);
      const stock = Number(inv.totalStock || 0);
      return stock === 0 || stock <= level;
    })
    .map(inv => {
      const med = APP_STATE.medicines.find(m => m.id === inv.medId);
      return {
        medId: inv.medId,
        brand: inv.brand,
        doseForm: inv.doseForm,
        strength: inv.strength,
        totalStock: inv.totalStock,
        status: Number(inv.totalStock || 0) === 0 ? 'out' : 'low',
        reorderLevel: getEffectiveReorderLevel(med),
        preferredSupplierId: med?.preferredSupplierId || '',
        preferredRepId: med?.preferredRepId || '',
      };
    })
    // স্টকশূন্য আগে, তারপর স্বল্প — জরুরি আইটেম উপরে থাকবে
    .sort((a, b) => (a.status === 'out' ? 0 : 1) - (b.status === 'out' ? 0 : 1));
}

// রিটার্ন করে: { supplierGroups: [{supplierId, supplier, repGroups:[{repId,repName,repPhone,meds}], noRepMeds}], unassigned: [] }
function buildReorderGroups(candidates) {
  const bySupplier = new Map();
  const unassigned = [];

  candidates.forEach(c => {
    if (!c.preferredSupplierId) { unassigned.push(c); return; }
    const supplier = APP_STATE.suppliers.find(s => s.id === c.preferredSupplierId);
    if (!supplier) {
      // ✅ সরবরাহকারী মুছে ফেলা হয়ে থাকলে — silently unassigned-এ ফেলা না দিয়ে
      // আলাদা ট্যাগ সহ unassigned-এ রাখা হচ্ছে, যাতে ইউজার বুঝতে পারেন কেন এটা এখানে
      unassigned.push({ ...c, supplierDeleted: true });
      return;
    }
    if (!bySupplier.has(c.preferredSupplierId)) {
      bySupplier.set(c.preferredSupplierId, { supplier, repMap: new Map(), noRepMeds: [] });
    }
    const bucket = bySupplier.get(c.preferredSupplierId);
    if (c.preferredRepId) {
      if (!bucket.repMap.has(c.preferredRepId)) bucket.repMap.set(c.preferredRepId, []);
      bucket.repMap.get(c.preferredRepId).push(c);
    } else {
      bucket.noRepMeds.push(c);
    }
  });

  const supplierGroups = Array.from(bySupplier.entries()).map(([supplierId, bucket]) => ({
    supplierId,
    supplier: bucket.supplier,
    repGroupKeys: Array.from(bucket.repMap.keys()), // পরে representative নাম বসানোর জন্য রাখা হলো
    repMap: bucket.repMap,
    noRepMeds: bucket.noRepMeds,
  }));

  return { supplierGroups, unassigned };
}

// ────────────────────────────────────────────────────────────
// REPRESENTATIVES — শুধু যেসব সরবরাহকারীর গ্রুপে repId লাগবে, তাদেরই ফেচ
// ────────────────────────────────────────────────────────────
async function fetchRepsForSupplierGroups(supplierGroups) {
  const repDataMap = {}; // supplierId -> { repId -> {name, phone} }
  const needed = supplierGroups.filter(g => g.repGroupKeys.length > 0);

  await Promise.all(needed.map(async (g) => {
    const res = await apiGetRepresentatives(g.supplierId);
    repDataMap[g.supplierId] = {};
    if (res.success) {
      res.representatives.forEach(r => { repDataMap[g.supplierId][r.id] = r; });
    }
  }));

  return repDataMap;
}

// ────────────────────────────────────────────────────────────
// MODAL — খোলা + প্রগ্রেসিভ লোড
// ────────────────────────────────────────────────────────────
async function openReorderQuickListModal() {
  document.getElementById('reorder-list-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'reorder-list-modal';
  modal.className = 'fixed inset-0 z-[9995] bg-black/50 flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
      <h4 class="font-bold text-slate-800 dark:text-white mb-1"><i class="fa-solid fa-truck-fast text-brand mr-1"></i> রি-অর্ডার তালিকা</h4>
      <p class="text-xs text-slate-400 mb-2">স্টকশূন্য/স্বল্প-স্টক ওষুধ, সরবরাহকারী অনুযায়ী গ্রুপ করা — প্রতি গ্রুপ কপি করে সরাসরি WhatsApp/SMS-এ পাঠান।</p>
      <div class="reorder-card-actions flex gap-2 mb-4"><button onclick="printReorderReport()" class="btn btn-secondary btn-sm"><i class="fa-solid fa-print mr-1"></i>প্রিন্ট</button><button onclick="downloadReorderCsv()" class="btn btn-secondary btn-sm"><i class="fa-solid fa-download mr-1"></i>CSV</button></div>
      <div id="reorder-list-body">
        <div class="text-center text-slate-400 text-sm py-10"><i class="fa-solid fa-spinner fa-spin mr-2"></i>লোড হচ্ছে...</div>
      </div>
      <button onclick="document.getElementById('reorder-list-modal').remove()" class="btn btn-secondary btn-block mt-4">বন্ধ করুন</button>
    </div>`;
  document.body.appendChild(modal);
  openAppModal('reorder-list-modal', () => document.getElementById('reorder-list-modal')?.remove());

  const candidates = getReorderCandidates();
  if (!candidates.length) {
    renderReorderListEmpty();
    return;
  }

  const { supplierGroups, unassigned } = buildReorderGroups(candidates);
  const repDataMap = await fetchRepsForSupplierGroups(supplierGroups);
  if (!document.getElementById('reorder-list-body')) return; // মডাল ততক্ষণে বন্ধ হয়ে গেলে safe no-op

  renderReorderListBody(supplierGroups, unassigned, repDataMap);
}

function renderReorderListEmpty() {
  const box = document.getElementById('reorder-list-body');
  if (!box) return;
  box.innerHTML = `<div class="text-center text-slate-400 text-sm py-10"><i class="fa-solid fa-circle-check text-2xl opacity-30 mb-2 block"></i>স্টকশূন্য/স্বল্প-স্টক কোনো ওষুধ নেই।</div>`;
}

function renderReorderListBody(supplierGroups, unassigned, repDataMap) {
  const box = document.getElementById('reorder-list-body');
  if (!box) return;

  const supplierBlocks = supplierGroups.map(g => renderSupplierGroupBlock(g, repDataMap[g.supplierId] || {})).join('');
  const unassignedBlock = unassigned.length ? renderUnassignedBlock(unassigned) : '';

  box.innerHTML = (supplierBlocks || unassignedBlock)
    ? `<div class="space-y-4">${supplierBlocks}${unassignedBlock}</div>`
    : renderReorderListEmpty() || '';

  wireReorderCopyButtons();
  wireReorderSendToPurchaseButtons(); // ✅ নতুন
}

// ────────────────────────────────────────────────────────────
// RENDER — সরবরাহকারী-গ্রুপ ব্লক (ভেতরে rep-সাব-গ্রুপ + noRep মেডিসিন)
// ────────────────────────────────────────────────────────────
function renderSupplierGroupBlock(g, reps) {
  const repBlocks = Array.from(g.repMap.entries()).map(([repId, meds]) => {
    const rep = reps[repId];
    return renderMedGroupCard({
      title: rep ? `${g.supplier.name} — ${rep.name}` : `${g.supplier.name} — (প্রতিনিধি মুছে ফেলা হয়েছে)`,
      phone: rep?.phone || g.supplier.phone || '',
      meds,
      groupKey: `sup-${g.supplierId}-rep-${repId}`,
      supplierId: g.supplierId,
    });
  }).join('');

  const noRepBlock = g.noRepMeds.length ? renderMedGroupCard({
    title: g.supplier.name,
    phone: g.supplier.phone || '',
    meds: g.noRepMeds,
    groupKey: `sup-${g.supplierId}-norep`,
    supplierId: g.supplierId,
  }) : '';

  return repBlocks + noRepBlock;
}

function renderUnassignedBlock(meds) {
  const deletedNote = meds.some(m => m.supplierDeleted)
    ? `<p class="text-[11px] text-amber-600 mb-2"><i class="fa-solid fa-triangle-exclamation mr-1"></i>এর মধ্যে কিছু ওষুধের পূর্বনির্ধারিত সরবরাহকারী মুছে ফেলা হয়েছে — Medicine Master-এ গিয়ে নতুন করে নির্ধারণ করুন।</p>`
    : '';
  return `
    <div class="border-2 border-dashed border-amber-300 dark:border-amber-700 rounded-lg p-4">
      <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h5 class="text-sm font-semibold text-amber-700 dark:text-amber-400">
          <i class="fa-solid fa-triangle-exclamation mr-1"></i> সাপ্লায়ার নির্ধারিত নেই (${meds.length} টি)
        </h5>
        <button onclick="document.getElementById('reorder-list-modal').remove(); goTab('medicine');" class="text-xs text-brand hover:underline whitespace-nowrap">
          <i class="fa-solid fa-arrow-right mr-1"></i>Medicine Master-এ গিয়ে নির্ধারণ করুন
        </button>
      </div>
      ${deletedNote}
      <div class="space-y-1">
        ${meds.map(m => renderReorderMedRow(m)).join('')}
      </div>
    </div>`;
}

// ────────────────────────────────────────────────────────────
// RENDER — একটা গ্রুপ কার্ড (সরবরাহকারী/প্রতিনিধি হেডার + মেডিসিন-তালিকা + কপি বাটন)
// ────────────────────────────────────────────────────────────
function renderMedGroupCard({ title, phone, meds, groupKey, supplierId }) {
  // ✅ ফিক্স: DOM থেকে টেক্সট parse করা ভঙ্গুর — badge/স্প্যানের টেক্সট মিশে যেতে
  // পারত। তাই কপি ও ক্রয়ে-পাঠান দুটোই বাটনের data-attribute-এ esc() করা
  // JSON রেখে সরাসরি ডেটা থেকে কাজ করে।
  const medsJson = esc(JSON.stringify(meds.map(m => ({
    medId: m.medId, brand: m.brand, doseForm: m.doseForm, strength: m.strength, status: m.status, totalStock: m.totalStock, reorderLevel: m.reorderLevel,
  }))));
  const sendToPurchaseBtn = supplierId ? `
        <button type="button" class="reorder-send-purchase-btn text-emerald-600 text-xs font-semibold hover:underline whitespace-nowrap"
          data-supplier-id="${esc(supplierId)}" data-meds-json="${medsJson}">
          <i class="fa-solid fa-cart-plus mr-1"></i>ক্রয়ে পাঠান
        </button>` : '';

  return `
    <div class="border border-slate-200 dark:border-slate-600 rounded-lg p-4" data-reorder-group="${esc(groupKey)}">
      <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div>
          <div class="text-sm font-semibold text-slate-800 dark:text-white">${esc(title)}</div>
          ${phone ? `<div class="text-[11px] text-slate-400 font-mono">${esc(phone)}</div>` : ''}
        </div>
        <div class="reorder-card-actions flex items-center gap-3 flex-wrap">
          <button type="button" class="reorder-copy-btn text-brand text-xs font-semibold hover:underline whitespace-nowrap"
            data-title="${esc(title)}" data-meds-json="${medsJson}">
            <i class="fa-solid fa-copy mr-1"></i>কপি করুন (${meds.length} টি)
          </button>
          <button type="button" onclick="openReorderWhatsAppPreview('${esc(groupKey)}','${esc(title)}','${esc(phone)}', this)" class="reorder-whatsapp-btn text-emerald-600 text-xs font-semibold hover:underline whitespace-nowrap"
            data-meds-json="${medsJson}">
            <i class="fa-brands fa-whatsapp mr-1"></i>WhatsApp পাঠান
          </button>
          ${sendToPurchaseBtn}
        </div>
      </div>
      <div class="space-y-1">
        ${meds.map(m => renderReorderMedRow(m)).join('')}
      </div>
    </div>`;
}

function renderReorderMedRow(m) {
  const statusBadge = m.status === 'out'
    ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400">শূন্য</span>`
    : `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">স্বল্প (${formatUnitQuantity(m.totalStock)})</span>`;
  const suggested = Math.max(1, (m.reorderLevel || 10) * 2 - (m.totalStock || 0));
  return `
    <div class="reorder-med-row flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-900/30" data-med-id="${esc(m.medId)}">
      <span class="text-slate-700 dark:text-slate-200 truncate">${esc(m.brand)} ${esc(m.doseForm || '')} ${esc(m.strength || '')}</span>
      <div class="reorder-med-controls flex items-center gap-2">${statusBadge}<label class="whitespace-nowrap">অর্ডার <input type="number" min="1" value="${suggested}" class="reorder-order-qty w-16 border rounded px-1 py-0.5 text-right" data-med-id="${esc(m.medId)}"/>
      </label></div>
    </div>`;
}

// ────────────────────────────────────────────────────────────
// COPY — Bengali টেক্সট বানিয়ে clipboard-এ (contact.js-এর copyToClipboardWithToast reuse)
// ────────────────────────────────────────────────────────────
function sanitizeWhatsAppPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('880')) return digits;
  if (digits.startsWith('0') && digits.length === 11) return '88' + digits;
  return digits;
}

function openReorderWhatsAppPreview(groupKey, title, phone, trigger) {
  const card = trigger?.closest('[data-reorder-group]');
  const meds = parseReorderMedsJson(trigger?.dataset.medsJson);
  if (card) {
    card.querySelectorAll('.reorder-order-qty').forEach(input => {
      const med = meds.find(m => m.medId === input.dataset.medId);
      if (med) med.orderQty = Math.max(1, parseInt(input.value, 10) || 1);
    });
  }
  const representative = title.includes(' — ') ? title.split(' — ').slice(1).join(' — ') : '';
  const lines = meds.map((m, i) => {
    const qty = m.orderQty || Math.max(1, (m.reorderLevel || 10) * 2 - (m.totalStock || 0));
    return `${i + 1}. ${m.brand} ${m.doseForm || ''} ${m.strength || ''} — পরিমাণ: ${qty.toLocaleString('bn-BD')} ইউনিট`;
  });
  const text = `${APP_CONFIG.PLATFORM_NAME}\nBranch: ${branchName(APP_STATE.activeBranchId)}\nতারিখ: ${todayStr()}\nকোম্পানি: ${title.split(' — ')[0] || title}${representative ? `\nপ্রতিনিধি: ${representative}` : ''}\n\nঅর্ডারের তালিকা:\n${lines.join('\n')}\n\nঅনুগ্রহ করে সরবরাহ নিশ্চিত করুন। ধন্যবাদ।`;
  document.getElementById('reorder-whatsapp-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'reorder-whatsapp-modal';
  modal.className = 'fixed inset-0 z-[9996] bg-black/50 flex items-center justify-center p-4';
  modal.innerHTML = `<div class="bg-white dark:bg-slate-800 rounded-xl p-5 max-w-lg w-full">
    <h4 class="font-bold mb-2"><i class="fa-brands fa-whatsapp text-emerald-600 mr-1"></i>WhatsApp অর্ডার Preview</h4>
    <textarea id="reorder-whatsapp-text" class="w-full h-56 border rounded-lg p-3 text-sm mb-3">${esc(text)}</textarea>
    <div class="flex gap-2 flex-wrap"><button onclick="sendReorderWhatsAppNow('${esc(phone)}')" class="btn btn-primary flex-1"><i class="fa-brands fa-whatsapp mr-1"></i>WhatsApp খুলুন</button><button onclick="copyReorderWhatsApp()" class="btn btn-secondary">কপি</button><button onclick="document.getElementById('reorder-whatsapp-modal').remove()" class="btn btn-secondary">বন্ধ</button></div>
  </div>`;
  document.body.appendChild(modal);
  openAppModal('reorder-whatsapp-modal', () => document.getElementById('reorder-whatsapp-modal')?.remove());
}

function sendReorderWhatsAppNow(phone) {
  const text = document.getElementById('reorder-whatsapp-text')?.value || '';
  const cleanPhone = sanitizeWhatsAppPhone(phone);
  const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}

function copyReorderWhatsApp() {
  const text = document.getElementById('reorder-whatsapp-text')?.value || '';
  copyToClipboardWithToast(text, 'WhatsApp অর্ডার মেসেজ');
}

function buildReorderMessageText(title, meds) {
  const lines = meds.map((m, i) =>
    `${i + 1}. ${m.brand} ${m.doseForm || ''} ${m.strength || ''} — ${m.status === 'out' ? 'স্টক শেষ' : `স্টক কম (${formatUnitQuantity(m.totalStock)})`}`
  );
  const pharmacyName = APP_STATE.pharmacyName || 'ফার্মেসি';
  return `${pharmacyName} থেকে রি-অর্ডার অনুরোধ (${title}):\n\n${lines.join('\n')}\n\nঅনুগ্রহ করে সরবরাহের ব্যবস্থা করুন। ধন্যবাদ।`;
}

function wireReorderCopyButtons() {
  document.querySelectorAll('.reorder-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const title = btn.dataset.title || 'রি-অর্ডার';
      const meds = parseReorderMedsJson(btn.dataset.medsJson);
      const text = buildReorderMessageText(title, meds);
      copyToClipboardWithToast(text, `"${title}" রি-অর্ডার তালিকা`);
    });
  });
}

// ✅ নতুন — supplierId + medId-সহ candidate তালিকা APP_STATE.purItems-এ রূপান্তর
// করে সরাসরি Purchase ফর্মে বসায়। কোনো Firestore write না — শুধু ফর্ম pre-fill,
// AI-scan flow-এর (applyAiScannedItemsToPurchaseForm) মতোই human-confirmation gate
// অক্ষত থাকে — "ক্রয় নিশ্চিত করুন" না চাপা পর্যন্ত কিছুই সংরক্ষিত হবে না।
function wireReorderSendToPurchaseButtons() {
  document.querySelectorAll('.reorder-send-purchase-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const supplierId = btn.dataset.supplierId;
      const meds = parseReorderMedsJson(btn.dataset.medsJson);
      sendReorderGroupToPurchase(supplierId, meds);
    });
  });
}

function parseReorderMedsJson(raw) {
  try { return JSON.parse(String(raw || '[]').replace(/&quot;/g, '"').replace(/&amp;/g, '&')); }
  catch (err) { return []; }
}

function getReorderReportRows() {
  return getReorderCandidates().map(m => ({
    company: APP_STATE.suppliers.find(s => s.id === m.preferredSupplierId)?.name || 'কোম্পানি নির্ধারিত নেই',
    representative: m.preferredRepId ? 'প্রতিনিধি ID: ' + m.preferredRepId : 'প্রতিনিধি নির্ধারিত নেই',
    medicine: `${m.brand} ${m.doseForm || ''} ${m.strength || ''}`.trim(),
    stock: formatUnitQuantity(Number(m.totalStock || 0)),
    reorderLevel: m.reorderLevel || getEffectiveReorderLevel(APP_STATE.medicines.find(x => x.id === m.medId)),
  }));
}

function downloadReorderCsv() {
  const rows = getReorderReportRows();
  const data = [['কোম্পানি','প্রতিনিধি','ওষুধ','বর্তমান স্টক','রি-অর্ডার লেভেল'], ...rows.map(r => [r.company,r.representative,r.medicine,r.stock,r.reorderLevel])];
  const csv = '\ufeff' + data.map(row => row.map(v => '"' + String(v ?? '').replace(/"/g,'""') + '"').join(',')).join('\r\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `sohojtech-reorder-${todayStr()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  toast('Ri-অর্ডার CSV ডাউনলোড হয়েছে।', 's');
}

function printReorderReport() {
  const rows = getReorderReportRows();
  const w = window.open('', '_blank');
  w.document.write(`<html><head><meta charset="utf-8"><title>${esc(APP_CONFIG.PLATFORM_NAME)} - রি-অর্ডার</title><style>body{font-family:'Noto Sans Bengali',sans-serif;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px}</style></head><body><h2>${esc(APP_CONFIG.PLATFORM_NAME)} — রি-অর্ডার রিপোর্ট</h2><p>Branch: ${esc(branchName(APP_STATE.activeBranchId))} | Date: ${todayStr()}</p><table><thead><tr><th>কোম্পানি</th><th>প্রতিনিধি</th><th>ওষুধ</th><th>স্টক</th><th>লেভেল</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.company)}</td><td>${esc(r.representative)}</td><td>${esc(r.medicine)}</td><td>${r.stock}</td><td>${r.reorderLevel}</td></tr>`).join('')}</tbody></table></body></html>`);
  w.document.close(); w.print();
}

function sendReorderGroupToPurchase(supplierId, meds) {
  if (!meds.length) return;

  // ✅ Qty-এর একটা সাধারণ default অনুমান — বর্তমান স্টককে reorderLevel-এর
  // দ্বিগুণ পর্যন্ত পূরণ করা। এটা শুধু starting-point, ইউজার নিজে Purchase
  // ফর্মে যাচাই/সংশোধন করবেন — কোনো money-critical জায়গায় ব্যবহৃত হয় না।
  const purItems = meds.map(m => {
    const inv = APP_STATE.inventory.find(x => x.medId === m.medId);
    const med = APP_STATE.medicines.find(x => x.id === m.medId);
    const lastBatch = inv?.batches?.[0];
    const reorderLevel = getEffectiveReorderLevel(med);
    const suggestedQty = Math.max(1, reorderLevel * 2 - (m.totalStock || 0));
    return {
      medId: m.medId, brand: m.brand, doseForm: m.doseForm, strength: m.strength,
      qty: suggestedQty,
      purchasePrice: lastBatch?.cost || 0, mrp: lastBatch?.mrp || 0,
      sellPrice: inv?.sellPrice || 0, expiryDate: '', discountPct: 0, discountAmt: 0,
    };
  });

  // ✅ বিদ্যমান Purchase-ড্রাফট ফাঁকা থাকলে replace, নাহলে যোগ — AI-স্ক্যানের
  // একই কনভেনশন (applyAiScannedItemsToPurchaseForm-এর isDraftEmpty প্যাটার্ন)
  const isDraftEmpty = !APP_STATE.purItems || (APP_STATE.purItems.length === 1 && !APP_STATE.purItems[0].medId && !APP_STATE.purItems[0].aiScanned);
  APP_STATE.purItems = isDraftEmpty ? purItems : APP_STATE.purItems.concat(purItems);
  APP_STATE.purSupplierId = supplierId;

  document.getElementById('reorder-list-modal')?.remove();
  goTab('purchase'); // renderPurchaseModule() → initPurSupplierDropdown() স্বয়ংক্রিয়ভাবে supplierId pre-select করবে
  toast(`${meds.length} টি ওষুধ ক্রয়-ফর্মে বসানো হয়েছে — পরিমাণ/দাম যাচাই করে "ক্রয় নিশ্চিত করুন" চাপুন। চাইলে "খসড়া সংরক্ষণ করুন" দিয়ে পরে চালিয়ে যেতে পারেন।`, 's');
}
