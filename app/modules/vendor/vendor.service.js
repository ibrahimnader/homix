const User = require("../user/user.model");
const UserService = require("../user/user.service");
const Vendor = require("./vendor.model");

class VendorsService {
  static async create(data) {
    // use transaction to create a vendor and a user
    const transaction = await Vendor.sequelize.transaction();
    try {
      let vendor = await Vendor.create({
        name: data.name,
      });
      vendor = vendor.toJSON();
      vendor.name = vendor.name.replace(/[^a-zA-Z0-9]/g, "");
      const password = await bcrypt.hash(
        data.password
          ? data.password
          : `${capitalizeFirstLetter(vendor.name)}#${
              process.env.DEFAULT_PASSWORD
            }`,
        10
      );
      const user = await UserService.register({
        firstName: vendor.name,
        email: data.email || `${vendor.name}@${process.env.SHOPIFY_STORE}.com`,
        password,
        vendorId: vendor.id,
      });
      if (!user.status) {
        return user;
      }

      await transaction.commit();
      return {
        status: true,
        data: {
          ...vendor,
          active: true,
        },
        message: "Vendor created successfully",
        statusCode: 200,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  static async getOne(id) {
    const vendor = await Vendor.findByPk(id);
    if (!vendor) {
      return {
        status: false,
        message: "Vendor not found",
        statusCode: 404,
      };
    }
    const user = await UserService.getUserByVendorId(id);
    if (user) {
      vendor.active = true;
      vendor.email = user.email;
    } else {
      vendor.active = false;
    }
    return {
      status: true,
      data: vendor,
      statusCode: 200,
    };
  }

  static async update(id, data) {
    const vendor = await Vendor.findByPk(id);
    if (!vendor) {
      return {
        status: false,
        message: "Vendor not found",
        statusCode: 404,
      };
    }

    await UserService.updateVendorUser(id, data);

    return {
      status: true,
      data: vendor,
      message: "Vendor updated successfully",
      statusCode: 200,
    };
  }
  static async getExistingVendorsNames(names) {
    // get distinct vendor names from the database
    const vendors = await Vendor.findAll({
      where: {
        name: names,
      },
    });

    return vendors;
  }
  static async getVendorByNameAndSaveIfNotExist(name) {
    let vendor = await Vendor.findOne({
      where: {
        name,
      },
    });
    if (!vendor) {
      vendor = await Vendor.create({
        name,
      });
    }
    return vendor.toJSON();
  }
  static async saveVendors(names) {
    // save new vendors to the database
    const vendorsNames = names.map((name) => ({ name }));
    const result = await Vendor.bulkCreate(vendorsNames);
    const vendors = result.map((vendor) => vendor.toJSON());
    await UserService.saveUsersForVendors(vendors);
    return vendors;
  }
  static async getAllVendors() {
    const vendors = await Vendor.findAll({
      include: {
        model: User,
        as: "user",
      },
    });
    return {
      status: true,
      data: vendors,
      statusCode: 200,
    };
  }
  static async delete(id) {
    const vendor = await Vendor.findByPk(id);
    if (!vendor) {
      return {
        status: false,
        message: "Vendor not found",
        statusCode: 404,
      };
    }
    await vendor.destroy();
    const user = await UserService.getUserByVendorId(id);
    if (user) {
      await user.destroy();
    }
    return {
      status: true,
      message: "Vendor deleted successfully",
      statusCode: 200,
    };
  }
}

module.exports = VendorsService;
