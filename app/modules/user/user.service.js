const User = require("./user.model");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { USER_TYPES } = require("../../../config/constants");

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
        where: { email },
      });

      if (!user) {
        return {
          status: false,
          statusCode: 401,
          message: "Invalid email or password",
        };
      }

      // Check if password matches
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return {
          status: false,
          statusCode: 401,
          message: "Invalid email or password",
        };
      }

      // Create JWT token
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
        expiresIn: "1h",
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
  static async register(body) {
    const { email, password } = body;

    // Check if email and password are provided
    if (!email || !password) {
      return {
        status: false,
        statusCode: 400,
        message: "Email and password are required",
      };
    }
    const user = await User.findOne({ where: { email } });
    if (user) {
      return {
        status: false,
        statusCode: 409,
        message: "User already exists",
      };
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const test = {
      ...body,
      password: hashedPassword,
    };

    const newUser = await User.create(test);
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
          userType: USER_TYPES.ADMIN,
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
      const users = await User.findAll()
      return {
        status: true,
        statusCode: 200,
        data: users,
      };
    } catch (error) {
      console.error(error);
    }
  }
  static async saveUsersForVendors(vendors) {
    const password = await bcrypt.hash(process.env.DEFAULT_PASSWORD, 10);
    const promises = vendors.map((vendor) => {
      return User.create({
        email: `${vendor.name}@${process.env.SHOPIFY_STORE}.com`,
        password,
        firstName: vendor.name,
        userType: USER_TYPES.VENDOR,
        vendorId: vendor.id,
      })
    });
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
    const user = await User.findOne({
      where: { vendorId },
    });
    if (user && Object.keys(obj).length) {
      await user.update(obj);
    }
    if (!user && active) {
      await User.restore({
        where: { vendorId },
      });
    }
  }
  static async deleteUserForVendor(vendorId) {
    const user = await User.findOne({
      where: { vendorId },
    });
    if (user) {
      await user.destroy();
    }
    return {
      status: true,
      statusCode: 200,
      message: "Vendor deactivated successfully",
    };
  }
}

module.exports = UserService;
