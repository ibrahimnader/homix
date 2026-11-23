import { Op } from "sequelize";

const mockFindAll = jest.fn();

jest.mock("../../../app/modules/notification/notification.model", () => ({
  findAll: mockFindAll,
}));

import { NotificationRepository } from "./notification.repo";

describe("NotificationRepository.findPage", () => {
  const repository = new NotificationRepository();

  beforeEach(() => mockFindAll.mockReset());

  it("asks for limit + 1 rows, newest first, and reports hasMore without returning the extra row", async () => {
    mockFindAll.mockResolvedValue([
      { entityType: "order", id: 3 },
      { entityType: "ticket", id: 2 },
      { entityType: "order", id: 1 },
    ]);

    const page = await repository.findPage({ userId: 7 }, { limit: 2 });

    const options = mockFindAll.mock.calls[0][0];
    expect(options.limit).toBe(3);
    expect(options.order).toEqual([["createdAt", "DESC"], ["id", "DESC"]]);
    expect(options.where).toEqual({ userId: 7 });
    expect(page.hasMore).toBe(true);
    expect(page.rows.map((row) => row.id)).toEqual([3, 2]);
    expect(page.rows[1]?.category).toBe("tickets");
  });

  it("reports no more rows when the page is not full", async () => {
    mockFindAll.mockResolvedValue([{ entityType: "order", id: 1 }]);
    const page = await repository.findPage({ userId: 7 }, { limit: 50 });
    expect(page.hasMore).toBe(false);
    expect(page.rows).toHaveLength(1);
  });

  it("builds the keyset condition from before + beforeId and keeps the user scope", async () => {
    mockFindAll.mockResolvedValue([]);
    const before = new Date("2026-11-02T09:00:00.000Z");

    await repository.findPage({ userId: 7 }, { before, beforeId: 80, limit: 50 });

    const { where } = mockFindAll.mock.calls[0][0];
    expect(where.userId).toBe(7);
    expect(where[Op.or]).toEqual([
      { createdAt: { [Op.lt]: before } },
      { createdAt: before, id: { [Op.lt]: 80 } },
    ]);
  });

  it("falls back to createdAt only when no beforeId is given", async () => {
    mockFindAll.mockResolvedValue([]);
    const before = new Date("2026-11-02T09:00:00.000Z");
    await repository.findPage({ userId: 7 }, { before, limit: 10 });
    expect(mockFindAll.mock.calls[0][0].where[Op.or]).toEqual([{ createdAt: { [Op.lt]: before } }]);
  });
});
