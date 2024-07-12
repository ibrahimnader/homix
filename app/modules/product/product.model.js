const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");

const Product = sequelize.define(
  "Product",
  {
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    vendorId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    vendor: {
      type: DataTypes.STRING,
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
  },
  {
    tableName: "products",
    timestamps: true,
    paranoid: true,
    deletedAt: 'destroyTime',
  }
);

module.exports = Product;
