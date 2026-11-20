'use strict';

// ✅ ৩.৪: বুট-এনিমেশন ন্যূনতম প্রদর্শন-সময় — দ্রুত-লোডে (cache/fast net)
// #app-loading স্ক্রিন যদি ১.৪ সেকেন্ডের কমে সরে যায়, তাহলে এনিমেশন
// অর্ধেক-চলা অবস্থাতেই কাটা পড়ে "ফ্ল্যাশ" মনে হয়। hideLoadingScreen()
// এই মিনিমাম মেনে চলে, actual data-load যত দ্রুতই হোক না কেন।
const BOOT_ANIMATION_MIN_MS = 1400;
const _bootStartTime = Date.now();
let activeBranchLoadRequest = 0;

document.addEventListener('DOMContentLoaded', () => {
  console.log(`${APP_CONFIG.appName} v${APP_CONFIG.version} booting...`);
  applyStoredTheme();
  initSmartNavigation(); // ✅ নতুন — auth gate-এর আগে, যাতে boot থেকেই sentinel বসে
  initAuthGate();
});
window.addEventListener('online', () => {
  updateConnBadge(true);
  toast('ইন্টারনেট সংযোগ ফিরেছে — অফলাইন কিউ স্বয়ংক্রিয়ভাবে সিঙ্ক হচ্ছে।', 's');
  updateSettingsDbStatusCard(); // ✅ ধাপ ২২: Settings ট্যাব খোলা থাকলে কার্ডও লাইভ আপডেট
});
window.addEventListener('offline', () => {
  updateConnBadge(false);
  toast('অফলাইন — এন্ট্রি স্থানীয় সিঙ্ক-কিউতে রাখা হবে; নেট ফিরলে স্বয়ংক্রিয় সিঙ্ক হবে।', 'w');
  updateSettingsDbStatusCard(); // ✅ ধাপ ২২
});

function updateConnBadge(isOnline) {
  const badge = document.getElementById('conn-status-badge');
  if (!badge) return;
  badge.innerHTML = isOnline
    ? '<i class="fa-solid fa-circle me-1"></i>সংযুক্ত'
    : '<i class="fa-solid fa-circle me-1"></i>অফলাইন';
  badge.className = isOnline
    ? 'hidden sm:inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-full px-3 py-1 text-xs font-semibold'
    : 'hidden sm:inline-flex items-center gap-1.5 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-full px-3 py-1 text-xs font-semibold';
}

async function initApp() {
  setLoadingMessage('ডেটা লোড হচ্ছে...');
  updateConnBadge(navigator.onLine);
  initSyncDB().catch(err => console.warn('SyncDB init ব্যর্থ:', err));
  initSyncEngine(); // ✅ ফিক্স (ধাপ ১২): আগে এই কলটাই ছিল না, তাই অফলাইন
                     // queue নেট ফিরলেও কখনো স্বয়ংক্রিয়ভাবে সিঙ্ক হতো না।
  try {
    const data = await apiGetCompleteData();
    if (!data.success) {
      showFatalError('ডেটা লোড করতে সমস্যা:\n' + data.message);
      return;
    }
    Object.assign(APP_STATE, data);
  } catch (err) {
    showFatalError('initApp() এ সমস্যা:\n' + humanizeError(err), err);
    return;
  }

  renderShell();
  if (APP_STATE.isOwner) loadOwnerNotifications();
  setLoadingMessage('Ready.');
  hideLoadingScreen();
  showAppRoot();

  // ✅ onboarding আর changelog একসাথে না দেখানোর জন্য সিকোয়েন্সড —
  // onboarding modal খুললে changelog এই সেশনে চেক হবে না (পরের লগইনে হবে)
  const onboardingShown = typeof maybeShowOnboardingModal === 'function' && maybeShowOnboardingModal();
  if (!onboardingShown && typeof maybeShowChangelogModal === 'function') maybeShowChangelogModal();
  if (typeof maybeScheduleReviewPrompt === 'function') maybeScheduleReviewPrompt(); // ✅ আইটেম ১১
  if (typeof initPinLock === 'function') initPinLock(); // ✅ আইটেম ২৩
}

// ════════════════════════════════════════════════════════════
// ✅ SMART NAVIGATION — Modal-aware back + Tab-aware back + double-back-to-exit
//
// তিনটা স্তর, তিনটা ভিন্ন mechanism দিয়ে সামলানো হয় যাতে একটা আরেকটার
// সাথে conflict না করে:
//   ১) মডাল স্ট্যাক (APP_STATE.modalStack)      → মডাল খোলা থাকলে back = মডাল বন্ধ
//   ২) ট্যাব হিস্ট্রি (APP_STATE.tabHistory)     → মডাল নেই কিন্তু আগে অন্য ট্যাব
//                                                  থেকে এসেছি → সেই ট্যাবে ফিরে যাও
//   ৩) Exit-guard (double-back-to-exit)          → মডাল নেই, tabHistory-ও খালি
//                                                  (মানে এই ট্যাবই যাত্রার শুরু)
//
// আসল browser History API stack-এ শুধু একটাই "sentinel" এন্ট্রি থাকে —
// tab-navigation পুরোপুরি APP_STATE.tabHistory (নিজস্ব in-memory array) দিয়ে
// ট্র্যাক হয়, তাই History API-এর সাথে এর কোনো সংঘর্ষ হয় না।
// ════════════════════════════════════════════════════════════
APP_STATE.modalStack = []; // [{ id, closeFn }]
APP_STATE.tabHistory = []; // ✅ নতুন — ভিজিট করা ট্যাবের ক্রম (browser History API না, নিজস্ব স্ট্যাক)
let _navBackGuard = false; // programmatic closeAppModal() থেকে আসা popstate-কে আলাদা করতে
let _lastExitPressAt = 0;
const EXIT_PRESS_WINDOW_MS = 2500;

function initSmartNavigation() {
  // pushState (replaceState না) — স্ট্যাকে সবসময় অন্তত ২টা এন্ট্রি থাকবে
  // ([root, sentinel]), তাই প্রথম back-এ সরাসরি অ্যাপ থেকে বের হয়ে যাবে না।
  history.pushState({ sentinel: true }, '');
  window.addEventListener('popstate', handleAppPopState);

  // ✅ শেষ ট্যাবে ফেরা (রিফ্রেশ-পারসিস্টেন্স)
  const savedTab = localStorage.getItem('pharmacy-last-tab');
  if (savedTab && TAB_TITLES[savedTab]) APP_STATE.currentTab = savedTab;
}

function handleAppPopState() {
  // ১) মডাল খোলা থাকলে — সবার আগে মডাল বন্ধ করো, বাকি কিছুই না
  if (APP_STATE.modalStack.length) {
    const top = APP_STATE.modalStack.pop();
    try { top.closeFn(); } catch (err) { console.warn('Modal close-এ সমস্যা:', err); }
    _navBackGuard = false;
    return;
  }
  if (_navBackGuard) { _navBackGuard = false; return; }

  // ২) ✅ নতুন — tab-stack-এ পেছনে যাওয়ার মতো এন্ট্রি থাকলে সেই ট্যাবে ফিরে যাও
  //    (এটা exit-guard trigger করে না, শুধু app-এর ভেতরেই এক ধাপ পেছনে যায়)
  if (APP_STATE.tabHistory.length) {
    const prevTab = APP_STATE.tabHistory.pop();
    goTab(prevTab, { fromBack: true }); // fromBack: true → আবার tabHistory-তে push হবে না
    history.pushState({ sentinel: true }, ''); // sentinel re-arm — future back-press-দের জন্য reserve রাখা
    return;
  }

  // ৩) মডাল নেই, tab-history-ও খালি — এটাই যাত্রার প্রথম ট্যাব, তাই এখন exit-intent
  const now = Date.now();
  if (now - _lastExitPressAt < EXIT_PRESS_WINDOW_MS) {
    return; // দ্বিতীয়বার — এবার সত্যিই বের হতে দিচ্ছি, sentinel আর re-arm হবে না
  }
  _lastExitPressAt = now;
  toast('আবার Back চাপুন বের হতে', 'w');
  history.pushState({ sentinel: true }, ''); // re-arm
}

// ✅ যেকোনো মডাল খোলার সময় এটা কল করুন (appendChild-এর ঠিক পরে)
function openAppModal(id, closeFn) {
  APP_STATE.modalStack.push({ id, closeFn });
  history.pushState({ modal: id }, '');
}

// ✅ মডাল বন্ধ করার একমাত্র পথ — Cancel বাটন এবং সফল-সাবমিট দুই জায়গাতেই
// এটা কল হবে, closeXxxForm() সরাসরি না। এটা history.back() কল করে,
// যেটা popstate ফায়ার করে, যেটা modalStack থেকে pop করে আসল closeFn চালায়।
function closeAppModal() {
  if (!APP_STATE.modalStack.length) return;
  _navBackGuard = true;
  history.back();
}
// ════════════════════════════════════════════════════════════
// SHELL RENDERING
// ════════════════════════════════════════════════════════════
function renderSidebarNav() {
  const nav = document.getElementById('sidebar-nav');
  // ✅ নতুন — এই ট্যাবগুলো শুধু owner দেখতে পারবে, staff (manager/cashier) কেউই না
  const OWNER_ONLY_TABS = ['dashboard', 'analytics'];

  const sections = NAV_CONFIG.filter(s =>
    (s.section !== 'প্রশাসন' || APP_STATE.isAdmin) &&
    (s.section !== 'B2B' || APP_STATE.ads.enabled) &&
    (s.section !== 'টিম' || !APP_STATE.isStaffMember) &&
    (s.section !== 'AI ফিচার' || !APP_STATE.isStaffMember)
  ).map(s => ({
    ...s,
    items: s.items.filter(item =>
      !(APP_STATE.isStaffMember && OWNER_ONLY_TABS.includes(item.id)) &&
      (!APP_STATE.isStaffMember || canAccessTab(item.id))
    ),
  })).filter(s => s.items.length);

  nav.innerHTML = sections.map(section => `
    <div>
      <div class="px-3 mb-1 text-[11px] font-semibold tracking-wider uppercase text-white/30">${esc(section.section)}</div>
      <ul class="space-y-0.5">
        ${section.items.map(item => `
          <li>
            <a href="#" data-tab="${item.id}"
              class="nav-link flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
                     text-white/60 hover:bg-white/5 hover:text-white transition">
              <i class="fa-solid ${item.icon} w-4 text-center"></i>
              <span>${esc(item.label)}</span>
            </a>
          </li>`).join('')}
      </ul>
    </div>`).join('');
}

function renderShell() {
  renderSidebarNav();
  updateHeaderQuickActions();
  renderBranchSelector();
  renderTabPanels();
  wireShellEvents();
  updateDarkToggleIcon();

  if (APP_STATE.currentTab === 'admin' && !APP_STATE.isAdmin) {
    APP_STATE.currentTab = 'dashboard';
  }

  if (APP_STATE.currentTab === 'ads' && !APP_STATE.ads.enabled) {
    APP_STATE.currentTab = 'dashboard';
  }

  if (APP_STATE.currentTab === 'staff' && APP_STATE.isStaffMember) {
    APP_STATE.currentTab = 'dashboard';
  }

  if (APP_STATE.currentTab === 'aiSettings' && APP_STATE.isStaffMember) {
    APP_STATE.currentTab = 'dashboard';
  }

  // ✅ নতুন — staff dashboard/analytics-এ ঢুকলে POS-এ redirect
  // উপরের guard-গুলো dashboard-এ পাঠালেও এই guard সেটাও ধরে POS-এ পাঠাবে।
  if (
    (APP_STATE.currentTab === 'dashboard' ||
     APP_STATE.currentTab === 'analytics' ||
     APP_STATE.currentTab === 'accounts') &&
    APP_STATE.isStaffMember
  ) {
    APP_STATE.currentTab = 'pos';
  }

  goTab(APP_STATE.currentTab);
  setText('sidebar-pharma-name', APP_STATE.pharmacyName);
}

function renderBranchSelector() {
  const el = document.getElementById('active-branch-selector');
  if (!el) return;
  const allowed = APP_STATE.isOwner
    ? APP_STATE.branches
    : APP_STATE.branches.filter(b => APP_STATE.assignedBranchIds.includes(b.id));
  el.innerHTML = allowed.map(b =>
    `<option value="${esc(b.id)}" ${b.id === APP_STATE.activeBranchId ? 'selected' : ''}>${esc(b.name)}${b.active === false && APP_STATE.isOwner ? ' — নিষ্ক্রিয়' : ''}</option>`
  ).join('');
  el.classList.toggle('hidden', allowed.length === 0);
  if (allowed.length <= 1) el.disabled = true;
  else el.disabled = false;
}

async function changeActiveBranch(branchId) {
  const allowed = APP_STATE.isOwner
    ? APP_STATE.branches
    : APP_STATE.branches.filter(b => APP_STATE.assignedBranchIds.includes(b.id));
  if (!allowed.some(b => b.id === branchId)) {
    toast('এই Branch আপনার জন্য অনুমোদিত নয়।', 'e');
    renderBranchSelector();
    return;
  }
  const requestId = ++activeBranchLoadRequest;
  const previousBranchId = APP_STATE.activeBranchId;
  APP_STATE.activeBranchId = branchId;
  const data = await apiGetCompleteData();
  if (requestId !== activeBranchLoadRequest) return;
  if (!data.success) {
    APP_STATE.activeBranchId = previousBranchId;
    renderBranchSelector();
    toast('Branch ডেটা লোড করতে সমস্যা: ' + data.message, 'e');
    return;
  }
  localStorage.setItem('mediworld-active-branch', branchId);
  Object.assign(APP_STATE, data);
  renderTabPanels();
  goTab(APP_STATE.currentTab);
  triggerSync();
  toast(`Branch বদলানো হয়েছে: ${allowed.find(b => b.id === branchId)?.name || branchId}`, 's');
}

// Dashboard-এর জন্য বিশেষ container দেই (dashboard.js নিজে রেন্ডার করবে);
// বাকি সব ট্যাব এখনো placeholder।
function renderTabPanels() {
  const container = document.getElementById('tab-panels');
  if (!container) return; // কনটেইনার না থাকলে কোড এখানেই থেমে যাবে, এরর হবে না

  const allTabs = NAV_CONFIG.flatMap(s => s.items);

  container.innerHTML = allTabs.map(item => {
    // ১. ড্যাশবোর্ড ট্যাব
    if (item.id === 'dashboard') {
      return `<div id="tab-dashboard" class="tab-panel hidden tab-enter">
        <div class="mb-5">
          <h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}
          </h2>
          <p id="dash-date" class="text-xs text-slate-400 mt-0.5"></p>
        </div>
        <div id="dashboard-content"></div>
      </div>`;
    }

    // ২. পিওএস (POS) ট্যাব
    if (item.id === 'pos') {
      return `<div id="tab-pos" class="tab-panel hidden tab-enter">
        <div class="mb-5">
          <h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}
          </h2>
        </div>
        <div id="pos-content"></div>
      </div>`;
    }
    // ৩. অ্যানালিটিক্স (Analytics) ট্যাব
    if (item.id === 'analytics') {
      return `<div id="tab-analytics" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="analytics-content"></div>
      </div>`;
    }
    // ৪. পারচেজ (Purchase) ট্যাব
    if (item.id === 'purchase') {
      return `<div id="tab-purchase" class="tab-panel hidden tab-enter">
        <div class="mb-5">
          <h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}
          </h2>
        </div>
        <div id="purchase-content"></div>
      </div>`;
    }
    // ৫. রিটার্নস (Returns) ট্যাব
    if (item.id === 'returns') {
      return `<div id="tab-returns" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="returns-content"></div>
      </div>`;
    }
    // ৬. ওপেনিং (Opening) ট্যাব
    if (item.id === 'opening') {
      return `<div id="tab-opening" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="opening-content"></div>
      </div>`;
    }
    // ৭. ইনভেন্টরি (Inventory) ট্যাব
    if (item.id === 'inventory') {
      return `<div id="tab-inventory" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="inventory-content"></div>
      </div>`;
    }
    // ৮. ওষুধ মাস্টার (Medicine) ট্যাব
    if (item.id === 'medicine') {
      return `<div id="tab-medicine" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="medicine-content"></div>
      </div>`;
    }
    // ৯. গ্রাহক (Customers) ট্যাব
    if (item.id === 'customers') {
      return `<div id="tab-customers" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="customers-content"></div>
      </div>`;
    }
    // ১০. সরবরাহকারী (Suppliers) ট্যাব
    if (item.id === 'suppliers') {
      return `<div id="tab-suppliers" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="suppliers-content"></div>
      </div>`;
    }
    if (item.id === 'shortList') {
      return `<div id="tab-shortList" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="short-list-content"></div>
      </div>`;
    }
    // ১১. অ্যাকাউন্টস (Accounts) ট্যাব
    if (item.id === 'accounts') {
      return `<div id="tab-accounts" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="accounts-content"></div>
      </div>`;
    }
    if (item.id === 'transfers') {
      return `<div id="tab-transfers" class="tab-panel hidden tab-enter"><div class="mb-5"><h2 class="text-xl font-bold flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div><div id="transfers-content"></div></div>`;
    }
    if (item.id === 'dailyReport') {
      return `<div id="tab-dailyReport" class="tab-panel hidden tab-enter"><div class="mb-5"><h2 class="text-xl font-bold flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div><div id="daily-report-content"></div></div>`;
    }
    if (item.id === 'maintenance') {
      return `<div id="tab-maintenance" class="tab-panel hidden tab-enter"><div class="mb-5"><h2 class="text-xl font-bold flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div><div id="maintenance-content"></div></div>`;
    }
    // ১২. সেটিংস (Settings) ট্যাব
    if (item.id === 'settings') {
      return `<div id="tab-settings" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="settings-content"></div>
      </div>`;
    }
    // ১৩. ইউজার ম্যানেজমেন্ট (Admin) ট্যাব
    if (item.id === 'admin') {
      return `<div id="tab-admin" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="admin-content"></div>
      </div>`;
    }
    // ১৪. স্টাফ ম্যানেজমেন্ট (Staff) ট্যাব
    if (item.id === 'staff') {
      return `<div id="tab-staff" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="staff-content"></div>
      </div>`;
    }
    // ১৫. বিজ্ঞাপন/অ্যাফিলিয়েট (Ads) ট্যাব — ধাপ ৮ boilerplate
    if (item.id === 'ads') {
      return `<div id="tab-ads" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="ads-content"></div>
      </div>`;
    }
    // ১৬. যোগাযোগ ও সাবস্ক্রিপশন (Contact) ট্যাব
    if (item.id === 'contact') {
      return `<div id="tab-contact" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="contact-content"></div>
      </div>`;
    }
    // ১৭. আমাদের সম্পর্কে (About) ট্যাব
    if (item.id === 'about') {
      return `<div id="tab-about" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="about-content"></div>
      </div>`;
    }
    // ১৮. AI সেটিংস ট্যাব
    if (item.id === 'aiSettings') {
      return `<div id="tab-aiSettings" class="tab-panel hidden tab-enter">
        <div class="mb-5"><h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2"><i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}</h2></div>
        <div id="aiSettings-content"></div>
      </div>`;
    }
    // . বাকি সব ডিফল্ট/প্লেসহোল্ডার ট্যাব
    return `<div id="tab-${item.id}" class="tab-panel hidden tab-enter">
      <div class="mb-5">
        <h2 class="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <i class="fa-solid ${item.icon} text-brand"></i> ${esc(item.label)}
        </h2>
      </div>
      <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
                  rounded-xl p-8 text-center text-slate-400 dark:text-slate-500">
        <i class="fa-solid fa-hammer text-2xl mb-3 opacity-40"></i>
        <p class="text-sm">এই মডিউল পরের ধাপে তৈরি হবে।</p>
      </div>
    </div>`;
  }).join('');
}

async function loadOwnerNotifications() {
  if (!APP_STATE.isOwner) return;
  try {
    const branchIds = APP_STATE.branches.map(b => b.id);
    const snaps = await Promise.all(branchIds.map(id =>
      fbDb.collection('branches').doc(id).collection('notifications').orderBy('timestamp', 'desc').limit(100).get()
    ));
    APP_STATE.notifications = snaps.flatMap(s => s.docs.map(d => ({ ...d.data(), notificationId: d.data().notificationId || d.id })))
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  } catch (err) {
    console.warn('নোটিফিকেশন লোড হয়নি:', err);
    toast('নোটিফিকেশন লোড হয়নি: ' + humanizeError(err), 'w');
  }
  updateNotificationBadge();
}

function updateNotificationBadge() {
  const badge = document.getElementById('notification-badge');
  if (!badge) return;
  const unread = APP_STATE.notifications.filter(n => n.archived !== true && n.readByOwner !== true).length;
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
}

function openNotifications() {
  if (!APP_STATE.isOwner) return toast('নোটিফিকেশন শুধুমাত্র Owner দেখতে পারবেন।', 'w');
  document.getElementById('notification-modal')?.remove();
  const filter = APP_STATE.notificationFilter || 'active';
  const filtered = APP_STATE.notifications.filter(n =>
    filter === 'archived' ? n.archived === true : n.archived !== true
  );
  const items = filtered.length
    ? filtered.map(n => {
        const branch = APP_STATE.branches.find(b => b.id === n.branchId);
        const read = n.readByOwner === true;
        return `<div class="notification-item border-b border-slate-100 dark:border-slate-700 py-3 px-1 ${read ? 'opacity-70' : 'bg-brand/5'}">
          <div class="notification-item-header flex justify-between gap-3"><div class="min-w-0 font-semibold text-sm text-slate-800 dark:text-white">${read ? '' : '<span class="inline-block w-2 h-2 rounded-full bg-brand mr-1"></span>'}${esc(n.title || n.type || 'আর্থিক লেনদেন')}</div><div class="notification-item-amount text-xs font-mono font-bold text-brand">৳${fmt(n.amount || 0)}</div></div>
          <div class="text-xs text-slate-500 mt-1">${esc(n.message || '')}</div>
          <div class="text-[11px] text-slate-400 mt-1">${esc(n.actorName || n.actorUid || 'অজানা actor')} • ${esc(branch?.name || n.branchId || '')} • ${esc(n.recordId || '')}</div>
          <div class="text-[10px] text-slate-400 mt-1">${esc(n.timestamp || '')}</div>
          <div class="notification-item-actions flex gap-3 flex-wrap mt-2">
            ${read
              ? `<button onclick="setNotificationRead('${esc(n.notificationId)}', false)" class="text-xs text-slate-500 hover:underline"><i class="fa-solid fa-envelope mr-1"></i>Unread</button>`
              : `<button onclick="setNotificationRead('${esc(n.notificationId)}', true)" class="text-xs text-brand hover:underline"><i class="fa-solid fa-envelope-open mr-1"></i>Read</button>`}
            ${n.archived === true
              ? `<button onclick="setNotificationArchived('${esc(n.notificationId)}', false)" class="text-xs text-emerald-600 hover:underline"><i class="fa-solid fa-box-open mr-1"></i>Restore</button>`
              : `<button onclick="setNotificationArchived('${esc(n.notificationId)}', true)" class="text-xs text-slate-500 hover:underline"><i class="fa-solid fa-box-archive mr-1"></i>Archive</button>`}
            <button onclick="deleteNotificationConfirm('${esc(n.notificationId)}')" class="text-xs text-red-500 hover:underline"><i class="fa-solid fa-trash mr-1"></i>Delete</button>
          </div>
        </div>`;
      }).join('')
    : `<div class="py-8 text-center text-sm text-slate-400">${filter === 'archived' ? 'কোনো Archived নোটিফিকেশন নেই।' : 'কোনো Active নোটিফিকেশন নেই।'}</div>`;
  const modal = document.createElement('div');
  modal.id = 'notification-modal';
  modal.className = 'fixed inset-0 z-[9020] bg-slate-900/50 flex items-center justify-center p-4';
  modal.innerHTML = `<div class="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
    <div class="p-4 border-b">
      <div class="flex justify-between items-center mb-3"><h3 class="font-bold">নোটিফিকেশন</h3><button onclick="closeNotifications()" class="btn-icon"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="flex gap-2 flex-wrap">
        <button onclick="setNotificationFilter('active')" class="btn btn-sm ${filter === 'active' ? 'btn-primary' : 'btn-secondary'}">Active</button>
        <button onclick="setNotificationFilter('archived')" class="btn btn-sm ${filter === 'archived' ? 'btn-primary' : 'btn-secondary'}">Archived</button>
        <button onclick="markAllNotificationsRead()" class="btn btn-sm btn-secondary"><i class="fa-solid fa-envelope-circle-check mr-1"></i>Mark all read</button>
      </div>
    </div>
    <div class="p-4 overflow-y-auto">${items}</div>
  </div>`;
  document.body.appendChild(modal);
  updateNotificationBadge();
}
function setNotificationFilter(filter) {
  APP_STATE.notificationFilter = filter === 'archived' ? 'archived' : 'active';
  openNotifications();
}

async function setNotificationRead(notificationId, isRead) {
  const notification = APP_STATE.notifications.find(n => n.notificationId === notificationId);
  if (!notification) return toast('নোটিফিকেশন পাওয়া যায়নি।', 'w');
  notification.readByOwner = isRead;
  updateNotificationBadge();
  openNotifications();
  const res = await apiUpdateNotification(notification, { readByOwner: isRead, archived: notification.archived === true });
  if (!res.success) {
    notification.readByOwner = !isRead;
    updateNotificationBadge();
    openNotifications();
    return toast(res.message, 'e');
  }
  toast(res.queued ? 'Unread/Read পরিবর্তন অফলাইনে কিউ হয়েছে।' : (isRead ? 'নোটিফিকেশন Read করা হয়েছে।' : 'নোটিফিকেশন Unread করা হয়েছে।'), res.queued ? 'w' : 's');
}

async function setNotificationArchived(notificationId, isArchived) {
  const notification = APP_STATE.notifications.find(n => n.notificationId === notificationId);
  if (!notification) return toast('নোটিফিকেশন পাওয়া যায়নি।', 'w');
  notification.archived = isArchived;
  if (isArchived) notification.readByOwner = true;
  updateNotificationBadge();
  openNotifications();
  const res = await apiUpdateNotification(notification, { readByOwner: notification.readByOwner === true, archived: isArchived });
  if (!res.success) {
    notification.archived = !isArchived;
    updateNotificationBadge();
    openNotifications();
    return toast(res.message, 'e');
  }
  toast(res.queued ? 'Archive পরিবর্তন অফলাইনে কিউ হয়েছে।' : (isArchived ? 'নোটিফিকেশন Archived হয়েছে।' : 'নোটিফিকেশন Restore হয়েছে।'), res.queued ? 'w' : 's');
}

async function markAllNotificationsRead() {
  const active = APP_STATE.notifications.filter(n => n.archived !== true);
  const previousReadState = active.map(n => n.readByOwner === true);
  active.forEach(n => { n.readByOwner = true; });
  updateNotificationBadge();
  openNotifications();
  const res = await apiMarkAllNotificationsRead(active);
  if (!res.success) {
    active.forEach((notification, index) => { notification.readByOwner = previousReadState[index]; });
    updateNotificationBadge();
    openNotifications();
    return toast(res.message, 'e');
  }
  toast('সব Active নোটিফিকেশন Read করা হয়েছে।', 's');
}

async function deleteNotificationConfirm(notificationId) {
  const notification = APP_STATE.notifications.find(n => n.notificationId === notificationId);
  if (!notification) return toast('নোটিফিকেশন পাওয়া যায়নি।', 'w');
  if (!confirm('এই নোটিফিকেশনটি মুছবেন? Underlying edit history অক্ষত থাকবে।')) return;
  APP_STATE.notifications = APP_STATE.notifications.filter(n => n.notificationId !== notificationId);
  updateNotificationBadge();
  openNotifications();
  const res = await apiDeleteNotification(notification);
  if (!res.success) {
    APP_STATE.notifications.push(notification);
    APP_STATE.notifications.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    updateNotificationBadge();
    openNotifications();
    return toast(res.message, 'e');
  }
  toast(res.queued ? 'Deletion অফলাইনে কিউ হয়েছে।' : 'নোটিফিকেশন মুছে ফেলা হয়েছে।', res.queued ? 'w' : 's');
}

function closeNotifications() { document.getElementById('notification-modal')?.remove(); }

function wireShellEvents() {
  document.getElementById('sidebar-nav').addEventListener('click', (e) => {
    const link = e.target.closest('.nav-link');
    if (!link) return;
    e.preventDefault();
    goTab(link.dataset.tab);
  });
  document.getElementById('hamburger-btn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
  document.getElementById('dark-toggle-btn').addEventListener('click', () => {
    toggleTheme();
    updateDarkToggleIcon();
  });
}

// ════════════════════════════════════════════════════════════
// TAB ROUTER
// ════════════════════════════════════════════════════════════
function canAccessTab(tabId) {
  if (APP_STATE.isOwner) return true;
  if (!APP_STATE.isStaffMember) return false;
  if (['dashboard', 'analytics', 'accounts', 'admin', 'staff', 'aiSettings'].includes(tabId)) return false;
  if (['contact', 'about', 'settings'].includes(tabId)) return true;
  if (tabId === 'shortList') {
    return APP_STATE.permissions?.inventory === true || APP_STATE.permissions?.pos === true;
  }
  const permission = TAB_PERMISSION_MAP[tabId];
  return !!permission && APP_STATE.permissions?.[permission] === true;
}

function updateHeaderQuickActions() {
  const homeButton = document.getElementById('header-home-btn');
  if (homeButton) {
    const isStaff = APP_STATE.isStaffMember && !APP_STATE.isOwner;
    const label = isStaff ? 'বিক্রয় (POS)-এ ফিরুন' : 'ড্যাশবোর্ডে ফিরুন';
    homeButton.classList.toggle('hidden', !(APP_STATE.isOwner || APP_STATE.isStaffMember));
    homeButton.title = label;
    homeButton.setAttribute('aria-label', label);
    const icon = homeButton.querySelector('i');
    if (icon) icon.className = `fa-solid ${isStaff ? 'fa-cash-register' : 'fa-house'}`;
  }

  const shortListButton = document.getElementById('header-short-list-btn');
  if (shortListButton) shortListButton.classList.toggle('hidden', !canAccessTab('shortList'));
}

function goHome() {
  goTab(APP_STATE.isStaffMember && !APP_STATE.isOwner ? 'pos' : 'dashboard');
}

function dashboardQuickAction(action) {
  const targetTab = { sale: 'pos', purchase: 'purchase', income: 'accounts', expense: 'accounts' }[action];
  if (!targetTab || !canAccessTab(targetTab)) return;
  if ((action === 'income' || action === 'expense') && !APP_STATE.activeBranchId) {
    return toast('আয়/খরচ যোগ করার আগে সক্রিয় Branch নির্বাচন করুন।', 'w');
  }

  goTab(targetTab);
  if (action === 'income' || action === 'expense') {
    const scopeSelect = document.getElementById('accounting-scope');
    if (scopeSelect) scopeSelect.value = APP_STATE.activeBranchId;
    onAccountingScopeChange(APP_STATE.activeBranchId);
    if (action === 'income') toggleIncomeForm();
    else toggleExpenseForm();
  }
}

// ✅ opts.fromBack: true হলে বোঝায় এই কলটা handleAppPopState() থেকে
// এসেছে (ইউজার Back চেপেছে) — তখন currentTab আবার tabHistory-তে push
// করা হবে না, নাহলে back চাপলেও stack বাড়তেই থাকবে (ping-pong bug)।
function goTab(tabId, opts = {}) {
  if (!APP_STATE.isOwner && APP_STATE.isStaffMember && !canAccessTab(tabId)
      && !['contact', 'about', 'settings'].includes(tabId)) {
    toast('এই মডিউলের অনুমতি আপনার নেই।', 'e');
    tabId = 'pos';
  }
  // ✅ নতুন — সাধারণ (forward) নেভিগেশনেই কেবল আগের ট্যাব stack-এ push হবে
  if (!opts.fromBack && APP_STATE.currentTab && APP_STATE.currentTab !== tabId) {
    APP_STATE.tabHistory.push(APP_STATE.currentTab);
  }

  APP_STATE.currentTab = tabId;
  localStorage.setItem('pharmacy-last-tab', tabId);
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('tab-' + tabId);
  if (panel) panel.classList.remove('hidden');

  document.querySelectorAll('.nav-link').forEach(link => {
    const active = link.dataset.tab === tabId;
    link.classList.toggle('bg-brand/20', active);
    link.classList.toggle('text-white', active);
    link.classList.toggle('text-white/60', !active);
  });

  setText('header-title', TAB_TITLES[tabId] || tabId);
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // ট্যাব-নির্দিষ্ট রেন্ডার হুক — এখন শুধু dashboard ছিল , পরে বাকিগুলো যোগ হয়েছে 
  // ট্যাব-নির্দিষ্ট রেন্ডার হুক

  // ট্যাব-নির্দিষ্ট রেন্ডার হুক
  try {
    if (tabId === 'dashboard') { setText('dash-date', formatTodayBn()); renderDashboardModule(); }
    if (tabId === 'pos') { renderPOSModule(); }
    if (tabId === 'analytics') { renderAnalyticsModule(); }
    if (tabId === 'purchase') { renderPurchaseModule(); }
    if (tabId === 'returns') { renderReturnsModule(); }
    if (tabId === 'opening') { renderOpeningModule(); }
    if (tabId === 'inventory') { renderInventoryModule(); }
    if (tabId === 'medicine') { renderMedicineModule(); }
    if (tabId === 'customers') { renderCustomersModule(); }
    if (tabId === 'suppliers') { renderSuppliersModule(); }
    if (tabId === 'shortList') { renderShortListModule(); }
    if (tabId === 'accounts') { renderAccountsModule(); }
    if (tabId === 'transfers') { renderTransfersModule(); }
    if (tabId === 'dailyReport') { renderDailyReportModule(); }
    if (tabId === 'maintenance') { renderMaintenanceModule(); }
    if (tabId === 'settings') { renderSettingsModule(); }
    if (tabId === 'admin') { renderAdminModule(); }
    if (tabId === 'ads') { renderAdsModule(); }
    if (tabId === 'contact') { renderContactModule(); }
    if (tabId === 'about') { renderAboutModule(); }
    if (tabId === 'staff') { renderStaffModule(); }
    if (tabId === 'aiSettings') { renderAiSettingsModule(); }
  } catch (err) {
    showFatalError('goTab("' + tabId + '") এ সমস্যা:\n' + err.message);
  }
}

function formatTodayBn() {
  const d = new Date();
  const days = ['রবিবার','সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার'];
  const months = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ════════════════════════════════════════════════════════════
// SIDEBAR TOGGLE
// ════════════════════════════════════════════════════════════
function toggleSidebar() {
  APP_STATE.sidebarOpen = !APP_STATE.sidebarOpen;
  document.getElementById('sidebar').classList.toggle('-translate-x-full', !APP_STATE.sidebarOpen);
  document.getElementById('sidebar-overlay').classList.toggle('hidden', !APP_STATE.sidebarOpen);
}
function closeSidebar() {
  APP_STATE.sidebarOpen = false;
  document.getElementById('sidebar').classList.add('-translate-x-full');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

// ════════════════════════════════════════════════════════════
// LOADING / VISIBILITY
// ════════════════════════════════════════════════════════════
function hideLoadingScreen() {
  const elapsed = Date.now() - _bootStartTime;
  const remaining = Math.max(0, BOOT_ANIMATION_MIN_MS - elapsed);
  setTimeout(() => {
    document.getElementById('app-loading')?.classList.add('hide');
  }, remaining);
}
function showAppRoot() { document.getElementById('app-root')?.classList.remove('hidden'); }
function setLoadingMessage(msg) { setText('loading-message', msg); }

// ════════════════════════════════════════════════════════════
// DARK MODE
// ════════════════════════════════════════════════════════════
function applyStoredTheme() {
  const saved = localStorage.getItem('pharmacy-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', saved ? saved === 'dark' : prefersDark);
}
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('pharmacy-theme', isDark ? 'dark' : 'light');
}
function updateDarkToggleIcon() {
  const isDark = document.documentElement.classList.contains('dark');
  const icon = document.getElementById('dark-toggle-icon');
  if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}
