'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const jsRoot = path.join(projectRoot, 'js');

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? listJavaScriptFiles(fullPath)
      : entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

function createElement() {
  const classes = new Set();
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    title: '',
    disabled: false,
    dataset: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle(name, force) {
        const shouldAdd = force === undefined ? !classes.has(name) : force;
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      },
    },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    remove() {},
    appendChild() {},
    querySelector() { return createElement(); },
    querySelectorAll() { return []; },
    focus() {},
  };
}

function createSandbox(files = [], overrides = {}) {
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const storage = new Map();
  const document = {
    activeElement: null,
    visibilityState: 'visible',
    body: createElement(),
    documentElement: createElement(),
    addEventListener() {},
    getElementById,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return createElement(); },
  };
  const context = {
    APP_STATE: {
      currentUser: null,
      inventory: [],
      medicines: [],
      purchases: [],
      openingEntries: [],
      posItems: [],
      purItems: [],
      noInvItems: [],
      sales: [],
      suppliers: [],
      branches: [],
      permissions: {},
      tabHistory: [],
      ...overrides.APP_STATE,
    },
    document,
    navigator: { onLine: true },
    window: { addEventListener() {}, scrollTo() {}, open() {} },
    history: { pushState() {}, back() {} },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval() { return 0; },
    clearInterval() {},
    ...overrides,
  };
  vm.createContext(context);
  for (const relativePath of files) {
    const fullPath = path.join(projectRoot, relativePath);
    vm.runInContext(fs.readFileSync(fullPath, 'utf8'), context, { filename: fullPath });
  }
  return { context, document, elements, storage };
}

test('all JavaScript files under js/ pass node --check', () => {
  const files = listJavaScriptFiles(jsRoot);
  assert.ok(files.length > 0, 'expected JavaScript source files');
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${path.relative(projectRoot, file)}\n${result.stderr}`);
  }
});

test('direct-unit formatting and inventory valuation use FEFO and reject invalid numbers', () => {
  const { context: app } = createSandbox(['js/utils.js']);
  const formatted = app.formatUnitQuantity(12.9);
  assert.match(formatted, /ইউনিট$/);
  assert.equal(app.getEffectiveReorderLevel({ reorderLevel: '0' }), 0);

  const result = app.computeInventoryDerivedFields([
    { batchId: 'later', expiry: '12/2027', stock: 3, cost: 10, mrp: 14 },
    { batchId: 'expired-stock', expiry: '11/2026', stock: 0, cost: 99, mrp: 120 },
    { batchId: 'earlier', expiry: '01/2027', stock: 2, cost: 8, mrp: 12 },
  ], 5);
  assert.deepEqual(Array.from(result.batches, batch => batch.batchId), ['earlier', 'later']);
  assert.equal(result.totalStock, 5);
  assert.equal(result.costValue, 46);
  assert.equal(result.mrpValue, 66);
  assert.equal(result.nearestExpiry, '01/2027');
  assert.equal(result.status, 'low');
  assert.throws(() => app.computeInventoryDerivedFields([{ stock: Infinity }], 10), /বৈধ সংখ্যা/);
});

test('gross discount allocation is exact and excludes inline-discounted products', () => {
  const { context: app } = createSandbox(['js/utils.js']);
  const items = [
    { qty: 1, price: 10, discount: 0 },
    { qty: 1, price: 10, discount: 0 },
    { qty: 1, price: 10, discount: 2 },
  ];
  const shares = app.distributeGrossDiscount(
    items, 1, item => item.qty * item.price, item => item.discount,
  );
  assert.equal(shares.get(items[0]) + shares.get(items[1]), 1);
  assert.equal(shares.has(items[2]), false);
});

test('purchase total handles inline and gross discounts on direct quantities', () => {
  const { context: app, elements } = createSandbox(['js/utils.js', 'js/modules/purchase.js']);
  app.APP_STATE.purGrossDiscPct = 10;
  app.APP_STATE.purItems = [
    { qty: 2, purchasePrice: 10, discountAmt: 2 },
    { qty: 1, purchasePrice: 10, discountAmt: 0 },
    { qty: 3, purchasePrice: 5, discountAmt: 0 },
  ];
  app.renderAiReconciliationBanner = () => {};
  app.calcPurTotal();
  assert.equal(elements.get('pur-total').value, '40.50');
  assert.deepEqual(Array.from(app.APP_STATE.purItems, item => item._effectiveDiscountAmt), [2, 1, 1.5]);
});

test('purchase payment selector updates its active state and short labels', () => {
  const { context: app, elements } = createSandbox(['js/utils.js', 'js/modules/purchase.js']);
  app.setPurPayType('বাকি');
  assert.equal(app.APP_STATE.purPayType, 'বাকি');
  assert.match(elements.get('pur-pay-due').className, /btn-warning/);
  assert.equal(elements.get('pur-pay-due').textContent, 'সরবরাহকারী বাকি');
  assert.match(elements.get('pur-note-box').innerHTML, /পাওনা বাড়বে/);
});

test('POS total, discounts, cash, due and change remain consistent', () => {
  const { context: app, elements, document } = createSandbox(['js/utils.js', 'js/modules/pos.js']);
  app.APP_STATE.posGrossDiscPct = 10;
  app.APP_STATE.posItems = [
    { qty: 2, price: 10, discountAmt: 2 },
    { qty: 1, price: 10, discountAmt: 0 },
    { qty: 3, price: 5, discountAmt: 0 },
  ];
  document.getElementById('pos-cash').value = '50';
  app.calcPOSTotals();
  assert.equal(elements.get('pos-total').value, '40.50');
  assert.equal(elements.get('pos-net-cash').value, '40.50');
  assert.equal(elements.get('pos-due').value, '0.00');
  assert.equal(elements.get('pos-change').textContent, `৳${app.fmt(9.5)}`);
});

test('POS stock deduction follows FEFO, recomputes value and reorder status', () => {
  const { context: app } = createSandbox(['js/utils.js', 'js/modules/pos.js'], {
    APP_STATE: {
      medicines: [{ id: 'med-1', reorderLevel: 5 }],
      inventory: [{
        medId: 'med-1',
        batches: [
          { batchId: 'later', expiry: '12/2027', stock: 4, cost: 20, mrp: 30 },
          { batchId: 'first', expiry: '12/2026', stock: 1, cost: 10, mrp: 15 },
          { batchId: 'next', expiry: '01/2027', stock: 2, cost: 12, mrp: 18 },
        ],
      }],
    },
  });
  app.deductStockFEFO('med-1', 3);
  const inventory = app.APP_STATE.inventory[0];
  assert.deepEqual(Array.from(inventory.batches, batch => batch.batchId), ['later']);
  assert.equal(inventory.totalStock, 4);
  assert.equal(inventory.costValue, 80);
  assert.equal(inventory.nearestExpiry, '12/2027');
  assert.equal(inventory.status, 'low');
});

test('inventory restock and consumed-batch deduction preserve the original batch', () => {
  const { context: app } = createSandbox(['js/utils.js', 'js/modules/inventory.js'], {
    APP_STATE: {
      medicines: [{ id: 'med-1', reorderLevel: 2 }],
      inventory: [{ medId: 'med-1', sellPrice: 15, batches: [
        { batchId: 'batch-a', expiry: '02/2027', stock: 2, cost: 4, mrp: 8, sell: 15 },
      ] }],
    },
  });
  app.restockItem('med-1', 2, 4, [{ batchId: 'batch-a', qty: 2 }]);
  assert.equal(app.APP_STATE.inventory[0].batches[0].stock, 4);
  app.destockFromConsumed('med-1', 1, [{ batchId: 'batch-a', qty: 1 }]);
  assert.equal(app.APP_STATE.inventory[0].batches[0].stock, 3);
  assert.equal(app.APP_STATE.inventory[0].totalStock, 3);
});

test('inventory view renders manufacturer groups and both selectable layouts', () => {
  const { context: app, elements } = createSandbox(['js/utils.js', 'js/modules/inventory.js'], {
    APP_STATE: {
      invView: 'line',
      invGroupByManufacturer: true,
      medicines: [
        { id: 'm1', brand: 'Zebra', manufacturer: 'Square' },
        { id: 'm2', brand: 'Beta', manufacturer: 'Beximco' },
        { id: 'm3', brand: 'Alpha', manufacturer: 'Square' },
      ],
      inventory: [
        { medId: 'm1', brand: 'Zebra', totalStock: 1, batches: [] },
        { medId: 'm2', brand: 'Beta', totalStock: 1, batches: [] },
        { medId: 'm3', brand: 'Alpha', totalStock: 1, batches: [] },
      ],
    },
  });
  app.renderInvTable();
  const body = elements.get('inv-table-body');
  assert.match(body.className, /inv-view-line/);
  assert.match(body.innerHTML, /inventory-group-row/);
  assert.ok(body.innerHTML.indexOf('Beximco') < body.innerHTML.indexOf('Square'));
  assert.ok(body.innerHTML.indexOf('Alpha') < body.innerHTML.indexOf('Zebra'));
  app.APP_STATE.invGroupByManufacturer = false;
  app.APP_STATE.invView = 'card';
  app.renderInvTable();
  assert.match(body.className, /inv-view-card/);
  assert.doesNotMatch(body.innerHTML, /inventory-group-row/);
});

test('partial returns skip previously returned batch quantities without overlap', () => {
  const { context: app } = createSandbox(['js/utils.js', 'js/modules/returns.js']);
  const portion = app.extractConsumedBatchPortion([
    { batchId: 'batch-a', qty: 2, cost: 5 },
    { batchId: 'batch-b', qty: 4, cost: 7 },
  ], 3, 2);
  assert.equal(portion.length, 1);
  assert.equal(portion[0].batchId, 'batch-b');
  assert.equal(portion[0].qty, 2);
  assert.equal(portion[0].cost, 7);
});

test('no-invoice return totals apply a capped percentage to whole direct units', () => {
  const { context: app, elements } = createSandbox(['js/utils.js', 'js/modules/returns.js']);
  app.APP_STATE.noInvDiscountPct = 10;
  app.APP_STATE.noInvItems = [
    { qty: 3.8, sellPrice: 10 },
    { qty: 2, sellPrice: 2 },
  ];
  app.renderNoInvoiceReturnItems = () => {};
  app.calcNoInvoiceReturnTotal();
  assert.equal(elements.get('noinv-linetotal-0').textContent, `৳${app.fmt(27)}`);
  assert.equal(elements.get('noinv-total').textContent, `৳${app.fmt(30.6)}`);
  app.onNoInvDiscPctChange(140);
  assert.equal(app.APP_STATE.noInvDiscountPct, 100);
});

test('reorder candidates prioritize stockouts, group by supplier and format WhatsApp details', () => {
  const { context: app } = createSandbox(['js/utils.js', 'js/modules/reorder-list.js'], {
    APP_STATE: {
      pharmacyName: 'পরীক্ষা ফার্মেসি',
      purchases: [{ items: [{ medId: 'm1' }, { medId: 'm2' }, { medId: 'm3' }] }],
      medicines: [
        { id: 'm1', reorderLevel: 5, preferredSupplierId: 's1', preferredRepId: 'r1' },
        { id: 'm2', reorderLevel: 5, preferredSupplierId: 'missing-supplier' },
        { id: 'm3', reorderLevel: 5, preferredSupplierId: 's1' },
      ],
      inventory: [
        { medId: 'm1', brand: 'Medicine A', totalStock: 4 },
        { medId: 'm2', brand: 'Medicine B', totalStock: 0 },
        { medId: 'm3', brand: 'Medicine C', totalStock: 20 },
      ],
      suppliers: [{ id: 's1', name: 'Supplier One' }],
    },
  });
  const candidates = app.getReorderCandidates();
  assert.deepEqual(Array.from(candidates, candidate => candidate.medId), ['m2', 'm1']);
  const groups = app.buildReorderGroups(candidates);
  assert.equal(groups.supplierGroups[0].supplierId, 's1');
  assert.deepEqual(Array.from(groups.supplierGroups[0].repGroupKeys), ['r1']);
  assert.equal(groups.unassigned[0].supplierDeleted, true);
  assert.equal(app.sanitizeWhatsAppPhone('01712345678'), '8801712345678');
  const message = app.buildReorderMessageText('Supplier One', [candidates[0]]);
  assert.match(message, /পরীক্ষা ফার্মেসি/);
  assert.match(message, /স্টক শেষ/);
  assert.deepEqual(JSON.parse(JSON.stringify(app.parseReorderMedsJson('[{"brand":"A"}]'))), [{ brand: 'A' }]);
});

test('cash delta writes rounded balance and skips zero-value writes', () => {
  const writes = [];
  const fbDb = {
    collection(name) {
      return {
        doc(id) {
          return {
            id,
            collection(child) { return fbDb.collection(`${name}/${id}/${child}`); },
          };
        },
      };
    },
  };
  const { context: app } = createSandbox(['js/utils.js', 'js/api-client.js'], {
    APP_STATE: { activeBranchId: 'branch-1' },
    fbDb,
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
  });
  const tx = { set: (...args) => writes.push(args) };
  app.applyCashDelta(tx, 100, -12.345);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].cashBalance, 87.66);
  assert.equal(writes[0][1].lastUpdated, 'server-time');
  app.applyCashDelta(tx, 100, 0);
  assert.equal(writes.length, 1);
});

test('offline queue validation rejects missing identity, IDs and non-finite numbers', async () => {
  const { context: app } = createSandbox(['js/db-indexeddb.js']);
  await assert.rejects(() => app.queueWrite({ type: 'purchase', payload: { purchaseId: 'p1' } }), /ইউজার বা সক্রিয় শাখা/);
  app.APP_STATE.currentUser = { uid: 'user-1' };
  app.APP_STATE.activeBranchId = 'branch-1';
  await assert.rejects(() => app.queueWrite({ type: 'purchase', payload: {} }), /document ID নেই/);
  await assert.rejects(() => app.queueWrite({
    type: 'purchase',
    payload: { purchaseId: 'p1', items: [{ qty: Number.NaN }] },
  }), /অবৈধ সংখ্যা/);
  const cyclic = { purchaseId: 'p2' };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => app.assertFiniteQueueNumbers(cyclic));
});

test('offline purchase helper queues a valid payload and reports failure explicitly', async () => {
  const queued = [];
  const { context: app } = createSandbox(['js/utils.js', 'js/api-client.js'], {
    queueWrite: async entry => { queued.push(entry); return 'temp-1'; },
  });
  const result = await app.queuePurchaseOffline({ purchaseId: 'PUR-1', totalCost: 25 });
  assert.equal(result.success, true);
  assert.equal(result.queued, true);
  assert.equal(queued[0].type, 'purchase');
  assert.equal(queued[0].payload.purchaseId, 'PUR-1');

  app.queueWrite = async () => { throw new Error('offline storage failed'); };
  const failure = await app.queuePurchaseOffline({ purchaseId: 'PUR-2' });
  assert.equal(failure.success, false);
  assert.match(failure.message, /ব্যর্থ/);
});

test('sync registry exposes API/apply pairs and failed-entry retry uses capped backoff', () => {
  const stub = () => {};
  const apiNames = [
    'apiSubmitSale', 'apiSubmitPurchase', 'apiCollectCustomerDue', 'apiPaySupplierPayable',
    'apiAddExpense', 'apiAddIncome', 'apiSaveShortList', 'apiDeleteShortList',
    'apiDeleteNotification', 'apiSubmitCustomerReturn', 'apiSubmitSupplierReturn',
    'apiAddMedicine', 'apiAddCustomer', 'apiAddSupplier',
  ];
  const globals = Object.fromEntries(apiNames.map(name => [name, stub]));
  const { context: app } = createSandbox(['js/sync-engine.js'], globals);
  const registry = app.getSyncTypeRegistry();
  assert.ok(Object.hasOwn(registry, 'sale'));
  assert.ok(Object.hasOwn(registry, 'purchase'));
  assert.ok(Object.hasOwn(registry, 'customerReturn'));
  assert.equal(typeof registry.sale.apiFn, 'function');
  assert.equal(typeof registry.sale.applyFn, 'function');
  assert.equal(app.shouldAutoRetryFailed({ attempts: 0 }), true);
  assert.equal(app.shouldAutoRetryFailed({ attempts: 5 }), false);
  assert.equal(app.shouldAutoRetryFailed({ attempts: 1, lastAttemptAt: Date.now() }), false);
  assert.equal(app.isPermanentlyFailed({ status: 'failed', attempts: 5 }), true);
});

test('notification and audit helpers enforce owner/staff guards and write staff edits', async () => {
  const writes = [];
  function collection(path) {
    return {
      doc(id) {
        const documentPath = `${path}/${id}`;
        return {
          async set(payload) { writes.push({ path: documentPath, payload }); },
          collection(name) { return collection(`${documentPath}/${name}`); },
        };
      },
    };
  }
  const { context: app } = createSandbox(['js/utils.js', 'js/api-client.js'], {
    APP_STATE: {
      isStaffMember: true,
      isOwner: false,
      staffRole: 'manager',
      activeBranchId: 'branch-1',
      currentUser: { uid: 'staff-1', displayName: 'Staff' },
    },
    fbDb: { collection },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
  });
  await app.emitStaffEditAudit({
    recordType: 'purchase',
    recordId: 'PUR-1',
    editSummary: 'মূল্য সংশোধন',
    before: { totalCost: 10 },
    after: { totalCost: 12 },
  });
  assert.equal(writes.length, 2);
  assert.match(writes[0].path, /^audits\/EDIT-/);
  assert.equal(writes[0].payload.actorUid, 'staff-1');
  assert.match(writes[1].path, /^branches\/branch-1\/notifications\/NOTIFY-/);
  assert.equal(writes[1].payload.type, 'staff_edit');
  app.APP_STATE.isOwner = true;
  const ownerGuard = await app.emitFinancialNotification({ staffEdit: true });
  assert.equal(ownerGuard.success, false);
  assert.equal(ownerGuard.queued, false);
  assert.equal(writes.length, 2);
});

test('ledger classifies cash and non-cash purchases/returns correctly', () => {
  const { context: app } = createSandbox(['js/utils.js', 'js/modules/accounts.js'], {
    APP_STATE: { activeBranchId: 'branch-1' },
  });
  const date = '2026-01-02';
  const entries = app.buildLedgerEntries(date, {
    sales: [{ date, invoiceNo: 'INV-1', totalBill: 100 }],
    purchases: [
      { date, paymentType: 'নগদ', totalCost: 25 },
      { date, paymentType: 'বাকি', totalCost: 40 },
    ],
    returns: [
      { date, returnType: 'customer', refundMethod: 'নগদ ফেরত', amount: 5 },
      { date, returnType: 'customer', refundMethod: 'বাকি সমন্বয়', amount: 7 },
      { date, returnType: 'supplier', refundMethod: 'নগদ ফেরত', amount: 3 },
    ],
  });
  const byCategory = Object.fromEntries(entries.map(entry => [entry.category, entry]));
  assert.equal(byCategory['ক্রয় (নগদ)'].type, 'expense');
  assert.equal(byCategory['ক্রয় (বাকি)'].type, 'info');
  assert.equal(byCategory['রিটার্ন (কাস্টমার, নগদ)'].type, 'expense');
  assert.equal(byCategory['রিটার্ন (কাস্টমার, বাকি সমন্বয়)'].type, 'info');
  assert.equal(byCategory['সরবরাহকারী রিটার্ন (নগদ)'].type, 'income');
});

test('staff navigation respects permissions and back navigation does not grow history', () => {
  const { context: app } = createSandbox(['js/app.js'], {
    APP_STATE: {
      isOwner: false,
      isStaffMember: true,
      permissions: { pos: true, purchase: false, inventory: true },
      currentTab: 'pos',
      tabHistory: [],
    },
    TAB_PERMISSION_MAP: { pos: 'pos', purchase: 'purchase', inventory: 'inventory' },
    TAB_TITLES: { pos: 'বিক্রয়', purchase: 'ক্রয়', contact: 'যোগাযোগ', about: 'পরিচিতি' },
    toast() {},
    setText() {},
    renderContactModule() {},
    renderAboutModule() {},
    renderPOSModule() {},
    showFatalError() {},
  });
  assert.equal(app.canAccessTab('inventory'), true);
  assert.equal(app.canAccessTab('purchase'), false);
  app.goTab('purchase');
  assert.equal(app.APP_STATE.currentTab, 'pos');
  app.goTab('contact');
  assert.deepEqual(Array.from(app.APP_STATE.tabHistory), ['pos']);
  app.goTab('about', { fromBack: true });
  assert.equal(app.APP_STATE.currentTab, 'about');
  assert.deepEqual(Array.from(app.APP_STATE.tabHistory), ['pos']);
});

test('header home and short-list shortcuts follow the current user permissions', () => {
  const { context: app, document } = createSandbox(['js/app.js'], {
    APP_STATE: {
      isOwner: false,
      isStaffMember: true,
      permissions: { pos: false, inventory: false },
    },
    TAB_PERMISSION_MAP: { shortList: 'inventory' },
    TAB_TITLES: {},
  });
  const home = document.getElementById('header-home-btn');
  const shortList = document.getElementById('header-short-list-btn');
  shortList.classList.add('hidden');
  const navigated = [];
  app.goTab = tab => navigated.push(tab);
  app.updateHeaderQuickActions();
  assert.equal(home.title, 'বিক্রয় (POS)-এ ফিরুন');
  assert.equal(shortList.classList.contains('hidden'), true);
  app.goHome();
  assert.deepEqual(navigated, ['pos']);

  app.APP_STATE.permissions.pos = true;
  app.updateHeaderQuickActions();
  assert.equal(shortList.classList.contains('hidden'), false);
  app.APP_STATE.isOwner = true;
  app.updateHeaderQuickActions();
  assert.equal(home.title, 'ড্যাশবোর্ডে ফিরুন');
  app.goHome();
  assert.deepEqual(navigated, ['pos', 'dashboard']);
});

test('dashboard quick actions open permitted modules and income/expense forms at active branch', () => {
  const notices = [];
  const { context: app, document } = createSandbox(['js/app.js'], {
    APP_STATE: {
      isOwner: true,
      isStaffMember: false,
      activeBranchId: 'branch-1',
    },
    TAB_PERMISSION_MAP: {},
    TAB_TITLES: {},
    toast: (...args) => notices.push(args),
  });
  const actions = [];
  app.goTab = tab => actions.push(['tab', tab]);
  app.onAccountingScopeChange = branchId => actions.push(['scope', branchId]);
  app.toggleIncomeForm = () => actions.push(['income']);
  app.toggleExpenseForm = () => actions.push(['expense']);

  app.dashboardQuickAction('sale');
  app.dashboardQuickAction('purchase');
  app.dashboardQuickAction('income');
  app.dashboardQuickAction('expense');
  assert.deepEqual(actions, [
    ['tab', 'pos'],
    ['tab', 'purchase'],
    ['tab', 'accounts'], ['scope', 'branch-1'], ['income'],
    ['tab', 'accounts'], ['scope', 'branch-1'], ['expense'],
  ]);
  assert.equal(document.getElementById('accounting-scope').value, 'branch-1');

  app.APP_STATE.activeBranchId = null;
  const previousActionCount = actions.length;
  app.dashboardQuickAction('income');
  assert.equal(actions.length, previousActionCount);
  assert.match(notices[0][0], /সক্রিয় Branch/);
});

test('HTML loads app scripts in dependency order and CSS preserves mobile line view', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(projectRoot, 'css/styles.css'), 'utf8');
  const dashboard = fs.readFileSync(path.join(projectRoot, 'js/modules/dashboard.js'), 'utf8');
  const scriptPaths = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g), match => match[1]);
  const utilsIndex = scriptPaths.findIndex(src => src.startsWith('js/utils.js'));
  const posIndex = scriptPaths.findIndex(src => src.startsWith('js/modules/pos.js'));
  const purchaseIndex = scriptPaths.findIndex(src => src.startsWith('js/modules/purchase.js'));
  const inventoryIndex = scriptPaths.findIndex(src => src.startsWith('js/modules/inventory.js'));
  const appIndex = scriptPaths.findIndex(src => src.startsWith('js/app.js'));
  assert.ok(utilsIndex >= 0 && utilsIndex < posIndex && posIndex < purchaseIndex);
  assert.ok(purchaseIndex < inventoryIndex && inventoryIndex < appIndex);
  assert.match(html, /href="css\/styles\.css(?:\?v=[^"]+)?"/);
  assert.match(html, /id="header-short-list-btn" onclick="goTab\('shortList'\)"/);
  assert.match(html, /id="header-home-btn" onclick="goHome\(\)"/);
  for (const action of ['sale', 'purchase', 'income', 'expense']) {
    assert.match(dashboard, new RegExp(`dashboardQuickAction\\('${action}'\\)`));
  }
  assert.match(css, /\.inventory-results:not\(\.inv-view-line\) \.inventory-table-scroll\s*\{\s*display:\s*none/);
  assert.doesNotMatch(css, /(?:^|\n)\s*\.inventory-table-scroll\s*\{\s*display:\s*none/m);
});

test('Firestore rules retain owner/staff role, branch, collection and deny-by-default guards', () => {
  const rules = fs.readFileSync(path.join(projectRoot, 'firestore.rules'), 'utf8');
  assert.match(rules, /rules_version\s*=\s*'2'/);
  assert.match(rules, /function isOwner\(\)[\s\S]*?\.data\.role == 'owner'/);
  assert.match(rules, /function isActiveStaff\(\)[\s\S]*?staffDoc\(\)\.active == true[\s\S]*?staffDoc\(\)\.status == 'active'/);
  assert.match(rules, /request\.resource\.data\.role in \['manager', 'cashier'\]/);
  assert.match(rules, /staffDoc\(\)\.assignedBranchIds is list/);
  assert.match(rules, /branchId in staffDoc\(\)\.assignedBranchIds/);
  assert.match(rules, /function hasPermission\(permission\)[\s\S]*?staffDoc\(\)\.permissions\[permission\] == true/);
  for (const collection of [
    'sales', 'purchases', 'returns', 'inventory', 'medicines', 'customers',
    'suppliers', 'transfers', 'dailyReport',
  ]) {
    assert.ok(rules.includes(`collectionId == '${collection}'`), `missing rule for ${collection}`);
  }
  assert.ok(rules.includes("collectionId in ['expenses', 'incomes']"), 'missing finance collection permissions');
  assert.match(rules, /match \/audits\/\{auditId\}[\s\S]*?allow update, delete: if false/);
  assert.match(rules, /match \/transfers\/\{transferId\}[\s\S]*?allow update, delete: if false/);
  assert.match(rules, /match \/\{document=\*\*\}[\s\S]*?allow read, write: if false/);
});
