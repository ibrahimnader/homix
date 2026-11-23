import { buildLogMessage, normalizeOrderMutationPayload } from "./order.helpers";
import {
  INVOICE_NOTES_MAX_LENGTH,
  invoiceNotesSchema,
  orderBulkUpdateSchema,
  orderMutationSchema,
} from "./order.schemas";
import { restrictVendorOrderPayload } from "./order.service";

const requirePermission = require("../../../app/middlewares/requirePermission");

describe("order invoice draft notes", () => {
  describe("validation", () => {
    it("accepts text, blank and null", () => {
      expect(invoiceNotesSchema.safeParse("التسليم بعد الظهر").success).toBe(true);
      expect(invoiceNotesSchema.safeParse("").success).toBe(true);
      expect(invoiceNotesSchema.safeParse(null).success).toBe(true);
      expect(orderMutationSchema.safeParse({ invoiceNotes: "ok" }).success).toBe(true);
      expect(orderMutationSchema.safeParse({ status: 2 }).success).toBe(true);
    });

    it("rejects non-strings and notes that would not fit the one-page invoice", () => {
      expect(orderMutationSchema.safeParse({ invoiceNotes: 5 }).success).toBe(false);
      expect(orderMutationSchema.safeParse({ invoiceNotes: "x".repeat(INVOICE_NOTES_MAX_LENGTH + 1) }).success).toBe(false);
      expect(orderMutationSchema.safeParse({ invoiceNotes: "x".repeat(INVOICE_NOTES_MAX_LENGTH) }).success).toBe(true);
    });

    it("is not editable in bulk", () => {
      expect(orderBulkUpdateSchema.safeParse({ orderIds: [1], orderData: { invoiceNotes: "a" } }).success).toBe(false);
      expect(orderBulkUpdateSchema.safeParse({ orderIds: [1], orderData: { status: 2 } }).success).toBe(true);
    });
  });

  describe("normalisation", () => {
    it("trims, and turns blank into null so the note can be cleared", () => {
      expect(normalizeOrderMutationPayload({ invoiceNotes: "  مرحبا  " }, { status: 1 }).invoiceNotes).toBe("مرحبا");
      expect(normalizeOrderMutationPayload({ invoiceNotes: "   " }, { status: 1 }).invoiceNotes).toBeNull();
      expect(normalizeOrderMutationPayload({ invoiceNotes: null }, { status: 1 }).invoiceNotes).toBeNull();
    });

    it("leaves the field absent when not sent", () => {
      expect(normalizeOrderMutationPayload({ status: 2 }, { status: 1 })).not.toHaveProperty("invoiceNotes");
    });
  });

  describe("permission", () => {
    const run = (user: unknown) => {
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      const next = jest.fn();
      requirePermission("orders_edit")({ user }, res, next);
      return { next, res };
    };

    it("requires orders_edit, the permission of every other order edit", () => {
      expect(run({ userType: "2", permissions: { orders_view: true } }).res.status).toHaveBeenCalledWith(403);
      expect(run({ userType: "2", permissions: { orders_edit: true } }).next).toHaveBeenCalled();
    });

    it("is dropped from a vendor payload (staff only)", () => {
      const vendor = { id: 7, userType: "2" } as never;
      expect(restrictVendorOrderPayload({ invoiceNotes: "x", manufactureStatus: 3 }, vendor)).toEqual({ manufactureStatus: 3 });
      const admin = { id: 1, userType: "1" } as never;
      expect(restrictVendorOrderPayload({ invoiceNotes: "x" }, admin)).toEqual({ invoiceNotes: "x" });
    });
  });

  it("shows in the event log with its own label", () => {
    expect(buildLogMessage({ action: "update", field: "invoiceNotes", to: "التسليم بعد الظهر" })).toBe(
      "تم تحديث مسودة ملاحظات الفاتورة إلى التسليم بعد الظهر",
    );
    expect(buildLogMessage({ action: "update", field: "invoiceNotes", to: null })).toBe("تم تحديث مسودة ملاحظات الفاتورة");
  });
});
