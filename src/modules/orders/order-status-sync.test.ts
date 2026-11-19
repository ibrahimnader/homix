import {
  AUTO_SYNC_LOG_ACTION,
  buildAutoSyncLogRows,
  deriveStatusPatch,
  isInManufacturing,
  MANUFACTURE_STATUS_RULES,
  ORDER_STATUS_RULES,
  SCHEDULE_STATUS_RULES,
  SHIPMENT_STATUS_RULES,
  shouldStampPoDate,
  type StatusField,
  type StatusPatch,
} from "./order-status-sync";

type Row = Record<string, unknown>;
const base: Row = { status: 1, shipmentStatus: 1, confirmationStatus: 1, manufactureStatus: null };
const deriveAll = (before: Row, payload: Row, context = {}): StatusPatch => deriveStatusPatch({ ...base, ...before }, payload, context).patch;
/* The original three-column matrix: manufacture/schedule targets are stripped so these cases keep pinning the approved behaviour;
   the manufacture/schedule links have their own describe blocks below. */
const derive = (before: Row, payload: Row, context = {}): StatusPatch => {
  const { manufactureStatus: _m, scheduleStatus: _s, ...rest } = deriveAll(before, payload, context);
  return rest;
};

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

  it.each([1, 2])("order %i changes nothing (in the status/shipment/confirmation columns)", (orderStatus) => {
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

  it.each([1, 3, 6, 8, 10, 11, 12])("shipment %i changes nothing (in the order/confirmation columns)", (shipmentStatus) => {
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
    expect(first.patch).toEqual({ shipmentStatus: 13, status: 9, manufactureStatus: 8 });
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
    expect(Object.keys(ORDER_STATUS_RULES).map(Number).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });
});

describe("buildAutoSyncLogRows", () => {
  const { derived: allDerived } = deriveStatusPatch({ ...base, status: 8, shipmentStatus: 2, confirmationStatus: 2 }, { shipmentStatus: 19 });
  const derived = allDerived.filter((change) => change.field === "status" || change.field === "confirmationStatus");

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

describe("manufactureStatus and scheduleStatus links", () => {
  const row = (fields: Row): Row => ({ ...base, status: 1, shipmentStatus: 1, confirmationStatus: 2, scheduleStatus: null, ...fields });

  it.each([
    // [order status, expected manufactureStatus, stored manufacture]
    [2, 2, 1], [2, 2, null], [5, 6, 4], [8, 7, 6], [6, 17, 6], [7, 18, 17],
    [9, 8, 1], [10, 9, 3], [11, 10, 2], [12, 11, 2], [13, 12, 2], [14, 13, 2], [15, 14, 2], [16, 15, 2], [17, 16, 2],
  ])("order %i -> manufacture %i (stored %s)", (orderStatus, expected, stored) => {
    expect(deriveAll(row({ manufactureStatus: stored }), { status: orderStatus }).manufactureStatus).toBe(expected);
  });
  it("order 4 (generic cancel) and 3 have no manufacture counterpart", () => {
    expect(deriveAll(row({ manufactureStatus: 2 }), { status: 4 }).manufactureStatus).toBeUndefined();
    expect(deriveAll(row({ manufactureStatus: 2 }), { status: 3 }).manufactureStatus).toBeUndefined();
  });
  it("order -> manufacture follows even backwards (no regress guard for explicit changes)", () => {
    expect(deriveAll(row({ manufactureStatus: 3 }), { status: 2 }).manufactureStatus).toBe(2);
    expect(deriveAll(row({ manufactureStatus: 6 }), { status: 2 }).manufactureStatus).toBe(2);
    expect(deriveAll(row({ manufactureStatus: 7 }), { status: 5 }).manufactureStatus).toBe(6);
    expect(deriveAll(row({ manufactureStatus: 17 }), { status: 8 }).manufactureStatus).toBe(7);
  });
  it.each([[2, 2], [6, 5], [7, 8], [17, 6], [18, 7]])("manufacture %i -> order %i from any order status (except itself)", (manufacture, expectedOrder) => {
    for (const status of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const patch = deriveAll(row({ status, manufactureStatus: 1 }), { manufactureStatus: manufacture });
      expect(patch.status).toBe(status === expectedOrder ? undefined : expectedOrder);
    }
  });
  it("manufacture 2 on a delivered order sets order 2 (regression, confirmed by the endpoint guard)", () => {
    expect(deriveAll(row({ status: 5, shipmentStatus: 4, manufactureStatus: 6 }), { manufactureStatus: 2 })).toEqual({ status: 2 });
  });
  it.each([[8, 9, 13], [9, 10, 14], [10, 11, 15], [11, 12, 16], [12, 13, 17], [13, 14, 18], [14, 15, 19], [15, 16, 20], [16, 17, 21]])(
    "manufacture %i cancels order %i / shipment %i, even from a delivered order", (manufacture, order, shipment) => {
      expect(deriveAll(row({ status: 2, shipmentStatus: 3 }), { manufactureStatus: manufacture })).toMatchObject({ status: order, shipmentStatus: shipment });
      expect(deriveAll(row({ status: 5, shipmentStatus: 4 }), { manufactureStatus: manufacture })).toMatchObject({ status: order, shipmentStatus: shipment });
    });
  it("manufacture cancel carries the confirmation counterpart of the order cancel variant", () => {
    expect(deriveAll(row({ status: 2, confirmationStatus: 2 }), { manufactureStatus: 10 })).toMatchObject({ status: 11, confirmationStatus: 7 });
    expect(deriveAll(row({ status: 2, confirmationStatus: 2 }), { manufactureStatus: 14 })).toMatchObject({ status: 15, confirmationStatus: 8 });
  });
  it("manufacture 6/7/17/18 move the shipment to its delivered/warehouse/returned/replaced twin", () => {
    expect(deriveAll(row({ status: 2, shipmentStatus: 3 }), { manufactureStatus: 6 })).toEqual({ status: 5, shipmentStatus: 4 });
    expect(deriveAll(row({ status: 2, shipmentStatus: 3 }), { manufactureStatus: 7 })).toEqual({ status: 8, shipmentStatus: 2 });
    expect(deriveAll(row({ status: 5, shipmentStatus: 4 }), { manufactureStatus: 17 })).toEqual({ status: 6, shipmentStatus: 7 });
    expect(deriveAll(row({ status: 6, shipmentStatus: 7 }), { manufactureStatus: 18 })).toEqual({ status: 7, shipmentStatus: 9 });
  });
  it("shipment 3 / 12 / 10 <-> manufacture 3 / 4 / 5 and back", () => {
    expect(deriveAll(row({ manufactureStatus: 2 }), { shipmentStatus: 3 })).toEqual({ manufactureStatus: 3 });
    expect(deriveAll(row({ manufactureStatus: 3 }), { shipmentStatus: 12 })).toEqual({ manufactureStatus: 4 });
    expect(deriveAll(row({ manufactureStatus: 4 }), { shipmentStatus: 10 })).toEqual({ manufactureStatus: 5 });
    expect(deriveAll(row({ shipmentStatus: 1, manufactureStatus: 2 }), { manufactureStatus: 3 })).toEqual({ shipmentStatus: 3 });
    expect(deriveAll(row({ shipmentStatus: 3, manufactureStatus: 3 }), { manufactureStatus: 4 })).toEqual({ shipmentStatus: 12 });
    expect(deriveAll(row({ shipmentStatus: 12, manufactureStatus: 4 }), { manufactureStatus: 5 })).toEqual({ shipmentStatus: 10 });
    // explicit changes follow even backwards: a delivered shipment goes back to ready-for-delivery, delivered stage back to 3
    expect(deriveAll(row({ shipmentStatus: 4, manufactureStatus: 2 }), { manufactureStatus: 3 })).toEqual({ shipmentStatus: 3 });
    expect(deriveAll(row({ manufactureStatus: 6 }), { shipmentStatus: 3 })).toEqual({ manufactureStatus: 3 });
  });
  it("shipment cancel/return variants drive the manufacture stage", () => {
    expect(deriveAll(row({ status: 2, shipmentStatus: 3, manufactureStatus: 2 }), { shipmentStatus: 14 })).toMatchObject({ status: 10, manufactureStatus: 9 });
    expect(deriveAll(row({ status: 5, shipmentStatus: 4, manufactureStatus: 6 }), { shipmentStatus: 7 })).toMatchObject({ status: 6, manufactureStatus: 17 });
  });
  it("confirmation cancel before / after manufacturing confirmation also cancels the manufacture stage", () => {
    expect(deriveAll(row({ manufactureStatus: 1 }), { confirmationStatus: 7 }).manufactureStatus).toBe(8);
    expect(deriveAll(row({ manufactureStatus: null }), { confirmationStatus: 7 }).manufactureStatus).toBe(8);
    expect(deriveAll(row({ status: 2, manufactureStatus: 3 }), { confirmationStatus: 7 }).manufactureStatus).toBe(9);
    expect(deriveAll(row({ status: 2, manufactureStatus: 6 }), { confirmationStatus: 7 }).manufactureStatus).toBe(9);
  });
  it("confirming / re-pending a cancelled order reopens its cancelled manufacture stage to accepted (1)", () => {
    expect(deriveAll(row({ status: 9, shipmentStatus: 13, confirmationStatus: 7, manufactureStatus: 8 }), { confirmationStatus: 2 }))
      .toEqual({ status: 3, shipmentStatus: 1, manufactureStatus: 1 });
    expect(deriveAll(row({ status: 10, shipmentStatus: 14, confirmationStatus: 7, manufactureStatus: 9 }), { confirmationStatus: 4 }))
      .toEqual({ status: 1, shipmentStatus: 1, manufactureStatus: 1 });
    // a stage that is not a cancel, or an order that is not cancelled, is left alone
    expect(deriveAll(row({ status: 9, confirmationStatus: 7, manufactureStatus: 3 }), { confirmationStatus: 2 }).manufactureStatus).toBeUndefined();
    expect(deriveAll(row({ status: 3, confirmationStatus: 2, manufactureStatus: 8 }), { confirmationStatus: 1 }).manufactureStatus).toBeUndefined();
  });
  it("explicit manufactureStatus in the payload wins over a derived one", () => {
    expect(deriveAll(row({ status: 2, manufactureStatus: 2 }), { status: 5, manufactureStatus: 3 }).manufactureStatus).toBeUndefined();
  });

  describe("schedule status", () => {
    it("schedule 4 / 5 / 6 cancel like the matching order cancel variant", () => {
      expect(deriveAll(row({ status: 2, shipmentStatus: 3, manufactureStatus: 3 }), { scheduleStatus: 4 }))
        .toEqual({ status: 14, shipmentStatus: 18, manufactureStatus: 13 });
      expect(deriveAll(row({ status: 2, shipmentStatus: 3, manufactureStatus: 3 }), { scheduleStatus: 5 }))
        .toEqual({ status: 12, shipmentStatus: 16, manufactureStatus: 11, confirmationStatus: 11 });
      expect(deriveAll(row({ status: 2, shipmentStatus: 3, manufactureStatus: 3 }), { scheduleStatus: 6 }))
        .toEqual({ status: 11, shipmentStatus: 15, manufactureStatus: 10, confirmationStatus: 7 });
    });
    it("a schedule cancel also cancels a delivered order (the endpoint guard asks for confirmation)", () => {
      expect(deriveAll(row({ status: 5, shipmentStatus: 4, manufactureStatus: 6 }), { scheduleStatus: 6 }))
        .toEqual({ status: 11, shipmentStatus: 15, manufactureStatus: 10, confirmationStatus: 7 });
    });
    it("schedule 1 books the shipment (11) from any shipment status; 2, 3, 7, 8, 9 derive nothing", () => {
      expect(deriveAll(row({ shipmentStatus: 3 }), { scheduleStatus: 1 })).toEqual({ shipmentStatus: 11 });
      expect(deriveAll(row({ shipmentStatus: 4 }), { scheduleStatus: 1 })).toEqual({ shipmentStatus: 11 });
      for (const schedule of [2, 3, 7, 8, 9]) expect(deriveAll(row({ shipmentStatus: 3 }), { scheduleStatus: schedule })).toEqual({});
    });
    it("shipment 11 sets schedule 1; shipment cancel 15/16/18 and order 11/12/14 set the schedule cancel reason", () => {
      expect(deriveAll(row({ shipmentStatus: 1 }), { shipmentStatus: 11 })).toEqual({ scheduleStatus: 1 });
      expect(deriveAll(row({ shipmentStatus: 1, scheduleStatus: 3 }), { shipmentStatus: 11 })).toEqual({ scheduleStatus: 1 });
      expect(deriveAll(row({ status: 2, shipmentStatus: 3, scheduleStatus: 3 }), { shipmentStatus: 15 })).toMatchObject({ status: 11, scheduleStatus: 6 });
      expect(deriveAll(row({ status: 2, shipmentStatus: 3, scheduleStatus: 1 }), { status: 12 })).toMatchObject({ scheduleStatus: 5 });
      expect(deriveAll(row({ status: 2, shipmentStatus: 3, scheduleStatus: 4 }), { status: 12 }).scheduleStatus).toBe(5);
    });
  });

  it("no ping-pong: re-deriving the result of every single-field change with an empty payload is a no-op and re-sending it derives nothing new", () => {
    const sources: Array<[StatusField, number]> = [];
    for (const v of Object.keys(ORDER_STATUS_RULES)) sources.push(["status", Number(v)]);
    for (const v of Object.keys(SHIPMENT_STATUS_RULES)) sources.push(["shipmentStatus", Number(v)]);
    for (const v of Object.keys(MANUFACTURE_STATUS_RULES)) sources.push(["manufactureStatus", Number(v)]);
    for (const v of Object.keys(SCHEDULE_STATUS_RULES)) sources.push(["scheduleStatus", Number(v)]);
    for (const [field, value] of sources) {
      const before = row({ status: 2, shipmentStatus: 3, manufactureStatus: 2, confirmationStatus: 2, scheduleStatus: 1 });
      const patch = deriveAll(before, { [field]: value });
      const after = { ...before, [field]: value, ...patch };
      expect(deriveAll(after, {})).toEqual({});
      expect(deriveAll(after, { [field]: value, ...patch })).toEqual({});
    }
  });
});

describe("shouldStampPoDate", () => {
  const stamp = (before: Row, payload: Row) => shouldStampPoDate(before, payload, deriveStatusPatch(before, payload).patch);
  it("stamps when the order status moves into 2 (derives manufacture 2 too, one stamp)", () => {
    expect(stamp({ status: 1, manufactureStatus: 1, PoDate: null }, { status: 2 })).toBe(true);
    expect(stamp({ status: 3, manufactureStatus: null, PoDate: "2026-01-01" }, { status: 2 })).toBe(true);
  });
  it("stamps when the manufacture stage moves into 2", () => {
    expect(stamp({ status: 3, manufactureStatus: 1, PoDate: null }, { manufactureStatus: 2 })).toBe(true);
  });
  it("does not re-stamp unrelated edits, repeated values, or the second field of an order already in manufacturing", () => {
    expect(stamp({ status: 2, manufactureStatus: 2, PoDate: "2026-01-01" }, { status: 2, manufactureStatus: 2, notes: "x" })).toBe(false);
    expect(stamp({ status: 2, manufactureStatus: 1, PoDate: "2026-01-01" }, { manufactureStatus: 2 })).toBe(false);
    expect(stamp({ status: 3, manufactureStatus: 2, PoDate: "2026-01-01" }, { status: 2 })).toBe(false);
    expect(stamp({ status: 1, manufactureStatus: 1, PoDate: null }, { notes: "x" })).toBe(false);
  });
  it("backfills an empty PoDate when a field moves into 2 while the other already was", () => {
    expect(stamp({ status: 2, manufactureStatus: 1, PoDate: null }, { manufactureStatus: 2 })).toBe(true);
  });
  it("stamps again after re-entering the status", () => {
    expect(stamp({ status: 3, manufactureStatus: 3, PoDate: "2026-01-01" }, { status: 2, manufactureStatus: 2 })).toBe(true);
  });
  it("isInManufacturing is true for either field", () => {
    expect(isInManufacturing({ status: 2 })).toBe(true);
    expect(isInManufacturing({ manufactureStatus: 2 })).toBe(true);
    expect(isInManufacturing({ status: 3, manufactureStatus: 3 })).toBe(false);
  });
});
