const { Op, where, or, literal } = require("sequelize");
const ExcelJS = require("exceljs");
const CustomerService = require("../customer/customer.service");
const ShopifyHelper = require("../helpers/shopifyHelper");
const OrderLine = require("../orderLines/orderline.model");
const Product = require("../product/product.model");
const ProductsService = require("../product/product.service");
const Order = require("./order.model");
const { sequelize } = require("../../../src/infrastructure/database");
const Vendor = require("../vendor/vendor.model");
const Customer = require("../customer/customer.model");
const Note = require("../notes/notes.model");
const User = require("../user/user.model");
const Notification = require("../notification/notification.model");
const {
  ORDER_STATUS,
  ORDER_SOURCE,
  USER_TYPES,
  ORDER_STATUS_Arabic,
  PAYMENT_STATUS,
  PAYMENT_STATUS_ARABIC,
  DELIVERY_STATUS,
  DELIVERY_STATUS_ARABIC,
  DELIVERY_BY,
  DELIVERY_BY_ARABIC,
  ORDER_SOURCE_ARABIC,
  MANUFACTURE_STATUS_ARABIC,
} = require("../../../config/constants");
const {
  applyOrderLinesToInventory,
} = require("../../../src/modules/shipments/inventory.movements");
const {
  getDaysSince,
  getDeliveryPriorityLabel,
  resolveDeliveryStatus,
  resolveOrderPriority,
} = require("../../../src/modules/orders/order.helpers");
const {
  splitImportedOrderByUnit,
} = require("../../../src/modules/orders/order-discounts");
const moment = require("moment-timezone");
const Attachment = require("../attachments/attachment.model");
const ProductType = require("../product/productType.model");
const Log = require("../logs/log.model");
const PREFIX = "H";
const CUSTOM_PREFIX = "CU";
const {
  calculateOrderFine,
  calculateOrderFineForRecord,
  resolveExpectedDeliveryDate,
} = require("../../../src/modules/orders/order-fines");
const FINAL_FINE_STATUSES = [
  ORDER_STATUS.CANCELED,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.REFUNDED,
  ORDER_STATUS.REPLACED,
  ORDER_STATUS.IN_INVENTORY,
];

const normalizeNumber = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
};

const resolveManualOrderDate = (value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  const cameFromDateOnlyInput = /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(raw);
  if (!cameFromDateOnlyInput) {
    const parsed = moment(value);
    return parsed.isValid() ? parsed.toDate() : new Date();
  }

  const nowInCairo = moment.tz("Africa/Cairo");
  return moment.tz(raw.slice(0, 10), "YYYY-MM-DD", true, "Africa/Cairo")
    .set({
      hour: nowInCairo.hour(),
      minute: nowInCairo.minute(),
      second: nowInCairo.second(),
      millisecond: nowInCairo.millisecond(),
    })
    .toDate();
};

/**
 * Shipping on a Shopify order lives in `shipping_lines` / `total_shipping_price_set`,
 * never in a `shippingFees` field — that name only exists on the manual-order
 * payload the frontend sends. Reading only `order.shippingFees` meant every
 * imported order stored 0 shipping.
 */
const getShopifyShippingTotal = (order) => {
  if (order.shippingFees !== undefined && order.shippingFees !== null) {
    return normalizeNumber(order.shippingFees);
  }

  if (Array.isArray(order.shipping_lines) && order.shipping_lines.length > 0) {
    /* A removed/superseded shipping line (e.g. the address changed after the
       order was placed) stays in the array with is_removed: true — Shopify's
       total_shipping_price_set can still include it, so summing shipping_lines
       blindly double-charges the stale rate on top of the current one. */
    const activeLines = order.shipping_lines.filter((shippingLine) => !shippingLine?.is_removed);
    if (activeLines.length > 0) {
      return activeLines.reduce(
        (total, shippingLine) => total + normalizeNumber(shippingLine?.price),
        0,
      );
    }
  }

  return normalizeNumber(order.total_shipping_price_set?.shop_money?.amount);
};

/**
 * An order-level amount (shipping, down payment) belongs to the whole order, but
 * one order becomes one row per unit. Each row takes a share proportional to its
 * value so the rows add back up to what the customer actually pays — assigning
 * the full amount to every row multiplied it by the number of splits.
 */
const distributeAmountByWeight = (total, weights) => {
  const totalCents = Math.round(normalizeNumber(total) * 100);
  const weightCents = weights.map((weight) => Math.round(normalizeNumber(weight) * 100));
  const weightTotal = weightCents.reduce((sum, weight) => sum + weight, 0);

  if (weightTotal <= 0 || totalCents === 0) {
    return weights.map(() => 0);
  }

  const shares = weightCents.map((weight) => Math.floor((totalCents * weight) / weightTotal));
  let remainder = totalCents - shares.reduce((sum, share) => sum + share, 0);

  // Leftover cents go to the largest rows, so the parts always sum to the whole.
  const byWeightDesc = weightCents
    .map((weight, index) => ({ index, weight }))
    .sort((left, right) => right.weight - left.weight);

  for (const { index } of byWeightDesc) {
    if (remainder <= 0) break;
    shares[index] += 1;
    remainder -= 1;
  }

  return shares.map((share) => share / 100);
};

/** Value of every line on the Shopify order, used to split order-level totals. */
const getOrderLineItemsTotal = (lineItems) => {
  if (!Array.isArray(lineItems)) {
    return 0;
  }

  return lineItems.reduce(
    (total, line) => total + normalizeNumber(line.price) * normalizeNumber(line.quantity),
    0,
  );
};

const calculateAmountToCollect = ({
  subTotalPrice,
  shippingFees,
  totalDiscounts,
  downPayment,
}) => {
  return (
    normalizeNumber(subTotalPrice)
    + normalizeNumber(shippingFees)
    - normalizeNumber(totalDiscounts)
    - normalizeNumber(downPayment)
  );
};

const formatExportDate = (value) => {
  if (!value) {
    return "";
  }

  const parsed = moment(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : "";
};

const EXPORT_SORT_FIELDS = new Set([
  "orderDate",
  "priority",
  "subTotalPrice",
  "totalPrice",
]);

const resolveExportSort = (sort, fallbackField = "orderDate") => {
  if (!sort || typeof sort !== "object" || Array.isArray(sort)) {
    return [[fallbackField, "DESC"]];
  }

  for (const [field, rawDirection] of Object.entries(sort)) {
    if (!EXPORT_SORT_FIELDS.has(field)) {
      continue;
    }

    const direction = Number(rawDirection) === 1 ? "ASC" : "DESC";
    return [[field, direction]];
  }

  return [[fallbackField, "DESC"]];
};

class OrderService {
  static async importOrders(parameters, fromImport) {
    const fields = [];
    const args = ["orders", fields, { ...parameters, status: "any" }];
    if (fromImport) {
      args.push(async (orders) => {
        await OrderService.saveImportedOrders(orders);
      });
      await ShopifyHelper.importData(...args);
    } else {
      const orders = await ShopifyHelper.importData(...args);
      const result = await OrderService.saveImportedOrders(orders);
      return result;
    }
  }
  static async saveImportedOrders(ordersFromShopify, isShipment = false, user) {
    let orders = [];
    // Manual orders carry no name yet (it is generated below), so only Shopify
    // orders take part in the duplicate check.
    const orderNames = ordersFromShopify
      .map((order) => order.name)
      .filter(Boolean);
    const existingOrders = orderNames.length
      ? await Order.findAll({
          where: {
            name: {
              [Op.in]: orderNames,
            },
          },
          attributes: ["name"],
        })
      : [];
    const existingOrdersSet = new Set(
      existingOrders.map((order) => order.name),
    );
    ordersFromShopify = ordersFromShopify.filter(
      (order) => !order.name || !existingOrdersSet.has(order.name),
    );
    if (!ordersFromShopify || ordersFromShopify.length === 0) {
      return {
        status: true,
        statusCode: 200,
        message: "No new orders to import",
      };
    }
    // Ordered by number (not code) and including soft-deleted rows, otherwise a
    // deleted manual order lets the next one reuse its number.
    const lastCustomOrder = await Order.findOne({
      where: {
        number: {
          [Op.not]: null,
        },
        custom: true,
      },
      order: [[literal('CAST("number" AS INTEGER)'), "DESC"]],
      attributes: ["number"],
      paranoid: false,
    });
    // Get last custom code number or default to 0
    let lastCustomNumber = lastCustomOrder ? lastCustomOrder.number : 0;

    ordersFromShopify.forEach((order) => {
      /* A manual order has no natural shared id the way a Shopify order does,
         so one number/orderNumber/name is assigned here — once per order, not
         per line — and carried into every split below via its spread. That
         matches how Shopify-imported splits already share the parent order's
         number; only `code` (assigned per split, further down) stays unique
         per line item. */
      if (!order.id) {
        const newNumber = parseInt(lastCustomNumber, 10) + 1;
        order.number = `${newNumber}`;
        order.order_number = `${newNumber + 1000}`;
        order.name = `#${CUSTOM_PREFIX}${newNumber}`;
        lastCustomNumber = newNumber;
      }

      /* One Shopify order becomes one row per line item, but its shipping is
         charged once. Remember the parent totals so each split can take a
         proportional share instead of repeating the full amount. */
      const splits = splitImportedOrderByUnit(order);
      const weights = splits.map((split) => getOrderLineItemsTotal(split.line_items));
      const shippingShares = distributeAmountByWeight(getShopifyShippingTotal(order), weights);
      const downPaymentShares = distributeAmountByWeight(order.downPayment, weights);

      splits.forEach((split, index) => {
        split.__shippingShare = shippingShares[index];
        split.__downPaymentShare = downPaymentShares[index];
      });

      orders.push(...splits);
    });

    const productsIds = new Set();
    const customers = [];
    const lastOrder = await Order.findOne({
      where: {
        code: {
          [Op.not]: null,
        },
      },
      order: [[literal('CAST("code" AS INTEGER)'), "DESC"]],
      attributes: ["code"],
    });

    // Get last code number or default to 0
    const lastCode = lastOrder?.code || `0`;
    const codeNumber = parseInt(lastCode.replace(PREFIX, ""), 10);

    if (isNaN(codeNumber)) {
      throw new Error("Invalid order code format");
    }
    let nextNumber = codeNumber + 1;

    for (const order of orders) {
      for (const line of order.line_items) {
        if (line.product_id) {
          productsIds.add(String(line.product_id));
        }
      }
      if (order.customer) {
        customers.push(order.customer);
      }
    }
    const [{ productsMap, vendorsMap }, customersNamesMap] = await Promise.all([
      ProductsService.getProductsMappedByShopifyIds([...productsIds]),
      CustomerService.getCustomersMappedByNames(customers),
    ]);

    const lines = [];

    orders = orders
      .filter((order) => order.customer)
      .map((order) => {
        const line = order.line_items[0];
        const product = line.product_id
          ? productsMap[line.product_id]
          : productsMap["custom"];
        if (!product) {
          throw new Error(
            `Product with id ${line.product_id} not found in products map`,
          );
        }
        const vendor = vendorsMap[product.vendorId];
        const paymentStatus =
          order.financial_status === "paid"
            ? PAYMENT_STATUS.PAID
            : PAYMENT_STATUS.COD;
        let totalCost = 0;
        let totalPrice = 0;
        let subTotalPrice = 0;
        let total_discounts = 0;
        order.line_items.forEach((line) => {
          const variant = product.variants
            ? product.variants.find(
                (variant) =>
                  variant.shopifyId.toString() === line.variant_id.toString(),
              )
            : null;
          const cost = variant ? Number(variant.cost) || 0 : 0;
          line.unitCost = cost;
          line.cost = cost * line.quantity;
          totalCost += line.cost;
          subTotalPrice += normalizeNumber(line.price) * line.quantity;
          total_discounts += line.discount || 0;
        });
        /* Per-line `discount` only exists for Shopify imports (discount_allocations).
           Manual order creation sends a single order-level discount instead
           (normalizeOrderMutationPayload's `totalDiscounts`/`discount`) — respect it
           when present, or every manually-entered discount silently becomes 0. */
        const explicitOrderDiscount = order.totalDiscounts ?? order.discount;
        if (explicitOrderDiscount !== undefined && explicitOrderDiscount !== null && explicitOrderDiscount !== "") {
          total_discounts = normalizeNumber(explicitOrderDiscount);
        }
        const customerKey = order.id
          ? order.customer.id
          : `${
              order.customer.firstName ||
              order.customer.first_name ||
              order.customer.default_address?.first_name ||
              ""
            }${
              order.customer.lastName ||
              order.customer.last_name ||
              order.customer.default_address?.last_name ||
              ""
            }${
              order.customer.email ||
              order.customer.default_address?.email ||
              ""
            }${
              order.customer.phone ||
              order.customer.default_address?.phone ||
              ""
            }`;

        // number/orderNumber/name are assigned once per order (Shopify or
        // manual) before splitting, above, so every line item shares them.
        const number = order.number;
        const orderNumber = order.order_number;
        const name = order.name;
        const custom = !order.id;
        const codeNumber = nextNumber;
        nextNumber++;
        /* Proportional share of the parent order's shipping, so the splits sum
           back to what the customer actually pays. */
        /* Shipping and «جدية الشراء» are paid once for the whole order; each
           split carries the share computed when the order was split. Before this,
           every split carried the full amount and toBeCollected went negative. */
        const shippingFees = normalizeNumber(order.__shippingShare);
        const downPayment = normalizeNumber(order.__downPaymentShare);
        const toBeCollected = calculateAmountToCollect({
          downPayment,
          shippingFees,
          subTotalPrice,
          totalDiscounts: total_discounts,
        });

        const orderDate = order.id
          ? order.orderDate || order.created_at || new Date()
          : resolveManualOrderDate(order.orderDate);
        const expectedDeliveryDate = resolveExpectedDeliveryDate({
          daysToDeliver: vendor?.daysToDeliver,
          expectedDeliveryDate: order.expectedDeliveryDate,
          orderDate,
        });
        const requestedDeliveryBy = Number(order.deliveryBy);
        const deliveryBy = isShipment
          ? DELIVERY_BY.HOMIX
          : [DELIVERY_BY.HOMIX, DELIVERY_BY.VENDOR].includes(requestedDeliveryBy)
            ? requestedDeliveryBy
            : null;
        let obj = {
          shopifyId: order.id ? String(order.id) : null,
          name,
          code: codeNumber,
          number,
          orderNumber,
          subTotalPrice: subTotalPrice,
          totalDiscounts: total_discounts,
          totalTax: order.total_tax,
          totalPrice: subTotalPrice - total_discounts,
          orderDate,
          customerId: customersNamesMap[customerKey],
          totalCost,
          custom,
          shippedFromInventory: deliveryBy === DELIVERY_BY.HOMIX,
          shippingReceiveDate: order.shippingReceiveDate || null,
          shippingCompany: order.shippingCompany || null,
          deliveryDate: order.deliveryDate || null,
          governorate: order.governorate || null,
          shipmentStatus: order.shipmentStatus || null,
          scheduleStatus: order.scheduleStatus || null,
          shipmentType: order.shipmentType || "separate",
          deliveryBy,
          expectedDate: order.expectedDate || null,
          expectedDeliveryDate,
          receivedAmount: order.receivedAmount || 0,
          commission: order.commission || 0,
          shippingFees,
          PoDate: order.PoDate || null,
          downPayment,
          toBeCollected,
          itemShipping: order.itemShipping || 0,
          deliveryStatus: order.deliveryStatus || null,
          orderSource:
            order.orderSource
            || (order.id ? ORDER_SOURCE.ONLINE : ORDER_SOURCE.SHOWROOM),
          fine: calculateOrderFine({
            baseAmount: subTotalPrice,
            daysToDeliver: vendor?.daysToDeliver,
            expectedDeliveryDate,
            orderDate,
          }),
          priority: order.priority || undefined,
          // An explicitly picked administrator wins over the vendor's default one.
          userId: order.userId || vendor?.accountManagerUserId || null,
        };
        // status: order.status || null,
        // financialStatus: order.financial_status || null,
        // paymentStatus: order.paymentStatus || null,
        lines.push({
          order_id: obj.code,
          line_items: order.line_items,
        });
        if (order.status) {
          obj.status = order.status;
        }
        if (
          Number(obj.status) === ORDER_STATUS.DELIVERED &&
          !obj.deliveryDate
        ) {
          obj.deliveryDate = new Date();
          obj.fine = calculateOrderFine({
            baseAmount: subTotalPrice,
            daysToDeliver: vendor?.daysToDeliver,
            endDate: obj.deliveryDate,
            expectedDeliveryDate: obj.expectedDeliveryDate,
            orderDate: obj.orderDate,
          });
        }
        if (order.financialStatus) {
          obj.financialStatus = order.financialStatus;
        }
        if (order.paymentStatus) {
          obj.paymentStatus = order.paymentStatus;
        } else {
          obj.paymentStatus = paymentStatus;
        }
        return obj;
      });

    const result = await Order.bulkCreate(orders);
    const savedOrders = result.map((order) => order.toJSON());
    const orderLines = [];
    const orderLogs = [];
    for (const { order_id, line_items } of lines) {
      const order = savedOrders.find(
        (order) => order.code === String(order_id),
      );
      for (const line of line_items) {
        orderLines.push({
          orderId: order.id,
          productId: line.product_id
            ? productsMap[line.product_id].id
            : productsMap["custom"].id,
          shopifyId: String(line.id),
          title: line.title,
          name: line.name,
          price: line.price,
          quantity: line.quantity,
          sku: line.sku,
          variant_id: line.variant_id,
          discount: line.discount,
          cost: line.cost,
          unitCost: line.unitCost,
        });
      }
    }
    await OrderLine.bulkCreate(orderLines);

    // New orders consume stock for the products they contain; the helper clamps
    // at zero so an order larger than the stock on hand just empties the row.
    await applyOrderLinesToInventory(
      orderLines.map((line) => ({
        productCode: line.sku,
        productId: line.productId,
        quantity: line.quantity,
      })),
      "consume",
    );
    for (const order of savedOrders) {
      orderLogs.push({
        action: "create",
        entityType: "order",
        entityId: order.id,
        field: "order_received",
        userId: user?.id || null,
      });
      await OrderService.sendNotification(order.id, order.orderNumber, {
        orderId: order.id,
        type: "orderCreate",
      });
      orderLogs.push({
        action: "notify",
        entityType: "order",
        entityId: order.id,
        field: "order_received_notification",
        to: "sent",
        userId: user?.id || null,
      });
    }
    if (orderLogs.length) {
      await Log.bulkCreate(orderLogs);
    }
    return {
      status: true,
      statusCode: 200,
      message: "Orders imported successfully",
    };
  }
  static async getOrders({
    page = 1,
    size = 50,
    vendorName,
    vendorId,
    orderNumber,
    financialStatus,
    status,
    deliveryStatus,
    startDate,
    endDate,
    vendorUser,
    paymentStatus,
  }) {
    let whereClause = {
      [Op.and]: [],
    };

    if (orderNumber) {
      whereClause[Op.and].push({
        [Op.or]: [
          sequelize.where(sequelize.fn("lower", sequelize.col("Order.name")), {
            [Op.like]: `%${orderNumber.toLowerCase()}%`,
          }),
          sequelize.where(sequelize.fn("lower", sequelize.col("number")), {
            [Op.like]: `%${orderNumber.toLowerCase()}%`,
          }),
          sequelize.where(sequelize.fn("lower", sequelize.col("orderNumber")), {
            [Op.like]: `%${orderNumber.toLowerCase()}%`,
          }),
        ],
      });
    }

    if (financialStatus) {
      whereClause[Op.and].push(
        sequelize.where(
          sequelize
            .fn("lower", sequelize.col("financialStatus"))
            .cast(sequelize.Sequelize.STRING),
          {
            [Op.like]: Number(financialStatus),
          },
        ),
      );
    }
    if (paymentStatus) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.paymentStatus"), {
          [Op.eq]: Number(paymentStatus),
        }),
      );
    }
    if (deliveryStatus) {
      const statusArray = deliveryStatus.split(",").map(Number);
      const operations = [];

      const today = moment().startOf("day");
      const twoDaysLater = moment(today).add(2, "days");

      if (statusArray.includes(DELIVERY_STATUS.LATE)) {
        operations.push({
          [Op.lt]: today.toDate(),
        });
      }

      if (statusArray.includes(DELIVERY_STATUS.ALMOST_LAST)) {
        operations.push({
          [Op.and]: [
            { [Op.gte]: today.toDate() },
            { [Op.lt]: twoDaysLater.toDate() },
          ],
        });
      }

      if (statusArray.includes(DELIVERY_STATUS.ON_SCHEDULE)) {
        operations.push({
          [Op.gte]: twoDaysLater.toDate(),
        });
      }

      if (operations.length) {
        whereClause[Op.and].push(
          sequelize.where(sequelize.col("Order.expectedDeliveryDate"), {
            [Op.and]: [{ [Op.ne]: null }, { [Op.or]: operations }],
          }),
        );
      }
    }

    if (startDate && endDate) {
      let startStartDate = moment
        .tz(new Date(startDate), "Africa/Cairo")
        .startOf("day")
        .utc()
        .toDate();

      let endOfEndDate = moment
        .tz(new Date(endDate), "Africa/Cairo")
        .endOf("day")
        .utc()
        .toDate();

      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.orderDate"), {
          [Op.gte]: startStartDate,
        }),
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.orderDate"), {
          [Op.lte]: endOfEndDate,
        }),
      );
    }
    if (vendorName) {
      whereClause[Op.and].push(
        sequelize.where(
          sequelize.fn(
            "lower",
            sequelize.col("orderLines.product.vendor.name"),
          ),
          {
            [Op.like]: `%${vendorName.toLowerCase()}%`,
          },
        ),
      );
    }
    if (vendorId) {
      vendorId = vendorId.split(",");
      if (vendorId.length) {
        whereClause[Op.and].push(
          sequelize.where(sequelize.col("orderLines.product.vendor.id"), {
            [Op.in]: vendorId.map((id) => Number(id)),
          }),
        );
      }
    }

    if (vendorUser) {
      const allowedVendorStatuses = [
        ORDER_STATUS.IN_PROGRESS,
        ORDER_STATUS.DELIVERED,
        ORDER_STATUS.REFUNDED,
        ORDER_STATUS.REPLACED,
        ORDER_STATUS.IN_INVENTORY,
      ];
      let statuses = allowedVendorStatuses;

      if (status) {
        const requestedStatuses = status.split(",").map((s) => Number(s));
        if (requestedStatuses.length) {
          statuses = requestedStatuses.filter((s) =>
            allowedVendorStatuses.includes(s),
          );
        }
      }
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.status"), {
          [Op.in]: statuses,
        }),
      );
    } else if (status) {
      status = status.split(",");
      if (status.length) {
        whereClause[Op.and].push(
          sequelize.where(sequelize.col("Order.status"), {
            [Op.in]: status.map((s) => Number(s)),
          }),
        );
      }
    }
    whereClause = whereClause[Op.and].length ? whereClause : {};

    // Optimize count query when no vendor filters (avoid expensive joins for count)
    let count;
    let useOptimizedCount = !vendorName && !vendorId;

    if (useOptimizedCount) {
      // Build simple WHERE clause for direct Order table query (no joins needed)
      const simpleConditions = [];
      if (whereClause[Op.and]) {
        for (const condition of whereClause[Op.and]) {
          // Only include conditions that don't reference joined tables
          const condStr = JSON.stringify(condition);
          if (
            !condStr.includes("orderLines") &&
            !condStr.includes("product") &&
            !condStr.includes("vendor")
          ) {
            simpleConditions.push(condition);
          }
        }
      }

      // Build WHERE clause for count
      const countWhere =
        simpleConditions.length > 0
          ? { [Op.and]: simpleConditions }
          : whereClause;

      // Fast count without joins
      count = await Order.count({
        where: countWhere,
      });
    }

    // Build include array - use separate queries when no vendor filters for better performance
    const includes = [
      {
        model: OrderLine,
        required: true,
        as: "orderLines",
        separate: useOptimizedCount, // Load in separate query when no vendor filters
        include: [
          {
            model: Product,
            as: "product",
            required: true,
            attributes: [
              "id",
              "title",
              "image",
              "vendorId",
              "typeId",
              "variants",
            ],
            include: [
              {
                model: Vendor,
                as: "vendor",
                required: true,
                attributes: ["id", "name", "daysToDeliver"],
              },
              {
                model: ProductType,
                as: "type",
                attributes: ["name"],
                required: false,
              },
            ],
          },
        ],
      },
      {
        model: Note,
        as: "notesList",
        required: false,
        separate: true, // Always load notes separately
        limit: 10,
        include: [
          {
            model: User,
            as: "user",
            required: false,
            attributes: ["firstName", "lastName"],
          },
          {
            model: Attachment,
            as: "attachments",
            required: false,
          },
        ],
      },
      {
        model: Customer,
        as: "customer",
        required: false,
        attributes: [
          "id",
          "firstName",
          "lastName",
          "phoneNumber",
          "email",
          "address",
        ],
      },
    ];

    const queryMethod = useOptimizedCount ? "findAll" : "findAndCountAll";
    const orders = await Order[queryMethod]({
      include: includes,
      where: whereClause,
      order: [["orderDate", "DESC"]],
      limit: Number(size),
      offset: (page - 1) * Number(size),
      // Use distinct when filtering by vendor to handle duplicates from joins
      distinct: vendorName || vendorId ? true : false,
      // subQuery causes "missing FROM-clause" errors with nested where clauses
      subQuery: false,
    });

    // Format response consistently
    const result = useOptimizedCount ? { rows: orders, count: count } : orders; // orders is from findAndCountAll if vendor filters present

    for (const order of result.rows) {
      if (order.expectedDeliveryDate) {
        if (
          moment(order.expectedDeliveryDate).isBefore(
            moment().startOf("day").toDate(),
          )
        ) {
          order.deliveryStatus = DELIVERY_STATUS.LATE;
        } else if (
          moment(order.expectedDeliveryDate).isBefore(
            moment().startOf("day").add(2, "days").toDate(),
          )
        ) {
          order.deliveryStatus = DELIVERY_STATUS.ALMOST_LAST;
        } else {
          order.deliveryStatus = DELIVERY_STATUS.ON_SCHEDULE;
        }
      }
    }
    return {
      status: true,
      statusCode: 200,
      data: {
        orders: result.rows,
        totalPages: Math.ceil(result.count / Number(size)),
      },
    };
  }
  static async exportOrders(
    res,
    {
      vendorName,
      vendorId,
      orderNumber,
      financialStatus,
      status,
      deliveryStatus,
      startDate,
      endDate,
      vendorUser,
      paymentStatus,
      sort,
      operationCode,
      customerName,
      productCode,
      manufactureStatus,
      priority,
      deliveryBy,
      orderSource,
      userId,
    },
  ) {
    let whereClause = {
      [Op.and]: [],
    };

    // Mirrors order.repo.ts::buildFilters so a filter narrowing the on-screen
    // table also narrows the export — otherwise rows visible in the table
    // silently drop out of (or back into) the exported file.
    if (operationCode) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.fn("lower", sequelize.col("Order.code")), {
          [Op.like]: `%${operationCode.toLowerCase()}%`,
        }),
      );
    }
    if (customerName) {
      whereClause[Op.and].push(
        sequelize.where(
          sequelize.fn("concat", sequelize.col("customer.firstName"), " ", sequelize.col("customer.lastName")),
          { [Op.like]: `%${customerName}%` },
        ),
      );
    }
    if (productCode) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.fn("lower", sequelize.col("orderLines.sku")), {
          [Op.like]: `%${productCode.toLowerCase()}%`,
        }),
      );
    }
    if (manufactureStatus) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.manufactureStatus"), {
          [Op.in]: manufactureStatus.split(",").map(Number),
        }),
      );
    }
    if (priority) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.priority"), {
          [Op.in]: priority.split(",").map(Number),
        }),
      );
    }
    if (deliveryBy) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.deliveryBy"), {
          [Op.in]: deliveryBy.split(",").map(Number),
        }),
      );
    }
    if (orderSource) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.orderSource"), {
          [Op.in]: orderSource.split(",").map(Number),
        }),
      );
    }
    if (userId) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.userId"), { [Op.eq]: userId }),
      );
    }

    if (orderNumber) {
      whereClause[Op.and].push({
        [Op.or]: [
          sequelize.where(sequelize.fn("lower", sequelize.col("Order.name")), {
            [Op.like]: `%${orderNumber.toLowerCase()}%`,
          }),
          sequelize.where(sequelize.fn("lower", sequelize.col("number")), {
            [Op.like]: `%${orderNumber.toLowerCase()}%`,
          }),
          sequelize.where(sequelize.fn("lower", sequelize.col("orderNumber")), {
            [Op.like]: `%${orderNumber.toLowerCase()}%`,
          }),
        ],
      });
    }

    if (financialStatus) {
      whereClause[Op.and].push(
        sequelize.where(
          sequelize
            .fn("lower", sequelize.col("financialStatus"))
            .cast(sequelize.Sequelize.STRING),
          {
            [Op.like]: Number(financialStatus),
          },
        ),
      );
    }
    if (paymentStatus) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.paymentStatus"), {
          [Op.eq]: Number(paymentStatus),
        }),
      );
    }
    if (deliveryStatus) {
      const statusArray = deliveryStatus.split(",").map(Number);
      const operations = [];

      const today = moment().startOf("day");
      const twoDaysLater = moment(today).add(2, "days");

      if (statusArray.includes(DELIVERY_STATUS.LATE)) {
        operations.push({
          [Op.lt]: today.toDate(),
        });
      }

      if (statusArray.includes(DELIVERY_STATUS.ALMOST_LAST)) {
        operations.push({
          [Op.and]: [
            { [Op.gte]: today.toDate() },
            { [Op.lt]: twoDaysLater.toDate() },
          ],
        });
      }

      if (statusArray.includes(DELIVERY_STATUS.ON_SCHEDULE)) {
        operations.push({
          [Op.gte]: twoDaysLater.toDate(),
        });
      }

      if (operations.length) {
        whereClause[Op.and].push(
          sequelize.where(sequelize.col("Order.expectedDeliveryDate"), {
            [Op.and]: [{ [Op.ne]: null }, { [Op.or]: operations }],
          }),
        );
      }
    }

    if (startDate && endDate) {
      let startStartDate = moment
        .tz(new Date(startDate), "Africa/Cairo")
        .startOf("day")
        .utc()
        .toDate();

      let endOfEndDate = moment
        .tz(new Date(endDate), "Africa/Cairo")
        .endOf("day")
        .utc()
        .toDate();

      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.orderDate"), {
          [Op.gte]: startStartDate,
        }),
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.orderDate"), {
          [Op.lte]: endOfEndDate,
        }),
      );
    }
    if (vendorName) {
      whereClause[Op.and].push(
        sequelize.where(
          sequelize.fn(
            "lower",
            sequelize.col("orderLines.product.vendor.name"),
          ),
          {
            [Op.like]: `%${vendorName.toLowerCase()}%`,
          },
        ),
      );
    }
    if (vendorId) {
      vendorId = vendorId.split(",");
      if (vendorId.length) {
        whereClause[Op.and].push(
          sequelize.where(sequelize.col("orderLines.product.vendor.id"), {
            [Op.in]: vendorId.map((id) => Number(id)),
          }),
        );
      }
    }

    if (vendorUser) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.status"), {
          [Op.gte]: ORDER_STATUS.IN_PROGRESS,
        }),
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.status"), {
          [Op.ne]: ORDER_STATUS.CANCELED,
        }),
      );
    } else if (status) {
      status = status.split(",");
      if (status.length) {
        whereClause[Op.and].push(
          sequelize.where(sequelize.col("Order.status"), {
            [Op.in]: status.map((s) => Number(s)),
          }),
        );
      }
    }
    whereClause = whereClause[Op.and].length ? whereClause : {};
    const exportOrder = resolveExportSort(sort);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", "attachment; filename=orders.xlsx");

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
    const worksheet = workbook.addWorksheet("orders");

    // Column order is fixed by the business spec, do not reshuffle.
    worksheet.columns = [
      { header: "رقم العملية", key: "code" },
      { header: "رقم الطلب", key: "orderNumber" },
      { header: "كود المنتج", key: "productCode" },
      { header: "حالة الطلب", key: "status" },
      { header: "البائع", key: "vendorName" },
      { header: "مصدر الطلب", key: "orderSource" },
      { header: "حالة الدفع", key: "paymentStatus" },
      { header: "سعر التكلفة", key: "cost" },
      { header: "سعر البيع", key: "price" },
      { header: "المبلغ المطلوب تحصيله", key: "amountToCollect" },
      { header: "التوصيل بواسطة", key: "deliveryBy" },
      { header: "حالة التأخير", key: "lateStatus" },
      { header: "الأولوية", key: "priority" },
      { header: "تاريخ الطلب", key: "orderDate" },
      { header: "تاريخ التصنيع", key: "poDate" },
      { header: "عداد الأيام", key: "daysCounter" },
      { header: "المسؤول", key: "assignee" },
      { header: "النوع", key: "itemType" },
    ].map((column) => ({
      ...column,
      style: { alignment: { horizontal: "right" } },
      width: 22,
    }));
    const CHUNK_SIZE = 500;
    let offset = 0;
    let hasMore = true;

    // Optimize includes - load orderLines separately when no vendor/product filters
    // that need to filter through the join (a `separate` load can't be filtered
    // by a where clause referencing the joined table's columns).
    const useOptimizedQuery = !vendorName && !vendorId && !productCode;

    while (hasMore) {
      const chunk = await Order.findAll({
        include: [
          {
            model: OrderLine,
            required: true,
            as: "orderLines",
            separate: useOptimizedQuery, // Load separately when no vendor filters
            include: [
              {
                model: Product,
                as: "product",
                required: true,
                attributes: ["id", "title", "variants", "vendorId", "typeId"],
                include: [
                  {
                    model: Vendor,
                    as: "vendor",
                    required: true,
                    attributes: ["id", "name"],
                  },
                  {
                    model: ProductType,
                    as: "type",
                    attributes: ["name"],
                    required: false,
                  },
                ],
              },
            ],
          },
          {
            model: Customer,
            as: "customer",
            required: false,
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: User,
            as: "user",
            required: false,
            attributes: ["firstName", "lastName"],
          },
        ],
        where: whereClause,
        order: exportOrder,
        offset,
        limit: CHUNK_SIZE,
        subQuery: false,
      });

      for (const order of chunk) {
        const amountToCollect
          = Number(order.paymentStatus) === PAYMENT_STATUS.PAID
            ? 0
            : normalizeNumber(order.toBeCollected)
              || calculateAmountToCollect({
                downPayment: order.downPayment,
                shippingFees: order.shippingFees,
                subTotalPrice: order.subTotalPrice,
                totalDiscounts: order.totalDiscounts,
              });
        const lateStatus = resolveDeliveryStatus(
          order.deliveryStatus,
          order.expectedDeliveryDate,
        );
        const priority = resolveOrderPriority(
          order.priority,
          order.deliveryStatus,
          order.expectedDeliveryDate,
        );
        const assignee = order.user
          ? `${order.user.firstName || ""} ${order.user.lastName || ""}`.trim()
          : "";
        const daysCounter = getDaysSince(order.orderDate);

        for (const line of order.orderLines) {
          const variant = line.product.variants.find(
            (variant) => String(variant.shopifyId) === String(line.variant_id),
          );
          worksheet.addRow({
            amountToCollect,
            assignee,
            code: order.code,
            cost: line.cost,
            daysCounter: daysCounter ?? "",
            deliveryBy: DELIVERY_BY_ARABIC[order.deliveryBy] || "",
            itemType: line.product.type?.name || "",
            lateStatus: DELIVERY_STATUS_ARABIC[lateStatus] || "",
            orderDate: formatExportDate(order.orderDate),
            orderNumber: order.orderNumber,
            orderSource: ORDER_SOURCE_ARABIC[order.orderSource] || "",
            paymentStatus:
              PAYMENT_STATUS_ARABIC[order.paymentStatus] || order.paymentStatus,
            poDate: formatExportDate(order.PoDate),
            price: line.price * line.quantity,
            priority: getDeliveryPriorityLabel(priority),
            productCode: variant ? variant.sku : "",
            status: ORDER_STATUS_Arabic[order.status] || order.status,
            vendorName: line.product.vendor.name,
          });
        }
      }
      hasMore = chunk.length > 0;
      offset += CHUNK_SIZE;
    }

    await workbook.commit();
    res.end();
  }

  static async financialReport(vendorId, startDate, endDate) {
    let startStartDate = startDate
      ? moment
          .tz(new Date(startDate), "Africa/Cairo")
          .startOf("day")
          .utc()
          .toDate()
      : moment().tz(new Date(), "Africa/Cairo").startOf("month").utc();
    let endOfEndDate = endDate
      ? moment.tz(new Date(endDate), "Africa/Cairo").endOf("day").utc().toDate()
      : moment().tz(new Date(), "Africa/Cairo").endOf("day").utc().toDate();

    let whereClause = {
      [Op.and]: [
        sequelize.where(sequelize.col("orderDate"), {
          [Op.gte]: startStartDate,
        }),
        sequelize.where(sequelize.col("orderDate"), {
          [Op.lte]: endOfEndDate,
        }),
      ],
    };

    if (vendorId && vendorId !== "0") {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("orderLines.product.vendor.id"), {
          [Op.eq]: vendorId,
        }),
      );
    }
    const orders = await Order.findAll({
      include: [
        {
          model: OrderLine,
          required: true,
          as: "orderLines",
          include: {
            model: Product,
            as: "product",
            required: true,
            include: {
              model: Vendor,
              as: "vendor",
              required: true,
            },
          },
        },
      ],
      where: whereClause,
    });

    let whereClause2 = {
      [Op.and]: [
        sequelize.where(sequelize.col("deletedAt"), {
          [Op.gte]: startStartDate,
        }),
        sequelize.where(sequelize.col("deletedAt"), {
          [Op.lte]: endOfEndDate,
        }),
      ],
    };

    if (vendorId && vendorId !== "0") {
      whereClause2[Op.and].push(
        sequelize.where(sequelize.col("orderLines.product.vendor.id"), {
          [Op.eq]: vendorId,
        }),
      );
    }

    let totalCost = 0;
    let totalRevenue = 0;
    let totalDiscount = 0;
    let totalProfit = 0;
    let totalCommission = 0;
    let totalTax = 0;
    let count = 0;
    let totalPaid = 0;
    let subTotal = 0;
    let totalDownPayment = 0;
    let totalToBeCollected = 0;
    let shippingFees = 0;
    const DeliveredOrders = {
      ordersCount: 0,
      totalTax: 0,
      totalCost: 0,
      totalRevenue: 0,
      totalDiscount: 0,
      totalProfit: 0,
      totalCommission: 0,
      totalPaid: 0,
      subTotal: 0,
      totalDownPayment: 0,
      totalToBeCollected: 0,
    };
    const DeletedOrders = {
      subTotal: 0,
      totalDiscount: 0,
    };
    // const halfCompletedOrders = {
    //   ordersCount: 0,
    //   totalTax: 0,
    //   totalCost: 0,
    //   totalRevenue: 0,
    //   totalDiscount: 0,
    //   totalProfit: 0,
    //   totalCommission: 0,
    //   totalPaid: 0,
    //   subTotal: 0,
    //   totalDownPayment: 0,
    //   totalToBeCollected: 0,
    // };
    const vendorsMap = {};
    const productsMap = {};

    for (const order of orders) {
      if (order.status === ORDER_STATUS.DELIVERED) {
        DeliveredOrders.ordersCount++;
        DeliveredOrders.totalTax += +order.totalTax;
        DeliveredOrders.totalCost += +order.totalCost;
        DeliveredOrders.totalRevenue += +order.totalPrice;
        DeliveredOrders.totalDiscount += +order.totalDiscounts;
        DeliveredOrders.totalProfit +=
          +order.totalPrice -
          +order.totalCost -
          +order.commission -
          +order.totalTax;
        DeliveredOrders.totalCommission += +order.commission;
        DeliveredOrders.totalPaid += +order.totalPrice;
        DeliveredOrders.subTotal += +order.subTotal;
        DeliveredOrders.totalDownPayment += +order.downPayment;
        DeliveredOrders.totalToBeCollected += +order.toBeCollected;
      }
      // if (order.status === ORDER_STATUS.HALF_COMPLETED) {
      //   halfCompletedOrders.ordersCount++;
      //   halfCompletedOrders.totalTax += +order.totalTax;
      //   halfCompletedOrders.totalCost += +order.totalCost;
      //   halfCompletedOrders.totalRevenue += +order.totalPrice;
      //   halfCompletedOrders.totalDiscount += +order.totalDiscounts;
      //   halfCompletedOrders.totalProfit +=
      //     +order.totalPrice -
      //     +order.totalCost -
      //     +order.commission -
      //     +order.totalTax;
      //   halfCompletedOrders.totalCommission += +order.commission;
      //   halfCompletedOrders.totalPaid += +order.totalPrice;
      //   halfCompletedOrders.subTotal += +order.subTotal;
      //   halfCompletedOrders.totalDownPayment += +order.downPayment;
      //   halfCompletedOrders.totalToBeCollected += +order.toBeCollected;
      // }
      for (const line of order.orderLines) {
        if (!vendorsMap[line.product.vendor.id]) {
          vendorsMap[line.product.vendor.id] = {
            vendorId: line.product.vendor.id,
            vendorName: line.product.vendor.name,
            revenue: 0,
            profit: 0,
          };
        }
        vendorsMap[line.product.vendor.id].revenue += +line.price;
        vendorsMap[line.product.vendor.id].profit +=
          +line.price - +line.cost - +line.commission - +line.tax;

        if (!productsMap[line.product.id]) {
          productsMap[line.product.id] = {
            productId: line.product.id,
            productName: line.product.title,
            productImage: line.product.image,
            sku: line.sku || "",
            revenue: 0,
            profit: 0,
          };
        }
        productsMap[line.product.id].revenue += +line.price;
        productsMap[line.product.id].profit +=
          +line.price - +line.cost - +line.commission - +line.tax;
      }
      count++;
      totalCost += +order.totalCost;
      totalRevenue += +order.totalPrice;
      totalDiscount += +order.totalDiscounts;
      totalCommission += +order.commission;
      totalTax += +order.totalTax;
      totalPaid += +order.totalPrice;
      subTotal += +order.subTotalPrice;
      totalDownPayment += +order.downPayment;
      totalToBeCollected += +order.toBeCollected;
      shippingFees += +order.shippingFees || 0;
    }
    totalProfit = totalRevenue - totalCost - totalCommission - totalTax;
    const total = subTotal - totalDiscount + shippingFees;
    return {
      status: true,
      statusCode: 200,
      data: {
        ordersCount: count,
        totalTax,
        totalCost,
        totalRevenue: total,
        totalDiscount,
        totalProfit,
        totalCommission,
        totalPaid,
        subTotal,
        totalDownPayment,
        totalToBeCollected,
        DeliveredOrders,
        // halfCompletedOrders,
        topTenVendors: Object.values(vendorsMap)
          .sort((a, b) => {
            return b.profit - a.profit;
          })
          .slice(0, 10),
        topTenProducts: Object.values(productsMap)
          .sort((a, b) => {
            return b.profit - a.profit;
          })
          .slice(0, 10),
      },
    };
  }
  static async getOneOrder(orderId, vendor_Id) {
    const whereClause = {
      id: String(orderId),
    };

    if (vendor_Id) {
      whereClause["$orderLines.product.vendor.id$"] = vendor_Id;
    }
    const order = await Order.findOne({
      where: whereClause,
      subQuery: false,
      include: [
        {
          model: OrderLine,
          required: true,
          as: "orderLines",
          include: [
            {
              model: Product,
              as: "product",
              required: true,
              include: [
                { model: Vendor, as: "vendor", required: true },
                {
                  model: ProductType,
                  as: "type",
                  attributes: ["name"],
                  required: false,
                },
              ],
            },
          ],
        },
        {
          model: Note,
          as: "notesList",
          required: false,
          include: [
            {
              model: User,
              as: "user",
              required: false,
              attributes: ["firstName", "lastName"],
            },
            {
              model: Attachment,
              as: "attachments",
              required: false,
            },
          ],
        },
        {
          model: Customer,
          as: "customer",
          required: false,
        },
      ],
    });

    return {
      status: true,
      statusCode: 200,
      data: order,
    };
  }
  static async updateOrder(orderId, orderData, user) {
    const order = await Order.findByPk(orderId, {
      include: [
        {
          model: OrderLine,
          as: "orderLines",
          required: false,
          include: [
            {
              model: Product,
              as: "product",
              required: false,
              include: [
                {
                  model: Vendor,
                  as: "vendor",
                  required: false,
                  attributes: ["daysToDeliver"],
                },
              ],
            },
          ],
        },
      ],
    });
    const logs = [];
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order not found",
      };
    }
    //filter out the order Data
    if (orderData.vendorId) {
      logs.push({
        action: "update",
        entityType: "order",
        entityId: order.id,
        userId: user.id,
        field: "vendorId",
        to: orderData.vendorId,
      });
      const orderLines = await OrderLine.findAll({
        where: {
          orderId: orderId,
        },
        include: [
          {
            model: Product,
            as: "product",
            required: true,
          },
        ],
      });
      for (const orderLine of orderLines) {
        const product = orderLine.product.toJSON();
        Reflect.deleteProperty(product, "id");
        Reflect.deleteProperty(product, "shopifyId");
        Reflect.deleteProperty(product, "createdAt");
        Reflect.deleteProperty(product, "updatedAt");
        const newProduct = await Product.create({
          ...product,
          isCatalogProduct: false,
          vendorId: orderData.vendorId,
        });
        await orderLine.update({
          productId: newProduct.id,
        });
      }
      Reflect.deleteProperty(orderData, "vendorId");
    }

    Object.keys(orderData).forEach((key) => {
      if (
        orderData[key] === undefined ||
        orderData[key] === null ||
        orderData[key] === "Invalid date" ||
        orderData[key] === ""
      ) {
        delete orderData[key];
      } else {
        logs.push({
          action: "update",
          entityType: "order",
          entityId: order.id,
          userId: user.id,
          field: key,
          from: order[key],
          to: orderData[key],
        });
      }
    });
    if (orderData.status) {
      if (Number(order.status) !== Number(orderData.status)) {
        if (orderData.status == ORDER_STATUS.IN_PROGRESS) {
          orderData.PoDate = new Date();
        }
        if (
          Number(orderData.status) === ORDER_STATUS.DELIVERED &&
          !orderData.deliveryDate &&
          !order.deliveryDate
        ) {
          orderData.deliveryDate = new Date();
        }
        await OrderService.sendNotification(
          orderId,
          order.orderNumber,
          {
            orderId: orderId,
            oldStatus: order.status,
            newStatus: orderData.status,
            user: {
              firstName: user.firstName,
              lastName: user.lastName,
            },
            type: "orderUpdate",
          },
          true,
        );
      }
    }
    if (orderData.manufactureStatus) {
      if (
        Number(order.manufactureStatus) !== Number(orderData.manufactureStatus)
      ) {
        await OrderService.sendNotification(
          orderId,
          order.orderNumber,
          {
            orderId: orderId,
            oldStatus: order.manufactureStatus,
            newStatus: orderData.manufactureStatus,
            user: {
              firstName: user.firstName,
              lastName: user.lastName,
            },
            type: "orderUpdateManufactureStatus",
          },
          false,
          false,
          true,
        );
      }
    }
    const hasFinancialEdit = [
      "downPayment",
      "shippingFees",
      "subTotalPrice",
      "totalPrice",
      "totalDiscounts",
    ].some((key) => Object.prototype.hasOwnProperty.call(orderData, key));
    if (hasFinancialEdit) {
      const totalDiscounts = Object.prototype.hasOwnProperty.call(orderData, "totalDiscounts")
        ? orderData.totalDiscounts
        : order.totalDiscounts;
      const subTotalPrice = Object.prototype.hasOwnProperty.call(orderData, "subTotalPrice")
        ? orderData.subTotalPrice
        : Object.prototype.hasOwnProperty.call(orderData, "totalPrice")
          ? normalizeNumber(orderData.totalPrice) + normalizeNumber(totalDiscounts)
          : order.subTotalPrice;
      const shippingFees = Object.prototype.hasOwnProperty.call(orderData, "shippingFees")
        ? orderData.shippingFees
        : order.shippingFees;
      const downPayment = Object.prototype.hasOwnProperty.call(orderData, "downPayment")
        ? orderData.downPayment
        : order.downPayment;

      orderData.subTotalPrice = subTotalPrice;
      orderData.totalPrice = normalizeNumber(subTotalPrice) - normalizeNumber(totalDiscounts);
      orderData.toBeCollected = calculateAmountToCollect({
        downPayment,
        shippingFees,
        subTotalPrice,
        totalDiscounts,
      });
    }

    const nextStatus = Number(orderData.status || order.status) || null;
    const nextDeliveryDate = orderData.deliveryDate || order.deliveryDate || null;
    const nextExpectedDeliveryDate =
      orderData.expectedDeliveryDate || order.expectedDeliveryDate || null;
    const shouldFreezeFine =
      nextStatus === ORDER_STATUS.DELIVERED
      || nextStatus === ORDER_STATUS.CANCELED
      || nextStatus === ORDER_STATUS.REFUNDED
      || nextStatus === ORDER_STATUS.REPLACED
      || nextStatus === ORDER_STATUS.IN_INVENTORY;

    orderData.fine = calculateOrderFineForRecord(
      {
        ...order.toJSON(),
        ...orderData,
        expectedDeliveryDate: nextExpectedDeliveryDate,
      },
      shouldFreezeFine ? (nextDeliveryDate || new Date()) : new Date(),
    );

    await order.update(orderData);
    await Log.bulkCreate(logs);
    const returnedOrder = await Order.findOne({
      where: {
        id: orderId,
      },
      include: [
        {
          model: OrderLine,
          required: true,
          as: "orderLines",
          include: [
            {
              model: Product,
              as: "product",
              required: true,
              include: [
                { model: Vendor, as: "vendor", required: true },
                {
                  model: ProductType,
                  as: "type",
                  attributes: ["name"],
                  required: false,
                },
              ],
            },
          ],
        },
        {
          model: Note,
          as: "notesList",
          required: false,
          include: [
            {
              model: User,
              as: "user",
              required: false,
              attributes: ["firstName", "lastName"],
            },
            {
              model: Attachment,
              as: "attachments",
              required: false,
            },
          ],
        },
        {
          model: Customer,
          as: "customer",
          required: false,
        },
      ],
    });
    return {
      status: true,
      statusCode: 200,
      data: returnedOrder,
    };
  }
  static async BulkUpdate(body, user) {
    const { orderIds, orderData } = body;
    const logs = [];
    const normalizedOrderIds = orderIds.map((id) => Number(id));
    let orders = [];
    Object.keys(orderData).forEach(
      (key) =>
        (orderData[key] === undefined ||
          orderData[key] === null ||
          orderData[key] === "Invalid date" ||
          orderData[key] === "") &&
        delete orderData[key],
    );
    if (orderData.status) {
      /* PoDate («تاريخ التصنيع») is stamped per order below, only for the ones
         whose status actually changes to IN_PROGRESS. Setting it on the shared
         payload reset the date on orders that were already in progress. */
      orders = await Order.findAll({
        where: {
          id: {
            [Op.in]: normalizedOrderIds,
          },
        },
        include: [
          {
            model: OrderLine,
            as: "orderLines",
            required: false,
            include: [
              {
                model: Product,
                as: "product",
                required: false,
                include: [
                  {
                    model: Vendor,
                    as: "vendor",
                    required: false,
                    attributes: ["daysToDeliver"],
                  },
                ],
              },
            ],
          },
        ],
      });
      for (const order of orders) {
        Object.keys(orderData).forEach((key) =>
          logs.push({
            action: "update",
            entityType: "order",
            entityId: order.id,
            userId: user.id,
            field: key,
            from: order[orderData[key]],
            to: orderData[key],
          }),
        );
        if (Number(order.status) !== Number(orderData.status)) {
          if (
            Number(orderData.status) === ORDER_STATUS.DELIVERED &&
            !orderData.deliveryDate &&
            !order.deliveryDate
          ) {
            orderData.deliveryDate = new Date();
          }

          orderData.fine = calculateOrderFineForRecord(
            {
              ...order.toJSON(),
              ...orderData,
            },
            Number(orderData.status) === ORDER_STATUS.DELIVERED
              ? (orderData.deliveryDate || new Date())
              : new Date(),
          );

          await OrderService.sendNotification(
            order.id,
            order.orderNumber,
            {
              orderId: order.id,
              oldStatus: order.status,
              newStatus: orderData.status,
              user: {
                firstName: user.firstName,
                lastName: user.lastName,
              },
              type: "orderUpdate",
            },
            true,
          );
        }
      }
    }

    if (!orders.length) {
      orders = await Order.findAll({
        where: {
          id: {
            [Op.in]: normalizedOrderIds,
          },
        },
        include: [
          {
            model: OrderLine,
            as: "orderLines",
            required: false,
            include: [
              {
                model: Product,
                as: "product",
                required: false,
                include: [
                  {
                    model: Vendor,
                    as: "vendor",
                    required: false,
                    attributes: ["daysToDeliver"],
                  },
                ],
              },
            ],
          },
        ],
      });
    }

    for (const order of orders) {
      const perOrderData = { ...orderData };

      /* Same rule as the single-order update: the manufacturing date records the
         moment an order entered «قيد التصنيع», so it is written only on the
         transition — never re-stamped on an order already in that status. */
      if (
        perOrderData.status
        && Number(perOrderData.status) === Number(ORDER_STATUS.IN_PROGRESS)
        && Number(order.status) !== Number(ORDER_STATUS.IN_PROGRESS)
      ) {
        perOrderData.PoDate = new Date();
      }
      const hasFinancialEdit = [
        "downPayment",
        "shippingFees",
        "subTotalPrice",
        "totalPrice",
        "totalDiscounts",
      ].some((key) => Object.prototype.hasOwnProperty.call(perOrderData, key));
      if (hasFinancialEdit) {
        const totalDiscounts = Object.prototype.hasOwnProperty.call(perOrderData, "totalDiscounts")
          ? perOrderData.totalDiscounts
          : order.totalDiscounts;
        const subTotalPrice = Object.prototype.hasOwnProperty.call(perOrderData, "subTotalPrice")
          ? perOrderData.subTotalPrice
          : Object.prototype.hasOwnProperty.call(perOrderData, "totalPrice")
            ? normalizeNumber(perOrderData.totalPrice) + normalizeNumber(totalDiscounts)
            : order.subTotalPrice;
        const shippingFees = Object.prototype.hasOwnProperty.call(perOrderData, "shippingFees")
          ? perOrderData.shippingFees
          : order.shippingFees;
        const downPayment = Object.prototype.hasOwnProperty.call(perOrderData, "downPayment")
          ? perOrderData.downPayment
          : order.downPayment;

        perOrderData.subTotalPrice = subTotalPrice;
        perOrderData.totalPrice = normalizeNumber(subTotalPrice) - normalizeNumber(totalDiscounts);
        perOrderData.toBeCollected = calculateAmountToCollect({
          downPayment,
          shippingFees,
          subTotalPrice,
          totalDiscounts,
        });
      }

      const nextStatus = Number(perOrderData.status || order.status) || null;
      if (
        nextStatus === ORDER_STATUS.DELIVERED &&
        !perOrderData.deliveryDate &&
        !order.deliveryDate
      ) {
        perOrderData.deliveryDate = new Date();
      }

      const shouldFreezeFine =
        nextStatus === ORDER_STATUS.DELIVERED
        || nextStatus === ORDER_STATUS.CANCELED
        || nextStatus === ORDER_STATUS.REFUNDED
        || nextStatus === ORDER_STATUS.REPLACED
        || nextStatus === ORDER_STATUS.IN_INVENTORY;

      perOrderData.fine = calculateOrderFineForRecord(
        {
          ...order.toJSON(),
          ...perOrderData,
        },
        shouldFreezeFine ? (perOrderData.deliveryDate || new Date()) : new Date(),
      );

      await order.update(perOrderData);
    }
    await Log.bulkCreate(logs);

    return {
      status: true,
      statusCode: 200,
      message: "Orders updated successfully",
    };
  }

  static async deleteOrder(orderId, user) {
    const order = await Order.findByPk(orderId);
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order not found",
      };
    }
    await Log.create({
      action: "delete",
      entityType: "order",
      entityId: order.id,
      userId: user.id,
    });
    await order.destroy();
    return {
      status: true,
      statusCode: 200,
      message: "Order deleted successfully",
    };
  }
  static async bulkDelete(body) {
    const { orderIds } = body;
    await Order.destroy({
      where: {
        id: {
          [Op.in]: orderIds.map((id) => Number(id)),
        },
      },
    });
    return {
      status: true,
      statusCode: 200,
      message: "Orders deleted successfully",
    };
  }
  static async updateNote(user, OrderId, noteId, text) {
    const order = await Order.findByPk(OrderId);
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order Line not found",
      };
    }
    let note = await Note.findByPk(noteId);
    if (!note) {
      return {
        status: false,
        statusCode: 404,
        message: "Note not found",
      };
    }
    if (
      user.userType === USER_TYPES.VENDOR ||
      user.id.toString() !== note.userId.toString()
    ) {
      return {
        status: false,
        statusCode: 403,
        message: "You are not authorized to update this note",
      };
    }
    note.text = text;
    await note.save();

    return {
      status: true,
      statusCode: 200,
      data: note,
    };
  }
  static async addNote(user, OrderId, text) {
    const orderId = Number(OrderId);

    const order = await Order.findByPk(orderId);
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order not found",
      };
    }
    const newNote = await Note.create({
      text: text,
      userId: user.id,
      entityId: Number(orderId),
      entityType: "order",
    });
    await OrderService.sendNotification(
      orderId,
      order.orderNumber,
      {
        orderId: orderId,
        note: {
          text: newNote.text,
        },
        user: {
          firstName: user.firstName,
          lastName: user.lastName,
        },
        type: "note",
      },
      false,
      true,
    );

    return {
      status: true,
      statusCode: 200,
      data: newNote,
    };
  }
  static async deleteNote(user, OrderId, noteId) {
    const order = await Order.findByPk(OrderId);
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order Line not found",
      };
    }
    const note = await Note.findByPk(noteId);
    if (!note) {
      return {
        status: false,
        statusCode: 404,
        message: "Note not found",
      };
    }
    if (user.id.toString() !== note.userId.toString()) {
      return {
        status: false,
        statusCode: 403,
        message: "You are not authorized to update this note",
      };
    }
    await Note.destroy({ where: { id: noteId } });
    return {
      status: true,
      statusCode: 200,
      message: "Note deleted successfully",
    };
  }
  static async sendNotification(
    orderId,
    orderNumber,
    data,
    isUpdateStatus = false,
    addNote = false,
    isUpdateManufactureStatus = false,
  ) {
    const orderLines = await OrderLine.findAll({
      where: {
        orderId: orderId,
      },
      include: [
        {
          model: Product,
          as: "product",
          required: true,
        },
      ],
      toJSON: true,
    });
    if (isUpdateManufactureStatus) {
      if (data.oldStatus) {
        data.text = `تم تحديث حالة التصنيع للطلب رقم ${orderNumber} من ${
          MANUFACTURE_STATUS_ARABIC[data.oldStatus]
        } الى ${MANUFACTURE_STATUS_ARABIC[data.newStatus]}`;
      } else {
        data.text = `تم تحديث حالة التصنيع للطلب رقم ${orderNumber} الى ${
          MANUFACTURE_STATUS_ARABIC[data.newStatus]
        }`;
      }
    } else if (isUpdateStatus) {
      data.text = `تم تحديث حالة الطلب رقم ${orderNumber} من ${
        ORDER_STATUS_Arabic[data.oldStatus]
      } الى ${ORDER_STATUS_Arabic[data.newStatus]}`;
    } else if (addNote) {
      data.text = `تم اضافة ملاحظة جديدة على الطلب رقم ${orderNumber}`;
    } else {
      data.text = `تم اضافة طلب جديد رقم ${orderNumber}`;
    }

    const vendorsIds = orderLines.map((line) => line.product.vendorId);

    const users = await User.findAll({
      where: {
        [Op.or]: [
          { vendorId: { [Op.in]: vendorsIds } },
          { userType: { [Op.ne]: USER_TYPES.VENDOR } },
        ],
      },
      attributes: ["socketIds", "id"],
      toJSON: true,
    });
    const notifications = [];
    for (const user of users) {
      const notification = {
        userId: user.id,
        entityId: orderId,
        entityType: "order",
        text: data.text,
      };
      notifications.push(notification);
    }
    await Notification.bulkCreate(notifications);
    const socketsIds = users
      .map((user) => user.socketIds)
      .filter((sockets) => sockets && sockets.length > 0)
      .flat();
    if (socketsIds.length > 0 && global.socketIO && typeof global.socketIO.to === "function") {
      for (const socketId of socketsIds) {
        global.socketIO.to(socketId).emit("notification", {
          ...data,
        });
      }
    }
  }

  static async uploadFiles(noteId, filePaths, fileNames, descriptions) {
    const note = await Note.findByPk(noteId);
    if (!note) {
      return {
        status: false,
        statusCode: 404,
        message: "Note not found",
      };
    }
    for (let i = 0; i < filePaths.length; i++) {
      await Attachment.create({
        modelId: noteId,
        modelType: "Note",
        name: fileNames[i],
        url: filePaths[i],
        description: descriptions[i] || "",
      });
    }

    return {
      status: true,
      statusCode: 200,
      message: "Files uploaded!",
    };
  }

  static async saveMissingOrders() {
    const result = await OrderService.importOrders({
      created_at_min: moment().subtract(1, "week").toISOString(),
    });

    return result;
  }

  static async recalculateDailyFines() {
    const activeOrders = await Order.findAll({
      attributes: [
        "id",
        "fine",
        "orderDate",
        "status",
        "subTotalPrice",
        "expectedDeliveryDate",
        "deliveryDate",
      ],
      include: [
        {
          model: OrderLine,
          as: "orderLines",
          required: false,
          include: [
            {
              model: Product,
              as: "product",
              required: false,
              include: [
                {
                  model: Vendor,
                  as: "vendor",
                  required: false,
                  attributes: ["daysToDeliver"],
                },
              ],
            },
          ],
        },
      ],
      where: {
        status: {
          [Op.notIn]: FINAL_FINE_STATUSES,
        },
      },
    });

    let updatedCount = 0;

    for (const order of activeOrders) {
      const nextFine = calculateOrderFineForRecord(order, new Date());

      if (normalizeNumber(order.fine) === nextFine) {
        continue;
      }

      await order.update({ fine: nextFine });
      updatedCount += 1;
    }

    return {
      message: `Daily fines recalculated for ${updatedCount} orders`,
      status: true,
      statusCode: 200,
      updatedCount,
    };
  }
}
module.exports = OrderService;
