import { ORDER_STATUS } from './order.service';
import { StatementInputRow } from './payment-statement-input';

export const statementOrderSelect = {
  orderId: true, tradeId: true, payPlatform: true, status: true, totalCents: true, paydAt: true,
} as const;

type StatementOrder = {
  orderId: string;
  tradeId: string;
  payPlatform: string;
  status: number;
  totalCents: number;
  paydAt: Date | null;
};

export const findingLabels = {
  'order-missing': '站内未找到关联订单',
  'order-conflict': '订单号和交易号指向不同的订单',
  'trade-ambiguous': '站内交易号对应多笔订单',
  'trade-mismatch': '交易号与站内记录不一致',
  'provider-mismatch': '收款通道与站内记录不一致',
  'payment-state': '站内没有已支付记录',
  'payment-time': '站内支付记录缺少到账时间',
  'amount-mismatch': '账单金额与站内订单金额不一致',
  'duplicate-payment': '账单内同一订单出现多笔收款',
  'refund-review': '待核对退款凭证和权益处理',
  'refund-amount': '账单内累计退款超过订单金额',
  'missing-receipt': '完整账期内的站内已支付订单缺少渠道收款行',
} as const;

type Finding = keyof typeof findingLabels;

export type ReconciledRow = Omit<StatementInputRow, 'kind' | 'amountCents' | 'sourceLine'> & {
  kind: 'payment' | 'refund' | 'site-only';
  sourceLine: number | null;
  amountCents: number | null;
  localOrderId: string;
  localAmountCents: number | null;
  findings: Finding[];
};

export function reconcileStatementRows(
  imported: StatementInputRow[], lookedUp: StatementOrder[], periodOrders: StatementOrder[], provider: string,
): ReconciledRow[] {
  const byOrder = new Map(lookedUp.map(order => [order.orderId, order]));
  const byTrade = new Map<string, StatementOrder[]>();
  for (const order of lookedUp) {
    if (order.payPlatform !== provider || !order.tradeId) continue;
    const matches = byTrade.get(order.tradeId);
    if (matches) matches.push(order);
    else byTrade.set(order.tradeId, [order]);
  }
  const covered = new Set<string>();
  const paymentCounts = new Map<string, number>();
  const refundTotals = new Map<string, number>();
  const result: ReconciledRow[] = imported.map(row => {
    const exact = byOrder.get(row.orderRef);
    const tradeOptions = byTrade.get(row.tradeRef) ?? [];
    const tradeMatch = tradeOptions.length === 1 ? tradeOptions[0] : undefined;
    const order = exact ?? tradeMatch;
    const findings: Finding[] = [];
    if (tradeOptions.length > 1) findings.push('trade-ambiguous');
    if (row.orderRef && tradeMatch && (exact?.orderId !== tradeMatch.orderId)) findings.push('order-conflict');
    if (!order && tradeOptions.length < 2) findings.push('order-missing');

    if (order) {
      if (order.payPlatform !== provider) findings.push('provider-mismatch');
      if (row.tradeRef && row.tradeRef !== order.tradeId) findings.push('trade-mismatch');
      if (order.status !== ORDER_STATUS.PAID && order.status !== ORDER_STATUS.REFUNDED) findings.push('payment-state');
      else if (!order.paydAt) findings.push('payment-time');

      if (row.kind === 'payment') {
        if (row.amountCents !== order.totalCents) findings.push('amount-mismatch');
        const reliableReference = exact || (!row.orderRef && tradeMatch);
        if (reliableReference && order.payPlatform === provider) {
          covered.add(order.orderId);
          paymentCounts.set(order.orderId, (paymentCounts.get(order.orderId) ?? 0) + 1);
        }
      } else {
        refundTotals.set(order.orderId, (refundTotals.get(order.orderId) ?? 0) + row.amountCents);
      }
    }
    if (row.kind === 'refund') findings.push('refund-review');
    return { ...row, findings, localOrderId: order?.orderId ?? '', localAmountCents: order?.totalCents ?? null };
  });

  for (const row of result) {
    if (row.kind === 'payment' && (paymentCounts.get(row.localOrderId) ?? 0) > 1) row.findings.push('duplicate-payment');
    if (row.kind === 'refund' && row.localAmountCents !== null &&
        (refundTotals.get(row.localOrderId) ?? 0) > row.localAmountCents) row.findings.push('refund-amount');
  }

  for (const order of periodOrders) {
    if (!order.paydAt || covered.has(order.orderId)) continue;
    result.push({
      kind: 'site-only', sourceLine: null, eventRef: '', orderRef: order.orderId, tradeRef: order.tradeId,
      occurredAt: order.paydAt, amountCents: null, feeCents: null, localOrderId: order.orderId,
      localAmountCents: order.totalCents, findings: ['missing-receipt'],
    });
  }
  return result;
}
