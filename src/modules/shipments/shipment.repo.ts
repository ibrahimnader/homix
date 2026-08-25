import { Op, QueryTypes, fn, col, where } from "sequelize";

import { sequelize } from "../../infrastructure/database";
import { ConflictError, NotFoundError } from "../../shared/errors";
import { buildLogMessage } from "../orders/order.helpers";
import {
  getManagedOptionLabels,
  listManagedOptions,
  MANAGED_OPTION_GROUP,
  replaceManagedOptions,
  type ManagedOptionValue,
} from "../settings/managed-options";
import { DELIVERY_BY, ORDER_SOURCE_ARABIC, ORDER_SOURCE, ORDER_STATUS, PAYMENT_STATUS, SHIPMENT_SCHEDULE_STATUS_ARABIC, USER_TYPES } from "../../../config/constants";
import {
  ACCOUNTING_STATUS,
  ACCOUNT_STATUS_LABELS,
  CUSTOMER_RETURN_FINAL_STATUSES,
  DEFAULT_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
  DELIVERY_BY_LABELS,
  CUSTOMER_RETURN_STATUS,
  EXPENSE_TYPE_LABELS,
  EXPENSE_STATUS_LABELS,
  GOVERNORATE_LABELS,
  INVENTORY_STATUS,
  INVENTORY_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  RETURN_TO_VENDOR_FINAL_STATUSES,
  RETURN_TO_VENDOR_STATUS,
  RETURN_TO_VENDOR_STATUS_LABELS,
  SHIPMENT_SCHEDULE_STATUS_LABELS,
  SHIPMENT_PRIORITY_LABELS,
  CUSTOMER_RETURN_STATUS_LABELS,
  SHIPMENT_STATUS,
  SHIPMENT_RETURN_TYPE,
  SHIPMENT_RETURN_TYPE_LABELS,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_TYPE_LABELS,
} from "./shipment.constants";
import {
  buildShipmentNumber,
  buildUserName,
  SHIPMENT_NUMBER_PREFIX,
  getDaysBetween,
  getShipmentAgingDays,
  getShipmentPriorityLabel,
  resolveShipmentDeliveryStatus,
  resolveShipmentPriority,
  getShipmentStatusLabel,
  getShipmentTypeLabel,
  getVariantBySku,
  normalizeOperationCode,
  toDateRangeBoundary,
  toIsoString,
  toNullableNumber,
  toNumber,
  toPlain,
  toText,
} from "./shipment.helpers";
import { applyOrderLinesToInventory } from "./inventory.movements";
import type {
  DeliveryAccountItem,
  DeliveryAccountsListQuery,
  DeliveryAccountsListResponse,
  ExpenseAccountItem,
  ExpenseMutationInput,
  ExpenseAccountsListQuery,
  ExpenseAccountsListResponse,
  InventoryItem,
  InventoryMutationInput,
  InventoryListQuery,
  InventoryListResponse,
  PerformanceQuery,
  PerformanceResponse,
  ReturnItem,
  ReturnListQuery,
  ReturnListResponse,
  ReturnMutationInput,
  ShipmentDetailsResponse,
  ShipmentListItem,
  ShipmentListQuery,
  ShipmentListResponse,
  ShipmentMetaResponse,
  ShipmentNote,
  ShippingCompanyItem,
  ShippingCompanyListResponse,
  ShippingCompanyMutationInput,
  ShipmentSummaryResponse,
} from "./shipment.types";

const orderModel = require("../../../app/modules/order/order.model");
const orderLineModel = require("../../../app/modules/orderLines/orderline.model");
const productModel = require("../../../app/modules/product/product.model");
const vendorModel = require("../../../app/modules/vendor/vendor.model");
const customerModel = require("../../../app/modules/customer/customer.model");
const noteModel = require("../../../app/modules/notes/notes.model");
const userModel = require("../../../app/modules/user/user.model");
const logModel = require("../../../app/modules/logs/log.model");
const productTypeModel = require("../../../app/modules/product/productType.model");
const shipmentInventoryModel = require("../../../app/modules/shipments/shipmentInventory.model");

const shipmentExpenseModel = require("../../../app/modules/shipments/shipmentExpense.model");
const shipmentReturnModel = require("../../../app/modules/shipments/shipmentReturn.model");
const shippingCompanyModel = require("../../../app/modules/shipments/shippingCompany.model");
const ORDER_SOURCE_LABELS = ORDER_SOURCE_ARABIC as Record<number, string>;
const SHIPMENT_SCHEDULE_LABELS = SHIPMENT_SCHEDULE_STATUS_ARABIC as Record<number, string>;
const SHIPMENT_SORTABLE_FIELDS = ["orderDate", "priority", "subTotalPrice", "totalPrice"] as const;

/** governorate is stored as free text on newer rows but as the numeric id on
 * older ones (and on rows written by the bulk-edit filter, which needs the id
 * to match) — resolve either shape to its Arabic name for display. */
const resolveGovernorateDisplayLabel = (value: unknown): string => {
  const text = toText(value);
  if (!text) return "";
  return GOVERNORATE_LABELS[Number(text)] ?? text;
};

/**
 * A shipment record is just the order's own row, so its shipmentStatus and the
 * order's lifecycle status are two different fields that can drift apart. These
 * three shipment statuses are meant to be authoritative over the order's status —
 * moving a shipment to one of them carries the order's status along with it.
 */
const ORDER_STATUS_BY_SHIPMENT_STATUS: Partial<Record<number, number>> = {
  [SHIPMENT_STATUS.DELIVERED]: ORDER_STATUS.DELIVERED,
  [SHIPMENT_STATUS.IN_WAREHOUSE]: ORDER_STATUS.IN_INVENTORY,
  [SHIPMENT_STATUS.CANCELED]: ORDER_STATUS.CANCELED,
};

const logOrderFieldChange = async (
  orderId: number,
  fromStatus: unknown,
  toStatus: unknown,
  userId?: number,
  field: string = "shipmentStatus",
): Promise<void> => {
  const from = toNullableNumber(fromStatus);
  const to = toNullableNumber(toStatus);
  if (from === to) {
    return;
  }

  await logModel.create({
    action: "update",
    entityId: orderId,
    entityType: "order",
    field,
    from: from === null ? null : String(from),
    to: to === null ? null : String(to),
    userId: userId ?? null,
  });
};

type ShipmentSortField = (typeof SHIPMENT_SORTABLE_FIELDS)[number];
type ShipmentSortDirection = 1 | -1;
type ShipmentSortEntry = [ShipmentSortField, ShipmentSortDirection];

const getShipmentCollectionAmount = (order: Record<string, unknown>): number => (
  toNumber(order.paymentStatus) === PAYMENT_STATUS.PAID ? 0 : toNumber(order.toBeCollected || order.totalPrice)
);

/** deliveryBy is authoritative; the second branch keeps pre-migration shipments visible. */
const buildHomixShipmentScope = (): Record<PropertyKey, unknown> => ({
  [Op.or]: [
    { deliveryBy: DELIVERY_BY.HOMIX },
    { deliveryBy: null, shippedFromInventory: true },
  ],
});

const buildInventoryItem = (inventoryValue: unknown): InventoryItem => {
  const inventory = toPlain(inventoryValue);
  const product = toPlain(inventory.product);
  const vendor = toPlain(product.vendor);
  const productCode = toText(inventory.productCode);
  const variant = getVariantBySku(product.variants, productCode);
  const status = toNumber(inventory.status) || INVENTORY_STATUS.IN_STOCK;

  return {
    color: toText(inventory.color, toText(variant?.option2)),
    costPrice: toNumber(inventory.costPrice),
    id: toNumber(inventory.id),
    image: toText(product.image),
    productCode,
    productId: toNullableNumber(inventory.productId),
    productName: toText(product.title, toText(inventory.productName)),
    quantity: toNumber(inventory.quantity),
    size: toText(inventory.size, toText(variant?.option1)),
    status,
    statusLabel: INVENTORY_STATUS_LABELS[status] ?? String(status),
    vendorId: toNullableNumber(product.vendorId ?? inventory.vendorId),
    vendorName: toText(vendor.name, toText(inventory.vendorName)),
  };
};

const buildShipmentWhereClause = (
  filters: Omit<ShipmentListQuery, "page" | "size">,
  vendorId?: number | null,
): Record<string, unknown> => {
  const andConditions: unknown[] = [buildHomixShipmentScope()];

  if (vendorId) {
    andConditions.push(where(col("orderLines.product.vendor.id"), { [Op.eq]: vendorId }));
  }

  if (filters.operationCode) {
    andConditions.push(where(fn("lower", col("Order.code")), { [Op.like]: `%${filters.operationCode.toLowerCase()}%` }));
  }

  if (filters.orderNumber) {
    andConditions.push({
      [Op.or]: [
        where(fn("lower", col("Order.name")), { [Op.like]: `%${filters.orderNumber.toLowerCase()}%` }),
        where(fn("lower", col("Order.number")), { [Op.like]: `%${filters.orderNumber.toLowerCase()}%` }),
        where(fn("lower", col("Order.orderNumber")), { [Op.like]: `%${filters.orderNumber.toLowerCase()}%` }),
      ],
    });
  }

  // Shipment numbers are derived (SH + order number), so the filter is applied
  // against the order number with the SH prefix stripped off.
  if (filters.shipmentNumber) {
    const orderNumberPart = filters.shipmentNumber
      .trim()
      .replace(new RegExp(`^${SHIPMENT_NUMBER_PREFIX}`, "i"), "")
      .toLowerCase();

    if (orderNumberPart) {
      andConditions.push({
        [Op.or]: [
          where(fn("lower", col("Order.name")), { [Op.like]: `%${orderNumberPart}%` }),
          where(fn("lower", col("Order.number")), { [Op.like]: `%${orderNumberPart}%` }),
          where(fn("lower", col("Order.orderNumber")), { [Op.like]: `%${orderNumberPart}%` }),
        ],
      });
    }
  }

  if (filters.orderSource) {
    andConditions.push(where(col("Order.orderSource"), {
      [Op.in]: filters.orderSource.split(",").map(Number),
    }));
  }

  if (filters.customerName) {
    andConditions.push(where(fn("lower", fn("concat", col("customer.firstName"), " ", col("customer.lastName"))), {
      [Op.like]: `%${filters.customerName.toLowerCase()}%`,
    }));
  }

  if (filters.customerPhone) {
    andConditions.push(where(col("customer.phoneNumber"), { [Op.like]: `%${filters.customerPhone}%` }));
  }

  if (filters.vendorName) {
    andConditions.push(where(fn("lower", col("orderLines.product.vendor.name")), { [Op.like]: `%${filters.vendorName.toLowerCase()}%` }));
  }

  if (filters.shipmentStatus) {
    andConditions.push(where(col("Order.shipmentStatus"), {
      [Op.in]: filters.shipmentStatus.split(",").map(Number),
    }));
  }

  if (filters.scheduleStatus) {
    const tokens = filters.scheduleStatus.split(",").map((value) => value.trim()).filter(Boolean);
    const statuses = tokens
      .filter((value) => value !== "__blank__")
      .map(Number)
      .filter(Number.isFinite);
    const scheduleConditions: unknown[] = [];
    if (statuses.length > 0) {
      scheduleConditions.push(where(col("Order.scheduleStatus"), { [Op.in]: statuses }));
    }
    if (tokens.includes("__blank__")) {
      scheduleConditions.push(where(col("Order.scheduleStatus"), { [Op.is]: null }));
    }
    if (scheduleConditions.length === 1) {
      andConditions.push(scheduleConditions[0]);
    } else if (scheduleConditions.length > 1) {
      andConditions.push({ [Op.or]: scheduleConditions });
    }
  }

  if (filters.shipmentType) {
    andConditions.push(where(fn("lower", col("Order.shipmentType")), {
      [Op.in]: filters.shipmentType.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
    }));
  }

  if (filters.paymentStatus) {
    andConditions.push(where(col("Order.paymentStatus"), {
      [Op.in]: filters.paymentStatus.split(",").map(Number),
    }));
  }

  if (filters.priority) {
    andConditions.push(where(col("Order.priority"), {
      [Op.in]: filters.priority.split(",").map(Number),
    }));
  }

  if (filters.deliveryBy) {
    andConditions.push(where(col("Order.deliveryBy"), { [Op.in]: filters.deliveryBy.split(",").map(Number) }));
  }

  if (filters.governorate) {
    /* governorate is stored as free text on newer rows but as the numeric id
       on older ones (see resolveGovernorateLabel), so a selected id has to
       match either representation. */
    const tokens = filters.governorate.split(",").map((value) => value.trim()).filter(Boolean);
    const ids = tokens.filter((value) => value !== "__blank__").map(Number).filter(Number.isFinite);
    const values = ids.flatMap((id) => [String(id), GOVERNORATE_LABELS[id]]).filter(Boolean) as string[];
    const governorateConditions: unknown[] = [];
    if (values.length > 0) {
      governorateConditions.push(where(col("Order.governorate"), { [Op.in]: values }));
    }
    if (tokens.includes("__blank__")) {
      governorateConditions.push(
        where(col("Order.governorate"), { [Op.is]: null }),
        where(col("Order.governorate"), { [Op.eq]: "" }),
      );
    }
    if (governorateConditions.length === 1) {
      andConditions.push(governorateConditions[0]);
    } else if (governorateConditions.length > 1) {
      andConditions.push({ [Op.or]: governorateConditions });
    }
  }

  if (filters.shippingCompany) {
    andConditions.push(where(col("shippingCompanyRecord.id"), {
      [Op.in]: filters.shippingCompany.split(",").map(Number).filter(Number.isFinite),
    }));
  }

  if (filters.deliveryStatus) {
    const statuses = filters.deliveryStatus.split(",").map(Number).filter((status) => [1, 2, 3].includes(status));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const almostDueDate = new Date(today);
    almostDueDate.setDate(almostDueDate.getDate() + 2);
    const deliveryConditions: Array<Record<PropertyKey, unknown>> = [];
    if (statuses.includes(1)) deliveryConditions.push({ expectedDeliveryDate: { [Op.gte]: almostDueDate } });
    if (statuses.includes(2)) deliveryConditions.push({ expectedDeliveryDate: { [Op.gte]: today, [Op.lt]: almostDueDate } });
    if (statuses.includes(3)) deliveryConditions.push({ expectedDeliveryDate: { [Op.lt]: today } });
    deliveryConditions.push({ deliveryStatus: { [Op.in]: statuses }, expectedDeliveryDate: null });
    andConditions.push({ [Op.or]: deliveryConditions });
  }

  if (filters.startDate) {
    const startDate = toDateRangeBoundary(filters.startDate, "start");
    if (startDate) {
      andConditions.push(where(col("Order.shippingReceiveDate"), { [Op.gte]: startDate }));
    }
  }

  if (filters.endDate) {
    const endDate = toDateRangeBoundary(filters.endDate, "end");
    if (endDate) {
      andConditions.push(where(col("Order.shippingReceiveDate"), { [Op.lte]: endDate }));
    }
  }

  if (filters.deliveryDateFrom) {
    const deliveryDateFrom = toDateRangeBoundary(filters.deliveryDateFrom, "start");
    if (deliveryDateFrom) {
      andConditions.push(where(col("Order.deliveryDate"), { [Op.gte]: deliveryDateFrom }));
    }
  }

  if (filters.deliveryDateTo) {
    const deliveryDateTo = toDateRangeBoundary(filters.deliveryDateTo, "end");
    if (deliveryDateTo) {
      andConditions.push(where(col("Order.deliveryDate"), { [Op.lte]: deliveryDateTo }));
    }
  }

  if (filters.scheduledDateFrom) {
    const scheduledDateFrom = toDateRangeBoundary(filters.scheduledDateFrom, "start");
    if (scheduledDateFrom) {
      andConditions.push(where(col("Order.scheduledDeliveryDate"), { [Op.gte]: scheduledDateFrom }));
    }
  }

  if (filters.scheduledDateTo) {
    const scheduledDateTo = toDateRangeBoundary(filters.scheduledDateTo, "end");
    if (scheduledDateTo) {
      andConditions.push(where(col("Order.scheduledDeliveryDate"), { [Op.lte]: scheduledDateTo }));
    }
  }

  return andConditions.length > 0 ? { [Op.and]: andConditions } : {};
};

/**
 * The summary only groups and counts, so it joins the bare minimum: the vendor
 * chain when a vendor filter is set, the customer when a customer filter is set,
 * and nothing otherwise. `required: true` keeps the joins from multiplying rows.
 */
const buildSummaryIncludes = (filters: Omit<ShipmentListQuery, "page" | "size">) => {
  const includes: Record<string, unknown>[] = [];

  if (filters.vendorName) {
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

  if (filters.customerName || filters.customerPhone) {
    includes.push({ as: "customer", attributes: [], model: customerModel, required: true });
  }

  if (filters.shippingCompany) {
    includes.push({ as: "shippingCompanyRecord", attributes: [], model: shippingCompanyModel, required: true });
  }

  return includes;
};

const buildIncludes = () => [
  {
    as: "orderLines",
    include: [
      {
        as: "product",
        include: [
          { as: "vendor", model: vendorModel, required: false },
          { as: "type", model: productTypeModel, required: false },
        ],
        model: productModel,
        required: false,
      },
    ],
    model: orderLineModel,
    required: false,
  },
  {
    as: "shippingCompanyRecord",
    attributes: ["id", "name"],
    model: shippingCompanyModel,
    required: false,
  },
  {
    as: "customer",
    model: customerModel,
    required: false,
  },
  {
    as: "notesList",
    include: [
      {
        as: "user",
        attributes: ["firstName", "lastName"],
        model: userModel,
        required: false,
      },
    ],
    model: noteModel,
    required: false,
  },
  {
    as: "user",
    attributes: ["firstName", "lastName"],
    model: userModel,
    required: false,
  },
];

/** Keep list requests small; details/returns still use the complete include tree. */
const buildShipmentListIncludes = () => [
  {
    as: "orderLines",
    attributes: ["id", "orderId", "productId", "sku"],
    include: [{
      as: "product",
      attributes: ["id", "vendorId"],
      include: [{ as: "vendor", attributes: ["id", "name"], model: vendorModel, required: false }],
      model: productModel,
      required: false,
    }],
    model: orderLineModel,
    required: false,
  },
  {
    as: "shippingCompanyRecord",
    attributes: ["id", "name"],
    model: shippingCompanyModel,
    required: false,
  },
  {
    as: "customer",
    attributes: ["id", "firstName", "lastName", "phoneNumber"],
    model: customerModel,
    required: false,
  },
];

const mapShipmentListItem = (orderValue: unknown): ShipmentListItem => {
  const order = toPlain(orderValue);
  const orderLines = Array.isArray(order.orderLines) ? order.orderLines.map((line) => toPlain(line)) : [];
  const firstLine = orderLines[0] ?? {};
  const product = toPlain(firstLine.product);
  const vendor = toPlain(product.vendor);
  const customer = toPlain(order.customer);
  const shippingCompanyRecord = toPlain(order.shippingCompanyRecord);
  const deliveryBy = toNullableNumber(order.deliveryBy);
  const shippingCompanyName = toText(shippingCompanyRecord.name, toText(order.shippingCompany));
  const deliveryStatus = resolveShipmentDeliveryStatus(order.deliveryStatus, order.expectedDeliveryDate);
  const deliveryPriority = resolveShipmentPriority(order.priority, order.deliveryStatus, order.expectedDeliveryDate);

  return {
    assigneeId: toNullableNumber(order.userId),
    amountToCollect: getShipmentCollectionAmount(order),
    customerName: `${toText(customer.firstName)} ${toText(customer.lastName)}`.trim(),
    customerPhone: toText(customer.phoneNumber),
    daysCounter: getShipmentAgingDays(order.shipmentStatus, order.shippingReceiveDate, order.deliveryDate, order.updatedAt),
    deliveryBy,
    deliveryByLabel: deliveryBy ? DELIVERY_BY_LABELS[deliveryBy] ?? String(deliveryBy) : "",
    deliveryPriority,
    deliveryPriorityLabel: getShipmentPriorityLabel(deliveryPriority),
    deliveryStatus,
    priority: deliveryPriority,
    priorityLabel: getShipmentPriorityLabel(deliveryPriority),
    deliveryDate: toIsoString(order.deliveryDate),
    governorate: resolveGovernorateDisplayLabel(order.governorate),
    id: toNumber(order.id),
    operationNumber: normalizeOperationCode(order.code),
    orderSource: toNullableNumber(order.orderSource),
    orderSourceLabel: ORDER_SOURCE_LABELS[toNumber(order.orderSource)] ?? "",
    orderNumber: toText(order.orderNumber, toText(order.number, toText(order.name))),
    paymentStatus: toNullableNumber(order.paymentStatus),
    paymentStatusLabel: PAYMENT_STATUS_LABELS[toNumber(order.paymentStatus)] ?? "",
    receivedInWarehouseDate: toIsoString(order.shippingReceiveDate),
    scheduledDeliveryDate: toIsoString(order.scheduledDeliveryDate),
    scheduleStatus: toNullableNumber(order.scheduleStatus),
    scheduleStatusLabel: SHIPMENT_SCHEDULE_LABELS[toNumber(order.scheduleStatus)] ?? "",
    sellerName: toText(vendor.name),
    shippingCompany: toNullableNumber(shippingCompanyRecord.id),
    shippingCompanyName,
    shipmentNumber: buildShipmentNumber(order),
    shipmentStatus: toNullableNumber(order.shipmentStatus),
    shipmentStatusLabel: getShipmentStatusLabel(order.shipmentStatus),
    shipmentType: toText(order.shipmentType),
    shipmentTypeLabel: getShipmentTypeLabel(order.shipmentType),
    shippingCost: toNumber(order.shippingFees),
  };
};

const matchesShipmentPriority = (item: ShipmentListItem, priorityFilter?: string): boolean => {
  if (!priorityFilter) {
    return true;
  }

  return priorityFilter
    .split(",")
    .map((value) => Number(value.trim()))
    .includes(item.deliveryPriority ?? 0);
};

const matchesShipmentDeliveryStatus = (item: ShipmentListItem, deliveryStatusFilter?: string): boolean => {
  if (!deliveryStatusFilter) {
    return true;
  }

  return deliveryStatusFilter
    .split(",")
    .map((value) => Number(value.trim()))
    .includes(item.deliveryStatus ?? 0);
};

const getShipmentSortEntries = (sort?: ShipmentListQuery["sort"]): ShipmentSortEntry[] => {
  if (!sort) {
    return [];
  }

  return SHIPMENT_SORTABLE_FIELDS.flatMap((field) => {
    const direction = sort[field];
    return direction === 1 || direction === -1 ? [[field, direction] satisfies ShipmentSortEntry] : [];
  });
};

const getShipmentSortValue = (
  field: ShipmentSortField,
  entry: { item: ShipmentListItem; row: Record<string, unknown> },
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

const compareShipmentEntries = (
  left: { item: ShipmentListItem; row: Record<string, unknown> },
  right: { item: ShipmentListItem; row: Record<string, unknown> },
  sortEntries: ShipmentSortEntry[],
): number => {
  for (const [field, direction] of sortEntries) {
    const leftValue = getShipmentSortValue(field, left);
    const rightValue = getShipmentSortValue(field, right);
    if (leftValue === rightValue) {
      continue;
    }

    return direction === -1 ? rightValue - leftValue : leftValue - rightValue;
  }

  return right.item.id - left.item.id;
};

const buildShipmentSort = (sortEntries: ShipmentSortEntry[]): Array<[string, "ASC" | "DESC"]> => {
  const databaseEntries = sortEntries
    .map(([field, direction]) => [field, direction === -1 ? "DESC" : "ASC"] as [string, "ASC" | "DESC"]);

  return databaseEntries.length > 0 ? databaseEntries : [["createdAt", "DESC"]];
};

const mapShipmentNote = (noteValue: unknown) => {
  const note = toPlain(noteValue);
  return {
    createdAt: toIsoString(note.createdAt) ?? "",
    id: toNumber(note.id),
    text: toText(note.text),
    userName: buildUserName(note.user),
  } satisfies ShipmentNote;
};

const mapTimeline = (
  logs: unknown[],
  userNamesById: Record<string, string> = {},
  vendorNamesById: Record<string, string> = {},
  shippingCompanyNamesById: Record<string, string> = {},
) =>
  logs.map((logValue) => {
    const log = toPlain(logValue);
    const userName = userNamesById[String(toNumber(log.userId))] ?? "";
    return {
      changedAt: toIsoString(log.createdAt) ?? "",
      id: toNumber(log.id),
      message: buildLogMessage(log, { shippingCompanyNamesById, userNamesById, vendorNamesById }),
      userName,
    };
  });

const getFallbackReturnStatus = (returnType: number): number => {
  return returnType === SHIPMENT_RETURN_TYPE.TO_VENDOR
    ? RETURN_TO_VENDOR_STATUS.VENDOR_NOTIFIED
    : CUSTOMER_RETURN_STATUS.PICKED_UP;
};

const getShipmentStatusForReturnType = (returnType: number): number => {
  return returnType === SHIPMENT_RETURN_TYPE.TO_VENDOR
    ? SHIPMENT_STATUS.RETURNED_TO_VENDOR
    : SHIPMENT_STATUS.RETURNED_FROM_CUSTOMER;
};

const getReturnStatusLabel = (returnType: number, status: number): string => {
  if (returnType === SHIPMENT_RETURN_TYPE.TO_VENDOR) {
    return RETURN_TO_VENDOR_STATUS_LABELS[status] ?? String(status);
  }

  return CUSTOMER_RETURN_STATUS_LABELS[status] ?? String(status);
};

const isFinalReturnStatus = (returnType: number, status: number): boolean => {
  return returnType === SHIPMENT_RETURN_TYPE.TO_VENDOR
    ? RETURN_TO_VENDOR_FINAL_STATUSES.includes(status as never)
    : CUSTOMER_RETURN_FINAL_STATUSES.includes(status as never);
};

/** Both return kinds have their own "forfeit" id. */
const isForfeitReturnStatus = (returnType: number, status: unknown): boolean => {
  const statusId = toNumber(status);
  return returnType === SHIPMENT_RETURN_TYPE.TO_VENDOR
    ? statusId === RETURN_TO_VENDOR_STATUS.FORFEIT
    : statusId === CUSTOMER_RETURN_STATUS.FORFEIT;
};

/** Maps an order's lines onto inventory movement targets. */
const getShipmentInventoryTargets = (plainOrder: Record<string, unknown>) => {
  const lines = Array.isArray(plainOrder.orderLines) ? plainOrder.orderLines : [];

  return lines.map((lineValue) => {
    const line = toPlain(lineValue);
    const product = toPlain(line.product);

    return {
      productCode: toText(line.sku),
      productId: toNullableNumber(product.id ?? line.productId),
      quantity: toNumber(line.quantity) || 1,
    };
  });
};

const shouldAutoForfeitVendorReturn = (returnValue: unknown): boolean => {
  const plainReturn = toPlain(returnValue);
  if (toNumber(plainReturn.returnType) !== SHIPMENT_RETURN_TYPE.TO_VENDOR) {
    return false;
  }

  if (toNumber(plainReturn.status) !== RETURN_TO_VENDOR_STATUS.VENDOR_NOTIFIED) {
    return false;
  }

  const daysCounter = getDaysBetween(plainReturn.startedAt ?? plainReturn.returnDate, undefined);
  return (daysCounter ?? 0) >= 12;
};

const mapShippingCompanyItem = (companyValue: unknown): ShippingCompanyItem => {
  const company = toPlain(companyValue);

  return {
    createdAt: toIsoString(company.createdAt) ?? "",
    id: toNumber(company.id),
    linkedOrdersCount: toNumber(company.linkedOrdersCount),
    name: toText(company.name),
    updatedAt: toIsoString(company.updatedAt) ?? "",
  };
};

export class ShipmentRepository {
  public async findShipmentEntity(shipmentId: number): Promise<unknown | null> {
    return orderModel.findByPk(shipmentId);
  }

  public async findReturnById(orderId: number, returnType?: number): Promise<unknown | null> {
    if (returnType !== undefined) {
      return shipmentReturnModel.findOne({ where: { orderId, returnType } });
    }
    return shipmentReturnModel.findOne({ where: { orderId } });
  }

  public async findShippingCompanyById(shippingCompanyId: number): Promise<unknown | null> {
    return shippingCompanyModel.findByPk(shippingCompanyId);
  }

  public async normalizeShippingCompanyPayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const nextPayload = { ...payload };
    const rawShippingCompany = nextPayload.shippingCompany;
    const normalizedShippingCompanyId = rawShippingCompany === undefined || rawShippingCompany === ""
      ? null
      : toNullableNumber(rawShippingCompany);

    if (normalizedShippingCompanyId) {
      const company = await this.findShippingCompanyById(normalizedShippingCompanyId);
      if (!company) {
        throw new NotFoundError("Shipping company not found");
      }

      const plainCompany = toPlain(company);
      nextPayload.shippingCompany = toText(plainCompany.name);
      return nextPayload;
    }

    if (rawShippingCompany === null || rawShippingCompany === "") {
      nextPayload.shippingCompany = null;
    }

    return nextPayload;
  }

  /**
   * Meta is fetched on every tab, so it must be cheap.
   *
   * The three tab counts used to be three sequential COUNT queries over the
   * orders table, followed by the shipping companies — four round trips to a
   * remote database for one small payload (~1.3s). They are now one grouped
   * count plus the remaining lookups issued in parallel.
   */
  public async getMeta(): Promise<ShipmentMetaResponse> {
    const [statusCountRows, shippingCompanies, inventoryCount, expensesCount, expenseTypes, assignees] = await Promise.all([
      orderModel.findAll({
        attributes: ["shipmentStatus", [fn("COUNT", col("Order.id")), "rowCount"]],
        group: ["Order.shipmentStatus"],
        raw: true,
        where: buildHomixShipmentScope(),
      }),
      shippingCompanyModel.findAll({ order: [["name", "ASC"]] }),
      shipmentInventoryModel.count(),
      shipmentExpenseModel.count(),
      listManagedOptions(MANAGED_OPTION_GROUP.EXPENSE_TYPE),
      /* «المسؤول» يعني موظفي هوميكس فقط — استبعاد حسابات البائعين، ومصدرها الـ
         meta لا /users حتى تعمل لأي دور يرى الشحنات أصلاً (orders.repo.getMeta
         يطبّق نفس المنطق لنفس السبب). */
      userModel.findAll({
        attributes: ["firstName", "id", "lastName"],
        order: [["firstName", "ASC"]],
        where: { userType: { [Op.not]: USER_TYPES.VENDOR } },
      }),
    ]);

    let shipmentsCount = 0;
    let returnsToVendorCount = 0;
    let returnsFromCustomerCount = 0;
    let deliveredCount = 0;

    for (const row of statusCountRows as Array<Record<string, unknown>>) {
      const rowCount = toNumber(row.rowCount);
      const shipmentStatus = toNumber(row.shipmentStatus);
      shipmentsCount += rowCount;

      if (shipmentStatus === SHIPMENT_STATUS.RETURNED_TO_VENDOR) returnsToVendorCount += rowCount;
      if (shipmentStatus === SHIPMENT_STATUS.RETURNED_FROM_CUSTOMER) returnsFromCustomerCount += rowCount;
      if (shipmentStatus === SHIPMENT_STATUS.DELIVERED) deliveredCount += rowCount;
    }

    return {
      deliveryByOptions: Object.entries(DELIVERY_BY_LABELS).map(([id, label]) => ({ id: Number(id), label })),
      accountingStatuses: Object.entries(ACCOUNT_STATUS_LABELS).map(([id, label]) => ({ id: Number(id), label })),
      assignees: assignees.map((user: unknown) => {
        const plainUser = toPlain(user);
        return { id: toNumber(plainUser.id), label: `${toText(plainUser.firstName)} ${toText(plainUser.lastName)}`.trim() };
      }),
      customerReturnStatuses: Object.entries(CUSTOMER_RETURN_STATUS_LABELS).map(([id, label]) => ({ id: Number(id), label })),
      expenseTypes,
      governorates: Object.entries(GOVERNORATE_LABELS).map(([id, label]) => ({ id: Number(id), label })),
      inventoryStatuses: Object.entries(INVENTORY_STATUS_LABELS).map(([id, label]) => ({ id: Number(id), label })),
      orderSources: Object.entries(ORDER_SOURCE).map(([, id]) => ({ id: Number(id), label: ORDER_SOURCE_LABELS[Number(id)] ?? String(id) })),
      paymentStatuses: Object.entries(PAYMENT_STATUS_LABELS).map(([id, label]) => ({ id: Number(id), label })),
      priorities: Object.entries(SHIPMENT_PRIORITY_LABELS).map(([id, label]) => ({ id: Number(id), label })),
      scheduleStatuses: Object.entries(SHIPMENT_SCHEDULE_STATUS_LABELS).map(([id, label]) => ({ id: Number(id), label })),
      shippingCompanies: shippingCompanies.map((company: unknown) => ({ id: toNumber(toPlain(company).id), label: toText(toPlain(company).name) })),
      shipmentStatuses: Object.entries(SHIPMENT_STATUS_LABELS).map(([id, label]) => ({ id: Number(id), label })),
      shipmentTypes: [
        { id: "grouped", label: SHIPMENT_TYPE_LABELS.grouped ?? "شحن مجمع" },
        { id: "separate", label: SHIPMENT_TYPE_LABELS.separate ?? "شحن منفصل" },
      ],
      subTabCounts: {
        accountDeliveries: deliveredCount,
        accountExpenses: toNumber(expensesCount),
        customerReturns: returnsFromCustomerCount,
        vendorReturns: returnsToVendorCount,
      },
      tabs: [
        { count: shipmentsCount, id: "shipments", label: "الشحنات" },
        { count: returnsToVendorCount + returnsFromCustomerCount, id: "returns", label: "المرتجعات" },
        { count: toNumber(inventoryCount), id: "inventory", label: "المخزون" },
        { count: toNumber(expensesCount) + deliveredCount, id: "accounts", label: "الحسابات" },
        { count: deliveredCount, id: "performance", label: "تقارير الأداء" },
      ],
      vendorReturnStatuses: Object.entries(RETURN_TO_VENDOR_STATUS_LABELS).map(([id, label]) => ({ id: Number(id), label })),
    };
  }

  /**
   * The cards are six numbers, so they are aggregated in SQL.
   *
   * This used to `findAll` every matching shipment with the full include tree
   * (order lines -> product -> vendor, customer, notes) and count the mapped
   * rows in JS — roughly 17s for 1.5k shipments. Only the `priority` and
   * `deliveryStatus` filters are derived in JS, so those still need the old
   * row-by-row path; every other filter combination is handled by the database.
   */
  public async getSummary(filters: Omit<ShipmentListQuery, "page" | "size">, vendorId?: number | null): Promise<ShipmentSummaryResponse> {
    const whereClause = buildShipmentWhereClause(filters, vendorId);

    const buildCards = (
      total: number,
      deliveredCount: number,
      inDeliveryCount: number,
      failedOrReturnedCount: number,
      totalGmv: number,
    ) => {
      const successRate = total > 0 ? Math.round((deliveredCount / total) * 1000) / 10 : 0;
      return {
        cards: [
          { description: "إجمالي الشحنات ضمن الفلاتر الحالية", key: "totalShipments", label: "الشحنات", value: total },
          { description: "الشحنات التي تم تسليمها", key: "deliveredShipments", label: "تم التسليم", value: deliveredCount },
          { description: "الشحنات الجاهزة أو قيد التوصيل", key: "inDeliveryShipments", label: "قيد التوصيل", value: inDeliveryCount },
          { description: "ملغي أو مرتجع أو فشل", key: "failedOrReturnedShipments", label: "مرتجع / ملغي / فاشل", value: failedOrReturnedCount },
          { description: `معدل النجاح ${successRate}%`, key: "successRate", label: "معدل النجاح", value: successRate },
          { description: "إجمالي المبلغ المطلوب تحصيله", key: "totalGmv", label: "إجمالي التحصيل", value: totalGmv },
        ],
      };
    };

    const inDeliveryStatuses: number[] = [
      SHIPMENT_STATUS.READY_FOR_SHIPPING,
      SHIPMENT_STATUS.SCHEDULED,
      SHIPMENT_STATUS.OUT_FOR_DELIVERY,
    ];
    const failedStatuses: number[] = [
      SHIPMENT_STATUS.CANCELED,
      SHIPMENT_STATUS.REJECTED,
      SHIPMENT_STATUS.RETURNED_FROM_CUSTOMER,
      SHIPMENT_STATUS.RETURNED_TO_VENDOR,
      SHIPMENT_STATUS.FAILED_DELIVERY,
    ];

    /* One grouped pass over the matching orders. The vendor/customer joins are
       only included when a filter actually references them. */
    const rows = await orderModel.findAll({
        attributes: [
          "shipmentStatus",
          "paymentStatus",
          [fn("COUNT", col("Order.id")), "rowCount"],
          [fn("SUM", col("Order.toBeCollected")), "collected"],
          [fn("SUM", col("Order.totalPrice")), "totalPrice"],
        ],
        group: ["Order.shipmentStatus", "Order.paymentStatus"],
        include: buildSummaryIncludes(filters),
        raw: true,
        subQuery: false,
        where: whereClause,
      });

      let total = 0;
      let deliveredCount = 0;
      let inDeliveryCount = 0;
      let failedOrReturnedCount = 0;
      let totalGmv = 0;

      for (const row of rows as Array<Record<string, unknown>>) {
        const rowCount = toNumber(row.rowCount);
        const shipmentStatus = toNumber(row.shipmentStatus);
        total += rowCount;

        if (shipmentStatus === SHIPMENT_STATUS.DELIVERED) {
          deliveredCount += rowCount;
        }
        if (inDeliveryStatuses.includes(shipmentStatus)) {
          inDeliveryCount += rowCount;
        }
        if (failedStatuses.includes(shipmentStatus)) {
          failedOrReturnedCount += rowCount;
        }
        // Mirrors getShipmentCollectionAmount: paid shipments collect nothing.
        if (toNumber(row.paymentStatus) !== PAYMENT_STATUS.PAID) {
          totalGmv += toNumber(row.collected) || toNumber(row.totalPrice);
        }
      }

    return buildCards(total, deliveredCount, inDeliveryCount, failedOrReturnedCount, totalGmv);
  }

  public async listShipments(filters: ShipmentListQuery, vendorId?: number | null): Promise<ShipmentListResponse> {
    const whereClause = buildShipmentWhereClause(filters, vendorId);
    const sortEntries = getShipmentSortEntries(filters.sort);

    const result = await orderModel.findAndCountAll({
      distinct: true,
      include: buildShipmentListIncludes(),
      limit: filters.size,
      offset: (filters.page - 1) * filters.size,
      order: buildShipmentSort(sortEntries),
      subQuery: false,
      where: whereClause,
    });

    return {
      items: result.rows.map((row: unknown) => mapShipmentListItem(row)),
      page: filters.page ?? DEFAULT_PAGE_NUMBER,
      size: filters.size ?? DEFAULT_PAGE_SIZE,
      totalCount: result.count,
    };
  }

  public async getShipmentById(shipmentId: number, vendorId?: number | null): Promise<ShipmentDetailsResponse | null> {
    const shipment = await orderModel.findOne({
      include: buildIncludes(),
      subQuery: false,
      where: {
        id: shipmentId,
        ...(vendorId ? { "$orderLines.product.vendor.id$": vendorId } : {}),
      },
    });

    if (!shipment) {
      return null;
    }

    const order = toPlain(shipment);
    const orderLines = Array.isArray(order.orderLines) ? order.orderLines.map((line) => toPlain(line)) : [];
    const customer = toPlain(order.customer);
    const firstVendor = toPlain(toPlain(toPlain(orderLines[0]).product).vendor);
    const logs = await logModel.findAll({
      order: [["createdAt", "ASC"]],
      where: { entityId: shipmentId, entityType: "order" },
    });
    const usersResult = await userModel.findAll({
      attributes: ["firstName", "id", "lastName"],
      where: { id: { [Op.in]: logs.map((log: unknown) => toNumber(toPlain(log).userId)).filter(Boolean) } },
    });
    const users = Array.isArray(usersResult) ? usersResult : [];
    const userNamesById = Object.fromEntries(users.map((user: unknown) => {
      const plainUser = toPlain(user);
      return [String(toNumber(plainUser.id)), `${toText(plainUser.firstName)} ${toText(plainUser.lastName)}`.trim()];
    }));
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
    const shippingCompanyIds = logs
      .map((log: unknown) => toPlain(log))
      .filter((log: Record<string, unknown>) => toText(log.field) === "shippingCompany")
      .flatMap((log: Record<string, unknown>) => [toNumber(log.from), toNumber(log.to)])
      .filter((id: number) => id > 0);
    const shippingCompaniesResult = shippingCompanyIds.length > 0
      ? await shippingCompanyModel.findAll({ attributes: ["id", "name"], where: { id: { [Op.in]: shippingCompanyIds } } })
      : [];
    const shippingCompanies = Array.isArray(shippingCompaniesResult) ? shippingCompaniesResult : [];
    const shippingCompanyNamesById = Object.fromEntries(shippingCompanies.map((company: unknown) => {
      const plainCompany = toPlain(company);
      return [String(toNumber(plainCompany.id)), toText(plainCompany.name)];
    }));
    return {
      customer: {
        address: toText(customer.address),
        name: `${toText(customer.firstName)} ${toText(customer.lastName)}`.trim(),
        phoneNumber: toText(customer.phoneNumber),
      },
      financial: {
        amountToCollect: getShipmentCollectionAmount(order),
        discount: toNumber(order.totalDiscounts),
        downPayment: toNumber(order.downPayment),
        receivedAmount: toNumber(order.receivedAmount),
        shippingCost: toNumber(order.shippingFees),
        totalPrice: toNumber(order.totalPrice),
      },
      notes: Array.isArray(order.notesList) ? order.notesList.map((note) => mapShipmentNote(note)) : [],
      products: orderLines.map((line) => {
        const product = toPlain(line.product);
        const vendor = toPlain(product.vendor);
        const variant = getVariantBySku(product.variants, toText(line.sku));
        return {
          color: toText(line.color),
          image: toText(product.image),
          price: toNumber(line.price) * Math.max(1, toNumber(line.quantity)),
          productCode: toText(line.sku, toText(variant?.sku)),
          productName: toText(product.title, toText(line.title)),
          quantity: toNumber(line.quantity),
          size: toText(line.size),
          variant: {
            color: toText(variant?.option2, toText(line.color)),
            id: toText(variant?.shopifyId, toText(variant?.id, toText(line.variant_id))),
            inventoryQuantity: toNumber(variant?.inventory_quantity) || null,
            material: toText(variant?.option3),
            price: toNumber(variant?.price),
            size: toText(variant?.option1, toText(line.size)),
            sku: toText(variant?.sku, toText(line.sku)),
            title: toText(variant?.title),
          },
          vendorName: toText(vendor.name),
        };
      }),
      shipment: {
        ...mapShipmentListItem(order),
        shippedFromInventory: Boolean(order.shippedFromInventory),
        shippingCompanyName: toText(toPlain(order.shippingCompanyRecord).name, toText(order.shippingCompany)),
      },
      timeline: mapTimeline(logs, userNamesById, vendorNamesById, shippingCompanyNamesById),
      vendor: {
        name: toText(firstVendor.name),
      },
    };
  }

  private async listReturnsByStatus(
    shipmentStatus: number,
    filters: ReturnListQuery,
    vendorId?: number | null,
  ): Promise<ReturnListResponse> {
    const whereClause = buildShipmentWhereClause(
      {
        operationCode: filters.operationCode,
        orderNumber: filters.orderNumber,
        shipmentStatus: String(shipmentStatus),
      },
      vendorId,
    );

    if (filters.sellerName) {
      const andConditions = (whereClause as { [key: string]: unknown[] })[Op.and as unknown as string] ?? [];
      andConditions.push(where(fn("lower", col("orderLines.product.vendor.name")), {
        [Op.like]: `%${filters.sellerName.toLowerCase()}%`,
      }));
      (whereClause as { [key: string]: unknown[] })[Op.and as unknown as string] = andConditions;
    }

    const result = await orderModel.findAndCountAll({
      distinct: true,
      include: buildIncludes(),
      limit: filters.size,
      offset: (filters.page - 1) * filters.size,
      order: [["updatedAt", "DESC"]],
      subQuery: false,
      where: whereClause,
    });

    const returnType = shipmentStatus === SHIPMENT_STATUS.RETURNED_TO_VENDOR
      ? SHIPMENT_RETURN_TYPE.TO_VENDOR
      : SHIPMENT_RETURN_TYPE.FROM_CUSTOMER;
    const orderIds = result.rows.map((row: unknown) => toNumber(toPlain(row).id)).filter((id: number) => id > 0);
    const persistedReturns = orderIds.length > 0
      ? await shipmentReturnModel.findAll({
          where: {
            orderId: { [Op.in]: orderIds },
            returnType,
          },
        })
      : [];
    const persistedMap = new Map<number, Record<string, unknown>>();
    for (const row of persistedReturns) {
      if (shouldAutoForfeitVendorReturn(row)) {
        await row.update({
          completedAt: new Date(),
          status: RETURN_TO_VENDOR_STATUS.FORFEIT,
        });
      }
      const plainReturn = toPlain(row);
      persistedMap.set(toNumber(plainReturn.orderId), plainReturn);
    }

    const items = result.rows.map((row: unknown) => {
      const order = toPlain(row);
      const persistedReturn = persistedMap.get(toNumber(order.id));
      const firstLine = Array.isArray(order.orderLines) ? toPlain(order.orderLines[0]) : {};
      const vendor = toPlain(toPlain(firstLine.product).vendor);
      const notes = Array.isArray(order.notesList) ? order.notesList.map((note) => toPlain(note)) : [];
      const status = persistedReturn
        ? toNumber(persistedReturn.status)
        : getFallbackReturnStatus(returnType);
      const startedAt = persistedReturn?.startedAt ?? persistedReturn?.returnDate ?? order.updatedAt;
      const completedAt = persistedReturn && isFinalReturnStatus(returnType, status)
        ? (persistedReturn.completedAt ?? persistedReturn.updatedAt ?? persistedReturn.returnDate)
        : undefined;

      return {
        daysCounter: getDaysBetween(startedAt, completedAt),
        // A return row is an order whose shipmentStatus is returned. Keep its
        // public identity stable regardless of optional workflow metadata.
        id: toNumber(order.id),
        orderId: toNumber(order.id),
        operationNumber: normalizeOperationCode(order.code),
        orderNumber: toText(order.orderNumber, toText(order.number, toText(order.name))),
        reason: toText(persistedReturn?.reason, toText(notes[0]?.text, toText(order.notes))),
        returnDate: toIsoString(persistedReturn?.returnDate ?? order.updatedAt),
        returnType,
        returnTypeLabel: SHIPMENT_RETURN_TYPE_LABELS[returnType] ?? String(returnType),
        sellerName: toText(vendor.name),
        status,
        statusLabel: getReturnStatusLabel(returnType, status),
      };
    });

    const filteredItems = filters.status
      ? items.filter((item: ReturnItem) => item.status === filters.status)
      : items;

    return {
      items: filteredItems,
      page: filters.page,
      size: filters.size,
      totalCount: filters.status ? filteredItems.length : toNumber(result.count),
    };
  }

  public listVendorReturns(filters: ReturnListQuery, vendorId?: number | null): Promise<ReturnListResponse> {
    return this.listReturnsByStatus(SHIPMENT_STATUS.RETURNED_TO_VENDOR, filters, vendorId);
  }

  public listCustomerReturns(filters: ReturnListQuery, vendorId?: number | null): Promise<ReturnListResponse> {
    return this.listReturnsByStatus(SHIPMENT_STATUS.RETURNED_FROM_CUSTOMER, filters, vendorId);
  }

  public async createReturnRecord(returnType: number, payload: ReturnMutationInput, userId?: number): Promise<ReturnItem> {
    const shipment = await orderModel.findByPk(payload.orderId, {
      include: buildIncludes(),
    });
    if (!shipment) {
      throw new NotFoundError("Shipment not found");
    }

    const existingRecord = await shipmentReturnModel.findOne({
      where: {
        orderId: payload.orderId,
        returnType,
      },
    });
    if (existingRecord) {
      throw new ConflictError("Return record already exists");
    }

    const plainShipment = toPlain(shipment);
    const firstLine = Array.isArray(plainShipment.orderLines) ? toPlain(plainShipment.orderLines[0]) : {};
    const vendor = toPlain(toPlain(firstLine.product).vendor);
    const status = payload.status ?? getFallbackReturnStatus(returnType);
    const returnDate = payload.returnDate ? new Date(payload.returnDate) : new Date();
    const nextShipmentStatus = getShipmentStatusForReturnType(returnType);
    await shipment.update({ shipmentStatus: nextShipmentStatus });
    await logOrderFieldChange(payload.orderId, plainShipment.shipmentStatus, nextShipmentStatus, userId);
    const createdRecord = await shipmentReturnModel.create({
      completedAt: isFinalReturnStatus(returnType, status) ? returnDate : null,
      orderId: payload.orderId,
      reason: payload.reason,
      returnDate,
      returnType,
      startedAt: returnDate,
      status,
    });
    const record = toPlain(createdRecord);

    return {
      daysCounter: getDaysBetween(record.startedAt, record.completedAt),
      id: toNumber(plainShipment.id),
      orderId: toNumber(plainShipment.id),
      operationNumber: normalizeOperationCode(plainShipment.code),
      orderNumber: toText(plainShipment.orderNumber, toText(plainShipment.number, toText(plainShipment.name))),
      reason: toText(record.reason),
      returnDate: toIsoString(record.returnDate),
      returnType,
      returnTypeLabel: SHIPMENT_RETURN_TYPE_LABELS[returnType] ?? String(returnType),
      sellerName: toText(vendor.name),
      status,
      statusLabel: getReturnStatusLabel(returnType, status),
    };
  }

  public async updateReturnRecord(
    orderId: number,
    returnType: number,
    payload: Partial<ReturnMutationInput>,
    userId?: number,
  ): Promise<ReturnItem | null> {
    const shipment = await orderModel.findByPk(orderId, { include: buildIncludes() });
    if (!shipment) {
      return null;
    }

    const plainShipmentBeforeSync = toPlain(shipment);
    const shipmentStatus = getShipmentStatusForReturnType(returnType);
    if (toNumber(plainShipmentBeforeSync.shipmentStatus) !== shipmentStatus) {
      return null;
    }

    let returnRecord = await shipmentReturnModel.findOne({ where: { orderId, returnType } });
    if (!returnRecord) {
      const startedAt = plainShipmentBeforeSync.updatedAt ?? new Date();
      returnRecord = await shipmentReturnModel.create({
        completedAt: null,
        orderId,
        reason: "",
        returnDate: startedAt,
        returnType,
        startedAt,
        status: getFallbackReturnStatus(returnType),
      });
    }

    if (shouldAutoForfeitVendorReturn(returnRecord)) {
      await returnRecord.update({
        completedAt: new Date(),
        status: RETURN_TO_VENDOR_STATUS.FORFEIT,
      });
    }

    const plainReturn = toPlain(returnRecord);
    if (toNumber(plainReturn.returnType) !== returnType) {
      return null;
    }

    const nextStatus = payload.status ?? toNumber(plainReturn.status);
    const nextReturnDate = payload.returnDate !== undefined
      ? (payload.returnDate ? new Date(payload.returnDate) : null)
      : plainReturn.returnDate;
    await returnRecord.update({
      ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
      ...(payload.returnDate !== undefined ? { returnDate: nextReturnDate } : {}),
      ...(payload.status !== undefined ? { status: payload.status } : {}),
      completedAt: isFinalReturnStatus(returnType, nextStatus)
        ? (plainReturn.completedAt ?? nextReturnDate ?? new Date())
        : null,
    });

    const updated = toPlain(returnRecord);
    const plainShipment = toPlain(shipment);
    const firstLine = Array.isArray(plainShipment.orderLines) ? toPlain(plainShipment.orderLines[0]) : {};
    const vendor = toPlain(toPlain(firstLine.product).vendor);

    /* A return that ends as "forfeit" means the goods stay with us, so they go
       back into stock. Only on the transition, never on a repeated save. */
    const becameForfeit = isForfeitReturnStatus(returnType, nextStatus)
      && !isForfeitReturnStatus(returnType, toNumber(plainReturn.status));
    if (becameForfeit) {
      await applyOrderLinesToInventory(getShipmentInventoryTargets(plainShipment), "restock");
    }

    return {
      daysCounter: getDaysBetween(updated.startedAt, updated.completedAt),
      id: toNumber(plainShipment.id),
      orderId: toNumber(plainShipment.id),
      operationNumber: normalizeOperationCode(plainShipment.code),
      orderNumber: toText(plainShipment.orderNumber, toText(plainShipment.number, toText(plainShipment.name))),
      reason: toText(updated.reason),
      returnDate: toIsoString(updated.returnDate),
      returnType,
      returnTypeLabel: SHIPMENT_RETURN_TYPE_LABELS[returnType] ?? String(returnType),
      sellerName: toText(vendor.name),
      status: nextStatus,
      statusLabel: getReturnStatusLabel(returnType, nextStatus),
    };
  }

  public async listInventory(filters: InventoryListQuery, vendorId?: number | null): Promise<InventoryListResponse> {
    const whereClause: Record<string, unknown> = {
      ...(filters.productCode
        ? { productCode: { [Op.iLike]: `%${filters.productCode}%` } }
        : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };
    const vendorWhere: Record<string, unknown> = {
      ...(vendorId ? { id: vendorId } : {}),
      ...(filters.vendorName
        ? { name: { [Op.iLike]: `%${filters.vendorName}%` } }
        : {}),
    };
    const filterByVendor = Object.keys(vendorWhere).length > 0;

    const { count, rows } = await shipmentInventoryModel.findAndCountAll({
      distinct: true,
      include: [
        {
          as: "product",
          attributes: ["id", "image", "title", "variants", "vendorId"],
          include: [{
            as: "vendor",
            attributes: ["id", "name"],
            model: vendorModel,
            required: filterByVendor,
            ...(filterByVendor ? { where: vendorWhere } : {}),
          }],
          model: productModel,
          required: filterByVendor,
        },
      ],
      limit: filters.size,
      offset: (filters.page - 1) * filters.size,
      order: [["updatedAt", "DESC"]],
      where: whereClause,
    });

    return {
      items: rows.map((row: unknown) => buildInventoryItem(row)),
      page: filters.page,
      size: filters.size,
      totalCount: toNumber(count),
    };
  }

  public async createInventoryItem(payload: InventoryMutationInput): Promise<InventoryItem> {
    const product = await productModel.findByPk(payload.productId, {
      include: [{ as: "vendor", model: vendorModel, required: false }],
    });
    if (!product) {
      throw new NotFoundError("Product not found");
    }

    const status = payload.status ?? (payload.quantity > 0 ? INVENTORY_STATUS.IN_STOCK : INVENTORY_STATUS.OUT_OF_STOCK);
    const createdItem = await shipmentInventoryModel.create({
      color: payload.color,
      costPrice: payload.costPrice,
      productCode: payload.productCode,
      productId: payload.productId,
      quantity: payload.quantity,
      size: payload.size,
      status,
    });
    createdItem.setDataValue("product", product);
    return buildInventoryItem(createdItem);
  }

  public async updateInventoryItem(inventoryItemId: number, payload: Partial<InventoryMutationInput>): Promise<InventoryItem | null> {
    const inventoryItem = await shipmentInventoryModel.findByPk(inventoryItemId);
    if (!inventoryItem) {
      return null;
    }

    let linkedProduct = null;
    if (payload.productId !== undefined) {
      linkedProduct = await productModel.findByPk(payload.productId, {
        include: [{ as: "vendor", model: vendorModel, required: false }],
      });
      if (!linkedProduct) {
        throw new NotFoundError("Product not found");
      }
    }

    const nextPayload = { ...payload };
    if (nextPayload.quantity !== undefined && nextPayload.status === undefined) {
      nextPayload.status = nextPayload.quantity > 0 ? INVENTORY_STATUS.IN_STOCK : INVENTORY_STATUS.OUT_OF_STOCK;
    }

    await inventoryItem.update(nextPayload);
    if (!linkedProduct) {
      linkedProduct = await productModel.findByPk(toNumber(inventoryItem.getDataValue("productId")), {
        include: [{ as: "vendor", model: vendorModel, required: false }],
      });
    }
    inventoryItem.setDataValue("product", linkedProduct);
    return buildInventoryItem(inventoryItem);
  }

  public async deleteInventoryItem(inventoryItemId: number): Promise<boolean> {
    const inventoryItem = await shipmentInventoryModel.findByPk(inventoryItemId);
    if (!inventoryItem) {
      return false;
    }

    await inventoryItem.destroy();
    return true;
  }

  /**
   * Sets the accounting state of one delivered shipment. Only delivered
   * shipments appear in the ledger, so anything else is rejected outright.
   */
  public async updateDeliveryAccount(
    orderId: number,
    payload: { accountingDate?: string | null; accountingReference?: string; accountingStatus?: number; hidden?: boolean },
  ): Promise<boolean> {
    const order = await orderModel.findByPk(orderId);
    if (!order) {
      return false;
    }

    const plainOrder = toPlain(order);
    if (toNumber(plainOrder.shipmentStatus) !== SHIPMENT_STATUS.DELIVERED) {
      throw new NotFoundError("Delivery account not found");
    }

    const storedStatus = toNullableNumber(plainOrder.accountingStatus);
    const isTransitioningToSettled = payload.accountingStatus === ACCOUNTING_STATUS.SETTLED
      && storedStatus !== ACCOUNTING_STATUS.SETTLED;
    await order.update({
      ...(payload.accountingReference !== undefined ? { accountingReference: payload.accountingReference } : {}),
      ...(payload.accountingStatus !== undefined ? { accountingStatus: payload.accountingStatus } : {}),
      // Stamp the actual transition by default, while still allowing an
      // explicitly edited date. Reverting to pending always clears the stamp.
      ...(payload.accountingStatus === ACCOUNTING_STATUS.PENDING
        ? { accountingDate: null }
        : payload.accountingDate !== undefined
          ? { accountingDate: payload.accountingDate ? new Date(payload.accountingDate) : null }
          : isTransitioningToSettled
            ? { accountingDate: new Date() }
            : {}),
      // Hides/unhides the row from the accounting ledger only — never touches
      // the order or shipment itself.
      ...(payload.hidden !== undefined ? { accountsHiddenAt: payload.hidden ? new Date() : null } : {}),
    });

    return true;
  }

  /**
   * Applies the same accounting-status change to several delivered shipments at
   * once. Reuses updateDeliveryAccount per row so a row that isn't actually
   * delivered yet (accounting record not found) is skipped rather than aborting
   * the whole batch.
   */
  public async bulkUpdateDeliveryAccounts(
    orderIds: number[],
    payload: { accountingDate?: string | null; accountingReference?: string; accountingStatus?: number },
  ): Promise<{ updatedCount: number; skippedIds: number[] }> {
    let updatedCount = 0;
    const skippedIds: number[] = [];
    for (const orderId of orderIds) {
      try {
        const updated = await this.updateDeliveryAccount(orderId, payload);
        if (updated) {
          updatedCount += 1;
        } else {
          skippedIds.push(orderId);
        }
      } catch (error) {
        if (error instanceof NotFoundError) {
          skippedIds.push(orderId);
          continue;
        }
        throw error;
      }
    }
    return { skippedIds, updatedCount };
  }

  public async listDeliveryAccounts(filters: DeliveryAccountsListQuery, vendorId?: number | null): Promise<DeliveryAccountsListResponse> {
    const whereClause: Record<PropertyKey, unknown> = {
      ...buildHomixShipmentScope(),
      shipmentStatus: SHIPMENT_STATUS.DELIVERED,
      accountsHiddenAt: null,
    };

    const result = await orderModel.findAndCountAll({
      distinct: true,
      include: buildIncludes(),
      limit: filters.size,
      offset: (filters.page - 1) * filters.size,
      order: [["deliveryDate", "DESC"]],
      subQuery: false,
      where: {
        ...whereClause,
        ...(vendorId ? { "$orderLines.product.vendor.id$": vendorId } : {}),
      },
    });

    const items = result.rows.map((row: unknown) => {
      const order = toPlain(row);
      const firstLine = Array.isArray(order.orderLines) ? toPlain(order.orderLines[0]) : {};
      const product = toPlain(firstLine.product);
      const vendor = toPlain(product.vendor);
      const paymentStatus = toNumber(order.paymentStatus);
      // A user-set accounting status wins; otherwise fall back to the payment status.
      const storedAccountingStatus = toNullableNumber(order.accountingStatus);
      const accountingStatus = storedAccountingStatus
        ?? (paymentStatus === 2 ? ACCOUNTING_STATUS.SETTLED : ACCOUNTING_STATUS.PENDING);
      const deliveryBy = toNullableNumber(order.deliveryBy);
      const amountToCollect = toNumber(order.toBeCollected || order.totalPrice);
      const storedReceivedAmount = order.receivedAmount == null
        ? amountToCollect
        : toNumber(order.receivedAmount);

      return {
        accountingDate: toIsoString(order.accountingDate),
        accountingStatus,
        accountingStatusLabel: ACCOUNT_STATUS_LABELS[accountingStatus] ?? String(accountingStatus),
        amountToCollect,
        deliveryDate: toIsoString(order.deliveryDate),
        id: toNumber(order.id),
        operationNumber: normalizeOperationCode(order.code),
        orderNumber: toText(order.orderNumber, toText(order.number, toText(order.name))),
        paymentMethod: String(paymentStatus || ""),
        paymentMethodLabel: PAYMENT_STATUS_LABELS[paymentStatus] ?? "",
        productCode: toText(firstLine.sku),
        // الصفر قيمة محاسبية مقصودة؛ نستخدم المبلغ المطلوب فقط للسجلات القديمة
        // التي لا تحتوي أي قيمة مستلمة أصلًا (null/undefined).
        receivedAmount: storedReceivedAmount,
        reference: toText(order.accountingReference, toText(order.shopifyId)),
        sellerName: toText(vendor.name),
        sellingPrice: toNumber(firstLine.price) * Math.max(1, toNumber(firstLine.quantity)),
        shippingCompanyName: toText(toPlain(order.shippingCompanyRecord).name, toText(order.shippingCompany))
          || (deliveryBy ? DELIVERY_BY_LABELS[deliveryBy] ?? String(deliveryBy) : ""),
      } satisfies DeliveryAccountItem;
    }).filter((item: DeliveryAccountItem) => {
      if (filters.orderNumber && !item.orderNumber.toLowerCase().includes(filters.orderNumber.toLowerCase())) {
        return false;
      }
      if (filters.paymentMethod && item.paymentMethod !== filters.paymentMethod) {
        return false;
      }
      if (filters.accountingStatus && item.accountingStatus !== filters.accountingStatus) {
        return false;
      }
      if (filters.settledDate) {
        const requestedDate = toIsoString(filters.settledDate)?.slice(0, 10);
        if (!requestedDate || item.accountingDate?.slice(0, 10) !== requestedDate) {
          return false;
        }
      }
      return true;
    });

    return {
      items,
      page: filters.page,
      size: filters.size,
      totalCount: filters.accountingStatus || filters.orderNumber || filters.paymentMethod || filters.settledDate
        ? items.length
        : toNumber(result.count),
    };
  }

  public async listExpenseAccounts(filters: ExpenseAccountsListQuery): Promise<ExpenseAccountsListResponse> {
    const [rows, expenseTypeLabels] = await Promise.all([shipmentExpenseModel.findAll({
      order: [["accountingDate", "DESC"], ["createdAt", "DESC"]],
    }), getManagedOptionLabels(MANAGED_OPTION_GROUP.EXPENSE_TYPE)]);
    const items: ExpenseAccountItem[] = rows.map((row: unknown) => {
      const item = toPlain(row);
      const accountingStatus = toNumber(item.accountingStatus) || ACCOUNTING_STATUS.PENDING;
      const type = toNumber(item.type);
      return {
        accountingDate: toIsoString(item.accountingDate),
        accountingStatus,
        accountingStatusLabel: EXPENSE_STATUS_LABELS[accountingStatus] ?? String(accountingStatus),
        amount: toNumber(item.amount),
        id: toNumber(item.id),
        reason: toText(item.reason),
        type,
        typeLabel: expenseTypeLabels[type] ?? EXPENSE_TYPE_LABELS[type] ?? String(type),
      };
    });
    const filteredItems = items.filter((item: ExpenseAccountItem) => {
      if (filters.type && item.type !== filters.type) {
        return false;
      }
      if (filters.accountingStatus && item.accountingStatus !== filters.accountingStatus) {
        return false;
      }
      return true;
    });

    return {
      items: filteredItems,
      page: filters.page,
      size: filters.size,
      totalCount: filteredItems.length,
    };
  }

  public async listShippingCompanies(search?: string): Promise<ShippingCompanyListResponse> {
    const companies = await shippingCompanyModel.findAll({
      order: [["name", "ASC"]],
      where: search
        ? where(fn("lower", col("ShippingCompany.name")), { [Op.like]: `%${search.toLowerCase()}%` })
        : undefined,
    });

    const companyNames = companies
      .map((company: unknown) => toText(toPlain(company).name))
      .filter(Boolean);
    const groupedCounts = companyNames.length > 0
      ? await orderModel.count({
        attributes: ["shippingCompany"],
        group: ["shippingCompany"],
        where: { shippingCompany: { [Op.in]: companyNames } },
      })
      : [];
    const countsByName = new Map<string, number>();
    if (Array.isArray(groupedCounts)) {
      groupedCounts.forEach((countValue: unknown) => {
        const countRow = toPlain(countValue);
        countsByName.set(toText(countRow.shippingCompany), toNumber(countRow.count));
      });
    }

    return {
      items: companies.map((company: unknown) => {
        const item = mapShippingCompanyItem(company);
        return { ...item, linkedOrdersCount: countsByName.get(item.name) ?? 0 };
      }),
    };
  }

  public async createShippingCompany(payload: ShippingCompanyMutationInput): Promise<ShippingCompanyItem> {
    const existingCompany = await shippingCompanyModel.findOne({
      where: where(fn("lower", col("ShippingCompany.name")), { [Op.eq]: payload.name.toLowerCase() }),
    });
    if (existingCompany) {
      throw new ConflictError("Shipping company already exists");
    }

    const company = await shippingCompanyModel.create({ name: payload.name });
    return mapShippingCompanyItem(company);
  }

  public async updateShippingCompany(
    shippingCompanyId: number,
    payload: ShippingCompanyMutationInput,
  ): Promise<ShippingCompanyItem | null> {
    const company = await shippingCompanyModel.findByPk(shippingCompanyId);
    if (!company) {
      return null;
    }

    const existingCompany = await shippingCompanyModel.findOne({
      where: {
        [Op.and]: [
          where(fn("lower", col("ShippingCompany.name")), { [Op.eq]: payload.name.toLowerCase() }),
          { id: { [Op.ne]: shippingCompanyId } },
        ],
      },
    });
    if (existingCompany) {
      throw new ConflictError("Shipping company already exists");
    }

    const previousName = toText(toPlain(company).name);
    await company.update({ name: payload.name });
    await orderModel.update(
      { shippingCompany: payload.name },
      { where: { shippingCompany: previousName } },
    );

    return mapShippingCompanyItem(company);
  }

  public async deleteShippingCompany(
    shippingCompanyId: number,
  ): Promise<{ linkedOrdersCount: number } | null> {
    return sequelize.transaction(async (transaction) => {
      const company = await shippingCompanyModel.findByPk(shippingCompanyId, {
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!company) {
        return null;
      }

      const companyName = toText(toPlain(company).name);
      const linkedOrdersCount = await orderModel.count({
        transaction,
        where: { shippingCompany: companyName },
      });
      if (linkedOrdersCount > 0) {
        await orderModel.update(
          { shippingCompany: null },
          { transaction, where: { shippingCompany: companyName } },
        );
      }

      await company.destroy({ transaction });
      return { linkedOrdersCount };
    });
  }

  public async createExpenseAccount(payload: ExpenseMutationInput): Promise<ExpenseAccountItem> {
    const expenseTypeLabels = await getManagedOptionLabels(MANAGED_OPTION_GROUP.EXPENSE_TYPE);
    const createdExpense = await shipmentExpenseModel.create({
      accountingDate: payload.accountingDate || null,
      accountingStatus: payload.accountingStatus ?? ACCOUNTING_STATUS.PENDING,
      amount: payload.amount,
      reason: payload.reason,
      type: payload.type,
    });
    const expense = toPlain(createdExpense);
    const accountingStatus = toNumber(expense.accountingStatus) || ACCOUNTING_STATUS.PENDING;
    return {
      accountingDate: toIsoString(expense.accountingDate),
      accountingStatus,
      accountingStatusLabel: EXPENSE_STATUS_LABELS[accountingStatus] ?? String(accountingStatus),
      amount: toNumber(expense.amount),
      id: toNumber(expense.id),
      reason: toText(expense.reason),
      type: toNumber(expense.type),
      typeLabel: expenseTypeLabels[toNumber(expense.type)] ?? EXPENSE_TYPE_LABELS[toNumber(expense.type)] ?? String(expense.type),
    };
  }

  public async updateExpenseAccount(expenseId: number, payload: Partial<ExpenseMutationInput>): Promise<ExpenseAccountItem | null> {
    const expenseRecord = await shipmentExpenseModel.findByPk(expenseId);
    if (!expenseRecord) {
      return null;
    }

    await expenseRecord.update({
      ...payload,
      ...(payload.accountingDate !== undefined ? { accountingDate: payload.accountingDate || null } : {}),
    });
    const expense = toPlain(expenseRecord);
    const expenseTypeLabels = await getManagedOptionLabels(MANAGED_OPTION_GROUP.EXPENSE_TYPE);
    const accountingStatus = toNumber(expense.accountingStatus) || ACCOUNTING_STATUS.PENDING;
    return {
      accountingDate: toIsoString(expense.accountingDate),
      accountingStatus,
      accountingStatusLabel: EXPENSE_STATUS_LABELS[accountingStatus] ?? String(accountingStatus),
      amount: toNumber(expense.amount),
      id: toNumber(expense.id),
      reason: toText(expense.reason),
      type: toNumber(expense.type),
      typeLabel: expenseTypeLabels[toNumber(expense.type)] ?? EXPENSE_TYPE_LABELS[toNumber(expense.type)] ?? String(expense.type),
    };
  }

  /** يطبّق نفس تعديل updateExpenseAccount على عدة مصروفات دفعة واحدة — صف يفشل يُتخطّى بدل إفشال الدفعة كلها. */
  public async bulkUpdateExpenseAccounts(
    expenseIds: number[],
    payload: Partial<ExpenseMutationInput>,
  ): Promise<{ updatedCount: number; skippedIds: number[] }> {
    let updatedCount = 0;
    const skippedIds: number[] = [];
    for (const expenseId of expenseIds) {
      // eslint-disable-next-line no-await-in-loop -- sequential, small batches from a UI selection
      const updated = await this.updateExpenseAccount(expenseId, payload);
      if (updated) {
        updatedCount += 1;
      } else {
        skippedIds.push(expenseId);
      }
    }
    return { skippedIds, updatedCount };
  }

  public updateExpenseTypes(options: Array<{ id?: number; label: string }>): Promise<ManagedOptionValue[]> {
    return replaceManagedOptions(MANAGED_OPTION_GROUP.EXPENSE_TYPE, options);
  }

  public async hasExpenseType(type: number): Promise<boolean> {
    const types = await listManagedOptions(MANAGED_OPTION_GROUP.EXPENSE_TYPE);
    return types.some((option) => option.id === type);
  }

  public async deleteExpenseAccount(expenseId: number): Promise<boolean> {
    const expenseRecord = await shipmentExpenseModel.findByPk(expenseId);
    if (!expenseRecord) {
      return false;
    }

    await expenseRecord.destroy();
    return true;
  }

  public async getPerformance(filters: PerformanceQuery, vendorId?: number | null): Promise<PerformanceResponse> {
    const performanceStatuses = [
      SHIPMENT_STATUS.DELIVERED,
      SHIPMENT_STATUS.CANCELED,
      SHIPMENT_STATUS.REJECTED,
      SHIPMENT_STATUS.RETURNED_FROM_CUSTOMER,
      SHIPMENT_STATUS.RETURNED_TO_VENDOR,
      SHIPMENT_STATUS.REPLACED,
      SHIPMENT_STATUS.FAILED_DELIVERY,
    ];
    const returnedStatuses = new Set<number>([
      SHIPMENT_STATUS.CANCELED,
      SHIPMENT_STATUS.REJECTED,
      SHIPMENT_STATUS.RETURNED_FROM_CUSTOMER,
      SHIPMENT_STATUS.RETURNED_TO_VENDOR,
      SHIPMENT_STATUS.REPLACED,
      SHIPMENT_STATUS.FAILED_DELIVERY,
    ]);
    const whereClause: Record<string | symbol, unknown> = {
      ...buildHomixShipmentScope(),
      shipmentStatus: { [Op.in]: performanceStatuses },
      ...(vendorId ? { "$orderLines.product.vendor.id$": vendorId } : {}),
    };

    const rangeStart = filters.startDate ? toDateRangeBoundary(filters.startDate, "start") : null;
    const rangeEnd = filters.endDate ? toDateRangeBoundary(filters.endDate, "end") : null;
    const reportDateOverrides = new Map<number, Date>();
    const hasDateRange = Boolean(rangeStart || rangeEnd);

    if (hasDateRange) {
      const candidates = await sequelize.query<{ id: number; reportDate: Date | string }>(`
        WITH eligible_orders AS MATERIALIZED (
          SELECT o.*
          FROM orders o
          WHERE o."deletedAt" IS NULL
            AND o."shipmentStatus" IN (:performanceStatuses)
            AND (
              o."deliveryBy" = :homixDeliveryBy
              OR (o."deliveryBy" IS NULL AND o."shippedFromInventory" IS TRUE)
            )
        ),
        latest_status_logs AS (
          SELECT DISTINCT ON (l."entityId")
            l."entityId",
            l."createdAt"
          FROM logs l
          INNER JOIN eligible_orders o
            ON o.id = l."entityId"
            AND l."to" = o."shipmentStatus"::text
          WHERE l."entityType" = 'order'
            AND l.action = 'update'
            AND l.field = 'shipmentStatus'
          ORDER BY l."entityId", l."createdAt" DESC
        ),
        latest_returns AS (
          SELECT DISTINCT ON (sr."orderId")
            sr."orderId",
            COALESCE(sr."completedAt", sr."returnDate", sr."startedAt", sr."createdAt") AS "reportDate"
          FROM "shipmentReturns" sr
          INNER JOIN eligible_orders o
            ON o.id = sr."orderId"
            AND sr."returnType" = CASE
              WHEN o."shipmentStatus" = :returnedToVendorStatus THEN :vendorReturnType
              WHEN o."shipmentStatus" = :returnedFromCustomerStatus THEN :customerReturnType
              ELSE NULL
            END
          WHERE sr."deletedAt" IS NULL
          ORDER BY sr."orderId", sr."createdAt" DESC
        ),
        performance_orders AS (
          SELECT
            o.id,
            COALESCE(
              latest_log."createdAt",
              CASE
                WHEN o."shipmentStatus" = :deliveredStatus
                  THEN COALESCE(o."deliveryDate", o."updatedAt", o."orderDate")
                WHEN o."shipmentStatus" IN (:persistedReturnStatuses)
                  THEN COALESCE(
                    latest_return."reportDate",
                    o."updatedAt",
                    o."deliveryDate",
                    o."orderDate"
                  )
                ELSE COALESCE(o."updatedAt", o."deliveryDate", o."orderDate")
              END
            ) AS "reportDate"
          FROM eligible_orders o
          LEFT JOIN latest_status_logs latest_log
            ON latest_log."entityId" = o.id
          LEFT JOIN latest_returns latest_return
            ON latest_return."orderId" = o.id
        )
        SELECT id, "reportDate"
        FROM performance_orders
        WHERE "reportDate" IS NOT NULL
          ${rangeStart ? "AND \"reportDate\" >= :rangeStart" : ""}
          ${rangeEnd ? "AND \"reportDate\" <= :rangeEnd" : ""}
      `, {
        replacements: {
          customerReturnType: SHIPMENT_RETURN_TYPE.FROM_CUSTOMER,
          deliveredStatus: SHIPMENT_STATUS.DELIVERED,
          homixDeliveryBy: DELIVERY_BY.HOMIX,
          performanceStatuses,
          persistedReturnStatuses: [
            SHIPMENT_STATUS.RETURNED_FROM_CUSTOMER,
            SHIPMENT_STATUS.RETURNED_TO_VENDOR,
          ],
          rangeEnd,
          rangeStart,
          returnedFromCustomerStatus: SHIPMENT_STATUS.RETURNED_FROM_CUSTOMER,
          returnedToVendorStatus: SHIPMENT_STATUS.RETURNED_TO_VENDOR,
          vendorReturnType: SHIPMENT_RETURN_TYPE.TO_VENDOR,
        },
        type: QueryTypes.SELECT,
      });

      for (const candidate of candidates) {
        const reportDate = new Date(candidate.reportDate);
        if (!Number.isNaN(reportDate.getTime())) {
          reportDateOverrides.set(toNumber(candidate.id), reportDate);
        }
      }
      whereClause.id = { [Op.in]: [...reportDateOverrides.keys()] };
    }

    const orders = await orderModel.findAll({
      include: buildIncludes(),
      order: [["deliveryDate", "ASC"]],
      subQuery: false,
      where: whereClause,
    });

    const unfilteredItems: Array<{
      item: ShipmentListItem;
      order: Record<string, unknown>;
    }> = orders.map((order: unknown) => {
      const plainOrder = toPlain(order);
      const mappedItem = mapShipmentListItem(order);
      const item = mappedItem.deliveryBy === null && plainOrder.shippedFromInventory === true
        ? {
          ...mappedItem,
          deliveryBy: DELIVERY_BY.HOMIX,
          deliveryByLabel: DELIVERY_BY_LABELS[DELIVERY_BY.HOMIX],
        }
        : mappedItem;
      return { item, order: plainOrder };
    });
    const orderIds = unfilteredItems.map(({ item }) => item.id);
    const [statusLogs, returnRecords] = orderIds.length > 0 && !hasDateRange
      ? await Promise.all([
        logModel.findAll({
          order: [["createdAt", "ASC"]],
          where: {
            action: "update",
            entityId: { [Op.in]: orderIds },
            entityType: "order",
            field: "shipmentStatus",
            to: { [Op.in]: performanceStatuses.map(String) },
          },
        }),
        shipmentReturnModel.findAll({
          order: [["createdAt", "ASC"]],
          where: { orderId: { [Op.in]: orderIds } },
        }),
      ])
      : [[], []];

    const statusTransitionDates = new Map<string, Date>();
    for (const logValue of statusLogs) {
      const log = toPlain(logValue);
      const createdAt = log.createdAt ? new Date(String(log.createdAt)) : null;
      if (createdAt && !Number.isNaN(createdAt.getTime())) {
        statusTransitionDates.set(`${toNumber(log.entityId)}::${toNumber(log.to)}`, createdAt);
      }
    }

    const returnDates = new Map<string, Date>();
    for (const returnValue of returnRecords) {
      const returnRecord = toPlain(returnValue);
      const dateValue = returnRecord.completedAt
        ?? returnRecord.returnDate
        ?? returnRecord.startedAt
        ?? returnRecord.createdAt;
      const returnDate = dateValue ? new Date(String(dateValue)) : null;
      if (returnDate && !Number.isNaN(returnDate.getTime())) {
        returnDates.set(`${toNumber(returnRecord.orderId)}::${toNumber(returnRecord.returnType)}`, returnDate);
      }
    }

    const items = unfilteredItems
      .map(({ item, order }) => {
        const shipmentStatus = item.shipmentStatus ?? 0;
        const transitionDate = reportDateOverrides.get(item.id)
          ?? statusTransitionDates.get(`${item.id}::${shipmentStatus}`);
        const returnType = shipmentStatus === SHIPMENT_STATUS.RETURNED_TO_VENDOR
          ? SHIPMENT_RETURN_TYPE.TO_VENDOR
          : shipmentStatus === SHIPMENT_STATUS.RETURNED_FROM_CUSTOMER
            ? SHIPMENT_RETURN_TYPE.FROM_CUSTOMER
            : null;
        const persistedReturnDate = returnType === null
          ? null
          : returnDates.get(`${item.id}::${returnType}`);
        const fallbackValue = shipmentStatus === SHIPMENT_STATUS.DELIVERED
          ? order.deliveryDate ?? order.updatedAt ?? order.orderDate
          : persistedReturnDate ?? order.updatedAt ?? order.deliveryDate ?? order.orderDate;
        const fallbackDate = fallbackValue ? new Date(String(fallbackValue)) : null;
        const reportDate = transitionDate
          ?? (fallbackDate && !Number.isNaN(fallbackDate.getTime()) ? fallbackDate : null);
        return { item, order, reportDate };
      })
      .filter(({ reportDate }) => {
        if (!rangeStart && !rangeEnd) return true;
        if (!reportDate) return false;
        return (!rangeStart || reportDate >= rangeStart) && (!rangeEnd || reportDate <= rangeEnd);
      });
    const chartMap = new Map<string, number>();
    const providerMap = new Map<string, {
      deliveredOrdersCount: number;
      deliveryBy: number | null;
      deliveryByLabel: string;
      shippingCompanyName: string;
      totalGmv: number;
      returnsCount: number;
    }>();
    const vendorMap = new Map<string, {
      deliveredOrdersCount: number;
      returnsCount: number;
      sellerName: string;
      totalGmv: number;
    }>();

    for (const { item, order, reportDate } of items) {
      const shipmentStatus = item.shipmentStatus ?? 0;
      const isDelivered = shipmentStatus === SHIPMENT_STATUS.DELIVERED;
      const isReturned = returnedStatuses.has(shipmentStatus);

      if (isDelivered && reportDate) {
        let label = reportDate.toISOString().slice(0, 10);
        if (filters.period === "monthly") {
          label = reportDate.toISOString().slice(0, 7);
        } else if (filters.period === "weekly") {
          const weekStart = new Date(reportDate);
          const daysSinceMonday = (weekStart.getUTCDay() + 6) % 7;
          weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday);
          label = weekStart.toISOString().slice(0, 10);
        }
        chartMap.set(label, (chartMap.get(label) ?? 0) + 1);
      }

      const providerKey = `${item.deliveryBy ?? "null"}::${item.shippingCompanyName || ""}`;
      const providerValue = providerMap.get(providerKey) ?? {
        deliveredOrdersCount: 0,
        deliveryBy: item.deliveryBy,
        deliveryByLabel: item.deliveryByLabel,
        shippingCompanyName: item.shippingCompanyName,
        totalGmv: 0,
        returnsCount: 0,
      };
      if (isDelivered) {
        providerValue.deliveredOrdersCount += 1;
        providerValue.totalGmv += toNumber(order.totalPrice ?? order.toBeCollected);
      } else if (isReturned) {
        providerValue.returnsCount += 1;
      }
      providerMap.set(providerKey, providerValue);

      const vendorKey = item.sellerName || "غير محدد";
      const vendorValue = vendorMap.get(vendorKey) ?? {
        deliveredOrdersCount: 0,
        returnsCount: 0,
        sellerName: item.sellerName || "غير محدد",
        totalGmv: 0,
      };
      if (isDelivered) {
        vendorValue.deliveredOrdersCount += 1;
        vendorValue.totalGmv += toNumber(order.totalPrice ?? order.toBeCollected);
      } else if (isReturned) {
        vendorValue.returnsCount += 1;
      }
      vendorMap.set(vendorKey, vendorValue);
    }

    const deliveredItems = items
      .filter(({ item }: { item: ShipmentListItem }) => item.shipmentStatus === SHIPMENT_STATUS.DELIVERED);
    const deliveredOrdersCount = deliveredItems.length;
    const totalGmv = deliveredItems.reduce(
      (sum: number, { order }) => sum + toNumber(order.totalPrice ?? order.toBeCollected),
      0,
    );

    return {
      chart: Array.from(chartMap.entries())
        .sort(([leftLabel], [rightLabel]) => leftLabel.localeCompare(rightLabel))
        .map(([label, deliveredOrdersCountValue]) => ({
          deliveredOrdersCount: deliveredOrdersCountValue,
          label,
        })),
      overview: {
        deliveredOrdersCount,
        totalGmv,
      },
      providers: Array.from(providerMap.values())
        .map((providerValue) => ({
          deliveredOrdersCount: providerValue.deliveredOrdersCount,
          deliveryBy: providerValue.deliveryBy,
          deliveryByLabel: providerValue.deliveryByLabel,
          returnsCount: providerValue.returnsCount,
          shippingCompanyName: providerValue.shippingCompanyName,
          totalGmv: providerValue.totalGmv,
        }))
        .sort((left, right) => right.deliveredOrdersCount - left.deliveredOrdersCount),
      vendors: Array.from(vendorMap.values())
        .map((vendorValue) => ({
          deliveredOrdersCount: vendorValue.deliveredOrdersCount,
          returnsCount: vendorValue.returnsCount,
          sellerName: vendorValue.sellerName,
          totalGmv: vendorValue.totalGmv,
        }))
        .sort((left, right) => right.deliveredOrdersCount - left.deliveredOrdersCount),
    };
  }

  public async updateShipment(shipmentId: number, payload: Record<string, unknown>, userId?: number): Promise<unknown | null> {
    const shipment = await orderModel.findByPk(shipmentId);
    if (!shipment) {
      return null;
    }

    const plainShipmentBeforeUpdate = toPlain(shipment);
    const nextPayload = await this.normalizeShippingCompanyPayload(payload);
    if (
      !Object.prototype.hasOwnProperty.call(nextPayload, "deliveryBy")
      && toNullableNumber(plainShipmentBeforeUpdate.deliveryBy) === null
      && plainShipmentBeforeUpdate.shippedFromInventory === true
    ) {
      nextPayload.deliveryBy = DELIVERY_BY.HOMIX;
    }
    /* A cleared <select>/<input> arrives as "", which is not null and so is put
       through the column validators — `shipmentType: ""` failed its isIn rule
       and the whole edit 500'd. Every nullable column here means "unset" by "". */
    for (const key of [
      "deliveryBy",
      "deliveryDate",
      "governorate",
      "scheduleStatus",
      "scheduledDeliveryDate",
      "shipmentStatus",
      "shipmentType",
      "shippingCompany",
      "shippingReceiveDate",
    ]) {
      if (nextPayload[key] === "") {
        nextPayload[key] = null;
      }
    }

    let cascadedOrderStatus: number | undefined;
    if (Object.prototype.hasOwnProperty.call(nextPayload, "shipmentStatus")) {
      cascadedOrderStatus = ORDER_STATUS_BY_SHIPMENT_STATUS[toNumber(nextPayload.shipmentStatus)];
      if (cascadedOrderStatus !== undefined) {
        nextPayload.status = cascadedOrderStatus;
      }
    }

    /* toBeCollected is only ever recalculated by the order-edit path
       (normalizeOrderMutationPayload), not here — so a shipping-fee or
       down-payment edit from this screen used to leave toBeCollected stale
       (still reflecting the old figures) until someone unrelatedly saved the
       order again. Recompute it ourselves whenever either moves, using the
       same formula, and let it override whatever stale toBeCollected the
       client happened to submit alongside it (the edit form's toBeCollected
       field isn't itself derived, so it can't be trusted once either input
       moves in the same request). */
    const recomputesCollection = Object.prototype.hasOwnProperty.call(nextPayload, "shippingFees")
      || Object.prototype.hasOwnProperty.call(nextPayload, "downPayment");
    if (recomputesCollection) {
      const subTotalPrice = toNumber(nextPayload.subTotalPrice ?? plainShipmentBeforeUpdate.subTotalPrice);
      const shippingFees = toNumber(nextPayload.shippingFees ?? plainShipmentBeforeUpdate.shippingFees);
      const totalDiscounts = toNumber(nextPayload.totalDiscounts ?? plainShipmentBeforeUpdate.totalDiscounts);
      const downPayment = toNumber(nextPayload.downPayment ?? plainShipmentBeforeUpdate.downPayment);
      nextPayload.toBeCollected = subTotalPrice + shippingFees - totalDiscounts - downPayment;
    }

    await shipment.update(nextPayload);
    if (Object.prototype.hasOwnProperty.call(nextPayload, "shipmentStatus")) {
      await logOrderFieldChange(
        shipmentId,
        plainShipmentBeforeUpdate.shipmentStatus,
        nextPayload.shipmentStatus,
        userId,
      );
    }
    if (cascadedOrderStatus !== undefined) {
      await logOrderFieldChange(
        shipmentId,
        plainShipmentBeforeUpdate.status,
        cascadedOrderStatus,
        userId,
        "status",
      );
    }
    for (const field of ["shippingFees", "downPayment", "receivedAmount"] as const) {
      if (Object.prototype.hasOwnProperty.call(nextPayload, field)) {
        await logOrderFieldChange(
          shipmentId,
          plainShipmentBeforeUpdate[field],
          nextPayload[field],
          userId,
          field,
        );
      }
    }
    if (recomputesCollection) {
      await logOrderFieldChange(
        shipmentId,
        plainShipmentBeforeUpdate.toBeCollected,
        nextPayload.toBeCollected,
        userId,
        "toBeCollected",
      );
    }
    return shipment;
  }

  /**
   * Applies the same partial update — shipment status, shipment type,
   * governorate, delivery-by, assignee — to several shipments at once, reusing
   * updateShipment per row so the status→order-status cascade, the empty-string
   * normalization, and the audit log entries all stay identical to a single edit.
   */
  public async bulkUpdateShipments(
    shipmentIds: number[],
    payload: Record<string, unknown>,
    userId?: number,
  ): Promise<number> {
    let updatedCount = 0;
    for (const shipmentId of shipmentIds) {
      const updated = await this.updateShipment(shipmentId, payload, userId);
      if (updated) {
        updatedCount += 1;
      }
    }
    return updatedCount;
  }

  public async deleteShipment(shipmentId: number): Promise<boolean> {
    const shipment = await orderModel.findByPk(shipmentId);
    if (!shipment) {
      return false;
    }

    await shipment.destroy();
    return true;
  }

  public async findNoteById(noteId: number): Promise<unknown | null> {
    return noteModel.findByPk(noteId);
  }

  public async createShipmentNote(shipmentId: number, text: string, userId: number): Promise<ShipmentNote> {
    const createdNote = await noteModel.create({
      entityId: shipmentId,
      entityType: "shipment",
      text,
      userId,
    });

    return mapShipmentNote(createdNote);
  }

  public async updateShipmentNote(noteId: number, text: string): Promise<ShipmentNote | null> {
    const note = await noteModel.findByPk(noteId);
    if (!note) {
      return null;
    }

    note.text = text;
    await note.save();

    return mapShipmentNote(note);
  }

  public async deleteShipmentNote(noteId: number): Promise<boolean> {
    const note = await noteModel.findByPk(noteId);
    if (!note) {
      return false;
    }

    await note.destroy();
    return true;
  }
}
