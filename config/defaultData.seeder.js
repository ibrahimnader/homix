const Vendor = require("../app/modules/vendor/vendor.model");
const User = require("../app/modules/user/user.model");
const bcrypt = require("bcryptjs");
const Product = require("../app/modules/product/product.model");

const createDefaultData = async () => {
  const user = await User.findOne({
    where: { email: "testUser@homix.com" },
  });
  if (user) {
    return;
  }
  await User.create({
    email: "testUser@homix.com",
    password: bcrypt.hashSync(process.env.DEFAULT_PASSWORD, 10),
    userType: 1,
    firstName: "test",
    lastName: "user",
  });
  const customVendor = await Vendor.create({
    name: "Custom",
    shopifyId: "custom",
  });
  await Product.create({
    title: "Custom Product",
    image: null,
    variants: [],
    shopifyId: "custom",
    vendorId: customVendor.id,
  });
};

module.exports = createDefaultData;
