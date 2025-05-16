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
          : `${UserService.capitalizeFirstLetter(vendor.name)}#${
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
    let vendor = await Vendor.findByPk(id);
    if (!vendor) {
      return {
        status: false,
        message: "Vendor not found",
        statusCode: 404,
      };
    }
    vendor = vendor.toJSON();
    const user = await UserService.getUserByVendorId(id);
    if (user) {
      vendor.active = true;
      vendor.email = user.email;
    } else {
      vendor.active = false;
    }
    return {
      status: true,
      data: {
        ...vendor,
        user,
      },
      statusCode: 200,
    };
  }

  static async update(id, data) {
    const existingVendor = await Vendor.findByPk(id);
    if (!existingVendor) {
      return {
        status: false,
        message: "Vendor not found",
        statusCode: 404,
      };
    }

    const user = await UserService.updateVendorUser(id, data);
    const vendor = await existingVendor.update({
      name: data.name,
      daysToDeliver: data.daysToDeliver,
    });

    return {
      status: true,
      data: {
        ...vendor.toJSON(),
        active: user ? true : false,
        user,
      },
      message: "Vendor updated successfully",
      statusCode: 200,
    };
  }
  static async getExistingVendorsMap(names) {
    const result = {};
    const uniqueNames = [...new Set(names)];
    const existingVendors = await Vendor.findAll({
      where: {
        name: uniqueNames,
      },
    });
    for (const vendor of existingVendors) {
      result[vendor.name] = vendor;
    }
    const existingVendorsNames = new Set(
      existingVendors.map((vendor) => vendor.name)
    );
    const createdVendors = names.filter(
      (name) => !existingVendorsNames.has(name)
    );
    if (createdVendors.length) {
      const createdVendorsData = await Vendor.bulkCreate(
        createdVendors.map((name) => ({ name }))
      );
      createdVendorsData.forEach((vendor) => {
        result[vendor.name] = vendor;
      });
    }

    await UserService.saveUsersForVendorsWithNoUsers(createdVendors);
    return result;
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
    const result = vendors.map((vendor) => {
      vendor = vendor.toJSON();
      return {
        ...vendor,
        active: vendor.user ? true : false,
      };
    });

    return {
      status: true,
      data: result,
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
