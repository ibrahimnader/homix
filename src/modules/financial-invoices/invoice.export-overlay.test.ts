import { PassThrough } from "stream";

import type { OrderFinancialReportResponse } from "../orders/order.types";
import { OrderService } from "../orders/order.service";
import { InvoiceService } from "./invoice.service";
import type { AdjustmentRow, InvoiceRow, LineRow } from "./invoice.types";

jest.mock("../../config/env", () => ({ env: { UPLOADS_DIR: "uploads" } }));
jest.mock("../dashboard/dashboard-aggregate.service", () => ({
  DashboardAggregateService: jest.fn().mockImplementation(() => ({ backfill: jest.fn(), refreshRange: jest.fn() })),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ExcelJS = require("exceljs");

const NOW = new Date("2026-11-04T10:00:00Z");
const invoice = (overrides: Partial<InvoiceRow> = {}): InvoiceRow => ({
  adjustmentsTotal: 0, billingDay: 28, code: "INV-7", collectionTotal: 0, companyDueTotal: 0, createdAt: NOW, finesTotal: 0,
  frozenAt: null, frozenDurationMs: 0, id: 1, netAmount: 0, ordersCount: 0, periodEnd: "2026-10-28T21:59:59.999Z", periodStart: "2026-10-13T22:00:00.000Z",
  receiptMime: null, receiptName: null, receiptPath: null, receiptUploadedAt: null, reviewedAt: null, status: "draft",
  transferAmount: null, transferredAt: null, updatedAt: NOW, vendorDueTotal: 0, vendorId: 5, vendorName: "ركة", vendorShippingCost: 0, warehouseCost: 0,
  ...overrides,
});
const lineRow = (overrides: Partial<LineRow & { outsideCycle: boolean }> = {}): LineRow & { outsideCycle: boolean; vendorId: number } => ({
  collectionTotal: 1000, companyDue: 200, companyDueOverride: null, fines: 0, finesOverride: null, id: 11, invoiceId: 1, isWarehouseDelivery: false,
  operationNumber: "OP100", orderId: 100, orderNumber: "100", outsideCycle: false, overrideReason: null, paymentStatus: 1, paymentStatusLabel: "", productCode: "A",
  state: "included", stateChangedAt: null, stateReason: null, vendorDue: 800, vendorDueOverride: null, vendorId: 5, vendorShippingCost: 0, warehouseCost: 600,
  ...overrides,
});
const adjustment = (overrides: Partial<AdjustmentRow> = {}): AdjustmentRow => ({
  amount: 30, createdAt: NOW, id: 1, invoiceId: 1, kind: "deduction", label: "خصم تأخير", removedAt: null, ...overrides,
});
const order = (orderId: number) => ({
  collectionTotal: 1000, companyDue: 400, companyDueKind: "vendorOwes" as const, fines: 0, id: orderId, operationNumber: `OP${orderId}`, orderId,
  orderNumber: String(orderId), paymentStatus: 1, paymentStatusLabel: "", productCode: "A", productId: 1, shipmentId: null, vendorDue: 0,
  vendorShippingCost: 0, warehouseCost: 600,
});
const section = (orders: ReturnType<typeof order>[]) => ({
  items: [{
    collectionTotal: 1000 * orders.length, companyDue: 400 * orders.length, fines: 0, homixMargin: 0, orders, ordersCount: orders.length, vendorDue: 0,
    vendorId: 5, vendorName: "ركة", vendorOwes: 400 * orders.length, vendorShippingCost: 0, warehouseCost: 600 * orders.length,
  }],
  summary: {
    collectionTotal: 1000 * orders.length, companyDue: 400 * orders.length, fines: 0, homixMargin: 0, ordersCount: orders.length, vendorDue: 0,
    vendorOwes: 400 * orders.length, vendorShippingCost: 0, warehouseCost: 600 * orders.length,
  },
});
const makeReport = (mode = "billingCycle") => ({
  cycle: { billingDay: 28, endDate: "2026-10-28T21:59:59.999Z", mode, referenceDate: "2026-10-28T21:59:59.999Z", startDate: "2026-10-13T22:00:00.000Z" },
  fullInvoice: section([order(100), order(101)]),
  summary: { companyDue: 800, fines: 0, homixMargin: 0, totalSales: 2000, vendorDue: 0, vendorOwes: 800, vendorsCount: 1 },
  vendorDeliveries: section([order(100), order(101)]),
  warehouseDeliveries: { items: [], summary: section([]).summary },
}) as never as OrderFinancialReportResponse;

const makeRepo = (opts: { invoices?: InvoiceRow[]; lines?: ReturnType<typeof lineRow>[]; included?: Array<{ invoiceId: number; orderId: number }>; adjustments?: AdjustmentRow[] } = {}) => ({
  listAdjustments: jest.fn(async () => opts.adjustments ?? []),
  listCycleInvoices: jest.fn(async (filters: { statuses?: string[]; vendorId?: number }) =>
    (opts.invoices ?? []).filter((row) => (!filters.statuses || filters.statuses.includes(row.status)) && (!filters.vendorId || row.vendorId === filters.vendorId))),
  listCycleOverlayLines: jest.fn(async (ids: number[]) => (ids.length ? opts.lines ?? [] : [])),
  listIncludedOrderIds: jest.fn(async (ids: number[]) => (ids.length ? opts.included ?? [] : [])),
});
const svc = (repo: unknown) => new InvoiceService({ getReport: jest.fn(), now: () => NOW, repo: repo as never });
const BOTH = [{ invoiceId: 1, orderId: 100 }, { invoiceId: 1, orderId: 101 }];

describe("effectiveReport (Excel export overlay)", () => {
  it("no invoice: live values, totals untouched", async () => {
    const result = await svc(makeRepo()).effectiveReport(makeReport(), {});
    expect(result.fullInvoice.items[0]!.invoice).toBeNull();
    expect(result.fullInvoice.items[0]!.vendorDue).toBe(0);
    expect(result.fullInvoice.items[0]!.exportOrders.map((row) => [row.state, row.overridden])).toEqual([["live", []], ["live", []]]);
    expect(result.fullInvoice.summary).toEqual(makeReport().fullInvoice.summary);
    expect(result.summary).toEqual(makeReport().summary);
  });

  it("custom range never looks up invoices", async () => {
    const repo = makeRepo({ invoices: [invoice()] });
    await svc(repo).effectiveReport(makeReport("customRange"), {});
    expect(repo.listCycleInvoices).not.toHaveBeenCalled();
  });

  it("an override replaces the line values and flows into row, section and top totals", async () => {
    const repo = makeRepo({
      included: BOTH, invoices: [invoice()],
      lines: [lineRow({ fines: 0, finesOverride: 50, overrideReason: "تأخير", vendorDue: 800, vendorShippingCost: 0, vendorShippingCostOverride: 120, warehouseCost: 600 })],
    });
    const result = await svc(repo).effectiveReport(makeReport(), {});
    const row = result.fullInvoice.items[0]!;
    const edited = row.exportOrders.find((o) => o.orderId === 100)!;
    expect(edited).toMatchObject({ fines: 50, vendorShippingCost: 120, overridden: ["vendorShippingCost", "fines"], state: "included" });
    expect(edited.note).toContain("تعديل يدوي");
    expect(edited.note).toContain("تأخير");
    // line 100 re-settles to 280 = collection − cost − shipping (live said 400), line 101 stays 400: row and summaries move by the same delta
    expect(row.companyDue).toBe(680);
    expect(row.fines).toBe(50);
    expect(row.vendorShippingCost).toBe(120);
    expect(result.fullInvoice.summary).toMatchObject({ companyDue: 680, fines: 50, ordersCount: 2, vendorShippingCost: 120 });
    expect(result.summary).toMatchObject({ companyDue: 680, fines: 50, totalSales: 2000 });
    expect(row.invoice).toMatchObject({ code: "INV-7", status: "draft", statusLabel: "معلّقة" });
  });

  it("a collection / cost / due override replaces those cells", async () => {
    const repo = makeRepo({
      included: BOTH, invoices: [invoice()],
      lines: [lineRow({ collectionOverride: 1500, companyDueOverride: 50, vendorDueOverride: 700, warehouseCostOverride: 500 })],
    });
    const edited = (await svc(repo).effectiveReport(makeReport(), {})).fullInvoice.items[0]!.exportOrders[0]!;
    expect(edited).toMatchObject({ collectionTotal: 1500, companyDue: 50, vendorDue: 700, warehouseCost: 500 });
    expect(edited.overridden).toEqual(expect.arrayContaining(["collectionTotal", "warehouseCost", "vendorDue", "companyDue"]));
  });

  it("manual adjustments are carried (removed ones are not) with the net amount", async () => {
    const repo = makeRepo({
      adjustments: [adjustment(), adjustment({ id: 2, removedAt: NOW })], included: BOTH,
      invoices: [invoice({ adjustmentsTotal: -30, netAmount: -30 })],
    });
    const row = (await svc(repo).effectiveReport(makeReport(), {})).fullInvoice.items[0]!;
    expect(row.invoice).toMatchObject({ adjustments: [{ amount: 30, kind: "deduction", label: "خصم تأخير" }], adjustmentsTotal: -30, netAmount: -30 });
  });

  it("excluded (deferred / frozen / not on the invoice) lines are listed for staff but never counted", async () => {
    const repo = makeRepo({
      included: [{ invoiceId: 1, orderId: 100 }], invoices: [invoice()],
      lines: [lineRow({ id: 12, orderId: 101, state: "deferred", stateReason: "تأجيل" })],
    });
    const row = (await svc(repo).effectiveReport(makeReport(), {})).fullInvoice.items[0]!;
    expect(row.ordersCount).toBe(1);
    expect(row.collectionTotal).toBe(1000);
    expect(row.exportOrders.find((o) => o.orderId === 101)).toMatchObject({ state: "deferred", note: expect.stringContaining("غير محسوب") });
  });

  it("an included invoice line outside the cycle window is added to the matching tab only", async () => {
    const repo = makeRepo({
      included: [...BOTH, { invoiceId: 1, orderId: 300 }], invoices: [invoice()],
      lines: [lineRow({ collectionTotal: 700, companyDue: 100, id: 13, isWarehouseDelivery: true, operationNumber: "OP300", orderId: 300, outsideCycle: true, vendorDue: 600, warehouseCost: 600 })],
    });
    const result = await svc(repo).effectiveReport(makeReport(), {});
    expect(result.fullInvoice.items[0]!.exportOrders.map((o) => o.orderId)).toContain(300);
    expect(result.vendorDeliveries.items[0]!.exportOrders.map((o) => o.orderId)).not.toContain(300);
    expect(result.fullInvoice.items[0]!.ordersCount).toBe(3);
  });

  it("vendors: only own reviewed/transferred invoice, counted lines, effective values and no override markings", async () => {
    const lines = [
      lineRow({ fines: 0, finesOverride: 50, overrideReason: "سبب داخلي", vendorShippingCost: 0, vendorShippingCostOverride: 120 }),
      lineRow({ id: 12, orderId: 101, state: "frozen", stateReason: "داخلي" }),
    ];
    const draft = makeRepo({ included: BOTH, invoices: [invoice({ status: "draft" })], lines });
    const draftResult = await svc(draft).effectiveReport(makeReport(), { vendorId: 5 });
    expect(draftResult.fullInvoice.items[0]!.invoice).toBeNull(); // a draft is not for the vendor: live values
    expect(draft.listCycleInvoices).toHaveBeenCalledWith(expect.objectContaining({ statuses: ["reviewed", "transferred"], vendorId: 5 }));

    const reviewed = makeRepo({ included: [{ invoiceId: 1, orderId: 100 }], invoices: [invoice({ status: "reviewed" })], lines });
    const row = (await svc(reviewed).effectiveReport(makeReport(), { vendorId: 5 }, 99)).fullInvoice.items[0]!;
    expect(reviewed.listCycleInvoices).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 5 }));
    expect(row.exportOrders).toHaveLength(1);
    expect(row.exportOrders[0]).toMatchObject({ fines: 50, note: null, overridden: [], vendorShippingCost: 120 });
    expect(JSON.stringify(row)).not.toContain("سبب داخلي");
    expect(JSON.stringify(row)).not.toContain("داخلي");
    expect(row.ordersCount).toBe(1);
  });
});

describe("OrderService.exportFinancialReport (workbook)", () => {
  const run = async (invoiceRepo: unknown, scopeVendor?: number | null) => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise((resolve) => stream.on("end", resolve));
    const response = Object.assign(stream, { setHeader: jest.fn() });
    const orderRepo = { getFinancialReport: jest.fn(async () => makeReport()) };
    const service = new OrderService(orderRepo as never, {} as never, svc(invoiceRepo));
    await service.exportFinancialReport(response as never, { billingDay: 28 }, scopeVendor);
    await done;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks));
    return workbook;
  };
  const cell = (sheet: { getRow: (n: number) => { values: unknown[] } }, rowNo: number, col: number) => sheet.getRow(rowNo).values[col];

  it("shows effective values, adjustments, notes and the «المستحق لهوميكس» header; totals row equals the screen totals", async () => {
    const workbook = await run(makeRepo({
      adjustments: [adjustment()], included: BOTH,
      invoices: [invoice({ adjustmentsTotal: -30 })],
      lines: [lineRow({ finesOverride: 50, fines: 0, overrideReason: "تأخير", vendorShippingCostOverride: 120 })],
    }));
    const full = workbook.getWorksheet("full-invoice");
    const headers = full.getRow(1).values.filter(Boolean);
    expect(headers).toEqual(expect.arrayContaining(["المستحق لهوميكس", "شحن البائع", "التسويات اليدوية", "صافي مستحق البائع", "كود الفاتورة", "حالة الفاتورة"]));
    const col = (name: string) => full.getRow(1).values.indexOf(name);
    expect(cell(full, 2, col("الغرامات"))).toBe(50);
    expect(cell(full, 2, col("كود الفاتورة"))).toBe("INV-7");
    expect(cell(full, 2, col("التسويات اليدوية"))).toBe(-30);
    const totals = full.getRow(4);
    expect(totals.values[col("البائع")]).toBe("الإجمالي");
    expect(totals.values[col("المستحق لهوميكس")]).toBe(680);
    expect(totals.values[col("الغرامات")]).toBe(50);
    expect(totals.values[col("شحن البائع")]).toBe(120);
    const lines = workbook.getWorksheet("lines");
    const noteCol = lines.getRow(1).values.indexOf("ملاحظات");
    expect(String(cell(lines, 2, noteCol))).toContain("تعديل يدوي");
    expect(workbook.getWorksheet("adjustments").getRow(2).values).toEqual(expect.arrayContaining(["خصم تأخير", -30]));
  });

  it("vendor workbook has no override notes or internal reasons", async () => {
    const workbook = await run(makeRepo({
      included: BOTH, invoices: [invoice({ status: "reviewed" })],
      lines: [lineRow({ finesOverride: 50, overrideReason: "سبب داخلي" })],
    }), 5);
    const lines = workbook.getWorksheet("lines");
    const noteCol = lines.getRow(1).values.indexOf("ملاحظات");
    expect(cell(lines, 2, noteCol)).toBeFalsy();
    const everything: string[] = [];
    workbook.eachSheet((sheet: { eachRow: (fn: (row: { values: unknown[] }) => void) => void }) => sheet.eachRow((row) => everything.push(row.values.join("|"))));
    expect(everything.join("\n")).not.toContain("سبب داخلي");
    expect(everything.join("\n")).not.toContain("تعديل يدوي");
  });
});
