module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("orders");

    if (!table.scheduledDeliveryDate) {
      await queryInterface.addColumn("orders", "scheduledDeliveryDate", {
        allowNull: true,
        type: Sequelize.DATE,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("orders");

    if (table.scheduledDeliveryDate) {
      await queryInterface.removeColumn("orders", "scheduledDeliveryDate");
    }
  },
};
