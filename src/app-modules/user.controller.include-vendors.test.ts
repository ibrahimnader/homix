import path from "path";
import type { Request, Response } from "express";

import { loadModuleWithMocks } from "../test-utils/load-module-with-mocks";

const CONTROLLER_PATH = path.join(process.cwd(), "app/modules/user/user.controller.ts");

const load = () => {
  const service = {
    getAdminUsers: jest.fn().mockResolvedValue({ data: [{ id: 1, userType: "1" }], status: true, statusCode: 200 }),
    getAllUsers: jest.fn().mockResolvedValue({ data: [{ id: 1, userType: "1" }, { id: 2, userType: "2" }], status: true, statusCode: 200 }),
  };
  const controller = loadModuleWithMocks<{ getAllUsers: (req: Request, res: Response) => Promise<Response> }>(CONTROLLER_PATH, {
    "./user.service": service,
  });
  return { controller, service };
};

const call = async (controller: { getAllUsers: (req: Request, res: Response) => Promise<Response> }, query: Record<string, unknown>) => {
  const res = { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis() } as unknown as Response;
  await controller.getAllUsers({ query } as unknown as Request, res);
  return res;
};

describe("GET /users — includeVendors", () => {
  it("returns the team only by default (it feeds pickers such as the account manager)", async () => {
    const { controller, service } = load();
    await call(controller, {});
    expect(service.getAdminUsers).toHaveBeenCalledTimes(1);
    expect(service.getAllUsers).not.toHaveBeenCalled();
  });

  it("also returns the vendor accounts with includeVendors=true", async () => {
    const { controller, service } = load();
    const res = await call(controller, { includeVendors: "true" });
    expect(service.getAllUsers).toHaveBeenCalledTimes(1);
    expect(service.getAdminUsers).not.toHaveBeenCalled();
    expect((res.json as jest.Mock).mock.calls[0][0].data).toHaveLength(2);
  });

  it("ignores any other value", async () => {
    const { controller, service } = load();
    await call(controller, { includeVendors: "yes" });
    expect(service.getAdminUsers).toHaveBeenCalledTimes(1);
  });
});
