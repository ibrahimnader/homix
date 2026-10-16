import {
  CONFIRMATION_STATUS,
  CONFIRMATION_STATUS_ARABIC,
} from "../../config/constants";
import { getConfirmationLabel } from "./order.helpers";
import { orderListQuerySchema, orderMutationSchema } from "./order.schemas";

describe("order confirmation statuses", () => {
  it("exposes the eleven configured statuses in their display order", () => {
    expect(Object.values(CONFIRMATION_STATUS)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(Object.values(CONFIRMATION_STATUS_ARABIC)).toEqual([
      "معلق",
      "مؤكد",
      "لا يوجد رد (محاولة الأولى)",
      "لا يوجد رد (محاولة الثانية)",
      "لا يوجد رد (محاولة الثالثة)",
      "إعادة الاتصال لاحقًا",
      "ملغي (لا يوجد رد من العميل)",
      "ملغي (طلب وهمي)",
      "ملغي (تكرار الطلب)",
      "ملغي (ظروف خاصة)",
      "ملغي (تغيير رأي)",
    ]);
  });

  it("maps saved values and accepts confirmation status in order APIs", () => {
    expect(getConfirmationLabel(CONFIRMATION_STATUS.CONFIRMED)).toBe("مؤكد");
    expect(orderMutationSchema.parse({ confirmationStatus: 6 })).toEqual({ confirmationStatus: 6 });
    expect(orderListQuerySchema.parse({ confirmationStatus: "3,4", page: 1, size: 30 }).confirmationStatus).toBe("3,4");
  });
});
