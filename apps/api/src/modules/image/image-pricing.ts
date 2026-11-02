export const IMAGE_QUALITY_FACTORS: Readonly<Record<string, number>> = { low: 1, medium: 1, high: 2, auto: 1 };

/** Admission and settlement use the same multiplier; settlement counts actual outputs. */
export function imageChargeUnits(count: number, quality: string): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.ceil(count * (IMAGE_QUALITY_FACTORS[quality] ?? 1));
}
