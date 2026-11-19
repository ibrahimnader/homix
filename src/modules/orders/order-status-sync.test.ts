import {
  AUTO_SYNC_LOG_ACTION,
  buildAutoSyncLogRows,
  deriveStatusPatch,
  ORDER_STATUS_RULES,
  SHIPMENT_STATUS_RULES,
  type StatusPatch,
} from "./order-status-sync";

type Row = Record<string, unknown>;
const base: Row = { status: 1, shipmentStatus: 1, confirmationStatus: 1, manufactureStatus: null };
const derive = (before: Row, payload: Row, context = {}): StatusPatch => deriveStatusPatch({ ...base, ...before }, payload, context).patch;

describe("deriveStatusPatch: order status as source", () => {
  // [order status, expected shipmentStatus, expected confirmationStatus]
  const rows: Array<[number, number | undefined, number | undefined]> = [
    [4, 5, undefined], [5, 4, undefined], [6, 7, undefined], [7, 9, undefined], [8, 2, undefined],
    [9, 13, undefined], [10, 14, undefined], [11, 15, 7], [12, 16, 11], [13, 17, 10], [14, 18, undefined],
    [15, 19, 8], [16, 20, undefined], [17, 21, undefined],
  ];
  it.each(rows)("order %i -> shipment %s, confirmation %s", (orderStatus, shipment, confirmation) => {
    const patch = derive({ status: 2, shipmentStatus: 3, confirmationStatus: 2 }, { status: orderStatus });
    expect(patch.shipmentStatus).toBe(shipment);
    expect(patch.confirmationStatus).toBe(confirmation);
    expect(patch.status).toBeUndefined();
  });

  it.each([1, 2])("order %i changes nothing", (orderStatus) => {
    expect(derive({ status: 5, shipmentStatus: 4, confirmationStatus: 2 }, { status: orderStatus })).toEqual({});
  });

  it.each([[null], [1], [3], [4], [5], [6]])("order 3 confirms confirmation %s", (current) => {
    expect(derive({ status: 1, confirmationStatus: current }, { status: 3 })).toEqual({ confirmationStatus: 2 });
  });
  it.each([[7], [8], [9], [10], [11]])("order 3 does not touch canceled confirmation %s", (current) => {
    expect(derive({ status: 1, confirmationStatus: current }, { status: 3 })).toEqual({});
  });
  it("order 3 leaves an already confirmed confirmation alone", () => {
    expect(derive({ status: 1, confirmationStatus: 2 }, { status: 3 })).toEqual({});
  });
});

describe("deriveStatusPatch: shipment status as source", () => {
  // [shipment status, expected order status, expected confirmation]
  const rows: Array<[number, number | undefined, number | undefined]> = [
    [2, 8, undefined], [4, 5, undefined], [5, 4, undefined], [7, 6, undefined], [9, 7, undefined],
    [13, 9, undefined], [14, 10, undefined], [15, 11, 7], [16, 12, 11], [17, 13, 10], [18, 14, undefined],
    [19, 15, 8], [20, 16, undefined], [21, 17, undefined],
  ];
  it.each(rows)("shipment %i -> order %s, confirmation %s", (shipmentStatus, order, confirmation) => {
    const patch = derive({ status: 2, shipmentStatus: 3, confirmationStatus: 2 }, { shipmentStatus });
    expect(patch.status).toBe(order);
    expect(patch.confirmationStatus).toBe(confirmation);
    expect(patch.shipmentStatus).toBeUndefined();
  });

  it.each([1, 3, 6, 8, 10, 11, 12])("shipment %i changes nothing", (shipmentStatus) => {
    expect(derive({ status: 2, shipmentStatus: 99, confirmationStatus: 2 }, { shipmentStatus })).toEqual({});
  });
});

describe("deriveStatusPatch: confirmation status as source", () => {
  it("confirmed moves a pending order to confirmed, with no shipment change", () => {
    expect(derive({ status: 1 }, { confirmationStatus: 2 })).toEqual({ status: 3 });
  });
  it.each([4, 9, 10, 11, 12, 13, 14, 15, 16, 17])("confirmed reopens a cancelled/rejected order at status %i", (status) => {
    expect(derive({ status, shipmentStatus: 1, confirmationStatus: 7 }, { confirmationStatus: 2 })).toEqual({ status: 3 });
  });
  it.each([5, 6, 7, 8])("confirmed never touches an order at status %i", (status) => {
    expect(derive({ status, shipmentStatus: 4, confirmationStatus: 7 }, { confirmationStatus: 2 })).toEqual({});
  });
  it("confirmed leaves an in-progress order (2) and a confirmed order (3) alone", () => {
    expect(derive({ status: 2 }, { confirmationStatus: 2 })).toEqual({});
    expect(derive({ status: 3 }, { confirmationStatus: 2 })).toEqual({});
  });
  it.each([5, 13, 14, 15, 16, 17, 18, 19, 20, 21])("confirmed returns a cancelled shipment %i to pending (1)", (shipmentStatus) => {
    expect(derive({ status: 9, shipmentStatus, confirmationStatus: 7 }, { confirmationStatus: 2 })).toEqual({ status: 3, shipmentStatus: 1 });
  });
  it.each([2, 3, 4, 6, 7, 8, 9, 10, 11, 12])("confirmed leaves shipment %i alone", (shipmentStatus) => {
    expect(derive({ status: 9, shipmentStatus, confirmationStatus: 7 }, { confirmationStatus: 2 }).shipmentStatus).toBeUndefined();
  });
  it("confirmed on a delivered/returned/replaced/in-inventory order with matching shipment changes nothing", () => {
    expect(derive({ status: 5, shipmentStatus: 4 }, { confirmationStatus: 2 })).toEqual({});
    expect(derive({ status: 6, shipmentStatus: 7 }, { confirmationStatus: 2 })).toEqual({});
    expect(derive({ status: 7, shipmentStatus: 9 }, { confirmationStatus: 2 })).toEqual({});
    expect(derive({ status: 8, shipmentStatus: 2 }, { confirmationStatus: 2 })).toEqual({});
  });
  it("explicit order/shipment values in the same payload win over the reopen", () => {
    expect(derive({ status: 9, shipmentStatus: 13, confirmationStatus: 7 }, { confirmationStatus: 2, status: 4 }))
      .toEqual({ shipmentStatus: 5 });
    expect(derive({ status: 9, shipmentStatus: 13, confirmationStatus: 7 }, { confirmationStatus: 2, shipmentStatus: 3 }))
      .toEqual({ status: 3 });
  });
  it("cancel -> confirm -> cancel -> confirm is stable", () => {
    let row: Row = { status: 2, shipmentStatus: 3, confirmationStatus: 2, manufactureStatus: 3 };
    const step = (payload: Row) => { row = { ...row, ...payload, ...derive(row, payload) }; };
    step({ confirmationStatus: 7 });
    expect(row).toMatchObject({ status: 10, shipmentStatus: 14, confirmationStatus: 7 });
    step({ confirmationStatus: 2 });
    expect(row).toMatchObject({ status: 3, shipmentStatus: 1, confirmationStatus: 2 });
    step({ confirmationStatus: 9 });
    expect(row).toMatchObject({ status: 10, shipmentStatus: 14, confirmationStatus: 9 });
    step({ confirmationStatus: 2 });
    expect(row).toMatchObject({ status: 3, shipmentStatus: 1, confirmationStatus: 2 });
    // before manufacturing confirmation the cancel picks 9 / 13
    row = { status: 1, shipmentStatus: 1, confirmationStatus: 2, manufactureStatus: 1 };
    step({ confirmationStatus: 7 });
    expect(row).toMatchObject({ status: 9, shipmentStatus: 13 });
    step({ confirmationStatus: 2 });
    expect(row).toMatchObject({ status: 3, shipmentStatus: 1 });
  });
  it.each([[3], [4], [5], [6], [1]])("confirmation %i changes nothing", (confirmationStatus) => {
    expect(derive({ status: 1, confirmationStatus: 2 }, { confirmationStatus })).toEqual({});
  });
  const REOPEN_VALUES = [1, 3, 4, 5, 6];
  const CANCELLED_ORDERS: Array<[number, number]> = [[4, 5], [9, 13], [10, 14], [11, 15], [12, 16], [13, 17], [14, 18], [15, 19], [16, 20], [17, 21]];
  describe.each(REOPEN_VALUES)("confirmation %i reopens a cancelled/rejected order", (confirmationStatus) => {
    it.each(CANCELLED_ORDERS)("order %i / shipment %i -> order 1 / shipment 1", (status, shipmentStatus) => {
      expect(derive({ status, shipmentStatus, confirmationStatus: 7 }, { confirmationStatus })).toEqual({ status: 1, shipmentStatus: 1 });
    });
    it.each([1, 2, 5, 6, 7, 8])("order %i (not cancelled/confirmed) changes nothing", (status) => {
      expect(derive({ status, shipmentStatus: 3, confirmationStatus: 7 }, { confirmationStatus })).toEqual({});
      // a stray cancelled shipment on a non-cancelled order is not touched either
      expect(derive({ status, shipmentStatus: 13, confirmationStatus: 7 }, { confirmationStatus })).toEqual({});
    });
    it("a confirmed order (3) goes back to pending (1); its shipment is untouched", () => {
      expect(derive({ status: 3, shipmentStatus: 1, confirmationStatus: 2 }, { confirmationStatus })).toEqual({ status: 1 });
      expect(derive({ status: 3, shipmentStatus: 13, confirmationStatus: 2 }, { confirmationStatus })).toEqual({ status: 1 });
    });
    it("an explicit order status in the payload wins over the confirmed -> pending revert", () => {
      expect(derive({ status: 3, confirmationStatus: 2 }, { confirmationStatus, status: 2 })).toEqual({});
    });
    it("explicit order/shipment values in the payload win", () => {
      expect(derive({ status: 9, shipmentStatus: 13, confirmationStatus: 7 }, { confirmationStatus, status: 3 })).toEqual({ shipmentStatus: 1 });
      expect(derive({ status: 9, shipmentStatus: 13, confirmationStatus: 7 }, { confirmationStatus, shipmentStatus: 3 })).toEqual({ status: 1 });
    });
  });
  it("confirm -> pending -> confirm -> pending is stable and consistent", () => {
    let row: Row = { status: 1, shipmentStatus: 1, confirmationStatus: 1 };
    const step = (payload: Row) => { row = { ...row, ...payload, ...derive(row, payload) }; };
    step({ confirmationStatus: 2 });
    expect(row).toMatchObject({ status: 3, shipmentStatus: 1, confirmationStatus: 2 });
    step({ confirmationStatus: 1 });
    expect(row).toMatchObject({ status: 1, shipmentStatus: 1, confirmationStatus: 1 });
    step({ confirmationStatus: 2 });
    expect(row).toMatchObject({ status: 3, confirmationStatus: 2 });
    step({ confirmationStatus: 4 });
    expect(row).toMatchObject({ status: 1, confirmationStatus: 4 });
  });
  it("an explicit order change to 3 still confirms confirmation only from null/1/3..6 and does not fight the revert", () => {
    expect(derive({ status: 1, confirmationStatus: 1 }, { status: 3 })).toEqual({ confirmationStatus: 2 });
    expect(derive({ status: 3, confirmationStatus: 2 }, { confirmationStatus: 1 })).toEqual({ status: 1 });
  });
  it("cancel -> pending -> cancel -> confirm stays stable", () => {
    let row: Row = { status: 2, shipmentStatus: 3, confirmationStatus: 2, manufactureStatus: 3 };
    const step = (payload: Row) => { row = { ...row, ...payload, ...derive(row, payload) }; };
    step({ confirmationStatus: 7 });
    expect(row).toMatchObject({ status: 10, shipmentStatus: 14, confirmationStatus: 7 });
    step({ confirmationStatus: 3 });
    expect(row).toMatchObject({ status: 1, shipmentStatus: 1, confirmationStatus: 3 });
    step({ confirmationStatus: 7 });
    expect(row).toMatchObject({ status: 10, shipmentStatus: 14, confirmationStatus: 7 });
    step({ confirmationStatus: 6 });
    expect(row).toMatchObject({ status: 1, shipmentStatus: 1, confirmationStatus: 6 });
    step({ confirmationStatus: 7 });
    step({ confirmationStatus: 2 });
    expect(row).toMatchObject({ status: 3, shipmentStatus: 1, confirmationStatus: 2 });
  });
  it.each([7, 8, 9, 10, 11])("cancel %i before manufacturing confirmation -> order 9 / shipment 13", (confirmationStatus) => {
    for (const manufactureStatus of [null, 1, 2]) {
      expect(derive({ status: 1, manufactureStatus }, { confirmationStatus })).toEqual({ shipmentStatus: 13, status: 9 });
    }
  });
  it.each([7, 8, 9, 10, 11])("cancel %i after manufacturing confirmation -> order 10 / shipment 14", (confirmationStatus) => {
    for (const manufactureStatus of [3, 4, 5]) {
      expect(derive({ status: 2, manufactureStatus }, { confirmationStatus })).toEqual({ shipmentStatus: 14, status: 10 });
    }
  });
  it("uses the manufactureStatus sent in the payload or context when present", () => {
    expect(derive({ status: 2, manufactureStatus: 1 }, { confirmationStatus: 7, manufactureStatus: 4 }).status).toBe(10);
    expect(derive({ status: 2, manufactureStatus: 1 }, { confirmationStatus: 7 }, { manufactureStatus: 5 }).status).toBe(10);
  });
});

describe("deriveStatusPatch: explicit values, priority, reopening", () => {
  it("never overwrites a field the payload really changes", () => {
    expect(derive({ status: 2 }, { confirmationStatus: 7, status: 3 })).toEqual({ shipmentStatus: 13 });
    expect(derive({ status: 2 }, { confirmationStatus: 7, shipmentStatus: 3 })).toEqual({ status: 9 });
    expect(derive({ status: 8, shipmentStatus: 2 }, { shipmentStatus: 4, status: 3 })).toEqual({ confirmationStatus: 2 });
  });
  it("treats a re-sent unchanged value as not explicit (full edit form)", () => {
    const patch = derive({ status: 2, shipmentStatus: 3, confirmationStatus: 2 }, { confirmationStatus: 7, shipmentStatus: 3, status: 2 });
    expect(patch).toEqual({ shipmentStatus: 13, status: 9 });
  });
  it("derives from each changed field for absent targets: order status wins over shipment over confirmation", () => {
    // order 5 (->shipment 4) and shipment 5 (->order 4) and confirmation 7 (->order 9, shipment 13): status explicit, shipment explicit.
    expect(derive({ status: 2, shipmentStatus: 3, confirmationStatus: 1 }, { shipmentStatus: 5, status: 5 })).toEqual({});
    // status 11 + shipment 5: confirmation absent -> derived from status (7), not from shipment 5.
    expect(derive({ status: 2, shipmentStatus: 3, confirmationStatus: 2 }, { shipmentStatus: 5, status: 11 })).toEqual({ confirmationStatus: 7 });
    // shipment 20 + confirmation 7: order absent -> from shipment (16), not from confirmation (9).
    expect(derive({ status: 2, shipmentStatus: 3, confirmationStatus: 1 }, { confirmationStatus: 7, shipmentStatus: 20 })).toEqual({ status: 16 });
    // status 5 + confirmation 7: shipment absent -> from status (4), not from confirmation (13/14).
    expect(derive({ status: 2, shipmentStatus: 3, confirmationStatus: 1 }, { confirmationStatus: 7, status: 5 })).toEqual({ shipmentStatus: 4 });
  });
  it("propagates when reopening from a final state (no guard)", () => {
    expect(derive({ status: 5, shipmentStatus: 4 }, { shipmentStatus: 2 })).toEqual({ status: 8 });
    expect(derive({ status: 4, shipmentStatus: 5, confirmationStatus: 1 }, { status: 3 })).toEqual({ confirmationStatus: 2 });
    expect(derive({ status: 9, shipmentStatus: 13, confirmationStatus: 7 }, { status: 8 })).toEqual({ shipmentStatus: 2 });
    expect(derive({ status: 4, shipmentStatus: 5 }, { confirmationStatus: 7, manufactureStatus: 4 })).toEqual({ shipmentStatus: 14, status: 10 });
    expect(derive({ status: 4, shipmentStatus: 5, confirmationStatus: 7 }, { confirmationStatus: 2 })).toEqual({ status: 3, shipmentStatus: 1 });
  });
  it("is a single hop: derived values are not fed back (no loop)", () => {
    const first = deriveStatusPatch({ ...base, status: 2 }, { confirmationStatus: 7 });
    expect(first.patch).toEqual({ shipmentStatus: 13, status: 9 });
    // Applying the patch and re-deriving from the stored result with nothing new in the payload is a no-op.
    expect(deriveStatusPatch({ ...base, status: 9, shipmentStatus: 13, confirmationStatus: 7 }, {}).patch).toEqual({});
    expect(deriveStatusPatch({ ...base, status: 9, shipmentStatus: 13, confirmationStatus: 7 }, first.patch).patch).toEqual({});
  });
  it("ignores empty/null/non-numeric payload values and null before rows", () => {
    expect(deriveStatusPatch(null, null).patch).toEqual({});
    expect(derive({}, { shipmentStatus: "", status: null, confirmationStatus: "abc" })).toEqual({});
    expect(derive({ status: 1 }, { shipmentStatus: "4" })).toEqual({ status: 5 });
  });
  it("omits derived values equal to the stored value", () => {
    expect(derive({ status: 5, shipmentStatus: 4 }, { status: 5 })).toEqual({});
    expect(derive({ status: 8, shipmentStatus: 2 }, { status: 8 })).toEqual({});
    expect(derive({ status: 2, shipmentStatus: 13 }, { status: 9 })).toEqual({});
  });
});

describe("matrix data", () => {
  it("shipment rules mirror the order rules (13..21 <-> 9..17 and the 4/5/2/7/9 pairs)", () => {
    expect(Object.fromEntries(Object.entries(SHIPMENT_STATUS_RULES).map(([k, v]) => [k, v.status?.value]))).toEqual({
      2: 8, 4: 5, 5: 4, 7: 6, 9: 7, 13: 9, 14: 10, 15: 11, 16: 12, 17: 13, 18: 14, 19: 15, 20: 16, 21: 17,
    });
    expect(Object.keys(ORDER_STATUS_RULES).map(Number).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });
});

describe("buildAutoSyncLogRows", () => {
  const { derived } = deriveStatusPatch({ ...base, status: 8, shipmentStatus: 2, confirmationStatus: 2 }, { shipmentStatus: 19 });

  it("writes a normal update row plus an automatic marker naming the source field per derived field", () => {
    const rows = buildAutoSyncLogRows(55, derived, 7);
    expect(rows).toEqual(expect.arrayContaining([
      { action: "update", entityId: 55, entityType: "order", field: "status", from: "8", to: "15", userId: 7 },
      { action: "update", entityId: 55, entityType: "order", field: "confirmationStatus", from: "2", to: "8", userId: 7 },
      { action: AUTO_SYNC_LOG_ACTION, entityId: 55, entityType: "order", field: "autoSync", from: "shipmentStatus", to: "status:8->15", userId: 7 },
      { action: AUTO_SYNC_LOG_ACTION, entityId: 55, entityType: "order", field: "autoSync", from: "shipmentStatus", to: "confirmationStatus:2->8", userId: 7 },
    ]));
    expect(rows).toHaveLength(4);
  });
  it("can emit markers only and normalizes missing users to null", () => {
    const rows = buildAutoSyncLogRows(55, derived, undefined, { includeUpdateRows: false });
    expect(rows.map((row) => row.action)).toEqual([AUTO_SYNC_LOG_ACTION, AUTO_SYNC_LOG_ACTION]);
    expect(rows.every((row) => row.userId === null)).toBe(true);
  });
  it("writes nothing when nothing was derived", () => {
    expect(buildAutoSyncLogRows(1, [], 1)).toEqual([]);
  });
});
