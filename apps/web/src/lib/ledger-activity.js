/** A reserved-count settlement records expense but does not reduce availability a second time. */
export function ledgerActivity(row) {
  const amount = Number.isSafeInteger(row.amount) && row.amount >= 0 ? row.amount : 0;
  const direction = Number(row.direction);
  const reservedSettlement = direction === 1 && !!row.sourceLogId;
  const label = reservedSettlement ? '结算' : ({ 1: '消费', 2: '退款', 3: '失败免扣', 4: '预留', 5: '释放', 6: '到期失效' }[direction] || '记录');
  const delta = reservedSettlement || ![1, 2, 4, 5].includes(direction) ? 0 : ([2, 5].includes(direction) ? amount : -amount);
  const money = row.deductionType === 'money';
  const format = value => money ? '¥' + (Math.abs(value) / 100).toFixed(2) : Math.abs(value) + ' 次';
  return { label, delta, quantity: format(amount), change: delta === 0 ? '无变动' : (delta > 0 ? '+' : '−') + format(delta) };
}
