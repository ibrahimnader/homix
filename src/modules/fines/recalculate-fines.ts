import { QueryTypes } from "sequelize";
import { sequelize } from "../../infrastructure/database";
import { calculateFineForRule, type FineOrder, type FineRule } from "./fine-calculation";

/** Rebuilds active rule charges. Waived records stay waived and are never reactivated. */
export async function recalculateRuleFines(): Promise<number> {
  const rules = await sequelize.query<FineRule>('SELECT * FROM fine_rules WHERE active = TRUE AND trigger <> \'manual\'', { type: QueryTypes.SELECT });
  const orders = await sequelize.query<FineOrder & { id: number }>(`
    SELECT id, status, "shipmentStatus", "orderDate", "expectedDeliveryDate", "deliveryDate", "shippingReceiveDate", "updatedAt",
      "subTotalPrice", "totalPrice", commission, "totalCost" FROM orders
    WHERE "deletedAt" IS NULL AND "expectedDeliveryDate" IS NOT NULL
  `, { type: QueryTypes.SELECT });
  let changed = 0;
  for (const order of orders) {
    const applicable = rules.map((rule) => ({ rule, amount: calculateFineForRule(rule, order) })).filter((item) => item.amount > 0);
    if (!applicable.length) continue;
    await sequelize.transaction(async (transaction) => {
      for (const { rule, amount } of applicable) {
        await sequelize.query(`
          INSERT INTO fine_records ("ruleId", "orderId", amount) VALUES (:ruleId, :orderId, :amount)
          ON CONFLICT ("ruleId", "orderId") DO UPDATE SET amount = EXCLUDED.amount
          WHERE fine_records."waivedAt" IS NULL
        `, { replacements: { ruleId: rule.id, orderId: order.id, amount }, transaction });
      }
      await sequelize.query(`UPDATE orders SET fine = (
        SELECT COALESCE(SUM(amount), 0) FROM fine_records WHERE "orderId" = :orderId AND "waivedAt" IS NULL
      ) WHERE id = :orderId`, { replacements: { orderId: order.id }, transaction });
    });
    changed += 1;
  }
  return changed;
}
