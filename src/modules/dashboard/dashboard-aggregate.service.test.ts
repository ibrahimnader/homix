import { Op } from "sequelize";

const mockFinanceFindAll = jest.fn();
const mockQuery = jest.fn();

jest.mock("../../infrastructure/database", () => ({
  sequelize: { query: mockQuery, transaction: jest.fn() },
}));
jest.mock("./dashboard-daily-metric.model", () => ({}));
jest.mock("./dashboard-daily-product-sale.model", () => ({}));
jest.mock("./dashboard-daily-category-sale.model", () => ({}));
jest.mock("./finance-daily-metric.model", () => ({ findAll: mockFinanceFindAll }));
jest.mock("../../../app/modules/order/order.model", () => ({}));

import { DashboardAggregateService } from "./dashboard-aggregate.service";

describe("DashboardAggregateService finance reads", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFinanceFindAll.mockResolvedValue([{
      cancellations: 0,
      cogsG2n: 25,
      cogsGmv: 25,
      cogsNmv: 25,
      deliveredHomix: 100,
      deliveredVendor: 0,
      discounts: 0,
      gmvOnline: 100,
      gmvShowroom: 0,
      metricDate: "2026-08-01",
      orderCount: 1,
      sourceUpdatedAt: "2026-09-05T14:51:08.514Z",
    }]);
    mockQuery.mockResolvedValue([{
      orderCount: 1,
      sourceUpdatedAt: "2026-09-05T14:51:08.514Z",
    }]);
  });

  it("uses Sequelize Op.between and returns an existing fresh aggregate", async () => {
    const service = new DashboardAggregateService({
      getDeliveredOrdersCountFromOrders: jest.fn(),
      getSnapshotFromOrders: jest.fn(),
    });

    const result = await service.getFinanceMetrics(
      "2026-08-01T00:00:00.000Z",
      "2026-08-31T23:59:59.999Z",
    );

    expect(mockFinanceFindAll).toHaveBeenCalledWith({
      where: {
        metricDate: {
          [Op.between]: ["2026-08-01", "2026-08-31"],
        },
      },
    });
    expect(result?.gmvOnline).toBe(100);
  });
});
