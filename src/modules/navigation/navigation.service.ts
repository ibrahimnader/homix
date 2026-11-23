import type { NavigationCountsRepositoryContract, NavigationCounts } from "./navigation.types";

/**
 * Sidebar counters are cached per scope (global or vendor) for 60 s and computed single-flight: every request that
 * arrives while one is running shares its promise. The query costs ~15 ms but ran ~620k times (about 2.7 h of
 * database time) when every page navigation, window focus and socket event re-fetched it, so the cache is what
 * keeps the load flat. Mutations on /orders, /products and /factories still call invalidate() immediately.
 */
export const NAVIGATION_COUNTS_TTL_MS = 60_000;

export class NavigationCountsService {
  private readonly cache = new Map<string, { expiresAt: number; value: NavigationCounts }>();
  private readonly pending = new Map<string, Promise<NavigationCounts>>();
  private generation = 0;

  public constructor(private readonly repository: NavigationCountsRepositoryContract) {}

  public async getCounts(vendorId?: number | null): Promise<NavigationCounts> {
    const key = vendorId ? `vendor:${vendorId}` : "global";
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const running = this.pending.get(key);
    if (running) return running;

    const generation = this.generation;
    let request: Promise<NavigationCounts>;
    request = this.repository.getCounts(vendorId).then((counts) => {
      const value = { ...counts, updatedAt: new Date().toISOString() };
      if (generation === this.generation) {
        this.cache.set(key, { expiresAt: Date.now() + NAVIGATION_COUNTS_TTL_MS, value });
      }
      return value;
    }).finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  public invalidate(): void {
    this.generation += 1;
    this.cache.clear();
    this.pending.clear();
  }
}
