# Slice 2: Branch-Scoped Pharmacy Core

## Implemented

- Owner সব active branch দেখতে ও switch করতে পারে।
- Staff শুধু `staff/{uid}.assignedBranchIds`-এর branch দেখতে ও switch করতে পারে।
- Catalog, inventory, POS, purchase, customer, supplier, payments এবং return data `/branches/{branchId}/...` collection-এ থাকে।
- POS এবং purchase record-এ `branchId` ও `createdByUid` থাকে।
- Customer/supplier payment record-এ branch ও actor metadata থাকে।
- Purchase batch record-এ `batchNumber`, expiry, purchase/selling/MRP price ও stock থাকে।
- POS এবং server transaction FEFO expiry sort দিয়ে earliest-expiry batch থেকে deduct করে।
- Existing low-stock এবং expiry-alert dashboard retained।
- Receipt print/PNG/WhatsApp flow retained.

## Main files

- `js/auth.js`
- `js/app.js`
- `js/api-client.js`
- `js/state.js`
- `js/modules/pos.js`
- `js/modules/purchase.js`
- `js/modules/inventory.js`
- `js/modules/returns.js`
- `js/modules/customers.js`
- `js/modules/suppliers.js`
- `index.html`
- `firestore.rules`

## Remaining risk

- Existing data remains under legacy `users/{uid}/...`; active branch migration/backfill script is required before production cutover.
- Staff should not be allowed to change `branchId` on existing records.
- Barcode field and physical barcode generation were not added in this slice.
- Browser local mirror is optimistic; Firestore transaction is authoritative.
