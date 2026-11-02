export const WALLET_POOLS = Object.freeze([
  { key: 'model3', label: '低价模型', icon: 'chat', to: '/plaza', caption: '给日常的小想法' },
  { key: 'model4', label: '高价模型', icon: 'reasoning', to: '/plaza', caption: '给值得深想的题' },
  { key: 'drawMj', label: '绘画', icon: 'palette', to: '/painting', caption: '让想象有了形状' },
  { key: 'agent', label: '智能体', icon: 'apps', to: '/apps', caption: '找一位专长搭档' },
]);
export function walletCount(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
export function walletDate(value, dateOnly = false) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }) }).format(new Date(value));
}
export function membershipLabel(balance) {
  if (!balance?.isMember) return '创作者账户';
  const date = new Date(balance.expirationTime);
  if (!Number.isFinite(date.getTime())) return '会员有效期待更新';
  return date.getUTCFullYear() >= 9999 ? '会员长期有效' : '会员有效期至 ' + walletDate(date, true);
}
export function signinDays(today, items = []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today || '')) return [];
  const end = new Date(today + 'T00:00:00Z');
  if (!Number.isFinite(end.getTime()) || end.toISOString().slice(0, 10) !== today) return [];
  const signed = new Set(items.map(item => item.signInDate));
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(end.getTime() - (6 - i) * 86400000), key = date.toISOString().slice(0, 10);
    return { key, day: date.getUTCDate(), label: ['日', '一', '二', '三', '四', '五', '六'][date.getUTCDay()], signed: signed.has(key), today: key === today };
  });
}
export function grantSummary(row) {
  const parts = WALLET_POOLS.filter(pool => walletCount(row[pool.key + 'Count']) > 0).map(pool => pool.label + ' ' + row[pool.key + 'Count'] + ' 次');
  if (row.days < 0) parts.push('长期会员');
  else if (walletCount(row.days)) parts.push('会员 ' + row.days + ' 天');
  if (walletCount(row.amountCents)) parts.push('余额 ¥' + (row.amountCents / 100).toFixed(2));
  return parts.join(' · ') || '无次数或余额变动';
}
export function rechargeSource(value) { return ({ admin: '管理员发放', crami: '卡密兑换', order: '订单到账', gift: '活动赠送', signin: '签到奖励' })[value] || String(value || '其他来源'); }
