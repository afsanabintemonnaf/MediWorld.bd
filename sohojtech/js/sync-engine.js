'use strict';

// ════════════════════════════════════════════════════════════
// sync-engine.js — অফলাইন queue প্রসেস করে Firestore-এ পাঠানো
// db-indexeddb.js (স্টোরেজ) আর api-client.js (Firestore call) —
// এই দুইয়ের মাঝে সেতু। এই ফাইলে কোনো IndexedDB-এর direct কল নেই,
// শুধু db-indexeddb.js-এর পাবলিক ফাংশন ব্যবহার হয়।
// ════════════════════════════════════════════════════════════

let _syncInProgress = false;

// ✅ ধাপ ২০: ব্যর্থ এন্ট্রির অসীম অটো-রিট্রাই ঠেকাতে
const MAX_AUTO_RETRY_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 30000;        // প্রথম রিট্রাই বিরতি: ৩০ সেকেন্ড
const BACKOFF_MAX_MS = 30 * 60000;    // সর্বোচ্চ বিরতি: ৩০ মিনিট

function initSyncEngine() {
  // ✅ ফিক্স: গত সেশনে (ট্যাব ক্র্যাশ/বন্ধ) যদি কোনো এন্ট্রি 'syncing'
  // অবস্থায় আটকে থেকে যায়, সেটা এখন কেউ প্রসেস করছে না — তাই বুটেই
  // সেগুলোকে 'queued'-এ ফিরিয়ে দেওয়া হচ্ছে, নাহলে চিরতরে আটকে থাকবে।
  resetStuckSyncingEntries().then(() => {
    refreshSyncBadge(); // ✅ ধাপ ১৮: বুট-টাইমে সঠিক (uid-ফিল্টারড) pending count সাথে সাথে দেখানো
    if (navigator.onLine) triggerSync();
  }).catch(err => {
    console.error('পুরোনো Sync lease পুনরুদ্ধার ব্যর্থ:', err);
  });

  // ✅ ফিক্স: শুধু 'online' ইভেন্টের উপর নির্ভর করা যথেষ্ট নয় — এটা মোবাইল
  // ব্রাউজারে/DevTools সিমুলেশনে মাঝেমধ্যে fire হয় না। তাই একাধিক
  // নিরাপত্তা-স্তর:
  window.addEventListener('online', () => triggerSync());

  // ট্যাব আবার visible হলে (phone unlock, app switch থেকে ফিরে আসা)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) triggerSync();
  });

  // চূড়ান্ত নিরাপত্তা-নেট — প্রতি ২০ সেকেন্ডে হালকা চেক (শুধু pending
  // থাকলে triggerSync() ভেতরে কিছু করে, নাহলে সাথে সাথে রিটার্ন করে —
  // তাই এটা ব্যাটারি/ডেটা খরচ করে না)
  setInterval(() => { if (navigator.onLine) triggerSync(); }, 20000);
}

async function triggerSync() {
  if (_syncInProgress) return; // একসাথে দুইবার না চলার গার্ড
  _syncInProgress = true;
  try {
    await processPendingQueue();
  } catch (err) {
    console.error('Sync queue প্রসেস করতে সমস্যা:', err);
  } finally {
    _syncInProgress = false;
  }
}

// ✅ ধাপ ২০: এই ব্যর্থ এন্ট্রিটা এখনই অটো-রিট্রাই করা উচিত কিনা —
// attempt-cap ও exponential backoff দুটোই বিবেচনা করে
function shouldAutoRetryFailed(entry) {
  if ((entry.attempts || 0) >= MAX_AUTO_RETRY_ATTEMPTS) return false;
  if (!entry.lastAttemptAt) return true;
  const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, (entry.attempts || 1) - 1), BACKOFF_MAX_MS);
  return (Date.now() - entry.lastAttemptAt) >= backoffMs;
}

function isPermanentlyFailed(entry) {
  return entry.status === 'failed' && (entry.attempts || 0) >= MAX_AUTO_RETRY_ATTEMPTS;
}

// ✅ ধাপ ০.১.১: getSyncTypeApiMap() এখন বহু-টাইপ সাপোর্ট করে — প্রতিটা এন্ট্রি
// { apiFn, applyFn } আকারে, যাতে API কল ও state-apply লজিক এক জায়গায় bound থাকে
// (আগে apiFn এখানে ছিল, applyFn আলাদা if/else চেইনে — এখন dispatch-object-এ একত্রিত)
function getSyncTypeRegistry() {
  return {
    sale: { apiFn: apiSubmitSale, applyFn: applySyncedSale },
    purchase: { apiFn: apiSubmitPurchase, applyFn: applySyncedPurchase },
    customerDue: {
      apiFn: (payload, opts) => apiCollectCustomerDue(payload.paymentId, payload.custId, payload.amount, payload.note, payload.custData, opts),
      applyFn: applySyncedCustomerDue,
    },
    supplierPay: {
      apiFn: (payload, opts) => apiPaySupplierPayable(payload.paymentId, payload.supId, payload.amount, payload.note, payload.supData, opts),
      applyFn: applySyncedSupplierPay,
    },
    expense: { apiFn: apiAddExpense, applyFn: applySyncedExpense },
    income: { apiFn: apiAddIncome, applyFn: applySyncedIncome },
    shortList: { apiFn: apiSaveShortList, applyFn: applySyncedShortList },
    shortListDelete: { apiFn: apiDeleteShortList, applyFn: applySyncedShortListDelete },
    notification: {
      apiFn: async (payload, opts) => {
        if (payload.action === 'delete') {
          return await apiDeleteNotification({ branchId: payload.branchId, notificationId: payload.notificationId });
        }
        const ref = fbDb.collection('branches').doc(payload.branchId).collection('notifications').doc(payload.notificationId);
        try { await ref.update(payload.patch || {}); return { success: true }; }
        catch (err) { return { success: false, message: humanizeError(err) }; }
      },
      applyFn: applySyncedNotification,
    },
    customerReturn: {
      apiFn: (payload, opts) => apiSubmitCustomerReturn(payload.returnDoc, payload.custId, payload.custDueReduction, opts),
      applyFn: applySyncedCustomerReturn,
    },
    supplierReturn: {
      apiFn: (payload, opts) => apiSubmitSupplierReturn(payload.returnDoc, payload.supId, payload.supPayableReduction, opts),
      applyFn: applySyncedSupplierReturn,
    },
    // ✅ ধাপ ০.১.৪
    medicineAdd: { apiFn: apiAddMedicine, applyFn: applySyncedMedicineAdd },
    customerAdd: { apiFn: apiAddCustomer, applyFn: applySyncedCustomerAdd },
    supplierAdd: { apiFn: apiAddSupplier, applyFn: applySyncedSupplierAdd },
  };
}

// ✅ ব্যাকওয়ার্ড-কম্প্যাটিবিলিটি — পুরনো নাম এখনো কল হতে পারে অন্য কোথাও থেকে,
// কিন্তু এখন থেকে নতুন কোড getSyncTypeRegistry() ব্যবহার করবে
function getSyncTypeApiMap() {
  const registry = getSyncTypeRegistry();
  const map = {};
  Object.keys(registry).forEach(k => { map[k] = registry[k].apiFn; });
  return map;
}

async function processPendingQueue() {
  if (!navigator.onLine) return;
  await resetStuckSyncingEntries();
  const all = await getPendingWrites();
  // ✅ ধাপ ২০: 'queued' সবসময় প্রসেস হবে (নতুন বা ম্যানুয়াল রিট্রাই থেকে আসা)।
  // 'failed' শুধু backoff-window পার হলে এবং attempt-cap-এর নিচে থাকলেই
  // অটো-প্রসেস হবে — নাহলে ম্যানুয়াল হস্তক্ষেপের অপেক্ষায় থাকবে।
  const entries = all.filter(e => {
    if (e.status === 'syncing') return false;
    if (!e.branchId || e.branchId !== APP_STATE.activeBranchId) return false;
    if (e.status === 'failed') return shouldAutoRetryFailed(e);
    return true;
  });

  for (const entry of entries) {
    if (!navigator.onLine) break; // মাঝপথে নেট চলে গেলে থেমে যাও, বাকিটা পরে
    await attemptSync(entry);
    refreshSyncBadge();
  }
}

async function attemptSync(entry) {
  let allowed;
  try {
    allowed = await revalidatePendingWrite(entry);
  } catch (err) {
    await markFailed(entry.tempId, 'অনুমতি যাচাই করা যায়নি: ' + humanizeError(err));
    return;
  }
  if (!allowed.success) {
    await markFailed(entry.tempId, allowed.message);
    return;
  }
  const claimed = await claimPendingWrite(entry.tempId);
  if (!claimed) return;
  const typeInfo = getSyncTypeRegistry()[claimed.type];
  if (!typeInfo) { await markFailed(claimed.tempId, 'অজানা এন্ট্রি টাইপ: ' + claimed.type); return; }
  const leaseTimer = setInterval(() => {
    renewPendingWriteLease(claimed.tempId, claimed.syncLeaseId)
      .catch(err => console.error('Sync lease নবায়ন ব্যর্থ:', err));
  }, 30 * 1000);

  try {
    // ✅ ফিক্স: isRetry:true পাঠানো হচ্ছে — এই কল sync-queue থেকে retry,
    // তাই connectivity ব্যর্থ হলে apiSubmitSale/apiSubmitPurchase আবার
    // queue করবে না (duplicate entry এড়াতে), শুধু failed রিটার্ন করবে —
    // যেটা নিচে markFailed()-এ যাবে, পরের অটো-সাইকেলে আবার চেষ্টা হবে।
    const res = await typeInfo.apiFn(claimed.payload, { isRetry: true });
    if (res.success) {
      typeInfo.applyFn(claimed);
      await removePendingWrite(claimed.tempId);
    } else {
      await markFailed(claimed.tempId, res.message || 'সিঙ্ক ব্যর্থ');
    }
  } catch (err) {
    await markFailed(claimed.tempId, humanizeError(err));
  } finally {
    clearInterval(leaseTimer);
  }
}

async function revalidatePendingWrite(entry) {
  const user = fbAuth?.currentUser;
  if (!user || !APP_STATE.currentUser || user.uid !== entry.uid ||
      !user.emailVerified || !APP_STATE.activeBranchId ||
      APP_STATE.activeBranchId !== entry.branchId) {
    return { success: false, message: 'বর্তমান লগইন/শাখার সঙ্গে এন্ট্রির পরিচয় মেলেনি; ওই শাখায় অনুমোদিতভাবে লগইন করে আবার চেষ্টা করুন।' };
  }

  if (APP_STATE.isOwner) {
    if (user.uid !== APP_CONFIG.OWNER_UID ||
        !(APP_STATE.branches || []).some(branch => branch.id === entry.branchId)) {
      return { success: false, message: 'Owner বা Branch অনুমতি পুনরায় যাচাই করা যায়নি।' };
    }
    const [owner, branch] = await Promise.all([
      fbDb.collection('owners').doc(user.uid).get(),
      fbDb.collection('branches').doc(entry.branchId).get(),
    ]);
    if (!owner.exists || owner.data().role !== 'owner' || owner.data().uid !== user.uid ||
        String(owner.data().email || '').toLowerCase() !== String(user.email || '').toLowerCase() ||
        !branch.exists || branch.data().ownerUid !== user.uid) {
      return { success: false, message: 'Owner অনুমতি আর বৈধ নেই; সিঙ্ক বন্ধ রাখা হয়েছে।' };
    }
  } else {
    if (!APP_STATE.assignedBranchIds.includes(entry.branchId) || !APP_STATE.activeWorkSessionId) {
      return { success: false, message: 'এই Branch-এ staff assignment বা সক্রিয় work session নেই।' };
    }
    const [staffSnap, sessionSnap, branchSnap] = await Promise.all([
      fbDb.collection('staff').doc(user.uid).get(),
      fbDb.collection('workSessions').doc(APP_STATE.activeWorkSessionId).get(),
      fbDb.collection('branches').doc(entry.branchId).get(),
    ]);
    const staff = staffSnap.exists ? staffSnap.data() : null;
    const session = sessionSnap.exists ? sessionSnap.data() : null;
    if (!staff || staff.active !== true || staff.status !== 'active' ||
        String(staff.email || '').toLowerCase() !== String(user.email || '').toLowerCase() ||
        !Array.isArray(staff.assignedBranchIds) || !staff.assignedBranchIds.includes(entry.branchId) ||
        !session || session.uid !== user.uid || session.active !== true ||
        !Array.isArray(session.assignedBranchIds) || !session.assignedBranchIds.includes(entry.branchId) ||
        !branchSnap.exists || branchSnap.data().active !== true) {
      return { success: false, message: 'Staff অনুমতি/সেশন আর বৈধ নেই; Owner-কে দিয়ে assignment যাচাই করুন।' };
    }
  }
  return { success: true };
}

// ✅ ধাপ ০.১.১: আগে applySyncedEntryToState()-এর একটাই if/else ব্লকে ছিল,
// এখন প্রতিটা টাইপের নিজস্ব ফাংশন — getSyncTypeRegistry()-এর applyFn হিসেবে bound
function applySyncedSale(entry) {
  const sale = entry.payload;
  sale.items.forEach(item => deductStockFEFO(item.medId, item.qty));
  if (sale.customerId !== 'WALK_IN') applyCustomerDueChange(sale.customerId, sale.due, sale.cashPaid);
  APP_STATE.sales.push(sale);
  APP_STATE.pendingSales = (APP_STATE.pendingSales || []).filter(s => s.invoiceNo !== sale.invoiceNo);
  emitFinancialNotification({
    type: 'sale', action: 'created_offline_synced', amount: sale.totalBill || 0, recordId: sale.invoiceNo,
    title: 'অফলাইন বিক্রয় সিঙ্ক হয়েছে', message: `Invoice ${sale.invoiceNo}`
  });
  toast(`Invoice ${sale.invoiceNo} সিঙ্ক হয়েছে।`, 's');
  if (APP_STATE.currentTab === 'pos') renderTodayPOSSales();
}

function applySyncedPurchase(entry) {
  const purchase = entry.payload;
  purchase.items.forEach(item => addPurchaseBatch(item, purchase.date));
  const supplier = APP_STATE.suppliers.find(s => s.id === purchase.supplierId);
  if (supplier) {
    if (purchase.paymentType === 'বাকি') applySupplierPayableChange(purchase.supplierId, purchase.totalCost, 0);
    else applySupplierPayableChange(purchase.supplierId, 0, purchase.totalCost);
  }
  APP_STATE.purchases.push(purchase);
  APP_STATE.pendingPurchases = (APP_STATE.pendingPurchases || []).filter(p => p.purchaseId !== purchase.purchaseId);
  emitFinancialNotification({
    type: 'purchase', action: 'created_offline_synced', amount: purchase.totalCost || 0, recordId: purchase.purchaseId,
    title: 'অফলাইন ক্রয় সিঙ্ক হয়েছে', message: `ক্রয় ${purchase.purchaseId}`
  });
  toast(`Purchase ${purchase.purchaseId} সিঙ্ক হয়েছে।`, 's');
  if (APP_STATE.currentTab === 'purchase') renderTodayPurchases();
}

function applySyncedCustomerDue(entry) {
  const { custId, amount, note, custData, paymentId } = entry.payload;
  applyCustomerDueChange(custId, -amount, amount);
  APP_STATE.payments.push({ paymentId, date: todayStr(), customerId: custId, customerName: custData.name, amount, note: note || 'বাকি আদায়' });
  emitFinancialNotification({ type: 'payment', action: 'created_offline_synced', amount, recordId: paymentId, title: 'অফলাইন বাকি আদায় সিঙ্ক হয়েছে', message: `${custData.name} — ৳${fmt(amount)}` });
  toast(`${custData.name} — ৳${fmt(amount)} বাকি আদায় সিঙ্ক হয়েছে।`, 's');
  if (APP_STATE.currentTab === 'customers') renderCustTable();
}

function applySyncedSupplierPay(entry) {
  const { supId, amount, note, supData, paymentId } = entry.payload;
  applySupplierPayableChange(supId, -amount, amount);
  APP_STATE.supplierPayments.push({ paymentId, date: todayStr(), supplierId: supId, supplierName: supData.name, amount, note: note || 'পাওনা পরিশোধ' });
  emitFinancialNotification({ type: 'supplier_payment', action: 'created_offline_synced', amount, recordId: paymentId, title: 'অফলাইন সরবরাহকারী পরিশোধ সিঙ্ক হয়েছে', message: `${supData.name} — ৳${fmt(amount)}` });
  toast(`${supData.name} — ৳${fmt(amount)} পরিশোধ সিঙ্ক হয়েছে।`, 's');
  if (APP_STATE.currentTab === 'suppliers') renderSupTable();
}

function applySyncedNotification(entry) {
  const payload = entry.payload;
  if (payload.action === 'delete') {
    APP_STATE.notifications = (APP_STATE.notifications || []).filter(n => n.notificationId !== payload.notificationId);
  } else {
    const notification = (APP_STATE.notifications || []).find(n => n.notificationId === payload.notificationId);
    if (notification) Object.assign(notification, payload.patch || {});
  }
  updateNotificationBadge();
  if (document.getElementById('notification-modal')) openNotifications();
}

function applySyncedShortListDelete(entry) {
  const id = entry.payload?.id;
  APP_STATE.shortList = (APP_STATE.shortList || []).filter(r => r.id !== id);
  if (APP_STATE.currentTab === 'shortList' && typeof renderShortListTable === 'function') renderShortListTable();
}

function applySyncedShortList(entry) {
  const record = entry.payload;
  const idx = APP_STATE.shortList.findIndex(r => r.id === record.id);
  if (idx >= 0) APP_STATE.shortList[idx] = record;
  else APP_STATE.shortList.push(record);
  if (APP_STATE.currentTab === 'shortList' && typeof renderShortListTable === 'function') renderShortListTable();
}

function applySyncedIncome(entry) {
  const income = entry.payload;
  APP_STATE.incomes.push(income);
  toast(`আয় "${income.category || income.source || ''}" সিঙ্ক হয়েছে।`, 's');
  if (APP_STATE.currentTab === 'accounts') renderLedgerTable();
}

function applySyncedExpense(entry) {
  const exp = entry.payload;
  APP_STATE.expenses.push(exp);
  emitFinancialNotification({ type: 'expense', action: 'created_offline_synced', amount: exp.amount || 0, recordId: exp.id, title: 'অফলাইন খরচ সিঙ্ক হয়েছে', message: exp.description || exp.category || 'খরচ' });
  toast(`খরচ "${exp.description}" সিঙ্ক হয়েছে।`, 's');
  if (APP_STATE.currentTab === 'accounts') renderLedgerTable();
}

function applySyncedCustomerReturn(entry) {
  const { returnDoc, custId, custDueReduction } = entry.payload;
  returnDoc.items.forEach(item => restockItem(item.medId, item.qty, item.costPrice, item.consumedBatches));
  if (custDueReduction > 0) applyCustomerDueChange(custId, -custDueReduction, 0);
  APP_STATE.returns.push(returnDoc);
  // ✅ ফিক্স: sync সফল হলে pendingReturns থেকে সরানো — এখন এটা APP_STATE.returns-এ
  // স্থায়ীভাবে আছে, তাই pending তালিকায় রাখলে returnedQty() ডাবল-গণনা করবে
  APP_STATE.pendingReturns = (APP_STATE.pendingReturns || []).filter(r => r.returnId !== returnDoc.returnId);
  emitFinancialNotification({ type: 'return', action: 'created_offline_synced', amount: returnDoc.amount || 0, recordId: returnDoc.returnId, title: 'অফলাইন কাস্টমার রিটার্ন সিঙ্ক হয়েছে', message: returnDoc.refName || returnDoc.returnId });
  toast(`রিটার্ন ${returnDoc.returnId} সিঙ্ক হয়েছে।`, 's');
  if (APP_STATE.currentTab === 'returns') { renderRetForm(); renderTodayReturns(); }
}

function applySyncedSupplierReturn(entry) {
  const { returnDoc, supId, supPayableReduction } = entry.payload;
  returnDoc.items.forEach(item => {
    if (item.batchId) {
      const res = destockByBatchId(item.medId, item.batchId, item.qty);
      if (!res.success) console.warn('Local mirror destock সমস্যা:', res.message);
    } else {
      destockItem(item.medId, item.qty);
    }
  });
  if (supPayableReduction > 0) applySupplierPayableChange(supId, -supPayableReduction, 0);
  APP_STATE.returns.push(returnDoc);
  // ✅ ফিক্স: একই কারণে pendingReturns থেকে সরানো
  APP_STATE.pendingReturns = (APP_STATE.pendingReturns || []).filter(r => r.returnId !== returnDoc.returnId);
  emitFinancialNotification({ type: 'return', action: 'created_offline_synced', amount: returnDoc.amount || 0, recordId: returnDoc.returnId, title: 'অফলাইন সরবরাহকারী রিটার্ন সিঙ্ক হয়েছে', message: returnDoc.refName || returnDoc.returnId });
  toast(`রিটার্ন ${returnDoc.returnId} সিঙ্ক হয়েছে।`, 's');
  if (APP_STATE.currentTab === 'returns') { renderRetForm(); renderTodayReturns(); }
}

function applySyncedMedicineAdd(entry) {
  const data = entry.payload;
  const invRow = {
    medId: data.id, brand: data.brand, doseForm: data.doseForm || '', strength: data.strength || '',
    totalStock: 0, costValue: 0, mrpValue: 0, sellPrice: 0, nearestExpiry: '', status: 'out', batches: [],
  };
  APP_STATE.medicines.push({
    id: data.id, brand: data.brand, generic: data.generic || '', doseForm: data.doseForm || '',
    strength: data.strength || '', manufacturer: data.manufacturer || '', category: data.category || '',
    unit: data.unit || 'পাতা', reorderLevel: data.reorderLevel === null ? null : Math.max(0, parseInt(data.reorderLevel, 10) || 0),
    // ✅ ধাপ ৩৩.২
    preferredSupplierId: data.preferredSupplierId || '', preferredRepId: data.preferredRepId || '',
  });
  APP_STATE.inventory.push(invRow);
  toast(`"${data.brand}" সিঙ্ক হয়েছে।`, 's');
  if (APP_STATE.currentTab === 'medicine') renderMedTable();
}

function applySyncedCustomerAdd(entry) {
  const data = entry.payload;
  APP_STATE.customers.push({ id: data.id, name: data.name, phone: data.phone || '', address: data.address || '', due: 0, totalPaid: 0 });
  toast(`"${data.name}" গ্রাহক সিঙ্ক হয়েছে।`, 's');
  if (APP_STATE.currentTab === 'customers') renderCustTable();
  if (typeof initPOSCustomerDropdown === 'function' && document.getElementById('sd-pos-customer')) initPOSCustomerDropdown();
}

function applySyncedSupplierAdd(entry) {
  const data = entry.payload;
  APP_STATE.suppliers.push({ id: data.id, name: data.name, phone: data.phone || '', address: data.address || '', totalPayable: 0, totalPaid: 0 });
  toast(`"${data.name}" সরবরাহকারী সিঙ্ক হয়েছে।`, 's');
  if (APP_STATE.currentTab === 'suppliers') renderSupTable();
  if (typeof initPurSupplierDropdown === 'function' && document.getElementById('sd-pur-supplier')) initPurSupplierDropdown();
}

// ✅ পুরনো ফাংশন-নাম রাখা হলো যদি অন্য কোথাও রেফারেন্স থাকে (এখন dead হওয়া উচিত,
// কিন্তু নিরাপদে রাখা হলো — ০.১.২-এর পর সম্পূর্ণ সরানো যাবে)
function applySyncedEntryToState(entry) {
  if (entry.type === 'sale') applySyncedSale(entry);
  else if (entry.type === 'purchase') applySyncedPurchase(entry);
}

// ────────────────────────────────────────────────────────────
// UI ব্যাজ — header-এ conn-status-badge-এর ঠিক আগে বসবে
// ────────────────────────────────────────────────────────────
async function refreshSyncBadge() {
  const counts = await getPendingWriteCount();
  let badge = document.getElementById('sync-status-badge');

  if (!counts.total) { badge?.remove(); return; }

  if (!badge) {
    badge = document.createElement('button');
    badge.id = 'sync-status-badge';
    badge.type = 'button';
    badge.onclick = openSyncPanel;
    const connBadge = document.getElementById('conn-status-badge');
    connBadge?.parentElement?.insertBefore(badge, connBadge);
  }

  const hasFailed = counts.failed > 0;
  badge.className = hasFailed
    ? 'inline-flex items-center gap-1.5 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-full px-3 py-1 text-xs font-semibold'
    : 'inline-flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-full px-3 py-1 text-xs font-semibold';
  badge.innerHTML = hasFailed
    ? `<i class="fa-solid fa-triangle-exclamation"></i> ${counts.failed}টা সিঙ্ক ব্যর্থ`
    : `<i class="fa-solid fa-rotate fa-spin"></i> ${counts.total}টা সিঙ্কের অপেক্ষায়`;
}

// ────────────────────────────────────────────────────────────
// SYNC প্যানেল — তালিকা + retry/discard
// ────────────────────────────────────────────────────────────
async function openSyncPanel() {
  const entries = await getPendingWrites();
  const activeBranchEntries = entries.some(e => e.branchId === APP_STATE.activeBranchId);
  const otherBranchEntries = entries.some(e => e.branchId && e.branchId !== APP_STATE.activeBranchId);
  const modal = document.createElement('div');
  modal.id = 'sync-panel-modal';
  modal.className = 'fixed inset-0 z-[9996] bg-black/50 flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
      <h4 class="font-bold text-slate-800 dark:text-white mb-3"><i class="fa-solid fa-rotate mr-1"></i> অফলাইন সিঙ্ক তালিকা</h4>
      ${!navigator.onLine ? `<div class="text-center text-xs text-amber-600 mb-3"><i class="fa-solid fa-triangle-exclamation mr-1"></i> এখন অফলাইন — নেট ফিরলে সিঙ্ক হবে</div>` : activeBranchEntries ? `<button id="sync-now-btn" class="btn btn-primary btn-block mb-3"><i class="fa-solid fa-rotate mr-1"></i> সক্রিয় Branch-এর এন্ট্রি সিঙ্ক করুন</button>` : ''}
      ${navigator.onLine && !activeBranchEntries && otherBranchEntries ? `<div class="text-center text-xs text-amber-600 mb-3">অন্য Branch-এর এন্ট্রি সিঙ্ক করতে Branch selector থেকে সেই Branch নির্বাচন করুন।</div>` : ''}
      <div id="sync-panel-list" class="space-y-2 mb-4"></div>
      <button onclick="document.getElementById('sync-panel-modal').remove()" class="btn btn-secondary btn-block">বন্ধ করুন</button>
    </div>`;
  document.body.appendChild(modal);
  openAppModal('sync-panel-modal', () => document.getElementById('sync-panel-modal')?.remove());
  renderSyncPanelList(entries);

  document.getElementById('sync-now-btn')?.addEventListener('click', async () => {
    await triggerSync();
    renderSyncPanelList(await getPendingWrites());
    refreshSyncBadge();
  });
}

// ✅ ধাপ ০.১.১: renderSyncPanelList()-এর label-নির্ণয় লজিক আলাদা ফাংশনে —
// নতুন টাইপ যোগ হলে শুধু নিচের labels অবজেক্টে entry বাড়ালেই চলবে

function syncEntryLabel(e) {
  const labels = {
    sale: () => `বিক্রয় ${esc(e.payload.invoiceNo)} — ৳${fmt(e.payload.totalBill)}`,
    purchase: () => `ক্রয় ${esc(e.payload.purchaseId)} — ৳${fmt(e.payload.totalCost)}`,
    customerDue: () => `বাকি আদায় ${esc(e.payload.custData.name)} — ৳${fmt(e.payload.amount)}`,
    supplierPay: () => `পাওনা পরিশোধ ${esc(e.payload.supData.name)} — ৳${fmt(e.payload.amount)}`,
    expense: () => `খরচ ${esc(e.payload.description)} — ৳${fmt(e.payload.amount)}`,
    customerReturn: () => `কাস্টমার রিটার্ন ${esc(e.payload.returnDoc.refId)} — ৳${fmt(e.payload.returnDoc.amount)}`,
    supplierReturn: () => `সাপ্লায়ার রিটার্ন ${esc(e.payload.returnDoc.refId)} — ৳${fmt(e.payload.returnDoc.amount)}`,
    medicineAdd: () => `নতুন ওষুধ ${esc(e.payload.brand)}`,
    customerAdd: () => `নতুন গ্রাহক ${esc(e.payload.name)}`,
    supplierAdd: () => `নতুন সরবরাহকারী ${esc(e.payload.name)}`,
  };
  return labels[e.type] ? labels[e.type]() : `${esc(e.type)} এন্ট্রি`;
}

function renderSyncPanelList(entries) {
  const box = document.getElementById('sync-panel-list');
  if (!box) return;
  if (!entries.length) { box.innerHTML = `<div class="text-center text-sm text-slate-400 py-6">কোনো পেন্ডিং এন্ট্রি নেই।</div>`; return; }

  box.innerHTML = entries.map(e => {
    const label = syncEntryLabel(e);
    const branchName = (APP_STATE.branches || []).find(branch => branch.id === e.branchId)?.name
      || (e.branchId ? e.branchId : 'শাখা অজানা');
    const permanentlyFailed = isPermanentlyFailed(e);
    const statusBadge = permanentlyFailed
      ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">স্থায়ী ব্যর্থ — ম্যানুয়াল প্রয়োজন</span>`
      : e.status === 'failed' ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">ব্যর্থ — পরে আবার চেষ্টা হবে</span>`
      : e.status === 'syncing' ? `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">সিঙ্ক হচ্ছে...</span>`
      : `<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">অপেক্ষমাণ</span>`;
    return `
      <div class="border border-slate-200 dark:border-slate-600 rounded-lg p-3">
        <div class="flex justify-between items-center mb-1">
          <span class="text-sm font-semibold">${label}</span>${statusBadge}
        </div>
        <div class="text-[11px] text-slate-400 mb-1">শাখা: ${esc(branchName)}${e.branchId && e.branchId !== APP_STATE.activeBranchId ? ' — ওই শাখা নির্বাচন করলে সিঙ্ক হবে' : ''}</div>
        ${e.status === 'failed' ? `<div class="text-xs text-red-500 mb-2">${esc(e.lastError || '')}${permanentlyFailed ? ` (${e.attempts || 0}টা চেষ্টা ব্যর্থ)` : ''}</div>
        <div class="flex gap-2">
          <button data-tempid="${e.tempId}" class="sync-retry-btn text-xs text-brand hover:underline"><i class="fa-solid fa-rotate-right mr-1"></i>আবার চেষ্টা করুন</button>
          <button data-tempid="${e.tempId}" class="sync-discard-btn text-xs text-red-500 hover:underline"><i class="fa-solid fa-trash mr-1"></i>বাতিল করুন</button>
        </div>` : ''}
      </div>`;
  }).join('');

  box.querySelectorAll('.sync-retry-btn').forEach(btn => btn.addEventListener('click', async () => {
    await retryFailedWrite(btn.dataset.tempid);
    await triggerSync();
    renderSyncPanelList(await getPendingWrites());
    refreshSyncBadge();
  }));

  box.querySelectorAll('.sync-discard-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('নিশ্চিত? এই এন্ট্রি বাতিল করলে সেটা কখনো সংরক্ষিত হবে না।')) return;
    const entry = (await getPendingWrites()).find(x => x.tempId === btn.dataset.tempid);
    await discardFailedWrite(btn.dataset.tempid);
    if (entry?.type === 'sale') APP_STATE.pendingSales = (APP_STATE.pendingSales || []).filter(s => s.invoiceNo !== entry.payload.invoiceNo);
    if (entry?.type === 'purchase') APP_STATE.pendingPurchases = (APP_STATE.pendingPurchases || []).filter(p => p.purchaseId !== entry.payload.purchaseId);
    // ✅ ফিক্স: রিটার্ন এন্ট্রি ম্যানুয়ালি বাতিল করলেও pendingReturns থেকে সরাতে হবে,
    // নাহলে "ভূতুড়ে" এন্ট্রি চিরকাল returnedQty()-এর cap-হিসাবে থেকে যাবে
    if (entry?.type === 'customerReturn' || entry?.type === 'supplierReturn') {
      APP_STATE.pendingReturns = (APP_STATE.pendingReturns || []).filter(r => r.returnId !== entry.payload.returnDoc.returnId);
    }
    renderSyncPanelList(await getPendingWrites());
    refreshSyncBadge();
    toast('এন্ট্রি বাতিল করা হয়েছে।', 'w');
  }));
}
