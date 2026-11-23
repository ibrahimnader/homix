require("dotenv").config();

const { DataTypes, Sequelize } = require("sequelize");

const sslDialectOptions = process.env.NODE_ENV !== "test"
  ? { ssl: { rejectUnauthorized: false, require: true } }
  : undefined;

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
  dialect: process.env.DB_DIALECT,
  dialectOptions: sslDialectOptions,
  host: process.env.DB_HOST,
  logging: false,
});

/* orders.invoiceNotes — «مسودة ملاحظات» printed on the order invoice. Idempotent. */
async function main() {
  const queryInterface = sequelize.getQueryInterface();

  try {
    await sequelize.authenticate();
    const table = await queryInterface.describeTable("orders");
    if (!table.invoiceNotes) {
      await queryInterface.addColumn("orders", "invoiceNotes", { allowNull: true, type: DataTypes.TEXT });
      console.log("Added orders.invoiceNotes");
    } else {
      console.log("orders.invoiceNotes already exists");
    }
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error("Migration failed", error);
    await sequelize.close().catch(() => undefined);
    process.exit(1);
  }
}

main();
