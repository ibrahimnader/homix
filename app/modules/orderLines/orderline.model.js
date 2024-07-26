const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const Product = require("../product/product.model");

const OrderLine = sequelize.define(
  "OrderLine",
  {
    orderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    productId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    shopifyId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    price: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    sku: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    variant_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    discount: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    cost: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
  },
  {
    tableName: "orderLines",
    timestamps: true,
    paranoid: true,
  }
);

OrderLine.hasOne(Product, { as: "product", foreignKey: "id" });
Product.hasMany(OrderLine, { as: "orderLines", foreignKey: "productId" });
module.exports = OrderLine;
