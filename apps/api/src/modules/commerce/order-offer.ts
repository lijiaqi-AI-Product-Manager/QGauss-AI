import { createHash } from 'node:crypto';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

export interface OrderOffer {
  version: 1;
  id: string;
  name: string;
  priceCents: number;
  days: number;
  model3Count: number;
  model4Count: number;
  drawMjCount: number;
  agentCount: number;
}
export function captureOffer(value: Omit<OrderOffer, 'version'>): OrderOffer {
  return { version: 1, id: value.id, name: value.name, priceCents: value.priceCents, days: value.days, model3Count: value.model3Count, model4Count: value.model4Count, drawMjCount: value.drawMjCount, agentCount: value.agentCount };
}
export function validOffer(value: OrderOffer): boolean {
  return !!value && value.version === 1 && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 64 && typeof value.name === 'string' && value.name.length <= 200 &&
    [value.priceCents, value.model3Count, value.model4Count, value.drawMjCount, value.agentCount].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) &&
    Number.isSafeInteger(value.days) && value.days >= -1 && value.days <= 36500;
}
export function offerRevision(offer: OrderOffer): string { return createHash('sha256').update(JSON.stringify(offer)).digest('hex'); }
export function acceptedOffer(value: string | undefined): OrderOffer | null {
  if (!value) return null;
  try { const offer = JSON.parse(value); if (validOffer(offer)) return offer; } catch {}
  throw new BusinessException(ErrorCode.INTERNAL, '订单权益快照无效，请联系管理员核查', 500);
}
export function orderTimeout(value: unknown): number { const minutes = Number(value); return Number.isFinite(minutes) && minutes > 0 ? Math.max(1, minutes) * 60000 : 30 * 60000; }
export function overdueOrders(now: Date, timeout: number) {
  return { OR: [{ expiresAt: { lte: now } }, { expiresAt: null, createdAt: { lt: new Date(now.getTime() - timeout) } }] };
}
