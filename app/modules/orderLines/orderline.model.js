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
      unique: true,
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
      allowNull: true,
    },
    variant_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    discount: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: 0,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
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
OrderLine.hasMany(Note, { as: "notesList", foreignKey: "entityId" });
Note.belongsTo(OrderLine, { foreignKey: "entityId" });
module.exports = OrderLine;
