import { NotFoundError, UnauthorizedError } from "../../shared/errors";
import { OrderService, restrictVendorOrderPayload } from "./order.service";

jest.mock("../dashboard/dashboard-aggregate.service", () => ({
  DashboardAggregateService: jest.fn().mockImplementation(() => ({
    refreshRange: jest.fn(),
    backfill: jest.fn(),
  })),
}));

describe("OrderService", () => {
  it("throws not found when an order details request misses", async () => {
    const repository = {
      getOrderById: jest.fn().mockResolvedValue(null),
    } as never;
    const service = new OrderService(repository, {} as never);

    await expect(service.getOrderById(7, null)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maps legacy delete failures into typed errors", async () => {
    const repository = {
      findOrderEntity: jest.fn().mockResolvedValue({ id: 7 }),
      createOrderLog: jest.fn().mockResolvedValue(undefined),
      deleteOrder: jest.fn().mockResolvedValue(undefined),
    } as never;
    const legacyGateway = {
      deleteOrder: jest.fn().mockResolvedValue({ message: "Order not found", status: false, statusCode: 404 }),
    } as never;
    const service = new OrderService(repository, legacyGateway);

    await expect(service.deleteOrder(7, { id: 1 })).resolves.toEqual({
      data: { message: "Order deleted successfully" },
      ok: true,
    });
  });

  it("throws unauthorized when a vendor tries to update someone else's note", async () => {
    const repository = {
      findNoteById: jest.fn().mockResolvedValue({ id: 4, userId: 77 }),
      findOrderEntity: jest.fn().mockResolvedValue({ id: 7 }),
    } as never;
    const service = new OrderService(repository, {} as never);

    await expect(
      service.updateNote(7, 4, "updated", { id: 1, userType: "vendor" } as never),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("uploads note attachments through the typed repository path", async () => {
    const repository = {
      createNoteAttachments: jest.fn().mockResolvedValue(undefined),
      findNoteById: jest.fn().mockResolvedValue({ id: 4 }),
    } as never;
    const service = new OrderService(repository, {} as never);

    await expect(
      service.uploadFiles(4, ["/tmp/a.pdf"], ["a.pdf"], ["invoice"]),
    ).resolves.toEqual({
      data: { message: "Files uploaded!" },
      ok: true,
    });
  });

  it("creates an order note through the repository and sends a notification through the gateway", async () => {
    const repository = {
      createOrderNote: jest.fn().mockResolvedValue({ id: 9, text: "hello" }),
      findOrderEntity: jest.fn().mockResolvedValue({ orderNumber: "31668" }),
    } as never;
    const legacyGateway = {
      sendNotification: jest.fn().mockResolvedValue(undefined),
    } as never;
    const service = new OrderService(repository, legacyGateway);

    await expect(
      service.addNote(7, "hello", { firstName: "Ahmed", id: 1, lastName: "Hesham" } as never),
    ).resolves.toEqual({
      data: { id: 9, text: "hello" },
      ok: true,
    });
  });

  it("delegates financial report reads to the typed repository", async () => {
    const getFinancialReport = jest.fn().mockResolvedValue({ summary: { totalSales: 3 } });
    const repository = {
      getFinancialReport,
    };
    const service = new OrderService(repository as never, {} as never);

    await expect(service.financialReport({ billingDay: 13, vendorId: 3 }, 7)).resolves.toEqual({
      data: { summary: { totalSales: 3 } },
      ok: true,
    });
    expect(getFinancialReport).toHaveBeenCalledWith({ billingDay: 13, vendorId: 3 }, 7);
  });

  it("defaults deliveryBy to vendor and recalculates amount to collect on create", async () => {
    const legacyGateway = {
      saveImportedOrders: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OrderService({} as never, legacyGateway as never);

    await service.createOrder({
      downPayment: 200,
      line_items: [{ price: 1000, quantity: 2 }],
      shippingFees: 50,
    });

    expect(legacyGateway.saveImportedOrders).toHaveBeenCalledWith([
      expect.objectContaining({
        deliveryBy: 2,
        priority: 1,
        shippedFromInventory: false,
        toBeCollected: 1850,
      }),
    ], false, undefined);
  });

  it("sets deliveryDate automatically when creating a delivered order without one", async () => {
    const legacyGateway = {
      saveImportedOrders: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OrderService({} as never, legacyGateway as never);

    await service.createOrder({
      line_items: [{ price: 1000, quantity: 1 }],
      status: 5,
    });

    expect(legacyGateway.saveImportedOrders).toHaveBeenCalledWith([
      expect.objectContaining({
        deliveryDate: expect.any(String),
        status: 5,
      }),
    ], false, undefined);
  });

  it("switches deliveryBy to homix and recalculates amount to collect on update when warehouse shipping is selected", async () => {
    const repository = {
      findOrderEntity: jest.fn().mockResolvedValue({
        deliveryBy: 2,
        downPayment: 100,
        shipmentType: "separate",
        shippedFromInventory: false,
        shippingFees: 60,
        subTotalPrice: 2000,
        totalDiscounts: 150,
      }),
    } as never;
    const legacyGateway = {
      updateOrder: jest.fn().mockResolvedValue({ data: { id: 7 }, status: true }),
    };
    const service = new OrderService(repository, legacyGateway as never);

    await service.updateOrder(7, { shipmentType: "warehouse" }, { id: 1 } as never);

    expect(legacyGateway.updateOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        deliveryBy: 1,
        shippedFromInventory: true,
        shipmentType: "warehouse",
        toBeCollected: 1810,
      }),
      { id: 1 },
    );
  });

  it("uses deliveryBy as the source of truth when switching from homix to vendor delivery", async () => {
    const repository = {
      findOrderEntity: jest.fn().mockResolvedValue({
        deliveryBy: 1,
        shippedFromInventory: true,
        shipmentType: "warehouse",
      }),
    } as never;
    const legacyGateway = {
      updateOrder: jest.fn().mockResolvedValue({ data: { id: 7 }, status: true }),
    };
    const service = new OrderService(repository, legacyGateway as never);

    await service.updateOrder(7, { deliveryBy: 2 }, { id: 1 } as never);

    expect(legacyGateway.updateOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        deliveryBy: 2,
        shippedFromInventory: false,
      }),
      { id: 1 },
    );
  });

  it("sets deliveryDate automatically when updating an order to delivered without one", async () => {
    const repository = {
      findOrderEntity: jest.fn().mockResolvedValue({
        deliveryDate: null,
        deliveryBy: 2,
        downPayment: 100,
        shipmentType: "separate",
        shippedFromInventory: false,
        shippingFees: 60,
        status: 2,
        subTotalPrice: 2000,
        totalDiscounts: 150,
      }),
    } as never;
    const legacyGateway = {
      updateOrder: jest.fn().mockResolvedValue({ data: { id: 7 }, status: true }),
    };
    const service = new OrderService(repository, legacyGateway as never);

    await service.updateOrder(7, { status: 5 }, { id: 1 } as never);

    expect(legacyGateway.updateOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        deliveryDate: expect.any(String),
        status: 5,
      }),
      { id: 1 },
    );
  });

  it("recalculates amount to collect from edited line items when discounts are cleared", async () => {
    const repository = {
      findOrderEntity: jest.fn().mockResolvedValue({
        deliveryBy: 2,
        downPayment: 100,
        shipmentType: "separate",
        shippedFromInventory: false,
        shippingFees: 60,
        subTotalPrice: 2000,
        totalDiscounts: 150,
      }),
    } as never;
    const legacyGateway = {
      updateOrder: jest.fn().mockResolvedValue({ data: { id: 7 }, status: true }),
    };
    const service = new OrderService(repository, legacyGateway as never);

    await service.updateOrder(7, {
      line_items: [{ price: 1000, quantity: 2 }],
    }, { id: 1 } as never);

    expect(legacyGateway.updateOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        subTotalPrice: 2000,
        totalDiscounts: 0,
        totalPrice: 2000,
        toBeCollected: 1960,
      }),
      { id: 1 },
    );
  });

  it("recalculates amount to collect when the edited sale price is sent as totalPrice", async () => {
    const repository = {
      findOrderEntity: jest.fn().mockResolvedValue({
        deliveryBy: 2,
        downPayment: 100,
        shipmentType: "separate",
        shippedFromInventory: false,
        shippingFees: 60,
        subTotalPrice: 2000,
        totalDiscounts: 150,
        totalPrice: 1850,
      }),
    } as never;
    const legacyGateway = {
      updateOrder: jest.fn().mockResolvedValue({ data: { id: 7 }, status: true }),
    };
    const service = new OrderService(repository, legacyGateway as never);

    await service.updateOrder(7, { totalPrice: 3000 }, { id: 1 } as never);

    expect(legacyGateway.updateOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        subTotalPrice: 3150,
        totalDiscounts: 150,
        totalPrice: 3000,
        toBeCollected: 2960,
      }),
      { id: 1 },
    );
  });

  it("preserves edited orderSource on update", async () => {
    const repository = {
      findOrderEntity: jest.fn().mockResolvedValue({
        deliveryBy: 2,
        downPayment: 100,
        orderSource: 1,
        shipmentType: "separate",
        shippedFromInventory: false,
        shippingFees: 60,
        subTotalPrice: 2000,
        totalDiscounts: 150,
      }),
    } as never;
    const legacyGateway = {
      updateOrder: jest.fn().mockResolvedValue({ data: { id: 7 }, status: true }),
    };
    const service = new OrderService(repository, legacyGateway as never);

    await service.updateOrder(7, { orderSource: 2 }, { id: 1 } as never);

    expect(legacyGateway.updateOrder).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        orderSource: 2,
      }),
      { id: 1 },
    );
  });

  it.each([
    { deliveryBy: 1, shippedFromInventory: true },
    { deliveryBy: 2, shippedFromInventory: false },
  ])("synchronizes bulk delivery updates for deliveryBy $deliveryBy", async ({ deliveryBy, shippedFromInventory }) => {
    const repository = {
      findOrderEntities: jest.fn().mockResolvedValue([]),
    } as never;
    const legacyGateway = {
      bulkUpdate: jest.fn().mockResolvedValue({ message: "ok", status: true }),
    };
    const service = new OrderService(repository, legacyGateway as never);

    await service.bulkUpdate(
      { orderData: { deliveryBy }, orderIds: [7] },
      { id: 1 } as never,
    );

    expect(legacyGateway.bulkUpdate).toHaveBeenCalledWith(
      {
        orderData: { deliveryBy, shippedFromInventory },
        orderIds: [7],
      },
      { id: 1 },
    );
  });
});

describe("restrictVendorOrderPayload", () => {
  const vendorUser = { id: 7, userType: "2" } as never;
  const adminUser = { id: 1, userType: "1" } as never;

  const fullPayload = {
    commission: 50,
    deliveryBy: 2,
    deliveryStatus: 3,
    manufactureStatus: 3,
    notes: "جاهز",
    priority: 3,
    shippingFees: 100,
    status: 5,
    totalPrice: 999,
    userId: 42,
  };

  it("keeps only manufacturing progress fields for a vendor", () => {
    expect(restrictVendorOrderPayload(fullPayload, vendorUser)).toEqual({
      manufactureStatus: 3,
      notes: "جاهز",
    });
  });

  it("drops the fields Homix owns even when a vendor sends them directly", () => {
    const scoped = restrictVendorOrderPayload(fullPayload, vendorUser);

    for (const ownedField of ["status", "deliveryStatus", "priority", "userId", "deliveryBy", "shippingFees", "commission", "totalPrice"]) {
      expect(scoped).not.toHaveProperty(ownedField);
    }
  });

  it("leaves non-vendor payloads untouched", () => {
    expect(restrictVendorOrderPayload(fullPayload, adminUser)).toEqual(fullPayload);
  });
});
