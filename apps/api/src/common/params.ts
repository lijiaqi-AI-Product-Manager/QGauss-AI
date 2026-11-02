/**
 * 查询参数归一化（纯函数，无框架依赖）
 *
 * 为什么不直接把 query 丢给 Prisma：
 *   `?page=abc` → `Number('abc')` 是 NaN，Prisma 会在 skip 上报错变成 500。
 *   这类输入是「客户端乱传」而不是「服务器故障」，必须在边界收敛成合法值，
 *   否则一个手滑的 URL 就能刷出 500 日志，掩盖真正的故障。
 */
import { BusinessException, ErrorCode } from './exceptions/business.exception';

/** 统一分页夹紧：非法/负数/超大值一律收敛到合法区间 */
export function page(q: { page?: unknown; pageSize?: unknown }, maxSize = 100) {
  const p = Math.max(1, Math.floor(Number(q?.page) || 1));
  const s = Math.min(maxSize, Math.max(1, Math.floor(Number(q?.pageSize) || 20)));
  return { skip: (p - 1) * s, take: s, page: p, pageSize: s };
}

/**
 * 取整数参数。空值返回默认值；无法转成整数或越界则抛 400。
 * 用于「金额/次数/天数/状态码」等不能静默纠正的字段。
 */
export function toInt(v: unknown, def: number, min: number, max: number, field: string): number {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new BusinessException(ErrorCode.PARAM_INVALID, `${field} 必须是整数`);
  }
  if (n < min || n > max) {
    throw new BusinessException(ErrorCode.PARAM_INVALID, `${field} 必须在 ${min}~${max} 之间`);
  }
  return n;
}

/** 取字符串参数：截断到 maxLen，空值返回默认值 */
export function toStr(v: unknown, def = '', maxLen = 200): string {
  if (v === undefined || v === null) return def;
  return String(v).slice(0, maxLen);
}

/** 取布尔参数：接受 true/false、"true"/"false"、1/0、"1"/"0" */
export function toBool(v: unknown, def = false): boolean {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return def;
}
