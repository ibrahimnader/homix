import { parsePruneArgs, pruneReadNotifications } from "./prune-notifications";

const fixedNow = () => new Date("2026-11-23T00:00:00.000Z");

const createDatabase = (eligible: number, batchSize: number) => {
  let remaining = eligible;
  const statements: string[] = [];
  const query = jest.fn(async (sql: string, _options?: unknown) => {
    statements.push(sql);
    if (sql.includes("DELETE FROM")) {
      const removed = Math.min(batchSize, remaining);
      remaining -= removed;
      return [{ count: String(removed) }];
    }
    return [{ eligible: String(eligible), total: "851000", unreadOlder: "12" }];
  });
  return { query, statements };
};

describe("parsePruneArgs", () => {
  it("defaults to a 60 day dry-run", () => {
    expect(parsePruneArgs([])).toEqual({ apply: false, days: 60 });
  });

  it("reads --days and --apply", () => {
    expect(parsePruneArgs(["--days=90", "--apply"])).toEqual({ apply: true, days: 90 });
  });

  it("rejects a missing, non-numeric or too small retention", () => {
    expect(() => parsePruneArgs(["--days="])).toThrow();
    expect(() => parsePruneArgs(["--days=abc"])).toThrow();
    expect(() => parsePruneArgs(["--days=1"])).toThrow();
  });
});

describe("pruneReadNotifications", () => {
  it("dry-run only counts: it issues no DELETE and never sleeps", async () => {
    const db = createDatabase(12_000, 5_000);
    const sleep = jest.fn();

    const result = await pruneReadNotifications(db, { apply: false, days: 60, now: fixedNow, sleep });

    expect(db.statements.some((sql) => sql.includes("DELETE"))).toBe(false);
    expect(sleep).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      cutoff: "2026-09-24T00:00:00.000Z",
      deleted: 0,
      eligible: 12_000,
      mode: "dry-run",
      totalRows: 851_000,
      unreadOlderKept: 12,
    });
  });

  it("deletes in batches of 5,000 with a sleep between full batches and stops on a short one", async () => {
    const db = createDatabase(12_000, 5_000);
    const sleep = jest.fn().mockResolvedValue(undefined);

    const result = await pruneReadNotifications(db, { apply: true, days: 60, now: fixedNow, sleep, sleepMs: 10 });

    const deletes = db.query.mock.calls.filter(([sql]) => sql.includes("DELETE FROM"));
    expect(deletes).toHaveLength(3);
    expect((deletes[0]![1] as { replacements: { batchSize: number } }).replacements.batchSize).toBe(5_000);
    expect(result).toMatchObject({ batches: 3, deleted: 12_000, mode: "apply" });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("only ever targets read rows older than the cutoff", async () => {
    const db = createDatabase(10, 5_000);
    await pruneReadNotifications(db, { apply: true, days: 30, now: fixedNow, sleep: jest.fn() });

    const deleteCall = db.query.mock.calls.find(([sql]) => sql.includes("DELETE FROM"))!;
    expect(deleteCall[0]).toContain(`"readAt" IS NOT NULL`);
    expect(deleteCall[0]).toContain(`"createdAt" < :cutoff`);
    expect((deleteCall[1] as { replacements: { cutoff: Date } }).replacements.cutoff.toISOString())
      .toBe("2026-10-24T00:00:00.000Z");
  });

  it("does nothing when no row is eligible", async () => {
    const db = createDatabase(0, 5_000);
    const result = await pruneReadNotifications(db, { apply: true, days: 60, now: fixedNow, sleep: jest.fn() });
    expect(result).toMatchObject({ batches: 0, deleted: 0 });
  });
});
