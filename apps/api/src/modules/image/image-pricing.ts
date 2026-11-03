export const IMAGE_QUALITY_FACTORS: Readonly<Record<string, number>> = { low: 1, medium: 1, high: 2, auto: 1 };

/** Admission and settlement use the same multiplier; settlement counts actual outputs. */
export function imageChargeUnits(count: number, quality: string): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.ceil(count * (IMAGE_QUALITY_FACTORS[quality] ?? 1));
}

/** Unavailable prices stay distinct from an explicitly free creation. */
export function imageUnitCost(enabled: boolean, demo: boolean, value: unknown, quality: string): number | null {
  if (!enabled || demo) return 0;
  if (value === null || value === undefined || !['number', 'string'].includes(typeof value) || typeof value === 'string' && !value.trim()) return null;
  const cost = Number(value), unitCost = cost * imageChargeUnits(1, quality);
  return Number.isSafeInteger(cost) && cost >= 0 && Number.isSafeInteger(unitCost) && unitCost * 4 <= 2_147_483_647 ? unitCost : null;
}
