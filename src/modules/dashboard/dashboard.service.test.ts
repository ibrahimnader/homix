import { DashboardService } from "./dashboard.service";

describe("DashboardService", () => {
  const dateRange = {
    endDate: "2026-05-02T23:59:59.000Z",
    startDate: "2026-05-01T00:00:00.000Z",
  };

  it("builds finance totals from automatic aggregates and persisted OPEX", async () => {
    const repository = {
      getFinanceAutomaticMetrics: jest.fn().mockResolvedValue({
        cancellations: 100,
        cogsG2n: 300,
        cogsGmv: 700,
        cogsNmv: 500,
        deliveredHomix: 800,
        deliveredVendor: 200,
        discounts: 50,
        gmvOnline: 1500,
        gmvShowroom: 500,
      }),
      getFinanceOpex: jest.fn().mockResolvedValue([
        { amount: 100, id: 1, label: "Marketing", sortOrder: 0 },
        { amount: 50, id: 2, label: "Tools", sortOrder: 1 },
      ]),
      getFinanceAdjustments: jest.fn().mockResolvedValue([]),
    } as never;
    const service = new DashboardService(repository);

    const result = await service.getFinance("2026-05");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(expect.objectContaining({
        ebitda: 1200,
        g2n: 1000,
        gmv: 2000,
        grossMargin: 1350,
        nmv: 1850,
        totalOpex: 150,
      }));
    }
  });

  it("replaces a month's OPEX and returns recalculated finance data", async () => {
    const repository = {
      getFinanceAutomaticMetrics: jest.fn().mockResolvedValue({
        cancellations: 0, cogsG2n: 0, cogsGmv: 0, cogsNmv: 0,
        deliveredHomix: 0, deliveredVendor: 0, discounts: 0,
        gmvOnline: 0, gmvShowroom: 0,
      }),
      getFinanceOpex: jest.fn().mockResolvedValue([{ amount: 75, label: "Rent", sortOrder: 0 }]),
      getFinanceAdjustments: jest.fn().mockResolvedValue([]),
      replaceFinanceOpex: jest.fn().mockResolvedValue(undefined),
    } as never;
    const service = new DashboardService(repository);

    await service.saveFinanceOpex("2026-06", [{ amount: 75, label: "Rent" }]);

    expect((repository as unknown as { replaceFinanceOpex: jest.Mock }).replaceFinanceOpex)
      .toHaveBeenCalledWith("2026-06", [{ amount: 75, label: "Rent" }]);
  });

  it("applies saved positive and negative revenue adjustments and returns all rates", async () => {
    const repository = {
      getFinanceAutomaticMetrics: jest.fn().mockResolvedValue({
        cancellations: 100, cogsG2n: 200, cogsGmv: 600, cogsNmv: 450,
        deliveredHomix: 600, deliveredVendor: 400, discounts: 50,
        gmvOnline: 1200, gmvShowroom: 800,
      }),
      getFinanceOpex: jest.fn().mockResolvedValue([{ amount: 100, label: "Rent", sortOrder: 0 }]),
      getFinanceAdjustments: jest.fn().mockResolvedValue([
        { amount: 200, label: "Other revenue", sortOrder: 0, type: "positive" },
        { amount: 50, label: "Correction", sortOrder: 1, type: "negative" },
      ]),
    } as never;

    const result = await new DashboardService(repository).getFinance("2026-05");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.gmv).toBe(2200);
      expect(result.data.nmv).toBe(2000);
      expect(result.data.nmvRate).toBe(90.91);
      expect(result.data.cogsNmvRate).toBe(22.5);
      expect(result.data.ebitdaRate).toBe(72.5);
    }
  });

  it("returns chronological finance history ending at the requested month", async () => {
    const repository = {
      getFinanceAutomaticMetrics: jest.fn().mockResolvedValue({
        cancellations: 0, cogsG2n: 0, cogsGmv: 0, cogsNmv: 0,
        deliveredHomix: 0, deliveredVendor: 0, discounts: 0,
        gmvOnline: 100, gmvShowroom: 0,
      }),
      getFinanceAdjustments: jest.fn().mockResolvedValue([]),
      getFinanceOpex: jest.fn().mockResolvedValue([]),
    } as never;

    const result = await new DashboardService(repository).getFinanceHistory("2026-05", 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items.map((item) => item.month)).toEqual(["2026-03", "2026-04", "2026-05"]);
    }
  });

  it("returns admin cards with active makers", async () => {
    const dashboardRepository = {
      getSnapshot: jest
        .fn()
        .mockResolvedValueOnce({
          activeMakers: 5,
          activeProducts: 0,
          pendingOrders: 3,
          totalOrders: 10,
          totalSales: 1000,
        })
        .mockResolvedValueOnce({
          activeMakers: 4,
          activeProducts: 0,
          pendingOrders: 2,
          totalOrders: 8,
          totalSales: 800,
        }),
    } as never;
    const service = new DashboardService(dashboardRepository);

    const result = await service.getCards(dateRange, { userType: "1" }, null);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.cards).toHaveLength(4);
      expect(result.data.cards[3]?.key).toBe("activeMakers");
    }
  });

  it("returns vendor cards with active products", async () => {
    const dashboardRepository = {
      getSnapshot: jest
        .fn()
        .mockResolvedValueOnce({
          activeMakers: 0,
          activeProducts: 7,
          pendingOrders: 6,
          totalOrders: 12,
          totalSales: 1500,
        })
        .mockResolvedValueOnce({
          activeMakers: 0,
          activeProducts: 5,
          pendingOrders: 4,
          totalOrders: 9,
          totalSales: 1000,
        }),
    } as never;
    const service = new DashboardService(dashboardRepository);

    const result = await service.getCards(dateRange, { userType: "2" }, 17);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.role).toBe("vendor");
      expect(result.data.cards[3]?.key).toBe("activeProducts");
    }
  });

  it("returns performance series with sales summary", async () => {
    const dashboardRepository = {
      getPerformanceSeries: jest.fn().mockResolvedValue([{ date: "2026-05-01", orders: 3, sales: 900 }]),
      getSnapshot: jest
        .fn()
        .mockResolvedValueOnce({
          activeMakers: 5,
          activeProducts: 0,
          pendingOrders: 3,
          totalOrders: 10,
          totalSales: 1000,
        })
        .mockResolvedValueOnce({
          activeMakers: 4,
          activeProducts: 0,
          pendingOrders: 2,
          totalOrders: 8,
          totalSales: 800,
        }),
    } as never;
    const service = new DashboardService(dashboardRepository);

    const result = await service.getPerformance(dateRange, { userType: "1" }, null);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.series).toHaveLength(1);
      expect(result.data.summary.key).toBe("totalSales");
    }
  });

  it("returns quick actions for vendor users", async () => {
    const dashboardRepository = {} as never;
    const service = new DashboardService(dashboardRepository);

    const result = await service.getQuickActions({ userType: "2" }, 12);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.role).toBe("vendor");
      expect(result.data.items[0]?.key).toBe("add-product");
    }
  });

  it("returns goals progress using role-specific metrics", async () => {
    const dashboardRepository = {
      getDeliveredOrdersCount: jest.fn().mockResolvedValue(25),
      getSnapshot: jest.fn().mockResolvedValue({
        activeMakers: 8,
        activeProducts: 0,
        pendingOrders: 3,
        totalOrders: 120,
        totalSales: 200000,
      }),
    } as never;
    const service = new DashboardService(dashboardRepository);

    const result = await service.getGoalsProgress(dateRange, { userType: "1" }, null);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(4);
      expect(result.data.items[0]?.key).toBe("salesTarget");
      expect(result.data.items[3]?.currentValue).toBe(25);
    }
  });

  it("normalizes date-only ranges to inclusive day boundaries", async () => {
    const getSnapshot = jest
      .fn()
      .mockResolvedValueOnce({
        activeMakers: 5,
        activeProducts: 0,
        pendingOrders: 3,
        totalOrders: 10,
        totalSales: 1000,
      })
      .mockResolvedValueOnce({
        activeMakers: 4,
        activeProducts: 0,
        pendingOrders: 2,
        totalOrders: 8,
        totalSales: 800,
      });
    const dashboardRepository = {
      getSnapshot,
    } as never;
    const service = new DashboardService(dashboardRepository);

    await service.getCards(
      {
        endDate: "2026-05-01",
        startDate: "2026-05-01",
      },
      { userType: "1" },
      null,
    );

    expect(getSnapshot).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        endDate: "2026-05-01T23:59:59.999Z",
        startDate: "2026-05-01T00:00:00.000Z",
      }),
    );
    expect(getSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        endDate: "2026-04-30T23:59:59.999Z",
        startDate: "2026-04-30T00:00:00.000Z",
      }),
    );
  });
});
