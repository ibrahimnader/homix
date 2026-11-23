import { InvoiceService } from "./invoice.service";
import type { InvoiceRow, ReceiptRow } from "./invoice.types";

jest.mock("../../config/env", () => ({ env: { UPLOADS_DIR: "uploads" } }));

const NOW = new Date("2026-11-20T10:00:00Z");
const actor = { id: 9 };
const F = (name: string) => ({ name, path: `uploads/financial-receipts/${name}` });

const inv = (overrides: Partial<InvoiceRow> = {}): InvoiceRow => ({
  adjustmentsTotal: 0, billingDay: 13, code: "INV-1", collectionTotal: 0, companyDueTotal: 0, createdAt: NOW, finesTotal: 0,
  frozenAt: null, frozenDurationMs: 0, id: 1, netAmount: 100, ordersCount: 1, periodEnd: "2026-10-13T21:59:59.999Z",
  periodStart: "2026-09-28T22:00:00.000Z", receiptMime: null, receiptName: null, receiptPath: null, receiptUploadedAt: null,
  reviewedAt: null, status: "transferred", transferAmount: 100, transferredAt: NOW, updatedAt: NOW, vendorDueTotal: 0, vendorId: 5,
  vendorName: "ركة", vendorShippingCost: 0, warehouseCost: 0, ...overrides,
});

const makeRepo = (current: InvoiceRow, receipts: ReceiptRow[] = []) => {
  const db = { current, events: [] as Array<Record<string, unknown>>, nextId: 50, receipts };
  const repo = {
    findInvoice: jest.fn(async () => db.current),
    findReceipt: jest.fn(async (_i: number, id: number) => db.receipts.find((row) => Number(row.id) === Number(id) && !row.deletedAt)),
    insertEvent: jest.fn(async (event: Record<string, unknown>) => { db.events.push(event); }),
    insertReceipt: jest.fn(async (invoiceId: number, input: Omit<ReceiptRow, "id" | "invoiceId">) => {
      const row = { ...input, id: db.nextId++, invoiceId } as ReceiptRow;
      db.receipts.push(row);
      return row;
    }),
    listReceipts: jest.fn(async () => db.receipts.filter((row) => !row.deletedAt)),
    softDeleteReceipt: jest.fn(async (id: number) => { db.receipts.find((row) => Number(row.id) === Number(id))!.deletedAt = NOW; }),
    transaction: jest.fn(async (work: (tx: unknown) => unknown) => work({})),
    updateInvoiceFields: jest.fn(async (_id: number, fields: Record<string, unknown>) => { Object.assign(db.current, fields); }),
  };
  return { db, repo };
};
const rec = (id: number, name: string, extra: Partial<ReceiptRow> = {}): ReceiptRow => ({
  id, invoiceId: 1, mime: name.endsWith(".pdf") ? "application/pdf" : "image/png", name, path: `uploads/financial-receipts/${name}`, size: 10, uploadedAt: NOW, uploadedBy: 7, ...extra,
});
const make = (repo: unknown) => {
  const removeStoredFile = jest.fn(async () => undefined);
  return { removeStoredFile, service: new InvoiceService({ getReport: jest.fn(), now: () => NOW, removeStoredFile, repo: repo as never, statStoredFile: jest.fn(async () => 1234) }) };
};

describe("addReceipts", () => {
  test("adds several receipts in order with size/mime and one audit event", async () => {
    const { db, repo } = makeRepo(inv());
    const { service } = make(repo);
    const result = await service.addReceipts(1, [F("a.pdf"), F("b.png"), F("c.jpg")], actor);
    expect(result.count).toBe(3);
    expect(db.receipts.map((row) => [row.name, row.mime, row.size, row.uploadedBy])).toEqual([
      ["a.pdf", "application/pdf", 1234, 9], ["b.png", "image/png", 1234, 9], ["c.jpg", "image/jpeg", 1234, 9],
    ]);
    expect(db.events).toEqual([expect.objectContaining({ action: "receipt.uploaded", actorId: 9, detail: expect.objectContaining({ count: 3, fileNames: ["a.pdf", "b.png", "c.jpg"] }) })]);
  });

  test("a second upload appends after the first (does not replace)", async () => {
    const { db, repo } = makeRepo(inv(), [rec(1, "a.pdf")]);
    const { removeStoredFile, service } = make(repo);
    const result = await service.addReceipts(1, [F("b.png")], actor);
    expect(result.count).toBe(2);
    expect(db.receipts.map((row) => row.name)).toEqual(["a.pdf", "b.png"]);
    expect(removeStoredFile).not.toHaveBeenCalled();
  });

  test("only on a transferred invoice; the stored files are deleted when refused", async () => {
    for (const status of ["draft", "reviewed", "frozen"] as const) {
      const { repo } = makeRepo(inv({ status }));
      const { removeStoredFile, service } = make(repo);
      await expect(service.addReceipts(1, [F("a.pdf")], actor)).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("تم التحويل") });
      expect(repo.insertReceipt).not.toHaveBeenCalled();
      expect(removeStoredFile).toHaveBeenCalledWith("uploads/financial-receipts/a.pdf");
    }
  });

  test("caps files per request and receipts per invoice, deleting the new files", async () => {
    const many = Array.from({ length: 11 }, (_, i) => F(`f${i}.pdf`));
    const first = makeRepo(inv());
    const a = make(first.repo);
    await expect(a.service.addReceipts(1, many, actor)).rejects.toMatchObject({ statusCode: 400 });
    expect(a.removeStoredFile).toHaveBeenCalledTimes(11);

    const full = makeRepo(inv(), Array.from({ length: 19 }, (_, i) => rec(i + 1, `x${i}.pdf`)));
    const b = make(full.repo);
    await expect(b.service.addReceipts(1, [F("n1.pdf"), F("n2.pdf")], actor)).rejects.toMatchObject({ statusCode: 409 });
    expect(b.removeStoredFile).toHaveBeenCalledTimes(2);
    expect(full.repo.insertReceipt).not.toHaveBeenCalled();
  });

  test("a legacy single receipt is kept as the first item (materialized, not replaced)", async () => {
    const legacy = { receiptMime: "application/pdf", receiptName: "old.pdf", receiptPath: "uploads/financial-receipts/old.pdf", receiptUploadedAt: NOW };
    const { db, repo } = makeRepo(inv(legacy));
    const { removeStoredFile, service } = make(repo);
    await service.addReceipts(1, [F("new.png")], actor);
    expect(db.receipts.map((row) => row.name)).toEqual(["old.pdf", "new.png"]);
    expect(removeStoredFile).not.toHaveBeenCalled();
    const list = await service.listReceipts(1, { canSettle: true });
    expect(list.map((row) => row.name)).toEqual(["old.pdf", "new.png"]);
  });
});

describe("listReceipts / receiptFor", () => {
  test("the legacy receipt shows up as the first item with id 0 until it is a row", async () => {
    const { repo } = makeRepo(inv({ receiptMime: "application/pdf", receiptName: "old.pdf", receiptPath: "uploads/financial-receipts/old.pdf" }), [rec(7, "b.png")]);
    const { service } = make(repo);
    expect((await service.listReceipts(1, { canSettle: true })).map((row) => [row.id, row.name])).toEqual([[0, "old.pdf"], [7, "b.png"]]);
    await expect(service.receiptFor(1, { canSettle: true })).resolves.toMatchObject({ name: "old.pdf", mime: "application/pdf" });
    await expect(service.receiptFor(1, { canSettle: true }, 7)).resolves.toMatchObject({ name: "b.png" });
    await expect(service.receiptFor(1, { canSettle: true }, 99)).rejects.toMatchObject({ statusCode: 404 });
  });

  test("a backfilled legacy receipt is not listed twice", async () => {
    const { repo } = makeRepo(inv({ receiptName: "a.pdf", receiptPath: "uploads/financial-receipts/a.pdf" }), [rec(1, "a.pdf")]);
    expect(await make(repo).service.listReceipts(1, { canSettle: true })).toHaveLength(1);
  });

  test("vendors: only their own TRANSFERRED invoice; no uploader id; another vendor 404", async () => {
    const own = makeRepo(inv(), [rec(1, "a.pdf")]);
    const list = await make(own.repo).service.listReceipts(1, { vendorId: 5 });
    expect(list).toEqual([expect.not.objectContaining({ uploadedBy: expect.anything() })]);
    await expect(make(own.repo).service.receiptFor(1, { vendorId: 5 }, 1)).resolves.toMatchObject({ name: "a.pdf" });
    await expect(make(own.repo).service.listReceipts(1, { vendorId: 6 })).rejects.toMatchObject({ statusCode: 404 });
    const reviewed = makeRepo(inv({ status: "reviewed" }), [rec(1, "a.pdf")]);
    await expect(make(reviewed.repo).service.listReceipts(1, { vendorId: 5 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(make(reviewed.repo).service.receiptFor(1, { vendorId: 5 })).rejects.toMatchObject({ statusCode: 403 });
    const staff = await make(own.repo).service.listReceipts(1, { canSettle: true });
    expect(staff[0]).toMatchObject({ uploadedBy: 7 });
  });
});

describe("removeReceipt", () => {
  test("soft-deletes one receipt, deletes its file, keeps the others, audits", async () => {
    const { db, repo } = makeRepo(inv(), [rec(1, "a.pdf"), rec(2, "b.png")]);
    const { removeStoredFile, service } = make(repo);
    await service.removeReceipt(1, 1, actor);
    expect(db.receipts.find((row) => row.id === 1)!.deletedAt).toBeTruthy();
    expect(db.receipts.find((row) => row.id === 2)!.deletedAt).toBeUndefined();
    expect(removeStoredFile).toHaveBeenCalledWith("uploads/financial-receipts/a.pdf");
    expect(db.events).toEqual([expect.objectContaining({ action: "receipt.removed", detail: expect.objectContaining({ fileName: "a.pdf", receiptId: 1 }) })]);
  });

  test("only while the invoice is transferred (same rule as the single receipt); unknown receipt is 404", async () => {
    for (const status of ["reviewed", "frozen", "draft"] as const) {
      const { repo } = makeRepo(inv({ status }), [rec(1, "a.pdf")]);
      await expect(make(repo).service.removeReceipt(1, 1, actor)).rejects.toMatchObject({ statusCode: 409 });
      expect(repo.softDeleteReceipt).not.toHaveBeenCalled();
    }
    const { repo } = makeRepo(inv(), [rec(1, "a.pdf")]);
    await expect(make(repo).service.removeReceipt(1, 9, actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  test("removing the legacy receipt (id 0) materializes it, removes it and clears the legacy columns", async () => {
    const { db, repo } = makeRepo(inv({ receiptMime: "application/pdf", receiptName: "old.pdf", receiptPath: "uploads/financial-receipts/old.pdf" }));
    const { removeStoredFile, service } = make(repo);
    await service.removeReceipt(1, 0, actor);
    expect(db.receipts[0]).toMatchObject({ name: "old.pdf" });
    expect(db.receipts[0]!.deletedAt).toBeTruthy();
    expect(db.current.receiptPath).toBeNull();
    expect(removeStoredFile).toHaveBeenCalledWith("uploads/financial-receipts/old.pdf");
  });
});

describe("any receipt blocks reverting to draft", () => {
  test("reviewed -> draft refused with a receipt row (not only the legacy column); allowed without one", async () => {
    const withRow = makeRepo(inv({ receiptsCount: 2, status: "reviewed", transferAmount: null, transferredAt: null }));
    await expect(make(withRow.repo).service.transition(1, "draft", {}, actor)).rejects.toThrow(/إيصال/);
    const none = makeRepo(inv({ receiptsCount: 0, status: "reviewed", transferAmount: null, transferredAt: null }));
    await expect(make({ ...none.repo, nextInvoiceSequence: jest.fn() }).service.transition(1, "draft", {}, actor)).resolves.toBeDefined();
  });
});
