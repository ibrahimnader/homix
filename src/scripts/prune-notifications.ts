/**
 * Deletes OLD, ALREADY-READ notifications.
 *
 * WARNING: deletion is PERMANENT. There is no soft delete and no archive: rows removed with --apply cannot be
 * restored except from a database backup. Unread notifications are never touched, whatever their age.
 *
 * Why: the notifications table grew to ~850k rows (the bell used to load all of them on every refresh). Read
 * notifications older than a couple of months have no use, and keeping the table small keeps the user/unread
 * indexes small too.
 *
 * Safety:
 *  - dry-run by default: prints the counts and deletes nothing; pass `--apply` to delete;
 *  - only rows with "readAt" IS NOT NULL and "createdAt" older than --days (default 60) are eligible;
 *  - deletes in batches of 5,000 rows, each its own short statement, with a short sleep between batches so
 *    replication / autovacuum and the live API keep breathing;
 *  - NOT scheduled and NOT run automatically anywhere. A person runs it, on purpose.
 *
 *   npm run db:prune-notifications                          # dry-run, 60 days
 *   npm run db:prune-notifications -- --days=90             # dry-run, 90 days
 *   npm run db:prune-notifications -- --days=60 --apply     # PERMANENT deletion
 */
import { QueryTypes } from "sequelize";

export const PRUNE_BATCH_SIZE = 5_000;
export const PRUNE_SLEEP_MS = 250;
export const DEFAULT_RETENTION_DAYS = 60;
const MIN_RETENTION_DAYS = 7;

type QueryRunner = {
  query: (sql: string, options: Record<string, unknown>) => Promise<unknown>;
};

export type PruneOptions = {
  apply: boolean;
  batchSize?: number;
  days: number;
  log?: (message: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  sleepMs?: number;
};

export type PruneResult = {
  batches: number;
  cutoff: string;
  deleted: number;
  eligible: number;
  mode: "apply" | "dry-run";
  totalRows: number;
  unreadOlderKept: number;
};

type CountRow = { eligible: number | string; total: number | string; unreadOlder: number | string };
type DeleteRow = { count: number | string };

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const parsePruneArgs = (argv: string[]): { apply: boolean; days: number } => {
  const daysArg = argv.find((argument) => argument.startsWith("--days="));
  const days = daysArg === undefined ? DEFAULT_RETENTION_DAYS : Number(daysArg.slice("--days=".length));

  if (!Number.isInteger(days) || days < MIN_RETENTION_DAYS) {
    throw new Error(`--days must be a whole number of at least ${MIN_RETENTION_DAYS}`);
  }

  return { apply: argv.includes("--apply"), days };
};

export const pruneReadNotifications = async (
  database: QueryRunner,
  options: PruneOptions,
): Promise<PruneResult> => {
  const log = options.log ?? ((): void => undefined);
  const sleep = options.sleep ?? defaultSleep;
  const batchSize = options.batchSize ?? PRUNE_BATCH_SIZE;
  const sleepMs = options.sleepMs ?? PRUNE_SLEEP_MS;
  const now = (options.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - options.days * 24 * 60 * 60 * 1000);
  const replacements = { batchSize, cutoff };

  const [counts] = (await database.query(
    `SELECT
       count(*) AS total,
       count(*) FILTER (WHERE "readAt" IS NOT NULL AND "createdAt" < :cutoff) AS eligible,
       count(*) FILTER (WHERE "readAt" IS NULL AND "createdAt" < :cutoff) AS "unreadOlder"
     FROM "notifications"`,
    { replacements, type: QueryTypes.SELECT },
  )) as CountRow[];

  const result: PruneResult = {
    batches: 0,
    cutoff: cutoff.toISOString(),
    deleted: 0,
    eligible: Number(counts?.eligible ?? 0),
    mode: options.apply ? "apply" : "dry-run",
    totalRows: Number(counts?.total ?? 0),
    unreadOlderKept: Number(counts?.unreadOlder ?? 0),
  };

  log(
    `notifications: ${result.totalRows} rows, ${result.eligible} read and older than ${options.days} days `
    + `(before ${result.cutoff}), ${result.unreadOlderKept} older but unread (kept)`,
  );

  if (!options.apply) {
    log("dry-run: nothing deleted. Re-run with --apply to delete the eligible rows PERMANENTLY.");
    return result;
  }

  for (;;) {
    const [row] = (await database.query(
      `WITH doomed AS (
         SELECT id FROM "notifications"
          WHERE "readAt" IS NOT NULL AND "createdAt" < :cutoff
          ORDER BY id
          LIMIT :batchSize
       ), removed AS (
         DELETE FROM "notifications" WHERE id IN (SELECT id FROM doomed) RETURNING 1
       )
       SELECT count(*) AS count FROM removed`,
      { replacements, type: QueryTypes.SELECT },
    )) as DeleteRow[];
    const removedCount = Number(row?.count ?? 0);

    if (removedCount === 0) {
      break;
    }

    result.batches += 1;
    result.deleted += removedCount;
    log(`batch ${result.batches}: deleted ${removedCount} (total ${result.deleted})`);

    if (removedCount < batchSize) {
      break;
    }
    await sleep(sleepMs);
  }

  return result;
};

const run = async (): Promise<void> => {
  const { apply, days } = parsePruneArgs(process.argv.slice(2));
  const { sequelize } = await import("../infrastructure/database/sequelize");

  try {
    const result = await pruneReadNotifications(sequelize, {
      apply,
      days,
      // eslint-disable-next-line no-console
      log: (message) => console.log(message),
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await sequelize.close();
  }
};

if (require.main === module) {
  run().catch((error: Error) => {
    // eslint-disable-next-line no-console
    console.error(error.message);
    process.exitCode = 1;
  });
}
