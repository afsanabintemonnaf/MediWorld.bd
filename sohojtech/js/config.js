'use strict';

const APP_CONFIG = {
  appName: 'MediWorld BD',
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
