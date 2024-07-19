const isAdmin = (req, res, next) => {
  if (req.user.userType === USER_TYPES.ADMIN) {
    return next();
  }
  return res.json({
    status: false,
    message: "Unauthorized",
  });
};

module.exports = isAdmin;
