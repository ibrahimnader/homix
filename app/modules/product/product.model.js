const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const Vendor = require("../vendor/vendor.model");

const Product = sequelize.define(
  "Product",
  {
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    vendorId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    image: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    shopifyId: {
      type: DataTypes.STRING,
      allowNull: true,
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


module.exports = Product;
