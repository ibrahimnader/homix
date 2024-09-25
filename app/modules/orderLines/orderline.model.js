const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const Product = require("../product/product.model");
const Note = require("../notes/notes.model");

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
      allowNull: true,
    },
    itemStatus: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    size: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    material: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    itemShipping: {
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

OrderLine.belongsTo(Product, { as: "product", foreignKey: "productId" });
Product.hasMany(OrderLine, { as: "orderLines", foreignKey: "productId" });
OrderLine.hasMany(Note, { as: "notesList", foreignKey: "entityId" });
Note.belongsTo(OrderLine, { foreignKey: "entityId" });
module.exports = OrderLine;
