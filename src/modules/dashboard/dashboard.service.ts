import type { Result } from "../../shared/result";
import { success } from "../../shared/result";
import type {
  DashboardActivityItem,
  DashboardCardsPayload,
  DashboardCardResponse,
  DashboardCardKey,
  DashboardGoalProgressItem,
  DashboardLatestOrderItem,
  DashboardLeaderboardEntry,
  DashboardListPayload,
  DashboardMetricSnapshot,
  DashboardMetricsInput,
  DashboardPerformancePayload,
  DashboardQuickActionItem,
  DashboardRole,
  DashboardSalesDistributionItem,
  DateRangeInput,
  FinanceAdjustmentItem,
  FinanceAutomaticMetrics,
  FinanceDashboardPayload,
  FinanceOpexItem,
} from "./dashboard.types";
import { GOAL_CONFIGS, OTHER_DISTRIBUTION_ITEM, QUICK_ACTIONS } from "./dashboard.constants";
import {
  buildCard,
  collapseDistribution,
  normalizeDateRange,
  getPreviousRange,
  getRole,
  mergeGoalConfig,
} from "./dashboard.helpers";
import { DashboardRepository } from "./dashboard.repo";

type AuthenticatedDashboardUser = {
  userType?: string;
};

export class DashboardService {
  public constructor(private readonly dashboardRepository: DashboardRepository) {}

  public async getCards(
    range: DateRangeInput,
    user: AuthenticatedDashboardUser,
    vendorId?: number | null,
  ): Promise<Result<DashboardCardsPayload>> {
    const role = getRole(user, vendorId);
    const normalizedRange = normalizeDateRange(range);
    const currentInput = this.buildMetricsInput(normalizedRange, role, vendorId);
    const previousInput = this.buildMetricsInput(getPreviousRange(normalizedRange), role, vendorId);
    const [currentSnapshot, previousSnapshot] = await Promise.all([
      this.dashboardRepository.getSnapshot(currentInput),
      this.dashboardRepository.getSnapshot(previousInput),
    ]);

    return success({
      cards: this.buildCardsForRole(role, currentSnapshot, previousSnapshot),
      endDate: normalizedRange.endDate,
      role,
      startDate: normalizedRange.startDate,
    });
  }

  public async getFinance(month: string): Promise<Result<FinanceDashboardPayload>> {
    const { endDate, startDate } = this.getMonthRange(month);
    const [automatic, opex, adjustments] = await Promise.all([
      this.dashboardRepository.getFinanceAutomaticMetrics(startDate, endDate),
      this.dashboardRepository.getFinanceOpex(month),
      this.dashboardRepository.getFinanceAdjustments(month),
    ]);

    return success(this.buildFinancePayload(month, automatic, opex, adjustments));
  }

  public async saveFinanceOpex(
    month: string,
    items: Array<{ amount: number; label: string }>,
  ): Promise<Result<FinanceDashboardPayload>> {
    await this.dashboardRepository.replaceFinanceOpex(month, items);
    return this.getFinance(month);
  }

  public async saveFinanceAdjustments(
    month: string,
    items: Array<{ amount: number; label: string; type: "negative" | "positive" }>,
  ): Promise<Result<FinanceDashboardPayload>> {
    await this.dashboardRepository.replaceFinanceAdjustments(month, items);
    return this.getFinance(month);
  }

  public async getSingleCard(
    key: DashboardCardKey,
    range: DateRangeInput,
    user: AuthenticatedDashboardUser,
    vendorId?: number | null,
  ): Promise<Result<DashboardCardResponse>> {
    const cardsResult = await this.getCards(range, user, vendorId);
    if (!cardsResult.ok) {
      return cardsResult;
    }

    const card = cardsResult.data.cards.find((item) => item.key === key);

    return success(card!);
  }

  public async getPerformance(
    range: DateRangeInput,
    user: AuthenticatedDashboardUser,
    vendorId?: number | null,
  ): Promise<Result<DashboardPerformancePayload>> {
    const role = getRole(user, vendorId);
    const normalizedRange = normalizeDateRange(range);
    const currentInput = this.buildMetricsInput(normalizedRange, role, vendorId);
    const [summaryResult, series] = await Promise.all([
      this.getSingleCard("totalSales", normalizedRange, user, vendorId),
      this.dashboardRepository.getPerformanceSeries(currentInput),
    ]);

    if (!summaryResult.ok) {
      return summaryResult;
    }

    return success({
      endDate: normalizedRange.endDate,
      role,
      series,
      startDate: normalizedRange.startDate,
      summary: summaryResult.data,
    });
  }

  public async getActivities(
    range: DateRangeInput,
    user: AuthenticatedDashboardUser & { id?: number },
    vendorId?: number | null,
  ): Promise<Result<DashboardListPayload<DashboardActivityItem>>> {
    const role = getRole(user, vendorId);
    const normalizedRange = normalizeDateRange(range);
    const items = await this.dashboardRepository.getActivities(
      this.buildMetricsInput(normalizedRange, role, vendorId),
      user.id ?? 0,
    );

    return success({ items, role });
  }

  public async getLatestOrders(
    range: DateRangeInput,
    user: AuthenticatedDashboardUser,
    vendorId?: number | null,
  ): Promise<Result<DashboardListPayload<DashboardLatestOrderItem>>> {
    const role = getRole(user, vendorId);
    const normalizedRange = normalizeDateRange(range);
    const items = await this.dashboardRepository.getLatestOrders(
      this.buildMetricsInput(normalizedRange, role, vendorId),
    );

    return success({ items, role });
  }

  public async getLeaderboard(
    range: DateRangeInput,
    user: AuthenticatedDashboardUser,
    vendorId?: number | null,
  ): Promise<Result<DashboardListPayload<DashboardLeaderboardEntry>>> {
    const role = getRole(user, vendorId);
    const normalizedRange = normalizeDateRange(range);
    const items = await this.dashboardRepository.getLeaderboard(
      this.buildMetricsInput(normalizedRange, role, vendorId),
    );

    return success({ items, role });
  }

  public async getQuickActions(
    user: AuthenticatedDashboardUser,
    vendorId?: number | null,
  ): Promise<Result<DashboardListPayload<DashboardQuickActionItem>>> {
    const role = getRole(user, vendorId);
    return success({ items: QUICK_ACTIONS[role], role });
  }

  public async getSalesDistribution(
    range: DateRangeInput,
    user: AuthenticatedDashboardUser,
    vendorId?: number | null,
  ): Promise<Result<DashboardListPayload<DashboardSalesDistributionItem>>> {
    const role = getRole(user, vendorId);
    const normalizedRange = normalizeDateRange(range);
    const items = await this.dashboardRepository.getSalesDistribution(
      this.buildMetricsInput(normalizedRange, role, vendorId),
    );

    return success({
      items: collapseDistribution(items, OTHER_DISTRIBUTION_ITEM),
      role,
    });
  }

  public async getGoalsProgress(
    range: DateRangeInput,
    user: AuthenticatedDashboardUser,
    vendorId?: number | null,
  ): Promise<Result<DashboardListPayload<DashboardGoalProgressItem>>> {
    const role = getRole(user, vendorId);
    const metricsInput = this.buildMetricsInput(normalizeDateRange(range), role, vendorId);
    const [snapshot, deliveredOrders] = await Promise.all([
      this.dashboardRepository.getSnapshot(metricsInput),
      this.dashboardRepository.getDeliveredOrdersCount(metricsInput),
    ]);

    const values = role === "admin"
      ? [snapshot.totalSales, snapshot.totalOrders, snapshot.activeMakers, deliveredOrders]
      : [snapshot.totalSales, snapshot.totalOrders, snapshot.activeProducts, deliveredOrders];

    return success({
      items: GOAL_CONFIGS[role].map((goal, index) => mergeGoalConfig(goal, values[index] ?? 0)),
      role,
    });
  }

  private buildCardsForRole(
    role: DashboardRole,
    currentSnapshot: DashboardMetricSnapshot,
    previousSnapshot: DashboardMetricSnapshot,
  ): DashboardCardResponse[] {
    const baseCards = [
      buildCard("totalSales", currentSnapshot.totalSales, previousSnapshot.totalSales),
      buildCard("totalOrders", currentSnapshot.totalOrders, previousSnapshot.totalOrders),
      buildCard("pendingOrders", currentSnapshot.pendingOrders, previousSnapshot.pendingOrders),
    ];

    if (role === "vendor") {
      return [
        ...baseCards,
        buildCard(
          "activeProducts",
          currentSnapshot.activeProducts,
          previousSnapshot.activeProducts,
        ),
      ];
    }

    return [
      ...baseCards,
      buildCard("activeMakers", currentSnapshot.activeMakers, previousSnapshot.activeMakers),
    ];
  }

  private getMonthRange(month: string): DateRangeInput {
    const [year, monthNumber] = month.split("-").map(Number);
    const start = new Date(Date.UTC(year!, monthNumber! - 1, 1));
    const end = new Date(Date.UTC(year!, monthNumber!, 1) - 1);
    return { endDate: end.toISOString(), startDate: start.toISOString() };
  }

  private buildFinancePayload(
    month: string,
    automatic: FinanceAutomaticMetrics,
    opex: FinanceOpexItem[],
    adjustments: FinanceAdjustmentItem[],
  ): FinanceDashboardPayload {
    const round = (value: number): number => Math.round(value * 100) / 100;
    const ratio = (value: number, base: number): number => base === 0 ? 0 : round((value / base) * 100);
    const positiveAdjustments = adjustments
      .filter((item) => item.type === "positive")
      .reduce((sum, item) => sum + item.amount, 0);
    const negativeAdjustments = adjustments
      .filter((item) => item.type === "negative")
      .reduce((sum, item) => sum + item.amount, 0);
    const automaticGmv = automatic.gmvOnline + automatic.gmvShowroom;
    const gmv = automaticGmv + positiveAdjustments;
    const nmv = gmv - automatic.cancellations - automatic.discounts - negativeAdjustments;
    const g2n = automatic.deliveredHomix + automatic.deliveredVendor;
    const grossMargin = nmv - automatic.cogsNmv;
    const totalOpex = opex.reduce((sum, item) => sum + item.amount, 0);
    const ebitda = grossMargin - totalOpex;

    return {
      ...automatic,
      adjustments,
      cancellationRate: ratio(automatic.cancellations, gmv),
      cogsG2nRate: ratio(automatic.cogsG2n, g2n),
      cogsGmvRate: ratio(automatic.cogsGmv, gmv),
      cogsNmvRate: ratio(automatic.cogsNmv, nmv),
      deliveredHomixRate: ratio(automatic.deliveredHomix, g2n),
      deliveredVendorRate: ratio(automatic.deliveredVendor, g2n),
      discountRate: ratio(automatic.discounts, gmv),
      ebitda: round(ebitda),
      ebitdaRate: ratio(ebitda, nmv),
      g2n: round(g2n),
      g2nRate: ratio(g2n, nmv),
      gmv: round(gmv),
      grossMargin: round(grossMargin),
      grossMarginRate: ratio(grossMargin, nmv),
      month,
      nmv: round(nmv),
      nmvRate: ratio(nmv, gmv),
      onlineRate: ratio(automatic.gmvOnline, automaticGmv),
      opex,
      opexRate: ratio(totalOpex, nmv),
      showroomRate: ratio(automatic.gmvShowroom, automaticGmv),
      totalOpex: round(totalOpex),
    };
  }

  private buildMetricsInput(
    range: DateRangeInput,
    role: DashboardRole,
    vendorId?: number | null,
  ): DashboardMetricsInput {
    return {
      endDate: range.endDate,
      role,
      startDate: range.startDate,
      vendorId: vendorId ?? undefined,
    };
  }
}
