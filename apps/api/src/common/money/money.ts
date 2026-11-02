/**
 * 金额工具（纯函数，无依赖，便于单测）
 *
 * 项目里有两套货币单位，边界只在本文件与 LedgerService 之间：
 *   - 微单位 micros：1 元 = 1_000_000 微。用于「单次用量成本」（UsageRecord.costMicros、
 *     AiModel.priceInPerM），因为它需要表达 0.0001 元级别的单价且总量有界（Int 上限约 2147 元）。
 *   - 分 cents：1 元 = 100 分。用于「钱包余额 / 订单金额 / 佣金」，因为它需要表达
 *     累计金额（Int 上限约 2147 万元）且必须是精确的 2 位小数。
 *
 * 换算只在「一次扣费落账」时发生，且一律向上取整到分：宁可多收不到 1 分，
 * 也不能因为浮点/截断让平台长期漏收（对账时会体现为 0 差异，因为取整是确定性的）。
 */

/** 1 分 = 10000 微 */
export const MICROS_PER_CENT = 10_000;

/** 微单位 → 分，向上取整（micros <= 0 时返回 0） */
export function microsToCents(micros: number): number {
  if (!Number.isFinite(micros) || micros <= 0) return 0;
  return Math.ceil(micros / MICROS_PER_CENT);
}

/** 分 → 微单位 */
export function centsToMicros(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents * MICROS_PER_CENT);
}

/**
 * 把用户/管理员输入的金额解析成分。
 * 接受 number 与 string，最多两位小数，拒绝负数、NaN、空串、超过两位小数的输入。
 * 非法输入返回 null（由调用方抛业务异常，避免静默改金额）。
 */
export function yuanToCents(input: unknown): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    const cents = Math.round(input * 100);
    // 防止 1.005 这类二进制误差被放大：回算误差必须小于 0.5 分
    if (Math.abs(cents / 100 - input) > 5e-7) return null;
    return cents;
  }
  if (typeof input === 'string') {
    const s = input.trim();
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
    const [int, frac = ''] = s.split('.');
    const cents = Number(int) * 100 + Number((frac + '00').slice(0, 2));
    return Number.isSafeInteger(cents) ? cents : null;
  }
  return null;
}

/** 分 → 元（数字，保留两位） */
export function centsToYuan(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

/** 分 → "12.30" 形式的字符串（接口与页面展示统一用这个，避免 12.3 这种丢位） */
export function formatCents(cents: number): string {
  const n = Math.round(Number.isFinite(cents) ? cents : 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 万分比 → 百分比字符串，如 1000 → "10%"、1250 → "12.5%" */
export function formatBps(bps: number): string {
  const n = Math.round(Number.isFinite(bps) ? bps : 0);
  const pct = n / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

/**
 * 按万分比计算佣金（向下取整到分）。
 * 向下取整是刻意的：不能让佣金总额因为四舍五入超过平台实收。
 */
export function commissionCents(orderCents: number, bps: number): number {
  if (!Number.isFinite(orderCents) || !Number.isFinite(bps)) return 0;
  if (orderCents <= 0 || bps <= 0) return 0;
  return Math.floor((orderCents * bps) / 10_000);
}
