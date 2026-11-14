import { QueryTypes, Transaction } from "sequelize";
import moment from "moment-timezone";
import { toDateRangeBoundary } from "./shipment.helpers";
import { sequelize } from "../../infrastructure/database";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors";
import { z } from "zod";
import { ORDER_STATUS, SHIPMENTS_STATUS, DELIVERY_BY } from "../../../config/constants";
import { buildAutoSyncLogRows, deriveStatusPatch } from "../orders/order-status-sync";
import {
  receivingCreateSchema,
  receivingListSchema,
  receivingCandidatesSchema,
  receivingReceivedFilterSchema,
  receivingExportSchema,
  receivingUpdateSchema,
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

const ExcelJS = require("exceljs");

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

/** Escapes LIKE wildcards so user input like "50%" or "A_1" matches literally (ILIKE default escape is backslash). */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
const contains = (value: string) => `%${escapeLike(value)}%`;

const withManufactureDays = (row: ReceivedItem): ReceivedItem => ({
  ...row,
  manufactureDays:
    row.manufactureDate && row.receivedDate
      ? moment(row.receivedDate).diff(moment(row.manufactureDate), "days")
      : null,
});

export class ReceivingService {
  private async addReceiptStock(order: any, transaction: Transaction): Promise<void> {
    const lines = await select<{ productId: number; sku: string | null; quantity: number; cost: number }>(
      `SELECT "productId", sku, quantity, cost FROM "orderLines"
       WHERE "orderId" = :orderId AND "deletedAt" IS NULL ORDER BY id LIMIT 2`,
      { orderId: order.id }, transaction
    );
    if (lines.length !== 1) throw new ValidationError("يجب أن يحتوي الطلب على صنف واحد فقط للاستلام");
    const line = lines[0]!;
    if (!line.productId || Number(line.quantity) <= 0) throw new ValidationError("الطلب لا يحتوي على صنف صالح للمخزون");
    const productCode = line.sku?.trim() || `PRODUCT-${line.productId}`;
    const [stock] = await select<{ id: number; quantity: number }>(
      `SELECT id, quantity FROM "shipmentInventoryItems"
       WHERE "productId" = :productId AND "productCode" = :productCode AND "deletedAt" IS NULL
       ORDER BY id LIMIT 1 FOR UPDATE`,
      { productId: line.productId, productCode }, transaction
    );
    let inventoryItemId: number;
    if (stock) {
      inventoryItemId = stock.id;
      await sequelize.query(`UPDATE "shipmentInventoryItems" SET quantity = quantity + :quantity, status = 1, "updatedAt" = NOW() WHERE id = :id`, {
        replacements: { id: stock.id, quantity: line.quantity }, transaction,
      });
    } else {
      const [created] = await select<{ id: number }>(
        `INSERT INTO "shipmentInventoryItems" ("productId", "productCode", quantity, "costPrice", status, "createdAt", "updatedAt")
         VALUES (:productId, :productCode, :quantity, :costPrice, 1, NOW(), NOW()) RETURNING id`,
        { productId: line.productId, productCode, quantity: line.quantity, costPrice: Number(line.cost) / Number(line.quantity) || 0 }, transaction
      );
      inventoryItemId = created!.id;
    }
    await sequelize.query(`INSERT INTO warehouse_receipt_movements
      ("orderId", "inventoryItemId", quantity, "previousStatus", "previousShipmentStatus", "previousDeliveryBy", "previousShippedFromInventory", "previousShippingReceiveDate")
      VALUES (:orderId, :inventoryItemId, :quantity, :previousStatus, :previousShipmentStatus, :previousDeliveryBy, :previousShippedFromInventory, :previousShippingReceiveDate)`, {
      replacements: {
        orderId: order.id, inventoryItemId, quantity: line.quantity,
        previousStatus: order.status ?? null,
        previousShipmentStatus: order.shipmentStatus ?? null,
        previousDeliveryBy: order.deliveryBy ?? null,
        previousShippedFromInventory: order.shippedFromInventory ?? null,
        previousShippingReceiveDate: order.shippingReceiveDate ?? null,
      }, transaction,
    });
  }

  /** Every non-deleted factory with a name, for the receipts filter dropdowns (vendorId matches `p."vendorId"`). */
  async receivedVendors() {
    return select<{ id: number; name: string }>(
      `SELECT v.id, v.name FROM vendors v
      WHERE v."deletedAt" IS NULL AND COALESCE(v.name, '') <> ''
      ORDER BY v.name, v.id`,
      {}
    );
  }

  async candidates(filters: z.infer<typeof receivingCandidatesSchema>) {
    const replacements: Record<string, unknown> = {
      search: contains(filters.search ?? ""),
      offset: (filters.page - 1) * 20,
    };
    const clauses = [
      candidateWhere,
      `(o.code ILIKE :search OR o."orderNumber" ILIKE :search
      OR l.sku ILIKE :search OR l.title ILIKE :search OR v.name ILIKE :search)`,
    ];
    const like = (value: string | undefined, key: string, column: string) => {
      if (!value) return;
      replacements[key] = contains(value);
      clauses.push(`${column} ILIKE :${key}`);
    };
    like(filters.sku, "sku", "l.sku");
    like(filters.operationNumber, "operationNumber", "o.code");
    like(filters.orderNumber, "orderNumber", `o."orderNumber"`);
    if (filters.vendorId) {
      replacements.vendorId = filters.vendorId;
      clauses.push(`p."vendorId" = :vendorId`);
    }
    const where = clauses.join(" AND ");
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

  private receivedWhere(
    filters: Omit<z.infer<typeof receivingReceivedFilterSchema>, "page">
  ) {
    const replacements: Record<string, unknown> = {
      search: contains(filters.search ?? ""),
    };
    const clauses = [
      `o."deletedAt" IS NULL AND o."warehouseReceivedBy" IS NOT NULL`,
      `(o.code ILIKE :search OR o."orderNumber" ILIKE :search
      OR l.sku ILIKE :search OR l.title ILIKE :search OR v.name ILIKE :search)`,
    ];
    const like = (value: string | undefined, key: string, column: string) => {
      if (!value) return;
      replacements[key] = contains(value);
      clauses.push(`${column} ILIKE :${key}`);
    };
    like(filters.sku, "sku", "l.sku");
    like(filters.operationNumber, "operationNumber", "o.code");
    like(filters.orderNumber, "orderNumber", `o."orderNumber"`);
    if (filters.vendorId) {
      replacements.vendorId = filters.vendorId;
      clauses.push(`p."vendorId" = :vendorId`);
    }
    like(filters.documentNumber, "documentNumber", `o."warehouseReceiptNumber"`);
    if (filters.documentState === "issued") clauses.push(`o."warehouseReceiptNumber" IS NOT NULL`);
    if (filters.documentState === "none") clauses.push(`o."warehouseReceiptNumber" IS NULL`);
    /* Days are Cairo calendar days, like the shipments filters. shippingReceiveDate
       is stored as Cairo midnight (the previous day 21:00/22:00Z), so comparing
       ::date in the UTC session shifted every receipt one day back. */
    if (filters.date) {
      replacements.dateStart = toDateRangeBoundary(filters.date, "start");
      replacements.dateEnd = toDateRangeBoundary(filters.date, "end");
      clauses.push(`o."shippingReceiveDate" >= :dateStart AND o."shippingReceiveDate" <= :dateEnd`);
    }
    if (filters.dateFrom) {
      replacements.dateFrom = toDateRangeBoundary(filters.dateFrom, "start");
      clauses.push(`o."shippingReceiveDate" >= :dateFrom`);
    }
    if (filters.dateTo) {
      replacements.dateTo = toDateRangeBoundary(filters.dateTo, "end");
      clauses.push(`o."shippingReceiveDate" <= :dateTo`);
    }
    return { where: clauses.join(" AND "), replacements };
  }

  async list(filters: z.infer<typeof receivingReceivedFilterSchema>) {
    const { where, replacements } = this.receivedWhere(filters);
    const rows = await select<ReceivedItem>(
      `SELECT ${receivedColumns} ${receivedFrom} WHERE ${where}
      ORDER BY o."shippingReceiveDate" DESC, o.id DESC
      LIMIT 20 OFFSET :offset`,
      { ...replacements, offset: (filters.page - 1) * 20 }
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

  /** Every received row matching the filters (same WHERE as list), capped. */
  async exportRows(filters: z.infer<typeof receivingExportSchema>) {
    const { where, replacements } = this.receivedWhere(filters);
    const rows = await select<ReceivedItem>(
      `SELECT ${receivedColumns} ${receivedFrom} WHERE ${where}
      ORDER BY o."shippingReceiveDate" DESC, o.id DESC
      LIMIT 50000`,
      replacements
    );
    return rows.map(withManufactureDays);
  }

  async exportWorkbook(
    response: { setHeader(k: string, v: string): unknown; end(): unknown },
    filters: z.infer<typeof receivingExportSchema>
  ) {
    const rows = await this.exportRows(filters);
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", "attachment; filename=receipts.xlsx");
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: response });
    const sheet = workbook.addWorksheet("receipts");
    sheet.columns = [
      { header: "رقم العملية", key: "operationNumber", width: 18 },
      { header: "رقم الطلب", key: "orderNumber", width: 18 },
      { header: "كود المنتج (SKU)", key: "productSku", width: 20 },
      { header: "المنتج", key: "productName", width: 36 },
      { header: "المصنع", key: "vendorName", width: 24 },
      { header: "الكمية", key: "quantity", width: 10 },
      { header: "تاريخ التصنيع", key: "manufactureDate", width: 16 },
      { header: "تاريخ الاستلام", key: "receivedDate", width: 16 },
      { header: "أيام التصنيع", key: "manufactureDays", width: 14 },
      { header: "المستلم", key: "receiverName", width: 22 },
      { header: "المُرسِل", key: "senderName", width: 22 },
      { header: "رقم السند", key: "documentNumber", width: 18 },
      { header: "ملاحظات", key: "notes", width: 30 },
    ];
    rows.forEach((row) => sheet.addRow(row));
    sheet.commit();
    await workbook.commit();
    response.end();
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
        await this.addReceiptStock(order, transaction);
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
        /* Receipt sets order + shipment status explicitly; the shared sync adds the
           confirmation column if the new order status implies one. */
        const statusSync = deriveStatusPatch(order, changes);
        Object.assign(changes, statusSync.patch);
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
        await Log.bulkCreate(
          buildAutoSyncLogRows(orderId, statusSync.derived, userId).filter((row) => row.action !== "update"),
          { transaction }
        );
        await order.update(changes, { transaction });
      }
      return { orderIds: input.orderIds, receiverName: user.name };
    });
  }

  /** Edits receipt notes and/or the manufacture date (orders."PoDate") of a received item. */
  async updateReceipt(
    orderId: number, input: z.infer<typeof receivingUpdateSchema>, userId: number,
  ): Promise<{ orderId: number; warehouseReceiptNotes?: string | null; PoDate?: string | null }> {
    return sequelize.transaction(async (transaction) => {
      const [order] = await select<{
        id: number; PoDate: string | null; shippingReceiveDate: string | null; warehouseReceiptNotes: string | null;
      }>(
        `SELECT id, "PoDate", "shippingReceiveDate", "warehouseReceiptNotes" FROM orders
        WHERE id = :orderId AND "deletedAt" IS NULL AND "warehouseReceivedBy" IS NOT NULL FOR UPDATE`,
        { orderId }, transaction
      );
      if (!order) throw new NotFoundError("الصنف غير مستلم أو غير موجود");
      const changes: Record<string, string | null> = {};
      if (input.notes !== undefined) changes.warehouseReceiptNotes = input.notes;
      if (input.manufactureDate !== undefined) {
        if (input.manufactureDate && order.shippingReceiveDate) {
          const received = moment(order.shippingReceiveDate).tz("Africa/Cairo").format("YYYY-MM-DD");
          if (input.manufactureDate > received) throw new ValidationError("تاريخ التصنيع بعد تاريخ الاستلام");
        }
        changes.PoDate = input.manufactureDate
          ? moment.tz(input.manufactureDate, "YYYY-MM-DD", "Africa/Cairo").toISOString()
          : null;
      }
      const Log = require("../../../app/modules/logs/log.model");
      const previous: Record<string, unknown> = { warehouseReceiptNotes: order.warehouseReceiptNotes, PoDate: order.PoDate };
      await Log.bulkCreate(
        Object.entries(changes)
          .filter(([field, value]) => String(previous[field] ?? "") !== String(value ?? ""))
          .map(([field, value]) => ({
            entityId: orderId, entityType: "order", action: "update", field,
            from: String(previous[field] ?? ""), to: String(value ?? ""), userId,
          })),
        { transaction }
      );
      const sets = Object.keys(changes).map((field) => `"${field}" = :${field}`).join(", ");
      await sequelize.query(`UPDATE orders SET ${sets}, "updatedAt" = NOW() WHERE id = :orderId`, {
        replacements: { ...changes, orderId }, transaction,
      });
      return { orderId, ...changes } as { orderId: number; warehouseReceiptNotes?: string | null; PoDate?: string | null };
    });
  }

  async cancel(orderId: number, userId: number) {
    return sequelize.transaction(async (transaction) => {
      const [order] = await select<{ id: number; status: number; shipmentStatus: number; warehouseReceivedBy: number | null }>(
        'SELECT id, status, "shipmentStatus", "warehouseReceivedBy" FROM orders WHERE id = :orderId FOR UPDATE',
        { orderId }, transaction,
      );
      if (!order) throw new NotFoundError("الطلب غير موجود");
      if (!order.warehouseReceivedBy || Number(order.status) !== ORDER_STATUS.IN_INVENTORY || Number(order.shipmentStatus) !== SHIPMENTS_STATUS.IN_WAREHOUSE) {
        throw new ConflictError("حالة الطلب تغيرت بعد الاستلام؛ راجع الطلب قبل إلغاء الاستلام");
      }
      const [movement] = await select<{
        id: number; inventoryItemId: number; quantity: number;
        previousStatus: number | null; previousShipmentStatus: number | null;
        previousDeliveryBy: number | null; previousShippedFromInventory: boolean | null;
        previousShippingReceiveDate: string | null;
      }>(`SELECT * FROM warehouse_receipt_movements WHERE "orderId" = :orderId AND "cancelledAt" IS NULL FOR UPDATE`, { orderId }, transaction);
      if (!movement) throw new ConflictError("استلام قديم بلا حالة سابقة محفوظة؛ يحتاج مراجعة يدوية");
      const [stock] = await select<{ quantity: number }>(`SELECT quantity FROM "shipmentInventoryItems" WHERE id = :id AND "deletedAt" IS NULL FOR UPDATE`, { id: movement.inventoryItemId }, transaction);
      if (!stock || Number(stock.quantity) < Number(movement.quantity)) throw new ConflictError("الكمية المتاحة أقل من كمية الاستلام؛ راجع حركة المخزون أولًا");
      await sequelize.query(`UPDATE "shipmentInventoryItems" SET quantity = quantity - :quantity,
        status = CASE WHEN quantity - :quantity > 0 THEN 1 ELSE 2 END, "updatedAt" = NOW() WHERE id = :id`, {
        replacements: { id: movement.inventoryItemId, quantity: movement.quantity }, transaction,
      });
      await sequelize.query(`UPDATE orders SET status = :status, "shipmentStatus" = :shipmentStatus,
        "deliveryBy" = :deliveryBy, "shippedFromInventory" = :shippedFromInventory,
        "shippingReceiveDate" = :shippingReceiveDate, "warehouseReceivedBy" = NULL,
        "warehouseSenderName" = NULL, "warehouseReceiptNotes" = NULL,
        "warehouseReceiptNumber" = NULL, "warehouseReceiptIssuedAt" = NULL, "updatedAt" = NOW()
        WHERE id = :orderId`, { replacements: {
          orderId, status: movement.previousStatus, shipmentStatus: movement.previousShipmentStatus,
          deliveryBy: movement.previousDeliveryBy, shippedFromInventory: movement.previousShippedFromInventory,
          shippingReceiveDate: movement.previousShippingReceiveDate,
        }, transaction });
      await sequelize.query(`UPDATE warehouse_receipt_movements SET "cancelledAt" = NOW() WHERE id = :id`, { replacements: { id: movement.id }, transaction });
      const Log = require("../../../app/modules/logs/log.model");
      await Log.create({ entityId: orderId, entityType: "order", action: "cancel_receipt", field: "warehouseReceivedBy", from: String(userId), to: "", userId }, { transaction });
      return { orderId };
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
