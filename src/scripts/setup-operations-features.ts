import { DataTypes } from "sequelize";
import { sequelize } from "../infrastructure/database";

const migrations = [
  require("../../migrations/add-warehouse-receiving-columns"),
  require("../../migrations/add-warehouse-receipt-movements"),
  require("../../migrations/add-shipment-reassignments"),
  require("../../migrations/add-fine-rules"),
];

async function run(): Promise<void> {
  await sequelize.authenticate();
  for (const migration of migrations) await migration.up(sequelize.getQueryInterface(), DataTypes);
  console.log("Operations feature tables are ready.");
}

run().catch((error) => { console.error("Operations feature setup failed", error); process.exitCode = 1; })
  .finally(async () => sequelize.close());
