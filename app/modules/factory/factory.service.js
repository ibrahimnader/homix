const { upload } = require("../../../config/fileUploadMiddleware");
const Attachment = require("../attachments/attachment.model");
const Factory = require("./factory.model");

class FactoryService {
  static async deleteAttachment(factoryId, attachmentId) {
    const factory = await Factory.findByPk(factoryId);
    if (!factory) {
      return {
        status: false,
        statusCode: 404,
        message: "Factory not found",
      };
    }
    const attachment = await Attachment.findByPk(attachmentId);
    if (!attachment) {
      return {
        status: false,
        statusCode: 404,
        message: "Attachment not found",
      };
    }
    await attachment.destroy();
    return {
      status: true,
      statusCode: 200,

      message: "Attachment deleted successfully",
    };
  }
  static async uploadFiles(factoryId, filePaths, fileNames, descriptions) {
    const factory = await Factory.findByPk(factoryId);
    if (!factory) {
      return {
        status: false,
        statusCode: 404,
        message: "Factory not found",
      };
    }
    for (let i = 0; i < filePaths.length; i++) {
      await Attachment.create({
        modelId: factoryId,
        modelType: "Factory",
        name: fileNames[i],
        url: filePaths[i],
        description: descriptions[i] || "",
      });
    }

    return {
      status: true,
      statusCode: 200,
      message: "Files uploaded!",
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
    return await Factory.findByPk(id, {
      include: [
        {
          model: Attachment,
          as: "attachments",
        },
      ],
    });
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
