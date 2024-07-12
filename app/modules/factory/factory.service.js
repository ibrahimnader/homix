const Factory = require("./factory.model");

class FactoryService {
  static async create(data) {
    return await Factory.create(data);
  }
  static async getAll() {
    return await Factory.find();
  }
  static async getOne(id) {
    return await Factory.findById(id);
  }
  static async readOne(id) {
    return await Factory.findById(id);
  }
  static async update(id, data) {
    return await Factory.findByIdAndUpdate(id, data, { new: true });
  }
  static async delete(id) {
    return await Factory.findByIdAndDelete(id);
  }
}
module.exports = FactoryService;
