const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../src/infrastructure/database");
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
      type: DataTypes.ENUM(Object.values(USER_TYPES)),
      defaultValue: USER_TYPES.VENDOR,
    },
    vendorId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    roleName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    accountStatus: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "active",
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    jobTitle: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    salary: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    bankName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    bankAccountType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    bankAccountHolderName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    bankAccountNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    walletNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    instaPayNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    permissions: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
    lastSeenAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastPasswordChangeAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    socketIds: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: true,
    },
  },
  {
    tableName: "users",
    paranoid: true,
    timestamps: true,
    defaultScope: {
      // `socketIds` is only needed by the socket handlers/notification publisher (they request it explicitly);
      // excluded here because the auth lookup loads the user on every request and the column can be large.
      attributes: { exclude: ["password", "socketIds"] },
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

export = User;
