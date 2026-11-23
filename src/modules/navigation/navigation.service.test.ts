import { NAVIGATION_COUNTS_TTL_MS, NavigationCountsService } from "./navigation.service";

describe("NavigationCountsService", () => {
  it("returns live repository counts with a refresh timestamp", async () => {
    const repository = {
      getCounts: jest.fn().mockResolvedValue({ factories: 3, orders: 72, products: 1_204 }),
    };
    const service = new NavigationCountsService(repository);

    const result = await service.getCounts(9);

    expect(repository.getCounts).toHaveBeenCalledWith(9);
    expect(result).toEqual(expect.objectContaining({ factories: 3, orders: 72, products: 1_204 }));
    expect(Number.isNaN(Date.parse(result.updatedAt))).toBe(false);
  });

  it("shares a short-lived result and can invalidate it after a mutation", async () => {
    const repository = {
      getCounts: jest.fn()
        .mockResolvedValueOnce({ factories: 3, orders: 72, products: 1_204 })
        .mockResolvedValueOnce({ factories: 4, orders: 73, products: 1_205 }),
    };
    const service = new NavigationCountsService(repository);

    expect((await service.getCounts()).orders).toBe(72);
    expect((await service.getCounts()).orders).toBe(72);
    expect(repository.getCounts).toHaveBeenCalledTimes(1);

    service.invalidate();
    expect((await service.getCounts()).orders).toBe(73);
    expect(repository.getCounts).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight query between concurrent requests of the same scope", async () => {
    let resolve!: (value: { factories: number; orders: number; products: number }) => void;
    const repository = {
      getCounts: jest.fn().mockImplementation(() => new Promise((done) => { resolve = done; })),
    };
    const service = new NavigationCountsService(repository);

    const calls = [service.getCounts(), service.getCounts(), service.getCounts()];
    resolve({ factories: 1, orders: 2, products: 3 });
    const results = await Promise.all(calls);

    expect(repository.getCounts).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.orders === 2)).toBe(true);
  });

  it("caches per scope for 60 s and then queries again", async () => {
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    const repository = { getCounts: jest.fn().mockResolvedValue({ factories: 1, orders: 2, products: 3 }) };
    const service = new NavigationCountsService(repository);

    await service.getCounts();
    await service.getCounts(5);
    await service.getCounts(5);
    expect(repository.getCounts).toHaveBeenCalledTimes(2);

    now.mockReturnValue(1_000_000 + NAVIGATION_COUNTS_TTL_MS - 1);
    await service.getCounts(5);
    expect(repository.getCounts).toHaveBeenCalledTimes(2);

    now.mockReturnValue(1_000_000 + NAVIGATION_COUNTS_TTL_MS + 1);
    await service.getCounts(5);
    expect(repository.getCounts).toHaveBeenCalledTimes(3);
    now.mockRestore();
  });
});
