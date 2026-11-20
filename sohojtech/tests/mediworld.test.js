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
    style: {},
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

test('About Us identifies SojojTech Pharmacy as the platform owner', () => {
  const { context: app, document } = createSandbox([
    'js/config.js',
    'js/utils.js',
    'js/modules/about.js',
  ]);
  app.renderAboutModule();
  const about = document.getElementById('about-content').innerHTML;
  assert.match(about, /SojojTech Pharmacy/);
  assert.match(about, /প্ল্যাটফর্ম মালিক ও পরিচালনাকারী/);
  assert.match(about, /afsanabintemonnaf@gmail\.com/);
});

test('workspace identity and invoice top show client business, branch, and address', () => {
  const { context: app, document } = createSandbox([
    'js/utils.js',
    'js/receipt.js',
    'js/app.js',
  ], {
    APP_STATE: {
      pharmacyName: 'Client Pharmacy',
      address: 'Fallback address',
      activeBranchId: 'branch-1',
      branches: [{ id: 'branch-1', name: 'Uttara Branch', address: 'Road 5, Dhaka' }],
    },
  });
  app.renderWorkspaceBusinessIdentity();
  const workspace = document.getElementById('workspace-business-identity').innerHTML;
  assert.match(workspace, /Client Pharmacy/);
  assert.match(workspace, /Uttara Branch/);
  assert.match(workspace, /Road 5, Dhaka/);

  const receipt = app.buildReceiptConfig('sale', {
    branchId: 'branch-1',
    invoiceNo: 'INV-1',
    date: '2026-11-20',
    items: [],
    totalBill: 0,
    cashPaid: 0,
    due: 0,
  });
  assert.equal(receipt.pharmacy.name, 'Client Pharmacy');
  assert.equal(receipt.pharmacy.branchName, 'Uttara Branch');
  assert.equal(receipt.pharmacy.address, 'Road 5, Dhaka');
  const html = app.buildReceiptHTMLContent(receipt);
  assert.ok(html.indexOf('Client Pharmacy') < html.indexOf('Uttara Branch'));
  assert.ok(html.indexOf('Uttara Branch') < html.indexOf('Road 5, Dhaka'));
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
  assert.match(rules, /function isSuperAdmin\(\)/);
  assert.match(rules, /function hasActivePlatformBilling\(ownerUid\)/);
  assert.match(rules, /match \/platformUsers\/\{ownerUid\}[\s\S]*?allow update: if isSuperAdmin\(\)[\s\S]*?allow delete: if isSuperAdmin\(\)/);
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

test('Firebase deploy config includes both Transfer Ledger composite indexes', () => {
  const firebaseConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'firebase.json'), 'utf8'));
  const indexes = JSON.parse(fs.readFileSync(path.join(projectRoot, 'firestore.indexes.json'), 'utf8'));
  assert.equal(firebaseConfig.firestore.indexes, 'firestore.indexes.json');
  const fields = indexes.indexes.map(index => index.fields.map(field =>
    `${field.fieldPath}:${field.order}`).join(','));
  assert.deepEqual(fields, [
    'sourceBranchId:ASCENDING,createdAt:DESCENDING',
    'targetBranchId:ASCENDING,createdAt:DESCENDING',
  ]);
});

test('BYOK client rejects missing key and proxy settings remain strictly key-based', async () => {
  const { context: app } = createSandbox(['js/ui-components.js', 'js/ai-service.js'], {
    APP_STATE: { isOwner: true, isStaffMember: false, readOnly: false },
    toast() {},
  });
  await assert.rejects(() => app.callAiTask('dashboardInsight', {}), /BYOK নয়|নিজের Apps Script/);
  app.saveAiByokConfig({
    proxyUrl: 'https://script.google.com/macros/s/test/exec',
    provider: 'gemini',
    apiKey: 'test-secret-key-1234567890',
  });
  assert.equal(app.getAiByokConfig().apiKey, 'test-secret-key-1234567890');
  app.clearAiByokConfig();
  await assert.rejects(() => app.callAiTask('dashboardInsight', {}), /BYOK নয়/);

  const proxy = fs.readFileSync(path.join(projectRoot, 'AiProxy.gs'), 'utf8');
  assert.doesNotMatch(proxy, /PropertiesService\.getScriptProperties\(\).*apiKey/);
  assert.doesNotMatch(proxy, /console\.log|Logger\.log/);
  assert.match(proxy, /MISSING_KEY/);
});

test('Firebase BYOK config validation rejects incomplete config and accepts isolated project config', () => {
  const { context: app } = createSandbox(['js/ui-components.js', 'js/config.js'], {
    APP_STATE: { isOwner: true, isStaffMember: false, readOnly: false },
    toast() {},
  });
  assert.equal(app.validateFirebaseByokConfig({}).valid, false);
  const config = {
    apiKey: 'AIza-test-key',
    authDomain: 'pharmacy.firebaseapp.com',
    projectId: 'pharmacy-business',
    storageBucket: 'pharmacy-business.appspot.com',
    messagingSenderId: '123456789',
    appId: '1:123456789:web:abcdef',
  };
  const accepted = app.validateFirebaseByokConfig(config);
  assert.equal(accepted.valid, true);
  app.saveFirebaseByokConfig(config);
  assert.equal(app.getFirebaseByokConfig().projectId, 'pharmacy-business');
  app.clearFirebaseByokConfig();
  assert.equal(app.getFirebaseByokConfig(), null);
});

test('Settings, AI Settings, and Firebase BYOK are strictly Owner-only', async () => {
  const staffToast = [];
  const staffSettings = createSandbox([
    'js/config.js',
    'js/utils.js',
    'js/ui-components.js',
    'js/modules/settings.js',
  ], {
    APP_STATE: { isOwner: false, isStaffMember: true, readOnly: false, isAdmin: false },
    toast(message) { staffToast.push(String(message)); },
  });
  staffSettings.document.getElementById('settings-content');
  staffSettings.context.renderSettingsModule();
  assert.match(staffSettings.elements.get('settings-content').innerHTML, /শুধু মালিক Settings/);
  await staffSettings.context.saveSettingsForm();

  const ownerSettings = createSandbox([
    'js/config.js',
    'js/utils.js',
    'js/ui-components.js',
    'js/modules/settings.js',
  ], {
    APP_STATE: { isOwner: true, isStaffMember: false, readOnly: false, isAdmin: true },
    toast() {},
  });
  ownerSettings.context.renderSettingsModule();
  assert.doesNotMatch(ownerSettings.elements.get('settings-content').innerHTML, /শুধু মালিক Settings/);

  const staffAi = createSandbox([
    'js/utils.js',
    'js/ui-components.js',
    'js/ai-service.js',
    'js/modules/ai-settings.js',
  ], {
    APP_STATE: { isOwner: false, isStaffMember: true, readOnly: false },
    toast(message) { staffToast.push(String(message)); },
  });
  staffAi.context.renderAiSettingsModule();
  assert.match(staffAi.elements.get('aiSettings-content').innerHTML, /শুধু মালিক AI BYOK/);
  assert.doesNotThrow(() => staffAi.context.clearAiByok());
  assert.equal(staffAi.context.getAiByokConfig(), null);

  const staffFirebase = createSandbox([
    'js/utils.js',
    'js/ui-components.js',
    'js/config.js',
  ], {
    APP_STATE: { isOwner: false, isStaffMember: true, readOnly: false },
    toast(message) { staffToast.push(String(message)); },
  });
  const firebaseConfig = {
    apiKey: 'AIza-test-key',
    authDomain: 'pharmacy.firebaseapp.com',
    projectId: 'pharmacy-business',
    storageBucket: 'pharmacy-business.appspot.com',
    messagingSenderId: '123456789',
    appId: '1:123456789:web:abcdef',
  };
  assert.throws(
    () => staffFirebase.context.saveFirebaseByokConfig(firebaseConfig),
    /শুধু মালিক/,
  );
  assert.throws(
    () => staffFirebase.context.clearFirebaseByokConfig(),
    /শুধু মালিক/,
  );
});

test('Platform User Management is Super Admin-only in the renderer and action handlers', async () => {
  const calls = [];
  const regularOwner = createSandbox([
    'js/config.js',
    'js/utils.js',
    'js/modules/admin.js',
  ], {
    APP_STATE: {
      isOwner: true,
      isAdmin: false,
      isSuperAdmin: false,
      currentUser: { uid: 'pharmacy-owner', email: 'owner@example.test' },
    },
    fbDb: { collection() { calls.push('read'); throw new Error('must not read platform users'); } },
    toast(message) { calls.push(message); },
  });
  await regularOwner.context.renderAdminModule();
  await regularOwner.context.approvePlatformUser('victim');
  await regularOwner.context.revokePlatformUser('victim');
  assert.match(regularOwner.elements.get('admin-content').innerHTML, /শুধু Super Admin/);
  assert.equal(calls.includes('read'), false);
  assert.ok(calls.some(message => /শুধু Super Admin/.test(String(message))));

  const rootAdmin = createSandbox([
    'js/config.js',
    'js/utils.js',
    'js/modules/admin.js',
  ], {
    APP_STATE: {
      isOwner: true,
      isAdmin: true,
      isSuperAdmin: true,
      currentUser: { uid: 'PGaJOFwnUdWn8bgq0c5JE5aXmit1' },
    },
    fbDb: {
      collection() {
        return { get: async () => ({ docs: [{
          id: 'client-1',
          data: () => ({ uid: 'client-1', email: 'client@example.test', status: 'pending' }),
        }] }) };
      },
    },
    toast() {},
  });
  await rootAdmin.context.renderAdminModule();
  assert.match(rootAdmin.elements.get('admin-content').innerHTML, /Approve/i);
});

test('platform setup and maintenance fee calculations and entitlement gating are exact', () => {
  const { context: app } = createSandbox(['js/config.js']);
  const now = Date.UTC(2026, 10, 20);
  const pending = app.platformAccessState({ status: 'pending', setupFeePaid: false }, now);
  const addOn = app.platformAccessState({
    status: 'active', setupFeePaid: true, storeSetupAssistance: true,
    validUntil: new Date(now + 86400000),
  }, now);
  assert.equal(pending.setupFee, 10000);
  assert.equal(addOn.setupFee, 15000);
  assert.equal(pending.monthlyFee, 1500);
  assert.equal(pending.active, false);
  assert.equal(app.platformAccessState({
    status: 'active', setupFeePaid: false, validUntil: new Date(now + 86400000),
  }, now).active, false);
  assert.equal(app.platformAccessState({
    status: 'active', setupFeePaid: true, validUntil: new Date(now - 1),
  }, now).reason, 'expired');
  assert.equal(app.platformAccessState({
    status: 'revoked', setupFeePaid: true, validUntil: new Date(now + 86400000),
  }, now).reason, 'revoked');
  assert.equal(addOn.active, true);

  const guardedApp = createSandbox(['js/config.js', 'js/app.js'], {
    APP_STATE: {
      isOwner: true,
      isSuperAdmin: false,
      currentUser: { uid: 'pharmacy-owner' },
      platformEntitlement: { status: 'pending', setupFeePaid: false },
      currentTab: 'settings',
    },
  });
  assert.equal(guardedApp.context.canAccessTab('pos'), false);
  assert.equal(guardedApp.context.canAccessTab('settings'), true);
  guardedApp.context.APP_STATE.platformEntitlement = {
    status: 'active', setupFeePaid: true, validUntil: new Date(Date.now() + 86400000),
  };
  assert.equal(guardedApp.context.canAccessTab('pos'), true);
  assert.equal(guardedApp.context.canAccessTab('admin'), false);
});

test('approval, revocation and payment updates use Super Admin guarded handlers', async () => {
  const writes = [];
  const admin = createSandbox([
    'js/config.js',
    'js/utils.js',
    'js/modules/admin.js',
  ], {
    APP_STATE: {
      isOwner: true,
      isAdmin: true,
      isSuperAdmin: true,
      currentUser: { uid: 'PGaJOFwnUdWn8bgq0c5JE5aXmit1' },
    },
    firebase: {
      firestore: {
        FieldValue: { serverTimestamp: () => 'server-time' },
        Timestamp: { fromDate: date => date },
      },
    },
    fbDb: {
      collection(name) {
        return {
          doc(uid) {
            return {
              name,
              uid,
              get: async () => ({ exists: true, data: () => ({ email: 'owner@example.test', status: 'pending' }) }),
              update: async patch => writes.push({ type: 'update', name, uid, patch }),
            };
          },
          get: async () => ({ docs: [] }),
        };
      },
      batch() {
        return {
          update: (ref, data) => writes.push({ type: 'batch-update', ref, data }),
          set: (ref, data) => writes.push({ type: 'batch-set', ref, data }),
          commit: async () => {},
        };
      },
    },
    prompt: () => 'billing issue',
    toast() {},
  });
  await admin.context.approvePlatformUser('client-1');
  assert.ok(writes.some(write => write.type === 'batch-update' && write.data.status === 'active'));
  await admin.context.revokePlatformUser('client-1');
  assert.ok(writes.some(write => write.type === 'update' &&
    write.patch.status === 'revoked' && write.patch.revocationNote === 'billing issue'));
  const januaryEnd = admin.context.addUtcMonth(Date.UTC(2025, 0, 31));
  assert.equal(januaryEnd.toISOString(), '2025-02-28T00:00:00.000Z');

  let paymentUpdate;
  admin.context.firebase.firestore.FieldValue.arrayUnion = (...items) => ({ arrayUnion: items });
  admin.context.fbDb.runTransaction = async callback => callback({
    get: async () => ({
      exists: true,
      data: () => ({ status: 'active', setupFeePaid: true, validUntil: new Date() }),
    }),
    update: (_ref, patch) => { paymentUpdate = patch; },
  });
  const beforePayment = Date.now();
  await admin.context.recordPlatformMonthlyPayment('client-1');
  assert.equal(paymentUpdate.status, 'active');
  assert.equal(paymentUpdate.paymentHistory.arrayUnion[0].amount, 1500);
  assert.ok(paymentUpdate.validUntil.getTime() >= beforePayment + 27 * 86400000);
});

test('setup-fee and add-on actions never clear a revoked status', async () => {
  let user = { status: 'revoked', setupFeePaid: true, storeSetupAssistance: false };
  const { context: admin } = createSandbox([
    'js/config.js',
    'js/utils.js',
    'js/modules/admin.js',
  ], {
    APP_STATE: {
      isOwner: true,
      isAdmin: true,
      isSuperAdmin: true,
      currentUser: { uid: 'PGaJOFwnUdWn8bgq0c5JE5aXmit1' },
    },
    firebase: {
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'server-time',
          arrayUnion: (...items) => ({ arrayUnion: items }),
        },
        Timestamp: { fromDate: date => date },
      },
    },
    fbDb: {
      collection() {
        return {
          doc() {
            return {
              get: async () => ({ exists: true, data: () => user }),
              update: async patch => { user = { ...user, ...patch }; },
            };
          },
          get: async () => ({ docs: [] }),
        };
      },
      runTransaction: async callback => callback({
        get: async () => ({ exists: true, data: () => user }),
        update: (_ref, patch) => { user = { ...user, ...patch }; },
      }),
    },
    toast() {},
  });
  await admin.togglePlatformStoreSetup('client', false);
  assert.equal(user.status, 'revoked');
  await admin.setPlatformSetupFeePaid('client', true);
  assert.equal(user.status, 'revoked');
  await admin.recordPlatformMonthlyPayment('client');
  assert.equal(user.status, 'revoked');
});

test('Owner Firebase config is saved locally but remains ineffective before approval and billing', () => {
  const { context: app, elements } = createSandbox([
    'js/config.js',
    'js/utils.js',
    'js/ui-components.js',
    'js/modules/settings.js',
  ], {
    APP_STATE: {
      isOwner: true,
      isStaffMember: false,
      isSuperAdmin: false,
      readOnly: true,
      currentUser: { uid: 'pharmacy-owner' },
      platformEntitlement: { status: 'pending', setupFeePaid: false },
    },
    toast() {},
  });
  app.renderSettingsModule();
  assert.match(elements.get('settings-content').innerHTML, /Approval \/ Payment Required/);
  assert.match(elements.get('settings-content').innerHTML, /Authorized domains/);
  const config = {
    apiKey: 'AIza-test-key',
    authDomain: 'pharmacy.firebaseapp.com',
    projectId: 'pharmacy-business',
    storageBucket: 'pharmacy-business.appspot.com',
    messagingSenderId: '123456789',
    appId: '1:123456789:web:abcdef',
  };
  app.saveFirebaseByokConfig(config);
  assert.equal(app.getFirebaseByokConfig().projectId, 'pharmacy-business');
  assert.equal(app.getEffectiveFirebaseConfig().projectId, 'mediworld-bd-test');
  app.APP_STATE.platformEntitlement = {
    status: 'active',
    setupFeePaid: true,
    validUntil: new Date(Date.now() + 86400000),
  };
  assert.equal(app.getEffectiveFirebaseConfig().projectId, 'pharmacy-business');
});

test('BYOK AI calls the selected provider directly first and only uses optional per-user fallback', async () => {
  const requests = [];
  const { context: app } = createSandbox(['js/ai-service.js'], {
    APP_STATE: { isOwner: true, isStaffMember: false },
    APP_CONFIG: { aiProxyFallbackUrl: 'https://script.google.com/macros/s/default/exec' },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.startsWith('https://generativelanguage.googleapis.com')) {
        return { ok: false, json: async () => ({ error: { message: 'provider unavailable' } }) };
      }
      return { ok: true, json: async () => ({ success: true, provider: 'gemini', data: { tips: ['ok'] } }) };
    },
    toast() {},
  });
  const apiKey = 'owner-only-api-key-1234567890';
  app.saveAiByokConfig({
    provider: 'gemini',
    apiKey,
    proxyUrl: 'https://script.google.com/macros/s/client-owned/exec',
  });
  const result = await app.callAiTask('dashboardInsight', { summary: {} });
  assert.equal(result.success, true);
  assert.match(requests[0].url, /generativelanguage\.googleapis\.com/);
  assert.match(requests[1].url, /client-owned\/exec/);
  assert.equal(requests[0].options.headers['x-goog-api-key'], apiKey);
  assert.equal(JSON.parse(requests[1].options.body).apiKey, apiKey);
  assert.equal(app.getAiByokConfig().apiKey, apiKey);
  app.saveAiByokConfig({ provider: 'gemini', apiKey, proxyUrl: '' });
  await app.callAiTask('dashboardInsight', { summary: {} });
  assert.match(requests[3].url, /default\/exec/);
  assert.equal(JSON.parse(requests[3].options.body).apiKey, apiKey);
  app.APP_STATE.readOnly = true;
  await assert.rejects(() => app.callAiTask('dashboardInsight', {}), /Approval \/ Payment Required/);
  assert.equal(requests.length, 4);
});

test('verified insight aggregator computes deterministic totals, stock, expiry and dues', () => {
  const { context: app } = createSandbox(['js/utils.js', 'js/modules/dashboard.js'], {
    APP_STATE: {
      medicines: [{ id: 'm1', brand: 'Napa', reorderLevel: 5 }],
      inventory: [{
        medId: 'm1', brand: 'Napa', totalStock: 3,
        costValue: 30, mrpValue: 60,
        batches: [{ batchId: 'b1', expiry: '12/2026', stock: 3, cost: 10, mrp: 20 }],
      }],
      sales: [{
        date: '2026-11-20', items: [
          { medId: 'm1', qty: 2, price: 20, costPrice: 10, discountPct: 10, lineTotal: 36 },
        ],
      }],
      expenses: [{ date: '2026-11-20', amount: 5 }],
      customers: [{ due: 100 }, { due: 50 }],
      suppliers: [{ totalPayable: 75 }],
    },
  });
  const verified = app.buildVerifiedInsightMetrics(app.APP_STATE, new Date('2026-11-20T12:00:00'));
  assert.equal(verified.today.revenue, 36);
  assert.equal(verified.today.grossProfit, 16);
  assert.equal(verified.today.netProfit, 11);
  assert.equal(verified.stock.lowStockCount, 1);
  assert.equal(verified.dues.customerDue, 150);
  assert.equal(verified.dues.supplierDue, 75);
  assert.equal(verified.invoiceLineMath.mismatchCount, 0);
  assert.ok(Array.isArray(verified.topMovers));
});

test('prescription item verification matches local inventory and rejects ambiguous or unavailable items', () => {
  const { context: app } = createSandbox(['js/utils.js', 'js/modules/pos.js'], {
    APP_STATE: {
      medicines: [
        { id: 'm1', brand: 'Napa 500', generic: 'Paracetamol', doseForm: 'Tablet', strength: '500mg' },
        { id: 'm2', brand: 'Napa Extend', generic: 'Paracetamol', doseForm: 'Tablet', strength: '665mg' },
      ],
      inventory: [{
        medId: 'm1', brand: 'Napa 500', totalStock: 10,
        batches: [{ batchId: 'b1', expiry: '12/2027', stock: 10 }],
      }, {
        medId: 'm2', brand: 'Napa Extend', totalStock: 0,
        batches: [{ batchId: 'b2', expiry: '12/2027', stock: 0 }],
      }],
    },
  });
  const verified = app.verifyPrescriptionItemAgainstInventory({
    possibleName: 'Napa',
    strength: '500mg',
  }, app.APP_STATE);
  assert.equal(verified.status, 'verified');
  assert.equal(verified.candidate.medId, 'm1');
  assert.equal(verified.stock, 10);

  const unavailable = app.verifyPrescriptionItemAgainstInventory({
    possibleName: 'Napa Extend',
  }, app.APP_STATE);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.stock, 0);
});
