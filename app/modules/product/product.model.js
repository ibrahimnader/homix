const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const Vendor = require("../vendor/vendor.model");

const Product = sequelize.define(
  "Product",
  {
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    vendorId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    image: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    shopifyId: {
      type: DataTypes.TEXT,
      allowNull: true,
      unique: true,
    },
    variants: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    tableName: "products",
    timestamps: true,
    paranoid: true,
  }
);

Product.belongsTo(Vendor, { as: 'vendor', foreignKey: 'vendorId' });
Vendor.hasMany(Product, { as: 'product', foreignKey: 'vendorId' });

module.exports = Product;
