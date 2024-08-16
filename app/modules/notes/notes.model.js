const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const User = require("../user/user.model");

const Note = sequelize.define(
  "Notes",
  {
    text: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    userId: {
      type: DataTypes.INTEGER,
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
  },
  {
    tableName: "notes",
    timestamps: true,
    paranoid: true,
  }
);

Note.belongsTo(User, { as: "user", foreignKey: "userId" });
module.exports = Note;
