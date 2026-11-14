const mockPublish = jest.fn();
const mockAdmins = jest.fn();
const mockVendorUsers = jest.fn();
jest.mock("../notification/notification.publisher", () => ({
  ...jest.requireActual("../notification/notification.publisher"),
  publishNotificationsSafely: (...args: unknown[]) => mockPublish(...args),
  resolveAdminUserIds: (...args: unknown[]) => mockAdmins(...args),
  resolveOrderVendorUserIds: (...args: unknown[]) => mockVendorUsers(...args),
}));

import {
  buildUpdateRows,
  notifyTicketCreated,
  notifyTicketReply,
  notifyTicketUpdated,
} from "./ticket.notifications";

const rows = () => mockPublish.mock.calls[0]![0] as Array<{ entityId: number; entityType: string; text: string; userId: number }>;
const ids = () => rows().map((row) => row.userId).sort((a, b) => a - b);

describe("notifyTicketCreated", () => {
  it("notifies the assignee only", async () => {
    await notifyTicketCreated({ assignedToUserId: 5, id: 12, orderNumber: "31668" }, 1);

    expect(rows()).toEqual([
      { entityId: 12, entityType: "ticket", text: "تم إنشاء تذكرة جديدة رقم #12 للطلب 31668", userId: 5 },
    ]);
    expect(mockAdmins).not.toHaveBeenCalled();
  });

  it("falls back to the admins when nobody is assigned", async () => {
    mockAdmins.mockResolvedValue([1, 2, 3]);

    await notifyTicketCreated({ id: 12 }, 2);

    expect(ids()).toEqual([1, 3]);
  });

  it("does not notify a creator who assigned the ticket to themselves", async () => {
    await notifyTicketCreated({ assignedToUserId: 5, id: 12 }, 5);
    expect(rows()).toEqual([]);
  });

  it("never throws when the admin lookup fails", async () => {
    mockAdmins.mockRejectedValue(new Error("db down"));
    await expect(notifyTicketCreated({ id: 12 }, 2)).resolves.toBeUndefined();
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe("ticket update rows", () => {
  it("notifies the new assignee when the ticket is assigned or reassigned", () => {
    const result = buildUpdateRows({
      after: { assignedToUserId: 8 },
      before: { assignedToUserId: 5, createdByUserId: 1, status: 1 },
      ticketId: 4,
    });
    expect(result).toEqual([
      { entityId: 4, entityType: "ticket", text: "تم إسناد التذكرة رقم #4 إليك", userId: 8 },
    ]);
  });

  it("does nothing when the assignee did not change", () => {
    expect(buildUpdateRows({
      after: { assignedToUserId: 5 },
      before: { assignedToUserId: 5, createdByUserId: 1, status: 1 },
      ticketId: 4,
    })).toEqual([]);
  });

  it("notifies creator and assignee on a status change", () => {
    const result = buildUpdateRows({
      after: { assignedToUserId: 5, status: 2 },
      before: { assignedToUserId: 5, createdByUserId: 1, status: 1 },
      ticketId: 4,
    });
    expect(result.map((row) => [row.userId, row.text])).toEqual([
      [1, "تم تغيير حالة التذكرة رقم #4 إلى مغلقة"],
      [5, "تم تغيير حالة التذكرة رقم #4 إلى مغلقة"],
    ]);
  });

  it("ignores a status that is re-sent unchanged", () => {
    expect(buildUpdateRows({
      after: { assignedToUserId: 5, status: 1 },
      before: { assignedToUserId: 5, createdByUserId: 1, status: 1 },
      ticketId: 4,
    })).toEqual([]);
  });

  it("gives the new assignee ONE notification when an update both assigns and changes the status", async () => {
    await notifyTicketUpdated({
      after: { assignedToUserId: 8, status: 2 },
      before: { assignedToUserId: 5, createdByUserId: 1, status: 1 },
      ticketId: 4,
    }, 99);

    const result = rows();
    expect(result.filter((row) => row.userId === 8)).toEqual([
      { entityId: 4, entityType: "ticket", text: "تم إسناد التذكرة رقم #4 إليك", userId: 8 },
    ]);
    expect(ids()).toEqual([1, 8]);
  });

  it("never notifies the actor", async () => {
    await notifyTicketUpdated({
      after: { assignedToUserId: 5, status: 2 },
      before: { assignedToUserId: 5, createdByUserId: 1, status: 1 },
      ticketId: 4,
    }, 1);
    expect(ids()).toEqual([5]);
  });
});

describe("notifyTicketReply", () => {
  it("notifies creator, assignee and the order's vendor users but not the author, without duplicates", async () => {
    mockVendorUsers.mockResolvedValue([20, 21]);

    await notifyTicketReply({ assignedToUserId: 5, createdByUserId: 5, id: 4, orderId: 7, orderNumber: "31668" }, 21);

    expect(mockVendorUsers).toHaveBeenCalledWith(7);
    expect(rows()).toEqual([
      { entityId: 4, entityType: "ticket", text: "تم إضافة رد جديد على التذكرة رقم #4 للطلب 31668", userId: 5 },
      { entityId: 4, entityType: "ticket", text: "تم إضافة رد جديد على التذكرة رقم #4 للطلب 31668", userId: 20 },
    ]);
  });

  it("never throws when the vendor lookup fails", async () => {
    mockVendorUsers.mockRejectedValue(new Error("db down"));
    await expect(notifyTicketReply({ id: 4, orderId: 7 }, 1)).resolves.toBeUndefined();
  });
});
