import { NotFoundError } from "../../shared/errors";
import { NotificationRepository } from "./notification.repo";
import { NotificationService } from "./notification.service";

const emptyCounts = { orders: 0, shipments: 0, tickets: 0, total: 0 };

describe("NotificationService", () => {
  it("returns notifications and per-category unread counts for a user", async () => {
    const counts = { orders: 2, shipments: 1, tickets: 0, total: 3 };
    const notificationRepository = {
      countUnreadByCategory: jest.fn().mockResolvedValue(counts),
      findPage: jest.fn().mockResolvedValue({ hasMore: false, rows: [{ id: 1, userId: 2 }] }),
    } as Pick<NotificationRepository, "countUnreadByCategory" | "findPage"> as NotificationRepository;
    const service = new NotificationService(notificationRepository);

    const result = await service.getNotifications(2);

    expect(result.ok).toBe(true);
    expect(notificationRepository.findPage).toHaveBeenCalledWith(
      { userId: 2 },
      { before: undefined, beforeId: undefined, limit: 50 },
    );
    expect(notificationRepository.countUnreadByCategory).toHaveBeenCalledWith(2);
    if (result.ok) {
      expect(result.data.counts).toEqual(counts);
      expect(result.data.notifications).toHaveLength(1);
    }
  });

  it("always scopes the category filter by the user id", async () => {
    const notificationRepository = {
      countUnreadByCategory: jest.fn().mockResolvedValue(emptyCounts),
      findPage: jest.fn().mockResolvedValue({ hasMore: false, rows: [] }),
    } as Pick<NotificationRepository, "countUnreadByCategory" | "findPage"> as NotificationRepository;
    const service = new NotificationService(notificationRepository);

    await service.getNotifications(9, "tickets");

    const filters = (notificationRepository.findPage as jest.Mock).mock.calls[0][0];
    expect(filters.userId).toBe(9);
    expect(filters.entityType).toBeDefined();
  });

  it("returns a bounded page with a keyset cursor and server-side counts independent of the page", async () => {
    const counts = { orders: 1200, shipments: 30, tickets: 4, total: 1234 };
    const rows = [
      { createdAt: new Date("2026-11-02T10:00:00.000Z"), id: 90, userId: 2 },
      { createdAt: new Date("2026-11-02T09:00:00.000Z"), id: 80, userId: 2 },
    ];
    const findPage = jest.fn().mockResolvedValue({ hasMore: true, rows });
    const service = new NotificationService({
      countUnreadByCategory: jest.fn().mockResolvedValue(counts),
      findPage,
    } as unknown as NotificationRepository);

    const result = await service.getNotifications(2, undefined, { limit: 2 });

    expect(findPage).toHaveBeenCalledWith({ userId: 2 }, { before: undefined, beforeId: undefined, limit: 2 });
    expect(result).toMatchObject({
      data: {
        counts,
        hasMore: true,
        nextCursor: { before: "2026-11-02T09:00:00.000Z", beforeId: 80 },
      },
      ok: true,
    });
  });

  it("has no cursor on the last page and clamps the page size to 200", async () => {
    const findPage = jest.fn().mockResolvedValue({ hasMore: false, rows: [{ createdAt: new Date(), id: 1 }] });
    const service = new NotificationService({
      countUnreadByCategory: jest.fn().mockResolvedValue(emptyCounts),
      findPage,
    } as unknown as NotificationRepository);

    const result = await service.getNotifications(2, "orders", {
      before: new Date("2026-11-01T00:00:00.000Z"),
      beforeId: 5,
      limit: 100_000,
    });

    const [filters, options] = findPage.mock.calls[0];
    expect(filters.userId).toBe(2);
    expect(options).toEqual({ before: new Date("2026-11-01T00:00:00.000Z"), beforeId: 5, limit: 200 });
    expect(result).toMatchObject({ data: { hasMore: false, nextCursor: null }, ok: true });
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
