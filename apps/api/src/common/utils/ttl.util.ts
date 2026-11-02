/** 把 "15m" / "7d" / "3600s" 解析成毫秒 */
export function parseTtlMs(ttl: string, fallbackMs = 7 * 24 * 3600 * 1000): number {
  const m = /^(\d+)\s*([smhd])$/i.exec((ttl ?? '').trim());
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  switch (m[2].toLowerCase()) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    default:
      return n * 86_400_000;
  }
}
