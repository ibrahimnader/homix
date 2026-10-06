import { QueryTypes, Transaction } from "sequelize";
import moment from "moment-timezone";
import { sequelize } from "../../infrastructure/database";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors";
import { z } from "zod";
import { ORDER_STATUS, SHIPMENTS_STATUS, DELIVERY_BY } from "../../../config/constants";
import {
  receivingCreateSchema,
  receivingListSchema,
} from "./receiving.schemas";

/* Warehouse receiving lives entirely on `orders` — splitImportedOrderByUnit
   (order-discounts.ts) splits every imported/manual order down to one line,
   quantity 1, before it's ever saved, so `orders` and `orderLines` are always
   1:1 here. There is never a case of one order needing several independent
   receipts, so a dedicated receipts table would just duplicate `orders`. */
export type ReceivedItem = {
  orderId: number;
  operationNumber: string;
  orderNumber: string;
  productName: string;
  productSku: string;
  vendorName: string;
  quantity: number;
  manufactureDate: string | null;
  receivedDate: string | null;
  receiverName: string | null;
  senderName: string | null;
  notes: string | null;
  manufactureDays: number | null;
  documentNumber: string | null;
  documentIssuedAt: string | null;
};

const select = <T extends object>(
  sql: string,
  replacements: Record<string, unknown>,
  transaction?: Transaction
) =>
  sequelize.query<T>(sql, { replacements, transaction, type: QueryTypes.SELECT });

const itemFrom = `FROM orders o
  LEFT JOIN "orderLines" l ON l."orderId" = o.id AND l."deletedAt" IS NULL
  LEFT JOIN products p ON p.id = l."productId"
  LEFT JOIN vendors v ON v.id = p."vendorId"`;
const candidateColumns = `o.id AS "orderId", o.code AS "operationNumber", o."orderNumber",
  COALESCE(l.title, p.title, '') AS "productName", COALESCE(l.sku, '') AS "productSku",
  COALESCE(v.name, '') AS "vendorName", COALESCE(l.quantity, 1) AS quantity, o."PoDate" AS "manufactureDate"`;
const candidateWhere = `o."deletedAt" IS NULL AND o."warehouseReceivedBy" IS NULL
  AND COALESCE(o.status, 1) IN (1,2,3) AND COALESCE(o."shipmentStatus", 1) IN (1,11)`;
const receivedColumns = `${candidateColumns}, o."shippingReceiveDate" AS "receivedDate",
  o."warehouseSenderName" AS "senderName", o."warehouseReceiptNotes" AS notes,
  o."warehouseReceiptNumber" AS "documentNumber", o."warehouseReceiptIssuedAt" AS "documentIssuedAt",
  concat_ws(' ', u."firstName", u."lastName") AS "receiverName"`;
const receivedFrom = `${itemFrom} LEFT JOIN users u ON u.id = o."warehouseReceivedBy"`;

const withManufactureDays = (row: ReceivedItem): ReceivedItem => ({
  ...row,
  manufactureDays:
    row.manufactureDate && row.receivedDate
      ? moment(row.receivedDate).diff(moment(row.manufactureDate), "days")
      : null,
});

export class ReceivingService {
  async candidates(filters: z.infer<typeof receivingListSchema>) {
    const replacements = {
      search: `%${filters.search}%`,
      offset: (filters.page - 1) * 20,
    };
    const where = `${candidateWhere} AND (o.code ILIKE :search OR o."orderNumber" ILIKE :search
      OR l.sku ILIKE :search OR l.title ILIKE :search OR v.name ILIKE :search)`;
    const items = await select<ReceivedItem>(
      `SELECT ${candidateColumns} ${itemFrom} WHERE ${where}
      ORDER BY o.id LIMIT 20 OFFSET :offset`,
      replacements
    );
    const [count] = await select<{ total: number }>(
      `SELECT COUNT(*)::int AS total ${itemFrom} WHERE ${where}`,
      replacements
    );
    return { items, totalCount: count?.total ?? 0, page: filters.page, size: 20 };
  }

  async list(filters: z.infer<typeof receivingListSchema>) {
    const replacements = {
      search: `%${filters.search}%`,
      date: filters.date,
      offset: (filters.page - 1) * 20,
    };
    const where = `o."deletedAt" IS NULL AND o."warehouseReceivedBy" IS NOT NULL
      AND (o.code ILIKE :search OR o."orderNumber" ILIKE :search
      OR l.sku ILIKE :search OR l.title ILIKE :search OR v.name ILIKE :search)
      ${filters.date ? `AND o."shippingReceiveDate"::date = :date` : ""}`;
    const rows = await select<ReceivedItem>(
      `SELECT ${receivedColumns} ${receivedFrom} WHERE ${where}
      ORDER BY o."shippingReceiveDate" DESC, o.id DESC
      LIMIT 20 OFFSET :offset`,
      replacements
    );
    const [count] = await select<{ total: number }>(
      `SELECT COUNT(*)::int AS total ${itemFrom} WHERE ${where}`,
      replacements
    );
    return {
      items: rows.map(withManufactureDays),
      totalCount: count?.total ?? 0,
      page: filters.page,
      size: 20,
    };
  }

  async documents(filters: z.infer<typeof receivingListSchema>) {
    const replacements = {
      search: `%${filters.search}%`,
      offset: (filters.page - 1) * 20,
    };
    const where = `o."warehouseReceiptNumber" IS NOT NULL AND o."warehouseReceiptNumber" ILIKE :search`;
    const rows = await select<{
      number: string;
      issuedAt: string;
      itemCount: number;
      quantity: number;
    }>(
      `SELECT o."warehouseReceiptNumber" AS number, MIN(o."warehouseReceiptIssuedAt") AS "issuedAt",
      COUNT(*)::int AS "itemCount", SUM(COALESCE(l.quantity, 1))::int AS quantity
      ${itemFrom} WHERE ${where}
      GROUP BY o."warehouseReceiptNumber" ORDER BY MIN(o."warehouseReceiptIssuedAt") DESC
      LIMIT 20 OFFSET :offset`,
      replacements
    );
    const [count] = await select<{ total: number }>(
      `SELECT COUNT(DISTINCT o."warehouseReceiptNumber")::int AS total FROM orders o WHERE ${where}`,
      replacements
    );
    return { items: rows, totalCount: count?.total ?? 0, page: filters.page, size: 20 };
  }

  async getDocument(number: string, transaction?: Transaction) {
    const rows = await select<ReceivedItem>(
      `SELECT ${receivedColumns} ${receivedFrom}
      WHERE o."warehouseReceiptNumber" = :number ORDER BY o.id`,
      { number },
      transaction
    );
    if (!rows.length) throw new NotFoundError("سند الاستلام غير موجود");
    return {
      number,
      issuedAt: rows[0]!.documentIssuedAt,
      items: rows.map(withManufactureDays),
    };
  }

  async refreshMetrics(orderIds: number[]) {
    const dates = await select<{ day: string }>(
      `SELECT DISTINCT to_char("orderDate", 'YYYY-MM-DD') AS day
      FROM orders WHERE id IN (:ids) AND "orderDate" IS NOT NULL`,
      { ids: orderIds }
    );
    if (!dates.length) return;
    const { DashboardAggregateService } = require("../dashboard/dashboard-aggregate.service");
    const { DashboardRepository } = require("../dashboard/dashboard.repo");
    const aggregates = new DashboardAggregateService(new DashboardRepository());
    for (const { day } of dates) await aggregates.refreshRange(day, day);
  }

  async receive(input: z.infer<typeof receivingCreateSchema>, userId: number) {
    return sequelize.transaction(async (transaction) => {
      await select(
        `SELECT id FROM orders WHERE id IN (:ids) ORDER BY id FOR UPDATE`,
        { ids: input.orderIds },
        transaction
      );
      const eligible = await select<{ orderId: number }>(
        `SELECT o.id AS "orderId" ${itemFrom} WHERE ${candidateWhere} AND o.id IN (:ids)`,
        { ids: input.orderIds },
        transaction
      );
      if (eligible.length !== input.orderIds.length) {
        throw new ConflictError(
          "بعض الطلبات مستلمة بالفعل أو لم تعد متاحة للاستلام. حدّث القائمة."
        );
      }
      const [user] = await select<{ name: string }>(
        `SELECT concat_ws(' ', "firstName", "lastName") AS name
        FROM users WHERE id = :userId AND "deletedAt" IS NULL`,
        { userId },
        transaction
      );
      if (!user) throw new NotFoundError("المستخدم غير موجود");

      const Order = require("../../../app/modules/order/order.model");
      const Log = require("../../../app/modules/logs/log.model");
      for (const orderId of input.orderIds) {
        const order = await Order.findByPk(orderId, { transaction });
        const manufactureDate = order.PoDate
          ? moment(order.PoDate).tz("Africa/Cairo").format("YYYY-MM-DD")
          : null;
        if (manufactureDate && input.receivedDate < manufactureDate) {
          throw new ValidationError("تاريخ الاستلام يسبق تاريخ التصنيع");
        }
        const changes = {
          warehouseReceivedBy: userId,
          warehouseSenderName: input.senderName,
          warehouseReceiptNotes: input.notes,
          shippingReceiveDate: moment
            .tz(input.receivedDate, "YYYY-MM-DD", "Africa/Cairo")
            .toISOString(),
          status: ORDER_STATUS.IN_INVENTORY,
          shipmentStatus: SHIPMENTS_STATUS.IN_WAREHOUSE,
          deliveryBy: DELIVERY_BY.HOMIX,
          shippedFromInventory: true,
        };
        await Log.bulkCreate(
          Object.entries(changes)
            .filter(([field, value]) => String(order[field] ?? "") !== String(value))
            .map(([field, value]) => ({
              entityId: orderId,
              entityType: "order",
              action: "update",
              field,
              from: String(order[field] ?? ""),
              to: String(value),
              userId,
            })),
          { transaction }
        );
        await order.update(changes, { transaction });
      }
      return { orderIds: input.orderIds, receiverName: user.name };
    });
  }

  /** Stamps a (re)shared document number onto already-received orders — printing
   * is a separate step from receiving, so "لسه ما اتطبعش" is a real, persisted
   * state and not just a dialog artifact. Re-running this on orders that
   * already had a number re-groups them under a new one. */
  async printDocument(orderIds: number[]) {
    return sequelize.transaction(async (transaction) => {
      const rows = await select<{ orderId: number }>(
        `SELECT id AS "orderId" FROM orders
        WHERE id IN (:ids) AND "deletedAt" IS NULL AND "warehouseReceivedBy" IS NOT NULL
        ORDER BY id FOR UPDATE`,
        { ids: orderIds },
        transaction
      );
      if (rows.length !== orderIds.length) {
        throw new NotFoundError("بعض الطلبات المحددة لم تُستلم بعد أو غير موجودة");
      }
      const [sequenceRow] = await select<{ seq: string }>(
        `SELECT nextval('warehouse_receipt_number_seq') AS seq`,
        {},
        transaction
      );
      if (!sequenceRow) throw new Error("Receipt number sequence unavailable");
      const issuedAt = new Date().toISOString();
      const number = `RCV-${moment(issuedAt).tz("Africa/Cairo").year()}-${String(sequenceRow.seq).padStart(4, "0")}`;
      await sequelize.query(
        `UPDATE orders SET "warehouseReceiptNumber" = :number, "warehouseReceiptIssuedAt" = :issuedAt
        WHERE id IN (:ids)`,
        { replacements: { number, issuedAt, ids: orderIds }, transaction }
      );
      return this.getDocument(number, transaction);
    });
  }
}
