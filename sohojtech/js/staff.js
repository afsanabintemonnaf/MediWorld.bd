'use strict';

let staffListUnsub = null;
let branchListUnsub = null;
const STAFF_ROLE_LABELS = { manager: 'ম্যানেজার', cashier: 'ক্যাশিয়ার' };
const STAFF_PERMISSION_KEYS = [
  ['pos', 'বিক্রয় / POS'],
  ['purchase', 'ক্রয়'],
  ['inventory', 'ইনভেন্টরি'],
  ['medicine', 'ওষুধ মাস্টার'],
  ['returns', 'রিটার্ন'],
  ['opening', 'পূর্বের হিসাব'],
  ['customers', 'গ্রাহক'],
  ['suppliers', 'সরবরাহকারী'],
  ['transfer', 'Branch Transfer'],
  ['accounts', 'অ্যাকাউন্টস'],
  ['dailyReport', 'দৈনিক রিপোর্ট'],
  ['maintenance', 'রক্ষণাবেক্ষণ'],
];

function staffRolePreset(role) {
  if (role === 'manager') return Object.fromEntries(STAFF_PERMISSION_KEYS.map(([key]) =>
    [key, ['accounts', 'dailyReport', 'maintenance'].indexOf(key) === -1]));
  return Object.fromEntries(STAFF_PERMISSION_KEYS.map(([key]) =>
    [key, ['pos', 'returns', 'customers', 'inventory'].indexOf(key) !== -1]));
}

function renderStaffModule() {
  if (!APP_STATE.isOwner || guardOwnerOnly()) {
    document.getElementById('staff-content').innerHTML =
      '<div class="text-sm text-red-500 p-5">অনুমোদিত Owner নিজের ব্যবসার Staff ও Branch পরিচালনা করতে পারবেন।</div>';
    return;
  }
  const c = document.getElementById('staff-content');
  c.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
        <h5 class="text-sm font-semibold mb-3">নতুন Branch</h5>
        <input id="branch-name" class="w-full border rounded px-3 py-2 text-sm mb-2" placeholder="Branch নাম"/>
        <input id="branch-address" class="w-full border rounded px-3 py-2 text-sm mb-2" placeholder="ঠিকানা (ঐচ্ছিক)"/>
        <input id="branch-phone" class="w-full border rounded px-3 py-2 text-sm mb-2" placeholder="ফোন (ঐচ্ছিক)"/>
        <button onclick="createBranch()" class="btn btn-primary btn-sm">Branch তৈরি</button>
      </div>
      <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
        <h5 class="text-sm font-semibold mb-3">নতুন স্টাফ তৈরি / বিদ্যমান UID যোগ</h5>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input id="staff-name" class="border rounded px-3 py-2 text-sm" placeholder="স্টাফের নাম"/>
          <input id="staff-email" type="email" class="border rounded px-3 py-2 text-sm" placeholder="Email"/>
          <input id="staff-password" type="password" class="border rounded px-3 py-2 text-sm" placeholder="নতুন Firebase password (ঐচ্ছিক)"/>
          <input id="staff-existing-uid" class="border rounded px-3 py-2 text-sm" placeholder="বিদ্যমান Firebase UID (ঐচ্ছিক)"/>
          <select id="staff-role" onchange="applyStaffRolePreset(this.value)" class="border rounded px-3 py-2 text-sm">
            <option value="cashier">ক্যাশিয়ার</option>
            <option value="manager">ম্যানেজার</option>
          </select>
        </div>
        <label class="block text-xs font-semibold text-slate-500 mt-3 mb-1">Branch assignment</label>
        <div id="staff-create-branches" class="grid grid-cols-1 sm:grid-cols-2 gap-1 mb-3"></div>
        <label class="block text-xs font-semibold text-slate-500 mt-2 mb-1">Module permissions</label>
        <div id="staff-create-permissions" class="grid grid-cols-2 md:grid-cols-3 gap-1 mb-3"></div>
        <button onclick="createOrLinkStaff()" class="btn btn-primary btn-sm"><i class="fa-solid fa-user-plus mr-1"></i> স্টাফ তৈরি / যোগ করুন</button>
        <div id="staff-roster-list" class="mt-3"></div>
      </div>
    </div>
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mt-4">
      <h5 class="text-sm font-semibold mb-3">Branch পরিচালনা</h5>
      <div id="branch-management-list"></div>
    </div>
    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mt-4">
      <h5 class="text-sm font-semibold mb-3">স্টাফ বেতন সেটআপ</h5>
      <div id="staff-salary-setups"></div>
    </div>
  `;
  loadStaffAndBranches();
}

async function createBranch() {
  if (guardOwnerOnly()) return;
  const name = document.getElementById('branch-name').value.trim();
  if (!name) return toast('Branch নাম দিন।', 'w');
  const address = document.getElementById('branch-address').value.trim();
  const phone = document.getElementById('branch-phone').value.trim();
  const ref = fbDb.collection('branches').doc();
  try {
    await ref.set({
      name, address, phone,
      active: true,
      ownerUid: APP_STATE.currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    document.getElementById('branch-name').value = '';
    document.getElementById('branch-address').value = '';
    document.getElementById('branch-phone').value = '';
    toast('Branch তৈরি হয়েছে।', 's');
  } catch (err) {
    toast('Branch তৈরি ব্যর্থ: ' + err.message, 'e');
  }
}

function loadStaffAndBranches() {
  if (guardOwnerOnly()) return;
  if (staffListUnsub) staffListUnsub();
  if (branchListUnsub) branchListUnsub();
  let latestBranches = [];
  let latestStaff = [];
  branchListUnsub = fbDb.collection('branches').where('ownerUid', '==', APP_STATE.currentUser.uid).onSnapshot((branchesSnap) => {
    latestBranches = branchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    APP_STATE.branches = latestBranches;
    renderBranchSelector();
    renderBranchManagementList(latestBranches);
    renderStaffRosterList(latestStaff, latestBranches);
    renderStaffCreateControls(latestBranches);
  }, err => toast('Branch তালিকা লোড ব্যর্থ: ' + err.message, 'e'));
  staffListUnsub = fbDb.collection('staff').where('ownerUid', '==', APP_STATE.currentUser.uid).onSnapshot((staffSnap) => {
    latestStaff = staffSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStaffRosterList(latestStaff, latestBranches);
    renderStaffSalarySetups(latestStaff, latestBranches);
  }, err => toast('স্টাফ তালিকা লোড ব্যর্থ: ' + err.message, 'e'));
}

function renderStaffSalarySetups(staff, branches) {
  const box = document.getElementById('staff-salary-setups');
  if (!box) return;
  if (!staff.length) { box.innerHTML = '<div class="text-xs text-slate-400">প্রথমে স্টাফ যোগ করুন।</div>'; return; }
  box.innerHTML = staff.map(s => `
    <div class="border-t py-3 grid grid-cols-1 md:grid-cols-[1fr_120px_150px_160px_auto] gap-2 items-center">
      <div><div class="text-sm font-semibold">${esc(s.name || s.email)}</div><div class="text-[11px] text-slate-400">${esc(s.email || s.id)}</div></div>
      <input type="number" id="salary-base-${esc(s.id)}" min="0" step="1" value="0" placeholder="বেস বেতন" class="border rounded px-2 py-2 text-sm"/>
      <select id="salary-cycle-${esc(s.id)}" class="border rounded px-2 py-2 text-sm"><option value="monthly">মাসিক</option><option value="weekly">সাপ্তাহিক</option><option value="daily">দৈনিক</option></select>
      <select id="salary-branch-${esc(s.id)}" class="border rounded px-2 py-2 text-sm">${branches.filter(b=>b.active!==false).map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select>
      <button onclick="saveStaffSalarySetup('${esc(s.id)}')" class="btn btn-primary btn-sm">সংরক্ষণ</button>
      <input type="text" id="salary-notes-${esc(s.id)}" placeholder="নোট (ঐচ্ছিক)" class="md:col-span-5 border rounded px-2 py-2 text-sm"/>
    </div>`).join('');
  loadSalarySetupValues(staff);
}

async function loadSalarySetupValues(staff) {
  for (const s of staff) {
    for (const branchId of (s.assignedBranchIds || [])) {
      try {
        const snap = await fbDb.collection('branches').doc(branchId).collection('staffSalarySetups').doc(s.id).get();
        if (!snap.exists) continue;
        const data = snap.data();
        const base = document.getElementById(`salary-base-${s.id}`);
        const cycle = document.getElementById(`salary-cycle-${s.id}`);
        const setupBranch = document.getElementById(`salary-branch-${s.id}`);
        const notes = document.getElementById(`salary-notes-${s.id}`);
        if (base) base.value = data.baseSalary ?? 0;
        if (cycle) cycle.value = data.payCycle || 'monthly';
        if (setupBranch) setupBranch.value = data.branchId || branchId;
        if (notes) notes.value = data.notes || '';
        break;
      } catch (err) { console.warn('Salary setup load failed:', err); }
    }
  }
}

async function saveStaffSalarySetup(staffUid) {
  if (guardOwnerOnly()) return;
  const baseSalary = round2(parseFloat(document.getElementById(`salary-base-${staffUid}`)?.value) || 0);
  const payCycle = document.getElementById(`salary-cycle-${staffUid}`)?.value || 'monthly';
  const branchId = document.getElementById(`salary-branch-${staffUid}`)?.value;
  const notes = document.getElementById(`salary-notes-${staffUid}`)?.value.trim() || '';
  if (!branchId || baseSalary < 0) return toast('Branch ও বৈধ বেতন দিন।', 'w');
  try {
    await fbDb.collection('branches').doc(branchId).collection('staffSalarySetups').doc(staffUid).set({
      staffUid, baseSalary, payCycle, notes, active: true, branchId,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    APP_STATE.salarySetups = [...APP_STATE.salarySetups.filter(x => x.staffUid !== staffUid), { staffUid, baseSalary, payCycle, notes, active: true, branchId }];
    toast('স্টাফ বেতন সেটআপ সংরক্ষিত হয়েছে।', 's');
  } catch (err) { toast('বেতন সেটআপ ব্যর্থ: ' + err.message, 'e'); }
}

function renderBranchManagementList(branches) {
  const box = document.getElementById('branch-management-list');
  if (!box) return;
  if (!branches.length) {
    box.innerHTML = '<div class="text-xs text-slate-400 py-4">কোনো Branch নেই।</div>';
    return;
  }
  box.innerHTML = branches.map(b => `
    <div class="border-t py-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
      <input id="branch-edit-name-${esc(b.id)}" value="${esc(b.name || '')}" aria-label="Branch নাম"
        class="border rounded px-3 py-2 text-sm" placeholder="Branch নাম"/>
      <input id="branch-edit-address-${esc(b.id)}" value="${esc(b.address || '')}" aria-label="Branch ঠিকানা"
        class="border rounded px-3 py-2 text-sm" placeholder="ঠিকানা"/>
      <input id="branch-edit-phone-${esc(b.id)}" value="${esc(b.phone || '')}" aria-label="Branch ফোন"
        class="border rounded px-3 py-2 text-sm" placeholder="ফোন"/>
      <div class="flex items-center gap-2">
        <button onclick="saveBranchDetails('${esc(b.id)}')" class="btn btn-secondary btn-sm">সংরক্ষণ</button>
        <button onclick="toggleBranchActive('${esc(b.id)}', ${b.active === true})"
          class="btn btn-sm ${b.active === true ? 'btn-secondary text-amber-700' : 'btn-primary'}">
          ${b.active === true ? 'নিষ্ক্রিয় করুন' : 'সক্রিয় করুন'}
        </button>
      </div>
      <div class="md:col-span-4 text-[11px] ${b.active === true ? 'text-emerald-600' : 'text-amber-600'}">
        ${b.active === true ? 'সক্রিয়' : 'নিষ্ক্রিয় — Owner হিসেবে ডেটা দেখা যাবে'}
      </div>
    </div>`).join('');
}

async function saveBranchDetails(branchId) {
  if (guardOwnerOnly()) return;
  const name = document.getElementById(`branch-edit-name-${branchId}`)?.value.trim();
  if (!name) return toast('Branch নাম দিন।', 'w');
  const address = document.getElementById(`branch-edit-address-${branchId}`)?.value.trim() || '';
  const phone = document.getElementById(`branch-edit-phone-${branchId}`)?.value.trim() || '';
  try {
    await fbDb.collection('branches').doc(branchId).update({
      name, address, phone,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast('Branch-এর তথ্য আপডেট হয়েছে।', 's');
  } catch (err) {
    toast('Branch আপডেট ব্যর্থ: ' + err.message, 'e');
  }
}

async function toggleBranchActive(branchId, isActive) {
  if (guardOwnerOnly()) return;
  const branch = APP_STATE.branches.find(b => b.id === branchId);
  if (!branch) return toast('Branch পাওয়া যায়নি।', 'e');
  if (isActive) {
    const activityCollections = ['sales', 'purchases', 'returns', 'expenses', 'payments', 'supplierPayments', 'inventory', 'medicines', 'openingEntries', 'financialLedger'];
    let hasActivity = false;
    try {
      const branchChecks = await Promise.all(activityCollections.map(name =>
        fbDb.collection('branches').doc(branchId).collection(name).limit(1).get()
      ));
      const transferChecks = await Promise.all(['sourceBranchId', 'targetBranchId'].map(field =>
        fbDb.collection('transfers').where(field, '==', branchId).limit(1).get()
      ));
      hasActivity = branchChecks.some(snap => !snap.empty) || transferChecks.some(snap => !snap.empty);
    } catch (err) {
      return toast('Branch-এর ডেটা যাচাই ব্যর্থ; নিষ্ক্রিয় করা হয়নি: ' + err.message, 'e');
    }
    const warning = hasActivity
      ? 'এই Branch-এ লেনদেন বা Inventory-এর ডেটা আছে। Branch নিষ্ক্রিয় হবে, তবে কোনো ডেটা মুছবে না। Owner পরে ডেটা দেখতে পারবেন। এগোবেন?'
      : 'Branch নিষ্ক্রিয় করবেন? Branch-এর ডেটা মুছবে না।';
    if (!confirm(warning)) return;
  }
  try {
    await fbDb.collection('branches').doc(branchId).update({
      active: !isActive,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast(isActive ? 'Branch নিষ্ক্রিয় হয়েছে; ডেটা অক্ষত আছে।' : 'Branch সক্রিয় হয়েছে।', 's');
  } catch (err) {
    toast('Branch status আপডেট ব্যর্থ: ' + err.message, 'e');
  }
}

function renderStaffCreateControls(branches) {
  const branchesBox = document.getElementById('staff-create-branches');
  const permissionsBox = document.getElementById('staff-create-permissions');
  if (branchesBox) {
    branchesBox.innerHTML = branches.filter(b => b.active !== false).map(b =>
      `<label class="flex items-center gap-2 text-xs border rounded px-2 py-1">
        <input type="checkbox" class="staff-create-branch" value="${esc(b.id)}"/> ${esc(b.name)}
      </label>`).join('');
  }
  if (permissionsBox) applyStaffRolePreset(document.getElementById('staff-role')?.value || 'cashier');
}

function applyStaffRolePreset(role) {
  const preset = staffRolePreset(role);
  const box = document.getElementById('staff-create-permissions');
  if (!box) return;
  box.innerHTML = STAFF_PERMISSION_KEYS.map(([key, label]) =>
    `<label class="flex items-center gap-2 text-xs border rounded px-2 py-1">
      <input type="checkbox" class="staff-create-permission" value="${esc(key)}" ${preset[key] ? 'checked' : ''}/> ${esc(label)}
    </label>`).join('');
}

async function createOrLinkStaff() {
  if (guardOwnerOnly()) return;
  const name = document.getElementById('staff-name')?.value.trim() || '';
  const email = document.getElementById('staff-email')?.value.trim().toLowerCase() || '';
  const password = document.getElementById('staff-password')?.value || '';
  const existingUid = document.getElementById('staff-existing-uid')?.value.trim() || '';
  const role = document.getElementById('staff-role')?.value || 'cashier';
  const branchIds = Array.from(document.querySelectorAll('.staff-create-branch:checked')).map(el => el.value);
  const permissions = {};
  document.querySelectorAll('.staff-create-permission:checked').forEach(el => { permissions[el.value] = true; });
  STAFF_PERMISSION_KEYS.forEach(([key]) => { if (!(key in permissions)) permissions[key] = false; });

  if (!email) return toast('স্টাফের Email দিন।', 'w');
  if (!branchIds.length) return toast('কমপক্ষে একটি সক্রিয় Branch নির্বাচন করুন।', 'w');

  let uid = existingUid;
  let secondaryApp = null;
  let isInviteOnly = false;
  try {
    if (!uid && password) {
      if (password.length < 6) return toast('নতুন অ্যাকাউন্টের password কমপক্ষে ৬ অক্ষরের দিন।', 'w');
      const appName = 'staff-create-' + Date.now();
      secondaryApp = firebase.apps.find(app => app.name === appName)
        || firebase.initializeApp(APP_CONFIG.firebase, appName);
      const credential = await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
      uid = credential.user.uid;
      await secondaryApp.auth().signOut();
    } else if (!uid && !password) {
      isInviteOnly = true;
    }
    if (uid && uid === APP_STATE.currentUser?.uid) return toast('নিজের UID স্টাফ হিসেবে যোগ করা যাবে না।', 'e');
    const docId = uid || ('INV-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase());
    await fbDb.collection('staff').doc(docId).set({
      uid: uid || null,
      email,
      displayName: name,
      ownerUid: APP_STATE.currentUser.uid,
      role: role === 'manager' ? 'manager' : 'cashier',
      assignedBranchIds: branchIds,
      permissions,
      active: true,
      status: isInviteOnly ? 'invited' : 'active',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast(
      isInviteOnly
        ? 'স্টাফ ইনভাইট তৈরি হয়েছে (প্রথম লগইনে অ্যাকাউন্ট বাইন্ড হবে)।'
        : (existingUid ? 'বিদ্যমান UID স্টাফ হিসেবে যোগ হয়েছে।' : 'স্টাফ Firebase অ্যাকাউন্ট এবং রেকর্ড তৈরি হয়েছে।'),
      's'
    );
    document.getElementById('staff-name').value = '';
    document.getElementById('staff-email').value = '';
    document.getElementById('staff-password').value = '';
    document.getElementById('staff-existing-uid').value = '';
  } catch (err) {
    if (uid && !existingUid) {
      try {
        await fbDb.collection('staff').doc(uid).delete();
        console.warn('Best-effort staff rollback: Firestore binding removed for UID', uid);
      } catch (cleanupErr) {
        console.warn('Staff binding rollback failed:', cleanupErr);
      }
    }
    toast('স্টাফ তৈরি/যোগ ব্যর্থ: ' + err.message, 'e');
  } finally {
    if (secondaryApp) {
      try { await secondaryApp.delete(); } catch (err) { console.warn('Secondary app cleanup:', err); }
    }
  }
}

function renderStaffRosterList(staff, branches) {
  const box = document.getElementById('staff-roster-list');
  if (!box) return;
  if (!staff.length) {
    box.innerHTML = '<div class="text-xs text-slate-400 py-4">কোনো provisioned staff নেই।</div>';
    return;
  }
  box.innerHTML = staff.map(s => {
    const assigned = s.assignedBranchIds || [];
    const permissions = s.permissions || {};
    if (s.id === APP_STATE.currentUser?.uid) return '';
    return `<div class="border-t py-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-sm font-semibold">${esc(s.displayName || s.email)} <span class="text-xs text-slate-400">${esc(s.email || '')}</span></div>
        <select id="staff-role-edit-${esc(s.id)}" onchange="changeStaffRole('${esc(s.id)}',this.value)" class="border rounded px-2 py-1 text-xs">
          <option value="cashier" ${s.role === 'cashier' ? 'selected' : ''}>ক্যাশিয়ার</option>
          <option value="manager" ${s.role === 'manager' ? 'selected' : ''}>ম্যানেজার</option>
        </select>
      </div>
      <div class="mt-2 space-y-1">${branches.map(b => `
        <label class="flex items-center gap-2 text-xs">
          <input type="checkbox" onchange="toggleStaffBranch('${esc(s.id)}','${esc(b.id)}',this.checked)" ${assigned.includes(b.id) ? 'checked' : ''}/>
          ${esc(b.name)}
        </label>`).join('')}</div>
      <div class="mt-2 grid grid-cols-2 md:grid-cols-3 gap-1">${STAFF_PERMISSION_KEYS.map(([key, label]) =>
        `<label class="flex items-center gap-2 text-[11px] border rounded px-2 py-1">
          <input type="checkbox" onchange="toggleStaffPermission('${esc(s.id)}','${esc(key)}',this.checked)" ${permissions[key] === true ? 'checked' : ''}/> ${esc(label)}
        </label>`).join('')}</div>
      <div class="flex gap-3 mt-2">
        <button onclick="toggleStaffStatus('${esc(s.id)}','${s.active ? 'disabled' : 'active'}')" class="text-xs ${s.active ? 'text-amber-600' : 'text-emerald-600'}">
          ${s.active ? 'নিষ্ক্রিয় / Disable করুন' : 'সক্রিয় করুন'}
        </button>
        <button onclick="deleteStaffRecord('${esc(s.id)}')" class="text-xs text-red-600">Binding রেকর্ড মুছুন</button>
      </div>
    </div>`;
  }).join('');
}

async function toggleStaffBranch(staffUid, branchId, checked) {
  if (guardOwnerOnly()) return;
  if (staffUid === APP_STATE.currentUser?.uid) return toast('নিজের Branch assignment পরিবর্তন করা যাবে না।', 'e');
  const snap = await fbDb.collection('staff').doc(staffUid).get();
  if (!snap.exists) return;
  const ids = snap.data().assignedBranchIds || [];
  const next = checked ? Array.from(new Set(ids.concat(branchId))) : ids.filter(id => id !== branchId);
  if (!next.length) return toast('স্টাফকে কমপক্ষে একটি Branch রাখতে হবে।', 'w');
  await fbDb.collection('staff').doc(staffUid).update({ assignedBranchIds: next })
    .then(() => toast('Branch assignment আপডেট হয়েছে।', 's'))
    .catch((err) => toast(err.message, 'e'));
}

async function toggleStaffStatus(staffUid, status) {
  if (guardOwnerOnly()) return;
  if (staffUid === APP_STATE.currentUser?.uid) return toast('নিজের স্টাফ স্ট্যাটাস পরিবর্তন করা যাবে না।', 'e');
  if (status === 'disabled' && !confirm('এই স্টাফকে সাসপেন্ড/Disable করবেন? অ্যাকাউন্টের binding অকার্যকর হবে (active=false, status=disabled)। Firebase Auth login নিজে মুছবে না।')) return;
  await fbDb.collection('staff').doc(staffUid).update({
    active: status === 'active',
    status,
  }).catch((err) => toast(err.message, 'e'));
}

async function changeStaffRole(staffUid, role) {
  if (guardOwnerOnly()) return;
  if (staffUid === APP_STATE.currentUser?.uid) return toast('নিজের রোল পরিবর্তন করা যাবে না।', 'e');
  const safeRole = role === 'manager' ? 'manager' : 'cashier';
  if (!confirm('রোল পরিবর্তন করলে বর্তমান custom permissions পরিবর্তন করে রোলের preset দিয়ে ওভাররাইট হবে। এগোবেন?')) return;
  await fbDb.collection('staff').doc(staffUid).update({
    role: safeRole,
    permissions: staffRolePreset(safeRole),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).then(() => toast('রোল ও নিরাপদ preset আপডেট হয়েছে।', 's'))
    .catch((err) => toast(err.message, 'e'));
}

async function toggleStaffPermission(staffUid, permission, checked) {
  if (guardOwnerOnly()) return;
  if (staffUid === APP_STATE.currentUser?.uid) return toast('নিজের permission পরিবর্তন করা যাবে না।', 'e');
  await fbDb.collection('staff').doc(staffUid).update({
    [`permissions.${permission}`]: checked,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => toast(err.message, 'e'));
}

async function deleteStaffRecord(staffUid) {
  if (guardOwnerOnly()) return;
  if (staffUid === APP_STATE.currentUser?.uid) return toast('নিজের staff রেকর্ড মুছে ফেলবেন না।', 'e');
  if (!confirm('শুধু staff/{uid} binding রেকর্ড মুছবেন? Firebase Auth login/account নিজে মুছে যাবে না; মুছে নেওয়ার পর এই UID আর অনুমোদিত থাকবে না।')) return;
  await fbDb.collection('staff').doc(staffUid).delete()
    .then(() => toast('স্টাফ রেকর্ড মুছে ফেলা হয়েছে।', 's'))
    .catch((err) => toast(err.message, 'e'));
}
