import type { Request, Response } from "express";

import { unwrap } from "../../shared/result";
import type { NotificationListQuery } from "./notification.schemas";
import type { NotificationServiceContract } from "./notification.service";

export class NotificationController {
  public constructor(private readonly notificationService: NotificationServiceContract) {}

  public clearNotifications = async (request: Request, response: Response): Promise<void> => {
    const result = await this.notificationService.clearNotifications(request.user!.id);
    response.status(200).json(unwrap(result));
  };

  public getNotifications = async (request: Request, response: Response): Promise<void> => {
    const { category } = request.query as NotificationListQuery;
    const result = await this.notificationService.getNotifications(request.user!.id, category);
    response.status(200).json(unwrap(result));
  };

  public markAsRead = async (request: Request, response: Response): Promise<void> => {
    const { category } = (request.body ?? {}) as NotificationListQuery;
    const result = await this.notificationService.markAsRead(request.user!.id, category);
    response.status(200).json(unwrap(result));
  };

  public markOneAsRead = async (request: Request, response: Response): Promise<void> => {
    const notificationId = Number(request.params.notificationId);
    const result = await this.notificationService.markOneAsRead(request.user!.id, notificationId);
    response.status(200).json(unwrap(result));
  };
}
