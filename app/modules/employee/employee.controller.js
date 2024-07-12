const EmployeeService = require("./employee.service");

class EmployeeController {
  static async create(req, res, next) {
    try {
      let employee = await EmployeeService.create(req.body);
      res.status(201).json(employee);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }

  static async getOne(req, res, next) {
    try {
      let employee = await EmployeeService.getOne(req.params.id);
      res.status(200).json(employee);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async getAll(req, res, next) {
    try {
      let employee = await EmployeeService.getAll(req.params.id);
      res.status(200).json(employee);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }

  static async update(req, res, next) {
    try {
      let employee = await EmployeeService.update(req.params.id, req.body);
      res.status(200).json(employee);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }

  static async delete(req, res, next) {
    try {
      let employee = await EmployeeService.delete(req.params.id);
      res.status(200).json(employee);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
}
module.exports = EmployeeController;
