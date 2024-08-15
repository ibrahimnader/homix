const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const User = require("../user/user.model");
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
Vendor.hasOne(User, {
  foreignKey: "vendorId",
  as: "user",
});

module.exports = Vendor;
