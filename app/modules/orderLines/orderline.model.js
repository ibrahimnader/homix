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
      allowNull: false,
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
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
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
