const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const Vendor = require("../vendor/vendor.model");
const Category = require("../category/category.model");
const ProductCategory = require("../category/productCategory.model");

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
    typeId: {
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
      unique: false,
    },
    variants: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
    },
  },
  {
    tableName: "products",
    timestamps: true,
    paranoid: true,
  }
);

Product.belongsTo(Vendor, { as: "vendor", foreignKey: "vendorId" });
Vendor.hasMany(Product, { as: "product", foreignKey: "vendorId" });
Product.hasMany(ProductCategory, {
  as: "categories",
  foreignKey: "productId",
});
ProductCategory.belongsTo(Product, {
  as: "product",
  foreignKey: "productId",
});

module.exports = Product;
