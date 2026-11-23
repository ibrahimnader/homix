import { InvoiceService } from "./invoice.service";
import type { AdjustmentRow, InvoiceRow, LineRow } from "./invoice.types";

jest.mock("../../config/env", () => ({ env: { UPLOADS_DIR: "uploads" } }));

const NOW = new Date("2026-11-20T10:00:00Z");
const actor = { id: 9 };

const inv = (id: number, overrides: Partial<InvoiceRow> = {}): InvoiceRow => ({
  adjustmentsTotal: 0, billingDay: 13, code: null, collectionTotal: 0, companyDueTotal: 0, createdAt: NOW, finesTotal: 0,
  frozenAt: null, frozenDurationMs: 0, id, kind: "standard", mergedCode: null, mergedIntoId: null, netAmount: 0, ordersCount: 0,
  periodEnd: "2026-10-13T21:59:59.999Z", periodStart: "2026-09-28T22:00:00.000Z", preMergeStatus: null, receiptsCount: 0,
  receiptMime: null, receiptName: null, receiptPath: null, receiptUploadedAt: null, reviewedAt: null, status: "draft",
  transferAmount: null, transferredAt: null, updatedAt: NOW, vendorDueTotal: 0, vendorId: 5, vendorName: "ركة", vendorShippingCost: 0, warehouseCost: 0,
  ...overrides,
});
/** vendor-delivery line: the vendor owes Homix `companyDue`; warehouse line: Homix owes the vendor `vendorDue`. */
const line = (id: number, invoiceId: number, o: Partial<LineRow> = {}): LineRow => ({
  collectionTotal: 0, companyDue: 0, companyDueKind: "margin", companyDueOverride: null, fines: 0, finesOverride: null, id, invoiceId,
  isWarehouseDelivery: true, operationNumber: `OP${id}`, orderId: 100 + id, orderNumber: String(id), overrideReason: null, paymentStatus: 1,
  paymentStatusLabel: "", productCode: "A", state: "included", stateChangedAt: null, stateReason: null, vendorDue: 0, vendorDueOverride: null,
  vendorShippingCost: 0, warehouseCost: 0, sourceInvoiceId: null, ...o,
});
const adj = (id: number, invoiceId: number, o: Partial<AdjustmentRow> = {}): AdjustmentRow => ({
  amount: 10, createdAt: NOW, id, invoiceId, kind: "addition", label: "x", removedAt: null, sourceInvoiceId: null, ...o,
});

/** In-memory repository implementing the consolidation SQL semantics, with call logging for lock order. */
const makeRepo = (invoices: InvoiceRow[], lines: LineRow[], adjustments: AdjustmentRow[] = []) => {
  const db = { adjustments, calls: [] as string[], codes: [] as string[], events: [] as Array<Record<string, unknown>>, invoices, lines, nextId: 100 };
  const byId = (id: number | string) => db.invoices.find((row) => Number(row.id) === Number(id));
  const repo = {
    cancelConsolidated: jest.fn(async (id: number) => { const row = byId(id)!; row.status = "cancelled"; row.code = null; }),
    findInvoice: jest.fn(async (id: number) => byId(id) ?? null),
    insertConsolidated: jest.fn(async (input: Record<string, unknown>) => {
      const row = inv(db.nextId++, { billingDay: input.billingDay as number, code: input.code as string, kind: "consolidated", periodEnd: input.periodEnd as string, periodStart: input.periodStart as string, vendorId: input.vendorId as number });
      db.invoices.push(row);
      return row;
    }),
    insertEvent: jest.fn(async (event: Record<string, unknown>) => { db.events.push(event); }),
    listAdjustments: jest.fn(async (id: number) => db.adjustments.filter((row) => Number(row.invoiceId) === Number(id))),
    listCodesWithPrefix: jest.fn(async (prefix: string) => [...db.invoices.map((row) => row.code).filter((c): c is string => Boolean(c) && c!.startsWith(prefix)), ...db.codes.filter((c) => c.startsWith(prefix))]),
    listVendorBanks: jest.fn(async () => new Map()),
    listLines: jest.fn(async (id: number) => db.lines.filter((row) => Number(row.invoiceId) === Number(id))),
    listMergedSources: jest.fn(async (id: number) => db.invoices.filter((row) => Number(row.mergedIntoId) === Number(id))),
    lockInvoices: jest.fn(async (ids: number[]) => { db.calls.push(`lock:${ids.join(",")}`); return db.invoices.filter((row) => ids.includes(Number(row.id))); }),
    lockMergedSources: jest.fn(async (id: number) => { db.calls.push(`lockSources:${id}`); return db.invoices.filter((row) => Number(row.mergedIntoId) === Number(id)); }),
    markMerged: jest.fn(async (ids: number[], input: { mergedCode: string; mergedIntoId: number }) => {
      for (const row of db.invoices.filter((r) => ids.includes(Number(r.id)))) {
        row.preMergeStatus = row.status; row.status = "consolidated"; row.mergedIntoId = input.mergedIntoId; row.mergedCode = input.mergedCode;
      }
    }),
    moveBackFromConsolidated: jest.fn(async (consolidatedId: number, fallbackId: number) => {
      for (const row of [...db.lines, ...db.adjustments].filter((r) => Number(r.invoiceId) === Number(consolidatedId))) {
        row.invoiceId = row.sourceInvoiceId ?? fallbackId; row.sourceInvoiceId = null;
      }
    }),
    moveToConsolidated: jest.fn(async (ids: number[], targetId: number) => {
      const move = (rows: Array<{ invoiceId: number | string; sourceInvoiceId?: number | string | null }>) => rows.filter((r) => ids.includes(Number(r.invoiceId))).map((r) => { r.sourceInvoiceId = r.invoiceId; r.invoiceId = targetId; }).length;
      return { adjustments: move(db.adjustments), lines: move(db.lines) };
    }),
    nextInvoiceSequence: jest.fn(async () => 42),
    restoreMerged: jest.fn(async (id: number, status: InvoiceRow["status"]) => { const row = byId(id)!; row.status = status; row.preMergeStatus = null; row.mergedIntoId = null; row.mergedCode = null; }),
    transaction: jest.fn(async (work: (tx: unknown) => unknown) => work({})),
    updateTotals: jest.fn(async (id: number, totals: Record<string, number>) => { Object.assign(byId(id)!, totals); }),
  };
  return { db, repo };
};
const svc = (repo: unknown) => new InvoiceService({ getReport: jest.fn(), now: () => NOW, removeStoredFile: jest.fn(), repo: repo as never });

// cycle 13 Oct: vendor owes Homix 300 (vendor delivery, balance +300);  cycle 28 Oct: Homix owes vendor 1000 (gross) with 100 fines
const setup = () => makeRepo(
  [
    inv(1, { code: "INV-2026-0001", netAmount: -300, ordersCount: 1, status: "reviewed", companyDueTotal: 300 }),
    inv(2, { code: "INV-2026-0002", netAmount: 900, ordersCount: 1, periodEnd: "2026-10-28T21:59:59.999Z", periodStart: "2026-10-13T22:00:00.000Z", billingDay: 28, status: "draft" }),
  ],
  [
    line(11, 1, { companyDue: 300, companyDueKind: "vendorOwes", isWarehouseDelivery: false }),
    line(21, 2, { fines: 100, vendorDue: 1000, finesOverride: 100 }),
  ],
  [adj(31, 1, { amount: 50, kind: "addition" }), adj(32, 2, { amount: 20, kind: "deduction", removedAt: NOW })],
);

describe("consolidate", () => {
  test("moves lines and adjustments, keeps their source, offsets the signed net and hides the sources", async () => {
    const { db, repo } = setup();
    const result = await svc(repo).consolidate([2, 1], actor);

    const target = db.invoices.find((row) => row.kind === "consolidated")!;
    expect(target).toMatchObject({ billingDay: 28, code: "INV-2026-0002-ALL", status: "draft", vendorId: 5 });
    expect(target.periodEnd).toBe("2026-10-28T21:59:59.999Z"); // the latest source cycle
    expect(db.lines.map((l) => [Number(l.id), Number(l.invoiceId), Number(l.sourceInvoiceId)])).toEqual([[11, 100, 1], [21, 100, 2]]);
    expect(db.adjustments.map((a) => [Number(a.id), Number(a.invoiceId), Number(a.sourceInvoiceId)])).toEqual([[31, 100, 1], [32, 100, 2]]);
    // net = vendor due 1000 − Homix due 300 − fines 100 + adjustment 50 (the removed adjustment does not count) = +650
    expect(target.netAmount).toBe(650);
    expect(result.invoice).toMatchObject({ dueParty: "vendor", kind: "consolidated", netAmount: 650, status: "draft" });
    expect(db.invoices.filter((row) => row.kind === "standard").map((row) => [row.status, row.mergedIntoId, row.mergedCode, row.preMergeStatus])).toEqual([
      ["consolidated", 100, "INV-2026-0002-ALL", "reviewed"], ["consolidated", 100, "INV-2026-0002-ALL", "draft"],
    ]);
    expect(result.sources.map((s) => [s.id, s.netAmount, s.status])).toEqual([[1, -300, "reviewed"], [2, 900, "draft"]]);
  });

  test("offsetting balances: the combined net flips sign when the vendor owes more than he is owed", async () => {
    const { db, repo } = setup();
    db.lines[1]!.vendorDue = 100; db.lines[1]!.finesOverride = 0; db.lines[1]!.fines = 0;
    db.adjustments.length = 0;
    const { invoice } = await svc(repo).consolidate([1, 2], actor);
    expect(invoice).toMatchObject({ dueParty: "homix", netAmount: -200 });
  });

  test("code: base of the latest source (or a fresh sequence number) + -ALL, -ALL2 when taken", async () => {
    const taken = setup();
    taken.db.codes = ["INV-2026-0002-ALL"];
    await svc(taken.repo).consolidate([1, 2], actor);
    expect(taken.db.invoices.find((row) => row.kind === "consolidated")!.code).toBe("INV-2026-0002-ALL2");

    const fresh = setup();
    fresh.db.invoices[1]!.code = null;
    await svc(fresh.repo).consolidate([1, 2], actor);
    expect(fresh.repo.nextInvoiceSequence).toHaveBeenCalledTimes(1);
    expect(fresh.db.invoices.find((row) => row.kind === "consolidated")!.code).toBe("INV-2026-0042-ALL");
  });

  test("audits on the consolidated invoice and on every source", async () => {
    const { db, repo } = setup();
    await svc(repo).consolidate([1, 2], actor);
    expect(db.events.filter((e) => e.action === "invoice.consolidated").map((e) => [e.invoiceId, e.toStatus])).toEqual([[100, "draft"], [1, "consolidated"], [2, "consolidated"]]);
    expect(db.events[0]).toMatchObject({ actorId: 9, detail: expect.objectContaining({ code: "INV-2026-0002-ALL", lines: 2, netAmount: 650 }) });
  });

  test("locks all the sources (ascending, once, before anything is written) so concurrent merges serialize", async () => {
    const { db, repo } = setup();
    await svc(repo).consolidate([2, 1], actor);
    expect(repo.lockInvoices).toHaveBeenCalledTimes(1);
    expect(repo.lockInvoices.mock.calls[0]![0]).toEqual([1, 2]);
    expect(repo.lockInvoices.mock.invocationCallOrder[0]!).toBeLessThan(repo.insertConsolidated.mock.invocationCallOrder[0]!);
    expect(db.calls).toEqual(["lock:1,2"]);
  });

  test("a second concurrent merge of the same invoices loses: the locked re-read shows them merged (409), nothing is written", async () => {
    const { db, repo } = setup();
    await svc(repo).consolidate([1, 2], actor);
    const writes = repo.insertConsolidated.mock.calls.length;
    await expect(svc(repo).consolidate([1, 2], actor)).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("مدمجة بالفعل") });
    expect(repo.insertConsolidated).toHaveBeenCalledTimes(writes);
    expect(db.invoices.filter((row) => row.kind === "consolidated")).toHaveLength(1);
  });

  describe("refusals (409, Arabic reason)", () => {
    const refuse = async (mutate: (db: ReturnType<typeof setup>["db"]) => void, pattern: RegExp) => {
      const { db, repo } = setup();
      mutate(db);
      await expect(svc(repo).consolidate([1, 2], actor)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(pattern) });
      expect(repo.insertConsolidated).not.toHaveBeenCalled();
      expect(repo.moveToConsolidated).not.toHaveBeenCalled();
    };
    test("different vendors", () => refuse((db) => { db.invoices[1]!.vendorId = 6; }, /بائعين مختلفين/));
    test("frozen", () => refuse((db) => { db.invoices[0]!.status = "frozen"; }, /مجمدة/));
    test("transferred", () => refuse((db) => { db.invoices[0]!.status = "transferred"; }, /تم التحويل/));
    test("already merged", () => refuse((db) => { db.invoices[0]!.status = "consolidated"; db.invoices[0]!.mergedIntoId = 7; }, /مدمجة بالفعل/));
    test("a consolidated invoice itself", () => refuse((db) => { db.invoices[0]!.kind = "consolidated"; }, /فاتورة شاملة بالفعل/));
    test("with a receipt", () => refuse((db) => { db.invoices[0]!.receiptsCount = 1; }, /إيصال/));
    test("with transfer data", () => refuse((db) => { db.invoices[0]!.transferAmount = 10; }, /بيانات تحويل/));
  });

  test("needs two distinct invoices and all of them to exist", async () => {
    const { repo } = setup();
    await expect(svc(repo).consolidate([1], actor)).rejects.toThrow(/فاتورتين/);
    await expect(svc(repo).consolidate([1, 99], actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  test("a consolidated invoice can only be reviewed after the latest cycle ended (existing rule)", async () => {
    const { db, repo } = setup();
    db.invoices[1]!.periodEnd = "2026-11-28T21:59:59.999Z"; // still open at NOW
    await svc(repo).consolidate([1, 2], actor);
    const target = db.invoices.find((row) => row.kind === "consolidated")!;
    await expect(svc(repo).transition(Number(target.id), "reviewed", {}, actor)).rejects.toThrow(/الدورة لم تنتهِ بعد/);
  });
});

describe("unconsolidate", () => {
  test("moves everything back, restores each previous status, cancels the consolidated invoice and audits", async () => {
    const { db, repo } = setup();
    await svc(repo).consolidate([1, 2], actor);
    db.events.length = 0;
    const result = await svc(repo).unconsolidate(100, actor);

    expect(db.lines.map((l) => [Number(l.id), Number(l.invoiceId), l.sourceInvoiceId])).toEqual([[11, 1, null], [21, 2, null]]);
    expect(db.adjustments.map((a) => [Number(a.id), Number(a.invoiceId)])).toEqual([[31, 1], [32, 2]]);
    expect(db.invoices.filter((row) => row.kind === "standard").map((row) => [row.status, row.mergedIntoId, row.mergedCode])).toEqual([["reviewed", null, null], ["draft", null, null]]);
    expect(db.invoices.find((row) => Number(row.id) === 100)).toMatchObject({ code: null, status: "cancelled" });
    expect(db.invoices[0]!.netAmount).toBe(-250); // recomputed from its own line + adjustment (+50)
    expect(result.restored.map((r) => [r.id, r.status])).toEqual([[1, "reviewed"], [2, "draft"]]);
    expect(db.events.filter((e) => e.action === "invoice.unconsolidated").map((e) => [e.invoiceId, e.fromStatus, e.toStatus])).toEqual([
      [1, "consolidated", "reviewed"], [2, "consolidated", "draft"], [100, "draft", "cancelled"],
    ]);
  });

  test("lines added to the consolidated invoice itself go back to the latest source", async () => {
    const { db, repo } = setup();
    await svc(repo).consolidate([1, 2], actor);
    db.lines.push(line(77, 100));
    await svc(repo).unconsolidate(100, actor);
    expect(Number(db.lines.find((l) => Number(l.id) === 77)!.invoiceId)).toBe(2);
  });

  test("refused once reviewed-then-transferred, frozen, with a receipt, or when it is not a live consolidated invoice", async () => {
    for (const mutate of [
      (row: InvoiceRow) => { row.status = "transferred"; row.transferredAt = NOW; },
      (row: InvoiceRow) => { row.status = "frozen"; },
      (row: InvoiceRow) => { row.status = "reviewed"; row.receiptsCount = 1; },
    ]) {
      const { db, repo } = setup();
      await svc(repo).consolidate([1, 2], actor);
      mutate(db.invoices.find((row) => Number(row.id) === 100)!);
      await expect(svc(repo).unconsolidate(100, actor)).rejects.toMatchObject({ statusCode: 409 });
      expect(repo.moveBackFromConsolidated).not.toHaveBeenCalled();
    }
    const { repo } = setup();
    await expect(svc(repo).unconsolidate(1, actor)).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("ليست فاتورة شاملة") });
  });

  test("a reviewed consolidated invoice can be undone (draft/reviewed, no receipt)", async () => {
    const { db, repo } = setup();
    await svc(repo).consolidate([1, 2], actor);
    db.invoices.find((row) => Number(row.id) === 100)!.status = "reviewed";
    await expect(svc(repo).unconsolidate(100, actor)).resolves.toMatchObject({ cancelledId: 100 });
  });

  test("locks the consolidated invoice, then its sources, before moving anything", async () => {
    const { db, repo } = setup();
    await svc(repo).consolidate([1, 2], actor);
    db.calls.length = 0;
    await svc(repo).unconsolidate(100, actor);
    expect(db.calls).toEqual(["lockSources:100"]);
    expect(repo.lockMergedSources.mock.invocationCallOrder[0]!).toBeLessThan(repo.moveBackFromConsolidated.mock.invocationCallOrder[0]!);
  });
});

describe("presentation", () => {
  test("editing a merged source is refused with a pointer to the consolidated invoice; mergeable flag follows the rules", async () => {
    const { db, repo } = setup();
    expect(svc(repo).toInvoiceDto(db.invoices[0]!).mergeable).toBe(true);
    await svc(repo).consolidate([1, 2], actor);
    const dto = svc(repo).toInvoiceDto(db.invoices[0]!);
    expect(dto).toMatchObject({ mergeable: false, mergedCode: "INV-2026-0002-ALL", mergedIntoId: 100, status: "consolidated", statusLabel: "مدمجة في فاتورة شاملة" });
    await expect(svc(repo).addAdjustment(1, { amount: 5, kind: "addition", label: "x" }, actor)).rejects.toThrow(/INV-2026-0002-ALL/);
  });

  test("detail of a consolidated invoice lists its sources with cycle / month / net; vendors can't see merged sources", async () => {
    const { db, repo } = setup();
    await svc(repo).consolidate([1, 2], actor);
    const detail = await svc(repo).detail(100, { canSettle: true });
    expect((detail as { sources: unknown[] }).sources).toEqual([
      expect.objectContaining({ id: 1, month: "2026-10", netAmount: -300, status: "reviewed", dueParty: "homix" }),
      expect.objectContaining({ id: 2, month: "2026-10", netAmount: 900, status: "draft", dueParty: "vendor" }),
    ]);
    expect(detail.lines.map((l) => l.sourceInvoiceId)).toEqual([1, 2]);
    await expect(svc(repo).detail(1, { vendorId: 5 })).rejects.toMatchObject({ statusCode: 404 });
    db.invoices.find((row) => Number(row.id) === 100)!.status = "reviewed";
    await expect(svc(repo).detail(100, { vendorId: 5 })).resolves.toBeDefined();
  });
});
