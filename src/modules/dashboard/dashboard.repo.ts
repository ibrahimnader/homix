import { Op } from "sequelize";

import { sequelize } from "../../infrastructure/database";

import { ORDER_STATUS } from "../../config/constants";
import { DashboardAggregateService } from "./dashboard-aggregate.service";
import { toStatusLabel, withRanks } from "./dashboard.helpers";
import type {
  DashboardActivityItem,
  DashboardLatestOrderItem,
  DashboardLeaderboardEntry,
  DashboardMetricSnapshot,
  DashboardMetricsInput,
  DashboardPerformancePoint,
  DashboardSalesDistributionItem,
  FinanceAutomaticMetrics,
  FinanceOpexItem,
} from "./dashboard.types";

type PlainRecord = Record<string, unknown>;
type Plainable = PlainRecord | { toJSON: () => PlainRecord };

type LegacyModel = {
  bulkCreate?: <TRow = PlainRecord>(payloads: PlainRecord[], options?: PlainRecord) => Promise<TRow[]>;
  count: (options?: PlainRecord) => Promise<number>;
  destroy?: (options?: PlainRecord) => Promise<number>;
  findAll: <TRow = PlainRecord>(options?: PlainRecord) => Promise<TRow[]>;
  findOne: <TRow = PlainRecord>(options?: PlainRecord) => Promise<TRow | null>;
};

const orderModel = require("../../../app/modules/order/order.model") as LegacyModel;
const orderLineModel = require("../../../app/modules/orderLines/orderline.model") as LegacyModel;
const productModel = require("../../../app/modules/product/product.model");
const customerModel = require("../../../app/modules/customer/customer.model");
const vendorModel = require("../../../app/modules/vendor/vendor.model");
const notificationModel = require("../../../app/modules/notification/notification.model") as LegacyModel;
const financeOpexModel = require("./finance-opex.model") as LegacyModel;

const OPEN_ORDER_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.IN_PROGRESS,
  ORDER_STATUS.CONFIRMED,
] as const;

const DELIVERED_ORDER_STATUS = ORDER_STATUS.DELIVERED;
const ZERO_VALUE = 0;
const DEFAULT_LIMIT = 10;

type RangeBounds = {
  endDate: Date;
  startDate: Date;
};

type NormalizedOrderLine = {
  lineAmount: number;
  productId: number | null;
  productTitle: string;
  vendorId: number | null;
  vendorName: string;
};

type NormalizedOrder = {
  customerName: string;
  id: number;
  lines: NormalizedOrderLine[];
  orderDate: string;
  orderNumber: string;
  status: number | null;
  totalPrice: number;
};

const buildDateRange = ({ endDate, startDate }: RangeBounds): PlainRecord => ({
  [Op.between]: [startDate, endDate],
});

const vendorProductInclude = (vendorId: number): PlainRecord => ({
  as: "product",
  attributes: ["id", "title", "vendorId"],
  include: [
    {
      as: "vendor",
      attributes: ["id", "name"],
      model: vendorModel,
      required: false,
    },
  ],
  model: productModel,
  required: true,
  where: {
    vendorId,
  },
});

const toPlain = (row: Plainable): PlainRecord => {
  if ("toJSON" in row && typeof row.toJSON === "function") {
    return row.toJSON() as PlainRecord;
  }

  return row;
};

const parseNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : ZERO_VALUE;
  }

  if (typeof value === "string") {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : ZERO_VALUE;
  }

  return ZERO_VALUE;
};

const toRange = ({ endDate, startDate }: DashboardMetricsInput): RangeBounds => ({
  endDate: new Date(endDate),
  startDate: new Date(startDate),
});

const getString = (value: unknown, fallback = ""): string => {
  return typeof value === "string" ? value : fallback;
};

const toIsoString = (value: unknown): string => {
  const parsedDate = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(parsedDate.getTime()) ? "" : parsedDate.toISOString();
};

const getCustomerName = (customer: PlainRecord | undefined): string => {
  if (!customer) {
    return "عميل";
  }

  const firstName = getString(customer.firstName);
  const lastName = getString(customer.lastName);
  return `${firstName} ${lastName}`.trim() || "عميل";
};

const getOrderLineAmount = (line: PlainRecord): number => {
  const price = parseNumber(line.price);
  const quantity = parseNumber(line.quantity);
  const discount = parseNumber(line.discount);
  return price * quantity - discount;
};

const toDistributionItems = (
  source: Map<string, number>,
  colors: string[],
): DashboardSalesDistributionItem[] => {
  const total = [...source.values()].reduce((sum, value) => sum + value, 0);
  return [...source.entries()]
    .map(([label, value], index) => ({
      color: colors[index % colors.length] ?? "#94A3B8",
      label,
      percentage: total === 0 ? 0 : Math.round((value / total) * 1000) / 10,
      value,
    }))
    .sort((left, right) => right.value - left.value);
};

export class DashboardRepository {
  private readonly dashboardAggregateService = new DashboardAggregateService({
    getDeliveredOrdersCountFromOrders: (input) => this.getDeliveredOrdersCountFromOrders(input),
    getSnapshotFromOrders: (input) => this.getSnapshotFromOrders(input),
  });

  public async getSnapshot(input: DashboardMetricsInput): Promise<DashboardMetricSnapshot> {
    const aggregateSnapshot = await this.dashboardAggregateService.getSnapshot(input);
    if (aggregateSnapshot) {
      return aggregateSnapshot;
    }

    return this.getSnapshotFromOrders(input);
  }

  public async getFinanceAutomaticMetrics(startDate: string, endDate: string): Promise<FinanceAutomaticMetrics> {
    const metrics = await this.dashboardAggregateService.getFinanceMetrics(startDate, endDate);
    if (metrics) return metrics;

    throw new Error("Finance aggregate could not be generated for the requested month");
  }

  public async getFinanceOpex(month: string): Promise<FinanceOpexItem[]> {
    const rows = await financeOpexModel.findAll<Plainable>({
      order: [["sortOrder", "ASC"], ["id", "ASC"]],
      where: { month },
    });

    return rows.map((row) => {
      const item = toPlain(row);
      return {
        amount: parseNumber(item.amount),
        id: Number(item.id),
        label: getString(item.label),
        sortOrder: Number(item.sortOrder ?? 0),
      };
    });
  }

  public async replaceFinanceOpex(month: string, items: Array<{ amount: number; label: string }>): Promise<FinanceOpexItem[]> {
    await sequelize.transaction(async (transaction) => {
      await financeOpexModel.destroy!({ transaction, where: { month } });
      if (items.length > 0) {
        await financeOpexModel.bulkCreate!(
          items.map((item, sortOrder) => ({ ...item, month, sortOrder })),
          { transaction },
        );
      }
    });

    return this.getFinanceOpex(month);
  }

  public async getSnapshotFromOrders(input: DashboardMetricsInput): Promise<DashboardMetricSnapshot> {
    const range = toRange(input);
    if (input.role === "vendor" && input.vendorId) {
      return this.getVendorSnapshot(input.vendorId, range);
    }

    return this.getAdminSnapshot(range);
  }

  public async getPerformanceSeries(
    input: DashboardMetricsInput,
  ): Promise<DashboardPerformancePoint[]> {
    const aggregateSeries = await this.dashboardAggregateService.getPerformanceSeries(input);
    if (aggregateSeries) {
      return aggregateSeries;
    }

    const orders = await this.getScopedOrders(input);
    const grouped = new Map<string, { orders: number; sales: number }>();

    for (const order of orders) {
      const bucket = order.orderDate.slice(0, 10);
      const entry = grouped.get(bucket) ?? { orders: 0, sales: 0 };
      entry.orders += 1;
      entry.sales += input.role === "vendor"
        ? order.lines.reduce((sum, line) => sum + line.lineAmount, 0)
        : order.totalPrice;
      grouped.set(bucket, entry);
    }

    return [...grouped.entries()]
      .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
      .map(([date, values]) => ({
        date,
        orders: values.orders,
        sales: Math.round(values.sales * 100) / 100,
      }));
  }

  public async getActivities(
    input: DashboardMetricsInput,
    userId: number,
  ): Promise<DashboardActivityItem[]> {
    const notifications = await notificationModel.findAll<Plainable>({
      limit: DEFAULT_LIMIT,
      order: [["createdAt", "DESC"]],
      where: {
        createdAt: buildDateRange(toRange(input)),
        userId,
      },
    });

    return notifications.map((notification) => {
      const plainNotification = toPlain(notification);
      return {
        createdAt: toIsoString(plainNotification.createdAt),
        entityId: Number(plainNotification.entityId ?? 0),
        entityType: getString(plainNotification.entityType),
        id: Number(plainNotification.id ?? 0),
        text: getString(plainNotification.text),
      };
    });
  }

  public async getLatestOrders(input: DashboardMetricsInput): Promise<DashboardLatestOrderItem[]> {
    const orders = await this.getScopedOrders(input, DEFAULT_LIMIT);

    return orders.map((order) => ({
      amount: Math.round(
        (input.role === "vendor"
          ? order.lines.reduce((sum, line) => sum + line.lineAmount, 0)
          : order.totalPrice) * 100,
      ) / 100,
      customerName: order.customerName,
      id: order.id,
      orderDate: order.orderDate,
      orderNumber: order.orderNumber,
      productName: order.lines[0]?.productTitle ?? "منتج",
      status: order.status,
      statusLabel: toStatusLabel(order.status),
    }));
  }

  public async getLeaderboard(
    input: DashboardMetricsInput,
  ): Promise<DashboardLeaderboardEntry[]> {
    const aggregateEntries = await this.dashboardAggregateService.getLeaderboard(input);
    if (aggregateEntries && aggregateEntries.length > 0) {
      return aggregateEntries;
    }

    const lines = await this.getScopedOrderLines(input);
    const salesByEntry = new Map<string, Omit<DashboardLeaderboardEntry, "rank">>();

    for (const line of lines) {
      const key = input.role === "vendor"
        ? `product:${line.productId ?? 0}`
        : `vendor:${line.vendorId ?? 0}`;
      const current = salesByEntry.get(key) ?? {
        id: input.role === "vendor" ? line.productId : line.vendorId,
        name: input.role === "vendor" ? line.productTitle : line.vendorName,
        secondaryLabel: input.role === "vendor" ? "حسب المبيعات" : "صانع",
        totalSales: 0,
      };
      current.totalSales += line.lineAmount;
      salesByEntry.set(key, current);
    }

    const entries = [...salesByEntry.values()]
      .sort((left, right) => right.totalSales - left.totalSales)
      .slice(0, 10)
      .map((entry) => ({
        ...entry,
        totalSales: Math.round(entry.totalSales * 100) / 100,
      }));

    return withRanks(entries);
  }

  public async getSalesDistribution(
    input: DashboardMetricsInput,
  ): Promise<DashboardSalesDistributionItem[]> {
    const aggregateDistribution = await this.dashboardAggregateService.getSalesDistribution(input);
    if (aggregateDistribution && aggregateDistribution.length > 0) {
      const groupedSales = new Map<string, number>();
      for (const item of aggregateDistribution) {
        groupedSales.set(item.label, item.value);
      }

      return toDistributionItems(groupedSales, ["#6366F1", "#10B981", "#F59E0B", "#C4A15A", "#94A3B8"]);
    }

    const lines = await this.getScopedOrderLines(input);
    const groupedSales = new Map<string, number>();

    for (const line of lines) {
      const label = input.role === "vendor" ? line.productTitle : line.vendorName;
      groupedSales.set(label, (groupedSales.get(label) ?? 0) + line.lineAmount);
    }

    return toDistributionItems(groupedSales, ["#6366F1", "#10B981", "#F59E0B", "#C4A15A", "#94A3B8"]);
  }

  public async getDeliveredOrdersCount(input: DashboardMetricsInput): Promise<number> {
    const aggregateCount = await this.dashboardAggregateService.getDeliveredOrdersCount(input);
    if (aggregateCount !== null) {
      return aggregateCount;
    }

    return this.getDeliveredOrdersCountFromOrders(input);
  }

  public async getDeliveredOrdersCountFromOrders(input: DashboardMetricsInput): Promise<number> {
    const range = toRange(input);
    if (input.role === "vendor" && input.vendorId) {
      return orderLineModel.count({
        col: "orderId",
        distinct: true,
        include: [
          vendorProductInclude(input.vendorId),
          {
            attributes: [],
            model: orderModel,
            required: true,
            where: {
              orderDate: buildDateRange(range),
              status: DELIVERED_ORDER_STATUS,
            },
          },
        ],
      });
    }

    return orderModel.count({
      where: {
        orderDate: buildDateRange(range),
        status: DELIVERED_ORDER_STATUS,
      },
    });
  }

  private async getAdminSnapshot(range: RangeBounds): Promise<DashboardMetricSnapshot> {
    const [salesOrders, totalOrders, pendingOrders, activeMakers] = await Promise.all([
      orderModel.findAll<Plainable>({
        attributes: ["totalPrice"],
        where: {
          orderDate: buildDateRange(range),
        },
      }),
      orderModel.count({
        where: {
          orderDate: buildDateRange(range),
        },
      }),
      orderModel.count({
        where: {
          orderDate: buildDateRange(range),
          status: {
            [Op.in]: OPEN_ORDER_STATUSES,
          },
        },
      }),
      this.getActiveMakers(range),
    ]);

    return {
      activeMakers,
      activeProducts: ZERO_VALUE,
      pendingOrders,
      totalOrders,
      totalSales: salesOrders.reduce((sum, order) => sum + parseNumber(toPlain(order).totalPrice), 0),
    };
  }

  private async getActiveMakers(range: RangeBounds): Promise<number> {
    const lines = await orderLineModel.findAll<Plainable>({
      include: [
        {
          as: "product",
          attributes: ["vendorId"],
          model: productModel,
          required: true,
          where: {
            vendorId: {
              [Op.ne]: null,
            },
          },
        },
        {
          attributes: ["id"],
          model: orderModel,
          required: true,
          where: {
            orderDate: buildDateRange(range),
          },
        },
      ],
    });

    const vendorIds = new Set<number>();
    for (const line of lines) {
      const product = toPlain(line).product as PlainRecord | undefined;
      const vendorId = Number(product?.vendorId ?? 0);
      if (vendorId > 0) {
        vendorIds.add(vendorId);
      }
    }

    return vendorIds.size;
  }

  private async getVendorSnapshot(
    vendorId: number,
    range: RangeBounds,
  ): Promise<DashboardMetricSnapshot> {
    const orders = await this.getScopedOrders({
      endDate: range.endDate.toISOString(),
      role: "vendor",
      startDate: range.startDate.toISOString(),
      vendorId,
    });

    const orderIds = new Set<number>();
    const productIds = new Set<number>();
    let pendingOrders = 0;
    let totalSales = 0;

    for (const order of orders) {
      orderIds.add(order.id);
      totalSales += order.lines.reduce((sum, line) => sum + line.lineAmount, 0);
      if (order.status !== null && OPEN_ORDER_STATUSES.includes(order.status as (typeof OPEN_ORDER_STATUSES)[number])) {
        pendingOrders += 1;
      }
      order.lines.forEach((line) => {
        if (line.productId !== null) {
          productIds.add(line.productId);
        }
      });
    }

    return {
      activeMakers: ZERO_VALUE,
      activeProducts: productIds.size,
      pendingOrders,
      totalOrders: orderIds.size,
      totalSales: Math.round(totalSales * 100) / 100,
    };
  }

  /* Newest order ids that carry at least one line from this vendor. Grouping keeps
     one row per order so the limit counts orders rather than matching lines. */
  private async getVendorOrderIds(
    vendorId: number,
    range: RangeBounds,
    limit: number,
  ): Promise<number[]> {
    const rows = await orderLineModel.findAll<Plainable>({
      attributes: ["orderId"],
      group: ["OrderLine.orderId", "Order.orderDate"],
      include: [
        {
          as: "product",
          attributes: [],
          model: productModel,
          required: true,
          where: {
            vendorId,
          },
        },
        {
          attributes: [],
          model: orderModel,
          required: true,
          where: {
            orderDate: buildDateRange(range),
          },
        },
      ],
      limit,
      order: [[orderModel, "orderDate", "DESC"]],
    });

    return rows
      .map((row) => Number(toPlain(row).orderId ?? 0))
      .filter((orderId) => orderId > 0);
  }

  private async getScopedOrders(
    input: DashboardMetricsInput,
    limit?: number,
  ): Promise<NormalizedOrder[]> {
    const range = toRange(input);
    const include = [
      {
        as: "customer",
        attributes: ["firstName", "lastName"],
        model: customerModel,
        required: false,
      },
      {
        as: "orderLines",
        attributes: ["discount", "price", "productId", "quantity"],
        include: [
          input.role === "vendor" && input.vendorId
            ? vendorProductInclude(input.vendorId)
            : {
                as: "product",
                attributes: ["id", "title", "vendorId"],
                include: [
                  {
                    as: "vendor",
                    attributes: ["id", "name"],
                    model: vendorModel,
                    required: false,
                  },
                ],
                model: productModel,
                required: false,
              },
        ],
        model: orderLineModel,
        required: input.role === "vendor",
      },
    ];

    /* A limited vendor query cannot go through Sequelize's subquery path: it hoists
       the required nested `product` include into the LIMIT subquery while leaving
       `orderLines` out of that subquery's FROM clause, which Postgres rejects. Pick
       the page of order ids up front so the hydrating query carries no limit, and
       so builds no subquery. */
    const vendorId = input.role === "vendor" ? input.vendorId : undefined;
    const scopedIds = limit !== undefined && vendorId
      ? await this.getVendorOrderIds(vendorId, range, limit)
      : undefined;

    if (scopedIds && scopedIds.length === 0) {
      return [];
    }

    const orders = await orderModel.findAll<Plainable>({
      include,
      limit: scopedIds ? undefined : limit,
      order: [["orderDate", "DESC"]],
      where: {
        orderDate: buildDateRange(range),
        ...(scopedIds ? { id: { [Op.in]: scopedIds } } : {}),
      },
    });

    return orders.map((order) => {
      const plainOrder = toPlain(order);
      const orderLines = Array.isArray(plainOrder.orderLines)
        ? (plainOrder.orderLines as PlainRecord[])
        : [];
      return {
        customerName: getCustomerName(plainOrder.customer as PlainRecord | undefined),
        id: Number(plainOrder.id ?? 0),
        lines: orderLines.map((line) => {
          const product = line.product as PlainRecord | undefined;
          const vendor = product?.vendor as PlainRecord | undefined;
          return {
            lineAmount: getOrderLineAmount(line),
            productId: product ? Number(product.id ?? 0) : null,
            productTitle: getString(product?.title, "منتج"),
            vendorId: vendor ? Number(vendor.id ?? 0) : null,
            vendorName: getString(vendor?.name, "غير محدد"),
          };
        }),
        orderDate: toIsoString(plainOrder.orderDate),
        orderNumber: getString(plainOrder.orderNumber, getString(plainOrder.name)),
        status: plainOrder.status === null || plainOrder.status === undefined ? null : Number(plainOrder.status),
        totalPrice: parseNumber(plainOrder.totalPrice),
      };
    });
  }

  private async getScopedOrderLines(input: DashboardMetricsInput): Promise<NormalizedOrderLine[]> {
    const range = toRange(input);
    const include = [
      input.role === "vendor" && input.vendorId
        ? vendorProductInclude(input.vendorId)
        : {
            as: "product",
            attributes: ["id", "title", "vendorId"],
            include: [
              {
                as: "vendor",
                attributes: ["id", "name"],
                model: vendorModel,
                required: false,
              },
            ],
            model: productModel,
            required: true,
          },
      {
        attributes: ["id"],
        model: orderModel,
        required: true,
        where: {
          orderDate: buildDateRange(range),
        },
      },
    ];

    const lines = await orderLineModel.findAll<Plainable>({
      attributes: ["discount", "price", "productId", "quantity"],
      include,
    });

    return lines.map((line) => {
      const plainLine = toPlain(line);
      const product = plainLine.product as PlainRecord | undefined;
      const vendor = product?.vendor as PlainRecord | undefined;
      return {
        lineAmount: getOrderLineAmount(plainLine),
        productId: product ? Number(product.id ?? 0) : null,
        productTitle: getString(product?.title, "منتج"),
        vendorId: vendor ? Number(vendor.id ?? 0) : null,
        vendorName: getString(vendor?.name, "غير محدد"),
      };
    });
  }
}
