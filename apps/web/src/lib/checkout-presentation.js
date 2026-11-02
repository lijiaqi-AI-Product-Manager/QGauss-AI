export function checkoutCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents > 0n && cents <= 2147483647n ? Number(cents) : null;
}
export function checkoutMoney(cents) { return Number.isSafeInteger(cents) && cents >= 0 && cents <= 2147483647 ? (cents / 100).toFixed(2) : '—'; }
export function packageDuration(days) { return days < 0 ? '长期会员' : days > 0 ? '会员 ' + days + ' 天' : '次数补充包'; }
export function orderState(status) { return ({ 0: '等待付款', 1: '已支付 · 权益到账', 2: '支付失败', 3: '订单已关闭', 4: '已退款' })[status] || '状态待确认'; }
export function orderBenefits(offer, count = 1) {
  if (!offer) return null;
  const times = Number.isSafeInteger(count) && count > 0 && count <= 99 ? count : 1;
  const result = { ...offer, days: offer.days < 0 ? -1 : offer.days * times };
  for (const key of ['model3Count', 'model4Count', 'drawMjCount', 'agentCount']) result[key] = offer[key] * times;
  return result;
}
export function paymentHref(value) {
  if (typeof value !== 'string' || value.length > 8000) return '';
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function cardCode(value) { const code = String(value || '').replace(/[-\s]/g, '').toUpperCase(); return /^[A-Z0-9]{12}$/.test(code) ? code : ''; }
export function ownOrderId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : ''; }
export function pendingCheckout(value) {
  if (!value || !/^[A-Za-z0-9_-]{16,80}$/.test(value.requestKey || '')) return null;
  if (value.goodsType === 'money' && checkoutCents(value.amountYuan) !== null) return { requestKey: value.requestKey, goodsType: 'money', amountYuan: checkoutMoney(checkoutCents(value.amountYuan)) };
  if (value.goodsType === 'package' && ownOrderId(value.goodsId) && /^[a-f0-9]{64}$/.test(value.expectedOfferRevision || '')) return { requestKey: value.requestKey, goodsType: 'package', goodsId: value.goodsId, expectedOfferRevision: value.expectedOfferRevision };
  return null;
}
