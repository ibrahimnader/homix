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
  const state = { adjustments: [] as never[], current, lines: [] as LineRow[] };
  const repo = {
    findInvoice: jest.fn(async () => state.current),
    findLine: jest.fn(async (_i: unknown, lineId: number) => state.lines.find((row) => Number(row.id) === Number(lineId))),
    findLockedOrderIds: jest.fn(async () => new Set<number>()),
    findOrderForInvoicing: jest.fn(),
    insertAdjustment: jest.fn(async (_i: unknown, input: Record<string, unknown>) => ({ ...input, createdAt: NOW, id: 3, removedAt: null })),
    insertEvent: jest.fn(async () => undefined),
    insertLines: jest.fn(async (_i: unknown, snapshots: Array<{ orderId: number }>) => snapshots.map((row) => row.orderId)),
    listAdjustments: jest.fn(async () => state.adjustments),
    listLines: jest.fn(async () => state.lines),
    listPickableDeferred: jest.fn(async () => [] as LineRow[]),
    nextInvoiceSequence: jest.fn(async () => 7),
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
  test("refuses a cycle that has not closed yet", async () => {
    const { repo } = makeRepo();
    const getReport = jest.fn(async () => report("2026-11-28T21:59:59.999Z"));
    await expect(service(repo, getReport).generate({ billingDay: 28 }, actor)).rejects.toThrow(/لم تُغلق/);
    expect(repo.upsertDraft).not.toHaveBeenCalled();
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

  test("list forces the vendor's own id and visible statuses whatever the query says", async () => {
    const { repo } = makeRepo();
    const listInvoices = jest.fn(async () => ({ rows: [], total: 0 }));
    const svc = service({ ...repo, countByStatus: jest.fn(async () => ({})), listInvoices });
    await svc.list({ page: 1, size: 10, statuses: ["draft", "frozen"], vendorId: 99 }, { vendorId: 5 });
    expect(listInvoices).toHaveBeenCalledWith(expect.objectContaining({ statuses: ["reviewed", "transferred"], vendorId: 5 }));
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
  test("receipt upload only on transferred invoices; replaced file is removed", async () => {
    const draft = makeRepo(invoice({ status: "reviewed" }));
    await expect(service(draft.repo).setReceipt(1, { name: "a.pdf", path: "uploads/financial-receipts/a.pdf" }, actor)).rejects.toThrow(/تم التحويل/);
    const transferred = makeRepo(invoice({ receiptPath: "uploads/financial-receipts/old.pdf", status: "transferred" }));
    const remove = jest.fn(async () => undefined);
    const svc = new InvoiceService({ getReport: jest.fn(), now: () => NOW, removeStoredFile: remove, repo: transferred.repo as never });
    await svc.setReceipt(1, { name: "a.pdf", path: "uploads/financial-receipts/a.pdf" }, actor);
    expect(remove).toHaveBeenCalledWith("uploads/financial-receipts/old.pdf");
    expect(transferred.repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "receipt.uploaded", actorId: 9 }), expect.anything());
  });

  test("reconciliation computes the difference and logs it", async () => {
    const { repo } = makeRepo();
    const svc = service({ ...repo, transferredTotal: jest.fn(async () => ({ count: 2, totalCents: 310000 })) });
    const result = await svc.recordReconciliation({ bankTotal: 3000 }, actor);
    expect(result).toMatchObject({ bankTotal: 3000, count: 2, difference: -100, systemTotal: 3100 });
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "reconciliation.recorded", actorId: 9 }), expect.anything());
  });
});
