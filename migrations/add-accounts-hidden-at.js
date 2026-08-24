module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("orders");

    if (!table.accountsHiddenAt) {
      await queryInterface.addColumn("orders", "accountsHiddenAt", {
        allowNull: true,
        type: Sequelize.DATE,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("orders");

    if (table.accountsHiddenAt) {
      await queryInterface.removeColumn("orders", "accountsHiddenAt");
    }
  },
};
