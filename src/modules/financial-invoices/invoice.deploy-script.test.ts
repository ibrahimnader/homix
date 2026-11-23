import fs from "fs";
import path from "path";

describe("deploy migration statements for invoice-level overrides", () => {
  const deploy = fs.readFileSync(path.resolve(__dirname, "../../scripts/run-dev2-deploy-migration.ts"), "utf8");
  const migration = fs.readFileSync(path.resolve(__dirname, "../../../migrations/add-financial-invoices.js"), "utf8");

  test.each([["deploy script", deploy], ["migration", migration]])("%s adds both columns and the CHECK idempotently", (_name, source) => {
    expect(source).toContain('ADD COLUMN IF NOT EXISTS "warehouseCostOverride" NUMERIC(14,2)');
    expect(source).toContain('ADD COLUMN IF NOT EXISTS "collectionOverride" NUMERIC(14,2)');
    expect(source).toContain("financial_invoice_lines_cost_overrides_chk");
    expect(source).toContain("IF NOT EXISTS (SELECT 1 FROM pg_constraint");
  });

  test.each([["deploy script", deploy], ["migration", migration]])("%s adds the vendor shipping override column with its CHECK idempotently", (_name, source) => {
    expect(source).toContain('ADD COLUMN IF NOT EXISTS "vendorShippingCostOverride" NUMERIC(14,2)');
    expect(source).toContain("financial_invoice_lines_shipping_override_chk");
  });

  test.each([["deploy script", deploy], ["migration", migration]])("%s adds companyDueKind with its CHECK and an idempotent backfill from the order", (_name, source) => {
    expect(source).toContain('ADD COLUMN IF NOT EXISTS "companyDueKind" VARCHAR(12)');
    expect(source).toContain("financial_invoice_lines_company_due_kind_chk");
    expect(source).toContain(`'margin', 'vendorOwes'`);
    expect(source).toMatch(/UPDATE financial_invoice_lines l[\s\S]*?o\."deliveryBy" = 1 THEN 'margin' ELSE 'vendorOwes'[\s\S]*?l\."companyDueKind" IS NULL/);
  });

  test.each([["deploy script", deploy], ["migration", migration]])("%s keeps netAmount signed and the line due columns unconstrained (net may be negative: no migration needed)", (_name, source) => {
    expect(source).toContain('"netAmount" NUMERIC(14,2) NOT NULL DEFAULT 0');
    expect(source).not.toMatch(/CHECK\s*\([^)]*"netAmount"/);
    expect(source).not.toMatch(/CHECK\s*\([^)]*"(vendorDue|companyDue)"\s*>=/);
    // the only sign constraint on money is the magnitude of the transferred amount (direction comes from the net's sign)
    expect(source).toContain('"transferAmount" IS NULL OR "transferAmount" >= 0');
  });

  describe.each([["deploy script", deploy], ["migration", migration]])("%s: consolidated invoices and multiple receipts", (_name, source) => {
    test("adds the consolidation columns idempotently", () => {
      expect(source).toContain(`ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'standard'`);
      expect(source).toContain('ADD COLUMN IF NOT EXISTS "mergedIntoId" BIGINT REFERENCES financial_invoices(id)');
      expect(source).toContain('ADD COLUMN IF NOT EXISTS "mergedCode" VARCHAR(32)');
      expect(source).toContain('ADD COLUMN IF NOT EXISTS "preMergeStatus" VARCHAR(16)');
      expect(source).toContain('financial_invoice_lines ADD COLUMN IF NOT EXISTS "sourceInvoiceId" BIGINT REFERENCES financial_invoices(id)');
      expect(source).toContain('financial_invoice_adjustments ADD COLUMN IF NOT EXISTS "sourceInvoiceId" BIGINT REFERENCES financial_invoices(id)');
      expect(source).toContain("financial_invoices_kind_chk");
    });

    test("widens the status CHECK only when it does not already allow 'consolidated' (re-runnable)", () => {
      expect(source).toMatch(/conname = 'financial_invoices_status_chk' AND pg_get_constraintdef\(oid\) NOT LIKE '%consolidated%'/);
      expect(source).toContain("'draft', 'reviewed', 'frozen', 'transferred', 'consolidated', 'cancelled'");
    });

    test("one STANDARD invoice per vendor/cycle: the unique index becomes partial, the old one is dropped IF EXISTS", () => {
      expect(source).toContain("DROP INDEX IF EXISTS financial_invoices_vendor_period_uq");
      expect(source).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS financial_invoices_vendor_period_std_uq ON financial_invoices ("vendorId", "periodEnd") WHERE kind = 'standard'`);
    });

    test("creates the receipts table IF NOT EXISTS with soft delete and backfills the legacy receipt exactly once", () => {
      expect(source).toContain("CREATE TABLE IF NOT EXISTS financial_invoice_receipts");
      expect(source).toContain('"deletedAt" TIMESTAMPTZ');
      expect(source).toMatch(/INSERT INTO financial_invoice_receipts[\s\S]*?WHERE i\."receiptPath" IS NOT NULL\s+AND NOT EXISTS \(SELECT 1 FROM financial_invoice_receipts r WHERE r\."invoiceId" = i\.id AND r\.path = i\."receiptPath"\)/);
    });

    test("never drops or deletes data (additive only)", () => {
      const from = source.indexOf("consolidated invoices («فاتورة شاملة»)");
      const down = source.indexOf("async down(");
      const added = source.slice(from, down === -1 ? undefined : down);
      expect(added).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/);
    });
  });
});
