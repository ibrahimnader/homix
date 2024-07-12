const FactoryService = require("./factory.service");

class FactoryController {
  static async create(req, res, next) {
    try {
      let factory = await FactoryService.create(req.body);
      res.status(201).json(factory);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }

  static async getOne(req, res, next) {
    try {
      let factory = await FactoryService.getOne(req.params.id);
      res.status(200).json(factory);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
  static async getAll(req, res, next) {
    try {
      let factory = await FactoryService.getAll(req.params.id);
      res.status(200).json(factory);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }

  static async update(req, res, next) {
    try {
      let factory = await FactoryService.update(req.params.id, req.body);
      res.status(200).json(factory);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }

  static async delete(req, res, next) {
    try {
      let factory = await FactoryService.delete(req.params.id);
      res.status(200).json(factory);
    } catch (error) {
      return next(new AppError(error.message, 500));
    }
  }
}
module.exports = FactoryController;
