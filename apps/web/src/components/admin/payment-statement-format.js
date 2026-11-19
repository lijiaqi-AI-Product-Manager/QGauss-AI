export const importColumns = ['记录类型', '渠道流水号', '订单号', '交易号', '发生时间', '金额（分）', '手续费（分）'];

export function periodLabel(statement) {
  if (!statement.fromDay) return '按账单所列记录核对';
  return statement.fromDay + ' 至 ' + statement.throughDay;
}

export function rowType(kind) {
  return { payment: '收款', refund: '退款', 'site-only': '渠道缺行' }[kind] || '账单记录';
}

export function stateName(state) {
  return { open: '待复核', reviewed: '已复核', matched: '已匹配' }[state] || '待确认';
}
