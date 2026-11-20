'use strict';

let fbAuth = null;
let fbDb = null;
let userDocUnsub = null;
let ownerUnsub = null;
let staffUnsub = null;
let mainAppBooted = false;
let entitlementExpiryTimer = null;

function initAuthGate() {
  try {
    firebase.initializeApp(getEffectiveFirebaseConfig());
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
  if (entitlementExpiryTimer) clearTimeout(entitlementExpiryTimer);
  entitlementExpiryTimer = null;
  APP_STATE.currentUser = null;
  APP_STATE.isOwner = false;
  APP_STATE.isAdmin = false;
  APP_STATE.isSuperAdmin = false;
  APP_STATE.isStaffMember = false;
  APP_STATE.platformEntitlement = null;
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
      if (String(owner.uid || user.uid) === user.uid &&
          String(owner.email || '').toLowerCase() === String(user.email || '').toLowerCase() &&
          String(owner.role || '').toLowerCase() === 'owner') {
        const platformUser = await getPlatformUserRecord(user.uid, owner);
        activateOwner(user, owner, platformUser);
        return;
      }
      await fbAuth.signOut();
      showAuthScreen('login');
      toast('এই UID/ইমেইল Owner binding মিলেনি।', 'e');
      return;
    }

    const normalizedEmail = String(user.email || '').trim().toLowerCase();
    const staffRef = fbDb.collection('staff').doc(user.uid);
    let staffSnap = await staffRef.get();
    let matchedDocId = staffSnap.exists ? staffSnap.id : null;

    if (!staffSnap.exists && normalizedEmail) {
      const byEmailSnap = await fbDb.collection('staff')
        .where('email', '==', normalizedEmail)
        .limit(1)
        .get();
      if (!byEmailSnap.empty) {
        const candidateDoc = byEmailSnap.docs[0];
        const candidateData = candidateDoc.data() || {};
        if (candidateData.uid && candidateData.uid !== user.uid) {
          showAuthScreen('login');
          toast('এই স্টাফ ইমেইলটি অন্য অ্যাকাউন্টের সাথে যুক্ত রয়েছে।', 'e');
          return;
        }
        matchedDocId = candidateDoc.id;
        staffSnap = candidateDoc;
      }
    }

    if (staffSnap.exists) {
      let staff = staffSnap.data() || {};
      if (String(staff.email || '').trim().toLowerCase() !== normalizedEmail) {
        showAuthScreen('login');
        toast('Staff ইমেইল মিলছে না।', 'e');
        return;
      }
      if (!staff.ownerUid) {
        showAuthScreen('login');
        toast('Staff-এর Owner binding নেই।', 'e');
        return;
      }
      if (staff.status === 'invited' && staff.active !== false && !staff.uid) {
        const boundStaff = {
          uid: user.uid,
          email: String(staff.email || normalizedEmail).trim(),
          displayName: staff.displayName || user.displayName || '',
          ownerUid: staff.ownerUid,
          role: staff.role === 'manager' ? 'manager' : 'cashier',
          assignedBranchIds: Array.isArray(staff.assignedBranchIds) ? staff.assignedBranchIds : [],
          permissions: staff.permissions && typeof staff.permissions === 'object' ? staff.permissions : {},
          active: true,
          status: 'active',
          createdAt: staff.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
          acceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        await fbDb.collection('staff').doc(user.uid).set(boundStaff, { merge: true });
        if (matchedDocId && matchedDocId !== user.uid) {
          await fbDb.collection('staff').doc(matchedDocId).delete().catch(() => {});
        }
        staff = { ...staff, ...boundStaff, updatedAt: Date.now() };
      } else if (staff.active !== true || staff.status !== 'active') {
        showAuthScreen('login');
        toast('এই স্টাফ অ্যাকাউন্ট নিষ্ক্রিয়।', 'e');
        return;
      }
      const platformUser = await getPlatformUserRecord(staff.ownerUid, null);
      await activateStaff(user, staff, platformUser);
      return;
    }

    let request = await fbDb.collection('platformUsers').doc(user.uid).get();
    if (!request.exists) {
      const pending = {
        uid: user.uid,
        email: String(user.email || '').toLowerCase(),
        displayName: user.displayName || '',
        status: 'pending',
        setupFeePaid: false,
        storeSetupAssistance: false,
        validUntil: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      await fbDb.collection('platformUsers').doc(user.uid).set(pending);
      request = await fbDb.collection('platformUsers').doc(user.uid).get();
    }
    const requestData = request.data();
    if (String(requestData.email || '').toLowerCase() !== String(user.email || '').toLowerCase()) {
      throw new Error('Platform user ইমেইল binding মিলছে না।');
    }
    activateOwner(user, requestData, requestData);
  } catch (err) {
    showFatalError('Identity যাচাই করতে সমস্যা:\n' + err.message, err);
  }
}

async function getPlatformUserRecord(uid, fallback) {
  if (String(uid) === String(APP_CONFIG.OWNER_UID)) {
    return { uid, status: 'active', setupFeePaid: true, validUntil: '9999-12-31T23:59:59.999Z' };
  }
  try {
    const snap = await fbDb.collection('platformUsers').doc(uid).get();
    return snap.exists ? snap.data() : (fallback || { uid, status: 'active', setupFeePaid: true });
  } catch (err) {
    console.warn('getPlatformUserRecord fallback used:', err?.code || err?.message || err);
    return fallback || { uid, status: 'active', setupFeePaid: true };
  }
}

function activateOwner(user, owner, platformUser = owner) {
  APP_STATE.currentUser = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || owner.displayName || '',
    photoURL: user.photoURL || '',
  };
  APP_STATE.isOwner = true;
  APP_STATE.isSuperAdmin = isSuperAdminUser(user);
  APP_STATE.isAdmin = APP_STATE.isSuperAdmin;
  APP_STATE.isStaffMember = false;
  APP_STATE.platformEntitlement = platformUser;
  APP_STATE.staffRole = 'owner';
  APP_STATE.assignedBranchIds = ['*'];
  APP_STATE.permissions = { owner: true };
  APP_STATE.tenantUid = user.uid;
  APP_STATE.readOnly = !APP_STATE.isSuperAdmin && !platformAccessState(platformUser).active;
  if (APP_STATE.isSuperAdmin || platformAccessState(platformUser).active) {
    loadOwnerBranches().then(() => unlockApp(APP_STATE.currentUser));
  } else {
    unlockApp(APP_STATE.currentUser);
  }
  if (!APP_STATE.isSuperAdmin) watchPlatformEntitlement(user.uid);
}

async function activateStaff(user, staff, platformUser) {
  if (staff.active !== true || staff.status !== 'active') {
    showAuthScreen('login');
    toast('এই স্টাফ অ্যাকাউন্ট নিষ্ক্রিয়।', 'e');
    return;
  }
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
  APP_STATE.isSuperAdmin = false;
  APP_STATE.isStaffMember = true;
  APP_STATE.platformEntitlement = platformUser;
  APP_STATE.staffRole = staff.role === 'manager' ? 'manager' : 'cashier';
  APP_STATE.assignedBranchIds = branchIds;
  APP_STATE.permissions = staff.permissions || {};
  APP_STATE.tenantUid = String(staff.ownerUid || APP_CONFIG.OWNER_UID);
  APP_STATE.readOnly = !platformAccessState(platformUser).active;
  if (APP_STATE.readOnly) {
    APP_STATE.currentUser = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || staff.displayName || '',
      photoURL: user.photoURL || '',
    };
    unlockApp(APP_STATE.currentUser);
    watchPlatformEntitlement(staff.ownerUid);
    return;
  }
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
  watchPlatformEntitlement(staff.ownerUid);
}

function watchPlatformEntitlement(uid) {
  if (ownerUnsub) ownerUnsub();
  ownerUnsub = fbDb.collection('platformUsers').doc(uid).onSnapshot((snap) => {
    if (!snap.exists) return;
    const wasAllowed = APP_STATE.isSuperAdmin === true || !APP_STATE.readOnly;
    APP_STATE.platformEntitlement = snap.data();
    APP_STATE.readOnly = APP_STATE.isSuperAdmin !== true &&
      !platformAccessState(APP_STATE.platformEntitlement).active;
    schedulePlatformExpiryCheck();
    const isAllowed = APP_STATE.isSuperAdmin === true || !APP_STATE.readOnly;
    if (mainAppBooted && wasAllowed !== isAllowed) {
      mainAppBooted = false;
      if (!isAllowed) {
        initApp();
      } else if (APP_STATE.isOwner) {
        loadOwnerBranches().then(() => initApp())
          .catch(err => showFatalError('Entitlement পরিবর্তনের পর workspace লোড ব্যর্থ:\n' + humanizeError(err), err));
      } else {
        const identity = APP_STATE.currentUser;
        fbDb.collection('staff').doc(identity.uid).get()
          .then(snap => {
            if (!snap.exists) throw new Error('Staff binding পাওয়া যায়নি।');
            return activateStaff(identity, snap.data(), APP_STATE.platformEntitlement);
          })
          .catch(err => showFatalError('Staff entitlement চালু করতে ব্যর্থ:\n' + humanizeError(err), err));
      }
    }
  }, err => console.warn('Platform entitlement listener:', err));
}

function schedulePlatformExpiryCheck() {
  if (entitlementExpiryTimer) clearTimeout(entitlementExpiryTimer);
  entitlementExpiryTimer = null;
  if (APP_STATE.isSuperAdmin === true) return;
  const expiry = APP_STATE.platformEntitlement?.validUntil;
  const expiryTime = expiry && typeof expiry.toMillis === 'function'
    ? expiry.toMillis()
    : new Date(expiry || 0).getTime();
  if (!Number.isFinite(expiryTime) || expiryTime <= Date.now()) return;
  const delay = Math.min(expiryTime - Date.now(), 24 * 60 * 60 * 1000);
  entitlementExpiryTimer = setTimeout(() => {
    APP_STATE.readOnly = !platformAccessState(APP_STATE.platformEntitlement).active;
    if (APP_STATE.readOnly && mainAppBooted) {
      mainAppBooted = false;
      initApp();
    } else {
      schedulePlatformExpiryCheck();
    }
  }, delay);
}

async function loadOwnerBranches() {
  const snap = await fbDb.collection('branches')
    .where('ownerUid', '==', APP_STATE.currentUser.uid)
    .get();
  APP_STATE.branches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!APP_STATE.branches.length && APP_STATE.isOwner && !APP_STATE.readOnly && APP_STATE.currentUser?.uid) {
    try {
      const branchId = 'BR-' + Date.now();
      const branchName = (APP_STATE.pharmacyName && APP_STATE.pharmacyName !== 'ফার্মেসি')
        ? APP_STATE.pharmacyName
        : 'Main Branch';
      const payload = {
        name: branchName,
        ownerUid: APP_STATE.currentUser.uid,
        active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      await fbDb.collection('branches').doc(branchId).set(payload);
      APP_STATE.branches = [{ id: branchId, ...payload, createdAt: Date.now() }];
    } catch (err) {
      console.warn('Default branch auto-create skipped:', err);
    }
  }
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

function isCoopOrPopupBlocked(err) {
  const code = err && err.code ? String(err.code) : "";
  const msg = err && err.message ? String(err.message).toLowerCase() : "";
  return (
    code === "auth/popup-blocked" ||
    code === "auth/operation-not-supported-in-this-environment" ||
    code === "auth/cancelled-popup-request" ||
    msg.includes("cross-origin-opener-policy") ||
    msg.includes("window.closed")
  );
}

if (typeof fbAuth !== "undefined" && typeof fbAuth.getRedirectResult === "function") {
  fbAuth.getRedirectResult().catch((err) => {
    if (err && err.code) {
      toast("লগইন ব্যর্থ: " + (err.message || err.code), "e");
    }
  });
}

function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  fbAuth.signInWithPopup(provider).catch((err) => {
    if (isCoopOrPopupBlocked(err)) {
      return fbAuth.signInWithRedirect(provider).catch((redirErr) => {
        toast("লগইন ব্যর্থ: " + (redirErr && redirErr.message ? redirErr.message : ""), "e");
      });
    }
    toast("লগইন ব্যর্থ: " + (err && err.message ? err.message : ""), "e");
  });
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
