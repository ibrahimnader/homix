const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const Vendor = sequelize.define(
  "Vendor",
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
  },
  {
    tableName: "vendors",
    timestamps: true,
    paranoid: true,
  }
);
Vendor.associate = (models) => {
  Vendor.hasMany(models.Product, { as: "products", foreignKey: "id" });
};
module.exports = Vendor;
