import express from "express";
import { Op } from "sequelize";
import request from "supertest";

const orderModel = {
  count: jest.fn(),
  findAll: jest.fn(),
  findAndCountAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
};

const dashboardDailyMetricModel = {
  findAll: jest.fn(),
};

const vendorModel = {
  findAll: jest.fn(),
};

const userModel = {
  findAll: jest.fn(),
};

const legacyOrderService = {
  BulkUpdate: jest.fn(),
  addNote: jest.fn(),
  bulkDelete: jest.fn(),
  deleteNote: jest.fn(),
  deleteOrder: jest.fn(),
  exportOrders: jest.fn(),
  financialReport: jest.fn(),
  importOrders: jest.fn(),
  saveImportedOrders: jest.fn(),
  sendNotification: jest.fn(),
  updateNote: jest.fn(),
  updateOrder: jest.fn(),
  uploadFiles: jest.fn(),
};

jest.mock("../../../app/middlewares/protectApi", () => {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: 1, userType: "1" };
    req.vendorId = null;
    next();
  };
});

jest.mock("../../../app/middlewares/isNotVendor", () => {
  return (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
});

jest.mock("../../../config/fileUploadMiddleware", () => () => {
  return (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
});

jest.mock("../../infrastructure/database", () => ({
  sequelize: {
    col: jest.fn((value: string) => value),
    fn: jest.fn((...args: string[]) => args.join(".")),
    where: jest.fn((_left: unknown, right: unknown) => right),
  },
}));

jest.mock("../../../app/modules/order/order.model", () => orderModel);
jest.mock("../dashboard/dashboard-aggregate.service", () => ({
  DashboardAggregateService: jest.fn().mockImplementation(() => ({
    refreshRange: jest.fn(),
  })),
}));
jest.mock("../dashboard/dashboard-daily-metric.model", () => dashboardDailyMetricModel);
jest.mock("../../../app/modules/vendor/vendor.model", () => vendorModel);
jest.mock("../../../app/modules/user/user.model", () => userModel);
jest.mock("../../../app/modules/order/order.service", () => legacyOrderService);
jest.mock("../../../app/modules/orderLines/orderline.model", () => ({}));
jest.mock("../../../app/modules/product/product.model", () => ({}));
jest.mock("../../../app/modules/customer/customer.model", () => ({}));
const noteModel = {
  create: jest.fn(),
  findByPk: jest.fn(),
};

jest.mock("../../../app/modules/notes/notes.model", () => noteModel);
jest.mock("../../../app/modules/attachments/attachment.model", () => ({}));
jest.mock("../../../app/modules/product/productType.model", () => ({}));
jest.mock("../../../app/modules/logs/log.model", () => ({
  findAll: jest.fn().mockResolvedValue([
    {
      action: "notify",
      createdAt: "2026-05-04T02:00:00.000Z",
      field: "order_received_notification",
      id: 9,
      to: "sent",
      userId: null,
    },
    {
      action: "update",
      createdAt: "2026-05-04T01:00:00.000Z",
      field: "status",
      from: "1",
      id: 8,
      to: "2",
      userId: 1,
    },
    {
      action: "create",
      createdAt: "2026-05-04T00:00:00.000Z",
      field: "order_received",
      id: 7,
      userId: null,
    },
  ]),
}));

import { errorMiddleware } from "../../shared/http";
import { orderRouter } from "./order.routes";

const logModel = jest.requireMock("../../../app/modules/logs/log.model") as {
  findAll: jest.Mock;
};

const app = express();
app.set("query parser", "extended");
app.use(express.json());
app.use("/orders", orderRouter);
app.use(errorMiddleware);

const makeOrder = (overrides: Record<string, unknown> = {}) => ({
  code: "3001",
  commission: "20",
  customer: {
    address: "Cairo",
    email: "lamiaa@example.com",
    firstName: "Lamiaa",
    id: 5,
    lastName: "Saeid",
    phoneNumber: "01000000000",
  },
  customerId: 5,
  deliveryBy: 1,
  deliveryDate: "2026-05-05T00:00:00.000Z",
  deliveryStatus: 3,
  priority: 3,
  downPayment: "200",
  expectedDeliveryDate: "2026-05-06T00:00:00.000Z",
  id: 7,
  manufactureStatus: 2,
  notes: "important note",
  orderSource: 2,
  notesList: [
    {
      attachments: [
        {
          createdAt: "2026-05-04T00:00:00.000Z",
          description: "invoice",
          id: 9,
          name: "invoice.pdf",
          url: "/uploads/invoice.pdf",
        },
      ],
      createdAt: "2026-05-04T00:00:00.000Z",
      id: 4,
      text: "ابدأ التصنيع",
      user: { firstName: "Ahmed", lastName: "Hesham" },
    },
  ],
  orderDate: "2026-05-01T00:00:00.000Z",
  orderLines: [
    {
      color: "blue",
      material: "wood",
      product: {
        id: 812,
        image: "https://example.com/product.png",
        title: "ركنة للأثاث",
        type: { name: "غرفة نوم" },
        vendor: { daysToDeliver: 5, id: 3, name: "ركنة للأثاث", shippingCost: 200 },
      },
      quantity: 1,
      size: "100x100",
      sku: "RKA-001",
      title: "ركنة للأثاث",
      unitCost: "900",
    },
  ],
  orderNumber: "31668",
  paymentStatus: 1,
  shipmentType: "warehouse",
  status: 2,
  toBeCollected: "2099",
  totalCost: "1200",
  totalDiscounts: "100",
  totalPrice: "2299",
  userId: 1,
  user: { firstName: "Sara", lastName: "Mohamed" },
  ...overrides,
});

describe("orderRouter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dashboardDailyMetricModel.findAll.mockResolvedValue([]);
    orderModel.count.mockResolvedValue(0);
    orderModel.findAll.mockResolvedValue([makeOrder()]);
    orderModel.findAndCountAll.mockResolvedValue({ count: 1, rows: [makeOrder()] });
    orderModel.findByPk.mockResolvedValue({ id: 7, orderNumber: "31668" });
    orderModel.findOne.mockResolvedValue(makeOrder());
    noteModel.create.mockResolvedValue({ id: 9, text: "" });
    noteModel.findByPk.mockResolvedValue(null);
    vendorModel.findAll.mockResolvedValue([{ id: 3, name: "ركنة للأثاث" }]);
    userModel.findAll.mockResolvedValue([{ firstName: "Sara", id: 1, lastName: "Mohamed" }]);
  });

  it("returns orders meta options", async () => {
    const response = await request(app).get("/orders/meta");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.deliveryByOptions).toEqual([
      { id: 1, label: "هوميكس" },
      { id: 2, label: "بائع" },
    ]);
    expect(response.body.data.orderSources).toEqual([
      { id: 1, label: "شو رووم" },
      { id: 2, label: "اونلاين" },
    ]);
    expect(response.body.data.vendors[0]).toEqual({ id: 3, label: "ركنة للأثاث" });
  });

  it("returns orders summary cards", async () => {
    // الملخّص يُجمَّع في SQL الآن، فالنتيجة صفوف مُجمَّعة لا صفوف طلبات
    orderModel.findAll.mockResolvedValueOnce([
      { isUrgent: false, rowCount: "1", status: 1 },
    ]);

    const response = await request(app).get("/orders/summary").query({ page: 1, size: 20 });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.cards).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "totalOrders", value: 1 })]),
    );
  });

  it("creates manual orders with showroom as the default source", async () => {
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
      name: "#H9802",
    };

    const response = await request(app).post("/orders").send(payload);

    expect(response.status).toBe(200);
    expect(legacyOrderService.saveImportedOrders).toHaveBeenCalledWith(
      [expect.objectContaining({
        priority: 1,
        subTotalPrice: 16999,
        toBeCollected: 16999,
        totalDiscounts: 0,
      })],
      false,
      { id: 1, userType: "1" },
    );
  });

  it("preserves manual order and promised delivery dates for SLA and fine calculations", async () => {
    const response = await request(app).post("/orders").send({
      customer: { firstName: "عبير", phone: "01155559646" },
      expectedDeliveryDate: "2026-08-11T00:00:00.000Z",
      line_items: [{ price: 1000, product_id: 4455, quantity: 1, variant_id: 7788 }],
      orderDate: "2026-08-01T00:00:00.000Z",
    });

    expect(response.status).toBe(200);
    expect(legacyOrderService.saveImportedOrders).toHaveBeenCalledWith([
      expect.objectContaining({
        expectedDeliveryDate: "2026-08-11T00:00:00.000Z",
        orderDate: "2026-08-01T00:00:00.000Z",
      }),
    ], false, { id: 1, userType: "1" });
  });

  it("passes explicit orderSource when creating manual orders", async () => {
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
      name: "#H9802",
      orderSource: 2,
    };

    const response = await request(app).post("/orders").send(payload);

    expect(response.status).toBe(200);
    expect(legacyOrderService.saveImportedOrders).toHaveBeenCalledWith(
      [expect.objectContaining({
        orderSource: 2,
      })],
      false,
      { id: 1, userType: "1" },
    );
  });

  it("adds an empty order note", async () => {
    const response = await request(app)
      .post("/orders/7/notes")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.text).toBe("");
    expect(legacyOrderService.sendNotification).toHaveBeenCalled();
  });

  it("uses aggregate rows for stable summary cards and live count for urgent orders", async () => {
    dashboardDailyMetricModel.findAll.mockResolvedValue([
      {
        canceledOrRefundedOrders: 3,
        deliveredOrders: 9,
        inProgressOrders: 4,
        metricDate: "2026-05-01",
        pendingOrders: 2,
        totalOrders: 18,
      },
    ]);
    orderModel.count.mockResolvedValue(5);

    const response = await request(app).get("/orders/summary").query({ startDate: "2026-05-01", endDate: "2026-05-01" });

    expect(response.status).toBe(200);
    expect(response.body.data.cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "urgentOrders", value: 5 }),
        expect.objectContaining({ key: "canceledOrRefundedOrders", value: 3 }),
        expect.objectContaining({ key: "deliveredOrders", value: 9 }),
        expect.objectContaining({ key: "inProgressOrders", value: 4 }),
        expect.objectContaining({ key: "pendingOrders", value: 2 }),
        expect.objectContaining({ key: "totalOrders", value: 18 }),
      ]),
    );
  });

  it("returns the invoice-style financial report grouped by vendor", async () => {
    orderModel.findAll.mockResolvedValue([
      makeOrder({
        commission: "500",
        deliveryBy: 2,
        deliveryDate: "2026-07-12T00:00:00.000Z",
        fine: "100",
        shippedFromInventory: false,
        status: 5,
        totalPrice: "3000",
      }),
      makeOrder({
        commission: "700",
        deliveryBy: 1,
        deliveryDate: "2026-07-10T00:00:00.000Z",
        fine: "200",
        id: 8,
        orderNumber: "31669",
        shipmentStatus: 4,
        shippedFromInventory: true,
        status: 5,
        totalPrice: "5000",
      }),
    ]);

    const response = await request(app).get("/orders/financialReport").query({
      billingDay: 13,
      referenceDate: "2026-07-16",
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.cycle.billingDay).toBe(13);
    expect(response.body.data.summary.totalSales).toBe(8000);
    expect(response.body.data.summary.companyDue).toBe(1399);
    expect(response.body.data.summary.fines).toBe(300);
    expect(response.body.data.summary.vendorDue).toBe(4100);
    expect(response.body.data.fullInvoice.summary.warehouseCost).toBe(2400);
    expect(response.body.data.vendorDeliveries.summary.ordersCount).toBe(1);
    expect(response.body.data.warehouseDeliveries.summary.ordersCount).toBe(1);
    expect(response.body.data.fullInvoice.items[0].vendorName).toBe("ركنة للأثاث");
    expect(response.body.data.fullInvoice.items[0].orders).toEqual([
      expect.objectContaining({
        collectionTotal: 3000,
        companyDue: 699,
        fines: 100,
        id: 7,
        operationNumber: "3001",
        orderId: 7,
        orderNumber: "31668",
        paymentStatus: 1,
        productCode: "RKA-001",
        productId: 812,
        shipmentId: null,
        vendorDue: 0,
        vendorShippingCost: 200,
        warehouseCost: 1200,
      }),
      expect.objectContaining({
        collectionTotal: 5000,
        companyDue: 700,
        fines: 200,
        id: 8,
        operationNumber: "3001",
        orderId: 8,
        orderNumber: "31669",
        paymentStatus: 1,
        productCode: "RKA-001",
        productId: 812,
        shipmentId: 8,
        vendorDue: 4100,
        vendorShippingCost: 200,
        warehouseCost: 1200,
      }),
    ]);
    expect(response.body.data.vendorDeliveries.items[0].orders).toHaveLength(1);
    expect(response.body.data.vendorDeliveries.items[0].orders[0].id).toBe(7);
    expect(response.body.data.vendorDeliveries.items[0].orders[0]).toEqual(expect.objectContaining({
      collectionTotal: 2099,
      companyDue: 699,
      vendorDue: 0,
      vendorShippingCost: 200,
    }));
    expect(response.body.data.warehouseDeliveries.items[0].orders).toHaveLength(1);
    expect(response.body.data.warehouseDeliveries.items[0].orders[0].id).toBe(8);
    const findAllWhere = orderModel.findAll.mock.calls[0]?.[0]?.where as Record<PropertyKey, unknown>;
    const andKey = Object.getOwnPropertySymbols(findAllWhere)[0];
    const conditions = andKey && Array.isArray(findAllWhere[andKey])
      ? findAllWhere[andKey] as Array<Record<PropertyKey, unknown>>
      : [];
    expect(conditions).toContainEqual(expect.objectContaining({ [Op.eq]: 5 }));
  });

  it("resolves billingDay 28 to the July 14, 2026 through July 28, 2026 cycle for a July 26, 2026 reference date", async () => {
    orderModel.findAll.mockResolvedValue([]);

    const response = await request(app).get("/orders/financialReport").query({
      billingDay: 28,
      referenceDate: "2026-07-26",
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.cycle.billingDay).toBe(28);
    expect(response.body.data.cycle.startDate).toBe("2026-07-13T21:00:00.000Z");
    expect(response.body.data.cycle.endDate).toBe("2026-07-28T20:59:59.999Z");
  });

  it("returns orders list with legacy-compatible and view-friendly fields", async () => {
    const response = await request(app).get("/orders").query({ page: 1, size: 20 });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.items[0].assigneeId).toBe(1);
    expect(response.body.data.items[0].deliveryBy).toBe(1);
    expect(response.body.data.items[0].deliveryByLabel).toBe("هوميكس");
    expect(response.body.data.items[0].deliveryStatus).toBe(3);
    expect(response.body.data.items[0].itemType).toBe("غرفة نوم");
    expect(response.body.data.items[0].priority).toBe(3);
    expect(response.body.data.items[0].priorityLabel).toBe("مستعجل جدا");
    expect(response.body.data.items[0].operationNumber).toBe("3001");
    expect(response.body.data.items[0].orderSource).toBe(2);
    expect(response.body.data.items[0].orderSourceLabel).toBe("اونلاين");
    expect(response.body.data.items[0].fine).toBe(0);
    expect(response.body.data.items[0].toBeCollected).toBe(2099);
    expect(response.body.data.totalCount).toBe(1);
  });

  it("forwards order export requests to the legacy exporter", async () => {
    legacyOrderService.exportOrders.mockImplementation(async (res: express.Response) => {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.status(200).end("ok");
    });

    const response = await request(app).get("/orders/export").query({
      sort: { orderDate: -1 },
      orderNumber: "31668",
      startDate: "2026-05-01",
      endDate: "2026-05-02",
    });

    expect(response.status).toBe(200);
    expect(legacyOrderService.exportOrders).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        endDate: "2026-05-02",
        orderNumber: "31668",
        sort: { orderDate: -1 },
        startDate: "2026-05-01",
      }),
    );
    expect(String(response.headers["content-type"])).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("rejects invalid order export date filters", async () => {
    const response = await request(app).get("/orders/export").query({
      startDate: "not-a-date",
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns a financial report export workbook", async () => {
    const response = await request(app)
      .get("/orders/financialReport/export")
      .query({ billingDay: 28, referenceDate: "2026-07-26" });

    expect(response.status).toBe(200);
    expect(String(response.headers["content-type"])).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(String(response.headers["content-disposition"])).toContain("financial-report.xlsx");
  });

  it("applies orderSource filter to the orders query", async () => {
    const response = await request(app).get("/orders").query({ orderSource: "2", page: 1, size: 20 });

    expect(response.status).toBe(200);
    const whereClause = orderModel.findAndCountAll.mock.calls[0][0].where as Record<PropertyKey, unknown>;
    const andKey = Object.getOwnPropertySymbols(whereClause)[0];
    const conditions = andKey && Array.isArray(whereClause[andKey])
      ? whereClause[andKey] as Array<Record<PropertyKey, unknown>>
      : [];

    expect(conditions).toContainEqual(
      expect.objectContaining({
        [Op.in]: [2],
      }),
    );
  });

  it("applies deliveryBy filter to the orders query", async () => {
    const response = await request(app).get("/orders").query({ deliveryBy: "1", page: 1, size: 20 });

    expect(response.status).toBe(200);
    const whereClause = orderModel.findAndCountAll.mock.calls[0][0].where as Record<PropertyKey, unknown>;
    const andKey = Object.getOwnPropertySymbols(whereClause)[0];
    const conditions = andKey && Array.isArray(whereClause[andKey])
      ? whereClause[andKey] as Array<Record<PropertyKey, unknown>>
      : [];

    expect(conditions).toContainEqual(
      expect.objectContaining({
        [Op.in]: [1],
      }),
    );
  });

  it("supports multiple priority filters", async () => {
    orderModel.findAndCountAll.mockResolvedValue({
      count: 1,
      rows: [
        makeOrder(),
      ],
    });

    const response = await request(app).get("/orders").query({ page: 1, priority: "3,2", size: 20 });

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].orderNumber).toBe("31668");
  });

  it("filters orders by automated delivery status derived from expectedDeliveryDate", async () => {
    orderModel.findAndCountAll.mockResolvedValue({ count: 1, rows: [
      makeOrder(),
    ] });

    const response = await request(app).get("/orders").query({ deliveryStatus: "3", page: 1, size: 20 });

    expect(response.status).toBe(200);
    expect(orderModel.findAndCountAll).toHaveBeenCalled();
    expect(response.body.data.totalCount).toBe(1);
    expect(response.body.data.items[0].orderNumber).toBe("31668");
    expect(response.body.data.items[0].deliveryStatus).toBe(3);
  });

  it("sorts orders by totalPrice in the database query", async () => {
    const response = await request(app).get("/orders").query({ page: 1, size: 20, sort: { totalPrice: -1 } });

    expect(response.status).toBe(200);
    expect(orderModel.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      order: [["totalPrice", "DESC"], ["createdAt", "DESC"], ["id", "DESC"]],
    }));
  });

  it("sorts orders by manual priority in the database query", async () => {
    orderModel.findAndCountAll.mockResolvedValue({ count: 2, rows: [
      { ...makeOrder(), code: "3003", id: 9, orderNumber: "31670", priority: 3 },
      { ...makeOrder(), code: "3002", id: 8, orderNumber: "31669", priority: 1 },
    ] });

    const response = await request(app).get("/orders").query({ page: 1, size: 20, sort: { priority: -1 } });

    expect(response.status).toBe(200);
    expect(orderModel.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      order: [["priority", "DESC"], ["createdAt", "DESC"], ["id", "DESC"]],
    }));
    expect(response.body.data.items.map((item: { orderNumber: string }) => item.orderNumber)).toEqual(["31670", "31669"]);
  });

  it("returns order details in a focused DTO shape", async () => {
    const response = await request(app).get("/orders/7");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(response.body.data.assigneeId).toBe(1);
    expect(response.body.data.order.assigneeId).toBe(1);
    expect(response.body.data.order.deliveryBy).toBe(1);
    expect(response.body.data.order.deliveryByLabel).toBe("هوميكس");
    expect(response.body.data.order.deliveryStatus).toBe(3);
    expect(response.body.data.order.itemType).toBe("غرفة نوم");
    expect(response.body.data.order.priority).toBe(3);
    expect(response.body.data.order.priorityLabel).toBe("مستعجل جدا");
    expect(response.body.data.order.orderNumber).toBe("31668");
    expect(response.body.data.order.orderSource).toBe(2);
    expect(response.body.data.order.orderSourceLabel).toBe("اونلاين");
    expect(response.body.data.order.fine).toBe(0);
    expect(response.body.data.order.toBeCollected).toBe(2099);
    expect(response.body.data.order.productName).toBe("ركنة للأثاث");
    expect(response.body.data.order.shippedFromInventory).toBe(false);
    expect(response.body.data.order.itemsCount).toBe(1);
    expect(response.body.data.financial.fine).toBe(0);
    expect(response.body.data.timeline[0].eventType).toBe("notification_sent");
    expect(response.body.data.timeline[0].message).toBe("تم إرسال إشعار الطلب");
    expect(response.body.data.timeline[0].description).toBe("بواسطة نظام تلقائي");
    expect(response.body.data.timeline[1].fromStatus).toBe(1);
    expect(response.body.data.timeline[1].fromStatusLabel).toBe("معلق");
    expect(response.body.data.timeline[1].toStatus).toBe(2);
    expect(response.body.data.timeline[1].toStatusLabel).toBe("قيد التصنيع");
    expect(response.body.data.timeline[1].eventType).toBe("manufacturing_started");
    expect(response.body.data.timeline[1].message).toBe("بدأ التصنيع");
    expect(response.body.data.timeline[1].description).toBe("المدة المتوقعة 5 يوم عمل");
    expect(response.body.data.timeline[1].userName).toBe("Sara Mohamed");
    expect(response.body.data.timeline[2].eventType).toBe("order_received");
    expect(response.body.data.timeline[2].message).toBe("تم استلام الطلب");
    expect(response.body.data.timeline[2].description).toBe("بواسطة نظام تلقائي");
    expect(response.body.data.statusHistory).toHaveLength(8);
    expect(response.body.data.statusHistory[0].status).toBe(1);
    expect(response.body.data.statusHistory[0].statusLabel).toBe("معلق");
    expect(response.body.data.statusHistory[0].isActive).toBe(true);
    expect(response.body.data.statusHistory[1].status).toBe(2);
    expect(response.body.data.statusHistory[1].statusLabel).toBe("قيد التصنيع");
    expect(response.body.data.statusHistory[1].isActive).toBe(true);
    expect(response.body.data.statusHistory[1].userName).toBe("Sara Mohamed");
    expect(response.body.data.statusHistory[2].status).toBe(3);
    expect(response.body.data.statusHistory[2].isActive).toBe(false);
    expect(response.body.data.items[0].productName).toBe("ركنة للأثاث");
    expect(response.body.data.items[0].itemType).toBe("غرفة نوم");
    expect(response.body.data.items[0].vendorName).toBe("ركنة للأثاث");
    expect(response.body.data.items[0].variant).toEqual(expect.objectContaining({
      color: "blue",
      id: "",
      material: "wood",
      price: 0,
      size: "100x100",
      sku: "RKA-001",
    }));
    expect(response.body.data.customer.id).toBe(5);
  });

  it("returns automated deliveryStatus in order details based on expectedDeliveryDate", async () => {
    orderModel.findOne.mockResolvedValue({
      ...makeOrder(),
      deliveryStatus: 3,
      expectedDeliveryDate: "2099-05-06T00:00:00.000Z",
    });

    const response = await request(app).get("/orders/7");

    expect(response.status).toBe(200);
    expect(response.body.data.order.deliveryStatus).toBe(1);
  });

  it("renders order timeline updates with Arabic field/value labels", async () => {
    logModel.findAll.mockResolvedValueOnce([
      {
        action: "update",
        createdAt: "2026-07-20T01:00:00.000Z",
        field: "status",
        from: "2",
        id: 8,
        to: "1",
        userId: 1,
      },
    ]);

    const response = await request(app).get("/orders/7");

    expect(response.status).toBe(200);
    expect(response.body.data.timeline[0].message).toBe("تم تحديث حالة الطلب إلى معلق");
    expect(response.body.data.timeline[0].userName).toBe("Sara Mohamed");
  });

  it("caps status history at the order current status", async () => {
    logModel.findAll.mockResolvedValueOnce([
      {
        action: "update",
        createdAt: "2026-05-04T01:00:00.000Z",
        field: "status",
        from: "1",
        id: 8,
        to: "2",
        userId: 1,
      },
      {
        action: "update",
        createdAt: "2026-05-05T01:00:00.000Z",
        field: "status",
        from: "2",
        id: 9,
        to: "5",
        userId: 1,
      },
    ]);
    orderModel.findOne.mockResolvedValue({
      ...makeOrder(),
      status: 4,
    });

    const response = await request(app).get("/orders/7");

    expect(response.status).toBe(200);
    expect(response.body.data.statusHistory.map((item: { isActive: boolean; status: number }) => ({
      isActive: item.isActive,
      status: item.status,
    }))).toEqual([
      { isActive: true, status: 1 },
      { isActive: true, status: 2 },
      { isActive: false, status: 3 },
      { isActive: true, status: 4 },
      { isActive: false, status: 5 },
      { isActive: false, status: 6 },
      { isActive: false, status: 7 },
      { isActive: false, status: 8 },
    ]);
  });
});
