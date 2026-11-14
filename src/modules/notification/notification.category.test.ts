import { getNotificationCategory } from "./notification.category";

describe("getNotificationCategory", () => {
  it.each([
    ["order", "orders"],
    ["orderLine", "orders"],
    ["vendor", "orders"],
    ["shipment", "shipments"],
    ["Shipments", "shipments"],
    ["ticket", "tickets"],
    ["", "orders"],
    [null, "orders"],
  ])("maps %p to %s", (entityType, category) => {
    expect(getNotificationCategory(entityType as string | null)).toBe(category);
  });
});
