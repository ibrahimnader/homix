import http from "http";

import cron from "node-cron";
import { Server } from "socket.io";
import { Op } from "sequelize";

import { env } from "./config/env";
import { createApp } from "./app";
import { connectToDatabase } from "./infrastructure/database";
import { navigationCountsEvents } from "./modules/navigation";
import { DashboardAggregateService } from "./modules/dashboard/dashboard-aggregate.service";
import type { DashboardMetricSnapshot } from "./modules/dashboard/dashboard.types";
import { logger } from "./shared/logger/logger";

const createDefaultData = require("../config/defaultData.seeder");
require("../config/shopify");

const userModel = require("../app/modules/user/user.model");
const orderService = require("../app/modules/order/order.service");
const orderModel = require("../app/modules/order/order.model");
import { runDailyJobIfDue, runIntervalJobIfDue } from "./shared/jobs/daily-job-runner";

type LegacyUserRecord = {
  save: () => Promise<void>;
  socketIds?: string[];
};

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    methods: ["GET", "POST"],
    origin: "*",
  },
});

const registerSocketHandlers = (): void => {
  navigationCountsEvents.on("changed", () => {
    io.emit("navigationCountsChanged");
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Socket client connected");

    socket.on("subscribe", async (payload: { userId?: number }) => {
      if (!payload.userId) {
        return;
      }

      const user = (await userModel.findByPk(payload.userId)) as LegacyUserRecord | null;
      if (!user) {
        return;
      }

      user.socketIds = [...(user.socketIds ?? []), socket.id];
      await user.save();
      socket.emit("notification", {
        message: "Successfully subscribed to notifications",
      });
    });

    socket.on("disconnect", async () => {
      const userId = socket.handshake.query.userId;
      if (typeof userId !== "string") {
        return;
      }

      const user = (await userModel.findByPk(userId)) as LegacyUserRecord | null;
      if (!user) {
        return;
      }

      user.socketIds = (user.socketIds ?? []).filter((id) => id !== socket.id);
      await user.save();
    });
  });
};

const registerCronJobs = (): void => {
  cron.schedule(
    "0 */2 * * *",
    async () => {
      await runIntervalJobIfDue(IMPORT_ORDERS_JOB, IMPORT_ORDERS_INTERVAL_MINUTES, runSaveMissingOrders);
    },
    {
      timezone: "Africa/Cairo",
    },
  );

  /* Wrapped in the daily-run marker: the midnight tick only fires if the process
     happens to be awake then, and the same job is also attempted on boot. The
     marker keeps it to one run per Cairo day whichever path gets there first. */
  cron.schedule(
    "0 0 * * *",
    async () => {
      await runDailyJobIfDue(DAILY_FINES_JOB, runDailyFines);
    },
    {
      timezone: "Africa/Cairo",
    },
  );
};

const IMPORT_ORDERS_JOB = "saveMissingOrders";
/** Matches the 2-hourly schedule, so a restart cannot re-import on every boot. */
const IMPORT_ORDERS_INTERVAL_MINUTES = 120;
const dashboardAggregateService = new DashboardAggregateService({
  getDeliveredOrdersCountFromOrders: async () => 0,
  getSnapshotFromOrders: async (): Promise<DashboardMetricSnapshot> => ({
    activeMakers: 0, activeProducts: 0, pendingOrders: 0, totalOrders: 0, totalSales: 0,
  }),
});

const runSaveMissingOrders = async (): Promise<void> => {
  const importStartedAt = new Date();
  const result = await orderService.saveMissingOrders();
  const changedOrders = await orderModel.findAll({
    attributes: ["orderDate"],
    where: { updatedAt: { [Op.gte]: importStartedAt } },
  });
  const changedDates = changedOrders
    .map((order: { orderDate?: Date | string }) => new Date(order.orderDate ?? ""))
    .filter((date: Date) => !Number.isNaN(date.getTime()))
    .map((date: Date) => date.toISOString().slice(0, 10))
    .sort();
  if (changedDates.length > 0) {
    await dashboardAggregateService.refreshRange(changedDates[0], changedDates[changedDates.length - 1]);
  }
  logger.info(
    { message: result?.message, operationName: IMPORT_ORDERS_JOB },
    "Missing orders imported",
  );
};

const DAILY_FINES_JOB = "recalculateDailyFines";

const runDailyFines = async (): Promise<void> => {
  const result = await orderService.recalculateDailyFines();
  logger.info(
    {
      operationName: DAILY_FINES_JOB,
      updatedCount: result?.updatedCount ?? 0,
    },
    "Daily fines recalculated",
  );
};

/**
 * Catches up a daily job that was missed while the process was down. Runs after
 * the server is listening so a slow recompute never delays startup, and never
 * throws — a failed catch-up must not take the server with it.
 */
const runStartupCatchUp = (): void => {
  void runDailyJobIfDue(DAILY_FINES_JOB, runDailyFines).catch((error: unknown) => {
    logger.error({ err: error, operationName: DAILY_FINES_JOB }, "Startup catch-up failed");
  });

  /* Only imports when the last run is older than the schedule interval, so a
     redeploy loop does not repeat the Shopify import on every boot. */
  void runIntervalJobIfDue(IMPORT_ORDERS_JOB, IMPORT_ORDERS_INTERVAL_MINUTES, runSaveMissingOrders)
    .catch((error: unknown) => {
      logger.error({ err: error, operationName: IMPORT_ORDERS_JOB }, "Startup catch-up failed");
    });
};

const bootstrap = async (): Promise<void> => {
  await connectToDatabase();
  registerSocketHandlers();
  registerCronJobs();
  await createDefaultData();

  server.listen(env.NODE_PORT, () => {
    logger.info({ port: env.NODE_PORT }, "Server running");
    runStartupCatchUp();
  });
};

void bootstrap().catch((error: unknown) => {
  logger.error({ err: error }, "Failed to start server");
  process.exitCode = 1;
});
