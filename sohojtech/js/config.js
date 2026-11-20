'use strict';

const APP_CONFIG = {
  appName: 'MediWorld BD',
  PLATFORM_NAME: 'SojojTech Pharmacy',
  version: '5.1.0-pwa',

  firebase: {
    apiKey: "AIzaSyASKz-Nwk6WfTCvCzLwMh_W8O76WLlZiy8",
    authDomain: "mediworld-bd-test.firebaseapp.com",
    projectId: "mediworld-bd-test",
    storageBucket: "mediworld-bd-test.firebasestorage.app",
    messagingSenderId: "1076051206597",
    appId: "1:1076051206597:web:803599cf90686b7a432bac",
    measurementId: "G-XKENQ2STVD"
  },

  // Firebase Console-এর Authentication থেকে স্বীকারকৃত UID বসান।
  // Google login শুধু নিজে থেকে এই binding পূরণ করে না।
  OWNER_UID: 'PGaJOFwnUdWn8bgq0c5JE5aXmit1',
  OWNER_EMAIL: 'afsanabintemonnaf@gmail.com',
  SUPPORT_PHONE: '+8801346553350',
  aiProxyFallbackUrl: '',
  // ⚠️ প্লেসহোল্ডার — আসল বিকাশ/নগদ পার্সোনাল নাম্বার এখানে বসান (SUPPORT_PHONE থেকে আলাদা হতে পারে)
  PAYMENT_NUMBERS: {
    bkash: '01346553350',
    nagad: '01346553350',
  },
  COMPANY_LINKS: {
    website: '', // এখানে ওয়েবসাইট URL বসান (থাকলে), না থাকলে খালি রাখুন
    facebook: 'https://www.facebook.com/profile.php?id=61584743159189', // ফেসবুক পেজ URL
  },

  // ✅ আইটেম ৯: About ট্যাবে ক্রস-প্রমোশন — status: 'current' | 'available' | 'coming_soon'
  PRODUCTS: [
    {
      name: 'MediWorld BD',
      description: 'ফার্মেসি ম্যানেজমেন্ট — POS, ইনভেন্টরি, হিসাব, সব একসাথে।',
      status: 'current',
      url: '',
    },
    // ভবিষ্যতে নতুন প্রোডাক্ট এলে এখানে নতুন এন্ট্রি যোগ করুন, যেমন:
  ],

  features: {
    firebaseAuth: true,
    offlineSync: true,   // ✅ ধাপ ১০-২০: সম্পূর্ণ বাস্তবায়িত ও প্রোডাকশনে স্থিতিশীল
    firestoreDb: true,
  },
};

// Firebase BYOK storage is separate from the platform Firebase project used
// for Mediworld sign-in/provisioning. The selected business project owns data.
const FIREBASE_BYOK_STORAGE_KEY = 'mediworld.byok.firebase.v1';
const PLATFORM_BILLING = Object.freeze({
  setupFee: 10000,
  storeSetupFee: 5000,
  monthlyFee: 1500,
});

function isSuperAdminUser(user) {
  if (user === undefined) {
    user = typeof APP_STATE !== 'undefined' ? APP_STATE.currentUser : null;
  }
  return !!user && String(user.uid || '') === String(APP_CONFIG.OWNER_UID);
}

function platformAccessState(record, now = Date.now()) {
  const user = record || {};
  const setupFee = PLATFORM_BILLING.setupFee +
    (user.storeSetupAssistance === true ? PLATFORM_BILLING.storeSetupFee : 0);
  const validUntil = user.validUntil && typeof user.validUntil.toMillis === 'function'
    ? user.validUntil.toMillis()
    : new Date(user.validUntil || 0).getTime();
  const status = String(user.status || 'pending').toLowerCase();
  const validityCurrent = Number.isFinite(validUntil) && validUntil > now;
  const active = status === 'active' && user.setupFeePaid === true && validityCurrent;
  const effectiveStatus = status === 'unpaid' ||
    (status === 'active' && user.setupFeePaid !== true)
    ? 'unpaid'
    : (status === 'active' && !validityCurrent) ? 'past_due' : status;
  return {
    status: effectiveStatus,
    setupFee,
    monthlyFee: PLATFORM_BILLING.monthlyFee,
    active,
    reason: status === 'revoked' ? 'revoked'
      : status === 'pending' ? 'pending'
        : user.setupFeePaid !== true ? 'unpaid'
          : !validityCurrent ? 'expired'
            : status === 'active' ? '' : 'pending',
  };
}

function validateFirebaseByokConfig(config) {
  config = config || {};
  const clean = {
    apiKey: String(config.apiKey || '').trim(),
    authDomain: String(config.authDomain || '').trim(),
    projectId: String(config.projectId || '').trim(),
    storageBucket: String(config.storageBucket || '').trim(),
    messagingSenderId: String(config.messagingSenderId || '').trim(),
    appId: String(config.appId || '').trim(),
  };
  if (!clean.apiKey) return { valid: false, message: 'Firebase Web API Key দিন।' };
  if (!/^([a-z0-9-]+\.)*[a-z0-9-]+$/.test(clean.authDomain)) {
    return { valid: false, message: 'সঠিক authDomain দিন (উদাহরণ: pharmacy.firebaseapp.com)।' };
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(clean.projectId)) {
    return { valid: false, message: 'Firebase Project ID সঠিক নয়।' };
  }
  if (!clean.messagingSenderId || !clean.appId) {
    return { valid: false, message: 'Messaging Sender ID এবং App ID দিন।' };
  }
  if (!/^\d+$/.test(clean.messagingSenderId)) {
    return { valid: false, message: 'Messaging Sender ID কেবল সংখ্যায় হতে হবে।' };
  }
  return { valid: true, config: clean };
}

function getFirebaseByokConfig() {
  try {
    const raw = localStorage.getItem(FIREBASE_BYOK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = validateFirebaseByokConfig(parsed);
    return result.valid ? result.config : null;
  } catch (err) {
    return null;
  }
}

function saveFirebaseByokConfig(config) {
  if (typeof APP_STATE !== 'undefined' &&
      (!APP_STATE.isOwner || APP_STATE.isStaffMember)) {
    throw new Error('শুধু মালিক Firebase BYOK settings সেভ করতে পারবেন।');
  }
  const result = validateFirebaseByokConfig(config);
  if (!result.valid) throw new Error(result.message);
  localStorage.setItem(FIREBASE_BYOK_STORAGE_KEY, JSON.stringify(result.config));
  return result.config;
}

function clearFirebaseByokConfig() {
  if (typeof APP_STATE !== 'undefined' &&
      (!APP_STATE.isOwner || APP_STATE.isStaffMember)) {
    throw new Error('শুধু মালিক Firebase BYOK settings reset করতে পারবেন।');
  }
  localStorage.removeItem(FIREBASE_BYOK_STORAGE_KEY);
}

function restoreFirebaseByokFromRecord(record) {
  if (!record || typeof record !== "object") return null;
  const candidate = record.byokFirebaseConfig || record.firebaseByokConfig || null;
  if (!candidate) return null;
  const res = validateFirebaseByokConfig(candidate);
  if (!res.valid) return null;
  try {
    localStorage.setItem(FIREBASE_BYOK_STORAGE_KEY, JSON.stringify(res.config));
  } catch (_) {}
  return res.config;
}

function getEffectiveFirebaseConfig() {
  if (typeof isSuperAdminUser === "function" && isSuperAdminUser()) return APP_CONFIG.firebase;
  const entitlement = typeof APP_STATE !== "undefined" ? APP_STATE.platformEntitlement : null;
  const access = typeof platformAccessState === "function" ? platformAccessState(entitlement) : { active: false };
  return access.active ? (getFirebaseByokConfig() || APP_CONFIG.firebase) : APP_CONFIG.firebase;
}

// ════════════════════════════════════════════════════════════
// FIRESTORE কালেকশন কাঠামো (ডকুমেন্টেশন হিসেবে — কোডে ব্যবহৃত হয় না,
// Firestore schema-less, কিন্তু এই কাঠামো সবসময় অনুসরণ করা হবে)
//
// branches/{branchId}/medicines/{medId}
// branches/{branchId}/customers/{custId}
// branches/{branchId}/suppliers/{supId}
// branches/{branchId}/inventory/{medId}        → batchNumber, expiry, cost, mrp, sell, stock
// branches/{branchId}/sales/{saleId}           → branchId, createdByUid
// branches/{branchId}/purchases/{purId}       → branchId, createdByUid
// branches/{branchId}/returns/{retId}          → branchId, createdByUid
// branches/{branchId}/expenses/{expId}
// branches/{branchId}/payments/{payId}
// branches/{branchId}/supplierPayments/{payId}
// branches/{branchId}/openingEntries/{obId}
// branches/{branchId}/config/settings          → pharmacyName, ownerName, phone, address, lowStockLevel
// ════════════════════════════════════════════════════════════
