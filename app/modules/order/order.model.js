const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const { ORDER_STATUS } = require("../../../config/constants");
const OrderLine = require("../orderLines/orderline.model");

const Order = sequelize.define(
  "Order",
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    shopifyId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    number: {
      type: DataTypes.INTEGER,
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
    },
    totalDiscounts: {
      type: DataTypes.DECIMAL,
      allowNull: false,
    },
    orderDate: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: ORDER_STATUS.PENDING,
    },
  },
  {
    tableName: "orders",
    timestamps: true,
    paranoid: true,
  }
);

Order.hasMany(OrderLine, { as: "lines", foreignKey: "orderId" });

module.exports = Order;
