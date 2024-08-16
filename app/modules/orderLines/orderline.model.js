const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const Product = require("../product/product.model");
const Note = require("../notes/notes.model");
const { ORDER_STATUS } = require("../../../config/constants");

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
    unitCost: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: ORDER_STATUS.PENDING,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "orderLines",
    timestamps: true,
    paranoid: true,
  }
);

OrderLine.belongsTo(Product, { as: "product", foreignKey: "productId" });
Product.hasMany(OrderLine, { as: "orderLines", foreignKey: "productId" });
OrderLine.hasMany(Note, {
  as: "notesList",
  foreignKey: "entityId",
});
OrderLine.sync({ alter: true });
module.exports = OrderLine;
