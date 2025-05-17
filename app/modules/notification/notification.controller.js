const NotificationService = require("./notification.service");

class NotificationController {
  static async getNotifications(req, res) {
    try {
      const notifications = await NotificationService.getNotifications(
        req.user.id
      );
      return res.status(200).json({ status: true, notifications });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  }
  static async markAsRead(req, res) {
    try {
      const { notificationId } = req.body;
      const notification = await NotificationService.markAsRead(
        notificationId,
        req.user.id
      );
      return res.status(200).json({ status: true, notification });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  }
  static async clearNotifications(req, res) {
    try {
      const result = await NotificationService.clearNotifications(req.user.id);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  }
}
module.exports = NotificationController;
