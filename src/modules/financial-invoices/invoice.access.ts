const { USER_TYPES } = require("../../../config/constants");

type AccessUser = { permissions?: Record<string, unknown> | null; userType?: string } | null | undefined;

/**
 * Staff who may settle invoices (admins, or users holding finance_settle). They are the only non-vendor users
 * allowed to read vendors' bank data; a vendor reads his own data through his token scope instead.
 */
export const canSettle = (user: AccessUser): boolean => {
  if (!user || user.userType === USER_TYPES.VENDOR) return false;
  if (user.userType === USER_TYPES.ADMIN) return true;
  return Boolean(user.permissions && typeof user.permissions === "object" && user.permissions.finance_settle);
};
