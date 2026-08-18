import { Op } from "sequelize";

import { sequelize } from "../../infrastructure/database";
import { USER_TYPES } from "../../../config/constants";
import { buildLogMessage, getHistoryActorLabel } from "../orders/order.helpers";
import {
  getManagedOptionLabels,
  listManagedOptions,
  MANAGED_OPTION_GROUP,
  replaceManagedOptions,
  type ManagedOptionValue,
} from "../settings/managed-options";
import {
  OVERDUE_DAYS_THRESHOLD,
  TICKET_STATUS,
  TICKET_STATUS_ARABIC,
  TICKET_TYPE,
  TICKET_TYPE_ARABIC,
} from "./ticket.constants";
import type {
  TicketAttachment,
  TicketCreateInput,
  TicketDetails,
  TicketHistoryItem,
  TicketListFilters,
  TicketListResponse,
  TicketLookupResponse,
  TicketMetaResponse,
  TicketNote,
  TicketStatus,
  TicketSummary,
  TicketType,
  TicketUpdateInput,
  TicketUserSummary,
} from "./ticket.types";

type PlainRecord = Record<string, unknown>;
type Plainable = PlainRecord | { toJSON: () => PlainRecord };

type TicketRecord = Plainable & {
  destroy?: () => Promise<void>;
  save?: () => Promise<void>;
  update?: (payload: Record<string, unknown>) => Promise<unknown>;
};

type TicketModel = {
  create: (payload: Record<string, unknown>) => Promise<TicketRecord>;
  findAll: (options?: Record<string, unknown>) => Promise<TicketRecord[]>;
  findAndCountAll: (options?: Record<string, unknown>) => Promise<{ count: number; rows: TicketRecord[] }>;
  findOne: (options?: Record<string, unknown>) => Promise<TicketRecord | null>;
  findByPk: (id: number, options?: Record<string, unknown>) => Promise<TicketRecord | null>;
};

type NoteRecord = Plainable & {
  destroy?: () => Promise<void>;
  save?: () => Promise<void>;
  text?: string;
  userId?: number | string;
};

type NoteModel = {
  create: (payload: Record<string, unknown>) => Promise<NoteRecord>;
  findByPk: (id: number) => Promise<NoteRecord | null>;
};

type AttachmentRecord = Plainable & {
  destroy?: () => Promise<void>;
};

type AttachmentModel = {
  create: (payload: Record<string, unknown>) => Promise<AttachmentRecord>;
  findByPk: (id: number) => Promise<AttachmentRecord | null>;
};

type UserModel = {
  findAll: (options?: Record<string, unknown>) => Promise<Array<Plainable>>;
};

type LogRecord = Plainable & {
  save?: () => Promise<void>;
};

type LogModel = {
  bulkCreate: (payload: Array<Record<string, unknown>>) => Promise<unknown>;
  create: (payload: Record<string, unknown>) => Promise<LogRecord>;
  findAll: (options?: Record<string, unknown>) => Promise<LogRecord[]>;
};

type OrderModel = {
  findOne: (options?: Record<string, unknown>) => Promise<Plainable | null>;
};

const ticketModel = require("../../../app/modules/tickets/ticket.model") as TicketModel;
const noteModel = require("../../../app/modules/notes/notes.model") as NoteModel;
const attachmentModel = require("../../../app/modules/attachments/attachment.model") as AttachmentModel;
const orderModel = require("../../../app/modules/order/order.model") as OrderModel;
const userModel = require("../../../app/modules/user/user.model") as UserModel;
const logModel = require("../../../app/modules/logs/log.model") as LogModel;
const customerModel = require("../../../app/modules/customer/customer.model");
const orderLineModel = require("../../../app/modules/orderLines/orderline.model");
const productModel = require("../../../app/modules/product/product.model");
const vendorModel = require("../../../app/modules/vendor/vendor.model");

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const toPlain = (row: Plainable | null | undefined): PlainRecord => {
  if (!row) {
    return {};
  }

  return "toJSON" in row && typeof row.toJSON === "function" ? row.toJSON() : row;
};

const toUserSummary = (value: unknown): TicketUserSummary | null => {
  const user = value && typeof value === "object" ? (value as PlainRecord) : null;
  if (!user) {
    return null;
  }

  const id = Number(user.id ?? 0);
  if (id < 1) {
    return null;
  }

  return {
    firstName: typeof user.firstName === "string" ? user.firstName : "",
    id,
    lastName: typeof user.lastName === "string" ? user.lastName : "",
  };
};

const toIsoString = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const parseNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : 0;
  }

  return 0;
};

const getText = (value: unknown, fallback = ""): string => {
  return typeof value === "string" ? value : fallback;
};

const normalizeOperationCode = (value: string): string => {
  return value.trim().replace(/^OP-/i, "");
};

const getDaysBetween = (start: unknown, end: unknown): number => {
  const startDate = new Date(String(start ?? ""));
  const endDate = new Date(String(end ?? ""));
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 0;
  }

  return Math.max(0, Math.ceil((endDate.getTime() - startDate.getTime()) / DAY_IN_MILLISECONDS));
};

const mapOrderSummary = (value: unknown): TicketLookupResponse => {
  const order = value && typeof value === "object" ? (value as PlainRecord) : {};
  const orderLines = Array.isArray(order.orderLines) ? (order.orderLines as PlainRecord[]) : [];
  const firstLine = orderLines[0] ?? {};
  const product = firstLine.product && typeof firstLine.product === "object"
    ? (firstLine.product as PlainRecord)
    : {};
  const vendor = product.vendor && typeof product.vendor === "object"
    ? (product.vendor as PlainRecord)
    : {};
  const customer = order.customer && typeof order.customer === "object"
    ? (order.customer as PlainRecord)
    : {};

  return {
    customerName: `${getText(customer.firstName)} ${getText(customer.lastName)}`.trim(),
    id: Number(order.id ?? 0),
    operationNumber: getText(order.code),
    orderNumber: getText(order.orderNumber, getText(order.number, getText(order.name))),
    productName: getText(product.title, getText(firstLine.title, "منتج")),
    productSku: getText(firstLine.sku),
    sellerName: getText(vendor.name, "غير محدد"),
  };
};

const mapTicketNote = (value: unknown): TicketNote => {
  const note = value && typeof value === "object" ? (value as PlainRecord) : {};

  return {
    createdAt: toIsoString(note.createdAt),
    id: Number(note.id ?? 0),
    text: getText(note.text),
    updatedAt: toIsoString(note.updatedAt),
    user: toUserSummary(note.user),
  };
};

const mapTicketAttachment = (value: unknown): TicketAttachment => {
  const attachment = value && typeof value === "object" ? (value as PlainRecord) : {};

  return {
    createdAt: toIsoString(attachment.createdAt),
    description: getText(attachment.description),
    id: Number(attachment.id ?? 0),
    name: getText(attachment.name),
    url: getText(attachment.url),
  };
};

const buildTicketHistoryMessage = (log: PlainRecord): string => {
  const field = getText(log.field);
  const action = getText(log.action);

  if (action === "create" && field === "ticket_created") {
    return "تم إنشاء التذكرة";
  }

  if (action === "create" && field === "ticket_note") {
    return "تمت إضافة ملاحظة";
  }

  if (action === "update" && field === "ticket_note") {
    return "تم تحديث الملاحظة";
  }

  if (action === "delete" && field === "ticket_note") {
    return "تم حذف الملاحظة";
  }

  if (action === "create" && field === "ticket_attachment") {
    return "تمت إضافة مرفق";
  }

  if (action === "delete" && field === "ticket_attachment") {
    return "تم حذف المرفق";
  }

  return buildLogMessage(log);
};

const buildTicketHistoryEventType = (log: PlainRecord): string => {
  const field = getText(log.field);
  const action = getText(log.action);

  if (action === "create" && field === "ticket_created") {
    return "ticket_created";
  }

  if (action === "create" && field === "ticket_note") {
    return "note_added";
  }

  if (action === "update" && field === "ticket_note") {
    return "note_updated";
  }

  if (action === "delete" && field === "ticket_note") {
    return "note_deleted";
  }

  if (action === "create" && field === "ticket_attachment") {
    return "attachment_added";
  }

  if (action === "delete" && field === "ticket_attachment") {
    return "attachment_deleted";
  }

  if (field === "status") {
    return "status_updated";
  }

  return "ticket_updated";
};

const mapTicketHistoryItem = (
  value: unknown,
  usersById: Map<number, TicketUserSummary>,
): TicketHistoryItem => {
  const log = value && typeof value === "object" ? (value as PlainRecord) : {};
  const user = usersById.get(Number(log.userId ?? 0)) ?? null;

  return {
    changedAt: toIsoString(log.createdAt),
    description: getHistoryActorLabel(
      user ? `${user.firstName} ${user.lastName}`.trim() : "",
    ),
    eventType: buildTicketHistoryEventType(log),
    field: getText(log.field),
    fromValue: getText(log.from),
    id: Number(log.id ?? 0),
    message: buildTicketHistoryMessage(log),
    toValue: getText(log.to),
    user,
  };
};

const getLatestReplyText = (
  notes: unknown[],
  userId: number | null,
): string => {
  if (!userId) {
    return "";
  }

  const matchedNotes = notes
    .map((note) => note && typeof note === "object" ? (note as PlainRecord) : {})
    .filter((note) => Number(note.userId ?? 0) === userId)
    .sort((left, right) => toIsoString(right.createdAt).localeCompare(toIsoString(left.createdAt)));

  return getText(matchedNotes[0]?.text);
};

const mapTicketSummary = (value: unknown, typeLabels: Record<number, string> = TICKET_TYPE_ARABIC): TicketSummary => {
  const ticket = value && typeof value === "object" ? (value as PlainRecord) : {};
  const createdAt = toIsoString(ticket.createdAt);
  const closedAt = toIsoString(ticket.closedAt) || null;
  const status = (parseNumber(ticket.status) || TICKET_STATUS.OPEN) as TicketStatus;
  const notesList = Array.isArray(ticket.notesList) ? (ticket.notesList as unknown[]) : [];
  const createdByUserId = Number(ticket.createdByUserId ?? 0) || null;
  const assignedToUserId = Number(ticket.assignedToUserId ?? 0) || null;

  return {
    assignedTo: toUserSummary(ticket.assignee),
    assigneeReply: getLatestReplyText(notesList, assignedToUserId),
    closedAt,
    createdAt,
    creatorReply: getLatestReplyText(notesList, createdByUserId),
    daysOpen: getDaysBetween(createdAt, closedAt ?? new Date().toISOString()),
    id: Number(ticket.id ?? 0),
    notes: getText(ticket.notes),
    order: mapOrderSummary(ticket.linkedOrder ?? ticket.order),
    status,
    statusLabel: TICKET_STATUS_ARABIC[status] ?? String(status),
    type: (parseNumber(ticket.type) || TICKET_TYPE.DELIVERY_DELAY) as TicketType,
    typeLabel: typeLabels[parseNumber(ticket.type) || TICKET_TYPE.DELIVERY_DELAY]
      ?? TICKET_TYPE_ARABIC[(parseNumber(ticket.type) || TICKET_TYPE.DELIVERY_DELAY) as keyof typeof TICKET_TYPE_ARABIC]
      ?? "",
  };
};

const mapTicketDetails = (
  value: unknown,
  history: TicketHistoryItem[] = [],
  typeLabels: Record<number, string> = TICKET_TYPE_ARABIC,
): TicketDetails => {
  const ticket = value && typeof value === "object" ? (value as PlainRecord) : {};

  return {
    ...mapTicketSummary(ticket, typeLabels),
    attachments: Array.isArray(ticket.attachments)
      ? (ticket.attachments as unknown[]).map((attachment) => mapTicketAttachment(attachment))
      : [],
    createdBy: toUserSummary(ticket.creator),
    notesList: Array.isArray(ticket.notesList)
      ? (ticket.notesList as unknown[])
        .map((note) => mapTicketNote(note))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      : [],
    history,
  };
};

const buildOrderInclude = (vendorId?: number | null, includeCustomer = true): Record<string, unknown> => {
  return {
    as: "linkedOrder",
    attributes: ["id", "code", "customerId", "name", "number", "orderNumber"],
    include: [
      includeCustomer
        ? {
            as: "customer",
            attributes: ["firstName", "lastName"],
            model: customerModel,
            required: false,
          }
        : null,
      {
        as: "orderLines",
        attributes: ["id", "sku", "title"],
        include: [
          {
            as: "product",
            attributes: ["id", "title"],
            include: [
              {
                as: "vendor",
                attributes: ["id", "name"],
                model: vendorModel,
                required: false,
              },
            ],
            model: productModel,
            required: Boolean(vendorId),
            where: vendorId ? { vendorId } : undefined,
          },
        ],
        model: orderLineModel,
        required: Boolean(vendorId),
      },
    ].filter(Boolean),
    model: orderModel,
    required: true,
  };
};

const buildDirectOrderInclude = (vendorId?: number | null, includeCustomer = true): Record<string, unknown>[] => {
  return [
    includeCustomer
      ? {
          as: "customer",
          attributes: ["firstName", "lastName"],
          model: customerModel,
          required: false,
        }
      : null,
    {
      as: "orderLines",
      attributes: ["id", "sku", "title"],
      include: [
        {
          as: "product",
          attributes: ["id", "title"],
          include: [
            {
              as: "vendor",
              attributes: ["id", "name"],
              model: vendorModel,
              required: false,
            },
          ],
          model: productModel,
          required: Boolean(vendorId),
          where: vendorId ? { vendorId } : undefined,
        },
      ],
      model: orderLineModel,
      required: Boolean(vendorId),
    },
  ].filter(Boolean) as Record<string, unknown>[];
};

const buildListWhere = (filters: TicketListFilters): Record<string, unknown> => {
  const where: Record<string, unknown> = {};

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.type) {
    where.type = filters.type;
  }

  if (filters.assignedToUserId) {
    where.assignedToUserId = filters.assignedToUserId;
  }

  if (filters.startDate || filters.endDate) {
    const createdAt: Record<symbol, Date> = {} as Record<symbol, Date>;
    if (filters.startDate) {
      createdAt[Op.gte] = new Date(filters.startDate);
    }
    if (filters.endDate) {
      createdAt[Op.lte] = new Date(filters.endDate);
    }
    where.createdAt = createdAt;
  }

  return where;
};

const buildOrderWhere = (filters: {
  operationNumber?: string;
  orderNumber?: string;
}): Record<string, unknown> | undefined => {
  const andConditions: unknown[] = [];

  if (filters.operationNumber) {
    andConditions.push({
      code: {
        [Op.like]: `%${normalizeOperationCode(filters.operationNumber)}%`,
      },
    });
  }

  if (filters.orderNumber) {
    andConditions.push({
      [Op.or]: [
        {
          orderNumber: {
            [Op.like]: `%${filters.orderNumber}%`,
          },
        },
        {
          number: {
            [Op.like]: `%${filters.orderNumber}%`,
          },
        },
        sequelize.where(sequelize.fn("lower", sequelize.col("linkedOrder.name")), {
          [Op.like]: `%${filters.orderNumber.toLowerCase()}%`,
        }),
      ],
    });
  }

  if (andConditions.length === 0) {
    return undefined;
  }

  return {
    [Op.and]: andConditions,
  };
};

export class TicketRepository {
  public async getMeta(): Promise<TicketMetaResponse> {
    const [users, types, quickReplies] = await Promise.all([userModel.findAll({
      attributes: ["id", "firstName", "lastName"],
      order: [["firstName", "ASC"]],
      where: {
        userType: {
          [Op.ne]: USER_TYPES.VENDOR,
        },
      },
    }), listManagedOptions(MANAGED_OPTION_GROUP.TICKET_TYPE), listManagedOptions(MANAGED_OPTION_GROUP.TICKET_QUICK_REPLY)]);

    return {
      assignees: users
        .map((user) => toUserSummary(toPlain(user)))
        .filter((user): user is TicketUserSummary => user !== null),
      statuses: Object.entries(TICKET_STATUS_ARABIC).map(([key, label]) => ({
        key: Number(key) as TicketSummary["status"],
        label,
      })),
      quickReplies: quickReplies.map(({ id, label }) => ({ key: id, label })),
      types: types.map(({ id, label }) => ({ key: id, label })),
    };
  }

  public async updateSettings(payload: {
    quickReplies: Array<{ id?: number; label: string }>;
    types: Array<{ id?: number; label: string }>;
  }): Promise<{ quickReplies: ManagedOptionValue[]; types: ManagedOptionValue[] }> {
    const [types, quickReplies] = await Promise.all([
      replaceManagedOptions(MANAGED_OPTION_GROUP.TICKET_TYPE, payload.types),
      replaceManagedOptions(MANAGED_OPTION_GROUP.TICKET_QUICK_REPLY, payload.quickReplies),
    ]);
    return { quickReplies, types };
  }

  public async hasTicketType(type: number): Promise<boolean> {
    const types = await listManagedOptions(MANAGED_OPTION_GROUP.TICKET_TYPE);
    return types.some((option) => option.id === type);
  }

  public async lookupOrderByOperationNumber(
    operationNumber: string,
    vendorId?: number | null,
  ): Promise<TicketLookupResponse | null> {
    const normalizedOperationNumber = normalizeOperationCode(operationNumber);
    const order = await orderModel.findOne({
      include: buildDirectOrderInclude(vendorId),
      where: {
        code: {
          [Op.like]: `%${normalizedOperationNumber}%`,
        },
      },
    });

    if (!order) {
      return null;
    }

    return mapOrderSummary(toPlain(order));
  }

  public async lookupOrderByOrderNumber(
    orderNumber: string,
    vendorId?: number | null,
  ): Promise<TicketLookupResponse | null> {
    const normalizedOrderNumber = orderNumber.trim();
    const order = await orderModel.findOne({
      include: buildDirectOrderInclude(vendorId),
      where: {
        [Op.or]: [
          {
            orderNumber: {
              [Op.like]: `%${normalizedOrderNumber}%`,
            },
          },
          {
            number: {
              [Op.like]: `%${normalizedOrderNumber}%`,
            },
          },
          sequelize.where(sequelize.fn("lower", sequelize.col("name")), {
            [Op.like]: `%${normalizedOrderNumber.toLowerCase()}%`,
          }),
        ],
      },
    });

    if (!order) {
      return null;
    }

    return mapOrderSummary(toPlain(order));
  }

  public async createTicket(
    payload: TicketCreateInput & { createdByUserId?: number },
  ): Promise<{ id: number }> {
    const createdTicket = await ticketModel.create({
      assignedToUserId: payload.assignedToUserId ?? null,
      createdByUserId: payload.createdByUserId ?? null,
      notes: payload.notes ?? "",
      orderId: payload.orderId,
      status: TICKET_STATUS.OPEN,
      type: payload.type,
    });

    return {
      id: Number(toPlain(createdTicket).id ?? 0),
    };
  }

  public async listTickets(
    filters: TicketListFilters,
    vendorId?: number | null,
  ): Promise<TicketListResponse> {
    const include = [
      {
        as: "assignee",
        attributes: ["id", "firstName", "lastName"],
        model: userModel,
        required: false,
      },
      {
        as: "notesList",
        attributes: ["id", "text", "userId", "createdAt"],
        model: noteModel,
        required: false,
        separate: true,
      },
      {
        ...buildOrderInclude(vendorId),
        where: buildOrderWhere(filters),
      },
    ];
    const where = buildListWhere(filters);
    const [result, typeLabels] = await Promise.all([ticketModel.findAndCountAll({
      distinct: true,
      include,
      limit: filters.size,
      offset: (filters.page - 1) * filters.size,
      order: [["createdAt", "DESC"]],
      where,
    }), getManagedOptionLabels(MANAGED_OPTION_GROUP.TICKET_TYPE)]);

    const items = result.rows.map((row) => mapTicketSummary(toPlain(row), typeLabels));
    const allRows = await ticketModel.findAll({
      distinct: true,
      include,
      order: [["createdAt", "DESC"]],
      where,
    });
    const allItems = allRows.map((row) => mapTicketSummary(toPlain(row), typeLabels));
    const closedItems = allItems.filter((item) => item.status === TICKET_STATUS.CLOSED);
    const averageResolutionDays = closedItems.length > 0
      ? Math.round(
        (closedItems.reduce((sum, item) => sum + item.daysOpen, 0) / closedItems.length) * 10,
      ) / 10
      : 0;

    return {
      items,
      page: filters.page,
      size: filters.size,
      summary: {
        averageResolutionDays,
        closed: allItems.filter((item) => item.status === TICKET_STATUS.CLOSED).length,
        open: allItems.filter((item) => item.status === TICKET_STATUS.OPEN).length,
        overdueOpen: allItems.filter(
          (item) => item.status === TICKET_STATUS.OPEN && item.daysOpen > OVERDUE_DAYS_THRESHOLD,
        ).length,
        total: allItems.length,
      },
      totalCount: result.count,
    };
  }

  public async getTicketById(
    ticketId: number,
    vendorId?: number | null,
  ): Promise<TicketDetails | null> {
    const ticket = await ticketModel.findOne({
      include: [
        {
          as: "assignee",
          attributes: ["id", "firstName", "lastName"],
          model: userModel,
          required: false,
        },
        {
          as: "creator",
          attributes: ["id", "firstName", "lastName"],
          model: userModel,
          required: false,
        },
        {
          as: "notesList",
          include: [
            {
              as: "user",
              attributes: ["id", "firstName", "lastName"],
              model: userModel,
              required: false,
            },
          ],
          model: noteModel,
          required: false,
          separate: true,
        },
        {
          as: "attachments",
          model: attachmentModel,
          required: false,
        },
        buildOrderInclude(vendorId),
      ],
      where: {
        id: ticketId,
      },
    });

    if (!ticket) {
      return null;
    }

    const logs = await logModel.findAll({
      order: [["createdAt", "DESC"]],
      where: { entityId: ticketId, entityType: "ticket" },
    });
    const userIds = logs
      .map((log) => Number(toPlain(log).userId ?? 0))
      .filter((id) => id > 0);
    const users = userIds.length > 0
      ? await userModel.findAll({ attributes: ["id", "firstName", "lastName"], where: { id: { [Op.in]: userIds } } })
      : [];
    const usersById = new Map<number, TicketUserSummary>(
      users
        .map((user) => toUserSummary(toPlain(user)))
        .filter((user): user is TicketUserSummary => user !== null)
        .map((user) => [user.id, user]),
    );

    const typeLabels = await getManagedOptionLabels(MANAGED_OPTION_GROUP.TICKET_TYPE);
    return mapTicketDetails(
      toPlain(ticket),
      logs.map((log) => mapTicketHistoryItem(toPlain(log), usersById)),
      typeLabels,
    );
  }

  public async getRawTicketById(
    ticketId: number,
    vendorId?: number | null,
  ): Promise<TicketRecord | null> {
    return ticketModel.findOne({
      include: [buildOrderInclude(vendorId, false)],
      where: {
        id: ticketId,
      },
    });
  }

  public async updateTicket(ticketId: number, payload: TicketUpdateInput): Promise<void> {
    const ticket = await ticketModel.findByPk(ticketId);
    if (!ticket || typeof ticket.update !== "function") {
      return;
    }

    await ticket.update(payload as Record<string, unknown>);
  }

  /** Ticket is paranoid, so this is a soft delete (sets deletedAt). */
  public async deleteTicket(ticketId: number): Promise<boolean> {
    const ticket = await ticketModel.findByPk(ticketId);
    if (!ticket || typeof ticket.destroy !== "function") {
      return false;
    }

    await ticket.destroy();
    return true;
  }

  public async createLogs(entries: Array<Record<string, unknown>>): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await logModel.bulkCreate(entries);
  }

  public async createNote(ticketId: number, text: string, userId: number): Promise<TicketNote> {
    const note = await noteModel.create({
      entityId: ticketId,
      entityType: "ticket",
      text,
      userId,
    });

    return mapTicketNote(toPlain(note));
  }

  public async getNoteById(noteId: number): Promise<NoteRecord | null> {
    return noteModel.findByPk(noteId);
  }

  public async updateNote(note: NoteRecord, text: string): Promise<TicketNote> {
    note.text = text;
    if (typeof note.save === "function") {
      await note.save();
    }

    return mapTicketNote(toPlain(note));
  }

  public async deleteNote(note: NoteRecord): Promise<void> {
    if (typeof note.destroy === "function") {
      await note.destroy();
    }
  }

  public async addAttachments(
    ticketId: number,
    filePaths: string[] = [],
    fileNames: string[] = [],
    descriptions: string[] = [],
  ): Promise<TicketAttachment[]> {
    const attachments: TicketAttachment[] = [];

    for (let index = 0; index < filePaths.length; index += 1) {
      const attachment = await attachmentModel.create({
        description: descriptions[index] ?? "",
        modelId: ticketId,
        modelType: "Ticket",
        name: fileNames[index] ?? "",
        url: filePaths[index] ?? "",
      });
      attachments.push(mapTicketAttachment(toPlain(attachment)));
    }

    return attachments;
  }

  public async getAttachmentById(attachmentId: number): Promise<AttachmentRecord | null> {
    return attachmentModel.findByPk(attachmentId);
  }

  public async deleteAttachment(attachment: AttachmentRecord): Promise<void> {
    if (typeof attachment.destroy === "function") {
      await attachment.destroy();
    }
  }

  public async hasAssignee(userId: number): Promise<boolean> {
    const users = await userModel.findAll({
      attributes: ["id"],
      where: {
        id: userId,
        userType: {
          [Op.ne]: USER_TYPES.VENDOR,
        },
      },
    });

    return users.length > 0;
  }

  public async hasOrder(orderId: number, vendorId?: number | null): Promise<boolean> {
    const order = await orderModel.findOne({
      include: buildDirectOrderInclude(vendorId, false),
      where: {
        id: orderId,
      },
    });

    return Boolean(order);
  }

}
