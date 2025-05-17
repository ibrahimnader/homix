const Notification = require("./notification.model");

class NotificationService {
  static async getNotifications(userId) {
    try {
      const notifications = await Notification.findAll({
        where: {
          userId,
        },
        order: [["createdAt", "DESC"]],
      });
      return notifications;
    } catch (error) {
      throw new Error("Error fetching notifications");
    }
  }

  static async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOne({
        where: {
          id: notificationId,
          userId,
        },
      });

      if (!notification) {
        throw new Error("Notification not found");
      }

      notification.readAt = new Date();
      await notification.save();

      return notification;
    } catch (error) {
      throw new Error("Error marking notification as read");
    }
  }
  static async clearNotifications(userId) {
    try {
      await Notification.destroy({
        where: {
          userId,
        },
      });
      return { status: true, message: "Notifications cleared" };
    } catch (error) {
      throw new Error("Error clearing notifications");
    }
  }
  static async createNotification(notificationData) {
    try {
      const notification = await Notification.create(notificationData);
      return notification;
    } catch (error) {
      throw new Error("Error creating notification");
    }
  }
}

module.exports = NotificationService;
