module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("orders");

    if (!table.warehouseReceivedBy) {
      await queryInterface.addColumn("orders", "warehouseReceivedBy", {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      });
    }
    if (!table.warehouseSenderName) {
      await queryInterface.addColumn("orders", "warehouseSenderName", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
    if (!table.warehouseReceiptNotes) {
      await queryInterface.addColumn("orders", "warehouseReceiptNotes", {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
    if (!table.warehouseReceiptNumber) {
      await queryInterface.addColumn("orders", "warehouseReceiptNumber", {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
    if (!table.warehouseReceiptIssuedAt) {
      await queryInterface.addColumn("orders", "warehouseReceiptIssuedAt", {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS orders_warehouse_receipt_number_idx ON orders ("warehouseReceiptNumber")`
    );
    // Backs the RCV-YYYY-NNNN document numbers — plain sequence, no table needed.
    await queryInterface.sequelize.query(
      `CREATE SEQUENCE IF NOT EXISTS warehouse_receipt_number_seq`
    );
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("orders");
    for (const column of [
      "warehouseReceivedBy",
      "warehouseSenderName",
      "warehouseReceiptNotes",
      "warehouseReceiptNumber",
      "warehouseReceiptIssuedAt",
    ]) {
      if (table[column]) {
        await queryInterface.removeColumn("orders", column);
      }
    }
    await queryInterface.sequelize.query(`DROP SEQUENCE IF EXISTS warehouse_receipt_number_seq`);
  },
};
