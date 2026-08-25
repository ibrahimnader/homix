import { execFileSync } from "node:child_process";

import { DataTypes, QueryTypes } from "sequelize";

import { connectToDb, sequelize } from "../infrastructure/database";
import { DashboardAggregateService } from "../modules/dashboard/dashboard-aggregate.service";
import { DashboardRepository } from "../modules/dashboard/dashboard.repo";
import { calculateOrderFine } from "../modules/orders/order-fines";
import { getPermissionTemplateForUserType } from "../../app/modules/user/user.permissions";
import { normalizePermissions, toPlainRecord, toText } from "../../app/modules/user/user.helpers";
import { backfillManualOrderData } from "./backfill-manual-order-data";

const User = require("../../app/modules/user/user.model") as {
  findAll: () => Promise<Array<Record<string, unknown>>>;
};

const queryInterface = sequelize.getQueryInterface();

const FINAL_FINE_STATUSES = [4, 5, 6, 7, 8] as const;
const VENDOR_USER_TYPE = "2";
const DEFAULT_ORDER_PRIORITY = 1;
/** «اونلاين» — الغالبية تأتي من الاستيراد؛ الطلب اليدوي يُضبط على «شو رووم» صراحةً. */
const DEFAULT_ORDER_SOURCE = 2;

const hasFlag = (flag: string): boolean => process.argv.includes(flag);

const logStep = (message: string): void => {
  // eslint-disable-next-line no-console
  console.log(`\n==> ${message}`);
};

const printBranchDiffSummary = (): void => {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-status", "develop...refactor", "--", "migrations", "src/scripts", "app/modules", "src/modules"],
      { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();

    if (!output) {
      return;
    }

    const lines = output.split("\n");
    // eslint-disable-next-line no-console
    console.log(`Detected ${lines.length} changed files between develop and refactor`);
    for (const line of lines.slice(0, 40)) {
      // eslint-disable-next-line no-console
      console.log(`  ${line}`);
    }
    if (lines.length > 40) {
      // eslint-disable-next-line no-console
      console.log(`  ... and ${lines.length - 40} more`);
    }
  } catch (_error) {
    // Ignore branch diff failures in deployment environments without git metadata.
  }
};

const normalizeNumber = (value: unknown): number => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
};

const ensureTable = async (tableName: string, columns: Record<string, object>): Promise<void> => {
  const tables = (await queryInterface.showAllTables()) as Array<string | { tableName?: string }>;
  const normalizedTables = tables.map((table) => {
    if (typeof table === "string") {
      return table;
    }
    return String(table.tableName ?? table);
  });

  if (!normalizedTables.includes(tableName)) {
    await queryInterface.createTable(tableName, columns as never);
  }
};

const ensureColumn = async (
  tableName: string,
  columnName: string,
  columnDefinition: object,
): Promise<void> => {
  const table = await queryInterface.describeTable(tableName);
  if (!(columnName in table)) {
    await queryInterface.addColumn(tableName, columnName, columnDefinition as never);
  }
};

const ensureIndex = async (
  tableName: string,
  indexName: string,
  fields: string[],
  options: Record<string, unknown> = {},
): Promise<void> => {
  const indexes = (await queryInterface.showIndex(tableName)) as Array<{ name?: string }>;
  if (!indexes.some((index) => index.name === indexName)) {
    await queryInterface.addIndex(tableName, fields, {
      name: indexName,
      ...options,
    });
  }
};

const runSql = async (sql: string): Promise<void> => {
  await sequelize.query(sql);
};

const ensureCoreColumns = async (): Promise<void> => {
  logStep("Ensuring refactor columns");

  await ensureColumn("orders", "orderSource", {
    allowNull: true,
    defaultValue: DEFAULT_ORDER_SOURCE,
    type: DataTypes.INTEGER,
  });
  await ensureColumn("orders", "priority", {
    allowNull: false,
    defaultValue: DEFAULT_ORDER_PRIORITY,
    type: DataTypes.INTEGER,
  });
  await ensureColumn("orders", "fine", {
    allowNull: true,
    defaultValue: 0,
    type: DataTypes.DECIMAL,
  });
  await ensureColumn("products", "isCatalogProduct", {
    allowNull: false,
    defaultValue: true,
    type: DataTypes.BOOLEAN,
  });
  await ensureColumn("orders", "deliveryBy", {
    allowNull: true,
    type: DataTypes.INTEGER,
  });
  await ensureColumn("orders", "scheduleStatus", {
    allowNull: true,
    type: DataTypes.INTEGER,
  });

  /* Accounting state for the deliveries ledger. Nullable on purpose: a null
     accountingStatus means "never set by a user", so the ledger keeps falling
     back to the payment status and existing rows read as they did before. */
  await ensureColumn("orders", "accountingStatus", {
    allowNull: true,
    type: DataTypes.INTEGER,
  });
  await ensureColumn("orders", "accountingDate", {
    allowNull: true,
    type: DataTypes.DATE,
  });
  await ensureColumn("orders", "accountingReference", {
    allowNull: true,
    type: DataTypes.STRING,
  });
  await ensureColumn("orders", "receivedAmountManuallySet", {
    allowNull: false,
    defaultValue: false,
    type: DataTypes.BOOLEAN,
  });
  await runSql(`
    UPDATE orders
    SET "receivedAmountManuallySet" = TRUE
    WHERE COALESCE("receivedAmount", 0) > 0
  `);

  await ensureColumn("vendors", "accountManagerUserId", {
    allowNull: true,
    type: DataTypes.INTEGER,
  });
  await ensureColumn("vendors", "shippingCost", {
    allowNull: false,
    defaultValue: 0,
    type: DataTypes.DECIMAL(12, 2),
  });

  await ensureColumn("users", "roleName", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("users", "accountStatus", { allowNull: false, defaultValue: "active", type: DataTypes.STRING });
  await ensureColumn("users", "phoneNumber", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("users", "jobTitle", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("users", "salary", { allowNull: true, type: DataTypes.DECIMAL });
  await ensureColumn("users", "bankName", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("users", "bankAccountType", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("users", "bankAccountHolderName", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("users", "bankAccountNumber", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("users", "walletNumber", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("users", "instaPayNumber", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("users", "permissions", { allowNull: false, defaultValue: {}, type: DataTypes.JSON });
  await ensureColumn("users", "lastSeenAt", { allowNull: true, type: DataTypes.DATE });
  await ensureColumn("users", "lastPasswordChangeAt", { allowNull: true, type: DataTypes.DATE });

  await ensureColumn("factories", "contactPersonRole", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("factories", "joinDate", { allowNull: true, type: DataTypes.DATEONLY });
  await ensureColumn("factories", "bankName", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("factories", "bankAccountType", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("factories", "bankAccountHolderName", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("factories", "bankAccountNumber", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("factories", "walletNumber", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("factories", "walletProvider", { allowNull: true, type: DataTypes.STRING });
  await ensureColumn("factories", "instapayNumber", { allowNull: true, type: DataTypes.STRING });

  await ensureColumn("attachments", "attachmentType", { allowNull: true, type: DataTypes.INTEGER });
  await ensureColumn("attachments", "verificationStatus", { allowNull: true, type: DataTypes.INTEGER });
  await ensureColumn("attachments", "issuedAt", { allowNull: true, type: DataTypes.DATEONLY });
  await ensureColumn("attachments", "expiresAt", { allowNull: true, type: DataTypes.DATEONLY });

  await queryInterface.changeColumn("orders", "deliveryBy", {
    allowNull: true,
    type: DataTypes.INTEGER,
  }).catch(() => undefined);
};

const classifyCatalogProducts = async (): Promise<void> => {
  logStep("Classifying catalogue products");
  await runSql(`
    UPDATE products
       SET "isCatalogProduct" = ("shopifyId" IS NOT NULL),
           "updatedAt" = NOW()
     WHERE "isCatalogProduct" IS DISTINCT FROM ("shopifyId" IS NOT NULL)
  `);
};

const ensureShipmentTables = async (): Promise<void> => {
  logStep("Ensuring shipment manual tables");

  await ensureTable("shipmentInventoryItems", {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
    productId: { allowNull: true, type: DataTypes.INTEGER },
    productCode: { allowNull: false, type: DataTypes.STRING },
    color: { allowNull: true, defaultValue: "", type: DataTypes.STRING },
    size: { allowNull: true, defaultValue: "", type: DataTypes.STRING },
    quantity: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    costPrice: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL },
    status: { allowNull: false, defaultValue: 1, type: DataTypes.INTEGER },
    createdAt: { allowNull: false, type: DataTypes.DATE },
    updatedAt: { allowNull: false, type: DataTypes.DATE },
    deletedAt: { allowNull: true, type: DataTypes.DATE },
  });
  await ensureColumn("shipmentInventoryItems", "productId", {
    allowNull: true,
    type: DataTypes.INTEGER,
  });

  await ensureTable("shipmentExpenses", {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
    type: { allowNull: false, defaultValue: 6, type: DataTypes.INTEGER },
    amount: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL },
    reason: { allowNull: false, type: DataTypes.TEXT },
    accountingStatus: { allowNull: false, defaultValue: 1, type: DataTypes.INTEGER },
    accountingDate: { allowNull: true, type: DataTypes.DATE },
    createdAt: { allowNull: false, type: DataTypes.DATE },
    updatedAt: { allowNull: false, type: DataTypes.DATE },
    deletedAt: { allowNull: true, type: DataTypes.DATE },
  });

  await ensureTable("shipmentReturns", {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
    orderId: { allowNull: false, type: DataTypes.INTEGER },
    returnType: { allowNull: false, type: DataTypes.INTEGER },
    status: { allowNull: false, type: DataTypes.INTEGER },
    reason: { allowNull: true, type: DataTypes.TEXT },
    returnDate: { allowNull: true, type: DataTypes.DATE },
    startedAt: { allowNull: false, type: DataTypes.DATE },
    completedAt: { allowNull: true, type: DataTypes.DATE },
    createdAt: { allowNull: false, type: DataTypes.DATE },
    updatedAt: { allowNull: false, type: DataTypes.DATE },
    deletedAt: { allowNull: true, type: DataTypes.DATE },
  });

  await ensureTable("shippingCompanies", {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
    name: { allowNull: false, type: DataTypes.STRING, unique: true },
    createdAt: { allowNull: false, type: DataTypes.DATE },
    updatedAt: { allowNull: false, type: DataTypes.DATE },
    deletedAt: { allowNull: true, type: DataTypes.DATE },
  });
};

const ensureDashboardTables = async (): Promise<void> => {
  logStep("Ensuring dashboard aggregate tables");

  await ensureTable("dashboardDailyMetrics", {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
    activeMakers: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    activeProducts: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    deliveredOrders: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    inProgressOrders: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    metricDate: { allowNull: false, type: DataTypes.DATEONLY },
    canceledOrRefundedOrders: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    pendingOrders: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    role: { allowNull: false, type: DataTypes.STRING },
    scopeId: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    totalOrders: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    totalSales: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(14, 2) },
    vendorId: { allowNull: true, type: DataTypes.INTEGER },
    createdAt: { allowNull: false, type: DataTypes.DATE },
    updatedAt: { allowNull: false, type: DataTypes.DATE },
  });
  await ensureColumn("dashboardDailyMetrics", "inProgressOrders", {
    allowNull: false,
    defaultValue: 0,
    type: DataTypes.INTEGER,
  });
  await ensureColumn("dashboardDailyMetrics", "canceledOrRefundedOrders", {
    allowNull: false,
    defaultValue: 0,
    type: DataTypes.INTEGER,
  });

  await ensureTable("dashboardDailyProductSales", {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
    metricDate: { allowNull: false, type: DataTypes.DATEONLY },
    productId: { allowNull: false, type: DataTypes.INTEGER },
    productTitle: { allowNull: false, type: DataTypes.TEXT },
    totalOrders: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    totalQuantity: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    totalSales: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(14, 2) },
    vendorId: { allowNull: false, type: DataTypes.INTEGER },
    createdAt: { allowNull: false, type: DataTypes.DATE },
    updatedAt: { allowNull: false, type: DataTypes.DATE },
  });

  await ensureTable("dashboardDailyCategorySales", {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
    categoryId: { allowNull: false, type: DataTypes.INTEGER },
    categoryTitle: { allowNull: false, type: DataTypes.TEXT },
    metricDate: { allowNull: false, type: DataTypes.DATEONLY },
    role: { allowNull: false, type: DataTypes.STRING },
    scopeId: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    totalOrders: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    totalQuantity: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    totalSales: { allowNull: false, defaultValue: 0, type: DataTypes.DECIMAL(14, 2) },
    vendorId: { allowNull: true, type: DataTypes.INTEGER },
    createdAt: { allowNull: false, type: DataTypes.DATE },
    updatedAt: { allowNull: false, type: DataTypes.DATE },
  });
};

const ensureTicketTable = async (): Promise<void> => {
  logStep("Ensuring tickets table");

  await ensureTable("tickets", {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
    orderId: { allowNull: false, type: DataTypes.INTEGER },
    type: { allowNull: false, type: DataTypes.INTEGER },
    status: { allowNull: false, defaultValue: 1, type: DataTypes.INTEGER },
    assignedToUserId: { allowNull: true, type: DataTypes.INTEGER },
    createdByUserId: { allowNull: true, type: DataTypes.INTEGER },
    notes: { allowNull: true, type: DataTypes.TEXT },
    closedAt: { allowNull: true, type: DataTypes.DATE },
    createdAt: { allowNull: false, type: DataTypes.DATE },
    updatedAt: { allowNull: false, type: DataTypes.DATE },
    deletedAt: { allowNull: true, type: DataTypes.DATE },
  });
};

/**
 * Marker table for scheduled jobs.
 *
 * node-cron timers live in memory, so a daily job only fires if the process
 * happens to be awake at that exact minute. A restart or an idle sleep before
 * Cairo midnight meant the fines recompute simply never ran. Recording the last
 * successful run lets the server catch up on boot instead.
 */
const ensureCronRunTable = async (): Promise<void> => {
  logStep("Ensuring scheduled job run table");

  await ensureTable("cronRuns", {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
    jobName: { allowNull: false, type: DataTypes.STRING },
    lastRunAt: { allowNull: false, type: DataTypes.DATE },
    createdAt: { allowNull: false, type: DataTypes.DATE },
    updatedAt: { allowNull: false, type: DataTypes.DATE },
  });
  await ensureIndex("cronRuns", "cron_runs_job_name_idx", ["jobName"], { unique: true });
};

const ensureManagedOptions = async (): Promise<void> => {
  logStep("Ensuring dynamic expense and ticket options");
  await ensureTable("managedOptions", {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
    optionGroup: { allowNull: false, type: DataTypes.STRING },
    optionId: { allowNull: false, type: DataTypes.INTEGER },
    label: { allowNull: false, type: DataTypes.STRING },
    sortOrder: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    active: { allowNull: false, defaultValue: true, type: DataTypes.BOOLEAN },
    createdAt: { allowNull: false, type: DataTypes.DATE },
    updatedAt: { allowNull: false, type: DataTypes.DATE },
  });
  await ensureIndex("managedOptions", "managed_options_group_id_idx", ["optionGroup", "optionId"], { unique: true });
  await ensureIndex("managedOptions", "managed_options_group_active_sort_idx", ["optionGroup", "active", "sortOrder"]);
  await runSql(`
    INSERT INTO "managedOptions" ("optionGroup", "optionId", label, "sortOrder", active, "createdAt", "updatedAt") VALUES
      ('expense_type', 1, 'شحن', 0, TRUE, NOW(), NOW()),
      ('expense_type', 2, 'تغليف', 1, TRUE, NOW(), NOW()),
      ('expense_type', 3, 'صيانة', 2, TRUE, NOW(), NOW()),
      ('expense_type', 4, 'إيجار مخزن', 3, TRUE, NOW(), NOW()),
      ('expense_type', 5, 'رواتب', 4, TRUE, NOW(), NOW()),
      ('expense_type', 6, 'أخرى', 5, TRUE, NOW(), NOW()),
      ('ticket_type', 1, 'تأخير في التوصيل', 0, TRUE, NOW(), NOW()),
      ('ticket_type', 2, 'إلغاء', 1, TRUE, NOW(), NOW()),
      ('ticket_type', 3, 'استرجاع الأموال', 2, TRUE, NOW(), NOW()),
      ('ticket_type', 4, 'استرجاع منتج', 3, TRUE, NOW(), NOW()),
      ('ticket_type', 5, 'رفض الاستلام', 4, TRUE, NOW(), NOW()),
      ('ticket_type', 6, 'فشل في التوصيل', 5, TRUE, NOW(), NOW()),
      ('ticket_type', 7, 'صيانة', 6, TRUE, NOW(), NOW()),
      ('ticket_type', 8, 'استبدال', 7, TRUE, NOW(), NOW()),
      ('ticket_type', 9, 'التحقق', 8, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 1, 'التوصيل خلال أسبوع', 0, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 2, 'التوصيل خلال 72 ساعة', 1, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 3, 'التوصيل خلال 48 ساعة', 2, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 4, 'ملغي', 3, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 5, 'تم استرداد المبلغ', 4, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 6, 'غير قابل للاسترداد', 5, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 7, 'لا يشمله الضمان', 6, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 8, 'غير صالح', 7, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 9, 'بسبب سوء الاستخدام', 8, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 10, 'قابل للإرجاع', 9, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 11, 'غير مقبول', 10, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 12, 'يعتمد على DC', 11, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 13, 'تم إبلاغ البائع', 12, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 14, 'استبدال', 13, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 15, 'تمت الموافقة على الإصلاح', 14, TRUE, NOW(), NOW()),
      ('ticket_quick_reply', 16, 'تم التوصيل', 15, TRUE, NOW(), NOW())
    ON CONFLICT ("optionGroup", "optionId") DO NOTHING;
  `);
};

const normalizeShipmentData = async (): Promise<void> => {
  logStep("Normalizing shipment data and shipping companies");

  /* deliveryBy is now the source of truth, but older rows only stored the
     shippedFromInventory boolean. Fill only missing deliveryBy values first,
     then make the legacy boolean agree with every canonical value. Deliberately
     leave updatedAt untouched because this is data normalization, not a new
     shipment event (performance dates come from the status history). */
  await runSql(`
    UPDATE orders
    SET "deliveryBy" = CASE
      WHEN "shippedFromInventory" IS TRUE THEN 1
      WHEN "shippedFromInventory" IS FALSE THEN 2
      ELSE NULL
    END
    WHERE "deliveryBy" IS NULL
      AND "shippedFromInventory" IS NOT NULL;
  `);

  await runSql(`
    UPDATE orders
    SET "shippedFromInventory" = ("deliveryBy" = 1)
    WHERE "deliveryBy" IN (1, 2)
      AND "shippedFromInventory" IS DISTINCT FROM ("deliveryBy" = 1);
  `);

  /* The orders -> shippingCompanies foreign key is enforced across every row,
     including soft-deleted ones, so the normalization below deliberately does
     NOT filter on "deletedAt". Filtering it left values like 'خاص ' (note the
     trailing space) on archived orders and the FK then failed to install. */
  await runSql(`
    INSERT INTO "shippingCompanies" ("name", "createdAt", "updatedAt")
    SELECT source."name", NOW(), NOW()
    FROM (
      SELECT MIN(TRIM("shippingCompany")) AS "name"
      FROM orders
      WHERE "shippingCompany" IS NOT NULL
        AND TRIM("shippingCompany") <> ''
      GROUP BY LOWER(TRIM("shippingCompany"))
    ) AS source
    WHERE NOT EXISTS (
      SELECT 1
      FROM "shippingCompanies" company
      WHERE LOWER(company."name") = LOWER(source."name")
    );
  `);

  await runSql(`
    UPDATE orders AS "Order"
    SET "shippingCompany" = company."name"
    FROM "shippingCompanies" company
    WHERE "Order"."shippingCompany" IS NOT NULL
      AND TRIM("Order"."shippingCompany") <> ''
      AND LOWER(TRIM("Order"."shippingCompany")) = LOWER(company."name")
      AND "Order"."shippingCompany" <> company."name";
  `);

  /* Blank-but-not-null values can never satisfy the FK. */
  await runSql(`
    UPDATE orders
    SET "shippingCompany" = NULL
    WHERE "shippingCompany" IS NOT NULL
      AND TRIM("shippingCompany") = '';
  `);

  await runSql(`
    ALTER TABLE "shipmentInventoryItems"
    ALTER COLUMN "status" TYPE INTEGER
    USING (
      CASE
        WHEN "status"::text IN ('1', '2') THEN "status"::integer
        WHEN LOWER(COALESCE("status"::text, '')) = 'instock' THEN 1
        WHEN LOWER(COALESCE("status"::text, '')) = 'outofstock' THEN 2
        ELSE 1
      END
    );
  `);

  await runSql(`
    ALTER TABLE "shipmentExpenses"
    ALTER COLUMN "type" TYPE INTEGER
    USING (
      CASE
        WHEN "type"::text IN ('1', '2', '3', '4', '5', '6') THEN "type"::integer
        WHEN COALESCE("type"::text, '') = 'شحن' THEN 1
        WHEN COALESCE("type"::text, '') = 'تغليف' THEN 2
        WHEN COALESCE("type"::text, '') = 'صيانة' THEN 3
        WHEN COALESCE("type"::text, '') = 'إيجار مخزن' THEN 4
        WHEN COALESCE("type"::text, '') = 'رواتب' THEN 5
        WHEN COALESCE("type"::text, '') = 'أخرى' THEN 6
        WHEN LOWER(COALESCE("type"::text, '')) = 'shipping' THEN 1
        WHEN LOWER(COALESCE("type"::text, '')) = 'packaging' THEN 2
        WHEN LOWER(COALESCE("type"::text, '')) = 'maintenance' THEN 3
        WHEN LOWER(COALESCE("type"::text, '')) IN ('warehouse_rent', 'warehouse rent') THEN 4
        WHEN LOWER(COALESCE("type"::text, '')) = 'salaries' THEN 5
        WHEN LOWER(COALESCE("type"::text, '')) = 'other' THEN 6
        ELSE 6
      END
    );
  `);

  await runSql(`
    ALTER TABLE "shipmentExpenses"
    ALTER COLUMN "accountingStatus" TYPE INTEGER
    USING (
      CASE
        WHEN "accountingStatus"::text IN ('1', '2') THEN "accountingStatus"::integer
        WHEN LOWER(COALESCE("accountingStatus"::text, '')) = 'pending' THEN 1
        WHEN LOWER(COALESCE("accountingStatus"::text, '')) = 'settled' THEN 2
        ELSE 1
      END
    );
  `);

  await runSql(`
    DO $$
    DECLARE
      has_product_name_column boolean;
    BEGIN
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'shipmentInventoryItems'
          AND column_name = 'productName'
      ) INTO has_product_name_column;

      IF has_product_name_column THEN
        UPDATE "shipmentInventoryItems" AS inventory
        SET "productId" = product.id
        FROM products AS product
        WHERE inventory."productId" IS NULL
          AND inventory."deletedAt" IS NULL
          AND product."deletedAt" IS NULL
          AND (
            EXISTS (
              SELECT 1
              FROM json_array_elements(COALESCE(product.variants, '[]'::json)) AS variant
              WHERE LOWER(COALESCE(variant->>'sku', '')) = LOWER(COALESCE(inventory."productCode", ''))
            )
            OR LOWER(COALESCE(product.title, '')) = LOWER(COALESCE(inventory."productName", ''))
          );
      ELSE
        UPDATE "shipmentInventoryItems" AS inventory
        SET "productId" = product.id
        FROM products AS product
        WHERE inventory."productId" IS NULL
          AND inventory."deletedAt" IS NULL
          AND product."deletedAt" IS NULL
          AND EXISTS (
            SELECT 1
            FROM json_array_elements(COALESCE(product.variants, '[]'::json)) AS variant
            WHERE LOWER(COALESCE(variant->>'sku', '')) = LOWER(COALESCE(inventory."productCode", ''))
          );
      END IF;
    END
    $$;
  `);

  await runSql(`ALTER TABLE orders ALTER COLUMN "orderSource" SET DEFAULT 2;`);
  await runSql(`ALTER TABLE orders ALTER COLUMN "priority" SET DEFAULT 1;`);
  await runSql(`ALTER TABLE "shipmentInventoryItems" ALTER COLUMN "status" SET DEFAULT 1;`);
  await runSql(`ALTER TABLE "shipmentExpenses" ALTER COLUMN "type" SET DEFAULT 6;`);
  await runSql(`ALTER TABLE "shipmentExpenses" ALTER COLUMN "accountingStatus" SET DEFAULT 1;`);

  /* The previous backfill only touched NULL/invalid values. Because the column
     default already stamped every row as showroom (1), it matched nothing and
     12,636 imported orders stayed mislabelled. The source is derived from the
     order's origin instead: a real Shopify id means online, anything else
     (custom / undefined / blank) is a manual showroom order. */
  await runSql(`
    UPDATE orders
    SET "orderSource" = CASE
      WHEN COALESCE(NULLIF(TRIM("shopifyId"), ''), 'custom') NOT IN ('custom', 'undefined') THEN 2
      ELSE 1
    END
    WHERE "deletedAt" IS NULL
      AND "orderSource" IS DISTINCT FROM CASE
        WHEN COALESCE(NULLIF(TRIM("shopifyId"), ''), 'custom') NOT IN ('custom', 'undefined') THEN 2
        ELSE 1
      END;
  `);

  await runSql(`
    UPDATE orders
    SET "priority" = 1
    WHERE "deletedAt" IS NULL
      AND ("priority" IS NULL OR "priority" NOT IN (1, 2, 3));
  `);
};

const ensureConstraints = async (): Promise<void> => {
  logStep("Ensuring foreign keys and unique constraints");

  /* A foreign key needs a unique constraint on the referenced column, and
     ensureIndexes runs later, so create it here first. */
  await ensureIndex("shippingCompanies", "shipping_companies_name_idx", ["name"], { unique: true });

  /* Last line of defence: any shippingCompany that still has no matching row
     would abort the whole migration, so detach it rather than fail. Runs after
     normalizeShipmentData, which registers every legitimate name first. */
  await runSql(`
    UPDATE orders
    SET "shippingCompany" = NULL
    WHERE "shippingCompany" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "shippingCompanies" company
        WHERE company."name" = orders."shippingCompany"
      );
  `);

  await runSql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_shipping_company_fkey') THEN
        ALTER TABLE orders DROP CONSTRAINT orders_shipping_company_fkey;
      END IF;
      ALTER TABLE orders
      ADD CONSTRAINT orders_shipping_company_fkey
      FOREIGN KEY ("shippingCompany") REFERENCES "shippingCompanies"("name")
      ON UPDATE CASCADE ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $$;
  `);

  await runSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_account_manager_user_id_fkey') THEN
        ALTER TABLE vendors
        ADD CONSTRAINT vendors_account_manager_user_id_fkey
        FOREIGN KEY ("accountManagerUserId") REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);

  await runSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_inventory_items_product_id_fkey') THEN
        ALTER TABLE "shipmentInventoryItems"
        ADD CONSTRAINT shipment_inventory_items_product_id_fkey
        FOREIGN KEY ("productId") REFERENCES products(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);

  await runSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_returns_order_id_fkey') THEN
        ALTER TABLE "shipmentReturns"
        ADD CONSTRAINT shipment_returns_order_id_fkey
        FOREIGN KEY ("orderId") REFERENCES orders(id)
        ON UPDATE CASCADE ON DELETE CASCADE;
      END IF;
    END
    $$;
  `);

  await runSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_returns_order_type_key') THEN
        ALTER TABLE "shipmentReturns"
        ADD CONSTRAINT shipment_returns_order_type_key
        UNIQUE ("orderId", "returnType");
      END IF;
    END
    $$;
  `);

  await runSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_orderId_fkey') THEN
        ALTER TABLE tickets
        ADD CONSTRAINT "tickets_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES orders(id)
        ON UPDATE CASCADE ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_assignedToUserId_fkey') THEN
        ALTER TABLE tickets
        ADD CONSTRAINT "tickets_assignedToUserId_fkey"
        FOREIGN KEY ("assignedToUserId") REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_createdByUserId_fkey') THEN
        ALTER TABLE tickets
        ADD CONSTRAINT "tickets_createdByUserId_fkey"
        FOREIGN KEY ("createdByUserId") REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);
};

const ensureIndexes = async (): Promise<void> => {
  logStep("Ensuring indexes");

  await ensureIndex("users", "users_accountStatus_idx", ["accountStatus"]);
  await ensureIndex("vendors", "vendors_accountManagerUserId_idx", ["accountManagerUserId"]);
  await ensureIndex("orders", "orders_fine_idx", ["fine"]);
  await ensureIndex("orders", "orders_deliveryBy_idx", ["deliveryBy"]);
  await ensureIndex("orders", "orders_priority_idx", ["priority"]);
  await ensureIndex("orders", "orders_shipping_company_idx", ["shippingCompany"]);
  /* Every shipments query starts from shippedFromInventory and usually narrows
     by shipmentStatus (the deliveries ledger pins it to DELIVERED). */
  await ensureIndex("orders", "orders_shipped_from_inventory_idx", ["shippedFromInventory"]);
  await ensureIndex("orders", "orders_shipped_from_inventory_status_idx", ["shippedFromInventory", "shipmentStatus"]);
  await ensureIndex(
    "logs",
    "logs_order_status_history_idx",
    ["entityType", "field", "entityId", "to", "createdAt"],
  );
  await ensureIndex("orders", "orders_accounting_status_idx", ["accountingStatus"]);
  await ensureIndex("orders", "orders_accounting_date_idx", ["accountingDate"]);
  await ensureIndex("orders", "orders_schedule_status_idx", ["scheduleStatus"]);
  await ensureIndex("shipmentInventoryItems", "shipment_inventory_product_id_idx", ["productId"]);
  await ensureIndex("shipmentInventoryItems", "shipment_inventory_product_code_idx", ["productCode"]);
  await ensureIndex("shipmentInventoryItems", "shipment_inventory_status_idx", ["status"]);
  await ensureIndex("shipmentExpenses", "shipment_expenses_type_idx", ["type"]);
  await ensureIndex("shipmentExpenses", "shipment_expenses_accounting_status_idx", ["accountingStatus"]);
  await ensureIndex("shipmentExpenses", "shipment_expenses_accounting_date_idx", ["accountingDate"]);
  await ensureIndex("shipmentReturns", "shipment_returns_order_type_idx", ["orderId", "returnType"]);
  await ensureIndex("shipmentReturns", "shipment_returns_status_idx", ["status"]);
  await ensureIndex("shipmentReturns", "shipment_returns_type_idx", ["returnType"]);
  await ensureIndex("shippingCompanies", "shipping_companies_name_idx", ["name"], { unique: true });
  await ensureIndex("tickets", "tickets_order_id_idx", ["orderId"]);
  await ensureIndex("tickets", "tickets_status_idx", ["status"]);
  await ensureIndex("tickets", "tickets_type_idx", ["type"]);
  await ensureIndex("tickets", "tickets_assigned_to_user_id_idx", ["assignedToUserId"]);
  await ensureIndex("tickets", "tickets_created_by_user_id_idx", ["createdByUserId"]);
  await ensureIndex("dashboardDailyMetrics", "dashboard_daily_metric_scope_idx", ["metricDate", "role", "scopeId"], { unique: true });
  await ensureIndex("dashboardDailyMetrics", "dashboard_daily_metric_vendor_idx", ["vendorId", "metricDate"]);
  await ensureIndex("dashboardDailyProductSales", "dashboard_daily_product_sale_scope_idx", ["metricDate", "vendorId", "productId"], { unique: true });
  await ensureIndex("dashboardDailyProductSales", "dashboard_daily_product_sale_vendor_idx", ["vendorId", "metricDate"]);
  await ensureIndex("dashboardDailyCategorySales", "dashboard_daily_category_sale_scope_idx", ["metricDate", "role", "scopeId", "categoryId"], { unique: true });
  await ensureIndex("dashboardDailyCategorySales", "dashboard_daily_category_sale_vendor_idx", ["vendorId", "metricDate"]);

  /* Folded in from migrations/add-indexes.js so the deploy script is the single
     place that has to run. ensureIndex is idempotent, so re-running is safe. */
  await ensureIndex("orders", "orders_name_idx", ["name"]);
  await ensureIndex("orders", "orders_number_idx", ["number"]);
  await ensureIndex("orders", "orders_orderDate_idx", ["orderDate"]);
  await ensureIndex("orders", "orders_expectedDeliveryDate_idx", ["expectedDeliveryDate"]);
  await ensureIndex("orders", "orders_custom_idx", ["custom"]);
  await ensureIndex("orders", "orders_deletedAt_idx", ["deletedAt"]);
  await ensureIndex("orders", "order_date_status_idx", ["orderDate", "status"]);
  await ensureIndex("orders", "status_expected_delivery_idx", ["status", "expectedDeliveryDate"]);
  await ensureIndex("orders", "order_date_deleted_at_idx", ["orderDate", "deletedAt"]);
  await ensureIndex("orderLines", "orderLines_orderId_idx", ["orderId"]);
  await ensureIndex("orderLines", "orderLines_productId_idx", ["productId"]);
  await ensureIndex("orderLines", "orderLines_shopifyId_idx", ["shopifyId"]);
  await ensureIndex("orderLines", "orderLines_deletedAt_idx", ["deletedAt"]);
  await ensureIndex("orderLines", "orderline_order_product_idx", ["orderId", "productId"]);
  await ensureIndex("products", "products_vendorId_idx", ["vendorId"]);
  await ensureIndex("products", "products_typeId_idx", ["typeId"]);
  await ensureIndex("products", "products_shopifyId_idx", ["shopifyId"]);
  await ensureIndex("products", "products_status_idx", ["status"]);
  await ensureIndex("products", "products_catalog_idx", ["isCatalogProduct"]);
  await ensureIndex("products", "products_deletedAt_idx", ["deletedAt"]);
  await ensureIndex("products", "product_vendor_deleted_idx", ["vendorId", "deletedAt"]);
  await ensureIndex("vendors", "vendors_name_idx", ["name"]);
  await ensureIndex("vendors", "vendors_deletedAt_idx", ["deletedAt"]);
  await ensureIndex("customers", "customers_shopifyId_idx", ["shopifyId"]);
  await ensureIndex("customers", "customers_email_idx", ["email"]);
  await ensureIndex("customers", "customers_phoneNumber_idx", ["phoneNumber"]);
  await ensureIndex("customers", "customers_deletedAt_idx", ["deletedAt"]);

  await ensureTrigramSearchIndexes();
};

/**
 * Order/shipment lookups match with LOWER(col) LIKE '%term%'. A leading wildcard
 * makes a btree index useless, so these searches fall back to a sequential scan.
 * pg_trgm GIN indexes serve them directly.
 *
 * Creating an extension needs elevated rights on some managed instances, so a
 * failure here is logged and skipped rather than aborting the whole migration —
 * the indexes are an optimisation, not a correctness requirement.
 */
const ensureTrigramSearchIndexes = async (): Promise<void> => {
  try {
    await runSql(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("  ! skipping trigram search indexes (pg_trgm unavailable)", error instanceof Error ? error.message : error);
    return;
  }

  const trigramIndexes: [string, string, string][] = [
    ["orders_name_trgm_idx", "orders", "name"],
    ["orders_number_trgm_idx", "orders", "number"],
    ["orders_order_number_trgm_idx", "orders", "orderNumber"],
    ["orders_code_trgm_idx", "orders", "code"],
  ];

  for (const [indexName, tableName, columnName] of trigramIndexes) {
    try {
      await runSql(
        `CREATE INDEX IF NOT EXISTS "${indexName}" ON ${tableName} USING gin (LOWER("${columnName}") gin_trgm_ops);`,
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`  ! skipping ${indexName}`, error instanceof Error ? error.message : error);
    }
  }
};

const backfillUserPermissions = async (): Promise<void> => {
  logStep("Backfilling user permissions");

  const overwrite = hasFlag("--overwrite-permissions");
  const users = await User.findAll();

  for (const rawUser of users) {
    const user = rawUser as Record<string, unknown> & { save: () => Promise<void> };
    const plainUser = toPlainRecord(user);
    const userType = toText(plainUser.userType);
    const roleName = toText(plainUser.roleName);
    const nextPermissions = overwrite
      ? normalizePermissions(getPermissionTemplateForUserType(userType, roleName), userType, roleName)
      : normalizePermissions(plainUser.permissions, userType, roleName);
    const currentPermissions = normalizePermissions(plainUser.permissions, "", "");

    if (JSON.stringify(currentPermissions) === JSON.stringify(nextPermissions)) {
      continue;
    }

    user.permissions = nextPermissions;
    await user.save();
  }
};

/**
 * Grants each user the permissions their role is supposed to have.
 *
 * The vendor template did not exist before — vendors were handed a hardcoded
 * three-key object (dashboard + notifications), so all 82 vendor rows carry an
 * explicit `false` for products/orders/finance. `normalizePermissions` honours
 * stored keys over the template, so fixing the template alone cannot reach
 * them; the stored maps have to be repaired.
 *
 * This only ever turns permissions ON. A permission an administrator switched
 * off deliberately for one user stays off unless the role template grants it,
 * and nothing outside the template is touched.
 */
const repairRolePermissions = async (): Promise<void> => {
  logStep("Repairing role permissions");

  const users = await User.findAll();
  let repairedUsers = 0;

  for (const rawUser of users) {
    const user = rawUser as Record<string, unknown> & { save: () => Promise<void> };
    const plainUser = toPlainRecord(user);
    const userType = toText(plainUser.userType);
    const roleName = toText(plainUser.roleName);

    const template = getPermissionTemplateForUserType(userType, roleName);
    const currentPermissions = normalizePermissions(plainUser.permissions, userType, roleName);
    const nextPermissions = { ...currentPermissions };

    /* Vendors are external users whose capability set is fixed by the business,
       so their map is forced to match the template exactly — anything outside it
       (finance reports, tickets) is revoked, not merely left alone.
       Internal roles are grant-only: a permission an administrator switched off
       deliberately stays off. */
    const isVendor = userType === VENDOR_USER_TYPE;

    let changed = false;
    for (const [permissionKey, isGranted] of Object.entries(template)) {
      if (isGranted && nextPermissions[permissionKey] !== true) {
        nextPermissions[permissionKey] = true;
        changed = true;
      }
    }

    if (isVendor) {
      for (const permissionKey of Object.keys(nextPermissions)) {
        if (template[permissionKey] !== true && nextPermissions[permissionKey] !== false) {
          nextPermissions[permissionKey] = false;
          changed = true;
        }
      }
    }

    if (!changed) {
      continue;
    }

    user.permissions = nextPermissions;
    await user.save();
    repairedUsers += 1;
  }

  // eslint-disable-next-line no-console
  console.log(`  repaired ${repairedUsers} of ${users.length} users`);
};

const FINES_UPDATE_CHUNK_SIZE = 900;

/** `--fines-limit=N` caps the recalculation to the newest N eligible orders. */
const getFinesLimit = (): number | null => {
  const flag = process.argv.find((argument) => argument.startsWith("--fines-limit="));
  const parsed = flag ? Number(flag.split("=")[1]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};

/**
 * Recalculates only the orders a fine can actually apply to.
 *
 * `calculateOrderFine` returns 0 unless the order is past its delivery window,
 * so scanning every open order was wasted work — and an arbitrary date window
 * would be worse still, because it silently skips old orders that are overdue.
 *
 * An order is worth touching when it is either already carrying a fine (the
 * value may need updating or clearing) or is genuinely overdue. Overdue mirrors
 * calculateExceededDays: the vendor's delivery window is used when it exists,
 * otherwise the expected delivery date.
 */
/**
 * Recomputes "toBeCollected" from the order's own financials.
 *
 * Orders imported before this deploy were stored with a collection amount of 0
 * even for cash-on-delivery, so the order page showed «المبلغ المطلوب تحصيله 0»
 * against a real sale value. The formula is the same one the API applies on every
 * edit (normalizeOrderMutationPayload), so running this simply brings historical
 * rows in line with what an edit would have produced.
 *
 * Restricted to orders still in flight — قيد التصنيع (2) and في المخزن (8).
 * A delivered, cancelled or refunded order's collection amount is a historical
 * record of what was actually collected and must not be rewritten.
 *
 * Pure SQL and idempotent: only rows that actually disagree are touched, and
 * "updatedAt" is left alone because this is a correction, not an order event.
 */
const COLLECTION_RECALC_STATUSES = [2, 8] as const;

const recalculateOrderCollectionAmounts = async (): Promise<void> => {
  logStep("Recalculating order collection amounts (in progress / in inventory)");

  const [rows] = await sequelize.query(`
    UPDATE orders
    SET "toBeCollected" = COALESCE("subTotalPrice", 0)
                        + COALESCE("shippingFees", 0)
                        - COALESCE("totalDiscounts", 0)
                        - COALESCE("downPayment", 0)
    WHERE "deletedAt" IS NULL
      AND status IN (${COLLECTION_RECALC_STATUSES.join(", ")})
      AND "toBeCollected" IS DISTINCT FROM (
            COALESCE("subTotalPrice", 0)
          + COALESCE("shippingFees", 0)
          - COALESCE("totalDiscounts", 0)
          - COALESCE("downPayment", 0)
          )
    RETURNING id
  `);

  // eslint-disable-next-line no-console
  console.log(`  corrected ${(rows as unknown[]).length} order(s)`);
};

const recalculateOrderFines = async (): Promise<void> => {
  const finesLimit = getFinesLimit();
  logStep(
    finesLimit === null
      ? "Recalculating order fines (overdue or already fined)"
      : `Recalculating order fines (newest ${finesLimit} overdue or already fined)`,
  );

  // DISTINCT ON collapses the order-line join in the database instead of
  // shipping one row per line and de-duplicating in JS.
  const rows = await sequelize.query<{
    id: number;
    fine: string | number | null;
    orderDate: string | null;
    expectedDeliveryDate: string | null;
    subTotalPrice: string | number | null;
    daysToDeliver: number | null;
  }>(`
    select * from (
    select distinct on (o.id)
      o.id,
      o.fine,
      o."orderDate",
      o."expectedDeliveryDate",
      o."subTotalPrice",
      v."daysToDeliver"
    from orders o
    left join "orderLines" ol on ol."orderId" = o.id
    left join products p on p.id = ol."productId"
    left join vendors v on v.id = p."vendorId"
    where o.status not in (:finalStatuses)
      and o."deletedAt" is null
      and (
        coalesce(o.fine, 0) <> 0
        or (
          o."expectedDeliveryDate" is not null
          and o."expectedDeliveryDate" < now()
        )
        or (
          o."expectedDeliveryDate" is null
          and coalesce(v."daysToDeliver", 0) > 0
          and o."orderDate" is not null
          and o."orderDate" + (v."daysToDeliver" * interval '1 day') < now()
        )
      )
    order by o.id asc, ol.id asc
    ) eligible
    order by eligible."orderDate" desc nulls last, eligible.id desc
    ${finesLimit === null ? "" : `limit ${finesLimit}`}
  `, {
    replacements: { finalStatuses: FINAL_FINE_STATUSES },
    type: QueryTypes.SELECT,
  });

  // eslint-disable-next-line no-console
  console.log(`  ${rows.length} orders are overdue or already fined`);

  const pendingIds: number[] = [];
  const pendingFines: number[] = [];

  for (const row of rows) {
    const nextFine = calculateOrderFine({
      baseAmount: row.subTotalPrice,
      daysToDeliver: row.daysToDeliver,
      expectedDeliveryDate: row.expectedDeliveryDate,
      orderDate: row.orderDate,
    });

    if (normalizeNumber(row.fine) === nextFine) {
      continue;
    }

    pendingIds.push(row.id);
    pendingFines.push(nextFine);
  }

  if (pendingIds.length === 0) {
    // eslint-disable-next-line no-console
    console.log("  no fines needed updating");
    return;
  }

  /* Batched: the previous version issued one UPDATE per order and awaited each
     round trip, which took minutes against a remote database. */
  for (let offset = 0; offset < pendingIds.length; offset += FINES_UPDATE_CHUNK_SIZE) {
    const ids = pendingIds.slice(offset, offset + FINES_UPDATE_CHUNK_SIZE);
    const fines = pendingFines.slice(offset, offset + FINES_UPDATE_CHUNK_SIZE);

    await sequelize.query(
      `
        update orders as o
        set fine = data.fine, "updatedAt" = now()
        from (
          select unnest(array[:ids]::int[]) as id,
                 unnest(array[:fines]::numeric[]) as fine
        ) as data
        where o.id = data.id
      `,
      { replacements: { fines, ids } },
    );

    // eslint-disable-next-line no-console
    console.log(`  updated ${Math.min(offset + ids.length, pendingIds.length)}/${pendingIds.length} fines`);
  }
};

const backfillDashboardAggregates = async (): Promise<void> => {
  if (hasFlag("--skip-dashboard-backfill")) {
    return;
  }

  logStep("Backfilling dashboard aggregates");
  const dashboardRepository = new DashboardRepository();
  const dashboardAggregateService = new DashboardAggregateService(dashboardRepository);
  await dashboardAggregateService.backfill();
};

const backfillHistoricalManualOrderData = async (): Promise<void> => {
  logStep("Backfilling historical manual-order customer addresses and product codes");
  const result = await backfillManualOrderData();
  // eslint-disable-next-line no-console
  console.log(`  updated ${result.orderLineSkusUpdated} order-line SKUs`);
  // eslint-disable-next-line no-console
  console.log(`  updated ${result.customerAddressesUpdated} customer addresses`);
};

const main = async (): Promise<void> => {
  printBranchDiffSummary();
  await connectToDb();

  await ensureCoreColumns();
  await classifyCatalogProducts();
  await ensureShipmentTables();
  await ensureDashboardTables();
  await ensureTicketTable();
  await ensureManagedOptions();
  await ensureCronRunTable();
  await normalizeShipmentData();
  await ensureConstraints();
  await ensureIndexes();
  await backfillUserPermissions();
  await repairRolePermissions();
  await backfillHistoricalManualOrderData();
  // await recalculateOrderCollectionAmounts();
  await recalculateOrderFines();
  await backfillDashboardAggregates();

  // eslint-disable-next-line no-console
  console.log("\nRefactor deploy migration completed successfully");
};

void main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Refactor deploy migration failed");
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => undefined);
  });
