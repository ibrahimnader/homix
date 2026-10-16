export type ReassignmentLine = { productId: number; sku: string | null; quantity: number };

export const sameReassignmentItem = (
  source: ReassignmentLine[], target: ReassignmentLine[],
): boolean => source.length === 1 && target.length === 1
  && Number(source[0]!.productId) === Number(target[0]!.productId)
  && String(source[0]!.sku ?? "").trim() === String(target[0]!.sku ?? "").trim()
  && Number(source[0]!.quantity) === Number(target[0]!.quantity);
