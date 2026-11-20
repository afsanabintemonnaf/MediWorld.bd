# Slice 3: Transfers, Accounting, Reports & Maintenance

## Implemented

- Stock branch transfer uses one Firestore transaction: source batch stock decreases, target batch stock merges/preserves batch, expiry, cost and MRP.
- Transfer ledger and audit records store source, target, actor UID, timestamps and transfer lines.
- Optional cash/bank financial side ledger is written to source and target branches.
- Accounting separates:
  - sales revenue
  - COGS
  - gross profit
  - operating expenses
  - net profit
  - cash/bank movement
  - receivables
  - payables
  - inventory valuation
- Owner can view consolidated or one branch in accounts and daily report.
- Staff remains limited to assigned branches.
- Daily report supports day/week/month/custom dates and print.
- Report includes POS sales, purchases, returns, customer collections, supplier payments, expenses and transfer entries.
- Maintenance tools include stock reconciliation, expired/damaged/loss write-off, duplicate medicine check and export/sync retry.

## Transfer authorization

- Owner may transfer between active branches.
- Staff requires explicit `permissions.transfer` or `permissions.stockTransfer`, plus assignment to both source and target branch.
- Rules allow only positive completed stock transfer records with source != target and batch line list.
- Audit and transfer update/delete remain prohibited.

## Remaining risks

- Consolidated report currently reads collection documents and may require composite indexes for combined date/branch queries.
- Daily transfer query depends on timestamp and source branch filtering; large transfer history should use capped/paginated queries in a later slice.
- Accounting balance sheet/cash bank reconciliation is transaction-based; opening balance backfill must be reviewed by Owner.
- Maintenance `apiSetInventoryRow`/stock write-off needs explicit negative/expired stock validation and review in live QA.
- Legacy `users/{uid}` AI/email preference and settings paths remain unrelated SaaS/UI residue; they do not replace branch-scoped pharmacy collections.
