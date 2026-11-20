'use strict';

let ADMIN_FILTER_STATUS = 'all';

function requireSuperAdmin() {
  if (APP_STATE.isSuperAdmin === true && isSuperAdminUser()) return false;
  toast(`${APP_CONFIG.PLATFORM_NAME} Platform User Management ও billing controls শুধু Super Admin পরিচালনা করতে পারবেন।`, 'e');
  return true;
}

function setAdminFilterStatus(status) {
  ADMIN_FILTER_STATUS = ['all', 'pending', 'approved', 'revoked'].includes(status)
    ? status
    : 'all';
  renderAdminModule();
}

function matchesAdminFilter(user) {
  const access = platformAccessState(user);
  if (ADMIN_FILTER_STATUS === 'pending') {
    return access.status === 'pending' || (access.status === 'active' && !access.active);
  }
  if (ADMIN_FILTER_STATUS === 'approved') {
    return access.status === 'active' && access.active;
  }
  if (ADMIN_FILTER_STATUS === 'revoked') {
    return access.status === 'revoked' || access.status === 'past_due' || access.status === 'unpaid';
  }
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
    const filteredUsers = users.filter(matchesAdminFilter);

    const tabs = [
      { id: 'pending', label: 'পেন্ডিং' },
      { id: 'approved', label: 'Approved' },
      { id: 'revoked', label: 'Revoked' },
      { id: 'all', label: 'সব' },
    ];

    c.innerHTML = `
      <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 md:p-5 mb-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold text-base"><i class="fa-solid fa-shield-halved text-brand mr-2"></i>ইউজার ম্যানেজমেন্ট (${users.length})</h3>
            <p class="text-xs text-slate-500 mt-1">${esc(APP_CONFIG.PLATFORM_NAME)} · Setup ৳১০,০০০ · Store setup +৳৫,০০০ · Maintenance ৳১,৫০০/মাস · ${esc(APP_CONFIG.SUPPORT_PHONE)}</p>
          </div>
          <div class="flex flex-wrap gap-1.5" role="tablist" aria-label="User status filter">
            ${tabs.map(t => {
              const active = ADMIN_FILTER_STATUS === t.id;
              return `<button type="button" onclick="setAdminFilterStatus('${t.id}')" class="px-3 py-1.5 rounded-lg text-xs font-medium transition ${active
                ? 'bg-brand text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'}">${esc(t.label)}</button>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-xs text-slate-500">
                <th class="py-3 px-4 font-semibold">ইউজার</th>
                <th class="py-3 px-4 font-semibold">স্ট্যাটাস</th>
                <th class="py-3 px-4 font-semibold text-right">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-700/70">
              ${filteredUsers.length ? filteredUsers.map(renderPlatformUserRow).join('') :
                `<tr><td colspan="3" class="py-8 px-4 text-center text-sm text-slate-500">এই ফিল্টারে কোনো Platform user নেই।</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  } catch (err) {
    c.innerHTML = `<div class="bg-red-50 text-red-700 rounded-xl p-5">Platform users লোড ব্যর্থ: ${esc(humanizeError(err))}</div>`;
  }
}

function renderPlatformUserRow(user) {
  const access = platformAccessState(user);
  const statusText = {
    pending: 'অনুমোদনের অপেক্ষায়',
    active: access.active ? 'সক্রিয় ও পরিশোধিত' : 'সক্রিয় — অনুমোদন / পেমেন্ট প্রয়োজন',
    past_due: 'মেয়াদ শেষ / পেমেন্ট বকেয়া',
    unpaid: 'সেটআপ ফি বকেয়া',
    revoked: 'বাতিল / স্থগিত',
  }[access.status] || esc(access.status || 'pending');

  const expiry = user.validUntil
    ? new Date(dateValue(user.validUntil)).toLocaleDateString('bn-BD')
    : 'সেট করা নেই';
  const history = Array.isArray(user.paymentHistory) ? user.paymentHistory : [];

  return `<tr class="align-top hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition">
    <td class="py-3.5 px-4">
      <div class="font-semibold text-sm text-slate-800 dark:text-slate-100">${esc(user.displayName || user.email || user.uid)}</div>
      <div class="text-xs text-slate-500">${esc(user.email || '')}</div>
      <div class="text-[11px] text-slate-400 mt-0.5">UID: <code>${esc(user.uid)}</code>${user.byokProjectId ? ` · BYOK: <code>${esc(user.byokProjectId)}</code>` : ''}</div>
      ${user.revocationNote ? `<div class="text-xs text-red-600 mt-1">নোট: ${esc(user.revocationNote)}</div>` : ''}
    </td>
    <td class="py-3.5 px-4 text-xs">
      <span class="inline-block rounded-full px-2.5 py-0.5 font-medium ${access.active ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}">${esc(statusText)}</span>
      <div class="text-slate-600 dark:text-slate-300 mt-1.5">Setup: <strong>${user.setupFeePaid === true ? 'Paid' : 'Due'}</strong> (${access.setupFee.toLocaleString('en-US')}) · Add-on: <strong>${user.storeSetupAssistance === true ? '+৳৫,০০০' : 'না'}</strong></div>
      <div class="text-slate-500 mt-0.5">বৈধতা: <strong>${esc(expiry)}</strong> · পেমেন্ট: ${history.length}টি</div>
    </td>
    <td class="py-3.5 px-4 text-right">
      <div class="flex flex-wrap justify-end items-center gap-1.5">
        <input id="monthly-payment-note-${esc(user.uid)}" class="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-xs w-28 bg-white dark:bg-slate-700" placeholder="পেমেন্ট নোট"/>
        <button type="button" onclick="recordPlatformMonthlyPayment('${esc(user.uid)}')" class="btn btn-brand-outline btn-sm">১ মাস</button>
        <button type="button" onclick="approvePlatformUser('${esc(user.uid)}')" class="btn btn-primary btn-sm">Approve</button>
        <button type="button" onclick="revokePlatformUser('${esc(user.uid)}')" class="btn btn-danger-outline btn-sm">Revoke</button>
      </div>
      <div class="flex flex-wrap justify-end gap-1.5 mt-1.5">
        <button type="button" onclick="setPlatformSetupFeePaid('${esc(user.uid)}', ${user.setupFeePaid === true})" class="btn btn-secondary btn-sm">${user.setupFeePaid === true ? 'Setup Unpaid' : 'Setup Paid'}</button>
        <button type="button" onclick="togglePlatformStoreSetup('${esc(user.uid)}', ${user.storeSetupAssistance === true})" class="btn btn-secondary btn-sm">${user.storeSetupAssistance === true ? 'Add-on বন্ধ' : '+৳৫,০০০ Add-on'}</button>
      </div>
    </td>
  </tr>`;
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
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedBy: APP_STATE.currentUser.uid,
    }, { merge: true });
    await batch.commit();
    toast('Platform user অনুমোদিত হয়েছে।', 's');
    await renderAdminModule();
  } catch (err) {
    toast('অনুমোদন ব্যর্থ: ' + humanizeError(err), 'e');
  }
}

async function revokePlatformUser(uid) {
  if (requireSuperAdmin()) return;
  const note = prompt('স্থগিত বা বাতিল করার কারণ লিখুন:', '');
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
        paidAt: new Date().toISOString(),
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
          type: 'monthly',
          note,
          paidAt: new Date().toISOString(),
          recordedBy: APP_STATE.currentUser.uid,
        }),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    toast('১ মাসের (৳১,৫০০) পেমেন্ট রেকর্ড হয়েছে।', 's');
    await renderAdminModule();
  } catch (err) {
    toast('মাসিক পেমেন্ট রেকর্ড ব্যর্থ: ' + humanizeError(err), 'e');
  }
}
