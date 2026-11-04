import express from "express";
import request from "supertest";

import { ForbiddenError } from "../../shared/errors";
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
const VENDOR = { id: 2, userType: "2", permissions: { orders_edit: true, orders_edit_financials: true } };
const OPERATOR_NO_KEY = { id: 3, userType: "3", permissions: { orders_edit: true } };
const OPERATOR_WITH_KEY = { id: 4, userType: "3", permissions: { orders_edit: true, orders_edit_financials: true } };

const STORED = { id: 7, costPrice: "500.00", shippingFees: "50", totalDiscounts: "100", downPayment: "200" };
const FIELDS = ["costPrice", "shippingFees", "totalDiscounts", "downPayment"] as const;

const build = () => {
  const repository = {
    findOrderEntity: jest.fn().mockResolvedValue(STORED),
    findOrderEntities: jest.fn().mockResolvedValue([]),
  };
  const gateway = {
    updateOrder: jest.fn().mockResolvedValue({ data: { id: 7 }, status: true, statusCode: 200 }),
    bulkUpdate: jest.fn().mockResolvedValue({ message: "ok", status: true, statusCode: 200 }),
  };
  const service = new OrderService(repository as never, gateway as never);
  return { gateway, service };
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

    it("does not affect payloads without financial fields", async () => {
      const { gateway, service } = build();
      await expect(service.bulkUpdate({ orderIds: [7], orderData: { priority: 2 } } as never, OPERATOR_NO_KEY as never)).resolves.toMatchObject({ ok: true });
      expect(gateway.bulkUpdate).toHaveBeenCalledTimes(1);
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
