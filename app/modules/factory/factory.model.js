const { DataTypes } = require("sequelize");
const { sequelize } = require("../../../config/db.config");
const { FACTORY_STATUS } = require("../../../config/constants");

const Factory = sequelize.define(
  "Factory",
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    address: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    longitude: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    latitude: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    country: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    postalCode: {
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
    website: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    factoryCategory: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    contactPersonName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    contactPersonPhoneNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    contactPersonEmail: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    cairoGizaShipping: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    otherCitiesShipping: {
      type: DataTypes.DECIMAL,
      allowNull: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "factories",
    timestamps: true,
    paranoid: true,
  }
);

module.exports = Factory;
