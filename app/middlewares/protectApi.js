const { USER_TYPES } = require("../../config/constants");
const User = require("../modules/user/user.model");
const jwt = require("jsonwebtoken");

const verifyToken = async (req, res, next) => {
  //check header or url parameters or post parameters for token
  if (process.env.NODE_ENV === "test") {
    const user = await User.findOne({}).orFail();
    req.user = user;
    return next();
  }

  let token = req.headers["x-access-token"] || req.headers["authorization"];
  if (!token) {
    token = req.headers.token;
  }

  if (!token) {
    return res.json({
      status: false,
      message: "No token provided.",
    });
  }

  if (token.startsWith("Bearer")) {
    [, token] = token.split(" ");
  }

  let decoded = null;

  //verifies secret and checks exp
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.json({
      status: false,
      force_logout: true,
      message: "Failed to authenticate token.",
    });
  }

  let user = null;
  try {
    const id = decoded.id;
    // Find user by id or fail
    user = await User.findByPk(id);
    if (!user) {
      return res.json({
        status: false,
        force_logout: true,
        message: "Failed to authenticate token.",
      });
    }
  } catch (error) {
    return res.json({
      status: false,
      force_logout: true,
      message: "Failed to authenticate token.",
    });
  }

  req.user = user;
  req.vendorId = user.userType === USER_TYPES.VENDOR ? user.vendorId : null;
  return next();
};

module.exports = verifyToken;
