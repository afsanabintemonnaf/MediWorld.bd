'use strict';

// ════════════════════════════════════════════════════════════
// GLOBAL APP STATE
// সব ডেটা এখানে কেন্দ্রীভূত থাকবে — যেকোনো মডিউল এটা পড়বে/লিখবে।
// ════════════════════════════════════════════════════════════
const APP_STATE = {
  // UI state
  currentTab: 'dashboard',
  sidebarOpen: false,
  currentUser: null,
  isAdmin: false,
  isSuperAdmin: false,
  isOwner: false,
  isStaffMember: false,
  platformEntitlement: null,
  staffRole: null,
  assignedBranchIds: [],
  permissions: {},
  activeWorkSessionId: null,
  tenantUid: null,
  activeBranchId: null,
  branches: [],
  interBranchTransfers: [],
  accountingScope: 'branch',

  // Business data (এখনো খালি — পরের ধাপে Mock Data দিয়ে পূরণ হবে)
  pharmacyName: 'ফার্মেসি',
  ownerName: '',
  phone: '',
  address: '',
  logoBase64: '',   // ✅ নতুন — আইটেম ১২: রিসিট লোগো (base64, Firestore config/settings-এ)
  lastExportAt: null, // ✅ ধাপ ০.৩ — ব্যাকআপ রিমাইন্ডার, শেষ Excel-export টাইমস্ট্যাম্প
  lowStockLevel: 10,
  expiryAlertDays: 90,
  historyCutoff: '',
  olderHistoryLoaded: false,
  capReached: { sales: false, purchases: false, returns: false },

  medicines: [],
  customers: [],
  suppliers: [],
  inventory: [],
  sales: [],
  purchases: [],
  expenses: [],
  payments: [],   // T_Payments শিটের সমতুল্য — বাকি আদায়ের রেকর্ড
  supplierPayments: [], // সরবরাহকারী পাওনা পরিশোধের রেকর্ড
  incomes: [],
  salarySetups: [],
  salaryPayments: [],
  ownerAccounts: [],
  pendingSales: [],       // অফলাইনে queue করা বিক্রয় (শুধু sync-badge-এর জন্য রেফারেন্স)
  pendingPurchases: [],   // অফলাইনে queue করা ক্রয়
  pendingReturns: [],
  notifications: [],
  notificationFilter: 'active',
  shortList: [],

  staffList: [],

  // POS/Purchase draft cart (multi-item form state — পরে ব্যবহৃত হবে)
  posItems: [],
  purItems: [],
  returns: [],
  openingEntries: [],
  retMode: 'customer',

  // ════════════════════════════════════════════════════════════
  // B2B Ad/Affiliate — namespaced state
  // কোনো actual ফিচার এখনো নেই। এই অবজেক্টে অন্য কোনো মডিউল থেকে
  // সরাসরি APP_STATE.ads.xxx = ... লেখা নিষেধ — js/modules/ads.js-এর
  // পাবলিক হেল্পার ফাংশন (নিচে দেখুন) দিয়েই বদলাতে হবে।
  // ════════════════════════════════════════════════════════════
  ads: {
    enabled: false,     // ফিচার-ফ্ল্যাগ — true না করা পর্যন্ত nav-এ ট্যাব দেখাবে না
    campaigns: [],      // ভবিষ্যতে: [{ id, sponsorName, ... }]
    settings: {},        // ভবিষ্যতে: প্রদর্শন-সংক্রান্ত সেটিংস
  },
};

const TAB_PERMISSION_MAP = {
  pos: 'pos',
  purchase: 'purchase',
  inventory: 'inventory',
  medicine: 'medicine',
  returns: 'returns',
  opening: 'opening',
  transfers: 'transfer',
  customers: 'customers',
  suppliers: 'suppliers',
  shortList: 'inventory',
  accounts: 'accounts',
  dailyReport: 'dailyReport',
  maintenance: 'inventory',
};

// ════════════════════════════════════════════════════════════
// SIDEBAR NAVIGATION CONFIG
// লিগ্যাসি sidebar-এর গ্রুপিং অনুযায়ী — প্রতিটি ট্যাব একটি মডিউল ফাইলের সাথে
// ম্যাপ হবে (js/modules/*.js), যেগুলো পরবর্তী ধাপে পূরণ হবে।
// ════════════════════════════════════════════════════════════
const NAV_CONFIG = [
  {
    section: 'মূল মেনু',
    items: [
      { id: 'dashboard', label: 'ড্যাশবোর্ড', icon: 'fa-gauge-high' },
      { id: 'pos',       label: 'বিক্রয় (POS)', icon: 'fa-cash-register' },
      { id: 'analytics', label: 'সেলস অ্যানালিটিক্স', icon: 'fa-chart-line' },
    ],
  },
  {
    section: 'ব্যবস্থাপনা',
    items: [
      { id: 'medicine',  label: 'ওষুধ মাস্টার', icon: 'fa-capsules' },
      { id: 'inventory', label: 'ইনভেন্টরি', icon: 'fa-boxes-stacked' },
      { id: 'purchase',  label: 'ক্রয়', icon: 'fa-truck-field' },
      { id: 'returns',   label: 'রিটার্ন', icon: 'fa-rotate-left' },
      { id: 'opening',   label: 'পূর্বের হিসাব', icon: 'fa-clock-rotate-left' },
      { id: 'transfers', label: 'Branch Transfer', icon: 'fa-arrow-right-arrow-left' },
    ],
  },
  {
    section: 'হিসাব',
    items: [
      { id: 'customers', label: 'গ্রাহক', icon: 'fa-users' },
      { id: 'suppliers', label: 'সরবরাহকারী', icon: 'fa-building' },
      { id: 'shortList', label: 'শর্ট লিস্ট / Customer Demand', icon: 'fa-list-check' },
      { id: 'accounts',  label: 'অ্যাকাউন্টস', icon: 'fa-book-open' },
      { id: 'dailyReport', label: 'দৈনিক রিপোর্ট', icon: 'fa-calendar-day' },
      { id: 'maintenance', label: 'দোকান রক্ষণাবেক্ষণ', icon: 'fa-screwdriver-wrench' },
    ],
  },
  {
    // ✅ নতুন সেকশন — সব ইউজার (read-only সহ) সবসময় দেখবে, কোনো গেটিং নেই
    section: 'সহায়তা',
    items: [
      { id: 'contact', label: 'যোগাযোগ', icon: 'fa-headset' },
      { id: 'about',   label: 'আমাদের সম্পর্কে', icon: 'fa-circle-info' },
    ],
  },
  {
    section: 'টিম',
    items: [
      { id: 'staff', label: 'স্টাফ ম্যানেজমেন্ট', icon: 'fa-users-gear' },
    ],
  },
  {
    section: 'প্রশাসন',
    items: [
      { id: 'admin', label: 'ইউজার ম্যানেজমেন্ট', icon: 'fa-user-shield' },
    ],
  },
  {
    section: 'AI ফিচার',
    items: [
      { id: 'aiSettings', label: 'AI সেটিংস', icon: 'fa-robot' },
    ],
  },
  {
    section: 'সেটিংস',
    items: [
      { id: 'settings', label: 'সেটিংস', icon: 'fa-gear' },
    ],
  },
  {
    section: 'B2B',
    items: [
      { id: 'ads', label: 'বিজ্ঞাপন/অ্যাফিলিয়েট', icon: 'fa-bullhorn' },
    ],
  },
];

const TAB_TITLES = NAV_CONFIG
  .flatMap(section => section.items)
  .reduce((map, item) => { map[item.id] = item.label; return map; }, {});
