import { Op, QueryTypes, type Transaction } from "sequelize";

import { logger } from "../../shared/logger";
import { sequelize } from "../../infrastructure/database";
import type {
  FinanceAutomaticMetrics,
  DashboardLeaderboardEntry,
  DashboardMetricSnapshot,
  DashboardMetricsInput,
  DashboardPerformancePoint,
  DashboardSalesDistributionItem,
} from "./dashboard.types";

type AggregateRecord = {
  activeMakers: number;
  activeProducts: number;
  canceledOrRefundedOrders: number;
  deliveredOrders: number;
  inProgressOrders: number;
  metricDate: string;
  pendingOrders: number;
  role: "admin" | "vendor";
  scopeId: number;
  totalOrders: number;
  totalSales: number;
  vendorId?: number | null;
};

type DashboardAggregateSource = {
  getDeliveredOrdersCountFromOrders: (input: DashboardMetricsInput) => Promise<number>;
  getSnapshotFromOrders: (input: DashboardMetricsInput) => Promise<DashboardMetricSnapshot>;
};

type DashboardDailyMetricModel = {
  bulkCreate: (payloads: AggregateRecord[], options?: Record<string, unknown>) => Promise<unknown>;
  destroy: (options?: Record<string, unknown>) => Promise<number>;
  findAll: <TRow = AggregateRecord>(options?: Record<string, unknown>) => Promise<TRow[]>;
  sync: (options?: Record<string, unknown>) => Promise<unknown>;
  upsert: (payload: AggregateRecord) => Promise<unknown>;
};

type DashboardDailyProductSaleModel = {
  bulkCreate: (payloads: ProductAggregateRecord[], options?: Record<string, unknown>) => Promise<unknown>;
  destroy: (options?: Record<string, unknown>) => Promise<number>;
  sync: (options?: Record<string, unknown>) => Promise<unknown>;
};

type DashboardDailyCategorySaleModel = {
  bulkCreate: (payloads: CategoryAggregateRecord[], options?: Record<string, unknown>) => Promise<unknown>;
  destroy: (options?: Record<string, unknown>) => Promise<number>;
  sync: (options?: Record<string, unknown>) => Promise<unknown>;
};

type FinanceDailyMetricModel = {
  bulkCreate: (payloads: FinanceAggregateRecord[], options?: Record<string, unknown>) => Promise<unknown>;
  destroy: (options?: Record<string, unknown>) => Promise<number>;
  findAll: <TRow = FinanceAggregateRecord>(options?: Record<string, unknown>) => Promise<TRow[]>;
  sync: (options?: Record<string, unknown>) => Promise<unknown>;
};

type FinanceAggregateRecord = FinanceAutomaticMetrics & {
  metricDate: string;
  orderCount: number;
  sourceUpdatedAt: string | Date | null;
};

type OrderRecord = {
  orderDate?: string | Date | null;
  toJSON?: () => { orderDate?: string | Date | null };
};

type OrderModel = {
  findAll: <TRow = OrderRecord>(options?: Record<string, unknown>) => Promise<TRow[]>;
};

type DailyAdminRow = {
  activeMakers: number | string | null;
  deliveredOrders: number | string | null;
  metricDate: string;
  pendingOrders: number | string | null;
  totalOrders: number | string | null;
  totalSales: number | string | null;
};

type DailyVendorRow = {
  activeProducts: number | string | null;
  deliveredOrders: number | string | null;
  metricDate: string;
  pendingOrders: number | string | null;
  totalOrders: number | string | null;
  totalSales: number | string | null;
  vendorId: number | string;
};

type ProductAggregateRecord = {
  metricDate: string;
  productId: number;
  productTitle: string;
  totalOrders: number;
  totalQuantity: number;
  totalSales: number;
  vendorId: number;
};

type CategoryAggregateRecord = {
  categoryId: number;
  categoryTitle: string;
  metricDate: string;
  role: "admin" | "vendor";
  scopeId: number;
  totalOrders: number;
  totalQuantity: number;
  totalSales: number;
  vendorId?: number | null;
};

type LeaderboardAggregateRow = {
  id: number | string | null;
  name: string;
  secondaryLabel: string;
  totalSales: number | string | null;
};

type DistributionAggregateRow = {
  label: string;
  totalSales: number | string | null;
};

const dashboardDailyMetricModel = require("./dashboard-daily-metric.model") as DashboardDailyMetricModel;
const dashboardDailyProductSaleModel = require("./dashboard-daily-product-sale.model") as DashboardDailyProductSaleModel;
const dashboardDailyCategorySaleModel = require("./dashboard-daily-category-sale.model") as DashboardDailyCategorySaleModel;
const financeDailyMetricModel = require("./finance-daily-metric.model") as FinanceDailyMetricModel;
const orderModel = require("../../../app/modules/order/order.model") as OrderModel;

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const AGGREGATE_LOG_OPERATION = "dashboard-aggregate";
const AGGREGATE_ADVISORY_LOCK_NAMESPACE = 1_104_202_026;
const BULK_UPDATE_FIELDS = [
  "activeMakers",
  "activeProducts",
  "canceledOrRefundedOrders",
  "deliveredOrders",
  "inProgressOrders",
  "pendingOrders",
  "totalOrders",
  "totalSales",
  "vendorId",
] as const;
const BULK_PRODUCT_UPDATE_FIELDS = [
  "productTitle",
  "totalOrders",
  "totalQuantity",
  "totalSales",
] as const;
const BULK_CATEGORY_UPDATE_FIELDS = [
  "categoryTitle",
  "totalOrders",
  "totalQuantity",
  "totalSales",
  "vendorId",
] as const;
const BULK_FINANCE_UPDATE_FIELDS = [
  "cancellations",
  "cogsG2n",
  "cogsGmv",
  "cogsNmv",
  "deliveredHomix",
  "deliveredVendor",
  "discounts",
  "gmvOnline",
  "gmvShowroom",
  "orderCount",
  "sourceUpdatedAt",
] as const;
const OPEN_STATUS_SQL = "1,2,3";
const PENDING_STATUS_SQL = "1";
const IN_PROGRESS_STATUS_SQL = "2";
const DELIVERED_STATUS_SQL = "5";
const CANCELED_STATUS_SQL = "4";
const DELIVERY_BY_HOMIX_SQL = "1";
const DELIVERY_BY_VENDOR_SQL = "2";
const ORDER_SOURCE_SHOWROOM_SQL = "1";
const ORDER_SOURCE_ONLINE_SQL = "2";
const CANCELED_OR_REFUNDED_STATUS_SQL = "4,6,7";
const UNCATEGORIZED_CATEGORY_ID = 0;
const UNCATEGORIZED_CATEGORY_TITLE = "أخرى";
const MAX_LEADERBOARD_ITEMS = 10;

const toPlain = <TRow extends { toJSON?: () => TRow }>(row: TRow): TRow => {
  return typeof row.toJSON === "function" ? row.toJSON() : row;
};

const toDateOnly = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

const normalizeBoundary = (value: string | Date): Date => {
  return value instanceof Date ? new Date(value) : new Date(value);
};

const getDateRange = (startDate: Date, endDate: Date): Date[] => {
  const dates: Date[] = [];
  for (let cursor = new Date(startDate); cursor <= endDate; cursor = new Date(cursor.getTime() + DAY_IN_MILLISECONDS)) {
    dates.push(new Date(cursor));
  }

  return dates;
};

const getMonthLockKeys = (startDate: Date, endDate: Date): number[] => {
  const keys: number[] = [];
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const lastMonth = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1);

  while (cursor.getTime() <= lastMonth) {
    keys.push(cursor.getUTCFullYear() * 100 + cursor.getUTCMonth() + 1);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return keys;
};

const getExpectedRowCount = (input: DashboardMetricsInput): number => {
  return getDateRange(normalizeBoundary(input.startDate), normalizeBoundary(input.endDate)).length;
};

const getScopeId = (input: DashboardMetricsInput): number => {
  return input.role === "vendor" ? input.vendorId ?? 0 : 0;
};

const toAggregateRecord = (
  metricDate: string,
  input: DashboardMetricsInput,
  snapshot: DashboardMetricSnapshot,
  deliveredOrders: number,
): AggregateRecord => ({
  activeMakers: snapshot.activeMakers,
  activeProducts: snapshot.activeProducts,
  deliveredOrders,
  canceledOrRefundedOrders: 0,
  inProgressOrders: 0,
  metricDate,
  pendingOrders: snapshot.pendingOrders,
  role: input.role,
  scopeId: getScopeId(input),
  totalOrders: snapshot.totalOrders,
  totalSales: snapshot.totalSales,
  vendorId: input.vendorId ?? null,
});

export type OrderSummaryAggregate = {
  canceledOrRefundedOrders: number;
  deliveredOrders: number;
  inProgressOrders: number;
  pendingOrders: number;
  totalOrders: number;
};

export class DashboardAggregateService {
  public constructor(private readonly dashboardSource: DashboardAggregateSource) {}

  public async ensureTable(): Promise<void> {
    await Promise.all([
      dashboardDailyMetricModel.sync(),
      dashboardDailyProductSaleModel.sync(),
      dashboardDailyCategorySaleModel.sync(),
      financeDailyMetricModel.sync(),
    ]);
  }

  public async getFinanceMetrics(startDate: string, endDate: string): Promise<FinanceAutomaticMetrics | null> {
    let rows = await financeDailyMetricModel.findAll<FinanceAggregateRecord>({
      where: { metricDate: { between: [startDate.slice(0, 10), endDate.slice(0, 10)] } },
    });

    const [source] = await sequelize.query<{ orderCount: number | string; sourceUpdatedAt: Date | string | null }>(
      `
        SELECT COUNT(*)::int AS "orderCount", MAX("updatedAt") AS "sourceUpdatedAt"
        FROM "orders"
        WHERE "deletedAt" IS NULL
          AND "orderDate" >= :startDate
          AND "orderDate" < :exclusiveEndDate
      `,
      {
        replacements: {
          exclusiveEndDate: this.getExclusiveEndDate(new Date(endDate)),
          startDate: new Date(startDate),
        },
        type: QueryTypes.SELECT,
      },
    );
    const aggregateOrderCount = rows.reduce((sum, row) => sum + Number(row.orderCount ?? 0), 0);
    const aggregateSourceUpdatedAt = rows.reduce<number>((latest, row) => {
      const timestamp = row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt).getTime() : 0;
      return Math.max(latest, Number.isNaN(timestamp) ? 0 : timestamp);
    }, 0);
    const sourceUpdatedAt = source?.sourceUpdatedAt ? new Date(source.sourceUpdatedAt).getTime() : 0;
    const isFresh = aggregateOrderCount === Number(source?.orderCount ?? 0)
      && aggregateSourceUpdatedAt === (Number.isNaN(sourceUpdatedAt) ? 0 : sourceUpdatedAt);

    if (!isFresh) {
      await this.refreshRange(startDate, endDate);
      rows = await financeDailyMetricModel.findAll<FinanceAggregateRecord>({
        where: { metricDate: { between: [startDate.slice(0, 10), endDate.slice(0, 10)] } },
      });
    }

    if (rows.length === 0) {
      return Number(source?.orderCount ?? 0) === 0
        ? {
            cancellations: 0, cogsG2n: 0, cogsGmv: 0, cogsNmv: 0,
            deliveredHomix: 0, deliveredVendor: 0, discounts: 0,
            gmvOnline: 0, gmvShowroom: 0,
          }
        : null;
    }

    return rows.reduce<FinanceAutomaticMetrics>(
      (summary, row) => ({
        cancellations: summary.cancellations + Number(row.cancellations ?? 0),
        cogsG2n: summary.cogsG2n + Number(row.cogsG2n ?? 0),
        cogsGmv: summary.cogsGmv + Number(row.cogsGmv ?? 0),
        cogsNmv: summary.cogsNmv + Number(row.cogsNmv ?? 0),
        deliveredHomix: summary.deliveredHomix + Number(row.deliveredHomix ?? 0),
        deliveredVendor: summary.deliveredVendor + Number(row.deliveredVendor ?? 0),
        discounts: summary.discounts + Number(row.discounts ?? 0),
        gmvOnline: summary.gmvOnline + Number(row.gmvOnline ?? 0),
        gmvShowroom: summary.gmvShowroom + Number(row.gmvShowroom ?? 0),
      }),
      {
        cancellations: 0,
        cogsG2n: 0,
        cogsGmv: 0,
        cogsNmv: 0,
        deliveredHomix: 0,
        deliveredVendor: 0,
        discounts: 0,
        gmvOnline: 0,
        gmvShowroom: 0,
      },
    );
  }

  public async getSnapshot(
    input: DashboardMetricsInput,
  ): Promise<DashboardMetricSnapshot | null> {
    const rows = await dashboardDailyMetricModel.findAll<AggregateRecord>({
      where: {
        metricDate: {
          between: [input.startDate.slice(0, 10), input.endDate.slice(0, 10)],
        },
        role: input.role,
        scopeId: getScopeId(input),
      },
    });

    if (rows.length !== getExpectedRowCount(input)) {
      return null;
    }

    return rows.reduce<DashboardMetricSnapshot>(
      (summary, row) => ({
        activeMakers: summary.activeMakers + Number(row.activeMakers ?? 0),
        activeProducts: summary.activeProducts + Number(row.activeProducts ?? 0),
        pendingOrders: summary.pendingOrders + Number(row.pendingOrders ?? 0),
        totalOrders: summary.totalOrders + Number(row.totalOrders ?? 0),
        totalSales: summary.totalSales + Number(row.totalSales ?? 0),
      }),
      {
        activeMakers: 0,
        activeProducts: 0,
        pendingOrders: 0,
        totalOrders: 0,
        totalSales: 0,
      },
    );
  }

  public async getPerformanceSeries(
    input: DashboardMetricsInput,
  ): Promise<DashboardPerformancePoint[] | null> {
    const rows = await dashboardDailyMetricModel.findAll<AggregateRecord>({
      order: [["metricDate", "ASC"]],
      where: {
        metricDate: {
          between: [input.startDate.slice(0, 10), input.endDate.slice(0, 10)],
        },
        role: input.role,
        scopeId: getScopeId(input),
      },
    });

    if (rows.length !== getExpectedRowCount(input)) {
      return null;
    }

    return rows.map((row) => ({
      date: row.metricDate,
      orders: Number(row.totalOrders ?? 0),
      sales: Number(row.totalSales ?? 0),
    }));
  }

  public async getDeliveredOrdersCount(input: DashboardMetricsInput): Promise<number | null> {
    const rows = await dashboardDailyMetricModel.findAll<AggregateRecord>({
      where: {
        metricDate: {
          between: [input.startDate.slice(0, 10), input.endDate.slice(0, 10)],
        },
        role: input.role,
        scopeId: getScopeId(input),
      },
    });

    if (rows.length !== getExpectedRowCount(input)) {
      return null;
    }

    return rows.reduce((sum, row) => sum + Number(row.deliveredOrders ?? 0), 0);
  }

  public async getLeaderboard(
    input: DashboardMetricsInput,
  ): Promise<DashboardLeaderboardEntry[] | null> {
    if (!(await this.hasCoverage(input))) {
      return null;
    }

    const rows = input.role === "vendor" && input.vendorId
      ? await this.getVendorLeaderboardRows(input)
      : await this.getAdminLeaderboardRows(input);

    return rows.map((row, index) => ({
      id: row.id === null ? null : Number(row.id),
      name: row.name,
      rank: index + 1,
      secondaryLabel: row.secondaryLabel,
      totalSales: Number(row.totalSales ?? 0),
    }));
  }

  public async getSalesDistribution(
    input: DashboardMetricsInput,
  ): Promise<Array<{ label: string; value: number }> | null> {
    if (!(await this.hasCoverage(input))) {
      return null;
    }

    const rows = await sequelize.query<DistributionAggregateRow>(
      `
        SELECT
          "categoryTitle" AS "label",
          SUM("totalSales")::numeric AS "totalSales"
        FROM "dashboardDailyCategorySales"
        WHERE "metricDate" BETWEEN :startDate AND :endDate
          AND "role" = :role
          AND "scopeId" = :scopeId
        GROUP BY "categoryTitle"
        ORDER BY SUM("totalSales") DESC, "categoryTitle" ASC
      `,
      {
        replacements: {
          endDate: input.endDate.slice(0, 10),
          role: input.role,
          scopeId: getScopeId(input),
          startDate: input.startDate.slice(0, 10),
        },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row) => ({
      label: row.label,
      value: Number(row.totalSales ?? 0),
    }));
  }

  public async backfill(startDate?: string, endDate?: string): Promise<void> {
    await this.ensureTable();
    const bounds = await this.getBackfillBounds(startDate, endDate);
    if (!bounds) {
      logger.info({ operationName: AGGREGATE_LOG_OPERATION }, "No order history found for aggregate backfill");
      return;
    }

    await sequelize.transaction(async (transaction) => {
      /* All workers share this PostgreSQL transaction lock. It prevents two
         webhook/read-repair refreshes from deleting and replacing the same
         aggregate range concurrently, while the transaction ensures readers
         see either the complete old snapshot or the complete new snapshot. */
      for (const monthKey of getMonthLockKeys(bounds.startDate, bounds.endDate)) {
        await sequelize.query("SELECT pg_advisory_xact_lock(:namespace, :monthKey)", {
          replacements: { monthKey, namespace: AGGREGATE_ADVISORY_LOCK_NAMESPACE },
          transaction,
          type: QueryTypes.SELECT,
        });
      }

      const [adminRows, vendorRows, productRows, categoryRows, financeRows] = await Promise.all([
        this.getAdminAggregateRows(bounds.startDate, bounds.endDate, transaction),
        this.getVendorAggregateRows(bounds.startDate, bounds.endDate, transaction),
        this.getProductAggregateRows(bounds.startDate, bounds.endDate, transaction),
        this.getCategoryAggregateRows(bounds.startDate, bounds.endDate, transaction),
        this.getFinanceAggregateRows(bounds.startDate, bounds.endDate, transaction),
      ]);
      const dedupedProductRows = this.dedupeProductAggregateRows(productRows);
      const dedupedCategoryRows = this.dedupeCategoryAggregateRows(categoryRows);

      const destroyRange = {
        transaction,
        where: {
          metricDate: {
            between: [toDateOnly(bounds.startDate), toDateOnly(bounds.endDate)],
          },
        },
      };

      await Promise.all([
        dashboardDailyMetricModel.destroy(destroyRange),
        dashboardDailyProductSaleModel.destroy(destroyRange),
        dashboardDailyCategorySaleModel.destroy(destroyRange),
        financeDailyMetricModel.destroy(destroyRange),
      ]);

      const aggregateRows = [...adminRows, ...vendorRows];
      if (aggregateRows.length === 0 && dedupedProductRows.length === 0 && dedupedCategoryRows.length === 0 && financeRows.length === 0) {
        logger.info(
          { operationName: AGGREGATE_LOG_OPERATION, startDate: bounds.startDate, endDate: bounds.endDate },
          "No aggregate rows generated for requested range",
        );
        return;
      }

      await Promise.all([
        aggregateRows.length > 0
          ? dashboardDailyMetricModel.bulkCreate(aggregateRows, {
              transaction,
              updateOnDuplicate: [...BULK_UPDATE_FIELDS],
            })
          : Promise.resolve(),
        dedupedProductRows.length > 0
          ? this.upsertProductRows(dedupedProductRows, transaction)
          : Promise.resolve(),
        dedupedCategoryRows.length > 0
          ? this.upsertCategoryRows(dedupedCategoryRows, transaction)
          : Promise.resolve(),
        financeRows.length > 0
          ? financeDailyMetricModel.bulkCreate(financeRows, {
              transaction,
              updateOnDuplicate: [...BULK_FINANCE_UPDATE_FIELDS],
            })
          : Promise.resolve(),
      ]);
    });
  }

  public async refreshRange(startDate: string, endDate: string): Promise<void> {
    await this.backfill(startDate, endDate);
  }

  private async getBackfillBounds(
    startDate?: string,
    endDate?: string,
  ): Promise<{ endDate: Date; startDate: Date } | null> {
    /* Explicit refreshes must keep their exact bounds, even when the mutation
       deleted/moved the only order on an edge date. Clamping to the remaining
       order history would leave the old daily row behind indefinitely. */
    if (startDate && endDate) {
      const normalizedStartDate = normalizeBoundary(startDate);
      const normalizedEndDate = normalizeBoundary(endDate);
      if (
        Number.isNaN(normalizedStartDate.getTime())
        || Number.isNaN(normalizedEndDate.getTime())
        || normalizedStartDate > normalizedEndDate
      ) {
        return null;
      }
      return { endDate: normalizedEndDate, startDate: normalizedStartDate };
    }

    const [firstOrder] = await orderModel.findAll<OrderRecord>({
      attributes: ["orderDate"],
      limit: 1,
      order: [["orderDate", "ASC"]],
      where: {
        orderDate: { [Op.ne]: null },
      },
    });
    const [lastOrder] = await orderModel.findAll<OrderRecord>({
      attributes: ["orderDate"],
      limit: 1,
      order: [["orderDate", "DESC"]],
      where: {
        orderDate: { [Op.ne]: null },
      },
    });

    const firstDate = firstOrder ? toPlain(firstOrder).orderDate : null;
    const lastDate = lastOrder ? toPlain(lastOrder).orderDate : null;

    if (!firstDate || !lastDate) {
      return null;
    }

    const firstOrderDate = normalizeBoundary(firstDate);
    const lastOrderDate = normalizeBoundary(lastDate);

    return {
      endDate: lastOrderDate,
      startDate: firstOrderDate,
    };
  }

  private async getAdminAggregateRows(startDate: Date, endDate: Date, transaction?: Transaction): Promise<AggregateRecord[]> {
    const rows = await sequelize.query<DailyAdminRow>(
      `
        WITH daily_orders AS (
          SELECT
            DATE("orderDate")::text AS "metricDate",
            COUNT(*)::int AS "totalOrders",
            COUNT(*) FILTER (WHERE "status" IN (${PENDING_STATUS_SQL}))::int AS "pendingOrders",
            COUNT(*) FILTER (WHERE "status" IN (${IN_PROGRESS_STATUS_SQL}))::int AS "inProgressOrders",
            COUNT(*) FILTER (WHERE "status" IN (${DELIVERED_STATUS_SQL}))::int AS "deliveredOrders",
            COUNT(*) FILTER (WHERE "status" IN (${CANCELED_OR_REFUNDED_STATUS_SQL}))::int AS "canceledOrRefundedOrders",
            COALESCE(SUM("totalPrice"), 0)::numeric AS "totalSales"
          FROM "orders"
          WHERE "deletedAt" IS NULL
            AND "orderDate" >= :startDate
            AND "orderDate" < :exclusiveEndDate
          GROUP BY DATE("orderDate")
        ),
        daily_makers AS (
          SELECT
            DATE(o."orderDate")::text AS "metricDate",
            COUNT(DISTINCT p."vendorId")::int AS "activeMakers"
          FROM "orderLines" ol
          INNER JOIN "orders" o ON o."id" = ol."orderId" AND o."deletedAt" IS NULL
          INNER JOIN "products" p ON p."id" = ol."productId" AND p."deletedAt" IS NULL
          WHERE ol."deletedAt" IS NULL
            AND p."vendorId" IS NOT NULL
            AND o."orderDate" >= :startDate
            AND o."orderDate" < :exclusiveEndDate
          GROUP BY DATE(o."orderDate")
        )
        SELECT
          d."metricDate",
          d."totalOrders",
          d."pendingOrders",
          d."inProgressOrders",
          d."deliveredOrders",
          d."canceledOrRefundedOrders",
          d."totalSales",
          COALESCE(m."activeMakers", 0)::int AS "activeMakers"
        FROM daily_orders d
        LEFT JOIN daily_makers m ON m."metricDate" = d."metricDate"
        ORDER BY d."metricDate" ASC
      `,
      {
        replacements: {
          exclusiveEndDate: this.getExclusiveEndDate(endDate),
          startDate,
        },
        transaction,
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row: DailyAdminRow) => ({
      activeMakers: Number(row.activeMakers ?? 0),
      activeProducts: 0,
      canceledOrRefundedOrders: Number((row as DailyAdminRow & { canceledOrRefundedOrders?: number | string | null }).canceledOrRefundedOrders ?? 0),
      deliveredOrders: Number(row.deliveredOrders ?? 0),
      inProgressOrders: Number((row as DailyAdminRow & { inProgressOrders?: number | string | null }).inProgressOrders ?? 0),
      metricDate: row.metricDate,
      pendingOrders: Number(row.pendingOrders ?? 0),
      role: "admin",
      scopeId: 0,
      totalOrders: Number(row.totalOrders ?? 0),
      totalSales: Number(row.totalSales ?? 0),
      vendorId: null,
    }));
  }

  private async getFinanceAggregateRows(startDate: Date, endDate: Date, transaction?: Transaction): Promise<FinanceAggregateRecord[]> {
    const rows = await sequelize.query<FinanceAggregateRecord>(
      `
        WITH order_finance AS (
          SELECT
            DATE("orderDate")::text AS "metricDate",
            "status",
            "deliveryBy",
            "orderSource",
            COALESCE("subTotalPrice", COALESCE("totalPrice", 0) + COALESCE("totalDiscounts", 0), 0)::numeric AS "grossValue",
            COALESCE("totalDiscounts", 0)::numeric AS "discountValue",
            COALESCE("totalCost", 0)::numeric AS "costValue",
            "updatedAt" AS "sourceUpdatedAt"
          FROM "orders"
          WHERE "deletedAt" IS NULL
            AND "orderDate" >= :startDate
            AND "orderDate" < :exclusiveEndDate
        )
        SELECT
          "metricDate",
          COUNT(*)::int AS "orderCount",
          MAX("sourceUpdatedAt") AS "sourceUpdatedAt",
          COALESCE(SUM("grossValue") FILTER (WHERE COALESCE("orderSource", ${ORDER_SOURCE_ONLINE_SQL}) <> ${ORDER_SOURCE_SHOWROOM_SQL}), 0)::numeric AS "gmvOnline",
          COALESCE(SUM("grossValue") FILTER (WHERE "orderSource" = ${ORDER_SOURCE_SHOWROOM_SQL}), 0)::numeric AS "gmvShowroom",
          COALESCE(SUM("grossValue" - "discountValue") FILTER (WHERE "status" = ${CANCELED_STATUS_SQL}), 0)::numeric AS "cancellations",
          COALESCE(SUM("discountValue"), 0)::numeric AS "discounts",
          COALESCE(SUM("grossValue" - "discountValue") FILTER (WHERE "status" = ${DELIVERED_STATUS_SQL} AND "deliveryBy" = ${DELIVERY_BY_HOMIX_SQL}), 0)::numeric AS "deliveredHomix",
          COALESCE(SUM("grossValue" - "discountValue") FILTER (WHERE "status" = ${DELIVERED_STATUS_SQL} AND "deliveryBy" = ${DELIVERY_BY_VENDOR_SQL}), 0)::numeric AS "deliveredVendor",
          COALESCE(SUM("costValue"), 0)::numeric AS "cogsGmv",
          COALESCE(SUM("costValue") FILTER (WHERE COALESCE("status", 0) <> ${CANCELED_STATUS_SQL}), 0)::numeric AS "cogsNmv",
          COALESCE(SUM("costValue") FILTER (WHERE "status" = ${DELIVERED_STATUS_SQL}), 0)::numeric AS "cogsG2n"
        FROM order_finance
        GROUP BY "metricDate"
        ORDER BY "metricDate" ASC
      `,
      {
        replacements: { exclusiveEndDate: this.getExclusiveEndDate(endDate), startDate },
        transaction,
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row) => ({
      cancellations: Number(row.cancellations ?? 0),
      cogsG2n: Number(row.cogsG2n ?? 0),
      cogsGmv: Number(row.cogsGmv ?? 0),
      cogsNmv: Number(row.cogsNmv ?? 0),
      deliveredHomix: Number(row.deliveredHomix ?? 0),
      deliveredVendor: Number(row.deliveredVendor ?? 0),
      discounts: Number(row.discounts ?? 0),
      gmvOnline: Number(row.gmvOnline ?? 0),
      gmvShowroom: Number(row.gmvShowroom ?? 0),
      metricDate: row.metricDate,
      orderCount: Number(row.orderCount ?? 0),
      sourceUpdatedAt: row.sourceUpdatedAt,
    }));
  }

  private async getVendorAggregateRows(startDate: Date, endDate: Date, transaction?: Transaction): Promise<AggregateRecord[]> {
    const rows = await sequelize.query<DailyVendorRow>(
      `
        SELECT
          DATE(o."orderDate")::text AS "metricDate",
          p."vendorId" AS "vendorId",
          COUNT(DISTINCT o."id")::int AS "totalOrders",
          COUNT(DISTINCT CASE WHEN o."status" IN (${PENDING_STATUS_SQL}) THEN o."id" END)::int AS "pendingOrders",
          COUNT(DISTINCT CASE WHEN o."status" IN (${IN_PROGRESS_STATUS_SQL}) THEN o."id" END)::int AS "inProgressOrders",
          COUNT(DISTINCT CASE WHEN o."status" IN (${DELIVERED_STATUS_SQL}) THEN o."id" END)::int AS "deliveredOrders",
          COUNT(DISTINCT CASE WHEN o."status" IN (${CANCELED_OR_REFUNDED_STATUS_SQL}) THEN o."id" END)::int AS "canceledOrRefundedOrders",
          COUNT(DISTINCT ol."productId")::int AS "activeProducts",
          COALESCE(SUM((COALESCE(ol."price", 0)::numeric * COALESCE(ol."quantity", 0)::numeric) - COALESCE(ol."discount", 0)::numeric), 0)::numeric AS "totalSales"
        FROM "orderLines" ol
        INNER JOIN "orders" o ON o."id" = ol."orderId" AND o."deletedAt" IS NULL
        INNER JOIN "products" p ON p."id" = ol."productId" AND p."deletedAt" IS NULL
        WHERE ol."deletedAt" IS NULL
          AND p."vendorId" IS NOT NULL
          AND o."orderDate" >= :startDate
          AND o."orderDate" < :exclusiveEndDate
        GROUP BY DATE(o."orderDate"), p."vendorId"
        ORDER BY DATE(o."orderDate") ASC, p."vendorId" ASC
      `,
      {
        replacements: {
          exclusiveEndDate: this.getExclusiveEndDate(endDate),
          startDate,
        },
        transaction,
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row: DailyVendorRow) => {
      const vendorId = Number(row.vendorId);
      return {
        activeMakers: 0,
        activeProducts: Number(row.activeProducts ?? 0),
        canceledOrRefundedOrders: Number((row as DailyVendorRow & { canceledOrRefundedOrders?: number | string | null }).canceledOrRefundedOrders ?? 0),
        deliveredOrders: Number(row.deliveredOrders ?? 0),
        inProgressOrders: Number((row as DailyVendorRow & { inProgressOrders?: number | string | null }).inProgressOrders ?? 0),
        metricDate: row.metricDate,
        pendingOrders: Number(row.pendingOrders ?? 0),
        role: "vendor" as const,
        scopeId: vendorId,
        totalOrders: Number(row.totalOrders ?? 0),
        totalSales: Number(row.totalSales ?? 0),
        vendorId,
      };
    });
  }

  private getExclusiveEndDate(endDate: Date): Date {
    return new Date(endDate.getTime() + DAY_IN_MILLISECONDS);
  }

  private async hasCoverage(input: DashboardMetricsInput): Promise<boolean> {
    const rows = await dashboardDailyMetricModel.findAll<AggregateRecord>({
      attributes: ["metricDate"],
      where: {
        metricDate: {
          between: [input.startDate.slice(0, 10), input.endDate.slice(0, 10)],
        },
        role: input.role,
        scopeId: getScopeId(input),
      },
    });

    return rows.length > 0;
  }

  private async getAdminLeaderboardRows(
    input: DashboardMetricsInput,
  ): Promise<LeaderboardAggregateRow[]> {
    return sequelize.query<LeaderboardAggregateRow>(
      `
        WITH vendor_product_totals AS (
          SELECT
            dps."vendorId" AS "id",
            v."name" AS "name",
            dps."productTitle" AS "productTitle",
            SUM(dps."totalSales")::numeric AS "productSales"
          FROM "dashboardDailyProductSales" dps
          INNER JOIN "vendors" v ON v."id" = dps."vendorId"
          WHERE dps."metricDate" BETWEEN :startDate AND :endDate
          GROUP BY dps."vendorId", v."name", dps."productTitle"
        ),
        ranked_products AS (
          SELECT
            *,
            ROW_NUMBER() OVER (PARTITION BY "id" ORDER BY "productSales" DESC, "productTitle" ASC) AS "rowNumber"
          FROM vendor_product_totals
        ),
        vendor_totals AS (
          SELECT
            "id",
            "name",
            SUM("productSales")::numeric AS "totalSales"
          FROM vendor_product_totals
          GROUP BY "id", "name"
        )
        SELECT
          vt."id",
          vt."name",
          COALESCE(rp."productTitle", 'صانع') AS "secondaryLabel",
          vt."totalSales"
        FROM vendor_totals vt
        LEFT JOIN ranked_products rp ON rp."id" = vt."id" AND rp."rowNumber" = 1
        ORDER BY vt."totalSales" DESC, vt."name" ASC
        LIMIT ${MAX_LEADERBOARD_ITEMS}
      `,
      {
        replacements: {
          endDate: input.endDate.slice(0, 10),
          startDate: input.startDate.slice(0, 10),
        },
        type: QueryTypes.SELECT,
      },
    );
  }

  private async getVendorLeaderboardRows(
    input: DashboardMetricsInput,
  ): Promise<LeaderboardAggregateRow[]> {
    return sequelize.query<LeaderboardAggregateRow>(
      `
        SELECT
          dps."productId" AS "id",
          dps."productTitle" AS "name",
          CONCAT(SUM(dps."totalOrders")::int, ' طلب') AS "secondaryLabel",
          SUM(dps."totalSales")::numeric AS "totalSales"
        FROM "dashboardDailyProductSales" dps
        WHERE dps."metricDate" BETWEEN :startDate AND :endDate
          AND dps."vendorId" = :vendorId
        GROUP BY dps."productId", dps."productTitle"
        ORDER BY SUM(dps."totalSales") DESC, dps."productTitle" ASC
        LIMIT ${MAX_LEADERBOARD_ITEMS}
      `,
      {
        replacements: {
          endDate: input.endDate.slice(0, 10),
          startDate: input.startDate.slice(0, 10),
          vendorId: input.vendorId ?? 0,
        },
        type: QueryTypes.SELECT,
      },
    );
  }

  private async getProductAggregateRows(startDate: Date, endDate: Date, transaction?: Transaction): Promise<ProductAggregateRecord[]> {
    const rows = await sequelize.query<ProductAggregateRecord>(
      `
        SELECT
          DATE(o."orderDate")::text AS "metricDate",
          p."vendorId" AS "vendorId",
          p."id" AS "productId",
          p."title" AS "productTitle",
          COUNT(DISTINCT o."id")::int AS "totalOrders",
          COALESCE(SUM(ol."quantity"), 0)::int AS "totalQuantity",
          COALESCE(SUM((COALESCE(ol."price", 0)::numeric * COALESCE(ol."quantity", 0)::numeric) - COALESCE(ol."discount", 0)::numeric), 0)::numeric AS "totalSales"
        FROM "orderLines" ol
        INNER JOIN "orders" o ON o."id" = ol."orderId" AND o."deletedAt" IS NULL
        INNER JOIN "products" p ON p."id" = ol."productId" AND p."deletedAt" IS NULL
        WHERE ol."deletedAt" IS NULL
          AND p."vendorId" IS NOT NULL
          AND o."orderDate" >= :startDate
          AND o."orderDate" < :exclusiveEndDate
        GROUP BY DATE(o."orderDate"), p."vendorId", p."id", p."title"
        ORDER BY DATE(o."orderDate") ASC, p."vendorId" ASC, p."id" ASC
      `,
      {
        replacements: {
          exclusiveEndDate: this.getExclusiveEndDate(endDate),
          startDate,
        },
        transaction,
        type: QueryTypes.SELECT,
      },
    );

    const productMap = new Map<string, ProductAggregateRecord>();

    for (const row of rows) {
      const metricDate = row.metricDate;
      const productId = Number(row.productId);
      const vendorId = Number(row.vendorId);
      const key = `${metricDate}:${vendorId}:${productId}`;
      const currentRow = productMap.get(key) ?? {
        metricDate,
        productId,
        productTitle: row.productTitle,
        totalOrders: 0,
        totalQuantity: 0,
        totalSales: 0,
        vendorId,
      };

      currentRow.totalOrders += Number(row.totalOrders ?? 0);
      currentRow.totalQuantity += Number(row.totalQuantity ?? 0);
      currentRow.totalSales += Number(row.totalSales ?? 0);

      productMap.set(key, currentRow);
    }

    return [...productMap.values()];
  }

  private dedupeProductAggregateRows(rows: ProductAggregateRecord[]): ProductAggregateRecord[] {
    const productMap = new Map<string, ProductAggregateRecord>();

    for (const row of rows) {
      const key = `${row.metricDate}:${row.vendorId}:${row.productId}`;
      const currentRow = productMap.get(key) ?? {
        metricDate: row.metricDate,
        productId: row.productId,
        productTitle: row.productTitle,
        totalOrders: 0,
        totalQuantity: 0,
        totalSales: 0,
        vendorId: row.vendorId,
      };

      currentRow.totalOrders += Number(row.totalOrders ?? 0);
      currentRow.totalQuantity += Number(row.totalQuantity ?? 0);
      currentRow.totalSales += Number(row.totalSales ?? 0);

      productMap.set(key, currentRow);
    }

    return [...productMap.values()];
  }

  private dedupeCategoryAggregateRows(rows: CategoryAggregateRecord[]): CategoryAggregateRecord[] {
    const categoryMap = new Map<string, CategoryAggregateRecord>();

    for (const row of rows) {
      const key = `${row.metricDate}:${row.role}:${row.scopeId}:${row.categoryId}`;
      const currentRow = categoryMap.get(key) ?? {
        categoryId: row.categoryId,
        categoryTitle: row.categoryTitle,
        metricDate: row.metricDate,
        role: row.role,
        scopeId: row.scopeId,
        totalOrders: 0,
        totalQuantity: 0,
        totalSales: 0,
        vendorId: row.vendorId,
      };

      currentRow.totalOrders += Number(row.totalOrders ?? 0);
      currentRow.totalQuantity += Number(row.totalQuantity ?? 0);
      currentRow.totalSales += Number(row.totalSales ?? 0);

      categoryMap.set(key, currentRow);
    }

    return [...categoryMap.values()];
  }

  private async upsertProductRows(rows: ProductAggregateRecord[], transaction?: Transaction): Promise<void> {
    for (const batch of this.chunkRows(rows, 250)) {
      await dashboardDailyProductSaleModel.bulkCreate(batch, {
        transaction,
        updateOnDuplicate: [...BULK_PRODUCT_UPDATE_FIELDS],
      });
    }
  }

  private async upsertCategoryRows(rows: CategoryAggregateRecord[], transaction?: Transaction): Promise<void> {
    for (const batch of this.chunkRows(rows, 250)) {
      await dashboardDailyCategorySaleModel.bulkCreate(batch, {
        transaction,
        updateOnDuplicate: [...BULK_CATEGORY_UPDATE_FIELDS],
      });
    }
  }

  private chunkRows<TRow>(rows: TRow[], chunkSize: number): TRow[][] {
    const chunks: TRow[][] = [];

    for (let index = 0; index < rows.length; index += chunkSize) {
      chunks.push(rows.slice(index, index + chunkSize));
    }

    return chunks;
  }

  private async getCategoryAggregateRows(startDate: Date, endDate: Date, transaction?: Transaction): Promise<CategoryAggregateRecord[]> {
    const rows = await sequelize.query<{
      categoryId: number | string;
      categoryTitle: string;
      metricDate: string;
      totalOrders: number | string | null;
      totalQuantity: number | string | null;
      totalSales: number | string | null;
      vendorId: number | string | null;
    }>(
      `
        SELECT
          DATE(o."orderDate")::text AS "metricDate",
          COALESCE(pt."id", ${UNCATEGORIZED_CATEGORY_ID}) AS "categoryId",
          COALESCE(pt."name", '${UNCATEGORIZED_CATEGORY_TITLE}') AS "categoryTitle",
          p."vendorId" AS "vendorId",
          COUNT(DISTINCT o."id")::int AS "totalOrders",
          COALESCE(SUM(ol."quantity"), 0)::int AS "totalQuantity",
          COALESCE(SUM((COALESCE(ol."price", 0)::numeric * COALESCE(ol."quantity", 0)::numeric) - COALESCE(ol."discount", 0)::numeric), 0)::numeric AS "totalSales"
        FROM "orderLines" ol
        INNER JOIN "orders" o ON o."id" = ol."orderId" AND o."deletedAt" IS NULL
        INNER JOIN "products" p ON p."id" = ol."productId" AND p."deletedAt" IS NULL
        LEFT JOIN "productsTypes" pt ON pt."id" = p."typeId" AND pt."deletedAt" IS NULL
        WHERE ol."deletedAt" IS NULL
          AND p."vendorId" IS NOT NULL
          AND o."orderDate" >= :startDate
          AND o."orderDate" < :exclusiveEndDate
        GROUP BY DATE(o."orderDate"), COALESCE(pt."id", ${UNCATEGORIZED_CATEGORY_ID}), COALESCE(pt."name", '${UNCATEGORIZED_CATEGORY_TITLE}'), p."vendorId"
        ORDER BY DATE(o."orderDate") ASC, p."vendorId" ASC
      `,
      {
        replacements: {
          exclusiveEndDate: this.getExclusiveEndDate(endDate),
          startDate,
        },
        transaction,
        type: QueryTypes.SELECT,
      },
    );

    const adminMap = new Map<string, CategoryAggregateRecord>();
    const vendorMap = new Map<string, CategoryAggregateRecord>();

    for (const row of rows) {
      const metricDate = row.metricDate;
      const categoryId = Number(row.categoryId);
      const vendorId = row.vendorId === null ? null : Number(row.vendorId);
      const totalOrders = Number(row.totalOrders ?? 0);
      const totalQuantity = Number(row.totalQuantity ?? 0);
      const totalSales = Number(row.totalSales ?? 0);

      if (vendorId !== null) {
        const vendorKey = `${metricDate}:${vendorId}:${categoryId}`;
        const currentVendorRow = vendorMap.get(vendorKey) ?? {
          categoryId,
          categoryTitle: row.categoryTitle,
          metricDate,
          role: "vendor",
          scopeId: vendorId,
          totalOrders: 0,
          totalQuantity: 0,
          totalSales: 0,
          vendorId,
        };
        currentVendorRow.totalOrders += totalOrders;
        currentVendorRow.totalQuantity += totalQuantity;
        currentVendorRow.totalSales += totalSales;
        vendorMap.set(vendorKey, currentVendorRow);
      }

      const adminKey = `${metricDate}:${categoryId}`;
      const currentAdminRow = adminMap.get(adminKey) ?? {
        categoryId,
        categoryTitle: row.categoryTitle,
        metricDate,
        role: "admin" as const,
        scopeId: 0,
        totalOrders: 0,
        totalQuantity: 0,
        totalSales: 0,
        vendorId: null,
      };
      currentAdminRow.totalOrders += totalOrders;
      currentAdminRow.totalQuantity += totalQuantity;
      currentAdminRow.totalSales += totalSales;
      adminMap.set(adminKey, currentAdminRow);
    }

    return [...adminMap.values(), ...vendorMap.values()];
  }
}
