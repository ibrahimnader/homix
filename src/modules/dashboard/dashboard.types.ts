export type DashboardRole = "admin" | "vendor";

export type DashboardCardKey =
  | "totalSales"
  | "totalOrders"
  | "pendingOrders"
  | "activeMakers"
  | "activeProducts";

export interface DateRangeInput {
  endDate: string;
  startDate: string;
}

export interface DashboardMetricsInput extends DateRangeInput {
  role: DashboardRole;
  vendorId?: number;
}

export interface DashboardMetricSnapshot {
  activeMakers: number;
  activeProducts: number;
  pendingOrders: number;
  totalOrders: number;
  totalSales: number;
}

export interface DashboardCardResponse {
  changePercentage: number;
  comparisonLabel: string;
  currentValue: number;
  key: DashboardCardKey;
  label: string;
  previousValue: number;
  trend: "down" | "flat" | "up";
}

export interface DashboardCardsPayload {
  cards: DashboardCardResponse[];
  endDate: string;
  role: DashboardRole;
  startDate: string;
}

export interface DashboardPerformancePoint {
  date: string;
  orders: number;
  sales: number;
}

export interface DashboardPerformancePayload {
  endDate: string;
  role: DashboardRole;
  series: DashboardPerformancePoint[];
  startDate: string;
  summary: DashboardCardResponse;
}

export interface DashboardActivityItem {
  createdAt: string;
  entityId: number;
  entityType: string;
  id: number;
  text: string;
}

export interface DashboardLatestOrderItem {
  amount: number;
  customerName: string;
  id: number;
  orderDate: string;
  orderNumber: string;
  productName: string;
  status: number | null;
  statusLabel: string;
}

export interface DashboardLeaderboardEntry {
  id: number | null;
  name: string;
  rank: number;
  secondaryLabel: string;
  totalSales: number;
}

export interface DashboardSalesDistributionItem {
  color: string;
  label: string;
  percentage: number;
  value: number;
}

export interface DashboardQuickActionItem {
  description: string;
  icon: string;
  key: string;
  label: string;
  route: string;
}

export interface DashboardGoalProgressItem {
  color: string;
  currentValue: number;
  key: string;
  label: string;
  progressPercentage: number;
  targetValue: number;
}

export interface DashboardListPayload<TItem> {
  items: TItem[];
  role: DashboardRole;
}

export interface FinanceOpexItem {
  amount: number;
  id?: number;
  label: string;
  sortOrder: number;
}

export interface FinanceAdjustmentItem {
  amount: number;
  id?: number;
  label: string;
  sortOrder: number;
  type: "negative" | "positive";
}

export interface FinanceAutomaticMetrics {
  cancellations: number;
  cogsG2n: number;
  cogsGmv: number;
  cogsNmv: number;
  deliveredHomix: number;
  deliveredVendor: number;
  discounts: number;
  gmvOnline: number;
  gmvShowroom: number;
}

export interface FinanceDashboardPayload extends FinanceAutomaticMetrics {
  adjustments: FinanceAdjustmentItem[];
  cancellationRate: number;
  cogsG2nRate: number;
  cogsGmvRate: number;
  cogsNmvRate: number;
  deliveredHomixRate: number;
  deliveredVendorRate: number;
  discountRate: number;
  ebitda: number;
  ebitdaRate: number;
  g2n: number;
  g2nRate: number;
  gmv: number;
  grossMargin: number;
  grossMarginRate: number;
  month: string;
  nmv: number;
  nmvRate: number;
  onlineRate: number;
  opex: FinanceOpexItem[];
  opexRate: number;
  showroomRate: number;
  totalOpex: number;
}
