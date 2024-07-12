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
    deletedAt: 'destroyTime',
  }
);
module.exports = Vendor;
