import { checkoutCents, checkoutMoney } from './checkout-presentation.js';
export { checkoutCents as referralCents, checkoutMoney as referralMoney };
export function referralPercent(bps) { return Number.isSafeInteger(bps) && bps >= 0 && bps <= 10000 ? (bps / 100).toFixed(2).replace(/\.?0+$/, '') + '%' : '—'; }
export function withdrawalStage(row) {
  if (row?.orderStatus === 0) return { key: 'pending', label: '等待审核', note: '申请金额已冻结，尚未登记打款。' };
  if (row?.orderStatus === 2) return { key: 'rejected', label: '已驳回 · 金额退回', note: '金额已退回可提现余额，可核对审核说明。' };
  if (row?.orderStatus === 1 && row.paymentStatus === 1) return { key: 'paid', label: '已登记打款', note: '管理员已登记站外打款，请核对实际收款账户。' };
  if (row?.orderStatus === 1) return { key: 'approved', label: '审核通过 · 待打款', note: '审核通过不代表实际到账，以收款账户为准。' };
  return { key: 'unknown', label: '状态待确认', note: '请刷新读取最新状态。' };
}
export function receivingChannel(value) { return ({ 1: '支付宝', 2: '微信', 3: '银行卡' })[value] || '未知方式'; }
export function maskedContact(value) { const text = String(value || ''); return text.length <= 4 ? '••••' : '•••• ' + text.slice(-4); }
export function invitationLink(code, origin) {
  if (typeof code !== 'string' || !/^[A-Z0-9]{8}$/.test(code)) return '';
  try { const base = new URL(origin); if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return ''; return new URL('/login?invite=' + encodeURIComponent(code), base.origin).href; } catch { return ''; }
}
export function withdrawalChoice(amount, channel, contact, policy, availableCents) {
  const cents = checkoutCents(amount), account = String(contact || '').trim();
  if (cents === null) return { error: '请输入大于 0 的金额，最多两位小数。' };
  if (!Number.isSafeInteger(policy?.minCents) || !Number.isSafeInteger(policy?.maxCents)) return { error: '提现规则尚未读取，请刷新账户后再试。' };
  if (cents < policy.minCents || cents > policy.maxCents) return { error: '单笔提现范围为 ¥' + checkoutMoney(policy.minCents) + '–¥' + checkoutMoney(policy.maxCents) + '。' };
  if (!Number.isSafeInteger(availableCents) || cents > availableCents) return { error: '申请金额超过当前可提现余额。' };
  if (![1, 2, 3].includes(channel)) return { error: '请选择有效的收款方式。' };
  if (!account || account.length > 120 || /[\u0000-\u001f\u007f]/.test(account)) return { error: '请填写 1–120 字的有效收款账号。' };
  return { payload: { amountYuan: checkoutMoney(cents), channels: channel, contact: account } };
}
