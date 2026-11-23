import { DashboardRefreshCoordinator, splitIntoMonthChunks } from "./dashboard-aggregate-refresh";

type Timer = { callback: () => void; delay: number };

const createHarness = () => {
  let clock = 1_000_000;
  const timers: Timer[] = [];
  const deferred: Array<() => void> = [];
  const runner = jest.fn((_range: { endDate: string; startDate: string }) =>
    new Promise<void>((resolve) => { deferred.push(resolve); }));
  const coordinator = new DashboardRefreshCoordinator({
    minIntervalMs: 60_000,
    now: () => clock,
    runner,
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
  });
  return {
    advance: (ms: number) => { clock += ms; },
    coordinator,
    finishNext: async () => { deferred.shift()?.(); await Promise.resolve(); await Promise.resolve(); },
    runner,
    timers,
  };
};

describe("splitIntoMonthChunks", () => {
  it("splits an inclusive range per calendar month", () => {
    expect(splitIntoMonthChunks("2026-10-28", "2026-12-02")).toEqual([
      { endDate: "2026-10-31", key: 202610, startDate: "2026-10-28" },
      { endDate: "2026-11-30", key: 202611, startDate: "2026-11-01" },
      { endDate: "2026-12-02", key: 202612, startDate: "2026-12-01" },
    ]);
  });

  it("returns nothing for an invalid or inverted range", () => {
    expect(splitIntoMonthChunks("nope", "2026-01-01")).toEqual([]);
    expect(splitIntoMonthChunks("2026-02-01", "2026-01-01")).toEqual([]);
  });
});

describe("DashboardRefreshCoordinator", () => {
  it("runs the first request immediately", async () => {
    const h = createHarness();
    const done = h.coordinator.request("2026-11-03", "2026-11-05");
    expect(h.runner).toHaveBeenCalledWith({ endDate: "2026-11-05", startDate: "2026-11-03" });
    await h.finishNext();
    await done;
  });

  it("is single-flight per month and merges concurrent requests into one follow-up run", async () => {
    const h = createHarness();
    const first = h.coordinator.request("2026-11-10", "2026-11-10");
    void h.coordinator.request("2026-11-02", "2026-11-03");
    void h.coordinator.request("2026-11-20", "2026-11-21");
    expect(h.runner).toHaveBeenCalledTimes(1);

    await h.finishNext();
    await first;

    /* Merged range waits for the 60 s throttle, it is not run in parallel or dropped. */
    expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]?.delay).toBe(60_000);

    h.advance(60_000);
    h.timers[0]!.callback();
    expect(h.runner).toHaveBeenCalledTimes(2);
    expect(h.runner).toHaveBeenLastCalledWith({ endDate: "2026-11-21", startDate: "2026-11-02" });
    await h.finishNext();
  });

  it("does not recompute a month more often than every 60 s, but defers instead of dropping", async () => {
    const h = createHarness();
    const first = h.coordinator.request("2026-11-10", "2026-11-10");
    await h.finishNext();
    await first;

    h.advance(10_000);
    await h.coordinator.request("2026-11-11", "2026-11-11");
    expect(h.runner).toHaveBeenCalledTimes(1);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]?.delay).toBe(50_000);

    h.advance(50_000);
    h.timers[0]!.callback();
    expect(h.runner).toHaveBeenCalledTimes(2);
    expect(h.runner).toHaveBeenLastCalledWith({ endDate: "2026-11-11", startDate: "2026-11-11" });
    await h.finishNext();
  });

  it("recomputes immediately when forced, even inside the interval", async () => {
    const h = createHarness();
    const first = h.coordinator.request("2026-11-10", "2026-11-10");
    await h.finishNext();
    await first;

    h.advance(1_000);
    const forced = h.coordinator.request("2026-11-12", "2026-11-12", true);
    expect(h.runner).toHaveBeenCalledTimes(2);
    await h.finishNext();
    await forced;
  });

  it("keeps different months independent", async () => {
    const h = createHarness();
    void h.coordinator.request("2026-10-31", "2026-11-01");
    expect(h.runner).toHaveBeenCalledTimes(2);
    expect(h.runner).toHaveBeenCalledWith({ endDate: "2026-10-31", startDate: "2026-10-31" });
    expect(h.runner).toHaveBeenCalledWith({ endDate: "2026-11-01", startDate: "2026-11-01" });
    await h.finishNext();
    await h.finishNext();
  });

  it("propagates a failure to the caller that started the run and still allows the next run", async () => {
    let clock = 0;
    const runner = jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const coordinator = new DashboardRefreshCoordinator({
      minIntervalMs: 60_000,
      now: () => clock,
      runner,
      setTimer: jest.fn() as never,
    });

    await expect(coordinator.request("2026-11-10", "2026-11-10")).rejects.toThrow("boom");
    clock += 61_000;
    await expect(coordinator.request("2026-11-10", "2026-11-10")).resolves.toBeUndefined();
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
