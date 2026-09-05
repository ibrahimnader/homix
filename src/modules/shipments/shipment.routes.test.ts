import express from "express";
import { Op } from "sequelize";
import request from "supertest";

// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const ExcelJS = require("exceljs");

const binaryParser = (response: any, callback: (error: Error | null, body: any) => void): void => {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Uint8Array) => chunks.push(Buffer.from(chunk)));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", callback);
};

let mockAuthenticatedUser: Record<string, unknown> = { id: 1, userType: "1" };

const orderModel = {
  count: jest.fn(),
  findAll: jest.fn(),
  findAndCountAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
};

const productModel = {
  findAll: jest.fn(),
  findByPk: jest.fn(),
};

const shipmentInventoryModel = {
  count: jest.fn(),
  create: jest.fn(),
  findAll: jest.fn(),
  findAndCountAll: jest.fn(),
  findByPk: jest.fn(),
};

const shipmentExpenseModel = {
  count: jest.fn(),
  create: jest.fn(),
  findAll: jest.fn(),
  findByPk: jest.fn(),
};

const shipmentReturnModel = {
  create: jest.fn(),
  findAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
};

const shippingCompanyModel = {
  create: jest.fn(),
  findAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
};

const legacyShipmentService = {
  exportShipments: jest.fn(async (_res: express.Response, _payload: Record<string, unknown>) => undefined),
};

const legacyOrderService = {
  saveImportedOrders: jest.fn().mockResolvedValue(undefined),
};

const sequelizeQuery = jest.fn();
const sequelizeTransaction = jest.fn(async (callback: (transaction: { LOCK: { UPDATE: string } }) => unknown) =>
  callback({ LOCK: { UPDATE: "UPDATE" } }));
const mockListManagedOptions = jest.fn(async (group: string) => group === "expense_type"
  ? [{ id: 1, label: "شحن" }, { id: 2, label: "تغليف" }, { id: 4, label: "إيجار مخزن" }]
  : []);
const mockReplaceManagedOptions = jest.fn(async (_group: string, options: Array<{ id?: number; label: string }>) =>
  options.map((option, index) => ({ id: option.id ?? index + 1, label: option.label })));

jest.mock("../../../app/middlewares/protectApi", () => {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = mockAuthenticatedUser as never;
    req.vendorId = null;
    next();
  };
});

jest.mock("../../../app/middlewares/isNotVendor", () => {
  return (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
});

jest.mock("../../infrastructure/database", () => ({
  sequelize: {
    col: jest.fn((value: string) => value),
    fn: jest.fn((...args: string[]) => args.join(".")),
    query: sequelizeQuery,
    transaction: sequelizeTransaction,
    where: jest.fn((_left: unknown, right: unknown) => right),
  },
}));

jest.mock("../../../app/modules/order/order.model", () => orderModel);
jest.mock("../../../app/modules/orderLines/orderline.model", () => ({}));
jest.mock("../../../app/modules/product/product.model", () => productModel);
jest.mock("../../../app/modules/shipments/shipmentInventory.model", () => shipmentInventoryModel);
jest.mock("../../../app/modules/shipments/shipmentExpense.model", () => shipmentExpenseModel);
jest.mock("../../../app/modules/shipments/shipmentReturn.model", () => shipmentReturnModel);
jest.mock("../../../app/modules/shipments/shippingCompany.model", () => shippingCompanyModel);
jest.mock("../../../app/modules/vendor/vendor.model", () => ({}));
jest.mock("../../../app/modules/customer/customer.model", () => ({}));
jest.mock("../../../app/modules/notes/notes.model", () => ({
  create: jest.fn(),
  findByPk: jest.fn(),
}));
jest.mock("../../../app/modules/user/user.model", () => ({
  findAll: jest.fn(),
}));
jest.mock("../../../app/modules/logs/log.model", () => ({
  create: jest.fn(),
  findAll: jest.fn().mockResolvedValue([
    {
      action: "create",
      createdAt: "2026-05-12T09:05:00.000Z",
      field: "order_received",
      id: 401,
    },
  ]),
}));
jest.mock("../../../app/modules/product/productType.model", () => ({}));
jest.mock("../../../app/modules/shipments/shipment.service", () => legacyShipmentService);
jest.mock("../../../app/modules/order/order.service", () => legacyOrderService);
jest.mock("../dashboard/dashboard-aggregate.service", () => ({
  DashboardAggregateService: jest.fn().mockImplementation(() => ({
    refreshRange: jest.fn(),
  })),
}));
jest.mock("../settings/managed-options", () => ({
  MANAGED_OPTION_GROUP: {
    EXPENSE_TYPE: "expense_type",
    TICKET_QUICK_REPLY: "ticket_quick_reply",
    TICKET_TYPE: "ticket_type",
  },
  getManagedOptionLabels: jest.fn(async () => ({ 1: "شحن", 2: "تغليف", 4: "إيجار مخزن" })),
  listManagedOptions: mockListManagedOptions,
  replaceManagedOptions: mockReplaceManagedOptions,
}));

import { errorMiddleware } from "../../shared/http";
import { shipmentRouter } from "./shipment.routes";

const noteModel = jest.requireMock("../../../app/modules/notes/notes.model") as {
  create: jest.Mock;
  findByPk: jest.Mock;
};
const userModel = jest.requireMock("../../../app/modules/user/user.model") as {
  findAll: jest.Mock;
};
const logModel = jest.requireMock("../../../app/modules/logs/log.model") as {
  create: jest.Mock;
  findAll: jest.Mock;
};

const app = express();
app.set("query parser", "extended");
app.use(express.json());
app.use("/shipments", shipmentRouter);
app.use(errorMiddleware);

const makeShipment = (overrides: Record<string, unknown> = {}) => ({
  code: "3002",
  customer: {
    address: "الهرم, الجيزة",
    firstName: "عبير",
    lastName: "ابوالمجيد",
    phoneNumber: "01155559646",
  },
  deliveryBy: 1,
  deliveryStatus: 2,
  deliveryDate: "2026-05-17T00:00:00.000Z",
  expectedDeliveryDate: "2026-05-17T00:00:00.000Z",
  governorate: "الجيزة",
  id: 9802,
  priority: 2,
  notes: "shipment note",
  orderSource: 1,
  scheduleStatus: 1,
  notesList: [
    {
      createdAt: "2026-05-15T11:00:00.000Z",
      id: 18,
      text: "الشحنة متأخرة عن الموعد المحدد",
      user: { firstName: "Ahmed", lastName: "Hesham" },
    },
  ],
  orderLines: [
    {
      color: "رمادي",
      price: "16999",
      product: {
        image: "https://example.com/product.png",
        title: "كنبة شيب",
        type: { name: "غرفة نوم" },
        variants: [{ inventory_quantity: 3, option1: "200x300", option2: "رمادي", sku: "RKA-002" }],
        vendor: { name: "ركنة للأثاث" },
      },
      quantity: 1,
      size: "200x300",
      sku: "RKA-002",
      title: "كنبة شيب",
    },
  ],
  orderNumber: "31667",
  paymentStatus: 1,
  shippingCompany: "J&T",
  shipmentStatus: 2,
  shipmentType: "grouped",
  shippingCompanyRecord: {
    id: 3,
    name: "J&T",
  },
  shippingFees: "65",
  shippingReceiveDate: "2026-05-12T00:00:00.000Z",
  toBeCollected: "29998",
  totalPrice: "29998",
  userId: 1,
  updatedAt: "2026-05-15T12:00:00.000Z",
  ...overrides,
});

const makeShipmentRecord = (overrides: Record<string, unknown> = {}) => {
  const state = { ...makeShipment(), ...overrides };

  return {
    toJSON: () => ({ ...state }),
    update: jest.fn(async (payload: Record<string, unknown>) => {
      Object.assign(state, payload);
    }),
  };
};

describe("shipmentRouter", () => {
  beforeEach(() => {
    mockAuthenticatedUser = { id: 1, userType: "1" };
    jest.clearAllMocks();
    sequelizeQuery.mockResolvedValue([]);
    orderModel.count
      .mockResolvedValueOnce(156)
      .mockResolvedValueOnce(11)
      .mockResolvedValueOnce(7);
    orderModel.findAll.mockResolvedValue([makeShipment()]);
    orderModel.findAndCountAll.mockResolvedValue({ count: 1, rows: [makeShipment()] });
    orderModel.findOne.mockResolvedValue(makeShipment());
    orderModel.findByPk.mockImplementation(async (id: number) => makeShipmentRecord({ id }));
    noteModel.create.mockResolvedValue({
      createdAt: "2026-05-15T11:00:00.000Z",
      id: 18,
      text: "",
      updatedAt: "2026-05-15T11:00:00.000Z",
      user: { firstName: "Ahmed", id: 1, lastName: "Hesham" },
    });
    userModel.findAll.mockResolvedValue([{ firstName: "Ahmed", id: 1, lastName: "Hesham" }]);
    noteModel.findByPk.mockResolvedValue(null);
    shipmentReturnModel.findAll.mockResolvedValue([]);
    logModel.findAll.mockResolvedValue([
      {
        action: "create",
        createdAt: "2026-05-12T09:05:00.000Z",
        field: "order_received",
        id: 401,
      },
    ]);
    shipmentInventoryModel.count.mockResolvedValue(42);
    shipmentExpenseModel.count.mockResolvedValue(89);
    shipmentReturnModel.findOne.mockResolvedValue(null);
    shipmentReturnModel.create.mockResolvedValue({
      toJSON: () => ({
        completedAt: null,
        id: 41,
        orderId: 9802,
        reason: "منتج تالف",
        returnDate: "2026-05-18T00:00:00.000Z",
        returnType: 1,
        startedAt: "2026-05-18T00:00:00.000Z",
        status: 2,
      }),
    });
    shipmentReturnModel.findByPk.mockImplementation(async () => {
      const state = {
        completedAt: null as string | null,
        id: 41,
        orderId: 9802,
        reason: "منتج تالف",
        returnDate: "2026-05-18T00:00:00.000Z",
        returnType: 1,
        startedAt: "2026-05-18T00:00:00.000Z",
        status: 2,
      };

      return {
        toJSON: () => ({ ...state }),
        update: jest.fn(async (payload: Record<string, unknown>) => {
          Object.assign(state, payload);
        }),
      };
    });
    shippingCompanyModel.findAll.mockResolvedValue([
      {
        createdAt: "2026-06-20T10:00:00.000Z",
        id: 3,
        name: "J&T",
        updatedAt: "2026-06-20T10:00:00.000Z",
      },
    ]);
    shippingCompanyModel.findByPk.mockImplementation(async (id: number) => {
      if (id === 999) {
        return null;
      }

      const state = {
        createdAt: "2026-06-20T10:00:00.000Z",
        id,
        name: id === 4 ? "DHL" : "J&T",
        updatedAt: "2026-06-20T10:00:00.000Z",
      };

      return {
        destroy: jest.fn(async () => undefined),
        toJSON: () => ({ ...state }),
        update: jest.fn(async (payload: Record<string, unknown>) => {
          Object.assign(state, payload);
        }),
      };
    });
    shippingCompanyModel.findOne.mockResolvedValue(null);
    shippingCompanyModel.create.mockResolvedValue({
      createdAt: "2026-06-20T10:00:00.000Z",
      id: 4,
      name: "DHL",
      updatedAt: "2026-06-20T10:00:00.000Z",
    });
    const inventoryRows = [
      {
        color: "أبيض",
        costPrice: "2800",
        id: 5,
        product: {
          image: "https://example.com/product.png",
          title: "دريسينج مودرن",
          variants: [{ option1: "50x120", option2: "أبيض", sku: "DRS-102" }],
          vendor: { name: "دريسينج هاوس" },
          vendorId: 22,
        },
        productId: 321,
        productCode: "DRS-102",
        quantity: 2,
        status: 1,
      },
    ];
    shipmentInventoryModel.findAll.mockResolvedValue(inventoryRows);
    shipmentInventoryModel.findAndCountAll.mockResolvedValue({ count: inventoryRows.length, rows: inventoryRows });
    shipmentInventoryModel.create.mockResolvedValue({
      setDataValue: jest.fn(),
      toJSON: () => ({
        color: "أبيض",
        costPrice: "2800",
        id: 6,
        product: {
          image: "https://example.com/new-product.png",
          title: "منتج جديد",
          variants: [{ option1: "100x100", option2: "أبيض", sku: "NEW-1" }],
          vendor: { name: "بائع جديد" },
          vendorId: 12,
        },
        productCode: "NEW-1",
        productId: 555,
        quantity: 1,
        status: 1,
      }),
    });
    productModel.findByPk.mockResolvedValue({
      toJSON: () => ({
        id: 555,
        image: "https://example.com/new-product.png",
        title: "منتج جديد",
        variants: [{ option1: "100x100", option2: "أبيض", sku: "NEW-1" }],
        vendor: { name: "بائع جديد" },
        vendorId: 12,
      }),
    });
    shipmentExpenseModel.findAll.mockResolvedValue([
      {
        accountingDate: "2026-05-10T00:00:00.000Z",
        accountingStatus: 1,
        amount: "330",
        id: 8,
        reason: "شحن شحنات خارج القاهرة",
        type: 1,
      },
    ]);
    shipmentExpenseModel.create.mockResolvedValue({
      accountingDate: "2026-05-11T00:00:00.000Z",
      accountingStatus: 1,
      amount: "150",
      id: 9,
      reason: "مواد تغليف",
      type: 2,
    });
    shippingCompanyModel.findAll.mockResolvedValue([
      {
        createdAt: "2026-05-01T00:00:00.000Z",
        id: 3,
        name: "J&T",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ]);
    shippingCompanyModel.findOne.mockResolvedValue(null);
    shippingCompanyModel.findByPk.mockImplementation(async (id: number) => {
      if (id === 3) {
        const state = {
          createdAt: "2026-05-01T00:00:00.000Z",
          id: 3,
          name: "J&T",
          updatedAt: "2026-05-01T00:00:00.000Z",
        };

        return {
          destroy: jest.fn(),
          toJSON: () => ({ ...state }),
          update: jest.fn(async (payload: Record<string, unknown>) => {
            Object.assign(state, payload);
          }),
        };
      }

      return null;
    });
    shippingCompanyModel.create.mockImplementation(async ({ name }: { name: string }) => ({
      toJSON: () => ({
        createdAt: "2026-05-01T00:00:00.000Z",
        id: 4,
        name,
        updatedAt: "2026-05-01T00:00:00.000Z",
      }),
    }));
  });

  it("returns shipments metadata", async () => {
    const response = await request(app).get("/shipments/meta");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.tabs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "shipments", label: "الشحنات" })]),
    );
    expect(response.body.data.subTabCounts).toEqual(expect.objectContaining({
      accountDeliveries: expect.any(Number),
      accountExpenses: expect.any(Number),
      customerReturns: expect.any(Number),
      vendorReturns: expect.any(Number),
    }));
    expect(response.body.data.shipmentTypes).toEqual([
      { id: "grouped", label: "شحن مجمع" },
      { id: "separate", label: "شحن منفصل" },
    ]);
    expect(response.body.data.shipmentStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 11, label: "شحنة مجدولة" }),
        expect.objectContaining({ id: 12, label: "خرجت للتوصيل" }),
      ]),
    );
    expect(response.body.data.inventoryStatuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "متوفر بالمخزون" })]),
    );
    expect(response.body.data.vendorReturnStatuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "تم إبلاغ المورد" })]),
    );
    expect(response.body.data.customerReturnStatuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "تم السحب" })]),
    );
    expect(response.body.data.accountingStatuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "تم التصفية" })]),
    );
    expect(response.body.data.expenseTypes).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "إيجار مخزن" })]),
    );
    expect(response.body.data.governorates).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "الجيزة" })]),
    );
    expect(response.body.data.shippingCompanies).toEqual([
      { id: 3, label: "J&T" },
    ]);
    expect(response.body.data.scheduleStatuses).toEqual([
      { id: 1, label: "مجدول" },
      { id: 2, label: "لا يوجد رد" },
      { id: 3, label: "مؤجل" },
      { id: 4, label: "الغاء تأخير في التوصيل" },
      { id: 5, label: "الغاء تغيير رأي" },
      { id: 6, label: "الغاء لا يوجد رد" },
      { id: 7, label: "إعادة الاتصال لاحقا" },
    ]);
    expect(response.body.data.orderSources).toEqual([
      { id: 1, label: "شو رووم" },
      { id: 2, label: "اونلاين" },
    ]);
    expect(response.body.data.priorities).toEqual([
      { id: 1, label: "بالمدة" },
      { id: 2, label: "مستعجل" },
      { id: 3, label: "مستعجل جدا" },
    ]);
  });

  it("creates shipments through the TS service boundary", async () => {
    const payload = {
      customer: {
        firstName: "عبير",
        lastName: "ابوالمجيد",
      },
      deliveryBy: 1,
      deliveryDate: "2026-06-20T00:00:00.000Z",
      governorate: "الجيزة",
      line_items: [
        {
          price: 16999,
          product_id: "shopify-product-1",
          quantity: 1,
          title: "كنبة شيب",
          variant_id: 445566,
        },
      ],
      name: "#H9802",
      scheduleStatus: 1,
      shipmentStatus: 2,
      shipmentType: "grouped",
      shippingCompany: 3,
      shippingFees: 65,
      shippingReceiveDate: "2026-06-18T00:00:00.000Z",
      toBeCollected: 29998,
    };
    const response = await request(app).post("/shipments").send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "Shipment created successfully", status: true });
    expect(legacyOrderService.saveImportedOrders).toHaveBeenCalledWith([
      expect.objectContaining({
        ...payload,
        deliveryBy: 1,
        shippingCompany: "J&T",
        shippedFromInventory: true,
        toBeCollected: 17064,
      }),
    ], true);
  });

  it("defaults shipment type to separate when omitted", async () => {
    const payload = {
      customer: {
        firstName: "عبير",
        lastName: "ابوالمجيد",
      },
      line_items: [
        {
          price: 16999,
          quantity: 1,
          title: "كنبة شيب",
          variant_id: 445566,
        },
      ],
      name: "#H9803",
    };

    const response = await request(app).post("/shipments").send(payload);

    expect(response.status).toBe(200);
    expect(legacyOrderService.saveImportedOrders).toHaveBeenCalledWith([
      expect.objectContaining({
        ...payload,
        deliveryBy: 1,
        toBeCollected: 16999,
      }),
    ], true);
  });

  it("lists shipping companies", async () => {
    orderModel.count.mockReset();
    orderModel.count.mockResolvedValue([{ count: 5, shippingCompany: "J&T" }]);

    const response = await request(app).get("/shipments/shipping-companies");

    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([
      expect.objectContaining({ id: 3, linkedOrdersCount: 5, name: "J&T" }),
    ]);
  });

  it("creates a shipping company", async () => {
    const response = await request(app).post("/shipments/shipping-companies").send({ name: "DHL" });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({ id: 4, name: "DHL" }));
  });

  it("adds an empty shipment note", async () => {
    const response = await request(app)
      .post("/shipments/9802/notes")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.text).toBe("");
  });

  it("updates a shipping company and syncs linked orders", async () => {
    const response = await request(app).put("/shipments/shipping-companies/3").send({ name: "J&T Express" });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({ id: 3, name: "J&T Express" }));
    expect(orderModel.update).toHaveBeenCalledTimes(1);
    expect(orderModel.update.mock.calls[0]?.[0]).toEqual({ shippingCompany: "J&T Express" });
    expect(orderModel.update.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ where: expect.any(Object) }));
  });

  it("deletes an unused shipping company", async () => {
    orderModel.count.mockReset();
    orderModel.count.mockResolvedValue(0);

    const response = await request(app).delete("/shipments/shipping-companies/3");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      linkedOrdersCount: 0,
      message: "Shipping company deleted successfully",
      status: true,
    });
  });

  it("removes a deleted shipping company from linked orders", async () => {
    orderModel.count.mockReset();
    orderModel.count.mockResolvedValue(4);

    const response = await request(app).delete("/shipments/shipping-companies/3");

    expect(response.status).toBe(200);
    expect(response.body.linkedOrdersCount).toBe(4);
    expect(orderModel.update).toHaveBeenCalledWith(
      { shippingCompany: null },
      expect.objectContaining({
        transaction: expect.any(Object),
        where: { shippingCompany: "J&T" },
      }),
    );
  });

  it("rejects shipment creation payloads without line items", async () => {
    const response = await request(app).post("/shipments").send({ shipmentNumber: "SH-9802" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects shipment creation payloads without usable customer data", async () => {
    const response = await request(app).post("/shipments").send({
      customer: {},
      line_items: [{ price: 16999, quantity: 1, title: "كنبة شيب", variant_id: 445566 }],
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns the shipments list", async () => {
    const response = await request(app).get("/shipments").query({ page: 1, size: 20 });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.items[0]).toEqual(
      expect.objectContaining({
        assigneeId: 1,
        customerName: "عبير ابوالمجيد",
        deliveryBy: 1,
        deliveryByLabel: "هوميكس",
        deliveryStatus: 3,
        deliveryPriority: 2,
        deliveryPriorityLabel: "مستعجل",
        priority: 2,
        priorityLabel: "مستعجل",
        operationNumber: "3002",
        orderSource: 1,
        orderSourceLabel: "شو رووم",
        scheduleStatus: 1,
        scheduleStatusLabel: "مجدول",
        shippingCompany: 3,
        shippingCompanyName: "J&T",
        shipmentNumber: "SH31667",
        shipmentStatusLabel: "في المخزن",
        shipmentTypeLabel: "شحن مجمع",
      }),
    );
  });

  it("forwards shipment export requests to the legacy exporter", async () => {
    legacyShipmentService.exportShipments.mockImplementation(async (res: express.Response) => {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.status(200).end("ok");
    });

    const response = await request(app).get("/shipments/export").query({
      sort: { orderDate: -1 },
      orderNumber: "31667",
      governorate: "__blank__",
      scheduleStatus: "__blank__",
      startDate: "2026-05-01",
      endDate: "2026-05-02",
    });

    expect(response.status).toBe(200);
    expect(legacyShipmentService.exportShipments).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        endDate: "2026-05-02",
        governorate: "__blank__",
        orderNumber: "31667",
        scheduleStatus: "__blank__",
        sort: { orderDate: -1 },
        startDate: "2026-05-01",
      }),
    );
    expect(String(response.headers["content-type"])).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("allows logistics users with shipment view access to export shipments", async () => {
    mockAuthenticatedUser = {
      id: 4,
      permissions: { ship_view: true },
      userType: "4",
    };
    legacyShipmentService.exportShipments.mockImplementation(async (res: express.Response) => {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.status(200).end("ok");
    });

    const response = await request(app).get("/shipments/export");

    expect(response.status).toBe(200);
    expect(legacyShipmentService.exportShipments).toHaveBeenCalled();
  });

  it("rejects invalid shipment export date filters", async () => {
    const response = await request(app).get("/shipments/export").query({
      startDate: "not-a-date",
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("filters shipments by schedule status", async () => {
    const response = await request(app).get("/shipments").query({ page: 1, scheduleStatus: "1", size: 20 });

    expect(response.status).toBe(200);
    const whereClause = orderModel.findAndCountAll.mock.calls[0][0].where as Record<PropertyKey, unknown>;
    const andKey = Object.getOwnPropertySymbols(whereClause)[0];
    const conditions = andKey && Array.isArray(whereClause[andKey])
      ? whereClause[andKey] as Array<Record<PropertyKey, unknown>>
      : [];

    expect(conditions).toContainEqual(
      expect.objectContaining({
        logic: expect.objectContaining({
          [Op.in]: [1],
        }),
      }),
    );
  });

  it("filters shipments with no schedule status", async () => {
    const response = await request(app).get("/shipments").query({ page: 1, scheduleStatus: "__blank__", size: 20 });

    expect(response.status).toBe(200);
    const whereClause = orderModel.findAndCountAll.mock.calls[0][0].where as Record<PropertyKey, unknown>;
    const conditions = whereClause[Op.and] as Array<{ logic?: Record<PropertyKey, unknown> }>;
    expect(conditions).toContainEqual(expect.objectContaining({
      logic: expect.objectContaining({ [Op.is]: null }),
    }));
  });

  it("filters shipments with no governorate", async () => {
    const response = await request(app).get("/shipments").query({ governorate: "__blank__", page: 1, size: 20 });

    expect(response.status).toBe(200);
    const whereClause = orderModel.findAndCountAll.mock.calls[0][0].where as Record<PropertyKey, unknown>;
    const conditions = whereClause[Op.and] as Array<Record<PropertyKey, unknown>>;
    const blankGovernorate = conditions.find((condition) => {
      const alternatives = condition[Op.or] as Array<{ logic?: Record<PropertyKey, unknown> }> | undefined;
      return Array.isArray(alternatives)
        && alternatives.some((alternative) => alternative.logic?.[Op.is] === null)
        && alternatives.some((alternative) => alternative.logic?.[Op.eq] === "");
    });
    expect(blankGovernorate?.[Op.or]).toEqual(expect.arrayContaining([
      expect.objectContaining({ logic: expect.objectContaining({ [Op.is]: null }) }),
      expect.objectContaining({ logic: expect.objectContaining({ [Op.eq]: "" }) }),
    ]));
  });

  it("filters shipments by shipping company id", async () => {
    const response = await request(app).get("/shipments").query({
      page: 1,
      shippingCompany: "3,4",
      size: 20,
    });

    expect(response.status).toBe(200);
    const whereClause = orderModel.findAndCountAll.mock.calls[0][0].where as Record<PropertyKey, unknown>;
    const conditions = whereClause[Op.and] as Array<{ logic?: Record<PropertyKey, unknown> }>;
    expect(conditions).toContainEqual(expect.objectContaining({
      logic: expect.objectContaining({ [Op.in]: [3, 4] }),
    }));
  });

  it("accepts multiple shipment types", async () => {
    const response = await request(app).get("/shipments").query({
      page: 1,
      shipmentType: "grouped,separate",
      size: 20,
    });

    expect(response.status).toBe(200);
    const whereClause = orderModel.findAndCountAll.mock.calls[0][0].where as Record<PropertyKey, unknown>;
    const conditions = whereClause[Op.and] as Array<{ logic?: Record<PropertyKey, unknown> }>;
    expect(conditions).toContainEqual(expect.objectContaining({
      logic: expect.objectContaining({ [Op.in]: ["grouped", "separate"] }),
    }));
  });

  it("filters shipments by manual priority", async () => {
    orderModel.findAndCountAll.mockResolvedValue({ count: 1, rows: [
      makeShipment({
        id: 9802,
        priority: 2,
      }),
    ] });

    const response = await request(app).get("/shipments").query({ page: 1, priority: "2", size: 20 });

    expect(response.status).toBe(200);
    expect(response.body.data.totalCount).toBe(1);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toEqual(expect.objectContaining({ deliveryPriority: 2, id: 9802 }));
  });

  it("filters shipments by automated delivery status derived from expectedDeliveryDate", async () => {
    orderModel.findAndCountAll.mockResolvedValue({ count: 1, rows: [
      makeShipment({
        expectedDeliveryDate: "2026-05-17T00:00:00.000Z",
        id: 9802,
      }),
    ] });

    const response = await request(app).get("/shipments").query({ deliveryStatus: "3", page: 1, size: 20 });

    expect(response.status).toBe(200);
    expect(orderModel.findAndCountAll).toHaveBeenCalled();
    expect(response.body.data.totalCount).toBe(1);
    expect(response.body.data.items[0]).toEqual(expect.objectContaining({
      deliveryStatus: 3,
      id: 9802,
    }));
  });

  it("sorts shipments by totalPrice in the database query", async () => {
    const response = await request(app).get("/shipments").query({ page: 1, size: 20, sort: { totalPrice: -1 } });

    expect(response.status).toBe(200);
    expect(orderModel.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      order: [["totalPrice", "DESC"]],
    }));
  });

  it("sorts shipments by newest creation date by default", async () => {
    const response = await request(app).get("/shipments").query({ page: 1, size: 20 });

    expect(response.status).toBe(200);
    expect(orderModel.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      order: [["createdAt", "DESC"]],
    }));
  });

  it("sorts shipments by manual priority in the database query", async () => {
    orderModel.findAndCountAll.mockResolvedValue({ count: 2, rows: [
      makeShipment({ code: "3004", id: 9804, orderNumber: "31669", priority: 3 }),
      makeShipment({ code: "3003", id: 9803, orderNumber: "31668", priority: 1 }),
    ] });

    const response = await request(app).get("/shipments").query({ page: 1, size: 20, sort: { priority: -1 } });

    expect(response.status).toBe(200);
    expect(orderModel.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      order: [["priority", "DESC"]],
    }));
    expect(response.body.data.items.map((item: { orderNumber: string }) => item.orderNumber)).toEqual(["31669", "31668"]);
  });

  it("accepts ISO date filters for shipments list", async () => {
    const response = await request(app)
      .get("/shipments")
      .query({
        endDate: "2026-06-17T21:00:00.000Z",
        page: 1,
        size: 20,
        startDate: "2026-06-17T21:00:00.000Z",
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
  });

  it("rejects invalid shipment date filters with validation error", async () => {
    const response = await request(app)
      .get("/shipments")
      .query({ page: 1, size: 20, startDate: "not-a-date" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns shipment details in the new frontend shape", async () => {
    const response = await request(app).get("/shipments/9802");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.customer.name).toBe("عبير ابوالمجيد");
    expect(response.body.data.products[0].productCode).toBe("RKA-002");
    expect(response.body.data.shipment.assigneeId).toBe(1);
    expect(response.body.data.shipment.deliveryBy).toBe(1);
    expect(response.body.data.shipment.deliveryByLabel).toBe("هوميكس");
    expect(response.body.data.shipment.deliveryStatus).toBe(3);
    expect(response.body.data.shipment.priority).toBe(2);
    expect(response.body.data.shipment.priorityLabel).toBe("مستعجل");
    expect(response.body.data.shipment.shippedFromInventory).toBe(false);
    expect(response.body.data.shipment.shippingCompany).toBe(3);
    expect(response.body.data.shipment.shippingCompanyName).toBe("J&T");
    expect(response.body.data.products[0].variant).toEqual(expect.objectContaining({
      color: "رمادي",
      id: "",
      price: 0,
      size: "200x300",
      sku: "RKA-002",
    }));
    expect(response.body.data.timeline[0].message).toBe("تم استلام الطلب");
  });

  it("returns automated deliveryStatus in shipment details based on expectedDeliveryDate", async () => {
    orderModel.findOne.mockResolvedValue(makeShipment({
      deliveryStatus: 3,
      expectedDeliveryDate: "2099-05-17T00:00:00.000Z",
    }));

    const response = await request(app).get("/shipments/9802");

    expect(response.status).toBe(200);
    expect(response.body.data.shipment.deliveryStatus).toBe(1);
  });

  it("renders shipment timeline updates with Arabic field/value labels", async () => {
    logModel.findAll.mockResolvedValueOnce([
      {
        action: "update",
        createdAt: "2026-07-20T01:00:00.000Z",
        field: "paymentStatus",
        id: 501,
        to: "1",
        userId: 1,
      },
      {
        action: "update",
        createdAt: "2026-07-20T01:05:00.000Z",
        field: "shippedFromInventory",
        id: 502,
        to: "true",
        userId: 1,
      },
    ]);

    const response = await request(app).get("/shipments/9802");

    expect(response.status).toBe(200);
    expect(response.body.data.timeline[0].message).toBe("تم تحديث حالة الدفع إلى الدفع عند الاستلام");
    expect(response.body.data.timeline[0].userName).toBe("Ahmed Hesham");
    expect(response.body.data.timeline[1].message).toBe("تم تحديث الشحن من المخزون إلى نعم");
    expect(response.body.data.timeline[1].userName).toBe("Ahmed Hesham");
  });

  it("returns vendor returns list", async () => {
    const response = await request(app).get("/shipments/returns/vendor").query({ page: 1, size: 20 });

    expect(response.status).toBe(200);
    expect(response.body.data.items[0]).toEqual(
      expect.objectContaining({
        operationNumber: "3002",
        status: 2,
        statusLabel: "تم إبلاغ المورد",
      }),
    );
  });

  it("creates vendor returns through persisted workflow storage", async () => {
    const response = await request(app).post("/shipments/returns/vendor").send({
      orderId: 9802,
      reason: "منتج تالف",
      status: 2,
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        id: 9802,
        orderId: 9802,
        returnType: 1,
        status: 2,
        statusLabel: "تم إبلاغ المورد",
      }),
    );
    expect(orderModel.findByPk).toHaveBeenCalledWith(9802, expect.any(Object));
    const firstFindByPkCall = orderModel.findByPk.mock.results[0];
    expect(firstFindByPkCall).toBeDefined();
    const shipmentRecord = await firstFindByPkCall!.value;
    expect(shipmentRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentStatus: 8 }),
    );
    expect(logModel.create).toHaveBeenCalledWith(expect.objectContaining({
      action: "update",
      entityId: 9802,
      entityType: "order",
      field: "shipmentStatus",
      from: "2",
      to: "8",
      userId: 1,
    }));
  });

  it("updates vendor returns through persisted workflow storage", async () => {
    const shipmentRecord = makeShipmentRecord({ id: 9802, shipmentStatus: 8 });
    orderModel.findByPk.mockImplementation(async () => shipmentRecord);
    shipmentReturnModel.findOne.mockResolvedValue(await shipmentReturnModel.findByPk(41));
    const response = await request(app).put("/shipments/returns/vendor/9802").send({
      status: 3,
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        id: 9802,
        orderId: 9802,
        returnType: 1,
        status: 3,
        statusLabel: "تم التسليم للمورد",
      }),
    );
    expect(shipmentRecord.update).not.toHaveBeenCalled();
  });

  it("logs direct shipment status changes", async () => {
    const shipmentRecord = makeShipmentRecord({ id: 9802, shipmentStatus: 2 });
    orderModel.findByPk.mockResolvedValue(shipmentRecord);

    const response = await request(app).put("/shipments/9802").send({ shipmentStatus: 4 });

    expect(response.status).toBe(200);
    expect(logModel.create).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 9802,
      field: "shipmentStatus",
      from: "2",
      to: "4",
      userId: 1,
    }));
  });

  it("marks the received amount as manual when the user changes it to zero", async () => {
    const shipmentRecord = makeShipmentRecord({
      id: 9802,
      receivedAmount: 500,
      receivedAmountManuallySet: false,
    });
    orderModel.findByPk.mockResolvedValue(shipmentRecord);

    const response = await request(app).put("/shipments/9802").send({ receivedAmount: 0 });

    expect(response.status).toBe(200);
    expect(shipmentRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      receivedAmount: 0,
      receivedAmountManuallySet: true,
    }));
  });

  it("marks an explicitly submitted zero as manual even when the stored value is already zero", async () => {
    const shipmentRecord = makeShipmentRecord({
      id: 9802,
      receivedAmount: 0,
      receivedAmountManuallySet: false,
    });
    orderModel.findByPk.mockResolvedValue(shipmentRecord);

    const response = await request(app).put("/shipments/9802").send({
      receivedAmount: 0,
      shipmentType: "separate",
    });

    expect(response.status).toBe(200);
    expect(shipmentRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      receivedAmount: 0,
      receivedAmountManuallySet: true,
      shipmentType: "separate",
    }));
  });

  it("creates and updates a missing vendor-return row when the list exposed an order id", async () => {
    const shipmentRecord = makeShipmentRecord({ id: 9802, shipmentStatus: 8 });
    const returnState = {
      completedAt: null as Date | null,
      id: 9802,
      orderId: 9802,
      reason: "",
      returnDate: "2026-08-25T00:00:00.000Z",
      returnType: 1,
      startedAt: "2026-08-25T00:00:00.000Z",
      status: 2,
    };
    const updateReturn = jest.fn(async (payload: Record<string, unknown>) => {
      Object.assign(returnState, payload);
    });
    shipmentReturnModel.findByPk.mockResolvedValue(null);
    shipmentReturnModel.create.mockResolvedValue({
      toJSON: () => ({ ...returnState }),
      update: updateReturn,
    });
    orderModel.findByPk.mockResolvedValue(shipmentRecord);

    const response = await request(app).put("/shipments/returns/vendor/9802").send({
      orderId: 9802,
      reason: "تم التواصل مع العميل للتسليم لكن لم يتم الرد",
      returnDate: "2026-08-25T00:00:00.000Z",
      status: 3,
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: 9802,
      orderId: 9802,
      reason: "تم التواصل مع العميل للتسليم لكن لم يتم الرد",
      status: 3,
      statusLabel: "تم التسليم للمورد",
    }));
    expect(shipmentReturnModel.create).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 9802,
      returnType: 1,
    }));
    expect(updateReturn).toHaveBeenCalledWith(expect.objectContaining({
      reason: "تم التواصل مع العميل للتسليم لكن لم يتم الرد",
      status: 3,
    }));
  });

  it("auto-forfeits overdue vendor returns after 12 days", async () => {
    const persistedState = {
      completedAt: null as string | null,
      id: 77,
      orderId: 9802,
      reason: "تأخر المورد في الاستلام",
      returnDate: "2026-05-01T00:00:00.000Z",
      returnType: 1,
      startedAt: "2026-05-01T00:00:00.000Z",
      status: 2,
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const updateMock = jest.fn(async (payload: Record<string, unknown>) => {
      Object.assign(persistedState, payload);
    });
    shipmentReturnModel.findAll.mockResolvedValue([
      {
        toJSON: () => ({ ...persistedState }),
        update: updateMock,
      },
    ]);

    const response = await request(app).get("/shipments/returns/vendor").query({ page: 1, size: 20 });

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 4 }),
    );
    expect(response.body.data.items[0]).toEqual(
      expect.objectContaining({
        id: 9802,
        status: 4,
        statusLabel: "فورفيت",
      }),
    );
  });

  it("returns inventory cards derived from product variants", async () => {
    const response = await request(app).get("/shipments/inventory").query({
      page: 2,
      productCode: "DRS",
      size: 20,
      status: 1,
      vendorName: "دريسينج",
    });

    expect(response.status).toBe(200);
    expect(shipmentInventoryModel.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      distinct: true,
      limit: 20,
      offset: 20,
      where: expect.objectContaining({ status: 1 }),
    }));
    expect(response.body.data.items[0]).toEqual(
      expect.objectContaining({
        productId: 321,
        productCode: "DRS-102",
        productName: "دريسينج مودرن",
        quantity: 2,
        status: 1,
        statusLabel: "متوفر بالمخزون",
        vendorName: "دريسينج هاوس",
      }),
    );
  });

  it("creates manual inventory items", async () => {
    const response = await request(app).post("/shipments/inventory").send({
      costPrice: 2800,
      productId: 555,
      productCode: "NEW-1",
      quantity: 1,
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        id: 6,
        productId: 555,
        productCode: "NEW-1",
        quantity: 1,
      }),
    );
  });

  it("returns performance overview", async () => {
    orderModel.findAll.mockResolvedValueOnce([
      makeShipment({ shipmentStatus: 4 }),
      makeShipment({ id: 9803, shipmentStatus: 5 }),
      makeShipment({ id: 9804, shipmentStatus: 6 }),
      makeShipment({ id: 9805, shipmentStatus: 7 }),
      makeShipment({ id: 9806, shipmentStatus: 8 }),
      makeShipment({ id: 9807, shipmentStatus: 9 }),
      makeShipment({ id: 9808, shipmentStatus: 10 }),
    ]);
    const response = await request(app).get("/shipments/performance").query({ period: "daily" });

    expect(response.status).toBe(200);
    expect(response.body.data.overview).toEqual(
      expect.objectContaining({
        deliveredOrdersCount: 1,
        totalGmv: 29998,
      }),
    );
    expect(response.body.data.providers[0]).toEqual(expect.objectContaining({
      deliveryBy: 1,
      deliveryByLabel: "هوميكس",
      returnsCount: 6,
      shippingCompanyName: "J&T",
    }));
    expect(response.body.data.vendors[0]).toEqual(expect.objectContaining({
      sellerName: "ركنة للأثاث",
    }));
  });

  it("includes legacy Homix shipments that have no deliveryBy value", async () => {
    orderModel.findAll.mockResolvedValueOnce([
      makeShipment({
        deliveryBy: null,
        id: 47821,
        shipmentStatus: 4,
        shippedFromInventory: true,
      }),
    ]);
    sequelizeQuery.mockResolvedValueOnce([{
      id: 47821,
      reportDate: "2026-08-14T18:26:17.292Z",
    }]);

    const response = await request(app).get("/shipments/performance").query({
      endDate: "2026-08-31",
      period: "daily",
      startDate: "2026-08-01",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.overview.deliveredOrdersCount).toBe(1);
    expect(orderModel.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ shipmentStatus: expect.any(Object) }),
    }));
  });

  it("filters performance by the actual shipment status history date", async () => {
    orderModel.findAll.mockResolvedValueOnce([
      makeShipment({
        deliveryDate: "2026-05-10T00:00:00.000Z",
        id: 9802,
        shipmentStatus: 4,
        updatedAt: "2026-07-10T00:00:00.000Z",
      }),
    ]);
    sequelizeQuery.mockResolvedValueOnce([
      { id: 9802, reportDate: "2026-06-15T12:00:00.000Z" },
    ]);

    const response = await request(app).get("/shipments/performance").query({
      endDate: "2026-06-30",
      period: "daily",
      startDate: "2026-06-01",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.overview.deliveredOrdersCount).toBe(1);
    expect(response.body.data.chart).toEqual([
      { deliveredOrdersCount: 1, label: "2026-06-15" },
    ]);
  });

  it("accepts ISO date filters for shipment performance", async () => {
    const response = await request(app)
      .get("/shipments/performance")
      .query({
        endDate: "2026-06-17T21:00:00.000Z",
        period: "daily",
        startDate: "2026-06-17T21:00:00.000Z",
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
  });

  it("rejects invalid shipment performance dates with validation error", async () => {
    const response = await request(app)
      .get("/shipments/performance")
      .query({ period: "daily", startDate: "not-a-date" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns shipment expenses", async () => {
    const response = await request(app).get("/shipments/accounts/expenses").query({ page: 1, size: 20 });

    expect(response.status).toBe(200);
    expect(response.body.data.items[0]).toEqual(
      expect.objectContaining({
        accountingStatus: 1,
        amount: 330,
        type: 1,
        typeLabel: "شحن",
      }),
    );
  });

  it("uses the collectible amount while the creation-time received zero was never edited", async () => {
    orderModel.findAndCountAll.mockResolvedValueOnce({
      count: 1,
      rows: [makeShipment({ receivedAmount: 0, toBeCollected: 29998 })],
    });

    const response = await request(app)
      .get("/shipments/accounts/deliveries")
      .query({ page: 1, size: 20 });

    expect(response.status).toBe(200);
    expect(response.body.data.items[0]).toEqual(expect.objectContaining({
      accountingDate: null,
      amountToCollect: 29998,
      receivedAmount: 29998,
    }));
  });

  it("keeps zero after a user explicitly edits the received amount to zero", async () => {
    orderModel.findAndCountAll.mockResolvedValueOnce({
      count: 1,
      rows: [makeShipment({
        receivedAmount: 0,
        receivedAmountManuallySet: true,
        toBeCollected: 29998,
      })],
    });

    const response = await request(app)
      .get("/shipments/accounts/deliveries")
      .query({ page: 1, size: 20 });

    expect(response.status).toBe(200);
    expect(response.body.data.items[0]).toEqual(expect.objectContaining({
      amountToCollect: 29998,
      receivedAmount: 0,
    }));
  });

  it("automatically stamps accountingDate when an account becomes settled", async () => {
    const shipmentRecord = makeShipmentRecord({
      accountingDate: null,
      accountingStatus: 1,
      id: 9802,
      shipmentStatus: 4,
    });
    orderModel.findByPk.mockResolvedValue(shipmentRecord);

    const beforeUpdate = Date.now();
    const response = await request(app)
      .put("/shipments/accounts/deliveries/9802")
      .send({ accountingStatus: 2 });

    expect(response.status).toBe(200);
    expect(shipmentRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      accountingDate: expect.any(Date),
      accountingStatus: 2,
    }));
    const updatePayload = shipmentRecord.update.mock.calls[0]?.[0] as { accountingDate: Date };
    expect(updatePayload.accountingDate.getTime()).toBeGreaterThanOrEqual(beforeUpdate);
  });

  it("allows manually editing the settlement accounting date", async () => {
    const shipmentRecord = makeShipmentRecord({
      accountingDate: "2026-08-24T00:00:00.000Z",
      accountingStatus: 2,
      id: 9802,
      shipmentStatus: 4,
    });
    orderModel.findByPk.mockResolvedValue(shipmentRecord);

    const response = await request(app)
      .put("/shipments/accounts/deliveries/9802")
      .send({ accountingDate: "2026-08-25T00:00:00.000Z", accountingStatus: 2 });

    expect(response.status).toBe(200);
    expect(shipmentRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      accountingDate: new Date("2026-08-25T00:00:00.000Z"),
      accountingStatus: 2,
    }));
  });

  it("exports delivery accounts as an Excel workbook", async () => {
    orderModel.findAndCountAll.mockResolvedValueOnce({
      count: 1,
      rows: [makeShipment({ accountingDate: "2026-05-18T13:45:22.000Z" })],
    });
    const response = await request(app)
      .get("/shipments/accounts/deliveries/export")
      .buffer(true)
      .parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers["content-disposition"]).toContain("delivery-accounts.xlsx");
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 2).toString()).toBe("PK");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    expect(workbook.getWorksheet("deliveries").getCell("K2").value).toBe("2026-05-18");
    expect(orderModel.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1_000_000 }),
    );
  });

  it("lets logistics upload a delivery-account reference without finance settlement access", async () => {
    mockAuthenticatedUser = {
      id: 4,
      permissions: { ship_edit: true },
      userType: "4",
    };

    // No file is intentional: reaching the controller's validation (400)
    // proves the request passed permission checks; the old gate returned 403.
    const response = await request(app)
      .post("/shipments/accounts/deliveries/9802/reference");

    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.objectContaining({
      message: "No file uploaded",
      status: false,
    }));
  });

  it("exports expenses as an Excel workbook", async () => {
    const response = await request(app)
      .get("/shipments/accounts/expenses/export")
      .buffer(true)
      .parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers["content-disposition"]).toContain("expenses.xlsx");
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 2).toString()).toBe("PK");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const worksheet = workbook.getWorksheet("expenses");
    expect(["A1", "B1", "C1", "D1", "E1"].map((cell) => worksheet.getCell(cell).value)).toEqual([
      "التاريخ",
      "النوع",
      "السبب",
      "المبلغ",
      "حالة المحاسبة",
    ]);
    expect(shipmentExpenseModel.findAll).toHaveBeenCalled();
  });

  it.each([
    ["vendor returns", "/shipments/returns/vendor/export", "vendor-returns.xlsx"],
    ["customer returns", "/shipments/returns/customer/export", "customer-returns.xlsx"],
    ["inventory", "/shipments/inventory/export", "inventory.xlsx"],
    ["performance", "/shipments/performance/export?period=daily", "shipment-performance.xlsx"],
  ])("exports %s from its own Excel endpoint", async (_label, path, filename) => {
    const response = await request(app)
      .get(path)
      .buffer(true)
      .parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers["content-disposition"]).toContain(filename);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 2).toString()).toBe("PK");
  });

  it("creates shipment expenses", async () => {
    const response = await request(app).post("/shipments/accounts/expenses").send({
      amount: 150,
      reason: "مواد تغليف",
      type: 2,
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        amount: 150,
        id: 9,
        reason: "مواد تغليف",
        type: 2,
        typeLabel: "تغليف",
      }),
    );
  });

  it("persists expense types", async () => {
    const response = await request(app).put("/shipments/accounts/expense-types").send({
      options: [{ id: 1, label: "شحن ونقل" }, { label: "ضيافة" }],
    });

    expect(response.status).toBe(200);
    expect(mockReplaceManagedOptions).toHaveBeenCalledWith("expense_type", [
      { id: 1, label: "شحن ونقل" },
      { label: "ضيافة" },
    ]);
  });
});
