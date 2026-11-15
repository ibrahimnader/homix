jest.mock("../../infrastructure/database", () => ({ sequelize: { query: jest.fn(async () => []), transaction: jest.fn() } }));
// eslint-disable-next-line import/first
import { sequelize } from "../../infrastructure/database";
// eslint-disable-next-line import/first
import { InvoiceRepository } from "./invoice.repo";

const query = sequelize.query as unknown as jest.Mock;
const lastCall = () => query.mock.calls[0] as [string, { replacements: Record<string, unknown> }];

describe("InvoiceRepository filters", () => {
  test("invoiced lines: each field is its own case-insensitive, wildcard-escaped LIKE", async () => {
    query.mockResolvedValue([{ total: "0" }]);
    await new InvoiceRepository().listInvoicedLines({
      invoiceCode: "INV_1", operationNumber: "OP%1", orderNumber: "31\\6", page: 1, productCode: "rk", size: 10, statuses: ["reviewed"], vendorIds: [3, 4],
    });
    const [sql, { replacements }] = lastCall();
    expect(sql).toContain('l."operationNumber" ILIKE :operationNumber');
    expect(sql).toContain('l."orderNumber" ILIKE :orderNumber');
    expect(sql).toContain('l."productCode" ILIKE :productCode');
    expect(sql).toContain("i.code ILIKE :invoiceCode");
    expect(sql).toContain('i."vendorId" IN (:vendorIds)');
    expect(replacements).toMatchObject({ invoiceCode: "%INV\\_1%", operationNumber: "%OP\\%1%", orderNumber: "%31\\\\6%", productCode: "%rk%", vendorIds: [3, 4] });
  });

  test("archive list: invoice code filter is escaped too", async () => {
    query.mockResolvedValue([]);
    await new InvoiceRepository().listInvoices({ invoiceCode: "A%", overdueDays: 3, page: 1, size: 10 });
    const [sql, { replacements }] = lastCall();
    expect(sql).toContain("i.code ILIKE :invoiceCode");
    expect(replacements.invoiceCode).toBe("%A\\%%");
  });

  test("vendor options exclude deleted/unnamed vendors and sort by name", async () => {
    query.mockResolvedValue([]);
    await new InvoiceRepository().listVendorOptions();
    const [sql] = lastCall();
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain("ORDER BY name");
  });
});
