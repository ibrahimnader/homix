const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../src/infrastructure/database");

const ShipmentExpense = sequelize.define(
  "ShipmentExpense",
  {
    type: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        isIn: [[1, 2, 3, 4, 5, 6]],
      },
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 0,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    accountingStatus: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      validate: {
        isIn: [[1, 2]],
      },
    },
    accountingDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // تاريخ الصرف: يوم دفع المصروف فعلياً — مستقل عن تاريخ المحاسبة.
    disbursementDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "shipmentExpenses",
    timestamps: true,
    paranoid: true,
    indexes: [
      { fields: ["type"] },
      { fields: ["accountingStatus"] },
      { fields: ["accountingDate"] },
      { fields: ["disbursementDate"] },
      { fields: ["deletedAt"] },
    ],
  },
);

export = ShipmentExpense;
