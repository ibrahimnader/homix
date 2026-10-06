import { sequelize } from "./src/infrastructure/database";

(async () => {
  const [rows] = await sequelize.query(`
    UPDATE users
    SET permissions = jsonb_set(
      COALESCE(permissions, '{}'::json)::jsonb,
      '{ship_receipts_view}',
      'true'::jsonb,
      true
    )::json
    WHERE COALESCE(permissions->>'ship_inventory_view', 'false') = 'true'
      AND COALESCE(permissions->>'ship_receipts_view', 'false') <> 'true'
    RETURNING id
  `);
  console.log(`Granted ship_receipts_view to ${(rows as unknown[]).length} users`, rows);
  await sequelize.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
