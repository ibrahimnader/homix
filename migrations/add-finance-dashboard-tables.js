module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalizedTables = tables.map((table) => typeof table === "string" ? table : table.tableName);

    if (!normalizedTables.includes("financeDailyMetrics")) {
      await queryInterface.createTable("financeDailyMetrics", {
        id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
        metricDate: { allowNull: false, type: Sequelize.DATEONLY },
        gmvOnline: { allowNull: false, defaultValue: 0, type: Sequelize.DECIMAL(16, 2) },
        gmvShowroom: { allowNull: false, defaultValue: 0, type: Sequelize.DECIMAL(16, 2) },
        cancellations: { allowNull: false, defaultValue: 0, type: Sequelize.DECIMAL(16, 2) },
        discounts: { allowNull: false, defaultValue: 0, type: Sequelize.DECIMAL(16, 2) },
        deliveredHomix: { allowNull: false, defaultValue: 0, type: Sequelize.DECIMAL(16, 2) },
        deliveredVendor: { allowNull: false, defaultValue: 0, type: Sequelize.DECIMAL(16, 2) },
        cogsGmv: { allowNull: false, defaultValue: 0, type: Sequelize.DECIMAL(16, 2) },
        cogsNmv: { allowNull: false, defaultValue: 0, type: Sequelize.DECIMAL(16, 2) },
        cogsG2n: { allowNull: false, defaultValue: 0, type: Sequelize.DECIMAL(16, 2) },
        orderCount: { allowNull: false, defaultValue: 0, type: Sequelize.INTEGER },
        sourceUpdatedAt: { allowNull: true, type: Sequelize.DATE },
        createdAt: { allowNull: false, type: Sequelize.DATE },
        updatedAt: { allowNull: false, type: Sequelize.DATE },
      });
      await queryInterface.addIndex("financeDailyMetrics", ["metricDate"], {
        name: "finance_daily_metric_date_idx",
        unique: true,
      });
    }

    if (!normalizedTables.includes("financeOpex")) {
      await queryInterface.createTable("financeOpex", {
        id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
        month: { allowNull: false, type: Sequelize.STRING(7) },
        label: { allowNull: false, type: Sequelize.STRING(160) },
        amount: { allowNull: false, defaultValue: 0, type: Sequelize.DECIMAL(16, 2) },
        sortOrder: { allowNull: false, defaultValue: 0, type: Sequelize.INTEGER },
        createdAt: { allowNull: false, type: Sequelize.DATE },
        updatedAt: { allowNull: false, type: Sequelize.DATE },
      });
      await queryInterface.addIndex("financeOpex", ["month", "sortOrder"], {
        name: "finance_opex_month_sort_idx",
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable("financeOpex");
    await queryInterface.dropTable("financeDailyMetrics");
  },
};
