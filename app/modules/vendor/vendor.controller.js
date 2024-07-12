const VendorsService = require("./vendor.service");

class VendorsController {
  static async getVendors(req, res) {
    try {
      const vendors = await VendorsService.getAllVendors();
      res.status(200).json(vendors);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
}
module.exports = VendorsController;
