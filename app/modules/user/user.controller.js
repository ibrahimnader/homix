const UserService = require("./user.service");

class UserController {
  static async getAllUsers(req, res) {
    try {
      const users = await UserService.getAdminUsers();
      res.status(200).json(users);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  static async getUser(req, res) {
    try {
      const user = await UserService.getUser(req.params.id);
      res.status(200).json(user);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
  static async editUser(req, res) {
    try {
      const user = await UserService.editUser(req.params.id, req.body);
      res.status(200).json(user);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
  static async deleteUser(req, res) {
    try {
      const user = await UserService.deleteUser(req.params.id);
      res.status(200).json(user);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
}
module.exports = UserController;
