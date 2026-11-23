module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("shipmentExpenses");
    if (!table.disbursementDate) {
      await queryInterface.addColumn("shipmentExpenses", "disbursementDate", {
        allowNull: true,
        type: Sequelize.DATE,
      });
    }
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS shipment_expenses_disbursement_date_idx ON "shipmentExpenses" ("disbursementDate")`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS shipment_expenses_disbursement_date_idx`);
    const table = await queryInterface.describeTable("shipmentExpenses");
    if (table.disbursementDate) {
      await queryInterface.removeColumn("shipmentExpenses", "disbursementDate");
    }
  },
};
