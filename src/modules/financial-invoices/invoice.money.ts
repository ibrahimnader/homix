/** Money is handled as integer piasters to avoid float drift; stored as NUMERIC(14,2). */
export const toCents = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
};

export const fromCents = (cents: number): number => Math.round(cents) / 100;
