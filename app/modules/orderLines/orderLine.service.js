const { USER_TYPES } = require("../../../config/constants");
const Note = require("../notes/notes.model");
const OrderLine = require("./orderline.model");

class OrderLineService {
  static async updateOrderLine(orderLineId, orderData) {
    const orderLine = await OrderLine.findByPk(orderLineId);
    if (!orderLine) {
      return {
        status: false,
        statusCode: 404,
        message: "Order Line not found",
      };
    }
    if (orderData.cost) {
      orderData.cost = Number(orderData.cost);
      orderData.totalCost = orderData.cost * orderLine.quantity;
      const order = await OrderLine.findByPk(orderLine.orderId);
      order.totalCost =
        order.totalCost - orderLine.totalCost + orderData.totalCost;
      await order.save();
    }

    await OrderLine.update(orderData, { where: { id: orderLineId } });
    return {
      status: true,
      statusCode: 200,
      data: "data updated successfully",
    };
  }
  static async updateNote(user, orderLineId, noteId, text) {
    const orderLine = await OrderLine.findByPk(orderLineId);
    if (!orderLine) {
      return {
        status: false,
        statusCode: 404,
        message: "Order Line not found",
      };
    }
    let note = await Note.findByPk(noteId);
    if (!note) {
      return {
        status: false,
        statusCode: 404,
        message: "Note not found",
      };
    }
    if (
      user.userType === USER_TYPES.VENDOR &&
      user.id.toString() !== note.userId.toString()
    ) {
      return {
        status: false,
        statusCode: 403,
        message: "You are not authorized to update this note",
      };
    }
    note.text = text;
    await note.save();

    return {
      status: true,
      statusCode: 200,
      data: note,
    };
  }
  static async addNote(user, orderLineId, text) {
    const orderLine = await OrderLine.findByPk(orderLineId);
    if (!orderLine) {
      return {
        status: false,
        statusCode: 404,
        message: "Order Line not found",
      };
    }
    const newNote = await Note.create({
      text: text,
      userId: user.id,
      entityId: orderLineId,
      entityType: "orderLine",
    });
    return {
      status: true,
      statusCode: 200,
      data: newNote,
    };
  }
  static async deleteNote(user, orderLineId, noteId) {
    const orderLine = await OrderLine.findByPk(orderLineId);
    if (!orderLine) {
      return {
        status: false,
        statusCode: 404,
        message: "Order Line not found",
      };
    }
    const note = await Note.findByPk(noteId);
    if (!note) {
      return {
        status: false,
        statusCode: 404,
        message: "Note not found",
      };
    }
    if (
      user.userType === USER_TYPES.VENDOR &&
      user.id.toString() !== note.userId.toString()
    ) {
      return {
        status: false,
        statusCode: 403,
        message: "You are not authorized to update this note",
      };
    }
    await Note.destroy({ where: { id: noteId } });
    return {
      status: true,
      statusCode: 200,
      message: "Note deleted successfully",
    };
  }
}
module.exports = OrderLineService;
