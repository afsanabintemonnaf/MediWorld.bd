'use strict';

let fbAuth = null;
let fbDb = null;
let userDocUnsub = null;
let ownerUnsub = null;
let staffUnsub = null;
let mainAppBooted = false;

function initAuthGate() {
  try {
    firebase.initializeApp(APP_CONFIG.firebase);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    fbDb.settings({ ignoreUndefinedProperties: true });
    fbDb.enablePersistence({ synchronizeTabs: true }).catch((err) => {
      if (err.code === 'failed-precondition') console.warn('Persistence: একাধিক ট্যাবে দ্বন্দ্ব।');
      else if (err.code === 'unimplemented') console.warn('Persistence: সাপোর্ট নেই।');
    });
  } catch (err) {
    showFatalError('Firebase init সমস্যা:\n' + err.message);
    return;
  }

  fbAuth.onAuthStateChanged((user) => {
    if (userDocUnsub) { userDocUnsub(); userDocUnsub = null; }
    if (ownerUnsub) { ownerUnsub(); ownerUnsub = null; }
    if (staffUnsub) { staffUnsub(); staffUnsub = null; }
    mainAppBooted = false;

    if (!user) {
      resetIdentityState();
      showAuthScreen('login');
      return;
    }
    setLoadingMessage('শুধু অনুমোদিত পরিচয় যাচাই হচ্ছে...');
    resolveIdentity(user);
  }, (err) => showFatalError('Auth স্টেট শোনার সময় সমস্যা:\n' + err.message));
}

function resetIdentityState() {
  APP_STATE.currentUser = null;
  APP_STATE.isOwner = false;
  APP_STATE.isAdmin = false;
  APP_STATE.isStaffMember = false;
  APP_STATE.staffRole = null;
  APP_STATE.assignedBranchIds = [];
  APP_STATE.permissions = {};
  APP_STATE.activeWorkSessionId = null;
  APP_STATE.tenantUid = null;
  APP_STATE.readOnly = true;
}

async function resolveIdentity(user) {
  const ownerRef = fbDb.collection('owners').doc(user.uid);
  try {
    const ownerSnap = await ownerRef.get();
    if (ownerSnap.exists) {
      const owner = ownerSnap.data();
      if (
        user.uid === APP_CONFIG.OWNER_UID &&
        String(owner.uid || user.uid) === user.uid &&
        String(owner.email || '').toLowerCase() === String(user.email || '').toLowerCase() &&
        String(owner.role || '').toLowerCase() === 'owner'
      ) {
        activateOwner(user, owner);
        return;
      }
      await fbAuth.signOut();
      showAuthScreen('login');
      toast('এই UID/ইমেইল Owner binding মিলেনি।', 'e');
      return;
    }

    const staffRef = fbDb.collection('staff').doc(user.uid);
    const staffSnap = await staffRef.get();
    if (!staffSnap.exists) {
      showAuthScreen('login');
      toast('আপনার staff অ্যাকাউন্ট Owner কর্তৃক সক্রিয় করা হয়নি।', 'e');
      return;
    }
    const staff = staffSnap.data();
    if (staff.active !== true || staff.status !== 'active') {
      showAuthScreen('login');
      toast('এই স্টাফ অ্যাকাউন্ট নিষ্ক্রিয়।', 'e');
      return;
    }
    if (String(staff.email || '').toLowerCase() !== String(user.email || '').toLowerCase()) {
      showAuthScreen('login');
      toast('Staff ইমেইল মিলছে না।', 'e');
      return;
    }
    if (!staff.ownerUid) {
      showAuthScreen('login');
      toast('Staff-এর Owner binding নেই।', 'e');
      return;
    }

    activateStaff(user, staff);
  } catch (err) {
    showFatalError('Identity যাচাই করতে সমস্যা:\n' + err.message, err);
  }
}

function activateOwner(user, owner) {
  APP_STATE.currentUser = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || owner.displayName || '',
    photoURL: user.photoURL || '',
  };
  APP_STATE.isOwner = true;
  APP_STATE.isAdmin = true;
  APP_STATE.isStaffMember = false;
  APP_STATE.staffRole = 'owner';
  APP_STATE.assignedBranchIds = ['*'];
  APP_STATE.permissions = { owner: true };
  APP_STATE.tenantUid = user.uid;
  APP_STATE.readOnly = false;
  loadOwnerBranches().then(() => unlockApp(APP_STATE.currentUser));
}

async function activateStaff(user, staff) {
  const branchIds = Array.isArray(staff.assignedBranchIds) ? staff.assignedBranchIds : [];
  if (!branchIds.length) {
    showAuthScreen('login');
    toast('এই staff-এর কোনো Branch assignment নেই।', 'e');
    return;
  }

  APP_STATE.currentUser = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || staff.displayName || '',
    photoURL: user.photoURL || '',
  };
  APP_STATE.isOwner = false;
  APP_STATE.isAdmin = false;
  APP_STATE.isStaffMember = true;
  APP_STATE.staffRole = staff.role === 'manager' ? 'manager' : 'cashier';
  APP_STATE.assignedBranchIds = branchIds;
  APP_STATE.permissions = staff.permissions || {};
  APP_STATE.tenantUid = String(staff.ownerUid || APP_CONFIG.OWNER_UID);
  APP_STATE.readOnly = false;
  await loadStaffBranches(branchIds);
  if (!APP_STATE.activeBranchId) {
    showAuthScreen('login');
    toast('কোনো অনুমোদিত Branch পাওয়া যায়নি।', 'e');
    return;
  }

  if (staffUnsub) staffUnsub();
  staffUnsub = fbDb.collection('staff').doc(user.uid).onSnapshot(async (snap) => {
    if (!snap.exists) {
      await fbAuth.signOut();
      showAuthScreen('login');
      toast('আপনার স্টাফ রেকর্ড মুছে ফেলা হয়েছে।', 'e');
      return;
    }
    const live = snap.data();
    if (String(live.email || '').toLowerCase() !== String(user.email || '').toLowerCase()) {
      await fbAuth.signOut();
      showAuthScreen('login');
      toast('স্টাফের ইমেইল binding আর মিলছে না।', 'e');
      return;
    }
    if (live.active !== true || live.status !== 'active') {
      await fbAuth.signOut();
      showAuthScreen('login');
      toast('স্টাফ অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে।', 'e');
      return;
    }
    const liveBranches = Array.isArray(live.assignedBranchIds) ? live.assignedBranchIds : [];
    if (!live.ownerUid || live.ownerUid !== APP_STATE.tenantUid) {
      await fbAuth.signOut();
      showAuthScreen('login');
      toast('স্টাফের Owner binding পরিবর্তিত হয়েছে।', 'e');
      return;
    }
    APP_STATE.assignedBranchIds = liveBranches;
    APP_STATE.permissions = live.permissions || {};
    APP_STATE.staffRole = live.role === 'manager' ? 'manager' : 'cashier';
    await loadStaffBranches(liveBranches);
    if (!APP_STATE.activeBranchId) {
      await fbAuth.signOut();
      showAuthScreen('login');
      toast('কোনো অনুমোদিত Branch পাওয়া যায়নি।', 'e');
    } else {
      renderShell();
    }
  }, err => console.warn('Staff live guard:', err));

  const sessionRef = fbDb.collection('workSessions').doc();
  APP_STATE.activeWorkSessionId = sessionRef.id;
  await sessionRef.set({
    uid: user.uid,
    staffEmail: user.email,
    role: APP_STATE.staffRole,
    assignedBranchIds: branchIds,
    startedAt: firebase.firestore.FieldValue.serverTimestamp(),
    active: true,
  }).catch((err) => console.warn('Work session তৈরি হয়নি:', err));

  unlockApp(APP_STATE.currentUser);
}

async function loadOwnerBranches() {
  const snap = await fbDb.collection('branches')
    .where('ownerUid', '==', APP_STATE.currentUser.uid)
    .get();
  APP_STATE.branches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  selectInitialBranch();
}

async function loadStaffBranches(branchIds) {
  if (!branchIds.length) { APP_STATE.branches = []; return; }
  const snaps = await Promise.all(branchIds.map(id => fbDb.collection('branches').doc(id).get()));
  APP_STATE.branches = snaps
    .filter(s => s.exists)
    .map(s => ({ id: s.id, ...s.data() }))
    .filter(b => b.active === true && b.ownerUid === APP_STATE.tenantUid);
  selectInitialBranch();
}

function selectInitialBranch() {
  const saved = localStorage.getItem('mediworld-active-branch');
  const allowed = APP_STATE.isOwner
    ? APP_STATE.branches
    : APP_STATE.branches.filter(b => APP_STATE.assignedBranchIds.includes(b.id));
  const selectable = APP_STATE.isOwner ? allowed : allowed.filter(b => b.active === true);
  const chosen = selectable.find(b => b.id === saved) || selectable[0];
  APP_STATE.activeBranchId = chosen ? chosen.id : null;
  if (chosen) localStorage.setItem('mediworld-active-branch', chosen.id);
}

function unlockApp(profile) {
  showAuthScreen(null);
  renderUserBadge(profile);
  if (mainAppBooted) return;
  mainAppBooted = true;
  initApp();
}

function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  fbAuth.signInWithPopup(provider).catch((err) => toast('লগইন ব্যর্থ: ' + err.message, 'e'));
}

function signOutUser() {
  const closeSession = APP_STATE.activeWorkSessionId
    ? fbDb.collection('workSessions').doc(APP_STATE.activeWorkSessionId).set({
        endedAt: firebase.firestore.FieldValue.serverTimestamp(),
        active: false,
      }, { merge: true })
    : Promise.resolve();
  closeSession.finally(() => {
    if (userDocUnsub) { userDocUnsub(); userDocUnsub = null; }
    if (ownerUnsub) { ownerUnsub(); ownerUnsub = null; }
    if (staffUnsub) { staffUnsub(); staffUnsub = null; }
    mainAppBooted = false;
    fbAuth.signOut().then(() => location.reload());
  });
}

function showAuthScreen(name) {
  document.getElementById('app-loading')?.classList.add('hide');
  ['screen-login', 'screen-access-denied'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
  if (name) document.getElementById('screen-' + name)?.classList.remove('hidden');
  if (!name) document.getElementById('app-root')?.classList.remove('hidden');
}

function renderUserBadge(profile) {
  const el = document.getElementById('user-badge');
  if (el) {
    el.innerHTML = `
      ${profile.photoURL ? `<img src="${esc(profile.photoURL)}" class="w-7 h-7 rounded-full"/>` : ''}
      <span class="hidden sm:inline text-xs font-medium text-slate-600 dark:text-slate-300">${esc(profile.displayName || profile.email)}</span>
    `;
  }
  const banner = document.getElementById('trial-banner');
  if (banner) banner.classList.add('hidden');
}
