const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");

const ProductCategory = sequelize.define(
  "ProductCategory",
  {
    shopifyId: {
      type: DataTypes.TEXT,
      allowNull: true,
      unique: true,
    },
    categoryId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    productId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "productsCategories",
  }
);


module.exports = ProductCategory;
