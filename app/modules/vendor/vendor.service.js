const Vendor = require("./vendor.model");

class VendorsService {
  static async getExistingVendorsNames(names) {
    // get distinct vendor names from the database
    const vendors = await Vendor.findAll({
      where: {
        name: names,
      },
    });

    return vendors;
  }
  static async saveVendors(names) {
    // save new vendors to the database
    const vendors = names.map((name) => ({ name }));
    const result = await Vendor.bulkCreate(vendors);
    return result.map((vendor) => vendor.toJSON());
  }
  static async getAllVendors() {
    const vendors = await Vendor.findAll();
    return vendors;
  }
}

module.exports = VendorsService;
