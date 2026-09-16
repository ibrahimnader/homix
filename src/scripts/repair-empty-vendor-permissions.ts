import { QueryTypes } from "sequelize";
import { USER_TYPES } from "../../config/constants";
import { normalizePermissions } from "../../app/modules/user/user.helpers";
import { sequelize } from "../infrastructure/database/sequelize";

// Preserve explicit denials and customized permission maps. Dry-run by default.
const apply = process.argv.includes("--apply");
const run = async (): Promise<void> => {
  await sequelize.transaction(async (transaction) => {
    const accounts = await sequelize.query<{ id: number; email: string }>(`
      SELECT u.id, u.email FROM users u
      JOIN vendors v ON v.id = u."vendorId" AND v."deletedAt" IS NULL
      WHERE u."userType" = :vendorType AND u."deletedAt" IS NULL
        AND u."accountStatus" = 'active'
        AND (u.permissions IS NULL OR u.permissions::jsonb = '{}'::jsonb)
      ORDER BY u.id FOR UPDATE OF u
    `, { replacements: { vendorType: USER_TYPES.VENDOR }, type: QueryTypes.SELECT, transaction });
    const permissions = JSON.stringify(normalizePermissions(undefined, USER_TYPES.VENDOR));
    for (const account of apply ? accounts : []) {
      await sequelize.query(`UPDATE users SET permissions = :permissions, "updatedAt" = NOW()
        WHERE id = :id AND (permissions IS NULL OR permissions::jsonb = '{}'::jsonb)`,
      { replacements: { id: account.id, permissions }, transaction });
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", count: accounts.length, accounts }));
  });
};

run().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => sequelize.close());
