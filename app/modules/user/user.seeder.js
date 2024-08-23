const User = require("./user.model");
const bcrypt = require("bcryptjs");

const createDefaultUser = async () => {
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
};

module.exports = createDefaultUser;
