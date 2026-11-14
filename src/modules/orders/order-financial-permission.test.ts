import express from "express";
import request from "supertest";

import { ForbiddenError, NotFoundError } from "../../shared/errors";
import { errorMiddleware } from "../../shared/http";
import { USER_PERMISSION_TEMPLATES, USER_PERMISSION_GROUPS } from "../../../app/modules/user/user.permissions";
import { OrderService, canEditOrderFinancials } from "./order.service";

jest.mock("../dashboard/dashboard-aggregate.service", () => ({
  DashboardAggregateService: jest.fn().mockImplementation(() => ({
    refreshRange: jest.fn(),
    backfill: jest.fn(),
  })),
}));

const ADMIN = { id: 1, userType: "1" };
const VENDOR = { id: 2, userType: "2", vendorId: 9, permissions: { orders_edit: true, orders_edit_financials: true } };
const OPERATOR_NO_KEY = { id: 3, userType: "3", permissions: { orders_edit: true } };
const OPERATOR_WITH_KEY = { id: 4, userType: "3", permissions: { orders_edit: true, orders_edit_financials: true } };

const STORED = {
  id: 7,
  costPrice: "500.00",
  downPayment: "200",
  paymentStatus: 1,
  shippingFees: "50",
  subTotalPrice: "1100.00",
  toBeCollected: "850.00",
  totalCost: "480.00",
  totalDiscounts: "100",
  totalPrice: "1000.00",
};
const FIELDS = ["costPrice", "shippingFees", "totalDiscounts", "downPayment", "totalPrice", "subTotalPrice", "toBeCollected", "totalCost"] as const;

const build = () => {
  const repository = {
    findOrderEntity: jest.fn().mockResolvedValue(STORED),
    findOrderEntities: jest.fn().mockResolvedValue([]),
    /* vendor 9 owns orders 7 and 8 only */
    findVendorOwnedOrderIds: jest.fn(async (ids: number[], vendorId: number) => (vendorId === 9 ? ids.filter((id) => [7, 8].includes(id)) : [])),
  };
  const gateway = {
    updateOrder: jest.fn().mockResolvedValue({ data: { id: 7 }, status: true, statusCode: 200 }),
    bulkUpdate: jest.fn().mockResolvedValue({ message: "ok", status: true, statusCode: 200 }),
  };
  const service = new OrderService(repository as never, gateway as never);
  return { gateway, repository, service };
};

describe("order financial edit permission", () => {
  describe("canEditOrderFinancials", () => {
    it("allows admin and keyed non-vendor only", () => {
      expect(canEditOrderFinancials(ADMIN as never)).toBe(true);
      expect(canEditOrderFinancials(OPERATOR_WITH_KEY as never)).toBe(true);
      expect(canEditOrderFinancials(OPERATOR_NO_KEY as never)).toBe(false);
      expect(canEditOrderFinancials(VENDOR as never)).toBe(false);
      expect(canEditOrderFinancials({ id: 5, userType: "3", permissions: { orders_edit_financials: false } } as never)).toBe(false);
    });
  });

  describe("updateOrder", () => {
    it("rejects a vendor even holding the key", async () => {
      const { gateway, service } = build();
      await expect(service.updateOrder(7, { shippingFees: 99 } as never, VENDOR as never)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.updateOrder(7, { costPrice: 1 } as never, VENDOR as never)).rejects.toBeInstanceOf(ForbiddenError);
      expect(gateway.updateOrder).not.toHaveBeenCalled();
    });

    it("rejects a non-admin without the key when a value changes", async () => {
      const { gateway, service } = build();
      await expect(service.updateOrder(7, { shippingFees: 99 } as never, OPERATOR_NO_KEY as never)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.updateOrder(7, { totalDiscounts: "0" } as never, OPERATOR_NO_KEY as never)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.updateOrder(7, { downPayment: 1 } as never, OPERATOR_NO_KEY as never)).rejects.toBeInstanceOf(ForbiddenError);
      expect(gateway.updateOrder).not.toHaveBeenCalled();
    });

    it("rejects costPrice whenever sent, even with the stored value", async () => {
      const { service } = build();
      await expect(service.updateOrder(7, { costPrice: 500 } as never, OPERATOR_NO_KEY as never)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("allows a user holding the key", async () => {
      const { gateway, service } = build();
      await expect(
        service.updateOrder(7, { costPrice: 1, shippingFees: 2, totalDiscounts: 3, downPayment: 4 } as never, OPERATOR_WITH_KEY as never),
      ).resolves.toMatchObject({ ok: true });
      expect(gateway.updateOrder).toHaveBeenCalledTimes(1);
    });

    it("allows an admin", async () => {
      const { gateway, service } = build();
      await expect(service.updateOrder(7, { costPrice: 1, shippingFees: 2 } as never, ADMIN as never)).resolves.toMatchObject({ ok: true });
      expect(gateway.updateOrder).toHaveBeenCalledTimes(1);
    });

    it("allows unchanged stored values (numeric or string form) for non-admin without key", async () => {
      const { gateway, service } = build();
      await expect(
        service.updateOrder(7, { shippingFees: 50, totalDiscounts: "100.00", downPayment: "200", notes: "x" } as never, OPERATOR_NO_KEY as never),
      ).resolves.toMatchObject({ ok: true });
      expect(gateway.updateOrder).toHaveBeenCalledTimes(1);
    });

    it("rejects when one field is unchanged and another changed", async () => {
      const { service } = build();
      await expect(
        service.updateOrder(7, { shippingFees: 50, downPayment: 201 } as never, OPERATOR_NO_KEY as never),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("does not affect payloads without financial fields", async () => {
      const { gateway, service } = build();
      await expect(service.updateOrder(7, { notes: "hi", priority: 2 } as never, OPERATOR_NO_KEY as never)).resolves.toMatchObject({ ok: true });
      await expect(service.updateOrder(7, { manufactureStatus: 2 } as never, VENDOR as never)).resolves.toMatchObject({ ok: true });
      expect(gateway.updateOrder).toHaveBeenCalledTimes(2);
    });
  });

  describe("bulkUpdate", () => {
    it.each(FIELDS)("rejects %s without the key, even if it equals nothing stored", async (field) => {
      const { gateway, service } = build();
      await expect(
        service.bulkUpdate({ orderIds: [7], orderData: { [field]: 0 } } as never, OPERATOR_NO_KEY as never),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        service.bulkUpdate({ orderIds: [7], orderData: { [field]: 1 } } as never, VENDOR as never),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(gateway.bulkUpdate).not.toHaveBeenCalled();
    });

    it.each(FIELDS)("allows %s with the key and for admin", async (field) => {
      const { gateway, service } = build();
      await expect(service.bulkUpdate({ orderIds: [7], orderData: { [field]: 5 } } as never, OPERATOR_WITH_KEY as never)).resolves.toMatchObject({ ok: true });
      await expect(service.bulkUpdate({ orderIds: [7], orderData: { [field]: 5 } } as never, ADMIN as never)).resolves.toMatchObject({ ok: true });
      expect(gateway.bulkUpdate).toHaveBeenCalledTimes(2);
    });

    it("strips every non-whitelisted field from a vendor's bulk payload", async () => {
      const { gateway, service } = build();
      await service.bulkUpdate({ orderIds: [7], orderData: { manufactureStatus: 2, priority: 3, status: 4 } } as never, VENDOR as never);
      expect(gateway.bulkUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ orderData: { manufactureStatus: 2 } }),
        expect.anything(),
      );
    });

    it("does not affect payloads without financial fields", async () => {
      const { gateway, service } = build();
      await expect(service.bulkUpdate({ orderIds: [7], orderData: { priority: 2 } } as never, OPERATOR_NO_KEY as never)).resolves.toMatchObject({ ok: true });
      expect(gateway.bulkUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe("widened guard: totals", () => {
    it.each(["totalPrice", "subTotalPrice", "toBeCollected", "totalCost"])("rejects a changed %s for staff without the key, on single update", async (field) => {
      const { gateway, service } = build();
      await expect(service.updateOrder(7, { [field]: 12345 } as never, OPERATOR_NO_KEY as never)).rejects.toBeInstanceOf(ForbiddenError);
      expect(gateway.updateOrder).not.toHaveBeenCalled();
    });

    it("treats equal numbers/strings within tolerance as unchanged", async () => {
      const { gateway, service } = build();
      await expect(
        service.updateOrder(7, { totalPrice: "1000", subTotalPrice: 1100.001, totalCost: "480.00", toBeCollected: 850 } as never, OPERATOR_NO_KEY as never),
      ).resolves.toMatchObject({ ok: true });
      expect(gateway.updateOrder).toHaveBeenCalledTimes(1);
    });

    it("allows the key holder and admin to change the totals", async () => {
      const { gateway, service } = build();
      const payload = { totalPrice: 1, subTotalPrice: 2, toBeCollected: 3, totalCost: 4 } as never;
      await expect(service.updateOrder(7, payload, OPERATOR_WITH_KEY as never)).resolves.toMatchObject({ ok: true });
      await expect(service.updateOrder(7, payload, ADMIN as never)).resolves.toMatchObject({ ok: true });
      expect(gateway.updateOrder).toHaveBeenCalledTimes(2);
    });

    it("ignores values the server derives itself (normalizeOrderMutationPayload recalculates totals after the check)", async () => {
      const { gateway, service } = build();
      /* a status-only edit: the server adds totalPrice/subTotalPrice/toBeCollected to the legacy payload, never to the guard input */
      await service.updateOrder(7, { status: 3 } as never, OPERATOR_NO_KEY as never);
      const sent = gateway.updateOrder.mock.calls[0]![1] as Record<string, unknown>;
      expect(sent).toHaveProperty("totalPrice");
      expect(sent).toHaveProperty("toBeCollected");
    });
  });

  describe("real UI payload shapes never 403 staff without the key", () => {
    const resend = (extra: Record<string, unknown>) => ({
      /* OrderEdit.tsx buildUpdatePayload: stored values re-sent as numbers */
      customerId: 5,
      downPayment: 200,
      expectedDeliveryDate: "2026-11-20",
      manufactureStatus: 2,
      paymentStatus: 1,
      priority: 2,
      shippingFees: 50,
      status: 3,
      totalDiscounts: 100,
      totalPrice: 1000,
      ...extra,
    });

    it("OrderEdit full form with unchanged money", async () => {
      const { gateway, service } = build();
      await expect(service.updateOrder(7, resend({}) as never, OPERATOR_NO_KEY as never)).resolves.toMatchObject({ ok: true });
      await expect(service.updateOrder(7, resend({ status: 8, priority: 1, manufactureStatus: 5, deliveryStatus: 2 }) as never, OPERATOR_NO_KEY as never)).resolves.toMatchObject({ ok: true });
      expect(gateway.updateOrder).toHaveBeenCalledTimes(2);
    });

    it("legacy EditOrderModal on a PAID order re-sends the displayed 0 for toBeCollected", async () => {
      const paid = { ...STORED, paymentStatus: 2 };
      const repository = { findOrderEntity: jest.fn().mockResolvedValue(paid), findOrderEntities: jest.fn().mockResolvedValue([]) };
      const gateway = { updateOrder: jest.fn().mockResolvedValue({ data: { id: 7 }, status: true, statusCode: 200 }) };
      const service = new OrderService(repository as never, gateway as never);
      await expect(
        service.updateOrder(7, {
          confirmationStatus: 2, deliveryBy: 1, downPayment: 200, orderSource: 1, paymentStatus: 2,
          shippingFees: 50, status: 3, toBeCollected: 0, userId: 4, vendorId: 9, commission: 10, totalVendorDue: 5, totalCompanyDue: 5,
        } as never, OPERATOR_NO_KEY as never),
      ).resolves.toMatchObject({ ok: true });
    });

    it("inline detail edits and status-linking payloads (status / manufacture / confirmation / notes / customer / delivery)", async () => {
      const { gateway, service } = build();
      for (const payload of [
        { status: 9 }, { manufactureStatus: 3 }, { confirmationStatus: 2 }, { notes: "n" },
        { deliveryBy: 2, shipmentType: "separate", governorate: "cairo" }, { customerId: 6 }, { shipmentStatus: 4 },
      ]) {
        await expect(service.updateOrder(7, payload as never, OPERATOR_NO_KEY as never)).resolves.toMatchObject({ ok: true });
      }
      expect(gateway.updateOrder).toHaveBeenCalledTimes(7);
    });

    it("bulk edit shapes from the Orders list (status/payment/delivery/assignee/source/confirmation)", async () => {
      const { gateway, service } = build();
      await expect(
        service.bulkUpdate({ orderIds: [7, 8], orderData: { status: 3, paymentStatus: 2, deliveryBy: 1, userId: 4, orderSource: 1, confirmationStatus: 2 } } as never, OPERATOR_NO_KEY as never),
      ).resolves.toMatchObject({ ok: true });
      expect(gateway.bulkUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe("permission matrix (admin / key holder / staff without key / vendor)", () => {
    const users = { admin: ADMIN, keyHolder: OPERATOR_WITH_KEY, noKey: OPERATOR_NO_KEY, vendor: VENDOR } as const;
    const expected = { admin: true, keyHolder: true, noKey: false, vendor: false } as const;

    it.each(Object.keys(users) as Array<keyof typeof users>)("%s: single update of a changed money field", async (who) => {
      const { service } = build();
      for (const field of FIELDS) {
        const call = service.updateOrder(7, { [field]: 98765 } as never, users[who] as never);
        if (expected[who]) await expect(call).resolves.toMatchObject({ ok: true });
        else await expect(call).rejects.toBeInstanceOf(ForbiddenError);
      }
    });

    it.each(Object.keys(users) as Array<keyof typeof users>)("%s: bulk update of a money field", async (who) => {
      const { service } = build();
      for (const field of FIELDS) {
        const call = service.bulkUpdate({ orderIds: [7], orderData: { [field]: 5 } } as never, users[who] as never);
        if (expected[who]) await expect(call).resolves.toMatchObject({ ok: true });
        else await expect(call).rejects.toBeInstanceOf(ForbiddenError);
      }
    });
  });

  describe("vendor ownership scoping", () => {
    it("lets a vendor update their own order (manufacture status)", async () => {
      const { gateway, service } = build();
      await expect(service.updateOrder(7, { manufactureStatus: 2 } as never, VENDOR as never)).resolves.toMatchObject({ ok: true });
      expect(gateway.updateOrder).toHaveBeenCalledTimes(1);
    });

    it("answers NotFound (never Forbidden) for another vendor's or a missing order, writing nothing", async () => {
      const { gateway, service } = build();
      await expect(service.updateOrder(99, { manufactureStatus: 2 } as never, VENDOR as never)).rejects.toBeInstanceOf(NotFoundError);
      /* even a payload that would 403 must look the same, so existence does not leak */
      await expect(service.updateOrder(99, { shippingFees: 1 } as never, VENDOR as never)).rejects.toBeInstanceOf(NotFoundError);
      expect(gateway.updateOrder).not.toHaveBeenCalled();
    });

    it("a vendor without a vendorId owns nothing", async () => {
      const { service } = build();
      await expect(service.updateOrder(7, { manufactureStatus: 2 } as never, { id: 2, userType: "2" } as never)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("bulk: convention = all-or-nothing. One foreign id rejects the whole request with 404 and nothing is written", async () => {
      const { gateway, service } = build();
      await expect(service.bulkUpdate({ orderIds: [7, 8], orderData: { manufactureStatus: 2 } } as never, VENDOR as never)).resolves.toMatchObject({ ok: true });
      expect(gateway.bulkUpdate).toHaveBeenCalledTimes(1);
      await expect(service.bulkUpdate({ orderIds: [7, 99], orderData: { manufactureStatus: 2 } } as never, VENDOR as never)).rejects.toBeInstanceOf(NotFoundError);
      expect(gateway.bulkUpdate).toHaveBeenCalledTimes(1);
    });

    it("staff are not scoped (and the ownership query is never run for them)", async () => {
      const { repository, service } = build();
      await expect(service.updateOrder(99, { notes: "x" } as never, OPERATOR_NO_KEY as never)).resolves.toMatchObject({ ok: true });
      await expect(service.bulkUpdate({ orderIds: [99, 100], orderData: { priority: 2 } } as never, ADMIN as never)).resolves.toMatchObject({ ok: true });
      expect(repository.findVendorOwnedOrderIds).not.toHaveBeenCalled();
    });
  });

  describe("HTTP mapping", () => {
    it("maps ForbiddenError to 403 through the error middleware", async () => {
      const { service } = build();
      const app = express();
      app.use(express.json());
      app.put("/orders/:id", async (req, res, next) => {
        try {
          res.json(await service.updateOrder(Number(req.params.id), req.body, OPERATOR_NO_KEY as never));
        } catch (error) {
          next(error);
        }
      });
      app.put("/orders-bulk", async (req, res, next) => {
        try {
          res.json(await service.bulkUpdate(req.body, OPERATOR_NO_KEY as never));
        } catch (error) {
          next(error);
        }
      });
      app.use(errorMiddleware);

      const single = await request(app).put("/orders/7").send({ shippingFees: 99 });
      expect(single.status).toBe(403);
      expect(single.body).toMatchObject({ code: "FORBIDDEN", status: false });
      const bulk = await request(app).put("/orders-bulk").send({ orderIds: [7], orderData: { costPrice: 1 } });
      expect(bulk.status).toBe(403);
      expect((await request(app).put("/orders/7").send({ notes: "x" })).status).toBe(200);
    });
  });

  describe("permission catalog", () => {
    it("exposes the key with its Arabic label in the groups", () => {
      const all = (USER_PERMISSION_GROUPS as ReadonlyArray<{ permissions: ReadonlyArray<{ key: string; label: string }> }>).flatMap((group) => [...group.permissions]);
      expect(all.find((p) => p.key === "orders_edit_financials")).toEqual({
        key: "orders_edit_financials",
        label: "تعديل التفاصيل المالية للطلب",
      });
    });

    it("is granted to the admin template only", () => {
      const templates = USER_PERMISSION_TEMPLATES as unknown as Record<string, Record<string, boolean>>;
      expect(templates.admin?.orders_edit_financials).toBe(true);
      for (const [name, template] of Object.entries(templates)) {
        if (name !== "admin") expect(template.orders_edit_financials).toBeFalsy();
      }
    });
  });
});
