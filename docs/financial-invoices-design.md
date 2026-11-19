# Financial invoices (vendor settlement invoices) — design

Status: implemented on branch `dev2`. Module: `src/modules/financial-invoices/`.
Migration: `migrations/add-financial-invoices.js` is step 5 of `npm run db:deploy-dev2`
(`src/scripts/run-dev2-deploy-migration.ts`) — run it by deploying dev2 to a database, not on its own.
Backfill: `npm run db:backfill-financial-invoices -- --from=YYYY-MM-DD` (preview by default; add
`--actor=<userId> --apply` to issue draft invoices for already-closed cycles; safe to re-run).

## Goal

Turn the live report `GET /orders/financialReport` (computed on the fly, never stored) into
persistent, auditable **vendor invoices** per billing cycle (13th / 28th) with a status
lifecycle, adjustments, per-order overrides, transfer receipt and an activity log — without
re-implementing the report's per-order accounting.

## Principles

1. **One source of accounting truth.** Per-order numbers (collection, vendor due, company due,
   fines, warehouse cost, vendor shipping) are never recomputed here. They are taken from
   `OrderRepository.getFinancialReport()` (the `fullInvoice` section) and copied into
   `financial_invoice_lines` as a snapshot. A single-order lookup uses the same function with a
   one-day custom range + `vendorId`.
2. **Snapshot, never live.** After a line is created its amounts do not follow the order.
   Order edits after invoicing cannot move invoice totals. Only explicit, audited actions
   (override, add/remove line, adjustment) change a **draft**.
3. **Frozen totals.** Once an invoice leaves `draft`, lines/adjustments are immutable (service
   guard under a row lock) and invoice-level totals are stored columns, not recalculated.
   Totals are recomputed only on draft mutations and at the `draft -> reviewed` transition.
4. **Everything audited.** Every state change / edit writes a row to
   `financial_invoice_events` in the same DB transaction (user id, timestamp, from/to, JSON
   detail). The table is append-only (no update/delete route).
5. **Vendors are read-only and scoped.** A vendor user's `vendorId` always comes from the
   token (`request.vendorId`), never from query/body. Vendors only see `reviewed` and
   `transferred` invoices of their own vendor, never drafts/frozen, never the activity log.
6. **Money.** `NUMERIC(14,2)` columns (orders use unbounded `DECIMAL`); all arithmetic in JS is
   done in integer piasters (`toCents`) and written back as 2-decimal numbers.

## Data model

All money `NUMERIC(14,2)`. Timestamps `TIMESTAMPTZ`. Table names camelCase-quoted columns, like
the rest of the schema.

### `financial_invoices`
| column | notes |
|---|---|
| id BIGSERIAL PK | |
| code VARCHAR(32) UNIQUE NULL | `INV-YYYY-NNNN`, assigned at first review from sequence `financial_invoice_code_seq`; kept across revert/re-review |
| vendorId INTEGER NOT NULL FK vendors | |
| billingDay SMALLINT CHECK IN (13,28) | |
| periodStart / periodEnd TIMESTAMPTZ | Cairo cycle bounds, from the report's `cycle` |
| status VARCHAR(16) CHECK | `draft` (UI: معلّقة), `reviewed`, `frozen`, `transferred` |
| ordersCount INT, collectionTotal, warehouseCost, vendorShippingCost, finesTotal, vendorDueTotal, companyDueTotal, adjustmentsTotal (signed), netAmount (signed) | stored totals; `netAmount = vendorDueTotal + adjustmentsTotal`. `netAmount >= 0` payable to vendor, `< 0` payable to Homix |
| reviewedAt/By, frozenAt/By, transferredAt/By | |
| frozenDurationMs BIGINT | accumulated frozen time (excluded from the days counter) |
| transferAmount NUMERIC NULL | actual transferred amount (>= 0, magnitude) |
| receiptPath, receiptName, receiptMime, receiptUploadedAt/By | transfer receipt |
| createdAt/By, updatedAt | |

Indexes: `UNIQUE (vendorId, periodEnd)` (one invoice per vendor per cycle),
`(status, periodEnd DESC)`, `(vendorId, status)`, `(transferredAt)`, unique `code`.

### `financial_invoice_lines`
One row per order on an invoice. Snapshot columns: `orderId` FK orders, `operationNumber`,
`orderNumber`, `productCode`, `paymentStatus(+Label)`, `isWarehouseDelivery`, `collectionTotal`,
`warehouseCost`, `fines`, `vendorShippingCost`, `vendorDue`, `companyDue`.
Overrides (nullable): `finesOverride`, `vendorDueOverride`, `companyDueOverride`, plus
`overrideReason`.
`state`: `included` (counted), `frozen` (shown, not counted), `deferred` (moved to a later
invoice), `removed` (permanently deleted from invoicing), with `stateReason`, `stateChangedAt/By`.

Indexes: `UNIQUE (orderId) WHERE state IN ('included','frozen','removed')` — an order is
actively in at most one invoice and a permanently removed order is never re-invoiced;
`(invoiceId, state)`; `(orderId)`.

Effective values: `fines = finesOverride ?? fines`;
`vendorDue = vendorDueOverride ?? (finesOverride == null ? vendorDue : max(vendorDue + fines - finesOverride, 0))`;
`companyDue = companyDueOverride ?? companyDue`. Collection total, warehouse cost and vendor
shipping are **not** editable (see conservative decisions).

### `financial_invoice_adjustments`
`id, invoiceId FK, label, kind ('addition'|'deduction'), amount > 0, createdAt/By, removedAt/By`.
Soft-deleted (kept for audit); only `removedAt IS NULL` rows count.

### `financial_invoice_events` (audit log, append-only)
`id, invoiceId NULL FK, vendorId NULL, action VARCHAR(48), fromStatus, toStatus, detail JSONB,
actorId FK users, createdAt`. Indexes `(createdAt DESC)`, `(invoiceId, createdAt DESC)`.
`invoiceId` is null for cross-invoice events (bank reconciliation).

## Generation (draft) from the live report

`POST /financial-invoices/generate {billingDay, referenceDate?, vendorId?}`:
1. Resolve the cycle exactly like the report (same function, `billingDay` + `referenceDate`).
   Refuse (409) if the cycle end is still in the future (Cairo) — an open cycle is not invoiced.
2. Call `getFinancialReport({billingDay, referenceDate, vendorId})`; take `fullInvoice.items`.
3. For each vendor (known vendorId only): in one transaction create the draft
   (`ON CONFLICT (vendorId, periodEnd)` -> reuse existing invoice) and insert lines for orders
   that have no active/removed line anywhere. Totals recomputed. Event `invoice.generated`.
4. Idempotent: re-running adds nothing for existing invoices unless `sync` finds new orders.

`POST /:id/sync` (draft only): re-runs the report for that vendor/cycle and appends *new*
orders (late deliveries inside the cycle) plus deferred orders from earlier invoices of the
same vendor (re-priced fresh through a one-day lookup; skipped and reported if no longer
reportable). Existing lines are never touched.

## Statuses and transitions

```
draft --review--> reviewed --transfer--> transferred
  ^                 |  ^                     |
  +----revert-------+  +------revert---------+
                    |  |
                  freeze unfreeze
                    v  |
                    frozen
```
Allowed: `draft->reviewed`, `reviewed->draft`, `reviewed->frozen`, `frozen->reviewed`,
`reviewed->transferred`, `transferred->reviewed`. Anything else is 409. `reviewed->draft` is
also refused while a receipt is attached or any transfer data exists. Bulk transitions
(`POST /bulk-transition`) apply the same rules per invoice and report per-id results; each
invoice is its own transaction.

* `draft->reviewed`: recompute totals under the lock, assign `code` if null, set `reviewedAt`.
* `reviewed->transferred`: `transferAmount` (default `abs(netAmount)`), `transferredAt`.
  The difference to the computed amount is written to the event detail.
* `transferred->reviewed`: clears transferAmount/transferredAt (old values kept in the event).
* freeze/unfreeze adjust `frozenDurationMs`; the days counter (reviewedAt .. transferredAt |
  frozenAt | now, minus frozen time) and `isOverdue` (`reviewed` and more than 3 days) are
  computed server side.

## Per-order actions (draft only)

`POST /:id/lines/:lineId/action`:
* `defer` -> state `deferred` (picked up by the vendor's next invoice on generate/sync)
* `freeze` / `unfreeze` -> `frozen` (visible, not counted) / back to `included`
* `delete` -> `removed` (permanent; never re-invoiced)
* `restore` -> `deferred|frozen -> included`
`POST /:id/lines {orderId}` adds a delivered order of the same vendor that is not on any
active invoice (amounts via the report). `PATCH /:id/lines/:lineId` sets/clears overrides.

## Receipt upload

Reuses `config/fileUploadMiddleware.js` (`fileUploadMiddleware("financial-receipts")`, multer
memory storage, jpeg/png/gif/pdf, 16 MB, unique stored name). Only allowed on a `transferred`
invoice. The API never returns the storage path; `GET /:id/receipt` streams the file after the
same scoping check. `app.ts` blocks the `/uploads/financial-receipts` static prefix so the file
is not reachable without a token.

## Permissions (no new keys)

| action | permission |
|---|---|
| list/get/lines/document/receipt view | `finance_view` (vendors: scoped, reviewed/transferred only) |
| activity log, reconciliation summary | `finance_view`, non-vendor |
| generate, sync, transitions, adjustments, line edits/actions, add order, receipt upload/delete, reconciliation record | `finance_settle`, non-vendor (`isNotVendor`) |
| Excel exports | existing `finance_export` on existing endpoints |

## API (mounted at `/financial-invoices`)

```
GET    /                         list (filters, paging)
GET    /lines                    invoiced orders view
GET    /activity                 audit log (non-vendor)
GET    /reconciliation           system total of transferred invoices in range
POST   /reconciliation           record bank total + difference in the audit log
POST   /generate
POST   /bulk-transition
GET    /:id                      detail (lines, adjustments, events for non-vendors)
POST   /:id/sync
POST   /:id/transition
POST   /:id/adjustments          DELETE /:id/adjustments/:adjustmentId
POST   /:id/lines                add order        GET /:id/order-candidates?q=
PATCH  /:id/lines/:lineId        overrides
POST   /:id/lines/:lineId/action
POST   /:id/receipt              GET /:id/receipt        DELETE /:id/receipt
```

## Amounts: formulas and "company due" (المستحق لهوميكس)

Per order (the live report `getFinancialReport` is the single source; invoice lines are snapshots of it):

| Order type | vendorDue | companyDue | companyDueKind |
|---|---|---|---|
| Homix delivered (`deliveryBy` = Homix, delivered or not yet) | `max(0, cost − fines)` | `collection − cost` (not clamped) | `margin` |
| Vendor delivered | `max(max(cost + vendorShipping − toBeCollected, 0) − fines, 0)` | `max(toBeCollected − cost − vendorShipping, 0)` | `vendorOwes` |

- The UI and the Excel export show **one** column, «المستحق لهوميكس» (`companyDue`): what Homix is entitled to — its margin on warehouse deliveries (collection − cost), or what the vendor owes Homix on vendor deliveries; both are amounts due to Homix, so one label fits. `companyDueKind` (`margin` / `vendorOwes`) and the `homixMargin` / `vendorOwes` API fields are kept for later use, but no label depends on them.
- **Company due never enters the invoice net**: `net = Σ vendorDue (effective) + adjustments (addition +, deduction −)`; due party = vendor when `net >= 0`, otherwise Homix with the absolute value. There is no combined total («الإجمالي الكلي» was removed: it subtracted fines twice and mixed unrelated things).
- Report API: each order has `companyDueKind`; each vendor row and section summary keeps `companyDue` (total, backward compatible) and adds `homixMargin` and `vendorOwes`; top `summary` has the same two. The Excel export (section sheets, totals row, summary sheet) has the single column «المستحق لهوميكس» = `companyDue`.
- Invoice lines store the kind in `financial_invoice_lines."companyDueKind"` (nullable, CHECK in `margin`, `vendorOwes`), set at snapshot/refresh time; existing lines are backfilled idempotently from `orders."deliveryBy"` (Homix → `margin`, otherwise `vendorOwes`). A NULL kind is shown as `margin` for warehouse deliveries and `vendorOwes` otherwise.
- Effective line values: `cost = warehouseCostOverride ?? snapshot`, `collection = collectionOverride ?? snapshot`, `vendorDue = vendorDueOverride ?? max(0, cost − fines)`, `companyDue = companyDueOverride ?? collection − cost` (overrides always win, whatever the kind; legacy snapshots keep their own fines-delta logic).
- Vendors are never shown override values, original values or reasons.

## Conservative decisions (mockup ambiguity or conflict with accounting)

1. Custom date range produces **no invoice**; only 13/28 cycles are invoiced. Custom range
   stays a live report view (the report already supports it).
2. Open (not yet closed) cycles cannot be generated.
3. Cost (`warehouseCost`) and collection are not editable per order; only fines, vendor due and
   company due. Mockup edited "cost"; changing it would break reconciliation with orders.
4. Fines override adjusts vendor due by the difference (floored at 0, like the report).
5. Net can be negative (payable to Homix) and is **not** clamped; mockup's per-order
   `max(0, ...)` is already applied by the report per order.
6. Vendors never see drafts or frozen invoices.
7. Billable orders are exactly what the live report counts (status `DELIVERED`); isolated in
   `invoice.eligibility.ts`.
8. Reconciliation is recorded in the audit log only (no table).
9. PDF = browser print of the invoice document page (no server PDF).
