module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("orders");
    if (!table.receivedAmountManuallySet) {
      await queryInterface.addColumn("orders", "receivedAmountManuallySet", {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      });
    }

    // Positive historical values were necessarily set/received explicitly.
    // This preserves them even if the marker column is added after the fact.
    await queryInterface.sequelize.query(`
      UPDATE orders
      SET "receivedAmountManuallySet" = TRUE
      WHERE COALESCE("receivedAmount", 0) > 0
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("orders");
    if (table.receivedAmountManuallySet) {
      await queryInterface.removeColumn("orders", "receivedAmountManuallySet");
    }
  },
};
