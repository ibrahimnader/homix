import { DataTypes } from "sequelize";
import { sequelize } from "../infrastructure/database";

const migration = require("../../migrations/add-warehouse-receiving-columns");

async function run(): Promise<void> {
  await sequelize.authenticate();
  await migration.up(sequelize.getQueryInterface(), DataTypes);
  console.log("Warehouse receiving columns are ready.");
}

run()
  .catch((error) => {
    console.error("Failed to set up warehouse receiving", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
