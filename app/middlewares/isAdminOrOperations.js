const { USER_TYPES } = require("../../config/constants");

const isAdminOrOperation = (req, res, next) => {
  if (
    req.user.userType === USER_TYPES.ADMIN ||
    req.user.userType === USER_TYPES.OPERATION
  ) {
    return next();
  }
  return res.json({
    status: false,
    message: "Unauthorized",
  });
};

module.exports = isAdminOrOperation;
