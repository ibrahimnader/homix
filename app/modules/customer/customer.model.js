const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");

const Customer = sequelize.define(
  "Customer",
  {
    firstName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    address2: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    shopifyId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: "customers",
    timestamps: true,
    paranoid: true,
  }
);

module.exports = Customer;
