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

  test("archive list: every filter becomes a bound condition and combines with AND", async () => {
    query.mockResolvedValue([]);
    await new InvoiceRepository().listInvoices({
      billingDay: 13, dueParty: "homix", kind: "standard", monthFrom: "2026-09-30T21:00:00.000Z", monthTo: "2026-10-31T21:59:59.999Z",
      overdueDays: 3, page: 2, search: "Ahmed_%", size: 10, statuses: ["reviewed", "frozen"], vendorId: 4,
    });
    const [sql, { replacements }] = lastCall();
    expect(sql).toContain("i.status IN (:statuses)");
    expect(sql).toContain('i."billingDay" = :billingDay');
    expect(sql).toContain('i."periodEnd" >= CAST(:monthFrom AS timestamptz)');
    expect(sql).toContain('i."periodEnd" <= CAST(:monthTo AS timestamptz)');
    expect(sql).toContain('i."netAmount" < 0');
    expect(sql).toContain("(v.name ILIKE :search OR i.code ILIKE :search)");
    expect(sql).toContain('i."vendorId" = :vendorId');
    expect(replacements).toMatchObject({ billingDay: 13, monthFrom: "2026-09-30T21:00:00.000Z", search: "%Ahmed\\_\\%%", statuses: ["reviewed", "frozen"], vendorId: 4 });
  });

  test("direction: vendor = net > 0, both/undefined adds no net condition", async () => {
    query.mockResolvedValue([]);
    await new InvoiceRepository().listInvoices({ dueParty: "vendor", overdueDays: 3, page: 1, size: 10 });
    expect(lastCall()[0]).toContain('i."netAmount" > 0');
    query.mockClear();
    await new InvoiceRepository().listInvoices({ overdueDays: 3, page: 1, size: 10 });
    expect(lastCall()[0]).not.toContain("netAmount");
  });

  test("without statuses the merged/cancelled sources stay hidden", async () => {
    query.mockResolvedValue([]);
    await new InvoiceRepository().listInvoices({ overdueDays: 3, page: 1, size: 10 });
    const [sql, { replacements }] = lastCall();
    expect(sql).toContain("i.status NOT IN (:hiddenStatuses)");
    expect(replacements.hiddenStatuses).toEqual(["consolidated", "cancelled"]);
  });

  test("filtered counts ignore the kind selection but keep every other filter", async () => {
    query.mockClear();
    query.mockResolvedValue([{ status: "reviewed", total: "3" }]);
    const counts = await new InvoiceRepository().countFilteredByStatus({ kind: "consolidated", overdueDays: 3, page: 1, search: "x", size: 10, statuses: ["reviewed"] });
    const [sql, { replacements }] = lastCall();
    expect(sql).not.toContain("i.kind");
    expect(sql).toContain("ILIKE :search");
    expect(replacements.kind).toBeUndefined();
    expect(counts).toEqual({ reviewed: 3 });
  });

  test("months are Cairo months of periodEnd, scoped by status and vendor", async () => {
    query.mockClear();
    query.mockResolvedValue([{ month: "2026-10", total: "4" }]);
    const months = await new InvoiceRepository().listInvoiceMonths(5, ["reviewed", "transferred"]);
    const [sql, { replacements }] = lastCall();
    expect(sql).toContain("AT TIME ZONE 'Africa/Cairo'");
    expect(sql).toContain("i.status IN (:statuses)");
    expect(replacements).toEqual({ statuses: ["reviewed", "transferred"], vendorId: 5 });
    expect(months).toEqual([{ count: 4, month: "2026-10" }]);
  });

  test("vendor options exclude deleted/unnamed vendors and sort by name", async () => {
    query.mockResolvedValue([]);
    await new InvoiceRepository().listVendorOptions();
    const [sql] = lastCall();
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain("ORDER BY name");
  });
});

describe("InvoiceRepository billable-order SQL", () => {
  test("add-order picker only offers billable orders (Homix deliveries need a delivered shipment)", async () => {
    query.mockResolvedValue([]);
    await new InvoiceRepository().searchOrderCandidates(3, "31");
    const [sql, { replacements }] = lastCall();
    expect(sql).toContain("o.status IN (:billable)");
    expect(sql).toContain('o."deliveryBy" IS DISTINCT FROM :homixDeliveryBy OR o."shipmentStatus" = :shipmentDelivered');
    expect(replacements).toMatchObject({ billable: [5], homixDeliveryBy: 1, shipmentDelivered: 4, vendorId: 3 });
  });

  test("findOrderForInvoicing loads delivery and shipment status", async () => {
    query.mockResolvedValue([]);
    await new InvoiceRepository().findOrderForInvoicing(5, {} as never);
    expect(lastCall()[0]).toContain('"deliveryBy", "shipmentStatus"');
  });
});
