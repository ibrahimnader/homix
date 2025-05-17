const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");

const Notification = sequelize.define(
  "Notification",
  {
    text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    entityId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    entityType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "notifications",
    timestamps: true,
  }
);

module.exports = Notification;
