const Employee = require("./employee.model");

class EmployeeService {
  static async create(data) {
    return await Employee.create(data);
  }
  static async getAll() {
    return await Employee.find();
  }
  static async getOne(id) {
    return await Employee.findById(id);
  }
  static async readOne(id) {
    return await Employee.findById(id);
  }
  static async update(id, data) {
    return await Employee.findByIdAndUpdate(id, data, { new: true });
  }
  static async delete(id) {
    return await Employee.findByIdAndDelete(id);
  }
}
module.exports = EmployeeService;
