/**
 * Coordinates dashboard aggregate refreshes (dashboardDailyMetrics / ProductSales / CategorySales).
 *
 * Live profiling showed the upserts taking 2-5 s each, several at once, one `idle in transaction`: every order or
 * shipment mutation rebuilt its date range immediately, from several DashboardAggregateService instances that did
 * not know about each other. This coordinator is shared by the whole process and, per calendar month (the same unit
 * as the PostgreSQL advisory lock):
 *
 *  - single-flight: at most one refresh of a month runs at a time; requests that arrive meanwhile are merged into
 *    one follow-up run covering their combined date range;
 *  - throttled: a month is not recomputed more often than `minIntervalMs` (60 s) unless the caller forces it. A
 *    throttled request is never dropped, it runs once, trailing, when the interval has passed.
 *
 * Deferred runs live in this process only; a restart loses them. The aggregates self-heal on the next mutation
 * of that month, and the dashboard falls back to live order queries when daily rows are missing.
 */

export const DASHBOARD_REFRESH_MIN_INTERVAL_MS = 60_000;

export type RefreshChunk = {
  /** Calendar month, YYYYMM (matches the advisory-lock key). */
  endDate: string;
  key: number;
  startDate: string;
};

type MonthState = {
  forcePending: boolean;
  lastRunAt: number | null;
  pending: { endDate: string; startDate: string } | null;
  running: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
};

export type RefreshRunner = (range: { endDate: string; startDate: string }) => Promise<void>;

type CoordinatorOptions = {
  minIntervalMs?: number;
  now?: () => number;
  onDeferredError?: (error: unknown, chunk: RefreshChunk) => void;
  runner: RefreshRunner;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
};

const pad = (value: number): string => String(value).padStart(2, "0");

/** Splits an inclusive YYYY-MM-DD range into one chunk per calendar month. */
export const splitIntoMonthChunks = (startDate: string, endDate: string): RefreshChunk[] => {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const chunks: RefreshChunk[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();

  while (Date.UTC(year, month, 1) <= end.getTime()) {
    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd = new Date(Date.UTC(year, month + 1, 0));
    const from = monthStart > start ? monthStart : start;
    const to = monthEnd < end ? monthEnd : end;
    chunks.push({
      endDate: to.toISOString().slice(0, 10),
      key: year * 100 + month + 1,
      startDate: from.toISOString().slice(0, 10),
    });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return chunks;
};

export class DashboardRefreshCoordinator {
  private readonly states = new Map<number, MonthState>();
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<CoordinatorOptions["setTimer"]>;

  public constructor(private readonly options: CoordinatorOptions) {
    this.minIntervalMs = options.minIntervalMs ?? DASHBOARD_REFRESH_MIN_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      timer.unref?.();
      return timer;
    });
  }

  /**
   * Requests a refresh of an inclusive YYYY-MM-DD range. Resolves when the work this call started has finished
   * (rejects with its error). A throttled or merged request resolves immediately: its run happens later.
   */
  public async request(startDate: string, endDate: string, force = false): Promise<void> {
    const chunks = splitIntoMonthChunks(startDate, endDate);
    const waits = chunks.map((chunk) => this.requestChunk(chunk, force));
    await Promise.all(waits);
  }

  private getState(key: number): MonthState {
    let state = this.states.get(key);
    if (!state) {
      state = { forcePending: false, lastRunAt: null, pending: null, running: null, timer: null };
      this.states.set(key, state);
    }
    return state;
  }

  private requestChunk(chunk: RefreshChunk, force: boolean): Promise<void> {
    const state = this.getState(chunk.key);
    state.pending = state.pending
      ? {
          endDate: state.pending.endDate > chunk.endDate ? state.pending.endDate : chunk.endDate,
          startDate: state.pending.startDate < chunk.startDate ? state.pending.startDate : chunk.startDate,
        }
      : { endDate: chunk.endDate, startDate: chunk.startDate };
    state.forcePending = state.forcePending || force;

    /* A run is in flight: the merged range is picked up when it finishes. A forced caller waits for it. */
    if (state.running) {
      return force ? this.waitForIdle(state) : Promise.resolve();
    }

    const due = state.forcePending
      || state.lastRunAt === null
      || this.now() - state.lastRunAt >= this.minIntervalMs;
    if (due) {
      return this.run(chunk.key, state);
    }

    this.armTimer(chunk.key, state);
    return Promise.resolve();
  }

  /** Resolves once no run is in flight, following the forced follow-up run that merged requests trigger. */
  private async waitForIdle(state: MonthState): Promise<void> {
    while (state.running) {
      await state.running.catch(() => undefined);
    }
  }

  private armTimer(key: number, state: MonthState): void {
    if (state.timer) {
      return;
    }
    const delay = Math.max(0, this.minIntervalMs - (this.now() - (state.lastRunAt ?? 0)));
    state.timer = this.setTimer(() => {
      state.timer = null;
      if (state.pending && !state.running) {
        void this.run(key, state).catch((error: unknown) => this.reportDeferred(error, key, state));
      }
    }, delay);
  }

  private reportDeferred(error: unknown, key: number, state: MonthState): void {
    const range = state.pending ?? { endDate: "", startDate: "" };
    this.options.onDeferredError?.(error, { ...range, key });
  }

  private run(key: number, state: MonthState): Promise<void> {
    const range = state.pending;
    if (!range) {
      return Promise.resolve();
    }
    state.pending = null;
    state.forcePending = false;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    const running = this.options.runner(range).finally(() => {
      state.lastRunAt = this.now();
      state.running = null;
      /* Requests merged while this run was busy become the next run, throttled like any other. */
      if (state.pending) {
        if (state.forcePending) {
          void this.run(key, state).catch((error: unknown) => this.reportDeferred(error, key, state));
        } else {
          this.armTimer(key, state);
        }
      }
    });
    state.running = running;
    return running;
  }

  /** Test/shutdown helper: drops timers and state. */
  public reset(): void {
    for (const state of this.states.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    }
    this.states.clear();
  }
}
