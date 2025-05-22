const { Op, where, or } = require("sequelize");
const ExcelJS = require("exceljs");
const CustomerService = require("../customer/customer.service");
const ShopifyHelper = require("../helpers/shopifyHelper");
const OrderLine = require("../orderLines/orderline.model");
const Product = require("../product/product.model");
const ProductsService = require("../product/product.service");
const Order = require("./order.model");
const { sequelize } = require("../../../config/db.config");
const Vendor = require("../vendor/vendor.model");
const Customer = require("../customer/customer.model");
const Note = require("../notes/notes.model");
const User = require("../user/user.model");
const Notification = require("../notification/notification.model");
const {
  ORDER_STATUS,
  USER_TYPES,
  ORDER_STATUS_Arabic,
  PAYMENT_STATUS,
  PAYMENT_STATUS_ARABIC,
  DELIVERY_STATUS,
} = require("../../../config/constants");
const moment = require("moment-timezone");
const Attachment = require("../attachments/attachment.model");
const ProductType = require("../product/productType.model");
const PREFIX = "H";
const CUSTOM_PREFIX = "CU";

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
    ordersFromShopify.forEach((order) => {
      if (order.line_items.length > 0) {
        for (const line of order.line_items) {
          if (line.quantity > 1) {
            const discount_allocations = line.discount_allocations || [];
            const lineDiscount = discount_allocations.reduce(
              (acc, item) => acc + Number(item.amount),
              0
            );
            const discount = lineDiscount / line.quantity;
            //split line into multiple lines with quantity 1
            for (let i = 0; i < line.quantity; i++) {
              const newLine = { ...line, quantity: 1 };
              newLine.discount = discount;
              orders.push({
                ...order,
                line_items: [newLine],
              });
            }
          }
        }
      } else {
        orders.push(order);
      }
    });

    const productsIds = new Set();
    const customers = [];
    const lastOrder = await Order.findOne({
      where: {
        code: {
          [Op.not]: null,
        },
      },
      order: [["code", "DESC"]],
      attributes: ["code"],
    });
    const lastCustomOrder = await Order.findOne({
      where: {
        code: {
          [Op.not]: null,
        },
        custom: true,
      },
      order: [["code", "DESC"]],
      attributes: ["number"],
    });

    // Get last code number or default to 0
    const lastCode = lastOrder?.code || `0`;
    const codeNumber = parseInt(lastCode.replace(PREFIX, ""), 10);

    // Get last custom code number or default to 0
    let lastCustomNumber = lastCustomOrder ? lastCustomOrder.number : 0;

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
            `Product with id ${line.product_id} not found in products map`
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
                  variant.shopifyId.toString() === line.variant_id.toString()
              )
            : null;
          const cost = variant ? Number(variant.cost) || 0 : 0;
          line.unitCost = cost;
          line.cost = cost * line.quantity;
          totalCost += line.cost;
          subTotalPrice = line.price * line.quantity;
          total_discounts += line.discount || 0;
        });
        const customerKey = order.id
          ? order.customer.id
          : `${
              order.customer.firstName ||
              order.customer.first_name ||
              order.customer.default_address.first_name
            }${
              order.customer.lastName ||
              order.customer.last_name ||
              order.customer.default_address.last_name
            }${
              order.customer.email ||
              order.customer.default_address?.email ||
              ""
            }${
              order.customer.phone ||
              order.customer.default_address?.phone ||
              ""
            }`;

        let number,
          orderNumber,
          name,
          custom = false;
        if (order.id) {
          number = order.number;
          orderNumber = order.order_number;
          name = order.name;
        } else {
          const newNumber = parseInt(lastCustomNumber) + 1;
          number = `${newNumber}`;
          orderNumber = `${newNumber + 1000}`;
          name = `#${CUSTOM_PREFIX}${newNumber}`;
          custom = true;
        }
        const codeNumber = nextNumber;
        nextNumber++;
        let obj = {
          shopifyId: String(order.id),
          name,
          code: codeNumber,
          number,
          orderNumber,
          subTotalPrice: subTotalPrice,
          totalDiscounts: total_discounts,
          totalTax: order.total_tax,
          totalPrice: subTotalPrice - total_discounts,
          orderDate: order.created_at || new Date(),
          customerId: customersNamesMap[customerKey],
          totalCost,
          custom,
          shippedFromInventory: isShipment ? true : false,
          shippingReceiveDate: order.shippingReceiveDate || null,
          shippingCompany: order.shippingCompany || null,
          deliveryDate: order.deliveryDate || null,
          governorate: order.governorate || null,
          shipmentStatus: order.shipmentStatus || null,
          shipmentType: order.shipmentType || null,
          expectedDate: order.expectedDate || null,
          expectedDeliveryDate: vendor.daysToDeliver
            ? moment().add(vendor.daysToDeliver, "days").toDate()
            : null,
          receivedAmount: order.receivedAmount || 0,
          commission: order.commission || 0,
          shippingFees: order.shippingFees || 0,
          PoDate: order.PoDate || null,
          downPayment: order.downPayment || 0,
          toBeCollected: order.toBeCollected || 0,
          itemShipping: order.itemShipping || 0,
          deliveryStatus: order.deliveryStatus || null,
          userId: order.userId || null,
        };
        // status: order.status || null,
        // financialStatus: order.financial_status || null,
        // paymentStatus: order.paymentStatus || null,
        lines.push({
          order_id: obj.code,
          line_items: order.line_items,
        });
        if (obj.status) {
          obj.status = order.status;
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
    for (const { order_id, line_items } of lines) {
      const order = savedOrders.find(
        (order) => order.code === String(order_id)
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
    for (const order of savedOrders) {
      await OrderService.sendNotification(order.id, order.orderNumber, {
        orderId: order.id,
        type: "orderCreate",
      });
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
          }
        )
      );
    }
    if (paymentStatus) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.paymentStatus"), {
          [Op.eq]: Number(paymentStatus),
        })
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
          })
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
        })
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.orderDate"), {
          [Op.lte]: endOfEndDate,
        })
      );
    }
    if (vendorName) {
      whereClause[Op.and].push(
        sequelize.where(
          sequelize.fn(
            "lower",
            sequelize.col("orderLines.product.vendor.name")
          ),
          {
            [Op.like]: `%${vendorName.toLowerCase()}%`,
          }
        )
      );
    }
    if (vendorId) {
      vendorId = vendorId.split(",");
      if (vendorId.length) {
        whereClause[Op.and].push(
          sequelize.where(sequelize.col("orderLines.product.vendor.id"), {
            [Op.in]: vendorId.map((id) => Number(id)),
          })
        );
      }
    }

    if (vendorUser) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.status"), {
          [Op.gte]: ORDER_STATUS.IN_PROGRESS,
        })
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.status"), {
          [Op.ne]: ORDER_STATUS.CANCELED,
        })
      );
    } else if (status) {
      status = status.split(",");
      if (status.length) {
        whereClause[Op.and].push(
          sequelize.where(sequelize.col("Order.status"), {
            [Op.in]: status.map((s) => Number(s)),
          })
        );
      }
    }
    whereClause = whereClause[Op.and].length ? whereClause : {};
    const orders = await Order.findAndCountAll({
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
                {
                  model: Vendor,
                  as: "vendor",
                  required: true,
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
      where: whereClause,
      order: [["orderDate", "DESC"]],
      limit: Number(size),
      offset: (page - 1) * Number(size),
      subQuery: false,
    });
    for (const order of orders.rows) {
      if (order.expectedDeliveryDate) {
        if (
          moment(order.expectedDeliveryDate).isBefore(
            moment().startOf("day").toDate()
          )
        ) {
          order.deliveryStatus = DELIVERY_STATUS.LATE;
        } else if (
          moment(order.expectedDeliveryDate).isBefore(
            moment().startOf("day").add(2, "days").toDate()
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
        orders: orders.rows,
        totalPages: Math.ceil(orders.count / Number(size)),
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
    }
  ) {
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
          }
        )
      );
    }
    if (paymentStatus) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.paymentStatus"), {
          [Op.eq]: Number(paymentStatus),
        })
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
          })
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
        })
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.orderDate"), {
          [Op.lte]: endOfEndDate,
        })
      );
    }
    if (vendorName) {
      whereClause[Op.and].push(
        sequelize.where(
          sequelize.fn(
            "lower",
            sequelize.col("orderLines.product.vendor.name")
          ),
          {
            [Op.like]: `%${vendorName.toLowerCase()}%`,
          }
        )
      );
    }
    if (vendorId) {
      vendorId = vendorId.split(",");
      if (vendorId.length) {
        whereClause[Op.and].push(
          sequelize.where(sequelize.col("orderLines.product.vendor.id"), {
            [Op.in]: vendorId.map((id) => Number(id)),
          })
        );
      }
    }

    if (vendorUser) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.status"), {
          [Op.gte]: ORDER_STATUS.IN_PROGRESS,
        })
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.status"), {
          [Op.ne]: ORDER_STATUS.CANCELED,
        })
      );
    } else if (status) {
      status = status.split(",");
      if (status.length) {
        whereClause[Op.and].push(
          sequelize.where(sequelize.col("Order.status"), {
            [Op.in]: status.map((s) => Number(s)),
          })
        );
      }
    }
    whereClause = whereClause[Op.and].length ? whereClause : {};
    const orders = await Order.findAll({
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
                {
                  model: Vendor,
                  as: "vendor",
                  required: true,
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
        {
          model: User,
          as: "user",
          required: false,
          attributes: ["firstName", "lastName"],
        },
      ],
      where: whereClause,
      order: [["orderDate", "DESC"]],
      subQuery: false,
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("orders");
    worksheet.columns = [
      {
        header: "كود العملية",
        key: "code",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: "رقم الطلب",
        key: "orderNumber",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: " المنتج",
        key: "productName",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: " كود المنتج",
        key: "productCode",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: "الكمیة",
        key: "quantity",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: "البائع",
        key: "vendorName",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: "حالة الطلب",
        key: "status",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: "طریقة الدفع",
        key: "paymentStatus",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: "تاریخ أمر التصنیع",
        key: "orderDate",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: "الأیام المنقضیة",
        key: "daysPassed",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: "سعر التكلفة",
        key: "cost",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: "سعر البیع",
        key: "price",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: "المسئول",
        key: "userName",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
      {
        header: "النوع",
        key: "productType",
        width: 20,
        style: { alignment: { horizontal: "right" } },
      },
    ];

    // Add data rows
    orders.forEach((order) => {
      const line = order.orderLines[0];
      const variant = order.orderLines[0].product.variants.find(
        (variant) => String(variant.shopifyId) === String(line.variant_id)
      );
      worksheet.addRow({
        code: order.code,
        orderNumber: order.orderNumber,
        productName: order.orderLines[0].product.title,
        quantity: order.orderLines[0].quantity,
        vendorName: order.orderLines[0].product.vendor.name,
        status: ORDER_STATUS_Arabic[order.status] || order.status,
        paymentStatus:
          PAYMENT_STATUS_ARABIC[order.paymentStatus] || order.paymentStatus,
        orderDate: order.PoDate
          ? moment(order.PoDate).format("YYYY-MM-DD")
          : "",
        daysPassed: order.PoDate
          ? moment().diff(moment(order.PoDate), "days", true).toFixed(0)
          : "",
        cost: order.totalCost,
        price: order.subTotalPrice,
        userName: order.user
          ? `${order.user.firstName} ${order.user.lastName}`
          : "",
        productType: order.orderLines[0].product?.type?.name || "",
        productCode: variant ? variant.sku : "",
      });
    });

    // Set response headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=orders.xlsx");

    // Write to response stream
    await workbook.xlsx.write(res);
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
        })
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
            productName: line.product.name,
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
      subTotal += +order.subTotal;
      totalDownPayment += +order.downPayment;
      totalToBeCollected += +order.toBeCollected;
    }
    totalProfit = totalRevenue - totalCost - totalCommission - totalTax;
    return {
      status: true,
      statusCode: 200,
      data: {
        ordersCount: count,
        totalTax,
        totalCost,
        totalRevenue,
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
    const order = await Order.findByPk(orderId);
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order not found",
      };
    }
    //filter out the order Data
    if (orderData.vendorId) {
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
          vendorId: orderData.vendorId,
        });
        await orderLine.update({
          productId: newProduct.id,
        });
      }
      Reflect.deleteProperty(orderData, "vendorId");
    }

    Object.keys(orderData).forEach(
      (key) =>
        (orderData[key] === undefined ||
          orderData[key] === null ||
          orderData[key] === "Invalid date" ||
          orderData[key] === "") &&
        delete orderData[key]
    );
    if (orderData.status) {
      if (orderData.status == ORDER_STATUS.IN_PROGRESS) {
        orderData.PoDate = new Date();
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
        true
      );
    }
    if (order.shippingFees) {
      orderData.totalPrice =
        Number(order.subTotalPrice) -
        Number(order.totalDiscounts) +
        Number(orderData.shippingFees);
    }

    await order.update(orderData);
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
    Object.keys(orderData).forEach(
      (key) =>
        (orderData[key] === undefined ||
          orderData[key] === null ||
          orderData[key] === "Invalid date" ||
          orderData[key] === "") &&
        delete orderData[key]
    );
    if (orderData.status) {
      if (orderData.status == ORDER_STATUS.IN_PROGRESS) {
        orderData.PoDate = new Date();
      }
      const orders = await Order.findAll({
        where: {
          id: {
            [Op.in]: orderIds.map((id) => Number(id)),
          },
        },
      });
      for (const order of orders) {
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
          true
        );
      }
    }

    await Order.update(orderData, {
      where: {
        id: {
          [Op.in]: orderIds,
        },
      },
    });

    return {
      status: true,
      statusCode: 200,
      message: "Orders updated successfully",
    };
  }

  static async deleteOrder(orderId) {
    const order = await Order.findByPk(orderId);
    if (!order) {
      return {
        status: false,
        statusCode: 404,
        message: "Order not found",
      };
    }
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
      true
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
    addNote = false
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
    if (isUpdateStatus) {
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
      attributes: ["socketId", "id"],
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
    const socketsIds = users.map((user) => user.socketId).filter(Boolean);
    if (socketsIds.length > 0) {
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
}
module.exports = OrderService;
