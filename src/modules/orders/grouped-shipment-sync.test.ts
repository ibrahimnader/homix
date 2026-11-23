/* «توصيل مجمع»: a changed shipment type follows the sibling orders (same orderNumber). */
import { Op } from "sequelize";
import { USER_TYPES } from "../../../config/constants";

type Row = Record<string, unknown> & { id: number };
let store: Row[] = [];
const mockLogBulkCreate = jest.fn();
const mockUpdateCalls: Array<{ id: number; patch: Record<string, unknown>; transaction: unknown }> = [];
const TX = { tx: true };

const snap = (row: Row) => { const copy = { ...row }; return { ...copy, toJSON: () => ({ ...copy }) }; };

const wrap = (row: Row) => ({
  ...row,
  toJSON: () => ({ ...row }),
  update: async (patch: Record<string, unknown>, options: { transaction: unknown }) => {
    mockUpdateCalls.push({ id: row.id, patch, transaction: options.transaction });
    Object.assign(row, patch);
  },
});

jest.mock("../../../app/modules/order/order.model", () => ({
  findAll: jest.fn(async (query: { where: Record<string, Record<symbol, unknown[]>> }) => {
    const numbers = query.where.orderNumber![Op.in] as string[];
    const excluded = query.where.id![Op.notIn] as number[];
    /* the real model is paranoid: soft-deleted rows never come back */
    return store.filter((row) => numbers.includes(String(row.orderNumber)) && !excluded.includes(row.id) && !row.deletedAt).map(wrap);
  }),
}));
jest.mock("../../../app/modules/logs/log.model", () => ({ bulkCreate: (...args: unknown[]) => mockLogBulkCreate(...args) }));
jest.mock("../../infrastructure/database", () => ({
  sequelize: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(TX) },
}));
jest.mock("../dashboard/dashboard-aggregate.service", () => ({
  DashboardAggregateService: jest.fn().mockImplementation(() => ({ refreshRange: jest.fn(), backfill: jest.fn() })),
}));
jest.mock("../shipments/shipment.notifications", () => ({
  ...jest.requireActual("../shipments/shipment.notifications"),
  notifyShipmentScheduleStatusChanges: jest.fn(),
  notifyShipmentScheduled: jest.fn(),
  notifyShipmentStatusChanges: jest.fn(),
}));

// eslint-disable-next-line import/first
import { ShipmentService } from "../shipments/shipment.service";
// eslint-disable-next-line import/first
import { OrderService } from "./order.service";
// eslint-disable-next-line import/first
import { applyGroupedShipmentTypeSync, planGroupedShipmentTypeSync, withLinkedOrderIds } from "./grouped-shipment-sync";

const order = (id: number, orderNumber: string, shipmentType: string | null, extra: Record<string, unknown> = {}): Row =>
  ({ id, orderNumber, shipmentType, code: `C${id}`, status: 1, shipmentStatus: 1, ...extra });
const staff = { id: 3, userType: USER_TYPES.ADMIN } as never;
const vendor = { id: 4, userType: USER_TYPES.VENDOR } as never;

const shipmentService = () => {
  const byId = (id: number) => store.find((row) => row.id === id) ?? null;
  const repository = {
    findShipmentEntity: jest.fn(async (id: number) => { const row = byId(id); return row ? snap(row) : null; }),
    findInvoiceLockedOrders: jest.fn().mockResolvedValue(new Map()),
    createRegressionAuditLogs: jest.fn(),
    updateShipment: jest.fn(async (id: number, payload: Record<string, unknown>) => { Object.assign(byId(id)!, payload); return snap(byId(id)!); }),
    bulkUpdateShipments: jest.fn(async (ids: number[], payload: Record<string, unknown>) => { ids.forEach((id) => Object.assign(byId(id)!, payload)); return ids.length; }),
  };
  return { service: new ShipmentService(repository as never), repository };
};

beforeEach(() => {
  mockLogBulkCreate.mockReset();
  mockUpdateCalls.length = 0;
  store = [
    order(1, "H100", "separate"),
    order(2, "H100", "separate"),
    order(3, "H100", "separate"),
    order(4, "H200", "separate"),
  ];
});

describe("planGroupedShipmentTypeSync", () => {
  it("returns nothing when the edited order's type did not change or is cleared", () => {
    const siblings = [{ id: 2, orderNumber: "H1", shipmentType: "separate" }];
    expect(planGroupedShipmentTypeSync([{ id: 1, orderNumber: "H1", beforeType: "grouped", nextType: "grouped" }], siblings)).toEqual([]);
    expect(planGroupedShipmentTypeSync([{ id: 1, orderNumber: "H1", beforeType: "grouped", nextType: null }], siblings)).toEqual([]);
    expect(planGroupedShipmentTypeSync([{ id: 1, orderNumber: "", beforeType: "separate", nextType: "grouped" }], siblings)).toEqual([]);
  });
  it("skips closed siblings (cancelled order / rejected shipment) and siblings already grouped", () => {
    const changes = planGroupedShipmentTypeSync(
      [{ id: 1, orderNumber: "H1", beforeType: "separate", nextType: "grouped" }],
      [
        { id: 2, orderNumber: "H1", shipmentType: "separate", status: 9 },
        { id: 3, orderNumber: "H1", shipmentType: "separate", shipmentStatus: 6 },
        { id: 4, orderNumber: "H1", shipmentType: "warehouse" },
        { id: 5, orderNumber: "H1", shipmentType: null },
      ],
    );
    expect(changes.map((change) => change.orderId)).toEqual([5]);
  });
});

describe("applyGroupedShipmentTypeSync", () => {
  it("sets every sibling of the same orderNumber to grouped, in one transaction, with audit rows per sibling", async () => {
    const ids = await applyGroupedShipmentTypeSync(
      [{ id: 1, orderNumber: "H100", code: "C1", beforeType: "separate", nextType: "grouped" }], 3);
    expect(ids).toEqual([2, 3]);
    expect(store.map((row) => row.shipmentType)).toEqual(["separate", "grouped", "grouped", "separate"]);
    expect(mockUpdateCalls.every((call) => call.transaction === TX)).toBe(true);
    expect(mockLogBulkCreate).toHaveBeenCalledTimes(2);
    expect(mockLogBulkCreate.mock.calls[0]![0]).toEqual([
      { action: "update", entityId: 2, entityType: "order", field: "shipmentType", from: "separate", to: "grouped", userId: 3 },
      {
        action: "auto_sync", entityId: 2, entityType: "order", field: "autoSync",
        from: "تم تلقائيًا مع الطلب المرتبط #C1", to: "shipmentType:separate->grouped", userId: 3,
      },
    ]);
    expect(mockLogBulkCreate.mock.calls[0]![1]).toEqual({ transaction: TX });
  });
  it("leaves orders with a different orderNumber, soft-deleted and closed siblings untouched", async () => {
    store.push(order(5, "H100", "separate", { deletedAt: "2026-01-01" }), order(6, "H100", "separate", { status: 10 }));
    const ids = await applyGroupedShipmentTypeSync([{ id: 1, orderNumber: "H100", beforeType: "separate", nextType: "grouped" }], 3);
    expect(ids).toEqual([2, 3]);
    expect(store.find((row) => row.id === 4)!.shipmentType).toBe("separate");
    expect(store.find((row) => row.id === 5)!.shipmentType).toBe("separate");
    expect(store.find((row) => row.id === 6)!.shipmentType).toBe("separate");
  });
  it("writes nothing when there are no siblings", async () => {
    expect(await applyGroupedShipmentTypeSync([{ id: 4, orderNumber: "H200", beforeType: "separate", nextType: "grouped" }], 3)).toEqual([]);
    expect(mockLogBulkCreate).not.toHaveBeenCalled();
  });
  it("reverse: only siblings still grouped follow the new value; an independent type is kept", async () => {
    store[0]!.shipmentType = "grouped";
    store[1]!.shipmentType = "grouped";
    store[2]!.shipmentType = "single";
    const ids = await applyGroupedShipmentTypeSync([{ id: 1, orderNumber: "H100", beforeType: "grouped", nextType: "separate" }], 3);
    expect(ids).toEqual([2]);
    expect(store.map((row) => row.shipmentType)).toEqual(["grouped", "separate", "single", "separate"]);
  });
  it("does not override siblings when an unchanged value is re-saved", async () => {
    store[0]!.shipmentType = "separate";
    store[1]!.shipmentType = "grouped";
    expect(await applyGroupedShipmentTypeSync([{ id: 1, orderNumber: "H100", beforeType: "separate", nextType: "separate" }], 3)).toEqual([]);
    expect(store[1]!.shipmentType).toBe("grouped");
  });
});

describe("ShipmentService grouped delivery", () => {
  it("single edit: updated sibling ids are returned and the status sync is not involved", async () => {
    const { service, repository } = shipmentService();
    const result = await service.updateShipment(1, { shipmentType: "grouped" }, staff);
    expect(result.ok && (result.data as unknown as { linkedOrderIds: number[] }).linkedOrderIds).toEqual([2, 3]);
    expect(repository.updateShipment).toHaveBeenCalledTimes(1);
    expect(store.map((row) => row.shipmentType)).toEqual(["grouped", "grouped", "grouped", "separate"]);
    expect(store.every((row) => row.status === 1 && row.shipmentStatus === 1)).toBe(true);
  });
  it("single edit without shipmentType in the payload never touches siblings", async () => {
    const { service } = shipmentService();
    const result = await service.updateShipment(1, { shipmentStatus: 1 }, staff);
    expect((result.ok && (result.data as Record<string, unknown>).linkedOrderIds) ?? undefined).toBeUndefined();
    expect(mockUpdateCalls).toEqual([]);
  });
  it("bulk edit: siblings of every selected order are synced once, selected orders are not rewritten", async () => {
    store.push(order(7, "H300", "separate"), order(8, "H300", "separate"));
    const { service } = shipmentService();
    const result = await service.bulkUpdateShipments([1, 2, 7], { shipmentType: "grouped" }, staff);
    const data = result.ok ? (result.data as unknown as { updatedCount: number; linkedOrderIds: number[] }) : null;
    expect(data).toMatchObject({ updatedCount: 3 });
    expect(data!.linkedOrderIds.sort()).toEqual([3, 8]);
    expect(mockUpdateCalls.map((call) => call.id).sort()).toEqual([3, 8]);
  });
  it("a vendor request never cascades", async () => {
    const { service } = shipmentService();
    await service.updateShipment(1, { shipmentType: "grouped" }, vendor);
    expect(mockUpdateCalls).toEqual([]);
  });
});

describe("OrderService grouped delivery", () => {
  const orderService = () => {
    const repository = {
      findOrderEntity: jest.fn(async (id: number) => { const row = store.find((r) => r.id === id); return row ? snap(row) : null; }),
      findOrderEntities: jest.fn(async (ids: number[]) => store.filter((r) => ids.includes(r.id)).map(snap)),
      findInvoiceLockedOrders: jest.fn().mockResolvedValue(new Map()),
      assertVendorOwnsOrders: jest.fn(),
    };
    const legacy = {
      updateOrder: jest.fn(async (id: number, payload: Record<string, unknown>) => { Object.assign(store.find((r) => r.id === id)!, { shipmentType: payload.shipmentType }); return { status: true, data: { id } }; }),
      bulkUpdate: jest.fn(async (payload: { orderIds: number[]; orderData: Record<string, unknown> }) => {
        payload.orderIds.forEach((id) => Object.assign(store.find((r) => r.id === id)!, { shipmentType: payload.orderData.shipmentType }));
        return { status: true, message: "ok" };
      }),
    };
    return new OrderService(repository as never, legacy as never);
  };
  it("order details edit syncs siblings and returns their ids", async () => {
    const result = await orderService().updateOrder(1, { shipmentType: "grouped" } as never, staff);
    expect(result.ok && (result.data as unknown as { linkedOrderIds: number[] }).linkedOrderIds).toEqual([2, 3]);
  });
  it("bulk edit syncs siblings and returns their ids", async () => {
    const result = await orderService().bulkUpdate({ orderIds: [1], orderData: { shipmentType: "grouped" } } as never, staff);
    expect(result.ok && (result.data as unknown as { linkedOrderIds: number[] }).linkedOrderIds).toEqual([2, 3]);
    expect(store.map((row) => row.shipmentType)).toEqual(["grouped", "grouped", "grouped", "separate"]);
  });
});

describe("withLinkedOrderIds", () => {
  it("leaves the response untouched when nothing cascaded", () => {
    const data = { id: 1 };
    expect(withLinkedOrderIds(data, [])).toBe(data);
    expect(withLinkedOrderIds(data, [2])).toEqual({ id: 1, linkedOrderIds: [2], linkedOrdersCount: 1 });
  });
});
