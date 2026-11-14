import path from "node:path";
import swaggerJsDoc from "swagger-jsdoc";

/* A YAML error in any route doc is only logged at boot (the route silently disappears
   from /api-docs), so guard it here with the same globs app-router.ts uses. */
describe("swagger route docs", () => {
  it("parse without YAML errors", () => {
    const root = path.resolve(__dirname, "../..");
    const spec = swaggerJsDoc({
      apis: [
        path.join(root, "app/modules/*/*.routes.js"),
        path.join(root, "app/modules/*/*.routes.ts"),
        path.join(root, "src/modules/**/*.routes.ts"),
      ],
      definition: { info: { title: "t", version: "1" }, openapi: "3.0.0" },
      failOnErrors: true,
    }) as { paths?: Record<string, unknown> };
    expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThan(50);
  });
});
