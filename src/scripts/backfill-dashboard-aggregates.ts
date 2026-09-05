import dotenv from "dotenv";

const START_ARGUMENT_PREFIX = "--start=";
const END_ARGUMENT_PREFIX = "--end=";

const getArgumentValue = (prefix: string): string | undefined => {
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const run = async (): Promise<void> => {
  dotenv.config();
  /* This data script never authenticates users or seeds passwords. These
     process-local sentinels only satisfy the shared server config while the
     backfill runs; application startup remains strict. */
  process.env.DEFAULT_PASSWORD ??= "dashboard-backfill-not-used";
  process.env.JWT_SECRET ??= "dashboard-backfill-not-used";

  const [database, loggerModule, aggregateModule, repositoryModule] = await Promise.all([
    import("../infrastructure/database"),
    import("../shared/logger"),
    import("../modules/dashboard/dashboard-aggregate.service"),
    import("../modules/dashboard/dashboard.repo"),
  ]);
  const { connectToDb, sequelize } = database;
  const { logger } = loggerModule;
  const { DashboardAggregateService } = aggregateModule;
  const { DashboardRepository } = repositoryModule;

  await connectToDb();
  const dashboardRepository = new DashboardRepository();
  const dashboardAggregateService = new DashboardAggregateService(dashboardRepository);
  const startDate = getArgumentValue(START_ARGUMENT_PREFIX);
  const endDate = getArgumentValue(END_ARGUMENT_PREFIX);

  logger.info(
    {
      endDate,
      operationName: "dashboard-aggregate-backfill",
      startDate,
    },
    "Starting dashboard aggregate backfill",
  );

  await dashboardAggregateService.backfill(startDate, endDate);
  logger.info({ operationName: "dashboard-aggregate-backfill" }, "Dashboard aggregate backfill completed");
  await sequelize.close();
};

void run().catch((error: unknown) => {
  console.error("Dashboard aggregate backfill failed");
  console.error(error);
  process.exitCode = 1;
});
