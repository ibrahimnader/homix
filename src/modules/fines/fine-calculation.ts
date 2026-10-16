export type FineRule = {
  id: number;
  trigger: "delivery_delay" | "late_cancellation" | "customer_refusal" | "manual";
  amountType: "fixed" | "percent";
  amount: number;
  frequency: "once" | "daily";
  basis: "subtotal" | "total" | "commission" | "cost";
  graceHours: number;
  maxAmount: number | null;
  effectiveFrom: string;
  active: boolean;
};

export type FineOrder = {
  status: number;
  shipmentStatus?: number | null;
  updatedAt?: Date | string | null;
  orderDate: Date | string | null;
  expectedDeliveryDate: Date | string | null;
  deliveryDate: Date | string | null;
  shippingReceiveDate?: Date | string | null;
  subTotalPrice: number;
  totalPrice: number;
  commission: number;
  totalCost: number;
};

const safe = (value: unknown) => Math.max(0, Number(value) || 0);

export function calculateFineForRule(rule: FineRule, order: FineOrder, now = new Date()): number {
  if (!rule.active || new Date(rule.effectiveFrom).getTime() > now.getTime()) return 0;
  if (rule.trigger === "manual") return 0;
  if (rule.trigger === "late_cancellation" && Number(order.status) !== 4) return 0;
  if (rule.trigger === "customer_refusal" && Number(order.shipmentStatus) !== 6) return 0;
  const due = order.expectedDeliveryDate && new Date(order.expectedDeliveryDate);
  if (!due || !Number.isFinite(due.getTime())) return 0;
  const finalEvent = rule.trigger !== "delivery_delay" || [4, 5, 6, 7, 8].includes(Number(order.status));
  const completedAt = Number(order.status) === 8 ? order.shippingReceiveDate : order.deliveryDate;
  const end = completedAt ? new Date(completedAt) : finalEvent && order.updatedAt ? new Date(order.updatedAt) : now;
  const chargeStart = Math.max(due.getTime() + safe(rule.graceHours) * 3_600_000, new Date(rule.effectiveFrom).getTime());
  const elapsedHours = (end.getTime() - chargeStart) / 3_600_000;
  if (elapsedHours <= 0) return 0;
  if (rule.trigger === "delivery_delay" && [4, 6, 7].includes(Number(order.status))) return 0;
  const base = { subtotal: order.subTotalPrice, total: order.totalPrice, commission: order.commission, cost: order.totalCost }[rule.basis];
  const unit = rule.amountType === "percent" ? safe(base) * safe(rule.amount) / 100 : safe(rule.amount);
  const multiplier = rule.frequency === "daily" ? Math.ceil(elapsedHours / 24) : 1;
  const value = unit * multiplier;
  return Math.round(Math.min(value, rule.maxAmount == null ? Infinity : safe(rule.maxAmount)) * 100) / 100;
}
