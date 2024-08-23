const { upload } = require("../../../config/fileUploadMiddleware");
const Attachment = require("../attachments/attachment.model");
const Factory = require("./factory.model");

class FactoryService {
  static async uploadFile(factoryId, filePath, fileName, description) {
    const attachment = {
      modelId: factoryId,
      modelType: "Factory",
      name: fileName,
      url: filePath,
      description: description,
    };

    await Attachment.create(attachment);
    return {
      status: true,
      statusCode: 200,
      message: "File uploaded!",
    };
  }
  static async create(data) {
    return await Factory.create(data);
  }
  static async getAll() {
    return await Factory.findAll({
      include: [
        {
          model: Attachment,
          as: "attachments",
        },
      ],
    });
  }
  static async getOne(id) {
    return await Factory.findByPk(id);
  }
  static async update(id, data) {
    const factory = await Factory.findByPk(id);
    if (!factory) {
      return {
        status: false,
        statusCode: 404,
        message: "Factory not found",
      };
    }
    await factory.update(data);
    return {
      status: true,
      statusCode: 200,
      data: "Factory updated successfully",
    };
  }
  static async delete(id) {
    const factory = await Factory.findByPk(id);
    if (!factory) {
      return {
        status: false,
        statusCode: 404,
        message: "Factory not found",
      };
    }
    await factory.destroy();
    return {
      status: true,
      statusCode: 200,
      message: "Factory deleted successfully",
    };
  }
}
module.exports = FactoryService;
