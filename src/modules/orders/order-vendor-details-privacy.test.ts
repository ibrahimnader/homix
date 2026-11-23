const mockOrder = {
  customer: {}, id: 7, invoiceNotes: "مسودة سرية", notesList: [], orderDate: "2026-01-01T00:00:00.000Z", orderLines: [], status: 2, user: {},
};
const mockLogs = [
  { action: "update", createdAt: "2026-01-02T00:00:00.000Z", field: "invoiceNotes", id: 1, to: "مسودة سرية", userId: 3 },
  { action: "update", createdAt: "2026-01-03T00:00:00.000Z", field: "manufactureStatus", from: 1, id: 2, to: 2, userId: 3 },
];

jest.mock("../../infrastructure/database", () => ({ sequelize: { col: jest.fn(), fn: jest.fn(), literal: jest.fn(), query: jest.fn(), where: jest.fn() } }));
jest.mock("../../../app/modules/order/order.model", () => ({ findOne: jest.fn(async () => mockOrder) }));
jest.mock("../../../app/modules/logs/log.model", () => ({ findAll: jest.fn(async () => mockLogs) }));
jest.mock("../../../app/modules/user/user.model", () => ({ findAll: jest.fn(async () => []) }));
jest.mock("../../../app/modules/vendor/vendor.model", () => ({ findAll: jest.fn(async () => []) }));
for (const model of ["orderLines/orderline", "product/product", "customer/customer", "notes/notes", "attachments/attachment", "product/productType"]) {
  const [dir, file] = model.split("/");
  jest.doMock(`../../../app/modules/${dir}/${file}.model`, () => ({ findAll: jest.fn(async () => []) }));
}
jest.mock("../dashboard/dashboard-daily-metric.model", () => ({}));
jest.mock("../settings/managed-options", () => ({ listManagedOptions: jest.fn(), MANAGED_OPTION_GROUP: {}, replaceManagedOptions: jest.fn() }));

// eslint-disable-next-line import/first
import { OrderRepository } from "./order.repo";

/** The staff-only invoice draft note («مسودة ملاحظات») must never reach a vendor: not as a field, not through the event log. */
describe("OrderRepository.getOrderById invoiceNotes", () => {
  it("staff read the note", async () => {
    const details = await new OrderRepository().getOrderById(7, null);
    expect(details?.order.invoiceNotes).toBe("مسودة سرية");
  });

  it("a vendor reads an empty note and the event log hides the invoiceNotes entries", async () => {
    const details = await new OrderRepository().getOrderById(7, 1);
    expect(details?.order.invoiceNotes).toBe("");
    const serialised = JSON.stringify(details);
    expect(serialised).not.toContain("مسودة سرية");
    expect(serialised).not.toContain("مسودة ملاحظات الفاتورة");
  });
});
