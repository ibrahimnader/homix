/**
 * «توصيل مجمع» propagation.
 *
 * One Shopify/manual order is split into one Homix order per item and every split keeps the same
 * `orderNumber`, so the siblings of an order are simply the other orders carrying its orderNumber.
 * When the shipment type of one order changes, its siblings follow:
 *
 *  - TO grouped      -> every sibling that is not already grouped becomes the same grouped value.
 *  - AWAY from grouped (to another non-empty type) -> only the siblings that are still grouped take the
 *    new value; a sibling that was independently set to something else keeps it.
 *  - Clearing the type (null / "") never cascades.
 *  - Nothing cascades unless the edited order's type really changed, so re-saving an untouched form
 *    cannot override an independent choice made on a sibling.
 *
 * Siblings that are soft-deleted (paranoid model) or closed (cancelled / rejected order or shipment, the
 * same rule `isExcludedFromGroupedShipment` uses for the completeness badge) are left untouched, and so
 * are the orders edited in the same request (they receive the payload directly).
 *
 * The field is not a status, so it never takes part in `deriveStatusPatch`; the siblings are written with
 * the model's own validation, the audit rows use the existing `update` + `auto_sync` shape, and nothing
 * here can loop back into a status sync. All sibling writes and their audit rows share one transaction.
 */
import { Op } from "sequelize";
import { isExcludedFromGroupedShipment } from "../shipments/shipment.helpers";
import { toNumber, toPlain, toText } from "./order.helpers";

export const GROUPED_SHIPMENT_TYPES: ReadonlySet<string> = new Set(["collected", "grouped", "warehouse"]);

export const LINKED_ORDER_MARKER_PREFIX = "تم تلقائيًا مع الطلب المرتبط #";

const normalizeType = (value: unknown): string => toText(value).trim().toLowerCase();

export const isGroupedShipmentType = (value: unknown): boolean => GROUPED_SHIPMENT_TYPES.has(normalizeType(value));

export type GroupedSyncSource = {
  id: number;
  orderNumber: unknown;
  /** Human reference shown in the audit marker; falls back to the id. */
  code?: unknown;
  beforeType: unknown;
  nextType: unknown;
};

export type GroupedSyncSibling = { id: number; orderNumber: string; shipmentType: unknown; status?: unknown; shipmentStatus?: unknown };

export type GroupedSyncChange = {
  orderId: number;
  from: string | null;
  to: string;
  sourceId: number;
  sourceLabel: string;
};

/** The sources whose edit should cascade, with the value the siblings should take. */
const cascadingSources = (sources: GroupedSyncSource[]): Array<GroupedSyncSource & { to: string; toGrouped: boolean }> =>
  sources.flatMap((source) => {
    const orderNumber = toText(source.orderNumber).trim();
    if (!orderNumber) return [];
    const to = toText(source.nextType).trim();
    if (!to) return [];
    if (normalizeType(source.beforeType) === normalizeType(to)) return [];
    return [{ ...source, to, toGrouped: isGroupedShipmentType(to) }];
  });

/** Pure planning step: which siblings change, and to what. */
export const planGroupedShipmentTypeSync = (
  sources: GroupedSyncSource[],
  siblings: GroupedSyncSibling[],
): GroupedSyncChange[] => {
  const editedIds = new Set(sources.map((source) => Number(source.id)));
  const changes = new Map<number, GroupedSyncChange>();
  for (const source of cascadingSources(sources)) {
    const sourceOrderNumber = toText(source.orderNumber).trim();
    for (const sibling of siblings) {
      if (editedIds.has(sibling.id) || changes.has(sibling.id)) continue;
      if (toText(sibling.orderNumber).trim() !== sourceOrderNumber) continue;
      if (isExcludedFromGroupedShipment(sibling as Record<string, unknown>)) continue;
      const siblingGrouped = isGroupedShipmentType(sibling.shipmentType);
      const applies = source.toGrouped ? !siblingGrouped : siblingGrouped;
      if (!applies) continue;
      changes.set(sibling.id, {
        orderId: sibling.id,
        from: toText(sibling.shipmentType).trim() || null,
        to: source.to,
        sourceId: Number(source.id),
        sourceLabel: toText(source.code).trim() || String(source.id),
      });
    }
  }
  return [...changes.values()];
};

export const buildGroupedSyncLogRows = (
  change: GroupedSyncChange,
  userId?: number | string | null,
): Array<Record<string, unknown>> => {
  const normalizedUserId = userId === undefined || userId === null || userId === "" || !Number.isFinite(Number(userId))
    ? null
    : Number(userId);
  return [
    {
      action: "update", entityId: change.orderId, entityType: "order", field: "shipmentType",
      from: change.from, to: change.to, userId: normalizedUserId,
    },
    {
      action: "auto_sync", entityId: change.orderId, entityType: "order", field: "autoSync",
      from: `${LINKED_ORDER_MARKER_PREFIX}${change.sourceLabel}`,
      to: `shipmentType:${change.from ?? ""}->${change.to}`,
      userId: normalizedUserId,
    },
  ];
};

/**
 * Reads the siblings, writes them and their audit rows in one transaction, and returns the ids that
 * were updated (empty when nothing cascaded). Models are required lazily so importing this module in
 * a unit test does not open the database layer.
 */
export const applyGroupedShipmentTypeSync = async (
  sources: GroupedSyncSource[],
  userId?: number | string | null,
): Promise<number[]> => {
  const cascading = cascadingSources(sources);
  if (cascading.length === 0) return [];

  /* eslint-disable @typescript-eslint/no-require-imports */
  const orderModel = require("../../../app/modules/order/order.model");
  const logModel = require("../../../app/modules/logs/log.model");
  const { sequelize } = require("../../infrastructure/database");
  /* eslint-enable @typescript-eslint/no-require-imports */

  const orderNumbers = [...new Set(cascading.map((source) => toText(source.orderNumber).trim()))];
  const editedIds = sources.map((source) => Number(source.id));

  return sequelize.transaction(async (transaction: unknown) => {
    const rows: Array<{ update: (patch: Record<string, unknown>, options: unknown) => Promise<unknown> }> =
      await orderModel.findAll({
        attributes: ["id", "orderNumber", "shipmentType", "status", "shipmentStatus"],
        where: { orderNumber: { [Op.in]: orderNumbers }, id: { [Op.notIn]: editedIds } },
        transaction,
      });
    const plain = rows.map((row) => toPlain(row));
    const changes = planGroupedShipmentTypeSync(
      sources,
      plain.map((row) => ({
        id: toNumber(row.id),
        orderNumber: toText(row.orderNumber),
        shipmentType: row.shipmentType,
        status: row.status,
        shipmentStatus: row.shipmentStatus,
      })),
    );
    const rowById = new Map(rows.map((row, index) => [toNumber(plain[index]!.id), row]));
    for (const change of changes) {
      await rowById.get(change.orderId)!.update({ shipmentType: change.to }, { transaction });
      await logModel.bulkCreate(buildGroupedSyncLogRows(change, userId), { transaction });
    }
    return changes.map((change) => change.orderId);
  });
};

export type LinkedOrderIds = { linkedOrderIds?: number[]; linkedOrdersCount?: number };

/** `linkedOrderIds` is only added when something cascaded, so existing response shapes stay untouched. */
export const withLinkedOrderIds = <T>(data: T, linkedOrderIds: number[]): T & LinkedOrderIds =>
  linkedOrderIds.length === 0
    ? (data as T & LinkedOrderIds)
    : { ...(toPlain(data) as object), linkedOrderIds, linkedOrdersCount: linkedOrderIds.length } as T & LinkedOrderIds;
