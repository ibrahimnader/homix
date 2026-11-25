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
| ordersCount INT, collectionTotal, warehouseCost, vendorShippingCost, finesTotal, vendorDueTotal, companyDueTotal, adjustmentsTotal (signed), netAmount (signed) | stored totals; `netAmount = vendorDueTotal − companyDueTotal − finesTotal + adjustmentsTotal` (signed). `> 0` payable to the vendor, `< 0` payable to Homix, `0` settled |
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

Effective values: see «Amounts: formulas» (fines never alter the dues; `vendorDueOverride` is the gross due).

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
| Excel exports | existing `finance_export` on existing endpoints; `GET /orders/financialReport/export` now reflects invoice overrides (below) |

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
POST   /consolidate              merge >= 2 open invoices of one vendor (finance_settle, staff only)
POST   /:id/unconsolidate        undo a live consolidated invoice
GET    /:id/receipts             POST /:id/receipts (multi-file)   GET|DELETE /:id/receipts/:receiptId
POST   /:id/receipt              GET /:id/receipt        DELETE /:id/receipt   (deprecated aliases: add / first / remove first)
```

## Amounts: formulas (reference model, owner decision Nov 2026)

Per counted line (the live report `getFinancialReport` is the single source; invoice lines are snapshots of it):

| Order type | «مستحق البائع» (`vendorDue`, GROSS) | «مستحق هوميكس» (`companyDue`) | `companyDueKind` |
|---|---|---|---|
| Homix delivery (`deliveryBy` = Homix, delivered or not yet) | `cost` (before fines) | `0` | `margin` |
| Vendor delivery | `balance < 0 ? −balance : 0` | `balance > 0 ? balance : 0` | `vendorOwes` |

with `balance = collection − cost − vendorShipping` for vendor deliveries (`calculateVendorDeliverySettlement`; vendor shipping «شحن البائع» is applied once per order, exactly as before). A line never has both dues. **Fines are their own column** (`الغرامات`), never netted into a due and applied to every line (also vendor deliveries where the vendor owes Homix: fines increase his debt). The old rule «fines ignored when balance > 0» and the per-line floor `max(0, cost − fines)` are removed.

```
net = Σ vendorDue (gross) − Σ companyDue (vendorOwes lines) − Σ fines + Σ manual adjustments (addition +, deduction −)
```

- **Net is signed**: `net > 0` Homix owes the vendor (`dueParty = vendor`), `net < 0` the vendor owes Homix (`dueParty = homix`), `net = 0` settled (`dueParty = null`). `netAmount` is stored signed; `transferAmount` stays an absolute amount (default `abs(net)`), the direction comes from the sign of the net. No DB constraint forbids a negative `netAmount`/line amounts (only `transferAmount >= 0`), so no migration is needed.
- State machine unchanged (review blocked until the cycle ends, etc.). The *transferred* step label follows the direction: `net > 0` «تم التحويل للبائع», `net < 0` «تم استلام التحويل من البائع» (`invoiceStatusLabel`), `net = 0` «تم التحويل». Direction label of the net: «صافي المستحق للبائع» / «صافي المستحق لهوميكس» / «لا يوجد مستحق».
- «مستحق هوميكس» exists only on vendor deliveries (`vendorOwes`); Homix-delivered lines show «—» and contribute 0 to every row/section/top total and card. The Homix margin (`collection − cost`) is never displayed (`homixMargin` is informational in the report only).
- Report API: rows, section summaries and the top summary carry a signed `netAmount = vendorDue − companyDue − fines` (field names otherwise unchanged; `companyDue === vendorOwes`). Invoice totals: `computeTotals` → `vendorDueTotal` (gross), `companyDueTotal` (included `vendorOwes` lines only; a NULL kind falls back to `isWarehouseDelivery`), `finesTotal`, `adjustmentsTotal`, `netAmount` as above. Stored totals/lines of invoices created before this change keep their old values until `refreshDraft` / `db:refresh-old-invoices` recomputes them.
- Tabs partition the delivered orders of the cycle by WHO delivered (`deliveryBy`): «تسليمات المخزن» = `deliveryBy` Homix, «تسليمات البائع» = everything else, and «الفاتورة الشاملة» = both, so the two tabs always add up to the comprehensive one. The shipment status is not part of the rule (many delivered orders keep a stale/blank shipment status, which used to drop them from the warehouse tab only: 29 vs 30 for one vendor). `isWarehouseDelivery` on a line therefore means `deliveryBy = Homix`.
- Effective line values: `cost = warehouseCostOverride ?? snapshot`, `collection = collectionOverride ?? snapshot`, `shipping = vendorShippingCostOverride ?? snapshot`, `fines = finesOverride ?? snapshot`; `vendorDue = vendorDueOverride ?? derived` (an override is the GROSS vendor due), `companyDue = companyDueOverride ?? derived`. Derived = the snapshot (the report's value); a cost override on a Homix delivery re-derives `vendorDue = cost`; a cost/collection/shipping override on a vendor delivery re-settles `balance`. A fines override only changes the fines column. Overrides always win whatever the kind; an override on a Homix-delivered line's `companyDue` is kept but never summed.
- Invoice lines store the kind in `financial_invoice_lines."companyDueKind"` (nullable, CHECK in `margin`, `vendorOwes`), backfilled idempotently from `orders."deliveryBy"`.
- Vendors are never shown override values, original values or reasons.
- **Vendor shipping override (شحن البائع)**: `vendorShippingCostOverride` (nullable `NUMERIC(14,2)`, CHECK `>= 0`) replaces the system `vendorShippingCost` of that line; draft only (409 otherwise), audited in `line.overridden`, refused (409) on Homix-delivered lines. It feeds the vendor-delivery re-settlement above and the invoice total `vendorShippingCost`. Vendors receive only the effective value.

### Worked examples

| Case | Lines | vendorDue | companyDue | fines | net |
|---|---|---|---|---|---|
| All warehouse with fines | costs 1200 (fine 100) + 500 (fine 700) | 1700 | 0 | 800 | **+900** (= Σcost − fines) |
| Mixed | Homix 1200 (fine 100) + vendor balance +350 (fine 20) | 1200 | 350 | 120 | **+730** |
| Vendor owes Homix + fines | vendor balance +350, fine 50 | 0 | 350 | 50 | **−400** (the vendor owes Homix) |
| Net zero | Homix 100 + vendor balance +100 | 100 | 100 | 0 | **0** (settled) |

### Statements and printed documents (bank block by direction)

The printed equation always adds up exactly. Cards: «مستحق البائع» (gross), «مستحق هوميكس», «الغرامات», «صافي المستحق» (labelled by sign). Totals box: when `net >= 0` — مستحق البائع (إجمالي) − مستحق هوميكس − الغرامات = الصافي; when `net < 0` — مستحق هوميكس + الغرامات − مستحق البائع (إجمالي) = الصافي (absolute value shown, the label says to whom). Transfer block by the sign of the net: `net > 0` → «بيانات حساب البائع — <name>» with the vendor's bank data and «سيتم تحويل الصافي المستحق للبائع على الحساب الموضح وفق دورة السداد.» (or «لم تُسجَّل بيانات بنكية لهذا البائع بعد.»); `net < 0` → «بيانات التحويل البنكي — هوميكس» with «يُرجى تحويل الصافي المستحق لهوميكس وإرسال صورة إيصال التحويل.»; `net = 0` → no bank block.

The vendor's bank data (`users.bankName / bankAccountHolderName / bankAccountNumber / walletNumber / instaPayNumber` of the user row with `users.vendorId` = the vendor; an active user with data wins) is exposed as `vendorBank { bankName, accountHolder, accountNumber, walletNumber, instaPayNumber } | null` **only** to staff holding `finance_settle` (and admins) and to the vendor himself for his own invoices: on `GET /financial-invoices/:id` and on the seller rows of `GET /orders/financialReport`. Other staff get the key omitted; another vendor gets 404 on a foreign invoice and never sees another vendor's row.

## Conservative decisions (mockup ambiguity or conflict with accounting)

1. Custom date range produces **no invoice**; only 13/28 cycles are invoiced. Custom range
   stays a live report view (the report already supports it).
2. Open (not yet closed) cycles cannot be generated.
3. Cost (`warehouseCost`) and collection are not editable per order in the UI flow of the mockup; fines, vendor due, company due, cost, collection and vendor shipping carry overrides (see formulas). Mockup edited "cost"; changing it would break reconciliation with orders.
4. A fines override only changes the fines column (fines are subtracted once from the net).
5. Net can be negative (the vendor owes Homix) and is **not** clamped; no per-line floor exists any more.
6. Vendors never see drafts or frozen invoices.
7. Billable orders are exactly what the live report counts (status `DELIVERED`); isolated in
   `invoice.eligibility.ts`.
8. Reconciliation is recorded in the audit log only (no table).
9. PDF = browser print of the invoice document page (no server PDF).

## Excel export reflects invoice overrides

`GET /orders/financialReport/export` is built from the live report with the cycle's invoices laid over it, the backend twin of the frontend `liveOverlay.ts` (`invoice.export-overlay.ts`, fed by `InvoiceService.effectiveReport`). One implementation serves the toolbar «Excel تصدير» button and the per-vendor export buttons of the three tabs (same endpoint, `vendorId` narrows it).

- Cycle lookup: billing cycles use the invoices whose `periodEnd` is the report's cycle end (Cairo day), exactly like `GET /financial-invoices/cycle`. Custom date ranges have no invoices and stay live. A vendor+cycle with no invoice also stays live.
- Effective values: per line `fines`, `vendorDue`, `companyDue` always follow the invoice (override-aware, `effectiveLineCents`); `collection`, `warehouseCost` and vendor shipping follow it only when overridden (the screen rule). Deferred / frozen / removed lines and orders missing from the invoice are not counted; counted lines outside the cycle window are added to the matching tab. Row, section and top totals move by the same delta as the screen KPIs (`vendorDue`, `companyDue`, `fines`, `netAmount`, collection, cost, shipping, counts). The header stays «المستحق لهوميكس».
- Sheets: `summary`, `full-invoice` (columns: مستحق البائع / المستحق لهوميكس / الغرامات / manual adjustments / «الصافي» signed + «اتجاه الصافي» label, vendor shipping, invoice code and status; every section sheet has «الصافي» + «اتجاه الصافي»; the `lines` sheet has a per-line «الصافي»), `vendor-deliveries`, `warehouse-deliveries`, `lines` (order level, effective values, line state, and a notes column «تعديل يدوي: <fields> — <reason>»; edited cells are also filled yellow) and `adjustments` (live adjustments, additions positive / deductions negative).
- Vendors: forced to their own reviewed / transferred invoices (drafts and frozen invoices are not visible, so the export is live for those), counted lines only, effective values only. No override flags, notes, reasons, original values or uncounted lines are written to their workbook.


## Consolidated invoice («فاتورة شاملة»)

A vendor often owes Homix in one cycle and is owed in another. `POST /financial-invoices/consolidate {invoiceIds}` merges >= 2 invoices of ONE vendor, each `draft` or `reviewed`, standard (not consolidated / not already merged) and without receipt or transfer data (otherwise 409 with an Arabic reason), into one invoice so the amounts offset in a single signed net (same formula as always: Σ vendor due − Σ Homix due − Σ fines + adjustments).

- New invoice: `kind = 'consolidated'`, status `draft`, code `<base>-ALL` (`-ALL2` … when taken; base = the latest source's code, or a fresh sequence number when it has none), period = the latest source cycle. Review follows the existing rule (only after that cycle ended).
- Lines and adjustments MOVE (orders stay unique, no copies); each keeps its state/overrides and `sourceInvoiceId` (columns on `financial_invoice_lines` and `financial_invoice_adjustments`).
- Sources become status `consolidated` with `mergedIntoId`, `mergedCode` and `preMergeStatus` (their stored totals stay as the merge-time snapshot). They are hidden from the archive lists (list excludes `consolidated`/`cancelled` unless asked), from the errors check, and shown in the consolidated invoice's detail as `sources` («الفواتير المجمّعة (n)»). The live cycle view still shows them (status `consolidated`, their moved lines attributed to their source cycle); the consolidated invoice itself is excluded from the cycle overlay so a vendor+cycle never has two entries.
- One STANDARD invoice per (vendor, cycle): the unique index is now partial (`WHERE kind = 'standard'`) because a consolidated invoice shares the latest source's cycle.
- Concurrency: one transaction, `SELECT … FOR UPDATE` on all the sources (ascending id) before anything is written; a second merge/review/transfer of the same invoices re-reads the locked rows and gets 409.
- Undo `POST /:id/unconsolidate` (draft/reviewed, no receipt/transfer): lines/adjustments go back to their source (rows added to the consolidated invoice itself go to the latest source), sources get `preMergeStatus` back and their totals recomputed, the consolidated invoice becomes `cancelled` (kept for the audit trail, code freed). Audit: `invoice.consolidated` / `invoice.unconsolidated` on the consolidated invoice and on every source.
- Vendors cannot merge or undo (403). They see a consolidated invoice only once it is reviewed/transferred, like any invoice.

## Several transfer receipts per invoice

Table `financial_invoice_receipts (id, invoiceId, path, name, mime, size, uploadedBy, uploadedAt, deletedAt, deletedBy)`. The legacy single receipt (`receiptPath` & friends) is backfilled as the first item by the migration and, until then, is still read as the first item (id 0). Add (up to 10 per request, 20 per invoice) and remove require staff with `finance_settle` and a `transferred` invoice (same rule the single receipt had); a refused upload deletes the files the middleware already stored. `reviewed -> draft` is refused while ANY receipt exists. Vendors list/download receipts only of their own transferred invoices. The frontend «تنزيل الفاتورة + الإيصالات (PDF واحد)» appends all receipts sequentially (images as A4 pages, PDFs copied), skipping and naming a broken one, with the invoice-only fallback.
