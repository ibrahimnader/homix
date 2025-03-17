const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const {
  ORDER_STATUS,
  PAYMENT_STATUS,
  DELIVERY_STATUS,
} = require("../../../config/constants");
const OrderLine = require("../orderLines/orderline.model");
const Customer = require("../customer/customer.model");

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
      allowNull: false,
    },
    number: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    orderNumber: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    subTotalPrice: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    totalPrice: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },
    totalDiscounts: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },
    orderDate: {
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
      allowNull: false,
      defaultValue: 0,
    },
    paymentStatus: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    commission: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },
    totalTax: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },
    shippingFees: {
      type: DataTypes.DECIMAL,
      allowNull: false,
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
      type: DataTypes.ENUM(Object.values(DELIVERY_STATUS)),
      allowNull: true,
    },
  },
  {
    tableName: "orders",
    timestamps: true,
    paranoid: true,
  }
);

Order.hasMany(OrderLine, { as: "orderLines", foreignKey: "orderId" });
OrderLine.belongsTo(Order, { foreignKey: "orderId" });

Order.belongsTo(Customer, { as: "customer", foreignKey: "customerId" });
Customer.hasMany(Order, { foreignKey: "customerId" });
module.exports = Order;
