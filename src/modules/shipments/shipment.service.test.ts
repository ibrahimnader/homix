import { NotFoundError, UnauthorizedError } from "../../shared/errors";
import { shipmentLegacyGateway } from "./shipment.legacy-gateway";
import { ShipmentService } from "./shipment.service";

const mockStatusChanges = jest.fn();
const mockScheduled = jest.fn();
jest.mock("./shipment.notifications", () => ({
  notifyShipmentScheduled: (...args: unknown[]) => mockScheduled(...args),
  notifyShipmentStatusChanges: (...args: unknown[]) => mockStatusChanges(...args),
}));

jest.mock("../dashboard/dashboard-aggregate.service", () => ({
  DashboardAggregateService: jest.fn().mockImplementation(() => ({
    refreshRange: jest.fn(),
  })),
}));

describe("ShipmentService", () => {
  it("throws not found when shipment details request misses", async () => {
    const repository = {
      getShipmentById: jest.fn().mockResolvedValue(null),
    } as never;

    const service = new ShipmentService(repository);

    await expect(service.getShipmentById(9802, null)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updates a shipment through the typed repository path", async () => {
    const repository = {
      updateShipment: jest.fn().mockResolvedValue({ id: 9802, shipmentStatus: 3 }),
    } as never;

    const service = new ShipmentService(repository);

    await expect(service.updateShipment(9802, { shipmentStatus: 3 }, { id: 7 })).resolves.toEqual({
      data: { id: 9802, shipmentStatus: 3 },
      ok: true,
    });
    expect((repository as unknown as { updateShipment: jest.Mock }).updateShipment)
      .toHaveBeenCalledWith(9802, { shipmentStatus: 3 }, 7);
  });

  it("forces deliveryBy to homix and recalculates amount to collect on shipment creation", async () => {
    const repository = {
      normalizeShippingCompanyPayload: jest.fn().mockResolvedValue({
        line_items: [{ price: 1000, quantity: 2 }],
        shippingFees: 50,
      }),
    } as never;
    const createShipmentSpy = jest.spyOn(shipmentLegacyGateway, "createShipment").mockResolvedValue(undefined);

    const service = new ShipmentService(repository);

    await service.createShipment({} as never);

    expect(createShipmentSpy).toHaveBeenCalledWith(expect.objectContaining({
      deliveryBy: 1,
      priority: 1,
      shippedFromInventory: true,
      toBeCollected: 2050,
    }));
    createShipmentSpy.mockRestore();
  });

  it("creates a shipment note through the typed repository path", async () => {
    const repository = {
      createShipmentNote: jest.fn().mockResolvedValue({ id: 18, text: "note" }),
      findShipmentEntity: jest.fn().mockResolvedValue({ id: 9802 }),
    } as never;

    const service = new ShipmentService(repository);

    await expect(service.addNote(9802, "note", { id: 1 } as never)).resolves.toEqual({
      data: { id: 18, text: "note" },
      ok: true,
    });
  });

  it("throws unauthorized when another user updates a shipment note", async () => {
    const repository = {
      findNoteById: jest.fn().mockResolvedValue({
        entityId: 9802,
        entityType: "shipment",
        userId: 77,
      }),
      findShipmentEntity: jest.fn().mockResolvedValue({ id: 9802 }),
    } as never;

    const service = new ShipmentService(repository);

    await expect(
      service.updateNote(9802, 18, "updated", { id: 1, userType: "1" } as never),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("deletes shipments through the typed repository path", async () => {
    const repository = {
      deleteShipment: jest.fn().mockResolvedValue(true),
    } as never;

    const service = new ShipmentService(repository);

    await expect(service.deleteShipment(9802)).resolves.toEqual({
      data: { message: "Shipment deleted successfully" },
      ok: true,
    });
  });

  it("creates inventory items through the typed repository path", async () => {
    const repository = {
      createInventoryItem: jest.fn().mockResolvedValue({ id: 6, productCode: "NEW-1" }),
    } as never;

    const service = new ShipmentService(repository);

    await expect(
      service.createInventoryItem({
        costPrice: 2800,
        productId: 555,
        productCode: "NEW-1",
        quantity: 1,
      }),
    ).resolves.toEqual({
      data: { id: 6, productCode: "NEW-1" },
      ok: true,
    });
  });

  it("creates vendor returns through the typed repository path", async () => {
    const repository = {
      createReturnRecord: jest.fn().mockResolvedValue({ id: 9802, orderId: 9802, status: 2 }),
    } as never;

    const service = new ShipmentService(repository);

    await expect(
      service.createVendorReturn({ orderId: 9802, reason: "منتج تالف", status: 2 }, { id: 7 }),
    ).resolves.toEqual({
      data: { id: 9802, orderId: 9802, status: 2 },
      ok: true,
    });
    expect((repository as unknown as { createReturnRecord: jest.Mock }).createReturnRecord)
      .toHaveBeenCalledWith(1, expect.any(Object), 7);
  });

  it("updates vendor returns through the typed repository path", async () => {
    const repository = {
      findReturnById: jest.fn().mockResolvedValue({ toJSON: () => ({ status: 2 }) }),
      updateReturnRecord: jest.fn().mockResolvedValue({ id: 9802, orderId: 9802, status: 3 }),
    } as never;

    const service = new ShipmentService(repository);

    await expect(
      service.updateVendorReturn(9802, { status: 3 }, { id: 1, userType: "1" } as never),
    ).resolves.toEqual({
      data: { id: 9802, orderId: 9802, status: 3 },
      ok: true,
    });
  });

  it("allows updating a vendor return derived from an order before its workflow row exists", async () => {
    const repository = {
      findReturnById: jest.fn().mockResolvedValue(null),
      updateReturnRecord: jest.fn().mockResolvedValue({
        id: 41,
        orderId: 9802,
        reason: "تم التواصل مع العميل للتسليم لكن لم يتم الرد",
        status: 3,
      }),
    } as never;

    const service = new ShipmentService(repository);
    const payload = {
      orderId: 9802,
      reason: "تم التواصل مع العميل للتسليم لكن لم يتم الرد",
      status: 3,
    };

    await expect(
      service.updateVendorReturn(9802, payload, { id: 7, userType: "3" } as never),
    ).resolves.toEqual({
      data: expect.objectContaining({ orderId: 9802, reason: payload.reason, status: 3 }),
      ok: true,
    });
    expect((repository as unknown as { updateReturnRecord: jest.Mock }).updateReturnRecord)
      .toHaveBeenCalledWith(9802, 1, payload, 7);
  });

  it("blocks non-admin updates for forfeited vendor returns", async () => {
    const repository = {
      findReturnById: jest.fn().mockResolvedValue({ toJSON: () => ({ status: 4 }) }),
    } as never;

    const service = new ShipmentService(repository);

    await expect(
      service.updateVendorReturn(41, { status: 3 }, { id: 7, userType: "3" } as never),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("creates expenses through the typed repository path", async () => {
    const repository = {
      createExpenseAccount: jest.fn().mockResolvedValue({ amount: 150, id: 9 }),
      hasExpenseType: jest.fn().mockResolvedValue(true),
    } as never;

    const service = new ShipmentService(repository);

    await expect(
      service.createExpenseAccount({ amount: 150, reason: "مواد تغليف", type: 2 }),
    ).resolves.toEqual({
      data: { amount: 150, id: 9 },
      ok: true,
    });
  });

  describe("notifications", () => {
    const entity = (shipmentStatus: number, extra: Record<string, unknown> = {}) => ({
      toJSON: () => ({ shipmentStatus, ...extra }),
    });

    it("notifies once, with the actor, when a single update changes the shipment status", async () => {
      const repository = {
        findShipmentEntity: jest.fn().mockResolvedValue(entity(3)),
        updateShipment: jest.fn().mockResolvedValue(entity(4)),
      } as never;

      await new ShipmentService(repository).updateShipment(9802, { shipmentStatus: 4 }, { id: 7 });

      expect(mockStatusChanges).toHaveBeenCalledTimes(1);
      expect(mockStatusChanges).toHaveBeenCalledWith([{ fromStatus: 3, orderId: 9802, toStatus: 4 }], 7);
      expect(mockScheduled).not.toHaveBeenCalled();
    });

    it("does not notify when the shipment status did not change", async () => {
      const repository = {
        findShipmentEntity: jest.fn().mockResolvedValue(entity(3)),
        updateShipment: jest.fn().mockResolvedValue(entity(3)),
      } as never;

      await new ShipmentService(repository).updateShipment(9802, { governorate: "x" }, { id: 7 });

      expect(mockStatusChanges).not.toHaveBeenCalled();
    });

    it("notifies about a new scheduled date when the status stays the same", async () => {
      const repository = {
        findShipmentEntity: jest.fn().mockResolvedValue(entity(11, { scheduledDeliveryDate: "2026-12-01" })),
        updateShipment: jest.fn().mockResolvedValue(entity(11, { scheduledDeliveryDate: "2026-12-05" })),
      } as never;

      await new ShipmentService(repository).updateShipment(9802, { scheduledDeliveryDate: "2026-12-05" }, { id: 7 });

      expect(mockStatusChanges).not.toHaveBeenCalled();
      expect(mockScheduled).toHaveBeenCalledWith(9802, "2026-12-05", 7);
    });

    it("sends ONE aggregated call for a bulk update, only for rows whose status really changed", async () => {
      const after: Record<number, number> = { 1: 4, 2: 4, 3: 4 };
      const before: Record<number, number> = { 1: 1, 2: 4, 3: 2 };
      const calls: Record<number, number> = {};
      const repository = {
        bulkUpdateShipments: jest.fn().mockResolvedValue(3),
        findShipmentEntity: jest.fn().mockImplementation(async (id: number) => {
          calls[id] = (calls[id] ?? 0) + 1;
          return entity(calls[id] === 1 ? before[id]! : after[id]!);
        }),
      } as never;

      await new ShipmentService(repository).bulkUpdateShipments([1, 2, 3], { shipmentStatus: 4 }, { id: 7 });

      expect(mockStatusChanges).toHaveBeenCalledTimes(1);
      expect(mockStatusChanges).toHaveBeenCalledWith([
        { fromStatus: 1, orderId: 1, toStatus: 4 },
        { fromStatus: 2, orderId: 3, toStatus: 4 },
      ], 7);
    });

    it("does not notify when the update itself fails", async () => {
      const repository = {
        findShipmentEntity: jest.fn().mockResolvedValue(entity(3)),
        updateShipment: jest.fn().mockRejectedValue(new Error("boom")),
      } as never;

      await expect(new ShipmentService(repository).updateShipment(9802, { shipmentStatus: 4 }, { id: 7 })).rejects.toThrow("boom");
      expect(mockStatusChanges).not.toHaveBeenCalled();
    });

    it("notifies after a vendor return and a customer return are created", async () => {
      const repository = {
        createReturnRecord: jest.fn().mockResolvedValue({ id: 9802, orderId: 9802, status: 2 }),
      } as never;
      const service = new ShipmentService(repository);

      await service.createVendorReturn({ orderId: 9802, reason: "x" }, { id: 7 });
      await service.createCustomerReturn({ orderId: 9803, reason: "x" }, { id: 7 });

      expect(mockStatusChanges).toHaveBeenNthCalledWith(1, [{ orderId: 9802, toStatus: 8 }], 7);
      expect(mockStatusChanges).toHaveBeenNthCalledWith(2, [{ orderId: 9803, toStatus: 7 }], 7);
    });
  });
});
