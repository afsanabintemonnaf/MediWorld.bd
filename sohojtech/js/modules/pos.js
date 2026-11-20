'use strict';

// ✅ ফিক্স: শুধু Date.now() না — একই মিলিসেকেন্ডে দুই ডিভাইস/ট্যাব থেকে sale
// এলে ID কলিশনের ঝুঁকি ছিল (Firestore rule saleId==invoiceNo চেক করে, duplicate
// হলে silently ওভাররাইট/reject হতে পারত)
function genInvoiceNo() {
  return 'INV-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}
// ════════════════════════════════════════════════════════════
// POS / SALES MODULE
// ════════════════════════════════════════════════════════════
// ✅ Cash/Due Split বাগ ফিক্স: cashPaid ও due এখন Sale-লেভেলে।
// ✅ Keyboard flow: Enter = আইটেম যোগ, Ctrl+Enter = চেকআউট।
// ✅ Firestore রিওয়্যার: submitPOSSale() এখন apiSubmitSale() কল করে,
//    সফল হলেই APP_STATE-এ optimistic আপডেট হয় (আগে উল্টো ছিল)।
// ✅ Tab-switch persistence: গ্রাহক, তারিখ, নগদ ও আইটেম এখন APP_STATE-এ
//    ধরে রাখা হয়, tab পাল্টালে হারায় না।
// ✅ Medicine disambiguation: এখন multiple match হলে resolveMedicineMatch()
//    দিয়ে ambiguous কেস ধরা হয় এবং showMedDisambiguation() দিয়ে ইউজারকে
//    নির্দিষ্ট মেডিসিন বেছে নিতে দেওয়া হয়।
// ════════════════════════════════════════════════════════════

function renderPOSModule() {
  const container = document.getElementById('pos-content');
  if (!container) return;

  const offlineBanner = !navigator.onLine
    ? `<div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs rounded-lg px-3 py-2 mb-3">
        <i class="fa-solid fa-triangle-exclamation mr-1"></i> অফলাইন: স্টক সর্বশেষ সিঙ্কের তথ্য। বিক্রয় স্থানীয় কিউতে সংরক্ষিত হবে; নেট ফিরলেই স্বয়ংক্রিয় সিঙ্ক হবে।
      </div>` : '';

  container.innerHTML = `
    ${offlineBanner}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="lg:col-span-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
        <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h5 class="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <i class="fa-solid fa-file-invoice text-brand"></i> নতুন বিক্রয় বিল
          </h5>
          <div class="flex items-center gap-3 flex-wrap">
            <button onclick="openPOSPrescriptionQuickMatch()" class="text-xs text-brand hover:underline flex items-center gap-1">
              <i class="fa-solid fa-prescription-bottle-medical"></i> প্রেসক্রিপশন কুইক-ম্যাচ
            </button>
            <button onclick="savePOSCartAsDraft()" class="text-xs text-brand hover:underline flex items-center gap-1">
              <i class="fa-solid fa-bookmark"></i> কার্ট সংরক্ষণ করুন
            </button>
            <button onclick="openPOSDraftsModal()" class="text-xs text-slate-500 hover:underline flex items-center gap-1">
              <i class="fa-solid fa-layer-group"></i> <span id="pos-drafts-count">ড্রাফট (0)</span>
            </button>
            <button onclick="resetPOS()" class="text-xs text-red-600 hover:underline flex items-center gap-1">
              <i class="fa-solid fa-rotate-left"></i> রিসেট
            </button>
          </div>
        </div>

        <div id="pos-error" class="hidden bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-3 py-2 mb-3"></div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">গ্রাহক <span class="text-red-500">*</span></label>
            <div id="sd-pos-customer"></div>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">তারিখ</label>
            <input type="date" id="pos-date" onchange="APP_STATE.posDate=this.value" class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand"/>
          </div>
        </div>

        <div id="pos-items-list" class="space-y-2 mb-3"></div>

        <button onclick="addPOSItem()" class="btn btn-brand-outline btn-sm mb-4">
          <i class="fa-solid fa-plus"></i> ওষুধ যোগ করুন
        </button>

        <div class="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-600 rounded-lg p-3 mb-4">
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs font-semibold text-slate-600 dark:text-slate-300"><i class="fa-solid fa-tags text-brand mr-1"></i> সামগ্রিক (গ্রস) ছাড়</label>
            <span id="pos-grossdisc-note" class="text-[10px] text-slate-400"></span>
          </div>
          <p class="text-[11px] text-slate-400 mb-2">শুধু যেসব আইটেমে ইনলাইন ছাড় নেই, সেগুলোতেই প্রযোজ্য — অনুপাতে বণ্টিত হবে।</p>
          <div class="flex gap-2">
            <div class="flex-1">
              <label class="block text-[10px] text-slate-400 mb-1">ছাড় %</label>
              <input type="number" id="pos-grossdisc-pct" value="0" min="0" max="100" step="0.01" oninput="onPOSGrossDiscPctChange()"
                class="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-white"/>
            </div>
            <div class="flex-1">
              <label class="block text-[10px] text-slate-400 mb-1">ছাড় (৳)</label>
              <input type="number" id="pos-grossdisc-amt" value="0" min="0" step="0.01" oninput="onPOSGrossDiscAmtChange()"
                class="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-white"/>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">মোট (৳)</label>
            <input type="text" id="pos-total" readonly class="w-full px-3 py-2 text-sm font-mono font-bold bg-brand/10 text-brand border border-brand/30 rounded-lg"/>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">গ্রাহক টেন্ডার (৳)</label>
            <input type="number" id="pos-cash" min="0" placeholder="০" oninput="onPOSCashChange()"
              class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand"/>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">নেট নগদ প্রযোজ্য (৳)</label>
            <input type="text" id="pos-net-cash" readonly class="w-full px-3 py-2 text-sm font-mono font-bold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 border border-emerald-200 dark:border-emerald-800 rounded-lg"/>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-500 uppercase mb-1">বাকি (৳)</label>
            <input type="text" id="pos-due" readonly class="w-full px-3 py-2 text-sm font-mono font-bold bg-red-50 dark:bg-red-900/20 text-red-600 border border-red-200 dark:border-red-800 rounded-lg"/>
          </div>
        </div>
        <div id="pos-payment-status" class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
          <div id="pos-status-due" class="hidden rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"><span>বাকি</span><strong id="pos-status-due-amt" class="float-right font-mono">৳0.00</strong></div>
          <div id="pos-status-paid" class="hidden rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"><span>পরিশোধিত</span><strong class="float-right font-mono">৳0.00</strong></div>
          <div id="pos-status-change" class="hidden rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700"><span>গ্রাহককে ফেরত</span><strong id="pos-change" class="float-right font-mono">৳0.00</strong></div>
        </div>

        <button onclick="submitPOSSale()" id="pos-submit-btn" class="btn btn-primary btn-block">
          <i class="fa-solid fa-circle-check"></i> বিক্রয় নিশ্চিত করুন
          <span class="text-[11px] font-normal opacity-70 hidden sm:inline">(Ctrl+Enter)</span>
        </button>
      </div>

      <div class="space-y-4">
        <div class="bg-[#0D1B2A] rounded-xl p-5 text-white">
          <h6 class="text-[11px] uppercase tracking-wider text-white/40 mb-3">বিল সারসংক্ষেপ</h6>
          <div class="flex justify-between text-sm py-1.5 border-b border-white/10"><span class="text-white/70">মোট ওষুধ মূল্য</span><span id="bs-med" class="font-mono">৳০.০০</span></div>
          <div class="flex justify-between text-sm py-1.5 border-b border-white/10"><span class="text-white/70">ডিসকাউন্ট</span><span id="bs-disc" class="font-mono">৳০.০০</span></div>
          <div class="flex justify-between items-center py-2 border-b border-white/10"><span class="font-semibold">মোট দেয়</span><span id="bs-total" class="font-mono font-bold text-lg text-[#5AB4FF]">৳০.০০</span></div>
          <div class="flex justify-between text-sm py-1.5"><span class="text-white/70">নগদ</span><span id="bs-cash" class="font-mono">৳০.০০</span></div>
          <div class="flex justify-between text-sm py-1.5"><span class="text-white/70">বাকি</span><span id="bs-due" class="font-mono text-red-300">৳০.০০</span></div>
        </div>

        <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
            <h6 class="text-sm font-semibold text-slate-700 dark:text-slate-200"><i class="fa-solid fa-clock-rotate-left text-brand mr-1"></i> বিক্রয় তালিকা</h6>
            <input type="date" id="pos-list-date" value="${APP_STATE.posListDate || todayStr()}" onchange="onPOSListDateChange(this.value)"
              class="px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-white"/>
          </div>
          <div id="pos-today-sales" class="max-h-72 overflow-y-auto"></div>
        </div>
      </div>
    </div>
  `;

  initPOSCustomerDropdown();
  document.getElementById('pos-date').value = APP_STATE.posDate || todayStr();
  if (!APP_STATE.posItems || !APP_STATE.posItems.length) { APP_STATE.posItems = []; addPOSItem(); }
  else { renderPOSItems(); }
  if (APP_STATE.posCashPaid !== null && APP_STATE.posCashPaid !== undefined) {
    document.getElementById('pos-cash').value = APP_STATE.posCashPaid;
  }
  calcPOSTotals();
  renderTodayPOSSales();
  renderPOSDraftBadge(); // ✅ নতুন — কার্ট-ড্রাফট সংখ্যা

  setTimeout(() => focusMedicineInput(0), 50);
}

// ────────────────────────────────────────────────────────────
// CUSTOMER DROPDOWN
// ────────────────────────────────────────────────────────────
function initPOSCustomerDropdown() {
  const opts = [{ value: 'WALK_IN', label: 'নগদ গ্রাহক (Walk-In)', sub: 'কোনো নিবন্ধন নেই' }];
  APP_STATE.customers.forEach(c => opts.push({
    value: c.id, label: c.name,
    sub: (c.phone || '') + (c.due > 0 ? ` • বাকি: ৳${fmt(c.due)}` : ''),
    badge: c.due > 0 ? `৳${fmt(c.due)}` : null, badgeClass: 'bg-red-50 text-red-600',
  }));
  createSD('sd-pos-customer', opts, (v) => { APP_STATE.posCustomerId = v; }, '— গ্রাহক খুঁজুন —');
  let selectedId = APP_STATE.posCustomerId || 'WALK_IN';
  let matchedOpt = opts.find(o => o.value === selectedId);
  if (!matchedOpt) { selectedId = 'WALK_IN'; matchedOpt = opts[0]; }
  APP_STATE.posCustomerId = selectedId;
  sdSelect('sd-pos-customer', matchedOpt.value, matchedOpt.label);
}

// ────────────────────────────────────────────────────────────
// ITEM ROWS
// ────────────────────────────────────────────────────────────
function addPOSItem() {
  APP_STATE.posItems.push({ medId: '', name: '', qty: 1, price: 0, costPrice: 0, discountPct: 0, discountAmt: 0 });
  renderPOSItems();
}

function removePOSItem(i) {
  if (APP_STATE.posItems.length <= 1) { toast('কমপক্ষে একটি সারি থাকতে হবে।', 'w'); return; }
  closeMedDisambiguation();
  APP_STATE.posItems.splice(i, 1);
  renderPOSItems();
  calcPOSTotals();
}

function renderPOSItems() {
  const container = document.getElementById('pos-items-list');
  if (!container) return;
  const stockedMeds = APP_STATE.inventory.filter(m => m.totalStock > 0);

  container.innerHTML = APP_STATE.posItems.map((item, i) => {
    const currentMed = APP_STATE.inventory.find(m => m.medId === item.medId);
    const displayVal = currentMed ? buildMedDisplayText(currentMed) : '';
    const gross = round2((item.qty || 0) * (item.price || 0));
    const discountRow = `
      <div class="pos-discount-row col-span-12 flex flex-wrap items-end gap-2 mt-1 pt-2 border-t border-dashed border-slate-200 dark:border-slate-600">
        <div class="w-20">
          <label class="block text-[10px] text-slate-400 mb-1">ছাড় %</label>
          <input type="number" id="pos-discpct-${i}" value="${item.discountPct || 0}" min="0" max="100" step="0.01"
            oninput="onPOSDiscountPctChange(${i})" onblur="onPOSDiscountBlur(${i})"
            class="w-full px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-white"/>
        </div>
        <div class="w-24">
          <label class="block text-[10px] text-slate-400 mb-1">ছাড় (৳)</label>
          <input type="number" id="pos-discamt-${i}" value="${item.discountAmt || 0}" min="0" step="0.01"
            oninput="onPOSDiscountAmtChange(${i})" onblur="onPOSDiscountBlur(${i})"
            class="w-full px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-white"/>
        </div>
        ${item.discountAmt > 0 ? `<div class="text-[11px] text-slate-400 ml-auto self-center">গ্রস ৳${fmt(gross)}</div>` : ''}
      </div>`;
    return `
    <div class="pos-item-card border border-slate-200 dark:border-slate-600 rounded-lg p-3 relative bg-slate-50 dark:bg-slate-900/30">
      <button onclick="removePOSItem(${i})" class="absolute top-2 right-2 text-slate-400 hover:text-red-500">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="pos-item-grid grid gap-2">
        <div class="pos-med-field">
          <label class="block text-[11px] text-slate-400 mb-1">ওষুধ <span class="text-red-500">*</span></label>
          <input type="text" id="pos-med-input-${i}" list="pos-med-list-${i}" value="${esc(displayVal)}"
            placeholder="— স্ক্যান করুন বা টাইপ করুন —" autocomplete="off"
            onchange="onPOSMedicineChange(${i})"
            onkeydown="onPOSMedicineKeydown(event, ${i})"
            class="w-full px-2.5 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand"/>
          <datalist id="pos-med-list-${i}">
            ${stockedMeds.map(m => `<option value="${esc(buildMedDisplayText(m))}"></option>`).join('')}
          </datalist>
        </div>
        <div class="pos-qty-field">
          <label class="block text-[11px] text-slate-400 mb-1">Qty</label>
          <input type="number" id="pos-qty-${i}" value="${item.qty}" min="1"
            onkeydown="onPOSFieldKeydown(event, ${i})" oninput="onPOSFieldChange(${i})" onblur="onPOSFieldBlur(${i})"
            class="w-full px-2.5 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand"/>
        </div>
        <div class="pos-price-field">
          <label class="block text-[11px] text-slate-400 mb-1">মূল্য (৳)</label>
          <input type="number" id="pos-price-${i}" value="${item.price}" min="0" step="0.01"
            onkeydown="onPOSFieldKeydown(event, ${i})" oninput="onPOSFieldChange(${i})" onblur="onPOSFieldBlur(${i})"
            class="w-full px-2.5 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand"/>
        </div>
        <div class="pos-total-field flex flex-col justify-end">
          <label class="block text-[11px] text-slate-400 mb-1">লাইন টোটাল</label>
          <div id="pos-linetotal-${i}" class="pos-line-total px-2.5 py-1.5 text-sm font-mono font-bold text-brand whitespace-nowrap tabular-nums text-right">৳০.০০</div>
        </div>
        ${discountRow}
      </div>
    </div>`;
  }).join('');

  APP_STATE.posItems.forEach((_, i) => updateLineTotal(i));
}

function buildMedDisplayText(m) {
  return `${m.brand} ${m.doseForm || ''} ${m.strength || ''} [স্টক:${formatUnitQuantity(m.totalStock)}]`.trim();
}

// ────────────────────────────────────────────────────────────
// PRESCRIPTION QUICK-MATCH
// ────────────────────────────────────────────────────────────
let posPrescriptionImageBase64 = '';
let posPrescriptionCandidates = [];
let posPrescriptionExtracted = [];

function openPOSPrescriptionQuickMatch() {
  document.getElementById('pos-prescription-modal')?.remove();
  posPrescriptionImageBase64 = '';
  posPrescriptionCandidates = [];
  posPrescriptionExtracted = [];

  const modal = document.createElement('div');
  modal.id = 'pos-prescription-modal';
  modal.className = 'fixed inset-0 z-[9996] bg-black/60 flex items-center justify-center p-2 sm:p-4';
  modal.innerHTML = `
    <div class="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-5xl w-full max-h-[94vh] overflow-y-auto">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 class="text-base font-bold text-slate-800 dark:text-white"><i class="fa-solid fa-prescription-bottle-medical text-brand mr-2"></i>প্রেসক্রিপশন কুইক-ম্যাচ</h3>
          <p class="text-[11px] text-slate-400 mt-1">সাজেশন কেবলমাত্র সাহায্য — কার্টে যোগের আগে ক্যাশিয়ার নিজে যাচাই করবেন।</p>
        </div>
        <button onclick="closeAppModal()" class="text-slate-400 hover:text-red-500" aria-label="বন্ধ করুন"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <label class="block text-xs font-semibold text-slate-500 mb-1">প্রেসক্রিপশন টেক্সট পেস্ট করুন</label>
          <textarea id="pos-prescription-text" rows="6" placeholder="Napa 500mg&#10;Azithromycin 250mg&#10;Omeprazole 20mg"
            class="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand"></textarea>
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-500 mb-1">প্রেসক্রিপশন ছবি (ঐচ্ছিক)</label>
          <div class="grid grid-cols-2 gap-2">
            <input id="pos-prescription-image-file" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" onchange="onPOSPrescriptionImageSelected(event)"/>
            <label for="pos-prescription-image-file" class="btn btn-secondary btn-sm cursor-pointer text-center"><i class="fa-solid fa-folder-open mr-1"></i> সংরক্ষিত ছবি</label>
            <input id="pos-prescription-image-camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" class="hidden" onchange="onPOSPrescriptionImageSelected(event)"/>
            <label for="pos-prescription-image-camera" onclick="document.getElementById('pos-prescription-status').textContent='ক্যামেরা অনুমতি চাইলে Allow দিন; ক্যামেরা না থাকলে সংরক্ষিত ছবি বা ম্যানুয়াল টেক্সট ব্যবহার করুন।';document.getElementById('pos-prescription-status').className='text-xs mt-2 text-slate-500';document.getElementById('pos-prescription-status').classList.remove('hidden')" class="btn btn-brand-outline btn-sm cursor-pointer text-center"><i class="fa-solid fa-camera mr-1"></i> সরাসরি ক্যামেরা</label>
          </div>
          <div id="pos-prescription-image-preview" class="hidden mt-2">
            <img id="pos-prescription-preview-img" alt="Prescription preview" class="h-32 w-full object-contain rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900"/>
          </div>
          <div id="pos-prescription-status" class="hidden text-xs mt-2"></div>
        </div>
      </div>

      <button id="pos-prescription-match-btn" onclick="runPOSPrescriptionMatch()" class="btn btn-primary btn-sm mb-4">
        <i class="fa-solid fa-magnifying-glass"></i> ইনভেন্টরি-ম্যাচ করুন
      </button>

      <div id="pos-prescription-candidates" class="space-y-2"></div>

      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
        <button onclick="closeAppModal()" class="btn btn-secondary">বাতিল</button>
        <button onclick="confirmPOSPrescriptionSelection()" class="btn btn-primary"><i class="fa-solid fa-cart-plus mr-1"></i> নির্বাচিত যোগ করুন</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  openAppModal('pos-prescription-modal', closePOSPrescriptionQuickMatch);
}

function closePOSPrescriptionQuickMatch() {
  document.getElementById('pos-prescription-modal')?.remove();
  posPrescriptionImageBase64 = '';
  posPrescriptionCandidates = [];
  posPrescriptionExtracted = [];
}

function compressPOSPrescriptionImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('শুধু ছবি ফাইল নির্বাচন করুন।'));
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      reject(new Error('ছবির সাইজ 15 MB-এর কম হতে হবে।'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1600;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => reject(new Error('ছবি পড়া যায়নি।'));
      img.src = event.target.result;
    };
    reader.onerror = () => reject(new Error('ছবি ফাইল পড়তে ব্যর্থ।'));
    reader.readAsDataURL(file);
  });
}

async function onPOSPrescriptionImageSelected(event) {
  const file = event.target.files?.[0];
  const status = document.getElementById('pos-prescription-status');
  if (!file) {
    posPrescriptionImageBase64 = '';
    status.textContent = 'ক্যামেরা ফাইল নির্বাচন বাতিল হয়েছে। সংরক্ষিত ছবি বা ম্যানুয়াল টেক্সট ব্যবহার করুন।';
    status.className = 'text-xs mt-2 text-amber-700';
    status.classList.remove('hidden');
    return;
  }
  try {
    posPrescriptionImageBase64 = await compressPOSPrescriptionImage(file);
    const preview = document.getElementById('pos-prescription-image-preview');
    preview.classList.remove('hidden');
    document.getElementById('pos-prescription-preview-img').src = posPrescriptionImageBase64;
    status.textContent = 'ছবি প্রস্তুত। ম্যাচ ক্লিক করলে স্ক্যান করা হবে।';
    status.className = 'text-xs mt-2 text-slate-500';
    status.classList.remove('hidden');
  } catch (err) {
    posPrescriptionImageBase64 = '';
    status.textContent = err.message;
    status.className = 'text-xs mt-2 text-red-600';
    status.classList.remove('hidden');
  }
}

function normalizePOSPrescriptionText(text) {
  return String(text || '')
    .replace(/[০-৯]/g, d => '০১২৩৪৫৬৭৮৯'.indexOf(d))
    .replace(/\b(mg|mcg|ml|g|tab|tabs|tablet|capsule|syrup|suspension)\b/gi, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractPOSPrescriptionTerms(text) {
  const rawLines = String(text || '')
    .split(/\n|[,;|]+/)
    .map(s => s.replace(/^(rx|আরx|ডোজ|dose)\s*:?\s*/i, '').replace(/\b(\d+\s*(mg|mcg|ml|g)\b.*)$/i, '$1').trim())
    .filter(s => s && s.length >= 2);
  if (rawLines.length) return rawLines;
  return [String(text || '').trim()].filter(Boolean);
}

function buildPOSPrescriptionCandidate(inv, med) {
  return {
    medId: inv?.medId || med?.id,
    brand: inv?.brand || med?.brand || '',
    generic: med?.generic || '',
    doseForm: inv?.doseForm || med?.doseForm || '',
    strength: inv?.strength || med?.strength || '',
    totalStock: inv ? Number(inv.totalStock || 0) : 0,
    sellPrice: inv?.sellPrice || 0,
    nearestExpiry: inv?.nearestExpiry || '',
    inv,
  };
}

function getPOSPrescriptionCandidates() {
  const invIds = new Set();
  const candidates = [];
  (APP_STATE.inventory || []).forEach(inv => {
    invIds.add(inv.medId);
    const med = (APP_STATE.medicines || []).find(m => m.id === inv.medId);
    candidates.push(buildPOSPrescriptionCandidate(inv, med));
  });
  (APP_STATE.medicines || []).forEach(med => {
    if (!invIds.has(med.id)) candidates.push(buildPOSPrescriptionCandidate(null, med));
  });
  return candidates;
}

function scorePOSPrescriptionCandidate(candidate, term) {
  const q = normalizePOSPrescriptionText(term);
  if (!q) return 0;
  const brand = normalizePOSPrescriptionText(candidate.brand);
  const generic = normalizePOSPrescriptionText(candidate.generic);
  const form = normalizePOSPrescriptionText(candidate.doseForm);
  const strength = normalizePOSPrescriptionText(candidate.strength);
  let score = 0;
  if (brand === q || generic === q) score += 100;
  if (brand.includes(q) || q.includes(brand)) score += 45;
  if (generic && (generic.includes(q) || q.includes(generic))) score += 35;
  q.split(/[^a-z0-9\u0980-\u09ff]+/).filter(t => t.length >= 3).forEach(token => {
    if (brand.includes(token)) score += 12;
    if (generic.includes(token)) score += 10;
  });
  if (strength && q.includes(strength.replace(/\s+/g, ''))) score += 20;
  if (form && q.includes(form)) score += 12;
  return score;
}

function verifyPrescriptionItemAgainstInventory(extracted, state) {
  extracted = extracted || {};
  state = state || APP_STATE;
  const term = [extracted.possibleName, extracted.brand, extracted.generic, extracted.strength]
    .filter(Boolean).join(' ');
  const candidates = [];
  (state.inventory || []).forEach(inv => {
    const med = (state.medicines || []).find(m => m.id === inv.medId);
    candidates.push(buildPOSPrescriptionCandidate(inv, med));
  });
  (state.medicines || []).forEach(med => {
    if (!(state.inventory || []).some(inv => inv.medId === med.id)) {
      candidates.push(buildPOSPrescriptionCandidate(null, med));
    }
  });
  const scored = candidates.map(candidate => ({
    candidate,
    score: scorePOSPrescriptionCandidate(candidate, term),
  })).filter(row => row.score >= 12).sort((a, b) => b.score - a.score);
  if (!scored.length) return { status: 'unmatched', term, message: 'স্থানীয় ইনভেন্টরিতে মিল নেই।' };

  const best = scored[0];
  const second = scored[1];
  const ambiguous = best.score < 45 || (second && second.score >= 45 && best.score - second.score < 12);
  if (ambiguous) return {
    status: 'ambiguous',
    term,
    candidate: best.candidate,
    score: best.score,
    alternatives: scored.slice(0, 3).map(row => row.candidate),
    message: 'একাধিক সম্ভাবনা বা অস্পষ্ট মিল—ফার্মাসিস্টকে ছবি দেখে নিশ্চিত করতে হবে।',
  };

  const inv = best.candidate.inv;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const liveBatches = inv ? (inv.batches || []).filter(batch => {
    const expiry = typeof parseExpiryDate === 'function' ? parseExpiryDate(batch.expiry) : null;
    return Number(batch.stock || 0) > 0 && (!expiry || expiry >= now);
  }).sort((a, b) => String(a.expiry || '').localeCompare(String(b.expiry || ''))) : [];
  const stock = inv ? liveBatches.reduce((sum, batch) => sum + Number(batch.stock || 0), 0) : 0;
  if (stock <= 0) return {
    status: 'unavailable',
    term,
    candidate: best.candidate,
    score: best.score,
    stock: 0,
    message: 'মিল পাওয়া গেছে, কিন্তু live FEFO ব্যাচে স্টক নেই বা ব্যাচ মেয়াদউত্তীর্ণ।',
  };
  return {
    status: 'verified',
    term,
    candidate: best.candidate,
    score: best.score,
    stock,
    sellPrice: Number(best.candidate.sellPrice || 0),
    nearestLiveExpiry: liveBatches[0]?.expiry || '',
    liveBatches,
  };
}

function renderPOSPrescriptionCandidates(terms) {
  const box = document.getElementById('pos-prescription-candidates');
  if (!box) return;
  const all = getPOSPrescriptionCandidates();
  posPrescriptionCandidates = [];

  terms.forEach((term, termIndex) => {
    const scored = all.map(candidate => ({
      candidate,
      score: scorePOSPrescriptionCandidate(candidate, term),
    })).filter(row => row.score >= 12).sort((a, b) =>
      b.score - a.score || b.candidate.totalStock - a.candidate.totalStock
    ).slice(0, 5);

    if (!scored.length) {
      posPrescriptionCandidates.push({ term, candidate: null, score: 0 });
      box.insertAdjacentHTML('beforeend', `
        <div class="border border-amber-200 dark:border-amber-800 rounded-lg p-3 bg-amber-50 dark:bg-amber-900/20">
          <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">${esc(term)}</div>
          <div class="text-xs text-amber-700 dark:text-amber-400 mt-1">ইনভেন্টরি/ক্যাটালগে মিল পাওয়া যায়নি। ম্যানুয়ালি নাম যাচাই করুন।</div>
        </div>`);
      return;
    }

    scored.forEach((row, candidateIndex) => {
      const candidate = row.candidate;
      const index = posPrescriptionCandidates.push({ term, candidate, score: row.score }) - 1;
      const expiry = candidate.nearestExpiry;
      let expiryWarning = '';
      if (expiry) {
        const expiryDate = parseExpiryDate(expiry);
        const days = expiryDate ? Math.ceil((expiryDate - new Date()) / 86400000) : null;
        if (days !== null && days <= 0) expiryWarning = '<span class="text-red-600 font-semibold">মেয়াদ উত্তীর্ণ</span>';
        else if (days !== null && days <= 30) expiryWarning = `<span class="text-red-600">মেয়াদ খুব কাছাকাছি (${expiry})</span>`;
        else if (days !== null && days <= (APP_STATE.expiryAlertDays || 90)) expiryWarning = `<span class="text-amber-600">মেয়াদ সতর্কতা (${expiry})</span>`;
      }
      const stockWarning = candidate.totalStock <= 0
        ? '<span class="text-red-600 font-semibold">স্টক নেই</span>'
        : candidate.totalStock <= (APP_STATE.lowStockLevel || 10)
          ? `<span class="text-amber-600">কম স্টক: ${candidate.totalStock}</span>`
          : `<span class="text-emerald-600">স্টক: ${candidate.totalStock}</span>`;

      box.insertAdjacentHTML('beforeend', `
        <label class="flex items-start gap-3 border ${candidateIndex === 0 ? 'border-brand/50' : 'border-slate-200 dark:border-slate-700'} rounded-lg p-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer">
          <input type="checkbox" id="pos-prescription-selected-${index}" class="mt-1"/>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm text-slate-800 dark:text-white">${esc(candidate.brand)} <span class="font-normal text-slate-500">${esc(candidate.doseForm || '')} ${esc(candidate.strength || '')}</span></div>
            ${candidate.generic ? `<div class="text-[11px] text-slate-400">জেনেরিক: ${esc(candidate.generic)}</div>` : ''}
            <div class="text-xs mt-1 flex flex-wrap gap-x-3 gap-y-1">
              ${stockWarning}
              <span class="text-slate-600 dark:text-slate-300">দাম: ৳${fmt(candidate.sellPrice || 0)}</span>
              ${expiryWarning || (expiry ? `<span class="text-slate-500">মেয়াদ: ${esc(expiry)}</span>` : '<span class="text-slate-400">মেয়াদ: অজানা</span>')}
            </div>
          </div>
          <div class="w-20">
            <label class="block text-[10px] text-slate-400 mb-1">Qty</label>
            <input type="number" id="pos-prescription-qty-${index}" value="1" min="1" step="1"
              class="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700"/>
          </div>
        </label>`);
    });
  });
}

async function runPOSPrescriptionMatch() {
  if (!navigator.onLine) {
    document.getElementById('pos-prescription-status').className = 'text-xs mt-2 text-amber-700';
    document.getElementById('pos-prescription-status').textContent = 'আপনি অফলাইনে; পেস্ট করা টেক্সট দিয়ে লোকাল ম্যাচ করা হচ্ছে।';
    document.getElementById('pos-prescription-status').classList.remove('hidden');
  }

  const text = document.getElementById('pos-prescription-text')?.value || '';
  let terms = extractPOSPrescriptionTerms(text);
  const status = document.getElementById('pos-prescription-status');

  if (posPrescriptionImageBase64) {
    if (!navigator.onLine) {
      status.textContent = 'অফলাইন: ছবি স্ক্যান করা যাবে না; পেস্ট করা টেক্সট বা ম্যানুয়াল ম্যাচ ব্যবহার করুন।';
      status.className = 'text-xs mt-2 text-amber-700';
      status.classList.remove('hidden');
    } else {
      const btn = document.getElementById('pos-prescription-match-btn');
      const idle = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ছবি স্ক্যান হচ্ছে...';
      try {
        const result = await callAiTask('prescriptionAssist', { imageBase64: posPrescriptionImageBase64.replace(/^data:image\/[^;]+;base64,/, '') });
        const suggestions = result?.data?.suggestions || [];
        posPrescriptionExtracted = suggestions.map(s => ({
          possibleName: s.possibleName || s.brand || s.generic || s.rawText || '',
          brand: s.brand || '',
          generic: s.generic || '',
          strength: s.strength || '',
          doseForm: s.doseForm || '',
          frequencySig: s.frequencySig || s.frequency || '',
          duration: s.duration || '',
          quantity: s.quantity || null,
          confidence: s.confidence || 'low',
          unclear: s.unclear === true || s.confidence === 'low',
          rawText: s.rawText || '',
        })).filter(item => item.possibleName);
        const aiTerms = posPrescriptionExtracted.map(s =>
          [s.possibleName, s.brand, s.generic, s.strength, s.doseForm].filter(Boolean).join(' ').trim()
        ).filter(Boolean);
        if (aiTerms.length) terms = Array.from(new Set(terms.concat(aiTerms)));
        const note = result?.data?.patientNotes || result?.data?.doctorNotes;
        status.textContent = aiTerms.length
          ? `ছবি স্ক্যান হয়েছে — AI সাজেশন অনিশ্চিত; ফার্মাসিস্ট ছবি দেখে নিজে যাচাই করুন।${note ? ' রোগী/ডাক্তার নোট আছে।' : ''}`
          : 'স্ক্যান হয়েছে, কিন্তু নির্দিষ্ট ওষুধের নাম পাওয়া যায়নি।';
        status.className = 'text-xs mt-2 text-slate-500';
        status.classList.remove('hidden');
      } catch (err) {
        status.textContent = 'স্ক্যান/প্রক্সি ব্যর্থ: ' + err.message + ' — পেস্ট করা টেক্সট বা ম্যানুয়াল পদ্ধতি ব্যবহার করুন।';
        status.className = 'text-xs mt-2 text-red-600';
        status.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.innerHTML = idle;
      }
    }
  }

  if (!terms.length) {
    toast('টেক্সট লিখুন অথবা প্রেসক্রিপশন ছবি নির্বাচন করুন।', 'w');
    return;
  }
  const box = document.getElementById('pos-prescription-candidates');
  box.innerHTML = '';
  if (posPrescriptionExtracted.length) {
    box.insertAdjacentHTML('beforeend', posPrescriptionExtracted.map((item, index) => `
      <div class="border ${item.unclear ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20' : 'border-slate-200 dark:border-slate-700'} rounded-lg p-3">
        <div class="flex justify-between gap-2">
          <div class="text-sm font-semibold">${esc(item.possibleName)} ${esc(item.strength)}</div>
          <span class="text-[10px] ${item.unclear ? 'text-amber-700' : 'text-emerald-600'}">${item.unclear ? 'স্পষ্ট নয়—ফার্মাসিস্ট যাচাই' : 'যাচাইযোগ্য পাঠ'}</span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-[11px] text-slate-500">
          <span>ফরম: ${esc(item.doseForm || '—')}</span>
          <span>Frequency: ${esc(item.frequencySig || '—')}</span>
          <span>Duration: ${esc(item.duration || '—')}</span>
          <span>Quantity: ${esc(item.quantity == null ? '—' : String(item.quantity))}</span>
        </div>
        ${item.rawText ? `<div class="text-[10px] text-slate-400 mt-1">মূল লেখা: ${esc(item.rawText)}</div>` : ''}
      </div>`).join(''));
  }
  renderPOSPrescriptionCandidates(Array.from(new Set(terms.map(t => t.trim()).filter(Boolean))));
}

function confirmPOSPrescriptionSelection() {
  let added = 0;
  posPrescriptionCandidates.forEach((row, index) => {
    const checkbox = document.getElementById(`pos-prescription-selected-${index}`);
    if (!checkbox?.checked || !row.candidate) return;
    if (row.score < 45) {
      toast(`${row.term}: অস্পষ্ট মিল। ছবি দেখে হাতে নির্বাচন/কনফার্ম করুন।`, 'w');
      return;
    }
    const inv = row.candidate.inv;
    if (!inv || inv.totalStock <= 0) {
      toast(`${row.candidate.brand}: বর্তমান শাখায় স্টক নেই।`, 'w');
      return;
    }
    const liveFefoBatch = (inv.batches || []).filter(batch => {
      const expiry = typeof parseExpiryDate === 'function' ? parseExpiryDate(batch.expiry) : null;
      return Number(batch.stock || 0) > 0 && (!expiry || expiry >= new Date());
    }).sort((a, b) => String(a.expiry || '').localeCompare(String(b.expiry || '')))[0];
    if (!liveFefoBatch) {
      toast(`${row.candidate.brand}: live FEFO ব্যাচে বিক্রয়ের যোগ্য স্টক নেই।`, 'w');
      return;
    }
    const qtyInput = document.getElementById(`pos-prescription-qty-${index}`);
    const qty = Math.max(1, parseInt(qtyInput?.value || '1', 10) || 1);
    if (qty > inv.totalStock) {
      toast(`${row.candidate.brand}: স্টক অপর্যাপ্ত (আছে ${inv.totalStock})।`, 'w');
      return;
    }

    let itemIndex = APP_STATE.posItems.findIndex(item => !item.medId);
    if (itemIndex === -1) {
      APP_STATE.posItems.push({ medId: '', name: '', qty: 1, price: 0, costPrice: 0, discountPct: 0, discountAmt: 0 });
      itemIndex = APP_STATE.posItems.length - 1;
    }
    applyMedicineToItem(itemIndex, inv);
    APP_STATE.posItems[itemIndex].qty = qty;
    APP_STATE.posItems[itemIndex].discountAmt = round2(qty * (inv.sellPrice || 0) * (APP_STATE.posItems[itemIndex].discountPct || 0) / 100);
    added++;
  });

  if (!added) {
    toast('কোনো কার্ট আইটেম যোগ হয়নি। স্টক ও নির্বাচন যাচাই করুন।', 'w');
    return;
  }
  renderPOSItems();
  calcPOSTotals();
  closeAppModal();
  toast(`${added}টি নির্বাচিত ওষুধ POS কার্টে যোগ হয়েছে।`, 's');
}

function onPOSDiscountPctChange(i) {
  const item = APP_STATE.posItems[i];
  if (!item) return;
  const pct = clamp(parseFloat(document.getElementById(`pos-discpct-${i}`).value) || 0, 0, 100);
  const gross = round2((item.qty || 0) * (item.price || 0));
  item.discountPct = pct;
  item.discountAmt = round2(gross * pct / 100);
  const amtEl = document.getElementById(`pos-discamt-${i}`);
  if (amtEl) amtEl.value = item.discountAmt;
  calcPOSTotals();
}

function onPOSDiscountAmtChange(i) {
  const item = APP_STATE.posItems[i];
  if (!item) return;
  const gross = round2((item.qty || 0) * (item.price || 0));
  const amt = clamp(parseFloat(document.getElementById(`pos-discamt-${i}`).value) || 0, 0, gross);
  item.discountAmt = amt;
  item.discountPct = gross > 0 ? round2((amt / gross) * 100) : 0;
  const pctEl = document.getElementById(`pos-discpct-${i}`);
  if (pctEl) pctEl.value = item.discountPct;
  calcPOSTotals();
}

function onPOSDiscountBlur(i) {
  const item = APP_STATE.posItems[i];
  if (!item) return;
  const pctEl = document.getElementById(`pos-discpct-${i}`);
  const amtEl = document.getElementById(`pos-discamt-${i}`);
  if (pctEl) pctEl.value = item.discountPct || 0;
  if (amtEl) amtEl.value = item.discountAmt || 0;
}

// ✅ নতুন — সামগ্রিক (গ্রস) ছাড় হ্যান্ডলার
function onPOSGrossDiscPctChange() {
  const pct = clamp(parseFloat(document.getElementById('pos-grossdisc-pct').value) || 0, 0, 100);
  APP_STATE.posGrossDiscPct = pct;
  calcPOSTotals();
}
function onPOSGrossDiscAmtChange() {
  const eligibleGross = round2(APP_STATE.posItems.filter(it => !(it.discountAmt > 0))
    .reduce((a, it) => a + (it.qty || 0) * (it.price || 0), 0));
  const amt = clamp(parseFloat(document.getElementById('pos-grossdisc-amt').value) || 0, 0, eligibleGross);
  APP_STATE.posGrossDiscPct = eligibleGross > 0 ? round2((amt / eligibleGross) * 100) : 0;
  calcPOSTotals();
}
// ────────────────────────────────────────────────────────────
// ✅ MEDICINE RESOLUTION (with disambiguation support)
// ────────────────────────────────────────────────────────────
function resolvePOSMedicineInput(i, opts = {}) {
  const inputEl = document.getElementById(`pos-med-input-${i}`);
  if (!inputEl) return;
  const val = inputEl.value;
  const stockedMeds = APP_STATE.inventory.filter(m => m.totalStock > 0);
  const result = resolveMedicineMatch(val, stockedMeds, buildMedDisplayText);
  if (result.type === 'exact') {
    closeMedDisambiguation();
    applyMedicineToItem(i, result.match);
    if (opts.onResolved) opts.onResolved(result.match);
    return;
  }
  if (result.type === 'ambiguous') {
    showMedDisambiguation(inputEl, result.matches, buildMedDisplayText, (chosen) => {
      inputEl.value = buildMedDisplayText(chosen);
      applyMedicineToItem(i, chosen);
      if (opts.onResolved) opts.onResolved(chosen);
    });
    return;
  }
  // none
  applyMedicineToItem(i, null);
  if (opts.notFoundToast && val.trim()) toast('ওষুধ খুঁজে পাওয়া যায়নি — নাম চেক করুন।', 'w');
}

function onPOSMedicineChange(i) {
  resolvePOSMedicineInput(i);
}

function applyMedicineToItem(i, med) {
  if (med) {
    const nearestBatch = (med.batches && med.batches[0]) || { cost: 0 };
    APP_STATE.posItems[i] = {
      medId: med.medId, name: med.brand, qty: APP_STATE.posItems[i].qty || 1,
      price: med.sellPrice || 0, costPrice: nearestBatch.cost || 0,
      discountPct: APP_STATE.posItems[i].discountPct || 0,
    };
    document.getElementById(`pos-price-${i}`).value = med.sellPrice || 0;
  } else {
    APP_STATE.posItems[i] = { medId: '', name: '', qty: 1, price: 0, costPrice: 0, discountPct: 0 };
  }
  updateLineTotal(i);
  calcPOSTotals();
}

function onPOSFieldChange(i) {
  const qty = Math.max(0, parseFloat(document.getElementById(`pos-qty-${i}`).value) || 0);
  const price = Math.max(0, parseFloat(document.getElementById(`pos-price-${i}`).value) || 0);
  const item = APP_STATE.posItems[i];
  item.qty = qty;
  item.price = price;

  const gross = round2(qty * price);
  item.discountAmt = round2(gross * (item.discountPct || 0) / 100);
  const discAmtEl = document.getElementById(`pos-discamt-${i}`);
  if (discAmtEl) discAmtEl.value = item.discountAmt;

  calcPOSTotals();
}

function onPOSFieldBlur(i) {
  const item = APP_STATE.posItems[i];
  if (!item) return;
  const qtyEl = document.getElementById(`pos-qty-${i}`);
  const priceEl = document.getElementById(`pos-price-${i}`);
  if (qtyEl) qtyEl.value = item.qty;
  if (priceEl) priceEl.value = item.price;
}

function updateLineTotal(i) {
  const item = APP_STATE.posItems[i];
  const gross = round2((item.qty || 0) * (item.price || 0));
  const effective = item.discountAmt > 0 ? item.discountAmt : (item._effectiveDiscountAmt || 0);
  const net = round2(gross - effective);
  const el = document.getElementById(`pos-linetotal-${i}`);
  if (!el) return;
  el.innerHTML = effective > 0
    ? `<span class="line-through text-slate-400 text-[10px] block">৳${fmt(gross)}</span>৳${fmt(net)}`
    : '৳' + fmt(net);
}

// ────────────────────────────────────────────────────────────
// ⌨️ KEYBOARD FLOW
// ────────────────────────────────────────────────────────────
function onPOSMedicineKeydown(e, i) {
  const inputEl = document.getElementById(`pos-med-input-${i}`);
  if (isMedDisambiguationOpenFor(inputEl) && medDisambiguationHandleKey(e)) return;
  if (e.key !== 'Enter') return;
  e.preventDefault();
  resolvePOSMedicineInput(i, {
    notFoundToast: true,
    onResolved: () => {
      addPOSItem();
      const newIdx = APP_STATE.posItems.length - 1;
      setTimeout(() => focusMedicineInput(newIdx), 30);
    },
  });
}

function onPOSFieldKeydown(e, i) {
  if (e.key === 'Enter') {
    e.preventDefault();
    focusMedicineInput(i + 1 < APP_STATE.posItems.length ? i + 1 : i);
    if (i + 1 >= APP_STATE.posItems.length) {
      addPOSItem();
      setTimeout(() => focusMedicineInput(APP_STATE.posItems.length - 1), 30);
    }
  }
}

function focusMedicineInput(i) {
  document.getElementById(`pos-med-input-${i}`)?.focus();
}

document.addEventListener('keydown', (e) => {
  if (APP_STATE.currentTab === 'pos' && e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    submitPOSSale();
  }
});

// ────────────────────────────────────────────────────────────
// TOTALS
// ────────────────────────────────────────────────────────────
function calcPOSTotals() {
  APP_STATE.posGrossDiscPct = APP_STATE.posGrossDiscPct || 0;

  let medTotal = 0;
  APP_STATE.posItems.forEach(item => { medTotal += (item.qty || 0) * (item.price || 0); });
  medTotal = round2(medTotal);

  const eligibleGross = round2(APP_STATE.posItems.filter(it => !(it.discountAmt > 0))
    .reduce((a, it) => a + (it.qty || 0) * (it.price || 0), 0));
  APP_STATE.posGrossDiscAmt = round2(eligibleGross * APP_STATE.posGrossDiscPct / 100);

  const grossMap = distributeGrossDiscount(
    APP_STATE.posItems, APP_STATE.posGrossDiscAmt,
    it => (it.qty || 0) * (it.price || 0), it => it.discountAmt || 0
  );

  let discTotal = 0;
  APP_STATE.posItems.forEach(item => {
    const inline = item.discountAmt || 0;
    const effective = inline > 0 ? inline : (grossMap.get(item) || 0);
    item._effectiveDiscountAmt = effective;
    discTotal += effective;
  });
  discTotal = round2(discTotal);

  const grandTotal = Math.max(0, round2(medTotal - discTotal));
  document.getElementById('pos-total').value = grandTotal.toFixed(2);
  onPOSCashChange();
  setText('bs-med', '৳' + fmt(medTotal));
  setText('bs-disc', '৳' + fmt(discTotal));
  setText('bs-total', '৳' + fmt(grandTotal));

  const gdAmtEl = document.getElementById('pos-grossdisc-amt');
  const gdPctEl = document.getElementById('pos-grossdisc-pct');
  if (gdAmtEl && document.activeElement !== gdAmtEl) gdAmtEl.value = APP_STATE.posGrossDiscAmt;
  if (gdPctEl && document.activeElement !== gdPctEl) gdPctEl.value = APP_STATE.posGrossDiscPct;
  const gdNoteEl = document.getElementById('pos-grossdisc-note');
  if (gdNoteEl) gdNoteEl.textContent = eligibleGross > 0 ? `প্রযোজ্য আইটেম-গ্রস: ৳${fmt(eligibleGross)}` : 'কোনো যোগ্য আইটেম নেই';

  APP_STATE.posItems.forEach((_, i) => updateLineTotal(i));
}

function onPOSCashChange() {
  const total = parseFloat(document.getElementById('pos-total').value) || 0;
  const rawCash = parseFloat(document.getElementById('pos-cash').value) || 0;
  const cash = Math.max(0, rawCash);
  const netCash = Math.min(cash, Math.max(0, total));
  const due = Math.max(0, round2(total - netCash));
  const change = Math.max(0, round2(cash - total));
  APP_STATE.posCashPaid = netCash;
  document.getElementById('pos-net-cash').value = round2(netCash).toFixed(2);
  document.getElementById('pos-due').value = due.toFixed(2);
  setText('bs-cash', '৳' + fmt(netCash));
  setText('bs-due', '৳' + fmt(due));
  setText('pos-change', '৳' + fmt(change));
  const dueWrap = document.getElementById('pos-status-due');
  const paidWrap = document.getElementById('pos-status-paid');
  const changeWrap = document.getElementById('pos-status-change');
  if (dueWrap) dueWrap.classList.toggle('hidden', !(due > 0));
  if (paidWrap) paidWrap.classList.toggle('hidden', !(cash > 0 && due <= 0));
  if (changeWrap) changeWrap.classList.toggle('hidden', !(change > 0));
  if (dueWrap) setText('pos-status-due-amt', '৳' + fmt(due));
  if (paidWrap) paidWrap.querySelector('strong').textContent = '৳' + fmt(netCash);
}

// ────────────────────────────────────────────────────────────
// ✅ SUBMIT — এখন async, apiSubmitSale() সফল হলেই APP_STATE আপডেট হয়
// ────────────────────────────────────────────────────────────
async function submitPOSSale() {
  if (guardReadOnly()) return;
  hideEl('pos-error');
  const custId = sdGetValue('sd-pos-customer');
  const validItems = APP_STATE.posItems.filter(i => i.medId && i.qty > 0);

  if (!custId) return showPOSError('গ্রাহক নির্বাচন করুন।');
  if (!validItems.length) return showPOSError('কমপক্ষে একটি ওষুধ যোগ করুন।');

  for (const item of validItems) {
    const inv = APP_STATE.inventory.find(m => m.medId === item.medId);
    const qty = Math.floor(Math.max(0, Number(item.qty) || 0));
    if (!inv || qty > inv.totalStock) {
      return showPOSError(`"${item.name}" স্টক অপর্যাপ্ত। বর্তমান স্টক: ${inv ? formatUnitQuantity(inv.totalStock) : '০ ইউনিট'}`);
    }
  }

  calcPOSTotals(); // ✅ item._effectiveDiscountAmt ফ্রেশ নিশ্চিত

  const total = parseFloat(document.getElementById('pos-total').value) || 0;
  const tendered = parseFloat(document.getElementById('pos-cash').value) || 0;
  const cashPaid = Math.min(Math.max(0, tendered), Math.max(0, total));
  const due = parseFloat(document.getElementById('pos-due').value) || 0;
  const date = document.getElementById('pos-date').value || todayStr();

  if (due > 0 && custId === 'WALK_IN') return showPOSError('বাকি রাখতে হলে নিবন্ধিত গ্রাহক নির্বাচন করুন।');

  const customer = APP_STATE.customers.find(c => c.id === custId);
  const custName = custId === 'WALK_IN' ? 'নগদ গ্রাহক' : (customer?.name || custId);
  const invoiceNo = genInvoiceNo();

  // ✅ ফিক্স: _effectiveDiscountAmt (স্ক্র্যাচ ফিল্ড) স্ট্রিপ করে বাদ, এবং
  // discountAmt এখন ব্লেন্ডেড (ইনলাইন+গ্রস) effective ভ্যালু দিয়ে overwrite —
  // আগে discountAmt শুধু inline অংশ রয়ে যেত, discountPct-এর সাথে অসামঞ্জস্যপূর্ণ
  const finalItems = validItems.map(i => {
    const gross = round2((i.qty || 0) * (i.price || 0));
    const effective = Math.min(i._effectiveDiscountAmt || 0, gross);
    const qty = Math.floor(Math.max(0, Number(i.qty) || 0));
    const basePrice = qty > 0 ? round2((gross - effective) / qty) : 0;
    const grossBasePrice = qty > 0 ? round2(gross / qty) : 0;
    const { _effectiveDiscountAmt, ...rest } = i;
    return {
      ...rest, qty, price: grossBasePrice,
      baseUnitPrice: grossBasePrice, netUnitPrice: basePrice,
      discountAmt: effective, discountPct: gross > 0 ? round2((effective / gross) * 100) : 0,
    };
  });

  const sale = {
    invoiceNo, date, customerId: custId, customerName: custName,
    branchId: APP_STATE.activeBranchId,
    createdByUid: APP_STATE.currentUser?.uid || null,
    items: finalItems,
    totalBill: total, cashPaid, due, type: due > 0 ? 'বাকি' : 'নগদ',
    grossDiscountPct: APP_STATE.posGrossDiscPct || 0,
  };

  const btn = document.getElementById('pos-submit-btn');
  const idleHTML = '<i class="fa-solid fa-circle-check"></i> বিক্রয় নিশ্চিত করুন <span class="text-[11px] font-normal opacity-70 hidden sm:inline">(Ctrl+Enter)</span>';
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> প্রক্রিয়াকরণ হচ্ছে...';

  try {
    const res = await apiSubmitSale(sale);
    if (!res.success) {
      showPOSError(res.message);
      btn.disabled = false;
      btn.innerHTML = idleHTML;
      return;
    }

    if (res.queued) {
      toast(res.message, 'w');
      resetPOS();
      refreshSyncBadge();
      openReceiptModal('sale', sale);
    } else {
      finalItems.forEach(item => deductStockFEFO(item.medId, item.qty));
      if (customer) applyCustomerDueChange(custId, due, cashPaid);
      APP_STATE.sales.push(sale);
      toast(res.message, 's');
      resetPOS();
      renderTodayPOSSales();
      openReceiptModal('sale', sale);
    }
    btn.disabled = false;
    btn.innerHTML = idleHTML;
  } catch (err) {
    showFatalError('বিক্রয় সংরক্ষণে সমস্যা:\n' + humanizeError(err), err);
    btn.disabled = false;
    btn.innerHTML = idleHTML;
  }
}

function showPOSError(msg) {
  const el = document.getElementById('pos-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function resetPOS() {
  closeMedDisambiguation();
  APP_STATE.posDate = null; APP_STATE.posCashPaid = null; APP_STATE.posCustomerId = null;
  APP_STATE.posItems = [];
  APP_STATE.posGrossDiscPct = 0; APP_STATE.posGrossDiscAmt = 0;
  sdClear('sd-pos-customer');
  sdSelect('sd-pos-customer', 'WALK_IN', 'নগদ গ্রাহক (Walk-In)');
  document.getElementById('pos-cash').value = '';
  addPOSItem();
  calcPOSTotals();
  setTimeout(() => focusMedicineInput(0), 50);
}

// ────────────────────────────────────────────────────────────
// STOCK DEDUCTION — FEFO (লোকাল APP_STATE আয়না, Firestore-এর মতোই লজিক)
// ────────────────────────────────────────────────────────────
function deductStockFEFO(medId, qty) {
  const inv = APP_STATE.inventory.find(m => m.medId === medId);
  if (!inv) return;
  inv.batches.sort((a, b) => compareBatchExpiry(a, b, 'asc')); // ✅ ধাপ ৩১ ফিক্স
  let remaining = qty;
  for (const b of inv.batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.stock, remaining);
    b.stock -= take;
    remaining -= take;
  }
  inv.batches = inv.batches.filter(b => b.stock > 0);
  inv.totalStock = inv.batches.reduce((a, b) => a + b.stock, 0);
  inv.costValue = round2(inv.batches.reduce((a, b) => a + b.cost * b.stock, 0));
  inv.mrpValue = round2(inv.batches.reduce((a, b) => a + b.mrp * b.stock, 0));
  inv.nearestExpiry = inv.batches[0]?.expiry || '';
  const med = APP_STATE.medicines.find(m => m.id === medId);
  const reorderLevel = getEffectiveReorderLevel(med);
  inv.status = inv.totalStock === 0 ? 'out' : inv.totalStock <= reorderLevel ? 'low' : 'ok';
}

// ────────────────────────────────────────────────────────────
// TODAY'S SALES LIST
// ────────────────────────────────────────────────────────────
function onPOSListDateChange(val) {
  APP_STATE.posListDate = val || todayStr();
  renderTodayPOSSales();
}

function renderTodayPOSSales() {
  const container = document.getElementById('pos-today-sales');
  if (!container) return;
  const filterDate = APP_STATE.posListDate || todayStr();
  const listSales = APP_STATE.sales.filter(s => s.date === filterDate).slice().reverse();

  const capHint = capHintHTML('sales', 'pos-load-older-btn', 'renderTodayPOSSales', 'সাম্প্রতিক ৮,০০০টার বেশি বিক্রয় থাকলে পুরনো তারিখের এন্ট্রি এখনো নাও দেখাতে পারে।');

  container.innerHTML = capHint + (listSales.length ? listSales.map(s => `
    <div class="px-4 py-3 border-b border-slate-100 dark:border-slate-700/50">
      <div class="flex justify-between items-start">
        <div class="min-w-0">
          <div class="text-xs font-mono text-slate-400">${esc(s.invoiceNo)}</div>
          <div class="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">${esc(s.customerName)}</div>
        </div>
        <div class="text-right flex-shrink-0">
          <div class="font-mono font-bold text-sm text-slate-800 dark:text-white">৳${fmt(s.totalBill)}</div>
          ${s.due > 0 ? `<span class="text-[11px] text-red-500 font-semibold">বাকি ৳${fmt(s.due)}</span>` : `<span class="text-[11px] text-emerald-500 font-semibold">পরিশোধিত</span>`}
          <div class="flex items-center gap-2 justify-end mt-1">
            <button onclick="reprintSaleReceipt('${s.invoiceNo}')" class="text-slate-400 hover:text-brand text-xs"><i class="fa-solid fa-print"></i></button>
            ${APP_STATE.isOwner || APP_STATE.staffRole === 'manager' ? `<button onclick="openEditSale('${s.invoiceNo}')" class="text-brand hover:text-brand/80 text-xs" title="সম্পাদনা"><i class="fa-solid fa-pen"></i></button>` : ''}
            ${APP_STATE.isOwner ? `<button onclick="deleteSaleConfirm('${s.invoiceNo}')" class="text-red-400 hover:text-red-600 text-xs"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </div>
      </div>
    </div>`).join('')
    : `<div class="px-4 py-8 text-center text-slate-400 text-sm"><i class="fa-solid fa-receipt text-2xl opacity-30 mb-2 block"></i>এই তারিখে কোনো বিক্রয় নেই</div>`);
}

function hideEl(id) { document.getElementById(id)?.classList.add('hidden'); }

async function openEditSale(invoiceNo) {
  if (!APP_STATE.isOwner && APP_STATE.staffRole !== 'manager') return toast('শুধু Owner বা Manager বিক্রয় সম্পাদনা করতে পারবেন।', 'w');
  const sale = APP_STATE.sales.find(s => s.invoiceNo === invoiceNo);
  if (!sale) return;
  closeEditSale();
  const modal = document.createElement('div');
  modal.id = 'edit-sale-modal';
  modal.className = 'fixed inset-0 z-[9010] bg-slate-900/50 flex items-center justify-center p-4';
  modal.innerHTML = `<div class="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md p-5">
    <h3 class="font-bold text-slate-800 dark:text-white mb-4">বিক্রয় সম্পাদনা — ${esc(invoiceNo)}</h3>
    <div class="space-y-3">
      <div><label class="text-xs text-slate-500">তারিখ</label><input id="edit-sale-date" type="date" value="${esc(sale.date)}" class="w-full mt-1 px-3 py-2 border rounded-lg"/></div>
      <div><label class="text-xs text-slate-500">মোট বিল</label><input id="edit-sale-total" type="number" min="0" step="0.01" value="${sale.totalBill || 0}" class="w-full mt-1 px-3 py-2 border rounded-lg"/></div>
      <div><label class="text-xs text-slate-500">নগদ প্রাপ্ত</label><input id="edit-sale-cash" type="number" min="0" step="0.01" value="${sale.cashPaid || 0}" class="w-full mt-1 px-3 py-2 border rounded-lg"/></div>
      <div><label class="text-xs text-slate-500">বাকি</label><input id="edit-sale-due" type="number" min="0" step="0.01" value="${sale.due || 0}" class="w-full mt-1 px-3 py-2 border rounded-lg"/></div>
    </div>
    <div class="flex justify-end gap-2 mt-5"><button onclick="closeEditSale()" class="btn btn-secondary">বাতিল</button><button onclick="saveEditSale('${esc(invoiceNo)}')" class="btn btn-primary">সংরক্ষণ</button></div>
  </div>`;
  document.body.appendChild(modal);
}
function closeEditSale() { document.getElementById('edit-sale-modal')?.remove(); }
async function saveEditSale(invoiceNo) {
  const sale = APP_STATE.sales.find(s => s.invoiceNo === invoiceNo);
  if (!sale) return;
  const date = document.getElementById('edit-sale-date')?.value || sale.date;
  const totalBill = round2(parseFloat(document.getElementById('edit-sale-total')?.value) || 0);
  const cashPaid = round2(parseFloat(document.getElementById('edit-sale-cash')?.value) || 0);
  const due = round2(parseFloat(document.getElementById('edit-sale-due')?.value) || 0);
  if (totalBill < 0 || cashPaid < 0 || due < 0) return toast('সঠিক পরিমাণ দিন।', 'w');
  const res = await apiUpdateSale(invoiceNo, { date, totalBill, cashPaid, due, type: due > 0 ? 'বাকি' : 'নগদ' });
  if (!res.success) return toast(res.message, 'w');
  Object.assign(sale, { date, totalBill, cashPaid, due, type: due > 0 ? 'বাকি' : 'নগদ' });
  await emitFinancialNotification({
    type: 'sale_edit', action: 'edited', amount: totalBill, recordId: invoiceNo,
    title: 'বিক্রয় রেকর্ড সম্পাদিত', message: `Invoice ${invoiceNo} সম্পাদনা করেছেন`
  });
  closeEditSale();
  toast('বিক্রয় রেকর্ড সম্পাদিত হয়েছে।', 's');
  renderTodayPOSSales();
}

async function deleteSaleConfirm(invoiceNo) {
  if (guardReadOnly()) return;
  const sale = APP_STATE.sales.find(s => s.invoiceNo === invoiceNo);
  if (!sale || !confirm(`"${invoiceNo}" মুছবেন? স্টক ও বাকি ফেরত হবে।`)) return;
  try {
    const res = await apiDeleteSale(sale);
    if (!res.success) return toast(res.message, 'w');
    // ✅ সংশোধন: item.consumedBatches পাস করা হচ্ছে — সঠিক ব্যাচে স্টক ফেরত
    sale.items.forEach(item => restockItem(item.medId, item.qty, item.costPrice, item.consumedBatches));
    if (sale.customerId !== 'WALK_IN') {
      applyCustomerDueChange(sale.customerId, -sale.due, -sale.cashPaid);
    }
    APP_STATE.sales = APP_STATE.sales.filter(s => s.invoiceNo !== invoiceNo);
    toast(res.message, 's');
    renderTodayPOSSales();
  } catch (err) { showFatalError('বিক্রয় মুছতে সমস্যা:\n' + humanizeError(err), err); }
}

// ════════════════════════════════════════════════════════════
// ✅ POS CART/DRAFT — বড় একটা বিক্রয় নিয়ে কাজ করতে করতে ছোট কিন্তু
// জরুরি বিক্রয় সম্পন্ন করে আবার ফিরে আসার জন্য। localStorage-ভিত্তিক
// (দেখুন js/draft-store.js) — শুধু এই ডিভাইসে থাকে।
// ════════════════════════════════════════════════════════════
function capturePOSDraftState() {
  return {
    posItems: JSON.parse(JSON.stringify(APP_STATE.posItems || [])),
    posCustomerId: APP_STATE.posCustomerId || null,
    posDate: document.getElementById('pos-date')?.value || APP_STATE.posDate,
    posCashPaid: parseFloat(document.getElementById('pos-cash')?.value) || 0,
    posGrossDiscPct: APP_STATE.posGrossDiscPct || 0,
  };
}

function savePOSCartAsDraft() {
  const hasItems = (APP_STATE.posItems || []).some(i => i.medId);
  if (!hasItems) { toast('কার্টে কোনো ওষুধ নেই — সংরক্ষণ করার কিছু নেই।', 'w'); return; }

  const custId = APP_STATE.posCustomerId || 'WALK_IN';
  const custName = custId === 'WALK_IN' ? 'নগদ গ্রাহক' : (APP_STATE.customers.find(c => c.id === custId)?.name || custId);
  const itemCount = APP_STATE.posItems.filter(i => i.medId).length;

  addDraft('pos', `${custName} — ${itemCount} আইটেম`, capturePOSDraftState());
  toast('কার্ট সংরক্ষিত হয়েছে — এখন নতুন বিক্রয় শুরু করতে পারেন।', 's');
  resetPOS();
  renderPOSDraftBadge();
}

function renderPOSDraftBadge() {
  const el = document.getElementById('pos-drafts-count');
  if (el) el.textContent = `ড্রাফট (${getDraftCount('pos')})`;
}

function openPOSDraftsModal() {
  document.getElementById('pos-drafts-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'pos-drafts-modal';
  modal.className = 'fixed inset-0 z-[9995] bg-black/50 flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
      <h4 class="font-bold text-slate-800 dark:text-white mb-1"><i class="fa-solid fa-layer-group text-brand mr-1"></i> সংরক্ষিত কার্ট</h4>
      <p class="text-xs text-slate-400 mb-4">শুধু এই ডিভাইসে সংরক্ষিত থাকে — অন্য ডিভাইস/ব্রাউজারে দেখা যাবে না।</p>
      <div id="pos-drafts-list" class="space-y-2 mb-4"></div>
      <button onclick="document.getElementById('pos-drafts-modal').remove()" class="btn btn-secondary btn-block">বন্ধ করুন</button>
    </div>`;
  document.body.appendChild(modal);
  openAppModal('pos-drafts-modal', () => document.getElementById('pos-drafts-modal')?.remove());
  renderPOSDraftsList(getDrafts('pos'));
}

function renderPOSDraftsList(drafts) {
  const box = document.getElementById('pos-drafts-list');
  if (!box) return;
  if (!drafts.length) {
    box.innerHTML = `<div class="text-center text-slate-400 text-sm py-6">কোনো সংরক্ষিত কার্ট নেই।</div>`;
    return;
  }
  box.innerHTML = drafts.map(d => `
    <div class="flex items-center justify-between gap-2 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2">
      <div class="min-w-0">
        <div class="text-sm font-semibold text-slate-800 dark:text-white truncate">${esc(d.label)}</div>
        <div class="text-[11px] text-slate-400">${esc(formatRelativeTime(d.savedAt))}</div>
      </div>
      <div class="flex items-center gap-3 flex-shrink-0">
        <button onclick="loadPOSDraft('${d.id}')" class="text-brand text-xs font-semibold hover:underline">লোড করুন</button>
        <button onclick="deletePOSDraftConfirm('${d.id}')" class="text-red-400 hover:text-red-600"><i class="fa-solid fa-trash text-xs"></i></button>
      </div>
    </div>`).join('');
}

function loadPOSDraft(draftId) {
  const draft = getDrafts('pos').find(d => d.id === draftId);
  if (!draft) return;

  const hasCurrentItems = (APP_STATE.posItems || []).some(i => i.medId);
  if (hasCurrentItems && !confirm('বর্তমান কার্টে অসংরক্ষিত আইটেম আছে — ড্রাফট লোড করলে এগুলো হারিয়ে যাবে। চালিয়ে যাবেন? (চাইলে আগে "কার্ট সংরক্ষণ করুন" চেপে নিজে সেভ করে নিন)')) return;

  removeDraft('pos', draftId); // ✅ লোড করলে সেই ড্রাফট consume হয়ে যায় (আবার resave করলে নতুন এন্ট্রি হবে)
  APP_STATE.posItems = draft.state.posItems || [];
  APP_STATE.posCustomerId = draft.state.posCustomerId || null;
  APP_STATE.posDate = draft.state.posDate || null;
  APP_STATE.posCashPaid = draft.state.posCashPaid || null;
  APP_STATE.posGrossDiscPct = draft.state.posGrossDiscPct || 0;

  document.getElementById('pos-drafts-modal')?.remove();
  renderPOSModule();
  toast('ড্রাফট লোড হয়েছে।', 's');
}

function deletePOSDraftConfirm(draftId) {
  if (!confirm('এই সংরক্ষিত কার্ট মুছে ফেলতে চান?')) return;
  removeDraft('pos', draftId);
  renderPOSDraftsList(getDrafts('pos'));
  renderPOSDraftBadge();
}
