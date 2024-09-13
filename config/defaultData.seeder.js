const Vendor = require("../app/modules/vendor/vendor.model");
const User = require("../app/modules/user/user.model");
const bcrypt = require("bcryptjs");
const Product = require("../app/modules/product/product.model");

const createDefaultData = async () => {
  const user = await User.findOne({
    where: { email: "testuser@homix.com" },
  });
  if (!user) {
    await User.create({
      email: "testuser@homix.com",
      password: bcrypt.hashSync(process.env.DEFAULT_PASSWORD, 10),
      userType: 1,
      firstName: "test",
      lastName: "user",
    });
    await User.create({
      email: "admin@homix.com",
      password: bcrypt.hashSync(process.env.DEFAULT_PASSWORD, 10),
      userType: 1,
      firstName: "admin",
      lastName: "user",
    });
  }
  const vendor = await Vendor.findOne({
    where: { name: "Custom" },
  });
  if (!vendor) {
    const customVendor = await Vendor.create({
      name: "Custom",
      shopifyId: "custom",
    });
    await Product.create({
      title: "Custom Product",
      image: `${process.env.APP_URL}/uploads/default-product.png`,
      variants: [],
      shopifyId: "custom",
      vendorId: customVendor.id,
    });
  }
};

module.exports = createDefaultData;
