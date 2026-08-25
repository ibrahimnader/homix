const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../src/infrastructure/database");
const {
  ORDER_STATUS,
  PAYMENT_STATUS,
  DELIVERY_STATUS,
  DELIVERY_BY,
  ORDER_SOURCE,
  SHIPMENT_SCHEDULE_STATUS,
  SHIPMENTS_STATUS,
} = require("../../../config/constants");
const { ORDER_PRIORITY } = require("../../../src/modules/orders/order.constants");
const OrderLine = require("../orderLines/orderline.model");
const Customer = require("../customer/customer.model");
const User = require("../user/user.model");
const Note = require("../notes/notes.model");
const ShippingCompany = require("../shipments/shippingCompany.model");

const Order = sequelize.define(
  "Order",
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING,
      // allowNull: false,
      // unique: true,
    },
    shopifyId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    number: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    orderNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    subTotalPrice: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    totalPrice: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    totalDiscounts: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    orderDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    expectedDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: ORDER_STATUS.PENDING,
    },
    financialStatus: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    customerId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    totalCost: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },
    receivedAmount: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    // Distinguishes the creation-time zero from a value (including zero) that
    // a user explicitly entered later in the shipment edit screen.
    receivedAmountManuallySet: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    paymentStatus: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        isIn: [Object.values(PAYMENT_STATUS)],
      },
    },
    orderSource: {
      type: DataTypes.INTEGER,
      allowNull: true,
      // الافتراضي «اونلاين»: الغالبية تأتي من الاستيراد، والطلب اليدوي
      // يُضبط صراحةً على «شو رووم» عند الإنشاء.
      defaultValue: ORDER_SOURCE.ONLINE,
      validate: {
        isIn: [Object.values(ORDER_SOURCE)],
      },
    },
    commission: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    totalTax: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    shippingFees: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    PoDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    downPayment: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    toBeCollected: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    itemShipping: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    deliveryStatus: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        isIn: [Object.values(DELIVERY_STATUS)],
      },
    },
    priority: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: ORDER_PRIORITY.ON_SCHEDULE,
      validate: {
        isIn: [Object.values(ORDER_PRIORITY)],
      },
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    fine: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    shippedFromInventory: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    custom: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    shippingReceiveDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    shippingCompany: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    deliveryDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    expectedDeliveryDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    governorate: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    shipmentStatus: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        isIn: [Object.values(SHIPMENTS_STATUS)],
      },
    },
    scheduleStatus: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        isIn: [Object.values(SHIPMENT_SCHEDULE_STATUS)],
      },
    },
    // موعد الجدولة — يُدخَل يدويًا من فريق اللوجيستيك، وليس مشتقًا من expectedDeliveryDate.
    scheduledDeliveryDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    shipmentType: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isIn: [["collected", "grouped", "separate", "single", "warehouse"]],
      },
    },
    deliveryBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        isIn: [Object.values(DELIVERY_BY)],
      },
    },
    // Accounting state for the deliveries ledger (shipments/accounts/deliveries).
    // Null means "never set by a user" so the ledger falls back to deriving it
    // from the payment status, keeping historical rows looking unchanged.
    accountingStatus: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        isIn: [[1, 2]],
      },
    },
    // Hides a row from the deliveries accounting ledger only — the order/shipment
    // itself is untouched everywhere else. Null means "visible" (the default).
    accountsHiddenAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    accountingDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    accountingReference: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    totalVendorDue: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    totalCompanyDue: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    manufactureStatus: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    hooks: {
      beforeValidate(order: any, options: any) {
        const deliveryBy = Number(order.getDataValue("deliveryBy"));
        if (deliveryBy === DELIVERY_BY.HOMIX || deliveryBy === DELIVERY_BY.VENDOR) {
          order.setDataValue("shippedFromInventory", deliveryBy === DELIVERY_BY.HOMIX);
          if (Array.isArray(options?.fields) && !options.fields.includes("shippedFromInventory")) {
            options.fields.push("shippedFromInventory");
          }
        }
        // توصيل بواسطة هوميكس بدون حالة شحنة سابقة => تبدأ الحالة "معلقة" بدل ما تفضل فاضية.
        if (deliveryBy === DELIVERY_BY.HOMIX && order.getDataValue("shipmentStatus") == null) {
          order.setDataValue("shipmentStatus", SHIPMENTS_STATUS.PENDING);
          if (Array.isArray(options?.fields) && !options.fields.includes("shipmentStatus")) {
            options.fields.push("shipmentStatus");
          }
        }
      },
    },
    tableName: "orders",
    timestamps: true,
    paranoid: true,
    indexes: [
      {
        fields: ["code"],
      },
      {
        fields: ["shopifyId"],
      },
      {
        fields: ["orderNumber"],
      },
      {
        fields: ["customerId"],
      },
      {
        fields: ["userId"],
      },
      {
        fields: ["fine"],
      },
      {
        fields: ["financialStatus"],
      },
      {
        fields: ["status"],
      },
      {
        fields: ["paymentStatus"],
      },
      {
        fields: ["priority"],
      },
      {
        fields: ["deliveryStatus"],
      },
      {
        fields: ["shipmentStatus"],
      },
      {
        fields: ["deliveryBy"],
      },
      {
        fields: ["shippingCompany"],
      },
      // New indexes for query optimization
      {
        fields: ["name"],
      },
      {
        fields: ["number"],
      },
      {
        fields: ["orderDate"],
      },
      {
        fields: ["expectedDeliveryDate"],
      },
      {
        fields: ["custom"],
      },
      {
        fields: ["deletedAt"],
      },
      // Composite indexes for common query patterns
      {
        fields: ["orderDate", "status"],
        name: "order_date_status_idx",
      },
      {
        fields: ["status", "expectedDeliveryDate"],
        name: "status_expected_delivery_idx",
      },
      {
        fields: ["orderDate", "deletedAt"],
        name: "order_date_deleted_at_idx",
      },
    ],
  }
);

Order.hasMany(OrderLine, { as: "orderLines", foreignKey: "orderId" });
OrderLine.belongsTo(Order, { foreignKey: "orderId" });

Order.belongsTo(Customer, { as: "customer", foreignKey: "customerId" });
Customer.hasMany(Order, { foreignKey: "customerId" });

Order.belongsTo(User, { as: "user", foreignKey: "userId" });
User.hasMany(Order, { foreignKey: "userId" });

Order.belongsTo(ShippingCompany, { as: "shippingCompanyRecord", foreignKey: "shippingCompany", targetKey: "name" });
ShippingCompany.hasMany(Order, { as: "orders", foreignKey: "shippingCompany", sourceKey: "name" });

Order.hasMany(Note, {
  as: "notesList",
  foreignKey: "entityId",
  constraints: false,
  scope: {
    entityType: "order", // This ensures only notes with entityType='order' are included
  },
});
// Order.sync({ alter: true }).then(() => {
//   console.log("Order table synced");
// });
export = Order;
