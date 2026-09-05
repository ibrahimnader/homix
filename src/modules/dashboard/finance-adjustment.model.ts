const { DataTypes } = require("sequelize");

const { sequelize } = require("../../infrastructure/database");

const FinanceAdjustment = sequelize.define(
  "FinanceAdjustment",
  {
    amount: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(16, 2) },
    label: { allowNull: false, type: DataTypes.STRING(160) },
    month: { allowNull: false, type: DataTypes.STRING(7) },
    sortOrder: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    type: { allowNull: false, type: DataTypes.ENUM("positive", "negative") },
  },
  {
    indexes: [{ fields: ["month", "sortOrder"], name: "finance_adjustment_month_sort_idx" }],
    tableName: "financeAdjustments",
    timestamps: true,
  },
);

export = FinanceAdjustment;
