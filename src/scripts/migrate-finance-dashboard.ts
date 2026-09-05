import dotenv from "dotenv";
import { Sequelize } from "sequelize";

const migration = require("../../migrations/add-finance-dashboard-tables") as {
  up: (queryInterface: ReturnType<Sequelize["getQueryInterface"]>, sequelizeType: typeof Sequelize) => Promise<void>;
};

const run = async (): Promise<void> => {
  dotenv.config();

  const databaseName = process.env.DB_NAME;
  const databaseUser = process.env.DB_USER;
  const databasePassword = process.env.DB_PASSWORD;
  const databaseHost = process.env.DB_HOST;
  const dialect = process.env.DB_DIALECT as "postgres" | "mysql" | "mariadb" | "sqlite" | "mssql" | undefined;

  if (!databaseName || !databaseUser || !databasePassword || !databaseHost || !dialect) {
    throw new Error("DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, and DB_DIALECT are required");
  }

  const sequelize = new Sequelize(databaseName, databaseUser, databasePassword, {
    dialect,
    dialectOptions: process.env.NODE_ENV === "test"
      ? undefined
      : { ssl: { rejectUnauthorized: false, require: true } },
    host: databaseHost,
    logging: false,
  });

  try {
    await sequelize.authenticate();
    await migration.up(sequelize.getQueryInterface(), Sequelize);
    console.log("Finance dashboard tables migrated");
  } finally {
    await sequelize.close();
  }
};

void run().catch((error: unknown) => {
  console.error("Finance dashboard migration failed");
  console.error(error);
  process.exitCode = 1;
});
