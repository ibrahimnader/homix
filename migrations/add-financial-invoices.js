/**
 * Vendor settlement invoices (see docs/financial-invoices-design.md).
 * Written but NOT run against any database by the author — review, then run on
 * a copy first. All statements are idempotent (IF NOT EXISTS).
 */
module.exports = {
  async up(queryInterface) {
    const run = (sql) => queryInterface.sequelize.query(sql);

    await run("CREATE SEQUENCE IF NOT EXISTS financial_invoice_code_seq");

    await run(`
      CREATE TABLE IF NOT EXISTS financial_invoices (
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
      )
    `);
    await run('CREATE UNIQUE INDEX IF NOT EXISTS financial_invoices_code_uq ON financial_invoices (code) WHERE code IS NOT NULL');
    await run('CREATE UNIQUE INDEX IF NOT EXISTS financial_invoices_vendor_period_uq ON financial_invoices ("vendorId", "periodEnd")');
    await run('CREATE INDEX IF NOT EXISTS financial_invoices_status_period_idx ON financial_invoices (status, "periodEnd" DESC)');
    await run('CREATE INDEX IF NOT EXISTS financial_invoices_vendor_status_idx ON financial_invoices ("vendorId", status)');
    await run('CREATE INDEX IF NOT EXISTS financial_invoices_transferred_idx ON financial_invoices ("transferredAt") WHERE "transferredAt" IS NOT NULL');

    await run(`
      CREATE TABLE IF NOT EXISTS financial_invoice_lines (
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
      )
    `);
    // An order is actively on at most one invoice; a removed order is never re-invoiced.
    await run(`CREATE UNIQUE INDEX IF NOT EXISTS financial_invoice_lines_order_active_uq
      ON financial_invoice_lines ("orderId") WHERE state IN ('included', 'frozen', 'removed')`);
    await run('CREATE INDEX IF NOT EXISTS financial_invoice_lines_invoice_state_idx ON financial_invoice_lines ("invoiceId", state)');
    await run('CREATE INDEX IF NOT EXISTS financial_invoice_lines_order_idx ON financial_invoice_lines ("orderId")');

    await run(`
      CREATE TABLE IF NOT EXISTS financial_invoice_adjustments (
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
      )
    `);
    await run('CREATE INDEX IF NOT EXISTS financial_invoice_adjustments_invoice_idx ON financial_invoice_adjustments ("invoiceId")');

    await run(`
      CREATE TABLE IF NOT EXISTS financial_invoice_events (
        id BIGSERIAL PRIMARY KEY,
        "invoiceId" BIGINT REFERENCES financial_invoices(id),
        "vendorId" INTEGER REFERENCES vendors(id),
        action VARCHAR(48) NOT NULL,
        "fromStatus" VARCHAR(16),
        "toStatus" VARCHAR(16),
        detail JSONB NOT NULL DEFAULT '{}'::jsonb,
        "actorId" INTEGER REFERENCES users(id),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run('CREATE INDEX IF NOT EXISTS financial_invoice_events_created_idx ON financial_invoice_events ("createdAt" DESC)');
    await run('CREATE INDEX IF NOT EXISTS financial_invoice_events_invoice_idx ON financial_invoice_events ("invoiceId", "createdAt" DESC)');
  },

  async down(queryInterface) {
    const run = (sql) => queryInterface.sequelize.query(sql);
    await run("DROP TABLE IF EXISTS financial_invoice_events");
    await run("DROP TABLE IF EXISTS financial_invoice_adjustments");
    await run("DROP TABLE IF EXISTS financial_invoice_lines");
    await run("DROP TABLE IF EXISTS financial_invoices");
    await run("DROP SEQUENCE IF EXISTS financial_invoice_code_seq");
  },
};
