const mockCreated = jest.fn();
const mockUpdated = jest.fn();
const mockReply = jest.fn();
jest.mock("./ticket.notifications", () => ({
  notifyTicketCreated: (...args: unknown[]) => mockCreated(...args),
  notifyTicketReply: (...args: unknown[]) => mockReply(...args),
  notifyTicketUpdated: (...args: unknown[]) => mockUpdated(...args),
}));

import { NotFoundError } from "../../shared/errors";
import { TicketService } from "./ticket.service";

const details = { assignedTo: { firstName: "A", id: 5, lastName: "B" }, id: 4, order: { orderNumber: "31668" }, status: 2 };
const rawTicket = {
  assignedToUserId: 5,
  createdByUserId: 1,
  id: 4,
  linkedOrder: { orderNumber: "31668" },
  orderId: 7,
  status: 1,
  toJSON() { return { ...this }; },
};
const makeRepository = (overrides: Record<string, unknown> = {}) => ({
  createLogs: jest.fn().mockResolvedValue(undefined),
  createNote: jest.fn().mockResolvedValue({ id: 10, text: "رد" }),
  createTicket: jest.fn().mockResolvedValue({ id: 4 }),
  getRawTicketById: jest.fn().mockResolvedValue(rawTicket),
  getTicketById: jest.fn().mockResolvedValue(details),
  hasAssignee: jest.fn().mockResolvedValue(true),
  hasOrder: jest.fn().mockResolvedValue(true),
  hasTicketType: jest.fn().mockResolvedValue(true),
  updateTicket: jest.fn().mockResolvedValue(undefined),
  ...overrides,
}) as never;

describe("TicketService notifications", () => {
  it("notifies after a ticket is created, with the actor", async () => {
    const service = new TicketService(makeRepository());

    await service.createTicket({ assignedToUserId: 5, orderId: 7, type: 1 }, { id: 1 } as never);

    expect(mockCreated).toHaveBeenCalledWith({ assignedToUserId: 5, id: 4, orderNumber: "31668" }, 1);
  });

  it("does not notify when the order does not exist", async () => {
    const service = new TicketService(makeRepository({ hasOrder: jest.fn().mockResolvedValue(false) }));

    await expect(service.createTicket({ orderId: 7, type: 1 }, { id: 1 } as never)).rejects.toBeInstanceOf(NotFoundError);
    expect(mockCreated).not.toHaveBeenCalled();
  });

  it("passes before/after of an update to the notifier after it is saved", async () => {
    const repository = makeRepository();
    const service = new TicketService(repository);

    await service.updateTicket(4, { assignedToUserId: 8, status: 2 }, { id: 1 } as never);

    expect(mockUpdated).toHaveBeenCalledWith({
      after: { assignedToUserId: 8, status: 2 },
      before: expect.objectContaining({ assignedToUserId: 5, createdByUserId: 1, status: 1 }),
      orderNumber: "31668",
      ticketId: 4,
    }, 1);
  });

  it("keeps the stored assignee as the assignee when the update does not touch it", async () => {
    const service = new TicketService(makeRepository());

    await service.updateTicket(4, { status: 2 }, { id: 1 } as never);

    expect(mockUpdated.mock.calls[0]![0].after).toEqual({ assignedToUserId: 5, status: 2 });
  });

  it("does not notify when the update fails", async () => {
    const service = new TicketService(makeRepository({ updateTicket: jest.fn().mockRejectedValue(new Error("boom")) }));

    await expect(service.updateTicket(4, { status: 2 }, { id: 1 } as never)).rejects.toThrow("boom");
    expect(mockUpdated).not.toHaveBeenCalled();
  });

  it("notifies the other participants of a new reply", async () => {
    const service = new TicketService(makeRepository());

    await service.addNote(4, { text: "رد" }, { id: 5 } as never);

    expect(mockReply).toHaveBeenCalledWith({
      assignedToUserId: 5,
      createdByUserId: 1,
      id: 4,
      orderId: 7,
      orderNumber: "31668",
    }, 5);
  });

  it("does not notify when deleting a ticket (the link would be dead)", async () => {
    const service = new TicketService(makeRepository({ deleteTicket: jest.fn().mockResolvedValue(true) }));

    await service.deleteTicket(4, { id: 1 } as never);

    expect(mockCreated).not.toHaveBeenCalled();
    expect(mockUpdated).not.toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });
});
