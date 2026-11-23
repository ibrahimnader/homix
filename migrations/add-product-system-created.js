/**
 * products.isSystemCreated: products created inside the system (new or duplicated) rather
 * than imported from Shopify. They have no shopifyId, are never touched by the Shopify sync,
 * and the catalogue classification (isCatalogProduct) keeps them visible. Idempotent.
 *
 * Run with: npm run db:migrate-product-system-created   (uses the app's DB_* env connection)
 */
const { DataTypes } = require("sequelize");
const { sequelize } = require("../src/infrastructure/database");

const run = async () => {
  await sequelize.authenticate();
  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable("products");
  if (table.isSystemCreated) {
    console.log("- products.isSystemCreated already exists");
  } else {
    await queryInterface.addColumn("products", "isSystemCreated", {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    });
    console.log("+ added products.isSystemCreated");
  }
  await sequelize.close();
};

run().catch((error) => {
  console.error("Product isSystemCreated migration failed");
  console.error(error);
  process.exitCode = 1;
});
