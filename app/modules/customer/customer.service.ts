const ShopifyHelper = require("../helpers/shopifyHelper") as typeof import("../helpers/shopifyHelper");
const Customer = require("./customer.model") as typeof import("./customer.model");
const { sequelize } = require("../../../src/infrastructure/database");
const { QueryTypes } = require("sequelize");
import { NotFoundError } from "../../../src/shared/errors";
import type { Result } from "../../../src/shared/result";
import { success } from "../../../src/shared/result";
import { governorateDisplayLabel } from "../../../src/shared/governorate/governorate.resolver";
import type { CustomerCreateInput, CustomerListQuery, CustomerUpdateInput } from "./customer.schemas";

type CustomerAddress = {
  address1?: string;
  address2?: string;
  city?: string;
  country?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  phone?: string;
  province?: string;
};

type CustomerInput = {
  address1?: string;
  address2?: string;
  city?: string;
  country?: string;
  default_address?: CustomerAddress;
  email?: string;
  firstName?: string;
  first_name?: string;
  id?: number | string;
  lastName?: string;
  last_name?: string;
  phone?: string;
  province?: string;
};

type PersistedCustomer = {
  address?: string | null;
  address2?: string | null;
  email?: string | null;
  firstName?: string | null;
  id: number;
  lastName?: string | null;
  phoneNumber?: string | null;
  shopifyId?: string | null;
  updatedAt?: string | Date | null;
  toJSON: () => PersistedCustomer;
};

type CustomerPayload = {
  address: string;
  email: string;
  firstName: string | undefined;
  lastName: string | undefined;
  phoneNumber: string;
  shopifyId: string | null;
};

const formatAddress = (customer: CustomerInput): string => {
  if (customer.default_address) {
    const address = customer.default_address;
    return `${address.address1 ?? ""} ${address.address2 ?? ""}-${address.city ?? ""}-${address.province ?? ""}-${address.country ?? ""}`;
  }

  return `${customer.address1 ?? ""} ${customer.address2 ?? ""}-${customer.city ?? ""}-${customer.province ?? ""}-${customer.country ?? ""}`;
};

const toCustomerPayload = (customer: CustomerInput): CustomerPayload => {
  return {
    address: formatAddress(customer),
    email: customer.email ?? customer.default_address?.email ?? "",
    firstName:
      customer.firstName ??
      customer.first_name ??
      customer.default_address?.first_name ??
      customer.default_address?.name,
    lastName: customer.lastName ?? customer.last_name ?? customer.default_address?.last_name,
    phoneNumber: customer.phone ?? customer.default_address?.phone ?? "",
    shopifyId: customer.id ? String(customer.id) : null,
  };
};

const customerKey = (customer: {
  email?: string | null;
  firstName?: string | null;
  id?: number;
  lastName?: string | null;
  phoneNumber?: string | null;
  shopifyId?: string | null;
}): string => {
  return customer.shopifyId
    ? customer.shopifyId
    : `${customer.firstName ?? ""}${customer.lastName ?? ""}${customer.email ?? ""}${customer.phoneNumber ?? ""}`;
};

type CustomerListRow = {
  address: string | null;
  createdAt: string;
  email: string | null;
  firstName: string | null;
  id: number;
  lastName: string | null;
  lastOrderDate: string | null;
  ordersCount: number;
  phoneNumber: string | null;
  shopifyId: string | null;
  totalSpend: number;
};

const CUSTOMER_SORT_COLUMNS: Record<CustomerListQuery["sort"], string> = {
  orders: "\"ordersCount\" DESC, c.\"createdAt\" DESC",
  recent: "c.\"createdAt\" DESC",
  spend: "\"totalSpend\" DESC, c.\"createdAt\" DESC",
};

const customerListWhere = (search?: string) => {
  const conditions = [`c."deletedAt" IS NULL`];
  if (search?.trim()) {
    conditions.push(`(
      c."firstName" ILIKE :search OR c."lastName" ILIKE :search OR c.email ILIKE :search
      OR c."phoneNumber" ILIKE :search OR c.address ILIKE :search
    )`);
  }
  return conditions.join(" AND ");
};

const mapCustomerListRow = (row: CustomerListRow) => ({
  address: row.address ?? "",
  createdAt: row.createdAt,
  email: row.email ?? "",
  firstName: row.firstName ?? "",
  governorate: governorateDisplayLabel(row.address),
  id: row.id,
  isManual: !row.shopifyId,
  lastName: row.lastName ?? "",
  lastOrderDate: row.lastOrderDate,
  ordersCount: Number(row.ordersCount) || 0,
  phoneNumber: row.phoneNumber ?? "",
  totalSpend: Number(row.totalSpend) || 0,
});

class CustomerService {
  public static async importCustomers(parameters: Record<string, unknown>) {
    const fields: string[] = [];
    const customers = (await ShopifyHelper.importData("customers", fields, parameters)) as CustomerInput[];
    return CustomerService.saveImportedCustomers(customers);
  }

  public static async saveImportedCustomers(customers: CustomerInput[]) {
    const existingCustomers = (await Customer.findAll({
      attributes: ["shopifyId"],
      where: {
        shopifyId: customers.map((customer) => String(customer.id)),
      },
    })) as Array<{ shopifyId?: string | null }>;

    const existingShopifyIds = new Set(
      existingCustomers
        .map((customer) => customer.shopifyId ?? null)
        .filter((shopifyId): shopifyId is string => Boolean(shopifyId)),
    );

    const payload = customers
      .filter((customer) => !existingShopifyIds.has(String(customer.id)))
      .map((customer) => toCustomerPayload(customer));

    const importedCustomers = await Customer.bulkCreate(payload, {
      updateOnDuplicate: [
        "shopifyId",
        "firstName",
        "lastName",
        "email",
        "phoneNumber",
        "address",
      ],
    });

    return {
      data: importedCustomers,
      message: "Customers imported successfully",
      status: true,
      statusCode: 200,
    };
  }

  public static async getCustomersMappedByNames(customers: CustomerInput[]): Promise<Record<string, number>> {
    const customerIds = customers
      .filter((customer) => customer.id)
      .map((customer) => String(customer.id));

    const customersFromDb = (await Customer.findAll({
      attributes: ["shopifyId", "id", "firstName", "lastName", "email", "phoneNumber"],
      where: {
        shopifyId: customerIds,
      },
    })) as PersistedCustomer[];

    const result: Record<string, number> = {};
    const existingShopifyIds = new Set<string>();

    for (const customer of customersFromDb) {
      result[customerKey(customer)] = customer.id;
      if (customer.shopifyId) {
        existingShopifyIds.add(customer.shopifyId);
      }
    }

    const nonExistingCustomers = customers.filter(
      (customer) => !customer.id || !existingShopifyIds.has(String(customer.id)),
    );

    if (nonExistingCustomers.length === 0) {
      return result;
    }

    const savedCustomers = await CustomerService.saveCustomers(nonExistingCustomers);
    for (const customer of savedCustomers) {
      result[customerKey(customer)] = customer.id;
    }

    return result;
  }

  public static async saveCustomers(customers: CustomerInput[]): Promise<PersistedCustomer[]> {
    const payload = customers.map((customer) => toCustomerPayload(customer));
    const createdCustomers = (await Customer.bulkCreate(payload, {
      updateOnDuplicate: [
        "shopifyId",
        "firstName",
        "lastName",
        "email",
        "phoneNumber",
        "address",
      ],
    })) as PersistedCustomer[];

    return createdCustomers.map((customer) => customer.toJSON());
  }

  public static async updateCustomer(
    customerId: number,
    payload: CustomerUpdateInput,
  ): Promise<Result<Record<string, unknown>>> {
    const customer = (await Customer.findByPk(customerId)) as
      | (PersistedCustomer & { update: (values: Record<string, unknown>) => Promise<unknown> })
      | null;

    if (!customer) {
      throw new NotFoundError("Customer not found");
    }

    const updatePayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );

    await customer.update(updatePayload);
    const plainCustomer = customer.toJSON();

    return success({
      address: plainCustomer.address ?? null,
      address2: plainCustomer.address2 ?? null,
      email: plainCustomer.email ?? null,
      firstName: plainCustomer.firstName ?? null,
      id: plainCustomer.id,
      lastName: plainCustomer.lastName ?? null,
      phoneNumber: plainCustomer.phoneNumber ?? null,
      shopifyId: plainCustomer.shopifyId ?? null,
      updatedAt: plainCustomer.updatedAt ?? null,
    });
  }

  public static async listCustomers(filters: CustomerListQuery): Promise<Result<{
    items: ReturnType<typeof mapCustomerListRow>[];
    page: number;
    size: number;
    totalCount: number;
  }>> {
    const where = customerListWhere(filters.search);
    const replacements = {
      offset: (filters.page - 1) * filters.size,
      search: filters.search?.trim() ? `%${filters.search.trim()}%` : null,
      size: filters.size,
    };

    const rows = (await sequelize.query(
      `SELECT c.id, c."firstName", c."lastName", c."phoneNumber", c.email, c.address,
        c."shopifyId", c."createdAt",
        COUNT(o.id)::int AS "ordersCount",
        COALESCE(SUM(o."totalPrice"), 0)::float AS "totalSpend",
        MAX(o."orderDate") AS "lastOrderDate"
      FROM customers c
      LEFT JOIN orders o ON o."customerId" = c.id AND o."deletedAt" IS NULL
      WHERE ${where}
      GROUP BY c.id
      ORDER BY ${CUSTOMER_SORT_COLUMNS[filters.sort]}
      LIMIT :size OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT },
    )) as CustomerListRow[];

    const [countRow] = (await sequelize.query(
      `SELECT COUNT(*)::int AS total FROM customers c WHERE ${where}`,
      { replacements, type: QueryTypes.SELECT },
    )) as Array<{ total: number }>;

    return success({
      items: rows.map(mapCustomerListRow),
      page: filters.page,
      size: filters.size,
      totalCount: countRow?.total ?? 0,
    });
  }

  public static async getCustomersSummary(): Promise<Result<{
    topSpender: { name: string; totalSpend: number } | null;
    totalCustomers: number;
    totalSpend: number;
  }>> {
    const [row] = (await sequelize.query(
      `SELECT COUNT(DISTINCT c.id)::int AS "totalCustomers",
        COALESCE(SUM(o."totalPrice"), 0)::float AS "totalSpend"
      FROM customers c
      LEFT JOIN orders o ON o."customerId" = c.id AND o."deletedAt" IS NULL
      WHERE c."deletedAt" IS NULL`,
      { type: QueryTypes.SELECT },
    )) as Array<{ totalCustomers: number; totalSpend: number }>;

    const [topSpenderRow] = (await sequelize.query(
      `SELECT c."firstName", c."lastName", COALESCE(SUM(o."totalPrice"), 0)::float AS "totalSpend"
      FROM customers c
      JOIN orders o ON o."customerId" = c.id AND o."deletedAt" IS NULL
      WHERE c."deletedAt" IS NULL
      GROUP BY c.id
      ORDER BY "totalSpend" DESC
      LIMIT 1`,
      { type: QueryTypes.SELECT },
    )) as Array<{ firstName: string | null; lastName: string | null; totalSpend: number }>;

    return success({
      topSpender: topSpenderRow
        ? { name: `${topSpenderRow.firstName ?? ""} ${topSpenderRow.lastName ?? ""}`.trim(), totalSpend: Number(topSpenderRow.totalSpend) || 0 }
        : null,
      totalCustomers: Number(row?.totalCustomers) || 0,
      totalSpend: Number(row?.totalSpend) || 0,
    });
  }

  /** Manual customers (no shopifyId) — created by HOMIX staff, not synced from Shopify. */
  public static async createCustomer(payload: CustomerCreateInput): Promise<Result<Record<string, unknown>>> {
    const customer = await Customer.create({
      address: payload.address || null,
      email: payload.email || null,
      firstName: payload.firstName,
      lastName: payload.lastName || null,
      phoneNumber: payload.phoneNumber,
      shopifyId: null,
    });
    const plainCustomer = customer.toJSON();

    return success({
      address: plainCustomer.address ?? null,
      createdAt: plainCustomer.createdAt ?? null,
      email: plainCustomer.email ?? null,
      firstName: plainCustomer.firstName ?? null,
      id: plainCustomer.id,
      lastName: plainCustomer.lastName ?? null,
      phoneNumber: plainCustomer.phoneNumber ?? null,
      shopifyId: null,
    });
  }

  public static async exportCustomers(response: unknown, filters: Omit<CustomerListQuery, "page" | "size">): Promise<void> {
    const ExcelJS = require("exceljs") as typeof import("exceljs");
    const res = response as { setHeader: (key: string, value: string) => void; end: () => void };
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=customers.xlsx");

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: response as never });
    const worksheet = workbook.addWorksheet("customers");
    worksheet.columns = [
      { header: "اسم العميل", key: "name", width: 26 },
      { header: "البريد الإلكتروني", key: "email", width: 26 },
      { header: "رقم الموبايل", key: "phoneNumber", width: 18 },
      { header: "العنوان", key: "address", width: 36 },
      { header: "المحافظة", key: "governorate", width: 16 },
      { header: "عدد الطلبات", key: "ordersCount", width: 14 },
      { header: "إجمالي الإنفاق", key: "totalSpend", width: 16 },
      { header: "تاريخ الانضمام", key: "createdAt", width: 18 },
      { header: "المصدر", key: "source", width: 14 },
    ].map((column) => ({ ...column, style: { alignment: { horizontal: "right" } } }));

    const where = customerListWhere(filters.search);
    const replacements = { search: filters.search?.trim() ? `%${filters.search.trim()}%` : null };
    const rows = (await sequelize.query(
      `SELECT c.id, c."firstName", c."lastName", c."phoneNumber", c.email, c.address,
        c."shopifyId", c."createdAt",
        COUNT(o.id)::int AS "ordersCount",
        COALESCE(SUM(o."totalPrice"), 0)::float AS "totalSpend",
        MAX(o."orderDate") AS "lastOrderDate"
      FROM customers c
      LEFT JOIN orders o ON o."customerId" = c.id AND o."deletedAt" IS NULL
      WHERE ${where}
      GROUP BY c.id
      ORDER BY c."createdAt" DESC`,
      { replacements, type: QueryTypes.SELECT },
    )) as CustomerListRow[];

    for (const row of rows.map(mapCustomerListRow)) {
      worksheet.addRow({
        address: row.address,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString().slice(0, 10) : "",
        email: row.email,
        governorate: row.governorate,
        name: `${row.firstName} ${row.lastName}`.trim(),
        ordersCount: row.ordersCount,
        phoneNumber: row.phoneNumber,
        source: row.isManual ? "يدوي" : "Shopify",
        totalSpend: row.totalSpend,
      });
    }

    await workbook.commit();
    (response as { end: () => void }).end();
  }
}

export = CustomerService;
