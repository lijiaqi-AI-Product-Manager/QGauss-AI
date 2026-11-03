import {chatText as message} from '../i18n/chat-messages.js';
import {MODEL_POOLS} from './model-presentation.js';

const literal = (original, values) => message('zh', original, values);
const count = value => Number.isSafeInteger(value) && value >= 0;

/** Public API codes retain their meaning when error messages change language. */
export function chatAppFailure(error) {
  if (error?.status === 409 && error.code === 1001) return 'stale';
  if (/应用/.test(error?.message || '') && /变化|不存在|不可用|下架/.test(error.message)) return 'stale';
  if (error?.status === 404 && error.code === 1002) return 'check-access';
  return null;
}

export function chatBilling(billing, translate = literal) {
  const fields = ['reserved', 'charged', 'returned', 'expired'];
  if (!billing || fields.some(field => !count(billing[field]))) return translate('次数回执待核对');
  const pool = translate(MODEL_POOLS[billing.pool] || '模型'), parts = [];
  if (['RESERVED', 'SETTLING'].includes(billing.state)) {
    parts.push(translate('已预留 {count} 次 · {pool} · 完成后结算', {count: billing.reserved, pool}));
  } else if (billing.state === 'SETTLED') {
    parts.push(translate('已结算 {count} 次 · {pool}', {count: billing.charged, pool}));
  } else if (billing.state === 'RELEASED') {
    parts.push(billing.charged > 0 ? translate('已结算 {count} 次 · {pool}', {count: billing.charged, pool}) : translate('本次未扣次数'));
  } else if (billing.state === 'FREE' && fields.every(field => billing[field] === 0)) {
    return translate('本次未扣次数');
  } else return translate('次数回执待核对');
  if (billing.returned > 0) parts.push(translate('已释放 {count} 次', {count: billing.returned}));
  if (billing.expired > 0) parts.push(translate('{count} 次会员额度已到期', {count: billing.expired}));
  return parts.join(' · ');
}

export function chatUsage(usage, translate = literal) {
  if (!usage || !count(usage.promptTokens) || !count(usage.completionTokens)) return translate('用量待确认');
  const used = usage.promptTokens + usage.completionTokens;
  if (!count(used)) return translate('用量待确认');
  const source = translate(usage.usageEstimated === false ? '模型服务返回' : '估算');
  return Number.isSafeInteger(usage.contextLimit) && usage.contextLimit > 0
    ? translate('上下文 {used} / {limit} · {source}', {used, limit: usage.contextLimit, source})
    : translate('用量 {used} · {source}', {used, source});
}
