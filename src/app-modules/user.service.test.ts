import path from "path";

import { loadModuleWithMocks } from "../test-utils/load-module-with-mocks";

const ROOT = process.cwd();
const USER_SERVICE_PATH = path.join(ROOT, "app/modules/user/user.service.ts");

describe("UserService", () => {
  it.each(["import", "activation"])("grants vendor access on %s account creation without internal privileges", async (path) => {
    const create = jest.fn().mockResolvedValue({ id: 20 });
    const transaction = { commit: jest.fn(), rollback: jest.fn() };
    const service = loadModuleWithMocks<typeof import("../../app/modules/user/user.service")>(
      USER_SERVICE_PATH,
      {
        "../logs/log.model": {},
        "../vendor/vendor.model": {
          findOne: jest.fn().mockResolvedValue({ id: 10, name: "Example" }),
          sequelize: { transaction: jest.fn().mockResolvedValue(transaction) },
        },
        "./user.model": { create, findOne: jest.fn().mockResolvedValue(null) },
      },
    );
    if (path === "import") {
      await service.saveUsersForVendors([{ id: 10, name: "Example" }]);
    } else {
      await service.changeActiveStatus("10");
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual(expect.objectContaining({
      vendorId: 10,
      userType: "2",
      permissions: expect.objectContaining({
        orders_view: true, orders_edit: true, products_view: true,
        dashboard_view: true, finance_settle: false, users_manage: false,
      }),
    }));
  });

  it("returns 400 when login credentials are missing", async () => {
    const service = loadModuleWithMocks<typeof import("../../app/modules/user/user.service")>(
      USER_SERVICE_PATH,
      {
        "../logs/log.model": { create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
        "../vendor/vendor.model": { sequelize: { transaction: jest.fn() } },
        "./user.model": {},
      },
    );

    await expect(service.login(undefined, undefined)).resolves.toEqual({
      message: "Email and password are required",
      status: false,
      statusCode: 400,
    });
  });

  it("returns 401 when login user does not exist", async () => {
    const userModelMock = {
      scope: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue(null),
      }),
    };
    const service = loadModuleWithMocks<typeof import("../../app/modules/user/user.service")>(
      USER_SERVICE_PATH,
      {
        "../logs/log.model": { create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
        "../vendor/vendor.model": { sequelize: { transaction: jest.fn() } },
        "./user.model": userModelMock,
      },
    );

    await expect(service.login("missing@example.com", "pw")).resolves.toEqual({
      message: "Invalid email or password",
      status: false,
      statusCode: 401,
    });
  });

  it("returns 400 when addUser gets an invalid user type", async () => {
    const userModelMock = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const service = loadModuleWithMocks<typeof import("../../app/modules/user/user.service")>(
      USER_SERVICE_PATH,
      {
        "../logs/log.model": { create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
        "../vendor/vendor.model": { sequelize: { transaction: jest.fn() } },
        "./user.model": userModelMock,
      },
    );

    await expect(
      service.addUser({
        email: "user@example.com",
        password: "secret",
        userType: "999",
      }),
    ).resolves.toEqual({
      message: "Invalid user type",
      status: false,
      statusCode: 400,
    });
  });

  it("maps extended profile fields and permissions when creating a user", async () => {
    const createdUser = {
      toJSON: () => ({
        accountStatus: "active",
        bankName: "بنك مصر",
        createdAt: "2026-07-16T00:00:00.000Z",
        email: "ops@homix.com",
        firstName: "Ibrahim",
        id: 5,
        lastName: "Mahmoud",
        permissions: { orders_view: true, orders_edit: true },
        roleName: "عمليات",
        userType: "3",
      }),
    };
    const userModelMock = {
      create: jest.fn().mockResolvedValue(createdUser),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const service = loadModuleWithMocks<typeof import("../../app/modules/user/user.service")>(
      USER_SERVICE_PATH,
      {
        "../logs/log.model": { create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
        "../vendor/vendor.model": { sequelize: { transaction: jest.fn() } },
        "./user.model": userModelMock,
      },
    );

    const response = await service.addUser({
      accountStatus: "active",
      bankName: "بنك مصر",
      email: "Ops@homix.com",
      fullName: "Ibrahim Mahmoud",
      password: "secret",
      roleName: "عمليات",
      userType: "3",
    });

    expect(userModelMock.create).toHaveBeenCalledWith(expect.objectContaining({
      accountStatus: "active",
      bankName: "بنك مصر",
      email: "ops@homix.com",
      firstName: "Ibrahim",
      lastName: "Mahmoud",
      permissions: expect.objectContaining({
        orders_create: true,
        orders_edit: true,
        orders_view: true,
      }),
      roleName: "عمليات",
      userType: "3",
    }));
    expect(response.status).toBe(true);
    expect(response.data).toEqual(expect.objectContaining({
      activePermissionsCount: expect.any(Number),
      bankName: "بنك مصر",
      fullName: "Ibrahim Mahmoud",
      roleName: "عمليات",
    }));
  });

  it("returns user metadata for the users screen", async () => {
    const service = loadModuleWithMocks<typeof import("../../app/modules/user/user.service")>(
      USER_SERVICE_PATH,
      {
        "../logs/log.model": { create: jest.fn(), findAll: jest.fn().mockResolvedValue([]) },
        "../vendor/vendor.model": { sequelize: { transaction: jest.fn() } },
        "./user.model": {},
      },
    );

    const response = await service.getMeta();

    expect(response.status).toBe(true);
    expect(response.data).toEqual(expect.objectContaining({
      accountStatuses: expect.arrayContaining([expect.objectContaining({ id: "active" })]),
      permissionGroups: expect.arrayContaining([expect.objectContaining({ key: "orders" })]),
      permissionTemplates: expect.objectContaining({ admin: expect.any(Object) }),
    }));
  });
});
