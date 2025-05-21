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

async function connectToDb() {
  try {
    await sequelize
      .sync({
        // alter: true,
      })
      .then(() => {
        console.log("Database & tables created!");
      });
      // await sequelize.query(`
      //   ALTER TABLE vendors 
      //   ADD COLUMN IF NOT EXISTS "daysToDeliver" INTEGER
      // `);

      // await sequelize.query(
      //   "ALTER TABLE products DROP CONSTRAINT IF EXISTS products_shopifyId_key96"
      // );
      
      // // Also try the original constraint name
      // await sequelize.query(
      //   "ALTER TABLE products DROP CONSTRAINT IF EXISTS products_shopifyId_key"
      // );
      
      // // Get a list of all constraints and drop any with shopifyId
      // const [constraints] = await sequelize.query(
      //   `SELECT constraint_name 
      //    FROM information_schema.table_constraints 
      //    WHERE table_name = 'products' AND constraint_name LIKE '%shopifyId%'`
      // );
      
      // for (const constraint of constraints) {
      //   await sequelize.query(
      //     `ALTER TABLE products DROP CONSTRAINT IF EXISTS "${constraint.constraint_name}"`
      //   );
      // }
      // const [constraints1] = await sequelize.query(
      //   `SELECT constraint_name 
      //    FROM information_schema.table_constraints 
      //    WHERE table_name = 'orders' AND constraint_name LIKE '%shopifyId%'`
      // );
      
      // for (const constraint of constraints1) {
      //   await sequelize.query(
      //     `ALTER TABLE orders DROP CONSTRAINT IF EXISTS "${constraint.constraint_name}"`
      //   );
      // }
      // const [constraints2] = await sequelize.query(
      //   `SELECT constraint_name 
      //    FROM information_schema.table_constraints 
      //    WHERE table_name = 'orderLines' AND constraint_name LIKE '%shopifyId%'`
      // );
            
      // for (const constraint of constraints2) {
      //   await sequelize.query(
      //     `ALTER TABLE "orderLines" DROP CONSTRAINT IF EXISTS "${constraint.constraint_name}"`
      //   );
      // }
   
    await sequelize.authenticate();
    console.log("Database connected succefully");
  } catch (error) {
    //ensure you created the database
    //check database credentials
    console.error("Unable to connect to the database:", error);
  }
}

module.exports = {
  sequelize,
  Sequelize,
  connectToDb,
};
