import moment from "moment-timezone";
import { col, fn, literal, Op } from "sequelize";

import {
  DELIVERY_BY,
  DELIVERY_BY_ARABIC,
  DELIVERY_STATUS,
  MANUFACTURE_STATUS_ARABIC,
  ORDER_SOURCE_ARABIC,
  ORDER_STATUS,
  ORDER_SOURCE,
  ORDER_STATUS_Arabic,
  PAYMENT_STATUS,
  PAYMENT_STATUS_ARABIC,
  SHIPMENTS_STATUS,
  USER_TYPES,
} from "../../../config/constants";
import { ACTIVE_VENDOR_ORDER_STATUSES, FINAL_ORDER_STATUSES, ORDER_PRIORITY, ORDER_STATUS_LABELS, ORDER_SUMMARY_STATUS_GROUPS } from "./order.constants";
import {
  buildLogMessage,
  getDaysSince,
  getDeliveryPriorityLabel,
  resolveDeliveryStatus,
  getHistoryActorLabel,
  resolveOrderPriority,
  getStatusLabel,
  getManufactureLabel,
  getPaymentLabel,
  toIsoString,
  toNumber,
  toPlain,
  toText,
} from "./order.helpers";
import type { OrderDetailsResponse, OrderDetailsView, OrderFinancialReportQuery, OrderFinancialReportResponse, OrderFinancialReportSection, OrderFinancialReportSectionSummary, OrderFinancialReportVendorRow, OrderListItem, OrderListQuery, OrderListResponse, OrderMetaResponse, OrderStatusHistoryItem, OrderSummaryResponse, OrderTimelineItem } from "./order.types";
import { calculateVendorDeliverySettlement } from "./order-financial-settlement";

const { sequelize } = require("../../infrastructure/database");
const orderModel = require("../../../app/modules/order/order.model");
const orderLineModel = require("../../../app/modules/orderLines/orderline.model");
const productModel = require("../../../app/modules/product/product.model");
const vendorModel = require("../../../app/modules/vendor/vendor.model");
const customerModel = require("../../../app/modules/customer/customer.model");
const noteModel = require("../../../app/modules/notes/notes.model");
const userModel = require("../../../app/modules/user/user.model");
const attachmentModel = require("../../../app/modules/attachments/attachment.model");
const productTypeModel = require("../../../app/modules/product/productType.model");
const logModel = require("../../../app/modules/logs/log.model");
const dashboardDailyMetricModel = require("../dashboard/dashboard-daily-metric.model");
const ORDER_SOURCE_LABELS = ORDER_SOURCE_ARABIC as Record<number, string>;
const ORDER_SORTABLE_FIELDS = ["orderDate", "priority", "subTotalPrice", "totalPrice"] as const;

type OrderSortField = (typeof ORDER_SORTABLE_FIELDS)[number];
type OrderSortDirection = 1 | -1;
type OrderSortEntry = [OrderSortField, OrderSortDirection];

const SUMMARY_AGGREGATE_UNSUPPORTED_FILTERS: Array<keyof OrderListQuery> = [
  "customerName",
  "deliveryBy",
  "deliveryStatus",
  "manufactureStatus",
  "operationCode",
  "orderSource",
  "orderNumber",
  "paymentStatus",
  "priority",
  "productCode",
  "status",
  "userId",
  "vendorName",
];

const buildDeliveryStatusCondition = (value: string): Record<PropertyKey, unknown> => {
  const statuses = value.split(",").map(Number).filter((status) => [1, 2, 3].includes(status));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const almostDueDate = new Date(today);
  almostDueDate.setDate(almostDueDate.getDate() + 2);
  const conditions: Array<Record<PropertyKey, unknown>> = [];

  if (statuses.includes(1)) conditions.push({ expectedDeliveryDate: { [Op.gte]: almostDueDate } });
  if (statuses.includes(2)) conditions.push({ expectedDeliveryDate: { [Op.gte]: today, [Op.lt]: almostDueDate } });
  if (statuses.includes(3)) conditions.push({ expectedDeliveryDate: { [Op.lt]: today } });
  conditions.push({ deliveryStatus: { [Op.in]: statuses }, expectedDeliveryDate: null });

  return { [Op.or]: conditions };
};

const buildFilters = (filters: OrderListQuery, vendorId?: number | null): Record<string, unknown> => {
  const andConditions: unknown[] = [];
  const pushDateCondition = (key: string, operator: symbol, value: string): void => {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      andConditions.push(sequelize.where(sequelize.col(key), { [operator]: date }));
    }
  };

  if (filters.orderNumber) {
    andConditions.push({
      [Op.or]: [
        sequelize.where(sequelize.fn("lower", sequelize.col("Order.name")), { [Op.like]: `%${filters.orderNumber.toLowerCase()}%` }),
        sequelize.where(sequelize.fn("lower", sequelize.col("Order.number")), { [Op.like]: `%${filters.orderNumber.toLowerCase()}%` }),
        sequelize.where(sequelize.fn("lower", sequelize.col("Order.orderNumber")), { [Op.like]: `%${filters.orderNumber.toLowerCase()}%` }),
      ],
    });
  }

  if (filters.operationCode) {
    andConditions.push(sequelize.where(sequelize.fn("lower", sequelize.col("Order.code")), { [Op.like]: `%${filters.operationCode.toLowerCase()}%` }));
  }
  if (filters.customerName) {
    andConditions.push(sequelize.where(sequelize.fn("concat", sequelize.col("customer.firstName"), " ", sequelize.col("customer.lastName")), { [Op.like]: `%${filters.customerName}%` }));
  }
  if (filters.productCode) {
    andConditions.push(sequelize.where(sequelize.fn("lower", sequelize.col("orderLines.sku")), { [Op.like]: `%${filters.productCode.toLowerCase()}%` }));
  }
  if (filters.vendorName) {
    andConditions.push(sequelize.where(sequelize.fn("lower", sequelize.col("orderLines.product.vendor.name")), { [Op.like]: `%${filters.vendorName.toLowerCase()}%` }));
  }
  if (filters.vendorId) {
    andConditions.push(sequelize.where(sequelize.col("orderLines.product.vendor.id"), { [Op.in]: filters.vendorId.split(",").map(Number) }));
  }
  if (filters.status) {
    andConditions.push(sequelize.where(sequelize.col("Order.status"), { [Op.in]: filters.status.split(",").map(Number) }));
  }
  if (filters.manufactureStatus) {
    andConditions.push(sequelize.where(sequelize.col("Order.manufactureStatus"), { [Op.in]: filters.manufactureStatus.split(",").map(Number) }));
  }
  if (filters.paymentStatus) {
    andConditions.push(sequelize.where(sequelize.col("Order.paymentStatus"), { [Op.in]: filters.paymentStatus.split(",").map(Number) }));
  }
  if (filters.priority) {
    andConditions.push(sequelize.where(sequelize.col("Order.priority"), { [Op.in]: filters.priority.split(",").map(Number) }));
  }
  if (filters.deliveryBy) {
    andConditions.push(sequelize.where(sequelize.col("Order.deliveryBy"), { [Op.in]: filters.deliveryBy.split(",").map(Number) }));
  }
  if (filters.deliveryStatus) {
    andConditions.push(buildDeliveryStatusCondition(filters.deliveryStatus));
  }
  if (filters.orderSource) {
    andConditions.push(sequelize.where(sequelize.col("Order.orderSource"), { [Op.in]: filters.orderSource.split(",").map(Number) }));
  }
  if (filters.userId) {
    andConditions.push(sequelize.where(sequelize.col("Order.userId"), { [Op.eq]: filters.userId }));
  }
  if (filters.startDate) {
    pushDateCondition("Order.orderDate", Op.gte, filters.startDate);
  }
  if (filters.endDate) {
    pushDateCondition("Order.orderDate", Op.lte, filters.endDate);
  }
  if (vendorId) {
    andConditions.push(sequelize.where(sequelize.col("orderLines.product.vendor.id"), { [Op.eq]: vendorId }));
    andConditions.push(sequelize.where(sequelize.col("Order.status"), { [Op.in]: ACTIVE_VENDOR_ORDER_STATUSES }));
  }

  return andConditions.length > 0 ? { [Op.and]: andConditions } : {};
};

/**
 * The summary only groups and counts, so it joins the vendor chain only when a
 * filter references it. `required: true` keeps the join from multiplying rows.
 */
const buildSummaryIncludes = (filters: OrderListQuery, vendorId?: number | null) => {
  const includes: Record<string, unknown>[] = [];

  if (filters.vendorName || filters.vendorId || filters.productCode || vendorId) {
    includes.push({
      as: "orderLines",
      attributes: [],
      include: [
        {
          as: "product",
          attributes: [],
          include: [{ as: "vendor", attributes: [], model: vendorModel, required: true }],
          model: productModel,
          required: true,
        },
      ],
      model: orderLineModel,
      required: true,
    });
  }

  if (filters.customerName) {
    includes.push({ as: "customer", attributes: [], model: customerModel, required: true });
  }

  return includes;
};

const buildIncludes = (): Record<string, unknown>[] => {
  return [
    {
      as: "orderLines",
      include: [{
        as: "product",
        include: [
          { as: "vendor", model: vendorModel },
          { as: "type", model: productTypeModel },
        ],
        model: productModel,
      }],
      model: orderLineModel,
      required: true,
    },
    { as: "customer", model: customerModel, required: false },
  ];
};

/** Only select associations and columns rendered by the orders table. */
const buildOrderListIncludes = (): Record<string, unknown>[] => [
  {
    as: "orderLines",
    attributes: ["id", "orderId", "productId", "sku", "title"],
    include: [{
      as: "product",
      attributes: ["id", "image", "title", "typeId", "vendorId"],
      include: [
        { as: "vendor", attributes: ["id", "name"], model: vendorModel },
        { as: "type", attributes: ["id", "name"], model: productTypeModel },
      ],
      model: productModel,
    }],
    model: orderLineModel,
    required: true,
  },
  {
    as: "customer",
    attributes: ["id", "firstName", "lastName"],
    model: customerModel,
    required: false,
  },
  { as: "user", attributes: ["id", "firstName", "lastName"], model: userModel, required: false },
];

const parseCsvNumbers = (value?: string): number[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
};

const getOrderSortEntries = (sort?: OrderListQuery["sort"]): OrderSortEntry[] => {
  if (!sort) {
    return [];
  }

  return ORDER_SORTABLE_FIELDS.flatMap((field) => {
    const direction = sort[field];
    return direction === 1 || direction === -1 ? [[field, direction] satisfies OrderSortEntry] : [];
  });
};

const getOrderSortValue = (
  field: OrderSortField,
  entry: { item: OrderListItem; row: Record<string, unknown> },
): number => {
  if (field === "priority") {
    return entry.item.deliveryPriority ?? 0;
  }

  if (field === "orderDate") {
    const timestamp = new Date(toIsoString(entry.row.orderDate) ?? "").getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  return toNumber(entry.row[field]);
};

const compareOrderEntries = (
  left: { item: OrderListItem; row: Record<string, unknown> },
  right: { item: OrderListItem; row: Record<string, unknown> },
  sortEntries: OrderSortEntry[],
): number => {
  for (const [field, direction] of sortEntries) {
    const leftValue = getOrderSortValue(field, left);
    const rightValue = getOrderSortValue(field, right);
    if (leftValue === rightValue) {
      continue;
    }

    return direction === -1 ? rightValue - leftValue : leftValue - rightValue;
  }

  return right.item.id - left.item.id;
};

const buildOrderSort = (sortEntries: OrderSortEntry[]): Array<[unknown, "ASC" | "DESC"]> => {
  const effectiveEntries: OrderSortEntry[] = sortEntries.length > 0
    ? sortEntries
    : [["orderDate", -1]];
  const databaseEntries = effectiveEntries.map(([field, direction]) => {
    const databaseDirection = direction === -1 ? "DESC" : "ASC";
    // Manual orders store the selected business date at midnight, while
    // imported orders often include a time. Compare the calendar day first so
    // a newly-created manual order is not buried below every import that day.
    const expression = field === "orderDate"
      ? fn("DATE", col("Order.orderDate"))
      : field;
    return [expression, databaseDirection] as [unknown, "ASC" | "DESC"];
  });
  const orderDateDirection = effectiveEntries.find(([field]) => field === "orderDate")?.[1];
  const tieDirection = orderDateDirection === 1 ? "ASC" : "DESC";

  return [
    ...databaseEntries,
    ["createdAt", tieDirection],
    ["id", tieDirection],
  ];
};

const getOrderCollectionAmount = (order: Record<string, unknown>): number => {
  return toNumber(order.paymentStatus) === PAYMENT_STATUS.PAID ? 0 : toNumber(order.toBeCollected);
};

const getOrderLineVariant = (lineValue: unknown): Record<string, unknown> => {
  const line = toPlain(lineValue);
  const product = toPlain(line.product);
  const variants = Array.isArray(product.variants) ? product.variants.map((variant) => toPlain(variant)) : [];

  return variants.find((variant) =>
    toText(variant.sku) === toText(line.sku)
    || toText(variant.shopifyId) === toText(line.variant_id)
    || toText(variant.id) === toText(line.variant_id)) ?? {};
};

const getFinancialOrderCost = (order: Record<string, unknown>, orderLines: unknown[]): number => {
  const storedTotalCost = toNumber(order.totalCost);
  if (storedTotalCost > 0) return storedTotalCost;

  return orderLines.reduce<number>((total, lineValue) => {
    const line = toPlain(lineValue);
    const quantity = Math.max(1, toNumber(line.quantity));
    const storedLineCost = toNumber(line.cost);
    if (storedLineCost > 0) return total + storedLineCost;

    const unitCost = toNumber(line.unitCost) || toNumber(getOrderLineVariant(line).cost);
    return total + (unitCost * quantity);
  }, 0);
};

const resolveAggregateScope = (
  filters: OrderListQuery,
  vendorId?: number | null,
): { role: "admin" | "vendor"; scopeId: number } | null => {
  if (vendorId) {
    const requestedVendorIds = parseCsvNumbers(filters.vendorId);
    if (requestedVendorIds.length > 0 && (requestedVendorIds.length !== 1 || requestedVendorIds[0] !== vendorId)) {
      return null;
    }

    return { role: "vendor", scopeId: vendorId };
  }

  const requestedVendorIds = parseCsvNumbers(filters.vendorId);
  if (requestedVendorIds.length === 0) {
    return { role: "admin", scopeId: 0 };
  }

  if (requestedVendorIds.length !== 1) {
    return null;
  }

  return { role: "vendor", scopeId: requestedVendorIds[0] ?? 0 };
};

const canUseAggregateSummary = (filters: OrderListQuery, vendorId?: number | null): boolean => {
  if (!filters.startDate || !filters.endDate) {
    return false;
  }

  if (SUMMARY_AGGREGATE_UNSUPPORTED_FILTERS.some((key) => Boolean(filters[key]))) {
    return false;
  }

  return Boolean(resolveAggregateScope(filters, vendorId));
};

const isValidDate = (value?: string): boolean => {
  if (!value) {
    return false;
  }

  return moment(value).isValid();
};

const clampDayToMonth = (value: moment.Moment, dayOfMonth: number): moment.Moment =>
  value.clone().date(Math.min(dayOfMonth, value.daysInMonth()));

const resolveFinancialCycleRange = (
  billingDayInput?: 13 | 28,
  referenceDateInput?: string,
): {
  billingDay: 13 | 28;
  end: moment.Moment;
  reference: moment.Moment;
  start: moment.Moment;
} => {
  const reference = isValidDate(referenceDateInput)
    ? moment.tz(referenceDateInput, "Africa/Cairo")
    : moment().tz("Africa/Cairo");

  let cycleEnd: moment.Moment;
  if (billingDayInput === 13 || billingDayInput === 28) {
    cycleEnd = clampDayToMonth(reference.clone(), billingDayInput).endOf("day");
  } else if (reference.date() >= 29) {
    cycleEnd = clampDayToMonth(reference.clone(), 28).endOf("day");
  } else if (reference.date() >= 14) {
    cycleEnd = clampDayToMonth(reference.clone(), 13).endOf("day");
  } else {
    cycleEnd = clampDayToMonth(reference.clone().subtract(1, "month"), 28).endOf("day");
  }

  const billingDay = cycleEnd.date() === 13 ? 13 : 28;
  const cycleStart = billingDay === 13
    ? clampDayToMonth(cycleEnd.clone().subtract(1, "month"), 29).startOf("day")
    : clampDayToMonth(cycleEnd.clone(), 14).startOf("day");

  return {
    billingDay,
    end: cycleEnd,
    reference,
    start: cycleStart,
  };
};

const createFinancialSummary = (): OrderFinancialReportSectionSummary => ({
  collectionTotal: 0,
  companyDue: 0,
  fines: 0,
  ordersCount: 0,
  vendorDue: 0,
  vendorShippingCost: 0,
  warehouseCost: 0,
});

const createFinancialRow = (vendorId: number | null, vendorName: string): OrderFinancialReportVendorRow => ({
  collectionTotal: 0,
  companyDue: 0,
  fines: 0,
  orders: [],
  ordersCount: 0,
  vendorDue: 0,
  vendorId,
  vendorName,
  vendorShippingCost: 0,
  warehouseCost: 0,
});

const appendFinancialRow = (
  summary: OrderFinancialReportSectionSummary,
  row: OrderFinancialReportVendorRow,
  values: {
    collectionTotal: number;
    companyDue: number;
    fines: number;
    ordersCount: number;
    vendorDue: number;
    vendorShippingCost: number;
    warehouseCost: number;
  },
): void => {
  summary.collectionTotal += values.collectionTotal;
  summary.companyDue += values.companyDue;
  summary.fines += values.fines;
  summary.ordersCount += values.ordersCount;
  summary.vendorDue += values.vendorDue;
  summary.vendorShippingCost += values.vendorShippingCost;
  summary.warehouseCost += values.warehouseCost;

  row.collectionTotal += values.collectionTotal;
  row.companyDue += values.companyDue;
  row.fines += values.fines;
  row.ordersCount += values.ordersCount;
  row.vendorDue += values.vendorDue;
  row.vendorShippingCost += values.vendorShippingCost;
  row.warehouseCost += values.warehouseCost;
};

const sortFinancialItems = (items: OrderFinancialReportVendorRow[]): OrderFinancialReportVendorRow[] =>
  [...items].sort((left, right) => {
    const salesDifference = right.collectionTotal - left.collectionTotal;
    if (salesDifference !== 0) {
      return salesDifference;
    }

    return left.vendorName.localeCompare(right.vendorName, "ar");
  });

const mapOrderSummary = (value: unknown): OrderListItem => {
  const order = toPlain(value);
  const orderLine = Array.isArray(order.orderLines) ? toPlain(order.orderLines[0]) : {};
  const product = toPlain(orderLine.product);
  const vendor = toPlain(product.vendor);
  const type = toPlain(product.type);
  const user = toPlain(order.user);
  const priority = resolveOrderPriority(order.priority, order.deliveryStatus, order.expectedDeliveryDate);

  return {
    assigneeId: toNumber(order.userId) || null,
    code: toText(order.code),
    customerName: `${toText(toPlain(order.customer).firstName)} ${toText(toPlain(order.customer).lastName)}`.trim(),
    daysSinceOrder: getDaysSince(order.orderDate),
    deliveryBy: toNumber(order.deliveryBy) || null,
    deliveryByLabel: DELIVERY_BY_ARABIC[toNumber(order.deliveryBy) as keyof typeof DELIVERY_BY_ARABIC] ?? "",
    deliveryPriority: priority,
    deliveryPriorityLabel: getDeliveryPriorityLabel(priority),
    deliveryStatus: resolveDeliveryStatus(order.deliveryStatus, order.expectedDeliveryDate),
    priority,
    priorityLabel: getDeliveryPriorityLabel(priority),
    expectedDeliveryDate: toIsoString(order.expectedDeliveryDate),
    fine: toNumber(order.fine),
    id: toNumber(order.id),
    /** تاريخ التصنيع — يُختم فقط عند تحويل حالة الطلب إلى «قيد التصنيع» (order.service.js). */
    poDate: toIsoString(order.PoDate),
    manufactureStatus: toNumber(order.manufactureStatus) || null,
    manufactureStatusLabel: getManufactureLabel(order.manufactureStatus),
    operationNumber: toText(order.code),
    orderSource: toNumber(order.orderSource) || null,
    orderSourceLabel: ORDER_SOURCE_LABELS[toNumber(order.orderSource)] ?? "",
    orderDate: toIsoString(order.orderDate),
    orderNumber: toText(order.orderNumber),
    paymentStatus: toNumber(order.paymentStatus) || null,
    paymentStatusLabel: getPaymentLabel(order.paymentStatus),
    productCode: toText(orderLine.sku),
    productImage: toText(product.image),
    itemType: toText(type.name),
    productName: toText(product.title, toText(orderLine.title)),
    status: toNumber(order.status) || null,
    statusLabel: getStatusLabel(order.status),
    toBeCollected: getOrderCollectionAmount(order),
    totalCost: toNumber(order.totalCost),
    totalPrice: toNumber(order.totalPrice),
    userName: `${toText(user.firstName)} ${toText(user.lastName)}`.trim(),
    vendorId: toNumber(vendor.id) || null,
    vendorName: toText(vendor.name),
  };
};

export class OrderRepository {
  public async findOrderEntity(orderId: number): Promise<unknown | null> {
    return orderModel.findByPk(orderId);
  }

  public async findOrderEntities(orderIds: number[]): Promise<unknown[]> {
    if (orderIds.length === 0) {
      return [];
    }

    return orderModel.findAll({
      where: {
        id: {
          [Op.in]: orderIds,
        },
      },
    });
  }

  public async listOrders(filters: OrderListQuery, vendorId?: number | null): Promise<OrderListResponse> {
    const sortEntries = getOrderSortEntries(filters.sort);

    const result = await orderModel.findAndCountAll({
      distinct: true,
      include: buildOrderListIncludes(),
      limit: filters.size,
      offset: (filters.page - 1) * filters.size,
      order: buildOrderSort(sortEntries),
      subQuery: false,
      where: buildFilters(filters, vendorId),
    });
    const items = result.rows.map((row: unknown) => mapOrderSummary(row));

    return {
      items,
      page: filters.page,
      size: filters.size,
      totalCount: result.count,
    };
  }

  public async getOrderById(orderId: number, vendorId?: number | null): Promise<OrderDetailsResponse | null> {
    const order = await orderModel.findOne({
      include: [
        ...buildIncludes(),
        { as: "notesList", include: [{ as: "user", attributes: ["firstName", "lastName"], model: userModel }, { as: "attachments", model: attachmentModel, required: false }], model: noteModel, required: false },
        { as: "user", attributes: ["firstName", "lastName"], model: userModel, required: false },
      ],
      subQuery: false,
      where: vendorId ? { "$orderLines.product.vendor.id$": vendorId, id: orderId } : { id: orderId },
    });
    if (!order) return null;
    const plainOrder = toPlain(order);
    const summary = mapOrderSummary(order);
    const orderLines = Array.isArray(plainOrder.orderLines) ? plainOrder.orderLines : [];
    const customer = toPlain(plainOrder.customer);
    const notes = Array.isArray(plainOrder.notesList) ? plainOrder.notesList.map((note) => {
      const plainNote = toPlain(note);
      return { attachments: Array.isArray(plainNote.attachments) ? plainNote.attachments.map((attachment) => ({ createdAt: toIsoString(toPlain(attachment).createdAt) ?? "", description: toText(toPlain(attachment).description), id: toNumber(toPlain(attachment).id), name: toText(toPlain(attachment).name), url: toText(toPlain(attachment).url) })) : [], createdAt: toIsoString(plainNote.createdAt) ?? "", id: toNumber(plainNote.id), text: toText(plainNote.text), userName: `${toText(toPlain(plainNote.user).firstName)} ${toText(toPlain(plainNote.user).lastName)}`.trim() };
    }) : [];
    const logs = await logModel.findAll({ order: [["createdAt", "DESC"]], where: { entityId: orderId, entityType: "order" } });
    const usersResult = await userModel.findAll({ attributes: ["firstName", "id", "lastName"], where: { id: { [Op.in]: logs.map((log: unknown) => toNumber(toPlain(log).userId)).filter(Boolean) } } });
    const users = Array.isArray(usersResult) ? usersResult : [];
    const userNames = new Map(users.map((user: unknown) => { const plainUser = toPlain(user); return [toNumber(plainUser.id), `${toText(plainUser.firstName)} ${toText(plainUser.lastName)}`.trim()]; }));
    const vendorIds = logs
      .map((log: unknown) => toPlain(log))
      .filter((log: Record<string, unknown>) => toText(log.field) === "vendorId")
      .flatMap((log: Record<string, unknown>) => [toNumber(log.from), toNumber(log.to)])
      .filter((id: number) => id > 0);
    const vendorsResult = vendorIds.length > 0
      ? await vendorModel.findAll({ attributes: ["id", "name"], where: { id: { [Op.in]: vendorIds } } })
      : [];
    const vendors = Array.isArray(vendorsResult) ? vendorsResult : [];
    const vendorNamesById = Object.fromEntries(vendors.map((vendor: unknown) => {
      const plainVendor = toPlain(vendor);
      return [String(toNumber(plainVendor.id)), toText(plainVendor.name)];
    }));
    const userNamesById = Object.fromEntries(Array.from(userNames.entries()).map(([id, name]) => [String(id), name]));
    const expectedManufacturingDays = orderLines
      .map((line) => {
        const product = toPlain(toPlain(line).product);
        const vendor = toPlain(product.vendor);
        return toNumber(vendor.daysToDeliver);
      })
      .find((value) => value > 0) ?? 0;
    const timeline: OrderTimelineItem[] = logs
      .map((log: unknown): Record<string, unknown> => toPlain(log))
      .filter((log: Record<string, unknown>) => {
        const action = toText(log.action);
        const field = toText(log.field);
        return field === "status"
          || (action === "create" && field === "order_received")
          || (action === "notify" && field === "order_received_notification")
          || action === "delete";
      })
      .map((log: Record<string, unknown>) => {
        const action = toText(log.action);
        const field = toText(log.field);
        const toStatus = toNumber(log.to) || null;
        const userName = toText(userNames.get(toNumber(log.userId)) ?? "");
        const isManufacturingStarted = field === "status" && toStatus === ORDER_STATUS.IN_PROGRESS;

        let eventType = "status_updated";
        if (action === "create" && field === "order_received") {
          eventType = "order_received";
        } else if (action === "notify" && field === "order_received_notification") {
          eventType = "notification_sent";
        } else if (action === "delete") {
          eventType = "order_deleted";
        } else if (isManufacturingStarted) {
          eventType = "manufacturing_started";
        }

        return {
          changedAt: toIsoString(log.createdAt) ?? "",
          description: isManufacturingStarted && expectedManufacturingDays > 0
            ? `المدة المتوقعة ${expectedManufacturingDays} يوم عمل`
            : getHistoryActorLabel(userName),
          eventType,
          fromStatus: toNumber(log.from) || null,
          fromStatusLabel: getStatusLabel(log.from),
          id: toNumber(log.id),
          message: buildLogMessage(log, { userNamesById, vendorNamesById }),
          toStatus,
          toStatusLabel: getStatusLabel(log.to),
          userName,
        };
      });
    const statusLogsAscending = logs
      .map((log: unknown): Record<string, unknown> => toPlain(log))
      .filter((log: Record<string, unknown>) => toText(log.field) === "status")
      .sort((left: Record<string, unknown>, right: Record<string, unknown>) => {
        const leftTime = new Date(toIsoString(left.createdAt) ?? 0).getTime();
        const rightTime = new Date(toIsoString(right.createdAt) ?? 0).getTime();
        return leftTime - rightTime;
      });
    const activeStatusHistory: OrderStatusHistoryItem[] = [];
    const seenStatuses = new Set<number>();
    const currentStatus = toNumber(plainOrder.status) || null;
    const pushStatusHistoryItem = (status: number | null, changedAt: string, id: number, userName: string): void => {
      if (!status || seenStatuses.has(status)) return;
      if (currentStatus && status > currentStatus) return;
      seenStatuses.add(status);
      activeStatusHistory.push({
        changedAt,
        id,
        isActive: true,
        status,
        statusLabel: getStatusLabel(status),
        userName,
      });
    };
    if (statusLogsAscending.length > 0) {
      const firstStatusLog = statusLogsAscending[0];
      pushStatusHistoryItem(
        toNumber(firstStatusLog.from) || null,
        toIsoString(plainOrder.orderDate) ?? toIsoString(firstStatusLog.createdAt) ?? "",
        toNumber(firstStatusLog.id),
        toText(userNames.get(toNumber(firstStatusLog.userId)) ?? ""),
      );
    }
    statusLogsAscending.forEach((log: Record<string, unknown>) => {
      pushStatusHistoryItem(
        toNumber(log.to) || null,
        toIsoString(log.createdAt) ?? "",
        toNumber(log.id),
        toText(userNames.get(toNumber(log.userId)) ?? ""),
      );
    });
    pushStatusHistoryItem(
      currentStatus,
      toIsoString(plainOrder.updatedAt) ?? toIsoString(plainOrder.orderDate) ?? "",
      toNumber(plainOrder.id),
      "",
    );
    if (activeStatusHistory.length === 0) {
      pushStatusHistoryItem(
        currentStatus,
        toIsoString(plainOrder.orderDate) ?? "",
        toNumber(plainOrder.id),
        "",
      );
    }
    const activeStatusByCode = new Map(
      activeStatusHistory.map((item) => [item.status, item]),
    );
    const statusHistory: OrderStatusHistoryItem[] = Object.keys(ORDER_STATUS_LABELS)
      .map(Number)
      .sort((left, right) => left - right)
      .map((status) => {
        const activeItem = activeStatusByCode.get(status);
        return {
          changedAt: activeItem?.changedAt ?? "",
          id: activeItem?.id ?? status,
          isActive: Boolean(activeItem),
          status,
          statusLabel: ORDER_STATUS_LABELS[status] ?? "",
          userName: activeItem?.userName ?? "",
        };
      });

    const view: OrderDetailsView = {
      assigneeId: toNumber(plainOrder.userId) || null,
      assigneeName: `${toText(toPlain(plainOrder.user).firstName)} ${toText(toPlain(plainOrder.user).lastName)}`.trim(),
      customer: {
        address: toText(customer.address),
        email: toText(customer.email),
        id: toNumber(customer.id) || null,
        name: `${toText(customer.firstName)} ${toText(customer.lastName)}`.trim(),
        phoneNumber: toText(customer.phoneNumber),
      },
      financial: { amountToCollect: getOrderCollectionAmount(plainOrder), commission: toNumber(plainOrder.commission), discount: toNumber(plainOrder.totalDiscounts), downPayment: toNumber(plainOrder.downPayment), fine: toNumber(plainOrder.fine), shippingFees: toNumber(plainOrder.shippingFees), subTotalPrice: toNumber(plainOrder.subTotalPrice), totalCost: toNumber(plainOrder.totalCost), totalPrice: toNumber(plainOrder.totalPrice) },
      notes,
      order: {
        ...summary,
        deliveryStatus: summary.deliveryStatus,
        deliveryDate: toIsoString(plainOrder.deliveryDate),
        itemsCount: orderLines.length,
        notes: toText(plainOrder.notes),
        shippedFromInventory: Boolean(plainOrder.shippedFromInventory),
        shipmentType: toText(plainOrder.shipmentType),
      },
      items: orderLines.map((line) => {
        const plainLine = toPlain(line);
        const product = toPlain(plainLine.product);
        const vendor = toPlain(product.vendor);
        const type = toPlain(product.type);
        const variant = getOrderLineVariant(plainLine);

        return {
          color: toText(plainLine.color),
          id: toNumber(plainLine.id),
          image: toText(product.image),
          itemType: toText(type.name),
          material: toText(plainLine.material),
          price: toNumber(plainLine.price),
          productId: toNumber(product.id) || null,
          productName: toText(product.title, toText(plainLine.title)),
          quantity: toNumber(plainLine.quantity),
          size: toText(plainLine.size),
          sku: toText(plainLine.sku),
          typeName: toText(type.name),
          unitCost: toNumber(plainLine.unitCost),
          variant: {
            color: toText(variant.option1, toText(plainLine.color)),
            id: toText(variant.shopifyId, toText(variant.id, toText(plainLine.variant_id))),
            inventoryQuantity: toNumber(variant.inventory_quantity) || null,
            material: toText(variant.option3, toText(plainLine.material)),
            price: toNumber(variant.price),
            size: toText(variant.option2, toText(plainLine.size)),
            sku: toText(variant.sku, toText(plainLine.sku)),
            title: toText(variant.title),
          },
          vendorId: toNumber(vendor.id) || null,
          vendorName: toText(vendor.name),
        };
      }),
      timeline,
      statusHistory,
    };

    return view;
  }

  public async getSummary(filters: OrderListQuery, vendorId?: number | null): Promise<OrderSummaryResponse> {
    const counts = canUseAggregateSummary(filters, vendorId)
      ? await this.getSummaryCountsFromAggregate(filters, vendorId)
      : await this.getSummaryCountsFromOrders(filters, vendorId);

    return { cards: [
      { key: "urgentOrders", label: "مستعجل جدا", value: counts.urgentOrders },
      { key: "canceledOrRefundedOrders", label: "ملغي / مرتجع", value: counts.canceledOrRefundedOrders },
      { key: "deliveredOrders", label: "تم التسليم", value: counts.deliveredOrders },
      { key: "inProgressOrders", label: "قيد التصنيع", value: counts.inProgressOrders },
      { key: "pendingOrders", label: "معلق", value: counts.pendingOrders },
      { key: "totalOrders", label: "إجمالي الطلبات", value: counts.totalOrders },
    ] };
  }

  private async getSummaryCountsFromAggregate(
    filters: OrderListQuery,
    vendorId?: number | null,
  ): Promise<{ canceledOrRefundedOrders: number; deliveredOrders: number; inProgressOrders: number; pendingOrders: number; totalOrders: number; urgentOrders: number }> {
    const scope = resolveAggregateScope(filters, vendorId);
    if (!scope || !filters.startDate || !filters.endDate) {
      return this.getSummaryCountsFromOrders(filters, vendorId);
    }

    const rows = await dashboardDailyMetricModel.findAll({
      where: {
        metricDate: {
          [Op.between]: [filters.startDate.slice(0, 10), filters.endDate.slice(0, 10)],
        },
        role: scope.role,
        scopeId: scope.scopeId,
      },
    });

    const rowByDate = new Map<string, Record<string, unknown>>(
      rows.map((row: { toJSON?: () => Record<string, unknown> }) => {
        const plainRow = toPlain(row);
        return [toText(plainRow.metricDate), plainRow];
      }),
    );

    if (rowByDate.size === 0) {
      return this.getSummaryCountsFromOrders(filters, vendorId);
    }

    const aggregateRows = [...rowByDate.values()];
    const stableCounts = aggregateRows.reduce<{
      canceledOrRefundedOrders: number;
      deliveredOrders: number;
      inProgressOrders: number;
      pendingOrders: number;
      totalOrders: number;
    }>(
      (summary, row) => ({
        canceledOrRefundedOrders: summary.canceledOrRefundedOrders + toNumber(row.canceledOrRefundedOrders),
        deliveredOrders: summary.deliveredOrders + toNumber(row.deliveredOrders),
        inProgressOrders: summary.inProgressOrders + toNumber(row.inProgressOrders),
        pendingOrders: summary.pendingOrders + toNumber(row.pendingOrders),
        totalOrders: summary.totalOrders + toNumber(row.totalOrders),
      }),
      {
        canceledOrRefundedOrders: 0,
        deliveredOrders: 0,
        inProgressOrders: 0,
        pendingOrders: 0,
        totalOrders: 0,
      },
    );

    return {
      ...stableCounts,
      urgentOrders: await this.getUrgentOrdersCount(filters, vendorId),
    };
  }

  /**
   * Counted with a single grouped query.
   *
   * This previously loaded every matching order through the full include tree
   * (order lines -> product -> vendor, customer, notes) just to tally six
   * numbers — around 20s on the live data set.
   *
   * The urgency expression mirrors `resolveOrderPriority`: an explicit priority
   * wins, otherwise it is derived from the expected delivery date. The old code
   * limited `attributes` to status/expectedDeliveryDate, so `priority` was
   * always undefined and the card silently disagreed with the priority shown in
   * the orders list; counting the stored priority makes the two consistent.
   */
  private async getSummaryCountsFromOrders(
    filters: OrderListQuery,
    vendorId?: number | null,
  ): Promise<{ canceledOrRefundedOrders: number; deliveredOrders: number; inProgressOrders: number; pendingOrders: number; totalOrders: number; urgentOrders: number }> {
    const urgentExpression = literal(`(
      CASE WHEN COALESCE("Order"."priority", 0) IN (1, 2, 3)
        THEN "Order"."priority" = ${ORDER_PRIORITY.URGENT}
        ELSE "Order"."expectedDeliveryDate" IS NOT NULL
             AND "Order"."expectedDeliveryDate" < NOW()
      END
    )`);

    const rows = await orderModel.findAll({
      attributes: [
        "status",
        [urgentExpression, "isUrgent"],
        [fn("COUNT", col("Order.id")), "rowCount"],
      ],
      group: ["Order.status", urgentExpression],
      include: buildSummaryIncludes(filters, vendorId),
      raw: true,
      subQuery: false,
      where: buildFilters(filters, vendorId),
    });

    const counts = {
      canceledOrRefundedOrders: 0,
      deliveredOrders: 0,
      inProgressOrders: 0,
      pendingOrders: 0,
      totalOrders: 0,
      urgentOrders: 0,
    };

    for (const row of rows as Array<Record<string, unknown>>) {
      const rowCount = toNumber(row.rowCount);
      const status = toNumber(row.status);
      counts.totalOrders += rowCount;

      if (ORDER_SUMMARY_STATUS_GROUPS.pending.includes(status)) counts.pendingOrders += rowCount;
      if (ORDER_SUMMARY_STATUS_GROUPS.inProgress.includes(status)) counts.inProgressOrders += rowCount;
      if (ORDER_SUMMARY_STATUS_GROUPS.delivered.includes(status)) counts.deliveredOrders += rowCount;
      if (ORDER_SUMMARY_STATUS_GROUPS.canceledOrRefunded.includes(status)) counts.canceledOrRefundedOrders += rowCount;
      if (row.isUrgent === true && !FINAL_ORDER_STATUSES.includes(status)) counts.urgentOrders += rowCount;
    }

    return counts;
  }

  private async getUrgentOrdersCount(filters: OrderListQuery, vendorId?: number | null): Promise<number> {
    const baseWhere = buildFilters(filters, vendorId) as Record<PropertyKey, unknown>;
    const andConditions = Array.isArray(baseWhere[Op.and]) ? [...baseWhere[Op.and] as unknown[]] : [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    andConditions.push(sequelize.where(sequelize.col("Order.expectedDeliveryDate"), { [Op.lt]: today }));
    andConditions.push(sequelize.where(sequelize.col("Order.status"), { [Op.notIn]: FINAL_ORDER_STATUSES }));

    return orderModel.count({
      col: "id",
      distinct: true,
      include: buildIncludes(),
      subQuery: false,
      where: {
        [Op.and]: andConditions,
      },
    });
  }

  public async getMeta(): Promise<OrderMetaResponse> {
    const [vendors, assignees] = await Promise.all([
      vendorModel.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]] }),
      /* «المسؤول» يعني موظفي هوميكس فقط — استبعاد حسابات البائعين (المصانع)
         حتى لا تظهر في فلتر المسؤول، مطابقةً لما يفعله UserService.getAdminUsers. */
      userModel.findAll({
        attributes: ["firstName", "id", "lastName"],
        order: [["firstName", "ASC"]],
        where: { userType: { [Op.not]: USER_TYPES.VENDOR } },
      }),
    ]);
    return {
      assignees: assignees.map((user: unknown) => ({ id: toNumber(toPlain(user).id), label: `${toText(toPlain(user).firstName)} ${toText(toPlain(user).lastName)}`.trim() })),
      deliveryByOptions: Object.entries(DELIVERY_BY).map(([, id]) => ({ id: Number(id), label: DELIVERY_BY_ARABIC[id as keyof typeof DELIVERY_BY_ARABIC] ?? String(id) })),
      manufactureStatuses: Object.entries(MANUFACTURE_STATUS_ARABIC).map(([id, label]) => ({ id: Number(id), label: String(label) })),
      orderSources: Object.entries(ORDER_SOURCE).map(([, id]) => ({ id: Number(id), label: ORDER_SOURCE_LABELS[Number(id)] ?? String(id) })),
      paymentStatuses: Object.entries(PAYMENT_STATUS_ARABIC).map(([id, label]) => ({ id: Number(id), label: String(label) })),
      priorities: [{ id: 1, label: "بالمدة" }, { id: 2, label: "مستعجل" }, { id: 3, label: "مستعجل جدا" }],
      statuses: Object.entries(ORDER_STATUS_Arabic).map(([id, label]) => ({ id: Number(id), label: String(label) })),
      vendors: vendors.map((vendor: unknown) => ({ id: toNumber(toPlain(vendor).id), label: toText(toPlain(vendor).name) })),
    };
  }

  public async getFinancialReport(query: OrderFinancialReportQuery, scopedVendorId?: number | null): Promise<OrderFinancialReportResponse> {
    const hasCustomRange = isValidDate(query.startDate) && isValidDate(query.endDate);
    const cycleRange = hasCustomRange
      ? {
        billingDay: 28 as const,
        end: moment.tz(query.endDate, "Africa/Cairo").endOf("day"),
        reference: isValidDate(query.referenceDate) ? moment.tz(query.referenceDate, "Africa/Cairo") : moment().tz("Africa/Cairo"),
        start: moment.tz(query.startDate, "Africa/Cairo").startOf("day"),
      }
      : resolveFinancialCycleRange(
        query.billingDay === 13 || query.billingDay === 28 ? query.billingDay : undefined,
        query.referenceDate,
      );

    const effectiveVendorId = scopedVendorId ?? (query.vendorId && String(query.vendorId) !== "0" ? Number(query.vendorId) : null);
    const effectiveDeliveryDate = sequelize.fn(
      "coalesce",
      sequelize.col("Order.deliveryDate"),
      sequelize.col("Order.updatedAt"),
    );
    const whereConditions: unknown[] = [
      sequelize.where(effectiveDeliveryDate, { [Op.gte]: cycleRange.start.utc().toDate() }),
      sequelize.where(effectiveDeliveryDate, { [Op.lte]: cycleRange.end.utc().toDate() }),
      sequelize.where(sequelize.col("Order.status"), { [Op.eq]: ORDER_STATUS.DELIVERED }),
    ];

    if (effectiveVendorId) {
      whereConditions.push(
        sequelize.where(sequelize.col("orderLines.product.vendor.id"), {
          [Op.eq]: effectiveVendorId,
        }),
      );
    }

    const orders = await orderModel.findAll({
      include: [
        {
          as: "orderLines",
          include: [
            {
              as: "product",
              include: [{ as: "vendor", model: vendorModel }],
              model: productModel,
              required: true,
            },
          ],
          model: orderLineModel,
          required: true,
        },
      ],
      order: [["deliveryDate", "ASC"], ["id", "ASC"]],
      where: { [Op.and]: whereConditions },
    });

    const fullInvoiceSummary = createFinancialSummary();
    const vendorDeliveriesSummary = createFinancialSummary();
    const warehouseDeliveriesSummary = createFinancialSummary();

    const fullInvoiceRows = new Map<string, OrderFinancialReportVendorRow>();
    const vendorDeliveryRows = new Map<string, OrderFinancialReportVendorRow>();
    const warehouseDeliveryRows = new Map<string, OrderFinancialReportVendorRow>();

    for (const order of orders) {
      const plainOrder = toPlain(order);
      const orderLines = Array.isArray(plainOrder.orderLines) ? plainOrder.orderLines : [];
      const firstLine = orderLines.length > 0 ? toPlain(orderLines[0]) : {};
      const vendor = toPlain(toPlain(firstLine.product).vendor);
      const vendorId = toNumber(vendor.id) || null;
      const vendorName = toText(vendor.name, "غير محدد");
      const vendorShippingCost = Math.max(toNumber(vendor.shippingCost), 0);
      const vendorKey = vendorId ? String(vendorId) : `unknown:${vendorName}`;
      const collectionTotal = toNumber(plainOrder.totalPrice);
      const vendorCollectionTotal = plainOrder.toBeCollected === null
        || plainOrder.toBeCollected === undefined
        || plainOrder.toBeCollected === ""
        ? collectionTotal
        : toNumber(plainOrder.toBeCollected);
      const fines = toNumber(plainOrder.fine);
      const companyCommission = toNumber(plainOrder.commission);
      const vendorDue = Math.max(
        toNumber(plainOrder.totalVendorDue) || (collectionTotal - companyCommission - fines),
        0,
      );
      const companyDue = Math.max(
        toNumber(plainOrder.totalCompanyDue) || companyCommission,
        0,
      );
      const warehouseCost = getFinancialOrderCost(plainOrder, orderLines);
      const paymentStatus = toNumber(plainOrder.paymentStatus) || null;
      const orderId = toNumber(plainOrder.id);
      const productId = toNumber(toPlain(firstLine.product).id) || null;
      const isWarehouseDelivery =
        toNumber(plainOrder.deliveryBy) === DELIVERY_BY.HOMIX
        && toNumber(plainOrder.shipmentStatus) === SHIPMENTS_STATUS.DELIVERED;
      const isVendorDelivery = toNumber(plainOrder.deliveryBy) !== DELIVERY_BY.HOMIX;
      const vendorSettlement = isVendorDelivery
        ? calculateVendorDeliverySettlement({
            collectionTotal: vendorCollectionTotal,
            fines,
            productCost: warehouseCost,
            vendorShippingCost,
          })
        : null;
      const reportCompanyDue = vendorSettlement?.companyDue ?? companyDue;
      const reportVendorDue = vendorSettlement?.vendorDue ?? vendorDue;
      const orderDetail = {
        collectionTotal,
        companyDue: reportCompanyDue,
        fines,
        id: orderId,
        operationNumber: toText(plainOrder.code),
        orderId,
        orderNumber: toText(plainOrder.orderNumber, toText(plainOrder.number, toText(plainOrder.name))),
        paymentStatus,
        paymentStatusLabel: paymentStatus ? PAYMENT_STATUS_ARABIC[paymentStatus as keyof typeof PAYMENT_STATUS_ARABIC] ?? String(paymentStatus) : "",
        productCode: toText(firstLine.sku),
        productId,
        shipmentId: isWarehouseDelivery ? orderId : null,
        vendorDue: reportVendorDue,
        vendorShippingCost,
        warehouseCost,
      };

      const fullRow = fullInvoiceRows.get(vendorKey) ?? createFinancialRow(vendorId, vendorName);
      fullInvoiceRows.set(vendorKey, fullRow);
      appendFinancialRow(fullInvoiceSummary, fullRow, {
        collectionTotal,
        companyDue: reportCompanyDue,
        fines,
        ordersCount: 1,
        vendorDue: reportVendorDue,
        vendorShippingCost: isVendorDelivery ? vendorShippingCost : 0,
        warehouseCost,
      });
      fullRow.orders.push(orderDetail);

      if (isVendorDelivery) {
        const vendorOrderDetail = {
          ...orderDetail,
          collectionTotal: vendorCollectionTotal,
          shipmentId: null,
        };
        const vendorRow = vendorDeliveryRows.get(vendorKey) ?? createFinancialRow(vendorId, vendorName);
        vendorDeliveryRows.set(vendorKey, vendorRow);
        appendFinancialRow(vendorDeliveriesSummary, vendorRow, {
          collectionTotal: vendorCollectionTotal,
          companyDue: reportCompanyDue,
          fines,
          ordersCount: 1,
          vendorDue: reportVendorDue,
          vendorShippingCost,
          warehouseCost,
        });
        vendorRow.orders.push(vendorOrderDetail);
      }

      if (isWarehouseDelivery) {
        const warehouseRow = warehouseDeliveryRows.get(vendorKey) ?? createFinancialRow(vendorId, vendorName);
        warehouseDeliveryRows.set(vendorKey, warehouseRow);
        appendFinancialRow(warehouseDeliveriesSummary, warehouseRow, {
          collectionTotal,
          companyDue,
          fines,
          ordersCount: 1,
          vendorDue,
          // شحن المورد لا ينطبق على التسليم من المخزن
          vendorShippingCost: 0,
          warehouseCost,
        });
        warehouseRow.orders.push(orderDetail);
      }
    }

    const fullInvoice: OrderFinancialReportSection = {
      items: sortFinancialItems([...fullInvoiceRows.values()]),
      summary: fullInvoiceSummary,
    };
    const vendorDeliveries: OrderFinancialReportSection = {
      items: sortFinancialItems([...vendorDeliveryRows.values()]),
      summary: vendorDeliveriesSummary,
    };
    const warehouseDeliveries: OrderFinancialReportSection = {
      items: sortFinancialItems([...warehouseDeliveryRows.values()]),
      summary: warehouseDeliveriesSummary,
    };

    return {
      cycle: {
        billingDay: hasCustomRange
          ? (query.billingDay === 13 || query.billingDay === 28 ? query.billingDay : cycleRange.billingDay)
          : cycleRange.billingDay,
        endDate: cycleRange.end.toISOString(),
        mode: hasCustomRange ? "customRange" : "billingCycle",
        referenceDate: cycleRange.reference.toISOString(),
        startDate: cycleRange.start.toISOString(),
      },
      fullInvoice,
      summary: {
        companyDue: fullInvoice.summary.companyDue,
        fines: fullInvoice.summary.fines,
        totalSales: fullInvoice.summary.collectionTotal,
        vendorDue: fullInvoice.summary.vendorDue,
        vendorsCount: fullInvoice.items.length,
      },
      vendorDeliveries,
      warehouseDeliveries,
    };
  }

  public async createOrderLog(entry: {
    action: string;
    entityId: number;
    entityType: "order";
    field?: string;
    from?: unknown;
    to?: unknown;
    userId: number;
  }): Promise<void> {
    await logModel.create(entry);
  }

  public async deleteOrder(orderId: number): Promise<void> {
    await orderModel.destroy({ where: { id: orderId } });
  }

  public async bulkDelete(orderIds: number[]): Promise<void> {
    await orderModel.destroy({
      where: {
        id: {
          [Op.in]: orderIds,
        },
      },
    });
  }

  public async findNoteById(noteId: number): Promise<unknown | null> {
    return noteModel.findByPk(noteId);
  }

  public async createOrderNote(orderId: number, userId: number, text: string): Promise<unknown> {
    return noteModel.create({
      entityId: orderId,
      entityType: "order",
      text,
      userId,
    });
  }

  public async updateOrderNote(noteId: number, text: string): Promise<unknown> {
    const note = await noteModel.findByPk(noteId);
    if (!note) return null;
    note.text = text;
    await note.save();
    return note;
  }

  public async deleteOrderNote(noteId: number): Promise<void> {
    await noteModel.destroy({ where: { id: noteId } });
  }

  public async createNoteAttachments(
    noteId: number,
    filePaths: string[],
    fileNames: string[],
    descriptions: string[],
  ): Promise<void> {
    for (let index = 0; index < filePaths.length; index += 1) {
      await attachmentModel.create({
        description: descriptions[index] || "",
        modelId: noteId,
        modelType: "Note",
        name: fileNames[index],
        url: filePaths[index],
      });
    }
  }
}
