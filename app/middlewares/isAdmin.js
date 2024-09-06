const { USER_TYPES } = require("../../config/constants");

const isAdmin = (req, res, next) => {
  if (req.user.userType === USER_TYPES.ADMIN) {
    return next();
  }
  return res.status(500).json({
    status: false,
    message: "Unauthorized",
  });
};

module.exports = isAdmin;
