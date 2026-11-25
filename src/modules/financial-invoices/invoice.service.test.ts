import { InvoiceService } from "./invoice.service";
import type { InvoiceRow, LineRow } from "./invoice.types";

jest.mock("../../config/env", () => ({ env: { UPLOADS_DIR: "uploads" } }));

const NOW = new Date("2026-11-04T10:00:00Z");
const actor = { id: 9 };

const invoice = (overrides: Partial<InvoiceRow> = {}): InvoiceRow => ({
  adjustmentsTotal: 0, billingDay: 28, code: null, collectionTotal: 0, companyDueTotal: 0, createdAt: NOW, finesTotal: 0,
  frozenAt: null, frozenDurationMs: 0, id: 1, netAmount: 0, ordersCount: 0, periodEnd: "2026-10-28T21:59:59.999Z", periodStart: "2026-10-13T22:00:00.000Z",
  receiptMime: null, receiptName: null, receiptPath: null, receiptUploadedAt: null, reviewedAt: null, status: "draft",
  transferAmount: null, transferredAt: null, updatedAt: NOW, vendorDueTotal: 0, vendorId: 5, vendorName: "ركة", vendorShippingCost: 0, warehouseCost: 0,
  ...overrides,
});
const lineRow = (overrides: Partial<LineRow> = {}): LineRow => ({
  collectionTotal: 1000, companyDue: 200, companyDueOverride: null, fines: 0, finesOverride: null, id: 11, invoiceId: 1, isWarehouseDelivery: false,
  operationNumber: "OP1", orderId: 100, orderNumber: "31668", overrideReason: null, paymentStatus: 1, paymentStatusLabel: "", productCode: "A",
  state: "included", stateChangedAt: null, stateReason: null, vendorDue: 800, vendorDueOverride: null, vendorShippingCost: 0, warehouseCost: 600,
  ...overrides,
});
const reportOrder = (orderId: number, vendorDue = 800) => ({
  collectionTotal: 1000, companyDue: 200, fines: 0, id: orderId, operationNumber: `OP${orderId}`, orderId, orderNumber: String(orderId),
  paymentStatus: 1, paymentStatusLabel: "", productCode: "A", productId: 1, shipmentId: null, vendorDue, vendorShippingCost: 0, warehouseCost: 600,
});
const report = (endDate: string, orders: ReturnType<typeof reportOrder>[] = [reportOrder(100), reportOrder(101)]) => ({
  cycle: { billingDay: 28, endDate, mode: "billingCycle", referenceDate: endDate, startDate: "2026-10-13T22:00:00.000Z" },
  fullInvoice: { items: orders.length ? [{ collectionTotal: 0, companyDue: 0, fines: 0, orders, ordersCount: orders.length, vendorDue: 0, vendorId: 5, vendorName: "ركة", vendorShippingCost: 0, warehouseCost: 0 }] : [], summary: {} },
}) as never;

const makeRepo = (current: InvoiceRow = invoice()) => {
  const state = { adjustments: [] as never[], banks: new Map<number, Record<string, string | null>>(), current, lines: [] as LineRow[] };
  const repo = {
    findInvoice: jest.fn(async () => state.current),
    findLine: jest.fn(async (_i: unknown, lineId: number) => state.lines.find((row) => Number(row.id) === Number(lineId))),
    findLineByOrder: jest.fn(async (_i: unknown, orderId: number) => state.lines.find((row) => Number(row.orderId) === Number(orderId))),
    findLockedOrderIds: jest.fn(async () => new Set<number>()),
    findOrderForInvoicing: jest.fn(),
    insertAdjustment: jest.fn(async (_i: unknown, input: Record<string, unknown>) => ({ ...input, createdAt: NOW, id: 3, removedAt: null })),
    insertEvent: jest.fn(async () => undefined),
    insertLines: jest.fn(async (_i: unknown, snapshots: Array<{ orderId: number }>) => snapshots.map((row) => row.orderId)),
    listAdjustments: jest.fn(async () => state.adjustments),
    listLines: jest.fn(async () => state.lines),
    listVendorBanks: jest.fn(async (ids: number[]) => new Map([...state.banks].filter(([id]) => ids.map(Number).includes(id)))),
    listPickableDeferred: jest.fn(async () => [] as LineRow[]),
    listReceipts: jest.fn(async () => [] as never[]),
    nextInvoiceSequence: jest.fn(async () => 7),
    refreshLineSnapshot: jest.fn(async () => undefined),
    removeAdjustment: jest.fn(),
    setLineOverrides: jest.fn(async () => undefined),
    setLineState: jest.fn(async () => undefined),
    transaction: jest.fn(async (work: (tx: unknown) => unknown) => work({})),
    updateInvoiceFields: jest.fn(async () => undefined),
    updateTotals: jest.fn(async () => undefined),
    upsertDraft: jest.fn(async () => ({ created: true, invoice: state.current })),
  };
  return { repo, state };
};
const service = (repo: unknown, getReport = jest.fn()) =>
  new InvoiceService({ getReport, now: () => NOW, removeStoredFile: jest.fn(async () => undefined), repo: repo as never });

describe("generate", () => {
  test("allows the open cycle: creates a draft that can be topped up", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow()];
    const getReport = jest.fn(async () => report("2026-11-28T21:59:59.999Z"));
    const result = await service(repo, getReport).generate({ billingDay: 28 }, actor);
    expect(result.invoices).toEqual([expect.objectContaining({ created: true, vendorId: 5 })]);
    expect(repo.upsertDraft).toHaveBeenCalled();
  });

  test("review (single and bulk) is blocked with 409 until the cycle end has passed", async () => {
    const open = makeRepo(invoice({ periodEnd: "2026-11-28T21:59:59.999Z", status: "draft" }));
    open.state.lines = [lineRow()];
    await expect(service(open.repo).transition(1, "reviewed", {}, actor)).rejects.toThrow(/الدورة لم تنتهِ بعد/);
    const bulk = await service(open.repo).bulkTransition([1], "reviewed", actor);
    expect(bulk.results[0]).toMatchObject({ id: 1, ok: false });
    expect(bulk.succeeded).toBe(0);
    expect(open.repo.updateInvoiceFields).not.toHaveBeenCalled();
  });

  test("creates a draft per vendor, snapshots lines, recomputes totals and audits", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow(), lineRow({ id: 12, orderId: 101 })];
    const getReport = jest.fn(async () => report("2026-10-28T21:59:59.999Z"));
    const result = await service(repo, getReport).generate({ billingDay: 28, referenceDate: "2026-10-20" }, actor);
    expect(result.invoices).toEqual([expect.objectContaining({ added: 2, created: true, vendorId: 5 })]);
    expect(repo.insertLines).toHaveBeenCalledWith(1, [expect.objectContaining({ orderId: 100 }), expect.objectContaining({ orderId: 101 })], 9, expect.anything());
    expect(repo.updateTotals).toHaveBeenCalledWith(1, expect.objectContaining({ ordersCount: 2, vendorDueTotal: 1600 }), expect.anything());
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "invoice.generated", actorId: 9, invoiceId: 1 }), expect.anything());
  });

  test("skips orders already on another active invoice and never touches non-draft invoices", async () => {
    const { repo } = makeRepo();
    repo.findLockedOrderIds.mockResolvedValue(new Set([100]));
    const getReport = jest.fn(async () => report("2026-10-28T21:59:59.999Z"));
    await service(repo, getReport).generate({ billingDay: 28 }, actor);
    expect(repo.insertLines).toHaveBeenCalledWith(1, [expect.objectContaining({ orderId: 101 })], 9, expect.anything());

    const frozen = makeRepo(invoice({ status: "reviewed" }));
    frozen.repo.upsertDraft.mockResolvedValue({ created: false, invoice: frozen.state.current });
    await service(frozen.repo, getReport).generate({ billingDay: 28 }, actor);
    expect(frozen.repo.insertLines).not.toHaveBeenCalled();
    expect(frozen.repo.insertEvent).not.toHaveBeenCalled();
  });

  test("picks up deferred orders re-priced through a one-day report, and skips ones no longer reportable", async () => {
    const { repo } = makeRepo();
    repo.listPickableDeferred.mockResolvedValue([lineRow({ id: 40, orderId: 200 }), lineRow({ id: 41, orderId: 201 })]);
    repo.findOrderForInvoicing.mockImplementation(async (orderId: number) => ({ effectiveDeliveryDate: "2026-10-01T09:00:00Z", id: orderId, status: orderId === 200 ? 5 : 4 }));
    const getReport = jest.fn(async (query: { startDate?: string }) =>
      query.startDate ? report("2026-10-28T21:59:59.999Z", [reportOrder(200, 777)]) : report("2026-10-28T21:59:59.999Z", [reportOrder(100)]));
    const result = await service(repo, getReport).generate({ billingDay: 28 }, actor);
    expect(result.invoices[0]!.skippedDeferred).toEqual([201]);
    const inserted = (repo.insertLines.mock.calls[0]![1] as Array<{ orderId: number; vendorDue: number }>);
    expect(inserted.map((row) => row.orderId).sort()).toEqual([100, 200]);
    expect(inserted.find((row) => row.orderId === 200)!.vendorDue).toBe(777);
  });
});

describe("transition", () => {
  test("draft -> reviewed assigns a code once, freezes totals, and audits", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow()];
    const dto = await service(repo).transition(1, "reviewed", {}, actor);
    expect(repo.nextInvoiceSequence).toHaveBeenCalled();
    expect(repo.updateInvoiceFields).toHaveBeenCalledWith(1, expect.objectContaining({ code: "INV-2026-0007", reviewedAt: NOW, reviewedBy: 9, status: "reviewed" }), expect.anything());
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "invoice.reviewed", actorId: 9, fromStatus: "draft", toStatus: "reviewed" }), expect.anything());
    expect(dto.id).toBe(1);
  });

  test("keeps the existing code on re-review and refuses empty invoices", async () => {
    const withCode = makeRepo(invoice({ code: "INV-2026-0001" }));
    withCode.state.lines = [lineRow()];
    await service(withCode.repo).transition(1, "reviewed", {}, actor);
    expect(withCode.repo.nextInvoiceSequence).not.toHaveBeenCalled();
    const empty = makeRepo();
    await expect(service(empty.repo).transition(1, "reviewed", {}, actor)).rejects.toThrow(/فارغة/);
    expect(empty.repo.updateInvoiceFields).not.toHaveBeenCalled();
  });

  test("rejects transitions outside the graph", async () => {
    const { repo } = makeRepo(invoice({ status: "draft" }));
    await expect(service(repo).transition(1, "transferred", {}, actor)).rejects.toThrow(/لا يمكن الانتقال/);
    expect(repo.insertEvent).not.toHaveBeenCalled();
  });

  test("reviewed -> transferred stores amount (default |net|) and the difference; totals are not recomputed", async () => {
    const { repo } = makeRepo(invoice({ netAmount: -120.5, status: "reviewed" }));
    await service(repo).transition(1, "transferred", {}, actor);
    expect(repo.updateTotals).not.toHaveBeenCalled();
    expect(repo.updateInvoiceFields).toHaveBeenCalledWith(1, expect.objectContaining({ status: "transferred", transferAmount: 120.5 }), expect.anything());

    const custom = makeRepo(invoice({ netAmount: 100, status: "reviewed" }));
    await service(custom.repo).transition(1, "transferred", { transferAmount: 90 }, actor);
    expect(custom.repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ computedAmount: 100, difference: -10 }) }), expect.anything());
  });

  test("cannot revert to draft once a receipt exists; unfreeze accumulates frozen time", async () => {
    const withReceipt = makeRepo(invoice({ receiptPath: "uploads/financial-receipts/x.pdf", status: "reviewed" }));
    await expect(service(withReceipt.repo).transition(1, "draft", {}, actor)).rejects.toThrow(/إيصال/);
    const frozen = makeRepo(invoice({ frozenAt: new Date(NOW.getTime() - 3_600_000), frozenDurationMs: 1000, status: "frozen" }));
    await service(frozen.repo).transition(1, "reviewed", {}, actor);
    expect(frozen.repo.updateInvoiceFields).toHaveBeenCalledWith(1, expect.objectContaining({ frozenAt: null, frozenDurationMs: 3_601_000 }), expect.anything());
  });

  test("bulk transition reports per-invoice failures without aborting", async () => {
    const { repo } = makeRepo(invoice({ status: "draft" }));
    const result = await service(repo).bulkTransition([1, 1, 2], "frozen", actor);
    expect(result.results).toHaveLength(2);
    expect(result.succeeded).toBe(0);
    expect(result.results[0]).toMatchObject({ id: 1, ok: false });
  });
});

describe("draft-only edits", () => {
  test.each(["reviewed", "frozen", "transferred"] as const)("adjustments, overrides, line actions and add-order are refused on %s invoices", async (status) => {
    const { repo, state } = makeRepo(invoice({ status }));
    state.lines = [lineRow()];
    const svc = service(repo);
    await expect(svc.addAdjustment(1, { amount: 5, kind: "deduction", label: "x" }, actor)).rejects.toThrow(/مقفلة/);
    await expect(svc.setOverrides(1, 11, { finesOverride: 0 }, actor)).rejects.toThrow(/مقفلة/);
    await expect(svc.lineAction(1, 11, "freeze", undefined, actor)).rejects.toThrow(/مقفلة/);
    expect(repo.insertAdjustment).not.toHaveBeenCalled();
    expect(repo.setLineOverrides).not.toHaveBeenCalled();
    expect(repo.setLineState).not.toHaveBeenCalled();
    expect(repo.updateTotals).not.toHaveBeenCalled();
  });

  test("an override recomputes totals and audits old and new values", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow({ fines: 50, vendorDue: 750 })];
    await service(repo).setOverrides(1, 11, { finesOverride: 0, reason: "تسوية" }, actor);
    expect(repo.setLineOverrides).toHaveBeenCalledWith(11, expect.objectContaining({ finesOverride: 0, overrideReason: "تسوية" }), expect.anything());
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "line.overridden", actorId: 9 }), expect.anything());
  });

  test("line actions: defer/freeze/delete follow the rule table and are audited", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow(), lineRow({ id: 12, state: "deferred" })];
    const svc = service(repo);
    await svc.lineAction(1, 11, "defer", "مؤجل", actor);
    expect(repo.setLineState).toHaveBeenCalledWith(11, "deferred", "مؤجل", 9, expect.anything());
    await expect(svc.lineAction(1, 12, "freeze", undefined, actor)).rejects.toThrow(/غير متاح/);
    await svc.lineAction(1, 11, "delete", undefined, actor);
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "line.delete" }), expect.anything());
  });
});

describe("read scoping", () => {
  test("a vendor cannot open another vendor's invoice nor a draft/frozen one (404, no leak)", async () => {
    const own = makeRepo(invoice({ status: "reviewed", vendorId: 5 }));
    await expect(service(own.repo).detail(1, { vendorId: 5 })).resolves.toBeDefined();
    await expect(service(own.repo).detail(1, { vendorId: 6 })).rejects.toThrow(/غير موجودة/);
    for (const status of ["draft", "frozen"] as const) {
      const hidden = makeRepo(invoice({ status, vendorId: 5 }));
      await expect(service(hidden.repo).detail(1, { vendorId: 5 })).rejects.toThrow(/غير موجودة/);
    }
  });

  test("vendor detail exposes counted lines only, without internal notes", async () => {
    const { repo, state } = makeRepo(invoice({ status: "reviewed" }));
    state.lines = [lineRow({ overrideReason: "internal" }), lineRow({ id: 12, state: "frozen" })];
    const detail = await service(repo).detail(1, { vendorId: 5 });
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]).not.toHaveProperty("overrideReason");
    expect(detail.lines[0]).not.toHaveProperty("originalVendorDue");
  });

  test("vendor invoiced-lines feed hides internal notes and pre-override amounts, staff keeps them", async () => {
    const { repo } = makeRepo(invoice({ status: "reviewed" }));
    const row = { ...lineRow({ overrideReason: "internal" }), code: "INV1", invoiceId: 1, invoiceStatus: "reviewed", periodEnd: "2026-10-28T21:59:59.999Z", receiptPath: null, transferredAt: null, vendorId: 5, vendorName: "v" };
    (repo as unknown as { listInvoicedLines: jest.Mock }).listInvoicedLines = jest.fn(async () => ({ rows: [row], total: 1 }));
    const vendorView = await service(repo).invoicedLines({ page: 1, size: 10 }, { vendorId: 5 });
    expect(vendorView.items[0]).not.toHaveProperty("overrideReason");
    expect(vendorView.items[0]).not.toHaveProperty("originalVendorDue");
    const staffView = await service(repo).invoicedLines({ page: 1, size: 10 }, {});
    expect(staffView.items[0]).toHaveProperty("overrideReason", "internal");
  });

  test("list forces the vendor's own id and visible statuses whatever the query says", async () => {
    const { repo } = makeRepo();
    const listInvoices = jest.fn(async () => ({ rows: [], total: 0 }));
    const svc = service({ ...repo, countByStatus: jest.fn(async () => ({})), countFilteredByStatus: jest.fn(async () => ({})), listInvoices });
    await svc.list({ page: 1, size: 10, statuses: ["draft", "frozen"], vendorId: 99 }, { vendorId: 5 });
    expect(listInvoices).toHaveBeenCalledWith(expect.objectContaining({ statuses: ["reviewed", "transferred"], vendorId: 5 }));
  });

  test("list: month becomes Cairo-month bounds; chip counts use the archive statuses and never widen a vendor", async () => {
    const { repo } = makeRepo();
    const listInvoices = jest.fn(async () => ({ rows: [], total: 0 }));
    const countFilteredByStatus = jest.fn(async () => ({ reviewed: 2 }));
    const svc = service({ ...repo, countByStatus: jest.fn(async () => ({})), countFilteredByStatus, listInvoices });
    const staff = await svc.list({ month: "2026-10", page: 1, search: "x", size: 10 }, { canSettle: true });
    expect(listInvoices).toHaveBeenLastCalledWith(expect.objectContaining({ monthFrom: "2026-09-30T21:00:00.000Z", monthTo: "2026-10-31T21:59:59.999Z", search: "x" }));
    expect(countFilteredByStatus).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ["reviewed", "frozen", "transferred"] }));
    expect(staff.filteredCounts).toEqual({ reviewed: 2 });
    await svc.list({ page: 1, size: 10, vendorId: 99 }, { vendorId: 5 });
    expect(countFilteredByStatus).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ["reviewed", "transferred"], vendorId: 5 }));
  });

  test("months: staff see the archive statuses, a vendor only his own reviewed/transferred", async () => {
    const { repo } = makeRepo();
    const listInvoiceMonths = jest.fn(async () => [{ count: 1, month: "2026-10" }]);
    const svc = service({ ...repo, listInvoiceMonths });
    await svc.months({ canSettle: true });
    expect(listInvoiceMonths).toHaveBeenLastCalledWith(undefined, ["reviewed", "frozen", "transferred"]);
    await svc.months({ vendorId: 5 });
    expect(listInvoiceMonths).toHaveBeenLastCalledWith(5, ["reviewed", "transferred"]);
  });

  test("receipts: vendors only get their own transferred invoice's file", async () => {
    const base = { receiptMime: "application/pdf", receiptName: "r.pdf", receiptPath: "uploads/financial-receipts/r-1.pdf" };
    const ok = makeRepo(invoice({ ...base, status: "transferred" }));
    await expect(service(ok.repo).receiptFor(1, { vendorId: 5 })).resolves.toMatchObject({ mime: "application/pdf" });
    await expect(service(ok.repo).receiptFor(1, { vendorId: 6 })).rejects.toThrow(/غير موجودة/);
    const reviewed = makeRepo(invoice({ ...base, status: "reviewed" }));
    await expect(service(reviewed.repo).receiptFor(1, { vendorId: 5 })).rejects.toThrow();
  });
});

describe("receipt and reconciliation", () => {
  test("reconciliation computes the difference and logs it", async () => {
    const { repo } = makeRepo();
    const svc = service({ ...repo, transferredTotal: jest.fn(async () => ({ count: 2, totalCents: 310000 })) });
    const result = await svc.recordReconciliation({ bankTotal: 3000 }, actor);
    expect(result).toMatchObject({ bankTotal: 3000, count: 2, difference: -100, systemTotal: 3100 });
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "reconciliation.recorded", actorId: 9 }), expect.anything());
  });
});

describe("cycleOverview (live report overlay)", () => {
  const cycleRepo = (invoices: InvoiceRow[], lines: Array<LineRow & { outsideCycle: boolean; vendorId: number }>, included: Array<{ invoiceId: number; orderId: number }> = []) => {
    const { repo } = makeRepo();
    return Object.assign(repo, {
      listCycleInvoices: jest.fn(async () => invoices),
      listCycleOverlayLines: jest.fn(async () => lines),
      listIncludedOrderIds: jest.fn(async () => included),
    });
  };
  const overlayLine = (overrides: Partial<LineRow> = {}) => ({ ...lineRow({ finesOverride: 0, fines: 50, overrideReason: "سبب داخلي", vendorDue: 750, ...overrides }), outsideCycle: false, vendorId: 5 });

  test("staff get status per vendor, effective line amounts, internal reasons and the counted order ids", async () => {
    const repo = cycleRepo(
      [invoice({ id: 1, status: "draft", vendorId: 5 }), invoice({ id: 2, status: "frozen", vendorId: 6 })],
      [overlayLine(), overlayLine({ id: 12, state: "frozen", stateReason: "مراجعة" })],
      [{ invoiceId: 1, orderId: 100 }, { invoiceId: 1, orderId: 101 }],
    );
    const result = await service(repo).cycleOverview({ periodEnd: "2026-10-28" }, {});
    expect(result.invoices.map((row) => [row.vendorId, row.status])).toEqual([[5, "draft"], [6, "frozen"]]);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ fines: 0, finesOverride: 0, invoiceId: 1, overrideReason: "سبب داخلي", vendorDue: 750, vendorId: 5 });
    expect(result.includedOrderIds).toEqual({ 1: [100, 101] });
    expect(repo.listCycleInvoices).toHaveBeenCalledWith(expect.objectContaining({ statuses: undefined, vendorId: undefined }));
  });

  test("the cycle is looked up by the Cairo day the invoices end on", async () => {
    const repo = cycleRepo([], []);
    await service(repo).cycleOverview({ periodEnd: "2026-10-28", vendorId: 5 }, {});
    expect(repo.listCycleInvoices).toHaveBeenCalledWith({
      periodEndFrom: "2026-10-27T21:00:00.000Z", periodEndTo: "2026-10-28T20:59:59.999Z", statuses: undefined, vendorId: 5,
    });
    expect(repo.listCycleOverlayLines).toHaveBeenCalledWith([]);
  });

  test("vendors: forced to their own reviewed/transferred invoices, counted lines only, no internal notes", async () => {
    const repo = cycleRepo(
      [invoice({ id: 3, status: "reviewed", vendorId: 5 })],
      [overlayLine({ invoiceId: 3 }), overlayLine({ id: 12, state: "deferred", stateReason: "داخلي" })],
    );
    const result = await service(repo).cycleOverview({ periodEnd: "2026-10-28", vendorId: 99 }, { vendorId: 5 });
    expect(repo.listCycleInvoices).toHaveBeenCalledWith(expect.objectContaining({ statuses: ["reviewed", "transferred"], vendorId: 5 }));
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).not.toHaveProperty("overrideReason");
    expect(result.lines[0]).not.toHaveProperty("stateReason");
    expect(result.lines[0]).not.toHaveProperty("originalFines");
  });

  test("the cycle overview overlays an overridden line for staff and hides the override from vendors", async () => {
    const mk = () => cycleRepo(
      [invoice({ id: 3, status: "reviewed", vendorId: 5 })],
      [{ ...lineRow({ invoiceId: 3, vendorShippingCost: 50, vendorShippingCostOverride: 120 }), outsideCycle: false, vendorId: 5 }],
    );
    const staff = await service(mk()).cycleOverview({ periodEnd: "2026-10-28" }, {});
    expect(staff.lines[0]).toMatchObject({ vendorShippingCost: 120, vendorShippingCostOverride: 120 });
    const vendor = await service(mk()).cycleOverview({ periodEnd: "2026-10-28" }, { vendorId: 5 });
    expect(vendor.lines[0]).toMatchObject({ vendorShippingCost: 120 });
    expect(vendor.lines[0]).not.toHaveProperty("vendorShippingCostOverride");
  });
});

describe("cost/collection overrides and draft refresh", () => {
  test("a cost override is saved with old -> new audit detail and recomputes totals", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow({ warehouseCostOverride: 500 })];
    await service(repo).setOverrides(1, 11, { collectionOverride: 1500 }, actor);
    expect(repo.setLineOverrides).toHaveBeenCalledWith(11, expect.objectContaining({ collectionOverride: 1500, warehouseCostOverride: 500 }), expect.anything());
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "line.overridden",
      detail: expect.objectContaining({ changes: { collectionOverride: { from: null, to: 1500 } } }),
    }), expect.anything());
    expect(repo.updateTotals).toHaveBeenCalled();
  });

  test("null clears a cost override", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow({ warehouseCostOverride: 500 })];
    await service(repo).setOverrides(1, 11, { warehouseCostOverride: null }, actor);
    expect(repo.setLineOverrides).toHaveBeenCalledWith(11, expect.objectContaining({ warehouseCostOverride: null }), expect.anything());
  });

  test.each(["reviewed", "frozen", "transferred"] as const)("cost/collection overrides and refresh are refused (409) on %s invoices", async (status) => {
    const { repo, state } = makeRepo(invoice({ status }));
    state.lines = [lineRow()];
    const getReport = jest.fn();
    await expect(service(repo, getReport).setOverrides(1, 11, { warehouseCostOverride: 1 }, actor)).rejects.toThrow(/مقفلة/);
    await expect(service(repo, getReport).refreshDraft(1, actor)).rejects.toThrow(/مقفلة/);
    expect(getReport).not.toHaveBeenCalled();
    expect(repo.setLineOverrides).not.toHaveBeenCalled();
  });

  test("refresh updates system numbers only: overrides, reasons, states and adjustments are not touched", async () => {
    const { repo, state } = makeRepo();
    state.lines = [
      lineRow({ finesOverride: 0, id: 11, orderId: 100, overrideReason: "سبب", vendorDue: 800, warehouseCostOverride: 700 }),
      lineRow({ id: 12, orderId: 101, state: "frozen", vendorDue: 800 }),
    ];
    const fresh = (orderId: number) => ({ ...reportOrder(orderId, 1100), companyDue: 1099, collectionTotal: 2299, fines: 100, warehouseCost: 1200 });
    const getReport = jest.fn().mockResolvedValue(report("2026-10-28T20:59:59.999Z", [fresh(100), fresh(101)]));
    const result = await service(repo, getReport).refreshDraft(1, actor);
    expect(result.refreshed).toBe(2);
    const refreshed = repo.refreshLineSnapshot.mock.calls.map((call: unknown[]) => call[0]);
    expect(refreshed).toEqual([11, 12]);
    expect(repo.refreshLineSnapshot).toHaveBeenCalledWith(11, expect.objectContaining({ vendorDue: 1100, warehouseCost: 1200, collectionTotal: 2299 }), expect.anything());
    // overrides / states / adjustments have their own repo calls and none of them ran
    expect(repo.setLineOverrides).not.toHaveBeenCalled();
    expect(repo.setLineState).not.toHaveBeenCalled();
    expect(repo.insertAdjustment).not.toHaveBeenCalled();
    expect(repo.removeAdjustment).not.toHaveBeenCalled();
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "invoice.refreshed", detail: expect.objectContaining({ refreshed: 2 }) }), expect.anything());
  });

  test("refresh without changes writes no audit event", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow()];
    const getReport = jest.fn().mockResolvedValue(report("2026-10-28T20:59:59.999Z", [reportOrder(100)]));
    expect((await service(repo, getReport).refreshDraft(1, actor)).refreshed).toBe(0);
    expect(repo.insertEvent).not.toHaveBeenCalled();
  });

  test("vendors never receive overrides, originals or reasons (detail and cycle overview)", async () => {
    const lineWithAll = lineRow({ collectionOverride: 1, finesOverride: 2, overrideReason: "x", vendorDueOverride: 3, warehouseCostOverride: 4, companyDueOverride: 5 });
    const own = makeRepo(invoice({ status: "reviewed", vendorId: 5 }));
    own.state.lines = [lineWithAll];
    const detail = await service(own.repo).detail(1, { vendorId: 5 });
    for (const key of ["collectionOverride", "finesOverride", "vendorDueOverride", "companyDueOverride", "warehouseCostOverride", "overrideReason", "originalFines", "originalWarehouseCost", "originalCollection"]) {
      expect(detail.lines[0]).not.toHaveProperty(key);
    }
    // the amounts shown are still the effective ones
    expect(detail.lines[0]).toMatchObject({ collectionTotal: 1, warehouseCost: 4 });
    const staff = await service(own.repo).detail(1, {});
    expect(staff.lines[0]).toMatchObject({ collectionOverride: 1, warehouseCostOverride: 4, originalWarehouseCost: 600 });
  });
});

describe("vendor shipping (شحن البائع) override", () => {
  test("is saved with old -> new audit detail and recomputes totals", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow({ vendorShippingCost: 50 })];
    (repo.setLineOverrides as jest.Mock).mockImplementation(async (_id: unknown, values: Record<string, unknown>) => { state.lines = state.lines.map((row) => ({ ...row, ...values })) as LineRow[]; });
    await service(repo).setOverrides(1, 11, { vendorShippingCostOverride: 120 }, actor);
    expect(repo.setLineOverrides).toHaveBeenCalledWith(11, expect.objectContaining({ vendorShippingCostOverride: 120 }), expect.anything());
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "line.overridden",
      detail: expect.objectContaining({ changes: { vendorShippingCostOverride: { from: null, to: 120 } } }),
    }), expect.anything());
    expect(repo.updateTotals).toHaveBeenCalledWith(1, expect.objectContaining({ vendorShippingCost: 120 }), expect.anything());
  });

  test("null resets to the system value", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow({ vendorShippingCost: 50, vendorShippingCostOverride: 120 })];
    (repo.setLineOverrides as jest.Mock).mockImplementation(async (_id: unknown, values: Record<string, unknown>) => { state.lines = state.lines.map((row) => ({ ...row, ...values })) as LineRow[]; });
    await service(repo).setOverrides(1, 11, { vendorShippingCostOverride: null }, actor);
    expect(repo.setLineOverrides).toHaveBeenCalledWith(11, expect.objectContaining({ vendorShippingCostOverride: null }), expect.anything());
    expect(repo.updateTotals).toHaveBeenCalledWith(1, expect.objectContaining({ vendorShippingCost: 50 }), expect.anything());
  });

  test("is refused on Homix-delivered lines (shipping only applies to vendor deliveries)", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow({ isWarehouseDelivery: true })];
    await expect(service(repo).setOverrides(1, 11, { vendorShippingCostOverride: 10 }, actor)).rejects.toThrow(/تسليمات البائع/);
    expect(repo.setLineOverrides).not.toHaveBeenCalled();
  });

  test.each(["reviewed", "frozen", "transferred"] as const)("is refused (409) on %s invoices", async (status) => {
    const { repo, state } = makeRepo(invoice({ status }));
    state.lines = [lineRow()];
    await expect(service(repo).setOverrides(1, 11, { vendorShippingCostOverride: 10 }, actor)).rejects.toThrow(/مقفلة/);
    expect(repo.setLineOverrides).not.toHaveBeenCalled();
  });

  test("staff see override + system value; vendors only the effective shipping, never the override or original", async () => {
    const { repo, state } = makeRepo(invoice({ status: "reviewed", vendorId: 5 }));
    state.lines = [lineRow({ vendorShippingCost: 50, vendorShippingCostOverride: 120 })];
    const staff = await service(repo).detail(1, {});
    expect(staff.lines[0]).toMatchObject({ vendorShippingCost: 120, vendorShippingCostOverride: 120, originalVendorShippingCost: 50 });
    const vendor = await service(repo).detail(1, { vendorId: 5 });
    expect(vendor.lines[0]).toMatchObject({ vendorShippingCost: 120 });
    expect(vendor.lines[0]).not.toHaveProperty("vendorShippingCostOverride");
    expect(vendor.lines[0]).not.toHaveProperty("originalVendorShippingCost");
  });
});

describe("invoiced lines filters", () => {
  const withRepo = () => {
    const { repo } = makeRepo();
    const listInvoicedLines = jest.fn(async () => ({ rows: [], total: 0 }));
    return { listInvoicedLines, repo: Object.assign(repo, { listInvoicedLines }) };
  };

  test("staff filters reach the repository, vendor ids as a list", async () => {
    const { listInvoicedLines, repo } = withRepo();
    await service(repo).invoicedLines({ invoiceCode: "INV", operationNumber: "OP", orderNumber: "31", page: 1, productCode: "RK", size: 10, vendorId: [3, 4] }, {});
    expect(listInvoicedLines).toHaveBeenCalledWith(expect.objectContaining({
      invoiceCode: "INV", operationNumber: "OP", orderNumber: "31", productCode: "RK", vendorIds: [3, 4],
      statuses: ["reviewed", "transferred", "frozen"],
    }));
  });

  test("vendor users are pinned to their own vendor and never see frozen invoices", async () => {
    const { listInvoicedLines, repo } = withRepo();
    await service(repo).invoicedLines({ page: 1, size: 10, vendorId: [99] }, { vendorId: 5 });
    expect(listInvoicedLines).toHaveBeenCalledWith(expect.objectContaining({ statuses: ["reviewed", "transferred"], vendorIds: [5] }));
  });

  test("vendor options come straight from the repository", async () => {
    const { repo } = makeRepo();
    const rows = [{ id: 1, name: "أ" }];
    Object.assign(repo, { listVendorOptions: jest.fn(async () => rows) });
    expect(await service(repo).vendorOptions()).toBe(rows);
  });
});

describe("company due kind on lines", () => {
  test("dto exposes the stored kind, falling back by delivery type for unbackfilled lines; vendors keep it", async () => {
    const own = makeRepo(invoice({ status: "reviewed", vendorId: 5 }));
    own.state.lines = [lineRow({ companyDueKind: "vendorOwes" }), lineRow({ id: 12, orderId: 101, isWarehouseDelivery: true, companyDueKind: null })];
    const detail = await service(own.repo).detail(1, {});
    expect(detail.lines.map((l) => l.companyDueKind)).toEqual(["vendorOwes", "margin"]);
  });

  test("refresh stores the kind from the report and counts a kind-only change as a change", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow({ companyDueKind: null, companyDue: 1099, vendorDue: 1100, collectionTotal: 2299, warehouseCost: 1200, fines: 100 })];
    const fresh = { ...reportOrder(100, 1100), collectionTotal: 2299, companyDue: 1099, companyDueKind: "margin", fines: 100, warehouseCost: 1200 };
    const getReport = jest.fn().mockResolvedValue(report("2026-10-28T20:59:59.999Z", [fresh as never]));
    expect((await service(repo, getReport).refreshDraft(1, actor)).refreshed).toBe(1);
    expect(repo.refreshLineSnapshot).toHaveBeenCalledWith(11, expect.objectContaining({ companyDueKind: "margin" }), expect.anything());
  });
});

describe("reviewLive (review without a prior manual issue step)", () => {
  const closed = () => jest.fn(async () => report("2026-10-28T21:59:59.999Z"));

  test("creates the draft, fills it and reviews it in ONE transaction", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow()];
    repo.findInvoice.mockImplementation(async () => state.current);
    (repo.updateInvoiceFields as jest.Mock).mockImplementation(async (_i: unknown, fields: Record<string, unknown>) => { state.current = { ...state.current, ...fields } as InvoiceRow; });
    const result = await service(repo, closed()).reviewLive({ billingDay: 28, vendorId: 5 }, actor);
    expect(repo.transaction).toHaveBeenCalledTimes(1);
    expect(repo.upsertDraft).toHaveBeenCalled();
    expect(repo.insertLines).toHaveBeenCalled();
    expect(repo.updateInvoiceFields).toHaveBeenCalledWith(1, expect.objectContaining({ code: "INV-2026-0007", status: "reviewed" }), expect.anything());
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "invoice.generated" }), expect.anything());
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "invoice.reviewed", fromStatus: "draft", toStatus: "reviewed" }), expect.anything());
    expect(result).toMatchObject({ alreadyReviewed: false, vendorId: 5 });
  });

  test("is idempotent: an already reviewed invoice is returned untouched", async () => {
    const { repo } = makeRepo(invoice({ code: "INV-2026-0001", status: "reviewed" }));
    repo.upsertDraft.mockResolvedValue({ created: false, invoice: invoice({ code: "INV-2026-0001", status: "reviewed" }) });
    const result = await service(repo, closed()).reviewLive({ billingDay: 28, vendorId: 5 }, actor);
    expect(result.alreadyReviewed).toBe(true);
    expect(result.invoice.status).toBe("reviewed");
    expect(repo.insertLines).not.toHaveBeenCalled();
    expect(repo.updateInvoiceFields).not.toHaveBeenCalled();
    expect(repo.nextInvoiceSequence).not.toHaveBeenCalled();
  });

  test("blocked with 409 while the cycle is open (whole transaction rolls back via the throw)", async () => {
    const { repo, state } = makeRepo(invoice({ periodEnd: "2026-11-28T21:59:59.999Z" }));
    state.lines = [lineRow()];
    await expect(service(repo, jest.fn(async () => report("2026-11-28T21:59:59.999Z"))).reviewLive({ billingDay: 28, vendorId: 5 }, actor))
      .rejects.toThrow(/الدورة لم تنتهِ بعد/);
    expect(repo.updateInvoiceFields).not.toHaveBeenCalled();
  });

  test("never duplicates orders that are already on another invoice and keeps existing lines/overrides", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow({ vendorDueOverride: 5 })];
    repo.findLockedOrderIds.mockResolvedValue(new Set([100]));
    await service(repo, closed()).reviewLive({ billingDay: 28, vendorId: 5 }, actor);
    expect(repo.insertLines).toHaveBeenCalledWith(1, [expect.objectContaining({ orderId: 101 })], 9, expect.anything());
    expect(repo.setLineOverrides).not.toHaveBeenCalled();
    expect(repo.refreshLineSnapshot).not.toHaveBeenCalled();
    expect(repo.setLineState).not.toHaveBeenCalled();
  });
});

describe("reviewLiveAll", () => {
  const twoVendors = () => ({
    cycle: { billingDay: 28, endDate: "2026-10-28T21:59:59.999Z", mode: "billingCycle", referenceDate: "2026-10-20", startDate: "2026-10-13T22:00:00.000Z" },
    fullInvoice: { items: [
      { orders: [reportOrder(100)], vendorId: 5 },
      { orders: [reportOrder(200)], vendorId: 6 },
      { orders: [], vendorId: 7 },
    ], summary: {} },
  }) as never;

  test("skips vendors without counted orders and reports a failing vendor without aborting the rest", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow()];
    (repo.upsertDraft as jest.Mock).mockImplementation(async (input: { vendorId: number }) => {
      if (input.vendorId === 6) throw new Error("boom");
      return { created: true, invoice: state.current };
    });
    const result = await service(repo, jest.fn(async () => twoVendors())).reviewLiveAll({ billingDay: 28 }, actor);
    expect(result.results).toEqual([
      expect.objectContaining({ ok: true, vendorId: 5 }),
      expect.objectContaining({ error: "boom", ok: false, vendorId: 6 }),
    ]);
    expect(result).toMatchObject({ failed: 1, succeeded: 1 });
  });

  test("409 up front while the cycle is open", async () => {
    const { repo } = makeRepo();
    await expect(service(repo, jest.fn(async () => report("2026-11-28T21:59:59.999Z"))).reviewLiveAll({ billingDay: 28 }, actor)).rejects.toThrow(/الدورة لم تنتهِ بعد/);
    expect(repo.upsertDraft).not.toHaveBeenCalled();
  });
});

describe("live-row actions (ensure the draft, then act in one transaction)", () => {
  const open = () => jest.fn(async () => report("2026-11-28T21:59:59.999Z"));
  const live = { billingDay: 28 as const, vendorId: 5 };

  test("ensureLiveDraft creates the draft on first use and reuses it afterwards (open cycle allowed)", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow()];
    const first = await service(repo, open()).ensureLiveDraft(live, actor);
    expect(first).toMatchObject({ created: true, invoiceId: 1, status: "draft", vendorId: 5 });
    repo.upsertDraft.mockResolvedValue({ created: false, invoice: state.current });
    const second = await service(repo, open()).ensureLiveDraft(live, actor);
    expect(second).toMatchObject({ created: false, invoiceId: 1 });
  });

  test("concurrent calls converge on one draft: one creator, same id, orders on another invoice never duplicated", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow()];
    repo.findLockedOrderIds.mockResolvedValue(new Set([100]));
    repo.upsertDraft.mockResolvedValueOnce({ created: true, invoice: state.current }).mockResolvedValue({ created: false, invoice: state.current });
    const svc = service(repo, open());
    const [a, b] = await Promise.all([svc.ensureLiveDraft(live, actor), svc.ensureLiveDraft(live, actor)]);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(a.invoiceId).toBe(b.invoiceId);
    for (const call of repo.insertLines.mock.calls) expect((call[1] as Array<{ orderId: number }>).map((row) => row.orderId)).not.toContain(100);
  });

  test("liveLineAction creates the draft and freezes the order in ONE transaction, audited", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow()];
    const result = await service(repo, open()).liveLineAction({ ...live, action: "freeze", orderId: 100, reason: "مراجعة" }, actor);
    expect(repo.transaction).toHaveBeenCalledTimes(1);
    expect(repo.upsertDraft).toHaveBeenCalled();
    expect(repo.setLineState).toHaveBeenCalledWith(11, "frozen", "مراجعة", 9, expect.anything());
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "line.freeze", invoiceId: 1 }), expect.anything());
    expect(result).toMatchObject({ created: true, invoiceId: 1, state: "frozen" });
  });

  test.each(["defer", "delete"] as const)("liveLineAction %s follows the same rule table as the dialog", async (action) => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow()];
    await service(repo, open()).liveLineAction({ ...live, action, orderId: 100 }, actor);
    expect(repo.setLineState).toHaveBeenCalledWith(11, action === "defer" ? "deferred" : "removed", null, 9, expect.anything());
  });

  test("a line state that does not fit the action is a 409, nothing is written", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow({ state: "deferred" })];
    await expect(service(repo, open()).liveLineAction({ ...live, action: "freeze", orderId: 100 }, actor)).rejects.toThrow(/غير متاح/);
    expect(repo.setLineState).not.toHaveBeenCalled();
  });

  test.each(["reviewed", "frozen", "transferred"] as const)("%s invoices stay immutable: 409, no line changes, no top-up", async (status) => {
    const locked = invoice({ status });
    const { repo, state } = makeRepo(locked);
    state.lines = [lineRow()];
    repo.upsertDraft.mockResolvedValue({ created: false, invoice: locked });
    const svc = service(repo, open());
    await expect(svc.liveLineAction({ ...live, action: "freeze", orderId: 100 }, actor)).rejects.toThrow(/مقفلة/);
    repo.findOrderForInvoicing.mockResolvedValue({ effectiveDeliveryDate: "2026-11-01T09:00:00Z", id: 100, status: 5 });
    await expect(svc.liveAddOrder({ ...live, orderId: 100 }, actor)).rejects.toThrow();
    expect(repo.setLineState).not.toHaveBeenCalled();
    expect(repo.insertLines).not.toHaveBeenCalled();
    expect(repo.updateTotals).not.toHaveBeenCalled();
  });

  test("an order that is not on the invoice (billed elsewhere) is a 409", async () => {
    const { repo } = makeRepo();
    await expect(service(repo, open()).liveLineAction({ ...live, action: "delete", orderId: 999 }, actor)).rejects.toThrow(/غير مضمّن/);
    expect(repo.setLineState).not.toHaveBeenCalled();
  });

  test("liveAddOrder creates the draft then inserts the picked order; refuses one billed elsewhere", async () => {
    const { repo } = makeRepo();
    repo.findOrderForInvoicing.mockResolvedValue({ effectiveDeliveryDate: "2026-10-01T09:00:00Z", id: 300, status: 5 });
    const getReport = jest.fn(async () => report("2026-11-28T21:59:59.999Z", [reportOrder(300)]));
    const result = await service(repo, getReport).liveAddOrder({ ...live, orderId: 300 }, actor);
    expect(result).toMatchObject({ created: true, invoiceId: 1, alreadyIncluded: false });
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "line.added" }), expect.anything());

    const clash = makeRepo();
    clash.repo.findOrderForInvoicing.mockResolvedValue({ effectiveDeliveryDate: "2026-10-01T09:00:00Z", id: 300, status: 5 });
    clash.repo.insertLines.mockResolvedValue([] as never);
    await expect(service(clash.repo, getReport).liveAddOrder({ ...live, orderId: 300 }, actor)).rejects.toThrow(/فاتورة أخرى/);
  });

  test("liveAddOrder is idempotent when the draft top-up already counted the order", async () => {
    const { repo, state } = makeRepo();
    state.lines = [lineRow({ orderId: 300 })];
    repo.findOrderForInvoicing.mockResolvedValue({ effectiveDeliveryDate: "2026-10-01T09:00:00Z", id: 300, status: 5 });
    const getReport = jest.fn(async () => report("2026-11-28T21:59:59.999Z", [reportOrder(300)]));
    const result = await service(repo, getReport).liveAddOrder({ ...live, orderId: 300 }, actor);
    expect(result).toMatchObject({ alreadyIncluded: true, invoiceId: 1 });
    expect(repo.insertEvent).not.toHaveBeenCalledWith(expect.objectContaining({ action: "line.added" }), expect.anything());
  });
});

describe("vendor bank data by direction (staff finance_settle and the vendor himself only)", () => {
  const bankRow = { bankAccountHolderName: "أحمد", bankAccountNumber: "123456", bankName: "CIB", instaPayNumber: "010", walletNumber: null };
  const expected = { accountHolder: "أحمد", accountNumber: "123456", bankName: "CIB", instaPayNumber: "010", walletNumber: null };

  test("finance_settle staff get the vendor bank on the invoice detail; staff without it do not", async () => {
    const { repo, state } = makeRepo(invoice({ status: "reviewed", vendorId: 5 }));
    state.banks.set(5, bankRow);
    expect((await service(repo).detail(1, { canSettle: true })).vendorBank).toEqual(expected);
    expect(await service(repo).detail(1, { canSettle: false })).not.toHaveProperty("vendorBank");
    expect(await service(repo).detail(1, {})).not.toHaveProperty("vendorBank");
  });

  test("a vendor sees only his own bank on his own invoice; another vendor gets 404 and never the data", async () => {
    const { repo, state } = makeRepo(invoice({ status: "reviewed", vendorId: 5 }));
    state.banks.set(5, bankRow);
    state.banks.set(6, { ...bankRow, bankName: "OTHER" });
    expect((await service(repo).detail(1, { vendorId: 5 })).vendorBank).toEqual(expected);
    await expect(service(repo).detail(1, { vendorId: 6 })).rejects.toThrow(/غير موجودة/);
    // the lookup is keyed on the token's vendor, never on someone else's id
    expect(repo.listVendorBanks).toHaveBeenLastCalledWith([5]);
  });

  test("no bank data registered: allowed callers get null (the UI shows the «لم تُسجَّل» note)", async () => {
    const { repo } = makeRepo(invoice({ status: "reviewed", vendorId: 5 }));
    expect((await service(repo).detail(1, { canSettle: true })).vendorBank).toBeNull();
    expect((await service(repo).detail(1, { vendorId: 5 })).vendorBank).toBeNull();
  });

  test("blank strings count as no data", async () => {
    const { repo, state } = makeRepo(invoice({ status: "reviewed", vendorId: 5 }));
    state.banks.set(5, { bankAccountHolderName: "  ", bankAccountNumber: "", bankName: null, instaPayNumber: " ", walletNumber: null });
    expect((await service(repo).detail(1, { canSettle: true })).vendorBank).toBeNull();
  });

  test("live report seller rows: staff (settle) get every vendor's bank, a vendor only his own row, viewers nothing", async () => {
    const { repo, state } = makeRepo();
    state.banks.set(5, bankRow);
    state.banks.set(6, { ...bankRow, bankName: "OTHER" });
    const mk = () => ({
      fullInvoice: { items: [{ vendorId: 5 }, { vendorId: 6 }] },
      vendorDeliveries: { items: [{ vendorId: 5 }] },
      warehouseDeliveries: { items: [{ vendorId: 6 }] },
    });
    const staff = await service(repo).withVendorBanks(mk() as never, { canSettle: true }) as ReturnType<typeof mk> & { fullInvoice: { items: Array<{ vendorBank?: unknown }> } };
    expect(staff.fullInvoice.items[0]!.vendorBank).toEqual(expected);
    expect((staff.fullInvoice.items[1]!.vendorBank as { bankName: string }).bankName).toBe("OTHER");
    const own = await service(repo).withVendorBanks(mk() as never, { vendorId: 5 }) as typeof staff;
    expect(own.fullInvoice.items[0]!.vendorBank).toEqual(expected);
    expect(own.fullInvoice.items[1]).not.toHaveProperty("vendorBank");
    expect(repo.listVendorBanks).toHaveBeenLastCalledWith([5, 5]);
    const viewer = await service(repo).withVendorBanks(mk() as never, { canSettle: false }) as typeof staff;
    expect(viewer.fullInvoice.items[0]).not.toHaveProperty("vendorBank");
  });

  test("the transferred status label follows the direction of the net", () => {
    const { repo } = makeRepo();
    const svc = service(repo);
    expect(svc.toInvoiceDto(invoice({ netAmount: 100, status: "transferred" })).statusLabel).toBe("تم التحويل للبائع");
    expect(svc.toInvoiceDto(invoice({ netAmount: -100, status: "transferred" })).statusLabel).toBe("تم استلام التحويل من البائع");
    expect(svc.toInvoiceDto(invoice({ netAmount: -100, status: "transferred" })).dueParty).toBe("homix");
    expect(svc.toInvoiceDto(invoice({ netAmount: 0, status: "reviewed" })).dueParty).toBeNull();
  });
});
