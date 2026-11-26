import express from "express";
import request from "supertest";

jest.mock("../../infrastructure/database", () => ({ sequelize: { query: jest.fn(), transaction: jest.fn() } }));
jest.mock("../../../config/fileUploadMiddleware", () => () => (_req: unknown, _res: unknown, next: () => void) => next());
jest.mock("../../../app/middlewares/protectApi", () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
  req.user = (global as unknown as { __user: never }).__user;
  next();
});
const reached = jest.fn();
jest.mock("./shipment.controller", () => ({
  ShipmentController: class {
    public constructor() {
      return new Proxy({}, { get: () => (_req: unknown, res: express.Response) => { reached(); res.json({ status: true }); } });
    }
  },
}));
jest.mock("./shipment.repo", () => ({ ShipmentRepository: class {} }));
jest.mock("./shipment.service", () => ({ ShipmentService: class {} }));

// eslint-disable-next-line import/first
import { shipmentRouter } from "./shipment.routes";

const everyPermission = new Proxy({}, { get: () => true });
const setUser = (user: Record<string, unknown>) => { (global as unknown as { __user: unknown }).__user = user; };
const buildApp = () => {
  const app = express();
  app.use(express.json());
  // same mount as app-router: verifyToken, isNotVendor, shipmentRouter
  app.use("/shipments", shipmentRouter);
  return app;
};

type RouteLayer = { route?: { path: string; methods: Record<string, boolean> }; name?: string; handle?: { stack?: RouteLayer[] } };
const collectRoutes = (stack: RouteLayer[], prefix = ""): Array<{ method: string; path: string }> => stack.flatMap((layer) => {
  if (layer.route) return Object.keys(layer.route.methods).map((method) => ({ method, path: prefix + layer.route!.path }));
  return [];
});

describe("every /shipments route (accounts «المبلغ المستلم», expenses, returns, receipts, reassignments) is closed to vendors", () => {
  const routes = collectRoutes((shipmentRouter as unknown as { stack: RouteLayer[] }).stack);
  const concrete = (path: string) => path.replace(/:\w+/g, "1");

  beforeEach(() => reached.mockClear());

  it("PUT /shipments/bulk-update with deliveryDate -> 403 for a vendor, handler never reached", async () => {
    setUser({ id: 9, permissions: everyPermission, userType: "2", vendorId: 4 });
    const response = await request(buildApp()).put("/shipments/bulk-update").send({ data: { deliveryDate: "2026-11-10" }, shipmentIds: [1] });
    expect(response.status).toBe(403);
    expect(reached).not.toHaveBeenCalled();
  });

  it("registers a meaningful number of routes (guards against the enumeration silently going empty)", () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes.map((r) => r.path)).toEqual(expect.arrayContaining(["/accounts/deliveries/:orderId", "/accounts/expenses", "/accounts/expenses/:expenseId"]));
  });

  it.each(routes.map((r) => [r.method.toUpperCase(), r.path]))("%s %s -> 403 for a vendor holding every permission, handler never reached", async (method, path) => {
    setUser({ id: 9, permissions: everyPermission, userType: "2", vendorId: 4 });
    const response = await (request(buildApp()) as unknown as Record<string, ((url: string) => request.Test) | undefined>)[method.toLowerCase()]!(`/shipments${concrete(path)}`).send({});
    expect(response.status).toBe(403);
    expect(reached).not.toHaveBeenCalled();
  });

  it("the nested receipts and reassignments routers are behind the same guard", async () => {
    setUser({ id: 9, permissions: everyPermission, userType: "2", vendorId: 4 });
    for (const call of [
      () => request(buildApp()).get("/shipments/receipts"),
      () => request(buildApp()).post("/shipments/receipts").send({ confirmRegression: true }),
      () => request(buildApp()).post("/shipments/receipts/5/cancel"),
      () => request(buildApp()).post("/shipments/reassignments").send({ confirmRegression: true }),
      () => request(buildApp()).get("/shipments/reassignments"),
    ]) {
      expect((await call()).status).toBe(403);
    }
  });

  it("an unknown user type is refused too (allow-list, not deny-list)", async () => {
    setUser({ id: 9, permissions: everyPermission, userType: "9" });
    expect((await request(buildApp()).put("/shipments/accounts/deliveries/1").send({ receivedAmount: 5 })).status).toBe(403);
  });

  it("staff without finance_settle cannot edit «المبلغ المستلم» or expenses; with it they reach the handler", async () => {
    setUser({ id: 3, permissions: { ship_delivery_accounts_view: true, ship_expenses_view: true }, userType: "4" });
    expect((await request(buildApp()).put("/shipments/accounts/deliveries/1").send({ receivedAmount: 5 })).status).toBe(403);
    expect((await request(buildApp()).post("/shipments/accounts/expenses").send({})).status).toBe(403);
    expect((await request(buildApp()).put("/shipments/accounts/expenses/1").send({ disbursementDate: "2026-11-01" })).status).toBe(403);
    expect(reached).not.toHaveBeenCalled();
    setUser({ id: 3, permissions: { finance_settle: true }, userType: "4" });
    expect((await request(buildApp()).put("/shipments/accounts/deliveries/1").send({ receivedAmount: 5 })).status).toBe(200);
  });
});
