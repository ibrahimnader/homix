import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Op } from "sequelize";

import { env } from "../../../src/config/env";
import { USER_TYPES } from "../../../config/constants";
import {
  buildUserActivityMessage,
  mapUserDetail,
  mapUserSummary,
  normalizeAccountStatus,
  normalizeEmail,
  normalizePermissions,
  sanitizeUserPayload,
  toPlainRecord,
  toText,
} from "./user.helpers";
import {
  USER_ACCOUNT_STATUSES,
  USER_PERMISSION_GROUPS,
  USER_PERMISSION_TEMPLATES,
  USER_ROLE_LABELS,
} from "./user.permissions";

const User = require("./user.model") as typeof import("./user.model");
const Vendor = require("../vendor/vendor.model") as typeof import("../vendor/vendor.model");
const Log = require("../logs/log.model") as typeof import("../logs/log.model");

type UserTypeValue = (typeof USER_TYPES)[keyof typeof USER_TYPES];

type UserRecord = {
  deletedAt?: Date | null;
  destroy: () => Promise<void>;
  email: string;
  id: number;
  password?: string;
  permissions?: Record<string, boolean>;
  restore: () => Promise<void>;
  toJSON: () => UserRecord;
  update: (payload: Record<string, unknown>) => Promise<UserRecord>;
  userType?: string;
  vendorId?: number | null;
};

type ActivityActor = {
  firstName?: string;
  id?: number;
  lastName?: string;
};

type VendorRecord = {
  id: number;
  name: string;
};

type UserResponse = {
  data?: unknown;
  message?: string;
  status: boolean;
  statusCode: number;
};

type AddUserInput = {
  accountStatus?: string;
  bankAccountHolderName?: string;
  bankAccountNumber?: string;
  bankAccountType?: string;
  bankName?: string;
  email?: string;
  firstName?: string;
  fullName?: string;
  instaPayNumber?: string;
  jobTitle?: string;
  lastName?: string;
  name?: string;
  password?: string;
  permissions?: Record<string, boolean>;
  phoneNumber?: string;
  roleName?: string;
  salary?: number;
  status?: string;
  userType?: string;
  vendorId?: number;
  walletNumber?: string;
};

type VendorUserUpdateInput = {
  active?: boolean;
  email?: string;
  name?: string;
  password?: string;
};

const toRecord = <TRecord>(value: TRecord | { toJSON: () => TRecord }): TRecord => (
  typeof (value as { toJSON?: () => TRecord }).toJSON === "function"
    ? (value as { toJSON: () => TRecord }).toJSON()
    : (value as TRecord)
);

class UserService {
  private static async createUserLog(userId: number, action: string, payload: { actorUserId?: number; field?: string; from?: string; to?: string } = {}): Promise<void> {
    await Log.create({
      action,
      entityId: userId,
      entityType: "user",
      field: payload.field ?? null,
      from: payload.from ?? null,
      to: payload.to ?? null,
      userId: payload.actorUserId ?? null,
    });
  }

  private static async getUserActivity(userId: number): Promise<Array<Record<string, unknown>>> {
    const logs = await Log.findAll({
      limit: 15,
      order: [["createdAt", "DESC"]],
      where: { entityId: userId, entityType: "user" },
    });
    const plainLogs = logs.map((log: unknown) => toPlainRecord(log));
    const actorIds = [...new Set(plainLogs.map((log: Record<string, unknown>) => Number(log.userId ?? 0)).filter(Boolean))];
    const actors = actorIds.length
      ? await User.findAll({ attributes: ["firstName", "id", "lastName"], where: { id: actorIds } })
      : [];
    const actorNames = new Map(
      actors.map((actor: ActivityActor) => [Number(actor.id ?? 0), [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim()]),
    );

    return plainLogs.map((log: Record<string, unknown>) => ({
      action: toText(log.action),
      actorName: actorNames.get(Number(log.userId ?? 0)) ?? "",
      createdAt: log.createdAt ?? null,
      field: toText(log.field),
      id: Number(log.id ?? 0),
      message: buildUserActivityMessage(log),
    }));
  }

  public static async login(email?: string, password?: string): Promise<UserResponse> {
    if (!email || !password) {
      return {
        message: "Email and password are required",
        status: false,
        statusCode: 400,
      };
    }

    const user = (await User.scope("withPassword").findOne({
      where: { email: normalizeEmail(email) },
    })) as UserRecord | null;

    if (!user?.password) {
      return {
        message: "Invalid email or password",
        status: false,
        statusCode: 401,
      };
    }

    const isMatch = await bcrypt.compare(String(password), String(user.password));
    if (!isMatch) {
      return {
        message: "Invalid email or password",
        status: false,
        statusCode: 401,
      };
    }

    const plainUser = toPlainRecord(user);
    const accountStatus = normalizeAccountStatus(plainUser, toText(plainUser.accountStatus));
    if (accountStatus !== USER_ACCOUNT_STATUSES.ACTIVE) {
      return {
        message: "User account is not active",
        status: false,
        statusCode: 403,
      };
    }

    await user.update({ lastSeenAt: new Date() });
    await UserService.createUserLog(user.id, "login", { actorUserId: user.id });

    const token = jwt.sign({ id: user.id }, env.JWT_SECRET, {
      expiresIn: "3d",
    });

    return {
      data: {
        token,
        user: mapUserDetail({ ...plainUser, lastSeenAt: new Date() }),
      },
      status: true,
      statusCode: 200,
    };
  }

  public static async addUser(body: AddUserInput, actorUserId?: number): Promise<UserResponse> {
    const { email, password } = body;

    if (!email || !password) {
      return {
        message: "Email and password are required",
        status: false,
        statusCode: 400,
      };
    }

    const existingUser = await User.findOne({
      paranoid: false,
      where: { email: normalizeEmail(email) },
    });
    if (existingUser) {
      return {
        message: "User already exists",
        status: false,
        statusCode: 409,
      };
    }

    if (!body.userType || !Object.values(USER_TYPES).includes(body.userType as UserTypeValue)) {
      return {
        message: "Invalid user type",
        status: false,
        statusCode: 400,
      };
    }

    const payload = sanitizeUserPayload({ ...body }, { isCreate: true });
    if (!toText(payload.firstName)) {
      return {
        message: "First name is required",
        status: false,
        statusCode: 400,
      };
    }

    const hashedPassword = await bcrypt.hash(String(password), 10);
    const newUser = await User.create({
      ...payload,
      email: normalizeEmail(email),
      lastPasswordChangeAt: new Date(),
      password: hashedPassword,
    });
    await UserService.createUserLog(Number(newUser.id), "create", { actorUserId });

    return {
      data: mapUserDetail(newUser),
      status: true,
      statusCode: 200,
    };
  }

  public static async getUser(id: string): Promise<UserResponse> {
    const user = await User.findByPk(id);
    if (!user) {
      return {
        message: "User not found",
        status: false,
        statusCode: 404,
      };
    }

    return {
      data: {
        ...mapUserDetail(user),
        activity: await UserService.getUserActivity(Number(id)),
      },
      status: true,
      statusCode: 200,
    };
  }

  public static async getMeta(): Promise<UserResponse> {
    return {
      data: {
        accountStatuses: [
          { id: USER_ACCOUNT_STATUSES.ACTIVE, label: "نشط" },
          { id: USER_ACCOUNT_STATUSES.INACTIVE, label: "غير نشط" },
          { id: USER_ACCOUNT_STATUSES.SUSPENDED, label: "موقوف" },
        ],
        permissionGroups: USER_PERMISSION_GROUPS,
        permissionTemplates: USER_PERMISSION_TEMPLATES,
        roleSuggestions: [
          { id: "admin", label: "مدير" },
          { id: "logistics", label: "لوجستي" },
          { id: "ops", label: "عمليات" },
          { id: "finance", label: "مالية" },
          { id: "support", label: "دعم" },
          { id: "vendor", label: "بائع" },
        ],
        userTypes: Object.entries(USER_TYPES).map(([key, value]) => ({
          id: value,
          key,
          label: USER_ROLE_LABELS[value as keyof typeof USER_ROLE_LABELS] ?? key,
        })),
      },
      status: true,
      statusCode: 200,
    };
  }

  public static async editUser(id: string, body: Record<string, unknown>, actorUserId?: number): Promise<UserResponse> {
    const user = (await User.findByPk(id)) as UserRecord | null;
    if (!user) {
      return {
        message: "User not found",
        status: false,
        statusCode: 404,
      };
    }

    const payload = sanitizeUserPayload(body, { current: toPlainRecord(user) });
    if (typeof payload.email === "string") {
      const existingUser = await User.findOne({
        paranoid: false,
        where: {
          email: payload.email,
          id: { [Op.ne]: Number(id) },
        },
      });

      if (existingUser) {
        return {
          message: "User already exists",
          status: false,
          statusCode: 409,
        };
      }
    }

    if (!toText(payload.userType) || !Object.values(USER_TYPES).includes(String(payload.userType) as UserTypeValue)) {
      return {
        message: "Invalid user type",
        status: false,
        statusCode: 400,
      };
    }

    if (typeof payload.password === "string" && payload.password) {
      payload.password = await bcrypt.hash(payload.password, 10);
    }

    const updatedUser = await user.update(payload);
    await UserService.createUserLog(Number(id), typeof body.password === "string" && body.password ? "password" : "update", {
      actorUserId,
      field: "profile",
    });
    return {
      data: mapUserDetail(updatedUser),
      status: true,
      statusCode: 200,
    };
  }

  public static async updateStatus(id: string, accountStatus: string, actorUserId?: number): Promise<UserResponse> {
    const user = (await User.findByPk(id)) as UserRecord | null;
    if (!user) {
      return {
        message: "User not found",
        status: false,
        statusCode: 404,
      };
    }

    if (!Object.values(USER_ACCOUNT_STATUSES).includes(accountStatus as never)) {
      return {
        message: "Invalid account status",
        status: false,
        statusCode: 400,
      };
    }

    const updatedUser = await user.update({ accountStatus });
    await UserService.createUserLog(Number(id), "status", {
      actorUserId,
      field: "accountStatus",
      from: toText(toPlainRecord(user).accountStatus),
      to: accountStatus,
    });
    return {
      data: mapUserDetail(updatedUser),
      status: true,
      statusCode: 200,
    };
  }

  public static async getAdminUsers(): Promise<UserResponse> {
    const users = await User.findAll({
      where: {
        userType: { [Op.not]: USER_TYPES.VENDOR },
      },
    });

    return {
      data: users.map((user: UserRecord) => mapUserSummary(user)),
      status: true,
      statusCode: 200,
    };
  }

  public static async getAllUsers(): Promise<UserResponse> {
    const users = await User.findAll();
    return {
      data: users.map((user: UserRecord) => mapUserSummary(user)),
      status: true,
      statusCode: 200,
    };
  }

  public static capitalizeFirstLetter(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  public static async saveUsersForVendorsWithNoUsers(createdVendors: VendorRecord[]): Promise<void> {
    const users = (await User.findAll({
      paranoid: false,
      where: { vendorId: createdVendors.map((vendor) => vendor.id) },
    })) as UserRecord[];

    const vendors = createdVendors.filter(
      (vendor) => !users.find((user) => user.vendorId === vendor.id),
    );

    await UserService.saveUsersForVendors(vendors);
  }

  public static async saveUsersForVendors(vendors: VendorRecord[]): Promise<UserRecord[]> {
    const namesSet = new Set<string>();
    let counter = 0;

    const promises = vendors.map(async (vendor) => {
      let vendorName = vendor.name.toLowerCase();
      if (namesSet.has(vendorName)) {
        vendorName = `${vendorName}${counter}`;
        counter += 1;
      }

      vendor.name = vendor.name.replace(/[^a-zA-Z0-9]/g, "");
      const password = await bcrypt.hash(
        `${UserService.capitalizeFirstLetter(vendor.name.toLowerCase())}#${env.DEFAULT_PASSWORD}`,
        10,
      );

      namesSet.add(vendorName);
      return User.create({
        email: `${vendorName}1@${env.SHOPIFY_STORE}.com`,
        firstName: vendor.name,
        permissions: normalizePermissions(undefined, USER_TYPES.VENDOR),
        password,
        userType: USER_TYPES.VENDOR,
        vendorId: vendor.id,
      });
    });

    return Promise.all(promises) as Promise<UserRecord[]>;
  }

  public static async getUserByVendorId(vendorId: string | number, withDeleted = false): Promise<UserRecord | null> {
    return (await User.findOne({
      paranoid: !withDeleted,
      where: { vendorId },
    })) as UserRecord | null;
  }

  public static async updateVendorUser(vendorId: string, input: VendorUserUpdateInput): Promise<UserRecord | null> {
    const payload: Record<string, unknown> = {};
    if (input.name) {
      payload.firstName = input.name;
    }
    if (input.password) {
      payload.password = await bcrypt.hash(input.password, 10);
    }
    if (input.email) {
      payload.email = input.email;
    }

    let user = (await User.findOne({
      paranoid: false,
      where: { vendorId: Number(vendorId) },
    })) as UserRecord | null;

    if (user && Object.keys(payload).length > 0) {
      user = await user.update(payload);
    }

    if (user?.deletedAt && input.active) {
      await User.restore({
        where: { vendorId: Number(vendorId) },
      });
    }

    return user ? toRecord(user) : null;
  }

  public static async changeActiveStatus(vendorId: string): Promise<UserResponse> {
    const transaction = await Vendor.sequelize.transaction();

    try {
      const vendor = (await Vendor.findOne({
        where: { id: vendorId },
      })) as VendorRecord | null;

      if (!vendor) {
        return {
          message: "Vendor not found",
          status: false,
          statusCode: 404,
        };
      }

      const user = (await User.findOne({
        paranoid: false,
        where: { vendorId },
      })) as UserRecord | null;

      if (user) {
        if (user.deletedAt) {
          await user.restore();
        } else {
          await user.destroy();
        }
      } else {
        const existingUser = (await User.findOne({
          paranoid: false,
          where: {
            email: `${vendor.name.toLowerCase()}@${env.SHOPIFY_STORE}.com`,
          },
        })) as UserRecord | null;

        if (existingUser) {
          await User.update(
            { deletedAt: null, vendorId: vendor.id },
            {
              where: {
                id: existingUser.id,
              },
            },
          );
        } else {
          await User.create({
            email: `${vendor.name.toLowerCase()}@${env.SHOPIFY_STORE}.com`,
            firstName: vendor.name,
            permissions: normalizePermissions(undefined, USER_TYPES.VENDOR),
            password: await bcrypt.hash(
              `${UserService.capitalizeFirstLetter(vendor.name.toLowerCase())}#${env.DEFAULT_PASSWORD}`,
              10,
            ),
            userType: USER_TYPES.VENDOR,
            vendorId: vendor.id,
          });
        }
      }

      await transaction.commit();
      return {
        message: "Vendor active status changed successfully",
        status: true,
        statusCode: 200,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public static async deleteUser(id: string, actorUserId?: number): Promise<UserResponse> {
    const user = (await User.findByPk(id)) as UserRecord | null;
    if (!user) {
      return {
        message: "User not found",
        status: false,
        statusCode: 404,
      };
    }

    await UserService.createUserLog(Number(id), "delete", { actorUserId });
    await user.destroy();
    return {
      message: "User deleted successfully",
      status: true,
      statusCode: 200,
    };
  }
}

export = UserService;
