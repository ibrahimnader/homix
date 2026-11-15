/**
 * One-shot database step for deploying `dev2` on top of a `refactor` database.
 *
 * Everything the database needs that `dev2` adds over `refactor` lives here, so a
 * deploy is a single command:
 *
 *   npm run db:deploy-dev2                # applies
 *   npm run db:deploy-dev2 -- --dry-run   # runs it all, then rolls back
 *
 * Safe to run more than once: every statement is IF NOT EXISTS / idempotent, and
 * all schema changes run in ONE transaction, so a failure leaves the schema as it
 * was. Take a backup first anyway.
 *
 * What it contains (source migration in brackets):
 *   0. orders.scheduledDeliveryDate, orders.accountsHiddenAt  [add-scheduled-delivery-date,
 *                                                         add-accounts-hidden-at — no other deploy
 *                                                         script creates them]
 *   1. orders.confirmationStatus                         [add-order-confirmation-status]
 *   2. Warehouse receiving: orders.warehouse* columns,
 *      receipt-number sequence, receipt movements table  [add-warehouse-receiving-columns,
 *                                                         add-warehouse-receipt-movements]
 *   3. shipment_reassignments                            [add-shipment-reassignments]
 *   4. fine_rules / fine_records (+ soft delete)         [add-fine-rules, add-fine-rules-deleted-at]
 *   5. Vendor settlement invoices (4 tables + sequence)  [add-financial-invoices]
 *   6. Permission merge for existing users: new keys
 *      (ship_receipts_view, customers_create,
 *      orders_edit_financials) get their role defaults;
 *      keys a user already has are never changed.        [same as db:backfill-user-permissions]
 *
 * Deliberately NOT here (nothing to run):
 *   - New order / shipment / manufacture status ids: stored as plain integers, no
 *     ENUM or CHECK constraint on those columns.
 *   - Seller chat (uses the existing `notes` table) and its quick replies (existing
 *     `managedOptions` table, rows are created on first save).
 *   - Customer management: schema/validation changes only.
 *
 * Optional, separate, and writes data — run it only after checking its dry run:
 *   npm run db:backfill-order-governorate            # preview
 *   npm run db:backfill-order-governorate -- --apply # fills blank governorates only
 */
import { QueryTypes, type Transaction } from "sequelize";

import { normalizePermissions, toPlainRecord, toText } from "../../app/modules/user/user.helpers";
import { connectToDb, sequelize } from "../infrastructure/database";

const User = require("../../app/modules/user/user.model") as {
  findAll: (input?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
};

const isDryRun = process.argv.includes("--dry-run");

/**
 * Tables the new objects reference, plus `cronRuns` (created by the refactor deploy
 * migration; the daily fines job needs it). All exist in any refactor database.
 */
const REQUIRED_TABLES = ["orders", "users", "vendors", "shipmentInventoryItems", "cronRuns"] as const;

class DryRunRollback extends Error {
  constructor() {
    super("dry-run");
    this.name = "DryRunRollback";
  }
}

const log = (message: string): void => {
  // eslint-disable-next-line no-console
  console.log(message);
};

const tableExists = async (name: string, transaction: Transaction): Promise<boolean> => {
  const rows = await sequelize.query<{ found: string | null }>(
    "SELECT to_regclass(:name) AS found",
    { replacements: { name: `public."${name}"` }, transaction, type: QueryTypes.SELECT },
  );
  return Boolean(rows[0]?.found);
};

const assertPrerequisites = async (transaction: Transaction): Promise<void> => {
  const missing: string[] = [];
  for (const table of REQUIRED_TABLES) {
    if (!(await tableExists(table, transaction))) missing.push(table);
  }
  if (missing.length) {
    throw new Error(
      `Missing base tables: ${missing.join(", ")}. This script expects a database that already ran the refactor deploy migration (npm run db:deploy-refactor).`,
    );
  }
};

type Step = { name: string; statements: string[] };

const STEPS: Step[] = [
  {
    name: "orders.scheduledDeliveryDate and orders.accountsHiddenAt",
    statements: [
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "scheduledDeliveryDate" TIMESTAMPTZ`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "accountsHiddenAt" TIMESTAMPTZ`,
    ],
  },
  {
    name: "orders.confirmationStatus",
    statements: [
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "confirmationStatus" INTEGER`,
    ],
  },
  {
    name: "warehouse receiving (orders columns, receipt number sequence, movements)",
    statements: [
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "warehouseReceivedBy" INTEGER REFERENCES users(id)`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "warehouseSenderName" VARCHAR(255)`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "warehouseReceiptNotes" TEXT`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "warehouseReceiptNumber" VARCHAR(255)`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "warehouseReceiptIssuedAt" TIMESTAMPTZ`,
      `CREATE INDEX IF NOT EXISTS orders_warehouse_receipt_number_idx ON orders ("warehouseReceiptNumber")`,
      // Backs the RCV-YYYY-NNNN document numbers.
      `CREATE SEQUENCE IF NOT EXISTS warehouse_receipt_number_seq`,
      `CREATE TABLE IF NOT EXISTS warehouse_receipt_movements (
        id BIGSERIAL PRIMARY KEY,
        "orderId" INTEGER NOT NULL REFERENCES orders(id),
        "inventoryItemId" INTEGER NOT NULL REFERENCES "shipmentInventoryItems"(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        "previousStatus" INTEGER,
        "previousShipmentStatus" INTEGER,
        "previousDeliveryBy" INTEGER,
        "previousShippedFromInventory" BOOLEAN,
        "previousShippingReceiveDate" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "cancelledAt" TIMESTAMPTZ
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS warehouse_receipt_movements_active_idx ON warehouse_receipt_movements ("orderId") WHERE "cancelledAt" IS NULL`,
    ],
  },
  {
    name: "shipment_reassignments",
    statements: [
      `CREATE TABLE IF NOT EXISTS shipment_reassignments (
        id BIGSERIAL PRIMARY KEY,
        "sourceOrderId" INTEGER NOT NULL REFERENCES orders(id),
        "targetOrderId" INTEGER NOT NULL REFERENCES orders(id),
        reason TEXT NOT NULL,
        notes TEXT,
        "keepOldPending" BOOLEAN NOT NULL DEFAULT FALSE,
        "createdBy" INTEGER REFERENCES users(id),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT shipment_reassignments_distinct_orders CHECK ("sourceOrderId" <> "targetOrderId"),
        CONSTRAINT shipment_reassignments_source_unique UNIQUE ("sourceOrderId"),
        CONSTRAINT shipment_reassignments_target_unique UNIQUE ("targetOrderId")
      )`,
      `CREATE INDEX IF NOT EXISTS shipment_reassignments_created_idx ON shipment_reassignments ("createdAt" DESC)`,
    ],
  },
  {
    name: "fine rules and fine records (with soft delete)",
    statements: [
      `CREATE TABLE IF NOT EXISTS fine_rules (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        trigger TEXT NOT NULL CHECK (trigger IN ('delivery_delay','late_cancellation','customer_refusal','manual')),
        "amountType" TEXT NOT NULL CHECK ("amountType" IN ('fixed','percent')),
        amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
        frequency TEXT NOT NULL CHECK (frequency IN ('once','daily')),
        basis TEXT NOT NULL CHECK (basis IN ('subtotal','total','commission','cost')),
        "graceHours" INTEGER NOT NULL DEFAULT 0 CHECK ("graceHours" >= 0),
        "maxAmount" NUMERIC(14,2) CHECK ("maxAmount" >= 0),
        "effectiveFrom" TIMESTAMPTZ NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      // Added after the first version of the table shipped; covers databases that already have it.
      `ALTER TABLE fine_rules ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ`,
      `CREATE INDEX IF NOT EXISTS fine_rules_not_deleted_idx ON fine_rules (id) WHERE "deletedAt" IS NULL`,
      `CREATE TABLE IF NOT EXISTS fine_records (
        id BIGSERIAL PRIMARY KEY,
        "ruleId" BIGINT NOT NULL REFERENCES fine_rules(id),
        "orderId" INTEGER NOT NULL REFERENCES orders(id),
        amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
        "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "waivedAt" TIMESTAMPTZ,
        "waiveReason" TEXT,
        "waivedBy" INTEGER REFERENCES users(id),
        CONSTRAINT fine_records_unique_rule_order UNIQUE ("ruleId", "orderId")
      )`,
      `CREATE INDEX IF NOT EXISTS fine_records_applied_idx ON fine_records ("appliedAt" DESC)`,
    ],
  },
  {
    name: "vendor settlement invoices",
    statements: [
      `CREATE SEQUENCE IF NOT EXISTS financial_invoice_code_seq`,
      `CREATE TABLE IF NOT EXISTS financial_invoices (
        id BIGSERIAL PRIMARY KEY,
        code VARCHAR(32),
        "vendorId" INTEGER NOT NULL REFERENCES vendors(id),
        "billingDay" SMALLINT NOT NULL,
        "periodStart" TIMESTAMPTZ NOT NULL,
        "periodEnd" TIMESTAMPTZ NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'draft',
        "ordersCount" INTEGER NOT NULL DEFAULT 0,
        "collectionTotal" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "warehouseCost" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "vendorShippingCost" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "finesTotal" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "vendorDueTotal" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "companyDueTotal" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "adjustmentsTotal" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "netAmount" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "reviewedAt" TIMESTAMPTZ,
        "reviewedBy" INTEGER REFERENCES users(id),
        "frozenAt" TIMESTAMPTZ,
        "frozenBy" INTEGER REFERENCES users(id),
        "frozenDurationMs" BIGINT NOT NULL DEFAULT 0,
        "transferredAt" TIMESTAMPTZ,
        "transferredBy" INTEGER REFERENCES users(id),
        "transferAmount" NUMERIC(14,2),
        "receiptPath" VARCHAR(512),
        "receiptName" VARCHAR(255),
        "receiptMime" VARCHAR(100),
        "receiptUploadedAt" TIMESTAMPTZ,
        "receiptUploadedBy" INTEGER REFERENCES users(id),
        "createdBy" INTEGER REFERENCES users(id),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT financial_invoices_billing_day_chk CHECK ("billingDay" IN (13, 28)),
        CONSTRAINT financial_invoices_status_chk CHECK (status IN ('draft', 'reviewed', 'frozen', 'transferred')),
        CONSTRAINT financial_invoices_transfer_amount_chk CHECK ("transferAmount" IS NULL OR "transferAmount" >= 0),
        CONSTRAINT financial_invoices_period_chk CHECK ("periodEnd" > "periodStart")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS financial_invoices_code_uq ON financial_invoices (code) WHERE code IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS financial_invoices_vendor_period_uq ON financial_invoices ("vendorId", "periodEnd")`,
      `CREATE INDEX IF NOT EXISTS financial_invoices_status_period_idx ON financial_invoices (status, "periodEnd" DESC)`,
      `CREATE INDEX IF NOT EXISTS financial_invoices_vendor_status_idx ON financial_invoices ("vendorId", status)`,
      `CREATE INDEX IF NOT EXISTS financial_invoices_transferred_idx ON financial_invoices ("transferredAt") WHERE "transferredAt" IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS financial_invoice_lines (
        id BIGSERIAL PRIMARY KEY,
        "invoiceId" BIGINT NOT NULL REFERENCES financial_invoices(id),
        "orderId" INTEGER NOT NULL REFERENCES orders(id),
        "operationNumber" VARCHAR(100) NOT NULL DEFAULT '',
        "orderNumber" VARCHAR(100) NOT NULL DEFAULT '',
        "productCode" VARCHAR(100) NOT NULL DEFAULT '',
        "paymentStatus" INTEGER,
        "paymentStatusLabel" VARCHAR(100) NOT NULL DEFAULT '',
        "isWarehouseDelivery" BOOLEAN NOT NULL DEFAULT FALSE,
        "collectionTotal" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "warehouseCost" NUMERIC(14,2) NOT NULL DEFAULT 0,
        fines NUMERIC(14,2) NOT NULL DEFAULT 0,
        "vendorShippingCost" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "vendorDue" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "companyDue" NUMERIC(14,2) NOT NULL DEFAULT 0,
        "finesOverride" NUMERIC(14,2),
        "vendorDueOverride" NUMERIC(14,2),
        "companyDueOverride" NUMERIC(14,2),
        "overrideReason" VARCHAR(500),
        state VARCHAR(16) NOT NULL DEFAULT 'included',
        "stateReason" VARCHAR(500),
        "stateChangedAt" TIMESTAMPTZ,
        "stateChangedBy" INTEGER REFERENCES users(id),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT financial_invoice_lines_state_chk CHECK (state IN ('included', 'frozen', 'deferred', 'removed')),
        CONSTRAINT financial_invoice_lines_overrides_chk CHECK (
          ("finesOverride" IS NULL OR "finesOverride" >= 0)
          AND ("vendorDueOverride" IS NULL OR "vendorDueOverride" >= 0)
          AND ("companyDueOverride" IS NULL OR "companyDueOverride" >= 0)
        )
      )`,
      // An order is actively on at most one invoice; a removed order is never re-invoiced.
      `CREATE UNIQUE INDEX IF NOT EXISTS financial_invoice_lines_order_active_uq
        ON financial_invoice_lines ("orderId") WHERE state IN ('included', 'frozen', 'removed')`,
      `CREATE INDEX IF NOT EXISTS financial_invoice_lines_invoice_state_idx ON financial_invoice_lines ("invoiceId", state)`,
      `CREATE INDEX IF NOT EXISTS financial_invoice_lines_order_idx ON financial_invoice_lines ("orderId")`,
      // invoice-level overrides of the order's cost / collection (the order itself is never touched)
      `ALTER TABLE financial_invoice_lines ADD COLUMN IF NOT EXISTS "warehouseCostOverride" NUMERIC(14,2)`,
      `ALTER TABLE financial_invoice_lines ADD COLUMN IF NOT EXISTS "collectionOverride" NUMERIC(14,2)`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_invoice_lines_cost_overrides_chk') THEN
          ALTER TABLE financial_invoice_lines ADD CONSTRAINT financial_invoice_lines_cost_overrides_chk
            CHECK (("warehouseCostOverride" IS NULL OR "warehouseCostOverride" >= 0) AND ("collectionOverride" IS NULL OR "collectionOverride" >= 0));
        END IF;
      END $$`,
      // company due has two meanings: Homix margin (Homix delivered) or a debt the vendor owes (vendor delivered)
      `ALTER TABLE financial_invoice_lines ADD COLUMN IF NOT EXISTS "companyDueKind" VARCHAR(12)`,
      `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_invoice_lines_company_due_kind_chk') THEN
          ALTER TABLE financial_invoice_lines ADD CONSTRAINT financial_invoice_lines_company_due_kind_chk
            CHECK ("companyDueKind" IS NULL OR "companyDueKind" IN ('margin', 'vendorOwes'));
        END IF;
      END $$`,
      `UPDATE financial_invoice_lines l
        SET "companyDueKind" = CASE WHEN o."deliveryBy" = 1 THEN 'margin' ELSE 'vendorOwes' END
        FROM orders o WHERE o.id = l."orderId" AND l."companyDueKind" IS NULL`,
      `CREATE TABLE IF NOT EXISTS financial_invoice_adjustments (
        id BIGSERIAL PRIMARY KEY,
        "invoiceId" BIGINT NOT NULL REFERENCES financial_invoices(id),
        label VARCHAR(200) NOT NULL,
        kind VARCHAR(16) NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        "createdBy" INTEGER REFERENCES users(id),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "removedAt" TIMESTAMPTZ,
        "removedBy" INTEGER REFERENCES users(id),
        CONSTRAINT financial_invoice_adjustments_kind_chk CHECK (kind IN ('addition', 'deduction')),
        CONSTRAINT financial_invoice_adjustments_amount_chk CHECK (amount > 0)
      )`,
      `CREATE INDEX IF NOT EXISTS financial_invoice_adjustments_invoice_idx ON financial_invoice_adjustments ("invoiceId")`,
      `CREATE TABLE IF NOT EXISTS financial_invoice_events (
        id BIGSERIAL PRIMARY KEY,
        "invoiceId" BIGINT REFERENCES financial_invoices(id),
        "vendorId" INTEGER REFERENCES vendors(id),
        action VARCHAR(48) NOT NULL,
        "fromStatus" VARCHAR(16),
        "toStatus" VARCHAR(16),
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        "actorId" INTEGER REFERENCES users(id),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS financial_invoice_events_created_idx ON financial_invoice_events ("createdAt" DESC)`,
      `CREATE INDEX IF NOT EXISTS financial_invoice_events_invoice_idx ON financial_invoice_events ("invoiceId", "createdAt" DESC)`,
    ],
  },
];

const applySchema = async (): Promise<void> => {
  try {
    await sequelize.transaction(async (transaction) => {
      // ALTER TABLE orders needs a lock that waits behind running queries and blocks new ones
      // while it waits. Fail fast instead of freezing the app: run this in a quiet window.
      await sequelize.query("SET LOCAL lock_timeout = '15s'", { transaction });

      await assertPrerequisites(transaction);

      for (const step of STEPS) {
        log(`• ${step.name}`);
        for (const statement of step.statements) {
          await sequelize.query(statement, { transaction });
        }
      }

      if (isDryRun) throw new DryRunRollback();
    });
    log("Schema changes committed.");
  } catch (error) {
    if (error instanceof DryRunRollback) {
      log("Dry run: every schema statement ran successfully and was rolled back.");
      return;
    }
    throw error;
  }
};

/**
 * Merge mode, identical to `db:backfill-user-permissions`: keys a user already has
 * keep their value; only keys missing from the stored map are filled from the role
 * template. So nobody loses or gains anything they were explicitly given, and
 * orders_edit_financials stays off for everyone except admins.
 */
const mergeUserPermissions = async (): Promise<void> => {
  const users = await User.findAll();
  let updated = 0;

  for (const userValue of users) {
    const user = userValue as { permissions?: unknown; save: () => Promise<void> } & Record<string, unknown>;
    const plain = toPlainRecord(user);
    const userType = toText(plain.userType);
    const roleName = toText(plain.roleName);
    const next = normalizePermissions(plain.permissions, userType, roleName);
    const current = normalizePermissions(plain.permissions, "", "");

    if (JSON.stringify(current) === JSON.stringify(next)) continue;

    if (isDryRun) {
      updated += 1;
      continue;
    }

    Object.assign(user, { permissions: next });
    await user.save();
    updated += 1;
  }

  log(`• permissions: ${updated} of ${users.length} users ${isDryRun ? "would be" : "were"} updated`);
};

const main = async (): Promise<void> => {
  log(isDryRun ? "DRY RUN — nothing will be kept\n" : "Applying dev2 database changes\n");
  await connectToDb();

  await applySchema();
  await mergeUserPermissions();

  log("\nDone. Optional: npm run db:backfill-order-governorate (preview) / -- --apply");
};

void main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("dev2 deploy migration failed");
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => undefined);
  });
