/**
 * Performance indexes found by profiling the live database (pg_stat_statements / pg_stat_user_tables):
 *
 *  - notifications: the list query is `WHERE "userId" = $1 ORDER BY "createdAt" DESC` and the table had NO index
 *    on "userId" (only the primary key), so every bell refresh scanned ~850k rows. The mark-as-read UPDATE filters
 *    `"readAt" IS NULL` per user, hence the partial index.
 *  - notes: filtered by ("entityType", "entityId") on every order/shipment details load, no index at all.
 *  - vendors / productsTypes: looked up by name hundreds of thousands of times by the Shopify sync.
 *
 * Every index is built CONCURRENTLY (no table lock; reads and writes keep working) and IF NOT EXISTS, so the script is
 * idempotent. CREATE INDEX CONCURRENTLY cannot run inside a transaction, so each statement runs on its own.
 * A failed concurrent build leaves an INVALID index behind: the script detects and drops it, then rebuilds it.
 *
 * Run with: npm run db:performance-indexes            (applies)
 *           npm run db:performance-indexes -- --vacuum   (also VACUUM (ANALYZE) the affected tables)
 */
const { sequelize } = require("../src/infrastructure/database");

const INDEXES = [
  {
    name: "notifications_user_created_idx",
    table: "notifications",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_user_created_idx ON "notifications" ("userId", "createdAt" DESC)`,
  },
  {
    name: "notifications_user_unread_idx",
    table: "notifications",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_user_unread_idx ON "notifications" ("userId") WHERE "readAt" IS NULL`,
  },
  {
    name: "notes_entity_idx",
    table: "notes",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS notes_entity_idx ON "notes" ("entityType", "entityId") WHERE "deletedAt" IS NULL`,
  },
  {
    name: "vendors_name_idx",
    table: "vendors",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS vendors_name_idx ON "vendors" ("name") WHERE "deletedAt" IS NULL`,
  },
  {
    name: "products_types_name_idx",
    table: "productsTypes",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS products_types_name_idx ON "productsTypes" ("name") WHERE "deletedAt" IS NULL`,
  },
];

const VACUUM_TABLES = ["notifications", "notes", "products", "orders", "orderLines", "vendors", "productsTypes"];

const isInvalid = async (name) => {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = :name AND NOT i.indisvalid`,
    { replacements: { name } },
  );
  return rows.length > 0;
};

const run = async () => {
  await sequelize.authenticate();
  for (const index of INDEXES) {
    if (await isInvalid(index.name)) {
      console.log(`! ${index.name} is INVALID (an earlier build failed) — dropping and rebuilding`);
      await sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${index.name}"`);
    }
    const started = Date.now();
    await sequelize.query(index.sql);
    console.log(`+ ${index.name} on ${index.table} (${Date.now() - started} ms)`);
  }
  if (process.argv.includes("--vacuum")) {
    for (const table of VACUUM_TABLES) {
      const started = Date.now();
      await sequelize.query(`VACUUM (ANALYZE) "${table}"`);
      console.log(`+ VACUUM (ANALYZE) ${table} (${Date.now() - started} ms)`);
    }
  } else {
    for (const table of ["notifications", "notes", "vendors", "productsTypes"]) {
      await sequelize.query(`ANALYZE "${table}"`);
    }
    console.log("+ ANALYZE notifications, notes, vendors, productsTypes");
  }
  await sequelize.close();
};

run().catch((error) => {
  console.error("Performance indexes migration failed");
  console.error(error);
  process.exitCode = 1;
});
