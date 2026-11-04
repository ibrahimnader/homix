import { ruleSchema } from "./fine.routes";

jest.mock("../../../app/middlewares/protectApi", () => (_req: unknown, _res: unknown, next: () => void) => next());
jest.mock("../../../app/middlewares/isNotVendor", () => (_req: unknown, _res: unknown, next: () => void) => next());
jest.mock("../../infrastructure/database", () => ({ sequelize: { query: jest.fn(), transaction: jest.fn() } }));

/* Exact bodies produced by Homix-system/src/layouts/Fines/fineRuleForm.ts buildPayload() for each
   "طريقة الحساب" option (see fineRuleForm.test.js there, which asserts the same shapes). */
const iso = "2026-10-01T07:30:00.000Z";
const base = { name: "قاعدة اختبار", description: "", trigger: "delivery_delay", amountType: "fixed", amount: 5, frequency: "once", basis: "cost", graceHours: 24, maxAmount: null, effectiveFrom: iso, active: true };
const MODAL_PAYLOADS: Record<string, Record<string, unknown>> = {
  fixed: base,
  percentage: { ...base, amountType: "percent", amount: 10, maxAmount: 500 },
  percentage_daily: { ...base, amountType: "percent", amount: 1, frequency: "daily", basis: "subtotal", maxAmount: 250 },
  tiered_daily: { ...base, frequency: "daily", maxAmount: 300 },
  commission_percent: { ...base, amountType: "percent", amount: 100, basis: "commission" },
};
const messages = (body: unknown) => {
  const result = ruleSchema.safeParse(body);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("fine rule schema accepts every modal option's real payload", () => {
  test.each(Object.keys(MODAL_PAYLOADS))("%s", (method) => {
    const payload = MODAL_PAYLOADS[method] as Record<string, unknown>;
    expect(ruleSchema.parse(payload)).toMatchObject({ amountType: payload.amountType, frequency: payload.frequency, basis: payload.basis, maxAmount: payload.maxAmount ?? null });
  });
  test.each(["delivery_delay", "late_cancellation", "customer_refusal", "manual"])("trigger %s", (trigger) => {
    expect(messages({ ...base, trigger, graceHours: trigger === "manual" ? 0 : 24 })).toEqual([]);
  });
  test("a toggled saved rule (DB numeric strings, null description) is accepted and normalised", () => {
    const parsed = ruleSchema.parse({ ...base, description: null, amount: "5.00", maxAmount: "250.00", graceHours: "24", extra: "ignored" });
    expect(parsed).toMatchObject({ description: "", amount: 5, maxAmount: 250, graceHours: 24 });
    expect(parsed).not.toHaveProperty("extra");
  });
  test("offset dates and omitted/empty cap are accepted", () => {
    expect(messages({ ...base, effectiveFrom: "2026-10-01T09:30:00+02:00" })).toEqual([]);
    const { maxAmount: _omit, ...withoutCap } = base;
    expect(ruleSchema.parse(withoutCap).maxAmount).toBeNull();
    expect(ruleSchema.parse({ ...base, maxAmount: "" }).maxAmount).toBeNull();
  });
});

describe("fine rule schema rejects bad input with polite Arabic messages", () => {
  test("name", () => {
    expect(messages({ ...base, name: "ا" })).toEqual(["اسم القاعدة: من فضلك أدخل حرفين على الأقل"]);
    expect(messages({ ...base, name: "   " })[0]).toMatch(/حرفين/);
    expect(messages({ ...base, name: undefined })[0]).toMatch(/مطلوب/);
  });
  test("amount: zero, negative, empty, NaN, too large", () => {
    expect(messages({ ...base, amount: 0 })[0]).toMatch(/أكبر من صفر/);
    expect(messages({ ...base, amount: -5 })[0]).toMatch(/أكبر من صفر/);
    expect(messages({ ...base, amount: "" })[0]).toMatch(/أكبر من صفر/);
    expect(messages({ ...base, amount: "abc" })[0]).toMatch(/رقمًا صحيحًا/);
    expect(messages({ ...base, amount: undefined })[0]).toMatch(/رقمًا صحيحًا|مطلوب/);
    expect(messages({ ...base, amount: 1e12 })[0]).toMatch(/كبيرة جدًا/);
  });
  test("percent must be within 0-100, fixed may exceed 100", () => {
    expect(messages({ ...base, amountType: "percent", amount: 100.01 })).toEqual(["النسبة المئوية: من فضلك أدخل قيمة بين 0 و100"]);
    expect(messages({ ...base, amountType: "percent", amount: 100 })).toEqual([]);
    expect(messages({ ...base, amountType: "fixed", amount: 150 })).toEqual([]);
  });
  test("grace hours must be a non-negative integer", () => {
    expect(messages({ ...base, graceHours: 1.5 })[0]).toMatch(/عددًا صحيحًا/);
    expect(messages({ ...base, graceHours: -1 })[0]).toMatch(/أقل من صفر/);
    expect(messages({ ...base, graceHours: 0 })).toEqual([]);
  });
  test("cap must be >= 0", () => {
    expect(messages({ ...base, maxAmount: -1 })[0]).toMatch(/أقل من صفر/);
    expect(messages({ ...base, maxAmount: 0 })).toEqual([]);
    expect(messages({ ...base, maxAmount: "x" })[0]).toMatch(/رقمًا صحيحًا/);
  });
  test("enums, date and active flag", () => {
    expect(messages({ ...base, trigger: "x" })[0]).toMatch(/سبب تطبيق الغرامة/);
    expect(messages({ ...base, amountType: "percentage" })[0]).toMatch(/طريقة الحساب/);
    expect(messages({ ...base, frequency: "weekly" })[0]).toMatch(/التكرار/);
    expect(messages({ ...base, basis: "timeBasis" })[0]).toMatch(/أساس الحساب/);
    expect(messages({ ...base, effectiveFrom: "2026-10-01" })[0]).toMatch(/تاريخ السريان غير صالح/);
    expect(messages({ ...base, effectiveFrom: "" })[0]).toMatch(/تاريخ السريان/);
    expect(messages({ ...base, active: "yes" })[0]).toMatch(/حالة التفعيل/);
  });
  test("no message is raw zod English", () => {
    const all = messages({ name: 1, description: 5, trigger: 1, amountType: 1, amount: {}, frequency: 1, basis: 1, graceHours: {}, maxAmount: {}, effectiveFrom: 1, active: 1 });
    expect(all.length).toBeGreaterThan(5);
    all.forEach((message) => expect(message).toMatch(/[؀-ۿ]/));
  });
});
