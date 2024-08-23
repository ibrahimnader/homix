const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const { USER_TYPES } = require("../../../config/constants");
const bcrypt = require("bcryptjs");
const User = sequelize.define(
  "User",
  {
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    userType: {
      type: DataTypes.ENUM(USER_TYPES.ADMIN, USER_TYPES.VENDOR),
      defaultValue: USER_TYPES.VENDOR,
    },
    vendorId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "users",
    paranoid: true,
    timestamps: true,
    defaultScope: {
      attributes: { exclude: ["password"] },
    },
    scopes: {
      withPassword: {
        attributes: {},
      },
    },
  }
);

User.prototype.toJSON = function () {
  const values = { ...this.get() };
  delete values.password;
  return values;
};



module.exports = User;
