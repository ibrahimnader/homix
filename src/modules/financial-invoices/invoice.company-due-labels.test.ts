import fs from "fs";
import path from "path";

/** Owner decision: the Homix margin is never shown, so no «هامش» label may appear in the financial-invoices module or the report export. */
describe("no «هامش» label in financial report / invoice sources", () => {
  const files = [
    ...fs.readdirSync(__dirname).filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name)).map((name) => path.join(__dirname, name)),
    path.join(__dirname, "..", "orders", "order.service.ts"),
  ];

  it("has none", () => {
    expect(files.length).toBeGreaterThan(5);
    files.forEach((file) => {
      expect(`${path.basename(file)}:${fs.readFileSync(file, "utf8").includes("هامش")}`).toBe(`${path.basename(file)}:false`);
    });
  });
});
