import { addSocketId, MAX_SOCKETS_PER_USER, removeSocketId } from "./socket-registry";

describe("socket registry", () => {
  it("adds a socket id to an empty or missing list", () => {
    expect(addSocketId(undefined, "a")).toEqual(["a"]);
    expect(addSocketId(null, "a")).toEqual(["a"]);
    expect(addSocketId([], "a")).toEqual(["a"]);
  });

  it("does not duplicate an id that is already registered (it moves to the end)", () => {
    expect(addSocketId(["a", "b"], "a")).toEqual(["b", "a"]);
  });

  it("keeps only the most recent ids so the column cannot grow without bound", () => {
    const many = Array.from({ length: 500 }, (_, index) => `old-${index}`);
    const result = addSocketId(many, "new");
    expect(result).toHaveLength(MAX_SOCKETS_PER_USER);
    expect(result[result.length - 1]).toBe("new");
    expect(result[0]).toBe("old-491");
  });

  it("removes only the disconnected id", () => {
    expect(removeSocketId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(removeSocketId(undefined, "b")).toEqual([]);
  });
});
