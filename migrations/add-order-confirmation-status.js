module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("orders");
    if (!table.confirmationStatus) {
      await queryInterface.addColumn("orders", "confirmationStatus", {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("orders");
    if (table.confirmationStatus) {
      await queryInterface.removeColumn("orders", "confirmationStatus");
    }
  },
};
