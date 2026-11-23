import { NotFoundError } from "../../shared/errors";
import { NotificationRepository } from "./notification.repo";
import { NotificationService } from "./notification.service";

const emptyCounts = { orders: 0, shipments: 0, tickets: 0, total: 0 };

describe("NotificationService", () => {
  it("returns notifications and per-category unread counts for a user", async () => {
    const counts = { orders: 2, shipments: 1, tickets: 0, total: 3 };
    const notificationRepository = {
      countUnreadByCategory: jest.fn().mockResolvedValue(counts),
      findAll: jest.fn().mockResolvedValue([{ id: 1, userId: 2 }]),
    } as Pick<NotificationRepository, "countUnreadByCategory" | "findAll"> as NotificationRepository;
    const service = new NotificationService(notificationRepository);

    const result = await service.getNotifications(2);

    expect(result.ok).toBe(true);
    expect(notificationRepository.findAll).toHaveBeenCalledWith({ userId: 2 });
    expect(notificationRepository.countUnreadByCategory).toHaveBeenCalledWith(2);
    if (result.ok) {
      expect(result.data.counts).toEqual(counts);
      expect(result.data.notifications).toHaveLength(1);
    }
  });

  it("always scopes the category filter by the user id", async () => {
    const notificationRepository = {
      countUnreadByCategory: jest.fn().mockResolvedValue(emptyCounts),
      findAll: jest.fn().mockResolvedValue([]),
    } as Pick<NotificationRepository, "countUnreadByCategory" | "findAll"> as NotificationRepository;
    const service = new NotificationService(notificationRepository);

    await service.getNotifications(9, "tickets");

    const filters = (notificationRepository.findAll as jest.Mock).mock.calls[0][0];
    expect(filters.userId).toBe(9);
    expect(filters.entityType).toBeDefined();
  });

  it("succeeds idempotently when markAsRead updates nothing", async () => {
    const notificationRepository = {
      update: jest.fn().mockResolvedValue(0),
    } as Pick<NotificationRepository, "update"> as NotificationRepository;
    const service = new NotificationService(notificationRepository);

    const result = await service.markAsRead(4);
    expect(result).toMatchObject({ ok: true, data: { status: true, updated: 0 } });
  });

  it("marks only one category as read for the user", async () => {
    const update = jest.fn().mockResolvedValue(2);
    const service = new NotificationService({ update } as unknown as NotificationRepository);

    await service.markAsRead(4, "shipments");

    const [filters, payload] = update.mock.calls[0];
    expect(filters.userId).toBe(4);
    expect(filters.readAt).toBeNull();
    expect(filters.entityType).toBeDefined();
    expect(payload.readAt).toBeInstanceOf(Date);
  });

  it("marks one notification as read only when it belongs to the user", async () => {
    const update = jest.fn().mockResolvedValue(1);
    const service = new NotificationService({ update } as unknown as NotificationRepository);

    await service.markOneAsRead(4, 55);

    expect(update).toHaveBeenCalledWith({ id: 55, readAt: null, userId: 4 }, { readAt: expect.any(Date) });
  });

  it("treats an already-read own notification as success and a foreign one as not found", async () => {
    const update = jest.fn().mockResolvedValue(0);
    const findAll = jest.fn().mockResolvedValueOnce([{ id: 55 }]).mockResolvedValueOnce([]);
    const service = new NotificationService({ findAll, update } as unknown as NotificationRepository);

    await expect(service.markOneAsRead(4, 55)).resolves.toMatchObject({ ok: true });
    await expect(service.markOneAsRead(4, 56)).rejects.toBeInstanceOf(NotFoundError);
    expect(findAll).toHaveBeenLastCalledWith({ id: 56, userId: 4 });
  });
});
