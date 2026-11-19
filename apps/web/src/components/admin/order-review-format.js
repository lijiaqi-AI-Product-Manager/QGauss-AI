export const orderStatuses = { 0: '未支付', 1: '已支付', 2: '支付失败', 3: '已关闭', 4: '已退款' };
export const platforms = { epay: '易支付', hupi: '虎皮椒', mock: '模拟支付', manual: '人工登记' };

const dateFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const integerFormat = new Intl.NumberFormat('zh-CN');
const moneyFormat = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' });

export function orderDate(value) {
  return value ? dateFormat.format(new Date(value)) : '—';
}

export function platformLabel(platform) {
  return Object.hasOwn(platforms, platform) ? platforms[platform] : platform || '—';
}

export function whole(value) {
  return integerFormat.format(value);
}

export function currency(cents) {
  return moneyFormat.format(cents / 100);
}

export function orderCsv(rows) {
  const quote = (value) => {
    const cell = String(value ?? '');
    const needsText = typeof value === 'string' && (/^[\t\r\n]|^\s*[=+@-]/u.test(cell) || /^\d{15,}$/u.test(cell));
    return '"' + (needsText ? "'" : '') + cell.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

export function downloadOrderCsv(name, rows) {
  const url = URL.createObjectURL(new Blob([orderCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name + '.csv' });
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
