import { mapSellerChatMessage } from "./order.helpers";

describe("mapSellerChatMessage", () => {
  it("exposes the author userId alongside the name so clients can tell own messages apart", () => {
    const message = mapSellerChatMessage({
      attachments: [],
      createdAt: new Date("2026-11-04T10:00:00Z"),
      id: 5,
      text: "تم التأكيد",
      user: { firstName: "Abdullah", lastName: "Ali" },
      userId: 42,
    });
    expect(message).toMatchObject({ id: 5, text: "تم التأكيد", userId: 42, userName: "Abdullah Ali" });
    expect(message.createdAt).toBe("2026-11-04T10:00:00.000Z");
  });

  it("falls back safely when the author row is missing", () => {
    expect(mapSellerChatMessage({ id: 1, text: "x", userId: 7 })).toMatchObject({ userId: 7, userName: "", attachments: [] });
  });
});
