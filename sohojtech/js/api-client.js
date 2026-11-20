'use strict';

function userCol(name) {
  const branchId = APP_STATE.activeBranchId;
  if (!branchId) throw new Error('কোনো active Branch নির্বাচন করা হয়নি।');
  return fbDb.collection('branches').doc(branchId).collection(name);
}

async function cget(ref) {
  // ✅ ফিক্স: source:'cache' জোর করা বাদ দেওয়া হলো। enablePersistence() চালু
  // থাকায় .get() নিজে থেকেই: অনলাইনে server থেকে fresh ডেটা আনে, অফলাইনে
  // স্বয়ংক্রিয়ভাবে cache-এ fallback করে। এতে মাল্টি-ডিভাইস stale-read বাগ থাকে না।
  return ref.get();
}

function docsWithId(snapshot, field = 'id') {
  return snapshot.docs.map(doc => {
    const data = doc.data();
    return { ...data, [field]: data[field] || doc.id };
  });
}

async function apiUpdateNotification(notification, patch) {
  if (!APP_STATE.isOwner) return { success: false, message: 'শুধু Owner নোটিফিকেশন পরিচালনা করতে পারবেন।' };
  if (!notification?.branchId || !notification?.notificationId) return { success: false, message: 'নোটিফিকেশন তথ্য অসম্পূর্ণ।' };
  const ref = fbDb.collection('branches').doc(notification.branchId).collection('notifications').doc(notification.notificationId);
  const cleanPatch = {
    readByOwner: patch.readByOwner === true,
    archived: patch.archived === true,
  };
  if (!navigator.onLine) return await queueNotificationOffline({ action: 'update', notificationId: notification.notificationId, branchId: notification.branchId, patch: cleanPatch });
  try {
    await ref.update(cleanPatch);
    return { success: true };
  } catch (err) {
    if (isConnectivityError(err)) return await queueNotificationOffline({ action: 'update', notificationId: notification.notificationId, branchId: notification.branchId, patch: cleanPatch });
    return { success: false, message: humanizeError(err) };
  }
}

async function apiMarkAllNotificationsRead(notifications) {
  if (!APP_STATE.isOwner) return { success: false, message: 'শুধু Owner নোটিফিকেশন পরিচালনা করতে পারবেন।' };
  const active = (notifications || []).filter(n => n.archived !== true);
  const results = await Promise.all(active.map(notification =>
    apiUpdateNotification(notification, { readByOwner: true, archived: notification.archived === true })
  ));
  const failures = results.filter(result => !result.success);
  return failures.length
    ? { success: false, message: `${failures.length}টি নোটিফিকেশন আপডেট হয়নি। ${failures[0].message || ''}`.trim() }
    : { success: true };
}

async function apiDeleteNotification(notification) {
  if (!APP_STATE.isOwner) return { success: false, message: 'শুধু Owner নোটিফিকেশন মুছতে পারবেন।' };
  if (!notification?.branchId || !notification?.notificationId) return { success: false, message: 'নোটিফিকেশন তথ্য অসম্পূর্ণ।' };
  const ref = fbDb.collection('branches').doc(notification.branchId).collection('notifications').doc(notification.notificationId);
  if (!navigator.onLine) return await queueNotificationOffline({ action: 'delete', notificationId: notification.notificationId, branchId: notification.branchId });
  try {
    await ref.delete();
    return { success: true };
  } catch (err) {
    if (isConnectivityError(err)) return await queueNotificationOffline({ action: 'delete', notificationId: notification.notificationId, branchId: notification.branchId });
    return { success: false, message: humanizeError(err) };
  }
}

async function queueNotificationOffline(payload) {
  try {
    await queueWrite({ type: 'notification', payload, branchId: payload.branchId });
    return { success: true, queued: true, message: 'নোটিফিকেশন পরিবর্তন অফলাইনে কিউ হয়েছে — নেট ফিরলে সিঙ্ক হবে।' };
  } catch (err) {
    return { success: false, message: 'অফলাইন নোটিফিকেশন সংরক্ষণ ব্যর্থ: ' + humanizeError(err) };
  }
}

// কেন্দ্রীয় আর্থিক নোটিফিকেশন। এটি মূল Firestore ট্রানজ্যাকশন থেকে আলাদা,
// তাই নোটিফিকেশন লিখতে ব্যর্থ হলেও বিক্রয়/ক্রয়/পেমেন্ট সংরক্ষণ ভেঙে পড়বে না।
async function emitFinancialNotification(options) {
  // Routine sale/purchase/payment transactions are intentionally not emitted.
  // Keep notifications only for explicitly staff-edit audit actions.
  if (!options.staffEdit || APP_STATE.isOwner) return { success: false, queued: false };
  if (!APP_STATE.activeBranchId || !navigator.onLine) return { success: false, queued: false };
  try {
    const branchId = options.branchId || APP_STATE.activeBranchId;
    const notificationId = 'NOTIFY-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const actorUid = APP_STATE.currentUser?.uid || null;
    const actorName = APP_STATE.currentUser?.displayName || APP_STATE.currentUser?.email || actorUid || 'স্টাফ';
    const payload = {
      notificationId,
      type: options.type || 'financial',
      action: options.action || 'created',
      amount: round2(Number(options.amount || 0)),
      recordId: options.recordId || '',
      branchId,
      actorUid,
      actorName,
      actorRole: APP_STATE.staffRole || (APP_STATE.isOwner ? 'owner' : ''),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      timestamp: new Date().toISOString(),
      readByOwner: false,
      archived: false,
      title: options.title || '',
      message: options.message || '',
    };
    await fbDb.collection('branches').doc(branchId).collection('notifications').doc(notificationId).set(payload);
    return { success: true };
  } catch (err) {
    console.warn('Financial notification সৃষ্টি হয়নি:', err);
    return { success: false, error: err };
  }
}

async function emitStaffEditAudit(options) {
  if (!APP_STATE.isStaffMember || APP_STATE.isOwner) return;
  const auditId = 'EDIT-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const branchId = options.branchId || APP_STATE.activeBranchId;
  const payload = {
    auditId,
    kind: 'staff_record_edit',
    actorUid: APP_STATE.currentUser?.uid || null,
    actorName: APP_STATE.currentUser?.displayName || APP_STATE.currentUser?.email || '',
    actorRole: APP_STATE.staffRole || 'staff',
    recordType: options.recordType || 'record',
    recordId: options.recordId || '',
    branchId,
    action: options.action || 'edited',
    before: options.before || null,
    after: options.after || null,
    editSummary: options.editSummary || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await fbDb.collection('audits').doc(auditId).set(payload);
    await emitFinancialNotification({
      ...options,
      staffEdit: true,
      type: 'staff_edit',
      action: options.action || 'edited',
      recordId: options.recordId || auditId,
      amount: 0,
      title: 'স্টাফ রেকর্ড এডিট',
      message: `${options.recordType || 'রেকর্ড'} #${options.recordId || ''} — ${options.editSummary || 'পরিবর্তন করা হয়েছে'}`
    });
  } catch (err) {
    console.warn('Staff edit audit/notification failed:', err);
  }
}

// ────────────────────────────────────────────────────────────
// MEDICINE
// ────────────────────────────────────────────────────────────
async function apiAddMedicine(data, opts = {}) {
  const isRetry = !!opts.isRetry;

  if (!navigator.onLine) {
    if (isRetry) return { success: false, message: 'এখনো অফলাইন — পরের সাইকেলে আবার চেষ্টা হবে।' };
    return await queueMedicineAddOffline(data);
  }

  try {
    const id = data.id || ('MED-' + Date.now());
    const medRef = userCol('medicines').doc(id);
    const invRef = userCol('inventory').doc(id);

    const existing = await cget(medRef);
    if (existing.exists) {
      // ✅ ধাপ ০.১.৪: isRetry হলে এটা sync-queue থেকে ডুপ্লিকেট রিট্রাই —
      // ID client-side deterministic (একবারই জেনারেট হয়, retry-তে পুনর্ব্যবহৃত),
      // তাই doc আগে থেকে থাকা মানে আগের সাইকেলে আসলে সফল হয়েছিল — idempotent no-op সফলতা।
      if (isRetry) return { success: true, medId: id, message: '"' + data.brand + '" যোগ হয়েছে।' };
      return { success: false, message: '"' + id + '" ইতোমধ্যে আছে — পুনরায় চেষ্টা করুন।' };
    }

    // ✅ ধাপ ০.১.৪: medicine + inventory — দুটো doc একসাথে atomic batch-এ,
    // যাতে অফলাইন-sync-এর মাঝপথে নেট গেলে অসম্পূর্ণ (শুধু medicine, inventory নেই) রেকর্ড না তৈরি হয়
    const batch = fbDb.batch();
    batch.set(medRef, {
      id, brand: data.brand || '', generic: data.generic || '', doseForm: data.doseForm || '',
      strength: data.strength || '', manufacturer: data.manufacturer || '', category: data.category || '',
      branchId: APP_STATE.activeBranchId,
      unit: data.unit || 'পাতা', reorderLevel: data.reorderLevel === null ? null : Math.max(0, parseInt(data.reorderLevel, 10) || 0),
      unitsPerStrip: positivePackNumber(data.unitsPerStrip, 1),
      stripsPerBox: positivePackNumber(data.stripsPerBox, 1),
      // ✅ ধাপ ৩৩.২ — পছন্দের সরবরাহকারী/প্রতিনিধি, ঐচ্ছিক
      preferredSupplierId: data.preferredSupplierId || '',
      preferredRepId: data.preferredRepId || '',
    });
    batch.set(invRef, {
      medId: id, brand: data.brand || '', doseForm: data.doseForm || '', strength: data.strength || '',
    branchId: APP_STATE.activeBranchId,
      totalStock: 0, costValue: 0, mrpValue: 0, sellPrice: 0, nearestExpiry: '', status: 'out', batches: [],
    });
    await withTimeout(batch.commit(), FIRESTORE_WRITE_TIMEOUT_MS);

    return { success: true, medId: id, message: '"' + data.brand + '" যোগ হয়েছে।' };
  } catch (err) {
    if (isConnectivityError(err)) {
      if (isRetry) return { success: false, message: 'নেট সংযোগ অস্থির — একটু পর আবার চেষ্টা হবে।' };
      return await queueMedicineAddOffline(data);
    }
    return { success: false, message: humanizeError(err) };
  }
}

async function apiUpdateMedicine(medId, data) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const f = {};
    if (data.brand !== undefined) f.brand = data.brand;
    if (data.generic !== undefined) f.generic = data.generic;
    if (data.doseForm !== undefined) f.doseForm = data.doseForm;
    if (data.strength !== undefined) f.strength = data.strength;
    if (data.manufacturer !== undefined) f.manufacturer = data.manufacturer;
    if (data.category !== undefined) f.category = data.category;
    if (data.unit !== undefined) f.unit = data.unit;
    if (data.unitsPerStrip !== undefined) f.unitsPerStrip = positivePackNumber(data.unitsPerStrip, 1);
    if (data.stripsPerBox !== undefined) f.stripsPerBox = positivePackNumber(data.stripsPerBox, 1);
    if (data.reorderLevel !== undefined) f.reorderLevel = data.reorderLevel === null ? null : Math.max(0, parseInt(data.reorderLevel, 10) || 0);
    // ✅ ধাপ ৩৩.২
    if (data.preferredSupplierId !== undefined) f.preferredSupplierId = data.preferredSupplierId;
    if (data.preferredRepId !== undefined) f.preferredRepId = data.preferredRepId;
    const medRef = userCol('medicines').doc(medId);
    const invRef = userCol('inventory').doc(medId);
    const before = await fbDb.runTransaction(async tx => {
      const [medSnap, invSnap] = await Promise.all([tx.get(medRef), tx.get(invRef)]);
      if (!medSnap.exists) throw new Error('ওষুধ রেকর্ড পাওয়া যায়নি।');
      tx.update(medRef, f);
      if (invSnap.exists) {
        tx.update(invRef, { brand: f.brand, doseForm: f.doseForm, strength: f.strength });
      } else {
        tx.set(invRef, {
          medId, branchId: APP_STATE.activeBranchId,
          brand: f.brand || '', doseForm: f.doseForm || '', strength: f.strength || '',
          totalStock: 0, costValue: 0, mrpValue: 0, sellPrice: 0,
          nearestExpiry: '', status: 'out', batches: [],
        });
      }
      return medSnap.data();
    });
    emitStaffEditAudit({
      recordType: 'medicine',
      recordId: medId,
      action: 'edited',
      before,
      after: { ...before, ...f },
      editSummary: `Reorder level: ${before?.reorderLevel ?? 'unset'} → ${f.reorderLevel ?? 'unset'}`
    });
    return { success: true, message: 'ওষুধ আপডেট হয়েছে।' };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

async function apiDeleteMedicine(medId) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const medRef = userCol('medicines').doc(medId);
    const invRef = userCol('inventory').doc(medId);
    await fbDb.runTransaction(async tx => {
      const [medDoc, invDoc] = await Promise.all([tx.get(medRef), tx.get(invRef)]);
      if (!medDoc.exists) throw new Error('ওষুধ রেকর্ড পাওয়া যায়নি।');
      if (invDoc.exists) {
        const inv = invDoc.data();
        const totalStock = inv.totalStock == null ? 0 : Number(inv.totalStock);
        const batches = inv.batches == null ? [] : inv.batches;
        if (!Number.isFinite(totalStock) || !Array.isArray(batches)) {
          throw new Error('স্টকের তথ্য যাচাই করা যায়নি; ওষুধ মুছবেন না।');
        }
        const batchStocks = batches.map(batch => Number(batch?.stock ?? 0));
        if (batchStocks.some(stock => !Number.isFinite(stock) || stock < 0)
            || totalStock < 0) {
          throw new Error('স্টকের তথ্য যাচাই করা যায়নি; ওষুধ মুছবেন না।');
        }
        if (totalStock > 0 || batchStocks.some(stock => stock > 0)) {
          throw new Error('স্টক আছে। মুছতে হলে আগে স্টক শূন্য করুন।');
        }
      }
      tx.delete(medRef);
      if (invDoc.exists) tx.delete(invRef);
    });
    return { success: true, message: 'ওষুধ মুছে ফেলা হয়েছে।' };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

async function apiSetInventoryRow(medId, data) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try { await userCol('inventory').doc(medId).set(data); return { success: true }; }
  catch (err) { return { success: false, message: humanizeError(err) }; }
}
async function apiUpdateInventoryFields(medId, fields) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try { await userCol('inventory').doc(medId).update(fields); return { success: true }; }
  catch (err) { return { success: false, message: humanizeError(err) }; }
}

// ────────────────────────────────────────────────────────────
// CUSTOMER
// ────────────────────────────────────────────────────────────
async function apiAddCustomer(data, opts = {}) {
  const isRetry = !!opts.isRetry;

  if (!navigator.onLine) {
    if (isRetry) return { success: false, message: 'এখনো অফলাইন — পরের সাইকেলে আবার চেষ্টা হবে।' };
    return await queueCustomerAddOffline(data);
  }

  try {
    const ref = userCol('customers').doc(data.id);
    const existing = await cget(ref);
    if (existing.exists) {
      if (isRetry) return { success: true, message: '"' + data.name + '" নিবন্ধিত হয়েছে।' };
      return { success: false, message: '"' + data.id + '" ইতোমধ্যে আছে।' };
    }
    await withTimeout(
      ref.set({
        id: data.id, name: data.name || '', phone: data.phone || '', address: data.address || '',
        branchId: APP_STATE.activeBranchId, createdByUid: APP_STATE.currentUser?.uid || null,
        due: 0, totalPaid: 0,
      }),
      FIRESTORE_WRITE_TIMEOUT_MS
    );
    return { success: true, message: '"' + data.name + '" নিবন্ধিত হয়েছে।' };
  } catch (err) {
    if (isConnectivityError(err)) {
      if (isRetry) return { success: false, message: 'নেট সংযোগ অস্থির — একটু পর আবার চেষ্টা হবে।' };
      return await queueCustomerAddOffline(data);
    }
    return { success: false, message: humanizeError(err) };
  }
}

async function apiUpdateCustomer(custId, data) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const f = {};
    if (data.name !== undefined) f.name = data.name;
    if (data.phone !== undefined) f.phone = data.phone;
    if (data.address !== undefined) f.address = data.address;
    await userCol('customers').doc(custId).update(f);
    return { success: true, message: 'গ্রাহক আপডেট হয়েছে।' };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

async function apiDeleteCustomer(custId) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const doc = await cget(userCol('customers').doc(custId));
    if (!doc.exists) return { success: false, message: 'গ্রাহক পাওয়া যায়নি।' };
    if ((doc.data().due || 0) > 0) return { success: false, message: '৳' + doc.data().due + ' বাকি আছে। পরিশোধের পর মুছুন।' };
    await userCol('customers').doc(custId).delete();
    return { success: true, message: 'গ্রাহক মুছে ফেলা হয়েছে।' };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

async function apiCollectCustomerDue(paymentId, custId, amount, note, custData, opts = {}) {
  const isRetry = !!opts.isRetry;

  if (!navigator.onLine) {
    if (isRetry) return { success: false, message: 'এখনো অফলাইন — পরের সাইকেলে আবার চেষ্টা হবে।' };
    return await queueCustomerDueOffline({ paymentId, custId, amount, note, custData });
  }

  try {
    const custRef = userCol('customers').doc(custId);
    const payRef = userCol('payments').doc(paymentId);

    await withTimeout(fbDb.runTransaction(async (tx) => {
      // ✅ ধাপ ০.১.২: idempotency গার্ড — sale/purchase-এর প্যাটার্ন অনুসরণ করে।
      // এই paymentId দিয়ে আগেই সফলভাবে লেখা হয়ে থাকলে (sync-retry ডুপ্লিকেট),
      // চুপচাপ no-op — ডাবল-ডিডাকশন/ডাবল-cash-credit রোধ।
      const existingPayDoc = await tx.get(payRef);
      if (existingPayDoc.exists) return;

      const custDoc = await tx.get(custRef);
      if (!custDoc.exists) throw new Error('গ্রাহক পাওয়া যায়নি।');
      const c = custDoc.data();
      const freshDue = c.due || 0;
      const freshTotalPaid = c.totalPaid || 0;

      if (amount > freshDue + 0.01) {
        throw new Error(`বাকির (৳${fmt(freshDue)}) চেয়ে বেশি নেওয়া যাবে না।`);
      }

      const currentBalance = await readCashBalance(tx);

      tx.update(custRef, {
        due: round2(freshDue - amount),
        totalPaid: round2(freshTotalPaid + amount),
      });
      tx.set(payRef, {
        paymentId, date: todayStr(), customerId: custId, customerName: custData.name, amount,
        branchId: APP_STATE.activeBranchId, createdByUid: APP_STATE.currentUser?.uid || null,
        note: note || 'বাকি আদায়',
      });
      applyCashDelta(tx, currentBalance, amount);
    }), FIRESTORE_WRITE_TIMEOUT_MS);

    emitFinancialNotification({
      type: 'payment', action: 'created', amount, recordId: paymentId,
      title: 'গ্রাহক বাকি আদায়', message: `${custData.name} — ৳${fmt(amount)}`
    });
    return { success: true, message: `৳${fmt(amount)} আদায় হয়েছে।` };
  } catch (err) {
    if (isConnectivityError(err)) {
      if (isRetry) return { success: false, message: 'নেট সংযোগ অস্থির — একটু পর আবার চেষ্টা হবে।' };
      return await queueCustomerDueOffline({ paymentId, custId, amount, note, custData });
    }
    return { success: false, message: humanizeError(err) };
  }
}
const OFFLINE_MSG = 'ইন্টারনেট সংযোগ নেই। সমর্থিত এন্ট্রি এই ব্রাউজারের সিঙ্ক-কিউতে জমা হতে পারে; নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক চেষ্টা হবে।';
// ────────────────────────────────────────────────────────────
// SUPPLIER
// ────────────────────────────────────────────────────────────
async function apiAddSupplier(data, opts = {}) {
  const isRetry = !!opts.isRetry;

  if (!navigator.onLine) {
    if (isRetry) return { success: false, message: 'এখনো অফলাইন — পরের সাইকেলে আবার চেষ্টা হবে।' };
    return await queueSupplierAddOffline(data);
  }

  try {
    const ref = userCol('suppliers').doc(data.id);
    const existing = await cget(ref);
    if (existing.exists) {
      if (isRetry) return { success: true, message: '"' + data.name + '" যোগ হয়েছে।' };
      return { success: false, message: '"' + data.id + '" ইতোমধ্যে আছে।' };
    }
    await withTimeout(
      ref.set({
        id: data.id, name: data.name || '', phone: data.phone || '', address: data.address || '',
        supplierCategory: data.supplierCategory || '', manufacturerNames: data.manufacturerNames || [], // ✅ ধাপ ৩৩.১
        branchId: APP_STATE.activeBranchId, createdByUid: APP_STATE.currentUser?.uid || null,
        totalPayable: 0, totalPaid: 0,
      }),
      FIRESTORE_WRITE_TIMEOUT_MS
    );
    return { success: true, message: '"' + data.name + '" যোগ হয়েছে।' };
  } catch (err) {
    if (isConnectivityError(err)) {
      if (isRetry) return { success: false, message: 'নেট সংযোগ অস্থির — একটু পর আবার চেষ্টা হবে।' };
      return await queueSupplierAddOffline(data);
    }
    return { success: false, message: humanizeError(err) };
  }
}

async function apiUpdateSupplier(supId, data) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const f = {};
    if (data.name !== undefined) f.name = data.name;
    if (data.phone !== undefined) f.phone = data.phone;
    if (data.address !== undefined) f.address = data.address;
    if (data.supplierCategory !== undefined) f.supplierCategory = data.supplierCategory; // ✅ ধাপ ৩৩.১
    if (data.manufacturerNames !== undefined) f.manufacturerNames = data.manufacturerNames;
    await userCol('suppliers').doc(supId).update(f);
    return { success: true, message: 'সরবরাহকারী আপডেট হয়েছে।' };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

// ────────────────────────────────────────────────────────────
// ✅ ধাপ ৩৩.১ — SUPPLIER REPRESENTATIVES (subcollection CRUD)
// অনলাইন-অনলি (medicine/customer-এর মতো offline-queue এখানে যোগ করা
// হয়নি — কম-ফ্রিকোয়েন্সি, সেটআপ-টাইম অপারেশন, POS/Purchase-এর মতো
// দৈনন্দিন-জরুরি না)
// ────────────────────────────────────────────────────────────
function repCol(supId) {
  return userCol('suppliers').doc(supId).collection('representatives');
}

async function apiGetRepresentatives(supId) {
  try {
    const snap = await repCol(supId).get();
    return { success: true, representatives: snap.docs.map(d => ({ ...d.data(), id: d.data().id || d.id })) };
  } catch (err) { return { success: false, message: humanizeError(err), representatives: [] }; }
}

async function apiAddRepresentative(supId, data) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const id = 'REP-' + Date.now();
    await repCol(supId).doc(id).set({
      id, name: data.name || '', phone: data.phone || '', groups: data.groups || [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true, repId: id };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

async function apiUpdateRepresentative(supId, repId, data) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    await repCol(supId).doc(repId).update({
      name: data.name || '',
      phone: data.phone || '',
      groups: data.groups || [],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

async function apiDeleteRepresentative(supId, repId) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    await repCol(supId).doc(repId).delete();
    return { success: true };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

async function apiSaveShortList(record) {
  if (!navigator.onLine) return await queueShortListOffline(record);
  try {
    const ref = userCol('shortList').doc(record.id);
    await ref.set({
      ...record,
      branchId: APP_STATE.activeBranchId,
      normalizedName: normalizeMedicineDemandName(record.name),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { success: true };
  } catch (err) {
    if (isConnectivityError(err)) return await queueShortListOffline(record);
    return { success: false, message: humanizeError(err) };
  }
}

async function apiDeleteShortList(id) {
  const recordId = typeof id === 'object' ? id.id : id;
  if (!navigator.onLine) return await queueShortListDeleteOffline(recordId);
  try { await userCol('shortList').doc(recordId).delete(); return { success:true }; }
  catch (err) {
    if (isConnectivityError(err)) return await queueShortListDeleteOffline(recordId);
    return { success:false, message:humanizeError(err) };
  }
}

async function queueShortListDeleteOffline(id) {
  try {
    await queueWrite({ type:'shortListDelete', payload:{ id } });
    return { success:true, queued:true, message:'Short List deletion অফলাইনে কিউ হয়েছে।' };
  } catch (err) { return { success:false, message:'অফলাইন সংরক্ষণ ব্যর্থ: '+humanizeError(err) }; }
}

async function queueShortListOffline(record) {
  try {
    await queueWrite({ type:'shortList', payload:record });
    return { success:true, queued:true, message:'Short List অফলাইনে সংরক্ষিত হয়েছে — নেট ফিরলে সিঙ্ক হবে।' };
  } catch (err) { return { success:false, message:'অফলাইন সংরক্ষণ ব্যর্থ: '+humanizeError(err) }; }
}

async function apiDeleteSupplier(supId) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const doc = await cget(userCol('suppliers').doc(supId));
    if (doc.exists && (doc.data().totalPayable || 0) > 0) {
      return { success: false, message: '৳' + doc.data().totalPayable + ' পাওনা আছে। পরিশোধের পর মুছুন।' };
    }
    await userCol('suppliers').doc(supId).delete();
    return { success: true, message: 'সরবরাহকারী মুছে ফেলা হয়েছে।' };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

async function apiPaySupplierPayable(paymentId, supId, amount, note, supData, opts = {}) {
  const isRetry = !!opts.isRetry;

  if (!navigator.onLine) {
    if (isRetry) return { success: false, message: 'এখনো অফলাইন — পরের সাইকেলে আবার চেষ্টা হবে।' };
    return await queueSupplierPayOffline({ paymentId, supId, amount, note, supData });
  }

  try {
    const supRef = userCol('suppliers').doc(supId);
    const payRef = userCol('supplierPayments').doc(paymentId);

    await withTimeout(fbDb.runTransaction(async (tx) => {
      // ✅ ধাপ ০.১.২: idempotency গার্ড
      const existingPayDoc = await tx.get(payRef);
      if (existingPayDoc.exists) return;

      const supDoc = await tx.get(supRef);
      if (!supDoc.exists) throw new Error('সরবরাহকারী পাওয়া যায়নি।');
      const s = supDoc.data();
      const freshPayable = s.totalPayable || 0;
      const freshTotalPaid = s.totalPaid || 0;

      if (amount > freshPayable + 0.01) {
        throw new Error(`পাওনার (৳${fmt(freshPayable)}) চেয়ে বেশি দেওয়া যাবে না।`);
      }

      const currentBalance = await readCashBalance(tx);

      tx.update(supRef, {
        totalPayable: round2(freshPayable - amount),
        totalPaid: round2(freshTotalPaid + amount),
      });
      tx.set(payRef, {
        paymentId, date: todayStr(), supplierId: supId, supplierName: supData.name, amount,
        branchId: APP_STATE.activeBranchId, createdByUid: APP_STATE.currentUser?.uid || null,
        note: note || 'পাওনা পরিশোধ',
      });
      applyCashDelta(tx, currentBalance, -amount);
    }), FIRESTORE_WRITE_TIMEOUT_MS);

    emitFinancialNotification({
      type: 'supplier_payment', action: 'created', amount, recordId: paymentId,
      title: 'সরবরাহকারী পরিশোধ', message: `${supData.name} — ৳${fmt(amount)}`
    });
    return { success: true, message: `৳${fmt(amount)} পরিশোধ করা হয়েছে।` };
  } catch (err) {
    if (isConnectivityError(err)) {
      if (isRetry) return { success: false, message: 'নেট সংযোগ অস্থির — একটু পর আবার চেষ্টা হবে।' };
      return await queueSupplierPayOffline({ paymentId, supId, amount, note, supData });
    }
    return { success: false, message: humanizeError(err) };
  }
}

// ────────────────────────────────────────────────────────────
// Connectivity-resilience হেল্পার
// navigator.onLine === true হলেও প্রকৃত সংযোগ না থাকতে পারে (fake-online —
// এয়ারপ্লেন মোড, ব্যর্থ WiFi ইত্যাদি)। Firestore transaction অফলাইনে
// কাজ করে না (নরমাল write-এর মতো লোকাল queue হয় না), তাই client-side
// timeout race বাধ্যতামূলক — নাহলে UI চিরকাল "প্রক্রিয়াকরণ হচ্ছে..." দেখাবে
// এবং এন্ট্রি কোথাও সংরক্ষিত না হয়েই হারিয়ে যাবে।
// ────────────────────────────────────────────────────────────
const FIRESTORE_WRITE_TIMEOUT_MS = 10000;     // ১০ সেকেন্ড — এর বেশি অপেক্ষা করা হবে না

class FirestoreTimeoutError extends Error {
  constructor(msg) { super(msg); this.code = 'client-timeout'; }
}

function withTimeout(promise, ms) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new FirestoreTimeoutError('নির্ধারিত সময়ে সার্ভার সাড়া দেয়নি।')), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

// navigator.onLine সত্য বলছে, কিন্তু transaction আসলে network-জনিত কারণে
// ব্যর্থ হয়েছে কিনা তা শনাক্ত করে — যাতে এটাকে ব্যবসায়িক এরর (যেমন
// "স্টক অপর্যাপ্ত") এর সাথে গুলিয়ে না ফেলি।
// ✅ ধাপ ০.৩: netCodes লোকাল অ্যারে বাদ — utils.js-এর শেয়ার্ড NETWORK_ERROR_CODES
// ব্যবহার করা হচ্ছে, যাতে network-error কোডের তালিকা একটাই জায়গায় মেইনটেইন হয়
function isConnectivityError(err) {
  if (!err) return false;
  if (err.code && NETWORK_ERROR_CODES.includes(err.code)) return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('offline') || msg.includes('network') || msg.includes('backend didn') || msg.includes('failed to get document');
}

// অফলাইন-queue-এ পাঠানোর কমন লজিক — সরাসরি অফলাইন-ব্রাঞ্চ থেকেও,
// আর fake-online fallback থেকেও — দুই জায়গা থেকেই ব্যবহৃত হবে
async function queueSaleOffline(sale) {
  try {
    await queueWrite({ type: 'sale', payload: sale });
    APP_STATE.pendingSales = APP_STATE.pendingSales || [];
    APP_STATE.pendingSales.push(sale);
    return { success: true, queued: true, message: `অফলাইনে সংরক্ষিত হয়েছে — Invoice: ${sale.invoiceNo}। নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক হবে।` };
  } catch (err) {
    return { success: false, message: 'অফলাইন সংরক্ষণেও ব্যর্থ: ' + humanizeError(err) };
  }
}

async function queuePurchaseOffline(purchase) {
  try {
    await queueWrite({ type: 'purchase', payload: purchase });
    APP_STATE.pendingPurchases = APP_STATE.pendingPurchases || [];
    APP_STATE.pendingPurchases.push(purchase);
    return { success: true, queued: true, message: `অফলাইনে সংরক্ষিত হয়েছে — Purchase: ${purchase.purchaseId}। নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক হবে।` };
  } catch (err) {
    return { success: false, message: 'অফলাইন সংরক্ষণেও ব্যর্থ: ' + humanizeError(err) };
  }
}

async function queueCustomerDueOffline(payload) {
  try {
    await queueWrite({ type: 'customerDue', payload });
    return { success: true, queued: true, message: `অফলাইনে সংরক্ষিত হয়েছে — বাকি আদায় নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক হবে।` };
  } catch (err) {
    return { success: false, message: 'অফলাইন সংরক্ষণেও ব্যর্থ: ' + humanizeError(err) };
  }
}

async function queueSupplierPayOffline(payload) {
  try {
    await queueWrite({ type: 'supplierPay', payload });
    return { success: true, queued: true, message: `অফলাইনে সংরক্ষিত হয়েছে — পাওনা পরিশোধ নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক হবে।` };
  } catch (err) {
    return { success: false, message: 'অফলাইন সংরক্ষণেও ব্যর্থ: ' + humanizeError(err) };
  }
}

async function queueIncomeOffline(income) {
  try {
    await queueWrite({ type: 'income', payload: income });
    return { success: true, queued: true, message: 'অফলাইনে আয় সংরক্ষিত হয়েছে — নেট ফিরলে সিঙ্ক হবে।' };
  } catch (err) {
    return { success: false, message: 'অফলাইন সংরক্ষণেও ব্যর্থ: ' + humanizeError(err) };
  }
}

async function queueExpenseOffline(exp) {
  try {
    await queueWrite({ type: 'expense', payload: exp });
    return { success: true, queued: true, message: `অফলাইনে সংরক্ষিত হয়েছে — খরচ নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক হবে।` };
  } catch (err) {
    return { success: false, message: 'অফলাইন সংরক্ষণেও ব্যর্থ: ' + humanizeError(err) };
  }
}

async function queueCustomerReturnOffline(payload) {
  try {
    await queueWrite({ type: 'customerReturn', payload });
    // ✅ ফিক্স: pendingReturns-এ এখনই push — returnedQty() এটা দেখতে পাবে,
    // নাহলে sync হওয়ার আগে একই ইনভয়েসে দ্বিতীয়বার আংশিক রিটার্ন করলে
    // over-return অনুমোদন হয়ে যেতে পারত।
    APP_STATE.pendingReturns = APP_STATE.pendingReturns || [];
    APP_STATE.pendingReturns.push(payload.returnDoc);
    return { success: true, queued: true, message: `অফলাইনে সংরক্ষিত হয়েছে — রিটার্ন নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক হবে।` };
  } catch (err) {
    return { success: false, message: 'অফলাইন সংরক্ষণেও ব্যর্থ: ' + humanizeError(err) };
  }
}

async function queueSupplierReturnOffline(payload) {
  try {
    await queueWrite({ type: 'supplierReturn', payload });
    // ✅ ফিক্স: একই কারণে
    APP_STATE.pendingReturns = APP_STATE.pendingReturns || [];
    APP_STATE.pendingReturns.push(payload.returnDoc);
    return { success: true, queued: true, message: `অফলাইনে সংরক্ষিত হয়েছে — রিটার্ন/রাইট-অফ নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক হবে।` };
  } catch (err) {
    return { success: false, message: 'অফলাইন সংরক্ষণেও ব্যর্থ: ' + humanizeError(err) };
  }
}

async function queueMedicineAddOffline(payload) {
  try {
    await queueWrite({ type: 'medicineAdd', payload });
    return { success: true, queued: true, medId: payload.id, message: `অফলাইনে সংরক্ষিত হয়েছে — "${payload.brand}" নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক হবে।` };
  } catch (err) {
    return { success: false, message: 'অফলাইন সংরক্ষণেও ব্যর্থ: ' + humanizeError(err) };
  }
}

async function queueCustomerAddOffline(payload) {
  try {
    await queueWrite({ type: 'customerAdd', payload });
    return { success: true, queued: true, message: `অফলাইনে সংরক্ষিত হয়েছে — "${payload.name}" নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক হবে।` };
  } catch (err) {
    return { success: false, message: 'অফলাইন সংরক্ষণেও ব্যর্থ: ' + humanizeError(err) };
  }
}

async function queueSupplierAddOffline(payload) {
  try {
    await queueWrite({ type: 'supplierAdd', payload });
    return { success: true, queued: true, message: `অফলাইনে সংরক্ষিত হয়েছে — "${payload.name}" নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক হবে।` };
  } catch (err) {
    return { success: false, message: 'অফলাইন সংরক্ষণেও ব্যর্থ: ' + humanizeError(err) };
  }
}
// ────────────────────────────────────────────────────────────
// SALE (POS)
// ────────────────────────────────────────────────────────────
function computeFEFODeduction(invData, qty) {
  const batches = (invData.batches || []).map(b => ({ ...b }));
  batches.sort((a, b) => compareBatchExpiry(a, b, 'asc')); // ✅ ধাপ ৩১ ফিক্স
  let remaining = qty;
  let totalCost = 0;
  const consumed = []; // ✅ কোন batchId থেকে কত ইউনিট + কী cost-এ কাটা হলো — restock/return-এর জন্য দরকার

  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.stock, remaining);
    if (take > 0) {
      totalCost += take * (b.cost || 0);
      consumed.push({
        batchId: b.batchId,
        batchNumber: b.batchNumber || b.batchId,
        qty: take,
        cost: b.cost || 0,
        mrp: b.mrp || 0,
        expiry: b.expiry || '',
        sell: b.sell || 0,
        unitsPerStrip: b.unitsPerStrip || 1,
        stripsPerBox: b.stripsPerBox || 1,
      });
      b.stock -= take;
      remaining -= take;
    }
  }
  if (remaining > 0) return null;

  const rb = batches.filter(b => b.stock > 0);
  return {
    batches: rb,
    totalStock: rb.reduce((a, b) => a + b.stock, 0),
    costValue: round2(rb.reduce((a, b) => a + b.cost * b.stock, 0)),
    mrpValue: round2(rb.reduce((a, b) => a + b.mrp * b.stock, 0)),
    nearestExpiry: rb[0]?.expiry || '',
    weightedCost: round2(totalCost / qty), // ✅ একাধিক ব্যাচ থেকে কাটলে সঠিক গড় COGS
    consumedBatches: consumed,             // ✅ পরে ফেরত/রিটার্নে সঠিক ব্যাচে বসাতে
  };
}

// ✅ কমন হেল্পার: sale/return item-এর consumedBatches অনুযায়ী ঠিক সেই ব্যাচেই স্টক
// ফেরত দেয় যেখান থেকে আসলে কাটা হয়েছিল। consumedBatches না থাকলে (ফিক্সের আগের
// পুরনো রেকর্ড) fallback হিসেবে batches[0]-এ ঢালে — আগের আচরণের সাথে সামঞ্জস্যপূর্ণ।
function restockBatchesFromConsumed(batches, item, fallbackBatchIdPrefix, sellFallback) {
  if (item.consumedBatches && item.consumedBatches.length) {
    item.consumedBatches.forEach(cb => {
      const target = batches.find(b => b.batchId === cb.batchId);
      if (target) target.stock += cb.qty;
      else batches.push({
        batchId: cb.batchId,
        batchNumber: cb.batchNumber || cb.batchId,
        expiry: cb.expiry || '',
        stock: cb.qty,
        cost: cb.cost || 0,
        mrp: cb.mrp || 0,
        sell: cb.sell || sellFallback || 0,
        unitsPerStrip: cb.unitsPerStrip || 1,
        stripsPerBox: cb.stripsPerBox || 1,
      });
    });
  } else {
    if (batches.length) batches[0] = { ...batches[0], stock: batches[0].stock + item.qty };
    else batches.push({ batchId: fallbackBatchIdPrefix + '-' + Date.now(), expiry: '', stock: item.qty, cost: item.costPrice || 0, mrp: 0, sell: sellFallback || 0 });
  }
  return batches;
}

async function apiSubmitSale(sale, opts = {}) {
  const isRetry = !!opts.isRetry;
  if (!sale.branchId) sale.branchId = APP_STATE.activeBranchId;
  if (!sale.branchId) throw new Error('কোনো active Branch নির্বাচন করা হয়নি।');
  if (!sale.createdByUid) sale.createdByUid = APP_STATE.currentUser?.uid || null; // ✅ [Track A]
  if (!navigator.onLine) {
    if (isRetry) return { success: false, message: 'এখনো অফলাইন — পরের সাইকেলে আবার চেষ্টা হবে।' };
    return await queueSaleOffline(sale);
  }

  try {
    const invRefs = sale.items.map(item => userCol('inventory').doc(item.medId));
    const hasCustomer = sale.customerId && sale.customerId !== 'WALK_IN';
    const custRef = hasCustomer ? userCol('customers').doc(sale.customerId) : null;
    const saleRef = userCol('sales').doc(sale.invoiceNo);

    await withTimeout(fbDb.runTransaction(async (tx) => {
      const existingSaleDoc = await tx.get(saleRef);
      const invDocs = await Promise.all(invRefs.map(r => tx.get(r)));
      const custDoc = custRef ? await tx.get(custRef) : null;

      if (existingSaleDoc.exists) {
        // ইতিমধ্যে সফলভাবে সংরক্ষিত — নিরাপদে no-op, ডাবল-ডিডাকশন রোধ
        // (কোনো write হচ্ছে না, তাই cash balance-ও স্পর্শ করা হচ্ছে না)
        return;
      }

      // ✅ ধাপ ৩২.২: cash balance read — write-এর আগে
      const currentBalance = await readCashBalance(tx);

      const invUpdates = [];
      for (let i = 0; i < sale.items.length; i++) {
        const item = sale.items[i], invDoc = invDocs[i];
        if (!invDoc.exists) throw new Error(`"${item.name}" ইনভেন্টরিতে পাওয়া যায়নি।`);
        const result = computeFEFODeduction(invDoc.data(), item.qty);
        if (!result) throw new Error(`"${item.name}" স্টক অপর্যাপ্ত।`);

        // ✅ ফিক্স: প্রথম-ব্যাচের cost না — একাধিক ব্যাচ থেকে কাটা হলে সঠিক
        // weighted-average COGS এখন sale.items-এ বসানো হচ্ছে, commit হওয়ার আগেই।
        item.costPrice = result.weightedCost;
        item.consumedBatches = result.consumedBatches;

        // ✅ ফিক্স (ধাপ ২৩): computeInventoryDerivedFields() দিয়ে
        // status/nearestExpiry-সহ সব ফিল্ড ঠিকভাবে রিক্যালকুলেট
        const med = APP_STATE.medicines.find(m => m.id === item.medId);
        const reorderLevel = getEffectiveReorderLevel(med);
        const derived = computeInventoryDerivedFields(result.batches, reorderLevel);

        invUpdates.push({
          ref: invRefs[i],
          fields: {
            batches: derived.batches,
            totalStock: derived.totalStock,
            costValue: derived.costValue,
            mrpValue: derived.mrpValue,
            nearestExpiry: derived.nearestExpiry,
            status: derived.status,
          },
        });
      }

      let custUpdate = null;
      if (custRef && custDoc && custDoc.exists) {
        const c = custDoc.data();
        custUpdate = {
          due: round2((c.due || 0) + (sale.due || 0)),
          totalPaid: round2((c.totalPaid || 0) + (sale.cashPaid || 0)),
        };
      }

      tx.set(saleRef, sale);
      invUpdates.forEach(u => tx.update(u.ref, u.fields));
      if (custRef && custUpdate) tx.update(custRef, custUpdate);
      // ✅ ধাপ ৩২.২: নগদ বিক্রয় = cash বৃদ্ধি
      applyCashDelta(tx, currentBalance, sale.cashPaid || 0);
    }), FIRESTORE_WRITE_TIMEOUT_MS);

    emitFinancialNotification({
      type: 'sale', action: 'created', amount: sale.totalBill || 0, recordId: sale.invoiceNo,
      title: 'নতুন বিক্রয়', message: `Invoice ${sale.invoiceNo} — ৳${fmt(sale.totalBill || 0)}`
    });
    return { success: true, message: `বিক্রয় সফল! Invoice: ${sale.invoiceNo}` };
  } catch (err) {
    if (isConnectivityError(err)) {
      if (isRetry) {
        return { success: false, message: 'নেট সংযোগ অস্থির — একটু পর আবার চেষ্টা হবে।' };
      }
      return await queueSaleOffline(sale);
    }
    return { success: false, message: humanizeError(err) };
  }
}

async function apiUpdateSale(invoiceNo, fields) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const saleRef = userCol('sales').doc(invoiceNo);
    await fbDb.runTransaction(async (tx) => {
      const saleDoc = await tx.get(saleRef);
      if (!saleDoc.exists) throw new Error('বিক্রয় রেকর্ড পাওয়া যায়নি।');
      const oldSale = saleDoc.data();
      const newSale = { ...oldSale, ...fields, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedByUid: APP_STATE.currentUser?.uid || null };
      const currentBalance = await readCashBalance(tx);
      let custRef = null;
      let custDoc = null;
      if (oldSale.customerId && oldSale.customerId !== 'WALK_IN') {
        custRef = userCol('customers').doc(oldSale.customerId);
        custDoc = await tx.get(custRef);
      }
      tx.set(saleRef, newSale, { merge: true });
      applyCashDelta(tx, currentBalance, (Number(newSale.cashPaid || 0) - Number(oldSale.cashPaid || 0)));
      if (custRef && custDoc) {
        if (custDoc.exists) {
          const oldCust = custDoc.data();
          tx.update(custRef, {
            due: round2(Math.max(0, (oldCust.due || 0) - Number(oldSale.due || 0) + Number(newSale.due || 0))),
            totalPaid: round2(Math.max(0, (oldCust.totalPaid || 0) - Number(oldSale.cashPaid || 0) + Number(newSale.cashPaid || 0))),
          });
        }
      }
    }, FIRESTORE_WRITE_TIMEOUT_MS);
    return { success: true, message: 'বিক্রয় রেকর্ড আপডেট হয়েছে।' };
  } catch (err) {
    return { success: false, message: humanizeError(err) };
  }
}

async function apiDeleteSale(sale) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const uniqueMedIds = [...new Set(sale.items.map(i => i.medId))];
    const invRefs = uniqueMedIds.map(id => userCol('inventory').doc(id));
    const hasCustomer = sale.customerId && sale.customerId !== 'WALK_IN';
    const custRef = hasCustomer ? userCol('customers').doc(sale.customerId) : null;

    await fbDb.runTransaction(async (tx) => {
      const invDocs = await Promise.all(invRefs.map(r => tx.get(r)));
      const custDoc = custRef ? await tx.get(custRef) : null;
      // ✅ ধাপ ৩২.২
      const currentBalance = await readCashBalance(tx);

      const invMap = {};
      uniqueMedIds.forEach((id, i) => { invMap[id] = { ref: invRefs[i], data: invDocs[i].exists ? { ...invDocs[i].data() } : null, medId: id }; });

      sale.items.forEach(item => {
        const e = invMap[item.medId]; if (!e.data) return;
        // ✅ ফিক্স: batches[0]-এ ঢালার বদলে item.consumedBatches অনুযায়ী
        // ঠিক সেই ব্যাচেই স্টক ফেরত — batch-wise expiry/cost integrity বজায় থাকে
        e.data.batches = restockBatchesFromConsumed([...(e.data.batches || [])], item, 'BAT-VOID', e.data.sellPrice);
      });

      let custFields = null;
      if (custRef && custDoc && custDoc.exists) {
        custFields = { due: Math.max(0, round2((custDoc.data().due || 0) - (sale.due || 0))), totalPaid: Math.max(0, round2((custDoc.data().totalPaid || 0) - (sale.cashPaid || 0))) };
      }

      tx.delete(userCol('sales').doc(sale.invoiceNo));
      Object.values(invMap).forEach(e => {
        if (!e.data) return;
        // ✅ ফিক্স (ধাপ ২৩): status/nearestExpiry এখন সঠিকভাবে রিক্যালকুলেট
        const med = APP_STATE.medicines.find(m => m.id === e.medId);
        const reorderLevel = getEffectiveReorderLevel(med);
        const derived = computeInventoryDerivedFields(e.data.batches, reorderLevel);
        tx.set(e.ref, {
          ...e.data,
          batches: derived.batches,
          totalStock: derived.totalStock,
          costValue: derived.costValue,
          mrpValue: derived.mrpValue,
          nearestExpiry: derived.nearestExpiry,
          status: derived.status,
        }, { merge: true });
      });
      if (custRef && custFields) tx.update(custRef, custFields);
      // ✅ ধাপ ৩২.২: বিক্রয় ডিলিট = cash হ্রাস (আগে যোগ হওয়া নগদ ফেরত)
      applyCashDelta(tx, currentBalance, -(sale.cashPaid || 0));
    });

    emitFinancialNotification({
      type: 'sale_delete', action: 'deleted', amount: sale.totalBill || 0, recordId: sale.invoiceNo,
      title: 'বিক্রয় রেকর্ড মুছে ফেলা হয়েছে', message: `Invoice ${sale.invoiceNo}`
    });
    return { success: true, message: 'বিক্রয় মুছে ফেলা হয়েছে, স্টক/বাকি ফেরত হয়েছে।' };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}


// ────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
// PURCHASE — apiSubmitPurchase (✅ computeInventoryDerivedFields ব্যবহার করছে)
// ────────────────────────────────────────────────────────────
async function apiSubmitPurchase(purchase, opts = {}) {
  const isRetry = !!opts.isRetry;
  if (!purchase.branchId) purchase.branchId = APP_STATE.activeBranchId;
  if (!purchase.branchId) throw new Error('কোনো active Branch নির্বাচন করা হয়নি।');
  if (!purchase.createdByUid) purchase.createdByUid = APP_STATE.currentUser?.uid || null; // ✅ [Track A]
  if (!navigator.onLine) {
    if (isRetry) return { success: false, message: 'এখনো অফলাইন — পরের সাইকেলে আবার চেষ্টা হবে।' };
    return await queuePurchaseOffline(purchase);
  }

  try {
    const invRefs = purchase.items.map(item => userCol('inventory').doc(item.medId));
    const supRef = userCol('suppliers').doc(purchase.supplierId);
    const purRef = userCol('purchases').doc(purchase.purchaseId);

    await withTimeout(fbDb.runTransaction(async (tx) => {
      // ✅ সব read আগে
      const existingPurDoc = await tx.get(purRef);
      const invDocs = await Promise.all(invRefs.map(r => tx.get(r)));
      const supDoc = await tx.get(supRef);

      if (existingPurDoc.exists) {
        // ইতিমধ্যে সফলভাবে সংরক্ষিত — no-op (কোনো write না, cash-ও অপরিবর্তিত)
        return;
      }

      // ✅ ধাপ ৩২.২
      const currentBalance = await readCashBalance(tx);

      const invUpdates = purchase.items.map((item, idx) => {
        const invDoc = invDocs[idx];
        const batchSuffix = item.batchId
          || (typeof genCanonicalBatchId === 'function'
            ? genCanonicalBatchId(purchase.purchaseId, item.batchNumber, idx)
            : ('BAT-' + String(purchase.purchaseId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(-12) + '-' + String(idx + 1).padStart(2, '0')));
        const newBatch = {
          batchId: batchSuffix,
          batchNumber: item.batchNumber || batchSuffix,
          expiry: item.expiryDate || '',
          stock: item.qty,
          cost: item.purchasePrice,
          mrp: item.mrp,
          sell: item.sellPrice || 0,
          ...(item.unitsPerStrip !== undefined ? { unitsPerStrip: positivePackNumber(item.unitsPerStrip, 1) } : {}),
          ...(item.stripsPerBox !== undefined ? { stripsPerBox: positivePackNumber(item.stripsPerBox, 1) } : {}),
        };
        item.batchId = newBatch.batchId; // delete-এর সময় সঠিক ব্যাচ খুঁজতে
        const existing = invDoc.exists ? invDoc.data() : null;
        const rawBatches = [...(existing?.batches || [])];
        const matchingBatchIndex = rawBatches.findIndex(b =>
          (item.batchNumber && b.batchNumber === item.batchNumber) ||
          (b.batchId === newBatch.batchId)
        );
        if (matchingBatchIndex >= 0) {
          const existingBatch = rawBatches[matchingBatchIndex];
          item.batchId = existingBatch.batchId || newBatch.batchId;
          rawBatches[matchingBatchIndex] = {
            ...existingBatch,
            batchId: item.batchId,
            stock: (existingBatch.stock || 0) + item.qty,
            cost: item.purchasePrice,
            mrp: item.mrp,
            sell: item.sellPrice || existingBatch.sell || 0,
            expiry: item.expiryDate || existingBatch.expiry || '',
            batchNumber: item.batchNumber || existingBatch.batchNumber || existingBatch.batchId,
            ...(item.unitsPerStrip !== undefined ? { unitsPerStrip: positivePackNumber(item.unitsPerStrip, existingBatch.unitsPerStrip || 1) } : {}),
            ...(item.stripsPerBox !== undefined ? { stripsPerBox: positivePackNumber(item.stripsPerBox, existingBatch.stripsPerBox || 1) } : {}),
          };
        } else {
          rawBatches.push(newBatch);
        }
        const reorderLevel = getEffectiveReorderLevel({ reorderLevel: item.reorderLevel });

        // ✅ ফিক্স (ধাপ ২৩, রিফ্যাক্টর): shared হেল্পার — status/nearestExpiry সহ সব ফিল্ড
        const derived = computeInventoryDerivedFields(rawBatches, reorderLevel);

        const fields = {
          medId: item.medId, brand: item.brand, doseForm: item.doseForm || '', strength: item.strength || '',
          batches: derived.batches,
          totalStock: derived.totalStock,
          costValue: derived.costValue,
          mrpValue: derived.mrpValue,
          nearestExpiry: derived.nearestExpiry,
          sellPrice: item.sellPrice > 0 ? item.sellPrice : (existing?.sellPrice || 0),
          status: derived.status,
        };
        return { ref: invRefs[idx], fields, exists: invDoc.exists };
      });

      let supUpdate = null;
      if (supDoc.exists) {
        const sup = supDoc.data();
        supUpdate = purchase.paymentType === 'বাকি' ? { totalPayable: round2((sup.totalPayable || 0) + purchase.totalCost) } : { totalPaid: round2((sup.totalPaid || 0) + purchase.totalCost) };
      }

      // ✅ সব write পরে
      tx.set(purRef, purchase);
      invUpdates.forEach(u => { if (u.exists) tx.update(u.ref, u.fields); else tx.set(u.ref, u.fields); });
      if (supUpdate) tx.update(supRef, supUpdate);
      // ✅ ধাপ ৩২.২: শুধু নগদ ক্রয় হলেই cash কমে, বাকি ক্রয়ে cash অপরিবর্তিত
      if (purchase.paymentType === 'নগদ') applyCashDelta(tx, currentBalance, -purchase.totalCost);
    }), FIRESTORE_WRITE_TIMEOUT_MS);

    emitFinancialNotification({
      type: 'purchase', action: 'created', amount: purchase.totalCost || 0, recordId: purchase.purchaseId,
      title: 'নতুন ক্রয়', message: `ক্রয় ${purchase.purchaseId} — ৳${fmt(purchase.totalCost || 0)}`
    });
    return { success: true, message: `ক্রয় রেকর্ড হয়েছে! Invoice: ${purchase.purchaseId}` };
  } catch (err) {
    if (isConnectivityError(err)) {
      if (isRetry) {
        return { success: false, message: 'নেট সংযোগ অস্থির — একটু পর আবার চেষ্টা হবে।' };
      }
      return await queuePurchaseOffline(purchase);
    }
    return { success: false, message: humanizeError(err) };
  }
}

async function apiUpdatePurchase(purchaseId, fields) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const purRef = userCol('purchases').doc(purchaseId);
    await fbDb.runTransaction(async (tx) => {
      const purDoc = await tx.get(purRef);
      if (!purDoc.exists) throw new Error('ক্রয় রেকর্ড পাওয়া যায়নি।');
      const oldPur = purDoc.data();
      const newPur = { ...oldPur, ...fields, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedByUid: APP_STATE.currentUser?.uid || null };
      const oldCashOut = oldPur.paymentType === 'নগদ' ? Number(oldPur.totalCost || 0) : 0;
      const newCashOut = newPur.paymentType === 'নগদ' ? Number(newPur.totalCost || 0) : 0;
      const currentBalance = await readCashBalance(tx);
      let supRef = null;
      let supDoc = null;
      if (oldPur.supplierId) {
        supRef = userCol('suppliers').doc(oldPur.supplierId);
        supDoc = await tx.get(supRef);
      }
      tx.set(purRef, newPur, { merge: true });
      applyCashDelta(tx, currentBalance, oldCashOut - newCashOut);
      if (supRef && supDoc) {
        if (supDoc.exists) {
          const sup = supDoc.data();
          const oldPayable = oldPur.paymentType === 'বাকি' ? Number(oldPur.totalCost || 0) : 0;
          const newPayable = newPur.paymentType === 'বাকি' ? Number(newPur.totalCost || 0) : 0;
          const oldPaid = oldCashOut;
          const newPaid = newCashOut;
          tx.update(supRef, {
            totalPayable: round2(Math.max(0, (sup.totalPayable || 0) - oldPayable + newPayable)),
            totalPaid: round2(Math.max(0, (sup.totalPaid || 0) - oldPaid + newPaid)),
          });
        }
      }
    }, FIRESTORE_WRITE_TIMEOUT_MS);
    return { success: true, message: 'ক্রয় রেকর্ড আপডেট হয়েছে।' };
  } catch (err) {
    return { success: false, message: humanizeError(err) };
  }
}

async function apiDeletePurchase(purchase) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const invRefs = purchase.items.map(i => userCol('inventory').doc(i.medId));
    const supRef = userCol('suppliers').doc(purchase.supplierId);

    await fbDb.runTransaction(async (tx) => {
      // ✅ সব read আগে
      const invDocs = await Promise.all(invRefs.map(r => tx.get(r)));
      const supDoc = await tx.get(supRef);
      // ✅ ধাপ ৩২.২
      const currentBalance = await readCashBalance(tx);

      const invUpdates = purchase.items.map((item, idx) => {
        const invDoc = invDocs[idx]; if (!invDoc.exists) return null;
        const inv = invDoc.data();
        const remainingBatches = (inv.batches || []).map(b =>
          b.batchId === item.batchId
            ? { ...b, stock: Math.max(0, round2((b.stock || 0) - (item.qty || 0))) }
            : b
        ).filter(b => (b.stock || 0) > 0);
        // ✅ ফিক্স (ধাপ ২৩): status/nearestExpiry এখন সঠিকভাবে রিক্যালকুলেট
        const med = APP_STATE.medicines.find(m => m.id === item.medId);
        const reorderLevel = getEffectiveReorderLevel(med);
        const derived = computeInventoryDerivedFields(remainingBatches, reorderLevel);
        return {
          ref: invRefs[idx],
          fields: {
            batches: derived.batches,
            totalStock: derived.totalStock,
            costValue: derived.costValue,
            mrpValue: derived.mrpValue,
            nearestExpiry: derived.nearestExpiry,
            status: derived.status,
          },
        };
      }).filter(Boolean);

      let supFields = null;
      if (supDoc.exists) {
        const sup = supDoc.data();
        supFields = purchase.paymentType === 'বাকি' ? { totalPayable: Math.max(0, round2((sup.totalPayable || 0) - purchase.totalCost)) } : { totalPaid: Math.max(0, round2((sup.totalPaid || 0) - purchase.totalCost)) };
      }

      // ✅ সব write পরে
      tx.delete(userCol('purchases').doc(purchase.purchaseId));
      invUpdates.forEach(u => tx.update(u.ref, u.fields));
      if (supFields) tx.update(supRef, supFields);
      // ✅ ধাপ ৩২.২: নগদ ক্রয় ডিলিট = cash ফেরত
      if (purchase.paymentType === 'নগদ') applyCashDelta(tx, currentBalance, purchase.totalCost);
    });

    emitFinancialNotification({
      type: 'purchase_delete', action: 'deleted', amount: purchase.totalCost || 0, recordId: purchase.purchaseId,
      title: 'ক্রয় রেকর্ড মুছে ফেলা হয়েছে', message: `ক্রয় ${purchase.purchaseId}`
    });
    return { success: true, message: 'ক্রয় মুছে ফেলা হয়েছে, স্টক/পাওনা ফেরত হয়েছে।' };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

// ────────────────────────────────────────────────────────────
// RETURNS
// ────────────────────────────────────────────────────────────
async function apiSubmitCustomerReturn(returnDoc, custId, custDueReduction, opts = {}) {
  const isRetry = !!opts.isRetry;
  if (!returnDoc.branchId) returnDoc.branchId = APP_STATE.activeBranchId;
  if (!returnDoc.branchId) throw new Error('কোনো active Branch নির্বাচন করা হয়নি।');
  if (!returnDoc.createdByUid) returnDoc.createdByUid = APP_STATE.currentUser?.uid || null; // ✅ [Track A]
  if (!navigator.onLine) {
    if (isRetry) return { success: false, message: 'এখনো অফলাইন — পরের সাইকেলে আবার চেষ্টা হবে।' };
    return await queueCustomerReturnOffline({ returnDoc, custId, custDueReduction });
  }

  try {
    const uniqueMedIds = [...new Set(returnDoc.items.map(i => i.medId))];
    const invRefs = uniqueMedIds.map(id => userCol('inventory').doc(id));
    const custRef = custDueReduction > 0 ? userCol('customers').doc(custId) : null;
    const retRef = userCol('returns').doc(returnDoc.returnId);

    await withTimeout(fbDb.runTransaction(async (tx) => {
      // ✅ ধাপ ০.১.৩: idempotency গার্ড — sale/purchase/customerDue প্যাটার্ন
      const existingRetDoc = await tx.get(retRef);
      if (existingRetDoc.exists) return;

      const invDocs = await Promise.all(invRefs.map(r => tx.get(r)));
      const custDoc = custRef ? await tx.get(custRef) : null;
      const currentBalance = await readCashBalance(tx);

      const invMap = {};
      uniqueMedIds.forEach((id, idx) => { invMap[id] = { ref: invRefs[idx], data: invDocs[idx].exists ? { ...invDocs[idx].data() } : null, medId: id }; });

      returnDoc.items.forEach(item => {
        const e = invMap[item.medId]; if (!e.data) return;
        e.data.batches = restockBatchesFromConsumed([...(e.data.batches || [])], item, 'BAT-RET', e.data.sellPrice);
      });

      let custFields = null;
      if (custRef && custDoc && custDoc.exists) {
        custFields = { due: round2((custDoc.data().due || 0) - custDueReduction) };
      }

      tx.set(retRef, returnDoc);
      Object.values(invMap).forEach(e => {
        if (!e.data) return;
        const med = APP_STATE.medicines.find(m => m.id === e.medId);
        const reorderLevel = getEffectiveReorderLevel(med);
        const derived = computeInventoryDerivedFields(e.data.batches, reorderLevel);
        tx.set(e.ref, {
          ...e.data,
          batches: derived.batches,
          totalStock: derived.totalStock,
          costValue: derived.costValue,
          mrpValue: derived.mrpValue,
          nearestExpiry: derived.nearestExpiry,
          status: derived.status,
        }, { merge: true });
      });
      if (custRef && custFields) tx.update(custRef, custFields);
      if (returnDoc.refundMethod === 'নগদ ফেরত') applyCashDelta(tx, currentBalance, -returnDoc.amount);
    }), FIRESTORE_WRITE_TIMEOUT_MS);

    emitFinancialNotification({
      type: 'return', action: 'created', amount: returnDoc.amount || 0, recordId: returnDoc.returnId,
      title: 'কাস্টমার রিটার্ন', message: `${returnDoc.refName || ''} — ৳${fmt(returnDoc.amount || 0)}`
    });
    return { success: true, message: 'রিটার্ন সফল হয়েছে!' };
  } catch (err) {
    if (isConnectivityError(err)) {
      if (isRetry) return { success: false, message: 'নেট সংযোগ অস্থির — একটু পর আবার চেষ্টা হবে।' };
      return await queueCustomerReturnOffline({ returnDoc, custId, custDueReduction });
    }
    return { success: false, message: humanizeError(err) };
  }
}

async function apiSubmitSupplierReturn(returnDoc, supId, supPayableReduction, opts = {}) {
  const isRetry = !!opts.isRetry;
  if (!returnDoc.branchId) returnDoc.branchId = APP_STATE.activeBranchId;
  if (!returnDoc.branchId) throw new Error('কোনো active Branch নির্বাচন করা হয়নি।');
  if (!returnDoc.createdByUid) returnDoc.createdByUid = APP_STATE.currentUser?.uid || null; // ✅ [Track A]
  if (!navigator.onLine) {
    if (isRetry) return { success: false, message: 'এখনো অফলাইন — পরের সাইকেলে আবার চেষ্টা হবে।' };
    return await queueSupplierReturnOffline({ returnDoc, supId, supPayableReduction });
  }

  try {
    const uniqueMedIds = [...new Set(returnDoc.items.map(i => i.medId))];
    const invRefs = uniqueMedIds.map(id => userCol('inventory').doc(id));
    const supRef = supPayableReduction > 0 ? userCol('suppliers').doc(supId) : null;
    const retRef = userCol('returns').doc(returnDoc.returnId);

    await withTimeout(fbDb.runTransaction(async (tx) => {
      // ✅ ধাপ ০.১.৩: idempotency গার্ড
      const existingRetDoc = await tx.get(retRef);
      if (existingRetDoc.exists) return;

      const invDocs = await Promise.all(invRefs.map(r => tx.get(r)));
      const supDoc = supRef ? await tx.get(supRef) : null;
      const currentBalance = await readCashBalance(tx);

      const invMap = {};
      uniqueMedIds.forEach((id, idx) => { invMap[id] = { ref: invRefs[idx], data: invDocs[idx].exists ? { ...invDocs[idx].data() } : null, medId: id }; });

      returnDoc.items.forEach(item => {
        const e = invMap[item.medId]; if (!e.data) return;
        let batches = [...(e.data.batches || [])];
        if (item.batchId) {
          const idx = batches.findIndex(b => b.batchId === item.batchId);
          if (idx === -1) throw new Error(`"${item.name}" — নির্দিষ্ট ব্যাচ পাওয়া যায়নি (হয়তো ইতিমধ্যে অন্য কোথাও শেষ হয়ে গেছে)।`);
          if (batches[idx].stock < item.qty) throw new Error(`"${item.name}" — এই ব্যাচে পর্যাপ্ত স্টক নেই (আছে: ${batches[idx].stock})।`);
          batches[idx] = { ...batches[idx], stock: batches[idx].stock - item.qty };
        } else {
          batches.sort((a, b) => compareBatchExpiry(a, b, 'desc'));
          let remaining = item.qty;
          batches = batches.map(b => { if (remaining <= 0) return b; const take = Math.min(b.stock, remaining); remaining -= take; return { ...b, stock: b.stock - take }; });
        }
        e.data.batches = batches.filter(b => b.stock > 0);
      });

      let supFields = null;
      if (supRef && supDoc && supDoc.exists) {
        supFields = { totalPayable: Math.max(0, round2((supDoc.data().totalPayable || 0) - supPayableReduction)) };
      }

      tx.set(retRef, returnDoc);
      Object.values(invMap).forEach(e => {
        if (!e.data) return;
        const med = APP_STATE.medicines.find(m => m.id === e.medId);
        const reorderLevel = getEffectiveReorderLevel(med);
        const derived = computeInventoryDerivedFields(e.data.batches, reorderLevel);
        tx.set(e.ref, {
          ...e.data,
          batches: derived.batches,
          totalStock: derived.totalStock,
          costValue: derived.costValue,
          mrpValue: derived.mrpValue,
          nearestExpiry: derived.nearestExpiry,
          status: derived.status,
        }, { merge: true });
      });
      if (supRef && supFields) tx.update(supRef, supFields);
      if (returnDoc.reason === 'ফেরত' && returnDoc.refundMethod === 'নগদ ফেরত') {
        applyCashDelta(tx, currentBalance, returnDoc.amount);
      }
    }), FIRESTORE_WRITE_TIMEOUT_MS);

    emitFinancialNotification({
      type: 'return', action: 'created', amount: returnDoc.amount || 0, recordId: returnDoc.returnId,
      title: 'সরবরাহকারী রিটার্ন', message: `${returnDoc.refName || ''} — ৳${fmt(returnDoc.amount || 0)}`
    });
    return { success: true, message: returnDoc.reason === 'ধ্বংস' ? 'মেয়াদোত্তীর্ণ পণ্য রাইট-অফ হয়েছে!' : 'সাপ্লায়ার রিটার্ন সফল!' };
  } catch (err) {
    if (isConnectivityError(err)) {
      if (isRetry) return { success: false, message: 'নেট সংযোগ অস্থির — একটু পর আবার চেষ্টা হবে।' };
      return await queueSupplierReturnOffline({ returnDoc, supId, supPayableReduction });
    }
    return { success: false, message: humanizeError(err) };
  }
}

async function apiDeleteReturn(ret) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const uniqueMedIds = [...new Set(ret.items.map(i => i.medId))];
    const invRefs = uniqueMedIds.map(id => userCol('inventory').doc(id));

    let partyRef = null;
    if (ret.returnType === 'customer' && ret.refundMethod === 'বাকি সমন্বয়') {
      partyRef = userCol('customers').doc(ret.partyId);
    } else if (ret.returnType === 'supplier' && ret.reason === 'ফেরত' && ret.refundMethod === 'পাওনা সমন্বয়') {
      partyRef = userCol('suppliers').doc(ret.partyId);
    }

    await fbDb.runTransaction(async (tx) => {
      const invDocs = await Promise.all(invRefs.map(r => tx.get(r)));
      const partyDoc = partyRef ? await tx.get(partyRef) : null;
      // ✅ ধাপ ৩২.৩
      const currentBalance = await readCashBalance(tx);

      const invMap = {};
      uniqueMedIds.forEach((id, i) => { invMap[id] = { ref: invRefs[i], data: invDocs[i].exists ? { ...invDocs[i].data() } : null, medId: id }; });

      if (ret.returnType === 'customer') {
        ret.items.forEach(item => {
          const e = invMap[item.medId]; if (!e.data) return;
          let batches = [...(e.data.batches || [])];
          if (item.consumedBatches && item.consumedBatches.length) {
            // ✅ ফিক্স: precise undo — ঠিক যে ব্যাচে return-এর সময় স্টক যোগ হয়েছিল, সেখান থেকেই বাদ
            item.consumedBatches.forEach(cb => {
              const target = batches.find(b => b.batchId === cb.batchId);
              if (target) target.stock = Math.max(0, target.stock - cb.qty);
            });
            batches = batches.filter(b => b.stock > 0);
          } else {
            // ফলব্যাক: পুরনো রেকর্ড — generic FEFO destock
            let remaining = item.qty;
            batches = batches.map(b => { if (remaining <= 0) return b; const take = Math.min(b.stock, remaining); remaining -= take; return { ...b, stock: b.stock - take }; }).filter(b => b.stock > 0);
          }
          e.data.batches = batches;
        });
      } else {
        ret.items.forEach(item => {
          const e = invMap[item.medId]; if (!e.data) return;
          let batches = [...(e.data.batches || [])];
          // ✅ ফিক্স: batchId থাকলে ঠিক সেই ব্যাচে precise restock;
          // না থাকলে (legacy) এক্সপ্লিসিট expiry-sort করে soonest-expiry
          // ব্যাচেই ফেরত — batches[0]-এর উপর implicit নির্ভরতা বাদ, self-contained
          if (item.batchId) {
            const idx = batches.findIndex(b => b.batchId === item.batchId);
            if (idx !== -1) batches[idx] = { ...batches[idx], stock: batches[idx].stock + item.qty };
            else batches.push({ batchId: item.batchId, expiry: '', stock: item.qty, cost: item.purchasePrice || 0, mrp: 0, sell: e.data.sellPrice || 0 });
          } else {
            if (batches.length) {
              batches.sort((a, b) => (parseExpiryDate(a.expiry) || Infinity) - (parseExpiryDate(b.expiry) || Infinity));
              batches[0] = { ...batches[0], stock: batches[0].stock + item.qty };
            } else {
              batches.push({ batchId: 'BAT-VOID-' + Date.now(), expiry: '', stock: item.qty, cost: item.purchasePrice || 0, mrp: 0, sell: e.data.sellPrice || 0 });
            }
          }
          e.data.batches = batches;
        });
      }

      let partyFields = null;
      if (partyRef && partyDoc && partyDoc.exists) {
        if (ret.returnType === 'customer') {
          partyFields = { due: round2((partyDoc.data().due || 0) + ret.amount) };
        } else {
          partyFields = { totalPayable: round2((partyDoc.data().totalPayable || 0) + ret.amount) };
        }
      }

      tx.delete(userCol('returns').doc(ret.returnId));
      Object.values(invMap).forEach(e => {
        if (!e.data) return;
        // ✅ ফিক্স (ধাপ ২৩): status/nearestExpiry এখন সঠিকভাবে রিক্যালকুলেট
        const med = APP_STATE.medicines.find(m => m.id === e.medId);
        const reorderLevel = getEffectiveReorderLevel(med);
        const derived = computeInventoryDerivedFields(e.data.batches, reorderLevel);
        tx.set(e.ref, {
          ...e.data,
          batches: derived.batches,
          totalStock: derived.totalStock,
          costValue: derived.costValue,
          mrpValue: derived.mrpValue,
          nearestExpiry: derived.nearestExpiry,
          status: derived.status,
        }, { merge: true });
      });
      if (partyRef && partyFields) tx.update(partyRef, partyFields);

      // ✅ ধাপ ৩২.৩: reverse — submit-এর ঠিক উল্টো sign
      if (ret.returnType === 'customer') {
        if (ret.refundMethod === 'নগদ ফেরত') applyCashDelta(tx, currentBalance, ret.amount); // ফেরত-দেওয়া নগদ আবার যোগ
      } else {
        if (ret.reason === 'ফেরত' && ret.refundMethod === 'নগদ ফেরত') applyCashDelta(tx, currentBalance, -ret.amount); // পাওয়া নগদ আবার বাদ
      }
    });

    return { success: true, message: 'রিটার্ন মুছে ফেলা হয়েছে, প্রভাব উল্টানো হয়েছে।' };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

// ────────────────────────────────────────────────────────────
// ✅ ধাপ ৩২.১: CASH BALANCE — persistent running counter হেল্পার
// users/{uid}/config/balances → { cashBalance, lastUpdated }
// Firestore rules-এ নতুন কিছু লাগবে না — বিদ্যমান config/{docId} rule
// (isOwnerUid(uid) && hasAppAccess(uid)) ইতিমধ্যেই কভার করে।
//
// ব্যবহারবিধি (ধাপ ১/২৪-এর "সব read আগে, সব write পরে" প্যাটার্ন মেনে):
//   ১) transaction-এর read-ধাপে: const bal = await readCashBalance(tx);
//   ২) transaction-এর write-ধাপে: applyCashDelta(tx, bal, delta);
// দুটো call আলাদা রাখা বাধ্যতামূলক — readCashBalance() এর ভেতরে tx.get()
// আছে, এটা কোনো tx.set()/tx.delete()-এর পরে কল করলে Firestore
// "reads must come before writes" এরর দেবে।
// ────────────────────────────────────────────────────────────
function balanceRef() {
  return userCol('config').doc('balances');
}

async function readCashBalance(tx) {
  const doc = await tx.get(balanceRef());
  return doc.exists ? (doc.data().cashBalance || 0) : 0;
}

function applyCashDelta(tx, currentBalance, delta) {
  if (!delta) return; // delta === 0 হলে write skip — অপ্রয়োজনীয় write এড়ানো
  tx.set(balanceRef(), {
    cashBalance: round2(currentBalance + delta),
    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ────────────────────────────────────────────────────────────
// ✅ ধাপ ৩২.৪: MANUAL CASH BALANCE SET — migration/backfill-এর জন্য।
// বিদ্যমান ইউজারদের ইতিহাস sum করে backfill করা সম্ভব না (cap-সমস্যা,
// Admin SDK লাগবে) — তাই Settings থেকে ইউজার নিজে physical cash-count
// করে একবার initial value বসাবেন। এটা delta না, সরাসরি overwrite —
// তাই runTransaction লাগছে না, কোনো অন্য read-এর ওপর নির্ভরশীল না।
// ────────────────────────────────────────────────────────────
async function apiSetCashBalance(amount) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    await balanceRef().set({
      cashBalance: round2(amount),
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { success: true };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

async function apiGetCashBalance() {
  try {
    const doc = await balanceRef().get();
    return { success: true, cashBalance: doc.exists ? (doc.data().cashBalance || 0) : 0 };
  } catch (err) { return { success: false, message: humanizeError(err), cashBalance: 0 }; }
}

// ────────────────────────────────────────────────────────────
// ✅ ধাপ ৩২.৫: BALANCE SHEET (read-side) — O(1) cash-balance-doc read +
// client-এ থাকা master-data sum (inventory/customers/suppliers — এগুলো
// ১২-মাস cutoff/৮০০০ cap-এর বাইরে, boot-এই সম্পূর্ণ লোড হয়, তাই এখানে
// কোনো নতুন Firestore query লাগছে না — শুধু APP_STATE থেকে sum)।
// ────────────────────────────────────────────────────────────
async function apiGetBalanceSheet() {
  try {
    const cashRes = await apiGetCashBalance();
    if (!cashRes.success) return { success: false, message: cashRes.message };

    const stockValue = round2(APP_STATE.inventory.reduce((a, b) => a + (b.costValue || 0), 0));
    const customerDue = round2(APP_STATE.customers.reduce((a, b) => a + (b.due || 0), 0));
    const supplierPayable = round2(APP_STATE.suppliers.reduce((a, b) => a + (b.totalPayable || 0), 0));
    const cashBalance = cashRes.cashBalance;

    // নিট পজিশন = নগদ + স্টক-মূল্য + গ্রাহক-বাকি (আসবে) − সরবরাহকারী-পাওনা (দিতে হবে)
    const netPosition = round2(cashBalance + stockValue + customerDue - supplierPayable);

    return { success: true, cashBalance, stockValue, customerDue, supplierPayable, netPosition };
  } catch (err) {
    return { success: false, message: humanizeError(err) };
  }
}
// ────────────────────────────────────────────────────────────
// EXPENSE / SETTINGS / OPENING BALANCE
// ────────────────────────────────────────────────────────────
async function apiExecuteBranchTransfer(payload) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  if (!APP_STATE.isOwner && !hasTransferPermission()) {
    return { success: false, message: 'এই transfer অনুমোদিত নয়।' };
  }
  const sourceId = payload.sourceBranchId;
  const targetId = payload.targetBranchId;
  if (!sourceId || !targetId || sourceId === targetId) {
    return { success: false, message: 'উৎস ও গন্তব্য Branch আলাদা হতে হবে।' };
  }
  if (!APP_STATE.isOwner) {
    if (!APP_STATE.assignedBranchIds.includes(sourceId) || !APP_STATE.assignedBranchIds.includes(targetId)) {
      return { success: false, message: 'এই দুটি Branch transfer করার অনুমতি নেই।' };
    }
  }

  const transferId = payload.transferId || ('XFER-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase());
  const transferRef = fbDb.collection('transfers').doc(transferId);
  const auditRef = fbDb.collection('audits').doc(transferId);

  try {
    await withTimeout(fbDb.runTransaction(async (tx) => {
      const existing = await tx.get(transferRef);
      if (existing.exists) return;

      const sourceCatalog = fbDb.collection('branches').doc(sourceId).collection('medicines');
      const targetCatalog = fbDb.collection('branches').doc(targetId).collection('medicines');
      const sourceInv = fbDb.collection('branches').doc(sourceId).collection('inventory');
      const targetInv = fbDb.collection('branches').doc(targetId).collection('inventory');

      const lineRefs = payload.lines.map(line => ({
        medId: line.medId,
        qty: round2(parseFloat(line.qty) || 0),
        batchId: line.batchId,
        sourceInvRef: sourceInv.doc(line.medId),
        targetInvRef: targetInv.doc(line.medId),
        sourceMedRef: sourceCatalog.doc(line.medId),
        targetMedRef: targetCatalog.doc(line.medId),
      }));

      const sourceDocs = await Promise.all(lineRefs.map(x => tx.get(x.sourceInvRef)));
      const targetDocs = await Promise.all(lineRefs.map(x => tx.get(x.targetInvRef)));
      const sourceMedDocs = await Promise.all(lineRefs.map(x => tx.get(x.sourceMedRef)));
      const targetMedDocs = await Promise.all(lineRefs.map(x => tx.get(x.targetMedRef)));

      const sourceUpdates = [];
      const targetUpdates = [];
      const auditLines = [];

      for (let i = 0; i < lineRefs.length; i++) {
        const x = lineRefs[i];
        if (x.qty <= 0) throw new Error('Transfer quantity 0 বা negative হতে পারে না।');
        if (!sourceDocs[i].exists) throw new Error('উৎস branch-এ ওষুধের inventory পাওয়া যায়নি।');
        const sourceInvData = sourceDocs[i].data();
        const batches = (sourceInvData.batches || []).map(b => ({ ...b }));
        const batch = batches.find(b => b.batchId === x.batchId);
        if (!batch) throw new Error(`Batch ${x.batchId} উৎস branch-এ পাওয়া যায়নি।`);
        if ((batch.stock || 0) < x.qty) throw new Error(`Batch ${x.batchId}-এ পর্যাপ্ত stock নেই।`);

        batch.stock = round2(batch.stock - x.qty);
        const remainingBatches = batches.filter(b => b.stock > 0);
        const sourceMed = sourceMedDocs[i].exists ? sourceMedDocs[i].data() : sourceInvData;
        const reorderLevel = getEffectiveReorderLevel(sourceMed);
        const sourceDerived = computeInventoryDerivedFields(remainingBatches, reorderLevel);
        sourceUpdates.push({ ref: x.sourceInvRef, fields: { ...sourceDerived, medId: x.medId, branchId: sourceId } });

        const targetInvData = targetDocs[i].exists ? targetDocs[i].data() : {
          medId: x.medId,
          brand: sourceInvData.brand || '',
          doseForm: sourceInvData.doseForm || '',
          strength: sourceInvData.strength || '',
          sellPrice: sourceInvData.sellPrice || 0,
          batches: [],
        };
        const targetBatches = (targetInvData.batches || []).map(b => ({ ...b }));
        const targetBatch = targetBatches.find(b =>
          b.batchNumber === batch.batchNumber || b.batchId === batch.batchId
        );
        if (targetBatch) {
          targetBatch.stock = round2((targetBatch.stock || 0) + x.qty);
        } else {
          targetBatches.push({
            batchId: batch.batchId,
            batchNumber: batch.batchNumber || batch.batchId,
            expiry: batch.expiry || '',
            stock: x.qty,
            cost: batch.cost || 0,
            mrp: batch.mrp || 0,
            sell: batch.sell || targetInvData.sellPrice || 0,
          });
        }
        const targetDerived = computeInventoryDerivedFields(targetBatches, reorderLevel);
        targetUpdates.push({
          ref: x.targetInvRef,
          fields: {
            medId: x.medId,
            brand: targetInvData.brand || sourceInvData.brand || '',
            doseForm: targetInvData.doseForm || sourceInvData.doseForm || '',
            strength: targetInvData.strength || sourceInvData.strength || '',
            branchId: targetId,
            ...targetDerived,
            sellPrice: targetInvData.sellPrice || sourceInvData.sellPrice || 0,
          },
        });

        if (!targetDocs[i].exists) {
          targetUpdates[i].createCatalog = true;
        }
        auditLines.push({
          medId: x.medId,
          batchId: x.batchId,
          batchNumber: batch.batchNumber || batch.batchId,
          qty: x.qty,
          expiry: batch.expiry || '',
          cost: batch.cost || 0,
          mrp: batch.mrp || 0,
        });
      }

      sourceUpdates.forEach(u => tx.update(u.ref, u.fields));
      targetUpdates.forEach((u, i) => {
        if (u.createCatalog) tx.set(u.ref, u.fields);
        else tx.update(u.ref, u.fields);
        const medLine = lineRefs[i];
        if (!targetMedDocs[i].exists) {
          const sourceMed = sourceMedDocs[i].exists ? sourceMedDocs[i].data() : null;
          tx.set(medLine.targetMedRef, {
            id: medLine.medId,
            brand: sourceMed?.brand || u.fields.brand || '',
            generic: sourceMed?.generic || '',
            doseForm: sourceMed?.doseForm || u.fields.doseForm || '',
            strength: sourceMed?.strength || u.fields.strength || '',
            manufacturer: sourceMed?.manufacturer || '',
            category: sourceMed?.category || '',
            unit: sourceMed?.unit || 'পাতা',
            reorderLevel: getEffectiveReorderLevel(sourceMed),
            branchId: targetId,
          });
        }
      });

      const now = firebase.firestore.FieldValue.serverTimestamp();
      tx.set(transferRef, {
        transferId,
        type: 'stock',
        sourceBranchId: sourceId,
        targetBranchId: targetId,
        sourceBranchName: payload.sourceBranchName || sourceId,
        targetBranchName: payload.targetBranchName || targetId,
        lines: auditLines,
        financialAmount: round2(payload.financialAmount || 0),
        paymentMode: payload.paymentMode || 'none',
        status: 'completed',
        completed: true,
        createdByUid: APP_STATE.currentUser.uid,
        createdAt: now,
        completedAt: now,
      });
      tx.set(auditRef, {
        auditId: transferId,
        action: 'branch-stock-transfer',
        actorUid: APP_STATE.currentUser.uid,
        branchId: sourceId,
        targetBranchId: targetId,
        transferId,
        lines: auditLines,
        createdAt: now,
      });
      const financialAmount = round2(payload.financialAmount || 0);
      if (financialAmount > 0 && payload.paymentMode !== 'none') {
        tx.set(fbDb.collection('branches').doc(sourceId).collection('financialLedger').doc(transferId), {
          transferId,
          branchId: sourceId,
          counterBranchId: targetId,
          direction: 'out',
          amount: financialAmount,
          paymentMode: payload.paymentMode,
          description: 'Inter-branch transfer',
          createdByUid: APP_STATE.currentUser.uid,
          createdAt: now,
        });
        tx.set(fbDb.collection('branches').doc(targetId).collection('financialLedger').doc(transferId), {
          transferId,
          branchId: targetId,
          counterBranchId: sourceId,
          direction: 'in',
          amount: financialAmount,
          paymentMode: payload.paymentMode,
          description: 'Inter-branch transfer',
          createdByUid: APP_STATE.currentUser.uid,
          createdAt: now,
        });
      }
    }), FIRESTORE_WRITE_TIMEOUT_MS);

    APP_STATE.interBranchTransfers = APP_STATE.interBranchTransfers || [];
    APP_STATE.interBranchTransfers.unshift({
      transferId,
      type: 'stock',
      sourceBranchId: sourceId,
      targetBranchId: targetId,
      status: 'completed',
      createdByUid: APP_STATE.currentUser.uid,
      createdAt: new Date(),
    });
    return { success: true, transferId, message: 'Branch stock transfer সম্পন্ন হয়েছে।' };
  } catch (err) {
    return { success: false, message: humanizeError(err) };
  }
}

function hasTransferPermission() {
  return !!(APP_STATE.permissions && (
    APP_STATE.permissions.transfer === true ||
    APP_STATE.permissions.stockTransfer === true
  ));
}

async function apiAddIncome(income, opts = {}) {
  const isRetry = !!opts.isRetry;
  if (!navigator.onLine) {
    if (isRetry) return { success: false, message: 'এখনো অফলাইন — পরের সাইকেলে আবার চেষ্টা হবে।' };
    return await queueIncomeOffline(income);
  }
  try {
    const ref = userCol('incomes').doc(income.id);
    await fbDb.runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (existing.exists) return;
      const currentBalance = await readCashBalance(tx);
      tx.set(ref, { ...income, branchId: APP_STATE.activeBranchId, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      applyCashDelta(tx, currentBalance, income.amount || 0);
    });
    return { success: true };
  } catch (err) {
    if (isConnectivityError(err)) {
      if (isRetry) return { success: false, message: 'নেট সংযোগ অস্থির — পরে চেষ্টা হবে।' };
      return await queueIncomeOffline(income);
    }
    return { success: false, message: humanizeError(err) };
  }
}

async function apiDeleteIncome(incomeId) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const ref = userCol('incomes').doc(incomeId);
    await fbDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('আয় এন্ট্রি পাওয়া যায়নি।');
      const amount = snap.data().amount || 0;
      const currentBalance = await readCashBalance(tx);
      tx.delete(ref);
      applyCashDelta(tx, currentBalance, -(amount));
    });
    emitStaffEditAudit({
      recordType: 'income',
      recordId: incomeId,
      action: 'deleted',
      before: APP_STATE.incomes.find(i => i.id === incomeId) || { id: incomeId },
      after: null,
      editSummary: 'Income record deleted'
    });
  } catch (err) { return { success: false, message: humanizeError(err) }; }
  return { success: true };
}

async function apiAddExpense(exp, opts = {}) {
  const isRetry = !!opts.isRetry;

  if (!navigator.onLine) {
    if (isRetry) return { success: false, message: 'এখনো অফলাইন — পরের সাইকেলে আবার চেষ্টা হবে।' };
    return await queueExpenseOffline(exp);
  }

  try {
    const expRef = userCol('expenses').doc(exp.id);
    await withTimeout(fbDb.runTransaction(async (tx) => {
      // ✅ ধাপ ০.১.২: idempotency গার্ড
      const existingExpDoc = await tx.get(expRef);
      if (existingExpDoc.exists) return;

      const currentBalance = await readCashBalance(tx);
      tx.set(expRef, exp);
      applyCashDelta(tx, currentBalance, -(exp.amount || 0));
    }), FIRESTORE_WRITE_TIMEOUT_MS);
    emitFinancialNotification({
      type: 'expense', action: 'created', amount: exp.amount || 0, recordId: exp.id,
      title: 'নতুন খরচ', message: `${exp.description || exp.category || 'খরচ'} — ৳${fmt(exp.amount || 0)}`
    });
    return { success: true };
  } catch (err) {
    if (isConnectivityError(err)) {
      if (isRetry) return { success: false, message: 'নেট সংযোগ অস্থির — একটু পর আবার চেষ্টা হবে।' };
      return await queueExpenseOffline(exp);
    }
    return { success: false, message: humanizeError(err) };
  }
}

async function apiDeleteExpense(expId) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const expRef = userCol('expenses').doc(expId);
    await fbDb.runTransaction(async (tx) => {
      // ✅ সব read আগে — amount fresh Firestore থেকে, client-state থেকে না
      const expDoc = await tx.get(expRef);
      if (!expDoc.exists) throw new Error('খরচ এন্ট্রি পাওয়া যায়নি — সম্ভবত ইতিমধ্যে মুছে ফেলা হয়েছে।');
      const amount = expDoc.data().amount || 0;
      const currentBalance = await readCashBalance(tx);
      // ✅ সব write পরে
      tx.delete(expRef);
      applyCashDelta(tx, currentBalance, amount); // খরচ ডিলিট = cash ফেরত
    });
    emitStaffEditAudit({
      recordType: 'expense',
      recordId: expId,
      action: 'deleted',
      before: APP_STATE.expenses.find(e => e.id === expId) || { id: expId },
      after: null,
      editSummary: 'Expense record deleted'
    });
    emitFinancialNotification({
      type: 'expense_delete', action: 'deleted', amount: 0, recordId: expId,
      title: 'খরচ এন্ট্রি মুছে ফেলা হয়েছে', message: expId
    });
    return { success: true };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}
async function apiSaveSettings(data) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try { await userCol('config').doc('settings').set(data, { merge: true }); return { success: true }; }
  catch (err) { return { success: false, message: humanizeError(err) }; }
}

// ────────────────────────────────────────────────────────────
// ✅ [আইটেম ১৩ - Unsubscribe A] EMAIL PREFERENCES — users/{uid} রুট
// ডকুমেন্টে সংরক্ষিত (Code.gs এই একই পাথ থেকে পড়ে/লেখে)। শুধু owner
// নিজে নিজের প্রোফাইল বদলাতে পারবেন (Firestore rules-এ isOwnerUid গার্ড)।
// ────────────────────────────────────────────────────────────
async function apiGetEmailPreferences() {
  try {
    const doc = await fbDb.collection('users').doc(APP_STATE.currentUser.uid).get();
    const prefs = doc.exists ? (doc.data().emailPreferences || {}) : {};
    return { success: true, unsubscribedAll: !!prefs.unsubscribedAll };
  } catch (err) {
    return { success: false, message: humanizeError(err), unsubscribedAll: false };
  }
}

async function apiSetEmailUnsubscribed(flag) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const ref = fbDb.collection('users').doc(APP_STATE.currentUser.uid);
    const doc = await ref.get();
    const existing = doc.exists ? (doc.data().emailPreferences || {}) : {};
    await ref.update({ emailPreferences: { ...existing, unsubscribedAll: !!flag } });
    return { success: true };
  } catch (err) {
    return { success: false, message: humanizeError(err) };
  }
}

// ────────────────────────────────────────────────────────────
// OPENING BALANCE — apiSubmitOpeningEntry (✅ computeInventoryDerivedFields ব্যবহার করছে)
// ────────────────────────────────────────────────────────────
async function apiSubmitOpeningEntry(entry) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const entryRef = userCol('openingEntries').doc(entry.entryId);
    const invRef = entry.category === 'স্টক' ? userCol('inventory').doc(entry.medicineId) : null;
    const custRef = entry.category === 'গ্রাহক বাকি' ? userCol('customers').doc(entry.clientId) : null;
    const supRef = entry.category === 'সরবরাহকারী বাকি' ? userCol('suppliers').doc(entry.supplierId) : null;

    await fbDb.runTransaction(async (tx) => {
      // ✅ সব read আগে
      const invDoc = invRef ? await tx.get(invRef) : null;
      const custDoc = custRef ? await tx.get(custRef) : null;
      const supDoc = supRef ? await tx.get(supRef) : null;
      // ✅ ধাপ ৩২.৪: শুধু 'নগদ' ক্যাটাগরিতেই দরকার — অন্য রেফের মতোই conditional read
      const currentBalance = entry.category === 'নগদ' ? await readCashBalance(tx) : null;

      // ✅ কম্পিউট (কোনো write এখনো হয়নি)
      let invFields = null, invExists = false;
      if (invRef) {
        const existing = invDoc.exists ? invDoc.data() : null;
        const newBatch = { batchId: entry.batchId, expiry: entry.expiryDate || '', stock: entry.qty, cost: entry.costPrice, mrp: entry.mrp, sell: entry.sellPrice };
        const rawBatches = [...(existing?.batches || []), newBatch];

        const med = APP_STATE.medicines.find(m => m.id === entry.medicineId);
        const reorderLevel = getEffectiveReorderLevel(med);

        // ✅ ফিক্স (ধাপ ২৩, রিফ্যাক্টর): shared হেল্পার — আগে nearestExpiry/status
        // এখানে existing ভ্যালু বা হার্ডকোড 'ok' থেকে যেত, নতুন ব্যাচ যোগ হওয়ার
        // পরও রিক্যালকুলেট হতো না। এখন সঠিকভাবে recalculate হচ্ছে।
        const derived = computeInventoryDerivedFields(rawBatches, reorderLevel);

        invFields = {
          medId: entry.medicineId, brand: entry.brand || existing?.brand || '',
          doseForm: existing?.doseForm || '', strength: existing?.strength || '',
          batches: derived.batches,
          totalStock: derived.totalStock,
          costValue: derived.costValue,
          mrpValue: derived.mrpValue,
          nearestExpiry: derived.nearestExpiry,
          sellPrice: entry.sellPrice > 0 ? entry.sellPrice : (existing?.sellPrice || 0),
          status: derived.status,
        };
        invExists = invDoc.exists;
      }

      let custFields = null;
      if (custRef && custDoc.exists) {
        custFields = { due: round2((custDoc.data().due || 0) + entry.amount) };
      }

      let supFields = null;
      if (supRef && supDoc.exists) {
        supFields = { totalPayable: round2((supDoc.data().totalPayable || 0) + entry.amount) };
      }

      // ✅ সব write পরে
      tx.set(entryRef, entry);
      if (invRef && invFields) { if (invExists) tx.update(invRef, invFields); else tx.set(invRef, invFields); }
      if (custRef && custFields) tx.update(custRef, custFields);
      if (supRef && supFields) tx.update(supRef, supFields);
      // ✅ ধাপ ৩২.৪: 'নগদ' opening entry — cash balance বৃদ্ধি
      if (entry.category === 'নগদ') applyCashDelta(tx, currentBalance, entry.amount);
    });

    return { success: true };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

async function apiDeleteOpeningEntry(entry) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const entryRef = userCol('openingEntries').doc(entry.entryId);
    const invRef = (entry.category === 'স্টক' && entry.batchId) ? userCol('inventory').doc(entry.medicineId) : null;
    const custRef = (entry.category === 'গ্রাহক বাকি' && entry.clientId) ? userCol('customers').doc(entry.clientId) : null;
    const supRef = (entry.category === 'সরবরাহকারী বাকি' && entry.supplierId) ? userCol('suppliers').doc(entry.supplierId) : null;

    await fbDb.runTransaction(async (tx) => {
      // ✅ সব read আগে
      const invDoc = invRef ? await tx.get(invRef) : null;
      const custDoc = custRef ? await tx.get(custRef) : null;
      const supDoc = supRef ? await tx.get(supRef) : null;
      // ✅ ধাপ ৩২.৪
      const currentBalance = entry.category === 'নগদ' ? await readCashBalance(tx) : null;

      // ✅ কম্পিউট
      let invFields = null;
      if (invRef && invDoc.exists) {
        const inv = invDoc.data();
        const rawBatches = (inv.batches || []).filter(b => b.batchId !== entry.batchId);

        const med = APP_STATE.medicines.find(m => m.id === entry.medicineId);
        const reorderLevel = getEffectiveReorderLevel(med);

        const derived = computeInventoryDerivedFields(rawBatches, reorderLevel);

        invFields = {
          batches: derived.batches,
          totalStock: derived.totalStock,
          costValue: derived.costValue,
          mrpValue: derived.mrpValue,
          nearestExpiry: derived.nearestExpiry,
          status: derived.status,
        };
      }

      let custFields = null;
      if (custRef && custDoc.exists) {
        custFields = { due: Math.max(0, round2((custDoc.data().due || 0) - entry.amount)) };
      }

      let supFields = null;
      if (supRef && supDoc.exists) {
        supFields = { totalPayable: Math.max(0, round2((supDoc.data().totalPayable || 0) - entry.amount)) };
      }

      // ✅ সব write পরে
      tx.delete(entryRef);
      if (invRef && invFields) tx.update(invRef, invFields);
      if (custRef && custFields) tx.update(custRef, custFields);
      if (supRef && supFields) tx.update(supRef, supFields);
      // ✅ ধাপ ৩২.৪: 'নগদ' opening entry ডিলিট — cash balance থেকে বাদ (reverse)
      if (entry.category === 'নগদ') applyCashDelta(tx, currentBalance, -entry.amount);
    });

    return { success: true };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

// ────────────────────────────────────────────────────────────
// getCompleteData — ✅ এটাও cache-first (অফলাইনে app বুট করতেও দ্রুত/নির্ভরযোগ্য হবে)
// ────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
// HISTORY CUTOFF HELPER — ১২ মাসের boundary
// ────────────────────────────────────────────────────────────
function getCutoffDateStr() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().split('T')[0];
}

// ────────────────────────────────────────────────────────────
// getCompleteData — ✅ ধাপ ২৭: sales/purchases/returns-এ
// orderBy('date','desc').limit(HISTORY_CAP) যোগ হলো — cutoff (১২ মাস)
// অক্ষত থাকছে, কিন্তু ভলিউম-ভারী দোকানে বুট-টাইমে সাম্প্রতিক ৮,০০০
// ডকুমেন্টের বেশি একসাথে লোড হবে না। expenses/payments/supplierPayments
// কম-ভলিউম বলে uncapped রাখা হলো (শুধু cutoff filter)।
//
// orderBy+limit-এর কারণে ডকুমেন্ট এখন নতুন→পুরনো অর্ডারে আসে, কিন্তু
// বাকি সব মডিউল (accounts.js, analytics.js, dashboard.js) chronological
// (পুরনো→নতুন) অর্ডার প্রত্যাশা করে — তাই .reverse() করে ফেরত দেওয়া
// হচ্ছে, বিদ্যমান বিহেভিয়ার অক্ষুণ্ণ রাখতে।
//
// cap ছুঁয়ে গেলে (docs.length === cap) capReached ফ্ল্যাগ true হবে —
// Returns dropdown ও Analytics ট্যাবে এটা ইউজারকে "পুরনো ডেটা এখনো
// লোড হয়নি" জানাতে ব্যবহৃত হয় (দেখুন returns.js/analytics.js)।
// ────────────────────────────────────────────────────────────
async function apiGetCompleteData() {
  try {
    const cutoff = getCutoffDateStr();
    const HISTORY_CAP = 8000;

    const salesQuery = userCol('sales').where('date', '>=', cutoff).orderBy('date', 'desc').limit(HISTORY_CAP);
    const purQuery = userCol('purchases').where('date', '>=', cutoff).orderBy('date', 'desc').limit(HISTORY_CAP);
    const retQuery = userCol('returns').where('date', '>=', cutoff).orderBy('date', 'desc').limit(HISTORY_CAP);

    const [medSnap, custSnap, supSnap, invSnap, saleSnap, purSnap, retSnap, expSnap, incomeSnap, paySnap, supPaySnap, obSnap, salarySetupSnap, shortListSnap, settingsDoc] = await Promise.all([
      cget2(userCol('medicines')), cget2(userCol('customers')), cget2(userCol('suppliers')), cget2(userCol('inventory')),
      cget2(salesQuery),
      cget2(purQuery),
      cget2(retQuery),
      cget2(userCol('expenses').where('date', '>=', cutoff)),
      cget2(userCol('incomes').where('date', '>=', cutoff)),
      cget2(userCol('payments').where('date', '>=', cutoff)),
      cget2(userCol('supplierPayments').where('date', '>=', cutoff)),
      cget2(userCol('openingEntries')),
      APP_STATE.isOwner ? cget2(userCol('staffSalarySetups')) : Promise.resolve({ docs: [] }),
      cget2(userCol('shortList')),
      APP_STATE.isOwner ? cgetDoc(userCol('config').doc('settings')) : Promise.resolve({ exists: false }),
    ]);
    const settings = settingsDoc.exists ? settingsDoc.data() : {};

    // ✅ orderBy('date','desc') দিয়ে আনা হয়েছে বলে chronological অর্ডারে ফেরাতে reverse()
    const sales = docsWithId(saleSnap, 'invoiceNo').reverse();
    const purchases = docsWithId(purSnap, 'purchaseId').reverse();
    const returns = docsWithId(retSnap, 'returnId').reverse();

    const capReached = {
      sales: saleSnap.docs.length >= HISTORY_CAP,
      purchases: purSnap.docs.length >= HISTORY_CAP,
      returns: retSnap.docs.length >= HISTORY_CAP,
    };

    return {
      success: true,
      medicines: docsWithId(medSnap), customers: docsWithId(custSnap),
      suppliers: docsWithId(supSnap), inventory: docsWithId(invSnap, 'medId'),
      sales, purchases, returns,
      expenses: docsWithId(expSnap),
      incomes: docsWithId(incomeSnap),
      payments: docsWithId(paySnap, 'paymentId'),
      supplierPayments: docsWithId(supPaySnap, 'paymentId'),
      salarySetups: salarySetupSnap.docs.map(doc => ({
        ...doc.data(),
        id: doc.data().id || doc.id,
        staffUid: doc.data().staffUid || doc.id,
      })),
      shortList: docsWithId(shortListSnap),
      openingEntries: docsWithId(obSnap, 'entryId'),
      pharmacyName: settings.pharmacyName || 'আমার ফার্মেসি', ownerName: settings.ownerName || '',
      phone: settings.phone || '', address: settings.address || '',
      lowStockLevel: settings.lowStockLevel ?? 10, expiryAlertDays: settings.expiryAlertDays ?? 90,
      logoBase64: settings.logoBase64 || '', // ✅ নতুন — আইটেম ১২
      onboardingComplete: settings.onboardingComplete || false, // ✅ নতুন — প্রথমবার-সেটআপ ফর্ম ট্র্যাকিং
      reviewPromptDismissed: settings.reviewPromptDismissed || false, // ✅ আইটেম ১১
      lastExportAt: settings.lastExportAt || null, // ✅ ধাপ ০.৩ — ব্যাকআপ রিমাইন্ডার
      pinLockEnabled: settings.pinLockEnabled || false, // ✅ আইটেম ২৩
      pinHash: settings.pinHash || '',
      historyCutoff: cutoff,
      capReached,
    };
  } catch (err) {
    return { success: false, message: humanizeError(err), medicines: [], customers: [], suppliers: [], inventory: [], sales: [], purchases: [], returns: [], expenses: [], payments: [], supplierPayments: [], openingEntries: [], capReached: { sales: false, purchases: false, returns: false } };
  }
}

// ────────────────────────────────────────────────────────────
// ✅ ধাপ ২: পুরনো (cutoff-এর আগের) হিস্টোরি on-demand লোড
// ────────────────────────────────────────────────────────────
async function apiGetOlderHistory() {
  try {
    const cutoff = APP_STATE.historyCutoff || getCutoffDateStr();
    const [saleSnap, purSnap, retSnap, expSnap, paySnap, supPaySnap] = await Promise.all([
      cget2(userCol('sales').where('date', '<', cutoff)),
      cget2(userCol('purchases').where('date', '<', cutoff)),
      cget2(userCol('returns').where('date', '<', cutoff)),
      cget2(userCol('expenses').where('date', '<', cutoff)),
      cget2(userCol('payments').where('date', '<', cutoff)),
      cget2(userCol('supplierPayments').where('date', '<', cutoff)),
    ]);
    return {
      success: true,
      sales: docsWithId(saleSnap, 'invoiceNo'), purchases: docsWithId(purSnap, 'purchaseId'),
      returns: docsWithId(retSnap, 'returnId'), expenses: docsWithId(expSnap),
      payments: docsWithId(paySnap, 'paymentId'), supplierPayments: docsWithId(supPaySnap, 'paymentId'),
    };
  } catch (err) {
    return { success: false, message: humanizeError(err) };
  }
}

// ────────────────────────────────────────────────────────────
// ✅ ধাপ ২৮: নির্দিষ্ট date-range (ফিসক্যাল ইয়ার/মাস) অনুযায়ী
// টার্গেটেড হিস্টোরি ফেচ — apiGetOlderHistory()-এর মতো "সব পুরনো
// ডেটা" না, শুধু ইউজার-নির্বাচিত একটা নির্দিষ্ট মেয়াদ।
// date ফিল্ডে দুটো range filter (>=, <=) + orderBy('date') — একই
// ফিল্ডে হওয়ায় composite index লাগে না (single-field index যথেষ্ট)।
// ────────────────────────────────────────────────────────────
async function apiGetHistoryByPeriod(fromDate, toDate) {
  try {
    const [saleSnap, purSnap, retSnap, expSnap, paySnap, supPaySnap] = await Promise.all([
      cget2(userCol('sales').where('date', '>=', fromDate).where('date', '<=', toDate).orderBy('date', 'asc')),
      cget2(userCol('purchases').where('date', '>=', fromDate).where('date', '<=', toDate).orderBy('date', 'asc')),
      cget2(userCol('returns').where('date', '>=', fromDate).where('date', '<=', toDate).orderBy('date', 'asc')),
      cget2(userCol('expenses').where('date', '>=', fromDate).where('date', '<=', toDate)),
      cget2(userCol('payments').where('date', '>=', fromDate).where('date', '<=', toDate)),
      cget2(userCol('supplierPayments').where('date', '>=', fromDate).where('date', '<=', toDate)),
    ]);
    return {
      success: true,
      sales: docsWithId(saleSnap, 'invoiceNo'),
      purchases: docsWithId(purSnap, 'purchaseId'),
      returns: docsWithId(retSnap, 'returnId'),
      expenses: docsWithId(expSnap),
      payments: docsWithId(paySnap, 'paymentId'),
      supplierPayments: docsWithId(supPaySnap, 'paymentId'),
    };
  } catch (err) {
    return { success: false, message: humanizeError(err) };
  }
}

// ── FULL RESET — সব subcollection মুছে ফেলে, Owner profile অক্ষুণ্ণ থাকে ──
async function apiResetAllData() {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const collections = ['medicines', 'inventory', 'customers', 'suppliers', 'sales', 'purchases', 'returns', 'expenses', 'payments', 'supplierPayments', 'openingEntries'];
    for (const colName of collections) {
      const snap = await userCol(colName).get();
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) { // Firestore batch সীমা ৫০০, নিরাপদ থাকতে ৪০০
        const batch = fbDb.batch();
        docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
    // ✅ ধাপ ৩২.৪: cash balance রিসেট — config/settings (ফার্মেসি তথ্য) স্পর্শ না
    // করে শুধু config/balances মুছে ফেলা হচ্ছে, নাহলে রিসেটের পর stale cash
    // balance থেকে যাবে (নতুন খালি অ্যাকাউন্টে পুরনো ব্যালান্স দেখাবে)।
    await balanceRef().delete().catch(() => {}); // doc না থাকলেও নিরাপদে এগোবে
    return { success: true, message: 'সব ডেটা মুছে ফেলা হয়েছে।' };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}
// collection query cache-first, খালি cache হলে fallback default (প্রথমবার অনলাইন বুট দরকার)
async function cget2(colRef) {
  return colRef.get();
}
async function cgetDoc(ref) {
  return ref.get();
}

// ── GLOBAL MEDICINE MASTER (২১k তালিকা) ──
async function apiSearchGlobalMedicines(prefix) {
  try {
    const p = prefix.trim().toLowerCase();
    if (!p) return { success: true, results: [] };
    const snap = await fbDb.collection('globalMedicines')
      .orderBy('brandLower').startAt(p).endAt(p + '\uf8ff').limit(25).get();
    return { success: true, results: snap.docs.map(d => d.data()) };
  } catch (err) { return { success: false, message: humanizeError(err), results: [] }; }
}

async function apiImportGlobalMedicine(med) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    // ✅ ধাপ ০.২ (মূল root cause): এতদিন এখানে কোনো dedup-check ছিলই না —
    // একই Global Master আইটেম দুই/তিনবার "যোগ করুন" চাপলে প্রতিবার নতুন
    // Date.now()-ভিত্তিক ID দিয়ে সম্পূর্ণ আলাদা medicine+inventory ডকুমেন্ট
    // তৈরি হয়ে যেত। findDuplicateMedicine() reuse — brand+doseForm+strength
    // মিলে গেলে hard-block, কারণ Global Master-এর একই সোর্স-আইটেম দুইবার
    // ইমপোর্ট করার কোনো বৈধ কারণ নেই (ম্যানুয়াল এন্ট্রির মতো "সত্যিই ভিন্ন
    // হতে পারে" এমন অস্পষ্টতা এখানে নেই)।
    const dup = findDuplicateMedicine(med.brand, med.doseForm || '', med.strength || '', null);
    if (dup) {
      return {
        success: false,
        message: `"${med.brand} ${med.doseForm || ''} ${med.strength || ''}" ইতিমধ্যে আপনার ওষুধ মাস্টারে আছে (${dup.id}) — আবার ইমপোর্ট করার দরকার নেই।`,
      };
    }

    const id = 'MED-' + med.brand.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8) + '-' + Date.now();
    const data = { id, brand: med.brand, generic: med.generic || '', doseForm: med.doseForm || '', strength: med.strength || '', manufacturer: med.manufacturer || '', category: med.category || '', unit: med.unit || 'পাতা', reorderLevel: 10 };
    const result = await apiAddMedicine(data);
    return result.success
      ? { success: true, medId: result.medId }
      : { success: false, message: result.message };
  } catch (err) { return { success: false, message: humanizeError(err) }; }
}

// ── ADMIN: bulk upload globalMedicines ──
async function apiBulkUploadGlobalMedicines(rows, onProgress) {
  try {
    let done = 0;
    const total = rows.length;
    for (let i = 0; i < rows.length; i += 400) {
      const chunk = rows.slice(i, i + 400);
      const batch = fbDb.batch();
      chunk.forEach((r) => {
        // ✅ ফিক্স: deterministic ID (নাম+ডোজ+শক্তি-ভিত্তিক) — Date.now() না।
        // একই সারি দ্বিতীয়বার আপলোড হলে ওভাররাইট হবে, ডুপ্লিকেট তৈরি হবে না।
        const slug = (r.brand + '-' + (r.doseForm||'') + '-' + (r.strength||''))
          .toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 60);
        const id = 'GM-' + slug;
        batch.set(fbDb.collection('globalMedicines').doc(id), {
          id, brand: r.brand, brandLower: r.brand.toLowerCase(),
          generic: r.generic || '', doseForm: r.doseForm || '', strength: r.strength || '',
          manufacturer: r.manufacturer || '', category: r.category || '',
        });
      });
      try {
        await batch.commit();
      } catch (err) {
        // ✅ Quota শেষ হলে স্পষ্ট বার্তা + এখান পর্যন্ত যা হয়েছে তা রিপোর্ট করা
        // (এই মেসেজ ইচ্ছাকৃতভাবে err.message ব্যবহার করে না — কাস্টম বাংলা বার্তা, শুধু err.code চেক করা হয়)
        if (err.code === 'resource-exhausted') {
          return { success: false, quotaExceeded: true, count: done, message: `Firestore দৈনিক সীমা শেষ। ${done}/${total} টি আপলোড হয়েছে — বাকিটা quota রিসেট হলে (মধ্যরাত, Pacific Time) আবার এই একই CSV পেস্ট করলে বাকি অংশ থেকেই চলবে, ডুপ্লিকেট হবে না।` };
        }
        throw err;
      }
      done += chunk.length;
      if (onProgress) onProgress(done, total);
    }
    return { success: true, count: done };
  } catch (err) {
    return { success: false, message: humanizeError(err) };
  }
}

// ────────────────────────────────────────────────────────────
// INVENTORY BATCH EDIT — ✅ ধাপ ১৩: runTransaction() দিয়ে read-then-write,
// আগে এই API-ই ছিল না, শুধু local APP_STATE বদলাত।
// ────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
// INVENTORY BATCH EDIT — apiUpdateBatch (✅ computeInventoryDerivedFields ব্যবহার করছে)
// ────────────────────────────────────────────────────────────
async function apiUpdateBatch(medId, batchId, fields) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    const invRef = userCol('inventory').doc(medId);

    await fbDb.runTransaction(async (tx) => {
      // ✅ read আগে
      const invDoc = await tx.get(invRef);
      if (!invDoc.exists) throw new Error('ইনভেন্টরি রেকর্ড পাওয়া যায়নি।');
      const inv = invDoc.data();

      let found = false;
      const rawBatches = (inv.batches || []).map(b => {
        if (b.batchId !== batchId) return b;
        found = true;
        return { ...b, ...fields };
      });
      if (!found) throw new Error('ব্যাচ খুঁজে পাওয়া যায়নি — সম্ভবত অন্য কোথাও থেকে ইতিমধ্যে মুছে ফেলা হয়েছে।');

      const med = APP_STATE.medicines.find(m => m.id === medId);
      const reorderLevel = getEffectiveReorderLevel(med);

      // ✅ ফিক্স (ধাপ ২৩, রিফ্যাক্টর): shared হেল্পার ব্যবহার
      const derived = computeInventoryDerivedFields(rawBatches, reorderLevel);

      const updateFields = {
        batches: derived.batches,
        totalStock: derived.totalStock,
        costValue: derived.costValue,
        mrpValue: derived.mrpValue,
        nearestExpiry: derived.nearestExpiry,
        status: derived.status,
      };
      if (fields.sell > 0) updateFields.sellPrice = fields.sell; // ✅ purchase.js/opening.js-এর প্যাটার্নের মতো

      // ✅ write পরে
      tx.update(invRef, updateFields);
    });

    return { success: true, message: 'ব্যাচ আপডেট হয়েছে।' };
  } catch (err) {
    return { success: false, message: humanizeError(err) };
  }
}

// ════════════════════════════════════════════════════════════
// ✅ নতুন — বাল্ক স্টক ইম্পোর্ট (Opening Balance ট্যাব)
// একই CSV/পেস্ট করা ডেটা থেকে একসাথে দুটো কাজ করে:
//   ১) ওষুধ মাস্টারে না থাকা ব্র্যান্ড/ডোজ/শক্তি নতুন করে যোগ করে
//   ২) totalStock > 0 হলে সেটাকে Opening Balance ব্যাচ হিসেবে
//      inventory + openingEntries দুই জায়গাতেই বসায়
// runTransaction() না — এটা এককালীন সেটআপ অপারেশন, ভলিউম বেশি হতে
// পারে (শত-শত row), তাই admin.js-এর bulk-upload-এর প্যাটার্নে chunked
// batch().commit() ব্যবহার করা হচ্ছে (quota-friendly progress সহ)।
// নগদ ব্যালান্স স্পর্শ করা হয় না — একক apiSubmitOpeningEntry()-এর
// 'স্টক' ক্যাটাগরির মতোই আচরণ (শুধু 'নগদ' ক্যাটাগরি cash touch করে)।
// ════════════════════════════════════════════════════════════
const BULK_IMPORT_CHUNK_ROWS = 120; // প্রতি chunk-এ সর্বোচ্চ ৩ write/row ধরে ~৩৬০ writes, নিরাপদ মার্জিন

async function apiBulkImportOpeningStock(rows, onProgress) {
  if (!navigator.onLine) return { success: false, message: OFFLINE_MSG };
  try {
    let done = 0, addedMedCount = 0;
    const total = rows.length;
    const seenInThisImport = new Map(); // dupKey -> medId (এই ইমপোর্টের ভেতরেই ডুপ্লিকেট রোধ)
    const resultMedicines = [];
    const resultInventory = [];
    const resultOpeningEntries = [];

    for (let i = 0; i < rows.length; i += BULK_IMPORT_CHUNK_ROWS) {
      const chunk = rows.slice(i, i + BULK_IMPORT_CHUNK_ROWS);
      const batch = fbDb.batch();

      for (const row of chunk) {
        const dupKey = normalizeBrandText(row.brand).toLowerCase() + '|' +
          row.doseForm.toLowerCase() + '|' +
          String(row.strength).trim().toLowerCase().replace(/\s+/g, '');

        let medId = seenInThisImport.get(dupKey);
        let isNewMed = false;

        if (!medId) {
          const existingDup = findDuplicateMedicine(row.brand, row.doseForm, row.strength, null);
          if (existingDup) {
            medId = existingDup.id;
          } else {
            medId = genMedicineId(row.brand);
            isNewMed = true;
          }
          seenInThisImport.set(dupKey, medId);
        }

        if (isNewMed) {
          const medData = {
            id: medId, brand: row.brand, generic: row.generic || '', doseForm: row.doseForm,
            strength: row.strength, manufacturer: row.manufacturer || '', category: '',
            unit: 'পাতা', reorderLevel: 10, preferredSupplierId: '', preferredRepId: '',
          };
          batch.set(userCol('medicines').doc(medId), medData);
          resultMedicines.push(medData);
          addedMedCount++;
        }

        let invRow = resultInventory.find(x => x.medId === medId) || APP_STATE.inventory.find(x => x.medId === medId);

        if (row.totalStock > 0) {
          const batchId = 'BAT-OB-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
          const newBatch = {
            batchId, expiry: row.expiryDate || '', stock: row.totalStock,
            cost: row.costPrice, mrp: row.mrp, sell: row.sellPrice,
          };
          const existingBatches = invRow ? [...(invRow.batches || [])] : [];
          const rawBatches = [...existingBatches, newBatch];
          const derived = computeInventoryDerivedFields(rawBatches, 10);

          const invFields = {
            medId, brand: row.brand, doseForm: row.doseForm, strength: row.strength,
            batches: derived.batches, totalStock: derived.totalStock,
            costValue: derived.costValue, mrpValue: derived.mrpValue,
            nearestExpiry: derived.nearestExpiry,
            sellPrice: row.sellPrice > 0 ? row.sellPrice : (invRow?.sellPrice || 0),
            status: derived.status,
          };
          batch.set(userCol('inventory').doc(medId), invFields, { merge: true });

          if (invRow) Object.assign(invRow, invFields);
          else { invRow = invFields; resultInventory.push(invRow); }

          const entryId = 'OB-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
          const openingEntry = {
            entryId, date: todayStr(), category: 'স্টক', description: 'বাল্ক ইম্পোর্ট',
            amount: round2(row.totalStock * row.costPrice),
            medicineId: medId, brand: row.brand, qty: row.totalStock,
            costPrice: row.costPrice, mrp: row.mrp, sellPrice: row.sellPrice,
            expiryDate: row.expiryDate || '', batchId,
          };
          batch.set(userCol('openingEntries').doc(entryId), openingEntry);
          resultOpeningEntries.push(openingEntry);
        } else if (isNewMed) {
          // স্টক শূন্য কিন্তু নতুন ওষুধ — বাকি সব মডিউল ধরে নেয় প্রতিটা
          // medicine-এর একটা inventory doc আছে, তাই placeholder বসানো হচ্ছে
          const invFields = {
            medId, brand: row.brand, doseForm: row.doseForm, strength: row.strength,
            totalStock: 0, costValue: 0, mrpValue: 0, sellPrice: row.sellPrice || 0,
            nearestExpiry: '', status: 'out', batches: [],
          };
          batch.set(userCol('inventory').doc(medId), invFields, { merge: true });
          if (!invRow) resultInventory.push(invFields);
        }
      }

      try {
        await batch.commit();
      } catch (err) {
        if (err.code === 'resource-exhausted') {
          return {
            success: false, quotaExceeded: true, count: done, addedMedCount,
            medicines: resultMedicines, inventory: resultInventory, openingEntries: resultOpeningEntries,
            message: `Firestore দৈনিক সীমা শেষ। ${done}/${total} সারি হয়েছে — quota রিসেট হলে (মধ্যরাত, Pacific Time) একই ডেটা আবার পেস্ট করলে ইতিমধ্যে-যোগ-হওয়া ওষুধ স্বয়ংক্রিয়ভাবে স্কিপ হয়ে বাকি অংশ থেকে চলবে।`,
          };
        }
        throw err;
      }
      done += chunk.length;
      if (onProgress) onProgress(done, total);
    }

    return {
      success: true, count: done, addedMedCount,
      medicines: resultMedicines, inventory: resultInventory, openingEntries: resultOpeningEntries,
    };
  } catch (err) {
    return { success: false, message: humanizeError(err) };
  }
}
