import {
  CLOSED_ORDER_STATUSES, CLOSED_SHIPMENT_STATUSES, CONFIRMATION_STATUS, MANUFACTURE_STATUS, ORDER_STATUS, SHIPMENT_SCHEDULE_STATUS, SHIPMENTS_STATUS,
} from "../../../config/constants";

/**
 * The five statuses of an `orders` row — `status` (order), `shipmentStatus`, `confirmationStatus`,
 * `manufactureStatus` (vendor stage) and `scheduleStatus` (delivery schedule) — are linked: changing one drives the
 * others (matrices below; manufacture/schedule targets are guarded so they never move a more advanced state back). This module
 * is the single source of that logic; every writer (order edit, bulk edit, shipment
 * edit, returns, receipts, reassignment) asks `deriveStatusPatch` for the extra
 * columns to write in the same update.
 *
 * Semantics (approved rules):
 *  - one hop only: a derived value never derives anything else (no loops). Where the
 *    rules say "shipment cascades to an order cancel variant AND the confirmation
 *    counterpart", both targets are listed directly in the matrix below.
 *  - explicit wins: a field the payload really changes is never overwritten. A value that
 *    only repeats the stored value (the full edit form re-sends every field) is not a
 *    change, so it neither drives anything nor blocks a derived value.
 *  - no guard on final states: a change always propagates, including reopening. Confirmation values 1, 3, 4, 5, 6 and 2
 *    reopen a cancelled/rejected order (see the confirmation rules below) but never regress other statuses.
 *  - several changed fields: each changed field derives the targets that are still
 *    unset; priority is order status, shipment, confirmation, manufacture, then schedule.
 *  - PoDate: see `shouldStampPoDate` (entering «قيد التصنيع» through order status 2 OR manufacture stage 2).
 */

export type StatusField = "status" | "shipmentStatus" | "confirmationStatus" | "manufactureStatus" | "scheduleStatus";
/* Source priority when several fields change in one payload: the original three first (their behaviour is unchanged),
   then the vendor-side manufacture stage and the delivery schedule. */
export const STATUS_FIELDS: readonly StatusField[] = ["status", "shipmentStatus", "confirmationStatus", "manufactureStatus", "scheduleStatus"];

/** What a source value writes into one target column. */
export type StatusTarget = {
  value: number;
  /** Only write when the stored value of that column is one of these (null = unset). */
  onlyIfCurrentIn?: ReadonlyArray<number | null>;
  /** Only write when the stored value of ANOTHER column is one of these (e.g. reopen a shipment only on a cancelled order). */
  onlyIfOtherCurrentIn?: { field: StatusField; values: ReadonlyArray<number | null> };
};
export type StatusRule = Partial<Record<StatusField, StatusTarget>>;
export type StatusPatch = Partial<Record<StatusField, number>>;
export type DerivedChange = { field: StatusField; from: number | null; to: number; source: StatusField };
export type StatusSyncContext = {
  /** Overrides the manufacture stage used by the confirmation-cancel rule (defaults to payload, then stored). */
  manufactureStatus?: unknown;
};
export type StatusSyncResult = { patch: StatusPatch; derived: DerivedChange[] };

const O = ORDER_STATUS;
const S = SHIPMENTS_STATUS;
const C = CONFIRMATION_STATUS;
const M = MANUFACTURE_STATUS;
const SC = SHIPMENT_SCHEDULE_STATUS;

/** order status -> shipment status (the 4 and 9..17 -> cancel/reject, plus 5, 8, 6, 7). */
export const SHIPMENT_STATUS_BY_ORDER_STATUS: Readonly<Record<number, number>> = {
  [O.CANCELED]: S.CANCELED,
  [O.CANCELED_BEFORE_MFG_CONFIRMATION]: S.CANCELED_BEFORE_MFG_CONFIRMATION,
  [O.CANCELED_AFTER_MFG_CONFIRMATION_72H]: S.CANCELED_AFTER_MFG_CONFIRMATION_72H,
  [O.CANCELED_AFTER_MFG_NO_RESPONSE]: S.CANCELED_AFTER_MFG_NO_RESPONSE,
  [O.CANCELED_AFTER_MFG_CHANGED_MIND]: S.CANCELED_AFTER_MFG_CHANGED_MIND,
  [O.CANCELED_AFTER_MFG_SPECIAL]: S.CANCELED_AFTER_MFG_SPECIAL,
  [O.CANCELED_AFTER_MFG_DELAY]: S.CANCELED_AFTER_MFG_DELAY,
  [O.CANCELED_AFTER_MFG_FAKE_ORDER]: S.CANCELED_AFTER_MFG_FAKE_ORDER,
  [O.REJECTED_AFTER_MFG_MISMATCH]: S.REJECTED_AFTER_MFG_MISMATCH,
  [O.REJECTED_AFTER_MFG_NOT_SUITABLE]: S.REJECTED_AFTER_MFG_NOT_SUITABLE,
  [O.DELIVERED]: S.DELIVERED,
  [O.IN_INVENTORY]: S.IN_WAREHOUSE,
  [O.REFUNDED]: S.RETURNED_FROM_CUSTOMER,
  [O.REPLACED]: S.REPLACED,
};

/** order cancel variant -> confirmation cancel reason (only the ones with a counterpart). */
export const CONFIRMATION_STATUS_BY_ORDER_STATUS: Readonly<Record<number, number>> = {
  [O.CANCELED_AFTER_MFG_NO_RESPONSE]: C.CANCELED_NO_CUSTOMER_RESPONSE,
  [O.CANCELED_AFTER_MFG_FAKE_ORDER]: C.CANCELED_FAKE_ORDER,
  [O.CANCELED_AFTER_MFG_SPECIAL]: C.CANCELED_SPECIAL_CIRCUMSTANCES,
  [O.CANCELED_AFTER_MFG_CHANGED_MIND]: C.CANCELED_CHANGED_MIND,
};

/** Confirmation values that mean "unconfirmed yet" — an order confirmed by hand confirms them. */
const UNCONFIRMED_CONFIRMATION: ReadonlyArray<number | null> = [
  null, C.PENDING, C.NO_ANSWER_FIRST_ATTEMPT, C.NO_ANSWER_SECOND_ATTEMPT, C.NO_ANSWER_THIRD_ATTEMPT, C.CALL_BACK_LATER,
];

/* ---- manufactureStatus (vendor-side stage) and scheduleStatus (delivery schedule) links ---- */

/** order status -> manufacture stage with the same meaning (4 "cancelled" has no stage; 2 is handled separately). */
export const MANUFACTURE_STATUS_BY_ORDER_STATUS: Readonly<Record<number, number>> = {
  [O.DELIVERED]: M.DELIVERED_SUCCESSFULLY,
  [O.IN_INVENTORY]: M.IN_WAREHOUSE,
  [O.REFUNDED]: M.RETURNED,
  [O.REPLACED]: M.EXCHANGED,
  [O.CANCELED_BEFORE_MFG_CONFIRMATION]: M.CANCELED_BEFORE_MFG_CONFIRMATION,
  [O.CANCELED_AFTER_MFG_CONFIRMATION_72H]: M.CANCELED_AFTER_MFG_CONFIRMATION_72H,
  [O.CANCELED_AFTER_MFG_NO_RESPONSE]: M.CANCELED_NO_RESPONSE,
  [O.CANCELED_AFTER_MFG_CHANGED_MIND]: M.CANCELED_CHANGED_MIND,
  [O.CANCELED_AFTER_MFG_SPECIAL]: M.CANCELED_SPECIAL,
  [O.CANCELED_AFTER_MFG_DELAY]: M.CANCELED_DELAY,
  [O.CANCELED_AFTER_MFG_FAKE_ORDER]: M.CANCELED_FAKE_ORDER,
  [O.REJECTED_AFTER_MFG_MISMATCH]: M.REJECTED_MISMATCH,
  [O.REJECTED_AFTER_MFG_NOT_SUITABLE]: M.REJECTED_NOT_SUITABLE,
};
/** order cancel variant -> schedule cancel reason (only the ones with a counterpart). */
export const SCHEDULE_STATUS_BY_ORDER_STATUS: Readonly<Record<number, number>> = {
  [O.CANCELED_AFTER_MFG_NO_RESPONSE]: SC.CANCELED_NO_RESPONSE,
  [O.CANCELED_AFTER_MFG_CHANGED_MIND]: SC.CANCELED_CHANGED_MIND,
  [O.CANCELED_AFTER_MFG_DELAY]: SC.CANCELED_DELIVERY_DELAY,
};

const MANUFACTURE_CANCEL_VALUES: ReadonlyArray<number> = [
  M.CANCELED_BEFORE_MFG_CONFIRMATION, M.CANCELED_AFTER_MFG_CONFIRMATION_72H, M.CANCELED_NO_RESPONSE, M.CANCELED_CHANGED_MIND,
  M.CANCELED_SPECIAL, M.CANCELED_DELAY, M.CANCELED_FAKE_ORDER, M.REJECTED_MISMATCH, M.REJECTED_NOT_SUITABLE,
];
const M_OPEN: ReadonlyArray<number | null> = [null, M.Accepted, M.IN_PRODUCTION, M.READY_FOR_DELIVERY, M.DELIVERED, M.FAILED_TO_DELIVER];
/** Guard for writing a manufacture stage: never move a more advanced stage back (cancel/return variants are explicit and unguarded). */
const MANUFACTURE_TARGET_GUARD: Readonly<Record<number, ReadonlyArray<number | null>>> = {
  [M.IN_PRODUCTION]: [null, M.Accepted],
  [M.READY_FOR_DELIVERY]: [null, M.Accepted, M.IN_PRODUCTION],
  [M.DELIVERED]: [null, M.Accepted, M.IN_PRODUCTION, M.READY_FOR_DELIVERY],
  [M.FAILED_TO_DELIVER]: [null, M.Accepted, M.IN_PRODUCTION, M.READY_FOR_DELIVERY, M.DELIVERED],
  [M.DELIVERED_SUCCESSFULLY]: M_OPEN,
  [M.IN_WAREHOUSE]: [...M_OPEN, M.DELIVERED_SUCCESSFULLY],
  [M.RETURNED]: [...M_OPEN, M.DELIVERED_SUCCESSFULLY, M.IN_WAREHOUSE],
  [M.EXCHANGED]: [...M_OPEN, M.DELIVERED_SUCCESSFULLY, M.IN_WAREHOUSE, M.RETURNED],
};
const SCHEDULE_OPEN: ReadonlyArray<number | null> = [
  null, SC.SCHEDULED, SC.NO_RESPONSE_FIRST_ATTEMPT, SC.POSTPONED, SC.CALL_LATER, SC.NO_RESPONSE_SECOND_ATTEMPT, SC.NO_RESPONSE_THIRD_ATTEMPT,
];
/** Confirmation/schedule counterparts of a guarded cancel are written only together with it (order not delivered/returned/replaced/in inventory). */
const withOrderGuard = (target: StatusTarget, values: ReadonlyArray<number | null>): StatusTarget =>
  ({ ...target, onlyIfOtherCurrentIn: { field: "status", values } });
const manufactureTarget = (value: number): StatusTarget => {
  const guard = MANUFACTURE_TARGET_GUARD[value];
  return guard ? { value, onlyIfCurrentIn: guard } : { value };
};

/** Matrix 1: order status -> {shipment, manufacture, schedule, confirmation}. Statuses absent here (1) derive nothing. */
export const ORDER_STATUS_RULES: Readonly<Record<number, StatusRule>> = (() => {
  const rules: Record<number, StatusRule> = {};
  for (const [orderStatus, shipmentStatus] of Object.entries(SHIPMENT_STATUS_BY_ORDER_STATUS)) {
    rules[Number(orderStatus)] = { shipmentStatus: { value: shipmentStatus } };
  }
  for (const [orderStatus, confirmationStatus] of Object.entries(CONFIRMATION_STATUS_BY_ORDER_STATUS)) {
    rules[Number(orderStatus)] = { ...rules[Number(orderStatus)], confirmationStatus: { value: confirmationStatus } };
  }
  for (const [orderStatus, manufactureStatus] of Object.entries(MANUFACTURE_STATUS_BY_ORDER_STATUS)) {
    rules[Number(orderStatus)] = { ...rules[Number(orderStatus)], manufactureStatus: manufactureTarget(manufactureStatus) };
  }
  for (const [orderStatus, scheduleStatus] of Object.entries(SCHEDULE_STATUS_BY_ORDER_STATUS)) {
    rules[Number(orderStatus)] = { ...rules[Number(orderStatus)], scheduleStatus: { value: scheduleStatus, onlyIfCurrentIn: SCHEDULE_OPEN } };
  }
  rules[O.IN_PROGRESS] = { manufactureStatus: manufactureTarget(M.IN_PRODUCTION) };
  rules[O.CONFIRMED] = { confirmationStatus: { value: C.CONFIRMED, onlyIfCurrentIn: UNCONFIRMED_CONFIRMATION } };
  return rules;
})();

/** Matrix 2: shipment status -> order status (+ confirmation / manufacture / schedule counterparts).
 *  Shipment 8 and 10 (-> manufacture 5 only) and 11 (-> schedule 1 only) derive no order change. */
export const SHIPMENT_STATUS_RULES: Readonly<Record<number, StatusRule>> = (() => {
  const rules: Record<number, StatusRule> = {};
  for (const [orderStatus, shipmentStatus] of Object.entries(SHIPMENT_STATUS_BY_ORDER_STATUS)) {
    const confirmation = CONFIRMATION_STATUS_BY_ORDER_STATUS[Number(orderStatus)];
    const manufacture = MANUFACTURE_STATUS_BY_ORDER_STATUS[Number(orderStatus)];
    const schedule = SCHEDULE_STATUS_BY_ORDER_STATUS[Number(orderStatus)];
    rules[shipmentStatus] = {
      status: { value: Number(orderStatus) },
      ...(confirmation !== undefined ? { confirmationStatus: { value: confirmation } } : {}),
      ...(manufacture !== undefined ? { manufactureStatus: manufactureTarget(manufacture) } : {}),
      ...(schedule !== undefined ? { scheduleStatus: { value: schedule, onlyIfCurrentIn: SCHEDULE_OPEN } } : {}),
    };
  }
  rules[S.READY_FOR_DELIVERY] = { manufactureStatus: manufactureTarget(M.READY_FOR_DELIVERY) };
  rules[S.OUT_FOR_DELIVERY] = { manufactureStatus: manufactureTarget(M.DELIVERED) };
  rules[S.FAILED_DELIVERY] = { manufactureStatus: manufactureTarget(M.FAILED_TO_DELIVER) };
  rules[S.SCHEDULED] = { scheduleStatus: { value: SC.SCHEDULED, onlyIfCurrentIn: [null] } };
  return rules;
})();

const NOT_FINAL_ORDER_FOR_CANCEL: ReadonlyArray<number | null> = [null, O.PENDING, O.IN_PROGRESS, O.CONFIRMED, O.CANCELED, ...CLOSED_ORDER_STATUSES];
const NOT_FINAL_SHIPMENT_FOR_CANCEL: ReadonlyArray<number | null> = [
  null, S.PENDING, S.READY_FOR_DELIVERY, S.CANCELED, S.REJECTED, S.FAILED_DELIVERY, S.SCHEDULED, S.OUT_FOR_DELIVERY, ...CLOSED_SHIPMENT_STATUSES,
];

/** Matrix 4: manufacture stage -> order + shipment (+ confirmation / schedule counterparts). Guards keep delivered/returned work from
 *  being regressed or cancelled by a vendor-side change; stages 1, 3, 4, 5 never touch the order. */
export const MANUFACTURE_STATUS_RULES: Readonly<Record<number, StatusRule>> = (() => {
  const rules: Record<number, StatusRule> = {
    [M.IN_PRODUCTION]: { status: { value: O.IN_PROGRESS, onlyIfCurrentIn: [O.PENDING, O.CONFIRMED] } },
    [M.READY_FOR_DELIVERY]: { shipmentStatus: { value: S.READY_FOR_DELIVERY, onlyIfCurrentIn: [null, S.PENDING, S.SCHEDULED] } },
    [M.DELIVERED]: { shipmentStatus: { value: S.OUT_FOR_DELIVERY, onlyIfCurrentIn: [null, S.PENDING, S.READY_FOR_DELIVERY, S.SCHEDULED] } },
    [M.FAILED_TO_DELIVER]: {
      shipmentStatus: { value: S.FAILED_DELIVERY, onlyIfCurrentIn: [null, S.PENDING, S.READY_FOR_DELIVERY, S.SCHEDULED, S.OUT_FOR_DELIVERY] },
    },
  };
  const shipmentGuards: Record<number, ReadonlyArray<number | null>> = {
    [O.DELIVERED]: [null, S.PENDING, S.IN_WAREHOUSE, S.READY_FOR_DELIVERY, S.FAILED_DELIVERY, S.SCHEDULED, S.OUT_FOR_DELIVERY],
    [O.IN_INVENTORY]: [null, S.PENDING, S.READY_FOR_DELIVERY, S.FAILED_DELIVERY, S.SCHEDULED, S.OUT_FOR_DELIVERY],
    [O.REFUNDED]: [null, S.PENDING, S.IN_WAREHOUSE, S.READY_FOR_DELIVERY, S.DELIVERED, S.FAILED_DELIVERY, S.SCHEDULED, S.OUT_FOR_DELIVERY],
    [O.REPLACED]: [
      null, S.PENDING, S.IN_WAREHOUSE, S.READY_FOR_DELIVERY, S.DELIVERED, S.RETURNED_FROM_CUSTOMER, S.FAILED_DELIVERY, S.SCHEDULED, S.OUT_FOR_DELIVERY,
    ],
  };
  const orderGuards: Record<number, ReadonlyArray<number | null>> = {
    [O.DELIVERED]: [null, O.PENDING, O.IN_PROGRESS, O.CONFIRMED, O.IN_INVENTORY],
    [O.IN_INVENTORY]: [null, O.PENDING, O.IN_PROGRESS, O.CONFIRMED],
    [O.REFUNDED]: [null, O.PENDING, O.IN_PROGRESS, O.CONFIRMED, O.DELIVERED, O.IN_INVENTORY],
    [O.REPLACED]: [null, O.PENDING, O.IN_PROGRESS, O.CONFIRMED, O.DELIVERED, O.IN_INVENTORY, O.REFUNDED],
  };
  for (const [orderStatusKey, manufactureStatus] of Object.entries(MANUFACTURE_STATUS_BY_ORDER_STATUS)) {
    const orderStatus = Number(orderStatusKey);
    const confirmation = CONFIRMATION_STATUS_BY_ORDER_STATUS[orderStatus];
    const schedule = SCHEDULE_STATUS_BY_ORDER_STATUS[orderStatus];
    const isCancel = MANUFACTURE_CANCEL_VALUES.includes(manufactureStatus);
    rules[manufactureStatus] = {
      status: { value: orderStatus, onlyIfCurrentIn: isCancel ? NOT_FINAL_ORDER_FOR_CANCEL : orderGuards[orderStatus] },
      shipmentStatus: {
        value: SHIPMENT_STATUS_BY_ORDER_STATUS[orderStatus]!,
        onlyIfCurrentIn: isCancel ? NOT_FINAL_SHIPMENT_FOR_CANCEL : shipmentGuards[orderStatus],
      },
      ...(confirmation !== undefined ? { confirmationStatus: withOrderGuard({ value: confirmation }, NOT_FINAL_ORDER_FOR_CANCEL) } : {}),
      ...(schedule !== undefined
        ? { scheduleStatus: withOrderGuard({ value: schedule, onlyIfCurrentIn: SCHEDULE_OPEN }, NOT_FINAL_ORDER_FOR_CANCEL) }
        : {}),
    };
  }
  return rules;
})();

/** Matrix 5: schedule status -> shipment / order / manufacture / confirmation. Scheduled (1) books the shipment; the
 *  three cancel reasons (4 delay, 5 changed mind, 6 no response) cancel it like the matching order cancel variant. */
export const SCHEDULE_STATUS_RULES: Readonly<Record<number, StatusRule>> = (() => {
  const rules: Record<number, StatusRule> = {
    [SC.SCHEDULED]: { shipmentStatus: { value: S.SCHEDULED, onlyIfCurrentIn: [null, S.PENDING, S.READY_FOR_DELIVERY, S.FAILED_DELIVERY] } },
  };
  for (const [orderStatusKey, scheduleStatus] of Object.entries(SCHEDULE_STATUS_BY_ORDER_STATUS)) {
    const orderStatus = Number(orderStatusKey);
    const confirmation = CONFIRMATION_STATUS_BY_ORDER_STATUS[orderStatus];
    rules[scheduleStatus] = {
      status: { value: orderStatus, onlyIfCurrentIn: NOT_FINAL_ORDER_FOR_CANCEL },
      shipmentStatus: { value: SHIPMENT_STATUS_BY_ORDER_STATUS[orderStatus]!, onlyIfCurrentIn: NOT_FINAL_SHIPMENT_FOR_CANCEL },
      manufactureStatus: withOrderGuard(
        { value: MANUFACTURE_STATUS_BY_ORDER_STATUS[orderStatus]!, onlyIfCurrentIn: [...M_OPEN, M.IN_WAREHOUSE] },
        NOT_FINAL_ORDER_FOR_CANCEL,
      ),
      ...(confirmation !== undefined ? { confirmationStatus: withOrderGuard({ value: confirmation }, NOT_FINAL_ORDER_FOR_CANCEL) } : {}),
    };
  }
  return rules;
})();

/** Order statuses that mean "closed by cancel/reject": 4 and 9..17. Confirming reopens these. */
const CANCELED_ORDER_STATUS_VALUES: ReadonlyArray<number> = [O.CANCELED, ...CLOSED_ORDER_STATUSES];
/** Shipment statuses closed by cancel: 5 and 13..21. (6 "rejected" is deliberately excluded: no order status maps to it and
 *  it is not in CLOSED_SHIPMENT_STATUSES, so it is not something a confirmation cancel closes.) */
const CANCELED_SHIPMENT_STATUS_VALUES: ReadonlyArray<number> = [S.CANCELED, ...CLOSED_SHIPMENT_STATUSES];

/**
 * Matrix 3a: confirmation 2 (confirmed) ->
 *  - order becomes confirmed (3) when it is pending (1) OR closed by cancel/reject (4, 9..17), so going back to
 *    "confirmed" after a confirmation cancel reopens what the cancel closed (cancel -> confirm -> cancel -> confirm is stable);
 *  - a cancelled shipment (5, 13..21) returns to pending (1).
 * Delivered (5), returned/refunded (6), replaced (7) and in-inventory (8) orders, and shipment statuses 2, 4, 7, 9,
 * are never touched: confirming must not regress them.
 *
 */
export const CONFIRMATION_CONFIRMED_RULE: StatusRule = {
  status: { value: O.CONFIRMED, onlyIfCurrentIn: [O.PENDING, ...CANCELED_ORDER_STATUS_VALUES] },
  shipmentStatus: { value: S.PENDING, onlyIfCurrentIn: CANCELED_SHIPMENT_STATUS_VALUES },
  /* a manufacture stage closed by the same cancel reopens to "accepted" (1); only while the order itself is cancelled/rejected. */
  manufactureStatus: {
    value: M.Accepted,
    onlyIfCurrentIn: MANUFACTURE_CANCEL_VALUES,
    onlyIfOtherCurrentIn: { field: "status", values: CANCELED_ORDER_STATUS_VALUES },
  },
};

/**
 * Matrix 3a': confirmation 1 (pending), 3/4/5 (no answer, attempt 1/2/3) and 6 (call back later) ALSO reopen a
 * cancelled/rejected order: order 4 or 9..17 -> 1 (pending), and its shipment 5 or 13..21 -> 1 (only while the order is
 * cancelled/rejected). They ALSO send a CONFIRMED order (3) back to pending (1), undoing the confirmation-driven
 * promotion (confirm -> back to pending/no answer -> order pending again); the shipment of a confirmed order is not
 * touched. They never change an order that is pending, in progress (2), delivered, returned, replaced or in
 * inventory (manufacturing/delivered work is never regressed), nor those orders' shipments.
 * No loop: this fires from a CONFIRMATION change only; order 3 -> confirmation 2 fires from an ORDER change only.
 * Explicit payload values still win and it is one hop, like every other rule.
 */
export const CONFIRMATION_REOPEN_PENDING_RULE: StatusRule = {
  status: { value: O.PENDING, onlyIfCurrentIn: [O.CONFIRMED, ...CANCELED_ORDER_STATUS_VALUES] },
  shipmentStatus: {
    value: S.PENDING,
    onlyIfCurrentIn: CANCELED_SHIPMENT_STATUS_VALUES,
    onlyIfOtherCurrentIn: { field: "status", values: CANCELED_ORDER_STATUS_VALUES },
  },
  manufactureStatus: {
    value: M.Accepted,
    onlyIfCurrentIn: MANUFACTURE_CANCEL_VALUES,
    onlyIfOtherCurrentIn: { field: "status", values: CANCELED_ORDER_STATUS_VALUES },
  },
};
export const CONFIRMATION_REOPEN_PENDING_VALUES: ReadonlyArray<number> = [
  C.PENDING, C.NO_ANSWER_FIRST_ATTEMPT, C.NO_ANSWER_SECOND_ATTEMPT, C.NO_ANSWER_THIRD_ATTEMPT, C.CALL_BACK_LATER,
];

/** Matrix 3b: confirmation 7..11 (cancel) -> order + shipment cancel variant, by manufacture stage. */
export const CONFIRMATION_CANCEL_VALUES: ReadonlyArray<number> = [
  C.CANCELED_NO_CUSTOMER_RESPONSE,
  C.CANCELED_FAKE_ORDER,
  C.CANCELED_DUPLICATE_ORDER,
  C.CANCELED_SPECIAL_CIRCUMSTANCES,
  C.CANCELED_CHANGED_MIND,
];
/** Manufacture statuses null/1/2 are "before manufacturing confirmation"; anything else is after. */
export const CONFIRMATION_CANCEL_RULES: Readonly<{ beforeManufacture: StatusRule; afterManufacture: StatusRule }> = {
  beforeManufacture: {
    status: { value: O.CANCELED_BEFORE_MFG_CONFIRMATION },
    shipmentStatus: { value: S.CANCELED_BEFORE_MFG_CONFIRMATION },
    manufactureStatus: { value: M.CANCELED_BEFORE_MFG_CONFIRMATION, onlyIfCurrentIn: [null, M.Accepted, M.IN_PRODUCTION] },
  },
  afterManufacture: {
    status: { value: O.CANCELED_AFTER_MFG_CONFIRMATION_72H },
    shipmentStatus: { value: S.CANCELED_AFTER_MFG_CONFIRMATION_72H },
    manufactureStatus: {
      value: M.CANCELED_AFTER_MFG_CONFIRMATION_72H,
      onlyIfCurrentIn: [M.READY_FOR_DELIVERY, M.DELIVERED, M.FAILED_TO_DELIVER, M.DELIVERED_SUCCESSFULLY, M.IN_WAREHOUSE],
    },
  },
};
const BEFORE_MANUFACTURE_STATUSES: ReadonlyArray<number | null> = [null, 1, 2];

const toStatusNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const ruleFor = (source: StatusField, value: number, manufactureStatus: number | null): StatusRule | undefined => {
  if (source === "status") return ORDER_STATUS_RULES[value];
  if (source === "shipmentStatus") return SHIPMENT_STATUS_RULES[value];
  if (source === "manufactureStatus") return MANUFACTURE_STATUS_RULES[value];
  if (source === "scheduleStatus") return SCHEDULE_STATUS_RULES[value];
  if (value === C.CONFIRMED) return CONFIRMATION_CONFIRMED_RULE;
  if (CONFIRMATION_REOPEN_PENDING_VALUES.includes(value)) return CONFIRMATION_REOPEN_PENDING_RULE;
  if (CONFIRMATION_CANCEL_VALUES.includes(value)) {
    return BEFORE_MANUFACTURE_STATUSES.includes(manufactureStatus)
      ? CONFIRMATION_CANCEL_RULES.beforeManufacture
      : CONFIRMATION_CANCEL_RULES.afterManufacture;
  }
  return undefined;
};

/**
 * Pure. `before` is the stored row (or its plain object), `payload` the fields the
 * writer is about to save. Returns the extra columns to write (`patch`, only fields
 * that really change) and an audit description of each (`derived`).
 */
export const deriveStatusPatch = (
  before: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown> | null | undefined,
  context: StatusSyncContext = {},
): StatusSyncResult => {
  const stored = before ?? {};
  const incoming = payload ?? {};
  const current: Record<StatusField, number | null> = {
    status: toStatusNumber(stored.status),
    shipmentStatus: toStatusNumber(stored.shipmentStatus),
    confirmationStatus: toStatusNumber(stored.confirmationStatus),
    manufactureStatus: toStatusNumber(stored.manufactureStatus),
    scheduleStatus: toStatusNumber(stored.scheduleStatus),
  };

  /* A field is "changed" when the payload carries a value different from the stored one. */
  const changed: Partial<Record<StatusField, number>> = {};
  for (const field of STATUS_FIELDS) {
    const value = toStatusNumber(incoming[field]);
    if (value !== null && value !== current[field]) changed[field] = value;
  }

  const manufactureStatus = toStatusNumber(
    context.manufactureStatus !== undefined
      ? context.manufactureStatus
      : (incoming.manufactureStatus ?? stored.manufactureStatus),
  );

  const patch: StatusPatch = {};
  const derived: DerivedChange[] = [];
  for (const source of STATUS_FIELDS) {
    const sourceValue = changed[source];
    if (sourceValue === undefined) continue;
    const rule = ruleFor(source, sourceValue, manufactureStatus);
    if (!rule) continue;
    for (const target of STATUS_FIELDS) {
      const entry = rule[target];
      if (!entry || target === source) continue;
      if (changed[target] !== undefined || patch[target] !== undefined) continue; // explicit wins / higher priority already derived
      if (entry.onlyIfCurrentIn && !entry.onlyIfCurrentIn.includes(current[target])) continue;
      if (entry.onlyIfOtherCurrentIn && !entry.onlyIfOtherCurrentIn.values.includes(current[entry.onlyIfOtherCurrentIn.field])) continue;
      if (entry.value === current[target]) continue;
      patch[target] = entry.value;
      derived.push({ field: target, from: current[target], to: entry.value, source });
    }
  }
  return { derived, patch };
};

/** Fields written as the derived part of an update (convenience for callers merging into a payload). */
export const applyStatusPatch = <T extends Record<string, unknown>>(payload: T, patch: StatusPatch): T & StatusPatch =>
  ({ ...payload, ...patch });

type LogRow = {
  action: string; entityId: number; entityType: "order"; field: string; from: string | null; to: string | null; userId: number | null;
};

/** Marker rows are written next to the normal `update` rows so existing log readers keep working. */
export const AUTO_SYNC_LOG_ACTION = "auto_sync";
export const AUTO_SYNC_LOG_FIELD = "autoSync";

/**
 * Audit rows for derived changes: the usual `update` row for the target field (what the timeline and
 * shipment-performance queries already read) plus an `auto_sync` marker saying the change was automatic
 * and which field caused it (`from` = source field, `to` = "<target>:<from>-><to>").
 */
export const buildAutoSyncLogRows = (
  orderId: number,
  derived: DerivedChange[],
  userId?: number | string | null,
  options: { includeUpdateRows?: boolean } = {},
): LogRow[] => {
  const includeUpdateRows = options.includeUpdateRows !== false;
  const normalizedUserId = userId === undefined || userId === null || userId === "" || !Number.isFinite(Number(userId))
    ? null
    : Number(userId);
  return derived.flatMap((change): LogRow[] => [
    ...(includeUpdateRows
      ? [{
        action: "update", entityId: orderId, entityType: "order" as const, field: change.field,
        from: change.from === null ? null : String(change.from), to: String(change.to), userId: normalizedUserId,
      }]
      : []),
    {
      action: AUTO_SYNC_LOG_ACTION, entityId: orderId, entityType: "order", field: AUTO_SYNC_LOG_FIELD,
      from: change.source, to: `${change.field}:${change.from ?? ""}->${change.to}`, userId: normalizedUserId,
    },
  ]);
};

/**
 * PoDate («تاريخ التصنيع», orders."PoDate") rule. The order is "in manufacturing" when its order status is 2 (IN_PROGRESS)
 * OR its manufacture stage is 2 (IN_PRODUCTION). The date is stamped when a write moves the row into that state:
 *  - the final row (stored values + payload + derived patch) is in manufacturing, AND
 *  - the stored row was NOT already in manufacturing through either field (so a vendor setting stage 2 on an order that is
 *    already status 2, an unrelated edit, or the derived second field of the same transition never re-stamps), OR the stored
 *    PoDate is empty (backfills the gap when an order enters through a field after being in manufacturing without a date).
 * Re-entering after leaving the state stamps again (same as the existing order-status rule). Manual PoDate writes stay rejected.
 */
export const isInManufacturing = (row: Record<string, unknown> | null | undefined): boolean =>
  toStatusNumber(row?.status) === O.IN_PROGRESS || toStatusNumber(row?.manufactureStatus) === M.IN_PRODUCTION;

export const shouldStampPoDate = (
  before: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown> | null | undefined,
  patch: StatusPatch = {},
): boolean => {
  const stored = (typeof (before as { toJSON?: unknown } | null)?.toJSON === "function"
    ? (before as unknown as { toJSON: () => Record<string, unknown> }).toJSON()
    : before) ?? {};
  before = stored;
  const after = { ...stored, ...(payload ?? {}), ...patch };
  if (!isInManufacturing(after)) return false;
  const movedIn = toStatusNumber(after.status) === O.IN_PROGRESS && toStatusNumber(before?.status) !== O.IN_PROGRESS
    || toStatusNumber(after.manufactureStatus) === M.IN_PRODUCTION && toStatusNumber(before?.manufactureStatus) !== M.IN_PRODUCTION;
  if (!movedIn) return false;
  return !isInManufacturing(before) || !before?.PoDate;
};
