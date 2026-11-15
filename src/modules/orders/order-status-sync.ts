import { CLOSED_ORDER_STATUSES, CLOSED_SHIPMENT_STATUSES, CONFIRMATION_STATUS, ORDER_STATUS, SHIPMENTS_STATUS } from "../../../config/constants";

/**
 * The three statuses of an `orders` row — `status` (order), `shipmentStatus` and
 * `confirmationStatus` — are linked: changing one drives the other two. This module
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
 *  - no guard on final states: a change always propagates, including reopening.
 *  - several changed fields: each changed field derives the targets that are still
 *    unset; priority is order status, then shipment status, then confirmation status.
 */

export type StatusField = "status" | "shipmentStatus" | "confirmationStatus";
export const STATUS_FIELDS: readonly StatusField[] = ["status", "shipmentStatus", "confirmationStatus"];

/** What a source value writes into one target column. */
export type StatusTarget = {
  value: number;
  /** Only write when the stored value of that column is one of these (null = unset). */
  onlyIfCurrentIn?: ReadonlyArray<number | null>;
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

/** Matrix 1: order status -> {shipmentStatus, confirmationStatus}. Statuses absent here (1, 2) derive nothing. */
export const ORDER_STATUS_RULES: Readonly<Record<number, StatusRule>> = (() => {
  const rules: Record<number, StatusRule> = {};
  for (const [orderStatus, shipmentStatus] of Object.entries(SHIPMENT_STATUS_BY_ORDER_STATUS)) {
    rules[Number(orderStatus)] = { shipmentStatus: { value: shipmentStatus } };
  }
  for (const [orderStatus, confirmationStatus] of Object.entries(CONFIRMATION_STATUS_BY_ORDER_STATUS)) {
    rules[Number(orderStatus)] = { ...rules[Number(orderStatus)], confirmationStatus: { value: confirmationStatus } };
  }
  rules[O.CONFIRMED] = { confirmationStatus: { value: C.CONFIRMED, onlyIfCurrentIn: UNCONFIRMED_CONFIRMATION } };
  return rules;
})();

/** Matrix 2: shipment status -> order status (+ the order's confirmation counterpart). 3, 8, 10, 11, 12 derive nothing. */
export const SHIPMENT_STATUS_RULES: Readonly<Record<number, StatusRule>> = (() => {
  const rules: Record<number, StatusRule> = {};
  for (const [orderStatus, shipmentStatus] of Object.entries(SHIPMENT_STATUS_BY_ORDER_STATUS)) {
    const confirmation = CONFIRMATION_STATUS_BY_ORDER_STATUS[Number(orderStatus)];
    rules[shipmentStatus] = {
      status: { value: Number(orderStatus) },
      ...(confirmation !== undefined ? { confirmationStatus: { value: confirmation } } : {}),
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
 * Opposite direction (confirmation 7..11 -> 1, 3, 4, 5, 6): intentionally derives NOTHING. Reopening on those is
 * not approved; only the explicit "confirmed" value reopens.
 */
export const CONFIRMATION_CONFIRMED_RULE: StatusRule = {
  status: { value: O.CONFIRMED, onlyIfCurrentIn: [O.PENDING, ...CANCELED_ORDER_STATUS_VALUES] },
  shipmentStatus: { value: S.PENDING, onlyIfCurrentIn: CANCELED_SHIPMENT_STATUS_VALUES },
};

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
  },
  afterManufacture: {
    status: { value: O.CANCELED_AFTER_MFG_CONFIRMATION_72H },
    shipmentStatus: { value: S.CANCELED_AFTER_MFG_CONFIRMATION_72H },
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
  if (value === C.CONFIRMED) return CONFIRMATION_CONFIRMED_RULE;
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
