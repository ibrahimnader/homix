const UserService = require("../user/user.service");
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
  static async deleteUserForVendor(req, res) {
    try {
      const { id } = req.params;
      const response = await UserService.deleteUserForVendor(id);
      res.status(response.statusCode).json(response);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
  
  static async createVendor(req, res) {
    try {
      const response = await VendorsService.create(req.body);
      res.status(response.statusCode).json(response);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
  static async getOneVendor(req, res) {
    try {
      const { id } = req.params;
      const response = await VendorsService.getOne(id);
      res.status(response.statusCode).json(response);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
  static async updateVendor(req, res) {
    try {
      const { id } = req.params;
      const response = await VendorsService.update(id, req.body);
      res.status(response.statusCode).json(response);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
  static async deleteVendor(req, res) {
    try {
      const { id } = req.params;
      const response = await VendorsService.delete(id);
      res.status(response.statusCode).json(response);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
}
module.exports = VendorsController;
