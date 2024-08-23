const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const Factory = require("../factory/factory.model");

const Attachment = sequelize.define(
  "Attachment",
  {
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    url: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    modelType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    modelId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: "attachments",
    timestamps: true,
    paranoid: true,
  }
);

Factory.hasMany(Attachment, {
  foreignKey: "modelId",
  constraints: false,
  scope: {
    modelType: "Factory",
  },
  as: "attachments",
});
module.exports = Attachment;
