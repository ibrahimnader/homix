require("dotenv").config();
const Sequelize = require("sequelize");
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT,
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  }
);

async function testConnection() {
  try {
    await sequelize.sync().then(() => {
      console.log("Database & tables created!");
    });
    await sequelize.authenticate();
    console.log("Database connected succefully");
  } catch (error) {
    //ensure you created the database
    //check database credentials
    console.error("Unable to connect to the database:", error);
  }
}
testConnection();

module.exports = {
  sequelize,
  Sequelize,
};
