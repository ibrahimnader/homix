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
});
