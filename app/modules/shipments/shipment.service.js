const { Op, where, or } = require("sequelize");
const CustomerService = require("../customer/customer.service");
const ShopifyHelper = require("../helpers/shopifyHelper");
const OrderLine = require("../orderLines/orderline.model");
const Product = require("../product/product.model");
const ProductsService = require("../product/product.service");
const Shipment = require("../order/order.model");
const { sequelize } = require("../../../src/infrastructure/database");
const Vendor = require("../vendor/vendor.model");
const Customer = require("../customer/customer.model");
const Note = require("../notes/notes.model");
const User = require("../user/user.model");
const ShippingCompany = require("./shippingCompany.model");
const {
  SHIPMENT_STATUS,
  USER_TYPES,
  DELIVERY_STATUS,
  PAYMENT_STATUS,
} = require("../../../config/constants");
const {
  DELIVERY_BY_LABELS,
  GOVERNORATE_LABELS,
  PAYMENT_STATUS_LABELS,
  SHIPMENT_SCHEDULE_STATUS_LABELS,
} = require("../../../src/modules/shipments/shipment.constants");
const {
  buildShipmentNumber,
  getShipmentAgingDays,
  getShipmentStatusLabel,
  getShipmentTypeLabel,
} = require("../../../src/modules/shipments/shipment.helpers");
const moment = require("moment-timezone");
const ProductType = require("../product/productType.model");
const Attachment = require("../attachments/attachment.model");
const PREFIX = "H";
const CUSTOM_PREFIX = "CU";
const ExcelJS = require("exceljs");

const EXPORT_SORT_FIELDS = new Set([
  "orderDate",
  "priority",
  "subTotalPrice",
  "totalPrice",
]);

const formatExportDate = (value) => {
  if (!value) {
    return "";
  }

  const parsed = moment(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : "";
};

// Governorate is stored as free text, but older rows hold the numeric id.
const resolveGovernorateLabel = (value) => {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  return GOVERNORATE_LABELS[value] || String(value);
};

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

class ShipmentService {
  static async getShipments({
    page = 1,
    size = 50,
    shippingCompany,
    governorate,
    shipmentStatus,
    shipmentType,
    startDate,
    endDate,
    shipmentStartDate,
    shipmentEndDate,
    orderNumber,
  }) {
    let whereClause = {
      [Op.and]: [
        {
          shippedFromInventory: true,
        },
      ],
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
    if (shippingCompany) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("shippingCompany"), {
          [Op.like]: `%${shippingCompany}%`,
        })
      );
    }
    if (governorate) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("governorate"), {
          [Op.eq]: governorate,
        })
      );
    }

    if (shipmentStatus) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.shipmentStatus"), {
          [Op.eq]: shipmentStatus,
        })
      );
    }
    if (shipmentType) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.shipmentType"), {
          [Op.eq]: shipmentType,
        })
      );
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
    if (shipmentStartDate && shipmentEndDate) {
      let startStartDate = moment
        .tz(new Date(shipmentStartDate), "Africa/Cairo")
        .startOf("day")
        .utc()
        .toDate();

      let endOfEndDate = moment
        .tz(new Date(shipmentEndDate), "Africa/Cairo")
        .endOf("day")
        .utc()
        .toDate();

      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.shippingReceiveDate"), {
          [Op.gte]: startStartDate,
        })
      );
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.shippingReceiveDate"), {
          [Op.lte]: endOfEndDate,
        })
      );
    }

    whereClause = whereClause[Op.and].length ? whereClause : {};
    const shipments = await Shipment.findAndCountAll({
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
              include: {
                model: Vendor,
                as: "vendor",
                required: true,
              },
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
      order: [["shippingReceiveDate", "DESC"]],
      limit: Number(size),
      offset: (page - 1) * Number(size),
      subQuery: false,
    });
    return {
      status: true,
      statusCode: 200,
      data: {
        shipments: shipments.rows,
        totalPages: Math.ceil(shipments.count / Number(size)),
      },
    };
  }
  static async getOneShipment(shipmentId, vendor_Id) {
    const whereClause = {
      id: String(shipmentId),
    };

    if (vendor_Id) {
      whereClause["$orderLines.product.vendor.id$"] = vendor_Id;
    }
    const shipment = await Shipment.findOne({
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
              include: {
                model: Vendor,
                as: "vendor",
                required: true,
              },
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
          ],
        },
        {
          model: Customer,
          as: "customer",
          required: true,
        },
      ],
    });

    return {
      status: true,
      statusCode: 200,
      data: shipment,
    };
  }
  static async updateShipment(shipmentId, shipmentData) {
    //filter out the shipment Data
    Object.keys(shipmentData).forEach((key) => {
      if (key === "shippingReceiveDate" && shipmentData[key] === "") {
        shipmentData[key] = null;
      } else if (key === "deliveryDate" && shipmentData[key] === "") {
        shipmentData[key] = null;
      }
    });
    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment) {
      return {
        status: false,
        statusCode: 404,
        message: "Shipment not found",
      };
    }
    await shipment.update(shipmentData);
    return {
      status: true,
      statusCode: 200,
      data: shipment,
    };
  }

  static async deleteShipment(shipmentId) {
    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment) {
      return {
        status: false,
        statusCode: 404,
        message: "Shipment not found",
      };
    }
    await shipment.destroy();
    return {
      status: true,
      statusCode: 200,
      message: "Shipment deleted successfully",
    };
  }
  static async updateNote(user, ShipmentId, noteId, text) {
    const shipment = await Shipment.findByPk(ShipmentId);
    if (!shipment) {
      return {
        status: false,
        statusCode: 404,
        message: "Shipment Line not found",
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
  static async addNote(user, ShipmentId, text) {
    const shipmentId = Number(ShipmentId);

    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment) {
      return {
        status: false,
        statusCode: 404,
        message: "Shipment not found",
      };
    }
    const newNote = await Note.create({
      text: text,
      userId: user.id,
      entityId: Number(shipmentId),
      entityType: "shipment",
    });
    return {
      status: true,
      statusCode: 200,
      data: newNote,
    };
  }
  static async deleteNote(user, ShipmentId, noteId) {
    const shipment = await Shipment.findByPk(ShipmentId);
    if (!shipment) {
      return {
        status: false,
        statusCode: 404,
        message: "Shipment Line not found",
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
  static async exportShipments(
    res,
    {
      vendorName,
      vendorId,
      orderNumber,
      operationCode,
      customerName,
      customerPhone,
      financialStatus,
      status,
      deliveryStatus,
      shipmentStatus,
      shipmentType,
      deliveryBy,
      shippingCompany,
      scheduleStatus,
      governorate,
      deliveryDateFrom,
      deliveryDateTo,
      scheduledDateFrom,
      scheduledDateTo,
      startDate,
      endDate,
      vendorUser,
      paymentStatus,
      sort,
    }
  ) {
    let whereClause = {
      [Op.and]: [
        sequelize.where(sequelize.col("Order.shippedFromInventory"), {
          [Op.eq]: true,
        }),
      ],
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

    if (operationCode) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.fn("lower", sequelize.col("Order.code")), {
          [Op.like]: `%${operationCode.toLowerCase()}%`,
        })
      );
    }

    if (customerName) {
      whereClause[Op.and].push(
        sequelize.where(
          sequelize.fn(
            "lower",
            sequelize.fn(
              "concat",
              sequelize.col("customer.firstName"),
              " ",
              sequelize.col("customer.lastName")
            )
          ),
          { [Op.like]: `%${customerName.toLowerCase()}%` }
        )
      );
    }

    if (customerPhone) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("customer.phoneNumber"), {
          [Op.like]: `%${customerPhone}%`,
        })
      );
    }

    if (shipmentStatus) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.shipmentStatus"), {
          [Op.in]: shipmentStatus.split(",").map(Number),
        })
      );
    }

    if (shipmentType) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.fn("lower", sequelize.col("Order.shipmentType")), {
          [Op.in]: shipmentType.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
        })
      );
    }

    if (deliveryBy) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.deliveryBy"), {
          [Op.in]: deliveryBy.split(",").map(Number),
        })
      );
    }

    if (scheduleStatus) {
      const tokens = scheduleStatus.split(",").map((value) => value.trim()).filter(Boolean);
      const statuses = tokens
        .filter((value) => value !== "__blank__")
        .map(Number)
        .filter(Number.isFinite);
      const scheduleConditions = [];
      if (statuses.length) {
        scheduleConditions.push(
          sequelize.where(sequelize.col("Order.scheduleStatus"), { [Op.in]: statuses })
        );
      }
      if (tokens.includes("__blank__")) {
        scheduleConditions.push(
          sequelize.where(sequelize.col("Order.scheduleStatus"), { [Op.is]: null })
        );
      }
      if (scheduleConditions.length === 1) {
        whereClause[Op.and].push(scheduleConditions[0]);
      } else if (scheduleConditions.length > 1) {
        whereClause[Op.and].push({ [Op.or]: scheduleConditions });
      }
    }

    if (governorate) {
      /* governorate is stored as free text on newer rows but as the numeric id
         on older ones — a selected id has to match either representation. */
      const tokens = governorate.split(",").map((value) => value.trim()).filter(Boolean);
      const ids = tokens.filter((value) => value !== "__blank__").map(Number).filter(Number.isFinite);
      const values = ids.flatMap((id) => [String(id), GOVERNORATE_LABELS[id]]).filter(Boolean);
      const governorateConditions = [];
      if (values.length) {
        governorateConditions.push(
          sequelize.where(sequelize.col("Order.governorate"), { [Op.in]: values })
        );
      }
      if (tokens.includes("__blank__")) {
        governorateConditions.push(
          sequelize.where(sequelize.col("Order.governorate"), { [Op.is]: null }),
          sequelize.where(sequelize.col("Order.governorate"), { [Op.eq]: "" })
        );
      }
      if (governorateConditions.length === 1) {
        whereClause[Op.and].push(governorateConditions[0]);
      } else if (governorateConditions.length > 1) {
        whereClause[Op.and].push({ [Op.or]: governorateConditions });
      }
    }

    if (shippingCompany) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("shippingCompanyRecord.id"), {
          [Op.in]: shippingCompany.split(",").map(Number).filter((id) => Number.isFinite(id)),
        })
      );
    }

    if (deliveryDateFrom) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.deliveryDate"), {
          [Op.gte]: moment.tz(new Date(deliveryDateFrom), "Africa/Cairo").startOf("day").utc().toDate(),
        })
      );
    }

    if (deliveryDateTo) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.deliveryDate"), {
          [Op.lte]: moment.tz(new Date(deliveryDateTo), "Africa/Cairo").endOf("day").utc().toDate(),
        })
      );
    }

    if (scheduledDateFrom) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.scheduledDeliveryDate"), {
          [Op.gte]: moment.tz(new Date(scheduledDateFrom), "Africa/Cairo").startOf("day").utc().toDate(),
        })
      );
    }

    if (scheduledDateTo) {
      whereClause[Op.and].push(
        sequelize.where(sequelize.col("Order.scheduledDeliveryDate"), {
          [Op.lte]: moment.tz(new Date(scheduledDateTo), "Africa/Cairo").endOf("day").utc().toDate(),
        })
      );
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
    const exportOrder = resolveExportSort(sort);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=shipments.xlsx");

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
    const worksheet = workbook.addWorksheet("shipments");

    // Column order is fixed by the business spec, do not reshuffle.
    worksheet.columns = [
      { header: "رقم العملية", key: "code" },
      { header: "رقم الشحنة", key: "shipmentNumber" },
      { header: "اسم العميل", key: "customerName" },
      { header: "البائع", key: "vendorName" },
      { header: "المحافظة", key: "governorate" },
      { header: "حالة الشحنة", key: "shipmentStatus" },
      { header: "نوع الشحنة", key: "shipmentType" },
      { header: "حالة الدفع", key: "paymentStatus" },
      { header: "التوصيل بواسطة", key: "deliveryBy" },
      { header: "مبلغ التحصيل", key: "amountToCollect" },
      { header: "تكلفة الشحن", key: "shippingCost" },
      { header: "تاريخ الاستلام بالمخزن", key: "receivedInWarehouseDate" },
      { header: "موعد الجدولة", key: "scheduledDeliveryDate" },
      { header: "حالة الجدولة", key: "scheduleStatus" },
      { header: "تاريخ التسليم الفعلي", key: "actualDeliveryDate" },
      { header: "عداد الأيام", key: "daysCounter" },
      { header: "الملاحظات", key: "notes" },
    ].map((column) => ({
      ...column,
      style: { alignment: { horizontal: "right" } },
      width: 22,
    }));
    const CHUNK_SIZE = 500;
    let offset = 0;
    let hasMore = true;

    const exportIncludes = [
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
        model: Customer,
        as: "customer",
        required: Boolean(customerName || customerPhone),
        attributes: ["id", "firstName", "lastName"],
      },
      {
        model: User,
        as: "user",
        required: false,
        attributes: ["firstName", "lastName"],
      },
    ];
    if (shippingCompany) {
      exportIncludes.push({
        model: ShippingCompany,
        as: "shippingCompanyRecord",
        required: true,
        attributes: [],
      });
    }

    while (hasMore) {
      const chunk = await Shipment.findAll({
        include: exportIncludes,
        where: whereClause,
        order: exportOrder,
        offset,
        limit: CHUNK_SIZE,
        subQuery: false,
      });

      // One row per shipment, unlike the orders export which is per order line.
      for (const order of chunk) {
        const customer = order.customer;
        const vendor = order.orderLines?.[0]?.product?.vendor;
        const amountToCollect =
          Number(order.paymentStatus) === PAYMENT_STATUS.PAID
            ? 0
            : Number(order.toBeCollected || order.totalPrice) || 0;

        worksheet.addRow({
          actualDeliveryDate: formatExportDate(order.deliveryDate),
          amountToCollect,
          code: order.code,
          customerName: customer
            ? `${customer.firstName || ""} ${customer.lastName || ""}`.trim()
            : "",
          daysCounter:
            getShipmentAgingDays(
              order.shipmentStatus,
              order.shippingReceiveDate,
              order.deliveryDate,
              order.updatedAt,
            ) ?? "",
          deliveryBy: DELIVERY_BY_LABELS[order.deliveryBy] || "",
          governorate: resolveGovernorateLabel(order.governorate),
          notes: order.notes || "",
          paymentStatus:
            PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus || "",
          receivedInWarehouseDate: formatExportDate(order.shippingReceiveDate),
          // موعد الجدولة is the manually scheduled date shown in the shipments
          // table. expectedDeliveryDate is the manufacturing/delivery estimate
          // and must not leak into this Excel column.
          scheduledDeliveryDate: formatExportDate(order.scheduledDeliveryDate),
          scheduleStatus: SHIPMENT_SCHEDULE_STATUS_LABELS[order.scheduleStatus] || "",
          shipmentNumber: buildShipmentNumber(order),
          shipmentStatus: getShipmentStatusLabel(order.shipmentStatus),
          shipmentType: getShipmentTypeLabel(order.shipmentType),
          shippingCost: Number(order.shippingFees) || 0,
          vendorName: vendor?.name || "",
        });
      }
      hasMore = chunk.length > 0;
      offset += CHUNK_SIZE;
    }

    await workbook.commit();
    res.end();
  }
}
module.exports = ShipmentService;
