const { DataTypes } = require("sequelize");

const { sequelize } = require("../../infrastructure/database");

const FinanceDailyMetric = sequelize.define(
  "FinanceDailyMetric",
  {
    cancellations: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(16, 2) },
    cogsG2n: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(16, 2) },
    cogsGmv: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(16, 2) },
    cogsNmv: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(16, 2) },
    deliveredHomix: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(16, 2) },
    deliveredVendor: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(16, 2) },
    discounts: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(16, 2) },
    gmvOnline: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(16, 2) },
    gmvShowroom: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(16, 2) },
    metricDate: { allowNull: false, type: DataTypes.DATEONLY },
    orderCount: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    sourceUpdatedAt: { allowNull: true, type: DataTypes.DATE },
  },
  {
    indexes: [{ fields: ["metricDate"], name: "finance_daily_metric_date_idx", unique: true }],
    tableName: "financeDailyMetrics",
    timestamps: true,
  },
);

export = FinanceDailyMetric;
