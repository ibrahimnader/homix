import { detectInvoiceIssues, summarizeIssues, type DetectInput, type IssueInvoice, type IssueLine, type LiveOrder } from "./invoice.issues";

const inv = (id: number, vendorId: number, periodEnd: string, over: Partial<IssueInvoice> = {}): IssueInvoice =>
  ({ billingDay: 28, code: `INV-${id}`, id, netAmount: 0, periodEnd, status: "draft", vendorId, vendorName: `V${vendorId}`, ...over });
let lineSeq = 0;
const ln = (invoiceId: number, orderId: number, operationNumber: string, over: Partial<IssueLine> = {}): IssueLine => ({
  collectionTotal: 100, companyDue: 0, finesOverride: null, companyDueOverride: null, fines: 0, id: ++lineSeq, invoiceId, isWarehouseDelivery: true,
  operationNumber, orderId, orderNumber: `N${orderId}`, state: "included", vendorDue: 0, vendorDueOverride: null, vendorShippingCost: 0, warehouseCost: 100,
  ...over,
});
const liveOk: LiveOrder = { deletedAt: null, deliveryBy: 1, shipmentStatus: 4, status: 5 };

const run = (invoices: IssueInvoice[], lines: IssueLine[], orders?: Map<number, LiveOrder>, scope?: number[]) =>
  detectInvoiceIssues({
    adjustments: [], invoices, lines,
    orders: orders ?? new Map(lines.map((line) => [Number(line.orderId), liveOk])),
    scopeInvoiceIds: new Set(scope ?? invoices.map((invoice) => Number(invoice.id))),
  } as DetectInput);
const types = (issues: ReturnType<typeof run>) => issues.map((issue) => issue.type).sort();

describe("detectInvoiceIssues", () => {
  test("clean data yields nothing", () => {
    const lines = [ln(1, 10, "OP1", { vendorDue: 100, warehouseCost: 100, collectionTotal: 100 })];
    const issues = run([inv(1, 1, "2026-10-28T00:00:00Z", { netAmount: 100 })], lines);
    expect(issues).toEqual([]);
  });

  test("1: same operation on different vendors", () => {
    const issues = run([inv(1, 1, "2026-10-28"), inv(2, 2, "2026-10-28")], [ln(1, 10, "OP1"), ln(2, 11, "OP1")]);
    expect(types(issues)).toEqual(["cross_vendor"]);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.occurrences).toHaveLength(2);
  });

  test("2: same operation twice in one invoice", () => {
    const issues = run([inv(1, 1, "2026-10-28")], [ln(1, 10, "OP1"), ln(1, 11, "OP1")]);
    expect(types(issues)).toEqual(["dup_in_invoice"]);
  });

  test("3: same vendor, different cycles", () => {
    const issues = run([inv(1, 1, "2026-09-28"), inv(2, 1, "2026-10-28")], [ln(1, 10, "OP1"), ln(2, 11, "OP1")]);
    expect(types(issues)).toEqual(["dup_cross_cycle"]);
  });

  test("4: same vendor, two invoices of the same cycle", () => {
    const issues = run([inv(1, 1, "2026-10-28"), inv(2, 1, "2026-10-28")], [ln(1, 10, "OP1"), ln(2, 11, "OP1")]);
    expect(types(issues)).toEqual(["dup_same_cycle"]);
  });

  test("deferred and removed lines do not count as duplicates", () => {
    const issues = run([inv(1, 1, "2026-09-28"), inv(2, 1, "2026-10-28")],
      [ln(1, 10, "OP1", { state: "deferred" }), ln(1, 12, "OP1", { state: "removed" }), ln(2, 11, "OP1")]);
    expect(types(issues)).toEqual([]);
  });

  test("duplicates only touching out-of-scope invoices are ignored", () => {
    const issues = run([inv(1, 1, "2026-09-28"), inv(2, 1, "2026-10-28")], [ln(1, 10, "OP1"), ln(2, 11, "OP1")], undefined, []);
    expect(issues).toEqual([]);
  });

  test("5: missing operation number", () => {
    const issues = run([inv(1, 1, "2026-10-28")], [ln(1, 10, "  ")]);
    expect(types(issues)).toEqual(["missing_operation"]);
    expect(issues[0]!.severity).toBe("warning");
  });

  test("6: company due (vendorOwes) and vendor due together", () => {
    const line = ln(1, 10, "OP1", { companyDue: 50, companyDueKind: "vendorOwes", vendorDue: 30, warehouseCost: 30, collectionTotal: 80, isWarehouseDelivery: false });
    // dues come from overrides so the cost-based derivation cannot zero one of them
    const both = { ...line, companyDueOverride: 50, vendorDueOverride: 30 };
    // net = vendorDue 30 - companyDue 50 - fines 0 (reference model)
    const issues = run([inv(1, 1, "2026-10-28", { netAmount: -20 })], [both], new Map([[10, { ...liveOk, deliveryBy: 2 }]]));
    expect(types(issues)).toEqual(["both_dues"]);
  });

  test("margin company due with vendor due is not flagged", () => {
    const line = ln(1, 10, "OP1", { companyDue: 50, companyDueKind: "margin", vendorDue: 30, companyDueOverride: 50, vendorDueOverride: 30 });
    expect(types(run([inv(1, 1, "2026-10-28", { netAmount: 30 })], [line]))).toEqual([]);
  });

  test("7: order deleted / not delivered / delivery type changed", () => {
    const base = [inv(1, 1, "2026-10-28")];
    const l = () => [ln(1, 10, "OP1")];
    expect(types(run(base, l(), new Map()))).toEqual(["order_changed"]);
    expect(types(run(base, l(), new Map([[10, { ...liveOk, deletedAt: "2026-10-30" }]])))).toEqual(["order_changed"]);
    expect(types(run(base, l(), new Map([[10, { ...liveOk, status: 4 }]])))).toEqual(["order_changed"]);
    expect(types(run(base, l(), new Map([[10, { ...liveOk, deliveryBy: 2 }]])))).toEqual(["order_changed"]);
  });

  test("8: net drift", () => {
    const lines = [ln(1, 10, "OP1", { vendorDue: 100 })];
    const issues = run([inv(1, 1, "2026-10-28", { netAmount: 90 })], lines);
    expect(types(issues)).toEqual(["net_drift"]);
    expect(issues[0]!.occurrences[0]!.lineId).toBeNull();
  });

  test("errors sort before warnings and summary counts them", () => {
    const issues = run([inv(1, 1, "2026-10-28")], [ln(1, 10, ""), ln(1, 11, "OP1"), ln(1, 12, "OP1")]);
    expect(issues[0]!.severity).toBe("error");
    expect(summarizeIssues(issues)).toEqual({ errors: 1, total: 2, warnings: 1 });
  });
});

describe("check 7: saved line whose order is no longer billable", () => {
  const one = (live: LiveOrder | undefined, over: Partial<IssueLine> = {}) => {
    const lines = [ln(1, 10, "OP1", over)];
    return run([inv(1, 1, "2026-10-28")], lines, new Map(live ? [[10, live]] : []));
  };
  test("order not delivered anymore", () => {
    const issues = one({ ...liveOk, status: 6 });
    expect(types(issues)).toEqual(["order_changed"]);
    expect(issues[0]!.details).toContain("لم يعد مسلّمًا");
  });
  test("Homix delivery whose shipment status is not delivered gets the shipment reason", () => {
    for (const shipmentStatus of [1, null]) {
      const issues = one({ ...liveOk, shipmentStatus });
      expect(types(issues)).toEqual(["order_changed"]);
      expect(issues[0]!.details).toContain("حالة شحنة الطلب");
    }
  });
  test("vendor-delivered order without any shipment status stays clean", () => {
    expect(one({ ...liveOk, deliveryBy: 2, shipmentStatus: null }, { isWarehouseDelivery: false })).toEqual([]);
  });
  test("deleted order and delivery-type change are still reported", () => {
    expect(one({ ...liveOk, deletedAt: "2026-10-30" })[0]!.details).toBe("الطلب اتحذف");
    expect(one(undefined)[0]!.details).toBe("الطلب اتحذف");
    expect(one({ ...liveOk, deliveryBy: 2, shipmentStatus: null })[0]!.details).toContain("نوع التسليم");
  });
});
