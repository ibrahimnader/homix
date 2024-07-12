const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const { USER_TYPES } = require("../../../config/constants");

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
      allowNull: false,
    },
    userType: {
      type: DataTypes.ENUM(USER_TYPES.ADMIN, USER_TYPES.USER),
      defaultValue: USER_TYPES.USER,
    },
    removed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    tableName: "users",
    timestamps: true,
    paranoid: true,
    deletedAt: 'destroyTime',
  }
);

module.exports = User;
