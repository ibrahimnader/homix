import { Op, Transaction } from "sequelize";

import { sequelize } from "../../infrastructure/database";

const managedOptionModel = require("../../../app/modules/settings/managedOption.model");

export const MANAGED_OPTION_GROUP = {
  EXPENSE_TYPE: "expense_type",
  SELLER_CHAT_QUICK_REPLY: "seller_chat_quick_reply",
  TICKET_QUICK_REPLY: "ticket_quick_reply",
  TICKET_TYPE: "ticket_type",
} as const;

export type ManagedOptionGroup = typeof MANAGED_OPTION_GROUP[keyof typeof MANAGED_OPTION_GROUP];
export type ManagedOptionValue = { id: number; label: string };

const toPlain = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && "toJSON" in value && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return (value as { toJSON: () => Record<string, unknown> }).toJSON();
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
};

const mapOption = (value: unknown): ManagedOptionValue => {
  const row = toPlain(value);
  return { id: Number(row.optionId), label: String(row.label ?? "") };
};

export const listManagedOptions = async (
  optionGroup: ManagedOptionGroup,
  includeInactive = false,
): Promise<ManagedOptionValue[]> => {
  const rows = await managedOptionModel.findAll({
    order: [["sortOrder", "ASC"], ["optionId", "ASC"]],
    where: {
      optionGroup,
      ...(includeInactive ? {} : { active: true }),
    },
  });
  return rows.map(mapOption);
};

export const getManagedOptionLabels = async (optionGroup: ManagedOptionGroup): Promise<Record<number, string>> => {
  const options = await listManagedOptions(optionGroup, true);
  return Object.fromEntries(options.map((option) => [option.id, option.label]));
};

export const replaceManagedOptions = async (
  optionGroup: ManagedOptionGroup,
  input: Array<{ id?: number; label: string }>,
): Promise<ManagedOptionValue[]> => sequelize.transaction(async (transaction: Transaction) => {
  const normalized = input.map((option) => ({
    id: option.id ? Number(option.id) : undefined,
    label: String(option.label ?? "").trim(),
  })).filter((option) => option.label);
  const normalizedLabels = normalized.map((option) => option.label.toLocaleLowerCase("ar"));
  if (new Set(normalizedLabels).size !== normalizedLabels.length) {
    throw new Error("Option labels must be unique");
  }

  const existingRows = await managedOptionModel.findAll({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { optionGroup },
  });
  const existingById = new Map<number, any>(existingRows.map((row: unknown) => {
    const plain = toPlain(row);
    return [Number(plain.optionId), row];
  }));
  let nextId = Math.max(0, ...existingById.keys()) + 1;
  const retainedIds = new Set<number>();

  for (const [index, option] of normalized.entries()) {
    const existing = option.id ? existingById.get(option.id) : undefined;
    if (existing) {
      retainedIds.add(option.id as number);
      await existing.update({ active: true, label: option.label, sortOrder: index }, { transaction });
    } else {
      const optionId = nextId;
      nextId += 1;
      retainedIds.add(optionId);
      await managedOptionModel.create({ active: true, label: option.label, optionGroup, optionId, sortOrder: index }, { transaction });
    }
  }

  const removedIds = [...existingById.keys()].filter((id) => !retainedIds.has(id));
  if (removedIds.length > 0) {
    await managedOptionModel.update({ active: false }, {
      transaction,
      where: { optionGroup, optionId: { [Op.in]: removedIds } },
    });
  }

  const rows = await managedOptionModel.findAll({
    order: [["sortOrder", "ASC"], ["optionId", "ASC"]],
    transaction,
    where: { active: true, optionGroup },
  });
  return rows.map(mapOption);
});
