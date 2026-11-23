import bcrypt from "bcryptjs";

import { env } from "../../../src/config/env";
import { USER_TYPES } from "../../../config/constants";

const User = require("../user/user.model") as typeof import("../user/user.model");
const UserService = require("../user/user.service") as typeof import("../user/user.service");
const Notification = require("../notification/notification.model") as typeof import("../notification/notification.model");
const Vendor = require("./vendor.model") as typeof import("./vendor.model");

type VendorRecord = {
  accountManager?: UserRecord | null;
  accountManagerUserId?: number | null;
  active?: boolean;
  destroyed?: boolean;
  destroy: () => Promise<void>;
  email?: string;
  id: number;
  name: string;
  shippingCost?: number | string;
  toJSON: () => VendorRecord;
  update: (payload: Record<string, unknown>) => Promise<VendorRecord>;
};

type UserRecord = {
  deletedAt?: Date | null;
  destroy: () => Promise<void>;
  email?: string;
  firstName?: string;
  id: number;
  lastName?: string;
  restore?: () => Promise<void>;
  socketIds?: string[];
  vendorId?: number | null;
};

type VendorCreateInput = {
  active?: boolean;
  accountManager?: number | null;
  accountManagerUserId?: number | null;
  daysToDeliver?: number;
  email?: string;
  name: string;
  password?: string;
  shippingCost?: number | string;
};

type VendorUserUpdateInput = {
  active: boolean | undefined;
  email: string | undefined;
  name: string | undefined;
  password: string | undefined;
};

type VendorResponse = {
  data?: unknown;
  message?: string;
  status: boolean;
  statusCode: number;
};

const toUserSummary = (user?: UserRecord | null): { firstName: string; id: number; lastName: string } | null => {
  if (!user?.id) {
    return null;
  }

  return {
    firstName: user.firstName ?? "",
    id: user.id,
    lastName: user.lastName ?? "",
  };
};

const getAccountManagerUserId = (data: VendorCreateInput): number | null | undefined => {
  if (Object.prototype.hasOwnProperty.call(data, "accountManagerUserId")) {
    return data.accountManagerUserId ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(data, "accountManager")) {
    return data.accountManager ?? null;
  }

  return undefined;
};

const getAccountManagerLabel = (user?: UserRecord | null): string => {
  if (!user?.id) {
    return "";
  }

  return [user.firstName ?? "", user.lastName ?? ""].filter(Boolean).join(" ").trim();
};

const sanitizeVendorName = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9]/g, "");
};

const parseShippingCost = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const shippingCost = Number(value);
  return Number.isFinite(shippingCost) && shippingCost >= 0 ? shippingCost : Number.NaN;
};

class VendorsService {
  private static async notifyAdminsForNewVendor(vendor: VendorRecord): Promise<void> {
    const admins = (await User.findAll({
      attributes: ["id", "socketIds"],
      where: {
        userType: USER_TYPES.ADMIN,
      },
    })) as UserRecord[];

    if (admins.length === 0) {
      return;
    }

    const text = `تم إضافة بائع جديد: ${vendor.name}`;
    await Notification.bulkCreate(admins.map((admin) => ({
      entityId: vendor.id,
      entityType: "vendor",
      text,
      userId: admin.id,
    })));

    const socketIds = admins.flatMap((admin) => admin.socketIds ?? []);
    if (socketIds.length > 0 && global.socketIO && typeof global.socketIO.to === "function") {
      for (const socketId of socketIds) {
        global.socketIO.to(socketId).emit("notification", {
          entityId: vendor.id,
          entityType: "vendor",
          text,
          userId: null,
        });
      }
    }
  }

  public static async create(data: VendorCreateInput): Promise<VendorResponse> {
    const transaction = await Vendor.sequelize.transaction();
    const accountManagerUserId = getAccountManagerUserId(data);
    const shippingCost = parseShippingCost(data.shippingCost);

    try {
      if (Number.isNaN(shippingCost)) {
        await transaction.rollback();
        return {
          message: "Shipping cost must be a non-negative number",
          status: false,
          statusCode: 400,
        };
      }

      if (accountManagerUserId) {
        const accountManager = await User.findByPk(accountManagerUserId);
        if (!accountManager) {
          await transaction.rollback();
          return {
            message: "Account manager not found",
            status: false,
            statusCode: 404,
          };
        }
      }

      let vendor = (await Vendor.create({
        accountManagerUserId: accountManagerUserId ?? null,
        name: data.name,
        shippingCost: shippingCost ?? 0,
      })) as VendorRecord;

      const plainVendor = vendor.toJSON();
      plainVendor.name = sanitizeVendorName(plainVendor.name);

      const password = await bcrypt.hash(
        data.password
          ? data.password
          : `${UserService.capitalizeFirstLetter(plainVendor.name)}#${env.DEFAULT_PASSWORD}`,
        10,
      );

      const user = await UserService.addUser({
        email: data.email || `${plainVendor.name}@${env.SHOPIFY_STORE}.com`,
        firstName: plainVendor.name,
        password,
        userType: "2",
        vendorId: plainVendor.id,
      });

      if (!user?.status) {
        await transaction.rollback();
        return user;
      }

      const accountManager = accountManagerUserId
        ? ((await User.findByPk(accountManagerUserId)) as UserRecord | null)
        : null;

      await transaction.commit();
      await VendorsService.notifyAdminsForNewVendor(plainVendor);
      return {
        data: {
          ...plainVendor,
          active: true,
          accountManager: toUserSummary(accountManager),
          accountManagerLabel: getAccountManagerLabel(accountManager),
          accountManagerUserId: accountManagerUserId ?? null,
        },
        message: "Vendor created successfully",
        status: true,
        statusCode: 200,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public static async getOne(id: string): Promise<VendorResponse> {
    const vendor = (await Vendor.findByPk(id, {
      include: [
        {
          as: "accountManager",
          attributes: ["firstName", "id", "lastName"],
          model: User,
          required: false,
        },
      ],
    })) as VendorRecord | null;
    if (!vendor) {
      return {
        message: "Vendor not found",
        status: false,
        statusCode: 404,
      };
    }

    const vendorData = vendor.toJSON();
    const user = await UserService.getUserByVendorId(id);
    const accountManager = vendorData.accountManager ?? null;

    return {
      data: {
        ...vendorData,
        active: Boolean(user),
        accountManager: toUserSummary(accountManager),
        accountManagerLabel: getAccountManagerLabel(accountManager),
        email: user?.email,
        user,
      },
      status: true,
      statusCode: 200,
    };
  }

  public static async update(id: string, data: VendorCreateInput): Promise<VendorResponse> {
    const existingVendor = (await Vendor.findByPk(id)) as VendorRecord | null;
    if (!existingVendor) {
      return {
        message: "Vendor not found",
        status: false,
        statusCode: 404,
      };
    }

    const accountManagerUserId = getAccountManagerUserId(data);
    const shippingCost = parseShippingCost(data.shippingCost);

    if (Number.isNaN(shippingCost)) {
      return {
        message: "Shipping cost must be a non-negative number",
        status: false,
        statusCode: 400,
      };
    }

    if (accountManagerUserId) {
      const accountManager = await User.findByPk(accountManagerUserId);
      if (!accountManager) {
        return {
          message: "Account manager not found",
          status: false,
          statusCode: 404,
        };
      }
    }

    const user = await UserService.updateVendorUser(id, {
      active: data.active,
      email: data.email,
      name: data.name,
      password: data.password,
    } as VendorUserUpdateInput);
    const vendorPayload: Record<string, unknown> = {
      daysToDeliver: data.daysToDeliver,
      name: data.name,
    };

    if (accountManagerUserId !== undefined) {
      vendorPayload.accountManagerUserId = accountManagerUserId ?? null;
    }
    if (shippingCost !== undefined) {
      vendorPayload.shippingCost = shippingCost;
    }

    const vendor = await existingVendor.update(vendorPayload);
    const updatedVendor = vendor.toJSON();
    const accountManager = updatedVendor.accountManagerUserId
      ? ((await User.findByPk(updatedVendor.accountManagerUserId)) as UserRecord | null)
      : null;

    return {
      data: {
        ...updatedVendor,
        active: Boolean(user),
        accountManager: toUserSummary(accountManager),
        accountManagerLabel: getAccountManagerLabel(accountManager),
        user,
      },
      message: "Vendor updated successfully",
      status: true,
      statusCode: 200,
    };
  }

  public static async getExistingVendorsMap(names: string[]): Promise<Record<string, VendorRecord>> {
    const result: Record<string, VendorRecord> = {};
    const uniqueNames = [...new Set(names)];
    const existingVendors = (await Vendor.findAll({
      where: {
        name: uniqueNames,
      },
    })) as VendorRecord[];

    for (const vendor of existingVendors) {
      result[vendor.name] = vendor;
    }

    const existingVendorNames = new Set(existingVendors.map((vendor) => vendor.name));
    const createdVendors = uniqueNames.filter((name) => !existingVendorNames.has(name));

    if (createdVendors.length > 0) {
      const createdVendorsData = (await Vendor.bulkCreate(
        createdVendors.map((name) => ({ daysToDeliver: 0, name })),
      )) as VendorRecord[];

      createdVendorsData.forEach((vendor) => {
        result[vendor.name] = vendor;
      });
    }

    await UserService.saveUsersForVendorsWithNoUsers(Object.values(result));
    return result;
  }

  public static async getVendorByNameAndSaveIfNotExist(name: string): Promise<VendorRecord> {
    let vendor = (await Vendor.findOne({
      where: {
        name,
      },
    })) as VendorRecord | null;

    if (!vendor) {
      vendor = (await Vendor.create({ name })) as VendorRecord;
    }

    return vendor.toJSON();
  }

  public static async saveVendors(names: string[]): Promise<VendorRecord[]> {
    const vendors = (await Vendor.bulkCreate(names.map((name) => ({ name })))) as VendorRecord[];
    const plainVendors = vendors.map((vendor) => vendor.toJSON());
    await UserService.saveUsersForVendors(plainVendors);
    return plainVendors;
  }

  public static async getAllVendors(): Promise<VendorResponse> {
    const vendors = (await Vendor.findAll({
      include: [
        {
          // the list only needs the vendor login (email, active flag): never ship whole user rows
          as: "user",
          attributes: ["id", "email", "firstName", "lastName", "vendorId"],
          model: User,
          required: false,
        },
        {
          as: "accountManager",
          attributes: ["firstName", "id", "lastName"],
          model: User,
          required: false,
        },
      ],
    })) as Array<VendorRecord & { user?: UserRecord | null }>;

    return {
      data: vendors.map((vendor) => {
        const vendorData = vendor.toJSON() as VendorRecord & { user?: UserRecord | null };
        return {
          ...vendorData,
          active: Boolean(vendorData.user),
          accountManager: toUserSummary(vendorData.accountManager),
          accountManagerLabel: getAccountManagerLabel(vendorData.accountManager),
        };
      }),
      status: true,
      statusCode: 200,
    };
  }

  public static async delete(id: string): Promise<VendorResponse> {
    const vendor = (await Vendor.findByPk(id)) as VendorRecord | null;
    if (!vendor) {
      return {
        message: "Vendor not found",
        status: false,
        statusCode: 404,
      };
    }

    await vendor.destroy();
    const user = (await UserService.getUserByVendorId(id)) as UserRecord | null;
    if (user) {
      await user.destroy();
    }

    return {
      message: "Vendor deleted successfully",
      status: true,
      statusCode: 200,
    };
  }
}

export = VendorsService;
