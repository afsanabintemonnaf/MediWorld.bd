'use strict';

function requireSuperAdmin() {
  if (APP_STATE.isSuperAdmin === true && isSuperAdminUser()) return false;
  toast(`${APP_CONFIG.PLATFORM_NAME} Platform User Management ও billing controls শুধু Super Admin পরিচালনা করতে পারবেন।`, 'e');
  return true;
}

async function renderAdminModule() {
  const c = document.getElementById('admin-content');
  if (!c) return;
  if (requireSuperAdmin()) {
    c.innerHTML = '<div class="bg-white dark:bg-slate-800 rounded-xl p-8 text-center text-red-500">শুধু Super Admin এই পেজ দেখতে পারবেন।</div>';
    return;
  }
  c.innerHTML = '<div class="text-sm text-slate-500 p-5">Platform user তালিকা লোড হচ্ছে...</div>';
  try {
    const snapshot = await fbDb.collection('platformUsers').get();
    const users = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }))
      .sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt));
    c.innerHTML = `
      <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mb-4">
        <h3 class="font-semibold"><i class="fa-solid fa-shield-halved text-brand mr-2"></i>${esc(APP_CONFIG.PLATFORM_NAME)} — Super Admin Platform User Management</h3>
        <p class="text-xs text-slate-500 mt-2">এককালীন setup ৳১০,০০০ · ঐচ্ছিক store setup +৳৫,০০০ · maintenance ৳১,৫০০/মাস। Owner-এর নিজের workspace-এর Branch ও Staff ব্যবস্থাপনা আলাদা।</p>
        <div class="mt-3 text-xs text-slate-500">মোট আবেদন: ${users.length} · যোগাযোগ: ${esc(APP_CONFIG.SUPPORT_PHONE)}</div>
      </div>
      <div class="space-y-3">${users.length ? users.map(renderPlatformUser).join('') :
        '<div class="bg-white dark:bg-slate-800 rounded-xl p-5 text-sm text-slate-500">এখনো কোনো Platform user request নেই।</div>'}</div>`;
  } catch (err) {
    c.innerHTML = `<div class="bg-red-50 text-red-700 rounded-xl p-5">Platform users লোড ব্যর্থ: ${esc(humanizeError(err))}</div>`;
  }
}

function renderPlatformUser(user) {
  const access = platformAccessState(user);
  const statusLabel = {
    pending: 'অনুমোদনের অপেক্ষায়',
    active: access.active ? 'সক্রিয় ও পরিশোধিত' : 'সক্রিয় — পেমেন্ট/মেয়াদ প্রয়োজন',
    past_due: 'পেমেন্ট বকেয়া / মেয়াদ শেষ',
    unpaid: 'সেটআপ ফি বকেয়া',
    revoked: 'বাতিল / স্থগিত',
  }[access.status] || esc(access.status || 'pending');
  const expiry = user.validUntil
    ? new Date(dateValue(user.validUntil)).toLocaleDateString('bn-BD')
    : 'সেট করা নেই';
  const history = Array.isArray(user.paymentHistory) ? user.paymentHistory : [];
  return `<article class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
    <div class="flex flex-wrap justify-between gap-3">
      <div>
        <h4 class="font-semibold">${esc(user.displayName || user.email || user.uid)}</h4>
        <p class="text-xs text-slate-500">${esc(user.email || '')} · UID: <code>${esc(user.uid)}</code></p>
      </div>
      <span class="text-xs rounded-full px-3 py-1 ${access.active ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}">${esc(statusLabel)}</span>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mt-4">
      <div>সেটআপ ফি: <strong>৳${user.setupFeePaid === true ? 'পরিশোধিত' : 'বকেয়া'} (${access.setupFee.toLocaleString('en-US')})</strong></div>
      <div>Store setup: <strong>${user.storeSetupAssistance === true ? '+৳৫,০০০' : 'বন্ধ'}</strong></div>
      <div>বৈধতা: <strong>${esc(expiry)}</strong></div>
      <div>মাসিক ফি: <strong>৳১,৫০০</strong></div>
    </div>
    ${user.revocationNote ? `<p class="text-xs text-red-600 mt-2">স্থগিতের নোট: ${esc(user.revocationNote)}</p>` : ''}
    <div class="flex flex-wrap gap-2 mt-4">
      <button onclick="approvePlatformUser('${esc(user.uid)}')" class="btn btn-primary btn-sm">Approve / Accept</button>
      <button onclick="revokePlatformUser('${esc(user.uid)}')" class="btn btn-danger-outline btn-sm">Revoke / Suspend</button>
      <button onclick="togglePlatformStoreSetup('${esc(user.uid)}', ${user.storeSetupAssistance === true})" class="btn btn-secondary btn-sm">${user.storeSetupAssistance === true ? '৳৫,০০০ add-on বন্ধ' : '+৳৫,০০০ add-on চালু'}</button>
      <button onclick="setPlatformSetupFeePaid('${esc(user.uid)}', ${user.setupFeePaid === true})" class="btn btn-secondary btn-sm">Setup fee ${user.setupFeePaid === true ? 'unpaid করুন' : 'paid চিহ্নিত করুন'}</button>
      <input id="monthly-payment-note-${esc(user.uid)}" class="border rounded px-2 py-1 text-xs" placeholder="মাসিক পেমেন্ট reference / note"/>
      <button onclick="recordPlatformMonthlyPayment('${esc(user.uid)}')" class="btn btn-brand-outline btn-sm">৳১,৫০০ payment record</button>
    </div>
    <p class="text-[11px] text-slate-400 mt-3">Payment history (${history.length}): ${history.slice(-3).map(item =>
      `${new Date(dateValue(item.paidAt)).toLocaleDateString('bn-BD')} · ৳${Number(item.amount || 0).toLocaleString('en-US')}${item.note ? ` · ${esc(item.note)}` : ''}`
    ).join(' | ') || 'কোনো payment নেই'}</p>
  </article>`;
}

function dateValue(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  const date = new Date(value || 0).getTime();
  return Number.isFinite(date) ? date : 0;
}

function addUtcMonth(timestamp) {
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

async function updatePlatformUser(uid, updates) {
  if (requireSuperAdmin()) return false;
  try {
    await fbDb.collection('platformUsers').doc(uid).update({
      ...updates,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await renderAdminModule();
    return true;
  } catch (err) {
    toast('Platform user update ব্যর্থ: ' + humanizeError(err), 'e');
    return false;
  }
}

async function approvePlatformUser(uid) {
  if (requireSuperAdmin()) return;
  try {
    const ref = fbDb.collection('platformUsers').doc(uid);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('আবেদনটি পাওয়া যায়নি।');
    const user = snapshot.data();
    const batch = fbDb.batch();
    batch.update(ref, {
      status: 'active',
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedBy: APP_STATE.currentUser.uid,
      revocationNote: '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(fbDb.collection('owners').doc(uid), {
      uid,
      email: String(user.email || '').toLowerCase(),
      displayName: user.displayName || '',
      role: 'owner',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    toast('Owner অনুমোদিত হয়েছে। Setup fee paid ও monthly validity না থাকলে core access বন্ধ থাকবে।', 's');
    await renderAdminModule();
  } catch (err) {
    toast('Approval ব্যর্থ: ' + humanizeError(err), 'e');
  }
}

async function revokePlatformUser(uid) {
  if (requireSuperAdmin()) return;
  const note = prompt('Revoke/Suspend করার কারণ লিখুন:');
  if (note === null) return;
  if (!note.trim()) return toast('Suspend note লিখুন।', 'w');
  if (await updatePlatformUser(uid, {
    status: 'revoked',
    revocationNote: note.trim(),
    revokedAt: firebase.firestore.FieldValue.serverTimestamp(),
    revokedBy: APP_STATE.currentUser.uid,
  })) toast('অ্যাকাউন্ট Suspend/Revoke হয়েছে।', 's');
}

async function togglePlatformStoreSetup(uid, currentlyEnabled) {
  if (requireSuperAdmin()) return;
  try {
    const snapshot = await fbDb.collection('platformUsers').doc(uid).get();
    if (!snapshot.exists) throw new Error('Platform user পাওয়া যায়নি।');
    const user = snapshot.data();
    const updates = { storeSetupAssistance: !currentlyEnabled };
    if (!currentlyEnabled) {
      updates.setupFeePaid = false;
      if (['active', 'past_due', 'unpaid'].includes(user.status)) updates.status = 'unpaid';
    }
    await updatePlatformUser(uid, updates);
  } catch (err) {
    toast('Store setup add-on update ব্যর্থ: ' + humanizeError(err), 'e');
  }
}

async function setPlatformSetupFeePaid(uid, currentlyPaid) {
  if (requireSuperAdmin()) return;
  try {
    const updates = {
      setupFeePaid: !currentlyPaid,
      setupFeeUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      setupFeeUpdatedBy: APP_STATE.currentUser.uid,
    };
    const snapshot = await fbDb.collection('platformUsers').doc(uid).get();
    if (!snapshot.exists) throw new Error('Platform user পাওয়া যায়নি।');
    const user = snapshot.data();
    if (currentlyPaid && user.status !== 'revoked' && user.status !== 'pending') {
      updates.status = 'unpaid';
    } else if (!currentlyPaid && user.status === 'unpaid') {
      updates.status = 'active';
    }
    if (!currentlyPaid) {
      updates.paymentHistory = firebase.firestore.FieldValue.arrayUnion({
        amount: PLATFORM_BILLING.setupFee +
          (user.storeSetupAssistance === true ? PLATFORM_BILLING.storeSetupFee : 0),
        type: 'setup',
        paidAt: new Date(),
        note: 'Setup fee payment marked by Super Admin',
        recordedBy: APP_STATE.currentUser.uid,
      });
    }
    await updatePlatformUser(uid, updates);
  } catch (err) {
    toast('Setup fee update ব্যর্থ: ' + humanizeError(err), 'e');
  }
}

async function recordPlatformMonthlyPayment(uid) {
  if (requireSuperAdmin()) return;
  try {
    const note = document.getElementById(`monthly-payment-note-${uid}`)?.value.trim() || '';
    const ref = fbDb.collection('platformUsers').doc(uid);
    await fbDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('Platform user পাওয়া যায়নি।');
      const user = snapshot.data();
      const now = Date.now();
      const base = Math.max(now, dateValue(user.validUntil));
      const validUntil = addUtcMonth(base);
      transaction.update(ref, {
        status: ['active', 'past_due', 'unpaid'].includes(user.status) ? 'active' : user.status,
        validUntil: firebase.firestore.Timestamp.fromDate(validUntil),
        paymentHistory: firebase.firestore.FieldValue.arrayUnion({
          amount: PLATFORM_BILLING.monthlyFee,
          paidAt: new Date(now),
          validUntil,
          note,
          recordedBy: APP_STATE.currentUser.uid,
        }),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    toast('৳১,৫০০ payment record হয়েছে; এক মাস validity যোগ হয়েছে।', 's');
    await renderAdminModule();
  } catch (err) {
    toast('মাসিক payment record ব্যর্থ: ' + humanizeError(err), 'e');
  }
}
