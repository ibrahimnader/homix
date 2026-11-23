const mockFindByPk = jest.fn();
jest.mock("../../app/modules/user/user.model", () => ({ findByPk: (...args: unknown[]) => mockFindByPk(...args), findOne: jest.fn() }));
jest.mock("jsonwebtoken", () => ({ verify: jest.fn(() => ({ id: 1 })) }));

const verifyToken = require("../../app/middlewares/protectApi");
const isNotVendor = require("../../app/middlewares/isNotVendor");

const run = async (middleware: (req: any, res: any, next: any) => unknown, req: Record<string, unknown>) => {
  const res: any = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await middleware(req, res, next);
  return { next, res };
};

describe("protectApi: a vendor without vendorId is never treated as unscoped staff", () => {
  const original = process.env.NODE_ENV;
  beforeAll(() => { process.env.NODE_ENV = "production"; process.env.JWT_SECRET = "x"; });
  afterAll(() => { process.env.NODE_ENV = original; });

  it("403s a vendor account with no vendorId", async () => {
    mockFindByPk.mockResolvedValue({ id: 1, userType: "2", vendorId: null });
    const { next, res } = await run(verifyToken, { headers: { authorization: "Bearer t" } });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("scopes a vendor with a vendorId, and leaves staff unscoped", async () => {
    mockFindByPk.mockResolvedValue({ id: 1, userType: "2", vendorId: 4 });
    const vendorReq: any = { headers: { authorization: "Bearer t" } };
    expect((await run(verifyToken, vendorReq)).next).toHaveBeenCalled();
    expect(vendorReq.vendorId).toBe(4);
    mockFindByPk.mockResolvedValue({ id: 2, userType: "1", vendorId: null });
    const staffReq: any = { headers: { authorization: "Bearer t" } };
    await run(verifyToken, staffReq);
    expect(staffReq.vendorId).toBeNull();
  });
});

describe("isNotVendor answers a real 403 (it used to answer 200 {status:false})", () => {
  it.each(["1", "3", "4"])("lets userType %s through", async (userType) => {
    expect((await run(isNotVendor, { user: { userType } })).next).toHaveBeenCalled();
  });
  it.each(["2", "9", undefined])("403s userType %s", async (userType) => {
    const { next, res } = await run(isNotVendor, { user: { userType } });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
