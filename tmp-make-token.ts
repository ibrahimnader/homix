import { sequelize } from "./src/infrastructure/database";
import jwt from "jsonwebtoken";

(async () => {
  const [rows] = await sequelize.query(
    `SELECT id, "userType", permissions FROM users WHERE "userType" = '1' AND "deletedAt" IS NULL ORDER BY id LIMIT 1`
  ) as any;
  const user = rows[0];
  if (!user) throw new Error("no admin user found");
  const token = jwt.sign({ id: user.id }, "dummy");
  console.log(JSON.stringify({ id: user.id, token }));
  await sequelize.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
