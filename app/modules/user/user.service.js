const User = require("./user.model");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { USER_TYPES } = require("../../../config/constants");
const Vendor = require("../vendor/vendor.model");
const { Op } = require("sequelize");

class UserService {
  static async login(email, password) {
    // Check if email and password are provided
    if (!email || !password) {
      return {
        status: false,
        statusCode: 400,
        message: "Email and password are required",
      };
    }

    try {
      // Find user by email
      const user = await User.scope("withPassword").findOne({
        where: { email: String(email).toLowerCase() },
      });

      
      // Check if password matches
      const isMatch = await bcrypt.compare(
        String(password),
        String(user.password) || ""
      );
      if (!user || !isMatch) {
        return {
          status: false,
          statusCode: 401,
          message: "Invalid email or password",
        };
      }

      // Create JWT token
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
        expiresIn: "3d",
      });

      // Return the token
      return {
        status: true,
        statusCode: 200,
        data: {
          token,
          user,
        },
      };
    } catch (error) {
      console.error(error);
    }
  }
  // Register endpoint
  static async addUser(body) {
    const { email, password } = body;

    // Check if email and password are provided
    if (!email || !password) {
      return {
        status: false,
        statusCode: 400,
        message: "Email and password are required",
      };
    }
    const user = await User.findOne({
      where: { email: String(email).toLowerCase() },
    });
    if (user) {
      return {
        status: false,
        statusCode: 409,
        message: "User already exists",
      };
    }
    if (!Object.values(USER_TYPES).includes(body.userType)) {
      return {
        status: false,
        statusCode: 400,
        message: "Invalid user type",
      };
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(String(password), 10);

    // Create new user
    const userObj = {
      ...body,
      email: String(email).toLowerCase(),
      password: hashedPassword,
    };

    const newUser = await User.create(userObj);
    return {
      status: true,
      statusCode: 200,
      data: newUser,
    };
  }
  static async getUser(id) {
    try {
      const user = await User.findByPk(id);
      if (!user) {
        return {
          status: false,
          statusCode: 404,
          message: "User not found",
        };
      }
      return {
        status: true,
        statusCode: 200,
        data: user,
      };
    } catch (error) {
      console.error(error);
    }
  }

  static async editUser(id, body) {
    try {
      const user = await User.findByPk(id);
      if (!user) {
        return {
          status: false,
          statusCode: 404,
          message: "User not found",
        };
      }
      if (body.password) {
        body.password = await bcrypt.hash(body.password, 10);
      }
      const updatedUser = await user.update(body);
      return {
        status: true,
        statusCode: 200,
        data: updatedUser,
      };
    } catch (error) {
      console.error(error);
    }
  }
  static async getAdminUsers() {
    try {
      const users = await User.findAll({
        where: {
          userType: { [Op.not]: USER_TYPES.VENDOR },
        },
      });
      return {
        status: true,
        statusCode: 200,
        data: users,
      };
    } catch (error) {
      console.error(error);
    }
  }
  static async getAllUsers() {
    try {
      const users = await User.findAll();
      return {
        status: true,
        statusCode: 200,
        data: users,
      };
    } catch (error) {
      console.error(error);
    }
  }
  static capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }
  static async saveUsersForVendorsWithNoUsers(createdVendors) {
    const users = await User.findAll({
      where: { vendorId: createdVendors.map((vendor) => vendor.id) },
      paranoid: false,
    });
    const vendors = createdVendors.filter(
      (vendor) => !users.find((user) => user.vendorId === vendor.id)
    );
    await UserService.saveUsersForVendors(vendors);
  }

  static async saveUsersForVendors(vendors) {
    const promises = [];
    for (const vendor of vendors) {
      vendor.name = vendor.name.replace(/[^a-zA-Z0-9]/g, "");
      const password = await bcrypt.hash(
        `${UserService.capitalizeFirstLetter(vendor.name.toLowerCase())}#${
          process.env.DEFAULT_PASSWORD
        }`,
        10
      );
      promises.push(
        User.create({
          email: `${vendor.name.toLowerCase()}@${
            process.env.SHOPIFY_STORE
          }.com`,
          password,
          firstName: vendor.name,
          userType: USER_TYPES.VENDOR,
          vendorId: vendor.id,
        })
      );
    }

    let vendorsUsers = await Promise.all(promises);
    return vendorsUsers;
  }

  static async getUserByVendorId(vendorId, withDeleted = false) {
    const user = await User.findOne({
      where: { vendorId },
      paranoid: !withDeleted,
    });
    return user;
  }
  static async updateVendorUser(vendorId, { name, password, email, active }) {
    const obj = {};
    if (name) {
      obj.firstName = name;
    }
    if (password) {
      obj.password = await bcrypt.hash(password, 10);
    }
    if (email) {
      obj.email = email;
    }
    let user = await User.findOne({
      where: { vendorId: Number(vendorId) },
      paranoid: false,
    });
    if (user && Object.keys(obj).length) {
      user = await user.update(obj);
    }
    if (user && user.deletedAt && active) {
      await User.restore({
        where: { vendorId: Number(vendorId) },
      });
    }
    return user ? user.toJSON() : null;
  }
  static async changeActiveStatus(vendorId) {
    const transaction = await Vendor.sequelize.transaction();
    try {
      const vendor = await Vendor.findOne({
        where: { id: vendorId },
      });
      if (!vendor) {
        return {
          status: false,
          statusCode: 404,
          message: "Vendor not found",
        };
      }
      const user = await User.findOne({
        where: { vendorId },
        paranoid: false,
      });
      if (user) {
        if (user.deletedAt) {
          await user.restore();
        } else {
          await user.destroy();
        }
      }

      await transaction.commit();
      return {
        status: true,
        statusCode: 200,
        message: "Vendor active status changed successfully",
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  static async deleteUser(id) {
    try {
      const user = await User.findByPk(id);
      if (!user) {
        return {
          status: false,
          statusCode: 404,
          message: "User not found",
        };
      }
      await user.destroy();
      return {
        status: true,
        statusCode: 200,
        message: "User deleted successfully",
      };
    } catch (error) {
      console.error(error);
    }
  }
}

module.exports = UserService;
