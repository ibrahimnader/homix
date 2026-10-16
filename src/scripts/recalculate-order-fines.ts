import { connectToDb, sequelize } from "../infrastructure/database";
import { recalculateRuleFines } from "../modules/fines/recalculate-fines";

const main = async (): Promise<void> => {
  await connectToDb();

  const updatedCount = await recalculateRuleFines();

  console.log(JSON.stringify({
    status: true,
    updatedCount,
  }, null, 2));
  await sequelize.close();
};

main().catch(async (error) => {
  console.error(error);
  await sequelize.close();
  process.exit(1);
});
