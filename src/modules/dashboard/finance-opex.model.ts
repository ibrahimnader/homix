const { DataTypes } = require("sequelize");

const { sequelize } = require("../../infrastructure/database");

const FinanceOpex = sequelize.define(
  "FinanceOpex",
  {
    amount: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(16, 2) },
    label: { allowNull: false, type: DataTypes.STRING(160) },
    month: { allowNull: false, type: DataTypes.STRING(7) },
    sortOrder: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
  },
  {
    indexes: [
      { fields: ["month", "sortOrder"], name: "finance_opex_month_sort_idx" },
    ],
    tableName: "financeOpex",
    timestamps: true,
  },
);

export = FinanceOpex;
