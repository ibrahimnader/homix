const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const { ORDER_STATUS } = require("../../../config/constants");
const OrderLine = require("../orderLines/orderline.model");
const Customer = require("../customer/customer.model");

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
      allowNull: false,
      defaultValue: ORDER_STATUS.PENDING,
    },
    financialStatus: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    customerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    totalCost: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: "orders",
    timestamps: true,
    paranoid: true,
  }
);

Order.hasMany(OrderLine, { as: "orderLines", foreignKey: "orderId" });
OrderLine.belongsTo(Order, { as: "order", foreignKey: "orderId" });
Order.hasOne(Customer, { as: "customer", foreignKey: "id" });
Customer.hasMany(Order, { as: "order", foreignKey: "customerId" });
Order.sync({
  alter: true,
})
  .then((result) => {
    console.log(result);
  })
  .catch((err) => {});

module.exports = Order;
